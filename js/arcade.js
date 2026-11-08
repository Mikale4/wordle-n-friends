/* ============================================================================
   arcade.js -- the GAME PICKER you land on after logging in (Wordle in the
   middle; Runecasters, Wordwright and Chess around it) and each new game's
   own menu: a game against the CPU (with its settings), and online play
   (quick match, host a room, challenge a friend).
   ========================================================================== */
(function () {
  'use strict';
  const { el } = U;
  const LEVELS = [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']];

  /* each game's picture on its card (no images: tiles and a glyph) */
  function art(id) {
    if (id === 'wordle') return Menu.tiles('WORDLE', '201221', 'pickwordle');
    if (id === 'runes') {
      const L = 'RUNEASTCX', on = [0, 1, 2, 5];
      return el('div', { class: 'pickart runesart' }, ...[...L].map((c, i) => el('span', { class: on.includes(i) ? 'on' : '' }, c)));
    }
    if (id === 'wright') {
      const cells = { 0: 'W', 1: 'O', 2: 'R', 3: 'D', 7: 'R', 12: 'I', 17: 'G' }; // WORD across, W...: a little crossword
      return el('div', { class: 'pickart wrightart' }, ...Array.from({ length: 20 }, (_, i) => el('span', { class: cells[i] ? 'on' : '' }, cells[i] || '')));
    }
    if (id === 'chess') return el('div', { class: 'pickart chessart' }, el('span', null, '♞︎'));
    return null;
  }
  const statLine = id => {
    const S = Auth.S.stats, a = S[id + '-cpu'], b = S[id + '-online'], c = S[id + '-solo'];
    const played = (a ? a.played : 0) + (b ? b.played : 0) + (c ? c.played : 0), won = (a ? a.won : 0) + (b ? b.won : 0);
    return played ? played + ' played · ' + won + ' won' : 'New!';
  };

  /* ---------------------------------------------------------------- the picker */
  function picker() {
    if (!Auth.user) return Menu.login();
    if (window.Online) Online.away();
    if (!(window.Online && Online.inRoom())) Net.setStatus('menu', 'In the menus');
    const { btn } = Menu.ui;
    const room = window.Online && Online.roomInfo();
    const card = (id, cls) => {
      const g = id === 'wordle' ? { name: 'Wordle', blurb: 'Guess the hidden word. Daily, Classic, Quad, Blitz, Survival, VS CPU, online and ranked.' } : Games.get(id);
      if (!g) return null;
      const go = () => { SFX.play('ok'); if (id === 'wordle') Menu.hub(); else hub(id); };
      return el('div', { class: 'pick ' + cls + ' pick-' + id, role: 'button', tabindex: 0, onclick: go, onkeydown: e => { if (e.key === 'Enter') go(); } },
        el('div', { class: 'pickpic' }, art(id)),
        el('h2', null, g.name.toUpperCase()),
        el('p', null, g.blurb),
        el('small', { class: 'pickstat' }, id === 'wordle' ? 'Streak ' + Auth.stat('daily').streak + ' · LV ' + Rank.level(Auth.S.xp).lv : statLine(id)));
    };
    const onlineN = el('small', null, '');
    const fill = () => {
      if (!document.body.contains(onlineN)) return;
      const n = [...Net.players.keys()].filter(id => id !== Auth.id).length, f = Object.keys(Auth.S.friends).filter(id => Net.online(id)).length;
      onlineN.textContent = Net.state === 'up' ? n + ' online' + (f ? ' · ' + f + ' friend' + (f > 1 ? 's' : '') : '') : Net.state === 'connecting' ? 'Connecting...' : 'Offline';
    };
    const s = el('div', { class: 'screen picker' }, Menu.homeBar(),
      room ? el('div', { class: 'roombanner' }, el('span', null, "You're still in room "), el('b', null, room.name + (room.playing ? ' · match on' : '')), el('div', { class: 'grow' }),
        btn('BACK TO THE ROOM', () => Online.back(), 'small hot'), btn('LEAVE IT', () => { Online.leave(true); picker(); }, 'ghost small')) : null,
      el('div', { class: 'pickgrid' }, card('runes', 'side l'), card('wordle', 'main'), card('wright', 'side r'), card('chess', 'side b')),
      el('div', { class: 'pickfoot' },
        btn('ONLINE LOBBY', () => Online.open(), 'hot'), onlineN, el('div', { class: 'grow' }),
        btn('FRIENDS', () => Social.friends(), 'ghost small'), btn('LEADERBOARD', () => Rank.board(), 'ghost small'), btn('STATS', () => Menu.stats(), 'ghost small')));
    App.screen(s);
    const offs = [Net.on('players', fill), Net.on('state', fill), Social.on('change', fill)];
    App.onLeave(() => offs.forEach(f => f()));
    fill();
  }

  /* ---------------------------------------------------------------- a game's menu */
  const prefsFor = id => { const P = Auth.prefs; P.arc = P.arc || {}; return P.arc[id] = P.arc[id] || {}; };
  function hub(id) {
    const g = Games.get(id); if (!g) return picker();
    if (!Auth.user) return Menu.login();
    if (window.Online) Online.away();
    const { btn, topbar } = Menu.ui;
    const p = prefsFor(id), save = () => { Auth.save(); hub(id); };
    const maxCpu = g.players[1] - 1, minCpu = Math.max(0, g.players[0] - 1);
    if (p.cpus == null) p.cpus = Math.max(1, minCpu); p.cpus = U.clamp(p.cpus, minCpu, maxCpu);
    p.level = p.level || 'normal'; p.seat = p.seat || 'first';
    const opts = p.opts = Games.opts(g, p.opts);
    const seg = (label, val, choices, set, note) => el('div', { class: 'seg' }, el('span', null, label),
      el('div', null, ...choices.map(([v, t]) => el('button', { class: String(val) === String(v) ? 'on' : '', onclick: () => { SFX.play('key'); set(v); } }, t))), note ? el('small', null, note) : null);
    const cpuChoices = []; for (let n = minCpu; n <= maxCpu; n++) cpuChoices.push([n, n === 0 ? 'Solo' : String(n)]);
    const friendsOn = Object.keys(Auth.S.friends).filter(f => Net.online(f));
    const st = ['cpu', 'online', 'solo'].map(k => [k, Auth.S.stats[id + '-' + k]]).filter(x => x[1] && x[1].played);
    const s = el('div', { class: 'screen arcade ghub g-' + id }, topbar(g.name.toUpperCase(), () => picker(), btn('HOW TO PLAY', () => howto(g), 'ghost small')),
      el('div', { class: 'ghubgrid' },
        el('section', { class: 'panel ghero' }, el('div', { class: 'pickpic' }, art(id)), el('h2', null, g.name.toUpperCase()), el('p', null, g.blurb),
          st.length ? el('div', { class: 'gstats' }, ...st.map(([k, x]) => el('div', null, el('small', null, k === 'cpu' ? 'VS CPU' : k.toUpperCase()), el('b', null, x.played + ' played'), el('span', null, (k === 'solo' ? 'best ' + (x.best || 0) : x.won + ' won') + (x.best && k !== 'solo' && id !== 'chess' ? ' · best ' + x.best : ''))))) : el('p', { class: 'small muted' }, 'No games yet. Have a go!')),
        el('section', { class: 'panel gcpu' }, el('h3', null, maxCpu === 0 ? 'SOLO' : minCpu === 0 ? 'PLAY ON YOUR OWN OR VS CPU' : 'PLAY VS CPU'),
          maxCpu > 1 || minCpu === 0 ? seg(id === 'runes' ? 'CPU PLAYERS' : 'OPPONENTS', p.cpus, cpuChoices, v => { p.cpus = +v; save(); }) : null,
          p.cpus > 0 ? seg('LEVEL', p.level, LEVELS, v => { p.level = v; save(); }) : null,
          id === 'chess' ? seg('YOU PLAY', p.seat, [['first', 'White'], ['second', 'Black'], ['random', 'Random']], v => { p.seat = v; save(); }) : null,
          ...(g.options || []).map(op => seg(op.label, opts[op.key], op.values, v => { opts[op.key] = op.values.find(x => String(x[0]) === String(v))[0]; save(); })),
          btn(p.cpus ? 'PLAY VS CPU' : 'PLAY', () => Match.local(id, { cpus: Array(p.cpus).fill(p.level), opts, seat: p.seat }), 'big wide')),
        el('section', { class: 'panel gonline' }, el('h3', null, 'ONLINE WITH FRIENDS'),
          btn('QUICK MATCH', () => Online.quickGame(id), 'big wide hot', 'Into an open ' + g.name + ' room, or open one'),
          btn('HOST A ROOM', () => Online.hostGame(id), 'wide', 'Your room, your rules. Share the code.'),
          friendsOn.length ? el('div', { class: 'gfriends' }, el('small', null, 'CHALLENGE A FRIEND'),
            ...friendsOn.slice(0, 6).map(f => el('button', { class: 'hubfriend on', onclick: () => Online.challenge(f, { game: id, opts }) },
              Menu.avatar(f, Auth.S.friends[f].n, 'sm'), el('span', null, el('b', null, Auth.S.friends[f].n), el('small', null, Net.online(f).x)), el('i', { class: 'dot on' }))))
            : el('p', { class: 'small muted' }, 'When friends are online you can challenge them from here, or from their player card.'),
          btn('ONLINE LOBBY', () => Online.open(), 'ghost wide'))));
    App.screen(s);
    if (g.lex && !Lex.ready) Lex.load().catch(() => {});                 // (get the dictionary ready while they choose)
  }

  function howto(g) {
    const parts = (g.howto || [g.blurb]).map(t => Array.isArray(t) ? el('ul', null, ...t.map(x => el('li', null, x))) : /^[A-Z][A-Z ]+$/.test(t) ? el('h3', null, t) : el('p', null, t));
    Menu.modal({ title: 'HOW TO PLAY ' + g.name.toUpperCase(), cls: 'howto', body: parts, buttons: [['GOT IT', () => {}, 'big']] });
  }

  window.Arcade = { picker, hub, howto, art };
})();
