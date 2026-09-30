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
