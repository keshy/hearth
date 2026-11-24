import { el, rand } from "../dom.js";
import { DIE } from "./snakes.js";

// Board geometry on a 15x15 grid, [row, col]. The shared track has 52
// squares starting at red's start; each colour enters it at START and turns
// into its home column after 50 steps. A token's position is -1 in the yard,
// 0..50 on the track (counted from its own start), 51..55 up the home column
// and 56 home.
export const NAMES = ["Red", "Green", "Yellow", "Blue"];
export const HEX = ["#e63946", "#2a9d8f", "#f4b400", "#3a86ff"];
export const START = [0, 13, 26, 39];
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
export const HOME = 56;

function line(r1, c1, r2, c2) {
  const out = [], dr = Math.sign(r2 - r1), dc = Math.sign(c2 - c1);
  for (let r = r1, c = c1; ; r += dr, c += dc) { out.push([r, c]); if (r === r2 && c === c2) return out; }
}
export const TRACK = [
  ...line(6, 1, 6, 5), ...line(5, 6, 0, 6), [0, 7], ...line(0, 8, 5, 8), ...line(6, 9, 6, 14), [7, 14],
  ...line(8, 14, 8, 9), ...line(9, 8, 14, 8), [14, 7], ...line(14, 6, 9, 6), ...line(8, 5, 8, 0), [7, 0], [6, 0],
];
const HOME_COL = [line(7, 1, 7, 5), line(1, 7, 5, 7), line(7, 13, 7, 9), line(13, 7, 9, 7)];

export const square = (color, rel) => (START[color] + rel) % 52;

export function movable(state) {
  const seat = state.turn, die = state.die;
  return state.tokens[seat].map((p, i) => ((p === -1 && die === 6) || (p >= 0 && p + die <= HOME) ? i : -1)).filter((i) => i >= 0);
}

function pass(state) {
  return { ...state, turn: (state.turn + 1) % state.seats.length, phase: "roll", die: 0, sixes: 0 };
}

export function rollDie(state, die) {
  if (state.winner != null || state.phase !== "roll") return null;
  const sixes = die === 6 ? state.sixes + 1 : 0;
  const s = { ...state, die, sixes, last: { seat: state.turn, die } };
  if (sixes === 3) return { ...pass(s), last: { seat: state.turn, die, note: "three sixes: turn lost" } };
  const options = movable(s);
  if (!options.length) return die === 6 ? { ...s, phase: "roll" } : { ...pass(s), last: { ...s.last, note: "no move" } };
  const targets = new Set(options.map((i) => s.tokens[s.turn][i]));
  if (options.length === 1 || targets.size === 1) return moveToken({ ...s, phase: "move" }, options[0]);
  return { ...s, phase: "move" };
}

export function moveToken(state, t) {
  if (state.phase !== "move" || !movable(state).includes(t)) return null;
  const seat = state.turn, color = state.colors[seat], die = state.die;
  const tokens = state.tokens.map((x) => x.slice());
  const from = tokens[seat][t];
  const to = from === -1 ? 0 : from + die;
  tokens[seat][t] = to;
  let captured = 0;
  if (to <= 50) {
    const sq = square(color, to);
    if (!SAFE.has(sq)) {
      tokens.forEach((list, other) => {
        if (other === seat) return;
        list.forEach((p, i) => {
          if (p >= 0 && p <= 50 && square(state.colors[other], p) === sq) { list[i] = -1; captured++; }
        });
      });
    }
  }
  const done = tokens[seat].every((p) => p === HOME);
  const s = { ...state, tokens, last: { seat, die, token: t, from, to, captured } };
  if (done) return { ...s, winner: seat, phase: "over" };
  if (die === 6 || captured || to === HOME) return { ...s, phase: "roll", die: 0 };
  return pass(s);
}

// The computer likes captures, getting home, leaving the yard and safety.
export function botChoice(state) {
  const seat = state.turn, color = state.colors[seat];
  let best = -1, top = -Infinity;
  for (const t of movable(state)) {
    const from = state.tokens[seat][t], to = from === -1 ? 0 : from + state.die;
    let score = to - Math.max(from, 0) + Math.random();
    if (to === HOME) score += 40;
    if (from === -1) score += 30;
    if (to <= 50) {
      const sq = square(color, to);
      if (SAFE.has(sq)) score += 12;
      else state.tokens.forEach((list, o) => { if (o !== seat) list.forEach((p) => { if (p >= 0 && p <= 50 && square(state.colors[o], p) === sq) score += 60; }); });
    } else score += 10;
    if (score > top) { top = score; best = t; }
  }
  return best;
}

function cellOf(color, p) {
  if (p >= 0 && p <= 50) return TRACK[square(color, p)];
  if (p > 50 && p < HOME) return HOME_COL[color][p - 51];
  return null;
}

function board(state, me, onToken) {
  const seat = state.turn;
  const canPick = state.phase === "move" && state.seats[seat] === me ? new Set(movable(state)) : new Set();
  const grid = el("div", { class: "ludo-board" });
  const kind = new Map();
  TRACK.forEach(([r, c], i) => kind.set(`${r},${c}`, { cls: "track" + (SAFE.has(i) ? " safe" : ""), color: START.indexOf(i) }));
  HOME_COL.forEach((cells, color) => cells.forEach(([r, c]) => kind.set(`${r},${c}`, { cls: "lane", color })));
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const k = kind.get(`${r},${c}`);
      if (!k) continue;
      grid.append(el("div", { class: "lc " + k.cls, style: { gridRow: r + 1, gridColumn: c + 1, ...(k.color >= 0 ? { background: HEX[k.color] } : {}) } }));
    }
  }
  const yards = [[1, 1], [1, 10], [10, 10], [10, 1]];
  const token = (s, i) => el("button", {
    type: "button",
    class: "ltok" + (canPick.has(i) && s === seat ? " pick" : "") + (state.last?.seat === s && state.last?.token === i ? " moved" : ""),
    style: { background: HEX[state.colors[s]] },
    disabled: !(canPick.has(i) && s === seat),
    "aria-label": `${NAMES[state.colors[s]]} token ${i + 1}`,
    onclick: () => onToken(i),
  });
  yards.forEach(([r, c], color) => {
    const s = state.colors.indexOf(color);
    grid.append(el("div", { class: "yard", style: { gridRow: `${r} / span 6`, gridColumn: `${c} / span 6`, background: HEX[color] } },
      el("div", { class: "yard-in" }, [0, 1, 2, 3].map((i) => el("div", { class: "spot" }, s >= 0 && state.tokens[s][i] === -1 ? token(s, i) : "")))));
  });
  const home = el("div", { class: "ludo-home", style: { gridRow: "7 / span 3", gridColumn: "7 / span 3" } });
  grid.append(home);
  const stacks = new Map();
  state.tokens.forEach((list, s) => list.forEach((p, i) => {
    if (p === HOME) { home.append(token(s, i)); return; }
    const at = cellOf(state.colors[s], p);
    if (!at) return;
    const k = at.join(",");
    if (!stacks.has(k)) stacks.set(k, []);
    stacks.get(k).push(token(s, i));
  }));
  for (const [k, toks] of stacks) {
    const [r, c] = k.split(",").map(Number);
    grid.append(el("div", { class: "lstack n" + Math.min(toks.length, 4), style: { gridRow: r + 1, gridColumn: c + 1 } }, toks));
  }
  return grid;
}

const SEAT_COLORS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

export default {
  id: "ludo",
  name: "Ludo",
  emoji: "🎲",
  blurb: "Race all four tokens home. Sixes bring tokens out; land on someone to send them back.",
  min: 2,
  max: 4,
  bots: true,
  start(players) {
    return {
      state: {
        seats: players.map((p) => p.id), colors: SEAT_COLORS[players.length],
        tokens: players.map(() => [-1, -1, -1, -1]), turn: 0, phase: "roll", die: 0, sixes: 0, last: null, winner: null,
      },
    };
  },
  status: (s) => (s.winner != null ? "over" : "playing"),
  turn: (s) => (s.winner != null ? null : s.seats[s.turn]),
  outcome: (s, players) => (s.winner != null ? `${players[s.seats[s.winner]]?.name || "?"} brought every token home!` : ""),
  badge: (s, pid) => el("span", { class: "dotbadge", style: { background: HEX[s.colors[s.seats.indexOf(pid)]] } }, ""),
  bot(state) {
    if (state.phase === "roll") return { state: rollDie(state, rand(6) + 1) };
    const t = botChoice(state);
    return t >= 0 ? { state: moveToken(state, t) } : null;
  },
  view({ state, me, act, players }) {
    const mine = state.winner == null && state.seats[state.turn] === me;
    const l = state.last;
    const who = l ? players[state.seats[l.seat]]?.name : "";
    let news = "Roll a six to bring a token out.";
    if (l) {
      news = `${who} rolled ${l.die}`;
      if (l.note) news += ` (${l.note})`;
      else if (l.token != null) news += l.from === -1 ? " and brought a token out." : l.to === HOME ? " and got a token home! 🏠" : ".";
      if (l.captured) news += " Captured! 💥";
    }
    const prompt = !mine ? `${players[state.seats[state.turn]]?.name || "?"}'s turn (${NAMES[state.colors[state.turn]]})`
      : state.phase === "roll" ? "Your roll!" : "Tap a glowing token to move it.";
    return el("div", { class: "ludo" },
      board(state, me, (t) => act((s) => { const n = moveToken(s, t); return n && { state: n }; })),
      el("div", { class: "dice-row" },
        el("span", { class: "die" + (l ? " rolled" : "") }, l ? DIE[l.die] : "🎲"),
        el("button", { type: "button", class: "primary big", disabled: !(mine && state.phase === "roll"), onclick: () => act((s) => { const n = rollDie(s, rand(6) + 1); return n && { state: n }; }) }, mine && state.phase === "roll" ? "Roll!" : state.phase === "move" && mine ? "Pick a token" : "Waiting…")),
      el("p", { class: "news" }, prompt, el("br"), el("small", { class: "muted" }, news)),
    );
  },
};
