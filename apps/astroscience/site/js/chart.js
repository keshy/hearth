// Turns raw positions into a Tamil-astrology reading: houses, lords,
// dignities, friendships, aspects, yogas and the Vimshottari dasha timeline.
import {
  DASHA_ORDER, DIGNITY, GRAHAS, HOUSES, NAKSHATRAS, ORDER, SIGNS, label, naturalRelation, ordinal, signLabel,
} from "./knowledge.js";
import { positions } from "./planets.js";

const NAK = 40 / 3;
const YEAR_MS = 365.25 * 86400000;
const KENDRA = [1, 4, 7, 10];
const KONA = [1, 5, 9];
const DUSTHANA = [6, 8, 12];

export const signOf = (lon) => Math.floor(lon / 30);
export const houseFrom = (fromSign, sign) => ((sign - fromSign + 12) % 12) + 1;
const angle = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
export const dms = (lon) => {
  const d = lon % 30;
  const deg = Math.floor(d);
  const min = Math.floor((d - deg) * 60);
  return `${deg}°${String(min).padStart(2, "0")}′`;
};

export function nakshatraOf(lon) {
  const n = Math.floor(lon / NAK);
  const pada = Math.floor((lon % NAK) / (NAK / 4)) + 1;
  return { index: n, pada, lord: DASHA_ORDER[n % 9], name: NAKSHATRAS[n][0], sanskrit: NAKSHATRAS[n][1], fraction: (lon % NAK) / NAK };
}
export const navamsaOf = (lon) => Math.floor(lon / (10 / 3)) % 12;

// Temporary friendship: grahas 2, 3, 4, 10, 11 or 12 signs away help each other.
const tempFriend = (fromSign, toSign) => [2, 3, 4, 10, 11, 12].includes(houseFrom(fromSign, toSign));
const COMPOUND = {
  "friend+friend": "great_friend", "friend+enemy": "neutral",
  "neutral+friend": "friend", "neutral+enemy": "enemy",
  "enemy+friend": "neutral", "enemy+enemy": "great_enemy",
};

export function compoundRelation(of, to, signs) {
  const nat = naturalRelation(of, to);
  const tmp = tempFriend(signs[of], signs[to]) ? "friend" : "enemy";
  return { natural: nat, temporary: tmp, compound: COMPOUND[`${nat}+${tmp}`] };
}

function dignityOf(g, lon, signs) {
  const info = GRAHAS[g];
  const s = signOf(lon);
  const deg = lon % 30;
  if (info.exalt && info.exalt[0] === s) return "exalted";
  if (info.debil && info.debil[0] === s) return "debilitated";
  if (info.mt && info.mt[0] === s && deg >= info.mt[1] && deg < info.mt[2]) return "moolatrikona";
  if (info.own.includes(s)) return "own";
  const lord = SIGNS[s].lord;
  if (lord === g) return "own";
  return compoundRelation(g, lord, signs).compound;
}

export function aspectedHouses(g, house, includeNodeTrines = false) {
  let offs = GRAHAS[g].aspects;
  if (includeNodeTrines && (g === "rahu" || g === "ketu")) offs = [5, 7, 9];
  return offs.map((k) => ((house - 1 + k - 1) % 12) + 1);
}

// The full reading for an instant and place.
export function analyze(ms, place, opts = {}) {
  return chartFrom(positions(ms, place, !opts.fast), ms, place, opts);
}

// A chart given by its placements instead of a birth moment, as traditional
// charts (Rama's in the Valmiki Ramayana, say) are. Longitudes are sidereal
// degrees; Ketu is always opposite Rahu.
export function analyzeFixed(fixed, opts = {}) {
  const grahas = {};
  for (const g of ORDER) {
    const lon = g === "ketu" ? norm(fixed.planets.rahu + 180) : norm(fixed.planets[g]);
    grahas[g] = { lon, retro: (fixed.retro || []).includes(g), speed: g === "rahu" || g === "ketu" ? -0.053 : 1 };
  }
  const c = chartFrom({ lagna: norm(fixed.lagna), grahas }, null, null, opts);
  c.fixed = true;
  return c;
}
const norm = (x) => ((x % 360) + 360) % 360;

function chartFrom(pos, ms, place, opts) {
  const lagnaSign = signOf(pos.lagna);
  const signs = {};
  for (const g of ORDER) signs[g] = signOf(pos.grahas[g].lon);
  const sunLon = pos.grahas.sun.lon;

  const planets = {};
  for (const g of ORDER) {
    const p = pos.grahas[g];
    const house = houseFrom(lagnaSign, signs[g]);
    const dignity = dignityOf(g, p.lon, signs);
    const combustLimit = GRAHAS[g].combust;
    const combust = combustLimit !== null && g !== "sun" && angle(p.lon, sunLon) < combustLimit;
    planets[g] = {
      id: g, lon: p.lon, sign: signs[g], house, retro: p.retro, speed: p.speed,
      nakshatra: nakshatraOf(p.lon), navamsa: navamsaOf(p.lon), dignity, combust,
      aspects: aspectedHouses(g, house, opts.nodeTrines),
      owns: [],
    };
  }
  const houses = [null];
  for (let h = 1; h <= 12; h++) {
    const sign = (lagnaSign + h - 1) % 12;
    const lord = SIGNS[sign].lord;
    planets[lord].owns.push(h);
    houses.push({ house: h, sign, lord, occupants: ORDER.filter((g) => planets[g].house === h), aspectedBy: [] });
  }
  for (const g of ORDER) for (const h of planets[g].aspects) houses[h].aspectedBy.push(g);
  for (const g of ORDER) planets[g].strength = strengthOf(planets[g]);

  const moon = planets.moon;
  const elong = (pos.grahas.moon.lon - sunLon + 360) % 360;
  const chart = {
    ms, place, lagna: { lon: pos.lagna, sign: lagnaSign, nakshatra: nakshatraOf(pos.lagna), navamsa: navamsaOf(pos.lagna) },
    planets, houses, lagnaLord: SIGNS[lagnaSign].lord,
    moonSign: moon.sign, star: moon.nakshatra,
    moonPhase: { elongation: elong, waxing: elong < 180, tithi: Math.floor(elong / 12) + 1 },
  };
  chart.yogas = yogas(chart);
  return chart;
}

// A simple 0-10 "how well can this graha deliver" meter. Not shadbala:
// dignity, then house, combustion and retrogression nudges, all explained.
function strengthOf(p) {
  const parts = [[`${DIGNITY[p.dignity].en}`, DIGNITY[p.dignity].score]];
  if (KENDRA.includes(p.house)) parts.push(["in an angle (kendra)", 1]);
  else if (KONA.includes(p.house)) parts.push(["in a trine (kona)", 1]);
  else if (DUSTHANA.includes(p.house)) parts.push(["in a hidden house (6/8/12)", -1.5]);
  if (p.combust) parts.push(["combust (too close to the Sun)", -2]);
  if (p.retro) parts.push(["retrograde (vakram): strong but unusual", 0.5]);
  const score = Math.max(0, Math.min(10, parts.reduce((s, [, v]) => s + v, 0)));
  return { score, parts };
}

// ---------- dasha ----------
export function dashaTimeline(birthMs, moonLon) {
  const star = nakshatraOf(moonLon);
  const startIndex = DASHA_ORDER.indexOf(star.lord);
  const firstYears = GRAHAS[star.lord].years;
  let start = birthMs - star.fraction * firstYears * YEAR_MS;
  const out = [];
  for (let i = 0; i < 9; i++) {
    const lord = DASHA_ORDER[(startIndex + i) % 9];
    const len = GRAHAS[lord].years * YEAR_MS;
    out.push({ lord, start, end: start + len, sub: subPeriods(lord, start, len) });
    start += len;
  }
  return { star, balanceYears: firstYears * (1 - star.fraction), periods: out };
}

export function subPeriods(lord, start, len) {
  const i0 = DASHA_ORDER.indexOf(lord);
  const out = [];
  let t = start;
  for (let i = 0; i < 9; i++) {
    const sub = DASHA_ORDER[(i0 + i) % 9];
    const l = (len * GRAHAS[sub].years) / 120;
    out.push({ lord: sub, start: t, end: t + l });
    t += l;
  }
  return out;
}

// ---------- yogas ----------
function yogas(c) {
  const P = c.planets;
  const out = [];
  const add = (id, name, en, present, why, involves) => out.push({ id, name, en, present, why, involves });
  const fromMoon = (g) => houseFrom(P.moon.sign, P[g].sign);
  const fromLagna = (g) => P[g].house;

  const gk = KENDRA.includes(fromMoon("jupiter"));
  add("gajakesari", "Gajakesari yogam", "Elephant-lion", gk,
    `Guru (Jupiter) is ${ordinal(fromMoon("jupiter"))} from the Moon. When it is 1st, 4th, 7th or 10th from the Moon, it promises wisdom, reputation and the ability to overcome opposition, like a lion scattering elephants.`,
    ["jupiter", "moon"]);

  const ba = P.sun.sign === P.mercury.sign;
  add("budhaditya", "Budha-Aditya yogam", "Sun + Mercury", ba,
    "Sun and Mercury in the same sign: sharp intellect and skill with words. It's common (Mercury is never far from the Sun), so it shines most when Mercury isn't combust.",
    ["sun", "mercury"]);

  const cm = P.moon.sign === P.mars.sign || (houseFrom(P.moon.sign, P.mars.sign) === 7);
  add("chandra_mangala", "Chandra-Mangala yogam", "Moon + Mars", cm,
    "Moon and Mars together or facing each other: drive to earn, enterprise and a bold emotional nature.",
    ["moon", "mars"]);

  const MAHA = { mars: ["ruchaka", "Ruchaka"], mercury: ["bhadra", "Bhadra"], jupiter: ["hamsa", "Hamsa"], venus: ["malavya", "Malavya"], saturn: ["sasa", "Sasa"] };
  for (const [g, [id, name]] of Object.entries(MAHA)) {
    const strong = ["own", "moolatrikona", "exalted"].includes(P[g].dignity);
    add(id, `${name} yogam`, `Pancha Mahapurusha · ${GRAHAS[g].en}`, strong && KENDRA.includes(fromLagna(g)),
      `One of the five 'great person' yogas: ${label(g)} in its own or exalted sign AND in an angle (1, 4, 7, 10) from the lagna. Gives the best of ${GRAHAS[g].en}: ${GRAHAS[g].traits}.`,
      [g]);
  }

  const near = ORDER.filter((g) => !["sun", "moon", "rahu", "ketu"].includes(g) && [2, 12, 1].includes(fromMoon(g)));
  add("kemadruma", "Kemadruma yogam", "Lonely Moon", near.length === 0,
    "No planet (other than Sun, Rahu, Ketu) beside the Moon or in the 2nd/12th from it: the mind feels unsupported. Many cancellations exist (e.g. planets in angles from the lagna), so treat it lightly.",
    ["moon"]);

  const sevvai = [2, 4, 7, 8, 12].includes(fromLagna("mars"));
  add("sevvai_dosham", "Sevvai dosham", "Mars affliction", sevvai,
    `Mars (Sevvai) is in the ${ordinal(fromLagna("mars"))} house from the lagna. In Tamil marriage matching, Mars in the 2nd, 4th, 7th, 8th or 12th is 'dosham'; families match it with a similar chart. Many exceptions apply (Mars in own or exalted sign, certain lagnas), and some also count from the Moon and Venus.`,
    ["mars"]);

  for (let i = 0; i < 7; i++) {
    for (let j = i + 1; j < 7; j++) {
      const a = ORDER[i], b = ORDER[j];
      if (SIGNS[P[a].sign].lord === b && SIGNS[P[b].sign].lord === a) {
        add(`parivartana_${a}_${b}`, "Parivarthanai yogam", `Exchange: ${GRAHAS[a].en} ⇄ ${GRAHAS[b].en}`, true,
          `${label(a)} sits in ${label(b)}'s sign and vice versa. Both act as if at home, and houses ${P[a].house} and ${P[b].house} become tightly linked.`,
          [a, b]);
      }
    }
  }

  for (const g of ORDER.slice(0, 7)) {
    if (P[g].dignity !== "debilitated") continue;
    const dispositor = SIGNS[P[g].sign].lord;
    const exaltedHere = ORDER.slice(0, 7).find((x) => GRAHAS[x].exalt && GRAHAS[x].exalt[0] === P[g].sign);
    const angular = (x) => x && (KENDRA.includes(fromLagna(x)) || KENDRA.includes(fromMoon(x)));
    const cancelled = angular(dispositor) || angular(exaltedHere);
    add(`neecha_${g}`, cancelled ? "Neecha bhanga raja yogam" : "Neecham (debilitation)", `${GRAHAS[g].en} debilitated`, true,
      cancelled
        ? `${label(g)} is debilitated, but the lord of its sign (${label(dispositor)})${exaltedHere ? ` or the planet exalted there (${label(exaltedHere)})` : ""} stands in an angle from the lagna or Moon, which cancels the weakness. Classic 'rise after a fall' combination.`
        : `${label(g)} is debilitated in ${signLabel(P[g].sign)} and nothing cancels it, so its themes (${GRAHAS[g].karaka.slice(0, 2).join(", ")}) take more effort.`,
      [g]);
  }

  const lordOf = (h) => c.houses[h].lord;
  const kendraLords = new Set([1, 4, 7, 10].map(lordOf));
  const konaLords = new Set([5, 9].map(lordOf));
  const yk = ORDER.find((g) => [4, 7, 10].some((h) => lordOf(h) === g) && [5, 9].some((h) => lordOf(h) === g));
  if (yk) {
    add("yogakaraka", "Yogakaraka", `${GRAHAS[yk].en} rules an angle and a trine`, true,
      `${label(yk)} owns both an angle (${P[yk].owns.filter((h) => [4, 7, 10].includes(h)).join(", ")}) and a trine (${P[yk].owns.filter((h) => [5, 9].includes(h)).join(", ")}). It is the single most helpful planet for this lagna; its dasa is eagerly awaited.`,
      [yk]);
  }
  const raja = [];
  for (const k of kendraLords) {
    for (const t of konaLords) {
      if (k === t) continue;
      const together = P[k].sign === P[t].sign;
      const mutual = P[k].aspects.includes(P[t].house) && P[t].aspects.includes(P[k].house);
      if (together || mutual) raja.push([k, t, together ? "together" : "facing each other"]);
    }
  }
  add("raja", "Raja yogam", "Angle lord + trine lord", raja.length > 0,
    raja.length
      ? raja.map(([k, t, how]) => `${label(k)} (lord of ${P[k].owns.join(" & ")}) and ${label(t)} (lord of ${P[t].owns.join(" & ")}) are ${how}`).join("; ") + ". Angles give power, trines give luck; linked lords promise rise in status."
      : "No angle lord (1, 4, 7, 10) is joined with or facing a trine lord (5, 9) in this chart.",
    raja.flat().filter((x) => GRAHAS[x]));

  const vip = [6, 8, 12].filter((h) => DUSTHANA.includes(P[lordOf(h)].house) && P[lordOf(h)].house !== h);
  add("vipareeta", "Vipareeta raja yogam", "Reversal of fortune", vip.length > 0,
    vip.length
      ? `The lord of house ${vip.join(" and ")} sits in another hidden house (6/8/12). Difficulties cancel each other: gains that arrive through others' losses or unexpected turns.`
      : "No lord of 6, 8 or 12 sits in another of those houses.",
    vip.map(lordOf));

  const r = P.rahu.lon;
  const side = ORDER.slice(0, 7).map((g) => ((P[g].lon - r + 360) % 360) < 180);
  const ks = side.every((x) => x) || side.every((x) => !x);
  add("kala_sarpa", "Kala sarpa dosham", "All planets between Rahu and Ketu", ks,
    "All seven planets fall on one side of the Rahu–Ketu axis. Popular in Tamil practice, though classical texts don't mention it; said to bring intense, uneven life phases.",
    ["rahu", "ketu"]);

  return out;
}

// ---------- explanations ----------
const houseName = (h) => `${ordinal(h)} house (${HOUSES[h].en.toLowerCase()})`;

export function explainPlanet(c, g) {
  const p = c.planets[g];
  const info = GRAHAS[g];
  const lines = [];
  lines.push(`${label(g)} is in ${signLabel(p.sign)} at ${dms(p.lon)}, which is your ${houseName(p.house)}.`);
  lines.push(`Placement: ${DIGNITY[p.dignity].ta} (${DIGNITY[p.dignity].en}): ${DIGNITY[p.dignity].why}.`);
  if (!["exalted", "debilitated", "own", "moolatrikona"].includes(p.dignity) && g !== "rahu" && g !== "ketu") {
    const host = SIGNS[p.sign].lord;
    const rel = compoundRelation(g, host, Object.fromEntries(Object.entries(c.planets).map(([k, v]) => [k, v.sign])));
    lines.push(`Why: the sign's lord is ${label(host)}. Naturally a ${rel.natural}, and because of where both sit (${ordinal(houseFrom(p.sign, c.planets[host].sign))} from each other) a temporary ${rel.temporary}, so overall: ${DIGNITY[rel.compound].en.toLowerCase()}.`);
  }
  if (p.owns.length) {
    lines.push(`Lordship (aadhipathyam): rules ${p.owns.map((h) => houseName(h)).join(" and ")}. Those themes flow into the ${ordinal(p.house)} house: ${HOUSES[p.house].themes}.`);
  }
  if (g === c.lagnaLord) lines.push(`This is your lagnadhipathi (chart ruler): your life force is directed toward the ${ordinal(p.house)} house.`);
  const looked = p.aspects.map((h) => `${ordinal(h)}${c.houses[h].occupants.length ? ` (${c.houses[h].occupants.map((x) => GRAHAS[x].en).join(", ")})` : ""}`);
  lines.push(`Paarvai (aspects): looks at house${p.aspects.length > 1 ? "s" : ""} ${looked.join(", ")}.`);
  const by = c.houses[p.house].aspectedBy.filter((x) => x !== g);
  if (by.length) lines.push(`Receives the glance of ${by.map(label).join(", ")}.`);
  if (p.combust) lines.push(`Asthangam: within ${info.combust}° of the Sun, so its significations are dimmed.`);
  if (p.retro) lines.push("Vakram: retrograde at birth, so its results come in an unusual, inward way.");
  lines.push(`Nakshatram: ${p.nakshatra.name} (${p.nakshatra.sanskrit}) pada ${p.nakshatra.pada}, ruled by ${label(p.nakshatra.lord)}.`);
  return lines;
}

export function explainHouse(c, h) {
  const H = c.houses[h];
  const lord = c.planets[H.lord];
  const lines = [];
  lines.push(`The ${houseName(h)} (${HOUSES[h].ta}) covers ${HOUSES[h].themes}.`);
  lines.push(`Its sign is ${signLabel(H.sign)}, so its lord (aadhipathi) is ${label(H.lord)}.`);
  const where = lord.house;
  const quality = KENDRA.includes(where) || KONA.includes(where) ? "a strong spot (angle or trine)" : DUSTHANA.includes(where) ? "a hidden house, so these themes take effort" : "a neutral spot";
  lines.push(`${GRAHAS[H.lord].en} sits in the ${houseName(where)}: ${quality}. Think of it as: ${HOUSES[h].short} is pursued through ${HOUSES[where].short}.`);
  lines.push(`The lord is ${DIGNITY[lord.dignity].en.toLowerCase()} (strength ${lord.strength.score.toFixed(1)}/10).`);
  if (H.occupants.length) lines.push(`Occupied by ${H.occupants.map(label).join(", ")}: they colour this house directly.`);
  else lines.push("No graha sits here; read it through its lord and any aspects.");
  if (H.aspectedBy.length) lines.push(`Aspected by ${H.aspectedBy.map(label).join(", ")}.`);
  lines.push(`Natural significator (karaka): ${label(HOUSES[h].karaka)}.`);
  return lines;
}
