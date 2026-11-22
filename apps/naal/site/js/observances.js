// Which vratams and festivals fall on which days. Each rule says what makes
// the day (a thithi, a nakshatram, a Tamil date, a weekday in a Tamil month)
// and the moment of the day it has to hold at, following common Tamil
// practice: Ekadasi at sunrise, Pradosham at sunset, Sivaratri at midnight,
// Sankatahara Chathurthi at moonrise, and so on.
import {
  addDays, dayKey, daysBetween, lunarMonth, moonrise, nakshatraSpans, parseKey, solar, sun, tithiSpans,
} from "./panchang.js";

const MIN = 60000;

const REF = {
  sunrise: (k, p) => sun(k, p).sunrise,
  sunset: (k, p) => sun(k, p).sunset,
  madhyahna: (k, p) => { const s = sun(k, p); return s.sunrise + 0.5 * (s.sunset - s.sunrise); },
  aparahna: (k, p) => { const s = sun(k, p); return s.sunrise + 0.7 * (s.sunset - s.sunrise); },
  nishita: (k, p) => (sun(k, p).sunset + sun(addDays(k, 1), p).sunrise) / 2,
  arunodaya: (k, p) => sun(k, p).sunrise - 96 * MIN,
  moonrise: (k, p) => moonrise(k, p) ?? sun(k, p).sunset + 3 * 3600000,
};

// Lunar months: 0 Chaitra ... 11 Phalguna. Tamil months: 0 Chithirai ... 11 Panguni.
const RULES = [
  { id: "ekadasi", tithi: [11, 26], ref: "sunrise" },
  { id: "pradosham", tithi: [13, 28], ref: "sunset" },
  { id: "amavasai", tithi: [30], ref: "aparahna" },
  { id: "pournami", tithi: [15], ref: "sunset" },
  { id: "sankatahara", tithi: [19], ref: "moonrise" },
  { id: "sashti", tithi: [6], ref: "sunrise" },
  { id: "masa_sivaratri", tithi: [29], ref: "nishita" },
  { id: "krithigai", nak: 3, ref: "sunrise" },
  { id: "thiruvonam", nak: 22, ref: "sunrise" },

  { id: "rama_navami", tithi: [9], ref: "madhyahna", lunar: 0 },
  { id: "akshaya_tritiya", tithi: [3], ref: "sunrise", lunar: 1 },
  { id: "shankara_jayanthi", tithi: [5], ref: "sunrise", lunar: 1 },
  { id: "narasimha_jayanthi", tithi: [14], ref: "sunset", lunar: 1 },
  { id: "avani_avittam", tithi: [15], ref: "aparahna", lunar: 4 },
  { id: "krishna_jayanthi", tithi: [23], ref: "nishita", lunar: 4 },
  { id: "vinayaka_chaturthi", tithi: [4], ref: "madhyahna", lunar: 5 },
  { id: "mahalaya_amavasai", tithi: [30], ref: "aparahna", lunar: 5 },
  { id: "navaratri_start", tithi: [1], ref: "sunrise", lunar: 6 },
  { id: "saraswati_pooja", tithi: [9], ref: "sunrise", lunar: 6 },
  { id: "vijayadasami", tithi: [10], ref: "sunrise", lunar: 6 },
  { id: "deepavali", tithi: [29], ref: "arunodaya", lunar: 6 },
  { id: "kanda_sashti", tithi: [6], ref: "sunrise", lunar: 7 },
  { id: "ratha_saptami", tithi: [7], ref: "sunrise", lunar: 10 },
  { id: "maha_shivaratri", tithi: [29], ref: "nishita", lunar: 10 },

  { id: "chitra_pournami", tithi: [15], ref: "sunset", solarMonth: 0 },
  { id: "aadi_amavasai", tithi: [30], ref: "aparahna", solarMonth: 3 },
  { id: "vaikunta_ekadasi", tithi: [11], ref: "sunrise", solarMonth: 8 },
  { id: "hanumath_jayanthi", tithi: [30], ref: "sunrise", solarMonth: 8 },
  { id: "thai_amavasai", tithi: [30], ref: "aparahna", solarMonth: 9 },

  { id: "vaikasi_visakam", nak: 16, ref: "sunrise", solarMonth: 1 },
  { id: "aadi_pooram", nak: 11, ref: "sunrise", solarMonth: 3 },
  { id: "karthigai_deepam", nak: 3, ref: "sunset", solarMonth: 7 },
  { id: "arudra_darisanam", nak: 6, ref: "sunrise", solarMonth: 8 },
  { id: "thai_poosam", nak: 8, ref: "sunrise", solarMonth: 9 },
  { id: "masi_magam", nak: 10, ref: "sunrise", solarMonth: 10 },
  { id: "panguni_uthiram", nak: 12, ref: "sunrise", solarMonth: 11 },

  { id: "masa_pirappu", solarDay: 1 },
  { id: "puthandu", solarMonth: 0, solarDay: 1 },
  { id: "aadi_perukku", solarMonth: 3, solarDay: 18 },
  { id: "pongal", solarMonth: 9, solarDay: 1 },
  { id: "maattu_pongal", solarMonth: 9, solarDay: 2 },
  { id: "kaanum_pongal", solarMonth: 9, solarDay: 3 },

  { id: "aadi_velli", solarMonth: 3, weekday: 5 },
  { id: "puratasi_sani", solarMonth: 5, weekday: 6 },
  { id: "karthigai_somavaram", solarMonth: 7, weekday: 1 },
  { id: "thai_velli", solarMonth: 9, weekday: 5 },
];

// A bigger observance hides the everyday one it falls on.
const REPLACES = {
  vaikunta_ekadasi: ["ekadasi"],
  chitra_pournami: ["pournami"],
  avani_avittam: ["pournami"],
  aadi_amavasai: ["amavasai"],
  thai_amavasai: ["amavasai"],
  mahalaya_amavasai: ["amavasai"],
  karthigai_deepam: ["krithigai"],
  kanda_sashti: ["sashti"],
  maha_shivaratri: ["masa_sivaratri"],
  puthandu: ["masa_pirappu"],
  pongal: ["masa_pirappu"],
  saraswati_pooja: ["navaratri"],
};

// The civil day an interval is observed on: the first day whose reference
// moment falls inside it, or (if it slips between two days) the closest one.
function observedDay(span, ref, place) {
  let k = addDays(dayKey(new Date(span.start)), -1);
  const last = addDays(dayKey(new Date(span.end)), 1);
  let best = k;
  let bestDist = Infinity;
  for (; daysBetween(k, last) >= 0; k = addDays(k, 1)) {
    const t = REF[ref](k, place);
    if (t >= span.start && t < span.end) return k;
    const d = Math.abs(t - (span.start + span.end) / 2);
    if (d < bestDist) { bestDist = d; best = k; }
  }
  return best;
}

// Map of day key -> [{id, ...details}] for every day in [fromKey, toKey].
export function observances(fromKey, toKey, place) {
  const out = new Map();
  const add = (key, entry) => {
    if (daysBetween(fromKey, key) < 0 || daysBetween(key, toKey) < 0) return;
    if (!out.has(key)) out.set(key, []);
    const list = out.get(key);
    if (!list.some((e) => e.id === entry.id)) list.push(entry);
  };

  // Look a little past both ends: rules like Varalakshmi Vratam depend on
  // dates just outside the window.
  const t0 = sun(addDays(fromKey, -3), place).sunrise;
  const t1 = sun(addDays(toKey, 10), place).sunrise;
  const tithis = tithiSpans(t0, t1);
  const naks = nakshatraSpans(t0, t1);
  const found = {};

  for (const rule of RULES) {
    if (!rule.tithi && !rule.nak) continue;
    const spans = rule.tithi ? tithis.filter((s) => rule.tithi.includes(s.n)) : naks.filter((s) => s.n === rule.nak);
    for (const [i, span] of spans.entries()) {
      const key = observedDay(span, rule.ref, place);
      if (rule.solarMonth !== undefined && solar(key, place).month !== rule.solarMonth) continue;
      // A star can come twice in one Tamil month; the festival takes the second.
      const again = rule.nak && rule.solarMonth !== undefined && spans[i + 1] &&
        solar(observedDay(spans[i + 1], rule.ref, place), place).month === rule.solarMonth;
      if (again) continue;
      if (rule.lunar !== undefined) {
        const lm = lunarMonth((span.start + span.end) / 2);
        if (lm.adhika || lm.month !== rule.lunar) continue;
      }
      const entry = { id: rule.id, start: span.start, end: span.end, n: span.n };
      if (rule.ref === "moonrise") entry.moonrise = moonrise(key, place);
      if (rule.ref === "arunodaya") entry.before = sun(key, place).sunrise;
      (found[rule.id] ||= []).push(key);
      add(key, entry);
    }
  }

  const span = daysBetween(addDays(fromKey, -3), addDays(toKey, 10));
  for (let i = 0; i <= span; i++) {
    const key = addDays(fromKey, i - 3);
    const s = solar(key, place);
    const weekday = parseKey(key).getDay();
    for (const rule of RULES) {
      if (rule.tithi || rule.nak) continue;
      if (rule.solarMonth !== undefined && s.month !== rule.solarMonth) continue;
      if (rule.solarDay !== undefined && s.day !== rule.solarDay) continue;
      if (rule.weekday !== undefined && weekday !== rule.weekday) continue;
      add(key, { id: rule.id, month: s.month });
      (found[rule.id] ||= []).push(key);
    }
    if (s.month === 8) add(key, { id: "margazhi", day: s.day });
    if (s.month === 11 && s.day <= 2) {
      // Karadaiyan Nombu is kept at the moment Maasi turns to Panguni.
      add(dayKey(new Date(s.sankranti)), { id: "karadaiyan_nombu", at: s.sankranti });
    }
    const lm = lunarMonth(sun(key, place).sunrise);
    const t = tithis.find((x) => x.start <= sun(key, place).sunrise && x.end > sun(key, place).sunrise);
    if (!lm.adhika && lm.month === 5 && t && t.n >= 16 && t.n <= 29) add(key, { id: "mahalaya_paksham" });
  }

  for (const key of found.pongal || []) add(addDays(key, -1), { id: "bhogi" });
  for (const key of found.avani_avittam || []) add(addDays(key, 1), { id: "gayatri_japam" });
  for (const key of found.navaratri_start || []) {
    for (let n = 1; n <= 9; n++) add(addDays(key, n - 1), { id: "navaratri", day: n });
  }
  // Varalakshmi Vratam: the Friday on or just before Shravana Pournami.
  for (const key of found.avani_avittam || []) {
    for (let back = 0; back < 7; back++) {
      const k = addDays(key, -back);
      if (parseKey(k).getDay() === 5) { add(k, { id: "varalakshmi" }); break; }
    }
  }

  for (const [key, list] of out) {
    const hidden = new Set(list.flatMap((e) => REPLACES[e.id] || []));
    out.set(key, list.filter((e) => !hidden.has(e.id) && e.id !== "navaratri_start"));
  }
  return out;
}
