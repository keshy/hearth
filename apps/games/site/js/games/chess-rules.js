// Chess rules. Squares are 0..63 with 0 = a8 and 63 = h1; white pieces are
// upper case (PNBRQK), black lower case, empty squares "".

export const FILES = "abcdefgh";
export const name = (sq) => FILES[sq % 8] + (8 - Math.floor(sq / 8));
export const colorOf = (p) => (!p ? null : p === p.toUpperCase() ? "w" : "b");

export function initial() {
  const back = "rnbqkbnr".split("");
  const b = [...back, ..."pppppppp", ...Array(32).fill(""), ..."PPPPPPPP", ...back.map((c) => c.toUpperCase())];
  return { b, turn: "w", castle: "KQkq", ep: -1, half: 0, full: 1 };
}

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

function at(r, f) { return r >= 0 && r < 8 && f >= 0 && f < 8 ? r * 8 + f : -1; }

// attacked reports whether color `by` attacks square sq.
export function attacked(b, sq, by) {
  const r = Math.floor(sq / 8), f = sq % 8;
  const own = (p, t) => p && colorOf(p) === by && p.toLowerCase() === t;
  const dir = by === "w" ? 1 : -1; // white pawns attack from the row below
  for (const df of [-1, 1]) { const s = at(r + dir, f + df); if (s >= 0 && own(b[s], "p")) return true; }
  for (const [dr, df] of KNIGHT) { const s = at(r + dr, f + df); if (s >= 0 && own(b[s], "n")) return true; }
  for (const [dr, df] of KING) { const s = at(r + dr, f + df); if (s >= 0 && own(b[s], "k")) return true; }
  for (const [dirs, kinds] of [[ROOK, "rq"], [BISHOP, "bq"]]) {
    for (const [dr, df] of dirs) {
      for (let i = 1; ; i++) {
        const s = at(r + dr * i, f + df * i);
        if (s < 0) break;
        if (b[s]) { if (colorOf(b[s]) === by && kinds.includes(b[s].toLowerCase())) return true; break; }
      }
    }
  }
  return false;
}

export const kingSquare = (b, c) => b.indexOf(c === "w" ? "K" : "k");
export const inCheck = (pos, c = pos.turn) => attacked(pos.b, kingSquare(pos.b, c), c === "w" ? "b" : "w");

function pseudo(pos) {
  const { b, turn } = pos;
  const them = turn === "w" ? "b" : "w";
  const out = [];
  const add = (from, to, extra) => out.push({ from, to, ...extra });
  for (let from = 0; from < 64; from++) {
    const p = b[from];
    if (!p || colorOf(p) !== turn) continue;
    const r = Math.floor(from / 8), f = from % 8, t = p.toLowerCase();
    if (t === "p") {
      const dir = turn === "w" ? -1 : 1, startRow = turn === "w" ? 6 : 1, lastRow = turn === "w" ? 0 : 7;
      const push = (to, extra) => {
        if (Math.floor(to / 8) === lastRow) for (const q of "qrbn") add(from, to, { ...extra, promo: q });
        else add(from, to, extra);
      };
      const one = at(r + dir, f);
      if (one >= 0 && !b[one]) {
        push(one);
        const two = at(r + 2 * dir, f);
        if (r === startRow && !b[two]) add(from, two, { double: true });
      }
      for (const df of [-1, 1]) {
        const s = at(r + dir, f + df);
        if (s < 0) continue;
        if (b[s] && colorOf(b[s]) === them) push(s);
        else if (s === pos.ep) add(from, s, { enPassant: true });
      }
    } else if (t === "n" || t === "k") {
      for (const [dr, df] of t === "n" ? KNIGHT : KING) {
        const s = at(r + dr, f + df);
        if (s >= 0 && colorOf(b[s]) !== turn) add(from, s);
      }
      if (t === "k") {
        const home = turn === "w" ? 60 : 4;
        const [K, Q] = turn === "w" ? ["K", "Q"] : ["k", "q"];
        if (from === home && !attacked(b, home, them)) {
          if (pos.castle.includes(K) && !b[home + 1] && !b[home + 2] && !attacked(b, home + 1, them)) add(from, home + 2, { castle: "k" });
          if (pos.castle.includes(Q) && !b[home - 1] && !b[home - 2] && !b[home - 3] && !attacked(b, home - 1, them)) add(from, home - 2, { castle: "q" });
        }
      }
    } else {
      const dirs = t === "r" ? ROOK : t === "b" ? BISHOP : [...ROOK, ...BISHOP];
      for (const [dr, df] of dirs) {
        for (let i = 1; ; i++) {
          const s = at(r + dr * i, f + df * i);
          if (s < 0) break;
          if (!b[s]) { add(from, s); continue; }
          if (colorOf(b[s]) === them) add(from, s);
          break;
        }
      }
    }
  }
  return out;
}

export function apply(pos, m) {
  const b = pos.b.slice();
  const p = b[m.from];
  const captured = m.enPassant ? b[m.to + (pos.turn === "w" ? 8 : -8)] : b[m.to];
  b[m.to] = m.promo ? (pos.turn === "w" ? m.promo.toUpperCase() : m.promo) : p;
  b[m.from] = "";
  if (m.enPassant) b[m.to + (pos.turn === "w" ? 8 : -8)] = "";
  if (m.castle === "k") { b[m.from + 1] = b[m.from + 3]; b[m.from + 3] = ""; }
  if (m.castle === "q") { b[m.from - 1] = b[m.from - 4]; b[m.from - 4] = ""; }
  let castle = pos.castle;
  const drop = (chars) => { for (const c of chars) castle = castle.replace(c, ""); };
  if (p === "K") drop("KQ");
  if (p === "k") drop("kq");
  for (const s of [m.from, m.to]) {
    if (s === 63) drop("K");
    if (s === 56) drop("Q");
    if (s === 7) drop("k");
    if (s === 0) drop("q");
  }
  return {
    b,
    turn: pos.turn === "w" ? "b" : "w",
    castle,
    ep: m.double ? (m.from + m.to) / 2 : -1,
    half: p.toLowerCase() === "p" || captured ? 0 : pos.half + 1,
    full: pos.full + (pos.turn === "b" ? 1 : 0),
    captured: captured || "",
  };
}

export function legalMoves(pos) {
  return pseudo(pos).filter((m) => !inCheck(apply(pos, m), pos.turn));
}

// key identifies a position for the repetition rule.
export const key = (pos) => pos.b.map((p) => p || ".").join("") + pos.turn + pos.castle + pos.ep;

function insufficient(b) {
  const rest = b.filter((p) => p && p.toLowerCase() !== "k");
  return rest.length === 0 || (rest.length === 1 && "nb".includes(rest[0].toLowerCase()));
}

// result says how the game stands: null while it goes on.
export function result(pos, seen = {}) {
  if (!legalMoves(pos).length) {
    return inCheck(pos) ? { winner: pos.turn === "w" ? "b" : "w", why: "checkmate" } : { winner: null, why: "stalemate" };
  }
  if (insufficient(pos.b)) return { winner: null, why: "not enough pieces to checkmate" };
  if (pos.half >= 100) return { winner: null, why: "fifty moves without a capture or pawn move" };
  if ((seen[key(pos)] || 0) >= 3) return { winner: null, why: "the same position three times" };
  return null;
}

export function san(pos, m) {
  const p = pos.b[m.from];
  const t = p.toLowerCase();
  const next = apply(pos, m);
  const mark = inCheck(next) ? (legalMoves(next).length ? "+" : "#") : "";
  if (m.castle) return (m.castle === "k" ? "O-O" : "O-O-O") + mark;
  const capture = pos.b[m.to] || m.enPassant;
  let s = "";
  if (t === "p") s = capture ? FILES[m.from % 8] : "";
  else {
    s = t.toUpperCase();
    const twins = legalMoves(pos).filter((o) => o.to === m.to && o.from !== m.from && pos.b[o.from] === p);
    if (twins.length) {
      const sameFile = twins.some((o) => o.from % 8 === m.from % 8);
      const sameRank = twins.some((o) => Math.floor(o.from / 8) === Math.floor(m.from / 8));
      s += !sameFile ? FILES[m.from % 8] : !sameRank ? name(m.from)[1] : name(m.from);
    }
  }
  return s + (capture ? "x" : "") + name(m.to) + (m.promo ? "=" + m.promo.toUpperCase() : "") + mark;
}

// ---------- a friendly computer player ----------

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

function evaluate(pos) {
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const p = pos.b[i];
    if (!p) continue;
    const r = Math.floor(i / 8), f = i % 8;
    let v = VALUE[p.toLowerCase()];
    const center = 3.5 - Math.max(Math.abs(r - 3.5), Math.abs(f - 3.5));
    if ("nbp".includes(p.toLowerCase())) v += center * 8;
    if (p === "P") v += (6 - r) * 6;
    if (p === "p") v += (r - 1) * 6;
    s += colorOf(p) === "w" ? v : -v;
  }
  return pos.turn === "w" ? s : -s;
}

function search(pos, depth, alpha, beta) {
  const moves = legalMoves(pos);
  if (!moves.length) return inCheck(pos) ? -100000 - depth : 0;
  if (depth === 0) return evaluate(pos);
  moves.sort((a, b) => (pos.b[b.to] ? VALUE[pos.b[b.to].toLowerCase()] : 0) - (pos.b[a.to] ? VALUE[pos.b[a.to].toLowerCase()] : 0));
  for (const m of moves) {
    const s = -search(apply(pos, m), depth - 1, -beta, -alpha);
    if (s >= beta) return beta;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

export function botMove(pos, depth = 2) {
  const moves = legalMoves(pos);
  let best = [], top = -Infinity;
  for (const m of moves) {
    const s = -search(apply(pos, m), depth - 1, -Infinity, Infinity) + Math.random() * 12;
    if (s > top + 0.001) { top = s; best = [m]; }
  }
  return best[0] || null;
}
