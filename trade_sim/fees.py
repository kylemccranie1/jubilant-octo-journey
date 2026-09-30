"""Robinhood stock/ETF fees. Commission is $0; regulatory fees are passed through.

Source: https://robinhood.com/us/en/support/articles/trading-fees-on-robinhood (checked 2026-09-30)
    SEC Section 31: $20.60 per $1M of sell proceeds (from 2026-04-04), waived for sales <= $500
    FINRA TAF:      $0.000195/share on sells, rounded to the cent, max $9.79, waived for <= 50 shares
    CAT:            $0.000003/share on buys and sells; rounds down to $0 if under $0.01
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal


@dataclass(frozen=True)
class FeeSchedule:
    sec_rate_per_million: float = 20.60
    sec_waiver_max_proceeds: float = 500.0
    taf_per_share: float = 0.000195
    taf_max: float = 9.79
    taf_waiver_max_shares: float = 50
    cat_per_share: float = 0.000003
    commission: float = 0.0

    def sec_fee(self, proceeds: float) -> float:
        if proceeds <= self.sec_waiver_max_proceeds:
            return 0.0
        return _round_cents(proceeds * self.sec_rate_per_million / 1_000_000)

    def taf_fee(self, shares: float) -> float:
        if shares <= self.taf_waiver_max_shares:
            return 0.0
        return min(_round_cents(shares * self.taf_per_share), self.taf_max)

    def cat_fee(self, shares: float) -> float:
        raw = shares * self.cat_per_share
        if raw < 0.01:
            return 0.0
        return _round_cents(raw)

    def total(self, side: str, shares: float, price: float) -> float:
        """Total fees for one fill. side is 'buy' or 'sell' (a short sale is a sell)."""
        fee = self.commission + self.cat_fee(shares)
        if side == "sell":
            fee += self.sec_fee(shares * price) + self.taf_fee(shares)
        return round(fee, 2)


def _round_cents(x: float) -> float:
    return float(Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


ROBINHOOD_2026 = FeeSchedule()
