// An in-page song player built on YouTube's IFrame Player API. The API script
// loads only on the first tap, so nothing is fetched from YouTube until then.
// YouTube's terms require the video itself to stay visible (at least 200px),
// so the player is a real video in the Listen card, not hidden audio.

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

export function createPlayer({ mount, onChange }) {
  let yt = null;
  let queue = [];
  let index = -1;
  let playing = false;
  let failed = 0;
  let lock = null;

  const emit = () => onChange({ song: queue[index] || null, index, queue, playing });

  // A locked phone suspends the page and the music with it, so keep the
  // screen awake while a song plays.
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
  document.addEventListener("visibilitychange", () => { if (playing) keepAwake(true); });

  function onState(e) {
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
    failed++;
    if (failed < queue.length && index < queue.length - 1) return go(index + 1);
    playing = false;
    emit();
  }

  async function go(i) {
    index = i;
    emit();
    await loadAPI();
    const id = queue[index].id;
    if (yt) { yt.loadVideoById(id); return; }
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

  return {
    play(list, i) {
      queue = list.slice();
      failed = 0;
      return go(i);
    },
    toggle() {
      if (!yt) return;
      if (playing) yt.pauseVideo(); else yt.playVideo();
    },
    next() { if (index < queue.length - 1) go(index + 1); },
    prev() {
      if (yt && yt.getCurrentTime?.() > 5) return yt.seekTo(0, true);
      if (index > 0) go(index - 1);
    },
    get state() { return { song: queue[index] || null, index, queue, playing }; },
  };
}
