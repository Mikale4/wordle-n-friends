/* ============================================================================
   rank.js -- RANKED rating, tiers, levels and the leaderboard.

   RATING: everyone starts at 1000. A ranked match (a 1v1 race, online) moves
   it the Elo way: beat someone rated above you and you gain more. K is 40 for
   your first 10 ranked matches (you find your level fast), then 24.

   TIERS (by rating):   BRONZE  < 950    (III, II, I at 850 / 900)
                        SILVER  950+     (III, II, I every 50)
                        GOLD    1100+    PLATINUM 1250+    DIAMOND 1400+
                        MASTER  1550+    LEGEND   1700+
   LEVEL: every game you finish earns XP (more for winning); levels show
   beside your name everywhere.

   THE LEADERBOARD is everyone's signed profile on the relay (net.js): their
   rating as their own game reports it.
   ========================================================================== */
(function () {
  'use strict';
  const TIERS = [
    { name: 'BRONZE', cls: 't-bronze', min: 0, divs: [850, 900] },
    { name: 'SILVER', cls: 't-silver', min: 950, divs: [1000, 1050] },
    { name: 'GOLD', cls: 't-gold', min: 1100, divs: [1150, 1200] },
    { name: 'PLATINUM', cls: 't-plat', min: 1250, divs: [1300, 1350] },
    { name: 'DIAMOND', cls: 't-diamond', min: 1400, divs: [1450, 1500] },
    { name: 'MASTER', cls: 't-master', min: 1550, divs: [] },
    { name: 'LEGEND', cls: 't-legend', min: 1700, divs: [] },
  ];
  const ROMAN = ['III', 'II', 'I'];
  function tier(r) {
    r = Math.round(r || 0);
    let i = TIERS.length - 1; while (i > 0 && r < TIERS[i].min) i--;
    const T = TIERS[i];
    let div = '';
    if (T.divs.length) { let d = 0; for (const x of T.divs) if (r >= x) d++; div = ROMAN[d]; }
    const next = i < TIERS.length - 1 ? TIERS[i + 1].min : null;
    return { name: T.name, div, cls: T.cls, index: i, min: T.min, next, label: T.name + (div ? ' ' + div : '') };
  }
  const expect = (me, opp) => 1 / (1 + Math.pow(10, (opp - me) / 400));
  const delta = (me, opp, result, K) => Math.round(K * (result - expect(me, opp)));
  const kFor = games => games < 10 ? 40 : 24;
  /* levels: level n -> n+1 takes 100 + 50(n-1) XP */
  function level(xp) { let lv = 1, need = 100; xp = Math.max(0, xp | 0); while (xp >= need) { xp -= need; lv++; need += 50; } return { lv, into: xp, need }; }

  const Rank = window.Rank = {
    TIERS, tier, delta, expect, kFor, level,
    label: r => tier(r).label,
    /* a ranked result for the signed-in player: result 1 win, 0.5 draw, 0 loss */
    apply(oppRating, result, oppName) {
      const R = Auth.S.rank, before = R.rating, d = delta(before, oppRating, result, kFor(R.games));
      R.rating = Math.max(100, before + d); R.games++; R.peak = Math.max(R.peak, R.rating);
      if (result === 1) R.wins++; else if (result === 0) R.losses++; else R.draws++;
      R.hist.push({ t: Date.now(), r: R.rating, d, opp: String(oppName || '').slice(0, 16), res: result }); if (R.hist.length > 60) R.hist.shift();
      Auth.save(); if (window.Net) Net.profile();
      return { before, after: R.rating, d, up: tier(R.rating).index > tier(before).index, down: tier(R.rating).index < tier(before).index };
    },
    /* XP for the signed-in player; a toast on a level up */
    xp(n, why) {
      const S = Auth.S; if (!S || !(n > 0)) return;
      const a = level(S.xp).lv; S.xp += Math.round(n); Auth.save();
      const b = level(S.xp).lv;
      if (b > a && window.Menu) { Menu.toast('LEVEL UP! You\'re level ' + b + '.', 'gold'); if (window.SFX) SFX.play('level'); if (window.Net) Net.profile(); }
    },
    /* the badge: tier crest, name and (optionally) the number */
    badge(r, o = {}) {
      const T = tier(r);
      return U.el('span', { class: 'badge ' + T.cls + (o.small ? ' small' : ''), title: T.label + ' · ' + Math.round(r) },
        U.el('i', { class: 'crest' }), o.noText ? null : U.el('span', null, T.label), o.num === false ? null : U.el('b', null, Math.round(r)));
    },
    lvChip: xp => U.el('span', { class: 'lvchip', title: 'Level' }, 'LV ' + level(xp).lv),

    /* ---------------------------------------------------------- the leaderboard */
    board(tab) {
      tab = tab || Rank._tab || 'global'; Rank._tab = tab;
      const { el } = U, { btn, topbar } = Menu.ui, S = Auth.S;
      const draw = () => {
        if (!document.querySelector('.screen.leader')) { off(); return; }
        const mine = Net.myProfile();
        let rows = [...Net.profiles.values()].filter(p => p.g > 0 || p.id === Auth.id);
        if (!rows.some(p => p.id === Auth.id)) rows.push(mine);
        if (tab === 'friends') rows = rows.filter(p => p.id === Auth.id || S.friends[p.id]);
        rows.sort((a, b) => b.r - a.r || b.w - a.w || a.n.localeCompare(b.n));
        const myPos = rows.findIndex(p => p.id === Auth.id) + 1;
        list.innerHTML = '';
        if (!rows.length) list.append(el('p', { class: 'empty' }, 'No ranked players yet.'));
        rows.slice(0, 200).forEach((p, i) => list.append(el('button', { class: 'lbrow' + (p.id === Auth.id ? ' me' : '') + (i < 3 ? ' top' + (i + 1) : ''), onclick: () => Social.card(p.id) },
          el('span', { class: 'lbpos' }, '#' + (i + 1)), Rank.badge(p.r, { small: true, num: false }),
          el('span', { class: 'lbname' }, el('b', null, p.n), el('small', null, '#' + p.id.slice(0, 4).toUpperCase())),
          el('span', { class: 'lbrec' }, p.w + 'W ' + p.l + 'L'), el('span', { class: 'lvchip' }, 'LV ' + (p.lv || 1)), el('b', { class: 'lbr' }, Math.round(p.r)))));
        info.textContent = Net.state === 'up' ? (rows.length + ' ranked player' + (rows.length === 1 ? '' : 's') + (myPos ? ' · you\'re #' + myPos : '')) : Net.state === 'off' ? 'You\'re offline: only you are shown. Go online from the hub.' : 'Connecting...';
      };
      const list = el('div', { class: 'lblist' }), info = el('small', { class: 'lbinfo' });
      const R = S.rank, T = tier(R.rating);
      const hist = R.hist.slice(-30);
      const spark = hist.length > 1 ? (() => {
        const lo = Math.min(...hist.map(h => h.r)) - 10, hi = Math.max(...hist.map(h => h.r)) + 10, w = 240, h = 48;
        const pts = hist.map((x, i) => (i / (hist.length - 1) * w).toFixed(1) + ',' + (h - (x.r - lo) / (hi - lo) * h).toFixed(1)).join(' ');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); svg.setAttribute('class', 'spark');
        svg.innerHTML = '<polyline fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" points="' + pts + '"/>';
        return svg;
      })() : el('small', { class: 'muted' }, 'Play ranked matches to chart your rating.');
      const scr = el('div', { class: 'screen leader' }, topbar('LEADERBOARD', () => Menu.hub()),
        el('div', { class: 'panel lbpanel' },
          el('div', { class: 'myrank ' + T.cls },
            el('div', { class: 'bigcrest' }, el('i', { class: 'crest' })),
            el('div', { class: 'myrankt' }, el('small', null, 'YOUR RANK'), el('h2', null, T.label), el('b', null, R.rating + ' rating'),
              el('small', null, R.wins + ' wins · ' + R.losses + ' losses' + (R.draws ? ' · ' + R.draws + ' draws' : '') + ' · peak ' + R.peak),
              T.next ? el('div', { class: 'tierbar' }, el('i', { style: { width: U.clamp((R.rating - T.min) / (T.next - T.min) * 100, 2, 100) + '%' } })) : null,
              T.next ? el('small', null, (T.next - R.rating) + ' to ' + tier(T.next).name) : el('small', null, 'The top tier.')),
            el('div', { class: 'myspark' }, spark),
            btn('RANKED MATCH', () => Online.ranked(), 'big hot', '1v1 · best total over 3 words')),
          el('div', { class: 'tabs' }, ...[['global', 'GLOBAL'], ['friends', 'FRIENDS']].map(([k, t]) => el('button', { class: tab === k ? 'on' : '', onclick: () => Rank.board(k) }, t))),
          info, list,
          el('p', { class: 'fine' }, 'Ratings are posted (signed) by each player\'s own game to a free public relay, so the board shows what their games report. Tiers: Bronze, Silver, Gold, Platinum, Diamond (each III, II, I), Master, Legend.')));
      App.screen(scr);
      const off = Net.on('profiles', draw), off2 = Net.on('state', draw);
      App.onLeave(() => { off(); off2(); });
      draw();
    },
  };
})();
