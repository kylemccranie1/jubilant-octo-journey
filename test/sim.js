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
function fresh(seed, sym = 'SOY') { const G = E.newGame(seed); G.unlocked[sym] = true; E.startSession(G, sym); return G; }
{ // market order walks the book: big order moves price and costs slippage
  const G = fresh(21), S = G.sess; G.cash = 500000; E.stepSession(G);
  const ask0 = S.ask, p = E.preview(G, 1, 200); assert(p.slip > 3, 'preview shows slippage on a big order');
  const r = E.trade(G, 1, 40); assert(r.ok && r.px >= ask0 && S.ask > ask0, 'big buy lifts the offer ' + r.px + ' ' + ask0);
}
{ // round trip accounting: pay the spread + fees
  const G = fresh(22), S = G.sess; for (let i = 0; i < 5; i++) E.stepSession(G);
  const before = G.cash, a = E.trade(G, 1, 1), b = E.trade(G, -1, 1);
  assert(a.ok && b.ok && !G.pos);
  assert(Math.abs((G.cash - before) - ((b.px - a.px) * 12.5 - 2 * 3.0)) < 1e-6, 'pnl = ticks*val - fees');
  assert(!E.trade(G, 1, 50).ok, 'margin limit blocks oversize');
}
{ // crowd prints move the price in their direction on average
  let agree = 0, total = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const G = fresh(100 + seed), S = G.sess;
    for (let i = 0; i < 400 && !S.done; i++) {
      const before = (S.bid + S.ask) / 2, np = S.prints.length; E.stepSession(G);
      if (G.sess !== S) break;
      const neu = S.prints.slice(np).filter((p) => p[4] === 'pit');
      if (neu.length === 1 && neu[0][2] >= E.CBY.SOY.depth) { total++; const d = (S.bid + S.ask) / 2 - before; if (Math.sign(d) === neu[0][1]) agree++; }
    }
  }
  assert(total > 50 && agree / total > 0.7, `big prints move price their way ${agree}/${total}`);
}
{ // limit order: rests in queue, fills when crowd trades through it, earns the spread
  let filled = 0;
  for (let seed = 1; seed <= 30 && !filled; seed++) {
    const G = fresh(200 + seed), S = G.sess; E.stepSession(G);
    const r = E.placeLimit(G, 1, 2); assert(r.ok);
    for (let i = 0; i < 200 && !S.done; i++) { E.stepSession(G); if (G.pos) { filled = G.pos.qty; assert(G.pos.entry === S.orders.length ? true : G.pos.entry > 0); break; } }
  }
  assert(filled > 0, 'limit bid eventually filled');
  const G = fresh(300); E.stepSession(G); E.placeLimit(G, 1, 1); E.cancelOrders(G); assert(G.sess.orders.length === 0, 'cancel');
}
{ // margin call
  const G = fresh(23); E.stepSession(G); assert(E.trade(G, 1, E.maxLots(G, 'SOY')).ok);
  const S = G.sess; S.bids = {}; S.bid -= 300; S.ask -= 300; // crash the market
  const evs = []; for (let i = 0; i < 3; i++) evs.push(...E.stepSession(G));
  assert(evs.some((e) => e.kind === 'margin') && !G.pos, 'margin call');
}
{ // stop-loss
  const G = fresh(24); E.stepSession(G); E.trade(G, 1, 1); E.setStop(G, 8);
  const S = G.sess; S.bid -= 30; S.ask -= 30;
  const evs = []; for (let i = 0; i < 3; i++) evs.push(...E.stepSession(G));
  assert(evs.some((e) => e.kind === 'stop') && !G.pos, 'stopped out');
}
{ // overnight carry + settlement + pit locking
  const G = fresh(25); E.stepSession(G); E.trade(G, 1, 1); runToClose(G);
  assert(G.pos && G.pos.entry === G.mk.SOY.close, 'carried at settle');
  assert(!E.startSession(G, 'CRUDE').ok, 'cannot switch pit while holding');
  E.skipDays(G, 5); assert(G.pos.entry === G.mk.SOY.close, 'settles through skipped days');
}
{ const G = E.newGame(26); G.cash = 20000; const evs = E.skipDays(G, 1); assert(G.unlocked.CRUDE && evs.some((e) => e.kind === 'unlock'), 'unlock'); }
{ const G = E.newGame(27); G.cash = 2e6; assert(E.buyItem(G, 'home', 4).ok && E.buyItem(G, 'car', 4).ok); G.cash = 1000;
  const evs = []; for (let i = 0; i < 60 && !G.over; i++) evs.push(...E.skipDays(G, 21));
  assert(evs.some((e) => e.kind === 'repo') && G.over === 'homeless', 'repo→homeless'); }
{ const G = E.newGame(28); G.cash = 60000; G.ytd = 40000; let paid = false;
  for (let i = 0; i < 360 && !paid; i++) { E.skipDays(G, 1); if (G.flags.taxPaid) paid = true; }
  assert(paid && Math.abs(G.flags.taxPaid - 40000 * E.TAX_RATE) < 5000, 'tax'); }
{ // front-running: the customer block really sweeps the book; trading ahead can profit
  let ok = false, moved = 0;
  for (let seed = 1; seed < 300 && !ok; seed++) {
    const G = E.newGame(seed); G.cash = 40000;
    for (let d = 0; d < 80 && !G.over && !ok; d++) {
      E.startSession(G, 'SOY'); const S = G.sess;
      while (G.sess && !G.sess.done) {
        const out = E.stepSession(G);
        if (out.some((e) => e.kind === 'offer')) {
          const o = S.offer, mid0 = (S.bid + S.ask) / 2; E.respondOffer(G, 'ahead'); assert(E.trade(G, o.side, 10).ok);
          for (let i = 0; i < 40; i++) E.stepSession(G);
          moved = ((S.bid + S.ask) / 2 - mid0) * o.side; ok = true; break;
        }
      }
      if (ok) { if (G.pos) E.flatten(G); runToClose(G); assert(G.heat === 1);
        G.sec = { at: G.day + 1, profit: 2000 }; E.skipDays(G, 2); assert(G.fined && !G.over, 'fined');
        G.sec = { at: G.day + 1, profit: 2000 }; E.skipDays(G, 2); assert(G.over === 'prison', 'prison'); }
      else if (G.sess) runToClose(G);
    }
  }
  assert(ok && moved > 3, 'customer block moved the market ' + moved + ' ticks');
}
{ const G = fresh(31); E.stepSession(G); E.trade(G, 1, 1); assert(E.checkAchievements(G).some((a) => a.id === 'first')); }
{ // training floor hooks: no news/offers, scripted lean is followed, injected orders move the book
  const D = E.CBY.SOY.depth;
  const G0 = E.newGame(5); G0.unlocked.SOY = true; G0.cash = 60000; E.startSession(G0, 'SOY', { training: true });
  assert(G0.sess.training && G0.sess.events.length === 0 && !G0.sess.offer, 'training session is clean');
  const ask0 = G0.sess.ask, front = E.ladder(G0, 1).asks[0].size;
  E.inject(G0, 1, front + 5); assert(G0.sess.ask > ask0, 'injected buy clears the offer and steps price');
  let up = 0; const N = 80;
  for (let sd = 0; sd < N; sd++) {
    const G = E.newGame(900 + sd); G.unlocked.SOY = true; E.startSession(G, 'SOY', { training: true }); const S = G.sess;
    E.forceRegime(G, 1, 0.95, 120); for (let i = 0; i < 34; i++) E.stepSession(G);
    const m0 = (S.bid + S.ask) / 2; for (let i = 0; i < 22; i++) E.stepSession(G);
    if ((S.bid + S.ask) / 2 > m0) up++;
  }
  assert(up / N > 0.7, 'scripted buy lean carries price up ' + up + '/' + N);
}
console.log('OK');
