import numpy as np
import pandas as pd

from trade_sim import levels as lv
from trade_sim.data import synthetic_minute_bars


def test_prior_levels_use_only_past_days():
    df = synthetic_minute_bars("2024-03-04", "2024-03-22", extended=False, seed=1)
    d = lv.daily_bars(df)
    p = lv.prior_levels(d)
    assert p["pdh"].iloc[1] == d["high"].iloc[0]
    # Second week's weekly levels are the first week's high/low.
    wk1 = d.iloc[:5]
    assert p["pwh"].iloc[5] == wk1["high"].max() and p["pwl"].iloc[5] == wk1["low"].min()
    assert np.isnan(p["pwh"].iloc[0])


def test_zone_found_at_repeated_rejections():
    # Hourly bars that rally to ~110 three times and get rejected each time.
    idx = pd.date_range("2024-03-04 09:30", periods=60, freq="h", tz="America/New_York")
    base = 100 + 10 * np.abs(np.sin(np.arange(60) * np.pi / 20))
    bars = pd.DataFrame({"open": base, "high": base + 0.3, "low": base - 0.3, "close": base,
                         "volume": 1000.0}, index=idx)
    zones = lv.find_zones(bars, idx[-1] + pd.Timedelta(hours=1), lookback_days=30, k=2)
    res = [z for z in zones if z.low > 108]
    assert res and res[0].touches >= 2


def test_zones_ignore_future_bars():
    idx = pd.date_range("2024-03-04 09:30", periods=60, freq="h", tz="America/New_York")
    base = 100 + 10 * np.abs(np.sin(np.arange(60) * np.pi / 20))
    bars = pd.DataFrame({"open": base, "high": base + 0.3, "low": base - 0.3, "close": base,
                         "volume": 1000.0}, index=idx)
    early = lv.find_zones(bars, idx[15], lookback_days=30, k=2)
    assert all(z.last_touch < idx[15] for z in early)
