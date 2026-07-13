import { getSettings, saveSettings, commitStateUpdate } from "./core.js";
import { notify } from "./notifications.js";

const CAUSALITY_VERSION = "1.0.0";
const MAX_CHAIN_DEPTH = 8;
const MAX_HISTORY = 200;
const MAX_PENDING_CONSEQUENCES = 500;
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

function ensureCausalityState(s) {
    if (!s || typeof s !== "object") return null;
    if (!s.causality || typeof s.causality !== "object") s.causality = {};
    const c = s.causality;
    if (!Array.isArray(c.eventLog)) c.eventLog = [];
    if (!Array.isArray(c.pendingConsequences)) c.pendingConsequences = [];
    if (!c.reputation || typeof c.reputation !== "object") c.reputation = { factions: {}, global: 50 };
    if (!Array.isArray(c.gossipQueue)) c.gossipQueue = [];
    if (!c.encumbrance || typeof c.encumbrance !== "object") c.encumbrance = { currentWeight: 0, maxWeight: 100, penalty: 0 };
    if (!c.economy || typeof c.economy !== "object") c.economy = { priceModifiers: {}, supplyLevels: {}, lastTradeAt: 0 };
    if (!c.emotions || typeof c.emotions !== "object") c.emotions = { npcMoods: {}, lastContagionAt: 0 };
    if (!c.questDeps || typeof c.questDeps !== "object") c.questDeps = { completed: [], active: [], blocked: [] };
    if (!c.weatherActivity || typeof c.weatherActivity !== "object") c.weatherActivity = { currentWeather: "Clear", currentBiome: "default" };
    if (!Array.isArray(c.ambientLog)) c.ambientLog = [];
    return c;
}

const EVENT_TYPES = Object.freeze({
    PURCHASE: "purchase",
    SALE: "sale",
    COMBAT_WIN: "combat_win",
    COMBAT_LOSS: "combat_loss",
    NPC_KILLED: "npc_killed",
    QUEST_ACCEPTED: "quest_accepted",
    QUEST_COMPLETED: "quest_completed",
    QUEST_FAILED: "quest_failed",
    ITEM_USED: "item_used",
    ITEM_GAINED: "item_gained",
    ITEM_LOST: "item_lost",
    LOCATION_ENTERED: "location_entered",
    LOCATION_LEFT: "location_left",
    RELATIONSHIP_CHANGE: "relationship_change",
    SOCIAL_INTERACTION: "social_interaction",
    TIME_ADVANCED: "time_advanced",
    WEATHER_CHANGED: "weather_changed",
    SKILL_LEARNED: "skill_learned",
    SKILL_USED: "skill_used",
    STAT_CHANGED: "stat_changed",
    CURRENCY_CHANGED: "currency_changed",
    EQUIPMENT_CHANGED: "equipment_changed",
    ACTIVITY_STARTED: "activity_started",
    ACTIVITY_COMPLETED: "activity_completed",
    PHONE_CALLED: "phone_called",
    PHONE_MISSED: "phone_missed",
    PARTY_MEMBER_JOINED: "party_member_joined",
    PARTY_MEMBER_LEFT: "party_member_left",
    FACTION_ACTION: "faction_action",
    CRIME_COMMITTED: "crime_committed",
    HEROIC_ACT: "heroic_act",
    SECRET_DISCOVERED: "secret_discovered",
    CUSTOM: "custom",
});

const MODAL_DOMAINS = Object.freeze({
    INVENTORY: "inventory",
    PARTY: "party",
    SOCIAL: "social",
    MAP: "map",
    JOURNAL: "journal",
    BATTLE: "battle",
    PHONE: "phone",
    CALENDAR: "calendar",
    SHOP: "shop",
    SKILLS: "skills",
    LIFE: "life",
    EQUIPMENT: "equipment",
    WORLD: "world",
    CHARACTER: "character",
});

const RIPPLE_RULES = [
    {
        trigger: EVENT_TYPES.PURCHASE,
        effects: [
            { domain: MODAL_DOMAINS.INVENTORY, action: "addItem", weight: 1.0 },
            { domain: MODAL_DOMAINS.SHOP, action: "adjustSupply", weight: 0.8 },
            { domain: MODAL_DOMAINS.SOCIAL, action: "merchantAffinity", weight: 0.5 },
            { domain: MODAL_DOMAINS.LIFE, action: "resourceTracker", weight: 0.3 },
            { domain: MODAL_DOMAINS.JOURNAL, action: "checkQuestProgress", weight: 0.4 },
        ],
    },
    {
        trigger: EVENT_TYPES.COMBAT_WIN,
        effects: [
            { domain: MODAL_DOMAINS.CHARACTER, action: "grantXp", weight: 1.0 },
            { domain: MODAL_DOMAINS.INVENTORY, action: "lootDrop", weight: 0.9 },
            { domain: MODAL_DOMAINS.SOCIAL, action: "reputationBoost", weight: 0.6 },
            { domain: MODAL_DOMAINS.JOURNAL, action: "checkQuestProgress", weight: 0.7 },
            { domain: MODAL_DOMAINS.LIFE, action: "combatFatigue", weight: 0.5 },
            { domain: MODAL_DOMAINS.WORLD, action: "threatAdjustment", weight: 0.4 },
        ],
    },
    {
        trigger: EVENT_TYPES.COMBAT_LOSS,
        effects: [
            { domain: MODAL_DOMAINS.CHARACTER, action: "applyPenalty", weight: 1.0 },
            { domain: MODAL_DOMAINS.INVENTORY, action: "possibleLootLoss", weight: 0.7 },
            { domain: MODAL_DOMAINS.SOCIAL, action: "reputationDrop", weight: 0.5 },
            { domain: MODAL_DOMAINS.LIFE, action: "injuryTracker", weight: 0.8 },
            { domain: MODAL_DOMAINS.WORLD, action: "threatIncrease", weight: 0.6 },
        ],
    },
    {
        trigger: EVENT_TYPES.QUEST_COMPLETED,
        effects: [
            { domain: MODAL_DOMAINS.CHARACTER, action: "grantXp", weight: 1.0 },
            { domain: MODAL_DOMAINS.INVENTORY, action: "questReward", weight: 0.9 },
            { domain: MODAL_DOMAINS.SOCIAL, action: "questGiverAffinity", weight: 0.8 },
            { domain: MODAL_DOMAINS.JOURNAL, action: "unlockDependentQuests", weight: 1.0 },
            { domain: MODAL_DOMAINS.WORLD, action: "worldStateChange", weight: 0.6 },
            { domain: MODAL_DOMAINS.CALENDAR, action: "scheduleImpact", weight: 0.3 },
        ],
    },
    {
        trigger: EVENT_TYPES.LOCATION_ENTERED,
        effects: [
            { domain: MODAL_DOMAINS.MAP, action: "revealArea", weight: 1.0 },
            { domain: MODAL_DOMAINS.SOCIAL, action: "detectNearbyNpcs", weight: 0.9 },
            { domain: MODAL_DOMAINS.WORLD, action: "ambientEventCheck", weight: 0.7 },
            { domain: MODAL_DOMAINS.JOURNAL, action: "locationQuestCheck", weight: 0.5 },
            { domain: MODAL_DOMAINS.CALENDAR, action: "travelTimeCost", weight: 0.4 },
        ],
    },
    {
        trigger: EVENT_TYPES.RELATIONSHIP_CHANGE,
        effects: [
            { domain: MODAL_DOMAINS.SOCIAL, action: "updateSocialTier", weight: 1.0 },
            { domain: MODAL_DOMAINS.PHONE, action: "updateContactAvailability", weight: 0.8 },
            { domain: MODAL_DOMAINS.WORLD, action: "gossipPropagation", weight: 0.7 },
            { domain: MODAL_DOMAINS.PARTY, action: "companionReaction", weight: 0.5 },
            { domain: MODAL_DOMAINS.JOURNAL, action: "relationshipQuestCheck", weight: 0.4 },
        ],
    },
    {
        trigger: EVENT_TYPES.ITEM_USED,
        effects: [
            { domain: MODAL_DOMAINS.INVENTORY, action: "decrementStack", weight: 1.0 },
            { domain: MODAL_DOMAINS.LIFE, action: "applyItemEffect", weight: 0.9 },
            { domain: MODAL_DOMAINS.CHARACTER, action: "statusEffectCheck", weight: 0.6 },
            { domain: MODAL_DOMAINS.SKILLS, action: "skillSynergyCheck", weight: 0.3 },
        ],
    },
    {
        trigger: EVENT_TYPES.TIME_ADVANCED,
        effects: [
            { domain: MODAL_DOMAINS.CALENDAR, action: "scheduleTick", weight: 1.0 },
            { domain: MODAL_DOMAINS.LIFE, action: "needsDecay", weight: 0.9 },
            { domain: MODAL_DOMAINS.SOCIAL, action: "npcScheduleFollow", weight: 0.8 },
            { domain: MODAL_DOMAINS.WORLD, action: "weatherShift", weight: 0.5 },
            { domain: MODAL_DOMAINS.EQUIPMENT, action: "itemDegradation", weight: 0.4 },
            { domain: MODAL_DOMAINS.SHOP, action: "stockRefresh", weight: 0.3 },
            { domain: MODAL_DOMAINS.PHONE, action: "pendingMessages", weight: 0.6 },
        ],
    },
    {
        trigger: EVENT_TYPES.CRIME_COMMITTED,
        effects: [
            { domain: MODAL_DOMAINS.SOCIAL, action: "witnessAlert", weight: 1.0 },
            { domain: MODAL_DOMAINS.WORLD, action: "wantedLevel", weight: 0.9 },
            { domain: MODAL_DOMAINS.JOURNAL, action: "bountyQuest", weight: 0.7 },
            { domain: MODAL_DOMAINS.MAP, action: "restrictAccess", weight: 0.6 },
            { domain: MODAL_DOMAINS.PHONE, action: "authoritiesAlert", weight: 0.5 },
        ],
    },
    {
        trigger: EVENT_TYPES.HEROIC_ACT,
        effects: [
            { domain: MODAL_DOMAINS.SOCIAL, action: "witnessImpressed", weight: 1.0 },
            { domain: MODAL_DOMAINS.WORLD, action: "reputationBoost", weight: 0.8 },
            { domain: MODAL_DOMAINS.JOURNAL, action: "heroQuestTrigger", weight: 0.6 },
            { domain: MODAL_DOMAINS.PHONE, action: "gratitudeMessages", weight: 0.4 },
        ],
    },
    {
        trigger: EVENT_TYPES.WEATHER_CHANGED,
        effects: [
            { domain: MODAL_DOMAINS.MAP, action: "routeModifier", weight: 1.0 },
            { domain: MODAL_DOMAINS.CALENDAR, action: "activityModifier", weight: 0.8 },
            { domain: MODAL_DOMAINS.LIFE, action: "comfortTracker", weight: 0.6 },
            { domain: MODAL_DOMAINS.WORLD, action: "ambientMood", weight: 0.5 },
        ],
    },
    {
        trigger: EVENT_TYPES.EQUIPMENT_CHANGED,
        effects: [
            { domain: MODAL_DOMAINS.CHARACTER, action: "statRecalc", weight: 1.0 },
            { domain: MODAL_DOMAINS.INVENTORY, action: "encumbranceRecalc", weight: 0.9 },
            { domain: MODAL_DOMAINS.LIFE, action: "comfortAdjust", weight: 0.4 },
            { domain: MODAL_DOMAINS.SKILLS, action: "equipmentSynergy", weight: 0.5 },
        ],
    },
    {
        trigger: EVENT_TYPES.PARTY_MEMBER_JOINED,
        effects: [
            { domain: MODAL_DOMAINS.PARTY, action: "formationRecalc", weight: 1.0 },
            { domain: MODAL_DOMAINS.SOCIAL, action: "companionBond", weight: 0.7 },
            { domain: MODAL_DOMAINS.MAP, action: "partyMovementSync", weight: 0.5 },
            { domain: MODAL_DOMAINS.BATTLE, action: "tacticsRecalc", weight: 0.6 },
        ],
    },
];

function matchRippleRules(eventType) {
    return RIPPLE_RULES.filter((rule) => rule.trigger === eventType);
}

function calculateEncumbrance(s) {
    const c = ensureCausalityState(s);
    const items = Array.isArray(s?.inventory?.items) ? s.inventory.items : [];
    let totalWeight = 0;
    for (const item of items) {
        const w = Number(item?.weight || 0.5);
        const qty = Math.max(1, Number(item?.qty || 1));
        totalWeight += w * qty;
    }
    const equipped = Array.isArray(s?.inventory?.equipped) ? s.inventory.equipped : [];
    for (const eq of equipped) {
        totalWeight += Number(eq?.weight || 0);
    }
    const str = Number(s?.character?.stats?.strength || s?.stats?.str || 10);
    const maxWeight = Math.max(10, str * 10);
    const ratio = totalWeight / maxWeight;
    let penalty = 0;
    if (ratio > 1.0) penalty = Math.min(50, Math.round((ratio - 1.0) * 30));
    else if (ratio > 0.75) penalty = Math.round((ratio - 0.75) * 10);
    c.encumbrance = {
        currentWeight: Math.round(totalWeight * 100) / 100,
        maxWeight: Math.round(maxWeight),
        ratio: Math.round(ratio * 100) / 100,
        penalty,
        encumbered: ratio > 1.0,
        overburdened: ratio > 1.5,
        updatedAt: nowMs(),
    };
    return c.encumbrance;
}

function calculateReputation(s, factionName, actionType, magnitude) {
    const c = ensureCausalityState(s);
    const faction = normKey(factionName);
    if (!faction) return { ok: false, reason: "no_faction" };
    if (!c.reputation.factions[faction]) {
        c.reputation.factions[faction] = {
            name: factionName,
            standing: 50,
            history: [],
            lastAction: null,
        };
    }
    const f = c.reputation.factions[faction];
    const deltas = {
        [EVENT_TYPES.CRIME_COMMITTED]: -Math.abs(magnitude || 10),
        [EVENT_TYPES.HEROIC_ACT]: Math.abs(magnitude || 8),
        [EVENT_TYPES.QUEST_COMPLETED]: Math.abs(magnitude || 5),
        [EVENT_TYPES.QUEST_FAILED]: -Math.abs(magnitude || 7),
        [EVENT_TYPES.PURCHASE]: Math.abs(magnitude || 1),
        [EVENT_TYPES.COMBAT_WIN]: Math.abs(magnitude || 3),
        [EVENT_TYPES.COMBAT_LOSS]: -Math.abs(magnitude || 2),
        [EVENT_TYPES.SOCIAL_INTERACTION]: Math.abs(magnitude || 2),
    };
    const delta = deltas[actionType] || 0;
    const oldStanding = f.standing;
    f.standing = clamp(f.standing + delta, 0, 100);
    f.lastAction = { type: actionType, delta, at: nowMs() };
    f.history.push({ type: actionType, delta, standing: f.standing, at: nowMs() });
    f.history = f.history.slice(-50);
    const tier = f.standing >= 80 ? "exalted" : f.standing >= 60 ? "friendly" : f.standing >= 40 ? "neutral" : f.standing >= 20 ? "unfriendly" : "hostile";
    return {
        faction: factionName,
        oldStanding,
        newStanding: f.standing,
        delta,
        tier,
        changed: oldStanding !== f.standing,
    };
}

function calculateDynamicPrice(basePrice, supplyLevel, demandLevel, reputationMod) {
    const supply = clamp(Number(supplyLevel || 50), 0, 100);
    const demand = clamp(Number(demandLevel || 50), 0, 100);
    const rep = clamp(Number(reputationMod || 0), -50, 50);
    const supplyFactor = 1.0 + (50 - supply) / 100;
    const demandFactor = 1.0 + (demand - 50) / 100;
    const repFactor = 1.0 - rep / 200;
    const noise = 0.95 + Math.random() * 0.1;
    return Math.max(1, Math.round(basePrice * supplyFactor * demandFactor * repFactor * noise));
}

function checkWeatherActivity(weather, activity) {
    const w = String(weather || "Clear").trim().toLowerCase();
    const a = String(activity || "").trim().toLowerCase();
    const outdoorActivities = new Set(["travel", "explore", "forage", "hunt", "patrol", "camp", "fish", "swim", "climb", "ride"]);
    const isOutdoor = outdoorActivities.has(a);
    if (!isOutdoor) return { compatible: true, modifier: 1.0, reason: "indoor_activity" };
    const stormy = /storm|blizzard|hurricane|tornado|acid rain/.test(w);
    const wet = /rain|snow|sleet|fog|mist/.test(w);
    const extreme = /blizzard|hurricane|tornado|acid rain|heatwave|sandstorm/.test(w);
    if (extreme) return { compatible: false, modifier: 0.0, reason: `extreme_weather_${w}`, dangerLevel: "high" };
    if (stormy) return { compatible: true, modifier: 0.5, reason: "stormy_conditions", dangerLevel: "moderate" };
    if (wet) return { compatible: true, modifier: 0.75, reason: "wet_conditions", dangerLevel: "low" };
    return { compatible: true, modifier: 1.0, reason: "clear_conditions", dangerLevel: "none" };
}

function detectNearbyNpcs(s, location) {
    const loc = normKey(location || s?.worldState?.location || "");
    if (!loc) return [];
    const backendCharacters = Array.isArray(s?._backendCharacters) ? s._backendCharacters : [];
    const nearby = [];
    for (const npc of backendCharacters) {
        const npcLoc = normKey(npc?.location || "");
        if (npcLoc === loc) {
            nearby.push({
                name: npc.name,
                role: npc.role || "NPC",
                relationship: npc.relationships?.User || { affinity: 50 },
                schedule: npc.schedule || [],
                mood: npc.profile?.current_mood || "neutral",
            });
        }
    }
    return nearby;
}

function resolveQuestDependencies(s) {
    const c = ensureCausalityState(s);
    const journal = s?.journal || {};
    const completed = new Set((Array.isArray(journal.completed) ? journal.completed : []).map((q) => normKey(q?.title || q?.id || "")));
    const active = Array.isArray(journal.active) ? journal.active : [];
    const pending = Array.isArray(journal.pending) ? journal.pending : [];
    const unlocked = [];
    const stillBlocked = [];
    for (const quest of pending) {
        const prereqs = Array.isArray(quest?.prerequisites) ? quest.prerequisites : [];
        const allMet = prereqs.every((p) => completed.has(normKey(p)));
        if (allMet) {
            unlocked.push(quest);
        } else {
            stillBlocked.push({ ...quest, blockedBy: prereqs.filter((p) => !completed.has(normKey(p))) });
        }
    }
    c.questDeps = {
        completed: Array.from(completed),
        active: active.map((q) => normKey(q?.title || q?.id || "")),
        blocked: stillBlocked,
        lastCheck: nowMs(),
    };
    return { unlocked, stillBlocked, completedCount: completed.size };
}

function propagateEmotions(s, sourceNpc, emotionDelta, radius) {
    const c = ensureCausalityState(s);
    const source = normKey(sourceNpc);
    if (!source) return { affected: [] };
    const r = Math.max(1, Math.min(5, Number(radius || 2)));
    if (!c.emotions.npcMoods[source]) c.emotions.npcMoods[source] = { mood: 50, lastUpdate: nowMs() };
    const sourceMood = c.emotions.npcMoods[source];
    sourceMood.mood = clamp(sourceMood.mood + emotionDelta, 0, 100);
    sourceMood.lastUpdate = nowMs();
    const affected = [];
    const allNpcs = Object.keys(c.emotions.npcMoods);
    for (const npcKey of allNpcs) {
        if (npcKey === source) continue;
        const distance = Math.abs(hashCode(npcKey) % (r + 1));
        if (distance > r) continue;
        const falloff = 1.0 / (1.0 + distance);
        const delta = Math.round(emotionDelta * falloff * 0.5);
        if (delta === 0) continue;
        if (!c.emotions.npcMoods[npcKey]) c.emotions.npcMoods[npcKey] = { mood: 50, lastUpdate: nowMs() };
        const target = c.emotions.npcMoods[npcKey];
        target.mood = clamp(target.mood + delta, 0, 100);
        target.lastUpdate = nowMs();
        affected.push({ npc: npcKey, delta, newMood: target.mood });
    }
    c.emotions.lastContagionAt = nowMs();
    return { source, sourceMood: sourceMood.mood, affected };
}

function hashCode(str) {
    let hash = 0;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) {
        hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

function queueConsequence(s, consequence) {
    const c = ensureCausalityState(s);
    if (!consequence || typeof consequence !== "object") return null;
    const entry = {
        id: `conseq_${nowMs()}_${Math.random().toString(36).slice(2, 8)}`,
        triggerEvent: consequence.triggerEvent || EVENT_TYPES.CUSTOM,
        delayMinutes: Math.max(0, Number(consequence.delayMinutes || 0)),
        queuedAt: nowMs(),
        fireAt: nowMs() + Number(consequence.delayMinutes || 0) * 60000,
        domain: consequence.domain || MODAL_DOMAINS.WORLD,
        action: consequence.action || "",
        payload: consequence.payload || {},
        condition: consequence.condition || null,
        fired: false,
        cancelled: false,
    };
    c.pendingConsequences.push(entry);
    c.pendingConsequences.sort((a, b) => a.fireAt - b.fireAt);
    c.pendingConsequences = c.pendingConsequences.slice(-MAX_PENDING_CONSEQUENCES);
    return entry;
}

function processDueConsequences(s) {
    const c = ensureCausalityState(s);
    const now = nowMs();
    const fired = [];
    const stillPending = [];
    for (const conseq of c.pendingConsequences) {
        if (conseq.fired || conseq.cancelled) continue;
        if (conseq.fireAt > now) {
            stillPending.push(conseq);
            continue;
        }
        if (conseq.condition && typeof conseq.condition === "function") {
            try {
                if (!conseq.condition(s)) {
                    stillPending.push(conseq);
                    continue;
                }
            } catch (_) {
                stillPending.push(conseq);
                continue;
            }
        }
        conseq.fired = true;
        fired.push(conseq);
    }
    c.pendingConsequences = stillPending;
    return fired;
}

function propagateEvent(s, event) {
    const c = ensureCausalityState(s);
    if (!event || typeof event !== "object") return { ok: false, reason: "invalid_event" };
    const eventType = event.type || EVENT_TYPES.CUSTOM;
    const entry = {
        id: `evt_${nowMs()}_${Math.random().toString(36).slice(2, 8)}`,
        type: eventType,
        domain: event.domain || MODAL_DOMAINS.WORLD,
        source: event.source || "unknown",
        payload: event.payload || {},
        timestamp: nowMs(),
        depth: Number(event._depth || 0),
    };
    c.eventLog.push(entry);
    c.eventLog = c.eventLog.slice(-MAX_HISTORY);
    if (entry.depth >= MAX_CHAIN_DEPTH) return { ok: true, event: entry, ripples: [], reason: "max_depth" };
    const rules = matchRippleRules(eventType);
    const ripples = [];
    for (const rule of rules) {
        for (const effect of rule.effects) {
            const ripple = {
                domain: effect.domain,
                action: effect.action,
                weight: effect.weight,
                sourceEvent: entry.id,
                sourceType: eventType,
            };
            ripples.push(ripple);
            applyRippleEffect(s, ripple, entry, effect);
        }
    }
    saveSettings();
    return { ok: true, event: entry, ripples, rulesMatched: rules.length };
}

function applyRippleEffect(s, ripple, sourceEvent, rule) {
    const domain = ripple.domain;
    const action = ripple.action;
    const payload = sourceEvent.payload || {};
    try {
        if (domain === MODAL_DOMAINS.INVENTORY && action === "addItem") {
            return;
        }
        if (domain === MODAL_DOMAINS.CHARACTER && action === "grantXp") {
            const xp = Math.max(0, Number(payload.xp || 0));
            if (xp > 0) {
                try {
                    import("./economy.js").then((mod) => mod.grantXp?.(s, xp, "causality_engine")).catch(() => {});
                } catch (_) {}
            }
            return;
        }
        if (domain === MODAL_DOMAINS.SOCIAL && action === "detectNearbyNpcs") {
            const loc = payload.location || s?.worldState?.location || "";
            const nearby = detectNearbyNpcs(s, loc);
            if (nearby.length > 0) {
                try {
                    notify("info", `${nearby.length} NPC(s) nearby: ${nearby.map((n) => n.name).join(", ")}`, "Causality", "social");
                } catch (_) {}
            }
            return;
        }
        if (domain === MODAL_DOMAINS.LIFE && action === "needsDecay") {
            return;
        }
        if (domain === MODAL_DOMAINS.CALENDAR && action === "scheduleTick") {
            return;
        }
        if (domain === MODAL_DOMAINS.MAP && action === "revealArea") {
            return;
        }
        if (domain === MODAL_DOMAINS.EQUIPMENT && action === "itemDegradation") {
            const equipped = Array.isArray(s?.inventory?.equipped) ? s.inventory.equipped : [];
            for (const eq of equipped) {
                if (!eq || typeof eq !== "object") continue;
                const durability = Number(eq.durability ?? 100);
                if (durability > 0) {
                    eq.durability = Math.max(0, durability - 1);
                }
            }
            return;
        }
        if (domain === MODAL_DOMAINS.WORLD && action === "gossipPropagation") {
            const gossip = {
                source: payload.npc || "unknown",
                content: payload.event || "something happened",
                spread: Math.random() < 0.5 ? 1 : 0,
                at: nowMs(),
            };
            c.gossipQueue.push(gossip);
            c.gossipQueue = c.gossipQueue.slice(-100);
            return;
        }
    } catch (_) {}
}

function getCausalitySummary(s) {
    const c = ensureCausalityState(s);
    return {
        version: CAUSALITY_VERSION,
        eventCount: c.eventLog.length,
        pendingConsequences: c.pendingConsequences.filter((x) => !x.fired && !x.cancelled).length,
        encumbrance: c.encumbrance,
        reputation: c.reputation,
        gossipQueueLength: c.gossipQueue.length,
        lastEventAt: c.eventLog.length ? c.eventLog[c.eventLog.length - 1].timestamp : null,
    };
}

function initCausalityEngine() {
    if (initialized) return;
    initialized = true;
    const s = getSettings();
    ensureCausalityState(s);
    try {
        window.UIE = window.UIE || {};
        window.UIE.causality = {
            propagateEvent: (event) => propagateEvent(getSettings(), event),
            calculateEncumbrance: () => calculateEncumbrance(getSettings()),
            calculateReputation: (faction, action, mag) => calculateReputation(getSettings(), faction, action, mag),
            calculateDynamicPrice: (base, supply, demand, rep) => calculateDynamicPrice(base, supply, demand, rep),
            checkWeatherActivity: (w, a) => checkWeatherActivity(w, a),
            detectNearbyNpcs: (loc) => detectNearbyNpcs(getSettings(), loc),
            resolveQuestDependencies: () => resolveQuestDependencies(getSettings()),
            propagateEmotions: (npc, delta, r) => propagateEmotions(getSettings(), npc, delta, r),
            queueConsequence: (c) => queueConsequence(getSettings(), c),
            processDueConsequences: () => processDueConsequences(getSettings()),
            getSummary: () => getCausalitySummary(getSettings()),
            EVENT_TYPES,
            MODAL_DOMAINS,
        };
    } catch (_) {}
    try {
        window.addEventListener("uie:time_advanced", () => {
            const state = getSettings();
            propagateEvent(state, { type: EVENT_TYPES.TIME_ADVANCED, domain: MODAL_DOMAINS.CALENDAR, source: "time_engine", payload: {} });
            processDueConsequences(state);
        });
    } catch (_) {}
    try {
        window.addEventListener("uie:location_changed", (e) => {
            const state = getSettings();
            const detail = e?.detail || {};
            propagateEvent(state, { type: EVENT_TYPES.LOCATION_ENTERED, domain: MODAL_DOMAINS.MAP, source: "navigation", payload: { location: detail.location || detail.to || "" } });
        });
    } catch (_) {}
}

export {
    CAUSALITY_VERSION,
    EVENT_TYPES,
    MODAL_DOMAINS,
    RIPPLE_RULES,
    ensureCausalityState,
    propagateEvent,
    calculateEncumbrance,
    calculateReputation,
    calculateDynamicPrice,
    checkWeatherActivity,
    detectNearbyNpcs,
    resolveQuestDependencies,
    propagateEmotions,
    queueConsequence,
    processDueConsequences,
    getCausalitySummary,
    initCausalityEngine,
};
