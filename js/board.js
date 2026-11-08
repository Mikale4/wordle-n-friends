/* ============================================================================
   board.js -- what a game looks like: the boards, the on-screen keyboard and
   the small colour-only boards that show an opponent's progress.

   const V = new BoardView({ len, max, count, onKey })
     V.el (the boards)  V.kb (the keyboard)  V.value (the word being typed)
     V.type(c) V.del() V.clear()  V.shake(msg)
     V.reveal(word, pats, done)   flips the row in on every board still open
     V.load(rowsPerBoard)         shows rows without animation (a resumed game)
     V.lock(n)                    greys out rows past n (Survival)
   BoardView.mini(len, max, rows) a little board of colours (no letters)
   ========================================================================== */
(function () {
  'use strict';
  const { el } = U;
  const LAYOUT = ['qwertyuiop', 'asdfghjkl', '>zxcvbnm<'];
  const FLIP = 280, STAGGER = 220;

  class BoardView {
    constructor(o) {
      this.len = o.len; this.max = o.max; this.count = o.count || 1; this.onKey = o.onKey || (() => {});
      this.value = ''; this.busy = false;
      this.data = Array.from({ length: this.count }, () => ({ rows: [], solved: false }));
      this.el = el('div', { class: 'boards n' + this.count, style: { '--len': this.len, '--rows': this.max } });
      this.grids = this.data.map((_, k) => {
        const rows = Array.from({ length: this.max }, () => el('div', { class: 'brow' }, ...Array.from({ length: this.len }, () => el('span', { class: 'tile' }))));
        const g = el('div', { class: 'board' }, ...rows); g.rows = rows; this.el.append(g); return g;
      });
      this.keyEls = {};
      this.kb = el('div', { class: 'kb' + (this.count > 1 ? ' multi' : '') }, ...LAYOUT.map(r => el('div', { class: 'kbrow' }, ...[...r].map(c => {
        const k = c === '>' ? 'enter' : c === '<' ? 'back' : c;
        const b = el('button', { class: 'key' + (k.length > 1 ? ' wide' : ''), 'data-k': k, onpointerdown: e => { e.preventDefault(); this.onKey(k); } },
          k === 'enter' ? 'ENTER' : k === 'back' ? '⌫' : c.toUpperCase(),
          this.count > 1 && k.length === 1 ? el('i', { class: 'quads' }, ...this.data.map(() => el('i'))) : null);
        if (k.length === 1) this.keyEls[k] = b;
        return b;
      }))));
      this.paint();
    }
    rowOf(k) { return this.data[k].rows.length; }
    open() { return this.data.map((b, k) => (!b.solved && this.rowOf(k) < this.max ? k : -1)).filter(k => k >= 0); }
    paint() {
      for (const k of this.open()) {
        const row = this.grids[k].rows[this.rowOf(k)];
        row.classList.add('cur');
        [...row.children].forEach((t, i) => { t.textContent = (this.value[i] || '').toUpperCase(); t.classList.toggle('filled', !!this.value[i]); });
      }
    }
    type(c) { if (this.busy || this.value.length >= this.len) return false; this.value += c; this.paint(); const k = this.open()[0]; if (k != null) { const t = this.grids[k].rows[this.rowOf(k)].children[this.value.length - 1]; t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop'); } SFX.play('key'); return true; }
    del() { if (this.busy || !this.value) return false; this.value = this.value.slice(0, -1); this.paint(); SFX.play('del'); return true; }
    clear() { this.value = ''; this.paint(); }
    shake() { SFX.play('bad'); for (const k of this.open()) { const r = this.grids[k].rows[this.rowOf(k)]; r.classList.remove('shake'); void r.offsetWidth; r.classList.add('shake'); } }
    /* the guess goes in on every open board; pats[k] null = that board was already solved */
    reveal(word, pats, done) {
      this.busy = true; this.value = '';
      let longest = 0;
      pats.forEach((p, k) => {
        if (!p) return;
        const r = this.rowOf(k), row = this.grids[k].rows[r];
        row.classList.remove('cur');
        this.data[k].rows.push({ w: word, p });
        [...row.children].forEach((t, i) => {
          t.textContent = word[i].toUpperCase(); t.classList.add('filled');
          setTimeout(() => { t.classList.add('flip'); if (k === 0 || this.count === 1) setTimeout(() => SFX.play('flip' + p[i]), FLIP / 2); }, i * STAGGER);
          setTimeout(() => { t.dataset.s = p[i]; }, i * STAGGER + FLIP / 2);
        });
        longest = Math.max(longest, (this.len - 1) * STAGGER + FLIP);
        if (Engine.solvedPat(p)) { this.data[k].solved = true; setTimeout(() => { row.classList.add('win'); this.grids[k].classList.add('solved'); }, longest + 60); }
        else if (this.data[k].rows.length >= this.max) setTimeout(() => this.grids[k].classList.add('failed'), longest + 60);
      });
      setTimeout(() => { this.keys(); this.busy = false; this.paint(); if (done) done(); }, longest + 80);
    }
    load(rowsPer) {
      rowsPer.forEach((rows, k) => rows.forEach(({ w, p }) => {
        const row = this.grids[k].rows[this.rowOf(k)]; this.data[k].rows.push({ w, p });
        [...row.children].forEach((t, i) => { t.textContent = w[i].toUpperCase(); t.dataset.s = p[i]; t.classList.add('filled'); });
        if (Engine.solvedPat(p)) { this.data[k].solved = true; this.grids[k].classList.add('solved'); }
      }));
      this.keys(); this.paint();
    }
    keys() {
      const st = Engine.keyStates(this.data);
      for (const c in this.keyEls) {
        const b = this.keyEls[c], s = st[c];
        if (this.count === 1) b.dataset.s = s ? (s[0] >= 0 ? s[0] : '') : '';
        else { const q = b.querySelectorAll('.quads > i'); this.data.forEach((d, k) => { q[k].dataset.s = d.solved ? 'x' : s && s[k] >= 0 ? s[k] : ''; }); b.dataset.s = s && s.every((v, k) => v === 0 || this.data[k].solved) ? '0' : ''; }
      }
    }
    lock(n) { this.grids.forEach(g => g.rows.forEach((r, i) => r.classList.toggle('locked', i >= n))); }
    /* show the answers on boards that weren't solved */
    answer(words) {
      words.forEach((w, k) => { if (this.data[k] && !this.data[k].solved && w) this.grids[k].append(el('div', { class: 'answer' }, w.toUpperCase())); });
    }
  }
  BoardView.mini = (len, max, rows, o = {}) => el('div', { class: 'mini' + (o.solved ? ' solved' : '') + (o.failed ? ' failed' : ''), style: { '--len': len } },
    ...Array.from({ length: max }, (_, r) => el('div', { class: 'mrow' }, ...Array.from({ length: len }, (_, i) => el('i', { 'data-s': rows[r] ? rows[r][i] : '' })))));
  window.BoardView = BoardView;
})();
