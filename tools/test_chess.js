/* test_chess.js -- checks the chess rules, the CPU and the view in node:  node tools/test_chess.js */
'use strict';
const path = require('path'), assert = require('assert');
global.window = global;
if (!global.crypto) global.crypto = require('crypto').webcrypto;
require(path.join(__dirname, '..', 'js', 'util.js'));
require(path.join(__dirname, '..', 'js', 'games.js'));
require(path.join(__dirname, '..', 'js', 'chess.js'));
const C = Games.get('chess'), L = C.lib;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

/* helpers: a game between a (white) and b (black); moves in UCI ('e2e4', 'e7e8q') */
const A = { id: 'a', name: 'Ann' }, B = { id: 'b', name: 'Bob' };
const game = (o = {}, now = 0) => C.setup(o, [A, B], now);
const um = u => u.length > 4 ? { from: u.slice(0, 2), to: u.slice(2, 4), promo: u[4] } : { from: u.slice(0, 2), to: u.slice(2, 4) };
const side = st => C.view(st, null, 0).turn;
function go(st, ...ucis) {
  for (const u of ucis) {
    const r = C.move(st, st.ids[side(st)], um(u), st.since);
    if (r.err) throw new Error(u + ': ' + r.err);
    st = r.state;
  }
  return st;
}
const fenOf = st => st.fen.split(' ').slice(0, 4).join(' ');
const play = (fen, u) => L.play(fen, u.slice(0, 2), u.slice(2, 4), u[4]);
/* an independent brute-force check: can the side to move force mate within n moves? (the first such move) */
function mates(fen, n) {
  for (const u of L.legal(fen)) {
    const r = play(fen, u), rep = L.legal(r.fen);
    if (!rep.length) { if (L.info(r.fen).check) return u; continue; }
    if (n > 1 && rep.every(v => mates(play(r.fen, v).fen, n - 1))) return u;
  }
  return null;
}
const KIWI = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

/* ---------------------------------------------------------------- move generation */
t('perft: start position, depth 1-4', () => {
  const t0 = Date.now();
  assert.deepStrictEqual([1, 2, 3, 4].map(d => L.perft(L.START, d)), [20, 400, 8902, 197281]);
  console.log('  perft start 1-4: 20 400 8902 197281 (' + (Date.now() - t0) + ' ms)');
});
t('perft: start position, depth 5', () => { const t0 = Date.now(); assert.strictEqual(L.perft(L.START, 5), 4865609); console.log('  perft start 5: 4865609 (' + (Date.now() - t0) + ' ms)'); });
t('perft: Kiwipete, depth 1-3', () => {
  const t0 = Date.now();
  assert.deepStrictEqual([1, 2, 3].map(d => L.perft(KIWI, d)), [48, 2039, 97862]);
  assert.strictEqual(L.perft(KIWI, 4), 4085603);
  console.log('  perft Kiwipete 1-4: 48 2039 97862 4085603 (' + (Date.now() - t0) + ' ms)');
});
t('perft: positions 3, 4 and 5 (pins, en passant, promotions)', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 5].map(d => L.perft('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', d)), [14, 191, 2812, 43238, 674624]);
  assert.deepStrictEqual([1, 2, 3, 4].map(d => L.perft('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', d)), [6, 264, 9467, 422333]);
  assert.deepStrictEqual([1, 2, 3].map(d => L.perft('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', d)), [44, 1486, 62379]);
});
t('FEN in and out', () => {
  for (const f of [L.START, KIWI, '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8']) assert.strictEqual(L.fen(L.parse(f)), f);
  for (const bad of [null, '', 'garbage', '8/8/8/8/8/8/8/8 w - - 0 1', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w KQkq - 0 1', 'rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w', 'P3k3/8/8/8/8/8/8/4K3 w - - 0 1', '4k3/8/8/8/8/8/8/4K2r b - - 0 1', 'kk6/8/8/8/8/8/8/4K3 w - - 0 1'])
    assert.strictEqual(L.parse(bad), null, String(bad));
  assert.strictEqual(L.fen(L.parse('r3k2r/8/8/8/8/8/8/4K3 w KQkq - 0 1')).split(' ')[2], 'kq', 'rights without the pieces are dropped');
});

/* ---------------------------------------------------------------- the special moves */
const CASTLE = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
t('castling: both sides, both ways, rook moves too', () => {
  const ms = L.legal(CASTLE);
  assert.ok(ms.includes('e1g1') && ms.includes('e1c1'));
  let st = go(game({ fen: CASTLE }), 'e1g1', 'e8c8');
  assert.strictEqual(fenOf(st), '2kr3r/pppppppp/8/8/8/8/PPPPPPPP/R4RK1 w - -');
  assert.deepStrictEqual(st.sans, ['O-O', 'O-O-O']);
});
t('castling: not out of, through or into check', () => {
  assert.ok(!L.legal('r3k2r/8/8/8/8/8/8/R3K1r1 w KQkq - 0 1').includes('e1c1'), 'in check');   // g1 rook checks along the rank
  const through = L.legal('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1');                                // f2 rook covers f1
  assert.ok(!through.includes('e1g1') && through.includes('e1c1'));
  const into = L.legal('r3k2r/8/8/8/8/8/2r3r1/R3K2R w KQkq - 0 1');                                  // c2 and g2 cover c1 and g1
  assert.ok(!into.includes('e1g1') && !into.includes('e1c1'));
  assert.ok(L.legal('1r2k3/8/8/8/8/8/8/R3K3 w Q - 0 1').includes('e1c1'), 'b1 may be attacked');
  assert.ok(!L.legal('r3k2r/8/8/8/8/8/8/RN2K1NR w KQkq - 0 1').some(u => u === 'e1g1' || u === 'e1c1'), 'pieces in the way');
});
t('castling: rights go when the king or a rook moves, or a rook is taken', () => {
  const bare = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  assert.strictEqual(go(game({ fen: bare }), 'h1h2').fen.split(' ')[2], 'Qkq');
  assert.strictEqual(go(game({ fen: bare }), 'e1f1').fen.split(' ')[2], 'kq');
  const st = go(game({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' }), 'a1a8');
  assert.strictEqual(st.fen.split(' ')[2], 'Kk', 'the a8 rook taken: black loses O-O-O too');
  assert.ok(!L.legal(go(game({ fen: CASTLE }), 'e1f1', 'a7a6', 'f1e1', 'a6a5').fen).includes('e1g1'), 'the king went back');
});
t('en passant: right after the double step only', () => {
  let st = go(game(), 'e2e4');
  assert.strictEqual(st.fen.split(' ')[3], '-', 'no ep square when no pawn can take');
  st = go(st, 'a7a6', 'e4e5', 'd7d5');
  assert.strictEqual(st.fen.split(' ')[3], 'd6');
  const ep = go(st, 'e5d6');
  assert.strictEqual(fenOf(ep), 'rnbqkbnr/1pp1pppp/p2P4/8/8/8/PPPP1PPP/RNBQKBNR b KQkq -');
  assert.strictEqual(ep.sans[4], 'exd6');
  assert.strictEqual(ep.caps[0], 'p');
  const late = go(st, 'g1f3', 'g8f6');
  assert.ok(!L.legal(late.fen).includes('e5d6'), 'one move later it has gone');
});
t('en passant: not when it would expose the king', () => {
  const f = '8/8/8/KPp4r/8/8/8/7k w - c6 0 1';           // b5xc6 would open the rank to the h5 rook
  assert.ok(!L.legal(f).includes('b5c6'));
  assert.strictEqual(L.fen(L.parse(f)).split(' ')[3], '-', 'so the position has no ep square');
  assert.ok(L.legal('8/8/8/1Pp4r/8/8/8/K6k w - c6 0 1').includes('b5c6'));
});
t('promotion: a piece is needed; any of the four; SAN', () => {
  const st = game({ fen: '1n5k/P7/8/8/8/8/8/K7 w - - 0 1' });
  assert.ok(/promote/i.test(C.move(st, 'a', { from: 'a7', to: 'a8' }, 0).err));
  assert.ok(C.move(st, 'a', { from: 'a7', to: 'a8', promo: 'k' }, 0).err);
  for (const [p, letter] of [['q', 'Q'], ['r', 'R'], ['b', 'B'], ['n', 'N']]) {
    const r = C.move(st, 'a', { from: 'a7', to: 'a8', promo: p }, 0);
    assert.ok(r.state && r.state.fen.startsWith(letter + 'n'), p);
  }
  assert.strictEqual(go(st, 'a7b8q').sans[0], 'axb8=Q+');
  assert.strictEqual(go(st, 'a7a8n').sans[0], 'a8=N');
  assert.ok(C.move(st, 'a', { from: 'a7', to: 'a8', promo: 'Q' }, 0).state, 'upper case is fine');
});
t('SAN: telling twins apart, captures, check and mate', () => {
  const s = L.sans('k7/8/8/8/8/8/8/KR3R2 w - - 0 1');
  assert.ok(s.includes('Rbd1') && s.includes('Rfd1') && s.includes('Rb8+'));
  const s2 = L.sans('7k/8/8/8/R7/8/8/R3K3 w - - 0 1');
  assert.ok(s2.includes('R1a2') && s2.includes('R4a2') && s2.includes('Rb4') && !s2.includes('Ra2'));
  const s3 = L.sans('7k/8/8/1N6/8/1N3N2/8/K7 w - - 0 1');
  assert.ok(s3.includes('Nb3d4') && s3.includes('N5d4') && s3.includes('Nfd4'), 'three knights: ' + s3.join(' '));
  assert.ok(L.sans('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1').includes('Ra8#'));
});

/* ---------------------------------------------------------------- how games end */
t('checkmate (fool\'s mate)', () => {
  const st = go(game(), 'f2f3', 'e7e5', 'g2g4', 'd8h4');
  assert.deepStrictEqual(st.over, { w: 1, why: 'Checkmate' });
  assert.strictEqual(st.sans[3], 'Qh4#');
  assert.strictEqual(st.check, 'e1');
  assert.deepStrictEqual(C.result(st), { ranks: [['b'], ['a']], scores: { b: 1, a: 0 }, text: 'Checkmate' });
  assert.deepStrictEqual(C.turn(st), []);
  assert.ok(C.move(st, 'a', um('e1f2'), 0).err);
});
t('stalemate', () => {
  const st = go(game({ fen: 'k7/8/8/1Q6/8/8/8/7K w - - 0 1' }), 'b5b6');
  assert.deepStrictEqual(st.over, { w: -1, why: 'Stalemate' });
  assert.deepStrictEqual(C.result(st), { ranks: [['a', 'b']], scores: { a: 0.5, b: 0.5 }, text: 'Stalemate' });
});
t('fifty-move rule', () => {
  let st = go(game({ fen: 'k7/8/8/8/8/8/8/K6R w - - 98 80' }), 'h1h2');
  assert.strictEqual(st.over, null);
  st = go(st, 'a8b8');
  assert.deepStrictEqual(st.over, { w: -1, why: 'Draw by the fifty-move rule' });
  assert.strictEqual(go(game({ fen: 'k7/8/8/8/8/8/p7/K6R w - - 98 80' }), 'a1a2', 'a8b8').over, null, 'a capture resets the count');
  const mate = go(game({ fen: '7k/8/6K1/8/8/8/8/R7 w - - 99 80' }), 'a1a8');
  assert.strictEqual(mate.over.why, 'Checkmate', 'mate on the 100th half-move still wins');
});
t('threefold repetition', () => {
  let st = go(game(), 'g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1');
  assert.strictEqual(st.over, null);
  st = go(st, 'f6g8');
  assert.deepStrictEqual(st.over, { w: -1, why: 'Draw by repetition' });
  // the same squares with different castling rights isn't the same position
  let s2 = go(game(), 'e2e4', 'e7e5', 'e1e2', 'e8e7', 'e2e1', 'e7e8', 'e1e2', 'e8e7', 'e2e1', 'e7e8');
  assert.strictEqual(s2.over, null, 'rights lost after the first king walk');
  s2 = go(s2, 'e1e2', 'e8e7');
  assert.strictEqual(s2.over.why, 'Draw by repetition');
});
t('insufficient material', () => {
  const st = go(game({ fen: 'k7/8/8/8/8/8/1q6/K7 w - - 0 1' }), 'a1b2');
  assert.deepStrictEqual(st.over, { w: -1, why: 'Draw by insufficient material' });
  assert.ok(L.insufficient('k7/8/8/8/8/8/8/KN6 w - - 0 1'));
  assert.ok(L.insufficient('k7/8/8/8/8/8/8/KB5b w - - 0 1'), 'bishops on one colour');
  assert.ok(!L.insufficient('k7/8/8/8/8/8/8/KB4b1 w - - 0 1'), 'bishops on both colours');
  assert.ok(!L.insufficient('k7/8/8/8/8/8/8/KNN5 w - - 0 1'));
  assert.ok(!L.insufficient('k7/8/8/8/8/8/8/KN4n1 w - - 0 1'));
  assert.ok(!L.insufficient('k7/8/8/8/8/8/P7/K7 w - - 0 1'));
});

/* ---------------------------------------------------------------- clocks */
t('clocks: white\'s first move is free, then each move costs time and earns the increment', () => {
  let st = game({ clock: '3+2' }, 1000);
  assert.deepStrictEqual(st.ms, [180000, 180000]);
  assert.strictEqual(C.due(st, 1e9), null, 'no clock runs before the first move');
  assert.deepStrictEqual(C.view(st, 'a', 50000).clock, { ms: [180000, 180000], run: null, inc: 2000 });
  st = C.move(st, 'a', um('e2e4'), 61000).state;
  assert.deepStrictEqual(st.ms, [180000, 180000]);
  assert.deepStrictEqual(C.view(st, 'a', 64000).clock, { ms: [180000, 177000], run: 1, inc: 2000 });
  st = C.move(st, 'b', um('e7e5'), 66000).state;
  assert.deepStrictEqual(st.ms, [180000, 177000]);       // 5 s used, 2 s back
  st = C.move(st, 'a', um('g1f3'), 76000).state;
  assert.deepStrictEqual(st.ms, [172000, 177000]);
  assert.deepStrictEqual(C.view(st, 'b', 77500).clock.ms, [172000, 175500]);
  assert.deepStrictEqual(Games.opts(C, { clock: '10+0' }), { clock: '10+0' });
  assert.deepStrictEqual(Games.opts(C, { clock: 'bogus' }), { clock: 'none' });
  assert.strictEqual(game().clock, null);
  assert.strictEqual(C.view(game(), 'a', 0).clock, null);
});
t('clocks: a flag falls; due and timeout', () => {
  let st = game({ clock: '5+0' }, 0);
  st = go(st, 'e2e4');                                    // st.since = 0: black's clock from 0
  assert.strictEqual(C.due(st, 299999), null);
  assert.strictEqual(C.due(st, 300000), 'b');
  assert.ok(/time/i.test(C.move(st, 'b', um('e7e5'), 300500).err), 'a move after the flag is refused');
  const r = C.timeout(st, 'b', 300500).state;
  assert.deepStrictEqual(r.over, { w: 0, why: 'Lost on time' });
  assert.strictEqual(r.ms[1], 0);
  assert.deepStrictEqual(C.result(r), { ranks: [['a'], ['b']], scores: { a: 1, b: 0 }, text: 'Lost on time' });
  assert.strictEqual(C.due(r, 1e9), null);
  assert.strictEqual(C.view(r, 'a', 1e9).clock.run, null);
  assert.strictEqual(C.timeout(st, 'nobody', 0).state.over, null);
});
t('clocks: running out against a lone king (or king and minor piece) is a draw', () => {
  let st = go(game({ fen: 'k7/8/8/8/8/8/7q/K5N1 w - - 0 1', clock: '3+2' }, 0), 'g1e2');
  assert.strictEqual(C.timeout(st, 'b', 1e6).state.over.w, -1, 'white has only K+N');
  st = go(game({ fen: 'k7/8/8/8/8/8/7q/K4RN1 w - - 0 1', clock: '3+2' }, 0), 'g1e2');
  assert.strictEqual(C.timeout(st, 'b', 1e6).state.over.w, 0, 'white still has a rook');
});

/* ---------------------------------------------------------------- resigning and draws */
t('resign, by either player at any time', () => {
  const st = go(game(), 'e2e4');
  const r = C.move(st, 'a', { resign: true }, 0).state;     // not white's turn: still fine
  assert.deepStrictEqual(r.over, { w: 1, why: 'Resigned' });
  assert.deepStrictEqual(C.result(r).ranks, [['b'], ['a']]);
  assert.ok(C.move(r, 'b', um('e7e5'), 0).err, 'nothing after the end');
  assert.ok(C.move(st, 'b', { resign: 'yes' }, 0).err);
});
t('draw offers: offer, decline, again only after a move, accept', () => {
  let st = go(game(), 'e2e4');
  st = C.move(st, 'a', { draw: 'offer' }, 0).state;
  assert.strictEqual(st.offer, 0);
  assert.strictEqual(C.view(st, 'b', 0).offer, 0);
  assert.strictEqual(C.view(st, 'a', 0).mayOffer, false);
  assert.ok(C.move(st, 'a', { draw: 'offer' }, 0).err, 'twice');
  assert.ok(C.move(st, 'a', { draw: 'accept' }, 0).err, 'your own offer');
  assert.deepStrictEqual(C.turn(st), ['b']);
  const dec = C.move(st, 'b', { draw: 'decline' }, 0).state;
  assert.strictEqual(dec.offer, null);
  assert.ok(C.move(dec, 'a', { draw: 'offer' }, 0).err, 'not again before a move');
  assert.ok(C.move(dec, 'b', { draw: 'decline' }, 0).err, 'nothing to decline');
  const later = go(dec, 'e7e5', 'g1f3');
  assert.ok(C.move(later, 'a', { draw: 'offer' }, 0).state, 'after a move, yes');
  const acc = C.move(st, 'b', { draw: 'accept' }, 0).state;
  assert.deepStrictEqual(acc.over, { w: -1, why: 'Draw agreed' });
  assert.deepStrictEqual(C.result(acc), { ranks: [['a', 'b']], scores: { a: 0.5, b: 0.5 }, text: 'Draw agreed' });
  assert.ok(C.move(st, 'b', { draw: 'maybe' }, 0).err);
});
t('draw offers lapse when the opponent moves; offering back accepts', () => {
  let st = C.move(game(), 'a', { draw: 'offer' }, 0).state;  // offered on your own move
  st = go(st, 'e2e4');
  assert.strictEqual(st.offer, 0, 'the offer stands after your own move');
  st = go(st, 'e7e5');
  assert.strictEqual(st.offer, null, 'gone once the opponent moves on');
  st = C.move(st, 'b', { draw: 'offer' }, 0).state;
  assert.deepStrictEqual(C.move(st, 'a', { draw: 'offer' }, 0).state.over, { w: -1, why: 'Draw agreed' });
});
t('turn: the side to move, plus whoever has a draw offer to answer', () => {
  const st = game();
  assert.deepStrictEqual(C.turn(st), ['a']);
  assert.deepStrictEqual(C.turn(go(st, 'e2e4')), ['b']);
  assert.deepStrictEqual(C.turn(C.move(st, 'a', { draw: 'offer' }, 0).state), ['a', 'b']);
});

/* ---------------------------------------------------------------- the view */
t('view: what it holds; watchers; times are left, not timestamps', () => {
  let st = go(game({ clock: '10+0' }, 5e12), 'e2e4', 'd7d5', 'e4d5');
  const v = C.view(st, 'b', 5e12 + 1000);
  assert.strictEqual(v.fen, st.fen);
  assert.strictEqual(v.turn, 1); assert.strictEqual(v.you, 1);
  assert.deepStrictEqual(v.last, ['e4', 'd5']);
  assert.deepStrictEqual(v.caps, ['p', '']);
  assert.deepStrictEqual(v.sans, ['e4', 'd5', 'exd5']); assert.strictEqual(v.sn, 0);
  assert.deepStrictEqual(v.clock, { ms: [600000, 599000], run: 1, inc: 0 });
  assert.strictEqual(v.check, null); assert.strictEqual(v.offer, null); assert.strictEqual(v.over, null); assert.strictEqual(v.mayOffer, true);
  const w = C.view(st, null, 5e12);
  assert.strictEqual(w.you, null); assert.strictEqual(w.mayOffer, false);
  assert.strictEqual(C.view(st, 'stranger', 5e12).you, null);
  assert.ok(!JSON.stringify(v).includes('5000000'), 'no timestamps');
  st = go(st, 'd8d5', 'b1c3', 'd5e5');
  assert.strictEqual(C.view(st, 'a', 0).check, 'e1');
});
t('view: stays small, even after a very long game', () => {
  const st = game({ clock: '3+2' });
  st.sans = Array.from({ length: 900 }, () => 'exd8=Q+'); st.offer = 1;
  const v = C.view(st, 'a', 0), size = JSON.stringify(v).length;
  assert.ok(size < 4096, size + ' bytes');
  assert.strictEqual(v.sn + v.sans.length, 900);
  console.log('  view of a 900-ply game: ' + size + ' bytes (the last ' + v.sans.length + ' moves)');
});

/* ---------------------------------------------------------------- bad input */
t('bad input returns { err } and never throws', () => {
  const st = go(game({ clock: '3+2' }), 'e2e4'), before = JSON.stringify(st);
  const junk = [null, undefined, 0, 42, 'e7e5', [], ['e7', 'e5'], {}, { from: 'e7' }, { to: 'e5' }, { from: 'e7', to: 'e9' }, { from: 'z7', to: 'e5' }, { from: 'E7', to: 'E5' },
    { from: 7, to: 5 }, { from: {}, to: [] }, { from: 'e7', to: 'e5', promo: 'k' }, { from: 'e7', to: 'e5', promo: {} }, { draw: 'maybe' }, { draw: true }, { resign: 'yes' }, { resign: false },
    { from: 'e7', to: 'e4' }, { from: 'e2', to: 'e3' }, { from: 'e8', to: 'e7' }, { from: 'd8', to: 'h4' }, { from: '__proto__', to: 'constructor' }, Object.create(null),
    new Proxy({}, { get() { throw new Error('boom'); } })];
  junk.forEach((m, i) => {
    let r;
    assert.doesNotThrow(() => { r = C.move(st, 'b', m, 0); }, 'junk #' + i);
    assert.ok(r && typeof r.err === 'string', 'refused: junk #' + i);
  });
  assert.ok(/turn/.test(C.move(st, 'a', um('d2d4'), 0).err), 'the wrong player');
  assert.ok(C.move(st, 'zed', um('e7e5'), 0).err, 'a stranger');
  assert.ok(C.move(st, null, um('e7e5'), 0).err, 'a watcher');
  assert.ok(C.move(st, undefined, um('e7e5'), 0).err);
  for (const s of [null, undefined, {}, 'x', { ids: 'ab', fen: 5 }, { ids: ['a', 'b'], fen: 'nonsense' }]) assert.ok(C.move(s, 'a', um('e2e4'), 0).err);
  assert.strictEqual(JSON.stringify(st), before, 'the state is untouched');
  assert.ok(/check/.test(C.move(go(game(), 'e2e4', 'f7f6', 'd1h5'), 'b', um('a7a6'), 0).err), 'ignoring check');
  assert.ok(C.move(game({ fen: '4k3/4r3/8/8/8/8/4R3/4K3 b - - 0 1' }), 'b', um('e7e5'), 0).state, 'a pinned piece may move along the pin...');
  assert.ok(C.move(game({ fen: '4k3/4r3/8/8/8/8/4R3/4K3 b - - 0 1' }), 'b', um('e7d7'), 0).err, '...but not off it');

  assert.strictEqual(C.result(null), null);
  assert.deepStrictEqual(C.turn(null), []);
  assert.strictEqual(C.due(null, 0), null);
});
t('Zobrist keys made move by move match keys made from scratch', () => {
  let st = game();
  for (let i = 0; i < 300 && !st.over; i++) {
    const ms = L.legal(st.fen), u = ms[(i * 7919 + 13) % ms.length];
    st = go(st, u);
    assert.strictEqual(st.reps[st.reps.length - 1], L.key(st.fen), 'after ' + st.sans.join(' '));
  }
});

/* ---------------------------------------------------------------- the search */
t('search: mate in 1', () => {
  for (const [fen, best] of [['6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8'], ['r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', 'h5f7']]) {
    const r = C.search(fen, 3);
    assert.strictEqual(r.from + r.to, best);
    assert.strictEqual(r.score, 29999);
  }
});
t('search: mate in 2 and in 3', () => {
  const m2 = ['kbK5/pp6/1P6/8/8/8/8/R7 w - - 0 1', '6k1/pp4p1/2p5/2bp4/8/P5Pb/1P3rrP/2BRRN1K b - - 0 1'];
  for (const fen of m2) {
    assert.ok(!mates(fen, 1) && mates(fen, 2), 'the brute force agrees it is a mate in 2');
    const r = C.search(fen, 5);
    assert.strictEqual(r.score, 29997, fen);
    const after = play(fen, r.from + r.to + (r.promo || ''));
    assert.ok(L.legal(after.fen).every(v => mates(play(after.fen, v).fen, 1)), 'its first move really forces mate');
  }
  assert.strictEqual(C.search('kbK5/pp6/1P6/8/8/8/8/R7 w - - 0 1', 5).from, 'a1');
  assert.strictEqual(C.search('r1b1kb1r/pppp1ppp/5q2/4n3/3KP3/2N3PN/PPP4P/R1BQ1B1R b kq - 0 1', 6).score, 29995, 'mate in 3');
});
t('search: takes a hanging queen, and does not hang its own', () => {
  const r = C.search('rnb1kbnr/pppp1ppp/8/4p1q1/4P3/3P4/PPP2PPP/RNBQKBNR w KQkq - 1 3', 4);
  assert.strictEqual(r.from + r.to, 'c1g5');
  const e = C.search('rnb1kbnr/pppp1ppp/8/4p1q1/4P3/3P4/PPP2PPP/RNBQKBNR w KQkq - 1 3', { easy: true });
  assert.ok(e && L.legal('rnb1kbnr/pppp1ppp/8/4p1q1/4P3/3P4/PPP2PPP/RNBQKBNR w KQkq - 1 3').includes(e.from + e.to));
});
t('search: knows the game\'s earlier positions (a lost side takes the repetition)', () => {
  const st = go(game({ fen: 'kn6/8/8/8/8/8/7Q/7K w - - 0 1' }), 'h2h3', 'b8c6', 'h3h2', 'c6b8', 'h2h3', 'b8c6', 'h3h2');
  assert.strictEqual(st.over, null);
  const r = C.search(st, 6);
  assert.strictEqual(r.from + r.to, 'c6b8'); assert.strictEqual(r.score, 0);
  assert.strictEqual(go(st, 'c6b8').over.why, 'Draw by repetition');
  assert.ok(C.search(st.fen, 6).score < -500, 'without the history it is just lost');
});
t('search: one legal move is played at once', () => {
  const r = C.search('k7/8/8/8/8/8/1r6/K1r5 w - - 0 1', { ms: 1000 });
  assert.ok(r.ms < 50 && r.from === 'a1');
});
t('search: depth and time per level', () => {
  const fens = [L.START, KIWI, 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', '8/5pk1/6p1/1p6/1P2P3/5K2/8/8 w - - 0 1'];
  for (const lv of ['easy', 'normal', 'hard']) {
    const rs = fens.map(f => { const t0 = Date.now(); const r = C.search({ fen: f }, C.levels[lv]); r.wall = Date.now() - t0; return r; });
    const avg = k => Math.round(rs.reduce((a, r) => a + r[k], 0) / rs.length);
    console.log('  ' + lv.padEnd(6) + ' depth ' + rs.map(r => r.depth).join('/') + ', avg ' + avg('wall') + ' ms (max ' + Math.max(...rs.map(r => r.wall)) + '), avg ' + avg('nodes') + ' nodes');
    const limit = { easy: 600, normal: 700, hard: 2100 }[lv];
    for (const r of rs) assert.ok(r.wall <= limit, lv + ' took ' + r.wall + ' ms');
    if (lv !== 'easy') assert.ok(Math.min(...rs.map(r => r.depth)) >= (lv === 'hard' ? 6 : 5), lv + ' depth');
  }
});

/* ---------------------------------------------------------------- the CPU player */
t('cpu: answers a draw offer (yes only when clearly worse)', async () => {
  const lost = C.move(game({ fen: 'k7/8/8/8/8/8/8/KQ6 w - - 0 1' }), 'a', { draw: 'offer' }, 0).state;
  assert.deepStrictEqual(await C.cpu(lost, 'b', 'normal', 0), { draw: 'accept' });
  const even = C.move(go(game(), 'e2e4'), 'a', { draw: 'offer' }, 0).state;
  assert.deepStrictEqual(await C.cpu(even, 'b', 'hard', 0), { draw: 'decline' });
  const won = C.move(go(game({ fen: 'k7/8/8/8/8/8/8/KQ6 w - - 0 1' }), 'b1b2'), 'b', { draw: 'offer' }, 0).state;
  assert.deepStrictEqual(await C.cpu(won, 'a', 'easy', 0), { draw: 'decline' });
});
t('cpu: a move is always legal and well formed', async () => {
  for (const lv of ['easy', 'normal']) {
    const st = go(game(), 'e2e4'), m = await C.cpu(st, 'b', lv, 0);
    assert.ok(C.move(st, 'b', m, 0).state, JSON.stringify(m));
    assert.deepStrictEqual(Object.keys(m).sort(), ['from', 'to']);
  }
  const pr = await C.cpu(game({ fen: '7k/P7/8/8/8/8/8/K7 w - - 0 1' }), 'a', 'normal', 0);
  assert.deepStrictEqual(pr, { from: 'a7', to: 'a8', promo: 'q' });
});
async function cpuGame(wl, bl, clock, maxPly) {
  let st = C.setup({ clock }, [{ id: 'w' }, { id: 'k' }], Date.now());
  const lv = { w: wl, k: bl };
  while (!st.over && st.sans.length < maxPly) {
    const pid = C.turn(st)[0], now = Date.now(), m = await C.cpu(st, pid, lv[pid], now);
    if (m.from) assert.ok(L.legal(st.fen).includes(m.from + m.to + (m.promo || '')), 'illegal ' + JSON.stringify(m) + ' in ' + st.fen);
    const r = C.move(st, pid, m, Date.now());
    assert.ok(r.state, (r.err || '') + ' ' + JSON.stringify(m));
    st = r.state;
    if (clock) { const due = C.due(st, Date.now()); if (due) st = C.timeout(st, due, Date.now()).state; }
  }
  return st;
}
t('cpu vs cpu: games end, every move legal', async () => {
  const runs = [['easy', 'easy', 'none'], ['easy', 'easy', '3+2'], ['normal', 'easy', 'none'], ['easy', 'normal', '3+2']];
  for (const [w, b, clock] of runs) {
    const t0 = Date.now(), st = await cpuGame(w, b, clock === 'none' ? undefined : clock, 1500);
    const r = C.result(st);
    console.log('  ' + w + ' vs ' + b + (clock !== 'none' ? ' (' + clock + ')' : '') + ': ' + (r ? (st.over.w < 0 ? 'draw' : st.over.w ? 'black wins' : 'white wins') + ', ' + r.text : 'unfinished') +
      ' after ' + st.sans.length + ' plies (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
    assert.ok(r, 'the game ended');
  }
});

(async () => {
  let n = 0;
  for (const [name, fn] of tests) {
    try { await fn(); n++; } catch (e) { console.error('FAIL ' + name + '\n  ' + (e && e.message || e)); process.exitCode = 1; }
  }
  console.log(n + ' checks passed' + (process.exitCode ? ' (some FAILED)' : ''));
})();
