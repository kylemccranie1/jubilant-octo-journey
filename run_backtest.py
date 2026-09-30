"""Run a level strategy backtest and print results plus the filter report.

Examples:
    python run_backtest.py --synthetic --strategy daily_weekly
    python run_backtest.py --symbol SPY --start 2023-01-01 --end 2026-09-01 --strategy sr_zones --mode fade
"""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from trade_sim.analysis import filter_report
from trade_sim.calendar import TradingCalendar
from trade_sim.data import synthetic_minute_bars
from trade_sim.runner import STRATEGIES, load_bars, run_level_backtest


def get_data(args, cal) -> pd.DataFrame:
    if args.synthetic:
        return synthetic_minute_bars(args.start, args.end, seed=args.seed, extended=not args.regular_only, cal=cal)
    return load_bars(args.symbol, args.start, args.end, feed=args.feed)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="SYN")
    ap.add_argument("--start", default="2024-01-01")
    ap.add_argument("--end", default="2025-06-30")
    ap.add_argument("--synthetic", action="store_true")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--feed", choices=["sip", "iex"], default="sip",
                    help="sip = all exchanges (free if older than 15 min); iex = one exchange's trades")
    ap.add_argument("--strategy", choices=list(STRATEGIES), default="daily_weekly")
    ap.add_argument("--mode", choices=["vol_gated", "fade", "break"], default="vol_gated")
    ap.add_argument("--account", choices=["cash", "margin"], default="margin")
    ap.add_argument("--cash", type=float, default=25_000)
    ap.add_argument("--stop-atr", type=float, default=0.5)
    ap.add_argument("--target-atr", type=float, default=1.0)
    ap.add_argument("--hold-days", type=int, default=0, help="0 = flatten every day at 15:55")
    ap.add_argument("--regular-only", action="store_true", help="skip extended-hours bars (faster)")
    ap.add_argument("--out", default="results")
    args = ap.parse_args()

    cal = TradingCalendar()
    df = get_data(args, cal)
    trades, stats = run_level_backtest(df, args.symbol, args.strategy, args.mode, args.account, args.cash,
                                       args.stop_atr, args.target_atr, args.hold_days, args.regular_only, cal)
    print("\n== Summary ==")
    for k, v in stats.items():
        print(f"{k:>18}: {v}")
    out = Path(args.out)
    out.mkdir(exist_ok=True)
    stem = f"{args.symbol}_{args.strategy}_{args.mode}"
    trades.to_csv(out / f"{stem}_trades.csv", index=False)
    rep = filter_report(trades)
    rep.to_csv(out / f"{stem}_filters.csv", index=False)
    if not rep.empty:
        with pd.option_context("display.width", 200, "display.max_rows", 200):
            print("\n== Filter report (train = first 70% of trades, test = last 30%) ==")
            print(rep[["feature", "bucket", "period", "trades", "win_rate", "avg_return_pct", "profit_factor"]]
                  .to_string(index=False))
    print(f"\nTrades and filter report written to {out}/")


if __name__ == "__main__":
    main()
