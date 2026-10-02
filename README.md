# Wall Street '90

A mobile-first stock trading game set in the 1990s. Start in January 1990 with $8,000 and a rotary phone.
Trade your way up to a Hamptons mansion and a private jet — or lose it all and end up homeless.

Plain HTML/JS, no build step. Plays in a phone browser; "Add to Home Screen" for fullscreen.

## Play online (GitHub Pages)

Pushes to `main` auto-deploy via `.github/workflows/pages.yml` to `https://kylemccranie1.github.io/jubilant-octo-journey/`.
One-time setup: repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
On Android Chrome open the URL and choose **⋮ → Add to Home screen**.

## Run locally

    python3 -m http.server 8000      # then open http://<your-ip>:8000 on your phone

## How it works

- **Time:** one turn = one week, Jan 1990 → Dec 2000. "+1 Month" skips ahead and stops on big news.
- **Market:** 15 stocks + a low-risk **Index Fund** (IDX). Dot-coms IPO in 1995–99. Real-history events move the market: Gulf War, 1994 bond crash, Asian crisis, LTCM, the dot-com crash. Random company news, splits and bankruptcies.
- **Margin & short selling:** buy up to 2x your equity on margin (9% interest) or short a stock (bet it falls). Fall below 25% equity and you get a **margin call** — the broker force-closes your positions. A bankrupt stock pays out your shorts.
- **Taxes:** 28% capital-gains tax on each year's realized profits, billed in April (losses carry forward).
- **Insider tips:** once you're making real money, a "friend" may offer a sure thing. Take it and you profit — but the SEC may come knocking. First catch = huge fine, second = **federal prison**.
- **Lifestyle:** homes, cars, trading gear and status symbols. Better gear = cheaper commissions + weekly tips.
- **Bills:** rent, living costs, interest and upkeep come due monthly. Can't pay → broker sells stock → repo man → eviction → **homeless**, game over.
- **Achievements:** 21 trophies that persist across games.
- **Sound:** synthesized 90s-style effects (no audio files); mute with the 🔊 button.
- **Saves** automatically in `localStorage`.

## Code

- `js/engine.js` — pure game logic (market, trading, margin, tax, insider/SEC, lifestyle, bills, achievements). Runs in Node.
- `js/ui.js`, `js/sfx.js`, `style.css`, `index.html` — mobile UI and sound.
- `sw.js`, `manifest.json`, `icons/` — installable PWA that works offline.
- `test/sim.js` — headless simulation + mechanics tests: `npm test`

## Installable app / app stores (Capacitor)

The web game is already an installable PWA. To wrap it as a native app:

    npm install
    npm run cap:android     # or cap:ios (macOS + Xcode required)
    npx cap open android    # build/sign in Android Studio / Xcode

Change `appId` in `capacitor.config.json` before publishing. Store builds need your own developer accounts, signing keys and store listing assets.
