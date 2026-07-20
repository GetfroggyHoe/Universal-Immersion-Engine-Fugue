import { getSettings, commitStateUpdate } from "./core.js";
import { notify } from "./notifications.js";
import { injectRpEvent } from "./features/rp_log.js";

let lastLocationFingerprint = "";
let arrivalBusy = false;

const HOME_TABS = ["overview", "homes", "household", "rooms", "visitors", "history"];
const PHYSICAL_ACTIONS = new Set(["kitchen", "storage", "wardrobe", "rest", "property"]);

const esc = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const slug = (value) => String(value || "home")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "")
  .slice(0, 80) || "home";

const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const now = () => Date.now();

function hash(value) {
  let out = 2166136261;
  for (const ch of String(value || "")) out = Math.imul(out ^ ch.charCodeAt(0), 16777619);
  return out >>> 0;
}

function objectValues(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function mapNodes(s) {
  return [
    s.worldState?.mapNodes,
    s.simpleMap?.nodes,
    s.mapData?.nodes,
    s.mapEngine?.nodes,
  ].flatMap(objectValues).filter(Boolean);
}

function findNode(s, idOrName) {
  return mapNodes(s).find((node) =>
    same(node?.id, idOrName) ||
    same(node?.name, idOrName) ||
    same(node?.label, idOrName)
  ) || null;
}

function currentContext(s = getSettings()) {
  const raw = s.worldState?.currentLocation ?? s.worldState?.location ?? s.map?.location ?? "";
  const name = String(typeof raw === "object" ? raw.name || raw.label || raw.id : raw).trim();
  const node = findNode(s, name) || (typeof raw === "object" ? raw : {});
  return contextFromNode(node, name, s);
}

function contextFromNode(node = {}, fallbackName = "", s = getSettings()) {
  const name = String(node?.name || node?.label || fallbackName || node?.id || "").trim();
  return {
    name,
    key: slug(node?.id || name),
    node,
    nodeId: String(node?.id || "").trim(),
    description: String(node?.description || node?.desc || s.worldState?.description || "").trim(),
    type: String(node?.type || node?.category || node?.theme || "Residence").trim(),
    view: String(node?.view || "").trim(),
    worldId: String(node?.worldId || s.worldState?.worldId || "").trim(),
    regionId: String(node?.regionId || node?.provinceId || "").trim(),
    localId: String(node?.localId || node?.areaId || "").trim(),
    tags: Array.isArray(node?.tags) ? node.tags.map(String) : String(node?.tags || "").split(/[,|]/).map((part) => part.trim()).filter(Boolean),
  };
}

function inferTenure(context) {
  const node = context.node || {};
  const text = `${context.name} ${context.type} ${context.tags.join(" ")} ${node.owner || node.ownedBy || ""}`.toLowerCase();
  if (/camp|tent|shelter|campsite|temporary/.test(text)) return "temporary";
  if (/rent|apartment|flat|lease|tenant/.test(text)) return "rented";
  if (/family|parent|grandparent|guardian/.test(text)) return "family";
  if (/ship|vehicle|caravan|mobile/.test(text)) return "mobile";
  const owner = String(node.owner || node.ownedBy || node.ownerName || "").toLowerCase();
  if (owner && owner !== "player") return "hosted";
  return "owned";
}

function defaultRoomsFor(context) {
  const text = `${context.name} ${context.type} ${context.tags.join(" ")}`.toLowerCase();
  const rooms = [
    { id: "living_area", name: "Living Area", type: "living", createdAt: now() },
    { id: "sleeping_area", name: /camp|tent|cave/.test(text) ? "Sleeping Area" : "Bedroom", type: "bedroom", createdAt: now() },
    { id: "storage", name: "Storage", type: "storage", createdAt: now() },
  ];
  if (!/camp|tent|cave|vehicle/.test(text)) rooms.splice(2, 0, { id: "kitchen", name: "Kitchen", type: "kitchen", createdAt: now() });
  return rooms;
}

function normalizeHome(home, key = "") {
  if (!home || typeof home !== "object") home = {};
  home.id = String(home.id || key || `home_${slug(home.name)}`).trim();
  home.name = String(home.name || "Unnamed Home").trim();
  home.description = String(home.description || "A place connected to the player's life and travels.").trim();
  home.kind = String(home.kind || home.type || "Residence").trim();
  home.tenure = String(home.tenure || home.ownership || "owned").trim();
  home.createdAt = Number(home.createdAt || now());
  home.visits = Number(home.visits || 0);
  home.locationRef = home.locationRef && typeof home.locationRef === "object" ? home.locationRef : {};
  home.rooms = Array.isArray(home.rooms) && home.rooms.length ? home.rooms : defaultRoomsFor({ name: home.name, type: home.kind, tags: [], node: {} });
  home.household = home.household && typeof home.household === "object" && !Array.isArray(home.household) ? home.household : {};
  home.events = Array.isArray(home.events) ? home.events : [];
  home.upgrades = home.upgrades && typeof home.upgrades === "object" ? home.upgrades : {};
  home.bills = Array.isArray(home.bills) ? home.bills : [];
  return home;
}

function ensureState(s) {
  if (!s.playerHome || typeof s.playerHome !== "object") s.playerHome = {};
  const state = s.playerHome;
  if (!state.homes || typeof state.homes !== "object" || Array.isArray(state.homes)) state.homes = {};
  if (!Array.isArray(state.events)) state.events = [];
  if (!state.doorbell || typeof state.doorbell !== "object") state.doorbell = {};
  if (!HOME_TABS.includes(state.selectedTab)) state.selectedTab = "overview";

  const normalizedHomes = {};
  for (const [key, raw] of Object.entries(state.homes)) {
    const home = normalizeHome(raw, key);
    let normalizedKey = home.id || key;
    let suffix = 2;
    while (normalizedHomes[normalizedKey] && normalizedHomes[normalizedKey] !== home) normalizedKey = `${home.id}_${suffix++}`;
    if (normalizedKey !== home.id) home.id = normalizedKey;
    normalizedHomes[normalizedKey] = home;
  }
  state.homes = normalizedHomes;
  migrateLegacyPrimaryHome(s);

  const homes = allHomes(s);
  if (!state.activeHomeId && state.activeKey) {
    const legacyActive = homes.find((home) => same(home.id, state.activeKey) || same(home.name, state.activeKey));
    if (legacyActive) state.activeHomeId = legacyActive.id;
  }
  if (!state.primaryHomeId && homes.length) state.primaryHomeId = homes.find((home) => home.primary)?.id || homes[0].id;
  if (!state.activeHomeId && state.primaryHomeId) state.activeHomeId = state.primaryHomeId;
  if (state.activeHomeId && !getHomeById(s, state.activeHomeId)) state.activeHomeId = state.primaryHomeId || homes[0]?.id || "";

  syncPrimaryFlags(s);
  return state;
}

function allHomes(s = getSettings()) {
  const values = Object.values(s.playerHome?.homes || {}).filter(Boolean);
  return values.sort((a, b) => {
    if (a.id === s.playerHome?.primaryHomeId) return -1;
    if (b.id === s.playerHome?.primaryHomeId) return 1;
    return String(a.name).localeCompare(String(b.name));
  });
}

function getHomeById(s, id) {
  if (!id) return null;
  return Object.values(s.playerHome?.homes || {}).find((home) => same(home?.id, id)) || null;
}

function findHomeForContext(s, context) {
  if (!context?.name) return null;
  return allHomes(s).find((home) => {
    const ref = home.locationRef || {};
    return (
      (context.nodeId && same(ref.nodeId, context.nodeId)) ||
      same(ref.name, context.name) ||
      same(home.name, context.name) ||
      same(home.id, context.nodeId)
    );
  }) || null;
}

function legacyHomeContext(s) {
  const legacy = s.primaryHome;
  if (!legacy || (!legacy.name && !legacy.id)) return null;
  const node = findNode(s, legacy.id || legacy.name) || {};
  return contextFromNode({ ...node, ...legacy, id: legacy.id || node.id, name: legacy.name || node.name }, legacy.name || node.name, s);
}

function migrateLegacyPrimaryHome(s) {
  const legacy = s.primaryHome;
  if (!legacy || (!legacy.name && !legacy.id)) return;
  const existing = Object.values(s.playerHome.homes).find((home) =>
    same(home.id, legacy.id) || same(home.name, legacy.name)
  );
  if (existing) {
    existing.upgrades = { ...(legacy.upgrades || {}), ...(existing.upgrades || {}) };
    existing.bills = Array.isArray(existing.bills) && existing.bills.length ? existing.bills : (legacy.bills || []);
    if (!s.playerHome.primaryHomeId) s.playerHome.primaryHomeId = existing.id;
    return;
  }
  const context = legacyHomeContext(s);
  if (!context?.name) return;
  const home = createHomeRecord(context, {
    id: legacy.id || `home_${slug(context.name)}`,
    tenure: legacy.tenure || legacy.ownership || "owned",
    description: legacy.description,
    upgrades: legacy.upgrades,
    bills: legacy.bills,
    establishedDay: legacy.establishedDay,
    source: "legacy_primary_home",
  });
  s.playerHome.homes[home.id] = home;
  s.playerHome.primaryHomeId = home.id;
  s.playerHome.activeHomeId ||= home.id;
}

function createHomeRecord(context, extras = {}) {
  const idBase = String(extras.id || context.nodeId || `home_${slug(context.name)}`).trim();
  const id = idBase.startsWith("home_") ? idBase : `home_${slug(idBase)}`;
  const home = normalizeHome({
    id,
    name: context.name || "Unnamed Home",
    description: extras.description || context.description || "A residence connected to the map.",
    kind: extras.kind || context.type || "Residence",
    tenure: extras.tenure || inferTenure(context),
    source: extras.source || "map_claim",
    createdAt: now(),
    establishedDay: Number(extras.establishedDay || getSettings()?.playerRoom?.day || 1),
    locationRef: {
      nodeId: context.nodeId || context.node?.id || "",
      name: context.name,
      view: context.view,
      type: context.type,
      worldId: context.worldId,
      regionId: context.regionId,
      localId: context.localId,
    },
    rooms: defaultRoomsFor(context),
    household: {},
    events: [],
    upgrades: { ...(extras.upgrades || {}) },
    bills: Array.isArray(extras.bills) ? extras.bills : [],
  }, id);
  return home;
}

function syncPrimaryFlags(s) {
  const state = s.playerHome;
  const primary = getHomeById(s, state.primaryHomeId) || allHomes(s)[0] || null;
  if (primary && state.primaryHomeId !== primary.id) state.primaryHomeId = primary.id;
  for (const home of allHomes(s)) home.primary = Boolean(primary && same(home.id, primary.id));

  if (!primary) {
    s.primaryHome = null;
    return;
  }

  const previous = s.primaryHome && typeof s.primaryHome === "object" ? s.primaryHome : {};
  s.primaryHome = {
    ...previous,
    id: primary.locationRef?.nodeId || primary.id,
    homeId: primary.id,
    name: primary.name,
    description: primary.description,
    type: primary.kind,
    tenure: primary.tenure,
    establishedDay: primary.establishedDay || previous.establishedDay || Number(s.playerRoom?.day || 1),
    upgrades: primary.upgrades,
    bills: primary.bills,
  };
}

function commit(s, { emit = true } = {}) {
  syncPrimaryFlags(s);
  commitStateUpdate({ save: true, layout: false, emit });
}

function recordEvent(s, home, text, type = "home") {
  const event = {
    id: `home_event_${now()}_${Math.random().toString(36).slice(2, 7)}`,
    homeId: home?.id || "",
    homeName: home?.name || "",
    text: String(text || ""),
    type,
    at: now(),
    day: Number(s.playerRoom?.day || 1),
  };
  s.playerHome.events.unshift(event);
  s.playerHome.events = s.playerHome.events.slice(0, 100);
  if (home) {
    home.events.unshift(event);
    home.events = home.events.slice(0, 50);
  }
  return event;
}

function markNodeAsHome(node, home) {
  if (!node || typeof node !== "object") return;
  node.playerHome = true;
  node.homeId = home.id;
  node.isHome = true;
}

export function getHomeForMapNode(node) {
  const s = getSettings();
  ensureState(s);
  const context = contextFromNode(node || {}, node?.name || node?.id || "", s);
  return findHomeForContext(s, context);
}

export function claimMapLocationAsHome(node, options = {}) {
  const s = getSettings();
  ensureState(s);
  const context = contextFromNode(node || {}, node?.name || node?.id || "", s);
  if (!context.name) {
    notify("warning", "Select a real map location first.", "Player Home");
    return null;
  }

  let home = findHomeForContext(s, context);
  const isNew = !home;
  if (!home) {
    home = createHomeRecord(context, {
      tenure: options.tenure,
      source: options.source || "map_claim",
    });
    let id = home.id;
    let n = 2;
    while (s.playerHome.homes[id]) id = `${home.id}_${n++}`;
    home.id = id;
    s.playerHome.homes[id] = home;
  } else {
    home.name = context.name || home.name;
    home.description = context.description || home.description;
    home.kind = context.type || home.kind;
    home.locationRef = { ...home.locationRef, nodeId: context.nodeId, name: context.name, view: context.view, type: context.type, worldId: context.worldId, regionId: context.regionId, localId: context.localId };
  }

  markNodeAsHome(context.node, home);
  const shouldMakePrimary = options.makePrimary === true || !s.playerHome.primaryHomeId;
  if (shouldMakePrimary) s.playerHome.primaryHomeId = home.id;
  s.playerHome.activeHomeId = home.id;
  recordEvent(s, home, isNew ? `${home.name} was added to Player Homes.` : `${home.name} was selected in Player Homes.`, isNew ? "claim" : "home");
  commit(s);
  updateHomeMenuState(s);
  renderHome();
  notify("success", isNew ? `${home.name} is now one of your homes.` : `${home.name} selected.`, "Player Home");
  window.dispatchEvent(new CustomEvent("uie:home_registry_updated", { detail: { homeId: home.id, created: isNew } }));
  return home;
}

export function setPrimaryHome(homeId) {
  const s = getSettings();
  ensureState(s);
  const home = getHomeById(s, homeId);
  if (!home) return false;
  s.playerHome.primaryHomeId = home.id;
  s.playerHome.activeHomeId = home.id;
  recordEvent(s, home, `${home.name} was set as the primary home.`, "primary");
  commit(s);
  renderHome();
  updateHomeMenuState(s);
  notify("success", `${home.name} is now the primary home.`, "Player Home");
  return true;
}

export function removePlayerHome(homeId) {
  const s = getSettings();
  ensureState(s);
  const home = getHomeById(s, homeId);
  if (!home) return false;
  const name = home.name;
  const node = findNode(s, home.locationRef?.nodeId || home.name);
  if (node) {
    if (same(node.homeId, home.id)) delete node.homeId;
    if (node.playerHome === true) delete node.playerHome;
    if (node.isHome === true) delete node.isHome;
  }
  delete s.playerHome.homes[home.id];
  if (same(s.playerHome.primaryHomeId, home.id)) s.playerHome.primaryHomeId = allHomes(s)[0]?.id || "";
  if (same(s.playerHome.activeHomeId, home.id)) s.playerHome.activeHomeId = s.playerHome.primaryHomeId || allHomes(s)[0]?.id || "";
  recordEvent(s, null, `${name} was removed from Player Homes.`, "remove");
  commit(s);
  renderHome();
  updateHomeMenuState(s);
  notify("info", `${name} removed from Player Homes.`, "Player Home");
  return true;
}

export function isPlayerHomeLocation(context = currentContext(), s = getSettings()) {
  ensureState(s);
  if (!context?.name) return false;
  if (findHomeForContext(s, context)) return true;
  if (same(s.primaryHome?.name, context.name) || same(s.primaryHome?.id, context.nodeId)) return true;
  const node = context.node || {};
  if (node.playerHome === true || node.isHome === true || node.ownedByPlayer === true) return true;
  const owner = String(node.owner || node.ownedBy || node.ownerName || "").toLowerCase();
  const playerName = String(s.character?.name || s.name || "").toLowerCase();
  if (owner === "player" || (playerName && owner === playerName)) return true;
  return false;
}

function ensureCurrentHomeRecord(s, context) {
  let home = findHomeForContext(s, context);
  if (!home && isPlayerHomeLocation(context, s)) {
    home = createHomeRecord(context, { source: "legacy_discovery" });
    s.playerHome.homes[home.id] = home;
    s.playerHome.primaryHomeId ||= home.id;
  }
  return home;
}

function npcSources(s) {
  return [
    ["npcs", s.npcs],
    ["npcManagement", s.npcManagement?.npcs],
    ["socialPeople", s.social?.people],
    ["socialRelationships", s.social?.relationships],
    ["socialFamily", s.social?.family],
    ["socialRomance", s.social?.romance],
    ["socialFriends", s.social?.friends],
    ["characterCards", s.character_cards],
  ];
}

function npcId(npc) {
  return String(npc?.id || npc?.npcId || npc?.cardId || npc?.characterId || npc?.name || npc?.displayName || "").trim();
}

function allNpcRecords(s) {
  const byId = new Map();
  for (const [source, pool] of npcSources(s)) {
    for (const npc of objectValues(pool)) {
      if (!npc || npc.isPlayer) continue;
      const name = String(npc.name || npc.displayName || "").trim();
      if (!name || same(name, s.character?.name || s.name)) continue;
      const id = npcId(npc) || slug(name);
      const key = id.toLowerCase();
      if (!byId.has(key)) byId.set(key, { id, name, npc, refs: [npc], source });
      else {
        const entry = byId.get(key);
        if (!entry.refs.includes(npc)) entry.refs.push(npc);
        entry.name ||= name;
      }
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function relationFromLineage(s, id) {
  const tree = s.lineageTree || s.social?.lineageTree || {};
  const node = tree[id] || tree[String(id).toLowerCase()] || null;
  const player = tree.player || tree[s.character?.id] || null;
  if (node) {
    if (same(node.parentId, "player") || same(node.parentId, s.character?.id)) return "Child";
    if (Array.isArray(node.childIds) && node.childIds.some((childId) => same(childId, "player") || same(childId, s.character?.id))) return "Parent";
    if (same(node.spouseId, "player") || same(node.spouseId, s.character?.id)) return "Partner";
  }
  if (player) {
    if (Array.isArray(player.childIds) && player.childIds.some((childId) => same(childId, id))) return "Child";
    if (same(player.parentId, id)) return "Parent";
    if (same(player.spouseId, id)) return "Partner";
  }
  return "";
}

function ageStage(npc) {
  const explicit = String(npc?.ageStage || npc?.lifeStage || npc?.ageBracket || "").toLowerCase();
  if (explicit) {
    if (explicit === "baby" || explicit === "newborn") return "infant";
    if (explicit === "kid") return "child";
    if (explicit === "adolescent" || explicit === "youth") return "teen";
    return explicit;
  }
  const age = Number.parseFloat(npc?.age ?? npc?.currentAge);
  if (!Number.isFinite(age)) return "adult";
  if (age <= 1) return "infant";
  if (age <= 3) return "toddler";
  if (age <= 12) return "child";
  if (age <= 17) return "teen";
  return "adult";
}

function inferHouseholdRole(s, entry) {
  const npc = entry.npc || {};
  const lineage = relationFromLineage(s, entry.id);
  if (lineage) return lineage;
  const roleText = `${npc.familyRole || ""} ${npc.relationshipStatus || ""} ${npc.role || ""} ${npc.title || ""}`.toLowerCase();
  if (/daughter|son|child|baby|infant|toddler/.test(roleText)) return ageStage(npc) === "infant" ? "Infant" : "Child";
  if (/mother|father|parent/.test(roleText)) return "Parent";
  if (/grandmother|grandfather|grandparent/.test(roleText)) return "Grandparent";
  if (/guardian/.test(roleText)) return "Guardian";
  if (/wife|husband|spouse|partner|girlfriend|boyfriend/.test(roleText)) return "Partner";
  if (/sister|brother|sibling/.test(roleText)) return "Sibling";
  if (/cousin|aunt|uncle|family|relative/.test(roleText)) return "Relative";
  if (/roommate/.test(roleText)) return "Roommate";
  if (/tenant/.test(roleText)) return "Tenant";
  if (/staff|maid|butler|guard|nanny|caregiver/.test(roleText)) return "Staff";
  return ageStage(npc) === "infant" ? "Infant" : ageStage(npc) === "child" ? "Child" : "Resident";
}

function memberPresent(home, entry) {
  const npc = entry?.npc || {};
  return same(npc.currentLocation || npc.location || npc.lastKnownLocation, home.name);
}

function householdEntries(s, home) {
  const records = allNpcRecords(s);
  const byId = new Map(records.map((entry) => [entry.id.toLowerCase(), entry]));
  const output = [];
  for (const assignment of Object.values(home.household || {})) {
    const id = String(assignment.npcId || assignment.id || "");
    const entry = byId.get(id.toLowerCase()) || { id, name: assignment.name || "Unknown Resident", npc: {}, refs: [] };
    output.push({
      ...entry,
      assignment,
      role: assignment.role || inferHouseholdRole(s, entry),
      stage: ageStage(entry.npc),
      present: memberPresent(home, entry),
    });
  }
  return output.sort((a, b) => {
    const childRank = ["infant", "toddler", "child", "teen"].includes(a.stage) ? -1 : 0;
    const otherRank = ["infant", "toddler", "child", "teen"].includes(b.stage) ? -1 : 0;
    return childRank - otherRank || a.name.localeCompare(b.name);
  });
}

function syncNpcResidence(entry, home, assignment) {
  for (const ref of entry.refs || [entry.npc]) {
    if (!ref || typeof ref !== "object") continue;
    ref.residence = {
      ...(ref.residence && typeof ref.residence === "object" ? ref.residence : {}),
      homeId: home.id,
      homeName: home.name,
      role: assignment.role,
      roomId: assignment.roomId || "",
      primaryResidence: assignment.primaryResidence !== false,
    };
    ref.homeId = home.id;
    ref.homeName = home.name;
  }
}

function clearNpcResidence(entry, homeId) {
  for (const ref of entry.refs || [entry.npc]) {
    if (!ref || typeof ref !== "object") continue;
    if (same(ref.residence?.homeId, homeId)) delete ref.residence;
    if (same(ref.homeId, homeId)) delete ref.homeId;
    if (same(ref.homeName, getHomeById(getSettings(), homeId)?.name)) delete ref.homeName;
  }
}

function assignHouseholdMember(homeId, id, role = "", roomId = "") {
  const s = getSettings();
  ensureState(s);
  const home = getHomeById(s, homeId);
  const entry = allNpcRecords(s).find((candidate) => same(candidate.id, id));
  if (!home || !entry) return false;
  const assignment = {
    npcId: entry.id,
    name: entry.name,
    role: role || inferHouseholdRole(s, entry),
    roomId: roomId || "",
    primaryResidence: true,
    addedAt: now(),
  };
  home.household[entry.id] = assignment;
  syncNpcResidence(entry, home, assignment);
  recordEvent(s, home, `${entry.name} joined the household as ${assignment.role}.`, "household");
  commit(s);
  renderHome();
  return true;
}

function removeHouseholdMember(homeId, id) {
  const s = getSettings();
  ensureState(s);
  const home = getHomeById(s, homeId);
  if (!home || !home.household[id]) return false;
  const entry = allNpcRecords(s).find((candidate) => same(candidate.id, id)) || { id, name: home.household[id].name, refs: [] };
  delete home.household[id];
  clearNpcResidence(entry, home.id);
  recordEvent(s, home, `${entry.name || "A resident"} left the household.`, "household");
  commit(s);
  renderHome();
  return true;
}

function updateHouseholdAssignment(homeId, id, patch) {
  const s = getSettings();
  ensureState(s);
  const home = getHomeById(s, homeId);
  const assignment = home?.household?.[id];
  if (!home || !assignment) return false;
  Object.assign(assignment, patch || {});
  const entry = allNpcRecords(s).find((candidate) => same(candidate.id, id));
  if (entry) syncNpcResidence(entry, home, assignment);
  commit(s);
  renderHome();
  return true;
}

function selectedHome(s = getSettings()) {
  ensureState(s);
  return getHomeById(s, s.playerHome.activeHomeId) || getHomeById(s, s.playerHome.primaryHomeId) || allHomes(s)[0] || null;
}

function currentHome(s = getSettings()) {
  ensureState(s);
  return findHomeForContext(s, currentContext(s));
}

function isAtHome(home, s = getSettings()) {
  if (!home) return false;
  return same(currentHome(s)?.id, home.id);
}

function setHomeWindowOpen(open) {
  const $win = $("#uie-player-home-window");
  if (!$win.length) return false;
  $win.css("display", open ? "flex" : "none");
  $win.attr("aria-hidden", open ? "false" : "true");
  $win.prop("hidden", !open);
  try { window.UIE_updateModalScales?.(); } catch (_) {}
  return true;
}

function pendingVisitorForHome(s, home) {
  const pending = s.playerHome?.doorbell?.pending;
  if (!pending || !home) return null;
  if (!pending.homeId || same(pending.homeId, home.id) || same(pending.home, home.name)) return pending;
  return null;
}

function updateHomeMenuState(s = getSettings(), context = currentContext(s)) {
  ensureState(s);
  const atHome = Boolean(findHomeForContext(s, context));
  const pending = Boolean(s.playerHome?.doorbell?.pending);
  const hasHomes = allHomes(s).length > 0;
  const state = pending ? "visitor" : atHome ? "home" : hasHomes ? "away" : "none";
  const button = document.getElementById("uie-btn-player-home");
  if (button) {
    button.dataset.homeState = state;
    button.setAttribute("aria-label", pending ? "Player Home — visitor waiting" : atHome ? "Player Home — currently home" : hasHomes ? "Player Home — manage residences" : "Player Home — no residences yet");
    button.title = pending ? "Player Home — visitor waiting" : atHome ? "Player Home" : hasHomes ? "Manage Player Homes" : "Choose a location from the map to create a home";
  }
  return { atHome, pending, hasHomes, state };
}

export function closePlayerHome() {
  return setHomeWindowOpen(false);
}

export function openPlayerHome(options = {}) {
  const s = getSettings();
  ensureState(s);
  const here = currentHome(s);
  if (options.homeId && getHomeById(s, options.homeId)) s.playerHome.activeHomeId = options.homeId;
  else if (here) s.playerHome.activeHomeId = here.id;
  else if (!selectedHome(s) && allHomes(s)[0]) s.playerHome.activeHomeId = allHomes(s)[0].id;
  if (options.tab && HOME_TABS.includes(options.tab)) s.playerHome.selectedTab = options.tab;
  $(".uie-window").not("#uie-player-home-window").hide();
  setHomeWindowOpen(true);
  renderHome();
  return true;
}

function chooseVisitor(s, home, forcedId = "") {
  const residents = new Set(Object.keys(home?.household || {}).map((id) => id.toLowerCase()));
  const candidates = allNpcRecords(s).filter((entry) => {
    if (residents.has(entry.id.toLowerCase())) return false;
    if (memberPresent(home, entry)) return false;
    return entry.npc?.dead !== true && entry.npc?.active !== false;
  });
  if (!candidates.length) return null;
  if (forcedId) return candidates.find((entry) => same(entry.id, forcedId) || same(entry.name, forcedId)) || null;
  const day = Number(s.playerRoom?.day || 1);
  const hour = Number(s.playerRoom?.hour ?? s.time?.hour ?? 12);
  return candidates[hash(`${home.name}:${day}:${Math.floor(hour / 3)}`) % candidates.length];
}

export function ringDoorbell(visitorId = "", options = {}) {
  const s = getSettings();
  ensureState(s);
  const home = options.homeId ? getHomeById(s, options.homeId) : currentHome(s) || selectedHome(s);
  if (!home) return false;
  const bell = s.playerHome.doorbell;
  if (bell.pending && options.replace !== true) return false;
  const visitorEntry = chooseVisitor(s, home, visitorId);
  if (!visitorEntry) return false;
  const purposes = ["stopped by to check in", "came to talk in person", "is making a friendly visit", "has something to discuss", "was nearby and decided to visit"];
  bell.pending = {
    id: visitorEntry.id,
    name: visitorEntry.name,
    avatar: visitorEntry.npc?.avatar || visitorEntry.npc?.img || visitorEntry.npc?.image || "",
    purpose: purposes[hash(`${visitorEntry.name}:${home.name}`) % purposes.length],
    answered: false,
    arrivedAt: now(),
    homeId: home.id,
    home: home.name,
  };
  bell.lastRingAt = now();
  recordEvent(s, home, `${visitorEntry.name} rang the doorbell.`, "doorbell");
  commit(s, { emit: false });
  renderHome();
  updateHomeMenuState(s);
  notify("info", `${visitorEntry.name} is at the door of ${home.name}.`, "Doorbell");
  try { injectRpEvent(`[Doorbell: ${visitorEntry.name} is at the door of ${home.name} and ${bell.pending.purpose}.]`); } catch (_) {}
  window.dispatchEvent(new CustomEvent("uie:doorbell_rang", { detail: { visitorId: visitorEntry.id, name: visitorEntry.name, homeId: home.id, home: home.name } }));
  return true;
}

function maybeRing(s, home) {
  if (!home || !isAtHome(home, s)) return;
  const bell = s.playerHome.doorbell;
  if (bell.pending || now() - Number(bell.lastRingAt || 0) < 180000) return;
  const bucket = `${home.name}:${Number(s.playerRoom?.day || 1)}:${Math.floor(Number(s.playerRoom?.hour ?? s.time?.hour ?? 12) / 3)}:${home.visits}`;
  if (hash(bucket) % 100 < 24) ringDoorbell("", { homeId: home.id });
}

function addVisitorToScene(s, visitor, home) {
  const id = String(visitor.id || slug(visitor.name));
  if (!Array.isArray(s.sceneCharacters)) s.sceneCharacters = [];
  if (!s.sceneCharacters.some((item) => same(item?.id || item?.cardId || item?.name, id) || same(item?.name, visitor.name))) {
    s.sceneCharacters.push({ id, cardId: id, name: visitor.name, source: "doorbell", location: home.name });
  }
  const entry = allNpcRecords(s).find((candidate) => same(candidate.id, id) || same(candidate.name, visitor.name));
  for (const ref of entry?.refs || []) ref.currentLocation = home.name;
}

function handleDoor(action) {
  const s = getSettings();
  ensureState(s);
  const pending = s.playerHome.doorbell.pending;
  if (!pending) return;
  const home = getHomeById(s, pending.homeId) || selectedHome(s);
  if (!home) return;
  if (action === "answer") {
    pending.answered = true;
    recordEvent(s, home, `You answered the door for ${pending.name}.`, "doorbell");
    try { injectRpEvent(`[At the front door of ${home.name}: You answered ${pending.name}'s ring. ${pending.name} ${pending.purpose}.]`); } catch (_) {}
  }
  if (action === "admit") {
    if (!isAtHome(home, s)) {
      notify("warning", `Travel to ${home.name} before letting someone inside.`, "Player Home");
      return;
    }
    addVisitorToScene(s, pending, home);
    recordEvent(s, home, `${pending.name} was invited inside.`, "visitor");
    try { injectRpEvent(`[Home visit: You invited ${pending.name} inside ${home.name}. ${pending.name} is now present in the scene.]`); } catch (_) {}
    s.playerHome.doorbell.pending = null;
  }
  if (action === "turn-away" || action === "ignore") {
    recordEvent(s, home, action === "ignore" ? `You did not answer ${pending.name}.` : `${pending.name} was turned away.`, "doorbell");
    try { injectRpEvent(`[Doorbell: You ${action === "ignore" ? "did not answer" : "turned away"} ${pending.name}. The visitor left.]`); } catch (_) {}
    s.playerHome.doorbell.pending = null;
  }
  commit(s);
  renderHome();
  updateHomeMenuState(s);
}

function statusPill(home, s) {
  if (!home) return '<span class="uie-home-pill is-away">No Home Selected</span>';
  if (isAtHome(home, s)) return '<span class="uie-home-pill is-here">Currently Here</span>';
  return '<span class="uie-home-pill is-away">Away</span>';
}

function homeSelectorHtml(s, active) {
  const homes = allHomes(s);
  if (!homes.length) return '<option value="">No homes claimed</option>';
  return homes.map((home) => `<option value="${esc(home.id)}" ${same(home.id, active?.id) ? "selected" : ""}>${home.primary ? "★ " : ""}${esc(home.name)}</option>`).join("");
}

function overviewHtml(s, home) {
  if (!home) return `
    <section class="uie-home-empty">
      <i class="fa-solid fa-map-location-dot"></i>
      <h3>No Player Home Yet</h3>
      <p>Open the map, choose a building, room, camp, ship, cave, vehicle, or other location, then use <strong>Add to Player Homes</strong>.</p>
      <button data-home-action="map">Open Map</button>
    </section>`;

  const members = householdEntries(s, home);
  const present = members.filter((member) => member.present);
  const children = members.filter((member) => ["infant", "toddler", "child", "teen"].includes(member.stage));
  const pending = pendingVisitorForHome(s, home);
  const physicalDisabled = !isAtHome(home, s) ? "disabled aria-disabled=\"true\"" : "";
  return `
    <section class="uie-home-hero">
      <div>
        <div class="uie-home-eyebrow">${home.primary ? "PRIMARY HOME" : "PLAYER HOME"}</div>
        <h3>${esc(home.name)}</h3>
        <p>${esc(home.description)}</p>
        <div class="uie-home-pills">
          ${statusPill(home, s)}
          <span class="uie-home-pill">${esc(home.kind)}</span>
          <span class="uie-home-pill">${esc(home.tenure)}</span>
          <span class="uie-home-pill">${members.length} household</span>
        </div>
      </div>
      <div class="uie-home-hero-actions">
        ${home.primary ? "" : `<button data-home-command="primary" data-home-id="${esc(home.id)}"><i class="fa-solid fa-star"></i> Set Primary</button>`}
        ${isAtHome(home, s) ? "" : `<button data-home-command="travel" data-home-id="${esc(home.id)}"><i class="fa-solid fa-route"></i> Travel Here</button>`}
      </div>
    </section>

    <section class="uie-home-summary-grid">
      <article><span>Household</span><strong>${members.length + 1}</strong><small>${present.length + 1} currently home</small></article>
      <article><span>Children & Dependents</span><strong>${children.length}</strong><small>${children.map((member) => member.name).slice(0, 2).join(", ") || "None assigned"}</small></article>
      <article><span>Rooms</span><strong>${home.rooms.length}</strong><small>${home.rooms.map((room) => room.name).slice(0, 3).join(", ")}</small></article>
      <article><span>Visits</span><strong>${Number(home.visits || 0)}</strong><small>${home.lastVisitedAt ? new Date(home.lastVisitedAt).toLocaleString() : "Not visited yet"}</small></article>
    </section>

    <section class="uie-home-panel">
      <div class="uie-home-panel-head"><div><span class="uie-home-eyebrow">AT HOME NOW</span><h4>Household Presence</h4></div><button data-home-tab-jump="household">Manage</button></div>
      <div class="uie-home-chip-list">
        <span class="uie-home-person-chip is-present">${esc(s.character?.name || s.name || "You")} · Player</span>
        ${present.map((member) => `<span class="uie-home-person-chip is-present">${esc(member.name)} · ${esc(member.role)}</span>`).join("") || '<span class="uie-home-muted">No assigned household members are currently here.</span>'}
      </div>
    </section>

    <section class="uie-home-panel">
      <div class="uie-home-panel-head"><div><span class="uie-home-eyebrow">FRONT DOOR</span><h4>${pending ? `${esc(pending.name)} is waiting` : "Quiet"}</h4></div><button data-home-tab-jump="visitors">Open Visitors</button></div>
      <p class="uie-home-muted">${pending ? `${esc(pending.name)} ${esc(pending.purpose)}.` : "No one is currently at the door."}</p>
    </section>

    <section class="uie-home-panel">
      <div class="uie-home-panel-head"><div><span class="uie-home-eyebrow">HOME ACTIONS</span><h4>${isAtHome(home, s) ? "Available Here" : `Travel to ${esc(home.name)} to use physical actions`}</h4></div></div>
      <div class="uie-home-action-grid">
        <button data-home-action="kitchen" ${physicalDisabled}>🍲 Kitchen</button>
        <button data-home-action="storage" ${physicalDisabled}>📦 Storage</button>
        <button data-home-action="wardrobe" ${physicalDisabled}>👕 Wardrobe</button>
        <button data-home-action="rest" ${physicalDisabled}>🛏 Rest & Activities</button>
        <button data-home-action="property" ${physicalDisabled}>🏠 Property</button>
        <button data-home-action="social">👥 Social & Lineage</button>
        <button data-home-action="npc-management">🧍 NPC Management</button>
        <button data-home-action="map">🗺 Map</button>
      </div>
    </section>`;
}

function homesHtml(s, active) {
  const homes = allHomes(s);
  if (!homes.length) return overviewHtml(s, null);
  return `<section class="uie-home-card-grid">${homes.map((home) => `
    <article class="uie-home-card ${same(home.id, active?.id) ? "is-selected" : ""}">
      <div class="uie-home-card-head">
        <div><span class="uie-home-eyebrow">${home.primary ? "PRIMARY" : esc(home.tenure)}</span><h3>${esc(home.name)}</h3></div>
        ${statusPill(home, s)}
      </div>
      <p>${esc(home.description)}</p>
      <div class="uie-home-pills"><span class="uie-home-pill">${esc(home.kind)}</span><span class="uie-home-pill">${Object.keys(home.household || {}).length} residents</span><span class="uie-home-pill">${home.rooms.length} rooms</span></div>
      <label class="uie-home-field">Living arrangement
        <select data-home-tenure data-home-id="${esc(home.id)}">
          ${["owned", "rented", "family", "hosted", "temporary", "mobile", "borrowed"].map((value) => `<option value="${value}" ${home.tenure === value ? "selected" : ""}>${value}</option>`).join("")}
        </select>
      </label>
      <div class="uie-home-card-actions">
        <button data-home-command="select" data-home-id="${esc(home.id)}">Open</button>
        ${home.primary ? "" : `<button data-home-command="primary" data-home-id="${esc(home.id)}">Set Primary</button>`}
        ${isAtHome(home, s) ? "" : `<button data-home-command="travel" data-home-id="${esc(home.id)}">Travel</button>`}
        <button class="is-danger" data-home-command="remove" data-home-id="${esc(home.id)}">Remove</button>
      </div>
    </article>`).join("")}</section>`;
}

const HOUSEHOLD_ROLES = ["Parent", "Partner", "Child", "Infant", "Guardian", "Sibling", "Grandparent", "Relative", "Roommate", "Tenant", "Resident", "Guest", "Staff", "Caregiver"];

function householdHtml(s, home) {
  if (!home) return overviewHtml(s, null);
  const members = householdEntries(s, home);
  const assignedIds = new Set(members.map((member) => member.id.toLowerCase()));
  const candidates = allNpcRecords(s).filter((entry) => !assignedIds.has(entry.id.toLowerCase()));
  const rooms = home.rooms || [];
  const familyElsewhere = candidates.filter((entry) => {
    const role = inferHouseholdRole(s, entry);
    return ["Parent", "Partner", "Child", "Infant", "Guardian", "Sibling", "Grandparent", "Relative"].includes(role);
  });

  const memberCards = members.map((member) => `
    <article class="uie-home-member-card ${member.present ? "is-present" : ""}">
      <div class="uie-home-avatar">${member.npc?.avatar || member.npc?.image ? `<img src="${esc(member.npc.avatar || member.npc.image)}" alt="">` : `<i class="fa-solid fa-user"></i>`}</div>
      <div class="uie-home-member-main">
        <div class="uie-home-member-title"><strong>${esc(member.name)}</strong><span>${member.present ? "Home now" : "Away"}</span></div>
        <div class="uie-home-pills"><span class="uie-home-pill">${esc(member.stage)}</span><span class="uie-home-pill">${esc(member.role)}</span></div>
        <div class="uie-home-member-fields">
          <label>Household role<select data-household-role data-home-id="${esc(home.id)}" data-npc-id="${esc(member.id)}">${HOUSEHOLD_ROLES.map((role) => `<option ${same(role, member.role) ? "selected" : ""}>${role}</option>`).join("")}</select></label>
          <label>Room<select data-household-room data-home-id="${esc(home.id)}" data-npc-id="${esc(member.id)}"><option value="">Unassigned</option>${rooms.map((room) => `<option value="${esc(room.id)}" ${same(room.id, member.assignment.roomId) ? "selected" : ""}>${esc(room.name)}</option>`).join("")}</select></label>
        </div>
      </div>
      <button class="uie-home-icon-btn is-danger" data-household-remove data-home-id="${esc(home.id)}" data-npc-id="${esc(member.id)}" title="Remove from household"><i class="fa-solid fa-user-minus"></i></button>
    </article>`).join("");

  const candidateOptions = candidates.map((entry) => `<option value="${esc(entry.id)}">${esc(entry.name)} · ${esc(inferHouseholdRole(s, entry))}</option>`).join("");
  return `
    <section class="uie-home-panel">
      <div class="uie-home-panel-head"><div><span class="uie-home-eyebrow">HOUSEHOLD & FAMILY</span><h3>${esc(home.name)}</h3></div><button data-home-action="npc-management">Open NPC Management</button></div>
      <p class="uie-home-muted">Lineage describes who is related. Household describes who lives here. A child can live with grandparents, a guardian, one parent, or another family group without duplicating their NPC record.</p>
      <div class="uie-home-add-member">
        <select id="uie-home-household-candidate"><option value="">Choose an NPC…</option>${candidateOptions}</select>
        <select id="uie-home-household-role">${HOUSEHOLD_ROLES.map((role) => `<option>${role}</option>`).join("")}</select>
        <button data-household-add data-home-id="${esc(home.id)}" ${candidates.length ? "" : "disabled"}>Add to Household</button>
      </div>
    </section>
    ${familyElsewhere.length ? `<section class="uie-home-panel"><div class="uie-home-panel-head"><div><span class="uie-home-eyebrow">FAMILY LIVING ELSEWHERE</span><h4>${familyElsewhere.length} known relative${familyElsewhere.length === 1 ? "" : "s"}</h4></div></div><div class="uie-home-chip-list">${familyElsewhere.slice(0, 12).map((entry) => `<span class="uie-home-person-chip">${esc(entry.name)} · ${esc(inferHouseholdRole(s, entry))}</span>`).join("")}</div></section>` : ""}
    <section class="uie-home-member-list">${memberCards || '<div class="uie-home-empty-compact">No NPC household members assigned yet.</div>'}</section>`;
}

function roomsHtml(s, home) {
  if (!home) return overviewHtml(s, null);
  const members = householdEntries(s, home);
  return `
    <section class="uie-home-panel">
      <div class="uie-home-panel-head"><div><span class="uie-home-eyebrow">ROOMS & SPACES</span><h3>${esc(home.name)}</h3></div><button data-room-add data-home-id="${esc(home.id)}"><i class="fa-solid fa-plus"></i> Add Room</button></div>
      <p class="uie-home-muted">Rooms control where residents sleep and which home activities make sense. Camps, ships, caves, vehicles, and buildings can all use spaces without pretending they are houses.</p>
    </section>
    <section class="uie-home-card-grid">${home.rooms.map((room) => {
      const assigned = members.filter((member) => same(member.assignment.roomId, room.id));
      return `<article class="uie-home-card"><div class="uie-home-card-head"><div><span class="uie-home-eyebrow">${esc(room.type)}</span><h3>${esc(room.name)}</h3></div><i class="fa-solid fa-door-open"></i></div><div class="uie-home-chip-list">${assigned.map((member) => `<span class="uie-home-person-chip">${esc(member.name)}</span>`).join("") || '<span class="uie-home-muted">No assigned residents</span>'}</div><div class="uie-home-card-actions"><button data-room-rename data-home-id="${esc(home.id)}" data-room-id="${esc(room.id)}">Rename</button>${home.rooms.length > 1 ? `<button class="is-danger" data-room-remove data-home-id="${esc(home.id)}" data-room-id="${esc(room.id)}">Remove</button>` : ""}</div></article>`;
    }).join("")}</section>`;
}

function visitorsHtml(s, home) {
  if (!home) return overviewHtml(s, null);
  const pending = pendingVisitorForHome(s, home);
  return `
    <section class="uie-home-panel uie-home-door-panel ${pending ? "is-ringing" : ""}">
      <div class="uie-home-panel-head"><div><span class="uie-home-eyebrow">FRONT DOOR · ${esc(home.name)}</span><h3>${pending ? `${esc(pending.name)} is waiting` : "No visitor waiting"}</h3></div><span class="uie-home-pill ${pending ? "is-warning" : ""}">${pending ? (pending.answered ? "ANSWERED" : "RINGING") : "QUIET"}</span></div>
      <p>${pending ? `${esc(pending.name)} ${esc(pending.purpose)}.` : "Visitors, deliveries, and household arrivals will appear here without forcing this modal open."}</p>
      <div class="uie-home-card-actions">${pending ? `<button data-home-door="answer" ${pending.answered ? "disabled" : ""}>Answer</button><button data-home-door="admit" ${isAtHome(home, s) ? "" : "disabled"}>Let In</button><button data-home-door="turn-away">Turn Away</button><button data-home-door="ignore">Ignore</button>` : `<button data-home-command="test-doorbell" data-home-id="${esc(home.id)}">Simulate Visit</button>`}</div>
    </section>
    <section class="uie-home-panel"><span class="uie-home-eyebrow">VISITOR RULE</span><p class="uie-home-muted">Let In is only available while physically at this home. Answer, ignore, or turn away remain available from the Home manager.</p></section>`;
}

function historyHtml(s, home) {
  const events = home ? s.playerHome.events.filter((event) => !event.homeId || same(event.homeId, home.id)) : s.playerHome.events;
  return `
    <section class="uie-home-panel"><div class="uie-home-panel-head"><div><span class="uie-home-eyebrow">HOME HISTORY</span><h3>${home ? esc(home.name) : "All Homes"}</h3></div><button data-home-action="clear-events">Clear</button></div></section>
    <section class="uie-home-timeline">${events.length ? events.slice(0, 50).map((event) => `<article><span>${new Date(event.at || now()).toLocaleString()}</span><strong>${esc(event.text)}</strong><small>${esc(event.type || "home")}</small></article>`).join("") : '<div class="uie-home-empty-compact">No home events yet.</div>'}</section>`;
}

function renderTabContent(s, home) {
  switch (s.playerHome.selectedTab) {
    case "homes": return homesHtml(s, home);
    case "household": return householdHtml(s, home);
    case "rooms": return roomsHtml(s, home);
    case "visitors": return visitorsHtml(s, home);
    case "history": return historyHtml(s, home);
    default: return overviewHtml(s, home);
  }
}

export function renderHome() {
  const s = getSettings();
  ensureState(s);
  const home = selectedHome(s);
  updateHomeMenuState(s);
  $("#uie-home-selector").html(homeSelectorHtml(s, home)).prop("disabled", allHomes(s).length === 0);
  $("#uie-home-current-badge").html(statusPill(home, s));
  $("#uie-home-header-subtitle").text(home ? `${home.primary ? "Primary" : "Residence"} · ${home.kind} · ${home.tenure}` : "Choose a location from the map");
  $("#uie-player-home-window [data-home-tab]").each(function () {
    const active = String($(this).data("home-tab")) === s.playerHome.selectedTab;
    $(this).toggleClass("is-active", active).attr("aria-selected", active ? "true" : "false");
  });
  $("#uie-home-content").html(renderTabContent(s, home));
}

async function homeAction(action) {
  const s = getSettings();
  ensureState(s);
  const home = selectedHome(s);
  if (PHYSICAL_ACTIONS.has(action) && !isAtHome(home, s)) {
    notify("warning", home ? `Travel to ${home.name} before using that home action.` : "Choose a home first.", "Player Home");
    return;
  }
  if (action === "kitchen") return void (await import("./features/kitchen.js")).open?.();
  if (["storage", "wardrobe", "property"].includes(action)) return void (await import("./inventory.js")).openInventoryTab?.(action === "wardrobe" ? "equipment" : action === "property" ? "assets" : "items");
  if (action === "rest") { const mod = await import("./features/activities.js"); mod.initActivities?.(); $("#uie-activities-window").css("display", "flex"); return; }
  if (action === "map") { const mod = await import("./map.js"); await mod.initMap?.(); $("#uie-map-window").css("display", "flex"); return; }
  if (action === "social") { $("#uie-social-window").css("display", "flex"); return; }
  if (action === "npc-management") { const mod = await import("./npcManagementModal.js"); mod.initNPCManagementModal?.(); mod.openNPCRosterPanel?.(); return; }
  if (action === "clear-events") { s.playerHome.events = []; for (const item of allHomes(s)) item.events = []; commit(s, { emit: false }); renderHome(); }
}

async function executeCommand(command, homeId) {
  const s = getSettings();
  ensureState(s);
  const home = getHomeById(s, homeId);
  if (command === "select" && home) {
    s.playerHome.activeHomeId = home.id;
    s.playerHome.selectedTab = "overview";
    commit(s, { emit: false });
    renderHome();
    return;
  }
  if (command === "primary") return void setPrimaryHome(homeId);
  if (command === "remove") {
    if (!home) return;
    const confirmed = window.confirm?.(`Remove ${home.name} from Player Homes? NPC records will remain intact.`);
    if (confirmed !== false) removePlayerHome(homeId);
    return;
  }
  if (command === "travel" && home) {
    const mod = await import("./map.js");
    const ok = await mod.travelToLocationName?.(home.locationRef?.name || home.name, { source: "player_home", reason: "Travel to player home" });
    if (ok) {
      closePlayerHome();
      notify("success", `Traveled to ${home.name}.`, "Player Home");
    }
    return;
  }
  if (command === "test-doorbell" && home) ringDoorbell("", { homeId: home.id, replace: true });
}

function addRoom(homeId) {
  const s = getSettings();
  ensureState(s);
  const home = getHomeById(s, homeId);
  if (!home) return;
  const name = String(window.prompt?.("Room or space name:", "New Room") || "").trim();
  if (!name) return;
  const type = String(window.prompt?.("Room type (bedroom, nursery, kitchen, workshop, garden, storage, etc.):", "room") || "room").trim();
  let id = slug(name);
  let n = 2;
  while (home.rooms.some((room) => same(room.id, id))) id = `${slug(name)}_${n++}`;
  home.rooms.push({ id, name, type, createdAt: now() });
  recordEvent(s, home, `${name} was added to the home.`, "room");
  commit(s);
  renderHome();
}

function renameRoom(homeId, roomId) {
  const s = getSettings();
  ensureState(s);
  const home = getHomeById(s, homeId);
  const room = home?.rooms?.find((item) => same(item.id, roomId));
  if (!home || !room) return;
  const name = String(window.prompt?.("Rename room:", room.name) || "").trim();
  if (!name) return;
  room.name = name;
  commit(s);
  renderHome();
}

function removeRoom(homeId, roomId) {
  const s = getSettings();
  ensureState(s);
  const home = getHomeById(s, homeId);
  if (!home || home.rooms.length <= 1) return;
  home.rooms = home.rooms.filter((room) => !same(room.id, roomId));
  for (const assignment of Object.values(home.household || {})) if (same(assignment.roomId, roomId)) assignment.roomId = "";
  commit(s);
  renderHome();
}

async function detectArrival(event) {
  if (arrivalBusy) return;
  const s = getSettings();
  ensureState(s);
  const context = currentContext(s);
  const detail = event?.detail || event?.originalEvent?.detail || {};
  const fingerprint = `${context.name}|${context.nodeId}|${context.type}`.toLowerCase();
  updateHomeMenuState(s, context);

  if (!context.name || fingerprint === lastLocationFingerprint) {
    if ($("#uie-player-home-window").is(":visible")) renderHome();
    return;
  }

  lastLocationFingerprint = fingerprint;
  const home = ensureCurrentHomeRecord(s, context);
  s.playerHome.currentHomeId = home?.id || "";

  if (!home) {
    commit(s, { emit: false });
    if ($("#uie-player-home-window").is(":visible")) renderHome();
    return;
  }

  arrivalBusy = true;
  try {
    home.visits = Number(home.visits || 0) + 1;
    home.lastVisitedAt = now();
    s.playerHome.activeHomeId = home.id;
    recordEvent(s, home, `Arrived home at ${home.name}.`, "arrival");
    commit(s, { emit: false });
    updateHomeMenuState(s, context);
    if ($("#uie-player-home-window").is(":visible")) renderHome();
    if (event?.type !== "uie:home-check" || detail.startup) maybeRing(s, home);
    window.dispatchEvent(new CustomEvent("uie:home_entered", { detail: { location: home.name, homeId: home.id, primary: home.primary } }));
  } finally {
    arrivalBusy = false;
  }
}

export function initPlayerHome() {
  const $win = $("#uie-player-home-window");
  if (!$win.length) return;
  const s = getSettings();
  ensureState(s);
  lastLocationFingerprint = "";

  $win.attr("aria-hidden", $win.is(":visible") ? "false" : "true");
  $win.css({ pointerEvents: "auto", touchAction: "pan-y", overscrollBehavior: "contain" });

  $win.off(".uieHome")
    .on("click.uieHome", ".close-btn", (event) => { event.preventDefault(); event.stopPropagation(); closePlayerHome(); })
    .on("click.uieHome", "[data-home-tab]", function (event) {
      event.preventDefault();
      const tab = String($(this).data("home-tab"));
      if (!HOME_TABS.includes(tab)) return;
      const settings = getSettings(); ensureState(settings); settings.playerHome.selectedTab = tab; commit(settings, { emit: false }); renderHome();
    })
    .on("click.uieHome", "[data-home-tab-jump]", function (event) {
      event.preventDefault();
      const tab = String($(this).data("home-tab-jump"));
      const settings = getSettings(); ensureState(settings); settings.playerHome.selectedTab = tab; commit(settings, { emit: false }); renderHome();
    })
    .on("change.uieHome", "#uie-home-selector", function () {
      const settings = getSettings(); ensureState(settings); settings.playerHome.activeHomeId = String($(this).val() || ""); commit(settings, { emit: false }); renderHome();
    })
    .on("change.uieHome", "[data-home-tenure]", function () {
      const settings = getSettings(); ensureState(settings); const home = getHomeById(settings, String($(this).data("home-id"))); if (!home) return; home.tenure = String($(this).val() || "owned"); commit(settings); renderHome();
    })
    .on("click.uieHome", "[data-home-action]", function (event) { event.preventDefault(); event.stopPropagation(); void homeAction(String($(this).data("home-action"))); })
    .on("click.uieHome", "[data-home-command]", function (event) { event.preventDefault(); event.stopPropagation(); void executeCommand(String($(this).data("home-command")), String($(this).data("home-id") || "")); })
    .on("click.uieHome", "[data-home-door]", function (event) { event.preventDefault(); event.stopPropagation(); handleDoor(String($(this).data("home-door"))); })
    .on("click.uieHome", "[data-household-add]", function (event) {
      event.preventDefault();
      const id = String($("#uie-home-household-candidate").val() || "");
      const role = String($("#uie-home-household-role").val() || "Resident");
      if (id) assignHouseholdMember(String($(this).data("home-id")), id, role);
    })
    .on("click.uieHome", "[data-household-remove]", function (event) { event.preventDefault(); removeHouseholdMember(String($(this).data("home-id")), String($(this).data("npc-id"))); })
    .on("change.uieHome", "[data-household-role]", function () { updateHouseholdAssignment(String($(this).data("home-id")), String($(this).data("npc-id")), { role: String($(this).val() || "Resident") }); })
    .on("change.uieHome", "[data-household-room]", function () { updateHouseholdAssignment(String($(this).data("home-id")), String($(this).data("npc-id")), { roomId: String($(this).val() || "") }); })
    .on("click.uieHome", "[data-room-add]", function (event) { event.preventDefault(); addRoom(String($(this).data("home-id"))); })
    .on("click.uieHome", "[data-room-rename]", function (event) { event.preventDefault(); renameRoom(String($(this).data("home-id")), String($(this).data("room-id"))); })
    .on("click.uieHome", "[data-room-remove]", function (event) { event.preventDefault(); removeRoom(String($(this).data("home-id")), String($(this).data("room-id"))); });

  $(window)
    .off("uie:state_updated.uieHome uie:home-check.uieHome uie:doorbell.uieHome uie:home_registry_updated.uieHome")
    .on("uie:state_updated.uieHome uie:home-check.uieHome", detectArrival)
    .on("uie:doorbell.uieHome", (event, detail) => {
      const payload = detail || event?.detail || event?.originalEvent?.detail || {};
      ringDoorbell(payload.visitorId || payload.name || "", payload);
    })
    .on("uie:home_registry_updated.uieHome", () => renderHome());

  window.UIE_ringDoorbell = ringDoorbell;
  window.UIE_openPlayerHome = openPlayerHome;
  window.UIE_closePlayerHome = closePlayerHome;
  window.UIE_claimMapLocationAsHome = claimMapLocationAsHome;

  updateHomeMenuState(s, currentContext(s));
  renderHome();
  setTimeout(() => window.dispatchEvent(new CustomEvent("uie:home-check", { detail: { startup: true } })), 650);
}
