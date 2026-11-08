/* ============================================================================
   play.js -- the solo modes.
     DAILY     one 5-letter word a day, the same for everyone; streaks; share
     CLASSIC   endless words of 4-7 letters (4, 5: six guesses; 6: seven; 7: eight)
     QUAD      four 5-letter words at once, nine guesses
     BLITZ     three minutes, as many words as you can
     SURVIVAL  a pool of 10 guesses; each solve refunds 5; six at most per word
     VS CPU    race the computer to the same word, first to two rounds
   Play.start(mode, opts)
   ========================================================================== */
(function () {
  'use strict';
  const { el } = U;
  const PRAISE = { 1: 'UNREAL!', 2: 'BRILLIANT!', 3: 'SUPERB!', 4: 'NICE ONE!', 5: 'SOLID!', 6: 'CLUTCH!', 7: 'MADE IT!', 8: 'JUST IN TIME!', 9: 'LAST GASP!' };
  const TITLES = { daily: 'DAILY', classic: 'CLASSIC', quad: 'QUAD', blitz: 'BLITZ', survival: 'SURVIVAL', cpu: 'VS CPU' };
  const BLITZ_MS = 180000, POOL0 = 10, REFUND = 5;
  let C = null;   // the game on screen

  /* ---------------------------------------------------------------- shared */
  function note(text, cls, ms) {
    if (!C || !C.noteEl) return;
    const n = el('div', { class: 'gnote ' + (cls || '') }, text); C.noteEl.append(n);
    setTimeout(() => n.classList.add('out'), ms || 1400); setTimeout(() => n.remove(), (ms || 1400) + 400);
  }
  function record(key, won, n, score) {
    const st = Auth.stat(key);
    st.played++;
    if (score != null) { st.best = Math.max(st.best || 0, score); st.total = (st.total || 0) + score; }
    else if (won) { st.won++; st.streak++; st.maxStreak = Math.max(st.maxStreak, st.streak); if (n) st.dist[n] = (st.dist[n] || 0) + 1; }
    else st.streak = 0;
    Auth.save(); return st;
  }
  function emoji(rows) { const cb = Auth.prefs.cb; return rows.map(r => r.p.map(x => x === 2 ? (cb ? '🟧' : '🟩') : x === 1 ? (cb ? '🟦' : '🟨') : '⬛').join('')).join('\n'); }
  function share(text) {
    if (navigator.share && U.touch) { navigator.share({ text }).catch(() => {}); return; }
    try { navigator.clipboard.writeText(text); Menu.toast('Copied your result. Paste it anywhere.', 'gold'); } catch (e) { Menu.toast('Couldn\'t copy.', 'bad'); }
  }
  function results(o) {
    const { btn } = Menu.ui;
    setTimeout(() => {
      if (!C || C.id !== o.id) return;
      Menu.modal({ title: o.title, cls: 'results ' + (o.won ? 'won' : 'lost'), body: [
        o.words ? el('div', { class: 'reswords' }, ...o.words.map(w => Menu.tiles(w.toUpperCase(), o.won ? '2'.repeat(w.length) : '0'.repeat(w.length), 'sm'))) : null,
        o.sub ? el('p', { class: 'ressub' }, o.sub) : null,
        o.body || null,
        o.xp ? el('p', { class: 'resxp' }, '+' + o.xp + ' XP') : null,
      ], buttons: [
        o.again ? ['PLAY AGAIN', () => o.again(), 'big'] : null,
        o.share ? ['SHARE', () => { share(o.share); return false; }, 'ghost'] : null,
        ['MENU', () => Menu.hub(), 'ghost'],
      ].filter(Boolean) });
    }, o.delay == null ? 900 : o.delay);
  }
  function distBox(st, max, hl) {
    const d = st.dist || {}, top = Math.max(1, ...Object.values(d));
    return el('div', { class: 'resstats' },
      el('div', { class: 'nums' }, el('div', null, el('b', null, st.played), el('small', null, 'PLAYED')), el('div', null, el('b', null, st.played ? Math.round(st.won / st.played * 100) : 0), el('small', null, 'WIN %')),
        el('div', null, el('b', null, st.streak), el('small', null, 'STREAK')), el('div', null, el('b', null, st.maxStreak), el('small', null, 'BEST'))),
      el('div', { class: 'dist' }, ...Array.from({ length: max }, (_, i) => i + 1).map(n => el('div', { class: 'distrow' + (n === hl ? ' hl' : '') }, el('span', null, n), el('i', { style: { width: Math.max(6, (d[n] || 0) / top * 100) + '%' } }, d[n] || 0)))));
  }

  /* the screen: top bar (with a slot for the mode's info), a note line, the boards and the keyboard */
  function screen(mode, o) {
    const id = Math.random();
    C = { id, mode, o, over: false, timers: [] };
    C.info = el('div', { class: 'ginfo' });
    C.side = el('div', { class: 'gside' });
    C.noteEl = el('div', { class: 'gnotes' });
    C.stage = el('div', { class: 'gstage' });
    const scr = el('div', { class: 'screen play mode-' + mode }, Menu.ui.topbar(o.title || TITLES[mode], () => quit(), C.info, Tutorial.button('w-' + mode)),
      el('div', { class: 'gwrap' }, C.side, el('div', { class: 'gmain' }, C.noteEl, C.stage)));
    App.screen(scr);
    App.onLeave(() => { if (C && C.id === id) { C.timers.forEach(t => { clearInterval(t); clearTimeout(t); }); C = null; } });
    Net.setStatus('solo', 'Playing ' + (o.title || TITLES[mode]).replace(/^\w/, c => c) .toLowerCase().replace(/^\w/, c => c.toUpperCase()));
    return C;
  }
  function quit() {
    if (C && !C.over && C.quitAsk) { C.quitAsk(); return; }
    Menu.hub();
  }
  /* a fresh board for a game (a new word in Blitz/Survival/VS CPU replaces it) */
  function mount(game, count) {
    const V = new BoardView({ len: game.len, max: game.max, count: count || 1, onKey: k => key(k) });
    C.stage.innerHTML = ''; C.stage.append(V.el, V.kb);
    C.V = V; C.game = game;
    App.keys = k => key(k);
    return V;
  }
  function key(k) {
    if (!C || C.over || !C.V || C.V.busy || C.wait) return;
    if (k === 'enter') submit(); else if (k === 'back') C.V.del(); else C.V.type(k);
  }
  function submit() {
    const V = C.V, g = C.game, w = V.value;
    if (w.length < g.len) { V.shake(); note('Not enough letters'); return; }
    const r = g.guess(w);
    if (r.err) { V.shake(); note(r.err); return; }
    const myC = C;
    if (C.onGuess) C.onGuess(r);
    V.reveal(w, r.pats, () => { if (C === myC && C.after) C.after(r); });
  }

  /* ----------------------------------------------------------------- DAILY */
  function daily() {
    const S = Auth.S, day = U.dayNum(), word = Engine.daily(day);
    for (const d of Object.keys(S.daily)) if (+d < day - 60) delete S.daily[d];
    const D = S.daily[day] = S.daily[day] || { rows: [], done: false, won: false, hard: !!S.prefs.hard };
    const g = new Engine.Game({ len: 5, max: 6, words: [word], hard: D.hard });
    for (const w of D.rows) g.guess(w);
    screen('daily', { title: 'DAILY #' + day });
    if (D.hard) C.info.append(el('em', { class: 'pill' }, 'HARD'));
    const V = mount(g); V.load([g.boards[0].rows]);
    const shareText = () => 'Wordle n\' Friends · Daily #' + day + ' · ' + (g.won ? g.n : 'X') + '/6' + (D.hard ? '*' : '') + '\n\n' + emoji(g.boards[0].rows);
    const finish = fresh => {
      C.over = true;
      let st = Auth.stat('daily');
      if (fresh) {
        D.done = true; D.won = g.won;
        st.played++;
        if (g.won) { st.won++; st.streak = st.lastWin === day - 1 ? st.streak + 1 : 1; st.lastWin = day; st.maxStreak = Math.max(st.maxStreak, st.streak); st.dist[g.n] = (st.dist[g.n] || 0) + 1; }
        else st.streak = 0;
        Auth.save();
        Rank.xp(g.won ? 40 + (6 - g.n) * 10 : 10);
        SFX.play(g.won ? 'win' : 'lose');
      }
      if (!g.won) V.answer([word]);
      const nextIn = el('b', null, U.hms(U.msToMidnight())); C.timers.push(setInterval(() => { nextIn.textContent = U.hms(U.msToMidnight()); }, 1000));
      results({ id: C.id, won: g.won, title: g.won ? PRAISE[g.n] : 'THE WORD WAS', words: [word], sub: g.won ? 'Daily #' + day + ' in ' + g.n + '.' : 'Better luck tomorrow.', delay: fresh ? 1000 : 300,
        body: el('div', null, distBox(st, 6, g.won ? g.n : 0), el('p', { class: 'next' }, 'NEXT DAILY IN ', nextIn)),
        xp: fresh ? (g.won ? 40 + (6 - g.n) * 10 : 10) : 0, share: shareText() });
    };
    if (D.done) { finish(false); return; }
    C.after = r => { D.rows.push(r.w); Auth.save(); if (r.won) note(PRAISE[g.n], 'big', 1600); if (r.done) finish(true); };
  }

  /* --------------------------------------------------------------- CLASSIC */
  function classic(o) {
    const len = Engine.LENS.includes(o.len) ? o.len : 5, max = Engine.maxFor(len), word = Engine.randomWord(len);
    screen('classic', { title: 'CLASSIC · ' + len });
    if (Auth.prefs.hard) C.info.append(el('em', { class: 'pill' }, 'HARD'));
    const g = new Engine.Game({ len, max, words: [word], hard: Auth.prefs.hard }), V = mount(g);
    C.after = r => {
      if (r.won) note(PRAISE[g.n], 'big', 1600);
      if (!r.done) return;
      C.over = true; const st = record('classic' + len, r.won, g.n), xp = r.won ? 20 + (max - g.n) * 5 : 5; Rank.xp(xp);
      SFX.play(r.won ? 'win' : 'lose'); if (!r.won) V.answer([word]);
      results({ id: C.id, won: r.won, title: r.won ? PRAISE[g.n] : 'THE WORD WAS', words: [word], sub: r.won ? 'Solved in ' + g.n + ' of ' + max + '.' : null,
        body: distBox(st, max, r.won ? g.n : 0), xp, again: () => Play.start('classic', { len }), share: 'Wordle n\' Friends · Classic ' + len + ' · ' + (r.won ? g.n : 'X') + '/' + max + '\n\n' + emoji(g.boards[0].rows) });
    };
  }

  /* ------------------------------------------------------------------ QUAD */
  function quad() {
    const words = []; const seen = new Set(); while (words.length < 4) { const w = Engine.randomWord(5, Math.random, seen); seen.add(w); words.push(w); }
    screen('quad', {});
    const g = new Engine.Game({ len: 5, max: 9, words }), V = mount(g, 4);
    const left = el('b', null, '9'); C.info.append(el('span', { class: 'gstat' }, el('small', null, 'GUESSES LEFT'), left));
    C.after = r => {
      left.textContent = 9 - g.n;
      r.pats.forEach((p, k) => { if (p && Engine.solvedPat(p)) note('Board ' + (k + 1) + ' solved!', 'good'); });
      if (!r.done) return;
      C.over = true; const st = record('quad', r.won, g.n), xp = r.won ? 40 + (9 - g.n) * 8 : 6 * g.solvedCount; Rank.xp(xp);
      SFX.play(r.won ? 'win' : 'lose'); V.answer(words);
      results({ id: C.id, won: r.won, title: r.won ? PRAISE[Math.max(1, g.n - 3)] : g.solvedCount + ' OF 4', words, sub: r.won ? 'All four in ' + g.n + '.' : 'You solved ' + g.solvedCount + ' of the four.',
        body: distBox(st, 9, r.won ? g.n : 0), xp, again: () => Play.start('quad'),
        share: 'Wordle n\' Friends · Quad · ' + (r.won ? g.n : 'X') + '/9\n' + g.boards.map((b, k) => (b.solved ? ['1️⃣', '2️⃣', '3️⃣', '4️⃣'][k] + ' ' + b.at : '🟥')).join(' ') });
    };
  }

  /* ----------------------------------------------------------------- BLITZ */
  function blitz(o) {
    const len = Engine.LENS.includes(o.len) ? o.len : 5, max = Engine.maxFor(len);
    screen('blitz', { title: 'BLITZ · ' + len });
    const used = new Set(), log = [];
    let solved = 0, ends = 0, started = false;
    const bar = el('i'), clock = el('b', null, U.clock(BLITZ_MS)), score = el('b', null, '0');
    C.info.append(el('span', { class: 'gstat' }, el('small', null, 'SOLVED'), score), el('span', { class: 'gstat' }, el('small', null, 'TIME'), clock));
    C.stageBar = el('div', { class: 'timebar' }, bar); C.side.append(el('h3', null, 'WORDS'), C.list = el('div', { class: 'wlist' }));
    const next = () => {
      const w = Engine.randomWord(len, Math.random, used); used.add(w);
      const g = new Engine.Game({ len, max, words: [w], hard: Auth.prefs.hard }); mount(g); C.stage.prepend(C.stageBar); C.wait = false;
    };
    const tick = () => {
      if (!started) return;
      const left = ends - Date.now(); clock.textContent = U.clock(left); bar.style.width = U.clamp(left / BLITZ_MS * 100, 0, 100) + '%';
      C.stageBar.classList.toggle('low', left < 20000); Music.urgent(left < 20000);
      if (left <= 0) finish();
    };
    const finish = () => {
      if (C.over) return; C.over = true;
      const st = record('blitz', true, 0, solved), xp = 8 + solved * 12; Rank.xp(xp); SFX.play('win');
      if (C.game && !C.game.done) log.push({ w: C.game.boards[0].word, ok: false, open: true });
      results({ id: C.id, won: solved > 0, title: solved + ' WORD' + (solved === 1 ? '' : 'S'), sub: solved >= (st.best || 0) && solved > 0 ? 'A new best!' : 'Best: ' + st.best,
        body: el('div', { class: 'wlist big' }, ...log.map(x => el('span', { class: x.ok ? 'ok' : 'no' }, x.w.toUpperCase()))), xp, again: () => Play.start('blitz', { len }), delay: 300,
        share: 'Wordle n\' Friends · Blitz ' + len + ' · ' + solved + ' words in 3:00' });
    };
    C.onGuess = () => { if (!started) { started = true; ends = Date.now() + BLITZ_MS; note('GO!', 'big'); } };
    C.after = r => {
      if (!r.done || C.over) return;
      const w = C.game.boards[0].word; log.push({ w, ok: r.won });
      C.list.prepend(el('span', { class: r.won ? 'ok' : 'no' }, w.toUpperCase()));
      if (r.won) { solved++; score.textContent = solved; SFX.play('solve'); note('+1', 'good'); C.wait = true; C.timers.push(setTimeout(() => { if (!C.over) next(); }, 450)); }
      else { C.V.answer([w]); note(w.toUpperCase(), 'bad', 1200); C.wait = true; C.timers.push(setTimeout(() => { if (!C.over) next(); }, 1300)); }
    };
    C.quitAsk = () => { if (!started) return Menu.hub(); Menu.modal({ title: 'QUIT BLITZ?', body: [el('p', null, 'This run will end here.')], buttons: [['END RUN', () => finish(), 'danger'], ['KEEP GOING', () => {}, 'ghost']] }); };
    C.timers.push(setInterval(tick, 100));
    next(); note('The clock starts with your first guess.', '', 2400);
  }

  /* -------------------------------------------------------------- SURVIVAL */
  function survival() {
    screen('survival', {});
    let pool = POOL0, solved = 0; const used = new Set(), log = [];
    const poolEl = el('b', null, pool), score = el('b', null, '0');
    C.info.append(el('span', { class: 'gstat' }, el('small', null, 'SOLVED'), score), el('span', { class: 'gstat pool' }, el('small', null, 'GUESS POOL'), poolEl));
    C.side.append(el('h3', null, 'RULES'), el('p', { class: 'small' }, 'Every guess costs one from your pool. Solve a word and win ' + REFUND + ' back. Six guesses at most per word. The run ends when the pool runs dry or a word beats you.'), el('h3', null, 'WORDS'), C.list = el('div', { class: 'wlist' }));
    const next = () => {
      const w = Engine.randomWord(5, Math.random, used); used.add(w);
      const g = new Engine.Game({ len: 5, max: Math.min(6, pool), words: [w], hard: Auth.prefs.hard }); const V = mount(g);
      V.lock(Math.min(6, pool)); C.wait = false;
    };
    const finish = () => {
      if (C.over) return; C.over = true;
      const st = record('survival', true, 0, solved), xp = 6 + solved * 12; Rank.xp(xp); SFX.play('lose');
      results({ id: C.id, won: solved > 0, title: solved + ' WORD' + (solved === 1 ? '' : 'S'), words: [C.game.boards[0].word], sub: 'The run ends. ' + (solved >= st.best && solved ? 'A new best!' : 'Best: ' + st.best),
        body: el('div', { class: 'wlist big' }, ...log.map(x => el('span', { class: 'ok' }, x.toUpperCase()))), xp, again: () => Play.start('survival'),
        share: 'Wordle n\' Friends · Survival · ' + solved + ' words' });
    };
    C.onGuess = () => { pool--; poolEl.textContent = pool; };
    C.after = r => {
      if (r.won) {
        solved++; pool += REFUND; score.textContent = solved; poolEl.textContent = pool; log.push(C.game.boards[0].word);
        C.list.prepend(el('span', { class: 'ok' }, C.game.boards[0].word.toUpperCase()));
        SFX.play('solve'); note('+' + REFUND + ' guesses', 'good'); C.wait = true; C.timers.push(setTimeout(() => { if (!C.over) next(); }, 600));
      } else if (r.done) { C.V.answer([C.game.boards[0].word]); finish(); }
    };
    next();
  }

  /* ---------------------------------------------------------------- VS CPU */
  const BOT_MS = { easy: [9000, 14000], normal: [6000, 10000], hard: [4200, 7200] };
  function cpu(o) {
    const skill = BOT_MS[o.skill] ? o.skill : 'normal';
    screen('cpu', { title: 'VS CPU · ' + skill.toUpperCase() });
    const sc = [0, 0]; let round = 0;
    const scoreEl = el('b', { class: 'vs' }, '0 – 0');
    C.info.append(el('span', { class: 'gstat' }, el('small', null, 'YOU – CPU'), scoreEl));
    const oppBox = el('div', { class: 'opp' }), oppNote = el('small', { class: 'oppnote' });
    C.side.append(el('h3', null, 'CPU'), oppBox, oppNote);
    const startRound = () => {
      round++; const word = Engine.randomWord(5);
      const g = new Engine.Game({ len: 5, max: 6, words: [word], hard: Auth.prefs.hard }); mount(g);
      const bot = new Engine.Bot(5, skill), bg = new Engine.Game({ len: 5, max: 6, words: [word] });
      const R = C.round = { word, g, bg, done: false };
      const drawOpp = () => { oppBox.innerHTML = ''; oppBox.append(BoardView.mini(5, 6, bg.boards[0].rows.map(r => r.p), { solved: bg.won, failed: bg.done && !bg.won })); oppNote.textContent = bg.won ? 'Solved in ' + bg.n + '!' : bg.done ? 'Out of guesses.' : 'Thinking...'; };
      drawOpp();
      const botStep = first => {
        const [a, b] = BOT_MS[skill];
        C.timers.push(setTimeout(() => {
          if (!C || C.round !== R || R.done) return;
          bg.guess(bot.next(bg.boards[0].rows)); drawOpp(); SFX.play('tick');
          if (bg.won) end(-1); else if (bg.done) { if (g.done) end(0); else note('The CPU ran out of guesses!', 'good'); }
          else botStep(false);
        }, (first ? 0.6 : 1) * (a + Math.random() * (b - a))));
      };
      botStep(true);
      note('ROUND ' + round, 'big', 1200);
      C.wait = false;
    };
    /* who: 1 you won it, -1 the CPU did, 0 neither */
    const end = who => {
      const R = C.round; if (R.done) return; R.done = true; C.wait = true;
      if (who > 0) sc[0]++; else if (who < 0) sc[1]++;
      scoreEl.textContent = sc[0] + ' – ' + sc[1];
      if (who <= 0 && !R.g.won) C.V.answer([R.word]);
      note(who > 0 ? 'YOU TAKE THE ROUND' : who < 0 ? 'CPU TAKES THE ROUND' : 'NOBODY GOT IT', who > 0 ? 'good big' : who < 0 ? 'bad big' : 'big', 2200);
      SFX.play(who > 0 ? 'solve' : 'lose');
      if (sc[0] >= 2 || sc[1] >= 2) {
        C.over = true; const won = sc[0] >= 2, st = record('cpu', won, 0), xp = won ? { easy: 20, normal: 35, hard: 50 }[skill] : 10; Rank.xp(xp);
        setTimeout(() => SFX.play(won ? 'win' : 'lose'), 600);
        results({ id: C.id, won, title: won ? 'YOU WIN!' : 'CPU WINS', sub: sc[0] + ' – ' + sc[1] + ' against the ' + skill + ' CPU.', delay: 1800, xp,
          body: el('div', { class: 'resstats' }, el('div', { class: 'nums' }, el('div', null, el('b', null, st.played), el('small', null, 'PLAYED')), el('div', null, el('b', null, st.won), el('small', null, 'WON')), el('div', null, el('b', null, st.streak), el('small', null, 'STREAK')))),
          again: () => Play.start('cpu', { skill }) });
      } else C.timers.push(setTimeout(() => { if (C && !C.over) startRound(); }, 2600));
    };
    C.after = r => {
      const R = C.round; if (!R || R.done) return;
      if (r.won) end(1);
      else if (r.done) { if (R.bg.done) end(0); else note('Out of guesses. Can the CPU get it?', 'bad', 2000); }
    };
    C.quitAsk = () => Menu.modal({ title: 'LEAVE THE MATCH?', body: [el('p', null, 'It counts as a loss.')], buttons: [['LEAVE', () => { C.over = true; record('cpu', false, 0); Menu.hub(); }, 'danger'], ['STAY', () => {}, 'ghost']] });
    startRound();
  }

  window.Play = {
    /* the first time you play a mode, its tutorial first (and the basics, the first time of all) */
    start(mode, o = {}) {
      const run = () => ({ daily, classic, quad, blitz, survival, cpu })[mode](o);
      Tutorial.first('w-' + mode, run, 'wordle');
    },
    PRAISE, emoji, share,
  };
})();
