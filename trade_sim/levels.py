"""Price levels and volatility metrics.

Strategy 1 levels: previous day's and previous week's high and low (regular session).
Strategy 2 levels: support/resistance zones where price was tested and rejected more
than once over the recent past (< 1 month) on 1-hour and 4-hour bars. This is an
algorithmic stand-in for drawing the zones by eye: find swing highs/lows, then cluster
the ones that sit at nearly the same price.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .calendar import ET


# ----------------------------------------------------------------------
# Bars
# ----------------------------------------------------------------------
def regular_only(minute_bars: pd.DataFrame) -> pd.DataFrame:
    return minute_bars[minute_bars["session"] == "regular"]


def daily_bars(minute_bars: pd.DataFrame) -> pd.DataFrame:
    """Regular-session daily OHLCV indexed by date."""
    rb = regular_only(minute_bars)
    g = rb.groupby(rb.index.tz_convert(ET).date)
    return pd.DataFrame({"open": g["open"].first(), "high": g["high"].max(), "low": g["low"].min(),
                         "close": g["close"].last(), "volume": g["volume"].sum()})


def weekly_bars(daily: pd.DataFrame) -> pd.DataFrame:
    idx = pd.to_datetime(daily.index)
    wk = daily.groupby(idx.to_period("W-FRI"))
    return pd.DataFrame({"open": wk["open"].first(), "high": wk["high"].max(), "low": wk["low"].min(),
                         "close": wk["close"].last(), "volume": wk["volume"].sum()})


def intraday_bars(minute_bars: pd.DataFrame, hours: int) -> pd.DataFrame:
    """Regular-session bars of `hours` length, anchored to 9:30 each day (4h = 9:30-13:30, 13:30-16:00)."""
    rb = regular_only(minute_bars)
    local = rb.index.tz_convert(ET)
    day = pd.Series(local.date, index=rb.index)
    minutes = (local.hour * 60 + local.minute) - (9 * 60 + 30)
    bucket = minutes // (hours * 60)
    key = pd.MultiIndex.from_arrays([day.values, bucket])
    g = rb.groupby(key)
    out = pd.DataFrame({"ts": g.apply(lambda x: x.index[0]), "open": g["open"].first(),
                        "high": g["high"].max(), "low": g["low"].min(), "close": g["close"].last(),
                        "volume": g["volume"].sum()})
    return out.set_index("ts").sort_index()


# ----------------------------------------------------------------------
# Volatility
# ----------------------------------------------------------------------
def atr(bars: pd.DataFrame, n: int = 14) -> pd.Series:
    prev_close = bars["close"].shift(1)
    tr = pd.concat([bars["high"] - bars["low"], (bars["high"] - prev_close).abs(),
                    (bars["low"] - prev_close).abs()], axis=1).max(axis=1)
    return tr.rolling(n, min_periods=n).mean()


def rolling_percentile(s: pd.Series, window: int = 252) -> pd.Series:
    """Where today's value ranks within the trailing window, 0-100."""
    def pct(x):
        return 100.0 * (x[:-1] < x[-1]).mean() if len(x) > 1 else np.nan
    return s.rolling(window, min_periods=max(20, window // 4)).apply(pct, raw=True)


def realized_vol(bars: pd.DataFrame, n: int = 20) -> pd.Series:
    r = np.log(bars["close"]).diff()
    return r.rolling(n).std() * np.sqrt(252)


# ----------------------------------------------------------------------
# Strategy 1: prior day / week highs and lows
# ----------------------------------------------------------------------
def prior_levels(daily: pd.DataFrame) -> pd.DataFrame:
    """For each date: previous day's high/low and the previous completed week's high/low."""
    out = pd.DataFrame(index=daily.index)
    out["pdh"] = daily["high"].shift(1)
    out["pdl"] = daily["low"].shift(1)
    idx = pd.to_datetime(daily.index)
    weeks = idx.to_period("W-FRI")
    wk = weekly_bars(daily)
    prev_wk = wk.shift(1)
    out["pwh"] = prev_wk.loc[weeks, "high"].values
    out["pwl"] = prev_wk.loc[weeks, "low"].values
    return out


# ----------------------------------------------------------------------
# Strategy 2: support / resistance zones
# ----------------------------------------------------------------------
@dataclass
class Zone:
    low: float
    high: float
    kind: str            # "support", "resistance", or "both"
    touches: int
    first_touch: pd.Timestamp
    last_touch: pd.Timestamp
    timeframe: str

    @property
    def mid(self) -> float:
        return (self.low + self.high) / 2


def swing_points(bars: pd.DataFrame, k: int = 2) -> pd.DataFrame:
    """Swing highs/lows: a bar whose high (low) is the extreme of the k bars on each side.

    A swing is only knowable k bars after it happens; `confirmed_at` records when.
    """
    h, l = bars["high"].values, bars["low"].values
    rows = []
    for i in range(k, len(bars) - k):
        if h[i] == h[i - k:i + k + 1].max() and (h[i] > h[i - k:i]).all():
            rows.append((bars.index[i], bars.index[i + k], h[i], "high"))
        if l[i] == l[i - k:i + k + 1].min() and (l[i] < l[i - k:i]).all():
            rows.append((bars.index[i], bars.index[i + k], l[i], "low"))
    return pd.DataFrame(rows, columns=["ts", "confirmed_at", "price", "type"])


def find_zones(bars: pd.DataFrame, asof: pd.Timestamp, lookback_days: int = 20, k: int = 2,
               tolerance_atr: float = 0.5, min_touches: int = 2, min_rejection_atr: float = 1.0,
               timeframe: str = "") -> list[Zone]:
    """Support/resistance zones visible at time `asof` (uses only swings confirmed by then).

    tolerance_atr:      swings within this many ATRs of each other count as the same zone
    min_rejection_atr:  a swing only counts if price moved at least this far away afterwards
    """
    start = asof - pd.Timedelta(days=int(lookback_days * 7 / 5) + 1)
    window = bars[(bars.index >= start) & (bars.index < asof)]
    if len(window) < 2 * k + 3:
        return []
    a = atr(window, n=min(14, len(window) - 1)).iloc[-1]
    if not np.isfinite(a) or a <= 0:
        return []
    swings = swing_points(window, k)
    swings = swings[swings["confirmed_at"] < asof]
    if swings.empty:
        return []

    # Keep swings that were real rejections: price left the level by min_rejection_atr.
    keep = []
    for _, s in swings.iterrows():
        after = window[window.index > s["ts"]]
        if s["type"] == "high":
            moved = s["price"] - after["low"].min() if len(after) else 0
        else:
            moved = after["high"].max() - s["price"] if len(after) else 0
        if moved >= min_rejection_atr * a:
            keep.append(s)
    if not keep:
        return []
    sw = pd.DataFrame(keep).sort_values("price").reset_index(drop=True)

    # Cluster neighbouring swing prices.
    tol = tolerance_atr * a
    clusters, cur = [], [0]
    for i in range(1, len(sw)):
        if sw.loc[i, "price"] - sw.loc[cur[0], "price"] <= tol:  # anchored, so zones can't chain
            cur.append(i)
        else:
            clusters.append(cur)
            cur = [i]
    clusters.append(cur)

    last = window["close"].iloc[-1]
    zones = []
    for c in clusters:
        if len(c) < min_touches:
            continue
        pts = sw.loc[c]
        lo, hi = pts["price"].min(), pts["price"].max()
        types = set(pts["type"])
        kind = "both" if len(types) == 2 else ("resistance" if "high" in types else "support")
        # Relative to the current price a zone above acts as resistance and below as support.
        if kind == "both":
            kind = "resistance" if lo > last else "support" if hi < last else "both"
        zones.append(Zone(lo, hi, kind, len(c), pts["ts"].min(), pts["ts"].max(), timeframe))
    return zones


def merge_timeframes(*zone_lists: list[Zone], tolerance: float = 0.0) -> list[Zone]:
    """Combine zones from several timeframes; overlapping zones merge (touches = the larger count,
    since the same swing usually shows on both timeframes)."""
    allz = sorted([z for zl in zone_lists for z in zl], key=lambda z: z.low)
    merged: list[Zone] = []
    for z in allz:
        if merged and z.low <= merged[-1].high + tolerance:
            m = merged[-1]
            merged[-1] = Zone(min(m.low, z.low), max(m.high, z.high),
                              m.kind if m.kind == z.kind else "both", max(m.touches, z.touches),
                              min(m.first_touch, z.first_touch), max(m.last_touch, z.last_touch),
                              "+".join(sorted(set((m.timeframe + "+" + z.timeframe).split("+")))))
        else:
            merged.append(z)
    return merged
