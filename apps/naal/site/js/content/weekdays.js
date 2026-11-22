// One entry per weekday, Sunday first. Songs are YouTube video IDs checked
// with test/youtube_search.py --check.

const navagraha = (graha, id) => ({
  title: `${graha} — Navagraha Kriti`,
  by: "Muthuswami Dikshitar · sung by Bombay Jayashri",
  id, featured: true,
});

export const WEEKDAYS = [
  {
    en: "Sunday", ta: "ஞாயிறு", roman: "Nyayiru", vaaram: "Bhanu vaaram",
    graha: "Surya", grahaTa: "சூரியன்", deity: "Surya Bhagavan",
    color: "#d9480f", tint: "#fff4e6",
    gem: "Ruby · Manikkam", grain: "Wheat · Godhumai", flower: "Red lotus, sengazhuneer", colorName: "Red",
    tagline: "The Sun's day — gratitude for light, health and a fresh start.",
    significance:
      "Nyayiru belongs to Surya, the god we can actually see (pratyaksha deivam), who keeps every living thing going. Families pray to him for health, good eyesight and confidence.",
    history:
      "Sun worship is as old as the Vedas. At Suryanar Kovil near Kumbakonam, built by the Cholas, Surya stands at the centre of the Navagraha temples, with the other eight grahas around him.",
    fact: "Surya's chariot is pulled by seven horses: one for each day of the week, and one for each colour of the rainbow.",
    story: {
      title: "How Rama won with the Sun's help",
      text:
        "In the middle of the great battle in Lanka, Rama was tired and worried. Ravana stood before him, fresh and fierce. Just then the sage Agastya came down to watch the battle with the devas. He walked up to Rama and said, \"Dear Rama, let me teach you a secret hymn to the Sun: the Aditya Hrudayam. Chant it three times and you will win.\" Rama turned to the blazing Sun, folded his hands and chanted. Strength filled him the way sunlight fills a dark room. Then he lifted his bow, and that very day Ravana fell.",
      moral: "When things get hard, pause and pray to gather your strength. Then act.",
    },
    food: {
      naivedyam: ["Sakkarai pongal", "Godhumai rava kesari"],
      meal: ["Wheat: chapathi or godhumai dosai", "Jaggery sweets", "Red fruit like pomegranate"],
      note: "Wheat is Surya's grain among the nine navadhanyam.",
    },
    pooja: [
      "After your bath, face the rising sun and offer water from a copper vessel three times (arghyam).",
      "Do Surya Namaskaram: twelve rounds if you can, one for each of the Sun's twelve names.",
      "Light a ghee lamp and offer red flowers.",
      "Chant the Surya mantra 108 times, or listen to the Aditya Hrudayam.",
    ],
    mantras: [
      { name: "Surya mantra", deva: "ॐ घृणिः सूर्याय नमः", iast: "oṃ ghṛṇiḥ sūryāya namaḥ", meaning: "Om, salutations to Surya, the radiant one.", japa: true },
      {
        name: "Navagraha sloka · Surya",
        deva: "जपाकुसुमसङ्काशं काश्यपेयं महाद्युतिम् ।\nतमोऽरिं सर्वपापघ्नं प्रणतोऽस्मि दिवाकरम् ॥",
        iast: "japākusuma-saṅkāśaṃ kāśyapeyaṃ mahādyutim |\ntamo'riṃ sarva-pāpaghnaṃ praṇato'smi divākaram ||",
        meaning: "I bow to Divakara, maker of the day: red as the hibiscus, son of Kashyapa, brilliant, enemy of darkness, remover of all wrongs.",
      },
    ],
    celebrate: [
      "Surya Namaskaram at sunrise",
      "A few quiet minutes in the morning sun",
      "Visit the Navagraha sannidhi at a nearby temple",
    ],
    songs: [
      navagraha("Sooryamurthe", "R3nDMBCfR8g"),
      { title: "Aditya Hrudayam", by: "Soolamangalam Sisters", id: "nSpxuxq5UhM" },
      { title: "Surya Ashtakam", by: "Soulful Mantra", id: "oXsaKQH4MBA" },
    ],
  },
  {
    en: "Monday", ta: "திங்கள்", roman: "Thingal", vaaram: "Soma vaaram",
    graha: "Chandra", grahaTa: "சந்திரன்", deity: "Shiva (Chandrasekhara)",
    color: "#1c7ed6", tint: "#e7f5ff",
    gem: "Pearl · Muthu", grain: "Rice · Nel", flower: "White lily (alli), vilvam for Shiva", colorName: "White",
    tagline: "The Moon's day — a calm mind, and a day for Shiva.",
    significance:
      "Thingal means the moon. Chandra rules the mind and feelings, and because Shiva wears the crescent moon in his hair, Somavaram is especially dear to him. Many families fast or eat simply and visit a Shiva temple in the evening.",
    history:
      "Monday vratams for Shiva are described in the Skanda Purana. The Mondays of the Tamil month Karthigai are the most sacred, when temples bathe Shiva with water from 108 or 1008 conches (sangabhishekam).",
    fact: "The Moon spends about one day with each of the 27 nakshatras as it circles the sky. In the stories, they are his 27 wives.",
    story: {
      title: "Why the Moon grows and shrinks",
      text:
        "Chandra married the 27 daughters of Daksha, who are the 27 nakshatras. But he loved only Rohini and spent all his time with her. The other sisters complained to their father. Daksha warned Chandra, and when he didn't listen, cursed him: \"You will waste away!\" Night after night the Moon grew thinner and dimmer. Frightened, Chandra prayed to Shiva. Shiva couldn't undo the curse completely, but he placed the thin crescent in his own hair and blessed him: \"You will fade for fifteen days and grow back for fifteen days.\" That is why the moon waxes and wanes, and why Shiva is called Chandrasekhara.",
      moral: "Be fair to everyone you love.",
    },
    food: {
      naivedyam: ["Paal payasam", "White rice with ghee"],
      meal: ["Curd rice, mor kuzhambu", "Simple satvik food", "Many fast until the evening pooja"],
      note: "Rice (nel) is Chandra's grain; white foods suit the Moon.",
    },
    pooja: [
      "In the evening, light a lamp and offer vilvam leaves to Shiva.",
      "If you have a lingam at home, bathe it with milk or water (abhishekam).",
      "Chant Om Namah Shivaya 108 times.",
      "If the moon is up, look at it together and say the Chandra sloka.",
    ],
    mantras: [
      { name: "Panchakshari", deva: "ॐ नमः शिवाय", iast: "oṃ namaḥ śivāya", meaning: "Om, salutations to Shiva: the five sacred syllables.", japa: true },
      {
        name: "Navagraha sloka · Chandra",
        deva: "दधिशङ्खतुषाराभं क्षीरोदार्णवसम्भवम् ।\nनमामि शशिनं सोमं शम्भोर्मुकुटभूषणम् ॥",
        iast: "dadhi-śaṅkha-tuṣārābhaṃ kṣīrodārṇava-sambhavam |\nnamāmi śaśinaṃ somaṃ śambhor-mukuṭa-bhūṣaṇam ||",
        meaning: "I bow to Soma, the Moon: white as curd, conch and snow, born from the ocean of milk, the jewel in Shiva's crown.",
      },
    ],
    celebrate: [
      "Somavara vratam: one meal, or fruit and milk until the evening pooja",
      "An evening visit to a Shiva temple",
      "Karthigai Mondays: 108-conch abhishekam at Shiva temples",
    ],
    songs: [
      navagraha("Chandram Bhaja Manasa", "Xy1bav-sd00"),
      { title: "Lingashtakam", by: "S. P. Balasubrahmanyam", id: "AzTnnAfiqMg" },
      { title: "Sri Rudram (Namakam)", by: "K. Suresh, The Ghanapati", id: "PbGBn14Q-TU" },
      { title: "Shiva Panchakshara Stotram", by: "Bombay Sisters", id: "-nYayP5B5U0" },
    ],
  },
  {
    en: "Tuesday", ta: "செவ்வாய்", roman: "Sevvai", vaaram: "Mangala vaaram",
    graha: "Angaraka", grahaTa: "செவ்வாய்", deity: "Murugan · Durgai Amman",
    color: "#e03131", tint: "#fff5f5",
    gem: "Coral · Pavazham", grain: "Toor dal · Thuvarai", flower: "Red flowers, shenbagam", colorName: "Red",
    tagline: "Mars's day — courage, and a day for Murugan.",
    significance:
      "Sevvai means \"the red one\": Angaraka, the planet of energy and courage. Murugan, commander of the devas' army, is Sevvai's lord, so Tuesdays belong to him. Many also light a lamp to Durgai Amman during Rahu kalam.",
    history:
      "Vaitheeswaran Kovil near Mayiladuthurai is the Angaraka temple among the Navagraha sthalams, where Murugan is worshipped as Selvamuthukumaraswamy. Murugan's six abodes, the Arupadai Veedu, are crowded on Tuesdays.",
    fact: "Murugan's vel, his spear, was given to him by his mother Parvati.",
    story: {
      title: "The mango of wisdom",
      text:
        "Sage Narada brought one golden mango to Kailash: the fruit of wisdom. Shiva and Parvati had two sons, Ganesha and Murugan, and only one fruit. \"Whoever goes around the whole world first gets the mango,\" said Shiva. Murugan leapt onto his peacock and flew off over mountains and oceans. Ganesha simply walked around his parents and said, \"You are my whole world.\" He got the mango! When Murugan returned, he was upset. He gave up his fine clothes and went to stand alone on a hill. Shiva and Parvati followed him and said, \"Pazham nee! You yourself are the fruit!\" That hill is Pazhani.",
      moral: "Wisdom can beat speed, and our parents' love is the whole world.",
    },
    food: {
      naivedyam: ["Panchamirtham: banana, jaggery, honey, ghee and cardamom, as at Pazhani"],
      meal: ["Toor dal dishes: paruppu usili, sambar", "Tomato rasam"],
      note: "Thuvarai (toor dal) is Sevvai's grain.",
    },
    pooja: [
      "Light a ghee lamp before Murugan and offer red flowers.",
      "Recite Kanda Sashti Kavasam (about 20 minutes), or Om Saravanabhava 108 times.",
      "Offer panchamirtham or fruit.",
      "During Rahu kalam (see today's times), some light a lemon lamp for Durgai Amman.",
    ],
    mantras: [
      { name: "Shadakshari", deva: "ॐ शरवणभव", iast: "oṃ śaravaṇabhava", meaning: "Murugan's six-syllable mantra: \"born in the forest of reeds\". In Tamil: ஓம் சரவணபவ.", japa: true },
      {
        name: "Navagraha sloka · Angaraka",
        deva: "धरणीगर्भसम्भूतं विद्युत्कान्तिसमप्रभम् ।\nकुमारं शक्तिहस्तं तं मङ्गलं प्रणमाम्यहम् ॥",
        iast: "dharaṇī-garbha-sambhūtaṃ vidyut-kānti-samaprabham |\nkumāraṃ śakti-hastaṃ taṃ maṅgalaṃ praṇamāmyaham ||",
        meaning: "I bow to Mangala, born of the Earth, bright as lightning, the youth who holds the spear.",
      },
    ],
    celebrate: [
      "Kanda Sashti Kavasam in the evening",
      "A visit to a Murugan temple",
      "Traditionally, weddings and big new beginnings aren't fixed on Tuesdays",
    ],
    songs: [
      navagraha("Angarakam Ashrayamyaham", "FwSLC1tjBmc"),
      { title: "Kanda Sashti Kavasam", by: "Soolamangalam Sisters", id: "BRtBAwB3rIw" },
      { title: "Skanda Guru Kavasam", by: "Soolamangalam Sisters", id: "-o29R4P98dw" },
      { title: "Muthai Tharu (Thiruppugazh)", by: "Sooryagayathri", id: "ADeQyIiCTuw" },
    ],
  },
  {
    en: "Wednesday", ta: "புதன்", roman: "Budhan", vaaram: "Saumya vaaram",
    graha: "Budha", grahaTa: "புதன்", deity: "Perumal (Vishnu)",
    color: "#2f9e44", tint: "#ebfbee",
    gem: "Emerald · Maragatham", grain: "Green gram · Pachai payaru", flower: "White kanthal; tulasi for Perumal", colorName: "Green",
    tagline: "Mercury's day — learning, speech, and Perumal.",
    significance:
      "Budhan is the graha of intelligence, speech and learning. \"Pon kidaithaalum Budhan kidaikkaadhu,\" says the Tamil proverb: you may find gold, but not a Wednesday. It's a favourite day to begin lessons, music or anything new.",
    history:
      "Budhan is the son of Chandra. His Navagraha temple is Thiruvenkadu, near Sirkazhi. Vishnu is Budha's presiding deity, so Wednesdays are also for Perumal and the Vishnu Sahasranamam.",
    fact: "Mercury is the fastest planet, going around the Sun in just 88 days. Maybe that's why Budhan stands for quick thinking!",
    story: {
      title: "Gajendra, the elephant who called for help",
      text:
        "Gajendra, a mighty elephant king, went to a lotus lake to drink with his herd. Suddenly a crocodile caught his leg and pulled. Gajendra pulled back for days and days, but in the water the crocodile was stronger. His family couldn't help him. At last, too tired to fight, Gajendra lifted a single lotus with his trunk and cried, \"Aadhimoolame! O Source of everything, save me!\" Vishnu heard him and came flying on Garuda in such a hurry that he didn't even stop to tell Lakshmi. With his discus he freed Gajendra.",
      moral: "When you've done all you can, ask for help with your whole heart.",
    },
    food: {
      naivedyam: ["Payatham paruppu payasam", "Green gram sundal"],
      meal: ["Pesarattu", "Moong dal kootu", "Keerai (greens)"],
      note: "Green gram is Budhan's grain.",
    },
    pooja: [
      "Light a lamp and offer tulasi leaves to Perumal.",
      "Recite the Vishnu Sahasranamam (about 30 minutes), or the Shantakaram sloka below.",
      "A good day for children to start a new lesson or instrument.",
    ],
    mantras: [
      {
        name: "Shantakaram",
        deva: "शान्ताकारं भुजगशयनं पद्मनाभं सुरेशं\nविश्वाधारं गगनसदृशं मेघवर्णं शुभाङ्गम् ।\nलक्ष्मीकान्तं कमलनयनं योगिभिर्ध्यानगम्यं\nवन्दे विष्णुं भवभयहरं सर्वलोकैकनाथम् ॥",
        iast: "śāntākāraṃ bhujaga-śayanaṃ padmanābhaṃ sureśaṃ\nviśvādhāraṃ gagana-sadṛśaṃ megha-varṇaṃ śubhāṅgam |\nlakṣmī-kāntaṃ kamala-nayanaṃ yogibhir-dhyāna-gamyaṃ\nvande viṣṇuṃ bhava-bhaya-haraṃ sarva-lokaika-nātham ||",
        meaning: "I bow to Vishnu: peaceful, resting on the serpent, lotus in his navel, support of the universe, vast as the sky, dark as a rain cloud, beloved of Lakshmi, lotus-eyed, who removes the fear of worldly life.",
      },
      {
        name: "Navagraha sloka · Budha",
        deva: "प्रियङ्गुकलिकाश्यामं रूपेणाप्रतिमं बुधम् ।\nसौम्यं सौम्यगुणोपेतं तं बुधं प्रणमाम्यहम् ॥",
        iast: "priyaṅgu-kalikā-śyāmaṃ rūpeṇāpratimaṃ budham |\nsaumyaṃ saumya-guṇopetaṃ taṃ budhaṃ praṇamāmyaham ||",
        meaning: "I bow to Budha, dark as the priyangu bud, matchless in form, gentle and full of gentle virtues.",
      },
    ],
    celebrate: [
      "Vishnu Sahasranamam at home",
      "Start school, music lessons or anything new",
      "The traditional oil-bath day for men (with Saturday)",
    ],
    songs: [
      navagraha("Budham Ashrayami", "dAW987c-ybY"),
      { title: "Vishnu Sahasranamam", by: "M. S. Subbulakshmi", id: "ATflA6WOy0I" },
      { title: "Achyutashtakam", by: "Vasundhara", id: "W90FHJygVQw" },
    ],
  },
  {
    en: "Thursday", ta: "வியாழன்", roman: "Vyazhan", vaaram: "Guru vaaram",
    graha: "Guru (Brihaspati)", grahaTa: "குரு", deity: "Dakshinamurthy",
    color: "#e67700", tint: "#fff9db",
    gem: "Yellow sapphire · Pushparagam", grain: "Bengal gram · Kondai kadalai", flower: "Mullai (jasmine), yellow flowers", colorName: "Yellow",
    tagline: "Jupiter's day — the guru's blessing.",
    significance:
      "Vyazhan is Guru: Brihaspati, teacher of the devas. Thursday honours teachers: Dakshinamurthy (Shiva as the silent guru), one's own guru, and the elders who guide us.",
    history:
      "Alangudi near Kumbakonam is the Guru temple among the Navagraha sthalams. Every Shiva temple in Tamil Nadu has Dakshinamurthy on its south wall, seated under a banyan tree. On Thursdays people offer him lamps and yellow cloth.",
    fact: "Jupiter is the biggest planet. Fitting for the guru of the gods!",
    story: {
      title: "The teacher who taught in silence",
      text:
        "Four wise sages, Sanaka, Sanandana, Sanatana and Sanatkumara, searched everywhere for the deepest truth. Their questions were so big that no teacher could answer them. At last they found a teacher sitting under a banyan tree, calm as a still lake. Here was the surprise: the students were old, and the teacher was young! He didn't say a single word. He just sat, his thumb and finger touching in a circle (chin mudra). As the sages sat with him in that silence, every doubt melted away. The teacher was Shiva himself, as Dakshinamurthy.",
      moral: "Some things are learned by listening to silence.",
    },
    food: {
      naivedyam: ["Kondai kadalai sundal"],
      meal: ["Lemon rice", "Bengal gram kootu", "Something yellow: turmeric, saffron, banana"],
      note: "Bengal gram is Guru's grain, and yellow is his colour.",
    },
    pooja: [
      "Light a lamp before Dakshinamurthy, or a picture of your guru. Offer yellow flowers.",
      "Offer kondai kadalai sundal.",
      "Chant the Dakshinamurthy sloka 11 or 108 times.",
      "Do namaskaram to your parents and teachers.",
    ],
    mantras: [
      {
        name: "Dakshinamurthy dhyanam",
        deva: "गुरवे सर्वलोकानां भिषजे भवरोगिणाम् ।\nनिधये सर्वविद्यानां दक्षिणामूर्तये नमः ॥",
        iast: "gurave sarva-lokānāṃ bhiṣaje bhava-rogiṇām |\nnidhaye sarva-vidyānāṃ dakṣiṇāmūrtaye namaḥ ||",
        meaning: "Salutations to Dakshinamurthy: teacher of all the worlds, healer of those suffering in life, treasure-house of all knowledge.",
        japa: true,
      },
      {
        name: "Guru vandanam",
        deva: "गुरुर्ब्रह्मा गुरुर्विष्णुः गुरुर्देवो महेश्वरः ।\nगुरुः साक्षात् परब्रह्म तस्मै श्रीगुरवे नमः ॥",
        iast: "gurur-brahmā gurur-viṣṇuḥ gurur-devo maheśvaraḥ |\nguruḥ sākṣāt para-brahma tasmai śrī-gurave namaḥ ||",
        meaning: "The guru is Brahma, Vishnu and Shiva; the guru is the Supreme itself. Salutations to that guru.",
      },
    ],
    celebrate: [
      "Visit Dakshinamurthy's shrine at a Shiva temple",
      "Thank a teacher",
      "Wear something yellow",
    ],
    songs: [
      navagraha("Brihaspate", "L4xIxzxmXvo"),
      { title: "Bhaja Govindam", by: "M. S. Subbulakshmi", id: "Go-mAJpH6_w" },
      { title: "Dakshinamurthy Stotram (with meaning)", by: "Ramesh Krishnakumar", id: "fPoP7Kk7vgU" },
      { title: "Guru Stotram", by: "Jaya Vidyasagar", id: "7IcTvswcTFs" },
    ],
  },
  {
    en: "Friday", ta: "வெள்ளி", roman: "Velli", vaaram: "Bhrigu vaaram",
    graha: "Shukra", grahaTa: "சுக்கிரன்", deity: "Mahalakshmi · Amman",
    color: "#c2255c", tint: "#fff0f6",
    gem: "Diamond · Vairam", grain: "Field beans · Mochai", flower: "White lotus, jasmine", colorName: "White",
    tagline: "Venus's day — Lakshmi, Amman and everything auspicious.",
    significance:
      "Velli means both Friday and silver, and its graha Shukra stands for beauty, comfort and plenty. For many Tamil homes it's the most auspicious day of the week: the house is cleaned, a kolam drawn, and lamps lit for Lakshmi and Amman.",
    history:
      "Kanjanur near Kumbakonam is the Shukra temple among the Navagraha sthalams. The Fridays of Aadi and Thai are especially sacred at Amman temples, and Varalakshmi Vratam always falls on a Friday.",
    fact: "Venus is often the brightest point in the evening or morning sky. Look low in the west just after sunset!",
    story: {
      title: "Lakshmi rises from the ocean of milk",
      text:
        "The devas and asuras wanted amrita, the nectar that makes you live forever, so together they churned the ocean of milk. Mount Mandara was the churning stick and the great serpent Vasuki was the rope. As they churned, wonders rose from the waves: Kamadhenu the wish-granting cow, Airavata the white elephant, and the cool Moon. Then, seated on a full-blown lotus and glowing like gold, rose Lakshmi. Everyone fell silent. She chose Vishnu, and wherever her gaze fell, good fortune followed.",
      moral: "Good things rise from patient work done together.",
    },
    food: {
      naivedyam: ["Sakkarai pongal", "Paal payasam"],
      meal: ["Mochai kottai kuzhambu", "A festive sweet", "Many families avoid lending money on Fridays: Lakshmi shouldn't leave the house!"],
      note: "Mochai (field beans) is Shukra's grain.",
    },
    pooja: [
      "Clean the house in the morning and draw a kolam at the entrance.",
      "Light the kuthuvilakku with ghee or sesame oil; decorate it with kumkumam and flowers.",
      "Recite Lalitha Sahasranamam, or the Mahalakshmi sloka below.",
      "Offer betel leaves, fruit and manjal-kumkumam to women who visit.",
    ],
    mantras: [
      {
        name: "Mahalakshmi Ashtakam",
        deva: "नमस्तेऽस्तु महामाये श्रीपीठे सुरपूजिते ।\nशङ्खचक्रगदाहस्ते महालक्ष्मि नमोऽस्तु ते ॥",
        iast: "namaste'stu mahāmāye śrī-pīṭhe sura-pūjite |\nśaṅkha-cakra-gadā-haste mahālakṣmi namo'stu te ||",
        meaning: "Salutations to you, Mahamaya, seated on the throne of plenty, worshipped by the gods, holding conch, discus and mace: Mahalakshmi, I bow to you.",
        japa: true,
      },
      {
        name: "Navagraha sloka · Shukra",
        deva: "हिमकुन्दमृणालाभं दैत्यानां परमं गुरुम् ।\nसर्वशास्त्रप्रवक्तारं भार्गवं प्रणमाम्यहम् ॥",
        iast: "hima-kunda-mṛṇālābhaṃ daityānāṃ paramaṃ gurum |\nsarva-śāstra-pravaktāraṃ bhārgavaṃ praṇamāmyaham ||",
        meaning: "I bow to Bhargava (Shukra): white as snow, jasmine and lotus stalk, great teacher of the asuras, master of every science.",
      },
    ],
    celebrate: [
      "Kolam, lamp and flowers: the house dressed up for Lakshmi",
      "The traditional oil-bath day for women (with Tuesday)",
      "An evening visit to an Amman temple",
    ],
    songs: [
      navagraha("Sri Shukram", "tXxDob0IiWs"),
      { title: "Lalitha Sahasranamam", by: "Bombay Sisters", id: "nQI1TlAhhMo" },
      { title: "Bhagyada Lakshmi Baramma", by: "M. S. Subbulakshmi", id: "zmHsP1CN_aA" },
      { title: "Abirami Anthathi", by: "Soolamangalam Sisters", id: "QfUizoZ98Qc" },
    ],
  },
  {
    en: "Saturday", ta: "சனி", roman: "Sani", vaaram: "Sthira vaaram",
    graha: "Shani", grahaTa: "சனி", deity: "Perumal (Venkateswara) · Hanuman",
    color: "#5f3dc4", tint: "#f3f0ff",
    gem: "Blue sapphire · Neelam", grain: "Black sesame · Ellu", flower: "Blue lily (karunkuvalai)", colorName: "Black, dark blue",
    tagline: "Saturn's day — patience, Perumal and Hanuman.",
    significance:
      "Sani is the slow, fair graha who rewards patience and honest work. Saturdays belong to Perumal, Lord Venkateswara of Tirupati, and to Hanuman, whom Shani promised never to trouble. A sesame-oil lamp (ellu deepam) is the classic Saturday offering.",
    history:
      "Thirunallar near Karaikal is Shani's famous temple, where King Nala was freed from Shani's hold after bathing in the temple tank. The Saturdays of Purattasi are the most sacred of the year for Perumal: families light a maavilakku and keep the whole month vegetarian.",
    fact: "Saturn takes about 29½ years to go around the Sun. That's why Shani is Sanaischara, \"the slow mover\".",
    story: {
      title: "How Hanuman freed Shani",
      text:
        "Ravana was so powerful that he had locked up all nine grahas, even Shani, in his palace in Lanka. When Hanuman came to Lanka searching for Sita, he found Shani lying chained and weak. Hanuman broke the chains and set him free. Grateful, Shani bowed and said, \"I will never trouble anyone who prays to you.\" That is why, on Saturdays, people pray to Hanuman for strength and courage.",
      moral: "Help those in trouble. Kindness always comes back.",
    },
    food: {
      naivedyam: ["Ellu sadam (sesame rice)", "Ellu urundai"],
      meal: ["Ulundhu vadai: Hanuman loves a vadai maalai!", "Ellu podi with rice", "Purattasi Saturdays: maavilakku and a full vegetarian feast"],
      note: "Black sesame (ellu) is Shani's grain.",
    },
    pooja: [
      "\"Sani neeradu\": take an oil bath in the morning, as Avvaiyar's Aathichoodi advises.",
      "Light an ellu deepam (sesame-oil lamp).",
      "Venkatesa Suprabhatam in the morning, Hanuman Chalisa in the evening.",
      "Before lunch, put out a little rice for the crows. The crow is Shani's vahana.",
    ],
    mantras: [
      {
        name: "Hanuman dhyanam",
        deva: "मनोजवं मारुततुल्यवेगं जितेन्द्रियं बुद्धिमतां वरिष्ठम् ।\nवातात्मजं वानरयूथमुख्यं श्रीरामदूतं शरणं प्रपद्ये ॥",
        iast: "manojavaṃ māruta-tulya-vegaṃ jitendriyaṃ buddhimatāṃ variṣṭham |\nvātātmajaṃ vānara-yūtha-mukhyaṃ śrī-rāma-dūtaṃ śaraṇaṃ prapadye ||",
        meaning: "I take refuge in Rama's messenger: swift as thought, fast as the wind, master of his senses, wisest of the wise, son of Vayu, leader of the vanaras.",
        japa: true,
      },
      {
        name: "Navagraha sloka · Shani",
        deva: "नीलाञ्जनसमाभासं रविपुत्रं यमाग्रजम् ।\nछायामार्तण्डसम्भूतं तं नमामि शनैश्चरम् ॥",
        iast: "nīlāñjana-samābhāsaṃ ravi-putraṃ yamāgrajam |\nchāyā-mārtaṇḍa-sambhūtaṃ taṃ namāmi śanaiścaram ||",
        meaning: "I bow to Shanaischara: dark as blue collyrium, son of the Sun and Chhaya, elder brother of Yama.",
      },
    ],
    celebrate: [
      "\"Sani neeradu\": an oil bath, as Avvaiyar says",
      "Rice for the crows before lunch",
      "Purattasi Saturdays: maavilakku for Perumal",
    ],
    songs: [
      navagraha("Divakara Tanujam", "3vJsX6PE460"),
      { title: "Sri Venkatesa Suprabhatam", by: "M. S. Subbulakshmi", id: "R-bwYbOExt8" },
      { title: "Hanuman Chalisa", by: "M. S. Subbulakshmi", id: "Ipuh-P9NtuY" },
      { title: "Kurai Ondrum Illai", by: "M. S. Subbulakshmi", id: "xWf6ooh0Nos" },
    ],
  },
];

// Said at the start of every pooja in Tamil Brahmin homes.
export const OPENING = {
  name: "Begin with Pillaiyar",
  deva: "शुक्लाम्बरधरं विष्णुं शशिवर्णं चतुर्भुजम् ।\nप्रसन्नवदनं ध्यायेत् सर्वविघ्नोपशान्तये ॥",
  iast: "śuklāmbara-dharaṃ viṣṇuṃ śaśi-varṇaṃ catur-bhujam |\nprasanna-vadanaṃ dhyāyet sarva-vighnopaśāntaye ||",
  meaning: "Meditate on the one dressed in white, all-pervading, bright as the moon, four-armed and smiling, so that every obstacle is removed.",
};
