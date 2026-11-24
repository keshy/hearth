import { el, rand } from "../dom.js";

// Each fleet is its owner's private value. A shot waits in state.pending
// until the defender's device (or the host's, for the computer) answers it,
// so nobody's browser ever holds the other fleet.
export const SHIPS = [["Carrier", 5], ["Battleship", 4], ["Cruiser", 3], ["Submarine", 3], ["Destroyer", 2]];
const N = 10;

export function shipCells(origin, size, down) {
  const r = Math.floor(origin / N), c = origin % N;
  const cells = [];
  for (let i = 0; i < size; i++) {
    const rr = down ? r + i : r, cc = down ? c : c + i;
    if (rr >= N || cc >= N) return null;
    cells.push(rr * N + cc);
  }
  return cells;
}

export function fits(fleet, idx, cells) {
  if (!cells) return false;
  const taken = new Set(fleet.flatMap((s, i) => (i === idx ? [] : s.cells)));
  return cells.every((c) => !taken.has(c));
}

export function randomFleet() {
  const fleet = [];
  for (const [name, size] of SHIPS) {
    for (;;) {
      const down = rand(2) === 1;
      const cells = shipCells(rand(N * N), size, down);
      if (fits(fleet, -1, cells)) { fleet.push({ name, size, down, cells }); break; }
    }
  }
  return fleet;
}

const other = (state, pid) => state.seats.find((p) => p !== pid);

export function fire(state, by, at) {
  if (state.phase !== "firing" || state.pending || state.winner) return null;
  if (state.seats[state.turn] !== by || state.shots[by].some((s) => s.at === at)) return null;
  return { ...state, pending: { by, at } };
}

// answer resolves a pending shot against the defender's fleet.
export function answer(state, defender, fleet) {
  const p = state.pending;
  if (!p || p.by === defender || !fleet) return null;
  const ship = fleet.find((s) => s.cells.includes(p.at));
  const mine = [...state.shots[p.by].map((s) => s.at), p.at];
  const shot = { at: p.at, hit: !!ship };
  if (ship && ship.cells.every((c) => mine.includes(c))) shot.sunk = { name: ship.name, cells: ship.cells };
  const shots = { ...state.shots, [p.by]: [...state.shots[p.by], shot] };
  const lost = fleet.every((s) => s.cells.every((c) => mine.includes(c)));
  const next = { ...state, shots, pending: null, turn: state.seats.indexOf(defender) };
  if (lost) {
    next.winner = p.by;
    next.phase = "over";
    next.reveal = { ...state.reveal, [defender]: fleet };
  }
  return next;
}

// botTarget hunts at random on a checkerboard, then finishes off hits.
export function botTarget(shots) {
  const shot = new Map(shots.map((s) => [s.at, s]));
  const sunk = new Set(shots.flatMap((s) => s.sunk?.cells || []));
  const open = (c) => c >= 0 && c < N * N && !shot.has(c);
  for (const s of shots) {
    if (!s.hit || sunk.has(s.at)) continue;
    const r = Math.floor(s.at / N), c = s.at % N;
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const back = shot.get((r - dr) * N + (c - dc));
      const lined = back?.hit && !sunk.has(back.at);
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < N && cc >= 0 && cc < N && shot.get(rr * N + cc)?.hit && !sunk.has(rr * N + cc)) { rr += dr; cc += dc; }
      if (lined && rr >= 0 && rr < N && cc >= 0 && cc < N && open(rr * N + cc)) return rr * N + cc;
    }
  }
  for (const s of shots) {
    if (!s.hit || sunk.has(s.at)) continue;
    const r = Math.floor(s.at / N), c = s.at % N;
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < N && cc >= 0 && cc < N && open(rr * N + cc)) return rr * N + cc;
    }
  }
  const cells = [...Array(N * N).keys()].filter((c) => open(c));
  const even = cells.filter((c) => (Math.floor(c / N) + c) % 2 === 0);
  const pool = even.length ? even : cells;
  return pool[rand(pool.length)];
}

let draft = null;
let picked = -1;

function grid(cls, cellFn) {
  const cells = [];
  for (let i = 0; i < N * N; i++) cells.push(cellFn(i));
  return el("div", { class: "bs-grid " + cls }, cells);
}

function placing({ state, me, priv, act, rerender }) {
  if (state.ready[me]) {
    return el("div", { class: "bs-wait" },
      ownBoard(state, me, priv),
      el("p", { class: "news" }, "Your fleet is hidden and ready. Waiting for the other admiral…"));
  }
  if (!draft) draft = randomFleet();
  const at = new Map(draft.flatMap((s, i) => s.cells.map((c) => [c, i])));
  const board = grid("own placing", (i) => {
    const s = at.get(i);
    return el("button", {
      type: "button",
      class: "bs-cell" + (s != null ? " ship" : "") + (s != null && s === picked ? " picked" : ""),
      "aria-label": s != null ? draft[s].name : `row ${Math.floor(i / N) + 1} column ${(i % N) + 1}`,
      onclick: () => {
        if (s != null) picked = s === picked ? -1 : s;
        else if (picked >= 0) {
          const cells = shipCells(i, draft[picked].size, draft[picked].down);
          if (fits(draft, picked, cells)) draft[picked] = { ...draft[picked], cells };
        }
        rerender();
      },
    });
  });
  const rotate = () => {
    if (picked < 0) return;
    const s = draft[picked];
    const cells = shipCells(s.cells[0], s.size, !s.down);
    if (fits(draft, picked, cells)) { draft[picked] = { ...s, down: !s.down, cells }; rerender(); }
  };
  return el("div", { class: "bs-place" },
    el("p", { class: "news" }, "Place your fleet. Tap a ship to pick it, then tap water to move it."),
    board,
    el("div", { class: "row-btns" },
      el("button", { type: "button", class: "ghost", onclick: () => { draft = randomFleet(); picked = -1; rerender(); } }, "🔀 Shuffle"),
      el("button", { type: "button", class: "ghost", disabled: picked < 0, onclick: rotate }, "↻ Rotate"),
      el("button", {
        type: "button", class: "primary",
        onclick: () => {
          const fleet = draft;
          act((s) => {
            const ready = { ...s.ready, [me]: true };
            const both = s.seats.every((p) => ready[p]);
            return { state: { ...s, ready, phase: both ? "firing" : "placing" }, private: { [me]: fleet } };
          }).then((ok) => { if (ok) { draft = null; picked = -1; } });
        },
      }, "⚓ Ready!")));
}

function ownBoard(state, me, fleet) {
  const ships = new Set((fleet || []).flatMap((s) => s.cells));
  const hits = new Map((state.shots[other(state, me)] || []).map((s) => [s.at, s]));
  return grid("own", (i) => el("div", {
    class: "bs-cell" + (ships.has(i) ? " ship" : "") + (hits.has(i) ? (hits.get(i).hit ? " hit" : " miss") : "") + (state.pending?.at === i && state.pending.by !== me ? " incoming" : ""),
  }));
}

function enemyBoard(state, me, act) {
  const foe = other(state, me);
  const mine = new Map(state.shots[me].map((s) => [s.at, s]));
  const sunk = new Set(state.shots[me].flatMap((s) => s.sunk?.cells || []));
  const revealed = new Set((state.reveal?.[foe] || []).flatMap((s) => s.cells));
  const myTurn = state.phase === "firing" && !state.pending && state.seats[state.turn] === me;
  return grid("enemy" + (myTurn ? " live" : ""), (i) => {
    const s = mine.get(i);
    const cls = "bs-cell" + (s ? (s.hit ? " hit" : " miss") : "") + (sunk.has(i) ? " sunk" : "") + (revealed.has(i) && !s ? " ship ghost" : "") + (state.pending?.at === i && state.pending.by === me ? " aiming" : "");
    return el("button", {
      type: "button", class: cls, disabled: !myTurn || !!s,
      "aria-label": `row ${Math.floor(i / N) + 1} column ${(i % N) + 1}`,
      onclick: () => act((st) => { const n = fire(st, me, i); return n && { state: n }; }),
    });
  });
}

export default {
  id: "battleship",
  name: "Battleship",
  emoji: "🚢",
  blurb: "Hide your fleet, then hunt theirs one shot at a time.",
  min: 2,
  max: 2,
  bots: true,
  start(players) {
    const priv = {};
    const ready = {};
    for (const p of players) if (p.bot) { priv[p.id] = randomFleet(); ready[p.id] = true; }
    draft = null;
    picked = -1;
    return {
      state: { seats: players.map((p) => p.id), phase: "placing", ready, turn: 0, shots: Object.fromEntries(players.map((p) => [p.id, []])), pending: null, winner: null, reveal: {} },
      private: priv,
    };
  },
  status: (s) => (s.winner ? "over" : "playing"),
  turn(s) {
    if (s.winner) return null;
    if (s.phase === "placing") return s.seats.find((p) => !s.ready[p]) || null;
    return s.pending ? other(s, s.pending.by) : s.seats[s.turn];
  },
  outcome: (s, players) => (s.winner ? `${players[s.winner]?.name || "?"} sank the whole fleet! 🎉` : ""),
  // Answering shots, and showing your fleet once the game is over, happen
  // on your own device without you doing anything.
  auto(state, pid, fleet) {
    if (state.pending && state.pending.by !== pid && state.seats.includes(pid)) {
      const n = answer(state, pid, fleet);
      return n && { state: n };
    }
    if (state.phase === "over" && fleet && !state.reveal?.[pid]) return { state: { ...state, reveal: { ...state.reveal, [pid]: fleet } } };
    return null;
  },
  bot(state, pid) {
    if (state.phase !== "firing" || state.pending || state.seats[state.turn] !== pid) return null;
    const n = fire(state, pid, botTarget(state.shots[pid]));
    return n && { state: n };
  },
  view(ctx) {
    const { state, me, priv, act, players } = ctx;
    const seated = state.seats.includes(me);
    if (state.phase === "placing" && seated) return placing(ctx);
    const viewer = seated ? me : state.seats[0];
    const foe = other(state, viewer);
    const sunkNow = [...state.shots[viewer]].reverse().find((s) => s.sunk);
    const last = state.shots[viewer].at(-1), theirs = state.shots[foe].at(-1);
    const news = state.phase === "placing" ? "Admirals are placing their fleets…"
      : state.pending ? (state.pending.by === me ? "Firing… 💣" : `${players[state.pending.by]?.name} fired!`)
        : state.seats[state.turn] === me ? "Your turn: tap a square on their waters." : `${players[state.seats[state.turn]]?.name}'s turn.`;
    return el("div", { class: "bs" },
      el("p", { class: "news" }, news,
        last ? el("small", { class: "muted" }, ` Your last shot: ${last.hit ? (last.sunk ? `sank the ${last.sunk.name}!` : "hit!") : "miss."}`) : "",
        theirs ? el("small", { class: "muted" }, ` Their last: ${theirs.hit ? (theirs.sunk ? `sank your ${theirs.sunk.name}.` : "hit.") : "miss."}`) : ""),
      el("div", { class: "bs-boards" },
        el("section", {}, el("h3", {}, seated ? "Their waters" : `${players[foe]?.name}'s waters`), enemyBoard(state, viewer, seated ? act : () => {})),
        el("section", {}, el("h3", {}, seated ? "Your fleet" : `${players[viewer]?.name}'s waters`), ownBoard(state, viewer, seated ? priv : state.reveal?.[viewer]))),
      sunkNow && el("p", { class: "muted" }, `Sunk so far: ${state.shots[viewer].filter((s) => s.sunk).map((s) => s.sunk.name).join(", ")}`),
    );
  },
};
