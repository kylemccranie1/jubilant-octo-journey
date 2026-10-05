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
  const SAVE_VERSION = 4;
  const LIQ_PENALTY = 25;      // clearing-firm fee per lot when it liquidates you
  const NOTICE_DAYS = 5;       // trading days to cover an unpaid month before the repo man collects
  const VOL_MUL = 1.5;         // global daily-volatility multiplier (market pace)
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
    { sym: 'SOY', name: 'Soybeans', pit: 'CBOT Grain Pit', emoji: '🌱', tick: .25, tickVal: 12.5, vol: .011, margin: 1000, depth: 15, act: 0.66, bias: 0.95, nk: 0.7, unlock: 0,
      anchors: [A(1990, 1, 570), A(1991, 1, 600), A(1993, 1, 580), A(1993, 8, 700), A(1994, 6, 660), A(1996, 6, 800), A(1997, 6, 830), A(1998, 6, 640), A(1999, 6, 480), A(2000, 6, 530), A(2000, 12, 520)] },
    { sym: 'CRUDE', name: 'Crude Oil', pit: 'NYMEX Energy Pit', emoji: '🛢️', tick: .01, tickVal: 10, vol: .018, margin: 2000, depth: 12, act: 0.92, bias: 0.8, nk: 0.6, unlock: 12000,
      anchors: [A(1990, 1, 21), A(1990, 7, 17), A(1990, 10, 37), A(1991, 2, 20), A(1992, 6, 21), A(1994, 6, 18), A(1996, 12, 25), A(1998, 12, 11), A(1999, 12, 25), A(2000, 9, 33), A(2000, 12, 26)] },
    { sym: 'DM', name: 'Deutschmark', pit: 'CME Currency Pit', emoji: '💶', tick: .0001, tickVal: 12.5, vol: .006, margin: 2000, depth: 12, act: 0.86, bias: 0.8, nk: 0.6, unlock: 40000,
      anchors: [A(1990, 1, .60), A(1992, 9, .70), A(1993, 6, .62), A(1995, 4, .73), A(1997, 7, .54), A(1999, 1, .59), A(2000, 10, .43), A(2000, 12, .46)] },
    { sym: 'BOND', name: 'T-Bonds', pit: 'CBOT Financial Pit', emoji: '📜', tick: 1 / 32, tickVal: 31.25, vol: .006, margin: 3000, depth: 10, act: 0.5, bias: 0.8, nk: 0.8, unlock: 150000,
      anchors: [A(1990, 1, 91), A(1991, 6, 97), A(1993, 10, 117), A(1994, 11, 98), A(1995, 12, 118), A(1996, 6, 108), A(1998, 10, 126), A(2000, 1, 98), A(2000, 12, 112)] },
    { sym: 'SPX', name: 'S&P 500', pit: 'CME Index Pit', emoji: '📈', tick: .05, tickVal: 25, vol: .009, margin: 9000, depth: 8, act: 1.2, bias: 0.7, nk: 0.7, unlock: 600000,
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
    BOND: [['Fed speaker hints at tighter policy. Bonds sell off.', -1, .012], ['Soft jobs report. Bonds rally.', 1, .012], ['Inflation print hot. Long end hammered.', -1, .014]],
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
    { id: 0, name: 'Rotary Phone & WSJ', emoji: '☎️', price: 0, upkeep: 0, fee: 2.5, rel: .55, tips: 0, desc: 'Standard clearing fees ($2.50/side). Pit chatter only 55% reliable.' },
    { id: 1, name: 'Motorola Brick Phone', emoji: '📱', price: 1500, upkeep: 50, fee: 2.0, rel: .62, tips: 1, desc: '$2.00/side. Chatter 62% reliable + 1 morning tip.' },
    { id: 2, name: 'IBM PC + Prodigy Modem', emoji: '🖥️', price: 4500, upkeep: 80, fee: 1.5, rel: .68, tips: 1, desc: '$1.50/side. Chatter 68% reliable + 1 tip.' },
    { id: 3, name: 'Quotron Terminal', emoji: '📟', price: 15000, upkeep: 250, fee: 1.0, rel: .74, tips: 2, desc: '$1.00/side. Chatter 74% reliable + 2 tips.' },
    { id: 4, name: 'Bloomberg Desk (4 monitors)', emoji: '🖲️', price: 70000, upkeep: 900, fee: .7, rel: .82, tips: 2, desc: '$0.70/side. Chatter 82% reliable + 2 tips.' },
    { id: 5, name: 'Private Trading Floor', emoji: '🏛️', price: 350000, upkeep: 5000, fee: .35, rel: .90, tips: 3, desc: '$0.35/side. Chatter 90% reliable + 3 tips.' },
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

  // Career ladder: net worth earns a better badge (more pits, better terms) — but badges carry monthly dues,
  // and you can lose one if your net worth sags below 60% of its threshold for a month.
  const CAREER = [
    { lvl: 0, title: 'Runner', nw: 0, dues: 0, marginK: 1.0, feeK: 1.0, perk: 'Starter badge: Soybean pit' },
    { lvl: 1, title: 'Local', nw: 12000, dues: 250, marginK: 0.95, feeK: 1.0, perk: 'Crude Oil pit · margin −5%' },
    { lvl: 2, title: 'Seat Holder', nw: 40000, dues: 800, marginK: 0.90, feeK: 0.9, perk: 'Deutschmark pit · margin −10% · fees −10%' },
    { lvl: 3, title: 'Floor Broker', nw: 150000, dues: 2500, marginK: 0.85, feeK: 0.8, perk: 'T-Bond pit · margin −15% · fees −20%' },
    { lvl: 4, title: 'Pit Boss', nw: 600000, dues: 8000, marginK: 0.80, feeK: 0.7, perk: 'S&P 500 pit · margin −20% · fees −30%' },
    { lvl: 5, title: 'Master of the Pit', nw: 5000000, dues: 25000, marginK: 0.75, feeK: 0.5, perk: 'Legend status · margin −25% · fees −50%' },
  ];
  const RIVALS = [
    { id: 'tony', name: 'Big Tony', tag: 'Soybean-pit lifer', nw0: 40000, mu: .12, vol: .22, beta: .2, blow: 0 },
    { id: 'sally', name: 'Sally Kim', tag: 'Scalping prodigy', nw0: 15000, mu: .45, vol: .55, beta: .3, blow: .15 },
    { id: 'marcus', name: 'Marcus Webb', tag: 'Ex-bond-desk veteran', nw0: 90000, mu: .18, vol: .30, beta: .6, blow: .1 },
    { id: 'dutch', name: 'Dutch Reilly', tag: 'Bond cowboy', nw0: 60000, mu: .35, vol: .70, beta: .8, blow: .5 },
    { id: 'vivian', name: 'Vivian Chase', tag: 'Quant from the hedge fund', nw0: 250000, mu: .22, vol: .25, beta: .1, blow: 0 },
    { id: 'rick', name: 'Rick "The Hammer" Dunn', tag: 'Leveraged S&P bull', nw0: 120000, mu: .30, vol: .60, beta: 1.5, blow: .6 },
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
      level: 0, career: { low: 0 }, notice: null, rank: 0, rivals: RIVALS.map((r) => ({ id: r.id, nw: r.nw0, broke: 0 })),
      yr: { year: 1990, nw0: START_CASH, sessions: 0, best: 0, worst: 0 },
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
      const sig = VOL_MUL * c.vol * (c.sym === 'SPX' ? Math.sqrt((ERA_VOL[year] || .2) / .15) : 1);
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

  // ---------------------------------------------------------------- trading session (price emerges from order flow)
  // A simulated pit book: queued lots at each price level. Crowd shouts are real market orders that eat the book;
  // when a level is cleared the price steps. Your market orders do the same (slippage + impact), and your
  // resting limit orders sit in the queue and get filled as the crowd trades through them.
  const SIZE_F = [0.25, 0.5, 1, 2, 4], SIZE_W = [0.33, 0.30, 0.22, 0.10, 0.05];
  const SHOUT_RATE = 0.5;    // expected crowd orders per step
  const REG_BIAS = 0.22;     // buy-probability tilt that an informed-flow regime leaks into ordinary crowd orders
  const REG_LEAK = 0.35;     // ...scaled down: the real signal is the informed BLOCKS below
  const INF_RATE = 0.085;    // informed block orders per step during a lean (x regime strength x pit bias)
  const NOISE_W = [0.50, 0.37, 0.11, 0.02, 0];   // ordinary crowd order sizes (x SIZE_F): mostly small
  const MAX_PRINTS = 80;
  const RETAIL_RATE = 0.9;   // tiny uninformed orders per step: they chew queues (and fill resting orders) without moving price

  const dpth = (S) => CBY[S.sym].depth;
  function freshQty(G, S, thin) { return Math.max(1, Math.round(dpth(S) * (0.35 + 0.8 * rnd(G)) * (thin == null ? 1 : thin))); }
  function ensureLevel(G, S, key, p) {
    const book = S[key];
    if (!(book[p] > 0)) book[p] = freshQty(G, S, key === 'asks' ? S.thinA : S.thinB);
    return book[p];
  }
  function ensureDepth(G, S, k) { for (let i = 0; i < k; i++) { ensureLevel(G, S, 'bids', S.bid - i); ensureLevel(G, S, 'asks', S.ask + i); } }
  const midOf = (S) => (S.bid + S.ask) / 2;
  const quote = (S) => ({ bid: S.bid, ask: S.ask, mid: midOf(S) });

  function pushPrint(S, side, lots, px, who) {
    S.prints.push([S.t, side, lots, px, who, ++S.pseq]);
    if (S.prints.length > MAX_PRINTS) S.prints.shift();
  }

  // Execute a market order against the book. Returns { filled, vwap }.
  function sweep(G, S, side, lots, who) {
    const key = side > 0 ? 'asks' : 'bids', book = S[key];
    let rem = lots, cost = 0, filled = 0, guard = 600;
    while (rem > 0 && guard--) {
      const P = side > 0 ? S.ask : S.bid;
      const L = ensureLevel(G, S, key, P);
      const ord = S.orders.find((o) => o.price === P && o.side === -side && o.rem > 0);
      const ahead = ord ? Math.min(ord.ahead, L) : 0, behind = L - ahead;
      let w = rem;
      const tA = Math.min(ahead, w); w -= tA;
      const tM = ord ? Math.min(ord.rem, w) : 0; w -= tM;
      const tB = Math.min(behind, w);
      const taken = tA + tM + tB;
      if (ord) { ord.ahead = ahead - tA; ord.rem -= tM; }
      book[P] = L - tA - tB;
      if (taken > 0) S.hit[P] = S.t;
      if (tM > 0) fillLimit(G, S, ord, tM);
      cost += taken * P; filled += taken; rem -= taken;
      if (book[P] <= 0 && (!ord || ord.rem <= 0)) { // level cleared: the price steps
        delete book[P];
        if (side > 0) { S.ask = P + 1; S.bid = P; if (!(S.bids[P] > 0)) S.bids[P] = freshQty(G, S, 0.7); ensureLevel(G, S, 'asks', S.ask); }
        else { S.bid = P - 1; S.ask = P; if (!(S.asks[P] > 0)) S.asks[P] = freshQty(G, S, 0.7); ensureLevel(G, S, 'bids', S.bid); }
      }
    }
    const vwap = filled ? cost / filled : (side > 0 ? S.ask : S.bid);
    if (filled && who !== 'retail') pushPrint(S, side, filled, vwap, who);
    if (filled) { S.volume += filled; S.last = vwap; if (who === 'pit' || who === 'block') S.stepFlow += side * filled; }
    S.orders = S.orders.filter((o) => o.rem > 0);
    return { filled, vwap };
  }

  // Position accounting for any fill (market or limit).
  function applyFill(G, S, side, qty, px, maker) {
    const c = CBY[S.sym], cur = G.pos ? G.pos.qty : 0, next = cur + side * qty;
    const fee = qty * feeOf(G) * (maker ? 0.5 : 1);
    let realized = 0, closeQ = 0;
    if (cur !== 0 && Math.sign(cur) !== side) {
      closeQ = Math.min(Math.abs(cur), qty);
      realized = (px - G.pos.entry) * Math.sign(cur) * closeQ * c.tickVal;
    }
    if (cur === 0 || Math.sign(cur) === side) {
      G.pos = { sym: S.sym, qty: next, entry: (cur === 0 ? px : (G.pos.entry * Math.abs(cur) + px * qty) / (Math.abs(cur) + qty)) };
    } else if (next === 0) G.pos = null;
    else if (Math.sign(next) === Math.sign(cur)) G.pos.qty = next;
    else G.pos = { sym: S.sym, qty: next, entry: px };
    if (S.log && S.log.length < 120) S.log.push([S.t, side * qty, Math.round(px * 10) / 10]);
    G.cash += realized - fee; G.ytd += realized - fee;
    G.stats.realized += realized - fee; G.stats.fees += fee; G.stats.trades++; S.trades++;
    if (closeQ > 0) {
      const net = realized - fee * closeQ / qty;
      if (net > 0) { G.stats.wins++; S.wins++; } else G.stats.losses++;
      if (S.wins >= 10) G.flags.scalper = true;
    }
    return { realized, fee };
  }

  function fillLimit(G, S, ord, lots) {
    applyFill(G, S, ord.side, lots, ord.price, true);
    S.notes.push(`${ord.side > 0 ? 'BID' : 'OFFER'} filled ${lots} @ ${fmtPrice(S.sym, ord.price)}`);
    S.makerFills = (S.makerFills || 0) + lots;
    pushPrint(S, ord.side, lots, ord.price, 'mine');
  }

  const markT = (G) => {
    if (!G.pos) return 0;
    if (G.sess && G.sess.sym === G.pos.sym) return G.pos.qty > 0 ? G.sess.bid : G.sess.ask;
    return G.mk[G.pos.sym].close;
  };
  function unreal(G) { return G.pos ? (markT(G) - G.pos.entry) * G.pos.qty * CBY[G.pos.sym].tickVal : 0; }
  const equity = (G) => G.cash + unreal(G);
  const marginOf = (G, sym) => Math.round(CBY[sym].margin * CAREER[G.level || 0].marginK);
  const feeOf = (G) => TECH[G.tech].fee * CAREER[G.level || 0].feeK;
  const maxLots = (G, sym) => Math.max(0, Math.floor(equity(G) / marginOf(G, sym) + 1e-9));
  // price (in ticks) at which the clearing firm would liquidate the open position
  function liqPrice(G) {
    if (!G.pos) return null;
    const c = CBY[G.pos.sym], M = MAINT * marginOf(G, G.pos.sym) * Math.abs(G.pos.qty);
    return G.pos.entry + (M - G.cash) / (G.pos.qty * c.tickVal);
  }

  const dpth0 = (sym) => CBY[sym].depth;
  function startSession(G, sym, opts) {
    const c = CBY[sym];
    if (G.over || G.sess) return { ok: false, msg: 'Not available.' };
    if (!c || !G.unlocked[sym]) return { ok: false, msg: 'That pit is locked.' };
    if (G.pos && G.pos.sym !== sym) return { ok: false, msg: `You're holding ${G.pos.sym}. Trade that pit to close it out.` };
    const N = N_STEPS, per = G.today.per[sym], open = per.openT, training = !!(opts && opts.training), duel = opts && opts.duel != null ? opts.duel : null;
    const S = {
      sym, n: N, t: 0, open, target: per.closeT, sigT: Math.max(28, open * per.sig),
      bid: open, ask: open + 1, bids: {}, asks: {}, thinA: 1, thinB: 1, imb: 0, volume: 0,
      regime: { f: 0, s: 0, left: 0 }, hint: 0, burst: null, react: null, rev: null, fundJ: 0, totJ: 0,
      path: [open + 0.5], prints: [], hit: {}, notes: [], pseq: 0, last: open, flowEma: 0, stepFlow: 0, events: [], orders: [], stop: 0, done: false,
      startEq: 0, duel, log: duel != null ? [] : null, wins: 0, trades: 0, training, scripted: !!per.scripted && !!per.text, aheadEntry: null, offer: null, makerFills: 0,
    };
    G.sess = S;
    ensureDepth(G, S, 5);
    if (per.text && !training) {
      const tEv = 60 + Math.floor(rnd(G) * 320), J = open * (Math.exp(per.shock) - 1);
      S.events.push({ t: tEv, text: per.text, jump: J, scripted: per.scripted });
      S.totJ = J;
    }
    if (!training && duel == null && netWorth(G) >= 15000 && !G.sec && G.day - G.lastOffer >= 15 && rnd(G) < .10) {
      const side = rnd(G) < .5 ? 1 : -1, t0 = 100 + Math.floor(rnd(G) * 250), lots = dpth0(sym) * pick(G, [3, 5, 7, 10]);
      S.offer = { t: t0, side, lots, jt: t0 + 30, bonus: Math.round(lots * CBY[sym].tickVal * 0.8), resolved: null };
      G.lastOffer = G.day;
    }
    S.startEq = equity(G);
    G.stats.sessions++;
    if (sym === 'SPX') G.flags.spx = true;
    if (sym === 'BOND') G.flags.bond = true;
    return { ok: true };
  }

  // ---- player orders
  function trade(G, side, qty, forced) {
    const S = G.sess;
    if (!S || S.done || G.over) return { ok: false, msg: 'The pit is closed.' };
    qty = Math.floor(qty);
    if (qty < 1) return { ok: false, msg: 'Invalid size.' };
    const c = CBY[S.sym], cur = G.pos ? G.pos.qty : 0, next = cur + side * qty;
    if (!forced && Math.abs(next) > Math.abs(cur) && Math.abs(next) > maxLots(G, S.sym)) {
      return { ok: false, msg: `Margin: ${S.sym} needs ${money(marginOf(G, S.sym))}/lot — you can hold ${maxLots(G, S.sym)}.` };
    }
    const before = side > 0 ? S.ask : S.bid, mid0 = midOf(S);
    const { filled, vwap } = sweep(G, S, side, qty, 'me');
    const r = applyFill(G, S, side, filled, vwap, false);
    S.imb += side * filled / dpth(S) * 0.5;
    // the crowd notices an aggressive player and briefly piles on
    S.react = { dir: side, left: 6, str: Math.min(0.04, 0.02 * filled / dpth(S)) };
    S.rev = { dir: -side, left: 50, age: 0, str: Math.min(0.18, 0.08 * filled / dpth(S)), anchor: mid0 };
    const o = S.offer;
    if (o && o.resolved === 'ahead' && !forced && side === o.side && S.t >= o.t && S.t <= o.jt && Math.abs(next) > Math.abs(cur) && !S.aheadEntry) S.aheadEntry = { px: vwap, qty: filled };
    const slipTicks = Math.abs(vwap - before);
    return { ok: true, px: vwap, filled, slip: slipTicks, realized: r.realized, fee: r.fee, msg: `${side > 0 ? 'Bought' : 'Sold'} ${filled} ${S.sym} @ ${fmtPrice(S.sym, vwap)}` };
  }
  function flatten(G, forced) { return G.pos && G.sess ? trade(G, -Math.sign(G.pos.qty), Math.abs(G.pos.qty), forced) : { ok: false, msg: 'Already flat.' }; }
  function setStop(G, ticks) { if (G.sess) G.sess.stop = ticks; }

  // resting limit order joined at the inside quote (back of the queue)
  function placeLimit(G, side, qty) {
    const S = G.sess;
    if (!S || S.done || G.over) return { ok: false, msg: 'The pit is closed.' };
    qty = Math.floor(qty);
    if (qty < 1) return { ok: false, msg: 'Invalid size.' };
    const cur = G.pos ? G.pos.qty : 0, c = CBY[S.sym];
    if (Math.abs(cur + side * qty) > Math.abs(cur) && Math.abs(cur + side * qty) > maxLots(G, S.sym)) return { ok: false, msg: `Margin: you can hold ${maxLots(G, S.sym)} lots.` };
    S.orders = S.orders.filter((o) => o.side !== side);
    const key = side > 0 ? 'bids' : 'asks', price = side > 0 ? S.bid : S.ask;
    const ahead = ensureLevel(G, S, key, price);
    S.orders.push({ side, price, qty, rem: qty, ahead, t: S.t });
    return { ok: true, msg: `${side > 0 ? 'Bid' : 'Offer'} ${qty} ${S.sym} @ ${fmtPrice(S.sym, price)} (${ahead} ahead of you)` };
  }
  // read-only estimate of what a market order of `qty` would cost right now
  function preview(G, side, qty) {
    const S = G.sess; if (!S) return { vwap: 0, slip: 0 };
    const book = side > 0 ? S.asks : S.bids, D = dpth(S), best = side > 0 ? S.ask : S.bid;
    let rem = qty, cost = 0, p = best, guard = 300;
    while (rem > 0 && guard--) { const L = book[p] > 0 ? book[p] : D, t = Math.min(L, rem); cost += t * p; rem -= t; p += side > 0 ? 1 : -1; }
    const vwap = cost / qty; return { vwap, slip: Math.abs(vwap - best) };
  }
  // training-floor helpers: script the hidden lean and inject crowd orders
  function forceRegime(G, f, s, len) { const S = G.sess; if (S) { S.regime = { f, s, left: len }; S.hint = f; } }
  function inject(G, side, lots) {
    const S = G.sess; if (!S || S.done) return { filled: 0 };
    const r = sweep(G, S, side, Math.max(1, Math.round(lots)), 'pit'); S.imb += side * r.filled / dpth(S); return r;
  }
  function cancelOrders(G) { const S = G.sess; if (!S) return; S.orders = []; }

  function respondOffer(G, choice) {
    const S = G.sess, o = S && S.offer;
    if (!o || o.resolved) return { ok: false, msg: 'No order.' };
    o.resolved = choice;
    if (choice === 'honest') { G.cash += o.bonus; G.ytd += o.bonus; return { ok: true, msg: `You filled the customer fairly and earned ${money(o.bonus)} in brokerage.` }; }
    if (choice === 'ahead') { G.heat++; return { ok: true, msg: 'You\'re trading ahead of the customer. Be quick — and pray nobody\'s watching.' }; }
    return { ok: true, msg: '' };
  }

  // net signed size of crowd prints in the last `w` steps (the "tape")
  function recentFlow(G, w) {
    const S = G.sess; if (!S) return 0; let sum = 0;
    for (let i = S.prints.length - 1; i >= 0; i--) { const p = S.prints[i]; if (p[0] <= S.t - w) break; if (p[4] !== 'me' && p[4] !== 'mine') sum += p[1] * p[2]; }
    return sum;
  }
  // The on-screen "lean call": computed ONLY from what the player can see (big crowd prints in the last ~25 steps)
  const LEAN_WIN = 30, LEAN_T = [2, 4, 6.5], LEAN_PUR = 0.4, LEAN_MIN = 0.9; // thresholds are in units of one informed block (level depth x pit activity); LEAN_MIN = smallest print that counts // window (steps), strength thresholds (x level depth), purity, min print size (x depth)
  function leanSignal(G, win) {
    const S = G.sess; win = win || LEAN_WIN;
    const out = { dir: 0, strength: 0, net: 0, bb: 0, bs: 0, lb: 0, ls: 0 };
    if (!S) return out;
    const D = dpth(S), U = D * CBY[S.sym].act; // U = size of a typical informed block
    for (let i = S.prints.length - 1; i >= 0; i--) {
      const p = S.prints[i]; if (p[0] <= S.t - win) break;
      if (p[4] === 'me' || p[4] === 'mine' || p[2] < U * LEAN_MIN) continue;
      out.net += p[1] * p[2];
      if (p[1] > 0) { out.bb++; out.lb += p[2]; } else { out.bs++; out.ls += p[2]; }
    }
    const a = Math.abs(out.net) / U, vol = out.lb + out.ls, purity = vol ? Math.abs(out.net) / vol : 0;
    let st = a >= LEAN_T[2] ? 3 : a >= LEAN_T[1] ? 2 : a >= LEAN_T[0] ? 1 : 0;
    if (purity < LEAN_PUR) st = 0; // mixed buying and selling is chop, not a lean
    out.strength = st; out.dir = st ? Math.sign(out.net) : 0;
    return out;
  }
  // The call the UI shows: raw leanSignal with hysteresis so it doesn't flicker (strong calls are held a few seconds and fade, not vanish)
  function updateLeanCall(S, G) {
    const raw = leanSignal(G), c = S.call || (S.call = { dir: 0, strength: 0, hold: 0, fading: false });
    if (raw.strength >= 1 && (c.strength === 0 || raw.dir === c.dir) && raw.strength >= c.strength) { c.dir = raw.dir; c.strength = raw.strength; c.hold = raw.strength >= 2 ? 14 : 6; c.fading = false; }
    else if (raw.strength >= 1 && raw.dir !== c.dir && (c.strength <= 1 || raw.strength >= 2)) { c.dir = raw.dir; c.strength = raw.strength; c.hold = raw.strength >= 2 ? 14 : 6; c.fading = false; }
    else if (c.strength > 0) { // underlying signal is weaker than what we show
      if (c.hold > 0) c.hold--;
      else { c.strength = Math.max(raw.strength, c.strength - 1); c.hold = 6; c.fading = c.strength > 0; if (c.strength === 0) c.dir = 0; }
    }
    return c;
  }
  const leanCall = (G) => (G.sess ? (G.sess.call || { dir: 0, strength: 0, fading: false }) : { dir: 0, strength: 0, fading: false });
  // order-flow "delta" bars: net aggressive lots per bucket of `size` steps, oldest first (in units of level depth)
  function deltaBars(G, buckets, size) {
    const S = G.sess, out = new Array(buckets).fill(0);
    if (!S) return out;
    const D = dpth(S);
    for (const p of S.prints) {
      if (p[4] === 'me' || p[4] === 'mine') continue;
      const age = S.t - p[0], b = Math.floor(age / size);
      if (b >= 0 && b < buckets) out[buckets - 1 - b] += p[1] * p[2] / D;
    }
    return out;
  }
  const flowGauge = (G) => (G.sess ? clamp(G.sess.flowEma * 5, -1, 1) : 0);
  const shoutsNow = (G, n) => { const S = G.sess; return S ? S.prints.slice(-n).reverse() : []; };
  function ladder(G, k) {
    const S = G.sess; if (!S) return { asks: [], bids: [] };
    const asks = [], bids = [];
    for (let i = k - 1; i >= 0; i--) { const p = S.ask + i; asks.push({ p, size: S.asks[p] || 0, mine: (S.orders.find((o) => o.price === p && o.side < 0) || {}).rem || 0 }); }
    for (let i = 0; i < k; i++) { const p = S.bid - i; bids.push({ p, size: S.bids[p] || 0, mine: (S.orders.find((o) => o.price === p && o.side > 0) || {}).rem || 0 }); }
    return { asks, bids };
  }

  function newRegime(G, S) {
    const len = 14 + Math.floor(rnd(G) * 46), r = rnd(G), f = r < .2 ? 0 : (r < .6 ? 1 : -1), s = .4 + .6 * rnd(G);
    S.regime = { f, s, left: len };
    S.hint = rnd(G) < TECH[G.tech].rel ? f : (rnd(G) < .5 ? 1 : -1);
  }

  function replenish(G, S) {
    const D = dpth(S);
    for (const [key, p, thin] of [['bids', S.bid, S.thinB], ['asks', S.ask, S.thinA]]) {
      let L = ensureLevel(G, S, key, p);
      L += Math.round((D - L) * 0.15 * thin * rnd(G) * 2) + Math.round((rnd(G) - 0.5) * D * 0.15);
      L = clamp(L, 1, Math.round(D * 2.5));
      S[key][p] = L;
      const ord = S.orders.find((o) => o.price === p && o.side === (key === 'bids' ? 1 : -1));
      if (ord) {
        const cut = Math.floor(ord.ahead * (0.06 + 0.09 * rnd(G)) + rnd(G));
        ord.ahead = Math.max(0, Math.min(ord.ahead - cut, L - cut));
        S[key][p] = Math.max(1, L - cut);
      }
    }
  }

  function crowdOrder(G, S, burstFrac) {
    const c = CBY[S.sym], t = S.t;
    const fund = S.open + (S.target - S.totJ - S.open) * (t / S.n) + S.fundJ;
    const gain = 0.22 + 1.6 * (t / S.n) * (t / S.n) + (S.burst ? 0.9 * S.burst.left / S.burst.max : 0);
    const pull = S.training ? 0 : clamp(gain * (fund - midOf(S)) / S.sigT, -0.3, 0.3); // training floor: the scripted lean is the only force
    let p = 0.5 + REG_BIAS * REG_LEAK * (c.bias || 1) * S.regime.f * S.regime.s + pull;
    if (S.burst) p += 0.5 * S.burst.tilt * S.burst.dir * burstFrac * clamp(Math.abs(fund - midOf(S)) / (0.5 * S.sigT), 0.25, 1);
    if (S.rev && S.rev.age >= 2) p += S.rev.dir * S.rev.str * (S.rev.left / 34);
    if (S.react) p += S.react.dir * S.react.str * (S.react.left / 6);
    p = clamp(p, 0.06, 0.94);
    const side = rnd(G) < p ? 1 : -1;
    const inBurst = !!S.burst && rnd(G) < burstFrac, W = inBurst ? SIZE_W : NOISE_W, nk = inBurst ? 1 : (c.nk || 1);
    let u = rnd(G), k = 0; while (k < W.length - 1 && u > W[k]) { u -= W[k]; k++; }
    const lots = Math.max(1, Math.round(dpth(S) * c.act * nk * SIZE_F[k] * (1 + 3 * burstFrac * (S.burst ? S.burst.size : 1))));
    const r = sweep(G, S, side, lots, 'pit');
    S.imb += side * r.filled / dpth(S);
  }

  // informed money: during a lean, bigger one-sided blocks show up on the tape (this is what the player is learning to spot)
  function informedOrder(G, S) {
    const c = CBY[S.sym], f = S.regime.f;
    if (!f || rnd(G) >= INF_RATE * (c.bias || 1) * S.regime.s) return;
    const lots = Math.max(1, Math.round(dpth(S) * c.act * (1 + 2 * rnd(G))));
    const r = sweep(G, S, f, lots, 'pit'); S.imb += f * r.filled / dpth(S);
  }

  function stepSession(G) {
    const S = G.sess, events = [];
    if (!S || S.done) return events;
    if (S.offer && !S.offer.resolved && S.t >= S.offer.t) S.offer.resolved = 'ignored';
    S.t++;
    if (S.duel != null) G.rs = (S.duel ^ Math.imul(S.t, 0x9E3779B1)) | 0; // duel: the market's randomness depends only on the seed and the step, never on how you traded
    const t = S.t, c = CBY[S.sym];
    for (const ev of S.events) if (ev.t === t) {
      const len = Math.round(clamp(Math.abs(ev.jump) / dpth(S), 16, 40));
      // headline crowd strength is [floor, cap] per pit (x one informed block)
      S.fundJ += ev.jump; S.burst = { dir: Math.sign(ev.jump) || 1, left: len, max: len, size: (() => { const fc = { SOY: [1.7, 3.3], CRUDE: [1.4, 3], DM: [1.3, 2.4], BOND: [1.2, 2.0], SPX: [1.0, 1.0] }[S.sym] || [1, 2]; return Math.min(fc[1], Math.max(fc[0], Math.abs(ev.jump) / (4 * dpth(S)))); })(),  tilt: clamp(Math.abs(ev.jump) / (3 * dpth(S)), 0.4, 1) };
      addNews(G, 'mkt', ev.text); events.push({ kind: 'headline', text: ev.text, jump: ev.jump, scripted: ev.scripted });
    }
    const o = S.offer;
    if (o && !o.resolved && o.t === t) events.push({ kind: 'offer', text: `Your broker flashes you a ${o.lots}-lot ${o.side > 0 ? 'BUY' : 'SELL'} order in ${c.name} — a big customer. It will hit the book in a few seconds and sweep the price. Fill it fairly for ${money(o.bonus)} brokerage… or trade ahead of it first?` });

    if (S.regime.left <= 0) newRegime(G, S);
    S.regime.left--;
    S.imb *= 0.93; S.stepFlow = 0;
    S.thinA = clamp(1 - 0.25 * Math.max(0, S.imb), 0.35, 1);
    S.thinB = clamp(1 - 0.25 * Math.max(0, -S.imb), 0.35, 1);
    replenish(G, S);

    const burstFrac = S.burst ? S.burst.left / S.burst.max : 0, mult = 1 + 2 * burstFrac * (S.burst ? S.burst.size : 1);
    let n = rnd(G) < SHOUT_RATE * mult ? 1 : 0;
    if (mult > 1.5 && rnd(G) < SHOUT_RATE * (mult - 1)) n++;
    for (let i = 0; i < n; i++) crowdOrder(G, S, burstFrac);
    informedOrder(G, S);
    if (S.rev && S.rev.age >= 2 && (midOf(S) - S.rev.anchor) * -S.rev.dir > 0.5) { // liquidity providers lean back against impact (yours, or a customer block) with real orders, only until price is back where it started
      const c2 = CBY[S.sym], pr = Math.min(0.5, S.rev.str * 0.8 * (S.rev.left / 50));
      if (rnd(G) < pr) { const r = sweep(G, S, S.rev.dir, Math.max(1, Math.round(dpth(S) * c2.act * (0.5 + rnd(G)))), 'pit'); S.imb += S.rev.dir * r.filled / dpth(S); }
    }
    for (let r = RETAIL_RATE; r > 0; r -= 1) {
      if (rnd(G) < Math.min(1, r)) sweep(G, S, rnd(G) < 0.5 ? 1 : -1, Math.max(1, Math.round(dpth(S) * 0.09 * (0.5 + rnd(G)))), 'retail');
    }
    if (o && t === o.jt) o.anchor = midOf(S);
    if (o && o.resolved && t >= o.jt && t < o.jt + 4) { // the customer's block hits the book in chunks
      const r = sweep(G, S, o.side, Math.ceil(o.lots / 4), 'block'); S.imb += o.side * r.filled / dpth(S);
      if (t === o.jt + 3) S.rev = { dir: -o.side, left: 50, age: 0, str: 0.35, anchor: o.anchor };
    }
    S.flowEma = 0.96 * S.flowEma + 0.04 * S.stepFlow / dpth(S);
    if (S.burst && --S.burst.left <= 0) S.burst = null;
    if (S.react && --S.react.left <= 0) S.react = null;
    if (S.rev) { S.rev.age++; if (--S.rev.left <= 0) S.rev = null; }
    ensureDepth(G, S, 5);
    S.path.push(midOf(S));
    updateLeanCall(S, G);

    if (o && o.resolved === 'ahead' && t === o.jt + 8) settleFrontRun(G, events);
    if (G.pos) {
      const mid = midOf(S);
      const maint = MAINT * marginOf(G, S.sym) * Math.abs(G.pos.qty), ratio = equity(G) / maint;
      if (equity(G) < maint) {
        const lots = Math.abs(G.pos.qty);
        flatten(G, true); G.flags.margin = true; S.warned = false;
        const pen = lots * LIQ_PENALTY; G.cash -= pen; G.ytd -= pen; G.stats.fees += pen; G.stats.streak = 0;
        const text = `MARGIN CALL! Your clearing firm liquidated your position and charged a ${money(pen)} liquidation fee.`;
        addNews(G, 'life', text); events.push({ kind: 'margin', text });
      } else if (ratio < 1.3 && !S.warned) {
        S.warned = true;
        const lp = liqPrice(G), dist = Math.abs(midOf(S) - lp);
        events.push({ kind: 'marginwarn', text: `MARGIN WARNING: ${dist.toFixed(0)} ticks from liquidation. Cut size or get out!` });
      } else if (ratio > 1.6) S.warned = false;
      if (G.pos && S.stop > 0 && (G.pos.entry - midOf(S)) * Math.sign(G.pos.qty) >= S.stop) {
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
    const gain = (midOf(S) - a.px) * o.side * a.qty * CBY[S.sym].tickVal;
    if (gain > 0) {
      G.flags.frontWin = true;
      const p = .25 + .2 * (G.heat - 1);
      if (rnd(G) < p) G.sec = { at: G.day + 10 + Math.floor(rnd(G) * 20), profit: gain, warned: false };
      const text = `Front-running paid off: ~${money(gain)} on the customer's order. Hope the exchange compliance guys weren't watching…`;
      addNews(G, 'life', text); events.push({ kind: 'insider', text });
    } else events.push({ kind: 'insider', text: 'You traded ahead… but it didn\'t pay. You took the risk and none of the reward.' });
  }

  function finishSession(G, events) {
    const S = G.sess; S.done = true; S.orders = [];
    const closeT = Math.round(midOf(S));
    const closes = {}; closes[S.sym] = closeT;
    endOfDay(G, events, closes, S);
  }

  // ---------------------------------------------------------------- end of day: settlement, margin, bills, tax
  function endOfDay(G, events, closes, S) {
    const date = dateOfDay(G.day);
    for (const e of eventsByDay[G.day] || []) addNews(G, 'era', e.text);
    // daily settlement of variation margin
    const cashBefore = G.cash, prevSPX = G.mk.SPX.close;
    for (const c of CONTRACTS) {
      const closeT = closes && closes[c.sym] != null ? closes[c.sym] : G.today.per[c.sym].closeT;
      if (G.pos && G.pos.sym === c.sym) {
        const v = (closeT - G.pos.entry) * G.pos.qty * c.tickVal;
        G.cash += v; G.ytd += v; G.stats.realized += v; G.pos.entry = closeT;
        if (v < -5000) G.flags.gap = true;
      }
      G.mk[c.sym].close = closeT;
    }
    stepRivals(G, Math.log(G.mk.SPX.close / prevSPX), events);
    // session summary
    if (S) {
      const pnl = G.cash - S.startEq;
      G.lastSession = { sym: S.sym, pnl, trades: S.trades, wins: S.wins, fees: 0, overnight: !!G.pos, date: date.getTime(), ...(S.log ? { log: S.log } : {}) };
      const st = G.stats;
      st.bestDay = Math.max(st.bestDay, pnl); st.worstDay = Math.min(st.worstDay, pnl);
      st.streak = pnl > 0 ? st.streak + 1 : 0;
      if (pnl >= 10000) G.flags.bigDay = true;
      if (st.streak >= 5) G.flags.streak5 = true;
      if (S.scripted && pnl >= 2000) G.flags.headline = true;
      G.yr.sessions++; G.yr.best = Math.max(G.yr.best, pnl); G.yr.worst = Math.min(G.yr.worst, pnl);
      events.push({ kind: 'close', summary: G.lastSession });
    }
    // margin call at settlement (e.g. you held through a gap)
    if (G.pos) {
      if (G.cash < MAINT * marginOf(G, G.pos.sym) * Math.abs(G.pos.qty)) {
        const lots = Math.abs(G.pos.qty), pen = lots * (LIQ_PENALTY + feeOf(G));
        G.cash -= pen; G.ytd -= pen; G.stats.fees += pen; G.stats.streak = 0; G.pos = null; G.flags.margin = true;
        const text = `MARGIN CALL at settlement! Your clearing firm liquidated your overnight position and charged ${money(pen)}.`;
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
    if (!G.over) checkNotice(G, events);
    if (!G.over && monthIdxOfDay(G.day) !== G.billMonth) { G.billMonth = monthIdxOfDay(G.day); payBills(G, events); }
    if (!G.over) checkSec(G, events);
    if (!G.over) {
      const nw = netWorth(G);
      G.nwHist.push(nw); if (G.nwHist.length > 800) G.nwHist.shift();
      if (nw > G.stats.peak) { G.stats.peak = nw; G.stats.peakDay = G.day; }
      if (nw < 500) G.flags.low = true;
      careerCheck(G, events);
      standings(G, events);
    }
    yearReview(G, events);
    for (const a of checkAchievements(G)) events.push({ kind: 'ach', text: a.name, ach: a });
    if (!G.over) { prepareDay(G); makeTips(G); }
    return events;
  }

  // ---------------------------------------------------------------- seeded duels: same pit, same day, same crowd for both players
  const DUEL_CASH = 25000;
  function duelFromSeed(seed) {
    const g = { rs: Math.imul((seed | 0) ^ 0x5BD1E995, 0x2C1B3C6D) }; rnd(g); rnd(g);
    const last = Math.round((END_MS - START_MS) / 864e5 * 5 / 7) - 40;
    const sym = CONTRACTS[Math.floor(rnd(g) * CONTRACTS.length)].sym, day = 30 + Math.floor(rnd(g) * (last - 30));
    return { seed: seed | 0, sym, day };
  }
  function duelGame(ch) {
    const G = newGame(ch.seed);
    G.day = ch.day; G.rs = (ch.seed ^ Math.imul(ch.day, 0x85EBCA6B)) | 0;
    for (const c of CONTRACTS) { G.mk[c.sym].close = Math.round(anchorPrice(c.sym, dateOfDay(ch.day - 1).getTime()) / c.tick); G.unlocked[c.sym] = true; }
    G.billMonth = monthIdxOfDay(ch.day); G.cash = DUEL_CASH; G.news = []; G.tips = [];
    prepareDay(G);
    return G;
  }

  // the market with nobody trading in it: the backdrop for comparing two players' fills
  function duelPath(ch) {
    const G = duelGame(ch); startSession(G, ch.sym, { duel: ch.seed });
    const S = G.sess; while (G.sess && !S.done) stepSession(G);
    return S.path.slice();
  }

  function skipDays(G, n) {
    const events = [];
    const STOP = ['repo', 'homeless', 'margin', 'sec', 'warn', 'prison', 'end', 'unlock', 'promote', 'demote', 'notice', 'noticeOk', 'life', 'review'];
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
    return Math.round((HOMES[G.home].rent + livingCost(G) + CAREER[G.level || 0].dues) * inflation(G)) + CARS[G.car].upkeep + TECH[G.tech].upkeep + lux;
  }
  const inflation = (G) => 1 + 0.03 * (dateOfDay(G.day).getUTCFullYear() - 1990); // rent, living costs and dues creep up 3%/yr; your diner wage doesn't
  const monthlyIncome = (G) => (G.home <= 1 ? 400 : 0); // diner job — you quit once you move up
  const assetValue = (G) => SELL_RATIO * (CARS[G.car].price + TECH[G.tech].price + G.lux.reduce((a, id) => a + LUX.find((l) => l.id === id).price, 0));
  const netWorth = (G) => equity(G) + assetValue(G);
  const marginUsed = (G) => (G.pos ? Math.abs(G.pos.qty) * marginOf(G, G.pos.sym) : 0);
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

  function lifeShock(G) {
    if (rnd(G) >= 0.12) return null; // roughly one surprise a year
    const base = monthlyCosts(G);
    const opts = [
      ['Emergency room visit, no insurance. The bill arrives.', Math.round(base * 0.8)],
      ['Your landlord finds "unauthorized modifications" and keeps your deposit.', Math.round(HOMES[G.home].rent)],
      ['Your brother-in-law needs a "short-term loan" for his bar. You never see it again.', Math.round(Math.max(400, Math.min(Math.max(G.cash, 0), 20000) * 0.06))],
    ];
    if (G.car > 0) opts.push([`The ${CARS[G.car].name} needs a major repair.`, Math.round(Math.max(300, CARS[G.car].price * 0.05))]);
    const [text, amount] = pick(G, opts);
    return { text, amount };
  }

  // pay what's owed now, repossessing and downgrading if that's what it takes
  function settleBills(G, events, tax, shockAmt, extra) {
    const needFn = () => monthlyCosts(G) - monthlyIncome(G) + tax + shockAmt + extra;
    const costs = monthlyCosts(G), income = monthlyIncome(G), msgs = [];
    if (!liquidateFor(G, needFn, msgs)) return goHomeless(G, events, "You can't make rent. Everything is gone. You're out on the street.");
    G.cash -= needFn();
    if (tax > 0) { G.taxDue = 0; G.flags.taxPaid = (G.flags.taxPaid || 0) + tax; addNews(G, 'life', `You paid the IRS ${money(tax)}.`); }
    if (msgs.length) { const text = 'Bills overdue! ' + msgs.join('. ') + '.'; addNews(G, 'life', text); events.push({ kind: 'repo', text }); }
    else addNews(G, 'life', `Monthly bills paid: ${money(costs)}${income ? ` (diner paycheck +$${income})` : ''}.`);
  }

  function payBills(G, events) {
    const month = dateOfDay(G.day).getUTCMonth();
    if (month === 0) { // new tax year
      const net = G.ytd;
      G.taxDue = Math.max(0, net) * TAX_RATE; G.ytd = Math.min(0, net);
      if (G.taxDue > 0) addNews(G, 'life', `Tax time: ${money(net)} in trading gains last year. The IRS wants ${money(G.taxDue)} by April.`);
    }
    const tax = month === 3 ? G.taxDue : 0;
    const shock = lifeShock(G);
    if (shock) { const text = `${shock.text} It costs ${money(shock.amount)}.`; addNews(G, 'life', text); events.push({ kind: 'life', text }); }
    const shockAmt = shock ? shock.amount : 0;
    if (G.notice) { // a second month in default: no more grace
      const old = G.notice; G.notice = null;
      return settleBills(G, events, tax + old.tax, shockAmt + old.shock, old.need - old.tax - old.shock - 0);
    }
    const need = monthlyCosts(G) - monthlyIncome(G) + tax + shockAmt;
    if (G.cash < need) { // can't cover it: final notice, you get a few trading days to raise the money
      G.notice = { issued: G.day, due: G.day + NOTICE_DAYS, need: Math.round(need), tax, shock: shockAmt };
      const text = `FINAL NOTICE: ${money(need)} is due and your account is ${money(need - G.cash)} short. Raise it within ${NOTICE_DAYS} trading days, or the repo man starts collecting.`;
      addNews(G, 'life', text); events.push({ kind: 'notice', text });
      return;
    }
    settleBills(G, events, tax, shockAmt, 0);
  }

  function checkNotice(G, events) {
    const n = G.notice; if (!n) return;
    if (G.cash >= n.need) {
      G.cash -= n.need; G.notice = null; G.flags.noticeOk = true;
      if (n.tax > 0) { G.taxDue = 0; G.flags.taxPaid = (G.flags.taxPaid || 0) + n.tax; }
      const text = `You scraped together ${money(n.need)} and paid the notice just in time. The landlord backs off… for now.`;
      addNews(G, 'life', text); events.push({ kind: 'noticeOk', text });
    } else if (G.day >= n.due) {
      G.notice = null;
      addNews(G, 'life', 'The notice expired. The collectors arrive.');
      settleBills(G, events, n.tax, n.shock, 0);
    }
  }

  // ---------------------------------------------------------------- career ladder
  function careerCheck(G, events) {
    const nw = netWorth(G);
    let target = 0; for (const c of CAREER) if (nw >= c.nw) target = c.lvl;
    if (target > G.level && !G.notice) {
      G.level = target; G.career.low = 0;
      const opened = [];
      for (const c of CONTRACTS) if (c.unlock <= CAREER[target].nw && !G.unlocked[c.sym]) { G.unlocked[c.sym] = true; opened.push(c.name); }
      const cr = CAREER[target];
      const text = `PROMOTED to ${cr.title}! ${cr.perk}. Exchange dues are now ${money(cr.dues)}/mo — stay above ${money(Math.round(cr.nw * 0.6))} net worth or you'll lose the badge.`;
      addNews(G, 'life', text); events.push({ kind: 'promote', text, level: target, unlocked: opened });
    } else if (G.level > 0 && nw < CAREER[G.level].nw * 0.6) {
      if (++G.career.low >= 20) { // about a month below 60% of the badge threshold
        const nl = G.level - 1;
        if (!(G.pos && CBY[G.pos.sym].unlock > CAREER[nl].nw)) { // can't pull the badge while you hold a position in that pit
          const lost = CONTRACTS.filter((c) => c.unlock > CAREER[nl].nw && G.unlocked[c.sym]).map((c) => c.name);
          for (const c of CONTRACTS) if (c.unlock > CAREER[nl].nw) G.unlocked[c.sym] = false;
          const old = CAREER[G.level].title; G.level = nl; G.career.low = 0;
          const text = `DEMOTED: the exchange pulled your ${old} badge. You're a ${CAREER[nl].title} again${lost.length ? ' and locked out of ' + lost.join(', ') : ''}. Earn it back.`;
          addNews(G, 'life', text); events.push({ kind: 'demote', text, level: nl });
        }
      }
    } else G.career.low = 0;
  }

  // ---------------------------------------------------------------- rivals, standings, year in review
  function stepRivals(G, mkt, events) {
    RIVALS.forEach((def, i) => {
      const r = G.rivals[i];
      if (r.broke && G.day - r.broke > 60) r.broke = 0;
      const ret = def.mu / 252 + def.beta * mkt + (def.vol / Math.sqrt(252)) * gauss(G);
      r.nw = Math.max(3000, r.nw * (1 + clamp(ret, -0.5, 0.5)));
      if (def.blow && mkt < -0.02 && !r.broke && rnd(G) < def.blow) {
        const before = r.nw; r.nw = Math.max(5000, r.nw * 0.2); r.broke = G.day;
        const text = `${def.name} (${def.tag}) got liquidated in the selloff: ${money(before)} down to ${money(r.nw)}!`;
        addNews(G, 'mkt', text); events.push({ kind: 'rival', text });
      }
    });
  }
  function rankings(G) {
    const rows = RIVALS.map((d, i) => ({ id: d.id, name: d.name, tag: d.tag, nw: G.rivals[i].nw, broke: !!G.rivals[i].broke, you: false }));
    rows.push({ id: 'you', name: 'You', tag: CAREER[G.level || 0].title, nw: netWorth(G), you: true });
    rows.sort((a, b) => b.nw - a.nw);
    return rows.map((r, i) => Object.assign(r, { rank: i + 1 }));
  }
  function standings(G, events) {
    const rows = rankings(G), me = rows.find((r) => r.you).rank;
    if (G.rank && me < G.rank) { const passed = rows[me].name; const text = `You passed ${passed} on the standings. You're now #${me} on the floor.`; addNews(G, 'life', text); events.push({ kind: 'rank', text }); }
    else if (G.rank && me > G.rank && rows[me - 2]) { const text = `${rows[me - 2].name} overtook you. You slip to #${me}.`; addNews(G, 'life', text); events.push({ kind: 'rank', text }); }
    G.rank = me;
  }
  function yearReview(G, events) {
    const yr = dateOfDay(G.day).getUTCFullYear();
    if (G.over && G.over !== 'end') return;
    if (yr <= G.yr.year && G.over !== 'end') return;
    const rows = rankings(G), me = rows.find((r) => r.you);
    const nw1 = netWorth(G);
    const review = { year: G.yr.year, nw0: G.yr.nw0, nw1, pnl: nw1 - G.yr.nw0, rank: me.rank, of: rows.length, sessions: G.yr.sessions, best: G.yr.best, worst: G.yr.worst, title: CAREER[G.level].title, leader: rows[0].you ? rows[1] : rows[0], final: G.over === 'end' };
    if (me.rank === 1) G.flags.top1 = true;
    events.push({ kind: 'review', review });
    G.yr = { year: yr, nw0: nw1, sessions: 0, best: 0, worst: 0 };
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
    { id: 'trained', emoji: '🎓', name: 'Floor Trained', desc: 'Finish the Training Floor and learn to read order flow.', test: () => false },
    { id: 'lvl3', emoji: '🏅', name: 'Floor Broker', desc: 'Earn the Floor Broker badge.', test: (G) => G.level >= 3 },
    { id: 'lvl5', emoji: '🏆', name: 'Master of the Pit', desc: 'Earn the Master of the Pit badge.', test: (G) => G.level >= 5 },
    { id: 'notice', emoji: '📬', name: 'Beat the Landlord', desc: 'Pay a final notice in time.', test: (G) => G.flags.noticeOk },
    { id: 'top1', emoji: '🥇', name: 'King of the Floor', desc: 'Finish a year ranked #1 on the floor.', test: (G) => G.flags.top1 },
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
    newGame, duelFromSeed, duelGame, duelPath, DUEL_CASH, startSession, stepSession, CAREER, RIVALS, marginOf, feeOf, liqPrice, rankings, inflation, trade, flatten, setStop, placeLimit, cancelOrders, preview, forceRegime, inject, respondOffer, skipDays, recentFlow, flowGauge, leanSignal, leanCall, deltaBars, shoutsNow, ladder, quote,
    buyItem, sellItem, moveHome, checkAchievements,
    netWorth, equity, unreal, maxLots, marginUsed, marginLevel, markT, monthlyCosts, monthlyIncome, rankOf, livingCost,
    dateOfDay, clockOf, fmtPrice, priceOf,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
