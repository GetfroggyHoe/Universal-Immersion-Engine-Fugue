import { getSettings, commitStateUpdate } from "./core.js";
import { getGlobalDOM } from "./domHierarchy.js";
import { getGlobalGovernor } from "./governor.js";
import { getContext } from "./gameContext.js";
import { generateContent } from "./apiClient.js";
import { notify } from "./notifications.js";
import { normalizeStatusList, normalizeStatusEffect, statusKey } from "./statusFx.js";
import { injectRpEvent } from "./features/rp_log.js";
import { getChatTranscriptText, getRecentChatSnippet } from "./chatLog.js";
import { safeJsonParseObject } from "./jsonUtil.js";
import { addDatabankEntryWithDedupe } from "./databankModel.js";
import { addInventoryItemWithStack, createOpenableContainerItem, isContainerItem, normalizeInventoryStacksInPlace } from "./inventoryItems.js";
import { ensureEconomyState, addCurrency, spendCurrency, grantXp } from "./economy.js";
import { ensureTravelAssetFields } from "./travelAssets.js";
import { getGameMode } from "./gameModeManager.js";
import { spawnStageSprite } from "./sprites.js";

function defaultEventTypes() {
    return {
        MESSAGE_RECEIVED: "message_received",
        GENERATION_ENDED: "generation_ended",
        MESSAGE_DELETED: "message_deleted",
    };
}

async function resolveStEventBus() {
    return { src: null, types: null };
}

function initDomAutoScanningFallback() {
    try {
        if (typeof window !== "undefined" && window.UIE_gameOwnsPostReplyScan === true) return;
    } catch (_) {}
    try {
        if (window.UIE_domAutoScanBound) return;
        window.UIE_domAutoScanBound = true;
        window.UIE_domAutoScanBoundAt = Date.now();
    } catch (_) {}

    let t = null;
    const schedule = () => {
        try {
            const s = getSettings();
            if (!s || s.enabled === false) return;
            if (s.generation?.scanAllEnabled === false) return;
            // If the real ST event bus is bound, only scan here when the user explicitly
            // wants scans to happen only on generate buttons (avoid double scanning).
            if (window.UIE_autoScanHasEventBus === true && s.generation?.scanOnlyOnGenerateButtons !== true) return;
        } catch (_) {}

        if (t) clearTimeout(t);
        t = setTimeout(() => {
            try {
                const s = getSettings();
                const min = Math.max(1000, Number(s?.generation?.autoScanMinIntervalMs || 8000));
                const now = Date.now();
                if (window.UIE_scanEverythingGate && (now - Number(window.UIE_scanEverythingGate.lastAt || 0) < min)) return;
            } catch (_) {}
            try { window.UIE_autoScanLastRunAt = Date.now(); } catch (_) {}
            scanEverything({}).catch((e) => {
                try { window.UIE_autoScanLastError = String(e?.message || e || ""); } catch (_) {}
            });
        }, 350);
    };

    try {
        document.body.addEventListener("click", (e) => {
            try {
                const el = e?.target && e.target.closest ? e.target.closest("button, a, [role='button'], input[type='button'], input[type='submit']") : null;
                if (!el) return;
                const id = String(el.id || "");
                const testid = String(el.getAttribute?.("data-testid") || "");
                const cls = String(el.className || "");
                const blob = `${id} ${testid} ${cls}`.toLowerCase();
                const match =
                    blob.includes("send") ||
                    blob.includes("continue") ||
                    blob.includes("regenerate") ||
                    blob.includes("regen");
                if (!match) return;
                try { window.UIE_autoScanLastTriggerAt = Date.now(); } catch (_) {}
                schedule();
            } catch (_) {}
        }, true);
    } catch (_) {}
}

function cloneJsonSafe(v) {
    try {
        return JSON.parse(JSON.stringify(v));
    } catch (_) {
        return null;
    }
}

function readChatFingerprintList() {
    try {
        const w = typeof window !== "undefined" ? window : globalThis;
        const arr = Array.isArray(w?.chat) ? w.chat : null;
        if (!arr || !arr.length) return [];
        const out = new Array(arr.length);
        for (let i = 0; i < arr.length; i++) out[i] = fingerprintChatMessage(arr[i]);
        return out;
    } catch (_) {
        return [];
    }
}

function deepEqual(a, b) {
    try {
        if (a === b) return true;
        if (typeof a !== typeof b) return false;
        if (a === null || b === null) return a === b;
        if (typeof a !== "object") return a === b;
        return JSON.stringify(a) === JSON.stringify(b);
    } catch (_) {
        return false;
    }
}

function getByPath(root, path) {
    let cur = root;
    for (const p of path) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}

function setByPath(root, path, value) {
    if (!path.length) return;
    let cur = root;
    for (let i = 0; i < path.length - 1; i++) {
        const p = path[i];
        if (cur[p] == null || typeof cur[p] !== "object") {
            cur[p] = typeof path[i + 1] === "number" ? [] : {};
        }
        cur = cur[p];
    }
    cur[path[path.length - 1]] = value;
}

function chooseArrayKeyField(arrA, arrB) {
    try {
        const fields = ["id", "name", "slotId", "key", "title", "kind"];
        const all = (Array.isArray(arrA) ? arrA : []).concat(Array.isArray(arrB) ? arrB : []);
        if (!all.length) return null;
        if (!all.every((x) => x && typeof x === "object" && !Array.isArray(x))) return null;
        for (const f of fields) {
            const vals = all.map((x) => x?.[f]).filter((v) => typeof v === "string" || typeof v === "number");
            if (vals.length !== all.length) continue;
            const set = new Set(vals.map((v) => String(v)));
            if (set.size !== vals.length) continue;
            return f;
        }
    } catch (_) {}
    return null;
}

function diffValues(before, after, path, ops) {
    if (deepEqual(before, after)) return;

    const aIsArr = Array.isArray(before);
    const bIsArr = Array.isArray(after);
    if (aIsArr && bIsArr) {
        const keyField = chooseArrayKeyField(before, after);
        if (!keyField) {
            ops.push({ type: "set", path, before: cloneJsonSafe(before), after: cloneJsonSafe(after) });
            return;
        }

        const mapA = new Map();
        const mapB = new Map();
        for (const el of before) mapA.set(String(el[keyField]), el);
        for (const el of after) mapB.set(String(el[keyField]), el);

        for (const [k, aEl] of mapA.entries()) {
            if (!mapB.has(k)) {
                ops.push({ type: "array_remove", path, keyField, key: k, before: cloneJsonSafe(aEl), after: null });
            }
        }
        for (const [k, bEl] of mapB.entries()) {
            if (!mapA.has(k)) {
                ops.push({ type: "array_add", path, keyField, key: k, before: null, after: cloneJsonSafe(bEl) });
            }
        }
        for (const [k, aEl] of mapA.entries()) {
            if (!mapB.has(k)) continue;
            const bEl = mapB.get(k);
            if (deepEqual(aEl, bEl)) continue;
            ops.push({ type: "array_set", path, keyField, key: k, before: cloneJsonSafe(aEl), after: cloneJsonSafe(bEl) });
        }
        return;
    }

    const aIsObj = before && typeof before === "object" && !aIsArr;
    const bIsObj = after && typeof after === "object" && !bIsArr;
    if (aIsObj && bIsObj) {
        const keys = new Set(Object.keys(before).concat(Object.keys(after)));
        for (const k of keys) diffValues(before[k], after[k], path.concat([k]), ops);
        return;
    }

    ops.push({ type: "set", path, before: cloneJsonSafe(before), after: cloneJsonSafe(after) });
}

function diffSnapshots(beforeSnap, afterSnap) {
    const ops = [];
    try {
        const keys = new Set(Object.keys(beforeSnap || {}).concat(Object.keys(afterSnap || {})));
        for (const k of keys) diffValues(beforeSnap?.[k], afterSnap?.[k], [k], ops);
    } catch (_) {}
    return ops;
}

function applyUndoOps(s, ops) {
    try {
        if (!Array.isArray(ops) || !ops.length) return false;
        let changed = false;
        for (const op of ops) {
            if (!op || typeof op !== "object") continue;
            const path = Array.isArray(op.path) ? op.path : [];
            if (!path.length) continue;

            if (op.type === "set") {
                const cur = getByPath(s, path);
                if (!deepEqual(cur, op.after)) continue;
                setByPath(s, path, cloneJsonSafe(op.before));
                changed = true;
                continue;
            }

            if (op.type === "array_add" || op.type === "array_remove" || op.type === "array_set") {
                const arr = getByPath(s, path);
                if (!Array.isArray(arr)) continue;
                const keyField = String(op.keyField || "");
                const key = String(op.key || "");
                if (!keyField || !key) continue;

                const idx = arr.findIndex((x) => x && typeof x === "object" && String(x?.[keyField]) === key);

                if (op.type === "array_add") {
                    if (idx === -1) continue;
                    if (op.after && !deepEqual(arr[idx], op.after)) continue;
                    arr.splice(idx, 1);
                    changed = true;
                    continue;
                }

                if (op.type === "array_remove") {
                    if (idx !== -1) continue;
                    if (!op.before) continue;
                    arr.push(cloneJsonSafe(op.before));
                    changed = true;
                    continue;
                }

                if (op.type === "array_set") {
                    if (idx === -1) continue;
                    if (op.after && !deepEqual(arr[idx], op.after)) continue;
                    if (op.before == null) continue;
                    arr[idx] = cloneJsonSafe(op.before);
                    changed = true;
                    continue;
                }
            }
        }
        return changed;
    } catch (_) {
        return false;
    }
}

function ensureUndoStore() {
    try {
        const w = typeof window !== "undefined" ? window : globalThis;
        if (!w.UIE_scanUndo) w.UIE_scanUndo = { byMesId: {}, byFp: {}, lastMesId: null, lastChatFps: null };
        if (!w.UIE_scanUndo.byMesId || typeof w.UIE_scanUndo.byMesId !== "object") w.UIE_scanUndo.byMesId = {};
        if (!w.UIE_scanUndo.byFp || typeof w.UIE_scanUndo.byFp !== "object") w.UIE_scanUndo.byFp = {};
        return w.UIE_scanUndo;
    } catch (_) {
        return { byMesId: {}, byFp: {}, lastMesId: null, lastChatFps: null };
    }
}

function readUndoMesIdFromArgs(args) {
    try {
        const v = args && args.length ? args[0] : null;
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) return n;
    } catch (_) {}
    return null;
}

function fingerprintChatMessage(m) {
    try {
        if (!m || typeof m !== "object") return "";
        const name = String(m.name ?? "");
        const isUser = m.is_user ? "1" : "0";
        const send = String(m.send_date ?? "");
        const mes = String(m.mes ?? "");
        const head = mes.length > 240 ? mes.slice(0, 240) : mes;
        const tail = mes.length > 240 ? mes.slice(-120) : "";
        return `${isUser}|${name}|${send}|${mes.length}|${head}|${tail}`;
    } catch (_) {
        return "";
    }
}

function readChatTailFingerprint() {
    try {
        const w = typeof window !== "undefined" ? window : globalThis;
        const arr = Array.isArray(w?.chat) ? w.chat : null;
        if (!arr || !arr.length) return "";
        return fingerprintChatMessage(arr[arr.length - 1]);
    } catch (_) {
        return "";
    }
}

function readChatScanSignature() {
    try {
        const sig = readChatSig();
        const count = Number(sig?.count || 0) || 0;
        const tailFp = String(readChatTailFingerprint() || "");
        return `${count}|${tailFp}`;
    } catch (_) {
        return "";
    }
}

function snapshotScanTouchedState(s) {
    const keys = [
        "worldState",
        "inventory",
        "currency",
        "currencySymbol",
        "currencyRate",
        "hp",
        "maxHp",
        "mp",
        "maxMp",
        "life",
        "character",
        "quests",
        "journal",
        "databank",
        "phone",
        "social",
        "socialMeta",
        "party",
        "battle",
    ];
    const out = {};
    for (const k of keys) {
        if (k in s) out[k] = cloneJsonSafe(s[k]);
    }
    return out;
}

function restoreSnapshotIntoSettings(s, snap) {
    const keys = [
        "worldState",
        "inventory",
        "currency",
        "currencySymbol",
        "currencyRate",
        "hp",
        "maxHp",
        "mp",
        "maxMp",
        "life",
        "character",
        "quests",
        "journal",
        "databank",
        "phone",
        "social",
        "socialMeta",
        "party",
        "battle",
    ];
    for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(snap, k)) {
            const v = cloneJsonSafe(snap[k]);
            if (v === null || v === undefined) delete s[k];
            else s[k] = v;
        } else {
            try { delete s[k]; } catch (_) {}
        }
    }
}

/**
 * Ensures the state tracking object exists.
 */
function ensureState(s) {
    if (!s.worldState) s.worldState = {
        location: "Unknown",
        threat: "None",
        status: "Normal",
        time: "Day",
        weather: "Clear",
        custom: {} // For any other flexible keys
    };
    if (!s.inventory) s.inventory = {};
    if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
    if (!s.life) s.life = {};
    if (!Array.isArray(s.life.trackers)) s.life.trackers = [];
    if (!s.life.ai || typeof s.life.ai !== "object") s.life.ai = {};
    if (typeof s.life.ai.enabled !== "boolean") s.life.ai.enabled = true;
    if (!String(s.life.ai.template || "").trim()) s.life.ai.template = DEFAULT_LIFE_SCAN_TEMPLATE;
    if (!s.character) s.character = {};
    if (!Array.isArray(s.character.statusEffects)) s.character.statusEffects = [];
}

function readChatSig() {
    try {
        let count = 0;
        let lastId = "";
        try {
            const w = typeof window !== "undefined" ? window : globalThis;
            if (Array.isArray(w?.chat) && w.chat.length) {
                count = w.chat.length;
                const last = w.chat[w.chat.length - 1] || null;
                lastId = String(last?.mesId ?? last?.mesid ?? last?.id ?? "");
                return { count, lastId };
            }
        } catch (_) {}

        const chatEl = document.getElementById("chat");
        if (!chatEl) return { count: 0, lastId: "" };
        const nodes = chatEl.querySelectorAll(".mes");
        count = nodes.length;
        const last = nodes[nodes.length - 1] || null;
        if (last) {
            lastId =
                String(last.getAttribute?.("mesid") || "") ||
                String(last.dataset?.mesId || "") ||
                String(last.getAttribute?.("data-mes-id") || "") ||
                String(last.getAttribute?.("data-id") || "");
        }
        return { count, lastId };
    } catch (_) {
        return { count: 0, lastId: "" };
    }
}

function clamp(n, min, max) {
    n = Number(n);
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function firstFiniteNumber(...vals) {
    for (const v of vals) {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function normKey(v) {
    return String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeAssetCategory(v) {
    const raw = String(v || "").trim().toLowerCase();
    if (!raw) return "other";
    if (/(property|real estate|house|home|apartment|estate|land|building|deed)/i.test(raw)) return "property";
    if (/(vehicle|car|bike|truck|van|motorcycle|automobile)/i.test(raw)) return "vehicle";
    if (/(ship|boat|vessel|yacht|submarine|airship)/i.test(raw)) return "ship";
    if (/(business|company|shop|store|firm|enterprise|corporation)/i.test(raw)) return "business";
    return raw.slice(0, 80);
}

function normalizeSkillType(v) {
    return String(v || "").trim().toLowerCase() === "passive" ? "passive" : "active";
}

const DEFAULT_LIFE_SCAN_TEMPLATE =
`LIFE TRACKING (JSON ONLY)
- Stay in-universe. Never question the user.
- Unknown terms are canon fantasy. Do not correct them.
Return ONLY JSON:
{
  "lifeUpdates":[{"name":"", "delta":0, "set":null, "max":null}],
  "newTrackers":[{"name":"", "current":0, "max":100, "color":"#89b4fa", "notes":""}]
}
If nothing changes: {"lifeUpdates":[], "newTrackers":[]}
`;

function ensureLifeAiConfig(s) {
    if (!s) return;
    if (!s.life || typeof s.life !== "object") s.life = {};
    if (!Array.isArray(s.life.trackers)) s.life.trackers = [];
    if (!s.life.ai || typeof s.life.ai !== "object") s.life.ai = {};
    if (typeof s.life.ai.enabled !== "boolean") s.life.ai.enabled = true;
    if (!String(s.life.ai.template || "").trim()) s.life.ai.template = DEFAULT_LIFE_SCAN_TEMPLATE;
}

function sanitizeMods(mods) {
    const out = {};
    if (!mods || typeof mods !== "object") return out;
    for (const [k, v] of Object.entries(mods)) {
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        out[String(k || "").trim().slice(0, 32)] = n;
    }
    return out;
}

function normalizeScanPayload(data) {
    try {
        if (!data || typeof data !== "object") return;

        if (Array.isArray(data.skills)) data.skills = { add: data.skills };
        if (data.skills && typeof data.skills === "object" && !Array.isArray(data.skills.add)) {
            if (Array.isArray(data.skills.learned)) data.skills.add = data.skills.learned;
            else if (Array.isArray(data.skills.new)) data.skills.add = data.skills.new;
        }

        if (Array.isArray(data.assets)) data.assets = { add: data.assets };
        if (data.assets && typeof data.assets === "object" && !Array.isArray(data.assets.add)) {
            if (Array.isArray(data.assets.new)) data.assets.add = data.assets.new;
            else if (Array.isArray(data.assets.items)) data.assets.add = data.assets.items;
        }

        if (!data.inventory || typeof data.inventory !== "object" || Array.isArray(data.inventory)) {
            const invArr = Array.isArray(data.inventory) ? data.inventory : null;
            const itemsArr = Array.isArray(data.items) ? data.items : null;
            if (invArr || itemsArr) data.inventory = { added: invArr || itemsArr };
        }
        if (data.inventory && typeof data.inventory === "object") {
            if (!Array.isArray(data.inventory.added)) {
                if (Array.isArray(data.inventory.items)) data.inventory.added = data.inventory.items;
                else if (Array.isArray(data.inventory.add)) data.inventory.added = data.inventory.add;
                else if (Array.isArray(data.inventory.found)) data.inventory.added = data.inventory.found;
                else if (Array.isArray(data.items)) data.inventory.added = data.items;
            }
            if (!Array.isArray(data.inventory.removed)) {
                if (Array.isArray(data.inventory.remove)) data.inventory.removed = data.inventory.remove;
                else if (Array.isArray(data.inventory.lost)) data.inventory.removed = data.inventory.lost;
                else if (Array.isArray(data.inventory.used)) data.inventory.removed = data.inventory.used;
            }
        }

        if (!data.character || typeof data.character !== "object") {
            const topName = String(data?.name || "").trim();
            const topClass = String(data?.className || data?.class || "").trim();
            const topLevel = Number(data?.level);
            const nextCharacter = {};
            if (topName) nextCharacter.name = topName;
            if (topClass) nextCharacter.className = topClass;
            if (Number.isFinite(topLevel) && topLevel > 0) nextCharacter.level = Math.floor(topLevel);
            if (Object.keys(nextCharacter).length) data.character = nextCharacter;
        } else {
            const cls = String(data.character.className || data.character.class || "").trim();
            if (cls && !String(data.character.className || "").trim()) data.character.className = cls;
        }

        const statMap = { hp: "maxHp", mp: "maxMp", ap: "maxAp", xp: "maxXp" };
        const bars = (data.bars && typeof data.bars === "object") ?
             data.bars
            : ((data.vitals && typeof data.vitals === "object") ? data.vitals : null);

        if (bars || (data.stats && typeof data.stats === "object")) {
            if (!data.stats || typeof data.stats !== "object") data.stats = {};
        }

        const applySetIfMissing = (key, value) => {
            const n = Number(value);
            if (!Number.isFinite(n)) return;
            const cur = data.stats[key];
            if (cur === undefined) {
                data.stats[key] = { set: n };
                return;
            }
            if (cur && typeof cur === "object" && !Array.isArray(cur)) {
                const hasSet = Number.isFinite(Number(cur.set)) || Number.isFinite(Number(cur.current));
                if (!hasSet) data.stats[key] = { ...cur, set: n };
            }
        };

        if (bars && data.stats && typeof data.stats === "object") {
            for (const [key, maxKey] of Object.entries(statMap)) {
                const raw = bars[key];
                if (raw && typeof raw === "object") {
                    if (Number.isFinite(Number(raw.set))) applySetIfMissing(key, raw.set);
                    else if (Number.isFinite(Number(raw.current))) applySetIfMissing(key, raw.current);
                    if (Number.isFinite(Number(raw.max))) data.stats[maxKey] = Number(raw.max);
                } else if (Number.isFinite(Number(raw))) {
                    applySetIfMissing(key, raw);
                }
                if (Number.isFinite(Number(bars[maxKey]))) data.stats[maxKey] = Number(bars[maxKey]);
            }
        }

        if (data.stats && typeof data.stats === "object") {
            for (const [key, maxKey] of Object.entries(statMap)) {
                if (Number.isFinite(Number(data[key]))) applySetIfMissing(key, data[key]);
                if (Number.isFinite(Number(data[maxKey]))) data.stats[maxKey] = Number(data[maxKey]);
            }
        }

        if (!data.life || typeof data.life !== "object" || Array.isArray(data.life)) {
            const hasTopLevel = Array.isArray(data.lifeUpdates) || Array.isArray(data.newTrackers);
            if (hasTopLevel) {
                data.life = {
                    lifeUpdates: Array.isArray(data.lifeUpdates) ? data.lifeUpdates : [],
                    newTrackers: Array.isArray(data.newTrackers) ? data.newTrackers : []
                };
            } else if (Array.isArray(data.life)) {
                const arr = data.life;
                const looksLikeUpdate = arr.some((x) => x && typeof x === "object" && (
                    x.delta !== undefined || x.set !== undefined || x.max !== undefined
                ));
                data.life = looksLikeUpdate ?
                     { lifeUpdates: arr, newTrackers: [] }
                    : { lifeUpdates: [], newTrackers: arr };
            }
        }

        if (data.life && typeof data.life === "object" && !Array.isArray(data.life)) {
            if (!Array.isArray(data.life.lifeUpdates)) {
                if (Array.isArray(data.life.updates)) data.life.lifeUpdates = data.life.updates;
                else if (Array.isArray(data.life.apply)) data.life.lifeUpdates = data.life.apply;
                else data.life.lifeUpdates = [];
            }
            if (!Array.isArray(data.life.newTrackers)) {
                if (Array.isArray(data.life.trackers)) data.life.newTrackers = data.life.trackers;
                else if (Array.isArray(data.life.add)) data.life.newTrackers = data.life.add;
                else data.life.newTrackers = [];
            }
        }
    } catch (_) {}
}

function escapeRegExp(text) {
    return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasExplicitOwnershipEvidence(text, entityName = "", chatHint = "") {
    const t = String(text || "").toLowerCase();
    const ownsInText =
        /(?:user|you|player|party|we)\s+(?:explicitly\s+)?(?:take|takes|took|pick(?:ed)?\s+up|put|puts|placed|stow(?:ed)?|add(?:ed)?\s+to\s+(?:my|your|the)?\s*(?:inventory|bag|pack|pouch|backpack)|buy|bought|purchase(?:d)?|receive(?:d)?|accept(?:ed)?|equip(?:ped)?|craft(?:ed)?|loot(?:ed)?|claim(?:ed)?|obtain(?:ed)?|acquire(?:d)?|keep(?:s|ing)?|own(?:s|ed)?)/i.test(t) ||
        /(?:added|placed|put|stowed)\s+(?:it|them|.+?)\s+(?:in|into|to)\s+(?:my|your|the)?\s*(?:inventory|bag|pack|pouch|backpack)/i.test(t);
    if (ownsInText) return true;

    const nm = String(entityName || "").trim();
    const hint = String(chatHint || "");
    if (!nm || !hint) return false;

    const nameRx = escapeRegExp(nm).replace(/\s+/g, "\\s+");
    const acq = "(?:take|takes|took|picked\\s+up|pick\\s+up|put|puts|placed|stowed|add(?:ed)?\\s+to\\s+(?:inventory|bag|pack|pouch|backpack)|bought|buy|purchased|acquired|obtained|received|receives|crafted|crafts|looted|loot|claimed|accepted|equipped)";
    const owner = "(?:user|you|player|party|inventory|bag|backpack)";

    try {
        const ownerThenAcquire = new RegExp(`${owner}[\\s\\S]{0,160}${acq}[\\s\\S]{0,140}${nameRx}`, "i");
        const acquireThenItem = new RegExp(`${acq}[\\s\\S]{0,120}${nameRx}`, "i");
        const itemThenInventory = new RegExp(`${nameRx}[\\s\\S]{0,120}(?:added\\s+to\\s+(?:your\\s+)?(?:inventory|bag|backpack)|in\\s+your\\s+(?:inventory|bag|backpack)|now\\s+in\\s+inventory)`, "i");
        return ownerThenAcquire.test(hint) || acquireThenItem.test(hint) || itemThenInventory.test(hint);
    } catch (_) {
        return false;
    }
}

function ensureWorldItems(s) {
    if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
    if (!Array.isArray(s.worldState.worldItems)) s.worldState.worldItems = [];
    return s.worldState.worldItems;
}

function rememberWorldItem(s, rawItem = {}, context = {}) {
    const name = String(rawItem?.name || "").trim().slice(0, 120);
    if (!name) return false;
    const list = ensureWorldItems(s);
    const loc = String(s.worldState?.location || s.currentLocation || "Current Area").trim() || "Current Area";
    const key = `${loc}:${name}`.toLowerCase();
    const existing = list.find((item) => String(item?._key || "").toLowerCase() === key);
    const payload = {
        _key: key,
        name,
        type: String(rawItem?.type || "item").trim().slice(0, 80) || "item",
        description: String(rawItem?.desc || rawItem?.description || "A world item present in the scene.").trim().slice(0, 1200),
        qty: Math.max(1, Math.round(Number(rawItem?.qty || 1))),
        location: loc,
        statusEffects: Array.isArray(rawItem?.statusEffects) ? rawItem.statusEffects : [],
        mods: rawItem?.mods && typeof rawItem.mods === "object" ? rawItem.mods : {},
        evidence: String(context?.evidence || rawItem?.evidence || "").trim().slice(0, 240),
        updatedAt: Date.now(),
    };
    if (existing) Object.assign(existing, payload);
    else list.push({ ...payload, createdAt: Date.now() });
    return true;
}

function findLifeTracker(s, name) {
    const n = String(name || "").trim().toLowerCase();
    if (!n) return null;
    const list = Array.isArray(s?.life?.trackers) ? s.life.trackers : [];
    for (const t of list) {
        if (String(t?.name || "").trim().toLowerCase() === n) return t;
    }
    return null;
}

function ensureSocial(s) {
    if (!s.social || typeof s.social !== "object") s.social = { friends: [], associates: [], romance: [], family: [], rivals: [] };
    for (const k of ["friends", "associates", "romance", "family", "rivals"]) {
        if (!Array.isArray(s.social[k])) s.social[k] = [];
    }
    if (!s.socialMeta || typeof s.socialMeta !== "object") s.socialMeta = { autoScan: false, deletedNames: [] };
    if (!Array.isArray(s.socialMeta.deletedNames)) s.socialMeta.deletedNames = [];
}

function ensureJournal(s) {
    if (!s.journal || typeof s.journal !== "object") s.journal = { active: [], pending: [], abandoned: [], completed: [], codex: [] };
    for (const k of ["active", "pending", "abandoned", "completed", "codex"]) {
        if (!Array.isArray(s.journal[k])) s.journal[k] = [];
    }
}

function ensureParty(s) {
    if (!s.party) s.party = { members: [], sharedItems: [], relationships: {}, partyTactics: {}, formation: { lanes: { front:[], mid:[], back:[] } } };
    if (!Array.isArray(s.party.members)) s.party.members = [];
    if (!Array.isArray(s.party.sharedItems)) s.party.sharedItems = [];
    if (!s.party.relationships || typeof s.party.relationships !== "object") s.party.relationships = {};
    if (!s.party.partyTactics || typeof s.party.partyTactics !== "object") s.party.partyTactics = {};
    if (!s.party.formation || typeof s.party.formation !== "object") s.party.formation = { lanes: { front: [], mid: [], back: [] } };
    if (!s.party.formation.lanes || typeof s.party.formation.lanes !== "object") s.party.formation.lanes = { front: [], mid: [], back: [] };
    for (const lane of ["front", "mid", "back"]) {
        if (!Array.isArray(s.party.formation.lanes[lane])) s.party.formation.lanes[lane] = [];
    }
}

function createMember(name) {
    return {
        id: Date.now() + Math.random().toString(36).substr(2, 5),
        identity: { name: name || "Member", class: "Adventurer", species: "Human" },
        images: { portrait: "" },
        stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, per: 10, luk: 10, agi: 10, vit: 10, end: 10, spi: 10 },
        vitals: { hp: 100, maxHp: 100, mp: 50, maxMp: 50, ap: 10, maxAp: 10 },
        progression: { level: 1, xp: 0, skillPoints: 0, perkPoints: 0 },
        equipment: {},
        trackers: [],
        partyRole: "DPS",
        roles: ["Character"],
        statusEffects: [],
        active: true,
        temporary: false,
        followsUser: true,
        personalItems: [],
        tactics: { preset: "Balanced", focus: "auto" }
    };
}

function nextPartyTrackerId() {
    return `ptrk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePartyTrackerColor(v) {
    const raw = String(v || "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : "#89b4fa";
}

function normalizePartyTracker(raw = {}) {
    const id = String(raw?.id || nextPartyTrackerId()).trim() || nextPartyTrackerId();
    const name = String(raw?.name || "Tracker").trim().slice(0, 60) || "Tracker";
    const max = Math.max(1, Number.isFinite(Number(raw?.max)) ? Number(raw.max) : 100);
    const color = normalizePartyTrackerColor(raw?.color);
    const notes = String(raw?.notes || "").slice(0, 800);
    const current = clamp(Number.isFinite(Number(raw?.current)) ? Number(raw.current) : 0, 0, max);
    return { id, name, current, max, color, notes };
}

function findPartyMemberByName(s, name) {
    const key = normKey(name);
    if (!key) return null;
    const list = Array.isArray(s?.party?.members) ? s.party.members : [];
    for (const m of list) {
        if (normKey(m?.identity?.name || m?.name) === key) return m;
    }
    return null;
}

function ensurePartyMemberState(m) {
    if (!m || typeof m !== "object") return;
    if (!m.identity || typeof m.identity !== "object") m.identity = { name: "Member", class: "Adventurer", species: "Human" };
    if (!m.stats || typeof m.stats !== "object") m.stats = {};
    for (const [k, v] of Object.entries({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, per: 10, luk: 10, agi: 10, vit: 10, end: 10, spi: 10 })) {
        if (!Number.isFinite(Number(m.stats[k]))) m.stats[k] = v;
    }
    if (!m.images || typeof m.images !== "object") m.images = { portrait: "" };
    if (!m.vitals || typeof m.vitals !== "object") m.vitals = {};
    if (!m.progression || typeof m.progression !== "object") m.progression = {};
    if (!Array.isArray(m.statusEffects)) m.statusEffects = [];
    if (!Array.isArray(m.trackers)) m.trackers = [];
    if (!m.partyRole) m.partyRole = "DPS";
    if (typeof m.active !== "boolean") m.active = true;
    if (typeof m.temporary !== "boolean") m.temporary = false;
    if (typeof m.followsUser !== "boolean") m.followsUser = true;

    const vitalsDefaults = { hp: 100, maxHp: 100, mp: 50, maxMp: 50, ap: 10, maxAp: 10 };
    for (const [k, v] of Object.entries(vitalsDefaults)) {
        if (!Number.isFinite(Number(m.vitals[k]))) m.vitals[k] = v;
    }

    m.vitals.maxHp = Math.max(1, Number(m.vitals.maxHp));
    m.vitals.maxMp = Math.max(1, Number(m.vitals.maxMp));
    m.vitals.maxAp = Math.max(1, Number(m.vitals.maxAp));
    m.vitals.hp = clamp(Number(m.vitals.hp), 0, Number(m.vitals.maxHp));
    m.vitals.mp = clamp(Number(m.vitals.mp), 0, Number(m.vitals.maxMp));
    m.vitals.ap = clamp(Number(m.vitals.ap), 0, Number(m.vitals.maxAp));

    if (!Number.isFinite(Number(m.progression.level))) m.progression.level = 1;
    if (!Number.isFinite(Number(m.progression.xp))) m.progression.xp = 0;
    m.progression.level = Math.max(1, Math.round(Number(m.progression.level)));
    m.progression.xp = Math.max(0, Number(m.progression.xp));

    m.statusEffects = m.statusEffects
        .map((x) => String(x || "").trim().slice(0, 50))
        .filter(Boolean)
        .slice(0, 24);
    m.trackers = m.trackers.map((t) => normalizePartyTracker(t)).filter(Boolean).slice(0, 24);
    if (!Array.isArray(m.personalItems)) m.personalItems = [];
}

function roleToFormationLane(role) {
    const r = String(role || "").toLowerCase();
    if (/(tank|bruiser|guardian|vanguard|front)/.test(r)) return "front";
    if (/(healer|mage|caster|ranger|support|sniper|back)/.test(r)) return "back";
    return "mid";
}

function removeMemberFromFormationLanes(s, memberId) {
    ensureParty(s);
    const id = String(memberId || "");
    if (!id) return false;
    let changed = false;
    for (const lane of ["front", "mid", "back"]) {
        const before = s.party.formation.lanes[lane].length;
        s.party.formation.lanes[lane] = s.party.formation.lanes[lane].filter((v) => String(v || "") !== id);
        if (s.party.formation.lanes[lane].length !== before) changed = true;
    }
    return changed;
}

function assignMemberToFormationLane(s, member, laneRaw) {
    if (!member) return false;
    ensureParty(s);
    const id = String(member.id || "");
    if (!id) return false;

    let lane = String(laneRaw || "").trim().toLowerCase();
    if (!lane || lane === "auto") lane = roleToFormationLane(member.partyRole);
    if (!["front", "mid", "back", "reserve"].includes(lane)) lane = roleToFormationLane(member.partyRole);

    let changed = removeMemberFromFormationLanes(s, id);
    if (lane !== "reserve") {
        if (!s.party.formation.lanes[lane].includes(id)) {
            s.party.formation.lanes[lane].push(id);
            changed = true;
        }
    }
    return changed;
}

function isUserPartyMember(s, m, nameHint = "") {
    const memberName = normKey(nameHint || m?.identity?.name || m?.name || "");
    const coreName = normKey(s?.character?.name || "");
    if (Array.isArray(m?.roles) && m.roles.includes("User")) return true;
    return !!(memberName && coreName && memberName === coreName);
}

function applyPartyMemberUpdate(m, upd = {}) {
    if (!m || !upd || typeof upd !== "object") return false;
    ensurePartyMemberState(m);

    const before = JSON.stringify({
        cls: m?.identity?.class,
        role: m?.partyRole,
        active: m?.active,
        temporary: m?.temporary,
        followsUser: m?.followsUser,
        vitals: m?.vitals,
        progression: m?.progression,
        statusEffects: m?.statusEffects,
        trackers: m?.trackers,
    });

    const cls = String(upd?.class || "").trim();
    if (cls) m.identity.class = cls.slice(0, 40);

    const role = String(upd?.role || "").trim();
    if (role) m.partyRole = role.slice(0, 40);

    if (typeof upd?.active === "boolean") m.active = upd.active;
    if (typeof upd?.temporary === "boolean" || typeof upd?.temp === "boolean") m.temporary = upd?.temporary === true || upd?.temp === true;
    if (typeof upd?.followsUser === "boolean" || typeof upd?.followUser === "boolean" || typeof upd?.movesWithUser === "boolean") {
        m.followsUser = upd?.followsUser === true || upd?.followUser === true || upd?.movesWithUser === true;
    }

    const applyMeter = (currentKey, maxKey, raw) => {
        const setVal = firstFiniteNumber(raw?.set, raw?.value);
        const deltaVal = firstFiniteNumber(raw?.delta);
        const maxVal = firstFiniteNumber(raw?.max);

        if (maxVal !== null) m.vitals[maxKey] = Math.max(1, Number(maxVal));
        const max = Math.max(1, Number(m.vitals[maxKey] || 1));

        if (setVal !== null) {
            m.vitals[currentKey] = clamp(Number(setVal), 0, max);
            return;
        }
        if (deltaVal !== null && deltaVal !== 0) {
            m.vitals[currentKey] = clamp(Number(m.vitals[currentKey] || 0) + Number(deltaVal), 0, max);
        }
    };

    applyMeter("hp", "maxHp", {
        set: firstFiniteNumber(upd?.setHp, upd?.hpSet, upd?.hp?.set, upd?.hp),
        delta: firstFiniteNumber(upd?.deltaHp, upd?.hpDelta, upd?.hp?.delta),
        max: firstFiniteNumber(upd?.maxHp, upd?.hpMax, upd?.hp?.max),
    });

    applyMeter("mp", "maxMp", {
        set: firstFiniteNumber(upd?.setMp, upd?.mpSet, upd?.mp?.set, upd?.mp),
        delta: firstFiniteNumber(upd?.deltaMp, upd?.mpDelta, upd?.mp?.delta),
        max: firstFiniteNumber(upd?.maxMp, upd?.mpMax, upd?.mp?.max),
    });

    applyMeter("ap", "maxAp", {
        set: firstFiniteNumber(upd?.setAp, upd?.apSet, upd?.ap?.set, upd?.ap),
        delta: firstFiniteNumber(upd?.deltaAp, upd?.apDelta, upd?.ap?.delta),
        max: firstFiniteNumber(upd?.maxAp, upd?.apMax, upd?.ap?.max),
    });

    const levelVal = firstFiniteNumber(upd?.level, upd?.setLevel, upd?.xp?.level);
    if (levelVal !== null) m.progression.level = Math.max(1, Math.round(Number(levelVal)));

    const xpSet = firstFiniteNumber(upd?.setXp, upd?.xpSet, upd?.xp?.set, upd?.xp);
    const xpDelta = firstFiniteNumber(upd?.deltaXp, upd?.xpDelta, upd?.xp?.delta);
    if (xpSet !== null) {
        m.progression.xp = Math.max(0, Number(xpSet));
    } else if (xpDelta !== null && xpDelta !== 0) {
        m.progression.xp = Math.max(0, Number(m.progression.xp || 0) + Number(xpDelta));
    }

    const statusObj = upd?.statusEffects && typeof upd.statusEffects === "object" ? upd.statusEffects : null;
    const statusAdd = statusObj && Array.isArray(statusObj.add) ? statusObj.add : [];
    const statusRem = statusObj && Array.isArray(statusObj.remove) ? statusObj.remove : [];
    if (statusAdd.length || statusRem.length) {
        const map = new Map((Array.isArray(m.statusEffects) ? m.statusEffects : [])
            .map((x) => {
                const label = String(x || "").trim().slice(0, 50);
                return [normKey(label), label];
            })
            .filter(([k, v]) => k && v));
        for (const r of statusRem) {
            const key = normKey(r);
            if (key) map.delete(key);
        }
        for (const a of statusAdd) {
            const label = String(a || "").trim().slice(0, 50);
            const key = normKey(label);
            if (!key || map.has(key)) continue;
            map.set(key, label);
        }
        m.statusEffects = Array.from(map.values()).slice(0, 24);
    }

    if (!Array.isArray(m.trackers)) m.trackers = [];
    if (Array.isArray(upd?.newTrackers)) {
        for (const raw of upd.newTrackers.slice(0, 24)) {
            const t = normalizePartyTracker(raw);
            const hasId = m.trackers.some((x) => String(x?.id || "") === t.id);
            const hasName = m.trackers.some((x) => normKey(x?.name) === normKey(t.name));
            if (hasId || hasName) continue;
            if (m.trackers.length >= 24) break;
            m.trackers.push(t);
        }
    }

    if (Array.isArray(upd?.trackerUpdates)) {
        for (const raw of upd.trackerUpdates.slice(0, 32)) {
            const id = String(raw?.id || "").trim();
            const nameKey = normKey(raw?.name);
            let tracker = null;
            if (id) tracker = m.trackers.find((x) => String(x?.id || "") === id) || null;
            if (!tracker && nameKey) tracker = m.trackers.find((x) => normKey(x?.name) === nameKey) || null;
            if (!tracker) {
                if (m.trackers.length >= 24) continue;
                tracker = normalizePartyTracker({
                    id: id || nextPartyTrackerId(),
                    name: String(raw?.name || id || "Tracker"),
                    current: 0,
                    max: firstFiniteNumber(raw?.max) ?? 100,
                    color: raw?.color,
                    notes: raw?.notes,
                });
                m.trackers.push(tracker);
            }

            const maxVal = firstFiniteNumber(raw?.max);
            if (maxVal !== null) tracker.max = Math.max(1, Number(maxVal));
            const setVal = firstFiniteNumber(raw?.set);
            const deltaVal = firstFiniteNumber(raw?.delta);
            if (setVal !== null) tracker.current = Number(setVal);
            else if (deltaVal !== null && deltaVal !== 0) tracker.current = Number(tracker.current || 0) + Number(deltaVal);
            tracker.current = clamp(Number(tracker.current || 0), 0, Math.max(1, Number(tracker.max || 100)));

            if (raw?.color !== undefined) tracker.color = normalizePartyTrackerColor(raw.color);
            if (raw?.notes !== undefined) tracker.notes = String(raw.notes || "").slice(0, 800);
            if (raw?.name !== undefined) {
                const nm = String(raw.name || "").trim().slice(0, 60);
                if (nm) tracker.name = nm;
            }
        }
    }

    ensurePartyMemberState(m);
    const after = JSON.stringify({
        cls: m?.identity?.class,
        role: m?.partyRole,
        active: m?.active,
        temporary: m?.temporary,
        followsUser: m?.followsUser,
        vitals: m?.vitals,
        progression: m?.progression,
        statusEffects: m?.statusEffects,
        trackers: m?.trackers,
    });
    return before !== after;
}

function syncUserMemberToCoreVitals(s, m) {
    if (!s || !m) return false;
    ensurePartyMemberState(m);
    if (!s.character || typeof s.character !== "object") s.character = {};

    const before = JSON.stringify({
        hp: s.hp,
        maxHp: s.maxHp,
        mp: s.mp,
        maxMp: s.maxMp,
        ap: s.ap,
        maxAp: s.maxAp,
        xp: s.xp,
        level: s?.character?.level,
        statusEffects: s?.character?.statusEffects,
    });

    s.hp = Number(m.vitals?.hp || 0);
    s.maxHp = Math.max(1, Number(m.vitals?.maxHp || 1));
    s.mp = Number(m.vitals?.mp || 0);
    s.maxMp = Math.max(1, Number(m.vitals?.maxMp || 1));
    s.ap = Number(m.vitals?.ap || 0);
    s.maxAp = Math.max(1, Number(m.vitals?.maxAp || 1));
    s.xp = Math.max(0, Number(m.progression?.xp || 0));
    s.character.level = Math.max(1, Number(m.progression?.level || 1));
    s.character.statusEffects = Array.isArray(m.statusEffects) ? m.statusEffects.slice(0, 40) : [];

    const after = JSON.stringify({
        hp: s.hp,
        maxHp: s.maxHp,
        mp: s.mp,
        maxMp: s.maxMp,
        ap: s.ap,
        maxAp: s.maxAp,
        xp: s.xp,
        level: s?.character?.level,
        statusEffects: s?.character?.statusEffects,
    });
    return before !== after;
}

function ensureEquipArrays(s) {
    if (!s.inventory) s.inventory = {};
    if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
    if (!Array.isArray(s.inventory.equipped)) s.inventory.equipped = [];
}

function roleToTab(role) {
    const r = String(role || "").toLowerCase();
    if (r.includes("romance") || r.includes("lover") || r.includes("dating")) return "romance";
    if (r.includes("family") || r.includes("sister") || r.includes("brother") || r.includes("mother") || r.includes("father")) return "family";
    if (r.includes("rival") || r.includes("enemy") || r.includes("hostile")) return "rivals";
    if (r.includes("associate") || r.includes("acquaintance") || r.includes("contact") || r.includes("npc") || r.includes("merchant") || r.includes("stranger")) return "associates";
    return "friends";
}

function normalizeSocialNameKey(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function toBool(v) {
    if (typeof v === "boolean") return v;
    const s = String(v || "").toLowerCase().trim();
    return s === "true" || s === "yes" || s === "1";
}

function shouldExcludeSocialName(name, { deletedSet, userNames } = {}) {
    const raw = String(name || "").trim();
    if (!raw) return true;
    if (raw.length > 64) return true;
    const key = normalizeSocialNameKey(raw)
        .replace(/^[\[{(<\s"']+|[\]})>\s"']+$/g, "")
        .trim();
    if (!key) return true;

    if (deletedSet && deletedSet.has(key)) return true;

    const exact = new Set([
        "you",
        "user",
        "system",
        "narrator",
        "game",
        "game master",
        "gm",
        "assistant",
        "omniscient",
        "omniscent",
        "meta",
        "metadata",
        "tool",
        "tool card",
        "npc tool",
        "npc controller",
        "story",
        "storyteller",
        "lorebook",
        "author note",
        "author's note",
        "ooc",
    ]);
    if (exact.has(key)) return true;
    if (/^(meta|metadata|ooc|system|narrator|story|tool|gm|game master)\b/.test(key)) return true;
    if (/\b(omniscient|omniscent|tool\s*card|npc\s*tool|metadata\s*card|lorebook|author'?s?\s*note|control\s*card|system\s*prompt|stage\s*direction)\b/.test(key)) return true;

    if (/^(mr|mrs|ms|dr|prof)\.?$/.test(key)) return true;
    const roleSingles = new Set([
        "captain", "commander", "general", "admiral", "colonel", "major", "lieutenant", "sergeant", "officer",
        "chief", "director", "agent", "master", "mistress", "professor", "doctor", "doc", "teacher",
        "king", "queen", "prince", "princess", "duke", "duchess", "lord", "lady", "sir", "madam",
        "merchant", "shopkeeper", "bartender", "innkeeper", "guard", "soldier", "knight", "nurse", "pilot",
        "driver", "clerk", "receptionist", "villager", "stranger", "boss",
    ]);
    if (roleSingles.has(key)) return true;
    if (/^(?:the\s+)?(?:captain|commander|general|admiral|colonel|major|lieutenant|sergeant|officer|chief|director|agent|merchant|shopkeeper|bartender|innkeeper|guard|soldier|knight|villager|stranger)(?:\s*#?\d+|\s+[ivx]+)?$/.test(key)) return true;

    if (Array.isArray(userNames)) {
        const set = new Set(userNames
            .map(x => normalizeSocialNameKey(x).replace(/^[\[{(<\s"']+|[\]})>\s"']+$/g, "").trim())
            .filter(Boolean));
        if (set.has(key)) return true;
    }
    return false;
}

function stripCssBlocks(text) {
    const src = String(text || "").replace(/\r/g, "");
    const lines = src.split("\n");
    const out = [];
    let depth = 0;
    for (const line of lines) {
        const t = String(line || "");
        const s = t.trim();
        if (!s) {
            if (depth === 0) out.push("");
            continue;
        }
        const opens = (s.match(/\{/g) || []).length;
        const closes = (s.match(/\}/g) || []).length;
        if (depth > 0) {
            depth = Math.max(0, depth + opens - closes);
            continue;
        }
        const looksCssStart =
            /^(\.|\#|:root\b|@keyframes\b|@media\b|@font-face\b)/i.test(s) ||
            (s.includes("--") && s.includes(":")) ||
            (s.includes("{") && s.includes(":") && !/\bhttps?:\/\//i.test(s));
        if (looksCssStart) {
            depth = Math.max(1, opens - closes);
            continue;
        }
        out.push(t);
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * UNIFIED SCANNER: Scans World State, Loot, and Status in ONE call.
 */
export async function scanEverything(opts = {}) {
    const s = getSettings();
    const force = !!opts?.force;
    const scanScope = String(opts?.scope || "all").trim().toLowerCase();
    if (s.enabled === false && !force) return;
    if (!force && s.generation?.scanAllEnabled === false) return;
    ensureState(s);
    ensureEconomyState(s);
    ensureLifeAiConfig(s);
    const countSocialPeople = (st) => {
        try {
            const social = st?.social && typeof st.social === "object" ? st.social : {};
            return ["friends", "associates", "romance", "family", "rivals"]
                .reduce((n, k) => n + (Array.isArray(social[k]) ? social[k].length : 0), 0);
        } catch (_) {
            return 0;
        }
    };
    const countPhoneMsgs = (st) => {
        try {
            const threads = st?.phone?.smsThreads && typeof st.phone.smsThreads === "object" ? st.phone.smsThreads : {};
            return Object.values(threads).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
        } catch (_) {
            return 0;
        }
    };
    const beforeCounts = {
        items: Array.isArray(s?.inventory?.items) ? s.inventory.items.length : 0,
        skills: Array.isArray(s?.inventory?.skills) ? s.inventory.skills.length : 0,
        assets: Array.isArray(s?.inventory?.assets) ? s.inventory.assets.length : 0,
        life: Array.isArray(s?.life?.trackers) ? s.life.trackers.length : 0,
        quests: (() => { const j = s?.journal; if (!j) return 0; return (Array.isArray(j.pending) ? j.pending.length : 0) + (Array.isArray(j.active) ? j.active.length : 0) + (Array.isArray(j.completed) ? j.completed.length : 0) + (Array.isArray(j.abandoned) ? j.abandoned.length : 0); })(),
        lore: Array.isArray(s?.databank) ? s.databank.length : 0,
        party: Array.isArray(s?.party?.members) ? s.party.members.length : 0,
        social: countSocialPeople(s),
        phoneMsgs: countPhoneMsgs(s)
    };

    const sourceMesId = (() => {
        const n = Number(opts?.sourceMesId);
        return Number.isFinite(n) && n >= 0 ? n : null;
    })();
    const shouldTrackUndo = sourceMesId !== null;
    let beforeSnap = null;
    let undoFp = "";

    const undo = ensureUndoStore();
    try {
        const sig = readChatSig();
        undo.lastChatLen = Number(sig?.count || 0) || 0;
        undo.lastChatTailFp = readChatTailFingerprint();
    } catch (_) {}

    const gate = (() => {
        try {
            const g = (window.UIE_scanEverythingGate = window.UIE_scanEverythingGate || { inFlight: false, lastAt: 0 });
            const now = Date.now();
            const min = Math.max(1000, Number(s?.generation?.autoScanMinIntervalMs || 8000));
            if (g.inFlight) return { ok: false };
            if (!force && now - Number(g.lastAt || 0) < min) return { ok: false };
            g.inFlight = true;
            g.lastAt = now;
            return { ok: true };
        } catch (_) {
            return { ok: true };
        }
    })();
    if (!gate.ok) return;
    try {

    const scanSig = readChatScanSignature();
    if (!force && scanSig) {
        try {
            const d = (window.UIE_scanEverythingDedupe = window.UIE_scanEverythingDedupe || { sig: "", mesId: null, at: 0 });
            const sameSig = d.sig === scanSig;
            const sameMes =
                (sourceMesId === null && d.mesId === null) ||
                (sourceMesId !== null && d.mesId !== null && Number(d.mesId) === Number(sourceMesId));
            const age = Date.now() - Number(d.at || 0);
            if (sameSig && sameMes && age < 12000) {
                return { ok: true, changed: false, skipped: "unchanged_chat" };
            }
        } catch (_) {}
    }

    const worldSeeded = (() => {
        try {
            return Object.values(s?.worldState || {}).some((v) => {
                if (v === null || v === undefined) return false;
                if (typeof v === "string") return !!v.trim();
                if (Array.isArray(v)) return v.length > 0;
                if (typeof v === "object") return Object.keys(v).length > 0;
                return true;
            });
        } catch (_) {
            return false;
        }
    })();
    const characterSeeded = (() => {
        try {
            return Object.values(s?.character || {}).some((v) => {
                if (v === null || v === undefined) return false;
                if (typeof v === "string") return !!v.trim();
                if (Array.isArray(v)) return v.length > 0;
                if (typeof v === "object") return Object.keys(v).length > 0;
                return Number(v) !== 0;
            });
        } catch (_) {
            return false;
        }
    })();
    const seededCount = Object.values(beforeCounts).reduce((n, v) => n + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
    const bootstrapScan = opts?.deepContext === true || opts?.scanAll === true || (!worldSeeded && !characterSeeded && seededCount <= 1);
    const requestedScanMsgCount = Math.max(0, Number(opts?.maxMessages || 0));
    const configuredScanMsgCount = Math.max(50, Number(s?.generation?.scanContextMessages || 80));
    const scanMsgCount = requestedScanMsgCount > 0 ?
         requestedScanMsgCount
        : Math.max(configuredScanMsgCount, force ? 120 : 0, bootstrapScan ? 220 : 0);
    const requestedScanCharCount = Math.max(0, Number(opts?.maxChars || 0));
    const scanCharCount = requestedScanCharCount > 0 ?
         requestedScanCharCount
        : Math.max(18000, force ? 26000 : 0, bootstrapScan ? 36000 : 0);
    const chatSnippet = await getChatTranscriptText({ maxMessages: scanMsgCount, maxChars: scanCharCount });

    if (!chatSnippet) return;

    if (shouldTrackUndo) {
        undoFp = (() => {
            try {
                const fp = String(readChatTailFingerprint() || "").trim();
                if (fp) return fp;
                return `mes:${sourceMesId}`;
            } catch (_) {
                return `mes:${sourceMesId}`;
            }
        })();

        const key = String(sourceMesId);
        const prev = undo.byMesId[key];
        // If this message is being re-generated/swiped, revert its previous scan effects first.
        if (prev && Array.isArray(prev.ops) && prev.ops.length) {
            const changed = applyUndoOps(s, prev.ops);
            if (changed) commitStateUpdate({ save: true, layout: false, emit: true, undo: true, mesId: sourceMesId });
        }
        // Capture baseline AFTER reverting previous ops so this message stores only fresh effects.
        beforeSnap = snapshotScanTouchedState(s);
        undo.byMesId[key] = { at: Date.now() };
    }

    // --- PHASE 1: FREE REGEX CHECKS (Currency) ---
    const scanInventoryScope = (scanScope === "all" || scanScope === "inventory");
    if (scanInventoryScope) {
        // We check the LAST message for instant currency updates (avoids AI cost/latency for simple gold)
        const lastMsg = await getRecentChatSnippet(1);
        const currencyGain = lastMsg.match(/(?:found|received|gained|picked up|looted|loot|earned|rewarded|added)\s+(\d+)\s*(?:gp|gold|credits|coins|silver)/i);
        const currencyLoss = lastMsg.match(/(?:lost|paid|spent|gave|removed|pay|subtracted)\s+(\d+)\s*(?:gp|gold|credits|coins|silver)/i);

        let currencyChanged = false;
        if (currencyGain) {
            const amt = parseInt(currencyGain[1]);
            addCurrency(s, amt);
            notify("success", `+ ${amt} ${s.currencySymbol || "G"}`, "Currency", "currency");
            currencyChanged = true;
        }
        if (currencyLoss) {
            const amt = parseInt(currencyLoss[1]);
            spendCurrency(s, amt);
            notify("warning", `- ${amt} ${s.currencySymbol || "G"}`, "Currency", "currency");
            currencyChanged = true;
        }
        if (currencyChanged) {
            if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
            if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
            s.inventory.currency = s.currency;
            const sym = String(s.currencySymbol || "G");
            let curItem = s.inventory.items.find(it => String(it?.type || "").toLowerCase() === "currency" && String(it?.symbol || "") === sym);
            if (!curItem) curItem = s.inventory.items.find(it => String(it?.type || "").toLowerCase() === "currency");
            if (curItem) {
                curItem.qty = s.currency;
                curItem.symbol = sym;
                if (!String(curItem.name || "").trim() || String(curItem.name || "").includes("Currency")) curItem.name = `${sym} Currency`;
            }
            else if (currencyGain) { // Auto-create if gained
                 addInventoryItemWithStack(s.inventory.items, {
                    kind: "item",
                    name: `${sym} Currency`,
                    type: "currency",
                    symbol: sym,
                    description: `Currency item for ${sym}.`,
                    rarity: "common",
                    qty: s.currency,
                    mods: {},
                    statusEffects: []
                 }, { source: "scan_currency" });
            }
            commitStateUpdate({ save: true, layout: false, emit: true });
        }
    }
    // --- PHASE 2: AI SCAN (Everything Else) ---
    // Only proceed if system checks are allowed, UNLESS forced by user
    if (!force && (s.enabled === false || s.generation?.allowSystemChecks !== true)) return;

    const ctx = getContext ? getContext() : {};
    const userName = String(ctx.name1 || "User").trim();
    const charName = String(ctx.name2 || "Character").trim();

    const invNames = (() => {
        try {
            const items = Array.isArray(s?.inventory?.items) ? s.inventory.items : [];
            return Array.from(new Set(items.map(x => String(x?.name || "").trim()).filter(Boolean))).slice(0, 160);
        } catch (_) {
            return [];
        }
    })();
    const skillNames = (() => {
        try {
            const skills = Array.isArray(s?.inventory?.skills) ? s.inventory.skills : [];
            return Array.from(new Set(skills.map(x => String(x?.name || "").trim()).filter(Boolean))).slice(0, 160);
        } catch (_) {
            return [];
        }
    })();
    const lifeTemplateBlock = (() => {
        try {
            const lifeEnabled = s?.life?.ai?.enabled !== false;
            if (!lifeEnabled) return "";
            const tpl = String(s?.life?.ai?.template || "").trim();
            if (!tpl) return "";
            return `\nLife Tracking Template (STRICT):\n${tpl.slice(0, 2400)}\n`;
        } catch (_) {
            return "";
        }
    })();
    const rProfile = String(s.character?.resourceProfile || "both").toLowerCase();
    const clsName = String(s.character?.class || s.character_master?.className || "Unknown");
    
    const prompt = `[UIE_LOCKED]
Analyze the chat history to update the RPG State.
Current Character Class: ${clsName}
Active Resource Profile: ${rProfile.toUpperCase()} (STRICT SYSTEM RULE: Only mutate active energy bars. If profile is AP, only update ap. If profile is MP, only update mp. If profile is BOTH, update both as grounded in context.)
Current World: ${JSON.stringify(s.worldState)}
Current HP: ${Number(s.hp ?? 100)} / ${Number(s.maxHp ?? 100)}
Current MP: ${Number(s.mp ?? 50)} / ${Number(s.maxMp ?? 50)}
Current AP: ${Number(s.ap ?? 10)} / ${Number(s.maxAp ?? 10)}
Current XP: ${Number(s.xp ?? 0)} / ${Number(s.maxXp ?? 1000)}
Life Trackers: ${JSON.stringify((s.life?.trackers || []).slice(0, 30).map(t => ({ name: t.name, current: t.current, max: t.max })))}
Current Status Effects: ${JSON.stringify((s.character?.statusEffects || []).slice(0, 30))}
Existing Inventory Items: ${JSON.stringify(invNames)}
Existing Skills: ${JSON.stringify(skillNames)}
Existing Social Names: ${JSON.stringify((() => { try { ensureSocial(s); const arr = ["friends","associates","romance","family","rivals"].flatMap(k => (s.social[k] || []).map(p => String(p?.name || "").trim()).filter(Boolean)); return Array.from(new Set(arr)).slice(0, 120); } catch (_) { return []; } })())}
Deleted Social Names: ${JSON.stringify((() => { try { ensureSocial(s); return (s.socialMeta.deletedNames || []).slice(-120); } catch (_) { return []; } })())}
Existing Party Members: ${JSON.stringify((() => { try { ensureParty(s); return (Array.isArray(s.party?.members) ? s.party.members : []).slice(0, 20).map((m) => ({ name: String(m?.identity?.name || ""), class: String(m?.identity?.class || ""), role: String(m?.partyRole || ""), active: m?.active !== false, hp: Number(m?.vitals?.hp ?? 0), maxHp: Number(m?.vitals?.maxHp ?? 100), mp: Number(m?.vitals?.mp ?? 0), maxMp: Number(m?.vitals?.maxMp ?? 50), ap: Number(m?.vitals?.ap ?? 0), maxAp: Number(m?.vitals?.maxAp ?? 10), level: Number(m?.progression?.level ?? 1), xp: Number(m?.progression?.xp ?? 0), trackers: Array.isArray(m?.trackers) ? m.trackers.slice(0, 10).map(t => ({ id: String(t?.id || ""), name: String(t?.name || ""), current: Number(t?.current ?? 0), max: Number(t?.max ?? 100) })) : [] })); } catch (_) { return []; } })())}
Current Party Formation: ${JSON.stringify((() => { try { ensureParty(s); return s.party?.formation?.lanes || { front: [], mid: [], back: [] }; } catch (_) { return { front: [], mid: [], back: [] }; } })())}

Task: Return a SINGLE JSON object with these keys:
1. "world": Update location, threat, status, time, weather.
1.5. "character": (optional) { "name":"", "className":"", "level":1 } for explicit user identity/progression updates.
2. "inventory": Lists of "added" only for items the user explicitly takes into possession/inventory and "removed" (items lost/used/given). Ignore currency.
3. "stats": Update bars using one of these forms:
   - Delta form: {"hp":-10,"mp":+5,"ap":-2,"xp":+20}
   - Set form: {"hp":{"set":70},"mp":{"set":30},"ap":{"set":8},"xp":{"set":240}}
   - Include max updates when explicit: {"maxHp":120,"maxMp":80,"maxAp":12,"maxXp":1200}
4. "skills": (optional) { "add":[{"name":"","desc":"","type":"active|passive","mods":{},"active":{},"passive":{},"evidence":""}] } for NEW skills learned/purchased/acquired by the user.
5. "assets": (optional) { "add":[{"name":"","desc":"","category":"property|vehicle|ship|business|other","owned":true,"evidence":""}] } for NEW owned assets.
6. "quests": List of quest-like objectives { "title": "...", "desc": "...", "type": "main|side" }. Add anything that could logically be a quest from context. Must be grounded in chat; no random additions.
7. "lore": List of new lore objects { "key": "Term", "entry": "Description" } if NEW important lore is revealed.
8. "messages": List of { "from": "Name", "text": "..." } if a character sends a text message/SMS in the chat.
9. "phoneNumbers": (optional) [{ "name":"", "number":"" }] if a phone number is shown/saved (e.g. 404-555-0192).
10. "life": (optional) { "lifeUpdates":[{"name":"","delta":0,"set":null,"max":null}], "newTrackers":[{"name":"","current":0,"max":100,"color":"#89b4fa","notes":""}] }
11. "statusEffects": (optional) { "add":[""], "remove":[""] } (NO EMOJIS)
12. "social": (optional) { "add":[{"name":"","role":"","affinity":50,"presence":"present|mentioned|known_past","met_physically":true,"known_from_past":false,"relationship":"","familyRole":""}], "remove":[""] } for in-story characters only.
13. "battle": (optional) {
  "active": true|false,
  "round": 0,
  "outcome": "ongoing|victory|defeat|escape|stalemate",
  "player": {"name":"","className":"","hp":null,"maxHp":null,"mp":null,"maxMp":null,"ap":null,"maxAp":null,"statusEffects":[""],"status":""},
  "enemies":[{"name":"","className":"","type":"","rank":"","hp":null,"maxHp":null,"mp":null,"maxMp":null,"ap":null,"maxAp":null,"level":0,"boss":false,"statusEffects":[""],"status":"","threat":"","attacks":[""],"loot":[""],"xp":null}],
  "turnOrder":[""],
  "log":["..."],
  "rewards": {"xp":null,"gold":null,"skillXp":null,"loot":[""],"note":""}
} when combat happens.
14. "party": (optional) {
  "joined": [{"name":"","class":"","role":"","lane":"front|mid|back|reserve|auto","temporary":false,"followsUser":true}],
  "left": ["Name"],
  "returned": ["Name of anyone who was away but has now returned to the party"],
  "updates": [{
    "name":"",
    "class":"",
    "role":"",
    "active": true,
    "temporary": false,
    "followsUser": true,
    "lane":"front|mid|back|reserve|auto",
    "hp": {"delta":0,"set":null,"max":null},
    "mp": {"delta":0,"set":null,"max":null},
    "ap": {"delta":0,"set":null,"max":null},
    "xp": {"delta":0,"set":null},
    "level": null,
    "statusEffects": {"add":[],"remove":[]},
    "trackerUpdates": [{"id":"","name":"","delta":0,"set":null,"max":null,"color":"#89b4fa","notes":""}],
    "newTrackers": [{"name":"","current":0,"max":100,"color":"#89b4fa","notes":""}]
  }],
  "formation": {"front":["Name"],"mid":["Name"],"back":["Name"]}
} for roster, per-member trackers/vitals, and formation changes.
15. "equipped": (optional) { "equip": [{"item":"","slot":""}], "unequip": ["slot" or "item"] } if user equips/unequips gear.

Rules:
- STRICT EVIDENCE MODE: add to inventory/skills/assets ONLY when chat explicitly states the user takes, stows, buys, accepts, equips, crafts, or puts the item into inventory. Items merely seen, found in the room, lying nearby, offered, displayed, available as loot, or present in the world are WORLD ITEMS, not inventory.
- "inventory.added": [{ "name": "Item Name", "type": "item|weapon|armor|book|container|bag|chest|crate", "qty": 1, "desc": "Description", "evidence":"short quote/paraphrase from chat proving acquisition" }]
- "removed": ["Item Name"]
- "equipped": Only if explicitly stated (e.g. "User equips the sword"). Slot examples: "head","chest","main","off".
- "skills.add": Only add if it is NEW (not in Existing Skills), has explicit acquisition evidence, and include "evidence".
- "assets.add": Only owned assets the user/party explicitly has. Categories must be one of: property, vehicle, ship, business, other.
- "social": Prefer people the user/party has actually met, seen, spoken to, traveled with, fought, or texted. If someone is only referenced, skip them unless the transcript clearly establishes a meaningful prior relationship; then use presence "known_past".
- "social.add": [{ "name": "Name", "role": "friend|associate|rival|romance|family", "affinity": 50, "presence":"present|mentioned|known_past", "met_physically": true, "known_from_past": false, "relationship":"", "familyRole":"" }]
- For actively present or directly interacting characters, use presence "present" and set met_physically to true.
- Do NOT add one-off mentions, rumors, crowd extras, role-only labels, or names seen only in metadata/tool cards.
- Relationship/thoughts fields must stay in-world and character-specific, not meta commentary.
- "party": Use joined/left only for explicit party roster changes. Use party.updates only for explicit member-state changes (vitals/xp/status/trackers/lane) grounded in chat.
- EXCLUDE from social: "${userName}", "System", "Narrator", "Game", "Omniscient", tool cards, NPC controller cards, and metadata/control card names.
- "world": Keep values short.
- If no change, omit the key or leave empty.
- Status effects should be short labels like "Tired", "Poisoned", "Smells like smoke". No emojis.
- For battle enemies, keep hp/maxHp as null when unknown instead of inventing numbers. Include maxHp/level only when grounded in chat.
- For battle player/enemy MP/AP, rewards, loot, rank, type, and outcome, only include values grounded in chat. Use null when unknown.

${lifeTemplateBlock}

Chat:
${chatSnippet}
`;

    const scanType = force ? "Unified State Scan (User)" : "Unified State Scan";
    const res = await generateContent(prompt, scanType);
    if (!res) {
        if (force) {
            try { notify("warning", "Scan blocked: enable 'Allow System Checks (AI)' in UIE Settings.", "Scan", "scanBlocked"); } catch (_) {}
        }
        return { ok: false, error: "no_response" };
    }

    try {
        const data = safeJsonParseObject(res);
        if (!data) {
            if (force) {
                try { notify("warning", "Scan response was not valid JSON. Try again.", "Scan", "scanBlocked"); } catch (_) {}
            }
            return { ok: false, error: "invalid_json" };
        }
        normalizeScanPayload(data);
        if (scanScope && scanScope !== "all") {
            const keepByScope = {
                inventory: new Set(["character", "inventory", "items", "stats", "bars", "vitals", "skills", "assets", "equipped", "life", "statusEffects"]),
                social: new Set(["social"]),
                battle: new Set(["battle"]),
                party: new Set(["party"]),
                phone: new Set(["messages", "phoneNumbers"]),
                databank: new Set(["lore"]),
                world: new Set(["world"]),
            };
            const keep = keepByScope[scanScope];
            if (keep) {
                for (const key of Object.keys(data)) {
                    if (!keep.has(String(key || ""))) delete data[key];
                }
            }
        }

        let needsSave = false;

        // 1. World State
        if (data.world) {
            s.worldState = { ...s.worldState, ...data.world };
            needsSave = true;
        }

        // 1.5 Character (name/class/level)
        if (data.character && typeof data.character === "object") {
            if (!s.character || typeof s.character !== "object") s.character = {};
            let touchedCharacter = false;

            const nextName = String(data.character?.name || "").trim().slice(0, 60);
            if (nextName && nextName !== String(s.character?.name || "").trim()) {
                s.character.name = nextName;
                touchedCharacter = true;
            }

            const nextClass = String(data.character?.className || data.character?.class || "").trim().slice(0, 60);
            if (nextClass && nextClass !== String(s.character?.className || "").trim()) {
                s.character.className = nextClass;
                touchedCharacter = true;
            }

            const levelRaw = Number(data.character?.level);
            if (Number.isFinite(levelRaw) && levelRaw > 0) {
                const nextLevel = Math.max(1, Math.floor(levelRaw));
                if (nextLevel !== Number(s.character?.level || 1)) {
                    s.character.level = nextLevel;
                    touchedCharacter = true;
                }
            }

            if (touchedCharacter) needsSave = true;
        }

        const sourceTag = force ? "scan" : "scan_all";
        const nowTs = Date.now();

        // 2. Inventory
        if (data.inventory) {
            if (Array.isArray(data.inventory.added)) {
                data.inventory.added.forEach(it => {
                    if (!it || !it.name) return;
                    const evidence = String(it?.evidence || it?.desc || "").trim();
                    const itemName = String(it?.name || "").trim();
                    if (!hasExplicitOwnershipEvidence(evidence, itemName, chatSnippet)) {
                        if (rememberWorldItem(s, it, { evidence })) needsSave = true;
                        return;
                    }
                    const qty = Math.max(1, Math.round(Number(it?.qty || 1)));
                    const baseItem = {
                        kind: "item",
                        name: itemName.slice(0, 120),
                        type: String(it?.type || "item").trim().slice(0, 80),
                        description: String(it?.desc || "Found item.").trim().slice(0, 1200),
                        qty,
                        rarity: "common",
                        mods: {},
                        statusEffects: [],
                        _meta: { source: sourceTag, createdAt: nowTs, updatedAt: nowTs, evidence: evidence.slice(0, 240) }
                    };

                    const isContainerLoot = isContainerItem(baseItem);
                    const payload = isContainerLoot ?
                         (() => {
                            const box = createOpenableContainerItem({
                                chatHint: `${chatSnippet}\n${evidence}`,
                                containerName: baseItem.name,
                                containerType: baseItem.type,
                                description: baseItem.description,
                                rarity: baseItem.rarity,
                                source: sourceTag,
                                now: nowTs,
                            });
                            box.qty = qty;
                            box._meta = {
                                ...(box._meta && typeof box._meta === "object" ? box._meta : {}),
                                source: sourceTag,
                                createdAt: Number(box?._meta?.createdAt || nowTs) || nowTs,
                                updatedAt: nowTs,
                                evidence: evidence.slice(0, 240),
                            };
                            return box;
                        })()
                        : baseItem;

                    const out = addInventoryItemWithStack(s.inventory.items, payload, {
                        source: sourceTag,
                        chatHint: `${chatSnippet}\n${evidence}`,
                    });
                    if (Number(out?.addedQty || 0) > 0 || Number(out?.stackedQty || 0) > 0) {
                        if (isContainerLoot) notify("success", `Found ${payload?.name || it?.name}`, "Inventory", "loot");
                        else notify("info", `Added ${qty}x ${baseItem.name}`, "Inventory", "loot");
                    }
                    needsSave = true;
                });
            }
            if (Array.isArray(data.inventory.removed)) {
                data.inventory.removed.forEach(name => {
                    const idx = s.inventory.items.findIndex(x => normKey(x?.name).includes(normKey(name)));
                    if (idx !== -1) {
                        const it = s.inventory.items[idx];
                        if (it.qty > 1) it.qty--;
                        else s.inventory.items.splice(idx, 1);
                        notify("warning", `Removed ${it.name}`, "Inventory", "loot");
                        needsSave = true;
                    }
                });
            }
        }

        // 3. Stats / Bars (HP/MP/AP/XP + max values)
        if (data.stats && typeof data.stats === "object") {
            const statDefs = [
                { key: "hp", maxKey: "maxHp", defaultMax: 100, minMax: 1, clampToMax: true },
                { key: "mp", maxKey: "maxMp", defaultMax: 50, minMax: 1, clampToMax: true },
                { key: "ap", maxKey: "maxAp", defaultMax: 10, minMax: 0, clampToMax: true },
                { key: "xp", maxKey: "maxXp", defaultMax: 1000, minMax: 1, clampToMax: false },
            ];
            let vitalsChanged = false;
            for (const def of statDefs) {
                const raw = data.stats?.[def.key];
                const rawObj = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : null;

                const delta = rawObj ? Number(rawObj.delta) : Number(raw);
                const setValue = rawObj ?
                     (Number.isFinite(Number(rawObj.set)) ? Number(rawObj.set) : Number(rawObj.current))
                    : Number.NaN;

                let maxValue = rawObj ? Number(rawObj.max) : Number.NaN;
                if (!Number.isFinite(maxValue)) {
                    maxValue = Number(data.stats?.[def.maxKey]);
                }

                if (Number.isFinite(maxValue)) {
                    const nextMax = Math.max(def.minMax, Math.round(maxValue));
                    const curMax = Number(s?.[def.maxKey]);
                    if (!Number.isFinite(curMax) || curMax !== nextMax) {
                        s[def.maxKey] = nextMax;
                        vitalsChanged = true;
                        needsSave = true;
                    }
                }

                const safeMax = Number.isFinite(Number(s?.[def.maxKey])) ? Number(s[def.maxKey]) : def.defaultMax;
                const curValue = Number(s?.[def.key] ?? (def.key === "xp" ? 0 : safeMax));
                let nextValue = curValue;

                if (Number.isFinite(setValue)) {
                    nextValue = setValue;
                } else if (Number.isFinite(delta) && delta !== 0) {
                    nextValue = curValue + delta;
                } else {
                    continue;
                }

                if (def.clampToMax) {
                    nextValue = clamp(nextValue, 0, Math.max(0, safeMax));
                } else {
                    nextValue = Math.max(0, nextValue);
                }

                if (nextValue !== curValue || !Number.isFinite(curValue)) {
                    if (def.key === "xp" && Number.isFinite(delta) && delta > 0 && !Number.isFinite(setValue)) {
                        const out = grantXp(s, delta, "chat scan");
                        nextValue = s.xp;
                        if (out.levels > 0) notify("success", `Level up! Lv ${s.character.level}`, "Level Up", "levelUp");
                    } else {
                        s[def.key] = nextValue;
                    }
                    vitalsChanged = true;
                    needsSave = true;
                }
            }

            if (vitalsChanged) {
                try { if (typeof $ !== "undefined") $(document).trigger("uie:updateVitals"); } catch (_) {}
                try { window.dispatchEvent(new CustomEvent("uie:updateVitals")); } catch (_) {}
                try { injectRpEvent(`[System: Vitals updated - HP ${s.hp}/${s.maxHp ?? 100}, MP ${s.mp}/${s.maxMp ?? 50}, AP ${s.ap}/${s.maxAp ?? 10}, XP ${s.xp}/${s.maxXp ?? 1000}.]`); } catch (_) {}
                if (Number(s.hp) <= 0) {
                    try { injectRpEvent(`[System: Character has died! HP fell to 0.]`); } catch (_) {}
                }
            }
        }

        // 3.2 Skills
        if (data.skills && typeof data.skills === "object") {
            const skillAdd = Array.isArray(data.skills.add) ? data.skills.add : [];
            if (!Array.isArray(s.inventory.skills)) s.inventory.skills = [];
            const have = new Set(s.inventory.skills.map(x => normKey(x?.name)).filter(Boolean));
            let added = 0;
            for (const sk of skillAdd.slice(0, 40)) {
                const nm = String(sk?.name || "").trim();
                if (!nm) continue;
                const evidence = String(sk?.evidence || sk?.desc || "").trim();
                if (!hasExplicitOwnershipEvidence(evidence, nm, chatSnippet)) continue;
                const key = normKey(nm);
                if (have.has(key)) continue;
                const type = normalizeSkillType(sk?.skillType || sk?.type);
                s.inventory.skills.push({
                    kind: "skill",
                    name: nm,
                    description: String(sk?.desc || "").trim().slice(0, 1200),
                    type,
                    skillType: type,
                    mods: sanitizeMods(sk?.mods),
                    active: (sk?.active && typeof sk.active === "object") ? sk.active : null,
                    passive: (sk?.passive && typeof sk.passive === "object") ? sk.passive : null,
                    _meta: { source: sourceTag, createdAt: nowTs, updatedAt: nowTs, evidence: evidence.slice(0, 240) }
                });
                have.add(key);
                added++;
            }
            if (added) {
                notify("success", `Learned ${added} skill(s).`, "Skills", "loot");
                needsSave = true;
            }
        }

        // 3.3 Assets
        if (data.assets && (typeof data.assets === "object" || Array.isArray(data.assets))) {
            const add = Array.isArray(data.assets) ? data.assets : (Array.isArray(data.assets.add) ? data.assets.add : []);
            if (!Array.isArray(s.inventory.assets)) s.inventory.assets = [];
            const have = new Set(s.inventory.assets.map(x => normKey(x?.name)).filter(Boolean));
            let added = 0;
            for (const a of add.slice(0, 40)) {
                const nm = String(a?.name || "").trim();
                if (!nm) continue;
                const evidence = String(a?.evidence || a?.desc || "").trim();
                if (!hasExplicitOwnershipEvidence(evidence, nm, chatSnippet)) continue;
                const key = normKey(nm);
                if (have.has(key)) continue;
                s.inventory.assets.push(ensureTravelAssetFields({
                    kind: "asset",
                    name: nm,
                    description: String(a?.desc || "").trim().slice(0, 1200),
                    category: normalizeAssetCategory(a?.category || a?.type || a?.kind || ""),
                    owned: a?.owned !== false,
                    _meta: { source: sourceTag, createdAt: nowTs, updatedAt: nowTs, evidence: evidence.slice(0, 240) }
                }, { forceUnplaced: true }));
                have.add(key);
                added++;
            }
            if (added) {
                notify("info", `Added ${added} asset(s).`, "Assets", "loot");
                needsSave = true;
            }
        }

        // 3.5 Life Trackers
        if (data.life && typeof data.life === "object") {
            const lifeUpdates = Array.isArray(data.life.lifeUpdates) ? data.life.lifeUpdates : [];
            const newTrackers = Array.isArray(data.life.newTrackers) ? data.life.newTrackers : [];
            let changed = false;

            for (const nt of newTrackers) {
                const nm = String(nt?.name || "").trim();
                if (!nm) continue;
                if (findLifeTracker(s, nm)) continue;
                const mx = Math.max(1, Number.isFinite(Number(nt?.max)) ? Number(nt.max) : 100);
                const cur = clamp(Number.isFinite(Number(nt?.current)) ? Number(nt.current) : 0, 0, mx);
                const color = String(nt?.color || "#89b4fa");
                const notes = String(nt?.notes || "");
                s.life.trackers.push({ name: nm.slice(0, 60), current: cur, max: mx, color: color.slice(0, 30), notes: notes.slice(0, 240), updatedAt: Date.now() });
                changed = true;
            }

            for (const u of lifeUpdates) {
                const nm = String(u?.name || "").trim();
                if (!nm) continue;
                let t = findLifeTracker(s, nm);
                if (!t) {
                    t = { name: nm.slice(0, 60), current: 0, max: 100, color: "#89b4fa", notes: "" };
                    s.life.trackers.push(t);
                }
                if (u?.max !== null && u?.max !== undefined && Number.isFinite(Number(u.max))) t.max = Number(u.max);
                if (u?.set !== null && u?.set !== undefined && Number.isFinite(Number(u.set))) t.current = Number(u.set);
                else if (Number.isFinite(Number(u?.delta))) t.current = Number(t.current ?? 0) + Number(u.delta);
                t.current = clamp(t.current, 0, Math.max(1, Number(t.max ?? 100)));
                t.updatedAt = Date.now();
                changed = true;
            }
            if (changed) {
                needsSave = true;
                try { if (typeof $ !== "undefined") $(document).trigger("uie:updateVitals"); } catch (_) {}
                try { window.dispatchEvent(new CustomEvent("uie:updateVitals")); } catch (_) {}
            }
        }

        // 3.6 Status Effects
        if (data.statusEffects && typeof data.statusEffects === "object") {
            const add = Array.isArray(data.statusEffects.add) ? data.statusEffects.add : [];
            const rem = Array.isArray(data.statusEffects.remove) ? data.statusEffects.remove : [];
            const now = Date.now();
            const cur = normalizeStatusList(s.character.statusEffects, now);
            const map = new Map(cur.map(x => [statusKey(x), x]).filter(([k, v]) => k && v));
            let changed = false;
            for (const r of rem) {
                const k = statusKey(r);
                if (k && map.has(k)) { 
                    map.delete(k); 
                    changed = true; 
                    try { injectRpEvent(`[System: Removed status effect: ${k}.]`); } catch (_) {}
                }
            }
            for (const a of add) {
                const fx = normalizeStatusEffect(a, now);
                if (!fx) continue;
                const k = statusKey(fx);
                if (!k || map.has(k)) continue;
                map.set(k, fx);
                changed = true;
                try { injectRpEvent(`[System: Gained status effect: ${fx.name || k}.]`); } catch (_) {}
            }
            if (changed) {
                s.character.statusEffects = Array.from(map.values()).slice(0, 40);
                needsSave = true;
                try { if (typeof $ !== "undefined") $(document).trigger("uie:updateVitals"); } catch (_) {}
                try { window.dispatchEvent(new CustomEvent("uie:updateVitals")); } catch (_) {}
            }
        }

        // 4. Quests (unified with journal: all scan quests go to journal.pending)
        if (Array.isArray(data.quests)) {
            ensureJournal(s);
            const titleKey = (t) => String(t || "").trim().toLowerCase().slice(0, 80);
            const allTitles = new Set([
                ...(s.journal.pending || []).map(x => titleKey(x?.title)),
                ...(s.journal.active || []).map(x => titleKey(x?.title)),
                ...(s.journal.completed || []).map(x => titleKey(x?.title)),
                ...(s.journal.abandoned || []).map(x => titleKey(x?.title))
            ].filter(Boolean));

            data.quests.forEach(q => {
                const title = String(q?.title || q?.name || "").trim().slice(0, 80);
                if (!title) return;
                const key = titleKey(title);
                if (allTitles.has(key)) return;
                const desc = String(q?.desc || q?.description || q?.details || "").trim().slice(0, 600);
                s.journal.pending.push({
                    title,
                    desc: desc || "...",
                    source: "scan",
                    ts: Date.now()
                });
                allTitles.add(key);
                notify("info", `New Quest: ${title}`, "Journal", "quest");
                needsSave = true;
            });
        }

        // 5. Lore (Databank)
        if (Array.isArray(data.lore)) {
            if (!s.databank) s.databank = [];
            const opts = { now: Date.now(), makeId: () => `db_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}` };
            data.lore.forEach(l => {
                if (!l.key || !l.entry) return;
                if (addDatabankEntryWithDedupe(s.databank, { key: l.key, content: l.entry, tags: ["auto"] }, opts)) {
                    notify("info", `New Lore: ${l.key}`, "Journal", "journal");
                    needsSave = true;
                }
            });
        }

        // 6. Messages (Phone)
        const codiceMode = (() => {
            try {
                const mode = String(getGameMode(s) || "").toLowerCase();
                return mode === "high-fantasy" || mode === "rpg";
            } catch (_) {
                return false;
            }
        })();
        if (!codiceMode && Array.isArray(data.messages)) {
            if (!s.phone) s.phone = { smsThreads: {} };
            if (!s.phone.smsThreads) s.phone.smsThreads = {};

            data.messages.forEach(m => {
                if (!m.from || !m.text) return;
                const threadId = m.from;
                if (!s.phone.smsThreads[threadId]) s.phone.smsThreads[threadId] = [];
                s.phone.smsThreads[threadId].push({
                    isUser: false,
                    text: m.text,
                    ts: Date.now()
                });
                notify("success", `Message from ${m.from}`, "Phone", "phoneMessages");
                needsSave = true;
            });
        }

        // 7. Social
        if (data.social && typeof data.social === "object") {
            ensureSocial(s);
            const tabs = ["friends", "associates", "romance", "family", "rivals"];
            const tabPriority = { friends: 1, associates: 2, family: 3, romance: 4, rivals: 5 };
            const deleted = new Set((s.socialMeta.deletedNames || []).map(x => normalizeSocialNameKey(x)).filter(Boolean));
            const userNames = [userName, charName].map(x => String(x || "").trim()).filter(Boolean);
            const addList = Array.isArray(data.social.add) ? data.social.add : [];

            const existingMap = new Map();
            for (const tabName of tabs) {
                const arr = Array.isArray(s.social[tabName]) ? s.social[tabName] : [];
                for (let i = 0; i < arr.length; i++) {
                    const person = arr[i];
                    const key = normalizeSocialNameKey(person?.name || "");
                    if (!key || existingMap.has(key)) continue;
                    existingMap.set(key, { tab: tabName, idx: i, person });
                }
            }

            const firstNonEmpty = (...vals) => {
                for (const v of vals) {
                    const t = String(v || "").trim();
                    if (t) return t;
                }
                return "";
            };
            const clean = (v, maxLen = 120) => String(v || "").trim().slice(0, maxLen);
            const setIfNonEmpty = (obj, key, value) => {
                const next = String(value || "").trim();
                if (!next) return false;
                if (String(obj?.[key] || "").trim() === next) return false;
                obj[key] = next;
                return true;
            };

            let added = 0;
            let updated = 0;

            for (const v of addList.slice(0, 40)) {
                const nm = clean(v?.name, 64);
                if (!nm) continue;

                const key = normalizeSocialNameKey(nm);
                if (!key) continue;
                if (shouldExcludeSocialName(nm, { deletedSet: deleted, userNames })) continue;

                const aff = Math.max(0, Math.min(100, Math.round(Number(v?.affinity ?? 50))));
                const presence = String(v?.presence || "").toLowerCase().trim();
                const met = toBool(v?.met_physically) || presence === "present" || presence === "in_scene" || presence === "in room";
                const knownPast = !met && (toBool(v?.known_from_past) || presence === "known_past");
                if (!met && !knownPast && opts?.allowMentionOnlySocial !== true) continue;

                const relationship = clean(firstNonEmpty(v?.relationshipStatus, v?.relationship, v?.status, v?.role), 80);
                const familyRole = clean(firstNonEmpty(v?.familyRole, v?.family_role), 80);
                const thoughts = clean(firstNonEmpty(v?.thoughts, v?.notes, v?.summary, v?.description), 240);
                const location = clean(v?.location, 120);
                const age = clean(v?.age, 40);
                const knownFamily = clean(firstNonEmpty(v?.knownFamily, v?.known_family, v?.family), 120);
                const birthday = clean(v?.birthday, 48);
                const likes = clean(v?.likes, 180);
                const dislikes = clean(v?.dislikes, 180);
                const urlRaw = clean(v?.url, 240);
                const url = !urlRaw ? "" : (/^https?:\/\//i.test(urlRaw) ? urlRaw : `https://${urlRaw}`);

                let tab = roleToTab(firstNonEmpty(v?.role, relationship, familyRole));
                if (tab !== "family" && tab !== "romance" && aff <= 20) tab = "rivals";

                const hit = existingMap.get(key);
                if (hit && hit.person) {
                    const person = hit.person;
                    const liveSyncEnabled = person?.liveSync !== false;
                    let changed = false;

                    if (!person.id) { person.id = `person_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}`; changed = true; }
                    if (!Array.isArray(person.memories)) { person.memories = []; changed = true; }
                    if (person.liveSync === undefined) { person.liveSync = true; changed = true; }

                    if (liveSyncEnabled) {
                        const prevAff = Math.max(0, Math.min(100, Math.round(Number(person?.affinity ?? 50))));
                        if (prevAff !== aff && (prevAff === 50 || aff <= 30 || aff >= 70)) {
                            person.affinity = aff;
                            changed = true;
                        }

                        changed = setIfNonEmpty(person, "relationshipStatus", relationship) || changed;
                        changed = setIfNonEmpty(person, "familyRole", familyRole) || changed;
                        changed = setIfNonEmpty(person, "thoughts", thoughts) || changed;
                        changed = setIfNonEmpty(person, "location", met ? (location || "In current scene") : location) || changed;
                        changed = setIfNonEmpty(person, "age", age) || changed;
                        changed = setIfNonEmpty(person, "knownFamily", knownFamily) || changed;
                        changed = setIfNonEmpty(person, "birthday", birthday) || changed;
                        changed = setIfNonEmpty(person, "likes", likes) || changed;
                        changed = setIfNonEmpty(person, "dislikes", dislikes) || changed;
                        changed = setIfNonEmpty(person, "url", url) || changed;
                    }

                    if (met && person.met_physically !== true) { person.met_physically = true; changed = true; }
                    if (knownPast && person.known_from_past !== true) { person.known_from_past = true; changed = true; }
                    if (person.met_physically === true && person.known_from_past === true) { person.known_from_past = false; changed = true; }

                    if (liveSyncEnabled && tab !== hit.tab && (tabPriority[tab] || 0) >= (tabPriority[hit.tab] || 0)) {
                        const arrFrom = Array.isArray(s.social[hit.tab]) ? s.social[hit.tab] : [];
                        const idx = arrFrom.indexOf(person);
                        if (idx >= 0) arrFrom.splice(idx, 1);
                        person.tab = tab;
                        s.social[tab].push(person);
                        existingMap.set(key, { tab, idx: s.social[tab].length - 1, person });
                        changed = true;
                    }

                    if (changed) updated++;
                    continue;
                }

                const person = {
                    id: `person_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}`,
                    name: nm,
                    affinity: aff,
                    thoughts,
                    avatar: "",
                    likes,
                    dislikes,
                    birthday,
                    location: met ? (location || "In current scene") : location,
                    age,
                    knownFamily,
                    familyRole,
                    relationshipStatus: relationship,
                    url,
                    tab,
                    memories: [],
                    liveSync: true,
                    met_physically: met,
                    known_from_past: knownPast
                };
                s.social[tab].push(person);
                existingMap.set(key, { tab, idx: s.social[tab].length - 1, person });
                added++;
            }

            if (added || updated) needsSave = true;
        }
        // 7.5 Phone Numbers
        if (Array.isArray(data.phoneNumbers)) {
            if (!s.phone || typeof s.phone !== "object") s.phone = { smsThreads: {}, numberBook: [] };
            if (!Array.isArray(s.phone.numberBook)) s.phone.numberBook = [];
            const normalizeNumber = (raw) => String(raw || "").replace(/[^\d+]/g, "").replace(/^1(?=\d{10}$)/, "");
            const seen = new Set(s.phone.numberBook.map(x => normalizeNumber(x?.number || "")).filter(Boolean));
            let added = 0;
            for (const it of data.phoneNumbers.slice(0, 30)) {
                const nm = String(it?.name || "").trim() || "Unknown";
                const numRaw = String(it?.number || "").trim();
                const digits = normalizeNumber(numRaw);
                if (!digits) continue;
                if (seen.has(digits)) continue;
                s.phone.numberBook.push({ name: nm.slice(0, 60), number: numRaw.slice(0, 40), ts: Date.now() });
                seen.add(digits);
                added++;
            }
            if (added) {
                notify("success", `Saved ${added} contact(s).`, "Phone", "phoneCalls");
                needsSave = true;
            }
        }

        // 8. Battle
        const prevBattleActive = !!(s?.battle?.state?.active);
        if (data.battle && typeof data.battle === "object") {
            if (!s.battle || typeof s.battle !== "object") s.battle = { auto: false, state: { active: false, enemies: [], turnOrder: [], log: [], player: {}, rewards: {}, outcome: "", round: 0 } };
            if (!s.battle.state || typeof s.battle.state !== "object") s.battle.state = { active: false, enemies: [], turnOrder: [], log: [], player: {}, rewards: {}, outcome: "", round: 0 };
            if (!Array.isArray(s.battle.state.enemies)) s.battle.state.enemies = [];
            if (!Array.isArray(s.battle.state.turnOrder)) s.battle.state.turnOrder = [];
            if (!Array.isArray(s.battle.state.log)) s.battle.state.log = [];
            if (!s.battle.state.player || typeof s.battle.state.player !== "object") s.battle.state.player = {};
            if (!s.battle.state.rewards || typeof s.battle.state.rewards !== "object") s.battle.state.rewards = {};
            if (typeof s.battle.state.outcome !== "string") s.battle.state.outcome = "";
            if (!Number.isFinite(Number(s.battle.state.round))) s.battle.state.round = 0;

            if (typeof data.battle.active === "boolean") {
                if (s.battle.state.active !== data.battle.active) needsSave = true;
                s.battle.state.active = data.battle.active;
            }

            if (Number.isFinite(Number(data.battle.round))) {
                s.battle.state.round = Math.max(0, Math.round(Number(data.battle.round) || 0));
                needsSave = true;
            }

            if (typeof data.battle.outcome === "string") {
                s.battle.state.outcome = String(data.battle.outcome || "").trim().slice(0, 40);
                needsSave = true;
            }

            if (data.battle.player && typeof data.battle.player === "object") {
                const prevPlayer = s.battle.state.player || {};
                const playerFx = [];
                const addPlayerFx = (value, maxLen = 50) => {
                    const t = String(value || "").trim().slice(0, maxLen);
                    if (!t || playerFx.includes(t)) return;
                    playerFx.push(t);
                };
                if (Array.isArray(data.battle.player.statusEffects)) {
                    for (const x of data.battle.player.statusEffects) addPlayerFx(x, 50);
                }
                if (Array.isArray(prevPlayer.statusEffects)) {
                    for (const x of prevPlayer.statusEffects) addPlayerFx(x, 50);
                }
                const playerStatus = String(data.battle.player.status || prevPlayer.status || "").trim().slice(0, 60);
                if (playerStatus) addPlayerFx(playerStatus, 50);
                const readBattleMeter = (src, prev, key) => {
                    const raw = (src?.[key] === null || src?.[key] === undefined) ? (prev?.[key] ?? null) : Number(src[key]);
                    if (raw === null || Number.isNaN(Number(raw))) return null;
                    return Number(raw);
                };
                s.battle.state.player = {
                    name: String(data.battle.player.name || prevPlayer.name || "Player").trim().slice(0, 60),
                    className: String(data.battle.player.className || data.battle.player.class || prevPlayer.className || "").trim().slice(0, 60),
                    hp: readBattleMeter(data.battle.player, prevPlayer, "hp"),
                    maxHp: readBattleMeter(data.battle.player, prevPlayer, "maxHp"),
                    mp: readBattleMeter(data.battle.player, prevPlayer, "mp"),
                    maxMp: readBattleMeter(data.battle.player, prevPlayer, "maxMp"),
                    ap: readBattleMeter(data.battle.player, prevPlayer, "ap"),
                    maxAp: readBattleMeter(data.battle.player, prevPlayer, "maxAp"),
                    status: playerStatus,
                    statusEffects: playerFx.slice(0, 10)
                };
                needsSave = true;
            }

            if (Array.isArray(data.battle.enemies)) {
                const prevEnemiesByName = new Map(
                    (s.battle.state.enemies || [])
                        .map((e) => [String(e?.name || "").toLowerCase().trim(), e])
                        .filter(([k]) => !!k)
                );

                const normEnemies = data.battle.enemies
                    .map((e) => {
                        const name = String(e?.name || "").trim();
                        if (!name) return null;
                        const key = name.toLowerCase();
                        const prev = prevEnemiesByName.get(key) || {};

                        const readBattleMeter = (src, prevObj, field) => {
                            const raw = (src?.[field] === null || src?.[field] === undefined) ? (prevObj?.[field] ?? null) : Number(src[field]);
                            if (raw === null || Number.isNaN(Number(raw))) return null;
                            return Number(raw);
                        };

                        const hp = readBattleMeter(e, prev, "hp");
                        const maxHpCandidate = readBattleMeter(e, prev, "maxHp");
                        const maxHp = (maxHpCandidate !== null && Number.isFinite(maxHpCandidate) && maxHpCandidate > 0) ? maxHpCandidate : null;
                        const mp = readBattleMeter(e, prev, "mp");
                        const maxMpCandidate = readBattleMeter(e, prev, "maxMp");
                        const maxMp = (maxMpCandidate !== null && Number.isFinite(maxMpCandidate) && maxMpCandidate > 0) ? maxMpCandidate : null;
                        const ap = readBattleMeter(e, prev, "ap");
                        const maxApCandidate = readBattleMeter(e, prev, "maxAp");
                        const maxAp = (maxApCandidate !== null && Number.isFinite(maxApCandidate) && maxApCandidate > 0) ? maxApCandidate : null;

                        const levelRaw = (e?.level === null || e?.level === undefined) ? (prev?.level ?? 0) : Number(e.level);
                        const level = Number.isFinite(Number(levelRaw)) ? Number(levelRaw) : 0;
                        const className = String(e?.className || e?.class || prev?.className || "").trim().slice(0, 60);
                        const type = String(e?.type || e?.enemyType || prev?.type || "").trim().slice(0, 60);
                        const rank = String(e?.rank || prev?.rank || "").trim().slice(0, 40);
                        const status = String(e?.status || prev?.status || "").trim().slice(0, 60);
                        const threat = String(e?.threat || prev?.threat || "").trim().slice(0, 60);
                        const xpRaw = (e?.xp === null || e?.xp === undefined) ? (prev?.xp ?? null) : Number(e.xp);
                        const xp = (xpRaw === null || Number.isNaN(Number(xpRaw))) ? null : Math.max(0, Number(xpRaw));
                        const attacks = Array.isArray(e?.attacks) ?
                             e.attacks.map((x) => String(x || "").trim().slice(0, 80)).filter(Boolean).slice(0, 8)
                            : (Array.isArray(prev?.attacks) ? prev.attacks.slice(0, 8) : []);
                        const loot = Array.isArray(e?.loot) ?
                             e.loot.map((x) => String(x || "").trim().slice(0, 80)).filter(Boolean).slice(0, 8)
                            : (Array.isArray(prev?.loot) ? prev.loot.slice(0, 8) : []);

                        const statusEffects = (() => {
                            const bits = [];
                            const addFx = (value, maxLen = 50) => {
                                const t = String(value || "").trim().slice(0, maxLen);
                                if (!t || bits.includes(t)) return;
                                bits.push(t);
                            };

                            if (Array.isArray(e?.statusEffects)) {
                                for (const x of e.statusEffects) addFx(x, 50);
                            }

                            if (status) addFx(status, 50);
                            if (threat) addFx(`Threat: ${threat}`, 48);
                            if (rank) addFx(`Rank: ${rank}`, 48);
                            if (type) addFx(`Type: ${type}`, 48);

                            if (Array.isArray(prev?.statusEffects)) {
                                for (const x of prev.statusEffects) {
                                    addFx(x, 50);
                                    if (bits.length >= 8) break;
                                }
                            }

                            return bits.slice(0, 8);
                        })();

                        const boss = (typeof e?.boss === "boolean") ?
                             e.boss
                            : (typeof prev?.boss === "boolean" ? prev.boss : /boss|elite/i.test(String(e?.threat || "")));

                        return {
                            name: name.slice(0, 60),
                            hp: hp === null ? null : Math.max(0, Math.round(hp)),
                            maxHp: maxHp === null ? null : Math.max(1, Math.round(maxHp)),
                            mp: mp === null ? null : Math.max(0, Math.round(mp)),
                            maxMp: maxMp === null ? null : Math.max(1, Math.round(maxMp)),
                            ap: ap === null ? null : Math.max(0, Math.round(ap)),
                            maxAp: maxAp === null ? null : Math.max(1, Math.round(maxAp)),
                            level: Math.max(0, Math.round(level)),
                            boss,
                            className,
                            type,
                            rank,
                            status,
                            threat,
                            statusEffects,
                            attacks,
                            loot,
                            xp: xp === null ? null : Math.round(xp)
                        };
                    })
                    .filter(Boolean)
                    .slice(0, 12);

                s.battle.state.enemies = normEnemies;
                needsSave = true;
            }

            if (Array.isArray(data.battle.turnOrder)) {
                s.battle.state.turnOrder = data.battle.turnOrder
                    .map((x) => String(x || "").trim().slice(0, 60))
                    .filter(Boolean)
                    .slice(0, 30);
                needsSave = true;
            }

            if (Array.isArray(data.battle.log)) {
                for (const line of data.battle.log.slice(0, 10)) {
                    const t = String(line || "").trim();
                    if (!t) continue;
                    s.battle.state.log.push(t.slice(0, 200));
                }
                s.battle.state.log = s.battle.state.log.slice(-120);
                needsSave = true;
            }

            if (data.battle.rewards && typeof data.battle.rewards === "object") {
                const rewardLoot = Array.isArray(data.battle.rewards.loot) ?
                     data.battle.rewards.loot.map((x) => String(x || "").trim().slice(0, 80)).filter(Boolean).slice(0, 16)
                    : (Array.isArray(s.battle.state.rewards?.loot) ? s.battle.state.rewards.loot.slice(0, 16) : []);
                const readRewardNumber = (value, prev) => {
                    if (value === null || value === undefined) return prev ?? null;
                    const n = Number(value);
                    return Number.isFinite(n) ? Math.max(0, n) : (prev ?? null);
                };
                s.battle.state.rewards = {
                    xp: readRewardNumber(data.battle.rewards.xp, s.battle.state.rewards?.xp),
                    gold: readRewardNumber(data.battle.rewards.gold, s.battle.state.rewards?.gold),
                    skillXp: readRewardNumber(data.battle.rewards.skillXp, s.battle.state.rewards?.skillXp),
                    loot: rewardLoot,
                    note: String(data.battle.rewards.note || s.battle.state.rewards?.note || "").trim().slice(0, 160)
                };
                needsSave = true;
            }

            const nextBattleActive = !!(s?.battle?.state?.active);
            try {
                window.dispatchEvent(new CustomEvent("uie:battle_state_updated", { detail: { active: nextBattleActive, source: sourceTag } }));
            } catch (_) {}
            if (!prevBattleActive && nextBattleActive) {
                try {
                    window.dispatchEvent(new CustomEvent("uie:battle_detected", { detail: { source: sourceTag } }));
                } catch (_) {}
            }
        }

        // 9. Party
        if (data.party && typeof data.party === "object") {
            ensureParty(s);
            let partyChanged = false;
            let coreVitalsChanged = false;

            const maybeSyncCoreFromMember = (member, nameHint = "") => {
                if (!member) return;
                if (isUserPartyMember(s, member, nameHint)) {
                    coreVitalsChanged = syncUserMemberToCoreVitals(s, member) || coreVitalsChanged;
                }
            };

            // Joined
            if (Array.isArray(data.party.joined)) {
                for (const p of data.party.joined) {
                    const nm = String(p?.name || "").trim();
                    if (!nm) continue;
                    let m = findPartyMemberByName(s, nm);
                    let created = false;
                    if (!m) {
                        m = createMember(nm);
                        // Try to link avatar from social
                        ensureSocial(s);
                        const friend = ["friends", "associates", "romance", "family", "rivals"].flatMap(k => s.social[k]).find(x => String(x?.name || "").toLowerCase() === nm.toLowerCase());
                        if (friend && friend.avatar) m.images.portrait = friend.avatar;
                        s.party.members.push(m);
                        notify("success", `${nm} joined the party!`, "Party", "party");
                        created = true;
                    }
                    ensurePartyMemberState(m);
                    const updateChanged = applyPartyMemberUpdate(m, p);
                    const laneChanged = (p?.lane !== undefined && p?.lane !== null) ? assignMemberToFormationLane(s, m, p.lane) : false;
                    if (created || updateChanged || laneChanged) {
                        partyChanged = true;
                        maybeSyncCoreFromMember(m, nm);
                    }
                }
            }

            // Left
            if (Array.isArray(data.party.left)) {
                for (const name of data.party.left) {
                    const idx = s.party.members.findIndex(m => m.identity.name.toLowerCase() === String(name).toLowerCase());
                    if (idx !== -1) {
                        const m = s.party.members[idx];
                        removeMemberFromFormationLanes(s, m?.id);
                        // Move to awayMembers instead of deleting
                        m.active = false;
                        m.leftAt = Date.now();
                        m.leaveReason = "temporary";
                        s.party.awayMembers = s.party.awayMembers || [];
                        s.party.awayMembers.push(m);
                        s.party.members.splice(idx, 1);
                        notify("info", `${m.identity.name} stepped away from the party.`, "Party", "party");
                        partyChanged = true;
                    }
                }
            }

            // Returned (away members coming back)
            if (Array.isArray(data.party.returned)) {
                s.party.awayMembers = s.party.awayMembers || [];
                for (const name of data.party.returned) {
                    const awayIdx = s.party.awayMembers.findIndex(m => m.identity.name.toLowerCase() === String(name).toLowerCase());
                    if (awayIdx !== -1) {
                        const m = s.party.awayMembers.splice(awayIdx, 1)[0];
                        m.active = true;
                        m.leftAt = null;
                        m.leaveReason = null;
                        s.party.members.push(m);
                        
                        // Spawn sprite on stage
                        try {
                            spawnStageSprite({
                                id: `party_${m.id}`,
                                type: m.identity.name,
                                sprite: "neutral",
                                layer: "mid",
                                pos: "center",
                                dist: "medium",
                                charName: m.identity.name
                            });
                        } catch (_) {}
                        
                        // Set as current target
                        try {
                            const targetSelect = document.getElementById("target-select");
                            if (targetSelect) {
                                const options = Array.from(targetSelect.options);
                                const matchingOption = options.find(opt => 
                                    opt.value.toLowerCase().includes(m.identity.name.toLowerCase()) ||
                                    opt.text.toLowerCase().includes(m.identity.name.toLowerCase())
                                );
                                if (matchingOption) {
                                    targetSelect.value = matchingOption.value;
                                    targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
                                }
                            }
                        } catch (_) {}
                        
                        notify("success", `${m.identity.name} returned to the party!`, "Party", "party");
                        partyChanged = true;
                    }
                }
            }

            const partyUpdates = Array.isArray(data.party.updates) ?
                 data.party.updates
                : (Array.isArray(data.party.memberUpdates) ? data.party.memberUpdates : []);

            if (partyUpdates.length) {
                for (const upd of partyUpdates.slice(0, 40)) {
                    const nm = String(upd?.name || upd?.member || upd?.memberName || "").trim();
                    if (!nm) continue;

                    let m = findPartyMemberByName(s, nm);
                    if (!m) {
                        if (upd?.joined === true || upd?.join === true) {
                            m = createMember(nm);
                            s.party.members.push(m);
                            notify("success", `${nm} joined the party!`, "Party", "party");
                            partyChanged = true;
                        } else {
                            continue;
                        }
                    }

                    ensurePartyMemberState(m);
                    const changed = applyPartyMemberUpdate(m, upd);
                    const laneChanged = (upd?.lane !== undefined && upd?.lane !== null) ? assignMemberToFormationLane(s, m, upd.lane) : false;
                    if (changed || laneChanged) {
                        partyChanged = true;
                        maybeSyncCoreFromMember(m, nm);
                    }
                }
            }

            const formationRaw = (data.party.formation && typeof data.party.formation === "object") ?
                 ((data.party.formation.lanes && typeof data.party.formation.lanes === "object") ? data.party.formation.lanes : data.party.formation)
                : null;

            if (formationRaw) {
                for (const lane of ["front", "mid", "back"]) {
                    if (!Array.isArray(formationRaw[lane])) continue;
                    const nextLaneIds = [];
                    for (const rawRef of formationRaw[lane].slice(0, 24)) {
                        const token = String(rawRef?.id || rawRef?.name || rawRef || "").trim();
                        if (!token) continue;
                        const byId = s.party.members.find((m) => String(m?.id || "") === token) || null;
                        const member = byId || findPartyMemberByName(s, token);
                        const id = String(member?.id || "");
                        if (!id) continue;
                        if (!nextLaneIds.includes(id)) nextLaneIds.push(id);
                    }

                    const prevLaneIds = Array.isArray(s.party.formation.lanes[lane]) ? s.party.formation.lanes[lane] : [];
                    const changed = prevLaneIds.length !== nextLaneIds.length || prevLaneIds.some((id, i) => String(id || "") !== String(nextLaneIds[i] || ""));
                    if (changed) {
                        s.party.formation.lanes[lane] = nextLaneIds;
                        partyChanged = true;
                    }
                }
            }

            const validIds = new Set(s.party.members.map((m) => String(m?.id || "")).filter(Boolean));
            for (const lane of ["front", "mid", "back"]) {
                const beforeLane = Array.isArray(s.party.formation.lanes[lane]) ? s.party.formation.lanes[lane] : [];
                const afterLane = beforeLane.filter((id) => validIds.has(String(id || "")));
                if (afterLane.length !== beforeLane.length) {
                    s.party.formation.lanes[lane] = afterLane;
                    partyChanged = true;
                }
            }

            if (coreVitalsChanged) {
                try { if (typeof $ !== "undefined") $(document).trigger("uie:updateVitals"); } catch (_) {}
                try { window.dispatchEvent(new CustomEvent("uie:updateVitals")); } catch (_) {}
            }

            if (partyChanged || coreVitalsChanged) needsSave = true;
        }

        // 10. Equipped (User)
        if (data.equipped && typeof data.equipped === "object") {
            ensureEquipArrays(s);
            // Equip
            if (Array.isArray(data.equipped.equip)) {
                for (const eq of data.equipped.equip) {
                    const itemName = String(eq?.item || "").trim();
                    const slot = String(eq?.slot || "").trim().toLowerCase();
                    if (!itemName || !slot) continue;

                    // Find item in inventory
                    const idx = s.inventory.items.findIndex(x => x.name.toLowerCase().includes(itemName.toLowerCase()));
                    if (idx === -1) continue;

                    const item = s.inventory.items[idx];

                    // Unequip existing slot if any
                    const existingIdx = s.inventory.equipped.findIndex(x => x.slotId === slot);
                    if (existingIdx !== -1) {
                         const old = s.inventory.equipped[existingIdx];
                         delete old.slotId;
                         addInventoryItemWithStack(s.inventory.items, old, { source: "unequip_swap" });
                         s.inventory.equipped.splice(existingIdx, 1);
                    }

                    // Move new item
                    s.inventory.items.splice(idx, 1);
                    item.slotId = slot;
                    s.inventory.equipped.push(item);
                    notify("success", `Equipped ${item.name}`, "Equipment", "armor");
                    needsSave = true;
                }
            }
            // Unequip
            if (Array.isArray(data.equipped.unequip)) {
                for (const val of data.equipped.unequip) {
                    const v = String(val || "").trim().toLowerCase();
                    if (!v) continue;

                    // Try by slot first
                    let eIdx = s.inventory.equipped.findIndex(x => x.slotId === v);
                    // Then by name
                    if (eIdx === -1) eIdx = s.inventory.equipped.findIndex(x => x.name.toLowerCase().includes(v));

                    if (eIdx !== -1) {
                        const item = s.inventory.equipped[eIdx];
                        delete item.slotId;
                        s.inventory.equipped.splice(eIdx, 1);
                        addInventoryItemWithStack(s.inventory.items, item, { source: "unequip" });
                        notify("info", `Unequipped ${item.name}`, "Equipment", "armor");
                        needsSave = true;
                    }
                }
            }
        }

        try {
            const stackChanged = normalizeInventoryStacksInPlace(s.inventory.items, { source: sourceTag, chatHint: chatSnippet });
            if (stackChanged) needsSave = true;
        } catch (_) {}

        const afterCounts = {
            items: Array.isArray(s?.inventory?.items) ? s.inventory.items.length : 0,
            skills: Array.isArray(s?.inventory?.skills) ? s.inventory.skills.length : 0,
            assets: Array.isArray(s?.inventory?.assets) ? s.inventory.assets.length : 0,
            life: Array.isArray(s?.life?.trackers) ? s.life.trackers.length : 0,
            quests: (() => { const j = s?.journal; if (!j) return 0; return (Array.isArray(j.pending) ? j.pending.length : 0) + (Array.isArray(j.active) ? j.active.length : 0) + (Array.isArray(j.completed) ? j.completed.length : 0) + (Array.isArray(j.abandoned) ? j.abandoned.length : 0); })(),
            lore: Array.isArray(s?.databank) ? s.databank.length : 0,
            party: Array.isArray(s?.party?.members) ? s.party.members.length : 0,
            social: countSocialPeople(s),
            phoneMsgs: countPhoneMsgs(s)
        };
        const summary = {
            items: afterCounts.items - beforeCounts.items,
            skills: afterCounts.skills - beforeCounts.skills,
            assets: afterCounts.assets - beforeCounts.assets,
            life: afterCounts.life - beforeCounts.life,
            quests: afterCounts.quests - beforeCounts.quests,
            lore: afterCounts.lore - beforeCounts.lore,
            party: afterCounts.party - beforeCounts.party,
            social: afterCounts.social - beforeCounts.social,
            phoneMsgs: afterCounts.phoneMsgs - beforeCounts.phoneMsgs
        };
        try { window.UIE_lastScanSummary = { at: Date.now(), summary, needsSave }; } catch (_) {}
        try {
            if (force) {
                const bits = [];
                for (const [k, v] of Object.entries(summary)) {
                    if (!Number(v)) continue;
                    bits.push(`${k} ${v > 0 ? "+" : ""}${v}`);
                }
                notify("info", bits.length ? `Scan changes: ${bits.join(", ")}` : "Scan complete: no detected additions/changes.", "UIE", "scanSummary");
            }
        } catch (_) {}

        // Governor Rule Check Integration
        try {
            const dom = getGlobalDOM();
            const loc = dom?.playerLocation || { worldId: "default", regionId: "hub", localGridId: "main" };
            const worldRules = s.governorRules?.worldRules || [];
            const regionRules = s.governorRules?.regionalRules?.[loc.regionId] || [];
            const localRules = s.governorRules?.localRules?.[loc.localGridId] || [];
            const activeRules = [...worldRules, ...regionRules, ...localRules];

            if (activeRules.length > 0) {
                const userMsg = getLastUserMessage();
                if (userMsg && userMsg !== window.UIE_lastScannedUserMsg) {
                    window.UIE_lastScannedUserMsg = userMsg;
                    void (async () => {
                        try {
                            const violation = await checkGovernorRuleViolation(userMsg, activeRules);
                            if (violation) {
                                await processRuleViolation(violation, activeRules);
                            }
                        } catch (e) {
                            console.error("[Governor] Scan check async error:", e);
                        }
                    })();
                }
            }
        } catch (govErr) {
            console.warn("[Governor] Check error:", govErr);
        }

        try {
            window.UIE_scanEverythingDedupe = {
                sig: scanSig || readChatScanSignature(),
                mesId: sourceMesId,
                at: Date.now(),
            };
        } catch (_) {}

        if (needsSave) {
            commitStateUpdate({ save: true, layout: force === true, emit: true });
            if (sourceMesId !== null) {
                const u = ensureUndoStore();
                u.lastMesId = sourceMesId;
            }
        }

        // Store per-message undo patch after scan completed.
        try {
            if (sourceMesId !== null && beforeSnap && undoFp) {
                const afterSnap = snapshotScanTouchedState(getSettings());
                const ops = diffSnapshots(beforeSnap, afterSnap);
                const u = ensureUndoStore();
                u.byFp[undoFp] = { at: Date.now(), mesId: sourceMesId, fp: undoFp, ops };
                u.byMesId[String(sourceMesId)] = { at: Date.now(), fp: undoFp, ops };
                try {
                    const keys = Object.keys(u.byFp);
                    if (keys.length > 120) {
                        keys.sort((a, b) => Number(u.byFp[a]?.at || 0) - Number(u.byFp[b]?.at || 0));
                        for (let i = 0; i < keys.length - 120; i++) delete u.byFp[keys[i]];
                    }
                } catch (_) {}
            }
        } catch (_) {}

        return { ok: true, changed: needsSave, summary };

    } catch (e) {
        console.warn("UIE Unified Scan Parse Error:", e);
        if (force) {
            try { notify("error", `Scan parse error: ${String(e?.message || e || "unknown")}`.slice(0, 220), "Scan", "scanBlocked"); } catch (_) {}
        }
        return { ok: false, error: String(e?.message || e || "Scan parse error") };
    }
    } finally {
        try { if (window.UIE_scanEverythingGate) window.UIE_scanEverythingGate.inFlight = false; } catch (_) {}
    }
}

/**
 * Returns the current world state for other modules to use.
 */
export function getWorldState() {
    const s = getSettings();
    ensureState(s);
    return s.worldState;
}

// Deprecated individual exports if needed for backward compat, but we replace usage.
export const scanWorldState = scanEverything;

// Event-based auto scan (no interval)
export async function initAutoScanning() {
    try {
        try {
            if (!window.UIE_scanNow) {
                window.UIE_scanNow = (opts = {}) => scanEverything({ ...(opts || {}), force: opts?.force === true });
            }
        } catch (_) {}

        const bus = await resolveStEventBus();
        const src = bus?.src;
        const types = bus?.types;
        if (!src || !types) {
            try {
                const k = "__uieAutoScanRetry";
                const n = Number(window[k] || 0) || 0;
                if (n < 120) {
                    window[k] = n + 1;
                    setTimeout(() => { try { void initAutoScanning(); } catch (_) {} }, 250);
                }
            } catch (_) {}

            try { initDomAutoScanningFallback(); } catch (_) {}
            return;
        }

        try { window.UIE_autoScanHasEventBus = true; } catch (_) {}

        try {
            if (window.UIE_autoScanBound) return;
            window.UIE_autoScanBound = true;
            try { window.UIE_autoScanBoundAt = Date.now(); } catch (_) {}
            try { if (window.UIE_DEBUG === true) console.log("[UIE] AutoScanning bound"); } catch (_) {}
        } catch (_) {}

        let t = null;
        const trigger = (...args) => {
            try {
                if (typeof window !== "undefined" && window.UIE_gameOwnsPostReplyScan === true) return;
            } catch (_) {}
            try {
                const s = getSettings();
                if (!s || s.enabled === false) return;
                if (s.generation?.scanAllEnabled === false) return;
                if (s.generation?.scanOnlyOnGenerateButtons === true) return;
            } catch (_) {}

            try {
                window.UIE_autoScanLastTriggerAt = Date.now();
                if (window.UIE_DEBUG === true) console.log("[UIE] AutoScanning trigger", args);
            } catch (_) {}
            const mesId = readUndoMesIdFromArgs(args);

            try {
                const u = ensureUndoStore();
                const sig = readChatSig();
                u.lastChatLen = Number(sig?.count || 0) || 0;
                u.lastChatTailFp = readChatTailFingerprint();
                u.lastChatFps = readChatFingerprintList();
            } catch (_) {}

            if (t) clearTimeout(t);
            try { window.UIE_autoScanLastScheduledAt = Date.now(); } catch (_) {}
            t = setTimeout(() => {
                try { window.UIE_autoScanLastRunAt = Date.now(); } catch (_) {}
                // Debounce check: ensure we don't run if another scan started very recently
                const now = Date.now();
                const min = (() => {
                    try {
                        const s = getSettings();
                        return Math.max(1000, Number(s?.generation?.autoScanMinIntervalMs || 8000));
                    } catch (_) {
                        return 2000;
                    }
                })();
                if (window.UIE_scanEverythingGate && (now - Number(window.UIE_scanEverythingGate.lastAt || 0) < min)) return;
                
                scanEverything({ sourceMesId: mesId }).catch((e) => {
                    try { window.UIE_autoScanLastError = String(e?.message || e || ""); } catch (_) {}
                });
            }, 800); // Increased debounce from 400 to 800
        };

        try {
            if (typeof window === "undefined" || window.UIE_gameOwnsPostReplyScan !== true) {
                try { src.on(types.MESSAGE_RECEIVED, trigger); } catch (_) { try { src.on("message_received", trigger); } catch (_) {} }
                try { src.on(types.GENERATION_ENDED, trigger); } catch (_) { try { src.on("generation_ended", trigger); } catch (_) {} }
            }
        } catch (_) {}

        try { src.on(types.MESSAGE_DELETED, () => {
            try { window.UIE_autoScanLastDeleteAt = Date.now(); } catch (_) {}
            try {
                const u = ensureUndoStore();
                const prevFps = Array.isArray(u.lastChatFps) ? u.lastChatFps : [];
                const curFps = readChatFingerprintList();

                // Identify missing fingerprints (single deletion)
                const prevSet = new Map();
                for (const fp of prevFps) prevSet.set(fp, (prevSet.get(fp) || 0) + 1);
                for (const fp of curFps) {
                    const n = prevSet.get(fp) || 0;
                    if (n <= 1) prevSet.delete(fp);
                    else prevSet.set(fp, n - 1);
                }
                const missing = Array.from(prevSet.entries())
                    .flatMap(([fp, n]) => new Array(Math.max(0, n | 0)).fill(fp));

                if (missing.length === 1) {
                    const deletedFp = missing[0];
                    const rec = u.byFp?.[deletedFp];
                    if (rec && Array.isArray(rec.ops) && rec.ops.length) {
                        const s2 = getSettings();
                        const changed = applyUndoOps(s2, rec.ops);
                        delete u.byFp[deletedFp];
                        u.lastMesId = null;
                        if (changed) commitStateUpdate({ save: true, layout: false, emit: true, undo: true, fp: deletedFp });
                    }
                }

                const sig = readChatSig();
                const curLen = Number(sig?.count || 0) || 0;
                u.lastChatLen = curLen;
                u.lastChatTailFp = readChatTailFingerprint();
                u.lastChatFps = curFps;
            } catch (_) {}
        }); } catch (_) { try { src.on("message_deleted", () => {}); } catch (_) {} }

        try { initDomAutoScanningFallback(); } catch (_) {}
    } catch (_) {}
}

function getLastUserMessage() {
  try {
    const $userMsgs = $(".mes.is_user");
    if ($userMsgs.length) {
      const txt = $userMsgs.last().find(".mes_text, .mes-text").text().trim();
      if (txt) return txt;
    }
    const userNodes = document.querySelectorAll(".mes.is_user");
    if (userNodes.length) {
      const last = userNodes[userNodes.length - 1];
      const txtEl = last.querySelector(".mes_text, .mes-text") || last;
      const txt = txtEl.textContent.trim();
      if (txt) return txt;
    }
  } catch (_) {}
  return "";
}

async function checkGovernorRuleViolation(userMsg, activeRules) {
  if (!userMsg || !activeRules.length) return null;
  const rulesList = activeRules.map((r, i) => `#${i + 1}: [ID: ${r.id}] Target: "${r.target}" (Severity: ${r.severity}/10)`).join("\n");
  const prompt = `[Social Physics Engine - Rule Violation Detection]
Evaluate if the player's last chat message describes actions or items that explicitly break any of the active rules.

Active Rules:
${rulesList}

Player Message:
"${userMsg}"

Did the player break any of these rules in their message?
If YES, you MUST answer strictly in this JSON format:
{"broken": true, "ruleId": "broken_rule_id", "crime": "Short Description of Crime"}

If NO, answer strictly in this JSON format:
{"broken": false}`;

  try {
    const response = await generateContent(prompt, "System Check");
    const cleaned = String(response || "").replace(/```json|```/g, "").trim();
    if (cleaned) {
      const obj = JSON.parse(cleaned);
      if (obj && obj.broken && obj.ruleId) {
        return obj;
      }
    }
  } catch (e) {
    console.warn("[Governor] LLM rule parse error:", e);
  }
  return null;
}

async function processRuleViolation(violation, activeRules) {
  const gov = getGlobalGovernor();
  if (!gov) return;
  const rule = activeRules.find(r => r.id === violation.ruleId);
  if (!rule) return;
  
  const check = gov.checkWitnessAndExceptions(rule.severity);
  if (!check.witnessed) {
    console.log(`[Governor] Player broke rule "${rule.target}" but it was not witnessed/reported: ${check.reason}`);
    notify("info", `Activity noticed... but identity remains unknown (disguised/unseen).`, "Social Physics");
    return;
  }
  
  const dom = getGlobalDOM();
  const loc = dom?.playerLocation || { regionId: "hub" };
  const scopeKey = rule.scope === "world" ? "world" : (rule.scope === "regional" ? loc.regionId : loc.localGridId);
  
  gov.breakRule(scopeKey, rule.id);
  notify("error", `LAW BROKEN! Crime: ${violation.crime || rule.target}. Heat level increased!`, "WANTED SYSTEM");
}






