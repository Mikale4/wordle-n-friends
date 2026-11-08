/* test.js -- checks the word engine and the rank maths in node:  node tools/test.js */
'use strict';
const path = require('path'), assert = require('assert');
global.window = global;
if (!global.crypto) global.crypto = require('crypto').webcrypto;
require(path.join(__dirname, '..', 'js', 'util.js'));
require(path.join(__dirname, '..', 'js', 'words.js'));
require(path.join(__dirname, '..', 'js', 'engine.js'));
require(path.join(__dirname, '..', 'js', 'rank.js'));
const E = window.Engine, R = window.Rank;
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + '\n  ' + e.message); process.exitCode = 1; } };
const s = (g, a) => E.score(g, a).join('');

t('all hits', () => assert.strictEqual(s('crane', 'crane'), '22222'));
t('all misses', () => assert.strictEqual(s('blimp', 'crane'), '00000'));
t('near', () => assert.strictEqual(s('nacre', 'crane'), '11112'));
t('repeat in guess, one in answer: hit wins', () => assert.strictEqual(s('geese', 'those'), '00022'));
t('repeat in guess, one in answer: first near only', () => assert.strictEqual(s('eerie', 'crane'), '00102'));
t('two in guess, two in answer', () => assert.strictEqual(s('speed', 'erase'), '10110'));
t('hit claims before near', () => assert.strictEqual(s('allee', 'eagle'), '11012'));
t('every answer is a valid word', () => { for (const L of E.LENS) for (const w of E.answers(L)) assert.ok(E.isWord(w), w); });
t('answer counts', () => { for (const L of E.LENS) assert.ok(E.answers(L).length > 1000, L + ' letters: ' + E.answers(L).length); });
t('not a word', () => { assert.ok(!E.isWord('zzzzz')); assert.ok(!E.isWord('abc')); assert.ok(E.isWord('crane')); });
t('hard mode: hit must stay', () => assert.ok(/1st letter must be C/.test(E.hardError('trace', [{ w: 'crane', p: [2, 0, 0, 0, 0] }]))));
t('hard mode: near must be used', () => assert.ok(/contain R/.test(E.hardError('blimp', [{ w: 'crane', p: [0, 1, 0, 0, 0] }]))));
t('hard mode: fine guess', () => assert.strictEqual(E.hardError('cider', [{ w: 'crane', p: [2, 1, 0, 0, 1] }]), null));
t('game: win', () => { const g = new E.Game({ len: 5, max: 6, words: ['crane'] }); g.guess('slate'); const r = g.guess('crane'); assert.ok(r.won && r.done && g.n === 2); });
t('game: lose', () => { const g = new E.Game({ len: 5, max: 2, words: ['crane'] }); g.guess('slate'); const r = g.guess('blimp'); assert.ok(!r.won && r.done); });
t('game: bad word costs nothing', () => { const g = new E.Game({ len: 5, max: 6, words: ['crane'] }); assert.ok(g.guess('qqqqq').err); assert.strictEqual(g.n, 0); });
t('game: quad', () => { const g = new E.Game({ len: 5, max: 9, words: ['crane', 'slate', 'pound', 'light'] }); g.guess('slate'); assert.strictEqual(g.solvedCount, 1); const r = g.guess('crane'); assert.strictEqual(r.pats[1], null); assert.strictEqual(g.solvedCount, 2); });
t('keys', () => { const g = new E.Game({ len: 5, max: 6, words: ['crane'] }); g.guess('react'); const k = E.keyStates(g.boards); assert.deepStrictEqual([k.r[0], k.e[0], k.a[0], k.c[0], k.t[0]], [1, 1, 2, 1, 0]); });
t('daily is stable and a real answer', () => { const a = E.daily(10), b = E.daily(10); assert.strictEqual(a, b); assert.ok(E.answers(5).includes(a)); assert.notStrictEqual(E.daily(10), E.daily(11)); });
t('bots solve', () => {
  for (const skill of ['easy', 'normal', 'hard']) {
    let won = 0, total = 0;
    for (let i = 0; i < 60; i++) {
      const word = E.randomWord(5), bot = new E.Bot(5, skill), g = new E.Game({ len: 5, max: 6, words: [word] });
      while (!g.done) g.guess(bot.next(g.boards[0].rows));
      if (g.won) { won++; total += g.n; }
    }
    console.log('  bot ' + skill + ': won ' + won + '/60, avg ' + (total / Math.max(1, won)).toFixed(2) + ' guesses');
    assert.ok(won >= (skill === 'easy' ? 20 : 45), skill + ' won only ' + won);
  }
});
t('rank tiers', () => { assert.strictEqual(R.tier(1000).name, 'SILVER'); assert.strictEqual(R.tier(500).name, 'BRONZE'); assert.strictEqual(R.tier(1800).name, 'LEGEND'); });
t('elo is zero-sum for equal K', () => { const a = R.delta(1000, 1000, 1, 30), b = R.delta(1000, 1000, 0, 30); assert.strictEqual(a + b, 0); assert.ok(a > 0); });
t('levels', () => { assert.strictEqual(R.level(0).lv, 1); assert.ok(R.level(5000).lv > 5); });
console.log(n + ' checks passed' + (process.exitCode ? ' (some FAILED)' : ''));
