import { getSettings, saveSettings } from "./core.js";
import { buildContextualImagePrompt } from "./imageGen.js";
import { pollLocationImageAsset, requestLocationImageAsset } from "./serverAssets.js";

// ==========================================
// REALITY ENGINE V3 CORE (Standalone Shim)
// ==========================================

const slug = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
const backgroundRequests = new Map();
const DEFAULT_BACKGROUND_PRESETS = [
    { url: "./assets/backgrounds/starting-apartment-studio.png", tags: "room bedroom apartment studio interior home modern urban" },
    { url: "./assets/backgrounds/starting-classroom-modern.png", tags: "classroom academy school interior modern urban" },
    { url: "./assets/backgrounds/Classroom.png", tags: "classroom school academy interior urban" },
    { url: "./assets/backgrounds/starting-rainy-cafe.png", tags: "cafe shop restaurant interior modern urban rain" },
    { url: "./assets/backgrounds/starting-neon-transit-platform.png", tags: "transit station platform city exterior cyber futuristic urban neon" },
    { url: "./assets/backgrounds/starting-frontier-airship-dock.png", tags: "airship dock skyport exterior coastal adventure travel" },
    { url: "./assets/backgrounds/starting-moonlit-guild-hall.png", tags: "guild hall tavern inn interior fantasy urban" },
    { url: "./assets/backgrounds/adventure_path.png", tags: "road path plains exterior adventure travel field" },
    { url: "./assets/backgrounds/abandoned_cabin.png", tags: "cabin room forest interior exterior survival wild" },
    { url: "./assets/backgrounds/desolate_campsite.png", tags: "camp campsite forest wilderness exterior survival" },
    { url: "./assets/backgrounds/ruined_arena.png", tags: "arena ruins combat exterior stone" },
    { url: "./assets/backgrounds/desert_oasis.png", tags: "desert oasis exterior wild water" },
    { url: "./assets/backgrounds/sand_dunes.png", tags: "desert dunes exterior wild travel" },
    { url: "./assets/backgrounds/foggy_marsh.png", tags: "marsh swamp exterior wild fog" },
];

function stableIndex(text, length) {
    let hash = 2166136261;
    for (const ch of String(text || "")) {
        hash ^= ch.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return length ? (hash >>> 0) % length : 0;
}

export function resolveBackgroundPreset(settings, location = {}) {
    const custom = Array.isArray(settings?.image?.backgroundPresets) ? settings.image.backgroundPresets : [];
    const catalog = Array.isArray(settings?.ui?.assetCatalog?.backgrounds) ? settings.ui.assetCatalog.backgrounds : [];
    const candidates = [
        ...custom.map((entry) => typeof entry === "string" ? { url: entry, tags: "" } : entry),
        ...catalog.map((url) => ({ url, tags: "" })),
        ...DEFAULT_BACKGROUND_PRESETS,
    ].filter((entry) => String(entry?.url || "").trim() && !/uie_loading_bg|no-image-placeholder/i.test(String(entry.url)));
    if (!candidates.length) return "";
    const text = [
        location?.name,
        location?.type,
        location?.biome,
        location?.theme,
        location?.description,
        location?.imagePrompt,
    ].filter(Boolean).join(" ").toLowerCase();
    const words = new Set(text.match(/[a-z0-9]+/g) || []);
    const scored = candidates.map((entry, index) => {
        const haystack = `${entry.tags || ""} ${entry.url || ""}`.toLowerCase();
        let score = 0;
        for (const word of words) if (word.length > 3 && haystack.includes(word)) score += 1;
        return { entry, index, score };
    });
    const bestScore = Math.max(...scored.map((item) => item.score));
    const best = scored.filter((item) => item.score === bestScore);
    return String(best[stableIndex(text, best.length)]?.entry?.url || candidates[0].url).trim();
}

function applyCurrentStageBackground(src) {
    const url = String(src || "").trim();
    if (!url) return;
    try {
        if (typeof window.setLocalSceneBackgroundFromDataUrl === "function") {
            window.setLocalSceneBackgroundFromDataUrl(url);
        }
    } catch (_) {}
    for (const el of document.querySelectorAll("#re-bg, #bg1")) {
        el.style.backgroundImage = `url("${url}")`;
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
        el.style.backgroundRepeat = "no-repeat";
    }
    const root = document.getElementById("game-root");
    if (root) {
        root.style.backgroundImage = `url("${url}")`;
        root.style.backgroundSize = "cover";
        root.style.backgroundPosition = "center";
        root.style.backgroundRepeat = "no-repeat";
    }
}

function canAutoGenerateBackgrounds(s) {
    const img = s?.image || {};
    const provider = String(img.provider || "").toLowerCase();
    const endpoint = String(img.url || "").trim();
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/(|$))/i.test(endpoint);
    const isComfy = provider === "comfy" || provider === "comfyui";
    const isSd = provider === "sdwebui" || provider === "automatic1111" || provider === "sdnext";
    return img.enabled === true && (provider === "pollinations" || provider === "stability" || isSd || isComfy || local || !!String(img.key || "").trim());
}

function ensureWorldData(s) {
    if (!s.realityEngine || typeof s.realityEngine !== "object") s.realityEngine = {};
    if (!s.realityEngine.worldData || typeof s.realityEngine.worldData !== "object") {
        s.realityEngine.worldData = {
            v: "3.1",
            player: { locationId: "default", money: Number(s.currency || 0) || 0, energy: 100, timeOfDay: "day" },
            locations: {
                default: { id: "default", name: "Default", type: "ROOM", biome: "default", exits: {} }
            },
            locationRegistry: { backgrounds: {} },
            atlas: { nodes: [], links: [], explored: {}, fog: {} },
            socialGraph: { npcs: {} },
            ui: { mode: "life" }
        };
    }
    const wd = s.realityEngine.worldData;
    if (!wd.player || typeof wd.player !== "object") wd.player = { locationId: "default", money: 0, energy: 100, timeOfDay: "day" };
    if (!wd.locations || typeof wd.locations !== "object") wd.locations = { default: { id: "default", name: "Default", type: "ROOM", biome: "default", exits: {} } };
    if (!wd.locationRegistry || typeof wd.locationRegistry !== "object") wd.locationRegistry = { backgrounds: {} };
    if (!wd.locationRegistry.backgrounds || typeof wd.locationRegistry.backgrounds !== "object") wd.locationRegistry.backgrounds = {};
    if (!wd.atlas || typeof wd.atlas !== "object") wd.atlas = { nodes: [], links: [], explored: {}, fog: {} };
    if (!wd.socialGraph || typeof wd.socialGraph !== "object") wd.socialGraph = { npcs: {} };
    if (!wd.socialGraph.npcs || typeof wd.socialGraph.npcs !== "object") wd.socialGraph.npcs = {};
    if (!wd.ui || typeof wd.ui !== "object") wd.ui = { mode: "life" };
    if (typeof wd.ui.mode !== "string") wd.ui.mode = "life";
    return wd;
}

function createEmitter() {
    const map = new Map();
    return {
        on(type, fn) {
            const t = String(type || "");
            if (!t || typeof fn !== "function") return () => {};
            const arr = map.get(t) || [];
            arr.push(fn);
            map.set(t, arr);
            return () => {
                const cur = map.get(t) || [];
                map.set(t, cur.filter(f => f !== fn));
            };
        },
        emit(type, payload) {
            const t = String(type || "");
            const arr = map.get(t) || [];
            for (const fn of arr.slice()) {
                try { fn(payload); } catch (_) {}
            }
        }
    };
}

export function getRealityEngineV3() {
    if (window.UIE_realityV3) return window.UIE_realityV3;
    const ev = createEmitter();

    const api = {
        on: ev.on,
        getState() {
            const s = getSettings();
            ensureWorldData(s);
            return s.realityEngine.worldData;
        },
        save() {
            saveSettings();
        },
        ensureLocationFromWorldState() {
            const s = getSettings();
            const wd = ensureWorldData(s);
            const ws = s.worldState && typeof s.worldState === "object" ? s.worldState : {};
            const label = String(ws.location || "").trim() || "Default";
            const id = slug(label) || "default";
            if (!wd.locations[id]) wd.locations[id] = { id, name: label.slice(0, 80), type: "ROOM", biome: "default", exits: {} };
            wd.player.locationId = id;
            saveSettings();
            return id;
        },
        getCurrentLocation() {
            const wd = this.getState();
            const id = String(wd?.player?.locationId || "default");
            return wd.locations?.[id] || wd.locations?.default || { id: "default", name: "Default", exits: {} };
        },
        setLocation(id) {
            const s = getSettings();
            const wd = ensureWorldData(s);
            const k = slug(id || "") || "default";
            if (!wd.locations[k]) wd.locations[k] = { id: k, name: String(id || "Default").slice(0, 80), type: "ROOM", biome: "default", exits: {} };
            wd.player.locationId = k;
            saveSettings();
            ev.emit("location:changed", { id: k, location: wd.locations[k] });
        },
        getBackground(locationId) {
            const wd = this.getState();
            const id = slug(locationId || wd?.player?.locationId || "default") || "default";
            return String(wd?.locationRegistry?.backgrounds?.[id] || "").trim();
        },
        setBackground(locationId, dataUrl) {
            const s = getSettings();
            const wd = ensureWorldData(s);
            const id = slug(locationId || wd?.player?.locationId || "default") || "default";
            wd.locationRegistry.backgrounds[id] = String(dataUrl || "");
            saveSettings();
            if (id === slug(wd?.player?.locationId || "default")) applyCurrentStageBackground(wd.locationRegistry.backgrounds[id]);
            ev.emit("background:changed", { id, src: wd.locationRegistry.backgrounds[id] });
        },
        ensureBackgroundOrRequest() {
            const wd = this.getState();
            const id = slug(wd?.player?.locationId || "default") || "default";
            const src = String(wd?.locationRegistry?.backgrounds?.[id] || "").trim();
            if (src) return { ok: true, id, src };
            ev.emit("background:missing", { id, location: wd.locations?.[id] || null });
            return { ok: false, id, src: "" };
        },
        setMode(mode) {
            const s = getSettings();
            const wd = ensureWorldData(s);
            wd.ui.mode = String(mode || "").toLowerCase() === "rpg" ? "rpg" : "life";
            saveSettings();
            ev.emit("mode:changed", { mode: wd.ui.mode });
        }
    };

    window.UIE_realityV3 = api;
    return api;
}

// ==========================================
// WORLD FORGE (Background Gen)
// ==========================================

function buildPrompt({ location, biome, timeOfDay, lore, imagePrompt } = {}) {
    const parts = [];
    if (location) parts.push(String(location));
    if (biome) parts.push(`Biome: ${String(biome)}`);
    if (timeOfDay) parts.push(`Time: ${String(timeOfDay)}`);
    if (lore) parts.push(String(lore));
    if (imagePrompt) parts.push(String(imagePrompt));
    const base = parts.filter(Boolean).join("\n").trim();
    return base || "A detailed background scene for a visual novel style roleplay.";
}

export function initForgeV3() {
    const eng = getRealityEngineV3();
    if (window.UIE_realityForgeV3Bound) return;
    window.UIE_realityForgeV3Bound = true;

    eng.on("background:missing", async ({ id, location } = {}) => {
        const s = getSettings();
        const wd = eng.getState();
        const locId = slug(id || wd?.player?.locationId || "default") || "default";
        const loc = location || wd.locations?.[locId] || wd.locations?.default || {};
        if (backgroundRequests.has(locId)) return backgroundRequests.get(locId);
        const task = (async () => {
            const preset = resolveBackgroundPreset(s, loc);
            const visualPrompt = String(loc?.imagePrompt || "").trim();
            if (!canAutoGenerateBackgrounds(s) || !visualPrompt) {
                if (preset) eng.setBackground(locId, preset);
                return;
            }
            const prompt = buildContextualImagePrompt(buildPrompt({
                location: loc?.name || locId,
                biome: loc?.biome || "default",
                timeOfDay: wd?.player?.timeOfDay || "day",
                lore: String(s?.worldState?.status || "").trim(),
                imagePrompt: visualPrompt,
            }), {
                mode: "background",
                location: loc?.name || locId,
                hotspots: loc?.hotspots || loc?.backgroundHotspots || [],
            });
            const asset = await requestLocationImageAsset(loc?.name || locId, loc, {
                kind: "background",
                prompt,
                source: "reality_background_missing",
                timeoutMs: 1200,
            });
            const readyUrl = String(asset?.urlAbsolute || asset?.url || "").trim();
            if (asset?.status === "ready" && readyUrl) {
                eng.setBackground(locId, readyUrl);
                return;
            }
            if (preset) eng.setBackground(locId, preset);
            if (asset?.asset_id) {
                pollLocationImageAsset(loc?.name || locId, asset.asset_id, loc, {
                    kind: "background",
                    onReady: (_asset, url) => {
                        if (url) eng.setBackground(locId, url);
                    },
                });
            }
        })().finally(() => backgroundRequests.delete(locId));
        backgroundRequests.set(locId, task);
        return task;
    });
}

// ==========================================
// GAMEPLAY (stub)
// ==========================================
export function initGameplayV3() {}
export function setGameplayMode(mode) { getRealityEngineV3().setMode(mode); }

// ==========================================
// STUBS — Haptics
// ==========================================
export class HapticManager { constructor() { this.enabled = false; } vibratePWM() {} texture() {} stop() {} }
export const haptics = new HapticManager();
export function initHaptics() {}

// ==========================================
// STUBS — Audio
// ==========================================
export class ProceduralAudio { constructor() { this.enabled = false; } init() {} playSpatialTone() {} startWind() {} windLoop() {} setPitchShift() {} createVolatilityEffect() { return null; } createCommsFilter() { return null; } createVoiceEffectChain() { return null; } }
export const audio = new ProceduralAudio();
export function initAudio() {}

// ==========================================
// STUBS — Sensory helpers
// ==========================================
export function triggerHaptic() {}
export function playMaterialSound() {}
export function playFootstep() {}
export function initSensory() {}
export function updateAudioOcclusion() {}

// ==========================================
// STUBS — Input / Gestures / Trophies
// ==========================================
export function initGestures() {}
export function initInputAssist() {}
export function initTrophies() {}

// ==========================================
// STUBS — Visual Physics
// ==========================================
export class VisualPhysics { constructor() { this.trauma = 0; } init() {} addTrauma() {} }
export const physics = new VisualPhysics();
export function initVisualPhysics() {}
export function addTrauma(amount) {}

// ==========================================
// STUBS — Rune Casting
// ==========================================
export const runeCaster = { init() {}, toggle() {}, active: false };
export function initRuneCasting() {}
