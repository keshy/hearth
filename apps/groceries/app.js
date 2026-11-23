import { load, save, portalURL } from "./lib/data.js";

const KEY = "items";
const $ = (id) => document.getElementById(id);
$("portal-link").href = portalURL;

let items = [];

function setStatus(message, isError = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", isError);
}

function row(item) {
  const li = document.createElement("li");
  const label = document.createElement("label");
  label.className = "row grow";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = item.done;
  box.addEventListener("change", () => update((all) =>
    all.map((i) => (i.id === item.id ? { ...i, done: box.checked } : i))));
  const text = document.createElement("span");
  text.className = "text";
  text.textContent = item.text;
  label.append(box, text);
  li.append(label);
  return li;
}

function render() {
  const todo = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  $("todo").replaceChildren(...todo.map(row));
  $("done").replaceChildren(...done.map(row));
  $("empty").hidden = todo.length > 0;
  $("todo-count").hidden = todo.length === 0;
  $("todo-count").textContent = `${todo.length} to buy`;
  $("done-card").hidden = done.length === 0;
}

async function refresh() {
  try {
    items = await load(KEY, []);
    render();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function update(change) {
  try {
    items = change(await load(KEY, []));
    await save(KEY, items);
    render();
    setStatus("");
  } catch (err) {
    setStatus(err.message, true);
  }
}

$("add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("item").value.trim();
  if (!text) return;
  $("item").value = "";
  update((all) => [...all, { id: crypto.randomUUID(), text, done: false }]);
});

$("clear").addEventListener("click", () => update((all) => all.filter((i) => !i.done)));

window.addEventListener("focus", refresh);
setInterval(refresh, 30000);
refresh();
