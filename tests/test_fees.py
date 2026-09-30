from trade_sim.fees import ROBINHOOD_2026 as F


def test_buy_pays_only_cat():
    assert F.total("buy", 100, 50) == 0.0          # 100 * 0.000003 = 0.0003 -> rounds down to 0
    assert F.total("buy", 10_000, 50) == 0.03      # 0.03


def test_small_sell_waivers():
    # $500 or less: no SEC fee; 50 shares or fewer: no TAF.
    assert F.total("sell", 5, 100) == 0.0


def test_sell_fees():
    # 1000 shares @ $100 = $100,000 proceeds.
    assert F.sec_fee(100_000) == 2.06
    assert F.taf_fee(1000) == 0.20                  # 0.195 rounds half-up to 0.20
    assert F.total("sell", 1000, 100) == 2.26


def test_taf_cap():
    assert F.taf_fee(1_000_000) == 9.79
