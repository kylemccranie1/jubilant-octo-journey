# The Pit '90

A real-time, mobile-first **pit trading** game set in the Chicago futures pits of the 1990s.
Start in January 1990 with $8,000 and a colored jacket in the soybean pit. Scalp ticks, read the crowd,
and trade your way from a roach-motel studio to a Hamptons mansion — or blow up, get liquidated, and end up homeless.

Plain HTML/JS, no build step. Plays in a phone browser; "Add to Home Screen" for fullscreen.

## Play online (GitHub Pages)

Pushes to `main` auto-deploy via `.github/workflows/pages.yml` to `https://kylemccranie1.github.io/jubilant-octo-journey/`.
One-time setup: repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
On Android Chrome open the URL and choose **⋮ → Add to Home screen**.

## Run locally

    python3 -m http.server 8000      # then open http://<your-ip>:8000 on your phone

## How it plays

- **The session:** each trading day is a live ~80-second session (8:30–15:00 Central). Tap **BUY** to lift the offer or **SELL** to hit the bid; set a stop-loss; flatten any time.
- **Price comes from order flow.** A simulated pit book queues lots at every price level. Every shout is a real market order that eats those levels — clear a level and the price steps. A hidden informed-flow regime leans the crowd one way for 20–80 steps, so the shouting is genuinely predictive (but noisy).
- **Your orders move the market.** Market orders walk the book (slippage you can preview on the button), the crowd briefly piles on, then liquidity providers lean back so part of your impact reverts. Big size costs real money.
- **Limit orders:** *Join BID / Join OFFER* rests an order at the back of the queue. They fill as the crowd trades through them. Taking profit with a limit into strength beats hitting the market; quoting both sides like a market maker mostly gets you filled when the market is running you over.
- **News:** historic headlines (Kuwait, Desert Storm, Black Wednesday, Fed hikes, Asian crisis, Russia, dot-com crash) plus random crop reports, inventories and Fed speakers trigger a flood of one-sided orders that drags price to its new level.
- **Career ladder:** Runner → Local → Seat Holder → Floor Broker → Pit Boss → Master of the Pit. Net worth earns the badge (and the next pit: Soybeans → Crude → Deutschmark → T-Bonds → S&P 500), with better margin terms and lower fees — but each badge carries monthly exchange **dues** (about 2% of its threshold), and if your net worth sags below 60% of the threshold for a month the exchange **pulls the badge** and locks you out of the bigger pit.
- **Rivals:** six floor traders (Big Tony, Sally Kim, Marcus Webb, Dutch Reilly, Vivian Chase, Rick "The Hammer" Dunn) ride the same market, and some blow up in the selloffs. Check the standings in the Ledger; each January you get a year-in-review. Prices wander around approximate real price history. Futures mechanics: margin per lot, daily settlement, overnight gaps, margin calls below 75% of margin; open P&L is marked at liquidation value (bid for longs, ask for shorts).
- **Between sessions:** open the bell, or skip a day/week/month.
- **Front-running:** a broker may offer a big customer order. Fill it fairly for a fee — or trade ahead of it and ride the sweep. First time you're caught: a huge fine. Second: **federal prison**.
- **Life layer:** homes, cars, floor gear and status symbols; monthly bills out of your trading account (rent, living costs and dues creep up 3% a year; your diner wage doesn't); occasional surprise bills; 28% tax each April.
- **Final notice:** if you can't cover a month, you don't lose everything instantly. You get a **5-trading-day final notice** to raise the money by trading (a ticking-clock session). Miss it and the repo man collects, then you're evicted, then **homeless**.
- **Margin danger:** the position panel shows your **liquidation price**; a warning fires 30% before it; the screen glows red when you're within a few ticks. Getting liquidated also costs a $25-per-lot clearing-firm fee.
- **Achievements:** 25 trophies that persist across games. Saves automatically (including mid-session).

## Training Floor

An interactive 2-minute lesson on reading order flow (title screen, the Pit tab, or offered on your first game). It runs on the real engine with fake money: tape, ladder, chart and gauge walkthroughs with spotlights, four "call the lean" quiz rounds (including the don't-fade-one-print trap and a no-lean round), a costs lesson, a live practice trade, and a checklist. Finishing earns the *Floor Trained* trophy.

## The look

A 90s trading floor, drawn in code (no image files):
- **Animated pixel-art pit:** traders in colored jackets whose hand signals match the flow — palms-out for buying, palms-in for selling. The crowd's lean follows the flow gauge, big prints throw trading cards, customer blocks and headlines make the whole pit surge, and you're the cyan jacket in the front row.
- **CRT phosphor chart** with glow and scanlines; order-flow blocks sized by lots, white outlines for your own fills.
- **Split-flap price board**, amber LED boards on the back wall, and an ambient pit roar that swells with activity (mute with 🔊).

## Code

- `js/engine.js` — pure game logic: daily macro model (anchored to real price history), order-book session simulator (crowd flow regimes, headlines, own-order impact, limit-order queue, front-run offers), futures account, bills/tax/SEC, achievements. Runs in Node.
- `js/ui.js`, `js/pitscene.js`, `js/sfx.js`, `style.css`, `index.html` — mobile UI, the animated pit, and synthesized sound.
- `sw.js`, `manifest.json`, `icons/` — installable offline PWA.
- `test/sim.js` — headless bot careers + mechanics tests: `npm test`

## App stores (Capacitor)

    npm install
    npm run cap:android     # or cap:ios (macOS + Xcode required)
    npx cap open android

Change `appId` in `capacitor.config.json` before publishing. Store builds need your own developer accounts, signing keys and listing assets.
