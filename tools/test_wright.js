/* test_wright.js -- checks the Wordwright rules and CPU players in node:  node tools/test_wright.js */
'use strict';
const path = require('path'), assert = require('assert');
global.window = global;
if (!global.crypto) global.crypto = require('crypto').webcrypto;
for (const f of ['util.js', 'dict.js', 'lexicon.js', 'games.js', 'wright.js']) require(path.join(__dirname, '..', 'js', f));
const W = window.Games.get('wright'), L = W.lib;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

/* a state for two players (Ann, Bob) with a board, racks and anything else set by hand */
const PS = [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bob' }];
function mk(o = {}) {
  const s = W.setup({ seed: 7, time: o.time || 0 }, o.ps || PS, 0);
  if (o.board) s.b = o.board;
  if (o.racks) Object.assign(s.racks, o.racks);
  if (o.bag) s.bag = o.bag;
  return s;
}
/* a board with words on it: [row, col, 'a' | 'd', 'word'] (capitals are blanks) */
function board(...words) {
  const g = Array.from({ length: 15 }, () => Array(15).fill('.'));
  for (const [r, c, d, w] of words) for (let k = 0; k < w.length; k++) g[r + (d === 'd' ? k : 0)][c + (d === 'a' ? k : 0)] = w[k];
  return g.map(x => x.join(''));
}
/* the tiles of a word to place (capitals are blanks) */
const tiles = (r, c, d, w) => [...w].map((ch, k) => ({ r: r + (d === 'd' ? k : 0), c: c + (d === 'a' ? k : 0), l: ch.toLowerCase(), b: ch !== ch.toLowerCase() }));
const ok = (s, pid, m, now = 0) => { const r = W.move(s, pid, m, now); assert.ok(!r.err, 'refused: ' + r.err + ' ' + JSON.stringify(m)); return r.state; };
const bad = (s, pid, m, re, now = 0) => {
  const before = JSON.stringify(s);
  let r;
  assert.doesNotThrow(() => { r = W.move(s, pid, m, now); }, 'threw on ' + JSON.stringify(m));
  assert.ok(r && r.err, 'accepted ' + JSON.stringify(m));
  if (re) assert.ok(re.test(r.err), 'wrong reason "' + r.err + '" for ' + JSON.stringify(m));
  assert.strictEqual(JSON.stringify(s), before, 'a refused move changed the state');
  return r.err;
};
const P = i => [i / 15 | 0, i % 15];
const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };

/* ------------------------------------------------------------------ tiles and board */
t('the bag: 100 letters and 2 blanks, every letter at least once', () => {
  const n = Object.values(L.COUNT).reduce((a, b) => a + b, 0);
  assert.strictEqual(n, 102); assert.strictEqual(L.COUNT['?'], 2);
  for (const c of 'abcdefghijklmnopqrstuvwxyz') { assert.ok(L.COUNT[c] >= 1, c); assert.ok(L.VAL[c] >= 1 && L.VAL[c] <= 10, c); }
  assert.strictEqual(L.VAL['?'], 0);
  const s = W.setup({}, [...PS, { id: 'p3', name: 'Cy' }], 0), all = {};
  assert.strictEqual(s.bag.length, 102 - 21);
  for (const x of [...s.bag, ...Object.values(s.racks).flat()]) all[x] = (all[x] || 0) + 1;
  assert.deepStrictEqual(all, Object.fromEntries(Object.keys(L.COUNT).map(k => [k, L.COUNT[k]])));
  for (const p of s.ps) assert.strictEqual(s.racks[p.id].length, 7);
});
t('the counts follow letter frequency in the dictionary (base words of 2-8 letters)', () => {
  const D = window.DICT, words = new Set();
  for (const n in D) for (let i = 0; i < D[n].length; i += +n) words.add(D[n].substr(i, +n));
  const f = {}; let tot = 0;
  for (const w of words) if (w.length <= 8 && !(w.length > 2 && w.endsWith('s') && words.has(w.slice(0, -1)))) for (const c of w) { f[c] = (f[c] || 0) + 1; tot++; }
  for (const c in f) {
    assert.ok(Math.abs(L.COUNT[c] - Math.max(1, f[c] / tot * 97.2)) < 1, c + ' count ' + L.COUNT[c]);
    assert.strictEqual(L.VAL[c], Math.max(1, Math.round(1.5 * Math.log2(f.e / f[c]))), c + ' value');
  }
});
t('the layout: 56 premiums, symmetric 8 ways, a plain start square in the centre', () => {
  const n = [0, 0, 0, 0, 0];
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
    const p = L.PREM[r * 15 + c]; n[p]++;
    for (const [y, x] of [[c, r], [14 - r, c], [r, 14 - c], [14 - c, 14 - r]]) assert.strictEqual(L.PREM[y * 15 + x], p, r + ',' + c);
  }
  assert.deepStrictEqual(n.slice(1), [16, 16, 16, 8]);       // 2L 3L 2W 3W
  assert.strictEqual(L.PREM[L.CEN], 0);
  for (const i of [0, 14, 210, 224, 7, 105]) assert.notStrictEqual(L.PREM[i], 4, 'no 3W on corners or mid-edges');
});

/* ------------------------------------------------------------------ placing */
t('the first word must cover the centre and have two letters', () => {
  const s = mk({ racks: { p1: ['c', 'r', 'a', 'n', 'e', 's', 't'] } });
  bad(s, 'p1', { place: tiles(0, 0, 'a', 'cat') }, /centre/);
  bad(s, 'p1', { place: tiles(7, 8, 'a', 'cat') }, /centre/);
  bad(s, 'p1', { place: tiles(7, 7, 'a', 'a') }, /two letters/);
  ok(s, 'p1', { place: tiles(7, 5, 'a', 'cat') });
  assert.strictEqual(s.b[7], '.....cat.......');
  assert.strictEqual(s.racks.p1.length, 7); assert.strictEqual(s.bag.length, 102 - 14 - 3);
  assert.deepStrictEqual(W.turn(s), ['p2']);
  const s2 = mk({ racks: { p1: ['c', 'r', 'a', 'n', 'e', 's', 't'] } });
  ok(s2, 'p1', { place: tiles(4, 7, 'd', 'cat') .concat(tiles(7, 7, 'd', 's')) });  // CATS down through the centre
  assert.strictEqual(s2.b.map(r => r[7]).join('').replace(/\./g, ''), 'cats');
});
t('one line, no gaps, joined to the board', () => {
  const B = board([7, 6, 'a', 'cat']), R = { p1: ['a', 't', 'o', 'n', 'e', 's', 'r'] };
  bad(mk({ board: B, racks: R }), 'p1', { place: [{ r: 6, c: 6, l: 'a' }, { r: 5, c: 7, l: 't' }] }, /one row or one column/);
  bad(mk({ board: B, racks: R }), 'p1', { place: tiles(2, 2, 'a', 'tone') }, /join/);
  bad(mk({ board: B, racks: R }), 'p1', { place: [{ r: 7, c: 9, l: 's' }, { r: 7, c: 11, l: 'o' }] }, /gaps/);
  bad(mk({ board: B, racks: R }), 'p1', { place: [{ r: 8, c: 6, l: 'a' }, { r: 10, c: 6, l: 'e' }] }, /gaps/);
  // through a tile on the board: E + (A on the board) + T = EAT down column 7
  const s = mk({ board: B, racks: R });
  ok(s, 'p1', { place: [{ r: 6, c: 7, l: 'e' }, { r: 8, c: 7, l: 't' }] });
  assert.deepStrictEqual(s.last.w, [['eat', 4]]);
  // a single tile that makes a word one way only, and one that makes words both ways
  const s2 = mk({ board: B, racks: R });
  ok(s2, 'p1', { place: [{ r: 7, c: 9, l: 's' }] });
  assert.deepStrictEqual(s2.last.w, [['cats', 8]]);
});
t('words that aren\'t in the list are refused, naming them', () => {
  const s = mk({ board: board([7, 6, 'a', 'cat']), racks: { p1: ['x', 'q', 'z', 'a', 'e', 'i', 'o'] } });
  const e = bad(s, 'p1', { place: [{ r: 7, c: 9, l: 'q' }] }, /CATQ isn't in the word list/);
  assert.ok(e);
  bad(s, 'p1', { place: [{ r: 8, c: 6, l: 'q' }, { r: 8, c: 7, l: 'z' }] }, /aren't in the word list/);
});
t('cross words and premiums (letter premiums only under new tiles)', () => {
  // CAT on row 7 at columns 7-9; XI below at (8,8) and (8,9), and (8,9) is a 2L
  assert.strictEqual(L.PREM[8 * 15 + 9], 1); assert.strictEqual(L.PREM[8 * 15 + 8], 0);
  const s = mk({ board: board([7, 7, 'a', 'cat']), racks: { p1: ['x', 'i', 'e', 'e', 'e', 'e', 'e'] } });
  ok(s, 'p1', { place: tiles(8, 8, 'a', 'xi') });
  // XI = 8 + 1x2 = 10, AX = 1 + 8 = 9, TI = 2 + 1x2 = 4
  assert.deepStrictEqual(s.last.w, [['xi', 10], ['ax', 9], ['ti', 4]]);
  assert.strictEqual(s.last.pts, 23); assert.strictEqual(s.sc.p1, 23);
  // a 3L under a tile already on the board doesn't count again: CRANE with C on the 3L at (7,4)
  assert.strictEqual(L.PREM[7 * 15 + 4], 2);
  const s2 = mk({ board: board([7, 4, 'a', 'crane']), racks: { p1: ['m', 'a', 'g', 'i', 'e', 'e', 'e'] } });
  // MAGIC down column 4 onto that C, with M on the 2W at (3,4): (3 + 1 + 3 + 1 + 3) x 2
  assert.strictEqual(L.PREM[3 * 15 + 4], 3);
  ok(s2, 'p1', { place: tiles(3, 4, 'd', 'magi') });
  assert.deepStrictEqual(s2.last.w, [['magic', 22]]);
});
t('the first move: a letter premium in the opening line', () => {
  const s = mk({ racks: { p1: ['c', 'r', 'a', 'n', 'e', 'x', 'x'] } });
  ok(s, 'p1', { place: tiles(7, 4, 'a', 'crane') });       // C on the 3L at (7,4): 9 + 1 + 1 + 1 + 1
  assert.strictEqual(s.last.pts, 13);
});
t('a word premium: 3W', () => {
  assert.strictEqual(L.PREM[3], 4);
  const s = mk({ board: board([1, 3, 'd', 'on']), racks: { p1: ['d', 'e', 'e', 'e', 'e', 'e', 'e'] } });
  ok(s, 'p1', { place: [{ r: 0, c: 3, l: 'd' }] });       // DON down column 3, D on the 3W: (2 + 2 + 1) x 3
  assert.deepStrictEqual(s.last.w, [['don', 15]]);
});
t('blanks score 0, are marked on the board, and need a blank on the rack', () => {
  const B = board([7, 4, 'a', 'crane']);
  bad(mk({ board: B, racks: { p1: ['m', 'a', 'g', 'i', 'e', 'e', 'e'] } }), 'p1', { place: tiles(3, 4, 'd', 'mAgi') }, /rack/);
  const s = mk({ board: B, racks: { p1: ['m', '?', 'g', 'i', 'e', 'e', 'e'] } });
  ok(s, 'p1', { place: tiles(3, 4, 'd', 'mAgi') });
  assert.deepStrictEqual(s.last.w, [['magic', 20]]);       // (3 + 0 + 3 + 1 + 3) x 2
  assert.strictEqual(s.b[4][4], 'A');
  assert.ok(!s.racks.p1.includes('?') || s.racks.p1.filter(x => x === '?').length === 1);
  // a word through the blank later still scores it 0
  const s2 = mk({ board: s.b, racks: { p1: ['n', 'd', 'e', 'e', 'e', 'e', 'e'] } });
  ok(s2, 'p1', { place: [{ r: 4, c: 5, l: 'n' }, { r: 4, c: 6, l: 'd' }] });   // AND across row 4: 0 + 1 + 2
  assert.deepStrictEqual(s2.last.w, [['and', 3]]);
  // a blank standing for a letter is fine even when the rack has that letter
  ok(mk({ racks: { p1: ['c', 'a', '?', 'e', 'e', 'e', 'e'] } }), 'p1', { place: tiles(7, 6, 'a', 'caT') });
});
t('the full-rack bonus: +35 for all 7 tiles', () => {
  const w = ['painter', 'retains', 'station', 'strange', 'planets'].find(x => Lex.has(x));
  assert.ok(w, 'no 7-letter test word');
  const s = mk({ racks: { p1: [...w] } });
  ok(s, 'p1', { place: tiles(7, 4, 'a', w) });             // (7,4) and (7,10) are both 3L
  const sum = [...w].reduce((a, c) => a + L.VAL[c], 0) + 2 * L.VAL[w[0]] + 2 * L.VAL[w[6]];
  assert.strictEqual(s.last.pts, sum + 35); assert.ok(s.last.full);
  assert.strictEqual(s.racks.p1.length, 7);
  const j = L.judge(s.b.join(''), [{ i: 6 * 15 + 4, l: 'a', b: false }], null);
  assert.ok(!j.full);
});

/* ------------------------------------------------------------------ exchange and pass */
t('exchange: same rack size and bag size, tiles go back in; needs 7 in the bag and tiles you hold', () => {
  const s = mk({ racks: { p1: ['q', 'q', 'v', 'a', 'e', '?', 't'] } });
  const bag = s.bag.length, before = [...s.bag, ...s.racks.p1].sort().join('');
  bad(s, 'p1', { exchange: ['z'] }, /rack/);
  bad(s, 'p1', { exchange: ['q', 'q', 'q'] }, /rack/);
  ok(s, 'p1', { exchange: ['q', 'Q', '?'] });
  assert.strictEqual(s.racks.p1.length, 7); assert.strictEqual(s.bag.length, bag);
  assert.strictEqual([...s.bag, ...s.racks.p1].sort().join(''), before);
  assert.deepStrictEqual(s.last, { p: 'p1', k: 'swap', n: 3 });
  assert.strictEqual(s.pass, 1); assert.deepStrictEqual(W.turn(s), ['p2']);
  const s2 = mk({ bag: ['a', 'b', 'c', 'd', 'e', 'f'] });
  bad(s2, 'p1', { exchange: [s2.racks.p1[0]] }, /at least 7/);
  s2.bag.push('g'); ok(s2, 'p1', { exchange: [s2.racks.p1[0]] });
});
t('pass: scoreless turns add up; a play resets them', () => {
  const s = mk({ racks: { p2: ['c', 'a', 't', 'e', 'e', 'e', 'e'] } });
  ok(s, 'p1', { pass: true }); assert.strictEqual(s.pass, 1); assert.deepStrictEqual(s.last, { p: 'p1', k: 'pass' });
  ok(s, 'p2', { place: tiles(7, 6, 'a', 'cat') }); assert.strictEqual(s.pass, 0);
  ok(s, 'p1', { pass: true }); ok(s, 'p2', { pass: true }); ok(s, 'p1', { exchange: [s.racks.p1[0]] });
  assert.strictEqual(W.result(s), null);
  ok(s, 'p2', { pass: true });
  assert.ok(W.result(s), 'four scoreless turns in a row end a 2-player game');
});

/* ------------------------------------------------------------------ the end */
t('the end: playing out with the bag empty', () => {
  const s = mk({ board: board([7, 6, 'a', 'cat']), racks: { p1: ['s'], p2: ['q', 'z', '?'] }, bag: [] });
  s.sc = { p1: 50, p2: 60 };
  ok(s, 'p1', { place: [{ r: 7, c: 9, l: 's' }] });        // CATS: 8
  assert.strictEqual(s.end.why, 'out'); assert.strictEqual(s.end.by, 'p1');
  assert.deepStrictEqual(s.end.adj, { p1: 17, p2: -17 });
  assert.deepStrictEqual(s.sc, { p1: 75, p2: 43 });
  assert.deepStrictEqual(W.turn(s), []);
  const r = W.result(s);
  assert.deepStrictEqual(r.ranks, [['p1'], ['p2']]); assert.deepStrictEqual(r.scores, { p1: 75, p2: 43 });
  assert.ok(/Ann wins with 75/.test(r.text), r.text);
  bad(s, 'p2', { pass: true }, /over/);
});
t('the end: everyone passes twice; everyone loses their tiles; ties share a rank', () => {
  const ps = [...PS, { id: 'p3', name: 'Cy' }];
  const s = mk({ ps, racks: { p1: ['a', 'b'], p2: ['z'], p3: ['?', 'e'] }, bag: [] });
  s.sc = { p1: 20, p2: 23, p3: 21 };
  for (let k = 0; k < 5; k++) { ok(s, W.turn(s)[0], { pass: true }); assert.strictEqual(W.result(s), null); }
  ok(s, W.turn(s)[0], { pass: true });
  assert.strictEqual(s.end.why, 'stuck');
  assert.deepStrictEqual(s.end.adj, { p1: -5, p2: -8, p3: -1 });
  assert.deepStrictEqual(s.sc, { p1: 15, p2: 15, p3: 20 });
  assert.deepStrictEqual(W.result(s).ranks, [['p3'], ['p1', 'p2']]);
});
t('a 4-player game sets up and rotates', () => {
  const ps = [...PS, { id: 'p3', name: 'Cy' }, { id: 'p4', name: 'Di' }], s = W.setup({}, ps, 0);
  assert.strictEqual(s.bag.length, 102 - 28);
  for (const p of ps) { assert.deepStrictEqual(W.turn(s), [p.id]); ok(s, p.id, { pass: true }); }
  assert.deepStrictEqual(W.turn(s), ['p1']);
});

/* ------------------------------------------------------------------ time */
t('time limit: the view counts down, running out is a pass', () => {
  const s = mk({ time: 120 });
  assert.strictEqual(W.view(s, 'p1', 5000).left, 115000);
  assert.strictEqual(W.view(mk(), 'p1', 5000).left, null);
  assert.strictEqual(W.due(s, 119000), null);
  assert.strictEqual(W.due(s, 125000), 'p1');
  bad(s, 'p1', { pass: true }, /time/, 125000);
  W.timeout(s, 'p2', 125000); assert.deepStrictEqual(W.turn(s), ['p1'], 'only the player whose turn it is can time out');
  W.timeout(s, 'p1', 125000);
  assert.deepStrictEqual(s.last, { p: 'p1', k: 'time' }); assert.deepStrictEqual(W.turn(s), ['p2']); assert.strictEqual(s.pass, 1);
  assert.strictEqual(W.view(s, 'p2', 125000).left, 120000);
  // the host also uses timeout() to skip a player who left, with or without a clock
  const u = mk({ ps: [...PS, { id: 'p3', name: 'Cy' }] });
  W.timeout(u, 'p1', 10); assert.deepStrictEqual(W.turn(u), ['p2']); assert.strictEqual(u.last.k, 'time');
  W.timeout(u, 'p1', 10); assert.deepStrictEqual(W.turn(u), ['p2'], 'not p1\'s turn any more');
  const O = window.Games.opts;
  assert.strictEqual(O(W, {}).time, 0); assert.strictEqual(O(W, { time: '300' }).time, 300); assert.strictEqual(O(W, { time: 7 }).time, 0);
});

/* ------------------------------------------------------------------ the view */
t('the view hides other racks and the bag, and is small', () => {
  const s = mk({ time: 300, racks: { p1: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], p2: ['q', 'q', 'q', 'q', 'q', 'q', 'q'] } });
  const v1 = W.view(s, 'p1', 0), v0 = W.view(s, null, 0), vx = W.view(s, 'nobody', 0), j = JSON.stringify(v1);
  assert.deepStrictEqual(v1.rack, ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.ok(!('rack' in v0) && !('rack' in vx));
  assert.ok(!/"q"/.test(j), 'p2\'s tiles leak'); assert.ok(!/racks|"rs"|seed/.test(j), 'secrets leak');
  assert.strictEqual(typeof v1.bag, 'number'); assert.strictEqual(v1.bag, s.bag.length);
  assert.deepStrictEqual(v1.p.map(p => p.n), [7, 7]);
  assert.strictEqual(v1.turn, 'p1'); assert.strictEqual(v1.end, null);
  assert.ok(j.length < 1024, 'view is ' + j.length + ' bytes');
  // views are copies: the state moving on doesn't change a view already handed out
  const b0 = v1.b.join('');
  ok(s, 'p1', { place: tiles(7, 6, 'a', 'cab') });
  assert.strictEqual(v1.b.join(''), b0);
  const v2 = W.view(s, 'p2', 0);
  assert.deepStrictEqual(v2.last.w, [['cab', 8]]); assert.deepStrictEqual(v2.last.sq, [111, 112, 113]);
  assert.ok(!JSON.stringify(v2).includes('"d","e"'), 'p1\'s tiles leak');
  // at the end, everyone's leftover tiles are shown
  const e = mk({ board: board([7, 6, 'a', 'cat']), racks: { p1: ['s'], p2: ['q', 'z'] }, bag: [] });
  ok(e, 'p1', { place: [{ r: 7, c: 9, l: 's' }] });
  assert.deepStrictEqual(W.view(e, null, 0).end.racks, { p1: [], p2: ['q', 'z'] });
});

/* ------------------------------------------------------------------ bad input */
t('bad input returns {err} and changes nothing', () => {
  const s = mk({ board: board([7, 6, 'a', 'cat']), racks: { p1: ['a', 't', 'o', 'n', 'e', 's', 'r'] } });
  const many = n => Array.from({ length: n }, (_, k) => ({ r: 8, c: k, l: 'a' }));
  for (const m of [null, undefined, 0, 5, 'pass', true, [], [1], {}, { foo: 1 }, { pass: false }, { pass: 'yes' }, { pass: 1 },
    { place: 'cat' }, { place: [] }, { place: {} }, { place: [null] }, { place: [{}] }, { place: [7, 7, 'a'] },
    { place: [{ r: '7', c: 9, l: 's' }] }, { place: [{ r: 7.5, c: 9, l: 's' }] }, { place: [{ r: 7, c: 9, l: 'ss' }] }, { place: [{ r: 7, c: 9, l: 5 }] },
    { place: [{ r: 7, c: 9, l: '' }] }, { place: [{ r: 7, c: 9, l: 'é' }] }, { place: [{ r: 7, c: 9 }] }, { place: [{ r: NaN, c: 9, l: 's' }] },
    { place: [{ r: -1, c: 9, l: 's' }] }, { place: [{ r: 15, c: 0, l: 's' }] }, { place: [{ r: 0, c: 15, l: 's' }] }, { place: [{ r: 1e9, c: 1, l: 's' }] },
    { place: many(8) }, { place: [{ r: 7, c: 9, l: 's' }, { r: 7, c: 9, l: 's' }] },
    { place: [{ r: 7, c: 7, l: 's' }] }, { place: [{ r: 7, c: 9, l: 'z' }] }, { place: [{ r: 7, c: 9, l: 's', b: true }] },
    { exchange: 'abc' }, { exchange: [] }, { exchange: [1] }, { exchange: ['ab'] }, { exchange: [null] }, { exchange: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
    { exchange: ['x'] }, { pass: true, exchange: ['a'] }, { pass: true, place: [{ r: 7, c: 9, l: 's' }] },
    JSON.parse('{"__proto__": {"pass": true}}'), Object.create({ pass: true })]) bad(s, 'p1', m);
  bad(s, 'p1', { place: [{ r: 7, c: 7, l: 's' }] }, /taken/);
  bad(s, 'p1', { place: [{ r: 7, c: 10, l: 's' }, { r: 7, c: 15, l: 's' }] }, /off the board/);
  bad(s, 'p1', { place: [{ r: 7, c: 9, l: 'z' }] }, /rack/);
  bad(s, 'p2', { pass: true }, /not your turn/);
  bad(s, 'nobody', { pass: true }, /not your turn/);
  bad(s, null, { pass: true }, /not your turn/);
  bad(s, undefined, { place: [{ r: 7, c: 9, l: 's' }] }, /not your turn/);
  for (const st of [null, undefined, {}, { ps: [] }, 5]) assert.ok(W.move(st, 'p1', { pass: true }, 0).err);
  assert.doesNotThrow(() => { W.view(s, 'p1'); W.result(s); W.turn(s); W.due(s); W.timeout(s, 'p9', 0); W.timeout(null, 'p1', 0); W.timeout({}, 'p1', 0); });
  assert.deepStrictEqual(W.turn(s), ['p1']);
  ok(s, 'p1', { place: [{ r: 7, c: 9, l: 'S' }] });          // a capital letter is read as lower case
  assert.strictEqual(s.b[7][9], 's');
});

/* ------------------------------------------------------------------ the move generator */
t('the generator finds every first move (checked by brute force)', () => {
  const D = window.DICT, words = [];
  for (const n in D) if (+n <= 7) for (let i = 0; i < D[n].length; i += +n) words.push(D[n].substr(i, +n));
  for (const rack of [[...'retains'], [...'qzxjkvw'], [...'eeeaaio'], [...'grumble']]) {
    let want = 0;
    for (const w of words) {
      const left = rack.slice(); if (![...w].every(c => { const k = left.indexOf(c); if (k < 0) return false; left.splice(k, 1); return true; })) continue;
      for (let s = 7 - w.length + 1; s <= 7; s++) if (s >= 0 && s + w.length <= 15) want++;
    }
    const got = L.gen('.'.repeat(225), rack, {});
    assert.strictEqual(got.length, 2 * want, rack.join('') + ': ' + got.length + ' moves, brute force says ' + 2 * want);
    const keys = new Set(got.map(m => m.t.join()));
    assert.strictEqual(keys.size, got.length, 'duplicates');
  }
});
t('every generated move is legal and scores what move() scores (with blanks)', () => {
  let n = 0;
  const s = W.setup({ seed: 3 }, PS, 0);
  for (let turn = 0; turn < 14 && !s.end; turn++) {
    const pid = W.turn(s)[0];
    if (turn % 3 === 2) s.racks[pid][0] = '?';                         // blanks now and then, two at once sometimes
    if (turn % 5 === 4) s.racks[pid][1] = '?';
    const flat = s.b.join(''), all = L.gen(flat, s.racks[pid], {});
    for (let k = 0; k < all.length; k += Math.max(1, all.length / 150 | 0)) {
      const m = all[k], tl = [];
      for (let q = 0; q < m.t.length; q += 3) tl.push({ i: m.t[q], l: 'abcdefghijklmnopqrstuvwxyz'[m.t[q + 1]], b: !!m.t[q + 2] });
      const j = L.judge(flat, tl, Lex.has);
      assert.ok(!j.err, j.err + ' ' + JSON.stringify(tl));
      assert.strictEqual(j.pts, m.s, 'score ' + JSON.stringify(tl) + ' ' + JSON.stringify(j.words));
      n++;
    }
    ok(s, pid, L.think(s, pid, 'hard'));
  }
  assert.ok(n > 500, 'only ' + n + ' moves checked');
});

/* ------------------------------------------------------------------ CPU games */
const times = { easy: [], normal: [], hard: [] }, per = { easy: [0, 0], normal: [0, 0], hard: [0, 0] };
async function game(levels, seed) {
  const ps = levels.map((lv, k) => ({ id: 'c' + k, name: lv }));
  let s = W.setup({ seed }, ps, 0), turns = 0;
  const lv = Object.fromEntries(ps.map((p, k) => [p.id, levels[k]]));
  while (!W.result(s)) {
    assert.ok(++turns < 400, 'the game never ends');
    const pid = W.turn(s)[0], before = s.sc[pid];
    // the thinking itself (cpu() is think() after a setTimeout(0), so the screen can paint first)
    const t0 = process.hrtime.bigint(), m = L.think(s, pid, lv[pid]);
    times[lv[pid]].push(Number(process.hrtime.bigint() - t0) / 1e6);
    const r = W.move(s, pid, m, 0);
    assert.ok(!r.err, lv[pid] + ' made an illegal move: ' + r.err + ' ' + JSON.stringify(m));
    s = r.state;
    if (!s.end) { per[lv[pid]][0] += s.sc[pid] - before; per[lv[pid]][1]++; }
    else if (m.place) { per[lv[pid]][0] += s.last.pts; per[lv[pid]][1]++; }
  }
  for (const p of ps) assert.strictEqual(s.racks[p.id].length + s.bag.length >= 0, true);
  const tilesLeft = s.bag.length + Object.values(s.racks).flat().length, onBoard = s.b.join('').replace(/\./g, '').length;
  assert.strictEqual(tilesLeft + onBoard, 102, 'tiles went missing');
  return { s, turns };
}
t('CPU games to the end at every level, every move legal', async () => {
  for (const lv of ['easy', 'normal', 'hard']) for (const seed of [11, 12]) {
    const { s, turns } = await game([lv, lv], seed);
    console.log('  ' + lv + ' vs ' + lv + ': ' + turns + ' turns, ' + W.result(s).text + ' ' + JSON.stringify(s.sc));
  }
  const { s } = await game(['hard', 'easy', 'normal', 'hard'], 13);
  console.log('  4 players: ' + W.result(s).text + ' ' + JSON.stringify(s.sc));
});
t('hard scores more per turn than normal, normal more than easy', async () => {
  for (let k = 0; k < 6; k++) { const lv = ['easy', 'normal', 'hard']; for (let r = 0; r < k % 3; r++) lv.push(lv.shift()); await game(lv, 100 + k); }
  const avg = lv => per[lv][0] / per[lv][1];
  console.log('  points per turn: easy ' + avg('easy').toFixed(1) + ', normal ' + avg('normal').toFixed(1) + ', hard ' + avg('hard').toFixed(1));
  assert.ok(avg('hard') > avg('normal'), 'hard <= normal'); assert.ok(avg('normal') > avg('easy'), 'normal <= easy');
});
t('CPU speed: under 1.5 s a move, even with two blanks on a crowded board', async () => {
  const { s } = await game(['hard', 'hard'], 21);
  for (const rack of [['?', '?', 'e', 's', 't', 'a', 'r'], ['?', '?', 'q', 'u', 'i', 'z', 'e'], ['?', '?', '?', 'a', 'e', 'i', 'o']]) {
    const t0 = Date.now(), n = L.gen(s.b.join(''), rack, { leave: true }).length, ms = Date.now() - t0;
    console.log('  ' + rack.join('') + ' on a full board: ' + n + ' moves in ' + ms + ' ms');
    assert.ok(ms < 1500, ms + ' ms');
  }
  const t1 = Date.now(), n = L.gen('.'.repeat(225), ['?', '?', 'e', 's', 't', 'a', 'r'], {}).length;
  console.log('  ??estar on an empty board: ' + n + ' moves in ' + (Date.now() - t1) + ' ms');
  for (const lv of ['easy', 'normal', 'hard']) {
    const a = times[lv];
    console.log('  ' + lv + ': ' + a.length + ' moves, median ' + median(a).toFixed(1) + ' ms, max ' + Math.max(...a).toFixed(1) + ' ms');
    assert.ok(Math.max(...a) < 1500, lv + ' took ' + Math.max(...a) + ' ms');
  }
});
t('cpu() resolves to a legal move, and never throws on a broken state', async () => {
  const s = W.setup({ seed: 9 }, PS, 0);
  for (const lv of ['easy', 'normal', 'hard', 'whatever']) {
    const p = W.cpu(s, W.turn(s)[0], lv, 0);
    assert.ok(p instanceof Promise);
    ok(s, W.turn(s)[0], await p);
  }
  assert.deepStrictEqual(await W.cpu({}, 'p1', 'hard', 0), { pass: true });
});
t('CPU exchanges a terrible rack and passes when stuck', () => {
  const s = mk({ board: board([7, 6, 'a', 'cat']), racks: { p1: ['u', 'u', 'u', 'i', 'i', 'o', 'o'] } });
  const m = L.think(s, 'p1', 'hard');
  assert.ok(m.exchange || m.place, JSON.stringify(m));
  if (m.exchange) ok(s, 'p1', m);
  const s2 = mk({ board: board([7, 6, 'a', 'cat']), racks: { p1: ['q', 'q', 'q', 'q', 'q', 'q', 'q'] } });
  const m2 = L.think(s2, 'p1', 'normal');
  assert.ok(m2.exchange, JSON.stringify(m2)); ok(s2, 'p1', m2);
  const s3 = mk({ board: board([7, 6, 'a', 'cat']), racks: { p1: ['q', 'q'] }, bag: [] });
  assert.deepStrictEqual(L.think(s3, 'p1', 'easy'), { pass: true });
});

(async () => {
  await window.Lex.load();
  let n = 0;
  for (const [name, fn] of tests) {
    try { await fn(); n++; } catch (e) { console.error('FAIL ' + name + '\n  ' + e.message); process.exitCode = 1; }
  }
  console.log(n + '/' + tests.length + ' checks passed' + (process.exitCode ? ' (some FAILED)' : ''));
})();
