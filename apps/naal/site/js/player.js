// The in-page song player. Songs play as plain audio relayed by the home
// server (/_api/connect/audio), because phones keep an <audio> element going
// with the screen locked or another app in front, over Bluetooth too, and
// show it on the lock screen. Embedded YouTube videos stop the moment the
// page is hidden. If the server can't get a song, that song falls back to
// YouTube's IFrame player, whose terms want the video visible (200px+).

const API = "https://www.youtube.com/iframe_api";
const ENDED = 0, PLAYING = 1, PAUSED = 2;

let apiReady = null;
function loadAPI() {
  if (!apiReady) {
    apiReady = new Promise((resolve, reject) => {
      if (window.YT?.Player) return resolve();
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
      const s = document.createElement("script");
      s.src = API;
      s.onerror = () => { apiReady = null; reject(new Error("YouTube didn't load")); };
      document.head.append(s);
    });
  }
  return apiReady;
}

export const musicURL = (id) => `https://music.youtube.com/watch?v=${id}`;
// YouTube turns a list of ids into a temporary playlist, which its app can cast.
export const queueURL = (ids) => `https://www.youtube.com/watch_videos?video_ids=${ids.join(",")}`;
export const artURL = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const audioURL = (id) => `/_api/connect/audio/${id}`;

export function createPlayer({ mount, onChange }) {
  const audio = new Audio();
  audio.preload = "auto";
  let yt = null;
  let mode = "audio"; // or "video" for a song the server couldn't get
  let queue = [];
  let index = -1;
  let playing = false;
  let failed = 0;
  let lock = null;

  const song = () => queue[index] || null;
  const emit = () => {
    if (navigator.mediaSession) navigator.mediaSession.playbackState = song() ? (playing ? "playing" : "paused") : "none";
    onChange({ song: song(), index, queue, playing });
  };

  // ---- the picture where the video used to be ----
  const art = document.createElement("img");
  art.className = "player-art";
  art.alt = "";
  const bar = document.createElement("div");
  bar.className = "player-progress";
  const fill = document.createElement("span");
  bar.append(fill);
  const showArt = (s) => {
    art.src = artURL(s.id);
    fill.style.width = "0";
    mount.replaceChildren(art, bar);
  };
  audio.addEventListener("timeupdate", () => {
    if (audio.duration) fill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
    if (navigator.mediaSession?.setPositionState && audio.duration && isFinite(audio.duration)) {
      try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: audio.playbackRate }); } catch { /* not supported */ }
    }
  });

  // ---- lock screen, headphones and car controls ----
  const ms = navigator.mediaSession;
  if (ms) {
    const on = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* unsupported action */ } };
    on("play", () => resume());
    on("pause", () => pause());
    on("nexttrack", () => next());
    on("previoustrack", () => prev());
    on("seekto", (d) => { if (mode === "audio" && d.seekTime != null) audio.currentTime = d.seekTime; });
    on("seekbackward", (d) => { if (mode === "audio") audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10)); });
    on("seekforward", (d) => { if (mode === "audio") audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (d.seekOffset || 10)); });
  }
  const setMetadata = (s) => {
    if (!ms || !window.MediaMetadata) return;
    ms.metadata = new MediaMetadata({ title: s.title, artist: s.by, album: "Naal", artwork: [{ src: artURL(s.id), sizes: "480x360", type: "image/jpeg" }] });
  };

  // ---- audio ----
  audio.addEventListener("playing", () => { playing = true; failed = 0; emit(); });
  audio.addEventListener("pause", () => { if (!audio.ended) { playing = false; emit(); } });
  audio.addEventListener("ended", () => {
    playing = false;
    if (index < queue.length - 1) return go(index + 1);
    emit();
  });
  audio.addEventListener("error", () => {
    if (mode !== "audio" || !audio.getAttribute("src")) return;
    playVideo(); // the server couldn't get this one; try YouTube's player
  });

  // ---- YouTube fallback ----
  // A locked phone suspends the page and an embedded video with it, so keep
  // the screen awake while one plays.
  async function keepAwake(on) {
    try {
      if (on && !lock && navigator.wakeLock && document.visibilityState === "visible") {
        lock = await navigator.wakeLock.request("screen");
        lock.addEventListener("release", () => { lock = null; });
      } else if (!on && lock) {
        await lock.release();
      }
    } catch { lock = null; }
  }
  document.addEventListener("visibilitychange", () => { if (playing && mode === "video") keepAwake(true); });

  function onState(e) {
    if (mode !== "video") return;
    if (e.data === PLAYING) { playing = true; failed = 0; keepAwake(true); }
    else if (e.data === PAUSED) { playing = false; keepAwake(false); }
    else if (e.data === ENDED) {
      playing = false;
      if (index < queue.length - 1) return go(index + 1);
      keepAwake(false);
    }
    emit();
  }

  // Embedding can be switched off for a video after we checked it; skip it.
  function onError() {
    if (mode !== "video") return;
    failed++;
    if (failed < queue.length && index < queue.length - 1) return go(index + 1);
    playing = false;
    emit();
  }

  async function playVideo() {
    mode = "video";
    audio.removeAttribute("src");
    audio.load();
    await loadAPI();
    const id = song().id;
    yt = null;
    // YouTube refuses to play embeds that arrive without a referrer.
    const frame = document.createElement("iframe");
    const q = new URLSearchParams({ enablejsapi: 1, autoplay: 1, playsinline: 1, rel: 0, origin: location.origin });
    frame.src = `https://www.youtube-nocookie.com/embed/${id}?${q}`;
    frame.title = "Song player";
    frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    mount.replaceChildren(frame);
    await new Promise((ready) => {
      yt = new YT.Player(frame, {
        events: { onReady: (e) => { e.target.playVideo(); ready(); }, onStateChange: onState, onError },
      });
    });
  }

  // ---- queue ----
  function go(i) {
    index = i;
    const s = song();
    if (mode === "video") { keepAwake(false); yt = null; }
    mode = "audio";
    showArt(s);
    setMetadata(s);
    emit();
    audio.src = audioURL(s.id);
    audio.play().catch((e) => {
      // A browser that won't start audio without a tap leaves it paused.
      if (e.name === "NotAllowedError") { playing = false; emit(); }
    });
  }

  function pause() {
    if (mode === "video") yt?.pauseVideo(); else audio.pause();
  }
  function resume() {
    if (mode === "video") yt?.playVideo(); else audio.play().catch(() => {});
  }
  function next() { if (index < queue.length - 1) go(index + 1); }
  function prev() {
    const t = mode === "video" ? yt?.getCurrentTime?.() : audio.currentTime;
    if (t > 5) {
      if (mode === "video") yt.seekTo(0, true); else audio.currentTime = 0;
      return;
    }
    if (index > 0) go(index - 1);
  }

  return {
    play(list, i) {
      queue = list.slice();
      failed = 0;
      return go(i);
    },
    toggle() {
      if (!song()) return;
      if (playing) pause(); else resume();
    },
    next,
    prev,
    get state() { return { song: song(), index, queue, playing }; },
  };
}
