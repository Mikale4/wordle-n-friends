/* ============================================================================
   games.js -- the games besides Wordle, and the contract each one follows.

   Runecasters (js/runes.js), Wordwright (js/wright.js) and Chess (js/chess.js)
   are turn-based. Each module calls Games.add({...}) with the object below;
   js/match.js runs any of them: against CPU players on this device, or
   online in a room, where the host's game runs the rules for everyone.

   ABOUT THE GAME
     id         'runes' | 'wright' | 'chess'
     name       shown everywhere ('Runecasters')
     blurb      one line for the game picker
     players    [min, max] seats
     options    settings for a match, shown in the room and before a CPU game:
                [{ key: 'rounds', label: 'ROUNDS', values: [[3, '3'], [5, '5']], def: 5 }, ...]
     lex        true if the rules need the dictionary (await Lex.load() first)

   THE RULES (no DOM; plain data in and out; the host runs them)
     setup(opts, players, now) -> state
                players: [{ id, name }] in seat order (ids are strings)
                state: plain JSON-able data (it may hold secrets: racks, the bag)
     view(state, pid, now) -> view
                what player pid may see right now (pid null: someone watching).
                Plain JSON-able and small: it goes over the network after
                every move. Times go in as milliseconds LEFT (clocks differ
                between computers), never as timestamps.
     move(state, pid, m, now) -> { state } | { err: 'text for the player' }
                checks it's pid's turn and the move is legal; never throws on
                bad input (m comes from the network). Returns a new state or
                mutates and returns the same one, either is fine.
     turn(state) -> [pid, ...]     who may move now ([] once it's over)
     due(state, now) -> pid | null a player whose time has run out (polled)
     timeout(state, pid, now) -> { state }   what running out of time does
     result(state) -> null | { ranks: [[pid, ...], ...], scores: { pid: n }, text }
                null while playing. ranks: best first, ties share a group.
     cpu(state, pid, level, now) -> Promise<m>   a move for a CPU player;
                level 'easy' | 'normal' | 'hard'. Should take under ~2 s.

   THE SCREEN
     mount(el, api) -> { update(view), destroy() }
                draws the game into el (everything under the app's top bar)
                and calls update() with every new view.
       api.me         my pid, or null when watching
       api.players    [{ id, name, cpu }] in seat order
       api.act(m)     make a move; a new view comes back through update(), or
                      a refusal through api.toast(text, 'bad')
       api.toast(text, kind)    a short message ('gold', 'bad', or none)
       api.sfx(name)            SFX.play: 'key' 'del' 'ok' 'back' 'bad' 'solve' 'win' 'lose' 'tick' 'ping'
       api.online     true in an online room
   ========================================================================== */
(function () {
  'use strict';
  const G = typeof window !== 'undefined' ? window : self;
  const list = [];
  G.Games = {
    list,
    add(g) { if (!list.some(x => x.id === g.id)) list.push(g); },
    get(id) { return list.find(g => g.id === id) || null; },
    /* a match's settings, with every missing one at its default */
    opts(g, o) { const r = {}; for (const op of g.options || []) r[op.key] = o && o[op.key] != null && op.values.some(v => String(v[0]) === String(o[op.key])) ? op.values.find(v => String(v[0]) === String(o[op.key]))[0] : op.def; return r; },
  };
})();
