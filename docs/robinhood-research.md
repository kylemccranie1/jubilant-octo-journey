# Robinhood-style paper trading simulator: research and proposed design

Drafted 2026-09-30. Scope: US stocks and ETFs. Items marked **(verified)** were checked against a source listed at the bottom; items marked **(inferred)** are my best understanding and should be confirmed before we rely on them.

## 1. How real Robinhood stock orders behave

### Sessions
| Session | Hours (ET) | What trades |
|---|---|---|
| Pre-market | 7:00–9:30 | Limit orders only **(verified)** |
| Regular | 9:30–16:00 | All order types |
| After-hours | 16:00–20:00 | Limit orders only **(verified)** |
| 24 Hour Market | overnight, 5 days/week | Limit orders, select symbols only **(verified)** |

- Fractional shares in extended hours run only 7:00–9:30 and 16:00–19:30, and not for every symbol **(verified)**.
- Each limit order carries a session flag (regular, extended, or 24 hour) **(verified)**.

### Order types
- **Market**: regular hours only. Placed outside hours, it queues for the next open **(verified)**. Robinhood over-reserves 5% of buying power for queued market buys and cancels at open if the gap-up leaves too little buying power **(verified)**. Robinhood has historically converted market buys to a limit with a price collar; I could not confirm the current percentage **(inferred)**.
- **Limit**: good-for-day or good-til-canceled; GTC expires after 90 days **(verified)**.
- **Stop and trailing stop**: trigger in regular hours only; orders placed outside hours queue for the open **(verified)**. A triggered stop becomes a market order, a stop-limit becomes a limit **(inferred, standard behavior)**.
- **Dollar-based (fractional) orders**: a dollar-based sell can sell only 95% of a position, so selling everything requires a share-based order **(verified)**.
- OTC securities are limit-only in every session **(verified)**; we can ignore OTC to start.

### Fills and price improvement
- Robinhood routes stock orders to wholesale market makers and is paid for order flow, not to exchanges **(verified)**.
- Q2 2026 execution-quality stats: 96.36% of market and marketable-limit orders filled at the NBBO or better; average price improvement of $6.11 per 100 shares on 1–99 share orders; effective-over-quoted spread 24.47% **(verified)**. In plain terms, a marketable order typically pays about a quarter of the quoted half-spread instead of the full half-spread.
- These stats exclude fractional orders **(verified)**, so fractional fills need a more conservative assumption.

### Fees (stocks and ETFs)
| Fee | Side | Rate |
|---|---|---|
| Commission | both | $0 **(verified)** |
| SEC Section 31 | sell | $20.60 per $1M of proceeds since 2026-04-04; waived on sales of $500 or less **(verified)** |
| FINRA TAF | sell | $0.000195/share, max $9.79/trade, rounded to the cent; waived at 50 shares or fewer **(verified)** |
| CAT | both | $0.000003/share; rounds down if under $0.01 **(verified)** |

### Account rules
- **Pattern day trader rule is gone.** FINRA replaced it with intraday margin standards effective 2026-06-04, and Robinhood has dropped the 3-trades-in-5-days limit and the $25k minimum **(verified)**. Margin accounts still need $2,000 equity to use leverage and must hold equity that covers intraday exposure **(verified)**. An unmet intraday margin deficit by the fifth business day triggers a 90-day freeze **(verified)**.
- **Cash accounts** trade only with settled funds; stock settlement is T+1 **(verified)**. Buying with unsettled proceeds and selling before settlement is a good-faith violation, with restrictions after repeated violations **(inferred, standard rule)**.

## 2. Market data source

**Recommendation: Alpaca's free Basic plan to start.**
- Real-time IEX quotes, trades, and bars over websocket (30 symbols), historical bars back to 2016, 200 REST calls/min **(verified)**. No brokerage account funding is needed for data.
- Limits: IEX is a single exchange, so its quotes are thinner and wider than the full NBBO, and the most recent 15 minutes of consolidated (SIP) history is not available on free **(verified)**.
- Upgrade path: Algo Trader Plus at $99/month for full SIP data and unlimited symbols **(verified)**. Worth it once a strategy looks promising, because fill realism depends on the real NBBO.
- The data layer will sit behind an interface so we can swap providers (Polygon/Massive, Databento, etc.) without touching the simulator.

## 3. Proposed simulator design

A Python package with one engine used in two modes: **backtest** (replays historical quotes/bars) and **live paper** (streams real-time data). Strategies run identically in both.

### Components
1. **Clock and calendar**: NYSE holidays, early closes, and the four sessions above.
2. **Market data adapter**: Alpaca first; normalizes to quotes (bid/ask/size), trades, and bars.
3. **Order manager**: validates orders against Robinhood rules (session vs. order type, fractional eligibility, 95% dollar-sell cap, GTC 90-day expiry, queuing for the open) and tracks state (queued, open, partially filled, filled, canceled, rejected).
4. **Fill engine** (the core of realism):
   - Marketable orders fill against the NBBO at the time of arrival plus a small latency, then apply price improvement drawn around Robinhood's reported E/Q ratio (about 25% of the half-spread by default, configurable).
   - Size beyond the displayed quote gets a slippage penalty based on spread and recent volume.
   - Resting limit orders fill only when the market trades through the limit, not merely touches it, to avoid over-optimistic fills.
   - Extended-hours fills use wider spreads and lower fill probability.
   - Backtests on bar data only use conservative fills (next-bar open, worst-side assumptions), and results are labeled as bar-based.
5. **Account and ledger**: cash vs. margin account, T+1 settlement, settled vs. unsettled cash, good-faith violation tracking, buying power including the 5% reserve on queued market orders, intraday margin check for margin accounts, and the fee schedule above.
6. **Strategy interface**: a simple `on_bar / on_quote / on_fill` API that an agent (an LLM or rules) can call to place orders, plus a log of every decision and its reasoning for later review.
7. **Reporting**: P&L after fees, fill quality vs. NBBO, turnover, drawdown, and a per-trade journal.

### What it deliberately does not do
- It never connects to a Robinhood account or places real orders. A live bridge would be a separate, later decision.
- Options, crypto, and futures are out of scope until a stock strategy shows an edge.

### Suggested build order
1. Calendar, data adapter, ledger with fees and settlement.
2. Order manager and fill engine with tests against hand-computed cases.
3. Backtest mode, then live paper mode.
4. First strategy (one of Kyle's) plus reporting.

## Open questions for Kyle
1. Cash account or margin account to simulate first? (Default: cash, since it avoids leverage.)
2. Where should the code live? A new GitHub repo needs your go-ahead.
3. Is a $99/month data upgrade acceptable later, or should we stay on free data?
4. Your strategy ideas: holding period, universe of symbols, and signals.

## Sources
- [Robinhood: Extended-hours trading](https://robinhood.com/us/en/support/articles/extendedhours-trading/)
- [Robinhood: Market order](https://www.robinhood.com/us/en/support/articles/market-order-update/)
- [Robinhood: Stock order routing](https://robinhood.com/us/en/support/articles/stock-order-routing/)
- [Robinhood: Our execution quality](https://robinhood.com/us/en/about-us/our-execution-quality)
- [Robinhood: Trading fees](https://robinhood.com/us/en/support/articles/trading-fees-on-robinhood)
- [FINRA Regulatory Notice 26-10](https://www.finra.org/rules-guidance/notices/26-10)
- [FINRA: Section 31 fee rate, 2026](https://www.finra.org/rules-guidance/notices/information-notice-20260317)
- [Finder: Robinhood day trading rules 2026](https://www.finder.com/stock-trading/robinhood-day-trading)
- [Alpaca: About Market Data API](https://docs.alpaca.markets/us/docs/about-market-data-api)
