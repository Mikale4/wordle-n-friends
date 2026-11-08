/* ============================================================================
   match.js -- plays the games in js/games.js (Runecasters, Wordwright, Chess).

   Match.local(id, set)     a game on this device: you against CPU players
                            (or alone, where the game allows one player)
   Match.Runner(g, opts, players, o)
                            the rules running: the state, CPU turns, clocks,
                            players who left. Used by Match.local and by the
                            host of an online room (online.js), which sends
                            each player their view after every change.
   Match.screen(g, o)       the game screen: the top bar, the game's board
   Match.results(...)       the pop-up at the end
   Match.record(...)        stats and XP for a finished game
   ========================================================================== */
(function () {
  'use strict';
  const { el } = U;
  const CPU_NAMES = { easy: ['Pip', 'Moss', 'Bean', 'Tuck', 'Dot'], normal: ['Sage', 'Wren', 'Juno', 'Fable', 'Quill'], hard: ['Vex', 'Onyx', 'Raze', 'Nyx', 'Hex'] };
  const THINK = { runes: 1100, wright: 1200, chess: 450 };          // CPU moves are never instant: you see them happen
  const toast = (t, c) => Menu.toast(t, c);

  /* ---- the rules running */
  function Runner(g, opts, players, o) {
    const R = { g, opts, players, gone: new Set(), over: null, gen: 0, thinking: -1 };
    const now = () => Date.now();
    R.state = g.setup(opts, players.map(p => ({ id: p.id, name: p.name })), now());
    const safe = (f, dflt) => { try { return f(); } catch (e) { console.error(e); return dflt; } };
    function timeoutFor(pid) { const r = safe(() => g.timeout(R.state, pid, now()), null); if (r && r.state) R.state = r.state; }
    function changed() {
      R.gen++;
      const res = safe(() => g.result(R.state), null);
      o.push();
      if (res && !R.over) { R.over = res; clearInterval(R.t); o.over(res); return; }
      setTimeout(step, 0);
    }
    function step() {
      if (R.over) return;
      // a game for two or more that's down to one player: it's theirs
      const here = players.filter(p => !R.gone.has(p.id));
      if (players.length > 1 && here.length < 2) {
        R.over = { ranks: [here.map(p => p.id), [...R.gone]].filter(x => x.length), scores: {}, text: 'Everyone else left.', forfeit: true };
        clearInterval(R.t); o.push(); o.over(R.over); return;
      }
      const t = safe(() => g.turn(R.state), []) || [];
      const goneP = t.find(pid => R.gone.has(pid));
      if (goneP != null) { timeoutFor(goneP); changed(); return; }
      const cp = players.find(p => p.cpu && t.includes(p.id));
      if (!cp || R.thinking === R.gen) return;
      const gen = R.thinking = R.gen, t0 = now();
      Promise.resolve().then(() => g.cpu(R.state, cp.id, cp.cpu, now())).then(m => {
        setTimeout(() => {
          if (R.over || R.gen !== gen) return;
          if (R.apply(cp.id, m).err) { timeoutFor(cp.id); changed(); }       // (shouldn't happen: a CPU that can't move passes)
        }, Math.max(0, (o.think || 700) - (now() - t0)));
      }).catch(e => { console.error(e); if (R.over || R.gen !== gen) return; timeoutFor(cp.id); changed(); });
    }
    R.apply = (pid, m) => {
      if (R.over) return { err: 'The game is over.' };
      const r = safe(() => g.move(R.state, pid, m, now()), { err: 'Something went wrong with that move.' });
      if (!r || r.err) return { err: (r && r.err) || 'Not allowed.' };
      R.state = r.state; changed(); return {};
    };
    R.view = pid => safe(() => g.view(R.state, pid, now()), null);
    R.leave = pid => { if (R.gone.has(pid) || R.over) return; R.gone.add(pid); changed(); };
    R.stop = () => { if (!R.over) R.over = { stopped: true }; clearInterval(R.t); };
    R.t = setInterval(() => {
      if (R.over) return;
      const pid = safe(() => g.due(R.state, now()), null);
      if (pid != null) { timeoutFor(pid); changed(); }
    }, 400);
    setTimeout(step, 400);
    return R;
  }

  /* ---- the game screen */
  function screen(g, o) {
    const area = el('div', { class: 'gamearea g-' + g.id });
    const scr = el('div', { class: 'screen arcade play g-' + g.id + (o.online ? ' onlinegame' : '') }, Menu.ui.topbar(o.title || g.name.toUpperCase(), o.onBack, ...(o.extra || []), Tutorial.button(g.id)), area);
    App.screen(scr);
    let ui;
    try { ui = g.mount(area, o.api); } catch (e) { console.error(e); area.append(el('p', { class: 'err' }, 'This game couldn\'t start: ' + e.message)); }
    if (!ui) ui = { update() {}, destroy() {} };
    const safeUi = { update: v => { if (!v) return; try { ui.update(v); } catch (e) { console.error(e); } }, destroy: () => { try { ui.destroy(); } catch (e) { console.error(e); } } };
    App.onLeave(() => { safeUi.destroy(); if (o.onLeave) o.onLeave(); });
    return { scr, area, ui: safeUi };
  }
  function loading(g, text) {
    App.screen(el('div', { class: 'screen arcade play g-' + g.id }, Menu.ui.topbar(g.name.toUpperCase(), () => Arcade.hub(g.id)),
      el('div', { class: 'olwait' }, el('div', { class: 'spinner' }), el('p', null, text || 'Getting the dictionary ready...'))));
  }

  /* ---- results */
  const nameOf = (players, id) => (players.find(p => p.id === id) || {}).name || '?';
  function outcome(res, me, n) {
    if (!res || !res.ranks || !res.ranks.length) return 'none';
    if (n === 1) return 'solo';
    const i = res.ranks.findIndex(grp => grp.includes(me));
    if (i < 0) return 'watch';
    if (i === 0) return res.ranks[0].length > 1 ? 'draw' : 'win';
    return 'loss';
  }
  function results(g, res, players, me, o) {
    const { btn } = Menu.ui;
    const out = outcome(res, me, players.length);
    const rows = []; let place = 1;
    for (const grp of res.ranks || []) { for (const id of grp) rows.push({ id, place }); place += grp.length; }
    const title = out === 'solo' ? 'FINISHED' : out === 'win' ? 'YOU WIN!' : out === 'draw' ? 'DRAW' : out === 'watch' ? (res.ranks[0].length > 1 ? 'DRAW' : nameOf(players, res.ranks[0][0]).toUpperCase() + ' WINS') : nameOf(players, res.ranks[0][0]).toUpperCase() + ' WINS';
    const sc = id => res.scores && typeof res.scores[id] === 'number' ? res.scores[id] : null;
    const body = [
      res.text ? el('p', { class: 'restext' }, res.text) : null,
      el('div', { class: 'rtable' }, ...rows.map(r => el('div', { class: 'rrow' + (r.id === me ? ' me' : '') + (r.place === 1 ? ' first' : '') },
        el('span', { class: 'rpos' }, r.place === 1 && out !== 'solo' ? '★' : r.place), el('b', null, nameOf(players, r.id) + (r.id === me ? ' (you)' : '')),
        el('small', null, o.gone && o.gone.has(r.id) ? 'left' : ''), g.id === 'chess' ? null : sc(r.id) != null ? el('span', { class: 'rtot' }, sc(r.id) + ' pts') : null))),
      o.xp ? el('p', { class: 'small muted' }, '+' + o.xp + ' XP') : null,
    ];
    SFX.play(out === 'win' || out === 'solo' ? 'win' : out === 'draw' || out === 'watch' ? 'ok' : 'lose');
    const buttons = [];
    if (o.again) buttons.push(['PLAY AGAIN', () => o.again(), 'big']);
    if (o.back) buttons.push([o.backLabel || 'BACK', () => o.back(), o.again ? 'ghost' : 'big']);
    return Menu.modal({ title, cls: 'results ' + (out === 'win' || out === 'solo' ? 'won' : 'lost'), body, buttons, onClose: o.onClose });
  }

  /* ---- stats and XP: per game, CPU and online kept apart */
  function record(g, res, players, online, me) {
    me = me || Auth.id;
    if (!Auth.user || !res || !res.ranks) return 0;
    const out = outcome(res, me, players.length); if (out === 'watch' || out === 'none') return 0;
    const st = Auth.stat(g.id + (online ? '-online' : players.length === 1 ? '-solo' : '-cpu'));
    st.played++;
    if (out === 'win') { st.won++; st.streak++; st.maxStreak = Math.max(st.maxStreak, st.streak); } else if (out !== 'solo') st.streak = 0;
    const sc = res.scores && res.scores[me];
    if (typeof sc === 'number' && g.id !== 'chess') { st.best = Math.max(st.best || 0, sc); st.total = (st.total || 0) + sc; }
    Auth.save();
    const lv = Math.max(0, ...players.filter(p => p.cpu).map(p => ({ easy: 0, normal: 1, hard: 2 })[p.cpu] || 0));
    const xp = out === 'solo' ? U.clamp(Math.round((sc || 0) / 8), 4, 40)
      : online ? ({ win: 40, draw: 22, loss: 14 })[out]
        : ({ win: [15, 28, 45][lv], draw: [8, 14, 22][lv], loss: 8 })[out];
    Rank.xp(xp);
    return xp;
  }

  const cpuName = (lv, i) => { const a = CPU_NAMES[lv] || CPU_NAMES.normal; return a[i % a.length] + ' (' + lv.toUpperCase() + ' CPU)'; };

  /* ---- a game on this device */
  async function local(id, set) {
    const g = Games.get(id); if (!g || !Auth.user) return;
    set = set || {};
    if (Tutorial.has(id) && !Tutorial.seen(id)) { Tutorial.first(id, () => local(id, set)); return; }   // the first time: how to play
    if (g.lex && !Lex.ready) {
      loading(g);
      try { await Lex.load(); } catch (e) { toast(e.message, 'bad'); Arcade.hub(id); return; }
    }
    const opts = Games.opts(g, set.opts);
    const me = { id: Auth.id, name: Auth.name };
    const cpus = (set.cpus || []).slice(0, g.players[1] - 1).map((lv, i) => ({ id: 'cpu' + (i + 1), name: cpuName(lv, i), cpu: lv }));
    let players = [me, ...cpus];
    if (set.seat === 'second' || (set.seat === 'random' && Math.random() < 0.5)) players = [...cpus, me];
    if (players.length < g.players[0]) { toast(g.name + ' needs ' + g.players[0] + ' players.', 'bad'); return; }
    let ui = null, R = null, pop = null;
    const api = {
      me: Auth.id, online: false, players: players.map(p => ({ id: p.id, name: p.name, cpu: p.cpu || null })),
      act: m => { const r = R.apply(Auth.id, m); if (r.err) { toast(r.err, 'bad'); SFX.play('bad'); } },
      toast: (t, k) => toast(t, k), sfx: n => SFX.play(n),
    };
    const finish = res => {
      const xp = record(g, res, players, false);
      setTimeout(() => { if (document.body.contains(scr.scr)) pop = results(g, res, players, Auth.id, { xp, again: () => local(id, set), back: () => Arcade.hub(id), backLabel: 'MENU' }); }, 1100);
    };
    R = Runner(g, opts, players, { think: THINK[id], push: () => ui && ui.update(R.view(Auth.id)), over: finish });
    const back = () => {
      if (R.over) return Arcade.hub(id);
      Menu.modal({ title: 'LEAVE THE GAME?', body: [el('p', null, 'This game won\'t be finished.')], buttons: [['LEAVE', () => Arcade.hub(id), 'danger'], ['STAY', () => {}, 'ghost']] });
    };
    const scr = screen(g, { api, onBack: back, onLeave: () => { R.stop(); if (pop) pop.close(); } });
    ui = scr.ui; ui.update(R.view(Auth.id));
    Net.setStatus('menu', 'Playing ' + g.name + (cpus.length ? ' vs CPU' : ''));
  }

  window.Match = { Runner, screen, results, record, local, outcome, cpuName, THINK };
})();
