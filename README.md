# trade-sim

A paper trading simulator that copies how Robinhood handles stock orders. It never
connects to a brokerage and never places real orders. Market data comes from Alpaca's data API (consolidated SIP feed, free for history).

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
| Margin account | $2,000 minimum for leverage and shorts; Reg T 50% initial; no pattern day trader limit (removed June 2026); orders that open a short are good-for-day and whole shares (short positions can be held overnight); borrow fees and margin interest accrue daily; maintenance deficit triggers liquidation |

Assumptions that weren't confirmed against a Robinhood source are marked in the code
(maintenance percentages, margin and borrow rates, fractional order types).
`docs/robinhood-research.md` has the sourced research.

## Usage

```bash
pip install -r requirements.txt
python -m pytest
```

A strategy subclasses `trade_sim.engine.Strategy` and submits orders to the broker from
`on_bar`; the engine fills orders that were working before each bar, then shows the
strategy the completed bar. Positions still open when the data ends are closed at the last
price (tagged `end_of_data`).

```python
from trade_sim.account import Account, AccountType
from trade_sim.analysis import equity_stats, summarize
from trade_sim.broker import PaperBroker
from trade_sim.calendar import Session, TradingCalendar
from trade_sim.data import synthetic_minute_bars          # or trade_sim.data.alpaca.fetch_bars
from trade_sim.engine import Backtester, Strategy
from trade_sim.orders import Order, OrderType, Side

class BuyOnce(Strategy):
    def __init__(self):
        self.done = False

    def on_bar(self, ctx, symbol, bar):
        if not self.done and bar.session == Session.REGULAR:
            ctx.broker.submit(Order(symbol, Side.BUY, OrderType.MARKET, qty=10), bar.ts)
            self.done = True

bars = synthetic_minute_bars("2024-01-01", "2024-03-29", seed=0)
broker = PaperBroker(Account(AccountType.MARGIN, cash=25_000), TradingCalendar())
ctx = Backtester(broker, BuyOnce(), {"SYN": bars}).run()
print(summarize(ctx.tracker.to_frame()), equity_stats(ctx.equity_curve))
```

Real data: `trade_sim.data.alpaca.fetch_bars(symbol, start, end, feed="sip")` needs
`ALPACA_API_KEY` and `ALPACA_SECRET_KEY`. The free plan allows the consolidated SIP feed for
anything older than 15 minutes; requests are clamped accordingly. `trade_sim.data.save_csv` /
`load_csv` cache downloads.

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
  analysis.py     summary stats for a trade journal and equity curve
  data/           Alpaca adapter, CSV cache, synthetic data
```

## Not yet built

* Live paper mode (streaming quotes instead of replaying bars)
* Quote-level fills (needs the paid SIP feed for a realistic NBBO)
* Short sale restriction (Rule 201) and hard-to-borrow lists
* VIX as a feature (Alpaca has no index data; a VIX ETF proxy or another source is needed)
* Multi-symbol portfolio sizing
