/* ============================================================================
   net.js -- THE RELAY: everything social, over two free public MQTT brokers
   (the same ones Knock//Back's room list uses; no account, no server of ours).

   While you're signed in (and ONLINE is on in Options) your game keeps a
   connection to both brokers and posts, always signed with your key (auth.js):
     pres/<id>   PRESENCE: you're online, what you're doing, your room if it's
                 public. Retained, refreshed every 25 s, and wiped by the broker
                 the moment your browser goes away (its "last will").
     prof/<id>   PROFILE: name, rating, record, level, your public keys. Kept
                 on the broker: it's how the leaderboard, friend search and
                 "last seen" work, and how others encrypt messages to you.
     chat/<id>   LOBBY CHAT: your last few lines (two hours at most). Kept, so
                 someone arriving sees the conversation so far.
     in/<id>/... YOUR INBOX: friend requests, messages (encrypted to you),
                 challenges and invites. Kept until your game reads them, then
                 cleared: a message to someone offline waits for them (as long
                 as the free broker keeps it).
     rooms/<code> the ROOM LIST (online.js, as in Knock//Back).
   Anything that isn't validly signed, or claims to be from someone it isn't,
   is dropped. Public brokers can be read by anyone: names, ratings, statuses
   and lobby chat are public; messages, challenges and invites are not.

     Net.start() stop()  Net.state 'off' | 'connecting' | 'up' | 'down'
     Net.players (online now)  Net.profiles (everyone seen)  Net.rooms  Net.chat
     Net.on(type, fn): 'state' 'players' 'profiles' 'chat' 'rooms' 'inbox'
     Net.setStatus(act, text, room)  Net.say(text)  Net.send(to, kind, body, enc)
   ========================================================================== */
(function () {
  'use strict';
  const PRE = 'wordle-n-friends/1/';
  const MQTT_JS = ['https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js', 'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js'];
  const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
  const subtle = window.crypto && crypto.subtle;
  const te = new TextEncoder(), td = new TextDecoder();
  const PRES_EVERY = 25000, PRES_STALE = 80000, CHAT_KEEP = 2 * 3600e3, CHAT_MAX = 160;
  const MAX_PLAYERS = 600, MAX_PROFILES = 5000;

  function loadScript(urls, ok) {
    return new Promise((res, rej) => {
      if (ok()) return res();
      let i = 0;
      const next = () => {
        if (i >= urls.length) return rej(new Error('Couldn\'t load the online library. Check your internet connection.'));
        const s = document.createElement('script'); s.src = urls[i++]; s.async = true;
        s.onload = () => (ok() ? res() : next()); s.onerror = next; document.head.append(s);
      };
      next();
    });
  }

  /* ------------------------------------------------------ signing and sealing */
  const vkeys = new Map(), idCache = new Map(), shared = new Map(), goodSig = new Set();
  const jwk = p => ({ kty: 'EC', crv: 'P-256', x: p[0], y: p[1], ext: true });
  const okPk = p => Array.isArray(p) && p.length === 2 && p.every(x => typeof x === 'string' && /^[\w-]{40,48}$/.test(x));
  const vkey = spk => { const k = spk.join('.'); if (!vkeys.has(k)) vkeys.set(k, subtle.importKey('jwk', jwk(spk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])); return vkeys.get(k); };
  const idFor = spk => { const k = spk.join('.'); if (!idCache.has(k)) idCache.set(k, Auth.idOf(spk)); return idCache.get(k); };
  const sigData = e => te.encode(JSON.stringify([e.k, e.i || '', e.f, e.n, e.spk, e.epk || null, e.to || '', e.t, e.b === undefined ? null : e.b, e.e || null]));
  async function aesFor(epk) {
    const K = await Auth.keys(), k = K.id + '>' + epk.join('.');
    if (!shared.has(k)) shared.set(k, (async () => {
      const pub = await subtle.importKey('jwk', jwk(epk), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      return subtle.deriveKey({ name: 'ECDH', public: pub }, K.ecdh, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    })());
    return shared.get(k);
  }
  async function encrypt(body, epk) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, await aesFor(epk), te.encode(JSON.stringify(body)));
    return { iv: U.b64(iv), ct: U.b64(ct) };
  }
  async function decrypt(e) {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: U.unb64(e.e.iv) }, await aesFor(e.epk), U.unb64(e.e.ct));
    return JSON.parse(td.decode(pt));
  }
  /* an envelope: kind, sender (id, name, signing key), time, body (or ciphertext), signature */
  async function seal(k, body, o = {}) {
    const K = await Auth.keys();
    const e = { k, f: K.id, n: Auth.name, spk: K.spk, t: Date.now() };
    if (o.i) e.i = o.i; if (o.to) e.to = o.to;
    if (o.epk || o.encTo) e.epk = K.epk;
    if (o.encTo) e.e = await encrypt(body, o.encTo); else e.b = body;
    e.s = U.b64(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, K.sign, sigData(e)));
    return e;
  }
  async function unseal(e) {
    if (!e || typeof e !== 'object' || typeof e.k !== 'string' || typeof e.f !== 'string' || typeof e.n !== 'string' || typeof e.t !== 'number' || typeof e.s !== 'string' || !okPk(e.spk)) return null;
    if (e.epk != null && !okPk(e.epk)) return null;
    if (!goodSig.has(e.s)) {
      try {
        if (await idFor(e.spk) !== e.f) return null;
        if (!await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await vkey(e.spk), U.unb64(e.s), sigData(e))) return null;
      } catch (x) { return null; }
      goodSig.add(e.s); if (goodSig.size > 4000) goodSig.clear();
    }
    e.n = U.clean(e.n, 16) || 'Player';
    return e;
  }

  /* ------------------------------------------------------------- the client */
  const Net = window.Net = Object.assign(U.hub(), {
    PRE, BROKERS, state: 'off', me: null, clients: null, players: new Map(), profiles: new Map(), rooms: new Map(), chat: [],
    status: { a: 'menu', x: 'In the menus', rm: null },
    loadMqtt: () => loadScript(MQTT_JS, () => !!window.mqtt),
    loadScript,
  });
  let session = null, timers = [], outbox = [], presT = null, emitT = {};
  const later = (type, ms) => { if (emitT[type]) return; emitT[type] = setTimeout(() => { emitT[type] = null; Net.emit(type); }, ms); };
  const setState = s => { if (Net.state !== s) { Net.state = s; Net.emit('state'); } };
  const anyUp = () => (Net.clients || []).some(c => c.connected);
  function pub(topic, payload, o = {}) {
    let n = 0;
    for (const c of Net.clients || []) if (c.connected) { try { c.publish(topic, payload, { retain: !!o.retain, qos: o.qos || 0 }); n++; } catch (e) { /* fine */ } }
    return n > 0;
  }

  Net.start = async () => {
    if (!Auth.user || Net.clients) return;
    if (!subtle) { setState('down'); return; }
    const S0 = session = {}; Net.clients = []; setState('connecting');
    try { await Net.loadMqtt(); } catch (e) { if (session === S0) { Net.clients = null; setState('down'); } return; }
    const K = await Auth.keys();
    if (session !== S0 || !Auth.user || K.id !== Auth.id) return;
    Net.me = K.id;
    Net.clients = BROKERS.map(url => {
      const c = mqtt.connect(url, { clientId: 'wnf_' + U.rid(10), keepalive: 30, reconnectPeriod: 5000, connectTimeout: 8000, clean: true,
        will: { topic: PRE + 'pres/' + K.id, payload: '', retain: true, qos: 0 } });
      c.on('connect', () => {
        if (session !== S0) return;
        c.subscribe({ [PRE + 'pres/+']: { qos: 0 }, [PRE + 'prof/+']: { qos: 0 }, [PRE + 'chat/+']: { qos: 0 }, [PRE + 'rooms/+']: { qos: 0 }, [PRE + 'in/' + K.id + '/+']: { qos: 1 } });
        setState('up');
        presence(); Net.profile(); pushChat();
        const q = outbox; outbox = []; for (const f of q) f();
      });
      c.on('message', (t, m, p) => { if (session === S0) got(t, m, p); });
      c.on('close', () => { if (session === S0 && !anyUp() && Net.state === 'up') setState('connecting'); });
      c.on('error', () => {});
      return c;
    });
    timers = [setInterval(presence, PRES_EVERY), setInterval(() => Net.profile(), 5 * 60e3), setInterval(prune, 5000)];
    setTimeout(() => { if (session === S0 && Net.state === 'connecting') setState('down'); }, 12000);
    // leaving the page: wipe the presence note now rather than when the broker notices
    window.addEventListener('pagehide', bye);
  };
  function bye() { if (Net.me) pub(PRE + 'pres/' + Net.me, '', { retain: true }); }
  Net.stop = () => {
    if (!Net.clients) return;
    bye(); window.removeEventListener('pagehide', bye);
    const cl = Net.clients; Net.clients = null; session = null;
    timers.forEach(clearInterval); timers = []; outbox = [];
    setTimeout(() => cl.forEach(c => { try { c.end(true); } catch (e) { /* fine */ } }), 400);
    Net.players.clear(); Net.chat = []; Net.rooms.clear(); shared.clear(); Net.me = null;
    setState('off'); Net.emit('players'); Net.emit('chat'); Net.emit('rooms');
  };
  Net.retry = () => { Net.stop(); Net.start(); };

  /* ------------------------------------------------------------- receiving */
  async function got(topic, msg, packet) {
    if (!topic.startsWith(PRE)) return;
    const parts = topic.slice(PRE.length).split('/'), kind = parts[0], who = parts[1];
    const s = td.decode(msg);
    if (kind === 'rooms') return gotRoom(who, s);
    if (!s) { if (kind === 'pres' && Net.players.delete(who)) Net.emit('players'); return; }
    let e; try { e = JSON.parse(s); } catch (x) { return; }
    if (kind === 'in') { if (who === Net.me) gotInbox(e, topic); return; }
    e = await unseal(e); if (!e || e.f !== who) return;
    if (kind === 'pres' && e.k === 'pres') gotPres(e);
    else if (kind === 'prof' && e.k === 'prof') gotProf(e);
    else if (kind === 'chat' && e.k === 'chat') gotChat(e);
  }
  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
  function gotPres(e) {
    const age = Date.now() - e.t; if (age > PRES_STALE || age < -300e3) return;
    const b = e.b || {}, old = Net.players.get(e.f);
    if (old && old.t > e.t) return;
    if (!old && Net.players.size >= MAX_PLAYERS) return;
    Net.players.set(e.f, { id: e.f, n: e.n, t: e.t, seen: Date.now(), a: String(b.a || 'menu').slice(0, 12), x: U.clean(b.x, 48), rm: /^[A-Z0-9]{5}$/.test(b.rm || '') ? b.rm : null,
      r: Math.round(num(b.r, 1000)), lv: num(b.lv, 1) | 0, epk: okPk(e.epk) ? e.epk : old && old.epk, spk: e.spk });
    later('players', 150);
  }
  function gotProf(e) {
    const b = e.b || {}, old = Net.profiles.get(e.f);
    if (old && old.t >= e.t) return;
    if (!old && Net.profiles.size >= MAX_PROFILES) return;
    Net.profiles.set(e.f, { id: e.f, n: e.n, t: e.t, r: Math.round(num(b.r, 1000)), w: num(b.w) | 0, l: num(b.l) | 0, d: num(b.d) | 0, g: num(b.g) | 0, pk: Math.round(num(b.pk, 1000)), lv: num(b.lv, 1) | 0,
      epk: okPk(e.epk) ? e.epk : null, spk: e.spk });
    later('profiles', 250);
  }
  const chatSeen = new Set();
  function gotChat(e) {
    const m = e.b && Array.isArray(e.b.m) ? e.b.m.slice(-8) : [];
    let ch = false;
    for (const x of m) {
      if (!x || typeof x.i !== 'string' || typeof x.t !== 'number' || chatSeen.has(x.i) || Date.now() - x.t > CHAT_KEEP || x.t > e.t + 1000) continue;
      const text = U.clean(x.x, CHAT_MAX); if (!text) continue;
      chatSeen.add(x.i); Net.chat.push({ i: x.i, f: e.f, n: e.n, x: text, t: x.t }); ch = true;
    }
    if (ch) { Net.chat.sort((a, b) => a.t - b.t); if (Net.chat.length > 150) Net.chat.splice(0, Net.chat.length - 150); later('chat', 60); }
  }
  /* the inbox: checked, opened, handed on once, then cleared from the broker */
  const inboxSeen = new Set();
  async function gotInbox(raw, topic) {
    pub(topic, '', { retain: true, qos: 1 });      // read: clear it from both brokers (a live delivery of a kept message is kept too)
    const e = await unseal(raw); if (!e || e.to !== Net.me || typeof e.i !== 'string') return;
    const S = Auth.S; if (!S) return;
    if (inboxSeen.has(e.i) || S.seen.includes(e.i)) return;
    inboxSeen.add(e.i); S.seen.push(e.i); if (S.seen.length > 400) S.seen.splice(0, S.seen.length - 400);
    if (Date.now() - e.t > 30 * 86400e3) return;
    if (S.blocked[e.f]) { Auth.save(); return; }
    let body = e.b;
    if (e.e) { if (!e.epk) return; try { body = await decrypt(e); } catch (x) { return; } }
    Auth.save();
    Net.emit('inbox', { k: e.k, i: e.i, f: e.f, n: e.n, t: e.t, spk: e.spk, epk: e.epk || null, b: body || {} });
  }
  function gotRoom(code, s) {
    if (!/^[A-Z0-9]{5}$/.test(code)) return;
    if (!s) { if (Net.rooms.delete(code)) Net.emit('rooms'); return; }
    let r; try { r = JSON.parse(s); } catch (e) { return; }
    if (!r || typeof r !== 'object' || typeof r.name !== 'string' || typeof r.host !== 'string') return;
    if (!(Math.abs(Date.now() - num(r.ts)) < 45000)) return;
    const old = Net.rooms.get(code); if (old && old.ts > r.ts) return;
    Net.rooms.set(code, { code, v: r.v, name: U.clean(r.name, 24), host: U.clean(r.host, 16), hostId: String(r.hostId || '').slice(0, 16), n: num(r.n) | 0, max: num(r.max) | 0, priv: !!r.priv,
      state: ['open', 'full', 'playing', 'locked'].includes(r.state) ? r.state : 'open', mode: String(r.mode || 'race').slice(0, 8), len: num(r.len, 5) | 0, rounds: num(r.rounds, 3) | 0,
      ranked: !!r.ranked, rating: Math.round(num(r.rating, 1000)), ts: r.ts, seen: Date.now() });
    later('rooms', 100);
  }
  function prune() {
    const now = Date.now(); let p = false, r = false;
    for (const [k, v] of Net.players) if (k !== Net.me && now - v.seen > PRES_STALE) { Net.players.delete(k); p = true; }
    for (const [k, v] of Net.rooms) if (now - v.seen > 35000) { Net.rooms.delete(k); r = true; }
    const n0 = Net.chat.length; Net.chat = Net.chat.filter(c => now - c.t < CHAT_KEEP);
    if (p) Net.emit('players'); if (r) Net.emit('rooms'); if (n0 !== Net.chat.length) Net.emit('chat');
  }

  /* ------------------------------------------------------------- posting */
  async function presence() {
    if (!Net.clients || !Auth.user) return;
    const S = Auth.S, K = await Auth.keys(), st = Net.status;
    const e = await seal('pres', { a: st.a, x: st.x, rm: st.rm || null, r: S.rank.rating, lv: Rank.level(S.xp).lv }, { epk: true });
    pub(PRE + 'pres/' + K.id, JSON.stringify(e), { retain: true });
    Net.players.set(K.id, { id: K.id, n: Auth.name, t: e.t, seen: Date.now(), a: st.a, x: st.x, rm: st.rm, r: S.rank.rating, lv: Rank.level(S.xp).lv, epk: K.epk, spk: K.spk });
    Net.emit('players');
  }
  Net.setStatus = (a, x, rm) => {
    const st = { a, x: String(x || ''), rm: rm || null };
    if (JSON.stringify(st) === JSON.stringify(Net.status)) return;
    Net.status = st; clearTimeout(presT); presT = setTimeout(presence, 400);
  };
  Net.myProfile = () => { const S = Auth.S, R = S.rank; return { id: Auth.id, n: Auth.name, t: Date.now(), r: R.rating, w: R.wins, l: R.losses, d: R.draws, g: R.games, pk: R.peak, lv: Rank.level(S.xp).lv }; };
  Net.profile = async () => {
    if (!Net.clients || !Auth.user || !anyUp()) return;
    const p = Net.myProfile(), e = await seal('prof', { r: p.r, w: p.w, l: p.l, d: p.d, g: p.g, pk: p.pk, lv: p.lv }, { epk: true });
    pub(PRE + 'prof/' + Auth.id, JSON.stringify(e), { retain: true });
    const K = await Auth.keys(); Net.profiles.set(Auth.id, Object.assign(p, { epk: K.epk, spk: K.spk })); later('profiles', 100);
  };
  /* lobby chat: your last lines, re-posted whole each time (kept, so newcomers see them) */
  let myLines = [], sayTimes = [];
  async function pushChat() {
    if (!Auth.user) return;
    myLines = myLines.filter(m => Date.now() - m.t < CHAT_KEEP).slice(-5);
    if (!myLines.length) return;
    const e = await seal('chat', { m: myLines });
    pub(PRE + 'chat/' + Auth.id, JSON.stringify(e), { retain: true });
  }
  Net.say = text => {
    text = U.clean(text, CHAT_MAX); if (!text) return { err: 'Type something first.' };
    if (Net.state !== 'up') return { err: 'Not connected.' };
    const now = Date.now(); sayTimes = sayTimes.filter(t => now - t < 20000);
    if (sayTimes.length >= 6 || (sayTimes.length && now - sayTimes[sayTimes.length - 1] < 1200)) return { err: 'Slow down a little.' };
    sayTimes.push(now);
    const m = { i: U.rid(10), x: text, t: now }; myLines.push(m);
    chatSeen.add(m.i); Net.chat.push({ i: m.i, f: Auth.id, n: Auth.name, x: text, t: now }); Net.emit('chat');
    pushChat(); return { ok: true };
  };
  /* someone's public encryption key: a friend's (saved), or from their profile or presence */
  Net.epkOf = id => { const S = Auth.S; const f = S && (S.friends[id] || S.reqIn[id]); return (f && f.epk) || (Net.profiles.get(id) || {}).epk || (Net.players.get(id) || {}).epk || null; };
  Net.nameOf = id => { const S = Auth.S, f = S && (S.friends[id] || S.reqIn[id] || S.reqOut[id]); return (f && f.n) || (Net.players.get(id) || {}).n || (Net.profiles.get(id) || {}).n || (S && S.convos[id] && S.convos[id].n) || 'Player'; };
  /* send to someone's inbox. enc: encrypt the body to them. keep: wait on the broker if they're offline */
  const KEEP = new Set(['dm', 'freq', 'facc', 'fdec', 'frem']);
  Net.send = async (to, k, body, enc) => {
    if (!Auth.user || !/^[0-9a-f]{16}$/.test(to)) return { err: 'No such player.' };
    let encTo = null;
    if (enc) { encTo = Net.epkOf(to); if (!encTo) return { err: 'Can\'t reach them yet: they need to have been online since you connected.' }; }
    const i = U.rid(12), e = await seal(k, body, { i, to, encTo, epk: true });
    const go = () => pub(PRE + 'in/' + to + '/' + i, JSON.stringify(e), { retain: KEEP.has(k), qos: 1 });
    if (!go()) { if (!KEEP.has(k)) return { err: 'You\'re not connected.' }; outbox.push(go); return { ok: true, queued: true, i }; }
    return { ok: true, i };
  };
  /* "Name#TAG", "Name" or a whole ID: everyone seen who matches */
  Net.find = q => {
    q = String(q || '').trim(); if (!q) return [];
    const [nm, tg] = q.split('#'), name = nm.trim().toLowerCase(), tag = (tg || '').trim().toLowerCase();
    const seen = new Map();
    for (const p of [...Net.profiles.values(), ...Net.players.values()]) {
      if (seen.has(p.id) || p.id === Auth.id) continue;
      if (/^[0-9a-f]{16}$/.test(name) ? p.id === name : (p.n.toLowerCase() === name || (!tag && p.n.toLowerCase().startsWith(name))) && (!tag || p.id.startsWith(tag))) seen.set(p.id, p);
    }
    return [...seen.values()].sort((a, b) => (Net.players.has(b.id) ? 1 : 0) - (Net.players.has(a.id) ? 1 : 0) || a.n.localeCompare(b.n)).slice(0, 30);
  };
  Net.online = id => { const p = Net.players.get(id); return p && Date.now() - p.seen < PRES_STALE ? p : null; };
  Net.pub = pub;
  Net._t = { seal, unseal, encrypt, decrypt };
})();
