// Festival dates for Chennai checked against temple announcements and
// published Tamil calendars. Run: node apps/naal/test/festivals.test.mjs
process.env.TZ = "Asia/Kolkata";
const { observances } = await import("../site/js/observances.js");

const CHENNAI = { lat: 13.08, lon: 80.27 };
const KNOWN = [
  ["2026-02-01", "thai_poosam"], // TN government holiday list
  ["2026-08-03", "aadi_perukku"],
  ["2026-08-14", "aadi_pooram"], // Srivilliputhur car festival
  ["2026-08-21", "varalakshmi"], // TN/AP revised holiday
  ["2026-08-27", "avani_avittam"], // Yajur Upakarma
  ["2026-08-28", "gayatri_japam"],
  ["2026-11-08", "deepavali"], // TN government holiday
  ["2026-11-24", "karthigai_deepam"], // Tiruvannamalai Maha Deepam
  ["2026-12-20", "vaikunta_ekadasi"], // Srirangam Paramapada Vasal
  ["2027-08-05", "aadi_pooram"],
  ["2028-07-25", "aadi_pooram"],
];

const all = observances("2026-01-01", "2028-12-31", CHENNAI);
const where = (id) => [...all].filter(([, list]) => list.some((e) => e.id === id)).map(([k]) => k).sort();
let failures = 0;
for (const [key, id] of KNOWN) {
  const ok = (all.get(key) || []).some((e) => e.id === id);
  console.log(`${ok ? "ok  " : "FAIL"}  ${id} on ${key}${ok ? "" : ` (computed: ${where(id).join(", ")})`}`);
  if (!ok) failures++;
}
const perYear = (id) => where(id).filter((k) => k.startsWith("2027")).length;
for (const [id, n] of [["ekadasi", [24, 26]], ["pradosham", [24, 26]], ["sankatahara", [12, 13]], ["pongal", [1, 1]]]) {
  const got = perYear(id);
  const ok = got >= n[0] && got <= n[1];
  console.log(`${ok ? "ok  " : "FAIL"}  ${id}: ${got} in 2027`);
  if (!ok) failures++;
}
const { OBSERVANCES } = await import("../site/js/content/observances.js");
const missing = new Set([...all.values()].flat().map((e) => e.id).filter((id) => !OBSERVANCES[id]));
console.log(`${missing.size ? "FAIL" : "ok  "}  every observance has notes${missing.size ? `: missing ${[...missing].join(", ")}` : ""}`);
if (missing.size) failures++;
if (failures) process.exit(1);
