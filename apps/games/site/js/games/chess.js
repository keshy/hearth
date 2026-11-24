import { el } from "../dom.js";
import * as R from "./chess-rules.js";

const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

function move(state, m) {
  const pos = state.pos;
  const legal = R.legalMoves(pos).find((x) => x.from === m.from && x.to === m.to && (x.promo || "") === (m.promo || ""));
  if (!legal || state.result) return null;
  const next = R.apply(pos, legal);
  const seen = { ...state.seen };
  const k = R.key(next);
  seen[k] = (seen[k] || 0) + 1;
  const taken = { ...state.taken };
  if (next.captured) taken[pos.turn] = (taken[pos.turn] || "") + next.captured;
  delete next.captured;
  return {
    ...state,
    pos: next,
    seen,
    taken,
    moves: [...state.moves, R.san(pos, legal)],
    last: [legal.from, legal.to],
    result: R.result(next, seen),
  };
}

// Selection lives outside the room state: it's one player's own tapping.
let picked = null;
let promoting = null;

export default {
  id: "chess",
  name: "Chess",
  emoji: "♞",
  blurb: "The royal game, with every rule. Tap a piece, then tap where it goes.",
  min: 2,
  max: 2,
  bots: true,
  start(players) {
    const pos = R.initial();
    return { state: { white: players[0].id, black: players[1].id, pos, seen: { [R.key(pos)]: 1 }, taken: {}, moves: [], last: null, result: null } };
  },
  status: (s) => (s.result ? "over" : "playing"),
  turn: (s) => (s.result ? null : s.pos.turn === "w" ? s.white : s.black),
  outcome(s, players) {
    if (!s.result) return "";
    if (!s.result.winner) return `Draw: ${s.result.why}.`;
    const who = players[s.result.winner === "w" ? s.white : s.black]?.name || "?";
    return s.result.why === "resigned" ? `${who} wins: the other side resigned.` : `Checkmate! ${who} wins.`;
  },
  badge: (s, pid) => (pid === s.white ? "♔" : pid === s.black ? "♚" : ""),
  bot(state) {
    const m = R.botMove(state.pos);
    const next = m && move(state, m);
    return next ? { state: next } : null;
  },
  view({ state, me, act, rerender }) {
    const color = me === state.white ? "w" : me === state.black ? "b" : null;
    const myTurn = color && !state.result && state.pos.turn === color;
    const flip = color === "b";
    const legal = myTurn ? R.legalMoves(state.pos) : [];
    if (picked != null && (!myTurn || state.pos.b[picked] === "" || R.colorOf(state.pos.b[picked]) !== color)) picked = null;
    const targets = new Set(picked == null ? [] : legal.filter((m) => m.from === picked).map((m) => m.to));
    const checkSq = R.inCheck(state.pos) ? R.kingSquare(state.pos.b, state.pos.turn) : -1;

    const send = (m) => {
      picked = null;
      promoting = null;
      act((s) => { const n = move(s, m); return n && { state: n }; });
    };
    const tap = (sq) => {
      if (!myTurn) return;
      if (picked != null && targets.has(sq)) {
        const options = legal.filter((m) => m.from === picked && m.to === sq);
        if (options[0].promo) { promoting = { from: picked, to: sq }; rerender(); return; }
        send(options[0]);
        return;
      }
      picked = R.colorOf(state.pos.b[sq]) === color && legal.some((m) => m.from === sq) ? sq : null;
      rerender();
    };

    const squares = [];
    for (let i = 0; i < 64; i++) {
      const sq = flip ? 63 - i : i;
      const p = state.pos.b[sq];
      const r = Math.floor(sq / 8), f = sq % 8;
      const cls = ["sq", (r + f) % 2 ? "dark" : "light"];
      if (state.last?.includes(sq)) cls.push("last");
      if (sq === picked) cls.push("picked");
      if (targets.has(sq)) cls.push(p ? "target capture" : "target");
      if (sq === checkSq) cls.push("check");
      squares.push(el("button", { type: "button", class: cls.join(" "), "aria-label": R.name(sq) + (p ? " " + p : ""), onclick: () => tap(sq) },
        p ? el("span", { class: "pc " + R.colorOf(p) }, GLYPH[p.toLowerCase()]) : "",
        (flip ? r === 0 : r === 7) ? el("i", { class: "file" }, R.FILES[f]) : "",
        (flip ? f === 7 : f === 0) ? el("i", { class: "rank" }, 8 - r) : ""));
    }
    const tray = (c) => el("div", { class: "tray" }, [...(state.taken[c] || "")].map((p) => el("span", { class: "pc " + R.colorOf(p) }, GLYPH[p.toLowerCase()])));

    const moves = [];
    for (let i = 0; i < state.moves.length; i += 2) moves.push(el("li", {}, `${state.moves[i]} ${state.moves[i + 1] || ""}`));

    const side = state.pos.turn === "w" ? "White" : "Black";
    const news = state.result ? "" : myTurn ? `Your move (${side})${checkSq >= 0 ? ": you're in check!" : ""}` : `${side} to move${checkSq >= 0 ? ": check!" : ""}`;
    return el("div", { class: "chess" },
      news && el("p", { class: "news" }, news),
      tray(flip ? "w" : "b"),
      el("div", { class: "chess-board" + (myTurn ? " live" : "") }, squares),
      tray(flip ? "b" : "w"),
      promoting && el("div", { class: "promo", role: "dialog", "aria-label": "Promote to" },
        el("span", {}, "Promote to"),
        [..."qrbn"].map((q) => el("button", { type: "button", class: "pc " + color, onclick: () => send({ ...promoting, promo: q }) }, GLYPH[q])),
        el("button", { type: "button", class: "ghost small", onclick: () => { promoting = null; rerender(); } }, "Cancel")),
      el("ol", { class: "movelist" }, moves),
      color && !state.result && el("button", {
        type: "button", class: "ghost small",
        onclick: () => confirm("Resign this game?") && act((s) => ({ state: { ...s, result: { winner: color === "w" ? "b" : "w", why: "resigned" } } })),
      }, "Resign"),
    );
  },
};
