"""Level trading: fade a level (bet it holds) or trade the break (bet it fails).

One base class, two ways of finding levels:
    DailyWeeklyLevels  - previous day and week highs/lows              (strategy 1)
    SupportResistance  - zones tested and rejected on 1h/4h bars, <1mo (strategy 2)

Mode decides fade vs break:
    "fade"       always bet the level holds
    "break"      always bet the level breaks
    "vol_gated"  fade when volatility is low, trade the break when it is high

Every entry records a feature snapshot so filters can be compared afterwards
(see trade_sim.analysis.filter_report). Exits are parameters because they are part of
strategy development: ATR-based stop and target, end-of-day flatten, max holding days.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import time
from typing import Optional

import numpy as np
import pandas as pd

from .. import levels as lv
from ..calendar import ET, Session
from ..engine import Context, Strategy
from ..orders import Order, OrderType, Side, TimeInForce


@dataclass
class Level:
    name: str              # e.g. "pdl", "pwh", "zone"
    kind: str              # "support" (below price) or "resistance" (above price)
    edge: float            # the price a fade enters at (near edge of the zone)
    far: float             # the far edge; break entries and fade stops sit beyond it
    extra: dict = field(default_factory=dict)


@dataclass
class LevelParams:
    mode: str = "vol_gated"
    vol_threshold_pct: float = 50.0     # ATR percentile at or above which volatility counts as "high"
    allow_short: bool = True            # needs a margin account with $2,000+
    stop_atr: float = 0.5               # stop distance beyond the level, in daily ATRs
    target_atr: float = 1.0             # profit target distance from entry, in daily ATRs
    break_buffer_atr: float = 0.05      # break entries trigger this far beyond the level
    exit_eod: bool = True
    max_hold_days: int = 5              # used when exit_eod is False
    risk_per_trade: float = 0.01        # fraction of equity lost if the stop is hit
    max_position_frac: float = 0.5      # cap on position value as a fraction of buying power
    entry_start: time = time(9, 35)
    entry_end: time = time(15, 30)
    flatten_at: time = time(15, 55)
    one_trade_per_level_per_day: bool = True


class LevelTrader(Strategy):
    def __init__(self, symbol: str, params: Optional[LevelParams] = None):
        self.symbol = symbol
        self.p = params or LevelParams()
        self.levels: list[Level] = []
        self.used: set = set()
        self.day_features: dict = {}
        self.entry_group = None
        self.exit_group = None
        self.stop_price = None
        self.target_price = None
        self.entry_day = None
        self.pending_entry_level: dict[int, Level] = {}

    # --- hooks for subclasses -------------------------------------------
    def find_levels(self, ctx: Context, day, ref_price: float) -> list[Level]:
        raise NotImplementedError

    # --- setup ------------------------------------------------------------
    def on_start(self, ctx: Context) -> None:
        df = ctx.data[self.symbol]
        self.minute = df
        self.daily = lv.daily_bars(df)
        a = lv.atr(self.daily, 14)
        # Everything known at a day's open comes from the previous day's close.
        self.daily_feat = pd.DataFrame({
            "atr": a.shift(1),
            "atr_pct": lv.rolling_percentile(a, 252).shift(1),
            "rv20": lv.realized_vol(self.daily, 20).shift(1),
            "sma20": self.daily["close"].rolling(20).mean().shift(1),
            "prev_close": self.daily["close"].shift(1),
            "avg_vol20": self.daily["volume"].rolling(20).mean().shift(1),
        })
        self._day_vol = 0.0

    def on_day_start(self, ctx: Context, day) -> None:
        self.levels, self.used = [], set()
        self._day_vol = 0.0
        self._levels_ready = False
        self._today = day

    def _prepare_levels(self, ctx: Context, open_price: float) -> None:
        day = self._today
        self._levels_ready = True
        if day not in self.daily_feat.index:
            return
        f = self.daily_feat.loc[day]
        if not np.isfinite(f["atr"]):
            return
        self.day_features = {
            "atr_pct": f["atr_pct"],
            "rv20": f["rv20"],
            "gap_atr": (open_price - f["prev_close"]) / f["atr"],
            "trend_atr": (f["prev_close"] - f["sma20"]) / f["atr"] if np.isfinite(f["sma20"]) else np.nan,
            "weekday": pd.Timestamp(day).day_name()[:3],
        }
        self.atr = f["atr"]
        self.avg_vol = f["avg_vol20"]
        self.levels = self.find_levels(ctx, day, open_price)

    def _mode_today(self) -> str:
        if self.p.mode != "vol_gated":
            return self.p.mode
        pct = self.day_features.get("atr_pct", np.nan)
        if not np.isfinite(pct):
            return "none"
        return "break" if pct >= self.p.vol_threshold_pct else "fade"

    # --- bar loop ---------------------------------------------------------
    def on_bar(self, ctx: Context, symbol: str, bar) -> None:
        if symbol != self.symbol or bar.session != Session.REGULAR:
            return
        if not self._levels_ready:
            self._prepare_levels(ctx, bar.open)
        self._day_vol += bar.volume
        t = bar.ts.tz_convert(ET).time()
        pos = ctx.account.position(self.symbol).qty
        broker = ctx.broker

        if pos != 0:
            self._manage_open(ctx, bar, t, pos)
            return
        if self.exit_group:  # flat again: clean up leftovers
            broker.cancel_all(self.symbol)
            self.exit_group = self.entry_group = None
        if not (self.p.entry_start <= t < self.p.entry_end) or not self.levels:
            return
        if not broker.open_orders(self.symbol):
            self._place_entries(ctx, bar)

    def _manage_open(self, ctx, bar, t, pos):
        broker = ctx.broker
        day = bar.ts.tz_convert(ET).date()
        held_days = (day - self.entry_day).days if self.entry_day else 0
        time_exit = (self.p.exit_eod and t >= self.p.flatten_at) or \
                    (not self.p.exit_eod and held_days >= self.p.max_hold_days and t >= self.p.flatten_at)
        if time_exit and not any(o.tag == "time_exit" for o in broker.open_orders(self.symbol)):
            broker.cancel_all(self.symbol)
            side = Side.SELL if pos > 0 else Side.BUY
            broker.submit(Order(self.symbol, side, OrderType.MARKET, qty=abs(pos), tag="time_exit"), bar.ts)

    def _place_entries(self, ctx, bar):
        mode = self._mode_today()
        if mode == "none":
            return
        broker = ctx.broker
        price = bar.close
        self.entry_group = f"entry-{bar.ts.date()}-{bar.ts.hour}{bar.ts.minute}"
        candidates = []
        for lvl in self.levels:
            key = (lvl.name, round(lvl.edge, 4))
            if self.p.one_trade_per_level_per_day and key in self.used:
                continue
            buf = self.p.break_buffer_atr * self.atr
            if mode == "fade":
                if lvl.kind == "support" and price > lvl.edge:
                    candidates.append((lvl, Side.BUY, OrderType.LIMIT, lvl.edge, lvl.far - self.p.stop_atr * self.atr))
                elif lvl.kind == "resistance" and price < lvl.edge and self.p.allow_short:
                    candidates.append((lvl, Side.SELL, OrderType.LIMIT, lvl.edge, lvl.far + self.p.stop_atr * self.atr))
            else:
                if lvl.kind == "resistance" and price < lvl.far:
                    e = lvl.far + buf
                    candidates.append((lvl, Side.BUY, OrderType.STOP, e, lvl.edge - self.p.stop_atr * self.atr))
                elif lvl.kind == "support" and price > lvl.far and self.p.allow_short:
                    e = lvl.far - buf
                    candidates.append((lvl, Side.SELL, OrderType.STOP, e, lvl.edge + self.p.stop_atr * self.atr))
        if not candidates:
            return
        equity = ctx.account.equity()
        bp = ctx.account.buying_power()
        per_order_cap = bp * self.p.max_position_frac / len(candidates)
        for lvl, side, otype, entry, stop in candidates:
            risk = abs(entry - stop)
            if risk <= 0:
                continue
            qty = min(equity * self.p.risk_per_trade / risk, per_order_cap / entry)
            qty = float(np.floor(qty))  # whole shares: stops and shorts need them
            if qty < 1:
                continue
            o = Order(self.symbol, side, otype, qty=qty, tif=TimeInForce.DAY,
                      limit_price=entry if otype == OrderType.LIMIT else None,
                      stop_price=entry if otype == OrderType.STOP else None,
                      tag=f"{'fade' if otype == OrderType.LIMIT else 'break'}:{lvl.name}",
                      oco_group=None)
            o = broker.submit(o, bar.ts)
            if o.is_active:
                self.pending_entry_level[o.id] = (lvl, stop, mode)

    def on_fill(self, ctx: Context, fill) -> None:
        if fill.symbol != self.symbol:
            return
        broker = ctx.broker
        pos = ctx.account.position(self.symbol).qty
        info = self.pending_entry_level.get(fill.order_id)
        if info is not None and abs(pos) > 0:
            lvl, stop, mode = info
            self.used.add((lvl.name, round(lvl.edge, 4)))
            for o in broker.open_orders(self.symbol):  # one entry at a time
                if o.id in self.pending_entry_level and o.id != fill.order_id:
                    broker.cancel(o.id, "another entry filled")
            if fill.order_id in self.pending_entry_level and self.exit_group is None:
                self.entry_day = fill.ts.tz_convert(ET).date()
                direction = 1 if pos > 0 else -1
                self.stop_price = stop
                self.target_price = fill.price + direction * self.p.target_atr * self.atr
                t = ctx.tracker.open.get(self.symbol)
                if t is not None:
                    t.features = {**self.day_features, "mode": mode, "level": lvl.name,
                                  "side": "long" if direction > 0 else "short",
                                  "minute_of_day": fill.ts.tz_convert(ET).hour * 60 + fill.ts.tz_convert(ET).minute,
                                  "rel_volume": self._day_vol / self.avg_vol if self.avg_vol else np.nan,
                                  **lvl.extra}
                    t.risk_per_share = abs(fill.price - stop)
            # Re-place exits for the full position size.
            for o in broker.open_orders(self.symbol):
                if o.oco_group == self.exit_group and self.exit_group:
                    broker.cancel(o.id, "resize exits")
            self.exit_group = f"exit-{fill.order_id}"
            exit_side = Side.SELL if pos > 0 else Side.BUY
            broker.submit(Order(self.symbol, exit_side, OrderType.STOP, qty=abs(pos), stop_price=self.stop_price,
                                tif=TimeInForce.GTC, tag="stop", oco_group=self.exit_group), fill.ts)
            broker.submit(Order(self.symbol, exit_side, OrderType.LIMIT, qty=abs(pos), limit_price=self.target_price,
                                tif=TimeInForce.GTC, tag="target", oco_group=self.exit_group), fill.ts)


# ----------------------------------------------------------------------
class DailyWeeklyLevels(LevelTrader):
    """Strategy 1: previous day and previous week highs and lows."""

    def on_start(self, ctx):
        super().on_start(ctx)
        self.prior = lv.prior_levels(self.daily)

    def find_levels(self, ctx, day, ref_price):
        if day not in self.prior.index:
            return []
        row = self.prior.loc[day]
        out = []
        for name in ("pdh", "pdl", "pwh", "pwl"):
            p = row[name]
            if not np.isfinite(p):
                continue
            kind = "resistance" if p > ref_price else "support"
            out.append(Level(name, kind, p, p, {"level_dist_atr": abs(p - ref_price) / self.atr}))
        return out


class SupportResistance(LevelTrader):
    """Strategy 2: zones tested and rejected at least twice on 1h/4h bars within ~1 month."""

    def __init__(self, symbol, params=None, lookback_days=20, min_touches=2, tolerance_atr=0.5,
                 min_rejection_atr=1.0, max_zones_each_side=1):
        super().__init__(symbol, params)
        self.zkw = dict(lookback_days=lookback_days, min_touches=min_touches,
                        tolerance_atr=tolerance_atr, min_rejection_atr=min_rejection_atr)
        self.max_zones = max_zones_each_side

    def on_start(self, ctx):
        super().on_start(ctx)
        self.h1 = lv.intraday_bars(self.minute, 1)
        self.h4 = lv.intraday_bars(self.minute, 4)

    def find_levels(self, ctx, day, ref_price):
        asof = ctx.now
        z1 = lv.find_zones(self.h1, asof, k=2, timeframe="1h", **self.zkw)
        z4 = lv.find_zones(self.h4, asof, k=1, timeframe="4h", **self.zkw)
        zones = lv.merge_timeframes(z1, z4)
        below = sorted([z for z in zones if z.high < ref_price], key=lambda z: -z.high)[:self.max_zones]
        above = sorted([z for z in zones if z.low > ref_price], key=lambda z: z.low)[:self.max_zones]
        out = []
        for z in below:
            out.append(Level("zone", "support", z.high, z.low, self._extra(z, ref_price)))
        for z in above:
            out.append(Level("zone", "resistance", z.low, z.high, self._extra(z, ref_price)))
        return out

    def _extra(self, z, ref):
        return {"zone_touches": z.touches, "zone_width_atr": (z.high - z.low) / self.atr,
                "zone_tf": z.timeframe, "level_dist_atr": abs(z.mid - ref) / self.atr,
                "zone_age_days": (pd.Timestamp(self._today) - z.last_touch.tz_convert(ET).tz_localize(None).normalize()).days}
