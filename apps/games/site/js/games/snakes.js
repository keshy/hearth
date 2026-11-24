import { el, svg, rand } from "../dom.js";

// The classic Milton Bradley board.
export const LADDERS = { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 };
export const SNAKES = { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 };
export const COLORS = ["#e63946", "#2a9d8f", "#f4a261", "#457b9d", "#9b5de5", "#ffbe0b"];
const SNAKE_COLORS = ["#2d6a4f", "#9c27b0", "#e76f51", "#3a86ff", "#d00000", "#6a994e", "#bc6c25", "#7209b7", "#ff006e", "#588157"];

// Square n (1..100) sits in row/col counted from the top-left, snaking.
export function cell(n) {
  const i = n - 1, row = Math.floor(i / 10), col = row % 2 ? 9 - (i % 10) : i % 10;
  return { row: 9 - row, col };
}

// roll moves the current player; landing past 100 bounces back.
export function roll(state, die) {
  if (state.winner != null) return null;
  const seat = state.turn;
  const from = state.pos[seat];
  let to = from + die;
  if (to > 100) to = 200 - to;
  let via = null;
  if (LADDERS[to]) { via = "ladder"; to = LADDERS[to]; } else if (SNAKES[to]) { via = "snake"; to = SNAKES[to]; }
  const pos = state.pos.slice();
  pos[seat] = to;
  const won = to === 100;
  const again = die === 6 && !won;
  return {
    ...state,
    pos,
    last: { seat, from, to, die, via },
    turn: won || again ? seat : (seat + 1) % state.seats.length,
    winner: won ? seat : null,
  };
}

function boardSVG(state) {
  const S = 60;
  const center = (n) => { const c = cell(n); return [c.col * S + S / 2, c.row * S + S / 2]; };
  const cells = [];
  for (let n = 1; n <= 100; n++) {
    const c = cell(n);
    cells.push(svg("rect", { x: c.col * S, y: c.row * S, width: S, height: S, class: `sl-cell t${(c.row + c.col) % 4}` }));
    cells.push(svg("text", { x: c.col * S + 5, y: c.row * S + 15, class: "sl-num" }, document.createTextNode(n)));
  }
  const ladders = Object.entries(LADDERS).map(([a, b]) => {
    const [x1, y1] = center(+a), [x2, y2] = center(b);
    const len = Math.hypot(x2 - x1, y2 - y1), nx = -(y2 - y1) / len * 9, ny = (x2 - x1) / len * 9;
    const rungs = [];
    for (let t = 0.1; t < 1; t += 22 / len) {
      const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
      rungs.push(svg("line", { x1: x - nx, y1: y - ny, x2: x + nx, y2: y + ny, class: "sl-rung" }));
    }
    return svg("g", { class: "sl-ladder" },
      svg("line", { x1: x1 - nx, y1: y1 - ny, x2: x2 - nx, y2: y2 - ny, class: "sl-rail" }),
      svg("line", { x1: x1 + nx, y1: y1 + ny, x2: x2 + nx, y2: y2 + ny, class: "sl-rail" }), ...rungs);
  });
  const snakes = Object.entries(SNAKES).map(([a, b], i) => {
    const [x1, y1] = center(+a), [x2, y2] = center(b);
    const len = Math.hypot(x2 - x1, y2 - y1), nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
    const w = Math.min(40, len / 4);
    const pts = [[x1, y1]];
    const waves = Math.max(2, Math.round(len / 70));
    for (let k = 1; k <= waves; k++) {
      const t = (k - 0.5) / waves, side = k % 2 ? 1 : -1;
      pts.push([x1 + (x2 - x1) * t + nx * w * side, y1 + (y2 - y1) * t + ny * w * side]);
    }
    pts.push([x2, y2]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let k = 1; k < pts.length - 1; k++) {
      const [cx, cy] = pts[k], [nx2, ny2] = pts[k + 1];
      d += ` Q${cx},${cy} ${k === pts.length - 2 ? nx2 : (cx + nx2) / 2},${k === pts.length - 2 ? ny2 : (cy + ny2) / 2}`;
    }
    const col = SNAKE_COLORS[i % SNAKE_COLORS.length];
    return svg("g", { class: "sl-snake" },
      svg("path", { d, stroke: col, class: "sl-body" }),
      svg("path", { d, class: "sl-belly" }),
      svg("circle", { cx: x1, cy: y1, r: 11, fill: col }),
      svg("circle", { cx: x1 - 4, cy: y1 - 3, r: 2.6, class: "sl-eye" }),
      svg("circle", { cx: x1 + 4, cy: y1 - 3, r: 2.6, class: "sl-eye" }));
  });
  const tokens = state.pos.map((n, seat) => {
    if (n === 0) return null;
    const [x, y] = center(n);
    const same = state.pos.map((m, s) => [m, s]).filter(([m]) => m === n).map(([, s]) => s);
    const k = same.indexOf(seat), off = (k - (same.length - 1) / 2) * 13;
    return svg("g", { class: "sl-token" + (state.last?.seat === seat ? " moved" : "") },
      svg("circle", { cx: x + off, cy: y + 6, r: 13, fill: COLORS[seat] }),
      svg("text", { x: x + off, y: y + 11, class: "sl-tok-num" }, document.createTextNode(seat + 1)));
  });
  return svg("svg", { viewBox: `0 0 ${S * 10} ${S * 10}`, class: "sl-board", role: "img", "aria-label": "Snakes and ladders board" },
    ...cells, ...ladders, ...snakes, ...tokens);
}

export const DIE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

export default {
  id: "snakes",
  name: "Snakes & Ladders",
  emoji: "🐍",
  blurb: "Climb the ladders, dodge the snakes. Roll a six to go again.",
  min: 2,
  max: 6,
  bots: true,
  start(players) {
    return { state: { seats: players.map((p) => p.id), pos: players.map(() => 0), turn: 0, last: null, winner: null } };
  },
  status: (s) => (s.winner != null ? "over" : "playing"),
  turn: (s) => (s.winner != null ? null : s.seats[s.turn]),
  outcome: (s, players) => (s.winner != null ? `${players[s.seats[s.winner]]?.name || "?"} reached 100!` : ""),
  badge: (s, pid) => el("span", { class: "dotbadge", style: { background: COLORS[s.seats.indexOf(pid)] } }, s.seats.indexOf(pid) + 1),
  bot(state) {
    return { state: roll(state, rand(6) + 1) };
  },
  view({ state, me, act, players }) {
    const myTurn = state.winner == null && state.seats[state.turn] === me;
    const l = state.last;
    const who = l ? players[state.seats[l.seat]]?.name : "";
    const news = !l ? "Everyone starts off the board. Roll to begin!"
      : `${who} rolled ${l.die}` + (l.via === "ladder" ? ` and climbed a ladder to ${l.to}! 🪜` : l.via === "snake" ? ` and slid down a snake to ${l.to}. 🐍` : ` and moved to ${l.to}.`)
        + (l.die === 6 && state.winner == null ? " Six: roll again!" : "");
    return el("div", { class: "snakes" },
      boardSVG(state),
      el("div", { class: "dice-row" },
        el("span", { class: "die" + (l ? " rolled" : "") }, l ? DIE[l.die] : "🎲"),
        el("button", { type: "button", class: "primary big", disabled: !myTurn, onclick: () => act((s) => ({ state: roll(s, rand(6) + 1) })) }, myTurn ? "Roll!" : "Waiting…")),
      el("p", { class: "news" }, news),
    );
  },
};
