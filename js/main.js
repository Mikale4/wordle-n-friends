/* main.js -- App: which screen is up, the keyboard, and the start. */
(function () {
  'use strict';
  let leave = [];
  const App = window.App = {
    keys: null,                 // the game screen's key handler (letters, Enter, Backspace)
    /* show a screen; the old one's leave hooks run first. The same screen drawn again keeps its scrolled panels */
    screen(node) {
      const hooks = leave; leave = []; App.keys = null;
      for (const f of hooks) { try { f(); } catch (e) { console.error(e); } }
      const s = U.$('screens'), old = s.firstElementChild, keep = [];
      if (old && node && old.className === node.className) [old, ...old.querySelectorAll('*')].forEach((e, i) => { if (e.scrollTop) keep.push({ i, cls: e.className, top: e.scrollTop }); });
      s.innerHTML = ''; if (node) s.append(node);
      if (keep.length) { const all = [node, ...node.querySelectorAll('*')]; for (const k of keep) { const e = all[k.i]; if (e && e.className === k.cls) e.scrollTop = k.top; } }
      window.scrollTo(0, 0);
    },
    onLeave(fn) { leave.push(fn); },
  };

  window.addEventListener('keydown', e => {
    const t = e.target, typing = t && /INPUT|TEXTAREA|SELECT/.test(t.tagName);
    if (e.key === 'Escape') {
      const ov = [...document.querySelectorAll('.overlay')].pop();
      if (ov) { const c = ov.querySelector('.mclose'); if (c) { e.preventDefault(); c.click(); } return; }
      if (typing) { t.blur(); return; }
      const b = document.querySelector('#screens .backbtn'); if (b) { e.preventDefault(); b.click(); }
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || !App.keys || document.querySelector('.overlay.block')) return;
    let k = null;
    if (e.key === 'Enter') k = 'enter'; else if (e.key === 'Backspace') k = 'back'; else if (/^[a-zA-Z]$/.test(e.key)) k = e.key.toLowerCase();
    if (!k) return;
    e.preventDefault(); if (!e.repeat || k === 'back') App.keys(k);
  });

  /* phones: no double-tap zoom on the keyboard */
  document.addEventListener('dblclick', e => { if (e.target.closest('.kb')) e.preventDefault(); }, { passive: false });

  function boot() {
    const b = U.$('boot'); if (b) b.remove();
    if (U.touch) document.body.classList.add('touch');
    Menu.title();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
