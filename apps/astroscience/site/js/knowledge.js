// The static rules of Tamil (Parashari) astrology used across the app.
// Tamil terms are romanized with their English meaning; where traditions
// disagree (mostly about Rahu and Ketu) the note says so.

export const SIGNS = [
  { ta: "Mesham", en: "Aries", glyph: "♈", lord: "mars", element: "Fire", mode: "Movable", animal: "Ram" },
  { ta: "Rishabam", en: "Taurus", glyph: "♉", lord: "venus", element: "Earth", mode: "Fixed", animal: "Bull" },
  { ta: "Mithunam", en: "Gemini", glyph: "♊", lord: "mercury", element: "Air", mode: "Dual", animal: "Couple" },
  { ta: "Kadagam", en: "Cancer", glyph: "♋", lord: "moon", element: "Water", mode: "Movable", animal: "Crab" },
  { ta: "Simmam", en: "Leo", glyph: "♌", lord: "sun", element: "Fire", mode: "Fixed", animal: "Lion" },
  { ta: "Kanni", en: "Virgo", glyph: "♍", lord: "mercury", element: "Earth", mode: "Dual", animal: "Maiden" },
  { ta: "Thulam", en: "Libra", glyph: "♎", lord: "venus", element: "Air", mode: "Movable", animal: "Scales" },
  { ta: "Viruchigam", en: "Scorpio", glyph: "♏", lord: "mars", element: "Water", mode: "Fixed", animal: "Scorpion" },
  { ta: "Dhanusu", en: "Sagittarius", glyph: "♐", lord: "jupiter", element: "Fire", mode: "Dual", animal: "Archer" },
  { ta: "Magaram", en: "Capricorn", glyph: "♑", lord: "saturn", element: "Earth", mode: "Movable", animal: "Sea-goat" },
  { ta: "Kumbam", en: "Aquarius", glyph: "♒", lord: "saturn", element: "Air", mode: "Fixed", animal: "Water pot" },
  { ta: "Meenam", en: "Pisces", glyph: "♓", lord: "jupiter", element: "Water", mode: "Dual", animal: "Fish" },
];

// Natural friendships (naisargika maitri) follow Parashara.
export const GRAHAS = {
  sun: {
    ta: "Suriyan", alt: "Ravi, Aadhithyan", en: "Sun", abbr: "Su", glyph: "☉", color: "#e8590c",
    nature: "malefic", natureNote: "a mild malefic (krura graha): hot, separating",
    karaka: ["soul and self", "father", "authority and government", "health and vitality", "fame"],
    traits: "confidence, leadership, pride, purpose",
    own: [4], exalt: [0, 10], debil: [6, 10], mt: [4, 0, 20],
    friends: ["moon", "mars", "jupiter"], neutral: ["mercury"], enemies: ["venus", "saturn"],
    aspects: [7], years: 6, weekday: "Sunday", gem: "Ruby", combust: null,
  },
  moon: {
    ta: "Chandran", alt: "Thingal, Soman", en: "Moon", abbr: "Mo", glyph: "☽", color: "#4dabf7",
    nature: "benefic", natureNote: "benefic when waxing (bright), weaker when waning",
    karaka: ["mind and emotions", "mother", "public and popularity", "water, travel", "nourishment"],
    traits: "sensitivity, care, imagination, moods",
    own: [3], exalt: [1, 3], debil: [7, 3], mt: [1, 3, 30],
    friends: ["sun", "mercury"], neutral: ["mars", "jupiter", "venus", "saturn"], enemies: [],
    aspects: [7], years: 10, weekday: "Monday", gem: "Pearl", combust: 12,
  },
  mars: {
    ta: "Sevvai", alt: "Angarakan, Kujan", en: "Mars", abbr: "Ma", glyph: "♂", color: "#e03131",
    nature: "malefic", natureNote: "a malefic: fiery, cutting, energetic",
    karaka: ["courage and drive", "brothers", "land and property", "surgery, engineering, sport", "blood"],
    traits: "courage, energy, competitiveness, temper",
    own: [0, 7], exalt: [9, 28], debil: [3, 28], mt: [0, 0, 12],
    friends: ["sun", "moon", "jupiter"], neutral: ["venus", "saturn"], enemies: ["mercury"],
    aspects: [4, 7, 8], years: 7, weekday: "Tuesday", gem: "Red coral", combust: 17,
  },
  mercury: {
    ta: "Budhan", alt: "Sowmyan", en: "Mercury", abbr: "Me", glyph: "☿", color: "#2f9e44",
    nature: "benefic", natureNote: "takes on the nature of the planets it sits with",
    karaka: ["intellect and speech", "learning and writing", "trade and maths", "maternal uncle", "skin and nerves"],
    traits: "wit, analysis, communication, adaptability",
    own: [2, 5], exalt: [5, 15], debil: [11, 15], mt: [5, 16, 20],
    friends: ["sun", "venus"], neutral: ["mars", "jupiter", "saturn"], enemies: ["moon"],
    aspects: [7], years: 17, weekday: "Wednesday", gem: "Emerald", combust: 14,
  },
  jupiter: {
    ta: "Guru", alt: "Viyazhan, Brihaspathi", en: "Jupiter", abbr: "Ju", glyph: "♃", color: "#f08c00",
    nature: "benefic", natureNote: "the greatest benefic: expands and protects",
    karaka: ["wisdom and dharma", "children", "teachers and elders", "wealth", "husband (in a woman's chart)"],
    traits: "wisdom, optimism, generosity, ethics",
    own: [8, 11], exalt: [3, 5], debil: [9, 5], mt: [8, 0, 10],
    friends: ["sun", "moon", "mars"], neutral: ["saturn"], enemies: ["mercury", "venus"],
    aspects: [5, 7, 9], years: 16, weekday: "Thursday", gem: "Yellow sapphire", combust: 11,
  },
  venus: {
    ta: "Sukran", alt: "Velli, Bhargavan", en: "Venus", abbr: "Ve", glyph: "♀", color: "#d6336c",
    nature: "benefic", natureNote: "a benefic: pleasure, harmony, refinement",
    karaka: ["spouse (in a man's chart) and love", "art, music and beauty", "comforts, vehicles, jewellery", "romance", "diplomacy"],
    traits: "charm, artistry, love of comfort, sociability",
    own: [1, 6], exalt: [11, 27], debil: [5, 27], mt: [6, 0, 15],
    friends: ["mercury", "saturn"], neutral: ["mars", "jupiter"], enemies: ["sun", "moon"],
    aspects: [7], years: 20, weekday: "Friday", gem: "Diamond", combust: 10,
  },
  saturn: {
    ta: "Sani", alt: "Manthan, Sanaischaran", en: "Saturn", abbr: "Sa", glyph: "♄", color: "#5f3dc4",
    nature: "malefic", natureNote: "the great malefic: slow, testing, but rewards persistence",
    karaka: ["longevity", "discipline and hard work", "servants and labour", "delays and sorrow", "justice"],
    traits: "patience, discipline, endurance, seriousness",
    own: [9, 10], exalt: [6, 20], debil: [0, 20], mt: [10, 0, 20],
    friends: ["mercury", "venus"], neutral: ["jupiter"], enemies: ["sun", "moon", "mars"],
    aspects: [3, 7, 10], years: 19, weekday: "Saturday", gem: "Blue sapphire", combust: 15,
  },
  rahu: {
    ta: "Rahu", alt: "", en: "North Node", abbr: "Ra", glyph: "☊", color: "#495057",
    nature: "malefic", natureNote: "a shadow planet (chaya graha): amplifies and obsesses; acts like Saturn",
    karaka: ["ambition and obsession", "foreign lands and people", "technology and the unconventional", "sudden events", "illusion"],
    traits: "hunger for more, boldness, unconventional paths",
    own: [], exalt: [1, 20], debil: [7, 20], mt: null,
    friends: ["mercury", "venus", "saturn"], neutral: ["jupiter"], enemies: ["sun", "moon", "mars"],
    aspects: [7], years: 18, weekday: "—", gem: "Hessonite (gomedhakam)", combust: null,
    note: "Rahu and Ketu are the points where the Moon's path crosses the Sun's: the eclipse points. Traditions differ on their exaltation signs and aspects; this app uses Taurus/Scorpio and the 7th aspect by default.",
  },
  ketu: {
    ta: "Ketu", alt: "", en: "South Node", abbr: "Ke", glyph: "☋", color: "#868e96",
    nature: "malefic", natureNote: "a shadow planet: detaches and spiritualises; acts like Mars",
    karaka: ["detachment", "spirituality and moksha", "past-life skill", "intuition", "sudden loss"],
    traits: "insight, renunciation, unusual talent",
    own: [], exalt: [7, 20], debil: [1, 20], mt: null,
    friends: ["mars", "venus", "saturn"], neutral: ["jupiter", "mercury"], enemies: ["sun", "moon"],
    aspects: [7], years: 7, weekday: "—", gem: "Cat's eye (vaidooryam)", combust: null,
    note: "Ketu is always exactly opposite Rahu.",
  },
};

export const ORDER = ["sun", "moon", "mars", "mercury", "jupiter", "venus", "saturn", "rahu", "ketu"];

export const HOUSES = [
  null,
  { ta: "Lagnam · Thanu sthanam", en: "Self", themes: "body, personality, health, how life starts", karaka: "sun", short: "self" },
  { ta: "Dhana sthanam", en: "Wealth & speech", themes: "money, family, speech, food, early education", karaka: "jupiter", short: "wealth" },
  { ta: "Dhairya sthanam", en: "Courage & siblings", themes: "younger siblings, courage, effort, short trips, communication", karaka: "mars", short: "courage" },
  { ta: "Sukha sthanam", en: "Home & mother", themes: "mother, home, land, vehicles, inner happiness, schooling", karaka: "moon", short: "home" },
  { ta: "Poorva punya sthanam", en: "Children & creativity", themes: "children, intelligence, creativity, romance, past-life merit", karaka: "jupiter", short: "children" },
  { ta: "Roga Runa Sathru sthanam", en: "Health battles & rivals", themes: "illness, debts, enemies, competition, service", karaka: "mars", short: "rivals" },
  { ta: "Kalathra sthanam", en: "Marriage & partners", themes: "spouse, partnerships, business deals, the public", karaka: "venus", short: "partners" },
  { ta: "Ayul sthanam", en: "Longevity & secrets", themes: "lifespan, sudden events, inheritance, research, the hidden", karaka: "saturn", short: "longevity" },
  { ta: "Bhagya sthanam", en: "Fortune & dharma", themes: "luck, father, guru, higher learning, pilgrimage, ethics", karaka: "jupiter", short: "fortune" },
  { ta: "Karma sthanam", en: "Career & status", themes: "profession, reputation, authority, actions in the world", karaka: "mercury", short: "career" },
  { ta: "Labha sthanam", en: "Gains & friends", themes: "income, gains, elder siblings, friends, wishes fulfilled", karaka: "jupiter", short: "gains" },
  { ta: "Vraya sthanam", en: "Loss & liberation", themes: "expenses, foreign lands, sleep, isolation, moksha", karaka: "saturn", short: "release" },
];

export const HOUSE_GROUPS = [
  { id: "kendra", ta: "Kendram", en: "Angles (pillars)", houses: [1, 4, 7, 10], why: "The four pillars of the chart. Planets here act strongly and visibly." },
  { id: "kona", ta: "Thirikonam", en: "Trines (fortune)", houses: [1, 5, 9], why: "Houses of luck and merit. Their lords are the most auspicious in any chart." },
  { id: "dusthana", ta: "Maraivu sthanam", en: "Hidden / difficult houses", houses: [6, 8, 12], why: "\"Hidden\" houses. Planets here struggle to give their results openly." },
  { id: "upachaya", ta: "Upachayam", en: "Growth houses", houses: [3, 6, 10, 11], why: "Houses that improve with time. Malefics actually do well here." },
  { id: "maraka", ta: "Maraka sthanam", en: "Maraka (critical) houses", houses: [2, 7], why: "Houses whose lords can bring critical periods for health." },
];

// Nakshatram: [Tamil name, Sanskrit name, deity, symbol, keyword, gana]
export const NAKSHATRAS = [
  ["Ashwini", "Ashvini", "Ashvini Kumaras (divine healers)", "Horse's head", "swift healing and new beginnings", "Deva"],
  ["Bharani", "Bharani", "Yama (lord of dharma and death)", "Yoni", "bearing, restraint and intensity", "Manushya"],
  ["Karthigai", "Krittika", "Agni (fire)", "Razor / flame", "sharpness and purification", "Rakshasa"],
  ["Rohini", "Rohini", "Brahma (the creator)", "Chariot", "growth, beauty and fertility", "Manushya"],
  ["Mirugaseeridam", "Mrigashira", "Soma (the Moon)", "Deer's head", "curiosity and searching", "Deva"],
  ["Thiruvathirai", "Ardra", "Rudra (the storm)", "Teardrop", "storms that clear and transform", "Manushya"],
  ["Punarpoosam", "Punarvasu", "Aditi (mother of the gods)", "Bow and quiver", "renewal and return of light", "Deva"],
  ["Poosam", "Pushya", "Brihaspati (Jupiter)", "Cow's udder / flower", "nourishment and care", "Deva"],
  ["Ayilyam", "Ashlesha", "Nagas (serpents)", "Coiled serpent", "entwining insight and hypnotism", "Rakshasa"],
  ["Magam", "Magha", "Pitrs (ancestors)", "Royal throne", "lineage, royalty and tradition", "Rakshasa"],
  ["Pooram", "Purva Phalguni", "Bhaga (delight)", "Front legs of a bed", "pleasure, rest and creativity", "Manushya"],
  ["Uthiram", "Uttara Phalguni", "Aryaman (patronage)", "Back legs of a bed", "kindness, contracts and partnership", "Manushya"],
  ["Hastham", "Hasta", "Savitr (the Sun)", "Hand", "skill of the hands and cleverness", "Deva"],
  ["Chithirai", "Chitra", "Vishvakarma (divine architect)", "Bright jewel", "brilliance, design and craft", "Rakshasa"],
  ["Swathi", "Swati", "Vayu (wind)", "Young sprout in the wind", "independence and flexibility", "Deva"],
  ["Visakam", "Vishakha", "Indra-Agni", "Triumphal arch", "purpose and determination", "Rakshasa"],
  ["Anusham", "Anuradha", "Mitra (friendship)", "Lotus", "devotion and friendship", "Deva"],
  ["Kettai", "Jyeshtha", "Indra (king of the gods)", "Earring / umbrella", "seniority and protection", "Rakshasa"],
  ["Moolam", "Mula", "Nirriti (dissolution)", "Bunch of roots", "getting to the root of things", "Rakshasa"],
  ["Pooradam", "Purva Ashadha", "Apas (the waters)", "Winnowing fan", "invincibility and conviction", "Manushya"],
  ["Uthiradam", "Uttara Ashadha", "Vishvedevas (universal gods)", "Elephant's tusk", "final, lasting victory", "Manushya"],
  ["Thiruvonam", "Shravana", "Vishnu", "Ear / three footprints", "listening and learning", "Deva"],
  ["Avittam", "Dhanishta", "The eight Vasus", "Drum", "wealth, rhythm and music", "Rakshasa"],
  ["Sadhayam", "Shatabhisha", "Varuna (cosmic waters)", "Empty circle", "healing and mystery", "Rakshasa"],
  ["Poorattathi", "Purva Bhadrapada", "Aja Ekapada (one-footed goat)", "Front of a funeral cot", "fiery idealism", "Manushya"],
  ["Uthirattathi", "Uttara Bhadrapada", "Ahirbudhnya (serpent of the deep)", "Back of a funeral cot", "depth, calm and wisdom", "Manushya"],
  ["Revathi", "Revati", "Pushan (the nourisher)", "Fish / drum", "safe journeys and nourishment", "Deva"],
];

// Vimshottari dasha: the order and years of each graha's period.
export const DASHA_ORDER = ["ketu", "venus", "sun", "moon", "mars", "rahu", "jupiter", "saturn", "mercury"];

export const DIGNITY = {
  exalted: { ta: "Uchcham", en: "Exalted", score: 10, why: "the planet is at its very best, like a guest of honour" },
  moolatrikona: { ta: "Moolatrikonam", en: "Moolatrikona", score: 8.5, why: "its 'office': working at full professional strength" },
  own: { ta: "Aatchi", en: "Own sign", score: 8, why: "at home, comfortable and in control" },
  great_friend: { ta: "Adhi natpu", en: "Great friend's sign", score: 7, why: "hosted by a close friend" },
  friend: { ta: "Natpu", en: "Friend's sign", score: 6, why: "hosted by a friend" },
  neutral: { ta: "Samam", en: "Neutral sign", score: 5, why: "neither helped nor hindered by its host" },
  enemy: { ta: "Pagai", en: "Enemy's sign", score: 3.5, why: "living in a rival's house: uncomfortable" },
  great_enemy: { ta: "Adhi pagai", en: "Great enemy's sign", score: 2.5, why: "in a hostile house" },
  debilitated: { ta: "Neecham", en: "Debilitated", score: 1, why: "at its weakest, like a fish out of water" },
};

export const GLOSSARY = [
  ["Rasi", "Zodiac sign", "One of 12 equal 30° slices of the sky, counted from Aries (Mesham) on the sidereal zodiac."],
  ["Graha", "Planet", "The nine 'seizers': Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn and the lunar nodes Rahu and Ketu."],
  ["Lagnam", "Ascendant", "The sign rising on the eastern horizon at birth. It becomes house 1 and changes every ~2 hours."],
  ["Veedu / Bhavam", "House", "The 12 life areas, counted from the lagna. House 1 is the lagna's sign, house 2 the next sign, and so on."],
  ["Aadhipathi", "Lord / ruler", "The planet that owns a sign. The lord of the sign on a house is that house's lord (e.g. 7th lord)."],
  ["Lagnadhipathi", "Ascendant lord", "Lord of the lagna sign: the chart's captain. Where it sits shows where life's energy flows."],
  ["Paarvai", "Aspect (glance)", "Every graha looks at the 7th house from itself. Mars also at 4th & 8th, Jupiter at 5th & 9th, Saturn at 3rd & 10th."],
  ["Serkai", "Conjunction", "Two or more grahas in the same sign blend their results."],
  ["Aatchi", "Own sign", "A graha in a sign it rules: strong and comfortable."],
  ["Uchcham", "Exaltation", "The one sign where a graha is at its peak."],
  ["Neecham", "Debilitation", "The sign opposite its exaltation: weakest. Can be cancelled (neecha bhangam)."],
  ["Natpu / Pagai / Samam", "Friend / Enemy / Neutral", "Natural relationships between grahas, used to judge how comfortable a graha is in another's sign."],
  ["Dasai", "Major period", "Vimshottari dasa: a 120-year cycle of planetary periods, starting from the Moon's nakshatram at birth."],
  ["Bhukti (Puthi)", "Sub-period", "Each dasa is divided into nine bhuktis, in the same order, sized by each graha's years."],
  ["Vakram", "Retrograde", "When a planet appears to move backwards from Earth. Traditionally considered strong but unusual."],
  ["Asthangam", "Combustion", "A planet too close to the Sun is 'burnt': its significations are weakened."],
  ["Kendram", "Angle", "Houses 1, 4, 7, 10: the pillars."],
  ["Thirikonam", "Trine", "Houses 1, 5, 9: houses of fortune."],
  ["Maraivu sthanam", "Hidden houses", "Houses 6, 8, 12: difficult or hidden."],
  ["Parivarthanai", "Exchange", "Two grahas in each other's signs: they act as if in their own homes and link the two houses."],
  ["Navamsam", "Ninth-division chart (D9)", "Each sign split into nine parts of 3°20′; shows inner strength, marriage and dharma."],
  ["Nakshatram", "Lunar mansion", "27 star groups of 13°20′. The Moon's nakshatram is your 'birth star'."],
  ["Padham", "Quarter", "Each nakshatram has four quarters of 3°20′. Each maps to one navamsa sign."],
  ["Ayanamsam", "Precession offset", "The ~24° gap between the Western (tropical) and Indian (sidereal) zodiacs. This app uses Lahiri."],
  ["Gocharam", "Transit", "Where the grahas are today, read from your Moon sign."],
  ["Yogam", "Combination", "Special planetary patterns that indicate particular results."],
  ["Dosham", "Affliction", "A pattern considered troublesome, e.g. Sevvai dosham (Mars in certain houses)."],
];

// Relationship of `of` toward `to` (natural).
export function naturalRelation(of, to) {
  const g = GRAHAS[of];
  if (g.friends.includes(to)) return "friend";
  if (g.enemies.includes(to)) return "enemy";
  return "neutral";
}

export const label = (g) => `${GRAHAS[g].ta} (${GRAHAS[g].en})`;
export const signLabel = (s) => `${SIGNS[s].ta} (${SIGNS[s].en})`;
export const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
