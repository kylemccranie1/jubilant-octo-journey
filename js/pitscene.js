/* The Pit '90 — animated pixel-art trading pit (canvas, low-res and upscaled). */
(() => {
  'use strict';
  const JACKETS = ['#e8453c', '#2f6fe0', '#f0c030', '#2fb06a', '#e07a1f', '#9b59d0', '#d6d6d6', '#17a8a8'];
  const SKIN = ['#f2c9a0', '#d9a273', '#a8704a', '#7a4b2f'];
  const HAIR = ['#222', '#6b4a2b', '#c9b27a', '#111', '#8a8a8a'];
  const GREEN = '#2dff7a', RED = '#ff4d5e';

  function create(canvas, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    let LW = 160, LH = 40, traders = [], tickets = [], litter = [], flash = null, me = null;
    let raf = null, last = 0, gauge = 0, activity = 0, seed = (Math.random() * 1e9) | 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

    function resize() {
      const r = canvas.getBoundingClientRect();
      LW = Math.max(80, Math.round(r.width / 2)); LH = Math.max(24, Math.round(r.height / 2));
      canvas.width = LW; canvas.height = LH;
      ctx.imageSmoothingEnabled = false;
      layout();
    }

    function layout() {
      traders = [];
      const rows = [{ y: Math.round(LH * 0.24), n: Math.max(7, Math.floor(LW / 13)), off: 0, back: true }, { y: Math.round(LH * 0.52), n: Math.max(6, Math.floor(LW / 14)), off: 0.5, back: false }];
      rows.forEach((row, ri) => {
        for (let i = 0; i < row.n; i++) {
          const x = Math.round(((i + 0.5 + (row.off ? 0.25 : 0)) / row.n) * LW);
          traders.push({
            x, y: row.y, row: ri, jacket: JACKETS[Math.floor(rnd() * JACKETS.length)], skin: SKIN[Math.floor(rnd() * SKIN.length)],
            hair: HAIR[Math.floor(rnd() * HAIR.length)], ph: rnd() * 6.28, eager: rnd(), state: 'idle', until: 0, next: rnd() * 800, bubble: 0, bubbleCol: GREEN,
          });
        }
      });
      // you: front row, middle — always in the cyan trading jacket
      const front = traders.filter((t) => t.row === 1);
      me = front[Math.floor(front.length / 2)];
      me.jacket = '#38e1ff'; me.skin = SKIN[1]; me.hair = '#222'; me.isMe = true;
    }

    // ---- events
    function setState(tr, st, ms, bubble, col) { tr.state = st; tr.until = ms; tr.bubble = bubble || 0; tr.bubbleCol = col || GREEN; }
    function print(side, rel, who) {
      const now = performance.now(), st = side > 0 ? 'buy' : 'sell', col = side > 0 ? GREEN : RED;
      const k = Math.max(1, Math.min(9, Math.round(rel * 2)));
      const pool = traders.filter((t) => !t.isMe);
      for (let i = 0; i < k; i++) { const t = pool[Math.floor(rnd() * pool.length)]; setState(t, st, now + 420 + rel * 160, 1 + Math.min(3, Math.round(rel)), col); }
      const n = Math.min(10, 1 + Math.round(rel * 2.2));
      for (let i = 0; i < n; i++) { const t = pool[Math.floor(rnd() * pool.length)]; tickets.push({ x: t.x + (rnd() - 0.5) * 4, y: t.y + 1, vx: (rnd() - 0.5) * 0.9, vy: -(1.4 + rnd() * 1.6), col: rnd() < 0.5 ? '#fff' : '#f0e68c', life: 1 }); }
      if (who === 'block') { surge(side, 1400); flash = { col: side > 0 ? 'rgba(45,255,122,.22)' : 'rgba(255,77,94,.22)', until: now + 500 }; }
    }
    function surge(side, ms) {
      const now = performance.now(), st = side > 0 ? 'buy' : 'sell', col = side > 0 ? GREEN : RED;
      traders.forEach((t) => { if (!t.isMe) setState(t, st, now + ms * (0.6 + rnd() * 0.6), 2, col); });
    }
    function headline(dir) { surge(dir, 1800); flash = { col: dir > 0 ? 'rgba(45,255,122,.25)' : 'rgba(255,77,94,.25)', until: performance.now() + 700 }; }
    function mine(side) { if (me) setState(me, side > 0 ? 'buy' : 'sell', performance.now() + 700, 3, '#fff'); }
    function bell() { const now = performance.now(); traders.forEach((t) => setState(t, rnd() < 0.5 ? 'buy' : 'sell', now + 900 + rnd() * 700, 1, '#ffd23f')); flash = { col: 'rgba(255,210,63,.25)', until: now + 600 }; }
    function setLevels(g, act) { gauge = g; activity = act; }
    function reset() { tickets = []; litter = []; traders.forEach((t) => { t.state = 'idle'; t.until = 0; }); }

    // ---- drawing
    const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
    function drawTrader(t, now) {
      const sway = Math.round(Math.sin(now / 260 + t.ph) * (0.4 + activity * 0.9));
      const x = Math.round(t.x) + (t.state === 'idle' ? 0 : sway), y = t.y + (t.row ? 0 : 0);
      const dark = t.row === 0 ? 0.72 : 1;
      const c = (col) => (dark < 1 ? shade(col, dark) : col);
      // legs
      px(x - 1, y + 8, 1, 2, c('#1d1d2b')); px(x + 1, y + 8, 1, 2, c('#1d1d2b'));
      // body (jacket) + badge
      px(x - 2, y + 3, 5, 5, c(t.jacket)); px(x + 1, y + 4, 1, 1, c('#fff'));
      // head + hair
      px(x - 1, y, 3, 3, c(t.skin)); px(x - 1, y - 1, 3, 1, c(t.hair));
      const st = t.state;
      if (st === 'buy') {            // palms out, arms thrust forward and down
        px(x - 3, y + 4, 1, 2, c(t.jacket)); px(x + 3, y + 4, 1, 2, c(t.jacket));
        px(x - 4, y + 6, 2, 2, c(t.skin)); px(x + 3, y + 6, 2, 2, c(t.skin));
      } else if (st === 'sell') {    // palms in, hands up by the face
        px(x - 3, y + 2, 1, 4, c(t.jacket)); px(x + 3, y + 2, 1, 4, c(t.jacket));
        px(x - 3, y, 2, 2, c(t.skin)); px(x + 2, y, 2, 2, c(t.skin));
      } else {
        px(x - 3, y + 4, 1, 3, c(t.jacket)); px(x + 3, y + 4, 1, 3, c(t.jacket));
      }
      if (st !== 'idle') px(x, y + 2, 1, 1, '#8a1f2b'); // open mouth
      if (t.bubble && st !== 'idle') { const w = 2 + t.bubble; ctx.globalAlpha = 0.9; px(x - Math.floor(w / 2), y - 4, w, 2, t.bubbleCol); ctx.globalAlpha = 1; }
      if (t.isMe) { ctx.globalAlpha = 0.9; px(x - 3, y - 2, 7, 1, '#38e1ff'); ctx.globalAlpha = 1; } // your marker
    }
    function shade(hex, k) {
      const n = parseInt(hex.slice(1).length === 3 ? hex.slice(1).replace(/(.)/g, '$1$1') : hex.slice(1), 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(64, now - (last || now)); last = now;
      // --- update
      traders.forEach((t) => {
        if (t.state !== 'idle' && now > t.until) setState(t, 'idle', 0);
        if (t.state === 'idle' && !t.isMe) {
          t.next -= dt;
          if (t.next <= 0) {
            t.next = 350 + rnd() * 900;
            const lean = Math.abs(gauge) * (0.35 + 0.65 * t.eager);
            if (rnd() < lean * 0.9) setState(t, gauge > 0 ? 'buy' : 'sell', now + 350 + rnd() * 500, 0, gauge > 0 ? GREEN : RED);
            else if (rnd() < 0.05 + activity * 0.1) setState(t, rnd() < 0.5 ? 'buy' : 'sell', now + 300, 0, rnd() < 0.5 ? GREEN : RED);
          }
        }
      });
      tickets.forEach((k) => { k.x += k.vx; k.y += k.vy; k.vy += 0.12; k.vx *= 0.99; if (k.y >= LH - 2) { k.life = 0; if (litter.length < 90) litter.push({ x: k.x, y: LH - 1 - Math.floor(rnd() * 2), c: k.col }); } });
      tickets = tickets.filter((k) => k.life > 0 && k.x > -2 && k.x < LW + 2);
      // --- draw
      ctx.clearRect(0, 0, LW, LH);
      // back wall with exchange boards
      px(0, 0, LW, LH, '#0b1022');
      const bw = Math.floor(LW / 4);
      for (let b = 0; b < 3; b++) {
        const bx = Math.round(LW * (0.12 + b * 0.3)), by = 1;
        px(bx - 1, by - 1, bw + 2, 6, '#05070f'); px(bx, by, bw, 4, '#1a1304');
        for (let i = 0; i < bw; i += 2) for (let j = 0; j < 3; j += 2) {
          const on = ((i * 7 + j * 3 + Math.floor(now / 300) * (b + 1)) % 5) < 2 + Math.round(activity * 2);
          if (on) px(bx + i, by + j, 1, 1, '#ffb000');
        }
      }
      // pit steps
      px(0, t0(0) + 9, LW, 4, '#2c2742'); px(0, t0(0) + 13, LW, 1, '#14101f');
      px(0, t0(1) + 9, LW, LH, '#3d3860'); px(0, t0(1) + 9, LW, 1, '#5a5485');
      px(0, LH - 3, LW, 3, '#26223a');
      litter.forEach((l) => px(l.x, l.y, 1, 1, l.c));
      traders.filter((t) => t.row === 0).forEach((t) => drawTrader(t, now));
      traders.filter((t) => t.row === 1).forEach((t) => drawTrader(t, now));
      tickets.forEach((k) => px(k.x, k.y, 2, 1, k.col));
      if (flash && now < flash.until) { ctx.fillStyle = flash.col; ctx.fillRect(0, 0, LW, LH); }
      // scanline darkening
      ctx.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < LH; y += 2) ctx.fillRect(0, y, LW, 1);
    }
    const t0 = (row) => (row ? Math.round(LH * 0.52) : Math.round(LH * 0.24));

    function start() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = null; }
    resize();
    return { resize, start, stop, print, headline, mine, bell, setLevels, reset, surge };
  }
  window.PitScene = { create };
})();
