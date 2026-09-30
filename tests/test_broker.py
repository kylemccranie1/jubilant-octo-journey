import pandas as pd
import pytest

from trade_sim.account import Account, AccountType
from trade_sim.broker import PaperBroker
from trade_sim.calendar import Session, TradingCalendar
from trade_sim.fills import Bar, BarFillModel, FillModelConfig
from trade_sim.orders import Order, OrderType, SessionFlag, Side, Status, TimeInForce

cal = TradingCalendar(2025, 2027)
DAY = pd.Timestamp("2026-09-29").date()


def ts(s):
    return pd.Timestamp(f"2026-09-29 {s}", tz="America/New_York")


def bar(t, o, h, l, c, v=100_000, day="2026-09-29"):
    stamp = pd.Timestamp(f"{day} {t}", tz="America/New_York")
    return Bar(stamp, o, h, l, c, v, cal.session(stamp))


def make(cash=10_000, kind=AccountType.CASH, **fill_kw):
    acct = Account(kind, cash=cash)
    acct.marks["XYZ"] = 100.0
    b = PaperBroker(acct, cal, BarFillModel(FillModelConfig(**fill_kw)))
    b.start_day(DAY)
    return b


def test_market_buy_gets_price_improvement():
    b = make(spread_bps=10)   # half-spread = 100 * 10 / 20000 = $0.05
    b.submit(Order("XYZ", Side.BUY, OrderType.MARKET, qty=10), ts("10:00"))
    fills = b.process_bar("XYZ", bar("10:01", 100, 100.2, 99.9, 100.1))
    assert len(fills) == 1
    # pays ~24.47% of the half-spread above the open, not the full half-spread
    assert fills[0].price == pytest.approx(100 + 0.2447 * 0.05, abs=1e-4)
    assert b.account.position("XYZ").qty == 10


def test_market_order_outside_hours_is_queued_until_open():
    b = make()
    o = b.submit(Order("XYZ", Side.BUY, OrderType.MARKET, qty=10), ts("08:00"))
    assert o.status == Status.QUEUED
    assert o.reserved == pytest.approx(10 * 100 * 1.05)       # 5% extra reserved
    assert b.process_bar("XYZ", bar("08:01", 100, 101, 99, 100)) == []
    assert len(b.process_bar("XYZ", bar("09:30", 100, 101, 99, 100))) == 1


def test_stop_orders_rejected_in_extended_session_flag():
    b = make()
    o = b.submit(Order("XYZ", Side.BUY, OrderType.STOP, qty=1, stop_price=101,
                       session_flag=SessionFlag.EXTENDED), ts("10:00"))
    assert o.status == Status.REJECTED


def test_limit_needs_trade_through_not_touch():
    b = make()
    b.submit(Order("XYZ", Side.BUY, OrderType.LIMIT, qty=10, limit_price=99.0), ts("10:00"))
    assert b.process_bar("XYZ", bar("10:01", 99.5, 99.8, 99.0, 99.4)) == []   # touch only
    f = b.process_bar("XYZ", bar("10:02", 99.4, 99.5, 98.95, 99.2))            # through
    assert len(f) == 1 and f[0].price == 99.0


def test_limit_regular_flag_does_not_trade_premarket():
    b = make()
    b.submit(Order("XYZ", Side.BUY, OrderType.LIMIT, qty=1, limit_price=99.0), ts("07:30"))
    assert b.process_bar("XYZ", bar("07:31", 99, 99, 98, 98.5)) == []
    b2 = make()
    b2.submit(Order("XYZ", Side.BUY, OrderType.LIMIT, qty=1, limit_price=99.0,
                    session_flag=SessionFlag.EXTENDED), ts("07:30"))
    assert len(b2.process_bar("XYZ", bar("07:31", 99, 99, 98, 98.5))) == 1


def test_stop_gap_fills_at_open_not_stop():
    b = make(spread_bps=10)
    b.account.cash = 10_000
    b.submit(Order("XYZ", Side.BUY, OrderType.MARKET, qty=10), ts("10:00"))
    b.process_bar("XYZ", bar("10:01", 100, 100, 100, 100))
    b.submit(Order("XYZ", Side.SELL, OrderType.STOP, qty=10, stop_price=98), ts("10:01"))
    f = b.process_bar("XYZ", bar("10:02", 95, 96, 94, 95))
    assert f[0].price < 95      # gapped through the stop: worse than the stop price


def test_bar_hitting_stop_and_target_counts_as_stop():
    b = make()
    b.submit(Order("XYZ", Side.BUY, OrderType.MARKET, qty=10), ts("10:00"))
    b.process_bar("XYZ", bar("10:01", 100, 100, 100, 100))
    b.submit(Order("XYZ", Side.SELL, OrderType.STOP, qty=10, stop_price=99, oco_group="x", tif=TimeInForce.GTC), ts("10:01"))
    b.submit(Order("XYZ", Side.SELL, OrderType.LIMIT, qty=10, limit_price=101, oco_group="x", tif=TimeInForce.GTC), ts("10:01"))
    f = b.process_bar("XYZ", bar("10:02", 100, 102, 98, 100))
    assert len(f) == 1 and f[0].price < 99.01
    assert not b.open_orders("XYZ")


def test_cash_account_cannot_short_and_uses_settled_cash():
    b = make(cash=1_000)
    o = b.submit(Order("XYZ", Side.SELL, OrderType.MARKET, qty=1), ts("10:00"))
    assert o.status == Status.REJECTED
    b.submit(Order("XYZ", Side.BUY, OrderType.MARKET, qty=9), ts("10:00"))
    b.process_bar("XYZ", bar("10:01", 100, 100, 100, 100))
    b.submit(Order("XYZ", Side.SELL, OrderType.MARKET, qty=9), ts("10:01"))
    b.process_bar("XYZ", bar("10:02", 100, 100, 100, 100))
    # Proceeds are unsettled until T+1, so they can't be spent today.
    assert b.account.buying_power() < 150
    b.start_day(pd.Timestamp("2026-09-30").date())
    assert b.account.buying_power() > 990


def test_margin_short_needs_2000():
    small = make(cash=1_500, kind=AccountType.MARGIN)
    assert small.submit(Order("XYZ", Side.SELL, OrderType.MARKET, qty=1), ts("10:00")).status == Status.REJECTED
    big = make(cash=5_000, kind=AccountType.MARGIN)
    o = big.submit(Order("XYZ", Side.SELL, OrderType.MARKET, qty=10), ts("10:00"))
    assert o.status == Status.OPEN
    big.process_bar("XYZ", bar("10:01", 100, 100, 100, 100))
    assert big.account.position("XYZ").qty == -10
    gtc_short = big.submit(Order("XYZ", Side.SELL, OrderType.LIMIT, qty=100, limit_price=120,
                                 tif=TimeInForce.GTC), ts("10:02"))
    assert gtc_short.status == Status.REJECTED     # opening shorts are good-for-day only


def test_buy_to_cover_needs_no_buying_power():
    # A short that used up buying power must still be closable by its stop, its target
    # and a market order: covering reduces risk, so no buying power is reserved for it.
    b = make(cash=5_000, kind=AccountType.MARGIN)
    b.submit(Order("XYZ", Side.SELL, OrderType.MARKET, qty=90), ts("10:00"))
    b.process_bar("XYZ", bar("10:01", 100, 100, 100, 100))
    assert b.account.position("XYZ").qty == -90
    assert b.account.buying_power() < 90 * 110
    stop = b.submit(Order("XYZ", Side.BUY, OrderType.STOP, qty=90, stop_price=110,
                          tif=TimeInForce.GTC, oco_group="x"), ts("10:02"))
    target = b.submit(Order("XYZ", Side.BUY, OrderType.LIMIT, qty=90, limit_price=95,
                            tif=TimeInForce.GTC, oco_group="x"), ts("10:02"))
    assert stop.status == Status.OPEN and target.status == Status.OPEN
    b.process_bar("XYZ", bar("10:03", 100, 111, 100, 111))
    assert stop.status == Status.FILLED and target.status == Status.CANCELED
    assert b.account.position("XYZ").qty == 0


def test_buy_that_flips_short_to_long_reserves_only_the_long_part():
    b = make(cash=5_000, kind=AccountType.MARGIN)
    b.submit(Order("XYZ", Side.SELL, OrderType.MARKET, qty=10), ts("10:00"))
    b.process_bar("XYZ", bar("10:01", 100, 100, 100, 100))
    o = b.submit(Order("XYZ", Side.BUY, OrderType.LIMIT, qty=15, limit_price=100), ts("10:02"))
    assert o.reserved == pytest.approx(5 * 100)


def test_dollar_sell_limited_to_95_percent():
    b = make()
    b.submit(Order("XYZ", Side.BUY, OrderType.MARKET, qty=10), ts("10:00"))
    b.process_bar("XYZ", bar("10:01", 100, 100, 100, 100))
    assert b.submit(Order("XYZ", Side.SELL, OrderType.MARKET, notional=990), ts("10:02")).status == Status.REJECTED
    assert b.submit(Order("XYZ", Side.SELL, OrderType.MARKET, notional=900), ts("10:02")).status == Status.OPEN


def test_day_order_expires_at_close_and_gtc_survives():
    b = make()
    day = b.submit(Order("XYZ", Side.BUY, OrderType.LIMIT, qty=1, limit_price=50), ts("10:00"))
    gtc = b.submit(Order("XYZ", Side.BUY, OrderType.LIMIT, qty=1, limit_price=50, tif=TimeInForce.GTC), ts("10:00"))
    b.process_bar("XYZ", bar("16:01", 100, 100, 100, 100))
    assert day.status == Status.EXPIRED
    assert gtc.is_active


def test_participation_cap_partial_fill():
    b = make(cash=1_000_000)
    b.submit(Order("XYZ", Side.BUY, OrderType.MARKET, qty=500), ts("10:00"))
    f = b.process_bar("XYZ", bar("10:01", 100, 100, 100, 100, v=1000))
    assert f[0].qty == 100                       # 10% of 1000 shares
    f2 = b.process_bar("XYZ", bar("10:02", 100, 100, 100, 100, v=1000))
    assert f2[0].qty == 100
