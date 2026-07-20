import { getContext } from "./gameContext.js";
import { applyCurrencySettings, getCurrencyPreset } from "./economy.js";

const EXT_ID = "universal-immersion-engine";

const MIRROR_KEY = "uie_settings_mirror_v1";
const MIRROR_IDB_FLAG_KEY = "uie_settings_mirror_idb_v1";
const MIRROR_IDB_DB = "uie_settings_mirror";
const MIRROR_IDB_STORE = "mirror";
const MIRROR_IDB_ID = "current";
let saveRetryScheduled = false;
let mirrorWriteTimer = null;
let mirrorWritePendingData = null;
let mirrorWriteInFlight = false;
const MIRROR_WRITE_DELAY_MS = 900;

let bootstrapSettings = {};
let bootstrapTouched = false;

const INIT_GRACE_MS = 30000;
const INIT_DEADLINE = Date.now() + INIT_GRACE_MS;

let mirrorIdbCache = null;
let mirrorIdbLoadPromise = null;
let mirrorIdbLoadComplete = false;
let mirrorRestoreChecked = false;
let deferredSanitizeScheduled = false;

function applyMirrorToCurrent(data) {
    try {
        if (!isNonEmptyObject(data)) return false;
        if (!window.extension_settings) window.extension_settings = {};
        if (!window.extension_settings[EXT_ID] || typeof window.extension_settings[EXT_ID] !== "object") {
            window.extension_settings[EXT_ID] = {};
        }
        const current = window.extension_settings[EXT_ID];
        try {
            const curAt = Number(current?.__uie_saved_at || 0) || 0;
            const mirAt = Number(data?.__uie_saved_at || 0) || 0;
            if (hasUserData(current) && mirAt > 0 && curAt > 0 && mirAt <= curAt + 250) return false;
            if (hasUserData(current) && mirAt <= 0) return false;
        } catch (_) {
            if (hasUserData(current)) return false;
        }
        for (const k of Object.keys(current)) delete current[k];
        for (const [k, v] of Object.entries(data)) current[k] = v;

        try {
            setTimeout(() => {
                try { window.UIE_refreshStateSaves?.(); } catch (_) {}
                try {
                    const event = new CustomEvent("uie:state_updated", { detail: { mirror: true } });
                    window.dispatchEvent(event);
                } catch (_) {}
                try { updateLayout(); } catch (_) {}
            }, 0);
        } catch (_) {}
        return true;
    } catch (_) {
        return false;
    }
}

function openMirrorDb() {
    return new Promise((resolve, reject) => {
        try {
            const req = indexedDB.open(MIRROR_IDB_DB, 1);
            req.onupgradeneeded = () => {
                try {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(MIRROR_IDB_STORE)) {
                        db.createObjectStore(MIRROR_IDB_STORE, { keyPath: "id" });
                    }
                } catch (_) {}
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        } catch (e) {
            reject(e);
        }
    });
}

async function mirrorDbPut(payload) {
    const db = await openMirrorDb();
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(MIRROR_IDB_STORE, "readwrite");
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
            tx.objectStore(MIRROR_IDB_STORE).put(payload);
        } catch (e) {
            reject(e);
        }
    }).finally(() => {
        try { db.close(); } catch (_) {}
    });
}

async function mirrorDbGet() {
    const db = await openMirrorDb();
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(MIRROR_IDB_STORE, "readonly");
            const req = tx.objectStore(MIRROR_IDB_STORE).get(MIRROR_IDB_ID);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        } catch (e) {
            reject(e);
        }
    }).finally(() => {
        try { db.close(); } catch (_) {}
    });
}

function kickMirrorIdbLoad() {
    try {
        if (mirrorIdbLoadPromise) return mirrorIdbLoadPromise;
        mirrorIdbLoadPromise = (async () => {
            try {
                const rec = await mirrorDbGet();
                const data = rec?.data;
                if (isNonEmptyObject(data)) {
                    try {
                        if (!Number(data.__uie_saved_at) && Number(rec?.at || 0)) data.__uie_saved_at = Number(rec.at || 0) || Date.now();
                    } catch (_) {}
                    mirrorIdbCache = { at: Number(rec?.at || 0) || 0, data };
                    try { localStorage.setItem(MIRROR_IDB_FLAG_KEY, String(mirrorIdbCache.at || Date.now())); } catch (_) {}
                    try { applyMirrorToCurrent(mirrorIdbCache.data); } catch (_) {}
                } else {
                    try { localStorage.removeItem(MIRROR_IDB_FLAG_KEY); } catch (_) {}
                }
            } catch (_) {}
            return mirrorIdbCache;
        })().finally(() => {
            mirrorIdbLoadComplete = true;
        });
        return mirrorIdbLoadPromise;
    } catch (_) {
        return null;
    }
}

// Kick off IndexedDB mirror load early so bootstrap mode can hydrate quickly even when localStorage is full.
try { kickMirrorIdbLoad(); } catch (_) {}

export async function waitForSettingsHydration(timeoutMs = 2500) {
    const pending = kickMirrorIdbLoad();
    if (pending && !mirrorIdbLoadComplete) {
        const timeout = Math.max(250, Number(timeoutMs) || 2500);
        await Promise.race([
            pending.catch(() => null),
            new Promise((resolve) => setTimeout(resolve, timeout)),
        ]);
    }
    try { restoreFromMirrorIfEmpty(); } catch (_) {}
    return getSettings();
}

function deferSanitizeUntilSettingsHydrate() {
    if (deferredSanitizeScheduled || mirrorIdbLoadComplete || !mirrorIdbLoadPromise) return;
    deferredSanitizeScheduled = true;
    mirrorIdbLoadPromise.finally(() => {
        deferredSanitizeScheduled = false;
        try { restoreFromMirrorIfEmpty(); } catch (_) {}
        try { sanitizeSettings(); } catch (_) {}
        try {
            window.dispatchEvent(new CustomEvent("uie:state_updated", {
                detail: { settingsHydrated: true },
            }));
        } catch (_) {}
        try { updateLayout(); } catch (_) {}
    });
}

function isPersistentSettingsReady() {
    try {
        const es = window.extension_settings;
        if (!es || typeof es !== "object") return false;
        if (Object.prototype.hasOwnProperty.call(es, EXT_ID)) return true;
        // If we have a non-empty mirror snapshot, we can safely create & hydrate the bucket.
        try { if (hasNonEmptyMirror()) return true; } catch (_) {}
        // After a grace period, assume ST isn't going to hydrate the bucket for us.
        return Date.now() > INIT_DEADLINE;
    } catch (_) {
        return false;
    }
}

function hasUserData(s) {
    try {
        if (!s || typeof s !== "object") return false;

        // Fix: If a custom character name or class is registered, it HAS active user data!
        const charName = String(s?.character?.name || "").trim();
        if (charName && charName !== "User" && charName !== "") return true;

        const invItems = Array.isArray(s?.inventory?.items) ? s.inventory.items.length : 0;
        const hasSavedStates = s.savedStates && typeof s.savedStates === "object" && Object.keys(s.savedStates).length > 0;
        const hasCalendar = s.calendar && typeof s.calendar === "object" && s.calendar.events && Object.keys(s.calendar.events || {}).length > 0;
        const hasMap = !!(s.map && (s.map.image || (Array.isArray(s.map?.data?.nodes) && s.map.data.nodes.length)));
        const hasSocial = s.social && typeof s.social === "object" && Object.values(s.social).some(v => Array.isArray(v) && v.length);
        const hasDiary = s.diary && typeof s.diary === "object" && Object.keys(s.diary).length > 0;
        const hasDatabank = s.databank && typeof s.databank === "object" && Object.keys(s.databank).length > 0;
        const hasDatabankNodes = Array.isArray(s.databankNodes) && s.databankNodes.length > 0;
        const hasImageSettings = s.image && typeof s.image === "object" && (
            String(s.image.key || "").trim() ||
            String(s.image.provider || "").trim() ||
            String(s.image.url || "").trim() ||
            String(s.image.model || "").trim() ||
            String(s.image.stabilityKey || "").trim() ||
            String(s.image.comfyKey || "").trim()
        );
        return invItems > 0 || hasSavedStates || hasCalendar || hasMap || hasSocial || hasDiary || hasDatabank || hasDatabankNodes || !!hasImageSettings;
    } catch (_) {
        return false;
    }
}

function safeJson(obj) {
    try {
        const seen = new WeakSet();
        return JSON.stringify(obj, (k, v) => {
            try {
                if (typeof v === "function") return undefined;
                if (typeof v === "bigint") return Number(v);
                if (v && typeof v === "object") {
                    if (seen.has(v)) return undefined;
                    seen.add(v);
                }
            } catch (_) {}
            return v;
        });
    } catch (_) {
        try {
            return JSON.stringify(JSON.parse(JSON.stringify(obj)));
        } catch (_) {
            return "";
        }
    }
}

function isNonEmptyObject(o) {
    try {
        return !!(o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length > 0);
    } catch (_) {
        return false;
    }
}

function looksEmptySettings(s) {
    try {
        if (!s || typeof s !== "object") return true;

        // Fix: If a custom character name is registered, it is NOT empty! Protect new game state.
        const charName = String(s?.character?.name || "").trim();
        if (charName && charName !== "User" && charName !== "") return false;

        const keys = Object.keys(s);
        if (!keys.length) return true;
        const invItems = Array.isArray(s?.inventory?.items) ? s.inventory.items.length : 0;
        const hasSavedStates = s.savedStates && typeof s.savedStates === "object" && Object.keys(s.savedStates).length > 0;
        const hasCalendar = s.calendar && typeof s.calendar === "object" && s.calendar.events && Object.keys(s.calendar.events || {}).length > 0;
        const hasMap = !!(s.map && (s.map.image || (Array.isArray(s.map?.data?.nodes) && s.map.data.nodes.length)));
        const hasSocial = s.social && typeof s.social === "object" && Object.values(s.social).some(v => Array.isArray(v) && v.length);
        const hasDiary = s.diary && typeof s.diary === "object" && Object.keys(s.diary).length > 0;
        const hasDatabank = s.databank && typeof s.databank === "object" && Object.keys(s.databank).length > 0;
        const hasDatabankNodes = Array.isArray(s.databankNodes) && s.databankNodes.length > 0;
        const hasConnections = s.connections && typeof s.connections === "object" && Object.keys(s.connections).length > 0;
        const hasAiPromptProfiles = s.aiPromptProfiles && typeof s.aiPromptProfiles === "object" && Object.keys(s.aiPromptProfiles).length > 0;
        const hasImageSettings = s.image && typeof s.image === "object" && (
            String(s.image.key || "").trim() ||
            String(s.image.provider || "").trim() ||
            String(s.image.url || "").trim() ||
            String(s.image.model || "").trim() ||
            String(s.image.stabilityKey || "").trim() ||
            String(s.image.comfyKey || "").trim()
        );
        if (invItems > 0) return false;
        if (hasSavedStates || hasCalendar || hasMap || hasSocial || hasDiary || hasDatabank || hasDatabankNodes || hasImageSettings || hasConnections || hasAiPromptProfiles) return false;

        const keep = ["inventory", "image", "windows", "ui", "currencySymbol", "currencyRate", "connections", "aiPromptProfiles"].filter(Boolean);
        const meaningful = keys.filter(k => !keep.includes(k));
        return meaningful.length === 0;
    } catch (_) {
        return false;
    }
}

 function hasNonEmptyMirror() {
     try {
         const raw = localStorage.getItem(MIRROR_KEY);
         if (!raw) {
            try {
                if (mirrorIdbCache && isNonEmptyObject(mirrorIdbCache.data)) return true;
            } catch (_) {}
            try { kickMirrorIdbLoad(); } catch (_) {}
            try { if (mirrorIdbLoadPromise && !mirrorIdbLoadComplete) return true; } catch (_) {}
            try {
                const flag = localStorage.getItem(MIRROR_IDB_FLAG_KEY);
                if (flag) return true;
            } catch (_) {}
            return false;
         }
         let payload = null;
         try { payload = JSON.parse(raw); } catch (_) { payload = null; }
         const data = payload?.data;
         return isNonEmptyObject(data);
     } catch (_) {
        try {
            const flag = localStorage.getItem(MIRROR_IDB_FLAG_KEY);
            if (flag) return true;
        } catch (_) {}
        return false;
     }
 }

function writeMirror() {
    try {
        const s = window.extension_settings?.[EXT_ID];
        if (!isNonEmptyObject(s)) return;
        const payload = { at: Date.now(), data: JSON.parse(safeJson(s) || "{}") };
        localStorage.setItem(MIRROR_KEY, safeJson(payload) || "");
    } catch (e) {
        try {
            // Silently handle localStorage quota errors
            window.UIE_mirrorWriteErrorShown = true;
        } catch (_) {}

        try {
            const s = window.extension_settings?.[EXT_ID];
            if (!isNonEmptyObject(s)) return;
            const at = Date.now();
            const data = JSON.parse(safeJson(s) || "{}") || {};
            void mirrorDbPut({ id: MIRROR_IDB_ID, at, data }).then(() => {
                mirrorIdbCache = { at, data };
                try { localStorage.setItem(MIRROR_IDB_FLAG_KEY, String(at)); } catch (_) {}
                try { applyMirrorToCurrent(mirrorIdbCache.data); } catch (_) {}
            }).catch((err) => {
                // Silently log real DB failures to console without toastr pollution
                try { console.warn("[UIE] IndexedDB mirror write failed", err); } catch (_) {}
            });
        } catch (_) {}
    }
}

function writeMirrorFrom(data) {
    if (!isNonEmptyObject(data)) return;
    const at = Date.now();
    const copy = JSON.parse(safeJson(data) || "{}") || {};
    try {
        const payload = { at, data: copy };
        localStorage.setItem(MIRROR_KEY, safeJson(payload) || "");
    } catch (e) {
        try {
            // Silently handle localStorage quota errors
            window.UIE_mirrorWriteErrorShown = true;
        } catch (_) {}
    }

    // Keep a second, repository-independent copy even when localStorage succeeds.
    if (typeof indexedDB !== "undefined") {
        void mirrorDbPut({ id: MIRROR_IDB_ID, at, data: copy }).then(() => {
            mirrorIdbCache = { at, data: copy };
            try { localStorage.setItem(MIRROR_IDB_FLAG_KEY, String(at)); } catch (_) {}
        }).catch((err) => {
            try { console.warn("[UIE] IndexedDB mirror write failed", err); } catch (_) {}
        });
    }
}

function scheduleMirrorWrite(data) {
    try {
        if (!isNonEmptyObject(data)) return;
        mirrorWritePendingData = data;
        if (mirrorWriteTimer) clearTimeout(mirrorWriteTimer);
        mirrorWriteTimer = setTimeout(flushMirrorWrite, MIRROR_WRITE_DELAY_MS);
    } catch (_) {}
}

function flushMirrorWrite() {
    mirrorWriteTimer = null;
    if (mirrorWriteInFlight) {
        if (mirrorWritePendingData) scheduleMirrorWrite(mirrorWritePendingData);
        return;
    }

    const data = mirrorWritePendingData;
    mirrorWritePendingData = null;
    if (!isNonEmptyObject(data)) return;

    mirrorWriteInFlight = true;
    try {
        writeMirrorFrom(data);
    } finally {
        mirrorWriteInFlight = false;
        if (mirrorWritePendingData) scheduleMirrorWrite(mirrorWritePendingData);
    }
}

try {
    window.addEventListener("pagehide", () => {
        try { flushMirrorWrite(); } catch (_) {}
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            try { flushMirrorWrite(); } catch (_) {}
        }
    });
} catch (_) {}

function readMirrorData() {
    try {
        const raw = localStorage.getItem(MIRROR_KEY);
        if (!raw) {
            try {
                if (mirrorIdbCache && isNonEmptyObject(mirrorIdbCache.data)) return mirrorIdbCache.data;
                try { kickMirrorIdbLoad(); } catch (_) {}
            } catch (_) {}
            return null;
        }
        let payload = null;
        try { payload = JSON.parse(raw); } catch (_) { payload = null; }
        const data = payload?.data;
        if (!isNonEmptyObject(data)) return null;
        return data;
    } catch (_) {
        try {
            if (mirrorIdbCache && isNonEmptyObject(mirrorIdbCache.data)) return mirrorIdbCache.data;
            const flag = localStorage.getItem(MIRROR_IDB_FLAG_KEY);
            if (flag) kickMirrorIdbLoad();
        } catch (_) {}
        return null;
    }
}

function readMirrorPayload() {
    try {
        const raw = localStorage.getItem(MIRROR_KEY);
        if (!raw) {
            try {
                if (mirrorIdbCache && isNonEmptyObject(mirrorIdbCache.data)) {
                    return { at: Number(mirrorIdbCache.at || 0) || 0, data: mirrorIdbCache.data };
                }
                try { kickMirrorIdbLoad(); } catch (_) {}
            } catch (_) {}
            return null;
        }
        let payload = null;
        try { payload = JSON.parse(raw); } catch (_) { payload = null; }
        const data = payload?.data;
        if (!isNonEmptyObject(data)) return null;
        const at = Number(payload?.at || 0);
        return { at: Number.isFinite(at) ? at : 0, data };
    } catch (_) {
        try {
            if (mirrorIdbCache && isNonEmptyObject(mirrorIdbCache.data)) {
                return { at: Number(mirrorIdbCache.at || 0) || 0, data: mirrorIdbCache.data };
            }
            const flag = localStorage.getItem(MIRROR_IDB_FLAG_KEY);
            if (flag) kickMirrorIdbLoad();
        } catch (_) {}
        return null;
    }
}

function restoreFromMirrorIfEmpty() {
    try {
        if (!isPersistentSettingsReady()) return;
        if (!window.extension_settings) window.extension_settings = {};
        if (!window.extension_settings[EXT_ID]) window.extension_settings[EXT_ID] = {};
        const current = window.extension_settings[EXT_ID];

        const payload = readMirrorPayload();
        const data = payload?.data;
        if (!isNonEmptyObject(data)) return;

        try {
            const curAt = Number(current?.__uie_saved_at || 0) || 0;
            const mirAt = Number(payload?.at || data?.__uie_saved_at || 0) || 0;

            // Fix: If current in-memory settings are newer or equal to mirror, do NOT overwrite them!
            if (curAt > 0 && mirAt > 0 && curAt >= mirAt) return;

            if (hasUserData(current) && mirAt > 0 && curAt > 0 && mirAt <= curAt + 250) return;
            if (hasUserData(current) && mirAt <= 0) return;
        } catch (_) {
            if (hasUserData(current)) return;
        }

        for (const k of Object.keys(current)) delete current[k];
        for (const [k, v] of Object.entries(data)) current[k] = v;

        try {
            setTimeout(() => {
                try { window.UIE_refreshStateSaves?.(); } catch (_) {}
                try {
                    const event = new CustomEvent("uie:state_updated", { detail: { mirror: true } });
                    window.dispatchEvent(event);
                } catch (_) {}
                try { updateLayout(); } catch (_) {}
            }, 0);
        } catch (_) {}
    } catch (_) {}
}



export function getSettings() {
    if (!isPersistentSettingsReady()) {
        bootstrapTouched = true;
        try {
            const snap = readMirrorData();
            if (snap && bootstrapSettings && typeof bootstrapSettings === "object" && looksEmptySettings(bootstrapSettings)) {
                bootstrapSettings = JSON.parse(safeJson(snap) || "{}") || {};
            }
        } catch (_) {}
        return bootstrapSettings;
    }

    if (!window.extension_settings) window.extension_settings = {};
    if (!window.extension_settings[EXT_ID] || typeof window.extension_settings[EXT_ID] !== "object") {
        window.extension_settings[EXT_ID] = {};
    }

    const s = window.extension_settings[EXT_ID];

    // Migration: Extract bloated save keys to window variables & delete from active settings
    try {
        let migrated = false;
        if (s && s.savedStates) {
            window.UIE_savedStates = { ...(window.UIE_savedStates || {}), ...s.savedStates };
            delete s.savedStates;
            migrated = true;
        }
        if (s && s.storySaveSlots) {
            window.UIE_storySaveSlots = [
                ...(window.UIE_storySaveSlots || []),
                ...s.storySaveSlots
            ];
            const seenIds = new Set();
            window.UIE_storySaveSlots = window.UIE_storySaveSlots.filter(x => {
                const id = String(x?.id || "");
                if (!id || seenIds.has(id)) return false;
                seenIds.add(id);
                return true;
            });
            delete s.storySaveSlots;
            migrated = true;
        }
        if (migrated) {
            setTimeout(() => {
                try {
                    saveSettings();
                    try { window.UIE_saveSavedStatesToDb?.(window.UIE_savedStates); } catch (_) {}
                    try { window.UIE_saveStorySaveSlotsToDb?.(window.UIE_storySaveSlots); } catch (_) {}
                } catch (_) {}
            }, 500);
        }
    } catch (_) {}

    // Always try to restore persisted settings BEFORE merging any bootstrap defaults.
    // Bootstrap mutations can happen early (before ST hydrates extension_settings) and would otherwise
    // make the bucket look non-empty, preventing mirror restore and causing settings loss.
    if (!mirrorRestoreChecked) {
        restoreFromMirrorIfEmpty();
        mirrorRestoreChecked = true;
    }

    if (bootstrapTouched && bootstrapSettings && typeof bootstrapSettings === "object") {
        try {
            for (const [k, v] of Object.entries(bootstrapSettings)) {
                if (!(k in s)) s[k] = v;
            }
        } catch (_) {}
        bootstrapTouched = false;
        bootstrapSettings = {};
    }
    return s;
}

export function saveSettings() {
    const context = window.UIE_STANDALONE === true ? null : getContext();
    if (!isPersistentSettingsReady()) {
        bootstrapTouched = true;
        try { if (bootstrapSettings && typeof bootstrapSettings === "object") bootstrapSettings.__uie_saved_at = Date.now(); } catch (_) {}
        try { scheduleMirrorWrite(bootstrapSettings); } catch (_) {}
        if (!saveRetryScheduled) {
            saveRetryScheduled = true;
            setTimeout(() => {
                saveRetryScheduled = false;
                try { saveSettings(); } catch (_) {}
            }, 1000);
        }
        return;
    }

    // IMPORTANT: Ensure any bootstrap writes are merged into the real settings bucket
    // BEFORE we persist to mirror / ST disk. Otherwise we can end up saving an empty bucket.
    let live = null;
    try { live = getSettings(); } catch (_) { live = null; }
    
    // Ensure chat state is synced before saving
    try { saveCurrentChatState(); } catch (_) {}

    try { window.UIE_backupMaybe?.(); } catch (_) {}
    try {
        if (live && typeof live === "object") {
            try { live.__uie_saved_at = Date.now(); } catch (_) {}
            scheduleMirrorWrite(live);
        }
        else {
            const current = window.extension_settings?.[EXT_ID];
            if (current && typeof current === "object") scheduleMirrorWrite(current);
        }
    } catch (_) {}

    const saveFn = (() => {
        try {
            if (context && typeof context.saveSettingsDebounced === "function") {
                return () => context.saveSettingsDebounced();
            }
            if (context && typeof context.saveSettings === "function") {
                return () => context.saveSettings();
            }
            if (typeof window.saveSettingsDebounced === "function") {
                return () => window.saveSettingsDebounced();
            }
        } catch (_) {}
        return null;
    })();

    if (saveFn) {
        try { saveFn(); } catch (_) {}
        return;
    }

    if (!saveRetryScheduled) {
        saveRetryScheduled = true;
        setTimeout(() => {
            saveRetryScheduled = false;
            try {
                const ctx = getContext();
                if (ctx && typeof ctx.saveSettingsDebounced === "function") ctx.saveSettingsDebounced();
                else if (ctx && typeof ctx.saveSettings === "function") ctx.saveSettings();
                else if (typeof window.saveSettingsDebounced === "function") window.saveSettingsDebounced();
            } catch (_) {}
        }, 1000);
    }
}

export function commitStateUpdate(opts = {}) {
    saveSettings();
    if (opts.layout) updateLayout();
    if (opts.emit) {
        // Dispatch global event for state changes if needed
        const event = new CustomEvent("uie:state_updated", { detail: opts });
        window.dispatchEvent(event);
    }
}

const LIBRARY_KEYS_GUARD_EMPTY = new Set(["character_cards", "lorebooks", "personas"]);

function mergeConnectionObjects(base, incoming) {
    const out = base && typeof base === "object" ? { ...base } : {};
    if (!incoming || typeof incoming !== "object") return out;
    for (const [k, v] of Object.entries(incoming)) {
        if (v === undefined) continue;
        if (k === "mainProfiles" && Array.isArray(v)) {
            const existing = Array.isArray(out.mainProfiles) ? out.mainProfiles : [];
            const byId = new Map(existing.map((p) => [String(p?.id || "").trim(), { ...p }]));
            for (const p of v) {
                const id = String(p?.id || "").trim();
                if (!id) continue;
                const prev = byId.get(id) || {};
                byId.set(id, { ...prev, ...p });
            }
            out.mainProfiles = Array.from(byId.values());
        } else {
            out[k] = v;
        }
    }
    return out;
}

/**
 * Merge `incoming` into UIE settings object `current` (same reference as getSettings()).
 * @param {object} current
 * @param {object} incoming
 * @param {{ allowEmptyLibraryWipe?: boolean, mergeConnections?: boolean }} [opts] — default true (load-save). Set false for story imports so empty arrays do not wipe libraries. mergeConnections: upsert mainProfiles instead of replacing connections wholesale (story package import).
 */
export function applyFullState(current, incoming, opts = {}) {
    try {
        if (!current || typeof current !== "object" || !incoming || typeof incoming !== "object") return;
        const allowEmptyLibraryWipe = opts.allowEmptyLibraryWipe !== false;
        const mergeConn = opts.mergeConnections === true;
        for (const [k, v] of Object.entries(incoming)) {
            if (v === undefined) continue;
            if (!allowEmptyLibraryWipe && LIBRARY_KEYS_GUARD_EMPTY.has(k) && Array.isArray(v) && v.length === 0) continue;
            if (k === "connections" && v && typeof v === "object") {
                current.connections = mergeConn ? mergeConnectionObjects(current.connections, v) : v;
                continue;
            }
            current[k] = v;
        }
    } catch (_) {}
}

const NEW_GAME_PRESERVE_KEYS = new Set([
    "enabled",
    "connections",
    "mainApi",
    "turbo",
    "generation",
    "image",
    "ai",
    "features",
    "ui",
    "windows",
    "windowBackgrounds",
    "chatbox",
    "themes",
    "activeTheme",
    "language",
    "savedApiKeys",
    "aiPromptProfiles",
    "rpgSettings",
    "character_cards",
    "personas",
    "lorebooks",
    "assets",
    "audio",
    "music",
    "timeProgress",
    "savedStates",
    "mods",
    "launcher",
    "launcherX",
    "launcherY",
    "menuHidden",
    "menuX",
    "menuY",
    "rpg",
    "inventoryDesktopFullscreen",
]);

function cloneSettingValue(value) {
    try {
        return JSON.parse(safeJson(value));
    } catch (_) {
        return value;
    }
}

function cleanPreservedUi(ui) {
    const out = ui && typeof ui === "object" ? cloneSettingValue(ui) : {};
    for (const key of [
        "storyIntro",
        "sceneCharacters",
        "priorityBeatPrompt",
        "customTrackers",
        "manualBedroomBg",
        "lastRoomPlan",
    ]) {
        delete out[key];
    }
    if (out.backgrounds && typeof out.backgrounds === "object") delete out.backgrounds.vnRoom;
    if (out.notifications?.lowHp) out.notifications.lowHp.lastWarnAt = 0;
    return out;
}

/**
 * Clears active game/session data while preserving configuration, reusable
 * character libraries, personas, and manual save slots.
 */
export function resetForNewGame(settings = null) {
    const current = settings && typeof settings === "object" ? settings : getSettings();
    const preserved = {};
    for (const key of NEW_GAME_PRESERVE_KEYS) {
        if (current[key] === undefined) continue;
        preserved[key] = key === "ui" ? cleanPreservedUi(current[key]) : cloneSettingValue(current[key]);
    }
    const realityUi = current?.realityEngine?.ui && typeof current.realityEngine.ui === "object"
        ? cloneSettingValue(current.realityEngine.ui)
        : null;
    for (const key of Object.keys(current)) delete current[key];
    Object.assign(current, preserved);
    if (realityUi) current.realityEngine = { ui: realityUi };
    current.chats = {};
    return current;
}

try {
    window.UIE = window.UIE || {};
    window.UIE.getSettings = getSettings;
    window.UIE.saveSettings = saveSettings;
    window.UIE.commitStateUpdate = commitStateUpdate;
    window.UIE.applyFullState = applyFullState;
    window.UIE.resetForNewGame = resetForNewGame;
} catch (_) {}

export function failsafeRecover(opts = {}) {
    try { kickMirrorIdbLoad(); } catch (_) {}
    try { restoreFromMirrorIfEmpty(); } catch (_) {}
    try { updateLayout(); } catch (_) {}
    try { window.UIE_refreshStateSaves?.(); } catch (_) {}
    try {
        const event = new CustomEvent("uie:state_updated", { detail: { ...(opts || {}), failsafe: true } });
        window.dispatchEvent(event);
    } catch (_) {}
}

try { window.UIE_failsafeRecover = failsafeRecover; } catch (_) {}

function clampMenuIfNeeded() {
    try {
        const el = document.getElementById("uie-main-menu");
        if (!el) return;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return;
        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        if (!(vw > 0 && vh > 0)) return;

        const pad = 10;
        const out = rect.right < pad || rect.bottom < pad || rect.left > vw - pad || rect.top > vh - pad;
        if (!out) return;

        const w = rect.width || 320;
        const h = rect.height || 420;
        let left = rect.left;
        let top = rect.top;
        if (!Number.isFinite(left)) left = pad;
        if (!Number.isFinite(top)) top = pad;
        if (left < pad) left = pad;
        if (top < pad) top = pad;
        if (left > vw - w - pad) left = vw - w - pad;
        if (top > vh - h - pad) top = vh - h - pad;

        el.style.position = "fixed";
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.right = "auto";
        el.style.bottom = "auto";
        el.style.transformOrigin = "top left";
        el.style.transform = "none";
    } catch (_) {}
}

function startFailsafeWatchdog() {
    if (window.UIE_STANDALONE === true) return;
    try {
        if (window.__uieFailsafeWatchdogStarted) return;
        window.__uieFailsafeWatchdogStarted = true;
    } catch (_) {}

    let lastRecoverAt = 0;
    const tick = () => {
        try {
            if (window.UIE_isDragging) return;
        } catch (_) {}

        try { clampMenuIfNeeded(); } catch (_) {}

        const now = Date.now();
        if (now - lastRecoverAt < 2500) return;

        try {
            const s = getSettings();
            if (!s || typeof s !== "object") return;
            if (looksEmptySettings(s)) {
                const hasMirror = hasNonEmptyMirror();
                if (hasMirror) {
                    lastRecoverAt = now;
                    failsafeRecover({ reason: "empty_settings" });
                }
            }
        } catch (_) {}
    };

    try { setInterval(tick, 1500); } catch (_) {}
    try { setTimeout(tick, 1000); } catch (_) {}
}

try { startFailsafeWatchdog(); } catch (_) {}

export async function ensureChatStateLoaded() {
    // Wait for context to be available
    if (getContext()) return true;

    // Simple polling if not ready (though usually it is by the time extensions run)
    for (let i = 0; i < 20; i++) {
        if (getContext()) return true;
        await new Promise(r => setTimeout(r, 100));
    }
    return false;
}

export function sanitizeSettings() {
    const persistent = isPersistentSettingsReady();
    const s = getSettings();

    // If settings are still an empty shell, don't stamp defaults over real data that hasn't hydrated yet.
    // Give ST a moment to populate extension_settings from disk; if it doesn't, then proceed.
    if (persistent && looksEmptySettings(s) && Date.now() < INIT_DEADLINE) {
        // Continue boot with the empty shell while IndexedDB is still hydrating,
        // then sanitize after the persisted snapshot has had a chance to arrive.
        try { kickMirrorIdbLoad(); } catch (_) {}
        if (mirrorIdbLoadPromise && !mirrorIdbLoadComplete) {
            deferSanitizeUntilSettingsHydrate();
            return s;
        }

        // A completed mirror restore mutates this same settings object in place.
        // If it remains empty, there is no persisted snapshot to protect.
        try { restoreFromMirrorIfEmpty(); } catch (_) {}
    }

    // 1. Basic Structure
    if (!s.inventory) s.inventory = {};
    if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
    if (!s.inventory.equipment) s.inventory.equipment = {};
    if (!s.inventory.vitals) s.inventory.vitals = {};
    if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
    if (!s.worldState.travel || typeof s.worldState.travel !== "object") s.worldState.travel = {};
    const travel = s.worldState.travel;
    if (!Number.isFinite(Number(travel.version))) travel.version = 1;
    if (typeof travel.currentDockId !== "string") travel.currentDockId = "";
    if (typeof travel.currentDockName !== "string") travel.currentDockName = "";
    if (!travel.discoveredDocks || typeof travel.discoveredDocks !== "object" || Array.isArray(travel.discoveredDocks)) travel.discoveredDocks = {};
    if (!Array.isArray(travel.favoriteDocks)) travel.favoriteDocks = [];
    if (!travel.tickets || typeof travel.tickets !== "object" || Array.isArray(travel.tickets)) travel.tickets = {};
    if (!travel.routeDisruptions || typeof travel.routeDisruptions !== "object" || Array.isArray(travel.routeDisruptions)) travel.routeDisruptions = {};
    if (!Array.isArray(travel.history)) travel.history = [];
    if (!Number.isFinite(Number(travel.tripCounter))) travel.tripCounter = 0;
    if (!s.worldState.accessLocks || typeof s.worldState.accessLocks !== "object" || Array.isArray(s.worldState.accessLocks)) s.worldState.accessLocks = {};
    if (!s.worldState.accessPermissions || typeof s.worldState.accessPermissions !== "object" || Array.isArray(s.worldState.accessPermissions)) s.worldState.accessPermissions = {};
    if (!s.worldState.objectStates || typeof s.worldState.objectStates !== "object" || Array.isArray(s.worldState.objectStates)) s.worldState.objectStates = {};
    if (!s.worldState.minigameResults || typeof s.worldState.minigameResults !== "object" || Array.isArray(s.worldState.minigameResults)) s.worldState.minigameResults = {};
    if (!Array.isArray(s.worldState.toolActionLog)) s.worldState.toolActionLog = [];
    if (!Array.isArray(s.worldState.evidence)) s.worldState.evidence = [];
    if (!Array.isArray(s.worldState.photographs)) s.worldState.photographs = [];
    if (!Number.isFinite(Number(s.worldState.suspicion))) s.worldState.suspicion = 0;

    // Vitals Defaults
    const v = s.inventory.vitals;
    if (typeof v.hp !== "number") v.hp = 100;
    if (typeof v.maxHp !== "number") v.maxHp = 100;
    if (typeof v.mp !== "number") v.mp = 50;
    if (typeof v.maxMp !== "number") v.maxMp = 50;
    if (typeof v.sp !== "number") v.sp = 50;
    if (typeof v.maxSp !== "number") v.maxSp = 50;
    if (typeof v.xp !== "number") v.xp = 0;
    if (typeof v.level !== "number") v.level = 1;
    if (!v.name) v.name = "Traveler";
    if (!v.class) v.class = "Adventurer";

    // 2. Economy
    if (!s.currencySymbol) s.currencySymbol = "G";
    if (typeof s.currencyRate !== "number") s.currencyRate = 0;

    // 3. Image/Features Toggles
    if (!s.image) s.image = {};
    if (!s.image.features) s.image.features = {};
    const f = s.image.features;
    // Default all to true if undefined
    if (f.map === undefined) f.map = true;
    if (f.doll === undefined) f.doll = true;
    if (f.social === undefined) f.social = true;
    if (f.phoneBg === undefined) f.phoneBg = true;
    if (f.msg === undefined) f.msg = true;
    if (f.party === undefined) f.party = true;
    if (f.items === undefined) f.items = true;

    // UI defaults now open 10% closer while preserving the existing per-area
    // scale controls. Mobile applies the same values to the desktop composition
    // before its landscape density fit.
    if (!s.ui || typeof s.ui !== "object") s.ui = {};
    if (!s.ui.scales || typeof s.ui.scales !== "object") {
        s.ui.scales = { sidebar: 110, menu: 110, chatbox: 110, uibutton: 110, toast: 110 };
    }
    for (const key of ["sidebar", "menu", "chatbox", "uibutton", "toast"]) {
        if (!Number.isFinite(Number(s.ui.scales[key]))) s.ui.scales[key] = 110;
    }

    // Audio is enabled independently from assignment. Turning voices off must
    // not erase the user's previous character-routing choice.
    if (!s.audio || typeof s.audio !== "object") s.audio = {};
    if (typeof s.audio.enabled !== "boolean") s.audio.enabled = true;
    if (typeof s.audio.ttsEnabled !== "boolean") s.audio.ttsEnabled = s.audio.enabled;
    if (!String(s.audio.provider || "").trim()) s.audio.provider = "pocket";
    if (!String(s.audio.assignment || "").trim()) s.audio.assignment = "all";
    if (typeof s.audio.autoplay !== "boolean") s.audio.autoplay = true;
    if (!s.audio.pocket || typeof s.audio.pocket !== "object") {
        s.audio.pocket = { url: "./api/backend", voice: "alba", language: "english", reference: "", referenceText: "", refSeconds: 6, useReference: true };
    }
    if (!s.audio.kokoro || typeof s.audio.kokoro !== "object") {
        s.audio.kokoro = { voice: "af_heart", language: "english", speed: 1, genderBlend: 0.5, vibeBlend: 0.5 };
    }

    // 4. Token Budget Defaults
    if (!s.generation || typeof s.generation !== "object") s.generation = {};
    if (!s.generation.contextBudget || typeof s.generation.contextBudget !== "object") s.generation.contextBudget = {};
    if (!Number.isFinite(Number(s.generation.contextBudget.recentMessages))) s.generation.contextBudget.recentMessages = 8;
    if (!Number.isFinite(Number(s.generation.contextBudget.recentChars))) s.generation.contextBudget.recentChars = 2200;
    if (!Number.isFinite(Number(s.generation.contextBudget.archiveChars))) s.generation.contextBudget.archiveChars = 900;
    if (!Number.isFinite(Number(s.generation.contextBudget.archiveItems))) s.generation.contextBudget.archiveItems = 3;
    if (!Number.isFinite(Number(s.generation.outputTokenLimit))) s.generation.outputTokenLimit = 2048;
    if (!Number.isFinite(Number(s.generation.contextTokenLimit))) s.generation.contextTokenLimit = 24000;
    if (!s.network || typeof s.network !== "object") s.network = {};
    if (!["auto", "custom"].includes(String(s.network.proxyMode || ""))) s.network.proxyMode = "auto";
    if (!["auto", "proxy-first", "direct-first"].includes(String(s.network.proxyPreference || ""))) s.network.proxyPreference = "auto";
    if (typeof s.network.proxyOrigin !== "string") s.network.proxyOrigin = "";
    if (!s.atmosphere || typeof s.atmosphere !== "object") s.atmosphere = {};
    if (!["auto", "clock", "manual"].includes(String(s.atmosphere.mode || ""))) s.atmosphere.mode = "auto";
    if (typeof s.atmosphere.enabled !== "boolean") s.atmosphere.enabled = true;
    if (typeof s.atmosphere.visualsEnabled !== "boolean") s.atmosphere.visualsEnabled = true;
    if (typeof s.atmosphere.motionEnabled !== "boolean") s.atmosphere.motionEnabled = true;
    if (typeof s.atmosphere.audioEnabled !== "boolean") s.atmosphere.audioEnabled = true;
    if (!Array.isArray(s.atmosphere.customWeatherPresets)) s.atmosphere.customWeatherPresets = [];

    // 5. Windows State
    if (!s.windows) s.windows = {};

    // Never persist an effectively-empty settings object during init.
    // This prevents overwriting real user settings that haven't hydrated yet.
    if (persistent && !looksEmptySettings(s)) saveSettings();
}

export function isMobileUI() {
    try {
        if (window.matchMedia?.("(pointer: coarse)").matches) return true;
    } catch (_) {}
    const w = typeof window !== "undefined" ? window.innerWidth : 1200;
    const h = typeof window !== "undefined" ? window.innerHeight : 800;
    const shortSide = Math.min(w, h);
    if (shortSide > 0 && shortSide < 768) return true;
    return w < 800;
}

// --- CHAT PERSISTENCE ---
let lastChatId = null;
// savedStates is global (library of manual saves) - never per-chat, never reset on new chat
const SESSION_KEYS = [
    "character", "currency", "currencySymbol", "currencyRate",
    "calendar", "map", "social", "party", "journal", "diary", "databank", "activities", "phone",
    "xp", "hp", "mp", "ap", "maxHp", "maxMp", "maxAp", "maxXp", "life", "worldState",
    "inventory", "mapEngine", "simpleMap", "mapData", "lorebooks", "aging", "skills", "assets", "factions", "reputation",
    "academy", "genericNpcs", "academicMemoryTags",
    "activePortrait", "currentLocation",
    "appearance", "battle", "currencyConfig", "gameCharacters", "loreContext", "memory", "memories",
    "realityEngine", "sceneCharacters", "world"
];
let chatCheckTimer = null;
let chatEventBindingStarted = false;

function getChatScopedSocialDeletedNames(meta) {
    try {
        const arr = Array.isArray(meta?.deletedNames) ? meta.deletedNames : [];
        return arr
            .map((x) => String(x || "").trim())
            .filter(Boolean)
            .slice(-400);
    } catch (_) {
        return [];
    }
}

function refreshChatScopedModules(detail = {}) {
    if (window.UIE_STANDALONE === true) return;
    setTimeout(() => {
        try { window.UIE_refreshStateSaves?.(); } catch (_) {}
        try {
            const event = new CustomEvent("uie:state_updated", { detail });
            window.dispatchEvent(event);
        } catch (_) {}
        try { updateLayout(); } catch (_) {}
        const fresh = (file) => `./${file}?v=${Date.now()}`;
        try { import(fresh("inventory.js")).then((m) => { m.updateVitals?.(); m.applyInventoryUi?.(); m.initInventory?.(); }); } catch (_) {}
        try { import(fresh("features/life.js")).then((m) => { m.render?.(); m.init?.(); }); } catch (_) {}
        try { import(fresh("features/items.js")).then((m) => { m.render?.(); m.init?.(); }); } catch (_) {}
        try { import(fresh("features/skills.js")).then((m) => { m.render?.(); m.init?.(); }); } catch (_) {}
        try { import(fresh("features/assets.js")).then((m) => { m.render?.(); m.init?.(); }); } catch (_) {}
        try { import(fresh("features/equipment.js")).then((m) => { m.render?.(); m.init?.(); }); } catch (_) {}
        try { import(fresh("social.js")).then((m) => { m.render?.(); m.initSocial?.(); }); } catch (_) {}
        try { import(fresh("party.js")).then((m) => { m.render?.(); m.initParty?.(); }); } catch (_) {}
        try { import(fresh("journal.js")).then((m) => { m.render?.(); m.initJournal?.(); }); } catch (_) {}
        try { import(fresh("diary.js")).then((m) => { m.render?.(); m.initDiary?.(); }); } catch (_) {}
        try { import(fresh("databank.js")).then((m) => { m.render?.(); m.initDatabank?.(); }); } catch (_) {}
        try { import(fresh("phone.js")).then((m) => { m.render?.(); m.initPhone?.(); }); } catch (_) {}
        try { import(fresh("map.js")).then((m) => { m.initMap?.(); }); } catch (_) {}
    }, 50);
}

function resetChatScopedState(s) {
    const autoScanPref = s?.socialMeta?.autoScan === true;
    const generationSettings = s.generation;
    for (const k of SESSION_KEYS) {
        delete s[k];
    }
    s.generation = generationSettings;
    s.socialMeta = {
        autoScan: autoScanPref,
        deletedNames: [],
    };
    sanitizeSettings();
}

function saveCurrentChatState() {
    if (window.UIE_STANDALONE === true) return;
    if (!lastChatId) return;
    const s = getSettings();
    if (!s.chats) s.chats = {};
    
    const data = {};
    let hasData = false;
    for (const k of SESSION_KEYS) {
        if (s[k] !== undefined) {
            data[k] = s[k];
            hasData = true;
        }
    }

    const deletedNames = getChatScopedSocialDeletedNames(s?.socialMeta);
    if (deletedNames.length) {
        data.socialMeta = { deletedNames };
        hasData = true;
    }
    
    if (hasData) {
        s.chats[lastChatId] = JSON.parse(safeJson(data));
    }
}

function loadChatState(chatId) {
    const s = getSettings();
    const autoScanPref = s?.socialMeta?.autoScan === true;

    // First, ensure we save the PREVIOUS chat state if we switched
    if (lastChatId && lastChatId !== chatId) {
        saveCurrentChatState();
    }

    lastChatId = chatId;

    if (!chatId) {
        resetChatScopedState(s);
        s.socialMeta = {
            autoScan: autoScanPref,
            deletedNames: [],
        };
        try { saveSettings(); } catch (_) {}
        refreshChatScopedModules({ chatLoad: true, blankChat: true });
        return;
    }

    const saved = s.chats?.[chatId];

    if (saved) {
        // Restore saved data
        for (const k of SESSION_KEYS) {
            if (saved[k] !== undefined) {
                s[k] = JSON.parse(safeJson(saved[k]));
            } else {
                delete s[k];
            }
        }
    } else {
        resetChatScopedState(s);
    }

    s.socialMeta = {
        autoScan: autoScanPref,
        deletedNames: getChatScopedSocialDeletedNames(saved?.socialMeta),
    };
    
    // Re-hydrate defaults
    sanitizeSettings();
    
    // Persist chat state to disk (save current chat storage + session state)
    try { saveSettings(); } catch (_) {}

    refreshChatScopedModules({ chatLoad: true, chatId });
}

// Hook into saveSettings to ensure we keep the chat storage updated
const originalSave = saveSettings;
// We can't easily wrap the export, so we inject logic inside saveSettings via the existing function structure
// or we add a periodic check.

function checkChatIdAndLoad() {
    try {
        const ctx = getContext();
        const cid = ctx ? ctx.chatId : null;
        if (cid !== lastChatId) {
            if (lastChatId !== null || cid === null) {
                console.log(`[UIE] Chat changed: ${lastChatId} -> ${cid}`);
                loadChatState(cid);
            } else {
                loadChatState(cid);
            }
        }
    } catch (_) {}
}

let chatPollInterval = null;
function scheduleChatStateCheck(delay = 40) {
    try { if (chatCheckTimer) clearTimeout(chatCheckTimer); } catch (_) {}
    chatCheckTimer = setTimeout(() => {
        chatCheckTimer = null;
        checkChatIdAndLoad();
    }, Math.max(0, Number(delay || 0)));
}

async function bindChatPersistenceEvents() {
    if (chatEventBindingStarted) return;
    chatEventBindingStarted = true;
    try {
        if (typeof window !== "undefined") {
            window.addEventListener("focus", () => scheduleChatStateCheck(20));
        }
        if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", () => {
                if (!document.hidden) scheduleChatStateCheck(20);
            });
        }
    } catch (_) {}
    try {
        const mod = null;
        const src = window?.eventSource;
        const types = window?.event_types || {};
        if (!src || typeof src.on !== "function") return;
        const trigger = () => scheduleChatStateCheck(30);
        try { src.on(types.CHAT_CHANGED || "chat_changed", trigger); } catch (_) {}
        try { src.on(types.MESSAGE_RECEIVED || "message_received", trigger); } catch (_) {}
        try { src.on(types.GENERATION_ENDED || "generation_ended", trigger); } catch (_) {}
        try { src.on(types.GENERATION_STOPPED || "generation_stopped", trigger); } catch (_) {}
        try { src.on(types.GROUP_UPDATED || "group_updated", trigger); } catch (_) {}
    } catch (_) {}
}

function initChatPersistence() {
    if (window.UIE_STANDALONE === true) return;
    if (!chatPollInterval) {
        chatPollInterval = setInterval(checkChatIdAndLoad, 2500);
    }
    void bindChatPersistenceEvents();
}

// Start monitoring
initChatPersistence();

export function updateLayout() {
    const s = getSettings();

    try {
        document.documentElement.style.setProperty("--uie-scale", "1.1");
    } catch (_) {}

    // Always keep the launcher visible (unless explicitly hidden) and on-screen.
    // On mobile we skip window clamping, but the launcher must still be corrected.
    try {
        const launcher = document.getElementById("uie-launcher");
        if (launcher) {
            const hidden = s?.launcher?.hidden === true;
            launcher.style.display = hidden ? "none" : "flex";

            if (!hidden) {
                const rect = launcher.getBoundingClientRect();
                const vw = window.innerWidth || document.documentElement.clientWidth || 0;
                const vh = window.innerHeight || document.documentElement.clientHeight || 0;
                const w = rect.width || launcher.offsetWidth || 60;
                const h = rect.height || launcher.offsetHeight || 60;

                const pad = 6;
                const outOfView =
                    rect.right < pad ||
                    rect.bottom < pad ||
                    rect.left > vw - pad ||
                    rect.top > vh - pad;

                if (outOfView && vw > 0 && vh > 0) {
                    let left = rect.left;
                    let top = rect.top;
                    if (!Number.isFinite(left)) left = pad;
                    if (!Number.isFinite(top)) top = pad;
                    if (left < pad) left = pad;
                    if (top < pad) top = pad;
                    if (left > vw - w - pad) left = vw - w - pad;
                    if (top > vh - h - pad) top = vh - h - pad;

                    launcher.style.position = "fixed";
                    launcher.style.left = `${left}px`;
                    launcher.style.top = `${top}px`;
                    launcher.style.right = "auto";
                    launcher.style.bottom = "auto";
                }
            }
        }
    } catch (_) {}


    if (!s.windows) return;

    // Saved pixel coordinates have no meaning on a touch viewport after a
    // rotation or a device change.  Do not restore a desktop window position
    // over the mobile layout; each window opens from its own responsive CSS.
    if (isMobileUI()) return;

    // Apply saved positions
    Object.keys(s.windows).forEach(id => {
        const pos = s.windows[id];
        const $el = $(`#${id}`);
        if ($el.length && pos) {
            const viewport = window.visualViewport;
            const viewportWidth = viewport?.width || window.innerWidth || 0;
            const viewportHeight = viewport?.height || window.innerHeight || 0;
            const rect = $el.get(0)?.getBoundingClientRect?.();
            const panelWidth = rect?.width || $el.outerWidth() || 0;
            const panelHeight = rect?.height || $el.outerHeight() || 0;
            const gap = 12;
            const left = Math.min(Math.max(gap, Number(pos.left) || gap), Math.max(gap, viewportWidth - panelWidth - gap));
            const top = Math.min(Math.max(gap, Number(pos.top) || gap), Math.max(gap, viewportHeight - panelHeight - gap));

            $el.css({ top: `${top}px`, left: `${left}px`, right: "auto", bottom: "auto" });
        }
    });

    // Morph Hamburger Menu aesthetics dynamically based on character mode
    try {
        const panel = document.getElementById("reply-menu-panel");
        if (panel) {
            const mode = String(s.character?.mode || s.character?.gameMode || "adventure").toLowerCase().trim();
            const isRpg = mode === "adventure" || mode === "rpg" || mode === "fantasy";
            
            if (isRpg) {
                // Apply RPG Antique Scroll styling
                panel.style.background = "#f4edd0";
                panel.style.border = "3px solid #8b5a2b";
                panel.style.borderRadius = "12px";
                panel.style.color = "#4a2c11";
                panel.style.fontFamily = "'Cinzel', 'Georgia', serif";
                panel.style.boxShadow = "0 10px 30px rgba(0,0,0,0.5), inset 0 0 10px rgba(139,90,43,0.2)";
                
                // Style Category Headers
                panel.querySelectorAll(".menu-category-header").forEach(h => {
                    h.style.color = "#8b5a2b";
                    h.style.fontFamily = "'Cinzel', 'Georgia', serif";
                    h.style.borderColor = "rgba(139,90,43,0.4)";
                });
                
                // Style and rename menu items
                panel.querySelectorAll(".reply-menu-item").forEach(item => {
                    item.style.color = "#4a2c11";
                    item.style.fontFamily = "'Cinzel', 'Georgia', serif";
                    item.style.fontWeight = "bold";
                });
                
                const btnPersona = document.getElementById("btn-personas");
                if (btnPersona) btnPersona.innerHTML = '<i class="fas fa-masks-theater"></i> Inscribe Legend';
                
                const btnInv = document.getElementById("btn-inv");
                if (btnInv) btnInv.innerHTML = '<i class="fas fa-backpack"></i> Adventurer\'s Bag';
                
                const btnMap = document.getElementById("btn-world-map");
                if (btnMap) btnMap.innerHTML = '<i class="fas fa-map-marked-alt"></i> Tome of Maps';
                
                const btnFactions = document.getElementById("btn-factions");
                if (btnFactions) btnFactions.innerHTML = '<i class="fas fa-network-wired"></i> Organizations';
                
                const btnParty = document.getElementById("btn-party");
                if (btnParty) btnParty.innerHTML = '<i class="fas fa-users"></i> Guild Companions';
                
                const btnApi = document.getElementById("btn-api-cfg");
                if (btnApi) btnApi.innerHTML = '<i class="fas fa-gear"></i> Settings';
            } else {
                // Apply Cyber Glassmorphic styling
                panel.style.background = "rgba(10,15,28,0.92)";
                panel.style.border = "2px solid #00f0ff";
                panel.style.borderRadius = "12px";
                panel.style.color = "#e2e8f0";
                panel.style.fontFamily = "'Inter', system-ui, sans-serif";
                panel.style.boxShadow = "0 0 15px rgba(0,240,255,0.2)";
                
                // Style Category Headers
                panel.querySelectorAll(".menu-category-header").forEach(h => {
                    h.style.color = "#00f0ff";
                    h.style.fontFamily = "'Inter', sans-serif";
                    h.style.borderColor = "rgba(0,240,255,0.3)";
                });
                
                // Style and rename menu items
                panel.querySelectorAll(".reply-menu-item").forEach(item => {
                    item.style.color = "#e2e8f0";
                    item.style.fontFamily = "'Inter', sans-serif";
                    item.style.fontWeight = "normal";
                });
                
                const btnPersona = document.getElementById("btn-personas");
                if (btnPersona) btnPersona.innerHTML = '<i class="fas fa-masks-theater"></i> Cyber Persona';
                
                const btnInv = document.getElementById("btn-inv");
                if (btnInv) btnInv.innerHTML = '<i class="fas fa-backpack"></i> Utility Bag';
                
                const btnMap = document.getElementById("btn-world-map");
                if (btnMap) btnMap.innerHTML = '<i class="fas fa-map-marked-alt"></i> GPS Cartography';
                
                const btnFactions = document.getElementById("btn-factions");
                if (btnFactions) btnFactions.innerHTML = '<i class="fas fa-network-wired"></i> Organizations';
                
                const btnParty = document.getElementById("btn-party");
                if (btnParty) btnParty.innerHTML = '<i class="fas fa-users"></i> Active Nodes';
                
                const btnApi = document.getElementById("btn-api-cfg");
                if (btnApi) btnApi.innerHTML = '<i class="fas fa-gear"></i> Settings';
            }
        }
    } catch (err) {
        console.warn("[Core] updateLayout dynamic hamburger morph failed:", err);
    }
    try { applyRpgUiCustomization(s); } catch (_) {}
}

// --- Event Listeners ---

// Settings Checkbox Listeners
$("body").on("change", "#uie-sw-img-map, #uie-sw-img-doll, #uie-sw-img-social, #uie-sw-img-phone-bg, #uie-sw-img-msg, #uie-sw-img-party, #uie-sw-img-items, #uie-img-map, #uie-img-doll, #uie-img-social, #uie-img-phone-bg, #uie-img-msg, #uie-img-party, #uie-img-items", function(e) {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    if (!s.image) s.image = {};
    if (!s.image.features) s.image.features = {};
    const id = String(this.id || "");
    const on = $(this).prop("checked") === true;

    const keyById = {
        "uie-sw-img-map": "map",
        "uie-img-map": "map",
        "uie-sw-img-doll": "doll",
        "uie-img-doll": "doll",
        "uie-sw-img-social": "social",
        "uie-img-social": "social",
        "uie-sw-img-phone-bg": "phoneBg",
        "uie-img-phone-bg": "phoneBg",
        "uie-sw-img-msg": "msg",
        "uie-img-msg": "msg",
        "uie-sw-img-party": "party",
        "uie-img-party": "party",
        "uie-sw-img-items": "items",
        "uie-img-items": "items",
    };

    const key = keyById[id];
    if (!key) return;
    s.image.features[key] = on;

    const featureOn = {
        map: s.image.features.map !== false,
        doll: s.image.features.doll !== false,
        social: s.image.features.social !== false,
        phoneBg: s.image.features.phoneBg !== false,
        msg: s.image.features.msg !== false,
        party: s.image.features.party !== false,
        items: s.image.features.items !== false,
    };

    $("#uie-img-map, #uie-sw-img-map").prop("checked", featureOn.map);
    $("#uie-img-doll, #uie-sw-img-doll").prop("checked", featureOn.doll);
    $("#uie-img-social, #uie-sw-img-social").prop("checked", featureOn.social);
    $("#uie-img-phone-bg, #uie-sw-img-phone-bg").prop("checked", featureOn.phoneBg);
    $("#uie-img-msg, #uie-sw-img-msg").prop("checked", featureOn.msg);
    $("#uie-img-party, #uie-sw-img-party").prop("checked", featureOn.party);
    $("#uie-img-items, #uie-sw-img-items").prop("checked", featureOn.items);

    saveSettings();
});

// Economy Save Button Listener
$("body").off("click.uieCurrencySave").on("click.uieCurrencySave", "#uie-currency-save-btn", function(e) {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    const code = String($("#uie-set-currency-code").val() || "CUSTOM").trim() || "CUSTOM";
    const name = String($("#uie-set-currency-name").val() || "").trim();
    const sym = String($("#uie-set-currency-sym").val() || "").trim();
    const rate = 0;

    applyCurrencySettings(s, { code, name, symbol: sym, rate });

    saveSettings();
    updateLayout(); // Refresh UI if currency is displayed
    try { window.toastr?.success?.("Economy settings saved.", "UIE"); } catch (_) {}
});

$("body").off("change.uieCurrencyPresetCore").on("change.uieCurrencyPresetCore", "#uie-set-currency-code", function(e) {
    e.preventDefault();
    e.stopPropagation();
    const preset = getCurrencyPreset($(this).val());
    if (preset.code !== "CUSTOM") {
        $("#uie-set-currency-name").val(preset.name);
        $("#uie-set-currency-sym").val(preset.symbol);
    }
});

function ensureRpgSettingsState(s) {
    if (!s.character || typeof s.character !== "object") s.character = {};
    if (!s.character.stats || typeof s.character.stats !== "object") {
        s.character.stats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, per: 10, luk: 10 };
    }
    if (!Array.isArray(s.character.savedClasses)) s.character.savedClasses = [];
    if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
    if (!Array.isArray(s.inventory.skills)) s.inventory.skills = [];
    if (!Array.isArray(s.inventory.assets)) s.inventory.assets = [];
    if (!Array.isArray(s.inventory.life)) s.inventory.life = [];
    if (!s.rpgSettings || typeof s.rpgSettings !== "object") s.rpgSettings = {};
    if (typeof s.rpgSettings.permadeath !== "boolean") s.rpgSettings.permadeath = false;
    if (!Number.isFinite(Number(s.rpgSettings.plotArmor))) s.rpgSettings.plotArmor = 3;
    if (!String(s.rpgSettings.difficulty || "").trim()) s.rpgSettings.difficulty = "normal";
    if (typeof s.rpgSettings.autoDamage !== "boolean") s.rpgSettings.autoDamage = true;
    if (typeof s.rpgSettings.battleEnabled !== "boolean") s.rpgSettings.battleEnabled = true;
    if (typeof s.rpgSettings.battleAutoOpen !== "boolean") s.rpgSettings.battleAutoOpen = true;
    if (typeof s.rpgSettings.autoBattleEnabled !== "boolean") s.rpgSettings.autoBattleEnabled = false;
    if (!String(s.rpgSettings.battleActionStyle || "").trim()) s.rpgSettings.battleActionStyle = "classic";
    if (typeof s.rpgSettings.agingEnabled !== "boolean") s.rpgSettings.agingEnabled = true;
    if (!Number.isFinite(Number(s.rpgSettings.agingSpeed))) s.rpgSettings.agingSpeed = 30;
    if (!Number.isFinite(Number(s.rpgSettings.lifespanMultiplier))) s.rpgSettings.lifespanMultiplier = 1;
    if (!Number.isFinite(Number(s.rpgSettings.xpMultiplier))) s.rpgSettings.xpMultiplier = 1;
    if (!Number.isFinite(Number(s.rpgSettings.goldMultiplier))) s.rpgSettings.goldMultiplier = 1;
    if (typeof s.rpgSettings.detailedBattleLog !== "boolean") s.rpgSettings.detailedBattleLog = true;
    if (typeof s.rpgSettings.debuffDecay !== "boolean") s.rpgSettings.debuffDecay = true;
    if (typeof s.rpgSettings.readableHtmlEnabled !== "boolean") s.rpgSettings.readableHtmlEnabled = true;
    if (typeof s.rpgSettings.dynamicResponseBoxesEnabled !== "boolean") s.rpgSettings.dynamicResponseBoxesEnabled = false;
    if (!s.rpgSettings.uiStyle || typeof s.rpgSettings.uiStyle !== "object") s.rpgSettings.uiStyle = {};
    if (!String(s.rpgSettings.uiStyle.preset || "").trim()) s.rpgSettings.uiStyle.preset = "dark";
    if (!s.rpgSettings.uiStyle.targets || typeof s.rpgSettings.uiStyle.targets !== "object") s.rpgSettings.uiStyle.targets = {};
}

function rpgUiSelector(target) {
    const idTargets = new Set([
        "reply-menu-panel", "q-menu-hamburger", "q-visibility-menu", "q-img-gen", "q-chatlog-bar",
        "input-row", "user-input", "next-beat-input", "send-btn", "target-select", "nav-row",
        "nav-map", "nav-music", "nav-edit-room",
        "nav-settings", "message-box", "uie-settings-window", "battle-screen"
    ]);
    if (target === "entire-ui") return "body";
    if (target === "all-modal-inputs") return ".modal-input, input.modal-input, #uie-settings-window input";
    if (target === "all-modal-selects") return ".modal-select, select.modal-select, #uie-settings-window select";
    if (target === "all-modal-textareas") return ".modal-textarea, textarea.modal-textarea, #uie-settings-window textarea";
    if (idTargets.has(target)) return `#${target}`;
    return "";
}

function applyRpgUiCustomization(s = getSettings()) {
    try {
        ensureRpgSettingsState(s);
        const cfg = s.rpgSettings.uiStyle || {};
        if (cfg.modernUiMigrationApplied !== true) {
            const preset = String(cfg.preset || "").trim().toLowerCase();
            if (!preset || preset === "parchment") cfg.preset = "dark";
            if (cfg.targets && typeof cfg.targets === "object") {
                for (const key of ["hamburger", "reply-menu-panel", "q-menu-hamburger"]) {
                    if (cfg.targets[key]?.css || cfg.targets[key]?.html || cfg.targets[key]?.url) delete cfg.targets[key];
                }
            }
            cfg.modernUiMigrationApplied = true;
            try { saveSettings(); } catch (_) {}
        }
        const preset = String(cfg.preset || "dark");
        let presetCss = "";
        if (preset === "parchment") {
            presetCss = `
#reply-menu-panel{background:#f4edd0!important;border:3px solid #8b5a2b!important;color:#4a2c11!important;font-family:'Cinzel','Georgia',serif!important;}
#reply-menu-panel .reply-menu-item,#reply-menu-panel .reply-menu-title,#reply-menu-panel .reply-menu-tab-btn{color:#4a2c11!important;font-family:'Cinzel','Georgia',serif!important;}
#nav-row .nav-btn,#send-btn{border-color:rgba(203,163,92,.55)!important;}
`;
        } else if (preset === "dark") {
            presetCss = `
#reply-menu-panel,.modal-overlay,.uie-modal{background:rgba(8,12,18,.94)!important;border-color:rgba(148,163,184,.18)!important;color:#e5e7eb!important;font-family:Inter,system-ui,sans-serif!important;}
#reply-menu-panel .reply-menu-item,#reply-menu-panel .reply-menu-title,#reply-menu-panel .reply-menu-tab-btn,#reply-menu-panel .reply-menu-section-title{color:#e5e7eb!important;font-family:Inter,system-ui,sans-serif!important;}
#reply-menu-panel .reply-menu-item:hover{background:rgba(45,212,191,.12)!important;border-color:rgba(45,212,191,.35)!important;box-shadow:0 6px 18px rgba(15,23,42,.4)!important;}
#reply-menu-panel .reply-menu-tab-btn.active{background:linear-gradient(180deg,rgba(45,212,191,.95),rgba(14,165,233,.92))!important;color:#06111d!important;border-color:rgba(45,212,191,.75)!important;}
#reply-menu-panel .reply-menu-tab-btn:hover:not(.active){background:rgba(255,255,255,.05)!important;border-color:rgba(148,163,184,.24)!important;color:#f8fafc!important;}
#reply-menu-panel .reply-menu-section-title{border-bottom-color:rgba(148,163,184,.16)!important;}
`;
        } else if (preset === "cyber") {
            presetCss = `
#reply-menu-panel{background:rgba(7,10,22,.95)!important;border:2px solid #00f0ff!important;color:#e2e8f0!important;box-shadow:0 0 18px rgba(0,240,255,.22)!important;}
#reply-menu-panel .reply-menu-item,#reply-menu-panel .reply-menu-title,#reply-menu-panel .reply-menu-tab-btn{color:#e2e8f0!important;}
`;
        }
        const requestedMenuCss = `
#q-menu-hamburger,
#reply-tools > .reply-tool-btn,
#send-btn,
.nav-btn,
.direction-btn {
background:linear-gradient(180deg,rgba(15,30,60,.94),rgba(8,16,36,.98))!important;
color:#e0f2fe!important;
border-color:rgba(100,180,255,.36)!important;
box-shadow:0 10px 24px rgba(16,25,37,.24),inset 0 1px rgba(255,255,255,.14)!important;
}
#q-menu-hamburger:hover,
#reply-tools > .reply-tool-btn:hover,
#send-btn:hover,
.nav-btn:hover,
.direction-btn:hover {
background:linear-gradient(180deg,rgba(25,50,90,.96),rgba(12,24,52,.98))!important;
color:#fff!important;
border-color:rgba(100,180,255,.7)!important;
}
#reply-menu-panel,
#uie-main-menu {
background:linear-gradient(155deg,rgba(48,31,20,.9),rgba(27,16,10,.94)),url("./assets/backgrounds/Generated image 3.png") center/cover no-repeat!important;
border-color:rgba(241,192,106,.38)!important;
color:#fff8e8!important;
box-shadow:0 24px 72px rgba(0,0,0,.58),inset 0 1px rgba(255,255,255,.06)!important;
}
#reply-menu-panel .reply-menu-title,
#reply-menu-panel .reply-menu-section-title,
#uie-main-menu #uie-menu-title,
#uie-main-menu .uie-launch-heading {
color:#f1c06a!important;
font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;
letter-spacing:.08em!important;
}
#reply-menu-panel .reply-menu-item,
#reply-menu-panel .reply-menu-tab-btn,
#uie-main-menu .uie-menu-tab {
background:#241915!important;
background-image:none!important;
color:#fff4df!important;
border-color:rgba(241,192,106,.24)!important;
box-shadow:inset 0 1px rgba(255,255,255,.08),0 10px 22px rgba(0,0,0,.24)!important;
}
#uie-main-menu .uie-menu-btn {
background:transparent!important;
background-image:none!important;
color:#fff4df!important;
border:0!important;
border-left:1px solid transparent!important;
border-radius:0!important;
box-shadow:none!important;
min-height:38px!important;
height:38px!important;
padding:0 10px!important;
}
#uie-main-menu .uie-menu-btn:hover {
background:rgba(255,255,255,.06)!important;
background-image:none!important;
color:#ffffff!important;
border-left-color:rgba(241,192,106,.72)!important;
}
#reply-menu-panel .reply-menu-item:hover,
#uie-main-menu .uie-menu-tab:hover {
background:#3d2a18!important;
background-image:none!important;
color:#fff!important;
border-color:rgba(241,192,106,.42)!important;
}
#startup-modal .main-menu-grid .reply-tool-btn {
background:transparent!important;
background-image:none!important;
color:#f8fdff!important;
border-color:transparent!important;
box-shadow:none!important;
border-radius:0!important;
}
#startup-modal .main-menu-grid .reply-tool-btn:hover {
background:rgba(255,255,255,.08)!important;
background-image:none!important;
color:#fff!important;
border-color:transparent!important;
box-shadow:none!important;
}
#reply-menu-panel .reply-menu-tab-btn.active,
#uie-main-menu .uie-menu-tab.active {
background:#5b371f!important;
background-image:none!important;
color:#fff8e8!important;
border-color:rgba(241,192,106,.5)!important;
}
`;
        let presetEl = document.getElementById("uie-rpg-style-preset-css");
        if (!presetEl) {
            presetEl = document.createElement("style");
            presetEl.id = "uie-rpg-style-preset-css";
            document.head.appendChild(presetEl);
        }
        presetEl.textContent = `${presetCss}\n${requestedMenuCss}`;

        let customEl = document.getElementById("uie-rpg-style-custom-css");
        if (!customEl) {
            customEl = document.createElement("style");
            customEl.id = "uie-rpg-style-custom-css";
            document.head.appendChild(customEl);
        }
        document.querySelectorAll(".uie-rpg-custom-html,.uie-rpg-custom-icon").forEach((el) => el.remove());

        const chunks = [];
        const targets = cfg.targets && typeof cfg.targets === "object" ? cfg.targets : {};
        for (const [target, data] of Object.entries(targets)) {
            const selector = rpgUiSelector(target);
            if (!selector || !data || typeof data !== "object") continue;
            const css = String(data.css || "").trim();
            if (css) chunks.push(css.includes("{") ? css : `${selector}{${css}}`);
            const url = String(data.url || "").trim();
            if (url) {
                chunks.push(`${selector}{background-image:url("${url.replace(/"/g, "%22")}")!important;background-size:cover!important;background-position:center!important;}`);
                const el = document.querySelector(selector.split(",")[0]);
                if (el && /^(BUTTON|A)$/i.test(el.tagName)) {
                    const img = document.createElement("img");
                    img.className = "uie-rpg-custom-icon";
                    img.src = url;
                    img.alt = "";
                    img.style.cssText = "width:18px;height:18px;object-fit:cover;border-radius:4px;margin-right:6px;vertical-align:-3px;pointer-events:none;";
                    el.prepend(img);
                }
            }
            const html = String(data.html || "").trim();
            if (html) {
                document.querySelectorAll(selector).forEach((el) => {
                    const wrap = document.createElement("div");
                    wrap.className = "uie-rpg-custom-html";
                    wrap.innerHTML = html;
                    el.appendChild(wrap);
                });
            }
        }
        customEl.textContent = chunks.join("\n");
        try { window.UIE_installModernUiOverrides?.(); } catch (_) {}
    } catch (err) {
        console.warn("[Core] RPG UI customization failed:", err);
    }
}

function refreshSavedClassDropdown() {
    try {
        const s = getSettings();
        ensureRpgSettingsState(s);
        const sel = document.getElementById("uie-class-saved");
        if (!sel) return;
        const classes = Array.isArray(s.character.savedClasses) ? s.character.savedClasses : [];
        sel.innerHTML = `<option value="">—</option>`;
        classes.forEach((c, idx) => {
            const label = String(c?.name || c?.className || `Class ${idx + 1}`);
            const opt = document.createElement("option");
            opt.value = String(idx);
            opt.textContent = label;
            sel.appendChild(opt);
        });
    } catch (_) {}
}

function syncRpgSettingsInputs() {
    try {
        const s = getSettings();
        ensureRpgSettingsState(s);
        const nm = document.getElementById("uie-rpg-name");
        const cls = document.getElementById("uie-rpg-class");
        const lvl = document.getElementById("uie-rpg-level");
        const sync = document.getElementById("uie-rpg-sync-persona");
        const mode = document.getElementById("uie-rpg-mode");
        if (nm) nm.value = String(s.character.name || "User");
        if (cls) cls.value = String(s.character.className || "");
        if (lvl) lvl.value = String(Number(s.character.level || 1) || 1);
        if (sync) sync.checked = s.character.syncPersona === true;
        if (mode) mode.value = String(s.character.mode || "adventurer");
        const sym = document.getElementById("uie-set-currency-sym");
        const code = document.getElementById("uie-set-currency-code");
        const name = document.getElementById("uie-set-currency-name");
        if (code) code.value = String(s.currencyCode || "CUSTOM");
        if (name) name.value = String(s.currencyName || getCurrencyPreset(s.currencyCode).name || "Currency");
        if (sym) sym.value = String(s.currencySymbol || "G");
        const r = s.rpgSettings || {};
        $("#uie-rpg-permadeath").prop("checked", r.permadeath === true);
        $("#uie-rpg-plot-armor").val(String(Number(r.plotArmor ?? 3)));
        $("#uie-rpg-difficulty").val(String(r.difficulty || "normal"));
        $("#uie-rpg-auto-damage").prop("checked", r.autoDamage !== false);
        $("#uie-rpg-battle-enabled").prop("checked", r.battleEnabled !== false);
        $("#uie-rpg-battle-auto-open").prop("checked", r.battleAutoOpen !== false);
        $("#uie-rpg-auto-battle").prop("checked", r.autoBattleEnabled === true);
        $("#uie-rpg-battle-action-style").val(String(r.battleActionStyle || "classic"));
        $("#uie-rpg-aging-enabled").prop("checked", r.agingEnabled !== false);
        $("#uie-rpg-aging-speed").val(String(Number(r.agingSpeed || 30)));
        $("#uie-rpg-lifespan-mult").val(String(Number(r.lifespanMultiplier || 1)));
        $("#uie-rpg-xp-mult").val(String(Number(r.xpMultiplier || 1)));
        $("#uie-rpg-xp-mult-val").text(`${Number(r.xpMultiplier || 1).toFixed(1)}x`);
        $("#uie-rpg-gold-mult").val(String(Number(r.goldMultiplier || 1)));
        $("#uie-rpg-gold-mult-val").text(`${Number(r.goldMultiplier || 1).toFixed(1)}x`);
        $("#uie-rpg-detailed-log").prop("checked", r.detailedBattleLog !== false);
        $("#uie-rpg-debuff-decay").prop("checked", r.debuffDecay !== false);
        $("#uie-rpg-readable-html-enabled").prop("checked", r.readableHtmlEnabled !== false);
        $("#uie-rpg-dynamic-response-boxes").prop("checked", r.dynamicResponseBoxesEnabled === true);
        $("#uie-rpg-style-preset").val(String(r.uiStyle?.preset || "parchment"));
        const styleTarget = String($("#uie-rpg-style-target").val() || "entire-ui");
        const styleData = r.uiStyle?.targets?.[styleTarget] || {};
        $("#uie-rpg-style-css").val(String(styleData.css || ""));
        $("#uie-rpg-style-html").val(String(styleData.html || ""));
        $("#uie-rpg-style-url").val(String(styleData.url || ""));
        refreshSavedClassDropdown();
    } catch (_) {}
}

$("body")
    .off("input.uieRpgSheet change.uieRpgSheet")
    .on("input.uieRpgSheet change.uieRpgSheet", "#uie-rpg-name, #uie-rpg-class, #uie-rpg-level, #uie-rpg-sync-persona, #uie-rpg-mode", function(e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const s = getSettings();
        ensureRpgSettingsState(s);
        s.character.name = String($("#uie-rpg-name").val() || s.character.name || "User").trim() || "User";
        s.character.className = String($("#uie-rpg-class").val() || s.character.className || "").trim();
        const lv = Number($("#uie-rpg-level").val());
        s.character.level = Number.isFinite(lv) && lv > 0 ? Math.floor(lv) : Number(s.character.level || 1) || 1;
        s.character.syncPersona = $("#uie-rpg-sync-persona").is(":checked");
        s.character.mode = String($("#uie-rpg-mode").val() || s.character.mode || "adventurer");
        saveSettings();
    })
    .off("click.uieRpgClassSave")
    .on("click.uieRpgClassSave", "#uie-class-save", function(e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const s = getSettings();
        ensureRpgSettingsState(s);
        const suggested = String(s.character.className || "").trim() || "Class";
        const name = String(window.prompt("Save class as:", suggested) || "").trim();
        if (!name) return;
        const snapshot = {
            name,
            className: String(s.character.className || "").trim(),
            level: Number(s.character.level || 1) || 1,
            stats: JSON.parse(JSON.stringify(s.character.stats || {})),
            skills: JSON.parse(JSON.stringify(s.inventory.skills || [])),
            assets: JSON.parse(JSON.stringify(s.inventory.assets || [])),
            life: JSON.parse(JSON.stringify(s.inventory.life || [])),
            savedAt: Date.now()
        };
        const arr = Array.isArray(s.character.savedClasses) ? s.character.savedClasses : [];
        const idx = arr.findIndex((x) => String(x?.name || "").toLowerCase() === name.toLowerCase());
        if (idx >= 0) arr[idx] = snapshot;
        else arr.push(snapshot);
        s.character.savedClasses = arr.slice(0, 100);
        saveSettings();
        refreshSavedClassDropdown();
        try { window.toastr?.success?.("Class saved.", "UIE"); } catch (_) {}
    })
    .off("click.uieRpgClassApply")
    .on("click.uieRpgClassApply", "#uie-class-apply", function(e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const s = getSettings();
        ensureRpgSettingsState(s);
        const idx = Number($("#uie-class-saved").val());
        if (!Number.isFinite(idx)) return;
        const entry = s.character.savedClasses[idx];
        if (!entry || typeof entry !== "object") return;
        s.character.className = String(entry.className || s.character.className || "").trim();
        s.character.level = Number(entry.level || s.character.level || 1) || 1;
        if (entry.stats && typeof entry.stats === "object") s.character.stats = JSON.parse(JSON.stringify(entry.stats));
        s.inventory.skills = Array.isArray(entry.skills) ? JSON.parse(JSON.stringify(entry.skills)) : [];
        s.inventory.assets = Array.isArray(entry.assets) ? JSON.parse(JSON.stringify(entry.assets)) : [];
        s.inventory.life = Array.isArray(entry.life) ? JSON.parse(JSON.stringify(entry.life)) : [];
        saveSettings();
        syncRpgSettingsInputs();
        try { updateLayout(); } catch (_) {}
        try { window.toastr?.success?.("Class applied.", "UIE"); } catch (_) {}
    })
    .off("click.uieRpgClassDelete")
    .on("click.uieRpgClassDelete", "#uie-class-delete", function(e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const s = getSettings();
        ensureRpgSettingsState(s);
        const idx = Number($("#uie-class-saved").val());
        if (!Number.isFinite(idx)) return;
        if (!Array.isArray(s.character.savedClasses) || !s.character.savedClasses[idx]) return;
        s.character.savedClasses.splice(idx, 1);
        saveSettings();
        refreshSavedClassDropdown();
        try { window.toastr?.success?.("Class removed.", "UIE"); } catch (_) {}
    })
    .off("click.uieRpgTabSync")
    .on("click.uieRpgTabSync", "#uie-sw-tabs .uie-set-tab", function() {
        const tab = String($(this).data("tab") || "").trim();
        if (tab) {
            setTimeout(syncRpgSettingsInputs, 0);
        }
    });

$("body")
    .off("input.uieRpgOptions change.uieRpgOptions")
    .on("input.uieRpgOptions change.uieRpgOptions", "#uie-rpg-permadeath, #uie-rpg-plot-armor, #uie-rpg-difficulty, #uie-rpg-auto-damage, #uie-rpg-battle-enabled, #uie-rpg-battle-auto-open, #uie-rpg-auto-battle, #uie-rpg-battle-action-style, #uie-rpg-aging-enabled, #uie-rpg-aging-speed, #uie-rpg-lifespan-mult, #uie-rpg-xp-mult, #uie-rpg-gold-mult, #uie-rpg-detailed-log, #uie-rpg-debuff-decay, #uie-rpg-readable-html-enabled, #uie-rpg-dynamic-response-boxes, #uie-rpg-style-preset", function(e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const s = getSettings();
        ensureRpgSettingsState(s);
        const r = s.rpgSettings;
        r.permadeath = $("#uie-rpg-permadeath").is(":checked");
        if (!s.world || typeof s.world !== "object") s.world = {};
        s.world.permadeath = r.permadeath;
        r.plotArmor = Math.max(0, Math.min(10, Number($("#uie-rpg-plot-armor").val()) || 0));
        r.difficulty = String($("#uie-rpg-difficulty").val() || "normal");
        r.autoDamage = $("#uie-rpg-auto-damage").is(":checked");
        r.battleEnabled = $("#uie-rpg-battle-enabled").is(":checked");
        r.battleAutoOpen = $("#uie-rpg-battle-auto-open").is(":checked");
        r.autoBattleEnabled = $("#uie-rpg-auto-battle").is(":checked");
        r.battleActionStyle = String($("#uie-rpg-battle-action-style").val() || "classic");
        r.agingEnabled = $("#uie-rpg-aging-enabled").is(":checked");
        r.agingSpeed = Math.max(1, Number($("#uie-rpg-aging-speed").val()) || 30);
        r.lifespanMultiplier = Math.max(0.1, Number($("#uie-rpg-lifespan-mult").val()) || 1);
        r.xpMultiplier = Number($("#uie-rpg-xp-mult").val()) || 1;
        r.goldMultiplier = Number($("#uie-rpg-gold-mult").val()) || 1;
        r.detailedBattleLog = $("#uie-rpg-detailed-log").is(":checked");
        r.debuffDecay = $("#uie-rpg-debuff-decay").is(":checked");
        r.readableHtmlEnabled = $("#uie-rpg-readable-html-enabled").is(":checked");
        r.dynamicResponseBoxesEnabled = $("#uie-rpg-dynamic-response-boxes").is(":checked");
        r.uiStyle.preset = String($("#uie-rpg-style-preset").val() || "parchment");
        $("#uie-rpg-xp-mult-val").text(`${Number(r.xpMultiplier || 1).toFixed(1)}x`);
        $("#uie-rpg-gold-mult-val").text(`${Number(r.goldMultiplier || 1).toFixed(1)}x`);
        saveSettings();
        applyRpgUiCustomization(s);
        try { window.dispatchEvent(new CustomEvent("uie:rpg_settings_changed", { detail: { dynamicResponseBoxesEnabled: r.dynamicResponseBoxesEnabled } })); } catch (_) {}
        try { window.UIE_dynamicResponseBox?.refresh?.(); } catch (_) {}
    })
    .off("change.uieRpgStyleTarget")
    .on("change.uieRpgStyleTarget", "#uie-rpg-style-target", function() {
        syncRpgSettingsInputs();
    })
    .off("click.uieRpgStyleSave")
    .on("click.uieRpgStyleSave", "#uie-rpg-style-save", function(e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const s = getSettings();
        ensureRpgSettingsState(s);
        const target = String($("#uie-rpg-style-target").val() || "entire-ui");
        s.rpgSettings.uiStyle.targets[target] = {
            css: String($("#uie-rpg-style-css").val() || ""),
            html: String($("#uie-rpg-style-html").val() || ""),
            url: String($("#uie-rpg-style-url").val() || "")
        };
        saveSettings();
        applyRpgUiCustomization(s);
        try { window.toastr?.success?.("UI style saved.", "RPG Settings"); } catch (_) {}
    })
    .off("click.uieRpgStyleClear")
    .on("click.uieRpgStyleClear", "#uie-rpg-style-clear", function(e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const s = getSettings();
        ensureRpgSettingsState(s);
        const target = String($("#uie-rpg-style-target").val() || "entire-ui");
        delete s.rpgSettings.uiStyle.targets[target];
        $("#uie-rpg-style-css, #uie-rpg-style-html, #uie-rpg-style-url").val("");
        saveSettings();
        applyRpgUiCustomization(s);
    })
    .off("click.uieRpgStyleFilePick")
    .on("click.uieRpgStyleFilePick", "#uie-rpg-style-file-pick", function(e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        document.getElementById("uie-rpg-style-file")?.click();
    })
    .off("change.uieRpgStyleFile")
    .on("change.uieRpgStyleFile", "#uie-rpg-style-file", function() {
        const file = this.files && this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            $("#uie-rpg-style-url").val(String(reader.result || ""));
            $("#uie-rpg-style-save").trigger("click");
        };
        reader.readAsDataURL(file);
        this.value = "";
    });

try { setTimeout(syncRpgSettingsInputs, 500); } catch (_) {}

$("body")
    .off("change.uieCoreKill")
    .on("change.uieCoreKill", "#uie-setting-enable", function (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const on = $(this).prop("checked") === true;
        console.log("[UIE] Kill Switch toggled:", on);
        try { window.UIE_lastCoreToggle = { id: String(this?.id || ""), on, at: Date.now() }; } catch (_) {}
        const s = getSettings();
        s.enabled = on === true;
        saveSettings();
        try {
            document.querySelectorAll("#uie-setting-enable").forEach((el) => {
                try { el.checked = on; } catch (_) {}
            });
        } catch (_) {}
        if (s.enabled === false) {
            try { $("#uie-main-menu").hide(); } catch (_) {}
            try { $(".uie-window, .uie-overlay, .uie-modal, .uie-full-modal").hide(); } catch (_) {}
        }
        try { updateLayout(); } catch (_) {}
    })
    .off("change.uieCoreScanAll")
    .on("change.uieCoreScanAll", "#uie-scanall-enable, #uie-sw-scanall-enable, #uie-wand-scanall-enable", function (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const on = $(this).prop("checked") === true;
        try { window.UIE_lastCoreToggle = { id: String(this?.id || ""), on, at: Date.now() }; } catch (_) {}
        const s = getSettings();
        if (!s.generation || typeof s.generation !== "object") s.generation = {};
        s.generation.scanAllEnabled = on === true;
        saveSettings();
        try {
            document.querySelectorAll("#uie-scanall-enable, #uie-sw-scanall-enable, #uie-wand-scanall-enable").forEach((el) => {
                try { el.checked = on; } catch (_) {}
            });
        } catch (_) {}
    })
    .off("change.uieCoreSysChecks")
    .on("change.uieCoreSysChecks", "#uie-systemchecks-enable, #uie-sw-systemchecks-enable, #uie-wand-systemchecks-enable", function (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const on = $(this).prop("checked") === true;
        try { window.UIE_lastCoreToggle = { id: String(this?.id || ""), on, at: Date.now() }; } catch (_) {}
        const s = getSettings();
        if (!s.generation || typeof s.generation !== "object") s.generation = {};
        s.generation.allowSystemChecks = on === true;
        saveSettings();
        try {
            document.querySelectorAll("#uie-systemchecks-enable, #uie-sw-systemchecks-enable, #uie-wand-systemchecks-enable").forEach((el) => {
                try { el.checked = on; } catch (_) {}
            });
        } catch (_) {}
    })
    .off("change.uieCorePopups")
    .on("change.uieCorePopups", "#uie-show-popups", function (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const on = $(this).prop("checked") === true;
        try { window.UIE_lastCoreToggle = { id: String(this?.id || ""), on, at: Date.now() }; } catch (_) {}
        const s = getSettings();
        if (!s.ui || typeof s.ui !== "object") s.ui = {};
        s.ui.showPopups = on === true;
        saveSettings();
        try {
            document.querySelectorAll("#uie-show-popups").forEach((el) => {
                try { el.checked = on; } catch (_) {}
            });
        } catch (_) {}
    });

export function resolveApiKey(keyOrId) {
    if (!keyOrId || typeof keyOrId !== "string") return "";
    const clean = keyOrId.trim();
    if (!clean) return "";
    const s = getSettings();
    if (s.savedApiKeys && typeof s.savedApiKeys === "object") {
        if (s.savedApiKeys[clean] && typeof s.savedApiKeys[clean] === "object") {
            return String(s.savedApiKeys[clean].value || "").trim();
        }
    }
    return clean;
}

try {
    window.UIE = window.UIE || {};
    window.UIE.resolveApiKey = resolveApiKey;
} catch (_) {}
