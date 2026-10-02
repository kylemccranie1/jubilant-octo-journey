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

- **The session:** each trading day is a live ~80-second session (8:30–15:00 Central). Prices tick every 150 ms. Tap **BUY** to lift the offer or **SELL** to hit the bid. You pay the 1-tick spread plus a clearing fee, so you need the market to move for you.
- **Read the pit:** other traders' shouts scroll by (BUY 50 🔥, SELL 20…). Order flow leans in runs — a pile of big BUYs usually means price is about to climb. Better floor gear makes the chatter more reliable.
- **News:** historic headlines hit mid-session (Iraq invades Kuwait, Desert Storm, Black Wednesday, the Fed hikes, the Asian crisis, Russia defaults, the dot-com crash) plus random crop reports, inventories and Fed speakers. Trade the jump.
- **Five pits:** Soybeans → Crude Oil → Deutschmark → T-Bonds → S&P 500. Bigger pits unlock with net worth and move a lot more money per tick (and need a lot more margin).
- **Futures mechanics:** margin per lot, daily mark-to-market settlement, overnight gaps, slippage on big orders, stop-losses, and **margin calls** (liquidated below 75% of margin).
- **Between sessions:** open the bell, or skip a day/week/month and let the market move without you.
- **Front-running:** once you're earning, a broker may slip you a big customer order. Fill it fairly for a fee — or trade ahead of it. First time you're caught: a huge fine. Second time: **federal prison**. (The real 1989 FBI pit sting is the inspiration.)
- **Life layer:** buy homes, cars, floor gear and status symbols. Bills come due monthly out of your trading account; 28% tax is billed each April. Can't pay → the repo man takes your stuff → evicted → **homeless**, game over.
- **Achievements:** 25 trophies that persist across games. Synthesized sound effects, mute button in the header.
- Saves automatically in `localStorage` (including mid-session).

## Code

- `js/engine.js` — pure game logic: daily macro model (anchored to real price history), session simulator (order-flow regimes, shouts, headlines, front-run offers), futures account, bills/tax/SEC, achievements. Runs in Node.
- `js/ui.js`, `js/sfx.js`, `style.css`, `index.html` — mobile UI (live floor with canvas chart) and sound.
- `sw.js`, `manifest.json`, `icons/` — installable offline PWA.
- `test/sim.js` — headless bot careers + mechanics tests: `npm test`

## App stores (Capacitor)

    npm install
    npm run cap:android     # or cap:ios (macOS + Xcode required)
    npx cap open android

Change `appId` in `capacitor.config.json` before publishing. Store builds need your own developer accounts, signing keys and listing assets.
