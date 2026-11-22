// Compares planets.js with Swiss Ephemeris (test/reference.json).
// Run: node apps/astroscience/test/planets.test.mjs
import { readFileSync } from "node:fs";
import { GRAHAS, lagnaLongitude, siderealLongitude } from "../site/js/planets.js";

const ref = JSON.parse(readFileSync(new URL("./reference.json", import.meta.url)));
const diff = (a, b) => Math.abs(((a - b + 540) % 360) - 180) * 60;

// Arcminute limits. Sign or nakshatra flips need a body within this much of a
// boundary, which is rare at these sizes.
const LIMIT = { sun: 0.3, moon: 0.75, mercury: 3, venus: 3, mars: 4, jupiter: 4, saturn: 4, rahu: 0.5, ketu: 0.5, lagna: 1 };

let failures = 0;
for (const g of [...GRAHAS, "lagna"]) {
  let worst = 0, sum = 0, retroWrong = 0;
  for (const r of ref) {
    const ours = g === "lagna" ? lagnaLongitude(r.jd, { lat: r.lat, lon: r.lon }) : siderealLongitude(g, r.jd);
    const e = diff(ours, r[g]);
    worst = Math.max(worst, e);
    sum += e;
    if (r[`${g}_speed`] !== undefined && g !== "rahu") {
      const sp = ((siderealLongitude(g, r.jd + 0.5) - siderealLongitude(g, r.jd - 0.5) + 540) % 360) - 180;
      if (Math.abs(r[`${g}_speed`]) > 0.01 && (sp < 0) !== (r[`${g}_speed`] < 0)) retroWrong++;
    }
  }
  const ok = worst <= LIMIT[g] && retroWrong === 0;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${g.padEnd(8)} worst ${worst.toFixed(2)}'  mean ${(sum / ref.length).toFixed(2)}'  limit ${LIMIT[g]}'${retroWrong ? `  retrograde wrong ${retroWrong}x` : ""}`);
}
if (failures) process.exit(1);
