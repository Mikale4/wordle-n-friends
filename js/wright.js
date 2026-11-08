/* ============================================================================
   wright.js -- WORDWRIGHT: build crossing words from a rack of letter tiles,
   2-4 players. The rules (pure functions over plain JSON state), the CPU
   players and the screen. The contract it follows is in js/games.js.

   THE TILES  100 letters + 2 blanks, worked out from the dictionary itself.
     f = how often a letter appears in its 30,801 base words of 2-8 letters
     (the words that actually get played; -s forms whose stem is also a word
     are left out so that plurals don't inflate S).
     COUNT  every letter gets at least 1; the other 96 tiles are shared out in
            proportion to f (largest remainders).
     VALUE  1.5 x log2(f(E) / f(letter)), rounded, at least 1: a letter half
            as common as E is worth 1.5 points more.
       E 12x1  I 8x1  A 7x1  R 7x1  N 6x1    S 6x2  T 6x2  O 6x2  L 5x2  D 5x2
       U 4x3  C 4x3  G 3x3  P 3x3  M 3x3  H 2x3    B 2x4  Y 2x4  F 2x4
       K 1x5  W 1x5  V 1x5    Z 1x8  X 1x8  J 1x8    Q 1x9    blank 2x0
     (count x value; 225 points in all)

   THE BOARD  15 x 15, 'nested diamonds', the same all 8 ways round, 56 premiums:
     a big diamond through the middle of each edge, every square of it a
     premium (3L at its four tips, then 2L, then 2W along the sides); a small
     diamond round the centre (3L on the axes, 2L between); and an arc across
     each corner (3W at both ends, 3L between).
     8 x 3W, 16 x 2W, 16 x 3L, 16 x 2L. The centre is the start square and no
     premium: the first word must cover it.

   A TURN is one of
     place     1-7 tiles in one row or column with no gaps (tiles already on
               the board may fill them), touching a tile on the board (the
               first word covers the centre instead). The main word and every
               cross word it makes must be in the dictionary. A word scores its
               letters (a letter premium under a NEW tile counts that tile 2x
               or 3x), times every word premium under a new tile. Blanks score
               0. All 7 tiles in one move: +35, a FULL RACK.
     exchange  put 1-7 tiles back and draw as many (only while the bag holds 7+)
     pass      with a time limit, running out of time is a pass too.

   THE END  a player uses their last tile while the bag is empty: they gain
     the value of everyone else's tiles, and each other player loses their
     own. Or every player passes or exchanges twice in a row (2 x players
     scoreless turns): everyone loses the value of their own tiles.

   MOVES  { place: [{ r, c, l, b }] }  row and column (0-14), the letter (a-z),
                                       b: true for a blank standing for l
          { exchange: ['a', '?', ...] } ('?' is a blank)      { pass: true }

   THE VIEW (what player pid sees; well under 1 KB)
     b     the board: 15 strings of 15 characters; '.' empty, 'a'-'z' a tile,
           'A'-'Z' a blank standing for that letter
     rack  my tiles, only in my view ('?' a blank)
     p     [{ id, name, s: score, n: tiles on their rack }] in seat order
     bag   how many tiles are left in the bag (never which)
     turn  whose turn it is (null once it's over)
     left  ms left this turn, or null with no time limit
     mv    turns taken so far;  pass  scoreless turns in a row
     last  the last turn: { p: pid, k: 'play' | 'pass' | 'swap' | 'time',
           w: [[word, points], ...], pts, sq: [r * 15 + c, ...], full, n: tiles swapped }
     end   null, or { why: 'out' | 'stuck', by: pid who went out,
           adj: { pid: points gained or lost }, racks: { pid: [tiles left] } }
   ========================================================================== */
(function () {
  'use strict';
  const G = typeof window !== 'undefined' ? window : self;
  const N = 15, NN = N * N, CEN = 7 * N + 7, RACK = 7, FULL = 35, GRACE = 1500;
  const A = 'abcdefghijklmnopqrstuvwxyz';

  const COUNT = { e: 12, i: 8, a: 7, r: 7, n: 6, s: 6, t: 6, o: 6, l: 5, d: 5, u: 4, c: 4, g: 3, p: 3, m: 3, h: 2, b: 2, y: 2, f: 2, k: 1, w: 1, v: 1, z: 1, x: 1, j: 1, q: 1, '?': 2 };
  const VAL = { e: 1, i: 1, a: 1, r: 1, n: 1, s: 2, t: 2, o: 2, l: 2, d: 2, u: 3, c: 3, g: 3, p: 3, m: 3, h: 3, b: 4, y: 4, f: 4, k: 5, w: 5, v: 5, z: 8, x: 8, j: 8, q: 9, '?': 0 };
  const VALS = Array.from(A, c => VAL[c]);
  const VOW = Array.from(A, c => 'aeiou'.includes(c));

  /* the premiums: 1 2L, 2 3L, 3 2W, 4 3W. Each entry is [kind, rows, columns] away from the centre, mirrored 8 ways */
  const PREM = new Uint8Array(NN), LM = new Uint8Array(NN), WM = new Uint8Array(NN);
  [[4, 7, 4], [2, 6, 5], [2, 7, 0], [2, 3, 0], [3, 5, 2], [3, 4, 3], [1, 6, 1], [1, 2, 1]].forEach(([k, a, b]) => {
    for (const [x, y] of [[a, b], [b, a]]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) PREM[(7 + sx * x) * N + 7 + sy * y] = k;
  });
  for (let i = 0; i < NN; i++) { LM[i] = [1, 2, 3, 1, 1][PREM[i]]; WM[i] = [1, 1, 1, 2, 3][PREM[i]]; }

  const T = now => typeof now === 'number' && isFinite(now) ? now : Date.now();
  /* the bag is shuffled with a seeded generator kept in the state (mulberry32), so a game replays exactly */
  const rnd = s => { let t = s.rs = s.rs + 0x6D2B79F5 | 0; t = Math.imul(t ^ t >>> 15, 1 | t); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const mix = (s, a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd(s) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const draw = (s, k) => { const out = []; while (k-- > 0 && s.bag.length) out.push(s.bag.pop()); return out; };
  const worth = rack => rack.reduce((a, t) => a + (VAL[t] || 0), 0);
  /* the rack without the tiles in need, or null if they aren't all on it */
  const take = (rack, need) => { const r = rack.slice(); for (const x of need) { const k = r.indexOf(x); if (k < 0) return null; r.splice(k, 1); } return r; };
  const nbrs = i => { const r = i / N | 0, c = i % N, o = []; if (r > 0) o.push(i - N); if (r < N - 1) o.push(i + N); if (c > 0) o.push(i - 1); if (c < N - 1) o.push(i + 1); return o; };
  const names = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0];

  /* ------------------------------------------------------------------ placing tiles */
  /* is a placement legal on the board (its 15 rows joined into one string), and what does it score?
     tiles: [{ i: r * 15 + c, l, b }] on different squares. has: the dictionary (null: don't check the words).
     Used by move() and by the screen to preview a play, so both always agree. */
  function judge(flat, tiles, has) {
    const n = tiles.length, nw = new Map();
    if (n < 1 || n > RACK) return { err: 'Place between 1 and 7 tiles.' };
    for (const t of tiles) { if (flat[t.i] !== '.') return { err: 'That square is already taken.' }; nw.set(t.i, t); }
    const first = !/[a-z]/i.test(flat);
    const r0 = tiles[0].i / N | 0, c0 = tiles[0].i % N;
    const across = tiles.every(t => (t.i / N | 0) === r0), down = tiles.every(t => t.i % N === c0);
    if (!across && !down) return { err: 'Put your tiles in one row or one column.' };
    if (first && !nw.has(CEN)) return { err: 'The first word must cover the centre square ★.' };
    if (first && n < 2) return { err: 'A word needs at least two letters.' };
    const full = i => nw.has(i) || flat[i] !== '.';
    if (n > 1) {
      const d = across ? 1 : N, idx = tiles.map(t => t.i), hi = Math.max(...idx);
      for (let i = Math.min(...idx); i <= hi; i += d) if (!full(i)) return { err: 'Leave no gaps: your tiles must make one unbroken word.' };
    }
    if (!first && !tiles.some(t => nbrs(t.i).some(j => flat[j] !== '.'))) return { err: 'Your word must join the tiles already on the board.' };
    /* the unbroken run of tiles through square i along d (1 across, 15 down) */
    const run = (i, d) => {
      const back = j => d === 1 ? j % N > 0 : j >= N, fwd = j => d === 1 ? j % N < N - 1 : j < NN - N;
      let s = i; while (back(s) && full(s - d)) s -= d;
      const out = [s]; while (fwd(s) && full(s + d)) { s += d; out.push(s); }
      return out;
    };
    const lines = [];
    if (n > 1) {
      const d = across ? 1 : N; lines.push(run(tiles[0].i, d));
      for (const t of tiles) { const x = run(t.i, N + 1 - d); if (x.length > 1) lines.push(x); }
    } else for (const d of [1, N]) { const x = run(tiles[0].i, d); if (x.length > 1) lines.push(x); }
    if (!lines.length) return { err: 'A word needs at least two letters.' };
    const words = lines.map(sq => {
      let w = '', sum = 0, m = 1;
      for (const j of sq) {
        const t = nw.get(j);
        if (t) { w += t.l; sum += (t.b ? 0 : VAL[t.l]) * LM[j]; m *= WM[j]; }
        else { const ch = flat[j], lc = ch.toLowerCase(); w += lc; sum += ch === lc ? VAL[lc] : 0; }
      }
      return [w, sum * m];
    });
    if (has) {
      const bad = [...new Set(words.map(x => x[0]).filter(w => !has(w)))].map(w => w.toUpperCase());
      if (bad.length) return { err: names(bad) + (bad.length > 1 ? ' aren\'t' : ' isn\'t') + ' in the word list.' };
    }
    return { words, pts: words.reduce((a, x) => a + x[1], 0) + (n === RACK ? FULL : 0), full: n === RACK, sq: tiles.map(t => t.i) };
  }

  /* a place move from the network -> [{ i, l, b }], or the reason it's no good */
  function parse(p) {
    if (!Array.isArray(p) || p.length < 1 || p.length > RACK) return 'Place between 1 and 7 tiles.';
    const out = [], seen = new Set();
    for (const t of p) {
      if (!t || typeof t !== 'object') return 'That isn\'t a tile.';
      const { r, c } = t, l = typeof t.l === 'string' ? t.l.toLowerCase() : '';
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= N || c >= N) return 'That square is off the board.';
      if (!/^[a-z]$/.test(l)) return 'Each tile needs a letter from A to Z.';
      const i = r * N + c;
      if (seen.has(i)) return 'Two tiles can\'t share a square.';
      seen.add(i); out.push({ i, l, b: t.b === true });
    }
    return out;
  }

  /* ------------------------------------------------------------------ the rules */
  function setup(opts, players, now) {
    const o = opts || {}, time = [0, 120, 300].includes(+o.time) ? +o.time : 0;
    now = T(now);
    const s = {
      ps: (players || []).map(p => ({ id: String(p.id), name: String(p.name == null ? 'Player' : p.name) })),
      b: Array(N).fill('.'.repeat(N)), bag: [], racks: {}, sc: {},
      t: 0, pass: 0, mv: 0, last: null, end: null, time, dl: 0,
      rs: Number.isInteger(o.seed) ? o.seed : (Math.random() * 4294967296) ^ now,
    };
    for (const l in COUNT) for (let k = 0; k < COUNT[l]; k++) s.bag.push(l);
    mix(s, s.bag);
    for (const p of s.ps) { s.racks[p.id] = draw(s, RACK); s.sc[p.id] = 0; }
    s.dl = time ? now + time * 1000 : 0;
    return s;
  }

  function view(s, pid, now) {
    const v = {
      b: s.b.slice(),
      p: s.ps.map(p => ({ id: p.id, name: p.name, s: s.sc[p.id], n: s.racks[p.id].length })),
      bag: s.bag.length, turn: s.end ? null : s.ps[s.t].id,
      left: !s.end && s.dl ? Math.max(0, Math.round(s.dl - T(now))) : null,
      mv: s.mv, pass: s.pass,
      last: s.last ? JSON.parse(JSON.stringify(s.last)) : null,       // copies: a local screen may keep the view
      end: s.end ? JSON.parse(JSON.stringify(s.end)) : null,
    };
    if (pid != null && s.racks[pid]) v.rack = s.racks[pid].slice();
    return v;
  }

  const next = (s, now) => { s.t = (s.t + 1) % s.ps.length; s.dl = s.time ? now + s.time * 1000 : 0; };
  function scoreless(s, last, now) {
    s.pass++; s.mv++; s.last = last;
    if (s.pass >= 2 * s.ps.length) finish(s, 'stuck', null); else next(s, now);
  }
  function finish(s, why, by) {
    const adj = {}, racks = {};
    for (const p of s.ps) { racks[p.id] = s.racks[p.id].slice(); adj[p.id] = -worth(racks[p.id]); }
    if (why === 'out') adj[by] = s.ps.reduce((a, p) => a - (p.id === by ? 0 : adj[p.id]), 0);
    for (const p of s.ps) s.sc[p.id] += adj[p.id];
    s.end = { why, by, adj, racks }; s.dl = 0;
  }

  function act(s, pid, m, now) {
    if (!s || !Array.isArray(s.ps) || !s.ps.length) return { err: 'There\'s no game.' };
    if (s.end) return { err: 'The game is over.' };
    const cur = s.ps[s.t];
    if (!cur || cur.id !== pid) return { err: 'It\'s not your turn.' };
    if (s.dl && now > s.dl + GRACE) return { err: 'Your time ran out.' };
    if (!m || typeof m !== 'object' || Array.isArray(m)) return { err: 'That isn\'t a move.' };
    const kinds = ['place', 'exchange', 'pass'].filter(k => Object.prototype.hasOwnProperty.call(m, k) && m[k] != null && m[k] !== false);
    if (kinds.length !== 1) return { err: 'That isn\'t a move.' };
    const rack = s.racks[pid];

    if (kinds[0] === 'pass') {
      if (m.pass !== true) return { err: 'That isn\'t a move.' };
      scoreless(s, { p: pid, k: 'pass' }, now);
      return { state: s };
    }

    if (kinds[0] === 'exchange') {
      const x = m.exchange, out = [];
      if (!Array.isArray(x) || x.length < 1 || x.length > RACK) return { err: 'Exchange between 1 and 7 tiles.' };
      for (const t of x) { if (typeof t !== 'string' || !/^[a-zA-Z?]$/.test(t)) return { err: 'That isn\'t a tile.' }; out.push(t.toLowerCase()); }
      if (s.bag.length < RACK) return { err: 'You can only exchange while the bag holds at least 7 tiles.' };
      const kept = take(rack, out);
      if (!kept) return { err: 'Those tiles aren\'t all on your rack.' };
      s.racks[pid] = kept.concat(draw(s, out.length));     // draw first, so you can't draw your own tiles straight back
      s.bag.push(...out); mix(s, s.bag);
      scoreless(s, { p: pid, k: 'swap', n: out.length }, now);
      return { state: s };
    }

    const tiles = parse(m.place);
    if (typeof tiles === 'string') return { err: tiles };
    if (!G.Lex || !Lex.ready) return { err: 'The dictionary is still loading. Try again in a moment.' };
    const kept = take(rack, tiles.map(t => t.b ? '?' : t.l));
    if (!kept) return { err: 'Those tiles aren\'t all on your rack.' };
    const flat = s.b.join(''), r = judge(flat, tiles, Lex.has);
    if (r.err) return { err: r.err };
    const cells = flat.split('');
    for (const t of tiles) cells[t.i] = t.b ? t.l.toUpperCase() : t.l;
    s.b = Array.from({ length: N }, (_, k) => cells.slice(k * N, k * N + N).join(''));    // a new array: old views keep theirs
    s.sc[pid] += r.pts;
    s.racks[pid] = kept.concat(draw(s, RACK - kept.length));
    s.pass = 0; s.mv++;
    s.last = { p: pid, k: 'play', w: r.words, pts: r.pts, sq: r.sq, full: r.full };
    if (!s.racks[pid].length) finish(s, 'out', pid); else next(s, now);
    return { state: s };
  }

  function result(s) {
    if (!s || !s.end) return null;
    const ids = s.ps.map(p => p.id).sort((a, b) => s.sc[b] - s.sc[a]);       // stable: ties keep seat order
    const ranks = [];
    for (const id of ids) { const g = ranks[ranks.length - 1]; if (g && s.sc[g[0]] === s.sc[id]) g.push(id); else ranks.push([id]); }
    const name = id => (s.ps.find(p => p.id === id) || {}).name || '?', top = ranks[0], pts = s.sc[top[0]];
    const head = top.length > 1 ? 'A tie at ' + pts + ' points between ' + names(top.map(name)) + '.' : name(top[0]) + ' wins with ' + pts + ' points.';
    const why = s.end.why === 'out' ? name(s.end.by) + ' used every tile.' : 'Everyone passed twice in a row.';
    return { ranks, scores: Object.assign({}, s.sc), text: head + ' ' + why };
  }

  /* ------------------------------------------------------------------ the CPU players */
  /* Every legal move for a rack, Appel & Jacobson style: walk the dictionary graph (Lex.root) from each anchor
     square (an empty square next to a tile), first through the letters left of it, then right, only along
     letters the cross-checks allow (the letters that make a word with the tiles above and below). Down moves
     are the same search with rows and columns swapped. A blank is tried only for letters the rack has run
     out of, which keeps two blanks fast and loses only the choice of which copy of a letter is the blank.
     Returns [{ t: [square, letter code, blank, ...], s: score, len: main word length, eq: score + leave }]. */
  function gen(flat, rack, o) {
    o = o || {};
    const root = G.Lex && Lex.root, out = [];
    if (!root) return out;
    const occ = new Int8Array(NN).fill(-1), bv = new Uint8Array(NN);
    let any = false;
    for (let i = 0; i < NN; i++) { const ch = flat[i]; if (ch !== '.') { const lc = ch.toLowerCase(); occ[i] = lc.charCodeAt(0) - 97; bv[i] = ch === lc ? VAL[lc] : 0; any = true; } }
    const cnt = new Int8Array(27);
    for (const t of rack) cnt[t === '?' ? 26 : t.charCodeAt(0) - 97]++;
    const size = rack.length, anchor = new Uint8Array(NN);
    if (!any) anchor[CEN] = 1;
    else for (let i = 0; i < NN; i++) if (occ[i] < 0 && nbrs(i).some(j => occ[j] >= 0)) anchor[i] = 1;
    const stop = Date.now() + (o.budget || 1200), leave = o.leave ? leaveValue : null;
    let steps = 0, halted = false, depth = 0;
    const sS = new Int16Array(8), sC = new Int8Array(8), sB = new Uint8Array(8), lC = new Int8Array(8), lB = new Uint8Array(8);
    const xc = new Int32Array(NN), xs = new Int16Array(NN), xh = new Uint8Array(NN), ALL = (1 << 26) - 1;

    for (const across of [true, false]) {
      const sq = across ? (a, p) => a * N + p : (a, p) => p * N + a;
      /* cross-checks: which letters may go on each anchor, and the tiles they'd join across the line */
      for (let i = 0; i < NN; i++) {
        xc[i] = ALL; xs[i] = 0; xh[i] = 0;
        if (!anchor[i]) continue;
        const r = i / N | 0, c = i % N, pre = [], suf = [];
        if (across) { for (let y = r - 1; y >= 0 && occ[y * N + c] >= 0; y--) pre.unshift(y * N + c); for (let y = r + 1; y < N && occ[y * N + c] >= 0; y++) suf.push(y * N + c); }
        else { for (let x = c - 1; x >= 0 && occ[r * N + x] >= 0; x--) pre.unshift(r * N + x); for (let x = c + 1; x < N && occ[r * N + x] >= 0; x++) suf.push(r * N + x); }
        if (!pre.length && !suf.length) continue;
        xh[i] = 1;
        for (const j of pre) xs[i] += bv[j];
        for (const j of suf) xs[i] += bv[j];
        let node = root, mask = 0;
        for (const j of pre) { node = node.k[A[occ[j]]]; if (!node) break; }
        if (node) for (const L in node.k) {
          let n2 = node.k[L];
          for (const j of suf) { n2 = n2.k[A[occ[j]]]; if (!n2) break; }
          if (n2 && n2.e) mask |= 1 << (L.charCodeAt(0) - 97);
        }
        xc[i] = mask;
      }

      let a = 0, ap = 0, st = 0;      // the line, the anchor's place on it, where the word starts
      const rec = (len, score) => {
        if (!across && depth === 1 && xh[sS[0]]) return;   // one tile with neighbours across: the across pass has it
        const t = new Array(depth * 3);
        for (let k = 0; k < depth; k++) { t[k * 3] = sS[k]; t[k * 3 + 1] = sC[k]; t[k * 3 + 2] = sB[k]; }
        out.push({ t, s: score, len, eq: leave ? score + leave(cnt) : score });
      };
      /* carry on rightwards from position p with the word so far at dictionary node `node` */
      const ext = (p, node, sum, wm, cross) => {
        if (halted) return;
        if ((++steps & 2047) === 0 && Date.now() > stop) { halted = true; return; }
        if (p < N) {
          const i = sq(a, p);
          if (occ[i] >= 0) { const nx = node.k[A[occ[i]]]; if (nx) ext(p + 1, nx, sum + bv[i], wm, cross); return; }
        }
        if (p > ap && node.e) rec(p - st, sum * wm + cross + (depth === RACK ? FULL : 0));
        if (p >= N) return;
        const i = sq(a, p), mask = xc[i], lm = LM[i], w = WM[i], h = xh[i], xsum = xs[i];
        for (const L in node.k) {
          const code = L.charCodeAt(0) - 97;
          if (!(mask >> code & 1)) continue;
          let b = 0;
          if (cnt[code] > 0) cnt[code]--; else if (cnt[26] > 0) { cnt[26]--; b = 1; } else continue;
          const v = b ? 0 : VALS[code];
          sS[depth] = i; sC[depth] = code; sB[depth] = b; depth++;
          ext(p + 1, node.k[L], sum + v * lm, wm * w, h ? cross + (xsum + v * lm) * w : cross);
          depth--;
          if (b) cnt[26]++; else cnt[code]++;
        }
      };
      /* the k letters chosen so far go just left of the anchor; try them, then try one more */
      const left = (node, lim, k) => {
        st = ap - k;
        let sum = 0, wm = 1;
        for (let q = 0; q < k; q++) { const i = sq(a, st + q); sum += (lB[q] ? 0 : VALS[lC[q]]) * LM[i]; wm *= WM[i]; sS[q] = i; sC[q] = lC[q]; sB[q] = lB[q]; }
        depth = k; ext(ap, node, sum, wm, 0); depth = 0;
        if (k >= lim || halted) return;
        for (const L in node.k) {
          const code = L.charCodeAt(0) - 97;
          let b = 0;
          if (cnt[code] > 0) cnt[code]--; else if (cnt[26] > 0) { cnt[26]--; b = 1; } else continue;
          lC[k] = code; lB[k] = b;
          left(node.k[L], lim, k + 1);
          if (b) cnt[26]++; else cnt[code]++;
        }
      };

      for (a = 0; a < N && !halted; a++) for (let p = 0; p < N; p++) {
        if (!anchor[sq(a, p)]) continue;
        ap = p;
        if (p > 0 && occ[sq(a, p - 1)] >= 0) {
          // tiles just left of the anchor: they start the word
          let s0 = p - 1; while (s0 > 0 && occ[sq(a, s0 - 1)] >= 0) s0--;
          let node = root, sum = 0;
          for (let q = s0; q < p && node; q++) { const j = sq(a, q); node = node.k[A[occ[j]]]; sum += bv[j]; }
          st = s0; depth = 0;
          if (node) ext(p, node, sum, 1, 0);
        } else {
          // empty squares left of it that touch nothing: a prefix from the rack may go there
          let lim = 0;
          while (lim < size - 1 && p - lim - 1 >= 0) { const j = sq(a, p - lim - 1); if (anchor[j] || occ[j] >= 0) break; lim++; }
          left(root, lim, 0);
        }
      }
    }
    return out;
  }

  /* what the tiles left on the rack are worth to the hard player: a mix of about 2 vowels to 3 consonants,
     few duplicates, keep an S, keep blanks (a move has to gain 9 more to spend one), no Q without a U */
  function leaveValue(cnt) {
    let v = 0, c = 0, x = 0;
    for (let k = 0; k < 26; k++) { const n = cnt[k]; if (!n) continue; if (VOW[k]) v += n; else c += n; if (n > 1) x -= 2.5 * (n - 1); }
    if (cnt[16] && !cnt[20]) x -= 6;
    if (cnt[18]) x += 2.5;
    const n = v + c;
    if (n) x -= 2.5 * Math.abs(v - 0.4 * n);
    return x + cnt[26] * 9;
  }
  /* no blank, and at most one vowel or at least five */
  const awful = rack => { let v = 0; for (const t of rack) if (VOW[A.indexOf(t)]) v++; return !rack.includes('?') && (v <= 1 || v >= 5); };
  /* which tiles to throw back: keep blanks and up to 2 vowels and 3 consonants among the useful letters, no doubles */
  function toss(rack) {
    const rank = t => t === '?' ? 9 : t === 's' ? 5 : t === 'e' ? 4 : 'artnil'.includes(t) ? 3 : 'odcugpmh'.includes(t) ? 1 : 0;
    const keep = [], out = [];
    let v = 0, c = 0;
    for (const t of rack.slice().sort((x, y) => rank(y) - rank(x))) {
      const vow = 'aeiou'.includes(t);
      if (t === '?' || (rank(t) > 0 && !keep.includes(t) && (vow ? v < 2 : c < 3))) { keep.push(t); if (t !== '?') { if (vow) v++; else c++; } }
      else out.push(t);
    }
    if (!out.length) { const k = keep.findIndex(t => t !== '?'); out.push(k >= 0 ? keep[k] : rack[0]); }
    return out;
  }

  function think(s, pid, level) {
    const rack = (s.racks[pid] || []).slice(), bagN = s.bag.length;
    if (!rack.length || !G.Lex || !Lex.ready) return { pass: true };
    const hard = level === 'hard', easy = level === 'easy';
    const all = gen(s.b.join(''), rack, { leave: hard && bagN > 0 });
    let pick = null;
    if (all.length) {
      if (hard) pick = all.reduce((a, m) => m.eq > a.eq || (m.eq === a.eq && m.s > a.s) ? m : a);
      else {
        const pool = (easy ? all.filter(m => m.len <= 5) : all).sort((x, y) => x.s - y.s);
        if (!pool.length) pick = all.reduce((a, m) => m.s < a.s ? m : a);
        else if (easy) pick = pool[Math.floor(Math.random() * Math.ceil(pool.length / 2))];   // the lower-scoring half
        else {                                                                                 // the 80th to 97th percentile: good, rarely the best
          const lo = Math.floor((pool.length - 1) * 0.8), hi = Math.ceil((pool.length - 1) * 0.97);
          pick = pool[lo + Math.floor(Math.random() * (hi - lo + 1))];
        }
      }
    }
    if (bagN >= RACK && (!pick || (pick.s < (hard ? 14 : 8) && awful(rack)))) return { exchange: toss(rack) };
    if (!pick) return { pass: true };
    const place = [];
    for (let k = 0; k < pick.t.length; k += 3) { const i = pick.t[k]; place.push({ r: i / N | 0, c: i % N, l: A[pick.t[k + 1]], b: !!pick.t[k + 2] }); }
    return { place };
  }

  /* ------------------------------------------------------------------ the screen */
  const PCLS = ['', ' p2l', ' p3l', ' p2w', ' p3w'], PLBL = ['', '2L', '3L', '2W', '3W'];

  function mount(host, api) {
    const { el } = U;
    const me = api.me == null ? null : String(api.me);
    let V = null;              // the latest view
    let tent = [];             // my tiles on the board, not played yet: { i, k (index into V.rack), l, b }
    let order = [];            // the rack as I've arranged it: indices into V.rack
    let sel = -1;              // the rack tile picked up by a tap
    let cur = null;            // the typing cursor: { i, d: 1 across | 15 down }
    let drag = null, modal = null, busy = 0, got = 0, tick = -1, passArm = 0, rackSig = '';

    const pl = id => (api.players || []).find(p => String(p.id) === id) || (V && V.p.find(p => p.id === id)) || null;
    const who = id => id === me ? 'You' : (pl(id) || {}).name || 'Someone';
    const canEdit = () => !!(V && V.rack && !V.end);
    const myTurn = () => canEdit() && V.turn === me;
    const at = i => V.b[i / N | 0][i % N];
    const tentAt = i => tent.find(t => t.i === i);
    const letterAt = i => { const t = tentAt(i); return t ? t.l : at(i).toLowerCase(); };
    const filled = i => at(i) !== '.' || !!tentAt(i);
    const step = (i, d) => d === 1 ? (i % N < N - 1 ? i + 1 : -1) : (i + N < NN ? i + N : -1);
    const free = () => { const used = new Set(tent.map(t => t.k)); return order.filter(k => !used.has(k)); };
    const face = l => l === '?' ? ['?'] : [l.toUpperCase(), el('i', null, VAL[l])];
    const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter(x => x != null && x !== false));   // replaceChildren would print "null"

    /* ---- the pieces */
    const cells = [], board = el('div', { class: 'wr-board', onpointerdown: down });
    for (let i = 0; i < NN; i++) { const c = el('div', { class: 'wc', 'data-i': i }); c.sig = null; cells.push(c); board.append(c); }
    const pls = el('div', { class: 'wr-pls' });
    const turnEl = el('b', { class: 'wr-turn' }), bagEl = el('span', { class: 'pill' }), clockEl = el('span', { class: 'wr-clock', hidden: true });
    const lastEl = el('div', { class: 'wr-last' }), endEl = el('div', { class: 'wr-end', hidden: true });
    const prevEl = el('div', { class: 'wr-prev' }), rackEl = el('div', { class: 'wr-rack', onpointerdown: down });
    const B = (label, fn, cls) => el('button', { class: 'btn ' + cls, onclick: e => { e.currentTarget.blur(); fn(); } }, el('span', null, label), el('small', null));
    const bPlay = B('PLAY', play, 'wr-play'), bShuf = B('SHUFFLE', shuffle, 'ghost small'), bRecall = B('RECALL', recall, 'ghost small');
    const bSwap = B('EXCHANGE', exchange, 'ghost small'), bPass = B('PASS', pass, 'ghost small');
    const btns = el('div', { class: 'wr-btns' }, bPlay, bShuf, bRecall, bSwap, bPass);
    const root = el('div', { class: 'wr' },
      el('div', { class: 'wr-side' }, pls, el('div', { class: 'wr-info' }, turnEl, el('span', { class: 'grow' }), bagEl, clockEl), lastEl, endEl),
      el('div', { class: 'wr-main' }, board, prevEl, rackEl, btns));
    host.append(root);

    /* ---- drawing it all from the view and my local bits */
    function paint() {
      if (!V) return;
      const edit = canEdit(), mine = myTurn(), lastSq = V.last && V.last.k === 'play' ? V.last.sq : [];
      root.classList.toggle('sel', edit && sel >= 0);
      for (let i = 0; i < NN; i++) {
        const ch = at(i), t = tentAt(i), c = cells[i], curHere = edit && cur && cur.i === i ? (cur.d === 1 ? 'a' : 'd') : '';
        const sig = ch + (t ? t.l + (t.b ? 'B' : 'T') : '') + (lastSq.includes(i) ? 'L' : '') + curHere;
        if (sig === c.sig) continue;
        c.sig = sig;
        let cls = 'wc';
        const kids = [];
        if (ch !== '.' || t) {
          const l = t ? t.l : ch.toLowerCase(), bl = t ? t.b : ch !== l;
          cls += ' tl' + (bl ? ' bk' : '') + (t ? ' tn' : '') + (!t && lastSq.includes(i) ? ' lst' : '');
          kids.push(el('b', null, l.toUpperCase()));
          if (!bl) kids.push(el('i', null, VAL[l]));
        } else if (i === CEN) { cls += ' start'; kids.push(el('span', { class: 'wl' }, '★')); }
        else if (PREM[i]) { cls += PCLS[PREM[i]]; kids.push(el('span', { class: 'wl' }, PLBL[PREM[i]])); }
        if (curHere) { cls += ' cur'; if (ch === '.' && !t) kids.push(el('span', { class: 'wa' }, curHere === 'a' ? '▶' : '▼')); }
        c.className = cls; c.replaceChildren(...kids);
      }

      // the rack is only rebuilt when it changes, and never mid-drag, so the tile under the finger stays put
      const fr = edit ? free() : [], sig = fr.map(k => k + V.rack[k]).join() + '|' + sel;
      if (sig !== rackSig && !(drag && drag.on)) {
        rackSig = sig;
        rackEl.replaceChildren(...fr.map(k => el('div', { class: 'rt' + (V.rack[k] === '?' ? ' bk' : '') + (k === sel ? ' on' : ''), 'data-k': k }, ...face(V.rack[k]))),
          ...Array.from({ length: Math.max(0, RACK - fr.length) }, () => el('div', { class: 'rt empty' })));
      }
      rackEl.hidden = btns.hidden = prevEl.hidden = !edit;

      // the play so far, or why it won't do
      const res = edit && tent.length ? judge(V.b.join(''), tent, G.Lex && Lex.ready ? Lex.has : null) : null;
      prevEl.classList.toggle('bad', !!(res && res.err));
      if (res && res.err) prevEl.replaceChildren(res.err);
      else if (res) fill(prevEl, res.words.map(([w, p]) => el('span', { class: 'wr-w' }, w.toUpperCase(), el('small', null, p))),
        res.full ? el('span', { class: 'wr-w full' }, 'FULL RACK', el('small', null, '+' + FULL)) : null, el('b', null, '= ' + res.pts));
      else prevEl.replaceChildren(el('span', { class: 'muted' }, !mine ? '' : cur ? (U.touch ? 'Tap tiles to spell along the arrow. Tap the square again to turn it.' : 'Type to spell along the arrow. Space turns it, Backspace takes back.')
        : U.touch ? 'Tap a tile, then a square, or drag it. Tap a square first to spell a word.' : 'Click a tile, then a square, or drag it. Click a square to type a word.'));
      const ok = mine && res && !res.err && Date.now() - busy > 1500;
      bPlay.classList.toggle('off', !ok);
      bPlay.lastChild.textContent = res && !res.err ? res.pts + ' POINTS' : '';
      bRecall.classList.toggle('off', !tent.length);
      bSwap.classList.toggle('off', !mine || V.bag < RACK);
      const armed = mine && Date.now() - passArm < 3000;
      bPass.classList.toggle('off', !mine); bPass.classList.toggle('hot', armed); bPass.classList.toggle('ghost', !armed);
      bPass.firstChild.textContent = armed ? 'SURE?' : 'PASS';

      // who's who
      pls.style.setProperty('--np', V.p.length);
      pls.replaceChildren(...V.p.map(p => el('div', { class: 'wr-pl' + (p.id === V.turn ? ' on' : '') + (p.id === me ? ' me' : '') },
        el('span', { class: 'wr-pn' }, (pl(p.id) || p).name || '?'), el('b', { class: 'wr-ps' }, p.s), el('small', null, p.n + (p.n === 1 ? ' tile' : ' tiles')))));
      turnEl.textContent = V.end ? 'Game over' : V.turn === me ? 'Your turn' : who(V.turn) + ((pl(V.turn) || {}).cpu ? ' is thinking…' : '\'s turn');
      turnEl.classList.toggle('mine', mine);
      bagEl.textContent = 'BAG ' + V.bag;
      fill(lastEl, lastLine());
      ending();
      clock();
    }

    function lastLine() {
      const L = V.last;
      if (!L) return [el('span', null, 'No words yet. The first one must cover ★.')];
      const n = el('b', null, who(L.p));
      if (L.k === 'play') return [n, ' played ', ...L.w.map(([w, p]) => el('span', { class: 'wr-w' }, w.toUpperCase(), el('small', null, p))),
        L.full ? el('span', { class: 'wr-w full' }, 'FULL RACK', el('small', null, '+' + FULL)) : null, ' for ', el('b', { class: 'wr-pts' }, L.pts)];
      if (L.k === 'swap') return [n, ' exchanged ' + L.n + (L.n === 1 ? ' tile.' : ' tiles.')];
      if (L.k === 'time') return [n, ' ran out of time.'];
      return [n, ' passed.'];
    }

    function ending() {
      endEl.hidden = !V.end;
      if (!V.end) return;
      const E = V.end;
      endEl.replaceChildren(el('h3', null, 'GAME OVER'),
        el('p', null, E.why === 'out' ? who(E.by) + ' used every tile and ' + (E.by === me ? 'take' : 'takes') + ' the value of the tiles left.' : 'Everyone passed twice in a row, so everyone loses the value of their tiles.'),
        ...V.p.map(p => {
          const left = E.racks[p.id] || [], d = E.adj[p.id] || 0;
          return el('div', { class: 'wr-er' }, el('b', null, (pl(p.id) || p).name || '?'),
            el('span', { class: 'wr-mts' }, ...(left.length ? left.map(l => el('i', { class: 'wr-mt' + (l === '?' ? ' bk' : '') }, l === '?' ? '' : l.toUpperCase())) : [el('small', { class: 'muted' }, 'no tiles')])),
            el('span', { class: 'wr-adj' + (d > 0 ? ' up' : d < 0 ? ' down' : '') }, (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d)));
        }));
    }

    function clock() {
      if (!V || V.left == null || V.end) { clockEl.hidden = true; return; }
      const ms = Math.max(0, V.left - (Date.now() - got)), sec = Math.ceil(ms / 1000);
      clockEl.hidden = false; clockEl.textContent = U.clock(ms);
      clockEl.classList.toggle('low', ms <= 15000);
      if (myTurn() && sec <= 10 && sec > 0 && sec !== tick) { tick = sec; api.sfx('tick'); }
    }
    const timer = setInterval(clock, 250);

    /* ---- a new view: keep what I was doing unless the view makes it stale */
    function update(v) {
      if (!v || !Array.isArray(v.b) || !Array.isArray(v.p)) return;
      const prev = V; V = v; got = Date.now();
      const rk = v.rack ? v.rack.join('') : '', prk = prev && prev.rack ? prev.rack.join('') : null;
      if (rk !== prk) {
        // a new rack (I played, swapped, or it's the start): my tiles go back; letters I still have keep their places
        const old = prev && prev.rack ? order.map(k => prev.rack[k]) : [], rest = v.rack ? v.rack.map((l, k) => k) : [];
        tent = []; sel = -1; order = [];
        for (const l of old) { const j = rest.findIndex(k => v.rack[k] === l); if (j >= 0) order.push(rest.splice(j, 1)[0]); }
        order.push(...rest);
        if (drag) { endDrag(); }
        if (modal) closeModal();
      }
      tent = tent.filter(t => at(t.i) === '.');        // someone played on a square I was using
      if (drag && drag.src.t && !tent.includes(drag.src.t)) endDrag();
      if (!canEdit()) { cur = null; sel = -1; if (modal) closeModal(); }
      const moved = prev && v.mv !== prev.mv;
      if (rk !== prk || moved) busy = 0;       // my move went through (a refusal comes as a toast; busy runs out by itself)
      if (moved) {
        tick = -1; passArm = 0;
        if (modal && modal.swap) closeModal();
        if (!v.end && v.turn === me && prev.turn !== me) api.sfx('ping');
        else if (v.last && v.last.k === 'play') api.sfx(v.last.full ? 'solve' : 'ok');
      }
      paint();
      if (moved && v.last && v.last.k === 'play') for (const i of v.last.sq) {
        const c = cells[i]; c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
        setTimeout(() => c.classList.remove('pop'), 450);
      }
    }

    /* ---- putting tiles down and taking them back */
    function put(k, i, l, then) {        // rack tile k onto empty square i (l: what a blank stands for)
      if (!canEdit() || at(i) !== '.' || tentAt(i) || !free().includes(k)) return;
      const t = V.rack[k];
      if (t === '?' && !l) { paint(); askBlank(x => { if (V.rack && V.rack[k] === '?') put(k, i, x, then); }); return; }
      tent.push({ i, k, l: t === '?' ? l : t, b: t === '?' });
      sel = -1; api.sfx('key');
      if (then) then(i);
      paint();
    }
    function back(t) { tent = tent.filter(x => x !== t); api.sfx('del'); paint(); }
    function advance(i) { if (!cur) return; const j = step(i, cur.d); cur = j < 0 ? null : { i: j, d: cur.d }; }
    function atCursor(k, l) {          // rack tile k on the cursor, or the next empty square after it
      let i = cur.i;
      while (i >= 0 && filled(i)) i = step(i, cur.d);
      if (i < 0) { api.sfx('bad'); return; }
      put(k, i, l, advance);
    }
    function typed(l) {
      if (filled(cur.i) && letterAt(cur.i) === l) { advance(cur.i); paint(); return; }   // typing the letter already there steps over it
      const fr = free();
      let k = fr.find(k => V.rack[k] === l);
      if (k != null) { atCursor(k); return; }
      k = fr.find(k => V.rack[k] === '?');
      if (k != null) { atCursor(k, l); return; }
      no('There\'s no ' + l.toUpperCase() + ' on your rack.');
    }
    function untype() {
      const t = tent.pop();
      if (!t) return;
      cur = { i: t.i, d: cur ? cur.d : 1 }; api.sfx('del'); paint();
    }
    function tapRack(k) {
      if (!canEdit()) return;
      if (cur) { atCursor(k); return; }
      sel = sel === k ? -1 : k; api.sfx('key'); paint();
    }
    function tapCell(i) {
      if (!canEdit()) return;
      const t = tentAt(i);
      if (t) { back(t); return; }
      if (at(i) !== '.') return;
      if (sel >= 0) { put(sel, i); return; }
      // a tap puts the cursor here; tapping it again turns it down, then puts it away
      cur = cur && cur.i === i ? (cur.d === 1 ? { i, d: N } : null) : { i, d: cur ? cur.d : 1 };
      api.sfx('key'); paint();
    }

    /* ---- drag and drop (pointer events, so mouse, pen and touch all work); a press without a move is a tap */
    function down(e) {
      if (!V || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const rt = e.target.closest('.rt'), wc = e.target.closest('.wc');
      let src = null, node = null;
      if (rt && rackEl.contains(rt) && rt.dataset.k != null) { src = { k: +rt.dataset.k }; node = rt; }
      else if (wc && board.contains(wc)) { const i = +wc.dataset.i, t = tentAt(i); src = t ? { t } : { i }; node = wc; }
      if (!src) return;
      if (src.i == null) e.preventDefault();          // a tile: no text selection
      endDrag();
      drag = { src, node, id: e.pointerId, x: e.clientX, y: e.clientY, on: false, ghost: null, over: null };
      window.addEventListener('pointermove', dmove); window.addEventListener('pointerup', dup); window.addEventListener('pointercancel', dcancel);
    }
    function dmove(e) {
      const d = drag;
      if (!d || e.pointerId !== d.id) return;
      if (!d.on) {
        if (d.src.i != null || !canEdit() || Math.hypot(e.clientX - d.x, e.clientY - d.y) < 7) return;
        d.on = true;
        if (sel >= 0) {            // drop the tap selection without redrawing the rack under the finger
          sel = -1; root.classList.remove('sel');
          const o = rackEl.querySelector('.rt.on'); if (o) o.classList.remove('on');
        }
        if (cur) { const c = cells[cur.i]; cur = null; c.sig = null; c.classList.remove('cur'); const a = c.querySelector('.wa'); if (a) a.remove(); }   // dragging, not typing
        const l = d.src.t ? d.src.t.l : V.rack[d.src.k], bl = d.src.t ? d.src.t.b : l === '?';
        d.ghost = el('div', { class: 'rt wr-ghost' + (bl ? ' bk' : '') }, ...(d.src.t ? [l.toUpperCase(), bl ? null : el('i', null, VAL[l])] : face(l)));
        document.body.append(d.ghost);
        const n = d.src.t ? cells[d.src.t.i] : rackEl.querySelector('.rt[data-k="' + d.src.k + '"]');
        if (n) { n.classList.add('lift'); d.node = n; }
      }
      d.ghost.style.left = e.clientX + 'px'; d.ghost.style.top = e.clientY + 'px';
      const h = document.elementFromPoint(e.clientX, e.clientY), c = h && h.closest('.wc');
      const over = c && board.contains(c) && (!c.classList.contains('tl') || c.classList.contains('tn')) ? c : null;
      if (over !== d.over) { if (d.over) d.over.classList.remove('hov'); d.over = over; if (over) over.classList.add('hov'); }
    }
    function dup(e) {
      const d = drag;
      if (!d || e.pointerId !== d.id) return;
      endDrag();
      if (!d.on) { if (d.src.k != null) tapRack(d.src.k); else if (d.src.t) back(d.src.t); else tapCell(d.src.i); return; }
      drop(d.src, document.elementFromPoint(e.clientX, e.clientY));
    }
    function dcancel(e) { if (drag && e.pointerId === drag.id) { endDrag(); paint(); } }
    function endDrag() {
      window.removeEventListener('pointermove', dmove); window.removeEventListener('pointerup', dup); window.removeEventListener('pointercancel', dcancel);
      if (drag) { if (drag.ghost) drag.ghost.remove(); if (drag.over) drag.over.classList.remove('hov'); if (drag.node) drag.node.classList.remove('lift'); }
      drag = null;
    }
    function drop(src, tgt) {
      if (!canEdit()) return;
      const c = tgt && tgt.closest ? tgt.closest('.wc') : null;
      if (c && board.contains(c)) {
        const i = +c.dataset.i, there = tentAt(i);
        if (at(i) !== '.' || (src.t && there === src.t)) { paint(); return; }
        if (there) tent = tent.filter(x => x !== there);                 // a tile of mine there goes back to the rack
        if (src.t) { src.t.i = i; api.sfx('key'); paint(); } else put(src.k, i);
        return;
      }
      const r = tgt && tgt.closest ? tgt.closest('.wr-rack') : null;
      if (r === rackEl) {                                                 // onto the rack: back, and in the place it was dropped
        const k = src.t ? src.t.k : src.k, on = tgt.closest('.rt'), to = on && on.dataset.k != null ? +on.dataset.k : null;
        if (src.t) tent = tent.filter(x => x !== src.t);
        if (to !== k) { order = order.filter(x => x !== k); if (to == null) order.push(k); else order.splice(order.indexOf(to), 0, k); }
        api.sfx(src.t ? 'del' : 'key'); paint();
        return;
      }
      if (src.t) back(src.t); else paint();                              // anywhere else: a board tile goes home
    }

    /* ---- the buttons */
    function no(text) {
      api.sfx('bad'); api.toast(text, 'bad');
      prevEl.classList.remove('shake'); void prevEl.offsetWidth; prevEl.classList.add('shake');
    }
    function play() {
      if (!canEdit()) return;
      if (!myTurn()) return no('Wait for your turn.');
      if (!tent.length) return no('Put some tiles on the board first.');
      const r = judge(V.b.join(''), tent, G.Lex && Lex.ready ? Lex.has : null);
      if (r.err) return no(r.err);
      if (Date.now() - busy < 1500) return;
      busy = Date.now(); cur = null;
      api.act({ place: tent.map(t => ({ r: t.i / N | 0, c: t.i % N, l: t.l, b: t.b })) });
      paint();
    }
    function shuffle() { if (!canEdit()) return; order = U.shuffle(order.slice()); sel = -1; api.sfx('key'); paint(); }
    function recall() { if (!tent.length) return; tent = []; sel = -1; cur = null; api.sfx('del'); paint(); }
    function pass() {
      if (!canEdit()) return;
      if (!myTurn()) return no('Wait for your turn.');
      if (Date.now() - passArm > 3000) { passArm = Date.now(); api.sfx('key'); paint(); setTimeout(paint, 3050); return; }   // a second tap passes
      if (Date.now() - busy < 1500) return;
      passArm = 0; busy = Date.now(); api.act({ pass: true }); paint();
    }
    function exchange() {
      if (!canEdit()) return;
      if (!myTurn()) return no('Wait for your turn.');
      if (V.bag < RACK) return no('You can only exchange while the bag holds at least 7 tiles.');
      const pick = new Set(), rack = V.rack;
      const go = el('button', { class: 'btn' }, 'EXCHANGE');
      const sync = () => { go.textContent = pick.size ? 'EXCHANGE ' + pick.size : 'EXCHANGE'; go.classList.toggle('off', !pick.size); };
      const tiles = order.map(k => {
        const b = el('button', { class: 'rt' + (rack[k] === '?' ? ' bk' : ''), onclick: () => { if (pick.has(k)) pick.delete(k); else pick.add(k); b.classList.toggle('on', pick.has(k)); api.sfx('key'); sync(); } }, ...face(rack[k]));
        return b;
      });
      go.onclick = () => {
        if (!pick.size) return no('Pick the tiles to put back.');
        if (!V.rack || V.rack.join('') !== rack.join('') || !myTurn()) { m.close(); return; }
        m.close(); tent = []; busy = Date.now();
        api.act({ exchange: [...pick].map(k => rack[k]) });
        paint();
      };
      const m = popup('EXCHANGE', [el('p', { class: 'muted small' }, 'Pick the tiles to put back in the bag. You draw as many new ones, and your turn ends.'), el('div', { class: 'wr-xr' }, ...tiles)],
        [go, el('button', { class: 'btn ghost', onclick: () => { api.sfx('back'); m.close(); } }, 'CANCEL')]);
      m.swap = true; sync();
    }

    /* ---- pop-ups in the app's style (the Esc key and a click outside close them). A pop-up opened by a tap
       ignores clicks for a moment: on phones the tap's own click lands a few ms later, on whatever is now under it */
    function popup(title, body, foot) {
      closeModal();
      const m = {}, t0 = Date.now();
      const ov = el('div', { class: 'overlay', onclick: e => { if (e.target === ov && Date.now() - t0 >= 350) { api.sfx('back'); m.close(); } } },
        el('div', { class: 'modal wr-modal' },
          el('div', { class: 'mhead' }, el('h2', null, title), el('button', { class: 'mclose', 'aria-label': 'Close', onclick: () => { api.sfx('back'); m.close(); } }, '×')),
          el('div', { class: 'mbody' }, ...body), foot ? el('div', { class: 'mfoot' }, ...foot) : null));
      ov.addEventListener('click', e => { if (Date.now() - t0 < 350) { e.stopPropagation(); e.preventDefault(); } }, true);
      m.close = () => { ov.remove(); if (modal === m) modal = null; };
      document.body.append(ov); modal = m;
      return m;
    }
    function closeModal() { if (modal) modal.close(); }
    function askBlank(done) {
      const m = popup('BLANK TILE', [el('p', { class: 'muted small' }, 'Which letter should it be? A blank scores 0.'),
        el('div', { class: 'wr-abc' }, ...Array.from(A, l => el('button', { class: 'rt', onclick: () => m.letter(l) }, l.toUpperCase())))]);
      m.letter = l => { m.close(); done(l); };
    }

    /* ---- the keyboard: click a square, type the word (Space turns the arrow, Backspace takes back, Enter plays).
       It listens first (capture) and only takes the keys it uses, so the app's own keys still work */
    function key(e) {
      if (!V || !canEdit() || e.ctrlKey || e.metaKey || e.altKey || !root.isConnected) return;
      const t = e.target, k = e.key;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      const eat = () => { e.preventDefault(); e.stopPropagation(); };
      if (modal) { if (modal.letter && /^[a-z]$/i.test(k)) { eat(); modal.letter(k.toLowerCase()); } return; }
      if (document.querySelector('.overlay')) return;                     // someone else's pop-up
      if (/^[a-z]$/i.test(k)) { if (!cur) return; eat(); if (!e.repeat) typed(k.toLowerCase()); }
      else if (k === ' ') { if (!cur) return; eat(); cur = { i: cur.i, d: cur.d === 1 ? N : 1 }; paint(); }
      else if (k === 'Backspace') { if (!tent.length) return; eat(); untype(); }
      else if (k === 'Enter') { if (!tent.length) return; eat(); if (!e.repeat) play(); }
      else if (/^Arrow/.test(k)) {
        if (!cur) return;
        eat();
        const [dr, dc] = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k] || [0, 0];
        cur = { i: U.clamp((cur.i / N | 0) + dr, 0, N - 1) * N + U.clamp(cur.i % N + dc, 0, N - 1), d: dc ? 1 : dr ? N : cur.d };
        paint();
      }
    }
    document.addEventListener('keydown', key, true);

    return {
      update,
      destroy() { clearInterval(timer); endDrag(); closeModal(); document.removeEventListener('keydown', key, true); root.remove(); },
    };
  }

  G.Games.add({
    id: 'wright', name: 'Wordwright', blurb: 'Build crossing words from your rack of tiles', players: [2, 4], lex: true,
    howto: [
      'You have a rack of 7 letter tiles. On your turn, place some of them in one line (across or down) to make a word that joins the words already on the board. The first word must cover the centre square.',
      'Every word your tiles make counts, including the ones they cross. Each word scores its letters\' points; rarer letters are worth more. The two blank tiles stand for any letter and score nothing.',
      'Premium squares count only when you first cover them: 2L and 3L multiply that letter, 2W and 3W the whole word. Use all 7 tiles in one go for a FULL RACK bonus of 35.',
      'HOW TO PLACE',
      ['Tap a tile in your rack, then a square (or drag it there). Tap a placed tile to take it back.', 'Or tap a square and type: the letters go along the arrow (Space turns it across or down).', 'PLAY shows the words and points first; RECALL takes everything back; EXCHANGE swaps tiles with the bag (your turn ends); PASS skips.'],
      'You draw back up to 7 after each move. The game ends when the bag is empty and someone uses their last tile (they gain everyone else\'s leftover points), or when everyone has passed twice in a row. Most points wins.',
    ],
    options: [{ key: 'time', label: 'TIME PER TURN', values: [[0, 'None'], [120, '2 min'], [300, '5 min']], def: 0 }],
    setup, view,
    move(s, pid, m, now) { try { return act(s, pid == null ? null : String(pid), m, T(now)); } catch (e) { return { err: 'That move couldn\'t be played.' }; } },
    turn: s => s && !s.end ? [s.ps[s.t].id] : [],
    due: (s, now) => s && !s.end && s.dl && T(now) >= s.dl + GRACE ? s.ps[s.t].id : null,
    /* the player's turn is a pass. due() decides when time is up; the host also calls this to skip a player who
       left or a CPU whose move failed, so it doesn't check the clock itself */
    timeout(s, pid, now) {
      if (s && !s.end && s.ps && s.ps[s.t] && s.ps[s.t].id === String(pid)) scoreless(s, { p: s.ps[s.t].id, k: 'time' }, T(now));
      return { state: s };
    },
    result,
    cpu(s, pid, level) {
      return new Promise(res => setTimeout(() => { let m; try { m = think(s, String(pid), level); } catch (e) { m = { pass: true }; } res(m); }, 0));
    },
    mount,
    /* for tools/test_wright.js */
    lib: { COUNT, VAL, PREM, CEN, FULL, judge, gen, think, leaveValue },
  });
})();
