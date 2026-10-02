/* Tiny synthesized sound effects (WebAudio) — no audio files. */
(() => {
  'use strict';
  let ctx = null, muted = false;
  try { muted = localStorage.getItem('ws90_mute') === '1'; } catch (e) {}

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    return ctx;
  }
  function tone(freq, dur, type = 'square', vol = .08, delay = 0, slideTo = null) {
    const c = ensure(); if (!c || muted) return;
    const t0 = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + .01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + .02);
  }
  const N = { C5: 523, E5: 659, G5: 784, C6: 1047, E6: 1319, A4: 440, F4: 349, D4: 294, C4: 262, G4: 392 };
  const SOUNDS = {
    tap: () => tone(700, .04, 'square', .04),
    fill: () => tone(980, .05, 'square', .05),
    bell: () => { tone(1568, .5, 'sine', .09); tone(2093, .6, 'sine', .06, .02); },
    shout: () => tone(180 + Math.random() * 60, .04, 'sawtooth', .02),
    week: () => tone(300, .03, 'triangle', .05),
    buy: () => { tone(N.E6, .07, 'square', .06); tone(N.C6 * 1.5, .16, 'square', .06, .07); },       // cha-ching
    sell: () => { tone(N.C6, .07, 'square', .06); tone(N.G5, .07, 'square', .06, .07); tone(N.C6, .14, 'square', .06, .14); },
    error: () => tone(160, .18, 'sawtooth', .07, 0, 90),
    news: () => { tone(N.G5, .08, 'triangle', .08); tone(N.G5, .08, 'triangle', .08, .12); tone(N.C6, .18, 'triangle', .08, .24); },
    alarm: () => { for (let i = 0; i < 3; i++) { tone(880, .12, 'sawtooth', .07, i * .22); tone(660, .1, 'sawtooth', .07, i * .22 + .11); } },
    ach: () => [N.C5, N.E5, N.G5, N.C6, N.E6].forEach((f, i) => tone(f, .12, 'triangle', .08, i * .07)),
    win: () => [N.C5, N.E5, N.G5, N.C6, N.G5, N.C6, N.E6].forEach((f, i) => tone(f, .2, 'square', .07, i * .12)),
    lose: () => [N.G4, N.F4, N.D4, N.C4].forEach((f, i) => tone(f, .35, 'sawtooth', .07, i * .32, f * .93)),  // sad trombone
    sneaky: () => { tone(220, .2, 'sine', .08); tone(233, .3, 'sine', .08, .22); },
  };
  // ambient pit roar: looped band-passed noise whose loudness follows pit activity
  let roar = null;
  function roarStart() {
    const c = ensure(); if (!c || roar) return;
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    let b = 0; for (let i = 0; i < len; i++) { b = 0.97 * b + (Math.random() * 2 - 1) * 0.3; d[i] = b; } // brownish noise
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 0.6;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(bp).connect(g).connect(c.destination); src.start();
    roar = { src, g, bp };
  }
  function roarLevel(x) {
    if (!roar || !ctx) return;
    const v = muted ? 0 : Math.max(0, Math.min(1, x)) * 0.07;
    roar.g.gain.setTargetAtTime(v, ctx.currentTime, 0.25);
    roar.bp.frequency.setTargetAtTime(500 + 700 * Math.max(0, Math.min(1, x)), ctx.currentTime, 0.4);
  }
  function roarStop() { if (!roar) return; const r = roar; roar = null; try { r.g.gain.setTargetAtTime(0, ctx.currentTime, 0.1); setTimeout(() => { try { r.src.stop(); } catch (e) {} }, 400); } catch (e) {} }
  window.Sfx = {
    roarStart, roarLevel, roarStop,
    play(name) { try { (SOUNDS[name] || (() => {}))(); } catch (e) {} },
    unlock() { ensure(); },
    get muted() { return muted; },
    toggle() { muted = !muted; try { localStorage.setItem('ws90_mute', muted ? '1' : '0'); } catch (e) {} if (!muted) SOUNDS.tap(); return muted; },
  };
  document.addEventListener('pointerdown', () => ensure(), { once: true });
})();
