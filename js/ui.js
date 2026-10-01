/* Wall Street '90 — UI */
(() => {
  'use strict';
  const E = window.Engine;
  const $ = (id) => document.getElementById(id);
  const SAVE_KEY = 'ws90_save_v1';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let G = null, tab = 'market', sheetT = null, qty = 1, seen = 0, toastTimer = null;
  const unread = () => Math.min(99, (G.seq || 0) - seen);

  // ---------- trophies (persist across games)
  const TROPHY_KEY = 'ws90_trophies_v1';
  let trophies = {};
  try { trophies = JSON.parse(localStorage.getItem(TROPHY_KEY)) || {}; } catch (e) {}
  const sfx = (n) => window.Sfx && window.Sfx.play(n);
  function noteAch(list) {
    for (const a of list) {
      if (!trophies[a.id]) trophies[a.id] = Date.now();
      toast('🏆 ' + a.name); sfx('ach');
    }
    if (list.length) try { localStorage.setItem(TROPHY_KEY, JSON.stringify(trophies)); } catch (e) {}
  }

  // ---------- helpers
  const money = (n, d = 0) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const big = (n) => Math.abs(n) >= 1e6 ? (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1e6).toFixed(2) + 'M' : money(n);
  const px = (p) => '$' + p.toFixed(p < 10 ? 2 : 2);
  const pct = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
  const dateStr = (w) => { const d = E.dateOf(w); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
  const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : 'dim');
  const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) {} }
  function load() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); return s && s.v === E.SAVE_VERSION ? s : null; } catch (e) { return null; } }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

  function chartSvg(arr, h = 110, w = 320, fill = true) {
    if (arr.length < 2) return `<svg class="chart" viewBox="0 0 ${w} ${h}"></svg>`;
    const min = Math.min(...arr), max = Math.max(...arr), span = max - min || 1;
    const pts = arr.map((v, i) => [(i / (arr.length - 1)) * w, h - 6 - ((v - min) / span) * (h - 12)]);
    const line = pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const col = arr[arr.length - 1] >= arr[0] ? '#2dff7a' : '#ff4d5e';
    const area = fill ? `<polygon points="0,${h} ${line} ${w},${h}" fill="${col}" opacity=".12"/>` : '';
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${area}<polyline points="${line}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  }
  function spark(arr) {
    const a = arr.slice(-26); if (a.length < 2) return '<svg width="64" height="26"></svg>';
    const min = Math.min(...a), max = Math.max(...a), span = max - min || 1;
    const pts = a.map((v, i) => `${(i / (a.length - 1)) * 64},${24 - ((v - min) / span) * 22}`).join(' ');
    const col = a[a.length - 1] >= a[0] ? '#2dff7a' : '#ff4d5e';
    return `<svg width="64" height="26" viewBox="0 0 64 26"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6"/></svg>`;
  }

  // ---------- rendering
  function render() {
    renderTop();
    const v = $('view'), scroll = v.scrollTop;
    v.innerHTML = { market: viewMarket, port: viewPort, life: viewLife, news: viewNews, trophy: viewTrophies }[tab]();
    v.scrollTop = scroll;
    renderTabs();
    if (sheetT) renderSheet();
    const dead = !!G.over;
    $('btnWeek').disabled = dead; $('btnMonth').disabled = dead;
  }

  function renderTop() {
    const nw = E.netWorth(G), prev = G.nwHist.length > 1 ? G.nwHist[G.nwHist.length - 2] : nw;
    const d = nw - prev;
    const bills = E.monthlyCosts(G), inc = E.monthlyIncome(G);
    $('top').innerHTML = `
      <div class="top-row"><span class="date">📅 ${dateStr(G.week)}</span><span><span class="rank">${E.rankOf(nw)}</span> <button class="mute" data-mute="1" aria-label="Toggle sound">${window.Sfx && window.Sfx.muted ? '🔇' : '🔊'}</button></span></div>
      <div class="nw ${nw < E.START_CASH * .5 ? 'down' : ''}">${big(nw)} <small class="${cls(d)}" style="font-size:12px">${d ? pct(d / Math.max(prev, 1)) : ''}</small></div>
      <div class="sub">${G.cash < 0 ? `<span class="down">Margin debt <b>${money(-G.cash)}</b></span>` : `<span>Cash <b>${money(G.cash)}</b></span>`}<span>Stocks <b>${big(E.stockValue(G))}</b></span>${Object.keys(G.shorts).length ? `<span>Short <b>${big(E.shortValue(G))}</b></span>` : ''}<span>Bills <b>${money(bills - inc)}/mo</b></span></div>`;
    const heads = G.news.filter((n) => n.tag !== 'tip').slice(0, 5).map((n) => n.text).join('   ◆   ');
    if ($('tapeText').dataset.t !== heads) { $('tapeText').textContent = heads; $('tapeText').dataset.t = heads; }
  }

  function renderTabs() {
    const T = [['market', '📈', 'Market'], ['port', '💼', 'Portfolio'], ['life', '🏠', 'Lifestyle'], ['news', '📰', 'News'], ['trophy', '🏆', 'Trophies']];
    $('tabs').innerHTML = T.map(([id, ic, lb]) =>
      `<button data-tab="${id}" class="${tab === id ? 'on' : ''}"><span>${ic}</span>${lb}${id === 'news' && unread() ? `<i class="badge">${unread()}</i>` : ''}</button>`).join('');
  }

  function viewMarket() {
    let html = '';
    if (G.offer) html += '<div class="card offer-card row tap" data-offer="1"><div class="grow" style="font-size:13px">📞 <b>Insider offer waiting</b> — an "old friend" has a hot tip. Tap to answer.</div><span>›</span></div>';
    if (G.tips.length) {
      html += '<h2>📞 This week\'s tips</h2>' + G.tips.map((t) => `<div class="card tip-card row tap" data-stock="${t.t}"><div class="grow" style="font-size:13px">${t.text}</div><span class="dim">›</span></div>`).join('');
    } else if (E.TECH[G.tech].tips === 0) {
      html += '<div class="card dim" style="font-size:12px">💡 Upgrade your gear in <b>Lifestyle</b> for cheaper commissions and weekly stock tips.</div>';
    }
    html += `<h2>Stocks · commission ${money(E.commission(G))}/trade</h2>`;
    for (const s of E.STOCKS) {
      const st = G.stocks[s.t];
      if (!st.active) continue;
      const ch = st.price / st.prev - 1, own = G.holdings[s.t];
      html += `<div class="card row tap" data-stock="${s.t}">
        <div class="grow"><div class="tick">${s.t}${own ? '<span class="tag">own ' + own.shares + '</span>' : ''}</div><div class="nm">${s.name}</div></div>
        ${spark(G.hist[s.t])}
        <div class="px"><div class="p">${px(st.price)}</div><div class="c ${cls(ch)}">${pct(ch)}</div></div></div>`;
    }
    return html;
  }

  function viewPort() {
    const nw = E.netWorth(G), s = G.stats;
    let html = `<div class="stats">
      <div class="stat"><small>Net worth</small><b>${big(nw)}</b></div>
      <div class="stat"><small>Peak</small><b>${big(s.peak)}</b></div>
      <div class="stat"><small>Realized P/L</small><b class="${cls(s.realized)}">${big(s.realized)}</b></div>
      <div class="stat"><small>Trades · fees</small><b>${s.trades} · ${money(s.fees)}</b></div></div>`;
    const lvl = E.marginLevel(G), bp = Math.max(0, 2 * E.equity(G) - E.gross(G));
    html += `<div class="stats" style="margin-top:6px">
      <div class="stat"><small>Buying power (2x)</small><b>${big(bp)}</b></div>
      <div class="stat"><small>Margin level (call @ 25%)</small><b class="${lvl < .4 ? 'down' : ''}">${lvl === Infinity ? '—' : (lvl * 100).toFixed(0) + '%'}</b></div>
      <div class="stat"><small>Gains this year</small><b class="${cls(G.ytd)}">${big(G.ytd)}</b></div>
      <div class="stat"><small>Tax due (Apr)</small><b>${G.taxDue > 0 ? money(G.taxDue) : money(Math.max(0, G.ytd) * E.TAX_RATE) + ' est.'}</b></div></div>`;
    if (G.heat) html += `<div class="card" style="margin-top:6px;font-size:12px">🕵️ SEC heat: <b>${'🔥'.repeat(G.heat)}</b>${G.fined ? ' · <span class="down">Already fined — next time is prison</span>' : ''}</div>`;
    html += `<h2>Net worth history</h2><div class="card">${chartSvg(G.nwHist.slice(-156))}</div>`;
    html += '<h2>Positions</h2>';
    const ts = Object.keys(G.holdings);
    if (!ts.length) html += '<div class="empty">No positions yet. Hit the Market tab and make something happen.</div>';
    for (const t of ts) {
      const h = G.holdings[t], st = G.stocks[t], pl = (st.price - h.cost) * h.shares, plp = st.price / h.cost - 1;
      html += `<div class="card row tap" data-stock="${t}">
        <div class="grow"><div class="tick">${t}</div><div class="nm">${h.shares} sh @ ${px(h.cost)}</div></div>
        <div class="px"><div class="p">${money(h.shares * st.price)}</div><div class="c ${cls(pl)}">${money(pl)} (${pct(plp)})</div></div></div>`;
    }
    const ss = Object.keys(G.shorts);
    if (ss.length) html += '<h2>Short positions</h2>';
    for (const t of ss) {
      const h = G.shorts[t], st = G.stocks[t], pl = (h.entry - st.price) * h.shares, plp = h.entry / st.price - 1;
      html += `<div class="card row tap" data-stock="${t}">
        <div class="grow"><div class="tick">${t}<span class="tag">SHORT</span></div><div class="nm">${h.shares} sh @ ${px(h.entry)}</div></div>
        <div class="px"><div class="p">${money(h.shares * st.price)}</div><div class="c ${cls(pl)}">${money(pl)} (${pct(plp)})</div></div></div>`;
    }
    return html;
  }

  function lifeCard(cat, it, state) {
    // state: 'cur' | 'buy' | 'locked'
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
      <div class="dim" style="font-size:11px;margin-top:4px">Miss a payment and the repo man takes your stuff — then your home.</div></div>`;
    html += '<h2>🏠 Home</h2>' + E.HOMES.map((h) => lifeCard('home', h, h.id === G.home ? 'cur' : 'buy')).join('');
    html += '<h2>🚗 Wheels</h2>' + E.CARS.map((c) => lifeCard('car', c, c.id === G.car ? 'cur' : 'buy')).join('');
    html += '<h2>💻 Trading gear</h2>' + E.TECH.map((c) => lifeCard('tech', c, c.id === G.tech ? 'cur' : 'buy')).join('');
    html += '<h2>💎 Status symbols</h2>' + E.LUX.map((c) => lifeCard('lux', c, 'buy')).join('');
    return html;
  }

  function viewTrophies() {
    const have = E.ACH.filter((a) => trophies[a.id] || G.ach[a.id]).length;
    return `<h2>Achievements · ${have}/${E.ACH.length}</h2>` + E.ACH.map((a) => {
      const got = trophies[a.id] || G.ach[a.id];
      return `<div class="card item row ${got ? 'cur' : ''}" style="${got ? '' : 'opacity:.5'}"><div class="emoji">${got ? a.emoji : '🔒'}</div>
        <div class="grow"><div class="title">${a.name}</div><div class="desc">${a.desc}</div></div></div>`;
    }).join('');
  }

  function viewNews() {
    seen = G.seq || 0; renderTabs();
    return '<h2>Headlines</h2>' + G.news.map((n) =>
      `<div class="news">${n.tag === 'tip' ? '<span class="tag tip">TIP</span>' : n.tag === 'life' ? '<span class="tag">LIFE</span>' : ''}${n.text}<small>${dateStr(n.week)}</small></div>`).join('');
  }

  // ---------- trade sheet
  function openSheet(t) { sheetT = t; qty = 1; $('sheet').classList.remove('hidden'); renderSheet(); }
  function closeSheet() { sheetT = null; $('sheet').classList.add('hidden'); }

  function renderSheet() {
    const s = E.STOCKS.find((x) => x.t === sheetT), st = G.stocks[sheetT], h = G.holdings[sheetT];
    if (!st.active) return closeSheet();
    const comm = E.commission(G), mb = E.maxBuy(G, sheetT), ms = E.maxShort(G, sheetT), ch = st.price / st.prev - 1;
    const sh = G.shorts[sheetT], bp = Math.max(0, 2 * E.equity(G) - E.gross(G));
    const hi = Math.max(...G.hist[sheetT]), lo = Math.min(...G.hist[sheetT]);
    const total = qty * st.price;
    const tip = G.tips.find((x) => x.t === sheetT);
    $('sheetCard').innerHTML = `
      <div class="row"><div class="grow"><div class="tick" style="font-size:22px">${sheetT}</div><div class="nm">${s.name}</div></div>
        <div class="px"><div class="p" style="font-size:22px">${px(st.price)}</div><div class="c ${cls(ch)}">${pct(ch)} wk</div></div></div>
      ${chartSvg(G.hist[sheetT])}
      <div class="sub" style="justify-content:space-between"><span>2yr low <b>${px(lo)}</b></span><span>2yr high <b>${px(hi)}</b></span></div>
      ${tip ? `<div class="card tip-card" style="margin-top:8px;font-size:13px">📞 ${tip.text}</div>` : ''}
      ${h ? `<div class="card" style="margin-top:8px;font-size:13px">You own <b>${h.shares}</b> @ ${px(h.cost)} · P/L <b class="${cls(st.price - h.cost)}">${money((st.price - h.cost) * h.shares)}</b></div>` : ''}
      ${sh ? `<div class="card" style="margin-top:8px;font-size:13px">You are <b class="down">SHORT ${sh.shares}</b> @ ${px(sh.entry)} · P/L <b class="${cls(sh.entry - st.price)}">${money((sh.entry - st.price) * sh.shares)}</b></div>` : ''}
      <div class="qty"><button data-q="-1">−</button><input id="qtyIn" type="number" inputmode="numeric" min="0" value="${qty}"><button data-q="1">+</button></div>
      <div class="chips"><button data-qs="1">1</button><button data-qs="10">10</button><button data-qs="100">100</button><button data-qs="max">Max</button>${h || sh ? '<button data-qs="all">All</button>' : ''}</div>
      <div class="dim mono" style="font-size:12px;margin-bottom:10px">${qty} × ${px(st.price)} = ${money(total, 2)} · commission ${money(comm)} · buying power ${money(bp)}</div>
      <div class="two"><button class="buy" data-trade="buy" ${qty < 1 || qty > mb ? 'disabled' : ''}>Buy</button>
        <button class="sell" data-trade="sell" ${!h || qty < 1 || qty > h.shares ? 'disabled' : ''}>Sell</button></div>
      <div class="two" style="margin-top:8px"><button class="short" data-trade="short" ${qty < 1 || qty > ms ? 'disabled' : ''}>Short 🐻</button>
        <button data-trade="cover" ${!sh || qty < 1 || qty > sh.shares ? 'disabled' : ''}>Cover</button></div>
      <button style="width:100%;margin-top:8px;background:none" data-close="1">Close</button>`;
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

  // ---------- game flow
  let busy = false;
  const STOP = ['repo', 'homeless', 'bust', 'end', 'margin', 'offer', 'sec', 'warn', 'prison', 'insider'];
  const MODAL = {
    news: ['📰 BREAKING NEWS', '', 'news'], repo: ['🚨 Repo Man!', 'bad', 'alarm'], bust: ['💥 Bankruptcy', 'bad', 'error'],
    margin: ['📞 MARGIN CALL', 'bad', 'alarm'], insider: ['🤫 Insider trade', '', 'sneaky'], warn: ['👀 Uh-oh…', 'bad', 'sneaky'],
    sec: ['⚖️ SEC SETTLEMENT', 'bad', 'alarm'],
  };

  async function offerModal() {
    const o = G.offer; if (!o) return;
    const i = await showModal({
      title: '📞 A "friend" calls…',
      body: `<p>${o.text}</p><p class="dim" style="font-size:12px">Insider trading is a federal crime. If you profit you might get caught: first time is a huge fine, second time is <b>prison</b>.</p>`,
      buttons: [['Walk away', ''], ['Take the tip', 'primary']],
    });
    if (!G.offer) return;
    if (i === 1) {
      const t = G.offer.t, r = E.acceptOffer(G); sfx('sneaky'); toast(r.msg); save(); render(); openSheet(t);
    } else { E.declineOffer(G); toast('You walked away. Clean hands.'); save(); render(); }
  }

  async function advance(n) {
    if (busy || G.over) return;
    busy = true; sfx('week');
    const evs = [];
    for (let i = 0; i < n && !G.over; i++) {
      const r = E.advanceWeek(G);
      evs.push(...r.events);
      if (r.events.some((e) => STOP.includes(e.kind) || (e.kind === 'news' && /!|CRASH|CRISIS/.test(e.text)))) break;
    }
    save(); render();
    noteAch(evs.filter((e) => e.kind === 'ach').map((e) => e.ach));
    if (evs.some((e) => e.kind !== 'ach')) buzz(30);
    for (const e of evs) {
      if (e.kind === 'homeless' || e.kind === 'end' || e.kind === 'prison' || e.kind === 'ach') continue;
      if (e.kind === 'offer') { sfx('sneaky'); await offerModal(); continue; }
      const m = MODAL[e.kind] || MODAL.news;
      sfx(m[2]);
      await showModal({ kind: m[1], title: m[0], body: `<p>${e.text}</p>` });
    }
    busy = false;
    if (G.over) endScreen();
  }

  async function endScreen() {
    const nw = E.netWorth(G), s = G.stats;
    clearSave();
    const stats = `<p class="mono dim" style="font-size:12px">Peak ${big(s.peak)} (${dateStr(s.peakWeek)})<br>${s.trades} trades · ${money(s.fees)} in fees</p>`;
    if (G.over === 'homeless') {
      sfx('lose');
      await showModal({
        kind: 'bad', title: '🥫 HOMELESS',
        body: `<p>${dateStr(G.week)}. The landlord changed the locks. The Porsche, the Rolex, the dream — all gone.</p><p>You're sleeping on a bench in Battery Park with a copy of the Journal for a blanket.</p>${stats}`,
        buttons: [['Start over', 'primary']],
      });
    } else if (G.over === 'prison') {
      sfx('lose');
      await showModal({
        kind: 'bad', title: '⛓️ FEDERAL PRISON',
        body: `<p>${dateStr(G.week)}. Two strikes with the SEC and the feds came for you. The Armani suit is now an orange jumpsuit.</p><p>You'll be trading cigarettes at Club Fed for the next few years. At least the stock tips are better in here.</p>${stats}`,
        buttons: [['Start over', 'primary']],
      });
    } else {
      sfx('win');
      await showModal({
        kind: 'good', title: '🎆 THE DECADE ENDS',
        body: `<p>December 2000. You finished as a</p><p style="font-size:22px;color:var(--amber);font-weight:800">${E.rankOf(nw)}</p><p>Final net worth <b class="mono">${big(nw)}</b></p>${stats}`,
        buttons: [['Play again', 'primary']],
      });
    }
    newGame();
  }

  function newGame() {
    G = E.newGame(); tab = 'market'; seen = G.seq || 0; busy = false; save();
    $('title').classList.add('hidden'); $('app').classList.remove('hidden'); render();
  }
  function cont() {
    const s = load(); if (!s) return newGame();
    G = s; seen = G.seq || 0; busy = false; $('title').classList.add('hidden'); $('app').classList.remove('hidden'); render();
  }

  // ---------- events
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button,[data-stock],[data-offer]'); if (!t) return;
    if (t.dataset.mute) { window.Sfx.toggle(); render(); return; }
    if (t.closest('[data-offer]')) return offerModal();
    if (t.dataset.tab) { sfx('tap'); tab = t.dataset.tab; $('view').scrollTop = 0; render(); return; }
    if (t.dataset.stock && !t.matches('button')) return openSheet(t.dataset.stock);
    if (t.dataset.close) return closeSheet();
    if (t.dataset.buy || t.dataset.sell) {
      const [cat, id] = (t.dataset.buy || t.dataset.sell).split(':');
      const key = cat === 'lux' ? id : +id;
      const r = t.dataset.buy ? E.buyItem(G, cat, key) : E.sellItem(G, cat, key);
      toast(r.msg); sfx(r.ok ? 'buy' : 'error'); if (r.ok) { buzz(20); noteAch(E.checkAchievements(G)); save(); } render(); return;
    }
    if (t.dataset.q) { qty = Math.max(0, (parseInt($('qtyIn').value) || 0) + +t.dataset.q); renderSheet(); return; }
    if (t.dataset.qs) {
      const h = G.holdings[sheetT], sh = G.shorts[sheetT];
      qty = t.dataset.qs === 'max' ? Math.max(E.maxBuy(G, sheetT), E.maxShort(G, sheetT)) : t.dataset.qs === 'all' ? (h ? h.shares : sh ? sh.shares : 0) : +t.dataset.qs;
      sfx('tap');
      renderSheet(); return;
    }
    if (t.dataset.trade) {
      const k = t.dataset.trade;
      const r = { buy: E.buy, sell: E.sell, short: E.short, cover: E.cover }[k](G, sheetT, qty);
      toast(r.msg); sfx(r.ok ? (k === 'buy' || k === 'short' ? 'buy' : 'sell') : 'error');
      if (r.ok) {
        buzz(20); noteAch(E.checkAchievements(G)); save();
        const h = G.holdings[sheetT], sh = G.shorts[sheetT];
        if (k === 'sell') qty = h ? Math.min(qty, h.shares) : 1;
        if (k === 'cover') qty = sh ? Math.min(qty, sh.shares) : 1;
        if (qty < 1) qty = 1;
      }
      render(); return;
    }
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'qtyIn') { qty = Math.max(0, parseInt(e.target.value) || 0); const pos = e.target.selectionStart; renderSheet(); const i = $('qtyIn'); i.focus(); try { i.setSelectionRange(pos, pos); } catch (x) {} } });
  $('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
  $('btnWeek').addEventListener('click', () => advance(1));
  $('btnMonth').addEventListener('click', () => advance(4));
  $('btnNew').addEventListener('click', newGame);
  $('btnContinue').addEventListener('click', cont);
  if (load()) $('btnContinue').classList.remove('hidden');
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
