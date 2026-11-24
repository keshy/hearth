import { el, shuffle } from "../dom.js";

// The key (which card is whose) is the spymasters' private value. A guess
// waits in state.pending until a spymaster's device reveals the card.
export const WORDS = (
  "apple anchor angel ant arrow astronaut avocado backpack balloon banana bandage bank bark bat beach bear bed bee bell bicycle " +
  "bird blanket boat bone book boot bottle bow bowl box brick bridge broom brush bubble bucket bus butter butterfly button " +
  "cactus cake camel camera candle candy cannon cap car card carpet carrot castle cat cave chair cheese cherry chess chicken " +
  "chimney chocolate circle circus clock cloud clown coat coconut coin comet compass computer cookie corn cow crab crayon " +
  "crown cup cupcake curtain diamond dice dinosaur doctor dog doll dolphin donkey door dragon drum duck eagle earth egg " +
  "elephant elevator engine eye fairy fan feather fence fire fish flag flute fog football forest fork fountain fox frog " +
  "garden ghost giant gift giraffe glass glove glue goat gold grape grass guitar hammer hand hat heart helicopter helmet " +
  "honey horse hospital ice igloo island jacket jam jelly jet jungle kangaroo key king kite kitten knight ladder lamp leaf " +
  "lemon library light lion lizard lock magnet mango map mask match medal mermaid milk mirror monkey moon mountain mouse " +
  "mud mushroom music nail needle nest net night ninja nose nut ocean octopus orange owl paint palace pan panda paper " +
  "parachute park parrot party peacock pear pen pencil penguin piano pickle pie pig pillow pilot pirate pizza planet plate " +
  "pocket police pond popcorn post potato present prince puzzle pyramid queen rabbit rain rainbow ring river robot rock " +
  "rocket roof root rope rose ruler sail salt sand sandwich school scissors sea shadow shark sheep shell ship shoe shop " +
  "sink skate slide snail snake snow soap sock soup spider spoon square squirrel star statue stick storm strawberry sugar " +
  "sun swan swing sword table tail teacher teeth telescope temple tent tiger toast tomato tooth torch tower toy tractor " +
  "train treasure tree triangle truck trumpet turtle umbrella unicorn vampire violin volcano wagon wall watch water wave " +
  "whale wheel whistle window wing witch wizard wolf worm yo-yo zebra zoo"
).split(" ");

export const COLORS = { red: "Red", blue: "Blue", green: "Green" };

export function deal(players) {
  const words = shuffle(WORDS).slice(0, 25);
  const ids = shuffle(players.map((p) => p.id));
  if (ids.length < 4) {
    const key = shuffle([...Array(9).fill("green"), ...Array(15).fill("neutral"), "assassin"]);
    return {
      state: {
        mode: "coop", words, revealed: Array(25).fill(null), teams: { green: ids }, spymasters: { green: ids[0] },
        turn: "green", phase: "clue", clue: null, guessesLeft: 0, cluesLeft: 8, pending: null, log: [], winner: null, why: "",
      },
      key,
    };
  }
  const first = ids.length % 2 ? "red" : ["red", "blue"][Math.floor(Math.random() * 2)];
  const second = first === "red" ? "blue" : "red";
  const key = shuffle([...Array(9).fill(first), ...Array(8).fill(second), ...Array(7).fill("neutral"), "assassin"]);
  const teams = { red: ids.filter((_, i) => i % 2 === 0), blue: ids.filter((_, i) => i % 2 === 1) };
  return {
    state: {
      mode: "teams", words, revealed: Array(25).fill(null), teams, spymasters: { red: teams.red[0], blue: teams.blue[0] },
      turn: first, phase: "clue", clue: null, guessesLeft: 0, pending: null, log: [], winner: null, why: "",
    },
    key,
  };
}

export const teamOf = (s, pid) => Object.keys(s.teams).find((t) => s.teams[t].includes(pid)) || null;
const isSpy = (s, pid) => Object.values(s.spymasters).includes(pid);
const otherTeam = (s, t) => (t === "red" ? "blue" : "red");

export function giveClue(s, pid, word, count) {
  word = (word || "").trim().toLowerCase();
  if (s.winner || s.phase !== "clue" || s.spymasters[s.turn] !== pid) return null;
  if (!/^[a-z][a-z'-]{0,23}$/.test(word) || !(count >= 0 && count <= 9)) return null;
  if (s.words.some((w, i) => !s.revealed[i] && (w === word || w.includes(word) || word.includes(w)))) return null;
  return {
    ...s, phase: "guess", clue: { word, count }, guessesLeft: count === 0 ? 25 : count + 1,
    log: [...s.log, { team: s.turn, word, count, picks: [] }],
  };
}

export function guess(s, pid, i) {
  if (s.winner || s.phase !== "guess" || s.pending || s.revealed[i]) return null;
  if (teamOf(s, pid) !== s.turn || isSpy(s, pid)) return null;
  return { ...s, pending: { i, by: pid } };
}

function endTurn(s) {
  if (s.mode === "coop") {
    const cluesLeft = s.cluesLeft - 1;
    if (cluesLeft <= 0) return { ...s, cluesLeft, phase: "over", winner: "nobody", why: "Out of clues. The agents got away!" };
    return { ...s, cluesLeft, phase: "clue", clue: null, guessesLeft: 0 };
  }
  return { ...s, turn: otherTeam(s, s.turn), phase: "clue", clue: null, guessesLeft: 0 };
}

export function reveal(s, key) {
  const p = s.pending;
  if (!p || !key) return null;
  const color = key[p.i];
  const revealed = s.revealed.slice();
  revealed[p.i] = color;
  const log = s.log.slice();
  const entry = { ...log[log.length - 1] };
  entry.picks = [...entry.picks, { word: s.words[p.i], color }];
  log[log.length - 1] = entry;
  let n = { ...s, revealed, log, pending: null };
  const left = (team) => key.filter((c, i) => c === team && !revealed[i]).length;
  if (color === "assassin") {
    return { ...n, phase: "over", winner: s.mode === "coop" ? "nobody" : otherTeam(s, s.turn), why: "The assassin was found! 💀" };
  }
  if (color === s.turn) {
    if (!left(color)) return { ...n, phase: "over", winner: color, why: "Every agent found!" };
    n.guessesLeft = s.guessesLeft - 1;
    return n.guessesLeft > 0 ? n : endTurn(n);
  }
  if (color !== "neutral" && !left(color)) return { ...n, phase: "over", winner: color, why: "They found the other team's last agent." };
  return endTurn(n);
}

function outcome(s) {
  if (!s.winner) return "";
  if (s.mode === "coop") return s.winner === "green" ? `You found all nine agents! ${s.why}` : s.why;
  return `${COLORS[s.winner]} team wins! ${s.why}`;
}

export function stopGuessing(s, pid) {
  if (s.phase !== "guess" || s.pending || teamOf(s, pid) !== s.turn || isSpy(s, pid)) return null;
  return endTurn(s);
}

export default {
  id: "codenames",
  name: "Codenames",
  emoji: "🕵️",
  blurb: "Spymasters give one-word clues; teammates find their agents. 2–3 players play together, 4+ play red vs blue.",
  min: 2,
  max: 8,
  bots: false,
  start(players) {
    const { state, key } = deal(players);
    return { state, private: Object.fromEntries(Object.values(state.spymasters).map((pid) => [pid, key])) };
  },
  status: (s) => (s.winner ? "over" : "playing"),
  turn(s) {
    if (s.winner) return null;
    if (s.pending || s.phase === "clue") return s.spymasters[s.turn];
    return s.teams[s.turn].find((p) => p !== s.spymasters[s.turn]) || null;
  },
  outcome,
  badge(s, pid) {
    const t = teamOf(s, pid);
    return el("span", { class: `cn-badge ${t}` }, isSpy(s, pid) ? "🕶️" : "🔎");
  },
  auto(s, pid, key) {
    if (s.pending && isSpy(s, pid) && key) {
      const n = reveal(s, key);
      return n && { state: n };
    }
    return null;
  },
  view({ state: s, me, priv: key, act, players }) {
    const team = teamOf(s, me);
    const spy = isSpy(s, me) && key;
    const showKey = spy || s.winner;
    const myGuess = !s.winner && s.phase === "guess" && !s.pending && team === s.turn && !isSpy(s, me);
    const name = (pid) => players[pid]?.name || "?";
    let banner = "";
    if (s.winner) banner = "";
    else if (s.phase === "clue") banner = s.spymasters[s.turn] === me ? "You're the spymaster: give a one-word clue and a number." : `Waiting for ${name(s.spymasters[s.turn])} to give a clue…`;
    else if (s.pending) banner = `${name(s.pending.by)} picked “${s.words[s.pending.i]}”…`;
    else banner = `Clue: “${s.clue.word}” for ${s.clue.count}. ${myGuess ? "Tap a card!" : `${COLORS[s.turn]} team is guessing.`} (${s.guessesLeft > 20 ? "any number" : s.guessesLeft} guesses left)`;

    const cards = s.words.map((w, i) => {
      const r = s.revealed[i];
      const hint = showKey && !r && key ? key[i] : null;
      return el("button", {
        type: "button",
        class: `cn-card${r ? " revealed " + r : ""}${hint ? " hint " + hint : ""}${s.pending?.i === i ? " pending" : ""}`,
        disabled: !myGuess || !!r,
        onclick: () => act((st) => { const n = guess(st, me, i); return n && { state: n }; }),
      }, el("span", {}, w));
    });

    const kids = [
      banner && el("div", { class: `cn-banner ${s.turn}` }, banner),
      el("div", { class: "cn-grid" }, cards),
    ];
    if (!s.winner && s.phase === "clue" && s.spymasters[s.turn] === me) {
      const word = el("input", { type: "text", placeholder: "One word", maxlength: 24, autocomplete: "off", autocapitalize: "off" });
      const count = el("select", {}, [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n) => el("option", { value: n }, n === 0 ? "0 (any)" : n)));
      kids.push(el("form", {
        class: "cn-clue", onsubmit: (e) => {
          e.preventDefault();
          const n = giveClue(s, me, word.value, Number(count.value));
          if (!n) { word.setCustomValidity("One word, letters only, and not a word on the board."); word.reportValidity(); return; }
          act((st) => { const m = giveClue(st, me, word.value, Number(count.value)); return m && { state: m }; });
        },
      }, word, count, el("button", { type: "submit", class: "primary" }, "Give clue")));
      word.addEventListener("input", () => word.setCustomValidity(""));
    }
    if (myGuess) kids.push(el("button", { type: "button", class: "ghost", onclick: () => act((st) => { const n = stopGuessing(st, me); return n && { state: n }; }) }, "✋ Stop guessing"));
    kids.push(el("div", { class: "cn-teams" }, Object.entries(s.teams).map(([t, ids]) => el("div", { class: `cn-team ${t}` },
      el("strong", {}, s.mode === "coop" ? `Team · ${s.cluesLeft} clues left` : `${COLORS[t]} · ${s.revealed.filter((c) => c === t).length} found`),
      el("ul", {}, ids.map((pid) => el("li", {}, `${pid === s.spymasters[t] ? "🕶️ " : ""}${name(pid)}${pid === me ? " (you)" : ""}`)))))));
    if (s.log.length) {
      kids.push(el("details", { class: "cn-log" }, el("summary", {}, "Clue history"),
        el("ol", {}, s.log.map((l) => el("li", {}, el("b", { class: l.team }, `${l.word} ${l.count}`), ": ",
          l.picks.map((p) => el("span", { class: "pick " + p.color }, p.word)))))));
    }
    return el("div", { class: "codenames" }, kids);
  },
};
