/* ============================================================================
   chess.js -- Chess for js/games.js: the rules, the CPU player and the screen.

   THE RULES work on plain data. The state keeps the position as FEN, plus
   what FEN can't hold: the move list, the positions seen since the last pawn
   move or capture (for threefold repetition), the clocks and draw offers.
   Inside, a position is a 0x88 board (Int8Array(128), square = rank * 16 +
   file, so a square with a 0x88 bit set is off the board) with incremental
   Zobrist keys; the move generator, perft and the search all share it.

   THE CPU is an alpha-beta search (negamax with PVS, iterative deepening,
   quiescence, a transposition table, killers and history, null move, late
   move reductions) over a tapered piece-square evaluation with pawn structure
   and king safety. It runs in js/chess-ai.js, a Web Worker that loads this
   file; Chess.search(state, depth or ms) is the same search, synchronous.

   MOVES  { from: 'e2', to: 'e4' }  { from: 'e7', to: 'e8', promo: 'q' | 'r' | 'b' | 'n' }
          { resign: true }  { draw: 'offer' | 'accept' | 'decline' }
   VIEW   { fen, turn, you, last, check, caps, sans, sn, clock, offer, mayOffer, over }
          turn / you / offer are seats (0 white, 1 black); last ['e2', 'e4'];
          check: the square of a king in check; caps: ['pn', 'b'] the pieces
          white and black have taken; sans: the moves in SAN from ply sn on;
          clock: { ms: [white, black] left, run: seat or null, inc } or null;
          over: null or { w: winning seat or -1 for a draw, why }.
   NOTES  turn() also lists a player with a draw offer to answer, so a CPU gets
          asked (cpu() then answers the offer before it moves). The clocks start
          with white's first move (that move is free, as on the big sites).
          Repetition, the fifty-move rule and dead positions end the game at once.
   ========================================================================== */
(function () {
  'use strict';
  const G = typeof window !== 'undefined' ? window : self;

  /* ------------------------------------------------------------ the board */
  const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;     // a piece is type | colour << 3
  const WHITE = 0, BLACK = 1;
  const CH = ' PNBRQK  pnbrqk';                                              // piece code -> FEN letter
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const FCAP = 1, FEP = 2, FCASTLE = 4, FDOUBLE = 8;                          // move flags
  const KNIGHT_D = [33, 31, 18, 14, -14, -18, -31, -33];
  const KING_D = [17, 16, 15, 1, -1, -15, -16, -17];
  const DIRS = [17, 15, -15, -17, 16, 1, -1, -16];                           // diagonals, then lines
  const CRMASK = new Int8Array(128).fill(15);                                 // castling rights kept by a move from or to a square
  CRMASK[0] = 13; CRMASK[7] = 14; CRMASK[4] = 12; CRMASK[112] = 7; CRMASK[119] = 11; CRMASK[116] = 3;
  const sqName = s => 'abcdefgh'[s & 7] + ((s >> 4) + 1);
  const sqOf = n => typeof n === 'string' && /^[a-h][1-8]$/.test(n) ? (n.charCodeAt(1) - 49) * 16 + n.charCodeAt(0) - 97 : -1;
  /* a move is an int: from | to << 7 | promotion type << 14 | flags << 17 */
  const mk = (from, to, pr, fl) => from | to << 7 | pr << 14 | fl << 17;
  const promoCh = m => (m >> 14) & 7 ? CH[(m >> 14) & 7].toLowerCase() : '';

  /* Zobrist keys: two 32-bit halves, from a fixed seed so every computer agrees */
  const rnd = (() => { let s = 0x2545F491; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return (t ^ t >>> 14) | 0; }; })();
  const fill = n => { const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = rnd(); return a; };
  const ZP1 = fill(16 * 128), ZP2 = fill(16 * 128), ZC1 = fill(16), ZC2 = fill(16), ZE1 = fill(8), ZE2 = fill(8), ZS1 = rnd(), ZS2 = rnd();

  const STACK = 512;
  function Pos() {
    this.b = new Int8Array(128); this.stm = WHITE; this.cr = 0; this.ep = -1; this.hm = 0; this.fm = 1;
    this.k = new Int32Array(2); this.h1 = 0; this.h2 = 0; this.sp = 0;
    this.uM = new Int32Array(STACK); this.uC = new Int8Array(STACK); this.uCr = new Int8Array(STACK); this.uEp = new Int16Array(STACK);
    this.uHm = new Int32Array(STACK); this.uH1 = new Int32Array(STACK); this.uH2 = new Int32Array(STACK);
  }
  const PP = Pos.prototype;
  PP.hash = function () {
    let h1 = 0, h2 = 0;
    for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const p = this.b[s]; if (p) { h1 ^= ZP1[p << 7 | s]; h2 ^= ZP2[p << 7 | s]; } }
    h1 ^= ZC1[this.cr]; h2 ^= ZC2[this.cr];
    if (this.ep >= 0) { h1 ^= ZE1[this.ep & 7]; h2 ^= ZE2[this.ep & 7]; }
    if (this.stm) { h1 ^= ZS1; h2 ^= ZS2; }
    this.h1 = h1; this.h2 = h2;
  };
  /* is square sq attacked by side `by`? */
  PP.attacked = function (sq, by) {
    const b = this.b, c = by << 3;
    let t;
    if (by === WHITE) {
      t = sq - 15; if (!(t & 0x88) && b[t] === PAWN) return true;
      t = sq - 17; if (!(t & 0x88) && b[t] === PAWN) return true;
    } else {
      t = sq + 15; if (!(t & 0x88) && b[t] === (PAWN | 8)) return true;
      t = sq + 17; if (!(t & 0x88) && b[t] === (PAWN | 8)) return true;
    }
    const n = KNIGHT | c, k = KING | c, bi = BISHOP | c, r = ROOK | c, q = QUEEN | c;
    for (let i = 0; i < 8; i++) {
      t = sq + KNIGHT_D[i]; if (!(t & 0x88) && b[t] === n) return true;
      t = sq + KING_D[i]; if (!(t & 0x88) && b[t] === k) return true;
    }
    for (let i = 0; i < 8; i++) {
      const d = DIRS[i], a = i < 4 ? bi : r;
      t = sq + d;
      while (!(t & 0x88)) { const p = b[t]; if (p) { if (p === a || p === q) return true; break; } t += d; }
    }
    return false;
  };
  PP.inCheck = function () { return this.attacked(this.k[this.stm], this.stm ^ 1); };
  /* pseudo-legal moves into out[n..]; qs: captures and queen promotions only (the quiescence search) */
  PP.gen = function (out, n, qs) {
    const b = this.b, us = this.stm, them = us ^ 1;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = b[s];
      if (!p || (p >> 3) !== us) continue;
      const t = p & 7;
      if (t === PAWN) {
        const up = us ? -16 : 16, one = s + up, promo = (one >> 4) === (us ? 0 : 7);
        for (let side = -1; side <= 1; side += 2) {
          const to = one + side;
          if (to & 0x88) continue;
          const c = b[to];
          if (c && (c >> 3) === them) {
            if (promo) { out[n++] = mk(s, to, QUEEN, FCAP); if (!qs) { out[n++] = mk(s, to, KNIGHT, FCAP); out[n++] = mk(s, to, ROOK, FCAP); out[n++] = mk(s, to, BISHOP, FCAP); } }
            else out[n++] = mk(s, to, 0, FCAP);
          } else if (to === this.ep) out[n++] = mk(s, to, 0, FCAP | FEP);
        }
        if (!b[one]) {
          if (promo) { out[n++] = mk(s, one, QUEEN, 0); if (!qs) { out[n++] = mk(s, one, KNIGHT, 0); out[n++] = mk(s, one, ROOK, 0); out[n++] = mk(s, one, BISHOP, 0); } }
          else if (!qs) {
            out[n++] = mk(s, one, 0, 0);
            if ((s >> 4) === (us ? 6 : 1) && !b[one + up]) out[n++] = mk(s, one + up, 0, FDOUBLE);
          }
        }
      } else if (t === KNIGHT || t === KING) {
        const D = t === KNIGHT ? KNIGHT_D : KING_D;
        for (let i = 0; i < 8; i++) {
          const to = s + D[i];
          if (to & 0x88) continue;
          const c = b[to];
          if (!c) { if (!qs) out[n++] = mk(s, to, 0, 0); } else if ((c >> 3) === them) out[n++] = mk(s, to, 0, FCAP);
        }
      } else {
        for (let i = t === ROOK ? 4 : 0, e = t === BISHOP ? 4 : 8; i < e; i++) {
          const d = DIRS[i];
          for (let to = s + d; !(to & 0x88); to += d) {
            const c = b[to];
            if (!c) { if (!qs) out[n++] = mk(s, to, 0, 0); continue; }
            if ((c >> 3) === them) out[n++] = mk(s, to, 0, FCAP);
            break;
          }
        }
      }
    }
    // castling: the rights say king and rook haven't moved; the squares between must be empty and the
    // king may not be in check, pass through check or land in it
    if (!qs && this.cr) {
      if (us === WHITE) {
        if ((this.cr & 1) && !b[5] && !b[6] && !this.attacked(4, BLACK) && !this.attacked(5, BLACK) && !this.attacked(6, BLACK)) out[n++] = mk(4, 6, 0, FCASTLE);
        if ((this.cr & 2) && !b[3] && !b[2] && !b[1] && !this.attacked(4, BLACK) && !this.attacked(3, BLACK) && !this.attacked(2, BLACK)) out[n++] = mk(4, 2, 0, FCASTLE);
      } else {
        if ((this.cr & 4) && !b[117] && !b[118] && !this.attacked(116, WHITE) && !this.attacked(117, WHITE) && !this.attacked(118, WHITE)) out[n++] = mk(116, 118, 0, FCASTLE);
        if ((this.cr & 8) && !b[115] && !b[114] && !b[113] && !this.attacked(116, WHITE) && !this.attacked(115, WHITE) && !this.attacked(114, WHITE)) out[n++] = mk(116, 114, 0, FCASTLE);
      }
    }
    return n;
  };
  /* can the side to move take en passant on e (the pawn that just moved is on psq) without leaving its king in
     check? The ep square only goes into the FEN and the key when it can, so positions repeat as the rules say */
  PP.epOk = function (e, psq) {
    const b = this.b, c = this.stm, mine = PAWN | c << 3, theirs = b[psq];
    for (let i = -1; i <= 1; i += 2) {
      const a = psq + i;
      if ((a & 0x88) || b[a] !== mine) continue;
      b[a] = 0; b[psq] = 0; b[e] = mine;
      const bad = this.attacked(this.k[c], c ^ 1);
      b[a] = mine; b[psq] = theirs; b[e] = 0;
      if (!bad) return true;
    }
    return false;
  };
  PP.make = function (m) {
    const b = this.b, from = m & 127, to = (m >> 7) & 127, pr = (m >> 14) & 7, fl = m >> 17;
    const us = this.stm, p = b[from], s = this.sp++;
    let h1 = this.h1, h2 = this.h2, cap = b[to];
    this.uM[s] = m; this.uCr[s] = this.cr; this.uEp[s] = this.ep; this.uHm[s] = this.hm; this.uH1[s] = h1; this.uH2[s] = h2;
    if (this.ep >= 0) { h1 ^= ZE1[this.ep & 7]; h2 ^= ZE2[this.ep & 7]; }
    h1 ^= ZC1[this.cr]; h2 ^= ZC2[this.cr];
    if (fl & FEP) {
      const cs = to + (us ? 16 : -16);
      cap = b[cs]; b[cs] = 0; h1 ^= ZP1[cap << 7 | cs]; h2 ^= ZP2[cap << 7 | cs];
    } else if (cap) { h1 ^= ZP1[cap << 7 | to]; h2 ^= ZP2[cap << 7 | to]; }
    this.uC[s] = cap;
    const np = pr ? pr | us << 3 : p;
    b[from] = 0; b[to] = np;
    h1 ^= ZP1[p << 7 | from] ^ ZP1[np << 7 | to]; h2 ^= ZP2[p << 7 | from] ^ ZP2[np << 7 | to];
    if ((p & 7) === KING) {
      this.k[us] = to;
      if (fl & FCASTLE) {
        const rf = to > from ? from + 3 : from - 4, rt = to > from ? from + 1 : from - 1, r = b[rf];
        b[rf] = 0; b[rt] = r;
        h1 ^= ZP1[r << 7 | rf] ^ ZP1[r << 7 | rt]; h2 ^= ZP2[r << 7 | rf] ^ ZP2[r << 7 | rt];
      }
    }
    this.hm = (p & 7) === PAWN || cap ? 0 : this.hm + 1;
    this.cr &= CRMASK[from] & CRMASK[to];
    h1 ^= ZC1[this.cr] ^ ZS1; h2 ^= ZC2[this.cr] ^ ZS2;
    this.stm = us ^ 1;
    if (us) this.fm++;
    this.ep = -1;
    if ((fl & FDOUBLE) && this.epOk((from + to) >> 1, to)) { this.ep = (from + to) >> 1; h1 ^= ZE1[to & 7]; h2 ^= ZE2[to & 7]; }
    this.h1 = h1; this.h2 = h2;
  };
  PP.unmake = function () {
    const s = --this.sp, m = this.uM[s], b = this.b;
    const from = m & 127, to = (m >> 7) & 127, pr = (m >> 14) & 7, fl = m >> 17;
    const us = this.stm ^ 1, cap = this.uC[s], p = pr ? PAWN | us << 3 : b[to];
    b[from] = p;
    if (fl & FEP) { b[to] = 0; b[to + (us ? 16 : -16)] = cap; } else b[to] = cap;
    if ((p & 7) === KING) {
      this.k[us] = from;
      if (fl & FCASTLE) { const rf = to > from ? from + 3 : from - 4, rt = to > from ? from + 1 : from - 1; b[rf] = b[rt]; b[rt] = 0; }
    }
    this.stm = us; this.cr = this.uCr[s]; this.ep = this.uEp[s]; this.hm = this.uHm[s]; this.h1 = this.uH1[s]; this.h2 = this.uH2[s];
    if (us) this.fm--;
  };
  PP.makeNull = function () {
    const s = this.sp++;
    this.uM[s] = 0; this.uCr[s] = this.cr; this.uEp[s] = this.ep; this.uHm[s] = this.hm; this.uH1[s] = this.h1; this.uH2[s] = this.h2;
    if (this.ep >= 0) { this.h1 ^= ZE1[this.ep & 7]; this.h2 ^= ZE2[this.ep & 7]; this.ep = -1; }
    this.stm ^= 1; this.h1 ^= ZS1; this.h2 ^= ZS2; this.hm++;
  };
  PP.unmakeNull = function () {
    const s = --this.sp;
    this.stm ^= 1; this.ep = this.uEp[s]; this.hm = this.uHm[s]; this.h1 = this.uH1[s]; this.h2 = this.uH2[s];
  };
  const BUF = new Int32Array(256);
  PP.legal = function () {
    const n = this.gen(BUF, 0, false), us = this.stm, out = [];
    for (let i = 0; i < n; i++) { const m = BUF[i]; this.make(m); if (!this.attacked(this.k[us], us ^ 1)) out.push(m); this.unmake(); }
    return out;
  };
  /* the position's key (for repetitions): both Zobrist halves as 16 hex digits */
  PP.key = function () { return (this.h1 >>> 0).toString(16).padStart(8, '0') + (this.h2 >>> 0).toString(16).padStart(8, '0'); };

  /* FEN in (null if it isn't a legal-looking position) and out */
  function parse(fen) {
    const f = String(fen == null ? '' : fen).trim().split(/\s+/), rows = (f[0] || '').split('/');
    if (rows.length !== 8) return null;
    const P = new Pos(), b = P.b, kings = [0, 0];
    for (let r = 0; r < 8; r++) {
      let file = 0;
      for (const ch of rows[r]) {
        if (ch >= '1' && ch <= '8') { file += +ch; continue; }
        const code = CH.indexOf(ch);
        if (code < 1 || file > 7) return null;
        const s = (7 - r) * 16 + file;
        if ((code & 7) === PAWN && (r === 0 || r === 7)) return null;
        if ((code & 7) === KING) { kings[code >> 3]++; P.k[code >> 3] = s; }
        b[s] = code; file++;
      }
      if (file !== 8) return null;
    }
    if (kings[0] !== 1 || kings[1] !== 1) return null;
    P.stm = f[1] === 'b' ? BLACK : WHITE;
    const c = f[2] || '-';
    if (c.includes('K') && b[4] === KING && b[7] === ROOK) P.cr |= 1;
    if (c.includes('Q') && b[4] === KING && b[0] === ROOK) P.cr |= 2;
    if (c.includes('k') && b[116] === (KING | 8) && b[119] === (ROOK | 8)) P.cr |= 4;
    if (c.includes('q') && b[116] === (KING | 8) && b[112] === (ROOK | 8)) P.cr |= 8;
    P.hm = Math.max(0, parseInt(f[4], 10) || 0); P.fm = Math.max(1, parseInt(f[5], 10) || 1);
    if (P.attacked(P.k[P.stm ^ 1], P.stm)) return null;          // the side that just moved can't still be in check
    const e = sqOf(f[3]), psq = e + (P.stm ? 16 : -16);
    if (e >= 0 && (e >> 4) === (P.stm ? 2 : 5) && b[psq] === (PAWN | (P.stm ^ 1) << 3) && !b[e] && !b[e - (P.stm ? 16 : -16)] && P.epOk(e, psq)) P.ep = e;
    P.hash();
    return P;
  }
  function toFen(P) {
    let s = '';
    for (let r = 7; r >= 0; r--) {
      let e = 0;
      for (let f = 0; f < 8; f++) { const p = P.b[r * 16 + f]; if (!p) e++; else { if (e) { s += e; e = 0; } s += CH[p]; } }
      if (e) s += e;
      if (r) s += '/';
    }
    const c = (P.cr & 1 ? 'K' : '') + (P.cr & 2 ? 'Q' : '') + (P.cr & 4 ? 'k' : '') + (P.cr & 8 ? 'q' : '');
    return s + ' ' + (P.stm ? 'b' : 'w') + ' ' + (c || '-') + ' ' + (P.ep >= 0 ? sqName(P.ep) : '-') + ' ' + P.hm + ' ' + P.fm;
  }

  /* SAN: piece letter, just enough of the starting square to tell twins apart, x, the square, =Q, + or # */
  function san(P, m, legal) {
    const b = P.b, from = m & 127, to = (m >> 7) & 127, fl = m >> 17, t = b[from] & 7;
    let s;
    if (fl & FCASTLE) s = to > from ? 'O-O' : 'O-O-O';
    else if (t === PAWN) s = (fl & FCAP ? 'abcdefgh'[from & 7] + 'x' : '') + sqName(to) + ((m >> 14) & 7 ? '=' + CH[(m >> 14) & 7] : '');
    else {
      let twin = false, file = false, rank = false;
      for (const o of legal) {
        const of = o & 127;
        if (of === from || ((o >> 7) & 127) !== to || (b[of] & 7) !== t) continue;
        twin = true;
        if ((of & 7) === (from & 7)) file = true;
        if ((of >> 4) === (from >> 4)) rank = true;
      }
      s = CH[t] + (!twin ? '' : !file ? 'abcdefgh'[from & 7] : !rank ? String((from >> 4) + 1) : sqName(from)) + (fl & FCAP ? 'x' : '') + sqName(to);
    }
    P.make(m);
    if (P.inCheck()) s += P.legal().length ? '+' : '#';
    P.unmake();
    return s;
  }
  /* the move from f to t in a legal list: 0 none, -1 a promotion that needs its piece */
  function findMove(legal, f, t, promo) {
    let any = false;
    for (const m of legal) {
      if ((m & 127) !== f || ((m >> 7) & 127) !== t) continue;
      if (!((m >> 14) & 7)) return m;
      any = true;
      if (promoCh(m) === promo) return m;
    }
    return any ? -1 : 0;
  }

  /* dead positions the rules call drawn: no pawns, rooks or queens, and at most one minor piece, or only
     bishops, all on squares of one colour */
  function insufficient(P) {
    let minors = 0, knights = 0;
    const bish = [0, 0];
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const t = P.b[s] & 7;
      if (!t || t === KING) continue;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      minors++;
      if (t === KNIGHT) knights++; else bish[((s >> 4) + (s & 7)) & 1]++;
    }
    return minors <= 1 || (!knights && (!bish[0] || !bish[1]));
  }
  /* can `side` still mate (for losing on time)? A bare king, or a king and one minor piece, can't */
  function canMate(P, side) {
    let minors = 0;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = P.b[s];
      if (!p || (p >> 3) !== side) continue;
      const t = p & 7;
      if (t === PAWN || t === ROOK || t === QUEEN) return true;
      if (t === KNIGHT || t === BISHOP) minors++;
    }
    return minors >= 2;
  }

  const PBUF = new Int32Array(64 * 256);
  function perft(P, d, ply) {
    const base = ply * 256, n = P.gen(PBUF, base, false), us = P.stm;
    let c = 0;
    for (let i = base; i < n; i++) {
      P.make(PBUF[i]);
      if (!P.attacked(P.k[us], us ^ 1)) c += d === 1 ? 1 : perft(P, d - 1, ply + 1);
      P.unmake();
    }
    return c;
  }

  /* ------------------------------------------------------------ evaluation */
  /* piece-square tables, from White's side, a8..h8 first (as a board is printed) */
  const T_P = [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 22, 22, 0, 0, 0, 5, -5, -10, 4, 4, -10, -5, 5, 5, 10, 10, -22, -22, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0];
  const T_PE = [0, 0, 0, 0, 0, 0, 0, 0, 80, 80, 80, 80, 80, 80, 80, 80, 45, 45, 45, 45, 45, 45, 45, 45, 25, 25, 25, 25, 25, 25, 25, 25,
    12, 12, 12, 12, 12, 12, 12, 12, 4, 4, 4, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const T_N = [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50];
  const T_B = [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -12, -10, -10, -12, -10, -20];
  const T_R = [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0];
  const T_Q = [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20];
  const T_K = [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20];
  const T_KE = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];
  const VAL_MG = [0, 100, 320, 330, 500, 900, 0], VAL_EG = [0, 115, 300, 320, 520, 930, 0], PHASE = [0, 0, 1, 1, 2, 4, 0];
  const PASS_MG = [0, 5, 8, 14, 24, 40, 60, 0], PASS_EG = [0, 10, 14, 24, 42, 70, 110, 0];
  /* material + table for every piece code on every square, middle game and end game */
  const MG = new Int16Array(16 * 128), EG = new Int16Array(16 * 128);
  (() => {
    const mgT = [null, T_P, T_N, T_B, T_R, T_Q, T_K], egT = [null, T_PE, T_N, T_B, T_R, T_Q, T_KE];
    for (let t = 1; t <= 6; t++) for (let s = 0; s < 128; s++) {
      if (s & 0x88) continue;
      const r = s >> 4, f = s & 7, wi = (7 - r) * 8 + f, bi = r * 8 + f;
      MG[t << 7 | s] = VAL_MG[t] + mgT[t][wi]; EG[t << 7 | s] = VAL_EG[t] + egT[t][wi];
      MG[(t | 8) << 7 | s] = VAL_MG[t] + mgT[t][bi]; EG[(t | 8) << 7 | s] = VAL_EG[t] + egT[t][bi];
    }
  })();
  const PF = new Int8Array(16), WLO = new Int8Array(8), BHI = new Int8Array(8), PWS = new Int16Array(64), PBS = new Int16Array(64), RKS = new Int16Array(64);
  /* the pawns in front of a king that has castled (or the lack of them); a king left in the middle wants its files closed */
  function shelter(b, k, c) {
    const r = k >> 4, f = k & 7;
    if ((c ? 7 - r : r) > 1) return -10;
    const o = c ? 8 : 0;
    if (f === 3 || f === 4) return (PF[o + 3] ? 0 : -12) + (PF[o + 4] ? 0 : -16);
    const up = c ? -16 : 16, pawn = PAWN | c << 3;
    let v = 0;
    for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1); ff++) {
      const s1 = (r << 4) + ff + up, s2 = s1 + up;
      v += b[s1] === pawn ? 12 : !(s2 & 0x88) && b[s2] === pawn ? 6 : -14;
      if (!PF[o + ff]) v -= 8;
    }
    return v;
  }
  const cdist = s => Math.max(3 - (s & 7), (s & 7) - 4) + Math.max(3 - (s >> 4), (s >> 4) - 4);
  const kdist = (a, b) => Math.abs((a & 7) - (b & 7)) + Math.abs((a >> 4) - (b >> 4));
  /* the score for the side to move, in centipawns */
  function evaluate(P) {
    const b = P.b;
    let mg = 0, eg = 0, phase = 0, nw = 0, nb = 0, nr = 0, wbish = 0, bbish = 0, wmat = 0, bmat = 0;
    PF.fill(0); WLO.fill(8); BHI.fill(-1);
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = b[s];
      if (!p) continue;
      const t = p & 7, i = p << 7 | s;
      if (p < 8) { mg += MG[i]; eg += EG[i]; } else { mg -= MG[i]; eg -= EG[i]; }
      phase += PHASE[t];
      if (t === PAWN) {
        const f = s & 7, r = s >> 4;
        if (p < 8) { PF[f]++; if (r < WLO[f]) WLO[f] = r; PWS[nw++] = s; } else { PF[8 + f]++; if (r > BHI[f]) BHI[f] = r; PBS[nb++] = s; }
      } else if (t !== KING) {
        if (p < 8) wmat += VAL_MG[t]; else bmat += VAL_MG[t];
        if (t === BISHOP) { if (p < 8) wbish++; else bbish++; } else if (t === ROOK) RKS[nr++] = s;
      }
    }
    if (!nw && !nb && wmat <= 330 && bmat <= 330) return 0;          // no mating material either way
    for (let f = 0; f < 8; f++) {                                     // doubled and isolated pawns
      const w = PF[f], k = PF[8 + f];
      if (w > 1) { mg -= 10 * (w - 1); eg -= 20 * (w - 1); }
      if (k > 1) { mg += 10 * (k - 1); eg += 20 * (k - 1); }
      if (w && !(f > 0 && PF[f - 1]) && !(f < 7 && PF[f + 1])) { mg -= 10 * w; eg -= 12 * w; }
      if (k && !(f > 0 && PF[7 + f]) && !(f < 7 && PF[9 + f])) { mg += 10 * k; eg += 12 * k; }
    }
    for (let i = 0; i < nw; i++) {                                     // passed pawns
      const s = PWS[i], f = s & 7, r = s >> 4;
      if (BHI[f] <= r && (f === 0 || BHI[f - 1] <= r) && (f === 7 || BHI[f + 1] <= r)) { mg += PASS_MG[r]; eg += PASS_EG[r]; }
    }
    for (let i = 0; i < nb; i++) {
      const s = PBS[i], f = s & 7, r = s >> 4;
      if (WLO[f] >= r && (f === 0 || WLO[f - 1] >= r) && (f === 7 || WLO[f + 1] >= r)) { mg -= PASS_MG[7 - r]; eg -= PASS_EG[7 - r]; }
    }
    for (let i = 0; i < nr; i++) {                                     // rooks on open and half-open files
      const s = RKS[i], f = s & 7, w = b[s] < 8, own = w ? PF[f] : PF[8 + f], opp = w ? PF[8 + f] : PF[f];
      if (!own) { const v = opp ? 10 : 20; if (w) { mg += v; eg += v >> 1; } else { mg -= v; eg -= v >> 1; } }
    }
    if (wbish >= 2) { mg += 30; eg += 45; }
    if (bbish >= 2) { mg -= 30; eg -= 45; }
    mg += shelter(b, P.k[0], WHITE) - shelter(b, P.k[1], BLACK);
    // a lone king: drive it to the edge and bring ours close, so the mates with K+R or K+Q get found
    if (!nb && !bmat && wmat >= 500) eg += 12 * cdist(P.k[1]) + 4 * (14 - kdist(P.k[0], P.k[1]));
    if (!nw && !wmat && bmat >= 500) eg -= 12 * cdist(P.k[0]) + 4 * (14 - kdist(P.k[0], P.k[1]));
    if (phase > 24) phase = 24;
    const sc = ((mg * phase + eg * (24 - phase)) / 24) | 0;
    return P.stm ? -sc : sc;
  }
  function hasPieces(P, c) {
    for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const p = P.b[s]; if (p && (p >> 3) === c && (p & 7) !== PAWN && (p & 7) !== KING) return true; }
    return false;
  }

  /* ------------------------------------------------------------ the search */
  const MATE = 30000, INF = 32000, MAXPLY = 96, NEARMATE = MATE - 200;
  const EXACT = 0, LOWER = 1, UPPER = 2;
  const VAL = [0, 100, 320, 330, 500, 900, 2000];
  const TTN = 1 << 19, TTM = TTN - 1;
  let TT = null;                                                      // kept between searches (a worker searches one game)
  const table = () => TT || (TT = { k: new Int32Array(TTN), m: new Int32Array(TTN), s: new Int16Array(TTN), d: new Int8Array(TTN), f: new Int8Array(TTN) });

  /* o: { depth, ms, easy, vary }. hist: [h1, h2] keys of the positions since the last pawn move or capture */
  function think(P, hist, o) {
    const T = table(), t0 = Date.now(), timed = o.ms > 0, deadline = timed ? t0 + o.ms : Infinity;
    const maxDepth = Math.max(1, Math.min(60, o.depth || 60));
    const MV = new Int32Array(MAXPLY * 256), SC = new Int32Array(MAXPLY * 256), KIL = new Int32Array(MAXPLY * 2), HIS = new Int32Array(16 * 128);
    const K1 = new Int32Array(hist.length + MAXPLY + 4), K2 = new Int32Array(hist.length + MAXPLY + 4);
    let top = -1, nodes = 0, stop = false;
    for (const h of hist) { K1[++top] = h[0]; K2[top] = h[1]; }
    if (top < 0 || K1[top] !== P.h1 || K2[top] !== P.h2) { K1[++top] = P.h1; K2[top] = P.h2; }
    const tick = () => { if ((++nodes & 1023) === 0 && timed && Date.now() > deadline) stop = true; return stop; };
    const push = () => { K1[++top] = P.h1; K2[top] = P.h2; };
    const rep = () => { for (let i = top - 2, e = Math.max(0, top - P.hm); i >= e; i -= 2) if (K1[i] === P.h1 && K2[i] === P.h2) return true; return false; };
    function order(base, end, ttm, ply) {
      const b = P.b, k1 = KIL[ply * 2], k2 = KIL[ply * 2 + 1];
      for (let i = base; i < end; i++) {
        const m = MV[i], fl = m >> 17, pr = (m >> 14) & 7;
        SC[i] = m === ttm ? 1 << 30
          : fl & FCAP ? (1 << 28) + (fl & FEP ? PAWN : b[(m >> 7) & 127] & 7) * 16 - (b[m & 127] & 7) + (pr === QUEEN ? 1 << 20 : 0)
            : pr ? (1 << 27) + pr
              : m === k1 ? (1 << 26) + 1 : m === k2 ? 1 << 26 : HIS[b[m & 127] << 7 | (m >> 7) & 127];
      }
    }
    function pick(i, end) {
      let bi = i;
      for (let j = i + 1; j < end; j++) if (SC[j] > SC[bi]) bi = j;
      if (bi !== i) { const m = MV[i], s = SC[i]; MV[i] = MV[bi]; SC[i] = SC[bi]; MV[bi] = m; SC[bi] = s; }
    }
    function quiesce(alpha, beta, ply) {
      if (tick()) return 0;
      if (ply >= MAXPLY - 1) return evaluate(P);
      const us = P.stm, check = P.attacked(P.k[us], us ^ 1);
      let best = -INF, stand = 0;
      if (!check) {                                                   // in check every reply counts, so no standing pat
        best = stand = evaluate(P);
        if (best >= beta) return best;
        if (best > alpha) alpha = best;
      }
      const base = ply * 256, end = P.gen(MV, base, !check);
      order(base, end, 0, ply);
      let legal = 0;
      for (let i = base; i < end; i++) {
        pick(i, end);
        const m = MV[i];
        if (!check && !((m >> 14) & 7) && stand + ((m >> 17) & FEP ? 100 : VAL[P.b[(m >> 7) & 127] & 7]) + 200 < alpha) continue;   // can't catch up
        P.make(m);
        if (P.attacked(P.k[us], us ^ 1)) { P.unmake(); continue; }
        legal++;
        const s = -quiesce(-beta, -alpha, ply + 1);
        P.unmake();
        if (stop) return 0;
        if (s > best) { best = s; if (s > alpha) { alpha = s; if (s >= beta) break; } }
      }
      return check && !legal ? -MATE + ply : best;
    }
    function negamax(depth, alpha, beta, ply, nullOk) {
      if (tick()) return 0;
      if (P.hm >= 100 || rep()) return 0;
      if (ply >= MAXPLY - 1) return evaluate(P);
      if (alpha < -MATE + ply) alpha = -MATE + ply;                   // no mate found later can beat one found sooner
      if (beta > MATE - ply - 1) beta = MATE - ply - 1;
      if (alpha >= beta) return alpha;
      const us = P.stm, check = P.attacked(P.k[us], us ^ 1);
      if (check) depth++;
      if (depth <= 0) return quiesce(alpha, beta, ply);
      const pv = beta - alpha > 1, idx = P.h1 & TTM, a0 = alpha;
      let ttm = 0;
      if (T.k[idx] === P.h2) {
        ttm = T.m[idx];
        if (!pv && T.d[idx] >= depth) {
          let s = T.s[idx];
          if (s > NEARMATE) s -= ply; else if (s < -NEARMATE) s += ply;
          const f = T.f[idx];
          if (f === EXACT || (f === LOWER && s >= beta) || (f === UPPER && s <= alpha)) return s;
        }
      }
      // null move: if passing still holds beta, a real move would too (not in pawn endings, where passing can be best)
      if (nullOk && !pv && !check && depth >= 3 && beta < NEARMATE && hasPieces(P, us) && evaluate(P) >= beta) {
        P.makeNull(); push();
        const s = -negamax(depth - 3 - (depth >= 7 ? 1 : 0), -beta, -beta + 1, ply + 1, false);
        top--; P.unmakeNull();
        if (stop) return 0;
        if (s >= beta) return s >= NEARMATE ? beta : s;
      }
      const base = ply * 256, end = P.gen(MV, base, false);
      order(base, end, ttm, ply);
      let best = -INF, bestM = 0, legal = 0;
      for (let i = base; i < end; i++) {
        pick(i, end);
        const m = MV[i];
        P.make(m);
        if (P.attacked(P.k[us], us ^ 1)) { P.unmake(); continue; }
        legal++; push();
        const quiet = !((m >> 17) & FCAP) && !((m >> 14) & 7);
        let s;
        if (legal === 1) s = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
        else {
          // late quiet moves are rarely best: look at them less deeply first (not killers, not checks)
          let r = 0;
          if (depth >= 3 && legal > 3 && quiet && !check && SC[i] < 1 << 26 && !P.attacked(P.k[P.stm], us)) r = legal > 10 && depth >= 5 ? 2 : 1;
          s = -negamax(depth - 1 - r, -alpha - 1, -alpha, ply + 1, true);
          if (s > alpha && r && !stop) s = -negamax(depth - 1, -alpha - 1, -alpha, ply + 1, true);
          if (s > alpha && s < beta && !stop) s = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
        }
        top--; P.unmake();
        if (stop) return 0;
        if (s > best) {
          best = s; bestM = m;
          if (s > alpha) {
            alpha = s;
            if (s >= beta) {
              if (quiet) {
                if (KIL[ply * 2] !== m) { KIL[ply * 2 + 1] = KIL[ply * 2]; KIL[ply * 2] = m; }
                const h = P.b[m & 127] << 7 | (m >> 7) & 127;
                if ((HIS[h] += depth * depth) > 1 << 24) for (let j = 0; j < HIS.length; j++) HIS[j] >>= 1;
              }
              break;
            }
          }
        }
      }
      if (!legal) return check ? -MATE + ply : 0;
      T.k[idx] = P.h2; T.m[idx] = bestM; T.d[idx] = depth;
      T.s[idx] = best > NEARMATE ? best + ply : best < -NEARMATE ? best - ply : best;
      T.f[idx] = best >= beta ? LOWER : best > a0 ? EXACT : UPPER;
      return best;
    }

    // the root: the legal moves, captures first, the rest shuffled when we want some variety
    const us = P.stm, n0 = P.gen(MV, 0, false);
    let RM = [];
    for (let i = 0; i < n0; i++) { const m = MV[i]; P.make(m); if (!P.attacked(P.k[us], us ^ 1)) RM.push(m); P.unmake(); }
    if (!RM.length) return null;
    const out = (m, s, d) => ({ from: sqName(m & 127), to: sqName((m >> 7) & 127), promo: promoCh(m) || undefined, score: s || 0, depth: d, nodes, ms: Date.now() - t0 });
    if (o.vary || o.easy) for (let i = RM.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [RM[i], RM[j]] = [RM[j], RM[i]]; }
    const rs = m => { const fl = m >> 17; return fl & FCAP ? 1e6 + VAL[fl & FEP ? PAWN : P.b[(m >> 7) & 127] & 7] * 10 - (P.b[m & 127] & 7) : (m >> 14) & 7 ? 9e5 : 0; };
    RM.sort((a, b) => rs(b) - rs(a));
    const tti = P.h1 & TTM;
    if (T.k[tti] === P.h2 && RM.includes(T.m[tti])) RM = [T.m[tti], ...RM.filter(m => m !== T.m[tti])];
    if (RM.length === 1 && !o.full) return out(RM[0], 0, 0);

    if (o.easy) {
      // a beginner's opponent: one or two moves deep, a little noise, and now and then a careless move
      const d = Math.random() < 0.6 ? 1 : 2, sc = [];
      for (const m of RM) { P.make(m); push(); sc.push(-negamax(d - 1, -INF, INF, 1, true)); top--; P.unmake(); }
      const best = Math.max(...sc);
      let i;
      if (best < NEARMATE && Math.random() < 0.15) { const ok = RM.map((m, j) => j).filter(j => sc[j] >= best - 350); i = ok[Math.floor(Math.random() * ok.length)]; }
      else { let bv = -Infinity; sc.forEach((s, j) => { const v = s + (s > NEARMATE ? 0 : (Math.random() * 2 - 1) * 60); if (v > bv) { bv = v; i = j; } }); }
      return out(RM[i], sc[i], d);
    }

    let bestM = RM[0], bestS = 0, done = 0;
    for (let d = 1; d <= maxDepth; d++) {
      let alpha = -INF, iterM = 0, iterS = -INF, searched = 0;
      for (let i = 0; i < RM.length; i++) {
        const m = RM[i];
        P.make(m); push();
        let s;
        if (i === 0) s = -negamax(d - 1, -INF, -alpha, 1, true);
        else {
          s = -negamax(d - 1, -alpha - 1, -alpha, 1, true);
          if (s > alpha && !stop) s = -negamax(d - 1, -INF, -alpha, 1, true);
        }
        top--; P.unmake();
        if (stop) break;
        searched++;
        if (s > iterS) { iterS = s; iterM = m; }
        if (s > alpha) alpha = s;
      }
      // a cut-off iteration still counts if it got through the previous best move: anything it preferred was searched in full
      if (searched) { bestM = iterM; bestS = iterS; if (!stop) done = d; }
      if (stop) break;
      RM = [bestM, ...RM.filter(m => m !== bestM)];
      if (timed && Date.now() - t0 > o.ms * 0.5) break;               // the next depth won't finish in time
      if (Math.abs(bestS) > NEARMATE && d >= MATE - Math.abs(bestS)) break;   // a forced mate, either way
    }
    return out(bestM, bestS, done);
  }

  /* search(state or FEN, depth (<= 30) or ms or { depth, ms, easy, vary }) -> { from, to, promo, score, depth, nodes, ms } */
  function search(state, o) {
    if (typeof o === 'number') o = o <= 30 ? { depth: o } : { ms: o };
    o = o || { ms: 500 };
    const P = parse(typeof state === 'string' ? state : state && state.fen);
    if (!P) return null;
    const hist = [];
    if (state && Array.isArray(state.reps)) for (const k of state.reps) if (/^[0-9a-f]{16}$/.test(k)) hist.push([parseInt(k.slice(0, 8), 16) | 0, parseInt(k.slice(8), 16) | 0]);
    return think(P, hist, o);
  }
  const LEVELS = { easy: { easy: true }, normal: { ms: 500, vary: true }, hard: { ms: 1700, vary: true } };

  /* ------------------------------------------------------------ the worker */
  /* the search runs in js/chess-ai.js, found next to this file (with its ?v= stamp) */
  const SRC = (() => { try { return String(document.currentScript.src || ''); } catch (e) { return ''; } })();
  let worker = null, wfails = 0, wseq = 0;
  const waiting = new Map();
  /* without a worker: here, at a small depth in a page (the page must stay responsive), fully elsewhere (node) */
  function local(state, o) {
    const page = typeof document !== 'undefined';
    if (page && !o.easy) o = Object.assign({}, o, { ms: Math.min(o.ms || 250, 250), depth: Math.min(o.depth || 4, 4) });
    return new Promise(res => setTimeout(() => { let r = null; try { r = search(state, o); } catch (e) { r = null; } res(r); }, page ? 30 : 0));
  }
  function dropWorker() {
    wfails++;
    if (worker) { try { worker.terminate(); } catch (e) { /* already gone */ } worker = null; }
    const list = [...waiting.values()]; waiting.clear();
    for (const w of list) { clearTimeout(w.timer); local(w.state, w.o).then(w.resolve); }
  }
  function ask(state, o) {
    if (typeof Worker === 'undefined' || !SRC || wfails >= 2) return local(state, o);
    try {
      if (!worker) {
        const u = new URL(SRC); u.pathname = u.pathname.replace(/[^/]*$/, 'chess-ai.js');
        worker = new Worker(u.href);
        worker.onmessage = e => {
          const d = e.data || {}, w = waiting.get(d.id);
          if (!w) return;
          if (d.err) { dropWorker(); return; }                          // it couldn't load or run the engine: stop using it
          waiting.delete(d.id); clearTimeout(w.timer); w.resolve(d.res || null);
        };
        worker.onerror = e => { if (e && e.preventDefault) e.preventDefault(); dropWorker(); };
      }
    } catch (e) { wfails++; worker = null; return local(state, o); }
    return new Promise(resolve => {
      const id = ++wseq, w = { resolve, state, o, timer: setTimeout(dropWorker, (o.ms || 1500) + 6000) };
      waiting.set(id, w);
      try { worker.postMessage({ id, state, o }); } catch (e) { dropWorker(); }
    });
  }

  /* ------------------------------------------------------------ the rules */
  const CLOCKS = { '3+2': [180000, 2000], '5+0': [300000, 0], '10+0': [600000, 0] };
  const MAXSANS = 200;                                              // moves in a view (a view must stay small)
  const num = v => typeof v === 'number' && isFinite(v) ? v : Date.now();
  const stmOf = st => String(st.fen).split(' ')[1] === 'b' ? BLACK : WHITE;
  const seatOf = (st, pid) => pid == null || !st || !Array.isArray(st.ids) ? -1 : st.ids.indexOf(String(pid));
  const clone = st => JSON.parse(JSON.stringify(st));
  /* the running clock (white's starts with black's first move: white's first move is free) stops at `now` */
  function stopClock(s, now) {
    if (!s.clock || !s.sans.length) return;
    const r = stmOf(s);
    s.ms[r] = Math.max(0, s.ms[r] - (now - s.since)); s.since = now;
  }
  /* after a move: is the game over? */
  function judge(s, P, mover) {
    const legal = P.legal();
    if (!legal.length) s.over = P.inCheck() ? { w: mover, why: 'Checkmate' } : { w: -1, why: 'Stalemate' };
    else if (insufficient(P)) s.over = { w: -1, why: 'Draw by insufficient material' };
    else if (P.hm >= 100) s.over = { w: -1, why: 'Draw by the fifty-move rule' };
    else if (s.reps.filter(k => k === s.reps[s.reps.length - 1]).length >= 3) s.over = { w: -1, why: 'Draw by repetition' };
    if (s.over) s.offer = null;
  }

  function setup(opts, players, now) {
    opts = opts || {};
    const P = (opts.fen && parse(opts.fen)) || parse(START), c = CLOCKS[opts.clock] || null;
    const s = {
      v: 1, ids: (players || []).slice(0, 2).map(p => String(p && p.id)),
      fen: toFen(P), reps: [P.key()], sans: [], last: null, check: P.inCheck() ? sqName(P.k[P.stm]) : null, caps: ['', ''],
      clock: c ? c.slice() : null, ms: c ? [c[0], c[0]] : null, since: num(now),
      offer: null, offPly: [-1, -1], over: null,
    };
    judge(s, P, P.stm ^ 1);
    return s;
  }

  function view(st, pid, now) {
    now = num(now);
    const seat = seatOf(st, pid), stm = stmOf(st), n = st.sans.length, from = Math.max(0, n - MAXSANS);
    let clock = null;
    if (st.clock) {
      const run = st.over || !n ? null : stm, ms = st.ms.slice();
      if (run != null) ms[run] = Math.max(0, ms[run] - (now - st.since));
      clock = { ms: ms.map(x => Math.round(x)), run, inc: st.clock[1] };
    }
    return {
      fen: st.fen, turn: stm, you: seat >= 0 ? seat : null, last: st.last, check: st.check, caps: st.caps.slice(),
      sans: st.sans.slice(from), sn: from, clock, offer: st.offer,
      mayOffer: seat >= 0 && !st.over && st.offer == null && st.offPly[seat] !== n, over: st.over,
    };
  }

  function move(st, pid, m, now) {
    try { return play1(st, pid, m, num(now)); } catch (e) { return { err: 'That move didn\'t work.' }; }
  }
  function play1(st, pid, m, now) {
    if (!st || !Array.isArray(st.ids) || typeof st.fen !== 'string') return { err: 'There\'s no game.' };
    if (st.over) return { err: 'The game is over.' };
    const seat = seatOf(st, pid);
    if (seat < 0) return { err: 'You\'re not playing in this game.' };
    if (!m || typeof m !== 'object' || Array.isArray(m)) return { err: 'That isn\'t a move.' };
    const s = clone(st), opp = seat ^ 1;
    if (m.resign != null) {
      if (m.resign !== true) return { err: 'That isn\'t a move.' };
      stopClock(s, now); s.over = { w: opp, why: 'Resigned' }; s.offer = null;
      return { state: s };
    }
    if (m.draw != null) {
      if (m.draw === 'offer' && s.offer === opp) m = { draw: 'accept' };       // both want a draw
      if (m.draw === 'offer') {
        if (s.offer === seat) return { err: 'You\'ve already offered a draw.' };
        if (s.offPly[seat] === s.sans.length) return { err: 'You can offer a draw again after your next move.' };
        s.offer = seat; s.offPly[seat] = s.sans.length;
        return { state: s };
      }
      if (m.draw === 'accept' || m.draw === 'decline') {
        if (s.offer !== opp) return { err: 'There\'s no draw offer to answer.' };
        if (m.draw === 'accept') { stopClock(s, now); s.over = { w: -1, why: 'Draw agreed' }; }
        s.offer = null;
        return { state: s };
      }
      return { err: 'That isn\'t a move.' };
    }
    const P = parse(s.fen);
    if (!P) return { err: 'The position is broken.' };
    if (P.stm !== seat) return { err: 'It\'s not your turn.' };
    const f = sqOf(m.from), t = sqOf(m.to);
    if (f < 0 || t < 0) return { err: 'That isn\'t a move.' };
    const promo = m.promo == null || m.promo === '' ? '' : String(m.promo).toLowerCase();
    if (promo && !/^[qrbn]$/.test(promo)) return { err: 'Promote to a queen, rook, bishop or knight.' };
    const left = s.clock && s.sans.length ? s.ms[seat] - (now - s.since) : Infinity;
    if (left <= 0) return { err: 'Your time is up.' };
    const legal = P.legal(), mv = findMove(legal, f, t, promo);
    if (mv === -1) return { err: 'Choose a piece to promote to.' };
    if (!mv) {
      const p = P.b[f];
      if (!p || (p >> 3) !== seat) return { err: 'Move one of your own pieces.' };
      return { err: P.inCheck() ? 'You have to get out of check.' : 'That move isn\'t legal.' };
    }
    const sanStr = san(P, mv, legal), fl = mv >> 17;
    if (fl & FCAP) s.caps[seat] += CH[P.b[fl & FEP ? t + (seat ? 16 : -16) : t] & 7].toLowerCase();
    P.make(mv);
    s.fen = toFen(P); s.sans.push(sanStr); s.last = [m.from, m.to];
    s.check = P.inCheck() ? sqName(P.k[P.stm]) : null;
    if (P.hm === 0) s.reps = [P.key()]; else s.reps.push(P.key());
    if (s.clock) { if (s.sans.length > 1) s.ms[seat] = left + s.clock[1]; s.since = now; }
    if (s.offer === opp) s.offer = null;                               // moving on declines the opponent's offer
    judge(s, P, seat);
    return { state: s };
  }

  /* who may act: the side to move, and whoever has a draw offer to answer */
  function turn(st) {
    if (!st || st.over) return [];
    const t = [st.ids[stmOf(st)]];
    if (st.offer != null && !t.includes(st.ids[st.offer ^ 1])) t.push(st.ids[st.offer ^ 1]);
    return t;
  }
  function due(st, now) {
    if (!st || st.over || !st.clock || !st.sans.length) return null;
    const r = stmOf(st);
    return num(now) - st.since >= st.ms[r] ? st.ids[r] : null;
  }
  function timeout(st, pid, now) {
    const s = clone(st), seat = seatOf(s, pid);
    if (s.over || seat < 0) return { state: s };
    if (s.clock) { s.ms[seat] = 0; s.since = num(now); }
    const P = parse(s.fen);
    s.over = !P || canMate(P, seat ^ 1) ? { w: seat ^ 1, why: 'Lost on time' } : { w: -1, why: 'Draw: out of time, but no mating material' };
    s.offer = null;
    return { state: s };
  }
  function result(st) {
    if (!st || !st.over) return null;
    const [a, b] = st.ids, w = st.over.w;
    if (w < 0) return { ranks: [[a, b]], scores: { [a]: 0.5, [b]: 0.5 }, text: st.over.why };
    return { ranks: [[st.ids[w]], [st.ids[w ^ 1]]], scores: { [st.ids[w]]: 1, [st.ids[w ^ 1]]: 0 }, text: st.over.why };
  }

  /* a move for a CPU player. It answers a draw offer first: yes only when it's clearly worse off */
  function cpu(st, pid, level, now) {
    now = num(now);
    const seat = seatOf(st, pid);
    if (seat < 0 || !st || st.over) return Promise.resolve({ resign: true });
    const P = parse(st.fen);
    if (st.offer === (seat ^ 1)) {
      return ask(st, { ms: 300, depth: 8 }).then(r => {
        const mine = r ? (P && P.stm === seat ? r.score : -r.score) : 0;
        return { draw: mine <= -200 ? 'accept' : 'decline' };
      });
    }
    if (!P || P.stm !== seat) return Promise.resolve(st.offer === seat ? { draw: 'offer' } : { resign: true });
    const o = Object.assign({}, LEVELS[level] || LEVELS.normal);
    if (st.clock && o.ms && st.sans.length) o.ms = Math.max(60, Math.min(o.ms, (st.ms[seat] - (now - st.since)) / 25 + st.clock[1] * 0.6));
    return ask(st, o).then(r => r || search(st, { depth: 1 })).then(r => r ? (r.promo ? { from: r.from, to: r.to, promo: r.promo } : { from: r.from, to: r.to }) : { resign: true });
  }

  /* ------------------------------------------------------------ helpers for the screen and the tests */
  /* a position as the screen wants it: board[64] (a1 = 0) of FEN letters, side to move, check, legal moves */
  function info(fen) {
    const P = parse(fen);
    if (!P) return null;
    const board = [];
    for (let s = 0; s < 64; s++) { const p = P.b[(s >> 3) * 16 + (s & 7)]; board.push(p ? CH[p] : ''); }
    const s64 = s => (s >> 4) * 8 + (s & 7);
    return {
      fen: toFen(P), board, stm: P.stm, check: P.inCheck() ? sqName(P.k[P.stm]) : null,
      moves: P.legal().map(m => ({ f: s64(m & 127), t: s64((m >> 7) & 127), promo: promoCh(m), cap: !!((m >> 17) & FCAP) })),
    };
  }
  /* make a move on a FEN: { fen, san, took } or null if it isn't legal */
  function playFen(fen, from, to, promo) {
    const P = parse(fen);
    if (!P) return null;
    const legal = P.legal(), mv = findMove(legal, sqOf(from), sqOf(to), promo ? String(promo).toLowerCase() : '');
    if (mv <= 0) return null;
    const fl = mv >> 17, t = (mv >> 7) & 127, took = fl & FCAP ? CH[P.b[fl & FEP ? t + (P.stm ? 16 : -16) : t] & 7].toLowerCase() : '';
    const s = san(P, mv, legal);
    P.make(mv);
    return { fen: toFen(P), san: s, took };
  }
  const lib = {
    START, parse, fen: toFen, info, play: playFen, sqName, sqOf,
    perft: (fen, d) => { const P = parse(fen); return !P ? -1 : d ? perft(P, d, 0) : 1; },
    legal: fen => { const P = parse(fen); return P ? P.legal().map(m => sqName(m & 127) + sqName((m >> 7) & 127) + promoCh(m)) : []; },
    sans: fen => { const P = parse(fen); if (!P) return []; const L = P.legal(); return L.map(m => san(P, m, L)); },
    insufficient: fen => { const P = parse(fen); return !!P && insufficient(P); },
    evaluate: fen => { const P = parse(fen); return P ? evaluate(P) : 0; },
    key: fen => { const P = parse(fen); return P ? P.key() : ''; },
  };

  /* ============================================================ the screen (in a page only) */
  /* the pieces: flat, two tones, drawn on a 100 x 100 grid; the class picks the colours (css/chess.css) */
  const BASE = '<rect x="21" y="79" width="58" height="10" rx="4"/>';
  const BAND = '<path d="M30 71H70L74 80H26Z"/>';
  const SHAPE = {
    p: '<path d="M40 50C40 62 33 70 29 80H71C67 70 60 62 60 50Z"/>' + BASE + '<rect x="36.5" y="43.5" width="27" height="8" rx="4"/><circle cx="50" cy="30" r="12.5"/>',
    r: '<path d="M33 72L36 39H64L67 72Z"/><rect x="26" y="70" width="48" height="10" rx="3"/>' + BASE + '<path d="M28 40V19H37.5V26.5H45V19H55V26.5H62.5V19H72V40Z"/>',
    n: '<path d="M34 80C34 66 40 60 46 54C40 55 33 58 27 62C22 64 16.5 60 19 54.5C22 48 32 38 38 30C40 24 42 18 46 12.5L52.5 21C70 23 80 42 76 80Z"/>' + BASE +
      '<path class="d" d="M56 26C66 33 71 48 70 70"/><circle class="e" cx="40" cy="33" r="3.4"/>',
    b: '<path d="M33 80C35 75 39 71 41 69H59C61 71 65 75 67 80Z"/>' + BASE + '<rect x="36" y="62" width="28" height="8" rx="4"/>' +
      '<path d="M50 18C63 27 69 40 64 52C62 57 60 60 58 62H42C40 60 38 57 36 52C31 40 37 27 50 18Z"/><circle cx="50" cy="13" r="5.5"/><path class="d" d="M56 31L47 45"/>',
    q: '<path d="M30 72L20 37L31 51L35 27L43 48L50 22L57 48L65 27L69 51L80 37L70 72Z"/>' + BAND + BASE +
      '<circle cx="20" cy="34" r="5"/><circle cx="35" cy="24" r="5"/><circle cx="50" cy="19" r="5"/><circle cx="65" cy="24" r="5"/><circle cx="80" cy="34" r="5"/><path class="d" d="M33 63H67"/>',
    k: '<path d="M46 10H54V18H61V26H54V56H46V26H39V18H46Z"/><path d="M30 72C21 58 22 42 34 40C43 39 48 46 50 54C52 46 57 39 66 40C78 42 79 58 70 72Z"/>' + BAND + BASE + '<path class="d" d="M33 62H67"/>',
  };
  const SVG = {};
  for (const c of 'pnbrqk') for (const w of [true, false]) SVG[w ? c.toUpperCase() : c] = '<svg class="ch-pc ' + (w ? 'w' : 'b') + '" viewBox="0 0 100 100" aria-hidden="true">' + SHAPE[c] + '</svg>';
  const PNAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const WORTH = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  function mount(root, api) {
    const el = U.el, players = api.players || [];
    const sfx = n => { try { if (api.sfx) api.sfx(n); } catch (e) { /* no sound then */ } };
    const seat = api.me == null ? -1 : players.findIndex(p => p && p.id === api.me);
    const flip = seat === 1;                                          // black plays from the bottom; watchers see white there
    const nameOf = s => String((players[s] && players[s].name) || (s ? 'Black' : 'White'));
    const isCpu = s => !!(players[s] && players[s].cpu);
    /* display index d (0 = top left) <-> square s (a1 = 0); the mapping is its own inverse */
    const d2s = d => flip ? (d >> 3) * 8 + 7 - (d & 7) : (7 - (d >> 3)) * 8 + (d & 7);
    const nm = s => 'abcdefgh'[s & 7] + ((s >> 3) + 1);
    const at = n => typeof n === 'string' && /^[a-h][1-8]$/.test(n) ? (n.charCodeAt(1) - 49) * 8 + n.charCodeAt(0) - 97 : -1;
    const colorOf = p => p ? (p === p.toUpperCase() ? 0 : 1) : -1;

    let V = null, Vat = 0;              // the last view from the host, and when it came
    let F = info(START);                // what the board shows: the view's position, or our move before the host confirms it
    F.last = null; F.sans = []; F.sn = 0; F.caps = ['', ''];
    let sel = -1, tg = [], drag = null, ghost = null, cur = -1, typed = '', promo = null, confirm = null, pend = 0, clk = null, beep = -1, dead = false;
    let sideKey = null, movesKey = null;

    /* ---- the board */
    const SQ = [];
    const board = el('div', { class: 'ch-board', 'aria-label': 'Chess board' });
    for (let d = 0; d < 64; d++) {
      const s = d2s(d), pc = el('div', { class: 'ch-p' });
      const node = el('div', { class: 'ch-sq ' + (((s >> 3) + (s & 7)) & 1 ? 'l' : 'd') }, pc,
        (d & 7) === 0 ? el('span', { class: 'ch-co r' }, String((s >> 3) + 1)) : null,
        (d >> 3) === 7 ? el('span', { class: 'ch-co f' }, 'abcdefgh'[s & 7]) : null);
      SQ.push({ el: node, pc, p: '' });
      board.append(node);
    }
    const promoEl = el('div', { class: 'ch-promo' });
    promoEl.hidden = true;
    promoEl.addEventListener('pointerdown', e => { if (e.target === promoEl) { e.preventDefault(); promo = null; clearSel(); } });
    function bar(s) {
      const o = { s, caps: el('span', { class: 'ch-caps' }), adv: el('span', { class: 'ch-adv' }), clock: el('span', { class: 'ch-clock', hidden: true }) };
      o.el = el('div', { class: 'ch-bar' }, el('i', { class: 'ch-dot ' + (s ? 'b' : 'w') }), el('b', { class: 'ch-name', title: nameOf(s) }, nameOf(s)), o.caps, o.adv, o.clock);
      return o;
    }
    const bars = [bar(flip ? 0 : 1), bar(flip ? 1 : 0)];
    const msgEl = el('div', { class: 'ch-msg' }), subEl = el('div', { class: 'ch-sub' }), offerEl = el('div', { class: 'ch-offer' }), btnEl = el('div', { class: 'ch-btns' });
    const movesEl = el('div', { class: 'ch-moves', 'aria-label': 'Moves' });
    const wrap = el('div', { class: 'chess' + (seat < 0 ? ' watching' : '') },
      el('div', { class: 'ch-wrap' },
        el('div', { class: 'ch-game' }, bars[0].el, el('div', { class: 'ch-bwrap' }, board, promoEl), bars[1].el),
        el('div', { class: 'ch-side' }, el('div', { class: 'ch-status' }, msgEl, subEl, offerEl, btnEl), el('div', { class: 'ch-movebox' }, movesEl))));
    root.append(wrap);

    const over = () => !!(V && V.over);
    const canMove = () => seat >= 0 && !!V && !V.over && F.stm === seat && !pend;
    const mine = s => colorOf(F.board[s]) === seat;

    function drawBoard() {
      const last = F.last ? [at(F.last[0]), at(F.last[1])] : [], chk = F.check ? at(F.check) : -1;
      for (let d = 0; d < 64; d++) {
        const s = d2s(d), q = SQ[d], p = F.board[s], c = q.el.classList, t = tg.find(x => x.t === s);
        if (q.p !== p) { q.pc.innerHTML = p ? SVG[p] : ''; q.p = p; }
        c.toggle('last', last.includes(s)); c.toggle('sel', s === sel); c.toggle('chk', s === chk);
        c.toggle('tgt', !!t); c.toggle('cap', !!(t && t.cap)); c.toggle('cur', s === cur);
        c.toggle('lift', !!(drag && drag.on && drag.s === s));
        c.toggle('hov', !!(drag && drag.on && drag.over === s && t));
      }
      promoEl.hidden = !promo;
      promoEl.innerHTML = '';
      if (promo) {
        const d = d2s(promo.t), col = d & 7, top = (d >> 3) === 0;
        ['q', 'n', 'r', 'b'].forEach((p, i) => {
          const b = el('button', { class: 'ch-pick', title: 'Promote to a ' + PNAME[p], 'aria-label': 'Promote to a ' + PNAME[p], style: { left: col * 12.5 + '%', top: (top ? i : 7 - i) * 12.5 + '%' }, onclick: e => { e.stopPropagation(); pickPromo(p); } });
          b.innerHTML = SVG[F.stm ? p : p.toUpperCase()];
          promoEl.append(b);
        });
      }
    }
    function drawBars() {
      let diff = 0;
      for (const p of F.board) if (p) diff += (colorOf(p) ? -1 : 1) * WORTH[p.toLowerCase()];
      for (const b of bars) {
        const taken = (F.caps[b.s] || '').split('').sort((x, y) => WORTH[x] - WORTH[y] || 'pnbrq'.indexOf(x) - 'pnbrq'.indexOf(y));
        b.caps.innerHTML = taken.map(p => SVG[b.s ? p.toUpperCase() : p]).join('');
        const adv = b.s ? -diff : diff;
        b.adv.textContent = adv > 0 ? '+' + adv : '';
        b.el.classList.toggle('turn', !over() && F.stm === b.s);
        b.clock.hidden = !clk;
      }
      tick();
    }
    function drawSide() {
      // what's going on
      let msg, sub = '';
      if (!V) msg = 'Setting up...';
      else if (V.over) {
        msg = V.over.why;
        sub = V.over.w < 0 ? 'The game is drawn.' : V.over.w === seat ? 'You win!' : seat >= 0 ? nameOf(V.over.w) + ' wins.' : nameOf(V.over.w) + ' (' + (V.over.w ? 'black' : 'white') + ') wins.';
      } else if (seat >= 0) {
        if (F.stm === seat) { msg = F.check ? 'Check! Your move' : 'Your move'; sub = 'You play ' + (seat ? 'black' : 'white') + '.'; }
        else { msg = isCpu(seat ^ 1) ? nameOf(seat ^ 1) + ' is thinking...' : 'Waiting for ' + nameOf(seat ^ 1) + '...'; sub = F.check ? 'You gave check.' : ''; }
      } else msg = nameOf(F.stm) + ' (' + (F.stm ? 'black' : 'white') + ') to move' + (F.check ? ' · check' : '');
      msgEl.textContent = msg; subEl.textContent = sub;
      // the buttons are only rebuilt when they change, so a view arriving mid-click can't swallow the click
      const k = [!V, V && !!V.over, V && V.offer, V && V.mayOffer, confirm].join();
      if (k !== sideKey) {
        sideKey = k;
        // a draw offer
        offerEl.innerHTML = '';
        offerEl.hidden = true;
        if (V && !V.over && V.offer != null) {
          offerEl.hidden = false;
          if (seat >= 0 && V.offer === (seat ^ 1)) offerEl.append(el('span', null, nameOf(V.offer) + ' offers a draw.'), btn('Accept', () => send({ draw: 'accept' }), ''), btn('Decline', () => send({ draw: 'decline' }), 'ghost'));
          else offerEl.append(el('span', null, V.offer === seat ? 'You offered a draw.' : nameOf(V.offer) + ' offers a draw.'));
        }
        // resign and offer a draw, each asked twice
        btnEl.innerHTML = '';
        btnEl.hidden = seat < 0 || !V || !!V.over;
        if (!btnEl.hidden) {
          const no = () => { confirm = null; sfx('back'); drawSide(); };
          if (confirm === 'resign') btnEl.append(el('span', null, 'Resign this game?'), btn('Resign', () => { confirm = null; send({ resign: true }); }, 'danger'), btn('Cancel', no, 'ghost'));
          else if (confirm === 'draw') btnEl.append(el('span', null, 'Offer a draw?'), btn('Offer', () => { confirm = null; send({ draw: 'offer' }); }, ''), btn('Cancel', no, 'ghost'));
          else btnEl.append(btn('½ Offer draw', () => { confirm = 'draw'; sfx('ok'); drawSide(); }, 'ghost', !V.mayOffer), btn('Resign', () => { confirm = 'resign'; sfx('ok'); drawSide(); }, 'danger'));
        }
      }
      // the moves
      const mk2 = F.sn + ':' + F.sans.length + ':' + F.sans[F.sans.length - 1];
      if (mk2 === movesKey) return;
      movesKey = mk2;
      const rows = [];
      let row = null;
      F.sans.forEach((m, i) => {
        const ply = F.sn + i;
        if (!row || !(ply & 1)) { row = el('div', { class: 'ch-mv' }, el('i', null, (ply >> 1) + 1 + '.')); rows.push(row); if (ply & 1) row.append(el('span', { class: 'ch-dots' }, '...')); }
        row.append(el('span', { class: i === F.sans.length - 1 ? 'now' : '' }, m));
      });
      movesEl.innerHTML = '';
      if (F.sn) movesEl.append(el('div', { class: 'ch-more' }, '(earlier moves not shown)'));
      if (rows.length) movesEl.append(...rows); else movesEl.append(el('div', { class: 'ch-more' }, 'No moves yet.'));
      movesEl.scrollTop = movesEl.scrollHeight;
    }
    function btn(label, fn, cls, off) {
      return el('button', { class: 'btn small ' + cls + (off ? ' off' : ''), 'aria-disabled': off ? 'true' : null, onclick: () => { if (!off) fn(); } }, label);
    }
    function drawAll() { drawBoard(); drawBars(); drawSide(); }

    /* ---- the clocks: the view says how much each has left; between views ours counts down here */
    const clockMs = s => !clk ? 0 : clk.run === s ? Math.max(0, clk.ms[s] - (performance.now() - clk.at)) : clk.ms[s];
    const fmt = ms => { if (ms >= 10000) { const t = Math.ceil(ms / 1000); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); } return '0:' + (Math.floor(ms / 100) / 10).toFixed(1).padStart(4, '0'); };
    function tick() {
      if (!clk) return;
      for (const b of bars) {
        const ms = clockMs(b.s), run = clk.run === b.s;
        b.clock.textContent = fmt(ms);
        b.clock.classList.toggle('run', run);
        b.clock.classList.toggle('low', ms < 20000 && (run || ms === 0));
        if (run && b.s === seat && ms > 0 && ms < 10000) { const sec = Math.ceil(ms / 1000); if (sec !== beep) { beep = sec; sfx('tick'); } }
      }
    }
    const timer = setInterval(tick, 100);

    /* ---- picking pieces and squares */
    function select(s) {
      sel = s;
      const seen = new Set();
      tg = F.moves.filter(m => m.f === s && !seen.has(m.t) && seen.add(m.t)).map(m => ({ t: m.t, cap: m.cap }));
      drawBoard();
    }
    function clearSel() { sel = -1; tg = []; drawBoard(); }
    function tryMove(f, t) {
      const ms = F.moves.filter(m => m.f === f && m.t === t);
      if (!ms.length) { sfx('bad'); clearSel(); return; }
      if (ms[0].promo) { promo = { f, t }; sel = f; tg = []; drawBoard(); return; }
      send({ from: nm(f), to: nm(t) });
    }
    function pickPromo(p) { if (!promo) return; const { f, t } = promo; promo = null; send({ from: nm(f), to: nm(t), promo: p }); }
    /* the same as a tap: move to a target, pick up one of ours, or let go */
    function tapSquare(s) {
      if (promo || s < 0) return;
      if (sel >= 0 && tg.some(x => x.t === s)) { tryMove(sel, s); return; }
      if (canMove() && mine(s)) { if (sel === s) clearSel(); else { select(s); sfx('key'); } return; }
      if (sel >= 0) clearSel();
    }

    /* ---- sending: a board move shows at once; the host's view then confirms it (or puts things back) */
    function send(m) {
      if (dead) return;
      sel = -1; tg = []; promo = null;
      if (m.from) {
        const r = playFen(F.fen, m.from, m.to, m.promo);
        if (!r) { sfx('bad'); drawAll(); return; }
        const nf = info(r.fen);
        nf.last = [m.from, m.to]; nf.sans = F.sans.concat(r.san); nf.sn = F.sn;
        nf.caps = F.caps.slice(); if (r.took) nf.caps[seat] += r.took;
        F = nf;
        if (clk && clk.run === seat) { clk.ms[seat] = clockMs(seat) + (F.sn + F.sans.length > 1 ? clk.inc : 0); clk.run = seat ^ 1; clk.at = performance.now(); }
        else if (clk && clk.run == null) { clk.run = seat ^ 1; clk.at = performance.now(); }
        sfx(m.promo ? 'solve' : r.took ? 'del' : 'key');
        clearTimeout(pend);
        pend = setTimeout(() => { pend = 0; if (V) show(V, null); }, 8000);
      } else sfx('ok');
      drawAll();
      try { api.act(m); } catch (e) { /* the controller says what went wrong */ }
      // on this device a refusal comes back at once (as a toast, with no new view): put the board back now
      if (pend && !api.online && !dead) { clearTimeout(pend); pend = 0; if (V) show(V, null); }
    }

    /* ---- a new view */
    function show(v, prev) {
      const nf = info(v.fen);
      if (!nf) return;
      const moved = nf.fen !== F.fen;
      nf.last = v.last || null; nf.sans = Array.isArray(v.sans) ? v.sans : []; nf.sn = v.sn || 0; nf.caps = Array.isArray(v.caps) ? v.caps : ['', ''];
      const plies = x => x ? (x.sn || 0) + (x.sans ? x.sans.length : 0) : 0;
      const fresh = prev && plies(v) > plies(prev) && moved;            // a move we haven't shown yet (theirs, usually)
      F = nf;
      if (moved || v.over) { sel = -1; tg = []; promo = null; drag = null; dropGhost(); }
      clk = v.clock && Array.isArray(v.clock.ms) ? { ms: v.clock.ms.slice(), run: v.over ? null : v.clock.run, inc: v.clock.inc || 0, at: Vat } : null;
      if (v.over) confirm = null;
      drawAll();
      if (fresh && v.last) {
        slide(v.last);
        const took = (v.caps || []).join('').length > (prev.caps || []).join('').length;
        sfx(v.check ? 'ping' : took ? 'del' : 'key');
      }
      if (prev && !v.over && seat >= 0 && v.offer === (seat ^ 1) && prev.offer !== v.offer) sfx('ping');
      if (prev && !v.over && seat >= 0 && prev.offer === seat && v.offer == null && plies(v) === plies(prev) && api.toast) api.toast(nameOf(seat ^ 1) + ' declined the draw.');
    }
    /* the piece glides from where it was */
    function slide(last) {
      const f = at(last[0]), t = at(last[1]);
      if (f < 0 || t < 0) return;
      const df = d2s(f), dt = d2s(t), q = SQ[dt];
      q.pc.style.transition = 'none';
      q.pc.style.transform = 'translate(' + ((df & 7) - (dt & 7)) * 100 + '%,' + ((df >> 3) - (dt >> 3)) * 100 + '%)';
      q.el.style.zIndex = 3;
      void q.pc.offsetWidth;
      q.pc.style.transition = 'transform .2s ease';
      q.pc.style.transform = '';
      setTimeout(() => { q.el.style.zIndex = ''; q.pc.style.transition = ''; }, 230);
    }

    /* ---- pointer: tap a piece then a square, or drag it there */
    function pointSq(x, y) {
      const r = board.getBoundingClientRect();
      if (!r.width) return -1;
      const c = Math.floor((x - r.left) / r.width * 8), w = Math.floor((y - r.top) / r.height * 8);
      return c < 0 || c > 7 || w < 0 || w > 7 ? -1 : d2s(w * 8 + c);
    }
    function dropGhost() { if (ghost) { ghost.remove(); ghost = null; } }
    function moveGhost(e) { if (ghost) { ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px'; } }
    board.addEventListener('pointerdown', e => {
      if ((e.pointerType === 'mouse' && e.button !== 0) || promo || drag) return;
      const s = pointSq(e.clientX, e.clientY);
      if (s < 0) return;
      e.preventDefault();
      cur = -1; typed = '';
      if (sel >= 0 && tg.some(x => x.t === s)) { tryMove(sel, s); return; }
      if (canMove() && mine(s)) {
        const was = sel === s;
        if (!was) { select(s); sfx('key'); }
        drag = { s, x: e.clientX, y: e.clientY, id: e.pointerId, on: false, was, touch: e.pointerType !== 'mouse', over: -1 };
        try { board.setPointerCapture(e.pointerId); } catch (x) { /* fine without */ }
        drawBoard();
        return;
      }
      if (sel >= 0) clearSel(); else drawBoard();
    });
    board.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.on) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
        drag.on = true;
        const size = board.getBoundingClientRect().width / 8;
        ghost = el('div', { class: 'ch-ghost' + (drag.touch ? ' touch' : ''), style: { width: size + 'px', height: size + 'px' } });
        ghost.innerHTML = SVG[F.board[drag.s]] || '';
        document.body.append(ghost);
      }
      e.preventDefault();
      moveGhost(e);
      const s = pointSq(e.clientX, e.clientY);
      if (s !== drag.over) { drag.over = s; drawBoard(); }
    });
    const endDrag = (e, cancel) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null; dropGhost();
      try { board.releasePointerCapture(e.pointerId); } catch (x) { /* already released */ }
      if (cancel) { drawBoard(); return; }
      if (d.on) {
        const s = pointSq(e.clientX, e.clientY);
        if (s >= 0 && s !== d.s && tg.some(x => x.t === s)) tryMove(d.s, s);
        else { if (s >= 0 && s !== d.s) sfx('bad'); drawBoard(); }
      } else if (d.was) clearSel();
    };
    board.addEventListener('pointerup', e => endDrag(e, false));
    board.addEventListener('pointercancel', e => endDrag(e, true));
    board.addEventListener('lostpointercapture', e => { if (drag && drag.id === e.pointerId && drag.on) endDrag(e, true); });
    board.addEventListener('contextmenu', e => e.preventDefault());

    /* ---- keyboard: arrows and Enter (or Space), or type squares ("e2" then "e4"); q r b n promote; Esc lets go */
    const onKey = e => {
      if (dead || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
      if (!document.body.contains(board) || document.querySelector('.overlay')) return;
      const k = e.key;
      let used = true;
      if (promo) {
        if (/^[qrbn]$/i.test(k)) pickPromo(k.toLowerCase());
        else if (k === 'Escape' || k === 'Backspace') { promo = null; clearSel(); }
        else used = false;
      } else if (/^Arrow(Up|Down|Left|Right)$/.test(k)) {
        if (cur < 0) cur = sel >= 0 ? sel : seat === 1 ? 52 : 12;
        else {
          const d = d2s(cur), r = d >> 3, c = d & 7;
          const nr = Math.max(0, Math.min(7, r + (k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : 0))), nc = Math.max(0, Math.min(7, c + (k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0)));
          cur = d2s(nr * 8 + nc);
        }
        drawBoard();
      } else if (k === 'Enter' || k === ' ') { if (cur >= 0) tapSquare(cur); else used = false; }
      else if (k === 'Escape' || k === 'Backspace') {
        if (sel >= 0 || cur >= 0 || typed) { typed = ''; cur = -1; clearSel(); } else used = false;
      } else if (/^[a-h]$/i.test(k)) typed = k.toLowerCase();
      else if (/^[1-8]$/.test(k) && typed) { cur = at(typed + k); typed = ''; tapSquare(cur); drawBoard(); }
      else used = false;
      if (used) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', onKey, true);       // before the app's own keys, so Esc can let go of a piece first

    drawAll();
    return {
      update(v) {
        if (dead || !v || typeof v !== 'object' || typeof v.fen !== 'string') return;
        const prev = V;
        V = v; Vat = performance.now();
        if (pend) { clearTimeout(pend); pend = 0; }
        show(v, prev);
      },
      destroy() {
        dead = true;
        clearInterval(timer); clearTimeout(pend);
        window.removeEventListener('keydown', onKey, true);
        dropGhost(); wrap.remove();
      },
    };
  }

  /* ------------------------------------------------------------ the game */
  const game = {
    id: 'chess', name: 'Chess', blurb: 'The classic, against the CPU or a friend', players: [2, 2], lex: false,
    howto: [
      'Standard chess: checkmate your opponent\'s king. White moves first.',
      'Tap a piece to see where it can go, then tap a square (or drag the piece). The last move and any check are highlighted. A pawn reaching the far side asks what it becomes.',
      'Every rule is in: castling, en passant, promotion, and the draws (stalemate, the same position three times, fifty moves with no capture or pawn move, or not enough pieces left to mate).',
      'You can offer a draw or resign from the buttons under the board. With a clock on, running out of time loses (unless your opponent couldn\'t mate anyway).',
    ],
    options: [{ key: 'clock', label: 'CLOCK', values: [['none', 'No clock'], ['3+2', '3 + 2'], ['5+0', '5 min'], ['10+0', '10 min']], def: 'none' }],
    setup, view, move, turn, due, timeout, result, cpu, mount,
    search, levels: LEVELS, lib,
  };
  G.Chess = game;
  if (G.Games) G.Games.add(game);
})();
