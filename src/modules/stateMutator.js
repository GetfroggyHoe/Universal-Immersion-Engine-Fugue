/**
 * stateMutator.js — AI-driven State Mutator Pipeline
 *
 * Parses AI responses split by ===DATA===, applies state math,
 * renders the dynamic Action Wheel, and injects codex links.
 */

import { getSettings, saveSettings, commitStateUpdate } from "./core.js";
import { addCurrency, spendCurrency, grantXp, ensureEconomyState } from "./economy.js";
import { normalizeStatusEffect, statusKey } from "./statusFx.js";
import { flashTracker, renderModeHud, ensureGameModeState } from "./gameModeManager.js";
import { addInventoryItemWithStack } from "./inventoryItems.js";
import { notify } from "./notifications.js";
import { ensureGlobalStateLedger } from "./twoSisters.js";
import { safeJsonParseObject } from "./jsonUtil.js";
import { ensureTravelAssetFields } from "./travelAssets.js";
import { propagateEvent, EVENT_TYPES, MODAL_DOMAINS, calculateEncumbrance } from "./causalityEngine.js";

const DATA_SEPARATOR = "===DATA===";
const META_SPILL_RE = /\b(wait,|i need to|i should|i will|narrative context|system tags?|system tag|system prompt|takes precedence|treat (?:it|this) as|bridge this|constraint check|response format|prohibited prose|speaker format|json correct|resource impacts?|no bare prose|no player dialogue|thought process|reasoning process)\b/i;

function recordFilteredNarrativeMeta(parts = []) {
    const cleaned = parts
        .map((part) => String(part || "").trim())
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 4000);
    if (!cleaned) return;
    try {
        const s = getSettings();
        if (!s.ui || typeof s.ui !== "object") s.ui = {};
        if (!Array.isArray(s.ui.systemEvents)) s.ui.systemEvents = [];
        const payload = `[FILTERED MODEL META]\n${cleaned}`;
        const last = s.ui.systemEvents[s.ui.systemEvents.length - 1];
        if (String(last?.text || "") === payload) return;
        s.ui.systemEvents.push({ text: payload, ts: Date.now() });
        if (s.ui.systemEvents.length > 200) s.ui.systemEvents.shift();
        saveSettings();
    } catch (_) {}
}

// ─── Empty Template ────────────────────────────────────────────
export function getEmptyStatePayload() {
    return {
        state_updates: {
            xp_change: 0,
            stat_impacts: { hp: 0, stamina: 0, ap: 0, mp: 0, base_stats: {} },
            inventory_updates: { items_gained: [], items_lost: [], equipment_changed: {}, assets_updated: [] },
            currency_updates: { primary_change: 0, temporary_currency: { name: "", amount_change: 0 } },
            combat_log: { battles_won: 0, battles_lost: 0, new_enemies_encountered: [] },
            codex_updates: [],
            phone_updates: { social_media_notifications: [], dating_app_matches: [], bank_transactions: 0, transit_funds_change: 0 },
            resource_impacts: {},
            social_impacts: [],
            status_effects: [],
            quest_triggers: [],
            cutscenes: [],
            new_rumor_or_memory_generated: ""
        },
        action_wheel_options: []
    };
}

// ─── Parser ────────────────────────────────────────────────────
export function parseAIResponse(rawText) {
    const text = String(rawText || "");
    const idx = text.indexOf(DATA_SEPARATOR);
    let narrative = "";
    let data = null;

    if (idx === -1) {
        data = safeJsonParseObject(text);
        if (data) {
            const jsonStartIdx = text.search(/[\[{]/);
            narrative = jsonStartIdx !== -1 ? text.substring(0, jsonStartIdx).trim() : "";
        } else {
            return { narrative: text.trim(), data: getEmptyStatePayload() };
        }
    } else {
        narrative = text.substring(0, idx).trim();
        const jsonStr = text.substring(idx + DATA_SEPARATOR.length).trim();
        try {
            data = safeJsonParseObject(jsonStr);
        } catch (e) {
            console.error("[StateMutator] safeJsonParseObject failed:", e);
        }
    }

    if (!data || typeof data !== "object") {
        console.warn("[StateMutator] JSON parse failed, using empty template");
        data = getEmptyStatePayload();
    }
    // Merge with template to ensure all keys exist
    const template = getEmptyStatePayload();
    data.state_updates = { ...template.state_updates, ...(data.state_updates || {}) };
    data.state_updates.stat_impacts = { ...template.state_updates.stat_impacts, ...(data.state_updates.stat_impacts || {}) };
    data.state_updates.inventory_updates = { ...template.state_updates.inventory_updates, ...(data.state_updates.inventory_updates || {}) };
    data.state_updates.currency_updates = { ...template.state_updates.currency_updates, ...(data.state_updates.currency_updates || {}) };
    data.state_updates.combat_log = { ...template.state_updates.combat_log, ...(data.state_updates.combat_log || {}) };
    data.state_updates.phone_updates = { ...template.state_updates.phone_updates, ...(data.state_updates.phone_updates || {}) };
    data.state_updates.resource_impacts = { ...template.state_updates.resource_impacts, ...(data.state_updates.resource_impacts || {}) };
    if (!Array.isArray(data.state_updates.social_impacts)) data.state_updates.social_impacts = [];
    if (!Array.isArray(data.state_updates.status_effects)) data.state_updates.status_effects = [];
    if (!Array.isArray(data.state_updates.quest_triggers)) data.state_updates.quest_triggers = [];
    if (!Array.isArray(data.state_updates.cutscenes)) data.state_updates.cutscenes = [];
    if (!Array.isArray(data.state_updates.codex_updates)) data.state_updates.codex_updates = [];
    if (!Array.isArray(data.action_wheel_options)) data.action_wheel_options = [];
    const cutsceneMatches = Array.from(String(narrative || "").matchAll(/\[Cutscene\s*(?::\s*([^\]]+))?\]/gi));
    if (cutsceneMatches.length) {
        for (const match of cutsceneMatches) {
            const raw = String(match[1] || "").trim();
            const cs = { title: "Cutscene", body: raw };
            const attrRe = /(\w+)\s*=\s*"([^"]*)"/g;
            let attrMatch;
            const attrs = {};
            while ((attrMatch = attrRe.exec(raw)) !== null) {
                attrs[attrMatch[1].toLowerCase()] = attrMatch[2];
            }
            if (attrs.title) cs.title = attrs.title;
            if (attrs.body) cs.body = attrs.body;
            if (attrs.location) cs.location = attrs.location;
            if (attrs.background || attrs.image) cs.background = attrs.background || attrs.image;
            if (attrs.characters) cs.characters = attrs.characters.split(",").map(s => s.trim()).filter(Boolean);
            if (attrs.duration) cs.duration = Number(attrs.duration) || 6500;
            if (attrs.pov) cs.pov = attrs.pov;
            if (attrs.eventtype || attrs.type) cs.eventType = attrs.eventtype || attrs.type;
            if (attrs.stakes) cs.stakes = attrs.stakes;
            if (attrs.persist === "true") cs.persistLocation = true;
            if (attrs.ai === "true") cs.aiGenerate = true;
            data.state_updates.cutscenes.push(cs);
        }
        narrative = narrative.replace(/\[Cutscene\s*(?::\s*[^\]]+)?\]/gi, "").trim();
    }
    return { narrative, data };
}

export function sanitizeVisibleNarrative(rawText, fallbackText = "") {
    let text = String(rawText || "");
    text = text.split(DATA_SEPARATOR)[0] || "";
    const removedParts = [];
    text = text
        .replace(/```(?:json)?[\s\S]*?```/gi, "")
        .replace(/<think[\s\S]*?<\/think>/gi, (m) => {
            removedParts.push(m);
            return "";
        })
        .replace(/<analysis[\s\S]*?<\/analysis>/gi, (m) => {
            removedParts.push(m);
            return "";
        })
        .replace(/\((?=[\s\S]{0,1600}?\))[\s\S]{0,1600}?\)/g, (m) => {
            if (!META_SPILL_RE.test(m)) return m;
            removedParts.push(m);
            return "";
        })
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/gi, "&")
        .trim();

    const lines = text.replace(/\r/g, "").split("\n");
    const metaLine = /^(?:[\s>*_.-]*)(?:recent context\b|constraint check\b|constraints?\b|instruction\b|the user\b|player character\b|current state\b|current context\b|immediate interactives\b|interactives\b|inventory\b|use\b|current location\b|character level\b|current status\b|action\b|starting location\b|atmosphere\b|effect\b|user persona\b|narrator\b|objective\b|skills?\b|strict data\b|system override\b|player progress\b|response format\b|name\b|character\b|edit\b|strict\b|is it a question\b|as a\b|since\b|i should\b|i will\b|this establishes\b|no forbidden\b|consistent state\b|json\b|wait,\b)/i;
    const metaPhrase = /\b(previous prompt|system override|initial context|recent context|constraint check|scene_summary|player character|current state|immediate interactives|player progress|strict data separator|forbidden dialogue|no trailing questions|no html\/css\/js|no summarizing\/prose outside|i should narrate|i will stick|i need to reconcile|narrative context says|system tags? says|treat it as|mechanically and narratively|the objective is|the action is|user says|skills list|no skills listed|speaker format|json correct|resource impacts?|prohibited prose|no bare prose|no player dialogue)\b/i;
    const kept = [];
    let removed = 0;
    for (const line of lines) {
        const trimmed = String(line || "").trim();
        if (!trimmed) {
            if (kept.length && kept[kept.length - 1] !== "") kept.push("");
            continue;
        }
        const bulletBody = trimmed.replace(/^[*\-â€¢]\s+/, "");
        if (metaLine.test(bulletBody) || metaPhrase.test(bulletBody)) {
            removedParts.push(line);
            removed++;
            continue;
        }
        kept.push(line);
    }

    let cleaned = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    const originalWords = text.split(/\s+/).filter(Boolean);
    const lookedMostlyMeta = removed >= 4 && (words.length < 18 || words.length < originalWords.length * 0.35);
    const stillMeta = metaLine.test(cleaned) || metaPhrase.test(cleaned);
    if (!cleaned || lookedMostlyMeta || stillMeta) cleaned = String(fallbackText || "").trim();
    recordFilteredNarrativeMeta(removedParts);
    return cleaned;
}
function lastUserActionText() {
    try {
        if (Array.isArray(window.chat)) {
            for (let i = window.chat.length - 1; i >= 0; i--) {
                const m = window.chat[i];
                const isUser = m?.is_user === true || m?.isUser === true || String(m?.name || "").toLowerCase() === "you";
                if (!isUser) continue;
                const text = String(m?.mes || m?.message || m?.text || "").replace(/\[[^\]]*?\]/g, "").trim();
                if (text) return text.slice(0, 240);
            }
        }
    } catch (_) {}
    try {
        const nodes = Array.from(document.querySelectorAll("#chat .mes")).reverse();
        for (const node of nodes) {
            const isUser =
                node.classList?.contains("is_user") ||
                node.getAttribute("is_user") === "true" ||
                node.getAttribute("data-is-user") === "true" ||
                node.dataset?.isUser === "true";
            if (!isUser) continue;
            const text = String(node.querySelector(".mes_text, .mes-text")?.textContent || node.textContent || "").replace(/\[[^\]]*?\]/g, "").trim();
            if (text) return text.slice(0, 240);
        }
    } catch (_) {}
    return "";
}

function buildNarrativeFallback() { return ""; }

// ─── Clamp helper ──────────────────────────────────────────────
function clamp(v, min, max) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
}

function flashUniversalTracker(name) {
    try {
        const key = String(name || "").trim().toLowerCase();
        if (!key) return;
        const nodes = Array.from(document.querySelectorAll(".hud-tracker, .uie-mode-bar, .life-tracker-row, [data-tracker-name], [data-stat]"));
        for (const node of nodes) {
            const label = String(node.getAttribute("data-tracker-name") || node.getAttribute("data-stat") || node.textContent || "").trim().toLowerCase();
            if (!label.includes(key)) continue;
            node.classList.remove("uie-state-flash");
            void node.offsetWidth;
            node.classList.add("uie-state-flash");
            setTimeout(() => node.classList.remove("uie-state-flash"), 900);
        }
    } catch (_) {}
}

// ─── Process State Updates (Invisible Math) ────────────────────
function markTrackerSource(tracker, source) {
    if (!tracker || typeof tracker !== "object") return;
    const src = String(source || "").trim().toLowerCase();
    if (!["time", "story", "item"].includes(src)) return;
    const set = new Set(Array.isArray(tracker.sources) ? tracker.sources.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean) : []);
    set.add(src);
    tracker.sources = Array.from(set);
    tracker.lastChangedBy = src;
}

function ensureWorldItems(state) {
    if (!state.worldState || typeof state.worldState !== "object") state.worldState = {};
    if (!Array.isArray(state.worldState.worldItems)) state.worldState.worldItems = [];
    return state.worldState.worldItems;
}

function itemKey(name, location = "") {
    return `${String(name || "").trim().toLowerCase()}::${String(location || "").trim().toLowerCase()}`;
}

function hasExplicitInventoryEvidence(item, actionText = "") {
    if (item?.explicitInventory === true || item?.taken === true || item?.possessed === true || item?.inInventory === true) return true;
    const evidence = [
        actionText,
        item?.evidence,
        item?.sourceText,
        item?.reason,
        item?.description
    ].map((part) => String(part || "")).join(" ");
    return /\b(?:i|you|we)\s+(?:take|took|pick(?:ed)?\s+up|grab(?:bed)?|loot(?:ed)?|collect(?:ed)?|stow(?:ed)?|pocket(?:ed)?|bag(?:ged)?|equip(?:ped)?|wear|wore|wield(?:ed)?|buy|bought|purchase(?:d)?|receive(?:d)?|accept(?:ed)?|craft(?:ed)?|claim(?:ed)?)\b/i.test(evidence)
        || /\b(?:put|place|placed|store|stored)\b.{0,40}\b(?:inventory|bag|pack|pocket|satchel|belt|sheath)\b/i.test(evidence);
}

function rememberWorldItem(state, item, actionText = "") {
    const name = String(item?.name || "").trim();
    if (!name) return false;
    const worldItems = ensureWorldItems(state);
    const location = String(item?.location || state?.worldState?.currentLocation || state?.world?.location || "Current scene").trim();
    const key = itemKey(name, location);
    const entry = {
        ...item,
        name,
        qty: Number(item?.qty || 1),
        type: String(item?.type || "item"),
        description: String(item?.description || ""),
        rarity: String(item?.rarity || "common"),
        statusEffects: Array.isArray(item?.statusEffects) ? item.statusEffects : [],
        mods: item?.mods && typeof item.mods === "object" ? item.mods : {},
        location,
        _key: key,
        _meta: {
            ...(item?._meta && typeof item._meta === "object" ? item._meta : {}),
            source: "ai_state_mutator_world_item",
            evidence: actionText || item?.evidence || ""
        }
    };
    const existing = worldItems.find((worldItem) => String(worldItem?._key || itemKey(worldItem?.name, worldItem?.location)) === key);
    if (existing) Object.assign(existing, entry, { qty: Math.max(Number(existing.qty || 1), entry.qty) });
    else worldItems.push(entry);
    queueUnplacedRoomTarget(state, entry);
    return true;
}

function queueUnplacedRoomTarget(state, item) {
    if (!state.roomEditor || typeof state.roomEditor !== "object") state.roomEditor = {};
    if (!Array.isArray(state.roomEditor.unplacedItems)) state.roomEditor.unplacedItems = [];
    const name = String(item?.name || "").trim();
    if (!name) return false;
    const location = String(item?.location || state?.worldState?.currentLocation || "Current scene").trim();
    const key = itemKey(name, location);
    const target = {
        id: String(item?.id || `target_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
        name,
        qty: Number(item?.qty || 1),
        type: String(item?.type || "object"),
        description: String(item?.description || ""),
        rarity: String(item?.rarity || "common"),
        location,
        status: "unplaced",
        source: "ai_scavenger_object",
        _key: key,
        updatedAt: Date.now()
    };
    const existing = state.roomEditor.unplacedItems.find((x) => String(x?._key || itemKey(x?.name, x?.location)) === key);
    if (existing) Object.assign(existing, target, { qty: Math.max(Number(existing.qty || 1), target.qty) });
    else state.roomEditor.unplacedItems.push(target);
    state.roomEditor.unplacedItems = state.roomEditor.unplacedItems.slice(-80);
    return true;
}

function signedDelta(value, suffix = "") {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n === 0) return "";
    return `${n > 0 ? "+" : ""}${n}${suffix}`;
}

function itemNames(list, limit = 3) {
    if (!Array.isArray(list)) return "";
    const names = list
        .map((item) => String(typeof item === "string" ? item : item?.name || item?.title || item?.entry_name || "").trim())
        .filter(Boolean);
    if (!names.length) return "";
    const shown = names.slice(0, limit).join(", ");
    return names.length > limit ? `${shown}, +${names.length - limit} more` : shown;
}

function emitImmersiveUpdateToasts(u) {
    const toasts = [];
    const resourceImpacts = u.resource_impacts && typeof u.resource_impacts === "object" ? u.resource_impacts : {};
    for (const [name, delta] of Object.entries(resourceImpacts)) {
        const label = signedDelta(delta);
        if (label) toasts.push(["info", `${name}: ${label}`, "Resources", "resource"]);
    }
    const si = u.stat_impacts || {};
    const statBits = ["hp", "stamina", "ap", "mp"].map((k) => {
        const d = signedDelta(si?.[k]);
        return d ? `${k.toUpperCase()} ${d}` : "";
    }).filter(Boolean);
    if (statBits.length) toasts.push([statBits.some((x) => x.includes("-")) ? "warning" : "success", statBits.join(", "), "Status", "stat"]);
    if (Number(u.xp_change || 0) > 0) toasts.push(["success", `XP ${signedDelta(u.xp_change)}`, "Progress", "xp"]);

    if (Array.isArray(u.social_impacts)) {
        for (const impact of u.social_impacts.slice(0, 3)) {
            const npc = String(impact?.npc || impact?.name || "").trim();
            if (!npc) continue;
            const aff = signedDelta(impact?.affinity_change ?? impact?.affinity ?? 0);
            const mood = String(impact?.new_mood || impact?.mood || "").trim();
            const text = [npc, aff ? `affinity ${aff}` : "", mood ? `mood: ${mood}` : ""].filter(Boolean).join(" - ");
            if (text) toasts.push(["info", text, "Social", "social"]);
        }
    }

    if (Array.isArray(u.quest_triggers) && u.quest_triggers.length) {
        toasts.push(["info", `Quest update: ${itemNames(u.quest_triggers)}`, "Journal", "quest"]);
    }

    const inv = u.inventory_updates || {};
    const gained = itemNames(inv.items_gained);
    if (gained) toasts.push(["success", `Gained/found: ${gained}`, "Objects", "loot"]);
    const lost = itemNames(inv.items_lost);
    if (lost) toasts.push(["warning", `Lost/used: ${lost}`, "Inventory", "loot"]);
    const assets = itemNames(inv.assets_updated);
    if (assets) toasts.push(["info", `New unplaced room target(s): ${assets}`, "Objects", "objects"]);

    const cur = u.currency_updates || {};
    const primary = signedDelta(cur.primary_change);
    if (primary) toasts.push([primary.startsWith("-") ? "warning" : "success", `Currency ${primary}`, "Wallet", "currency"]);

    const codex = itemNames(u.codex_updates);
    if (codex) toasts.push(["info", `Codex updated: ${codex}`, "Journal", "journal"]);

    const pu = u.phone_updates || {};
    const phoneBits = [];
    if (Array.isArray(pu.social_media_notifications) && pu.social_media_notifications.length) phoneBits.push(`${pu.social_media_notifications.length} social`);
    if (Array.isArray(pu.dating_app_matches) && pu.dating_app_matches.length) phoneBits.push(`${pu.dating_app_matches.length} match`);
    const bank = signedDelta(pu.bank_transactions);
    if (bank) phoneBits.push(`bank ${bank}`);
    const transit = signedDelta(pu.transit_funds_change);
    if (transit) phoneBits.push(`transit ${transit}`);
    if (phoneBits.length) toasts.push(["info", `Phone: ${phoneBits.join(", ")}`, "Phone", "phone"]);

    for (const [level, message, title, category] of toasts.slice(0, 6)) {
        try { notify(level, message, title, category); } catch (_) {}
    }
}

export function processStateUpdates(stateUpdates) {
    if (!stateUpdates || typeof stateUpdates !== "object") return;
    if (stateUpdates.state_updates && typeof stateUpdates.state_updates === "object") {
        return processStateUpdates(stateUpdates.state_updates);
    }
    const s = getSettings();
    ensureGameModeState(s);
    ensureEconomyState(s);
    const ledger = ensureGlobalStateLedger(s);
    if (!s.character || typeof s.character !== "object") s.character = {};
    if (!s.world || typeof s.world !== "object") s.world = {};
    if (!s.journal || typeof s.journal !== "object") s.journal = {};
    if (!Array.isArray(s.journal.codex)) s.journal.codex = [];
    if (!Array.isArray(s.world.codex)) s.world.codex = [];
    if (s.world.codex.length && !s.journal.codex.length) s.journal.codex = s.world.codex;
    s.world.codex = s.journal.codex;
    if (!s.world.combatStats || typeof s.world.combatStats !== "object") s.world.combatStats = { wins: 0, losses: 0 };

    const u = stateUpdates;
    let changed = false;

    // 0. Universal resource impacts: update user-defined gameState/player and Life HUD trackers by name.
    const resourceImpacts = u.resource_impacts && typeof u.resource_impacts === "object" ? u.resource_impacts : {};
    const applyUniversalResourceDelta = (nameRaw, deltaRaw) => {
        const name = String(nameRaw || "").trim();
        const delta = Number(deltaRaw || 0);
        if (!name || !Number.isFinite(delta) || delta === 0) return;
        const key = name.toLowerCase();
        if (!Array.isArray(ledger.player_trackers)) ledger.player_trackers = [];
        let tracker = ledger.player_trackers.find((t) => String(t?.name || t?.id || "").trim().toLowerCase() === key);
        if (!tracker) {
            tracker = { id: key.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || key, name, current: 0, max: 100, color: "#89b4fa", visible: true, tags: [], sources: ["story"] };
            ledger.player_trackers.push(tracker);
        }
        const max = Math.max(1, Number(tracker.max || 100));
        tracker.current = clamp(Number(tracker.current || 0) + delta, 0, max);
        tracker.updatedAt = Date.now();
        if (!s.life || typeof s.life !== "object") s.life = {};
        if (!Array.isArray(s.life.trackers)) s.life.trackers = [];
        let life = s.life.trackers.find((t) => String(t?.name || t?.id || "").trim().toLowerCase() === key);
        if (!life) {
            life = { id: tracker.id, name, current: tracker.current, max, color: tracker.color || "#89b4fa", visible: tracker.visible !== false, notes: "", sources: ["story"] };
            s.life.trackers.push(life);
        } else {
            life.current = tracker.current;
            life.max = max;
            life.updatedAt = tracker.updatedAt;
        }
        markTrackerSource(tracker, "story");
        markTrackerSource(life, "story");
        flashUniversalTracker(name);
        changed = true;
    };
    for (const [name, delta] of Object.entries(resourceImpacts)) applyUniversalResourceDelta(name, delta);

    // 1. XP
    const xpDelta = Number(u.xp_change || 0);
    if (xpDelta > 0) {
        const result = grantXp(s, xpDelta, "ai_state_mutator");
        if (result && result.levels > 0) notify("success", `Level Up! Now Lv.${s.character.level}`, "State Mutator");
        changed = true;
    }

    // 2. Stat Impacts
    const si = u.stat_impacts || {};
    const applyDelta = (key, maxKey, delta) => {
        const d = Number(delta || 0);
        if (!d) return;
        const maxVal = Math.max(1, Number(s[maxKey] || 100));
        s[key] = clamp(Number(s[key] || 0) + d, 0, maxVal);
        flashTracker(key);
        changed = true;
    };
    applyDelta("hp", "maxHp", si.hp);
    applyDelta("stamina", "maxStamina", si.stamina);
    applyDelta("ap", "maxAp", si.ap);
    applyDelta("mp", "maxMp", si.mp);

    // Base stats
    if (si.base_stats && typeof si.base_stats === "object") {
        if (!s.character.stats || typeof s.character.stats !== "object") s.character.stats = {};
        for (const [k, v] of Object.entries(si.base_stats)) {
            const d = Number(v || 0);
            if (!d) continue;
            s.character.stats[k] = (Number(s.character.stats[k] || 0)) + d;
            changed = true;
        }
    }

    // 3. Social Impacts
    if (Array.isArray(u.social_impacts)) {
        if (!s.social || typeof s.social !== "object") s.social = {};
        for (const impact of u.social_impacts) {
            const npc = String(impact?.npc || impact?.name || "").trim();
            const aff = Number(impact?.affinity_change ?? impact?.affinity ?? 0);
            const newMood = String(impact?.new_mood || impact?.mood || "").trim();
            if (!npc || (!aff && !newMood)) continue;
            const npcKey = npc.toLowerCase();
            if (!Array.isArray(ledger.relationships)) ledger.relationships = [];
            let ledgerNpc = ledger.relationships.find(p => String(p?.name || "").toLowerCase() === npcKey);
            if (!ledgerNpc) {
                ledgerNpc = { name: npc, affinity: 50, mood: "neutral", hidden_memories: [] };
                ledger.relationships.push(ledgerNpc);
            }
            if (aff) ledgerNpc.affinity = clamp(Number(ledgerNpc.affinity || 50) + aff, 0, 100);
            if (newMood) ledgerNpc.mood = newMood;
            // Search all social groups
            let found = false;
            for (const group of ["friends", "associates", "romance", "family", "rivals"]) {
                if (!Array.isArray(s.social[group])) continue;
                const entry = s.social[group].find(p => String(p?.name || "").toLowerCase() === npcKey);
                if (entry) {
                    if (aff) entry.affinity = clamp(Number(entry.affinity || 50) + aff, 0, 100);
                    if (newMood) entry.mood = newMood;
                    found = true;
                    break;
                }
            }
            if (!found) {
                if (!Array.isArray(s.social.associates)) s.social.associates = [];
                s.social.associates.push({ name: npc, affinity: clamp(50 + aff, 0, 100), mood: newMood || "neutral" });
            }
            changed = true;
        }
    }

    const rumor = String(u.new_rumor_or_memory_generated || "").trim();
    if (rumor) {
        if (!Array.isArray(ledger.global_events)) ledger.global_events = [];
        ledger.global_events.push({ at: Date.now(), text: rumor });
        ledger.global_events = ledger.global_events.slice(-80);
        changed = true;
    }

    // 4. Status Effects
    if (Array.isArray(u.status_effects) && u.status_effects.length) {
        if (!Array.isArray(s.character.statusEffects)) s.character.statusEffects = [];
        for (const fxStr of u.status_effects) {
            const fx = normalizeStatusEffect(fxStr);
            if (!fx) continue;
            const k = statusKey(fx);
            if (!s.character.statusEffects.some(e => statusKey(e) === k)) {
                s.character.statusEffects.push(fx);
                changed = true;
            }
        }
    }

    // 5. Quest Triggers
    if (Array.isArray(u.quest_triggers) && u.quest_triggers.length) {
        if (!s.journal || typeof s.journal !== "object") s.journal = {};
        if (!Array.isArray(s.journal.active)) s.journal.active = [];
        for (const q of u.quest_triggers) {
            const title = String(q || "").trim();
            if (!title) continue;
            if (!s.journal.active.some(j => String(j?.title || "").toLowerCase() === title.toLowerCase())) {
                s.journal.active.push({ title, desc: "", status: "active", ts: Date.now() });
                notify("info", `New Quest: ${title}`, "Quest Log");
                changed = true;
            }
        }
    }

    if (Array.isArray(u.cutscenes) && u.cutscenes.length) {
        import("./cutscenes.js")
            .then((mod) => mod.runCutscenes?.(u.cutscenes))
            .catch((error) => console.warn("[StateMutator] Cutscene trigger failed:", error));
    } else if (u.cutscene && typeof u.cutscene === "object") {
        import("./cutscenes.js")
            .then((mod) => mod.startCutscene?.(u.cutscene))
            .catch((error) => console.warn("[StateMutator] Cutscene trigger failed:", error));
    }

    // 6. Inventory Updates
    const inv = u.inventory_updates || {};
    if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
    if (!Array.isArray(s.inventory.items)) s.inventory.items = [];

    if (Array.isArray(inv.items_gained)) {
        const actionText = lastUserActionText();
        for (const item of inv.items_gained) {
            if (!item || typeof item !== "object") continue;
            const name = String(item.name || "").trim();
            if (!name) continue;
            const normalized = {
                ...item,
                name, qty: Number(item.qty || 1),
                type: String(item.type || "item"),
                description: String(item.description || ""),
                rarity: String(item.rarity || "common"),
                statusEffects: Array.isArray(item.statusEffects) ? item.statusEffects : [],
                mods: item.mods && typeof item.mods === "object" ? item.mods : {}
            };
            if (!hasExplicitInventoryEvidence(normalized, actionText)) {
                rememberWorldItem(s, normalized, actionText);
                changed = true;
                continue;
            }
            addInventoryItemWithStack(s.inventory.items, normalized, { source: "ai_state_mutator" });
            changed = true;
        }
    }
    if (Array.isArray(inv.items_lost)) {
        for (const item of inv.items_lost) {
            const name = String(typeof item === "string" ? item : item?.name || "").trim().toLowerCase();
            if (!name) continue;
            const idx = s.inventory.items.findIndex(i => String(i?.name || "").toLowerCase() === name);
            if (idx >= 0) {
                const qty = Number(typeof item === "object" ? item.qty : 1) || 1;
                s.inventory.items[idx].qty = Math.max(0, Number(s.inventory.items[idx].qty || 1) - qty);
                if (s.inventory.items[idx].qty <= 0) s.inventory.items.splice(idx, 1);
                changed = true;
            }
        }
    }
    if (inv.equipment_changed && typeof inv.equipment_changed === "object") {
        if (!s.inventory.equipment || typeof s.inventory.equipment !== "object") s.inventory.equipment = {};
        for (const [slot, itemName] of Object.entries(inv.equipment_changed)) {
            s.inventory.equipment[slot] = String(itemName || "").trim() || null;
            changed = true;
        }
    }
    if (Array.isArray(inv.assets_updated)) {
        if (!Array.isArray(s.inventory.assets)) s.inventory.assets = [];
        for (const asset of inv.assets_updated) {
            if (!asset || typeof asset !== "object") continue;
            const name = String(asset.name || "").trim();
            if (!name) continue;
            const existing = s.inventory.assets.find(a => String(a?.name || "").toLowerCase() === name.toLowerCase());
            const { location: _ignoredLocation, travelCategory: _ignoredTravelCategory, ...safeAsset } = asset;
            if (existing) {
                const existingLocation = existing.location;
                const existingTravelCategory = existing.travelCategory;
                Object.assign(existing, safeAsset);
                existing.location = existingLocation;
                existing.travelCategory = existingTravelCategory;
                ensureTravelAssetFields(existing);
                queueUnplacedRoomTarget(s, existing);
            } else {
                const nextAsset = ensureTravelAssetFields({ ...safeAsset, name }, { forceUnplaced: true });
                s.inventory.assets.push(nextAsset);
                queueUnplacedRoomTarget(s, nextAsset);
            }
            changed = true;
        }
    }

    // 7. Currency Updates
    const cur = u.currency_updates || {};
    const primaryDelta = Number(cur.primary_change || 0);
    if (primaryDelta !== 0) {
        if (primaryDelta > 0) addCurrency(s, primaryDelta);
        else spendCurrency(s, Math.abs(primaryDelta));
        changed = true;
    }
    const tempCur = cur.temporary_currency || {};
    const tempName = String(tempCur.name || "").trim();
    const tempDelta = Number(tempCur.amount_change || 0);
    if (tempName && tempDelta !== 0) {
        if (!s.wallet || typeof s.wallet !== "object") s.wallet = {};
        if (!Number.isFinite(Number(s.wallet[tempName]))) s.wallet[tempName] = 0;
        s.wallet[tempName] = Math.max(0, s.wallet[tempName] + tempDelta);
        changed = true;
    }

    // 8. Combat Log
    const cl = u.combat_log || {};
    s.world.combatStats.wins += Math.max(0, Number(cl.battles_won || 0));
    s.world.combatStats.losses += Math.max(0, Number(cl.battles_lost || 0));
    if (Array.isArray(cl.new_enemies_encountered)) {
        for (const enemy of cl.new_enemies_encountered) {
            if (!enemy || typeof enemy !== "object") continue;
            const name = String(enemy.name || "").trim();
            if (!name) continue;
            if (!s.journal.codex.some(e => String(e?.title || e?.entry_name || "").toLowerCase() === name.toLowerCase())) {
                s.journal.codex.push({
                    id: `codex_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    category: "Monsters",
                    title: name,
                    entry_name: name,
                    body: String(enemy.lore || ""),
                    data: String(enemy.lore || ""),
                    updatedAt: Date.now()
                });
                s.world.codex = s.journal.codex;
                changed = true;
            }
        }
    }

    // 9. Codex Updates
    if (Array.isArray(u.codex_updates)) {
        for (const entry of u.codex_updates) {
            if (!entry || typeof entry !== "object") continue;
            const entryName = String(entry.entry_name || "").trim();
            if (!entryName) continue;
            const existing = s.journal.codex.find(e => String(e?.title || e?.entry_name || "").toLowerCase() === entryName.toLowerCase());
            if (existing) {
                existing.body = String(entry.body || entry.data || existing.body || existing.data || "");
                existing.data = existing.body;
                existing.updatedAt = Date.now();
                if (entry.category) existing.category = String(entry.category);
            } else {
                s.journal.codex.push({
                    id: `codex_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    category: String(entry.category || "Lore"),
                    title: entryName,
                    entry_name: entryName,
                    body: String(entry.body || entry.data || ""),
                    data: String(entry.body || entry.data || ""),
                    updatedAt: Date.now()
                });
            }
            s.world.codex = s.journal.codex;
            changed = true;
        }
    }

    // 10. Phone Updates
    const pu = u.phone_updates || {};
    if (!s.phone || typeof s.phone !== "object") s.phone = {};
    if (Array.isArray(pu.social_media_notifications) && pu.social_media_notifications.length) {
        if (!Array.isArray(s.phone.socialMedia)) s.phone.socialMedia = [];
        s.phone.socialMedia.push(...pu.social_media_notifications.map(n => ({ text: String(n || ""), ts: Date.now() })));
        s.phone.socialMedia = s.phone.socialMedia.slice(-100);
        changed = true;
    }
    if (Array.isArray(pu.dating_app_matches) && pu.dating_app_matches.length) {
        if (!Array.isArray(s.phone.datingApp)) s.phone.datingApp = [];
        s.phone.datingApp.push(...pu.dating_app_matches.map(m => ({ name: String(m || ""), ts: Date.now() })));
        s.phone.datingApp = s.phone.datingApp.slice(-50);
        changed = true;
    }
    const bankDelta = Number(pu.bank_transactions || 0);
    if (bankDelta !== 0) {
        if (bankDelta > 0) addCurrency(s, bankDelta);
        else spendCurrency(s, Math.abs(bankDelta));
        changed = true;
    }
    const transitDelta = Number(pu.transit_funds_change || 0);
    if (transitDelta !== 0) {
        if (!s.phone.travel || typeof s.phone.travel !== "object") s.phone.travel = {};
        if (!Number.isFinite(Number(s.phone.travel.balance))) s.phone.travel.balance = 0;
        s.phone.travel.balance = Math.max(0, s.phone.travel.balance + transitDelta);
        changed = true;
    }

    if (changed) {
        emitImmersiveUpdateToasts(u);
        renderModeHud();
        commitStateUpdate({ layout: true, emit: true });
        try {
            const causalityEvents = [];
            if (Number(u.xp_change || 0) > 0) causalityEvents.push({ type: EVENT_TYPES.STAT_CHANGED, domain: MODAL_DOMAINS.CHARACTER, source: "state_mutator", payload: { stat: "xp", delta: u.xp_change } });
            if (Array.isArray(u.inventory_updates?.items_gained) && u.inventory_updates.items_gained.length) causalityEvents.push({ type: EVENT_TYPES.ITEM_GAINED, domain: MODAL_DOMAINS.INVENTORY, source: "state_mutator", payload: { items: u.inventory_updates.items_gained } });
            if (Array.isArray(u.inventory_updates?.items_lost) && u.inventory_updates.items_lost.length) causalityEvents.push({ type: EVENT_TYPES.ITEM_LOST, domain: MODAL_DOMAINS.INVENTORY, source: "state_mutator", payload: { items: u.inventory_updates.items_lost } });
            if (Array.isArray(u.social_impacts) && u.social_impacts.length) causalityEvents.push({ type: EVENT_TYPES.RELATIONSHIP_CHANGE, domain: MODAL_DOMAINS.SOCIAL, source: "state_mutator", payload: { impacts: u.social_impacts } });
            if (Number(u.combat_log?.battles_won || 0) > 0) causalityEvents.push({ type: EVENT_TYPES.COMBAT_WIN, domain: MODAL_DOMAINS.BATTLE, source: "state_mutator", payload: { wins: u.combat_log.battles_won } });
            if (Number(u.combat_log?.battles_lost || 0) > 0) causalityEvents.push({ type: EVENT_TYPES.COMBAT_LOSS, domain: MODAL_DOMAINS.BATTLE, source: "state_mutator", payload: { losses: u.combat_log.battles_lost } });
            if (Number(u.currency_updates?.primary_change || 0) !== 0) causalityEvents.push({ type: EVENT_TYPES.CURRENCY_CHANGED, domain: MODAL_DOMAINS.INVENTORY, source: "state_mutator", payload: { delta: u.currency_updates.primary_change } });
            if (Array.isArray(u.quest_triggers) && u.quest_triggers.length) causalityEvents.push({ type: EVENT_TYPES.QUEST_COMPLETED, domain: MODAL_DOMAINS.JOURNAL, source: "state_mutator", payload: { quests: u.quest_triggers } });
            if (Array.isArray(u.status_effects) && u.status_effects.length) causalityEvents.push({ type: EVENT_TYPES.STAT_CHANGED, domain: MODAL_DOMAINS.LIFE, source: "state_mutator", payload: { effects: u.status_effects } });
            for (const evt of causalityEvents) {
                try { propagateEvent(s, evt); } catch (_) {}
            }
            try { calculateEncumbrance(s); } catch (_) {}
        } catch (_) {}
    }
}

// ─── Codex Linker ──────────────────────────────────────────────
function escHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function injectCodexLinks(narrativeText) {
    const s = getSettings();
    const codex = Array.isArray(s?.journal?.codex) ? s.journal.codex : (Array.isArray(s?.world?.codex) ? s.world.codex : []);
    if (!codex.length) return escHtml(narrativeText);

    let html = escHtml(narrativeText);
    const names = codex.map(e => String(e?.title || e?.entry_name || "").trim()).filter(Boolean);
    // Sort longest first to avoid partial matches
    names.sort((a, b) => b.length - a.length);
    const linked = new Set();
    for (const name of names) {
        if (linked.has(name.toLowerCase())) continue;
        const escaped = name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
        const rx = new RegExp(`\\b(${escaped})\\b`, "gi");
        if (rx.test(html)) {
            html = html.replace(rx, (match) => `<span class="codex-link" data-id="${escHtml(name)}">${match}</span>`);
            linked.add(name.toLowerCase());
        }
    }
    return html;
}

// ─── Codex Modal ───────────────────────────────────────────────
function ensureCodexModal() {
    if (document.getElementById("uie-codex-modal")) return;
    const modal = document.createElement("div");
    modal.id = "uie-codex-modal";
    modal.innerHTML = `
        <div class="codex-modal-card">
            <div class="codex-modal-header">
                <span id="uie-codex-modal-title"></span>
                <button id="uie-codex-modal-close" class="codex-modal-close">&times;</button>
            </div>
            <div class="codex-modal-category" id="uie-codex-modal-category"></div>
            <div class="codex-modal-body" id="uie-codex-modal-body"></div>
        </div>`;
    document.body.appendChild(modal);
    modal.querySelector("#uie-codex-modal-close").addEventListener("click", () => { modal.style.display = "none"; });
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });
}

function openCodexEntry(entryName) {
    const s = getSettings();
    const codex = Array.isArray(s?.journal?.codex) ? s.journal.codex : (Array.isArray(s?.world?.codex) ? s.world.codex : []);
    const entry = codex.find(e => String(e?.title || e?.entry_name || "").toLowerCase() === String(entryName || "").toLowerCase());
    if (!entry) return;
    ensureCodexModal();
    document.getElementById("uie-codex-modal-title").textContent = entry.title || entry.entry_name || "Unknown";
    document.getElementById("uie-codex-modal-category").textContent = entry.category || "Lore";
    document.getElementById("uie-codex-modal-body").textContent = entry.body || entry.data || "No information available.";
    document.getElementById("uie-codex-modal").style.display = "flex";
}

// ─── Action Wheel ──────────────────────────────────────────────
const ACTION_TYPE_CLASSES = {
    combat: "aw-combat", attack: "aw-combat", fight: "aw-combat",
    social: "aw-social", talk: "aw-social", dialogue: "aw-social", persuade: "aw-social",
    explore: "aw-explore", move: "aw-explore", travel: "aw-explore", search: "aw-explore",
    magic: "aw-magic", spell: "aw-magic", cast: "aw-magic",
    stealth: "aw-stealth", sneak: "aw-stealth", hide: "aw-stealth",
rest: "aw-rest", heal: "aw-rest", recover: "aw-rest",
    trade: "aw-trade", shop: "aw-trade", buy: "aw-trade", sell: "aw-trade",
};

function getTypeClass(type) {
    const key = String(type || "").trim().toLowerCase();
    return ACTION_TYPE_CLASSES[key] || "aw-neutral";
}

function formatCostLabel(cost) {
    if (!cost || typeof cost !== "object") return "";
    const parts = [];
    for (const [k, v] of Object.entries(cost)) {
        const n = Number(v || 0);
        if (n) parts.push(`${n} ${k}`);
    }
    return parts.join(", ");
}

function isRemovedActionLabel(label) {
    const cleaned = String(label || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    return /\buse\s+skill\b/.test(cleaned)
        || /\btrain\s+ability\b/.test(cleaned)
        || /\bgo\s+to\s+work\b/.test(cleaned);
}

export function renderActionWheel(options) {
    let container = document.getElementById("uie-action-wheel");
    if (!container) { container = document.createElement("div"); container.id = "uie-action-wheel"; document.body.appendChild(container); }
    let fab = document.getElementById("uie-action-wheel-fab");
    if (!fab) {
        fab = document.createElement("button"); fab.id = "uie-action-wheel-fab"; fab.type = "button";
        fab.title = "Open actions"; fab.setAttribute("aria-label", "Open actions");
        fab.innerHTML = `<i class="fas fa-bolt" aria-hidden="true"></i>`;
        fab.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); toggleActionWheel(); });
        document.body.appendChild(fab);
    }
    const s = getSettings();
    s.actionWheel = s.actionWheel || {};
    const builtIns = [
        { label: "Observe", command: "Observe the immediate situation and respond to the most important visible change.", icon: "fa-eye" },
        { label: "Ask directly", command: "Ask one clear, grounded question about what matters right now.", icon: "fa-comment-dots" },
        { label: "Offer support", command: "Offer practical support without assuming anyone's feelings or choices.", icon: "fa-hand-holding-heart" },
        { label: "Set a boundary", command: "State a calm, specific boundary and leave room for a response.", icon: "fa-shield-heart" },
        { label: "Advance scene", command: "Advance to the next plausible beat, preserving established positions and agency.", icon: "fa-forward" }
    ].map((item) => ({ ...item, type: "macro", isBuiltInMacro: true }));
    const custom = Array.isArray(s.actionWheel.customMacros) ? s.actionWheel.customMacros.filter((item) => item?.label && item?.command && !isRemovedActionLabel(item.label)).map((item) => ({ ...item, type: "macro", isCustomMacro: true, icon: item.icon || "fa-wand-magic-sparkles" })) : [];
    const displayOptions = [...(Array.isArray(options) ? options.filter((item) => item?.label && !isRemovedActionLabel(item.label)) : []), ...builtIns, ...custom].slice(0, 12);
    window._uieActionWheelOptions = displayOptions;
    container.innerHTML = `<section class="aw-menu" id="uie-action-wheel-widget" role="menu" aria-label="Actions"><header class="aw-menu-header"><span><i class="fas fa-bolt" aria-hidden="true"></i> Actions</span><button class="aw-menu-close" type="button" data-aw-close="true" aria-label="Close actions"><i class="fas fa-xmark" aria-hidden="true"></i></button></header><div class="aw-menu-actions">${displayOptions.length ? displayOptions.map((opt, idx) => `<button class="aw-menu-action ${getTypeClass(opt.type)}" type="button" role="menuitem" data-aw-idx="${idx}" ${opt.disabled ? "disabled" : ""}><i class="fas ${opt.icon || "fa-hand-pointer"}" aria-hidden="true"></i><span>${escHtml(opt.label)}${formatCostLabel(opt.cost) ? `<small>${escHtml(formatCostLabel(opt.cost))}</small>` : ""}</span></button>`).join("") : `<p class="aw-empty">No actions are available here yet.</p>`}</div></section>`;
    container.onclick = handleActionWheelClick;
    container.style.display = container.dataset.open === "true" ? "block" : "none";
    fab.style.display = "grid";
}
export function toggleActionWheel(forceOpen) {
    let container = document.getElementById("uie-action-wheel");
    if (!container) {
        renderActionWheel(window._uieActionWheelOptions || []);
        container = document.getElementById("uie-action-wheel");
    }
    if (!container) return false;
    const open = typeof forceOpen === "boolean" ? forceOpen : container.dataset.open !== "true";
    container.dataset.open = open ? "true" : "false";
    container.style.display = open ? "flex" : "none";
    const fab = document.getElementById("uie-action-wheel-fab");
    if (fab) {
        fab.style.display = "grid";
        fab.classList.toggle("open", open);
        fab.title = open ? "Close action wheel" : "Open action wheel";
        fab.setAttribute("aria-label", fab.title);
    }
    if (open) {
        renderActionWheel(window._uieActionWheelOptions || []);
        setTimeout(() => {
            const first = container.querySelector(".aw-menu-action[data-aw-idx]:not(:disabled)");
            if (first) first.focus();
            else container.querySelector(".aw-menu-close")?.focus();
        }, 60);
    }
    return open;
}

export function openCustomMacroModal() {
    const s = getSettings();
    if (!s.actionWheel) s.actionWheel = {};
    if (!Array.isArray(s.actionWheel.customMacros)) s.actionWheel.customMacros = [];

    // Clone custom macros locally to support cancel
    let localMacros = JSON.parse(JSON.stringify(s.actionWheel.customMacros));

    let modal = document.getElementById("uie-macro-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "uie-macro-modal";
        modal.style.cssText = `
            display: flex;
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            background: rgba(0,0,0,0.75);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            align-items: center;
            justify-content: center;
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
        `;
        document.body.appendChild(modal);
    }

    function renderModalBody() {
        modal.innerHTML = `
            <style>
                .macro-window {
                    width: min(560px, 92vw);
                    background: linear-gradient(135deg, rgba(16, 22, 34, 0.96), rgba(8, 12, 20, 0.99));
                    border: 1px solid rgba(203, 163, 92, 0.35);
                    border-radius: 16px;
                    box-shadow: 0 24px 64px rgba(0,0,0,0.75), 0 0 32px rgba(203, 163, 92, 0.1);
                    color: #e2e8f0;
                    padding: 24px;
                    display: flex;
                    flex-direction: column;
                    gap: 18px;
                    box-sizing: border-box;
                    animation: macroModalScale 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
                }
                @keyframes macroModalScale {
                    from { transform: scale(0.9) translateY(15px); opacity: 0; }
                    to { transform: scale(1) translateY(0); opacity: 1; }
                }
                .macro-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid rgba(255,255,255,0.08);
                    padding-bottom: 12px;
                }
                .macro-title {
                    font-size: 18px;
                    font-weight: 800;
                    color: #ffd166;
                    letter-spacing: 0.5px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .macro-desc {
                    font-size: 12px;
                    color: #94a3b8;
                    margin-bottom: 8px;
                    line-height: 1.4;
                }
                .macro-list {
                    max-height: 280px;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    padding-right: 4px;
                }
                /* Custom Scrollbar */
                .macro-list::-webkit-scrollbar {
                    width: 6px;
                }
                .macro-list::-webkit-scrollbar-track {
                    background: rgba(0,0,0,0.1);
                }
                .macro-list::-webkit-scrollbar-thumb {
                    background: rgba(203, 163, 92, 0.2);
                    border-radius: 3px;
                }
                .macro-list::-webkit-scrollbar-thumb:hover {
                    background: rgba(203, 163, 92, 0.4);
                }
                .macro-row {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    background: rgba(255,255,255,0.03);
                    border: 1px solid rgba(255,255,255,0.05);
                    padding: 10px 12px;
                    border-radius: 10px;
                    transition: border-color 0.2s;
                }
                .macro-row:focus-within {
                    border-color: rgba(203, 163, 92, 0.25);
                }
                .macro-input {
                    background: rgba(0,0,0,0.3);
                    border: 1px solid rgba(255,255,255,0.1);
                    color: #fff;
                    padding: 8px 12px;
                    border-radius: 6px;
                    font-size: 13px;
                    transition: all 0.2s;
                }
                .macro-input:focus {
                    outline: none;
                    border-color: #ffd166;
                    box-shadow: 0 0 8px rgba(255,209,102,0.25);
                }
                .macro-input-lbl {
                    flex: 2;
                }
                .macro-input-cmd {
                    flex: 3;
                    font-family: monospace;
                }
                .macro-del-btn {
                    background: rgba(239, 68, 68, 0.1);
                    border: 1px solid rgba(239, 68, 68, 0.2);
                    color: #f87171;
                    cursor: pointer;
                    width: 32px;
                    height: 32px;
                    border-radius: 6px;
                    display: grid;
                    place-items: center;
                    transition: all 0.2s;
                }
                .macro-del-btn:hover {
                    background: rgba(239, 68, 68, 0.2);
                    border-color: #ef4444;
                    color: #fff;
                }
                .macro-add-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    background: rgba(16, 185, 129, 0.1);
                    border: 1px dashed rgba(16, 185, 129, 0.4);
                    color: #34d399;
                    font-weight: 700;
                    padding: 10px;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.2s;
                    font-size: 13px;
                }
                .macro-add-btn:hover {
                    background: rgba(16, 185, 129, 0.18);
                    border-color: #10b981;
                    color: #fff;
                }
                .macro-footer {
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                    border-top: 1px solid rgba(255,255,255,0.08);
                    padding-top: 14px;
                }
                .btn-save {
                    background: linear-gradient(135deg, #ffd166, #cba35c);
                    color: #0b0f19;
                    font-weight: 800;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.2s;
                    font-size: 14px;
                }
                .btn-save:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(203, 163, 92,0.3);
                }
                .btn-cancel {
                    background: transparent;
                    border: 1px solid rgba(255,255,255,0.2);
                    color: #94a3b8;
                    font-weight: 600;
                    padding: 10px 20px;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.2s;
                    font-size: 14px;
                }
                .btn-cancel:hover {
                    background: rgba(255,255,255,0.05);
                    color: #fff;
                }
            </style>
            <div class="macro-window">
                <div class="macro-header">
                    <div class="macro-title">
                        <i class="fas fa-wand-magic-sparkles"></i> Action Wheel Macro Builder
                    </div>
                </div>
                <div class="macro-desc">
                    Build custom shortcut macros to easily execute complex narrative actions or commands. Macros will appear dynamically as slices in your Action Wheel menu (up to 7 items total, ordered sequentially).
                </div>
                <div class="macro-list" id="uie-macro-list-container">
                    ${localMacros.length === 0 ? `
                        <div style="text-align:center; padding: 20px; color: #64748b; font-size:13px;">
                            No custom macros created yet. Click "Add Custom Macro" below!
                        </div>
                    ` : localMacros.map((macro, idx) => `
                        <div class="macro-row" data-macro-row-idx="${idx}">
                            <input type="text" class="macro-input macro-input-lbl" placeholder="Label (e.g. Inspect Mirror)" value="${escHtml(macro.label || '')}" data-field="label">
                            <input type="text" class="macro-input macro-input-cmd" placeholder="Command or prompt string" value="${escHtml(macro.command || '')}" data-field="command">
                            <button class="macro-del-btn" data-action="delete" title="Delete macro">
                                <i class="fas fa-trash-can"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>
                <button class="macro-add-btn" id="uie-macro-add-row-btn">
                    <i class="fas fa-plus"></i> Add Custom Macro
                </button>
                <div class="macro-footer">
                    <button class="btn-cancel" id="uie-macro-cancel-btn">Cancel</button>
                    <button class="btn-save" id="uie-macro-save-btn">Save Macros</button>
                </div>
            </div>
        `;

        // Attach event listeners
        modal.querySelector("#uie-macro-add-row-btn").addEventListener("click", () => {
            if (localMacros.length >= 7) {
                notify("warning", "You can have a maximum of 7 custom macros!", "Macro Builder");
                return;
            }
            localMacros.push({ label: "", command: "" });
            renderModalBody();
        });

        modal.querySelectorAll(".macro-row").forEach(row => {
            const idx = Number(row.dataset.macroRowIdx);
            row.querySelectorAll(".macro-input").forEach(input => {
                input.addEventListener("input", (e) => {
                    const field = e.target.dataset.field;
                    localMacros[idx][field] = e.target.value;
                });
            });
            row.querySelector("[data-action='delete']").addEventListener("click", () => {
                localMacros.splice(idx, 1);
                renderModalBody();
            });
        });

        modal.querySelector("#uie-macro-cancel-btn").addEventListener("click", () => {
            modal.style.display = "none";
        });

        modal.querySelector("#uie-macro-save-btn").addEventListener("click", () => {
            const cleaned = localMacros.map(m => ({
                label: String(m.label || "").trim(),
                command: String(m.command || "").trim()
            })).filter(m => m.label || m.command);

            const incomplete = cleaned.some(m => !m.label || !m.command);
            if (incomplete) {
                notify("warning", "Please fill in both the Label and Command for all macros!", "Macro Builder");
                return;
            }

            s.actionWheel.customMacros = cleaned;
            saveSettings();
            commitStateUpdate();
            modal.style.display = "none";
            notify("success", "Custom macros saved successfully!", "Macro Builder");

            // Re-render Action Wheel with current standard options
            const currentOpts = window._uieActionWheelOptions || [];
            renderActionWheel(currentOpts);
        });
    }

    modal.style.display = "flex";
    renderModalBody();
}

function handleActionWheelClick(e) {
    const container = document.getElementById("uie-action-wheel");
    if (!container || container.style.display === "none") return;

    if (e.target === container || e.target.id === "uie-action-wheel") {
        toggleActionWheel(false);
        return;
    }
    const close = e.target.closest("[data-aw-close]");
    if (close) {
        toggleActionWheel(false);
        return;
    }
    const hide = e.target.closest("[data-aw-hide]");
    if (hide) {
        const s = getSettings();
        if (!s.actionWheel) s.actionWheel = {};
        s.actionWheel.hidden = true;
        saveSettings();
        toggleActionWheel(false);
        document.getElementById("uie-action-wheel-fab")?.remove();
        notify("info", "Action wheel hidden. Re-enable it from the visibility menu.", "Action Wheel");
        return;
    }
    const btn = e.target.closest(".aw-menu-action[data-aw-idx]");
    if (!btn) return;
    const idx = Number(btn.dataset.awIdx);
    const options = window._uieActionWheelOptions || [];
    const opt = options[idx];
    if (!opt) return;

    e.preventDefault();
    e.stopPropagation();

    if (opt.isObstacle) {
        toggleActionWheel(false);
        import("./interactables.js").then((mod) => {
            mod.resolveObstacle(opt.placement, opt.obstacle);
        }).catch(err => {
            notify("error", `Failed to load obstacle resolver: ${err.message}`, "Action Wheel");
        });
        return;
    }

    // Deduct costs
    if (opt.cost && typeof opt.cost === "object") {
        const s = getSettings();
        ensureGameModeState(s);
        for (const [key, val] of Object.entries(opt.cost)) {
            const n = Number(val || 0);
            if (!n) continue;
            const statKey = key.toLowerCase();
            if (statKey === "gold" || statKey === "currency" || statKey === "money") {
                if (!spendCurrency(s, n)) {
                    notify("warning", `Not enough currency for ${opt.label}!`, "Action Wheel");
                    return;
                }
            } else if (s[statKey] !== undefined) {
                if (Number(s[statKey] || 0) < n) {
                    notify("warning", `Not enough ${key} for ${opt.label}!`, "Action Wheel");
                    return;
                }
                s[statKey] = Math.max(0, Number(s[statKey] || 0) - n);
                flashTracker(statKey);
            }
        }
        renderModeHud();
        saveSettings();
    }

    // Play click burst animation
    btn.classList.add("aw-burst-active");
    
    // Hide wheel and send input after animation
    setTimeout(() => {
        container.dataset.open = "false";
        container.style.display = "none";
        const fab = document.getElementById("uie-action-wheel-fab");
        if (fab) fab.style.display = "grid";
        btn.classList.remove("aw-burst-active");

        // Send label or custom macro command back to AI as user input
        const label = String(opt.isCustomMacro ? opt.command : (opt.label || "")).trim();
        if (!label) return;
        const targets = [
            document.getElementById("user-input"),
            document.getElementById("re-user-input"),
            document.querySelector("textarea#send_textarea"),
            document.querySelector("textarea#send_text"),
            document.querySelector("textarea")
        ];
        for (const target of targets) {
            if (!target) continue;
            target.value = label;
            try { target.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
            try { target.focus(); } catch (_) {}
            // Auto-send
            try {
                const sendBtn = document.getElementById("send-btn") || document.getElementById("send_but") || document.querySelector("[id*='send']");
                if (sendBtn) setTimeout(() => sendBtn.click(), 100);
            } catch (_) {}
            break;
        }
    }, 280);
}

// ─── Init ──────────────────────────────────────────────────────
let mutatorInited = false;

export function initStateMutator() {
    if (mutatorInited) return;
    mutatorInited = true;

    // Delegate codex link clicks
    document.body.addEventListener("click", (e) => {
        const link = e.target.closest(".codex-link");
        if (link) {
            e.preventDefault();
            e.stopPropagation();
            openCodexEntry(link.dataset.id);
            return;
        }
        handleActionWheelClick(e);
    });

    // Ensure codex array
    try {
        const s = getSettings();
        if (!s.world || typeof s.world !== "object") s.world = {};
        if (!s.journal || typeof s.journal !== "object") s.journal = {};
        if (!Array.isArray(s.journal.codex)) s.journal.codex = Array.isArray(s.world.codex) ? s.world.codex : [];
        s.world.codex = s.journal.codex;
        if (!s.world.combatStats || typeof s.world.combatStats !== "object") s.world.combatStats = { wins: 0, losses: 0 };
    } catch (_) {}

    console.log("[StateMutator] Initialized");
}

/**
 * Main entry point called from world.js updateFromChat
 * Processes the raw AI text, returns the narrative string for VN display.
 */
export function handleAIResponse(rawText) {
    const { narrative, data } = parseAIResponse(rawText);

    // Process state updates
    try { processStateUpdates(data.state_updates); } catch (e) {
        console.error("[StateMutator] processStateUpdates failed:", e);
    }

    // Process NPC secret updates from FastAPI
    try {
        const patches = data?.npcSecretUpdates || data?.state_updates?.npcSecretUpdates;
        if (Array.isArray(patches) && patches.length) {
            import("./npcManagementModal.js").then(mod => {
                mod.applySecretPatches?.(patches);
            });
        }
    } catch (e) {
        console.error("[StateMutator] applySecretPatches failed:", e);
    }

    const visibleNarrative = sanitizeVisibleNarrative(narrative, buildNarrativeFallback());

    // Return narrative with codex links injected
    try {
        return injectCodexLinks(visibleNarrative);
    } catch (_) {
        return visibleNarrative;
    }
}
