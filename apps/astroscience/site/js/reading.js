// The "so what" layer: turns a computed chart into a few plain-English
// takeaways, each with the evidence behind it and a pointer to the part of
// the app that teaches the rule. Everything here is deterministic; Gemini
// only retells it as a story (see storyPrompt).
import { SIGNS, GRAHAS, ORDER, HOUSES, NAKSHATRAS, DIGNITY, label, signLabel, ordinal } from "./knowledge.js";

export const SIGN_NATURE = [
  "direct, quick to start, competitive",
  "steady, loyal, sensual, slow to change",
  "curious, talkative, versatile",
  "caring, protective, emotionally deep",
  "warm, proud, generous, likes to lead",
  "precise, helpful, analytical",
  "diplomatic, fair-minded, social",
  "intense, private, determined",
  "optimistic, principled, freedom-loving",
  "disciplined, ambitious, practical",
  "independent, idealistic, community-minded",
  "gentle, imaginative, spiritual",
];

const ELEMENT = {
  Fire: "fire: action and enthusiasm",
  Earth: "earth: practical and steady",
  Air: "air: ideas and people",
  Water: "water: feeling and intuition",
};

const KENDRA = [1, 4, 7, 10];
const KONA = [1, 5, 9];
const DUSTHANA = [6, 8, 12];
const UPACHAYA = [3, 6, 10, 11];
const GRAHA7 = ORDER.slice(0, 7);

export const short = (g) => GRAHAS[g].en.replace(" Node", " node");
const houseName = (h) => HOUSES[h].en.toLowerCase();
const list = (xs) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

export function isBenefic(c, g) {
  if (g === "moon") return c.moonPhase.waxing;
  return GRAHAS[g].nature === "benefic";
}

// How well supported each life area (house) is. A teaching heuristic, not a
// classical formula: the lord's strength and placement, who sits there and
// who looks at it. Malefics are welcome in the growth houses (3, 6, 10, 11).
export function houseScores(c) {
  const out = [null];
  for (let h = 1; h <= 12; h++) {
    const H = c.houses[h];
    const lord = c.planets[H.lord];
    const reasons = [];
    let s = 5;
    const ls = lord.strength.score;
    s += (ls - 5) * 0.45;
    reasons.push([`its lord ${short(H.lord)} is ${ls >= 6.5 ? "strong" : ls >= 4 ? "middling" : "weak"} (${ls.toFixed(1)}/10)`, (ls - 5) * 0.45]);
    if (KENDRA.includes(lord.house) || KONA.includes(lord.house)) {
      s += 0.75;
      reasons.push([`the lord sits in a good house (${ordinal(lord.house)})`, 0.75]);
    } else if (DUSTHANA.includes(lord.house) && !DUSTHANA.includes(h)) {
      s -= 1;
      reasons.push([`the lord is hidden in the ${ordinal(lord.house)}`, -1]);
    }
    for (const g of H.occupants) {
      if (isBenefic(c, g)) {
        s += 1;
        reasons.push([`${short(g)} (a benefic) sits here`, 1]);
      } else if (UPACHAYA.includes(h)) {
        s += 0.5;
        reasons.push([`${short(g)} sits here, and malefics do well in growth houses`, 0.5]);
      } else {
        s -= 1;
        reasons.push([`${short(g)} (a malefic) sits here`, -1]);
      }
    }
    for (const g of H.aspectedBy) {
      if (H.occupants.includes(g)) continue;
      if (isBenefic(c, g)) {
        s += 0.5;
        reasons.push([`${short(g)} looks at it kindly`, 0.5]);
      } else if (!UPACHAYA.includes(h)) {
        s -= 0.5;
        reasons.push([`${short(g)} looks at it harshly`, -0.5]);
      }
    }
    const score = Math.max(0, Math.min(10, s));
    const tone = score >= 6.5 ? "good" : score >= 4.5 ? "mixed" : "effort";
    const verdict = tone === "good" ? "Well supported" : tone === "mixed" ? "Mixed" : "Needs effort";
    out.push({ house: h, score, tone, verdict, reasons });
  }
  return out;
}

export function currentPeriod(dasha, ms = Date.now()) {
  const i = dasha.periods.findIndex((p) => ms >= p.start && ms < p.end);
  if (i < 0) return null;
  const maha = dasha.periods[i];
  const sub = maha.sub.find((s) => ms >= s.start && ms < s.end) || maha.sub[0];
  return { maha, sub, next: dasha.periods[i + 1] || null, index: i };
}

// The life areas a planet switches on when it runs a period: what it owns and
// where it sits.
export function periodThemes(c, g) {
  const p = c.planets[g];
  const hs = [...new Set([p.house, ...p.owns])].sort((a, b) => a - b);
  return { houses: hs, words: hs.map(houseName) };
}

function strongestAndWeakest(c) {
  const ranked = GRAHA7.slice().sort((a, b) => c.planets[b].strength.score - c.planets[a].strength.score);
  return { strong: ranked[0], weak: ranked.at(-1), ranked };
}

function lordPhrase(c, h) {
  const lord = c.houses[h].lord;
  const p = c.planets[lord];
  return `${label(lord)} rules your ${ordinal(h)} house and sits in the ${ordinal(p.house)} (${HOUSES[p.house].en.toLowerCase()}), so ${HOUSES[h].short} matters flow into ${HOUSES[p.house].themes}`;
}

export function reading(c, dasha, { name = "", now = Date.now() } = {}) {
  const lagna = c.lagna.sign;
  const L = SIGNS[lagna];
  const ll = c.lagnaLord;
  const llp = c.planets[ll];
  const moon = c.planets.moon;
  const star = NAKSHATRAS[c.star.index];
  const { strong, weak } = strongestAndWeakest(c);
  const scores = houseScores(c);
  const byScore = scores.slice(1).slice().sort((a, b) => b.score - a.score);
  const best = byScore.slice(0, 2), worst = byScore.slice(-2).reverse();
  const cur = currentPeriod(dasha, now);
  const present = c.yogas.filter((y) => y.present && !y.id.startsWith("kemadruma"));
  const cautions = c.yogas.filter((y) => y.present && (y.id === "kemadruma" || y.id === "sevvai_dosham" || y.id === "kala_sarpa" || y.name.startsWith("Neecham")));
  const helpful = present.filter((y) => !cautions.includes(y));

  const T = [];

  T.push({
    id: "self",
    kicker: "Personality · lagnam (rising sign)",
    title: `${L.en} rising: ${SIGN_NATURE[lagna]}`,
    body: [
      `The lagnam is the sign rising on the eastern horizon at birth. It sets house 1, and so the whole chart. ${L.en} (${L.ta}) is a ${ELEMENT[L.element]} sign, ${L.mode.toLowerCase()} in style.`,
      `Its lord is ${label(ll)}, the chart's captain. It sits in your ${ordinal(llp.house)} house (${HOUSES[llp.house].en.toLowerCase()}), so a lot of your energy goes toward ${HOUSES[llp.house].themes}. ${llp.strength.score >= 6.5 ? "It's strong, which steadies the whole chart." : llp.strength.score < 4 ? "It's on the weak side, so confidence and health benefit from routine and care." : "It's of middling strength."}`,
    ],
    why: [`Lagnam ${signLabel(lagna)}`, `Lord ${short(ll)}`, `${short(ll)} in house ${llp.house}`, `${short(ll)} ${llp.strength.score.toFixed(1)}/10`],
    learn: { tab: "houses", label: "How houses and their lords work", select: { kind: "house", id: 1 } },
    highlight: { kind: "house", id: 1 },
  });

  T.push({
    id: "mind",
    kicker: "Mind · rasi (Moon sign) and natchathiram",
    title: `Moon in ${SIGNS[moon.sign].en}, star ${star[0]}: ${star[4]}`,
    body: [
      `Tamils call the Moon's sign your rasi, and its star your natchathiram; they're what calendars and horoscope columns use. The Moon shows the mind and moods.`,
      `${SIGNS[moon.sign].en} is ${ELEMENT[SIGNS[moon.sign].element]}, and ${star[0]} (${star[1]}, symbol: ${star[3]}) is about ${star[4]}. The Moon is ${c.moonPhase.waxing ? "waxing (growing), which makes it a gentle benefic" : "waning, so feelings can run quieter or more inward"}, and it sits in your ${ordinal(moon.house)} house (${HOUSES[moon.house].en.toLowerCase()}).`,
    ],
    why: [`Rasi ${signLabel(moon.sign)}`, `Star ${star[0]} pada ${c.star.pada}`, c.moonPhase.waxing ? "Waxing Moon" : "Waning Moon", `Moon ${moon.strength.score.toFixed(1)}/10`],
    learn: { tab: "planets", label: "Meet the nine grahas", select: { kind: "planet", id: "moon" } },
    highlight: { kind: "planet", id: "moon" },
  });

  const sp = c.planets[strong];
  T.push({
    id: "strong",
    kicker: "Your strongest planet",
    title: `${label(strong)} carries this chart`,
    body: [
      `${GRAHAS[strong].en} stands for ${GRAHAS[strong].karaka.slice(0, 4).join(", ")}. Here it is ${DIGNITY[sp.dignity].en.toLowerCase()}${sp.combust ? " (though dimmed by the Sun)" : ""} and in your ${ordinal(sp.house)} house, scoring ${sp.strength.score.toFixed(1)}/10.`,
      sp.owns.length
        ? `It rules your ${list(sp.owns.map(ordinal))} house${sp.owns.length > 1 ? "s" : ""} (${list(sp.owns.map(houseName))}), so those are areas where things tend to come more easily, with ${GRAHAS[strong].traits}.`
        : `As a shadow planet it rules no house; it acts through the sign it sits in.`,
    ],
    why: [DIGNITY[sp.dignity].en, `House ${sp.house}`, ...sp.strength.parts.slice(1).map(([t]) => t)],
    learn: { tab: "planets", label: "How strength is scored", select: { kind: "planet", id: strong } },
    highlight: { kind: "planet", id: strong },
  });

  const wp = c.planets[weak];
  T.push({
    id: "weak",
    kicker: "The planet that asks for effort",
    title: `${label(weak)} needs care`,
    body: [
      `${GRAHAS[weak].en} is the weakest of the seven visible planets here (${wp.strength.score.toFixed(1)}/10): ${DIGNITY[wp.dignity].en.toLowerCase()}${wp.combust ? ", and combust (too close to the Sun)" : ""}, in your ${ordinal(wp.house)} house.`,
      `That isn't a curse. It means its themes (${GRAHAS[weak].karaka.slice(0, 3).join(", ")}${wp.owns.length ? `, and the ${list(wp.owns.map(houseName))} house${wp.owns.length > 1 ? "s" : ""} it rules` : ""}) take conscious effort. Tradition strengthens it on its day, ${GRAHAS[weak].weekday}${GRAHAS[weak].gem ? `, and with its gem, ${GRAHAS[weak].gem}` : ""}.`,
    ],
    why: [DIGNITY[wp.dignity].en, `House ${wp.house}`, ...wp.strength.parts.slice(1).map(([t]) => t)],
    learn: { tab: "planets", label: "Dignity: exalted, own, enemy, debilitated", select: { kind: "planet", id: weak } },
    highlight: { kind: "planet", id: weak },
  });

  T.push({
    id: "areas",
    kicker: "Life areas (bhavams)",
    title: `Easiest: ${list(best.map((b) => houseName(b.house)))}. Work at: ${list(worst.map((b) => houseName(b.house)))}`,
    body: [
      `Each of the 12 houses is a life area. How well one can deliver depends on its lord's strength and placement, which planets sit in it, and which planets look at it.`,
      `Your best-supported: house ${best[0].house} (${HOUSES[best[0].house].themes}) and house ${best[1].house}. The ones that need effort: house ${worst[0].house} (${HOUSES[worst[0].house].themes}) and house ${worst[1].house}.`,
    ],
    why: [...best.map((b) => `${ordinal(b.house)} ${b.score.toFixed(1)}/10`), ...worst.map((b) => `${ordinal(b.house)} ${b.score.toFixed(1)}/10`)],
    learn: { tab: "areas", label: "See all 12 life areas ranked" },
    highlight: { kind: "house", id: best[0].house },
  });

  if (cur) {
    const mt = periodThemes(c, cur.maha.lord), st = periodThemes(c, cur.sub.lord);
    const fmt = (ms) => new Date(ms).toLocaleDateString(undefined, { month: "short", year: "numeric" });
    T.push({
      id: "now",
      kicker: "This chapter of life · dasha",
      title: `${short(cur.maha.lord)} period, ${short(cur.sub.lord)} sub-period (until ${fmt(cur.sub.end)})`,
      body: [
        `The Vimshottari dasha splits life into nine planetary chapters, starting from your birth star. You're in ${label(cur.maha.lord)}'s ${GRAHAS[cur.maha.lord].years}-year chapter (${fmt(cur.maha.start)} to ${fmt(cur.maha.end)}).`,
        `${short(cur.maha.lord)} sits in and rules your ${list(mt.houses.map(ordinal))} house${mt.houses.length > 1 ? "s" : ""}, so this chapter keeps bringing up ${list(mt.words)}. Right now ${short(cur.sub.lord)}'s sub-period adds ${list(st.words)}.${cur.next ? ` Next chapter: ${short(cur.next.lord)}, from ${fmt(cur.next.start)}.` : ""}`,
      ],
      why: [`${short(cur.maha.lord)} dasa`, `${short(cur.sub.lord)} bhukti`, `Houses ${mt.houses.join(", ")}`],
      learn: { tab: "dasha", label: "See the whole 120-year timeline" },
      highlight: { kind: "planet", id: cur.maha.lord },
    });
  }

  T.push({
    id: "yogas",
    kicker: "Special combinations · yogas",
    title: helpful.length ? `${helpful.length} helpful yoga${helpful.length > 1 ? "s" : ""}${cautions.length ? `, ${cautions.length} to note` : ""}` : cautions.length ? `${cautions.length} combination${cautions.length > 1 ? "s" : ""} to note` : "No classic yogas, which is perfectly common",
    body: [
      `Yogas are named patterns: certain planets together, facing each other, or swapping signs. They add emphasis rather than override the rest of the chart.`,
      helpful.length ? `Helpful: ${list(helpful.slice(0, 4).map((y) => `${y.name} (${y.en})`))}.` : "",
      cautions.length ? `To note: ${list(cautions.map((y) => y.name))}. Each comes with well-known exceptions; the Yogas tab explains them.` : "",
    ].filter(Boolean),
    why: [...helpful.slice(0, 3), ...cautions.slice(0, 2)].map((y) => y.name),
    learn: { tab: "yogas", label: "How each yoga is formed" },
    highlight: helpful[0] ? { kind: "planet", id: helpful[0].involves[0] } : null,
  });

  const who = name ? `${name}'s chart` : "This chart";
  const headline = `${who} in one breath: ${L.en} rising (${SIGN_NATURE[lagna].split(", ").slice(0, 2).join(", ")}), a ${SIGNS[moon.sign].en} Moon, ${short(strong)} as the strongest planet, and ${cur ? `a ${["rahu", "ketu"].includes(cur.maha.lord) ? GRAHAS[cur.maha.lord].ta : short(cur.maha.lord)} chapter now` : "a long life ahead"}.`;
  return { headline, takeaways: T, scores, strong, weak, current: cur };
}

// One line for the top of each "how it works" tab.
export function tabTakeaway(tab, c, r) {
  const P = c.planets;
  switch (tab) {
    case "planets":
      return `Take-away: ${label(r.strong)} is strongest (${P[r.strong].strength.score.toFixed(1)}/10) and ${label(r.weak)} weakest (${P[r.weak].strength.score.toFixed(1)}/10). Strength is mostly about the sign a planet is in: exalted and own signs are best, enemy and debilitated signs worst.`;
    case "houses":
      return `Take-away: ${lordPhrase(c, 1)}. Follow the arrows: every house "sends" its matters to wherever its lord sits.`;
    case "aspects": {
      const j = P.jupiter, s = P.saturn;
      return `Take-away: Guru (Jupiter) looks at your houses ${j.aspects.join(", ")}, protecting ${list(j.aspects.map(houseName))}; Sani (Saturn) looks at ${s.aspects.join(", ")}, where it tests and slows things down. A planet's glance is like its presence, a bit weaker.`;
    }
    case "yogas": {
      const n = c.yogas.filter((y) => y.present).length;
      return `Take-away: ${n} of the patterns below are present in this chart (marked). Yogas add emphasis; read them together with planet strength.`;
    }
    case "dasha":
      return r.current
        ? `Take-away: you're in ${label(r.current.maha.lord)}'s chapter, which switches on your ${list(periodThemes(c, r.current.maha.lord).words)}.`
        : "";
    default:
      return "";
  }
}

// Facts for Gemini, small enough for the 4 KB prompt limit.
export function storyFacts(c, r, name) {
  const P = c.planets;
  const g = (id) => ({
    planet: `${GRAHAS[id].ta} (${GRAHAS[id].en})`, sign: SIGNS[P[id].sign].en, house: P[id].house,
    dignity: P[id].dignity, strength: Math.round(P[id].strength.score * 10) / 10,
    rules: P[id].owns, retro: P[id].retro || undefined, combust: P[id].combust || undefined,
  });
  return {
    name: name || undefined,
    lagna: SIGNS[c.lagna.sign].en,
    lagna_lord: g(c.lagnaLord),
    moon: { ...g("moon"), star: NAKSHATRAS[c.star.index][0], waxing: c.moonPhase.waxing },
    strongest: g(r.strong),
    weakest: g(r.weak),
    best_houses: r.scores.slice(1).sort((a, b) => b.score - a.score).slice(0, 3).map((h) => `${h.house} ${HOUSES[h.house].en}`),
    effort_houses: r.scores.slice(1).sort((a, b) => a.score - b.score).slice(0, 2).map((h) => `${h.house} ${HOUSES[h.house].en}`),
    current_period: r.current ? { dasa: GRAHAS[r.current.maha.lord].en, bhukti: GRAHAS[r.current.sub.lord].en, themes: periodThemes(c, r.current.maha.lord).words } : undefined,
    yogas: c.yogas.filter((y) => y.present).map((y) => y.name).slice(0, 6),
  };
}

export const STORY_SYSTEM = `You are a warm, clear teacher of Tamil (South Indian, sidereal) astrology explaining a birth chart to a curious beginner who reads English only.
You get facts computed from the chart as JSON. Write a short reading that helps them understand what the chart says and why.
Rules:
- Use only the facts given; don't invent placements.
- Plain English. When you use a Tamil term, put the English after it, e.g. "Sukran (Venus)", "lagnam (rising sign)".
- 4 short paragraphs: who they are (lagna and its lord), their mind (Moon and star), their gifts and growth areas (strongest/weakest planet, best/effort houses), and the current chapter (dasha).
- Frame everything as tendencies and invitations, never fate. No predictions about death, illness, accidents, divorce or money amounts.
- End the last paragraph with one gentle sentence noting this is a cultural tradition to enjoy, not a prediction.
Reply with JSON only: {"title": string (max 8 words), "paragraphs": [string, string, string, string]}`;
