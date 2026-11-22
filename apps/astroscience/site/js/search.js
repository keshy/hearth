// Reverse search: score moments in a date range against a list of chart
// constraints and return the best distinct windows.
//
// A constraint is { type, weight (1-3), why, ...fields }. Fields use indexes:
// signs 0-11 (Aries..Pisces), houses 1-12, nakshatras 0-26, planet ids.
import { analyze } from "./chart.js";
import { DIGNITY, GRAHAS, HOUSES, NAKSHATRAS, SIGNS, label, ordinal } from "./knowledge.js";
import { offsetMinutes } from "./places.js";

export const CONSTRAINT_TYPES = {
  lagna_sign: "Ascendant (lagnam) in a sign",
  moon_sign: "Moon sign (rasi)",
  nakshatra: "Birth star (Moon's nakshatram)",
  planet_in_sign: "Planet in a sign",
  planet_in_house: "Planet in a house",
  planet_strong: "Planet strong",
  planet_not_weak: "Planet not weak",
  house_lord_strong: "House lord strong",
  house_lord_in_house: "House lord placed in a house",
  aspect: "Planet aspects a house",
  conjunction: "Planets together",
  yoga: "Yoga present / absent",
  moon_phase: "Moon waxing / waning",
};

const list = (xs, f) => xs.map(f).join(" or ");

export function describe(c) {
  switch (c.type) {
    case "lagna_sign": return `Lagnam in ${list(c.signs, (s) => SIGNS[s].en)}`;
    case "moon_sign": return `Moon in ${list(c.signs, (s) => SIGNS[s].en)}`;
    case "nakshatra": return `Star: ${list(c.nakshatras, (n) => NAKSHATRAS[n][0])}`;
    case "planet_in_sign": return `${label(c.planet)} in ${list(c.signs, (s) => SIGNS[s].en)}`;
    case "planet_in_house": return `${label(c.planet)} in the ${list(c.houses, ordinal)} house`;
    case "planet_strong": return `${label(c.planet)} strong`;
    case "planet_not_weak": return `${label(c.planet)} not weak`;
    case "house_lord_strong": return `Lord of the ${ordinal(c.house)} (${HOUSES[c.house].short}) strong`;
    case "house_lord_in_house": return `${ordinal(c.house)} lord in the ${list(c.houses, ordinal)}`;
    case "aspect": return `${label(c.planet)} aspects the ${ordinal(c.house)} house`;
    case "conjunction": return `${c.planets.map((p) => GRAHAS[p].en).join(" + ")} together`;
    case "yoga": return `${c.present === false ? "No " : ""}${YOGA_NAMES[c.yoga] || c.yoga}`;
    case "moon_phase": return `Moon ${c.phase}`;
    default: return c.type;
  }
}

export const YOGA_NAMES = {
  gajakesari: "Gajakesari yogam", budhaditya: "Budha-Aditya yogam", chandra_mangala: "Chandra-Mangala yogam",
  ruchaka: "Ruchaka yogam", bhadra: "Bhadra yogam", hamsa: "Hamsa yogam", malavya: "Malavya yogam", sasa: "Sasa yogam",
  kemadruma: "Kemadruma yogam", sevvai_dosham: "Sevvai dosham", raja: "Raja yogam", vipareeta: "Vipareeta raja yogam",
  kala_sarpa: "Kala sarpa dosham", yogakaraka: "Yogakaraka",
};

// 0..1: how well the chart meets one constraint.
export function scoreOne(c, chart) {
  const P = chart.planets;
  const lordOf = (h) => P[chart.houses[h].lord];
  switch (c.type) {
    case "lagna_sign": return c.signs.includes(chart.lagna.sign) ? 1 : 0;
    case "moon_sign": return c.signs.includes(P.moon.sign) ? 1 : 0;
    case "nakshatra": return c.nakshatras.includes(P.moon.nakshatra.index) ? 1 : 0;
    case "planet_in_sign": return c.signs.includes(P[c.planet].sign) ? 1 : 0;
    case "planet_in_house": return c.houses.includes(P[c.planet].house) ? 1 : 0;
    case "planet_strong": return Math.min(1, P[c.planet].strength.score / (c.min || 7.5));
    case "planet_not_weak": {
      const p = P[c.planet];
      return p.dignity === "debilitated" || p.combust || [6, 8, 12].includes(p.house) ? 0 : 1;
    }
    case "house_lord_strong": return Math.min(1, lordOf(c.house).strength.score / (c.min || 7.5));
    case "house_lord_in_house": return c.houses.includes(lordOf(c.house).house) ? 1 : 0;
    case "aspect": return P[c.planet].aspects.includes(c.house) ? 1 : 0;
    case "conjunction": return new Set(c.planets.map((p) => P[p].sign)).size === 1 ? 1 : 0;
    case "yoga": {
      const has = chart.yogas.some((y) => y.present && (y.id === c.yoga || y.id.startsWith(`${c.yoga}_`)));
      return has === (c.present !== false) ? 1 : 0;
    }
    case "moon_phase": return chart.moonPhase.waxing === (c.phase === "waxing") ? 1 : 0;
    default: return 0;
  }
}

export function scoreChart(constraints, chart) {
  let total = 0, got = 0;
  const detail = constraints.map((c) => {
    const s = scoreOne(c, chart);
    const w = c.weight || 1;
    total += w;
    got += w * s;
    return { text: describe(c), why: c.why, score: s };
  });
  return { score: total ? got / total : 0, detail };
}

// Scan [fromMs, toMs) every stepMin minutes; keep the best distinct windows.
// hours = [startHour, endHour) in the place's local time, or null for any.
export function search({ constraints, place, fromMs, toMs, hours = null, top = 5, stepMin = 0, onProgress }) {
  const span = toMs - fromMs;
  const step = (stepMin || (span > 2 * 365 * 86400000 ? 20 : 10)) * 60000;
  const runs = [];
  let run = null;
  let offsetDay = -1, offset = 0;
  const total = Math.ceil(span / step);
  for (let i = 0, t = fromMs; t < toMs; i++, t += step) {
    if (hours) {
      const day = Math.floor(t / 43200000);
      if (day !== offsetDay) { offsetDay = day; offset = offsetMinutes(t, place.tz); }
      const h = (((t / 60000 + offset) / 60) % 24 + 24) % 24;
      const inside = hours[0] <= hours[1] ? h >= hours[0] && h < hours[1] : h >= hours[0] || h < hours[1];
      if (!inside) { run = null; continue; }
    }
    const chart = analyze(t, place, { fast: true });
    const { score } = scoreChart(constraints, chart);
    const key = `${chart.lagna.sign}|${score.toFixed(4)}`;
    if (run && run.key === key && t - run.end <= step) run.end = t;
    else { run = { key, start: t, end: t, score }; runs.push(run); }
    if (onProgress && i % 2000 === 0) onProgress(i / total);
  }
  runs.sort((a, b) => b.score - a.score || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const picks = [];
  for (const r of runs) {
    const mid = Math.round((r.start + r.end) / 2 / 60000) * 60000;
    if (picks.some((p) => Math.abs(p.ms - mid) < 6 * 3600000)) continue;
    const chart = analyze(mid, place);
    picks.push({ ms: mid, window: [r.start, r.end + step], ...scoreChart(constraints, chart), lagna: chart.lagna.sign, moon: chart.planets.moon.sign, star: chart.star.name });
    if (picks.length >= top * 3) break;
  }
  return picks.sort((a, b) => b.score - a.score || a.ms - b.ms).slice(0, top);
}

export { DIGNITY };
