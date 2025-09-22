const EVENTS_JSON_URL = "data/events.json";
const LOCAL_STORAGE_KEY = "oufreefood_local_events_v1";

const state = {
  events: [],
  localEvents: [],
  filtered: [],
  filters: {
    query: "",
    campus: "",
    category: "",
    dateFrom: "",
    dateTo: "",
    sort: "soonest"
  }
};

document.addEventListener("DOMContentLoaded", () => {
  initUIRefs();
  wireEvents();
  loadData();
});

let $eventsContainer, $calendarContainer, $resultsCount, $sortSelect, $toast;
let $searchInput, $campusSelect, $categorySelect, $dateFrom, $dateTo, $clearFilters;
let $submitForm, $clearLocal;
let $todayBtn, $prevBtn, $nextBtn, $currentRangeLabel, $viewList, $viewWeek, $viewMonth, $importEngageBtn;

function initUIRefs() {
  $eventsContainer = document.getElementById("eventsContainer");
  $calendarContainer = document.getElementById("calendarContainer");
  $resultsCount = document.getElementById("resultsCount");
  $sortSelect = document.getElementById("sortSelect");
  $toast = document.getElementById("toast");

  $searchInput = document.getElementById("searchInput");
  $campusSelect = document.getElementById("campusSelect");
  $categorySelect = document.getElementById("categorySelect");
  $dateFrom = document.getElementById("dateFrom");
  $dateTo = document.getElementById("dateTo");
  $clearFilters = document.getElementById("clearFilters");

  $submitForm = document.getElementById("submitForm");
  $clearLocal = document.getElementById("clearLocal");

  $todayBtn = document.getElementById("todayBtn");
  $prevBtn = document.getElementById("prevBtn");
  $nextBtn = document.getElementById("nextBtn");
  $currentRangeLabel = document.getElementById("currentRangeLabel");
  $viewList = document.getElementById("viewList");
  $viewWeek = document.getElementById("viewWeek");
  $viewMonth = document.getElementById("viewMonth");
  $importEngageBtn = document.getElementById("importEngageBtn");
}

function wireEvents() {
  const onFilterChange = () => {
    state.filters.query = ($searchInput.value || "").trim();
    state.filters.campus = $campusSelect.value || "";
    state.filters.category = $categorySelect.value || "";
    state.filters.dateFrom = $dateFrom.value || "";
    state.filters.dateTo = $dateTo.value || "";
    state.filters.sort = $sortSelect.value || "soonest";
    applyFiltersAndRender();
  };

  $searchInput.addEventListener("input", debounce(onFilterChange, 150));
  $campusSelect.addEventListener("change", onFilterChange);
  $categorySelect.addEventListener("change", onFilterChange);
  $dateFrom.addEventListener("change", onFilterChange);
  $dateTo.addEventListener("change", onFilterChange);
  $sortSelect.addEventListener("change", onFilterChange);
  $clearFilters.addEventListener("click", () => {
    $searchInput.value = "";
    $campusSelect.value = "";
    $categorySelect.value = "";
    $dateFrom.value = "";
    $dateTo.value = "";
    $sortSelect.value = "soonest";
    onFilterChange();
  });

  $submitForm.addEventListener("submit", onSubmitLocalEvent);
  $clearLocal.addEventListener("click", () => {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    state.localEvents = [];
    applyFiltersAndRender();
    showToast("Cleared local submissions.");
  });

  // View switching and navigation
  let calendarState = {
    view: "list", // list | week | month
    anchor: new Date()
  };
  state.calendarState = calendarState;

  const setView = (view) => {
    calendarState.view = view;
    $viewList.classList.toggle("active", view === "list");
    $viewWeek.classList.toggle("active", view === "week");
    $viewMonth.classList.toggle("active", view === "month");
    $eventsContainer.hidden = view !== "list";
    $calendarContainer.hidden = view === "list";
    applyFiltersAndRender();
  };
  $viewList.addEventListener("click", () => setView("list"));
  $viewWeek.addEventListener("click", () => setView("week"));
  $viewMonth.addEventListener("click", () => setView("month"));

  $todayBtn.addEventListener("click", () => { calendarState.anchor = new Date(); applyFiltersAndRender(); });
  $prevBtn.addEventListener("click", () => { shiftAnchor(-1); });
  $nextBtn.addEventListener("click", () => { shiftAnchor(1); });

  function shiftAnchor(direction) {
    const a = calendarState.anchor;
    if (calendarState.view === "week") {
      a.setDate(a.getDate() + direction * -7); // will be corrected below
      calendarState.anchor = new Date(a);
    } else if (calendarState.view === "month") {
      calendarState.anchor = new Date(a.getFullYear(), a.getMonth() + direction, 1);
    } else {
      calendarState.anchor = new Date(a.getFullYear(), a.getMonth(), a.getDate() + direction);
    }
    applyFiltersAndRender();
  }

  // Engage import (beta)
  $importEngageBtn.addEventListener("click", importFromEngage);
}

async function loadData() {
  try {
    const [remote, local] = await Promise.all([
      fetch(EVENTS_JSON_URL).then(r => r.json()),
      loadLocalEvents()
    ]);
    state.events = normalizeEvents(remote);
    state.localEvents = normalizeEvents(local);
  } catch (e) {
    console.error("Failed to load data", e);
    state.events = [];
    state.localEvents = await loadLocalEvents();
  } finally {
    applyFiltersAndRender();
  }
}

async function importFromEngage() {
  $importEngageBtn.disabled = true;
  $importEngageBtn.textContent = "Importing...";
  try {
    // Prefer GitHub-scraped file if present (no CORS issues on Pages)
    const res = await fetch('data/engage.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('No engage.json yet');
    const list = await res.json();
    const merged = dedupeById([...state.events, ...normalizeEvents(list)]);
    state.events = merged;
    applyFiltersAndRender();
    showToast(`Imported ${list.length} Engage event(s).`);
  } catch (err) {
    console.error(err);
    showToast("No cached Engage data yet. Try again later.");
  } finally {
    $importEngageBtn.disabled = false;
    $importEngageBtn.textContent = "Import from Engage";
  }
}

function inferCampusFromLocation(location) {
  const s = (location || "").toLowerCase();
  if (s.includes("tulsa")) return "Tulsa";
  if (s.includes("oklahoma city") || s.includes("okc") || s.includes("health")) return "OUHSC";
  if (s.includes("norman") || s.includes("devon") || s.includes("sarkeys") || s.includes("bizzell")) return "Norman";
  return "";
}

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}

function dedupeById(arr) {
  const seen = new Set();
  const out = [];
  for (const it of arr) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

function normalizeEvents(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map(item => ({
      id: item.id || cryptoRandomId(),
      title: item.title?.trim() || "Untitled",
      host: item.host?.trim() || "",
      campus: item.campus || "",
      location: item.location || "",
      description: item.description || "",
      category: item.category || "",
      dietary: item.dietary || "",
      link: item.link || "",
      start: item.start ? new Date(item.start).toISOString() : null,
      end: item.end ? new Date(item.end).toISOString() : null,
      createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString(),
    }))
    .filter(e => e.start);
}

function loadLocalEvents() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveLocalEvents(items) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
}

function onSubmitLocalEvent(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  const data = new FormData(form);
  const newEvent = {
    id: cryptoRandomId(),
    title: data.get("title")?.toString().trim() || "Untitled",
    host: data.get("host")?.toString().trim() || "",
    location: data.get("location")?.toString().trim() || "",
    campus: data.get("campus")?.toString() || "",
    category: data.get("category")?.toString() || "",
    start: new Date(data.get("start")).toISOString(),
    end: data.get("end") ? new Date(data.get("end")).toISOString() : null,
    description: data.get("description")?.toString() || "",
    link: data.get("link")?.toString() || "",
    dietary: data.get("dietary")?.toString() || "",
    createdAt: new Date().toISOString(),
  };
  const locals = normalizeEvents([...state.localEvents, newEvent]);
  state.localEvents = locals;
  saveLocalEvents(locals);
  form.reset();
  applyFiltersAndRender();
  showToast("Event added locally. It appears in the list.");
}

function applyFiltersAndRender() {
  const all = [...state.events, ...state.localEvents];
  const { query, campus, category, dateFrom, dateTo, sort } = state.filters;

  const q = query.toLowerCase();
  const from = dateFrom ? new Date(dateFrom) : null;
  const to = dateTo ? new Date(dateTo) : null;

  const filtered = all.filter(ev => {
    const start = new Date(ev.start);
    if (from && start < startOfDay(from)) return false;
    if (to && start > endOfDay(to)) return false;
    if (campus && ev.campus !== campus) return false;
    if (category && ev.category !== category) return false;
    if (q) {
      const hay = `${ev.title} ${ev.host} ${ev.description} ${ev.location}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (sort === "soonest") return new Date(a.start) - new Date(b.start);
    if (sort === "latest") return new Date(b.start) - new Date(a.start);
    if (sort === "added") return new Date(b.createdAt) - new Date(a.createdAt);
    return 0;
  });

  state.filtered = filtered;
  const view = state.calendarState?.view || "list";
  if (view === "list") {
    renderList(filtered);
  } else if (view === "week") {
    renderWeekCalendar(filtered);
  } else if (view === "month") {
    renderMonthCalendar(filtered);
  }
}

function renderList(items) {
  $eventsContainer.innerHTML = "";
  $resultsCount.textContent = `${items.length} ${items.length === 1 ? "event" : "events"}`;
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.innerHTML = `<div>No events match your filters. Try clearing filters or widen dates.</div>`;
    $eventsContainer.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const ev of items) {
    frag.appendChild(renderCard(ev));
  }
  $eventsContainer.appendChild(frag);
}

function renderCard(ev) {
  const card = document.createElement("article");
  card.className = "card";
  const start = new Date(ev.start);
  const end = ev.end ? new Date(ev.end) : null;
  const isOngoing = isNowBetween(start, end);
  const isPast = start < new Date() && !isOngoing;

  const timeText = end ? `${formatDateTimeRange(start, end)}` : `${formatDateTime(start)}`;

  card.innerHTML = `
    <div class="meta">
      <span class="badge" title="Campus">🏫 ${ev.campus || ""}</span>
      <span class="badge" title="Category">🍽️ ${ev.category || ""}</span>
      ${ev.dietary ? `<span class="badge" title="Dietary">🥗 ${escapeHtml(ev.dietary)}</span>` : ""}
    </div>
    <h3>${escapeHtml(ev.title)}</h3>
    <div class="meta">
      <span>📍 ${escapeHtml(ev.location)}</span>
      ${ev.host ? `<span>• Host: ${escapeHtml(ev.host)}</span>` : ""}
    </div>
    <div class="meta">
      <span>🕒 ${timeText}</span>
      <span>• ${relativeTimeFromNow(start)}</span>
    </div>
    ${ev.description ? `<p class="desc">${escapeHtml(ev.description)}</p>` : ""}
    <div class="actions">
      ${ev.link ? `<a href="${escapeAttr(ev.link)}" target="_blank" rel="noopener noreferrer">Event link →</a>` : ""}
      ${isOngoing ? `<span class="pill" title="Happening now">Happening now</span>` : (isPast ? `<span class="pill" style="background:#e2e8f0;color:#0f172a">Past</span>` : "")}
    </div>
  `;
  return card;
}

function renderMonthCalendar(items) {
  $calendarContainer.innerHTML = "";
  const anchor = startOfMonth(state.calendarState.anchor);
  const start = startOfWeek(anchor);
  const end = endOfWeek(endOfMonth(anchor));
  $currentRangeLabel.textContent = anchor.toLocaleString([], { month: "long", year: "numeric" });

  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }

  const head = document.createElement("div");
  head.className = "cal-head";
  const weekdays = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  for (const wd of weekdays) {
    const el = document.createElement("div");
    el.textContent = wd;
    head.appendChild(el);
  }

  const grid = document.createElement("div");
  grid.className = "cal-grid";
  grid.appendChild(head);

  for (let i = 0; i < days.length; i += 7) {
    const row = document.createElement("div");
    row.className = "cal-row";
    for (let j = 0; j < 7; j++) {
      const day = days[i + j];
      const cell = document.createElement("div");
      cell.className = "cal-cell";
      const dateEl = document.createElement("div");
      dateEl.className = "cal-date";
      const isToday = isSameDay(day, new Date());
      const outside = day.getMonth() !== anchor.getMonth();
      if (isToday) dateEl.classList.add("today");
      if (outside) dateEl.classList.add("outside");
      dateEl.textContent = day.getDate();
      cell.appendChild(dateEl);

      const todays = items.filter(ev => isSameDay(new Date(ev.start), day));
      todays.sort((a,b) => new Date(a.start) - new Date(b.start));
      for (const ev of todays.slice(0, 4)) {
        const evEl = document.createElement("a");
        evEl.href = ev.link ? escapeAttr(ev.link) : "#";
        evEl.className = "cal-event" + (isNowBetween(new Date(ev.start), ev.end ? new Date(ev.end) : null) ? " ongoing" : "");
        evEl.target = ev.link ? "_blank" : "_self";
        evEl.rel = ev.link ? "noopener noreferrer" : "";
        evEl.title = `${formatTime(new Date(ev.start))}${ev.end?"-"+formatTime(new Date(ev.end)):""} ${ev.title}`;
        evEl.textContent = `${formatTime(new Date(ev.start))} ${ev.title}`;
        cell.appendChild(evEl);
      }
      if (todays.length > 4) {
        const more = document.createElement("div");
        more.className = "cal-event";
        more.textContent = `+${todays.length - 4} more`;
        cell.appendChild(more);
      }

      row.appendChild(cell);
    }
    grid.appendChild(row);
  }

  $calendarContainer.appendChild(grid);
}

function renderWeekCalendar(items) {
  $calendarContainer.innerHTML = "";
  const anchor = startOfWeek(state.calendarState.anchor);
  const end = endOfWeek(anchor);
  const rangeLabel = `${anchor.toLocaleDateString([], { month: "short", day: "numeric" })} – ${end.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
  $currentRangeLabel.textContent = rangeLabel;

  const wrapper = document.createElement("div");
  wrapper.className = "week-grid";

  const hoursCol = document.createElement("div");
  hoursCol.className = "week-hours";
  for (let h = 0; h < 24; h++) {
    const d = document.createElement("div");
    d.textContent = `${h}:00`;
    hoursCol.appendChild(d);
  }

  const cols = document.createElement("div");
  cols.className = "week-cols";
  for (let i = 0; i < 7; i++) {
    const col = document.createElement("div");
    col.className = "week-col";
    const slot = document.createElement("div");
    slot.className = "week-slot";
    col.appendChild(slot);
    cols.appendChild(col);
  }

  wrapper.appendChild(hoursCol);
  wrapper.appendChild(cols);
  $calendarContainer.appendChild(wrapper);

  // Position events
  const dayIndex = (d) => (d.getDay());
  const slotHeight = 40; // px per hour
  for (const ev of items) {
    const start = new Date(ev.start);
    if (start < anchor || start > end) continue;
    const endTime = ev.end ? new Date(ev.end) : new Date(start.getTime() + 60 * 60 * 1000);
    const col = cols.children[dayIndex(start)];
    const slot = col.firstChild;
    const top = (start.getHours() + start.getMinutes() / 60) * slotHeight;
    const height = Math.max(24, ((endTime - start) / (1000 * 60 * 60)) * slotHeight);
    const el = document.createElement("div");
    el.className = "week-event" + (isNowBetween(start, ev.end ? new Date(ev.end) : null) ? " ongoing" : "");
    el.style.top = `${top}px`;
    el.style.height = `${height}px`;
    el.title = `${formatDateTimeRange(start, endTime)} ${ev.title}`;
    el.textContent = `${formatTime(start)} ${ev.title}`;
    slot.appendChild(el);
  }
}

// Utils
function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function isNowBetween(start, end) {
  const now = new Date();
  if (!end) return false;
  return now >= start && now <= end;
}
function formatDateTime(d) {
  return d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function formatDateTimeRange(start, end) {
  if (!end) return formatDateTime(start);
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    const datePart = start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    const startTime = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const endTime = end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return `${datePart}, ${startTime} – ${endTime}`;
  }
  return `${formatDateTime(start)} – ${formatDateTime(end)}`;
}
function relativeTimeFromNow(date) {
  const now = new Date();
  const diffMs = date - now;
  const absMs = Math.abs(diffMs);
  const mins = Math.round(absMs / 60000);
  if (mins < 60) return diffMs >= 0 ? `in ${mins} min` : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return diffMs >= 0 ? `in ${hours} hr` : `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return diffMs >= 0 ? `in ${days} d` : `${days} d ago`;
}
function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
}
function escapeAttr(s) {
  return (s || "").replace(/["'`<>\n]/g, "");
}
function cryptoRandomId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function showToast(msg) {
  $toast.textContent = msg;
  $toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => $toast.classList.remove("show"), 1800);
}

// Date helpers for calendar
function startOfWeek(d) {
  const day = d.getDay();
  const s = new Date(d);
  s.setDate(d.getDate() - day);
  s.setHours(0,0,0,0);
  return s;
}
function endOfWeek(d) {
  const s = startOfWeek(d);
  s.setDate(s.getDate() + 6);
  s.setHours(23,59,59,999);
  return s;
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function formatTime(d) {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}


