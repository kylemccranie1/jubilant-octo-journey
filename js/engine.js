/* The Pit '90 — game engine (pure logic, no DOM). Works in browser and Node. */
(function (root) {
  'use strict';

  const START_CASH = 8000;
  const START_MS = Date.UTC(1990, 0, 1);
  const END_MS = Date.UTC(2001, 0, 1);
  const SELL_RATIO = 0.6;
  const TAX_RATE = 0.28;
  const MAINT = 0.75;          // maintenance margin = 75% of initial
  const N_STEPS = 520;         // price ticks per trading session
  const STEP_MS = 150;         // real-time ms per step (UI pacing)
  const SAVE_VERSION = 3;
  const K_FLOW = 0.22;         // strength of order-flow drift (in session-sigma units per step)

  // ---------------------------------------------------------------- calendar (weekdays only)
  const dateOfDay = (day) => { const k = day + 1, w = Math.floor(k / 5), dow = k % 5; return new Date(START_MS + (w * 7 + dow) * 864e5); };
  const monthIdxOfDay = (day) => { const d = dateOfDay(day); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
  const dayOfDate = (y, m, d) => { // first trading day on/after the calendar date
    const target = Date.UTC(y, m - 1, d); let day = Math.max(0, Math.floor((target - START_MS) / 864e5 * 5 / 7) - 3);
    while (dateOfDay(day).getTime() < target) day++;
    return day;
  };
  const clockOf = (t) => { const mins = Math.floor(t / N_STEPS * 390) + 8 * 60 + 30; return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`; }; // CT session 8:30-15:00

  // ---------------------------------------------------------------- contracts
  // anchors: approximate real price history; the game's price wanders around this path
  const A = (y, m, p) => [Date.UTC(y, m - 1, 1), p];
  const CONTRACTS = [
    { sym: 'SOY', name: 'Soybeans', pit: 'CBOT Grain Pit', emoji: '🌱', tick: .25, tickVal: 12.5, vol: .011, margin: 1000, depth: 15, unlock: 0,
      anchors: [A(1990, 1, 570), A(1991, 1, 600), A(1993, 1, 580), A(1993, 8, 700), A(1994, 6, 660), A(1996, 6, 800), A(1997, 6, 830), A(1998, 6, 640), A(1999, 6, 480), A(2000, 6, 530), A(2000, 12, 520)] },
    { sym: 'CRUDE', name: 'Crude Oil', pit: 'NYMEX Energy Pit', emoji: '🛢️', tick: .01, tickVal: 10, vol: .018, margin: 2000, depth: 12, unlock: 12000,
      anchors: [A(1990, 1, 21), A(1990, 7, 17), A(1990, 10, 37), A(1991, 2, 20), A(1992, 6, 21), A(1994, 6, 18), A(1996, 12, 25), A(1998, 12, 11), A(1999, 12, 25), A(2000, 9, 33), A(2000, 12, 26)] },
    { sym: 'DM', name: 'Deutschmark', pit: 'CME Currency Pit', emoji: '💶', tick: .0001, tickVal: 12.5, vol: .006, margin: 2000, depth: 12, unlock: 30000,
      anchors: [A(1990, 1, .60), A(1992, 9, .70), A(1993, 6, .62), A(1995, 4, .73), A(1997, 7, .54), A(1999, 1, .59), A(2000, 10, .43), A(2000, 12, .46)] },
    { sym: 'BOND', name: 'T-Bonds', pit: 'CBOT Financial Pit', emoji: '📜', tick: 1 / 32, tickVal: 31.25, vol: .006, margin: 3000, depth: 10, unlock: 80000,
      anchors: [A(1990, 1, 91), A(1991, 6, 97), A(1993, 10, 117), A(1994, 11, 98), A(1995, 12, 118), A(1996, 6, 108), A(1998, 10, 126), A(2000, 1, 98), A(2000, 12, 112)] },
    { sym: 'SPX', name: 'S&P 500', pit: 'CME Index Pit', emoji: '📈', tick: .05, tickVal: 25, vol: .009, margin: 9000, depth: 8, unlock: 250000,
      anchors: [A(1990, 1, 353), A(1990, 10, 295), A(1991, 6, 375), A(1992, 6, 410), A(1994, 6, 450), A(1995, 6, 540), A(1996, 6, 670), A(1997, 6, 880), A(1998, 6, 1130), A(1998, 10, 960), A(1999, 6, 1330), A(2000, 3, 1500), A(2000, 12, 1320)] },
  ];
  const CBY = {}; CONTRACTS.forEach((c) => { CBY[c.sym] = c; });
  const ERA_VOL = { 1990: .20, 1991: .15, 1992: .13, 1993: .10, 1994: .14, 1995: .10, 1996: .13, 1997: .17, 1998: .22, 1999: .20, 2000: .28 };

  function priceOf(sym, ticks) { return ticks * CBY[sym].tick; }
  function fmtPrice(sym, ticks) {
    const p = ticks * CBY[sym].tick;
    switch (sym) {
      case 'SOY': return p.toFixed(2);
      case 'CRUDE': return '$' + p.toFixed(2);
      case 'DM': return p.toFixed(4);
      case 'BOND': { let pts = Math.floor(p + 1e-9), f = Math.round((p - pts) * 32); if (f === 32) { pts++; f = 0; } return pts + '-' + String(f).padStart(2, '0'); }
      default: return p.toFixed(2);
    }
  }
  function anchorPrice(sym, ms) {
    const a = CBY[sym].anchors;
    if (ms <= a[0][0]) return a[0][1];
    for (let i = 1; i < a.length; i++) {
      if (ms <= a[i][0]) {
        const f = (ms - a[i - 1][0]) / (a[i][0] - a[i - 1][0]);
        return Math.exp(Math.log(a[i - 1][1]) * (1 - f) + Math.log(a[i][1]) * f);
      }
    }
    return a[a.length - 1][1];
  }

  // scripted history: impact = log-return shock per contract
  const E_ = (y, m, d, text, imp) => ({ day: null, at: [y, m, d], text, imp });
  const ERA_EVENTS = [
    E_(1990, 8, 6, 'IRAQ INVADES KUWAIT! Crude spikes, stocks tumble.', { CRUDE: .12, SPX: -.03, SOY: .01, BOND: .008, DM: .005 }),
    E_(1991, 1, 17, 'DESERT STORM BEGINS! Crude collapses, stocks rip.', { CRUDE: -.30, SPX: .045, BOND: -.005 }),
    E_(1992, 9, 16, 'BLACK WEDNESDAY! Soros breaks the pound; the Mark soars.', { DM: .02, SPX: -.01 }),
    E_(1993, 7, 12, 'GREAT FLOOD OF \'93 devastates Midwest crops. Beans limit up!', { SOY: .06 }),
    E_(1994, 2, 4, 'FED HIKES RATES! Bond market bloodbath.', { BOND: -.02, SPX: -.022 }),
    E_(1994, 12, 20, 'Mexican peso collapses. Flight to safety.', { SPX: -.01, DM: .005, BOND: .006 }),
    E_(1995, 3, 6, 'Dollar plunges against the Deutschmark!', { DM: .02 }),
    E_(1996, 12, 5, 'Greenspan warns of "irrational exuberance". Markets dive.', { SPX: -.02, BOND: -.01 }),
    E_(1997, 8, 18, 'Dollar surges; the Mark gets hammered.', { DM: -.02 }),
    E_(1997, 10, 27, 'ASIAN CRISIS! Dow plunges 554 points. Circuit breakers trip!', { SPX: -.07, BOND: .02, CRUDE: -.03 }),
    E_(1997, 10, 28, 'Dip buyers storm back. Biggest point rally ever.', { SPX: .045 }),
    E_(1998, 8, 17, 'RUSSIA DEFAULTS! Hedge funds in trouble.', { SPX: -.04, BOND: .02, CRUDE: -.04 }),
    E_(1998, 10, 15, 'Fed cuts rates in surprise move. Stocks surge!', { SPX: .04, BOND: .02 }),
    E_(2000, 4, 14, 'NASDAQ CRASH! Dot-com wipeout drags the S&P.', { SPX: -.06 }),
    E_(2000, 9, 25, 'OPEC fumbles; crude spikes to a ten-year high.', { CRUDE: .05 }),
  ];
  ERA_EVENTS.forEach((e) => { e.day = dayOfDate(...e.at); });
  const eventsByDay = {}; ERA_EVENTS.forEach((e) => { (eventsByDay[e.day] = eventsByDay[e.day] || []).push(e); });

  const NEWS_TEMPLATES = {
    SOY: [['USDA report: yields ABOVE expectations. Beans slide.', -1, .02], ['USDA report: crop smaller than expected. Beans jump!', 1, .02], ['China buys a big chunk of the crop.', 1, .015]],
    CRUDE: [['API inventories: BIG BUILD. Crude drops.', -1, .025], ['API inventories: surprise DRAW. Crude pops.', 1, .025], ['Pipeline outage rattles the energy pit.', 1, .02]],
    DM: [['Bundesbank sounds hawkish. Mark rallies.', 1, .008], ['Bundesbank dovish. Mark slips.', -1, .008], ['German reunification costs worry the Mark.', -1, .007]],
    BOND: [['Fed speaker hints at tighter policy. Bonds sell off.', -1, .008], ['Soft jobs report. Bonds rally.', 1, .008], ['Inflation print hot. Long end hammered.', -1, .01]],
    SPX: [['Blue-chip earnings blow past estimates!', 1, .01], ['Profit warning from a Dow component.', -1, .01], ['Takeover chatter fuels a rally.', 1, .008]],
  };

  const HOMES = [
    { id: 0, name: 'Roach-Motel Studio', emoji: '🪳', rent: 300, desc: 'Thin walls, thinner wallet. Everyone starts somewhere.' },
    { id: 1, name: 'One-Bedroom Apartment', emoji: '🏢', rent: 800, desc: 'A real couch! And a door that locks.' },
    { id: 2, name: 'Yuppie Condo', emoji: '🏙️', rent: 2200, desc: 'Exposed brick, answering machine, track lighting.' },
    { id: 3, name: 'Suburban Townhouse', emoji: '🏡', rent: 5000, desc: 'Two-car garage and a lawn guy named Hector.' },
    { id: 4, name: 'Manhattan Penthouse', emoji: '🌃', rent: 14000, desc: 'Doorman, skyline, zero regrets.' },
    { id: 5, name: 'Hamptons Mansion', emoji: '🏰', rent: 40000, desc: 'Helipad. Wine cellar. Rival who hates you.' },
  ];
  const CARS = [
    { id: 0, name: 'Bus Pass', emoji: '🚌', price: 0, upkeep: 0, desc: 'The 14 crosstown. Smells like rain.' },
    { id: 1, name: "'85 Honda Civic", emoji: '🚗', price: 3500, upkeep: 80, desc: 'Cassette deck, one working speaker.' },
    { id: 2, name: 'Saab 900 Turbo', emoji: '🚙', price: 16000, upkeep: 200, desc: 'Quirky. Very 1989 yuppie.' },
    { id: 3, name: 'BMW 535i', emoji: '🚘', price: 38000, upkeep: 350, desc: 'The ultimate power-lunch ride.' },
    { id: 4, name: 'Porsche 911', emoji: '🏎️', price: 85000, upkeep: 700, desc: 'Red, loud, and tax-deductible (it is not).' },
    { id: 5, name: 'Ferrari Testarossa', emoji: '🔴', price: 190000, upkeep: 1500, desc: 'Side strakes. Miami Vice approved.' },
    { id: 6, name: 'Stretch Limo + Driver', emoji: '🛻', price: 400000, upkeep: 5000, desc: 'Moonroof for waving at peasants.' },
  ];
  // Floor gear: per-side clearing fee, how truthful the pit's shouting is (rel), and daily tips
  const TECH = [
    { id: 0, name: 'Rotary Phone & WSJ', emoji: '☎️', price: 0, upkeep: 0, fee: 3.0, rel: .55, tips: 0, desc: 'Standard clearing fees ($3.00/side). Pit chatter only 55% reliable.' },
    { id: 1, name: 'Motorola Brick Phone', emoji: '📱', price: 1500, upkeep: 50, fee: 2.4, rel: .62, tips: 1, desc: '$2.40/side. Chatter 62% reliable + 1 morning tip.' },
    { id: 2, name: 'IBM PC + Prodigy Modem', emoji: '🖥️', price: 4500, upkeep: 80, fee: 1.8, rel: .68, tips: 1, desc: '$1.80/side. Chatter 68% reliable + 1 tip.' },
    { id: 3, name: 'Quotron Terminal', emoji: '📟', price: 15000, upkeep: 250, fee: 1.2, rel: .74, tips: 2, desc: '$1.20/side. Chatter 74% reliable + 2 tips.' },
    { id: 4, name: 'Bloomberg Desk (4 monitors)', emoji: '🖲️', price: 70000, upkeep: 900, fee: .8, rel: .82, tips: 2, desc: '$0.80/side. Chatter 82% reliable + 2 tips.' },
    { id: 5, name: 'Private Trading Floor', emoji: '🏛️', price: 350000, upkeep: 5000, fee: .4, rel: .90, tips: 3, desc: '$0.40/side. Chatter 90% reliable + 3 tips.' },
  ];

  const LUX = [
    { id: 'jacket', name: 'Members Only Jacket', emoji: '🧥', price: 250, upkeep: 0, desc: 'Epaulets and attitude.' },
    { id: 'suit', name: 'Armani Power Suit', emoji: '🕴️', price: 3000, upkeep: 0, desc: 'Shoulder pads: structural, not optional.' },
    { id: 'rolex', name: 'Rolex Submariner', emoji: '⌚', price: 9000, upkeep: 0, desc: 'Water-resistant to 300m of ego.' },
    { id: 'tix', name: 'Knicks Courtside Seats', emoji: '🏀', price: 20000, upkeep: 100, desc: 'Spike Lee is two seats down.' },
    { id: 'art', name: 'Neo-Expressionist Painting', emoji: '🖼️', price: 120000, upkeep: 0, desc: "Nobody knows what it means. That's the point." },
    { id: 'yacht', name: 'Sailboat', emoji: '⛵', price: 90000, upkeep: 600, desc: 'Name it something punny.' },
    { id: 'jet', name: 'Private Jet Share', emoji: '🛩️', price: 600000, upkeep: 6000, desc: 'Lunch in Aspen. Back for the close.' },
  ];

  const RANKS = [
    [0, 'Dead Broke'], [5e3, 'Broke Kid'], [15e3, 'Penny Pincher'], [5e4, 'Weekend Warrior'],
    [15e4, 'Rising Trader'], [5e5, 'Yuppie'], [2e6, 'Wall Street Hotshot'],
    [1e7, 'Master of the Universe'], [5e7, 'Gordon Gekko'],
  ];
  const rankOf = (nw) => { let r = RANKS[0][1]; for (const [min, name] of RANKS) if (nw >= min) r = name; return r; };

  // ---------------------------------------------------------------- rng
  function rnd(G) {
    G.rs = (G.rs + 0x6D2B79F5) | 0;
    let t = G.rs;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  }
  function gauss(G) {
    let u = 0; while (u === 0) u = rnd(G);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd(G));
  }
  const pick = (G, a) => a[Math.floor(rnd(G) * a.length)];
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const money = (n) => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');

  // ---------------------------------------------------------------- state
  function newGame(seed) {
    const G = {
      v: SAVE_VERSION, rs: (seed == null ? (Math.random() * 2 ** 31) | 0 : seed) | 0,
      day: 0, cash: START_CASH, pos: null, mk: {}, today: null, sess: null, tips: [],
      home: 0, car: 0, tech: 0, lux: [], billMonth: monthIdxOfDay(0),
      ytd: 0, taxDue: 0, heat: 0, fined: false, sec: null, lastOffer: -99, flags: {}, ach: {},
      unlocked: { SOY: true }, news: [], seq: 0, nwHist: [START_CASH], over: null, lastSession: null,
      stats: { trades: 0, wins: 0, losses: 0, realized: 0, fees: 0, peak: START_CASH, peakDay: 0, sessions: 0, bestDay: 0, worstDay: 0, streak: 0 },
    };
    for (const c of CONTRACTS) G.mk[c.sym] = { close: Math.round(anchorPrice(c.sym, START_MS) / c.tick) };
    prepareDay(G); makeTips(G);
    addNews(G, 'era', 'January 1990. $8,000, a trading badge and a colored jacket. Welcome to the pit.');
    return G;
  }
  function addNews(G, tag, text) {
    G.seq++;
    G.news.unshift({ day: G.day, tag, text });
    if (G.news.length > 150) G.news.length = 150;
  }

  // ---------------------------------------------------------------- daily macro model
  function prepareDay(G) {
    const day = G.day, d = dateOfDay(day), ms = d.getTime(), year = d.getUTCFullYear();
    const prevMs = dateOfDay(Math.max(0, day - 1)).getTime();
    const evs = eventsByDay[day] || [], per = {};
    for (const c of CONTRACTS) {
      const mk = G.mk[c.sym];
      const sig = c.vol * (c.sym === 'SPX' ? Math.sqrt((ERA_VOL[year] || .2) / .15) : 1);
      const dev = Math.log(mk.close * c.tick) - Math.log(anchorPrice(c.sym, prevMs));
      const ret = Math.log(anchorPrice(c.sym, ms)) - Math.log(anchorPrice(c.sym, prevMs)) - 0.015 * dev + sig * gauss(G);
      let shock = 0, text = null, scripted = false;
      for (const e of evs) if (e.imp[c.sym]) { shock += e.imp[c.sym]; text = text || e.text; scripted = true; }
      if (!scripted && rnd(G) < .07) {
        const tpl = pick(G, NEWS_TEMPLATES[c.sym]);
        shock = tpl[1] * tpl[2] * (0.6 + 0.8 * rnd(G)); text = tpl[0];
      }
      const total = ret + shock, gap = 0.35 * sig * gauss(G);
      per[c.sym] = {
        openT: Math.max(8, Math.round(mk.close * Math.exp(gap))), closeT: Math.max(8, Math.round(mk.close * Math.exp(total))),
        sig, shock, text, scripted,
      };
    }
    G.today = { day, per };
  }

  function makeTips(G) {
    G.tips = [];
    const tier = TECH[G.tech];
    const syms = CONTRACTS.filter((c) => G.unlocked[c.sym]).map((c) => c.sym);
    const used = new Set();
    for (let i = 0; i < tier.tips && syms.length; i++) {
      const sym = pick(G, syms); if (used.has(sym)) continue; used.add(sym);
      const per = G.today.per[sym], truth = per.closeT >= per.openT;
      const up = rnd(G) < tier.rel ? truth : !truth;
      G.tips.push({ sym, up, text: `Your guy on the floor says ${CBY[sym].name} ${up ? 'closes HIGHER 📈' : 'closes LOWER 📉'} today.` });
    }
  }

  // ---------------------------------------------------------------- trading session
  const JUMP_W = [.30, .22, .16, .12, .08, .06, .04, .02];
  const bidT = (S, t) => Math.floor(S.path[t]);

  function startSession(G, sym) {
    const c = CBY[sym];
    if (G.over || G.sess) return { ok: false, msg: 'Not available.' };
    if (!c || !G.unlocked[sym]) return { ok: false, msg: 'That pit is locked.' };
    if (G.pos && G.pos.sym !== sym) return { ok: false, msg: `You're holding ${G.pos.sym}. Trade that pit to close it out.` };
    const N = N_STEPS, per = G.today.per[sym], open = per.openT, close = per.closeT;
    const sigStep = open * per.sig * 0.9 / Math.sqrt(N);

    const flow = new Array(N).fill(0);
    for (let t = Math.floor(rnd(G) * 25); t < N;) {
      const len = 20 + Math.floor(rnd(G) * 60), r = rnd(G), f = r < .18 ? 0 : (r < .59 ? 1 : -1), s = .4 + .6 * rnd(G);
      for (let i = t; i < Math.min(N, t + len); i++) flow[i] = f * s;
      t += len + 5 + Math.floor(rnd(G) * 20);
    }
    const jump = new Array(N + 1).fill(0), events = [];
    if (per.text) {
      const tEv = 60 + Math.floor(rnd(G) * 320), J = open * (Math.exp(per.shock) - 1);
      JUMP_W.forEach((w, k) => { jump[tEv + 1 + k] += J * w; });
      events.push({ t: tEv, text: per.text, jump: J, scripted: per.scripted });
    }
    const path = [open]; let m = open;
    for (let i = 0; i < N; i++) { m += flow[i] * K_FLOW * sigStep + sigStep * 0.97 * gauss(G) + jump[i + 1]; path.push(m); }
    const resid = close - path[N];
    for (let i = 0; i <= N; i++) path[i] += resid * i / N;

    const rel = TECH[G.tech].rel, shouts = [];
    for (let i = 0; i < N; i++) {
      if (rnd(G) >= .2) continue;
      const f = Math.sign(flow[i]);
      const side = f !== 0 && rnd(G) < rel ? f : (rnd(G) < .5 ? 1 : -1);
      shouts.push([i, side, pick(G, [5, 10, 10, 20, 25, 50, 100])]);
    }

    let offer = null;
    if (netWorth(G) >= 15000 && !G.sec && G.day - G.lastOffer >= 15 && rnd(G) < .10) {
      const side = rnd(G) < .5 ? 1 : -1, t0 = 100 + Math.floor(rnd(G) * 250), lots = pick(G, [100, 150, 200, 300]);
      const J = Math.round(side * (0.35 + 0.25 * rnd(G)) * open * per.sig * 1.5), jt = t0 + 30;
      let cum = 0;
      for (let i = 0; i <= N; i++) { const k = i - (jt + 1); if (k >= 0 && k < JUMP_W.length) cum += J * JUMP_W[k]; path[i] += cum; }
      offer = { t: t0, side, lots, J, jt, bonus: lots * 2.5, resolved: null };
      G.lastOffer = G.day;
    }
    G.sess = { sym, n: N, t: 0, path, shouts, events, offer, stop: 0, done: false, startEq: 0, wins: 0, trades: 0, scripted: !!per.scripted && !!per.text, aheadEntry: null };
    G.sess.startEq = equity(G);
    G.stats.sessions++;
    if (sym === 'SPX') G.flags.spx = true;
    if (sym === 'BOND') G.flags.bond = true;
    return { ok: true };
  }

  const markT = (G) => (!G.pos ? 0 : (G.sess && G.sess.sym === G.pos.sym ? G.sess.path[G.sess.t] : G.mk[G.pos.sym].close));
  function unreal(G) { return G.pos ? (markT(G) - G.pos.entry) * G.pos.qty * CBY[G.pos.sym].tickVal : 0; }
  const equity = (G) => G.cash + unreal(G);
  const maxLots = (G, sym) => Math.max(0, Math.floor(equity(G) / CBY[sym].margin + 1e-9));

  function trade(G, side, qty, forced) {
    const S = G.sess;
    if (!S || S.done || G.over) return { ok: false, msg: 'The pit is closed.' };
    qty = Math.floor(qty);
    if (qty < 1) return { ok: false, msg: 'Invalid size.' };
    const c = CBY[S.sym], t = S.t, cur = G.pos ? G.pos.qty : 0, next = cur + side * qty;
    const increasing = Math.abs(next) > Math.abs(cur);
    if (!forced && increasing && Math.abs(next) > maxLots(G, S.sym)) {
      return { ok: false, msg: `Margin: ${S.sym} needs ${money(c.margin)}/lot — you can hold ${maxLots(G, S.sym)}.` };
    }
    const slip = Math.floor((qty - 1) / c.depth) + (forced ? 1 : 0);
    const px = side > 0 ? bidT(S, t) + 1 + slip : bidT(S, t) - slip;
    const fee = qty * TECH[G.tech].fee;
    let realized = 0, closeQ = 0;
    if (cur !== 0 && Math.sign(cur) !== side) {
      closeQ = Math.min(Math.abs(cur), qty);
      realized = (px - G.pos.entry) * Math.sign(cur) * closeQ * c.tickVal;
    }
    if (cur === 0 || Math.sign(cur) === side) {
      G.pos = { sym: S.sym, qty: next, entry: (cur === 0 ? px : (G.pos.entry * Math.abs(cur) + px * qty) / (Math.abs(cur) + qty)) };
    } else if (next === 0) G.pos = null;
    else if (Math.sign(next) === Math.sign(cur)) G.pos.qty = next;       // partial close
    else G.pos = { sym: S.sym, qty: next, entry: px };                    // flipped
    G.cash += realized - fee; G.ytd += realized - fee;
    G.stats.realized += realized - fee; G.stats.fees += fee; G.stats.trades++; S.trades++;
    if (closeQ > 0) {
      const net = realized - fee * closeQ / qty;
      if (net > 0) { G.stats.wins++; S.wins++; } else G.stats.losses++;
      if (S.wins >= 10) G.flags.scalper = true;
    }
    const o = S.offer;
    if (o && o.resolved === 'ahead' && !forced && side === o.side && t >= o.t && t <= o.jt && increasing && !S.aheadEntry) S.aheadEntry = { px, qty };
    return { ok: true, px, realized, fee, msg: `${side > 0 ? 'Bought' : 'Sold'} ${qty} ${S.sym} @ ${fmtPrice(S.sym, px)}` };
  }
  function flatten(G, forced) { return G.pos && G.sess ? trade(G, -Math.sign(G.pos.qty), Math.abs(G.pos.qty), forced) : { ok: false, msg: 'Already flat.' }; }
  function setStop(G, ticks) { if (G.sess) G.sess.stop = ticks; }
  function respondOffer(G, choice) {
    const S = G.sess, o = S && S.offer;
    if (!o || o.resolved) return { ok: false, msg: 'No order.' };
    o.resolved = choice;
    if (choice === 'honest') { G.cash += o.bonus; G.ytd += o.bonus; return { ok: true, msg: `You filled the customer fairly and earned ${money(o.bonus)} in brokerage.` }; }
    G.heat++;
    return { ok: true, msg: 'You\'re trading ahead of the customer. Be quick — and pray nobody\'s watching.' };
  }
  // pit sentiment: net signed size of shouts in the last `w` steps
  function recentFlow(G, w) {
    const S = G.sess; if (!S) return 0; let sum = 0;
    for (let i = S.shouts.length - 1; i >= 0; i--) { const s = S.shouts[i]; if (s[0] > S.t) continue; if (s[0] <= S.t - w) break; sum += s[1] * s[2]; }
    return sum;
  }
  const shoutsNow = (G, n) => { const S = G.sess, out = []; if (!S) return out; for (let i = S.shouts.length - 1; i >= 0 && out.length < n; i--) if (S.shouts[i][0] <= S.t) out.push(S.shouts[i]); return out; };

  function stepSession(G) {
    const S = G.sess, events = [];
    if (!S || S.done) return events;
    if (S.offer && !S.offer.resolved && S.t >= S.offer.t) S.offer.resolved = 'ignored';
    S.t++;
    const t = S.t, c = CBY[S.sym];
    for (const ev of S.events) if (ev.t === t) { addNews(G, 'mkt', ev.text); events.push({ kind: 'headline', text: ev.text, jump: ev.jump, scripted: ev.scripted }); }
    const o = S.offer;
    if (o && !o.resolved && o.t === t) events.push({ kind: 'offer', text: `Your broker flashes you a ${o.lots}-lot ${o.side > 0 ? 'BUY' : 'SELL'} order in ${c.name} — a big customer. It'll move the market in a few seconds. Fill it fairly for ${money(o.bonus)} brokerage… or trade ahead of it first?` });
    if (o && o.resolved === 'ahead' && t === o.jt + 8) settleFrontRun(G, events);
    if (G.pos) {
      if (equity(G) < MAINT * c.margin * Math.abs(G.pos.qty)) {
        flatten(G, true); G.flags.margin = true;
        const text = 'MARGIN CALL! Your clearing firm liquidated your position.';
        addNews(G, 'life', text); events.push({ kind: 'margin', text });
      } else if (S.stop > 0 && (G.pos.entry - S.path[t]) * Math.sign(G.pos.qty) >= S.stop) {
        flatten(G, true); G.flags.stop = true;
        events.push({ kind: 'stop', text: 'Stop-loss hit — position closed.' });
      }
    }
    if (t >= S.n) finishSession(G, events);
    return events;
  }

  function settleFrontRun(G, events) {
    const S = G.sess, o = S.offer, a = S.aheadEntry;
    if (!a) { events.push({ kind: 'insider', text: 'You hesitated and didn\'t trade ahead. The customer order hit the market without you.' }); return; }
    const gain = (S.path[S.t] - a.px) * o.side * a.qty * CBY[S.sym].tickVal;
    if (gain > 0) {
      G.flags.frontWin = true;
      const p = .25 + .2 * (G.heat - 1);
      if (rnd(G) < p) G.sec = { at: G.day + 10 + Math.floor(rnd(G) * 20), profit: gain, warned: false };
      const text = `Front-running paid off: ~${money(gain)} on the customer's order. Hope the exchange compliance guys weren't watching…`;
      addNews(G, 'life', text); events.push({ kind: 'insider', text });
    } else events.push({ kind: 'insider', text: 'You traded ahead… but it didn\'t pay. You took the risk and none of the reward.' });
  }

  function finishSession(G, events) {
    const S = G.sess; S.done = true;
    const sym = S.sym, closeT = Math.round(S.path[S.n]);
    const closes = {}; closes[sym] = closeT;
    endOfDay(G, events, closes, S);
  }

  // ---------------------------------------------------------------- end of day: settlement, margin, bills, tax
  function endOfDay(G, events, closes, S) {
    const date = dateOfDay(G.day);
    for (const e of eventsByDay[G.day] || []) addNews(G, 'era', e.text);
    // daily settlement of variation margin
    const cashBefore = G.cash;
    for (const c of CONTRACTS) {
      const closeT = closes && closes[c.sym] != null ? closes[c.sym] : G.today.per[c.sym].closeT;
      if (G.pos && G.pos.sym === c.sym) {
        const v = (closeT - G.pos.entry) * G.pos.qty * c.tickVal;
        G.cash += v; G.ytd += v; G.stats.realized += v; G.pos.entry = closeT;
        if (v < -5000) G.flags.gap = true;
      }
      G.mk[c.sym].close = closeT;
    }
    // session summary
    if (S) {
      const pnl = G.cash - S.startEq;
      G.lastSession = { sym: S.sym, pnl, trades: S.trades, wins: S.wins, fees: 0, overnight: !!G.pos, date: date.getTime() };
      const st = G.stats;
      st.bestDay = Math.max(st.bestDay, pnl); st.worstDay = Math.min(st.worstDay, pnl);
      st.streak = pnl > 0 ? st.streak + 1 : 0;
      if (pnl >= 10000) G.flags.bigDay = true;
      if (st.streak >= 5) G.flags.streak5 = true;
      if (S.scripted && pnl >= 2000) G.flags.headline = true;
      events.push({ kind: 'close', summary: G.lastSession });
    }
    // margin call at settlement (e.g. you held through a gap)
    if (G.pos) {
      const c = CBY[G.pos.sym];
      if (G.cash < MAINT * c.margin * Math.abs(G.pos.qty)) {
        G.cash -= Math.abs(G.pos.qty) * TECH[G.tech].fee; G.pos = null; G.flags.margin = true;
        const text = 'MARGIN CALL at settlement! Your clearing firm liquidated your overnight position.';
        addNews(G, 'life', text); events.push({ kind: 'margin', text });
      }
    }
    if (G.cash < 0) { // blew through the account: clearing firm wants the money NOW
      const msgs = [];
      if (liquidateFor(G, () => 0, msgs)) { const text = `Account deficit! The clearing firm seized assets. ${msgs.join('. ')}.`; addNews(G, 'life', text); events.push({ kind: 'repo', text }); }
      else return goHomeless(G, events, 'Your account is wiped out and you owe the clearing firm. They take everything.');
    }
    G.sess = null;
    G.day++;
    if (dateOfDay(G.day).getTime() >= END_MS) { G.over = 'end'; events.push({ kind: 'end', text: 'The decade is over.' }); }
    if (!G.over && monthIdxOfDay(G.day) !== G.billMonth) { G.billMonth = monthIdxOfDay(G.day); payBills(G, events); }
    if (!G.over) checkSec(G, events);
    if (!G.over) {
      const nw = netWorth(G);
      G.nwHist.push(nw); if (G.nwHist.length > 800) G.nwHist.shift();
      if (nw > G.stats.peak) { G.stats.peak = nw; G.stats.peakDay = G.day; }
      if (nw < 500) G.flags.low = true;
      for (const c of CONTRACTS) if (!G.unlocked[c.sym] && nw >= c.unlock) {
        G.unlocked[c.sym] = true;
        const text = `NEW PIT UNLOCKED: ${c.pit} — ${c.name}! Bigger moves, bigger margin.`;
        addNews(G, 'life', text); events.push({ kind: 'unlock', text });
      }
    }
    for (const a of checkAchievements(G)) events.push({ kind: 'ach', text: a.name, ach: a });
    if (!G.over) { prepareDay(G); makeTips(G); }
    return events;
  }

  function skipDays(G, n) {
    const events = [];
    const STOP = ['repo', 'homeless', 'margin', 'sec', 'warn', 'prison', 'end', 'unlock'];
    for (let i = 0; i < n && !G.over && !G.sess; i++) {
      endOfDay(G, events, null, null);
      if (events.some((e) => STOP.includes(e.kind))) break;
    }
    return events;
  }

  function goHomeless(G, events, text) {
    G.cash = Math.max(0, G.cash); G.pos = null; G.over = 'homeless'; G.sess = null;
    addNews(G, 'life', text); events.push({ kind: 'homeless', text });
    for (const a of checkAchievements(G)) events.push({ kind: 'ach', text: a.name, ach: a });
    return events;
  }

  // ---------------------------------------------------------------- money
  const livingCost = (G) => 150 + 100 * G.home;
  function monthlyCosts(G) {
    const lux = G.lux.reduce((a, id) => a + LUX.find((l) => l.id === id).upkeep, 0);
    return HOMES[G.home].rent + livingCost(G) + CARS[G.car].upkeep + TECH[G.tech].upkeep + lux;
  }
  const monthlyIncome = (G) => (G.home <= 1 ? 400 : 0); // diner job — you quit once you move up
  const assetValue = (G) => SELL_RATIO * (CARS[G.car].price + TECH[G.tech].price + G.lux.reduce((a, id) => a + LUX.find((l) => l.id === id).price, 0));
  const netWorth = (G) => equity(G) + assetValue(G);
  const marginUsed = (G) => (G.pos ? Math.abs(G.pos.qty) * CBY[G.pos.sym].margin : 0);
  const marginLevel = (G) => { const u = marginUsed(G); return u > 0 ? equity(G) / u : Infinity; };

  // Free up cash by selling luxuries, car, gear, then downgrading home. Returns false if impossible.
  function liquidateFor(G, needFn, msgs) {
    let guard = 40;
    while (G.cash < needFn() && guard--) {
      if (G.lux.length) {
        const id = G.lux.slice().sort((a, b) => LUX.find((l) => l.id === b).price - LUX.find((l) => l.id === a).price)[0];
        sellItem(G, 'lux', id, true); msgs.push(`Repo: ${LUX.find((l) => l.id === id).name} sold`);
      } else if (G.car > 0) { G.cash += SELL_RATIO * CARS[G.car].price; msgs.push(`Repo: ${CARS[G.car].name} sold`); G.car = 0; }
      else if (G.tech > 0) { G.cash += SELL_RATIO * TECH[G.tech].price; msgs.push(`Repo: ${TECH[G.tech].name} sold`); G.tech = 0; }
      else if (G.home > 0) { G.home--; msgs.push(`Evicted! Downgraded to ${HOMES[G.home].name}`); }
      else break;
    }
    return G.cash >= needFn();
  }

  function payBills(G, events) {
    const month = dateOfDay(G.day).getUTCMonth();
    if (month === 0) { // new tax year
      const net = G.ytd;
      G.taxDue = Math.max(0, net) * TAX_RATE; G.ytd = Math.min(0, net);
      if (G.taxDue > 0) addNews(G, 'life', `Tax time: ${money(net)} in trading gains last year. The IRS wants ${money(G.taxDue)} by April.`);
    }
    const tax = month === 3 ? G.taxDue : 0;
    const needFn = () => monthlyCosts(G) - monthlyIncome(G) + tax;
    const costs = monthlyCosts(G), income = monthlyIncome(G), msgs = [];
    if (!liquidateFor(G, needFn, msgs)) return goHomeless(G, events, "You can't make rent. Everything is gone. You're out on the street.");
    G.cash -= needFn();
    if (tax > 0) { G.taxDue = 0; G.flags.taxPaid = (G.flags.taxPaid || 0) + tax; addNews(G, 'life', `You paid the IRS ${money(tax)}.`); }
    if (msgs.length) { const text = 'Bills overdue! ' + msgs.join('. ') + '.'; addNews(G, 'life', text); events.push({ kind: 'repo', text }); }
    else addNews(G, 'life', `Monthly bills paid: ${money(costs)}${income ? ` (diner paycheck +$${income})` : ''}.`);
  }

  function checkSec(G, events) {
    const sec = G.sec; if (!sec) return;
    if (G.day === sec.at - 1 && !sec.warned) {
      sec.warned = true;
      const text = 'Men in cheap suits are asking the clerks about your trades. Compliance wants a word.';
      addNews(G, 'life', text); events.push({ kind: 'warn', text });
    }
    if (G.day < sec.at) return;
    G.sec = null;
    if (G.fined) {
      G.over = 'prison';
      const text = 'The FBI arrives with a warrant. Second offense. You are going to federal prison.';
      addNews(G, 'life', text); events.push({ kind: 'prison', text });
      for (const a of checkAchievements(G)) events.push({ kind: 'ach', text: a.name, ach: a });
      return;
    }
    G.fined = true; G.flags.fined = true;
    const fine = Math.max(10000, sec.profit * 3), msgs = [];
    if (liquidateFor(G, () => fine, msgs)) {
      G.cash -= fine;
      const text = `CFTC SETTLEMENT: trading ahead of customers. You disgorge profits and pay a ${money(fine)} fine.${msgs.length ? ' ' + msgs.join('. ') + '.' : ''} One more strike and it's prison.`;
      addNews(G, 'life', text); events.push({ kind: 'sec', text });
    } else goHomeless(G, events, `The CFTC fines you ${money(fine)}. You can't pay and everything is seized. You're on the street.`);
  }

  // ---------------------------------------------------------------- achievements
  const ACH = [
    { id: 'first', emoji: '🧾', name: 'First Trade', desc: 'Make your first trade in the pit.', test: (G) => G.stats.trades >= 1 },
    { id: 'nw25k', emoji: '🌱', name: 'In the Green', desc: 'Reach $25,000 net worth.', test: (G) => netWorth(G) >= 25e3 },
    { id: 'nw100k', emoji: '💵', name: 'Six Figures', desc: 'Reach $100,000 net worth.', test: (G) => netWorth(G) >= 1e5 },
    { id: 'nw1m', emoji: '🤑', name: 'Millionaire', desc: 'Reach $1,000,000 net worth.', test: (G) => netWorth(G) >= 1e6 },
    { id: 'nw10m', emoji: '👑', name: 'Master of the Universe', desc: 'Reach $10,000,000 net worth.', test: (G) => netWorth(G) >= 1e7 },
    { id: 'condo', emoji: '🏙️', name: 'Moving On Up', desc: 'Move into a Yuppie Condo or better.', test: (G) => G.home >= 2 },
    { id: 'rolex', emoji: '⌚', name: 'Time Is Money', desc: 'Buy the Rolex.', test: (G) => G.lux.includes('rolex') },
    { id: 'mansion', emoji: '🏰', name: 'Lifestyles of the Rich', desc: 'Live in the Hamptons mansion.', test: (G) => G.home === 5 },
    { id: 'jet', emoji: '🛩️', name: 'Frequent Flyer', desc: 'Own a private jet share.', test: (G) => G.lux.includes('jet') },
    { id: 'scalper', emoji: '⚡', name: 'Scalper', desc: 'Close 10 winning trades in a single session.', test: (G) => G.flags.scalper },
    { id: 'bigday', emoji: '🔔', name: 'Ring the Bell', desc: 'Make $10,000 in a single session.', test: (G) => G.flags.bigDay },
    { id: 'streak5', emoji: '🔥', name: 'Hot Streak', desc: 'Win 5 sessions in a row.', test: (G) => G.flags.streak5 },
    { id: 'headline', emoji: '📰', name: 'Headline Hunter', desc: 'Make $2,000+ in a session with a historic headline.', test: (G) => G.flags.headline },
    { id: 'stop', emoji: '🛑', name: 'Cut Your Losses', desc: 'Get stopped out.', test: (G) => G.flags.stop },
    { id: 'margin', emoji: '📞', name: 'Margin Call', desc: 'Get liquidated by your clearing firm.', test: (G) => G.flags.margin },
    { id: 'gap', emoji: '🕳️', name: 'Gap Risk', desc: 'Lose $5,000+ overnight on a gap.', test: (G) => G.flags.gap },
    { id: 'bond', emoji: '📜', name: 'Bond Vigilante', desc: 'Trade the T-Bond pit.', test: (G) => G.flags.bond },
    { id: 'spx', emoji: '📈', name: 'Big Board', desc: 'Trade the S&P 500 pit.', test: (G) => G.flags.spx },
    { id: 'front', emoji: '🤫', name: 'Trading Ahead', desc: 'Profit from front-running a customer.', test: (G) => G.flags.frontWin },
    { id: 'sec', emoji: '⚖️', name: 'The Sting', desc: 'Get fined for trading ahead.', test: (G) => G.flags.fined },
    { id: 'prison', emoji: '⛓️', name: 'Club Fed', desc: 'Go to federal prison.', test: (G) => G.over === 'prison' },
    { id: 'tax', emoji: '🏛️', name: 'Uncle Sam Thanks You', desc: 'Pay $10,000+ in taxes.', test: (G) => (G.flags.taxPaid || 0) >= 1e4 },
    { id: 'comeback', emoji: '🔥', name: 'Comeback Kid', desc: 'Fall below $500, then climb back above $50,000.', test: (G) => G.flags.low && netWorth(G) >= 5e4 },
    { id: 'rock', emoji: '🥫', name: 'Rock Bottom', desc: 'End up homeless.', test: (G) => G.over === 'homeless' },
    { id: 'y2k', emoji: '🎆', name: 'Y2K Survivor', desc: 'Make it to the end of the decade.', test: (G) => G.over === 'end' },
  ];
  function checkAchievements(G) {
    const fresh = [];
    for (const a of ACH) {
      if (G.ach[a.id]) continue;
      let ok = false; try { ok = !!a.test(G); } catch (e) {}
      if (ok) { G.ach[a.id] = G.day; fresh.push(a); }
    }
    return fresh;
  }

  // ---------------------------------------------------------------- lifestyle
  function moveHome(G, id) {
    if (id === G.home) return { ok: false, msg: 'You already live here.' };
    const deposit = id > G.home ? HOMES[id].rent * 2 : 0;
    if (G.cash - deposit < marginUsed(G)) return { ok: false, msg: 'Need first + last month: $' + deposit.toLocaleString() };
    G.cash -= deposit; G.home = id;
    addNews(G, 'life', `You moved into a ${HOMES[id].name}.`);
    return { ok: true, msg: `Moved to ${HOMES[id].name}` };
  }
  function buyItem(G, cat, id) {
    if (cat === 'home') return moveHome(G, id);
    if (cat === 'lux') {
      const it = LUX.find((l) => l.id === id);
      if (G.lux.includes(id)) return { ok: false, msg: 'Already owned.' };
      if (G.cash - it.price < marginUsed(G)) return { ok: false, msg: 'Not enough cash.' };
      G.cash -= it.price; G.lux.push(id);
      addNews(G, 'life', `You bought: ${it.name}.`);
      return { ok: true, msg: `Bought ${it.name}` };
    }
    const list = cat === 'car' ? CARS : TECH, cur = G[cat], it = list[id];
    if (id <= cur) return { ok: false, msg: 'You already have something better.' };
    const net = it.price - SELL_RATIO * list[cur].price;
    if (G.cash - net < marginUsed(G)) return { ok: false, msg: 'Not enough cash (trade-in applied: $' + Math.round(net).toLocaleString() + ').' };
    G.cash -= net; G[cat] = id;
    addNews(G, 'life', `You upgraded to: ${it.name}.`);
    return { ok: true, msg: `Upgraded to ${it.name}` };
  }
  function sellItem(G, cat, id, quiet) {
    if (cat === 'lux') {
      const i = G.lux.indexOf(id); if (i < 0) return { ok: false, msg: 'Not owned.' };
      G.cash += SELL_RATIO * LUX.find((l) => l.id === id).price; G.lux.splice(i, 1);
      return { ok: true, msg: 'Sold.' };
    }
    const list = cat === 'car' ? CARS : TECH;
    if (G[cat] === 0) return { ok: false, msg: 'Nothing to sell.' };
    G.cash += SELL_RATIO * list[G[cat]].price; G[cat] = 0;
    return { ok: true, msg: 'Sold.' };
  }

  const api = {
    START_CASH, SELL_RATIO, SAVE_VERSION, TAX_RATE, MAINT, N_STEPS, STEP_MS, CONTRACTS, CBY, HOMES, CARS, TECH, LUX, RANKS, ACH, ERA_EVENTS,
    newGame, startSession, stepSession, trade, flatten, setStop, respondOffer, skipDays, recentFlow, shoutsNow,
    buyItem, sellItem, moveHome, checkAchievements,
    netWorth, equity, unreal, maxLots, marginUsed, marginLevel, markT, monthlyCosts, monthlyIncome, rankOf, livingCost,
    dateOfDay, clockOf, fmtPrice, priceOf, bidT,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
