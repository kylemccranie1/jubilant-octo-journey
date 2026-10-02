/* Wall Street '90 — game engine (pure logic, no DOM). Works in browser and Node. */
(function (root) {
  'use strict';

  const START_CASH = 8000;
  const START_MS = Date.UTC(1990, 0, 1);
  const END_MS = Date.UTC(2001, 0, 1);
  const WEEK_MS = 7 * 864e5;
  const SELL_RATIO = 0.6;
  const HIST_LEN = 104;
  const TAX_RATE = 0.28;       // 1990s top capital-gains rate
  const MARGIN_RATE = 0.09;    // annual interest on margin debt
  const MAINT = 0.25;          // maintenance margin (equity / gross exposure)
  const SAVE_VERSION = 2;

  const weekOf = (y, m, d) => Math.floor((Date.UTC(y, m - 1, d) - START_MS) / WEEK_MS);
  const dateOf = (week) => new Date(START_MS + week * WEEK_MS);
  const monthIdx = (week) => { const d = dateOf(week); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };

  // ---------------------------------------------------------------- content
  const STOCKS = [
    { t: 'IDX', name: 'Big Board Index Fund', sector: 'idx', beta: 1.0, vol: .12, p0: 35 },
    { t: 'MTRX', name: 'Microtronix', sector: 'tech', beta: 1.3, vol: .38, p0: 42 },
    { t: 'CSFT', name: 'CompuSoft', sector: 'tech', beta: 1.4, vol: .40, p0: 25 },
    { t: 'GULF', name: 'Gulf Crown Oil', sector: 'energy', beta: .6, vol: .24, p0: 38 },
    { t: 'FRDM', name: 'Freedom Bancorp', sector: 'bank', beta: .9, vol: .24, p0: 24 },
    { t: 'BRGR', name: 'Big Burger Co.', sector: 'cons', beta: .5, vol: .17, p0: 55 },
    { t: 'AMRJ', name: 'American Jetways', sector: 'air', beta: 1.2, vol: .36, p0: 18 },
    { t: 'GENX', name: 'GenoMax Pharma', sector: 'bio', beta: 1.0, vol: .55, p0: 12 },
    { t: 'STAR', name: 'Starlight Pictures', sector: 'media', beta: 1.0, vol: .30, p0: 30 },
    { t: 'TELC', name: 'TelCom Bell', sector: 'tele', beta: .7, vol: .20, p0: 48 },
    { t: 'MOTR', name: 'Detroit Motors', sector: 'auto', beta: 1.1, vol: .28, p0: 20 },
    { t: 'GOLD', name: 'GoldRush Mining', sector: 'pen', beta: .8, vol: .65, p0: 3.5 },
    { t: 'NNET', name: 'NetNebula', sector: 'net', beta: 1.6, vol: .85, p0: 14, ipo: weekOf(1995, 8, 9) },
    { t: 'BUYZ', name: 'Buyz.com', sector: 'net', beta: 1.6, vol: .90, p0: 16, ipo: weekOf(1997, 5, 19) },
    { t: 'WOOF', name: 'Woof.com', sector: 'net', beta: 1.7, vol: 1.0, p0: 11, ipo: weekOf(1999, 2, 8) },
    { t: 'GROC', name: 'GroceryGo', sector: 'net', beta: 1.7, vol: 1.0, p0: 18, ipo: weekOf(1999, 9, 13) },
  ];

  // [annual market drift, annual market vol]
  const ERA = {
    1990: [-.05, .20], 1991: [.26, .15], 1992: [.05, .13], 1993: [.08, .10], 1994: [.0, .14],
    1995: [.30, .10], 1996: [.20, .13], 1997: [.28, .17], 1998: [.25, .22], 1999: [.18, .20], 2000: [-.08, .28],
  };

  // extra annual drift per sector
  const TILT = {
    tech: { def: .03, 1990: -.05, 1995: .20, 1996: .15, 1997: .25, 1998: .30, 1999: .60, 2000: -.10 },
    net: { def: 0, 1995: .4, 1996: .6, 1997: .8, 1998: 1.0, 1999: 2.0, 2000: -.6 },
    bio: { def: .06, 1992: -.12, 1999: .25 },
    air: { def: 0, 1990: -.15, 1998: .15 },
    energy: { def: 0 }, bank: { def: .02 }, cons: { def: .03 }, media: { def: .03 },
    tele: { def: .03 }, auto: { def: 0 }, pen: { def: 0 }, idx: { def: 0 },
  };

  // scripted historical events: shocks are immediate % moves; mom = extra weekly drift for n weeks
  const ERA_EVENTS = [
    { at: [1990, 8, 6], text: 'IRAQ INVADES KUWAIT! Oil spikes, stocks tumble.', mkt: -.04, sec: { energy: .12, air: -.10 }, mom: { mkt: [8, -.008], energy: [8, .01] } },
    { at: [1991, 1, 14], text: 'Operation Desert Storm begins — Wall Street rallies!', mkt: .06, sec: { energy: -.08, air: .08 }, mom: { mkt: [6, .005] } },
    { at: [1992, 9, 14], text: 'Black Wednesday: Soros breaks the pound. Banks wobble.', mkt: -.02, sec: { bank: -.04 } },
    { at: [1992, 11, 2], text: 'Clinton wins. Healthcare reform fears hammer biotech.', mkt: .0, sec: { bio: -.08 }, mom: { bio: [6, -.01] } },
    { at: [1994, 2, 7], text: 'FED HIKES RATES! Bond market bloodbath.', mkt: -.04, sec: { bank: -.05 }, mom: { mkt: [8, -.004] } },
    { at: [1994, 12, 19], text: 'Mexican peso collapses. Investors flee emerging markets.', mkt: -.02, sec: {} },
    { at: [1995, 8, 9], text: 'NetNebula IPO soars! The Internet gold rush begins.', mkt: .01, sec: { net: .05 }, mom: { net: [10, .02] } },
    { at: [1996, 12, 5], text: 'Greenspan frets about "irrational exuberance". Markets dip.', mkt: -.025, sec: { tech: -.02, net: -.04 } },
    { at: [1997, 10, 27], text: 'ASIAN CRISIS! Dow plunges 554 points in a day.', mkt: -.07, sec: { bank: -.04 } },
    { at: [1997, 11, 3], text: 'Dip buyers pile in. Markets rebound hard.', mkt: .04, sec: {}, mom: { mkt: [4, .006] } },
    { at: [1998, 8, 17], text: 'RUSSIA DEFAULTS! Hedge funds in trouble.', mkt: -.05, sec: { bank: -.08, energy: -.05 } },
    { at: [1998, 9, 28], text: 'LTCM bailout engineered. Credit markets panic.', mkt: -.03, sec: { bank: -.05 } },
    { at: [1998, 10, 19], text: 'Fed cuts rates. Dot-com rally ignites!', mkt: .05, sec: { net: .10, tech: .05 }, mom: { mkt: [8, .008], net: [10, .03] } },
    { at: [1999, 12, 27], text: 'Y2K fever: tech stocks melt up into the millennium.', mkt: .02, sec: { tech: .04, net: .08 } },
    { at: [2000, 3, 13], text: 'NASDAQ tops 5,000. "This time is different," say the pundits.', mkt: .01, sec: { net: .08 } },
    { at: [2000, 4, 3], text: 'DOT-COM CRASH! Antitrust ruling sparks tech wipeout.', mkt: -.04, sec: { net: -.15, tech: -.10 }, mom: { net: [20, -.04], tech: [14, -.02] } },
    { at: [2000, 12, 11], text: 'Presidential election deadlocked in Florida. Markets jittery.', mkt: -.02, sec: {} },
  ];

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
  const TECH = [
    { id: 0, name: 'Rotary Phone & WSJ', emoji: '☎️', price: 0, upkeep: 0, comm: 45, tips: 0, acc: 0, desc: 'Call the broker, wait on hold. No tips.' },
    { id: 1, name: 'Motorola Brick Phone', emoji: '📱', price: 1500, upkeep: 50, comm: 35, tips: 1, acc: .55, desc: 'Cheaper trades + 1 rumor a week (55% right).' },
    { id: 2, name: 'IBM PC + Prodigy Modem', emoji: '🖥️', price: 4500, upkeep: 80, comm: 25, tips: 1, acc: .60, desc: 'Dial-up screech. 1 tip/week (60%).' },
    { id: 3, name: 'Quotron Terminal', emoji: '📟', price: 15000, upkeep: 250, comm: 15, tips: 2, acc: .66, desc: 'Real-time quotes. 2 tips/week (66%).' },
    { id: 4, name: 'Bloomberg Desk (4 monitors)', emoji: '🖲️', price: 70000, upkeep: 900, comm: 8, tips: 2, acc: .72, desc: 'Wall of screens. 2 tips/week (72%).' },
    { id: 5, name: 'Private Trading Floor', emoji: '🏛️', price: 350000, upkeep: 5000, comm: 3, tips: 3, acc: .80, desc: 'Analysts on payroll. 3 tips/week (80%).' },
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

  // ---------------------------------------------------------------- state
  const eventWeeks = {};
  ERA_EVENTS.forEach((e) => { const w = weekOf(...e.at); (eventWeeks[w] = eventWeeks[w] || []).push(e); });

  function newGame(seed) {
    const G = {
      v: SAVE_VERSION, rs: (seed == null ? (Math.random() * 2 ** 31) | 0 : seed) | 0,
      week: 0, cash: START_CASH, holdings: {}, shorts: {}, stocks: {}, hist: {},
      ytd: 0, taxDue: 0, heat: 0, fined: false, offer: null, insider: null, sec: null, lastOffer: -99, flags: {}, ach: {},
      home: 0, car: 0, tech: 0, lux: [],
      billMonth: monthIdx(0), mom: {}, smom: {}, next: null, tips: [],
      news: [], nwHist: [START_CASH], over: null,
      stats: { trades: 0, realized: 0, peak: START_CASH, peakWeek: 0, fees: 0 },
    };
    for (const s of STOCKS) {
      const active = !s.ipo;
      G.stocks[s.t] = { price: s.p0, prev: s.p0, active, delisted: false, mom: null };
      G.hist[s.t] = active ? [s.p0] : [];
    }
    G.next = computeNext(G, 1);
    addNews(G, 'era', "January 1990. You've got $8,000, a landline, and a dream. Make it big on Wall Street.");
    return G;
  }

  function addNews(G, tag, text) {
    G.seq = (G.seq || 0) + 1;
    G.news.unshift({ week: G.week, tag, text });
    if (G.news.length > 150) G.news.length = 150;
  }

  // ---------------------------------------------------------------- market model
  function computeNext(G, week) {
    const year = dateOf(week).getUTCFullYear();
    const [drift, vol] = ERA[year] || ERA[2000];
    const news = [];
    let mkt = drift / 52 + (vol / Math.sqrt(52)) * gauss(G);
    const secShock = {};
    for (const e of eventWeeks[week] || []) {
      mkt += e.mkt;
      for (const k in e.sec) secShock[k] = (secShock[k] || 0) + e.sec[k];
      for (const k in e.mom || {}) {
        if (k === 'mkt') G.mom.mkt = { n: e.mom[k][0], r: e.mom[k][1] };
        else G.smom[k] = { n: e.mom[k][0], r: e.mom[k][1] };
      }
      news.push({ tag: 'era', text: e.text, major: true });
    }
    if (G.mom.mkt) { mkt += G.mom.mkt.r; if (--G.mom.mkt.n <= 0) delete G.mom.mkt; }
    const secMom = {};
    for (const k in G.smom) { secMom[k] = G.smom[k].r; if (--G.smom[k].n <= 0) delete G.smom[k]; }

    const rets = {};
    for (const s of STOCKS) {
      const st = G.stocks[s.t];
      if (st.delisted) continue;
      if (s.ipo && s.ipo > week) continue;
      const tilt = TILT[s.sector];
      const sectorDrift = (tilt[year] != null ? tilt[year] : tilt.def) / 52;
      let r = s.beta * mkt + sectorDrift + (secShock[s.sector] || 0) + (secMom[s.sector] || 0)
        + (s.vol * 0.75 / Math.sqrt(52)) * gauss(G);
      if (st.mom) { r += st.mom.r; if (--st.mom.n <= 0) st.mom = null; }
      if (s.ipo === week) r += .35 + rnd(G) * .4; // IPO pop
      rets[s.t] = r;
    }
    // random company news (price move is baked into this week's return)
    if (rnd(G) < .65) {
      const cands = STOCKS.filter((s) => rets[s.t] != null && s.ipo !== week && s.sector !== 'idx');
      if (cands.length) companyNews(G, pick(G, cands), rets, news);
    }
    for (const t in rets) rets[t] = clamp(rets[t], -.6, 1.5);
    return { week, rets, news };
  }

  function companyNews(G, s, rets, news) {
    const bio = s.sector === 'bio';
    const kinds = [
      ['beats earnings estimates — shares jump!', [.07, .17], .012, 3, 1],
      ['misses earnings badly — shares slide.', [-.2, -.08], -.01, 3, 1],
      ['gets an analyst upgrade to "strong buy".', [.04, .09], .006, 2, 1],
      ['hit with a class-action lawsuit.', [-.14, -.06], -.006, 2, 1],
      ['unveils a hot new product line.', [.06, .14], .008, 3, 1],
      ['CEO caught in a scandal. Board scrambles.', [-.25, -.12], -.012, 3, .5],
      ['receives a surprise takeover bid!', [.25, .45], .0, 0, .35],
      ['accounting irregularities uncovered. SEC investigating.', [-.45, -.25], -.02, 4, .3],
    ];
    if (bio) kinds.push(['wins FDA approval for its blockbuster drug!', [.3, .6], .01, 3, .8], ['FDA rejects its key drug application.', [-.5, -.3], -.015, 3, .8]);
    const total = kinds.reduce((a, k) => a + k[4], 0);
    let x = rnd(G) * total, k = kinds[0];
    for (const kk of kinds) { x -= kk[4]; if (x <= 0) { k = kk; break; } }
    const mv = k[1][0] + rnd(G) * (k[1][1] - k[1][0]);
    rets[s.t] += mv;
    if (k[2]) G.stocks[s.t].mom = { n: k[3], r: k[2] };
    news.push({ tag: 'co', text: `${s.name} (${s.t}) ${k[0]}`, t: s.t, major: Math.abs(mv) > .3 });
  }

  // ---------------------------------------------------------------- advance
  function advanceWeek(G) {
    const events = [];
    if (G.over) return { events, over: G.over };
    if (G.offer) G.offer = null; // unanswered insider offers expire
    const nx = G.next;
    G.week = nx.week;
    const date = dateOf(G.week);
    for (const n of nx.news) { addNews(G, n.tag, n.text); if (n.major) events.push({ kind: 'news', text: n.text }); }

    for (const s of STOCKS) {
      const st = G.stocks[s.t];
      if (st.delisted) continue;
      if (s.ipo && s.ipo === G.week) {
        st.active = true; st.prev = s.p0;
        addNews(G, 'co', `${s.name} (${s.t}) begins trading at $${s.p0.toFixed(2)}.`);
        events.push({ kind: 'news', text: `NEW IPO: ${s.name} (${s.t}) opens at $${s.p0.toFixed(2)}!` });
      }
      if (!st.active) continue;
      st.prev = st.price;
      st.price = Math.max(.01, st.price * (1 + (nx.rets[s.t] || 0)));
      if (st.price < .4) { delist(G, s, events); continue; }
      if (st.price > 200) split(G, s, events);
      const h = G.hist[s.t]; h.push(st.price); if (h.length > HIST_LEN) h.shift();
    }

    resolveInsider(G, events);
    checkMargin(G, events);

    if (!G.over && monthIdx(G.week) !== G.billMonth) {
      G.billMonth = monthIdx(G.week);
      payBills(G, events);
    }
    if (!G.over) checkSec(G, events);

    if (!G.over) {
      const nw = netWorth(G);
      G.nwHist.push(nw); if (G.nwHist.length > 600) G.nwHist.shift();
      if (nw > G.stats.peak) { G.stats.peak = nw; G.stats.peakWeek = G.week; }
      if (nw < 500) G.flags.low = true;
      if (date.getTime() + WEEK_MS > END_MS) {
        G.over = 'end';
        events.push({ kind: 'end', text: 'The decade is over.' });
      }
    }
    for (const a of checkAchievements(G)) events.push({ kind: 'ach', text: a.name, ach: a });
    if (!G.over) { G.next = computeNext(G, G.week + 1); makeTips(G); maybeOffer(G, events); }
    return { events, over: G.over };
  }

  function delist(G, s, events) {
    const st = G.stocks[s.t];
    st.delisted = true; st.active = false;
    let msg = `${s.name} (${s.t}) files for CHAPTER 11 and is delisted.`;
    const h = G.holdings[s.t], sh = G.shorts[s.t];
    if (h) {
      const loss = h.cost * h.shares; realize(G, -loss);
      if (loss >= 10000) G.flags.bust = true;
      msg += ` Your ${h.shares} shares are worthless!`; delete G.holdings[s.t];
    }
    if (sh) {
      const gain = sh.entry * sh.shares; realize(G, gain); G.flags.shortWin = true;
      msg += ` Your short position pays out ${money(gain)}!`; delete G.shorts[s.t];
    }
    addNews(G, 'co', msg); events.push({ kind: 'bust', text: msg });
  }

  function split(G, s, events) {
    const st = G.stocks[s.t];
    st.price /= 2; st.prev /= 2;
    G.hist[s.t] = G.hist[s.t].map((p) => p / 2);
    const h = G.holdings[s.t]; if (h) { h.shares *= 2; h.cost /= 2; }
    const sh = G.shorts[s.t]; if (sh) { sh.shares *= 2; sh.entry /= 2; }
    const msg = `${s.name} (${s.t}) announces a 2-for-1 stock split.`;
    addNews(G, 'co', msg); events.push({ kind: 'news', text: msg });
  }

  function makeTips(G) {
    G.tips = [];
    const tier = TECH[G.tech];
    if (!tier.tips) return;
    const cands = STOCKS.filter((s) => G.next.rets[s.t] != null && G.stocks[s.t].active && s.sector !== 'idx');
    const used = new Set();
    const sources = ['Your barber', 'A guy at the bar', 'Your broker', 'The Quotron', 'A Goldman insider', 'Your analyst'];
    for (let i = 0; i < tier.tips && cands.length; i++) {
      const s = pick(G, cands);
      if (used.has(s.t)) continue; used.add(s.t);
      const truth = G.next.rets[s.t] >= 0;
      const up = rnd(G) < tier.acc ? truth : !truth;
      const src = sources[Math.min(G.tech + Math.floor(rnd(G) * 2), sources.length - 1)];
      G.tips.push({ t: s.t, up, text: `${src} says ${s.name} (${s.t}) is going to ${up ? 'POP 📈' : 'TANK 📉'}.` });
    }
    for (const tp of G.tips) addNews(G, 'tip', tp.text);
  }

  // ---------------------------------------------------------------- insider trading
  function maybeOffer(G, events) {
    if (G.offer || G.insider || G.sec) return;
    if (G.week < 20 || G.week - G.lastOffer < 26 || netWorth(G) < 15000 || rnd(G) > .035) return;
    const cands = STOCKS.filter((s) => G.next.rets[s.t] != null && G.stocks[s.t].active && s.sector !== 'idx');
    const s = pick(G, cands), up = rnd(G) < .55;
    G.lastOffer = G.week;
    const text = `Your old roommate, now at an investment bank, calls late at night: "${s.name} (${s.t}) is about to ${up ? 'announce a takeover' : 'restate its earnings'}. Next week it's going to ${up ? 'soar' : 'collapse'}. You didn't hear it from me."`;
    G.offer = { t: s.t, up, mv: up ? .3 + rnd(G) * .25 : -(.3 + rnd(G) * .2), text };
    events.push({ kind: 'offer', text });
  }
  function acceptOffer(G) {
    const o = G.offer; if (!o) return { ok: false, msg: 'No offer.' };
    const s = STOCKS.find((x) => x.t === o.t);
    G.next.rets[o.t] = clamp(G.next.rets[o.t] + o.mv, -.6, 1.5);
    G.next.news.push({ tag: 'co', major: true, t: o.t, text: o.up
      ? `${s.name} (${s.t}) announces SURPRISE ACQUISITION — shares soar!`
      : `${s.name} (${s.t}) restates earnings; fraud probe launched — shares collapse!` });
    G.tips = G.tips.filter((x) => x.t !== o.t);
    G.insider = { t: o.t, up: o.up, week: G.next.week };
    G.heat++; G.offer = null;
    return { ok: true, msg: `Insider tip taken. Position in ${o.t} now, before the news breaks.` };
  }
  function declineOffer(G) { G.offer = null; return { ok: true, msg: 'You walked away. Clean hands.' }; }

  function resolveInsider(G, events) {
    const ins = G.insider;
    if (!ins || ins.week !== G.week) return;
    G.insider = null;
    const st = G.stocks[ins.t], d = st.price - st.prev;
    const h = G.holdings[ins.t], sh = G.shorts[ins.t];
    const gain = ins.up ? (h ? h.shares * d : 0) : (sh ? sh.shares * -d : 0);
    if (gain > 0) {
      G.flags.insiderWin = true;
      const p = .25 + .2 * (G.heat - 1);
      if (rnd(G) < p) G.sec = { at: G.week + 3 + Math.floor(rnd(G) * 6), profit: gain, warned: false };
      const text = `Your insider trade in ${ins.t} paid off: +${money(gain)}. Hope nobody noticed…`;
      addNews(G, 'life', text); events.push({ kind: 'insider', text });
    } else {
      const text = `You didn't act on the ${ins.t} tip. The stock ${ins.up ? 'soared' : 'collapsed'} without you.`;
      addNews(G, 'life', text); events.push({ kind: 'insider', text });
    }
  }
  function checkSec(G, events) {
    const sec = G.sec; if (!sec) return;
    if (G.week === sec.at - 1 && !sec.warned) {
      sec.warned = true;
      const text = 'Unmarked sedans are parked outside your building. Your phone clicks when you pick it up.';
      addNews(G, 'life', text); events.push({ kind: 'warn', text });
    }
    if (G.week < sec.at) return;
    G.sec = null;
    if (G.fined) {
      G.over = 'prison';
      const text = 'FBI agents arrive with a warrant. Second offense. You are going to federal prison.';
      addNews(G, 'life', text); events.push({ kind: 'prison', text }); return;
    }
    G.fined = true; G.flags.fined = true;
    const fine = Math.max(10000, sec.profit * 3), msgs = [];
    const ok = liquidateFor(G, () => fine, msgs);
    if (ok) {
      G.cash -= fine;
      const text = `SEC SETTLEMENT: insider trading. You disgorge your profits and pay a ${money(fine)} fine.${msgs.length ? ' ' + msgs.join('. ') + '.' : ''} One more strike and it's prison.`;
      addNews(G, 'life', text); events.push({ kind: 'sec', text });
    } else {
      G.over = 'homeless';
      const text = `SEC fines you ${money(fine)}. You can't pay, and everything is seized. You're on the street.`;
      addNews(G, 'life', text); events.push({ kind: 'homeless', text });
    }
  }

  // ---------------------------------------------------------------- money
  const livingCost = (G) => 150 + 100 * G.home;
  function monthlyCosts(G) {
    const lux = G.lux.reduce((a, id) => a + LUX.find((l) => l.id === id).upkeep, 0);
    return HOMES[G.home].rent + livingCost(G) + CARS[G.car].upkeep + TECH[G.tech].upkeep + lux;
  }
  const monthlyIncome = (G) => (G.home <= 1 ? 400 : 0); // diner job — you quit once you move up
  const stockValue = (G) => { let v = 0; for (const t in G.holdings) v += G.holdings[t].shares * G.stocks[t].price; return v; };
  const shortValue = (G) => { let v = 0; for (const t in G.shorts) v += G.shorts[t].shares * G.stocks[t].price; return v; };
  const assetValue = (G) => SELL_RATIO * (CARS[G.car].price + TECH[G.tech].price + G.lux.reduce((a, id) => a + LUX.find((l) => l.id === id).price, 0));
  const netWorth = (G) => G.cash + stockValue(G) - shortValue(G) + assetValue(G);
  const gross = (G) => stockValue(G) + shortValue(G);
  const equity = (G) => G.cash + stockValue(G) - shortValue(G);
  const marginDebt = (G) => Math.max(0, -G.cash);
  const commission = (G) => TECH[G.tech].comm;
  const marginLevel = (G) => { const g = gross(G); return g > 0 ? equity(G) / g : Infinity; };
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

  function realize(G, amt) { G.ytd += amt; G.stats.realized += amt; }

  // sell just enough shares (largest position first) to bring cash up to `target`; no commission when forced
  function raiseCash(G, target) {
    let sold = false;
    const order = Object.keys(G.holdings).sort((x, y) => G.holdings[y].shares * G.stocks[y].price - G.holdings[x].shares * G.stocks[x].price);
    for (const t of order) {
      if (G.cash >= target) break;
      const h = G.holdings[t], px = G.stocks[t].price;
      sell(G, t, Math.min(h.shares, Math.ceil((target - G.cash) / px)), true); sold = true;
    }
    return sold;
  }

  // Free up cash to cover needFn() by liquidating stocks, then luxuries, car, gear, home. Returns false if impossible.
  function liquidateFor(G, needFn, msgs) {
    let guard = 40;
    while (G.cash < needFn() && guard--) {
      const need = needFn(), g = gross(G);
      if (g > 0 && equity(G) - need >= 0.35 * g) return true; // can float it on margin safely
      if (Object.keys(G.holdings).length) { raiseCash(G, need); if (!msgs.includes('Broker sold stock')) msgs.push('Broker sold stock'); }
      else if (G.lux.length) {
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
    const month = dateOf(G.week).getUTCMonth();
    if (month === 0) { // new tax year: settle last year's gains
      const net = G.ytd;
      G.taxDue = Math.max(0, net) * TAX_RATE; G.ytd = Math.min(0, net);
      if (G.taxDue > 0) addNews(G, 'life', `Tax time: ${money(net)} in capital gains last year. The IRS wants ${money(G.taxDue)} by April.`);
    }
    const interest = (G.cash < 0 ? -G.cash * MARGIN_RATE / 12 : 0) + shortValue(G) * .01 / 12;
    const tax = month === 3 ? G.taxDue : 0;
    const needFn = () => monthlyCosts(G) - monthlyIncome(G) + interest + tax;
    const costs = monthlyCosts(G), income = monthlyIncome(G), msgs = [];
    const ok = liquidateFor(G, needFn, msgs);
    if (!ok) {
      G.cash = Math.max(0, G.cash);
      G.over = 'homeless';
      const text = "You can't make rent. Everything is gone. You're out on the street.";
      addNews(G, 'life', text); events.push({ kind: 'homeless', text }); return;
    }
    G.cash -= needFn();
    if (tax > 0) { G.taxDue = 0; G.flags.taxPaid = (G.flags.taxPaid || 0) + tax; addNews(G, 'life', `You paid the IRS ${money(tax)}.`); }
    if (msgs.length) {
      const text = 'Bills overdue! ' + msgs.join('. ') + '.';
      addNews(G, 'life', text); events.push({ kind: 'repo', text });
    } else {
      addNews(G, 'life', `Monthly bills paid: ${money(costs)}${income ? ` (diner paycheck +$${income})` : ''}${interest >= 1 ? `, margin/short interest ${money(interest)}` : ''}.`);
    }
  }

  // margin call: if equity falls below maintenance, the broker force-closes positions (largest first)
  function checkMargin(G, events) {
    if (gross(G) <= 0 || equity(G) >= MAINT * gross(G)) return;
    const closed = [];
    let guard = 40;
    while (gross(G) > 0 && equity(G) < MAINT * gross(G) * 1.2 && guard--) {
      const all = [];
      for (const t in G.holdings) all.push([t, 'L', G.holdings[t].shares * G.stocks[t].price]);
      for (const t in G.shorts) all.push([t, 'S', G.shorts[t].shares * G.stocks[t].price]);
      all.sort((a, b) => b[2] - a[2]);
      const [t, kind] = all[0];
      if (kind === 'L') sell(G, t, G.holdings[t].shares, true); else cover(G, t, G.shorts[t].shares, true);
      closed.push(`${kind === 'L' ? 'sold' : 'covered'} ${t}`);
    }
    G.flags.margin = true;
    const text = `MARGIN CALL! Your account fell below maintenance. The broker force-liquidated your positions (${closed.join(', ')}).`;
    addNews(G, 'life', text); events.push({ kind: 'margin', text });
  }

  // ---------------------------------------------------------------- trading
  // Reg-T style: gross exposure (longs + shorts) may not exceed 2x equity. Cash < 0 means margin debt.
  function maxOpen(G, t) {
    const st = G.stocks[t];
    if (G.over || !st.active) return 0;
    const q = (2 * (equity(G) - commission(G)) - gross(G)) / st.price;
    return Math.max(0, Math.floor(q + 1e-9));
  }
  const maxBuy = (G, t) => (G.shorts[t] ? 0 : maxOpen(G, t));
  const maxShort = (G, t) => (G.holdings[t] ? 0 : maxOpen(G, t));

  function buy(G, t, qty) {
    const st = G.stocks[t]; qty = Math.floor(qty);
    if (G.over || !st.active || qty < 1) return { ok: false, msg: 'Invalid order.' };
    if (G.shorts[t]) return { ok: false, msg: `You're short ${t}. Cover first.` };
    if (qty > maxOpen(G, t)) return { ok: false, msg: 'Not enough buying power (margin limit 2x equity).' };
    const c = commission(G);
    G.cash -= qty * st.price + c; G.stats.fees += c; G.stats.trades++;
    const h = G.holdings[t] || (G.holdings[t] = { shares: 0, cost: 0 });
    h.cost = (h.cost * h.shares + qty * st.price) / (h.shares + qty);
    h.shares += qty;
    return { ok: true, msg: `Bought ${qty} ${t} @ $${st.price.toFixed(2)}${G.cash < 0 ? ' (on margin)' : ''}` };
  }
  function sell(G, t, qty, quiet) {
    const st = G.stocks[t], h = G.holdings[t]; qty = Math.floor(qty);
    if (!h || qty < 1 || qty > h.shares) return { ok: false, msg: "You don't own that many shares." };
    const c = quiet ? 0 : commission(G);
    if (!quiet && G.cash + qty * st.price - c < 0 && qty * st.price - c < 0) return { ok: false, msg: 'Sale too small to cover the $' + c + ' commission.' };
    G.cash += qty * st.price - c; G.stats.fees += c; G.stats.trades++;
    realize(G, (st.price - h.cost) * qty - c);
    if (st.price / h.cost >= 5) G.flags.tenx = true;
    h.shares -= qty;
    if (h.shares === 0) delete G.holdings[t];
    return { ok: true, msg: `Sold ${qty} ${t} @ $${st.price.toFixed(2)}` };
  }
  function short(G, t, qty) {
    const st = G.stocks[t]; qty = Math.floor(qty);
    if (G.over || !st.active || qty < 1) return { ok: false, msg: 'Invalid order.' };
    if (G.holdings[t]) return { ok: false, msg: `You own ${t}. Sell your shares first.` };
    if (qty > maxOpen(G, t)) return { ok: false, msg: 'Not enough margin to short that much (limit 2x equity).' };
    const c = commission(G);
    G.cash += qty * st.price - c; G.stats.fees += c; G.stats.trades++;
    const sh = G.shorts[t] || (G.shorts[t] = { shares: 0, entry: 0 });
    sh.entry = (sh.entry * sh.shares + qty * st.price) / (sh.shares + qty);
    sh.shares += qty;
    return { ok: true, msg: `Shorted ${qty} ${t} @ $${st.price.toFixed(2)}` };
  }
  function cover(G, t, qty, quiet) {
    const st = G.stocks[t], sh = G.shorts[t]; qty = Math.floor(qty);
    if (!sh || qty < 1 || qty > sh.shares) return { ok: false, msg: "You're not short that many shares." };
    const c = quiet ? 0 : commission(G);
    G.cash -= qty * st.price + c; G.stats.fees += c; G.stats.trades++;
    const gain = (sh.entry - st.price) * qty - c;
    realize(G, gain); if (gain > 0) G.flags.shortWin = true;
    sh.shares -= qty;
    if (sh.shares === 0) delete G.shorts[t];
    return { ok: true, msg: `Covered ${qty} ${t} @ $${st.price.toFixed(2)}` };
  }

  // ---------------------------------------------------------------- achievements
  const ACH = [
    { id: 'first', emoji: '🧾', name: 'First Trade', desc: 'Make your first trade.', test: (G) => G.stats.trades >= 1 },
    { id: 'nw25k', emoji: '🌱', name: 'In the Green', desc: 'Reach $25,000 net worth.', test: (G) => netWorth(G) >= 25e3 },
    { id: 'nw100k', emoji: '💵', name: 'Six Figures', desc: 'Reach $100,000 net worth.', test: (G) => netWorth(G) >= 1e5 },
    { id: 'nw1m', emoji: '🤑', name: 'Millionaire', desc: 'Reach $1,000,000 net worth.', test: (G) => netWorth(G) >= 1e6 },
    { id: 'nw10m', emoji: '👑', name: 'Master of the Universe', desc: 'Reach $10,000,000 net worth.', test: (G) => netWorth(G) >= 1e7 },
    { id: 'condo', emoji: '🏙️', name: 'Moving On Up', desc: 'Move into a Yuppie Condo or better.', test: (G) => G.home >= 2 },
    { id: 'rolex', emoji: '⌚', name: 'Time Is Money', desc: 'Buy the Rolex.', test: (G) => G.lux.includes('rolex') },
    { id: 'mansion', emoji: '🏰', name: 'Lifestyles of the Rich', desc: 'Live in the Hamptons mansion.', test: (G) => G.home === 5 },
    { id: 'jet', emoji: '🛩️', name: 'Frequent Flyer', desc: 'Own a private jet share.', test: (G) => G.lux.includes('jet') },
    { id: 'short', emoji: '🐻', name: 'Bear Necessities', desc: 'Close a profitable short.', test: (G) => G.flags.shortWin },
    { id: 'tenx', emoji: '🚀', name: 'To the Moon', desc: 'Sell a stock at 5x your cost.', test: (G) => G.flags.tenx },
    { id: 'margin', emoji: '📞', name: 'Leverage Is a Hell of a Drug', desc: 'Get a margin call.', test: (G) => G.flags.margin },
    { id: 'bust', emoji: '💥', name: 'Pets.com Victim', desc: 'Lose $10,000+ on a bankrupt stock.', test: (G) => G.flags.bust },
    { id: 'insider', emoji: '🤫', name: 'Gekko Wannabe', desc: 'Profit from an insider tip.', test: (G) => G.flags.insiderWin },
    { id: 'sec', emoji: '⚖️', name: 'Boesky Moment', desc: 'Get fined by the SEC.', test: (G) => G.flags.fined },
    { id: 'prison', emoji: '⛓️', name: 'Club Fed', desc: 'Go to federal prison.', test: (G) => G.over === 'prison' },
    { id: 'tax', emoji: '🏛️', name: 'Uncle Sam Thanks You', desc: 'Pay $10,000+ in capital-gains tax.', test: (G) => (G.flags.taxPaid || 0) >= 1e4 },
    { id: 'comeback', emoji: '🔥', name: 'Comeback Kid', desc: 'Fall below $500, then climb back above $50,000.', test: (G) => G.flags.low && netWorth(G) >= 5e4 },
    { id: 'rock', emoji: '🥫', name: 'Rock Bottom', desc: 'End up homeless.', test: (G) => G.over === 'homeless' },
    { id: 'y2k', emoji: '🎆', name: 'Y2K Survivor', desc: 'Make it to the end of the decade.', test: (G) => G.over === 'end' },
    { id: 'index', emoji: '📊', name: 'Slow and Steady', desc: 'Finish the game holding $10,000+ of the Index Fund.', test: (G) => G.over === 'end' && G.holdings.IDX && G.holdings.IDX.shares * G.stocks.IDX.price >= 1e4 },
  ];
  function checkAchievements(G) {
    const fresh = [];
    for (const a of ACH) {
      if (G.ach[a.id]) continue;
      let ok = false; try { ok = !!a.test(G); } catch (e) {}
      if (ok) { G.ach[a.id] = G.week; fresh.push(a); }
    }
    return fresh;
  }

  // ---------------------------------------------------------------- lifestyle
  function moveHome(G, id) {
    if (id === G.home) return { ok: false, msg: 'You already live here.' };
    const deposit = id > G.home ? HOMES[id].rent * 2 : 0;
    if (G.cash < deposit) return { ok: false, msg: 'Need first + last month: $' + deposit.toLocaleString() };
    G.cash -= deposit; G.home = id;
    addNews(G, 'life', `You moved into a ${HOMES[id].name}.`);
    return { ok: true, msg: `Moved to ${HOMES[id].name}` };
  }
  function buyItem(G, cat, id) {
    if (cat === 'home') return moveHome(G, id);
    if (cat === 'lux') {
      const it = LUX.find((l) => l.id === id);
      if (G.lux.includes(id)) return { ok: false, msg: 'Already owned.' };
      if (G.cash < it.price) return { ok: false, msg: 'Not enough cash.' };
      G.cash -= it.price; G.lux.push(id);
      addNews(G, 'life', `You bought: ${it.name}.`);
      return { ok: true, msg: `Bought ${it.name}` };
    }
    const list = cat === 'car' ? CARS : TECH, cur = G[cat], it = list[id];
    if (id <= cur) return { ok: false, msg: 'You already have something better.' };
    const net = it.price - SELL_RATIO * list[cur].price;
    if (G.cash < net) return { ok: false, msg: 'Not enough cash (trade-in applied: $' + Math.round(net).toLocaleString() + ').' };
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
    START_CASH, SELL_RATIO, SAVE_VERSION, TAX_RATE, MARGIN_RATE, MAINT, STOCKS, HOMES, CARS, TECH, LUX, RANKS, ACH,
    newGame, advanceWeek, buy, sell, short, cover, maxBuy, maxShort, buyItem, sellItem, moveHome,
    acceptOffer, declineOffer, checkAchievements,
    netWorth, stockValue, shortValue, assetValue, gross, equity, marginDebt, marginLevel,
    monthlyCosts, monthlyIncome, commission, rankOf, dateOf, livingCost,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
