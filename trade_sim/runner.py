"""Shared setup for running one level-strategy backtest (used by run_backtest.py and run_grid.py)."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from .account import Account, AccountType
from .analysis import equity_stats, summarize
from .broker import PaperBroker
from .calendar import TradingCalendar
from .data import load_csv, save_csv
from .engine import Backtester
from .strategies.level_trader import DailyWeeklyLevels, LevelParams, SupportResistance

STRATEGIES = {"daily_weekly": DailyWeeklyLevels, "sr_zones": SupportResistance}


def load_bars(symbol: str, start: str, end: str, feed: str = "sip", cache_dir: str = "data_cache") -> pd.DataFrame:
    """Minute bars from the CSV cache, downloading from Alpaca on a miss."""
    cache = Path(cache_dir) / f"{symbol}_{start}_{end}_{feed}.csv"
    if cache.exists():
        return load_csv(cache)
    from .data.alpaca import fetch_bars
    df = fetch_bars(symbol, start, end, feed=feed)
    save_csv(df, cache)
    return df


def run_level_backtest(df: pd.DataFrame, symbol: str, strategy: str = "daily_weekly", mode: str = "vol_gated",
                       account: str = "margin", cash: float = 25_000, stop_atr: float = 0.5,
                       target_atr: float = 1.0, hold_days: int = 0, regular_only: bool = False,
                       cal: TradingCalendar | None = None, trade_start: str | None = None) -> tuple[pd.DataFrame, dict]:
    """Returns (trade journal, summary stats) for one symbol/strategy/mode.

    trade_start: bars before this date only warm up indicators (ATR, percentiles, zones);
    the simulation, trades and equity curve start here.
    """
    cal = cal or TradingCalendar()
    acct_type = AccountType(account)
    params = LevelParams(mode=mode, allow_short=acct_type == AccountType.MARGIN,
                         stop_atr=stop_atr, target_atr=target_atr,
                         exit_eod=hold_days == 0, max_hold_days=max(hold_days, 1))
    strat = STRATEGIES[strategy](symbol, params)
    broker = PaperBroker(Account(acct_type, cash=cash), cal)
    ctx = Backtester(broker, strat, {symbol: df}, regular_hours_only=regular_only).run(start=trade_start)
    trades = ctx.tracker.to_frame()
    # The engine records equity at each day's close; prepend the starting balance so the
    # first day's P&L counts toward returns.
    curve = ctx.equity_curve
    if curve:
        curve = [(curve[0][0] - pd.Timedelta(days=1), cash)] + curve
    stats = {**summarize(trades), **equity_stats(curve)}
    # Sanity check: equity change not explained by closed trades (open positions, interest, borrow fees).
    # Anything beyond a few dollars of fees means a position got stuck or the ledger is off.
    if "end_equity" in stats:
        closed = trades["net_pnl"].sum() if not trades.empty else 0.0
        stats["unexplained_pnl"] = round(stats["end_equity"] - stats["start_equity"] - closed, 2)
    stats["open_at_end"] = len(ctx.tracker.open)
    return trades, stats
