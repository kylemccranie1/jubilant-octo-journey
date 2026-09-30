"""Fill model: turns an order plus one bar of market data into a fill (or no fill).

Backtests run on 1-minute OHLCV bars, so the true quote path inside a bar is unknown.
Every ambiguity is resolved against the trader:

* Orders decided on a bar's close can only fill from the NEXT bar (no look-ahead).
* Marketable orders fill around the bar's open. Robinhood routes to wholesalers, and its
  Q2 2026 stats show an effective/quoted spread ratio of 24.47%, so a marketable
  order pays ~25% of the half-spread by default rather than the full half-spread.
  Fractional orders are excluded from those stats, so they pay the full half-spread.
* Extended-hours orders go to ECNs: full half-spread, and spreads are wider.
* Resting limit orders fill only when the bar trades THROUGH the limit, not on a touch.
* Stops fill at the stop price plus a full half-spread (they fire into momentum), or at
  the open if the bar gaps through the stop.
* Size is capped at a fraction of bar volume; the rest stays working.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .calendar import Session
from .orders import Order, OrderType, Side


@dataclass
class Bar:
    ts: object          # bar start time (tz-aware, US/Eastern)
    open: float
    high: float
    low: float
    close: float
    volume: float
    session: Session = Session.REGULAR


@dataclass
class FillModelConfig:
    spread_bps: float = 3.0              # assumed quoted spread in regular hours (liquid large caps ~1-5 bps)
    extended_spread_mult: float = 4.0    # spreads widen outside regular hours
    min_half_spread: float = 0.005       # half of a one-cent tick
    eq_ratio: float = 0.2447             # effective/quoted spread for marketable orders (Robinhood Q2 2026)
    fractional_eq_ratio: float = 1.0     # no published price improvement for fractional orders
    participation_cap: float = 0.10      # max share of a bar's volume we can take
    limit_touch_fill_prob: float = 0.0   # chance a limit fills when price only touches it (0 = never)
    stop_extra_half_spreads: float = 1.0 # stop slippage beyond the stop, in half-spreads
    tick: float = 0.01


@dataclass
class FillResult:
    qty: float
    price: float
    reference: float


class BarFillModel:
    def __init__(self, cfg: Optional[FillModelConfig] = None, rng=None):
        self.cfg = cfg or FillModelConfig()
        self.rng = rng

    # ------------------------------------------------------------------
    def half_spread(self, price: float, session: Session) -> float:
        bps = self.cfg.spread_bps
        if session != Session.REGULAR:
            bps *= self.cfg.extended_spread_mult
        return max(price * bps / 20_000, self.cfg.min_half_spread)

    def _marketable_cost(self, order: Order, hs: float, session: Session) -> float:
        """Distance from mid a marketable order pays."""
        if session != Session.REGULAR:
            return hs
        ratio = self.cfg.fractional_eq_ratio if order.is_fractional else self.cfg.eq_ratio
        return ratio * hs

    def _cap(self, qty: float, bar: Bar) -> float:
        if bar.volume <= 0:
            return 0.0
        return min(qty, bar.volume * self.cfg.participation_cap)

    # ------------------------------------------------------------------
    def check_trigger(self, order: Order, bar: Bar) -> Optional[float]:
        """For stop-type orders: returns the price at which the stop triggered in this bar, if any."""
        stop = self.stop_level(order)
        if stop is None:
            return None
        if order.side == Side.BUY:
            if bar.open >= stop:
                return bar.open
            if bar.high >= stop:
                return stop
        else:
            if bar.open <= stop:
                return bar.open
            if bar.low <= stop:
                return stop
        return None

    @staticmethod
    def stop_level(order: Order) -> Optional[float]:
        if order.type in (OrderType.STOP, OrderType.STOP_LIMIT):
            return order.stop_price
        if order.type == OrderType.TRAILING_STOP and order.trail_ref is not None:
            off = order.trail_amount if order.trail_amount is not None else order.trail_ref * order.trail_percent / 100
            return order.trail_ref + off if order.side == Side.BUY else order.trail_ref - off
        return None

    def update_trail(self, order: Order, bar: Bar) -> None:
        """Move a trailing stop's water mark AFTER the bar was checked for a trigger."""
        if order.type != OrderType.TRAILING_STOP:
            return
        if order.trail_ref is None:
            order.trail_ref = bar.close
        elif order.side == Side.SELL:
            order.trail_ref = max(order.trail_ref, bar.high)
        else:
            order.trail_ref = min(order.trail_ref, bar.low)

    # ------------------------------------------------------------------
    def try_fill(self, order: Order, bar: Bar, qty: float) -> Optional[FillResult]:
        """qty is the share quantity still wanted (already resolved for dollar orders)."""
        hs = self.half_spread(bar.open, bar.session)
        sign = 1 if order.side == Side.BUY else -1
        t = order.type

        if t == OrderType.MARKET:
            q = self._cap(qty, bar)
            if q <= 0:
                return None
            price = bar.open + sign * self._marketable_cost(order, hs, bar.session)
            return FillResult(q, self._round(price, order.side), bar.open)

        if t == OrderType.LIMIT or (t == OrderType.STOP_LIMIT and order.triggered):
            return self._limit_fill(order, bar, qty, hs, sign, order.limit_price)

        if t in (OrderType.STOP, OrderType.TRAILING_STOP, OrderType.STOP_LIMIT):
            trig = self.check_trigger(order, bar)
            if trig is None:
                return None
            order.triggered = True
            if t == OrderType.STOP_LIMIT:
                # Becomes a limit order at the trigger price level.
                start = trig + sign * hs
                lim = order.limit_price
                if (order.side == Side.BUY and start <= lim) or (order.side == Side.SELL and start >= lim):
                    q = self._cap(qty, bar)
                    return FillResult(q, self._round(start, order.side), trig) if q > 0 else None
                return self._limit_fill(order, bar, qty, hs, sign, lim)
            q = self._cap(qty, bar)
            if q <= 0:
                return None
            price = trig + sign * hs * self.cfg.stop_extra_half_spreads
            # A stop that fires mid-bar can't fill beyond the bar's range.
            price = min(price, bar.high) if order.side == Side.BUY else max(price, bar.low)
            if trig == bar.open:  # gapped through: fill like a market order at the open
                price = bar.open + sign * hs
            return FillResult(q, self._round(price, order.side), trig)

        return None

    def _limit_fill(self, order, bar, qty, hs, sign, lim) -> Optional[FillResult]:
        q = self._cap(qty, bar)
        if q <= 0:
            return None
        # Marketable at the open: the opposing quote is inside our limit.
        open_quote = bar.open + sign * hs
        if (order.side == Side.BUY and open_quote <= lim) or (order.side == Side.SELL and open_quote >= lim):
            price = bar.open + sign * self._marketable_cost(order, hs, bar.session)
            price = min(price, lim) if order.side == Side.BUY else max(price, lim)
            return FillResult(q, self._round(price, order.side), bar.open)
        # Resting: needs a trade through the limit.
        through = bar.low < lim if order.side == Side.BUY else bar.high > lim
        touched = bar.low <= lim if order.side == Side.BUY else bar.high >= lim
        if through or (touched and self._touch_fill()):
            return FillResult(q, lim, lim)
        return None

    def _touch_fill(self) -> bool:
        p = self.cfg.limit_touch_fill_prob
        if p <= 0 or self.rng is None:
            return False
        return self.rng.random() < p

    def _round(self, price: float, side: Side) -> float:
        # Sub-penny price improvement is real for wholesaler fills, so keep 4 decimals.
        return round(price, 4)
