"""Paper broker that enforces Robinhood's stock order rules and fills orders against bars."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Callable, Optional

import pandas as pd

from .account import Account, AccountType
from .calendar import Session, TradingCalendar, POST_CLOSE, ET
from .fees import FeeSchedule, ROBINHOOD_2026
from .fills import Bar, BarFillModel
from .orders import (GTC_MAX_DAYS, Fill, Order, OrderType, SessionFlag, Side, Status,
                     TimeInForce)

QUEUED_MARKET_BUFFER = 1.05     # Robinhood over-reserves 5% for market buys queued for the open
DOLLAR_SELL_MAX_FRACTION = 0.95  # dollar-based sells can sell at most 95% of a position
FRACTIONAL_TYPES = (OrderType.MARKET, OrderType.LIMIT)  # assumed; stops need whole shares


@dataclass
class BrokerConfig:
    overnight_symbols: Optional[set] = None   # symbols on the 24 Hour Market; None = all
    fractional_extended_symbols: Optional[set] = None  # None = all eligible
    liquidate_on_margin_deficit: bool = True


@dataclass
class Event:
    ts: pd.Timestamp
    kind: str
    detail: str


class PaperBroker:
    def __init__(self, account: Account, calendar: Optional[TradingCalendar] = None,
                 fill_model: Optional[BarFillModel] = None, fees: FeeSchedule = ROBINHOOD_2026,
                 config: Optional[BrokerConfig] = None):
        self.account = account
        self.cal = calendar or TradingCalendar()
        self.fill_model = fill_model or BarFillModel()
        self.fees = fees
        self.cfg = config or BrokerConfig()
        self.orders: dict[int, Order] = {}
        self._active: dict[int, Order] = {}
        self.fills: list[Fill] = []
        self.events: list[Event] = []
        self.now: Optional[pd.Timestamp] = None
        self.current_day = None
        self.on_fill: Optional[Callable[[Fill], None]] = None
        self._expiry: dict[int, pd.Timestamp] = {}

    # ==================================================================
    # Order entry
    # ==================================================================
    def submit(self, order: Order, now: Optional[pd.Timestamp] = None) -> Order:
        now = pd.Timestamp(now) if now is not None else self.now
        order.created_at = now
        self.orders[order.id] = order
        self._active[order.id] = order
        reason = self._validate(order, now)
        if reason:
            return self._reject(order, reason)

        session = self.cal.session(now)
        needs_regular = order.type != OrderType.LIMIT
        if needs_regular and session != Session.REGULAR:
            order.status = Status.QUEUED
        self._expiry[order.id] = self._expiry_time(order, now)

        reserve = self._reserve_needed(order)
        if reserve > 0:
            if reserve > self.account.buying_power() + 1e-9:
                return self._reject(order, f"insufficient buying power (need {reserve:.2f})")
            order.reserved = reserve
            self.account.reserved += reserve
        self._log(now, "submit", f"#{order.id} {order.side.value} {order.type.value} {order.symbol} "
                                 f"qty={order.qty} notional={order.notional} lim={order.limit_price} stop={order.stop_price}")
        return order

    def cancel(self, order_id: int, reason: str = "canceled") -> None:
        o = self.orders.get(order_id)
        if o and o.is_active:
            o.status = Status.CANCELED
            self._release(o)
            self._log(self.now, "cancel", f"#{o.id} {reason}")

    def cancel_all(self, symbol: Optional[str] = None) -> None:
        for o in list(self.orders.values()):
            if o.is_active and (symbol is None or o.symbol == symbol):
                self.cancel(o.id)

    def open_orders(self, symbol: Optional[str] = None) -> list[Order]:
        out = []
        for oid, o in list(self._active.items()):
            if not o.is_active:
                del self._active[oid]
            elif symbol is None or o.symbol == symbol:
                out.append(o)
        return out

    # ------------------------------------------------------------------
    def _validate(self, o: Order, now) -> str:
        if (o.qty is None) == (o.notional is None):
            return "specify exactly one of qty or notional"
        if (o.qty is not None and o.qty <= 0) or (o.notional is not None and o.notional <= 0):
            return "quantity must be positive"
        if o.type in (OrderType.LIMIT, OrderType.STOP_LIMIT) and o.limit_price is None:
            return "limit price required"
        if o.type in (OrderType.STOP, OrderType.STOP_LIMIT) and o.stop_price is None:
            return "stop price required"
        if o.type == OrderType.TRAILING_STOP and o.trail_amount is None and o.trail_percent is None:
            return "trail amount or percent required"
        if o.type == OrderType.MARKET and o.tif == TimeInForce.GTC:
            return "market orders are good-for-day only"
        if o.type != OrderType.LIMIT and o.session_flag != SessionFlag.REGULAR:
            return "only limit orders can trade outside regular hours"
        if o.is_fractional and o.type not in FRACTIONAL_TYPES:
            return "fractional/dollar orders must be market or limit"
        if o.session_flag == SessionFlag.ALL_DAY and self.cfg.overnight_symbols is not None \
                and o.symbol not in self.cfg.overnight_symbols:
            return f"{o.symbol} is not on the 24 Hour Market"

        pos = self.account.position(o.symbol).qty
        if o.side == Side.SELL:
            if o.notional is not None:
                mark = self.account.marks.get(o.symbol, 0.0)
                if pos <= 0 or o.notional > pos * mark * DOLLAR_SELL_MAX_FRACTION:
                    return "dollar-based sells are limited to 95% of the position"
            elif o.qty > pos + 1e-9:
                if not self.account.can_short():
                    return "short selling needs a margin account with $2,000+ equity" \
                        if self.account.type == AccountType.MARGIN else "cash accounts cannot sell short"
                if o.is_fractional:
                    return "short sales must be whole shares"
                if o.tif != TimeInForce.DAY:
                    return "opening short orders must be good-for-day"
                if o.session_flag == SessionFlag.ALL_DAY:
                    return "shorts cannot be opened in the 24 Hour Market"
        return ""

    def _reject(self, o: Order, reason: str) -> Order:
        o.status = Status.REJECTED
        o.reject_reason = reason
        self._log(o.created_at, "reject", f"#{o.id} {reason}")
        return o

    def _est_price(self, o: Order) -> float:
        return o.limit_price or o.stop_price or self.account.marks.get(o.symbol) or 0.0

    def _reserve_needed(self, o: Order) -> float:
        """Buying power to hold for buys and for sells that open a short. The part of a buy
        that covers an existing short reduces risk, so it needs none."""
        price = self._est_price(o)
        if o.side == Side.BUY:
            cover = max(-self.account.position(o.symbol).qty, 0.0) * price
            amt = o.notional if o.notional is not None else (o.qty or 0) * price
            amt = max(amt - cover, 0.0)
        else:
            pos = max(self.account.position(o.symbol).qty, 0.0)
            short_qty = max((o.qty or 0) - pos, 0.0)
            amt = short_qty * price
        if o.type == OrderType.MARKET and o.status == Status.QUEUED and o.side == Side.BUY:
            amt *= QUEUED_MARKET_BUFFER
        return amt

    def _release(self, o: Order, fraction: float = 1.0) -> None:
        amt = o.reserved * fraction
        o.reserved -= amt
        self.account.reserved = max(self.account.reserved - amt, 0.0)

    def _expiry_time(self, o: Order, now: pd.Timestamp) -> pd.Timestamp:
        if o.tif == TimeInForce.GTC:
            return now + timedelta(days=GTC_MAX_DAYS)
        # Good-for-day: expires at the end of the session day it will trade in.
        d = now.tz_convert(ET).date()
        if not self.cal.is_trading_day(d) or (now >= self.cal.open_close(d)[1] and
                                              o.session_flag == SessionFlag.REGULAR) \
                or now.tz_convert(ET).time() >= POST_CLOSE:
            d = self.cal.next_trading_day(d)
        close = self.cal.open_close(d)[1]
        if o.session_flag == SessionFlag.REGULAR:
            return close
        return pd.Timestamp.combine(d, POST_CLOSE).tz_localize(ET)

    # ==================================================================
    # Market data
    # ==================================================================
    def start_day(self, d) -> None:
        """Call once per trading day before its first bar: settlement, interest, margin checks."""
        if self.current_day is not None:
            days = (d - self.current_day).days
            self.account.accrue_daily(days)
        self.current_day = d
        self.account.settle(d)
        deficit = self.account.margin_deficit()
        if deficit > 0 and self.cfg.liquidate_on_margin_deficit:
            self._log(self.now, "margin_call", f"deficit {deficit:.2f}; liquidating at the open")
            self._liquidate()

    def _liquidate(self) -> None:
        by_size = sorted(self.account.positions.items(),
                         key=lambda kv: -abs(kv[1].qty) * self.account.marks.get(kv[0], 0))
        for sym, pos in by_size:
            if abs(pos.qty) < 1e-9:
                continue
            self.cancel_all(sym)
            side = Side.SELL if pos.qty > 0 else Side.BUY
            o = Order(sym, side, OrderType.MARKET, qty=abs(pos.qty), tag="margin_call")
            o.created_at = self.now
            o.status = Status.QUEUED
            self.orders[o.id] = o
            self._active[o.id] = o
            self._expiry[o.id] = pd.Timestamp.max.tz_localize("UTC")
            break  # one position at a time; re-checked the next day

    def process_bar(self, symbol: str, bar: Bar) -> list[Fill]:
        ts = pd.Timestamp(bar.ts)
        self.now = ts
        new_fills: list[Fill] = []

        for o in self.open_orders(symbol):
            if ts >= self._expiry.get(o.id, ts + timedelta(days=1)):
                o.status = Status.EXPIRED
                self._release(o)
                self._log(ts, "expire", f"#{o.id}")

        if bar.session == Session.REGULAR:
            for o in self.open_orders(symbol):
                if o.status == Status.QUEUED:
                    o.status = Status.OPEN

        # Stops first so a bar that hits both a stop and a target counts as a loss.
        priority = {OrderType.STOP: 0, OrderType.TRAILING_STOP: 0, OrderType.STOP_LIMIT: 1,
                    OrderType.MARKET: 2, OrderType.LIMIT: 3}
        for o in sorted(self.open_orders(symbol), key=lambda x: (priority[x.type], x.id)):
            if not o.is_active or o.status == Status.QUEUED:
                continue
            if not self._session_ok(o, bar):
                continue
            f = self._try(o, bar)
            if f:
                new_fills.append(f)
            else:
                self.fill_model.update_trail(o, bar)

        self.account.marks[symbol] = bar.close
        return new_fills

    def _session_ok(self, o: Order, bar: Bar) -> bool:
        s = bar.session
        if s == Session.REGULAR:
            return True
        if o.type != OrderType.LIMIT:
            return False
        if s in (Session.PRE, Session.POST):
            if o.session_flag == SessionFlag.REGULAR:
                return False
            if o.is_fractional and not self.cal.fractional_extended_ok(bar.ts):
                return False
            return True
        if s == Session.OVERNIGHT:
            return o.session_flag == SessionFlag.ALL_DAY and not o.is_fractional
        return False

    def _try(self, o: Order, bar: Bar) -> Optional[Fill]:
        pos = self.account.position(o.symbol).qty
        # Resolve quantity.
        if o.notional is not None:
            if o.qty is None:
                o.qty = round(o.notional / bar.open, 6)
                if o.side == Side.SELL:
                    o.qty = min(o.qty, pos * DOLLAR_SELL_MAX_FRACTION)
        want = o.remaining
        if o.side == Side.SELL and self.account.type == AccountType.CASH:
            want = min(want, max(pos, 0.0))
            if want <= 1e-9:
                self.cancel(o.id, "no shares left to sell")
                return None

        res = self.fill_model.try_fill(o, bar, want)
        if res is None or res.qty <= 1e-9:
            return None

        q, price = res.qty, res.price
        # Buying power check at fill time for entries (price may have gapped).
        if (o.side == Side.BUY and q > max(-pos, 0)) or (o.side == Side.SELL and q > max(pos, 0)):
            opening_value = (q - max(-pos, 0)) * price if o.side == Side.BUY else (q - max(pos, 0)) * price
            available = self.account.buying_power() + o.reserved
            if opening_value > available + 1e-6:
                self.cancel(o.id, "insufficient buying power at fill")
                return None

        side = o.side.value
        fee = self.fees.total(side, q, price)
        trade_date = pd.Timestamp(bar.ts).tz_convert(ET).date()
        settle = self.cal.settlement_date(trade_date) if self.cal.is_trading_day(trade_date) \
            else self.cal.next_trading_day(trade_date)
        fraction = q / o.remaining if o.remaining > 0 else 1.0
        self._release(o, fraction)
        self.account.apply_fill(o.symbol, side, q, price, fee, trade_date, settle)

        o.avg_fill_price = (o.avg_fill_price * o.filled_qty + price * q) / (o.filled_qty + q)
        o.filled_qty += q
        o.status = Status.FILLED if o.remaining <= 1e-9 else Status.PARTIAL
        fill = Fill(o.id, o.symbol, o.side, q, price, fee, pd.Timestamp(bar.ts), o.tag, res.reference)
        self.fills.append(fill)
        self._log(bar.ts, "fill", f"#{o.id} {side} {q:g} {o.symbol} @ {price:.4f} fee={fee:.2f} [{o.tag}]")

        if o.oco_group:
            for sib in self.open_orders(o.symbol):
                if sib.oco_group == o.oco_group and sib.id != o.id:
                    if o.status == Status.FILLED:
                        self.cancel(sib.id, f"oco with #{o.id}")
                    elif sib.qty is not None:
                        sib.qty = max(sib.qty - q, sib.filled_qty)
        if self.on_fill:
            self.on_fill(fill)
        return fill

    def _log(self, ts, kind, detail):
        self.events.append(Event(ts, kind, detail))
