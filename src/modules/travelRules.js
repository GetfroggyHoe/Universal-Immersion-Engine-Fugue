/**
 * Pure transit rules shared by the map bridge and regression tests.
 * This module deliberately owns no DOM or save lifecycle; callers pass the
 * current settings object and persist after a successful mutation.
 */

export const TRANSIT_MODES = Object.freeze({
  walking: { label: "Walking", icon: "fa-person-walking", access: ["foot", "trail", "road"], baseFare: 0, fareRate: 0, speed: 1.45, public: true },
  bicycle: { label: "Bicycle", icon: "fa-bicycle", access: ["foot", "trail", "road"], baseFare: 0, fareRate: 0, speed: 0.92, assetCategory: "bicycle" },
  motorcycle: { label: "Motorcycle", icon: "fa-motorcycle", access: ["road", "trail"], baseFare: 0, fareRate: 0.035, speed: 0.44, assetCategory: "motorcycle" },
  train: { label: "Train", icon: "fa-train", access: ["rail"], baseFare: 4, fareRate: 0.22, speed: 0.42, public: true },
  subway: { label: "Subway / Metro", icon: "fa-train-subway", access: ["rail"], baseFare: 2, fareRate: 0.12, speed: 0.55, public: true },
  bus: { label: "Bus", icon: "fa-bus", access: ["road"], baseFare: 2, fareRate: 0.16, speed: 0.8, public: true },
  taxi: { label: "Street Taxi", icon: "fa-taxi", access: ["road"], baseFare: 4, fareRate: 0.48, speed: 0.6, public: true },
  rideshare: { label: "Rideshare", icon: "fa-car-side", access: ["road"], baseFare: 5, fareRate: 0.55, speed: 0.58, public: true },
  car: { label: "Private Car", icon: "fa-car", access: ["road"], baseFare: 0, fareRate: 0.04, speed: 0.52, assetCategory: "road_vehicle" },
  horse: { label: "Horse / Mount", icon: "fa-horse", access: ["trail", "road"], baseFare: 0, fareRate: 0, speed: 0.82, assetCategory: "mount" },
  carriage: { label: "Carriage", icon: "fa-carriage-baby", access: ["road", "trail"], baseFare: 1, fareRate: 0.08, speed: 0.74, assetCategory: "cart" },
  ferry: { label: "Ferry", icon: "fa-ferry", access: ["water"], baseFare: 4, fareRate: 0.18, speed: 0.82, public: true },
  boat: { label: "Boat / Ship", icon: "fa-ship", access: ["water"], baseFare: 6, fareRate: 0.24, speed: 0.7, public: true, assetCategory: "boat" },
  airship: { label: "Airship", icon: "fa-cloud", access: ["air"], baseFare: 14, fareRate: 0.58, speed: 0.5, public: true, assetCategory: "aircraft" },
  plane: { label: "Flight", icon: "fa-plane", access: ["air"], baseFare: 18, fareRate: 0.75, speed: 0.3, public: true, assetCategory: "aircraft" },
  spaceship: { label: "Spaceflight", icon: "fa-rocket", access: ["space"], baseFare: 30, fareRate: 1.1, speed: 0.2, public: true, assetCategory: "spacecraft" },
  portal: { label: "Gate", icon: "fa-circle-nodes", access: ["portal"], baseFare: 10, fareRate: 0.1, speed: 0.05, public: true },
});

export function transitId(value, fallback = "transit") {
  const out = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return out || fallback;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function list(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || "").split(/[,;\n]/).map((entry) => entry.trim()).filter(Boolean);
}

export function ensureTravelState(settings = {}) {
  if (!settings.worldState || typeof settings.worldState !== "object") settings.worldState = {};
  const previous = object(settings.worldState.travel);
  const travel = settings.worldState.travel = {
    version: 1,
    currentDockId: String(previous.currentDockId || ""),
    currentDockName: String(previous.currentDockName || ""),
    discoveredDocks: object(previous.discoveredDocks),
    favoriteDocks: Array.isArray(previous.favoriteDocks) ? previous.favoriteDocks.map(String) : [],
    tickets: object(previous.tickets),
    routeDisruptions: object(previous.routeDisruptions),
    history: Array.isArray(previous.history) ? previous.history.slice(-50) : [],
    activeTrip: previous.activeTrip && typeof previous.activeTrip === "object" ? previous.activeTrip : null,
    tripCounter: Math.max(0, Number(previous.tripCounter || 0)),
    lastEvent: previous.lastEvent && typeof previous.lastEvent === "object" ? previous.lastEvent : null,
  };
  return travel;
}

export function accessModesForNode(node = {}) {
  const text = [node.type, node.name, node.theme, node.district, node.docking?.kind, node.docking?.label]
    .filter(Boolean).join(" ").toLowerCase();
  const modes = new Set(list(node.accessModes || node.travelAccess).map((entry) => String(entry).toLowerCase()));
  const interior = Boolean(node.blueprintParent) || /\b(interior|room|bedroom|bathroom|office|apartment|shop|hallway|corridor)\b/.test(text);
  if (!interior) {
    modes.add("foot");
    if (!/\b(underwater|deep forest|cave|mountain peak)\b/.test(text)) modes.add("road");
  }
  if (/\b(trail|path|bridleway|stable)\b/.test(text)) modes.add("trail");
  if (/\b(dock|harbor|harbour|port|pier|marina|berth|wharf|quay|ferry)\b/.test(text)) modes.add("water");
  if (/\b(train|rail|station|subway|metro|platform|depot)\b/.test(text)) modes.add("rail");
  if (/\b(airport|airfield|airstrip|hangar|landing pad|helipad)\b/.test(text)) modes.add("air");
  if (/\b(spaceport|orbital|starship|spacecraft|launch pad)\b/.test(text)) modes.add("space");
  if (/\b(portal|teleport|gateway|warp gate|magic circle)\b/.test(text)) modes.add("portal");
  return Array.from(modes);
}

export function availableModesForNode(node = {}, assets = []) {
  const access = new Set(accessModesForNode(node));
  const categories = new Set((Array.isArray(assets) ? assets : []).map((asset) => String(asset?.travelCategory || "")));
  const modes = [];
  for (const [id, config] of Object.entries(TRANSIT_MODES)) {
    const routeAccess = config.access.some((entry) => access.has(entry));
    const hasAsset = !config.assetCategory || categories.has(config.assetCategory);
    if (routeAccess && (config.public || hasAsset)) modes.push(id);
  }
  if (!modes.length && access.has("road")) modes.push("bus", "rideshare");
  return Array.from(new Set(modes));
}

export function collectTransitNodes(mapState = {}, settings = {}) {
  const candidates = [
    ...(Array.isArray(mapState.world) ? mapState.world : []),
    ...(Array.isArray(mapState.region) ? mapState.region : []),
    ...(Array.isArray(mapState.area) ? mapState.area : []),
    ...(Array.isArray(mapState.vicinity) ? mapState.vicinity : []),
    ...Object.values(object(mapState.vicinityByArea)).flatMap((entry) => Array.isArray(entry) ? entry : []),
    ...Object.values(object(mapState.blueprints)).flatMap((entry) => Array.isArray(entry?.rooms) ? entry.rooms : []),
    ...Object.entries(object(settings?.worldState?.mapNodes)).map(([name, node]) => ({ name, ...object(node) })),
  ];
  const seen = new Set();
  return candidates.filter((node) => {
    const key = transitId(node?.id || node?.name, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return Boolean(node?.name);
  });
}

function graphHops(graph, from, to) {
  if (!from || !to || from === to) return 0;
  const queue = [{ name: from, depth: 0 }];
  const seen = new Set([from]);
  while (queue.length && seen.size < 5000) {
    const current = queue.shift();
    for (const next of Object.values(object(graph?.[current.name]))) {
      const name = String(next || "").trim();
      if (!name || seen.has(name)) continue;
      if (name === to) return current.depth + 1;
      seen.add(name);
      queue.push({ name, depth: current.depth + 1 });
    }
  }
  return Infinity;
}

export function routeDistance(settings = {}, origin = {}, destination = {}) {
  const ax = Number(origin?.coords?.x ?? origin?.x);
  const ay = Number(origin?.coords?.y ?? origin?.y);
  const bx = Number(destination?.coords?.x ?? destination?.x);
  const by = Number(destination?.coords?.y ?? destination?.y);
  if ([ax, ay, bx, by].every(Number.isFinite)) {
    const direct = Math.hypot(bx - ax, by - ay);
    if (direct > 0) return Math.max(1, Math.round(direct));
  }
  const hops = graphHops(settings?.worldState?.navGraph, String(origin?.name || ""), String(destination?.name || ""));
  return Number.isFinite(hops) && hops > 0 ? hops * 8 : 20;
}

function explicitRoutesFor(settings, origin) {
  const all = settings?.worldState?.transitRoutes;
  const fromNode = Array.isArray(origin?.transitRoutes) ? origin.transitRoutes : [];
  if (Array.isArray(all)) {
    const originKeys = new Set([transitId(origin?.id, ""), transitId(origin?.name, "")].filter(Boolean));
    return [...fromNode, ...all.filter((route) => !route?.from || originKeys.has(transitId(route.from, "")) || originKeys.has(transitId(route.fromId, "")))];
  }
  const keyed = object(all);
  const entry = keyed[origin?.id] || keyed[origin?.name];
  return [...fromNode, ...(Array.isArray(entry) ? entry : entry && typeof entry === "object" ? [entry] : [])];
}

function normalizeRoute(raw, mode, origin, destination, settings) {
  const config = TRANSIT_MODES[mode];
  const distance = Math.max(1, Number(raw?.distance) || routeDistance(settings, origin, destination));
  const fare = Math.max(0, Math.round(Number.isFinite(Number(raw?.fare)) ? Number(raw.fare) : config.baseFare + distance * config.fareRate));
  const weatherText = String(settings?.worldState?.weather?.name || settings?.worldState?.weather || "").toLowerCase();
  const weatherMultiplier = /storm|blizzard|hurricane|whiteout|solar flare/.test(weatherText) ? 1.5 : /rain|snow|fog|wind/.test(weatherText) ? 1.2 : 1;
  const duration = Math.max(1, Math.round(Number(raw?.duration) || distance * config.speed * weatherMultiplier));
  const routeId = String(raw?.id || `${transitId(origin?.id || origin?.name)}__${mode}__${transitId(destination?.id || destination?.name)}`);
  return {
    id: routeId,
    mode,
    fromId: String(origin?.id || transitId(origin?.name)),
    from: String(origin?.name || "Departure"),
    toId: String(destination?.id || transitId(destination?.name)),
    to: String(destination?.name || "Destination"),
    distance,
    duration,
    fare,
    range: String(raw?.range || (distance <= 20 ? "local" : distance <= 80 ? "regional" : "world")),
    risk: Math.max(0, Math.min(1, Number(raw?.risk ?? destination?.routeRisk ?? 0.12) + (weatherMultiplier - 1) * 0.35)),
    schedule: ["rideshare", "taxi", "walking", "bicycle", "motorcycle", "car", "horse", "carriage"].includes(mode) ? (Array.isArray(raw?.schedule) ? raw.schedule : []) : Array.isArray(raw?.schedule) ? raw.schedule : Array.isArray(destination?.schedule) ? destination.schedule : [],
    requirements: object(raw?.requirements || destination?.travelRequirements),
    capacity: Math.max(1, Number(raw?.capacity || destination?.capacity || 8)),
    cargoLimit: Math.max(0, Number(raw?.cargoLimit ?? destination?.cargoLimit ?? 0)),
    controllingFaction: String(raw?.controllingFaction || destination?.faction || "Public"),
    discovered: raw?.discovered !== false && destination?.discoveryState !== "planned",
    closed: raw?.closed === true,
    reason: String(raw?.reason || ""),
  };
}

export function buildTransitRoutes({ settings = {}, mapState = {}, origin = {}, mode = "bus" } = {}) {
  if (!TRANSIT_MODES[mode]) return [];
  const nodes = collectTransitNodes(mapState, settings);
  const byKey = new Map(nodes.flatMap((node) => [[transitId(node.id), node], [transitId(node.name), node]]));
  const explicit = explicitRoutesFor(settings, origin).filter((route) => String(route?.mode || mode) === mode);
  const results = [];
  const seen = new Set();
  for (const raw of explicit) {
    const destination = byKey.get(transitId(raw?.toId || raw?.to || raw?.destination)) || (raw?.destinationNode && object(raw.destinationNode));
    if (!destination?.name) continue;
    const route = normalizeRoute(raw, mode, origin, destination, settings);
    if (!seen.has(route.id)) { seen.add(route.id); results.push(route); }
  }
  const requiredAccess = TRANSIT_MODES[mode].access;
  for (const destination of nodes) {
    if (transitId(destination.id || destination.name) === transitId(origin.id || origin.name)) continue;
    const access = accessModesForNode(destination);
    if (!requiredAccess.some((entry) => access.includes(entry))) continue;
    const route = normalizeRoute({}, mode, origin, destination, settings);
    if (!seen.has(route.id)) { seen.add(route.id); results.push(route); }
  }
  return results.sort((a, b) => Number(b.discovered) - Number(a.discovered) || a.distance - b.distance || a.to.localeCompare(b.to)).slice(0, 40);
}

function inventoryCount(settings, wanted) {
  const key = transitId(wanted, "");
  return (settings?.inventory?.items || []).reduce((sum, item) => {
    const itemKey = transitId(item?.id || item?.key || item?.name || item?.title, "");
    return itemKey === key ? sum + Math.max(1, Number(item?.qty || 1)) : sum;
  }, 0);
}

function reputationValue(settings, faction) {
  const wanted = transitId(faction, "");
  const pools = [settings?.reputation, settings?.factions?.reputation, settings?.worldState?.reputation];
  for (const pool of pools) {
    for (const [key, value] of Object.entries(object(pool))) {
      if (transitId(key, "") === wanted) return Number(value?.value ?? value ?? 0);
    }
  }
  return 0;
}

function questComplete(settings, quest) {
  const key = transitId(quest, "");
  const entries = [...(settings?.quests?.completed || []), ...(settings?.journal?.completedQuests || [])];
  return entries.some((entry) => transitId(entry?.id || entry?.name || entry, "") === key);
}

function scheduleOpen(schedule, clock = {}) {
  if (!Array.isArray(schedule) || !schedule.length) return true;
  const now = Number(clock.hour || 0) * 60 + Number(clock.minute || 0);
  return schedule.some((window) => {
    const match = String(window || "").match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
    if (!match) return true;
    const start = Number(match[1]) * 60 + Number(match[2]);
    const end = Number(match[3]) * 60 + Number(match[4]);
    return end >= start ? now >= start && now <= end : now >= start || now <= end;
  });
}

export function evaluateTransitRoute(settings = {}, route = {}) {
  const travel = ensureTravelState(settings);
  const requirements = object(route.requirements);
  const missing = [];
  const disruption = object(travel.routeDisruptions)[route.id];
  if (!route.discovered && travel.discoveredDocks[route.toId] !== true) missing.push("This arrival point has not been discovered.");
  if (route.closed || (disruption && disruption.active !== false)) missing.push(String(route.reason || disruption?.message || "This route is temporarily closed."));
  if (!scheduleOpen(route.schedule, settings.playerRoom)) missing.push("No departure is currently boarding.");
  if (Number(settings.currency || 0) < Number(route.fare || 0)) missing.push(`You cannot cover the ${route.fare}${settings.currencySymbol || "G"} fare.`);
  const items = Array.isArray(requirements.items) ? requirements.items : requirements.item ? [requirements.item] : [];
  for (const item of items) if (inventoryCount(settings, item) < 1) missing.push(`Required access item is missing: ${String(item)}.`);
  if (requirements.ticket && inventoryCount(settings, requirements.ticket) < 1 && Number(travel.tickets[route.id] || 0) < 1) missing.push("A valid ticket or pass is required.");
  if (requirements.faction && reputationValue(settings, requirements.faction) < Number(requirements.reputation || 1)) missing.push(`Permission from ${requirements.faction} is required.`);
  if (requirements.quest && !questComplete(settings, requirements.quest)) missing.push("A prior commitment must be completed before this route opens.");
  const wanted = Number(settings?.worldState?.wantedLevel ?? settings?.wantedLevel ?? 0);
  if (Number.isFinite(Number(requirements.wantedMax)) && wanted > Number(requirements.wantedMax)) missing.push("Checkpoint security will not admit you at your current wanted level.");
  const companions = (settings?.party?.members || []).filter((member) => member && member.active !== false && member.followsUser !== false);
  if (companions.length + 1 > Number(route.capacity || Infinity)) missing.push("The active party exceeds this route's capacity.");
  const blockedCompanion = companions.find((member) => member.canTravel === false || (Array.isArray(member.blockedTravelModes) && member.blockedTravelModes.includes(route.mode)));
  if (blockedCompanion) missing.push(`${blockedCompanion.name || "A companion"} cannot use this route.`);
  return { ok: missing.length === 0, missing };
}

export function debitTransitFare(settings = {}, fare = 0) {
  const amount = Math.max(0, Math.round(Number(fare || 0)));
  if (Number(settings.currency || 0) < amount) return false;
  settings.currency = Number(settings.currency || 0) - amount;
  return true;
}

export function creditTransitFare(settings = {}, fare = 0) {
  settings.currency = Number(settings.currency || 0) + Math.max(0, Math.round(Number(fare || 0)));
  return settings.currency;
}

function seededRoll(text) {
  let h = 2166136261;
  for (const char of String(text || "")) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

export function selectTransitEvent(settings = {}, route = {}) {
  const travel = ensureTravelState(settings);
  const roll = seededRoll(`${route.id}|${travel.tripCounter}|${settings?.playerRoom?.day || 1}`);
  const chance = Math.max(0.08, Math.min(0.45, Number(route.risk || 0.12) + (Number(settings?.worldState?.wantedLevel || 0) * 0.04)));
  if (roll >= chance) return null;
  const eventRoll = seededRoll(`${route.id}|event|${travel.tripCounter}`);
  const events = [
    { id: "delay", title: "Service Delay", text: "Traffic ahead adds a short delay.", minutes: 8, severity: "info" },
    { id: "rumor", title: "Traveler's Rumor", text: "A fellow traveler shares a lead about an overlooked place nearby.", journal: true, severity: "info" },
    { id: "inspection", title: "Checkpoint Inspection", text: "Officials inspect tickets, cargo, and identification.", suspicion: 1, severity: "warning" },
    { id: "weather", title: "Rough Passage", text: "Weather makes the route slower and more tiring.", minutes: 12, energy: -3, severity: "warning" },
    { id: "conversation", title: "Companion Conversation", text: "A companion uses the quiet stretch to open up.", relationship: 1, severity: "success" },
  ];
  return events[Math.min(events.length - 1, Math.floor(eventRoll * events.length))];
}

export function applyTransitNeeds(settings = {}, minutes = 0, event = null) {
  if (!settings.playerProgress || typeof settings.playerProgress !== "object") settings.playerProgress = {};
  if (!settings.playerProgress.needs || typeof settings.playerProgress.needs !== "object") settings.playerProgress.needs = {};
  const needs = settings.playerProgress.needs;
  for (const [key, fallback] of Object.entries({ hunger: 100, thirst: 100, energy: 100 })) {
    if (!Number.isFinite(Number(needs[key]))) needs[key] = fallback;
  }
  const hours = Math.max(0, Number(minutes || 0)) / 60;
  needs.hunger = Math.max(0, Math.min(100, Number(needs.hunger) - Math.max(1, Math.round(hours * 3))));
  needs.thirst = Math.max(0, Math.min(100, Number(needs.thirst) - Math.max(1, Math.round(hours * 4))));
  needs.energy = Math.max(0, Math.min(100, Number(needs.energy) - Math.max(1, Math.round(hours * 2)) + Number(event?.energy || 0)));
  return { ...needs };
}

export function recordTransitArrival(settings = {}, route = {}, event = null) {
  const travel = ensureTravelState(settings);
  travel.tripCounter += 1;
  travel.activeTrip = null;
  travel.currentDockId = String(route.toId || transitId(route.to));
  travel.currentDockName = String(route.to || "");
  travel.discoveredDocks[travel.currentDockId] = true;
  travel.lastEvent = event ? { ...event, at: Date.now(), routeId: route.id } : null;
  travel.history.push({ routeId: route.id, from: route.from, to: route.to, mode: route.mode, fare: route.fare, duration: route.duration, event: event?.id || "", at: Date.now() });
  travel.history = travel.history.slice(-50);
  return travel;
}
