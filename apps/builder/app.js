const $ = (id) => document.getElementById(id);
const domainSuffix = location.host.split(".").slice(1).join(".");
$("portal-link").href = `${location.protocol}//${domainSuffix}/`;

const state = {
  apps: [],
  current: null, // name
  detail: null,
  tab: "preview",
  device: "phone",
  diagnosis: null,
  file: null,
  pollTimer: null,
};

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid);
  return n;
};

async function api(path, options = {}) {
  const res = await fetch(`${location.origin}/_api/builder${path}`, { ...options, headers: { "Content-Type": "application/json" }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const ago = (iso) => {
  const t = new Date(iso).getTime();
  if (!t || t < 0) return "";
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
  return new Date(t).toLocaleDateString(undefined, { dateStyle: "medium" });
};
const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
const statusChip = (a) => {
  if (a.status === "live" && a.health && a.health.state === "down") return ["danger", "down"];
  return { live: ["ok", "live"], failed: ["danger", "deploy failed"], invalid: ["danger", "invalid app.yaml"] }[a.status] || ["", a.status];
};

// ---------- routing ----------
function route() {
  const q = new URLSearchParams(location.hash.slice(1));
  if (q.has("new")) return showNew();
  const name = q.get("app");
  if (name) return openApp(name, q.get("tab") || state.tab);
  showEmpty();
}
const go = (params) => { location.hash = new URLSearchParams(params).toString(); };
window.addEventListener("hashchange", route);

function showView(id) {
  for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== id;
}
function showEmpty() {
  state.current = null;
  renderList();
  showView(state.apps.length ? "view-empty" : "view-new");
}
function showNew() {
  state.current = null;
  renderList();
  showView("view-new");
  $("name").focus();
}

// ---------- the list ----------
async function loadApps() {
  try {
    state.apps = await api("/apps");
  } catch (err) {
    $("apps").replaceChildren(el("li", { class: "status error", text: err.message }));
    return;
  }
  renderList();
}

function renderList() {
  const f = $("filter").value.trim().toLowerCase();
  const apps = state.apps.filter((a) => !f || `${a.name} ${a.title} ${a.description || ""}`.toLowerCase().includes(f));
  apps.sort((a, b) => (b.errors > 0) - (a.errors > 0) || (a.status !== "live") - (b.status !== "live") || a.title.localeCompare(b.title));
  $("apps").replaceChildren(...apps.map((a) => {
    const [tone] = statusChip(a);
    const ic = el("span", { class: "ic" }, a.icon_url ? el("img", { src: a.icon_url, alt: "" }) : a.title.slice(0, 1).toUpperCase());
    const img = ic.querySelector("img");
    if (img) img.addEventListener("error", () => { img.remove(); ic.textContent = a.title.slice(0, 1).toUpperCase(); });
    return el("li", {}, el("button", {
      type: "button", "aria-current": String(state.current === a.name), onclick: () => go({ app: a.name, tab: state.tab }),
    },
    ic,
    el("span", { class: "nm" }, el("b", { text: a.title }), el("small", { text: `${a.name} · ${a.generated ? "builder" : "hand-written"}` })),
    a.errors ? el("span", { class: "badge", title: `${a.errors} browser error(s)`, text: String(a.errors) }) : null,
    el("span", { class: `dot ${tone === "ok" ? "live" : tone === "danger" ? "failed" : ""}`, title: a.status })));
  }));
  $("new-app").setAttribute("aria-current", String(!state.current));
  document.querySelector(".shell").classList.toggle("has-app", !!state.current);
}
$("filter").addEventListener("input", renderList);
$("a-icon").addEventListener("error", () => { $("a-icon").hidden = true; });
$("new-app").addEventListener("click", () => go({ new: "1" }));
$("apps-toggle").addEventListener("click", () => {
  const open = document.querySelector(".side").classList.toggle("open");
  $("apps-toggle").setAttribute("aria-expanded", String(open));
});

// ---------- one app ----------
async function openApp(name, tab) {
  const switching = state.current !== name;
  document.querySelector(".side").classList.remove("open");
  state.current = name;
  state.tab = tab;
  if (switching) {
    state.detail = null;
    state.diagnosis = null;
    state.file = null;
    $("app-job").hidden = true;
  }
  renderList();
  showView("view-app");
  showTab(tab);
  await loadDetail();
}

async function loadDetail() {
  const name = state.current;
  try {
    const d = await api(`/apps/${encodeURIComponent(name)}`);
    if (state.current !== name) return;
    state.detail = d;
  } catch (err) {
    $("a-title").textContent = name;
    $("a-desc").textContent = err.message;
    return;
  }
  renderHead();
  renderTab();
}

function renderHead() {
  const a = state.detail.app;
  $("a-title").textContent = a.title;
  $("a-desc").textContent = a.description || "";
  const [tone, label] = statusChip(a);
  $("a-status").className = `chip ${tone}`;
  $("a-status").textContent = label;
  $("a-kind").textContent = a.generated ? "made with the builder" : `hand-written · ${a.kind}`;
  $("a-errors").hidden = !a.errors;
  $("a-errors").textContent = `${a.errors} browser error${a.errors === 1 ? "" : "s"}`;
  $("a-icon").hidden = !a.icon_url;
  if (a.icon_url) $("a-icon").src = a.icon_url;
  const bits = [a.url.replace(/^https?:\/\//, "")];
  if (a.updated && new Date(a.updated).getFullYear() > 2000) bits.push(`changed ${ago(a.updated)}`);
  if (a.private) bits.push("private: needs the admin password");
  if (a.hidden) bits.push("hidden from the portal");
  $("a-meta").textContent = bits.join(" · ");
  $("a-open").href = a.url;
  $("tab-change").textContent = a.editable ? "Change" : "Change (read-only)";
}

function showTab(tab) {
  state.tab = tab;
  for (const b of $("app-tabs").querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  for (const p of document.querySelectorAll("#view-app .panel")) p.hidden = p.id !== `p-${tab}`;
  if (state.detail) renderTab();
}
for (const b of $("app-tabs").querySelectorAll("button")) {
  b.addEventListener("click", () => go({ app: state.current, tab: b.dataset.tab }));
}

function renderTab() {
  ({ preview: renderPreview, health: renderHealth, change: renderChange, history: renderHistory, files: renderFiles, logs: renderLogs })[state.tab]?.();
}

// ---------- preview ----------
let framedFor = null;
function renderPreview(force = false) {
  const a = state.detail.app;
  const stage = $("stage");
  stage.dataset.device = state.device;
  for (const b of $("devices").querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.device === state.device));
  const notes = [];
  if (a.kind === "link") notes.push("This is a link to another site; it opens in a new tab.");
  else if (a.private) notes.push("Private app: the preview may ask for the admin password.");
  if (a.status !== "live") notes.push(`It isn't live (${a.status}); see Health for why.`);
  $("preview-note").textContent = notes.join(" ");
  if (a.kind === "link" || a.status === "invalid") {
    stage.replaceChildren(el("div", { class: "notice", text: "Nothing to preview here." }));
    framedFor = null;
    return;
  }
  const key = `${a.name}|${a.release || ""}`;
  if (!force && framedFor === key && stage.querySelector("iframe")) return;
  framedFor = key;
  stage.replaceChildren(el("iframe", { src: a.url, title: `${a.title} preview`, loading: "lazy" }));
}
for (const b of $("devices").querySelectorAll("button")) {
  b.addEventListener("click", () => { state.device = b.dataset.device; renderPreview(); });
}
$("reload").addEventListener("click", () => renderPreview(true));

// ---------- health ----------
async function runChecks(ai = false) {
  const name = state.current;
  state.checking = true;
  $("checks").replaceChildren(el("li", { class: "warn" }, el("span", { text: ai ? "Gemini is reading the code… this takes up to a minute." : "Checking…" })));
  if (ai) $("ai-review").disabled = true;
  try {
    const d = await api(`/apps/${encodeURIComponent(name)}/diagnose`, { method: "POST", body: JSON.stringify({ ai }) });
    if (state.current !== name) return;
    state.diagnosis = d;
  } catch (err) {
    state.diagnosis = { checks: [{ level: "error", title: "Couldn't run the checks", detail: err.message }] };
  }
  state.checking = false;
  $("ai-review").disabled = false;
  if (state.tab === "health") renderHealth();
}

function renderHealth() {
  const a = state.detail.app;
  if (!state.diagnosis && !state.checking) runChecks();
  const d = state.diagnosis;
  if (d) {
    $("checks").replaceChildren(...d.checks.map((c) => el("li", { class: c.level },
      el("div", {}, el("b", { text: c.title }), c.file ? el("span", { class: "hint", text: ` · ${c.file}` }) : null,
        c.detail && c.level !== "ok" ? el("pre", { text: c.detail }) : c.detail ? el("div", { class: "hint", text: c.detail }) : null))));
    const review = $("review");
    review.replaceChildren();
    if (d.review_error) review.append(el("p", { class: "status error", text: `Gemini review failed: ${d.review_error}` }));
    if (d.review) {
      review.append(el("div", { class: "review" },
        el("p", {}, el("b", { text: "Gemini: " }), d.review.summary || ""),
        (d.review.issues || []).map((i) => el("div", { class: `issue ${i.severity}` },
          el("p", {}, el("span", { class: `chip ${i.severity === "high" ? "danger" : i.severity === "medium" ? "warn" : ""}`, text: i.severity }), " ", el("code", { text: i.file || "" })),
          el("p", { text: i.problem }), el("p", { class: "muted", text: `Fix: ${i.fix}` }))),
        (d.review.issues || []).length ? null : el("p", { class: "muted", text: "No issues found." })));
    }
    const fixable = a.editable && d.fix_prompt;
    $("fix").hidden = !fixable;
    if (fixable && $("fix-prompt").dataset.for !== `${a.name}|${d.fix_prompt}`) {
      $("fix-prompt").value = d.fix_prompt;
      $("fix-prompt").dataset.for = `${a.name}|${d.fix_prompt}`;
    }
  }
  $("ai-review").hidden = a.kind === "link" || a.kind === "proxied" || a.status === "invalid";
  const errs = state.detail.errors || [];
  $("clear-errors").hidden = !errs.length;
  $("errors").replaceChildren(...(errs.length ? errs.map((e) => el("li", {},
    el("div", { class: "msg", text: e.message }),
    el("div", { class: "hint", text: [e.kind, e.source ? `${e.source.replace(/^https?:\/\/[^/]+/, "")}:${e.line}:${e.col}` : "", e.count > 1 ? `${e.count} times` : "", `last ${ago(e.at)}`, e.page ? `on ${e.page.replace(/^https?:\/\/[^/]+/, "") || "/"}` : ""].filter(Boolean).join(" · ") }),
    e.stack ? el("details", {}, el("summary", { class: "hint", text: "Stack" }), el("pre", { text: e.stack })) : null))
    : [el("li", { class: "muted", text: "None so far." })]));
}
$("recheck").addEventListener("click", () => runChecks(false));
$("ai-review").addEventListener("click", () => runChecks(true));
$("clear-errors").addEventListener("click", async () => {
  await api(`/apps/${encodeURIComponent(state.current)}/errors`, { method: "DELETE" }).catch(() => {});
  state.diagnosis = null;
  await Promise.all([loadDetail(), loadApps()]);
});
$("fix-go").addEventListener("click", () => startJob(state.current, $("fix-prompt").value.trim(), true, $("app-job")));

// ---------- change ----------
function renderChange() {
  const a = state.detail.app;
  $("change-form").hidden = !a.editable;
  $("change-readonly").hidden = a.editable;
}
$("change-form").addEventListener("submit", (e) => {
  e.preventDefault();
  startJob(state.current, $("change-prompt").value.trim(), true, $("app-job"));
});

// ---------- history ----------
function renderHistory() {
  const d = state.detail;
  const a = d.app;
  const hist = d.history || [];
  if (!hist.length) {
    $("history").replaceChildren(el("li", { class: "muted", text: d.history_error || "No history: the apps folder isn't a git checkout." }));
    return;
  }
  $("history").replaceChildren(...hist.map((c, i) => el("li", { class: i === 0 ? "current" : null },
    el("div", { class: "subject", text: c.subject }),
    el("div", { class: "when", text: `${when(c.date)} · ${c.builder ? "builder" : c.author} · ${c.short}${i === 0 ? " · live now" : ""}` }),
    c.prompt ? el("blockquote", { text: c.prompt }) : null,
    el("div", { class: "acts" },
      a.editable && i > 0 ? el("button", { type: "button", class: "ghost small", onclick: () => restore(c) }, "Restore this version") : null,
      a.editable && c.prompt ? el("button", { type: "button", class: "quiet small", onclick: () => { $("change-prompt").value = c.prompt; go({ app: a.name, tab: "change" }); } }, "Reuse this request") : null))));
}

async function restore(c) {
  if (!confirm(`Put ${state.current} back to "${c.subject}" (${c.short})? It's saved as a new version, so you can undo it.`)) return;
  const box = $("app-job");
  try {
    const job = await api(`/apps/${encodeURIComponent(state.current)}/restore`, { method: "POST", body: JSON.stringify({ commit: c.sha }) });
    watch(job, box);
  } catch (err) {
    showJob({ name: state.current, kind: "restore", status: "failed", log: [], error: err.message }, box);
  }
}

// ---------- files ----------
function renderFiles() {
  const files = state.detail.files || [];
  if (!state.file || !files.some((f) => f.path === state.file)) {
    state.file = (files.find((f) => f.path === "index.html") || files[0])?.path || null;
  }
  $("file-list").replaceChildren(...(files.length ? files.map((f) => el("li", {}, el("button", {
    type: "button", "aria-current": String(f.path === state.file), onclick: () => { state.file = f.path; renderFiles(); },
  }, el("span", { text: f.path }), el("small", { text: kb(f.size) })))) : [el("li", { class: "muted", text: state.detail.files_error || "No files." })]));
  if (state.file) loadFile(state.file);
}

async function loadFile(path) {
  const f = (state.detail.files || []).find((x) => x.path === path);
  $("file-name").textContent = path;
  $("file-size").textContent = f ? kb(f.size) : "";
  try {
    const r = await api(`/apps/${encodeURIComponent(state.current)}/file?path=${encodeURIComponent(path)}`);
    if (state.file === path) $("file-body").textContent = r.content;
  } catch (err) {
    if (state.file === path) $("file-body").textContent = err.message;
  }
}

// ---------- logs ----------
function renderLogs() {
  const d = state.detail;
  const jobs = d.jobs || [];
  $("jobs").replaceChildren(...(jobs.length ? jobs.map((j) => el("details", { class: "jobrow", open: j.status === "running" ? "" : null },
    el("summary", {}, el("span", { class: `dot ${j.status === "done" ? "live" : j.status === "failed" ? "failed" : "building"}` }),
      el("b", { text: `${j.kind || (j.revise ? "revise" : "create")}` }), el("span", { class: "hint", text: `${when(j.started)} · ${j.status}` })),
    el("ol", { class: "log" }, (j.log || []).map((l) => el("li", { text: l }))),
    j.error ? el("p", { class: "status error", text: j.error }) : null))
    : [el("p", { class: "muted", text: "No builder jobs for this app since the server started." })]));
  $("build-log").textContent = d.build_log || "";
}

// ---------- jobs ----------
function showJob(job, box) {
  box.hidden = false;
  const running = job.status === "running";
  const verb = { create: "Building", revise: "Changing", restore: "Restoring" }[job.kind] || (job.revise ? "Changing" : "Building");
  const title = running ? `${verb} ${job.name}…` : job.status === "done" ? `${job.name} is live` : `${job.name}: that didn't work`;
  box.replaceChildren(
    el("h2", {}, el("span", { class: `dot ${running ? "building" : job.status === "done" ? "live" : "failed"}` }), " ", title),
    el("ol", { class: "log" }, (job.log || []).map((l) => el("li", { text: l }))),
    job.status === "done" ? el("p", { class: "result" }, el("a", { href: job.url, target: "_blank", rel: "noopener", text: `Open ${job.url} ↗` })) : null,
    job.status === "failed" ? el("p", { class: "notice error result", text: job.error }) : null,
  );
  const log = box.querySelector(".log");
  log.scrollTop = log.scrollHeight;
}

function watch(job, box) {
  clearTimeout(state.pollTimer);
  showJob(job, box);
  const tick = async () => {
    try {
      const j = await api(`/jobs/${job.id}`);
      showJob(j, box);
      if (j.status === "running") { state.pollTimer = setTimeout(tick, 1500); return; }
      await loadApps();
      if (j.status === "done" && box.id === "new-job") { go({ app: j.name, tab: "preview" }); return; }
      if (state.current === j.name) { state.diagnosis = null; framedFor = null; await loadDetail(); }
    } catch (err) {
      showJob({ ...job, status: "failed", error: err.message }, box);
    }
  };
  state.pollTimer = setTimeout(tick, 1200);
}

async function startJob(name, prompt, revise, box) {
  if (!name || !prompt) {
    showJob({ name: name || "app", status: "failed", log: [], error: revise ? "Describe what should change." : "Give the app a name and describe what you want." }, box);
    return;
  }
  try {
    const job = await api("/jobs", { method: "POST", body: JSON.stringify({ name, prompt, revise }) });
    watch(job, box);
  } catch (err) {
    showJob({ name, kind: revise ? "revise" : "create", status: "failed", log: [], error: err.message }, box);
  }
}

$("new-form").addEventListener("submit", (e) => {
  e.preventDefault();
  startJob($("name").value.trim(), $("new-prompt").value.trim(), false, $("new-job"));
});
$("name").addEventListener("input", () => {
  const n = $("name");
  n.value = n.value.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  $("address").textContent = `https://${n.value || "<name>"}.${domainSuffix}`;
});
$("address").textContent = `https://<name>.${domainSuffix}`;

// ---------- start ----------
api("/info").then((info) => {
  $("info").hidden = false;
  $("info").textContent = info.model;
  $("info").title = `Commits to ${info.repo}`;
}).catch(() => {});

await loadApps();
route();
