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
    assert(Number.isFinite(G.cash) && G.cash >= -1e-6, 'bad cash ' + G.cash);
  }
  return { name, seed, weeks, over: G.over, nw: Math.round(E.netWorth(G)), home: G.home, peak: Math.round(G.stats.peak) };
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
console.log('OK');

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
