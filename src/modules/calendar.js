import { getSettings, saveSettings, ensureChatStateLoaded } from "./core.js";
import { generateContent } from "./apiClient.js";
import { getScheduledCharacters, parseSchedule, updateCharacterSchedules } from "./schedules.js";

const DEFAULT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_WEATHER = { Clear: 0.6, Rain: 0.3, Storm: 0.1, Snow: 0, Fog: 0 };
const WEATHER_ICONS = {
  Clear: "\u2600\uFE0F",
  Rain: "\uD83C\uDF27\uFE0F",
  Storm: "\u26C8\uFE0F",
  Snow: "\u2744\uFE0F",
  Fog: "\uD83C\uDF2B\uFE0F"
};
const BIRTHDAY_ICON = "\uD83C\uDF82";
const SOCIAL_TABS = ["friends", "associates", "associate", "romance", "family", "rivals", "npc"];

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeWeatherName(value, fallback = "Clear") {
  const raw = String(value || "").trim();
  const found = Object.keys(WEATHER_ICONS).find((k) => k.toLowerCase() === raw.toLowerCase());
  return found || fallback;
}

function normalizeWeatherWeights(input) {
  const out = {};
  for (const key of Object.keys(WEATHER_ICONS)) {
    const n = Number(input?.[key]);
    out[key] = Number.isFinite(n) && n > 0 ? n : 0;
  }
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  return sum > 0 ? out : { ...DEFAULT_WEATHER };
}

function normalizeFantasyCalendar(fantasy) {
  const cfg = fantasy && typeof fantasy === "object" ? fantasy : {};
  let weekdays = Array.isArray(cfg.weekdays)
    ? cfg.weekdays.map((x) => String(x || "").trim()).filter(Boolean)
    : DEFAULT_WEEKDAYS.slice();
  if (weekdays.length < 1) weekdays = DEFAULT_WEEKDAYS.slice();
  weekdays = weekdays.slice(0, 10);

  let seasons = Array.isArray(cfg.seasons) ? cfg.seasons : [];
  seasons = seasons
    .map((season, idx) => ({
      name: String(season?.name || `Season ${idx + 1}`).trim().slice(0, 40) || `Season ${idx + 1}`,
      days: clampInt(season?.days, 1, 366, 28),
      weather: normalizeWeatherWeights(season?.weather)
    }))
    .filter((season) => season.days > 0);

  if (!seasons.length) {
    seasons = [
      { name: "Spring", days: 28, weather: { Clear: 0.6, Rain: 0.3, Storm: 0.1, Snow: 0, Fog: 0 } },
      { name: "Summer", days: 28, weather: { Clear: 0.7, Rain: 0.1, Storm: 0.2, Snow: 0, Fog: 0 } },
      { name: "Autumn", days: 28, weather: { Clear: 0.5, Rain: 0.3, Storm: 0, Snow: 0, Fog: 0.2 } },
      { name: "Winter", days: 28, weather: { Clear: 0.4, Rain: 0, Storm: 0, Snow: 0.5, Fog: 0.1 } }
    ];
  }

  return { weekdays, seasons };
}

function fantasyDateKey(fd) {
  return `${fd.year}-${fd.seasonIndex}-${fd.dayOfSeason}`;
}

function calendarYearLength(s) {
  return s.calendar.fantasy.seasons.reduce((sum, season) => sum + Number(season.days || 0), 0);
}

function weatherIcon(weather) {
  return WEATHER_ICONS[normalizeWeatherName(weather)] || WEATHER_ICONS.Clear;
}

/**
 * Ensures the calendar template is mounted to the document body.
 */
export async function ensureCalendarMounted() {
  try {
    if (typeof document !== "undefined" && document.getElementById("uie-calendar-window")) return true;
  } catch (_) {
    return false;
  }
  try {
    const { fetchTemplateHtml } = await import("./templateFetch.js");
    if (typeof fetchTemplateHtml !== "function") return false;
    const baseRaw = String(window.UIE_BASEURL || "/").trim();
    const base = baseRaw.endsWith("/") ? baseRaw : `${baseRaw}/`;
    const urls = [
      `${base}src/templates/calendar.html`,
      "src/templates/calendar.html",
      "./src/templates/calendar.html"
    ];

    let html = "";
    for (const u of urls) {
      try {
        const chunk = await fetchTemplateHtml(u);
        if (chunk && String(chunk).includes("uie-calendar-window")) {
          html = chunk;
          break;
        }
      } catch (_) {}
    }
    if (!html) return false;
    $("body").append(html);
    return !!document.getElementById("uie-calendar-window");
  } catch (e) {
    console.warn("[UIE] ensureCalendarMounted failed", e);
    return false;
  }
}

// Ensure calendar state properties exist
export function ensureCalendar(s) {
  if (!s.calendar) s.calendar = {};
  if (!s.calendar.events || typeof s.calendar.events !== "object") s.calendar.events = {};
  if (!s.calendar.mode || !["real", "fantasy"].includes(String(s.calendar.mode || ""))) s.calendar.mode = "real";
  s.calendar.minutesPerGameDay = clampInt(s.calendar.minutesPerGameDay, 1, 1440, 20);
  if (!s.calendar.weatherOverrides || typeof s.calendar.weatherOverrides !== "object") s.calendar.weatherOverrides = {};
  if (typeof s.calendar.cursor !== "string") s.calendar.cursor = "";
  s.calendar.fantasy = normalizeFantasyCalendar(s.calendar.fantasy);

  // Backup fields
  if (typeof s.calendar.rpEnabled !== "boolean") s.calendar.rpEnabled = false;
  if (typeof s.calendar.rpDate !== "string") s.calendar.rpDate = "";
  if (typeof s.calendar.reminderEnabled !== "boolean") s.calendar.reminderEnabled = true;
  if (typeof s.calendar.reminderPopup !== "boolean") s.calendar.reminderPopup = true;
  if (!Array.isArray(s.calendar.keywordRules)) s.calendar.keywordRules = [];
  if (!s.calendar.timePhysics || typeof s.calendar.timePhysics !== "object") {
    s.calendar.timePhysics = { summary: "", userDescription: "", template: "fantasy", rulesJson: null, updatedAt: 0 };
  }
}

// Seeded random number generator
function getSeededRandom(seedString) {
  let hash = 0;
  for (let i = 0; i < seedString.length; i++) {
    hash = seedString.charCodeAt(i) + ((hash << 5) - hash);
  }
  const x = Math.sin(hash) * 10000;
  return x - Math.floor(x);
}

// Procedural weather forecaster
export function getSeededForecast(s, dateKey) {
  ensureCalendar(s);
  if (s.calendar.weatherOverrides && s.calendar.weatherOverrides[dateKey]) {
    return normalizeWeatherName(s.calendar.weatherOverrides[dateKey]);
  }

  const rand = getSeededRandom(dateKey);
  let weights = { ...DEFAULT_WEATHER };

  if (s.calendar.mode === "fantasy") {
    const parts = dateKey.split("-");
    const seasonIdx = clampInt(parts[1], 0, s.calendar.fantasy.seasons.length - 1, 0);
    const season = s.calendar.fantasy.seasons[seasonIdx];
    if (season && season.weather) weights = normalizeWeatherWeights(season.weather);
  } else {
    // Real world seasons (Northern Hemisphere default)
    const parts = dateKey.split("-");
    const m = parseInt(parts[1]); // Month
    if (m >= 3 && m <= 5) weights = { Clear: 0.6, Rain: 0.3, Storm: 0.1, Snow: 0, Fog: 0 }; // Spring
    else if (m >= 6 && m <= 8) weights = { Clear: 0.7, Rain: 0.1, Storm: 0.2, Snow: 0, Fog: 0 }; // Summer
    else if (m >= 9 && m <= 11) weights = { Clear: 0.5, Rain: 0.3, Storm: 0, Snow: 0, Fog: 0.2 }; // Autumn
    else weights = { Clear: 0.4, Rain: 0, Storm: 0, Snow: 0.5, Fog: 0.1 }; // Winter
  }

  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum) || sum <= 0) return "Clear";
  let accum = 0;
  const target = rand * sum;
  for (const [w, val] of Object.entries(weights)) {
    accum += val;
    if (target <= accum) return w;
  }
  return "Clear";
}

// Convert absolute day number to Custom Fantasy Date
export function getFantasyDateFromAbsoluteDay(s, absoluteDay) {
  ensureCalendar(s);
  const seasons = s.calendar.fantasy.seasons;
  const yearLength = calendarYearLength(s);
  if (yearLength <= 0) return { year: 1, seasonIndex: 0, seasonName: "Spring", dayOfSeason: 1 };

  const dayZero = Math.max(0, absoluteDay - 1);
  const year = Math.floor(dayZero / yearLength) + 1;
  let remainingDays = dayZero % yearLength;

  let seasonIndex = 0;
  for (let i = 0; i < seasons.length; i++) {
    if (remainingDays < seasons[i].days) {
      seasonIndex = i;
      break;
    }
    remainingDays -= seasons[i].days;
  }

  return {
    year,
    seasonIndex,
    seasonName: seasons[seasonIndex]?.name || `Season ${seasonIndex + 1}`,
    dayOfSeason: remainingDays + 1
  };
}

// Get absolute day number from Custom Fantasy Date
export function getAbsoluteDayFromFantasyDate(s, year, seasonIndex, dayOfSeason) {
  ensureCalendar(s);
  const seasons = s.calendar.fantasy.seasons;
  const yearLength = calendarYearLength(s);
  let dayNum = (Math.max(1, year) - 1) * yearLength;

  for (let i = 0; i < Math.min(seasons.length, seasonIndex); i++) {
    dayNum += seasons[i].days;
  }
  const season = seasons[Math.max(0, Math.min(seasons.length - 1, Number(seasonIndex) || 0))] || seasons[0];
  dayNum += clampInt(dayOfSeason, 1, Number(season?.days || 28), 1);
  return dayNum;
}

// Fetch calendar-relevant date key for today
export function getTodayDateKey(s) {
  ensureCalendar(s);
  if (s.calendar.mode === "fantasy") {
    const absDay = Math.max(1, Number(s.playerRoom?.day || 1));
    const fd = getFantasyDateFromAbsoluteDay(s, absDay);
    return fantasyDateKey(fd);
  } else {
    if (s.calendar.rpEnabled && s.calendar.rpDate) {
      return s.calendar.rpDate;
    }
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
}

// Helper to retrieve contacts for birthday assignment
function collectSocialContacts(s) {
  const out = [];
  if (!s.social || typeof s.social !== "object") return out;
  for (const t of SOCIAL_TABS) {
    const list = Array.isArray(s.social[t]) ? s.social[t] : [];
    list.forEach((p, i) => {
      const name = String(p?.name || "").trim();
      if (!name) return;
      const id = String(p?.id || p?.name || `${t}_${i}`).trim();
      out.push({ id, name, birthday: String(p?.birthday || "").trim(), tab: t });
    });
  }
  return out;
}

// Helper to find contact and update their birthday
function updateSocialContactBirthday(s, contactId, bdayString) {
  if (!s.social || typeof s.social !== "object") return false;
  for (const t of SOCIAL_TABS) {
    const list = Array.isArray(s.social[t]) ? s.social[t] : [];
    for (const p of list) {
      const id = String(p?.id || p?.name || "").trim();
      if (id === contactId) {
        p.birthday = bdayString;
        return true;
      }
    }
  }
  return false;
}

function birthdayMatches(s, contact, dateKey) {
  const bday = String(contact?.birthday || "").trim();
  if (!bday) return false;
  if (s.calendar.mode === "fantasy") {
    const parts = String(dateKey || "").split("-");
    if (parts.length < 3) return false;
    return bday === `${parts[1]}-${parts[2]}` || bday === dateKey;
  }
  const parts = String(dateKey || "").split("-");
  if (parts.length < 3) return false;
  const shortKey = `${parts[1]}-${parts[2]}`;
  return bday === shortKey || bday === dateKey || bday.endsWith(shortKey);
}

function renderWeekdays(days) {
  const weekdaysContainer = $("#cal-weekdays-header");
  weekdaysContainer.empty();
  days.forEach((day) => {
    weekdaysContainer.append(`<div style="text-align:center;">${esc(day)}</div>`);
  });
}

function renderDayCell({ dateKey, dayNumber, isToday, events, birthdays, weather }) {
  const birthdayTitle = birthdays.length ? `Birthday: ${birthdays.map((x) => x.name).join(", ")}` : "";
  const birthdayRows = birthdays
    .map((c) => `<div style="color:#e74c3c;">${BIRTHDAY_ICON} ${esc(c.name)}</div>`)
    .join("");
  const eventRows = events
    .map((e) => `<div>${esc(e?.title || "Untitled event")}</div>`)
    .join("");
  return $(`
    <div class="cal-stardew-day ${isToday ? "is-today" : ""}" data-date="${esc(dateKey)}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div class="cal-day-num">${esc(dayNumber)}</div>
        <div class="cal-day-icons">
          ${birthdays.length ? `<span class="cal-bday-icon" title="${esc(birthdayTitle)}">${BIRTHDAY_ICON}</span>` : ""}
          <span class="cal-weather-icon" title="Forecast: ${esc(weather)}">${weatherIcon(weather)}</span>
        </div>
      </div>
      <div class="cal-day-events">
        ${birthdayRows}
        ${eventRows}
      </div>
    </div>
  `);
}

// Render the grid, days, events, birthdays, and forecasts
export function renderCalendar() {
  const s = getSettings();
  ensureCalendar(s);

  // Sync HUD info
  const loc = String(s?.worldState?.location || "In-world").trim() || "In-world";
  $("#cal-tz").text(loc);
  $("#cal-hud-minutes-display").text(`${s.calendar.minutesPerGameDay}m`);

  // Handle active cursor index
  let cursor = s.calendar.cursor || "";
  if (s.calendar.mode === "fantasy") {
    const absDay = Math.max(1, Number(s.playerRoom?.day || 1));
    const fd = getFantasyDateFromAbsoluteDay(s, absDay);
    if (!cursor || !cursor.includes("-")) {
      cursor = `${fd.year}-${fd.seasonIndex}`;
      s.calendar.cursor = cursor;
    }
    
    const parts = cursor.split("-");
    const curYear = parseInt(parts[0]);
    const curSeasonIdx = parseInt(parts[1]);
    const season = s.calendar.fantasy.seasons[curSeasonIdx] || s.calendar.fantasy.seasons[0];
    $("#cal-month-title").text(`${season?.name || "Spring"}, Year ${curYear}`);

    // Update weekday labels in DOM
    const weekdaysContainer = $("#cal-weekdays-header");
    weekdaysContainer.empty();
    s.calendar.fantasy.weekdays.forEach(day => {
      weekdaysContainer.append(`<div style="text-align:center;">${esc(day)}</div>`);
    });

    // Render cells
    const grid = $("#cal-grid");
    grid.empty();

    const todayAbsDay = Math.max(1, Number(s.playerRoom?.day || 1));
    const todayFd = getFantasyDateFromAbsoluteDay(s, todayAbsDay);
    const totalDays = season?.days || 28;

    for (let d = 1; d <= totalDays; d++) {
      const cellKey = `${curYear}-${curSeasonIdx}-${d}`;
      const isToday = todayFd.year === curYear && todayFd.seasonIndex === curSeasonIdx && todayFd.dayOfSeason === d;

      // Find events scheduled for this day
      const evs = (Array.isArray(s.calendar.events[cellKey]) ? s.calendar.events[cellKey] : [])
        .map((e) => ({ ...e, title: esc(e?.title || "Untitled event") }));

      // Check for birthdays of social contacts
      const contacts = collectSocialContacts(s);
      const bdaysToday = contacts
        .filter((c) => birthdayMatches(s, c, cellKey))
        .map((c) => ({ ...c, name: esc(c.name) }));

      // Procedural weather for this day
      const weather = getSeededForecast(s, cellKey);
      const weatherIcons = { Clear: "☀️", Rain: "🌧️", Storm: "⛈️", Snow: "❄️", Fog: "🌫️" };
      const weatherIcon = weatherIcons[weather] || "☀️";

      const cell = $(`
        <div class="cal-stardew-day ${isToday ? 'is-today' : ''}" data-date="${cellKey}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div class="cal-day-num">${d}</div>
            <div class="cal-day-icons">
              ${bdaysToday.length ? `<span class="cal-bday-icon" title="Birthday: ${bdaysToday.map(x=>x.name).join(', ')}">🎂</span>` : ''}
              <span class="cal-weather-icon" title="Forecast: ${weather}">${weatherIcon}</span>
            </div>
          </div>
          <div class="cal-day-events">
            ${bdaysToday.map(c => `<div style="color:#e74c3c;">🎂 ${c.name}</div>`).join('')}
            ${evs.map(e => `<div>${e.title}</div>`).join('')}
          </div>
        </div>
      `);
      grid.append(cell);
    }
  } else {
    // Gregorian Real-World rendering
    const today = new Date();
    if (!cursor || !cursor.includes("-")) {
      cursor = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
      s.calendar.cursor = cursor;
    }

    const parts = cursor.split("-");
    const curYear = parseInt(parts[0]);
    const curMonthIdx = parseInt(parts[1]) - 1; // 0-indexed

    const firstDayDate = new Date(curYear, curMonthIdx, 1);
    const startOffset = firstDayDate.getDay();
    const daysInMonth = new Date(curYear, curMonthIdx + 1, 0).getDate();

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    $("#cal-month-title").text(`${monthNames[curMonthIdx]} ${curYear}`);

    // Update weekday labels in DOM
    const weekdaysContainer = $("#cal-weekdays-header");
    weekdaysContainer.empty();
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach(day => {
      weekdaysContainer.append(`<div style="text-align:center;">${esc(day)}</div>`);
    });

    const grid = $("#cal-grid");
    grid.empty();

    // Render empty start cells
    for (let i = 0; i < startOffset; i++) {
      grid.append('<div class="cal-stardew-day is-empty"></div>');
    }

    const todayKey = getTodayDateKey(s);

    for (let d = 1; d <= daysInMonth; d++) {
      const cellKey = `${curYear}-${String(curMonthIdx + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const isToday = cellKey === todayKey;

      const evs = (Array.isArray(s.calendar.events[cellKey]) ? s.calendar.events[cellKey] : [])
        .map((e) => ({ ...e, title: esc(e?.title || "Untitled event") }));
      const contacts = collectSocialContacts(s);

      // Check birthdays matching both annual "MM-DD" and full "YYYY-MM-DD" formats
      const bdaysToday = contacts
        .filter((c) => birthdayMatches(s, c, cellKey))
        .map((c) => ({ ...c, name: esc(c.name) }));

      const weather = getSeededForecast(s, cellKey);
      const weatherIcons = { Clear: "☀️", Rain: "🌧️", Storm: "⛈️", Snow: "❄️", Fog: "🌫️" };
      const weatherIcon = weatherIcons[weather] || "☀️";

      const cell = $(`
        <div class="cal-stardew-day ${isToday ? 'is-today' : ''}" data-date="${cellKey}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div class="cal-day-num">${d}</div>
            <div class="cal-day-icons">
              ${bdaysToday.length ? `<span class="cal-bday-icon" title="Birthday: ${bdaysToday.map(x=>x.name).join(', ')}">🎂</span>` : ''}
              <span class="cal-weather-icon" title="Forecast: ${weather}">${weatherIcon}</span>
            </div>
          </div>
          <div class="cal-day-events">
            ${bdaysToday.map(c => `<div style="color:#e74c3c;">🎂 ${c.name}</div>`).join('')}
            ${evs.map(e => `<div>${e.title}</div>`).join('')}
          </div>
        </div>
      `);
      grid.append(cell);
    }
  }
}

// Renders the list inside the detail modal
function renderCalModalList(dateKey) {
  const s = getSettings();
  ensureCalendar(s);
  const list = $("#cal-modal-events-list");
  list.empty();

  const evs = (Array.isArray(s.calendar.events[dateKey]) ? s.calendar.events[dateKey] : [])
    .map((e) => ({
      ...e,
      title: esc(e?.title || "Untitled event"),
      time: esc(e?.time || ""),
      notes: esc(e?.notes || "")
    }));
  const contacts = collectSocialContacts(s);

  const bdaysToday = contacts
    .filter((c) => birthdayMatches(s, c, dateKey))
    .map((c) => ({ ...c, name: esc(c.name) }));

  if (evs.length === 0 && bdaysToday.length === 0) {
    list.append('<div style="text-align:center; padding:10px; font-style:italic; opacity:0.6;">No events scheduled.</div>');
    return;
  }

  bdaysToday.forEach(c => {
    list.append(`
      <div style="background:rgba(231,76,60,0.1); border:1px solid rgba(231,76,60,0.3); border-radius:6px; padding:8px; display:flex; justify-content:space-between; align-items:center;">
        <div>🎂 <strong>Birthday: ${c.name}</strong> <span style="font-size:11px; opacity:0.7;">(From Social contacts)</span></div>
      </div>
    `);
  });

  evs.forEach((e, idx) => {
    list.append(`
      <div style="background:rgba(142,84,49,0.08); border:1px solid rgba(142,84,49,0.2); border-radius:6px; padding:8px; display:flex; justify-content:space-between; align-items:flex-start;">
        <div style="flex:1;">
          <div style="font-weight:bold; color:#5d4037;">${e.time ? `[${e.time}] ` : ''}${e.title}</div>
          ${e.notes ? `<div style="font-size:11px; opacity:0.8; margin-top:4px; white-space:pre-wrap;">${e.notes}</div>` : ''}
        </div>
        <button class="cal-del cal-stardew-btn" data-idx="${idx}" style="padding:2px 6px; background:#e74c3c !important; color:#fff !important; font-size:11px; box-shadow:none; border-width:1px;">✕</button>
      </div>
    `);
  });
}

function setCalendarView(view = "calendar") {
  const target = view === "schedules" ? "schedules" : "calendar";
  $(".cal-view-tab").removeClass("active").filter(`[data-cal-view="${target}"]`).addClass("active");
  $(".cal-view-panel").removeClass("active").filter(`[data-cal-panel="${target}"]`).addClass("active");
}

function renderCalendarSchedules() {
  const s = getSettings();
  const list = document.getElementById("cal-schedules-list");
  if (!list) return;
  const people = getScheduledCharacters(s);
  list.innerHTML = people.length ? "" : `<div style="padding:30px;text-align:center;color:#8e5431;font-weight:800;">No scheduled game characters are in Social yet.</div>`;
  for (const person of people) {
    const row = document.createElement("article");
    row.className = "cal-schedule-card";
    const entries = parseSchedule(person.schedule);
    row.innerHTML = `<div class="cal-schedule-head"><strong></strong><span class="cal-schedule-location"></span></div><div class="cal-schedule-activity"></div><div class="cal-schedule-entries"></div>`;
    row.querySelector("strong").textContent = person.name || "Unknown";
    row.querySelector(".cal-schedule-location").textContent = person.location || person.currentLocation || "Unknown location";
    row.querySelector(".cal-schedule-activity").textContent = person.currentActivity || "No current activity";
    row.querySelector(".cal-schedule-entries").textContent = entries.length
      ? entries.map((entry) => `${entry.time}: ${entry.activity ? `${entry.activity} @ ` : ""}${entry.location}`).join("\n")
      : "No schedule saved.";
    list.appendChild(row);
  }
}

// Binds all DOM elements and UI triggers
export function initCalendar() {
  ensureCalendarMounted().then(ok => {
    if (!ok) return;

    const $w = $("#uie-calendar-window");
    $w.off("click change keyup");

    // Window prevention from background click closing
    $w.on("click contextmenu", (e) => {
      e.stopPropagation();
    });

    // Close button
    $w.on("click", "#cal-close-btn", function(e) {
      e.preventDefault(); e.stopPropagation();
      $w.fadeOut(200);
    });

    $w.on("click", ".cal-view-tab", function(e) {
      e.preventDefault();
      const view = String($(this).attr("data-cal-view") || "calendar");
      if (view === "schedules") {
        updateCharacterSchedules(getSettings(), { allowDeviation: false });
        renderCalendarSchedules();
      }
      setCalendarView(view);
    });

    // Month Navigation
    $w.on("click", "#cal-prev", function(e) {
      e.preventDefault(); e.stopPropagation();
      const s = getSettings(); ensureCalendar(s);
      const cursor = s.calendar.cursor;
      if (s.calendar.mode === "fantasy") {
        const parts = cursor.split("-");
        let year = parseInt(parts[0]);
        let seasonIdx = parseInt(parts[1]) - 1;
        if (seasonIdx < 0) {
          seasonIdx = s.calendar.fantasy.seasons.length - 1;
          year = Math.max(1, year - 1);
        }
        s.calendar.cursor = `${year}-${seasonIdx}`;
      } else {
        const parts = cursor.split("-");
        let year = parseInt(parts[0]);
        let month = parseInt(parts[1]) - 1;
        if (month < 1) {
          month = 12;
          year--;
        }
        s.calendar.cursor = `${year}-${String(month).padStart(2, "0")}`;
      }
      saveSettings();
      renderCalendar();
    });

    $w.on("click", "#cal-next", function(e) {
      e.preventDefault(); e.stopPropagation();
      const s = getSettings(); ensureCalendar(s);
      const cursor = s.calendar.cursor;
      if (s.calendar.mode === "fantasy") {
        const parts = cursor.split("-");
        let year = parseInt(parts[0]);
        let seasonIdx = parseInt(parts[1]) + 1;
        if (seasonIdx >= s.calendar.fantasy.seasons.length) {
          seasonIdx = 0;
          year++;
        }
        s.calendar.cursor = `${year}-${seasonIdx}`;
      } else {
        const parts = cursor.split("-");
        let year = parseInt(parts[0]);
        let month = parseInt(parts[1]) + 1;
        if (month > 12) {
          month = 1;
          year++;
        }
        s.calendar.cursor = `${year}-${String(month).padStart(2, "0")}`;
      }
      saveSettings();
      renderCalendar();
    });

    // Open Settings Drawer
    $w.on("click", "#cal-options-toggle", function(e) {
      e.preventDefault(); e.stopPropagation();
      const drawer = $("#cal-options-drawer");
      const s = getSettings(); ensureCalendar(s);
      
      // Load current configs to form
      $("#cal-opt-mode").val(s.calendar.mode);
      $("#cal-opt-day-len").val(s.calendar.minutesPerGameDay);
      $("#cal-opt-weekdays").val(s.calendar.fantasy.weekdays.join(","));

      if (s.calendar.mode === "fantasy") {
        $("#cal-fantasy-options").show();
      } else {
        $("#cal-fantasy-options").hide();
      }

      // Render fantasy seasons list
      const list = $("#cal-seasons-list");
      list.empty();
      s.calendar.fantasy.seasons.forEach((season, idx) => {
        list.append(`
          <div class="season-row" data-idx="${idx}" style="display:grid; grid-template-columns: 1fr 60px 40px; gap:6px; align-items:center;">
            <input type="text" class="cal-input season-name" style="padding:4px;" value="${esc(season.name)}">
            <input type="number" class="cal-input season-days" style="padding:4px;" value="${esc(season.days)}" min="1">
            <button class="cal-stardew-btn cal-del-season" style="background:#e74c3c !important; color:#fff !important; padding:4px; font-size:11px; box-shadow:none;">✕</button>
          </div>
        `);
      });

      drawer.addClass("is-open");
    });

    // Close Options Drawer
    $w.on("click", "#cal-options-close", function(e) {
      e.preventDefault(); e.stopPropagation();
      $("#cal-options-drawer").removeClass("is-open");
    });

    // Calendar mode change inside drawer
    $w.on("change", "#cal-opt-mode", function() {
      if ($(this).val() === "fantasy") {
        $("#cal-fantasy-options").slideDown(200);
      } else {
        $("#cal-fantasy-options").slideUp(200);
      }
    });

    // Add Season button
    $w.on("click", "#cal-add-season-btn", function(e) {
      e.preventDefault();
      $("#cal-seasons-list").append(`
        <div class="season-row" style="display:grid; grid-template-columns: 1fr 60px 40px; gap:6px; align-items:center;">
          <input type="text" class="cal-input season-name" style="padding:4px;" value="New Season">
          <input type="number" class="cal-input season-days" style="padding:4px;" value="28" min="1">
          <button class="cal-stardew-btn cal-del-season" style="background:#e74c3c !important; color:#fff !important; padding:4px; font-size:11px; box-shadow:none;">✕</button>
        </div>
      `);
    });

    // Delete Season row
    $w.on("click", ".cal-del-season", function(e) {
      e.preventDefault();
      $(this).closest(".season-row").remove();
    });

    // Save Options Drawer Config
    $w.on("click", "#cal-save-options", function(e) {
      e.preventDefault();
      const s = getSettings(); ensureCalendar(s);
      
      const prevMode = s.calendar.mode;
      s.calendar.mode = $("#cal-opt-mode").val();

      const M = Math.max(1, parseInt($("#cal-opt-day-len").val()) || 20);
      s.calendar.minutesPerGameDay = M;
      s.ui = s.ui || {};
      s.ui.timeFlow = s.ui.timeFlow || {};
      s.ui.timeFlow.gameMinutesPerRealMinute = 1440 / M;

      if (s.calendar.mode === "fantasy") {
        const weekdays = $("#cal-opt-weekdays").val().split(",").map(x => x.trim()).filter(Boolean).slice(0, 10);
        s.calendar.fantasy.weekdays = weekdays.length ? weekdays : DEFAULT_WEEKDAYS.slice();
        
        const previousSeasons = s.calendar.fantasy.seasons || [];
        const seasons = [];
        $("#cal-seasons-list .season-row").each(function(idx) {
          const name = $(this).find(".season-name").val().trim().slice(0, 40) || "Season";
          const days = clampInt($(this).find(".season-days").val(), 1, 366, 28);
          const prior = previousSeasons[idx] || previousSeasons.find((season) => String(season?.name || "") === name);
          seasons.push({
            name,
            days,
            weather: normalizeWeatherWeights(prior?.weather)
          });
        });
        if (seasons.length > 0) {
          s.calendar.fantasy.seasons = seasons;
        }
      }

      // Reset cursor if mode changed
      if (prevMode !== s.calendar.mode) {
        s.calendar.cursor = "";
      }

      saveSettings();
      $("#cal-options-drawer").removeClass("is-open");
      renderCalendar();
      if (window.toastr) window.toastr.success("Settings applied successfully.");
    });

    // Open Day Details Modal
    $w.on("click", "#cal-grid .cal-stardew-day", function(e) {
      e.preventDefault();
      const dateKey = $(this).attr("data-date");
      if (!dateKey) return;

      const s = getSettings();
      ensureCalendar(s);

      $("#cal-modal").data("date", dateKey).css("display", "flex");
      $("#cal-modal-title").text(dateKey);

      // Load forecast or override weather to selector
      const override = s.calendar.weatherOverrides[dateKey] || "";
      $("#cal-modal-weather-override").val(override);
      const forecast = getSeededForecast(s, dateKey);
      const weatherIcons = { Clear: "☀️", Rain: "🌧️", Storm: "⛈️", Snow: "❄️", Fog: "🌫️" };
      $("#cal-modal-weather-icon").text(weatherIcons[forecast] || "☀️");

      // Reset add form inputs
      $("#cal-event-type").val("custom");
      $("#cal-custom-event-fields").show();
      $("#cal-birthday-fields").hide();
      $("#cal-new-title").val("");
      $("#cal-new-time").val("");
      $("#cal-new-notes").val("");
      
      // Load social contacts in birthday dropdown
      const contacts = collectSocialContacts(s);
      const dropdown = $("#cal-new-bday-contact");
      dropdown.empty();
      contacts.forEach(c => {
        dropdown.append(`<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.tab)})</option>`);
      });

      renderCalModalList(dateKey);
    });

    // Close Day details modal
    $w.on("click", "#cal-modal-close", function(e) {
      e.preventDefault();
      $("#cal-modal").hide();
    });

    // Weather override dropdown change
    $w.on("change", "#cal-modal-weather-override", function() {
      const dateKey = $("#cal-modal").data("date");
      if (!dateKey) return;
      const s = getSettings(); ensureCalendar(s);
      
      const val = $(this).val();
      if (val) {
        s.calendar.weatherOverrides[dateKey] = normalizeWeatherName(val);
      } else {
        delete s.calendar.weatherOverrides[dateKey];
      }
      saveSettings();
      
      // Update modal icon
      const forecast = getSeededForecast(s, dateKey);
      const weatherIcons = { Clear: "☀️", Rain: "🌧️", Storm: "⛈️", Snow: "❄️", Fog: "🌫️" };
      $("#cal-modal-weather-icon").text(weatherIcons[forecast] || "☀️");

      renderCalendar();
    });

    // Event type dropdown selector toggle
    $w.on("change", "#cal-event-type", function() {
      if ($(this).val() === "birthday") {
        $("#cal-custom-event-fields").hide();
        $("#cal-birthday-fields").show();
      } else {
        $("#cal-custom-event-fields").show();
        $("#cal-birthday-fields").hide();
      }
    });

    // Add Event Submit
    $w.on("click", "#cal-event-add-submit", function(e) {
      e.preventDefault();
      const dateKey = $("#cal-modal").data("date");
      if (!dateKey) return;

      const s = getSettings(); ensureCalendar(s);
      const type = $("#cal-event-type").val();

      if (type === "birthday") {
        const contactId = $("#cal-new-bday-contact").val();
        if (!contactId) return;
        
        // Convert dateKey to birthday key format: seasonIndex-dayOfSeason or month-day
        let bdayKey = dateKey;
        if (s.calendar.mode === "fantasy") {
          const parts = dateKey.split("-");
          bdayKey = `${parts[1]}-${parts[2]}`; // S-D
        } else {
          const parts = dateKey.split("-");
          bdayKey = `${parts[1]}-${parts[2]}`; // MM-DD
        }

        updateSocialContactBirthday(s, contactId, bdayKey);
        saveSettings();
        if (window.toastr) window.toastr.success("Birthday linked successfully!");
      } else {
        const title = $("#cal-new-title").val().trim();
        if (!title) return;
        const time = $("#cal-new-time").val().trim();
        const alert = $("#cal-new-reminder").prop("checked") === true;
        const notes = $("#cal-new-notes").val().trim();

        if (!s.calendar.events[dateKey]) s.calendar.events[dateKey] = [];
        s.calendar.events[dateKey].push({
          title,
          time,
          notes,
          reminder: alert,
          ts: Date.now()
        });
        saveSettings();
        if (window.toastr) window.toastr.success("Event added successfully!");
      }

      $("#cal-new-title").val("");
      $("#cal-new-time").val("");
      $("#cal-new-notes").val("");
      renderCalModalList(dateKey);
      renderCalendar();
    });

    // Delete Event click
    $w.on("click", "#cal-modal-events-list .cal-del", function(e) {
      e.preventDefault();
      const dateKey = $("#cal-modal").data("date");
      const idx = parseInt($(this).attr("data-idx"));
      if (!dateKey || Number.isNaN(idx)) return;

      const s = getSettings(); ensureCalendar(s);
      if (s.calendar.events[dateKey]) {
        s.calendar.events[dateKey].splice(idx, 1);
        if (s.calendar.events[dateKey].length === 0) {
          delete s.calendar.events[dateKey];
        }
        saveSettings();
        renderCalModalList(dateKey);
        renderCalendar();
      }
    });

    // AI themed preset button
    $w.on("click", "#cal-ai-prompt-btn", function(e) {
      e.preventDefault();
      $("#cal-options-drawer").removeClass("is-open");
      $("#cal-ai-prompt-modal").css("display", "flex");
      $("#cal-ai-prompt-desc").val("");
    });

    $w.on("click", "#cal-ai-prompt-close", function(e) {
      e.preventDefault();
      $("#cal-ai-prompt-modal").hide();
    });

    // AI preset generation submit
    $w.on("click", "#cal-ai-prompt-submit", async function(e) {
      e.preventDefault();
      const desc = $("#cal-ai-prompt-desc").val().trim();
      if (desc.length < 10) {
        if (window.toastr) window.toastr.error("Description must be at least 10 characters.");
        return;
      }

      const btn = $(this);
      btn.prop("disabled", true).text("Generating...");

      try {
        const prompt = `
          Return JSON only (no markdown code blocks, raw JSON):
          {
            "weekdays": ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
            "seasons": [
              {
                "name": "Spring",
                "days": 28,
                "weather": {
                  "Clear": 0.6,
                  "Rain": 0.3,
                  "Storm": 0.1,
                  "Snow": 0.0,
                  "Fog": 0.0
                }
              }
            ]
          }
          Analyze this world-setting and output a complete themed fantasy calendar setup. Weekdays can be customized but should map to 4-10 days per cycle. Seasons should count 2-8 seasons, each having 10-60 days. Default weather should suit the season themes.
          World-Setting Description: "${desc}"
        `;

        const res = await generateContent(prompt, "System Check");
        let obj = null;
        try {
          const raw = String(res || "").replace(/```json|```/g, "").trim();
          obj = JSON.parse(raw);
        } catch (_) {}

        if (obj && Array.isArray(obj.seasons) && Array.isArray(obj.weekdays)) {
          const s = getSettings(); ensureCalendar(s);
          s.calendar.mode = "fantasy";
          s.calendar.fantasy = normalizeFantasyCalendar(obj);
          s.calendar.cursor = ""; // Reset cursor
          saveSettings();
          $("#cal-ai-prompt-modal").hide();
          renderCalendar();
          if (window.toastr) window.toastr.success("AI Calendar Template generated and applied!");
        } else {
          throw new Error("Invalid preset configuration format returned by AI.");
        }
      } catch (err) {
        console.error(err);
        if (window.toastr) window.toastr.error("AI Generation failed. Please try again.");
      } finally {
        btn.prop("disabled", false).html('<i class="fa-solid fa-wand-magic-sparkles"></i> Generate Theme Settings');
      }
    });

    // AI Chat and Lore Event scanner
    $w.on("click", "#cal-scan-lore-btn", async function(e) {
      e.preventDefault();
      const s = getSettings(); ensureCalendar(s);
      
      const btn = $(this);
      btn.prop("disabled", true).text("Scanning Lore...");

      try {
        ensureChatStateLoaded();
        const chatSnippet = getChatSnippet();
        
        let loreText = "";
        if (Array.isArray(s.lorebooks)) {
          s.lorebooks.forEach(lb => {
            if (lb.entries && typeof lb.entries === "object") {
              Object.values(lb.entries).forEach(entry => {
                loreText += `Entry [${entry.title || 'Untitled'}]: ${entry.content || ''}\n`;
              });
            }
          });
        }

        const dateKey = getTodayDateKey(s);
        const mode = s.calendar.mode;

        const prompt = `
          Return JSON only (no markdown, raw JSON object):
          {"events":[{"date":"YYYY-MM-DD or Y-S-D","time":"HH:MM or word","title":"Event title","notes":"Notes"}]}
          Scan the following chat transcripts and lorebooks to detect planned meetings, birthdays, holidays, festivals, deadlines, or dates that should be on the calendar.
          Today's Date: ${dateKey}
          Calendar Mode: ${mode}
          
          CHAT SNIPPET:
          ${chatSnippet}
          
          LOREBOOKS:
          ${loreText.slice(0, 3000)}
        `;

        const res = await generateContent(prompt, "System Check");
        let obj = null;
        try {
          const raw = String(res || "").replace(/```json|```/g, "").trim();
          obj = JSON.parse(raw);
        } catch (_) {}

        let count = 0;
        if (obj && Array.isArray(obj.events)) {
          obj.events.forEach(ev => {
            const date = ev.date;
            const title = ev.title;
            if (!date || !title) return;

            if (!s.calendar.events[date]) s.calendar.events[date] = [];
            const exists = s.calendar.events[date].some(x => x.title === title);
            if (!exists) {
              s.calendar.events[date].push({
                title,
                time: ev.time || "",
                notes: ev.notes || "Discovered via AI Lore Scanner.",
                ts: Date.now()
              });
              count++;
            }
          });
        }

        if (count > 0) {
          saveSettings();
          renderCalendar();
          if (window.toastr) window.toastr.success(`Successfully added ${count} new events from lore scan!`);
        } else {
          if (window.toastr) window.toastr.info("Lore scan completed. No new calendar events found.");
        }
      } catch (err) {
        console.error(err);
        if (window.toastr) window.toastr.error("Lore scan failed.");
      } finally {
        btn.prop("disabled", false).html('<i class="fa-solid fa-brain"></i> Scan Lore & Chat for Events');
      }
    });
  });
}

// Open calendar and show window
export async function openCalendar(opts = {}) {
  const ok = await ensureCalendarMounted();
  const $w = $("#uie-calendar-window");
  if (!ok || !$w.length) return false;

  if (opts.hideOtherUieWindows !== false) {
    $(".uie-window").hide();
  }

  initCalendar();
  renderCalendar();
  renderCalendarSchedules();
  setCalendarView(opts.view);

  const scale = (() => {
    try {
      const raw = getComputedStyle(document.documentElement).getPropertyValue("--uie-scale").trim();
      const n = parseFloat(raw);
      return Number.isFinite(n) && n > 0 ? n : 0.8;
    } catch (_) {
      return 0.8;
    }
  })();

  $w.css({
    display: "flex",
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: `translate(-50%, -50%) scale(${scale})`,
    zIndex: 50000
  });

  if (opts.fade === false) {
    $w.css({ opacity: 1 });
  } else {
    $w.css({ opacity: 0 }).animate({ opacity: 1 }, 200);
  }
  return true;
}

// Chat phrase integration for advancing days
export function applyTimeSkipFromChat(userText) {
  const s = getSettings();
  ensureCalendar(s);
  const raw = String(userText || "").trim().toLowerCase();
  if (!raw) return false;

  // Let's check for standard time skips: "skip 3 days", "3 days later", etc.
  const m = raw.match(/(\d+)\s*(day|days|week|weeks|month|months|year|years)\s+later/i) || 
            raw.match(/skip\s*(\d+)\s*(day|days|week|weeks|month|months|year|years)/i);
  
  if (m) {
    const num = parseInt(m[1]) || 1;
    const unit = m[2];
    let daysToSkip = num;
    if (unit.startsWith("week")) daysToSkip = num * 7;
    else if (unit.startsWith("month")) {
      if (s.calendar.mode === "fantasy") {
        const currentSeason = s.calendar.fantasy.seasons[0]; // Average fallback
        daysToSkip = num * (currentSeason?.days || 28);
      } else {
        daysToSkip = num * 30;
      }
    } else if (unit.startsWith("year")) {
      if (s.calendar.mode === "fantasy") {
        const yearLength = s.calendar.fantasy.seasons.reduce((sum, s) => sum + s.days, 0);
        daysToSkip = num * yearLength;
      } else {
        daysToSkip = num * 365;
      }
    }

    advanceRpDays(s, daysToSkip);
    return true;
  }
  return false;
}

// Local calendar rules on user text
export function applyLocalCalendarKeywordRules(userText) {
  // Keeping hook compatible if needed
}

// Trigger calendar alerts
export function runCalendarReminderTick() {
  try {
    if (typeof document === "undefined") return;
  } catch (_) {
    return;
  }
  const s = getSettings();
  ensureCalendar(s);
  
  const todayKey = getTodayDateKey(s);
  if (!s.calendar.events[todayKey]) return;

  const evs = s.calendar.events[todayKey].filter(e => e.reminder !== false);
  if (evs.length === 0) return;

  // Render to toasts or popups once per day session
  let already = false;
  try {
    already = sessionStorage.getItem(`uie_cal_${todayKey}`) === "1";
  } catch (_) {}
  if (already) return;

  try {
    sessionStorage.setItem(`uie_cal_${todayKey}`, "1");
  } catch (_) {}

  const lines = evs.map((e) => {
    const time = String(e?.time || "").trim();
    return `${time ? `${time} - ` : ""}${String(e?.title || "Calendar event").trim() || "Calendar event"}`;
  });

  const overlay = document.getElementById("uie-calendar-reminder-overlay");
  const body = document.getElementById("uie-calendar-reminder-title");
  if (overlay && body && s.calendar.reminderPopup !== false) {
    body.textContent = lines.join("\n");
    body.style.whiteSpace = "pre-wrap";
    overlay.style.display = "flex";
    const dismiss = document.getElementById("uie-calendar-reminder-dismiss");
    if (dismiss && !dismiss.dataset.uieBound) {
      dismiss.dataset.uieBound = "1";
      dismiss.addEventListener("click", () => {
        overlay.style.display = "none";
      });
    }
    return;
  }

  lines.forEach((line) => {
    if (window.toastr) {
      window.toastr.info(line, "Calendar Event");
    } else if (typeof window.showToast === "function") {
      window.showToast(`Calendar Event: ${line}`, 5000);
    }
  });
}

// Advance days and process aging
export function advanceRpDays(s, deltaDays) {
  ensureCalendar(s);

  // If Gregorian mode is enabled, we still want to advance the Gregorian date override s.calendar.rpDate!
  if (s.calendar.mode === "real") {
    if (s.calendar.rpEnabled && s.calendar.rpDate) {
      const parts = s.calendar.rpDate.split("-");
      const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      d.setDate(d.getDate() + deltaDays);
      s.calendar.rpDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }

  // Sync forecast to active weather
  const newKey = getTodayDateKey(s);
  const forecast = getSeededForecast(s, newKey);
  s.worldState = s.worldState || {};
  s.worldState.weather = forecast;
  s.worldState.weatherLabel = forecast;
  s.worldState.weatherVisual = normalizeWeatherName(forecast).toLowerCase();

  // Aging check: we use playerRoom.day as absolute day tracker
  const newDay = Math.max(1, Number(s.playerRoom?.day || 1));
  const oldDay = newDay - deltaDays;
  try {
    processAgingOnDateChange(s, oldDay, newDay);
  } catch (e) {
    console.error("[Aging] error processing age change:", e);
  }

  // Daily Tax, Bills, and Jail check
  import("./taxJailManager.js").then(({ processDailyTaxJailTick }) => {
    processDailyTaxJailTick(s, deltaDays);
  }).catch(e => console.error("[Calendar] Tax/Jail tick failed:", e));

  saveSettings();
  try {
    if (typeof window !== "undefined") window.setTimeout(() => runCalendarReminderTick(), 0);
  } catch (_) {}
}

// Process character aging based on day transitions
export async function processAgingOnDateChange(s, oldDay, newDay) {
  if (!s.character) return;
  ensureCalendar(s);

  const bday = s.character.birthday || (s.calendar.mode === "fantasy" ? "0-25" : "05-25");
  const crossings = getBirthdayCrossings(s, bday, oldDay, newDay);
  if (crossings <= 0) return;

  const oldAge = Number(s.character.age || s.character.currentAge || 18);
  const newAge = oldAge + crossings;
  s.character.age = newAge;
  s.character.currentAge = newAge;
  if (s.character_master) s.character_master.currentAge = newAge;
  saveSettings();

  if (window.toastr) {
    window.toastr.success(`Happy Birthday! You have aged to ${newAge} years old!`, "Birthday Rollover");
  }

  const bracket = getAgeBracket(newAge);
  s.character.expressions = s.character.expressions || {};
  const expr = s.character.expressions[bracket] || "";
  s.character.generatedSprites = s.character.generatedSprites || {};

  if (expr) {
    const cachedUrl = s.character.generatedSprites[bracket];
    if (cachedUrl) {
      s.character.avatar = cachedUrl;
      saveSettings();
    } else {
      try {
        const { generateImageAPI } = await import("./imageGen.js");
        if (window.toastr) window.toastr.info(`Generating a new sprite portrait for your ${bracket} bracket...`);
        
        generateImageAPI(`Anime visual novel character portrait of ${s.character.name}, a ${s.character.class || 'adventurer'}. Bracket: ${bracket}. Description: ${expr}`)
          .then(res => {
            if (res && res.url) {
              s.character.generatedSprites[bracket] = res.url;
              s.character.avatar = res.url;
              saveSettings();
              if (window.toastr) window.toastr.success(`Your sprite portrait has updated to the ${bracket} bracket!`, "Portrait Auto-Updated");
              const avatarDiv = document.getElementById('uie-persona-card-avatar');
              if (avatarDiv) avatarDiv.style.backgroundImage = `url('${res.url}')`;
            }
          })
          .catch(err => console.error("[Aging] Sprite generation failed:", err));
      } catch (e) {
        console.error("[Aging] Failed to load imageGen.js:", e);
      }
    }
  }

  const agingToggled = s.character.aging?.enabled === true;
  if (agingToggled && s.social) {
    const tabs = ["friends", "associates", "romance", "family", "rivals"];
    tabs.forEach(tab => {
      if (Array.isArray(s.social[tab])) {
        s.social[tab].forEach(contact => {
          if (contact.age) {
            const currentContactAge = parseInt(contact.age);
            if (Number.isFinite(currentContactAge) && currentContactAge > 0) {
              contact.age = String(currentContactAge + crossings);
            }
          }
        });
      }
    });
    saveSettings();
  }
}

// Calculate birthday occurrences between oldDay and newDay
function getBirthdayCrossings(s, birthdayStr, oldDay, newDay) {
  ensureCalendar(s);
  if (oldDay >= newDay) return 0;

  if (s.calendar.mode === "fantasy") {
    // Parse birthday string e.g. "0-25" (seasonIndex-dayOfSeason) or "05-25"
    let bSeason = 0;
    let bDay = 25;
    const parts = birthdayStr.split("-");
    if (parts.length >= 2) {
      bSeason = parseInt(parts[0]) || 0;
      bDay = parseInt(parts[1]) || 25;
    }

    const seasons = s.calendar.fantasy.seasons;
    const yearLength = calendarYearLength(s);
    if (yearLength <= 0) return 0;
    bSeason = Math.max(0, Math.min(seasons.length - 1, bSeason));
    bDay = clampInt(bDay, 1, Number(seasons[bSeason]?.days || 28), 25);

    // Birthday offset from start of fantasy year
    let bdayOffsetInYear = 0;
    for (let i = 0; i < Math.min(seasons.length, bSeason); i++) {
      bdayOffsetInYear += seasons[i].days;
    }
    bdayOffsetInYear += bDay;

    let crossings = 0;
    const oldFd = getFantasyDateFromAbsoluteDay(s, oldDay);
    const newFd = getFantasyDateFromAbsoluteDay(s, newDay);

    for (let y = oldFd.year; y <= newFd.year; y++) {
      const bdayAbsDay = (y - 1) * yearLength + bdayOffsetInYear;
      if (bdayAbsDay > oldDay && bdayAbsDay <= newDay) {
        crossings++;
      }
    }
    return crossings;
  } else {
    // Gregorian Mode
    let bMonth = 5;
    let bDay = 25;
    const parts = birthdayStr.split("-");
    if (parts.length >= 2) {
      bMonth = parseInt(parts[parts.length - 2]) || 5;
      bDay = parseInt(parts[parts.length - 1]) || 25;
    }

    const newDate = (() => {
      if (s.calendar.rpEnabled && /^\d{4}-\d{2}-\d{2}$/.test(String(s.calendar.rpDate || ""))) {
        const parts = s.calendar.rpDate.split("-");
        return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      }
      return new Date();
    })();
    const oldDate = new Date(newDate.getTime());
    oldDate.setDate(oldDate.getDate() - (newDay - oldDay));

    let crossings = 0;
    const startYear = oldDate.getFullYear();
    const endYear = newDate.getFullYear();
    
    for (let y = startYear; y <= endYear; y++) {
      const bDate = new Date(y, bMonth - 1, bDay);
      if (bDate.getTime() > oldDate.getTime() && bDate.getTime() <= newDate.getTime()) {
        crossings++;
      }
    }
    return crossings;
  }
}

function getAgeBracket(age) {
  if (age <= 3) return "baby";
  if (age <= 12) return "child";
  if (age <= 17) return "teen";
  if (age <= 29) return "young";
  if (age <= 59) return "adult";
  return "old";
}

// Retrieve chat transcript snippet
function getChatSnippet() {
  try {
    let raw = "";
    const $txt = $(".chat-msg-txt");
    if ($txt.length) {
      $txt.slice(-18).each(function () { raw += $(this).text() + "\n"; });
      return raw.trim().slice(0, 2200);
    }
    const chatEl = document.getElementById("chat");
    if (!chatEl) return "";
    const msgs = Array.from(chatEl.querySelectorAll(".mes")).slice(-18);
    for (const m of msgs) {
      const isUser = m.classList?.contains("is_user") || m.getAttribute?.("is_user") === "true";
      const t = m.querySelector?.(".mes_text")?.textContent || m.textContent || "";
      raw += `${isUser ? "You" : "Story"}: ${String(t).trim()}\n`;
    }
    return raw.trim().slice(0, 2200);
  } catch (_) {
    return "";
  }
}
