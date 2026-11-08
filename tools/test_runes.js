/* test_runes.js -- checks Runecasters' rules, its CPU players and (on a tiny fake DOM) its screen, in node:
     node tools/test_runes.js */
'use strict';
const path = require('path'), assert = require('assert');
global.window = global;
if (!global.crypto) global.crypto = require('crypto').webcrypto;
for (const f of ['util.js', 'dict.js', 'lexicon.js', 'games.js', 'runes.js']) require(path.join(__dirname, '..', 'js', f));

let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('FAIL ' + name + '\n  ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n  ')); process.exitCode = 1; } };
const R = Games.get('runes'), lib = R.lib, VAL = lib.values;
const P3 = [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bo' }, { id: 'c', name: 'Cy' }];
const T0 = 1e6;
const game = (o, ps, now) => R.setup(Object.assign({ seed: 7 }, o), ps || P3, now || T0);
/* a known board (rows of 5), no runes or crystals unless given */
const put = (st, rows, extra) => { st.grid.L = rows.replace(/\s/g, ''); Object.assign(st.grid, { x2: -1, x3: -1, w2: -1, mana: [] }, extra || {}); return st; };
/* "stran" over "osreg": STRANGE = 0 1 2 3 4 9 8, then R 7, S 6 */
const SNAKE = 'stran osreg lidea mupot cbhyk';
/* the Q tile at 0: QUIET = 0 1 2 3, QUA = 0 5 */
const QB = 'qiets aulmn ropdc bhgkt wvyfe';
const ok = r => { assert.ok(r && r.state, 'expected a state, got ' + JSON.stringify(r)); return r.state; };
const bad = (r, re) => { assert.ok(r && typeof r.err === 'string' && r.err.length, 'expected an error, got ' + JSON.stringify(r && (r.err || Object.keys(r)))); if (re) assert.ok(re.test(r.err), r.err); };
const vowels = L => [...L].filter(c => 'aeiou'.includes(c)).length;
const avg = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

(async () => {
  await Lex.load();

  /* ------------------------------------------------------------ the contract */
  await t('registered, with its options', () => {
    assert.strictEqual(R.name, 'Runecasters'); assert.deepStrictEqual(R.players, [1, 6]); assert.strictEqual(R.lex, true);
    for (const f of ['setup', 'view', 'move', 'turn', 'due', 'timeout', 'result', 'cpu', 'mount']) assert.strictEqual(typeof R[f], 'function', f);
    assert.deepStrictEqual(Games.opts(R, {}), { rounds: 5, time: 90 });
    assert.deepStrictEqual(Games.opts(R, { rounds: 7, time: 0 }), { rounds: 7, time: 0 });
    assert.deepStrictEqual(Games.opts(R, { rounds: 4, time: 33 }), { rounds: 5, time: 90 });
  });
  await t('letter values follow the dictionary, 1-8', () => {
    assert.strictEqual(Object.keys(VAL).length, 26);
    for (const l in VAL) assert.ok(VAL[l] >= 1 && VAL[l] <= 8, l);
    assert.strictEqual(VAL.e, 1); assert.strictEqual(VAL.q, 8); assert.ok(VAL.z > VAL.k && VAL.k > VAL.d && VAL.d > VAL.e);
    assert.deepStrictEqual([3, 5, 6, 7, 8, 12].map(lib.bonus), [0, 0, 3, 6, 10, 10]);
  });
  await t('setup', () => {
    const st = game({ rounds: 3, time: 60 });
    const v = R.view(st, 'a', T0);
    assert.strictEqual(v.grid.L.length, 25); assert.ok(/^[a-z]{25}$/.test(v.grid.L));
    assert.deepStrictEqual(v.grid.v, [...v.grid.L].map(l => VAL[l]));
    assert.strictEqual(v.round, 1); assert.strictEqual(v.rounds, 3); assert.strictEqual(v.turn, 'a'); assert.strictEqual(v.over, false);
    assert.strictEqual(v.left, 60000); assert.strictEqual(v.lim, 60000);
    assert.ok(v.grid.x2 >= 0 && v.grid.x3 >= 0 && v.grid.x2 !== v.grid.x3); assert.strictEqual(v.grid.w2, -1);
    assert.ok(v.grid.mana.length >= 4 && v.grid.mana.length <= 6);
    for (const p of v.players) { assert.strictEqual(p.score, 0); assert.strictEqual(p.mana, 3); }
    assert.deepStrictEqual(R.turn(st), ['a']); assert.strictEqual(R.result(st), null);
    assert.ok(JSON.stringify(st) && JSON.stringify(v));
  });
  await t('fresh boards are playable', () => {
    const { VMIN, VMAX, RARE, RARE_MAX, DUP_MAX } = lib.limits;
    for (let s = 1; s <= 300; s++) {
      const L = R.setup({ seed: s }, P3, T0).grid.L, cnt = {};
      for (const c of L) cnt[c] = (cnt[c] || 0) + 1;
      assert.ok(vowels(L) >= VMIN && vowels(L) <= VMAX, L);
      assert.ok([...L].filter(c => RARE.includes(c)).length <= RARE_MAX, L);
      assert.ok(Object.values(cnt).every(k => k <= DUP_MAX), L);
    }
  });
  await t('the same seed, the same board', () => {
    assert.strictEqual(R.setup({ seed: 42 }, P3, 0).grid.L, R.setup({ seed: 42 }, P3, 0).grid.L);
    assert.notStrictEqual(R.setup({ seed: 42 }, P3, 0).grid.L, R.setup({ seed: 43 }, P3, 0).grid.L);
  });

  /* ------------------------------------------------------------ paths */
  await t('a path: adjacent, diagonals too', () => {
    const st = put(game(), SNAKE);
    assert.strictEqual(lib.check(st.grid, [0, 1, 2]).w, 'str');
    assert.ok(lib.adj(0, 6) && lib.adj(6, 0) && lib.adj(4, 8) && !lib.adj(4, 5) && !lib.adj(0, 2) && !lib.adj(0, 10) && !lib.adj(3, 3));
    bad(R.move(st, 'a', { cast: [0, 2, 3] }, T0), /touch/);
    bad(R.move(st, 'a', { cast: [4, 5, 6] }, T0), /touch/);                    // 4 -> 5 wraps a row: not adjacent
    ok(R.move(st, 'a', { cast: [2, 3, 4, 9, 8, 7] }, T0));                     // RANGER, with a diagonal-free bend
  });
  await t('no tile twice', () => {
    const st = put(game(), SNAKE);
    bad(R.move(st, 'a', { cast: [2, 3, 2] }, T0), /once/);
  });
  await t('at least 3 letters, and a real word', () => {
    const st = put(game(), SNAKE);
    bad(R.move(st, 'a', { cast: [0, 1] }, T0), /3 letters/);
    bad(R.move(st, 'a', { cast: [3] }, T0), /3 letters/);
    assert.ok(!Lex.has(lib.wordOf(st.grid.L, [1, 0, 6])));
    bad(R.move(st, 'a', { cast: [1, 0, 6] }, T0), /dictionary/);
    assert.strictEqual(st.n, 0);
  });
  await t('the Q tile reads QU', () => {
    let st = put(game(), QB);
    assert.strictEqual(lib.wordOf(st.grid.L, [0, 1, 2, 3]), 'quiet');
    st = ok(R.move(st, 'a', { cast: [0, 1, 2, 3] }, T0));
    assert.strictEqual(st.last.w, 'quiet'); assert.strictEqual(st.last.pts, 8 + 2 + 1 + 2);
    st = put(st, QB);
    assert.ok(Lex.has('qua'));
    st = ok(R.move(st, 'b', { cast: [0, 5] }, T0));                            // two tiles, three letters
    assert.strictEqual(st.last.w, 'qua');
    st = put(st, QB);
    bad(R.move(st, 'c', { cast: [0, 6] }, T0), /dictionary/);                 // QU + U is QUU
  });

  /* ------------------------------------------------------------ scoring */
  await t('scoring: letters + length bonus', () => {
    const g = put(game(), SNAKE).grid;
    assert.strictEqual(lib.points(g, [2, 3, 4, 9, 8, 7]), 2 + 2 + 2 + 3 + 1 + 2 + 3);         // RANGER, 6 letters: +3
    assert.strictEqual(lib.points(g, [0, 1, 2, 3, 4, 9, 8]), 1 + 2 + 2 + 2 + 2 + 3 + 1 + 6);   // STRANGE, 7: +6
    assert.strictEqual(lib.points(g, [0, 1, 2, 3, 4, 9, 8, 7]), 15 + 10);                      // STRANGER, 8: +10
    assert.strictEqual(lib.points(g, [0, 1, 2, 3, 4, 9, 8, 7, 6]), 16 + 10);                   // STRANGERS, 9: +10
    assert.strictEqual(lib.points(g, [2, 3, 4, 9, 8]), 10);                                   // RANGE, 5: nothing extra
  });
  await t('scoring: rune multipliers', () => {
    const st = put(game(), SNAKE, { x2: 3, x3: 9, w2: 2 });
    // RANGER: r2 + a2x2 + n2 + g3x3 + e1 + r2 = 20, the word doubled = 40, +3 for six letters
    assert.strictEqual(lib.points(st.grid, [2, 3, 4, 9, 8, 7]), 43);
    ok(R.move(st, 'a', { cast: [2, 3, 4, 9, 8, 7] }, T0));
    assert.strictEqual(st.ps[0].score, 43); assert.deepStrictEqual(st.last, { p: 'a', w: 'ranger', path: [2, 3, 4, 9, 8, 7], pts: 43, mana: 0 });
    assert.deepStrictEqual(st.ps[0].best, { w: 'ranger', pts: 43 });
  });
  await t('the used tiles refill; the rest stay; runes move off the path', () => {
    const st = put(game(), SNAKE, { x2: 3, x3: 9, w2: 12, mana: [0, 4, 20, 24] });
    const before = st.grid.L, used = [2, 3, 4, 9, 8, 7];
    ok(R.move(st, 'a', { cast: used }, T0));
    const g = st.grid;
    for (let i = 0; i < 25; i++) if (!used.includes(i)) assert.strictEqual(g.L[i], before[i], 'cell ' + i);
    for (const i of used) assert.ok(/[a-z]/.test(g.L[i]));
    assert.ok(!used.includes(g.x2) && !used.includes(g.x3), 'runes moved');
    assert.strictEqual(g.w2, 12, 'an unused rune stays');
    assert.ok(new Set([g.x2, g.x3, g.w2]).size === 3);
    assert.ok(g.mana.length >= 4 && g.mana.length <= 6, 'crystals topped up');
    assert.ok(vowels(g.L) >= 1);
  });

  /* ------------------------------------------------------------ mana */
  await t('crystals give mana, capped at 10', () => {
    let st = put(game(), SNAKE, { mana: [2, 3, 20] });
    ok(R.move(st, 'a', { cast: [2, 3, 4, 9, 8] }, T0));
    assert.strictEqual(st.ps[0].mana, 5); assert.strictEqual(st.last.mana, 2);
    assert.ok(st.grid.mana.length >= 4 && st.grid.mana.length <= 6);
    st = put(st, SNAKE, { mana: [2, 3, 4] }); st.ps[1].mana = 9;
    ok(R.move(st, 'b', { cast: [2, 3, 4, 9, 8] }, T0));
    assert.strictEqual(st.ps[1].mana, 10);
  });
  await t('spells cost mana, and too little is refused', () => {
    const st = put(game(), SNAKE);
    st.ps[0].mana = 0;
    bad(R.move(st, 'a', { act: 'shuffle' }, T0), /1 mana/);
    bad(R.move(st, 'a', { act: 'transmute', cell: 0, letter: 'e' }, T0), /2 mana/);
    bad(R.move(st, 'a', { act: 'scry' }, T0), /3 mana/);
    assert.strictEqual(st.n, 0);
  });
  await t('reshuffle: same letters, new places; runes and crystals stay; still my turn', () => {
    const st = put(game(), SNAKE, { x2: 1, x3: 2, w2: 3, mana: [5, 6, 7, 8] }), L0 = st.grid.L;
    ok(R.move(st, 'a', { act: 'shuffle' }, T0));
    assert.notStrictEqual(st.grid.L, L0);
    assert.strictEqual([...st.grid.L].sort().join(''), [...L0].sort().join(''));
    assert.deepStrictEqual([st.grid.x2, st.grid.x3, st.grid.w2, st.grid.mana], [1, 2, 3, [5, 6, 7, 8]]);
    assert.strictEqual(st.ps[0].mana, 2); assert.deepStrictEqual(R.turn(st), ['a']); assert.strictEqual(st.ev.k, 'shuffle');
  });
  await t('transmute: one tile, any letter, again if you can pay', () => {
    const st = put(game(), SNAKE);
    st.ps[0].mana = 5;
    bad(R.move(st, 'a', { act: 'transmute', cell: 0, letter: 's' }, T0), /already/);
    bad(R.move(st, 'a', { act: 'transmute', cell: 25, letter: 'a' }, T0), /tile/);
    bad(R.move(st, 'a', { act: 'transmute', cell: -1, letter: 'a' }, T0), /tile/);
    bad(R.move(st, 'a', { act: 'transmute', cell: '3', letter: 'a' }, T0), /tile/);
    bad(R.move(st, 'a', { act: 'transmute', cell: 2.5, letter: 'a' }, T0), /tile/);
    bad(R.move(st, 'a', { act: 'transmute', cell: 3, letter: 'ab' }, T0), /letter/);
    bad(R.move(st, 'a', { act: 'transmute', cell: 3, letter: '1' }, T0), /letter/);
    bad(R.move(st, 'a', { act: 'transmute', cell: 3 }, T0), /letter/);
    ok(R.move(st, 'a', { act: 'transmute', cell: 0, letter: 'Z' }, T0));
    assert.strictEqual(st.grid.L[0], 'z'); assert.strictEqual(st.ps[0].mana, 3); assert.deepStrictEqual(st.ev, { n: 1, k: 'transmute', p: 'a', c: 0 });
    ok(R.move(st, 'a', { act: 'transmute', cell: 24, letter: 'q' }, T0));
    assert.strictEqual(st.grid.L[24], 'q'); assert.strictEqual(st.ps[0].mana, 1);
    bad(R.move(st, 'a', { act: 'transmute', cell: 1, letter: 'e' }, T0), /2 mana/);
    assert.deepStrictEqual(R.turn(st), ['a']);
  });
  await t('transmute never leaves the board without a vowel', () => {
    const st = put(game(), 'bcdfg hjklm npqrs tvwxz bcdfa');
    st.ps[0].mana = 10;
    bad(R.move(st, 'a', { act: 'transmute', cell: 24, letter: 't' }, T0), /vowel/);
    ok(R.move(st, 'a', { act: 'transmute', cell: 0, letter: 'o' }, T0));
    ok(R.move(st, 'a', { act: 'transmute', cell: 24, letter: 't' }, T0));
  });
  await t('scry: the best word, shown to the scrier only, until the board changes', () => {
    let st = put(game(), SNAKE, { x2: 10, x3: 14 });
    st.ps[0].mana = 6;
    ok(R.move(st, 'a', { act: 'scry' }, T0));
    const best = lib.find(st.grid)[0], va = R.view(st, 'a', T0);
    assert.ok(va.hint, 'the scrier sees it');
    assert.strictEqual(va.hint.pts, best.pts); assert.strictEqual(va.hint.pts, lib.points(st.grid, va.hint.path));
    assert.ok(Lex.has(va.hint.w) && lib.check(st.grid, va.hint.path).w === va.hint.w);
    assert.ok(lib.find(st.grid).every(w => w.pts <= va.hint.pts));
    assert.ok(!R.view(st, 'b', T0).hint && !R.view(st, null, T0).hint, 'nobody else does');
    assert.strictEqual(st.ps[0].mana, 3);
    bad(R.move(st, 'a', { act: 'scry' }, T0), /still/);
    ok(R.move(st, 'a', { act: 'shuffle' }, T0));
    assert.ok(!R.view(st, 'a', T0).hint, 'a reshuffle clears it');
    st.ps[0].mana = 3;
    ok(R.move(st, 'a', { act: 'scry' }, T0));
    st = ok(R.move(st, 'a', { cast: R.view(st, 'a', T0).hint.path }, T0));
    assert.ok(!R.view(st, 'a', T0).hint, 'the turn ending clears it');
    assert.strictEqual(st.ps[0].score, st.last.pts);
  });
  await t('scry on a board with no words is refused, free', () => {
    const st = put(game(), 'zzzzz zzzzz zzzzz zzzzz zzzza');
    bad(R.move(st, 'a', { act: 'scry' }, T0), /no word/);
    assert.strictEqual(st.ps[0].mana, 3);
  });

  /* ------------------------------------------------------------ turns, rounds, time */
  await t('turns go round in seat order; rounds count; the game ends', () => {
    const st = game({ rounds: 3, time: 0 });
    const seen = [];
    for (let k = 0; k < 9; k++) {
      const v = R.view(st, 'a', T0);
      seen.push(v.turn + v.round);
      if (k % 3 === 0) assert.strictEqual(v.grid.w2 >= 0, v.round >= 2, 'word rune from round 2');
      ok(R.move(st, v.turn, { pass: true }, T0));
      assert.deepStrictEqual(st.last, { p: v.turn, pass: 1 });
    }
    assert.deepStrictEqual(seen, ['a1', 'b1', 'c1', 'a2', 'b2', 'c2', 'a3', 'b3', 'c3']);
    assert.deepStrictEqual(R.turn(st), []);
    assert.strictEqual(R.view(st, 'a', T0).over, true); assert.strictEqual(R.view(st, 'a', T0).turn, null);
    bad(R.move(st, 'a', { pass: true }, T0), /over/);
    const res = R.result(st);
    assert.deepStrictEqual(res.ranks, [['a', 'b', 'c']]); assert.deepStrictEqual(res.scores, { a: 0, b: 0, c: 0 }); assert.ok(/tie/i.test(res.text));
  });
  await t('the runes are placed afresh each round', () => {
    const st = game({ rounds: 7, time: 0 }, [{ id: 'a', name: 'Solo' }]);
    const spots = new Set();
    for (let k = 0; k < 7; k++) { spots.add(st.grid.x2 + ',' + st.grid.x3); ok(R.move(st, 'a', { pass: true }, T0)); }
    assert.ok(spots.size >= 4, [...spots].join(' '));
  });
  await t('wrong player', () => {
    const st = game();
    bad(R.move(st, 'b', { pass: true }, T0), /turn/);
    bad(R.move(st, null, { pass: true }, T0), /turn/);
    bad(R.move(st, 'zz', { pass: true }, T0), /turn/);
    assert.strictEqual(st.n, 0);
  });
  await t('the turn clock: due, timeout, a late move', () => {
    const st = game({ time: 60 });
    assert.strictEqual(R.due(st, T0 + 59999), null);
    assert.strictEqual(R.due(st, T0 + 60000), 'a');
    assert.strictEqual(R.view(st, 'b', T0 + 15000).left, 45000);
    assert.strictEqual(R.timeout(st, 'b', T0 + 60000).state.n, 0, 'not b\'s turn: nothing happens');
    ok(R.timeout(st, 'a', T0 + 60000));
    assert.deepStrictEqual(st.last, { p: 'a', pass: 1, late: 1 }); assert.strictEqual(st.ev.k, 'time');
    assert.strictEqual(st.ps[0].score, 0); assert.deepStrictEqual(R.turn(st), ['b']);
    assert.strictEqual(R.view(st, 'b', T0 + 60000).left, 60000, 'the next turn gets the full time');
    assert.strictEqual(R.due(st, T0 + 60000), null);
    ok(R.move(st, 'b', { pass: true }, T0 + 60000 + 60000 + 1000));          // a little late is let in
    bad(R.move(st, 'c', { pass: true }, T0 + 400000), /Time/);                // far too late
    assert.strictEqual(R.due(st, T0 + 400000), 'c');
  });
  await t('no turn limit: never due', () => {
    const st = game({ time: 0 });
    assert.strictEqual(R.due(st, T0 + 1e9), null); assert.strictEqual(R.view(st, 'a', T0).left, null);
    ok(R.move(st, 'a', { pass: true }, T0 + 1e9));
  });

  /* ------------------------------------------------------------ the view */
  await t('the view: small, plain, times as ms left', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ id: 'player-id-' + i + '-abcdefgh', name: 'A Rather Long Name ' + i }));
    const st = R.setup({ seed: 3, time: 120 }, six, T0);
    st.ps[0].mana = 10;
    ok(R.move(st, six[0].id, { act: 'scry' }, T0));
    ok(R.move(st, six[0].id, { cast: st.hint.path }, T0));
    for (const p of st.ps) p.best = { w: 'quarterbacks', pts: 99 };
    const v = R.view(st, six[1].id, T0 + 5000), s = JSON.stringify(v);
    assert.ok(s.length < 3000, s.length + ' bytes');
    assert.deepStrictEqual(JSON.parse(s), v);
    const nums = []; JSON.parse(s, (k, x) => { if (typeof x === 'number') nums.push(x); return x; });
    assert.ok(nums.every(x => x < 1e7), 'no timestamps');
    assert.strictEqual(v.left, 115000);
    v.players[0].score = -1; v.last.path.push(99); v.grid.mana.push(99);
    assert.notStrictEqual(st.ps[0].score, -1); assert.ok(!st.last.path.includes(99) && !st.grid.mana.includes(99), 'a view is a copy');
  });

  /* ------------------------------------------------------------ results */
  await t('result: ranked by score, ties share a rank', () => {
    const st = game({ rounds: 3, time: 0 });
    while (R.turn(st).length) ok(R.move(st, R.turn(st)[0], { pass: true }, T0));
    st.ps[0].score = 30; st.ps[1].score = 50; st.ps[2].score = 30; st.ps[1].best = { w: 'quartz', pts: 40 };
    const r = R.result(st);
    assert.deepStrictEqual(r.ranks, [['b'], ['a', 'c']]); assert.deepStrictEqual(r.scores, { a: 30, b: 50, c: 30 });
    assert.ok(/Bo wins with 50/.test(r.text) && /QUARTZ \(40\) by Bo/.test(r.text), r.text);
  });
  await t('solo: a score attack', () => {
    const st = game({ rounds: 3, time: 0 }, [{ id: 'me', name: 'Me' }]);
    for (let k = 0; k < 3; k++) { assert.deepStrictEqual(R.turn(st), ['me']); assert.strictEqual(R.view(st, 'me', T0).round, k + 1); ok(R.move(st, 'me', { pass: true }, T0)); }
    const r = R.result(st);
    assert.deepStrictEqual(r.ranks, [['me']]); assert.ok(/0 points in 3 rounds/.test(r.text), r.text);
  });

  /* ------------------------------------------------------------ bad input */
  await t('garbage is refused, never thrown, and changes nothing', () => {
    const st = put(game(), SNAKE), before = JSON.stringify(st);
    const junk = [null, undefined, 0, 1, 'cast', true, [], [1, 2, 3], {}, { pass: 1 }, { pass: 'yes' }, { pass: false },
      { cast: null }, { cast: 'rang' }, { cast: {} }, { cast: [] }, { cast: [2, 3, 4.5] }, { cast: [2, 3, '4'] }, { cast: [-1, 0, 1] },
      { cast: [23, 24, 25] }, { cast: [NaN, 1, 2] }, { cast: [Infinity] }, { cast: Array(30).fill(0) }, { cast: [2, 3, 4, 9, 8, 7, 7] },
      { act: 'nope' }, { act: 'SHUFFLE' }, { act: null }, { act: 'transmute' }, { act: 'transmute', cell: null, letter: null },
      { act: 'transmute', cell: 1e9, letter: 'a' }, { act: 'transmute', cell: 1, letter: { toLowerCase: () => 'a' } }, { act: '__proto__' },
      { act: 'constructor' }, { act: 'toString' }, JSON.parse('{"__proto__": {"pass": true}}'), { cast: [1, 2, 3], toString: null }];
    for (const m of junk) {
      let r;
      assert.doesNotThrow(() => { r = R.move(st, 'a', m, T0); }, JSON.stringify(m));
      bad(r);
      assert.strictEqual(JSON.stringify(st), before, 'state changed by ' + JSON.stringify(m));
    }
    for (const s of [null, undefined, {}, { ps: [] }, { ps: 'x', grid: {} }]) assert.doesNotThrow(() => bad(R.move(s, 'a', { pass: true }, T0)));
    assert.doesNotThrow(() => { R.turn(null); R.result(null); R.due(null, 0); R.timeout(null, 'a', 0); });
    const none = R.setup({}, [], T0);
    assert.deepStrictEqual(R.turn(none), []); assert.deepStrictEqual(R.result(none).ranks, []); assert.ok(R.view(none, null, T0).over);
  });

  /* ------------------------------------------------------------ typing a path */
  await t('typing finds a path (and keeps the one I had)', () => {
    const g = put(game(), SNAKE).grid;
    assert.deepStrictEqual(lib.pathFor(g.L, 'ranger'), [2, 3, 4, 9, 8, 7]);
    assert.strictEqual(lib.pathFor(g.L, 'zzz'), null);
    assert.deepStrictEqual(lib.pathFor(g.L, ''), []);
    const twoS = lib.pathFor(g.L, 's');                                     // S at 0 and at 6
    assert.deepStrictEqual(twoS, [0]);
    assert.deepStrictEqual(lib.pathFor(g.L, 's', [6]), [6], 'prefers the S I already had');
    const q = put(game(), QB).grid;
    assert.deepStrictEqual(lib.pathFor(q.L, 'q'), [0], 'a lone Q waits for its U');
    assert.deepStrictEqual(lib.pathFor(q.L, 'qu'), [0]);
    assert.deepStrictEqual(lib.pathFor(q.L, 'quiet'), [0, 1, 2, 3]);
    assert.strictEqual(lib.pathFor(q.L, 'qi'), null);
  });

  /* ------------------------------------------------------------ a whole game */
  await t('three CPUs play a whole game, every move legal', async () => {
    const ps = [{ id: 'e', name: 'Easy' }, { id: 'n', name: 'Normal' }, { id: 'h', name: 'Hard' }], lv = { e: 'easy', n: 'normal', h: 'hard' };
    let st = R.setup({ seed: 11, rounds: 7, time: 90 }, ps, T0), now = T0, moves = 0;
    while (R.turn(st).length) {
      const pid = R.turn(st)[0], m = await R.cpu(st, pid, lv[pid], now);
      const r = R.move(st, pid, m, now);
      assert.ok(!r.err, pid + ' ' + JSON.stringify(m) + ': ' + r.err);
      st = r.state; moves++; now += 1000;
      assert.ok(vowels(st.grid.L) >= 1, 'never a board without a vowel');
      assert.ok(st.grid.mana.length >= 4 && st.grid.mana.length <= 6);
      assert.ok(moves < 200, 'runaway game');
    }
    const r = R.result(st);
    assert.ok(r && r.ranks.flat().sort().join() === 'e,h,n');
    for (const p of st.ps) assert.strictEqual(r.scores[p.id], p.score);
    console.log('  a 7-round game: ' + st.ps.map(p => p.name + ' ' + p.score + ' (best ' + (p.best ? p.best.w + ' ' + p.best.pts : '-') + ', ' + p.mana + ' mana)').join(', ') + ' in ' + moves + ' moves');
    assert.ok(st.ps[2].score > st.ps[0].score, 'hard beats easy');
  });
  await t('refills keep boards playable over many casts', () => {
    const { VMIN, VMAX, RARE, RARE_MAX, DUP_MAX } = lib.limits;
    for (let s = 0; s < 10; s++) {
      const st = R.setup({ seed: 100 + s, rounds: 7, time: 0 }, [{ id: 'a', name: 'A' }], T0);
      for (let k = 0; k < 7; k++) {
        const ws = lib.find(st.grid);
        ok(R.move(st, 'a', ws.length ? { cast: ws[Math.floor(ws.length / 2)].path } : { pass: true }, T0));
        const L = st.grid.L, cnt = {};
        for (const c of L) cnt[c] = (cnt[c] || 0) + 1;
        assert.ok(vowels(L) >= VMIN && vowels(L) <= VMAX, L);
        assert.ok([...L].filter(c => RARE.includes(c)).length <= RARE_MAX, L);
        assert.ok(Object.values(cnt).every(x => x <= DUP_MAX), L);
        assert.ok(new Set([st.grid.x2, st.grid.x3, st.grid.w2].filter(x => x >= 0)).size === [st.grid.x2, st.grid.x3, st.grid.w2].filter(x => x >= 0).length);
      }
    }
  });

  /* ------------------------------------------------------------ CPU */
  await t('CPU: legal at every level; hard >= normal >= easy; quick', async () => {
    const lvls = ['easy', 'normal', 'hard'], got = { easy: [], normal: [], hard: [] }, ms = { easy: [], normal: [], hard: [] }, tms = [];
    for (let s = 0; s < 40; s++) {
      for (const lv of lvls) {
        const st = R.setup({ seed: 500 + s, time: 0 }, [{ id: 'x', name: 'X' }], T0);
        st.ps[0].mana = 4;
        for (let step = 0; step < 6; step++) {
          const t0 = process.hrtime.bigint();
          const m = await R.cpu(st, 'x', lv, T0);
          ms[lv].push(Number(process.hrtime.bigint() - t0) / 1e6);
          const r = R.move(st, 'x', m, T0);
          assert.ok(!r.err, lv + ' ' + JSON.stringify(m) + ': ' + r.err);
          if (m.act === 'transmute') { assert.strictEqual(lv, 'hard'); tms.push(1); continue; }
          assert.ok(m.cast, lv + ' should cast: ' + JSON.stringify(m));
          got[lv].push(st.last.pts);
          break;
        }
      }
    }
    const a = {}, line = [];
    for (const lv of lvls) { a[lv] = avg(got[lv]); line.push(lv + ' ' + a[lv].toFixed(1) + ' pts, ' + avg(ms[lv]).toFixed(1) + ' ms avg / ' + Math.max(...ms[lv]).toFixed(0) + ' max'); }
    console.log('  CPU per turn: ' + line.join('; ') + '; hard transmuted ' + tms.length + 'x in 40 turns');
    assert.ok(a.hard >= a.normal && a.normal >= a.easy, JSON.stringify(a));
    assert.ok(a.hard > a.easy * 1.8, 'hard should be clearly stronger');
    for (const lv of lvls) { assert.ok(avg(ms[lv]) < 300, lv + ' too slow'); assert.ok(Math.max(...ms[lv]) < 2000, lv + ' too slow at worst'); }
  });
  await t('CPU: easy prefers short words', async () => {
    const lens = [];
    for (let s = 0; s < 30; s++) { const st = R.setup({ seed: 900 + s }, [{ id: 'x', name: 'X' }], T0); const m = await R.cpu(st, 'x', 'easy', T0); lens.push(lib.wordOf(st.grid.L, m.cast).length); }
    assert.ok(lens.every(l => l >= 3) && avg(lens) <= 5, lens.join(','));
  });
  await t('CPU: no words, reshuffle (or pass when broke); not its turn, pass', async () => {
    const st = put(game(), 'zzzzz zzzzz zzzzz zzzzz zzzza');
    assert.deepStrictEqual(await R.cpu(st, 'a', 'hard', T0), { act: 'shuffle' });
    st.ps[0].mana = 0;
    assert.deepStrictEqual(await R.cpu(st, 'a', 'normal', T0), { pass: true });
    assert.deepStrictEqual(await R.cpu(st, 'b', 'easy', T0), { pass: true });
    assert.deepStrictEqual(await R.cpu(null, 'b', 'easy', T0), { pass: true });
  });
  await t('CPU: hard transmutes only when it pays at least 8', async () => {
    const st = put(game(), SNAKE);
    st.ps[0].mana = 2;
    const best = lib.find(st.grid)[0].pts, m = await R.cpu(st, 'a', 'hard', T0);
    if (m.act === 'transmute') {
      ok(R.move(st, 'a', m, T0));
      assert.ok(lib.find(st.grid)[0].pts >= best + 8);
    } else assert.ok(m.cast);
    st.ps[0].mana = 1;
    assert.ok((await R.cpu(st, 'a', 'hard', T0)).cast, 'no mana for it: just cast');
  });

  /* ------------------------------------------------------------ the screen, on a fake DOM */
  await t('the screen: mount, trace, type, spells, end', async () => { await screenTest(); });

  console.log(n + ' checks passed' + (process.exitCode ? ' (some FAILED)' : ''));
})();

/* ---------------------------------------------------------------- a tiny fake DOM: just enough of it for the
   screen's code to run, so a typo or a bad reference there fails here rather than in someone's browser */
function fakeDom() {
  const keyL = [];
  class Node {
    constructor(tag) { this.tagName = String(tag).toUpperCase(); this.nodeType = 1; this.children = []; this.parent = null; this.attrs = {}; this.on = {}; this._text = '';
      this.style = { setProperty: (k, v) => { this.style[k] = v; } };
      const self = this;
      this.classList = { add: c => self._cls(c, true), remove: c => self._cls(c, false), toggle: (c, f) => self._cls(c, f === undefined ? !self.classList.contains(c) : !!f), contains: c => self.className.split(' ').includes(c) };
    }
    _cls(c, on) { const s = new Set(this.className.split(' ').filter(Boolean)); if (on) s.add(c); else s.delete(c); this.className = [...s].join(' '); return on; }
    get className() { return this.attrs.class || ''; } set className(v) { this.attrs.class = String(v); }
    get hidden() { return 'hidden' in this.attrs; } set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
    get dataset() { const d = {}; for (const k in this.attrs) if (k.startsWith('data-')) d[k.slice(5)] = this.attrs[k]; return d; }
    get isConnected() { let n = this; while (n.parent) n = n.parent; return n === doc.body; }
    get textContent() { return this.nodeType === 3 ? this._text : this.children.map(c => c.textContent).join(''); }
    set textContent(v) { this.children = []; if (v !== '') this.append(String(v)); }
    get offsetWidth() { return 100; }
    setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    append(...kids) { for (const k of kids) { const c = k && k.nodeType ? k : doc.createTextNode(String(k)); if (c.parent) c.remove(); c.parent = this; this.children.push(c); } }
    replaceChildren(...kids) { for (const c of this.children) c.parent = null; this.children = []; this.append(...kids); }
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; } }
    addEventListener(k, fn) { (this.on[k] = this.on[k] || []).push(fn); }
    removeEventListener(k, fn) { if (this.on[k]) this.on[k] = this.on[k].filter(f => f !== fn); }
    fire(k, e) { e = Object.assign({ type: k, target: this, preventDefault() {}, stopPropagation() {} }, e); for (const fn of this.on[k] || []) fn(e); return e; }
    click() { this.fire('click', {}); }
    getBoundingClientRect() { return { left: 0, top: 0, width: 500, height: 500 }; }
    setPointerCapture() {}
    all() { return [this, ...this.children.flatMap(c => c.nodeType === 1 ? c.all() : [])]; }
  }
  const doc = {
    createElement: tag => new Node(tag),
    createElementNS: (ns, tag) => new Node(tag),
    createTextNode: s => { const n = new Node('#text'); n.nodeType = 3; n._text = s; return n; },
    querySelector: () => null,
  };
  doc.body = new Node('body');
  global.document = doc;
  global.addEventListener = (k, fn) => keyL.push(fn);
  global.removeEventListener = (k, fn) => { const i = keyL.indexOf(fn); if (i >= 0) keyL.splice(i, 1); };
  const key = (k, o) => { const e = Object.assign({ key: k, target: doc.body, repeat: false, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} }, o); for (const fn of keyL.slice()) fn(e); return e; };
  return { doc, key, keyL };
}

async function screenTest() {
  const mounted = [];
  try { await screenSteps(mounted); } finally { for (const u of mounted) u.destroy(); }
}
async function screenSteps(mounted) {
  const { doc, key, keyL } = fakeDom();
  const ps = [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bo (HARD CPU)' }];
  let st = R.setup({ seed: 5, time: 60 }, ps, Date.now());
  put(st, SNAKE, { x2: 3, x3: 9, w2: -1, mana: [2, 20, 21, 22] });
  const acts = [], toasts = [], sounds = [];
  let ui;
  const push = () => ui.update(JSON.parse(JSON.stringify(R.view(st, 'a', Date.now()))));
  const api = {
    me: 'a', players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bo (HARD CPU)', cpu: 'hard' }], online: false,
    act: m => { acts.push(m); const r = R.move(st, 'a', m, Date.now()); if (r.err) toasts.push(r.err); else { st = r.state; push(); } },
    toast: (x, k) => toasts.push(x), sfx: s => sounds.push(s),
  };
  const host = doc.createElement('div');
  doc.body.append(host);
  ui = R.mount(host, api); mounted.push(ui);
  assert.ok(ui && typeof ui.update === 'function' && typeof ui.destroy === 'function');
  push();
  const all = () => host.all();
  const txt = cls => all().filter(x => x.classList.contains(cls)).map(x => x.textContent).join('|');
  const btn = label => all().find(x => x.tagName === 'BUTTON' && x.textContent.startsWith(label));
  const grid = all().find(x => x.classList.contains('rc-grid'));
  const at = c => ({ clientX: (c % 5 + 0.5) * 100, clientY: (Math.floor(c / 5) + 0.5) * 100, pointerId: 1, pointerType: 'touch', button: 0 });
  assert.strictEqual(all().filter(x => x.classList.contains('rc-tile')).length, 25);
  assert.ok(/Your turn/.test(txt('rc-turn')), txt('rc-turn'));
  assert.ok(/ROUND 1\/5/.test(txt('rc-round')));
  assert.ok(/Ana/.test(txt('rc-players')) && /BoCPU/.test(txt('rc-players')) && !/HARD/.test(txt('rc-players')), txt('rc-players'));
  assert.ok(all().some(x => x.getAttribute('title') === 'Bo (HARD CPU)'), 'the full name on hover');
  assert.ok(/1:00|0:59/.test(txt('rc-clock')), txt('rc-clock'));
  assert.ok(/×2/.test(txt('rc-tile')) && /×3/.test(txt('rc-tile')), 'runes drawn');

  /* drag RANGER: down on R, along, up: it casts */
  grid.fire('pointerdown', at(2));
  for (const c of [3, 4, 9, 8, 7]) grid.fire('pointermove', at(c));
  assert.ok(/RANGER/.test(txt('rc-word')), txt('rc-word'));
  assert.strictEqual(all().filter(x => x.classList.contains('sel')).length, 6);
  grid.fire('pointerup', at(7));
  assert.deepStrictEqual(acts.pop(), { cast: [2, 3, 4, 9, 8, 7] });
  assert.deepStrictEqual(toasts, []);
  assert.strictEqual(st.ps[0].score, 2 + 4 + 2 + 9 + 1 + 2 + 3);
  assert.strictEqual(st.ps[0].mana, 4, 'a crystal on the R');
  assert.ok(/Bo is thinking/.test(txt('rc-turn')), txt('rc-turn'));
  assert.ok(/You cast RANGER/.test(txt('rc-last')), txt('rc-last'));
  assert.ok(sounds.includes('solve'));

  /* not my turn: input does nothing */
  grid.fire('pointerdown', at(0)); grid.fire('pointerup', at(0));
  key('Enter');
  assert.strictEqual(acts.length, 0);

  /* Bo passes; my turn again */
  put(st, SNAKE, { x2: 3, x3: 9, mana: [20, 21, 22, 23] });
  ok(R.move(st, 'b', { pass: true }, Date.now()));
  push();
  assert.ok(/Your turn/.test(txt('rc-turn')));
  assert.ok(sounds.includes('ping'));

  /* a mouse that comes back with no button down isn't still tracing */
  grid.fire('pointerdown', Object.assign(at(0), { pointerType: 'mouse' }));
  grid.fire('pointermove', Object.assign(at(1), { pointerType: 'mouse', buttons: 0 }));
  grid.fire('pointermove', Object.assign(at(2), { pointerType: 'mouse', buttons: 0 }));
  assert.strictEqual(txt('rc-w'), 'S');
  key('Escape');

  /* a diagonal drag doesn't catch the tiles beside it */
  grid.fire('pointerdown', at(0));
  for (let f = 0.1; f <= 1.001; f += 0.1) grid.fire('pointermove', { clientX: 50 + f * 100, clientY: 50 + f * 100, pointerId: 1 });
  grid.fire('pointercancel', at(6));
  assert.ok(/^SS/.test(txt('rc-w')), 'S then S, nothing between: ' + txt('rc-w'));
  key('Escape');
  assert.strictEqual(txt('rc-w'), '');

  /* tap tile by tile, tap the end again to take it off, then CAST */
  for (const c of [2, 3, 4, 4, 4]) { grid.fire('pointerdown', at(c)); grid.fire('pointerup', at(c)); }
  assert.ok(/^RAN/.test(txt('rc-w')), txt('rc-w'));
  grid.fire('pointerdown', at(9)); grid.fire('pointerup', at(9));
  grid.fire('pointerdown', at(8)); grid.fire('pointerup', at(8));
  assert.ok(/RANGE/.test(txt('rc-w')));

  /* keyboard: Backspace, letters, Enter */
  let e = key('Backspace');
  assert.ok(e.prevented && /^RANG$/.test(txt('rc-w')), txt('rc-w'));
  key('e'); key('r');
  assert.ok(/^RANGER$/.test(txt('rc-w')), txt('rc-w'));
  e = key('x');
  assert.ok(/^RANGER$/.test(txt('rc-w')) && sounds[sounds.length - 1] === 'bad', 'no X next to it');
  key('Escape');
  key('s'); key('t'); key('r'); key('a'); key('n'); key('g'); key('e');
  assert.ok(/^STRANGE$/.test(txt('rc-w')), txt('rc-w'));
  key('Enter', { target: { tagName: 'INPUT' } });
  assert.strictEqual(acts.length, 0, 'typing in a chat box isn\'t for the game');
  key('Enter');
  assert.deepStrictEqual(acts.pop(), { cast: [0, 1, 2, 3, 4, 9, 8] });
  assert.ok(st.last.w === 'strange');

  /* Bo again, then spells */
  put(st, SNAKE, { mana: [20, 21, 22, 23] });
  ok(R.move(st, 'b', { pass: true }, Date.now()));
  push();
  st.ps[0].mana = 10; push();
  btn('Transmute').click();
  assert.ok(/Pick a tile/.test(txt('rc-word')));
  grid.fire('pointerdown', at(5));
  const pick = all().find(x => x.classList.contains('rc-pick'));
  assert.ok(!pick.hidden, 'the letter picker opens');
  key('e');
  assert.deepStrictEqual(acts.pop(), { act: 'transmute', cell: 5, letter: 'e' });
  assert.strictEqual(st.grid.L[5], 'e'); assert.ok(pick.hidden);
  btn('Transmute').click(); grid.fire('pointerdown', at(7));
  assert.ok(!pick.hidden);
  btn('Scry').click();
  assert.deepStrictEqual(acts.pop(), { act: 'scry' });
  assert.ok(pick.hidden, 'another spell closes the picker');
  assert.ok(/Scry:/.test(txt('rc-word')), txt('rc-word'));
  btn('Reshuffle').click();
  assert.deepStrictEqual(acts.pop(), { act: 'shuffle' });
  st.ps[0].mana = 0; push();
  btn('Scry').click();
  assert.strictEqual(acts.length, 0, 'no mana, no scry');
  assert.ok(/needs 3 mana/.test(txt('rc-word')), txt('rc-word'));

  /* pass asks first */
  btn('PASS').click();
  assert.strictEqual(acts.length, 0);
  btn('SURE?').click();
  assert.deepStrictEqual(acts.pop(), { pass: true });

  /* to the end: the final board stays, the buttons go */
  while (R.turn(st).length) ok(R.move(st, R.turn(st)[0], { pass: true }, Date.now()));
  push();
  assert.ok(/Game over/.test(txt('rc-turn')), txt('rc-turn'));
  assert.ok(all().find(x => x.classList.contains('rc')).classList.contains('over'));
  assert.strictEqual(all().filter(x => x.classList.contains('rc-tile')).length, 25);

  /* a watcher's screen, garbage views, and destroy */
  const host2 = doc.createElement('div'); doc.body.append(host2);
  const ui2 = R.mount(host2, Object.assign({}, api, { me: null })); mounted.push(ui2);
  for (const v of [null, 5, {}, { grid: {} }, { grid: { L: 'abc' }, players: [] }]) ui2.update(v);
  ui2.update(R.view(st, null, Date.now()));
  assert.ok(host2.all().find(x => x.classList.contains('rc')).classList.contains('watch'));
  const nKeys = keyL.length;
  ui.destroy(); ui2.destroy();
  assert.strictEqual(keyL.length, nKeys - 2, 'key listeners removed');
  assert.strictEqual(host.children.length, 0);
}
