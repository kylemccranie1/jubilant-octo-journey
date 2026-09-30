"""Account ledger: cash, positions, settlement, buying power, margin, fees.

Cash account (Robinhood "Cash"):
    * Long only, trades with settled cash only. Sale proceeds settle T+1.
Margin account (Robinhood Instant/Gold):
    * Leverage and short selling need at least $2,000 of equity.
    * Pattern day trader rule does not apply (FINRA replaced it on 2026-06-04 with
      intraday margin standards); intraday exposure is limited by buying power instead.
    * Reg T initial margin 50%. Maintenance defaults 25% long / 30% short (assumed).
    * Short positions pay a daily borrow fee: value * rate / 360.
    * Negative cash pays margin interest daily: debit * rate / 360.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum


class AccountType(str, Enum):
    CASH = "cash"
    MARGIN = "margin"


@dataclass
class MarginConfig:
    min_equity_for_margin: float = 2000.0
    initial_margin: float = 0.50
    maint_long: float = 0.25          # assumed; Robinhood may set higher per stock
    maint_short: float = 0.30         # assumed
    borrow_rate_annual: float = 0.003 # easy-to-borrow default; hard-to-borrow names cost far more
    margin_rate_annual: float = 0.0575  # assumed Gold-tier rate; check current rate before relying on it


@dataclass
class Position:
    qty: float = 0.0
    avg_cost: float = 0.0
    realized: float = 0.0


@dataclass
class Account:
    type: AccountType = AccountType.CASH
    cash: float = 0.0                 # total cash (settled + unsettled); negative = margin debit
    margin: MarginConfig = field(default_factory=MarginConfig)
    positions: dict = field(default_factory=dict)       # symbol -> Position
    unsettled: list = field(default_factory=list)       # [(settle_date, amount)]
    marks: dict = field(default_factory=dict)           # symbol -> last price
    reserved: float = 0.0                                # buying power held by open buy/short orders
    fees_paid: float = 0.0
    interest_paid: float = 0.0
    borrow_paid: float = 0.0

    # --- valuation ----------------------------------------------------
    def position(self, symbol: str) -> Position:
        return self.positions.setdefault(symbol, Position())

    def long_value(self) -> float:
        return sum(p.qty * self.marks.get(s, p.avg_cost) for s, p in self.positions.items() if p.qty > 0)

    def short_value(self) -> float:
        return sum(-p.qty * self.marks.get(s, p.avg_cost) for s, p in self.positions.items() if p.qty < 0)

    def equity(self) -> float:
        return self.cash + self.long_value() - self.short_value()

    def unsettled_cash(self) -> float:
        return sum(a for _, a in self.unsettled)

    def settled_cash(self) -> float:
        return self.cash - self.unsettled_cash()

    # --- buying power -------------------------------------------------
    def margin_enabled(self) -> bool:
        return self.type == AccountType.MARGIN and self.equity() >= self.margin.min_equity_for_margin

    def buying_power(self) -> float:
        if self.type == AccountType.CASH:
            return max(self.settled_cash() - self.reserved, 0.0)
        if not self.margin_enabled():
            # Margin account under $2k: no leverage, but unsettled proceeds are usable.
            return max(self.cash - self.reserved, 0.0)
        gross = self.long_value() + self.short_value()
        return max(self.equity() / self.margin.initial_margin - gross - self.reserved, 0.0)

    def can_short(self) -> bool:
        return self.margin_enabled()

    def maintenance_requirement(self) -> float:
        return self.long_value() * self.margin.maint_long + self.short_value() * self.margin.maint_short

    def margin_deficit(self) -> float:
        if self.type == AccountType.CASH:
            return 0.0
        return max(self.maintenance_requirement() - self.equity(), 0.0)

    # --- bookkeeping --------------------------------------------------
    def apply_fill(self, symbol: str, side: str, qty: float, price: float, fees: float,
                   trade_date: date, settle_date: date) -> float:
        """Updates cash and position. Returns realized P&L of this fill (after fees)."""
        pos = self.position(symbol)
        signed = qty if side == "buy" else -qty
        cash_delta = -signed * price - fees
        self.cash += cash_delta
        self.fees_paid += fees
        if cash_delta > 0:
            # Sale proceeds are unsettled until T+1.
            self.unsettled.append((settle_date, cash_delta))

        realized = 0.0
        if pos.qty == 0 or (pos.qty > 0) == (signed > 0):
            new_qty = pos.qty + signed
            pos.avg_cost = (pos.avg_cost * abs(pos.qty) + price * abs(signed)) / abs(new_qty)
            pos.qty = new_qty
        else:
            closing = min(abs(signed), abs(pos.qty))
            direction = 1 if pos.qty > 0 else -1
            realized = closing * (price - pos.avg_cost) * direction
            new_qty = pos.qty + signed
            if abs(new_qty) < 1e-9:
                pos.qty, pos.avg_cost = 0.0, 0.0
            elif (new_qty > 0) == (pos.qty > 0):
                pos.qty = new_qty
            else:  # flipped through zero
                pos.qty, pos.avg_cost = new_qty, price
        realized -= fees
        pos.realized += realized
        self.marks[symbol] = price
        return realized

    def settle(self, today: date) -> None:
        self.unsettled = [(d, a) for d, a in self.unsettled if d > today]

    def accrue_daily(self, days: int = 1) -> None:
        """Charge borrow fees on shorts and interest on margin debit for `days` calendar days."""
        if self.type != AccountType.MARGIN:
            return
        borrow = self.short_value() * self.margin.borrow_rate_annual / 360 * days
        interest = max(-self.cash, 0.0) * self.margin.margin_rate_annual / 360 * days
        self.cash -= borrow + interest
        self.borrow_paid += borrow
        self.interest_paid += interest
