"""Order model matching Robinhood's stock order types."""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import pandas as pd


class Side(str, Enum):
    BUY = "buy"
    SELL = "sell"


class OrderType(str, Enum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"            # becomes a market order when triggered
    STOP_LIMIT = "stop_limit"  # becomes a limit order when triggered
    TRAILING_STOP = "trailing_stop"


class TimeInForce(str, Enum):
    DAY = "gfd"   # good for day: expires at the end of the session it trades in
    GTC = "gtc"   # good til canceled: Robinhood cancels after 90 days


class SessionFlag(str, Enum):
    """Which sessions a limit order may trade in (Robinhood asks this on every limit order)."""
    REGULAR = "regular"
    EXTENDED = "extended"      # pre + regular + post
    ALL_DAY = "24_hour"        # extended + overnight (24 Hour Market symbols only)


class Status(str, Enum):
    QUEUED = "queued"        # waiting for the next regular open
    OPEN = "open"
    PARTIAL = "partially_filled"
    FILLED = "filled"
    CANCELED = "canceled"
    REJECTED = "rejected"
    EXPIRED = "expired"


GTC_MAX_DAYS = 90
_ids = itertools.count(1)


@dataclass
class Order:
    symbol: str
    side: Side
    type: OrderType
    qty: Optional[float] = None          # shares (may be fractional)
    notional: Optional[float] = None     # dollar-based order amount
    limit_price: Optional[float] = None
    stop_price: Optional[float] = None
    trail_amount: Optional[float] = None   # dollars
    trail_percent: Optional[float] = None  # e.g. 2.0 for 2%
    tif: TimeInForce = TimeInForce.DAY
    session_flag: SessionFlag = SessionFlag.REGULAR
    tag: str = ""                        # free text for the strategy (e.g. "entry", "target")
    oco_group: Optional[str] = None      # orders in the same group cancel each other on fill

    id: int = field(default_factory=lambda: next(_ids))
    status: Status = Status.OPEN
    created_at: Optional[pd.Timestamp] = None
    filled_qty: float = 0.0
    avg_fill_price: float = 0.0
    triggered: bool = False
    trail_ref: Optional[float] = None     # high/low water mark for trailing stops
    reject_reason: str = ""
    reserved: float = 0.0                 # buying power held for this order

    @property
    def remaining(self) -> float:
        if self.qty is None:
            return 0.0
        return max(self.qty - self.filled_qty, 0.0)

    @property
    def is_active(self) -> bool:
        return self.status in (Status.OPEN, Status.PARTIAL, Status.QUEUED)

    @property
    def is_fractional(self) -> bool:
        if self.notional is not None:
            return True
        return self.qty is not None and abs(self.qty - round(self.qty)) > 1e-9


@dataclass
class Fill:
    order_id: int
    symbol: str
    side: Side
    qty: float
    price: float
    fees: float
    ts: pd.Timestamp
    tag: str = ""
    reference_price: float = 0.0   # mid/open used as the benchmark for slippage
