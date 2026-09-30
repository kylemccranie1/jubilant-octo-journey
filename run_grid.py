"""Run every symbol x strategy x mode combination and pool the trades for the filter report.

Per-symbol filter reports are thin (a few hundred trades, split 70/30), so this pools all
symbols' trades for each strategy/mode and splits train/test at one calendar date. A filter
that only helps in-sample shows up as positive train_vs_base and negative test_vs_base.

Example:
    python run_grid.py --symbols SPY QQQ AAPL MSFT NVDA AMZN --start 2021-01-01 --end 2026-09-29
"""
from __future__ import annotations

import argparse
import itertools
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import pandas as pd

from trade_sim.analysis import filter_digest, filter_report, summarize
from trade_sim.data import synthetic_minute_bars
from trade_sim.runner import STRATEGIES, load_bars, run_level_backtest

MODES = ["fade", "break", "vol_gated"]


def _bars(symbol, a):
    if a.synthetic:  # smoke test: a different random walk per symbol
        return synthetic_minute_bars(a.start, a.end, seed=a.symbols.index(symbol), extended=not a.regular_only)
    return load_bars(symbol, a.start, a.end, feed=a.feed)


def _job(symbol, strategy, mode, a):
    df = _bars(symbol, a)
    trades, stats = run_level_backtest(df, symbol, strategy, mode, a.account, a.cash, a.stop_atr,
                                       a.target_atr, a.hold_days, a.regular_only)
    return symbol, strategy, mode, trades, stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", nargs="+", default=["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "AMZN"])
    ap.add_argument("--start", default="2021-01-01")
    ap.add_argument("--end", default="2026-09-29")
    ap.add_argument("--synthetic", action="store_true", help="random-walk data, no API keys (no edge)")
    ap.add_argument("--feed", choices=["sip", "iex"], default="sip")
    ap.add_argument("--strategies", nargs="+", choices=list(STRATEGIES), default=list(STRATEGIES))
    ap.add_argument("--modes", nargs="+", choices=MODES, default=MODES)
    ap.add_argument("--account", choices=["cash", "margin"], default="margin")
    ap.add_argument("--cash", type=float, default=25_000)
    ap.add_argument("--stop-atr", type=float, default=0.5)
    ap.add_argument("--target-atr", type=float, default=1.0)
    ap.add_argument("--hold-days", type=int, default=0, help="0 = flatten every day at 15:55")
    ap.add_argument("--regular-only", action="store_true", help="skip extended-hours bars (faster)")
    ap.add_argument("--split", default=None,
                    help="train/test split date; default is the 70th percentile of pooled entry times")
    ap.add_argument("--min-trades", type=int, default=30, help="per period, for a filter to count as holding")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--out", default="results/grid")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    # Download sequentially first: the Alpaca free plan allows 200 requests/minute in total.
    if not a.synthetic:
        for s in a.symbols:
            load_bars(s, a.start, a.end, feed=a.feed)

    results, summaries = {}, []
    combos = list(itertools.product(a.symbols, a.strategies, a.modes))
    with ProcessPoolExecutor(max_workers=a.workers) as ex:
        futs = [ex.submit(_job, s, st, m, a) for s, st, m in combos]
        for f in as_completed(futs):
            s, st, m, trades, stats = f.result()
            results[(s, st, m)] = trades
            summaries.append({"symbol": s, "strategy": st, "mode": m, **stats})
            trades.to_csv(out / f"{s}_{st}_{m}_trades.csv", index=False)
            print(f"done {s:5} {st:12} {m:9} trades={stats.get('trades', 0):5} "
                  f"avg_r={stats.get('avg_r', float('nan'))} total_return_pct={stats.get('total_return_pct')}",
                  flush=True)

    summary = pd.DataFrame(summaries).sort_values(["strategy", "mode", "symbol"])
    summary.to_csv(out / "summary.csv", index=False)

    pooled_rows = []
    for st, m in itertools.product(a.strategies, a.modes):
        frames = [results[(s, st, m)] for s in a.symbols if not results[(s, st, m)].empty]
        if not frames:
            continue
        pooled = pd.concat(frames, ignore_index=True).sort_values("entry_ts")
        split = pd.Timestamp(a.split, tz=pooled["entry_ts"].iloc[0].tz) if a.split else None
        if split is None:
            split = pooled["entry_ts"].iloc[int(len(pooled) * 0.7)]
        rep = filter_report(pooled, split=split)
        rep.to_csv(out / f"pooled_{st}_{m}_filters.csv", index=False)
        dig = filter_digest(rep, min_trades=a.min_trades)
        dig.to_csv(out / f"pooled_{st}_{m}_digest.csv", index=False)
        train, test = pooled[pooled["entry_ts"] < split], pooled[pooled["entry_ts"] >= split]
        for period, df in (("all", pooled), ("train", train), ("test", test)):
            pooled_rows.append({"strategy": st, "mode": m, "period": period, **summarize(df)})
        with pd.option_context("display.width", 200, "display.max_rows", 60, "display.float_format", "{:.3f}".format):
            print(f"\n== {st} / {m}: pooled filters, split {split.date()} (top by test_vs_base) ==")
            print(dig.head(12).to_string(index=False))

    pooled_summary = pd.DataFrame(pooled_rows)
    pooled_summary.to_csv(out / "pooled_summary.csv", index=False)
    with pd.option_context("display.width", 200, "display.max_rows", 200):
        print("\n== Per-symbol summary ==")
        print(summary[["strategy", "mode", "symbol", "trades", "win_rate", "avg_r", "profit_factor",
                       "total_return_pct", "max_drawdown_pct", "sharpe", "unexplained_pnl", "open_at_end"]].to_string(index=False))
        print("\n== Pooled summary ==")
        print(pooled_summary.to_string(index=False))
    print(f"\nWritten to {out}/")


if __name__ == "__main__":
    main()
