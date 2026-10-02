// Headless balance/sanity simulation: node test/sim.js
const E = require('../js/engine.js');
const assert = require('assert');

function run(name, seed, strat) {
  const G = E.newGame(seed);
  let weeks = 0;
  while (!G.over && weeks < 700) {
    strat(G);
    E.advanceWeek(G); weeks++;
    for (const t in G.stocks) assert(Number.isFinite(G.stocks[t].price), 'NaN price ' + t);
    assert(Number.isFinite(G.cash), 'bad cash ' + G.cash);
    assert(E.equity(G) > -1e7, 'absurd equity');
  }
  return { name, seed, weeks, over: G.over, nw: Math.round(E.netWorth(G)), peak: Math.round(G.stats.peak), ach: Object.keys(G.ach).length };
}
const idle = () => {};
function holdTech(G) { if (G.week === 0) E.buy(G, 'MTRX', E.maxBuy(G, 'MTRX')); }
function netBubble(G) {
  const d = E.dateOf(G.week), y = d.getUTCFullYear();
  if (y >= 1995 && !G.holdings.NNET && G.stocks.NNET.active && G.cash > 100) E.buy(G, 'NNET', E.maxBuy(G, 'NNET'));
  if (y >= 2000 && G.week && d.getUTCMonth() === 2 && G.holdings.NNET) E.sell(G, 'NNET', G.holdings.NNET.shares);
}
function degen(G) { // all-in on random stock every week
  for (const t of Object.keys(G.holdings)) E.sell(G, t, G.holdings[t].shares);
  const act = E.STOCKS.filter((s) => G.stocks[s.t].active);
  const s = act[Math.floor(Math.random() * act.length)];
  E.buy(G, s.t, E.maxBuy(G, s.t));
}
function tipFollower(G) { // follow tips each week, sell everything else
  for (const t of Object.keys(G.holdings)) E.sell(G, t, G.holdings[t].shares);
  const tp = G.tips.find((x) => x.up);
  if (tp) E.buy(G, tp.t, E.maxBuy(G, tp.t));
}
for (const seed of [1, 2, 3, 4, 5]) {
  console.log(run('idle', seed, idle));
  console.log(run('hold MTRX', seed, holdTech));
  console.log(run('net bubble', seed, netBubble));
  console.log(run('degen', seed, degen));
}
console.log(run('tipFollower(no gear)', 1, tipFollower));


// lifestyle + repo flow
{
  const G = E.newGame(7);
  G.cash = 2e6;
  for (const [c, i] of [['home', 4], ['car', 4], ['tech', 3]]) assert(E.buyItem(G, c, i).ok, c);
  assert(E.buyItem(G, 'lux', 'rolex').ok);
  assert(!E.buyItem(G, 'car', 1).ok, 'no downgrade purchase');
  G.cash = 5000; // crash
  const evs = [];
  for (let i = 0; i < 12; i++) evs.push(...E.advanceWeek(G).events);
  assert(evs.some((e) => e.kind === 'repo'), 'expected repo event');
  assert(G.home < 4 || G.car < 4, 'lost something');
  console.log('repo flow ok →', { home: G.home, car: G.car, tech: G.tech, lux: G.lux.length, cash: Math.round(G.cash), over: G.over });
}

function leveraged(G) { // always max leverage in a random stock
  for (const t of Object.keys(G.holdings)) if (Math.random() < .2) E.sell(G, t, G.holdings[t].shares);
  const act = E.STOCKS.filter((s) => G.stocks[s.t].active && !G.shorts[s.t]);
  const s = act[Math.floor(Math.random() * act.length)];
  E.buy(G, s.t, E.maxBuy(G, s.t));
}
function shortNetsAtCrash(G) {
  const d = E.dateOf(G.week), y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (y === 2000 && m === 3 && !G.shorts.NNET && G.stocks.NNET.active && !G.holdings.NNET) E.short(G, 'NNET', E.maxShort(G, 'NNET'));
  if (y === 2000 && m === 9 && G.shorts.NNET) E.cover(G, 'NNET', G.shorts.NNET.shares);
  netBubble.__noSell = true;
  if (y >= 1995 && y < 2000 && !G.holdings.NNET && G.stocks.NNET.active && G.cash > 100) E.buy(G, 'NNET', E.maxBuy(G, 'NNET'));
  if (y === 2000 && m === 2 && G.holdings.NNET) E.sell(G, 'NNET', G.holdings.NNET.shares);
}
function indexer(G) { if (G.week === 0) E.buy(G, 'IDX', Math.floor((G.cash - E.commission(G)) / G.stocks.IDX.price)); }
function insiderFan(G) { // accept every offer, go all-in the right way
  if (G.offer) { const o = G.offer; E.acceptOffer(G); const t = o.t;
    if (o.up) E.buy(G, t, E.maxBuy(G, t)); else E.short(G, t, E.maxShort(G, t)); }
  else for (const t of Object.keys(G.holdings)) E.sell(G, t, G.holdings[t].shares);
  if (!G.insider) { for (const t of Object.keys(G.shorts)) E.cover(G, t, G.shorts[t].shares); for (const t of Object.keys(G.holdings)) E.sell(G, t, G.holdings[t].shares); }
}
function tally(name, strat, n = 40) {
  const res = { homeless: 0, prison: 0, end: 0, margin: 0, nws: [] };
  for (let i = 1; i <= n; i++) {
    const G = E.newGame(100 + i); let w = 0;
    while (!G.over && w < 700) { strat(G); E.advanceWeek(G); w++; }
    res[G.over]++; if (G.flags.margin) res.margin++; res.nws.push(E.netWorth(G));
  }
  res.nws.sort((a, b) => a - b);
  console.log(name.padEnd(12), `homeless ${res.homeless} prison ${res.prison} survived ${res.end} marginCalls ${res.margin}  median NW $${Math.round(res.nws[n >> 1]).toLocaleString()}  p90 $${Math.round(res.nws[Math.floor(n * .9)]).toLocaleString()}`);
}
console.log('--- 40-seed tallies');
tally('idle', idle); tally('indexer', indexer); tally('leveraged', leveraged); tally('net+short', shortNetsAtCrash); tally('insiderFan', insiderFan); tally('degen', degen);

// --- targeted mechanics
{
  const G = E.newGame(11);
  G.cash = 20000; G.week = 60;
  const p = G.stocks.MTRX.price;
  assert(E.short(G, 'MTRX', 100).ok);
  assert(!E.buy(G, 'MTRX', 1).ok, 'cannot buy while short');
  G.stocks.MTRX.price = p * .8;
  const before = G.stats.realized;
  assert(E.cover(G, 'MTRX', 100).ok);
  assert(G.stats.realized > before, 'short profit realized');
  assert(Math.abs(G.ytd - (G.stats.realized)) < 1e-9, 'ytd tracks realized');
}
{ // margin: leveraged long, crash, forced liquidation
  const G = E.newGame(12); G.cash = 10000;
  const n = E.maxBuy(G, 'GULF'); assert(E.buy(G, 'GULF', n).ok); assert(G.cash < 0, 'on margin');
  assert(!E.buy(G, 'GULF', 50).ok, 'limit enforced');
  G.stocks.GULF.price *= .5; // -50%
  G.next.rets = {}; const ev = E.advanceWeek(G).events;
  assert(ev.some((e) => e.kind === 'margin'), 'margin call'); assert(!G.holdings.GULF, 'liquidated');
}
{ // tax: gain in 1990, bill in Jan 1991 -> April payment
  const G = E.newGame(13); G.cash = 50000; G.ytd = 40000; G.week = 51; // late Dec 1990
  G.billMonth = 11 + 12 * 1990; G.next.week = 52;
  let paid = false;
  for (let i = 0; i < 20; i++) { E.advanceWeek(G); if (G.flags.taxPaid) paid = true; }
  assert(paid && Math.abs(G.flags.taxPaid - 40000 * E.TAX_RATE) < 1, 'tax paid ' + G.flags.taxPaid);
}
{ // insider -> SEC fine -> prison on repeat
  const G = E.newGame(14); G.cash = 100000;
  G.offer = { t: 'GULF', up: true, mv: .4 }; E.acceptOffer(G);
  E.buy(G, 'GULF', 500); E.advanceWeek(G);
  assert(G.flags.insiderWin, 'insider profit');
  G.sec = { at: G.week + 1, profit: 20000 }; E.advanceWeek(G);
  assert(G.fined && !G.over, 'fined');
  G.sec = { at: G.week + 1, profit: 20000 }; E.advanceWeek(G);
  assert(G.over === 'prison', 'prison on 2nd');
}
{ const G = E.newGame(15); const ev = E.checkAchievements(G); assert(Array.isArray(ev)); E.buy(G, 'IDX', 10); assert(E.checkAchievements(G).some((a) => a.id === 'first')); }
console.log('OK');
