import {
  LUNAR_MONTHS, NAKSHATRAS, TAMIL_MONTHS, addDays, dayKey, daysBetween, moonrise, pakshaOf, panchang, parseKey, tithiName,
} from "./js/panchang.js";
import { observances } from "./js/observances.js";
import { OPENING, WEEKDAYS } from "./js/content/weekdays.js";
import { OBSERVANCES, OBSERVANCE_ART } from "./js/content/observances.js";
import { currentPlace, forgetLocation, locate, timeZone } from "./js/places.js";

const $ = (id) => document.getElementById(id);
const MIN = 60000;
const RING = 2 * Math.PI * 52;
const MONTHLY = new Set(["ekadasi", "pournami", "amavasai", "pradosham", "sankatahara"]);

let place = currentPlace();
let key = null;
let obsWindow = null;
let script = localStorage.getItem("naal.script") || "deva";

if (location.hostname.split(".").length > 2) {
  $("portal-link").href = `${location.protocol}//${location.host.split(".").slice(1).join(".")}/`;
}

// ---------- formatting ----------
const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined) node.append(kid);
  return node;
};
const svg = (tag, attrs = {}) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const todayKey = () => dayKey(new Date());
const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s/g, " ").toLowerCase();
// A time, with the weekday added when it isn't on the displayed day.
const when = (ms, onKey = key) => {
  const k = dayKey(new Date(ms));
  if (k === onKey) return time(ms);
  return `${parseKey(k).toLocaleDateString([], { weekday: "short" })} ${time(ms)}`;
};
const range = (a, b) => `${when(a)} – ${when(b)}`;
const longDate = (k) => parseKey(k).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const inDays = (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);

// ---------- observances ----------
function obsFor(k) {
  if (!obsWindow || daysBetween(obsWindow.from, k) < 0 || daysBetween(k, obsWindow.to) < 0) {
    const from = addDays(k, -10);
    const to = addDays(k, 75);
    obsWindow = { from, to, map: observances(from, to, place) };
  }
  return (obsWindow.map.get(k) || [])
    .filter((e) => OBSERVANCES[e.id])
    .map((e) => ({ ...e, info: OBSERVANCES[e.id] }))
    .sort((a, b) => b.info.weight - a.info.weight);
}

function obsTiming(o, p) {
  switch (o.id) {
    case "pradosham": return `Pradosha kaalam: around sunset, ${time(p.sunset)}`;
    case "sankatahara": return o.moonrise ? `Fast until moonrise, ${when(o.moonrise)}` : null;
    case "deepavali": return `Oil bath before sunrise, ${time(o.before)}`;
    case "karadaiyan_nombu": return `Tie the nonbu saradu at ${when(o.at)}`;
    case "navaratri": return `Night ${o.day} of 9`;
    case "margazhi": return `Margazhi ${o.day}`;
    case "karthigai_deepam": return `Lamps at sunset, ${time(p.sunset)}`;
    default:
      if (o.start && o.end) {
        const kind = o.info.name.match(/Ekadasi|Pournami|Amavasai|Sashti|Sivaratri/) ? "Thithi" : "In effect";
        return `${kind}: ${range(o.start, o.end)}`;
      }
      return null;
  }
}

// ---------- sky ----------
function drawArc(p, isToday) {
  const g = $("arc");
  g.replaceChildren();
  const cx = 200, cy = 185, r = 160;
  const day = p.sunset - p.sunrise;
  const pt = (f, rr = r) => {
    const th = Math.PI * (1 - f);
    return [cx + rr * Math.cos(th), cy - rr * Math.sin(th)];
  };
  const arc = (f0, f1, rr = r) => {
    const [x0, y0] = pt(Math.max(0, f0), rr);
    const [x1, y1] = pt(Math.min(1, f1), rr);
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${rr} ${rr} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  const frac = (ms) => (ms - p.sunrise) / day;

  const defs = svg("defs");
  const grad = svg("linearGradient", { id: "skyfade", x1: "0", y1: "0", x2: "0", y2: "1" });
  grad.append(svg("stop", { offset: "0", "stop-color": "var(--day)", "stop-opacity": "0.16" }));
  grad.append(svg("stop", { offset: "1", "stop-color": "var(--day)", "stop-opacity": "0" }));
  defs.append(grad);
  g.append(defs);
  g.append(svg("path", { d: `${arc(0, 1)} Z`, fill: "url(#skyfade)" }));
  g.append(svg("line", { x1: 20, y1: cy, x2: 380, y2: cy, stroke: "var(--line)", "stroke-width": 1.5 }));
  g.append(svg("path", { d: arc(0, 1), fill: "none", stroke: "var(--line)", "stroke-width": 12, "stroke-linecap": "round" }));

  const segs = [
    ["rahu", "Rahu kalam", p.times.rahu],
    ["yama", "Yamagandam", p.times.yama],
    ["kuligai", "Kuligai", p.times.kuligai],
    ["abhijit", "Abhijit muhurtham", p.times.abhijit],
  ];
  for (const [cls, name, t] of segs) {
    if (!t) continue;
    const path = svg("path", { d: arc(frac(t.start), frac(t.end)), fill: "none", stroke: `var(--${cls})`, "stroke-width": 12 });
    const title = svg("title");
    title.textContent = `${name}: ${time(t.start)} – ${time(t.end)}`;
    path.append(title);
    g.append(path);
  }
  // Hour ticks every two hours of clock time.
  const startHour = new Date(p.sunrise);
  startHour.setMinutes(0, 0, 0);
  for (let t = startHour.getTime() + 3600000; t < p.sunset; t += 3600000) {
    const h = new Date(t).getHours();
    if (h % 3) continue;
    const [x0, y0] = pt(frac(t), r - 12);
    const [x1, y1] = pt(frac(t), r - 18);
    g.append(svg("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: "var(--muted)", "stroke-width": 1 }));
    const [tx, ty] = pt(frac(t), r - 30);
    const label = svg("text", { x: tx, y: ty + 4, "text-anchor": "middle" });
    label.textContent = new Date(t).toLocaleTimeString([], { hour: "numeric" }).replace(/\s/g, "").toLowerCase();
    g.append(label);
  }

  const text = (x, y, str, cls, anchor = "middle") => {
    const t = svg("text", { x, y, "text-anchor": anchor, class: cls || "" });
    t.textContent = str;
    g.append(t);
  };
  text(30, cy + 20, "☀ rise", "", "start");
  text(30, cy + 35, time(p.sunrise), "big", "start");
  text(370, cy + 20, "set ☾", "", "end");
  text(370, cy + 35, time(p.sunset), "big", "end");

  const now = Date.now();
  if (isToday && now >= p.sunrise && now <= p.sunset) {
    const [x, y] = pt(frac(now));
    g.append(svg("circle", { cx: x, cy: y, r: 16, fill: "var(--day)", opacity: 0.18 }));
    g.append(svg("circle", { cx: x, cy: y, r: 9, fill: "#ffd43b", stroke: "var(--day)", "stroke-width": 3 }));
    const left = Math.round((p.sunset - now) / MIN);
    text(cx, cy - 40, "now", "");
    text(cx, cy - 22, `${Math.floor(left / 60)}h ${left % 60}m of daylight left`, "big");
  } else if (isToday) {
    const next = now < p.sunrise ? p.sunrise : p.nextSunrise;
    const mins = Math.round((next - now) / MIN);
    text(cx, cy - 40, now < p.sunrise ? "before sunrise" : "night", "");
    text(cx, cy - 22, `sunrise in ${Math.floor(mins / 60)}h ${mins % 60}m`, "big");
  } else {
    const len = Math.round(day / MIN);
    text(cx, cy - 40, "daylight", "");
    text(cx, cy - 22, `${Math.floor(len / 60)}h ${len % 60}m`, "big");
  }
}

function drawMoon(p, isToday) {
  const m = $("moon");
  m.replaceChildren();
  const k = p.moon.illumination;
  const waxing = p.moon.waxing;
  const r = 42, cx = 50, cy = 50;
  m.append(svg("circle", { cx, cy, r, fill: "#2c2840" }));
  const rx = Math.abs(r * (1 - 2 * k)).toFixed(2);
  const outer = waxing ? 1 : 0;
  const term = waxing ? (k > 0.5 ? 1 : 0) : (k > 0.5 ? 0 : 1);
  m.append(svg("path", {
    d: `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${outer} ${cx} ${cy + r} A ${rx} ${r} 0 0 ${term} ${cx} ${cy - r} Z`,
    fill: "#fff3c4",
  }));
  m.setAttribute("aria-label", `Moon ${Math.round(k * 100)}% lit, ${waxing ? "waxing" : "waning"}`);
}

function spanLines(spans, nameOf, taOf, isToday) {
  const now = Date.now();
  let first = 0;
  if (isToday) {
    const i = spans.findIndex((s) => s.start <= now && s.end > now);
    if (i > 0) first = i;
  }
  return spans.slice(first, first + 2).map((s, i) =>
    el("div", { class: `chip-line${i ? " next" : ""}` },
      i ? el("span", { class: "until", text: "then" }) : null,
      el("strong", { text: nameOf(s.n) }),
      taOf ? el("span", { class: "ta", lang: "ta", text: taOf(s.n) }) : null,
      el("span", { class: "until", text: `until ${when(s.end)}` })));
}

function renderSky(p, isToday) {
  drawArc(p, isToday);
  drawMoon(p, isToday);
  $("tithi").replaceChildren(...spanLines(p.tithis, (n) => `${pakshaOf(n)} ${tithiName(n)}`, null, isToday));
  $("nakshatra").replaceChildren(...spanLines(p.nakshatras, (n) => NAKSHATRAS[n - 1][0], (n) => NAKSHATRAS[n - 1][1], isToday));

  const now = Date.now();
  const mr = moonrise(p.key, place);
  const rows = [
    ["Brahma muhurtham", p.times.brahma],
    ["Rahu kalam", p.times.rahu],
    ["Yamagandam", p.times.yama],
    ["Kuligai", p.times.kuligai],
    ["Abhijit", p.times.abhijit],
  ];
  const dl = $("times");
  dl.replaceChildren();
  for (const [name, t] of rows) {
    const live = isToday && t && now >= t.start && now < t.end;
    dl.append(el("dt", { text: name }), el("dd", { class: live ? "now" : null, text: t ? `${time(t.start)} – ${time(t.end)}${live ? "  · now" : ""}` : "— (not on Wednesdays)" }));
  }
  if (mr) dl.append(el("dt", { text: "Moonrise" }), el("dd", { text: when(mr) }));
  dl.append(el("dt", { text: "Lunar month" }), el("dd", { text: `${p.lunar.adhika ? "Adhika " : ""}${LUNAR_MONTHS[p.lunar.month]}` }));
}

// ---------- page ----------
function renderHero(p, w, list) {
  const art = list.find((o) => OBSERVANCE_ART.has(o.id) && o.info.weight === 3) || list.find((o) => OBSERVANCE_ART.has(o.id));
  const img = $("hero-art");
  const src = art ? `img/${art.id}.jpg` : `img/${w.en.toLowerCase()}.jpg`;
  if (img.getAttribute("src") !== src) img.src = src;
  $("art-caption").textContent = art ? art.info.name : w.story.title;

  const [mEn, mTa] = TAMIL_MONTHS[p.solar.month];
  $("hero-eyebrow").textContent = `${mEn} ${p.solar.day} · ${p.solar.year} · ${longDate(p.key)}`;
  $("hero-ta").textContent = w.ta;
  $("hero-en").replaceChildren(w.en, el("small", { text: `${w.vaaram} · ${mTa} ${p.solar.day}` }));
  $("hero-tagline").textContent = w.tagline;

  const big = list.filter((o) => o.info.weight === 3);
  const ribbon = $("ribbon");
  ribbon.hidden = !big.length;
  ribbon.replaceChildren(...big.flatMap((o, i) => [
    i ? " · " : "🪔 ",
    o.info.name,
    el("span", { class: "ta", lang: "ta", text: o.info.ta }),
  ]));
}

function renderFestivals(p, list) {
  const box = $("festivals");
  box.replaceChildren();
  for (const o of list) {
    const info = o.info;
    const minor = info.weight === 1;
    const timing = obsTiming(o, p);
    const card = el("section", { class: `card fest${minor ? " minor" : ""}` },
      el("div", { class: "fest-head" },
        el("h2", { text: info.name }),
        el("span", { class: "ta", lang: "ta", text: info.ta }),
        info.deity ? el("span", { class: "note", text: `· ${info.deity}` }) : null),
      timing ? el("p", { class: "fest-when", text: timing }) : null,
      el("p", { text: info.about }),
      info.do?.length ? el("ul", {}, info.do.map((d) => el("li", { text: d }))) : null,
      info.food ? el("p", { class: "food", text: info.food }) : null);
    if (o.id === "margazhi" && o.day <= 30) {
      card.append(el("p", {}, el("a", {
        href: `https://music.youtube.com/search?q=${encodeURIComponent(`Thiruppavai pasuram ${o.day}`)}`,
        target: "_blank", rel: "noopener", text: `▶ Today's Thiruppavai: pasuram ${o.day}`,
      })));
    }
    box.append(card);
  }
}

function renderWeek(k) {
  const start = addDays(k, -parseKey(k).getDay());
  const today = todayKey();
  $("week").replaceChildren(...Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i);
    const top = obsFor(d).find((o) => o.id !== "margazhi");
    return el("li", {},
      el("button", {
        type: "button", style: `--c:${WEEKDAYS[i].color}`,
        class: [d === k ? "sel" : "", d === today ? "is-today" : ""].join(" ").trim() || null,
        "aria-current": d === k ? "date" : null,
        "aria-label": `${WEEKDAYS[i].en} ${parseKey(d).getDate()}${top ? `, ${top.info.name}` : ""}`,
        onclick: () => go(d),
      },
      el("span", { class: "wd", lang: "ta", text: WEEKDAYS[i].ta }),
      el("span", { class: "dn", text: String(parseKey(d).getDate()) }),
      el("span", { class: "mk", text: top ? top.info.name : "" })));
  }));
}

function renderAbout(w) {
  $("significance").textContent = w.significance;
  $("history").textContent = w.history;
  $("fact").textContent = w.fact;
  const badges = [
    ["Graha", `${w.graha} · ${w.grahaTa}`],
    ["Deity", w.deity],
    ["Colour", w.colorName],
    ["Gem", w.gem],
    ["Grain", w.grain],
    ["Flower", w.flower],
  ];
  $("badges").replaceChildren(...badges.map(([k, v]) => el("li", {}, el("b", { text: k }), v)));
}

function renderStory(w) {
  stopReading();
  $("story-title").textContent = w.story.title;
  $("story-text").textContent = w.story.text;
  $("story-moral").textContent = w.story.moral;
  $("read-aloud").hidden = !("speechSynthesis" in window);
}

function renderKitchen(w, list) {
  const groups = [];
  const festive = list.filter((o) => o.info.food && o.info.weight >= 2);
  for (const o of festive) groups.push([`For ${o.info.name}`, [o.info.food], "festive"]);
  groups.push(["Naivedyam", w.food.naivedyam, "offer"]);
  groups.push(["For the family", w.food.meal, ""]);
  $("plate").replaceChildren(...groups.map(([title, items, cls]) =>
    el("div", { class: cls || null }, el("h3", { text: title }), el("ul", {}, items.map((x) => el("li", { text: x }))))));
  $("food-note").textContent = w.food.note;
}

function mantraBlock(m) {
  const deva = script === "deva";
  return el("div", { class: "mantra" },
    el("p", { class: "label", text: m.name }),
    el("p", { class: `verse${deva ? " deva" : ""}`, lang: deva ? "sa" : "sa-Latn", text: deva ? m.deva : m.iast }),
    el("p", { class: "meaning", text: m.meaning }));
}

function renderPooja(w) {
  const doneKey = `naal.steps.${key}`;
  const done = new Set(JSON.parse(localStorage.getItem(doneKey) || "[]"));
  $("steps").replaceChildren(...w.pooja.map((s, i) => el("li", {
    class: done.has(i) ? "done" : null,
    role: "checkbox", "aria-checked": String(done.has(i)), tabindex: "0",
    text: s,
    onclick: (e) => {
      done.has(i) ? done.delete(i) : done.add(i);
      localStorage.setItem(doneKey, JSON.stringify([...done]));
      e.currentTarget.classList.toggle("done", done.has(i));
      e.currentTarget.setAttribute("aria-checked", String(done.has(i)));
    },
    onkeydown: (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); e.currentTarget.click(); } },
  })));
  $("mantras").replaceChildren(mantraBlock(OPENING), ...w.mantras.map(mantraBlock));
  for (const b of document.querySelectorAll(".script-toggle button")) b.setAttribute("aria-pressed", String(b.dataset.script === script));
  const japa = w.mantras.find((m) => m.japa) || w.mantras[0];
  $("japa-mantra").textContent = script === "deva" ? japa.deva.split("\n")[0] : japa.iast.split("\n")[0];
  $("japa-mantra").className = `japa-mantra${script === "deva" ? " deva" : ""}`;
  renderJapa();
}

const japaKey = () => `naal.japa.${key}`;
const japaState = () => JSON.parse(localStorage.getItem(japaKey()) || '{"count":0,"malas":0}');
function renderJapa() {
  const s = japaState();
  $("japa-count").textContent = String(s.count);
  $("japa-fill").style.strokeDasharray = `${RING}`;
  $("japa-fill").style.strokeDashoffset = `${RING * (1 - s.count / 108)}`;
  $("japa-malas").textContent = s.malas ? `${s.malas} full mala${s.malas > 1 ? "s" : ""} (${s.malas * 108}) today` : "Tap the ring for each repetition.";
}
$("japa-ring").addEventListener("click", () => {
  const s = japaState();
  s.count += 1;
  if (s.count >= 108) {
    s.count = 0;
    s.malas += 1;
    $("japa").classList.remove("pulse");
    void $("japa").offsetWidth;
    $("japa").classList.add("pulse");
    navigator.vibrate?.([60, 40, 60]);
  } else {
    navigator.vibrate?.(8);
  }
  localStorage.setItem(japaKey(), JSON.stringify(s));
  renderJapa();
});
$("japa-reset").addEventListener("click", () => {
  localStorage.removeItem(japaKey());
  renderJapa();
});
for (const b of document.querySelectorAll(".script-toggle button")) {
  b.addEventListener("click", () => {
    script = b.dataset.script;
    localStorage.setItem("naal.script", script);
    renderPooja(WEEKDAYS[parseKey(key).getDay()]);
  });
}

function renderSongs(w, list) {
  const seen = new Set();
  const rows = [];
  for (const o of list.filter((x) => x.info.weight >= 2)) {
    for (const s of o.info.songs || []) {
      if (seen.has(s.id) || rows.length >= 3) continue;
      seen.add(s.id);
      rows.push({ ...s, tag: o.info.name });
    }
  }
  for (const s of w.songs) if (!seen.has(s.id)) { seen.add(s.id); rows.push(s); }
  $("songs").replaceChildren(...rows.map((s) => el("li", {},
    el("a", { href: `https://music.youtube.com/watch?v=${s.id}`, target: "_blank", rel: "noopener", class: s.featured ? "featured" : null },
      el("span", { class: "play", "aria-hidden": "true", text: "▶" }),
      el("span", {},
        el("strong", {}, s.title, s.tag ? el("span", { class: "tag", text: s.tag }) : null,
          s.featured ? el("span", { class: "tag", text: `${w.graha.split(" ")[0]}'s kriti` }) : null),
        el("span", { class: "by", text: s.by }))))));
}

function renderUpcoming(k) {
  const today = todayKey();
  const rows = [];
  for (let i = 1; i <= 60 && rows.length < 12; i++) {
    const d = addDays(k, i);
    const list = obsFor(d).filter((o) =>
      (o.info.weight >= 2 && !(o.id === "navaratri" && o.day > 1)) || MONTHLY.has(o.id));
    if (!list.length) continue;
    const major = list.filter((o) => o.info.weight >= 2);
    const minor = list.filter((o) => o.info.weight < 2);
    const wd = parseKey(d).getDay();
    const offset = daysBetween(today, d);
    rows.push(el("li", { class: list.some((o) => o.info.weight === 3) ? "w3" : null },
      el("button", { type: "button", onclick: () => go(d) },
        el("span", { class: "date", style: `--c:${WEEKDAYS[wd].color}` },
          el("b", { text: String(parseKey(d).getDate()) }),
          el("small", { text: parseKey(d).toLocaleDateString([], { month: "short" }) })),
        el("span", { class: "names" },
          major.length ? el("b", { text: major.map((o) => (o.id === "navaratri" ? "Navaratri begins" : o.info.name)).join(" · ") }) : null,
          major.length && minor.length ? " " : null,
          minor.length ? el("span", { class: "minor", text: minor.map((o) => o.info.name).join(" · ") }) : null),
        el("span", { class: "in", text: offset >= 0 ? inDays(offset) : parseKey(d).toLocaleDateString([], { weekday: "short" }) }))));
  }
  $("upcoming").replaceChildren(...rows);
}

function renderFooter() {
  const zone = timeZone();
  const how = place.source === "device" ? "this device's location" : `the ${zone} time zone`;
  $("where").textContent = `Sunrise and sunset for ${place.name} (${place.lat.toFixed(2)}°, ${place.lon.toFixed(2)}°), from ${how}.`;
  const canLocate = window.isSecureContext && "geolocation" in navigator;
  $("locate").hidden = !(canLocate && place.source !== "device");
  $("forget").hidden = place.source !== "device";
}

function render() {
  const p = panchang(key, place);
  const w = WEEKDAYS[p.weekday];
  const isToday = key === todayKey();
  const root = document.documentElement.style;
  root.setProperty("--day", w.color);
  root.setProperty("--tint", w.tint);
  const now = Date.now();
  document.body.classList.toggle("evening", isToday && (now >= p.sunset || now < p.sunrise));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", w.color);

  const list = obsFor(key);
  document.title = `${w.ta} · ${w.en}${list[0] && list[0].info.weight >= 2 ? ` · ${list[0].info.name}` : ""} — Naal`;
  $("today").setAttribute("aria-current", isToday ? "date" : "false");
  $("date-input").value = key;

  renderHero(p, w, list);
  renderSky(p, isToday);
  renderFestivals(p, list);
  renderWeek(key);
  renderAbout(w);
  renderStory(w);
  renderKitchen(w, list);
  renderPooja(w);
  $("celebrate").replaceChildren(...w.celebrate.map((c) => el("li", { text: c })));
  renderSongs(w, list);
  renderUpcoming(key);
  renderFooter();
}

// ---------- read aloud ----------
function stopReading() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  $("read-aloud").textContent = "▶ Read aloud";
  $("read-aloud").setAttribute("aria-pressed", "false");
  document.querySelector(".story").classList.remove("speaking");
}
$("read-aloud").addEventListener("click", () => {
  if (speechSynthesis.speaking) return stopReading();
  const w = WEEKDAYS[parseKey(key).getDay()];
  const u = new SpeechSynthesisUtterance(`${w.story.title}. ${w.story.text} ${w.story.moral}`);
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find((v) => v.lang === "en-IN") || voices.find((v) => v.lang.startsWith("en")) || null;
  u.rate = 0.92;
  u.onend = stopReading;
  speechSynthesis.speak(u);
  $("read-aloud").textContent = "■ Stop";
  $("read-aloud").setAttribute("aria-pressed", "true");
  document.querySelector(".story").classList.add("speaking");
});

// ---------- navigation ----------
function go(k, push = true) {
  key = k;
  if (push) {
    const url = new URL(location.href);
    if (k === todayKey()) url.searchParams.delete("date");
    else url.searchParams.set("date", k);
    history.pushState({ key: k }, "", url);
  }
  render();
  if (push) window.scrollTo({ top: 0, behavior: "smooth" });
}
const fromURL = () => {
  const d = new URLSearchParams(location.search).get("date");
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayKey();
};
$("prev").addEventListener("click", () => go(addDays(key, -1)));
$("next").addEventListener("click", () => go(addDays(key, 1)));
$("today").addEventListener("click", () => go(todayKey()));
$("date-input").addEventListener("change", (e) => e.target.value && go(e.target.value));
window.addEventListener("popstate", () => go(fromURL(), false));
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea")) return;
  if (e.key === "ArrowLeft") go(addDays(key, -1));
  if (e.key === "ArrowRight") go(addDays(key, 1));
});

$("locate").addEventListener("click", async () => {
  $("locate").disabled = true;
  try {
    place = await locate();
    obsWindow = null;
    render();
  } catch (err) {
    $("where").textContent = err.message;
  } finally {
    $("locate").disabled = false;
  }
});
$("forget").addEventListener("click", () => {
  forgetLocation();
  place = currentPlace();
  obsWindow = null;
  render();
});

// Keep "today" live: move the sun every minute, and roll over at midnight.
let shownToday = todayKey();
setInterval(() => {
  const t = todayKey();
  if (t !== shownToday) {
    const wasToday = key === shownToday;
    shownToday = t;
    if (wasToday) go(t, false);
    return;
  }
  if (key === t) {
    const p = panchang(key, place);
    const now = Date.now();
    document.body.classList.toggle("evening", now >= p.sunset || now < p.sunrise);
    renderSky(p, true);
  }
}, MIN);

go(fromURL(), false);
