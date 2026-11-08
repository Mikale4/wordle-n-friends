/* ============================================================================
   music.js -- the soundtrack, composed here and played by a small WebAudio
   sequencer (no audio files, so nothing to license and nothing to download).

   SIX TRACKS, picked by the screen you're on:
     title   bright and bouncy (title, log in)            C major, 118 BPM
     menu    lo-fi jazz with a little vinyl crackle (hub,  F major,  80 BPM
             friends, messages, stats, options, leaderboard)
     lobby   funky and social (online lobby and rooms)     G major, 108 BPM
     think   calm piano and bells (Daily, Classic, Quad,   D major,  86 BPM
             Survival)
     race    driving chiptune (Blitz, VS CPU, online       A minor, 136 BPM
             races); speeds up with extra hats when the clock runs low
     ranked  darker and heavier (ranked matches)           E minor, 126 BPM
   Tracks cross-fade as you move between screens, duck under results, and go
   quiet when the tab is hidden. MUSIC volume is in Options.

   SOUNDTRACKS FROM FILES: music/tracks.json lists sets of recorded tracks
   (made with ElevenLabs and Suno); players pick one, or the composed one, in
   Options → SOUNDTRACK. A set's track replaces the composed track of the same
   name and loops between loopStart and loopEnd:
     { "default": "elevenlabs", "sets": { "elevenlabs": { "label": "ElevenLabs",
       "credit": "...", "tracks": { "race": { "file": "elevenlabs/race.mp3",
       "loopStart": 0.5, "loopEnd": 56.98, "gain": 0.58 }, ... } } } }
   A plain { "menu": "menu.mp3", ... } map also works (one set). See
   music/README.md, and tools/loopify.py to turn a song into a loop.

   A track is written as sections; each bar has a chord ("C", "Am7", or two
   per bar: "C7sus4 C7"), a melody of eight 8th notes ("e5 . g5 - ..."; "-"
   holds, "." rests), and patterns the section repeats every bar: bass on
   8ths (chord degrees 1 3 5 7 8), drums on 16ths (X accent, x hit, o soft),
   keyboard hits, arpeggios (chord-tone numbers) and a pad.
   ========================================================================== */
(function () {
  'use strict';
  let ctx = null, master = null, verb = null, noise = null;
  let cur = null, want = null, pending = null, urgent = false, ducked = false, files = null, unlocked = false;
  let sets = null, setId = 'composed', gen = 0;          // soundtracks from music/tracks.json; which one is on
  let vol = U.read('wnf.music', 0.6); if (typeof vol !== 'number' || !(vol >= 0 && vol <= 1)) vol = 0.6;
  const level = () => vol * 0.55 * (ducked ? 0.3 : 1);

  /* --------------------------------------------------------------- notes and chords */
  const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const midi = s => { const m = /^([a-g])(#|b)?(\d)$/.exec(s || ''); return m ? 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) : null; };
  const hz = n => 440 * Math.pow(2, (n - 69) / 12);
  const QUAL = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14], '9': [0, 4, 7, 10, 14],
    add9: [0, 4, 7, 14], sus2: [0, 2, 7], sus4: [0, 5, 7], '7sus4': [0, 5, 7, 10], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], dim: [0, 3, 6] };
  function chord(name) {
    const m = /^([A-G])(#|b)?(.*)$/.exec(name), iv = m && QUAL[m[3]];
    if (!iv) throw new Error('music: unknown chord ' + name);
    const pc = (NOTE[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
    const root = 53 + ((pc - 5 + 12) % 12);                      // voiced from F3 up to E4
    return { tones: iv.map(i => root + i) };
  }

  /* --------------------------------------------------------------- the tracks */
  const TRACKS = {
    title: { bpm: 118, swing: 0.04, form: ['A', 'A', 'B', 'A'], sec: {
      A: { chords: ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G'],
        mel: ['e5 . g5 . c6 - b5 g5', 'd5 . g5 . b5 - a5 g5', 'c5 . e5 . a5 - g5 e5', 'f5 - a5 - c6 - a5 .', 'e5 g5 c6 e6 d6 - c6 .', 'b5 - g5 - d5 - g5 .', 'a5 . c6 . a5 . f5 .', 'g5 - - - . . . .'],
        bass: '1 . . 1 5 . 8 .', keys: '....x.......x...', keysI: 'stab',
        drums: { k: 'x.....x.x.......', s: '....x.......x...', h: '..x...x...x...x.', sh: 'oooooooooooooooo' } },
      B: { chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'Dm7', 'G7'], melI: 'bell',
        mel: ['a5 - - - e5 - - -', 'f5 - - - c6 - a5 -', 'g5 - - - e5 - c5 -', 'd5 - g5 - b5 - - -', 'c6 - b5 - a5 - e5 -', 'f5 - a5 - c6 - d6 -', 'c6 - a5 - f5 - d5 -', 'g5 - - - b5 - d6 -'],
        bass: '1 - - - 5 - 1 .', arp: '0 . 1 . 2 . 4 . 2 . 1 . 2 . 4 .', arpI: 'mallet', arpV: 0.45, pad: true,
        drums: { k: 'x.......x.......', s: '....x.......x...', h: '..x...x...x...x.' } } } },

    menu: { bpm: 80, swing: 0.2, crackle: true, form: ['A', 'B'], mix: { k: 0.7 }, sec: {
      A: { chords: ['Bbmaj7', 'Am7', 'Gm9', 'C7sus4 C7', 'Fmaj7', 'Dm9', 'Gm7', 'C9'], melI: 'piano',
        mel: ['d6 - c6 - a5 - . .', 'g5 - e5 - c5 - . .', '. . f5 - a5 - d6 -', 'c6 - - - bb5 - . .', 'a5 - c6 - e6 - c6 -', 'd6 - - - a5 - f5 -', 'g5 - bb5 - d6 - f6 -', 'e6 - - - . . . .'],
        bass: '1 - - . . 5 1 -', bassI: 'sub', keys: 'x.........x.....', keysLen: 7,
        drums: { k: 'x......x..x.....', rim: '....x.......x...', h: '..o...o...o...o.' } },
      B: { chords: ['Bbmaj7', 'Am7', 'Gm9', 'C7sus4 C7', 'Fmaj7', 'Dm9', 'Gm7', 'C9'], melI: 'piano',
        mel: ['f5 - - - . . . .', '. . e5 - g5 - c6 -', 'bb5 - a5 - f5 - . .', 'e5 - - - g5 - bb5 -', 'a5 - - - . . . .', '. . f5 - a5 - c6 -', 'd6 - - - bb5 - a5 -', 'g5 - - - e5 - - -'],
        bass: '1 - - . . 5 1 -', bassI: 'sub', keys: 'x.........x.....', keysLen: 7,
        drums: { k: 'x......x..x.....', rim: '....x.......x...', h: '..o...o...o...o.' } } } },

    lobby: { bpm: 108, swing: 0.1, form: ['A', 'B', 'A', 'B'], sec: {
      A: { chords: ['Gmaj7', 'Em7', 'Cmaj7', 'D7sus4 D7', 'Gmaj7', 'Em7', 'Am7', 'D7'], melI: 'lead',
        mel: ['b5 . d6 . b5 a5 g5 .', 'e5 . g5 . b5 - . .', 'c6 . e6 . d6 c6 b5 .', 'a5 - - - . . f#5 a5', 'b5 . d6 . g6 - e6 d6', 'e6 - d6 - b5 - g5 .', 'a5 . c6 . e6 - d6 c6', 'd6 - - - . . . .'],
        bass: '1 . 1 8 . 5 . 1', keys: '..x...x..x...x..', keysI: 'stab',
        drums: { k: 'x.....x...x.....', s: '....x.......x...', c: '....o.......o...', h: 'x.o.x.o.x.o.x.o.', oh: '..............x.' } },
      B: { chords: ['Am7', 'Bm7', 'Cmaj7', 'D7', 'Am7', 'Bm7', 'Cmaj7', 'D7sus4 D7'],
        bass: '1 . 1 8 . 5 . 1', arp: '0 . 2 . 1 . 3 . 2 . 4 . 3 . 1 .', arpI: 'bell', arpV: 0.8, pad: true, keys: '..x.......x.....', keysI: 'stab',
        drums: { k: 'x.....x...x.....', s: '....x.......x...', h: 'x.o.x.o.x.o.x.o.' } } } },

    think: { bpm: 86, form: ['A', 'B', 'A', 'B'], sec: {
      A: { chords: ['Dmaj7', 'Bm7', 'Gmaj7', 'A6', 'Dmaj7', 'F#m7', 'Gmaj7', 'Asus4 A'],
        arp: '0 . 2 . 4 . 3 . 1 . 2 . 4 . 2 .', arpI: 'piano', arpOct: 0, arpV: 0.55, pad: true, bass: '1 - - - 5 - - -', bassI: 'sub',
        drums: { sh: '..o...o...o...o.' } },
      B: { chords: ['Gmaj7', 'A', 'F#m7', 'Bm7', 'Em9', 'Gmaj7', 'Asus4', 'A7'], melI: 'bell',
        mel: ['b5 - - - a5 - - -', 'c#6 - - - e6 - - -', 'a5 - - - c#6 - - -', 'd6 - - - f#5 - - -', 'f#6 - - - e6 - d6 -', 'd6 - - - b5 - - -', 'a5 - - - d6 - - -', 'c#6 - - - e6 - g6 -'],
        arp: '0 . 2 . 4 . 3 . 1 . 2 . 4 . 2 .', arpI: 'piano', arpOct: 0, arpV: 0.5, pad: true, bass: '1 - - - 5 - - -', bassI: 'sub',
        drums: { k: 'o...............', sh: '..o...o...o...o.' } } } },

    race: { bpm: 136, urgent: 1.1, form: ['A', 'A', 'B', 'A'], sec: {
      A: { chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'Dm', 'E7'], melI: 'lead',
        mel: ['a5 . c6 . e6 . d6 c6', 'a5 - - . f5 . a5 .', 'g5 . c6 . e6 . g6 e6', 'd6 - - . b5 . g5 .', 'a5 . c6 . e6 . a6 g6', 'f6 - e6 - c6 - a5 .', 'd6 . f6 . a6 . f6 d6', 'e6 - - - g#5 - b5 -'],
        bass: '1 8 1 8 1 8 1 8', arp: '0 1 2 4 2 1 0 1 2 4 5 4 2 1 2 4',
        drums: { k: 'x...x...x...x...', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' } },
      B: { chords: ['F', 'G', 'Em', 'Am', 'F', 'G', 'Esus4', 'E'], melI: 'bell',
        mel: ['c6 - - - a5 - - -', 'b5 - - - d6 - - -', 'e6 - - - b5 - - -', 'c6 - - - e6 - - -', 'f6 - - - c6 - - -', 'd6 - - - b5 - - -', 'a5 - - - b5 - - -', 'g#5 - - - b5 - e6 -'],
        bass: '1 8 1 8 1 8 1 8', arp: '0 1 2 4 2 1 0 1 2 4 5 4 2 1 2 4', arpV: 1.4, pad: true,
        drums: { k: 'x...x...x...x...', s: '....x.......x...', h: '..x...x...x...x.' } } } },

    ranked: { bpm: 126, urgent: 1.08, form: ['A', 'B', 'A', 'B'], sec: {
      A: { chords: ['Em', 'C', 'D', 'Bm', 'Em', 'C', 'Am', 'B7'], melI: 'lead',
        mel: ['e5 - - - g5 - b5 -', 'c6 - - - b5 - g5 -', 'a5 - - - f#5 - d5 -', 'f#5 - - - . . . .', 'e5 - g5 - b5 - e6 -', 'e6 - d6 - c6 - g5 -', 'a5 - c6 - e6 - c6 -', 'b5 - - - d#6 - f#6 -'],
        bass: '1 . 1 1 . 1 5 .', pad: true,
        drums: { k: 'x..x..x...x..x..', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' } },
      B: { chords: ['C', 'D', 'Em', 'Em', 'C', 'D', 'B7', 'B7'],
        bass: '1 . 1 1 . 1 5 .', arp: '0 1 2 3 2 1 0 1 2 3 4 3 2 1 0 1', arpV: 1.3, pad: true,
        drums: { k: 'x.......x.......', s: '........x.......', h: 'x.x.x.x.x.x.x.x.' } } } },
  };

  /* --------------------------------------------------------------- compiling a track to steps */
  const compiled = {};
  function compile(T) {
    const bars = [];
    for (const s of T.form) { const S = T.sec[s]; S.chords.forEach((c, i) => bars.push({ S, ch: c.split(' ').map(chord), mel: S.mel ? S.mel[i].split(' ') : null })); }
    const total = bars.length * 16, ev = Array.from({ length: total }, () => []);
    bars.forEach((b, bi) => {
      const base = bi * 16, S = b.S, chAt = p => b.ch[b.ch.length > 1 && p >= 8 ? 1 : 0];
      for (const lane in S.drums || {}) [...S.drums[lane]].forEach((c, p) => { const v = c === 'X' ? 1 : c === 'x' ? 0.75 : c === 'o' ? 0.4 : 0; if (v) ev[base + p].push({ i: lane, v }); });
      if (S.bass) {
        const tk = S.bass.split(' ');
        tk.forEach((x, j) => {
          if (!/^[13578]$/.test(x)) return;
          let l = 1; while (tk[j + l] === '-') l++;
          const tn = chAt(j * 2).tones, n = x === '1' ? tn[0] : x === '3' ? tn[1] : x === '5' ? tn[2] : x === '7' ? (tn[3] != null ? tn[3] : tn[0] + 12) : tn[0] + 12;
          ev[base + j * 2].push({ i: S.bassI || 'pluck', n: n - 12, len: l * 2, v: 1 });
        });
      }
      if (S.keys) [...S.keys].forEach((x, p) => { if (x === 'x' || x === 'X') ev[base + p].push({ i: S.keysI || 'keys', ns: chAt(p).tones, len: S.keysLen || 2, v: x === 'X' ? 1 : 0.8 }); });
      if (S.arp) S.arp.split(' ').forEach((x, p) => {
        if (!/^\d$/.test(x)) return;
        const tn = chAt(p).tones, ext = [...tn, ...tn.map(n => n + 12), ...tn.map(n => n + 24)];
        ev[base + p].push({ i: S.arpI || 'arp', n: ext[+x] + (S.arpOct == null ? 12 : S.arpOct), len: 2, v: S.arpV || 1 });
      });
      if (S.pad) b.ch.forEach((c, k) => ev[base + k * (16 / b.ch.length)].push({ i: 'pad', ns: c.tones, len: 16 / b.ch.length, v: 1 }));
    });
    // the melody, read across bar lines so a held note can tie over
    const toks = []; bars.forEach(b => { for (let j = 0; j < 8; j++) toks.push(b.mel ? b.mel[j] || '.' : '.'); });
    toks.forEach((x, j) => {
      const n = midi(x); if (n == null) return;
      let l = 1; while (l < toks.length && toks[(j + l) % toks.length] === '-') l++;
      const S = bars[Math.floor(j / 8)].S;
      ev[j * 2].push({ i: S.melI || 'mallet', n, len: l * 2, v: 1 });
    });
    return { ev, total };
  }

  /* --------------------------------------------------------------- instruments */
  const GAIN = { mallet: 0.3, keys: 0.1, stab: 0.09, piano: 0.2, bell: 0.12, lead: 0.085, arp: 0.045, pluck: 0.26, sub: 0.34, pad: 0.03,
    k: 0.8, s: 0.3, rim: 0.2, h: 0.09, oh: 0.08, c: 0.25, sh: 0.07, crk: 1 };
  const SEND = { mallet: 0.25, keys: 0.3, stab: 0.2, piano: 0.35, bell: 0.5, lead: 0.22, arp: 0.18, pad: 0.45, s: 0.15, c: 0.2, rim: 0.12 };
  function voice(P, i) { const g = ctx.createGain(); g.connect(P.dry); const s = SEND[i]; if (s) { const w = ctx.createGain(); w.gain.value = s; g.connect(w); w.connect(P.wet); } return g; }
  function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  function osc(type, f, t, end, to) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(end); o.connect(to); return o; }
  function partial(type, f, t, a, peak, dec, to) { const g = ctx.createGain(); env(g, t, a, peak, dec); g.connect(to); osc(type, f, t, t + a + dec + 0.05, g); }
  function noiseSrc(t, dur, to) { const s = ctx.createBufferSource(); s.buffer = noise; s.connect(to); s.start(t, Math.random() * 0.5); s.stop(t + dur); return s; }
  function filt(type, f, q, to) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; b.connect(to); return b; }
  const INST = {
    mallet(P, t, e, len, v) { const f = hz(e.n), g = voice(P, 'mallet'); partial('sine', f, t, 0.002, v, Math.min(1.1, 0.35 + len), g); partial('sine', f * 4, t, 0.002, v * 0.22, 0.07, g); },
    bell(P, t, e, len, v) { const f = hz(e.n), g = voice(P, 'bell'); partial('sine', f, t, 0.002, v, Math.max(1.2, len + 0.4), g); partial('sine', f * 2.76, t, 0.002, v * 0.3, 0.5, g); partial('sine', f * 5.4, t, 0.002, v * 0.1, 0.2, g); },
    piano(P, t, e, len, v) { const f = hz(e.n), g = voice(P, 'piano'), lp = filt('lowpass', 2600, 0, g); partial('triangle', f, t, 0.004, v, Math.max(0.9, len + 0.5), lp); partial('sine', f * 2, t, 0.004, v * 0.3, 0.6, lp); partial('sine', f * 3, t, 0.003, v * 0.08, 0.25, lp); },
    keys(P, t, e, len, v) { const g = voice(P, 'keys'); for (const n of e.ns) { const f = hz(n); partial('sine', f, t, 0.012, v, len + 0.5, g); partial('sine', f * 2, t, 0.008, v * 0.25, 0.4, g); partial('triangle', f * 1.003, t, 0.012, v * 0.2, len + 0.3, g); } },
    stab(P, t, e, len, v) { const g = voice(P, 'stab'); for (const n of e.ns) { const f = hz(n); partial('sine', f, t, 0.005, v, 0.2, g); partial('triangle', f * 2, t, 0.003, v * 0.3, 0.09, g); } },
    lead(P, t, e, len, v) {
      const f = hz(e.n), g = voice(P, 'lead'), lp = filt('lowpass', 2400, 1, g), o = osc('square', f, t, t + len + 0.2, lp);
      const hold = Math.max(t + 0.06, t + len - 0.02);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(v * 0.6, Math.min(hold, t + 0.15)); g.gain.setValueAtTime(v * 0.6, hold); g.gain.exponentialRampToValueAtTime(0.0001, hold + 0.12);
      if (len > 0.3) { const l = ctx.createOscillator(), d = ctx.createGain(); l.frequency.value = 5.5; d.gain.setValueAtTime(0, t); d.gain.linearRampToValueAtTime(9, t + 0.3); l.connect(d); d.connect(o.detune); l.start(t); l.stop(t + len + 0.2); }
    },
    arp(P, t, e, len, v) { const g = voice(P, 'arp'), lp = filt('lowpass', 1700, 0, g); partial('square', hz(e.n), t, 0.003, v, 0.13, lp); },
    pluck(P, t, e, len, v) {
      const g = voice(P, 'pluck'), lp = filt('lowpass', 1500, 7, g);
      lp.frequency.setValueAtTime(1500, t); lp.frequency.exponentialRampToValueAtTime(180, t + 0.2);
      env(g, t, 0.004, v, Math.min(0.6, len + 0.08)); osc('sawtooth', hz(e.n), t, t + Math.min(0.7, len + 0.15), lp);
    },
    sub(P, t, e, len, v) { const g = voice(P, 'sub'); env(g, t, 0.015, v, len + 0.05); osc('triangle', hz(e.n), t, t + len + 0.1, g); },
    pad(P, t, e, len, v) {
      const g = voice(P, 'pad'), lp = filt('lowpass', 900, 0, g);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.4); g.gain.setValueAtTime(v, t + Math.max(0.41, len)); g.gain.linearRampToValueAtTime(0.0001, t + len + 0.6);
      for (const n of e.ns) for (const d of [-9, 9]) { const o = osc('sawtooth', hz(n), t, t + len + 0.7, lp); o.detune.value = d; }
    },
    k(P, t, e, len, v) { const g = voice(P, 'k'), o = osc('sine', 150, t, t + 0.4, g); o.frequency.exponentialRampToValueAtTime(45, t + 0.12); env(g, t, 0.002, v, 0.32); },
    s(P, t, e, len, v) { const g = voice(P, 's'); env(g, t, 0.001, v, 0.16); noiseSrc(t, 0.2, filt('highpass', 900, 0, g)); partial('triangle', 190, t, 0.001, v * 0.5, 0.08, g); },
    rim(P, t, e, len, v) { const g = voice(P, 'rim'); env(g, t, 0.001, v, 0.04); osc('square', 1700, t, t + 0.06, filt('bandpass', 1700, 4, g)); },
    h(P, t, e, len, v) { const g = voice(P, 'h'); env(g, t, 0.001, v, 0.035); noiseSrc(t, 0.05, filt('highpass', 7500, 0, g)); },
    oh(P, t, e, len, v) { const g = voice(P, 'oh'); env(g, t, 0.002, v, 0.25); noiseSrc(t, 0.3, filt('highpass', 6500, 0, g)); },
    c(P, t, e, len, v) {
      const g = voice(P, 'c'); g.gain.setValueAtTime(0.0001, t);
      for (let k = 0; k < 3; k++) { g.gain.setValueAtTime(v, t + k * 0.012); g.gain.exponentialRampToValueAtTime(v * 0.25, t + k * 0.012 + 0.01); }
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); noiseSrc(t, 0.22, filt('bandpass', 1300, 1, g));
    },
    sh(P, t, e, len, v) { const g = voice(P, 'sh'); env(g, t, 0.006, v, 0.05); noiseSrc(t, 0.07, filt('bandpass', 7000, 2, g)); },
    crk(P, t, e, len, v) { const g = voice(P, 'crk'); env(g, t, 0.0005, v, 0.004); noiseSrc(t, 0.01, filt('highpass', 3000, 0, g)); },
  };
  function schedule(P, step, t, sd) {
    for (const e of P.ev[step]) {
      const m = P.T.mix && P.T.mix[e.i] != null ? P.T.mix[e.i] : 1;
      INST[e.i](P, t, e, e.len ? e.len * sd : 0, (GAIN[e.i] || 0.2) * m * (e.v || 1));
    }
    if (urgent && P.T.urgent) INST.h(P, t, {}, 0, GAIN.h * 0.55);
    if (P.T.crackle && Math.random() < 0.3) INST.crk(P, t + Math.random() * sd, {}, 0, 0.008 + Math.random() * 0.025);
  }

  /* --------------------------------------------------------------- players */
  function buses(dest, rev) {
    const P = { dry: ctx.createGain(), wet: ctx.createGain(), fade: ctx.createGain(), fadeW: ctx.createGain() };
    P.dry.connect(P.fade); P.wet.connect(P.fadeW); P.fade.connect(dest); P.fadeW.connect(rev);
    return P;
  }
  function fadeIn(P) { const t = ctx.currentTime; for (const g of [P.fade, P.fadeW]) { if (!g) continue; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + 1.2); } }
  function fadeOut(P) {
    P.dead = true; const t = ctx.currentTime;
    for (const g of [P.fade, P.fadeW]) { if (!g) continue; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 0.9); }
    setTimeout(() => { try { if (P.src) P.src.stop(); P.fade.disconnect(); if (P.fadeW) P.fadeW.disconnect(); } catch (e) { /* fine */ } }, 2500);
  }
  function startSynth(name) {
    const T = TRACKS[name], C = compiled[name] || (compiled[name] = compile(T));
    const P = Object.assign(buses(master, verb), { name, T, ev: C.ev, total: C.total, step: 0, next: ctx.currentTime + 0.08 });
    fadeIn(P); return P;
  }
  const bufs = {};
  async function startFile(name, spec) {
    const url = 'music/' + String(spec.file || spec), g0 = gen;
    if (!bufs[url]) { const r = await fetch(url); if (!r.ok) throw new Error('no file'); bufs[url] = await ctx.decodeAudioData(await r.arrayBuffer()); }
    if (g0 !== gen || want !== name || pending !== name) return null;
    const src = ctx.createBufferSource(), g = ctx.createGain(), P = { name, file: true, src, fade: ctx.createGain() };
    src.buffer = bufs[url]; src.loop = true;
    if (spec.loopStart) src.loopStart = +spec.loopStart; if (spec.loopEnd) src.loopEnd = +spec.loopEnd;
    src.playbackRate.value = fileRate(name);
    g.gain.value = spec.gain || 1; src.connect(g); g.connect(P.fade); P.fade.connect(master); src.start();
    fadeIn(P); return P;
  }
  /* a recorded race track can't add hi-hats when time runs low, so it plays a little faster (and higher) instead */
  const fileRate = name => (urgent && TRACKS[name].urgent ? 1 + (TRACKS[name].urgent - 1) * 0.6 : 1);
  /* tracks.json: { default, sets: { id: { label, credit, tracks } } }, or one plain map of tracks */
  function loadSets(j) {
    sets = {};
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      if (j.sets && typeof j.sets === 'object') {
        for (const [id, s] of Object.entries(j.sets)) if (id !== 'composed' && s && s.tracks && typeof s.tracks === 'object') sets[id] = { label: String(s.label || id), credit: s.credit ? String(s.credit) : '', tracks: s.tracks };
      } else if (Object.keys(j).length) sets.custom = { label: 'Your files', credit: '', tracks: j };
    }
    const saved = U.read('wnf.soundtrack', null), dflt = j && sets[j.default] ? j.default : (sets.custom ? 'custom' : 'composed');
    setId = saved === 'composed' || (saved && sets[saved]) ? saved : dflt;
    files = setId === 'composed' ? {} : sets[setId].tracks;
  }
  function tick() {
    const P = cur;
    if (!P || P.file || !ctx || ctx.state !== 'running') return;
    if (vol <= 0) { P.next = ctx.currentTime + 0.05; return; }
    if (P.next < ctx.currentTime - 0.25) P.next = ctx.currentTime + 0.05;          // (the page stalled: don't play the backlog)
    while (P.next < ctx.currentTime + 0.12) {
      const sd = 60 / (P.T.bpm * (urgent && P.T.urgent ? P.T.urgent : 1)) / 4, pos = P.step % 16;
      schedule(P, P.step, P.next + (pos % 4 === 2 ? (P.T.swing || 0) * sd : 0), sd);
      P.step = (P.step + 1) % P.total; P.next += sd;
    }
  }

  /* --------------------------------------------------------------- starting up (browsers need a click or key first) */
  function setup() {
    if (ctx) return true;
    ctx = SFX.ctx(); if (!ctx) return false;
    master = ctx.createGain(); master.gain.value = level();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    master.connect(comp); comp.connect(ctx.destination);
    verb = makeVerb(ctx); verb.connect(master);
    noise = makeNoise(ctx);
    setInterval(tick, 25);
    document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else ctx.resume(); });
    return true;
  }
  function makeNoise(c) { const b = c.createBuffer(1, c.sampleRate, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
  function makeVerb(c) {
    const n = Math.floor(c.sampleRate * 2.4), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
    const v = c.createConvolver(); v.buffer = b; return v;
  }
  function unlock() {
    if (unlocked) return; unlocked = true;
    window.removeEventListener('pointerdown', unlock, true); window.removeEventListener('keydown', unlock, true);
    if (!setup()) return;
    fetch('music/tracks.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : {})).catch(() => ({}))
      .then(j => { loadSets(j); if (want) Music.play(want); });
  }
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);

  const Music = window.Music = {
    TRACKS,
    get volume() { return vol; },
    get playing() { return cur && !cur.dead ? cur.name : null; },
    get source() { return cur && !cur.dead ? (cur.file ? 'file' : 'composed') : null; },
    /* the soundtracks a player can pick: [[id, label, credit], ...], composed first */
    get soundtracks() {
      return [['composed', 'Composed', 'Composed in code for the game.']].concat(Object.entries(sets || {}).map(([id, s]) => [id, s.label, s.credit]));
    },
    get soundtrack() { return setId; },
    setSoundtrack(id) {
      if (id !== 'composed' && !(sets && sets[id])) return;
      setId = id; U.write('wnf.soundtrack', id); files = id === 'composed' ? {} : sets[id].tracks;
      gen++; pending = null;
      const w = want; if (cur) fadeOut(cur); cur = null;
      if (w) Music.play(w);
    },
    play(name) {
      if (!TRACKS[name]) return;
      want = name;
      if (!ctx || files === null) return;
      if ((cur && cur.name === name) || pending === name) return;
      const old = cur; cur = null; if (old) fadeOut(old);
      const spec = files[name];
      if (spec) {
        pending = name; const g0 = gen;
        startFile(name, spec).then(P => { if (g0 !== gen) { if (P) fadeOut(P); return; } if (pending === name) pending = null; if (!P) return; if (want === name && !cur) cur = P; else fadeOut(P); })
          .catch(() => { if (g0 !== gen) return; if (pending === name) pending = null; if (want === name && !cur) cur = startSynth(name); });
      } else { pending = null; cur = startSynth(name); }
    },
    stop() { want = null; if (cur) fadeOut(cur); cur = null; },
    /* the right track for a screen, from its class */
    forScreen(cls) {
      if (!cls) return;
      Music.urgent(false); Music.duck(false);
      const t = /\b(title|login)\b/.test(cls) ? 'title'
        : /\bonline\b/.test(cls) ? (/\bgame\b/.test(cls) ? (/\branked\b/.test(cls) ? 'ranked' : 'race') : 'lobby')
          : /\bplay\b/.test(cls) ? (/mode-(blitz|cpu)\b/.test(cls) ? 'race' : 'think') : 'menu';
      Music.play(t);
    },
    urgent(on) {
      if (urgent === !!on) return; urgent = !!on;
      if (cur && cur.file && !cur.dead) cur.src.playbackRate.setTargetAtTime(fileRate(cur.name), ctx.currentTime, 0.4);
    },
    duck(on) { if (ducked === !!on) return; ducked = !!on; if (master) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.25); },
    setVolume(v) { vol = U.clamp(+v || 0, 0, 1); U.write('wnf.music', vol); if (master) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.1); },

    /* for checking the mix: render a track offline and measure it */
    async _render(name, seconds) {
      const T = TRACKS[name], C = compiled[name] || (compiled[name] = compile(T)), sr = 44100;
      const off = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
      const saved = { ctx, noise };
      ctx = off; noise = makeNoise(off);
      try {
        const m = off.createGain(); m.gain.value = 0.6 * 0.55; m.connect(off.destination);
        const rv = makeVerb(off); rv.connect(m);
        const P = Object.assign(buses(m, rv), { T, ev: C.ev });
        let t = 0.02, step = 0; const sd = 60 / T.bpm / 4;
        while (t < seconds - 0.5) { schedule(P, step, t + ((step % 16) % 4 === 2 ? (T.swing || 0) * sd : 0), sd); step = (step + 1) % C.total; t += sd; }
      } finally { ctx = saved.ctx; noise = saved.noise; }
      const buf = await off.startRendering(), d = buf.getChannelData(0);
      let peak = 0, sum = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; }
      return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(4), loopSec: +(C.total * 60 / T.bpm / 4).toFixed(1) };
    },
  };
})();
