// Headless balance/sanity simulation: node test/sim.js
const E = require('../js/engine.js');
const assert = require('assert');

// ---- play helpers
function playSession(G, sym, bot) {
  const r = E.startSession(G, sym); if (!r.ok) return [];
  const evs = [];
  if (bot.init) bot.init(G);
  while (G.sess && !G.sess.done) {
    const S = G.sess;
    if (S.offer && !S.offer.resolved && S.t + 1 >= S.offer.t) { /* offer fires on next step */ }
    const out = E.stepSession(G);
    for (const e of out) {
      evs.push(e);
      if (e.kind === 'offer') E.respondOffer(G, bot.offer ? bot.offer(G) : 'honest');
    }
    if (G.sess && !G.sess.done && bot.tick) bot.tick(G);
  }
  return evs;
}
function career(name, seed, bot, opts = {}) {
  const G = E.newGame(seed);
  let sessions = 0, guard = 0;
  while (!G.over && guard++ < 5000) {
    if (bot.skip && bot.skip(G)) { E.skipDays(G, 1); continue; }
    const sym = bot.pit ? bot.pit(G) : 'SOY';
    const r = E.startSession(G, sym);
    if (!r.ok) { E.skipDays(G, 1); continue; }
    // (startSession already called; replay the loop inline)
    if (bot.init) bot.init(G);
    while (G.sess && !G.sess.done) {
      const out = E.stepSession(G);
      for (const e of out) if (e.kind === 'offer') E.respondOffer(G, bot.offer ? bot.offer(G) : 'honest');
      if (G.sess && !G.sess.done && bot.tick) bot.tick(G);
      assert(Number.isFinite(G.cash), 'cash NaN');
    }
    sessions++;
  }
  return { G, sessions };
}

// ---- bots
const flowBot = (lots = 2, thr = 60, stop = 14) => ({
  init(G) { E.setStop(G, stop); this.entryT = -99; },
  tick(G) {
    const S = G.sess, f = E.recentFlow(G, 25);
    if (!G.pos) { if (S.t < S.n - 30 && Math.abs(f) >= thr) { E.trade(G, Math.sign(f), Math.min(lots, E.maxLots(G, S.sym)) || 1); this.entryT = S.t; } }
    else {
      const against = Math.sign(f) !== Math.sign(G.pos.qty) && Math.abs(f) >= thr * 0.6;
      if (against || S.t - this.entryT > 70 || S.t >= S.n - 3) E.flatten(G);
    }
  },
  offer: () => 'honest',
});
const randomBot = (lots = 2) => ({
  init(G) { E.setStop(G, 0); },
  tick(G) {
    const S = G.sess;
    if (!G.pos && Math.random() < .03 && S.t < S.n - 40) E.trade(G, Math.random() < .5 ? 1 : -1, Math.min(lots, E.maxLots(G, S.sym)) || 1);
    else if (G.pos && (Math.random() < .03 || S.t >= S.n - 3)) E.flatten(G);
  },
});
const maxLev = { init(G) { E.setStop(G, 0); }, tick(G) { const S = G.sess; if (!G.pos && S.t === 5) E.trade(G, Math.random() < .5 ? 1 : -1, E.maxLots(G, S.sym) || 1); if (G.pos && S.t >= S.n - 2 && Math.random() < .5) E.flatten(G); } };
const idleBot = { pit: () => 'SOY', skip: () => true };
const best = (G) => CONTRACT_BY_NW(G);
function CONTRACT_BY_NW(G) { let p = 'SOY'; for (const c of E.CONTRACTS) if (G.unlocked[c.sym]) p = c.sym; return p; }
const grower = (inner) => Object.assign({}, inner, { pit: CONTRACT_BY_NW });

// ---- tallies
function tally(name, bot, n = 8) {
  const res = { homeless: 0, prison: 0, end: 0, margin: 0, nws: [], t0: Date.now() };
  for (let i = 1; i <= n; i++) {
    const { G } = career(name, 500 + i, bot);
    res[G.over]++; if (G.flags.margin) res.margin++; res.nws.push(E.netWorth(G));
  }
  res.nws.sort((a, b) => a - b);
  console.log(name.padEnd(14), `homeless ${res.homeless} prison ${res.prison} survived ${res.end} marginCalls ${res.margin}  median NW $${Math.round(res.nws[n >> 1]).toLocaleString()}  best $${Math.round(res.nws[n - 1]).toLocaleString()}  (${((Date.now() - res.t0) / 1000).toFixed(1)}s)`);
}
console.log('--- tallies (8 careers each)');
tally('idle', idleBot);
tally('random', randomBot());
tally('maxLeverage', maxLev);
tally('flow 2 lots', flowBot(2));
tally('flow grower', grower(flowBot(4)));

// ---- targeted mechanics
function runToClose(G) { const evs = []; while (G.sess && !G.sess.done) evs.push(...E.stepSession(G)); return evs; }
{ // basic trade accounting: buy then sell, P&L matches ticks, fees charged
  const G = E.newGame(21); E.startSession(G, 'SOY');
  for (let i = 0; i < 5; i++) E.stepSession(G);
  const before = G.cash, r1 = E.trade(G, 1, 2), r2 = E.trade(G, -1, 2);
  assert(r1.ok && r2.ok && !G.pos, 'round trip flat');
  const ticks = r2.px - r1.px; // ≤ -1 on a quiet market (pays the spread)
  assert(Math.abs((G.cash - before) - (ticks * 2 * 12.5 - 4 * 3.0)) < 1e-6, 'pnl = ticks*val - fees');
  assert(!E.trade(G, 1, 50).ok, 'margin limit blocks oversize');
}
{ // margin call: max-size position, force a crash path
  const G = E.newGame(22); E.startSession(G, 'SOY');
  E.stepSession(G); assert(E.trade(G, 1, E.maxLots(G, 'SOY')).ok);
  const S = G.sess; for (let i = S.t + 1; i <= S.n; i++) S.path[i] = S.path[S.t] - 400; // -400 ticks
  const evs = runToClose(G);
  assert(evs.some((e) => e.kind === 'margin'), 'margin call fired'); assert(!G.pos, 'flat after margin call');
}
{ // stop-loss closes position
  const G = E.newGame(23); E.startSession(G, 'SOY'); E.stepSession(G);
  E.trade(G, 1, 1); E.setStop(G, 8);
  const S = G.sess; for (let i = S.t + 1; i <= S.n; i++) S.path[i] = S.path[S.t] - 20;
  const evs = []; for (let i = 0; i < 5; i++) evs.push(...E.stepSession(G));
  assert(evs.some((e) => e.kind === 'stop') && !G.pos, 'stopped out');
}
{ // overnight position is settled daily and carried; other pit blocked
  const G = E.newGame(24); E.startSession(G, 'SOY'); E.stepSession(G); E.trade(G, 1, 1);
  const entry = G.pos.entry; runToClose(G);
  assert(G.pos && G.pos.qty === 1 && G.pos.entry === G.mk.SOY.close, 'carried at settle');
  assert(!E.startSession(G, 'CRUDE').ok, 'cannot start other pit while holding (and CRUDE locked)');
  E.skipDays(G, 5); assert(G.pos.entry === G.mk.SOY.close, 'settles through skipped days');
}
{ // unlocks
  const G = E.newGame(25); G.cash = 20000; const evs = E.skipDays(G, 1);
  assert(G.unlocked.CRUDE && evs.some((e) => e.kind === 'unlock'), 'crude unlocked at $12k');
}
{ // repo then homeless via bills (no trading, no cash)
  const G = E.newGame(26); G.cash = 2e6; assert(E.buyItem(G, 'home', 4).ok && E.buyItem(G, 'car', 4).ok);
  G.cash = 1000; const evs = []; for (let i = 0; i < 60 && !G.over; i++) evs.push(...E.skipDays(G, 21));
  assert(evs.some((e) => e.kind === 'repo'), 'repo event'); assert(G.over === 'homeless', 'ends homeless');
}
{ // tax: gain in a year -> bill in April
  const G = E.newGame(27); G.cash = 60000; G.ytd = 40000;
  let paid = false; for (let i = 0; i < 360 && !paid; i++) { E.skipDays(G, 1); if (G.flags.taxPaid) paid = true; }
  assert(paid && Math.abs(G.flags.taxPaid - 40000 * E.TAX_RATE) < 5000, 'tax paid ' + G.flags.taxPaid);
}
{ // front-running: offer -> trade ahead -> profit -> SEC fine -> second time prison
  let tried = 0, ok = false;
  for (let seed = 1; seed < 400 && !ok; seed++) {
    const G = E.newGame(seed); G.cash = 40000; G.unlocked.SOY = true; tried++;
    for (let d = 0; d < 80 && !G.over && !ok; d++) {
      E.startSession(G, 'SOY');
      while (G.sess && !G.sess.done) {
        const out = E.stepSession(G);
        for (const e of out) if (e.kind === 'offer') {
          const o = G.sess.offer; E.respondOffer(G, 'ahead');
          assert(E.trade(G, o.side, 20).ok, 'front-run trade');
          for (let i = 0; i < 45; i++) { E.stepSession(G); } // through the jump
          assert(G.flags.frontWin !== undefined);
          ok = true;
        }
        if (ok) break;
      }
      if (ok) { if (G.pos) E.flatten(G); runToClose(G); assert(G.heat === 1, 'heat'); G.sec = { at: G.day + 1, profit: 2000 }; E.skipDays(G, 2); assert(G.fined && !G.over, 'fined'); G.sec = { at: G.day + 1, profit: 2000 }; E.skipDays(G, 2); assert(G.over === 'prison', 'prison'); }
      else if (G.sess) runToClose(G);
    }
  }
  assert(ok, 'saw a front-run offer in ' + tried + ' careers');
}
{ const G = E.newGame(31); const f = E.checkAchievements(G); E.startSession(G, 'SOY'); E.stepSession(G); E.trade(G, 1, 1); assert(E.checkAchievements(G).some((a) => a.id === 'first')); }
console.log('OK');
