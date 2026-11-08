/* ============================================================================
   online.js -- THE ONLINE LOBBY and ROOMS (set up like Knock//Back's).

   THE LOBBY: everyone online (net.js presence), the lobby chat, and the room
   list. Click a player to see their card: add them, message them, or
   CHALLENGE them (a private room opens for the two of you and they get an
   invite to accept). QUICK MATCH drops you into an open public room (or opens
   one); RANKED MATCH finds you a 1v1 opponent near your rating.

   THE ROOM LIST: as in Knock//Back, each host keeps a short note about its
   room on the two public MQTT brokers (retained, refreshed every 10 s, wiped
   by the broker's "last will" when the host's browser goes away). Public and
   private rooms (a password to get in) are listed; any room can be joined by
   its five-letter code; "code only" rooms aren't listed.

   A ROOM: up to eight. Everyone not sitting out plays every round at once:
   the same hidden word(s), each on their own board, with everyone's progress
   (colours only, never letters) shown live beside yours. The host runs the
   room: name, public/private + password, listed or code only, locked, size,
   chat, the rules (mode, word length, rounds, round time, hard mode), auto-
   start, and kick / block / mute.

   THE LINKS: the browsers connect directly (WebRTC, through PeerJS; the free
   PeerJS service only introduces them). When a direct link can't get through
   (some routers and mobile networks block it), the room's messages go over
   the lobby's MQTT brokers instead, encrypted (relay.js). The host's game holds the words and
   checks every guess, so nobody else's game knows the answer until the round
   ends. Scoring (per round):
     RACE   solve it: 100 + 20 per guess you didn't need, + 60/40/20 for the
            1st/2nd/3rd to solve.  QUAD: 50 a board, the race bonus when all 4 are done.
     BLITZ  every word solved in the time: 50 + 10 per guess you didn't need.
   Most points after the last round wins.
   RANKED rooms are 1v1, three 5-letter Race rounds, fixed rules; the winner
   gains rating and the loser drops (rank.js). Leaving a ranked match early
   counts as a loss.

     Online.open()  ranked()  quick()  join(code, pass, o)  challenge(id, o)
   ========================================================================== */
(function () {
  'use strict';
  const { el } = U;
  const PROTO = 'wnf-room-1';
  const PEER_JS = ['https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'];
  const PREFIX = 'wordle-n-friends-room-', ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const ROOM_MAX = 8, START_IN = 3500, GAP_MS = 7000, AUTO_CD = 5;
  const QUICK = ['GG!', 'Good luck!', 'Nice solve!', 'So close!', 'One more?', 'Ready!', 'Be right back', 'Thanks for the game!'];
  const MODE_TXT = { race: 'Race', blitz: 'Blitz', quad: 'Quad' };
  const RANKED_RULES = { mode: 'race', len: 5, rounds: 3, time: 120, hard: false };
  const DEFAULT_RULES = { mode: 'race', len: 5, rounds: 3, time: 120, hard: false };
  const DENY = {
    version: 'That room is on a different version of the game. Reload the page (Ctrl+F5) and try again.',
    blocked: 'The host of that room has blocked you.',
    locked: 'That room is locked: its host isn\'t letting anyone new in.',
    full: 'That room is full.',
    pass: 'That room is private: it needs its password.',
    wrongpass: 'Wrong password.',
    ranked: 'That ranked match already has two players.',
  };
  const why = e => ({
    'peer-unavailable': 'No room with that code. It may have closed, or check the code.',
    'network': 'Couldn\'t reach the matchmaking service. Check your connection and try again.',
    'server-error': 'The matchmaking service is having trouble. Try again in a minute.',
    'socket-error': 'Couldn\'t reach the matchmaking service. Check your connection and try again.',
    'socket-closed': 'Lost the matchmaking service. Try again.',
    'browser-incompatible': 'This browser can\'t do peer-to-peer connections. Try Chrome, Edge, Firefox or Safari.',
    'webrtc': 'The connection failed. Some networks (school or work Wi-Fi, some mobile data) block it.',
  })[e && e.type] || ('Connection problem' + (e && e.type ? ' (' + e.type + ')' : '') + '. Try again.');

  const Online = window.Online = {};
  let N = null;        // the session: the lobby, or the room you're in
  let G = null;        // the round on your screen (yours, or one you're watching)
  const loadPeer = () => Net.loadScript(PEER_JS, () => !!window.Peer);
  const makeCode = () => Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
  const toast = (t, c) => Menu.toast(t, c || 'gold');
  const meInfo = () => ({ uid: Auth.id, name: Auth.name, r: Auth.S.rank.rating, lv: Rank.level(Auth.S.xp).lv });
  const memberOf = id => N && N.room ? N.room.members.find(m => m.id === id) || null : null;
  const freshN = () => ({ stage: 'lobby', status: '', host: false, chat: [], tab: N && N.tab || 'play', autoWatch: true });
  const tagOf = uid => '#' + String(uid || '').slice(0, 4).toUpperCase();

  /* ===================================================== hosting's room note
     (the list itself is read by net.js: Net.rooms) */
  const Dir = {
    pub: null,
    async host(code, info) {
      Dir.stopHost();
      const topic = Net.PRE + 'rooms/' + code, P = Dir.pub = { topic, info, clients: [] };
      try { await Net.loadMqtt(); } catch (e) { return; }
      if (Dir.pub !== P) return;
      P.clients = Net.BROKERS.map(url => {
        const c = mqtt.connect(url, { clientId: 'wnfh_' + U.rid(10), keepalive: 30, reconnectPeriod: 5000, connectTimeout: 8000, clean: true, will: { topic, payload: '', retain: true, qos: 0 } });
        c.on('connect', () => Dir.publish(c)); c.on('error', () => {});
        return c;
      });
      P.t = setInterval(() => Dir.update(), 10000);
    },
    publish(c) { const P = Dir.pub; if (!P) return; const i = P.info(); try { c.publish(P.topic, i ? JSON.stringify(Object.assign(i, { v: PROTO, ts: Date.now() })) : '', { retain: true, qos: 0 }); } catch (e) { /* fine */ } },
    update() { const P = Dir.pub; if (!P) return; for (const c of P.clients) if (c.connected) Dir.publish(c); },
    stopHost() {
      const P = Dir.pub; if (!P) return; Dir.pub = null; clearInterval(P.t);
      for (const c of P.clients) { try { if (c.connected) c.publish(P.topic, '', { retain: true, qos: 0 }); } catch (e) { /* fine */ } setTimeout(() => { try { c.end(true); } catch (e) { /* fine */ } }, 600); }
    },
  };
  const listedRooms = () => [...Net.rooms.values()].filter(r => r.v === PROTO);

  /* ===================================================== messages, both sides */
  function toMember(id, msg) {
    if (!N || !N.host) return;
    if (id === N.myId) { setTimeout(() => { if (N && N.host) guestGot(msg); }, 0); return; }
    const M = N.mem.get(id); if (M && M.conn && M.conn.open) { try { M.conn.send(msg); } catch (e) { /* closed */ } }
  }
  function toAll(msg, except) { if (!N || !N.host) return; for (const m of N.room.members) if (!except || !except.includes(m.id)) toMember(m.id, msg); }
  function toHost(msg) { if (!N) return; if (N.host) hostGot(N.myId, msg); else if (N.conn && N.conn.open) { try { N.conn.send(msg); } catch (e) { /* closed */ } } }
  const act = msg => toHost(msg);

  /* ===================================================== the host's side */
  function newRoom(o, code, id) {
    return { code, hostId: id, name: U.clean(o.name, 24) || Auth.name + '\'s room', priv: !!o.priv, listed: o.listed !== false, locked: false, max: o.ranked ? 2 : U.clamp(o.max | 0 || ROOM_MAX, 2, ROOM_MAX),
      chat: 'on', muted: [], ranked: !!o.ranked, rules: Object.assign({}, o.ranked ? RANKED_RULES : DEFAULT_RULES, o.ranked ? {} : o.rules || {}), auto: o.auto !== false,
      members: [], match: null, last: null, cd: null, chal: o.chal ? { to: o.chal.to, name: o.chal.name } : null };
  }
  function listing() {
    const R = N && N.room; if (!R || !R.listed) return null;
    const host = memberOf(R.hostId) || {};
    return { name: R.name, host: host.name || Auth.name, hostId: Auth.id, n: R.members.length, max: R.max, priv: R.priv, ranked: R.ranked, rating: host.r || 1000,
      state: R.locked ? 'locked' : R.members.length >= R.max ? 'full' : R.match ? 'playing' : 'open', mode: R.rules.mode, len: R.rules.len, rounds: R.rules.rounds };
  }
  let pushT = null;
  function pushRoom() {
    if (!N || !N.host) return;
    clearTimeout(pushT);
    pushT = setTimeout(() => { if (!N || !N.host) return; toAll({ t: 'room', room: N.room }); Dir.update(); setPresence(); }, 30);
  }
  function sysSay(text) { const c = { sys: text }; if (N.host) toAll({ t: 'chat', c }); }
  function hostConn(conn) {
    conn.on('data', d => hostData(conn, d));
    conn.on('close', () => memberGone(conn.peer, 'left'));
    conn.on('error', () => {});
  }
  function hostData(conn, d) {
    if (!N || !N.host || !d || typeof d !== 'object') return;
    const id = conn.peer, R = N.room;
    if (d.t === 'hello') {
      if (N.mem.has(id)) return;
      const deny = w => { try { conn.send({ t: 'deny', why: w }); } catch (e) { /* fine */ } setTimeout(() => { try { conn.close(); } catch (e) { /* fine */ } }, 400); };
      if (d.ver !== PROTO) return deny('version');
      const me = d.me || {}, uid = String(me.uid || '').slice(0, 16);
      if (N.blocked.has(uid)) return deny('blocked');
      if (R.members.some(m => m.uid === uid)) return deny('full');
      if (R.locked) return deny('locked');
      if (R.members.length >= R.max) return deny(R.ranked ? 'ranked' : 'full');
      if (R.priv && String(d.pass || '') !== N.pass) return deny(d.pass ? 'wrongpass' : 'pass');
      N.mem.set(id, { conn });
      const wasChal = !!(R.chal && uid === R.chal.to);
      const m = { id, uid, name: U.clean(me.name, 16) || 'Player', r: Math.round(+me.r || 1000), lv: (+me.lv | 0) || 1, ready: !R.match && (!!d.ready || R.ranked || wasChal), sit: false, host: false };
      R.members.push(m);
      conn.send({ t: 'welcome', you: id, room: R });
      sysSay(m.name + ' joined.');
      if (wasChal) { R.chal = null; N.chal = null; }
      if (R.match && H) { conn.send(roundMsg(id)); conn.send({ t: 'progall', mid: R.match.mid, r: R.match.round, p: progAll() }); }
      pushRoom(); return;
    }
    if (!N.mem.has(id)) return;
    hostGot(id, d);
  }
  const flood = new Map();
  function hostGot(id, d) {
    const R = N.room, m = memberOf(id); if (!m || !d) return;
    switch (d.t) {
      case 'ready': if (R.match && R.match.ids.includes(id)) return; m.ready = !!d.on; if (m.ready) m.sit = false; pushRoom(); break;
      case 'sit': if (R.match && R.match.ids.includes(id)) return; m.sit = !!d.on; if (m.sit) m.ready = false; pushRoom(); break;
      case 'say': {
        if (R.chat === 'quick' || R.muted.includes(m.uid)) return;
        const text = U.clean(d.text, 160); if (!text) return;
        const now = Date.now(), f = (flood.get(id) || []).filter(t => now - t < 10000); if (f.length >= 6) return; f.push(now); flood.set(id, f);
        toAll({ t: 'chat', c: { id, uid: m.uid, name: m.name, text } }); break;
      }
      case 'chat': if (QUICK[d.i | 0] != null) toAll({ t: 'chat', c: { id, uid: m.uid, name: m.name, i: d.i | 0 } }); break;
      case 'g': hostGuess(id, d); break;
    }
  }
  function memberGone(id, how) {
    if (!N || !N.host || !N.mem.has(id)) return;
    N.mem.delete(id);
    const R = N.room, m = memberOf(id); if (!m) return;
    R.members = R.members.filter(x => x.id !== id);
    sysSay(m.name + (how === 'kicked' ? ' was removed.' : ' left.'));
    if (R.match) {
      R.match.ids = R.match.ids.filter(x => x !== id);
      if (H && H.players.has(id)) { H.players.get(id).gone = true; H.players.get(id).name = m.name; }
      if (R.match.ids.length < 2 && R.match.state !== 'over') endMatch(true);
      else checkRoundOver();
    }
    pushRoom();
  }
  /* the host's own controls */
  const HC = {
    set(k, v) {
      const R = N.room;
      if (k === 'name') R.name = U.clean(v, 24) || R.name;
      else if (k === 'priv') { R.priv = !!v.on; N.pass = v.on ? String(v.pass || '').slice(0, 16) : ''; }
      else if (k === 'max') { R.max = U.clamp(v | 0, Math.max(2, R.members.length), ROOM_MAX); }
      else if (['listed', 'locked', 'auto'].includes(k)) R[k] = !!v;
      else if (k === 'chat') R.chat = v === 'quick' ? 'quick' : 'on';
      if (k === 'listed' && !R.listed) Dir.update();
      pushRoom();
    },
    rule(k, v) { const R = N.room; if (R.ranked || R.match) return; R.rules[k] = v; if (k === 'mode' && v === 'quad') R.rules.len = 5; pushRoom(); },
    kick(id, block) { const m = memberOf(id); if (!m || m.host || (N.room.ranked && N.room.match)) return; if (block) N.blocked.add(m.uid); toMember(id, { t: 'kicked', block }); setTimeout(() => { const M = N && N.mem.get(id); try { M && M.conn.close(); } catch (e) { /* fine */ } memberGone(id, 'kicked'); }, 300); },
    mute(id) { const m = memberOf(id), R = N.room; if (!m) return; const i = R.muted.indexOf(m.uid); if (i >= 0) R.muted.splice(i, 1); else R.muted.push(m.uid); pushRoom(); },
    start() { if (eligible().length >= 2 && eligible().every(m => m.ready)) startMatch(); else toast('Everyone playing needs to be READY (two at least).', 'bad'); },
  };
  const eligible = () => N.room.members.filter(m => !m.sit);
  /* auto-start: everyone not sitting out is ready (two at least): a short countdown */
  function hostTick() {
    if (!N || !N.host) return;
    const R = N.room;
    if (H && R.match && R.match.state === 'play' && Date.now() > H.ends + 600) endRound();
    if (R.match) { if (R.cd != null) { R.cd = null; pushRoom(); } return; }
    const E = eligible(), go = R.auto && E.length >= 2 && E.every(m => m.ready);
    if (!go) { if (R.cd != null) { R.cd = null; pushRoom(); } return; }
    if (R.cd == null) { R.cdAt = Date.now(); R.cd = AUTO_CD; pushRoom(); return; }
    const left = AUTO_CD - Math.floor((Date.now() - R.cdAt) / 1000);
    if (left <= 0) { R.cd = null; startMatch(); } else if (left !== R.cd) { R.cd = left; pushRoom(); }
  }

  /* ---- the match, on the host: words, guesses, scores */
  let H = null;   // the host's secret half of the round: the words and every player's game
  const boardsFor = rules => rules.mode === 'quad' ? 4 : 1;
  const maxFor = rules => rules.mode === 'quad' ? 9 : Engine.maxFor(rules.len);
  function startMatch() {
    const R = N.room, ids = eligible().filter(m => m.ready).map(m => m.id);
    if (ids.length < 2) return;
    R.match = { mid: U.rid(8), round: 0, rounds: R.rules.rounds, ids, scores: {}, names: {}, uids: {}, rs: {}, state: 'count', words: [] };
    for (const id of ids) { const m = memberOf(id); R.match.scores[id] = 0; R.match.names[id] = m.name; R.match.uids[id] = m.uid; R.match.rs[id] = m.r; }
    R.cd = null;
    sysSay((R.ranked ? 'Ranked match' : MODE_TXT[R.rules.mode] + ' match') + ' starting: ' + ids.map(i => memberOf(i).name).join(', ') + '.');
    nextRound();
  }
  function nextRound() {
    const R = N.room, M = R.match, rules = R.rules; if (!M) return;
    M.round++; M.state = 'play';
    const len = rules.mode === 'quad' ? 5 : rules.len, n = rules.mode === 'quad' ? 4 : rules.mode === 'blitz' ? 60 : 1;
    const used = new Set(M.words.flat()), words = [];
    while (words.length < n) { const w = Engine.randomWord(len, Math.random, used); used.add(w); words.push(w); }
    const start = Date.now() + START_IN, dur = rules.mode === 'blitz' ? Math.max(60, rules.time || 120) * 1000 : rules.time ? rules.time * 1000 : 0;
    H = { mid: M.mid, r: M.round, words, start, ends: dur ? start + dur : Infinity, dur, len, max: maxFor(rules), boards: boardsFor(rules), mode: rules.mode, hard: !!rules.hard, players: new Map(), order: 0 };
    for (const id of M.ids) H.players.set(id, mkPlayer(id, 0));
    for (const m of R.members) toMember(m.id, roundMsg(m.id));
    pushRoom();
  }
  function mkPlayer(id, k) {
    const ws = H.mode === 'quad' ? H.words : [H.words[k]];
    return { id, k, solvedN: 0, pts: 0, done: false, won: false, n: 0, ms: 0, game: new Engine.Game({ len: H.len, max: H.max, words: ws, hard: H.hard }), hist: [] };
  }
  function roundMsg(forId) {
    return { t: 'round', mid: H.mid, r: H.r, rounds: N.room.match.rounds, mode: H.mode, len: H.len, max: H.max, boards: H.boards, hard: H.hard,
      startIn: H.start - Date.now(), dur: H.dur ? H.ends - Math.max(Date.now(), H.start) : 0, ids: [...H.players.keys()], names: N.room.match.names, uids: N.room.match.uids, scores: N.room.match.scores, play: H.players.has(forId) };
  }
  const progOf = P => ({ rows: P.game.boards.map(b => b.rows.map(r => r.p)), k: P.solvedN, done: P.done, won: P.won, n: P.game.n, pts: P.pts });
  const progAll = () => { const o = {}; if (H) for (const [id, P] of H.players) if (!P.gone) o[id] = progOf(P); return o; };
  function hostGuess(id, d) {
    const R = N.room, M = R.match;
    if (!M || !H || d.mid !== H.mid || d.r !== H.r || M.state !== 'play') return;
    const P = H.players.get(id); if (!P || P.done || P.gone) return;
    const bad = text => toMember(id, { t: 'bad', mid: H.mid, r: H.r, why: text });
    if (Date.now() < H.start - 300) return bad('Wait for GO!');
    if (Date.now() > H.ends + 600) return bad('Time\'s up!');
    const res = P.game.guess(String(d.w || '').slice(0, 7).toLowerCase());
    if (res.err) return bad(res.err);
    const out = { t: 'res', mid: H.mid, r: H.r, w: res.w, pats: res.pats, won: res.won, done: res.done };
    if (H.mode === 'blitz') {
      if (res.done) {
        if (res.won) { P.solvedN++; P.pts += 50 + 10 * (H.max - P.game.n); }
        P.hist.push({ w: P.game.boards[0].word, ok: res.won });
        out.word = P.game.boards[0].word; out.next = true; out.pts = P.pts;
        const k = P.k + 1; if (k >= H.words.length) { P.done = true; P.won = true; } else { const nP = mkPlayer(id, k); P.k = k; P.game = nP.game; }
      }
    } else if (res.done) {
      P.done = true; P.won = res.won; P.n = P.game.n; P.ms = Date.now() - H.start; P.solvedN = P.game.solvedCount;
      if (res.won) P.order = H.order++;
      out.words = H.words;   // you're finished: you may see the answer(s)
    } else if (H.mode === 'quad') P.solvedN = P.game.solvedCount;
    toMember(id, out);
    toAll({ t: 'prog', mid: H.mid, r: H.r, id, p: progOf(P) });
    checkRoundOver();
  }
  function checkRoundOver() { if (H && N.room.match && N.room.match.state === 'play' && [...H.players.values()].every(P => P.done || P.gone)) setTimeout(endRound, 600); }
  function endRound() {
    const R = N.room, M = R.match; if (!M || !H || M.state !== 'play') return;
    M.state = 'gap';
    const res = [];
    for (const [id, P] of H.players) {
      let pts = P.pts;
      if (H.mode === 'race') pts = P.won ? 100 + 20 * (H.max - P.n) + ([60, 40, 20][P.order] || 0) : 0;
      if (H.mode === 'quad') pts = 50 * P.game.solvedCount + (P.won ? 20 * (H.max - P.n) + ([60, 40, 20][P.order] || 0) : 0);
      if (H.mode === 'blitz' && !P.done) P.hist.push({ w: P.game.boards[0].word, ok: false, open: true });
      if (!P.gone && M.scores[id] != null) M.scores[id] += pts;
      res.push({ id, name: M.names[id], won: P.won, n: P.n, ms: P.ms, pts, k: P.solvedN, gone: !!P.gone, hist: H.mode === 'blitz' ? P.hist.slice(-40) : null, rows: P.game.boards.map(b => b.rows.map(r => r.w + ':' + r.p.join(''))) });
    }
    res.sort((a, b) => b.pts - a.pts || a.ms - b.ms);
    M.words.push(H.mode === 'blitz' ? [] : H.words);
    toAll({ t: 'rend', mid: H.mid, r: H.r, words: H.mode === 'blitz' ? null : H.words, res, scores: M.scores, last: M.round >= M.rounds });
    setTimeout(() => {
      if (!N || !N.host || N.room.match !== M) return;
      if (M.round >= M.rounds) endMatch(false); else nextRound();
    }, GAP_MS);
    pushRoom();
  }
  function endMatch(forfeit) {
    const R = N.room, M = R.match; if (!M) return;
    M.state = 'over';
    const st = Object.keys(M.scores).map(id => ({ id, uid: M.uids[id], name: M.names[id], pts: M.scores[id], r: M.rs[id], here: M.ids.includes(id) }))
      .sort((a, b) => (b.here ? 1 : 0) - (a.here ? 1 : 0) || b.pts - a.pts);
    toAll({ t: 'mend', mid: M.mid, st, ranked: R.ranked, forfeit: !!forfeit });
    R.last = { names: st.map(s => s.name), pts: st.map(s => s.pts) };
    R.match = null; H = null;
    for (const m of R.members) m.ready = false;
    pushRoom();
  }

  /* ===================================================== a member's side */
  function guestGot(d) {
    if (!N || !d || typeof d !== 'object') return;
    switch (d.t) {
      case 'welcome': N.myId = d.you; N.room = d.room; N.stage = 'room'; N.status = ''; N.quick = null; setPresence(); SFX.play('ping'); show(); break;
      case 'deny':
        if (N.quick) { quickFailed(); return; }
        if (d.why === 'pass' || d.why === 'wrongpass') { const code = N.code; Online.leave(true); N = freshN(); N.needPass = code; N.codeIn = code; N.status = DENY[d.why]; Online.open(); return; }
        roomGone(DENY[d.why] || 'Couldn\'t join that room.'); break;
      case 'room': N.room = d.room; setPresence(); draw(); break;
      case 'chat': N.chat.push(d.c); if (N.chat.length > 100) N.chat.shift(); drawChat(); break;
      case 'closed': roomGone('The host closed the room.'); break;
      case 'kicked': roomGone(d.block ? 'The host removed and blocked you.' : 'The host removed you from the room.'); break;
      case 'round': onRound(d); break;
      case 'res': onRes(d); break;
      case 'bad': onBad(d); break;
      case 'prog': onProg(d.mid, d.r, d.id, d.p); break;
      case 'progall': if (G && G.mid === d.mid && G.r === d.r) for (const id in d.p) onProg(d.mid, d.r, id, d.p[id]); break;
      case 'rend': onRend(d); break;
      case 'mend': onMend(d); break;
    }
  }
  function roomGone(text) {
    const wasRanked = N && N.room && N.room.ranked && G && G.play && !G.over;
    if (wasRanked) { const opp = Object.keys(G.names).find(id => id !== N.myId); if (opp) { const r = Rank.apply((G.rs && G.rs[opp]) || 1000, 1, G.names[opp]); text += ' You win by forfeit (+' + r.d + ').'; } }
    if (G) G.over = true;
    const here = N && ['lobby', 'room', 'game'].includes(N.view);
    Online.leave(true); G = null;
    if (here) { N = freshN(); N.status = text; Online.open(); }
    toast(text, 'bad');
  }
  function setPresence() {
    if (!N) return;
    const R = N.room;
    if (!R) { if (N.view === 'lobby') Net.setStatus('lobby', 'In the online lobby'); return; }
    const pub = R.listed && !R.priv && !R.ranked ? R.code : null;
    if (G && G.play && !G.over) Net.setStatus('play', R.ranked ? 'Playing a ranked match' : 'Playing ' + MODE_TXT[R.rules.mode] + ' online', pub);
    else Net.setStatus('room', R.ranked ? 'Waiting for a ranked match' : 'In room "' + R.name + '"', pub);
  }

  /* ===================================================== joining, hosting, leaving */
  Online.create = async o => {
    if (N && N.room) Online.leave(true);
    if (!N) N = freshN();
    const S0 = N; N.stage = 'creating'; N.status = ''; draw();
    try { await loadPeer(); } catch (e) { if (N === S0) { N.stage = 'create'; N.status = e.message; draw(); } return; }
    if (N !== S0) return;
    const open = () => {
      const code = makeCode(), peer = new Peer(PREFIX + code, { debug: 0 }), S = N;
      N.peer = peer;
      peer.on('open', id => {
        if (N !== S || N.peer !== peer) return;
        Object.assign(N, { code, myId: id, host: true, pass: o.priv ? String(o.pass || '').slice(0, 16) : '', mem: new Map(), blocked: new Set(), stage: 'room', status: '' });
        N.room = newRoom(o, code, id);
        const me = meInfo();
        N.room.members.push({ id, uid: me.uid, name: me.name, r: me.r, lv: me.lv, ready: !!(o.ready || o.ranked || o.chal), sit: false, host: true });
        clearInterval(N.tickT); N.tickT = setInterval(hostTick, 250);
        Dir.host(code, listing);
        N.relay = Relay.host(code, link => { if (N === S) hostConn(link); });     // guests who can't link directly
        N.chat.push({ sys: 'Room open. Its code is ' + code + '.' });
        if (o.chal) sendChallenge(o.chal);
        setPresence(); show();
      });
      peer.on('connection', conn => { if (N !== S) return; hostConn(conn); });
      peer.on('error', e => {
        if (N !== S || N.peer !== peer) return;
        if (e.type === 'unavailable-id') { try { peer.destroy(); } catch (x) { /* fine */ } open(); return; }
        if (e.type === 'peer-unavailable') return;
        if (N.stage === 'creating') { N.stage = o.quick || o.ranked ? 'lobby' : 'create'; N.status = why(e); draw(); } else toast(why(e), 'bad');
      });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* fine */ } });
    };
    open();
  };
  Online.join = async (code, pass, o = {}) => {
    code = String(code || '').toUpperCase();
    if (N && N.room) { if (N.code === code) { show(); return; } Online.leave(true); }
    if (!N) N = freshN();
    if (Net.state === 'off') Net.start();
    const S0 = N; Object.assign(N, { stage: 'joining', host: false, code, status: '', needPass: null, passFor: null, passUsed: pass || '', quick: o.quick ? N.quick : null }); show();
    try { await loadPeer(); } catch (e) { if (N === S0) { N.stage = 'lobby'; N.status = e.message; show(); } return; }
    if (N !== S0) return;
    /* Two ways in: the direct link (PeerJS) and, if that hasn't opened after a few seconds (or fails), the
       relay over the lobby's brokers (relay.js). The first to open carries the room; the other is dropped. */
    const peer = new Peer({ debug: 0 }), S = N; N.peer = peer; N.tries = [];
    const relayOnly = U.read('wnf.relay', '') === 'always';                         // for testing the relay
    const fail = text => { if (N !== S || N.stage !== 'joining' || N.conn) return; if (N.quick) quickFailed(); else roomGone(text); };
    const adopt = link => {
      if (N !== S || N.conn) { if (N.conn !== link) { link.dropped = true; try { link.close(); } catch (e) { /* fine */ } } return; }
      N.conn = link; clearTimeout(N.relayT);
      for (const c of N.tries) if (c !== link) { c.dropped = true; try { c.close(); } catch (e) { /* fine */ } }
      link.on('data', d => { if (N === S) guestGot(d); });
      link.on('close', () => { if (N === S && !N.leaving) { if (N.quick && N.stage === 'joining') quickFailed(); else roomGone(N.stage === 'joining' ? 'Couldn\'t join room ' + code + '.' : 'Lost the connection to the room.'); } });
      link.send({ t: 'hello', ver: PROTO, me: meInfo(), pass: pass || '', ready: !!(o.ready || o.quick) });
    };
    const tryRelay = () => {
      if (N !== S || N.conn || S.relayTried) return; S.relayTried = true; clearTimeout(N.relayT);
      const link = Relay.join(code); N.tries.push(link);
      link.on('open', () => adopt(link));
      link.on('close', () => { if (!link.dropped && N === S && !N.conn) fail('No answer from room ' + code + '. It may have closed, or check the code.'); });
    };
    N.relayT = setTimeout(tryRelay, relayOnly ? 0 : o.quick ? 3000 : 4000);
    peer.on('open', () => {
      if (N !== S || relayOnly) return;
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json', metadata: { room: true } }); N.tries.push(conn);
      conn.on('open', () => adopt(conn));
      conn.on('close', () => { if (!conn.dropped && N === S && !N.conn) tryRelay(); });          // the direct link failed
      conn.on('error', () => {});
    });
    peer.on('error', e => {
      if (N !== S || N.peer !== peer || N.stage !== 'joining' || N.conn) return;
      if (e.type === 'peer-unavailable') fail(why(e));                          // no room with that code
      else tryRelay();
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* fine */ } });
    setTimeout(() => {                                                          // still not in: give up
      if (N !== S || N.stage !== 'joining') return;
      if (N.quick) quickFailed(); else roomGone('No answer from room ' + code + '. It may have closed, or check the code.');
    }, o.quick ? 14000 : 22000);
  };
  Online.leave = quiet => {
    if (!N) return;
    const S = N; N.leaving = true;
    if (G && G.play && !G.over && S.room && S.room.ranked) {                      // leaving a ranked match early: a loss
      const opp = Object.keys(G.names).find(id => id !== S.myId); if (opp) { const r = Rank.apply((G.rs && G.rs[opp]) || 1000, 0, G.names[opp]); toast('Left a ranked match: counted as a loss (' + r.d + ').', 'bad'); }
    }
    if (S.chal && S.room && S.room.chal) Net.send(S.chal.to, 'chalx', { code: S.code });
    if (S.host) { toAll({ t: 'closed' }); Dir.stopHost(); clearInterval(S.tickT); H = null; }
    const peer = S.peer; clearTimeout(S.relayT);
    setTimeout(() => {
      for (const c of new Set([S.conn, ...(S.tries || [])])) { try { if (c) { c.dropped = true; c.close(); } } catch (e) { /* fine */ } }
      try { if (S.relay) S.relay.stop(); } catch (e) { /* fine */ }
      try { if (peer) peer.destroy(); } catch (e) { /* fine */ }
    }, 250);
    N = null; G = null;
    if (!quiet) Online.open();
  };
  /* stepping away from the online screens (the hub etc.): a room stays open, a search is called off */
  Online.away = () => { if (N && !N.room && N.stage !== 'room') { if (N.peer) Online.leave(true); else N = null; } };
  Online.inRoom = () => !!(N && N.room);
  Online.roomInfo = () => N && N.room ? { name: N.room.name, code: N.room.code, playing: !!N.room.match } : null;

  /* ---- quick match and ranked match */
  async function waitForList() {
    if (Net.state === 'off') Net.start();
    const t0 = Date.now(); let upAt = null;
    while (Date.now() - t0 < 9000) {
      if (Net.state === 'down') return false;
      if (Net.state === 'up') { upAt = upAt || Date.now(); if (Date.now() - upAt > 1800) return true; }
      await U.sleep(200);
    }
    return Net.state === 'up';
  }
  async function findMatch(ranked) {
    if (N && N.room) Online.leave(true);
    N = freshN(); N.stage = 'quick'; N.quick = { ranked, tried: new Set() };
    const S0 = N; show();
    const ok = await waitForList();
    if (N !== S0) return;
    if (!ok) { N.quick = null; N.stage = 'lobby'; N.status = 'Couldn\'t reach the room list. Host a room and share its code instead.'; show(); return; }
    quickNext();
  }
  Online.quick = () => findMatch(false);
  Online.ranked = () => findMatch(true);
  function quickNext() {
    const Q = N.quick; if (!Q) return;
    const myR = Auth.S.rank.rating;
    const rooms = listedRooms().filter(r => !r.priv && r.n < r.max && !Q.tried.has(r.code) && r.hostId !== Auth.id && !Auth.S.blocked[r.hostId] && (Q.ranked ? r.ranked && r.state === 'open' : !r.ranked && (r.state === 'open' || r.state === 'playing')))
      .sort(Q.ranked ? (a, b) => Math.abs(a.rating - myR) - Math.abs(b.rating - myR) : (a, b) => (a.state === 'open' ? 0 : 1) - (b.state === 'open' ? 0 : 1) || b.n - a.n);
    if (!rooms.length) {
      N.quick = null;
      Online.create(Q.ranked ? { name: Auth.name + '\'s ranked match', ranked: true, listed: true, auto: true } : { name: (Auth.name + '\'s room').slice(0, 24), listed: true, max: ROOM_MAX, auto: true, ready: true, quick: true });
      toast(Q.ranked ? 'No one waiting: opened a ranked match. Hang on for an opponent.' : 'No open rooms: opened one. Waiting for players.');
      return;
    }
    Q.tried.add(rooms[0].code); Online.join(rooms[0].code, '', { quick: true });
  }
  function quickFailed() {
    const Q = N.quick, peer = N.peer; N.leaving = true; clearTimeout(N.relayT);
    for (const c of N.tries || []) { c.dropped = true; try { c.close(); } catch (e) { /* fine */ } }
    try { peer && peer.destroy(); } catch (e) { /* fine */ }
    N = freshN(); N.quick = Q; N.stage = 'quick'; show(); quickNext();
  }

  /* ---- challenges and invites (sent through the relay, encrypted) */
  Online.challenge = (id, o) => {
    const name = Net.nameOf(id);
    if (N && N.room) Online.leave(true);
    N = freshN();
    const rules = o.ranked ? RANKED_RULES : { mode: o.mode || 'race', len: o.mode === 'quad' ? 5 : o.len || 5, rounds: o.rounds || 3, time: 120, hard: false };
    Online.create({ name: (Auth.name + ' vs ' + name).slice(0, 24), priv: true, pass: U.rid(6), listed: false, max: 2, ranked: !!o.ranked, rules, auto: true, chal: { to: id, name } });
  };
  async function sendChallenge(ch) {
    const R = N.room; N.chal = ch;
    const desc = MODE_TXT[R.rules.mode] + ' · ' + R.rules.len + ' letters · ' + R.rules.rounds + ' round' + (R.rules.rounds > 1 ? 's' : '');
    const r = await Net.send(ch.to, 'chal', { code: R.code, pass: N.pass, ranked: R.ranked, desc }, true);
    if (r.err) { toast('Couldn\'t send the challenge: ' + r.err, 'bad'); Online.leave(); return; }
    toast('Challenge sent to ' + ch.name + '.');
  }
  Online.declined = m => {
    if (!N || !N.room || !N.chal || N.chal.to !== m.f || (m.b && m.b.code) !== N.code) return;
    toast(m.n + (m.b.busy ? ' is busy in a game right now.' : ' declined your challenge.'), 'bad');
    N.chal = null; N.room.chal = null; Online.leave();
  };
  Online.invite = id => {
    if (!N || !N.room) return;
    const R = N.room;
    Net.send(id, 'inv', { code: R.code, pass: N.host ? N.pass : N.passUsed, name: R.name }, true).then(r => toast(r.err ? 'Couldn\'t invite: ' + r.err : 'Invite sent to ' + Net.nameOf(id) + '.', r.err ? 'bad' : 'gold'));
  };

  /* ===================================================== a round on your screen */
  function onRound(d) {
    const R = N.room; if (!R) return;
    const now = performance.now();
    G = { mid: d.mid, r: d.r, rounds: d.rounds, mode: d.mode, len: d.len, max: d.max, boards: d.boards, hard: d.hard, play: !!d.play, ids: d.ids, names: d.names, uids: d.uids,
      rs: R.match ? R.match.rs : {}, scores: d.scores || {}, start: now + d.startIn, ends: d.dur ? now + Math.max(0, d.startIn) + d.dur : 0, prog: {}, pending: false, k: 0, over: false, phase: 'play' };
    for (const id of d.ids) G.prog[id] = { rows: Array.from({ length: d.boards }, () => []), k: 0, done: false, won: false, n: 0, pts: 0 };
    if (G.play || (N.autoWatch && N.view === 'room') || N.view === 'game') gameScreen();
    else draw();
    setPresence();
  }
  function onRes(d) {
    if (!G || d.mid !== G.mid || d.r !== G.r || !G.V) return;
    G.pending = false;
    const V = G.V;
    V.reveal(d.w, d.pats, () => {
      if (!G || G.mid !== d.mid) return;
      if (d.next) {          // blitz: on to the next word
        G.k++; if (d.pats[0] && Engine.solvedPat(d.pats[0])) { SFX.play('solve'); gnote('+1', 'good'); } else { V.answer([d.word]); gnote(d.word.toUpperCase(), 'bad'); }
        if (G.mineEl) G.mineEl.textContent = 'SOLVED ' + G.k + ' · ' + (d.pts || 0) + ' PTS';
        setTimeout(() => { if (G && G.mid === d.mid && G.phase === 'play') mountBoard(); }, d.pats[0] && Engine.solvedPat(d.pats[0]) ? 350 : 1100);
        return;
      }
      if (d.done) {
        G.myDone = true;
        if (d.won) { SFX.play('win'); gnote(Play.PRAISE[Math.max(1, d.mode === 'quad' ? 1 : V.data[0].rows.length)] || 'SOLVED!', 'big good'); }
        else { SFX.play('lose'); if (d.words) V.answer(d.words); gnote('Out of guesses', 'bad'); }
        if (G.waitEl) G.waitEl.hidden = false;
      }
    });
  }
  function onBad(d) { if (!G || d.mid !== G.mid || !G.V) return; G.pending = false; G.V.shake(); gnote(d.why); }
  function onProg(mid, r, id, p) {
    if (!G || mid !== G.mid || r !== G.r || !p) return;
    G.prog[id] = p; drawProg();
  }
  function onRend(d) {
    if (!G || d.mid !== G.mid) return;
    G.phase = 'gap'; G.scores = d.scores; G.lastRound = d.last;
    if (G.play) { const mine = d.res.find(x => x.id === N.myId); if (mine && mine.won && G.mode !== 'blitz') Rank.xp(15); if (mine && G.mode === 'blitz') Rank.xp(mine.k * 6); }
    if (document.querySelector('.screen.online.game')) roundOverlay(d);
    else draw();
  }
  function onMend(d) {
    if (!G || d.mid !== G.mid) { if (N && N.view === 'room') draw(); return; }
    const wasPlay = G.play; G.over = true; G.phase = 'over';
    let rk = null;
    const meI = d.st.findIndex(s => s.id === N.myId), me = d.st[meI];
    if (wasPlay && me) {
      const won = meI === 0 && (d.st.length < 2 || d.st[0].pts > d.st[1].pts || d.forfeit);
      const st = Auth.stat('online'); st.played++; if (won) { st.won++; st.streak++; st.maxStreak = Math.max(st.maxStreak, st.streak); } else st.streak = 0; Auth.save();
      if (d.ranked) {
        const opp = d.st.find(s => s.id !== N.myId);
        if (opp) {
          const result = d.forfeit ? 1 : me.pts > opp.pts ? 1 : me.pts < opp.pts ? 0 : 0.5;
          rk = Rank.apply(opp.r || 1000, result, opp.name);
        }
        Rank.xp(won ? 60 : 15);
      } else Rank.xp(won ? 40 : 15);
    }
    setPresence();
    matchOverlay(d, wasPlay ? me : null, rk);
  }

  /* ---- the game screen: your board, everyone's progress, the clock, the room chat */
  let tickT = null;
  function gameScreen() {
    const R = N.room; if (!R || !G) return;
    const { btn } = Menu.ui;
    G.noteEl = el('div', { class: 'gnotes' });
    G.clock = el('b', { class: 'gclock' }, '');
    G.bar = el('div', { class: 'timebar' }, el('i'));
    G.progEl = el('div', { class: 'progs' });
    G.stage = el('div', { class: 'gstage' });
    G.mineEl = el('small', { class: 'mine' }, '');
    G.waitEl = el('p', { class: 'gwait', hidden: true }, 'Done! Waiting for the others...');
    N.chatEl = el('div', { class: 'chatlog' });
    const sayBox = chatInput();
    const scr = el('div', { class: 'screen online game mode-' + G.mode + (R.ranked ? ' ranked' : '') },
      el('div', { class: 'topbar' }, el('button', { class: 'backbtn', title: 'Back to the room', onclick: () => { SFX.play('back'); N.view = 'room'; show(); } }, '‹'),
        el('h1', null, R.ranked ? 'RANKED' : MODE_TXT[G.mode].toUpperCase()), el('em', { class: 'pill' }, 'ROUND ' + G.r + ' / ' + G.rounds),
        G.hard ? el('em', { class: 'pill' }, 'HARD') : null, el('div', { class: 'grow' }), G.mineEl, G.clock),
      G.bar,
      el('div', { class: 'gwrap' },
        el('div', { class: 'gmain' }, G.noteEl, G.play ? G.stage : el('div', { class: 'spect' }, el('h2', null, 'WATCHING'), el('p', null, 'You\'re not in this match. Everyone\'s progress is on the right; the words show at the end of the round.')), G.waitEl),
        el('aside', { class: 'gside online' }, el('h3', null, 'PLAYERS'), G.progEl,
          el('div', { class: 'gchat' }, N.chatEl, sayBox))));
    App.screen(scr); N.view = 'game';
    App.onLeave(() => { if (N) N.view = null; clearInterval(tickT); });
    if (G.play) mountBoard();
    drawProg(); drawChat();
    clearInterval(tickT); tickT = setInterval(gameTick, 100); gameTick();
  }
  function mountBoard() {
    if (!G || !G.play) return;
    const V = new BoardView({ len: G.len, max: G.max, count: G.boards, onKey: k => gameKey(k) });
    G.V = V; G.stage.innerHTML = ''; G.stage.append(V.el, V.kb);
    App.keys = k => gameKey(k);
    if (G.mode === 'blitz' && G.mineEl) G.mineEl.textContent = 'SOLVED ' + G.k;
  }
  function gameKey(k) {
    if (!G || !G.V || G.phase !== 'play' || G.V.busy || G.pending || G.myDone) return;
    if (performance.now() < G.start) return;
    if (k === 'enter') {
      const w = G.V.value;
      if (w.length < G.len) { G.V.shake(); gnote('Not enough letters'); return; }
      if (!Engine.isWord(w)) { G.V.shake(); gnote('Not in word list'); return; }
      if (G.hard && G.boards === 1) { const e = Engine.hardError(w, G.V.data[0].rows); if (e) { G.V.shake(); gnote(e); return; } }
      G.pending = true; act({ t: 'g', mid: G.mid, r: G.r, w });
      setTimeout(() => { if (G && G.pending) G.pending = false; }, 4000);
    } else if (k === 'back') G.V.del(); else G.V.type(k);
  }
  function gameTick() {
    if (!G || !document.querySelector('.screen.online.game')) { clearInterval(tickT); return; }
    const now = performance.now();
    if (now < G.start) {
      const s = Math.ceil((G.start - now) / 1000);
      if (G.lastCd !== s) { G.lastCd = s; gnote(String(s), 'big count', 800); SFX.play('tick'); }
      G.clock.textContent = G.ends ? U.clock(G.ends - G.start) : '';
      return;
    }
    if (G.lastCd !== 0 && G.phase === 'play') { G.lastCd = 0; gnote('GO!', 'big good', 900); SFX.play('go'); }
    if (G.ends) {
      const left = G.ends - now; G.clock.textContent = U.clock(left);
      const total = G.ends - G.start; G.bar.firstChild.style.width = U.clamp(left / total * 100, 0, 100) + '%'; G.bar.classList.toggle('low', left < 15000);
      Music.urgent(G.phase === 'play' && left < 15000);
    } else G.clock.textContent = '';
  }
  function gnote(text, cls, ms) {
    if (!G || !G.noteEl) return;
    const n = el('div', { class: 'gnote ' + (cls || '') }, text); G.noteEl.append(n);
    setTimeout(() => n.classList.add('out'), ms || 1300); setTimeout(() => n.remove(), (ms || 1300) + 400);
  }
  function drawProg() {
    if (!G || !G.progEl || !document.body.contains(G.progEl)) return;
    G.progEl.innerHTML = '';
    const ids = G.ids.slice().sort((a, b) => (G.scores[b] || 0) - (G.scores[a] || 0));
    for (const id of ids) {
      const p = G.prog[id] || { rows: [[]], k: 0 }, me = id === N.myId, gone = !memberOf(id);
      const minis = G.mode === 'blitz' ? [BoardView.mini(G.len, G.max, (p.rows[0] || []), {})] : p.rows.map(rows => BoardView.mini(G.len, G.max, rows, { solved: rows.length && Engine.solvedPat(rows[rows.length - 1]) }));
      const state = gone ? 'LEFT' : G.mode === 'blitz' ? p.k + ' SOLVED' : p.done ? (p.won ? 'SOLVED IN ' + p.n : G.mode === 'quad' ? (p.k || 0) + '/4' : 'OUT') : (p.n ? p.n + ' GUESS' + (p.n > 1 ? 'ES' : '') : 'THINKING');
      G.progEl.append(el('div', { class: 'prog' + (me ? ' me' : '') + (p.won ? ' won' : '') + (gone ? ' gone' : '') },
        el('div', { class: 'proghead' }, Menu.avatar(G.uids[id], G.names[id], 'sm'), el('b', null, G.names[id] + (me ? ' (you)' : '')), el('span', { class: 'progpts' }, ((G.scores[id] || 0) + (G.mode === 'blitz' && G.phase === 'play' ? p.pts || 0 : 0)) + ' pts')),
        el('div', { class: 'progminis n' + minis.length }, ...minis), el('small', { class: 'progst' }, state)));
    }
  }
  function roundOverlay(d) {
    const rows = d.res.map((x, i) => el('div', { class: 'rrow' + (x.id === N.myId ? ' me' : '') },
      el('span', { class: 'rpos' }, i + 1), el('b', null, x.name), el('small', null, x.gone ? 'left' : G.mode === 'blitz' ? x.k + ' solved' : x.won ? 'solved in ' + x.n + ' · ' + (x.ms / 1000).toFixed(1) + 's' : G.mode === 'quad' ? x.k + '/4 boards' : 'didn\'t get it'),
      el('span', { class: 'rpts' }, '+' + x.pts), el('span', { class: 'rtot' }, (d.scores[x.id] || 0))));
    const mine = d.res.find(x => x.id === N.myId);
    const box = el('div', { class: 'roundover' },
      el('h2', null, 'ROUND ' + d.r + (d.last ? ' · FINAL' : '')),
      d.words ? el('div', { class: 'reswords' }, ...d.words.map(w => Menu.tiles(w.toUpperCase(), '2'.repeat(w.length), 'sm'))) : null,
      mine && mine.hist ? el('div', { class: 'wlist' }, ...mine.hist.map(h => el('span', { class: h.ok ? 'ok' : 'no' }, h.w.toUpperCase()))) : null,
      el('div', { class: 'rtable' }, ...rows),
      el('p', { class: 'small muted' }, d.last ? 'Final results in a moment...' : 'Next round in a moment...'));
    const scr = document.querySelector('.screen.online.game .gmain');
    if (scr) { scr.querySelectorAll('.roundover').forEach(x => x.remove()); scr.append(box); }
    Music.urgent(false); Music.duck(true);
    drawProg();
  }
  function matchOverlay(d, me, rk) {
    const { btn } = Menu.ui;
    if (!document.querySelector('.screen.online.game')) { if (N && N.view === 'room') draw(); if (me) toast(d.st[0].id === N.myId ? 'You won the match!' : d.st[0].name + ' won the match.'); return; }
    const won = me && d.st[0].id === N.myId;
    const body = [
      el('div', { class: 'rtable' }, ...d.st.map((s, i) => el('div', { class: 'rrow' + (s.id === N.myId ? ' me' : '') + (i === 0 ? ' first' : '') }, el('span', { class: 'rpos' }, i === 0 ? '★' : i + 1), el('b', null, s.name), el('small', null, s.here ? '' : 'left'), el('span', { class: 'rtot' }, s.pts + ' pts')))),
      d.forfeit ? el('p', { class: 'small muted' }, 'The match ended early: not enough players left.') : null,
      rk ? el('div', { class: 'rkchange ' + (rk.d >= 0 ? 'up' : 'down') }, Rank.badge(rk.after), el('b', null, (rk.d >= 0 ? '+' : '') + rk.d), el('small', null, rk.up ? 'PROMOTED to ' + Rank.label(rk.after) + '!' : rk.down ? 'Dropped to ' + Rank.label(rk.after) : rk.before + ' → ' + rk.after)) : null,
    ];
    SFX.play(won ? 'win' : 'lose');
    const m = Menu.modal({ title: me ? (won ? 'YOU WIN!' : d.st[0].name.toUpperCase() + ' WINS') : 'MATCH OVER', cls: 'results ' + (won ? 'won' : 'lost'), body, buttons: [['BACK TO THE ROOM', () => { if (N && N.room) { N.view = 'room'; show(); } }, 'big']], onClose: () => { if (N && N.room && document.querySelector('.screen.online.game')) { N.view = 'room'; show(); } } });
    G.closeOverlay = m.close;
  }

  /* ===================================================== chat (room) */
  function lineText(c) { return c.i != null ? QUICK[c.i] || '' : (Auth.prefs.filter ? U.unswear(c.text) : c.text); }
  const hidden = c => c.text != null && (Auth.prefs.mute || []).includes(c.uid) || (c.uid && Auth.S.blocked[c.uid]);
  function drawChat() {
    if (!N || !N.chatEl || !document.body.contains(N.chatEl)) return;
    N.chatEl.innerHTML = '';
    for (const c of N.chat.filter(x => !hidden(x)).slice(-40)) N.chatEl.append(c.sys ? el('div', { class: 'sys' }, c.sys) : el('div', { class: c.text != null ? 'typed' : 'quick' }, el('b', null, c.name + ': '), lineText(c)));
    N.chatEl.scrollTop = 1e6;
  }
  function chatInput() {
    const R = N.room, me = memberOf(N.myId) || {};
    const ok = R && R.chat !== 'quick' && !R.muted.includes(Auth.id);
    const box = el('input', { type: 'text', maxlength: 160, class: 'input', placeholder: ok ? 'Say something...' : R && R.chat === 'quick' ? 'Typed chat is off in this room' : 'The host muted your chat', disabled: !ok || null, value: N.draft || '', autocomplete: 'off', enterkeyhint: 'send', oninput: e => { N.draft = e.target.value; } });
    const send = () => { const t = U.clean(box.value, 160); if (!t) return; act({ t: 'say', text: t }); N.draft = ''; box.value = ''; };
    box.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    return el('div', { class: 'sayrow' }, box, el('button', { class: 'btn small', onclick: send }, el('span', null, 'SEND')));
  }

  /* ===================================================== the screens */
  function draw() {
    if (!N) return;
    if (N.view === 'game') return;
    if (N.view !== 'lobby' && N.view !== 'room') { hubBanner(); return; }
    const a = document.activeElement;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.closest('.screen.online') && a.closest('.keepfocus')) { N.dirty = true; return; }
    show();
  }
  function hubBanner() { const b = document.querySelector('.roombanner b'); const i = Online.roomInfo(); if (b && i) b.textContent = i.name + (i.playing ? ' · match on' : ''); }
  /* the right screen for the session: the lobby (with the create form or a search on), or the room */
  function show() {
    if (!N) return Online.open();
    if (N.stage === 'room' && N.room) return roomScreen();
    return lobbyScreen();
  }
  Online.open = () => {
    if (!Auth.user) return Menu.login();
    if (Net.state === 'off') Net.start();
    if (!N) N = freshN();
    show();
  };
  Online.back = () => { if (N && N.room && N.stage === 'room') { N.view = 'room'; show(); } else Online.open(); };

  function seg(label, val, opts, set, on) {
    return el('div', { class: 'seg' }, el('span', null, label), el('div', null, ...opts.map(([v, t]) => el('button', { class: String(val) === String(v) ? 'on' : '', disabled: on === false || null, onclick: () => { SFX.play('key'); set(v); } }, t))));
  }
  const rulesTxt = r => MODE_TXT[r.mode] + ' · ' + (r.mode === 'quad' ? '4×5' : r.len) + ' letters · ' + r.rounds + ' round' + (r.rounds > 1 ? 's' : '') + (r.mode !== 'blitz' && !r.time ? '' : ' · ' + (r.time || 120) + 's') + (r.hard ? ' · hard' : '');

  /* ---- THE LOBBY */
  function lobbyScreen() {
    const { btn, topbar } = Menu.ui;
    const busy = N.stage === 'joining' || N.stage === 'creating' || N.stage === 'quick';
    let play;
    if (busy) {
      play = [el('div', { class: 'olwait' }, el('div', { class: 'spinner' }),
        el('p', null, N.stage === 'quick' ? (N.quick && N.quick.ranked ? 'RANKED: finding an opponent near ' + Auth.S.rank.rating + '...' : 'QUICK MATCH: looking for an open room...') : N.stage === 'creating' ? 'Opening your room...' : 'Joining room ' + N.code + '...'),
        btn('CANCEL', () => { Online.leave(true); N = freshN(); show(); }, 'ghost'))];
    } else if (N.stage === 'create') {
      const f = N.form = N.form || { name: Auth.name + '\'s room', priv: false, pass: '', listed: true, max: ROOM_MAX, rules: Object.assign({}, DEFAULT_RULES) };
      const name = el('input', { type: 'text', maxlength: 24, class: 'input', value: f.name, oninput: e => { f.name = e.target.value; } });
      const pass = el('input', { type: 'text', maxlength: 16, class: 'input', value: f.pass, placeholder: 'password', autocomplete: 'off', oninput: e => { f.pass = e.target.value; } });
      const go = () => { if (f.priv && !f.pass.trim()) { N.status = 'A private room needs a password.'; show(); return; } Online.create({ name: f.name, priv: f.priv, pass: f.pass.trim(), listed: f.listed, max: f.max, rules: f.rules, auto: true }); };
      const r = f.rules;
      play = [el('h3', null, 'NEW ROOM'),
        el('label', { class: 'field keepfocus' }, el('span', null, 'ROOM NAME'), name),
        seg('TYPE', f.priv, [[false, 'Public'], [true, 'Private (password)']], v => { f.priv = v === true || v === 'true'; show(); }),
        f.priv ? el('label', { class: 'field keepfocus' }, el('span', null, 'PASSWORD'), pass) : null,
        seg('ROOM LIST', f.listed, [[true, 'Listed'], [false, 'Code only']], v => { f.listed = v === true || v === 'true'; show(); }),
        seg('PLAYERS', f.max, [2, 3, 4, 5, 6, 7, 8].map(n => [n, String(n)]), v => { f.max = +v; show(); }),
        seg('MODE', r.mode, [['race', 'Race'], ['blitz', 'Blitz'], ['quad', 'Quad']], v => { r.mode = v; if (v === 'quad') r.len = 5; show(); }),
        r.mode === 'quad' ? null : seg('LETTERS', r.len, Engine.LENS.map(n => [n, String(n)]), v => { r.len = +v; show(); }),
        seg('ROUNDS', r.rounds, [[1, '1'], [3, '3'], [5, '5'], [10, '10']], v => { r.rounds = +v; show(); }),
        seg(r.mode === 'blitz' ? 'ROUND LENGTH' : 'TIME LIMIT', r.time, (r.mode === 'blitz' ? [[60, '60 s'], [120, '2 min'], [180, '3 min']] : [[60, '60 s'], [120, '2 min'], [180, '3 min'], [0, 'None']]), v => { r.time = +v; show(); }),
        seg('HARD MODE', r.hard, [[false, 'Off'], [true, 'On']], v => { r.hard = v === true || v === 'true'; show(); }),
        el('div', { class: 'row' }, btn('CREATE ROOM', go, 'big'), btn('BACK', () => { N.stage = 'lobby'; N.status = ''; show(); }, 'ghost'))];
    } else {
      const code = el('input', { type: 'text', maxlength: 5, placeholder: 'CODE', class: 'input code', autocomplete: 'off', value: N.codeIn || '', oninput: e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); N.codeIn = e.target.value; } });
      const pass = N.needPass ? el('input', { type: 'password', maxlength: 16, placeholder: 'PASSWORD', class: 'input', autocomplete: 'off' }) : null;
      const join = () => { const c = code.value.trim().toUpperCase(); if (c.length !== 5) { N.status = 'Room codes are five letters and numbers.'; show(); return; } Online.join(c, pass ? pass.value : ''); };
      [code, pass].forEach(x => x && x.addEventListener('keydown', e => { if (e.key === 'Enter') join(); }));
      const R = Auth.S.rank;
      play = [
        el('div', { class: 'olbig' },
          btn('QUICK MATCH', () => Online.quick(), 'big wide', 'Into an open room, or open one'),
          btn('RANKED MATCH', () => Online.ranked(), 'big wide hot', Rank.label(R.rating) + ' · ' + R.rating)),
        el('div', { class: 'olrow' },
          el('div', { class: 'olbox' }, el('h3', null, 'HOST'), el('p', null, 'Your room, your rules.'), btn('HOST A ROOM', () => { N.stage = 'create'; N.status = ''; show(); }, '')),
          el('div', { class: 'olbox keepfocus' }, el('h3', null, 'JOIN BY CODE'), el('p', null, N.needPass ? 'Room ' + N.needPass + ' needs its password.' : 'Got a code?'), code, pass, btn('JOIN', join, ''))),
        el('div', { class: 'olrooms' }, el('div', { class: 'olhead' }, el('h3', null, 'ROOMS'), N.dirEl = el('small', null, '')), N.listEl = el('div', { class: 'ollist' }))];
    }
    N.chatEl = null;
    const lchat = el('div', { class: 'lchatlog' }), lbox = el('input', { type: 'text', class: 'input', maxlength: 160, placeholder: 'Say hi to the lobby...', autocomplete: 'off', enterkeyhint: 'send', value: N.lDraft || '', oninput: e => { N.lDraft = e.target.value; } });
    const lsend = () => { const r = Net.say(lbox.value); if (r.err) { toast(r.err, 'bad'); return; } lbox.value = ''; N.lDraft = ''; };
    lbox.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); lsend(); } });
    const pfilter = el('input', { type: 'text', class: 'input small', placeholder: 'Find a player', value: N.pq || '', oninput: e => { N.pq = e.target.value; fillPlayers(); } });
    const plist = el('div', { class: 'plist' }), pcount = el('small', null, '');
    const tabs = el('div', { class: 'tabs lobbytabs' }, ...[['play', 'PLAY'], ['chat', 'CHAT'], ['players', 'PLAYERS']].map(([k, t]) => el('button', { class: N.tab === k ? 'on' : '', onclick: () => { N.tab = k; show(); } }, t)));
    const scr = el('div', { class: 'screen online lobby tab-' + N.tab }, topbar('ONLINE LOBBY', () => { Online.away(); Menu.hub(); }),
      tabs,
      el('div', { class: 'lobbygrid' },
        el('section', { class: 'panel lcol lplay' }, ...play, N.status ? el('p', { class: 'olstatus' }, N.status) : null),
        el('section', { class: 'panel lcol lchat' }, el('div', { class: 'olhead' }, el('h3', null, 'LOBBY CHAT'), el('small', null, 'Everyone online')), lchat,
          Auth.prefs.typed ? el('div', { class: 'sayrow keepfocus' }, lbox, btn('SEND', lsend, 'small')) : el('p', { class: 'small muted' }, 'Lobby chat is hidden (Options).')),
        el('section', { class: 'panel lcol lplayers' }, el('div', { class: 'olhead' }, el('h3', null, 'PLAYERS'), pcount), el('div', { class: 'keepfocus' }, pfilter), plist)),
      el('p', { class: 'fine' }, 'Rooms link the players\' browsers directly (WebRTC via the free PeerJS service), so people in your room can see your IP address; where a direct link can\'t get through, the room runs over the public relays below instead, encrypted. The lobby, chat, friends and room list run on free public MQTT relays: names, ranks, statuses and lobby chat there are public.'));
    App.screen(scr); N.view = 'lobby'; setPresence();
    App.onLeave(() => { if (N) N.view = null; offs.forEach(f => f()); });
    const fillRooms = () => {
      if (!N || !N.listEl || !document.body.contains(N.listEl)) return;
      const rooms = listedRooms().sort((a, b) => (a.state === 'open' ? 0 : 1) - (b.state === 'open' ? 0 : 1) || b.n - a.n || a.name.localeCompare(b.name));
      N.dirEl.textContent = Net.state === 'up' ? rooms.length + (rooms.length === 1 ? ' room' : ' rooms') : Net.state === 'down' ? 'Can\'t reach the room list. You can still host and join by code.' : Net.state === 'off' ? 'Offline' : 'Looking for rooms...';
      N.listEl.innerHTML = '';
      if (!rooms.length) { N.listEl.append(el('p', { class: 'empty' }, Net.state === 'up' ? 'No rooms open right now. Host one!' : '')); return; }
      for (const r of rooms) {
        const cant = r.state === 'full' || r.state === 'locked', open = N.passFor === r.code;
        const pass = open ? el('input', { type: 'password', maxlength: 16, placeholder: 'PASSWORD', class: 'input rpass', autocomplete: 'off' }) : null;
        const go = () => { if (r.priv && !open) { N.passFor = r.code; fillRooms(); const i = N.listEl.querySelector('.rpass'); if (i) i.focus(); return; } Online.join(r.code, pass ? pass.value : ''); };
        if (pass) pass.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        N.listEl.append(el('div', { class: 'olroom' + (cant ? ' off' : '') + (r.ranked ? ' ranked' : '') },
          el('div', { class: 'olroomt' }, el('b', null, r.name), el('small', null, 'Host ' + r.host + ' · ' + (r.ranked ? 'RANKED 1v1 · ' + r.rating : MODE_TXT[r.mode] + ' · ' + r.len + ' letters · ' + r.rounds + ' rds'))),
          r.priv ? el('em', { class: 'pill' }, 'PRIVATE') : null,
          el('span', { class: 'olroomn' }, r.n + '/' + r.max),
          el('em', { class: 'pill st-' + r.state }, r.state.toUpperCase()),
          pass, btn(open ? 'GO' : 'JOIN', go, 'small' + (cant ? ' off' : ''))));
      }
    };
    const blockedU = id => Auth.S.blocked[id];
    const fillChat = () => {
      if (!document.body.contains(lchat)) return;
      lchat.innerHTML = '';
      if (!Auth.prefs.typed) return;
      const lines = Net.chat.filter(c => !blockedU(c.f) && !(Auth.prefs.mute || []).includes(c.f)).slice(-80);
      if (!lines.length) lchat.append(el('p', { class: 'empty' }, Net.state === 'up' ? 'It\'s quiet. Say hello!' : 'Connecting...'));
      for (const c of lines) lchat.append(el('div', { class: 'cline' + (c.f === Auth.id ? ' me' : '') },
        el('button', { class: 'cname', style: { '--h': Menu.hue(c.f) }, onclick: () => Social.card(c.f) }, c.n), el('span', null, Auth.prefs.filter ? U.unswear(c.x) : c.x), el('small', null, U.time(c.t))));
      lchat.scrollTop = 1e6;
    };
    const fillPlayers = () => {
      if (!N || !Auth.user || !document.body.contains(plist)) return;
      const q = (N.pq || '').trim().toLowerCase(), S = Auth.S;
      let ps = [...Net.players.values()].filter(p => !blockedU(p.id));
      pcount.textContent = Net.state === 'up' ? ps.length + ' online' : '';
      if (q) ps = ps.filter(p => p.n.toLowerCase().includes(q));
      ps.sort((a, b) => (b.id === Auth.id) - (a.id === Auth.id) || (S.friends[b.id] ? 1 : 0) - (S.friends[a.id] ? 1 : 0) || b.r - a.r);
      plist.innerHTML = '';
      if (!ps.length) plist.append(el('p', { class: 'empty' }, Net.state === 'up' ? 'Nobody matches.' : Net.state === 'down' ? 'Can\'t reach the relay.' : 'Connecting...'));
      for (const p of ps.slice(0, 120)) {
        const me = p.id === Auth.id, fr = S.friends[p.id];
        plist.append(el('div', { class: 'prow' + (me ? ' me' : '') + (fr ? ' friend' : '') },
          el('button', { class: 'fwho', onclick: () => Social.card(p.id) }, Menu.avatar(p.id, p.n, 'sm'),
            el('span', null, el('b', null, p.n, fr ? el('i', { class: 'frmark', title: 'Friend' }, '★') : null), el('small', null, me ? 'You' : p.x))),
          Rank.badge(p.r, { small: true, num: false }),
          me ? null : el('button', { class: 'btn small hot chalbtn', title: 'Challenge', onclick: () => Social.challenge(p.id) }, el('span', null, 'VS'))));
      }
    };
    const offs = [Net.on('rooms', fillRooms), Net.on('state', () => { fillRooms(); fillChat(); fillPlayers(); }), Net.on('chat', fillChat), Net.on('players', fillPlayers), Social.on('change', fillPlayers)];
    fillRooms(); fillChat(); fillPlayers();
    scr.addEventListener('focusout', () => setTimeout(() => { if (N && N.dirty && N.view === 'lobby') { N.dirty = false; show(); } }, 250));
  }

  /* ---- A ROOM */
  function roomScreen() {
    const { btn, topbar } = Menu.ui;
    const R = N.room, host = N.host, me = memberOf(N.myId) || {};
    const M = R.match, inMatch = M && M.ids.includes(N.myId);
    let now;
    if (R.chal) now = [el('b', null, 'CHALLENGE SENT'), el('small', null, 'Waiting for ' + R.chal.name + ' to accept...')];
    else if (M) now = [el('b', null, (M.state === 'over' ? 'MATCH OVER' : 'MATCH ON · ROUND ' + M.round + ' / ' + M.rounds)), el('small', null, M.ids.map(id => (memberOf(id) || {}).name || '?').join(' · ')),
      G && G.mid === M.mid ? btn(inMatch ? 'BACK TO THE GAME' : 'WATCH', () => gameScreen(), 'big' + (inMatch ? ' hot' : '')) : el('small', null, 'You\'ll be in the next one.')];
    else {
      const E = eligible(), waiting = E.filter(m => !m.ready).map(m => m.name);
      now = E.length < 2 ? [el('b', null, R.ranked ? 'WAITING FOR AN OPPONENT' : 'WAITING FOR PLAYERS'), el('small', null, R.ranked ? 'Ranked matches are 1v1. Someone pressing RANKED MATCH near your rating will land here.' : 'A match needs two players who aren\'t sitting out. Share the code: ' + R.code)]
        : [el('b', null, R.cd != null ? 'STARTING IN ' + R.cd + '...' : waiting.length ? 'WAITING FOR READY' : 'EVERYONE\'S READY'),
          el('small', null, waiting.length ? 'Waiting for ' + waiting.join(', ') + ' to press READY.' : R.auto ? 'Starting...' : host ? 'Press START when you like.' : 'Waiting for the host to start.'),
          host && !R.auto ? btn('START', () => HC.start(), 'big hot' + (waiting.length ? ' off' : '')) : null];
    }
    const card = m => {
      const tags = [];
      if (m.host) tags.push(['HOST', 'h']); if (m.id === N.myId) tags.push(['YOU', 'y']);
      if (M && M.ids.includes(m.id)) tags.push(['PLAYING', 'p']); else if (m.sit) tags.push(['SITTING OUT', 's']);
      if (m.ready && !M) tags.push(['READY', 'r']);
      if (R.muted.includes(m.uid)) tags.push(['MUTED', 's']);
      const can = host && m.id !== N.myId;
      return el('div', { class: 'olmem' + (m.ready ? ' ready' : '') },
        el('button', { class: 'fwho', onclick: () => Social.card(m.uid) }, Menu.avatar(m.uid, m.name), el('span', null, el('b', null, m.name, el('small', null, ' ' + tagOf(m.uid))), el('span', { class: 'row' }, Rank.badge(m.r, { small: true }), el('span', { class: 'lvchip' }, 'LV ' + m.lv)))),
        el('div', { class: 'tags' }, ...tags.map(([t, c]) => el('em', { class: 'mtag t' + c }, t))),
        can ? el('div', { class: 'macts' }, el('button', { onclick: () => HC.mute(m.id) }, R.muted.includes(m.uid) ? 'UNMUTE' : 'MUTE'), R.ranked && M ? null : el('button', { onclick: () => HC.kick(m.id, false) }, 'KICK'), R.ranked && M ? null : el('button', { onclick: () => HC.kick(m.id, true) }, 'BLOCK')) : null);
    };
    const empties = Array.from({ length: Math.max(0, R.max - R.members.length) }, () => el('div', { class: 'olmem empty' }, el('small', null, 'Open seat')));
    const rules = R.rules, canRule = host && !R.ranked && !M;
    const hostName = el('input', { type: 'text', maxlength: 24, class: 'input', value: R.name });
    const hostPass = el('input', { type: 'text', maxlength: 16, class: 'input', value: host ? N.pass || '' : '', placeholder: 'password', autocomplete: 'off' });
    N.chatEl = el('div', { class: 'chatlog' });
    const sendQuick = i => act({ t: 'chat', i });
    const scr = el('div', { class: 'screen online room' }, topbar(R.ranked ? 'RANKED MATCH' : 'ROOM', () => confirmLeave()),
      el('div', { class: 'roomgrid' },
        el('section', { class: 'panel rmain' },
          el('div', { class: 'rhead' },
            el('div', null, el('h2', null, R.name), el('div', { class: 'badges' }, R.ranked ? el('em', { class: 'pill hot' }, 'RANKED') : null, el('em', { class: 'pill' }, R.priv ? 'PRIVATE' : 'PUBLIC'), R.listed ? null : el('em', { class: 'pill' }, 'CODE ONLY'), R.locked ? el('em', { class: 'pill' }, 'LOCKED') : null, el('span', null, R.members.length + '/' + R.max + ' players'))),
            el('div', { class: 'codebox' }, el('small', null, 'ROOM CODE'), el('b', null, R.code), btn('COPY', () => { try { navigator.clipboard.writeText(R.code); toast('Copied ' + R.code + (R.priv ? ' (they\'ll need the password too)' : '')); } catch (e) { /* fine */ } }, 'ghost small'))),
          el('div', { class: 'rnow' + (M ? ' live' : '') }, ...now),
          R.last && !M ? el('p', { class: 'rlast' }, 'Last match: ' + R.last.names.map((n, i) => n + ' ' + R.last.pts[i]).join(' · ')) : null,
          el('div', { class: 'members' }, ...R.members.map(card), ...empties),
          el('div', { class: 'mine' },
            btn(me.ready ? 'READY ✓' : 'READY', () => act({ t: 'ready', on: !me.ready }), 'big' + (me.ready ? ' on' : '') + (inMatch || me.sit ? ' off' : '')),
            R.ranked ? null : btn(me.sit ? 'SITTING OUT' : 'SIT OUT', () => act({ t: 'sit', on: !me.sit }), 'ghost' + (me.sit ? ' on' : '') + (inMatch ? ' off' : '')),
            el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: N.autoWatch || null, onchange: e => { N.autoWatch = e.target.checked; } }), 'Watch matches I\'m not in'),
            Object.keys(Auth.S.friends).some(id => Net.online(id)) ? btn('INVITE FRIENDS', () => inviteMenu(), 'ghost') : null),
          el('div', { class: 'rset' }, el('h3', null, 'RULES' + (R.ranked ? ' (ranked: fixed)' : host ? '' : ' (the host sets these)')),
            seg('MODE', rules.mode, [['race', 'Race'], ['blitz', 'Blitz'], ['quad', 'Quad']], v => HC.rule('mode', v), canRule),
            rules.mode === 'quad' ? null : seg('LETTERS', rules.len, Engine.LENS.map(n => [n, String(n)]), v => HC.rule('len', +v), canRule),
            seg('ROUNDS', rules.rounds, [[1, '1'], [3, '3'], [5, '5'], [10, '10']], v => HC.rule('rounds', +v), canRule),
            seg(rules.mode === 'blitz' ? 'ROUND LENGTH' : 'TIME LIMIT', rules.time, rules.mode === 'blitz' ? [[60, '60 s'], [120, '2 min'], [180, '3 min']] : [[60, '60 s'], [120, '2 min'], [180, '3 min'], [0, 'None']], v => HC.rule('time', +v), canRule),
            seg('HARD MODE', rules.hard, [[false, 'Off'], [true, 'On']], v => HC.rule('hard', v === true || v === 'true'), canRule),
            el('p', { class: 'small muted' }, rules.mode === 'race' ? 'RACE: everyone gets the same word. Solve it: 100, +20 for each guess you didn\'t need, +60/40/20 for 1st/2nd/3rd to solve.' : rules.mode === 'blitz' ? 'BLITZ: the same run of words for everyone; solve as many as you can before time. 50 a word, +10 for each guess you didn\'t need.' : 'QUAD: four words, nine guesses. 50 a board; finish all four for the race bonus.')),
          host ? el('div', { class: 'rset' }, el('h3', null, 'ROOM'),
            el('label', { class: 'field keepfocus' }, el('span', null, 'NAME'), hostName, btn('SAVE', () => HC.set('name', hostName.value), 'ghost small')),
            R.ranked ? null : seg('TYPE', R.priv, [[false, 'Public'], [true, 'Private']], v => { const on = v === true || v === 'true'; if (on && !(N.pass || hostPass.value.trim())) { toast('Type a password first, then press SAVE.', 'bad'); return; } HC.set('priv', { on, pass: on ? N.pass || hostPass.value.trim() : '' }); }),
            R.ranked ? null : el('label', { class: 'field keepfocus' }, el('span', null, 'PASSWORD'), hostPass, btn(R.priv ? 'SAVE' : 'MAKE PRIVATE', () => { const p = hostPass.value.trim(); if (!p) { toast('Type a password first.', 'bad'); return; } HC.set('priv', { on: true, pass: p }); toast('Password set.'); }, 'ghost small')),
            seg('ROOM LIST', R.listed, [[true, 'Listed'], [false, 'Code only']], v => HC.set('listed', v === true || v === 'true')),
            seg('NEW PLAYERS', R.locked, [[false, 'Let them in'], [true, 'Locked']], v => HC.set('locked', v === true || v === 'true')),
            seg('CHAT', R.chat, [['on', 'Typed + quick'], ['quick', 'Quick only']], v => HC.set('chat', v)),
            R.ranked ? null : seg('ROOM SIZE', R.max, [2, 3, 4, 5, 6, 7, 8].map(n => [n, String(n)]), v => HC.set('max', +v)),
            seg('AUTO-START', R.auto, [[true, 'On (5 s after all ready)'], [false, 'Off (I start)']], v => HC.set('auto', v === true || v === 'true'))) : null,
          el('div', { class: 'row' }, btn(host ? 'CLOSE THE ROOM' : 'LEAVE THE ROOM', () => confirmLeave(), 'ghost danger'))),
        el('section', { class: 'panel rchat' }, el('h3', null, 'ROOM CHAT'), N.chatEl, el('div', { class: 'keepfocus' }, chatInput()),
          el('div', { class: 'quickchat' }, ...QUICK.map((t, i) => el('button', { onclick: () => sendQuick(i) }, t))),
          el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: Auth.prefs.filter || null, onchange: e => { Auth.prefs.filter = e.target.checked; Auth.save(); drawChat(); } }), 'Filter swear words'))));
    App.screen(scr); N.view = 'room'; setPresence();
    App.onLeave(() => { if (N) N.view = null; });
    drawChat();
    scr.addEventListener('focusout', () => setTimeout(() => { if (N && N.dirty && N.view === 'room') { N.dirty = false; show(); } }, 250));
  }
  function confirmLeave() {
    const R = N && N.room; if (!R) return Online.open();
    if (R.match && G && G.play && !G.over) {
      Menu.modal({ title: 'LEAVE MID-MATCH?', body: [el('p', null, R.ranked ? 'Leaving a ranked match counts as a loss.' : 'The match goes on without you.')], buttons: [['LEAVE', () => Online.leave(), 'danger'], ['STAY', () => {}, 'ghost']] });
      return;
    }
    if (N.host && R.members.length > 1) {
      Menu.modal({ title: 'CLOSE THE ROOM?', body: [el('p', null, 'Everyone in it goes back to the lobby.')], buttons: [['CLOSE IT', () => Online.leave(), 'danger'], ['STAY', () => {}, 'ghost']] });
      return;
    }
    Online.leave();
  }
  function inviteMenu() {
    const S = Auth.S, ids = Object.keys(S.friends).filter(id => Net.online(id));
    Menu.modal({ title: 'INVITE FRIENDS', body: [el('div', { class: 'flist' }, ...ids.map(id => el('div', { class: 'frow on' },
      el('span', { class: 'fwho' }, Menu.avatar(id, S.friends[id].n), el('span', null, el('b', null, S.friends[id].n), el('small', null, Net.online(id).x))),
      Menu.ui.btn('INVITE', e => { Online.invite(id); e.currentTarget.classList.add('off'); }, 'small'))))] });
  }

  Online.view = () => N && N.view;
  Online._t = { PROTO, get N() { return N; }, get G() { return G; }, get H() { return H; }, HC };
})();
