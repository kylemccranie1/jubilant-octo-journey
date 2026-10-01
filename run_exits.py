"""Compare exit settings on the same entries: every exit config x symbol x strategy x mode.

Exits change what one R means (R = distance to the stop), so configs are compared on net
P&L, which is on the same footing because every trade risks 1% of equity. Configs are
ranked on the train period and judged on the test period (one fixed split date for all).
With many configs the best in-sample one is partly luck; the train/test rank correlation
shows whether exit choice carries over at all.

Examples:
    # stop x target grid, flat by 15:55
    python run_exits.py --stops 0.25 0.5 1.0 --targets 0.5 1 2 3 0
    # explicit configs (any LevelParams field), e.g. multi-day holds
    python run_exits.py --configs '[{"stop_atr": 0.5, "target_atr": 2, "hold_days": 3}]'
"""
from __future__ import annotations

import argparse
import itertools
import json
from concurrent.futures import ProcessPoolExecutor, as_completed
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

from trade_sim import levels as lv
from trade_sim.analysis import summarize
from trade_sim.runner import STRATEGIES, load_bars, run_level_backtest

ARGS = None


@lru_cache(maxsize=None)
def _bars(symbol):  # one CSV read per symbol per worker process
    return load_bars(symbol, ARGS.start, ARGS.end, feed=ARGS.feed)


def _bars_main(symbol, a):
    return load_bars(symbol, a.start, a.end, feed=a.feed)


def _init(args):
    global ARGS
    ARGS = args


def _label(cfg: dict) -> str:
    parts = []
    for k, v in cfg.items():
        if k == "target_atr" and v == 0:
            v = "none"
        if k == "hold_days":
            k, v = "hold", {0: "eod", -1: "none"}.get(v, f"{v}d")
        parts.append(f"{k.replace('_atr', '')}={v}")
    return " ".join(parts)


def _job(symbol, strategy, mode, cfg):
    a = ARGS
    cfg = dict(cfg)
    kw = dict(stop_atr=cfg.pop("stop_atr", 0.5), target_atr=cfg.pop("target_atr", 1.0),
              hold_days=cfg.pop("hold_days", 0))
    trades, stats = run_level_backtest(_bars(symbol), symbol, strategy, mode, a.account, a.cash,
                                       regular_only=True, trade_start=a.trade_start, **kw,
                                       **({"levels": tuple(a.levels)} if a.levels else {}), **cfg)
    return trades, stats


def pooled_stats(trades: pd.DataFrame, split: pd.Timestamp) -> dict:
    if trades.empty:
        return {"trades": 0}
    train, test = trades[trades["entry_ts"] < split], trades[trades["entry_ts"] >= split]
    s = summarize(trades)
    exits = trades["exit_tag"].value_counts(normalize=True)
    hold_min = (trades["exit_ts"] - trades["entry_ts"]).dt.total_seconds() / 60
    return {**s,
            "train_pnl": round(train["net_pnl"].sum(), 0), "test_pnl": round(test["net_pnl"].sum(), 0),
            "train_avg_r": round(train["r_multiple"].mean(), 3), "test_avg_r": round(test["r_multiple"].mean(), 3),
            "pct_stop": round(100 * exits.get("stop", 0), 1), "pct_target": round(100 * exits.get("target", 0), 1),
            "pct_trail": round(100 * exits.get("trail", 0), 1),
            "pct_time": round(100 * (exits.get("time_exit", 0) + exits.get("time_stop", 0)), 1),
            "pct_end": round(100 * exits.get("end_of_data", 0), 1),
            "long_pnl": round(trades.loc[trades["direction"] > 0, "net_pnl"].sum(), 0),
            "short_pnl": round(trades.loc[trades["direction"] < 0, "net_pnl"].sum(), 0),
            "median_hold_min": round(hold_min.median(), 0)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", nargs="+", default=["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "AMZN"])
    ap.add_argument("--start", default="2025-06-02")
    ap.add_argument("--trade-start", default="2025-09-29")
    ap.add_argument("--end", default="2026-09-29")
    ap.add_argument("--feed", choices=["sip", "iex"], default="sip")
    ap.add_argument("--strategies", nargs="+", choices=list(STRATEGIES), default=list(STRATEGIES))
    ap.add_argument("--modes", nargs="+", choices=["fade", "break", "vol_gated"], default=["fade", "break"])
    ap.add_argument("--account", choices=["cash", "margin"], default="margin")
    ap.add_argument("--cash", type=float, default=25_000)
    ap.add_argument("--stops", nargs="+", type=float, default=[0.25, 0.5, 1.0])
    ap.add_argument("--targets", nargs="+", type=float, default=[0.5, 1.0, 2.0, 3.0, 0.0],
                    help="0 = no target (exit at the stop or the time exit)")
    ap.add_argument("--holds", nargs="+", type=int, default=[0],
                    help="0 = flatten daily at 15:55; N = flatten after N trading days; -1 = no time limit")
    ap.add_argument("--levels", nargs="+", default=None, choices=["pdh", "pdl", "pwh", "pwl"],
                    help="daily_weekly only: which levels to trade (default all four)")
    ap.add_argument("--configs", default=None, help="JSON list of dicts; replaces the stops x targets x holds grid")
    ap.add_argument("--split", default="2026-06-08", help="train/test split date for all configs")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--out", default="results/exits")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    if a.configs:
        configs = json.loads(a.configs)
    else:
        configs = [{"stop_atr": s, "target_atr": t, "hold_days": h}
                   for s, t, h in itertools.product(a.stops, a.targets, a.holds)]
    for s in a.symbols:  # download (sequentially) before the workers start
        load_bars(s, a.start, a.end, feed=a.feed)

    jobs = list(itertools.product(range(len(configs)), a.symbols, a.strategies, a.modes))
    print(f"{len(configs)} exit configs x {len(a.symbols)} symbols x {len(a.strategies)} strategies x "
          f"{len(a.modes)} modes = {len(jobs)} runs", flush=True)
    trades_by = {}
    per_symbol = []
    with ProcessPoolExecutor(max_workers=a.workers, initializer=_init, initargs=(a,)) as ex:
        futs = {ex.submit(_job, s, st, m, configs[i]): (i, s, st, m) for i, s, st, m in jobs}
        for n, f in enumerate(as_completed(futs), 1):
            i, s, st, m = futs[f]
            trades, stats = f.result()
            trades_by[(i, s, st, m)] = trades
            per_symbol.append({"config": _label(configs[i]), "symbol": s, "strategy": st, "mode": m, **stats})
            if n % 20 == 0 or n == len(jobs):
                print(f"  {n}/{len(jobs)} runs done", flush=True)

    pd.DataFrame(per_symbol).to_csv(out / "per_symbol.csv", index=False)
    split = pd.Timestamp(a.split, tz="America/New_York")
    rows = []
    for i, st, m in itertools.product(range(len(configs)), a.strategies, a.modes):
        frames = [trades_by[(i, s, st, m)] for s in a.symbols if not trades_by[(i, s, st, m)].empty]
        pooled = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
        if not pooled.empty:
            pooled["entry_ts"] = pd.to_datetime(pooled["entry_ts"])
            pooled["exit_ts"] = pd.to_datetime(pooled["exit_ts"])
            pooled.to_csv(out / f"trades_{st}_{m}_cfg{i}.csv", index=False)
        sym_pnl = [trades_by[(i, s, st, m)]["net_pnl"].sum() if not trades_by[(i, s, st, m)].empty else 0
                   for s in a.symbols]
        rows.append({"strategy": st, "mode": m, "config": _label(configs[i]), **configs[i],
                     **pooled_stats(pooled, split), "symbols_positive": int(sum(p > 0 for p in sym_pnl))})
    res = pd.DataFrame(rows)
    res.to_csv(out / "exits_summary.csv", index=False)

    cols = ["config", "trades", "win_rate", "profit_factor", "net_pnl", "train_pnl", "test_pnl",
            "symbols_positive", "long_pnl", "short_pnl", "pct_stop", "pct_target", "pct_trail", "pct_time",
            "pct_end", "median_hold_min"]
    with pd.option_context("display.width", 220, "display.max_rows", 200):
        for (st, m), g in res.groupby(["strategy", "mode"], sort=False):
            g = g.sort_values("train_pnl", ascending=False)
            rho = g["train_pnl"].rank().corr(g["test_pnl"].rank()) if len(g) > 2 else np.nan
            print(f"\n== {st} / {m}: exits ranked by train P&L (split {split.date()}); "
                  f"train/test rank correlation {rho:.2f} ==")
            print(g[cols].to_string(index=False))
    bh = []
    for sym in a.symbols:
        d = lv.daily_bars(_bars_main(sym, a))
        d = d[d.index >= pd.Timestamp(a.trade_start).date()] if a.trade_start else d
        bh.append(f"{sym} {100 * (d['close'].iloc[-1] / d['close'].iloc[0] - 1):+.1f}%")
    print("\nBuy and hold over the same window: " + ", ".join(bh))
    print(f"\nNet P&L is summed over {len(a.symbols)} symbols, each a ${a.cash:,.0f} account risking 1% per trade.")
    print(f"Written to {out}/")


if __name__ == "__main__":
    main()
