/* The Pit '90 — UI */
(() => {
  'use strict';
  const E = window.Engine;
  const $ = (id) => document.getElementById(id);
  const SAVE_KEY = 'ws90_save_v3';
  const TROPHY_KEY = 'ws90_trophies_v1';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  let G = null, tab = 'pit', selSym = 'SOY', seen = 0, toastTimer = null, busy = false;
  let live = null; // { timer, speed, paused, qty, stopIdx, bannerTimer, lastSave }
  let trophies = {};
  try { trophies = JSON.parse(localStorage.getItem(TROPHY_KEY)) || {}; } catch (e) {}

  // ---------- helpers
  const sfx = (n) => window.Sfx && window.Sfx.play(n);
  const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
  const money = (n, d = 0) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sgn = (n) => (n >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  const big = (n) => Math.abs(n) >= 1e6 ? (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1e6).toFixed(2) + 'M' : money(n);
  const pct = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%';
  const dateStr = (day) => { const d = E.dateOfDay(day); return `${DOWS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
  const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : 'dim');
  const fp = (sym, t) => E.fmtPrice(sym, t);

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) {} }
  function load() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); return s && s.v === E.SAVE_VERSION ? s : null; } catch (e) { return null; } }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
  function noteAch(list) {
    for (const a of list) { if (!trophies[a.id]) trophies[a.id] = Date.now(); toast('🏆 ' + a.name); sfx('ach'); }
    if (list.length) try { localStorage.setItem(TROPHY_KEY, JSON.stringify(trophies)); } catch (e) {}
  }

  function lineChart(arr, h = 110, w = 320) {
    if (arr.length < 2) return `<svg class="chart" viewBox="0 0 ${w} ${h}"></svg>`;
    const min = Math.min(...arr), max = Math.max(...arr), span = max - min || 1;
    const pts = arr.map((v, i) => [(i / (arr.length - 1)) * w, h - 6 - ((v - min) / span) * (h - 12)]);
    const line = pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const col = arr[arr.length - 1] >= arr[0] ? '#2dff7a' : '#ff4d5e';
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polygon points="0,${h} ${line} ${w},${h}" fill="${col}" opacity=".12"/><polyline points="${line}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  }

  // ---------- main (between sessions) rendering
  const unread = () => Math.min(99, (G.seq || 0) - seen);

  function render() {
    renderTop();
    const v = $('view'), scroll = v.scrollTop;
    v.innerHTML = { pit: viewPit, ledger: viewLedger, life: viewLife, news: viewNews, trophy: viewTrophies }[tab]();
    v.scrollTop = scroll;
    renderTabs();
    $('actions').classList.toggle('hidden', tab !== 'pit' || !!G.over);
  }

  function renderTop() {
    const nw = E.netWorth(G), prev = G.nwHist.length > 1 ? G.nwHist[G.nwHist.length - 2] : nw, d = nw - prev;
    const bills = E.monthlyCosts(G) - E.monthlyIncome(G);
    $('top').innerHTML = `
      <div class="top-row"><span class="date">📅 ${dateStr(G.day)}</span><span><span class="rank">${E.rankOf(nw)}</span> <button class="mute" data-mute="1" aria-label="Toggle sound">${window.Sfx && window.Sfx.muted ? '🔇' : '🔊'}</button></span></div>
      <div class="nw ${nw < E.START_CASH * .5 ? 'down' : ''}">${big(nw)} <small class="${cls(d)}" style="font-size:12px">${d ? sgn(d) : ''}</small></div>
      <div class="sub"><span>Account <b>${money(G.cash)}</b></span>${G.pos ? `<span>Open <b class="${cls(E.unreal(G))}">${sgn(E.unreal(G))}</b></span>` : ''}<span>Bills <b>${money(bills)}/mo</b></span></div>`;
    const heads = G.news.filter((n) => n.tag !== 'tip').slice(0, 5).map((n) => n.text).join('   ◆   ');
    if ($('tapeText').dataset.t !== heads) { $('tapeText').textContent = heads; $('tapeText').dataset.t = heads; }
  }

  function renderTabs() {
    const T = [['pit', '🔔', 'The Pit'], ['ledger', '📒', 'Ledger'], ['life', '🏠', 'Lifestyle'], ['news', '📰', 'Wire'], ['trophy', '🏆', 'Trophies']];
    $('tabs').innerHTML = T.map(([id, ic, lb]) =>
      `<button data-tab="${id}" class="${tab === id ? 'on' : ''}"><span>${ic}</span>${lb}${id === 'news' && unread() ? `<i class="badge">${unread()}</i>` : ''}</button>`).join('');
  }

  function viewPit() {
    const nw = E.netWorth(G);
    let html = '';
    if (G.over) return '<div class="empty">Game over.</div>';
    if (G.pos) {
      const c = E.CBY[G.pos.sym], u = E.unreal(G);
      html += `<div class="card" style="border-color:var(--amber)">📌 Holding <b>${G.pos.qty > 0 ? 'LONG' : 'SHORT'} ${Math.abs(G.pos.qty)} ${c.sym}</b> @ ${fp(c.sym, G.pos.entry)} overnight · open P&amp;L <b class="${cls(u)}">${sgn(u)}</b>
        <div class="dim" style="font-size:11px;margin-top:3px">You can only open the ${c.name} pit until you're flat. Gaps at the open can hurt.</div></div>`;
    }
    if (G.tips.length) html += '<h2>📞 Morning tips</h2>' + G.tips.map((t) => `<div class="card tip-card" style="font-size:13px">${t.text}</div>`).join('');
    html += '<h2>Choose your pit</h2>';
    for (const c of E.CONTRACTS) {
      const locked = !G.unlocked[c.sym], blocked = G.pos && G.pos.sym !== c.sym;
      const closeT = G.mk[c.sym].close;
      html += `<div class="card item row ${selSym === c.sym && !locked && !blocked ? 'cur' : ''}" data-pit="${c.sym}" style="${locked || blocked ? 'opacity:.5' : ''}">
        <div class="emoji">${c.emoji}</div>
        <div class="grow"><div class="title">${c.name} <span class="tag">${c.sym}</span></div>
          <div class="desc">${c.pit}</div>
          <div class="meta">${locked ? `🔒 Unlocks at ${big(c.unlock)} net worth` : `Last ${fp(c.sym, closeT)} · ${money(c.tickVal, 2)}/tick · ${money(c.margin)} margin/lot`}</div></div>
        ${locked || blocked ? '' : `<span class="tag">max ${E.maxLots(G, c.sym)} lots</span>`}</div>`;
    }
    html += `<h2>Between sessions</h2><div class="chips"><button data-skip="1">Skip day</button><button data-skip="5">Skip week</button><button data-skip="21">Skip month</button></div>
      <div class="dim" style="font-size:11px;margin-top:6px">Skipping lets the market move without you (positions are marked to market daily; margin calls still apply). Bills still come due.</div>`;
    html += `<div class="card" style="margin-top:12px;font-size:12px;color:var(--dim)"><b>How the pit works:</b> watch the shouting — more big BUY shouts than SELLs means the crowd is leaning up. Hit <b>BUY</b> to lift the offer or <b>SELL</b> to hit the bid. You pay the 1-tick spread plus a clearing fee, so you need the crowd to move price for you. Use a stop. Size small until you've earned it.</div>`;
    return html;
  }

  function viewLedger() {
    const s = G.stats, nw = E.netWorth(G), lvl = E.marginLevel(G);
    const wr = s.wins + s.losses ? Math.round(100 * s.wins / (s.wins + s.losses)) + '%' : '—';
    let html = `<div class="stats">
      <div class="stat"><small>Net worth</small><b>${big(nw)}</b></div>
      <div class="stat"><small>Peak</small><b>${big(s.peak)}</b></div>
      <div class="stat"><small>Realized P/L</small><b class="${cls(s.realized)}">${big(s.realized)}</b></div>
      <div class="stat"><small>Fees paid</small><b>${money(s.fees)}</b></div>
      <div class="stat"><small>Sessions · trades</small><b>${s.sessions} · ${s.trades}</b></div>
      <div class="stat"><small>Win rate</small><b>${wr}</b></div>
      <div class="stat"><small>Best / worst session</small><b><span class="up">${sgn(s.bestDay)}</span> / <span class="down">${sgn(s.worstDay)}</span></b></div>
      <div class="stat"><small>Win streak</small><b>${s.streak}</b></div>
      <div class="stat"><small>Gains this year</small><b class="${cls(G.ytd)}">${big(G.ytd)}</b></div>
      <div class="stat"><small>Tax due (Apr)</small><b>${G.taxDue > 0 ? money(G.taxDue) : money(Math.max(0, G.ytd) * E.TAX_RATE) + ' est.'}</b></div></div>`;
    if (G.pos) html += `<div class="card" style="margin-top:8px;font-size:13px">📌 ${G.pos.qty > 0 ? 'Long' : 'Short'} ${Math.abs(G.pos.qty)} ${G.pos.sym} · margin level <b class="${lvl < 1.3 ? 'down' : ''}">${(lvl * 100).toFixed(0)}%</b> (liquidated below 75%)</div>`;
    if (G.heat) html += `<div class="card" style="margin-top:6px;font-size:12px">🕵️ Compliance heat: <b>${'🔥'.repeat(G.heat)}</b>${G.fined ? ' · <span class="down">Already fined — next time is prison</span>' : ''}</div>`;
    if (G.lastSession) {
      const l = G.lastSession;
      html += `<h2>Last session</h2><div class="card">${E.CBY[l.sym].emoji} ${l.sym} · <b class="${cls(l.pnl)}">${sgn(l.pnl)}</b> · ${l.trades} trades, ${l.wins} winners</div>`;
    }
    html += `<h2>Net worth history</h2><div class="card">${lineChart(G.nwHist.slice(-260))}</div>`;
    return html;
  }

  function lifeCard(cat, it, state) {
    let btn = '', meta = '';
    if (cat === 'home') {
      meta = `Rent ${money(it.rent)}/mo`;
      if (state === 'cur') btn = '<span class="tag">LIVING HERE</span>';
      else btn = `<button class="${it.id > G.home ? 'primary' : ''}" data-buy="home:${it.id}">${it.id > G.home ? 'Move in<br><small>' + money(it.rent * 2) + ' deposit</small>' : 'Downsize'}</button>`;
    } else if (cat === 'lux') {
      meta = `${money(it.price)}${it.upkeep ? ' · ' + money(it.upkeep) + '/mo upkeep' : ''}`;
      btn = G.lux.includes(it.id) ? `<button data-sell="lux:${it.id}">Sell<br><small>${money(it.price * E.SELL_RATIO)}</small></button>` : `<button class="primary" data-buy="lux:${it.id}">Buy</button>`;
    } else {
      const list = cat === 'car' ? E.CARS : E.TECH;
      meta = `${it.price ? money(it.price) : 'Free'}${it.upkeep ? ' · ' + money(it.upkeep) + '/mo' : ''}`;
      if (state === 'cur') btn = it.price ? `<button data-sell="${cat}:0">Sell<br><small>${money(it.price * E.SELL_RATIO)}</small></button>` : '<span class="tag">CURRENT</span>';
      else if (it.id > G[cat]) btn = `<button class="primary" data-buy="${cat}:${it.id}">Upgrade<br><small>${money(it.price - E.SELL_RATIO * list[G[cat]].price)}</small></button>`;
    }
    const owned = state === 'cur' || (cat === 'lux' && G.lux.includes(it.id));
    return `<div class="card item row ${owned ? 'cur' : ''}"><div class="emoji">${it.emoji}</div>
      <div class="grow"><div class="title">${it.name}</div><div class="desc">${it.desc}</div><div class="meta">${meta}</div></div>${btn}</div>`;
  }
  function viewLife() {
    const costs = E.monthlyCosts(G), inc = E.monthlyIncome(G);
    let html = `<div class="card" style="font-size:13px">Monthly: <b class="mono">${money(costs)}</b> costs${inc ? ` − <b class="mono up">${money(inc)}</b> diner job (quit when you move up)` : ''} (incl. ${money(E.livingCost(G))} living).
      <div class="dim" style="font-size:11px;margin-top:4px">Bills come out of your trading account. Can't pay? The repo man takes your stuff — then your home.</div></div>`;
    html += '<h2>🏠 Home</h2>' + E.HOMES.map((h) => lifeCard('home', h, h.id === G.home ? 'cur' : 'buy')).join('');
    html += '<h2>🚗 Wheels</h2>' + E.CARS.map((c) => lifeCard('car', c, c.id === G.car ? 'cur' : 'buy')).join('');
    html += '<h2>📟 Floor gear</h2>' + E.TECH.map((c) => lifeCard('tech', c, c.id === G.tech ? 'cur' : 'buy')).join('');
    html += '<h2>💎 Status symbols</h2>' + E.LUX.map((c) => lifeCard('lux', c, 'buy')).join('');
    return html;
  }
  function viewNews() {
    seen = G.seq || 0; renderTabs();
    return '<h2>The wire</h2>' + G.news.map((n) =>
      `<div class="news">${n.tag === 'life' ? '<span class="tag">LIFE</span>' : n.tag === 'mkt' ? '<span class="tag tip">PIT</span>' : ''}${n.text}<small>${dateStr(n.day)}</small></div>`).join('');
  }
  function viewTrophies() {
    const have = E.ACH.filter((a) => trophies[a.id] || G.ach[a.id]).length;
    return `<h2>Achievements · ${have}/${E.ACH.length}</h2>` + E.ACH.map((a) => {
      const got = trophies[a.id] || G.ach[a.id];
      return `<div class="card item row ${got ? 'cur' : ''}" style="${got ? '' : 'opacity:.5'}"><div class="emoji">${got ? a.emoji : '🔒'}</div>
        <div class="grow"><div class="title">${a.name}</div><div class="desc">${a.desc}</div></div></div>`;
    }).join('');
  }

  // ---------- modal
  function showModal(o) {
    return new Promise((res) => {
      const btns = (o.buttons || [['OK', 'primary']]).map((b, i) => `<button class="${b[1] || ''}" data-mb="${i}">${b[0]}</button>`).join('');
      $('modalCard').className = 'modal-card ' + (o.kind || '');
      $('modalCard').innerHTML = `<h3>${o.title}</h3>${o.body}<div class="btns">${btns}</div>`;
      $('modal').classList.remove('hidden');
      $('modalCard').onclick = (e) => {
        const b = e.target.closest('[data-mb]'); if (!b) return;
        $('modal').classList.add('hidden'); res(+b.dataset.mb);
      };
    });
  }

  // ---------- event processing (after a session closes or days are skipped)
  const MODAL = {
    repo: ['🚨 Repo Man!', 'bad', 'alarm'], margin: ['📞 MARGIN CALL', 'bad', 'alarm'], insider: ['🤫 Front-running', '', 'sneaky'],
    warn: ['👀 Uh-oh…', 'bad', 'sneaky'], sec: ['⚖️ CFTC SETTLEMENT', 'bad', 'alarm'], unlock: ['🔓 New pit unlocked', 'good', 'ach'],
  };
  async function processEvents(evs) {
    noteAch(evs.filter((e) => e.kind === 'ach').map((e) => e.ach));
    for (const e of evs) {
      if (e.kind === 'close') {
        const s = e.summary, c = E.CBY[s.sym];
        sfx(s.pnl >= 0 ? 'win' : 'lose');
        await showModal({
          kind: s.pnl >= 0 ? 'good' : 'bad', title: '🔔 Closing bell',
          body: `<p class="mono" style="font-size:30px;margin:4px 0;color:var(--${s.pnl >= 0 ? 'up' : 'down'})">${sgn(s.pnl)}</p>
            <p>${c.name} · ${s.trades} trades · ${s.wins} winners</p>${s.overnight ? '<p class="dim">You\'re holding a position overnight.</p>' : ''}`,
        });
      } else if (MODAL[e.kind]) {
        const m = MODAL[e.kind]; sfx(m[2]);
        await showModal({ kind: m[1], title: m[0], body: `<p>${e.text}</p>` });
      }
    }
  }
  async function afterEvents(evs) {
    save(); render();
    await processEvents(evs);
    busy = false;
    if (G.over) endScreen();
  }

  async function skip(n) {
    if (busy || G.over || G.sess) return;
    busy = true; sfx('week');
    const evs = E.skipDays(G, n);
    await afterEvents(evs);
  }

  async function endScreen() {
    const nw = E.netWorth(G), s = G.stats;
    clearSave();
    const stats = `<p class="mono dim" style="font-size:12px">Peak ${big(s.peak)} · ${s.sessions} sessions · ${s.trades} trades<br>Best session ${sgn(s.bestDay)} · fees paid ${money(s.fees)}</p>`;
    if (G.over === 'homeless') {
      sfx('lose');
      await showModal({ kind: 'bad', title: '🥫 HOMELESS',
        body: `<p>${dateStr(G.day)}. The clearing firm took the account, the landlord changed the locks.</p><p>You're sleeping on a bench in Grant Park with a copy of the Tribune for a blanket. Your trading jacket is the only thing they let you keep.</p>${stats}`,
        buttons: [['Start over', 'primary']] });
    } else if (G.over === 'prison') {
      sfx('lose');
      await showModal({ kind: 'bad', title: '⛓️ FEDERAL PRISON',
        body: `<p>${dateStr(G.day)}. Trading ahead of customers twice was one time too many. The feds took you away in cuffs.</p><p>You'll be trading cigarettes at Club Fed for the next few years.</p>${stats}`,
        buttons: [['Start over', 'primary']] });
    } else {
      sfx('win');
      await showModal({ kind: 'good', title: '🎆 THE DECADE ENDS',
        body: `<p>December 2000. You finished as a</p><p style="font-size:22px;color:var(--amber);font-weight:800">${E.rankOf(nw)}</p><p>Final net worth <b class="mono">${big(nw)}</b></p>${stats}`,
        buttons: [['Play again', 'primary']] });
    }
    newGame();
  }

  // =====================================================================  LIVE PIT
  const QTY = [1, 2, 5, 10, 'MAX'];
  const STOPS = [0, 8, 15, 30];
  const cvs = () => $('pChart');

  function openBell() {
    if (busy || G.over || G.sess) return;
    const c = E.CBY[selSym];
    if (!G.unlocked[selSym] || (G.pos && G.pos.sym !== selSym)) { toast(G.pos && G.pos.sym !== selSym ? `You're holding ${G.pos.sym}. Trade that pit.` : 'That pit is locked.'); sfx('error'); return; }
    const r = E.startSession(G, selSym);
    if (!r.ok) { toast(r.msg); sfx('error'); return; }
    sfx('bell'); buzz(40);
    enterLive(false);
  }

  function enterLive(resumePaused) {
    live = { timer: null, speed: 1, paused: false, qty: 1, stopIdx: 0, lastSave: 0, bannerTimer: null, modalOpen: false, lastShout: -1 };
    if (G.sess.stop) live.stopIdx = Math.max(0, STOPS.indexOf(G.sess.stop));
    $('pit').classList.remove('hidden');
    $('pName').textContent = `${E.CBY[G.sess.sym].emoji} ${E.CBY[G.sess.sym].name}`;
    buildQty(); sizeCanvas(); updateLive();
    save();
    if (resumePaused) setPaused(true); else startTimer();
  }
  function startTimer() { stopTimer(); live.timer = setInterval(tick, E.STEP_MS / live.speed); }
  function stopTimer() { if (live && live.timer) { clearInterval(live.timer); live.timer = null; } }
  function setPaused(p) {
    live.paused = p; $('pPaused').classList.toggle('hidden', !p);
    $('pPause').textContent = p ? '▶' : '⏸';
    if (p) { stopTimer(); save(); } else startTimer();
    updateLive();
  }

  function buildQty() {
    $('pQty').innerHTML = QTY.map((q) => `<button data-lq="${q}" class="${live.qty === q ? 'on' : ''}">${q}</button>`).join('');
  }
  function curQty() {
    const S = G.sess; if (!S) return 1;
    return live.qty === 'MAX' ? Math.max(1, E.maxLots(G, S.sym)) : live.qty;
  }

  async function tick() {
    if (!G.sess || live.modalOpen) return;
    const S = G.sess, prevShoutT = S.t;
    const evs = E.stepSession(G);
    handleLiveEvents(evs);
    if (G.sess && !G.sess.done) {
      const sh = E.shoutsNow(G, 1)[0];
      if (sh && sh[0] === S.t && sh[0] !== live.lastShout) { live.lastShout = sh[0]; if (sh[2] >= 50) sfx('shout'); }
      updateLive();
      const now = Date.now(); if (now - live.lastSave > 4000) { live.lastSave = now; save(); }
    }
  }

  async function handleLiveEvents(evs) {
    const closeEv = evs.find((e) => e.kind === 'close');
    for (const e of evs) {
      if (e.kind === 'headline') { banner(e.text, e.jump > 0 ? 'up' : 'down'); sfx('news'); buzz(60); }
      else if (e.kind === 'margin') { banner(e.text, 'down'); sfx('alarm'); buzz([120, 60, 120]); }
      else if (e.kind === 'stop') { toast(e.text); sfx('sell'); buzz(40); }
      else if (e.kind === 'insider') { toast(e.text); }
      else if (e.kind === 'offer') await offerFlow(e);
    }
    if (closeEv || G.over || !G.sess) await leaveLive(evs);
  }

  async function offerFlow(e) {
    live.modalOpen = true; stopTimer(); sfx('sneaky');
    const o = G.sess.offer;
    const i = await showModal({
      title: '📞 Paper in the pit!',
      body: `<p>${e.text}</p><p class="dim" style="font-size:12px">Trading ahead of a customer is illegal. If you profit, compliance might notice: first time is a big fine, second is <b>prison</b>. You have about 4 seconds before the order hits.</p>`,
      buttons: [[`Fill it fairly (+${money(o.bonus)})`, ''], ['Trade ahead 🤫', 'primary']],
    });
    const r = E.respondOffer(G, i === 1 ? 'ahead' : 'honest');
    toast(r.msg);
    live.modalOpen = false;
    if (!live.paused) startTimer();
  }

  async function leaveLive(evs) {
    stopTimer(); live.modalOpen = true;
    $('pit').classList.add('hidden'); live = null;
    busy = true;
    await afterEvents(evs.filter((e) => !['headline', 'stop', 'offer'].includes(e.kind)));
  }

  function banner(text, kind) {
    const b = $('pBanner'); b.textContent = text; b.className = 'banner ' + kind;
    clearTimeout(live.bannerTimer); live.bannerTimer = setTimeout(() => b.classList.add('hidden'), 6000);
  }

  function sizeCanvas() {
    const c = cvs(), r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, r.width * dpr); c.height = Math.max(1, r.height * dpr);
  }

  function updateLive() {
    const S = G.sess; if (!S) return;
    const sym = S.sym, c = E.CBY[sym], t = S.t, mid = S.path[t], bid = E.bidT(S, t), ask = bid + 1;
    const open = S.path[0], chg = (mid - open) / open;
    $('pClock').textContent = E.clockOf(t) + ' CT';
    $('pProg').style.width = (t / S.n * 100) + '%';
    $('pLast').textContent = fp(sym, Math.round(mid));
    $('pChg').textContent = pct(chg); $('pChg').className = 'mono ' + (chg >= 0 ? 'up' : 'down');
    $('pBA').textContent = `${fp(sym, bid)} × ${fp(sym, ask)}`;
    $('pBuy').innerHTML = `BUY <small>${fp(sym, ask)}</small>`;
    $('pSell').innerHTML = `SELL <small>${fp(sym, bid)}</small>`;
    // shouts
    const sh = E.shoutsNow(G, 6);
    $('pShouts').innerHTML = sh.map((s) => `<div class="sh ${s[1] > 0 ? 'b' : 's'} ${s[2] >= 50 ? 'bigsh' : ''}">${s[1] > 0 ? 'BUY' : 'SELL'} ${s[2]}${s[2] >= 50 ? ' 🔥' : ''}</div>`).join('') || '<div class="sh dim">…quiet…</div>';
    // position
    const p = G.pos, u = E.unreal(G), dayPnl = E.equity(G) - S.startEq;
    $('pPos').innerHTML = `<div>${p ? `<b class="${p.qty > 0 ? 'up' : 'down'}">${p.qty > 0 ? 'LONG' : 'SHORT'} ${Math.abs(p.qty)}</b> @ ${fp(sym, p.entry)}` : '<span class="dim">Flat</span>'}</div>
      <div>Open <b class="${cls(u)}">${sgn(u)}</b></div><div>Session <b class="${cls(dayPnl)}">${sgn(dayPnl)}</b></div>
      <div class="dim">Max ${E.maxLots(G, sym)} lots</div>`;
    $('pStop').textContent = 'Stop: ' + (STOPS[live.stopIdx] ? STOPS[live.stopIdx] + ' ticks' : 'Off');
    $('pFlat').disabled = !p || live.paused;
    $('pFF').disabled = !!p || live.paused || !!(S.offer && !S.offer.resolved);
    $('pBuy').disabled = $('pSell').disabled = live.paused;
    drawChart();
  }

  function drawChart() {
    const S = G.sess, c = cvs(), ctx = c.getContext('2d'), W = c.width, H = c.height, dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, W, H);
    const pts = S.path.slice(0, S.t + 1);
    let lo = Math.min(...pts), hi = Math.max(...pts);
    if (G.pos && G.pos.sym === S.sym) { lo = Math.min(lo, G.pos.entry); hi = Math.max(hi, G.pos.entry); }
    const pad = Math.max(3, (hi - lo) * 0.15); lo -= pad; hi += pad;
    const X = (i) => (i / S.n) * W, Y = (v) => H - ((v - lo) / (hi - lo)) * H;
    ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
    for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(0, H * k / 4); ctx.lineTo(W, H * k / 4); ctx.stroke(); }
    const up = pts[pts.length - 1] >= pts[0], col = up ? '#2dff7a' : '#ff4d5e';
    ctx.lineWidth = 2 * dpr; ctx.strokeStyle = col; ctx.beginPath();
    pts.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.stroke();
    ctx.lineTo(X(pts.length - 1), H); ctx.lineTo(0, H); ctx.fillStyle = up ? 'rgba(45,255,122,.08)' : 'rgba(255,77,94,.08)'; ctx.fill();
    ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.lineWidth = 1.5 * dpr;
    if (G.pos && G.pos.sym === S.sym) {
      ctx.strokeStyle = '#ffb800'; ctx.beginPath(); ctx.moveTo(0, Y(G.pos.entry)); ctx.lineTo(W, Y(G.pos.entry)); ctx.stroke();
      if (S.stop) { const sv = G.pos.entry - Math.sign(G.pos.qty) * S.stop; ctx.strokeStyle = '#ff4d5e'; ctx.beginPath(); ctx.moveTo(0, Y(sv)); ctx.lineTo(W, Y(sv)); ctx.stroke(); }
    }
    ctx.setLineDash([]);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(pts.length - 1), Y(pts[pts.length - 1]), 4 * dpr, 0, 7); ctx.fill();
  }

  function doTrade(side) {
    if (!G.sess || !live || live.paused || live.modalOpen) return;
    const r = E.trade(G, side, curQty());
    if (!r.ok) { toast(r.msg); sfx('error'); return; }
    sfx('fill'); buzz(15); updateLive();
  }

  async function skipToClose() {
    if (!G.sess || G.pos) return;
    stopTimer();
    let evs = [];
    while (G.sess && !G.sess.done) {
      const out = E.stepSession(G);
      for (const e of out) { if (e.kind === 'offer') E.respondOffer(G, 'ignored'); }
      evs = evs.concat(out);
    }
    sfx('bell');
    handleLiveEvents(evs.filter((e) => e.kind !== 'offer').concat([]));
  }

  // ---------- game flow
  function newGame() {
    G = E.newGame(); tab = 'pit'; selSym = 'SOY'; seen = G.seq || 0; busy = false; live = null; save();
    $('title').classList.add('hidden'); $('pit').classList.add('hidden'); $('app').classList.remove('hidden'); render();
  }
  function cont() {
    const s = load(); if (!s) return newGame();
    G = s; seen = G.seq || 0; busy = false; live = null;
    selSym = G.pos ? G.pos.sym : 'SOY';
    $('title').classList.add('hidden'); $('app').classList.remove('hidden'); render();
    if (G.sess) enterLive(true);
  }

  // ---------- events
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button,[data-pit]'); if (!t) return;
    if (t.dataset.mute) { window.Sfx.toggle(); if (G) render(); return; }
    if (t.dataset.tab) { sfx('tap'); tab = t.dataset.tab; $('view').scrollTop = 0; render(); return; }
    if (t.dataset.pit && !t.matches('button')) {
      const c = E.CBY[t.dataset.pit];
      if (!G.unlocked[c.sym]) { toast(`Unlocks at ${big(c.unlock)} net worth.`); sfx('error'); return; }
      if (G.pos && G.pos.sym !== c.sym) { toast(`You're holding ${G.pos.sym}. Trade that pit.`); sfx('error'); return; }
      selSym = c.sym; sfx('tap'); render(); return;
    }
    if (t.dataset.skip) return skip(+t.dataset.skip);
    if (t.dataset.buy || t.dataset.sell) {
      const [cat, id] = (t.dataset.buy || t.dataset.sell).split(':');
      const key = cat === 'lux' ? id : +id;
      const r = t.dataset.buy ? E.buyItem(G, cat, key) : E.sellItem(G, cat, key);
      toast(r.msg); sfx(r.ok ? 'buy' : 'error'); if (r.ok) { buzz(20); noteAch(E.checkAchievements(G)); save(); } render(); return;
    }
    if (t.dataset.lq) { live.qty = t.dataset.lq === 'MAX' ? 'MAX' : +t.dataset.lq; buildQty(); sfx('tap'); return; }
  });
  // trading buttons react on press for speed
  const press = (id, fn) => $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
  press('pBuy', () => doTrade(1));
  press('pSell', () => doTrade(-1));
  press('pFlat', () => { if (G.sess && live && !live.paused && G.pos) { const r = E.flatten(G); if (r.ok) { sfx('fill'); buzz(15); } updateLive(); } });
  $('pStop').addEventListener('click', () => { live.stopIdx = (live.stopIdx + 1) % STOPS.length; E.setStop(G, STOPS[live.stopIdx]); sfx('tap'); updateLive(); });
  $('pFF').addEventListener('click', skipToClose);
  $('pPause').addEventListener('click', () => setPaused(!live.paused));
  $('pResume').addEventListener('click', () => setPaused(false));
  $('pLeave').addEventListener('click', () => { stopTimer(); save(); $('pit').classList.add('hidden'); live = null; $('app').classList.add('hidden'); $('title').classList.remove('hidden'); $('btnContinue').classList.remove('hidden'); });
  $('pSpeed').addEventListener('click', () => { live.speed = live.speed === 1 ? 2 : 1; $('pSpeed').textContent = live.speed + '×'; if (!live.paused && !live.modalOpen) startTimer(); });
  $('btnBell').addEventListener('click', openBell);
  $('btnNew').addEventListener('click', newGame);
  $('btnContinue').addEventListener('click', cont);
  window.addEventListener('resize', () => { if (live) { sizeCanvas(); updateLive(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && live && !live.paused && !live.modalOpen) setPaused(true); });

  if (load()) $('btnContinue').classList.remove('hidden');
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
