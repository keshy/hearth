// A day's panchangam for a place, in the device's own time zone. A "day"
// runs from local sunrise to the next sunrise, as in Tamil panchangams.
import {
  RATE, crossings, elongation, jdOf, moonSidereal, nextReach, prevReach, sunSidereal,
} from "./astro.js";

const DAY_MS = 86400000;
const NAK = 360 / 27;

export const TITHIS = [
  "Prathamai", "Dvitiyai", "Tritiyai", "Chathurthi", "Panchami", "Shashti", "Saptami",
  "Ashtami", "Navami", "Dasami", "Ekadasi", "Dvadasi", "Trayodasi", "Chathurdasi",
];
export const tithiName = (n) => (n === 15 ? "Pournami" : n === 30 ? "Amavasai" : TITHIS[(n - 1) % 15]);
export const pakshaOf = (n) => (n <= 15 ? "Shukla" : "Krishna");

export const NAKSHATRAS = [
  ["Ashwini", "அஸ்வினி"], ["Bharani", "பரணி"], ["Karthigai", "கார்த்திகை"], ["Rohini", "ரோகிணி"],
  ["Mirugaseeridam", "மிருகசீரிடம்"], ["Thiruvathirai", "திருவாதிரை"], ["Punarpoosam", "புனர்பூசம்"],
  ["Poosam", "பூசம்"], ["Ayilyam", "ஆயில்யம்"], ["Magam", "மகம்"], ["Pooram", "பூரம்"],
  ["Uthiram", "உத்திரம்"], ["Hastham", "அஸ்தம்"], ["Chithirai", "சித்திரை"], ["Swathi", "சுவாதி"],
  ["Visakam", "விசாகம்"], ["Anusham", "அனுஷம்"], ["Kettai", "கேட்டை"], ["Moolam", "மூலம்"],
  ["Pooradam", "பூராடம்"], ["Uthiradam", "உத்திராடம்"], ["Thiruvonam", "திருவோணம்"],
  ["Avittam", "அவிட்டம்"], ["Sadhayam", "சதயம்"], ["Poorattathi", "பூரட்டாதி"],
  ["Uthirattathi", "உத்திரட்டாதி"], ["Revathi", "ரேவதி"],
];

export const TAMIL_MONTHS = [
  ["Chithirai", "சித்திரை"], ["Vaikasi", "வைகாசி"], ["Aani", "ஆனி"], ["Aadi", "ஆடி"],
  ["Avani", "ஆவணி"], ["Purattasi", "புரட்டாசி"], ["Aippasi", "ஐப்பசி"], ["Karthigai", "கார்த்திகை"],
  ["Margazhi", "மார்கழி"], ["Thai", "தை"], ["Maasi", "மாசி"], ["Panguni", "பங்குனி"],
];

export const LUNAR_MONTHS = [
  "Chaitra", "Vaishakha", "Jyeshtha", "Ashadha", "Shravana", "Bhadrapada",
  "Ashvina", "Kartika", "Margashirsha", "Pausha", "Magha", "Phalguna",
];

const YEARS = [
  "Prabhava", "Vibhava", "Shukla", "Pramodhootha", "Prajorpathi", "Aangirasa", "Srimukha", "Bhava",
  "Yuva", "Dhaathu", "Eswara", "Vegudhanya", "Pramathi", "Vikrama", "Vishu", "Chitrabhanu",
  "Subhanu", "Dhaarana", "Paarthiba", "Viya", "Sarvajith", "Sarvadhari", "Virodhi", "Vikruthi",
  "Kara", "Nandhana", "Vijaya", "Jaya", "Manmatha", "Dhunmuki", "Hevilambi", "Vilambi",
  "Vikari", "Sarvari", "Plava", "Subakiruthu", "Sobakiruthu", "Krodhi", "Visuvaavasu", "Parabhava",
  "Plavanga", "Keelaka", "Saumya", "Sadharana", "Virodhikiruthu", "Paridhaabi", "Pramaadhisa",
  "Aanandha", "Rakshasa", "Nala", "Pingala", "Kalayukthi", "Siddharthi", "Raudhri", "Dunmathi",
  "Dhundhubhi", "Rudhrodhgaari", "Raktakshi", "Krodhana", "Akshaya",
];

// Eighths of daylight, Sunday first.
const RAHU = [8, 2, 7, 5, 6, 4, 3];
const YAMA = [5, 4, 3, 2, 1, 7, 6];
const KULIGAI = [7, 6, 5, 4, 3, 2, 1];

export const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseKey = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (key, n) => {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
};
// Whole calendar days between keys, immune to DST.
export const daysBetween = (a, b) => {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY_MS);
};

export const tithiAt = (ms) => Math.floor(elongation(jdOf(ms)) / 12) + 1;
export const nakshatraAt = (ms) => Math.floor(moonSidereal(jdOf(ms)) / NAK) + 1;

function sunTimes(key, place) {
  const start = parseKey(key).getTime();
  const evs = crossings("sun", place, start, start + DAY_MS + 3600000);
  const rise = evs.find((e) => e.rising);
  const set = evs.find((e) => !e.rising && (!rise || e.ms > rise.ms));
  // Polar day/night: fall back to 6:00 and 18:00 so the rest still works.
  return { sunrise: rise ? rise.ms : start + 6 * 3600000, sunset: set ? set.ms : start + 18 * 3600000 };
}

const cache = new Map();
function cached(kind, key, place, fn) {
  const k = `${kind}|${key}|${place.lat.toFixed(3)},${place.lon.toFixed(3)}`;
  if (!cache.has(k)) cache.set(k, fn());
  return cache.get(k);
}
export const sun = (key, place) => cached("sun", key, place, () => sunTimes(key, place));

// Each thithi (or nakshatram) overlapping [fromMs, toMs), with start and end.
function spans(at, fn, count, rate, fromMs, toMs) {
  const width = 360 / count;
  const out = [];
  let n = at(fromMs);
  let start = prevReach(fn, ((n - 1) * width) % 360, fromMs, rate);
  for (let i = 0; i < 2000; i++) {
    const end = nextReach(fn, (n * width) % 360, start + 60000, rate);
    out.push({ n, start, end });
    if (end >= toMs) break;
    start = end;
    n = (n % count) + 1;
  }
  return out;
}
export const tithiSpans = (from, to) => spans(tithiAt, elongation, 30, RATE.elongation, from, to);
export const nakshatraSpans = (from, to) => spans(nakshatraAt, moonSidereal, 27, RATE.moon, from, to);

// Tamil solar month and date: the month whose sankranti falls before sunset
// starts that day; otherwise it starts the next day.
function solarDate(key, place) {
  const { sunset } = sun(key, place);
  const sign = Math.floor(sunSidereal(jdOf(sunset)) / 30);
  const sankranti = prevReach(sunSidereal, sign * 30, sunset, RATE.sun);
  let first = dayKey(new Date(sankranti));
  if (sankranti > sun(first, place).sunset) first = addDays(first, 1);
  const day = daysBetween(first, key) + 1;
  const gy = parseKey(key).getFullYear();
  const startYear = parseKey(key).getMonth() < 4 && sign >= 8 ? gy - 1 : gy;
  return { month: sign, day, year: YEARS[(((startYear - 2024 + 37) % 60) + 60) % 60], sankranti };
}
export const solar = (key, place) => cached("solar", key, place, () => solarDate(key, place));

// Amanta lunar month at an instant: named for the sign the Sun is in at the
// new moon that starts it; adhika if no sankranti happens before the next.
export function lunarMonth(ms) {
  const prev = prevReach(elongation, 0, ms, RATE.elongation);
  const next = nextReach(elongation, 0, ms, RATE.elongation);
  const a = Math.floor(sunSidereal(jdOf(prev)) / 30);
  const b = Math.floor(sunSidereal(jdOf(next)) / 30);
  return { month: (a + 1) % 12, adhika: a === b, newMoon: prev };
}

export function moonrise(key, place) {
  return cached("moonrise", key, place, () => {
    const { sunset } = sun(key, place);
    const ev = crossings("moon", place, sunset - 3600000, sunset + 20 * 3600000).find((e) => e.rising);
    return ev ? ev.ms : null;
  });
}

// Everything the page shows about one day.
export function panchang(key, place) {
  return cached("day", key, place, () => {
    const { sunrise, sunset } = sun(key, place);
    const nextSunrise = sun(addDays(key, 1), place).sunrise;
    const weekday = parseKey(key).getDay();
    const len = sunset - sunrise;
    const part = (i) => ({ start: sunrise + ((i - 1) * len) / 8, end: sunrise + (i * len) / 8 });
    const muhurta = len / 15;
    const elong = elongation(jdOf(Date.now() >= sunrise && Date.now() < nextSunrise ? Date.now() : sunrise));
    return {
      key, weekday, sunrise, sunset, nextSunrise,
      tithis: tithiSpans(sunrise, nextSunrise),
      nakshatras: nakshatraSpans(sunrise, nextSunrise),
      solar: solar(key, place),
      lunar: lunarMonth(sunrise),
      times: {
        brahma: { start: sunrise - 96 * 60000, end: sunrise - 48 * 60000 },
        rahu: part(RAHU[weekday]),
        yama: part(YAMA[weekday]),
        kuligai: part(KULIGAI[weekday]),
        abhijit: weekday === 3 ? null : { start: sunrise + 7 * muhurta, end: sunrise + 8 * muhurta },
      },
      moon: { illumination: (1 - Math.cos((elong * Math.PI) / 180)) / 2, waxing: elong < 180, elongation: elong },
    };
  });
}
