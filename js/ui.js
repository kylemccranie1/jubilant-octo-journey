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
  let scene = null, titleScene = null;
  let duel = null; // seeded duel sandbox: { ch, realG, titleVisible, name, opp }
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
  function save() { if (tut || duel) return; try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) {} }
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
    const runway = bills > 0 ? Math.max(0, G.cash) / bills : 99;
    $('top').innerHTML = `
      <div class="top-row"><span class="date">📅 ${dateStr(G.day)}</span><span><span class="rank">${E.rankOf(nw)}</span> <button class="mute" data-mute="1" aria-label="Toggle sound">${window.Sfx && window.Sfx.muted ? '🔇' : '🔊'}</button></span></div>
      <div class="nw ${nw < E.START_CASH * .5 ? 'down' : ''}">${big(nw)} <small class="${cls(d)}" style="font-size:12px">${d ? sgn(d) : ''}</small></div>
      <div class="sub"><span>Account <b>${money(G.cash)}</b></span>${G.pos ? `<span>Open <b class="${cls(E.unreal(G))}">${sgn(E.unreal(G))}</b></span>` : ''}<span>Bills <b>${money(bills)}/mo</b></span>${G.notice ? `<span class="down blink">⚠ NOTICE: ${money(G.notice.need)} by ${dateStr(G.notice.due)}</span>` : (runway < 12 ? `<span class="${runway < 3 ? 'down' : 'amber'}">Runway <b>${runway.toFixed(1)} mo</b></span>` : '')}</div>`;
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
    if (G.notice) {
      const dl = Math.max(0, G.notice.due - G.day);
      html += `<div class="card notice"><b>📬 FINAL NOTICE</b><br>${money(G.notice.need)} is due and you have <b>${money(G.cash)}</b> in the account. You have <b>${dl} trading day${dl === 1 ? '' : 's'}</b> to raise the difference, or the repo man collects. Trade your way out — or skip and face it.</div>`;
    }
    html += careerCard(nw);
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
          <div class="meta">${locked ? `🔒 Unlocks at ${big(c.unlock)} net worth` : `Last ${fp(c.sym, closeT)} · ${money(c.tickVal, 2)}/tick · ${money(E.marginOf(G, c.sym))} margin/lot`}</div></div>
        ${locked || blocked ? '' : `<span class="tag">max ${E.maxLots(G, c.sym)} lots</span>`}</div>`;
    }
    html += `<div class="card tip-card row tap" data-train="1"><div class="grow" style="font-size:13px">🎓 <b>Training Floor</b>: a 2-minute interactive lesson on reading order flow.</div><span>›</span></div>`;
    html += `<div class="card tip-card row tap" data-duel="1"><div class="grow" style="font-size:13px">⚔️ <b>Seeded Duel</b>: same pit, same day, same crowd. Beat a friend's P&amp;L.</div><span>›</span></div>`;
    html += `<h2>Between sessions</h2><div class="chips"><button data-skip="1">Skip day</button><button data-skip="5">Skip week</button><button data-skip="21">Skip month</button></div>
      <div class="dim" style="font-size:11px;margin-top:6px">Skipping lets the market move without you (positions are marked to market daily; margin calls still apply). Bills still come due.</div>`;
    html += `<div class="card" style="margin-top:12px;font-size:12px;color:var(--dim)"><b>How the pit works:</b> every shout is a real order eating the book — watch the ladder and the tape. Big BUYs lift the offer and push price up; the crowd's lean (the pit's hand signals and the flow gauge) tells you which way the informed money is going. <b>BUY</b>/<b>SELL</b> cross the spread and walk the book, so big orders slip and move price (then partly revert). <b>Join BID/OFFER</b> rests an order in the queue: great for taking profit into strength, dangerous for quoting both sides — you mostly get filled when the market is running over you. Use a stop. Size small until you've earned it.</div>`;
    return html;
  }

  function careerCard(nw) {
    const cr = E.CAREER[G.level], nx = E.CAREER[G.level + 1], infl = E.inflation(G);
    const prog = nx ? Math.max(0, Math.min(1, (nw - cr.nw) / (nx.nw - cr.nw))) : 1;
    const nextPit = nx ? E.CONTRACTS.filter((c) => c.unlock > cr.nw && c.unlock <= nx.nw).map((c) => c.name).join(', ') : '';
    const floor = Math.round(cr.nw * 0.6);
    return `<div class="card career"><div class="row"><div class="emoji">🏅</div><div class="grow"><div class="title">${cr.title}</div><div class="desc">${cr.perk}</div></div>
      <div class="px"><div class="p">${cr.dues ? money(Math.round(cr.dues * infl)) : 'No'}</div><div class="c dim">dues/mo</div></div></div>
      ${nx ? `<div class="prog"><i style="width:${(prog * 100).toFixed(0)}%"></i></div><div class="desc">Next: <b>${nx.title}</b> at ${big(nx.nw)} net worth${nextPit ? ' (opens ' + nextPit + ')' : ''} · dues ${money(Math.round(nx.dues * infl))}/mo</div>` : '<div class="desc">You are at the top of the ladder.</div>'}
      ${G.level > 0 ? `<div class="desc ${nw < floor * 1.3 ? 'down' : ''}">Keep net worth above <b>${big(floor)}</b> or the exchange pulls your badge${G.career.low ? ` (${G.career.low}/20 days below)` : ''}.</div>` : ''}</div>`;
  }

  function viewLedger() {
    const s = G.stats, nw = E.netWorth(G), lvl = E.marginLevel(G);
    const wr = s.wins + s.losses ? Math.round(100 * s.wins / (s.wins + s.losses)) + '%' : '—';
    let html = `<div class="stats">
      <div class="stat"><small>Net worth</small><b>${big(nw)}</b></div>
      <div class="stat"><small>Peak</small><b>${big(s.peak)}</b></div>
      <div class="stat"><small>Realized P/L</small><b class="${cls(s.realized)}">${big(s.realized)}</b></div>
      <div class="stat"><small>Fees paid</small><b>${money(s.fees)}</b></div>
      <div class="stat"><small>Sessions · fills</small><b>${s.sessions} · ${s.trades}</b></div>
      <div class="stat"><small>Win rate</small><b>${wr}</b></div>
      <div class="stat"><small>Best / worst session</small><b><span class="up">${sgn(s.bestDay)}</span> / <span class="down">${sgn(s.worstDay)}</span></b></div>
      <div class="stat"><small>Win streak</small><b>${s.streak}</b></div>
      <div class="stat"><small>Gains this year</small><b class="${cls(G.ytd)}">${big(G.ytd)}</b></div>
      <div class="stat"><small>Tax due (Apr)</small><b>${G.taxDue > 0 ? money(G.taxDue) : money(Math.max(0, G.ytd) * E.TAX_RATE) + ' est.'}</b></div></div>`;
    if (G.pos) html += `<div class="card" style="margin-top:8px;font-size:13px">📌 ${G.pos.qty > 0 ? 'Long' : 'Short'} ${Math.abs(G.pos.qty)} ${G.pos.sym} · margin level <b class="${lvl < 1.3 ? 'down' : ''}">${(lvl * 100).toFixed(0)}%</b> (liquidated below 75%)</div>`;
    if (G.heat) html += `<div class="card" style="margin-top:6px;font-size:12px">🕵️ Compliance heat: <b>${'🔥'.repeat(G.heat)}</b>${G.fined ? ' · <span class="down">Already fined — next time is prison</span>' : ''}</div>`;
    if (G.lastSession) {
      const l = G.lastSession;
      html += `<h2>Last session</h2><div class="card">${E.CBY[l.sym].emoji} ${l.sym} · <b class="${cls(l.pnl)}">${sgn(l.pnl)}</b> · ${l.trades} fills, ${l.wins} winning round trips</div>`;
    }
    const yrNow = nw - G.yr.nw0;
    html += `<h2>${G.yr.year} so far</h2><div class="card" style="font-size:13px">Net worth <b class="${cls(yrNow)}">${sgn(yrNow)}</b> this year · ${G.yr.sessions} sessions · best <b class="up">${sgn(G.yr.best)}</b> · worst <b class="down">${sgn(G.yr.worst)}</b></div>`;
    html += '<h2>🏁 Floor standings</h2>' + E.rankings(G).map((r) => `<div class="card row ${r.you ? 'cur' : ''}" style="padding:7px 10px"><div class="mono" style="width:22px;color:var(--dim)">${r.rank}</div><div class="grow"><div class="title" style="font-size:14px">${r.you ? '⭐ ' : ''}${r.name}${r.broke ? ' <span class="tag">💥 wiped out</span>' : ''}</div><div class="desc">${r.tag}</div></div><div class="px"><div class="p">${big(r.nw)}</div></div></div>`).join('');
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
    warn: ['👀 Uh-oh…', 'bad', 'sneaky'], promote: ['🏅 PROMOTED', 'good', 'ach'], demote: ['📉 BADGE PULLED', 'bad', 'lose'], notice: ['📬 FINAL NOTICE', 'bad', 'alarm'], noticeOk: ['😮‍💨 Just in time', 'good', 'ach'], life: ['🎲 Life happens', '', 'error'], sec: ['⚖️ CFTC SETTLEMENT', 'bad', 'alarm'], unlock: ['🔓 New pit unlocked', 'good', 'ach'],
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
            <p>${c.name} · ${s.trades} fills · ${s.wins} winning round trips</p>${s.overnight ? '<p class="dim">You\'re holding a position overnight.</p>' : ''}`,
        });
      } else if (e.kind === 'review') {
        const r = e.review, up = r.pnl >= 0;
        sfx(up ? 'win' : 'lose');
        await showModal({ kind: up ? 'good' : 'bad', title: `📋 ${r.year} ${r.final ? 'final ' : ''}review`,
          body: `<p class="mono" style="font-size:24px;margin:2px 0;color:var(--${up ? 'up' : 'down'})">${sgn(r.pnl)}</p><p>${big(r.nw0)} → <b>${big(r.nw1)}</b></p>
            <p>You finished <b>#${r.rank} of ${r.of}</b> on the floor as a <b>${r.title}</b>.${r.leader ? `<br><span class="dim" style="font-size:12px">Leader: ${r.leader.name} (${big(r.leader.nw)})</span>` : ''}</p>
            <p class="dim mono" style="font-size:12px">${r.sessions} sessions · best ${sgn(r.best)} · worst ${sgn(r.worst)}</p>` });
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
      const fr = E.rankings(G).find((r) => r.you).rank;
      await showModal({ kind: 'good', title: '🎆 THE DECADE ENDS',
        body: `<p>December 2000. You finished as a</p><p style="font-size:22px;color:var(--amber);font-weight:800">${E.rankOf(nw)}</p><p>Final net worth <b class="mono">${big(nw)}</b> · ranked <b>#${fr} of 7</b> on the floor</p>${stats}`,
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
    live = { timer: null, speed: (G.level || 0) === 0 ? 0.75 : 1, paused: false, qty: 1, stopIdx: 0, lastSave: 0, bannerTimer: null, modalOpen: false, lastShout: -1 };
    if (G.sess.stop) live.stopIdx = Math.max(0, STOPS.indexOf(G.sess.stop));
    $('pit').classList.remove('hidden'); document.body.classList.add('live');
    if (titleScene) titleScene.stop();
    if (!scene) scene = window.PitScene.create($('pScene')); else scene.resize();
    scene.reset(); scene.start(); if (!resumePaused) scene.bell();
    live.seq = G.sess.pseq || 0; live.act = 0;
    if (window.Sfx) { window.Sfx.roarStart(); }
    $('pName').textContent = `${E.CBY[G.sess.sym].emoji} ${E.CBY[G.sess.sym].name}`;
    $('pSpeed').textContent = live.speed + '×';
    buildQty(); sizeCanvas(); updateLive();
    save();
    if (resumePaused) setPaused(true); else startTimer();
  }
  function startTimer() { stopTimer(); live.timer = setInterval(tick, E.STEP_MS / live.speed); }
  function stopTimer() { if (live && live.timer) { clearInterval(live.timer); live.timer = null; } }
  function setPaused(p) {
    live.paused = p; $('pPaused').classList.toggle('hidden', !p);
    $('pPause').textContent = p ? '▶' : '⏸';
    if (p) { stopTimer(); save(); if (window.Sfx) window.Sfx.roarLevel(0); } else startTimer();
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
    if (tut && tut.perStep) tut.perStep(tut.i++);
    const evs = E.stepSession(G);
    feedScene(S, evs);
    handleLiveEvents(evs);
    if (!live || !G) return;
    if (G.sess && !G.sess.done) {
      const sh = E.shoutsNow(G, 1)[0];
      if (sh && sh[0] === S.t && sh[0] !== live.lastShout) { live.lastShout = sh[0]; if (sh[2] >= E.CBY[S.sym].depth * 2) sfx('shout'); }
      if (G.sess.notes.length) { toast(G.sess.notes.join(' · ')); G.sess.notes.length = 0; sfx('fill'); }
      updateLive();
      if (tut && tut.waiter && --tut.waiter.left <= 0) { stopTimer(); const w = tut.waiter; tut.waiter = null; w.resolve(); }
      const now = Date.now(); if (now - live.lastSave > 4000) { live.lastSave = now; save(); }
    }
  }

  function feedScene(S, evs) {
    if (!scene || !live) return;
    const D = E.CBY[S.sym].depth; let n = 0;
    for (const pr of S.prints) {
      if (pr[5] <= live.seq) continue;
      live.seq = pr[5];
      if (pr[4] === 'me' || pr[4] === 'mine') scene.mine(pr[1]);
      else { scene.print(pr[1], pr[2] / D, pr[4]); n++; }
    }
    for (const e of evs) if (e.kind === 'headline') scene.headline(Math.sign(e.jump) || 1);
    live.act = 0.9 * live.act + 0.1 * Math.min(1, n * 0.8);
    scene.setLevels(E.flowGauge(G), live.act);
    if (window.Sfx) window.Sfx.roarLevel(Math.min(1, 0.2 + live.act * 1.4 + (S.burst ? 0.35 : 0)));
  }

  async function handleLiveEvents(evs) {
    if (tut) { for (const e of evs) if (e.kind === 'margin' || e.kind === 'stop') toast(e.text); return; }
    const closeEv = evs.find((e) => e.kind === 'close');
    for (const e of evs) {
      if (e.kind === 'headline') { banner(e.text, e.jump > 0 ? 'up' : 'down'); sfx('news'); buzz(60); }
      else if (e.kind === 'margin') { banner(e.text, 'down'); sfx('alarm'); buzz([120, 60, 120]); }
      else if (e.kind === 'marginwarn') { banner(e.text, 'down'); sfx('alarm'); buzz([60, 40, 60, 40, 60]); }
      else if (e.kind === 'stop') { toast(e.text); sfx('sell'); buzz(40); }
      else if (e.kind === 'insider') { toast(e.text); }
      else if (e.kind === 'offer') await offerFlow(e);
    }
    if (closeEv || G.over || !G.sess) await (duel ? finishDuel() : leaveLive(evs));
  }

  async function offerFlow(e) {
    live.modalOpen = true; stopTimer(); sfx('sneaky');
    const o = G.sess.offer;
    const i = await showModal({
      title: '📞 Paper in the pit!',
      body: `<p>${e.text}</p><p class="dim" style="font-size:12px">Trading ahead of a customer is illegal. If you profit, compliance might notice: first time is a big fine, second is <b>prison</b>. The order hits the book about 4 seconds after you decide.</p>`,
      buttons: [[`Fill it fairly (+${money(o.bonus)})`, ''], ['Trade ahead 🤫', 'primary']],
    });
    const r = E.respondOffer(G, i === 1 ? 'ahead' : 'honest');
    toast(r.msg);
    live.modalOpen = false;
    if (!live.paused) startTimer();
  }

  async function leaveLive(evs) {
    stopTimer(); live.modalOpen = true;
    $('pit').classList.add('hidden'); document.body.classList.remove('live'); live = null;
    if (scene) scene.stop(); if (window.Sfx) window.Sfx.roarStop();
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

  // split-flap style price board: each changed character flips
  function flapPrice(str) {
    const el = $('pLast'); if (el.dataset.v === str) return;
    const prev = el.dataset.v || '';
    el.dataset.v = str;
    el.innerHTML = [...str].map((ch, i) => `<span class="flap${ch === '.' || ch === '-' ? ' dot' : ''}${prev[i] !== ch && prev ? ' flip' : ''}">${ch}</span>`).join('');
  }

  function updateLive() {
    const S = G.sess; if (!S) return;
    const sym = S.sym, c = E.CBY[sym], t = S.t, q = E.quote(S), mid = q.mid, bid = q.bid, ask = q.ask, D = c.depth;
    const open = S.path[0], chg = (mid - open) / open;
    $('pClock').textContent = E.clockOf(t) + ' CT' + (G.notice ? ` · ⚠ ${money(G.notice.need)} due in ${Math.max(0, G.notice.due - G.day)}d` : '');
    $('pProg').style.width = (t / S.n * 100) + '%';
    const lastR = Math.max(bid, Math.min(ask, Math.round(S.last)));
    if (live.lastR != null && lastR !== live.lastR) { live.flash = { up: lastR > live.lastR, until: performance.now() + 320 }; }
    live.lastR = lastR;
    flapPrice(fp(sym, lastR));
    $('pLast').className = 'mono' + (live.flash && live.flash.until > performance.now() ? (live.flash.up ? ' fup' : ' fdown') : '');
    $('pChg').textContent = pct(chg); $('pChg').className = 'mono ' + (chg >= 0 ? 'up' : 'down');
    $('pBA').textContent = `${fp(sym, bid)} × ${fp(sym, ask)}`;
    const qn = curQty(), pb = E.preview(G, 1, qn), ps = E.preview(G, -1, qn);
    const slipTxt = (x) => (x.slip >= 0.5 ? ` · ${x.slip.toFixed(1)}t slip` : '');
    $('pBuy').innerHTML = `BUY ${qn}<small>${fp(sym, Math.round(pb.vwap))}${slipTxt(pb)}</small>`;
    $('pSell').innerHTML = `SELL ${qn}<small>${fp(sym, Math.round(ps.vwap))}${slipTxt(ps)}</small>`;
    // order book ladder
    const L = E.ladder(G, 3), mx = D * 2.5, now = performance.now();
    live.hitUntil = live.hitUntil || {};
    for (const r of L.asks.concat(L.bids)) if (S.hit[r.p] != null && t - S.hit[r.p] <= 1) live.hitUntil[r.p] = Math.max(live.hitUntil[r.p] || 0, now + 350);
    const row = (r, k) => `<div class="lv ${k} ${(live.hitUntil[r.p] || 0) > now ? 'hit' : ''}"><span class="lp">${fp(sym, r.p)}</span><span class="lbar"><i style="width:${Math.min(100, r.size / mx * 100)}%"></i></span><span class="ls">${r.size}${r.mine ? `<b> +${r.mine}</b>` : ''}</span></div>`;
    $('pLadder').innerHTML = L.asks.map((r) => row(r, 'a')).join('') + L.bids.map((r) => row(r, 'b')).join('');
    // flow gauge + floor intel
    const norm = E.flowGauge(G);
    $('pGaugeFill').style.cssText = norm >= 0 ? `left:50%;width:${norm * 50}%;background:var(--up)` : `left:${50 + norm * 50}%;width:${-norm * 50}%;background:var(--down)`;
    $('pHint').textContent = G.tech >= 1 ? 'Intel ' + (S.hint > 0 ? '▲' : S.hint < 0 ? '▼' : '–') : '';
    // shouts
    const sh = E.shoutsNow(G, 40).filter((s) => s[2] >= Math.max(2, D * 0.5) || s[4] === 'me' || s[4] === 'mine' || s[4] === 'block').slice(0, 6);
    $('pShouts').innerHTML = sh.map((s) => { const mine = s[4] === 'me' || s[4] === 'mine'; return `<div class="sh ${s[1] > 0 ? 'b' : 's'} ${s[2] >= D * 2 ? 'bigsh' : ''} ${mine ? 'mine' : ''}">${mine ? '★ ' : ''}${s[4] === 'block' ? 'PAPER ' : ''}${s[1] > 0 ? 'BUY' : 'SELL'} ${s[2]} <small>${fp(sym, Math.round(s[3]))}</small></div>`; }).join('') || '<div class="sh dim">…quiet…</div>';
    // position
    const p = G.pos, u = E.unreal(G), dayPnl = E.equity(G) - S.startEq;
    let liqTxt = '', danger = false;
    if (p) { const lp = E.liqPrice(G), dist = (E.markT(G) - lp) * Math.sign(p.qty); danger = dist < 12; liqTxt = `<b class="${dist < 25 ? 'down' : 'dim'}">Liq ${fp(sym, Math.round(lp))} (${Math.max(0, Math.round(dist))}t)</b> `; }
    $('pit').classList.toggle('danger', danger);
    const ords = S.orders.map((o) => `${o.side > 0 ? 'BID' : 'OFFER'} ${o.rem}@${fp(sym, o.price)} (${o.ahead} ahead)`).join(' · ');
    $('pPos').innerHTML = `<div>${p ? `<b class="${p.qty > 0 ? 'up' : 'down'}">${p.qty > 0 ? 'LONG' : 'SHORT'} ${Math.abs(p.qty)}</b> @ ${fp(sym, p.entry)}` : '<span class="dim">Flat</span>'}</div>
      <div>Open <b class="${cls(u)}">${sgn(u)}</b></div><div>Session <b class="${cls(dayPnl)}">${sgn(dayPnl)}</b></div>
      <div class="dim">${liqTxt}${ords || (p ? '' : 'Max ' + E.maxLots(G, sym) + ' lots')}</div>`;
    $('pStop').textContent = 'Stop: ' + (STOPS[live.stopIdx] ? STOPS[live.stopIdx] + ' ticks' : 'Off');
    $('pFlat').disabled = !p || live.paused;
    $('pCancel').disabled = !S.orders.length || live.paused; $('pBid').disabled = $('pOffer').disabled = live.paused;
    $('pFF').disabled = !!p || live.paused || !!(S.offer && !S.offer.resolved);
    $('pBuy').disabled = $('pSell').disabled = live.paused;
    drawChart();
  }

  function drawChart() {
    const S = G.sess, c = cvs(), ctx = c.getContext('2d'), W = c.width, H = c.height, dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, W, H);
    const pts = S.path.slice(Math.max(0, S.t - Math.min(150, Math.max(40, S.t))), S.t + 1);
    let lo = Math.min(...pts), hi = Math.max(...pts);
    if (G.pos && G.pos.sym === S.sym) { lo = Math.min(lo, G.pos.entry); hi = Math.max(hi, G.pos.entry); }
    const pad = Math.max(3, (hi - lo) * 0.15); lo -= pad; hi += pad;
    const span = Math.min(150, Math.max(40, S.t)), t0 = Math.max(0, S.t - span);
    const X = (i) => ((i - t0) / span) * W, Y = (v) => H - ((v - lo) / (hi - lo)) * H;
    ctx.strokeStyle = 'rgba(70,255,140,.10)'; ctx.lineWidth = 1;
    for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(0, H * k / 4); ctx.lineTo(W, H * k / 4); ctx.stroke(); }
    for (let k = 1; k < 6; k++) { ctx.beginPath(); ctx.moveTo(W * k / 6, 0); ctx.lineTo(W * k / 6, H); ctx.stroke(); }
    const up = pts[pts.length - 1] >= pts[0], col = up ? '#4dffa0' : '#ff6b6b';
    ctx.shadowColor = up ? '#2dff7a' : '#ff4d5e'; ctx.shadowBlur = 8 * dpr;
    ctx.lineWidth = 2 * dpr; ctx.strokeStyle = col; ctx.beginPath();
    const base = Math.max(0, S.t - Math.min(150, Math.max(40, S.t)));
    pts.forEach((v, i) => (i ? ctx.lineTo(X(base + i), Y(v)) : ctx.moveTo(X(base + i), Y(v)))); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineTo(X(base + pts.length - 1), H); ctx.lineTo(0, H); ctx.fillStyle = up ? 'rgba(45,255,122,.08)' : 'rgba(255,77,94,.08)'; ctx.fill();
    ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.lineWidth = 1.5 * dpr;
    if (G.pos && G.pos.sym === S.sym) {
      ctx.strokeStyle = '#ffb800'; ctx.beginPath(); ctx.moveTo(0, Y(G.pos.entry)); ctx.lineTo(W, Y(G.pos.entry)); ctx.stroke();
      if (S.stop) { const sv = G.pos.entry - Math.sign(G.pos.qty) * S.stop; ctx.strokeStyle = '#ff4d5e'; ctx.beginPath(); ctx.moveTo(0, Y(sv)); ctx.lineTo(W, Y(sv)); ctx.stroke(); }
    }
    for (const o of S.orders) { ctx.strokeStyle = o.side > 0 ? '#2dff7a' : '#ff4d5e'; ctx.beginPath(); ctx.moveTo(W * 0.6, Y(o.price)); ctx.lineTo(W, Y(o.price)); ctx.stroke(); }
    ctx.setLineDash([]);
    const D = E.CBY[S.sym].depth;
    for (const pr of S.prints) { if (pr[0] < t0) continue; // order-flow bubbles: size = lots, color = aggressor side
      const mine = pr[4] === 'me' || pr[4] === 'mine';
      const r = Math.min(11, 2.5 + Math.sqrt(pr[2] / D) * 3.2) * dpr;
      const sz = Math.round(r * 1.5), bx = Math.round(X(pr[0])) - (sz >> 1), by = Math.round(Y(pr[3])) - (sz >> 1);
      if (mine) { ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#ffffff'; ctx.strokeRect(bx, by, sz, sz); }
      else { ctx.fillStyle = pr[1] > 0 ? 'rgba(45,255,122,.5)' : 'rgba(255,77,94,.5)'; ctx.fillRect(bx, by, sz, sz); }
    }
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(base + pts.length - 1), Y(pts[pts.length - 1]), 4 * dpr, 0, 7); ctx.fill();
  }

  function doTrade(side) {
    if (!G.sess || !live || live.paused || live.modalOpen || (tut && tut.locked)) return;
    const r = E.trade(G, side, curQty());
    if (!r.ok) { toast(r.msg); sfx('error'); return; }
    sfx('fill'); buzz(15);
    toast(`${side > 0 ? 'Bought' : 'Sold'} ${r.filled} @ ${fp(G.sess.sym, Math.round(r.px))}${r.slip >= 0.5 ? ` (${r.slip.toFixed(1)}t slip)` : ''}`);
    updateLive();
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

  // =====================================================================  TRAINING FLOOR
  let tut = null;
  const TUT_KEY = 'ws90_tut';
  const abortErr = 'tut-exit';
  const Dd = () => E.CBY.SOY.depth;
  const midNow = () => (G.sess.bid + G.sess.ask) / 2;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function tutShow(o) {
    return new Promise((res) => {
      if (tut.aborted) return res(-1);
      tut.resolveCard = res;
      $('tutStep').textContent = o.step || '';
      $('tutTitle').textContent = o.title; $('tutBody').innerHTML = o.body;
      $('tutBtns').innerHTML = (o.buttons || ['Next ▶']).map((b, i) => `<button class="${i === 0 ? 'primary' : ''}" data-tb="${i}">${b}</button>`).join('');
      document.querySelectorAll('.tut-focus').forEach((e) => e.classList.remove('tut-focus'));
      (o.focus || []).forEach((id) => $(id).classList.add('tut-focus'));
      $('tutDim').classList.toggle('hidden', !(o.focus && o.focus.length && o.dim !== false));
      let top = false;
      if (o.focus && o.focus[0]) { const r = $(o.focus[0]).getBoundingClientRect(); top = r.top + r.height / 2 > window.innerHeight * 0.5; }
      if (o.pos) top = o.pos === 'top';
      $('tutCard').className = top ? 'top' : 'bot';
    });
  }
  async function say(o) { const i = await tutShow(o); if (tut.aborted) throw abortErr; return i; }
  function tutHide() { $('tutCard').classList.add('hidden'); $('tutDim').classList.add('hidden'); document.querySelectorAll('.tut-focus').forEach((e) => e.classList.remove('tut-focus')); }
  function run(n, perStep) {
    return new Promise((res) => {
      if (tut.aborted) return res();
      tutHide();
      tut.i = 0; tut.perStep = perStep || null; tut.waiter = { left: n, resolve: res };
      startTimer();
    }).then(() => { tut.perStep = null; if (tut.aborted) throw abortErr; });
  }
  const lean = (f, s, len) => E.forceRegime(G, f, s == null ? 0.95 : s, len || 90);
  function bigFlow(window_) { // summary of the last `window_` steps of meaningful crowd prints
    const S = G.sess, D = Dd(); let bb = 0, bs = 0, lb = 0, ls = 0;
    for (const p of S.prints) { if (p[0] <= S.t - window_ || p[4] === 'me' || p[4] === 'mine' || p[2] < D * 0.5) continue; if (p[1] > 0) { bb++; lb += p[2]; } else { bs++; ls += p[2]; } }
    return { bb, bs, lb, ls };
  }
  const fmtTicks = (t) => `${t >= 0 ? '+' : ''}${t.toFixed(1)} tick${Math.abs(t) === 1 ? '' : 's'}`;

  async function quizRound(n, o) {
    const label = `Round ${n} of 4`;
    await say({ step: label, title: o.title, body: o.intro, buttons: ['Watch the pit ▶'], pos: 'bot' });
    lean(o.f, o.s, 120);
    await run(o.watch, o.perStep);
    const before = bigFlow(28);
    const pick = await say({ step: label, title: o.question, body: o.questionBody, focus: ['pShouts', 'pGauge', 'pLadder'], dim: false, buttons: o.options, pos: 'top' });
    const right = pick === o.correct;
    const m0 = midNow();
    await run(o.after);
    const d = midNow() - m0;
    const tape = `In the last few seconds the tape showed <span class="g">${before.bb} big BUYs (${before.lb} lots)</span> vs <span class="r">${before.bs} big SELLs (${before.ls} lots)</span>.`;
    await say({ step: label, title: right ? '✅ Good read' : '❌ Not quite', focus: ['pShouts', 'pGauge'], dim: false, pos: 'top',
      body: `${o.explain}<div class="res">${tape}<br>Price over the next few seconds: <b>${fmtTicks(d)}</b>. ${o.outcome(d)}</div>`, buttons: [n < 4 ? 'Next round ▶' : 'Continue ▶'] });
  }

  async function lessons() {
    const D = Dd();
    lean(0, 0, 999);
    await say({ step: 'Welcome', title: '🎓 The Training Floor', body: 'This is a practice pit: <b>fake money, nothing is saved</b>. In about two minutes you will learn to read <b>order flow</b>, the real orders that move the price, which is how floor traders actually make money.<br><br>Watch the highlighted part of the screen, then tap Next.', buttons: ['Start ▶'], pos: 'bot' });

    // 1 — the tape
    await run(34, (i) => { if (i === 3) E.inject(G, 1, D * 2); if (i === 9) E.inject(G, -1, D * 0.8); if (i === 15) E.inject(G, 1, D * 1.4); if (i === 21) E.inject(G, 1, D * 3); if (i === 28) E.inject(G, -1, D * 0.7); });
    await say({ step: 'Lesson 1 of 5', title: 'The tape: every shout is a real order', focus: ['pShouts'],
      body: 'Each row is a <b>market order</b> from the crowd.<br><span class="g">BUY</span> = someone lifted the offer, paying up to get filled.<br><span class="r">SELL</span> = someone hit the bid, selling at any price.<br>The number is <b>lots</b>; bigger orders get bigger, bolder rows. Tiny orders are hidden so you only see what matters.' });

    // 2 — the ladder
    const L0 = E.ladder(G, 1), askBefore = G.sess.ask, front = L0.asks[0].size;
    let askAfter = askBefore;
    await run(2, (i) => { if (i === 0) { E.inject(G, 1, front + Math.round(D * 0.6)); askAfter = G.sess.ask; } });
    await say({ step: 'Lesson 2 of 5', title: 'The ladder: orders eat the book', focus: ['pLadder'],
      body: `Left: the order book. <span class="r">Red</span> = lots waiting to sell to you, <span class="g">green</span> = lots waiting to buy from you. A row flashes when a trade hits it.<br>That last BUY was bigger than the best offer, so it cleared it and the price <b>stepped up from ${E.fmtPrice('SOY', askBefore)} to ${E.fmtPrice('SOY', askAfter)}</b> (the offer). <b>Clear a level and the price moves</b>. That is the whole mechanism.` });

    // 3 — the chart
    await say({ step: 'Lesson 3 of 5', title: 'The chart: orders where they printed', focus: ['pChartWrap'],
      body: 'The squares are the same orders, drawn where they happened. <span class="g">Green = buys</span>, <span class="r">red = sells</span>, bigger = more lots. Price follows the blocks. Your own fills get a <b>white outline</b>.' });

    // 4 — gauge + pit posture on a real lean
    lean(1, 0.95, 120);
    await run(38);
    await say({ step: 'Lesson 4 of 5', title: 'The gauge and the pit show the lean', focus: ['pGauge', 'pScene'], pos: 'bot',
      body: 'Behind the scenes, informed money <b>leans</b> the crowd one way for roughly 3 to 12 seconds. You can feel it:<br>• the <b>flow gauge</b> leans toward BUY or SELL (it smooths the last few seconds, so it confirms more than it predicts),<br>• the <b>pit crowd</b> mostly flashes the same hand signal: <b>palms out = buying</b>, <b>palms in = selling</b>,<br>• and the tape fills with one color.<br>Better gear adds an <b>Intel ▲▼</b> hint.' });

    // 5 — quiz rounds
    await say({ step: 'Lesson 5 of 5', title: 'Now call it', body: 'Four quick rounds. Watch for a few seconds, then tell me what the pit is doing. The key: look for a <b>cluster</b> of big prints on one side, <b>confirmed</b> by the gauge and the ladder, not one loud print.', buttons: ['Start round 1 ▶'] });
    const opts = ['Leaning BUY', 'Leaning SELL', 'No lean: stand aside'];
    await quizRound(1, { title: 'Round 1', f: 1, s: 0.95, watch: 34, after: 22, options: opts, correct: 0,
      intro: 'Watch the tape, gauge and ladder.', question: 'Which way is the pit leaning?', questionBody: 'Check the tape colors, the gauge and the ladder.',
      explain: '<span class="g">BUY</span>s clearly outweighing sells on the tape, the gauge leaning right and the offers thinning out: a buy lean.',
      outcome: (d) => (d > 0 ? 'The lean carried price higher, as it usually does.' : 'It did not follow through this time. Flow is an edge, not a guarantee, so keep size small and use a stop.') });
    await quizRound(2, { title: 'Round 2', f: -1, s: 0.95, watch: 34, after: 22, options: opts, correct: 1,
      intro: 'A different lean this time.', question: 'Which way is the pit leaning?', questionBody: 'Same drill.',
      explain: '<span class="r">SELL</span>s clearly outweighing buys on the tape, the gauge leaning left and the bids getting eaten: a sell lean.',
      outcome: (d) => (d < 0 ? 'Price sank with the selling.' : 'No follow-through this time. That is why you use a stop.') });
    await quizRound(3, { title: 'Round 3', f: 0, s: 0, watch: 30, after: 18, options: opts, correct: 2, perStep: null,
      intro: 'Careful, this one is a trap for impatient traders.', question: 'Is there a lean?', questionBody: 'Look for alternating colors and a gauge that stays near the middle.',
      explain: 'Buys and sells alternating, the gauge hovering near the middle: <b>no lean</b>. Trading chop just pays the spread and fees. <b>Standing aside is a position.</b>',
      outcome: (d) => (Math.abs(d) < 3 ? 'Price went nowhere. A trade here would just have cost you the spread.' : 'Price drifted a bit, but with no cluster there was no reason to trade it.') });
    await quizRound(4, { title: 'Round 4: the trap', f: 1, s: 0.95, watch: 24, after: 18, options: ['Fade it: SELL', 'Stay with the lean: BUY', 'Stand aside'], correct: 1,
      perStep: (i) => { if (i === 23) E.inject(G, -1, D * 4); },
      intro: 'A buy lean is running... and then something loud happens.',
      question: 'A huge SELL just hit. What now?', questionBody: 'The lean was up. One giant sell just printed and price dipped. Do you fade it, or stay with the lean?',
      explain: 'One print against a running cluster is noise, and <b>big prints carry momentum</b>, so fading them is the costliest habit in the pit. Wait for a second or third big print on the new side before you believe a reversal.',
      outcome: (d) => (d > 0 ? 'Price recovered and kept climbing with the lean.' : 'This time it kept falling, which is why a stop and small size matter. But fading single prints loses far more often than it wins.') });

    // costs
    await say({ step: 'Costs', title: 'What it costs to trade', focus: ['pBuy', 'pSell'],
      body: 'A market <b>BUY</b> pays the ask and a <b>SELL</b> gets the bid: that 1-tick gap is the <b>spread</b>, plus a <b>fee per lot</b> each side. A round trip costs about <b>1.5 ticks</b>, so only trade when you expect more than that: a strong cluster, not noise.<br>Big orders walk the book: the button shows the <b>expected average fill and slippage</b>. Keep size small, use a <b>stop</b>.' });

    // practice trade
    tut.locked = false;
    const eq0 = E.equity(G);
    tut.i = 0; tut.perStep = (i) => { if (i === 0) lean(1, 0.95, 55); if (i === 62) lean(-1, 0.95, 70); };
    startTimer();
    const doneP = await say({ step: 'Your turn', title: 'Trade with the lean', pos: 'top',
      body: 'Live practice. The pit will lean <span class="g">up</span> for a while, then flip <span class="r">down</span>.<br>• Use <b>BUY</b>/<b>SELL</b> (1–2 lots) when you see a cluster,<br>• take profit with <b>Join OFFER/BID</b> or <b>FLATTEN</b> when the flow fades,<br>• stay out of the chop.<br>Tap <b>Done</b> whenever you like.', buttons: ['Done ✔'] });
    tut.perStep = null; stopTimer(); tut.locked = true;
    if (G.pos) E.flatten(G);
    const pnl = E.equity(G) - eq0;
    await say({ step: 'Your turn', title: pnl > 0 ? '💰 Nice trading' : (G.stats.trades ? 'Practice result' : 'You stood aside'), pos: 'top',
      body: G.stats.trades ? `Practice P&amp;L: <b class="${pnl >= 0 ? 'g' : 'r'}">${sgn(pnl)}</b> after fees.<br>${pnl >= 0 ? 'You read the lean and took it.' : 'Fees and spread add up. Wait for clearer clusters and use a stop.'}` : 'No trades is a valid answer when there is no edge. Next time, try following a clear cluster.' });

    // wrap-up
    await say({ step: 'Done', title: '🎓 Your order-flow checklist', pos: 'top',
      body: '1. <b>Cluster, not a print.</b> 2–3 big prints on one side (about 3× the usual level size in ~4 seconds).<br>2. <b>Confirm</b> with the gauge, the thinning ladder and the pit\'s hand signals.<br>3. <b>Don\'t fade</b> a single big print. Big prints carry momentum.<br>4. <b>Chop = no trade.</b> Alternating colors, flat gauge.<br>5. <b>Mind the costs</b> (about 1.5 ticks round trip). Small size, always a stop.<br>6. <b>Exit when the flow turns</b>, or take profit with a limit order while it is still with you.<br>7. <b>Trade headlines</b> right away.<br><br><i>These drills are cleaner than a real session: the edge is real but modest, so be selective.</i>', buttons: ['Finish training ✔'] });
  }

  async function startTraining() {
    if (tut || busy) return;
    if (G && G.sess) { toast('Finish your session first.'); return; }
    const titleVisible = !$('title').classList.contains('hidden');
    const realG = G, tg = E.newGame(777); tg.unlocked.SOY = true;
    tut = { realG, titleVisible, locked: true, aborted: false, perStep: null, waiter: null, i: 0 };
    G = tg;
    if (titleVisible) $('title').classList.add('hidden');
    E.startSession(G, 'SOY', { training: true });
    enterLive(false); stopTimer(); live.speed = 0.7; $('pSpeed').style.display = 'none'; $('pPause').style.display = 'none'; $('pFF').style.display = 'none';
    $('pName').textContent = '🎓 Training';
    let completed = false;
    try { await lessons(); completed = true; } catch (e) { if (e !== abortErr) console.error(e); }
    endTraining(completed);
  }
  function endTraining(completed) {
    const t = tut; if (!t) return;
    stopTimer(); tutHide();
    $('pit').classList.add('hidden'); document.body.classList.remove('live');
    if (scene) scene.stop(); if (window.Sfx) window.Sfx.roarStop();
    $('pSpeed').style.display = ''; $('pPause').style.display = ''; $('pFF').style.display = '';
    live = null; tut = null; G = t.realG;
    try { localStorage.setItem(TUT_KEY, '1'); } catch (e) {}
    if (completed) {
      noteAch([{ id: 'trained', name: 'Floor Trained' }]);
      if (G) { G.flags.trained = true; }
    }
    if (t.titleVisible) { $('title').classList.remove('hidden'); if (titleScene) { titleScene.resize(); titleScene.start(); } }
    else if (G) { $('app').classList.remove('hidden'); render(); }
  }
  async function promptTraining() {
    let seenIt = null; try { seenIt = localStorage.getItem(TUT_KEY); } catch (e) {}
    if (seenIt || tut || busy || !G || G.sess) return;
    const i = await showModal({ kind: '', title: '🎓 New to pit trading?', body: '<p>Take the two-minute <b>Training Floor</b> and learn to read order flow: the real orders that move the price. Fake money, nothing is saved.</p>', buttons: [['Start training', 'primary'], ['Maybe later', '']] });
    if (i === 1) { try { localStorage.setItem(TUT_KEY, 'skip'); } catch (e) {} } else startTraining();
  }

  // ---------- game flow
  function newGame() {
    G = E.newGame(); tab = 'pit'; selSym = 'SOY'; seen = G.seq || 0; busy = false; live = null; save();
    $('title').classList.add('hidden'); $('pit').classList.add('hidden'); $('app').classList.remove('hidden'); render();
    setTimeout(promptTraining, 500);
  }
  function cont() {
    const s = load(); if (!s) return newGame();
    G = s; seen = G.seq || 0; busy = false; live = null;
    selSym = G.pos ? G.pos.sym : 'SOY';
    $('title').classList.add('hidden'); $('app').classList.remove('hidden'); render();
    if (G.sess) enterLive(true);
  }


  // =====================================================================  SEEDED DUEL
  // Two players trade the identical session (same pit, day, headlines, crowd) from the same $25k. Results travel in a link.
  const NAME_KEY = 'ws90_name';
  const b64e = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64d = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));
  const duelLink = (o) => location.origin + location.pathname + '?duel=' + b64e(o); // a query string survives chat apps and in-app browsers that drop #fragments
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function parseDuel(text) {
    try {
      const m = String(text).match(/duel=([A-Za-z0-9_-]+)/), o = b64d(m ? m[1] : String(text).trim());
      if (o && typeof o.seed === 'number' && (!o.a || typeof o.a.p === 'number') && (!o.b || typeof o.b.p === 'number')) return o;
    } catch (e) {}
    return null;
  }
  async function askName() {
    let n = ''; try { n = localStorage.getItem(NAME_KEY) || ''; } catch (e) {}
    const i = await showModal({ title: 'Your trading name', body: `<p class="dim" style="font-size:12px">Shown to your opponent on the scoreboard.</p><input id="duelName" maxlength="14" value="${esc(n)}" placeholder="e.g. Sally" style="width:100%;font-size:16px;padding:8px;margin-top:6px;background:var(--panel2);color:var(--fg);border:1px solid var(--line);border-radius:8px">`, buttons: [['Go', 'primary'], ['Cancel', '']] });
    const v = ($('duelName') ? $('duelName').value : '').trim().slice(0, 14) || 'Rookie';
    if (i !== 0) return null;
    try { localStorage.setItem(NAME_KEY, v); } catch (e) {}
    return v;
  }
  async function duelMenu() {
    if (tut || busy || duel) return;
    if (G && G.sess) { toast('Finish your session first.'); return; }
    const i = await showModal({ title: '⚔️ Seeded Duel',
      body: '<p style="font-size:13px">You and a friend trade the <b>exact same session</b>: same pit, same day, same headlines, same crowd, same $25,000. Best P&amp;L wins. Your results travel in a link you text each other. Your real career is untouched.</p>',
      buttons: [['Challenge a friend', 'primary'], ['Today\'s Daily Duel', ''], ['I have a code or link', ''], ['Cancel', '']] });
    if (i === 0) startDuel({ seed: (Math.random() * 2 ** 31) | 0 });
    else if (i === 1) { const d = new Date(); startDuel({ seed: d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(), daily: 1 }); }
    else if (i === 2) {
      const j = await showModal({ title: 'Paste the challenge', body: '<textarea id="duelCode" rows="4" placeholder="Paste the link or code here" style="width:100%;font-size:14px;padding:8px;background:var(--panel2);color:var(--fg);border:1px solid var(--line);border-radius:8px"></textarea>', buttons: [['Open', 'primary'], ['Cancel', '']] });
      if (j !== 0) return;
      const o = parseDuel($('duelCode').value); if (!o) { toast('That code does not look right.'); sfx('error'); return; }
      startDuel(o);
    }
  }
  async function startDuel(o) {
    if (tut || duel || busy) return;
    if (G && G.sess) { toast('Finish your session first.'); return; }
    const ch = E.duelFromSeed(o.seed), c = E.CBY[ch.sym];
    if (o.a && o.b) { await showDuelResult(ch, o, null); return; }
    const intro = o.a
      ? `<p><b>${esc(o.a.n)}</b> challenged you in <b>${c.emoji} ${c.name}</b> on <b>${dateStr(ch.day)}</b>. Their score stays hidden until you finish.</p>`
      : `<p>${o.daily ? 'Today\'s Daily Duel: ' : ''}<b>${c.emoji} ${c.name}</b> on <b>${dateStr(ch.day)}</b>.</p>`;
    const i = await showModal({ title: '⚔️ Duel', body: `${intro}<p class="dim" style="font-size:12px">One session, $25,000 to start, no customer offers, fixed 1× speed. Anything you hold at the close is marked to the closing price.</p>`, buttons: [['Ring the bell', 'primary'], ['Back', '']] });
    if (i !== 0) return;
    const name = await askName(); if (!name) return;
    const titleVisible = !$('title').classList.contains('hidden');
    duel = { ch, o, name, realG: G, titleVisible };
    G = E.duelGame(ch);
    if (titleVisible) $('title').classList.add('hidden'); else $('app').classList.add('hidden');
    E.startSession(G, ch.sym, { duel: ch.seed });
    sfx('bell');
    enterLive(false);
    live.speed = 1; $('pSpeed').textContent = '1×'; startTimer();
    $('pSpeed').style.display = 'none'; $('pFF').style.display = 'none';
    $('pName').textContent = `⚔️ ${c.emoji} ${c.name}`;
  }
  function exitDuel() {
    const d = duel; if (!d) return;
    stopTimer(); $('pit').classList.add('hidden'); document.body.classList.remove('live');
    if (scene) scene.stop(); if (window.Sfx) window.Sfx.roarStop();
    $('pSpeed').style.display = ''; $('pFF').style.display = '';
    live = null; duel = null; G = d.realG;
    if (d.titleVisible) { $('title').classList.remove('hidden'); if (titleScene) { titleScene.resize(); titleScene.start(); } }
    else if (G) { $('app').classList.remove('hidden'); render(); }
  }
  async function finishDuel() {
    const d = duel, ls = G.lastSession || { pnl: G.cash - E.DUEL_CASH, trades: 0, wins: 0 };
    const me = { n: d.name, p: Math.round(ls.pnl), tr: ls.trades, w: ls.wins, lg: ls.log || [] };
    stopTimer(); live.modalOpen = true;
    exitDuel();
    const o = d.o, out = o.a ? { seed: o.seed, daily: o.daily, a: o.a, b: me } : { seed: o.seed, daily: o.daily, a: me };
    sfx(me.p >= 0 ? 'win' : 'lose');
    await showDuelResult(d.ch, out, me);
  }
  function drawDuel(cv, ch, a, b) {
    const path = E.duelPath(ch), dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, n = path.length;
    let lo = Math.min(...path), hi = Math.max(...path);
    for (const p of [a, b]) if (p) for (const f of p.lg) { lo = Math.min(lo, f[2]); hi = Math.max(hi, f[2]); }
    const pad = Math.max(2, (hi - lo) * 0.1); lo -= pad; hi += pad;
    const X = (t) => 6 * dpr + t / (n - 1) * (W - 12 * dpr), Y = (v) => H - 6 * dpr - (v - lo) / (hi - lo) * (H - 12 * dpr);
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(160,200,255,.55)'; g.lineWidth = 1.5 * dpr; g.beginPath();
    path.forEach((v, t) => (t ? g.lineTo(X(t), Y(v)) : g.moveTo(X(t), Y(v)))); g.stroke();
    const mark = (f, col, hollow) => {
      const x = X(f[0]), y = Y(f[2]), s = 5 * dpr, up = f[1] > 0;
      g.beginPath(); if (up) { g.moveTo(x, y - s); g.lineTo(x - s, y + s); g.lineTo(x + s, y + s); } else { g.moveTo(x, y + s); g.lineTo(x - s, y - s); g.lineTo(x + s, y - s); }
      g.closePath();
      if (hollow) { g.strokeStyle = col; g.lineWidth = 1.5 * dpr; g.stroke(); } else { g.fillStyle = col; g.fill(); }
    };
    if (b) b.lg.forEach((f) => mark(f, '#ffb020', true));
    a.lg.forEach((f) => mark(f, '#2dff7a', false));
  }
  async function showDuelResult(ch, o, justPlayed) {
    // 'you' is the player who just finished (the newest result); when just viewing a finished link, A vs B
    const c = E.CBY[ch.sym];
    const first = o.b ? o.a : null, second = o.b || o.a;
    const you = justPlayed || null;
    let rows, head, kind = '';
    const row = (nm, r, cls) => `<tr class="${cls || ''}"><td>${esc(nm)}</td><td class="mono" style="color:var(--${r.p >= 0 ? 'up' : 'down'})">${sgn(r.p)}</td><td class="mono">${r.tr}</td><td class="mono">${r.w}</td></tr>`;
    if (o.b) {
      const A = o.a, B = o.b, d = B.p - A.p;
      head = d === 0 ? 'Dead heat' : `${esc(d > 0 ? B.n : A.n)} wins by ${money(Math.abs(d))}`;
      kind = (justPlayed ? (d > 0 ? 'good' : d < 0 ? 'bad' : '') : '');
      rows = row(A.n, A, A.p >= B.p ? 'win' : '') + row(B.n, B, B.p >= A.p ? 'win' : '');
    } else {
      head = 'Your score is in'; kind = o.a.p >= 0 ? 'good' : 'bad';
      rows = row(o.a.n, o.a, '');
    }
    const next = !o.b && o.a ? '<p class="dim" style="font-size:12px">Send them the link. They play the same session blind, then send theirs back.</p>' : (o.a && o.b && justPlayed ? '<p class="dim" style="font-size:12px">Send the link back so they can see the scoreboard.</p>' : '');
    const body = `<p style="font-size:12px" class="dim">${c.emoji} ${c.name} · ${dateStr(ch.day)}${o.daily ? ' · Daily Duel' : ''}</p>
      <p style="font-size:20px;font-weight:800;margin:4px 0">${head}</p>
      <table class="duel-t"><tr><th></th><th>P&amp;L</th><th>Fills</th><th>Wins</th></tr>${rows}</table>
      <canvas id="duelCv" style="width:100%;height:120px;display:block;margin:8px 0 2px;background:#0008;border-radius:8px"></canvas>
      <p class="dim" style="font-size:11px;margin:0">▲▼ solid = ${esc(o.b ? o.a.n : o.a.n)}'s fills${o.b ? ` · hollow = ${esc(o.b.n)}'s` : ''} · line = the market with nobody trading</p>${next}`;
    const link = duelLink(o), canSend = !(o.a && o.b && !justPlayed);
    for (;;) {
      const pr = showModal({ kind, title: '⚔️ Duel', body, buttons: canSend ? [[o.b ? 'Send result back' : 'Send challenge link', 'primary'], ['Done', '']] : [['Done', 'primary']] });
      setTimeout(() => { const cv = $('duelCv'); if (cv) drawDuel(cv, ch, o.a, o.b); }, 30);
      const i = await pr;
      if (!canSend || i !== 0) break;
      const text = o.b ? `Duel result: ${o.a.n} vs ${o.b.n}. ${link}` : `${o.a.n} challenges you to a trading duel on ${c.name}. Beat my ${sgn(o.a.p)}. ${link}`;
      try {
        if (navigator.share) { await navigator.share({ title: "The Pit '90 duel", text }); break; }
        await navigator.clipboard.writeText(text); toast('Link copied. Paste it to your friend.');
      } catch (e) { if (e && e.name === 'AbortError') continue; window.prompt('Copy this link:', text); }
    }
  }
  function checkDuelHash() {
    const m = (location.search + location.hash).match(/duel=([A-Za-z0-9_-]+)/); if (!m) return;
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    const o = parseDuel(m[1]); if (o) setTimeout(() => startDuel(o), 400); else toast('That duel link is damaged.');
  }

  // ---------- events
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button,[data-pit],[data-train],[data-duel]'); if (!t) return;
    if (t.id === 'tutExit') { if (tut) { tut.aborted = true; if (tut.waiter) { const w = tut.waiter; tut.waiter = null; w.resolve(); } if (tut.resolveCard) { const r = tut.resolveCard; tut.resolveCard = null; r(-1); } } return; }
    if (t.dataset.mute) { window.Sfx.toggle(); if (G) render(); return; }
    if (t.dataset.tab) { sfx('tap'); tab = t.dataset.tab; $('view').scrollTop = 0; render(); return; }
    if (t.dataset.pit && !t.matches('button')) {
      const c = E.CBY[t.dataset.pit];
      if (!G.unlocked[c.sym]) { toast(`Unlocks at ${big(c.unlock)} net worth.`); sfx('error'); return; }
      if (G.pos && G.pos.sym !== c.sym) { toast(`You're holding ${G.pos.sym}. Trade that pit.`); sfx('error'); return; }
      selSym = c.sym; sfx('tap'); render(); return;
    }
    if (t.dataset.skip) return skip(+t.dataset.skip);
    if (t.dataset.train) return startTraining();
    if (t.dataset.duel) return duelMenu();
    if (t.dataset.tb != null && tut) { const i = +t.dataset.tb; const r = tut.resolveCard; tut.resolveCard = null; if (r) r(i); return; }
    if (t.dataset.buy || t.dataset.sell) {
      const [cat, id] = (t.dataset.buy || t.dataset.sell).split(':');
      const key = cat === 'lux' ? id : +id;
      const r = t.dataset.buy ? E.buyItem(G, cat, key) : E.sellItem(G, cat, key);
      toast(r.msg); sfx(r.ok ? 'buy' : 'error'); if (r.ok) { buzz(20); noteAch(E.checkAchievements(G)); save(); } render(); return;
    }
    if (t.dataset.lq) { live.qty = t.dataset.lq === 'MAX' ? 'MAX' : +t.dataset.lq; buildQty(); sfx('tap'); if (G.sess) updateLive(); return; }
  });
  // trading buttons react on press for speed
  const press = (id, fn) => $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
  press('pBuy', () => doTrade(1));
  press('pSell', () => doTrade(-1));
  const limit = (side) => { if (!G.sess || !live || live.paused || live.modalOpen || (tut && tut.locked)) return; const r = E.placeLimit(G, side, curQty()); toast(r.msg); sfx(r.ok ? 'tap' : 'error'); updateLive(); };
  press('pBid', () => limit(1));
  press('pOffer', () => limit(-1));
  press('pCancel', () => { if (G.sess) { E.cancelOrders(G); sfx('tap'); updateLive(); } });
  press('pFlat', () => { if (G.sess && live && !live.paused && G.pos && !(tut && tut.locked)) { const r = E.flatten(G); if (r.ok) { sfx('fill'); buzz(15); } updateLive(); } });
  $('pStop').addEventListener('click', () => { live.stopIdx = (live.stopIdx + 1) % STOPS.length; E.setStop(G, STOPS[live.stopIdx]); sfx('tap'); updateLive(); });
  $('pFF').addEventListener('click', skipToClose);
  $('pPause').addEventListener('click', () => setPaused(!live.paused));
  $('pResume').addEventListener('click', () => setPaused(false));
  $('pLeave').addEventListener('click', async () => { if (duel) { if (!live) return; live.modalOpen = true; stopTimer(); const i = await showModal({ kind: 'bad', title: 'Forfeit the duel?', body: '<p>Leaving now abandons this duel. Nothing is saved.</p>', buttons: [['Keep trading', 'primary'], ['Forfeit', '']] }); if (i === 1) { exitDuel(); } else { live.modalOpen = false; if (!live.paused) startTimer(); } return; } stopTimer(); save(); if (scene) scene.stop(); if (window.Sfx) window.Sfx.roarStop(); document.body.classList.remove('live'); $('pit').classList.add('hidden'); live = null; $('app').classList.add('hidden'); $('title').classList.remove('hidden'); $('btnContinue').classList.remove('hidden'); });
  $('pSpeed').addEventListener('click', () => { const SP = [0.5, 0.75, 1, 2]; live.speed = SP[(SP.indexOf(live.speed) + 1) % SP.length]; $('pSpeed').textContent = live.speed + '×'; if (!live.paused && !live.modalOpen) startTimer(); });
  $('btnBell').addEventListener('click', openBell);
  $('btnNew').addEventListener('click', newGame);
  $('btnContinue').addEventListener('click', cont);
  $('btnTrain').addEventListener('click', startTraining);
  if ($('btnDuel')) $('btnDuel').addEventListener('click', duelMenu);
  window.addEventListener('resize', () => { if (live) { sizeCanvas(); if (scene) scene.resize(); updateLive(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && live && !live.paused && !live.modalOpen) setPaused(true); });

  if ($('titleScene') && window.PitScene) {
    titleScene = window.PitScene.create($('titleScene')); titleScene.start();
    setInterval(() => { if (!$('title').classList.contains('hidden')) { const r = Math.random(); titleScene.setLevels(Math.sin(Date.now() / 4000), 0.5); titleScene.print(r < 0.5 ? 1 : -1, 0.5 + Math.random() * 3, Math.random() < 0.06 ? 'block' : 'pit'); } }, 380);
    window.addEventListener('resize', () => titleScene.resize());
  }
  if (load()) $('btnContinue').classList.remove('hidden');
  checkDuelHash(); window.addEventListener('hashchange', checkDuelHash);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
