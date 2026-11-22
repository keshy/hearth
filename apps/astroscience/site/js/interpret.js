// Natural language -> search constraints. Gemini (through the platform's
// /_api/llm) does the understanding when available; an offline keyword
// interpreter covers the common traits otherwise. Both outputs go through
// sanitize(), so the search only ever sees well-formed constraints.
import { GRAHAS, HOUSES, NAKSHATRAS, ORDER, SIGNS } from "./knowledge.js";
import { CONSTRAINT_TYPES, YOGA_NAMES } from "./search.js";

const PLANET_NAMES = {};
for (const g of ORDER) {
  for (const n of [g, GRAHAS[g].ta, ...GRAHAS[g].alt.split(",").map((s) => s.trim()).filter(Boolean)]) PLANET_NAMES[n.toLowerCase()] = g;
}
Object.assign(PLANET_NAMES, { sukra: "venus", shukra: "venus", chandra: "moon", surya: "sun", kuja: "mars", mangal: "mars", angaraka: "mars", shani: "saturn", saturn: "saturn", brihaspati: "jupiter" });
const SIGN_NAMES = {};
SIGNS.forEach((s, i) => { SIGN_NAMES[s.en.toLowerCase()] = i; SIGN_NAMES[s.ta.toLowerCase()] = i; });
Object.assign(SIGN_NAMES, { rishabham: 1, kataka: 3, kadakam: 3, simha: 4, thula: 6, vrischika: 7, dhanus: 8, makara: 9, kumbha: 10, meena: 11 });
const NAK_NAMES = {};
NAKSHATRAS.forEach((n, i) => { NAK_NAMES[n[0].toLowerCase()] = i; NAK_NAMES[n[1].toLowerCase()] = i; });

const toPlanet = (x) => PLANET_NAMES[String(x || "").toLowerCase().trim()];
const toSign = (x) => (Number.isInteger(x) && x >= 0 && x < 12 ? x : SIGN_NAMES[String(x || "").toLowerCase().trim()]);
const toNak = (x) => (Number.isInteger(x) && x >= 0 && x < 27 ? x : NAK_NAMES[String(x || "").toLowerCase().trim()]);
const toHouse = (x) => { const n = parseInt(x, 10); return n >= 1 && n <= 12 ? n : undefined; };
const many = (xs, f) => [...new Set((Array.isArray(xs) ? xs : [xs]).map(f).filter((v) => v !== undefined))];

// Keep only constraints the search understands, with clean fields.
export function sanitize(raw) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!c || !CONSTRAINT_TYPES[c.type]) continue;
    const base = { type: c.type, weight: Math.max(1, Math.min(3, Math.round(Number(c.weight) || 2))), why: String(c.why || "").slice(0, 300) };
    let ok = true;
    switch (c.type) {
      case "lagna_sign": case "moon_sign": base.signs = many(c.signs, toSign); ok = base.signs.length > 0; break;
      case "nakshatra": base.nakshatras = many(c.nakshatras, toNak); ok = base.nakshatras.length > 0; break;
      case "planet_in_sign": base.planet = toPlanet(c.planet); base.signs = many(c.signs, toSign); ok = base.planet && base.signs.length; break;
      case "planet_in_house": base.planet = toPlanet(c.planet); base.houses = many(c.houses, toHouse); ok = base.planet && base.houses.length; break;
      case "planet_strong": case "planet_not_weak": base.planet = toPlanet(c.planet); ok = !!base.planet; break;
      case "house_lord_strong": base.house = toHouse(c.house); ok = !!base.house; break;
      case "house_lord_in_house": base.house = toHouse(c.house); base.houses = many(c.houses, toHouse); ok = base.house && base.houses.length; break;
      case "aspect": base.planet = toPlanet(c.planet); base.house = toHouse(c.house); ok = base.planet && base.house; break;
      case "conjunction": base.planets = many(c.planets, toPlanet); ok = base.planets.length >= 2; break;
      case "yoga": base.yoga = String(c.yoga || "").toLowerCase(); base.present = c.present !== false; ok = !!YOGA_NAMES[base.yoga]; break;
      case "moon_phase": base.phase = c.phase === "waning" ? "waning" : "waxing"; break;
      default: ok = false;
    }
    const { weight, why, ...shape } = base;
    const key = JSON.stringify(shape);
    if (ok && !seen.has(key)) { seen.add(key); out.push(base); }
  }
  return out.slice(0, 12);
}

// ---------- offline interpreter ----------
const TRAITS = [
  [/leader|leadership|authorit|confiden|command|ceo|boss|politic|govern/, [
    { type: "planet_strong", planet: "sun", weight: 3, why: "Suriyan (Sun) is the karaka of authority and self-confidence." },
    { type: "lagna_sign", signs: [4, 0], weight: 2, why: "Simmam (Leo) and Mesham (Aries) lagnas are the natural 'commander' signs." },
    { type: "planet_in_house", planet: "sun", houses: [1, 10], weight: 2, why: "Sun in the 1st or 10th puts authority on display." },
  ]],
  [/creativ|artist|art\b|music|sing|danc|beaut|design|actor|actress|film|poet|aesthetic|fashion/, [
    { type: "planet_strong", planet: "venus", weight: 3, why: "Sukran (Venus) rules art, music and beauty." },
    { type: "house_lord_strong", house: 5, weight: 2, why: "The 5th house is creativity; a strong 5th lord makes it flow." },
    { type: "yoga", yoga: "malavya", weight: 1, why: "Malavya yogam: Venus in its own or exalted sign in an angle." },
  ]],
  [/intelligen|smart|analytic|logic|math|scien|engineer|coder|program|software|research|writer|author|speaker|orator|lawyer|journalis|accountant/, [
    { type: "planet_strong", planet: "mercury", weight: 3, why: "Budhan (Mercury) is intellect, speech and analysis." },
    { type: "planet_not_weak", planet: "mercury", weight: 2, why: "Mercury free of combustion and debilitation keeps the mind sharp." },
    { type: "yoga", yoga: "budhaditya", weight: 1, why: "Budha-Aditya yogam: Sun and Mercury together sharpen intellect." },
  ]],
  [/wise|wisdom|teacher|guru|spiritual|ethic|moral|religio|devot|philosoph|kind|generous|priest|counsel/, [
    { type: "planet_strong", planet: "jupiter", weight: 3, why: "Guru (Jupiter) is wisdom, dharma and generosity." },
    { type: "yoga", yoga: "gajakesari", weight: 2, why: "Gajakesari yogam (Jupiter in an angle from the Moon) brings respect and wisdom." },
    { type: "house_lord_strong", house: 9, weight: 2, why: "The 9th house is dharma, guru and fortune." },
  ]],
  [/brave|courag|athlet|sport|fighter|soldier|army|police|surgeon|energetic|bold|competitive|adventur/, [
    { type: "planet_strong", planet: "mars", weight: 3, why: "Sevvai (Mars) is courage, energy and competition." },
    { type: "planet_in_house", planet: "mars", houses: [3, 6, 10, 11], weight: 2, why: "Mars thrives in the growth houses (3, 6, 10, 11)." },
  ]],
  [/disciplin|hard.?work|patient|persever|persist|responsib|serious|endur|organi[sz]ed|reliab/, [
    { type: "planet_strong", planet: "saturn", weight: 3, why: "Sani (Saturn) rewards discipline and persistence." },
    { type: "planet_in_house", planet: "saturn", houses: [3, 6, 10, 11], weight: 2, why: "Saturn does best in the upachaya (growth) houses." },
  ]],
  [/calm|caring|empath|emotional|nurtur|gentle|popular|loved|imaginat|sensitive|mother/, [
    { type: "planet_strong", planet: "moon", weight: 3, why: "Chandran (Moon) is the mind; a strong Moon gives emotional balance and popularity." },
    { type: "moon_phase", phase: "waxing", weight: 2, why: "A waxing (growing) Moon is considered a benefic." },
    { type: "yoga", yoga: "kemadruma", present: false, weight: 1, why: "Avoid Kemadruma: a 'lonely' Moon." },
  ]],
  [/rich|wealth|money|prosper|business|entrepreneur|trade|financ|fortune|lucky/, [
    { type: "house_lord_strong", house: 2, weight: 2, why: "The 2nd house holds accumulated wealth." },
    { type: "house_lord_strong", house: 11, weight: 2, why: "The 11th house is income and gains." },
    { type: "planet_strong", planet: "jupiter", weight: 2, why: "Guru is the natural karaka of wealth." },
    { type: "yoga", yoga: "raja", weight: 1, why: "Raja yogam links power (angles) with luck (trines)." },
  ]],
  [/famous|fame|celebrit|reputat|status|career|success|achiev|ambitio/, [
    { type: "house_lord_strong", house: 10, weight: 3, why: "The 10th house is career and public standing." },
    { type: "yoga", yoga: "raja", weight: 2, why: "Raja yogam: rise in status." },
    { type: "planet_in_house", planet: "sun", houses: [10, 11], weight: 1, why: "Sun near the top of the chart brings visibility." },
  ]],
  [/marri|spouse|husband|wife|relationship|partner|romanc|loving|harmon/, [
    { type: "yoga", yoga: "sevvai_dosham", present: false, weight: 3, why: "No Sevvai dosham: the Tamil marriage-matching check." },
    { type: "house_lord_strong", house: 7, weight: 2, why: "The 7th house is marriage; a strong 7th lord supports it." },
    { type: "planet_strong", planet: "venus", weight: 2, why: "Sukran (Venus) is love and the spouse." },
  ]],
  [/health|healthy|long life|longev|strong body|fit|vital/, [
    { type: "house_lord_strong", house: 1, weight: 3, why: "A strong lagna lord means a strong constitution." },
    { type: "house_lord_strong", house: 8, weight: 1, why: "The 8th house is longevity." },
    { type: "planet_not_weak", planet: "sun", weight: 1, why: "Sun is vitality." },
  ]],
  [/travel|foreign|abroad|global|explor|immigra|overseas/, [
    { type: "planet_in_house", planet: "rahu", houses: [9, 12, 3, 7], weight: 2, why: "Rahu is the foreigner; in the 3rd, 7th, 9th or 12th it pulls toward travel." },
    { type: "house_lord_in_house", house: 12, houses: [1, 9, 10, 12], weight: 1, why: "A well-placed 12th lord favours life abroad." },
  ]],
  [/tech|innovat|unconvention|invent|startup|rebel|original/, [
    { type: "planet_in_house", planet: "rahu", houses: [3, 6, 10, 11], weight: 2, why: "Rahu in the growth houses: unconventional success." },
    { type: "planet_strong", planet: "saturn", weight: 1, why: "Saturn is structure; with Rahu it builds new systems." },
  ]],
  [/mystic|intuit|detach|monk|meditat|moksha|occult|healer/, [
    { type: "planet_in_house", planet: "ketu", houses: [12, 8, 4, 9], weight: 2, why: "Ketu (south node) in 4, 8, 9 or 12 is the classic spiritual signature." },
    { type: "house_lord_strong", house: 12, weight: 1, why: "The 12th house is moksha." },
  ]],
];

export function interpretOffline(text) {
  const t = text.toLowerCase();
  const out = [];
  for (const [re, cs] of TRAITS) if (re.test(t)) out.push(...cs);

  // Explicit astrology: "moon in taurus", "jupiter in 10th", "leo lagna", "rohini star".
  const planetRe = Object.keys(PLANET_NAMES).join("|");
  const signRe = Object.keys(SIGN_NAMES).join("|");
  for (const m of t.matchAll(new RegExp(`\\b(${planetRe})\\s+in\\s+(?:the\\s+)?(${signRe})\\b`, "g"))) {
    out.push({ type: "planet_in_sign", planet: m[1], signs: [m[2]], weight: 3, why: "You asked for this placement." });
  }
  for (const m of t.matchAll(new RegExp(`\\b(${planetRe})\\s+in\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+house)?\\b`, "g"))) {
    out.push({ type: "planet_in_house", planet: m[1], houses: [m[2]], weight: 3, why: "You asked for this placement." });
  }
  for (const m of t.matchAll(new RegExp(`\\b(${signRe})\\s+(?:lagna|lagnam|ascendant|rising)\\b|\\b(?:lagna|lagnam|ascendant)\\s+(?:in\\s+)?(${signRe})\\b`, "g"))) {
    out.push({ type: "lagna_sign", signs: [m[1] || m[2]], weight: 3, why: "You asked for this lagnam." });
  }
  for (const m of t.matchAll(new RegExp(`\\b(${Object.keys(NAK_NAMES).join("|")})\\b`, "g"))) {
    out.push({ type: "nakshatra", nakshatras: [m[1]], weight: 3, why: "You asked for this birth star." });
  }
  for (const [id, name] of Object.entries(YOGA_NAMES)) {
    const key = name.split(" ")[0].toLowerCase();
    if (t.includes(key)) out.push({ type: "yoga", yoga: id, present: !new RegExp(`(no|without|avoid)\\s+${key}`).test(t), weight: 3, why: `You mentioned ${name}.` });
  }
  if (/sevvai|mangal|manglik|kuja/.test(t) && /no |without|avoid|free/.test(t)) {
    out.push({ type: "yoga", yoga: "sevvai_dosham", present: false, weight: 3, why: "No Sevvai dosham, as asked." });
  }
  return sanitize(out);
}

// ---------- Gemini ----------
const SYSTEM = `You translate a description of a person, event or thing into constraints for a Vedic (Tamil, Parashari, sidereal Lahiri) birth-chart search.
Reply with JSON only: {"summary": string, "constraints": Constraint[], "notes": string}.
- summary: one sentence restating what the user wants in astrological terms.
- notes: one or two sentences of caveats (e.g. traits that astrology can't pin down).
Constraint types (use exactly these field names):
- {"type":"lagna_sign","signs":[sign...]}
- {"type":"moon_sign","signs":[sign...]}
- {"type":"nakshatra","nakshatras":[nakshatra...]}  (Moon's star)
- {"type":"planet_in_sign","planet":planet,"signs":[sign...]}
- {"type":"planet_in_house","planet":planet,"houses":[1-12...]}
- {"type":"planet_strong","planet":planet}   (exalted / own / friendly and well placed)
- {"type":"planet_not_weak","planet":planet} (not debilitated, not combust, not in 6/8/12)
- {"type":"house_lord_strong","house":1-12}
- {"type":"house_lord_in_house","house":1-12,"houses":[1-12...]}
- {"type":"aspect","planet":planet,"house":1-12}
- {"type":"conjunction","planets":[planet, planet]}
- {"type":"yoga","yoga":yoga,"present":true|false}
- {"type":"moon_phase","phase":"waxing"|"waning"}
Every constraint also has "weight" (1 nice-to-have, 2 important, 3 essential) and "why" (one plain-English sentence, using Tamil term + English, e.g. "Sukran (Venus) rules the arts").
planet: sun, moon, mars, mercury, jupiter, venus, saturn, rahu, ketu.
sign: Aries, Taurus, Gemini, Cancer, Leo, Virgo, Libra, Scorpio, Sagittarius, Capricorn, Aquarius, Pisces.
nakshatra: ${NAKSHATRAS.map((n) => n[1]).join(", ")}.
yoga: ${Object.keys(YOGA_NAMES).join(", ")}.
Houses: ${HOUSES.slice(1).map((h, i) => `${i + 1} ${h.en} (${h.themes})`).join("; ")}.
Planet significations: ${ORDER.map((g) => `${g}: ${GRAHAS[g].karaka.join(", ")}`).join("; ")}.
Use 3 to 8 constraints. Prefer strength, house and yoga constraints over narrow sign or star choices unless the user names them. Don't add constraints that contradict each other.`;

export async function interpret(text) {
  try {
    const res = await fetch("/_api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system: SYSTEM, prompt: text.slice(0, 3000) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    const parsed = JSON.parse(body.text);
    const constraints = sanitize(parsed.constraints);
    if (!constraints.length) throw new Error("Gemini returned no usable constraints");
    return { source: `Gemini (${body.model || "model"})`, summary: String(parsed.summary || ""), notes: String(parsed.notes || ""), constraints };
  } catch (err) {
    const constraints = interpretOffline(text);
    return {
      source: "offline interpreter",
      summary: constraints.length ? "Matched your words against built-in trait rules." : "No known traits found. Try words like creative, leader, wise, disciplined, wealthy, or name placements like \"Moon in Taurus\".",
      notes: `Gemini wasn't available (${err.message}), so the built-in keyword rules were used.`,
      constraints,
    };
  }
}
