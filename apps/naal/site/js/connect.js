// Hearth Connect: play songs on the speakers and TVs at home. The home server
// finds them and plays the music itself, so it keeps going when this phone
// locks or leaves. This side just picks the device and works the controls.

const API = "/_api/connect/devices";

async function call(path = "", body) {
  const r = await fetch(API + path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status });
  return data;
}

// Lists devices. Resolves null when this home has no Connect (the app is
// opened somewhere else, or the host can't do it).
export async function listDevices(fresh = false) {
  try {
    return await call(fresh ? "?fresh=1" : "");
  } catch (e) {
    if (e.status === 403 || e.status === 404 || e.status === 503 || e instanceof SyntaxError || e instanceof TypeError) return null;
    throw e;
  }
}

const enc = encodeURIComponent;
const idle = { state: "idle", queue: [], index: -1, position: 0, duration: 0, volume: -1 };

// createRemote drives one device with the same shape as the in-page player.
export function createRemote({ device, onChange }) {
  let st = { ...idle };
  let at = Date.now(); // when st arrived, to move the progress bar between polls
  let timer = 0;
  let pending = false; // a command is in flight; don't let a poll undo it
  let stopped = false;

  const playing = () => ["playing", "buffering", "loading"].includes(st.state);
  const position = () => {
    const p = st.position + (st.state === "playing" ? (Date.now() - at) / 1000 : 0);
    return st.duration ? Math.min(p, st.duration) : p;
  };
  const view = () => ({
    song: st.song || null, index: st.song ? st.index : -1, queue: st.queue || [], playing: playing(),
    state: st.state, position: position(), duration: st.duration, volume: st.volume, error: st.error || "", device,
  });
  const emit = () => onChange(view());

  async function poll() {
    clearTimeout(timer);
    if (stopped) return;
    if (!pending) {
      try { st = { ...idle, ...(await call(`/${enc(device.id)}`)) }; at = Date.now(); emit(); } catch { /* try again shortly */ }
    }
    const busy = playing() || st.state === "paused";
    timer = setTimeout(poll, document.hidden ? 15000 : busy ? 2000 : 8000);
  }

  async function send(action, body) {
    pending = true;
    try {
      st = { ...idle, ...(await call(`/${enc(device.id)}/${action}`, body ?? {})) };
      at = Date.now();
    } catch (e) {
      st = { ...st, state: st.state === "loading" ? "error" : st.state, error: e.message };
    } finally {
      pending = false;
    }
    emit();
    poll();
  }

  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  poll();

  return {
    device,
    play(list, i) {
      st = { ...st, state: "loading", queue: list, index: i, song: list[i], position: 0, duration: 0, error: "" };
      emit();
      return send("play", { queue: list.map(({ id, title, by }) => ({ id, title, by })), index: i });
    },
    toggle() {
      if (st.state === "idle" || st.state === "error") return st.queue?.length ? send("resume") : undefined;
      st = { ...st, state: playing() ? "paused" : "playing" };
      emit();
      return send(st.state === "paused" ? "pause" : "resume");
    },
    next() { return send("next"); },
    prev() { return send("prev"); },
    stop() { return send("stop"); },
    volume(level) { st = { ...st, volume: level }; return send("volume", { level }); },
    close() { stopped = true; clearTimeout(timer); },
    get state() { return view(); },
  };
}
