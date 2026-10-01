import pandas as pd

from trade_sim.account import Account, AccountType
from trade_sim.analysis import equity_stats, summarize
from trade_sim.broker import PaperBroker
from trade_sim.calendar import Session, TradingCalendar
from trade_sim.data import synthetic_minute_bars
from trade_sim.engine import Backtester, Strategy
from trade_sim.orders import Order, OrderType, Side


class BuyAndHold(Strategy):
    """Buys 10 shares on the first regular-session bar and never sells."""

    def __init__(self, symbol):
        self.symbol = symbol
        self.sent = False

    def on_bar(self, ctx, symbol, bar):
        if not self.sent and bar.session == Session.REGULAR:
            ctx.broker.submit(Order(symbol, Side.BUY, OrderType.MARKET, qty=10), bar.ts)
            self.sent = True


def _run(close_at_end=True):
    df = synthetic_minute_bars("2024-03-01", "2024-03-29", seed=1, extended=False)
    broker = PaperBroker(Account(AccountType.MARGIN, cash=25_000), TradingCalendar(2023, 2025))
    ctx = Backtester(broker, BuyAndHold("X"), {"X": df}, regular_hours_only=True,
                     close_at_end=close_at_end).run()
    return df, broker, ctx


def test_position_open_at_end_of_data_is_closed_and_journaled():
    df, broker, ctx = _run()
    trades = ctx.tracker.to_frame()
    assert len(trades) == 1
    t = trades.iloc[0]
    assert t["entry_tag"] == "" and t["exit_tag"] == "end_of_data"
    assert t["qty"] == 10
    assert broker.account.position("X").qty == 0
    # The exit fills at the last bar's close (plus price improvement), so equity matches the journal.
    assert abs(t["exit_price"] - df["close"].iloc[-1]) < 0.05
    stats = equity_stats(ctx.equity_curve)
    assert abs(broker.account.equity() - 25_000 - trades["net_pnl"].sum()) < 1e-6
    assert summarize(trades)["trades"] == 1
    assert stats["start_equity"] == 25_000           # day one's P&L counts toward returns
    assert abs(stats["end_equity"] - 25_000 - trades["net_pnl"].sum()) < 0.01   # stats round to cents


def test_close_at_end_can_be_turned_off():
    _, broker, ctx = _run(close_at_end=False)
    assert broker.account.position("X").qty == 10
    assert ctx.tracker.to_frame().empty and "X" in ctx.tracker.open
