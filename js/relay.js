/* ============================================================================
   relay.js -- the fallback link for rooms.

   Rooms link the players' browsers directly (WebRTC, through PeerJS). A direct
   link can't get through some home routers and most mobile networks, and the
   free relay servers WebRTC used to fall back on have shut down. So when a
   direct link doesn't open within a few seconds, online.js opens one of these
   instead: the room's messages travel over the same two public MQTT brokers as
   the lobby (net.js), encrypted between the two games with a fresh key pair
   for every link (ECDH P-256, AES-GCM), numbered so they arrive in order and
   the copy from the second broker is dropped.

   Topics, under wordle-n-friends/1/rl/<room code>/:
     h        to the host, from every guest: { f: link id, k, ... }
     g/<id>   to one guest
     all      to every guest (the host's last will)
   k is 'syn' (a guest asking to link, with its public key), 'ack' (the host's
   answer, with its key), 'd' (a message: n, iv, ct), 'hb' (still here), 'fin'
   (gone) or 'gone' (a last will: the broker lost that side; it may only be a
   blip on one broker, so the link closes if nothing else arrives for 15 s).

     Relay.host(code, onLink) -> { stop() }   the host: onLink(link) per guest
     Relay.join(code) -> link                 a guest
   A link looks like a PeerJS DataConnection to online.js: link.peer,
   link.open, link.send(obj), link.close(), link.on('open' | 'data' | 'close').
   ========================================================================== */
(function () {
  'use strict';
  const subtle = window.crypto && crypto.subtle;
  const te = new TextEncoder(), td = new TextDecoder();
  const HB = 5000, DEAD = 90000, GONE = 15000, GAP = 3000, SYN_EVERY = 1500, SYN_FOR = 15000;
  const ID = /^[a-z0-9]{12}$/;
  const at = (code, ...p) => Net.PRE + 'rl/' + code + '/' + p.join('/');
  const live = new Set();                                   // every open link, to say goodbye when the page goes

  const b64 = bytes => { const a = new Uint8Array(bytes); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const okPk = p => Array.isArray(p) && p.length === 2 && p.every(x => typeof x === 'string' && /^[\w-]{40,48}$/.test(x));
  const keyPair = () => subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  const pubOf = async kp => { const j = await subtle.exportKey('jwk', kp.publicKey); return [j.x, j.y]; };
  async function sharedKey(kp, p) {
    const pub = await subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: p[0], y: p[1], ext: true }, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return subtle.deriveKey({ name: 'ECDH', public: pub }, kp.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  /* MQTT clients on both brokers, subscribed to `subs`; f(topic, frame) for every frame that arrives */
  async function clients(subs, f, will) {
    await Net.loadMqtt();
    const cl = Net.BROKERS.map(url => {
      const c = mqtt.connect(url, { clientId: 'wnfr_' + U.rid(10), keepalive: 30, reconnectPeriod: 4000, connectTimeout: 8000, clean: true, will });
      c.on('connect', () => c.subscribe(Object.fromEntries(subs.map(s => [s, { qos: 1 }]))));
      c.on('message', (t, m) => { let fr; try { fr = JSON.parse(td.decode(m)); } catch (e) { return; } if (fr && typeof fr === 'object') f(t, fr); });
      c.on('error', () => {});
      return c;
    });
    return {
      pub(t, fr) { const s = JSON.stringify(fr); for (const c of cl) if (c.connected) { try { c.publish(t, s, { qos: 1 }); } catch (e) { /* fine */ } } },
      end() { setTimeout(() => cl.forEach(c => { try { c.end(true); } catch (e) { /* fine */ } }), 300); },
    };
  }

  /* one link: out(frame) sends a frame to the other side; done() tidies up when it closes */
  function Link(peer, out, done) {
    const hs = {};
    const L = {
      peer, open: false, key: null, seq: 0, next: 1, held: new Map(), gapAt: 0, heard: Date.now(), chain: Promise.resolve(), closed: false,
      on(ev, fn) { (hs[ev] = hs[ev] || []).push(fn); return L; },
      emit(ev, x) { for (const fn of hs[ev] || []) { try { fn(x); } catch (e) { console.error(e); } } },
      send(msg) {
        if (!L.open) return;
        const n = ++L.seq, iv = crypto.getRandomValues(new Uint8Array(12));
        subtle.encrypt({ name: 'AES-GCM', iv }, L.key, te.encode(JSON.stringify(msg)))
          .then(ct => { if (!L.closed) out({ k: 'd', n, iv: b64(iv), ct: b64(ct) }); }).catch(() => {});
      },
      close() { L.end(true); },
      end(tell) {
        if (L.closed) return;
        L.closed = true; L.open = false; live.delete(L);
        if (tell) out({ k: 'fin' });
        done(); L.emit('close');
      },
      got(fr) {
        if (fr.k === 'gone') { L.suspect = true; return; }
        L.heard = Date.now(); L.suspect = false;
        if (fr.k === 'fin') { L.end(false); return; }
        if (fr.k !== 'd' || !L.key || typeof fr.n !== 'number' || fr.n < L.next || L.held.has(fr.n) || L.held.size > 500) return;
        L.held.set(fr.n, fr);
        L.chain = L.chain.then(L.drain);
      },
      async drain() {
        while (!L.closed && L.held.has(L.next)) {
          const fr = L.held.get(L.next); L.held.delete(L.next); L.next++; L.gapAt = 0;
          let msg;
          try { msg = JSON.parse(td.decode(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(fr.iv) }, L.key, unb64(fr.ct)))); } catch (e) { continue; }
          if (!L.closed) L.emit('data', msg);
        }
      },
      /* every second: a message lost on both brokers mustn't stall the rest; a silent link is a closed one */
      tick(now) {
        if (now - L.heard > (L.suspect ? GONE : DEAD)) { L.end(false); return; }
        if (L.held.size && !L.held.has(L.next)) {
          if (!L.gapAt) L.gapAt = now;
          else if (now - L.gapAt > GAP) { L.next = Math.min(...L.held.keys()); L.gapAt = 0; L.chain = L.chain.then(L.drain); }
        }
      },
    };
    live.add(L);
    return L;
  }

  const Relay = window.Relay = {};

  Relay.host = (code, onLink) => {
    const links = new Map();                                // link id -> link (or 'wait' while its key is made)
    let C = null, stopped = false;
    const tick = setInterval(() => { const now = Date.now(); for (const L of links.values()) if (L !== 'wait') L.tick(now); }, 1000);
    const hb = setInterval(() => { for (const [f, L] of links) if (L !== 'wait' && L.open) C.pub(at(code, 'g', f), { k: 'hb' }); }, HB);
    async function got(t, fr) {
      const f = fr.f; if (typeof f !== 'string' || !ID.test(f)) return;
      const L = links.get(f);
      if (fr.k === 'syn') {
        if (L === 'wait') return;
        if (L) { C.pub(at(code, 'g', f), L.ack); return; }       // our answer got lost: say it again
        if (!okPk(fr.pk)) return;
        links.set(f, 'wait');
        try {
          const kp = await keyPair(), key = await sharedKey(kp, fr.pk);
          if (stopped) return;
          const link = Link('rl-' + f, x => C.pub(at(code, 'g', f), x), () => links.delete(f));
          link.key = key; link.open = true; link.ack = { k: 'ack', pk: await pubOf(kp) };
          links.set(f, link);
          C.pub(at(code, 'g', f), link.ack);
          onLink(link);
        } catch (e) { links.delete(f); }
        return;
      }
      if (L && L !== 'wait') L.got(fr);
    }
    clients([at(code, 'h')], got, { topic: at(code, 'all'), payload: JSON.stringify({ k: 'gone' }), qos: 1, retain: false })
      .then(c => { C = c; if (stopped) C.end(); }).catch(() => {});
    return {
      stop() {
        if (stopped) return; stopped = true; clearInterval(tick); clearInterval(hb);
        for (const L of [...links.values()]) if (L !== 'wait') L.end(true);
        if (C) C.end();
      },
    };
  };

  Relay.join = code => {
    const f = U.rid(12);
    let C = null, kp = null, synT = null, hbT = null, tickT = null;
    const L = Link('rl-host', x => { if (C) C.pub(at(code, 'h'), Object.assign({ f }, x)); }, () => {
      clearTimeout(synT); clearInterval(hbT); clearInterval(tickT); if (C) C.end();
    });
    async function got(t, fr) {
      if (L.closed) return;
      if (fr.k === 'ack') {
        if (L.open || L.key || !okPk(fr.pk)) return;
        try { L.key = await sharedKey(kp, fr.pk); } catch (e) { return; }
        L.open = true; L.heard = Date.now();
        hbT = setInterval(() => L.open && C.pub(at(code, 'h'), { f, k: 'hb' }), HB);
        tickT = setInterval(() => L.tick(Date.now()), 1000);
        L.emit('open');
        return;
      }
      if (L.open) L.got(fr);
    }
    (async () => {
      kp = await keyPair(); const pk = await pubOf(kp);
      C = await clients([at(code, 'g', f), at(code, 'all')], got, { topic: at(code, 'h'), payload: JSON.stringify({ f, k: 'gone' }), qos: 1, retain: false });
      if (L.closed) { C.end(); return; }
      const t0 = Date.now();
      const syn = () => {
        if (L.open || L.closed) return;
        if (Date.now() - t0 > SYN_FOR) { L.end(false); return; }      // no host answered
        C.pub(at(code, 'h'), { f, k: 'syn', pk }); synT = setTimeout(syn, SYN_EVERY);
      };
      syn();
    })().catch(() => L.end(false));
    return L;
  };

  // leaving the page: tell the other ends now rather than when the brokers notice
  window.addEventListener('pagehide', () => { for (const L of [...live]) L.end(true); });
})();
