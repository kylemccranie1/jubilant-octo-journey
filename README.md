# Wall Street '90

A mobile-first stock trading game set in the 1990s. Start in January 1990 with $8,000 and a rotary phone.
Trade your way up to a Hamptons mansion and a private jet — or lose it all and end up homeless.

Plain HTML/JS, no build step. Plays in a phone browser; "Add to Home Screen" for fullscreen.

## Run

    python3 -m http.server 8000      # then open http://<your-ip>:8000 on your phone

## How it works

- **Time:** one turn = one week, Jan 1990 → Dec 2000. "+1 Month" skips ahead and stops on big news.
- **Market:** 15 fictional stocks (dot-coms IPO in 1995–99). Real-history events move the market: Gulf War, 1994 bond crash, Asian crisis, LTCM, the dot-com crash.
- **Company news:** earnings, lawsuits, takeovers, FDA decisions. Stocks can split or go bankrupt (shares become worthless).
- **Lifestyle:** buy homes, cars, trading gear and status symbols. Better gear = cheaper commissions + weekly tips.
- **Bills:** rent, living costs and upkeep come due monthly. If you can't pay, the broker sells stock, the repo man takes your stuff, then you're evicted. Out of options = homeless, game over.
- **Saves** automatically in `localStorage`.

## Code

- `js/engine.js` — pure game logic (market model, trading, lifestyle, bills). Runs in Node.
- `js/ui.js`, `style.css`, `index.html` — mobile UI.
- `test/sim.js` — headless balance/sanity simulation: `node test/sim.js`

## Ideas for next

Short selling & margin, capital-gains tax, an index fund, sound, insider-trading temptation/SEC risk, achievements, app-store packaging (Capacitor).
