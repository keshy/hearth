import { load, save, portalURL } from "./lib/data.js";

const KEY = "notes";
const form = document.getElementById("add-form");
const input = document.getElementById("note-input");
const list = document.getElementById("list");
const empty = document.getElementById("empty");
const status = document.getElementById("status");

document.getElementById("portal-link").href = portalURL;

let notes = [];

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function render() {
  list.replaceChildren(...notes.map((note) => {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = note.text;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "ghost";
    del.textContent = "Remove";
    del.setAttribute("aria-label", `Remove ${note.text}`);
    del.addEventListener("click", () => removeNote(note.id));
    li.append(text, del);
    return li;
  }));
  empty.hidden = notes.length > 0;
}

async function refresh() {
  try {
    notes = await load(KEY, []);
    render();
  } catch (err) {
    setStatus(err.message, true);
  }
}

// Reload right before writing so concurrent edits from other devices survive.
async function update(change) {
  try {
    const latest = await load(KEY, []);
    notes = change(latest);
    await save(KEY, notes);
    render();
    setStatus("");
  } catch (err) {
    setStatus(err.message, true);
  }
}

function removeNote(id) {
  update((current) => current.filter((n) => n.id !== id));
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  update((current) => [{ id: crypto.randomUUID(), text, added: Date.now() }, ...current]);
});

window.addEventListener("focus", refresh);
setInterval(refresh, 30000);
refresh();
