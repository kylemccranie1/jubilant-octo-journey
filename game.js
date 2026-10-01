(() => {
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const overlay = document.getElementById('overlay');
  const msg = document.getElementById('msg');
  const bestEl = document.getElementById('best');
  const playBtn = document.getElementById('play');

  let W, H, dpr;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  let best = 0;
  try { best = +localStorage.getItem('sd_best') || 0; } catch (e) {}
  const showBest = () => bestEl.textContent = best ? 'Best: ' + best : '';
  showBest();

  const player = { x: 0, y: 0, r: 16 };
  let target = null, rocks, stars, bg, score, lives, t, spawnT, starT, running, last, shake;

  function reset() {
    player.x = W / 2; player.y = H * 0.8; target = player.x;
    rocks = []; stars = []; score = 0; lives = 3; t = 0; spawnT = 0; starT = 0; shake = 0;
    bg = Array.from({ length: 60 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.random() * 2 + .5 }));
  }

  function setTarget(e) { target = e.clientX; }
  cv.addEventListener('pointerdown', e => { setTarget(e); cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') setTarget(e); });

  function vibrate(ms) { if (navigator.vibrate) navigator.vibrate(ms); }

  function start() {
    reset(); running = true; last = performance.now();
    overlay.classList.add('hidden');
    requestAnimationFrame(loop);
  }
  function over() {
    running = false;
    if (score > best) { best = score; try { localStorage.setItem('sd_best', best); } catch (e) {} }
    msg.textContent = 'Game over! Score: ' + score;
    showBest(); playBtn.textContent = 'Play again';
    overlay.classList.remove('hidden');
  }
  playBtn.addEventListener('click', start);

  function update(dt) {
    t += dt;
    const diff = 1 + t / 20;
    player.x += (target - player.x) * Math.min(1, dt * 12);
    player.x = Math.max(player.r, Math.min(W - player.r, player.x));

    spawnT -= dt;
    if (spawnT <= 0) {
      spawnT = Math.max(.25, .8 / diff);
      const r = 14 + Math.random() * 20;
      rocks.push({ x: r + Math.random() * (W - 2 * r), y: -r, r, v: (120 + Math.random() * 80) * diff, rot: 0 });
    }
    starT -= dt;
    if (starT <= 0) {
      starT = 1.2 + Math.random();
      stars.push({ x: 20 + Math.random() * (W - 40), y: -20, r: 11, v: 140 * diff });
    }
    for (const b of bg) { b.y += b.s * 40 * dt; if (b.y > H) { b.y = 0; b.x = Math.random() * W; } }
    for (const r of rocks) { r.y += r.v * dt; r.rot += dt; }
    for (const s of stars) s.y += s.v * dt;

    rocks = rocks.filter(r => {
      if (Math.hypot(r.x - player.x, r.y - player.y) < r.r + player.r - 4) {
        lives--; shake = .3; vibrate(80); if (lives <= 0) over(); return false;
      }
      return r.y < H + r.r;
    });
    stars = stars.filter(s => {
      if (Math.hypot(s.x - player.x, s.y - player.y) < s.r + player.r) { score += 10; vibrate(15); return false; }
      return s.y < H + s.r;
    });
    shake = Math.max(0, shake - dt);
  }

  function star(x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot + i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * .45 : r;
      ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
  }

  function draw() {
    ctx.fillStyle = '#0b1020'; ctx.fillRect(0, 0, W, H);
    ctx.save();
    if (shake) ctx.translate((Math.random() - .5) * 10, (Math.random() - .5) * 10);
    ctx.fillStyle = '#fff';
    for (const b of bg) ctx.fillRect(b.x, b.y, b.s, b.s);
    ctx.fillStyle = '#ffd23f';
    for (const s of stars) star(s.x, s.y, s.r, t * 2);
    ctx.fillStyle = '#8a7f72';
    for (const r of rocks) {
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 7); ctx.fill();
      ctx.fillStyle = '#6b6258'; ctx.beginPath();
      ctx.arc(r.x + Math.cos(r.rot) * r.r * .3, r.y + Math.sin(r.rot) * r.r * .3, r.r * .3, 0, 7); ctx.fill();
      ctx.fillStyle = '#8a7f72';
    }
    // ship
    ctx.fillStyle = '#4de1ff';
    ctx.beginPath();
    ctx.moveTo(player.x, player.y - player.r);
    ctx.lineTo(player.x + player.r, player.y + player.r);
    ctx.lineTo(player.x, player.y + player.r * .5);
    ctx.lineTo(player.x - player.r, player.y + player.r);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff'; ctx.font = '700 22px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('Score ' + score, 16, 36 + (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0));
    ctx.textAlign = 'right'; ctx.fillText('♥'.repeat(Math.max(lives, 0)), W - 16, 36);
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    update(dt); draw();
    if (running) requestAnimationFrame(loop);
  }

  reset(); draw();
})();
