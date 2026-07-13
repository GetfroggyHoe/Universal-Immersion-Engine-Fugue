import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";
import { ensureCausalityState, EVENT_TYPES, MODAL_DOMAINS, propagateEvent } from "./causalityEngine.js";

const CONSEQUENCE_VERSION = "1.0.0";
const MAX_CONSEQUENCES = 500;
const MAX_CHAIN_DEPTH = 6;
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

function ensureConsequenceState(s) {
    const c = ensureCausalityState(s);
    if (!c.consequences || typeof c.consequences !== "object") c.consequences = {};
    if (!Array.isArray(c.consequences.queue)) c.consequences.queue = [];
    if (!Array.isArray(c.consequences.fired)) c.consequences.fired = [];
    if (!Array.isArray(c.consequences.cancelled)) c.consequences.cancelled = [];
    if (!c.consequences.chains || typeof c.consequences.chains !== "object") c.consequences.chains = {};
    if (typeof c.consequences.lastProcessedAt !== "number") c.consequences.lastProcessedAt = 0;
    return c.consequences;
}

const CONSEQUENCE_TEMPLATES = {
    crime_witnessed: [
        {
            delayMinutes: [5, 30],
            domain: MODAL_DOMAINS.SOCIAL,
            action: "witnessReports",
            probability: 0.7,
            payload: { severity: "moderate" },
        },
        {
            delayMinutes: [60, 240],
            domain: MODAL_DOMAINS.WORLD,
            action: "wantedNotice",
            probability: 0.4,
            payload: { bounty: "small" },
        },
    ],
    crime_unwitnessed: [
        {
            delayMinutes: [120, 480],
            domain: MODAL_DOMAINS.WORLD,
            action: "rumorStarts",
            probability: 0.2,
            payload: { type: "suspicion" },
        },
    ],
    heroic_act: [
        {
            delayMinutes: [0, 5],
            domain: MODAL_DOMAINS.SOCIAL,
            action: "witnessGratitude",
            probability: 0.9,
            payload: { type: "thanks" },
        },
        {
            delayMinutes: [60, 180],
            domain: MODAL_DOMAINS.WORLD,
            action: "reputationBoost",
            probability: 0.6,
            payload: { amount: "moderate" },
        },
    ],
    merchant_cheated: [
        {
            delayMinutes: [30, 120],
            domain: MODAL_DOMAINS.SOCIAL,
            action: "merchantWarnsOthers",
            probability: 0.5,
            payload: { type: "bad_reputation" },
        },
        {
            delayMinutes: [240, 720],
            domain: MODAL_DOMAINS.SHOP,
            action: "priceIncrease",
            probability: 0.3,
            payload: { target: "all_merchants", amount: 0.15 },
        },
    ],
    quest_failed: [
        {
            delayMinutes: [60, 240],
            domain: MODAL_DOMAINS.SOCIAL,
            action: "questGiverDisappointed",
            probability: 0.8,
            payload: { affinityDelta: -10 },
        },
        {
            delayMinutes: [120, 480],
            domain: MODAL_DOMAINS.JOURNAL,
            action: "alternativeQuestAvailable",
            probability: 0.4,
            payload: { type: "redemption" },
        },
    ],
    npc_insulted: [
        {
            delayMinutes: [0, 15],
            domain: MODAL_DOMAINS.SOCIAL,
            action: "npcMoodDrop",
            probability: 1.0,
            payload: { moodDelta: -15 },
        },
        {
            delayMinutes: [30, 120],
            domain: MODAL_DOMAINS.WORLD,
            action: "gossipSpreads",
            probability: 0.5,
            payload: { type: "negative_reputation" },
        },
        {
            delayMinutes: [240, 720],
            domain: MODAL_DOMAINS.SOCIAL,
            action: "friendsSideWithNpc",
            probability: 0.3,
            payload: { affinityDelta: -5 },
        },
    ],
    item_stolen: [
        {
            delayMinutes: [15, 60],
            domain: MODAL_DOMAINS.WORLD,
            action: "ownerNotices",
            probability: 0.6,
            payload: { type: "alert" },
        },
        {
            delayMinutes: [60, 240],
            domain: MODAL_DOMAINS.SOCIAL,
            action: "searchParty",
            probability: 0.3,
            payload: { severity: "moderate" },
        },
    ],
    lie_told: [
        {
            delayMinutes: [120, 480],
            domain: MODAL_DOMAINS.SOCIAL,
            action: "truthSurfaces",
            probability: 0.25,
            payload: { trustDelta: -20 },
        },
    ],
    promise_broken: [
        {
            delayMinutes: [0, 30],
            domain: MODAL_DOMAINS.SOCIAL,
            action: "npcDisappointed",
            probability: 1.0,
            payload: { trustDelta: -15 },
        },
        {
            delayMinutes: [240, 720],
            domain: MODAL_DOMAINS.SOCIAL,
            action: "trustErodes",
            probability: 0.4,
            payload: { trustDelta: -10 },
        },
    ],
};

function createConsequence(triggerEvent, template, parentChainId) {
    const delayRange = template.delayMinutes || [0, 60];
    const delayMin = Math.min(delayRange[0], delayRange[1]);
    const delayMax = Math.max(delayRange[0], delayRange[1]);
    const delay = delayMin + Math.random() * (delayMax - delayMin);
    return {
        id: `conseq_${nowMs()}_${Math.random().toString(36).slice(2, 8)}`,
        triggerEvent: triggerEvent,
        domain: template.domain || MODAL_DOMAINS.WORLD,
        action: template.action || "",
        payload: template.payload || {},
        probability: clamp(Number(template.probability || 0.5), 0, 1),
        delayMinutes: Math.round(delay),
        queuedAt: nowMs(),
        fireAt: nowMs() + delay * 60000,
        chainId: parentChainId || `chain_${nowMs()}_${Math.random().toString(36).slice(2, 8)}`,
        depth: 0,
        fired: false,
        cancelled: false,
        rolled: false,
        rollResult: null,
    };
}

function queueConsequenceChain(s, triggerEvent, templates) {
    const consq = ensureConsequenceState(s);
    const chainId = `chain_${nowMs()}_${Math.random().toString(36).slice(2, 8)}`;
    const queued = [];
    for (const template of templates) {
        const conseq = createConsequence(triggerEvent, template, chainId);
        queued.push(conseq);
        consq.queue.push(conseq);
    }
    consq.chains[chainId] = {
        triggerEvent,
        startedAt: nowMs(),
        consequenceIds: queued.map((c) => c.id),
        depth: 0,
    };
    consq.queue.sort((a, b) => a.fireAt - b.fireAt);
    consq.queue = consq.queue.slice(-MAX_CONSEQUENCES);
    saveSettings();
    return { chainId, queued: queued.length };
}

function queueConsequencesForEvent(s, eventType, context) {
    const templates = CONSEQUENCE_TEMPLATES[eventType];
    if (!templates || !templates.length) return { queued: 0 };
    return queueConsequenceChain(s, eventType, templates);
}

function processConsequenceQueue(s) {
    const consq = ensureConsequenceState(s);
    const now = nowMs();
    const fired = [];
    const stillPending = [];
    for (const conseq of consq.queue) {
        if (conseq.fired || conseq.cancelled) continue;
        if (conseq.fireAt > now) {
            stillPending.push(conseq);
            continue;
        }
        if (!conseq.rolled) {
            conseq.rolled = true;
            conseq.rollResult = Math.random();
            if (conseq.rollResult > conseq.probability) {
                conseq.cancelled = true;
                consq.cancelled.push({ ...conseq, cancelledAt: nowMs() });
                continue;
            }
        }
        conseq.fired = true;
        fired.push(conseq);
        applyConsequence(s, conseq);
    }
    consq.queue = stillPending;
    for (const f of fired) {
        consq.fired.push({ ...f, firedAt: now });
    }
    consq.fired = consq.fired.slice(-200);
    consq.cancelled = consq.cancelled.slice(-200);
    consq.lastProcessedAt = now;
    saveSettings();
    return { fired: fired.length, pending: stillPending.length };
}

function applyConsequence(s, conseq) {
    const domain = conseq.domain;
    const action = conseq.action;
    const payload = conseq.payload || {};
    try {
        if (domain === MODAL_DOMAINS.SOCIAL && action === "witnessReports") {
            try {
                notify("warning", "Someone saw what you did and is talking about it...", "Consequence", "social");
            } catch (_) {}
            propagateEvent(s, {
                type: EVENT_TYPES.SOCIAL_INTERACTION,
                domain: MODAL_DOMAINS.SOCIAL,
                source: "consequence_engine",
                payload: { event: "witness_report", severity: payload.severity },
            });
            return;
        }
        if (domain === MODAL_DOMAINS.WORLD && action === "wantedNotice") {
            try {
                notify("warning", "Word has spread. There may be consequences for your actions.", "Consequence", "world");
            } catch (_) {}
            return;
        }
        if (domain === MODAL_DOMAINS.SOCIAL && action === "witnessGratitude") {
            try {
                notify("success", "Someone you helped is spreading word of your good deed.", "Consequence", "social");
            } catch (_) {}
            return;
        }
        if (domain === MODAL_DOMAINS.WORLD && action === "reputationBoost") {
            try {
                notify("success", "Your reputation has grown from recent actions.", "Consequence", "world");
            } catch (_) {}
            return;
        }
        if (domain === MODAL_DOMAINS.SOCIAL && action === "merchantWarnsOthers") {
            try {
                notify("info", "Merchants have heard about your dealings...", "Consequence", "social");
            } catch (_) {}
            return;
        }
        if (domain === MODAL_DOMAINS.SOCIAL && action === "npcMoodDrop") {
            propagateEvent(s, {
                type: EVENT_TYPES.RELATIONSHIP_CHANGE,
                domain: MODAL_DOMAINS.SOCIAL,
                source: "consequence_engine",
                payload: { event: "mood_drop", delta: payload.moodDelta || -10 },
            });
            return;
        }
        if (domain === MODAL_DOMAINS.WORLD && action === "gossipSpreads") {
            try {
                import("./gossipNetwork.js").then((mod) => {
                    mod.seedGossip?.(s, "consequence_engine", "recent events", "Something happened that people are whispering about...", 0.6, ["consequence"]);
                }).catch(() => {});
            } catch (_) {}
            return;
        }
        if (domain === MODAL_DOMAINS.SOCIAL && action === "truthSurfaces") {
            try {
                notify("warning", "The truth about something you said has come to light.", "Consequence", "social");
            } catch (_) {}
            propagateEvent(s, {
                type: EVENT_TYPES.RELATIONSHIP_CHANGE,
                domain: MODAL_DOMAINS.SOCIAL,
                source: "consequence_engine",
                payload: { event: "trust_broken", delta: payload.trustDelta || -20 },
            });
            return;
        }
        if (domain === MODAL_DOMAINS.SOCIAL && action === "npcDisappointed") {
            try {
                notify("info", "Someone you made a promise to seems disappointed.", "Consequence", "social");
            } catch (_) {}
            return;
        }
        if (domain === MODAL_DOMAINS.SHOP && action === "priceIncrease") {
            try {
                notify("info", "Shop prices seem higher than before...", "Consequence", "shop");
            } catch (_) {}
            return;
        }
        if (domain === MODAL_DOMAINS.JOURNAL && action === "alternativeQuestAvailable") {
            try {
                notify("info", "A new opportunity has appeared to make up for a past failure.", "Consequence", "journal");
            } catch (_) {}
            return;
        }
    } catch (_) {}
}

function cancelConsequence(s, consequenceId) {
    const consq = ensureConsequenceState(s);
    const idx = consq.queue.findIndex((c) => c.id === consequenceId);
    if (idx === -1) return { ok: false, reason: "not_found" };
    const conseq = consq.queue.splice(idx, 1)[0];
    conseq.cancelled = true;
    consq.cancelled.push({ ...conseq, cancelledAt: nowMs() });
    consq.cancelled = consq.cancelled.slice(-200);
    saveSettings();
    return { ok: true, cancelled: conseq.id };
}

function getPendingConsequences(s) {
    const consq = ensureConsequenceState(s);
    const now = nowMs();
    return consq.queue
        .filter((c) => !c.fired && !c.cancelled)
        .map((c) => ({
            ...c,
            minutesUntilFire: Math.max(0, Math.round((c.fireAt - now) / 60000)),
        }))
        .sort((a, b) => a.fireAt - b.fireAt);
}

function getConsequenceHistory(s, limit) {
    const consq = ensureConsequenceState(s);
    const max = Math.max(1, Math.min(100, Number(limit || 20)));
    return {
        fired: consq.fired.slice(-max).reverse(),
        cancelled: consq.cancelled.slice(-max).reverse(),
    };
}

function initConsequenceEngine() {
    if (initialized) return;
    initialized = true;
    const s = getSettings();
    ensureConsequenceState(s);
    try {
        window.UIE = window.UIE || {};
        window.UIE.consequences = {
            queueForEvent: (eventType, ctx) => queueConsequencesForEvent(getSettings(), eventType, ctx),
            queueChain: (trigger, templates) => queueConsequenceChain(getSettings(), trigger, templates),
            process: () => processConsequenceQueue(getSettings()),
            cancel: (id) => cancelConsequence(getSettings(), id),
            getPending: () => getPendingConsequences(getSettings()),
            getHistory: (limit) => getConsequenceHistory(getSettings(), limit),
            version: CONSEQUENCE_VERSION,
        };
    } catch (_) {}
    let processTimer = null;
    try {
        processTimer = setInterval(() => {
            try {
                processConsequenceQueue(getSettings());
            } catch (_) {}
        }, 15000);
    } catch (_) {}
    try {
        window.addEventListener("uie:time_advanced", () => {
            try {
                processConsequenceQueue(getSettings());
            } catch (_) {}
        });
    } catch (_) {}
}

export {
    CONSEQUENCE_VERSION,
    CONSEQUENCE_TEMPLATES,
    ensureConsequenceState,
    createConsequence,
    queueConsequenceChain,
    queueConsequencesForEvent,
    processConsequenceQueue,
    applyConsequence,
    cancelConsequence,
    getPendingConsequences,
    getConsequenceHistory,
    initConsequenceEngine,
};
