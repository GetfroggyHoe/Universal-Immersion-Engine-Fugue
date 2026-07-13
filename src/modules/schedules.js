import { getSettings, saveSettings } from "./core.js";
import { fetchTemplateHtml } from "./templateFetch.js";
import { publishOrganizationIntel } from "./organizationIntelBus.js";

const SOCIAL_GROUPS = ["friends", "associates", "romance", "family", "rivals"];
let bound = false;

function key(value) {
  return String(value || "").trim().toLowerCase();
}

function gameCharacterKeys(s) {
  const out = new Set();
  (Array.isArray(s.gameCharacters) ? s.gameCharacters : []).forEach((x) => out.add(key(typeof x === "string" ? x : x?.id || x?.name)));
  (Array.isArray(s.sceneCharacters) ? s.sceneCharacters : []).forEach((x) => {
    out.add(key(x?.id));
    out.add(key(x?.cardId));
    out.add(key(x?.name));
  });
  return out;
}

export function getScheduledCharacters(s = getSettings()) {
  const gameKeys = gameCharacterKeys(s);
  const people = [];
  const seen = new Set();
  for (const group of SOCIAL_GROUPS) {
    for (const person of (Array.isArray(s.social?.[group]) ? s.social[group] : [])) {
      const personKeys = [person?.id, person?.cardId, person?.name].map(key).filter(Boolean);
      if (!personKeys.some((x) => gameKeys.has(x))) continue;
      const identity = personKeys[0];
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      people.push(person);
    }
  }
  for (const person of (Array.isArray(s.sceneCharacters) ? s.sceneCharacters : [])) {
    const identity = key(person?.id || person?.cardId || person?.name);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    people.push(person);
  }
  return people;
}

function parseMinutes(value) {
  const raw = String(value || "").trim().toLowerCase();
  const named = { dawn: 360, morning: 480, midday: 720, afternoon: 840, dusk: 1080, evening: 1140, night: 1260, midnight: 0 };
  if (named[raw] !== undefined) return named[raw];
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] || 0);
  if (m[3]) {
    hour %= 12;
    if (m[3].toLowerCase() === "pm") hour += 12;
  }
  return hour * 60 + minute;
}

export function parseSchedule(schedule) {
  if (Array.isArray(schedule)) {
    return schedule.map((x) => ({ rule: String(x?.rule || ""), time: String(x?.time || ""), location: String(x?.location || ""), activity: String(x?.activity || "") }))
      .filter((x) => x.location);
  }
  return String(schedule || "").split(/\r?\n|;|,(?=\s*(?:\d{1,2}|dawn|morning|midday|afternoon|dusk|evening|night|midnight)\b)/i).map((line) => {
    let body = line.trim();
    if (!body) return null;
    let rule = "";
    const ruleMatch = body.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (ruleMatch) {
      rule = ruleMatch[1].trim();
      body = ruleMatch[2].trim();
    }
    const m = body.match(/^([^:]+):\s*(.+)$/);
    if (m) {
      const rest = m[2].split(/\s+(?:at|@)\s+/i);
      return { rule, time: m[1].trim(), activity: rest.length > 1 ? rest[0].trim() : "", location: (rest[1] || rest[0]).trim() };
    }
    const hyphenIdx = body.indexOf("-");
    if (hyphenIdx >= 0) {
      return { rule, time: body.slice(0, hyphenIdx).trim(), activity: "", location: body.slice(hyphenIdx + 1).trim() };
    }
    return { rule, time: "", activity: "", location: body };
  }).filter(Boolean);
}

export function resolveScheduleEntry(person, minutes) {
  const entries = parseSchedule(person?.schedule)
    .map((entry) => ({ ...entry, minutes: parseMinutes(entry.time) }))
    .filter((entry) => Number.isFinite(entry.minutes))
    .sort((a, b) => a.minutes - b.minutes);
  if (!entries.length) return null;
  return [...entries].reverse().find((entry) => entry.minutes <= minutes) || entries[entries.length - 1];
}

function syncCharacterLocation(s, person, location) {
  person.location = location;
  person.currentLocation = location;
  const ids = new Set([person.id, person.cardId, person.name].map(key).filter(Boolean));
  for (const char of (Array.isArray(s.sceneCharacters) ? s.sceneCharacters : [])) {
    if ([char?.id, char?.cardId, char?.name].map(key).some((x) => ids.has(x))) {
      char.location = location;
      char.currentLocation = location;
      char.locationId = location;
      char.presence = key(location) === key(s.worldState?.location) ? "present" : "away";
    }
  }
}

export function updateCharacterSchedules(s = getSettings(), { allowDeviation = true } = {}) {
  const minutes = Number(s.playerRoom?.hour || 8) * 60 + Number(s.playerRoom?.minute || 0);
  for (const person of getScheduledCharacters(s)) {
    if (person.lockedLocation) continue;
    const entry = resolveScheduleEntry(person, minutes);
    if (!entry?.location) continue;
    const driveText = `${person.wants || ""} ${person.needs || ""} ${person.desires || ""}`.trim();
    const deviates = allowDeviation && driveText && Math.random() < 0.12;
    if (!deviates) syncCharacterLocation(s, person, entry.location);
    person.currentActivity = deviates ? `Following a personal need instead of: ${entry.activity || entry.location}` : (entry.activity || "Following schedule");
  }
  _publishOrgIntelFromSchedules(s);
  saveSettings();
  try { window.dispatchEvent(new CustomEvent("uie:schedules_updated")); } catch (_) {}
}

function _publishOrgIntelFromSchedules(s) {
  try {
    for (const person of getScheduledCharacters(s)) {
      if (!person?.name) continue;
      const affiliations = [
        ...(Array.isArray(person.factions) ? person.factions : []),
        ...(Array.isArray(person.affiliations) ? person.affiliations : []),
        ...(Array.isArray(person.organizationAffiliations) ? person.organizationAffiliations : []),
        ...(Array.isArray(person.organizations) ? person.organizations : []),
      ];
      const singleOrg = String(person.organization || person.org || "").trim();
      if (singleOrg) affiliations.push(singleOrg);
      const unique = Array.from(new Set(affiliations.map((a) => String(a || "").trim()).filter((a) => a && a.length >= 3)));
      const loc = String(person.currentLocation || person.location || "").trim();
      const activity = String(person.currentActivity || "").trim();
      for (const affiliation of unique) {
        publishOrganizationIntel({
          source: "schedule",
          sourceId: person.id || person.name,
          confidence: 0.72,
          organizationName: affiliation,
          people: [{
            name: person.name,
            location: loc,
            role: activity
          }],
          proposedPatch: {
            controlledSpaces: loc ? [loc] : [],
            activeHooks: loc ? [`${person.name} is currently at ${loc}.`] : [],
            scheduleHints: activity ? [activity] : []
          },
          reason: "Scheduled affiliated character moved or became active at a location."
        });
      }
    }
  } catch (_) {}
}

export function renderSchedules() {
  const s = getSettings();
  const list = document.getElementById("uie-schedules-list");
  const clock = document.getElementById("uie-schedules-clock");
  if (!list) return;
  if (clock) clock.textContent = `Day ${Number(s.playerRoom?.day || 1)} · ${String(Number(s.playerRoom?.hour || 8)).padStart(2, "0")}:${String(Number(s.playerRoom?.minute || 0)).padStart(2, "0")}`;
  const people = getScheduledCharacters(s);
  list.innerHTML = people.length ? "" : `<div class="uie-schedule-empty">No scheduled game characters are in Social yet.</div>`;
  for (const person of people) {
    const row = document.createElement("article");
    row.className = "uie-schedule-card";
    const entries = parseSchedule(person.schedule);
    row.innerHTML = `<div class="uie-schedule-card__head"><strong></strong><span></span></div><div class="uie-schedule-card__activity"></div><div class="uie-schedule-card__entries"></div>`;
    row.querySelector("strong").textContent = person.name || "Unknown";
    row.querySelector("span").textContent = person.location || person.currentLocation || "Unknown location";
    row.querySelector(".uie-schedule-card__activity").textContent = person.currentActivity || "No current activity";
    row.querySelector(".uie-schedule-card__entries").textContent = entries.length
      ? entries.map((x) => `${x.time}: ${x.activity ? `${x.activity} @ ` : ""}${x.location}`).join("\n")
      : "No schedule saved.";
    list.appendChild(row);
  }
}

async function ensureMounted() {
  if (document.getElementById("uie-schedules-window")) return true;
  for (const url of ["./src/templates/schedules.html", "src/templates/schedules.html", "/src/templates/schedules.html"]) {
    try {
      const html = await fetchTemplateHtml(url);
      if (html) document.body.insertAdjacentHTML("beforeend", html);
      if (document.getElementById("uie-schedules-window")) return true;
    } catch (_) {}
  }
  return false;
}

export async function openSchedules() {
  const calendar = await import("./calendar.js");
  return calendar.openCalendar?.({ hideOtherUieWindows: true, fade: true, view: "schedules" });
}

export function initSchedules() {
  if (bound) return;
  bound = true;
  document.addEventListener("click", (event) => {
    if (event.target.closest("#uie-schedules-close")) document.getElementById("uie-schedules-window")?.style.setProperty("display", "none");
  });
  window.addEventListener("uie:time_advanced", () => updateCharacterSchedules());
  window.addEventListener("uie:schedules_updated", renderSchedules);
}
