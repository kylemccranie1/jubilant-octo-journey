"""Round-trip trade journal built from fills.

A trade opens when a position leaves zero and closes when it returns to zero. The
strategy can attach a feature snapshot (volatility, level type, ...) at entry so that
filters can be evaluated later, and the tracker records the maximum adverse and
favourable excursion (MAE/MFE) while the trade is open to help design exits.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import pandas as pd


@dataclass
class Trade:
    symbol: str
    direction: int                  # +1 long, -1 short
    entry_ts: pd.Timestamp
    entry_price: float = 0.0
    qty: float = 0.0
    exit_ts: Optional[pd.Timestamp] = None
    exit_price: float = 0.0
    fees: float = 0.0
    gross_pnl: float = 0.0
    mae: float = 0.0               # worst price move against the trade, per share
    mfe: float = 0.0               # best price move in favour, per share
    risk_per_share: float = 0.0    # distance to the initial stop, if the strategy set one
    entry_tag: str = ""
    exit_tag: str = ""
    features: dict = field(default_factory=dict)
    _cost: float = 0.0
    _exit_qty: float = 0.0
    _exit_value: float = 0.0

    @property
    def net_pnl(self) -> float:
        return self.gross_pnl - self.fees

    @property
    def return_pct(self) -> float:
        notional = self.entry_price * self.qty
        return 100 * self.net_pnl / notional if notional else 0.0

    @property
    def r_multiple(self) -> float:
        if self.risk_per_share <= 0 or self.qty <= 0:
            return float("nan")
        return self.net_pnl / (self.risk_per_share * self.qty)


class TradeTracker:
    def __init__(self):
        self.open: dict[str, Trade] = {}
        self.closed: list[Trade] = []
        self.pending_features: dict[str, dict] = {}
        self.pending_risk: dict[str, float] = {}

    def annotate_next_entry(self, symbol: str, features: dict, risk_per_share: float = 0.0) -> None:
        self.pending_features[symbol] = dict(features)
        self.pending_risk[symbol] = risk_per_share

    def on_fill(self, f, position_after: float) -> None:
        signed = f.qty if f.side.value == "buy" else -f.qty
        t = self.open.get(f.symbol)
        if t is None:
            t = Trade(f.symbol, 1 if signed > 0 else -1, f.ts, entry_tag=f.tag,
                      features=self.pending_features.pop(f.symbol, {}),
                      risk_per_share=self.pending_risk.pop(f.symbol, 0.0))
            self.open[f.symbol] = t
        t.fees += f.fees
        if (signed > 0) == (t.direction > 0):
            t._cost += f.qty * f.price
            t.qty += f.qty
            t.entry_price = t._cost / t.qty
        else:
            t._exit_qty += f.qty
            t._exit_value += f.qty * f.price
            t.exit_price = t._exit_value / t._exit_qty
            t.exit_ts, t.exit_tag = f.ts, f.tag
        if abs(position_after) < 1e-9:
            t.gross_pnl = t.direction * (t._exit_value - t.entry_price * t._exit_qty)
            self.closed.append(t)
            del self.open[f.symbol]

    def on_bar(self, symbol: str, bar) -> None:
        t = self.open.get(symbol)
        if t is None or t.qty == 0:
            return
        if t.direction > 0:
            t.mae = max(t.mae, t.entry_price - bar.low)
            t.mfe = max(t.mfe, bar.high - t.entry_price)
        else:
            t.mae = max(t.mae, bar.high - t.entry_price)
            t.mfe = max(t.mfe, t.entry_price - bar.low)

    def to_frame(self) -> pd.DataFrame:
        rows = []
        for t in self.closed:
            r = {"symbol": t.symbol, "direction": t.direction, "entry_ts": t.entry_ts, "exit_ts": t.exit_ts,
                 "entry_price": t.entry_price, "exit_price": t.exit_price, "qty": t.qty, "fees": t.fees,
                 "net_pnl": t.net_pnl, "return_pct": t.return_pct, "r_multiple": t.r_multiple,
                 "mae": t.mae, "mfe": t.mfe, "entry_tag": t.entry_tag, "exit_tag": t.exit_tag}
            r.update({f"f_{k}": v for k, v in t.features.items()})
            rows.append(r)
        return pd.DataFrame(rows)
