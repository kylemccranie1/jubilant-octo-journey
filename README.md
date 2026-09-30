# trade-sim

A paper trading simulator that copies how Robinhood handles stock orders, plus a
research harness for level-based strategies. It never connects to a brokerage and
never places real orders. Market data comes from Alpaca's data API (consolidated SIP feed, free for history).

## What it models

| Area | Behavior |
|---|---|
| Sessions | Pre-market 7:00–9:30, regular 9:30–16:00, after-hours 16:00–20:00, 24 Hour Market overnight (Sun–Thu nights); NYSE holidays and early closes |
| Order types | Market, limit, stop, stop-limit, trailing stop; market/stop orders only trade in regular hours and queue for the open otherwise; limit orders carry a session flag |
| Time in force | Good-for-day, or good-til-canceled (expires after 90 days) |
| Fractional / dollar orders | Market and limit only; dollar sells capped at 95% of the position; extended-hours fractional window ends 19:30 |
| Fills | Marketable orders pay ~24.5% of the half-spread (Robinhood's reported price improvement); limits need a trade *through* the price; stops pay a full half-spread or fill at the open on a gap; size capped at 10% of bar volume; a bar that hits both stop and target counts as the stop |
| Fees | $0 commission; SEC $20.60/$1M on sells (waived ≤ $500); FINRA TAF $0.000195/share on sells (cap $9.79, waived ≤ 50 shares); CAT $0.000003/share |
| Cash account | Long only, settled cash only, T+1 settlement |
| Margin account | $2,000 minimum for leverage and shorts; Reg T 50% initial; no pattern day trader limit (removed June 2026); shorts are day orders, whole shares, not overnight; borrow fees and margin interest accrue daily; maintenance deficit triggers liquidation |

Assumptions that weren't confirmed against a Robinhood source are marked in the code
(maintenance percentages, margin and borrow rates, fractional order types).
`docs/robinhood-research.md` has the sourced research.

## Strategies

`trade_sim/strategies/level_trader.py`

* **DailyWeeklyLevels**: previous day and week highs and lows.
* **SupportResistance**: zones where price was tested and rejected at least twice on
  1-hour and 4-hour bars over the last ~20 trading days (swing points clustered by price).

Each can **fade** the level (bet it holds), trade the **break**, or be **vol_gated**
(fade when the 14-day ATR is below its 1-year median, break when above). Exits are
parameters: ATR-based stop and target, flatten at 15:55, or hold up to N days.

Every trade records a feature snapshot at entry (ATR percentile, realized vol, gap,
trend, relative volume, time of day, level type, zone touches/width/age...).
`trade_sim.analysis.filter_report` then shows results for each feature bucket, with
buckets fit on the first 70% of trades and checked on the last 30%. That is how to see
whether a metric layered on top of level trading actually improves outcomes.

## Usage

```bash
pip install -r requirements.txt
python -m pytest

# Synthetic data (no API keys needed; it has no edge, so results should hover around zero)
python run_backtest.py --synthetic --strategy daily_weekly --mode vol_gated --regular-only

# Real data (needs ALPACA_API_KEY and ALPACA_SECRET_KEY; uses the SIP feed by default,
# which the free plan allows for anything older than 15 minutes)
python run_backtest.py --symbol SPY --start 2023-01-01 --end 2026-09-01 \
    --strategy sr_zones --mode fade --account margin --stop-atr 0.5 --target-atr 1.0
```

Results go to `results/` (trade journal CSV and filter report CSV).

To run every symbol × strategy × mode and pool the trades across symbols (a single
symbol rarely has enough trades for its 30% test slice to mean much):

```bash
# Last year only; bars from --start to --trade-start just warm up ATR, percentiles and zones
python run_grid.py --symbols SPY QQQ AAPL MSFT NVDA AMZN --start 2025-06-02 --trade-start 2025-09-29 \
    --end 2026-09-29 --regular-only
python run_grid.py --synthetic --symbols A B C --regular-only   # smoke test, no keys
```

It writes per-run trade journals, `summary.csv`, `pooled_summary.csv`, and for each
strategy/mode a pooled filter report plus a digest where `holds` marks feature buckets
that beat the baseline's average R in both train and test. The summary's
`unexplained_pnl` column should stay within a few dollars of borrow fees; anything larger
means a position was left open or the ledger is off.

## Layout

```
trade_sim/
  calendar.py     sessions, holidays, T+1 settlement
  orders.py       order types, time in force, session flags
  fills.py        bar-based fill model
  fees.py         Robinhood fee schedule
  account.py      cash/margin ledger, buying power, settlement
  broker.py       order validation, queuing, expiry, OCO, fills
  engine.py       backtest loop and Strategy interface
  trades.py       round-trip trade journal with MAE/MFE and features
  levels.py       daily/weekly levels, ATR, support/resistance zones
  analysis.py     summary stats and filter report
  data/           Alpaca adapter, CSV cache, synthetic data
```

## Not yet built

* Live paper mode (streaming quotes instead of replaying bars)
* Quote-level fills (needs the paid SIP feed for a realistic NBBO)
* Short sale restriction (Rule 201) and hard-to-borrow lists
* VIX as a feature (Alpaca has no index data; a VIX ETF proxy or another source is needed)
* Multi-symbol portfolio sizing
