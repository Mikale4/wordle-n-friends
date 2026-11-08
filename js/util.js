/* util.js -- small shared helpers (DOM, storage, random, time, text). */
(function () {
  'use strict';
  const U = {};
  U.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  U.fmt = n => Math.round(n).toLocaleString('en-US');
  U.$ = id => document.getElementById(id);
  U.sleep = ms => new Promise(r => setTimeout(r, ms));

  /* el('div', {class:'x', onclick:fn}, child, 'text', ...)  (text always goes in as text, never as markup) */
  U.el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') { for (const p in v) { if (p.startsWith('--')) e.style.setProperty(p, v[p]); else e.style[p] = v[p]; } }
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  };

  /* localStorage JSON, every access guarded (private mode, blocked storage) */
  U.read = (k, def) => { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } };
  U.write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* keep going */ } };

  /* seeded random (mulberry32): the same seed gives the same words on every device */
  U.rng = seed => {
    let s = seed | 0;
    return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  };
  U.hash32 = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  U.rid = (n = 12) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return Array.from(b, x => (x % 36).toString(36)).join(''); };
  U.pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];
  U.shuffle = (a, r = Math.random) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /* days: the local calendar day as a number (day 1 = 1 Jan 2026), for the Daily word */
  const EPOCH = Date.UTC(2026, 0, 1);
  U.dayNum = (d = new Date()) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 86400000) + 1;
  U.msToMidnight = () => { const d = new Date(), m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); return m - d; };
  U.clock = ms => { ms = Math.max(0, ms); const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  U.hms = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  U.ago = ts => {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago'; return new Date(ts).toLocaleDateString();
  };
  U.time = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  /* typed text from other people: plain, one line, no control or direction-flipping characters */
  const BADCH = c => c < 32 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2060 && c <= 0x206f) || c === 0xfeff;
  U.clean = (t, max = 160) => Array.from(String(t == null ? '' : t)).filter(ch => !BADCH(ch.codePointAt(0))).join('').replace(/\s+/g, ' ').trim().slice(0, max);
  const SWEARS = /\b(f+u+c+k|s+h+i+t|b+i+t+c+h|c+u+n+t|a+s+s+h+o+l+e|b+a+s+t+a+r+d|s+l+u+t|w+h+o+r+e|t+w+a+t|w+a+n+k|d+i+c+k+h+e+a+d|m+o+t+h+e+r+f+u+c+k)\w*/gi;
  U.unswear = t => t.replace(SWEARS, w => w[0] + '*'.repeat(Math.max(1, w.length - 1)));

  /* base64url <-> bytes (keys, ciphertext) */
  U.b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  U.unb64 = s => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
  U.hex = bytes => Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');

  /* a tiny event hub: U.hub() -> { on(type, fn) -> off, emit(type, data) } */
  U.hub = () => {
    const L = {};
    return {
      on(t, fn) { (L[t] = L[t] || new Set()).add(fn); return () => L[t].delete(fn); },
      emit(t, d) { for (const fn of [...(L[t] || [])]) { try { fn(d); } catch (e) { console.error(e); } } },
    };
  };

  /* a phone or tablet */
  U.touch = (() => { try { return matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } })();

  window.U = U;
})();
