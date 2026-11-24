import { el, toast, sleep, shuffle } from "./js/dom.js";
import { api, watch, profile, playerName } from "./js/rooms.js";
import chess from "./js/games/chess.js";
import codenames from "./js/games/codenames.js";
import battleship from "./js/games/battleship.js";
import tictactoe from "./js/games/tictactoe.js";
import snakes from "./js/games/snakes.js";
import ludo from "./js/games/ludo.js";

const GAMES = [chess, codenames, battleship, tictactoe, snakes, ludo];
const GAME = Object.fromEntries(GAMES.map((g) => [g.id, g]));
const AVATARS = ["🦁", "🐯", "🐼", "🦊", "🐸", "🐵", "🦄", "🐙", "🐢", "🦖", "🐝", "🦉", "🐬", "🐧", "🐨", "🚀", "⚡", "🌟"];
const BOTS = ["🤖 Robo", "🤖 Chip", "🤖 Bolt", "🤖 Pixel", "🤖 Gizmo"];

const app = document.getElementById("app");
let cleanup = [];

function show(...nodes) {
  app.replaceChildren(...nodes.filter(Boolean));
}

function route() {
  for (const f of cleanup) f();
  cleanup = [];
  document.title = "Game Room";
  document.body.classList.remove("my-turn");
  if (!profile.get()) return profileView();
  const m = location.hash.match(/^#\/r\/([A-Za-z]{4})/);
  if (m) return roomView(m[1].toUpperCase());
  return lobby();
}
window.addEventListener("hashchange", route);

// ---------- who are you ----------

function profileView() {
  const p = profile.get() || { name: "", avatar: AVATARS[0] };
  let avatar = p.avatar;
  const name = el("input", { type: "text", required: true, maxlength: 16, value: p.name, placeholder: "Your name", autocomplete: "nickname" });
  const pick = el("div", { class: "avatars" }, AVATARS.map((a) => el("button", {
    type: "button", class: "avatar" + (a === avatar ? " on" : ""), "aria-pressed": String(a === avatar),
    onclick: (e) => {
      avatar = a;
      for (const b of pick.children) { b.classList.toggle("on", b === e.currentTarget); b.setAttribute("aria-pressed", String(b === e.currentTarget)); }
    },
  }, a)));
  show(el("form", {
    class: "card profile", onsubmit: (e) => {
      e.preventDefault();
      profile.set({ name: name.value.trim(), avatar });
      route();
    },
  },
  el("h2", {}, "Who's playing?"),
  el("p", { class: "muted" }, "Pick a name and an animal. This device remembers you."),
  name, pick,
  el("button", { type: "submit", class: "primary big" }, "Let's play!")));
  name.focus();
}

// ---------- lobby ----------

const STATUS = { waiting: "Waiting for players", playing: "Playing", over: "Game over" };

function lobby() {
  const rooms = el("div", { class: "rooms" }, el("p", { class: "muted" }, "Looking for games…"));
  const code = el("input", { type: "text", maxlength: 4, placeholder: "CODE", autocapitalize: "characters", autocomplete: "off", "aria-label": "Room code" });
  show(
    el("section", { class: "hello" },
      el("span", { class: "big-avatar" }, profile.get().avatar),
      el("div", {}, el("h2", {}, `Hi ${profile.get().name}!`), el("p", { class: "muted" }, "Start a game or jump into one below. Anyone on the home network can join.")),
      el("button", { type: "button", class: "ghost small", onclick: profileView }, "Change")),
    el("h3", { class: "section-title" }, "Start a game"),
    el("div", { class: "tiles" }, GAMES.map((g) => el("button", { type: "button", class: `tile t-${g.id}`, onclick: () => create(g) },
      el("span", { class: "tile-emoji" }, g.emoji),
      el("strong", {}, g.name),
      el("span", { class: "tile-blurb" }, g.blurb),
      el("span", { class: "tile-players" }, g.min === g.max ? `${g.min} players` : `${g.min}–${g.max} players`, g.bots ? " · 🤖 ok" : "")))),
    el("div", { class: "section-head" },
      el("h3", { class: "section-title" }, "Games in the house"),
      el("form", { class: "join-code", onsubmit: (e) => { e.preventDefault(); if (/^[a-z]{4}$/i.test(code.value)) location.hash = `#/r/${code.value.toUpperCase()}`; } },
        code, el("button", { type: "submit", class: "ghost small" }, "Join"))),
    rooms,
  );
  const refresh = async () => {
    try {
      const list = await api.list();
      if (!list.length) { rooms.replaceChildren(el("p", { class: "empty" }, "No games yet. Start one and tell everyone the code!")); return; }
      rooms.replaceChildren(...list.map((r) => {
        const g = GAME[r.game];
        if (!g) return null;
        const open = r.status === "waiting" && r.players.length < r.max;
        return el("a", { class: "room-row", href: `#/r/${r.id}` },
          el("span", { class: "room-emoji" }, g.emoji),
          el("div", { class: "grow" },
            el("strong", {}, `${g.name} `), el("code", {}, r.id),
            el("div", { class: "who" }, r.players.map((p) => el("span", { class: "who-chip" + (p.online ? "" : " away") }, p.name)))),
          el("span", { class: `pill ${r.status}` }, open ? "Join!" : STATUS[r.status] || r.status));
      }).filter(Boolean));
    } catch (e) {
      rooms.replaceChildren(el("p", { class: "notice" }, e.message));
    }
  };
  refresh();
  const t = setInterval(refresh, 4000);
  cleanup.push(() => clearInterval(t));
}

async function create(g) {
  try {
    const room = await api.create(g.id, g.max, g.name);
    location.hash = `#/r/${room.id}`;
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- a room ----------

function roomView(id) {
  let room = null;
  let game = null;
  let busy = false;
  let autoBusy = false;
  let lastTurn = null;
  const head = el("div", { class: "room-head" });
  const body = el("div", { class: "room-body" });
  show(head, body);

  const players = () => Object.fromEntries((room?.players || []).map((p) => [p.id, p]));
  const seated = () => room.players.some((p) => p.id === room.me);

  function renderHead() {
    const turn = room.state && game.turn(room.state);
    head.replaceChildren(
      el("div", { class: "room-title" },
        el("a", { href: "#/", class: "ghost small backlink" }, "← Games"),
        el("h2", {}, `${game.emoji} ${game.name}`),
        el("button", {
          type: "button", class: "code-chip", title: "Copy a link to this room",
          onclick: () => navigator.clipboard?.writeText(location.href).then(() => toast("Link copied: send it to whoever's joining")),
        }, "Room ", el("b", {}, room.id))),
      el("div", { class: "seats" }, room.players.map((p) => el("span", {
        class: "seat" + (p.id === turn ? " turn" : "") + (p.online ? "" : " away") + (p.id === room.me ? " me" : ""),
      },
      room.state && game.badge ? game.badge(room.state, p.id) : "",
      el("span", {}, p.name),
      p.id === room.host ? el("span", { title: "Host" }, " 👑") : "",
      room.me === room.host && !room.state && p.id !== room.me
        ? el("button", { type: "button", class: "x", "aria-label": `Remove ${p.name}`, onclick: () => api.leave(room.id, p.id).then(apply, (e) => toast(e.message, true)) }, "×")
        : ""))),
    );
  }

  function render() {
    renderHead();
    if (!room.state) return renderWaiting();
    const ctx = { state: room.state, me: room.me, priv: room.private?.[room.me], players: players(), room, act, rerender: render };
    const over = game.status(room.state) === "over";
    body.replaceChildren(...[
      over && el("div", { class: "outcome" }, el("span", {}, "🏆 " + game.outcome(room.state, players())),
        room.me === room.host && el("div", { class: "row-btns" },
          el("button", { type: "button", class: "primary", onclick: start }, "Play again"),
          el("button", { type: "button", class: "ghost", onclick: backToLobby }, "Change players"))),
      !seated() && el("p", { class: "notice" }, "You're watching this game."),
      game.view(ctx),
    ].filter(Boolean));
    const turn = game.turn(room.state);
    const mine = turn === room.me && !over;
    document.body.classList.toggle("my-turn", mine);
    document.title = (mine ? "● Your turn · " : "") + game.name;
    if (mine && lastTurn !== room.me) navigator.vibrate?.(60);
    lastTurn = turn;
  }

  function renderWaiting() {
    const n = room.players.length;
    const host = room.me === room.host;
    const ready = n >= game.min && n <= game.max;
    const humans = room.players.filter((p) => !p.bot).length;
    body.replaceChildren(el("div", { class: "card waiting" },
      el("p", { class: "big-code" }, "Room code ", el("b", {}, room.id)),
      el("p", { class: "muted" }, `Others open Game Room on their phone or tablet and tap this game (or type the code). ${game.name} needs ${game.min === game.max ? game.min : `${game.min} to ${game.max}`} players.`),
      !seated() && (n < room.max
        ? el("button", { type: "button", class: "primary big", onclick: () => api.join(room.id).then(apply, (e) => toast(e.message, true)) }, `Join as ${playerName()}`)
        : el("p", { class: "notice" }, "This room is full.")),
      el("div", { class: "row-btns" },
        host && game.bots && n < game.max && el("button", {
          type: "button", class: "ghost",
          onclick: () => api.join(room.id, BOTS.find((b) => !room.players.some((p) => p.name === b)) || "🤖 Robo").then(apply, (e) => toast(e.message, true)),
        }, "🤖 Add computer player"),
        host && el("button", { type: "button", class: "primary big", disabled: !ready || !humans, onclick: start }, ready ? "Start game!" : `Need ${game.min > n ? game.min - n + " more" : "fewer players"}`)),
      !host && seated() && el("p", { class: "muted" }, "Waiting for the host to start…"),
      seated() && el("button", {
        type: "button", class: "ghost small",
        onclick: () => api.leave(room.id, room.me).then(() => { location.hash = "#/"; }, (e) => toast(e.message, true)),
      }, "Leave room"),
    ));
  }

  async function start() {
    const list = game.id === "codenames" ? room.players : shuffle(room.players);
    const { state, private: priv } = game.start(list);
    try {
      apply(await api.put(room.id, room.version, { state, private: priv || {}, status: game.status(state) }));
    } catch (e) {
      if (e.status === 409) apply(e.body);
      else toast(e.message, true);
    }
  }

  async function backToLobby() {
    try { apply(await api.put(room.id, room.version, { state: null, status: "waiting" })); } catch (e) { toast(e.message, true); }
  }

  // act runs a move against the latest state and sends it; if someone else
  // moved first the server says so and we show their move instead.
  async function act(fn) {
    if (busy || !room?.state) return false;
    const res = fn(structuredClone(room.state));
    if (!res) return false;
    busy = true;
    try {
      apply(await api.put(room.id, room.version, { state: res.state, private: res.private || {}, status: game.status(res.state) }));
      return true;
    } catch (e) {
      if (e.status === 409) { toast("Someone moved first. Have another look!"); apply(e.body); } else toast(e.message, true);
      return false;
    } finally {
      busy = false;
    }
  }

  // Automatic moves: your device answers for you (a Battleship shot, a
  // Codenames reveal), and the host's device plays the computer players.
  async function autos() {
    if (autoBusy || !room?.state || game.status(room.state) === "over" && !game.auto) return;
    const r = room;
    let upd = null, isBot = false;
    if (seated() && game.auto) upd = game.auto(r.state, r.me, r.private?.[r.me]);
    if (!upd && r.me === r.host) {
      for (const b of r.players.filter((p) => p.bot)) {
        const priv = r.private?.[b.id];
        upd = (game.auto && game.auto(r.state, b.id, priv)) || (game.turn(r.state) === b.id && game.bot ? game.bot(r.state, b.id, priv) : null);
        if (upd) { isBot = true; break; }
      }
    }
    if (!upd) return;
    autoBusy = true;
    try {
      await sleep(isBot ? 800 : 200);
      if (room.version !== r.version) return;
      apply(await api.put(r.id, r.version, { state: upd.state, private: upd.private || {}, status: game.status(upd.state) }));
    } catch (e) {
      if (e.status === 409) apply(e.body);
    } finally {
      autoBusy = false;
      setTimeout(autos, 0);
    }
  }

  function apply(next) {
    if (!next || (room && next.version < room.version)) return;
    const same = room && next.version === room.version;
    room = next;
    game = GAME[room.game];
    if (!game) { body.replaceChildren(el("p", { class: "notice" }, `Unknown game ${room.game}.`)); return; }
    if (same) { renderHead(); return; }
    render();
    autos();
  }

  const stop = watch(id, apply, () => {
    toast("That room has closed.");
    location.hash = "#/";
  });
  cleanup.push(stop);
}

route();
