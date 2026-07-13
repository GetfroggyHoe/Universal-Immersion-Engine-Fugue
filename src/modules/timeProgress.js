/**
 * Simulated world clock + travel-time costs (adjacent move, room transitions, fast travel by graph distance).
 */
import { getSettings, saveSettings } from "./core.js";
import { rollOffScreenNpcAutopilot } from "./genericNpcs.js";
import { rollAcademyAutopilot } from "./dynamicAcademy.js";
import { defaultTravelSpeedModifier } from "./travelAssets.js";

export function ensureTimeProgress(s) {
  if (!s.ui) s.ui = {};
  if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
  if (!s.worldState.weatherProfiles || typeof s.worldState.weatherProfiles !== "object") s.worldState.weatherProfiles = {};
  const defaultWeatherProfiles = {
    Clear: { timeMultiplier: 1, durabilityDamagePerHour: 0 },
    Rain: { timeMultiplier: 1.2, durabilityDamagePerHour: 0 },
    Storm: { timeMultiplier: 1.5, durabilityDamagePerHour: 4 },
    Blizzard: { timeMultiplier: 1.5, durabilityDamagePerHour: 4 },
    "Space storm": { timeMultiplier: 1.5, durabilityDamagePerHour: 4 },
  };
  for (const [name, profile] of Object.entries(defaultWeatherProfiles)) {
    if (!s.worldState.weatherProfiles[name] || typeof s.worldState.weatherProfiles[name] !== "object") {
      s.worldState.weatherProfiles[name] = { ...profile };
    }
  }
  if (!s.ui.timeProgress || typeof s.ui.timeProgress !== "object") s.ui.timeProgress = {};
  const tp = s.ui.timeProgress;
  if (typeof tp.enabled !== "boolean") tp.enabled = true;
  if (!Number.isFinite(Number(tp.adjacentMoveMinutes))) tp.adjacentMoveMinutes = 3;
  if (!Number.isFinite(Number(tp.roomExitSimSeconds))) tp.roomExitSimSeconds = 20;
  if (!Number.isFinite(Number(tp.fastTravelBaseMinutes))) tp.fastTravelBaseMinutes = 5;
  if (!Number.isFinite(Number(tp.fastTravelPerHopMinutes))) tp.fastTravelPerHopMinutes = 4;
  if (!Number.isFinite(Number(tp.fastTravelMaxMinutes))) tp.fastTravelMaxMinutes = 120;
  if (!Number.isFinite(Number(tp.disconnectedHopsGuess))) tp.disconnectedHopsGuess = 4;
  if (!Number.isFinite(Number(tp.mandatoryAckMinutes))) tp.mandatoryAckMinutes = 3;
  if (!Number.isFinite(Number(tp.mapUnitMinutes))) tp.mapUnitMinutes = 1;
  if (typeof tp.logToChat !== "boolean") tp.logToChat = true;
  if (typeof tp.toastAck !== "boolean") tp.toastAck = true;
  return tp;
}

export function ensurePlayerClock(s) {
  if (!s.playerRoom) s.playerRoom = {};
  if (!Number.isFinite(Number(s.playerRoom.day))) s.playerRoom.day = 1;
  if (!Number.isFinite(Number(s.playerRoom.hour))) s.playerRoom.hour = 8;
  if (!Number.isFinite(Number(s.playerRoom.minute))) s.playerRoom.minute = 0;
}

function isRoomInterior(loc) {
  const l = String(loc || "").toLowerCase();
  return (
    /\b(room|bedroom|bed|closet|bathroom|kitchen|study|office|studio|apartment)\b/i.test(l) ||
    l.includes("player room") ||
    l.includes("starting location")
  );
}

/** Undirected BFS shortest path length in nav graph edges; Infinity if unreachable. */
export function graphDistanceHops(navGraph, from, to) {
  const a = String(from || "").trim();
  const b = String(to || "").trim();
  if (!a || !b || a === b) return 0;
  const nav = navGraph && typeof navGraph === "object" ? navGraph : {};
  const q = [a];
  const seen = new Set([a]);
  let depth = 0;
  while (q.length && depth < 5000) {
    const sz = q.length;
    depth += 1;
    for (let i = 0; i < sz; i++) {
      const cur = q.shift();
      const ex = nav[cur] && typeof nav[cur] === "object" ? nav[cur] : {};
      for (const k of Object.keys(ex)) {
        const nx = String(ex[k] || "").trim();
        if (!nx) continue;
        if (nx === b) return depth;
        if (!seen.has(nx)) {
          seen.add(nx);
          q.push(nx);
        }
      }
    }
  }
  return Infinity;
}

function directNeighbor(navGraph, from, to) {
  const ex = navGraph?.[from] && typeof navGraph[from] === "object" ? navGraph[from] : {};
  return Object.values(ex).some((v) => String(v || "").trim() === String(to || "").trim());
}

/**
 * Returns simulated minutes to add for moving from prev -> next.
 */
export function inferTravelSimMinutes(prev, next, s, options = {}) {
  const tp = ensureTimeProgress(s);
  if (!tp.enabled) return 0;
  const p = String(prev || "").trim();
  const n = String(next || "").trim();
  if (!p || !n || p === n) return 0;
  const explicitDistance = Number(options?.distance);
  if (Number.isFinite(explicitDistance) && explicitDistance > 0) {
    const speedModifier = Math.max(0.05, Number(options?.speedModifier) || 1);
    const weatherMultiplier = Math.max(0.1, Number(options?.weatherMultiplier) || 1);
    return Math.max(1, explicitDistance * Number(tp.mapUnitMinutes || 1) * speedModifier * weatherMultiplier);
  }
  const nav = s.worldState?.navGraph && typeof s.worldState.navGraph === "object" ? s.worldState.navGraph : {};

  if (directNeighbor(nav, p, n)) {
    const exitOrEnter =
      (isRoomInterior(p) && !isRoomInterior(n)) || (!isRoomInterior(p) && isRoomInterior(n));
    if (exitOrEnter) {
      return Math.max(0, Number(tp.roomExitSimSeconds) / 60);
    }
    return Math.max(0, Number(tp.adjacentMoveMinutes));
  }

  const d = graphDistanceHops(nav, p, n);
  if (!Number.isFinite(d) || d <= 0) {
    return Math.min(
      Number(tp.fastTravelMaxMinutes),
      Number(tp.fastTravelBaseMinutes) + Number(tp.fastTravelPerHopMinutes) * Number(tp.disconnectedHopsGuess)
    );
  }
  if (d === 1) return Math.max(0, Number(tp.adjacentMoveMinutes));
  const hops = Math.max(1, d - 1);
  return Math.min(
    Number(tp.fastTravelMaxMinutes),
    Number(tp.fastTravelBaseMinutes) + Number(tp.fastTravelPerHopMinutes) * hops
  );
}

function normalizedKey(value) {
  return String(value || "").trim().toLowerCase();
}

function allTravelAssets(s) {
  const primary = Array.isArray(s?.inventory?.assets) ? s.inventory.assets : [];
  const legacy = Array.isArray(s?.assets) ? s.assets : [];
  return [...primary, ...legacy].filter((asset, index, list) => {
    const name = normalizedKey(asset?.name || asset?.title);
    return name && list.findIndex((candidate) => normalizedKey(candidate?.name || candidate?.title) === name) === index;
  });
}

export function resolveTravelAsset(s, requested = "", options = {}) {
  const assets = allTravelAssets(s);
  const active = options.useActiveVehicle === false ? "" : (s?.worldState?.activeVehicle?.name || s?.worldState?.activeVehicle);
  const wanted = normalizedKey(requested || active);
  if (wanted) {
    const exact = assets.find((asset) => normalizedKey(asset?.name || asset?.title) === wanted);
    if (exact) return exact;
  }
  return null;
}

export function resolveWeatherTravelProfile(s) {
  const weather = s?.worldState?.weather;
  const label = String(
    (weather && typeof weather === "object" ? weather.name || weather.label || weather.type : weather)
    || s?.worldState?.weatherLabel
    || "Clear"
  ).trim() || "Clear";
  const profiles = s?.worldState?.weatherProfiles && typeof s.worldState.weatherProfiles === "object"
    ? s.worldState.weatherProfiles
    : {};
  const configuredKey = Object.keys(profiles).find((key) => normalizedKey(key) === normalizedKey(label));
  const configured = configuredKey ? profiles[configuredKey] : null;
  const inline = weather && typeof weather === "object" ? weather : null;
  const text = `${label} ${s?.worldState?.weatherNotes || ""}`.toLowerCase();
  let timeMultiplier = Number(inline?.timeMultiplier ?? configured?.timeMultiplier);
  let durabilityDamagePerHour = Number(inline?.durabilityDamagePerHour ?? configured?.durabilityDamagePerHour);
  if (!Number.isFinite(timeMultiplier)) {
    if (/\b(storm|blizzard|hurricane|tornado|maelstrom|whiteout|acid rain|solar flare|space storm)\b/.test(text)) timeMultiplier = 1.5;
    else if (/\b(rain|snow|fog|sandstorm|dust storm|rough|high wind)\b/.test(text)) timeMultiplier = 1.2;
    else timeMultiplier = 1;
  }
  if (!Number.isFinite(durabilityDamagePerHour)) {
    durabilityDamagePerHour = /\b(storm|blizzard|hurricane|tornado|maelstrom|acid rain|solar flare|space storm)\b/.test(text) ? 4
      : /\b(sandstorm|dust storm|rough|high wind|hail)\b/.test(text) ? 2
        : 0;
  }
  return {
    label,
    timeMultiplier: Math.max(0.1, timeMultiplier),
    durabilityDamagePerHour: Math.max(0, durabilityDamagePerHour),
  };
}

export function mapDistanceUnits(s, prev, next) {
  const nodes = s?.worldState?.mapNodes && typeof s.worldState.mapNodes === "object" ? s.worldState.mapNodes : {};
  const spatialNodes = [
    ...(Array.isArray(s?.simpleMap?.area) ? s.simpleMap.area : []),
    ...(Array.isArray(s?.simpleMap?.vicinity) ? s.simpleMap.vicinity : []),
  ];
  const findSpatial = (name) => {
    const key = normalizedKey(name);
    const node = spatialNodes.find((candidate) => normalizedKey(candidate?.name) === key);
    return node || nodes?.[name]?.coords || nodes?.[name] || null;
  };
  const a = findSpatial(prev);
  const b = findSpatial(next);
  if (a && b) {
    const distance = Math.hypot(Number(b.x || 0) - Number(a.x || 0), Number(b.y || 0) - Number(a.y || 0));
    if (Number.isFinite(distance) && distance > 0) return distance;
  }
  const hops = graphDistanceHops(s?.worldState?.navGraph, prev, next);
  return Number.isFinite(hops) && hops > 0 ? hops * 8 : 0;
}

function hourToTimeOfDayLabel(hour) {
  const h = Number(hour) || 0;
  if (h < 6) return "Night";
  if (h < 12) return "Morning";
  if (h < 18) return "Afternoon";
  return "Evening";
}

/**
 * Advance RP clock by whole minutes. Updates worldState.time label.
 * @returns {{ minutesAdded: number, day: number, hour: number, minute: number }}
 */
export function advanceWorldTimeMinutes(s, deltaMinutes, ctx = {}) {
  ensurePlayerClock(s);
  const tp = ensureTimeProgress(s);
  const add = Math.max(0, Math.round(Number(deltaMinutes) || 0));
  if (add <= 0 || !tp.enabled) return { minutesAdded: 0, ...snapshotClock(s) };

  let total =
    (Number(s.playerRoom.day || 1) - 1) * 1440 +
    Number(s.playerRoom.hour || 8) * 60 +
    Number(s.playerRoom.minute || 0) +
    add;

  const day = Math.floor(total / 1440) + 1;
  const rem = total % 1440;
  const hour = Math.floor(rem / 60);
  const minute = rem % 60;

  const oldDay = Number(s.playerRoom.day || 1);
  s.playerRoom.day = day;
  s.playerRoom.hour = hour;
  s.playerRoom.minute = minute;
  s.worldState = s.worldState || {};
  s.worldState.time = hourToTimeOfDayLabel(hour);
  try {
    rollOffScreenNpcAutopilot(add);
  } catch (e) {
    console.error("[TimeProgress] rollOffScreenNpcAutopilot error:", e);
  }
  try {
    rollAcademyAutopilot(add);
  } catch (e) {
    console.error("[TimeProgress] rollAcademyAutopilot error:", e);
  }
  saveSettings();
  try {
    window.dispatchEvent(new CustomEvent("uie:time_advanced", {
      detail: { minutes: add, hours: add / 60, day, hour, minute }
    }));
  } catch (_) {}

  if (day > oldDay) {
    const diff = day - oldDay;
    import("./calendar.js").then(({ advanceRpDays }) => {
      advanceRpDays(s, diff);
    }).catch(e => console.error("[TimeProgress] Dynamic calendar advance failed:", e));
  }

  const reason = String(ctx.reason || "").trim();
  if (add >= Number(tp.mandatoryAckMinutes || 0)) {
    let dateStr = `D${day}`;
    if (s.calendar && s.calendar.mode === "fantasy") {
      const seasons = s.calendar.fantasy?.seasons || [];
      const yearLength = seasons.reduce((sum, sx) => sum + (sx.days || 28), 0);
      if (yearLength > 0) {
        const dayZero = Math.max(0, day - 1);
        const year = Math.floor(dayZero / yearLength) + 1;
        let remainingDays = dayZero % yearLength;
        let seasonIndex = 0;
        for (let i = 0; i < seasons.length; i++) {
          if (remainingDays < (seasons[i].days || 28)) { seasonIndex = i; break; }
          remainingDays -= (seasons[i].days || 28);
        }
        const seasonName = seasons[seasonIndex]?.name || `Season ${seasonIndex + 1}`;
        const dayOfSeason = remainingDays + 1;
        dateStr = `${seasonName} ${dayOfSeason}, Yr ${year}`;
      }
    }
    const line = `[Time] +${add} min${reason ? ` (${reason})` : ""} · Now ${dateStr} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} (${s.worldState.time})`;
    if (tp.toastAck && typeof window !== "undefined" && typeof window.showToast === "function") {
      try {
        window.showToast(line.replace("[Time] ", "Time: "), 5200);
      } catch (_) {}
    }
  }

  return { minutesAdded: add, day, hour, minute };
}

function snapshotClock(s) {
  ensurePlayerClock(s);
  return {
    day: Number(s.playerRoom.day || 1),
    hour: Number(s.playerRoom.hour || 8),
    minute: Number(s.playerRoom.minute || 0),
  };
}

/**
 * Apply travel time for a location change. Call with previous and next location names.
 */
export function applyTravelTime(s, prevLoc, nextLoc, reasonLabel = "Travel") {
  return applyTravelEffects(s, prevLoc, nextLoc, { reason: reasonLabel }).minutes;
}

/**
 * Apply map-distance, vehicle-speed, weather-time, and durability effects for one trip.
 */
export function applyTravelEffects(s, prevLoc, nextLoc, options = {}) {
  const p = String(prevLoc || "").trim();
  const n = String(nextLoc || "").trim();
  if (!p || !n || p === n) return { minutes: 0, distance: 0, durabilityDamage: 0, vehicle: null, weather: resolveWeatherTravelProfile(s) };

  const weather = resolveWeatherTravelProfile(s);
  const vehicle = resolveTravelAsset(s, options.vehicle || options.vehicleName || "", { useActiveVehicle: options.useActiveVehicle !== false });
  const speedModifier = Math.max(0.05, Number(
    options.speedModifier
    ?? vehicle?.speedModifier
    ?? vehicle?.travelSpeedModifier
    ?? defaultTravelSpeedModifier(vehicle)
  ) || 1);
  const distance = Math.max(0, Number(options.distance) || mapDistanceUnits(s, p, n));
  const baseMinutes = inferTravelSimMinutes(p, n, s, distance > 0 ? { distance, speedModifier, weatherMultiplier: weather.timeMultiplier } : {});
  const minutes = distance > 0 ? baseMinutes : baseMinutes * speedModifier * weather.timeMultiplier;
  if (minutes > 0) advanceWorldTimeMinutes(s, minutes, { reason: options.reason || "Travel" });

  let durabilityDamage = 0;
  if (vehicle && weather.durabilityDamagePerHour > 0 && minutes > 0) {
    durabilityDamage = Math.max(1, Math.round((minutes / 60) * weather.durabilityDamagePerHour));
    const maxDurability = Math.max(1, Number(vehicle.maxDurability ?? vehicle.durabilityMax ?? 100) || 100);
    const current = Math.max(0, Number(vehicle.durability ?? vehicle.condition ?? maxDurability));
    vehicle.maxDurability = maxDurability;
    vehicle.durability = Math.max(0, current - durabilityDamage);
  }

  s.worldState = s.worldState || {};
  s.worldState.lastTravel = {
    from: p,
    to: n,
    distance,
    minutes: Math.max(0, Math.round(minutes)),
    vehicle: vehicle ? String(vehicle.name || vehicle.title || "Vehicle") : "",
    speedModifier,
    weather: weather.label,
    weatherMultiplier: weather.timeMultiplier,
    durabilityDamage,
    at: Date.now(),
  };
  saveSettings();
  return { minutes: Math.max(0, Math.round(minutes)), distance, durabilityDamage, vehicle, weather, speedModifier };
}

/** RP “minutes from midnight” for calendar / reminders. */
export function getRpMinutesFromMidnight(s) {
  ensurePlayerClock(s);
  return Number(s.playerRoom.hour || 0) * 60 + Number(s.playerRoom.minute || 0);
}
