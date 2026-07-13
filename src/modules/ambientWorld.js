import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";
import { ensureCausalityState, EVENT_TYPES, MODAL_DOMAINS } from "./causalityEngine.js";

const AMBIENT_VERSION = "1.0.0";
const MAX_AMBIENT_LOG = 100;
const AMBIENT_INTERVAL_MS = 45000;
let initialized = false;

function clamp(v, lo, hi) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}

function normKey(v) {
    return String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function nowMs() {
    return Date.now();
}

function seededRandom(seed) {
    let h = 2166136261;
    const s = String(seed || "");
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return () => {
        h ^= h << 13;
        h ^= h >> 17;
        h ^= h << 5;
        return (h >>> 0) / 4294967296;
    };
}

const AMBIENT_EVENT_TEMPLATES = {
    social: [
        { text: "{npc} was seen chatting animatedly with a stranger near {location}.", weight: 3 },
        { text: "{npc} helped someone carry their bags through {location}.", weight: 2 },
        { text: "{npc} got into a heated argument at {location}. Witnesses say it was about money.", weight: 1 },
        { text: "{npc} was overheard sharing gossip about recent events at {location}.", weight: 3 },
        { text: "{npc} shared a meal with someone at {location}. They seemed relaxed.", weight: 2 },
        { text: "{npc} received a mysterious letter at {location} and read it quickly before pocketing it.", weight: 1 },
    ],
    work: [
        { text: "{npc} was spotted working late at {location}.", weight: 3 },
        { text: "{npc} completed a big project at {location} and celebrated quietly.", weight: 2 },
        { text: "{npc} had a busy day at {location} and seemed exhausted.", weight: 2 },
        { text: "{npc} trained rigorously at {location}, pushing their limits.", weight: 2 },
        { text: "{npc} took on extra shifts at {location} to earn more.", weight: 1 },
    ],
    personal: [
        { text: "{npc} was seen browsing shops in {location}, looking thoughtful.", weight: 3 },
        { text: "{npc} took a quiet walk through {location} to clear their head.", weight: 2 },
        { text: "{npc} visited a familiar spot in {location} and stayed a while.", weight: 2 },
        { text: "{npc} was spotted buying something unusual in {location}.", weight: 1 },
        { text: "{npc} seemed distracted while passing through {location}.", weight: 2 },
    ],
    weather: [
        { text: "A sudden gust of wind swept through {location}.", weight: 3, outdoor: true },
        { text: "The sky darkened briefly over {location} before clearing.", weight: 2, outdoor: true },
        { text: "Street vendors in {location} hurried to cover their stalls.", weight: 2, outdoor: true },
        { text: "A warm breeze carried the scent of food through {location}.", weight: 2, outdoor: true },
    ],
    world: [
        { text: "Rumors are spreading about strange happenings near {location}.", weight: 2 },
        { text: "Travelers passing through {location} mentioned unusual activity on the roads.", weight: 2 },
        { text: "A merchant caravan arrived at {location} with exotic goods.", weight: 1 },
        { text: "The guards at {location} increased their patrols after a recent incident.", weight: 1 },
        { text: "A festival is being planned for {location} next week.", weight: 1 },
    ],
};

function ensureAmbientState(s) {
    const c = ensureCausalityState(s);
    if (!c.ambient || typeof c.ambient !== "object") c.ambient = {};
    if (!Array.isArray(c.ambient.log)) c.ambient.log = [];
    if (typeof c.ambient.lastTickAt !== "number") c.ambient.lastTickAt = 0;
    if (typeof c.ambient.enabled !== "boolean") c.ambient.enabled = true;
    if (typeof c.ambient.tickIntervalMs !== "number") c.ambient.tickIntervalMs = AMBIENT_INTERVAL_MS;
    if (typeof c.ambient.maxEventsPerTick !== "number") c.ambient.maxEventsPerTick = 3;
    return c.ambient;
}

function pickWeighted(templates, rng) {
    const total = templates.reduce((sum, t) => sum + (t.weight || 1), 0);
    let roll = rng() * total;
    for (const t of templates) {
        roll -= (t.weight || 1);
        if (roll <= 0) return t;
    }
    return templates[templates.length - 1];
}

function getAvailableNpcs(s) {
    const social = s?.social || {};
    const names = [];
    for (const group of ["friends", "associates", "romance", "family", "rivals"]) {
        const list = Array.isArray(social[group]) ? social[group] : [];
        for (const entry of list) {
            const name = String(entry?.name || "").trim();
            if (name) names.push({ name, group });
        }
    }
    return names;
}

function getLocations(s) {
    const locs = new Set();
    const current = String(s?.worldState?.location || "").trim();
    if (current) locs.add(current);
    const places = Array.isArray(s?.map?.places) ? s.map.places : [];
    for (const p of places) {
        const name = String(p?.name || "").trim();
        if (name) locs.add(name);
    }
    return Array.from(locs);
}

function generateAmbientEvent(s, rng) {
    const npcs = getAvailableNpcs(s);
    const locations = getLocations(s);
    if (!npcs.length || !locations.length) return null;
    const categories = Object.keys(AMBIENT_EVENT_TEMPLATES);
    const category = categories[Math.floor(rng() * categories.length)];
    const templates = AMBIENT_EVENT_TEMPLATES[category];
    if (!templates.length) return null;
    const template = pickWeighted(templates, rng);
    const npc = npcs[Math.floor(rng() * npcs.length)];
    const location = locations[Math.floor(rng() * locations.length)];
    const text = template.text
        .replace(/\{npc\}/g, npc.name)
        .replace(/\{location\}/g, location);
    return {
        id: `ambient_${nowMs()}_${Math.random().toString(36).slice(2, 8)}`,
        category,
        text,
        npc: npc.name,
        location,
        npcGroup: npc.group,
        timestamp: nowMs(),
        seen: false,
    };
}

function tickAmbientWorld(s, force) {
    const ambient = ensureAmbientState(s);
    if (!ambient.enabled && !force) return { generated: [] };
    const now = nowMs();
    if (!force && now - ambient.lastTickAt < ambient.tickIntervalMs) return { generated: [] };
    ambient.lastTickAt = now;
    const seed = `${now}_${s?.worldState?.location || "world"}`;
    const rng = seededRandom(seed);
    const count = Math.max(1, Math.min(ambient.maxEventsPerTick, Math.floor(rng() * ambient.maxEventsPerTick) + 1));
    const generated = [];
    for (let i = 0; i < count; i++) {
        const event = generateAmbientEvent(s, rng);
        if (event) {
            generated.push(event);
            ambient.log.unshift(event);
        }
    }
    ambient.log = ambient.log.slice(0, MAX_AMBIENT_LOG);
    saveSettings();
    return { generated };
}

function getAmbientLog(s, limit) {
    const ambient = ensureAmbientState(s);
    const max = Math.max(1, Math.min(50, Number(limit || 10)));
    return ambient.log.slice(0, max);
}

function getUnseenAmbient(s) {
    const ambient = ensureAmbientState(s);
    const unseen = ambient.log.filter((e) => !e.seen);
    for (const e of unseen) e.seen = true;
    saveSettings();
    return unseen;
}

function setAmbientEnabled(s, enabled) {
    const ambient = ensureAmbientState(s);
    ambient.enabled = Boolean(enabled);
    saveSettings();
    return ambient.enabled;
}

function initAmbientWorld() {
    if (initialized) return;
    initialized = true;
    const s = getSettings();
    ensureAmbientState(s);
    try {
        window.UIE = window.UIE || {};
        window.UIE.ambient = {
            tick: (force) => tickAmbientWorld(getSettings(), force),
            getLog: (limit) => getAmbientLog(getSettings(), limit),
            getUnseen: () => getUnseenAmbient(getSettings()),
            setEnabled: (v) => setAmbientEnabled(getSettings(), v),
            version: AMBIENT_VERSION,
        };
    } catch (_) {}
    let ambientTimer = null;
    try {
        ambientTimer = setInterval(() => {
            try {
                const state = getSettings();
                const result = tickAmbientWorld(state, false);
                if (result.generated && result.generated.length) {
                    const first = result.generated[0];
                    if (first) {
                        try {
                            notify("info", first.text.slice(0, 80), "World Event", "ambient");
                        } catch (_) {}
                    }
                }
            } catch (_) {}
        }, AMBIENT_INTERVAL_MS);
    } catch (_) {}
    try {
        window.addEventListener("uie:time_advanced", () => {
            try {
                const state = getSettings();
                tickAmbientWorld(state, true);
            } catch (_) {}
        });
    } catch (_) {}
}

export {
    AMBIENT_VERSION,
    ensureAmbientState,
    tickAmbientWorld,
    getAmbientLog,
    getUnseenAmbient,
    setAmbientEnabled,
    generateAmbientEvent,
    initAmbientWorld,
};
