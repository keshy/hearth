import { test } from "node:test";
import assert from "node:assert/strict";

import * as C from "../site/js/games/chess-rules.js";
import * as L from "../site/js/games/ludo.js";
import * as S from "../site/js/games/snakes.js";
import * as B from "../site/js/games/battleship.js";
import * as N from "../site/js/games/codenames.js";
import * as T from "../site/js/games/tictactoe.js";

const sq = (n) => (8 - Number(n[1])) * 8 + C.FILES.indexOf(n[0]);
function playSan(pos, ...moves) {
  for (const s of moves) {
    const m = C.legalMoves(pos).find((x) => C.san(pos, x).replace(/[+#]/, "") === s);
    assert.ok(m, `no move ${s}`);
    pos = C.apply(pos, m);
  }
  return pos;
}
function board(rows, turn = "w", castle = "") {
  const b = rows.join("").split("").map((c) => (c === "." ? "" : c));
  return { b, turn, castle, ep: -1, half: 0, full: 1 };
}

test("chess: openings, mate and draws", () => {
  const start = C.initial();
  assert.equal(C.legalMoves(start).length, 20);
  const mated = playSan(start, "f3", "e5", "g4", "Qh4");
  assert.deepEqual(C.result(mated), { winner: "b", why: "checkmate" });

  const stale = board(["k.......", "..Q.....", ".K......", "........", "........", "........", "........", "........"], "b");
  assert.equal(C.result(stale).why, "stalemate");
  assert.equal(C.result(board(["k.......", "........", ".K......", "........", "........", "........", "........", ".....N.."], "b")).why, "not enough pieces to checkmate");
});

test("chess: castling, en passant, promotion and notation", () => {
  let pos = board(["r...k..r", "pppppppp", "........", "........", "........", "........", "PPPPPPPP", "R...K..R"], "w", "KQkq");
  const castles = C.legalMoves(pos).filter((m) => m.castle).map((m) => C.san(pos, m)).sort();
  assert.deepEqual(castles, ["O-O", "O-O-O"]);
  pos = C.apply(pos, C.legalMoves(pos).find((m) => m.castle === "k"));
  assert.equal(pos.b[sq("g1")], "K");
  assert.equal(pos.b[sq("f1")], "R");
  assert.equal(pos.castle, "kq");

  // A rook under attack on f1 forbids castling through it.
  const blocked = board(["....kr..", "........", "........", "........", "........", "........", "........", "....K..R"], "w", "K");
  assert.equal(C.legalMoves(blocked).some((m) => m.castle), false);

  let ep = playSan(C.initial(), "e4", "a6", "e5", "d5");
  const take = C.legalMoves(ep).find((m) => m.enPassant);
  assert.equal(C.san(ep, take), "exd6");
  ep = C.apply(ep, take);
  assert.equal(ep.b[sq("d5")], "");
  assert.equal(ep.captured, "p");

  const promo = board([".......k", "P.......", "........", "........", "........", "........", "........", "K......."]);
  const options = C.legalMoves(promo).filter((m) => m.from === sq("a7"));
  assert.deepEqual(options.map((m) => m.promo).sort(), ["b", "n", "q", "r"]);
  assert.equal(C.san(promo, options.find((m) => m.promo === "q")), "a8=Q+");

  const knights = board(["k.......", "........", "........", "........", "........", "........", "........", "KN...N.."]);
  assert.ok(C.legalMoves(knights).map((m) => C.san(knights, m)).includes("Nbd2"));
});

test("chess: the computer takes a free queen", () => {
  const pos = board(["k.......", "........", "........", "...q....", "........", "........", "........", "K..R...."]);
  const m = C.botMove(pos);
  assert.equal(C.name(m.to), "d5");
});

test("ludo: the track and its rules", () => {
  assert.equal(L.TRACK.length, 52);
  assert.equal(new Set(L.TRACK.map((c) => c.join())).size, 52);
  const base = { seats: ["a", "b"], colors: [0, 2], tokens: [[-1, -1, -1, -1], [-1, -1, -1, -1]], turn: 0, phase: "roll", die: 0, sixes: 0, last: null, winner: null };

  let s = L.rollDie(base, 3);
  assert.equal(s.turn, 1, "no six, no move: turn passes");
  s = L.rollDie(base, 6);
  assert.equal(s.tokens[0][0], 0, "a single choice moves itself");
  assert.equal(s.turn, 0, "a six rolls again");
  assert.equal(s.phase, "roll");

  // Red lands on yellow's token (not a safe square) and sends it home.
  const hunt = { ...base, tokens: [[3, -1, -1, -1], [L.HOME - 1, L.HOME - 1, L.HOME - 1, 31]], phase: "roll" };
  assert.equal(L.square(0, 5), L.square(2, 31));
  const cap = L.rollDie(hunt, 2);
  assert.equal(cap.tokens[1][3], -1);
  assert.equal(cap.last.captured, 1);
  assert.equal(cap.turn, 0, "a capture earns another roll");

  // Safe squares protect.
  const safe = { ...base, tokens: [[5, -1, -1, -1], [L.HOME - 1, L.HOME - 1, L.HOME - 1, (8 - 26 + 52) % 52]] };
  assert.equal(L.square(2, safe.tokens[1][3]), 8);
  assert.equal(L.rollDie(safe, 3).tokens[1][3], safe.tokens[1][3]);

  // Home needs the exact roll; the last token home wins.
  const near = { ...base, tokens: [[L.HOME, L.HOME, L.HOME, 54], [-1, -1, -1, -1]] };
  assert.equal(L.rollDie(near, 3).turn, 1);
  const won = L.rollDie(near, 2);
  assert.equal(won.winner, 0);

  const third = L.rollDie({ ...base, sixes: 2, tokens: [[10, -1, -1, -1], [-1, -1, -1, -1]] }, 6);
  assert.equal(third.turn, 1);
  assert.match(third.last.note, /three sixes/);
});

test("snakes and ladders", () => {
  assert.deepEqual(S.cell(1), { row: 9, col: 0 });
  assert.deepEqual(S.cell(11), { row: 8, col: 9 });
  assert.deepEqual(S.cell(100), { row: 0, col: 0 });
  const s = { seats: ["a", "b"], pos: [0, 0], turn: 0, last: null, winner: null };
  let n = S.roll(s, 1);
  assert.equal(n.pos[0], 38);
  assert.equal(n.last.via, "ladder");
  assert.equal(n.turn, 1);
  assert.equal(S.roll({ ...s, pos: [97, 0] }, 6).pos[0], 97, "three over 100 bounces back three");
  assert.equal(S.roll({ ...s, pos: [97, 0] }, 5).pos[0], 78, "bounce to 98, then the snake");
  assert.equal(S.roll({ ...s, pos: [94, 0] }, 6).winner, 0);
  assert.equal(S.roll(s, 6).turn, 0);
});

test("battleship: shots are answered by the defender", () => {
  const fleet = [{ name: "Destroyer", size: 2, cells: [0, 1] }];
  let s = { seats: ["a", "b"], phase: "firing", ready: {}, turn: 0, shots: { a: [], b: [] }, pending: null, winner: null, reveal: {} };
  assert.equal(B.fire(s, "b", 5), null, "not b's turn");
  s = B.fire(s, "a", 0);
  assert.deepEqual(s.pending, { by: "a", at: 0 });
  assert.equal(B.answer(s, "a", fleet), null, "the shooter can't answer");
  s = B.answer(s, "b", fleet);
  assert.equal(s.shots.a[0].hit, true);
  assert.equal(s.turn, 1);
  s = B.answer(B.fire({ ...s, turn: 0 }, "a", 1), "b", fleet);
  assert.equal(s.shots.a[1].sunk.name, "Destroyer");
  assert.equal(s.winner, "a");
  assert.deepEqual(s.reveal.b, fleet);

  assert.equal(B.randomFleet().flatMap((x) => x.cells).length, 17);
  const next = B.botTarget([{ at: 44, hit: true }, { at: 45, hit: true }]);
  assert.ok([43, 46].includes(next), `follows the line, got ${next}`);
});

test("codenames: deal, clues and reveals", () => {
  const people = (n) => Array.from({ length: n }, (_, i) => ({ id: "p" + i }));
  const { state, key } = N.deal(people(4));
  assert.equal(state.mode, "teams");
  assert.equal(key.filter((c) => c === state.turn).length, 9);
  assert.equal(key.filter((c) => c === "assassin").length, 1);
  const spy = state.spymasters[state.turn];
  assert.equal(N.giveClue(state, spy, state.words[0], 2), null, "a board word isn't a clue");
  assert.equal(N.giveClue(state, spy, "two words", 2), null);
  let s = N.giveClue(state, spy, "zzzz", 1);
  assert.equal(s.guessesLeft, 2);
  const guesser = s.teams[s.turn].find((p) => p !== spy);
  assert.equal(N.guess(s, spy, 0), null, "spymasters don't guess");
  const own = key.indexOf(s.turn);
  s = N.reveal(N.guess(s, guesser, own), key);
  assert.equal(s.revealed[own], state.turn);
  assert.equal(s.guessesLeft, 1);
  const neutral = key.indexOf("neutral");
  s = N.reveal(N.guess(s, guesser, neutral), key);
  assert.notEqual(s.turn, state.turn, "a wrong card ends the turn");

  const coop = N.deal(people(2));
  assert.equal(coop.state.mode, "coop");
  let c = N.giveClue(coop.state, coop.state.spymasters.green, "zzzz", 1);
  const other = coop.state.teams.green[1];
  c = N.reveal(N.guess(c, other, coop.key.indexOf("assassin")), coop.key);
  assert.equal(c.winner, "nobody");
});

test("tic-tac-toe", () => {
  assert.deepEqual(T.winner([0, 0, 0, null, 1, 1, null, null, null]).line, [0, 1, 2]);
  assert.equal(T.winner([0, 1, 0, 0, 1, 1, 1, 0, 0]).seat, null);
  // The computer usually blocks an open line (it plays randomly a quarter of the time).
  let blocks = 0;
  for (let i = 0; i < 40; i++) if (T.botMove({ board: [0, 0, null, null, 1, null, null, null, null], turn: 1 }) === 2) blocks++;
  assert.ok(blocks > 20);
});
