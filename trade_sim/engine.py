"""Backtest loop: replays minute bars through the paper broker and a strategy.

Each bar: the broker first fills orders that were working BEFORE the bar, then the
strategy sees the completed bar and may submit orders, which can fill from the next bar.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import pandas as pd

from .broker import PaperBroker
from .calendar import ET, Session
from .fills import Bar
from .trades import TradeTracker


@dataclass
class Context:
    broker: PaperBroker
    data: dict                     # symbol -> full minute DataFrame (strategies must not peek ahead)
    tracker: TradeTracker
    now: Optional[pd.Timestamp] = None
    today: Optional[object] = None
    equity_curve: list = field(default_factory=list)

    @property
    def account(self):
        return self.broker.account


class Strategy:
    def on_start(self, ctx: Context) -> None: ...
    def on_day_start(self, ctx: Context, day) -> None: ...
    def on_bar(self, ctx: Context, symbol: str, bar: Bar) -> None: ...
    def on_fill(self, ctx: Context, fill) -> None: ...
    def on_day_end(self, ctx: Context, day) -> None: ...


class Backtester:
    def __init__(self, broker: PaperBroker, strategy: Strategy, data: dict[str, pd.DataFrame],
                 regular_hours_only: bool = False):
        self.broker = broker
        self.strategy = strategy
        self.data = data
        self.tracker = TradeTracker()
        self.ctx = Context(broker, data, self.tracker)
        self.regular_hours_only = regular_hours_only

    def run(self, start=None, end=None) -> Context:
        frames = []
        for sym, df in self.data.items():
            d = df
            if self.regular_hours_only:
                d = d[d["session"] == Session.REGULAR.value]
            if start is not None:
                d = d[d.index >= pd.Timestamp(start, tz=ET)]
            if end is not None:
                d = d[d.index < pd.Timestamp(end, tz=ET)]
            frames.append(d.assign(symbol=sym))
        stream = pd.concat(frames).sort_index(kind="stable")

        ctx, broker, strat = self.ctx, self.broker, self.strategy

        def on_fill(f):
            self.tracker.on_fill(f, broker.account.position(f.symbol).qty)
            strat.on_fill(ctx, f)
        broker.on_fill = on_fill

        strat.on_start(ctx)
        cur_day = None
        cols = stream.columns.get_indexer(["open", "high", "low", "close", "volume", "session", "symbol"])
        values = stream.to_numpy()
        for ts, row in zip(stream.index, values):
            o, h, l, c, v, sess, sym = (row[i] for i in cols)
            day = ts.date()
            if day != cur_day:
                if cur_day is not None:
                    strat.on_day_end(ctx, cur_day)
                    ctx.equity_curve.append((cur_day, broker.account.equity()))
                cur_day = day
                ctx.today = day
                broker.now = ts
                broker.start_day(day)
                strat.on_day_start(ctx, day)
            bar = Bar(ts, float(o), float(h), float(l), float(c), float(v), Session(sess))
            ctx.now = ts
            broker.process_bar(sym, bar)
            self.tracker.on_bar(sym, bar)
            strat.on_bar(ctx, sym, bar)
        if cur_day is not None:
            strat.on_day_end(ctx, cur_day)
            ctx.equity_curve.append((cur_day, broker.account.equity()))
        return ctx
