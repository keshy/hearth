// Compares the app's astronomy with Swiss Ephemeris (reference.json, from
// reference.py). Run: node apps/naal/test/astro.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ref = JSON.parse(readFileSync(fileURLToPath(new URL("./reference.json", import.meta.url)), "utf8"));
const astro = await import("../site/js/astro.js");
const P = await import("../site/js/panchang.js");

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};
const arcsec = (a, b) => Math.abs(((a - b + 540) % 360) - 180) * 3600;

const worst = { sun: 0, moon: 0, sunSid: 0, moonSid: 0, ayanamsa: 0 };
for (const s of ref.samples) {
  const jd = astro.jdOf(s.ms);
  worst.sun = Math.max(worst.sun, arcsec(astro.sunLongitude(jd), s.sun));
  worst.moon = Math.max(worst.moon, arcsec(astro.moonLongitude(jd), s.moon));
  worst.sunSid = Math.max(worst.sunSid, arcsec(astro.sunSidereal(jd), s.sunSid));
  worst.moonSid = Math.max(worst.moonSid, arcsec(astro.moonSidereal(jd), s.moonSid));
  worst.ayanamsa = Math.max(worst.ayanamsa, Math.abs(astro.ayanamsa(jd) - s.ayanamsa) * 3600);
}
const limits = { sun: 10, moon: 20, sunSid: 10, moonSid: 20, ayanamsa: 2 };
for (const k of Object.keys(limits)) {
  check(worst[k] < limits[k], `${k}: worst error ${worst[k].toFixed(1)}" (limit ${limits[k]}")`);
}

for (const [name, p] of Object.entries(ref.places)) {
  process.env.TZ = p.tz;
  const place = { lat: p.lat, lon: p.lon };
  let rise = 0, set = 0, tEnd = 0, nEnd = 0, tBad = 0, nBad = 0;
  for (const d of p.days) {
    const day = P.sun(d.key, place);
    rise = Math.max(rise, Math.abs(day.sunrise - d.sunrise) / 1000);
    set = Math.max(set, Math.abs(day.sunset - d.sunset) / 1000);
    const t = P.tithiSpans(day.sunrise, day.sunrise + 1)[0];
    const n = P.nakshatraSpans(day.sunrise, day.sunrise + 1)[0];
    // A different answer is only acceptable when a boundary is within
    // two minutes of sunrise.
    const near = (s) => Math.min(Math.abs(s.start - day.sunrise), Math.abs(s.end - day.sunrise)) < 120000;
    if (t.n !== d.tithi && !near(t)) tBad++;
    else if (t.n === d.tithi) tEnd = Math.max(tEnd, Math.abs(t.end - d.tithiEnd) / 60000);
    if (n.n !== d.nakshatra && !near(n)) nBad++;
    else if (n.n === d.nakshatra) nEnd = Math.max(nEnd, Math.abs(n.end - d.nakshatraEnd) / 60000);
  }
  const days = p.days.length;
  check(rise < 90 && set < 90, `${name}: sunrise within ${rise.toFixed(0)}s, sunset within ${set.toFixed(0)}s over ${days} days`);
  check(tBad === 0, `${name}: thithi at sunrise matches on all ${days} days (${tBad} wrong)`);
  check(tEnd < 1, `${name}: thithi end times within ${tEnd.toFixed(2)} min`);
  check(nBad === 0, `${name}: nakshatram at sunrise matches on all ${days} days (${nBad} wrong)`);
  check(nEnd < 1, `${name}: nakshatram end times within ${nEnd.toFixed(2)} min`);
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
