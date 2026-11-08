/* ============================================================================
   tutorial.js -- a short illustrated tutorial for every game and mode.

   Tutorial.first(key, then)   the first time a player starts something: show
                               its tutorial, then go on (then() runs after it
                               closes; straight away if they've seen it)
   Tutorial.show(key)          any time: the ? buttons
   Tutorial.button(key)        a ? button for a top bar
   Tutorial.reset()            Options: show them all again

   A tutorial is a few pages, each a heading, a picture and a line or two.
   Wordle's modes start with the basics (the colours) the first time.
   What a player has seen is kept with their account (prefs.tut).
   ========================================================================== */
(function () {
  'use strict';
  const { el } = U;
  const T = {};

  /* ---------------------------------------------------------------- pictures */
  const tiles = (w, p, cls) => Menu.tiles(w, p, 'sm ' + (cls || ''));
  const legend = () => el('div', { class: 'tut-legend' }, el('span', { 'data-s': '2' }, 'right spot'), el('span', { 'data-s': '1' }, 'in the word'), el('span', { 'data-s': '0' }, 'not in it'));
  const kb = keys => el('div', { class: 'tut-kb' }, ...keys.map(([c, s]) => el('span', { 'data-s': s == null ? '' : String(s) }, c)));
  const mini = (rows, o) => BoardView.mini(5, o && o.max || 6, rows, o || {});
  const stat = (label, value, cls) => el('div', { class: 'tut-stat ' + (cls || '') }, el('small', null, label), el('b', null, value));
  const row = (...kids) => el('div', { class: 'tut-row' }, ...kids);
  const bar = (pct, low) => el('div', { class: 'timebar tut-bar' + (low ? ' low' : '') }, el('i', { style: { width: pct + '%' } }));
  const pill = (t, cls) => el('em', { class: 'pill ' + (cls || '') }, t);

  /* Runecasters: a little grid. letters: string; path: cells in order; o: { x2, x3, w2, mana: [] } */
  function runeGrid(letters, cols, path, o = {}) {
    return el('div', { class: 'tut-rg', style: { '--c': cols } }, ...[...letters].map((c, i) => {
      const k = path.indexOf(i), tag = i === o.x2 ? '×2' : i === o.x3 ? '×3' : i === o.w2 ? 'W×2' : null;
      return el('span', { class: (k >= 0 ? 'on' : '') + (tag ? ' rune' : '') + (o.mana && o.mana.includes(i) ? ' mana' : '') }, c === 'q' ? 'QU' : c.toUpperCase(),
        tag ? el('i', { class: 'tag' }, tag) : null, k >= 0 ? el('b', { class: 'ord' }, k + 1) : null);
    }));
  }
  /* Wordwright: a corner of the board. cells: { 'r,c': 'A' (tile) | 'a' (new tile) | '2L' etc (premium) | '*' (start) } */
  function wrightBoard(n, cells) {
    const out = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const v = cells[r + ',' + c];
      out.push(el('span', { class: !v ? '' : /^[A-Z]$/.test(v) ? 't' : /^[a-z]$/.test(v) ? 't new' : v === '*' ? 'star' : 'p p' + v }, !v ? '' : v === '*' ? '★' : /^[a-z]$/i.test(v) ? v.toUpperCase() : v));
    }
    return el('div', { class: 'tut-wb', style: { '--n': n } }, ...out);
  }
  const rack = letters => el('div', { class: 'tut-rack' }, ...[...letters].map(c => el('span', null, c === '?' ? '' : c)));
  /* Chess: a strip of squares. sq: [[piece or '', mark]] mark: 'tdot' | 'cap' | 'from' | 'to' */
  function chessStrip(cols, sq) {
    const svg = (Games.get('chess') || {}).svg || {};
    return el('div', { class: 'tut-cb', style: { '--c': cols } }, ...sq.map(([p, m], i) => {
      const d = el('span', { class: (((i % cols) + Math.floor(i / cols)) % 2 ? 'dk' : 'lt') + (m ? ' ' + m : '') });
      if (p) d.innerHTML = svg[p] || '';
      return d;
    }));
  }

  /* ---------------------------------------------------------------- the tutorials */
  const add = (key, title, steps) => { T[key] = { title, steps }; };

  add('welcome', 'WELCOME', [
    { h: 'Four games, one place', p: 'Pick a game from the game picker: Wordle in the middle, Runecasters, Wordwright and Chess around it. Each has solo or CPU games and online play.',
      art: () => el('div', { class: 'tut-pick' }, el('span', null, 'RUNECASTERS'), el('b', null, 'WORDLE'), el('span', null, 'WORDWRIGHT'), el('span', { class: 'wide' }, 'CHESS')) },
    { h: 'Play with friends', p: 'Your friend code is under FRIENDS. Add friends, message them, and challenge them to any game. The ONLINE LOBBY has rooms, chat and quick matches.',
      art: () => row(Menu.avatar(Auth.id || 'x', Auth.name || 'You', 'lg'), el('b', { class: 'tut-code' }, (Auth.name || 'You') + '#' + (Auth.tag || 'AB12'))) },
    { h: 'Level up', p: 'Every game gives XP, and XP raises your level. Wordle\'s ranked matches also give you a rating, from Bronze up to Legend.',
      art: () => row(el('span', { class: 'lvchip' }, 'LV 7'), Rank.badge(1250), Rank.badge(1720)) },
    { h: 'Help is always here', p: 'The first time you play a game or a mode, a short tutorial like this one shows you how. Press ? on any game screen to see it again.',
      art: () => row(el('span', { class: 'tut-q' }, '?')) },
  ]);

  /* Wordle: the basics, then each mode */
  add('wordle', 'WORDLE: THE BASICS', [
    { h: 'Guess the word', p: 'Type a real word of the right length and press ENTER. You get a few guesses to find the hidden word.',
      art: () => tiles('CRANE', '     ') },
    { h: 'The colours', p: 'After each guess the tiles light up: green is the right letter in the right spot, yellow is in the word somewhere else, grey isn\'t in the word.',
      art: () => el('div', { class: 'tut-col' }, tiles('CRANE', '20010'), legend()) },
    { h: 'Use what you learn', p: 'The keyboard keeps the colours, so you can see which letters are left. A repeated letter only lights up as many times as the word has it.',
      art: () => kb([['Q'], ['W', 0], ['E', 1], ['R', 0], ['T'], ['A', 2], ['S'], ['C', 2], ['N', 0]]) },
    { h: 'Hard mode', p: 'In Options you can turn on HARD MODE: green letters must stay put and yellow ones must be used in every later guess.',
      art: () => el('div', { class: 'tut-col' }, tiles('CHARM', '20100'), tiles('C?A??', '2 1  ', 'ghost')) },
  ]);
  add('w-daily', 'DAILY', [
    { h: 'One word a day', p: 'Everyone gets the same 5-letter word today, and you have six guesses. A new word arrives at midnight.',
      art: () => el('div', { class: 'tut-col' }, tiles('?????', '     '), el('small', { class: 'muted' }, 'NEXT WORD IN 07:42:15')) },
    { h: 'Keep your streak', p: 'Solve it every day to build a streak. Miss a day, or the word, and the streak starts again.',
      art: () => row(stat('STREAK', '12', 'gold'), stat('MAX', '30')) },
    { h: 'Share it', p: 'When you\'re done, share your result as coloured squares; it gives nothing away. If you close the game halfway, your guesses are kept.',
      art: () => mini([[0, 1, 0, 0, 0], [2, 0, 1, 1, 0], [2, 2, 2, 2, 2]], { solved: true }) },
  ]);
  add('w-classic', 'CLASSIC', [
    { h: 'Endless words', p: 'A new word every game, as many as you like. Pick the length on its card: 4, 5, 6 or 7 letters.',
      art: () => el('div', { class: 'tut-col' }, tiles('WORD', '2102'), tiles('PUZZLE', '022001')) },
    { h: 'Longer words, more guesses', p: '4 and 5 letters get six guesses, 6 letters seven, 7 letters eight. Your stats are kept for each length.',
      art: () => row(stat('4', '6'), stat('5', '6'), stat('6', '7'), stat('7', '8')) },
  ]);
  add('w-quad', 'QUAD', [
    { h: 'Four words at once', p: 'Four hidden 5-letter words and nine guesses. Every guess you type goes on all four boards.',
      art: () => row(mini([[2, 0, 1, 0, 0]]), mini([[0, 0, 0, 1, 2]]), mini([[1, 2, 0, 0, 0]]), mini([[0, 0, 2, 0, 1]])) },
    { h: 'Read the keyboard', p: 'Each key is split into four corners, one per board, so you can see what a letter did on each. A solved board stops taking guesses.',
      art: () => el('div', { class: 'tut-quadkey' }, el('i', { 'data-s': '2' }), el('i', { 'data-s': '0' }), el('i', { 'data-s': '1' }), el('i', { 'data-s': '0' }), el('b', null, 'A')) },
    { h: 'Solve all four', p: 'Find all four words within nine guesses to win.', art: () => row(stat('BOARDS', '4/4', 'gold'), stat('GUESSES', '8/9')) },
  ]);
  add('w-blitz', 'BLITZ', [
    { h: 'Three minutes', p: 'Solve as many words as you can before the clock runs out. It starts with your first guess, so take a breath first.',
      art: () => el('div', { class: 'tut-col' }, bar(64), row(stat('SOLVED', '4'), stat('TIME', '1:55'))) },
    { h: 'Keep moving', p: 'Solve a word and the next one appears at once. Run out of guesses and you\'re shown the word, then it\'s on to the next.',
      art: () => el('div', { class: 'wlist' }, el('span', { class: 'ok' }, 'TRAIN'), el('span', { class: 'ok' }, 'GHOST'), el('span', { class: 'no' }, 'FJORD'), el('span', { class: 'ok' }, 'PLANK')) },
  ]);
  add('w-survival', 'SURVIVAL', [
    { h: 'A pool of guesses', p: 'You start with 10 guesses in a pool. Every guess, on any word, costs one.',
      art: () => row(stat('GUESS POOL', '10', 'gold')) },
    { h: 'Solve to refill', p: 'Each word you solve puts 5 back in the pool. You get six guesses at most per word.',
      art: () => row(stat('POOL', '7'), el('b', { class: 'tut-arrow' }, '+5'), stat('POOL', '12', 'gold')) },
    { h: 'How long can you last?', p: 'The run ends when the pool runs dry or a word beats you. Your best run is kept.',
      art: () => row(stat('SOLVED', '9', 'gold'), stat('BEST', '14')) },
  ]);
  add('w-cpu', 'VS CPU', [
    { h: 'Race the computer', p: 'You and the CPU chase the same 5-letter word at the same time. The first to solve it takes the round.',
      art: () => row(el('div', { class: 'tut-col' }, el('small', null, 'YOU'), mini([[0, 1, 0, 0, 2], [2, 2, 0, 0, 2]])), el('div', { class: 'tut-col' }, el('small', null, 'CPU'), mini([[1, 0, 0, 0, 0]]))) },
    { h: 'You see its colours', p: 'The CPU\'s board shows its colours but never its letters. It guesses at its own pace: Easy is slow, Hard is quick.',
      art: () => row(pill('EASY'), pill('NORMAL'), pill('HARD', 'hot')) },
    { h: 'First to two', p: 'Win two rounds to win the match. If nobody solves a round, nobody scores.',
      art: () => row(stat('YOU – CPU', '2 – 1', 'gold')) },
  ]);

  /* online */
  add('lobby', 'THE ONLINE LOBBY', [
    { h: 'Meet everyone', p: 'The lobby shows who\'s online, the lobby chat, and the open rooms. Tap anyone to see their card: add them, message them or challenge them.',
      art: () => row(Menu.avatar('a1b2', 'Mia', ''), Menu.avatar('c3d4', 'Leo', ''), Menu.avatar('e5f6', 'Ana', ''), el('span', { class: 'btn small hot' }, el('span', null, 'VS'))) },
    { h: 'Get a game', p: 'QUICK MATCH drops you into an open room (or opens one). HOST A ROOM sets up your own for any of the four games. JOIN BY CODE gets you into a friend\'s room.',
      art: () => el('div', { class: 'tut-col' }, el('span', { class: 'btn small hot' }, el('span', null, 'QUICK MATCH')), el('b', { class: 'tut-code' }, 'K7PQ2')) },
    { h: 'Ranked', p: 'RANKED MATCH finds you a Wordle opponent near your rating. Win to climb from Bronze to Legend.',
      art: () => row(Rank.badge(900), Rank.badge(1100), Rank.badge(1450)) },
    { h: 'What\'s public', p: 'Names, ranks, statuses and lobby chat are public. Messages, challenges and invites are encrypted, so only the person you send them to can read them.',
      art: () => row(el('span', { class: 'tut-q' }, '🔒')) },
  ]);
  add('rooms', 'ROOMS', [
    { h: 'Get ready', p: 'In a room, press READY when you want to play. The match starts when everyone playing is ready, or when the host presses START.',
      art: () => row(el('span', { class: 'btn small' }, el('span', null, 'READY ✓')), el('span', { class: 'btn small ghost' }, el('span', null, 'SIT OUT'))) },
    { h: 'The host runs the room', p: 'The host picks the rules, makes the room private with a password, locks it, and can kick, block or mute. Share the room code to bring friends in, or invite them.',
      art: () => el('div', { class: 'tut-col' }, el('small', { class: 'muted' }, 'ROOM CODE'), el('b', { class: 'tut-code' }, 'Q4RX9')) },
    { h: 'Watching and chat', p: 'SIT OUT to watch instead of play. The room chat stays open during matches (the CHAT button on the game screen).',
      art: () => el('div', { class: 'tut-chat' }, el('div', null, el('b', null, 'Mia: '), 'GG!'), el('div', null, el('b', null, 'Leo: '), 'One more?')) },
    { h: 'Leaving', p: 'You can step away to the menus and come back. Leaving a two-player game for good forfeits it; in bigger games your turns are skipped.',
      art: () => row(el('span', { class: 'btn small ghost' }, el('span', null, 'LEAVE THE ROOM'))) },
  ]);
  add('w-online', 'WORDLE ONLINE', [
    { h: 'Everyone, same word', p: 'Every player in the match races to the same hidden word at once. You see everyone else\'s colours, never their letters.',
      art: () => row(mini([[2, 0, 1, 0, 0], [2, 2, 2, 2, 2]], { solved: true }), mini([[0, 1, 0, 0, 0]]), mini([[1, 0, 0, 2, 0], [2, 2, 0, 2, 0]])) },
    { h: 'Race', p: 'Solve it for 100, plus 20 for each guess you didn\'t need, plus 60 / 40 / 20 for being 1st / 2nd / 3rd to solve.',
      art: () => row(stat('SOLVED', '+100'), stat('SPARE', '+40'), stat('1ST', '+60', 'gold')) },
    { h: 'Blitz and Quad', p: 'BLITZ: the same run of words for everyone; every word you solve in the time scores 50, plus 10 per spare guess. QUAD: four words, nine guesses; 50 a board, and the race bonus for finishing all four.',
      art: () => row(pill('RACE'), pill('BLITZ'), pill('QUAD')) },
    { h: 'Rounds', p: 'A match is 1 to 10 rounds; points add up, and the most points wins. The host picks the mode, word length, rounds and time limit.',
      art: () => row(stat('ROUND', '2 / 3'), stat('YOU', '340 pts', 'gold')) },
  ]);
  add('w-ranked', 'RANKED', [
    { h: 'One on one', p: 'A ranked match is you against one opponent near your rating: three 5-letter Race rounds, the same rules for everyone.',
      art: () => row(Menu.avatar('a1', 'You', 'lg'), el('b', { class: 'tut-arrow' }, 'VS'), Menu.avatar('b2', 'Rival', 'lg')) },
    { h: 'Your rating', p: 'Win and your rating goes up; lose and it drops. Beating someone rated above you is worth more. Everyone starts at 1000.',
      art: () => row(stat('RATING', '1000 → 1024', 'gold')) },
    { h: 'Tiers', p: 'Bronze, Silver, Gold, Platinum and Diamond, each in three steps, then Master and Legend. Leaving a ranked match early counts as a loss.',
      art: () => row(Rank.badge(900), Rank.badge(1000), Rank.badge(1150), Rank.badge(1300), Rank.badge(1450), Rank.badge(1600), Rank.badge(1750)) },
  ]);

  /* the other games */
  add('runes', 'RUNECASTERS', [
    { h: 'Cast a word', p: 'On your turn, trace a word through the grid: 3 or more letters, each touching the last (diagonals count), each tile used once. Drag across them, tap them one by one, or just type the word.',
      art: () => runeGrid('teasrlpmq', 3, [0, 1, 2, 4, 3]) },
    { h: 'Points', p: 'Every letter is worth points; rare letters more. Runes multiply: ×2 or ×3 on a letter and, from round 2, W×2 doubles the whole word. Long words score a bonus: +3 for 6 letters, +6 for 7, +10 for 8 or more.',
      art: () => runeGrid('gnoleurts', 3, [], { x2: 2, x3: 6, w2: 4 }) },
    { h: 'Mana and spells', p: 'Tiles with a crystal give 1 mana when you trace through them. You start with 3 (10 at most). Before casting you can spend it: RESHUFFLE (1) mixes the letters, TRANSMUTE (2) changes one tile to any letter, SCRY (3) shows you one of the best words.',
      art: () => el('div', { class: 'tut-col' }, runeGrid('ainedo', 3, [], { mana: [0, 4] }), row(pill('RESHUFFLE 1'), pill('TRANSMUTE 2'), pill('SCRY 3'))) },
    { h: 'Rounds', p: 'Used tiles are replaced with new letters. Everyone casts once a round; after the last round (3, 5 or 7) the most points wins. You can pass, and with a turn timer, running out of time passes for you.',
      art: () => row(stat('ROUND', '2 / 5'), stat('YOU', '86', 'gold'), stat('SAGE', '71')) },
    { h: 'Ways to play', p: 'SOLO: a score attack, beat your best. VS CPU: up to five computer players, Easy to Hard. ONLINE: up to six players in a room.',
      art: () => row(pill('SOLO'), pill('VS CPU'), pill('ONLINE', 'hot')) },
  ]);
  add('wright', 'WORDWRIGHT', [
    { h: 'Build words', p: 'You have seven letter tiles. On your turn, place some in one line, across or down, to make a word that joins the words already there. The first word must cover the star.',
      art: () => el('div', { class: 'tut-col' }, wrightBoard(5, { '2,0': 'S', '2,1': 'T', '2,2': 'A', '2,3': 'R', '0,2': 'p', '1,2': 'l', '3,2': 'n', '4,2': 'e', '0,4': '3W', '4,0': '2L' }), rack('PLNEQ?I')) },
    { h: 'Points', p: 'Every word you make counts, including ones your tiles cross. Premium squares count only when you first cover them: 2L and 3L multiply a letter, 2W and 3W the whole word. The two blanks are any letter, worth 0. Use all seven tiles at once for +35.',
      art: () => wrightBoard(4, { '0,0': '3W', '0,3': '2W', '1,1': '3L', '2,2': '2L', '3,0': '2W', '3,3': '3W' }) },
    { h: 'Placing tiles', p: 'Tap a tile, then a square (or drag it). Or tap a square and type: the letters follow the arrow, and Space turns it. PLAY shows the words and points first. RECALL takes your tiles back; EXCHANGE swaps them with the bag, which uses your turn.',
      art: () => row(el('span', { class: 'btn small' }, el('span', null, 'PLAY')), el('span', { class: 'btn small ghost' }, el('span', null, 'RECALL')), el('span', { class: 'btn small ghost' }, el('span', null, 'EXCHANGE'))) },
    { h: 'The end', p: 'You draw back up to seven after every move. When the bag is empty and someone uses their last tile, the game ends: they get everyone else\'s leftover points. It also ends if everyone passes twice in a row. Most points wins.',
      art: () => row(stat('BAG', '0'), stat('YOU', '312', 'gold'), stat('RIVAL', '287')) },
    { h: 'Ways to play', p: 'VS CPU: one to three computer players, Easy to Hard. ONLINE: two to four players; only you ever see your tiles. Rooms can set a time limit per turn.',
      art: () => row(pill('VS CPU'), pill('ONLINE', 'hot')) },
  ]);
  add('chess', 'CHESS', [
    { h: 'Moving', p: 'Tap one of your pieces: dots show where it can go. Tap a square (or drag the piece) to move. You can also type squares: e2 then e4.',
      art: () => chessStrip(4, [['', 'tdot'], ['', ''], ['n', 'cap'], ['', ''], ['', ''], ['', ''], ['', ''], ['', 'tdot'], ['', ''], ['N', 'from'], ['', ''], ['', ''], ['', ''], ['', ''], ['', ''], ['', 'tdot']]) },
    { h: 'Special moves', p: 'Every rule is in: castling (move the king two squares), en passant, and promotion: a pawn that reaches the far side asks what it becomes.',
      art: () => chessStrip(5, [['P', 'to'], ['', ''], ['', ''], ['', ''], ['', ''], ['Q', ''], ['R', ''], ['B', ''], ['N', ''], ['', '']]) },
    { h: 'Winning and drawing', p: 'Checkmate wins. It\'s a draw by stalemate, by the same position three times, after fifty moves with no capture or pawn move, or when nobody has enough left to mate. You can offer a draw or resign.',
      art: () => chessStrip(3, [['', ''], ['k', 'chk'], ['', ''], ['', ''], ['Q', 'to'], ['', ''], ['', ''], ['K', ''], ['', '']]) },
    { h: 'Clocks', p: 'Games can have a clock: 3 + 2 (two seconds back per move), 5 or 10 minutes. Run out of time and you lose, unless your opponent couldn\'t mate anyway.',
      art: () => row(stat('WHITE', '4:12', 'gold'), stat('BLACK', '3:58')) },
    { h: 'Ways to play', p: 'VS CPU: Easy, Normal or Hard, as White, Black or a random side. ONLINE: one on one in a room; anyone else in the room watches.',
      art: () => row(pill('VS CPU'), pill('ONLINE', 'hot')) },
  ]);

  /* ---------------------------------------------------------------- showing them */
  const seen = () => { if (!Auth.user) return {}; const P = Auth.prefs; return P.tut = P.tut || {}; };
  const mark = keys => { if (!Auth.user) return; const s = seen(); for (const k of keys) s[k] = 1; Auth.save(); };

  function show(key, then, pre) {
    const t = T[key]; if (!t) { if (then) then(); return; }
    const steps = (pre && T[pre] ? T[pre].steps.map(s => Object.assign({ from: T[pre].title }, s)) : []).concat(t.steps);
    let i = 0, closed = false;
    const body = el('div', { class: 'tut-body' }), dots = el('div', { class: 'tut-dots' }), foot = el('div', { class: 'mfoot' });
    const close = () => {
      if (closed) return; closed = true;
      ov.remove(); document.removeEventListener('keydown', keys, true);
      mark([key].concat(pre ? [pre] : []));
      if (then) setTimeout(then, 0);
    };
    const go = d => { const n = i + d; if (n < 0) return; if (n >= steps.length) { SFX.play('ok'); close(); return; } i = n; SFX.play('key'); draw(); };
    function draw() {
      const s = steps[i];
      let art = null; try { art = s.art ? s.art() : null; } catch (e) { console.error(e); }
      body.innerHTML = '';
      if (s.from && s.from !== t.title) body.append(el('small', { class: 'tut-from' }, s.from));
      body.append(el('div', { class: 'tut-art' }, art), el('h3', null, s.h), el('p', null, s.p));
      dots.innerHTML = ''; steps.forEach((_, k) => dots.append(el('i', { class: k === i ? 'on' : k < i ? 'done' : '' })));
      foot.innerHTML = '';
      foot.append(
        i > 0 ? el('button', { class: 'btn ghost', onclick: () => go(-1) }, el('span', null, 'BACK')) : el('button', { class: 'btn ghost', onclick: () => { SFX.play('back'); close(); } }, el('span', null, 'SKIP')),
        el('button', { class: 'btn big', onclick: () => go(1) }, el('span', null, i === steps.length - 1 ? (then ? 'LET\'S PLAY' : 'GOT IT') : 'NEXT')));
    }
    function keys(e) {
      if (!document.body.contains(ov) || [...document.querySelectorAll('.overlay')].pop() !== ov) return;
      if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(-1); }
    }
    const ov = el('div', { class: 'overlay block tutorial' },
      el('div', { class: 'modal tut' },
        el('div', { class: 'mhead' }, el('h2', null, t.title), el('button', { class: 'mclose', 'aria-label': 'Close', onclick: () => { SFX.play('back'); close(); } }, '×')),
        el('div', { class: 'mbody' }, body, dots), foot));
    document.body.append(ov);
    document.addEventListener('keydown', keys, true);
    draw();
  }

  window.Tutorial = {
    has: key => !!T[key],
    seen: key => !!seen()[key],
    show: key => show(key, null, null),
    /* the first time: show it (with `pre` in front, if they haven't seen that either), then carry on */
    first(key, then, pre) {
      if (!Auth.user || !T[key] || seen()[key]) { if (then) then(); return; }
      show(key, then, pre && !seen()[pre] ? pre : null);
    },
    button: (key, title) => el('button', { class: 'iconbtn tutbtn', title: title || 'How to play', 'aria-label': 'How to play', onclick: e => { e.stopPropagation(); SFX.play('ok'); show(key); } }, el('span', { class: 'ico ico-help' })),
    reset() { if (!Auth.user) return; Auth.prefs.tut = {}; Auth.save(); },
    keys: () => Object.keys(T),
  };
})();
