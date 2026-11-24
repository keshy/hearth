// The writers' room: prompts that turn a gist into a story bible, a chapter
// into comic pages, and pages into a screenplay; plus the checks that keep
// whatever the model sends back in shape. No DOM here, so it's testable.

export const SIZES = ["splash", "wide", "half", "third"];
export const ASPECT = { splash: "16:9", wide: "21:9", half: "4:3", third: "3:4" };
export const KINDS = ["speech", "thought", "shout", "whisper"];

export const slug = (s, max = 20) =>
  String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "") || "x";

const str = (v, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const arr = (v) => (Array.isArray(v) ? v : []);

export const storyKey = (sid) => `story-${sid}`;
export const chapterKey = (sid, n) => `ch-${sid}-${n}`;
export const castImage = (sid, cid) => `${sid}-cast-${cid}`;
export const coverImage = (sid) => `${sid}-cover`;
export const panelImage = (sid, n, pid) => `${sid}-c${n}-${pid}`;

// Models sometimes wrap JSON in a code fence or add a stray sentence.
export function parseJSON(text) {
  try { return JSON.parse(text); } catch { /* try harder */ }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error("Gemini's reply wasn't JSON");
}

// ---------- story bible and outline ----------

export const SETUP_SYSTEM = `You are the head writer and production designer of a premium graphic-novel studio that makes stories for children aged 7 to 12, and whose storyboards are good enough to shoot a film from.
The authors give you a story's title and their gist, usually a list of parts. Build the story bible and the outline.

Reply with JSON only, exactly this shape:
{
  "title": "the story's title",
  "tagline": "one thrilling line for the cover, at most 12 words",
  "logline": "the whole saga in two sentences",
  "style": "art direction for every picture: line work, palette, lighting, how technology and the mythic mix, recurring visual motifs (80-120 words)",
  "cast": [{
    "id": "lowercase-slug",
    "name": "display name",
    "role": "who they are in the story, one sentence",
    "age": "age or apparent age",
    "look": "exact visual description an illustrator can repeat on every page: build, face, skin, hair, eyes, costume pieces with colours, signature weapon or prop, any glow or mark (50-90 words)",
    "personality": "how they talk and act, one or two sentences",
    "main": true
  }],
  "places": [{ "id": "lowercase-slug", "name": "display name", "look": "what it looks like, 30-60 words" }],
  "parts": [{ "n": 1, "title": "chapter title, at most 6 words", "summary": "what happens, 4-6 vivid sentences", "status": "ready" }]
}

Rules:
- Keep every part the authors list, in their order and numbering. Expand each gist with creativity, wonder, humour and heart, staying true to the authors' intent.
- If the authors say a part is still being written or dreamt up, set its "status" to "dreaming" and make the summary a suggestion that starts with "Idea:".
- Respect the Mahabharata, Ramayana and Puranic lore for mythic characters; give each a reason to be in this story.
- Cast: up to 16 characters, at most 10 with "main": true. Places: up to 10. ids are short lowercase slugs like "kalki" or "the-complex".
- All designs are original. Never describe a real actor or copy a film's costume exactly; describe your own version.
- It's for children: brave, exciting and sometimes scary, but no gore, no cruelty dwelt on, and good wins through courage, wisdom and kindness.`;

export function setupPrompt({ title, by, gist }) {
  return `Title: ${title}\nBy: ${by || "the family"}\n\nThe authors' gist:\n${gist}`;
}

export function normalizeStory(raw, { id, title, by, gist }) {
  const cast = [];
  const seen = new Set();
  for (const c of arr(raw.cast).slice(0, 16)) {
    const cid = slug(c.id || c.name);
    if (!str(c.name) || seen.has(cid)) continue;
    seen.add(cid);
    cast.push({
      id: cid, name: str(c.name, 60), role: str(c.role, 300), age: str(c.age, 40),
      look: str(c.look, 900), personality: str(c.personality, 400), main: !!c.main,
    });
  }
  const places = [];
  for (const p of arr(raw.places).slice(0, 10)) {
    const pid = slug(p.id || p.name);
    if (str(p.name) && !places.some((x) => x.id === pid)) places.push({ id: pid, name: str(p.name, 60), look: str(p.look, 600) });
  }
  const parts = arr(raw.parts).map((p, i) => ({
    n: Number.isInteger(p.n) && p.n > 0 ? p.n : i + 1,
    title: str(p.title, 80) || `Part ${i + 1}`,
    summary: str(p.summary, 1500),
    status: p.status === "dreaming" ? "dreaming" : "outline",
    gist: "",
  })).slice(0, 40);
  if (!cast.length || !parts.length) throw new Error("Gemini didn't send a cast and an outline; try again");
  return {
    id, title: str(raw.title, 80) || title, by: by || "", gist,
    tagline: str(raw.tagline, 120), logline: str(raw.logline, 500), style: str(raw.style, 1200),
    cast, places, parts, created: Date.now(), updated: Date.now(),
  };
}

// ---------- a chapter as comic pages ----------

export const CHAPTER_SYSTEM = `You are a master comic writer and film storyboard artist. Turn one part of a saga into a chapter of a graphic novel for children aged 7 to 12, laid out so it also works as a shot-by-shot storyboard for a film.

Reply with JSON only, exactly this shape:
{
  "title": "chapter title, at most 6 words",
  "logline": "this chapter in one sentence",
  "beats": ["5 to 8 short story beats, in order"],
  "pages": [{
    "panels": [{
      "size": "splash | wide | half | third",
      "shot": "establishing | wide | full | medium | close-up | extreme close-up | over-the-shoulder | point-of-view | two-shot | insert",
      "angle": "eye level | low angle | high angle | bird's-eye | worm's-eye | dutch tilt",
      "camera": "film note: static, slow push-in, pan left, tracking, crane up, whip pan, etc.",
      "scene": "screenplay slug, e.g. EXT. KASI GHATS - DUSK",
      "place": "a place id from the bible, or empty",
      "characters": ["cast ids visible in this panel, main subject first"],
      "action": "exactly what the picture shows, as one frozen moment: who is where, doing what, expressions, key objects, foreground and background (2-3 sentences)",
      "mood": "lighting and colour mood, a few words",
      "caption": "narrator box text, or empty",
      "dialogue": [{ "who": "cast id", "text": "at most 20 words", "kind": "speech | thought | shout | whisper" }],
      "sfx": "a sound effect word like WHOOSH, or empty"
    }]
  }]
}

Rules:
- 5 to 7 pages and 14 to 20 panels in all. Each page is built from full rows: a splash alone, a wide alone, two halves side by side, or three thirds side by side. List panels in reading order.
- Page 1 opens big: a splash or wide establishing shot. The last panel leaves the reader wanting the next part.
- Direct it like a film: vary shot sizes and angles, use close-ups for feelings and wides for scale, keep screen direction consistent, and give each page a turn or a surprise.
- Every "action" must be drawable as a single image. Use only cast ids from the bible in "characters" and "who"; crowds and unnamed people are described in the action.
- At most 3 balloons per panel and many panels with one or none; let pictures tell the story. Dialogue is short, vivid and in character, with moments of humour and warmth; sprinkle a few Sanskrit or Telugu/Tamil words where natural.
- For children: battles are exciting but bloodless, fear is overcome, and kindness and courage matter.`;

export function chapterPrompt(story, part, gist) {
  const cast = story.cast.map((c) => `- ${c.id}: ${c.name}, ${c.role} (${c.personality})`).join("\n");
  const places = story.places.map((p) => `- ${p.id}: ${p.name}`).join("\n");
  const before = story.parts.filter((p) => p.n < part.n).map((p) => `Part ${p.n} "${p.title}": ${p.summary}`).join("\n");
  return `Saga: ${story.title} by ${story.by}
Logline: ${story.logline}

Cast (ids):
${cast}

Places (ids):
${places || "- (none yet)"}

The story so far:
${before || "(this is the first part)"}

Write Part ${part.n}: "${part.title}".
Outline: ${part.summary}
${gist ? `The authors' gist for this part (follow it; it wins over the outline):\n${gist}` : ""}`;
}

export function normalizeChapter(raw, story, part, gist) {
  const castIds = new Set(story.cast.map((c) => c.id));
  const placeIds = new Set(story.places.map((p) => p.id));
  let count = 0;
  const pages = [];
  for (const pg of arr(raw.pages).slice(0, 10)) {
    const panels = [];
    for (const p of arr(pg.panels).slice(0, 6)) {
      if (!str(p.action)) continue;
      count++;
      const id = `p${String(count).padStart(2, "0")}`;
      const who = (x) => slug(x || "", 20);
      panels.push({
        id,
        size: SIZES.includes(p.size) ? p.size : "half",
        shot: str(p.shot, 40) || "medium",
        angle: str(p.angle, 40) || "eye level",
        camera: str(p.camera, 120),
        scene: str(p.scene, 120),
        place: placeIds.has(slug(p.place || "")) ? slug(p.place) : "",
        characters: [...new Set(arr(p.characters).map(who).filter((c) => castIds.has(c)))].slice(0, 6),
        action: str(p.action, 900),
        mood: str(p.mood, 160),
        caption: str(p.caption, 300),
        dialogue: arr(p.dialogue).slice(0, 4).map((d) => ({
          who: castIds.has(who(d.who)) ? who(d.who) : str(d.who, 40),
          text: str(d.text, 220),
          kind: KINDS.includes(d.kind) ? d.kind : "speech",
        })).filter((d) => d.text),
        sfx: str(p.sfx, 30),
      });
    }
    if (panels.length) pages.push({ panels });
  }
  if (count < 4) throw new Error("Gemini's chapter came back too short; try again");
  return {
    n: part.n, title: str(raw.title, 80) || part.title, logline: str(raw.logline, 400),
    gist: gist || "", beats: arr(raw.beats).map((b) => str(b, 300)).filter(Boolean).slice(0, 12),
    pages, screenplay: [], updated: Date.now(),
  };
}

// rows groups a page's panels into comic rows: wide and splash alone, halves
// in pairs, thirds in threes. Leftovers share a row and stretch.
export function rows(panels) {
  const out = [];
  let i = 0;
  while (i < panels.length) {
    const p = panels[i];
    if (p.size === "splash" || p.size === "wide") { out.push([p]); i++; continue; }
    const take = p.size === "half" ? 2 : 3;
    const row = [p];
    i++;
    while (row.length < take && i < panels.length && panels[i].size === p.size) row.push(panels[i++]);
    out.push(row);
  }
  return out;
}

export const allPanels = (ch) => ch.pages.flatMap((pg) => pg.panels);

// ---------- screenplay ----------

export const SCREENPLAY_SYSTEM = `You are a screenwriter adapting a graphic-novel chapter into a film screenplay in standard format.
Reply with JSON only: {"screenplay": [{"t": "heading | action | character | paren | line | transition", "x": "text"}]}
- "heading" is a scene heading (INT./EXT. PLACE - TIME), "character" a speaker's name in capitals, "paren" a short parenthetical, "line" their dialogue, "transition" e.g. CUT TO: or DISSOLVE TO:.
- Keep every line of dialogue from the panels (you may add a little more), and write the action as vivid film description: what the camera sees and hears, in present tense, a few sentences per beat.
- A new heading whenever the place or time changes. End with a transition or FADE OUT.`;

export function screenplayPrompt(story, ch) {
  const names = Object.fromEntries(story.cast.map((c) => [c.id, c.name]));
  const panels = allPanels(ch).map((p) => ({
    scene: p.scene, shot: `${p.shot}, ${p.angle}, ${p.camera}`, action: p.action, caption: p.caption,
    dialogue: p.dialogue.map((d) => `${names[d.who] || d.who} (${d.kind}): ${d.text}`), sfx: p.sfx,
  }));
  return `Saga: ${story.title}\nChapter ${ch.n}: ${ch.title}\n${ch.logline}\n\nPanels in order:\n${JSON.stringify(panels, null, 1)}`;
}

export function normalizeScreenplay(raw) {
  const kinds = new Set(["heading", "action", "character", "paren", "line", "transition"]);
  return arr(raw.screenplay).filter((e) => kinds.has(e.t) && str(e.x)).map((e) => ({ t: e.t, x: str(e.x, 2000) })).slice(0, 600);
}

// ---------- pictures ----------

const RULES = `Rules: draw only the characters listed, each matching their reference sheet exactly (face, hair, skin, costume, colours, props). Leave calm empty space in the top quarter of the frame for speech balloons. Absolutely no text of any kind: no letters, captions, speech balloons, sound-effect lettering, signs with writing, panel borders, signatures or watermarks. Original character designs that do not resemble any real actor. Child-friendly: no blood or gore.`;

export function castPrompt(story, c) {
  return `Character model sheet for the children's graphic novel "${story.title}".
${c.name.toUpperCase()}: ${c.role}${c.age ? ` Age: ${c.age}.` : ""}
Look: ${c.look}
Personality: ${c.personality}
Show the full body from the front, three-quarter and back, plus a row of three facial expressions that fit their personality. Plain warm light-grey background, even lighting, consistent proportions across every view.
Art direction: ${story.style}
No text, names or labels anywhere. Original design that does not resemble any real actor.`;
}

export function coverPrompt(story, refs) {
  const who = refs.map((c, i) => `- ${c.name} (reference image ${i + 1}): ${c.look}`).join("\n");
  return `Cover painting for the children's graphic novel "${story.title}": ${story.tagline || story.logline}
A heroic, dramatic composition with the heroes front and centre and a hint of the threat looming behind them.
${who}
Art direction: ${story.style}
Leave the top fifth clear and simple for the title, which is added later. ${RULES}`;
}

// panelJob builds the painting request for one panel. Reference sheets go in
// the order the characters are listed (main subject first), up to four.
export function panelJob(story, ch, p, painted) {
  const byId = Object.fromEntries(story.cast.map((c) => [c.id, c]));
  const people = p.characters.map((id) => byId[id]).filter(Boolean);
  const refs = [];
  const lines = people.map((c) => {
    const key = castImage(story.id, c.id);
    if (painted.has(key) && refs.length < 4) {
      refs.push(key);
      return `- ${c.name.toUpperCase()} (reference image ${refs.length}): ${c.look}`;
    }
    return `- ${c.name.toUpperCase()}: ${c.look}`;
  });
  const place = story.places.find((x) => x.id === p.place);
  const prompt = `Comic book panel from the children's graphic novel "${story.title}", chapter ${ch.n} "${ch.title}".
Shot: ${p.shot}, ${p.angle}.${p.scene ? ` Scene: ${p.scene}.` : ""}
What we see: ${p.action}
${lines.length ? `Characters in this panel:\n${lines.join("\n")}` : "No named characters in this panel."}
${place ? `Place: ${place.name}: ${place.look}` : ""}
Mood and lighting: ${p.mood || "cinematic"}
Art direction: ${story.style}
${RULES}`;
  return { key: panelImage(story.id, ch.n, p.id), prompt, refs, aspect: ASPECT[p.size] || "4:3" };
}
