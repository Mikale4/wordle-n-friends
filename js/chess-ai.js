/* chess-ai.js -- the chess CPU's search, in a Web Worker so the page stays smooth while it thinks.
   It loads js/chess.js with this file's own ?v= stamp (so both come from the same version) and answers
   { id, state, o } with { id, res } (Chess.search's answer) or { id, err } (the page then searches itself). */
(function () {
  'use strict';
  let err = null;
  try { importScripts('chess.js' + (self.location.search || '')); } catch (e) { err = 'load: ' + (e && e.message || e); }
  if (!err && !(self.Chess && self.Chess.search)) err = 'no engine';
  self.onmessage = e => {
    const d = e.data || {};
    if (err) { self.postMessage({ id: d.id, err }); return; }
    let res = null;
    try { res = self.Chess.search(d.state, d.o); } catch (x) { self.postMessage({ id: d.id, err: String(x && x.message || x) }); return; }
    self.postMessage({ id: d.id, res });
  };
})();
