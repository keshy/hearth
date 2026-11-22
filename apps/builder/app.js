const $ = (id) => document.getElementById(id);
const portal = `${location.protocol}//${location.host.split(".").slice(1).join(".")}`;
$("portal-link").href = `${portal}/`;

let mode = "new";
let domainSuffix = location.host.split(".").slice(1).join(".");
let pollTimer = null;

async function api(path, options = {}) {
  const res = await fetch(`/_api/builder${path}`, {
    ...options,
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function setMode(next) {
  mode = next;
  $("tab-new").classList.toggle("active", mode === "new");
  $("tab-change").classList.toggle("active", mode === "change");
  $("tab-new").setAttribute("aria-selected", String(mode === "new"));
  $("tab-change").setAttribute("aria-selected", String(mode === "change"));
  $("new-fields").hidden = mode !== "new";
  $("change-fields").hidden = mode !== "change";
  $("prompt-label").textContent = mode === "new" ? "What should it do?" : "What should change?";
  $("submit").textContent = mode === "new" ? "Build it" : "Apply change";
}

$("tab-new").addEventListener("click", () => setMode("new"));
$("tab-change").addEventListener("click", () => setMode("change"));

$("name").addEventListener("input", () => {
  const el = $("name");
  el.value = el.value.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  $("preview").textContent = `https://${el.value || "<name>"}.${domainSuffix}`;
});

async function loadInfo() {
  try {
    const info = await api("/info");
    $("info").textContent = `${info.model}`;
    $("info").title = `Commits to ${info.repo}`;
  } catch (err) {
    $("info").textContent = err.message;
  }
}

async function loadApps() {
  try {
    const apps = await api("/apps");
    const list = $("apps");
    const select = $("existing");
    list.replaceChildren();
    select.replaceChildren();
    for (const a of apps) {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = a.url;
      link.textContent = a.title;
      const sub = document.createElement("span");
      sub.className = "hint";
      sub.textContent = ` ${a.name}${a.status !== "live" ? " (" + a.status + ")" : ""}`;
      const left = document.createElement("div");
      left.append(link, sub);
      const change = document.createElement("button");
      change.type = "button";
      change.className = "ghost";
      change.textContent = "Change";
      change.addEventListener("click", () => {
        setMode("change");
        select.value = a.name;
        $("prompt").focus();
      });
      li.append(left, change);
      list.append(li);

      const opt = document.createElement("option");
      opt.value = a.name;
      opt.textContent = `${a.title} (${a.name})`;
      select.append(opt);
    }
    $("apps-empty").hidden = apps.length > 0;
    $("no-apps").hidden = apps.length > 0;
  } catch (err) {
    $("apps-empty").hidden = false;
    $("apps-empty").textContent = err.message;
  }
}

function showJob(job) {
  $("job").hidden = false;
  const running = job.status === "running";
  $("job-title").textContent = running
    ? `${job.revise ? "Changing" : "Building"} ${job.name}…`
    : job.status === "done" ? `${job.name} is live` : `${job.name} didn't build`;
  $("log").replaceChildren(...(job.log || []).map((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    return li;
  }));
  const result = $("result");
  result.hidden = running;
  result.classList.toggle("error", job.status === "failed");
  if (job.status === "done") {
    result.replaceChildren("Open ", Object.assign(document.createElement("a"), { href: job.url, textContent: job.url }));
  } else if (job.status === "failed") {
    result.textContent = job.error;
  }
  $("submit").disabled = running;
}

async function poll(id) {
  clearTimeout(pollTimer);
  try {
    const job = await api(`/jobs/${id}`);
    showJob(job);
    if (job.status === "running") {
      pollTimer = setTimeout(() => poll(id), 1500);
    } else {
      loadApps();
    }
  } catch (err) {
    $("result").hidden = false;
    $("result").textContent = err.message;
    $("submit").disabled = false;
  }
}

$("build-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = mode === "new" ? $("name").value.trim() : $("existing").value;
  const prompt = $("prompt").value.trim();
  if (!name || !prompt) {
    showJob({ name: name || "app", status: "failed", log: [], error: "Give the app a name and describe what you want." });
    return;
  }
  $("submit").disabled = true;
  try {
    const job = await api("/jobs", { method: "POST", body: JSON.stringify({ name, prompt, revise: mode === "change" }) });
    showJob(job);
    poll(job.id);
  } catch (err) {
    showJob({ name, status: "failed", log: [], error: err.message });
  }
});

$("preview").textContent = `https://<name>.${domainSuffix}`;
loadInfo();
loadApps();
