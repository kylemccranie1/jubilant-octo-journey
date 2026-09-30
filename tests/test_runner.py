import pandas as pd

from trade_sim.data import synthetic_minute_bars
from trade_sim.runner import run_level_backtest


def test_trade_start_uses_earlier_bars_only_for_warmup():
    df = synthetic_minute_bars("2024-01-01", "2024-06-28", seed=3, extended=False)
    trades, stats = run_level_backtest(df, "X", "daily_weekly", "fade", regular_only=True, trade_start="2024-05-01")
    assert not trades.empty
    assert trades["entry_ts"].min() >= pd.Timestamp("2024-05-01", tz="America/New_York")
    # ~84 trading days of warm-up covers ATR (14) plus the percentile minimum (63), so features are ready.
    assert trades["f_atr_pct"].notna().all()
    assert stats["open_at_end"] == 0
    assert stats["start_equity"] == 25_000
    assert abs(stats["unexplained_pnl"]) < 5  # only borrow fees are outside the trade journal


def _synthetic():
    return synthetic_minute_bars("2024-01-01", "2024-06-28", seed=3, extended=False)


def test_breakeven_stop_exits_near_entry():
    trades, stats = run_level_backtest(_synthetic(), "X", "daily_weekly", "fade", regular_only=True,
                                       trade_start="2024-05-01", target_atr=0, breakeven_atr=0.2)
    assert stats["open_at_end"] == 0 and abs(stats["unexplained_pnl"]) < 5
    # A stop after the move to breakeven fills at (or, on a gap, beyond) the entry price, never
    # at the original stop 0.5 ATR away; trades that never reached +0.2 ATR keep the original stop.
    stopped = trades[trades["exit_tag"] == "stop"]
    near_entry = (stopped["exit_price"] - stopped["entry_price"]).abs() < 0.1 * stopped["risk_per_share"]
    assert near_entry.any()


def test_trailing_and_time_stops_fire_and_reconcile():
    df = _synthetic()
    trades, stats = run_level_backtest(df, "X", "daily_weekly", "fade", regular_only=True,
                                       trade_start="2024-05-01", target_atr=0, trail_atr=0.3)
    assert (trades["exit_tag"] == "trail").any()
    assert stats["open_at_end"] == 0 and abs(stats["unexplained_pnl"]) < 5
    trades, stats = run_level_backtest(df, "X", "daily_weekly", "fade", regular_only=True,
                                       trade_start="2024-05-01", time_stop_min=30)
    held = (trades["exit_ts"] - trades["entry_ts"]).dt.total_seconds() / 60
    assert (trades["exit_tag"] == "time_stop").any()
    assert held[trades["exit_tag"] == "time_stop"].between(30, 32).all()
    assert stats["open_at_end"] == 0
