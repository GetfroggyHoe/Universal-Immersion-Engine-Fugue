import { getSettings, saveSettings } from "./core.js";

const DEFAULT_TRACKER_COLORS = ["#89b4fa", "#f38ba8", "#a6e3a1", "#f9e2af", "#cba6f7", "#94e2d5"];

function cleanText(value, limit = 1200) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function slug(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 60);
}

function currentLocationName(s) {
    return cleanText(s?.worldState?.location || s?.realityEngine?.locationId || "Unknown", 120) || "Unknown";
}

function normalizeLocationKey(value) {
    return cleanText(value, 160).toLowerCase();
}

function arrayify(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.values(value);
    return [];
}

function trackerFromLegacy(s, key, label, color, fallbackMax = 100) {
    const cur = Number(s?.[key] ?? 0);
    const max = Math.max(1, Number(s?.[`max${key.charAt(0).toUpperCase()}${key.slice(1)}`] ?? fallbackMax));
    if (!Number.isFinite(cur) && !Number.isFinite(max)) return null;
    return {
        id: key,
        name: label,
        current: Number.isFinite(cur) ? cur : max,
        max,
        color,
        visible: true,
        tags: [key]
    };
}

export function ensureGlobalStateLedger(s = getSettings()) {
    if (!s.gameState || typeof s.gameState !== "object") s.gameState = {};
    const g = s.gameState;

    if (!Array.isArray(g.player_trackers)) g.player_trackers = [];
    const existing = new Set(g.player_trackers.map((t) => normalizeLocationKey(t?.name || t?.id)).filter(Boolean));
    const life = Array.isArray(s?.life?.trackers) ? s.life.trackers : [];
    for (const [idx, t] of life.entries()) {
        const name = cleanText(t?.name || t?.id || `Tracker ${idx + 1}`, 80);
        if (!name || existing.has(normalizeLocationKey(name))) continue;
        g.player_trackers.push({
            id: cleanText(t?.id || slug(name) || `tracker_${idx + 1}`, 80),
            name,
            current: Number(t?.current ?? 0) || 0,
            max: Math.max(1, Number(t?.max ?? 100) || 100),
            color: cleanText(t?.color || DEFAULT_TRACKER_COLORS[idx % DEFAULT_TRACKER_COLORS.length], 32),
            visible: t?.visible !== false,
            tags: Array.isArray(t?.tags) ? t.tags.slice(0, 8) : []
        });
        existing.add(normalizeLocationKey(name));
    }
    [
        trackerFromLegacy(s, "hp", "HP", "#ef4444"),
        trackerFromLegacy(s, "mp", "MP", "#3b82f6", 50),
        trackerFromLegacy(s, "ap", "AP", "#f59e0b", 10),
        trackerFromLegacy(s, "stamina", "Stamina", "#22c55e")
    ].filter(Boolean).forEach((t) => {
        if (existing.has(normalizeLocationKey(t.name))) return;
        g.player_trackers.push(t);
        existing.add(normalizeLocationKey(t.name));
    });

    if (!Array.isArray(g.relationships)) {
        const rel = arrayify(s?.relationships).concat(arrayify(s?.social?.friends), arrayify(s?.social?.associates), arrayify(s?.social?.romance), arrayify(s?.social?.rivals));
        g.relationships = rel
            .map((p) => ({
                name: cleanText(p?.name || p?.identity?.name, 100),
                affinity: Number(p?.affinity ?? p?.relationship ?? 50) || 50,
                mood: cleanText(p?.mood || p?.currentMood || "neutral", 80),
                location: cleanText(p?.location || p?.currentLocation || "", 140),
                tags: Array.isArray(p?.tags) ? p.tags.slice(0, 12) : [],
                hidden_memories: arrayify(p?.hidden_memories || p?.hiddenMemories || p?.coreMemories || p?.memories)
                    .map((m) => cleanText(typeof m === "string" ? m : (m?.text || m?.summary || m?.title), 260))
                    .filter(Boolean)
                    .slice(0, 10)
            }))
            .filter((p) => p.name)
            .slice(0, 80);
    }
    if (!Array.isArray(g.active_rules)) {
        const rules = [];
        if (Array.isArray(s?.worldState?.activeRules)) rules.push(...s.worldState.activeRules);
        if (Array.isArray(s?.rules)) rules.push(...s.rules);
        g.active_rules = rules.map((r) => typeof r === "string" ? r : cleanText(r?.text || r?.rule || "", 240)).filter(Boolean).slice(0, 120);
    }
    if (!Array.isArray(g.global_events)) g.global_events = [];
    if (typeof g.time !== "string") g.time = cleanText(s?.calendar?.rpDate || new Date().toLocaleString(), 120);

    return g;
}

export function buildSystemPrompt(currentLocation = "", presentEntities = []) {
    const s = getSettings();
    const g = ensureGlobalStateLedger(s);
    const locName = cleanText(currentLocation || currentLocationName(s), 140) || "Unknown";
    const locKey = normalizeLocationKey(locName);
    const entities = arrayify(presentEntities).map((e) => cleanText(typeof e === "string" ? e : (e?.name || e?.id), 100)).filter(Boolean);
    const entityKeys = new Set(entities.map(normalizeLocationKey));
    const room = s?.worldState?.areaScenes?.[locName] || s?.worldState?.rooms?.[locName] || {};
    const vibe = cleanText(room?.vibe || room?.lighting || room?.summary || s?.worldState?.sceneSummary || "local scene", 220);

    const filteredRules = g.active_rules.filter((r) => {
        const text = String(r || "");
        const lower = text.toLowerCase();
        return !/\bloc(?:ation)?\s*[:=]/i.test(text) || lower.includes(locKey);
    }).slice(0, 12);
    const relevantEvents = g.global_events.filter((e) => {
        const text = cleanText(typeof e === "string" ? e : (e?.text || e?.summary || e?.memory), 260);
        const lower = text.toLowerCase();
        return lower.includes(locKey) || entities.some((n) => lower.includes(normalizeLocationKey(n)));
    }).slice(-8);
    const present = g.relationships.filter((npc) => {
        const n = normalizeLocationKey(npc?.name);
        const npcLoc = normalizeLocationKey(npc?.location);
        return entityKeys.has(n) || (!!npcLoc && npcLoc === locKey);
    }).slice(0, 12);

    const entityLines = present.map((npc) => {
        const memories = arrayify(npc?.hidden_memories || npc?.Hidden_Memories)
            .map((m) => cleanText(m, 180))
            .filter(Boolean)
            .slice(0, 3)
            .join(" | ");
        return `- ${npc.name}: Mood=${cleanText(npc.mood || "neutral", 60)}, Affinity=${Number(npc.affinity ?? 50)}${memories ? `, Relevant Hidden Memories=${memories}` : ""}`;
    });

    return [
        `[System Context: ${cleanText(g.time || new Date().toLocaleString(), 120)}, ${locName}, ${vibe}]`,
        `[Active Rules: ${filteredRules.length ? filteredRules.join(" | ") : "none"}]`,
        `[Entities Present]\n${entityLines.length ? entityLines.join("\n") : "- none"}]`,
        `[Recent Local Events: ${relevantEvents.length ? relevantEvents.map((e) => cleanText(typeof e === "string" ? e : (e?.text || e?.summary || e?.memory), 180)).join(" | ") : "none"}]`
    ].join("\n");
}

function recentSceneSummary(s) {
    const re = s?.realityEngine && typeof s.realityEngine === "object" ? s.realityEngine : {};
    const arch = re.architecture && typeof re.architecture === "object" ? re.architecture : {};
    return cleanText(arch.sceneSummary || s?.current_scene_summary || s?.worldState?.sceneSummary || "", 900);
}

function recentChatTail(limit = 3) {
    try {
        const w = typeof window !== "undefined" ? window : globalThis;
        const ctx = typeof w?.getContext === "function" ? w.getContext() : null;
        const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
        return chat.slice(-limit).map((m) => {
            const isUser = m?.is_user === true || m?.isUser === true || m?.role === "user";
            const name = cleanText(m?.name || (isUser ? "Player" : "Story"), 80);
            const text = cleanText(m?.mes || m?.text || m?.message || "", 360);
            return text ? `${name}: ${text}` : "";
        }).filter(Boolean).join("\n");
    } catch (_) {
        return "";
    }
}

function parseAutoChartPayload(raw = "") {
    const parts = String(raw || "").split("|").map(x => cleanText(x, 220));
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    return {
        name: parts[0].slice(0, 80),
        type: parts[1].slice(0, 60),
        desc: parts.slice(2).join(" | ").slice(0, 260)
    };
}

export function ensureRealityArchitecture(s = getSettings()) {
    if (!s.realityEngine || typeof s.realityEngine !== "object") s.realityEngine = {};
    const re = s.realityEngine;
    if (!re.architecture || typeof re.architecture !== "object") re.architecture = {};
    const arch = re.architecture;
    if (typeof arch.freeMode !== "boolean") arch.freeMode = false;
    if (typeof arch.ironWall !== "boolean") arch.ironWall = true;
    if (!arch.littleSister || typeof arch.littleSister !== "object") arch.littleSister = {};
    if (!Array.isArray(arch.localObservations)) arch.localObservations = [];
    if (typeof arch.sceneSummary !== "string") arch.sceneSummary = "";
    if (typeof s.current_scene_summary !== "string") s.current_scene_summary = arch.sceneSummary || "";
    if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
    if (!s.worldState.physicality || typeof s.worldState.physicality !== "object") {
        s.worldState.physicality = { noPocketVehicles: true, requireInteractiveTransitions: true };
    }
    if (typeof s.worldState.physicality.noPocketVehicles !== "boolean") s.worldState.physicality.noPocketVehicles = true;
    if (typeof s.worldState.physicality.requireInteractiveTransitions !== "boolean") s.worldState.physicality.requireInteractiveTransitions = true;
    return arch;
}

export function buildLittleSisterSystemNote(seedText = "") {
    const s = getSettings();
    const arch = ensureRealityArchitecture(s);
    const text = cleanText(seedText, 900);
    const lower = text.toLowerCase();
    const intents = [];
    if (/\b(sneak|hide|stealth|creep)\b/i.test(text)) intents.push("sneaking");
    if (/\b(steal|pickpocket|shoplift|loot|rob)\b/i.test(text)) intents.push("stealing");
    if (/\b(knock|doorbell|buzz)\b/i.test(text)) intents.push("knocking");
    if (/\b(lockpick|pick the lock|force the lock|break in)\b/i.test(lower)) intents.push("forced_entry");
    if (/\b(call|text|message|dm)\b/i.test(text)) intents.push("communication");
    if (/\b(register|counter|cashier|checkout)\b/i.test(text)) intents.push("shop_counter_interaction");
    if (/\b(elevator|stairs|stairwell|ladder|keypad)\b/i.test(text)) intents.push("z_axis_transition");
    if (/\b(car|truck|bike|ship|shuttle|vehicle)\b/i.test(text)) intents.push("vehicle_physicality");

    const obs = {
        at: Date.now(),
        locId: currentLocationName(s),
        intents: Array.from(new Set(intents)).slice(0, 10),
        text: text.slice(0, 420)
    };
    arch.localObservations.push(obs);
    if (arch.localObservations.length > 40) arch.localObservations.splice(0, arch.localObservations.length - 40);
    if (text) {
        arch.sceneSummary = cleanText(`${recentSceneSummary(s)} ${text}`, 900);
        s.current_scene_summary = arch.sceneSummary;
    }
    saveSettings();

    const active = obs.intents.length ? obs.intents.join(", ") : "none";
    return [
        "[SYSTEM NOTE: LITTLE_SISTER_OBSERVER]",
        `locId=${obs.locId}`,
        `parsed_intents=${active}`,
        "rules=state-local-only; narration-cloud-only; vehicles-physical; private-units-require-entry-action; shop-inventory-requires-counter-register-dom-interaction",
        recentSceneSummary(s) ? `scene_summary=${recentSceneSummary(s)}` : "scene_summary=none"
    ].join("\n");
}

export function buildBigSisterNarrationDirectives(seedText = "") {
    const s = getSettings();
    const arch = ensureRealityArchitecture(s);
    const note = buildLittleSisterSystemNote(seedText);
    const loc = currentLocationName(s);
    const ironWall = arch.ironWall !== false ? "enabled" : "soft";
    return [
        "[REALITY_ENGINE: TWO_SISTERS_PROTOCOL]",
        "Big Sister writes cinematic narration and dialogue only from the current scene_context, Little Sister notes, and active persona data.",
        "Do not manage, invent, or directly mutate stats, inventory, currency, schedules, laws, affinity, or UI state.",
        "Maintain strict character separation. Do not let one character know private facts assigned only to another character.",
        "Dialogue must be written as <Name>: Dialogue on its own line when frontend interception is needed.",
        "Use physical spatial logic: no pocket dimensions; vehicles remain parked/docked at a locId; floor changes require an in-scene transition object.",
        "For shops, narrate the shopkeeper greeting on entry, but do not show inventory until the player interacts with the register, counter, shelf, or equivalent DOM object.",
        "If a new adjacent place is established, emit one final machine line only when needed: [AUTO_CHART: Display Name | Type | Description].",
        `IronWall=${ironWall}`,
        `ActiveLoc=${loc}`,
        note
    ].join("\n");
}

export function shouldUseLittleSisterFallback(errorLike = null) {
    const s = getSettings();
    const arch = ensureRealityArchitecture(s);
    if (arch.freeMode === true) return true;
    const msg = String(errorLike?.message || errorLike || "");
    return /\b429\b|rate\s*limit|quota|too many requests/i.test(msg);
}

export async function generateLittleSisterFallback(seedText = "") {
    const s = getSettings();
    const arch = ensureRealityArchitecture(s);
    const local = typeof window !== "undefined" ? (window.ai || window.LanguageModel || null) : null;
    const prompt = [
        "Reply as emergency local narration under 50 words.",
        "No JSON, no markdown, no stat changes.",
        `Location: ${currentLocationName(s)}`,
        recentSceneSummary(s) ? `Summary: ${recentSceneSummary(s)}` : "Summary: none",
        recentChatTail(3) ? `Last 3 messages:\n${recentChatTail(3)}` : "Last 3 messages: none",
        `Player: ${cleanText(seedText, 500)}`
    ].join("\n");
    let out = "";
    try {
        if (local?.prompt) out = await local.prompt(prompt);
        else if (local?.createTextSession) {
            const session = await local.createTextSession();
            out = await session.prompt(prompt);
        } else if (local?.create) {
            const session = await local.create();
            out = await session.prompt(prompt);
        }
    } catch (_) {
        out = "";
    }
    out = cleanText(out, 360);
    if (!out) out = "The moment tightens around you. Details stay grounded in the current place as you choose what to do next.";
    arch.lastFallbackAt = Date.now();
    arch.lastFallbackReason = "little_sister_understudy";
    arch.sceneSummary = cleanText(`${recentSceneSummary(s)} ${seedText} ${out}`, 900);
    s.current_scene_summary = arch.sceneSummary;
    saveSettings();
    return out;
}

export function stripAutoChartTags(text = "") {
    return String(text || "").replace(/\[\s*AUTO_CHART\s*:[^\]]+\]/gi, "").trim();
}

export function consumeAutoChartTags(text = "") {
    const src = String(text || "");
    const matches = Array.from(src.matchAll(/\[\s*AUTO_CHART\s*:\s*([^|]+)\|\s*([^|]+)\|\s*([^\]]+)\]/gi));
    if (!matches.length) return [];
    const s = getSettings();
    ensureRealityArchitecture(s);
    if (!s.worldState.mapData || typeof s.worldState.mapData !== "object") s.worldState.mapData = { nodes: [] };
    if (!Array.isArray(s.worldState.mapData.nodes)) s.worldState.mapData.nodes = [];
    if (!s.mapData || typeof s.mapData !== "object") s.mapData = { custom_nodes: [] };
    if (!Array.isArray(s.mapData.custom_nodes)) s.mapData.custom_nodes = [];
    const nodes = s.worldState.mapData.nodes;
    const current = currentLocationName(s);
    const baseX = Number.isFinite(Number(s.worldState.x)) ? Number(s.worldState.x) : 0;
    const baseY = Number.isFinite(Number(s.worldState.y)) ? Number(s.worldState.y) : 0;
    const markerX = Number.isFinite(Number(s.map?.marker?.x)) ? Number(s.map.marker.x) : 0.5;
    const markerY = Number.isFinite(Number(s.map?.marker?.y)) ? Number(s.map.marker.y) : 0.5;
    const made = [];
    for (const match of matches) {
        const parsed = parseAutoChartPayload(`${match?.[1] || ""}|${match?.[2] || ""}|${match?.[3] || ""}`);
        if (!parsed) continue;
        const name = parsed.name;
        const id = slug(name) || `auto_${Date.now()}`;
        if (nodes.some(n => slug(n?.id || n?.name) === id)) continue;
        const node = {
            id,
            name,
            type: parsed.type,
            desc: parsed.desc,
            adjacentTo: current,
            originX: baseX,
            originY: baseY,
            x: baseX + 1,
            y: baseY,
            discoveredBy: "auto_chart",
            createdAt: Date.now()
        };
        const customNode = {
            id,
            name,
            type: parsed.type,
            desc: parsed.desc,
            x: Math.max(4, Math.min(96, markerX * 100 + 8)),
            y: Math.max(4, Math.min(96, markerY * 100)),
            adjacentTo: current,
            discoveredBy: "auto_chart"
        };
        nodes.push(node);
        if (!s.mapData.custom_nodes.some(n => slug(n?.id || n?.name) === id)) s.mapData.custom_nodes.push(customNode);
        made.push(node);
    }
    if (made.length) saveSettings();
    return made;
}

export function normalizeSocialPhysicsContact(person) {
    if (!person || typeof person !== "object") return person;
    if (!person.persona_chip || typeof person.persona_chip !== "object") {
        person.persona_chip = {
            likes: cleanText(person.likes || "", 300),
            dislikes: cleanText(person.dislikes || "", 300),
            boundaries: cleanText(person.boundaries || "", 300)
        };
    }
    if (!Array.isArray(person.coreMemories)) person.coreMemories = [];
    if (!Array.isArray(person.temporaryStatuses)) person.temporaryStatuses = [];
    if (!person.grudge || typeof person.grudge !== "object") person.grudge = { active: false, reason: "", restitution: "" };
    if (typeof person.grudge.active !== "boolean") person.grudge.active = false;
    return person;
}
