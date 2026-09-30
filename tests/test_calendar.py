import pandas as pd

from trade_sim.calendar import Session, TradingCalendar

cal = TradingCalendar(2025, 2027)


def ts(s):
    return pd.Timestamp(s, tz="America/New_York")


def test_sessions():
    assert cal.session(ts("2026-09-29 06:59")) == Session.OVERNIGHT
    assert cal.session(ts("2026-09-29 07:00")) == Session.PRE
    assert cal.session(ts("2026-09-29 09:30")) == Session.REGULAR
    assert cal.session(ts("2026-09-29 16:00")) == Session.POST
    assert cal.session(ts("2026-09-29 20:00")) == Session.OVERNIGHT
    # Friday night and Saturday are closed; Sunday 8pm opens the 24 Hour Market.
    assert cal.session(ts("2026-10-02 21:00")) == Session.CLOSED
    assert cal.session(ts("2026-10-03 12:00")) == Session.CLOSED
    assert cal.session(ts("2026-10-04 20:30")) == Session.OVERNIGHT


def test_holiday_and_early_close():
    assert not cal.is_trading_day(pd.Timestamp("2026-11-26").date())      # Thanksgiving
    _, close = cal.open_close(pd.Timestamp("2026-11-27").date())
    assert close.hour == 13                                                # day after: 1pm close
    assert cal.session(ts("2026-11-27 13:30")) == Session.POST


def test_t_plus_one_skips_weekend_and_holidays():
    assert str(cal.settlement_date(pd.Timestamp("2026-10-02").date())) == "2026-10-05"
    assert str(cal.settlement_date(pd.Timestamp("2026-11-25").date())) == "2026-11-27"


def test_fractional_extended_window():
    assert cal.fractional_extended_ok(ts("2026-09-29 19:00"))
    assert not cal.fractional_extended_ok(ts("2026-09-29 19:45"))
