import { analyze, compoundRelation, dashaTimeline, dms, explainHouse, explainPlanet, houseFrom } from "./js/chart.js";
import { interpret } from "./js/interpret.js";
import {
  DASHA_ORDER, DIGNITY, GLOSSARY, GRAHAS, HOUSES, HOUSE_GROUPS, NAKSHATRAS, ORDER, SIGNS, label, naturalRelation, ordinal, signLabel,
} from "./js/knowledge.js";
import { CITIES, defaultCity, deviceZone, formatZoned, utcToZoned, zonedToUtc } from "./js/places.js";
import { describe } from "./js/search.js";
import { reading, tabTakeaway, storyFacts, STORY_SYSTEM } from "./js/reading.js";

const $ = (id) => document.getElementById(id);
const YEAR_MS = 365.25 * 86400000;
// Fixed sign positions of the South Indian chart: [col, row].
const CELL = { 11: [0, 0], 0: [1, 0], 1: [2, 0], 2: [3, 0], 3: [3, 1], 4: [3, 2], 5: [3, 3], 6: [2, 3], 7: [1, 3], 8: [0, 3], 9: [0, 2], 10: [0, 1] };

const state = {
  place: defaultCity(),
  mode: "rasi",
  lines: true,
  trines: false,
  scrub: 0,
  selected: null, // {kind: "planet"|"house", id}
  chart: null,
  dasha: null,
  dashaOpen: null,
  tab: "reading",
  group: null,
  query: null,
  reading: null,
  tour: 0,
  areaOrder: "rank",
  stories: {},
};

if (location.hostname.split(".").length > 2) $("portal-link").href = `${location.protocol}//${location.host.split(".").slice(1).join(".")}/`;

// ---------- tiny DOM helpers ----------
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid);
  return n;
};
const svg = (tag, attrs = {}, text) => {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
};
const put = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
const dot = (g) => el("span", { class: "dot", style: `background:${GRAHAS[g].color}`, text: GRAHAS[g].glyph });
const gname = (g) => el("span", { class: "gname" }, dot(g), el("span", {}, GRAHAS[g].ta, el("small", { text: GRAHAS[g].en })));
const meter = (v) => el("div", { class: "meter", title: `${v.toFixed(1)} / 10` }, el("span", { style: `width:${v * 10}%;background-position:${-v}rem 0` }));
const toast = (msg) => {
  const t = el("div", { class: "toast", text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 1800);
};

// ---------- birth inputs ----------
const placeSel = $("f-place");
for (const c of CITIES) placeSel.append(el("option", { value: c.name, text: `${c.name}` }));
placeSel.append(el("option", { value: "__custom", text: "Custom latitude / longitude…" }));
const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : [...new Set(CITIES.map((c) => c.tz))];
for (const z of zones) $("f-tz").append(el("option", { value: z, text: z }));

function setNow() {
  const z = utcToZoned(Date.now(), state.place.tz);
  $("f-date").value = `${z.year}-${String(z.month).padStart(2, "0")}-${String(z.day).padStart(2, "0")}`;
  $("f-time").value = `${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}`;
}

function readPlace() {
  if (placeSel.value !== "__custom") return CITIES.find((c) => c.name === placeSel.value) || state.place;
  const lat = Number($("f-lat").value), lon = Number($("f-lon").value);
  return { name: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, lat, lon, tz: $("f-tz").value || deviceZone() };
}

function birthMs() {
  const [y, mo, d] = $("f-date").value.split("-").map(Number);
  const [h, mi] = $("f-time").value.split(":").map(Number);
  if (!y || Number.isNaN(h)) return null;
  return zonedToUtc(y, mo, d, h, mi, state.place.tz);
}

function fromURL() {
  const q = new URLSearchParams(location.search);
  if (q.get("lat") && q.get("lon")) {
    placeSel.value = "__custom";
    $("f-lat").value = q.get("lat");
    $("f-lon").value = q.get("lon");
    $("f-tz").value = q.get("tz") || deviceZone();
  } else if (q.get("p") && CITIES.some((c) => c.name === q.get("p"))) {
    placeSel.value = q.get("p");
  } else {
    placeSel.value = state.place.name;
  }
  $("custom-place").hidden = placeSel.value !== "__custom";
  state.place = readPlace();
  if (q.get("d") && q.get("t")) {
    $("f-date").value = q.get("d");
    $("f-time").value = q.get("t");
  } else {
    setNow();
  }
  $("f-name").value = q.get("n") || "";
}

function shareURL() {
  const u = new URL(location.href);
  u.search = "";
  u.searchParams.set("d", $("f-date").value);
  u.searchParams.set("t", $("f-time").value);
  if (placeSel.value === "__custom") {
    u.searchParams.set("lat", $("f-lat").value);
    u.searchParams.set("lon", $("f-lon").value);
    u.searchParams.set("tz", $("f-tz").value);
  } else {
    u.searchParams.set("p", placeSel.value);
  }
  if ($("f-name").value) u.searchParams.set("n", $("f-name").value);
  u.hash = location.hash;
  return u;
}

// ---------- compute ----------
function recompute({ keepSelection = true } = {}) {
  const base = birthMs();
  if (base === null) return;
  const ms = base + state.scrub * 60000;
  state.chart = analyze(ms, state.place, { nodeTrines: state.trines });
  state.dasha = dashaTimeline(ms, state.chart.planets.moon.lon);
  state.reading = reading(state.chart, state.dasha, { name: $("f-name").value.trim() });
  state.tour = Math.min(state.tour, state.reading.takeaways.length - 1);
  if (!keepSelection) state.selected = null;
  $("scrub-out").textContent = state.scrub
    ? `${state.scrub > 0 ? "+" : "−"}${Math.floor(Math.abs(state.scrub) / 60)}h ${String(Math.abs(state.scrub) % 60).padStart(2, "0")}m · ${formatZoned(ms, state.place.tz, { timeStyle: "short" })}`
    : "birth time";
  history.replaceState(null, "", shareURL());
  renderAll();
}

function renderAll() {
  drawChart();
  renderChips();
  renderExplain();
  renderTab();
}

// ---------- the chart ----------
function chartSign(g) {
  const p = state.chart.planets[g];
  return state.mode === "rasi" ? p.sign : p.navamsa;
}
function lagnaSign() {
  return state.mode === "rasi" ? state.chart.lagna.sign : state.chart.lagna.navamsa;
}

function drawChart() {
  const c = state.chart;
  const root = $("chart");
  root.replaceChildren();
  const defs = svg("defs");
  for (const g of ORDER) {
    const m = svg("marker", { id: `arrow-${g}`, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
    m.append(svg("path", { d: "M0 0L10 5L0 10z", fill: GRAHAS[g].color }));
    defs.append(m);
  }
  root.append(defs);
  const lag = lagnaSign();
  const sel = state.selected || tourStep()?.highlight || null;
  const aspected = new Set();
  if (sel?.kind === "planet" && state.mode === "rasi") for (const h of c.planets[sel.id].aspects) aspected.add((lag + h - 1) % 12);
  if (state.group) for (const h of HOUSE_GROUPS.find((x) => x.id === state.group).houses) aspected.add((lag + h - 1) % 12);

  for (let s = 0; s < 12; s++) {
    const [col, row] = CELL[s];
    const x = col * 100, y = row * 100;
    const house = houseFrom(lag, s);
    const isSel = sel?.kind === "house" && sel.id === house && state.mode === "rasi";
    const g = svg("g");
    const rect = svg("rect", { x: x + 1, y: y + 1, width: 98, height: 98, rx: 4, class: `cell${isSel ? " sel" : ""}${aspected.has(s) ? " aspected" : ""}` });
    rect.addEventListener("click", () => select({ kind: "house", id: house }));
    g.append(rect);
    rect.append(svg("title", {}, `${signLabel(s)} · house ${house}: ${HOUSES[house].en}`));
    g.append(svg("text", { x: x + 6, y: y + 13, class: "sign" }, `${SIGNS[s].glyph} ${SIGNS[s].ta}`));
    g.append(svg("text", { x: x + 94, y: y + 13, class: "hno", "text-anchor": "end" }, String(house)));
    if (s === lag) {
      g.append(svg("line", { x1: x + 1, y1: y + 22, x2: x + 22, y2: y + 1, class: "asc" }));
      g.append(svg("text", { x: x + 6, y: y + 94, class: "asc-label" }, "LAGNA"));
    }
    const here = ORDER.filter((p) => chartSign(p) === s);
    here.forEach((p, i) => {
      const colIdx = here.length > 4 ? i % 2 : 0;
      const rowIdx = here.length > 4 ? Math.floor(i / 2) : i;
      const t = svg("text", {
        x: x + 8 + colIdx * 46, y: y + 32 + rowIdx * 15,
        class: `pl${sel?.kind === "planet" && sel.id === p ? " sel" : ""}`, fill: GRAHAS[p].color,
      });
      t.append(svg("tspan", {}, GRAHAS[p].abbr));
      if (c.planets[p].retro) t.append(svg("tspan", { "font-size": 8, dy: -4 }, "R"));
      if (here.length <= 4) t.append(svg("tspan", { class: "deg", dx: 3, dy: c.planets[p].retro ? 4 : 0 }, state.mode === "rasi" ? dms(c.planets[p].lon) : ""));
      t.append(svg("title", {}, `${label(p)} · ${dms(c.planets[p].lon)} ${SIGNS[c.planets[p].sign].en}`));
      t.addEventListener("click", (e) => { e.stopPropagation(); select({ kind: "planet", id: p }); });
      g.append(t);
    });
    root.append(g);
  }

  const name = $("f-name").value.trim();
  root.append(svg("text", { x: 200, y: 172, "text-anchor": "middle", class: "center-title" }, state.mode === "rasi" ? "Rasi" : "Navamsam"));
  root.append(svg("text", { x: 200, y: 192, "text-anchor": "middle", class: "center-sub" }, name || "this moment"));
  root.append(svg("text", { x: 200, y: 208, "text-anchor": "middle", class: "center-sub" }, formatZoned(c.ms, state.place.tz)));
  root.append(svg("text", { x: 200, y: 224, "text-anchor": "middle", class: "center-sub" }, state.place.name));
  root.append(svg("text", { x: 200, y: 244, "text-anchor": "middle", class: "center-sub", style: "fill: var(--gold)" },
    `Lagna ${SIGNS[c.lagna.sign].en} · Moon ${SIGNS[c.planets.moon.sign].en} · ${c.star.name}`));

  if (state.lines && sel?.kind === "planet" && state.mode === "rasi") {
    const p = c.planets[sel.id];
    const [c0, r0] = CELL[p.sign];
    const from = [c0 * 100 + 50, r0 * 100 + 50];
    for (const h of p.aspects) {
      const s = (lag + h - 1) % 12;
      const [c1, r1] = CELL[s];
      const to = [c1 * 100 + 50, r1 * 100 + 50];
      const mx = (from[0] + to[0]) / 2 + (200 - (from[0] + to[0]) / 2) * 0.35;
      const my = (from[1] + to[1]) / 2 + (200 - (from[1] + to[1]) / 2) * 0.35;
      root.append(svg("path", { d: `M${from[0]} ${from[1]} Q${mx} ${my} ${to[0]} ${to[1]}`, class: "ray", stroke: GRAHAS[sel.id].color, "marker-end": `url(#arrow-${sel.id})` }));
    }
  }
}

function renderChips() {
  $("chips").replaceChildren(...ORDER.map((g) => el("button", {
    type: "button", class: "chip", "aria-pressed": String(state.selected?.kind === "planet" && state.selected.id === g),
    onclick: () => select({ kind: "planet", id: g }),
  }, dot(g), `${GRAHAS[g].ta} · ${GRAHAS[g].en}`)));
}

function select(s) {
  const same = state.selected && s && state.selected.kind === s.kind && state.selected.id === s.id;
  state.selected = same ? null : s;
  state.group = null;
  renderAll();
  if (state.selected && window.innerWidth < 880) document.querySelector(".explain").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- explain panel ----------
function tourStep() {
  return state.selected ? null : state.reading?.takeaways[state.tour];
}

function whyChips(t) {
  return el("div", { class: "why" }, el("span", { class: "why-label", text: "Because" }), t.why.filter(Boolean).map((w) => el("span", { class: "why-chip", text: w })));
}

function learnButton(t) {
  return el("button", {
    type: "button", class: "ghost small learn",
    onclick: () => {
      showTab(t.learn.tab);
      if (t.learn.select) select(t.learn.select);
      document.querySelector(".tabs").scrollIntoView({ behavior: "smooth", block: "start" });
    },
  }, `${t.learn.label} →`);
}

function renderTour() {
  const r = state.reading;
  const t = r.takeaways[state.tour];
  const n = r.takeaways.length;
  const name = $("f-name").value.trim();
  $("ex-kicker").textContent = `${name ? `${name}'s chart` : "This chart"} · step ${state.tour + 1} of ${n} · ${t.kicker}`;
  $("ex-title").textContent = t.title;
  const go = (i) => { state.tour = Math.max(0, Math.min(n - 1, i)); drawChart(); renderExplain(); };
  put($("ex-body"),
    t.body.map((p) => el("p", { text: p })),
    whyChips(t),
    el("div", { class: "tour-nav" },
      el("button", { type: "button", class: "ghost small", disabled: state.tour === 0 ? "" : null, onclick: () => go(state.tour - 1) }, "← Back"),
      el("div", { class: "tour-dots", role: "tablist", "aria-label": "Steps" }, r.takeaways.map((x, i) => el("button", {
        type: "button", class: "tour-dot", "aria-label": `Step ${i + 1}: ${x.kicker}`, "aria-current": i === state.tour ? "step" : null, onclick: () => go(i),
      }))),
      state.tour < n - 1
        ? el("button", { type: "button", class: "primary small", onclick: () => go(state.tour + 1) }, "Next →")
        : el("button", { type: "button", class: "primary small", onclick: () => { showTab("reading"); document.querySelector(".tabs").scrollIntoView({ behavior: "smooth" }); } }, "Full reading ↓")),
    el("p", { class: "note tour-hint" }, learnButton(t), " The highlighted part of the chart is what this step is about. Tap any planet or house to explore it instead."),
  );
}

function currentPeriod(ms = Date.now()) {
  const maha = state.dasha.periods.find((p) => p.start <= ms && ms < p.end);
  const sub = maha?.sub.find((p) => p.start <= ms && ms < p.end);
  return { maha, sub };
}

function fact(k, v, s, go) {
  return el("div", { class: "fact", "data-go": go ? "1" : null, onclick: go || null }, el("div", { class: "k", text: k }), el("div", { class: "v", text: v }), s ? el("div", { class: "s", text: s }) : null);
}

function renderExplain() {
  const c = state.chart;
  const sel = state.selected;
  const body = $("ex-body");
  $("ex-clear").hidden = !sel;
  if (sel?.kind === "planet") {
    const p = c.planets[sel.id];
    const g = GRAHAS[sel.id];
    $("ex-kicker").textContent = `Graha · ${g.natureNote}`;
    $("ex-title").textContent = `${g.glyph} ${g.ta} = ${g.en}${g.alt ? ` (also ${g.alt})` : ""}`;
    put(body, 
      el("div", { class: "facts" },
        fact("Sign", SIGNS[p.sign].en, SIGNS[p.sign].ta),
        fact("House", ordinal(p.house), HOUSES[p.house].en),
        fact("Strength", `${p.strength.score.toFixed(1)} / 10`, DIGNITY[p.dignity].en)),
      meter(p.strength.score),
      el("ul", {}, explainPlanet(c, sel.id).map((l) => el("li", { text: l }))),
      el("p", { class: "note" }, `Signifies: ${g.karaka.join(", ")}. Traits: ${g.traits}.`),
      g.note ? el("p", { class: "note", text: g.note }) : null,
      el("p", { class: "note", text: `Strength recipe: ${p.strength.parts.map(([k, v]) => `${k} ${v >= 0 ? "+" : ""}${v}`).join(", ")}.` }),
    );
    return;
  }
  if (sel?.kind === "house") {
    const H = c.houses[sel.id];
    $("ex-kicker").textContent = `Veedu (house) ${sel.id} · ${HOUSES[sel.id].ta}`;
    $("ex-title").textContent = `${ordinal(sel.id)} house: ${HOUSES[sel.id].en}`;
    put(body, 
      el("div", { class: "facts" },
        fact("Sign", SIGNS[H.sign].en, SIGNS[H.sign].ta),
        fact("Lord (aadhipathi)", GRAHAS[H.lord].en, `${GRAHAS[H.lord].ta}, sits in the ${ordinal(c.planets[H.lord].house)}`, () => select({ kind: "planet", id: H.lord })),
        fact("Groups", HOUSE_GROUPS.filter((gr) => gr.houses.includes(sel.id)).map((gr) => gr.ta).join(", ") || "—")),
      el("ul", {}, explainHouse(c, sel.id).map((l) => el("li", { text: l }))),
    );
    return;
  }
  renderTour();
}
$("ex-clear").addEventListener("click", () => select(null));
$("ex-clear").textContent = "Back to the reading";

// ---------- tabs ----------
function showTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  for (const p of document.querySelectorAll(".panel")) p.hidden = p.id !== `p-${tab}`;
  renderTab();
}
for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => showTab(b.dataset.tab));

function renderTab() {
  const fn = { reading: renderReading, areas: renderAreas, planets: renderPlanets, houses: renderHouses, aspects: renderAspects, dasha: renderDasha, yogas: renderYogas, cheat: renderCheat, find: renderFind }[state.tab];
  fn();
  const line = tabTakeaway(state.tab, state.chart, state.reading);
  if (line) $(`p-${state.tab}`).prepend(el("p", { class: "takeaway", text: line }));
}

// ---------- your reading ----------
function renderReading() {
  const r = state.reading;
  const name = $("f-name").value.trim();
  const cards = r.takeaways.map((t, i) => el("article", { class: "take" },
    el("p", { class: "kicker", text: t.kicker }),
    el("h3", { text: t.title }),
    t.body.map((p) => el("p", { text: p })),
    whyChips(t),
    el("div", { class: "take-actions" },
      el("button", { type: "button", class: "ghost small", onclick: () => { state.selected = null; state.tour = i; renderAll(); document.querySelector(".workbench").scrollIntoView({ behavior: "smooth" }); } }, "Show on the chart"),
      learnButton(t))));
  $("p-reading").replaceChildren(
    el("div", { class: "card reading-head" },
      el("p", { class: "kicker", text: name ? `${name}'s reading` : "The reading" }),
      el("h2", { text: r.headline }),
      el("p", { class: "lede", text: "Each card below is one thing this chart says, the evidence for it (\"because\"), and where in the app the rule is explained. Start at the top; it goes from who you are to what's happening now." }),
      storyBlock()),
    el("div", { class: "takes" }, cards));
}

function chartKey() {
  return `${state.chart.ms}|${state.place.name}|${$("f-name").value.trim()}`;
}

function storyBlock() {
  const key = chartKey();
  const story = state.stories[key];
  const box = el("div", { class: "story", id: "story" });
  if (story?.paragraphs) {
    box.append(el("h3", { text: `✨ ${story.title || "Your chart as a story"}` }), story.paragraphs.map((p) => el("p", { text: p })),
      el("p", { class: "note", text: `Written by ${story.model || "Gemini"} from the facts above.` }));
    return box;
  }
  const btn = el("button", { type: "button", class: "primary", disabled: story?.loading ? "" : null }, story?.loading ? "Writing…" : "✨ Tell it as a story");
  btn.addEventListener("click", () => tellStory(key));
  box.append(btn, el("span", { class: "note", text: story?.error ? ` ${story.error}` : " Gemini retells the cards above in plain words. Needs the home server's Gemini." }));
  return box;
}

async function tellStory(key) {
  state.stories[key] = { loading: true };
  if (state.tab === "reading") renderTab();
  try {
    const facts = storyFacts(state.chart, state.reading, $("f-name").value.trim());
    const res = await fetch("/_api/llm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system: STORY_SYSTEM, prompt: JSON.stringify(facts) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    const out = JSON.parse(body.text);
    if (!Array.isArray(out.paragraphs) || !out.paragraphs.length) throw new Error("the reply had no paragraphs");
    state.stories[key] = { title: String(out.title || ""), paragraphs: out.paragraphs.map(String).slice(0, 6), model: body.model };
  } catch (err) {
    state.stories[key] = { error: `Couldn't write the story (${err.message}). The cards above say the same thing.` };
  }
  if (state.tab === "reading") renderTab();
}

function renderAreas() {
  const c = state.chart;
  const r = state.reading;
  const rows = r.scores.slice(1).slice();
  if (state.areaOrder === "rank") rows.sort((a, b) => b.score - a.score);
  const sel = state.selected?.kind === "house" ? state.selected.id : null;
  const items = rows.map((a) => el("button", {
    type: "button", class: `area ${a.tone}${sel === a.house ? " sel" : ""}`, onclick: () => select({ kind: "house", id: a.house }),
  },
  el("div", { class: "area-top" },
    el("span", { class: "area-n", text: String(a.house) }),
    el("span", { class: "area-name" }, el("b", { text: HOUSES[a.house].en }), el("small", { text: ` ${HOUSES[a.house].ta}` })),
    el("span", { class: `verdict ${a.tone}`, text: a.verdict })),
  el("div", { class: "area-themes", text: HOUSES[a.house].themes }),
  el("div", { class: "area-bar" }, el("span", { style: `width:${a.score * 10}%` })),
  el("ul", { class: "area-why" }, a.reasons.map(([t, v]) => el("li", { class: v > 0 ? "up" : v < 0 ? "down" : null, text: t })))));
  const seg = el("div", { class: "seg", role: "group", "aria-label": "Order" },
    ["rank", "house"].map((o) => el("button", { type: "button", "aria-pressed": String(state.areaOrder === o), onclick: () => { state.areaOrder = o; renderTab(); } }, o === "rank" ? "Strongest first" : "House order")));
  $("p-areas").replaceChildren(el("div", { class: "card" },
    el("div", { class: "card-title" }, el("h2", { text: "Life areas: what comes easily, what takes work" }), seg),
    el("p", { class: "lede", text: `Every house is a life area. Its score here (0–10) is a teaching guide, not a classical formula: it starts at 5, then rises or falls with the house lord's strength and placement, planets sitting in the house (benefics help; malefics hurt, except in the growth houses 3, 6, 10 and 11) and planets looking at it. Tap one to see it on the chart.` }),
    el("div", { class: "areas" }, items)));
}

function renderPlanets() {
  const c = state.chart;
  const rows = ORDER.map((g) => {
    const p = c.planets[g];
    const sel = state.selected?.kind === "planet" && state.selected.id === g;
    return el("tr", { class: sel ? "sel" : null, onclick: () => select({ kind: "planet", id: g }) },
      el("td", {}, gname(g)),
      el("td", {}, SIGNS[p.sign].en, el("small", { class: "note", text: ` ${SIGNS[p.sign].ta}` })),
      el("td", { class: "mono", text: dms(p.lon) }),
      el("td", { text: ordinal(p.house) }),
      el("td", {}, `${p.nakshatra.name} ${p.nakshatra.pada}`, el("small", { class: "note", text: ` · ${GRAHAS[p.nakshatra.lord].en}` })),
      el("td", {}, DIGNITY[p.dignity].en,
        p.retro ? el("span", { class: "badge warn", title: "Vakram (retrograde)", text: "R" }) : null,
        p.combust ? el("span", { class: "badge bad", title: "Asthangam (combust)", text: "C" }) : null),
      el("td", { style: "min-width:6rem" }, meter(p.strength.score)),
      el("td", { text: p.owns.length ? p.owns.map(ordinal).join(", ") : "—" }));
  });
  $("p-planets").replaceChildren(el("div", { class: "card" },
    el("h2", { text: "The nine grahas" }),
    el("p", { class: "lede", text: "Each graha has a sign (rasi), a house (veedu) counted from the lagnam, a star (nakshatram), and a dignity: how comfortable it is in that sign. R = retrograde (vakram), C = combust (asthangam, too close to the Sun). Tap a row." }),
    el("div", { class: "scroll" }, el("table", {},
      el("thead", {}, el("tr", {}, ...["Graha", "Sign", "Degree", "House", "Star · pada", "Dignity", "Strength", "Rules houses"].map((h) => el("th", { text: h })))),
      el("tbody", {}, rows)))));
}

function renderHouses() {
  const c = state.chart;
  const cards = c.houses.slice(1).map((H) => el("button", {
    type: "button", class: `house${state.selected?.kind === "house" && state.selected.id === H.house ? " sel" : ""}`,
    onclick: () => select({ kind: "house", id: H.house }),
  },
  el("div", { class: "n", text: `${H.house} · ${SIGNS[H.sign].en}` }),
  el("div", { class: "t", text: HOUSES[H.house].en }),
  el("div", { class: "ta", text: HOUSES[H.house].ta }),
  el("div", { class: "lord" }, `Lord ${GRAHAS[H.lord].en} → `, el("b", { text: `${ordinal(c.planets[H.lord].house)}` })),
  H.occupants.length ? el("div", { class: "note", text: `Here: ${H.occupants.map((g) => GRAHAS[g].en).join(", ")}` }) : null));

  const groups = el("div", { class: "groups" }, HOUSE_GROUPS.map((gr) => el("button", {
    type: "button", class: "group", "aria-pressed": String(state.group === gr.id),
    onclick: () => { state.group = state.group === gr.id ? null : gr.id; state.selected = null; renderAll(); },
  }, el("b", { text: `${gr.ta}: ${gr.en}` }), ` · ${gr.houses.join(", ")}`, el("div", { class: "note", text: gr.why }))));

  $("p-houses").replaceChildren(
    el("div", { class: "grid2" },
      el("div", { class: "card" },
        el("h2", { text: "Veedu: the 12 houses" }),
        el("p", { class: "lede", text: "Houses are counted from the lagnam: whichever sign is rising becomes house 1, the next sign house 2, and so on. Each house's lord (aadhipathi) is the ruler of its sign. Where that lord sits tells you how the house's story plays out." }),
        groups,
        el("div", { class: "house-grid" }, cards)),
      el("div", { class: "card" },
        el("h2", { text: "Aadhipathyam: lordship flow" }),
        el("p", { class: "lede", text: "Each arrow runs from a house to the house where its lord sits. Arrows into angles (1, 4, 7, 10) and trines (5, 9) are strengths; arrows into 6, 8 and 12 are where effort goes." }),
        flowWheel(c))));
}

function flowWheel(c) {
  const root = svg("svg", { id: "flow", viewBox: "0 0 360 360" });
  const defs = svg("defs");
  for (const g of ORDER) {
    const m = svg("marker", { id: `fa-${g}`, viewBox: "0 0 10 10", refX: 10, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto" });
    m.append(svg("path", { d: "M0 0L10 5L0 10z", fill: GRAHAS[g].color }));
    defs.append(m);
  }
  root.append(defs);
  const R = 140, cx = 180, cy = 180;
  const pos = (h) => {
    const a = (-90 + (h - 1) * 30) * Math.PI / 180;
    return [cx + R * Math.cos(a), cy + R * Math.sin(a)];
  };
  const selHouse = state.selected?.kind === "house" ? state.selected.id : null;
  for (let h = 1; h <= 12; h++) {
    const lord = c.houses[h].lord;
    const to = c.planets[lord].house;
    const [x0, y0] = pos(h);
    const [x1, y1] = pos(to);
    const faded = selHouse && selHouse !== h;
    if (to === h) {
      root.append(svg("circle", { cx: x0 + (x0 - cx) * 0.18, cy: y0 + (y0 - cy) * 0.18, r: 9, fill: "none", stroke: GRAHAS[lord].color, "stroke-width": 2, opacity: faded ? 0.15 : 0.9 }));
      continue;
    }
    const shrink = 20 / Math.hypot(x1 - x0, y1 - y0);
    const ex = x1 - (x1 - x0) * shrink, ey = y1 - (y1 - y0) * shrink;
    root.append(svg("path", {
      d: `M${x0} ${y0} Q${cx + (x0 + x1 - 2 * cx) * 0.15} ${cy + (y0 + y1 - 2 * cy) * 0.15} ${ex} ${ey}`,
      fill: "none", stroke: GRAHAS[lord].color, "stroke-width": selHouse === h ? 3 : 1.8, opacity: faded ? 0.12 : 0.85, "marker-end": `url(#fa-${lord})`,
    }));
  }
  for (let h = 1; h <= 12; h++) {
    const [x, y] = pos(h);
    const g = svg("g", { style: "cursor:pointer" });
    g.addEventListener("click", () => select({ kind: "house", id: h }));
    g.append(svg("circle", { cx: x, cy: y, r: 17, class: `node${selHouse === h ? " sel" : ""}` }));
    g.append(svg("text", { x, y: y + 1, "text-anchor": "middle" }, String(h)));
    g.append(svg("text", { x, y: y + 11, "text-anchor": "middle", class: "sub" }, GRAHAS[c.houses[h].lord].abbr));
    g.append(svg("title", {}, `House ${h} (${HOUSES[h].en}): lord ${GRAHAS[c.houses[h].lord].en} sits in house ${c.planets[c.houses[h].lord].house}`));
    root.append(g);
  }
  root.append(svg("text", { x: cx, y: cy - 4, "text-anchor": "middle" }, "house → its lord's house"));
  root.append(svg("text", { x: cx, y: cy + 12, "text-anchor": "middle", class: "sub" }, "tap a number"));
  return root;
}

function renderAspects() {
  const c = state.chart;
  const head = el("tr", {}, el("th", { text: "Graha looks at →" }), ...Array.from({ length: 12 }, (_, i) => el("th", { text: String(i + 1) })));
  const rows = ORDER.map((g) => {
    const p = c.planets[g];
    return el("tr", { onclick: () => select({ kind: "planet", id: g }), class: state.selected?.id === g ? "sel" : null },
      el("td", {}, gname(g)),
      ...Array.from({ length: 12 }, (_, i) => {
        const h = i + 1;
        if (p.house === h) return el("td", { title: "sits here", text: "●", style: `color:${GRAHAS[g].color}` });
        const on = p.aspects.includes(h);
        return el("td", { class: on ? "on" : null }, on ? "◉" : "", on && c.houses[h].occupants.length ? el("span", { class: "occ", text: c.houses[h].occupants.map((x) => GRAHAS[x].abbr).join(" ") }) : null);
      }));
  });
  const mutual = [];
  for (const a of ORDER) for (const b of ORDER) {
    if (a >= b) continue;
    const ab = c.planets[a].aspects.includes(c.planets[b].house);
    const ba = c.planets[b].aspects.includes(c.planets[a].house);
    if (ab && ba) mutual.push(`${GRAHAS[a].en} ⇄ ${GRAHAS[b].en}`);
  }
  $("p-aspects").replaceChildren(
    el("div", { class: "card" },
      el("h2", { text: "Paarvai: who looks at whom" }),
      el("p", { class: "lede", text: "Counting the graha's own house as 1, every graha looks at the 7th house from itself. Three have extra 'special' glances: Sevvai (Mars) the 4th and 8th, Guru (Jupiter) the 5th and 9th, Sani (Saturn) the 3rd and 10th. A glance from a benefic (Jupiter, Venus, waxing Moon, Mercury) protects; from a malefic it pressures. ● = sits there, ◉ = looks there." }),
      el("div", { class: "scroll" }, el("table", { class: "matrix" }, el("thead", {}, head), el("tbody", {}, rows))),
      el("p", { class: "note", text: mutual.length ? `Mutual aspects (each looks at the other): ${mutual.join(", ")}.` : "No mutual aspects in this chart." })),
    el("div", { class: "card" },
      el("h2", { text: "The glance rules, drawn" }),
      el("p", { class: "lede", text: "Each wheel puts the graha in house 1 (top) and shows where its glances land." }),
      el("div", { class: "mini-wheels" }, ORDER.map((g) => miniWheel(g)))));
}

function miniWheel(g) {
  const s = svg("svg", { viewBox: "0 0 120 120" });
  const pos = (h, r = 46) => { const a = (-90 + (h - 1) * 30) * Math.PI / 180; return [60 + r * Math.cos(a), 60 + r * Math.sin(a)]; };
  const offs = state.trines && (g === "rahu" || g === "ketu") ? [5, 7, 9] : GRAHAS[g].aspects;
  for (let h = 1; h <= 12; h++) {
    const [x, y] = pos(h);
    const on = offs.includes(h);
    s.append(svg("circle", { cx: x, cy: y, r: 8, style: `fill:${h === 1 ? GRAHAS[g].color : on ? "var(--gold-mid)" : "var(--track)"};stroke:var(--line)` }));
    s.append(svg("text", { x, y: y + 3, "text-anchor": "middle", "font-size": 8, style: `fill:${h === 1 ? "#fff" : "var(--ink)"}` }, String(h)));
    if (on) {
      const [x1, y1] = pos(h, 36);
      const [x0, y0] = pos(1, 36);
      s.append(svg("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: GRAHAS[g].color, "stroke-width": 1.5, opacity: 0.8 }));
    }
  }
  return el("div", { class: "mini" }, s, el("p", {}, el("b", { text: GRAHAS[g].ta }), ` (${GRAHAS[g].en}) · ${offs.map(ordinal).join(", ")}`));
}

function renderDasha() {
  const d = state.dasha;
  const birth = state.chart.ms;
  const total = d.periods.at(-1).end - d.periods[0].start;
  const now = Date.now();
  const bar = el("div", { class: "dasha-bar" }, d.periods.map((p, i) => el("button", {
    type: "button", style: `flex:${(p.end - p.start) / total};background:${GRAHAS[p.lord].color}`, "aria-pressed": String(state.dashaOpen === i),
    title: `${GRAHAS[p.lord].en} dasa: ${year(p.start)}–${year(p.end)}`, onclick: () => { state.dashaOpen = state.dashaOpen === i ? null : i; renderDasha(); },
  }, GRAHAS[p.lord].abbr)));
  if (now > d.periods[0].start && now < d.periods.at(-1).end) bar.append(el("span", { class: "now", style: `left:${((now - d.periods[0].start) / total) * 100}%` }));
  const age = (ms) => Math.max(0, (ms - birth) / YEAR_MS);
  const list = el("div", { class: "periods" }, d.periods.map((p, i) => {
    const current = p.start <= now && now < p.end;
    const row = el("button", { type: "button", class: `period${current ? " current" : ""}`, onclick: () => { state.dashaOpen = state.dashaOpen === i ? null : i; renderDasha(); } },
      el("span", { class: "sw", style: `background:${GRAHAS[p.lord].color}` }),
      el("span", {}, el("b", { text: `${GRAHAS[p.lord].ta} dasa` }), ` · ${GRAHAS[p.lord].en}, ${GRAHAS[p.lord].years} yrs`, el("br"),
        el("small", { text: `${fmtDate(Math.max(p.start, birth))} → ${fmtDate(p.end)} · age ${age(Math.max(p.start, birth)).toFixed(1)}–${age(p.end).toFixed(1)}` })),
      el("span", { class: "note", text: current ? "now" : state.dashaOpen === i ? "▲" : "▼" }));
    const wrap = el("div", {}, row);
    if (state.dashaOpen === i) wrap.append(dashaDetail(p));
    return wrap;
  }));
  $("p-dasha").replaceChildren(el("div", { class: "card" },
    el("h2", { text: "Vimshottari dasa: the 120-year clock" }),
    el("p", { class: "lede", text: `Life is divided into nine planetary periods in a fixed order (Ketu → Sukran → Suriyan → Chandran → Sevvai → Rahu → Guru → Sani → Budhan) that add up to 120 years. Where you start depends on the Moon's star at birth: ${d.star.name} is ruled by ${label(d.star.lord)}, and the Moon had covered ${(d.star.fraction * 100).toFixed(0)}% of it, so ${d.balanceYears.toFixed(2)} years of ${GRAHAS[d.star.lord].en} dasa were left (the 'balance of dasa' in every Tamil horoscope).` }),
    bar, list));
}

function dashaDetail(p) {
  const c = state.chart;
  const lp = c.planets[p.lord];
  const now = Date.now();
  return el("div", { class: "interp" },
    el("p", { text: `During ${GRAHAS[p.lord].en}'s period, its houses come alive. In this chart it sits in the ${ordinal(lp.house)} (${HOUSES[lp.house].en.toLowerCase()})${lp.owns.length ? ` and rules the ${lp.owns.map(ordinal).join(" & ")} (${lp.owns.map((h) => HOUSES[h].short).join(", ")})` : ""}. Its dignity is ${DIGNITY[lp.dignity].en.toLowerCase()} (${lp.strength.score.toFixed(1)}/10).` }),
    el("p", { class: "note", text: "Bhuktis (sub-periods) run in the same order, starting with the dasa lord itself; each is sized by that graha's share of 120 years." }),
    el("table", {}, el("tbody", {}, p.sub.map((s) => el("tr", { class: s.start <= now && now < s.end ? "sel" : null },
      el("td", {}, gname(s.lord)), el("td", { class: "mono", text: `${fmtDate(s.start)} → ${fmtDate(s.end)}` }),
      el("td", { class: "note", text: `${((s.end - s.start) / YEAR_MS * 12).toFixed(1)} months` }))))));
}
const year = (ms) => new Date(ms).getUTCFullYear();
const fmtDate = (ms) => formatZoned(ms, state.place.tz, { dateStyle: "medium" });

function renderYogas() {
  const c = state.chart;
  const card = (y) => el("div", { class: `yoga${y.present ? " present" : ""}` },
    el("h3", { text: `${y.present ? "✦ " : ""}${y.name}` }), el("div", { class: "en", text: y.en }), el("p", { text: y.why }),
    el("div", { class: "chips" }, (y.involves || []).filter((g) => GRAHAS[g]).map((g) => el("button", { type: "button", class: "chip", onclick: () => select({ kind: "planet", id: g }) }, dot(g), GRAHAS[g].en))));
  const present = c.yogas.filter((y) => y.present);
  const absent = c.yogas.filter((y) => !y.present);
  $("p-yogas").replaceChildren(el("div", { class: "card" },
    el("h2", { text: "Yogams & doshams" }),
    el("p", { class: "lede", text: "A yogam is a recognised pattern: a planet in a certain relation to another, to the lagnam or to the Moon. Each card shows the rule and whether this chart meets it." }),
    el("div", { class: "yogas" }, present.map(card)),
    el("details", {}, el("summary", { text: `Not in this chart (${absent.length})` }), el("div", { class: "yogas" }, absent.map(card)))));
}

// ---------- cheat sheet ----------
function renderCheat() {
  const grahaRows = ORDER.map((g) => {
    const G = GRAHAS[g];
    return el("tr", { onclick: () => select({ kind: "planet", id: g }) },
      el("td", {}, gname(g)),
      el("td", { text: G.nature }),
      el("td", { text: G.own.length ? G.own.map((s) => SIGNS[s].en).join(", ") : "—" }),
      el("td", { text: G.exalt ? `${SIGNS[G.exalt[0]].en} ${G.exalt[1]}°` : "—" }),
      el("td", { text: G.debil ? `${SIGNS[G.debil[0]].en} ${G.debil[1]}°` : "—" }),
      el("td", { text: G.mt ? `${SIGNS[G.mt[0]].en} ${G.mt[1]}–${G.mt[2]}°` : "—" }),
      el("td", { text: G.aspects.map(ordinal).join(", ") }),
      el("td", { text: String(G.years) }),
      el("td", { text: G.karaka.slice(0, 3).join(", ") }));
  });

  const relNote = el("div", { class: "relnote note", text: "Hover or tap a cell: row graha's attitude toward column graha. Notice it isn't always mutual." });
  const relHead = el("tr", {}, el("th", { text: "treats →" }), ...ORDER.map((g) => el("th", { title: GRAHAS[g].en, text: GRAHAS[g].abbr })));
  const relRows = ORDER.map((a) => el("tr", {}, el("td", {}, gname(a)), ...ORDER.map((b) => {
    if (a === b) return el("td", { class: "rel-self", text: "—" });
    const r = naturalRelation(a, b);
    const back = naturalRelation(b, a);
    const say = () => { relNote.textContent = `${label(a)} treats ${label(b)} as a ${r}. ${label(b)} treats ${label(a)} as a ${back}.${r !== back ? " (Not mutual!)" : ""}`; };
    return el("td", { class: `rel-cell rel-${r}`, text: r[0].toUpperCase(), onmouseenter: say, onclick: say });
  })));

  const c = state.chart;
  const signsBox = SIGNS.map((s, i) => {
    const tags = [];
    for (const g of ORDER) {
      const G = GRAHAS[g];
      if (G.exalt && G.exalt[0] === i) tags.push(el("span", { class: "tag ex", text: `${G.abbr} exalted` }));
      if (G.debil && G.debil[0] === i) tags.push(el("span", { class: "tag de", text: `${G.abbr} debilitated` }));
      if (G.own.includes(i)) tags.push(el("span", { class: "tag own", text: `${G.abbr} own` }));
    }
    return el("div", {}, el("b", { text: `${s.glyph} ${s.ta}` }), ` · ${s.en}`, el("div", { class: "note", text: `Lord ${GRAHAS[s.lord].en} · ${s.element} · ${s.mode}` }), tags);
  });

  const temp = el("div", { class: "relnote" });
  const sample = ["sun", "moon", "mars", "mercury", "jupiter", "venus", "saturn"].map((a) => {
    const lord = SIGNS[c.planets[a].sign].lord;
    if (lord === a) return null;
    const rel = compoundRelation(a, lord, Object.fromEntries(ORDER.map((g) => [g, c.planets[g].sign])));
    return el("li", { text: `${GRAHAS[a].en} in ${SIGNS[c.planets[a].sign].en} (lord ${GRAHAS[lord].en}): natural ${rel.natural} + temporary ${rel.temporary} = ${DIGNITY[rel.compound].en.toLowerCase()}` });
  }).filter(Boolean);
  temp.append(el("ul", {}, sample));

  $("p-cheat").replaceChildren(
    el("div", { class: "card" },
      el("h2", { text: "Grahas at a glance" }),
      el("p", { class: "lede", text: "Own sign (aatchi), exaltation (uchcham), debilitation (neecham, always the opposite sign), moolatrikonam (a planet's 'office' degrees), aspects (paarvai) and dasha years." }),
      el("div", { class: "scroll" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Graha", "Nature", "Own (aatchi)", "Exalted (uchcham)", "Debilitated (neecham)", "Moolatrikonam", "Paarvai", "Dasa yrs", "Signifies"].map((h) => el("th", { text: h })))), el("tbody", {}, grahaRows)))),
    el("div", { class: "grid2" },
      el("div", { class: "card" },
        el("h2", { text: "Natpu · Pagai · Samam" }),
        el("p", { class: "lede", text: "Natural friendships (Parashara): F friend, N neutral, E enemy. Used to judge how comfortable a graha is in another's sign." }),
        el("div", { class: "scroll" }, el("table", { class: "matrix" }, el("thead", {}, relHead), el("tbody", {}, relRows))),
        relNote,
        el("h3", { text: "Temporary friendship (thathkalika)" }),
        el("p", { class: "note", text: "Grahas 2, 3, 4, 10, 11 or 12 signs from each other in a chart become temporary friends; others temporary enemies. Natural + temporary gives the final attitude: friend+friend = great friend, friend+enemy = neutral, neutral+friend = friend, neutral+enemy = enemy, enemy+enemy = great enemy." }),
        el("p", { class: "note", text: "In this chart:" }), temp),
      el("div", { class: "card" },
        el("h2", { text: "Signs, lords & dignities" }),
        el("p", { class: "lede", text: "Who rules each sign, and who is exalted, debilitated or at home there." }),
        el("div", { class: "signbox" }, signsBox))),
    el("div", { class: "grid2" },
      el("div", { class: "card" },
        el("h2", { text: "Houses & groups" }),
        el("table", {}, el("tbody", {}, HOUSES.slice(1).map((h, i) => el("tr", { onclick: () => select({ kind: "house", id: i + 1 }) },
          el("td", { class: "mono", text: String(i + 1) }), el("td", {}, el("b", { text: h.en }), el("div", { class: "note", text: h.ta })), el("td", { class: "note", text: h.themes }), el("td", { text: GRAHAS[h.karaka].en }))))),
        el("ul", {}, HOUSE_GROUPS.map((g) => el("li", {}, el("b", { text: `${g.ta} (${g.en}): ${g.houses.join(", ")}. ` }), g.why)))),
      el("div", { class: "card" },
        el("h2", { text: "Dasha order & years" }),
        el("p", { class: "lede", text: "Each nakshatram belongs to a dasha lord, cycling through the same nine in order. That's how your birth star picks your first dasa." }),
        el("table", {}, el("tbody", {}, DASHA_ORDER.map((g, i) => el("tr", {},
          el("td", {}, gname(g)), el("td", { class: "mono", text: `${GRAHAS[g].years} yrs` }),
          el("td", { class: "note", text: [i, i + 9, i + 18].map((n) => NAKSHATRAS[n][0]).join(", ") }))))))),
    el("div", { class: "card" },
      el("h2", { text: "The 27 nakshatrams" }),
      el("div", { class: "scroll" }, el("table", {}, el("thead", {}, el("tr", {}, ...["#", "Tamil", "Sanskrit", "Span", "Lord", "Deity", "Symbol", "Gana", "Nature"].map((h) => el("th", { text: h })))),
        el("tbody", {}, NAKSHATRAS.map((n, i) => {
          const start = i * 40 / 3;
          return el("tr", { class: state.chart.star.index === i ? "sel" : null },
            el("td", { class: "mono", text: String(i + 1) }), el("td", {}, el("b", { text: n[0] })), el("td", { text: n[1] }),
            el("td", { class: "mono", text: `${SIGNS[Math.floor(start / 30)].en.slice(0, 3)} ${dms(start)} – ${SIGNS[Math.floor((start + 13.333) / 30) % 12].en.slice(0, 3)} ${dms((start + 40 / 3) % 360 || 30)}` }),
            el("td", { text: GRAHAS[DASHA_ORDER[i % 9]].en }), el("td", { text: n[2] }), el("td", { text: n[3] }), el("td", { text: n[5] }), el("td", { class: "note", text: n[4] }));
        }))))),
    el("div", { class: "card" },
      el("h2", { text: "Glossary: Tamil term → English" }),
      el("div", { class: "scroll" }, el("table", {}, el("tbody", {}, GLOSSARY.map(([t, e, d]) => el("tr", {}, el("td", {}, el("b", { text: t })), el("td", { text: e }), el("td", { class: "note", text: d }))))))));
}

// ---------- reverse search ----------
const EXAMPLES = [
  "A calm, wise teacher with a gift for music",
  "A bold leader who becomes famous, with a strong career",
  "A disciplined, hardworking engineer who travels abroad",
  "A caring, creative child with Moon in Taurus and no sevvai dosham",
  "Launching a tech business that grows wealth",
  "Someone spiritual and intuitive, Jupiter in the 9th",
];
function renderFind() {
  $("q-place").textContent = `${state.place.name} (${state.place.tz})`;
  if (!$("q-examples").childElementCount) {
    $("q-examples").append(...EXAMPLES.map((x) => el("button", { type: "button", text: x, onclick: () => { $("q-text").value = x; } })));
    const z = utcToZoned(Date.now(), state.place.tz);
    const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    $("q-from").value = iso(z.year, z.month, z.day);
    $("q-to").value = iso(z.year + 1, z.month, Math.min(z.day, 28));
  }
}

function renderInterp() {
  const q = state.query;
  const box = $("q-interp");
  if (!q) { box.replaceChildren(); return; }
  box.replaceChildren(el("div", { class: "interp" },
    el("div", { class: "src", text: `Interpreted by ${q.source}` }),
    q.summary ? el("p", { text: q.summary }) : null,
    q.notes ? el("p", { class: "note", text: q.notes }) : null,
    el("ul", { class: "cons" }, q.constraints.map((c, i) => el("li", {},
      el("div", {}, el("b", { text: describe(c) }), c.why ? el("div", { class: "why", text: c.why }) : null),
      el("select", { "aria-label": "weight", onchange: (e) => { c.weight = Number(e.target.value); } },
        ...[[1, "nice"], [2, "important"], [3, "essential"]].map(([v, t]) => el("option", { value: v, text: t, selected: c.weight === v ? "selected" : null }))),
      el("button", { type: "button", class: "x", title: "Remove", text: "×", onclick: () => { q.constraints.splice(i, 1); $("q-search").disabled = !q.constraints.length; renderInterp(); } }))))));
}

$("q-interpret").addEventListener("click", async () => {
  const text = $("q-text").value.trim();
  if (!text) { $("q-text").focus(); return; }
  $("q-interpret").disabled = true;
  $("q-interpret").textContent = "Interpreting…";
  try {
    state.query = await interpret(text);
  } finally {
    $("q-interpret").disabled = false;
    $("q-interpret").textContent = "1 · Interpret";
  }
  $("q-search").disabled = !state.query.constraints.length;
  $("q-results").replaceChildren();
  renderInterp();
});

let worker = null;
$("q-search").addEventListener("click", () => {
  if (!state.query?.constraints.length) return;
  const [fy, fm, fd] = $("q-from").value.split("-").map(Number);
  const [ty, tm, td] = $("q-to").value.split("-").map(Number);
  const fromMs = zonedToUtc(fy, fm, fd, 0, 0, state.place.tz);
  let toMs = zonedToUtc(ty, tm, td, 23, 59, state.place.tz);
  if (!(toMs > fromMs)) { toast("Pick an end date after the start"); return; }
  if (toMs - fromMs > 5 * YEAR_MS) { toMs = fromMs + 5 * YEAR_MS; toast("Searching the first 5 years of that range"); }
  const hv = $("q-hours").value;
  const hours = hv ? hv.split("-").map(Number) : null;
  worker?.terminate();
  worker = new Worker(new URL("./js/search.worker.js", import.meta.url), { type: "module" });
  $("q-progress").hidden = false;
  $("q-progress").firstElementChild.style.width = "0%";
  $("q-search").disabled = true;
  $("q-results").replaceChildren();
  worker.onmessage = (e) => {
    if (e.data.progress !== undefined) { $("q-progress").firstElementChild.style.width = `${(e.data.progress * 100).toFixed(0)}%`; return; }
    $("q-progress").hidden = true;
    $("q-search").disabled = false;
    if (e.data.error) { $("q-results").replaceChildren(el("p", { class: "note", text: `Search failed: ${e.data.error}` })); return; }
    renderResults(e.data.results);
  };
  const place = { name: state.place.name, lat: state.place.lat, lon: state.place.lon, tz: state.place.tz };
  worker.postMessage({ constraints: state.query.constraints, place, fromMs, toMs, hours, top: Number($("q-top").value) });
});

function renderResults(results) {
  if (!results.length) { $("q-results").replaceChildren(el("p", { class: "note", text: "Nothing in that range. Try a wider range or fewer essentials." })); return; }
  $("q-results").replaceChildren(el("div", { class: "results" }, results.map((r, i) => el("div", { class: "result" },
    el("span", { class: "score", text: `${Math.round(r.score * 100)}%` }),
    el("div", { class: "when", text: `${i + 1}. ${formatZoned(r.ms, state.place.tz, { dateStyle: "medium", timeStyle: "short" })}` }),
    el("div", { class: "meta", text: `Lagna ${SIGNS[r.lagna].en} · Moon ${SIGNS[r.moon].en} · ${r.star} · good from ${formatZoned(r.window[0], state.place.tz, { timeStyle: "short" })} to ${formatZoned(r.window[1], state.place.tz, { timeStyle: "short" })}` }),
    el("ul", {}, r.detail.map((d) => el("li", { title: d.why || "", text: `${d.score >= 0.999 ? "✓" : d.score > 0 ? "◐" : "✗"} ${d.text}` }))),
    el("button", { type: "button", class: "ghost small", text: "Open this chart", onclick: () => openMoment(r.ms) })))));
}

function openMoment(ms) {
  const z = utcToZoned(ms, state.place.tz);
  $("f-date").value = `${z.year}-${String(z.month).padStart(2, "0")}-${String(z.day).padStart(2, "0")}`;
  $("f-time").value = `${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}`;
  state.scrub = 0;
  $("f-scrub").value = 0;
  recompute({ keepSelection: false });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- wiring ----------
for (const id of ["f-date", "f-time", "f-name"]) $(id).addEventListener("input", () => recompute());
placeSel.addEventListener("change", () => {
  $("custom-place").hidden = placeSel.value !== "__custom";
  state.place = readPlace();
  recompute();
});
for (const id of ["f-lat", "f-lon", "f-tz"]) $(id).addEventListener("change", () => { state.place = readPlace(); recompute(); });
$("b-now").addEventListener("click", () => { setNow(); state.scrub = 0; $("f-scrub").value = 0; recompute(); });
$("b-share").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(shareURL().href); toast("Link copied"); } catch { toast("Copy the address bar"); }
});
$("f-scrub").addEventListener("input", (e) => { state.scrub = Number(e.target.value); recompute(); });
let playing = null;
$("b-play").addEventListener("click", () => {
  if (playing) { clearInterval(playing); playing = null; $("b-play").textContent = "▶"; return; }
  $("b-play").textContent = "❚❚";
  playing = setInterval(() => {
    state.scrub = state.scrub >= 720 ? -720 : state.scrub + 8;
    $("f-scrub").value = state.scrub;
    recompute();
  }, 60);
});
for (const b of document.querySelectorAll(".seg button")) {
  b.addEventListener("click", () => {
    state.mode = b.dataset.mode;
    for (const x of document.querySelectorAll(".seg button")) x.setAttribute("aria-pressed", String(x === b));
    drawChart();
  });
}
$("t-lines").addEventListener("change", (e) => { state.lines = e.target.checked; drawChart(); });
$("t-trines").addEventListener("change", (e) => { state.trines = e.target.checked; recompute(); });

fromURL();
recompute();
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get("sel") && GRAHAS[hash.get("sel")]) select({ kind: "planet", id: hash.get("sel") });
else if (Number(hash.get("house")) >= 1 && Number(hash.get("house")) <= 12) select({ kind: "house", id: Number(hash.get("house")) });
if (hash.get("tab") && $(`p-${hash.get("tab")}`)) showTab(hash.get("tab"));
