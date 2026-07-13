/**
 * Omniscient / Narrator world layer: scene roster, macros, yield protocol, group turn helpers.
 * Character cards remain authoritative for voiced dialogue; narrator prompts must not steal their lines.
 */

import { getSettings, saveSettings } from "./core.js";

const DEFAULT_NARRATOR_CARD = {
    id: "narrator_default",
    name: "Omniscient Narrator",
    category: "narrator",
    voice_recipe: "pocket-tts-v1|||Pocket%20Narrator%20Reference|english",
    system: `[WORLD ENGINE — OMNISCIENT LAYER]
You are not a playable character and have no personal desires, romance, or inner hunger for plot. You run the living world.

IMMERSION: The setting is fully alive. NPCs have schedules, gripes, errands, gossip, and relationships that do not revolve around the user. Background conversations may be unrelated to the main thread.

AGENCY SPLIT:
- You portray environment, sensory detail, crowds, anonymous NPCs, and systemic consequences.
- {{forbidden_character_voices}} — never invent spoken dialogue or first-person interior monologue for those named card characters. If they must speak, end your segment with a clear handoff cue only: [CHARACTER_TURN:name] on its own line (no quoted line for them).

{{active_characters}}
{{interactive_objects}}
{{turn_roster}}
{{yield_protocol}}

INTERACTIVE OBJECTS: When you introduce or transform something the user could manipulate (doors, consoles, letters, vehicles, artifacts), add a short bracket tag the UI can track, e.g. [OBJECT id=desk_key state=on_desk] — keep ids stable if the object persists.`,
};

export function ensureOmniscientState(s) {
    if (!s || typeof s !== "object") return null;
    if (!s.omniscient || typeof s.omniscient !== "object") s.omniscient = {};
    const o = s.omniscient;
    if (!Array.isArray(o.sceneCharacterNames)) o.sceneCharacterNames = [];
    if (!Array.isArray(o.interactiveObjects)) o.interactiveObjects = [];
    o.interactiveObjects = o.interactiveObjects.filter((x) => x && typeof x === "object").slice(0, 48);
    if (typeof o.narratorEnabled !== "boolean") o.narratorEnabled = true;
    if (typeof o.narratorCharacterCardId !== "string") o.narratorCharacterCardId = "";
    if (!String(o.narratorCardId || "").trim()) o.narratorCardId = "narrator_default";
    if (!Array.isArray(o.narratorCards) || !o.narratorCards.length) {
        o.narratorCards = [JSON.parse(JSON.stringify(DEFAULT_NARRATOR_CARD))];
    }
    o.narratorCards.forEach((card) => {
        if (card && typeof card === "object" && !String(card.voice_recipe || "").trim()) {
            card.voice_recipe = DEFAULT_NARRATOR_CARD.voice_recipe;
        }
    });
    if (!o.group || typeof o.group !== "object") o.group = {};
    if (typeof o.group.autoResponse !== "boolean") o.group.autoResponse = false;
    if (!Number.isFinite(Number(o.group.autoResponseLimit))) o.group.autoResponseLimit = 3;
    if (!Array.isArray(o.group.mutedCharacterNames)) o.group.mutedCharacterNames = [];
    if (!Number.isFinite(Number(o.group.turnIndex))) o.group.turnIndex = 0;
    if (!Array.isArray(o.group.turnOrderNames)) o.group.turnOrderNames = [];
    if (typeof o.group.impersonateCharacterName !== "string") o.group.impersonateCharacterName = "";
    try {
        if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
        s.worldState.interactiveObjects = o.interactiveObjects;
    } catch (_) {}
    return o;
}

function normName(x) {
    return String(x || "")
        .trim()
        .toLowerCase();
}

export function buildSceneCardList(s, activeTarget = "") {
    ensureOmniscientState(s);
    const cards = Array.isArray(s.character_cards) ? s.character_cards : [];
    const byName = new Map();
    for (const c of cards) {
        const n = String(c?.name || "").trim();
        if (!n) continue;
        byName.set(normName(n), c);
    }
    const scene = [];
    const roster = Array.isArray(s.omniscient.sceneCharacterNames) ? s.omniscient.sceneCharacterNames : [];
    for (const raw of roster) {
        const n = String(raw || "").trim();
        if (!n) continue;
        const c = byName.get(normName(n));
        scene.push(c || { name: n, id: "", _note: "roster_name_only" });
    }
    const at = String(activeTarget || "").trim();
    if (at && !scene.some((x) => normName(x?.name) === normName(at))) {
        const c = byName.get(normName(at));
        if (c) scene.unshift(c);
    }
    if (!scene.length && at) {
        const c = byName.get(normName(at));
        if (c) scene.push(c);
    }
    return scene;
}

export function formatActiveCharactersForMacro(sceneCards) {
    const lines = (Array.isArray(sceneCards) ? sceneCards : []).map((c, i) => {
        const name = String(c?.name || "Character").trim();
        const oneLiner = String(c?.description || c?.desc || c?.summary || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 200);
        return `${i + 1}. **${name}**${oneLiner ? ` — ${oneLiner}` : ""}`;
    });
    return lines.length ? lines.join("\n") : "(no active scene cards — use [ACTIVE TARGET] only)";
}

export function formatForbiddenVoicesForMacro(sceneCards, narratorCardName) {
    const names = (Array.isArray(sceneCards) ? sceneCards : []).map((c) => String(c?.name || "").trim()).filter(Boolean);
    const nar = String(narratorCardName || "").trim();
    const out = [];
    if (nar) {
        out.push(
            `- The omniscient layer (${nar}) never speaks as or thinks as any roster character below.`,
        );
    }
    for (const n of names) {
        out.push(
            `- Do **not** output dialogue or first-person lines for **${n}** while acting as narrator/world engine; their card model owns their voice.`,
        );
    }
    return out.join("\n") || "- (no named card roster restrictions)";
}

export function formatInteractiveObjectsMacro(objs) {
    const arr = Array.isArray(objs) ? objs : [];
    return arr
        .slice(0, 32)
        .map((o, i) => {
            const label = String(o?.label || o?.name || "object").trim();
            const st = String(o?.state || "").trim();
            const id = String(o?.id || "").trim();
            return `${i + 1}. ${label}${id ? ` [id:${id}]` : ""}${st ? ` — ${st}` : ""}`;
        })
        .join("\n") || "(no tracked objects — invent sparingly with [OBJECT id=…] tags when needed)";
}

export function formatTurnRoster(omniscient) {
    const o = omniscient && typeof omniscient === "object" ? omniscient : {};
    const order = Array.isArray(o.group?.turnOrderNames) ? o.group.turnOrderNames.map((x) => String(x || "").trim()).filter(Boolean) : [];
    if (!order.length) {
        return "(turn order not fixed — follow [ACTIVE TARGET] and scene logic)";
    }
    const idx = Math.max(0, Number(o.group?.turnIndex || 0)) % order.length;
    return order.map((n, i) => `${i === idx ? "→ " : "  "}${n}`).join("\n");
}

export function buildYieldProtocolBlock(role, sceneCards, narratorName) {
    const names = (Array.isArray(sceneCards) ? sceneCards : []).map((c) => String(c?.name || "").trim()).filter(Boolean);
    const roster = names.length ? names.join(", ") : "(none)";
    const nar = String(narratorName || "Narrator").trim();
    if (String(role || "").toLowerCase() === "character") {
        return [
            "[YIELD PROTOCOL — CHARACTER CARD SPEAKER]",
            "You are generating lines for **one** character card only. Stay first- or third-person consistent with that card.",
            `Do not narrate as omniscient author for other roster members (${roster}) in the same reply.`,
            "If others react, keep their dialogue implied or summarized unless their own turn runs.",
        ].join("\n");
    }
    return [
        "[YIELD PROTOCOL — OMNISCIENT NARRATOR]",
        `World voice (${nar}): environment, crowd texture, anonymous NPCs, off-topic conversations, systemic outcomes.`,
        `Roster with dedicated cards: ${roster}.`,
        "Forbidden: quoted speech or internal monologue for those roster names.",
        "If a roster character must speak next, end with a single line: [CHARACTER_TURN:ExactName]",
    ].join("\n");
}

export function applyOmniscientMacros(text, ctx = {}) {
    let out = String(text || "");
    const scene = Array.isArray(ctx.sceneCards) ? ctx.sceneCards : [];
    const o = ctx.omniscient && typeof ctx.omniscient === "object" ? ctx.omniscient : {};
    const narratorCard = ctx.narratorCard && typeof ctx.narratorCard === "object" ? ctx.narratorCard : {};
    const narratorName = String(ctx.narratorCardName || narratorCard.name || "Narrator").trim();
    const speakerRole = String(ctx.speakerRole || "narrator").toLowerCase() === "character" ? "character" : "narrator";

    const map = {
        active_characters: formatActiveCharactersForMacro(scene),
        forbidden_character_voices: formatForbiddenVoicesForMacro(scene, narratorName),
        interactive_objects: formatInteractiveObjectsMacro(o.interactiveObjects),
        turn_roster: formatTurnRoster(o),
        yield_protocol: buildYieldProtocolBlock(speakerRole, scene, narratorName),
    };

    for (const [k, v] of Object.entries(map)) {
        const re = new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "gi");
        out = out.replace(re, v);
    }
    return out;
}

function characterCardToNarratorVoice(cc) {
    if (!cc || typeof cc !== "object") return null;
    const name = String(cc.name || "Narrator").trim() || "Narrator";
    const sys = String(cc.system || cc.systemPrompt || cc.bio || cc.description || cc.desc || "")
        .replace(/\s+/g, " ")
        .trim();
    if (!sys) return null;
    return {
        id: `char_narr_${String(cc.id || "").trim() || "card"}`,
        name,
        category: "narrator",
        voice_recipe: String(cc.voice_recipe || cc.voiceRecipe || cc.tts?.voice_recipe || "").trim(),
        system: `[CHARACTER AS NARRATOR / WORLD VOICE — ${name}]\n${sys}\n\nUse this voice for the omniscient world layer. Character-card yield rules and forbidden voices still apply.`,
    };
}

export function getNarratorCard(s) {
    ensureOmniscientState(s);
    const charNarrId = String(s.omniscient.narratorCharacterCardId || "").trim();
    if (charNarrId) {
        const charCards = Array.isArray(s.character_cards) ? s.character_cards : [];
        const cc = charCards.find((c) => String(c?.id || "") === charNarrId);
        const fromChar = characterCardToNarratorVoice(cc);
        if (fromChar) return fromChar;
    }
    const id = String(s.omniscient.narratorCardId || "").trim();
    const cards = Array.isArray(s.omniscient.narratorCards) ? s.omniscient.narratorCards : [];
    const found = cards.find((c) => String(c?.id || "") === id) || cards[0];
    if (found && String(found.system || found.content || "").trim()) return found;
    return JSON.parse(JSON.stringify(DEFAULT_NARRATOR_CARD));
}

export function composeNarratorPromptPrefix(s) {
    ensureOmniscientState(s);
    if (!s.omniscient.narratorEnabled) return "";
    const card = getNarratorCard(s);
    const sys = String(card?.system || card?.content || "").trim();
    if (!sys) return "";
    const name = String(card?.name || "Narrator").trim();
    return `[OMNISCIENT NARRATOR / WORLD ENGINE — ${name}]\n${sys}`;
}

export function appendGenerationKindBlock(payload, kind) {
    const base = String(payload || "");
    const k = String(kind || "normal").toLowerCase();
    if (k === "regenerate") {
        return `${base}\n\n[REGENERATE MODE]\n- Same facts and scene contract; completely fresh wording and beat structure.\n- Do not reuse sentences from your previous assistant message.\n- If uncertain, change sensory focus and sentence rhythm.`;
    }
    if (k === "swipe") {
        return `${base}\n\n[SWIPE — ALTERNATE CONTINUATION]\n- Treat this as a new branch card: meaningfully different emotional angle, pacing, or emphasis.\n- Stay compatible with established lore, but avoid echoing the last reply’s phrasing.\n- Minimum change: alternate metaphor set + alternate micro-events.`;
    }
    return base;
}

export function pickNextSpeakerName(s) {
    ensureOmniscientState(s);
    const muted = new Set((s.omniscient.group.mutedCharacterNames || []).map(normName));
    const order = (s.omniscient.group.turnOrderNames || []).map((x) => String(x || "").trim()).filter(Boolean);
    const pool = order.length ? order : (s.omniscient.sceneCharacterNames || []).map((x) => String(x || "").trim()).filter(Boolean);
    if (!pool.length) return "";
    let idx = Math.max(0, Number(s.omniscient.group.turnIndex || 0));
    for (let step = 0; step < pool.length + 2; step++) {
        const name = pool[idx % pool.length];
        idx += 1;
        if (!name) continue;
        if (muted.has(normName(name))) continue;
        s.omniscient.group.turnIndex = idx % Math.max(1, pool.length);
        saveSettings();
        return name;
    }
    return "";
}

export function bumpTurnAfterCharacterReply(s, speakerName) {
    ensureOmniscientState(s);
    const order = (s.omniscient.group.turnOrderNames || []).map((x) => String(x || "").trim()).filter(Boolean);
    if (!order.length) return;
    const i = order.findIndex((n) => normName(n) === normName(speakerName));
    if (i >= 0) {
        s.omniscient.group.turnIndex = (i + 1) % order.length;
        saveSettings();
    }
}

export function parseObjectTagsFromText(text) {
    const src = String(text || "");
    const out = [];
    const re = /\[OBJECT\s+id=([^\s\]]+)(?:\s+state=([^\]]*))?\]/gi;
    let m;
    while ((m = re.exec(src)) !== null) {
        const id = String(m[1] || "").trim();
        const state = String(m[2] != null ? m[2] : "").trim() || "unknown";
        if (!id) continue;
        out.push({ id, label: id.replace(/_/g, " "), state });
    }
    return out;
}

export function mergeParsedObjectsIntoState(s, parsed) {
    if (!parsed || !parsed.length) return;
    ensureOmniscientState(s);
    const byId = new Map(s.omniscient.interactiveObjects.map((o) => [String(o?.id || ""), o]));
    for (const p of parsed) {
        if (!p?.id) continue;
        const prev = byId.get(p.id) || { id: p.id, label: p.label || p.id };
        byId.set(p.id, { ...prev, ...p, state: p.state || prev.state });
    }
    s.omniscient.interactiveObjects = Array.from(byId.values()).slice(0, 48);
    saveSettings();
}

export function initOmniscientEngine() {
    const s = getSettings();
    ensureOmniscientState(s);
    saveSettings();
}
