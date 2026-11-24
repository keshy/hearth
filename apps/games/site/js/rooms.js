// Talks to the platform's rooms API (/_api/rooms). A player is a random
// token this browser keeps, plus a name and an avatar.

const TOKEN = "games.player";
const PROFILE = "games.profile";

function token() {
  let t = localStorage.getItem(TOKEN);
  if (!t) {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    t = [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(TOKEN, t);
  }
  return t;
}

export const profile = {
  get() {
    try { return JSON.parse(localStorage.getItem(PROFILE)) || null; } catch { return null; }
  },
  set(p) { localStorage.setItem(PROFILE, JSON.stringify(p)); },
};

// Player names carry the avatar so everyone sees it: "🦁 Adi".
export function playerName() {
  const p = profile.get();
  return p ? `${p.avatar} ${p.name}` : "";
}

export class RoomError extends Error {
  constructor(status, body) {
    super(body?.error || `request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "X-Player": token(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new RoomError(res.status, data);
  return data;
}

export const api = {
  list: () => call("GET", "/_api/rooms").then((d) => d.rooms),
  create: (game, max, title) => call("POST", "/_api/rooms", { game, max, title, name: playerName() }),
  get: (id, since = 0, signal) => fetch(`/_api/rooms/${id}?since=${since}`, { headers: { "X-Player": token() }, cache: "no-store", signal })
    .then(async (r) => { const d = await r.json().catch(() => null); if (!r.ok) throw new RoomError(r.status, d); return d; }),
  join: (id, bot) => call("POST", `/_api/rooms/${id}/players`, bot ? { name: bot, bot: true } : { name: playerName() }),
  leave: (id, pid) => call("DELETE", `/_api/rooms/${id}/players/${pid}`),
  put: (id, version, change) => call("PUT", `/_api/rooms/${id}`, { version, ...change }),
  close: (id) => call("DELETE", `/_api/rooms/${id}`),
};

// watch keeps a room fresh: each answer comes back as soon as anything
// changes (or every 25 seconds anyway, which also keeps you "online").
export function watch(id, onRoom, onGone) {
  let stopped = false;
  const ctl = new AbortController();
  (async () => {
    let since = 0;
    while (!stopped) {
      try {
        const room = await api.get(id, since, ctl.signal);
        if (stopped) return;
        since = room.version;
        onRoom(room);
      } catch (e) {
        if (stopped) return;
        if (e.status === 404) { onGone(); return; }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  })();
  return () => { stopped = true; ctl.abort(); };
}
