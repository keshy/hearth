// Saved people. Profiles live in the home server's app data
// (<data>/appdata/astroscience/profiles.json on the Mac), never in the repo,
// and are shared by every device in the house.
export const MAX_PROFILES = 20;
const KEY = "profiles";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// Famous charts to learn from. Birth-time examples use published birth data;
// traditional ones are the placements the texts give, since no date can be
// computed for them.
export const EXAMPLES = [
  {
    id: "rama",
    name: "Sri Rama",
    kind: "traditional",
    blurb: "Cancer rising with Jupiter and the Moon, five planets exalted.",
    source: "Valmiki Ramayana, Bala Kanda 18: born on Chaitra shukla navami in Punarvasu, Karkata lagna with Guru and Chandra, five grahas exalted. Mercury and the nodes follow the common later tradition.",
    lagna: 95, // Cancer 5°
    planets: { sun: 10, moon: 91.5, mars: 298, mercury: 33, jupiter: 95, venus: 357, saturn: 200, rahu: 255 },
  },
  {
    id: "krishna",
    name: "Sri Krishna",
    kind: "traditional",
    blurb: "Taurus rising with the Moon exalted in Rohini.",
    source: "Born at midnight on Krishna ashtami in Avani (Bhadrapada) in Rohini, Rishabha lagna with the Moon exalted. This is one widely circulated version; sources disagree on Jupiter and the nodes.",
    lagna: 45, // Taurus 15°
    planets: { sun: 140, moon: 48, mars: 298, mercury: 160, jupiter: 345, venus: 190, saturn: 200, rahu: 135 },
  },
  {
    id: "modi",
    name: "Narendra Modi",
    kind: "birth",
    blurb: "17 Sep 1950, 11:00 AM, Vadnagar.",
    source: "Birth data as widely published: 17 September 1950, 11:00 AM IST, Vadnagar, Gujarat.",
    d: "1950-09-17", t: "11:00",
    place: { name: "Vadnagar", lat: 23.785, lon: 72.64, tz: "Asia/Kolkata" },
  },
  {
    id: "vivekananda",
    name: "Swami Vivekananda",
    kind: "birth",
    blurb: "12 Jan 1863, 6:33 AM, Kolkata.",
    source: "Birth data as recorded by his biographers: 12 January 1863, 6:33 AM local time, Kolkata.",
    d: "1863-01-12", t: "06:33",
    place: { name: "Kolkata", lat: 22.57, lon: 88.36, tz: "Asia/Kolkata" },
  },
];

export const exampleById = (id) => EXAMPLES.find((e) => e.id === id) || null;

const clip = (s, n) => String(s ?? "").trim().slice(0, n);

// Cleans one profile; returns null if it isn't usable.
export function cleanProfile(p) {
  if (!p || typeof p !== "object") return null;
  const name = clip(p.name, 40);
  if (!name || !DATE_RE.test(p.d) || !TIME_RE.test(p.t)) return null;
  let place;
  if (typeof p.place === "string") place = clip(p.place, 60);
  else if (p.place && Number.isFinite(+p.place.lat) && Number.isFinite(+p.place.lon) && Math.abs(+p.place.lat) <= 66 && Math.abs(+p.place.lon) <= 180) {
    place = { name: clip(p.place.name, 60) || `${(+p.place.lat).toFixed(2)}°, ${(+p.place.lon).toFixed(2)}°`, lat: +p.place.lat, lon: +p.place.lon, tz: clip(p.place.tz, 60) || "UTC" };
  } else return null;
  return {
    id: /^[a-z0-9]{6,16}$/.test(p.id) ? p.id : newId(),
    name, d: p.d, t: p.t, place,
    note: clip(p.note, 200) || undefined,
    saved: Number.isFinite(p.saved) ? p.saved : Date.now(),
  };
}

export function cleanList(list) {
  const out = [];
  const seen = new Set();
  for (const p of Array.isArray(list) ? list : []) {
    const c = cleanProfile(p);
    if (c && !seen.has(c.id) && out.length < MAX_PROFILES) { seen.add(c.id); out.push(c); }
  }
  return out;
}

export function newId() {
  const b = new Uint8Array(5);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(36).padStart(2, "0")).join("").slice(0, 8);
}

// Returns the new list, or throws with a message for the person.
export function upsert(list, profile) {
  const c = cleanProfile(profile);
  if (!c) throw new Error("A profile needs a name, a date, a time and a place.");
  const i = list.findIndex((p) => p.id === c.id);
  if (i >= 0) return list.map((p, k) => (k === i ? { ...c, saved: Date.now() } : p));
  if (list.length >= MAX_PROFILES) throw new Error(`You can keep up to ${MAX_PROFILES} profiles. Delete one first.`);
  return [...list, { ...c, saved: Date.now() }];
}

export const removeProfile = (list, id) => list.filter((p) => p.id !== id);

export const sameBirth = (a, b) => !!a && !!b && a.d === b.d && a.t === b.t && a.name === b.name &&
  JSON.stringify(a.place) === JSON.stringify(b.place);

// ---------- storage on the home server ----------
export async function loadProfiles() {
  const res = await fetch(`/_api/data/${KEY}`, { cache: "no-store" });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`profiles: HTTP ${res.status}`);
  const body = await res.json();
  return cleanList(body?.profiles);
}

// Reads the latest list first so two devices don't overwrite each other's
// additions, then applies change and saves.
export async function changeProfiles(change) {
  const latest = await loadProfiles();
  const next = cleanList(change(latest));
  const res = await fetch(`/_api/data/${KEY}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v: 1, profiles: next }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `couldn't save (HTTP ${res.status})`);
  }
  return next;
}
