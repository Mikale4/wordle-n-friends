/* ============================================================================
   menu.js -- TITLE -> LOG IN / NEW PLAYER -> HUB, plus Options, Stats, How to
   play, and the shared bits every screen uses (buttons, the top bar with the
   Friends and Messages buttons, toasts, pop-ups, avatars).
   ========================================================================== */
(function () {
  'use strict';
  const { el } = U;

  /* ------------------------------------------------------------ shared bits */
  function btn(label, fn, cls, sub) {
    return el('button', { class: 'btn ' + (cls || ''), onclick: e => { if (e.currentTarget.classList.contains('off')) return; SFX.play('ok'); fn(e); } },
      el('span', null, label), sub ? el('small', null, sub) : null);
  }
  function topbar(title, onBack, ...extra) {
    return el('div', { class: 'topbar' },
      onBack ? el('button', { class: 'backbtn', title: 'Back (Esc)', 'aria-label': 'Back', onclick: () => { SFX.play('back'); onBack(); } }, '‹') : null,
      el('h1', null, title), el('div', { class: 'grow' }), ...extra, Auth.user ? Menu.socialButtons() : null);
  }
  function toast(text, cls, ms) {
    let box = U.$('toasts'); if (!box) { box = el('div', { id: 'toasts' }); document.body.append(box); }
    const t = el('div', { class: 'toast ' + (cls || '') }, text); box.append(t);
    while (box.children.length > 4) box.firstChild.remove();
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms || 2600);
    return t;
  }
  /* a pop-up: { title, body: [nodes], buttons: [[label, fn, cls]], cls, block (no closing it by clicking outside) } */
  function modal(o) {
    const res = /results/.test(o.cls || '');
    if (res && window.Music) Music.duck(true);
    const close = () => { ov.remove(); if (res && window.Music) Music.duck(false); if (o.onClose) o.onClose(); };
    const ov = el('div', { class: 'overlay' + (o.block ? ' block' : ''), onclick: e => { if (e.target === ov && !o.block) close(); } },
      el('div', { class: 'modal ' + (o.cls || '') },
        el('div', { class: 'mhead' }, el('h2', null, o.title || ''), el('button', { class: 'mclose', 'aria-label': 'Close', onclick: () => { SFX.play('back'); close(); } }, '×')),
        el('div', { class: 'mbody' }, ...(o.body || [])),
        o.buttons && o.buttons.length ? el('div', { class: 'mfoot' }, ...o.buttons.map(([l, fn, c]) => btn(l, () => { if (fn(close) !== false) close(); }, c))) : null));
    document.body.append(ov);
    return { close, el: ov };
  }
  const hue = id => parseInt(String(id || '0').slice(0, 4), 16) % 360 || 200;
  function avatar(id, name, cls) {
    return el('i', { class: 'avatar ' + (cls || ''), style: { '--h': hue(id) } }, String(name || '?')[0].toUpperCase());
  }
  /* tiles spelling a word, coloured by a pattern string ('2' hit, '1' near, '0' miss, ' ' blank) */
  function tiles(word, pat, cls) {
    return el('div', { class: 'tilerow ' + (cls || '') }, ...[...word].map((c, i) => el('span', { class: 'tile', 'data-s': pat ? pat[i] : '', style: { '--i': i } }, c === ' ' ? '' : c)));
  }
  function logo(size) {
    return el('div', { class: 'logo ' + (size || '') },
      tiles('WORDLE', '201221', 'l1'), el('div', { class: 'logoamp' }, el('span', null, 'N\'')), tiles('FRIENDS', '1202021', 'l2'));
  }

  /* the Friends and Messages buttons (with live counts) in every top bar */
  function socialButtons() {
    const fb = el('i', { class: 'nbadge' }), mb = el('i', { class: 'nbadge' }), dot = el('i', { class: 'netdot' });
    const upd = () => {
      if (!document.body.contains(wrap)) { offs.forEach(f => f()); return; }
      const S = Auth.S; if (!S) return;
      const nf = Object.keys(S.reqIn).length, nm = Object.values(S.convos).reduce((a, c) => a + (c.unread || 0), 0);
      fb.textContent = nf || ''; fb.hidden = !nf; mb.textContent = nm || ''; mb.hidden = !nm;
      const on = [...Object.keys(S.friends)].filter(id => Net.online(id)).length;
      fb.parentNode && (fb.parentNode.title = 'Friends' + (on ? ' (' + on + ' online)' : ''));
      dot.className = 'netdot ' + Net.state; dot.title = { up: 'Online', connecting: 'Connecting...', down: 'Can\'t reach the relay', off: 'Offline' }[Net.state];
    };
    const wrap = el('div', { class: 'socialbtns' },
      el('button', { class: 'iconbtn', title: 'Friends', onclick: () => Social.friends() }, el('span', { class: 'ico ico-friends' }), fb),
      el('button', { class: 'iconbtn', title: 'Messages', onclick: () => Social.messages() }, el('span', { class: 'ico ico-mail' }), mb),
      dot);
    const offs = [Social.on('change', upd), Net.on('state', upd), Net.on('players', upd)];
    setTimeout(upd, 0);
    return wrap;
  }

  /* how to play: the colours, with examples */
  function howto() {
    modal({ title: 'HOW TO PLAY', cls: 'howto', body: [
      el('p', null, 'Guess the hidden word. Each guess must be a real word of the right length; press ENTER to check it.'),
      el('p', null, 'After each guess the tiles show how close you are:'),
      tiles('CRANE', '2    '), el('p', { class: 'small' }, el('b', { class: 'c2' }, 'C'), ' is in the word, in that spot (a HIT).'),
      tiles('PLUMB', ' 1   '), el('p', { class: 'small' }, el('b', { class: 'c1' }, 'L'), ' is in the word, somewhere else (NEAR).'),
      tiles('STOVE', '   0 '), el('p', { class: 'small' }, el('b', { class: 'c0' }, 'V'), ' isn\'t in the word at all (a MISS).'),
      el('p', null, 'Repeated letters count fairly: if the word has one E and you guess two, only one of them lights up.'),
      el('h3', null, 'MODES'),
      el('ul', null,
        el('li', null, el('b', null, 'DAILY'), ' one word a day, the same for everyone. Keep your streak going.'),
        el('li', null, el('b', null, 'CLASSIC'), ' endless words of 4, 5, 6 or 7 letters.'),
        el('li', null, el('b', null, 'QUAD'), ' four words at once, nine guesses. Every guess goes on all four boards.'),
        el('li', null, el('b', null, 'BLITZ'), ' as many words as you can before the clock runs out.'),
        el('li', null, el('b', null, 'SURVIVAL'), ' a pool of guesses. Each solve tops it up; run dry and it\'s over.'),
        el('li', null, el('b', null, 'VS CPU'), ' race a computer player to the same word, first to two.'),
        el('li', null, el('b', null, 'ONLINE'), ' race friends and strangers in rooms of up to eight, or climb the ranks 1v1.')),
      el('p', { class: 'small' }, 'HARD MODE (Options): hits must stay in place and near letters must be used in every later guess.'),
    ], buttons: [['GOT IT', () => {}, 'big']] });
  }

  const Menu = window.Menu = {
    ui: { btn, topbar }, toast, modal, avatar, tiles, logo, socialButtons, howto, hue,

    /* ------------------------------------------------------------------ title */
    title() {
      const s = el('div', { class: 'screen title' },
        el('div', { class: 'floaters' }, ...Array.from({ length: 18 }, (_, i) => el('span', { class: 'float', 'data-s': String(i % 3), style: { '--x': (i * 37 % 100) + '%', '--d': (8 + i % 7 * 2) + 's', '--delay': (-i * 1.3) + 's', '--r': ((i * 47) % 60 - 30) + 'deg' } }, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[(i * 7) % 26]))),
        el('div', { class: 'titlewrap' }, logo('big'),
          el('div', { class: 'tag' }, 'GUESS THE WORD · BEAT YOUR FRIENDS'),
          el('div', { class: 'press' }, U.touch ? 'TAP TO START' : 'PRESS ANY KEY')));
      App.screen(s);
      const go = () => { off(); SFX.play('ok'); if (Auth.resume()) Menu.afterLogin(); else Menu.login(); };
      const key = e => { if (!e.ctrlKey && !e.metaKey && e.key !== 'Tab') go(); };
      const off = () => { window.removeEventListener('keydown', key); s.removeEventListener('pointerdown', go); };
      setTimeout(() => { window.addEventListener('keydown', key); s.addEventListener('pointerdown', go); }, 250);
      App.onLeave(off);
    },

    /* ------------------------------------------------------------------ log in */
    login(tab) {
      tab = tab || (Auth.list().length ? 'in' : 'new');
      const accts = Auth.list();
      const name = el('input', { type: 'text', maxlength: 16, placeholder: 'Player name', autocomplete: 'username', class: 'input', value: tab === 'in' && accts[0] ? accts[0].user : '' });
      const pw = el('input', { type: 'password', maxlength: 64, placeholder: 'Password', autocomplete: tab === 'new' ? 'new-password' : 'current-password', class: 'input' });
      const pw2 = tab === 'new' ? el('input', { type: 'password', maxlength: 64, placeholder: 'Password again', autocomplete: 'new-password', class: 'input' }) : null;
      const rem = el('input', { type: 'checkbox', checked: true });
      const err = el('p', { class: 'err' });
      const go = async () => {
        err.textContent = '';
        if (pw2 && pw.value !== pw2.value) { err.textContent = 'The passwords don\'t match.'; SFX.play('bad'); return; }
        const b = s.querySelector('.loginp .btn.big'); b.classList.add('off');
        const r = tab === 'new' ? await Auth.register(name.value, pw.value, rem.checked) : await Auth.login(name.value, pw.value, rem.checked);
        b.classList.remove('off');
        if (r.err) { err.textContent = r.err; SFX.play('bad'); return; }
        SFX.play('win'); Menu.afterLogin(r.fresh);
      };
      [name, pw, pw2].forEach(i => i && i.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }));
      const s = el('div', { class: 'screen login' },
        el('div', { class: 'loginleft' }, logo(), el('div', { class: 'tag' }, 'GUESS THE WORD · BEAT YOUR FRIENDS')),
        el('div', { class: 'panel loginp' },
          el('div', { class: 'tabs' },
            el('button', { class: tab === 'in' ? 'on' : '', onclick: () => Menu.login('in') }, 'LOG IN'),
            el('button', { class: tab === 'new' ? 'on' : '', onclick: () => Menu.login('new') }, 'NEW PLAYER')),
          tab === 'in' && accts.length ? el('div', { class: 'acctlist' }, el('small', null, 'ON THIS DEVICE'),
            ...accts.slice(0, 6).map(a => el('button', { class: 'acct' + (name.value === a.user ? ' on' : ''), onclick: () => { name.value = a.user; s.querySelectorAll('.acct').forEach(x => x.classList.toggle('on', x.textContent.startsWith(a.user))); pw.focus(); } },
              avatar(a.id, a.user, 'sm'), el('b', null, a.user), Rank.badge(a.rating, { small: true, num: false })))) : null,
          tab === 'in' && !accts.length ? el('p', { class: 'note' }, 'No accounts on this device yet. Make one under NEW PLAYER.') : null,
          el('label', { class: 'field' }, el('span', null, 'NAME'), name),
          el('label', { class: 'field' }, el('span', null, 'PASSWORD'), pw),
          pw2 ? el('label', { class: 'field' }, el('span', null, 'CONFIRM'), pw2) : null,
          el('label', { class: 'check' }, rem, 'Keep me logged in on this device'),
          err,
          btn(tab === 'new' ? 'CREATE PLAYER' : 'LOG IN', go, 'big wide'),
          tab === 'new' ? el('p', { class: 'fine' }, 'Your account and save live in this browser. Your name and rank are shown to other players online; your game makes you a private key so nobody else can post as you.') : null,
          el('button', { class: 'linkbtn', onclick: howto }, 'How to play')));
      App.screen(s);
      setTimeout(() => (tab === 'in' && name.value ? pw : name).focus(), 50);
    },
    afterLogin(fresh) {
      if (Auth.prefs.autoOnline) Net.start();
      Social.init();
      Menu.home();
      if (fresh) setTimeout(() => { toast('Welcome, ' + Auth.name + '! Your friend code is ' + Auth.name + '#' + Auth.tag, 'gold', 4200); howto(); }, 400);
    },

    /* home: the game picker (arcade.js) */
    home() { Arcade.picker(); },
    /* the bar along the top of the picker and the Wordle hub: you, your level and rank, friends, options */
    homeBar(onBack) {
      const S = Auth.S, L = Rank.level(S.xp);
      return el('div', { class: 'topbar hubbar' },
        onBack ? el('button', { class: 'backbtn', title: 'Back to the games (Esc)', 'aria-label': 'Back', onclick: () => { SFX.play('back'); onBack(); } }, '‹') : null,
        logo('small'), el('div', { class: 'grow' }),
        el('button', { class: 'me', onclick: () => Menu.stats(), title: 'Your stats' }, avatar(Auth.id, Auth.name),
          el('span', { class: 'mename' }, el('b', null, Auth.name), el('small', null, '#' + Auth.tag)),
          el('span', { class: 'melv' }, el('small', null, 'LV ' + L.lv), el('i', { class: 'xpbar' }, el('i', { style: { width: (L.into / L.need * 100) + '%' } }))),
          Rank.badge(S.rank.rating, { small: true })),
        socialButtons(),
        el('button', { class: 'iconbtn', title: 'Options', onclick: () => Menu.options() }, el('span', { class: 'ico ico-gear' })),
        el('button', { class: 'iconbtn', title: 'How to play', onclick: howto }, el('span', { class: 'ico ico-help' })),
        btn('LOG OUT', () => { Auth.logout(); Menu.login('in'); }, 'ghost small'));
    },

    /* ------------------------------------------------------------------ hub (Wordle) */
    hub() {
      if (!Auth.user) return Menu.login();
      if (window.Online) Online.away();
      const room = window.Online && Online.roomInfo();
      if (!room) Net.setStatus('menu', 'In the menus');
      const S = Auth.S, P = S.prefs, R = S.rank, L = Rank.level(S.xp);
      const day = U.dayNum(), dd = S.daily[day], dstat = Auth.stat('daily');
      const lenChips = (cur, set) => el('div', { class: 'chips' }, ...Engine.LENS.map(n => el('button', { class: n === cur ? 'on' : '', onclick: e => { e.stopPropagation(); SFX.play('key'); set(n); } }, n)));
      const card = (cls, title, desc, go, ...extra) => el('div', { class: 'card ' + cls, role: 'button', tabindex: 0, onclick: e => { if (e.target.closest('.chips, .btn')) return; SFX.play('ok'); go(); }, onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) go(); } },
        el('div', { class: 'cardico' }), el('h3', null, title), el('p', null, desc), ...extra);
      const len = P.len || 5;
      const setLen = n => { P.len = n; Auth.save(); Menu.hub(); };
      const cpuSkill = P.cpu || 'normal';
      const friendsOn = Object.keys(S.friends).filter(id => Net.online(id));
      const countdown = el('b', { class: 'cd' }, U.hms(U.msToMidnight()));
      const cdT = setInterval(() => { countdown.textContent = U.hms(U.msToMidnight()); }, 1000);
      const onlineN = el('b', null, ''), friendList = el('div', { class: 'hubfriends' });
      const fillSide = () => {
        if (!document.body.contains(friendList)) return;
        const n = [...Net.players.keys()].filter(id => id !== Auth.id).length;
        onlineN.textContent = Net.state === 'up' ? n + ' player' + (n === 1 ? '' : 's') + ' online' : Net.state === 'connecting' ? 'Connecting...' : Net.state === 'down' ? 'Can\'t reach the relay' : 'You\'re offline';
        friendList.innerHTML = '';
        const ids = Object.keys(S.friends).sort((a, b) => (Net.online(b) ? 1 : 0) - (Net.online(a) ? 1 : 0) || S.friends[a].n.localeCompare(S.friends[b].n));
        if (!ids.length) friendList.append(el('p', { class: 'muted small' }, 'No friends yet. Add some from FRIENDS, or meet people in the ONLINE LOBBY.'));
        for (const id of ids.slice(0, 8)) {
          const p = Net.online(id), f = S.friends[id];
          friendList.append(el('button', { class: 'hubfriend' + (p ? ' on' : ''), onclick: () => Social.card(id) }, avatar(id, f.n, 'sm'), el('span', null, el('b', null, f.n), el('small', null, p ? p.x : 'Offline')), el('i', { class: 'dot' + (p ? ' on' : '') })));
        }
      };
      const s = el('div', { class: 'screen hub' },
        Menu.homeBar(() => Menu.home()),
        room ? el('div', { class: 'roombanner' }, el('span', null, "You're still in room "), el('b', null, room.name + (room.playing ? ' · match on' : '')), el('div', { class: 'grow' }),
          btn('BACK TO THE ROOM', () => Online.back(), 'small hot'), btn('LEAVE IT', () => { Online.leave(true); Menu.hub(); }, 'ghost small')) : null,
        el('div', { class: 'hubmain' },
          el('div', { class: 'hubgrid' },
            card('daily big' + (dd && dd.done ? ' done' : ''), 'DAILY #' + day, dd && dd.done ? (dd.won ? 'Solved in ' + dd.rows.length + '. Streak ' + dstat.streak + '.' : 'Missed today. Streak reset.') : dd && dd.rows.length ? 'In progress: ' + dd.rows.length + ' guess' + (dd.rows.length > 1 ? 'es' : '') + ' so far.' : 'Today\'s word, the same for everyone. Streak ' + dstat.streak + '.',
              () => Play.start('daily'), el('div', { class: 'cardfoot' }, el('small', null, 'NEXT WORD IN'), countdown), dd && dd.done ? el('div', { class: 'cardtick' }, '✓') : null),
            card('online big', 'ONLINE LOBBY', 'Chat, challenge players, join rooms of up to eight, or race 1v1 for rank.', () => Online.open(),
              el('div', { class: 'cardfoot' }, el('i', { class: 'dot on' }), onlineN)),
            card('classic', 'CLASSIC', 'Endless words. Pick a length.', () => Play.start('classic', { len }), lenChips(len, setLen)),
            card('quad', 'QUAD', 'Four words, nine guesses, one keyboard.', () => Play.start('quad')),
            card('blitz', 'BLITZ', 'Three minutes. Solve as many as you can.', () => Play.start('blitz', { len }), lenChips(len, setLen)),
            card('survival', 'SURVIVAL', 'A pool of guesses; every solve tops it up.', () => Play.start('survival')),
            card('cpu', 'VS CPU', 'Race the computer to the word. First to 2.', () => Play.start('cpu', { skill: cpuSkill }),
              el('div', { class: 'chips' }, ...[['easy', 'EASY'], ['normal', 'NORMAL'], ['hard', 'HARD']].map(([k, t]) => el('button', { class: k === cpuSkill ? 'on' : '', onclick: e => { e.stopPropagation(); P.cpu = k; Auth.save(); Menu.hub(); } }, t)))),
            card('ranked', 'RANKED', Rank.label(R.rating) + ' · ' + R.rating + ' · ' + R.wins + 'W ' + R.losses + 'L', () => Rank.board(), Rank.badge(R.rating, { num: false }), btn('FIND MATCH', () => Online.ranked(), 'small hot'))),
          el('aside', { class: 'hubside panel' },
            el('div', { class: 'sidehead' }, el('h3', null, 'FRIENDS'), btn('ALL', () => Social.friends(), 'ghost small')),
            friendList,
            el('div', { class: 'sidebtns' }, btn('LEADERBOARD', () => Rank.board(), 'ghost'), btn('STATS', () => Menu.stats(), 'ghost'), btn('MESSAGES', () => Social.messages(), 'ghost')),
            el('small', { class: 'muted' }, 'Friend code: ', el('b', { class: 'sel' }, Auth.name + '#' + Auth.tag)))));
      App.screen(s);
      const offs = [Net.on('players', fillSide), Net.on('state', fillSide), Social.on('change', fillSide)];
      App.onLeave(() => { clearInterval(cdT); offs.forEach(f => f()); });
      fillSide();
    },

    /* ------------------------------------------------------------------ options */
    options() {
      const S = Auth.S, P = S.prefs;
      const set = (k, v) => { P[k] = v; Auth.save(); Auth.after(); Menu.options(); };
      const seg = (label, val, opts, fn, note) => el('div', { class: 'seg' }, el('span', null, label),
        el('div', null, ...opts.map(([v, t]) => el('button', { class: String(val) === String(v) ? 'on' : '', onclick: () => { SFX.play('key'); fn(v); } }, t))), note ? el('small', null, note) : null);
      const oldPw = el('input', { type: 'password', class: 'input', placeholder: 'Current password', autocomplete: 'current-password' });
      const newPw = el('input', { type: 'password', class: 'input', placeholder: 'New password', autocomplete: 'new-password' });
      const st = { up: 'Online', connecting: 'Connecting...', down: 'Can\'t reach the relay', off: 'Offline' }[Net.state];
      App.screen(el('div', { class: 'screen options' }, topbar('OPTIONS', () => Menu.home()),
        el('div', { class: 'panel optpanel' },
          el('h3', null, 'LOOK AND SOUND'),
          seg('THEME', P.theme, [['dark', 'Dark'], ['light', 'Light']], v => set('theme', v)),
          seg('TILE COLOURS', P.cb, [[false, 'Standard'], [true, 'High contrast']], v => set('cb', v === true || v === 'true'), 'High contrast swaps to orange and blue, easier to tell apart for colour-blind players.'),
          seg('MUSIC', Music.volume, [[0, 'Off'], [0.3, 'Low'], [0.6, 'Medium'], [1, 'High']], v => { Music.setVolume(+v); Menu.options(); }),
          seg('SOUNDTRACK', Music.soundtrack, Music.soundtracks.map(s => [s[0], s[1]]), v => { Music.setSoundtrack(v); Menu.options(); },
            'Three versions of the same six themes. ' + ((Music.soundtracks.find(s => s[0] === Music.soundtrack) || [])[2] || '')),
          seg('SOUND EFFECTS', P.sound, [[true, 'On'], [false, 'Off']], v => set('sound', v === true || v === 'true'), 'Made with ElevenLabs Sound Effects.'),
          el('h3', null, 'GAMEPLAY'),
          seg('HARD MODE', P.hard, [[false, 'Off'], [true, 'On']], v => set('hard', v === true || v === 'true'), 'Hits must stay in place and near letters must be reused, in Daily, Classic, Blitz, Survival and VS CPU. Online rooms set their own.'),
          el('h3', null, 'ONLINE'),
          seg('GO ONLINE', P.autoOnline, [[true, 'When I log in'], [false, 'Only when I open the lobby']], v => set('autoOnline', v === true || v === 'true'), 'Online, friends see you and your messages arrive. Status: ' + st + '.'),
          el('div', { class: 'row' }, Net.state === 'off' ? btn('CONNECT NOW', () => { Net.start(); setTimeout(() => Menu.options(), 300); }, 'small') : btn('DISCONNECT', () => { Net.stop(); Menu.options(); }, 'ghost small'),
            Net.state === 'down' ? btn('RETRY', () => { Net.retry(); Menu.options(); }, 'ghost small') : null),
          seg('MESSAGES FROM', P.dmFrom, [['everyone', 'Everyone'], ['friends', 'Friends only']], v => set('dmFrom', v)),
          seg('LOBBY CHAT', P.typed, [[true, 'Show it'], [false, 'Hide it']], v => set('typed', v === true || v === 'true')),
          seg('SWEAR FILTER', P.filter, [[false, 'Off'], [true, 'On']], v => set('filter', v === true || v === 'true'), 'Stars out common swear words in chat and messages.'),
          el('h3', null, 'ACCOUNT'),
          el('p', null, 'Friend code: ', el('b', { class: 'sel' }, Auth.name + '#' + Auth.tag), ' ', btn('COPY', () => { try { navigator.clipboard.writeText(Auth.name + '#' + Auth.tag); toast('Copied.'); } catch (e) { /* fine */ } }, 'ghost small')),
          el('div', { class: 'pwrow' }, oldPw, newPw, btn('CHANGE PASSWORD', async () => { const r = await Auth.changePassword(oldPw.value, newPw.value); toast(r.err || 'Password changed.', r.err ? 'bad' : 'gold'); if (r.ok) { oldPw.value = ''; newPw.value = ''; } }, 'small')),
          btn('DELETE THIS ACCOUNT', () => modal({ title: 'DELETE ' + Auth.name.toUpperCase() + '?', body: [el('p', null, 'This removes the account, its stats, friends and messages from this device. It can\'t be undone.')],
            buttons: [['DELETE', () => { const id = Auth.id; Auth.logout(); Auth.remove(id); toast('Account deleted.'); Menu.login(); }, 'danger'], ['KEEP IT', () => {}, 'ghost']] }), 'ghost danger small'),
          el('h3', null, 'ABOUT'),
          el('p', { class: 'fine' }, 'Word lists: SCOWL by Kevin Atkinson and others (see WORDS-LICENSE.txt). Online play uses two free public MQTT relays for the lobby, chat, friends, messages and the room list, and PeerJS (WebRTC) to link the players in a room directly, like Knock//Back. Anyone can read what\'s posted to the relays in the open: names, ratings, statuses, lobby chat. Messages, challenges and invites are encrypted to the person they\'re for. In a room, the other players can see your IP address, as in any peer-to-peer game.'))));
    },

    /* ------------------------------------------------------------------ stats */
    stats() {
      const S = Auth.S, R = S.rank, L = Rank.level(S.xp);
      const dist = (st, max) => {
        const d = st.dist || {}, top = Math.max(1, ...Object.values(d));
        return el('div', { class: 'dist' }, ...Array.from({ length: max }, (_, i) => i + 1).map(n => el('div', { class: 'distrow' }, el('span', null, n), el('i', { style: { width: Math.max(6, (d[n] || 0) / top * 100) + '%' } }, d[n] || 0))));
      };
      const box = (title, st, extra) => el('div', { class: 'statbox' }, el('h3', null, title),
        el('div', { class: 'nums' }, el('div', null, el('b', null, st.played), el('small', null, 'PLAYED')), el('div', null, el('b', null, st.played ? Math.round(st.won / st.played * 100) : 0), el('small', null, 'WIN %')),
          el('div', null, el('b', null, st.streak), el('small', null, 'STREAK')), el('div', null, el('b', null, st.maxStreak), el('small', null, 'BEST'))), extra || null);
      const scoreBox = (title, st, unit) => el('div', { class: 'statbox' }, el('h3', null, title),
        el('div', { class: 'nums' }, el('div', null, el('b', null, st.played), el('small', null, 'PLAYED')), el('div', null, el('b', null, st.best), el('small', null, 'BEST ' + unit)), el('div', null, el('b', null, st.total || 0), el('small', null, 'ALL-TIME ' + unit))));
      App.screen(el('div', { class: 'screen stats' }, topbar('STATS', () => Menu.home()),
        el('div', { class: 'panel statpanel' },
          el('div', { class: 'statme' }, avatar(Auth.id, Auth.name, 'lg'), el('div', null, el('h2', null, Auth.name, el('small', null, ' #' + Auth.tag)),
            el('div', { class: 'row' }, Rank.badge(R.rating), el('span', { class: 'lvchip' }, 'LEVEL ' + L.lv)),
            el('div', { class: 'xpbar wide' }, el('i', { style: { width: (L.into / L.need * 100) + '%' } })), el('small', null, L.into + ' / ' + L.need + ' XP to level ' + (L.lv + 1)))),
          el('div', { class: 'statgrid' },
            box('DAILY', Auth.stat('daily'), dist(Auth.stat('daily'), 6)),
            ...Engine.LENS.map(n => box('CLASSIC · ' + n + ' LETTERS', Auth.stat('classic' + n), dist(Auth.stat('classic' + n), Engine.maxFor(n)))),
            box('QUAD', Auth.stat('quad')),
            scoreBox('BLITZ', Auth.stat('blitz'), 'WORDS'),
            scoreBox('SURVIVAL', Auth.stat('survival'), 'WORDS'),
            box('VS CPU', Auth.stat('cpu')),
            box('ONLINE ROOMS', Auth.stat('online')),
            el('div', { class: 'statbox' }, el('h3', null, 'RANKED'), el('div', { class: 'nums' }, el('div', null, el('b', null, R.rating), el('small', null, 'RATING')), el('div', null, el('b', null, R.peak), el('small', null, 'PEAK')),
              el('div', null, el('b', null, R.wins), el('small', null, 'WINS')), el('div', null, el('b', null, R.losses), el('small', null, 'LOSSES'))),
              el('div', { class: 'hist' }, ...R.hist.slice(-8).reverse().map(h => el('div', null, el('span', { class: h.d >= 0 ? 'up' : 'down' }, (h.d >= 0 ? '+' : '') + h.d), ' vs ' + (h.opp || '?'), el('small', null, U.ago(h.t))))))))));
    },
  };
})();
