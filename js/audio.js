/* audio.js -- little synthesized sounds (WebAudio, no files). SFX.play(name). Off in Options. */
(function () {
  'use strict';
  let ctx = null, master = null;
  const ac = () => {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination); } catch (e) { return null; } }
    if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
    return ctx;
  };
  function tone(f, t0, dur, o = {}) {
    const c = ctx, osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(f, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    const v = o.vol == null ? 0.5 : o.vol;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + (o.a || 0.008)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master); osc.start(t0); osc.stop(t0 + dur + 0.02);
  }
  const SOUNDS = {
    key: t => tone(520 + Math.random() * 60, t, 0.05, { type: 'triangle', vol: 0.18 }),
    del: t => tone(300, t, 0.06, { type: 'triangle', vol: 0.15 }),
    flip0: t => tone(220, t, 0.09, { type: 'triangle', vol: 0.2 }),
    flip1: t => tone(440, t, 0.1, { type: 'triangle', vol: 0.25 }),
    flip2: t => tone(660, t, 0.12, { type: 'triangle', vol: 0.3 }),
    bad: t => { tone(180, t, 0.12, { type: 'square', vol: 0.12 }); tone(150, t + 0.08, 0.14, { type: 'square', vol: 0.12 }); },
    win: t => [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.09, 0.25, { type: 'triangle', vol: 0.32 })),
    lose: t => [392, 330, 262].forEach((f, i) => tone(f, t + i * 0.14, 0.3, { type: 'sine', vol: 0.3 })),
    ok: t => tone(700, t, 0.07, { type: 'sine', vol: 0.25 }),
    back: t => tone(420, t, 0.07, { type: 'sine', vol: 0.2, to: 300 }),
    ping: t => { tone(880, t, 0.12, { type: 'sine', vol: 0.3 }); tone(1320, t + 0.08, 0.18, { type: 'sine', vol: 0.25 }); },
    msg: t => { tone(988, t, 0.09, { type: 'sine', vol: 0.25 }); tone(1319, t + 0.07, 0.14, { type: 'sine', vol: 0.22 }); },
    level: t => [523, 784, 1047, 1568].forEach((f, i) => tone(f, t + i * 0.07, 0.3, { type: 'triangle', vol: 0.3 })),
    tick: t => tone(1200, t, 0.03, { type: 'square', vol: 0.06 }),
    go: t => tone(880, t, 0.25, { type: 'triangle', vol: 0.35 }),
    solve: t => [784, 1047].forEach((f, i) => tone(f, t + i * 0.08, 0.2, { type: 'triangle', vol: 0.3 })),
  };
  window.SFX = {
    ctx: () => ac(),            // (shared with the music)
    play(name) {
      if (window.Auth && Auth.user && !Auth.prefs.sound) return;
      const c = ac(); if (!c || !SOUNDS[name]) return;
      try { SOUNDS[name](c.currentTime + 0.005); } catch (e) { /* fine */ }
    },
  };
})();
