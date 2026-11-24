import * as api from "./js/api.js";
import * as S from "./js/story.js";
import { KALKI } from "./js/seed.js";

const $ = (id) => document.getElementById(id);
const app = $("app");
const show = (...nodes) => app.replaceChildren(...nodes.filter(Boolean));

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "text") n.textContent = v;
    else if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "style") n.style.cssText = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : String(c));
  return n;
}

// ---------- state ----------

let images = {};              // image key -> {state, version, error}
const stories = new Map();    // id -> story
const chapters = new Map();   // "sid/n" -> chapter
let watching = null;
let imageListeners = [];       // run after pictures change; reset per page
const onImages = (fn) => imageListeners.push(fn);

async function getStory(sid, fresh = false) {
  if (fresh || !stories.has(sid)) {
    const s = await api.load(S.storyKey(sid));
    if (!s) throw new Error("That story isn't on the shelf.");
    stories.set(sid, s);
  }
  return stories.get(sid);
}

async function getChapter(sid, n, fresh = false) {
  const k = `${sid}/${n}`;
  if (fresh || !chapters.has(k)) chapters.set(k, await api.load(S.chapterKey(sid, n)));
  return chapters.get(k);
}

async function saveStory(s) {
  s.updated = Date.now();
  await api.save(S.storyKey(s.id), s);
  stories.set(s.id, s);
  const index = await api.load("stories", { list: [] });
  const entry = { id: s.id, title: s.title, by: s.by, tagline: s.tagline, updated: s.updated };
  index.list = [entry, ...index.list.filter((x) => x.id !== s.id)];
  await api.save("stories", index);
}

async function saveChapter(sid, ch) {
  ch.updated = Date.now();
  await api.save(S.chapterKey(sid, ch.n), ch);
  chapters.set(`${sid}/${ch.n}`, ch);
}

async function refresh(keys) {
  if (keys.length) Object.assign(images, await api.imageStates(keys));
}

// ---------- pictures on the page ----------

const busy = (k) => ["queued", "painting"].includes(images[k]?.state);

function slotInner(key, alt) {
  const st = images[key] || { state: "missing" };
  if (st.state === "done") return [el("img", { src: api.imageURL(key, st.version), alt, loading: "lazy", decoding: "async" })];
  const label = { queued: "Waiting for the painter…", painting: "Painting…", error: "The painter got stuck", missing: "Not painted yet" }[st.state];
  return [el("div", { class: `ph ${st.state}`, title: st.error || "" }, el("span", { text: label }))];
}

function slot(key, alt, cls = "") {
  const f = el("div", { class: `slot ${cls}`, "data-img": key, "data-state": images[key]?.state || "missing", "data-v": images[key]?.version || "" });
  f.append(...slotInner(key, alt));
  f.dataset.alt = alt;
  return f;
}

function updateSlots() {
  for (const f of document.querySelectorAll("[data-img]")) {
    const st = images[f.dataset.img] || { state: "missing" };
    if (f.dataset.state === st.state && f.dataset.v === String(st.version || "")) continue;
    f.dataset.state = st.state;
    f.dataset.v = st.version || "";
    f.replaceChildren(...slotInner(f.dataset.img, f.dataset.alt));
  }
  for (const fn of imageListeners) fn();
}

// watch polls pictures that are still being painted until they're all done.
function watch() {
  if (watching) return;
  const tick = async () => {
    const keys = Object.keys(images).filter(busy);
    if (!keys.length) { watching = null; return; }
    try { await refresh(keys); updateSlots(); } catch { /* next time */ }
    watching = setTimeout(tick, 4000);
  };
  watching = setTimeout(tick, 3000);
}

function toast(msg, bad = false) {
  const t = el("div", { class: `toast${bad ? " bad" : ""}`, role: "status", text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), bad ? 9000 : 4000);
}

// ---------- studio (editor) ----------

function renderStudioButton() {
  $("studio").textContent = api.editor.on ? "✎ Studio on" : "✎ Studio";
  $("studio").setAttribute("aria-pressed", String(api.editor.on));
  document.body.classList.toggle("editing", api.editor.on);
}

$("studio").addEventListener("click", () => {
  if (api.editor.on) { api.editor.lock(); renderStudioButton(); route(); return; }
  $("unlock-err").textContent = "";
  $("unlock-pw").value = "";
  $("unlock").showModal();
});
$("unlock-cancel").addEventListener("click", () => $("unlock").close());
$("unlock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api.editor.unlock($("unlock-pw").value);
    $("unlock").close();
    renderStudioButton();
    route();
  } catch (err) {
    $("unlock-err").textContent = err.message;
  }
});

// ---------- router ----------

window.addEventListener("hashchange", route);

async function route() {
  const [path, qs] = location.hash.slice(1).split("?");
  const q = new URLSearchParams(qs || "");
  const p = path.split("/").filter(Boolean);
  imageListeners = [];
  renderStudioButton();
  try {
    if (p[0] === "new") return newStory();
    if (p[0] === "s" && p[1] && !p[2]) return await storyHome(p[1]);
    if (p[0] === "s" && p[1] && p[2]) return await reader(p[1], Number(p[2]), q);
    return await shelf();
  } catch (e) {
    show(el("section", { class: "card oops" }, el("h2", { text: "Hmm." }), el("p", { text: e.message }), el("a", { href: "#/", class: "btn", text: "Back to the shelf" })));
  }
}

// ---------- shelf ----------

async function shelf() {
  document.title = "Storyboard";
  const index = await api.load("stories", { list: [] });
  await refresh(index.list.map((s) => S.coverImage(s.id)));
  const cards = index.list.map((s) => el("a", { class: "book", href: `#/s/${s.id}` },
    slot(S.coverImage(s.id), `${s.title} cover`, "cover"),
    el("div", { class: "book-title" }, el("strong", { text: s.title }), el("span", { text: s.by ? `by ${s.by}` : "" }))));
  if (api.editor.on) cards.push(el("a", { class: "book new", href: "#/new" }, el("span", { class: "plus", text: "+" }), el("strong", { text: "New story" })));
  show(
    el("section", { class: "hero" },
      el("h2", { class: "comic-title", text: "Stories, painted panel by panel" }),
      el("p", { text: "Pick a book and turn the pages. Every story here started as a few lines from the family." })),
    cards.length ? el("div", { class: "shelf" }, ...cards)
      : el("section", { class: "card empty" }, el("p", { text: "No stories yet. Tap ✎ Studio (it needs the admin password) to make the first one." })));
  watch();
}

// ---------- new story ----------

function newStory() {
  if (!api.editor.on) { location.hash = "#/"; return; }
  document.title = "New story · Storyboard";
  const title = el("input", { id: "ns-title", required: true, maxlength: 80, value: KALKI.title });
  const by = el("input", { id: "ns-by", maxlength: 80, value: KALKI.by });
  const short = el("input", { id: "ns-id", required: true, maxlength: 20, pattern: "[a-z0-9-]+", value: "kalki" });
  const gist = el("textarea", { id: "ns-gist", rows: 16, required: true, maxlength: 20000 }, KALKI.gist);
  const log = el("ol", { class: "log" });
  const go = el("button", { type: "submit", class: "primary big", text: "✨ Dream up the story bible" });
  title.addEventListener("input", () => {
    const words = title.value.toLowerCase().split(/\s+/).filter((w) => !["story", "of", "the", "a", "and", "saving"].includes(w));
    short.value = S.slug(words[0] || title.value);
  });
  const form = el("form", { class: "card new-story" },
    el("h2", { class: "comic-title", text: "A new story" }),
    el("p", { text: "Give the title and the gist, part by part. Gemini builds the cast, the world and a chapter outline; then the painter draws everyone's character sheet and the cover." }),
    el("label", {}, "Title", title),
    el("div", { class: "two" }, el("label", {}, "By", by), el("label", {}, "Short name (for links)", short)),
    el("label", {}, "The gist", gist),
    go, log);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    go.disabled = true;
    const step = (t) => log.append(el("li", { text: t }));
    try {
      const sid = S.slug(short.value);
      if (await api.load(S.storyKey(sid))) throw new Error(`There's already a story called "${sid}"; pick another short name.`);
      step("Gemini is reading your gist and building the world (about a minute)…");
      const raw = await api.ask(S.SETUP_SYSTEM, S.setupPrompt({ title: title.value, by: by.value, gist: gist.value }), { maxTokens: 16000, temperature: 0.9 });
      const story = S.normalizeStory(raw, { id: sid, title: title.value, by: by.value, gist: gist.value });
      await saveStory(story);
      step(`Cast of ${story.cast.length} and ${story.parts.length} parts outlined. Opening the story…`);
      location.hash = `#/s/${sid}?paint=1`;
    } catch (err) {
      step(err.message);
      go.disabled = false;
    }
  });
  show(form);
}

// ---------- story home ----------

async function storyHome(sid) {
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  const story = await getStory(sid, true);
  document.title = `${story.title} · Storyboard`;
  const castKeys = story.cast.map((c) => S.castImage(sid, c.id));
  const chapterList = await Promise.all(story.parts.map((p) => (p.status === "written" ? getChapter(sid, p.n, true) : null)));
  const firstPanels = chapterList.map((ch) => (ch ? S.panelImage(sid, ch.n, S.allPanels(ch)[0]?.id) : null));
  await refresh([S.coverImage(sid), ...castKeys, ...firstPanels.filter(Boolean)]);

  const firstRead = story.parts.find((p) => p.status === "written");
  const castCard = (c) => el("button", { type: "button", class: `cast-card${c.main ? " main" : ""}`, onclick: () => showCast(story, c) },
    slot(S.castImage(sid, c.id), `${c.name} character sheet`, "sheet"),
    el("strong", { text: c.name }), el("span", { text: c.role }));

  const partCard = (p, i) => {
    const ch = chapterList[i];
    const status = p.status === "written" ? ["ready", "Ready to read"] : p.status === "dreaming" ? ["dreaming", "Writers dreaming"] : ["outline", "Outline"];
    const body = [
      el("div", { class: "part-head" }, el("span", { class: "part-no", text: `Part ${p.n}` }), el("span", { class: `chip ${status[0]}`, text: status[1] })),
      el("h3", { text: p.title }),
      el("p", { class: "summary", text: p.summary }),
    ];
    const card = el("article", { class: `part ${status[0]}` });
    if (ch && firstPanels[i]) card.append(el("a", { href: `#/s/${sid}/${p.n}`, class: "part-art", "aria-label": `Read part ${p.n}` }, slot(firstPanels[i], p.title, "thumb")));
    card.append(el("div", { class: "part-body" }, ...body,
      ch ? el("a", { class: "btn", href: `#/s/${sid}/${p.n}`, text: "Read ▸" }) : null,
      api.editor.on ? partTools(story, p, ch) : null));
    return card;
  };

  const tools = api.editor.on ? el("div", { class: "studio-bar" },
    el("button", { type: "button", class: "primary", onclick: () => paintCast(story), text: "🎨 Paint cast sheets & cover" }),
    el("span", { class: "muted", id: "cast-progress" })) : null;

  show(
    el("section", { class: "story-hero" },
      slot(S.coverImage(sid), `${story.title} cover`, "cover big"),
      el("div", { class: "story-info" },
        el("h2", { class: "comic-title", text: story.title }),
        story.by ? el("p", { class: "by", text: `by ${story.by}` }) : null,
        story.tagline ? el("p", { class: "tagline", text: story.tagline }) : null,
        el("p", { text: story.logline }),
        firstRead ? el("a", { class: "btn primary big", href: `#/s/${sid}/${firstRead.n}`, text: "📖 Start reading" }) : el("p", { class: "muted", text: "No parts are written yet." }))),
    tools,
    el("h2", { class: "section-title", text: "The cast" }),
    el("div", { class: "cast" }, ...story.cast.map(castCard)),
    el("h2", { class: "section-title", text: "Chapters" }),
    el("div", { class: "parts" }, ...story.parts.map(partCard)));
  updateCastProgress(story);
  onImages(() => updateCastProgress(story));
  watch();
  if (q.get("paint") && api.editor.on) {
    history.replaceState(null, "", `#/s/${sid}`);
    paintCast(story);
  }
}

function updateCastProgress(story) {
  const n = $("cast-progress");
  if (!n) return;
  const keys = [...story.cast.map((c) => S.castImage(story.id, c.id)), S.coverImage(story.id)];
  const done = keys.filter((k) => images[k]?.state === "done").length;
  const painting = keys.filter(busy).length;
  n.textContent = `${done} of ${keys.length} painted${painting ? `, ${painting} on the easel` : ""}`;
}

function showCast(story, c) {
  zoom(el("div", { class: "zoom-cast" },
    slot(S.castImage(story.id, c.id), `${c.name} character sheet`, "sheet"),
    el("h2", { class: "comic-title", text: c.name }),
    el("p", { class: "tagline", text: c.role }),
    c.age ? el("p", {}, el("strong", { text: "Age: " }), c.age) : null,
    el("p", {}, el("strong", { text: "Look: " }), c.look),
    el("p", {}, el("strong", { text: "Personality: " }), c.personality),
    api.editor.on ? el("button", { type: "button", class: "ghost", onclick: () => repaint([{ key: S.castImage(story.id, c.id), prompt: S.castPrompt(story, c), aspect: "16:9", high: true }]), text: "↻ Repaint this sheet" }) : null));
}

async function repaint(jobs) {
  try {
    Object.assign(images, await api.paint(jobs));
    updateSlots();
    watch();
    toast(jobs.length === 1 ? "Repainting…" : `Painting ${jobs.length} pictures…`);
  } catch (e) { toast(e.message, true); }
}

// paintCast paints missing character sheets, then the cover with the main
// heroes' sheets as references.
async function paintCast(story) {
  try {
    const sheetKeys = story.cast.map((c) => S.castImage(story.id, c.id));
    await refresh([...sheetKeys, S.coverImage(story.id)]);
    const jobs = story.cast.filter((c) => !["done", "queued", "painting"].includes(images[S.castImage(story.id, c.id)]?.state))
      .map((c) => ({ key: S.castImage(story.id, c.id), prompt: S.castPrompt(story, c), aspect: "16:9", high: true }));
    if (jobs.length) await repaint(jobs);
    if (images[S.coverImage(story.id)]?.state === "done") return;
    // The cover waits for the sheets it uses.
    const heroes = story.cast.filter((c) => c.main).slice(0, 4);
    const need = heroes.map((c) => S.castImage(story.id, c.id));
    for (let i = 0; i < 90 && need.some(busy); i++) {
      await new Promise((r) => setTimeout(r, 4000));
      await refresh(need);
      updateSlots();
    }
    const ready = heroes.filter((c) => images[S.castImage(story.id, c.id)]?.state === "done");
    await repaint([{ key: S.coverImage(story.id), prompt: S.coverPrompt(story, ready), refs: ready.map((c) => S.castImage(story.id, c.id)), aspect: "2:3", high: true }]);
  } catch (e) { toast(e.message, true); }
}

function partTools(story, p, ch) {
  const gist = el("textarea", { rows: 3, maxlength: 6000, placeholder: "Your gist for this part (optional): who, what happens, the big moment…" }, p.gist || "");
  const log = el("p", { class: "muted log-line" });
  const write = el("button", { type: "button", class: ch ? "ghost" : "primary", text: ch ? "↻ Rewrite this part" : "✨ Write this part" });
  write.addEventListener("click", async () => {
    if (ch && !confirm(`Rewrite part ${p.n}? Its pages and pictures are replaced.`)) return;
    write.disabled = true;
    try {
      await writePart(story, p, gist.value.trim(), (t) => { log.textContent = t; });
      route();
    } catch (e) {
      log.textContent = e.message;
      write.disabled = false;
    }
  });
  const kids = [gist, el("div", { class: "row-btns" }, write), log];
  if (ch) {
    const keys = S.allPanels(ch).map((x) => S.panelImage(story.id, ch.n, x.id));
    const paintBtn = el("button", { type: "button", class: "ghost", text: "🎨 Paint missing panels", onclick: () => paintChapter(story, ch) });
    kids[1].append(paintBtn);
    const prog = () => {
      const done = keys.filter((k) => images[k]?.state === "done").length;
      log.textContent = done === keys.length ? `All ${keys.length} panels painted.` : `${done} of ${keys.length} panels painted${keys.some(busy) ? " (painting…)" : ""}.`;
    };
    refresh(keys).then(prog);
    onImages(prog);
  }
  return el("div", { class: "part-tools" }, ...kids);
}

async function writePart(story, part, gist, say) {
  say("Gemini is storyboarding the chapter (a minute or two)…");
  const raw = await api.ask(S.CHAPTER_SYSTEM, S.chapterPrompt(story, part, gist), { maxTokens: 24000, temperature: 0.9 });
  const ch = S.normalizeChapter(raw, story, part, gist);
  say(`${S.allPanels(ch).length} panels on ${ch.pages.length} pages. Writing the screenplay…`);
  try {
    ch.screenplay = S.normalizeScreenplay(await api.ask(S.SCREENPLAY_SYSTEM, S.screenplayPrompt(story, ch), { maxTokens: 16000, temperature: 0.7 }));
  } catch (e) {
    say(`The screenplay didn't come through (${e.message}); you can write it later from the chapter.`);
  }
  await saveChapter(story.id, ch);
  part.status = "written";
  part.gist = gist;
  part.title = ch.title || part.title;
  await saveStory(story);
  say("Sending the panels to the painter…");
  await paintChapter(story, ch, true);
}

async function paintChapter(story, ch, all = false) {
  const castKeys = story.cast.map((c) => S.castImage(story.id, c.id));
  const panels = S.allPanels(ch);
  const keys = panels.map((p) => S.panelImage(story.id, ch.n, p.id));
  await refresh([...castKeys, ...keys]);
  const painted = new Set(castKeys.filter((k) => images[k]?.state === "done"));
  const jobs = panels.map((p) => S.panelJob(story, ch, p, painted))
    .filter((j) => all ? !busy(j.key) : !["done", "queued", "painting"].includes(images[j.key]?.state));
  if (jobs.length) await repaint(jobs);
  else toast("Every panel is already painted.");
}

// ---------- reader ----------

async function reader(sid, n, q) {
  const story = await getStory(sid);
  const ch = await getChapter(sid, n, true);
  if (!ch) throw new Error(`Part ${n} isn't written yet.`);
  const part = story.parts.find((p) => p.n === n) || { n, title: ch.title };
  document.title = `Part ${n}: ${ch.title} · ${story.title}`;
  const panels = S.allPanels(ch);
  await refresh(panels.map((p) => S.panelImage(sid, n, p.id)));
  const view = q.get("view") || "comic";
  const page = Math.min(Math.max(Number(q.get("page") || 1), 1), ch.pages.length);
  const link = (o) => {
    const p = new URLSearchParams({ view, page, ...o });
    if (p.get("view") === "comic") p.delete("view");
    if (p.get("page") === "1") p.delete("page");
    return `#/s/${sid}/${n}${p.toString() ? "?" + p : ""}`;
  };
  const names = Object.fromEntries(story.cast.map((c) => [c.id, c.name]));

  const tabs = el("nav", { class: "tabs", "aria-label": "Views" },
    ...[["comic", "📖 Comic"], ["script", "🎬 Screenplay"], ["shots", "🎞 Shot list"]].map(([v, t]) =>
      el("a", { href: link({ view: v, page: 1 }), class: v === view ? "on" : null, "aria-current": v === view ? "page" : null, text: t })));
  const head = el("div", { class: "reader-head" },
    el("a", { class: "crumb", href: `#/s/${sid}`, text: `◂ ${story.title}` }),
    el("h2", { class: "comic-title" }, el("span", { class: "part-no", text: `Part ${n}` }), " ", ch.title),
    tabs);

  let body;
  if (view === "script") body = screenplayView(story, ch);
  else if (view === "shots") body = shotList(story, ch, names);
  else body = comicView(story, ch, part, page, link, names);
  show(head, body);
  watch();
}

function balloon(d, names, i) {
  const who = names[d.who] || d.who;
  return el("div", { class: `bubble ${d.kind} ${i % 2 ? "right" : "left"}` },
    el("span", { class: "who", text: who }), el("span", { class: "words", text: d.text }));
}

function panelEl(story, ch, p, names, big = false) {
  const key = S.panelImage(story.id, ch.n, p.id);
  const fig = el("figure", { class: `panel size-${p.size}`, tabindex: 0, "aria-label": p.action });
  fig.append(slot(key, p.action, `art aspect-${p.size}`));
  const words = el("div", { class: "words-layer" });
  if (p.caption) words.append(el("div", { class: "caption", text: p.caption }));
  p.dialogue.forEach((d, i) => words.append(balloon(d, names, i)));
  if (p.sfx) words.append(el("div", { class: "sfx", text: p.sfx }));
  fig.append(words);
  if (!big) {
    const open = () => zoomPanel(story, ch, p, names);
    fig.addEventListener("click", open);
    fig.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
  }
  return fig;
}

function comicView(story, ch, part, page, link, names) {
  const pg = ch.pages[page - 1];
  const sheet = el("article", { class: "cpage", "aria-label": `Page ${page} of ${ch.pages.length}` });
  if (page === 1) sheet.append(el("header", { class: "chapter-banner" }, el("span", { text: `Part ${ch.n}` }), el("strong", { text: ch.title }), ch.logline ? el("em", { text: ch.logline }) : null));
  for (const row of S.rows(pg.panels)) sheet.append(el("div", { class: `crow n${row.length}` }, ...row.map((p) => panelEl(story, ch, p, names))));
  sheet.append(el("footer", { class: "page-no", text: String(page) }));

  const last = page === ch.pages.length;
  const next = story.parts.find((p) => p.n > ch.n);
  const nav = el("nav", { class: "pager", "aria-label": "Pages" },
    el("a", { class: "btn turn", href: page > 1 ? link({ page: page - 1 }) : null, "aria-disabled": page === 1 ? "true" : null, text: "◀ Back" }),
    el("div", { class: "dots" }, ...ch.pages.map((_, i) => el("a", { href: link({ page: i + 1 }), class: i + 1 === page ? "on" : null, "aria-label": `Page ${i + 1}` }))),
    last
      ? (next && next.status === "written" ? el("a", { class: "btn turn primary", href: `#/s/${story.id}/${next.n}`, text: `Part ${next.n} ▶` }) : el("a", { class: "btn turn", href: `#/s/${story.id}`, text: "The end… for now ▶" }))
      : el("a", { class: "btn turn primary", href: link({ page: page + 1 }), text: "Next ▶" }));

  const tools = el("div", { class: "reader-tools" },
    el("label", { class: "toggle" }, el("input", { type: "checkbox", id: "hide-words", onchange: (e) => document.body.classList.toggle("no-words", e.target.checked) }), " Hide the words"),
    api.editor.on ? el("button", { type: "button", class: "ghost small", text: "🎨 Paint missing panels", onclick: () => paintChapter(story, ch) }) : null);
  document.body.classList.remove("no-words");

  const wrap = el("div", { class: "comic" }, sheet, nav, tools);
  // Turn pages with arrow keys or a swipe.
  const go = (d) => {
    const target = page + d;
    if (target >= 1 && target <= ch.pages.length) location.hash = link({ page: target });
  };
  const onKey = (e) => {
    if ($("zoom").open || e.target.closest("input,textarea")) return;
    if (e.key === "ArrowRight") go(1);
    if (e.key === "ArrowLeft") go(-1);
  };
  document.addEventListener("keydown", onKey);
  window.addEventListener("hashchange", () => document.removeEventListener("keydown", onKey), { once: true });
  let x0 = null;
  sheet.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  sheet.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
  });
  return wrap;
}

function zoomPanel(story, ch, p, names) {
  const key = S.panelImage(story.id, ch.n, p.id);
  const info = el("div", { class: "zoom-info" },
    el("p", { class: "shot", text: `${p.shot} · ${p.angle}${p.camera ? ` · ${p.camera}` : ""}` }),
    p.scene ? el("p", { class: "scene", text: p.scene }) : null,
    p.caption ? el("p", { class: "cap", text: p.caption }) : null,
    ...p.dialogue.map((d) => el("p", { class: "line" }, el("strong", { text: `${names[d.who] || d.who}: ` }), d.text)),
    p.sfx ? el("p", { class: "sfx-line", text: p.sfx }) : null);
  const kids = [panelEl(story, ch, p, names, true), info];
  if (api.editor.on) kids.push(panelEditor(story, ch, p, names, key));
  zoom(el("div", { class: "zoom-panel" }, ...kids));
}

function panelEditor(story, ch, p, names, key) {
  const action = el("textarea", { rows: 3, maxlength: 900 }, p.action);
  const caption = el("input", { maxlength: 300, value: p.caption });
  const sfx = el("input", { maxlength: 30, value: p.sfx });
  const lines = el("textarea", { rows: 4, maxlength: 1200, placeholder: "One line each, like  kalki: Who are you?" },
    p.dialogue.map((d) => `${d.who}${d.kind !== "speech" ? ` (${d.kind})` : ""}: ${d.text}`).join("\n"));
  const save = async (repaintToo) => {
    const changedArt = action.value.trim() !== p.action;
    p.action = action.value.trim();
    p.caption = caption.value.trim();
    p.sfx = sfx.value.trim();
    p.dialogue = lines.value.split("\n").map((l) => {
      const m = l.match(/^\s*([^:()]+?)\s*(?:\((speech|thought|shout|whisper)\))?\s*:\s*(.+)$/);
      if (!m) return null;
      const who = S.slug(m[1]);
      return { who: names[who] ? who : m[1].trim(), kind: m[2] || "speech", text: m[3].trim() };
    }).filter(Boolean).slice(0, 4);
    try {
      await saveChapter(story.id, ch);
      if (repaintToo || changedArt) {
        const castKeys = story.cast.map((c) => S.castImage(story.id, c.id));
        await refresh(castKeys);
        await repaint([S.panelJob(story, ch, p, new Set(castKeys.filter((k) => images[k]?.state === "done")))]);
      } else toast("Saved.");
      $("zoom").close();
      route();
    } catch (e) { toast(e.message, true); }
  };
  return el("details", { class: "panel-edit" },
    el("summary", { text: "✎ Edit this panel" }),
    el("label", {}, "What the picture shows", action),
    el("label", {}, "Caption", caption),
    el("label", {}, "Balloons", lines),
    el("label", {}, "Sound effect", sfx),
    el("div", { class: "row-btns" },
      el("button", { type: "button", class: "primary", text: "Save", onclick: () => save(false) }),
      el("button", { type: "button", class: "ghost", text: "↻ Repaint the picture", onclick: () => save(true) })));
}

function screenplayView(story, ch) {
  const wrap = el("article", { class: "screenplay" },
    el("p", { class: "sp-title", text: story.title.toUpperCase() }),
    el("p", { class: "sp-sub", text: `Part ${ch.n}: ${ch.title}` }),
    el("p", { class: "sp-sub", text: story.by ? `Written by ${story.by}` : "" }));
  if (!ch.screenplay?.length) {
    wrap.append(el("p", { class: "muted", text: "The screenplay for this part hasn't been written yet." }));
    if (api.editor.on) {
      const b = el("button", { type: "button", class: "primary", text: "🎬 Write the screenplay" });
      b.addEventListener("click", async () => {
        b.disabled = true;
        b.textContent = "Writing…";
        try {
          ch.screenplay = S.normalizeScreenplay(await api.ask(S.SCREENPLAY_SYSTEM, S.screenplayPrompt(story, ch), { maxTokens: 16000, temperature: 0.7 }));
          await saveChapter(story.id, ch);
          route();
        } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = "🎬 Write the screenplay"; }
      });
      wrap.append(b);
    }
    return wrap;
  }
  for (const e of ch.screenplay) wrap.append(el("p", { class: `sp ${e.t}`, text: e.x }));
  return wrap;
}

function shotList(story, ch, names) {
  const rows = [];
  ch.pages.forEach((pg, pi) => pg.panels.forEach((p) => {
    rows.push(el("tr", {},
      el("td", { class: "num" }, el("strong", { text: p.id.replace("p", "#") }), el("span", { text: `page ${pi + 1}` })),
      el("td", { class: "thumb" }, slot(S.panelImage(story.id, ch.n, p.id), p.action, `aspect-${p.size}`)),
      el("td", {}, el("strong", { text: p.shot }), el("div", { text: p.angle }), el("div", { class: "muted", text: p.camera })),
      el("td", {}, p.scene ? el("div", { class: "scene", text: p.scene }) : null, el("div", { text: p.action }), p.mood ? el("div", { class: "muted", text: `Mood: ${p.mood}` }) : null),
      el("td", {}, p.caption ? el("div", { class: "cap", text: p.caption }) : null,
        ...p.dialogue.map((d) => el("div", {}, el("strong", { text: `${names[d.who] || d.who}: ` }), d.text)),
        p.sfx ? el("div", { class: "sfx-line", text: `SFX: ${p.sfx}` }) : null),
      el("td", { class: "muted", text: p.characters.map((c) => names[c] || c).join(", ") })));
  }));
  return el("div", { class: "shots-wrap" },
    el("div", { class: "row-btns" }, el("button", { type: "button", class: "ghost small", text: "🖨 Print", onclick: () => window.print() })),
    ch.beats?.length ? el("section", { class: "card beats" }, el("h3", { text: "Story beats" }), el("ol", {}, ...ch.beats.map((b) => el("li", { text: b })))) : null,
    el("table", { class: "shots" },
      el("thead", {}, el("tr", {}, ...["Shot", "Frame", "Camera", "Action", "Words", "Cast"].map((h) => el("th", { text: h })))),
      el("tbody", {}, ...rows)));
}

// ---------- zoom dialog ----------

function zoom(content) {
  $("zoom-body").replaceChildren(content);
  if (!$("zoom").open) $("zoom").showModal();
}
$("zoom-close").addEventListener("click", () => $("zoom").close());
$("zoom").addEventListener("click", (e) => { if (e.target === $("zoom")) $("zoom").close(); });

route();
