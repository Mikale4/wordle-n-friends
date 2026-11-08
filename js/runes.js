/* ============================================================================
   runes.js -- RUNECASTERS: trace words through a 5x5 grid of runes.

   THE RULES
     A match is 3, 5 or 7 rounds; in each round every player takes one turn, in
     seat order. A turn is a CAST: a path through touching tiles (8 directions),
     each tile at most once, spelling a word of 3+ letters. The Q tile reads QU.
     Score = the letters' values (a x2 or x3 letter rune multiplies its tile),
     doubled if the path crosses the x2 word rune (from round 2 on), plus a length
     bonus: 6 letters +3, 7 letters +6, 8 or more +10.
     The used tiles get new letters. A rune that was used moves to another tile,
     and all of them are placed afresh each round.
     Mana: everyone starts with 3 (at most 10); 4-6 tiles carry a mana crystal,
     worth 1 mana to whoever casts through it. Before casting you may spend it:
       Reshuffle  1   rearrange every letter (runes and crystals stay put)
       Transmute  2   turn one tile into any letter (as often as you can pay)
       Scry       3   shows you, and only you, one of the best words on the board
     Passing scores 0; so does running out of time.

   MOVES  { cast: [cell, ...] }  cells 0-24, row by row
          { act: 'shuffle' }  { act: 'transmute', cell, letter }  { act: 'scry' }
          { pass: true }
   VIEW   { n, round, rounds, turn, over, left, lim,
            grid: { L, v, x2, x3, w2, mana }, players: [{ id, name, score, mana, best }],
            last, ev, hint? }
     L    the 25 letters, row by row ('q' is the QU tile); v their values
     x2 x3 w2    the cells holding the runes (w2 -1 in round 1); mana: crystal cells
     last the last turn: { p, w, path, pts, mana } a cast, { p, pass: 1 } a pass,
          { p, pass: 1, late: 1 } out of time
     ev   the newest action of any kind { n, k: 'start'|'cast'|'pass'|'time'|'shuffle'|'transmute'|'scry', p, c }
     hint the scried word { path, w, pts }, in the scrier's view only
     left ms left this turn (null without a limit), lim the whole turn's ms
   ========================================================================== */
(function () {
  'use strict';
  const G = typeof window !== 'undefined' ? window : self;

  /* ---------------------------------------------------------------- numbers */
  const SIDE = 5, CELLS = 25;
  /* Letter values: 1 + 1.25 * log2(f(E) / f(letter)), rounded, where f is how often the letter turns up in the
     dictionary's words of 3-9 letters (E 12.1% ... Q 0.19%). The Q tile keeps Q's value though it reads QU. */
  const VAL = { e: 1, s: 1, i: 2, r: 2, a: 2, n: 2, t: 2, o: 2, l: 2, d: 3, c: 3, u: 3, g: 3, p: 4, m: 4, h: 4, b: 4,
    y: 5, f: 5, k: 5, w: 5, v: 5, z: 7, x: 8, j: 8, q: 8 };
  /* How often a new tile gets each letter: the same frequencies (per 10,000 letters); Q's doubled, since its tile
     brings its own U and is far friendlier than a bare Q */
  const FREQ = { e: 1207, s: 929, i: 772, r: 737, a: 732, n: 617, t: 616, o: 583, l: 537, d: 440, c: 365, u: 348, g: 325,
    p: 291, m: 267, h: 234, b: 222, y: 164, f: 158, k: 124, w: 122, v: 101, z: 36, x: 29, j: 23, q: 38 };
  const bonus = len => len >= 8 ? 10 : len === 7 ? 6 : len === 6 ? 3 : 0;
  const COST = { shuffle: 1, transmute: 2, scry: 3 };
  const MANA0 = 3, MANA_MAX = 10, CRYS_MIN = 4, CRYS_MAX = 6;
  /* a playable board: 6-11 vowels of 25, at most two of the hard letters (and one of each), no letter four times */
  const VMIN = 6, VMAX = 11, RARE = 'jqxz', RARE_MAX = 2, DUP_MAX = 3;
  const GRACE = 1500;               // a move sent just before the buzzer may land just after it
  const VOW = { a: 1, e: 1, i: 1, o: 1, u: 1 };

  /* the eight neighbours of every cell */
  const NB = Array.from({ length: CELLS }, (_, i) => {
    const r = Math.floor(i / SIDE), c = i % SIDE, out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if ((dr || dc) && rr >= 0 && rr < SIDE && cc >= 0 && cc < SIDE) out.push(rr * SIDE + cc);
    }
    return out;
  });
  const adj = (a, b) => a !== b && Math.abs(Math.floor(a / SIDE) - Math.floor(b / SIDE)) <= 1 && Math.abs(a % SIDE - b % SIDE) <= 1;
  const ALL = Array.from({ length: CELLS }, (_, i) => i);

  /* ------------------------------------------------- randomness (in the state) */
  /* mulberry32, its seed kept in the state, so a match replays the same from the same seed (the tests rely on it) */
  function rnd(st) {
    const s = st.rs = (st.rs + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  const ri = (st, n) => Math.floor(rnd(st) * n);
  const mix = (st, a) => { for (let i = a.length - 1; i > 0; i--) { const j = ri(st, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const table = keep => { const ls = Object.keys(FREQ).filter(keep); let sum = 0; return { ls, cum: ls.map(l => (sum += FREQ[l])), sum }; };
  const T_ANY = table(() => true), T_VOW = table(l => VOW[l]), T_CON = table(l => !VOW[l]);
  function weighted(st, t) { const x = rnd(st) * t.sum; for (let i = 0; i < t.ls.length; i++) if (x < t.cum[i]) return t.ls[i]; return t.ls[t.ls.length - 1]; }

  /* new letters for the given cells, keeping the board playable (see VMIN...) */
  function refill(st, cells) {
    const L = st.grid.L.split(''), fill = new Set(cells), count = {};
    let nv = 0, rare = 0;
    for (let i = 0; i < CELLS; i++) if (!fill.has(i)) { const l = L[i]; count[l] = (count[l] || 0) + 1; if (VOW[l]) nv++; if (RARE.includes(l)) rare++; }
    cells.forEach((i, k) => {
      const mustV = VMIN - nv >= cells.length - k, noV = !mustV && nv >= VMAX;
      let l = null;
      for (let tries = 0; tries < 50 && !l; tries++) {
        const c = weighted(st, mustV ? T_VOW : noV ? T_CON : T_ANY);
        if ((count[c] || 0) >= DUP_MAX || (RARE.includes(c) && (rare >= RARE_MAX || count[c]))) continue;
        l = c;
      }
      if (!l) l = (mustV ? 'aeiou' : 'tnrsl').split('').find(c => (count[c] || 0) < DUP_MAX) || 'e';
      L[i] = l; count[l] = (count[l] || 0) + 1; if (VOW[l]) nv++; if (RARE.includes(l)) rare++;
    });
    st.grid.L = L.join('');
  }

  /* the runes: placed afresh each round (the word rune from round 2) */
  function placeRunes(st, round) {
    const c = mix(st, ALL.slice()), g = st.grid;
    g.x2 = c[0]; g.x3 = c[1]; g.w2 = round >= 2 ? c[2] : -1;
  }
  /* a rune that was cast through moves to a tile off the path, and off the other runes */
  function moveRunes(st, used) {
    const g = st.grid;
    for (const k of ['x2', 'x3', 'w2']) {
      if (g[k] < 0 || !used.includes(g[k])) continue;
      const free = ALL.filter(i => !used.includes(i) && i !== g.x2 && i !== g.x3 && i !== g.w2);
      g[k] = free.length ? free[ri(st, free.length)] : g[k];
    }
  }
  /* mana crystals: back up to 4-6 of them */
  function topUp(st) {
    const g = st.grid, want = CRYS_MIN + ri(st, CRYS_MAX - CRYS_MIN + 1);
    const free = mix(st, ALL.filter(i => !g.mana.includes(i)));
    while (g.mana.length < want && free.length) g.mana.push(free.pop());
    g.mana.sort((a, b) => a - b);
  }

  /* ---------------------------------------------------------------- words */
  const wordOf = (L, path) => path.map(i => L[i] === 'q' ? 'qu' : L[i]).join('');
  /* what a path scores on grid g ({ L, x2, x3, w2 }) */
  function points(g, path) {
    let sum = 0, len = 0, wm = 1;
    for (const i of path) {
      const l = g.L[i];
      sum += (VAL[l] || 0) * (i === g.x3 ? 3 : i === g.x2 ? 2 : 1);
      if (i === g.w2) wm = 2;
      len += l === 'q' ? 2 : 1;
    }
    return sum * wm + bonus(len);
  }
  /* is this a path on the board: { w } or { err } (the dictionary is checked by the caller) */
  function check(g, path) {
    if (!Array.isArray(path) || !path.length || path.length > CELLS) return { err: 'Trace a word of at least 3 letters.' };
    const seen = new Set();
    for (let k = 0; k < path.length; k++) {
      const i = path[k];
      if (!Number.isInteger(i) || i < 0 || i >= CELLS) return { err: 'That path leaves the board.' };
      if (seen.has(i)) return { err: 'Each tile can be used once per word.' };
      if (k && !adj(path[k - 1], i)) return { err: 'Each tile must touch the one before it.' };
      seen.add(i);
    }
    const w = wordOf(g.L, path);
    if (w.length < 3) return { err: 'Words need at least 3 letters.' };
    return { w };
  }

  /* every word on the board (its best path), best first: a walk of the dictionary graph from each cell, which
     stops as soon as no word starts with the letters so far */
  function find(g, root) {
    root = root || G.Lex.root;
    const L = g.L, best = new Map(), path = [], chars = [];
    const go = (i, node, mask, sum, wm, len) => {
      const l = L[i];
      let nd = node.k[l];
      if (nd && l === 'q') nd = nd.k.u;
      if (!nd) return;
      path.push(i); chars.push(l === 'q' ? 'qu' : l);
      sum += VAL[l] * (i === g.x3 ? 3 : i === g.x2 ? 2 : 1);
      if (i === g.w2) wm = 2;
      len += l === 'q' ? 2 : 1;
      mask |= 1 << i;
      if (nd.e && len >= 3) {
        const w = chars.join(''), pts = sum * wm + bonus(len), o = best.get(w);
        if (!o || pts > o.pts) best.set(w, { w, path: path.slice(), pts, len });
      }
      const nb = NB[i];
      for (let k = 0; k < nb.length; k++) if (!(mask & 1 << nb[k])) go(nb[k], nd, mask, sum, wm, len);
      path.pop(); chars.pop();
    };
    for (let i = 0; i < CELLS; i++) go(i, root, 0, 0, 1, 0);
    return [...best.values()].sort((a, b) => b.pts - a.pts || b.len - a.len || (a.w < b.w ? -1 : 1));
  }

  /* the best word one Transmute away, if it scores at least min: the same walk, but one tile on the path may
     stand for any letter the dictionary allows there. Capped, so a freak board can't stall the CPU */
  function bestTransmute(g, min) {
    const L = g.L, path = [];
    let best = null, steps = 0;
    const step = (i, l, node, mask, sum, wm, len, wc, wl) => {
      let nd = node.k[l];
      if (nd && l === 'q') nd = nd.k.u;
      if (!nd || ++steps > 3e6) return;
      sum += VAL[l] * (i === g.x3 ? 3 : i === g.x2 ? 2 : 1);
      if (i === g.w2) wm = 2;
      len += l === 'q' ? 2 : 1;
      mask |= 1 << i;
      path.push(i);
      if (nd.e && len >= 3 && wc >= 0) {
        const pts = sum * wm + bonus(len);
        if (pts >= min && (!best || pts > best.pts)) best = { cell: wc, letter: wl, pts, path: path.slice() };
      }
      const nb = NB[i];
      for (let k = 0; k < nb.length; k++) if (!(mask & 1 << nb[k])) go(nb[k], nd, mask, sum, wm, len, wc, wl);
      path.pop();
    };
    const go = (i, node, mask, sum, wm, len, wc, wl) => {
      step(i, L[i], node, mask, sum, wm, len, wc, wl);
      if (wc < 0) for (const c in node.k) if (c !== L[i] && VAL[c]) step(i, c, node, mask, sum, wm, len, i, c);
    };
    for (let i = 0; i < CELLS; i++) go(i, G.Lex.root, 0, 0, 1, 0, -1, '');
    if (best && !hasVowel(L.slice(0, best.cell) + best.letter + L.slice(best.cell + 1))) return null;
    return best;
  }
  const hasVowel = L => { for (let i = 0; i < L.length; i++) if (VOW[L[i]]) return true; return false; };

  /* a path spelling s (typed on a keyboard), preferring the cells of an earlier path so the trace doesn't jump
     around; the Q tile takes "qu", or a lone "q" at the very end (the U is still to be typed) */
  function pathFor(L, s, prefer) {
    prefer = prefer || [];
    const out = [];
    const go = (i, pos, mask) => {
      const l = L[i];
      if (s[pos] !== l) return false;
      const np = l !== 'q' ? pos + 1 : s[pos + 1] === 'u' ? pos + 2 : pos + 1 === s.length ? pos + 1 : -1;
      if (np < 0) return false;
      out.push(i);
      if (np >= s.length) return true;
      const want = prefer[out.length], nb = NB[i];
      const order = want != null && nb.includes(want) ? [want, ...nb.filter(j => j !== want)] : nb;
      for (const j of order) if (!(mask & 1 << j) && go(j, np, mask | 1 << i)) return true;
      out.pop();
      return false;
    };
    if (!s) return [];
    const first = prefer[0], starts = first != null && first >= 0 && first < CELLS ? [first, ...ALL.filter(i => i !== first)] : ALL;
    for (const i of starts) if (go(i, 0, 0)) return out;
    return null;
  }

  /* ---------------------------------------------------------------- the game */
  const nP = st => st.ps.length;
  const isOver = st => !nP(st) || st.t >= st.rounds * nP(st);
  const cur = st => st.ps[st.t % nP(st)];
  const roundOf = st => Math.min(st.rounds, Math.floor(st.t / Math.max(1, nP(st))) + 1);
  function bump(st, k, p, extra) { st.n++; st.ev = Object.assign({ n: st.n, k, p }, extra || {}); }
  function advance(st, now) {
    st.t++; st.hint = null;
    if (isOver(st)) { st.dl = 0; return; }
    if (st.t % nP(st) === 0) placeRunes(st, roundOf(st));
    st.dl = st.time ? now + st.time * 1000 : 0;
  }

  function doMove(st, pid, m, now) {
    if (!st || !Array.isArray(st.ps) || !st.grid) return { err: 'There\'s no game.' };
    if (isOver(st)) return { err: 'The game is over.' };
    const me = cur(st), g = st.grid;
    if (pid == null || String(pid) !== me.id) return { err: 'It\'s not your turn.' };
    if (!m || typeof m !== 'object' || Array.isArray(m)) return { err: 'That isn\'t a move.' };
    if (st.time && st.dl && now > st.dl + GRACE) return { err: 'Time\'s up.' };

    if (m.pass === true) {
      st.last = { p: me.id, pass: 1 };
      bump(st, 'pass', me.id); advance(st, now);
      return { state: st };
    }
    if (m.cast !== undefined) {
      const c = check(g, m.cast);
      if (c.err) return c;
      if (!G.Lex || !G.Lex.ready) return { err: 'The dictionary is still loading.' };
      if (!G.Lex.has(c.w)) return { err: c.w.toUpperCase() + ' isn\'t in the dictionary.' };
      const path = m.cast.slice(), pts = points(g, path), got = path.filter(i => g.mana.includes(i)).length;
      me.score += pts;
      me.mana = Math.min(MANA_MAX, me.mana + got);
      if (!me.best || pts > me.best.pts) me.best = { w: c.w, pts };
      st.last = { p: me.id, w: c.w, path, pts, mana: got };
      g.mana = g.mana.filter(i => !path.includes(i));
      refill(st, path); moveRunes(st, path); topUp(st);
      bump(st, 'cast', me.id); advance(st, now);
      return { state: st };
    }
    const k = m.act;
    if (k !== 'shuffle' && k !== 'transmute' && k !== 'scry') return { err: 'That isn\'t a move.' };
    if (me.mana < COST[k]) return { err: SPELL[k] + ' needs ' + COST[k] + ' mana.' };
    if (k === 'shuffle') {
      const L = g.L.split('');
      for (let i = 0; i < 6 && L.join('') === g.L; i++) mix(st, L);   // a shuffle that changes nothing isn't one
      g.L = L.join(''); me.mana -= COST.shuffle; st.hint = null;
      bump(st, 'shuffle', me.id);
      return { state: st };
    }
    if (k === 'transmute') {
      const cell = m.cell, l = typeof m.letter === 'string' ? m.letter.toLowerCase() : '';
      if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return { err: 'Pick a tile on the board.' };
      if (!/^[a-z]$/.test(l)) return { err: 'Pick a letter from A to Z.' };
      if (g.L[cell] === l) return { err: 'That tile is already ' + (l === 'q' ? 'QU' : l.toUpperCase()) + '.' };
      const L = g.L.slice(0, cell) + l + g.L.slice(cell + 1);
      if (!hasVowel(L)) return { err: 'The board needs at least one vowel.' };
      g.L = L; me.mana -= COST.transmute; st.hint = null;
      bump(st, 'transmute', me.id, { c: cell });
      return { state: st };
    }
    /* scry */
    if (st.hint && st.hint.p === me.id) return { err: 'Your scry is still showing.' };
    if (!G.Lex || !G.Lex.ready) return { err: 'The dictionary is still loading.' };
    const top = find(g)[0];
    if (!top) return { err: 'The runes are silent: there\'s no word here. Try a Reshuffle.' };
    st.hint = { p: me.id, path: top.path, w: top.w, pts: top.pts };
    me.mana -= COST.scry;
    bump(st, 'scry', me.id);
    return { state: st };
  }

  async function cpuMove(st, pid, level) {
    if (!st || !Array.isArray(st.ps) || isOver(st) || String(pid) !== cur(st).id) return { pass: true };
    if (!G.Lex.ready) await G.Lex.load();
    const me = cur(st), g = st.grid, words = find(g);
    if (!words.length) return me.mana >= COST.shuffle ? { act: 'shuffle' } : { pass: true };
    const any = a => a[Math.floor(Math.random() * a.length)];
    if (level === 'hard') {
      /* worth 2 mana only when it clearly pays, and once a turn (more made it far stronger than anyone could keep up
         with); the next call, still this turn, casts the new word */
      const did = st.ev && st.ev.k === 'transmute' && st.ev.p === me.id;
      if (!did && me.mana >= COST.transmute) { const t = bestTransmute(g, words[0].pts + 12); if (t) return { act: 'transmute', cell: t.cell, letter: t.letter }; }
      return { cast: any(words.filter(w => w.pts === words[0].pts)).path };
    }
    const up = words.slice().reverse();          // worst first
    if (level === 'easy') {
      const low = up.slice(0, Math.ceil(up.length / 2)), short = low.filter(w => w.len <= 5);
      return { cast: any(short.length ? short : low).path };
    }
    const a = Math.floor(up.length * 0.8), b = Math.max(a + 1, Math.ceil(up.length * 0.97));     // a good word, rarely the best
    return { cast: any(up.slice(a, Math.min(b, up.length))).path };
  }

  const SPELL = { shuffle: 'Reshuffle', transmute: 'Transmute', scry: 'Scry' };
  const RC = {
    id: 'runes', name: 'Runecasters', blurb: 'Trace words through a grid of runes',
    players: [1, 6], lex: true,
    howto: [
      'On your turn, CAST a word: trace a path of 3 or more letters through tiles that touch (diagonals count), using each tile once. Drag across them, or tap them one by one and press CAST. You can also type the word.',
      'You score the letters\' points (rare letters are worth more). Glowing runes multiply: ×2 or ×3 on a letter, and from round 2 a word rune doubles the whole word. Long words earn a bonus: +3 for 6 letters, +6 for 7, +10 for 8 or more.',
      'The tiles you used are replaced with new letters, and the runes move.',
      'MANA',
      'Tiles with a crystal give you 1 mana when you trace through them (you start with 3, up to 10). Before casting, spend it on spells:',
      ['RESHUFFLE (1): mix up all the letters.', 'TRANSMUTE (2): change one tile to any letter you like.', 'SCRY (3): see one of the best words on the board.'],
      'Every player casts once a round. After the last round, the most points wins. Playing alone is a score attack: beat your best.',
    ],
    options: [
      { key: 'rounds', label: 'ROUNDS', values: [[3, '3'], [5, '5'], [7, '7']], def: 5 },
      { key: 'time', label: 'TURN TIME', values: [[0, 'None'], [60, '60 s'], [90, '90 s'], [120, '2 min']], def: 90 },
    ],

    setup(opts, players, now) {
      now = +now || Date.now();
      const o = G.Games.opts(RC, opts), seed = opts && Number.isFinite(opts.seed) ? opts.seed | 0 : Math.floor(Math.random() * 4294967296) | 0;
      const st = {
        rounds: o.rounds, time: o.time, rs: seed, t: 0, n: 0, dl: 0,
        ps: (Array.isArray(players) ? players : []).slice(0, 6).map(p => ({ id: String(p.id), name: String(p.name == null ? 'Player' : p.name).slice(0, 24), score: 0, mana: MANA0, best: null })),
        grid: { L: '?'.repeat(CELLS), x2: -1, x3: -1, w2: -1, mana: [] },
        last: null, ev: { n: 0, k: 'start', p: null }, hint: null,
      };
      refill(st, ALL); placeRunes(st, 1); topUp(st);
      st.dl = st.time && !isOver(st) ? now + st.time * 1000 : 0;
      return st;
    },

    view(st, pid, now) {
      now = +now || Date.now();
      const g = st.grid, over = isOver(st);
      const v = {
        n: st.n, round: roundOf(st), rounds: st.rounds, turn: over ? null : cur(st).id, over,
        left: !over && st.time ? Math.max(0, st.dl - now) : null, lim: st.time * 1000,
        grid: { L: g.L, v: g.L.split('').map(l => VAL[l] || 0), x2: g.x2, x3: g.x3, w2: g.w2, mana: g.mana.slice() },
        players: st.ps.map(p => ({ id: p.id, name: p.name, score: p.score, mana: p.mana, best: p.best && { w: p.best.w, pts: p.best.pts } })),
        last: st.last && Object.assign({}, st.last, st.last.path ? { path: st.last.path.slice() } : null),
        ev: Object.assign({}, st.ev),
      };
      if (st.hint && pid != null && String(pid) === st.hint.p) v.hint = { path: st.hint.path.slice(), w: st.hint.w, pts: st.hint.pts };
      return v;
    },

    move(st, pid, m, now) {
      try { return doMove(st, pid, m, +now || Date.now()); } catch (e) { return { err: 'That move didn\'t work.' }; }
    },
    turn(st) { return !st || !Array.isArray(st.ps) || isOver(st) ? [] : [cur(st).id]; },
    due(st, now) { return st && !isOver(st) && st.time && st.dl && now >= st.dl ? cur(st).id : null; },
    timeout(st, pid, now) {
      if (!st || !Array.isArray(st.ps) || isOver(st) || String(pid) !== cur(st).id) return { state: st };
      st.last = { p: cur(st).id, pass: 1, late: 1 };
      bump(st, 'time', cur(st).id); advance(st, +now || Date.now());
      return { state: st };
    },
    result(st) {
      if (!st || !Array.isArray(st.ps) || !isOver(st)) return null;
      if (!st.ps.length) return { ranks: [], scores: {}, text: '' };
      const by =st.ps.slice().sort((a, b) => b.score - a.score), ranks = [], scores = {};
      for (const p of by) { const top = ranks[ranks.length - 1]; if (top && scores[top[0]] === p.score) top.push(p.id); else ranks.push([p.id]); scores[p.id] = p.score; }
      const star = st.ps.filter(p => p.best).sort((a, b) => b.best.pts - a.best.pts)[0];
      const bestTxt = star ? ' Best cast: ' + star.best.w.toUpperCase() + ' (' + star.best.pts + ')' + (st.ps.length > 1 ? ' by ' + star.name : '') + '.' : '';
      let text;
      if (st.ps.length === 1) text = by[0].score + ' points in ' + st.rounds + ' rounds.';
      else if (ranks[0].length > 1) text = 'A tie at ' + by[0].score + '!';
      else text = by[0].name + ' wins with ' + by[0].score + '.';
      return { ranks, scores, text: text + bestTxt };
    },
    cpu(st, pid, level) {
      return cpuMove(st, pid, level).catch(() => ({ pass: true }));
    },
    mount,

    /* the numbers and helpers behind the rules (the screen and tools/test_runes.js use them) */
    lib: { values: VAL, freq: FREQ, bonus, costs: COST, points, check, find, bestTransmute, pathFor, wordOf, adj, NB,
      limits: { MANA0, MANA_MAX, CRYS_MIN, CRYS_MAX, VMIN, VMAX, RARE, RARE_MAX, DUP_MAX, GRACE } },
  };

  /* ================================================================ the screen */
  const SVGNS = 'http://www.w3.org/2000/svg';
  const RUNE_TXT = { r2: '×2', r3: '×3', rw: 'W×2' };
  const RUNE_TIP = { r2: 'Rune: this letter counts double', r3: 'Rune: this letter counts triple', rw: 'Rune: the whole word counts double' };
  const SPELLS = [['shuffle', 'Rearrange every letter'], ['transmute', 'Turn one tile into any letter'], ['scry', 'Reveal one of the best words, to you alone']];
  const center = c => (c % SIDE + 0.5) + ',' + (Math.floor(c / SIDE) + 0.5);
  const upper = w => w.toUpperCase();

  function mount(host, api) {
    const { el } = G.U;
    const sfx = n => { try { if (api.sfx) api.sfx(n); } catch (e) { /* no sound */ } };
    const lexOk = () => !!(G.Lex && G.Lex.ready);
    let V = null, got = 0;            // the latest view, and when it arrived (the clock counts down from then)
    let path = [], typed = '';        // my trace (cells), and the letters typed for it (a lone Q waits for its U)
    let tm = 0, tmCell = -1;          // Transmute: 1 = pick a tile, 2 = pick its letter (for tmCell)
    let pend = 0;                     // when I sent a move: input waits for the answer (or 1.5 s, if it was refused)
    let drag = null, anim = null, fresh = null, spin = false, morph = -1, animT = [];
    let passAt = 0, msg = null, tickS = -1, dead = false, rose = new Set();   // rose: whose score just went up
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!dead) fn(); }, ms); timers.add(t); return t; };

    /* ---- the parts */
    const playersEl = el('div', { class: 'rc-players' });
    const turnEl = el('div', { class: 'rc-turn' }), roundEl = el('em', { class: 'pill rc-round' }), clockEl = el('div', { class: 'rc-clock' });
    const barI = el('i'), bar = el('div', { class: 'timebar rc-bar' }, barI);
    const lastEl = el('div', { class: 'rc-last' }), wordEl = el('div', { class: 'rc-word' });
    const tiles = [], cellEls = [];
    for (let i = 0; i < CELLS; i++) { const t = el('div', { class: 'tile rc-tile', style: { '--i': i } }); tiles.push(t); cellEls.push(el('div', { class: 'rc-cell' }, t)); }
    const grid = el('div', { class: 'rc-grid' }, ...cellEls);
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 5 5'); svg.setAttribute('class', 'rc-lines'); svg.setAttribute('aria-hidden', 'true');
    const line = cls => { const p = document.createElementNS(SVGNS, 'polyline'); p.setAttribute('class', cls); svg.append(p); return p; };
    const hintLine = line('hl'), castLine = line('cl'), traceLine = line('tr');
    const notes = el('div', { class: 'rc-notes' });
    const pickHead = el('span');
    const pickBtns = 'abcdefghijklmnopqrstuvwxyz'.split('').map(l => el('button', { type: 'button', 'data-l': l, onclick: () => chooseLetter(l) }, l === 'q' ? ['Q', el('em', null, 'u')] : upper(l), el('small', null, VAL[l])));
    const pick = el('div', { class: 'rc-pick', hidden: true },
      el('div', { class: 'rc-pickh' }, pickHead, el('button', { type: 'button', class: 'btn small ghost', onclick: () => { cancelTm(); sfx('back'); } }, 'CANCEL')),
      el('div', { class: 'rc-pickg' }, ...pickBtns));
    const board = el('div', { class: 'rc-board' }, grid, svg, notes, pick);
    const clearB = el('button', { type: 'button', class: 'btn ghost', onclick: () => { if (path.length || tm) sfx('del'); clearAll(); } }, 'CLEAR');
    const castPts = el('small');
    const castB = el('button', { type: 'button', class: 'btn rc-cast', onclick: () => cast() }, 'CAST', castPts);
    const passB = el('button', { type: 'button', class: 'btn ghost', onclick: () => pass() }, 'PASS');
    const pipEls = Array.from({ length: MANA_MAX }, () => el('i'));
    const manaN = el('b');
    const manaEl = el('div', { class: 'rc-mana' }, el('span', null, 'MANA'), el('span', { class: 'rc-pips' }, ...pipEls), manaN);
    const spellB = {};
    for (const [k, tip] of SPELLS) spellB[k] = el('button', { type: 'button', class: 'btn small ghost', title: tip + ' (' + COST[k] + ' mana)', onclick: () => spell(k) }, SPELL[k], el('small', null, COST[k] + ' mana'));
    const root = el('div', { class: 'rc' },
      playersEl, el('div', { class: 'rc-status' }, turnEl, roundEl, clockEl), bar, lastEl, wordEl, board,
      el('div', { class: 'rc-acts' }, clearB, castB, passB), manaEl, el('div', { class: 'rc-spells' }, spellB.shuffle, spellB.transmute, spellB.scry));
    host.append(root);
    /* the dictionary, for live "is it a word" (the host's game has it; a guest's may not yet) */
    if (G.Lex && !G.Lex.ready) G.Lex.load().then(() => { if (!dead) paint(); }, () => { /* the host checks words anyway */ });

    /* ---- who's who */
    const meId = () => api.me == null ? null : String(api.me);
    const mePlayer = () => V && V.players.find(p => p.id === meId()) || null;
    const myTurn = () => !!V && !V.over && V.turn != null && V.turn === meId();
    const canAct = () => myTurn() && !pend;
    /* names without a trailing "(HARD CPU)" (the chip's tag says so), so notes and the turn line stay short */
    const brief = n => String(n).replace(/\s*\([^)]*\)\s*$/, '') || String(n);
    const nameOf = id => { const p = V && V.players.find(q => q.id === id); return p ? brief(p.name) : 'Someone'; };
    const isCpu = id => (api.players || []).some(p => String(p.id) === id && p.cpu);

    /* ---- drawing */
    function tileKids(l, val, rune, crys, ord) {
      return [el('b', { class: 'rc-l' }, l === 'q' ? ['Q', el('small', null, 'u')] : upper(l)), el('i', { class: 'rc-v' }, val),
        rune ? el('i', { class: 'rc-rune' }, RUNE_TXT[rune]) : null, crys ? el('i', { class: 'rc-crys' }) : null,
        ord != null ? el('i', { class: 'rc-ord' }, ord + 1) : null].filter(Boolean);
    }
    const pts = p => points(V.grid, p);
    const wordNow = () => wordOf(V.grid.L, path);
    const wordGood = w => w.length >= 3 && (!lexOk() || G.Lex.has(w));

    /* everything that comes from the view */
    function render() {
      if (!V) return;
      const me = meId(), joined = !!mePlayer(), top = Math.max(...V.players.map(p => p.score));
      root.classList.toggle('watch', !joined);
      root.classList.toggle('over', !!V.over);
      playersEl.replaceChildren(...V.players.map(p => el('div', { class: 'rc-p' + (p.id === V.turn ? ' on' : '') + (p.id === me ? ' me' : '') + (V.over && p.score === top ? ' win' : '') + (rose.has(p.id) ? ' up' : '') },
        el('div', { class: 'rc-pn', title: p.name }, el('span', null, brief(p.name)), p.id === me ? el('em', { class: 'mtag ty' }, 'YOU')
          : isCpu(p.id) ? el('em', { class: 'mtag' }, 'CPU') : null),
        el('div', { class: 'rc-pr' }, el('b', { class: 'rc-ps' }, p.score), el('span', { class: 'rc-pm', title: 'Mana' }, el('i'), p.mana)),
        V.over && p.best ? el('div', { class: 'rc-pb' }, upper(p.best.w) + ' ' + p.best.pts) : null)));
      roundEl.textContent = V.over ? 'FINAL' : 'ROUND ' + V.round + '/' + V.rounds;
      if (V.over) {
        const lead = V.players.filter(p => p.score === top);
        turnEl.textContent = V.players.length === 1 ? 'Game over · ' + top + ' points' : lead.length > 1 ? 'Game over · a tie!' : 'Game over · ' + (lead[0].id === me ? 'you win!' : lead[0].name + ' wins');
      } else turnEl.textContent = myTurn() ? 'Your turn' : nameOf(V.turn) + (isCpu(V.turn) ? ' is thinking…' : '\'s turn');
      turnEl.className = 'rc-turn' + (myTurn() ? ' me' : '');
      const L = V.last;
      lastEl.replaceChildren(...(!L ? [V.over ? '' : 'Runes multiply · crystals give mana']
        : L.pass ? [nameOf(L.p) + (L.late ? ' ran out of time' : ' passed')]
        : [(L.p === me ? 'You' : nameOf(L.p)) + ' cast ', el('b', null, upper(L.w)), ' ', el('em', null, '+' + L.pts), L.mana ? el('i', null, ' +' + L.mana + ' mana') : null]).filter(x => x != null));
      const mp = mePlayer(), mana = mp ? mp.mana : 0;
      pipEls.forEach((p, i) => p.classList.toggle('on', i < mana));
      manaN.textContent = mana + '/' + MANA_MAX;
      clock();
      paint();
    }

    /* everything that changes while I trace */
    function paint() {
      if (!V) return;
      const g = V.grid, can = canAct(), now = Date.now();
      const at = new Map(path.map((c, k) => [c, k]));
      const hint = V.hint && !V.over ? V.hint.path : null, hintAt = hint ? new Map(hint.map((c, k) => [c, k])) : null;
      const w = wordNow(), ok = path.length > 0 && wordGood(w);
      root.classList.toggle('can', can && !tm);
      root.classList.toggle('tm', tm === 1);
      for (let i = 0; i < CELLS; i++) {
        const t = tiles[i], a = anim && anim.has(i);
        const l = a ? anim.get(i) : g.L[i];
        const rune = a ? '' : i === g.w2 ? 'rw' : i === g.x3 ? 'r3' : i === g.x2 ? 'r2' : '';
        const crys = !a && g.mana.includes(i), ord = hintAt && hintAt.has(i) ? hintAt.get(i) : null;
        const key = l + rune + (crys ? '*' : '') + (ord == null ? '' : ord);
        if (t._k !== key) { t._k = key; t.replaceChildren(...tileKids(l, VAL[l] || 0, rune, crys, ord)); t.title = rune ? RUNE_TIP[rune] : crys ? 'Mana crystal: +1 mana' : ''; }
        let cls = 'tile rc-tile' + (rune ? ' ' + rune : '');
        if (at.has(i)) cls += ' sel' + (ok ? ' ok' : '') + (at.get(i) === path.length - 1 ? ' end' : '');
        if (ord != null) cls += ' hint';
        if (a) cls += ' cast';
        else if (fresh && fresh.has(i)) cls += ' fresh';
        else if (spin) cls += ' spin';
        else if (morph === i) cls += ' morph';
        if (tm === 2 && i === tmCell) cls += ' tmsel';
        if (t.className !== cls) t.className = cls;
      }
      hintLine.setAttribute('points', hint ? hint.map(center).join(' ') : '');
      traceLine.setAttribute('points', path.map(center).join(' '));
      traceLine.setAttribute('class', 'tr' + (ok ? ' ok' : ''));
      pick.hidden = tm !== 2;
      if (tm === 2) {
        const cl = g.L[tmCell];
        pickHead.textContent = 'Transmute ' + (cl === 'q' ? 'QU' : upper(cl)) + ' into…';
        pickBtns.forEach(b => b.classList.toggle('off', b.dataset.l === cl));
      }

      /* the word line */
      wordEl.className = 'rc-word';
      if (msg && now < msg.until) { wordEl.classList.add(msg.cls); wordEl.replaceChildren(el('span', { class: 'rc-tip' }, msg.text)); }
      else if (path.length) {
        const p = pts(path), short = w.length < 3, bad = !short && !ok;
        wordEl.classList.add(ok ? 'ok' : 'no');
        wordEl.replaceChildren(el('span', { class: 'rc-w' }, upper(w)), el('span', { class: 'rc-pts' }, short ? '3+ letters' : bad ? 'not a word' : '+' + p));
      } else if (tm === 1) wordEl.replaceChildren(el('span', { class: 'rc-tip' }, G.U.touch ? 'Tap a tile to transmute' : 'Pick a tile to transmute (Esc cancels)'));
      else if (tm === 2) wordEl.replaceChildren(el('span', { class: 'rc-tip' }, 'Pick its new letter'));
      else if (V.hint && !V.over) { wordEl.classList.add('gold'); wordEl.replaceChildren(el('span', { class: 'rc-tip' }, 'Scry: ' + upper(V.hint.w) + ' · ' + V.hint.pts + ' points')); }
      else if (myTurn()) wordEl.replaceChildren(el('span', { class: 'rc-tip' }, G.U.touch ? 'Drag across the tiles, or tap them one by one' : 'Drag across the tiles, tap them, or type the word'));
      else if (!V.over && V.turn) wordEl.replaceChildren(el('span', { class: 'rc-tip' }, 'Waiting for ' + nameOf(V.turn) + '…'));
      else wordEl.replaceChildren();

      /* the buttons */
      const mana = mePlayer() ? mePlayer().mana : 0;
      castB.classList.toggle('off', !can || !ok || !!tm);
      castB.classList.toggle('go', can && ok && !tm);
      castPts.textContent = path.length && w.length >= 3 ? '+' + pts(path) : '';
      clearB.classList.toggle('off', !path.length && !tm);
      passB.classList.toggle('off', !can);
      passB.textContent = passAt > now ? 'SURE?' : 'PASS';
      passB.classList.toggle('hot', passAt > now);
      passB.classList.toggle('ghost', !(passAt > now));
      for (const k in spellB) spellB[k].classList.toggle('off', !can || mana < COST[k] || (k === 'scry' && !!V.hint));
      spellB.transmute.classList.toggle('on', !!tm);
    }

    /* the turn clock: the view says how long was left when it was made */
    function clock() {
      if (!V) return;
      const timed = V.left != null && !V.over;
      clockEl.hidden = !timed; bar.hidden = !timed;
      if (!timed) return;
      const left = Math.max(0, V.left - (Date.now() - got)), low = left <= 10000;
      clockEl.textContent = G.U.clock(left);
      clockEl.classList.toggle('low', low); bar.classList.toggle('low', low);
      barI.style.width = (V.lim ? Math.min(100, left / V.lim * 100) : 0) + '%';
      if (myTurn()) { const s = Math.ceil(left / 1000); if (s <= 5 && s > 0 && s !== tickS) { tickS = s; sfx('tick'); } }
    }

    function note(text, cls, ms) {
      const n = el('div', { class: 'rc-note ' + (cls || '') }, text);
      notes.append(n);
      later(() => n.remove(), ms || 1700);
    }
    function complain(text) {
      sfx('bad');
      msg = { text, cls: 'bad', until: Date.now() + 1800 };
      grid.classList.remove('shake'); void grid.offsetWidth; grid.classList.add('shake');
      paint();
    }

    /* ---- what's new in a view: animate it */
    function stopAnim() { animT.forEach(t => { clearTimeout(t); timers.delete(t); }); animT = []; anim = null; fresh = null; spin = false; morph = -1; }
    function onEvent(ev) {
      const me = meId(), mine = ev.p === me, who = nameOf(ev.p);
      stopAnim();
      if (ev.k === 'cast' && V.last && V.last.path) {
        /* the cast word glows on its old letters, then the new ones drop in */
        const L = V.last, old = new Map();
        let k = 0;
        for (const c of L.path) { old.set(c, L.w[k]); k += L.w[k] === 'q' ? 2 : 1; }
        anim = old;
        let len = 0;                    // the line's length, for drawing it on (a diagonal step is √2)
        for (let i = 1; i < L.path.length; i++) { const a = L.path[i - 1], b = L.path[i]; len += a % SIDE !== b % SIDE && Math.floor(a / SIDE) !== Math.floor(b / SIDE) ? Math.SQRT2 : 1; }
        castLine.setAttribute('points', L.path.map(center).join(' '));
        castLine.style.setProperty('--len', len.toFixed(3));
        castLine.setAttribute('class', 'cl'); void castLine.getBoundingClientRect(); castLine.setAttribute('class', 'cl go');
        note((mine ? '' : who + ' · ') + upper(L.w) + ' +' + L.pts, 'big');
        sfx(mine ? 'solve' : 'ok');
        animT.push(later(() => { anim = null; fresh = new Set(L.path); paint(); animT.push(later(() => { fresh = null; paint(); }, 600)); }, 950));
      } else if (ev.k === 'shuffle') {
        spin = true; animT.push(later(() => { spin = false; paint(); }, 900));
        if (!mine) note(who + ' reshuffled the board'); sfx('ok');
      } else if (ev.k === 'transmute') {
        morph = ev.c; animT.push(later(() => { morph = -1; paint(); }, 700));
        if (!mine) note(who + ' transmuted a tile'); sfx('ok');
      } else if (ev.k === 'scry') {
        if (mine && V.hint) note('Scry: ' + upper(V.hint.w), 'big'); else note(who + ' scried the board');
        if (mine) sfx('ok');
      } else if (ev.k === 'pass') { note(mine ? 'You passed' : who + ' passed'); sfx('back'); }
      else if (ev.k === 'time') { note(mine ? 'Out of time!' : who + ' ran out of time'); sfx(mine ? 'bad' : 'back'); }
    }

    /* ---- acting */
    function send(m) {
      pend = Date.now();
      try { api.act(m); } catch (e) { pend = 0; }
      paint();
    }
    function clearAll() { path = []; typed = ''; drag = null; tm = 0; tmCell = -1; passAt = 0; paint(); }
    function cancelTm() { tm = 0; tmCell = -1; paint(); }
    function cast() {
      if (!canAct() || tm || !path.length) return;
      const w = wordNow();
      if (w.length < 3) return complain('Words need at least 3 letters');
      if (lexOk() && !G.Lex.has(w)) return complain(upper(w) + ' isn\'t in the dictionary');
      passAt = 0;
      send({ cast: path.slice() });
    }
    function pass() {
      if (!canAct()) return;
      if (passAt > Date.now()) { passAt = 0; path = []; typed = ''; tm = 0; send({ pass: true }); return; }
      passAt = Date.now() + 2500; sfx('key'); paint();
    }
    function spell(k) {
      if (!canAct()) { if (V && !V.over && mePlayer()) sfx('bad'); return; }
      const mp = mePlayer();
      if (k === 'transmute' && tm) { cancelTm(); sfx('back'); return; }
      if (!mp || mp.mana < COST[k]) return complain(SPELL[k] + ' needs ' + COST[k] + ' mana');
      if (k === 'scry' && V.hint) return complain('Your scry is already showing');
      path = []; typed = ''; passAt = 0; tm = 0; tmCell = -1;
      if (k === 'transmute') { tm = 1; sfx('key'); paint(); return; }
      send({ act: k });
    }
    function chooseLetter(l) {
      if (tm !== 2 || !canAct() || tmCell < 0) return;
      if (V.grid.L[tmCell] === l) return;
      const cell = tmCell;
      tm = 0; tmCell = -1;
      send({ act: 'transmute', cell, letter: l });
    }
    function typeLetter(c) {
      if (anim) { stopAnim(); paint(); }
      const base = typed || wordNow(), p = pathFor(V.grid.L, base + c, path);
      if (!p) { sfx('bad'); grid.classList.remove('shake'); void grid.offsetWidth; grid.classList.add('shake'); return; }
      typed = base + c; path = p; passAt = 0; sfx('key'); paint();
    }
    function undo() { if (!path.length) return; path.pop(); typed = ''; sfx('del'); paint(); }

    /* ---- pointer: press and drag, or tap tile by tile. Moving, a tile counts only near its centre (a circle),
       so a diagonal doesn't catch the tiles beside it; pressing, the whole square does */
    function cellAt(e, loose) {
      const r = grid.getBoundingClientRect(), p = r.width / SIDE;
      if (!p) return -1;
      const x = (e.clientX - r.left) / p, y = (e.clientY - r.top) / p;
      if (x < 0 || y < 0 || x >= SIDE || y >= SIDE) return -1;
      const c = Math.floor(x), w = Math.floor(y);
      if (!loose) { const dx = x - c - 0.5, dy = y - w - 0.5; if (dx * dx + dy * dy > 0.42 * 0.42) return -1; }
      return w * SIDE + c;
    }
    function onDown(e) {
      if (!V || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (tm === 2) { cancelTm(); return; }
      if (!canAct()) return;
      const c = cellAt(e, true);
      if (c < 0) return;
      e.preventDefault();
      if (anim) stopAnim();
      if (tm === 1) { tmCell = c; tm = 2; sfx('key'); paint(); return; }
      try { grid.setPointerCapture(e.pointerId); } catch (x) { /* fine without */ }
      const k = path.indexOf(c);
      let undoTap = false;
      if (k >= 0 && k === path.length - 1) undoTap = true;            // the end tile again: a tap takes it off
      else if (k >= 0) path = path.slice(0, k + 1);                 // back to an earlier tile
      else if (path.length && adj(path[path.length - 1], c)) path.push(c);
      else path = [c];
      typed = ''; passAt = 0; msg = null;
      drag = { id: e.pointerId, moved: false, undoTap };
      if (!undoTap) sfx('key');
      paint();
    }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.id || !canAct()) return;
      if (e.pointerType === 'mouse' && e.buttons === 0) { drag = null; paint(); return; }   // let go outside, uncaptured
      const c = cellAt(e, false), n = path.length;
      if (c < 0 || c === path[n - 1]) return;
      if (n > 1 && c === path[n - 2]) { path.pop(); drag.moved = true; sfx('del'); paint(); return; }   // dragging back undoes
      if (!path.includes(c) && n && adj(path[n - 1], c)) { path.push(c); drag.moved = true; sfx('key'); paint(); }
    }
    function onUp(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (!canAct()) return;
      if (!d.moved) { if (d.undoTap) { path.pop(); sfx('del'); paint(); } return; }
      /* letting go of a traced word casts it, if the dictionary says it's a word; otherwise it stays to be fixed
         (or cast with the button: without the dictionary here, the host's game decides) */
      if (e.type === 'pointerup' && path.length && lexOk() && G.Lex.has(wordNow())) cast(); else paint();
    }
    grid.addEventListener('pointerdown', onDown);
    grid.addEventListener('pointermove', onMove);
    grid.addEventListener('pointerup', onUp);
    grid.addEventListener('pointercancel', onUp);
    grid.addEventListener('contextmenu', e => e.preventDefault());

    /* ---- keyboard: Enter casts, Backspace undoes, Esc clears, letters trace. Caught before the app's own key
       handler (which would take Esc as "back"); Esc with nothing to clear is left to it */
    function key(e) {
      if (dead || !root.isConnected || !V || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (document.querySelector('.overlay')) return;
      const k = e.key, stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (k === 'Escape') { if (tm || path.length || passAt) { stop(); sfx('del'); clearAll(); } return; }
      if (!canAct()) return;
      if (tm === 2) { if (/^[a-zA-Z]$/.test(k)) { stop(); chooseLetter(k.toLowerCase()); } return; }
      if (k === 'Enter') { stop(); if (!e.repeat) cast(); }
      else if (k === 'Backspace') { stop(); if (!tm) undo(); }
      else if (/^[a-zA-Z]$/.test(k) && !tm) { stop(); if (!e.repeat) typeLetter(k.toLowerCase()); }
    }
    window.addEventListener('keydown', key, true);
    const ticker = setInterval(() => {
      if (dead || !V) return;
      clock();
      const now = Date.now();
      if ((pend && now - pend > 1500) || (passAt && now > passAt) || (msg && now > msg.until)) {
        if (pend && now - pend > 1500) pend = 0;
        if (passAt && now > passAt) passAt = 0;
        if (msg && now > msg.until) msg = null;
        paint();
      }
    }, 200);

    return {
      update(v) {
        if (dead || !v || typeof v !== 'object' || !v.grid || typeof v.grid.L !== 'string' || v.grid.L.length !== CELLS || !Array.isArray(v.grid.mana) || !Array.isArray(v.players)) return;
        const prev = V;
        rose = new Set(prev ? v.players.filter(p => { const o = prev.players.find(q => q.id === p.id); return o && p.score > o.score; }).map(p => p.id) : []);
        V = v; got = Date.now();
        const turned = !prev || prev.turn !== v.turn;
        /* a half-traced path lasts only while its letters and my turn do */
        if (!prev || prev.grid.L !== v.grid.L || turned || v.over) { path = []; typed = ''; drag = null; }
        if (turned || v.over || !myTurn()) { tm = 0; tmCell = -1; passAt = 0; }
        if (!prev || prev.n !== v.n) pend = 0;
        if (turned) tickS = -1;
        if (prev && v.ev && (!prev.ev || prev.ev.n !== v.ev.n)) onEvent(v.ev);
        if (prev && turned && myTurn() && v.players.length > 1) { note('Your turn', 'me', 1300); sfx('ping'); }
        render();
      },
      destroy() {
        dead = true;
        clearInterval(ticker);
        timers.forEach(t => clearTimeout(t)); timers.clear();
        window.removeEventListener('keydown', key, true);
        root.remove();
      },
    };
  }

  G.Games.add(RC);
})();
