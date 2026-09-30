"""Synthetic minute bars for testing the engine when no real data is available.

Random walk with volatility regimes and mean reversion toward recent levels. It has no
edge built in on purpose: a strategy that "works" on it is a red flag for a bug.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..calendar import ET, Session, TradingCalendar


def synthetic_minute_bars(start: str, end: str, price: float = 100.0, annual_vol: float = 0.25,
                          seed: int = 0, extended: bool = True,
                          cal: TradingCalendar | None = None) -> pd.DataFrame:
    cal = cal or TradingCalendar()
    rng = np.random.default_rng(seed)
    days = cal.trading_days(pd.Timestamp(start).date(), pd.Timestamp(end).date())
    rows = []
    vol_regime = 1.0
    for d in days:
        open_, close = cal.open_close(d)
        vol_regime = float(np.clip(vol_regime * np.exp(rng.normal(0, 0.15)), 0.4, 3.0))
        per_min = annual_vol * vol_regime / np.sqrt(252 * 390)
        # Overnight gap.
        price *= float(np.exp(rng.normal(0, per_min * 8)))
        starts = []
        if extended:
            starts += list(pd.date_range(pd.Timestamp.combine(d, pd.Timestamp("07:00").time()).tz_localize(ET),
                                         open_, freq="1min", inclusive="left"))
        starts += list(pd.date_range(open_, close, freq="1min", inclusive="left"))
        if extended:
            starts += list(pd.date_range(close, pd.Timestamp.combine(d, pd.Timestamp("20:00").time()).tz_localize(ET),
                                         freq="1min", inclusive="left"))
        for ts in starts:
            regular = open_ <= ts < close
            sig = per_min * (1.0 if regular else 0.5)
            path = price * np.exp(np.cumsum(rng.normal(0, sig / 2, 4)))
            o, c = price, float(path[-1])
            h = max(o, c, float(path.max())) * (1 + abs(rng.normal(0, sig / 4)))
            l = min(o, c, float(path.min())) * (1 - abs(rng.normal(0, sig / 4)))
            v = float(rng.lognormal(9 if regular else 6, 0.6))
            rows.append((ts, o, h, l, c, v, Session.REGULAR.value if regular else
                         (Session.PRE.value if ts < open_ else Session.POST.value)))
            price = c
    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume", "session"]).set_index("ts")
    df[["open", "high", "low", "close"]] = df[["open", "high", "low", "close"]].round(4)
    return df
