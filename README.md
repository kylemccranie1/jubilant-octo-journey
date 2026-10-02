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
- **Five pits:** Soybeans → Crude Oil → Deutschmark → T-Bonds → S&P 500, unlocked by net worth. Prices wander around approximate real price history. Futures mechanics: margin per lot, daily settlement, overnight gaps, margin calls below 75% of margin; open P&L is marked at liquidation value (bid for longs, ask for shorts).
- **Between sessions:** open the bell, or skip a day/week/month.
- **Front-running:** a broker may offer a big customer order. Fill it fairly for a fee — or trade ahead of it and ride the sweep. First time you're caught: a huge fine. Second: **federal prison**.
- **Life layer:** homes, cars, floor gear and status symbols; monthly bills out of your trading account; 28% tax each April; repo man → eviction → **homeless**.
- **Achievements:** 25 trophies that persist across games. Saves automatically (including mid-session).

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
