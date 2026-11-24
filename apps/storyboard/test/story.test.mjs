import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../site/js/story.js";

const story = S.normalizeStory({
  title: "Kalki", tagline: "A hero is born", logline: "x", style: "painted",
  cast: [
    { id: "Kalki", name: "Kalki", role: "hero", look: "boy", personality: "brave", main: true },
    { id: "kalki", name: "Kalki again", role: "dup" },
    { name: "Ashwatthama", role: "guardian", look: "giant", main: true },
    { id: "nameless" },
  ],
  places: [{ id: "kasi", name: "Kasi", look: "ghats" }],
  parts: [{ n: 1, title: "Dawn", summary: "s" }, { n: 7, title: "Soon", summary: "Idea: ...", status: "dreaming" }],
}, { id: "kalki", title: "T", by: "Adi", gist: "g" });

test("story bible is cleaned up", () => {
  assert.deepEqual(story.cast.map((c) => c.id), ["kalki", "ashwatthama"]);
  assert.deepEqual(story.parts.map((p) => [p.n, p.status]), [[1, "outline"], [7, "dreaming"]]);
  assert.throws(() => S.normalizeStory({ cast: [], parts: [] }, { id: "x" }));
});

test("chapter keeps only known cast and numbers panels", () => {
  const ch = S.normalizeChapter({
    title: "Dawn",
    pages: [
      { panels: [
        { size: "splash", action: "Wide view of Kasi", place: "kasi", characters: ["kalki", "stranger"], dialogue: [{ who: "Kalki", text: "Hi", kind: "yell" }] },
        { size: "half", action: "Close on Kalki" }, { size: "half", action: "Ashwatthama turns", characters: ["ashwatthama"] },
      ] },
      { panels: [{ size: "giant", action: "A" }, { action: "" }, { size: "third", action: "B" }] },
    ],
  }, story, story.parts[0], "gist");
  const panels = S.allPanels(ch);
  assert.deepEqual(panels.map((p) => p.id), ["p01", "p02", "p03", "p04", "p05"]);
  assert.deepEqual(panels[0].characters, ["kalki"]);
  assert.equal(panels[0].place, "kasi");
  assert.deepEqual(panels[0].dialogue, [{ who: "kalki", text: "Hi", kind: "speech" }]);
  assert.equal(panels[3].size, "half");
  assert.throws(() => S.normalizeChapter({ pages: [{ panels: [{ action: "x" }] }] }, story, story.parts[0]));
});

test("rows pair halves and group thirds", () => {
  const p = (size) => ({ size });
  const r = S.rows([p("splash"), p("half"), p("half"), p("third"), p("third"), p("third"), p("half"), p("third")]);
  assert.deepEqual(r.map((x) => x.map((y) => y.size).join("+")), ["splash", "half+half", "third+third+third", "half", "third"]);
});

test("panel jobs use painted sheets as references, main subject first", () => {
  const ch = { n: 1, title: "Dawn" };
  const panel = { id: "p02", size: "wide", shot: "close-up", angle: "low angle", action: "They meet", characters: ["ashwatthama", "kalki"], place: "kasi", mood: "dusk" };
  const job = S.panelJob(story, ch, panel, new Set(["kalki-cast-kalki", "kalki-cast-ashwatthama"]));
  assert.equal(job.key, "kalki-c1-p02");
  assert.equal(job.aspect, "21:9");
  assert.deepEqual(job.refs, ["kalki-cast-ashwatthama", "kalki-cast-kalki"]);
  assert.match(job.prompt, /ASHWATTHAMA \(reference image 1\)/);
  assert.match(job.prompt, /no text of any kind/i);
  const unpainted = S.panelJob(story, ch, panel, new Set());
  assert.deepEqual(unpainted.refs, []);
  assert.match(unpainted.prompt, /- KALKI: boy/);
});

test("keys and slugs fit the platform's limits", () => {
  assert.equal(S.slug("Story of Kalki & the Saving of Kali-yug"), "story-of-kalki-the-s");
  assert.match(S.panelImage("kalki", 14, "p20"), /^[a-z0-9][a-z0-9-]{0,79}$/);
  assert.match(S.chapterKey("kalki", 14), /^[A-Za-z0-9_-]{1,64}$/);
});

test("parseJSON digs JSON out of a chatty reply", () => {
  assert.deepEqual(S.parseJSON('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
});
