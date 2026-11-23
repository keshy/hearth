// Chart logic, dasha and reverse search. Run: node apps/astroscience/test/chart.test.mjs
import { analyze, dashaTimeline, houseFrom, nakshatraOf, navamsaOf } from "../site/js/chart.js";
import { interpretOffline, sanitize } from "../site/js/interpret.js";
import { GRAHAS, ORDER, SIGNS } from "../site/js/knowledge.js";
import { CITIES, offsetMinutes, utcToZoned, zonedToUtc } from "../site/js/places.js";
import { scoreChart, search } from "../site/js/search.js";
import { houseScores, reading, storyFacts, tabTakeaway } from "../site/js/reading.js";

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) failures++;
};
const chennai = CITIES.find((c) => c.name === "Chennai");

// Rules tables are self-consistent.
check("every sign lord owns that sign", SIGNS.every((s, i) => GRAHAS[s.lord].own.includes(i)));
check("exaltation and debilitation are opposite", ORDER.every((g) => !GRAHAS[g].exalt || (GRAHAS[g].exalt[0] + 6) % 12 === GRAHAS[g].debil[0]));
check("dasha years total 120", ORDER.reduce((s, g) => s + GRAHAS[g].years, 0) === 120);
check("friend/neutral/enemy lists cover the other planets",
  ORDER.slice(0, 7).every((g) => new Set([...GRAHAS[g].friends, ...GRAHAS[g].neutral, ...GRAHAS[g].enemies].filter((x) => ORDER.slice(0, 7).includes(x))).size === 6));

// Divisions.
check("houseFrom", houseFrom(0, 0) === 1 && houseFrom(11, 0) === 2 && houseFrom(3, 2) === 12);
check("nakshatra of 0° Aries is Ashwini pada 1", nakshatraOf(0.1).name === "Ashwini" && nakshatraOf(0.1).pada === 1);
check("nakshatra of 40° is Rohini pada 1", nakshatraOf(40.01).name === "Rohini" && nakshatraOf(40.01).pada === 1);
check("navamsa: Taurus 0° starts in Capricorn", navamsaOf(30.5) === 9);
check("navamsa: Gemini 0° starts in Libra", navamsaOf(60.5) === 6);

// Time zones, including India's +5:30 and US daylight saving.
const ist = zonedToUtc(1990, 1, 15, 6, 30, "Asia/Kolkata");
check("IST wall time -> UTC", new Date(ist).toISOString() === "1990-01-15T01:00:00.000Z");
const pdt = zonedToUtc(2024, 7, 4, 12, 0, "America/Los_Angeles");
check("PDT wall time -> UTC", new Date(pdt).toISOString() === "2024-07-04T19:00:00.000Z");
check("round trip", JSON.stringify(utcToZoned(pdt, "America/Los_Angeles")) === JSON.stringify({ year: 2024, month: 7, day: 4, hour: 12, minute: 0 }));
check("offset IST", offsetMinutes(ist, "Asia/Kolkata") === 330);

// A chart: houses, lords and aspects tie together.
const ms = zonedToUtc(1990, 1, 15, 6, 30, "Asia/Kolkata");
const c = analyze(ms, chennai);
check("12 houses, each with one lord", c.houses.slice(1).every((h) => GRAHAS[h.lord]));
check("lord ownership totals 12", ORDER.reduce((s, g) => s + c.planets[g].owns.length, 0) === 12);
check("house of each planet matches its sign", ORDER.every((g) => houseFrom(c.lagna.sign, c.planets[g].sign) === c.planets[g].house));
check("Rahu and Ketu opposite", Math.abs(((c.planets.rahu.lon - c.planets.ketu.lon + 540) % 360) - 180) > 179.99);
check("every graha aspects its 7th", ORDER.every((g) => c.planets[g].aspects.includes(((c.planets[g].house + 5) % 12) + 1)));
check("Saturn has three aspects", c.planets.saturn.aspects.length === 3);
check("sunrise lagna ~ Sun's sign", [0, 1, 11].includes(houseFrom(c.lagna.sign, c.planets.sun.sign) - 1) || houseFrom(c.lagna.sign, c.planets.sun.sign) === 12,
  `lagna ${SIGNS[c.lagna.sign].en}, sun ${SIGNS[c.planets.sun.sign].en}`);
check("yogas computed", c.yogas.length >= 10);

// Dasha.
const d = dashaTimeline(ms, c.planets.moon.lon);
const span = (d.periods.at(-1).end - d.periods[0].start) / (365.25 * 86400000);
check("dasha cycle spans 120 years", Math.abs(span - 120) < 1e-6);
check("birth falls in the first dasha", d.periods[0].start <= ms && ms < d.periods[0].end);
check("first dasha lord is the star lord", d.periods[0].lord === d.star.lord);
check("bhuktis tile each dasha", d.periods.every((p) => Math.abs(p.sub.at(-1).end - p.end) < 1 && p.sub[0].start === p.start && p.sub[0].lord === p.lord));

// Interpretation.
const offline = interpretOffline("A wise, kind teacher with a creative streak, Moon in Taurus, no sevvai dosham");
const types = offline.map((x) => x.type + (x.planet ? `:${x.planet}` : "") + (x.yoga ? `:${x.yoga}` : ""));
check("offline interpreter picks Jupiter", types.includes("planet_strong:jupiter"), types.join(", "));
check("offline interpreter picks Venus", types.includes("planet_strong:venus"));
check("offline interpreter reads 'Moon in Taurus'", offline.some((x) => x.type === "planet_in_sign" && x.planet === "moon" && x.signs[0] === 1));
check("offline interpreter avoids Sevvai dosham", offline.some((x) => x.yoga === "sevvai_dosham" && x.present === false));
check("sanitize drops junk", sanitize([{ type: "nope" }, { type: "planet_strong", planet: "pluto" }, { type: "lagna_sign", signs: ["Leo", "Narnia"] }]).length === 1);
check("sanitize maps Tamil names", sanitize([{ type: "planet_strong", planet: "Sukran" }])[0].planet === "venus");

// Search finds moments that satisfy hard constraints.
const constraints = [
  { type: "lagna_sign", signs: [4], weight: 3, why: "" },
  { type: "moon_sign", signs: [1], weight: 3, why: "" },
  { type: "planet_strong", planet: "jupiter", weight: 1, why: "" },
];
const from = zonedToUtc(2027, 1, 1, 0, 0, chennai.tz);
const to = zonedToUtc(2027, 12, 31, 0, 0, chennai.tz);
const t0 = Date.now();
const results = search({ constraints, place: chennai, fromMs: from, toMs: to, top: 5, hours: [6, 22] });
const took = Date.now() - t0;
check("search returns 5 results", results.length === 5, `${took} ms for a year`);
check("search results meet the essentials", results.every((r) => r.lagna === 4 && r.moon === 1));
check("search respects the hour window", results.every((r) => { const h = utcToZoned(r.ms, chennai.tz).hour; return h >= 6 && h < 22; }));
check("results are re-scored consistently", results.every((r) => Math.abs(scoreChart(constraints, analyze(r.ms, chennai)).score - r.score) < 1e-9));
check("search is fast enough", took < 20000, `${took} ms`);

// The reading layer: plain-English takeaways, each with evidence and a link.
{
  const ms = zonedToUtc(1990, 1, 15, 6, 30, chennai.tz);
  const c = analyze(ms, chennai);
  const d = dashaTimeline(ms, c.planets.moon.lon);
  const r = reading(c, d, { name: "Asha", now: zonedToUtc(2026, 11, 23, 12, 0, chennai.tz) });
  const tabs = new Set(["reading", "areas", "planets", "houses", "aspects", "dasha", "yogas"]);
  check("reading has a headline", typeof r.headline === "string" && r.headline.length > 20, r.headline);
  check("reading has 5-7 takeaways", r.takeaways.length >= 5 && r.takeaways.length <= 7, String(r.takeaways.length));
  check("every takeaway has a title, body, evidence and a valid link",
    r.takeaways.every((t) => t.title && t.body.length && t.why.length && tabs.has(t.learn.tab)));
  check("no takeaway text says undefined or NaN",
    !/undefined|NaN|null/.test(JSON.stringify(r.takeaways)));
  check("the current period is found", r.current.maha && r.current.sub && r.current.maha.start <= r.current.sub.start);
  const scores = houseScores(c);
  check("12 life-area scores in 0..10", scores.length === 13 && scores.slice(1).every((a) => a.score >= 0 && a.score <= 10 && a.reasons.length));
  check("strongest and weakest planets differ", GRAHAS[r.strong] && GRAHAS[r.weak] && r.strong !== r.weak, `${r.strong} / ${r.weak}`);
  check("each how-it-works tab has a takeaway line",
    ["planets", "houses", "aspects", "yogas", "dasha"].every((t) => typeof tabTakeaway(t, c, r) === "string" && !/undefined|NaN/.test(tabTakeaway(t, c, r))));
  const facts = JSON.stringify(storyFacts(c, r, "Asha"));
  check("story facts fit the model prompt limit", facts.length < 4000, `${facts.length} bytes`);
  // Many random charts should never produce broken text.
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    const m = zonedToUtc(1950, 1, 1, 0, 0, chennai.tz) + i * 97 * 86400000 + i * 3_600_000 * 7;
    const cc = analyze(m, chennai);
    const rr = reading(cc, dashaTimeline(m, cc.planets.moon.lon), { now: m + 30 * 365.25 * 86400000 });
    const txt = JSON.stringify(rr) + ["planets", "houses", "aspects", "yogas", "dasha"].map((t) => tabTakeaway(t, cc, rr)).join("");
    if (/undefined|NaN|\[object/.test(txt) || JSON.stringify(storyFacts(cc, rr, "")).length >= 4000) bad++;
  }
  check("200 random charts read cleanly", bad === 0, `${bad} bad`);
}

if (failures) process.exit(1);
