import { getSettings, saveSettings } from "./core.js";
import { ensureCausalityState } from "./causalityEngine.js";

const GOSSIP_VERSION = "1.0.0";
const MAX_GOSSIP_ITEMS = 200;
const MAX_GOSSIP_PER_NPC = 30;
const DECAY_RATE_PER_HOUR = 0.02;
const SPREAD_CHANCE_BASE = 0.35;
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

function ensureGossipState(s) {
    const c = ensureCausalityState(s);
    if (!c.gossip || typeof c.gossip !== "object") c.gossip = {};
    if (!Array.isArray(c.gossip.items)) c.gossip.items = [];
    if (!c.gossip.npcKnowledge || typeof c.gossip.npcKnowledge !== "object") c.gossip.npcKnowledge = {};
    if (typeof c.gossip.lastSpreadAt !== "number") c.gossip.lastSpreadAt = 0;
    return c.gossip;
}

function createGossipItem(origin, topic, content, importance, tags) {
    return {
        id: `gossip_${nowMs()}_${Math.random().toString(36).slice(2, 8)}`,
        origin: String(origin || "unknown").trim(),
        topic: String(topic || "").trim(),
        content: String(content || "").trim().slice(0, 500),
        importance: clamp(Number(importance || 0.5), 0, 1),
        tags: Array.isArray(tags) ? tags.map((t) => String(t || "").trim().slice(0, 40)).filter(Boolean) : [],
        createdAt: nowMs(),
        lastSpreadAt: nowMs(),
        spreadCount: 0,
        distortionLevel: 0,
        knownBy: [normKey(origin)],
    };
}

function seedGossip(s, origin, topic, content, importance, tags) {
    const gossip = ensureGossipState(s);
    const item = createGossipItem(origin, topic, content, importance, tags);
    gossip.items.unshift(item);
    gossip.items = gossip.items.slice(0, MAX_GOSSIP_ITEMS);
    const originKey = normKey(origin);
    if (!gossip.npcKnowledge[originKey]) gossip.npcKnowledge[originKey] = [];
    gossip.npcKnowledge[originKey].unshift(item.id);
    gossip.npcKnowledge[originKey] = gossip.npcKnowledge[originKey].slice(0, MAX_GOSSIP_PER_NPC);
    saveSettings();
    return item;
}

function getRelationshipStrength(s, npcA, npcB) {
    const social = s?.social || {};
    const keyA = normKey(npcA);
    const keyB = normKey(npcB);
    for (const group of ["friends", "associates", "romance", "family", "rivals"]) {
        const list = Array.isArray(social[group]) ? social[group] : [];
        for (const entry of list) {
            const name = normKey(entry?.name || "");
            if (name === keyA || name === keyB) {
                const affinity = Number(entry?.affinity || 50);
                const groupMultiplier = {
                    friends: 1.2,
                    romance: 1.5,
                    family: 1.4,
                    associates: 0.8,
                    rivals: 0.5,
                };
                return (affinity / 100) * (groupMultiplier[group] || 1.0);
            }
        }
    }
    return 0.3;
}

function distortGossipContent(content, distortionLevel) {
    if (!content || distortionLevel <= 0) return content;
    let text = String(content);
    const distortions = [
        { pattern: /\balways\b/gi, replacement: "often" },
        { pattern: /\bnever\b/gi, replacement: "rarely" },
        { pattern: /\beveryone\b/gi, replacement: "some people" },
        { pattern: /\bnobody\b/gi, replacement: "a few people" },
        { pattern: /\bhuge\b/gi, replacement: "big" },
        { pattern: /\btiny\b/gi, replacement: "small" },
        { pattern: /\bimmediately\b/gi, replacement: "soon" },
        { pattern: /\byesterday\b/gi, replacement: "the other day" },
        { pattern: /\blast night\b/gi, replacement: "a while back" },
        { pattern: /\bdefinitely\b/gi, replacement: "apparently" },
        { pattern: /\babsolutely\b/gi, replacement: "supposedly" },
        { pattern: /\bsecretly\b/gi, replacement: "rumored to" },
    ];
    const level = Math.min(5, distortionLevel);
    const applyCount = Math.min(level, Math.ceil(level * 1.5));
    const shuffled = distortions.sort(() => Math.random() - 0.5).slice(0, applyCount);
    for (const d of shuffled) {
        if (d.pattern.test(text) && Math.random() < 0.4 + level * 0.1) {
            text = text.replace(d.pattern, d.replacement);
        }
    }
    if (level >= 3 && Math.random() < 0.3) {
        text += " ...or something like that.";
    }
    if (level >= 4 && Math.random() < 0.2) {
        text = text.replace(/\b(\d+)\b/g, (match) => {
            const n = Number(match);
            const jitter = Math.round(n * (0.5 + Math.random()));
            return String(Math.max(1, jitter));
        });
    }
    return text.slice(0, 500);
}

function spreadGossip(s, maxSpreads) {
    const gossip = ensureGossipState(s);
    const now = nowMs();
    const max = Math.max(1, Math.min(20, Number(maxSpreads || 5)));
    const allNpcKeys = Object.keys(gossip.npcKnowledge);
    if (allNpcKeys.length < 2) return { spread: 0 };
    let spreadCount = 0;
    for (const item of gossip.items) {
        if (spreadCount >= max) break;
        if (now - item.lastSpreadAt < 60000) continue;
        const currentKnowers = new Set(item.knownBy.map(normKey));
        const potentialSpreaders = item.knownBy.filter((k) => currentKnowers.has(k));
        for (const spreaderKey of potentialSpreaders) {
            if (spreadCount >= max) break;
            for (const listenerKey of allNpcKeys) {
                if (spreadCount >= max) break;
                if (currentKnowers.has(listenerKey)) continue;
                if (listenerKey === spreaderKey) continue;
                const relStrength = getRelationshipStrength(s, spreaderKey, listenerKey);
                const importanceBoost = item.importance * 0.3;
                const recencyBoost = Math.max(0, 1.0 - (now - item.createdAt) / (24 * 3600000));
                const spreadChance = SPREAD_CHANCE_BASE * relStrength + importanceBoost + recencyBoost * 0.2;
                if (Math.random() < spreadChance) {
                    item.knownBy.push(listenerKey);
                    item.spreadCount++;
                    item.lastSpreadAt = now;
                    item.distortionLevel = Math.min(5, item.distortionLevel + 0.3);
                    if (!gossip.npcKnowledge[listenerKey]) gossip.npcKnowledge[listenerKey] = [];
                    gossip.npcKnowledge[listenerKey].unshift(item.id);
                    gossip.npcKnowledge[listenerKey] = gossip.npcKnowledge[listenerKey].slice(0, MAX_GOSSIP_PER_NPC);
                    spreadCount++;
                }
            }
        }
    }
    gossip.lastSpreadAt = now;
    saveSettings();
    return { spread: spreadCount };
}

function decayGossip(s, hoursElapsed) {
    const gossip = ensureGossipState(s);
    const hours = Math.max(0, Number(hoursElapsed || 1));
    const decay = DECAY_RATE_PER_HOUR * hours;
    for (const item of gossip.items) {
        item.importance = clamp(item.importance - decay * (1.0 - item.importance * 0.5), 0, 1);
    }
    gossip.items = gossip.items.filter((item) => item.importance > 0.01 || item.spreadCount > 0);
    saveSettings();
    return { decayed: decay };
}

function getNpcGossipKnowledge(s, npcName) {
    const gossip = ensureGossipState(s);
    const key = normKey(npcName);
    const ids = gossip.npcKnowledge[key] || [];
    const known = [];
    for (const id of ids) {
        const item = gossip.items.find((g) => g.id === id);
        if (item) {
            known.push({
                ...item,
                distortedContent: distortGossipContent(item.content, item.distortionLevel),
            });
        }
    }
    return known;
}

function getGossipAboutTopic(s, topic) {
    const gossip = ensureGossipState(s);
    const topicKey = normKey(topic);
    return gossip.items
        .filter((item) => normKey(item.topic).includes(topicKey) || item.tags.some((t) => normKey(t).includes(topicKey)))
        .map((item) => ({
            ...item,
            distortedContent: distortGossipContent(item.content, item.distortionLevel),
        }))
        .slice(0, 20);
}

function getRumorSummary(s) {
    const gossip = ensureGossipState(s);
    const active = gossip.items.filter((item) => item.importance > 0.1 && item.spreadCount > 0);
    const sorted = active.sort((a, b) => b.importance * b.spreadCount - a.importance * a.spreadCount);
    return sorted.slice(0, 10).map((item) => ({
        topic: item.topic,
        distortedContent: distortGossipContent(item.content, item.distortionLevel),
        spreadCount: item.spreadCount,
        importance: item.importance,
        origin: item.origin,
    }));
}

function initGossipNetwork() {
    if (initialized) return;
    initialized = true;
    const s = getSettings();
    ensureGossipState(s);
    try {
        window.UIE = window.UIE || {};
        window.UIE.gossip = {
            seed: (origin, topic, content, importance, tags) => seedGossip(getSettings(), origin, topic, content, importance, tags),
            spread: (max) => spreadGossip(getSettings(), max),
            decay: (hours) => decayGossip(getSettings(), hours),
            getNpcKnowledge: (npc) => getNpcGossipKnowledge(getSettings(), npc),
            getAboutTopic: (topic) => getGossipAboutTopic(getSettings(), topic),
            getRumors: () => getRumorSummary(getSettings()),
            version: GOSSIP_VERSION,
        };
    } catch (_) {}
    try {
        window.addEventListener("uie:time_advanced", (e) => {
            try {
                const hours = Number(e?.detail?.hours || 1);
                const state = getSettings();
                decayGossip(state, hours);
                spreadGossip(state, 5);
            } catch (_) {}
        });
    } catch (_) {}
}

export {
    GOSSIP_VERSION,
    ensureGossipState,
    seedGossip,
    spreadGossip,
    decayGossip,
    distortGossipContent,
    getNpcGossipKnowledge,
    getGossipAboutTopic,
    getRumorSummary,
    getRelationshipStrength,
    initGossipNetwork,
};
