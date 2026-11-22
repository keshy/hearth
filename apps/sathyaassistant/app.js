import { load, save, portalURL } from "./lib/data.js";

const KEY = "sathya_calendar_events";
const TAB_STORAGE_KEY = "sathya_assistant_tab";

document.getElementById("portal-link").href = portalURL;

// DOM Elements
const todayDateBadge = document.getElementById("today-date-badge");
const greetingTitle = document.getElementById("greeting-title");
const briefingSummary = document.getElementById("briefing-summary");
const statusEl = document.getElementById("status");

const quickForm = document.getElementById("quick-form");
const quickInput = document.getElementById("quick-input");
const quickPreview = document.getElementById("quick-preview");

const toggleManualBtn = document.getElementById("toggle-manual-btn");
const eventFormCard = document.getElementById("event-form-card");
const formHeading = document.getElementById("form-heading");
const closeFormBtn = document.getElementById("close-form-btn");
const cancelFormBtn = document.getElementById("cancel-form-btn");
const eventForm = document.getElementById("event-form");

const fId = document.getElementById("event-id");
const fTitle = document.getElementById("event-title");
const fDate = document.getElementById("event-date");
const fCategory = document.getElementById("event-category");
const fStart = document.getElementById("event-start");
const fEnd = document.getElementById("event-end");
const fRepeat = document.getElementById("event-repeat");
const fLocation = document.getElementById("event-location");
const fNotes = document.getElementById("event-notes");

const prevMonthBtn = document.getElementById("prev-month-btn");
const nextMonthBtn = document.getElementById("next-month-btn");
const jumpTodayBtn = document.getElementById("jump-today-btn");
const monthLabel = document.getElementById("month-label");
const calendarGrid = document.getElementById("calendar-grid");

const tabDay = document.getElementById("tab-day");
const tabUpcoming = document.getElementById("tab-upcoming");
const tabAll = document.getElementById("tab-all");

const dayHeader = document.getElementById("day-header");
const selectedDateTitle = document.getElementById("selected-date-title");
const selectedDateSub = document.getElementById("selected-date-sub");
const addForDayBtn = document.getElementById("add-for-day-btn");

const filterBar = document.getElementById("filter-bar");
const searchInput = document.getElementById("search-input");
const filterCategory = document.getElementById("filter-category");

const conflictBanner = document.getElementById("conflict-banner");
const eventList = document.getElementById("event-list");
const emptyState = document.getElementById("empty-state");

// State
let events = [];
let selectedDate = toYMD(new Date());
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth(); // 0-11
let activeTab = localStorage.getItem(TAB_STORAGE_KEY) || "day";
let pendingDeleteId = null;

// Date Helpers
function toYMD(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseYMD(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatNiceDate(ymd) {
  const d = parseYMD(ymd);
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatTime12(timeStr) {
  if (!timeStr) return "All day";
  const [hh, mm] = timeStr.split(":").map(Number);
  if (Number.isNaN(hh)) return timeStr;
  const period = hh >= 12 ? "PM" : "AM";
  const hour12 = hh % 12 || 12;
  return `${hour12}:${String(mm || 0).padStart(2, "0")} ${period}`;
}

function addMinutesToTime(timeStr, minsToAdd) {
  const [hh, mm] = timeStr.split(":").map(Number);
  const total = hh * 60 + mm + minsToAdd;
  const capped = Math.min(total, 23 * 60 + 59);
  const nh = Math.floor(capped / 60);
  const nm = capped % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = "status";
  if (type) statusEl.classList.add(type);
}

// Check if an event (including repeating ones) occurs on a given YYYY-MM-DD
function occursOnDate(ev, targetYMD) {
  if (!ev.date) return false;
  if (ev.date === targetYMD) return true;
  if (!ev.repeat || ev.repeat === "none") return false;
  if (targetYMD < ev.date) return false;

  const start = parseYMD(ev.date);
  const target = parseYMD(targetYMD);

  if (ev.repeat === "daily") {
    return true;
  }
  if (ev.repeat === "weekly") {
    return start.getDay() === target.getDay();
  }
  if (ev.repeat === "monthly") {
    return start.getDate() === target.getDate();
  }
  return false;
}

function getEventsForDate(ymd) {
  return events
    .filter((ev) => occursOnDate(ev, ymd))
    .sort((a, b) => {
      if (!a.startTime && !b.startTime) return a.title.localeCompare(b.title);
      if (!a.startTime) return -1;
      if (!b.startTime) return 1;
      return a.startTime.localeCompare(b.startTime);
    });
}

function isCompletedOnDate(ev, ymd) {
  if (Array.isArray(ev.completedDates)) {
    return ev.completedDates.includes(ymd);
  }
  return Boolean(ev.done);
}

// Detect overlapping timed events on the same day
function findConflicts(dayEvents) {
  const timed = dayEvents.filter((e) => e.startTime && !isCompletedOnDate(e, selectedDate));
  const conflicts = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      const aEnd = a.endTime || addMinutesToTime(a.startTime, 60);
      const bEnd = b.endTime || addMinutesToTime(b.startTime, 60);
      if (a.startTime < bEnd && b.startTime < aEnd) {
        conflicts.push(`"${a.title}" (${formatTime12(a.startTime)}) overlaps with "${b.title}" (${formatTime12(b.startTime)})`);
      }
    }
  }
  return conflicts;
}

// Natural Language Parser for Sathya's Quick Assistant Bar
function parseQuickCommand(rawText) {
  let text = rawText.trim();
  if (!text) return null;

  const now = new Date();
  let dateYMD = selectedDate || toYMD(now);
  let startTime = "";
  let endTime = "";
  let category = "personal";

  // 1. Parse relative dates: today, tomorrow, day after tomorrow
  if (/\bday after tomorrow\b/i.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    dateYMD = toYMD(d);
    text = text.replace(/\bday after tomorrow\b/i, "");
  } else if (/\btomorrow\b/i.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    dateYMD = toYMD(d);
    text = text.replace(/\btomorrow\b/i, "");
  } else if (/\btoday\b/i.test(text)) {
    dateYMD = toYMD(now);
    text = text.replace(/\btoday\b/i, "");
  } else {
    // Check weekday names: monday..sunday
    const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const wdRegex = new RegExp(`\\b(next\\s+)?(${weekdays.join("|")})\\b`, "i");
    const wdMatch = text.match(wdRegex);
    if (wdMatch) {
      const targetDay = weekdays.indexOf(wdMatch[2].toLowerCase());
      const d = new Date(now);
      let diff = (targetDay - d.getDay() + 7) % 7;
      if (diff === 0 || wdMatch[1]) diff += 7;
      d.setDate(d.getDate() + diff);
      dateYMD = toYMD(d);
      text = text.replace(wdRegex, "");
    } else {
      // Check explicit YYYY-MM-DD or MM/DD
      const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      if (isoMatch) {
        dateYMD = isoMatch[1];
        text = text.replace(isoMatch[0], "");
      } else {
        const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
        if (slashMatch) {
          const m = Number(slashMatch[1]);
          const day = Number(slashMatch[2]);
          if (m >= 1 && m <= 12 && day >= 1 && day <= 31) {
            const d = new Date(now.getFullYear(), m - 1, day);
            dateYMD = toYMD(d);
            text = text.replace(slashMatch[0], "");
          }
        }
      }
    }
  }

  // 2. Parse time range or single time: e.g. "2pm to 3pm", "10:30am", "at 14:00"
  const timeRegex = /\b(?:at\s+|from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?\b/i;
  const timeMatch = text.match(timeRegex);
  if (timeMatch) {
    const rawH1 = Number(timeMatch[1]);
    const rawM1 = Number(timeMatch[2] || 0);
    const mer1 = (timeMatch[3] || "").toLowerCase();
    const hasColonOrMeridiem = Boolean(timeMatch[2] || timeMatch[3]);

    if (hasColonOrMeridiem && rawH1 <= 23 && rawM1 <= 59) {
      let h1 = rawH1;
      if (mer1 === "pm" && h1 < 12) h1 += 12;
      if (mer1 === "am" && h1 === 12) h1 = 0;
      startTime = `${String(h1).padStart(2, "0")}:${String(rawM1).padStart(2, "0")}`;

      if (timeMatch[4]) {
        let h2 = Number(timeMatch[4]);
        const m2 = Number(timeMatch[5] || 0);
        const mer2 = (timeMatch[6] || mer1).toLowerCase();
        if (mer2 === "pm" && h2 < 12) h2 += 12;
        if (mer2 === "am" && h2 === 12) h2 = 0;
        endTime = `${String(h2).padStart(2, "0")}:${String(m2).padStart(2, "0")}`;
      } else {
        endTime = addMinutesToTime(startTime, 60);
      }
      text = text.replace(timeMatch[0], "");
    }
  }

  // Clean up leftover prepositions
  const cleanTitle = text
    .replace(/\b(on|at|for)\s*$/i, "")
    .replace(/^\s*(on|at|for|-|:)\s+/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // 3. Guess category from keywords
  const lower = cleanTitle.toLowerCase();
  if (/(doctor|dentist|yoga|gym|walk|workout|meditation|clinic|checkup|pill|health)/.test(lower)) {
    category = "health";
  } else if (/(meeting|call|project|client|office|report|presentation|sync|work)/.test(lower)) {
    category = "work";
  } else if (/(family|mom|dad|kids|dinner|lunch|brunch|birthday|anniversary|visit|party)/.test(lower)) {
    category = "family";
  } else if (/(buy|grocery|pick up|bank|bill|laundry|shop|errand|post office)/.test(lower)) {
    category = "errand";
  }

  return {
    title: cleanTitle || rawText.trim(),
    date: dateYMD,
    startTime,
    endTime,
    category,
  };
}

// Assistant Briefing Header
function renderBriefing() {
  const now = new Date();
  const todayYMD = toYMD(now);
  const hour = now.getHours();
  const timeGreeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  todayDateBadge.textContent = formatNiceDate(todayYMD);
  greetingTitle.textContent = `${timeGreeting}, Sathya!`;

  const todayEvents = getEventsForDate(todayYMD);
  const remainingToday = todayEvents.filter((e) => !isCompletedOnDate(e, todayYMD));

  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowYMD = toYMD(tomorrowDate);
  const tomorrowEvents = getEventsForDate(tomorrowYMD);

  if (todayEvents.length === 0) {
    if (tomorrowEvents.length > 0) {
      briefingSummary.textContent = `Your schedule is wide open today. You have ${tomorrowEvents.length} event${tomorrowEvents.length > 1 ? "s" : ""} coming up tomorrow.`;
    } else {
      briefingSummary.textContent = "You have no events scheduled for today. Type below to add an appointment or reminder.";
    }
    return;
  }

  if (remainingToday.length === 0) {
    briefingSummary.textContent = `All ${todayEvents.length} event${todayEvents.length > 1 ? "s" : ""} for today are marked done. Great job!`;
    return;
  }

  const nextEv = remainingToday[0];
  const nextTime = nextEv.startTime ? `at ${formatTime12(nextEv.startTime)}` : "(all day)";
  briefingSummary.textContent = `You have ${remainingToday.length} event${remainingToday.length > 1 ? "s" : ""} remaining today. Next up: "${nextEv.title}" ${nextTime}.`;
}

// Monthly Calendar Grid
function renderCalendar() {
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const monthName = firstOfMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  monthLabel.textContent = monthName;

  const startDayOfWeek = firstOfMonth.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();

  const todayYMD = toYMD(new Date());
  const cells = [];

  // Leading days from previous month
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = new Date(viewYear, viewMonth - 1, prevMonthDays - i);
    cells.push({ dateObj: d, outside: true });
  }

  // Current month days
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(viewYear, viewMonth, day);
    cells.push({ dateObj: d, outside: false });
  }

  // Trailing days to complete 6 rows (42 cells) or 5 rows (35 cells)
  const totalNeeded = cells.length > 35 ? 42 : 35;
  let nextDay = 1;
  while (cells.length < totalNeeded) {
    const d = new Date(viewYear, viewMonth + 1, nextDay++);
    cells.push({ dateObj: d, outside: true });
  }

  calendarGrid.replaceChildren(
    ...cells.map(({ dateObj, outside }) => {
      const ymd = toYMD(dateObj);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-day";
      if (outside) btn.classList.add("outside");
      if (ymd === todayYMD) btn.classList.add("today");
      if (ymd === selectedDate) btn.classList.add("selected");

      const dayEvents = getEventsForDate(ymd);
      btn.setAttribute(
        "aria-label",
        `${formatNiceDate(ymd)}${dayEvents.length ? `, ${dayEvents.length} events` : ""}`
      );

      const numSpan = document.createElement("span");
      numSpan.textContent = String(dateObj.getDate());

      const dotsWrap = document.createElement("div");
      dotsWrap.className = "cal-dots";
      dayEvents.slice(0, 4).forEach((ev) => {
        const dot = document.createElement("span");
        dot.className = `cal-dot cat-${ev.category || "personal"}`;
        dotsWrap.appendChild(dot);
      });

      btn.append(numSpan, dotsWrap);
      btn.addEventListener("click", () => {
        selectedDate = ymd;
        if (outside) {
          viewYear = dateObj.getFullYear();
          viewMonth = dateObj.getMonth();
        }
        setActiveTab("day");
        render();
      });
      return btn;
    })
  );
}

// Event List Item Builder
function createEventElement(ev, contextDateYMD, showDateBadge = false) {
  const li = document.createElement("li");
  const cat = ev.category || "personal";
  const done = isCompletedOnDate(ev, contextDateYMD);
  li.className = `event-item cat-${cat}${done ? " is-done" : ""}`;

  const main = document.createElement("div");
  main.className = "event-main";

  const meta = document.createElement("div");
  meta.className = "event-meta";

  if (showDateBadge) {
    const dateSpan = document.createElement("span");
    dateSpan.className = "event-time";
    dateSpan.textContent = formatNiceDate(contextDateYMD);
    meta.appendChild(dateSpan);
  }

  const timeSpan = document.createElement("span");
  timeSpan.className = "event-time";
  if (ev.startTime) {
    timeSpan.textContent = ev.endTime
      ? `${formatTime12(ev.startTime)} – ${formatTime12(ev.endTime)}`
      : formatTime12(ev.startTime);
  } else {
    timeSpan.textContent = "All day";
  }
  meta.appendChild(timeSpan);

  const catPill = document.createElement("span");
  catPill.className = "cat-pill";
  catPill.textContent = cat;
  meta.appendChild(catPill);

  if (ev.repeat && ev.repeat !== "none") {
    const repPill = document.createElement("span");
    repPill.className = "cat-pill";
    repPill.textContent = `Repeats ${ev.repeat}`;
    meta.appendChild(repPill);
  }

  const title = document.createElement("p");
  title.className = "event-title";
  title.textContent = ev.title;

  main.append(meta, title);

  if (ev.location || ev.notes) {
    const details = document.createElement("p");
    details.className = "event-details";
    const parts = [];
    if (ev.location) parts.push(`Location: ${ev.location}`);
    if (ev.notes) parts.push(ev.notes);
    details.textContent = parts.join(" • ");
    main.appendChild(details);
  }

  const actions = document.createElement("div");
  actions.className = "event-actions";

  const doneBtn = document.createElement("button");
  doneBtn.type = "button";
  doneBtn.className = "ghost";
  doneBtn.textContent = done ? "Undo" : "Done";
  doneBtn.setAttribute("aria-label", `${done ? "Mark undone" : "Mark done"}: ${ev.title}`);
  doneBtn.addEventListener("click", () => toggleEventDone(ev.id, contextDateYMD));

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "ghost";
  editBtn.textContent = "Edit";
  editBtn.setAttribute("aria-label", `Edit ${ev.title}`);
  editBtn.addEventListener("click", () => openEditForm(ev));

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  if (pendingDeleteId === ev.id) {
    delBtn.className = "danger";
    delBtn.textContent = "Confirm?";
    delBtn.addEventListener("click", () => {
      pendingDeleteId = null;
      deleteEvent(ev.id);
    });
  } else {
    delBtn.className = "ghost";
    delBtn.textContent = "Delete";
    delBtn.setAttribute("aria-label", `Delete ${ev.title}`);
    delBtn.addEventListener("click", () => {
      pendingDeleteId = ev.id;
      renderAgenda();
    });
  }

  actions.append(doneBtn, editBtn, delBtn);
  li.append(main, actions);
  return li;
}

// Right-hand Agenda / Selected Day View
function renderAgenda() {
  tabDay.classList.toggle("active", activeTab === "day");
  tabDay.setAttribute("aria-selected", String(activeTab === "day"));
  tabUpcoming.classList.toggle("active", activeTab === "upcoming");
  tabUpcoming.setAttribute("aria-selected", String(activeTab === "upcoming"));
  tabAll.classList.toggle("active", activeTab === "all");
  tabAll.setAttribute("aria-selected", String(activeTab === "all"));

  const todayYMD = toYMD(new Date());

  if (activeTab === "day") {
    dayHeader.hidden = false;
    filterBar.hidden = true;

    selectedDateTitle.textContent =
      selectedDate === todayYMD ? `Today, ${formatNiceDate(selectedDate)}` : formatNiceDate(selectedDate);

    const dayEvents = getEventsForDate(selectedDate);
    selectedDateSub.textContent =
      dayEvents.length === 0
        ? "Free schedule"
        : `${dayEvents.length} scheduled event${dayEvents.length > 1 ? "s" : ""}`;

    const conflicts = findConflicts(dayEvents);
    if (conflicts.length > 0) {
      conflictBanner.hidden = false;
      conflictBanner.textContent = `Schedule overlap notice: ${conflicts[0]}`;
    } else {
      conflictBanner.hidden = true;
    }

    eventList.replaceChildren(...dayEvents.map((ev) => createEventElement(ev, selectedDate, false)));
    emptyState.hidden = dayEvents.length > 0;
    emptyState.textContent = "No events scheduled for this day. Enjoy the free time or add one above!";
    return;
  }

  // Upcoming (next 14 days) or All/Search
  dayHeader.hidden = true;
  filterBar.hidden = false;
  conflictBanner.hidden = true;

  const query = searchInput.value.trim().toLowerCase();
  const catFilter = filterCategory.value;

  if (activeTab === "upcoming") {
    const upcomingItems = [];
    const start = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const ymd = toYMD(d);
      const dayEvs = getEventsForDate(ymd);
      dayEvs.forEach((ev) => {
        if (catFilter !== "all" && ev.category !== catFilter) return;
        if (query) {
          const hay = `${ev.title} ${ev.location || ""} ${ev.notes || ""}`.toLowerCase();
          if (!hay.includes(query)) return;
        }
        upcomingItems.push({ ev, ymd });
      });
    }

    eventList.replaceChildren(
      ...upcomingItems.map(({ ev, ymd }) => createEventElement(ev, ymd, true))
    );
    emptyState.hidden = upcomingItems.length > 0;
    emptyState.textContent = "No upcoming events in the next 14 days match your filter.";
    return;
  }

  // All events sorted by date
  const filtered = events
    .filter((ev) => {
      if (catFilter !== "all" && ev.category !== catFilter) return false;
      if (query) {
        const hay = `${ev.title} ${ev.location || ""} ${ev.notes || ""}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const cmp = (a.date || "").localeCompare(b.date || "");
      if (cmp !== 0) return cmp;
      return (a.startTime || "").localeCompare(b.startTime || "");
    });

  eventList.replaceChildren(
    ...filtered.map((ev) => createEventElement(ev, ev.date || todayYMD, true))
  );
  emptyState.hidden = filtered.length > 0;
  emptyState.textContent = "No matching events found in Sathya's calendar.";
}

function render() {
  renderBriefing();
  renderCalendar();
  renderAgenda();
}

// Storage Operations (reload right before saving)
async function refresh() {
  try {
    const loaded = await load(KEY, []);
    events = Array.isArray(loaded) ? loaded : [];
    render();
  } catch (err) {
    setStatus(err.message, "error");
  }
}

async function update(mutator, successMsg = "") {
  try {
    const latest = await load(KEY, []);
    const list = Array.isArray(latest) ? latest : [];
    events = mutator(list);
    await save(KEY, events);
    render();
    setStatus(successMsg, successMsg ? "ok" : "");
  } catch (err) {
    setStatus(err.message, "error");
  }
}

function toggleEventDone(id, dateYMD) {
  update((current) =>
    current.map((ev) => {
      if (ev.id !== id) return ev;
      const completedDates = Array.isArray(ev.completedDates) ? [...ev.completedDates] : [];
      const idx = completedDates.indexOf(dateYMD);
      if (idx >= 0) {
        completedDates.splice(idx, 1);
      } else {
        completedDates.push(dateYMD);
      }
      return { ...ev, completedDates };
    })
  );
}

function deleteEvent(id) {
  update(
    (current) => current.filter((ev) => ev.id !== id),
    "Event removed from calendar."
  );
}

// Detailed Event Form Controls
function openNewForm(defaultDate = selectedDate) {
  formHeading.textContent = "Add Event for Sathya";
  fId.value = "";
  fTitle.value = "";
  fDate.value = defaultDate;
  fCategory.value = "personal";
  fStart.value = "";
  fEnd.value = "";
  fRepeat.value = "none";
  fLocation.value = "";
  fNotes.value = "";
  eventFormCard.hidden = false;
  fTitle.focus();
}

function openEditForm(ev) {
  formHeading.textContent = "Edit Event";
  fId.value = ev.id;
  fTitle.value = ev.title || "";
  fDate.value = ev.date || selectedDate;
  fCategory.value = ev.category || "personal";
  fStart.value = ev.startTime || "";
  fEnd.value = ev.endTime || "";
  fRepeat.value = ev.repeat || "none";
  fLocation.value = ev.location || "";
  fNotes.value = ev.notes || "";
  eventFormCard.hidden = false;
  fTitle.focus();
}

function closeEventForm() {
  eventFormCard.hidden = true;
}

function setActiveTab(tab) {
  activeTab = tab;
  localStorage.setItem(TAB_STORAGE_KEY, tab);
  pendingDeleteId = null;
}

// Event Listeners
quickInput.addEventListener("input", () => {
  const parsed = parseQuickCommand(quickInput.value);
  if (!parsed || !parsed.title) {
    quickPreview.hidden = true;
    return;
  }
  quickPreview.hidden = false;
  const timeLabel = parsed.startTime
    ? `${formatTime12(parsed.startTime)}${parsed.endTime ? ` – ${formatTime12(parsed.endTime)}` : ""}`
    : "All day";
  quickPreview.textContent = `Assistant preview: "${parsed.title}" on ${formatNiceDate(parsed.date)} • ${timeLabel} (${parsed.category})`;
});

quickForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const parsed = parseQuickCommand(quickInput.value);
  if (!parsed || !parsed.title) return;

  quickInput.value = "";
  quickPreview.hidden = true;

  const newEvent = {
    id: crypto.randomUUID(),
    title: parsed.title,
    date: parsed.date,
    startTime: parsed.startTime,
    endTime: parsed.endTime,
    category: parsed.category,
    repeat: "none",
    location: "",
    notes: "",
    completedDates: [],
    createdAt: Date.now(),
  };

  selectedDate = parsed.date;
  const dObj = parseYMD(parsed.date);
  viewYear = dObj.getFullYear();
  viewMonth = dObj.getMonth();
  setActiveTab("day");

  update(
    (current) => [...current, newEvent],
    `Scheduled "${newEvent.title}" for ${formatNiceDate(newEvent.date)}.`
  );
});

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    quickInput.value = chip.dataset.template || "";
    quickInput.dispatchEvent(new Event("input"));
    quickInput.focus();
  });
});

toggleManualBtn.addEventListener("click", () => {
  if (eventFormCard.hidden) {
    openNewForm(selectedDate);
  } else {
    closeEventForm();
  }
});

addForDayBtn.addEventListener("click", () => openNewForm(selectedDate));
closeFormBtn.addEventListener("click", closeEventForm);
cancelFormBtn.addEventListener("click", closeEventForm);

eventForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const title = fTitle.value.trim();
  const date = fDate.value;
  if (!title || !date) return;

  const payload = {
    title,
    date,
    category: fCategory.value,
    startTime: fStart.value,
    endTime: fEnd.value,
    repeat: fRepeat.value,
    location: fLocation.value.trim(),
    notes: fNotes.value.trim(),
  };

  const existingId = fId.value;
  selectedDate = date;
  const dObj = parseYMD(date);
  viewYear = dObj.getFullYear();
  viewMonth = dObj.getMonth();
  closeEventForm();

  if (existingId) {
    update(
      (current) =>
        current.map((ev) => (ev.id === existingId ? { ...ev, ...payload } : ev)),
      `Updated "${title}".`
    );
  } else {
    const newEv = {
      id: crypto.randomUUID(),
      ...payload,
      completedDates: [],
      createdAt: Date.now(),
    };
    update((current) => [...current, newEv], `Added "${title}" to calendar.`);
  }
});

prevMonthBtn.addEventListener("click", () => {
  viewMonth--;
  if (viewMonth < 0) {
    viewMonth = 11;
    viewYear--;
  }
  renderCalendar();
});

nextMonthBtn.addEventListener("click", () => {
  viewMonth++;
  if (viewMonth > 11) {
    viewMonth = 0;
    viewYear++;
  }
  renderCalendar();
});

jumpTodayBtn.addEventListener("click", () => {
  const now = new Date();
  selectedDate = toYMD(now);
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  setActiveTab("day");
  render();
});

tabDay.addEventListener("click", () => {
  setActiveTab("day");
  renderAgenda();
});
tabUpcoming.addEventListener("click", () => {
  setActiveTab("upcoming");
  renderAgenda();
});
tabAll.addEventListener("click", () => {
  setActiveTab("all");
  renderAgenda();
});

searchInput.addEventListener("input", renderAgenda);
filterCategory.addEventListener("change", renderAgenda);

window.addEventListener("focus", refresh);
setInterval(refresh, 30000);
refresh();