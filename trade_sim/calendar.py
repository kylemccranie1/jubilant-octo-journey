"""NYSE trading calendar and Robinhood trading sessions.

Sessions (US/Eastern):
    pre        07:00 - open      (Robinhood extended hours start at 7:00, not 4:00)
    regular    open  - close     (09:30 - 16:00, early closes at 13:00)
    post       close - 20:00
    overnight  20:00 - 07:00     (Robinhood 24 Hour Market, select symbols, Sun-Fri nights)

Fractional shares trade in extended hours only 07:00-09:30 and 16:00-19:30.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from enum import Enum
from functools import lru_cache

import pandas as pd
import pandas_market_calendars as mcal

ET = "America/New_York"

PRE_OPEN = time(7, 0)
POST_CLOSE = time(20, 0)
FRACTIONAL_POST_CLOSE = time(19, 30)


class Session(str, Enum):
    PRE = "pre"
    REGULAR = "regular"
    POST = "post"
    OVERNIGHT = "overnight"
    CLOSED = "closed"


@lru_cache(maxsize=None)
def _schedule(start_year: int, end_year: int) -> pd.DataFrame:
    cal = mcal.get_calendar("NYSE")
    sched = cal.schedule(start_date=f"{start_year}-01-01", end_date=f"{end_year}-12-31")
    sched["market_open"] = sched["market_open"].dt.tz_convert(ET)
    sched["market_close"] = sched["market_close"].dt.tz_convert(ET)
    sched.index = sched.index.date
    return sched


class TradingCalendar:
    """Answers "is the market open", "which session is this", and settlement dates."""

    def __init__(self, start_year: int = 2015, end_year: int = 2030):
        self.sched = _schedule(start_year, end_year)
        self._days = list(self.sched.index)
        self._day_set = set(self._days)

    # --- days -------------------------------------------------------------
    def is_trading_day(self, d: date) -> bool:
        return d in self._day_set

    def trading_days(self, start: date, end: date) -> list[date]:
        return [d for d in self._days if start <= d <= end]

    def next_trading_day(self, d: date, n: int = 1) -> date:
        """The n-th trading day strictly after d."""
        cur = d
        while n > 0:
            cur += timedelta(days=1)
            if cur in self._day_set:
                n -= 1
        return cur

    def prev_trading_day(self, d: date) -> date:
        cur = d - timedelta(days=1)
        while cur not in self._day_set:
            cur -= timedelta(days=1)
        return cur

    def settlement_date(self, trade_date: date) -> date:
        """US equities settle T+1 business day."""
        return self.next_trading_day(trade_date, 1)

    def open_close(self, d: date) -> tuple[pd.Timestamp, pd.Timestamp]:
        row = self.sched.loc[d]
        return row["market_open"], row["market_close"]

    # --- sessions ---------------------------------------------------------
    def session(self, ts: pd.Timestamp) -> Session:
        ts = _to_et(ts)
        d = ts.date()
        t = ts.time()
        if self.is_trading_day(d):
            open_, close = self.open_close(d)
            if open_ <= ts < close:
                return Session.REGULAR
            if PRE_OPEN <= t and ts < open_:
                return Session.PRE
            if close <= ts and t < POST_CLOSE:
                return Session.POST
        # Overnight: after 20:00 on a day followed by a trading day, or before 07:00 on a trading day.
        if t >= POST_CLOSE and self.is_trading_day(d + timedelta(days=1)):
            return Session.OVERNIGHT
        if t < PRE_OPEN and self.is_trading_day(d):
            return Session.OVERNIGHT
        return Session.CLOSED

    def fractional_extended_ok(self, ts: pd.Timestamp) -> bool:
        ts = _to_et(ts)
        s = self.session(ts)
        if s == Session.PRE:
            return True
        if s == Session.POST:
            return ts.time() < FRACTIONAL_POST_CLOSE
        return False

    def next_regular_open(self, ts: pd.Timestamp) -> pd.Timestamp:
        ts = _to_et(ts)
        d = ts.date()
        if self.is_trading_day(d):
            open_, _ = self.open_close(d)
            if ts < open_:
                return open_
        return self.open_close(self.next_trading_day(d))[0]


def _to_et(ts) -> pd.Timestamp:
    ts = pd.Timestamp(ts)
    if ts.tzinfo is None:
        return ts.tz_localize(ET)
    return ts.tz_convert(ET)
