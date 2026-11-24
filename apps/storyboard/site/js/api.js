// Talking to the house: stories live in the app's shared data, Gemini writes,
// and the image model paints. Writing and painting cost money, so they need
// the admin password, which this device remembers once it's been entered.

import { load, save, remove } from "../lib/data.js";
import { parseJSON } from "./story.js";

export { load, save, remove };

const PW = "storyboard.pw";

export const editor = {
  get password() { return localStorage.getItem(PW) || ""; },
  get on() { return !!this.password; },
  async unlock(pw) {
    const r = await fetch("/_api/editor", { headers: auth(pw) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "That isn't the admin password");
    localStorage.setItem(PW, pw);
  },
  lock() { localStorage.removeItem(PW); },
};

const auth = (pw = editor.password) => (pw ? { Authorization: "Basic " + btoa("admin:" + pw) } : {});

async function fail(r, what) {
  const msg = (await r.json().catch(() => ({}))).error || `HTTP ${r.status}`;
  if (r.status === 401) editor.lock();
  throw new Error(`${what}: ${msg}`);
}

// ask sends one prompt to Gemini and parses its JSON reply.
export async function ask(system, prompt, { maxTokens = 8192, temperature = 0.9 } = {}) {
  const r = await fetch("/_api/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth() },
    body: JSON.stringify({ system, prompt, maxTokens, temperature }),
  });
  if (!r.ok) await fail(r, "Gemini didn't answer");
  const { text } = await r.json();
  return parseJSON(text);
}

// ---------- pictures ----------

export const imageURL = (key, version) => `/_api/image/files/${key}.jpg${version ? `?v=${version}` : ""}`;

export async function paint(jobs) {
  const out = {};
  for (let i = 0; i < jobs.length; i += 40) {
    const r = await fetch("/_api/image/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth() },
      body: JSON.stringify({ jobs: jobs.slice(i, i + 40) }),
    });
    if (!r.ok) await fail(r, "Couldn't start painting");
    Object.assign(out, (await r.json()).images);
  }
  return out;
}

// imageStates returns {key: {state, version, error}} for up to 300 keys.
export async function imageStates(keys) {
  const out = {};
  for (let i = 0; i < keys.length; i += 150) {
    const r = await fetch(`/_api/image/jobs?keys=${keys.slice(i, i + 150).join(",")}`, { cache: "no-store" });
    if (!r.ok) await fail(r, "Couldn't check the pictures");
    Object.assign(out, (await r.json()).images);
  }
  return out;
}
