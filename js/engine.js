/* engine.js -- the word game itself: the lists, scoring a guess, hard mode, a game of one or more boards, the
   Daily word, and the CPU opponent. No DOM here (tools/test.js runs it in node).

   A guess is scored against the answer letter by letter: 2 = right letter, right spot (HIT); 1 = in the word, but
   elsewhere (NEAR); 0 = not in the word, or every copy of it is already accounted for (MISS). Repeated letters are
   counted the fair way: HITs claim their copies first, then NEARs left to right while copies remain. */
(function () {
  'use strict';
  const W = window.WORDS;
  const LENS = [4, 5, 6, 7];
  const split = (s, n) => { const a = new Array(s.length / n); for (let i = 0, j = 0; i < s.length; i += n, j++) a[j] = s.substr(i, n); return a; };
  const cache = {};
  const lists = n => {
    if (!cache[n]) { const A = split(W.A[n], n), V = split(W.V[n], n); cache[n] = { A, set: new Set(A.concat(V)) }; }
    return cache[n];
  };

  function score(guess, answer) {
    const n = guess.length, p = new Array(n).fill(0), left = {};
    for (let i = 0; i < n; i++) { if (guess[i] === answer[i]) p[i] = 2; else left[answer[i]] = (left[answer[i]] || 0) + 1; }
    for (let i = 0; i < n; i++) if (p[i] !== 2 && left[guess[i]] > 0) { p[i] = 1; left[guess[i]]--; }
    return p;
  }
  const solvedPat = p => p.every(x => x === 2);

  /* HARD MODE: every HIT stays in its spot, and every NEAR is used again (as many copies as were shown) */
  function hardError(guess, rows) {
    const ord = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];
    for (const r of rows) {
      for (let i = 0; i < r.w.length; i++) if (r.p[i] === 2 && guess[i] !== r.w[i]) return ord[i] + ' letter must be ' + r.w[i].toUpperCase();
      const need = {};
      for (let i = 0; i < r.w.length; i++) if (r.p[i] >= 1) need[r.w[i]] = (need[r.w[i]] || 0) + 1;
      for (const c in need) { let have = 0; for (const g of guess) if (g === c) have++; if (have < need[c]) return 'Guess must contain ' + c.toUpperCase(); }
    }
    return null;
  }

  /* a game: one board (Classic, Daily, a Blitz word...) or several (Quad), all fed the same guesses */
  class Game {
    constructor(o) {
      this.len = o.len; this.max = o.max; this.hard = !!o.hard;
      this.boards = o.words.map(w => ({ word: w, rows: [], solved: false, at: 0 }));
      this.n = 0; this.done = false; this.won = false; this.t0 = Date.now();
    }
    check(w) {
      w = String(w || '').toLowerCase();
      if (w.length !== this.len) return 'Not enough letters';
      if (!Engine.isWord(w)) return 'Not in word list';
      if (this.hard && this.boards.length === 1) { const e = hardError(w, this.boards[0].rows); if (e) return e; }
      return null;
    }
    guess(w) {
      if (this.done) return { err: 'This game is over' };
      w = String(w || '').toLowerCase();
      const err = this.check(w); if (err) return { err };
      this.n++;
      const pats = this.boards.map(b => {
        if (b.solved) return null;
        const p = score(w, b.word); b.rows.push({ w, p });
        if (solvedPat(p)) { b.solved = true; b.at = this.n; }
        return p;
      });
      this.won = this.boards.every(b => b.solved);
      this.done = this.won || this.n >= this.max;
      if (this.done) this.ms = Date.now() - this.t0;
      return { w, pats, won: this.won, done: this.done };
    }
    get solvedCount() { return this.boards.filter(b => b.solved).length; }
  }
  /* the keyboard's colours: for each letter, its best result on each board (-1 = not tried yet) */
  function keyStates(boards) {
    const out = {};
    boards.forEach((b, k) => {
      for (const r of b.rows) for (let i = 0; i < r.w.length; i++) {
        const c = r.w[i]; if (!out[c]) out[c] = boards.map(() => -1);
        out[c][k] = Math.max(out[c][k], r.p[i]);
      }
    });
    return out;
  }

  /* THE DAILY: one 5-letter word a day, the same for everyone (a fixed shuffle of the answers, walked a day at a time) */
  let dailyOrder = null;
  function daily(day) {
    if (!dailyOrder) dailyOrder = U.shuffle(lists(5).A.slice(), U.rng(0x5eed5));
    return dailyOrder[((day - 1) % dailyOrder.length + dailyOrder.length) % dailyOrder.length];
  }

  /* THE CPU: keeps the words that still fit everything it has seen, and picks one.
     EASY forgets all but its last two clues and picks at random; NORMAL picks at random from what fits;
     HARD picks the word whose letters are commonest among what fits (it narrows things down fastest). */
  class Bot {
    constructor(len, skill) { this.len = len; this.skill = skill; this.all = lists(len).A; }
    next(rows) {
      const use = this.skill === 'easy' ? rows.slice(-2) : rows;
      let c = this.all.filter(w => use.every(r => score(r.w, w).join('') === r.p.join('')));
      const tried = new Set(rows.map(r => r.w)); c = c.filter(w => !tried.has(w));
      if (!c.length) c = this.all.filter(w => !tried.has(w));
      if (this.skill !== 'hard' || c.length <= 2) return U.pick(c);
      const f = {}, pos = Array.from({ length: this.len }, () => ({}));
      for (const w of c) { const seen = new Set(); for (let i = 0; i < w.length; i++) { pos[i][w[i]] = (pos[i][w[i]] || 0) + 1; if (!seen.has(w[i])) { seen.add(w[i]); f[w[i]] = (f[w[i]] || 0) + 1; } } }
      let best = null, bs = -1;
      const pool = c.length > 400 ? U.shuffle(c.slice()).slice(0, 400) : c;
      for (const w of pool) { const seen = new Set(); let s = 0; for (let i = 0; i < w.length; i++) { s += pos[i][w[i]] * 0.5; if (!seen.has(w[i])) { seen.add(w[i]); s += f[w[i]]; } } if (s > bs) { bs = s; best = w; } }
      return best;
    }
  }

  const Engine = window.Engine = {
    LENS,
    maxFor: len => ({ 4: 6, 5: 6, 6: 7, 7: 8 })[len] || 6,
    answers: n => lists(n).A,
    isWord: w => !!w && LENS.includes(w.length) && lists(w.length).set.has(w),
    randomWord: (n, r = Math.random, avoid) => { const A = lists(n).A; for (let i = 0; i < 20; i++) { const w = U.pick(A, r); if (!avoid || !avoid.has(w)) return w; } return U.pick(A, r); },
    score, solvedPat, hardError, Game, keyStates, daily, Bot,
  };
})();
