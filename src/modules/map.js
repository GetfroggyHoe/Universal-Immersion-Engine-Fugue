import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";
import { getRealityEngineV3, initForgeV3 } from "./reality.js";
import { customConfirm } from "./popups.js";
import { getGlobalDOM } from "./domHierarchy.js";
import {
    ensureTravelAssetFields,
    classifyTravelLocation,
    evaluateTravelAssetPlacement,
    isTravelAsset,
    requiresVehicleMicroMap,
} from "./travelAssets.js";
import {
    applyLocationAsset,
    pollLocationImageAsset,
    requestLocationImageAsset,
} from "./serverAssets.js";
import {
    backendJson,
    buildBackendUrl,
    createBackendWebSocket,
    syncMap,
} from "./backendBridge.js";
import {
    MAP_GENERATION_TEMPLATE,
    allowsBlueprint,
    allowsGeneratedBlueprint,
    classifySpatialEnvironment,
    environmentTemplate,
    generationTemplatePrompt,
    proceduralEditRoomPresets,
    proceduralSpatialPresets,
    sanitizePresetName,
    validateMapPackage,
    vicinityPresetNames,
} from "./mapTemplate.js";

const VIEW_ORDER = ["world", "region", "area", "vicinity", "blueprint"];
const VIEW_LABELS = {
    world: "World",
    region: "Region",
    area: "Local",
    vicinity: "Nearby",
    blueprint: "Area",
};
const DIRECTIONS = ["north", "east", "south", "west"];
const OPPOSITE = { north: "south", south: "north", east: "west", west: "east" };
const DEFAULT_RUNE_NODES = [
    { id: 1, x: 24, y: 24 }, { id: 2, x: 50, y: 18 }, { id: 3, x: 76, y: 24 },
    { id: 4, x: 24, y: 54 }, { id: 5, x: 50, y: 50 }, { id: 6, x: 76, y: 54 },
    { id: 7, x: 24, y: 78 }, { id: 8, x: 50, y: 84 }, { id: 9, x: 76, y: 78 },
];
const DELTA = {
    north: { x: 0, y: -1 },
    south: { x: 0, y: 1 },
    east: { x: 1, y: 0 },
    west: { x: -1, y: 0 },
};
const ORGANIC_STEP = 15;
const MOVEMENT_VERB_RE = /\b(?:go|going|head|heading|walk|walking|run|running|rush|rushing|drive|driving|ride|riding|travel|traveling|travelling|fly|flying|sail|sailing|move|moving|return|returning|enter|entering|board|boarding|mount|use|using|find|locate|approach|dismount|park|disembark|visit|visiting|reach|reaching|arrive|arriving|teleport|teleporting|warp|warping|blast|blasts|blasted|take me|takes me|took me)\b/i;
const NEGATED_MOVEMENT_RE = /\b(?:do not|don't|did not|didn't|will not|won't|not going to|refuse to)\s+(?:go|head|walk|run|drive|ride|travel|fly|sail|move|return|enter|board|mount|use|find|locate|approach|park|disembark|dismount|teleport|warp)\b/i;
const TRANSIT_TYPES = {
    dock: { type: "dock", kind: "ship", label: "Ship Dock" },
    harbor: { type: "dock", kind: "ship", label: "Harbor Dock" },
    port: { type: "dock", kind: "ship", label: "Ship Port" },
    pier: { type: "dock", kind: "ship", label: "Boat Pier" },
    station: { type: "station", kind: "rail", label: "Train Station" },
    terminal: { type: "station", kind: "rail", label: "Rail Terminal" },
    garage: { type: "garage", kind: "vehicle", label: "Garage / Parking" },
    parking: { type: "garage", kind: "vehicle", label: "Garage / Parking" },
    spaceport: { type: "spaceport", kind: "spacecraft", label: "Spaceport Dock" },
    hangar: { type: "hangar", kind: "aircraft", label: "Hangar / Landing Pad" },
};
const FOCUSED_DOM_JOB_PRESETS = {
    school: {
        label: "Student / School",
        kind: "school",
        windows: ["08:00-15:30"],
        tasks: ["Attend class", "Submit assignment", "Study with classmate", "Visit faculty office"],
    },
    service: {
        label: "Service / Cafe",
        kind: "job",
        windows: ["06:00-14:00", "14:00-22:00"],
        tasks: ["Clock in", "Serve rush", "Clean station", "Handle customer issue"],
    },
    retail: {
        label: "Retail / Shop",
        kind: "job",
        windows: ["09:00-17:00", "12:00-20:00"],
        tasks: ["Open register", "Stock shelves", "Help customer", "Close till"],
    },
    office: {
        label: "Office / Agency",
        kind: "job",
        windows: ["09:00-17:00"],
        tasks: ["Review brief", "Meet supervisor", "File report", "Follow up with client"],
    },
    clinic: {
        label: "Clinic / Care",
        kind: "job",
        windows: ["07:00-15:00", "15:00-23:00"],
        tasks: ["Triage arrival", "Prepare room", "Update chart", "Check supplies"],
    },
    craft: {
        label: "Guild / Craft",
        kind: "job",
        windows: ["08:00-16:00"],
        tasks: ["Accept commission", "Prepare materials", "Craft order", "Deliver work"],
    },
    performance: {
        label: "Performance / Studio",
        kind: "job",
        windows: ["10:00-14:00", "18:00-23:00"],
        tasks: ["Warm up", "Rehearse set", "Perform scene", "Review feedback"],
    },
};

let initialized = false;
let state = null;
let selected = null;
let pendingRuneBarrier = null;
let pendingNavigationTarget = "";
let mapReturnFocus = null;
let manualLandmarkPoint = null;
const activeMapPointers = new Map();
let mapPinchStart = null;

function blurFocusInside(container) {
    try {
        const el = container && container.jquery ? container[0] : container;
        const active = document.activeElement;
        if (el && active && el.contains(active) && typeof active.blur === "function") active.blur();
    } catch (_) {}
}
let mapPan = null;
let backendMapSocket = null;
let backendMapSocketStarted = false;

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function parseStrictJsonObject(text = "") {
    const raw = String(text || "").trim().replace(/```json/gi, "```").replace(/```/g, "").trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) {}
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) {
        try { return JSON.parse(raw.slice(first, last + 1)); } catch (_) {}
    }
    return null;
}

function slug(value, fallback = "node") {
    const out = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 64);
    return out || fallback;
}

function hashSeed(value) {
    let h = 2166136261;
    const text = String(value || "");
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function seededUnit(seed, salt = 0) {
    let x = (Number(seed) ^ Math.imul(Number(salt) + 1, 0x9e3779b1)) >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
}

function resolveTopologySeed(options, identity, prompt, counts) {
    const explicit = Number(options?.seed ?? options?.mathSeed);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit >>> 0;
    return hashSeed(`${identity?.worldName || ""}|${prompt || ""}|${JSON.stringify(counts || {})}`);
}

function nodeDiscoveryState(node) {
    if (node?.isStartingRoom || node?.current) return "generated";
    const raw = String(node?.discoveryState || "").toLowerCase();
    return raw === "generated" || raw === "planned" ? raw : "generated";
}

function titleCase(value) {
    return String(value || "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeList(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
    return String(value || "")
        .split(/\n|,|;/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function ensureGovernanceFields(node = {}, inherited = {}) {
    if (!node || typeof node !== "object") return node;
    const inheritedLaws = normalizeList(inherited.laws || inherited.rules);
    const laws = normalizeList(node.laws || node.rules);
    node.laws = laws.length ? laws : inheritedLaws.length ? inheritedLaws.slice(0, 12) : ["Local customs apply"];
    const rawRep = node.reputation ?? node.reputationStatus ?? node.localReputation ?? inherited.reputation ?? inherited.reputationStatus;
    const reputation = normalizeList(rawRep);
    node.reputation = reputation.length ? reputation.slice(0, 8) : ["Neutral standing"];
    return node;
}

function cleanMapDescription(node = {}) {
    const raw = String(node.description || node.desc || node.summary || "").trim();
    if (!raw) return "No description recorded yet.";
    if (/\b(prompt|image prompt|negative prompt|generate|render|camera|lens|ultra[- ]?detailed|no text|without ui)\b/i.test(raw)) {
        const name = String(node.name || "This place").trim();
        const type = String(node.type || node.theme || "location").trim().toLowerCase();
        return `${name} is a ${type} on the map. Its permanent scene description will be written from story context when visited.`;
    }
    return raw.replace(/\s+/g, " ").slice(0, 600);
}

function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function currentLocationName() {
    const s = getSettings();
    return String(s.worldState?.location || s.map?.location || "Current Location").trim() || "Current Location";
}

function clampInt(value, min, max, fallback) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function readControlInt(id, fallback, min = 1, max = 80) {
    try {
        const el = document.getElementById(id);
        if (!el) return fallback;
        return clampInt(el.value, min, max, fallback);
    } catch (_) {
        return fallback;
    }
}

function readGenerationCounts(options = {}) {
    const raw = options.counts && typeof options.counts === "object" ? options.counts : {};
    return {
        worlds: clampInt(raw.worlds ?? readControlInt("wg-count-worlds", 1, 1, 8), 1, 8, 1),
        regions: clampInt(raw.regions ?? readControlInt("wg-count-regions", 4, 1, 24), 1, 24, 4),
        settlements: clampInt(raw.settlements ?? readControlInt("wg-count-settlements", 4, 0, 48), 0, 48, 4),
        places: clampInt(raw.places ?? readControlInt("wg-count-places", 10, 1, 120), 1, 120, 10),
        roomsPerInterior: clampInt(raw.roomsPerInterior ?? readControlInt("wg-count-rooms", 8, 1, 40), 1, 40, 8),
        blueprintMode: String(raw.blueprintMode || options.blueprintMode || document.getElementById("wg-blueprint-mode")?.value || "sites").toLowerCase(),
    };
}

function normalizeFocusedDomConfig(raw = {}) {
    const enabled = raw.enabled === true || String(raw.enabled || "").toLowerCase() === "true" || String(raw.enabled || "").toLowerCase() === "on";
    const subjects = normalizeList(raw.subjects || raw.focuses || raw.focus || raw.labels).slice(0, 12);
    const jobs = normalizeList(raw.jobs || raw.jobPreset || raw.job || raw.jobPresets)
        .map((job) => String(job || "").trim().toLowerCase())
        .filter((job) => job && job !== "none")
        .filter((job, index, arr) => arr.indexOf(job) === index)
        .slice(0, 8);
    const tasks = raw.tasks !== false && String(raw.tasks || "on").toLowerCase() !== "off";
    return { enabled, subjects, jobs, tasks };
}

function readFocusedDomOptions(options = {}) {
    if (options.focusedDoms && typeof options.focusedDoms === "object") return normalizeFocusedDomConfig(options.focusedDoms);
    const enabled = document.getElementById("wg-focused-enabled")?.value || "off";
    const subjects = document.getElementById("wg-focused-subjects")?.value || "";
    const job = document.getElementById("wg-focused-job")?.value || "";
    const tasks = document.getElementById("wg-focused-tasks")?.value || "on";
    return normalizeFocusedDomConfig({ enabled, subjects, jobs: job, tasks });
}

function parseTimeWindow(windowText = "") {
    const m = String(windowText || "").match(/(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?/);
    if (!m) return null;
    const start = Math.max(0, Math.min(23.99, Number(m[1] || 0) + (Number(m[2] || 0) / 60)));
    const end = Math.max(0, Math.min(23.99, Number(m[3] || 0) + (Number(m[4] || 0) / 60)));
    return { start, end, label: String(windowText || "").trim() };
}

function currentGameHour(s = getSettings()) {
    const candidates = [
        s.worldState?.hour,
        s.worldState?.timeHour,
        s.time?.hour,
        s.calendar?.hour,
    ];
    for (const raw of candidates) {
        const n = Number(raw);
        if (Number.isFinite(n)) return Math.max(0, Math.min(23.99, n));
    }
    const text = [s.worldState?.time, s.time?.clock, s.calendar?.time]
        .map((value) => String(value || "").trim())
        .find(Boolean) || "";
    const match = String(text).match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    if (match) {
        let hour = Number(match[1] || 0);
        const minute = Number(match[2] || 0);
        const meridiem = String(match[3] || "").toLowerCase();
        if (meridiem === "pm" && hour < 12) hour += 12;
        if (meridiem === "am" && hour === 12) hour = 0;
        return Math.max(0, Math.min(23.99, hour + minute / 60));
    }
    return new Date().getHours();
}

function focusKindFor(label = "") {
    const text = String(label || "").toLowerCase();
    if (/\b(school|academy|campus|class|student|teacher)\b/.test(text)) return "school";
    if (/\b(job|work|shift|office|clinic|shop|cafe|studio|guild)\b/.test(text)) return "job";
    if (/\b(family|household|lineage)\b/.test(text)) return "lineage";
    if (/\b(org|organization|faction|guild|company|agency)\b/.test(text)) return "organization";
    return "custom";
}

function jobPresetFor(kind = "") {
    const key = String(kind || "").trim().toLowerCase();
    return FOCUSED_DOM_JOB_PRESETS[key] || null;
}

function buildFocusedDomTasks(label, preset, enabled = true, s = getSettings()) {
    if (!enabled) return [];
    const hour = currentGameHour(s);
    const windows = (preset?.windows || ["09:00-17:00"]).map(parseTimeWindow).filter(Boolean);
    const activeWindow = windows.find((win) => {
        if (win.start <= win.end) return hour >= win.start && hour <= win.end;
        return hour >= win.start || hour <= win.end;
    });
    const baseTasks = preset?.tasks?.length ? preset.tasks : ["Check in", "Observe current need", "Complete local objective"];
    return baseTasks.map((task, index) => ({
        id: `${slug(label, "focus")}_task_${index + 1}`,
        label: task,
        status: activeWindow ? "available" : "scheduled",
        window: activeWindow?.label || windows[0]?.label || "contextual",
        generatedAt: Date.now(),
    }));
}

function buildFocusedDomState(config = {}, mapState = state, context = {}) {
    const focus = normalizeFocusedDomConfig(config);
    if (!focus.enabled) return { enabled: false, registry: {}, activeTasks: [], generatedAt: Date.now() };
    const s = getSettings();
    const registry = {};
    const addFocus = (label, kind, preset = null) => {
        const name = String(label || "").trim();
        if (!name) return;
        const id = slug(`${kind}_${name}`, "focused_dom");
        const local = (mapState?.area || []).find((node) => new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(`${node.name || ""} ${node.type || ""}`))
            || (mapState?.area || [])[0]
            || {};
        const tasks = buildFocusedDomTasks(name, preset, focus.tasks, s);
        registry[id] = {
            id,
            label: name,
            kind,
            scope: local?.name || context.label || currentLocationName(),
            taskWindow: preset?.windows || (tasks[0]?.window ? [tasks[0].window] : []),
            systems: ["modal", "tasks", "schedule", "roster"],
            tasks,
            builder: "fastapi-turboapi-ready",
            generatedAt: Date.now(),
        };
    };

    for (const job of focus.jobs) {
        const preset = jobPresetFor(job);
        addFocus(preset?.label || titleCase(job), preset?.kind || "job", preset);
    }
    for (const subject of focus.subjects) {
        const kind = focusKindFor(subject);
        const preset = jobPresetFor(kind === "school" ? "school" : "");
        addFocus(subject, kind, preset);
    }
    if (!Object.keys(registry).length) addFocus(context.label || currentLocationName(), "custom", null);

    return {
        enabled: true,
        registry,
        activeTasks: Object.values(registry).flatMap((entry) => entry.tasks || []).filter((task) => task.status === "available"),
        generatedAt: Date.now(),
    };
}

function syncFocusedDomsToHierarchy(focusedDoms) {
    try {
        const dom = getGlobalDOM();
        if (!dom) return;
        dom.focusedDoms = focusedDoms?.registry || {};
        dom.focusedDomTasks = focusedDoms?.activeTasks || [];
        if (dom.activeDOM) {
            dom.activeDOM.focusedDoms = dom.focusedDoms;
            dom.activeDOM.focusedDomTasks = dom.focusedDomTasks;
        }
    } catch (error) {
        console.warn("[map] Focused DOM sync failed", error);
    }
}

function defaultState() {
    const loc = currentLocationName();
    const s = getSettings();
    const known = s.worldState?.mapNodes?.[loc] || { name: loc, type: "interior" };
    const type = String(known.type || "interior");
    const bp = { id: slug(loc, "location"), parentName: loc, width: 12, height: 8, rooms: [], links: [] };
    const currentArea = { id: "area_current", name: loc, type, faction: "Inherited", theme: known.theme || "Immediate Area", x: 48, y: 50, z: 0, desc: known.description || "Current local place.", links: ["area_exit"], blueprintId: "" };
    const currentVicinity = createVicinityNodes(currentArea, loc);
    return {
        version: 2,
        view: "world",
        selectedId: "world_primary",
        world: [
            ensureGovernanceFields({ id: "world_primary", name: "Primary World", faction: "Inherited", theme: "Global Lore", x: 48, y: 48, desc: "Highest level: world, planet, setting, continent, or plane.", links: [] }),
        ],
        region: [
            ensureGovernanceFields({ id: "region_current", name: `${loc} Region`, faction: "Inherited", theme: "Regional Route", x: 28, y: 48, desc: "City, town, wilderness, district, or travel corridor.", links: ["region_routes"] }),
            ensureGovernanceFields({ id: "region_routes", name: "Regional Routes", faction: "Inherited", theme: "Roads / Rails / Docks", x: 55, y: 30, desc: "Route-planning layer for roads, rails, waterways, ports, and space lanes. Actual stations and docks are local places on the map.", links: ["region_edge"] }),
            ensureGovernanceFields({ id: "region_edge", name: "Outer District", faction: "Inherited", theme: "Surroundings", x: 75, y: 58, desc: "Outer edge where new map cells can be generated.", links: [] }),
        ],
        area: [
            ensureGovernanceFields(currentArea),
            ensureGovernanceFields({ id: "area_exit", name: "Nearby Exit", type: "exterior", faction: "Inherited", theme: "Exit", x: 68, y: 36, z: 0, desc: "Door, street, hallway, trail, or local transition.", links: ["area_service"] }),
            ensureGovernanceFields({ id: "area_service", name: "Side Space", type: "exterior", faction: "Inherited", theme: "Utility", x: 30, y: 68, z: 0, desc: "Secondary local room, building, street, or landmark.", links: [] }),
        ],
        vicinity: currentVicinity,
        vicinityByArea: { [loc]: currentVicinity },
        activeLocalName: loc,
        blueprint: bp,
        blueprints: {},
        generated: {
            counts: { worlds: 1, regions: 3, settlements: 1, places: 3, roomsPerInterior: 6 },
            prompt: "",
            scope: "local",
        },
        mapStyle: "modern",
        locatorOpen: false,
        viewport: { scale: 1, x: 0, y: 0 },
    };
}
export function deduplicateLocationPath(name) {
    if (!name) return "";
    const parts = String(name).split(/\s*-\s*/);
    const uniqueParts = [];
    for (const part of parts) {
        const p = part.trim();
        if (p && !uniqueParts.includes(p)) {
            uniqueParts.push(p);
        }
    }
    return uniqueParts.join(" - ");
}

function createVicinityNodes(anchor = null, label = "") {
    const rawBase = String(anchor?.name || label || currentLocationName()).trim() || "Current Location";
    const baseName = deduplicateLocationPath(rawBase);
    const faction = String(anchor?.faction || "Inherited");
    const theme = String(anchor?.theme || "User Surroundings");
    const template = environmentTemplate(anchor || { name: baseName, theme });
    const names = vicinityPresetNames(anchor || { name: baseName, theme });
    const idBase = slug(anchor?.id || baseName, "local");
    return names.map((name, i) => ({
        id: `${idBase}_nearby_${i + 1}`,
        name: deduplicateLocationPath(i === 0 ? baseName : `${baseName} - ${name}`),
        type: i === 0 ? String(anchor?.type || (template.enclosed ? "room" : "exterior")) : template.enclosed ? "room" : "nearby",
        faction,
        theme: i === 0 ? theme : `${theme} / Immediate`,
        x: [50, 50, 72, 32, 63, 42][i] || (20 + i * 12),
        y: [52, 24, 47, 43, 72, 78][i] || (30 + i * 8),
        z: Number(anchor?.z || 0),
        desc: i === 0
            ? `The player's exact active position inside ${baseName}.`
            : `Immediate Tier 3 travel option around ${baseName}.`,
        links: i + 1 < names.length ? [`${idBase}_nearby_${i + 2}`] : [],
        blueprintId: "",
        environment: template.environment,
        discoveryState: i === 0 ? "generated" : "planned",
        worldId: String(anchor?.worldId || ""),
        regionId: String(anchor?.regionId || ""),
        localId: String(anchor?.id || ""),
    }));
}

function normalizeVicinityNodesForLocal(local, nodes) {
    const list = Array.isArray(nodes) ? nodes : [];
    const idBase = slug(local?.id || local?.name, "local");
    const oldToNew = new Map(list.map((node, index) => [String(node?.id || `vicinity_${index + 1}`), `${idBase}_nearby_${index + 1}`]));
    for (let index = 0; index < list.length; index++) {
        const node = list[index];
        const oldId = String(node?.id || `vicinity_${index + 1}`);
        node.id = oldToNew.get(oldId) || `${idBase}_nearby_${index + 1}`;
        node.links = (Array.isArray(node.links) ? node.links : []).map((id) => oldToNew.get(String(id)) || String(id));
        node.localId = node.localId || local?.id || "";
        node.regionId = node.regionId || local?.regionId || "";
        node.worldId = node.worldId || local?.worldId || "";
    }
    return list;
}

function migrateState(existing) {
    if (!existing || typeof existing !== "object") return defaultState();
    const fallback = defaultState();
    if (existing.version === 2) {
        if (existing.mapStyle === "traditional") existing.mapStyle = "high-fantasy";
        existing.mapStyle = ["high-fantasy", "modern", "futuristic"].includes(existing.mapStyle) ? existing.mapStyle : "modern";
        existing.blueprints = existing.blueprints && typeof existing.blueprints === "object" ? existing.blueprints : {};
        if (existing.blueprint && !Object.keys(existing.blueprints).length) existing.blueprints[currentLocationName()] = existing.blueprint;
        existing.blueprint = existing.blueprint || Object.values(existing.blueprints)[0] || createBlueprint(currentLocationName(), { roomCount: 6 });
        for (const bp of Object.values(existing.blueprints)) ensureBlueprintExit(bp);
        ensureBlueprintExit(existing.blueprint);
        existing.barriers = existing.barriers && typeof existing.barriers === "object" ? existing.barriers : {};
        existing.world = Array.isArray(existing.world) && existing.world.length ? existing.world : fallback.world;
        existing.region = Array.isArray(existing.region) && existing.region.length ? existing.region : fallback.region;
        existing.area = Array.isArray(existing.area) && existing.area.length ? existing.area : fallback.area;
        existing.vicinity = Array.isArray(existing.vicinity) && existing.vicinity.length ? existing.vicinity : createVicinityNodes(existing.area?.[0], currentLocationName());
        existing.vicinityByArea = existing.vicinityByArea && typeof existing.vicinityByArea === "object" ? existing.vicinityByArea : {};
        existing.activeLocalName = String(existing.activeLocalName || currentLocationName() || existing.area?.[0]?.name || "");
        existing.viewport = existing.viewport && typeof existing.viewport === "object" ? existing.viewport : { scale: 1, x: 0, y: 0 };
        existing.locatorOpen = existing.locatorOpen === true;
        for (const local of existing.area) {
            const list = existing.vicinityByArea[local.name] || (local.name === existing.activeLocalName ? existing.vicinity : createVicinityNodes(local, local.name));
            existing.vicinityByArea[local.name] = normalizeVicinityNodesForLocal(local, list);
        }
        existing.vicinity = existing.vicinityByArea[existing.activeLocalName] || existing.vicinity;
        for (const nodes of [existing.world, existing.region, existing.area, existing.vicinity, ...Object.values(existing.vicinityByArea || {})]) {
            for (const node of Array.isArray(nodes) ? nodes : []) ensureGovernanceFields(node);
        }
        return existing;
    }
    const migrated = { ...fallback, ...existing, version: 2 };
    migrated.viewport = existing.viewport && typeof existing.viewport === "object" ? existing.viewport : { scale: 1, x: 0, y: 0 };
    migrated.blueprints = {};
    migrated.blueprint = existing.blueprint || createBlueprint(currentLocationName(), { roomCount: 6 });
    ensureBlueprintExit(migrated.blueprint);
    migrated.blueprints[currentLocationName()] = migrated.blueprint;
    migrated.barriers = existing.barriers && typeof existing.barriers === "object" ? existing.barriers : {};
    migrated.vicinity = Array.isArray(existing.vicinity) && existing.vicinity.length ? existing.vicinity : createVicinityNodes(migrated.area?.[0], currentLocationName());
    migrated.vicinityByArea = existing.vicinityByArea && typeof existing.vicinityByArea === "object" ? existing.vicinityByArea : {};
    migrated.activeLocalName = String(existing.activeLocalName || currentLocationName() || migrated.area?.[0]?.name || "");
    migrated.locatorOpen = existing.locatorOpen === true;
    for (const local of migrated.area) {
        const list = migrated.vicinityByArea[local.name] || (local.name === migrated.activeLocalName ? migrated.vicinity : createVicinityNodes(local, local.name));
        migrated.vicinityByArea[local.name] = normalizeVicinityNodesForLocal(local, list);
    }
    migrated.vicinity = migrated.vicinityByArea[migrated.activeLocalName] || migrated.vicinity;
    for (const nodes of [migrated.world, migrated.region, migrated.area, migrated.vicinity, ...Object.values(migrated.vicinityByArea || {})]) {
        for (const node of Array.isArray(nodes) ? nodes : []) ensureGovernanceFields(node);
    }
    return migrated;
}

function loadState() {
    const s = getSettings();
    const existing = s.simpleMap && typeof s.simpleMap === "object" ? s.simpleMap : null;
    state = migrateState(existing);
    if (!VIEW_ORDER.includes(state.view)) state.view = "world";
    selected = null;
    state.selectedId = "";
}

function persist() {
    const s = getSettings();
    s.simpleMap = state;
    saveSettings();
}

export function resetMapState({ save = false } = {}) {
    const s = getSettings();
    delete s.simpleMap;
    state = null;
    selected = null;
    pendingRuneBarrier = null;
    if (save) saveSettings();
}

async function ensureMounted() {
    if (document.getElementById("uie-map-window")) return true;
    try {
        const response = await fetch(new URL("../templates/map.html", import.meta.url));
        if (response.ok) {
            document.body.insertAdjacentHTML("beforeend", await response.text());
            if (document.getElementById("uie-map-window")) return true;
        }
    } catch (_) {}
    document.body.insertAdjacentHTML("beforeend", mapTemplate());
    return !!document.getElementById("uie-map-window");
}

function mapTemplate() {
    return `
<div id="uie-map-window" class="uie-window uie-simple-map" style="display:none;" aria-hidden="true">
  <div class="uie-simple-map__shell">
    <header class="uie-simple-map__header">
      <div class="uie-simple-map__brand">
        <h2 id="uie-map-title" class="uie-simple-map__title">Map</h2>
        <div id="uie-map-path" class="uie-simple-map__path" hidden></div>
      </div>
      <div class="uie-simple-map__actions">
        <nav class="uie-map-depth-stack" aria-label="Spatial depth">
          ${VIEW_ORDER.map((view) => `<button type="button" class="uie-simple-map__tab" data-map-view="${view}">${VIEW_LABELS[view] || view}</button>`).join("")}
        </nav>
        <label class="uie-simple-map__theme-picker" title="Map visual theme"><span>Style</span><select id="uie-map-style"><option value="high-fantasy">Fantasy Realm</option><option value="modern">Modern City</option><option value="futuristic">Futuristic Holo</option></select></label>
        <button type="button" class="uie-simple-map__tool" data-map-action="generate">Expand</button>
        <button type="button" class="uie-simple-map__tool" data-map-action="add">Add Place</button>
        <button type="button" class="uie-simple-map__tool" data-map-action="freeplace" style="background:linear-gradient(135deg,#a855f7,#7e22ce); color:#fff; border:none;">Free Place</button>
        <button type="button" class="uie-simple-map__icon" data-map-zoom="reset" title="Reset view">1:1</button>
        <button type="button" class="uie-simple-map__icon" data-map-action="import" title="Import map" aria-label="Import map"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 17V9"/><path d="m8 13 4 4 4-4"/></svg></button>
        <button type="button" class="uie-simple-map__icon" data-map-action="export" title="Export map" aria-label="Export map"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 9v8"/><path d="m8 13 4-4 4 4"/></svg></button>
        <button type="button" class="uie-simple-map__icon" data-map-action="share" title="Share map" aria-label="Share map"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/></svg></button>
        <button type="button" id="uie-map-close" class="uie-simple-map__close" aria-label="Close map">x</button>
      </div>
    </header>
    <main class="uie-simple-map__body">
      <section class="uie-simple-map__canvas" data-tip-text="Click the map to place the landmark" aria-label="Drag to move the map. Use mouse wheel or pinch to zoom.">
        <div class="uie-simple-map__backdrop" aria-hidden="true">
          <div class="uie-simple-map__land is-main"></div>
          <div class="uie-simple-map__land is-isle"></div>
          <div class="uie-simple-map__river"></div>
          <div class="uie-simple-map__mountains"><i></i><i></i><i></i><i></i></div>
          <div class="uie-simple-map__forest is-west"><i></i><i></i><i></i><i></i><i></i></div>
          <div class="uie-simple-map__forest is-east"><i></i><i></i><i></i><i></i></div>
          <div class="uie-simple-map__districts"><i></i><i></i><i></i><i></i><i></i><i></i></div>
          <div class="uie-simple-map__routes"><i></i><i></i><i></i></div>
          <div class="uie-simple-map__constellation"><i></i><i></i><i></i><i></i><i></i></div>
          <div class="uie-simple-map__waves is-one">~~~ ~~~ ~~~</div>
          <div class="uie-simple-map__waves is-two">~~~ ~~~</div>
        </div>
        <div class="uie-simple-map__legend" aria-label="Map color legend">
          <strong>Color Legend</strong>
          <span><b class="is-you"></b> You</span>
          <span><b class="is-target"></b> Target</span>
          <span><b class="is-transit"></b> Station / Dock</span>
          <span><b class="is-vehicle"></b> Vehicle / Ship</span>
          <span><b class="is-danger"></b> Danger</span>
          <span><b class="is-service"></b> Service</span>
          <span><b class="is-interior"></b> Interior</span>
        </div>
        <svg id="uie-map-links" class="uie-simple-map__links" viewBox="0 0 1000 620" preserveAspectRatio="none"></svg>
        <div id="uie-map-nodes" class="uie-simple-map__nodes"></div>
        <div id="uie-map-blueprint" class="uie-simple-map__blueprint" hidden></div>
        <div id="uie-map-navigation-popup" class="uie-simple-map__navigation-popup" hidden aria-live="polite"></div>
        <div id="map-hover-tooltip" class="uie-simple-map__tooltip" hidden></div>
      </section>
      <aside class="uie-simple-map__panel">
        <div class="uie-simple-map__card is-intel">
          <div class="uie-simple-map__eyebrow">Selected Intel</div>
          <h3 id="uie-map-selected-name">Current Location</h3>
          <p id="uie-map-selected-desc">Choose a world, region, local place, nearby route, or blueprint room.</p>
          <div id="uie-map-laws" class="uie-simple-map__chips"></div>
          <div class="uie-simple-map__eyebrow" style="margin-top:10px;">Reputation</div>
          <div id="uie-map-reputation" class="uie-simple-map__chips"></div>
          <div class="uie-simple-map__eyebrow" style="margin-top:10px;">Travel Access</div>
          <div id="uie-map-transport" class="uie-simple-map__chips"></div>
        </div>
        <div class="uie-simple-map__card">
          <div class="uie-simple-map__eyebrow">Route</div>
          <div id="uie-map-exits" class="uie-simple-map__exits"></div>
        </div>
        <div class="uie-simple-map__card">
          <div class="uie-simple-map__eyebrow">AI Room Constraints</div>
          <dl class="uie-simple-map__facts"><dt>Organization</dt><dd id="uie-map-faction">Inherited</dd><dt>Theme</dt><dd id="uie-map-theme">Local</dd><dt>Coords</dt><dd id="uie-map-coords">0,0,0</dd><dt>Layer</dt><dd id="uie-map-layer">World</dd></dl>
        </div>
        <div class="uie-simple-map__card uie-simple-map__home-card" id="uie-map-home-card" style="display:none;">
          <div class="uie-simple-map__home-top">
            <div>
              <div class="uie-simple-map__eyebrow">Residence Anchor</div>
              <div id="uie-map-home-status" class="uie-simple-map__home-status"></div>
            </div>
            <i class="fa-solid fa-house-chimney-window" aria-hidden="true"></i>
          </div>
          <div id="uie-map-home-details" class="uie-simple-map__home-details"></div>
          <div id="uie-map-home-perks" class="uie-simple-map__home-perks"></div>
          <button type="button" id="uie-map-set-home" class="uie-simple-map__secondary uie-simple-map__home-action">Make This Home</button>
        </div>
        <div class="uie-simple-map__card">
          <div class="uie-simple-map__eyebrow">Travel</div>
          <div id="uie-map-travel-cost" class="uie-simple-map__travel-cost">Select a destination to calculate travel.</div>
          <button type="button" id="uie-map-confirm-travel" class="uie-simple-map__primary">Move To Area</button>
          <button type="button" class="uie-simple-map__secondary" data-map-action="blueprint">Open Area</button>
        </div>
        <div class="uie-simple-map__card">
          <div class="uie-simple-map__eyebrow">Entity Tracker</div>
          <div id="uie-map-entities" class="uie-simple-map__entities"></div>
        </div>
      </aside>
    </main>
  </div>
</div>
<div id="uie-map-scan-modal" class="uie-map-modal" hidden aria-hidden="true">
  <div class="uie-map-modal__panel">
    <div class="uie-map-modal__top">
      <div><div class="uie-simple-map__eyebrow">Chat Scan</div><h3>Add Place From Chat</h3></div>
      <button type="button" data-map-modal-close class="uie-simple-map__close" aria-label="Close scan">x</button>
    </div>
    <div class="uie-map-gen-grid">
      <label style="grid-column:span 2;">Detected Place
        <select id="uie-map-scan-place"></select>
      </label>
      <label>Layer
        <select id="uie-map-scan-layer"><option value="area">Local</option><option value="vicinity">Nearby</option><option value="region">Region</option><option value="world">World</option></select>
      </label>
      <label>Connect Near
        <select id="uie-map-scan-anchor"></select>
      </label>
    </div>
    <div id="uie-map-scan-empty" class="uie-map-modal__hint">Scanning recent chat for concrete places.</div>
    <div class="uie-map-modal__actions"><button type="button" id="uie-map-scan-add" class="uie-simple-map__primary">Add Selected Place</button></div>
  </div>
</div>
<div id="worldgen-modal" class="uie-map-modal" hidden aria-hidden="true">
  <div class="uie-map-modal__panel is-wide">
    <div class="uie-map-modal__top">
      <div><div class="uie-simple-map__eyebrow">Cartographer</div><h3>Generate World Map</h3></div>
      <button type="button" id="wg-cancel" class="uie-simple-map__close" aria-label="Close generator">x</button>
    </div>
    <div class="uie-map-gen-tabs" role="tablist" aria-label="Generator options">
      <button type="button" class="uie-map-gen-tab is-active" data-wg-pane-target="atlas">Atlas</button>
      <button type="button" class="uie-map-gen-tab" data-wg-pane-target="focused">Focused DOMs</button>
    </div>
    <div class="uie-map-gen-pane is-active" data-wg-pane="atlas">
      <div class="uie-map-gen-grid">
        <label>Layer
          <select id="wg-scope">
            <option value="world">World / Planet Atlas</option>
            <option value="region">Regional Node Map</option>
            <option value="area" selected>Complete Local Atlas</option>
            <option value="blueprint">Enclosed Physical Blueprint</option>
          </select>
        </label>
        <label>Mode
          <select id="wg-mode">
            <option value="hybrid" selected>AI + Engine Math</option>
            <option value="ai">AI Names / Lore</option>
            <option value="procedural">Engine Procedural</option>
          </select>
        </label>
        <label>Seed Name
          <input id="wg-location" type="text" value="Current Setting" placeholder="Neon megacity, frontier village, orbital habitat">
        </label>
        <label id="wg-count-worlds-wrapper">Worlds
          <input id="wg-count-worlds" type="number" min="1" max="8" value="2">
        </label>
        <label id="wg-count-regions-wrapper">Regions
          <input id="wg-count-regions" type="number" min="1" max="24" value="6">
        </label>
        <label id="wg-count-settlements-wrapper">Cities / Towns
          <input id="wg-count-settlements" type="number" min="0" max="48" value="4">
        </label>
        <label id="wg-count-places-wrapper">Locations
          <input id="wg-count-places" type="number" min="1" max="120" value="14">
        </label>
        <label>Detailed Layouts
          <select id="wg-blueprint-mode">
            <option value="sites" selected>Exploration sites only</option>
            <option value="none">Do not generate layouts</option>
            <option value="all">All enclosed locations</option>
          </select>
        </label>
        <label id="wg-count-rooms-wrapper">Locations Per Detailed Site
          <input id="wg-count-rooms" type="number" min="1" max="40" value="9">
        </label>
      </div>
      <div id="wg-scope-hint" class="uie-map-modal__hint">Builds a map using AI lore while the engine owns DAG/BSP topology.</div>
      <textarea id="wg-prompt" class="uie-map-modal__textarea" placeholder="Describe the genre, era, culture, geography, traversal, location types, transit rules, and anything that should never appear."></textarea>
    </div>
    <div class="uie-map-gen-pane" data-wg-pane="focused" hidden>
      <div class="uie-map-gen-grid">
        <label>Focused DOMs
          <select id="wg-focused-enabled">
            <option value="off" selected>Off</option>
            <option value="on">On</option>
          </select>
        </label>
        <label>Main Job Preset
          <select id="wg-focused-job">
            <option value="none" selected>None</option>
            <option value="school">Student / School</option>
            <option value="service">Service / Cafe</option>
            <option value="retail">Retail / Shop</option>
            <option value="office">Office / Agency</option>
            <option value="clinic">Clinic / Care</option>
            <option value="craft">Guild / Craft</option>
            <option value="performance">Performance / Studio</option>
          </select>
        </label>
        <label>Task Windows
          <select id="wg-focused-tasks">
            <option value="on" selected>On when time applies</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label style="grid-column:1/-1;">Focus Subjects
          <textarea id="wg-focused-subjects" placeholder="school, cafe job, guild hall, family estate, faction HQ"></textarea>
        </label>
      </div>
      <div class="uie-map-modal__hint">Focused DOMs create dedicated systems, modals, and task windows for the spaces or roles the run should prioritize.</div>
    </div>
    <div class="uie-map-modal__actions">
      <button type="button" id="wg-generate" class="uie-simple-map__primary">Generate Map</button>
    </div>
  </div>
</div>
<div id="uie-map-location-modal" class="uie-map-modal" hidden aria-hidden="true">
  <div class="uie-map-modal__panel">
    <div class="uie-map-modal__top">
      <div><div class="uie-simple-map__eyebrow">Manual Cartography</div><h3>Add Location</h3></div>
      <button type="button" data-map-modal-close class="uie-simple-map__close" aria-label="Close add location">x</button>
    </div>
    <div class="uie-map-gen-grid">
      <label>Name<input id="uie-map-add-name" type="text" placeholder="Glass Harbor"></label>
      <label>Layer<select id="uie-map-add-layer"><option value="world">World</option><option value="region">Region</option><option value="area" selected>Local</option><option value="vicinity">Nearby</option></select></label>
      <label>Type<input id="uie-map-add-type" type="text" placeholder="district, building, trail, station"></label>
      <label>Organization<input id="uie-map-add-faction" type="text" placeholder="RTA Controlled"></label>
      <label>Theme<input id="uie-map-add-theme" type="text" placeholder="Industrial Slum"></label>
      <label>Laws<input id="uie-map-add-laws" type="text" placeholder="Curfew, Drone patrols, No open magic"></label>
      <label>Reputation<input id="uie-map-add-reputation" type="text" placeholder="Neutral, wanted, trusted, watched"></label>
      <label>Assets<input id="uie-map-add-assets" type="text" placeholder="Safehouse, cameras, vehicles, treasury"></label>
      <label>NPCs<input id="uie-map-add-npcs" type="text" placeholder="Leader, guards, informants, staff"></label>
    </div>
    <textarea id="uie-map-add-desc" class="uie-map-modal__textarea" placeholder="What makes this place interesting? What can the player do here?"></textarea>
    <div class="uie-map-modal__actions"><button type="button" id="uie-map-add-save" class="uie-simple-map__primary">Add To Map</button></div>
  </div>
</div>
<div id="uie-map-import-modal" class="uie-map-modal" hidden aria-hidden="true">
  <div class="uie-map-modal__panel">
    <div class="uie-map-modal__top">
      <div><div class="uie-simple-map__eyebrow">Map Exchange</div><h3>Import Map JSON</h3></div>
      <button type="button" data-map-modal-close class="uie-simple-map__close" aria-label="Close import">x</button>
    </div>
    <textarea id="uie-map-import-json" class="uie-map-modal__textarea" placeholder="Paste exported or shared map JSON here."></textarea>
    <div class="uie-map-modal__actions"><button type="button" id="uie-map-import-apply" class="uie-simple-map__primary">Import Map</button></div>
  </div>
</div>
<div id="uie-rune-lock" class="uie-rune-lock" hidden aria-hidden="true">
  <div class="uie-rune-lock__panel">
    <div class="uie-rune-lock__top">
      <div>
        <div class="uie-simple-map__eyebrow">Rune Lock</div>
        <h3 id="uie-rune-lock-title">Trace Access Key</h3>
      </div>
      <button type="button" id="uie-rune-lock-close" class="uie-simple-map__close" aria-label="Close rune lock">x</button>
    </div>
    <div id="uie-rune-lock-board" class="uie-rune-lock__board"></div>
    <div id="uie-rune-lock-status" class="uie-rune-lock__status">Start on the first lit node and trace the pattern.</div>
  </div>
</div>`;
}

export async function initMap() {
    loadState();
    await ensureMounted();
    connectBackendMapStream();
    if (!initialized) {
        initialized = true;
        bindEvents();
    }
    renderMap();
}

export async function openMap() {
    $("#uie-card-editor, #uie-card-manager").remove();
    await initMap();
    const mapEl = $("#uie-map-window");
    if (mapEl.length) {
        mapEl.appendTo("body");
    }
    const active = document.activeElement;
    if (active && !document.getElementById("uie-map-window")?.contains(active)) mapReturnFocus = active;
    $(".uie-window").not("#uie-map-window").each(function() {
        blurFocusInside(this);
        $(this).hide();
    });
    $("#uie-map-window")
        .prop("inert", false)
        .attr("aria-hidden", "false")
        .css({ display: "flex", opacity: 1, visibility: "visible", zIndex: 2147483600 });
    renderMap();
}

export function closeMap() {
    const map = document.getElementById("uie-map-window");
    if (!map) return;
    if (map.contains(document.activeElement)) document.activeElement?.blur?.();
    map.inert = true;
    map.setAttribute("aria-hidden", "true");
    $(map).hide();
    if (mapReturnFocus?.isConnected && typeof mapReturnFocus.focus === "function") mapReturnFocus.focus();
    mapReturnFocus = null;
}

function bindEvents() {
    $(document)
        .off(".uieSimpleMap")
        .on("click.uieSimpleMap", "#uie-map-close", (event) => {
            event.preventDefault();
            closeMap();
        })
        .on("click.uieSimpleMap", "[data-map-view]", function (event) {
            event.preventDefault();
            pendingNavigationTarget = "";
            hideNavigationPopup();
            const nextView = String($(this).data("map-view"));
            if (state.view === "area" && selected?.name) state.activeLocalName = selected.name;
            if (nextView === "vicinity") activateVicinityForLocal(state.activeLocalName || currentLocationName());
            if (nextView === "blueprint") {
                const local = getNodeByName(state.activeLocalName || selected?.name || currentLocationName());
                if (!local?.blueprintId) {
                    notify?.("info", `${local?.name || "This location"} has no generated detailed layout.`, "Map");
                    return;
                }
                syncBlueprintForLocation(local.blueprintId || local.name);
            }
            state.view = nextView;
            selected = null;
            state.selectedId = "";
            persist();
            renderMap();
        })
        .on("change.uieSimpleMap", "#uie-map-style", function () {
            state.mapStyle = ["high-fantasy", "modern", "futuristic"].includes(String(this.value)) ? String(this.value) : "modern";
            persist();
            renderMap();
        })
        .on("click.uieSimpleMap", "[data-map-node]", async function (event) {
            event.preventDefault();
            const nextSelected = findNodeById(String($(this).data("map-node")));
            const nextId = String(nextSelected?.id || "");
            const shouldNavigate = nextId && pendingNavigationTarget === nextId;
            selected = nextSelected;
            state.selectedId = selected?.id || "";
            if (selected?.view === "area" && selected?.name) {
                state.activeLocalName = selected.name;
                activateVicinityForLocal(selected.name);
            }
            if (selected?.blueprintId) syncBlueprintForLocation(selected.blueprintId || selected.name);
            persist();
            applyConstraint(selected);
            if (shouldNavigate) {
                pendingNavigationTarget = "";
                hideNavigationPopup();
                await travelToSelected();
                return;
            }
            pendingNavigationTarget = nextId;
            renderMap();
            showNavigationPopup(selected, event);
        })
        .on("click.uieSimpleMap", "[data-map-zoom]", function (event) {
            event.preventDefault();
            updateMapZoom(String($(this).data("map-zoom") || "reset"));
        })
        .on("wheel.uieSimpleMap", ".uie-simple-map__canvas", function (event) {
            if (event.cancelable !== false && event.originalEvent?.cancelable !== false) event.preventDefault();
            if (state?.manualPlacing) return;
            zoomMapAt(this, Number(event.originalEvent?.deltaY || event.deltaY || 0) < 0 ? 1 : -1, event.clientX, event.clientY);
        })
        .on("pointerdown.uieSimpleMap", ".uie-simple-map__canvas", function (event) {
            if (state?.manualPlacing) return;
            if ($(event.target).closest("button,.uie-simple-map__panel").length) return;
            activeMapPointers.set(event.originalEvent?.pointerId ?? event.pointerId, { x: event.clientX, y: event.clientY });
            if (activeMapPointers.size >= 2) {
                const points = Array.from(activeMapPointers.values()).slice(0, 2);
                const viewport = ensureViewport();
                mapPinchStart = {
                    distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) || 1,
                    scale: viewport.scale,
                    x: viewport.x,
                    y: viewport.y,
                    centerX: (points[0].x + points[1].x) / 2,
                    centerY: (points[0].y + points[1].y) / 2,
                };
                mapPan = null;
                return;
            }
            const viewport = ensureViewport();
            mapPan = { pointerId: event.originalEvent?.pointerId, startX: event.clientX, startY: event.clientY, x: viewport.x, y: viewport.y };
            this.setPointerCapture?.(mapPan.pointerId);
            $(this).addClass("is-panning");
        })
        .on("click.uieSimpleMap", ".uie-simple-map__canvas", async function (event) {
            if (!state?.manualPlacing || $(event.target).closest("[data-map-node],button,.uie-simple-map__panel,.uie-simple-map__minimap").length) return;
            event.preventDefault();
            const rect = this.getBoundingClientRect();
            const viewport = ensureViewport();
            const x = ((event.clientX - rect.left - viewport.x) / Math.max(0.2, viewport.scale)) / rect.width * 100;
            const y = ((event.clientY - rect.top - viewport.y) / Math.max(0.2, viewport.scale)) / rect.height * 100;
            manualLandmarkPoint = {
                x: Math.max(6, Math.min(94, x)),
                y: Math.max(8, Math.min(92, y)),
            };
            const isFree = state.freePlacing;
            state.manualPlacing = false;
            state.freePlacing = false;
            persist();
            $("#uie-map-window").removeClass("is-placing-landmark");
            await openAddLocationModal({
                layer: state.view === "blueprint" ? "vicinity" : state.view,
                type: isFree ? "home" : inferManualLocationType(`${state.view} landmark`),
                name: isFree ? "My New Place" : ""
            });
        })
        .on("pointermove.uieSimpleMap", ".uie-simple-map__canvas", function (event) {
            const pointerId = event.originalEvent?.pointerId ?? event.pointerId;
            if (activeMapPointers.has(pointerId)) activeMapPointers.set(pointerId, { x: event.clientX, y: event.clientY });
            if (mapPinchStart && activeMapPointers.size >= 2) {
                event.preventDefault();
                const points = Array.from(activeMapPointers.values()).slice(0, 2);
                const dist = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) || 1;
                const viewport = ensureViewport();
                const nextScale = Math.max(.65, Math.min(2.5, mapPinchStart.scale * (dist / mapPinchStart.distance)));
                zoomMapTo(this, nextScale, (points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2);
                return;
            }
            if (!mapPan) return;
            const viewport = ensureViewport();
            viewport.x = mapPan.x + event.clientX - mapPan.startX;
            viewport.y = mapPan.y + event.clientY - mapPan.startY;
            applyViewport();
        })
        .on("pointerup.uieSimpleMap pointercancel.uieSimpleMap", ".uie-simple-map__canvas", function (event) {
            activeMapPointers.delete(event.originalEvent?.pointerId ?? event.pointerId);
            if (activeMapPointers.size < 2) mapPinchStart = null;
            if (!mapPan) return;
            mapPan = null;
            $(this).removeClass("is-panning");
            persist();
        })
        .on("pointerenter.uieSimpleMap focusin.uieSimpleMap", "[data-map-node]", function (event) {
            showNodeTooltip(this, event);
        })
        .on("pointermove.uieSimpleMap", "[data-map-node]", function (event) {
            positionNodeTooltip(event);
        })
        .on("pointerleave.uieSimpleMap focusout.uieSimpleMap", "[data-map-node]", () => {
            hideNodeTooltip();
        })
        .on("click.uieSimpleMap", "#uie-map-confirm-travel", async (event) => {
            event.preventDefault();
            pendingNavigationTarget = "";
            hideNavigationPopup();
            await travelToSelected();
        })
        .on("click.uieSimpleMap", "#uie-map-navigation-move", async (event) => {
            event.preventDefault();
            pendingNavigationTarget = "";
            hideNavigationPopup();
            await travelToSelected();
        })
        .on("click.uieSimpleMap", "[data-map-exit-dir]", async function (event) {
            event.preventDefault();
            await enterExit(String($(this).data("map-exit-dir") || ""));
        })
        .on("click.uieSimpleMap", "[data-map-action]", async function (event) {
            event.preventDefault();
            await handleMapAction(String($(this).data("map-action") || ""));
        })
        .on("click.uieSimpleMap", "[data-map-modal-close]", (event) => {
            event.preventDefault();
            closeMapModals();
        })
        .on("click.uieSimpleMap", "#uie-map-add-save", (event) => {
            event.preventDefault();
            addManualLocation();
        })
        .on("click.uieSimpleMap", "#uie-map-set-home", async (event) => {
            event.preventDefault();
            if (selected) {
                const { setPrimaryHome } = await import("./taxJailManager.js");
                setPrimaryHome(selected.id, selected.name, homeDetailsForNode(selected));
                renderDetails();
                renderMap();
            }
        })
        .on("click.uieSimpleMap", "#uie-map-import-apply", (event) => {
            event.preventDefault();
            importMapJson();
        })
        .on("click.uieSimpleMap", "#uie-map-scan-add", (event) => {
            event.preventDefault();
            addScannedLocation();
        })
        .on("click.uieSimpleMap", "[data-wg-pane-target]", function (event) {
            event.preventDefault();
            const pane = String($(this).data("wg-pane-target") || "atlas");
            $(".uie-map-gen-tab").removeClass("is-active");
            $(this).addClass("is-active");
            $(".uie-map-gen-pane").removeClass("is-active").prop("hidden", true);
            $(`.uie-map-gen-pane[data-wg-pane="${pane}"]`).addClass("is-active").prop("hidden", false);
        })
        .on("change.uieSimpleMap", "#wg-scope", () => {
            syncMapGeneratorHint();
        })
        .on("click.uieSimpleMap", "#wg-cancel", (event) => {
            event.preventDefault();
            closeMapModals();
        })
        .on("click.uieSimpleMap", "#wg-generate", async (event) => {
            event.preventDefault();
            await runMapGeneratorFromModal();
        })
        .on("click.uieSimpleMap", "#uie-rune-lock-close", (event) => {
            event.preventDefault();
            closeRuneLock();
        });
}

function backendPlacesSnapshot(s = getSettings()) {
    const nodes = s?.worldState?.mapNodes && typeof s.worldState.mapNodes === "object" ? s.worldState.mapNodes : {};
    return Object.values(nodes).map((node) => ({
        id: node.id || node.name,
        name: node.name,
        layer: node.blueprintParent ? "blueprint" : "local",
        parent: node.blueprintParent || node.parent || "",
        x: Number(node.coords?.x ?? node.x ?? 0.5),
        y: Number(node.coords?.y ?? node.y ?? 0.5),
        z: Number(node.coords?.z ?? node.z ?? 0),
        tags: [node.type, node.theme, node.district].filter(Boolean),
        exits: node.exits || s.worldState?.navGraph?.[node.name] || {},
        description: node.description || node.desc || "",
        payload: node,
    })).filter((place) => String(place.name || "").trim());
}

function backendAssetsSnapshot(s = getSettings()) {
    return ownedAssets().map((asset) => ({
        name: assetDisplayName(asset),
        title: asset.title || "",
        type: asset.type || asset.category || "",
        travelCategory: asset.travelCategory || "",
        location: asset.location || "",
        active: String(s?.worldState?.activeVehicle?.name || "").toLowerCase() === assetDisplayName(asset).toLowerCase(),
    }));
}

function syncBackendMapRepository(reason = "map_sync") {
    const s = getSettings();
    const places = backendPlacesSnapshot(s);
    if (!places.length) return;
    syncMap({ places, current_location: currentLocationName(), reason }, { required: false, timeoutMs: 1200 }).catch(() => {});
}

async function resolveBackendAssetUrl(asset) {
    const url = String(asset?.urlAbsolute || asset?.url || "").trim();
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    return await buildBackendUrl(url, { required: false, timeoutMs: 900 }).catch(() => url);
}

function connectBackendMapStream() {
    if (backendMapSocketStarted) return;
    backendMapSocketStarted = true;
    createBackendWebSocket({
        required: false,
        timeoutMs: 900,
        onMessage: async (message) => {
            if (message?.type === "state_update") {
                const payload = message.payload || {};
                const s = getSettings();
                if (!s.uiState) s.uiState = {};
                Object.assign(s.uiState, payload);
                if (payload.hp !== undefined) s.hp = payload.hp;
                if (payload.mp !== undefined) s.mp = payload.mp;
                if (payload.ap !== undefined) s.ap = payload.ap;
                if (payload.stamina !== undefined) s.stamina = payload.stamina;
                saveSettings();
                try { window.dispatchEvent(new CustomEvent("uie:state_updated", { detail: payload })); } catch (_) {}
                try {
                    const phoneMod = window.UIE_PHONE || window.UIE?.phone;
                    if (phoneMod && typeof phoneMod.render === "function") phoneMod.render();
                } catch (_) {}
                return;
            }
            if (message?.type === "social_post" || message?.type === "social_comment") {
                try {
                    window.dispatchEvent(new CustomEvent("uie:social_updated", { detail: message }));
                    const phoneMod = window.UIE_PHONE || window.UIE?.phone;
                    if (phoneMod && typeof phoneMod.render === "function") phoneMod.render();
                } catch (_) {}
                return;
            }
            if (message?.type === "dynamic_action") {
                showBackendDynamicAction(message.payload || {});
                return;
            }
            if (message?.type === "layout_updated") {
                const payload = message.payload || {};
                const name = String(payload.location || "").trim();
                if (!name || !payload.environmentState) return;
                const s = getSettings();
                if (!s.worldState?.mapNodes?.[name]) return;
                s.worldState.mapNodes[name].environmentState = payload.environmentState;
                saveSettings();
                try { window.dispatchEvent(new CustomEvent("uie:environment_layout", { detail: payload })); } catch (_) {}
                renderDetails();
                return;
            }
            if (message?.type === "asset_image_ready") {
                const asset = message.payload || {};
                try {
                    window.dispatchEvent(new CustomEvent("uie:backend_asset_image_ready", { detail: asset }));
                } catch (_) {}
                const location = String(asset.location || "").trim();
                if (!location) return;
                asset.urlAbsolute = await resolveBackendAssetUrl(asset);
                const url = applyLocationAsset(location, asset, getNodeByName(location) || {}, { kind: asset.kind || "background" });
                if (url && String(asset.kind || "").toLowerCase() === "background" && location.toLowerCase() === currentLocationName().toLowerCase()) {
                    setStageBackground(url);
                }
            }
        },
        onClose: () => {
            backendMapSocket = null;
            backendMapSocketStarted = false;
            setTimeout(connectBackendMapStream, 3000);
        },
    }).then((socket) => {
        backendMapSocket = socket;
    }).catch(() => {
        backendMapSocketStarted = false;
    });
}

function showBackendDynamicAction(action = {}) {
    const kind = String(action.kind || "").trim();
    const target = String(action.target || action.asset || "").trim();
    if (!kind || !target) return;
    document.getElementById("uie-backend-action-popup")?.remove?.();
    const popup = document.createElement("div");
    popup.id = "uie-backend-action-popup";
    popup.className = "uie-location-discovery";
    popup.style.zIndex = "2147483602";
    const icon = kind.includes("asset") ? "fa-car-side" : "fa-route";
    const label = String(action.button || action.label || (kind.includes("asset") ? "Board Asset" : "Cross Threshold")).trim();
    popup.innerHTML = `
        <div class="uie-location-discovery__icon" aria-hidden="true"><i class="fa-solid ${esc(icon)}"></i></div>
        <div class="uie-location-discovery__copy">
            <strong>${esc(target)}</strong>
            <span>${esc(action.label || label)}</span>
        </div>
        <button type="button" data-backend-action-run>${esc(label)}</button>
        <button type="button" data-backend-action-dismiss title="Dismiss">x</button>
    `;
    popup.querySelector("[data-backend-action-run]").onclick = async () => {
        popup.remove();
        await runBackendDynamicAction(action);
    };
    popup.querySelector("[data-backend-action-dismiss]").onclick = () => popup.remove();
    document.body.appendChild(popup);
    setTimeout(() => popup.remove(), 9000);
}

async function runBackendDynamicAction(action = {}) {
    const kind = String(action.kind || "").trim();
    if (kind === "board_asset") return await boardTravelAsset(action.asset || action.target);
    if (kind === "asset_navigation") return await moveToTravelAsset(action.asset || action.target);
    if (kind === "location_travel" || kind === "location_exit") {
        return await travelToLocationName(action.target, {
            reason: "Backend topology action",
            source: "fastapi_dynamic_action",
            dir: action.direction || "",
            useActiveVehicle: false,
        });
    }
    return false;
}

async function backendMovementIntercept(userText) {
    const s = getSettings();
    try {
        const result = await backendJson("/map/intercept", {
            method: "POST",
            required: false,
            timeoutMs: 900,
            json: {
                text: String(userText || ""),
                current_location: currentLocationName(),
                nav_graph: s.worldState?.navGraph || {},
                places: backendPlacesSnapshot(s),
                assets: backendAssetsSnapshot(s),
                world_state: {
                    weather: s.worldState?.weatherLabel || s.worldState?.weather || "Clear",
                    activeVehicle: s.worldState?.activeVehicle || null,
                },
            },
        });
        const action = result?.action;
        if (action) showBackendDynamicAction(action);
        return action || null;
    } catch (_) {
        return null;
    }
}

async function syncBackendLayoutForLocation(name, node = {}, travelEffects = null) {
    const s = getSettings();
    try {
        const result = await backendJson("/map/layout", {
            method: "POST",
            required: false,
            timeoutMs: 1200,
            json: {
                location: name,
                node: {
                    ...(node || {}),
                    name,
                    exits: s.worldState?.navGraph?.[name] || node?.exits || {},
                },
                nav_graph: s.worldState?.navGraph || {},
                weather: s.worldState?.weatherLabel || s.worldState?.weather || travelEffects?.weather?.label || "Clear",
                time_of_day: s.worldState?.time || "",
                global_state: {
                    locationPath: s.worldState?.locationPath || "",
                    activeVehicle: s.worldState?.activeVehicle || null,
                },
            },
        });
        const environmentState = result?.environmentState;
        if (environmentState) {
            if (!s.worldState.mapNodes[name]) s.worldState.mapNodes[name] = { ...(node || {}), name };
            s.worldState.mapNodes[name].environmentState = environmentState;
            saveSettings();
            try { window.dispatchEvent(new CustomEvent("uie:environment_layout", { detail: { location: name, environmentState } })); } catch (_) {}
            renderDetails();
        }
        return result;
    } catch (_) {
        return null;
    }
}

function openSpatialDepth(nextView) {
    if (nextView === "vicinity") activateVicinityForLocal(state.activeLocalName || selected?.name || currentLocationName());
    if (nextView === "blueprint") {
        const local = getNodeByName(state.activeLocalName || selected?.name || currentLocationName());
        if (!local?.blueprintId) return false;
        syncBlueprintForLocation(local.blueprintId || local.name);
    }
    state.view = nextView;
    selected = null;
    state.selectedId = "";
    persist();
    renderMap();
    return true;
}

function ensureViewport() {
    if (!state.viewport || typeof state.viewport !== "object") state.viewport = { scale: 1, x: 0, y: 0 };
    state.viewport.scale = Math.max(.65, Math.min(2.5, Number(state.viewport.scale || 1)));
    state.viewport.x = Number(state.viewport.x || 0);
    state.viewport.y = Number(state.viewport.y || 0);
    return state.viewport;
}

function updateMapZoom(action) {
    const viewport = ensureViewport();
    if (action === "reset") Object.assign(viewport, { scale: 1, x: 0, y: 0 });
    else viewport.scale = Math.max(.65, Math.min(2.5, viewport.scale + (action === "in" ? .15 : -.15)));
    persist();
    applyViewport();
}

function zoomMapTo(canvas, nextScale, clientX, clientY) {
    const viewport = ensureViewport();
    const rect = canvas?.getBoundingClientRect?.();
    if (!rect) {
        viewport.scale = nextScale;
        applyViewport();
        return;
    }
    const oldScale = Math.max(0.2, viewport.scale);
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const worldX = (x - viewport.x) / oldScale;
    const worldY = (y - viewport.y) / oldScale;
    viewport.scale = Math.max(.65, Math.min(2.5, Number(nextScale) || 1));
    viewport.x = x - worldX * viewport.scale;
    viewport.y = y - worldY * viewport.scale;
    applyViewport();
}

function zoomMapAt(canvas, direction, clientX, clientY) {
    const viewport = ensureViewport();
    const step = Number(direction || 0) > 0 ? 1.12 : 1 / 1.12;
    zoomMapTo(canvas, viewport.scale * step, clientX, clientY);
    persist();
}

function applyViewport() {
    const viewport = ensureViewport();
    const transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
    $("#uie-map-links,#uie-map-nodes,#uie-map-blueprint").css({ transform, transformOrigin: "50% 50%" });
}

function nodeTooltipHtml(node) {
    if (!node) return "";
    const children = childSummaryFor(node);
    return `
        <div class="uie-map-tip__tier">${esc(VIEW_LABELS[node.view || state.view] || titleCase(node.view || state.view))}</div>
        <strong>${esc(node.name || "Unknown")}</strong>
        <p>${esc(cleanMapDescription(node))}</p>
        ${children ? `<div class="uie-map-tip__children">${esc(children)}</div>` : ""}
    `;
}

function personImage(person = {}) {
    return String(person.avatar || person.image || person.img || person.portrait || person.sprite || person.cardImage || person.profileImage || person.icon || "").trim();
}

function mapEntityPortraitsForNode(node = {}) {
    const s = getSettings();
    const loc = String(node.name || "").trim().toLowerCase();
    if (!loc) return [];
    const out = [];
    const push = (kind, person, fallbackName = "") => {
        const name = String(person?.name || person?.label || fallbackName || "").trim();
        if (!name) return;
        const img = personImage(person);
        const at = String(person?.location || person?.currentLocation || person?.mapLocation || "").trim().toLowerCase();
        if (at && at !== loc) return;
        out.push({ kind, name, img });
    };
    if (String(s.worldState?.location || "").trim().toLowerCase() === loc) push("player", s.character || {}, s.character?.name || "You");
    for (const member of Array.isArray(s.party?.members) ? s.party.members : []) {
        if (typeof member === "string") {
            if (loc === String(s.worldState?.location || "").trim().toLowerCase()) out.push({ kind: "party", name: member, img: "" });
        } else {
            push("party", member);
        }
    }
    for (const list of Object.values(s.social || {})) {
        if (!Array.isArray(list)) continue;
        for (const person of list) push("social", person);
    }
    const seen = new Set();
    return out.filter((entry) => {
        const key = `${entry.kind}:${entry.name}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, 5);
}

function renderMapEntityPortraits(node = {}) {
    const entries = mapEntityPortraitsForNode(node);
    if (!entries.length) return "";
    return `<span class="uie-simple-map__avatars">${entries.map((entry) => entry.img
        ? `<img src="${esc(entry.img)}" title="${esc(entry.name)}" alt="${esc(entry.name)}">`
        : `<span class="uie-simple-map__avatar-initial is-${esc(entry.kind)}" title="${esc(entry.name)}">${esc(entry.name.slice(0, 1).toUpperCase())}</span>`
    ).join("")}</span>`;
}

function childSummaryFor(node) {
    const view = node?.view || state?.view;
    if (view === "world") return `${state.region?.length || 0} provinces and ${state.area?.length || 0} places to visit`;
    if (view === "region") return `${state.area?.filter((area) => !node?.name || area.district === node.name).length || state.area?.length || 0} places to visit`;
    if (view === "area") return `${vicinityForLocal(node?.name).length} nearby paths`;
    if (view === "vicinity") return "Close enough to visit now";
    if (view === "blueprint") return "A room within this place";
    return "";
}

function showNodeTooltip(el, event) {
    const node = findNodeById(String($(el).data("map-node") || ""));
    const html = nodeTooltipHtml(node);
    if (!html) return;
    $("#map-hover-tooltip").html(html).prop("hidden", false);
    positionNodeTooltip(event);
}

function positionNodeTooltip(event) {
    const tip = document.getElementById("map-hover-tooltip");
    const canvas = document.querySelector(".uie-simple-map__canvas");
    if (!tip || !canvas || tip.hidden || !event) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(rect.width - 280, Math.max(12, event.clientX - rect.left + 16));
    const y = Math.min(rect.height - 220, Math.max(12, event.clientY - rect.top + 16));
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
}

function hideNodeTooltip() {
    $("#map-hover-tooltip").prop("hidden", true).empty();
}

function navigationActionLabel(node) {
    if (node?.view === "world") return "Open Regions";
    if (node?.view === "region") return "Open Local Map";
    return "Move Here";
}

function showNavigationPopup(node, event) {
    if (!node) return;
    const planned = nodeDiscoveryState(node) === "planned" && (node.view === "area" || node.view === "vicinity");
    const name = planned ? `Unknown ${titleCase(node.type || "Location")}` : node.name || "Selected Location";
    const layer = VIEW_LABELS[node.view || state?.view] || titleCase(node.view || state?.view || "map");
    const action = navigationActionLabel(node);
    const $popup = $("#uie-map-navigation-popup");
    if (!$popup.length) return;
    $popup.html(`
        <div class="uie-simple-map__navigation-title">Destination Selected</div>
        <strong>${esc(name)}</strong>
        <span>${esc(layer)} navigation. Press this location again to move.</span>
        <button type="button" id="uie-map-navigation-move">${esc(action)}</button>
    `).prop("hidden", false);
    positionNavigationPopup(event);
}

function positionNavigationPopup(event) {
    const popup = document.getElementById("uie-map-navigation-popup");
    const canvas = document.querySelector(".uie-simple-map__canvas");
    if (!popup || !canvas || popup.hidden || !event) return;
    const rect = canvas.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const width = popupRect.width || 280;
    const height = popupRect.height || 130;
    
    // Calculate position relative to canvas
    let x = event.clientX - rect.left + 18;
    let y = event.clientY - rect.top + 18;
    
    // Ensure popup stays within canvas bounds
    const maxX = rect.width - width - 12;
    const maxY = rect.height - height - 12;
    
    x = Math.min(maxX, Math.max(12, x));
    y = Math.min(maxY, Math.max(12, y));
    
    // Additional viewport check - ensure popup is visible in viewport
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const absoluteX = rect.left + x;
    const absoluteY = rect.top + y;
    
    // If popup would go off right edge of viewport, adjust
    if (absoluteX + width > viewportWidth - 12) {
        x = viewportWidth - rect.left - width - 12;
    }
    
    // If popup would go off bottom edge of viewport, adjust
    if (absoluteY + height > viewportHeight - 12) {
        y = viewportHeight - rect.top - height - 12;
    }
    
    // Ensure we don't go negative
    x = Math.max(12, x);
    y = Math.max(12, y);
    
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;
}

function hideNavigationPopup() {
    $("#uie-map-navigation-popup").prop("hidden", true).empty();
}

function closeMapModals() {
    $(".uie-map-modal").each(function() {
        blurFocusInside(this);
        $(this).prop("hidden", true).attr("aria-hidden", "true");
    });
}

function openMapModal(id) {
    closeMapModals();
    $(`#${id}`).prop("hidden", false).attr("aria-hidden", "false").css("display", "grid");
    if (id === "worldgen-modal") syncMapGeneratorHint();
}

function inferManualLocationLayer(text = "") {
    const raw = String(text || "").toLowerCase();
    if (/\b(world|planet|realm|plane|continent)\b/.test(raw)) return "world";
    if (/\b(region|province|kingdom|state|county|territory)\b/.test(raw)) return "region";
    if (/\b(room|office|hall|shop|apartment|house|building|floor|basement|nearby|vicinity)\b/.test(raw)) return "vicinity";
    return "area";
}

function inferManualLocationType(text = "") {
    const raw = String(text || "").toLowerCase();
    if (/\b(world|planet|realm|plane)\b/.test(raw)) return "world";
    if (/\b(region|province|kingdom|state|territory)\b/.test(raw)) return "region";
    if (/\b(city|town|village|district|harbor|market|campus)\b/.test(raw)) return "city";
    if (/\b(room|office|hall|shop|apartment|house|building|tower|base|safehouse)\b/.test(raw)) return "building";
    return "place";
}

function locationPlanningText(name = "", prefill = {}) {
    const faction = String(prefill.faction || "").trim();
    const influence = String(prefill.influence || prefill.theme || "").trim();
    return [
        `${name || "This location"} is being added from faction influence planning.`,
        faction ? `Organization: ${faction}.` : "",
        influence ? `Influence scale: ${influence}.` : "",
        "Decide where it belongs on the atlas, how it connects to existing routes, whether it needs location assets, and which NPCs operate here."
    ].filter(Boolean).join(" ");
}

export async function openAddLocationModal(prefill = {}) {
    await openMap();
    openMapModal("uie-map-location-modal");
    const placeName = String(prefill.name || prefill.location || "").trim();
    const type = String(prefill.type || prefill.kind || inferManualLocationType(placeName)).trim();
    const layer = String(prefill.layer || inferManualLocationLayer(`${type} ${placeName}`)).trim();
    $("#uie-map-add-name").val(placeName);
    $("#uie-map-add-layer").val(["world", "region", "area", "vicinity"].includes(layer) ? layer : "area");
    $("#uie-map-add-type").val(type);
    $("#uie-map-add-faction").val(String(prefill.faction || "").trim());
    $("#uie-map-add-theme").val(String(prefill.theme || prefill.influence || "").trim());
    $("#uie-map-add-laws").val(Array.isArray(prefill.laws) ? prefill.laws.join(", ") : String(prefill.laws || "").trim());
    $("#uie-map-add-reputation").val(Array.isArray(prefill.reputation) ? prefill.reputation.join(", ") : String(prefill.reputation || "").trim());
    $("#uie-map-add-access").val(Array.isArray(prefill.accessModes) ? prefill.accessModes.join(", ") : String(prefill.accessModes || prefill.travelAccess || "").trim());
    $("#uie-map-add-assets").val(Array.isArray(prefill.assets) ? prefill.assets.join(", ") : String(prefill.assets || "").trim());
    $("#uie-map-add-npcs").val(Array.isArray(prefill.npcs) ? prefill.npcs.join(", ") : String(prefill.npcs || "").trim());
    $("#uie-map-add-desc").val(String(prefill.desc || prefill.description || "").trim() || locationPlanningText(placeName, prefill));
    setTimeout(() => document.getElementById("uie-map-add-name")?.focus?.(), 0);
}

function recentChatTextForMapScan() {
    try {
        return Array.from(document.querySelectorAll("#chat-log .mes_text, #chat .mes_text, .mes .mes_text, .chat-message, .message"))
            .slice(-40)
            .map((el) => String(el.innerText || el.textContent || "").trim())
            .filter(Boolean)
            .join("\n")
            .slice(-9000);
    } catch (_) {
        return "";
    }
}

function scanPlacesFromText(text = "") {
    const found = [];
    const seen = new Set();
    const add = (name, hint = "") => {
        const clean = String(name || "").replace(/\s+/g, " ").replace(/[.,;:!?]+$/g, "").trim();
        if (clean.length < 3 || clean.length > 70) return;
        if (/^(the|a|an|and|but|then|there|here|north|south|east|west)$/i.test(clean)) return;
        const key = clean.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        found.push({ name: clean, hint });
    };
    const patterns = [
        /\b(?:at|in|inside|outside|near|toward|to|from|into|through|around)\s+(?:the\s+)?([A-Z][A-Za-z0-9' -]{2,64}?)(?=[\n.,;:!?)]|$)/g,
        /\b([A-Z][A-Za-z0-9' -]{2,48}\s+(?:Gate|Hall|Room|Tower|School|Academy|Market|Forest|Marsh|Harbor|Station|Temple|Shop|Cafe|Office|District|Street|Alley|Cave|Mine|Vault|Inn|House|Apartment|Castle|Bridge|Dock|Campus))\b/g,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text))) add(match[1], match[0]);
    }
    if (!found.length) add(currentLocationName(), "Current map location");
    return found.slice(0, 18);
}

function populateMapScanModal(places = []) {
    const anchors = (state?.area || []).concat(state?.region || []).concat(state?.world || []);
    $("#uie-map-scan-place").html(places.map((place, index) => `<option value="${index}">${esc(place.name)}</option>`).join(""));
    $("#uie-map-scan-place").data("places", places);
    $("#uie-map-scan-anchor").html(anchors.map((node) => `<option value="${esc(node.name)}">${esc(node.name)}</option>`).join("") || `<option value="${esc(currentLocationName())}">${esc(currentLocationName())}</option>`);
    $("#uie-map-scan-layer").val(state?.view === "world" || state?.view === "region" ? state.view : "area");
    $("#uie-map-scan-empty").text(places.length ? "Choose the place the AI/chat scan found, then choose where it belongs." : "No concrete places found yet.");
}

async function openMapScanModal() {
    openMapModal("uie-map-scan-modal");
    const text = recentChatTextForMapScan();
    let places = scanPlacesFromText(text);
    populateMapScanModal(places);
    if (!text || typeof generateContent !== "function") return;
    try {
        $("#uie-map-scan-empty").text("Scanning chat log for addable map locations...");
        const prompt = [
            "Read the recent chat and return JSON only.",
            "Find concrete physical places the map can add. Do not add people, organizations, moods, prompts, or vague directions.",
            'Format: {"places":[{"name":"","layer":"world|region|area|vicinity","type":"","description":"one physical description, not an image prompt","connectNear":""}]}',
            `Current location: ${currentLocationName()}`,
            "Recent chat:",
            text,
        ].join("\n");
        const raw = await generateContent(prompt, "Map Chat Location Scan");
        const parsed = parseStrictJsonObject(raw);
        const aiPlaces = Array.isArray(parsed?.places) ? parsed.places : [];
        if (aiPlaces.length) {
            places = aiPlaces.map((p) => ({
                name: String(p?.name || "").trim(),
                layer: String(p?.layer || "").trim(),
                type: String(p?.type || "").trim(),
                description: String(p?.description || "").trim(),
                connectNear: String(p?.connectNear || "").trim(),
            })).filter((p) => p.name);
            populateMapScanModal(places);
        }
    } catch (err) {
        console.warn("[map] Chat location scan failed", err);
        $("#uie-map-scan-empty").text("AI scan failed, using local chat matches.");
    }
}

function addScannedLocation() {
    const places = $("#uie-map-scan-place").data("places") || [];
    const pick = places[Number($("#uie-map-scan-place").val() || 0)] || null;
    if (!pick?.name) {
        notify?.("warning", "No scanned place selected.", "Map");
        return;
    }
    const layer = String(pick.layer || $("#uie-map-scan-layer").val() || "area");
    const anchor = String(pick.connectNear || $("#uie-map-scan-anchor").val() || currentLocationName()).trim();
    manualLandmarkPoint = null;
    $("#uie-map-add-name").val(pick.name);
    $("#uie-map-add-layer").val(["world", "region", "area", "vicinity"].includes(layer) ? layer : "area");
    $("#uie-map-add-type").val(pick.type || inferManualLocationType(pick.name));
    $("#uie-map-add-desc").val(cleanMapDescription({ name: pick.name, type: pick.type, desc: pick.description || `${pick.name} is a place mentioned in recent story context near ${anchor}.` }));
    addManualLocation();
    closeMapModals();
}

async function handleMapAction(action) {
    if (action === "generate") return openMapModal("worldgen-modal");
    if (action === "add") {
        state.manualPlacing = true;
        state.freePlacing = false;
        manualLandmarkPoint = null;
        persist();
        const canvas = document.querySelector(".uie-simple-map__canvas");
        if (canvas) canvas.setAttribute("data-tip-text", "Click the map to place the landmark");
        $("#uie-map-window").addClass("is-placing-landmark");
        notify?.("info", "Click a free spot on the map to place the landmark.", "Map");
        return;
    }
    if (action === "freeplace") {
        state.manualPlacing = true;
        state.freePlacing = true;
        manualLandmarkPoint = null;
        persist();
        const canvas = document.querySelector(".uie-simple-map__canvas");
        if (canvas) canvas.setAttribute("data-tip-text", "Click anywhere to place a home, dock, world, or location");
        $("#uie-map-window").addClass("is-placing-landmark");
        notify?.("info", "Click anywhere on the map to freely place any location, home, dock, or world.", "Map");
        return;
    }
    if (action === "import") return openMapModal("uie-map-import-modal");
    if (action === "export") return exportMapJson();
    if (action === "share") return shareMapJson();
    if (action === "blueprint") {
        if (!selected?.blueprintId) {
            notify?.("info", `${selected?.name || "This location"} has no generated detailed layout. Nearby shows its places and immediate routes.`, "Map");
            return;
        }
        syncBlueprintForLocation(selected.blueprintId || selected.name);
        state.view = "blueprint";
        selected = firstNodeForView("blueprint");
        state.selectedId = selected?.id || "";
        persist();
        renderMap();
    }
}

function syncMapGeneratorHint() {
    const v = String($("#wg-scope").val() || "area");
    const hints = {
        world: "Creates clickable Tier 1 worlds/planets with factions, laws, regions, and generated local places beneath them.",
        region: "Creates a Tier 2 regional route graph, then fills it with context-appropriate destinations and optional detailed layouts.",
        area: "Creates the complete visitable local atlas using the active setting's genre, era, geography, and location types.",
        blueprint: "Regenerates the physical layout only for a bounded structure, vehicle, exploration site, or cave system.",
    };
    $("#wg-scope-hint").text(hints[v] || hints.area);
    $("#wg-count-worlds-wrapper").toggleClass("is-muted", v !== "world");
    $("#wg-count-regions-wrapper").toggleClass("is-muted", !(v === "world" || v === "region"));
    $("#wg-count-settlements-wrapper, #wg-count-places-wrapper").toggleClass("is-muted", v === "blueprint");
}

async function runMapGeneratorFromModal() {
    const scope = String($("#wg-scope").val() || "area");
    const mode = String($("#wg-mode").val() || "hybrid");
    const label = String($("#wg-location").val() || currentLocationName()).trim() || "Generated Location";
    const prompt = String($("#wg-prompt").val() || "").trim();
    const focusedDoms = readFocusedDomOptions();
    const counts = {
        worlds: parseInt($("#wg-count-worlds").val(), 10) || 1,
        regions: parseInt($("#wg-count-regions").val(), 10) || 4,
        settlements: parseInt($("#wg-count-settlements").val(), 10) || 4,
        places: parseInt($("#wg-count-places").val(), 10) || 10,
        roomsPerInterior: parseInt($("#wg-count-rooms").val(), 10) || 8,
        blueprintMode: String($("#wg-blueprint-mode").val() || "sites"),
    };
    const $btn = $("#wg-generate").prop("disabled", true).text("Generating...");
    try {
        const tier = scope === "area" ? "local" : scope;
        const next = await generateForTier(tier, { mode, label, prompt, counts, focusedDoms });
        closeMapModals();
        if (next) notify?.("success", "Map generated and opened.", "Map");
    } catch (err) {
        notify?.("error", `Map generation failed: ${err?.message || err}`, "Map");
    } finally {
        $btn.prop("disabled", false).text("Generate Map");
    }
}

function inferPlacementDirection(text = "") {
    const raw = String(text || "").toLowerCase();
    for (const dir of DIRECTIONS) {
        if (new RegExp(`\\b${dir}\\b`, "i").test(raw)) return dir;
    }
    if (/\b(left|westward)\b/.test(raw)) return "west";
    if (/\b(right|eastward)\b/.test(raw)) return "east";
    if (/\b(up|above|northward)\b/.test(raw)) return "north";
    if (/\b(down|below|southward)\b/.test(raw)) return "south";
    return "unknown";
}

function placementAnchorForLayer(listName, list) {
    const selectedView = String(selected?.view || state?.view || "");
    if (selected && selectedView === listName) return selected;
    if (listName === "vicinity") {
        return vicinityForLocal(state.activeLocalName || currentLocationName())[0]
            || getNodeByName(state.activeLocalName || currentLocationName())
            || list?.[0]
            || null;
    }
    if (listName === "area") return getNodeByName(currentLocationName()) || list?.[0] || selected || null;
    if (Array.isArray(list) && list.length) return list[list.length - 1];
    return selected || null;
}

function smartManualPlacement(listName, list, nodeDraft = {}) {
    if (manualLandmarkPoint) return { x: manualLandmarkPoint.x, y: manualLandmarkPoint.y, anchor: placementAnchorForLayer(listName, list) };
    const anchor = placementAnchorForLayer(listName, list);
    const baseX = Number(anchor?.x ?? (listName === "world" ? 48 : 50));
    const baseY = Number(anchor?.y ?? (listName === "world" ? 48 : 50));
    const direction = inferPlacementDirection(`${nodeDraft.name || ""} ${nodeDraft.type || ""} ${nodeDraft.desc || ""}`);
    const coords = findOpenCoordinate(baseX, baseY, direction, {
        layer: listName,
        anchor,
        nodes: list,
        step: listName === "world" ? 22 : listName === "region" ? 18 : listName === "vicinity" ? 9 : 14,
        minDistance: listName === "world" ? 14 : listName === "region" ? 12 : listName === "vicinity" ? 7 : 9,
    });
    return { ...coords, anchor };
}

function addManualLocation() {
    if (!state) loadState();
    const layer = String($("#uie-map-add-layer").val() || "area");
    const listName = layer === "local" ? "area" : layer;
    const list = state[listName] || [];
    const name = String($("#uie-map-add-name").val() || "").trim();
    if (!name) {
        notify?.("warning", "Name the location first.", "Map");
        return;
    }
    const id = `${listName}_${slug(name)}_${Date.now().toString(16)}`;
    const prev = list[list.length - 1];
    const type = String($("#uie-map-add-type").val() || (listName === "world" ? "world" : "place")).trim();
    const desc = String($("#uie-map-add-desc").val() || `Manual ${type} location.`).trim();
    const placement = smartManualPlacement(listName, list, { name, type, desc });
    const node = {
        id,
        name,
        type,
        faction: String($("#uie-map-add-faction").val() || activeFaction()).trim() || "Inherited",
        theme: String($("#uie-map-add-theme").val() || activeTheme()).trim() || "Local",
        laws: normalizeList($("#uie-map-add-laws").val()),
        reputation: normalizeList($("#uie-map-add-reputation").val()),
        assets: normalizeList($("#uie-map-add-assets").val()),
        npcs: normalizeList($("#uie-map-add-npcs").val()),
        x: placement.x,
        y: placement.y,
        z: 0,
        desc,
        links: [],
        blueprintId: listName === "area" ? name : isInteriorKind(type, name) ? name : "",
        accessModes: normalizeList($("#uie-map-add-access").val()),
    };
    ensureGovernanceFields(node, selected || state.world?.[0]);
    manualLandmarkPoint = null;
    state.manualPlacing = false;
    $("#uie-map-window").removeClass("is-placing-landmark");
    const linkSource = placement.anchor?.id && placement.anchor !== node ? placement.anchor : prev;
    if (linkSource?.id && linkSource !== node) {
        linkSource.links = Array.from(new Set([...(linkSource.links || []), id]));
        node.links = Array.from(new Set([...(node.links || []), linkSource.id]));
    } else if (prev) {
        prev.links = Array.from(new Set([...(prev.links || []), id]));
    }
    list.push(node);
    state[listName] = list;
    if (node.blueprintId) {
        if (!state.blueprints) state.blueprints = {};
        state.blueprints[name] = createBlueprint(name, { roomCount: state.generated?.counts?.roomsPerInterior || 8, kind: listName === "area" ? blueprintKindForLocal(node) : type, currentRoomName: allowsBlueprint(node) ? name : "" });
    }
    if (listName === "area") {
        if (!state.vicinityByArea || typeof state.vicinityByArea !== "object") state.vicinityByArea = {};
        state.vicinityByArea[name] = createVicinityNodes(node, name);
    }
    state.view = listName;
    selected = { ...node, view: listName };
    state.selectedId = node.id;
    syncStateToStoryGraph(state.generated?.prompt || "");
    persist();
    syncBackendMapRepository("manual_location_added");
    void requestLocationImageAsset(name, node, {
        kind: "thumbnail",
        source: "manual_location",
        timeoutMs: 1000,
    }).then((asset) => {
        if (asset?.status && asset.status !== "ready") {
            pollLocationImageAsset(name, asset.asset_id, node, { kind: "thumbnail" });
        }
    });
    closeMapModals();
    renderMap();
    notify?.("success", `${name} added to ${VIEW_LABELS[listName] || listName}.`, "Map");
}

function mapExportPayload() {
    return {
        schema: "uie.realityAtlas.v3",
        exportedAt: new Date().toISOString(),
        map: state || defaultState(),
    };
}

async function exportMapJson() {
    const payload = JSON.stringify(mapExportPayload(), null, 2);
    try {
        const blob = new Blob([payload], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `uie-map-${slug(state?.world?.[0]?.name || "atlas")}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 500);
        notify?.("success", "Map exported.", "Map");
    } catch (_) {
        await shareText(payload);
    }
}

async function shareText(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        notify?.("success", "Map JSON copied to clipboard.", "Map");
    } else {
        $("#uie-map-import-json").val(text);
        openMapModal("uie-map-import-modal");
        notify?.("info", "Clipboard unavailable; JSON placed in the import box.", "Map");
    }
}

async function shareMapJson() {
    const payload = JSON.stringify(mapExportPayload(), null, 2);
    if (navigator.share) {
        try {
            await navigator.share({ title: "UIE Map", text: payload });
            return;
        } catch (_) {}
    }
    await shareText(payload);
}

function importMapJson() {
    const raw = String($("#uie-map-import-json").val() || "").trim();
    const parsed = parseAiJson(raw);
    const next = parsed?.map || parsed;
    if (!next || typeof next !== "object") {
        notify?.("error", "That does not look like a valid map JSON export.", "Map");
        return;
    }
    state = migrateState({ ...next, version: next.version || 2 });
    state.view = VIEW_ORDER.includes(state.view) ? state.view : "world";
    selected = firstNodeForView(state.view);
    state.selectedId = selected?.id || "";
    persist();
    syncStateToStoryGraph(state.generated?.prompt || "");
    closeMapModals();
    renderMap();
    notify?.("success", "Map imported.", "Map");
}

function firstNodeForView(view) {
    if (view === "blueprint") return state.blueprint?.rooms?.[0] || null;
    if (view === "vicinity") return vicinityForLocal(state.activeLocalName || currentLocationName())[0] || null;
    return (state[view] || [])[0] || null;
}

function vicinityForLocal(localName = "") {
    const key = String(localName || "").trim();
    const packaged = state?.vicinityByArea && typeof state.vicinityByArea === "object" ? state.vicinityByArea[key] : null;
    return Array.isArray(packaged) && packaged.length ? packaged : (Array.isArray(state?.vicinity) ? state.vicinity : []);
}

function localForEntity(entity = null) {
    const localId = String(entity?.localId || "").trim();
    const parentName = String(entity?.blueprintParent || "").trim();
    return (state?.area || []).find((node) => String(node.id) === String(entity?.id || "") || String(node.name) === String(entity?.name || ""))
        || (state?.area || []).find((node) => localId && String(node.id) === localId)
        || (state?.area || []).find((node) => parentName && String(node.name) === parentName)
        || (state?.area || []).find((node) => String(node.name) === String(state?.activeLocalName || ""))
        || (state?.area || []).find((node) => String(node.name) === currentLocationName())
        || state?.area?.[0]
        || null;
}

function addNearbyNode(local, node) {
    if (!local || !node) return false;
    if (!state.vicinityByArea || typeof state.vicinityByArea !== "object") state.vicinityByArea = {};
    const list = Array.isArray(state.vicinityByArea[local.name]) ? state.vicinityByArea[local.name] : createVicinityNodes(local, local.name);
    node.localId = local.id;
    node.regionId = node.regionId || local.regionId || "";
    node.worldId = node.worldId || local.worldId || "";
    node.view = "vicinity";
    list.push(node);
    state.vicinityByArea[local.name] = list;
    if (String(state.activeLocalName || "") === String(local.name)) state.vicinity = list;
    return true;
}

function activateVicinityForLocal(localName = "") {
    const key = String(localName || currentLocationName()).trim();
    state.activeLocalName = key;
    const nodes = vicinityForLocal(key);
    state.vicinity = nodes;
    return nodes;
}

function getSelectedNode() {
    return findNodeById(state?.selectedId);
}

function findNodeById(id) {
    if (!state || !id) return null;
    for (const view of ["world", "region", "area", "vicinity"]) {
        const found = (state[view] || []).find((node) => String(node.id) === String(id));
        if (found) return { ...found, view };
    }
    for (const nodes of Object.values(state.vicinityByArea || {})) {
        const found = (Array.isArray(nodes) ? nodes : []).find((node) => String(node.id) === String(id));
        if (found) return { ...found, view: "vicinity" };
    }
    const room = state.blueprint?.rooms?.find((node) => String(node.id) === String(id));
    return room ? { ...room, view: "blueprint", faction: activeFaction(), theme: activeTheme(), desc: room.desc || "Physical room inside the selected interior blueprint." } : null;
}

function activeFaction() {
    return selected?.faction || state.world?.[0]?.faction || "Inherited";
}

function activeTheme() {
    return selected?.theme || state.area?.[0]?.theme || "Local";
}

function renderMap() {
    if (!state) loadState();
    const modeStyle = String(getSettings()?.world?.gameMode || getSettings()?.character?.mode || "").toLowerCase();
    if (!state.mapStyle || state.mapStyle === "traditional") {
        state.mapStyle = modeStyle.includes("fantasy") || modeStyle === "rpg" ? "high-fantasy" : modeStyle.includes("future") ? "futuristic" : "modern";
    }
    const mapStyle = ["high-fantasy", "modern", "futuristic"].includes(state.mapStyle) ? state.mapStyle : "modern";
    $("#uie-map-window").attr("data-map-style", mapStyle);
    $("#uie-map-style").val(mapStyle);
    $(".uie-simple-map__tab").removeClass("is-active");
    $(`.uie-simple-map__tab[data-map-view="${state.view}"]`).addClass("is-active");
    $("#uie-map-path").text(pathLabel());
    const activeWorld = selected?.view === "world" && selected?.name ? selected.name : state.view === "world" ? "MAP" : state.world?.[0]?.name || "MAP";
    $("#uie-map-title").text(activeWorld || "MAP");
    if (state.view === "blueprint") renderBlueprint();
    else renderNodes();
    applyViewport();
    renderDetails();
    setTimeout(adjustOverlappingPlacards, 50);
}

function adjustOverlappingPlacards() {
    const nodes = document.querySelectorAll("#uie-map-nodes .uie-simple-map__node");
    if (!nodes || nodes.length < 2) return;
    
    nodes.forEach(node => {
        const placard = node.querySelector(".uie-simple-map__placard");
        if (placard) {
            placard.style.transform = "";
        }
    });

    const rects = Array.from(nodes).map(node => {
        const placard = node.querySelector(".uie-simple-map__placard");
        if (!placard) return null;
        return {
            node,
            placard,
            rect: placard.getBoundingClientRect()
        };
    }).filter(Boolean);

    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i];
            const b = rects[j];
            
            const overlapX = Math.max(0, Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left));
            const overlapY = Math.max(0, Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top));
            
            if (overlapX > 0 && overlapY > 0) {
                const aCenterY = (a.rect.top + a.rect.bottom) / 2;
                const bCenterY = (b.rect.top + b.rect.bottom) / 2;
                
                if (aCenterY < bCenterY) {
                    b.placard.style.transform = `translateY(${overlapY + 4}px)`;
                } else {
                    a.placard.style.transform = `translateY(${overlapY + 4}px)`;
                }
                
                a.rect = a.placard.getBoundingClientRect();
                b.rect = b.placard.getBoundingClientRect();
            }
        }
    }
}

function pathLabel() {
    const world = state.world?.[0]?.name || "World";
    const region = state.region?.[0]?.name || "Region";
    const area = state.activeLocalName || currentLocationName();
    const layer = VIEW_LABELS[state.view] || titleCase(state.view);
    return `${world} > ${region} > ${area} / ${layer}`;
}

function focusedMapNodes(allNodes = []) {
    const nodes = Array.isArray(allNodes) ? allNodes : [];
    const limits = { world: 10, region: 12, area: 12, vicinity: 10 };
    const limit = limits[state.view] || 18;
    if (nodes.length <= limit) return nodes;
    const currentName = String(state.activeLocalName || currentLocationName()).trim().toLowerCase();
    const anchor = nodes.find((node) => String(node.id) === String(selected?.id || ""))
        || nodes.find((node) => String(node.name || "").trim().toLowerCase() === currentName)
        || nodes[0];
    if (!anchor) return nodes.slice(0, limit);
    const linkedIds = new Set((anchor.links || []).map(String));
    nodes.forEach((node) => {
        if ((node.links || []).map(String).includes(String(anchor.id))) linkedIds.add(String(node.id));
    });
    const priority = [anchor, ...nodes.filter((node) => linkedIds.has(String(node.id)))];
    const seen = new Set(priority.map((node) => String(node.id)));
    const nearest = nodes
        .filter((node) => !seen.has(String(node.id)))
        .sort((a, b) => {
            const da = Math.hypot(Number(a.x || 0) - Number(anchor.x || 0), Number(a.y || 0) - Number(anchor.y || 0));
            const db = Math.hypot(Number(b.x || 0) - Number(anchor.x || 0), Number(b.y || 0) - Number(anchor.y || 0));
            return da - db;
        });
    return [...priority, ...nearest].slice(0, limit);
}

function mapNodesForCurrentView() {
    if (state.view === "vicinity") return vicinityForLocal(state.activeLocalName || currentLocationName());
    return state[state.view] || [];
}

function visibleMapNodesForCurrentView() {
    return focusedMapNodes(mapNodesForCurrentView());
}

function renderNodes() {
    const allNodes = mapNodesForCurrentView();
    const nodes = focusedMapNodes(allNodes);
    $("#uie-map-blueprint").prop("hidden", true).empty();
    const $nodes = $("#uie-map-nodes").show().empty().removeClass("is-grid-layout");
    const $links = $("#uie-map-links").show().empty();

    const positions = spatialMapPositions(nodes);
    const mapPosition = (node) => positions.get(String(node?.id)) || { x: 50, y: 50 };

    for (const node of nodes) {
        for (const targetId of node.links || []) {
            const target = nodes.find((candidate) => candidate.id === targetId);
            if (!target) continue;
            const from = mapPosition(node);
            const to = mapPosition(target);
            const x1 = from.x * 10;
            const y1 = from.y * 6.2;
            const x2 = to.x * 10;
            const y2 = to.y * 6.2;
            const bend = ((x1 + y1 + x2 + y2) % 80) - 40;
            const cx = (x1 + x2) / 2 + bend;
            const cy = (y1 + y2) / 2 - bend * 0.35;
            $links.append(`<path d="M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}" />`);
        }
    }

    const primaryHomeId = String(getSettings()?.primaryHome?.id || "");
    for (const node of nodes) {
        const isSelected = String(selected?.id || "") === String(node.id);
        const isCurrent = isCurrentMapNode(node);
        const isPrimaryHome = primaryHomeId && String(node.id) === primaryHomeId;
        const planned = nodeDiscoveryState(node) === "planned" && (state.view === "area" || state.view === "vicinity");
        const displayName = planned ? `Unknown ${titleCase(node.type || "Location")}` : node.name;
        const metaLabel = planned ? "Unexplored" : node.docking ? "Docking" : node.theme || node.type || node.faction || VIEW_LABELS[state.view] || state.view;
        const kindLabel = planned ? "Unknown" : mapNodeKindLabel(node);
        const classes = [
            "uie-simple-map__node",
            `is-${state.view}`,
            `is-kind-${mapNodeKind(node)}`,
            isSelected ? "is-selected" : "",
            isCurrent ? "is-current" : "",
            isPrimaryHome ? "is-primary-home" : "",
            node.docking ? "is-dock" : "",
            node.blueprintId ? "has-blueprint" : "",
            "map-node-pin",
        ].filter(Boolean).join(" ");
        const pos = mapPosition(node);
        $nodes.append(`
            <button type="button" class="${classes}" data-map-node="${esc(node.id)}" aria-label="${esc(displayName)} - ${esc(kindLabel)}" style="left:${pos.x}%; top:${pos.y}%;">
                <span class="uie-simple-map__pin" aria-hidden="true">${mapNodeIcon(node)}</span>
                ${renderMapEntityPortraits(node)}
                <span class="uie-simple-map__placard">
                    <strong>${esc(displayName)}</strong>
                    <span class="uie-simple-map__kind-label">${esc(isPrimaryHome ? "Home Anchor" : isCurrent ? "You Are Here" : kindLabel)}</span>
                    <span class="uie-simple-map__meta-label">${esc(isSelected ? metaLabel : "")}</span>
                </span>
            </button>
        `);
    }
}

function spatialMapPositions(nodes = []) {
    const positions = new Map((nodes || []).map((node, index) => [
        String(node.id),
        {
            x: Math.max(12, Math.min(82, Number(node?.x ?? (20 + (index % 4) * 20)))),
            y: Math.max(18, Math.min(86, Number(node?.y ?? (24 + Math.floor(index / 4) * 22)))),
        },
    ]));
    const entries = [...positions.entries()];

    for (let pass = 0; pass < 60; pass++) {
        let moved = false;
        for (let i = 0; i < entries.length; i++) {
            for (let j = i + 1; j < entries.length; j++) {
                const a = entries[i][1];
                const b = entries[j][1];
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                if (dx === 0 && dy === 0) {
                    dx = ((i + j) % 2 ? 1 : -1) * 0.5;
                    dy = ((i * 3 + j) % 2 ? 1 : -1) * 0.5;
                }
                const overlapX = 19 - Math.abs(dx);
                const overlapY = 11 - Math.abs(dy);
                if (overlapX <= 0 || overlapY <= 0) continue;
                moved = true;
                if (overlapX / 19 < overlapY / 11) {
                    const push = overlapX / 2 + 0.15;
                    const direction = dx >= 0 ? 1 : -1;
                    a.x -= push * direction;
                    b.x += push * direction;
                } else {
                    const push = overlapY / 2 + 0.15;
                    const direction = dy >= 0 ? 1 : -1;
                    a.y -= push * direction;
                    b.y += push * direction;
                }
                a.x = Math.max(12, Math.min(82, a.x));
                b.x = Math.max(12, Math.min(82, b.x));
                a.y = Math.max(18, Math.min(86, a.y));
                b.y = Math.max(18, Math.min(86, b.y));
            }
        }
        if (!moved) break;
    }
    return positions;
}

function isCurrentMapNode(node = {}) {
    const current = currentLocationName().trim().toLowerCase();
    const name = String(node?.name || "").trim().toLowerCase();
    const id = String(node?.id || "").trim().toLowerCase();
    return !!(node?.current || (current && (name === current || id === current)));
}

function mapNodeKindLabel(node = {}) {
    const view = node.view || state.view;
    if (view === "world") return "World";
    if (view === "region") return "Region";
    const labels = {
        transit: "Transit",
        vehicle: "Vehicle",
        portal: "Gate",
        danger: "Danger",
        service: "Service",
        venue: "Venue",
        school: "School",
        home: "Home",
        water: "Water",
        wild: "Wilds",
        city: "City",
        interior: "Interior",
        vicinity: "Nearby",
        place: "Place",
    };
    return labels[mapNodeKind(node)] || titleCase(view || "Place");
}

function mapNodeKind(node = {}) {
    const raw = `${node.type || ""} ${node.name || ""} ${node.theme || ""}`.toLowerCase();
    if (node.view === "world" || state.view === "world") return "world";
    if (node.view === "region" || state.view === "region") return "region";
    if (node.docking || /dock|harbor|port|pier|station|terminal/.test(raw)) return "transit";
    if (/car|garage|parking|ship|boat|airship|aircraft|plane|train|vehicle|starship|spacecraft|hangar|shuttle/.test(raw)) return "vehicle";
    if (/portal|gate|rift|warp|teleport|threshold|circle/.test(raw)) return "portal";
    if (/stage|concert|venue|theater|theatre|club|studio|live house|arena|auditorium|band/.test(raw)) return "venue";
    if (/academy|school|university|classroom|campus|lecture|dorm|library/.test(raw)) return "school";
    if (/home|house|apartment|room|dorm|suite|bedroom|residence|hideout|safehouse/.test(raw)) return "home";
    if (/ocean|sea|lake|river|canal|water|reef|shallows|beach|ferry/.test(raw)) return "water";
    if (node.blueprintId || /home|house|room|hall|studio|apartment|building|tower|inn|tavern/.test(raw)) return "interior";
    if (/dungeon|cave|lair|arena|ruin|crypt|depth/.test(raw)) return "danger";
    if (/shop|market|merchant|store|forge|clinic|hospital|cafe|restaurant|bar|inn|tavern|alchemist/.test(raw)) return "service";
    if (/forest|grove|woods|field|beach|oasis|marsh|peak|mountain|desert/.test(raw)) return "wild";
    if (/city|town|street|alley|square|district|university|school/.test(raw)) return "city";
    return state.view || "place";
}

function mapNodeIcon(node = {}) {
    const kind = mapNodeKind(node);
    const view = node.view || state.view;
    const icons = {
        world: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3 3 15 0 18"/><path d="M12 3c-3 3-3 15 0 18"/></svg>',
        region: '<svg viewBox="0 0 24 24"><path d="m3 19 6-12 4 7 3-5 5 10z"/><path d="M9 7h3"/></svg>',
        transit: '<svg viewBox="0 0 24 24"><path d="M4 7h9a4 4 0 0 1 4 4v6"/><path d="m14 14 3 3 3-3"/><circle cx="5" cy="7" r="2"/><circle cx="12" cy="7" r="2"/></svg>',
        interior: '<svg viewBox="0 0 24 24"><path d="M5 21V5l9-2v18"/><path d="M14 7h5v14"/><path d="M10 12h.01"/></svg>',
        danger: '<svg viewBox="0 0 24 24"><path d="M4 20V9l4-4 4 4 4-4 4 4v11"/><path d="M8 20v-5a4 4 0 0 1 8 0v5"/></svg>',
        service: '<svg viewBox="0 0 24 24"><path d="M4 10h16l-2-5H6z"/><path d="M6 10v10h12V10"/><path d="M9 20v-6h6v6"/></svg>',
        wild: '<svg viewBox="0 0 24 24"><path d="M12 3 5 13h5l-3 7h10l-3-7h5z"/><path d="M12 13v7"/></svg>',
        city: '<svg viewBox="0 0 24 24"><path d="M4 21V8h6v13"/><path d="M14 21V4h6v17"/><path d="M7 11h.01M7 15h.01M17 8h.01M17 12h.01M17 16h.01"/></svg>',
        vehicle: '<svg viewBox="0 0 24 24"><path d="M5 16h14l-2-6H7z"/><path d="M7 16v2M17 16v2"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="18" r="2"/><path d="M9 10V6h6v4"/></svg>',
        portal: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="6" ry="9"/><path d="M12 3c3 2 4 5 4 9s-1 7-4 9"/><path d="M9 8c2-1 4-1 6 0M9 16c2 1 4 1 6 0"/></svg>',
        venue: '<svg viewBox="0 0 24 24"><path d="M9 18V5l10-2v13"/><circle cx="7" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
        school: '<svg viewBox="0 0 24 24"><path d="M3 8 12 4l9 4-9 4z"/><path d="M7 10v5c3 2 7 2 10 0v-5"/><path d="M21 8v7"/></svg>',
        home: '<svg viewBox="0 0 24 24"><path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
        water: '<svg viewBox="0 0 24 24"><path d="M4 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M4 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>',
        vicinity: '<svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="3"/><path d="M5 21c1-5 4-8 7-8s6 3 7 8"/><path d="M3 12h3M18 12h3"/></svg>',
        place: '<svg viewBox="0 0 24 24"><path d="M12 21s7-5.2 7-12a7 7 0 0 0-14 0c0 6.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
    };
    if (view === "world") return icons.world;
    if (view === "region") return icons.region;
    if (kind === "transit") return icons.transit;
    if (kind === "interior") return icons.interior;
    if (kind === "danger") return icons.danger;
    if (kind === "service") return icons.service;
    if (kind === "vehicle") return icons.vehicle;
    if (kind === "portal") return icons.portal;
    if (kind === "venue") return icons.venue;
    if (kind === "school") return icons.school;
    if (kind === "home") return icons.home;
    if (kind === "water") return icons.water;
    if (kind === "wild") return icons.wild;
    if (kind === "city") return icons.city;
    if (view === "vicinity") return icons.vicinity;
    return icons.place;
}
function renderBlueprint() {
    const bp = state.blueprint || createBlueprint(currentLocationName(), { roomCount: 6 });
    $("#uie-map-links").show().empty();
    $("#uie-map-nodes").hide().empty();
    const $bp = $("#uie-map-blueprint").prop("hidden", false).empty().addClass("is-grid-layout").css({
        display: "grid",
        gridTemplateColumns: `repeat(${bp.width}, 1fr)`,
        gridTemplateRows: `repeat(${bp.height}, 1fr)`,
        width: "100%",
        height: "100%",
    });
    
    const byId = new Map((bp.rooms || []).map((room) => [room.id, room]));
    const $links = $("#uie-map-links");
    
    for (const [fromId, toId] of bp.links || []) {
        const from = byId.get(fromId);
        const to = byId.get(toId);
        if (!from || !to) continue;
        
        const x1 = (from.x + from.w / 2) / bp.width * 100;
        const y1 = (from.y + from.h / 2) / bp.height * 100;
        const x2 = (to.x + to.w / 2) / bp.width * 100;
        const y2 = (to.y + to.h / 2) / bp.height * 100;
        
        $links.append(`<line x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%" />`);
    }
    
    for (const room of bp.rooms || []) {
        const isSelected = String(selected?.id || "") === String(room.id);
        const barrier = getBarrierForEntity(room);
        const barrierClass = barrier && !barrier.unlocked ? " has-barrier" : "";
        $bp.append(`
            <button type="button" class="uie-simple-map__room${isSelected ? " is-selected" : ""}${room.explored ? "" : " is-fogged"}${barrierClass}" data-map-node="${esc(room.id)}" style="grid-column: ${room.x + 1} / span ${room.w}; grid-row: ${room.y + 1} / span ${room.h};">
                <strong>${esc(room.name)}</strong>
                <span>${barrier && !barrier.unlocked ? esc(barrier.lockName || "Locked") : `X:${room.x} Y:${room.y} Z:${room.z || 0}`}</span>
                ${room.current || room.isExit ? `<em>${room.current ? "YOU" : ""}${room.current && room.isExit ? " / " : ""}${room.isExit ? "EXIT" : ""}</em>` : ""}
            </button>
        `);
    }
}

function renderDetails() {
    const hasSelection = !!selected;
    $("#uie-map-window").toggleClass("has-map-selection", hasSelection);
    if (!hasSelection) {
        $("#uie-map-selected-name").text("Select a location");
        $("#uie-map-selected-desc").text("Tap a marker to view travel options, information, and local constraints.");
        $("#uie-map-faction").text(activeFaction());
        $("#uie-map-theme").text(activeTheme());
        $("#uie-map-coords").text("-");
        $("#uie-map-layer").text(VIEW_LABELS[state.view] || titleCase(state.view));
        $("#uie-map-laws, #uie-map-reputation, #uie-map-transport-access, #uie-map-travel-cost, #uie-map-entity-tracker, #uie-map-exits, #uie-map-route, #uie-map-ai-constraints, #uie-map-residence-anchor, #uie-map-portraits").empty();
        return;
    }
    const planned = nodeDiscoveryState(selected) === "planned" && (selected?.view === "area" || selected?.view === "vicinity" || state.view === "area" || state.view === "vicinity");
    $("#uie-map-selected-name").text(planned ? `Unknown ${titleCase(selected?.type || "Location")}` : selected?.name || "Nothing selected");
    $("#uie-map-selected-desc").text(planned ? "This route exists, but its story content will become permanent when entered." : cleanMapDescription(selected));
    $("#uie-map-faction").text(activeFaction());
    $("#uie-map-theme").text(activeTheme());
    const coords = `${selected?.x || 0},${selected?.y || 0},${selected?.z || 0}`;
    $("#uie-map-coords").text(coords);
    $("#uie-map-layer").text(VIEW_LABELS[selected?.view || state.view] || titleCase(selected?.view || state.view));
    renderLaws(selected);
    renderReputation(selected);
    renderTransportAccess(selected);
    renderExitChips(selected);
    renderTravelCost(selected);
    renderEntityTracker(selected);

    // Primary Home Check
    const s = getSettings();
    const showHomeCard = selected && (selected.view === "area" || selected.view === "vicinity");
    if (showHomeCard) {
        const isHome = s.primaryHome && String(s.primaryHome.id) === String(selected.id);
        const home = s.primaryHome || {};
        const currency = s.currencySymbol || "G";
        const unpaidBills = Array.isArray(home.bills) ? home.bills.filter((bill) => bill?.status === "unpaid") : [];
        const currentDay = Math.max(1, Number(s.playerRoom?.day || 1));
        const establishedDay = Math.max(1, Number(home.establishedDay || home.lastBilledDay || currentDay));
        const billingText = isHome
            ? `Established day ${establishedDay}. Next billing cycle starts from day ${Math.max(establishedDay, Number(home.lastBilledDay || establishedDay)) + 30}.`
            : home?.name
                ? `Current home is ${home.name}. Moving here will transfer your return anchor and clear old open home bills.`
                : "No primary home registered yet. Pick a grounded place to create a return anchor.";
        const locationTone = mapNodeKindLabel(selected);
        $("#uie-map-home-card")
            .toggleClass("is-home", isHome)
            .show();
        if (isHome) {
            $("#uie-map-home-status").text("Current Primary Home");
            $("#uie-map-home-details").html(`
                <span><i class="fa-solid fa-location-dot" aria-hidden="true"></i>${esc(locationTone)}</span>
                <span><i class="fa-solid fa-receipt" aria-hidden="true"></i>${unpaidBills.length ? `${unpaidBills.length} bill${unpaidBills.length === 1 ? "" : "s"} due` : `No bills due (${esc(currency)})`}</span>
            `);
            $("#uie-map-home-perks").html(`
                <span>Return anchor</span>
                <span>Rest scene</span>
                <span>Bank billing</span>
            `);
            $("#uie-map-set-home").hide();
        } else {
            $("#uie-map-home-status").text("Eligible Residence");
            $("#uie-map-home-details").html(`
                <span><i class="fa-solid fa-map-pin" aria-hidden="true"></i>${esc(locationTone)}</span>
                <span><i class="fa-solid fa-calendar-days" aria-hidden="true"></i>${esc(billingText)}</span>
            `);
            $("#uie-map-home-perks").html(`
                <span>Set spawn context</span>
                <span>Track bills</span>
                <span>Ground roleplay</span>
            `);
            $("#uie-map-set-home")
                .text(home?.name ? "Move Home Here" : "Make This Home")
                .show();
        }
    } else {
        $("#uie-map-home-card").hide();
    }
}

function homeDetailsForNode(node) {
    return {
        view: node?.view || state.view || "",
        type: node?.type || mapNodeKind(node) || "",
        description: cleanMapDescription(node || {}),
    };
}

function renderTransportAccess(node) {
    const location = classifyTravelLocation(node || {}, node?.name || "");
    const modes = location.accessModes || [];
    $("#uie-map-transport").html(modes.map((mode) => `<span>${esc(titleCase(mode))}</span>`).join("") || "<span>On foot inside this space</span>");
}

function renderLaws(node) {
    ensureGovernanceFields(node || {}, state.world?.[0]);
    const laws = normalizeList(node?.laws || node?.rules || state.world?.[0]?.laws).slice(0, 6);
    $("#uie-map-laws").html(laws.map((law) => `<span>${esc(law)}</span>`).join("") || "<span>No laws recorded</span>");
}

function renderReputation(node) {
    ensureGovernanceFields(node || {}, state.world?.[0]);
    const reputation = normalizeList(node?.reputation || node?.reputationStatus || node?.localReputation).slice(0, 6);
    $("#uie-map-reputation").html(reputation.map((item) => `<span>${esc(item)}</span>`).join("") || "<span>Neutral standing</span>");
}

function renderTravelCost(node) {
    if (!node) {
        $("#uie-map-travel-cost").text("Select a destination to calculate travel.");
        return;
    }
    if (node.view === "world") {
        $("#uie-map-travel-cost").text("Choose this world to see its regions.");
        return;
    }
    if (node.view === "region") {
        $("#uie-map-travel-cost").text("Choose this province to see the places within it.");
        return;
    }
    const current = getNodeByName(currentLocationName()) || state.area?.[0] || {};
    const distance = Math.max(1, Math.round(Math.hypot(Number(node.x || 0) - Number(current.x || 0), Number(node.y || 0) - Number(current.y || 0)) / 8));
    const tier = node.view || state.view;
    const multiplier = tier === "world" ? 8 : tier === "region" ? 4 : tier === "area" ? 2 : 1;
    const time = distance * multiplier;
    const ap = Math.max(1, Math.ceil(distance * multiplier / 3));
    $("#uie-map-travel-cost").text(`About ${time} min away / ${ap} energy`);
}

function renderEntityTracker(node) {
    const s = getSettings();
    const loc = String(node?.name || currentLocationName()).trim();
    const mapNode = s.worldState?.mapNodes?.[loc] || {};
    const chars = Array.isArray(mapNode.chars) ? mapNode.chars : [];
    const party = Array.isArray(s.party?.members) ? s.party.members.map((p) => p?.name || p).filter(Boolean) : [];
    const current = String(s.worldState?.location || "").trim();
    const entries = [
        current ? { label: "Player", value: current === loc ? "Here" : current } : null,
        ...chars.slice(0, 5).map((name) => ({ label: "NPC", value: name })),
        ...party.slice(0, 3).map((name) => ({ label: "Party", value: name })),
    ].filter(Boolean);
    $("#uie-map-entities").html(entries.map((entry) => `<div><b>${esc(entry.label)}</b><span>${esc(entry.value)}</span></div>`).join("") || "<div><span>No tracked entities here yet</span></div>");
}

function renderExitChips(node) {
    const chips = getContextualExits(node).map((exit) => {
        const disabled = exit.state === "blocked" ? " disabled" : "";
        const glyph = exit.state === "locked" ? "L" : exit.state === "override" ? "!" : exit.state === "hidden" ? "?" : exit.dir[0].toUpperCase();
        return `<button type="button" class="uie-simple-map__exit is-${esc(exit.state)}" data-map-exit-dir="${esc(exit.dir)}"${disabled}><b>${esc(glyph)}</b><span>${esc(exit.label)}</span></button>`;
    }).join("");
    $("#uie-map-exits").html(chips || "<span class='uie-simple-map__exit'>No route data</span>");
}

function applyConstraint(node) {
    if (!node) return;
    window.UIE_AI_Map_Constraint = [
        "Generate room contents and background art only; do not rewrite map topology.",
        `Organization=${activeFaction()}`,
        `Theme=${activeTheme()}`,
        `Location=${node.name}`,
        `Coords=${node.x || 0},${node.y || 0},${node.z || 0}`,
        "AI_Role=Topology, Decoration, Behavior only; frontend owns BSP/DAG math, barriers, and navigation.",
        "DecoratorMode=Just-in-time; decorate unexplored room contents without changing links or coordinates.",
        node.blueprintId ? "Interior=true; blueprint is authoritative." : "",
        node.docking ? "Docking=true; owned assets must remain physically parked/docked here." : "",
    ].filter(Boolean).join("; ");
}

function collectDockingNeeds(s) {
    const assets = [
        ...(Array.isArray(s?.inventory?.assets) ? s.inventory.assets : []),
        ...(Array.isArray(s?.assets) ? s.assets : []),
    ];
    const needs = new Map();
    for (const asset of assets) {
        const text = `${asset?.type || ""} ${asset?.category || ""} ${asset?.name || ""} ${asset?.description || ""}`.toLowerCase();
        if (/\b(car|truck|van|bike|motorcycle|vehicle|automobile)\b/.test(text)) needs.set("vehicle", { kind: "vehicle", type: "garage", label: "Garage / Parking" });
        if (/\b(ship|boat|vessel|yacht|ferry|submarine)\b/.test(text)) needs.set("ship", { kind: "ship", type: "dock", label: "Ship Dock" });
        if (/\b(spacecraft|starship|spaceship|shuttle|orbital)\b/.test(text)) needs.set("spacecraft", { kind: "spacecraft", type: "spaceport", label: "Spaceport Dock" });
        if (/\b(airship|aircraft|plane|jet|helicopter)\b/.test(text)) needs.set("aircraft", { kind: "aircraft", type: "hangar", label: "Hangar / Landing Pad" });
        if (/\b(train|railcar|locomotive|tram|subway)\b/.test(text)) needs.set("rail", { kind: "rail", type: "station", label: "Train Station" });
    }
    return Array.from(needs.values());
}

const GENRE_SIGNALS = {
    modern: /\b(modern|contemporary|present[- ]day|real world|apartment|condo|office|corporate|university|college|school|subway|metro|train|car|highway|street|neighborhood|district|downtown|city|studio|concert|band|venue|hospital|police|airport|shopping|mall|internet|phone)\b/gi,
    "sci-fi": /\b(sci[- ]?fi|science fiction|cyberpunk|cyber|neon|space|spaceship|starship|spacecraft|orbital|planet|colony|android|robot|laser|galactic|station|deck|airlock)\b/gi,
    fantasy: /\b(fantasy|medieval|castle|kingdom|keep|holdfast|dungeon|dragon|magic|wizard|sorcer|elf|dwarf|tavern|realm|knight|royal|enchanted)\b/gi,
    historical: /\b(historical|ancient|renaissance|victorian|regency|feudal|empire|century|bronze age|iron age|world war|frontier)\b/gi,
};

function genreSignalScore(text, pattern) {
    return (String(text || "").match(pattern) || []).length;
}

export function inferMapGenreProfile(context = {}) {
    const primaryText = [
        context.label,
        context.prompt,
        context.mapPrompt,
        context.worldDescription,
        context.currentLocation,
        context.currentDescription,
        context.currentTheme,
        context.currentDistrict,
    ].filter(Boolean).join("\n");
    const loreText = (Array.isArray(context.lore) ? context.lore : []).join("\n");
    const chatText = String(context.recentChat || "");
    const scores = Object.fromEntries(Object.entries(GENRE_SIGNALS).map(([genre, pattern]) => [
        genre,
        genreSignalScore(primaryText, pattern) * 3
            + Math.min(genreSignalScore(chatText, pattern), 12) * 2
            + Math.min(genreSignalScore(loreText, pattern), 6),
    ]));
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [winner, winnerScore] = ranked[0] || ["neutral", 0];
    const [, runnerUpScore] = ranked[1] || ["neutral", 0];
    const genre = winnerScore > 0 && (winnerScore >= 2 || winnerScore > runnerUpScore) ? winner : "neutral";
    return { genre, scores };
}

function inferMapMood(prompt, label, context = {}) {
    const profile = inferMapGenreProfile({ ...context, prompt, label });
    return profile.genre === "neutral" || profile.genre === "historical" ? "immersive" : profile.genre;
}

function genreGenerationDirective(profile = {}) {
    const genre = String(profile.genre || "neutral");
    if (genre === "modern") {
        return "Detected genre: MODERN/CONTEMPORARY. Use present-day geography, infrastructure, institutions, architecture, and naming. Do not generate keeps, holds, holdfasts, castles, kingdoms, taverns, guilds, dungeons, or other medieval-fantasy concepts unless the supplied context explicitly names one.";
    }
    if (genre === "sci-fi") {
        return "Detected genre: SCIENCE FICTION. Use technology and naming supported by the supplied context. Do not drift into medieval-fantasy vocabulary unless the supplied context explicitly establishes a science-fantasy blend.";
    }
    if (genre === "fantasy") {
        return "Detected genre: FANTASY. Match the specific fantasy culture, era, and vocabulary established by the supplied context.";
    }
    if (genre === "historical") {
        return "Detected genre: HISTORICAL. Match the established place, period, technology, institutions, and naming conventions; do not introduce fantasy or modern concepts without context support.";
    }
    return "Detected genre: UNSPECIFIED/UNIVERSAL. Do not default to medieval fantasy. Use only setting-specific concepts supported by the supplied context.";
}

function settlementKindsForGenre(genre) {
    if (genre === "modern") return ["city", "district", "neighborhood", "complex"];
    if (genre === "sci-fi") return ["city", "station", "colony", "outpost"];
    if (genre === "fantasy") return ["city", "town", "castle", "settlement"];
    if (genre === "historical") return ["city", "town", "village", "fort"];
    return ["city", "district", "settlement", "community"];
}

function enforceGenreConsistency(node, profile = {}) {
    if (!node || profile.genre !== "modern") return node;
    const name = String(node.name || "")
        .replace(/(?:\s+keep|hold(?:fast)?)$/i, " Center")
        .replace(/\bcastle\b/gi, "Complex")
        .replace(/\bkingdom\b/gi, "Region")
        .replace(/\btavern\b/gi, "Bar");
    node.name = name.slice(0, 120);
    const type = String(node.type || "").toLowerCase();
    if (type === "castle" || type === "dungeon") node.type = "building";
    if (type === "village") node.type = "neighborhood";
    const modernize = (value) => String(value || "")
        .replace(/\bstronghold\b/gi, "secured complex")
        .replace(/\bholdfast\b/gi, "secured site")
        .replace(/\bcastle\b/gi, "complex")
        .replace(/\bkingdom\b/gi, "region")
        .replace(/\btavern\b/gi, "bar")
        .replace(/\bdungeon\b/gi, "restricted facility");
    if (node.desc) node.desc = modernize(node.desc).slice(0, 600);
    if (node.description) node.description = modernize(node.description).slice(0, 600);
    if (node.theme) node.theme = modernize(node.theme).slice(0, 120);
    if (node.faction) node.faction = modernize(node.faction).slice(0, 120);
    if (Array.isArray(node.laws)) node.laws = node.laws.map(modernize);
    return node;
}

const GENERIC_SEED_NAMES = new Set(["", "generated", "generated world", "created world", "new realm", "current setting", "current location", "starting location", "starting point"]);
const DISTINCT_QUALIFIERS = ["Old", "High", "Lower", "Upper", "Hidden", "Windward", "Sunken", "Quiet", "Outer", "Inner"];
const CONTEXT_STOP_WORDS = new Set([
    "about", "after", "again", "around", "because", "before", "build", "created", "description", "from", "generated",
    "into", "location", "locations", "named", "nearby", "outside", "place", "places", "region", "room", "rooms",
    "should", "starting", "their", "there", "these", "this", "through", "user", "where", "with", "world",
]);

function meaningfulWords(value, limit = 8) {
    return String(value || "")
        .replace(/[^a-zA-Z0-9' -]+/g, " ")
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 4 && !CONTEXT_STOP_WORDS.has(word.toLowerCase()))
        .slice(0, limit);
}

function contextualProperName(value, fallback = "Unnamed Setting") {
    const words = meaningfulWords(value, 3);
    if (!words.length) return fallback;
    return words.map((word) => titleCase(word)).join(" ").slice(0, 80);
}

function isGenericSeed(value) {
    return GENERIC_SEED_NAMES.has(String(value || "").trim().toLowerCase());
}

function collectLoreContext(s, currentLocation = "", limit = 8) {
    const loc = String(currentLocation || "").trim().toLowerCase();
    const entries = [];
    const books = Array.isArray(s?.lorebooks) ? s.lorebooks : [];
    const ctx = s?.loreContext && typeof s.loreContext === "object" ? s.loreContext : {};
    const activeChatId = String(ctx.activeChatId || currentLocation || "default").trim() || "default";
    const names = new Set([
        ...(Array.isArray(ctx.globalBooks) ? ctx.globalBooks : []),
        ...(Array.isArray(ctx.chatBindings?.[activeChatId]) ? ctx.chatBindings[activeChatId] : [])
    ].map((x) => String(x || "").trim()).filter(Boolean));
    for (const book of books.filter((b) => names.has(String(b?.name || "").trim()))) {
        const rawEntries = Array.isArray(book?.entries) ? book.entries : Object.values(book?.entries || {});
        for (const entry of rawEntries) {
            if (!entry || entry.disable === true) continue;
            const keys = normalizeList([...(Array.isArray(entry.key) ? entry.key : []), ...(Array.isArray(entry.keysecondary) ? entry.keysecondary : [])]);
            const content = String(entry.content || entry.description || "").trim();
            const label = String(entry.comment || entry.name || keys[0] || "").trim();
            if (!content && !label) continue;
            const text = `${label} ${keys.join(" ")} ${content}`.toLowerCase();
            const relevance = loc && text.includes(loc) ? 2 : entry.constant === true ? 1 : 0;
            entries.push({ relevance, text: `${label ? `${label}: ` : ""}${content}`.slice(0, 500) });
        }
    }
    return entries.sort((a, b) => b.relevance - a.relevance).slice(0, limit).map((entry) => entry.text);
}

function collectRecentChatContext(limit = 4200) {
    try {
        const roots = ["#re-chat-log", "#chat", "#chat-log", ".chat-log"];
        for (const selector of roots) {
            const el = document.querySelector(selector);
            const text = String(el?.innerText || el?.textContent || "").trim();
            if (text) return text.slice(-limit);
        }
    } catch (_) {}
    return "";
}

function buildGenerationContext(s, { currentLocation = "", direction = "", prompt = "" } = {}) {
    const loc = String(currentLocation || s?.worldState?.location || "").trim();
    const node = s?.worldState?.mapNodes?.[loc] || {};
    const worldDescription = String(s?.worldState?.description || s?.world?.generationScope?.description || "").trim();
    const lore = collectLoreContext(s, loc);
    return {
        currentLocation: loc,
        previousLocation: String(s?.worldState?.mapContext?.previousLocation || "").trim(),
        direction: String(direction || "").trim(),
        currentDescription: String(node.description || s?.worldState?.locationDesc || "").trim(),
        currentTheme: String(node.theme || s?.worldState?.mapContext?.theme || "").trim(),
        currentDistrict: String(node.district || s?.worldState?.mapContext?.region || "").trim(),
        worldDescription,
        mapPrompt: String(prompt || state?.generated?.prompt || "").trim(),
        lore,
        recentChat: collectRecentChatContext(),
    };
}

function compactGenerationContext(context) {
    return {
        recentChat: String(context?.recentChat || "").slice(-2400),
        sourceLocation: String(context?.currentLocation || "").slice(0, 120),
        previousLocation: String(context?.previousLocation || "").slice(0, 120),
        direction: String(context?.direction || "").slice(0, 20),
        sourceDescription: String(context?.currentDescription || "").slice(0, 500),
        worldDescription: String(context?.worldDescription || "").slice(0, 700),
        lore: (Array.isArray(context?.lore) ? context.lore : []).slice(0, 3).map((entry) => String(entry || "").slice(0, 320)),
    };
}

function resolveGenerationIdentity({ label = "", prompt = "", anchorRoomName = "", s = null } = {}) {
    const explicit = String(label || "").trim();
    const contextText = [
        s?.worldState?.description,
        s?.world?.generationScope?.description,
        prompt,
    ].filter(Boolean).join(" ");
    let worldName = isGenericSeed(explicit) || explicit.toLowerCase() === String(anchorRoomName || "").trim().toLowerCase()
        ? contextualProperName(contextText, "Unnamed Setting")
        : explicit;
    if (!worldName || worldName.toLowerCase() === String(anchorRoomName || "").trim().toLowerCase()) worldName = "Unnamed Setting";
    return { worldName: worldName.slice(0, 100) };
}

function fallbackRegionName(identity, mood, index) {
    const banks = mood === "sci-fi"
        ? ["Helix Reach", "Orison Belt", "Vesper Sector", "Meridian Expanse", "Lumen Verge", "Axiom Drift"]
        : mood === "fantasy"
            ? ["Ember March", "Silver Vale", "Thornwild", "Crownlands", "Mistfen", "Sunward Reach"]
            : mood === "modern"
                ? ["Riverside Ward", "North Commons", "Old Quarter", "Civic District", "Harbor Ward", "West End"]
                : ["Far Reach", "Lowlands", "Crossroads", "High Country", "Outer Verge", "Heartland"];
    return banks[index % banks.length] || `${identity.worldName} Region ${index + 1}`;
}

function fallbackWorldName(identity, mood, index) {
    const banks = mood === "sci-fi"
        ? ["Vesper Prime", "Orison", "Caelum", "Aster Reach", "Lumen", "The Far Meridian"]
        : mood === "fantasy"
            ? ["Eldervale", "Caelora", "The Ember Realms", "Asterwyn", "Myrrh", "The Verdant Crown"]
            : mood === "modern"
                ? ["The Known World", "Meridian", "The Continental Sphere", "New Horizon", "The Commonwealth", "The Outer World"]
                : ["The Known World", "Far Horizon", "Meridian", "The Outer World", "Wayfarer", "The Greater Expanse"];
    return banks[index % banks.length] || `${identity.worldName} ${index + 2}`;
}

function fallbackPlaceName(kind, index, mood) {
    const banks = {
        fantasy: ["Ashen Gate", "Moonwell", "Briarwatch", "Glassmere", "Old Beacon", "Hollow Market", "Starfall Keep", "Mosslight Crossing"],
        "sci-fi": ["Relay Nine", "Vesper Dock", "Helix Concourse", "Lumen Array", "Quiet Orbit", "Axiom Market", "Signal Annex", "Meridian Port"],
        modern: ["Juniper Station", "Lantern Street", "Riverside Market", "Bellweather Hall", "Cedar Court", "Union Square", "Harbor Walk", "Westline Arcade"],
        immersive: ["Wayfarer Crossing", "Stillwater", "Lantern Court", "Old Causeway", "Windward Post", "Quiet Market", "Horizon Gate", "Stonebridge"],
    };
    const base = (banks[mood] || banks.immersive)[index % (banks[mood] || banks.immersive).length];
    if (kind === "castle" && mood === "fantasy" && !/\b(keep|gate|watch)\b/i.test(base)) return `${base} Keep`;
    if (kind === "city" && !/\b(city|market|square|port)\b/i.test(base)) return `${base} City`;
    if (kind === "town" && !/\b(town|market|crossing|bridge)\b/i.test(base)) return `${base} Town`;
    return base;
}

function ensureDistinctNodeNames(nodes, forbiddenNames = [], fallbackName = null) {
    const used = new Set(forbiddenNames.map((name) => String(name || "").trim().toLowerCase()).filter(Boolean));
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const original = String(node?.name || "").trim();
        const key = original.toLowerCase();
        if (original && !used.has(key)) {
            used.add(key);
            continue;
        }
        const base = String(typeof fallbackName === "function" ? fallbackName(node, i) : fallbackName || `Location ${i + 1}`).trim() || `Location ${i + 1}`;
        let candidate = base;
        for (const qualifier of DISTINCT_QUALIFIERS) {
            if (!used.has(candidate.toLowerCase())) break;
            candidate = `${qualifier} ${base}`;
        }
        let suffix = 2;
        while (used.has(candidate.toLowerCase())) candidate = `${base} ${suffix++}`;
        node.name = candidate.slice(0, 120);
        used.add(node.name.toLowerCase());
    }
    return nodes;
}

function uniqueLocationName(preferred, fallback = "New Location") {
    preferred = deduplicateLocationPath(preferred);
    const used = new Set(allMapEntities().map((node) => String(node?.name || "").trim().toLowerCase()).filter(Boolean));
    const base = String(preferred || fallback).trim() || fallback;
    let candidate = base;
    for (const qualifier of DISTINCT_QUALIFIERS) {
        if (!used.has(candidate.toLowerCase())) break;
        candidate = `${qualifier} ${base}`;
    }
    let suffix = 2;
    while (used.has(candidate.toLowerCase())) candidate = `${base} ${suffix++}`;
    return candidate.slice(0, 120);
}

function localPlaceKind(index, prompt) {
    const text = String(prompt || "").toLowerCase();
    if (/\bcave|cavern|mine\b/.test(text)) return index % 3 === 0 ? "interior" : "cave";
    if (/\bship|station|deck|spacecraft|starship\b/.test(text)) return "interior";
    if (index % 5 === 0) return "interior";
    if (index % 3 === 0) return "building";
    return "exterior";
}

function isInteriorKind(kind, name = "") {
    return allowsBlueprint({ type: kind, name });
}

function createBlueprint(parentName, { roomCount = 8, kind = "interior", currentRoomName = "", roomPresets = [] } = {}) {
    const count = clampInt(roomCount, 1, 40, 8);
    const base = slug(parentName, "interior");
    const place = { name: parentName, type: kind };
    const aiPresets = Array.isArray(roomPresets) ? roomPresets.filter(r => r && r.name).map((preset, index) => ({
        ...preset,
        name: sanitizePresetName(preset.name, place, index),
    })) : [];
    const presets = aiPresets.length ? aiPresets : proceduralSpatialPresets(place, count);
    const rooms = buildBspRooms(count, base, parentName, presets, kind, currentRoomName, aiPresets.length > 0);
    if (rooms[0]) rooms[0].isExit = true;
    const links = [];
    for (let i = 1; i < rooms.length; i++) links.push([rooms[i - 1].id, rooms[i].id]);
    decorateBlueprintBarriers(rooms, parentName, kind);
    return {
        id: base,
        parentName,
        width: Math.max(12, Math.max(...rooms.map((r) => r.x + r.w), 10) + 2),
        height: Math.max(8, Math.max(...rooms.map((r) => r.y + r.h), 7) + 2),
        rooms,
        links,
    };
}

function ensureBlueprintExit(bp) {
    if (!bp || !Array.isArray(bp.rooms) || !bp.rooms.length) return bp;
    if (!bp.rooms.some((room) => room?.isExit)) bp.rooms[0].isExit = true;
    return bp;
}

function buildBspRooms(count, base, parentName, presets, kind, currentRoomName = "", exactNames = false) {
    const width = Math.max(12, Math.ceil(Math.sqrt(count)) * 5);
    const height = Math.max(8, Math.ceil(count / Math.max(2, Math.floor(Math.sqrt(count)))) * 4);
    let leaves = [{ x: 1, y: 1, w: width - 2, h: height - 2 }];
    while (leaves.length < count) {
        leaves.sort((a, b) => (b.w * b.h) - (a.w * a.h));
        const leaf = leaves.shift();
        if (!leaf) break;
        const splitVertical = leaf.w >= leaf.h;
        if ((splitVertical && leaf.w < 6) || (!splitVertical && leaf.h < 5)) {
            leaves.push(leaf);
            break;
        }
        const cut = splitVertical ? Math.floor(leaf.w / 2) : Math.floor(leaf.h / 2);
        if (splitVertical) {
            leaves.push({ x: leaf.x, y: leaf.y, w: cut, h: leaf.h }, { x: leaf.x + cut, y: leaf.y, w: leaf.w - cut, h: leaf.h });
        } else {
            leaves.push({ x: leaf.x, y: leaf.y, w: leaf.w, h: cut }, { x: leaf.x, y: leaf.y + cut, w: leaf.w, h: leaf.h - cut });
        }
    }
    return leaves.slice(0, count).map((leaf, i) => {
        const preset = presets[i % presets.length];
        const rawName = typeof preset === "string" ? preset : preset.name;
        const roomName = i === 0 && currentRoomName ? currentRoomName : exactNames ? rawName : `${parentName} - ${rawName}`;
        return {
            id: `${base}_room_${i + 1}`,
            name: roomName,
            x: leaf.x,
            y: leaf.y,
            w: Math.max(2, leaf.w - 1),
            h: Math.max(2, leaf.h - 1),
            z: 0,
            explored: i < Math.min(3, count),
            current: i === 0,
            discoveryState: i === 0 ? "generated" : "planned",
            desc: preset.imagePrompt || `${titleCase(kind)} room in ${parentName}.`,
            theme: preset.theme || "",
            imagePrompt: preset.imagePrompt || "",
            customRoomPresets: proceduralEditRoomPresets({ name: roomName, type: "interior", desc: preset.imagePrompt || "" }, { name: parentName, type: kind }),
        };
    });
}

function decorateBlueprintBarriers(rooms, parentName, kind) {
    const text = `${parentName} ${kind}`.toLowerCase();
    if (rooms[3]) rooms[3].barrier = {
        id: `${rooms[3].id}_item_lock`,
        state: "locked",
        requirementType: "item",
        requirementId: text.includes("ship") || text.includes("station") ? "blue_keycard" : "brass_key",
        lockName: text.includes("ship") || text.includes("station") ? "Biometric Scanner" : "Sealed Door",
        denial: text.includes("ship") || text.includes("station") ? "The biometric scanner flashes red. Access denied." : "The lock refuses to turn.",
    };
    if (rooms[5]) rooms[5].barrier = {
        id: `${rooms[5].id}_skill_lock`,
        state: "locked",
        requirementType: "skill",
        requirementId: text.includes("ship") || text.includes("station") ? "starship_hack" : "lockpicking",
        cost: { ap: 2 },
        lockName: text.includes("ship") || text.includes("station") ? "Sector Gate" : "Jammed Service Door",
        denial: "The mechanism resists your attempt.",
        penalty: { ap: 1 },
    };
    if (rooms[7]) rooms[7].barrier = {
        id: `${rooms[7].id}_hidden_lock`,
        state: "hidden",
        requirementType: "stat",
        requirementId: "perception",
        dc: 6,
        lockName: "Ventilation Grate",
        revealName: "Pry Open: Ventilation Grate",
        denial: "You do not notice a usable path yet.",
    };
    if (rooms[8]) rooms[8].barrier = {
        id: `${rooms[8].id}_rune_lock`,
        state: "locked",
        requirementType: "rune",
        requirementId: "rune_sequence",
        lockName: "Rune Lattice",
        denial: "The rune thread snaps back to the start.",
        puzzle: { keySequence: [1, 5, 9, 8], nodes: DEFAULT_RUNE_NODES },
    };
}

function syncBlueprintForLocation(locationName) {
    const key = String(locationName || "").trim() || currentLocationName();
    const bp = state.blueprints?.[key] || state.blueprints?.[slug(key)] || state.blueprint || createBlueprint(key, { roomCount: state.generated?.counts?.roomsPerInterior || 8 });
    state.blueprint = ensureBlueprintExit(bp);
    if (!state.blueprints) state.blueprints = {};
    state.blueprints[key] = bp;
    state.activeLocalName = key;
}

function directionBetween(a, b, fallbackIndex = 0) {
    const dx = Number(b?.x || 0) - Number(a?.x || 0);
    const dy = Number(b?.y || 0) - Number(a?.y || 0);
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
    return dy <= 0 ? "north" : "south";
}

function addDirectionalExit(nav, from, to, dir) {
    if (!from || !to || from === to) return;
    if (!nav[from]) nav[from] = {};
    if (!nav[to]) nav[to] = {};
    let d = DIRECTIONS.includes(dir) ? dir : DIRECTIONS.find((x) => !nav[from][x]) || "north";
    if (nav[from][d] && nav[from][d] !== to) d = DIRECTIONS.find((x) => !nav[from][x]) || d;
    nav[from][d] = to;
    const od = OPPOSITE[d] || "south";
    if (!nav[to][od]) nav[to][od] = from;
}

function backgroundPromptFor(node, prompt) {
    const template = environmentTemplate(node);
    return [
        `${node.name}, ${node.theme || node.type || "immersive location"}`,
        String(node.desc || "").trim(),
        String(prompt || "").trim(),
        template.image,
        "visual novel background, wide establishing shot, no text, no UI",
    ].filter(Boolean).join(", ").slice(0, 900);
}

function resolveLocationHierarchy(name, node = null) {
    const localName = String(node?.blueprintParent || name || "").trim();
    const local = (state?.area || []).find((candidate) => candidate?.name === localName)
        || (state?.area || []).find((candidate) => candidate?.id === node?.localId)
        || (state?.area || []).find((candidate) => candidate?.name === name)
        || state?.area?.[0]
        || {};
    const region = (state?.region || []).find((candidate) => candidate?.id === local?.regionId)
        || (state?.region || []).find((candidate) => candidate?.name === local?.district)
        || state?.region?.[0]
        || {};
    const world = (state?.world || []).find((candidate) => candidate?.id === local?.worldId || candidate?.id === region?.worldId)
        || state?.world?.[0]
        || {};
    const roomName = node?.blueprintParent ? String(name || "").trim() : "";
    return {
        world: { id: String(world.id || "world_primary"), name: String(world.name || "World") },
        region: { id: String(region.id || "region_current"), name: String(region.name || "Region") },
        local: { id: String(local.id || slug(localName || name, "local")), name: String(local.name || localName || name || "Local") },
        room: roomName ? { id: String(node?.id || slug(roomName, "room")), name: roomName } : null,
    };
}

function commitAuthoritativeLocation(s, name, node, prev, meta, travelEffects) {
    const locator = resolveLocationHierarchy(name, node);
    const pathParts = [locator.world.name, locator.region.name, locator.local.name, locator.room?.name].filter(Boolean);
    const path = pathParts.join(" > ");
    s.worldState.locationPath = path;
    s.worldState.locationIds = {
        worldId: locator.world.id,
        regionId: locator.region.id,
        localId: locator.local.id,
        roomId: locator.room?.id || "",
    };
    s.worldState.mapContext = {
        view: locator.room ? "blueprint" : "area",
        world: locator.world,
        region: locator.region,
        local: locator.local,
        room: locator.room,
        path,
        faction: activeFaction(),
        theme: node?.theme || activeTheme(),
        coords: s.worldState.currentCoords,
        location: name,
        previousLocation: prev,
        travelDirection: meta.dir || "",
        travelEffects,
        activeVehicle: s.worldState?.activeVehicle?.name || "",
        backgroundPrompt: node?.backgroundPrompt || "",
        generationContext: node?.generationContext || null,
    };
    try {
        const dom = getGlobalDOM();
        const gridId = locator.room?.id || locator.local.id;
        dom.getOrCreateWorld(locator.world.id, { name: locator.world.name });
        dom.getOrCreateRegion(locator.world.id, locator.region.id, { name: locator.region.name });
        dom.movePlayerTo(locator.world.id, locator.region.id, gridId);
        if (dom.activeDOM) {
            dom.activeDOM.name = name;
            dom.activeDOM.description = String(node?.description || node?.desc || "");
            dom.activeDOM.metadata = { ...(dom.activeDOM.metadata || {}), locator, path };
        }
    } catch (error) {
        console.warn("[map] DOM hierarchy location sync failed", error);
    }
    return locator;
}

function syncStateToStoryGraph(prompt = "") {
    const s = getSettings();
    if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
    if (!s.worldState.navGraph || typeof s.worldState.navGraph !== "object") s.worldState.navGraph = {};
    if (!s.worldState.mapNodes || typeof s.worldState.mapNodes !== "object") s.worldState.mapNodes = {};
    if (!s.worldState.areaScenes || typeof s.worldState.areaScenes !== "object") s.worldState.areaScenes = {};
    if (!s.worldState.rooms || typeof s.worldState.rooms !== "object") s.worldState.rooms = {};
    const nav = s.worldState.navGraph;
    const nodes = s.worldState.mapNodes;
    const packagedVicinity = Object.values(state.vicinityByArea || {}).flatMap((nodes) => Array.isArray(nodes) ? nodes : []);
    const areaNodes = [...(state.area || []), ...(packagedVicinity.length ? packagedVicinity : (state.vicinity || []))];
    const byId = new Map(areaNodes.map((node) => [node.id, node]));

    for (const node of areaNodes) {
        const name = String(node.name || "").trim();
        if (!name) continue;
        const existing = nodes[name] || {};
        const preserveExistingAnchor = !!existing.description && (node.type === "current" || name === currentLocationName());
        nodes[name] = {
            ...existing,
            name,
            worldId: node.worldId || existing.worldId || "",
            regionId: node.regionId || existing.regionId || "",
            localId: node.localId || node.id || existing.localId || "",
            type: preserveExistingAnchor ? existing.type || node.type : node.type || (node.blueprintId ? "interior" : "exterior"),
            district: preserveExistingAnchor ? existing.district || node.district : node.district || state.region?.[0]?.name || "Generated",
            chars: Array.isArray(existing.chars) ? existing.chars : [],
            interactions: node.docking ? ["dock", "park", "travel", "inspect"] : node.blueprintId ? ["enter", "observe", "search"] : ["observe", "move", "listen"],
            exits: existing.exits || {},
            description: preserveExistingAnchor ? existing.description : node.desc || existing.description || "",
            coords: { x: Number(node.x || 0), y: Number(node.y || 0), z: Number(node.z || 0) },
            theme: node.theme || "",
            blueprintId: node.blueprintId || "",
            docking: node.docking || null,
            backgroundPrompt: backgroundPromptFor(node, prompt),
            barrier: normalizeBarrier(node.barrier),
            generationContext: node.generationContext || existing.generationContext || null,
            discoveryState: nodeDiscoveryState(node),
        };
        s.worldState.areaScenes[name] = {
            ...(s.worldState.areaScenes[name] || {}),
            name,
            description: nodes[name].description,
            imagePrompt: nodes[name].backgroundPrompt,
        };
    }

    for (const node of areaNodes) {
        for (const targetId of node.links || []) {
            const target = byId.get(targetId);
            if (!target) continue;
            addDirectionalExit(nav, node.name, target.name, directionBetween(node, target));
        }
    }

    for (const node of areaNodes) {
        if (node.blueprintId && state.blueprints?.[node.name]) {
            wireBlueprintIntoStoryGraph(s, node.name, state.blueprints[node.name], prompt);
        }
    }
    if (state.blueprint?.parentName && !areaNodes.some((node) => node.name === state.blueprint.parentName)) {
        wireBlueprintIntoStoryGraph(s, state.blueprint.parentName, state.blueprint, prompt);
    }

    for (const [name, exits] of Object.entries(nav)) {
        if (nodes[name]) nodes[name].exits = { ...(nodes[name].exits || {}), ...(exits || {}) };
    }

    s.map = s.map || {};
    s.map.location = s.worldState.location || currentLocationName();
    s.map.data = {
        template: MAP_GENERATION_TEMPLATE,
        worlds: (state.world || []).map((n) => n.name),
        regions: (state.region || []).map((n) => n.name),
        locations: (state.area || []).map((n) => ({
            name: n.name,
            type: n.type || "area",
            theme: n.theme || "",
            x: n.x,
            y: n.y,
            docking: n.docking || null,
            blueprintId: n.blueprintId || "",
        })),
        vicinity: (state.vicinity || []).map((n) => ({
            name: n.name,
            type: n.type || "nearby",
            theme: n.theme || "",
            x: n.x,
            y: n.y,
            blueprintId: n.blueprintId || "",
        })),
        vicinityByArea: Object.fromEntries(Object.entries(state.vicinityByArea || {}).map(([name, nodes]) => [
            name,
            (Array.isArray(nodes) ? nodes : []).map((node) => ({ name: node.name, type: node.type || "nearby", x: node.x, y: node.y, blueprintId: node.blueprintId || "" }))
        ])),
        focusedDoms: state.focusedDoms || { enabled: false, registry: {}, activeTasks: [] },
        counts: state.generated?.counts || {},
        generatedAt: Date.now(),
    };
    s.worldState.focusedDoms = state.focusedDoms || { enabled: false, registry: {}, activeTasks: [] };
    s.worldState.mapContext = {
        ...(s.worldState.mapContext || {}),
        focusedDoms: s.worldState.focusedDoms,
    };
    saveSettings();
}

function wireBlueprintIntoStoryGraph(s, parentName, bp, prompt = "") {
    ensureBlueprintExit(bp);
    const nav = s.worldState.navGraph;
    const nodes = s.worldState.mapNodes;
    const byId = new Map((bp.rooms || []).map((room) => [room.id, room]));
    for (const room of bp.rooms || []) {
        const name = String(room.name || "").trim();
        if (!name) continue;
        const isParentAnchor = name === parentName;
        const existing = nodes[name] || {};
        nodes[name] = {
            ...existing,
            name,
            worldId: bp.worldId || existing.worldId || "",
            regionId: bp.regionId || existing.regionId || "",
            localId: bp.localId || existing.localId || "",
            type: isParentAnchor ? existing.type || "room" : "interior",
            district: isParentAnchor ? existing.district || parentName : parentName,
            chars: Array.isArray(existing.chars) ? existing.chars : [],
            interactions: ["observe", "search", "move"],
            exits: existing.exits || {},
            description: isParentAnchor ? existing.description || room.desc || `A room inside ${parentName}.` : room.desc || `A room inside ${parentName}.`,
            coords: { x: Number(room.x || 0), y: Number(room.y || 0), z: Number(room.z || 0) },
            blueprintParent: isParentAnchor ? existing.blueprintParent || "" : parentName,
            backgroundPrompt: isParentAnchor ? existing.backgroundPrompt || backgroundPromptFor(existing, prompt) : String(room.imagePrompt || `${room.name}, interior of ${parentName}, ${prompt}, visual novel background, no text, no UI`).slice(0, 900),
            barrier: normalizeBarrier(room.barrier),
            customRoomPresets: Array.isArray(room.customRoomPresets) ? room.customRoomPresets : proceduralEditRoomPresets(room, { name: parentName, type: "interior" }),
            imagePrompt: room.imagePrompt || room.desc || "",
        };
        s.worldState.rooms[name] = {
            ...(s.worldState.rooms[name] || {}),
            ...nodes[name],
            customRoomPresets: nodes[name].customRoomPresets,
        };
    }
    for (const [fromId, toId] of bp.links || []) {
        const from = byId.get(fromId);
        const to = byId.get(toId);
        if (!from || !to) continue;
        addDirectionalExit(nav, from.name, to.name, directionBetween(from, to));
    }
    const exitRoom = bp.rooms?.find((room) => room?.isExit) || bp.rooms?.[0];
    const first = exitRoom?.name;
    if (first && first !== parentName) {
        addDirectionalExit(nav, parentName, first, "north");
        addDirectionalExit(nav, first, parentName, "south");
    }
    const parentNode = [...(state.area || []), ...(state.vicinity || [])].find((node) => node?.name === parentName);
    const linkedOutside = parentNode?.links?.map((id) => [...(state.area || []), ...(state.vicinity || [])].find((node) => node?.id === id)).find(Boolean);
    const currentOutside = currentLocationName();
    const fallbackOutside = `${parentName} - Outside`;
    const outsideName = linkedOutside?.name || (currentOutside !== parentName && currentOutside !== first ? currentOutside : fallbackOutside);
    if (outsideName === fallbackOutside && !nodes[outsideName]) {
        nodes[outsideName] = {
            name: outsideName,
            type: "exterior",
            district: parentName,
            chars: [],
            interactions: ["enter", "observe", "move"],
            exits: {},
            description: `The outside threshold of ${parentName}.`,
            coords: { x: Number(parentNode?.x || 0) + 1, y: Number(parentNode?.y || 0) + 1, z: Number(parentNode?.z || 0) },
            blueprintParent: "",
            backgroundPrompt: `${parentName} exterior threshold, visual novel background, no text, no UI`,
            barrier: null,
        };
    }
    if (first && outsideName && outsideName !== first) {
        addDirectionalExit(nav, first, outsideName, linkedOutside ? directionBetween(parentNode, linkedOutside) : "south");
    }
}

function normalizeTier(value) {
    const raw = String(value || "").toLowerCase();
    if (raw === "world" || raw === "region" || raw === "local" || raw === "area" || raw === "vicinity" || raw === "blueprint") return raw === "area" ? "local" : raw;
    return "local";
}

function parseAiJson(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : text;
    try {
        return JSON.parse(candidate);
    } catch (_) {
        const start = candidate.indexOf("{");
        const end = candidate.lastIndexOf("}");
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(candidate.slice(start, end + 1));
            } catch (_) {}
        }
    }
    return null;
}

function listFromAi(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
        if (typeof item === "string") return { name: item };
        return item && typeof item === "object" ? item : null;
    }).filter(Boolean);
}

function aiNodeAt(aiData, key, index) {
    return listFromAi(aiData?.[key] || aiData?.map?.[key])[index] || null;
}

function applyAiNode(node, ai) {
    if (!node || !ai) return node;
    const name = String(ai.name || ai.title || "").trim();
    const desc = String(ai.desc || ai.description || ai.summary || "").trim();
    const faction = String(ai.faction || ai.owner || ai.culture || "").trim();
    const theme = String(ai.theme || ai.mood || ai.biome || ai.genre || "").trim();
    const type = String(ai.type || ai.kind || "").trim();
    const laws = normalizeList(ai.laws || ai.rules || ai.taboo || ai.restrictions);
    const reputation = normalizeList(ai.reputation || ai.reputationStatus || ai.localReputation || ai.publicStanding);
    if (name) node.name = name.slice(0, 120);
    if (desc) node.desc = desc.slice(0, 600);
    if (faction) node.faction = faction.slice(0, 120);
    if (theme) node.theme = theme.slice(0, 120);
    if (type && (node.id?.startsWith("area_") || node.id?.includes("_nearby_"))) node.type = type.slice(0, 80);
    if (laws.length) node.laws = laws.slice(0, 12);
    if (reputation.length) node.reputation = reputation.slice(0, 8);
    return node;
}

function enforceSpatialTemplate(node, anchor = null, index = 0, layer = "area") {
    if (!node) return node;
    const reference = anchor || node;
    const template = environmentTemplate(reference);
    node.environment = template.environment;
    if (!template.enclosed && /\b(room|interior|building|hall|chamber)\b/i.test(String(node.type || ""))) {
        node.type = layer === "vicinity" ? "nearby" : "exterior";
    }
    if (layer === "vicinity" && anchor && index > 0) {
        const suffix = sanitizePresetName(String(node.name || "").replace(`${anchor.name} - `, ""), anchor, index, "vicinity");
        node.name = `${anchor.name} - ${suffix}`.slice(0, 120);
        node.type = template.enclosed ? "room" : "nearby";
    }
    node.blueprintId = allowsBlueprint(node) ? String(node.blueprintId || "") : "";
    return node;
}

function blueprintKindForLocal(node = {}) {
    return allowsBlueprint(node) ? String(node.type || "interior") : "interior";
}

function aiRoomPresetsFor(aiData, areaNode, fallbackIndex) {
    const roomsByPlace = aiData?.roomsByPlace || aiData?.roomNamesByPlace || aiData?.interiors;
    const nodeName = String(areaNode?.name || "").trim();
    if (roomsByPlace && typeof roomsByPlace === "object") {
        const direct = roomsByPlace[nodeName] || roomsByPlace[areaNode?.id] || roomsByPlace[String(fallbackIndex + 1)];
        const presets = Array.isArray(direct) ? direct : Array.isArray(direct?.rooms) ? direct.rooms : Array.isArray(direct?.roomNames) ? direct.roomNames : [];
        const out = presets.map((room) => typeof room === "string" ? { name: room } : room).filter(r => r && r.name);
        if (out.length) return out;
    }
    const flat = listFromAi(aiData?.rooms || aiData?.roomNames);
    return flat.filter(r => r && r.name);
}

function contextualVicinityFor(areaNode, aiData, useFlatFallback = false) {
    const base = createVicinityNodes(areaNode, areaNode?.name);
    const byPlace = aiData?.nearbyByPlace || aiData?.vicinityByArea;
    const direct = byPlace && typeof byPlace === "object" ? byPlace[areaNode?.name] || byPlace[areaNode?.id] : null;
    const presets = Array.isArray(direct) ? direct : Array.isArray(direct?.locations) ? direct.locations : [];
    const fallback = useFlatFallback ? listFromAi(aiData?.vicinity || aiData?.nearby) : [];
    const source = presets.length ? presets : fallback;
    return base.map((node, index) => {
        if (index === 0) return node;
        return enforceSpatialTemplate(applyAiNode(node, source[index - 1]), areaNode, index, "vicinity");
    });
}

async function generateAiMapData({ tier, label, prompt, counts, worldCount, regionCount, placeCount }) {
    try {
        const { generateContent } = await import("./apiClient.js");
        if (typeof generateContent !== "function") return null;
        const context = buildGenerationContext(getSettings(), { prompt });
        const genreProfile = inferMapGenreProfile({ ...context, label, prompt });
        const request = {
            tier,
            label,
            exactCounts: {
                worlds: worldCount,
                regions: regionCount,
                places: placeCount,
                roomsPerInterior: counts.roomsPerInterior,
            },
            userPrompt: prompt,
            context,
            genreProfile,
        };
        const aiPrompt = [
            "Create structured JSON for a three-tier visual novel map generator.",
            "Return JSON only. Do not include markdown.",
            "The engine owns all physical topology math. You only provide lore, names, descriptions, laws, factions, themes, and room labels.",
            generationTemplatePrompt(),
            "Tier rules:",
            "- Tier 1 worlds are not walkable physical grids. They are clickable lore containers with master faction IDs, laws, regions, and high-level conflict.",
            "- Tier 2 regions are route nodes. Hostile routes should imply DAG-style branching choices but must not contain coordinates.",
            "- Tier 3 local places are context-appropriate visitable districts, communities, routes, structures, natural features, and landmarks. Every local place gets its own Nearby map for internal places and immediate routes.",
            "- Do not create a generic Transit Hub. Create actual transportation spaces instead: train stations, boat docks, ship docks, spaceport docks, hangars, platforms, piers, depots, and terminals.",
            "- Laws and reputation are required for every world, region, local place, and nearby place. Reputation means how the player is regarded there, such as neutral, trusted, watched, restricted, wanted, or honored.",
            "- Only bounded exploration sites selected by the engine receive detailed layout labels. Do not provide room lists for ordinary buildings, towns, cities, forests, fields, streets, or plazas.",
            "- Nearby/user-surrounding locations are immediate doors, rooms, corridors, streets, thresholds, yards, alleys, or travel edges around the player.",
            "CRITICAL CONTEXT & CONTINUITY:",
            "- The user's starting location is an immutable room anchor supplied by the engine. Generate outward around it.",
            "- WHERE WAS THE USER JUST NOW? Read the 'context' carefully. Ensure the surrounding areas logically connect to the user's immediate history and current location.",
            "- Genre and era must be inferred from the supplied context. Never use medieval fantasy as a default.",
            `- ${genreGenerationDirective(genreProfile)}`,
            "STRICT ENVIRONMENT TEMPLATES:",
            "1. Wild/Nature (Forest, Field, Ocean, Mountain): MUST NOT have 'rooms', 'hallways', or 'stairs'. Use 'clearing', 'grove', 'trail', 'nest', 'peak', 'shallows'.",
            "2. Urban/City: Use context-appropriate streets, blocks, neighborhoods, districts, transit, public spaces, and buildings.",
            "3. Interior/Structure: Use context-appropriate room and circulation terms for that exact structure and era.",
            "Avoid genre leakage in names, descriptions, factions, laws, location types, and room labels.",
            "Schema:",
            "{",
            '  "worlds": [{"name":"","description":"","faction":"","theme":"","laws":[""],"reputation":[""],"regions":[""]}],',
            '  "regions": [{"name":"","description":"","faction":"","theme":"","laws":[""],"reputation":[""],"routeStyle":"context-appropriate route style"}],',
            '  "areas": [{"name":"","description":"","faction":"","theme":"","laws":[""],"reputation":[""],"type":"context-appropriate location type"}],',
            '  "vicinity": [{"name":"","description":"","faction":"","theme":"","laws":[""],"reputation":[""],"type":"door|room|street|hall|threshold|nearby|station|dock|pier|platform"}],',
            '  "nearbyByPlace": {"Area Name": [{"name":"","description":"","laws":[""],"reputation":[""],"type":"door|room|street|hall|threshold|nearby"}]},',
            '  "roomsByPlace": {',
            '    "Area Name": [',
            '      {"name":"Room Name", "theme":"Mood/Lighting", "imagePrompt":"Detailed visual description for procedurally generating an image of this room without UI or text."}',
            '    ]',
            '  }',
            "}",
            "Match the exact counts as closely as possible. Only bounded exploration sites need detailed layout presets.",
            JSON.stringify(request, null, 2),
        ].join("\n");
        return parseAiJson(await generateContent(aiPrompt, "Map JSON"));
    } catch (err) {
        console.warn("[map] AI map generation fell back to procedural data", err);
        return null;
    }
}

export async function generateForTier(tier = "local", options = {}) {
    if (!state) loadState();
    const s = getSettings();
    const prompt = String(options.prompt || "").trim();
    const requestedLabel = String(options.label || "").trim();
    const anchorRoom = options.anchorRoom && typeof options.anchorRoom === "object"
        ? options.anchorRoom
        : {
            name: currentLocationName(),
            description: s.worldState?.locationDesc || s.worldState?.mapNodes?.[currentLocationName()]?.description || "",
            theme: s.worldState?.mapNodes?.[currentLocationName()]?.theme || "Immediate Area",
        };
    const anchorRoomName = String(anchorRoom.name || currentLocationName()).trim() || "Starting Room";
    const identity = resolveGenerationIdentity({ label: requestedLabel, prompt, anchorRoomName, s });
    const label = identity.worldName;
    const scope = normalizeTier(tier || options.scope || "local");
    const counts = readGenerationCounts(options);
    const focusedDomConfig = normalizeFocusedDomConfig(options.focusedDoms || {});
    const topologySeed = resolveTopologySeed(options, identity, prompt, counts);
    if (scope === "blueprint") {
        const parentName = currentLocationName();
        const parentNode = getNodeByName(parentName) || s.worldState?.mapNodes?.[parentName] || { name: parentName, type: "interior" };
        if (!allowsBlueprint(parentNode)) {
            notify?.("warning", `${parentName} is an open ${classifySpatialEnvironment(parentNode)} area. Use Nearby for immediate outdoor travel instead of a room blueprint.`, "Map");
            return state;
        }
        const newBp = createBlueprint(parentName, {
            roomCount: counts.roomsPerInterior,
            kind: parentNode.type || "interior",
            currentRoomName: parentName
        });
        if (!state.blueprints) state.blueprints = {};
        state.blueprints[parentName] = newBp;
        state.blueprint = newBp;
        state.view = "blueprint";
        state.selectedId = newBp.rooms?.[0]?.id || "";
        selected = newBp.rooms?.[0] || null;
        state.focusedDoms = buildFocusedDomState(focusedDomConfig, state, { label: parentName, prompt });
        state.generated = { counts, prompt, scope: "blueprint", seed: topologySeed, mode: options.mode || "procedural", focusedDoms: focusedDomConfig, generatedAt: Date.now() };
        syncFocusedDomsToHierarchy(state.focusedDoms);
        syncStateToStoryGraph(prompt);
        persist();
        renderMap();
        notify?.("success", `Blueprint room layout regenerated with ${newBp.rooms?.length || 0} rooms.`, "Map");
        return state;
    }
    if (scope === "vicinity") {
        const anchor = {
            ...(selected?.view === "area" || selected?.view === "vicinity" ? selected : getNodeByName(currentLocationName()) || state.area?.[0] || {}),
            name: anchorRoomName,
            type: String(anchorRoom.type || s.worldState?.mapNodes?.[anchorRoomName]?.type || "exterior"),
            desc: String(anchorRoom.description || ""),
            theme: String(anchorRoom.theme || "Immediate Area"),
            isStartingRoom: true,
        };
        const aiData = String(options.mode || "procedural").toLowerCase() === "ai" || String(options.mode || "procedural").toLowerCase() === "hybrid"
            ? await generateAiMapData({ tier: "vicinity", label, prompt, counts, worldCount: 1, regionCount: 1, placeCount: Math.min(12, counts.places) })
            : null;
        const generatedVicinity = createVicinityNodes(anchor, label).map((node, i) => {
            if (i === 0) return enforceSpatialTemplate({ ...node, name: anchorRoomName, type: anchor.type, isStartingRoom: true }, anchor, i, "vicinity");
            return enforceSpatialTemplate(applyAiNode(node, aiNodeAt(aiData, "vicinity", i - 1) || aiNodeAt(aiData, "areas", i - 1)), anchor, i, "vicinity");
        });
        state.vicinity = generatedVicinity;
        for (const [index, node] of generatedVicinity.entries()) {
            if (!node.blueprintId && allowsGeneratedBlueprint(node, counts.blueprintMode)) node.blueprintId = node.name;
            if (node.blueprintId) {
                if (!state.blueprints) state.blueprints = {};
                state.blueprints[node.name] = createBlueprint(node.name, {
                    roomCount: counts.roomsPerInterior,
                    kind: node.type,
                    currentRoomName: node.name,
                    roomPresets: aiRoomPresetsFor(aiData, node, index - 1),
                });
            }
        }
        state.view = "vicinity";
        state.selectedId = generatedVicinity[0]?.id || "";
        selected = firstNodeForView("vicinity");
        state.focusedDoms = buildFocusedDomState(focusedDomConfig, state, { label, prompt });
        state.generated = { counts, prompt, scope: "vicinity", seed: topologySeed, mode: options.mode || "procedural", aiApplied: !!aiData, focusedDoms: focusedDomConfig, generatedAt: Date.now() };
        syncFocusedDomsToHierarchy(state.focusedDoms);
        syncStateToStoryGraph(prompt);
        persist();
        renderMap();
        notify?.("success", `Nearby map generated with ${generatedVicinity.length} immediate travel points.`, "Map");
        return state;
    }
    const generationContext = buildGenerationContext(s, { currentLocation: anchorRoomName, prompt });
    const genreProfile = inferMapGenreProfile({ ...generationContext, label, prompt });
    const mood = inferMapMood(prompt, label, generationContext);
    const docking = collectDockingNeeds(s);
    const worldCount = scope === "world" ? counts.worlds : 1;
    const regionCount = scope === "local" ? 1 : counts.regions;
    const placeCount = counts.places;
    const aiMode = String(options.mode || "procedural").toLowerCase();
    const aiData = aiMode === "ai" || aiMode === "hybrid"
        ? await generateAiMapData({ tier: scope, label, prompt, counts, worldCount, regionCount, placeCount })
        : null;

    const worlds = Array.from({ length: worldCount }, (_, i) => ({
        id: `world_${i + 1}`,
        name: i === 0 ? identity.worldName : fallbackWorldName(identity, mood, i - 1),
        faction: "Inherited",
        theme: mood,
        x: 18 + (i % 4) * 22,
        y: 34 + Math.floor(i / 4) * 24,
        desc: `Generated world layer from the user's scale controls.`,
        links: i + 1 < worldCount ? [`world_${i + 2}`] : [],
        discoveryState: "generated",
    })).map((node, i) => ensureGovernanceFields(enforceGenreConsistency(applyAiNode(node, aiNodeAt(aiData, "worlds", i)), genreProfile)));
    ensureDistinctNodeNames(worlds, [anchorRoomName], (_node, i) => i === 0 ? identity.worldName : fallbackWorldName(identity, mood, i - 1));

    const regions = Array.from({ length: regionCount }, (_, i) => ({
        id: `region_${i + 1}`,
        name: fallbackRegionName(identity, mood, i),
        faction: "Inherited",
        theme: mood,
        x: 18 + (i % 4) * 22,
        y: 24 + Math.floor(i / 4) * 22,
        desc: `Region ${i + 1} of ${label}. Contains settlements, routes, and visitable places.`,
        links: i + 1 < regionCount ? [`region_${i + 2}`] : [],
        discoveryState: "generated",
    })).map((node, i) => ensureGovernanceFields(enforceGenreConsistency(applyAiNode(node, aiNodeAt(aiData, "regions", i)), genreProfile), worlds[i % worlds.length]));
    ensureDistinctNodeNames(regions, [anchorRoomName, ...worlds.map((node) => node.name)], (_node, i) => fallbackRegionName(identity, mood, i));
    for (let i = 0; i < regions.length; i++) {
        regions[i].worldId = worlds[i % worlds.length]?.id || worlds[0]?.id || "world_1";
        const links = [];
        if (i + 1 < regions.length) links.push(regions[i + 1].id);
        if (i % 2 === 0 && i + 2 < regions.length) links.push(regions[i + 2].id);
        if (i % 3 === 0 && i + 3 < regions.length) links.push(regions[i + 3].id);
        regions[i].links = Array.from(new Set(links));
        if (!regions[i].laws?.length && worlds[i % worlds.length]?.laws?.length) regions[i].laws = worlds[i % worlds.length].laws;
    }

    const area = [{
        id: "area_start_room",
        name: anchorRoomName,
        type: String(anchorRoom.type || s.worldState?.mapNodes?.[anchorRoomName]?.type || "exterior"),
        faction: "Inherited",
        theme: String(anchorRoom.theme || mood),
        x: 14,
        y: 18,
        z: 0,
        district: regions[0]?.name || `${label} Region`,
        desc: String(anchorRoom.description || `The player's exact starting room in ${label}.`),
        links: [],
        blueprintId: allowsGeneratedBlueprint(anchorRoom, counts.blueprintMode) ? anchorRoomName : "",
        isStartingRoom: true,
        discoveryState: "generated",
        worldId: worlds[0]?.id || "world_1",
        regionId: regions[0]?.id || "region_1",
    }];
    ensureGovernanceFields(area[0], regions[0] || worlds[0]);
    const settlementKinds = settlementKindsForGenre(genreProfile.genre);
    const dockingStart = Math.max(0, placeCount - docking.length);
    for (let i = 1; i < placeCount; i++) {
        const dock = i >= dockingStart ? docking[i - dockingStart] : null;
        const kind = dock ? dock.type : i < counts.settlements ? settlementKinds[i % settlementKinds.length] : localPlaceKind(i, prompt);
        const name = dock ? dock.label : fallbackPlaceName(kind, i - 1, mood);
        const interior = dock ? allowsGeneratedBlueprint({ name, type: kind }, counts.blueprintMode) : isInteriorKind(kind, name);
        const id = `area_${i + 1}`;
        const node = {
            id,
            name,
            type: kind,
            faction: "Inherited",
            theme: dock ? dock.label : mood,
            x: 14 + (i % 4) * 22 + (i % 2) * 2,
            y: 18 + Math.floor(i / 4) * 22,
            z: 0,
            district: regions[i % regions.length]?.name || `${label} Region`,
            desc: dock ?
                 `${dock.label} is a real local map space. Owned ${dock.kind} assets can be parked, berthed, boarded, or retrieved here.`
                : `${titleCase(kind)} generated as a visitable place with persistent route data.`,
            links: [],
            blueprintId: interior && allowsGeneratedBlueprint({ name, type: kind }, counts.blueprintMode) ? name : "",
            docking: dock ? { kind: dock.kind, assetSlots: true } : null,
            discoveryState: "planned",
            worldId: worlds[i % worlds.length]?.id || worlds[0]?.id || "world_1",
            regionId: regions[i % regions.length]?.id || regions[0]?.id || "region_1",
        };
        applyAiNode(node, aiNodeAt(aiData, "areas", i - 1) || aiNodeAt(aiData, "places", i - 1));
        enforceGenreConsistency(node, genreProfile);
        enforceSpatialTemplate(node, null, i, "area");
        if (!node.laws?.length) node.laws = regions[i % regions.length]?.laws || worlds[i % worlds.length]?.laws || [];
        ensureGovernanceFields(node, regions[i % regions.length] || worlds[i % worlds.length]);
        node.blueprintId = allowsGeneratedBlueprint(node, counts.blueprintMode) ? node.name : "";
        area.push(node);
    }
    ensureDistinctNodeNames(area, [...worlds.map((node) => node.name), ...regions.map((node) => node.name)], (node, i) => (
        node?.isStartingRoom ? anchorRoomName : fallbackPlaceName(node?.type || "exterior", Math.max(0, i - 1), mood)
    ));
    for (const node of area) {
        enforceSpatialTemplate(node, null, 0, "area");
        const parentRegion = regions.find((region) => region.name === node.district) || regions[0];
        node.regionId = node.regionId || parentRegion?.id || "region_1";
        node.worldId = node.worldId || parentRegion?.worldId || worlds[0]?.id || "world_1";
        ensureGovernanceFields(node, parentRegion || worlds[0]);
        node.blueprintId = allowsGeneratedBlueprint(node, counts.blueprintMode) ? node.name : "";
    }
    for (let i = 0; i < area.length; i++) {
        if (i + 1 < area.length) area[i].links.push(area[i + 1].id);
        if (i + 5 < area.length) area[i].links.push(area[i + 5].id);
        const seededHop = 2 + Math.floor(seededUnit(topologySeed, i) * 3);
        if (i + seededHop < area.length) area[i].links.push(area[i + seededHop].id);
        area[i].links = Array.from(new Set(area[i].links));
    }

    const blueprints = {};
    for (const node of area) {
        if (!node.blueprintId) continue;
        blueprints[node.name] = createBlueprint(node.name, {
            roomCount: node.isStartingRoom ? 1 : counts.roomsPerInterior,
            kind: blueprintKindForLocal(node),
            currentRoomName: allowsBlueprint(node) ? node.name : "",
            roomPresets: node.isStartingRoom ? [] : aiRoomPresetsFor(aiData, node, Number(String(node.id).replace("area_", "")) - 1),
        });
        blueprints[node.name].worldId = node.worldId;
        blueprints[node.name].regionId = node.regionId;
        blueprints[node.name].localId = node.id;
    }
    const currentBp = blueprints[area.find((n) => n.blueprintId)?.name] || { id: slug(label, "location"), parentName: label, width: 12, height: 8, rooms: [], links: [] };
    const vicinityByArea = Object.fromEntries(area.map((node, index) => [node.name, contextualVicinityFor(node, aiData, index === 0)]));
    const vicinity = vicinityByArea[area[0]?.name] || createVicinityNodes(area[0], label);
    for (const nodes of [worlds, regions, area, ...Object.values(vicinityByArea)]) {
        for (const node of nodes) ensureGovernanceFields(enforceGenreConsistency(node, genreProfile), regions[0] || worlds[0]);
    }
    for (const blueprint of Object.values(blueprints)) {
        for (const room of Array.isArray(blueprint?.rooms) ? blueprint.rooms : []) enforceGenreConsistency(room, genreProfile);
    }

    const view = scope === "world" ? "world" : scope === "region" ? "region" : "area";
    const initialSelectedId = view === "world" ? worlds[0]?.id : view === "region" ? regions[0]?.id : area[0]?.id;
    const nextState = {
        version: 2,
        view,
        selectedId: initialSelectedId || area[0]?.id || worlds[0]?.id || "",
        world: worlds,
        region: regions,
        area,
        vicinity,
        vicinityByArea,
        blueprint: currentBp,
        blueprints,
        generated: { counts, prompt, scope, identity, seed: topologySeed, mode: options.mode || "procedural", aiApplied: !!aiData, focusedDoms: focusedDomConfig, generatedAt: Date.now() },
    };
    nextState.focusedDoms = buildFocusedDomState(focusedDomConfig, nextState, { label, prompt });
    const validation = validateMapPackage(nextState);
    if (!validation.valid) {
        console.error("[map] Strict atlas package rejected", validation.errors);
        notify?.("error", `Map generation failed strict template validation: ${validation.errors[0]}`, "Map");
        return state;
    }
    state = nextState;
    selected = firstNodeForView(state.view);
    syncFocusedDomsToHierarchy(state.focusedDoms);
    syncStateToStoryGraph(prompt);
    persist();
    renderMap();
    notify?.("success", `${scope === "world" ? "World" : scope === "region" ? "Region" : "Local"} atlas generated with ${area.length} places and ${Object.keys(blueprints).length} blueprints.`, "Map");
    return state;
}

export function getNodeByName(name) {
    const raw = String(name || "").trim();
    if (!raw || !state) return null;
    const key = raw.toLowerCase();
    return allMapEntities().find((node) => String(node.name || "").trim().toLowerCase() === key) || null;
}

function allKnownLocationNames() {
    if (!state) loadState();
    const s = getSettings();
    const names = new Set();
    for (const node of allMapEntities()) {
        const name = String(node?.name || "").trim();
        if (name) names.add(name);
    }
    for (const name of Object.keys(s?.worldState?.mapNodes || {})) {
        const clean = String(name || "").trim();
        if (clean) names.add(clean);
    }
    return Array.from(names).sort((a, b) => b.length - a.length);
}

function ownedAssets() {
    const s = getSettings();
    const all = [
        ...(Array.isArray(s?.inventory?.assets) ? s.inventory.assets : []),
        ...(Array.isArray(s?.assets) ? s.assets : []),
    ];
    const seen = new Set();
    return all.filter((asset) => {
        const key = String(asset?.name || asset?.title || "").trim().toLowerCase();
        if (!key || seen.has(key) || asset?.owned === false) return false;
        seen.add(key);
        ensureTravelAssetFields(asset);
        return true;
    });
}

function findOwnedAssetByName(name) {
    const key = String(name || "").trim().toLowerCase();
    if (!key) return null;
    return ownedAssets().find((asset) => String(asset?.name || asset?.title || "").trim().toLowerCase() === key) || null;
}

function movementTargetsLocation(text, name) {
    const target = escapeRegExp(name);
    const move = "(?:go|going|head|heading|walk|walking|run|running|rush|rushing|drive|driving|ride|riding|travel|traveling|travelling|fly|flying|sail|sailing|move|moving|return|returning|visit|visiting|reach|reaching|teleport|teleporting|warp|warping)";
    const prep = "(?:to|toward|towards|into|inside|back\\s+to|for|aboard|at)";
    const routed = new RegExp(`\\b${move}\\b[^.!?\\n]{0,70}?\\b${prep}\\s+(?:the\\s+)?${target}(?=$|[^a-z0-9])`, "i");
    const direct = new RegExp(`\\b(?:enter|entering|board|boarding|visit|visiting|reach|reaching)\\s+(?:the\\s+)?${target}(?=$|[^a-z0-9])`, "i");
    const arrived = new RegExp(`\\b(?:arrive|arriving|arrived)\\s+(?:at|in|inside)\\s+(?:the\\s+)?${target}(?=$|[^a-z0-9])`, "i");
    return routed.test(text) || direct.test(text) || arrived.test(text);
}

function normalizeOrganicDirection(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (DIRECTIONS.includes(raw)) return raw;
    if (/\b(up|above|upward)\b/.test(raw)) return "north";
    if (/\b(down|below|downward)\b/.test(raw)) return "south";
    if (/\b(right)\b/.test(raw)) return "east";
    if (/\b(left)\b/.test(raw)) return "west";
    if (/\b(teleport|warp|portal|beam|unknown|disconnected|other world|new world|new region)\b/.test(raw)) return "teleport";
    return "unknown";
}

function inferTransitClassification(type, name = "") {
    const text = `${type || ""} ${name || ""}`.toLowerCase();
    for (const [token, classification] of Object.entries(TRANSIT_TYPES)) {
        if (new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(text)) return { ...classification };
    }
    return null;
}

function isVehicleLocation(type, name = "", vehicle = "") {
    return /\b(vehicle|car|truck|van|train|ship|boat|spacecraft|starship|spaceship|shuttle|aircraft|plane|jet|airship)\b/i.test(`${type || ""} ${name || ""} ${vehicle || ""}`);
}

function coordinateNodesForLayer(layer = "area", anchor = null) {
    const listName = layer === "local" ? "area" : String(layer || "area");
    if (listName === "vicinity") {
        const localName = String(anchor?.name || state?.activeLocalName || currentLocationName()).trim();
        return vicinityForLocal(localName);
    }
    if (Array.isArray(state?.[listName])) return state[listName];
    return allMapEntities();
}

function occupiedCoordinate(x, y, minDistance = 8, nodes = null, excludeId = "") {
    const pool = Array.isArray(nodes) ? nodes : allMapEntities();
    return pool.some((node) => (
        String(node?.id || "") !== String(excludeId || "") &&
        Math.hypot(Number(node?.x || 0) - x, Number(node?.y || 0) - y) < minDistance
    ));
}

function findOpenCoordinate(baseX, baseY, direction = "unknown", options = {}) {
    const dir = normalizeOrganicDirection(direction);
    const d = DELTA[dir] || { x: 0, y: 0 };
    const disconnected = dir === "teleport" || dir === "unknown";
    const layer = String(options.layer || "area");
    const step = Number(options.step || (layer === "vicinity" ? 10 : ORGANIC_STEP)) || ORGANIC_STEP;
    const nodes = options.nodes || coordinateNodesForLayer(layer, options.anchor || null);
    const minDistance = Number(options.minDistance || (layer === "world" ? 14 : layer === "region" ? 12 : layer === "vicinity" ? 7 : 9));
    const desiredX = disconnected ? baseX + step * 1.8 : baseX + d.x * step;
    const desiredY = disconnected ? baseY + step * 1.35 : baseY + d.y * step;
    const offsets = [
        [0, 0], [8, 0], [-8, 0], [0, 8], [0, -8],
        [8, 8], [-8, 8], [8, -8], [-8, -8],
        [16, 0], [-16, 0], [0, 16], [0, -16],
        [16, 16], [-16, 16], [16, -16], [-16, -16],
    ];
    for (const [ox, oy] of offsets) {
        const x = Math.max(6, Math.min(94, desiredX + ox));
        const y = Math.max(6, Math.min(94, desiredY + oy));
        if (!occupiedCoordinate(x, y, minDistance, nodes, options.excludeId || "")) return { x, y };
    }
    return {
        x: Math.max(6, Math.min(94, desiredX + ((nodes?.length || 1) % 5) * 3)),
        y: Math.max(6, Math.min(94, desiredY + ((nodes?.length || 1) % 4) * 3)),
    };
}

function cleanOrganicPing(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.locationChanged !== true && String(raw.locationChanged || "").toLowerCase() !== "true") return null;
    const newLocation = String(raw.newLocation || raw.location || raw.destination || "").trim().slice(0, 120);
    if (!newLocation) return null;
    return {
        locationChanged: true,
        newLocation,
        direction: normalizeOrganicDirection(raw.direction || raw.travelDirection || raw.mode),
        type: String(raw.type || raw.locationType || "exterior").trim().toLowerCase().slice(0, 80) || "exterior",
        description: String(raw.description || raw.desc || "").trim().slice(0, 600),
        theme: String(raw.theme || "").trim().slice(0, 120),
        faction: String(raw.faction || "").trim().slice(0, 120),
        vehicle: String(raw.vehicle || raw.vehicleName || "").trim().slice(0, 120),
        relationship: String(raw.relationship || raw.spatialRelationship || "unknown").trim().toLowerCase().slice(0, 40),
        scope: String(raw.scope || raw.layer || "").trim().toLowerCase().slice(0, 40),
        distance: Math.max(0, Number(raw.distance || raw.distanceUnits) || 0),
    };
}

function parsePingJson(candidate) {
    const raw = String(candidate || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    if (!raw) return null;
    try {
        return cleanOrganicPing(JSON.parse(raw));
    } catch (_) {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start >= 0 && end > start) {
            try { return cleanOrganicPing(JSON.parse(raw.slice(start, end + 1))); } catch (_) {}
        }
    }
    return null;
}

export function parseOrganicLocationResponse(reply) {
    let text = String(reply || "");
    let ping = null;
    const tagged = /\[UIE_LOCATION_CHANGE\]\s*([\s\S]*?)\s*\[\/UIE_LOCATION_CHANGE\]/i;
    const taggedMatch = text.match(tagged);
    if (taggedMatch) {
        ping = parsePingJson(taggedMatch[1]);
        text = text.replace(tagged, "");
    }
    if (!ping) {
        const fenced = /```(?:json)?\s*(\{[\s\S]*?"locationChanged"\s*:\s*true[\s\S]*?\})\s*```\s*$/i;
        const fencedMatch = text.match(fenced);
        if (fencedMatch) {
            ping = parsePingJson(fencedMatch[1]);
            if (ping) text = text.replace(fenced, "");
        }
    }
    if (!ping) {
        const locationChangedAt = text.toLowerCase().lastIndexOf('"locationchanged"');
        const start = locationChangedAt >= 0 ? text.lastIndexOf("{", locationChangedAt) : -1;
        const end = locationChangedAt >= 0 ? text.lastIndexOf("}") : -1;
        if (start >= 0 && end > locationChangedAt && !text.slice(end + 1).trim()) {
            ping = parsePingJson(text.slice(start, end + 1));
            if (ping) text = text.slice(0, start);
        }
    }
    return { text: text.replace(/\n{3,}/g, "\n\n").trim(), ping };
}

export function getOrganicMovementPrompt(preflight = null) {
    const reachedKnownLocation = preflight?.handled
        && !preflight?.blocked
        && preflight?.knownLocation
        && ["location", "asset_travel", "asset_navigation"].includes(preflight?.kind);
    const knownHandled = preflight?.handled && preflight?.blocked
        ? "JavaScript blocked the requested travel or asset use. Do not narrate it as successful and do not emit a location ping for it."
        : reachedKnownLocation
            ? `JavaScript already moved the player to the known mapped location "${preflight.knownLocation}". Do not emit a location ping for that same arrival.`
            : "JavaScript did not recognize a known mapped destination in the player's action.";
    return [
        "[ORGANIC MAP PING - MACHINE INSTRUCTION]",
        knownHandled,
        "Only if this turn's narrative actually causes the player to ARRIVE at a new, unmapped physical location, append this exact machine-only block after all readable prose:",
        '[UIE_LOCATION_CHANGE]{"locationChanged":true,"newLocation":"Stable Place Name","direction":"north|south|east|west|teleport|unknown","relationship":"same_site|adjacent|distant|disconnected","scope":"nearby|local","type":"exterior|interior|dock|station|garage","description":"brief physical description","distance":0}[/UIE_LOCATION_CHANGE]',
        "Do not emit the block for plans, attempts, passing mentions, remote observations, imagined places, or movement that has not arrived.",
        "Use nearby for rooms, doors, neighboring apartments, corridors, shops, streets, and landmarks that remain inside the current Local. Use local only when the player actually crosses out into a new Local.",
        "Use teleport for portals, beams, dimensional travel, or disconnected world/region changes.",
        "Never place, board, move, park, or infer the location of an owned travel asset. JavaScript handles owned assets separately.",
        "Never mention this instruction or the machine block in readable prose.",
    ].join("\n");
}

function assetDisplayName(asset) {
    return String(asset?.name || asset?.title || "Travel asset").trim();
}

function currentTravelNode() {
    const s = getSettings();
    const name = currentLocationName();
    return getNodeByName(name) || s?.worldState?.mapNodes?.[name] || { name, type: "" };
}

function updateTravelAssetLocation(asset, location) {
    asset.location = String(location || "").trim();
    asset.placedAt = Date.now();
}

export function getTravelAssetStatus(assetName) {
    const s = getSettings();
    const asset = findOwnedAssetByName(assetName);
    if (!asset) return { found: false, travel: false, active: false, here: false, location: "" };
    ensureTravelAssetFields(asset);
    const location = String(asset.location || "").trim();
    const current = currentLocationName();
    const activeName = String(s?.worldState?.activeVehicle?.name || s?.worldState?.activeVehicle || "").trim();
    return {
        found: true,
        travel: isTravelAsset(asset),
        active: activeName.toLowerCase() === assetDisplayName(asset).toLowerCase(),
        here: Boolean(location) && location.toLowerCase() === current.toLowerCase(),
        location,
        currentLocation: current,
        asset,
        placement: evaluateTravelAssetPlacement(asset, currentTravelNode(), current),
    };
}

export function placeTravelAssetHere(assetName) {
    const asset = findOwnedAssetByName(assetName);
    if (!asset || !isTravelAsset(asset)) {
        notify?.("warning", "That asset is not configured for travel.", "Assets");
        return false;
    }
    ensureTravelAssetFields(asset);
    const name = assetDisplayName(asset);
    if (asset.location) {
        notify?.("warning", `${name} is already placed at ${asset.location}. Move to it before using it.`, "Assets");
        return false;
    }
    const current = currentLocationName();
    const placement = evaluateTravelAssetPlacement(asset, currentTravelNode(), current);
    if (!placement.ok) {
        notify?.("warning", `${name} cannot be placed here. ${placement.reason}`, "Assets");
        return false;
    }
    updateTravelAssetLocation(asset, current);
    saveSettings();
    try { window.dispatchEvent(new CustomEvent("uie:asset_placed", { detail: { name, location: current } })); } catch (_) {}
    notify?.("success", `${name} placed at ${current}.`, "Assets");
    return true;
}

export async function moveToTravelAsset(assetName) {
    const status = getTravelAssetStatus(assetName);
    if (!status.found || !status.travel) {
        notify?.("warning", "That asset is not configured for travel.", "Assets");
        return false;
    }
    const name = assetDisplayName(status.asset);
    if (!status.location) {
        notify?.("warning", `${name} has not been placed on the map yet.`, "Assets");
        return false;
    }
    if (status.here) return true;
    return travelToLocationName(status.location, {
        reason: `Move to ${name}`,
        source: "asset_navigation",
        useActiveVehicle: false,
    });
}

export async function boardTravelAsset(assetName) {
    const s = getSettings();
    const status = getTravelAssetStatus(assetName);
    if (!status.found || !status.travel) {
        notify?.("warning", "That asset is not configured for travel.", "Assets");
        return false;
    }
    const name = assetDisplayName(status.asset);
    const activeName = String(s?.worldState?.activeVehicle?.name || s?.worldState?.activeVehicle || "").trim();
    if (activeName && activeName.toLowerCase() !== name.toLowerCase()) {
        notify?.("warning", `Park or disembark from ${activeName} before using ${name}.`, "Assets");
        return false;
    }
    if (!status.location) {
        notify?.("warning", `${name} has not been placed on the map yet.`, "Assets");
        return false;
    }
    if (!status.here) {
        notify?.("warning", `${name} is at ${status.location}. You must move there before using it.`, "Assets");
        return false;
    }
    s.worldState = s.worldState || {};
    s.worldState.activeVehicle = {
        name,
        regionalLocation: status.currentLocation,
        boardedAt: Date.now(),
    };
    saveSettings();
    if (requiresVehicleMicroMap(status.asset)) {
        await activateVehicleMicroMap(name, { regionalLocation: status.currentLocation });
    } else {
        s.worldState.mapContext = {
            ...(s.worldState.mapContext || {}),
            activeVehicle: name,
            vehicleRegionalLocation: status.currentLocation,
        };
        saveSettings();
        try { window.dispatchEvent(new CustomEvent("uie:vehicle_boarded", { detail: { name } })); } catch (_) {}
    }
    notify?.("success", `${name} is ready for travel.`, "Assets");
    return true;
}

export function parkTravelAssetHere(assetName = "") {
    const s = getSettings();
    const activeName = String(s?.worldState?.activeVehicle?.name || s?.worldState?.activeVehicle || "").trim();
    const wanted = String(assetName || activeName).trim();
    if (!activeName || activeName.toLowerCase() !== wanted.toLowerCase()) {
        notify?.("warning", wanted ? `${wanted} is not currently in use.` : "No travel asset is currently in use.", "Assets");
        return false;
    }
    const asset = findOwnedAssetByName(activeName);
    if (!asset) return false;
    const current = currentLocationName();
    const placement = evaluateTravelAssetPlacement(asset, currentTravelNode(), current);
    if (!placement.ok) {
        notify?.("warning", `${activeName} cannot be parked here. ${placement.reason}`, "Assets");
        return false;
    }
    updateTravelAssetLocation(asset, current);
    delete s.worldState.activeVehicle;
    s.worldState.mapContext = {
        ...(s.worldState.mapContext || {}),
        view: "area",
        activeVehicle: "",
        vehicleRegionalLocation: "",
    };
    if (state) {
        state.view = "area";
        selected = getNodeByName(current) || firstNodeForView("area");
        state.selectedId = selected?.id || "";
    }
    saveSettings();
    persist();
    renderMap();
    try { window.dispatchEvent(new CustomEvent("uie:vehicle_parked", { detail: { name: activeName, location: current } })); } catch (_) {}
    notify?.("success", `${activeName} parked at ${current}.`, "Assets");
    return true;
}

export async function activateVehicleMicroMap(vehicleName, meta = {}) {
    if (!state) loadState();
    const name = String(vehicleName || "").trim();
    if (!name) return null;
    const asset = findOwnedAssetByName(name);
    const status = getTravelAssetStatus(name);
    if (!asset || !status.travel || !status.here) return null;
    const roomCount = clampInt(asset?.roomCount ?? asset?.blueprintRooms ?? meta.roomCount ?? 8, 2, 40, 8);
    const bp = state.blueprints?.[name] || createBlueprint(name, {
        roomCount,
        kind: String(asset?.type || asset?.category || meta.type || "vehicle"),
        currentRoomName: `${name} - Airlock`,
    });
    if (!state.blueprints) state.blueprints = {};
    state.blueprints[name] = bp;
    state.blueprint = bp;
    state.view = "blueprint";
    selected = { ...(bp.rooms?.[0] || {}), view: "blueprint", faction: activeFaction(), theme: asset?.theme || "Vehicle Interior" };
    state.selectedId = selected?.id || "";
    const s = getSettings();
    s.worldState = s.worldState || {};
    s.worldState.activeVehicle = {
        name,
        regionalLocation: String(meta.regionalLocation || s.worldState.location || "").trim(),
        boardedAt: Date.now(),
    };
    s.worldState.mapContext = {
        ...(s.worldState.mapContext || {}),
        view: "blueprint",
        activeVehicle: name,
        vehicleRegionalLocation: s.worldState.activeVehicle.regionalLocation,
    };
    syncStateToStoryGraph(state.generated?.prompt || "");
    persist();
    renderMap();
    try { window.dispatchEvent(new CustomEvent("uie:vehicle_boarded", { detail: { name, blueprint: bp } })); } catch (_) {}
    return bp;
}

export async function addOrganicLocation(ping, meta = {}) {
    if (!state) loadState();
    const data = cleanOrganicPing(ping);
    if (!data) return null;
    data.newLocation = deduplicateLocationPath(data.newLocation);
    const existing = getNodeByName(data.newLocation);
    if (existing) return existing;
    const s = getSettings();
    const sourceName = String(meta.sourceLocation || currentLocationName()).trim();
    const source = getNodeByName(sourceName);
    const parentLocal = localForEntity(source);
    const localized = data.scope === "nearby" || data.scope === "vicinity"
        || data.relationship === "same_site" || data.relationship === "adjacent";
    const baseX = Number(source?.x ?? s.worldState?.currentCoords?.x ?? s.worldState?.x ?? 50);
    const baseY = Number(source?.y ?? s.worldState?.currentCoords?.y ?? s.worldState?.y ?? 50);
    const coords = findOpenCoordinate(baseX, baseY, data.direction, {
        layer: localized ? "vicinity" : "area",
        anchor: parentLocal || source,
        step: localized ? 9 : ORGANIC_STEP,
    });
    const transit = inferTransitClassification(data.type, data.newLocation);
    const vehicle = isVehicleLocation(data.type, data.newLocation, data.vehicle);
    const type = transit?.type || (vehicle ? "vehicle" : data.type || "exterior");
    const id = `${localized ? `${slug(parentLocal?.id || parentLocal?.name, "local")}_nearby` : "area"}_${slug(data.newLocation)}_${Date.now().toString(16)}`;
    const node = {
        id,
        name: uniqueLocationName(data.newLocation, "Discovered Location"),
        type,
        faction: data.faction || activeFaction(),
        theme: data.theme || (transit ? transit.label : vehicle ? "Vehicle Interior" : activeTheme()),
        x: coords.x,
        y: coords.y,
        z: 0,
        district: localized ? parentLocal?.district || source?.district || state.region?.[0]?.name || "Generated"
            : data.direction === "teleport" || data.direction === "unknown" ? "Disconnected Region" : source?.district || state.region?.[0]?.name || "Generated",
        desc: data.description || `A newly discovered ${type} reached organically through the ongoing story.`,
        links: [],
        docking: transit ? { kind: transit.kind, assetSlots: true } : null,
        blueprintId: allowsGeneratedBlueprint({ name: data.newLocation, type }, state.generated?.counts?.blueprintMode || "sites") ? data.newLocation : "",
        discoveryState: "generated",
        generatedAt: Date.now(),
        organic: true,
        organicDirection: data.direction,
        worldId: parentLocal?.worldId || source?.worldId || state.world?.[0]?.id || "world_primary",
        regionId: parentLocal?.regionId || source?.regionId || state.region?.[0]?.id || "region_current",
        localId: localized ? parentLocal?.id || source?.localId || "" : "",
    };
    ensureGovernanceFields(node, source || parentLocal || state.world?.[0]);
    enforceSpatialTemplate(node, parentLocal, 0, localized ? "vicinity" : "area");
    if (source && DIRECTIONS.includes(data.direction)) {
        source.links = Array.from(new Set([...(source.links || []), node.id]));
        node.links = Array.from(new Set([...(node.links || []), source.id]));
    }
    if (localized && parentLocal) addNearbyNode(parentLocal, node);
    else state.area.push(node);
    if (node.blueprintId) {
        if (!state.blueprints) state.blueprints = {};
        state.blueprints[node.name] = createBlueprint(node.name, {
            roomCount: state.generated?.counts?.roomsPerInterior || 8,
            kind: blueprintKindForLocal(node),
            currentRoomName: vehicle ? `${node.name} - Airlock` : allowsBlueprint(node) ? node.name : "",
        });
        state.blueprints[node.name].worldId = node.worldId;
        state.blueprints[node.name].regionId = node.regionId;
        state.blueprints[node.name].localId = node.id;
    }
    if (!state.vicinityByArea || typeof state.vicinityByArea !== "object") state.vicinityByArea = {};
    if (!localized) state.vicinityByArea[node.name] = createVicinityNodes(node, node.name);
    syncStateToStoryGraph(state.generated?.prompt || "");
    if (DIRECTIONS.includes(data.direction)) {
        addDirectionalExit(s.worldState.navGraph, sourceName, node.name, data.direction);
        saveSettings();
    }
    persist();
    syncBackendMapRepository("organic_location_added");
    void requestLocationImageAsset(node.name, node, {
        kind: "background",
        source: "organic_movement_ping",
        timeoutMs: 1000,
    }).then((asset) => {
        if (asset?.status && asset.status !== "ready") {
            pollLocationImageAsset(node.name, asset.asset_id, node, {
                kind: "background",
                onReady: (_asset, url) => {
                    if (url && node.name.toLowerCase() === currentLocationName().toLowerCase()) setStageBackground(url);
                },
            });
        }
    });
    renderMap();
    try { window.dispatchEvent(new CustomEvent("uie:map_ping", { detail: { node, ping: data } })); } catch (_) {}
    return node;
}

export async function preflightKnownLocationMovement(userText) {
    if (!state) loadState();
    const text = String(userText || "").trim();
    if (!text || !MOVEMENT_VERB_RE.test(text) || NEGATED_MOVEMENT_RE.test(text)) return { handled: false, reason: "no_movement_intent" };
    const current = currentLocationName();
    const backendAction = await backendMovementIntercept(text);
    if (backendAction?.kind === "board_asset") {
        const ok = await boardTravelAsset(backendAction.asset || backendAction.target);
        return { handled: true, blocked: !ok, kind: "asset_board", vehicle: backendAction.asset || backendAction.target };
    }
    if (backendAction?.kind === "asset_navigation") {
        const ok = await moveToTravelAsset(backendAction.asset || backendAction.target);
        return { handled: true, blocked: !ok, knownLocation: backendAction.target || "", kind: "asset_navigation", vehicle: backendAction.asset || "" };
    }
    if ((backendAction?.kind === "location_travel" || backendAction?.kind === "location_exit") && backendAction.target) {
        const target = String(backendAction.target || "").trim();
        if (getNodeByName(target) || getSettings()?.worldState?.mapNodes?.[target]) {
            const ok = await travelToLocationName(target, {
                reason: "Backend topology preflight",
                source: "fastapi_preflight",
                dir: backendAction.direction || "",
                useActiveVehicle: false,
            });
            return { handled: true, blocked: !ok, knownLocation: target, kind: backendAction.kind };
        }
    }
    const asset = ownedAssets()
        .filter(isTravelAsset)
        .sort((a, b) => String(b?.name || "").length - String(a?.name || "").length)
        .find((candidate) => {
            const name = assetDisplayName(candidate);
            return name && new RegExp(`(^|[^a-z0-9])${escapeRegExp(name)}(?=$|[^a-z0-9])`, "i").test(text);
        });
    const location = allKnownLocationNames().find((name) => {
        if (name.toLowerCase() === current.toLowerCase()) return false;
        return movementTargetsLocation(text, name);
    });
    if (asset) {
        const name = assetDisplayName(asset);
        if (/\b(?:park|disembark|dismount|get out|get off|leave)\b/i.test(text)) {
            const ok = parkTravelAssetHere(name);
            return { handled: true, blocked: !ok, kind: "asset_park", vehicle: name };
        }
        const wantsUse = /\b(?:board|enter|get in|get into|climb aboard|step aboard|mount|ride|drive|sail|fly|use)\b/i.test(text);
        if (wantsUse) {
            const status = getTravelAssetStatus(name);
            const boarded = status.active || await boardTravelAsset(name);
            if (!boarded) return { handled: true, blocked: true, kind: "asset_board", vehicle: name };
            if (location) {
                const ok = await travelToLocationName(location, { reason: `Travel using ${name}`, source: "js_preflight", vehicle: name });
                return { handled: true, blocked: !ok, knownLocation: location, kind: "asset_travel", vehicle: name };
            }
            return { handled: true, blocked: false, knownLocation: name, kind: "asset_board", vehicle: name };
        }
        if (movementTargetsLocation(text, name) || /\b(?:find|locate|approach)\b/i.test(text)) {
            const ok = await moveToTravelAsset(name);
            return { handled: true, blocked: !ok, knownLocation: asset.location || "", kind: "asset_navigation", vehicle: name };
        }
    }
    if (location) {
        const walking = /\b(?:walk|walking|run|running|rush|rushing)\b/i.test(text);
        const ok = await travelToLocationName(location, { reason: "Roleplay travel", source: "js_preflight", useActiveVehicle: !walking });
        return { handled: true, blocked: !ok, knownLocation: location, kind: "location" };
    }
    if (/\b(?:leave|exit|go outside|step outside|head outside|return|go back|walk back)\b/i.test(text)) {
        const exits = getContextualExits(getNodeByName(current));
        const exit = exits.find((candidate) => candidate.to && candidate.state !== "blocked" && (
            candidate.dir === "south" || /\b(return|outside|exit|threshold)\b/i.test(candidate.label)
        ));
        if (exit && await resolveBarrierForTravel(exit.to)) {
            const ok = await travelToLocationName(exit.to, { reason: "Leave current location", source: "js_preflight", dir: exit.dir });
            return { handled: true, blocked: !ok, knownLocation: exit.to, kind: "location_exit" };
        }
    }
    return { handled: false, reason: "unknown_destination" };
}

export async function applyMoveToLocation(location = {}, meta = {}) {
    if (!state) loadState();
    const name = deduplicateLocationPath(String(location?.name || location?.newLocation || location || "").trim());
    if (!name) return false;
    let node = getNodeByName(name);
    if (!node) {
        node = await addOrganicLocation({
            locationChanged: true,
            newLocation: name,
            direction: location?.direction || meta.direction || "unknown",
            type: location?.type || "exterior",
            description: location?.desc || location?.description || "",
        }, meta);
    }
    return node ? travelToLocationName(node.name, {
        useActiveVehicle: false,
        ...meta,
        source: meta.source || "location_bridge",
    }) : false;
}

export async function processOrganicLocationResponse(reply, meta = {}) {
    const parsed = parseOrganicLocationResponse(reply);
    if (!parsed.ping) return { ...parsed, handled: false };
    if (!state) loadState();
    const sourceLocation = String(meta.sourceLocation || currentLocationName()).trim();
    let node = getNodeByName(parsed.ping.newLocation);
    const created = !node;
    if (!node) node = await addOrganicLocation(parsed.ping, { sourceLocation });
    if (!node) return { ...parsed, handled: false };
    const ok = await travelToLocationName(node.name, {
        dir: parsed.ping.direction,
        reason: "Organic story travel",
        distance: parsed.ping.distance,
        speedModifier: parsed.ping.direction === "teleport" ? 0.05 : undefined,
        source: "ai_organic_ping",
        useActiveVehicle: false,
    });
    notify?.("info", `${created ? "Mapped" : "Arrived at"} ${node.name}.`, "Map Ping");
    return { ...parsed, handled: !!ok, created, node };
}

function findDirectionalCandidate(node, dir) {
    if (!node) return null;
    const linked = new Set(node.links || []);
    const linkedNames = new Set(Object.values(getSettings()?.worldState?.navGraph?.[node.name] || {}).map((name) => String(name || "").trim()));
    const candidates = [...(state?.area || []), ...(state?.vicinity || [])].filter((candidate) => {
        if (!candidate || candidate.id === node.id || linked.has(candidate.id) || linkedNames.has(candidate.name) || candidate.name === node.name) return false;
        const dx = Number(candidate.x || 0) - Number(node.x || 0);
        const dy = Number(candidate.y || 0) - Number(node.y || 0);
        return directionBetween(node, candidate) === dir;
    });
    return candidates.sort((a, b) => Math.hypot(Number(a.x || 0) - Number(node.x || 0), Number(a.y || 0) - Number(node.y || 0))
        - Math.hypot(Number(b.x || 0) - Number(node.x || 0), Number(b.y || 0) - Number(node.y || 0)))[0] || null;
}

async function generateAdjacentNode(context, dir) {
    try {
        const { generateContent } = await import("./apiClient.js");
        if (typeof generateContent !== "function") return null;
        const prompt = [
            "Create one immediately reachable visual-novel navigation location.",
            "Return JSON only with: name, description, type, theme, faction, scope, transitionReason.",
            "scope must be nearby or local. nearby means a room, door, neighboring apartment, corridor, street feature, shop, courtyard, or other place inside the current Local. local means this step crosses a real boundary into a new town, district, wilderness area, building complex, or travel destination.",
            "The destination must be a distinct place name, not a directional phrase and not a copy of the current location, world, or region name.",
            "The most recent chat is the highest-priority source of truth. Map topology is second. Lorebook context is supporting context only.",
            "If chat introduces something like scratches at the apartment next door, create that neighboring apartment as nearby inside the current Local.",
            "Only choose local when the route actually leaves the current Local. Make every transition spatially plausible and explain the boundary in transitionReason.",
            "Classify the current environment first. Never invent hallways, stairs, rooms, or deeper chambers in open forests, fields, oceans, streets, or other unbounded exteriors.",
            generationTemplatePrompt(),
            JSON.stringify({ direction: dir, ...context }, null, 2),
        ].join("\n");
        const data = parseAiJson(await generateContent(prompt, "Navigation Location JSON"));
        return data && typeof data === "object" ? data : null;
    } catch (err) {
        console.warn("[map] Contextual navigation generation fell back to procedural data", err);
        return null;
    }
}

async function decoratePlannedNode(node, meta = {}) {
    if (!node || nodeDiscoveryState(node) !== "planned") return node;
    const s = getSettings();
    const context = buildGenerationContext(s, {
        currentLocation: currentLocationName(),
        direction: meta.dir || "",
    });
    const aiNode = await generateAdjacentNode(context, meta.dir || "forward");
    if (aiNode) {
        const desc = String(aiNode.description || aiNode.desc || "").trim();
        const theme = String(aiNode.theme || "").trim();
        const faction = String(aiNode.faction || "").trim();
        const type = String(aiNode.type || "").trim();
        if (desc) node.desc = desc.slice(0, 600);
        if (theme) node.theme = theme.slice(0, 120);
        if (faction) node.faction = faction.slice(0, 120);
        if (type) node.type = type.slice(0, 80);
    }
    enforceSpatialTemplate(node, getNodeByName(currentLocationName()) || null, 1, node.localId || node.id?.includes("_nearby_") ? "vicinity" : "area");
    node.discoveryState = "generated";
    node.generatedAt = Date.now();
    node.generationContext = compactGenerationContext(context);
    syncStateToStoryGraph(state.generated?.prompt || "");
    persist();
    renderMap();
    return node;
}

async function ensureOnDemandAdjacent(dir) {
    const s = getSettings();
    const loc = currentLocationName();
    const node = getNodeByName(loc);
    const parentLocal = localForEntity(node);
    const d = DELTA[dir] || DELTA.north;
    const baseX = Number(node?.x ?? s.worldState?.currentCoords?.x ?? s.worldState?.x ?? 50);
    const baseY = Number(node?.y ?? s.worldState?.currentCoords?.y ?? s.worldState?.y ?? 50);
    const context = buildGenerationContext(s, { currentLocation: loc, direction: dir });
    const aiNode = await generateAdjacentNode(compactGenerationContext(context), dir);
    const fallbackKind = allowsBlueprint(node || {}) ? "interior" : "exterior";
    const fallbackName = fallbackPlaceName(fallbackKind, (state.area?.length || 1) + DIRECTIONS.indexOf(dir), inferMapMood(context.mapPrompt, context.worldDescription));
    let name = String(aiNode?.name || fallbackName).trim() || `${titleCase(dir)} Route`;
    if (name.toLowerCase() === loc.toLowerCase() || /^(north|south|east|west)\s+of\b/i.test(name)) name = fallbackName;
    name = uniqueLocationName(name, fallbackName);
    const requestedScope = String(aiNode?.scope || "").toLowerCase();
    const nearby = requestedScope === "nearby"
        || (requestedScope !== "local" && (!!node?.localId || allowsBlueprint(node || {})));
    const id = `${nearby ? `${slug(parentLocal?.id || parentLocal?.name, "local")}_nearby` : "area"}_${slug(name)}_${Date.now().toString(16)}`;
    const next = {
        id,
        name,
        type: String(aiNode?.type || fallbackKind).slice(0, 80),
        faction: String(aiNode?.faction || activeFaction()).slice(0, 120),
        theme: String(aiNode?.theme || activeTheme()).slice(0, 120),
        x: Math.max(6, Math.min(94, baseX + d.x * 14)),
        y: Math.max(6, Math.min(94, baseY + d.y * 14)),
        z: 0,
        district: parentLocal?.district || node?.district || state.region?.[0]?.name || "Generated",
        desc: String(aiNode?.description || aiNode?.desc || `A newly discovered route ${dir} from ${loc}.`).slice(0, 600),
        links: [],
        generationContext: compactGenerationContext(context),
        transitionReason: String(aiNode?.transitionReason || "").slice(0, 240),
        discoveryState: "generated",
        generatedAt: Date.now(),
        worldId: parentLocal?.worldId || node?.worldId || state.world?.[0]?.id || "world_primary",
        regionId: parentLocal?.regionId || node?.regionId || state.region?.[0]?.id || "region_current",
        localId: nearby ? parentLocal?.id || node?.localId || "" : "",
    };
    enforceSpatialTemplate(next, parentLocal, 0, nearby ? "vicinity" : "area");
    if (node) {
        node.links = Array.from(new Set([...(node.links || []), id]));
        next.links = Array.from(new Set([...(next.links || []), node.id]));
    }
    if (nearby && parentLocal) {
        addNearbyNode(parentLocal, next);
    } else {
        state.area.push(next);
        if (allowsGeneratedBlueprint(next, state.generated?.counts?.blueprintMode || "sites")) {
            next.blueprintId = next.name;
            if (!state.blueprints || typeof state.blueprints !== "object") state.blueprints = {};
            state.blueprints[next.name] = createBlueprint(next.name, {
                roomCount: state.generated?.counts?.roomsPerInterior || 8,
                kind: blueprintKindForLocal(next),
                currentRoomName: allowsBlueprint(next) ? next.name : "",
            });
        }
        if (!state.vicinityByArea || typeof state.vicinityByArea !== "object") state.vicinityByArea = {};
        state.vicinityByArea[next.name] = createVicinityNodes(next, next.name);
    }
    if (nearby && allowsGeneratedBlueprint(next, state.generated?.counts?.blueprintMode || "sites")) {
        if (!state.blueprints || typeof state.blueprints !== "object") state.blueprints = {};
        next.blueprintId = next.name;
        state.blueprints[next.name] = createBlueprint(next.name, {
            roomCount: state.generated?.counts?.roomsPerInterior || 8,
            kind: next.type,
            currentRoomName: next.name,
        });
    }
    addDirectionalExit(s.worldState.navGraph, loc, name, dir);
    syncStateToStoryGraph(state.generated?.prompt || "");
    persist();
    return name;
}

function setStageBackground(src) {
    const url = String(src || "").trim();
    if (!url) return;
    try {
        if (typeof window.setLocalSceneBackgroundFromDataUrl === "function") {
            window.setLocalSceneBackgroundFromDataUrl(url);
        }
    } catch (_) {}
    for (const bg of document.querySelectorAll("#re-bg, #bg1")) {
        bg.style.backgroundImage = `url("${url}")`;
        bg.style.backgroundSize = "cover";
        bg.style.backgroundPosition = "center";
        bg.style.backgroundRepeat = "no-repeat";
    }
    const root = document.getElementById("game-root");
    if (root) {
        root.style.backgroundImage = `url("${url}")`;
        root.style.backgroundSize = "cover";
        root.style.backgroundPosition = "center";
        root.style.backgroundRepeat = "no-repeat";
    }
}

function isUsableLocationBackground(src) {
    const value = String(src || "").trim();
    return !!value && !/data:image\/svg\+xml|no-image-placeholder|404|not[-_ ]found/i.test(value);
}

function rememberLocationBackground(settings, loc, url) {
    const value = String(url || "").trim();
    if (!settings || !loc || !isUsableLocationBackground(value)) return;
    settings.worldState = settings.worldState || {};
    settings.worldState.areaScenes = settings.worldState.areaScenes && typeof settings.worldState.areaScenes === "object" ? settings.worldState.areaScenes : {};
    settings.realityEngine = settings.realityEngine && typeof settings.realityEngine === "object" ? settings.realityEngine : {};
    settings.realityEngine.backgrounds = settings.realityEngine.backgrounds && typeof settings.realityEngine.backgrounds === "object" ? settings.realityEngine.backgrounds : {};
    const slugLoc = slug(loc);
    const key = Object.keys(settings.worldState.areaScenes).find((k) => String(k || "").toLowerCase() === String(loc).toLowerCase()) || loc;
    settings.worldState.areaScenes[key] = {
        ...(settings.worldState.areaScenes[key] && typeof settings.worldState.areaScenes[key] === "object" ? settings.worldState.areaScenes[key] : {}),
        imageUrl: value,
        generatedAt: Date.now(),
    };
    settings.realityEngine.backgrounds[loc] = value;
    settings.realityEngine.backgrounds[slugLoc] = value;
}

async function requestBackgroundForLocation(locationName) {
    const s = getSettings();
    const loc = String(locationName || "").trim();
    if (!loc) return "";
    try {
        initForgeV3();
        const eng = getRealityEngineV3();
        const slugLoc = slug(loc);
        const wd = eng.getState();
        const node = getNodeByName(loc) || s.worldState?.mapNodes?.[loc] || {};
        wd.locations[slugLoc] = {
            ...(wd.locations[slugLoc] || {}),
            id: slugLoc,
            name: loc,
            type: node.type || "ROOM",
            biome: node.theme || node.district || "generated",
            exits: s.worldState?.navGraph?.[loc] || {},
            imagePrompt: node.backgroundPrompt || "",
        };
        eng.setLocation(loc);
        const existing = eng.getBackground(loc) || s.realityEngine?.backgrounds?.[loc] || s.realityEngine?.backgrounds?.[slugLoc];
        if (isUsableLocationBackground(existing)) {
            rememberLocationBackground(s, loc, existing);
            saveSettings();
            setStageBackground(existing);
            return existing;
        }

        if (s.image?.enabled === true) {
            const asset = await requestLocationImageAsset(loc, node, {
                kind: "background",
                source: "travel_background",
                timeoutMs: 1200,
            });
            const readyUrl = String(asset?.urlAbsolute || asset?.url || "").trim();
            if (asset?.status === "ready" && isUsableLocationBackground(readyUrl)) {
                applyLocationAsset(loc, asset, node, { kind: "background" });
                rememberLocationBackground(s, loc, readyUrl);
                saveSettings();
                eng.setBackground(loc, readyUrl);
                setStageBackground(readyUrl);
                return readyUrl;
            }
            if (asset?.asset_id) {
                pollLocationImageAsset(loc, asset.asset_id, node, {
                    kind: "background",
                    onReady: (_asset, url) => {
                        if (!isUsableLocationBackground(url)) return;
                        const nextSettings = getSettings();
                        rememberLocationBackground(nextSettings, loc, url);
                        saveSettings();
                        eng.setBackground(loc, url);
                        if (loc.toLowerCase() === currentLocationName().toLowerCase()) setStageBackground(url);
                    },
                });
            }
        }

        if (isUsableLocationBackground(existing)) {
            rememberLocationBackground(s, loc, existing);
            saveSettings();
            eng.setBackground(loc, existing);
            setStageBackground(existing);
            return existing;
        }
        eng.ensureBackgroundOrRequest();
        return "";
    } catch (error) {
        console.warn("[map] Movement background generation failed", error);
        return "";
    }
}

export async function travelToLocationName(name, meta = {}) {
    if (!name) return false;
    name = deduplicateLocationPath(name);
    if (!state) loadState();
    const s = getSettings();
    if (s.jailState && s.jailState.arrested) {
        if (name !== s.jailState.prisonNodeName) {
            notify?.("warning", "You are locked in prison and cannot travel! Serve your time or break out.", "Jail");
            return false;
        }
    }
    if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
    const prev = String(s.worldState.location || "").trim();
    const node = getNodeByName(name) || s.worldState.mapNodes?.[name] || {};
    const activeName = String(s.worldState?.activeVehicle?.name || s.worldState?.activeVehicle || "").trim();
    const activeAsset = activeName ? findOwnedAssetByName(activeName) : null;
    const usingActiveAsset = Boolean(activeAsset && meta.useActiveVehicle !== false);
    if (prev && prev !== name && activeAsset && meta.useActiveVehicle === false) {
        updateTravelAssetLocation(activeAsset, prev);
        delete s.worldState.activeVehicle;
    }
    if (prev && prev !== name && usingActiveAsset) {
        const placement = evaluateTravelAssetPlacement(activeAsset, node, name);
        if (!placement.ok) {
            notify?.("warning", `${activeName} cannot travel to or park at ${name}. ${placement.reason}`, "Travel");
            return false;
        }
    }
    await decoratePlannedNode(node, meta);
    let travelEffects = null;
    if (prev && prev !== name && meta.skipTravelEffects !== true) {
        try {
            const tp = await import("./timeProgress.js");
            if (typeof tp.applyTravelEffects === "function") {
                travelEffects = tp.applyTravelEffects(s, prev, name, {
                    reason: meta.reason || "Travel",
                    vehicle: meta.vehicle || "",
                    distance: meta.distance,
                    speedModifier: meta.speedModifier,
                    useActiveVehicle: meta.useActiveVehicle !== false,
                });
            }
        } catch (err) {
            console.warn("[map] Travel effects unavailable", err);
        }
    }
    s.worldState.location = name;
    s.worldState.currentLocation = name;
    s.worldState.currentCoords = {
        x: Number(node?.coords?.x ?? node?.x ?? s.worldState.currentCoords?.x ?? 0),
        y: Number(node?.coords?.y ?? node?.y ?? s.worldState.currentCoords?.y ?? 0),
        z: Number(node?.coords?.z ?? node?.z ?? s.worldState.currentCoords?.z ?? 0),
    };
    s.worldState.x = s.worldState.currentCoords.x;
    s.worldState.y = s.worldState.currentCoords.y;
    const arrivedLocal = localForEntity(node);
    if (arrivedLocal?.name) {
        state.activeLocalName = arrivedLocal.name;
        activateVicinityForLocal(arrivedLocal.name);
    } else if ((state.area || []).some((candidate) => candidate.name === name)) {
        state.activeLocalName = name;
        activateVicinityForLocal(name);
    }
    if (usingActiveAsset) {
        updateTravelAssetLocation(activeAsset, name);
        s.worldState.activeVehicle = {
            ...(s.worldState.activeVehicle && typeof s.worldState.activeVehicle === "object" ? s.worldState.activeVehicle : {}),
            name: activeName,
            regionalLocation: name,
        };
    }
    commitAuthoritativeLocation(s, name, node, prev, meta, travelEffects);
    if (s.party && typeof s.party === "object") {
        s.party.location = name;
        if (Array.isArray(s.party.members)) {
            for (const member of s.party.members) {
                if (member && typeof member === "object") {
                    if (member.active === false || member.followsUser === false) continue;
                    member.location = name;
                    member.currentLocation = name;
                }
            }
        }
    }
    s.map = s.map || {};
    s.map.location = name;
    saveSettings();
    void syncBackendLayoutForLocation(name, node, travelEffects);
    await requestBackgroundForLocation(name);
    if (Number(travelEffects?.durabilityDamage || 0) > 0) {
        notify?.("warning", `${travelEffects.vehicle?.name || "Vehicle"} lost ${travelEffects.durabilityDamage} durability in ${travelEffects.weather?.label || "harsh weather"}.`, "Travel");
    }
    try { window.dispatchEvent(new CustomEvent("uie:state_updated", { detail: { travel: true, from: prev, to: name, effects: travelEffects } })); } catch (_) {}
    applyConstraint({ ...node, name, view: node?.blueprintParent ? "blueprint" : "area" });
    renderMap();
    renderDetails();
    return true;
}

function normalizeKey(value) {
    return slug(value, "");
}

function normalizeBarrier(barrier) {
    if (!barrier || typeof barrier !== "object") return null;
    return {
        state: barrier.unlocked ? "unlocked" : String(barrier.state || "locked"),
        requirementType: String(barrier.requirementType || barrier.type || "item"),
        requirementId: String(barrier.requirementId || barrier.requires || ""),
        lockName: String(barrier.lockName || barrier.name || "Locked Route"),
        denial: String(barrier.denial || "Access denied."),
        cost: barrier.cost && typeof barrier.cost === "object" ? barrier.cost : null,
        penalty: barrier.penalty && typeof barrier.penalty === "object" ? barrier.penalty : null,
        puzzle: barrier.puzzle && typeof barrier.puzzle === "object" ? barrier.puzzle : null,
        dc: Number(barrier.dc || 0),
        unlocked: barrier.unlocked === true,
    };
}

function allMapEntities() {
    const out = [...(state?.area || [])];
    const nearbyLists = Object.values(state?.vicinityByArea || {}).filter(Array.isArray);
    if (nearbyLists.length) {
        for (const list of nearbyLists) out.push(...list);
    } else {
        out.push(...(state?.vicinity || []));
    }
    for (const bp of Object.values(state?.blueprints || {})) out.push(...(bp?.rooms || []));
    if (state?.blueprint?.rooms) out.push(...state.blueprint.rooms);
    const seen = new Set();
    return out.filter((node) => {
        const key = String(node?.id || node?.name || "");
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function getEntityByName(name) {
    const raw = String(name || "").trim();
    return allMapEntities().find((node) => String(node.name || "").trim() === raw) || null;
}

function getBarrierForEntity(entity) {
    if (!entity) return null;
    const id = String(entity.id || entity.name || "");
    const persisted = state?.barriers?.[id] || state?.barriers?.[entity.name];
    if (!entity.barrier && !persisted) return null;
    const merged = { ...(entity.barrier || {}), ...(persisted || {}) };
    return Object.keys(merged).length ? normalizeBarrier(merged) : null;
}

function persistBarrier(entity, patch) {
    if (!entity) return;
    if (!state.barriers) state.barriers = {};
    const key = String(entity.id || entity.name || "");
    state.barriers[key] = { ...(state.barriers[key] || entity.barrier || {}), ...(patch || {}) };
    if (entity.barrier) entity.barrier = { ...entity.barrier, ...(patch || {}) };
    persist();
    syncStateToStoryGraph(state.generated?.prompt || "");
}

function hasItem(requirementId) {
    const key = normalizeKey(requirementId);
    const items = getSettings()?.inventory?.items || [];
    return items.some((item) => normalizeKey(item?.id || item?.key || item?.name || item?.title) === key);
}

function hasSkill(requirementId) {
    const key = normalizeKey(requirementId);
    const skills = getSettings()?.inventory?.skills || [];
    return skills.some((skill) => normalizeKey(skill?.id || skill?.key || skill?.name || skill?.title) === key);
}

function statValue(requirementId) {
    const s = getSettings();
    const key = normalizeKey(requirementId);
    const pools = [s?.stats, s?.character?.stats, s?.inventory?.stats, s?.attributes];
    for (const pool of pools) {
        if (!pool || typeof pool !== "object") continue;
        for (const [name, value] of Object.entries(pool)) {
            if (normalizeKey(name) === key) return Number(value || 0);
        }
    }
    return 0;
}

function canPayCost(cost = {}) {
    const s = getSettings();
    return Number(s.ap ?? 0) >= Number(cost.ap || 0) && Number(s.mp ?? 0) >= Number(cost.mp || 0) && Number(s.hp ?? 0) > Number(cost.hp || 0);
}

function spendCost(cost = {}) {
    const s = getSettings();
    if (Number(cost.ap || 0)) s.ap = Math.max(0, Number(s.ap || 0) - Number(cost.ap || 0));
    if (Number(cost.mp || 0)) s.mp = Math.max(0, Number(s.mp || 0) - Number(cost.mp || 0));
    if (Number(cost.hp || 0)) s.hp = Math.max(0, Number(s.hp || 0) - Number(cost.hp || 0));
    saveSettings();
}

function applyPenalty(penalty = {}) {
    const s = getSettings();
    if (Number(penalty.ap || 0)) s.ap = Math.max(0, Number(s.ap || 0) - Number(penalty.ap || 0));
    if (Number(penalty.mp || 0)) s.mp = Math.max(0, Number(s.mp || 0) - Number(penalty.mp || 0));
    if (Number(penalty.hp || 0)) s.hp = Math.max(0, Number(s.hp || 0) - Number(penalty.hp || 0));
    saveSettings();
}

function recentSceneText() {
    try {
        return Array.from(document.querySelectorAll("#chat-log .mes_text, #chat .mes_text, .mes .mes_text"))
            .slice(-10)
            .map((el) => String(el.innerText || el.textContent || "").trim())
            .filter(Boolean)
            .join("\n")
            .slice(-4000);
    } catch (_) {
        return "";
    }
}

function lockPickingBlockedByContext() {
    const text = `${recentSceneText()}\n${String(getSettings()?.worldState?.sceneSummary || "")}`.toLowerCase();
    return /\b(guard|guards|watchman|watchmen|teacher|police|security|camera|cameras|witness|crowd|patrol|sentinel)\b/.test(text)
        && /\b(watching|watched|sees|see you|in view|nearby|standing|patrolling|on duty|alert)\b/.test(text);
}

function setStageBackgroundBlur(blurred) {
    for (const bg of document.querySelectorAll("#re-bg, #bg1")) {
        if (bg) {
            if (blurred) {
                bg.style.filter = "blur(15px) brightness(0.7)";
                bg.style.transition = "filter 0.35s ease-in-out";
            } else {
                bg.style.filter = "";
                bg.style.transition = "filter 0.35s ease-in-out";
            }
        }
    }
}

async function startVisualLockpick(entity, barrier) {
    if (lockPickingBlockedByContext()) {
        notify?.("warning", "You cannot pick the lock while someone or something is watching.", "Navigation");
        return false;
    }
    return new Promise(async (resolve) => {
        try {
            const mod = await import("./minigames.js");
            mod.initLockpicking?.();
            
            let resolved = false;
            mod.lockPicker?.start?.({
                onSuccess: () => {
                    persistBarrier(entity, { unlocked: true, state: "unlocked" });
                    notify?.("success", `${barrier.lockName || "Lock"} picked.`, "Navigation");
                    try { window.dispatchEvent(new CustomEvent("uie:state_updated", { detail: { lockpicked: true, target: entity?.name || "" } })); } catch (_) {}
                    resolved = true;
                    resolve(true);
                },
                onFailure: () => {
                    applyPenalty(barrier.penalty || { ap: 1 });
                },
                onClose: () => {
                    if (!resolved) {
                        resolved = true;
                        resolve(false);
                    }
                }
            });
        } catch (err) {
            console.warn("[map] Lockpick minigame failed", err);
            resolve(false);
        }
    });
}

function barrierExitState(entity) {
    const barrier = getBarrierForEntity(entity);
    if (!barrier || barrier.unlocked || barrier.state === "unlocked") return { state: "open", barrier: null };
    if (barrier.state === "hidden") {
        const revealed = barrier.requirementType === "stat" ?
             statValue(barrier.requirementId || "perception") >= Number(barrier.dc || 1)
            : hasItem(barrier.requirementId);
        return { state: revealed ? "override" : "hidden", barrier };
    }
    if (barrier.requirementType === "item") return { state: hasItem(barrier.requirementId) ? "override" : "locked", barrier };
    if (barrier.requirementType === "skill") return { state: hasSkill(barrier.requirementId) && canPayCost(barrier.cost || {}) ? "override" : "locked", barrier };
    if (barrier.requirementType === "rune") return { state: "override", barrier };
    return { state: "locked", barrier };
}

function labelForExit(dir, targetName, entity) {
    const { state: exitState, barrier } = barrierExitState(entity);
    if (exitState === "hidden") return "";
    if (exitState === "locked") return `Pick Lock? ${barrier?.lockName || targetName}`;
    if (exitState === "override") {
        if (barrier?.state === "hidden") return barrier.revealName || `Pry Open: ${barrier?.lockName || targetName}`;
        if (barrier?.requirementType === "item") return `Unlock: ${barrier?.lockName || targetName}`;
        if (barrier?.requirementType === "rune") return `Trace: ${barrier?.lockName || targetName}`;
        return `Override: ${barrier?.lockName || targetName}`;
    }
    if (nodeDiscoveryState(entity) === "planned") return `Explore: Unknown ${titleCase(entity?.type || "Location")}`;
    
    let verb = "Cross to";
    if (dir === "north") verb = "Enter";
    else if (dir === "south") verb = "Return to";
    else if (dir === "east") verb = "Proceed to";
    else if (dir === "west") verb = "Cross to";
    else if (dir === "enter") verb = "Enter";
    else if (dir === "exit") verb = "Exit to";
    else if (dir.startsWith("route_")) {
        const routeName = titleCase(dir.replace("route_", "").replace(/_/g, " "));
        verb = `Follow Route (${routeName}) to`;
    } else {
        verb = `Go to`;
    }
    return `${verb}: ${targetName}`;
}

export function getContextualExits(node = null) {
    if (!state) loadState();
    const s = getSettings();
    const loc = String(node?.name || currentLocationName()).trim();
    const currentNode = node || getEntityByName(loc) || s.worldState?.mapNodes?.[loc] || s.worldState?.rooms?.[loc] || { name: loc };
    const exits = s.worldState?.navGraph?.[loc] || currentNode?.exits || {};
    const exitModifiers = currentNode?.environmentState?.exitModifiers && typeof currentNode.environmentState.exitModifiers === "object"
        ? currentNode.environmentState.exitModifiers
        : {};
    
    const validDirs = Object.keys(exits).filter((key) => {
        return DIRECTIONS.includes(key) || key === "enter" || key === "exit" || key.startsWith("route_");
    });
    
    const allDirs = Array.from(new Set([...DIRECTIONS, ...validDirs]));
    
    const mappedExits = allDirs.map((dir) => {
        const to = String(exits[dir] || "").trim();
        if (!to && !DIRECTIONS.includes(dir)) return null;
        if (!to) return { dir, to: "", state: "blocked", label: "Blocked" };
        
        const entity = getEntityByName(to) || s.worldState?.mapNodes?.[to] || s.worldState?.rooms?.[to] || { name: to };
        const barrierState = barrierExitState(entity);
        const modifier = exitModifiers[dir] || {};
        let state = barrierState.state;
        let label = labelForExit(dir, to, entity);
        if (!label) return null;
        if (modifier.state === "blocked") {
            state = "blocked";
            label = modifier.label || label;
        } else if (modifier.labelSuffix && state === "open") {
            label = `${label} (${modifier.labelSuffix})`;
        }
        return { dir, to, state, label, barrier: barrierState.barrier, environment: modifier };
    }).filter(Boolean);

    const hasExitDir = mappedExits.some(e => e.dir === "exit");
    if (currentNode.blueprintParent && currentNode.isExit && !hasExitDir) {
        const parentName = currentNode.blueprintParent;
        const entity = getEntityByName(parentName) || s.worldState?.mapNodes?.[parentName] || { name: parentName };
        const label = `Exit to ${parentName}`;
        mappedExits.push({
            dir: "exit",
            to: parentName,
            state: "open",
            label: label,
            barrier: null
        });
    }

    return mappedExits;
}

async function resolveBarrierForTravel(targetName) {
    const entity = getEntityByName(targetName) || getSettings()?.worldState?.mapNodes?.[targetName] || { name: targetName };
    const { state: exitState, barrier } = barrierExitState(entity);
    if (!barrier || exitState === "open") return true;
    if (exitState === "hidden") {
        notify?.("warning", barrier.denial || "No visible route.", "Navigation");
        return false;
    }
    if (exitState === "locked") {
        const prevLocation = getSettings()?.worldState?.location || "";
        const prevBackground = document.querySelector("#re-bg")?.style.backgroundImage || "";
        
        // Transition the background image to the target locked location's background
        const settings = getSettings();
        let targetBgUrl = "";
        const slugLoc = slug(entity.name);
        if (settings.realityEngine?.backgrounds?.[slugLoc]) {
            targetBgUrl = settings.realityEngine.backgrounds[slugLoc];
        } else if (settings.worldState?.areaScenes?.[entity.name]?.imageUrl) {
            targetBgUrl = settings.worldState.areaScenes[entity.name].imageUrl;
        }
        
        if (targetBgUrl) {
            setStageBackground(targetBgUrl);
        } else {
            const generatedUrl = await requestBackgroundForLocation(entity.name);
            if (generatedUrl) setStageBackground(generatedUrl);
        }
        
        // Blur the background
        setStageBackgroundBlur(true);
        
        // Ask the user if they want to pick the lock
        const confirm = await customConfirm(`Would you like to try picking the lock for ${entity.name || "the door"}?`);
        if (confirm) {
            const success = await startVisualLockpick(entity, barrier);
            setStageBackgroundBlur(false);
            if (success) {
                return true;
            } else {
                // Restore previous background
                if (typeof window.applyLocationBackground === "function") {
                    window.applyLocationBackground(prevLocation);
                } else if (prevBackground) {
                    const cleanUrl = prevBackground.replace(/^url\(['"]?|['"]?\)$/g, "");
                    setStageBackground(cleanUrl);
                }
                return false;
            }
        } else {
            // Restore previous background
            setStageBackgroundBlur(false);
            if (typeof window.applyLocationBackground === "function") {
                window.applyLocationBackground(prevLocation);
            } else if (prevBackground) {
                const cleanUrl = prevBackground.replace(/^url\(['"]?|['"]?\)$/g, "");
                setStageBackground(cleanUrl);
            }
            return false;
        }
    }
    if (barrier.requirementType === "rune") {
        openRuneLock(entity, barrier);
        return false;
    }
    spendCost(barrier.cost || {});
    persistBarrier(entity, { unlocked: true, state: "unlocked" });
    notify?.("success", `${barrier.lockName || "Barrier"} unlocked.`, "Navigation");
    return true;
}

export async function enterExit(dir) {
    const exit = getContextualExits(selected).find((candidate) => candidate.dir === String(dir || "").toLowerCase());
    if (!exit || !exit.to || exit.state === "blocked") return false;
    if (!(await resolveBarrierForTravel(exit.to))) return false;
    return await travelToLocationName(exit.to, { dir: exit.dir });
}

export async function unlockExit(dir) {
    const exit = getContextualExits().find((candidate) => candidate.dir === String(dir || "").toLowerCase());
    if (!exit || !exit.to || exit.state === "blocked" || exit.state === "hidden") return false;
    return await resolveBarrierForTravel(exit.to);
}

function closeRuneLock() {
    pendingRuneBarrier = null;
    $("#uie-rune-lock").prop("hidden", true).attr("aria-hidden", "true");
}

function openRuneLock(entity, barrier) {
    pendingRuneBarrier = { entity, barrier };
    const nodes = Array.isArray(barrier?.puzzle?.nodes) ? barrier.puzzle.nodes : DEFAULT_RUNE_NODES;
    const $modal = $("#uie-rune-lock").prop("hidden", false).attr("aria-hidden", "false");
    $("#uie-rune-lock-title").text(barrier.lockName || "Rune Lock");
    $("#uie-rune-lock-status").text("Trace the sequence without lifting.");
    const $board = $("#uie-rune-lock-board").empty();
    $board.append(`<svg class="uie-rune-lock__trace" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline id="uie-rune-lock-line" points="" /></svg>`);
    for (const node of nodes) {
        $board.append(`<button type="button" class="uie-rune-lock__node" data-rune-node="${esc(node.id)}" style="left:${node.x}%; top:${node.y}%;">${esc(node.id)}</button>`);
    }
    bindRuneBoard($modal[0], nodes);
}

function bindRuneBoard(modal, nodes) {
    const board = modal?.querySelector("#uie-rune-lock-board");
    if (!board) return;
    let active = false;
    let sequence = [];
    const updateLine = () => {
        const pts = sequence.map((id) => nodes.find((node) => Number(node.id) === Number(id))).filter(Boolean).map((node) => `${node.x},${node.y}`).join(" ");
        const line = board.querySelector("#uie-rune-lock-line");
        if (line) line.setAttribute("points", pts);
    };
    const hit = (event) => {
        const rect = board.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 100;
        const y = ((event.clientY - rect.top) / rect.height) * 100;
        const node = nodes.find((candidate) => Math.hypot(candidate.x - x, candidate.y - y) <= 8);
        if (!node) return;
        if (sequence[sequence.length - 1] !== node.id) sequence.push(node.id);
        board.querySelector(`[data-rune-node="${CSS.escape(String(node.id))}"]`)?.classList?.add("is-active");
        updateLine();
    };
    board.onpointerdown = (event) => {
        active = true;
        sequence = [];
        board.querySelectorAll(".uie-rune-lock__node").forEach((el) => el.classList.remove("is-active"));
        hit(event);
    };
    board.onpointermove = (event) => {
        if (active) hit(event);
    };
    board.onpointerup = () => {
        active = false;
        const key = pendingRuneBarrier?.barrier?.puzzle?.keySequence || [1, 5, 9, 8];
        const ok = JSON.stringify(sequence.map(Number)) === JSON.stringify(key.map(Number));
        if (!ok) {
            applyPenalty(pendingRuneBarrier?.barrier?.penalty || { ap: 1 });
            $("#uie-rune-lock-status").text(pendingRuneBarrier?.barrier?.denial || "The pattern fails.");
            return;
        }
        persistBarrier(pendingRuneBarrier.entity, { unlocked: true, state: "unlocked" });
        const target = pendingRuneBarrier.entity?.name;
        closeRuneLock();
        notify?.("success", "Rune sequence accepted.", "Navigation");
        if (target) travelToLocationName(target);
    };
}

async function travelToSelected() {
    if (!selected) return false;
    pendingNavigationTarget = "";
    hideNavigationPopup();
    if (selected.view === "world") {
        state.view = "region";
        selected = firstNodeForView("region");
        state.selectedId = selected?.id || "";
        persist();
        renderMap();
        notify?.("info", "World inspected. Choose a region route to continue.", "Map");
        return true;
    }
    if (selected.view === "region") {
        state.view = "area";
        selected = firstNodeForView("area");
        state.selectedId = selected?.id || "";
        persist();
        renderMap();
        notify?.("info", "Region opened. Choose a local destination to travel.", "Map");
        return true;
    }
    if (selected.blueprintId) syncBlueprintForLocation(selected.blueprintId || selected.name);
    const ok = await travelToLocationName(selected.name);
    if (ok) notify?.("success", `Traveled to ${selected.name}.`, "Map");
    return ok;
}

export async function navigateDirection(dir) {
    const direction = String(dir || "").toLowerCase();
    if (!DIRECTIONS.includes(direction)) return false;
    if (!state) loadState();
    const s = getSettings();
    if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
    if (!s.worldState.navGraph || typeof s.worldState.navGraph !== "object") s.worldState.navGraph = {};
    const loc = currentLocationName();
    let next = String(s.worldState.navGraph?.[loc]?.[direction] || "").trim();
    if (!next) next = await ensureOnDemandAdjacent(direction);
    if (!next) return false;
    if (!(await resolveBarrierForTravel(next))) return false;
    const ok = await travelToLocationName(next, { dir: direction });
    if (ok) {
        notify?.("info", `${direction.toUpperCase()} -> ${next}`, "Navigation");
        const arrived = getNodeByName(next);
        if (arrived && nodeDiscoveryState(arrived) === "planned") {
            setTimeout(() => {
                decoratePlannedNode(arrived, { dir: direction }).catch((err) => console.warn("[map] Deferred location enrichment failed", err));
            }, 0);
        }
    }
    return ok;
}

export async function previewDirectionDestination(dir) {
    const direction = String(dir || "").toLowerCase();
    if (!DIRECTIONS.includes(direction)) return null;
    if (!state) loadState();
    const s = getSettings();
    if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
    if (!s.worldState.navGraph || typeof s.worldState.navGraph !== "object") s.worldState.navGraph = {};
    const loc = currentLocationName();
    let next = String(s.worldState.navGraph?.[loc]?.[direction] || "").trim();
    if (!next) next = await ensureOnDemandAdjacent(direction);
    if (!next) return null;
    const node = getNodeByName(next) || s.worldState?.mapNodes?.[next] || null;
    return {
        dir: direction,
        to: next,
        label: next,
        state: "open",
        node,
    };
}

export function getLocationContext() {
    return getSettings()?.worldState?.mapContext || null;
}

export function getLocationContextPrompt() {
    const ctx = getLocationContext();
    if (!ctx) return "";
    const prompt = ctx.backgroundPrompt ? `\nBackgroundPrompt=${ctx.backgroundPrompt}` : "";
    return `[MAP CONTEXT]\nAuthoritativePath=${ctx.path || ""}\nView=${ctx.view}\nLocation=${ctx.location || ""}\nWorld=${ctx.world?.name || ""}\nRegion=${ctx.region?.name || ""}\nLocal=${ctx.local?.name || ""}\nRoom=${ctx.room?.name || ""}\nFaction=${ctx.faction}\nTheme=${ctx.theme}\nCoords=${ctx.coords?.x || 0},${ctx.coords?.y || 0},${ctx.coords?.z || 0}${prompt}`;
}

export function getMapPackageValidation() {
    if (!state) loadState();
    return validateMapPackage(state);
}

// Compatibility API for older buttons that still call engine-style names.
export const initMapEngine = initMap;
export const toggleMap = (mode) => (mode === "hidden" ? closeMap() : openMap());
export const renderCurrentTier = renderMap;
export const saveMapState = persist;

try {
    window.UIE_MapEngine = {
        initMap,
        initMapEngine: initMap,
        openMap,
        toggleMap,
        closeMap,
        generateForTier,
        resetMapState,
        navigateDirection,
        previewDirectionDestination,
        enterExit,
        travelToLocationName,
        preflightKnownLocationMovement,
        processOrganicLocationResponse,
        applyMoveToLocation,
        parseOrganicLocationResponse,
        getOrganicMovementPrompt,
        addOrganicLocation,
        openAddLocationModal,
        getNodeByName,
        activateVehicleMicroMap,
        getTravelAssetStatus,
        placeTravelAssetHere,
        moveToTravelAsset,
        boardTravelAsset,
        parkTravelAssetHere,
        getContextualExits,
        unlockExit,
        getLocationContext,
        getLocationContextPrompt,
        validateMapPackage: getMapPackageValidation,
        renderCurrentTier: renderMap,
    };
    window.UIE_getMapLocationContext = getLocationContextPrompt;
} catch (_) {}
