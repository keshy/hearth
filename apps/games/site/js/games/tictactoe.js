import { el } from "../dom.js";

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const MARK = ["✖", "◯"];

export function winner(board) {
  for (const l of LINES) {
    const [a, b, c] = l;
    if (board[a] != null && board[a] === board[b] && board[a] === board[c]) return { seat: board[a], line: l };
  }
  return board.every((x) => x != null) ? { seat: null, line: [] } : null;
}

export function play(state, i) {
  if (state.result || state.board[i] != null) return null;
  const board = state.board.slice();
  board[i] = state.turn;
  return { ...state, board, turn: 1 - state.turn, result: winner(board) };
}

// Minimax, with a little randomness so kids can win sometimes.
function best(board, seat) {
  const w = winner(board);
  if (w) return { score: w.seat == null ? 0 : w.seat === seat ? 1 : -1 };
  let top = { score: -2, i: -1 };
  for (let i = 0; i < 9; i++) {
    if (board[i] != null) continue;
    board[i] = seat;
    const s = -best(board, 1 - seat).score;
    board[i] = null;
    if (s > top.score) top = { score: s, i };
  }
  return top;
}

export function botMove(state) {
  const open = state.board.map((x, i) => (x == null ? i : -1)).filter((i) => i >= 0);
  if (!open.length) return -1;
  if (Math.random() < 0.25) return open[Math.floor(Math.random() * open.length)];
  return best(state.board.slice(), state.turn).i;
}

export default {
  id: "tictactoe",
  name: "Tic-Tac-Toe",
  emoji: "⭕",
  blurb: "Three in a row wins. Quick and classic.",
  min: 2,
  max: 2,
  bots: true,
  start(players) {
    return { state: { seats: players.map((p) => p.id), board: Array(9).fill(null), turn: 0, result: null } };
  },
  status: (s) => (s.result ? "over" : "playing"),
  turn: (s) => (s.result ? null : s.seats[s.turn]),
  outcome(s, players) {
    if (!s.result) return "";
    if (s.result.seat == null) return "It's a draw!";
    return `${players[s.seats[s.result.seat]]?.name || "?"} wins!`;
  },
  bot(state) {
    const i = botMove(state);
    const next = i >= 0 && play(state, i);
    return next ? { state: next } : null;
  },
  view({ state, me, act }) {
    const mySeat = state.seats.indexOf(me);
    const myTurn = !state.result && mySeat === state.turn;
    const win = new Set(state.result?.line || []);
    return el("div", { class: "ttt" },
      el("div", { class: "ttt-board" }, state.board.map((v, i) => el("button", {
        type: "button",
        class: `ttt-cell${v != null ? " m" + v : ""}${win.has(i) ? " win" : ""}`,
        disabled: !myTurn || v != null,
        "aria-label": v == null ? `square ${i + 1}` : MARK[v],
        onclick: () => act((s) => { const n = play(s, i); return n && { state: n }; }),
      }, v == null ? "" : MARK[v]))),
    );
  },
  badge: (s, pid) => MARK[s.seats.indexOf(pid)] || "",
};
