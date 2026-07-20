import { getSettings, saveSettings, updateLayout, commitStateUpdate as _commitFromCore } from "./core.js";
const commitStateUpdate = _commitFromCore;
import { normalizeSocialPhysicsContact } from "./twoSisters.js";
import { generateContent } from "./apiClient.js";
import { getContext } from "./gameContext.js";
import { notify } from "./notifications.js";
import { injectRpEvent } from "./features/rp_log.js";
import { getChatTranscriptText } from "./chatLog.js";
import { safeJsonParseObject } from "./jsonUtil.js";
import { SCAN_TEMPLATES } from "./scanTemplates.js";
import { isEntityLocationLocked, setEntityLocationLock } from "./roster.js";
import { getGlobalAgeing } from "./aging.js";
import { triggerSafetyWarning } from "./safetyScanner.js";
import { publishOrganizationIntel } from "./organizationIntelBus.js";

const SOCIAL_ROLE_MAP = {
    friends: ["Bestie", "Childhood Friend", "Rival Friend", "Confidant", "Acquaintance", "Mentor", "Partner-in-Crime"],
    romance: ["Married", "Lover", "Sneaky Link", "Star-Crossed", "Crush", "Partner", "Fiancé", "Ex-Lover"],
    family: [
        "Mother", "Father", "Sibling", "Brother", "Sister",
        "Step-Brother", "Step-Sister", "Half-Brother", "Half-Sister",
        "Step-Mother", "Step-Father", "Son", "Daughter", "Step-Son",
        "Step-Daughter", "Grandmother", "Grandfather", "Great-Grandmother",
        "Great-Grandfather", "Grandson", "Granddaughter", "Uncle", "Aunt",
        "Nephew", "Niece", "Cousin", "Ancestor", "Descendant", "Heir",
        "Successor", "Guardian", "Ward", "Spouse", "Fiance", "Twin"
    ],
    associates: ["Colleague", "Classmate", "Neighbor", "Business Partner", "Co-Worker", "Client"],
    rivals: ["Nemesis", "Archenemy", "Friendly Rival", "Academic Rival", "Romantic Rival", "Frenemy"]
};

const SOCIAL_CATEGORY_LABELS = {
    friends: "Friend", romance: "Relationship", family: "Family", associates: "Associate", rivals: "Rival"
};

let currentTab = "friends";
let deleteMode = false;
let selectedForDelete = [];
let tempImgBase64 = null;
let isInitialized = false;
let editingIndex = null;
let activeProfileIndex = null;
let socialLongPressTimer = null;
let socialLongPressFired = false;
const autoScanRuntime = (() => {
    try {
        window.__uieSocialAutoScanRuntime = window.__uieSocialAutoScanRuntime || {
            timer: null,
            inFlight: false,
            lastAt: 0,
            lastSig: "",
        };
        return window.__uieSocialAutoScanRuntime;
    } catch (_) {
        return { timer: null, inFlight: false, lastAt: 0, lastSig: "" };
    }
})();
let avatarLookupCache = new Map();
let avatarLookupSig = "";

const SOCIAL_AUTO_SCAN_INTERVAL_MS = 30000;

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/** Area scene roster merged with omniscient scene list (deduped). */
function collectMergedScenePeopleNames(s, loc) {
    const raw = s?.worldState?.areaScenes?.[loc]?.characters;
    const sceneList = Array.isArray(raw) ? raw.map((x) => String(x || "").trim()).filter(Boolean) : [];
    const omni = Array.isArray(s?.omniscient?.sceneCharacterNames) ? s.omniscient.sceneCharacterNames : [];
    const omniNames = omni.map((x) => String(x || "").trim()).filter(Boolean);
    const map = new Map();
    for (const n of [...sceneList, ...omniNames]) {
        const k = n.toLowerCase();
        if (!n || map.has(k)) continue;
        map.set(k, n);
    }
    return [...map.values()];
}

function newId(prefix) {
    return `${String(prefix || "id")}_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}`;
}

function normalizeAffinity(value, fallback = 50) {
    const fb = Number.isFinite(Number(fallback)) ? Number(fallback) : 50;
    const n = Number(value);
    if (!Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(fb)));
    return Math.max(0, Math.min(100, Math.round(n)));
}

function cleanFieldValue(value, maxLen = 160) {
    const cap = Math.max(1, Number(maxLen) || 160);
    return String(value ?? "").trim().slice(0, cap);
}

function firstNonEmpty(...values) {
    for (const v of values) {
        const s = String(v ?? "").trim();
        if (s) return s;
    }
    return "";
}

function toBoolFlag(value) {
    if (value === true) return true;
    if (value === false) return false;
    const s = String(value ?? "").trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "y";
}

function derivePresenceFlags(scanObj) {
    const presence = String(scanObj?.presence || "").trim().toLowerCase();
    const met =
        toBoolFlag(scanObj?.met_physically) ||
        presence === "present" ||
        presence === "in_scene" ||
        presence === "in scene" ||
        presence === "onscreen" ||
        presence === "met";
    const knownPast =
        !met &&
        (toBoolFlag(scanObj?.known_from_past) ||
            presence === "known_past" ||
            presence === "known past" ||
            presence === "from_past" ||
            presence === "from past" ||
            presence === "history");
    return { met, knownPast };
}

function inferContactEvidenceFromTranscript(transcript, name) {
    const src = String(transcript || "");
    const rawName = String(name || "").trim();
    if (!src || !rawName) return { met: false, knownPast: false };

    const escaped = escapeRegExp(rawName).replace(/\s+/g, "\\s+");
    const actionVerbs = "said|says|replied|replying|asked|asks|walked|walks|stands|stood|looked|looks|smiled|smiles|hugged|hugs|attacked|attacks|called|calls|texted|texts|waved|waves|approached|approaches|joined|joins|followed|follows|traveled|travels|sat|sits|spoke|speaks";
    const historyTerms = "knew|known|remembered|remembers|remember|used\\s+to|former|ex(?:-|\\s)|childhood|grew\\s+up\\s+with|from\\s+the\\s+past|old\\s+friend|old\\s+rival|family|sibling|parent|mother|father|brother|sister|cousin|uncle|aunt|spouse|wife|husband";

    const speaker = new RegExp(`(^|\\n)\\s*(?:${escaped}|[\"'\\[]${escaped}[\"'\\]])\\s*[:\\-]`, "im").test(src);
    const tagged = new RegExp(`<[^>]{0,80}\\b${escaped}\\b[^>]{0,80}>`, "i").test(src);
    const directAction =
        new RegExp(`\\b${escaped}\\b[^\\n]{0,90}\\b(?:${actionVerbs})\\b`, "i").test(src) ||
        new RegExp(`\\b(?:${actionVerbs})\\b[^\\n]{0,90}\\b${escaped}\\b`, "i").test(src);
    const met = speaker || tagged || directAction;

    const knownPast =
        !met &&
        (
            new RegExp(`\\b${escaped}\\b[^\\n]{0,90}\\b(?:${historyTerms})\\b`, "i").test(src) ||
            new RegExp(`\\b(?:${historyTerms})\\b[^\\n]{0,90}\\b${escaped}\\b`, "i").test(src)
        );

    return { met, knownPast };
}

function maybeUpdateTextField(person, field, value, maxLen = 160) {
    const next = cleanFieldValue(value, maxLen);
    if (!next) return false;
    const prev = cleanFieldValue(person?.[field], maxLen);
    if (prev === next) return false;
    person[field] = next;
    return true;
}

function baseUrl() {
    try {
        const u = String(window.UIE_BASEURL || "");
        if (u) return u.endsWith("/") ? u : `${u}/`;
    } catch (_) {}
    return "/";
}

async function ensurePaperTemplate(name) {
    const nm = String(name || "").trim();
    if (!nm) return;
    try {
        if ($("#uie-phone-window").length === 0) {
            const modFetch = await (window.importUieModule ? window.importUieModule("templateFetch.js") : import("./templateFetch.js"));
            const html = await modFetch.fetchTemplateHtml(`${baseUrl()}src/templates/phone.html`);
            $("body").append(html);
        }
        const mod = await (window.importUieModule ? window.importUieModule("phone.js") : import("./phone.js"));
        if (typeof mod?.initPhone === "function") mod.initPhone();
        if (typeof window.UIE_phone_openThread === "function") window.UIE_phone_openThread(nm);
    } catch (e) {
        console.error("[UIE] Social message open failed", e);
        notify("error", "Phone messaging failed to open.", "UIE", "api");
    }
}

function resolveCurrentCharAvatarUrl() {
    try {
        const ctx = getContext?.();
        const c = ctx?.character || ctx?.char || ctx?.characterCard || (Array.isArray(ctx?.characters) ? ctx.characters[0] : null) || null;
        const card = c?.data?.data || c?.data || c || {};
        const direct =
            card?.avatar ||
            card?.avatar_url ||
            c?.avatar ||
            c?.avatar_url ||
            ctx?.avatar_url ||
            ctx?.char_avatar ||
            "";
        if (direct) return String(direct);

        const name2 = String(ctx?.name2 || "").trim().toLowerCase();
        if (name2) {
            const imgs = Array.from(document.querySelectorAll("img")).slice(0, 250);
            for (const img of imgs) {
                const alt = String(img?.alt || "").trim().toLowerCase();
                if (alt && alt.includes(name2) && img?.src) return String(img.src);
            }
        }
    } catch (_) {}
    return "";
}

function findAvatarForNameFromChat(name) {
    try {
        const chatNodes = Array.from(document.querySelectorAll("#chat .mes"));
        const tail = chatNodes.length ? chatNodes[chatNodes.length - 1] : null;
        const sig = `${chatNodes.length}|${String(tail?.getAttribute?.("mesid") || tail?.dataset?.mesId || "").trim()}`;
        if (sig !== avatarLookupSig) {
            avatarLookupSig = sig;
            avatarLookupCache = new Map();
        }
        const n = String(name || "").trim().toLowerCase();
        if (!n) return "";
        if (avatarLookupCache.has(n)) return String(avatarLookupCache.get(n) || "");
        const chatEl = document.querySelector("#chat");
        if (!chatEl) {
            avatarLookupCache.set(n, "");
            return "";
        }
        const nodes = Array.from(chatEl.querySelectorAll(".mes")).slice(-180).reverse();
        for (const m of nodes) {
            const nm =
                m.querySelector(".mes_name")?.textContent ||
                m.querySelector(".name_text")?.textContent ||
                m.querySelector(".name")?.textContent ||
                "";
            if (String(nm || "").trim().toLowerCase() !== n) continue;
            const img =
                m.querySelector(".mesAvatar img") ||
                m.querySelector(".mes_avatar img") ||
                m.querySelector(".avatar img");
            if (img?.src) {
                const src = String(img.src);
                avatarLookupCache.set(n, src);
                return src;
            }
        }
        avatarLookupCache.set(n, "");
    } catch (_) {}
    return "";
}

function normalizeSocial(s) {
    if(!s.social) s.social = { friends: [], associates: [], romance: [], family: [], rivals: [] };
    if (!s.socialMeta || typeof s.socialMeta !== "object") s.socialMeta = { autoScan: true, deletedNames: [] };
    if (typeof s.socialMeta.autoScan !== "boolean") s.socialMeta.autoScan = true;
    if (!Array.isArray(s.socialMeta.deletedNames)) s.socialMeta.deletedNames = [];
    if (typeof s.socialMeta.strictScan !== "boolean") s.socialMeta.strictScan = true;
    ["friends","associates","romance","family","rivals"].forEach(k => { if (!Array.isArray(s.social[k])) s.social[k] = []; });

    // Auto-Associate on Meet
    if (Array.isArray(s.character_cards)) {
        const activeCardIds = new Set();
        if (Array.isArray(s.gameCharacters)) {
            s.gameCharacters.forEach(id => { if (id) activeCardIds.add(String(id)); });
        }
        if (Array.isArray(s.sceneCharacters)) {
            s.sceneCharacters.forEach(x => {
                const id = x?.cardId || x?.id;
                if (id) activeCardIds.add(String(id));
            });
        }

        activeCardIds.forEach(cardId => {
            const card = s.character_cards.find(c => String(c?.id || "") === cardId);
            if (card && card.name) {
                const nameLower = card.name.toLowerCase().trim();
                
                // Check if already in social
                let exists = false;
                const categories = ["friends", "associates", "romance", "family", "rivals"];
                for (const cat of categories) {
                    if (Array.isArray(s.social[cat])) {
                        if (s.social[cat].some(p => String(p?.name || "").toLowerCase().trim() === nameLower)) {
                            exists = true;
                            break;
                        }
                    }
                }

                if (!exists) {
                    if (!s.social.associates) s.social.associates = [];
                    
                    const avatarUrl = card.url || (card.expressions && card.expressions[0]?.url) || (card.portrait_gallery && card.portrait_gallery[0]?.url) || "";
                    
                    s.social.associates.push({
                        id: newId("person"),
                        name: card.name,
                        thoughts: card.bio || card.personality || "Met through scene/game roster.",
                        likes: Array.isArray(card.likes) ? card.likes.join(", ") : (card.likes || ""),
                        dislikes: Array.isArray(card.dislikes) ? card.dislikes.join(", ") : (card.dislikes || ""),
                        birthday: card.birthday || "",
                        location: card.location || "",
                        age: card.age || "",
                        gender: card.gender || card.sex || "",
                        knownFamily: "",
                        familyRole: "",
                        relationshipStatus: "",
                        url: avatarUrl,
                        avatar: avatarUrl,
                        met_physically: true,
                        known_from_past: false,
                        liveSync: true,
                        mapTracked: false,
                        affinity: 50,
                        phoneNumber: card.phoneNumber || card.phone || "",
                        schedule: card.schedule || "",
                        wants: card.wants || "",
                        needs: card.needs || "",
                        desires: card.desires || "",
                        stats: card.stats || {},
                        standings: card.standings || "",
                        factions: Array.isArray(card.factions) ? card.factions : [],
                        currentAge: card.age !== "" && card.age !== undefined ? (Number(card.age) || 0) : 0,
                        birthDate: null,
                        agingMultiplier: 1.0,
                        lockedLocation: null,
                        sprite_macros: []
                    });
                }
                
                // Reset deleted name if they are met again
                if (s.socialMeta && Array.isArray(s.socialMeta.deletedNames)) {
                    s.socialMeta.deletedNames = s.socialMeta.deletedNames.filter(x => String(x || "").toLowerCase().trim() !== nameLower);
                }
            }
        });
    }

    ["friends","associates","romance","family","rivals"].forEach(k => {
        (s.social[k] || []).forEach(p => {
            if (!p || typeof p !== "object") return;
            if (!p.id) p.id = newId("person");
            if (p.thoughts === undefined) p.thoughts = "";
            if (p.likes === undefined) p.likes = "";
            if (p.dislikes === undefined) p.dislikes = "";
            if (p.birthday === undefined) p.birthday = "";
            if (p.location === undefined) p.location = "";
            if (typeof p.mapTracked !== "boolean") p.mapTracked = false;
            if (p.age === undefined) p.age = "";
            if (p.gender === undefined) p.gender = p.sex || "";
            if (p.knownFamily === undefined) p.knownFamily = "";
            if (p.familyRole === undefined) p.familyRole = "";
            if (p.relationshipStatus === undefined) p.relationshipStatus = "";
            if (p.phoneNumber === undefined) p.phoneNumber = p.phone || "";
            if (p.phone === undefined) p.phone = p.phoneNumber || "";
            if (p.schedule === undefined) p.schedule = "";
            if (p.wants === undefined) p.wants = "";
            if (p.needs === undefined) p.needs = "";
            if (p.desires === undefined) p.desires = "";
            if (!p.stats || typeof p.stats !== "object") p.stats = {};
            if (p.standings === undefined) p.standings = "";
            if (!Array.isArray(p.factions)) p.factions = String(p.factions || "").split(",").map((x) => x.trim()).filter(Boolean);
            if (!String(p.phoneNumber || "").trim() && String(p.phone || "").trim()) p.phoneNumber = p.phone;
            if (!String(p.phone || "").trim() && String(p.phoneNumber || "").trim()) p.phone = p.phoneNumber;
            if (!String(p.phoneNumber || "").trim() && String(p.name || "").trim()) {
                let hash = 0;
                const raw = String(p.name || "contact");
                for (let i = 0; i < raw.length; i++) hash = ((hash * 31) + raw.charCodeAt(i)) >>> 0;
                const n = String(1000 + (hash % 9000));
                p.phoneNumber = `555-01${n.slice(0, 2)}-${n.slice(2)}`;
                p.phone = p.phoneNumber;
            }
            if (p.url === undefined) p.url = "";
            if (p.avatar === undefined) p.avatar = "";
            if (p.met_physically === undefined) p.met_physically = false;
            if (p.known_from_past === undefined) p.known_from_past = false;
            if (p.liveSync === undefined) p.liveSync = true;
            else if (typeof p.liveSync !== "boolean") p.liveSync = !/^(0|false|no|off)$/i.test(String(p.liveSync).trim());
            if (!Array.isArray(p.memories)) p.memories = [];
            normalizeSocialPhysicsContact(p);
            if (p.affinity === undefined || p.affinity === null || p.affinity === "") p.affinity = 50;
            p.affinity = normalizeAffinity(p.affinity, 50);
            if (p.met_physically === true) p.known_from_past = false;
            // --- Generational Roster fields ---
            if (p.birthDate === undefined || p.birthDate === null) p.birthDate = null;
            if (!Number.isFinite(Number(p.currentAge))) p.currentAge = p.age !== "" && p.age !== undefined ? (Number(p.age) || 0) : 0;
            if (!Number.isFinite(Number(p.agingMultiplier))) p.agingMultiplier = 1.0;
            if (typeof p.lockedLocation !== "string" && p.lockedLocation !== null) p.lockedLocation = null;
            if (!Array.isArray(p.sprite_macros)) p.sprite_macros = [];
        });
    });
    const hateThreshold = 20;
    const rivals = s.social.rivals;
    const rivalNames = new Set(rivals.map(p => String(p?.name || "").toLowerCase()).filter(Boolean));

    const moveToRivals = (arr) => {
        const keep = [];
        for (const p of arr) {
            const aff = normalizeAffinity(p?.affinity, 50);
            const name = String(p?.name || "");
            if (name && aff <= hateThreshold) {
                const key = name.toLowerCase();
                if (!rivalNames.has(key)) {
                    rivals.push(p);
                    rivalNames.add(key);
                }
            } else {
                keep.push(p);
            }
        }
        return keep;
    };

    const before = { f: s.social.friends.length, r: s.social.romance.length, fa: s.social.family.length, rv: s.social.rivals.length };
    s.social.friends = moveToRivals(s.social.friends);
    s.social.associates = moveToRivals(s.social.associates);
    s.social.romance = moveToRivals(s.social.romance);
    s.social.family = moveToRivals(s.social.family);
    const after = { f: s.social.friends.length, r: s.social.romance.length, fa: s.social.family.length, rv: s.social.rivals.length };
    return before.f !== after.f || before.r !== after.r || before.fa !== after.fa || before.rv !== after.rv;
}

function deletedNameSet(s) {
    normalizeSocial(s);
    const arr = Array.isArray(s?.socialMeta?.deletedNames) ? s.socialMeta.deletedNames : [];
    return new Set(arr.map(x => String(x || "").toLowerCase().trim()).filter(Boolean));
}

function rememberDeletedNames(s, names) {
    normalizeSocial(s);
    const cur = new Set((s.socialMeta.deletedNames || []).map(x => String(x || "").toLowerCase().trim()).filter(Boolean));
    for (const n of (names || [])) {
        const k = String(n || "").toLowerCase().trim();
        if (k) cur.add(k);
    }
    s.socialMeta.deletedNames = Array.from(cur).slice(-400);
}

function unforgetDeletedName(s, name) {
    normalizeSocial(s);
    const k = String(name || "").toLowerCase().trim();
    if (!k) return;
    s.socialMeta.deletedNames = (s.socialMeta.deletedNames || []).filter(x => String(x || "").toLowerCase().trim() !== k);
}

async function getChatTranscript(maxMessages) {
    try {
        const t = await getChatTranscriptText({ maxMessages: Math.max(10, Number(maxMessages || 90)), maxChars: 150000 });
        if (t) return t;
    } catch (_) {}
    const out = [];
    try {
        const nodes = getChatMessageNodes(maxMessages || 5000);
        for (const m of nodes) {
            const name =
                m.querySelector?.(".mes_name")?.textContent ||
                m.querySelector?.(".name_text")?.textContent ||
                m.querySelector?.(".name")?.textContent ||
                m.querySelector?.(".ch_name")?.textContent ||
                m.getAttribute?.("ch_name") ||
                m.getAttribute?.("data-name") ||
                m.dataset?.name ||
                m.dataset?.chName ||
                "";
            const text =
                m.querySelector?.(".mes_text")?.textContent ||
                m.querySelector?.(".mes-text")?.textContent ||
                m.querySelector?.(".message")?.textContent ||
                m.textContent ||
                "";
            const nm = String(name || "").trim() || "Unknown";
            const tx = String(text || "").trim();
            if (!tx) continue;
            out.push(`${nm}: ${tx}`);
        }
    } catch (_) {}
    return out.join("\n").slice(-150000);
}

function getChatMessageNodes(maxMessages) {
    const max = Math.max(20, Number(maxMessages || 5000));
    try {
        const sels = [
            "#chat .mes",
            "#chat .mes_block",
            "#chat .mes_wrap",
            "#chat .chat-message",
            "#chat .chat_message",
            "#chat .message",
        ];
        const all = [];
        for (const sel of sels) {
            try {
                const nodes = Array.from(document.querySelectorAll(sel));
                for (const n of nodes) all.push(n);
            } catch (_) {}
        }
        const uniq = [];
        const seen = new Set();
        for (const n of all) {
            if (!n || !n.getBoundingClientRect) continue;
            const key = n.dataset?.mesId || n.getAttribute?.("mesid") || n.id || `${n.className}-${uniq.length}`;
            const k = `${key}-${n.tagName}`;
            if (seen.has(k)) continue;
            seen.add(k);
            uniq.push(n);
        }
        return uniq.slice(-1 * max);
    } catch (_) {
        return [];
    }
}

function readSocialChatSignature() {
    try {
        const ctx = getContext ? getContext() : {};
        const chatId = String(ctx?.chatId ?? "");
        const w = typeof window !== "undefined" ? window : globalThis;
        const arr = Array.isArray(w?.chat) ? w.chat : null;
        if (arr && arr.length) {
            const last = arr[arr.length - 1] || {};
            const lastId = String(last?.mesId ?? last?.mesid ?? last?.id ?? arr.length);
            const tail = String(last?.mes ?? last?.text ?? last?.message ?? "").trim().slice(-220);
            return `${chatId}|${arr.length}|${lastId}|${tail}`;
        }
    } catch (_) {}

    try {
        const ctx = getContext ? getContext() : {};
        const chatId = String(ctx?.chatId ?? "");
        const nodes = document.querySelectorAll("#chat .mes");
        if (!nodes || !nodes.length) return "";
        const last = nodes[nodes.length - 1];
        const lastId = String(last?.getAttribute?.("mesid") || last?.dataset?.mesId || nodes.length);
        const tail = String(
            last?.querySelector?.(".mes_text")?.textContent ||
            last?.querySelector?.(".mes-text")?.textContent ||
            last?.textContent ||
            ""
        ).trim().slice(-220);
        return `${chatId}|${nodes.length}|${lastId}|${tail}`;
    } catch (_) {
        return "";
    }
}

function stopSocialAutoScanLoop() {
    if (!autoScanRuntime.timer) return;
    try { clearInterval(autoScanRuntime.timer); } catch (_) {}
    autoScanRuntime.timer = null;
    autoScanRuntime.lastSig = "";
}

async function runSocialAutoScanPass() {
    try {
        const s = getSettings();
        normalizeSocial(s);
        if (s?.socialMeta?.autoScan !== true) return;
        if (autoScanRuntime.inFlight) return;

        const sig = readSocialChatSignature();
        if (!sig || sig === autoScanRuntime.lastSig) return;

        await scanChatIntoSocial({ silent: true });
        autoScanRuntime.lastSig = sig;
    } catch (_) {}
}

function syncSocialAutoScanLoop({ immediate = false } = {}) {
    try {
        const s = getSettings();
        normalizeSocial(s);
        const enabled = s?.socialMeta?.autoScan === true;

        if (!enabled) {
            stopSocialAutoScanLoop();
            return;
        }

        if (!autoScanRuntime.timer) {
            autoScanRuntime.timer = setInterval(() => {
                void runSocialAutoScanPass();
            }, SOCIAL_AUTO_SCAN_INTERVAL_MS);
        }

        if (immediate) {
            void runSocialAutoScanPass();
        }
    } catch (_) {}
}

function getActivePerson() {
    const s = getSettings();
    normalizeSocial(s);
    const idx = Number(activeProfileIndex);
    if (!Number.isFinite(idx)) return { s, person: null };
    const person = s?.social?.[currentTab]?.[idx] || null;
    if (person && !person.id) person.id = newId("person");
    if (person && !Array.isArray(person.memories)) person.memories = [];
    if (person && typeof person.liveSync !== "boolean") person.liveSync = true;
    return { s, person };
}

function isTrivialMemory(s) {
    const t = String(s || "").toLowerCase();
    if (!t) return true;
    if (t.length < 24) return true;
    const bad = /(said hi|said hello|walked in|greeted|small talk|chatted|talked a bit|they talked|made conversation|smiled and|laughed and)/i;
    return bad.test(t);
}

function parseTagsInput(raw, fallback = []) {
    const tags = String(raw || "")
        .split(",")
        .map((t) => String(t || "").trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 6);
    if (tags.length) return tags;
    const fb = Array.isArray(fallback) ?
         fallback.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean).slice(0, 6)
        : [];
    return fb;
}

function normalizeNameKey(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegExp(str) {
    return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineMentionsName(line, name) {
    const src = normalizeNameKey(line);
    const key = normalizeNameKey(name);
    if (!src || !key) return false;
    const pattern = `\\b${escapeRegExp(key).replace(/\s+/g, "\\\\s+")}\\b`;
    try {
        return new RegExp(pattern, "i").test(src);
    } catch (_) {
        return src.includes(key);
    }
}

function buildFocusedMemoryTranscript(transcript, personName, userName) {
    const lines = String(transcript || "")
        .split(/\r?\n/)
        .map((l) => String(l || "").trim())
        .filter(Boolean);
    if (!lines.length) return "";
    const keep = new Set();
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const speaker = String(line.split(":", 1)[0] || "").trim();
        const mentionsTarget = lineMentionsName(line, personName);
        const speakerIsTarget = lineMentionsName(speaker, personName);
        if (mentionsTarget || speakerIsTarget) {
            keep.add(i);
            if (i > 0) keep.add(i - 1);
            if (i + 1 < lines.length) keep.add(i + 1);
        }
    }
    if (keep.size < 8 && userName) {
        for (let i = 0; i < lines.length; i++) {
            const speaker = String(lines[i].split(":", 1)[0] || "").trim();
            if (lineMentionsName(speaker, userName)) keep.add(i);
        }
    }
    const selected = (keep.size ?
         Array.from(keep).sort((a, b) => a - b).map((i) => lines[i])
        : lines.slice(-80)).slice(-140);
    return selected.join("\n").slice(-14000);
}

function isMetaMemoryText(text) {
    return /\b(character\s*card|lorebook|metadata|tool\s*card|system\s*prompt|author\s*note|ooc)\b/i.test(String(text || ""));
}

function buildMemoryBlock(person) {
    const ctx = getContext ? getContext() : {};
    const user = String(ctx?.name1 || "User");
    const mems = Array.isArray(person?.memories) ? person.memories.slice() : [];
    mems.sort((a, b) => Number(b?.t || 0) - Number(a?.t || 0));
    const lines = mems.slice(0, 10).map(m => `- ${String(m?.text || "").trim()}${m?.impact ? ` (Impact: ${String(m.impact).trim()})` : ""}`).filter(Boolean);
    if (!lines.length) return "";
    return `[UIE SOCIAL MEMORY]\nCharacter: ${String(person?.name || "Unknown")}\nAbout: ${user}\nVital memories:\n${lines.join("\n")}`;
}

function renderMemoryOverlay() {
    const { person } = getActivePerson();
    if (!person) return;
    const ctx = getContext ? getContext() : {};
    const user = String(ctx?.name1 || "User");
    $("#uie-social-mem-sub").text(`${person.name} ↔ ${user}`);

    const list = Array.isArray(person.memories) ? person.memories.slice() : [];
    list.sort((a, b) => Number(b?.t || 0) - Number(a?.t || 0));
    const $list = $("#uie-social-mem-list");
    $list.empty();
    if (!list.length) {
        $("#uie-social-mem-empty").show();
        return;
    }
    $("#uie-social-mem-empty").hide();

    const rowTmpl = document.getElementById("uie-social-memory-row")?.content;
    if (!rowTmpl) return;

    for (const mem of list) {
        const id = String(mem?.id || "");
        const text = String(mem?.text || "").trim();
        const impact = String(mem?.impact || "").trim();
        const tags = Array.isArray(mem?.tags) ? mem.tags.map(t => String(t || "").trim()).filter(Boolean).slice(0, 6) : [];

        const el = $(rowTmpl.cloneNode(true));
        el.find(".mem-text").text(text || "-");

        if (impact) {
            el.find(".mem-impact").html(`<strong>Impact:</strong> ${esc(impact)}`);
        } else {
            el.find(".mem-impact").remove();
        }

        const tagContainer = el.find(".mem-tags");
        if (tags.length) {
            tags.forEach(t => {
                tagContainer.append(`<span style="font-size:11px; padding:3px 8px; border-radius:999px; background:rgba(0,0,0,0.08); border:1px solid rgba(74,46,22,0.18); color:#4a2e16; font-weight:900;">${esc(t)}</span>`);
            });
        } else {
            tagContainer.remove();
        }

        const $edit = el.find(".uie-social-mem-edit");
        if ($edit.length) $edit.attr("data-mid", id);
        el.find(".uie-social-mem-del").attr("data-mid", id);
        $list.append(el);
    }
    commitStateUpdate({ save: true, layout: false, emit: true });
}

async function scanMemoriesForActivePerson() {
    const { person } = getActivePerson();
    if (!person) return;
    const ctx = getContext ? getContext() : {};
    const user = String(ctx?.name1 || "User");
    const transcript = await getChatTranscript(120);
    if (!transcript) {
        try { window.toastr?.info?.("No chat transcript found."); } catch (_) {}
        return;
    }

    const focused = buildFocusedMemoryTranscript(transcript, person.name, user);
    const source = focused || transcript.slice(-14000);
    const prompt = `[UIE_LOCKED]
You are extracting ONLY vital, relationship-relevant memories for the character "${person.name}" about interactions with "${user}".

Target character: "${person.name}" (story character in this transcript, not card metadata)

Input transcript (may include omniscient tool cards / metadata; ignore anything that is not an in-world event or a durable fact):
${source}

Return ONLY valid JSON (no markdown, no extra keys):
{"memories":[{"text":"...","impact":"...","tags":["..."]}]}

Rules:
- 3 to 8 memories max. If none, return {"memories":[]}.
- Each memory must be about "${person.name}" directly (they act, speak, decide, reveal, promise, betray, help, harm, or are explicitly referenced).
- Ignore character-card data, profile blurbs, lorebook snippets, system messages, OOC, or tool/meta output.
- Each memory must be a durable fact that CHANGED something: trust, fear, loyalty, obligation, romance, rivalry, plans, secrets, injuries, promises, betrayals, gifts, major discoveries.
- No trivial entries (no greetings, walking in, "they talked", generic vibes).
- Be specific and consequence-based. 1-2 sentences per memory.
- Tags are short (e.g., "promise", "betrayal", "injury", "secret", "favor", "trauma", "trust").`;

    try { window.toastr?.info?.("Scanning memories..."); } catch (_) {}
    const res = await generateContent(prompt.slice(0, 16000), "System Check");
    if (!res) return;
    const obj = safeJsonParseObject(res) || {};
    const mems = Array.isArray(obj?.memories) ? obj.memories : [];
    const existing = new Set((person.memories || []).map(m => String(m?.text || "").toLowerCase().replace(/\s+/g, " ").trim()).filter(Boolean));
    let added = 0;

    for (const m of mems) {
        let text = String(m?.text || "").trim();
        const impact = String(m?.impact || "").trim();
        const tags = Array.isArray(m?.tags) ?
             m.tags.map(t => String(t || "").trim().toLowerCase()).filter(Boolean).slice(0, 6)
            : [];
        if (!text) continue;
        if (isMetaMemoryText(text)) continue;
        if (!lineMentionsName(text, person.name)) text = `${person.name}: ${text}`;
        const key = text.toLowerCase().replace(/\s+/g, " ").trim();
        if (isTrivialMemory(text)) continue;
        if (existing.has(key)) continue;
        person.memories.push({ id: newId("mem"), t: Date.now(), text: text.slice(0, 320), impact: impact.slice(0, 240), tags });
        existing.add(key);
        added++;
    }

    commitStateUpdate({ save: true, layout: false, emit: true });
    renderMemoryOverlay();
    try { window.toastr?.success?.(added ? `Added ${added} ${added === 1 ? "memory" : "memories"}.` : "No new vital memories found."); } catch (_) {}
}

function renderSylvanAlbum(s) {
    const container = $("#uie-social-content");
    container.find(".uie-social-grid, .no-data-msg, .uie-sylvan-tree, .uie-social-context-strip").remove();

    const categories = ["friends", "associates", "romance", "family", "rivals"];
    const allPeople = [];
    const seenNames = new Set();

    categories.forEach(cat => {
        const list = s.social[cat] || [];
        list.forEach(person => {
            const name = String(person.name || "").trim();
            if (name && !seenNames.has(name.toLowerCase())) {
                seenNames.add(name.toLowerCase());
                allPeople.push({ ...person, category: cat });
            }
        });
    });

    if (allPeople.length === 0) {
        container.prepend(`<div class="no-data-msg" style="text-align:center; margin-top:50px; color:#cba35c; font-family:serif; font-size:1.2em;">- No Sylvan Contacts Recorded Yet -</div>`);
        return;
    }

    const $tree = $(`<div class="uie-sylvan-tree" style="display:flex; flex-direction:column; gap:30px; align-items:center; padding:10px 0; width:100%;"></div>`);

    const currentPersona = s.personas?.find(p => p.id === s.currentPersonaId) || s.personas?.[0] || { name: "Protagonist", role: "Adventurer", bio: "The main character." };
    const pAvatar = currentPersona.avatar || "";

    const $protagBranch = $(`
        <div class="sylvan-protag-branch" style="display:flex; flex-direction:column; align-items:center; gap:8px; position:relative; z-index:10;">
            <div class="uie-family-node protagonist-node" style="border: 3px double #cba35c; background: rgba(203, 163, 92, 0.15); box-shadow: 0 0 15px rgba(203, 163, 92, 0.3); border-radius: 14px; width: 140px; padding: 12px; display:flex; flex-direction:column; align-items:center; gap:8px;">
                <div class="uie-family-portrait" style="width: 72px; height: 72px; border-radius: 50%; overflow: hidden; border: 2px solid #cba35c; background: #222;">
                    ${pAvatar ? `<img src="${esc(pAvatar)}" style="width:100%; height:100%; object-fit:cover;">` : `<i class="fa-solid fa-crown" style="color:#cba35c; font-size: 1.8em; line-height: 72px; text-align: center; display:block; width:100%;"></i>`}
                </div>
                <div class="uie-family-node-name" style="font-weight: bold; font-size: 14px; color: #cba35c; text-align: center;">${esc(currentPersona.name)}</div>
                <div class="uie-family-node-meta" style="font-size: 10px; color: #e1c17a; text-align: center;">${esc(currentPersona.role || "Protagonist")}</div>
            </div>
            <div class="sylvan-trunk-line" style="width:2px; height:24px; background:linear-gradient(to bottom, #cba35c, #8d6e63);"></div>
        </div>
    `);
    $tree.append($protagBranch);

    const highLoyalty = allPeople.filter(p => Number(p.affinity ?? 50) >= 70);
    const neutral = allPeople.filter(p => Number(p.affinity ?? 50) > 30 && Number(p.affinity ?? 50) < 70);
    const rivals = allPeople.filter(p => Number(p.affinity ?? 50) <= 30);

    const branches = [
        { title: "🌸 Devoted Lineage (High Affinity / Blooming Vines) 🌸", list: highLoyalty, type: "high" },
        { title: "🪵 General Network (Neutral / Wood Branches) 🪵", list: neutral, type: "neutral" },
        { title: "🥀 Thorned Rivals (Low Affinity / Briar Thorns) 🥀", list: rivals, type: "rival" }
    ];

    branches.forEach(branch => {
        if (branch.list.length === 0) return;

        const $branchEl = $(`
            <div class="sylvan-branch-group" style="display:flex; flex-direction:column; align-items:center; gap:16px; width:100%; position:relative;">
                <div class="sylvan-branch-title" style="font-family:'Cinzel', 'Georgia', serif; font-size: 13px; font-weight:bold; color:#cba35c; background:rgba(0,0,0,0.5); padding:4px 14px; border-radius:12px; border:1px solid rgba(203,163,92,0.3); margin-bottom:8px; text-transform:uppercase; letter-spacing:1px; z-index:5;">${branch.title}</div>
                <div class="sylvan-nodes-grid" style="display:flex; flex-wrap:wrap; justify-content:center; gap:20px; width:100%; padding: 0 10px;"></div>
            </div>
        `);

        const $grid = $branchEl.find(".sylvan-nodes-grid");

        branch.list.forEach(person => {
            const affinity = Math.max(0, Math.min(100, Number(person.affinity ?? 50)));
            let borderStyle = "";
            let botanicalOverlay = "";
            let categoryText = SOCIAL_CATEGORY_LABELS[person.category] || "Contact";
            let roleText = person.familyRole || person.relationshipStatus || categoryText;

            if (branch.type === "high") {
                borderStyle = "border: 3px solid #2ecc71; border-image: linear-gradient(135deg, #2ecc71, #27ae60) 1; box-shadow: 0 0 12px rgba(46,204,113,0.3); background: rgba(46,204,113,0.06);";
                botanicalOverlay = `<div class="botanical-decor" style="position:absolute; top:2px; left:4px; font-size:11px; opacity:0.85; pointer-events:none;">🌸🍃</div>`;
            } else if (branch.type === "rival") {
                borderStyle = "border: 2px dashed #e74c3c; box-shadow: 0 0 12px rgba(231,76,60,0.25); background: rgba(231,76,60,0.05);";
                botanicalOverlay = `<div class="botanical-decor" style="position:absolute; top:2px; left:4px; font-size:11px; opacity:0.85; pointer-events:none;">🌵🥀</div>`;
            } else {
                borderStyle = "border: 2px solid #8d6e63; background: rgba(141,110,99,0.06);";
                botanicalOverlay = `<div class="botanical-decor" style="position:absolute; top:2px; left:4px; font-size:11px; opacity:0.6; pointer-events:none;">🪵</div>`;
            }

            const av = String(person.avatar || "").trim();
            const originalIndex = s.social[person.category].findIndex(p => String(p.name).toLowerCase() === String(person.name).toLowerCase());

            const $node = $(`
                <div class="uie-family-node" data-cat="${esc(person.category)}" data-idx="${originalIndex}" style="position:relative; width: 140px; min-height: 190px; padding: 12px; display:flex; flex-direction:column; align-items:center; gap:8px; cursor:pointer; border-radius:12px; ${borderStyle}">
                    ${botanicalOverlay}
                    <div class="uie-family-portrait" style="width: 66px; height: 66px; border-radius: 50%; overflow:hidden; border:2px solid rgba(255,255,255,0.12); background:#222;">
                        ${av ? `<img src="${esc(av)}" style="width:100%; height:100%; object-fit:cover;">` : `<i class="fa-solid fa-user" style="font-size:1.6em; line-height:66px; color:#8a8a9e; display:block; text-align:center; width:100%;"></i>`}
                    </div>
                    <div class="uie-family-node-name" style="font-weight: bold; font-size: 13px; color: #fff; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">${esc(person.name)}</div>
                    <div class="uie-family-node-meta" style="font-size: 10px; color: #8a8a9e; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">${esc(roleText)}</div>
                    <div class="uie-family-node-ties" style="display:flex; gap:4px; justify-content:center; flex-wrap:wrap; margin-top:2px;">
                        <span class="uie-family-chip" style="font-size:9px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12); border-radius:999px; padding:1px 5px; color:#aaa; font-weight:bold;">${affinity} Affinity</span>
                    </div>
                    <div style="margin-top:auto; padding-top:6px; width:100%;">
                        <button type="button" class="uie-track-location-btn reply-tool-btn" data-name="${esc(person.name)}" data-loc="${esc(person.location || '')}" style="font-size:9px; padding:3px 6px; width:100%; height:auto; display:flex; align-items:center; justify-content:center; gap:4px; font-weight:bold; border-radius:6px; cursor:pointer;"><i class="fa-solid fa-compass"></i> Track</button>
                    </div>
                </div>
            `);

            $node.find(".uie-track-location-btn").on("click", function(e) {
                e.stopPropagation();
                e.preventDefault();
                const locName = $(this).attr("data-loc") || "Unknown Location";
                const pName = $(this).attr("data-name");
                trackLocationOnMap(pName, locName);
            });

            $node.on("click", function() {
                const cat = $(this).attr("data-cat");
                const idx = Number($(this).attr("data-idx"));
                currentTab = cat;
                openProfile(idx, this);
            });

            $grid.append($node);
        });

        $tree.append($branchEl);
    });

    container.append($tree);
}

function trackLocationOnMap(personName, locationName) {
    $("#uie-social-window").hide();
    (window.importUieModule ? window.importUieModule("map.js") : import("./map.js")).then(m => {
        return m.focusTrackedLocation?.(locationName, { characterName: personName });
    }).then(() => {
        if (typeof window.showToast === "function") {
            window.showToast(`📍 Tracking ${personName} at ${locationName || 'their last coordinates'}`, 3500);
        }
    }).catch(err => {
        console.error("Failed to load map for tracking:", err);
    });
}

const offeredSocialMapLocations = new Set();
function shouldOfferSocialLocation(locationName) {
    const loc = String(locationName || "").trim();
    if (!loc || /^(unknown|unknown location|in current scene|current scene|here|nearby)$/i.test(loc)) return false;
    const key = loc.toLowerCase();
    if (offeredSocialMapLocations.has(key)) return false;
    try {
        if (window.sessionStorage?.getItem?.(`uie_social_map_offer:${key}`)) return false;
    } catch (_) {}
    return true;
}

function offerSocialLocationToMap(personName, locationName) {
    const loc = String(locationName || "").trim();
    if (!shouldOfferSocialLocation(loc)) return;
    const key = loc.toLowerCase();
    offeredSocialMapLocations.add(key);
    try { window.sessionStorage?.setItem?.(`uie_social_map_offer:${key}`, "1"); } catch (_) {}

    (window.importUieModule ? window.importUieModule("map.js") : import("./map.js")).then((map) => {
        if (map.getNodeByName?.(loc)) return;
        try { window.toastr?.info?.(`${personName || "An NPC"} is heading to ${loc}. Opening add-location.`, "Map"); } catch (_) {}
        map.openAddLocationModal?.({
            name: loc,
            layer: "area",
            type: "exterior",
            description: `${personName || "An NPC"} mentioned going here.`,
            npcs: [personName].filter(Boolean),
        });
    }).catch((err) => {
        console.warn("[UIE Social] Could not offer map location", err);
    });
}

function renderSocialTracker(s) {
    const container = $("#uie-social-content");
    container.find(".uie-social-grid, .no-data-msg, .uie-sylvan-tree, .uie-social-context-strip").remove();

    const currentLoc = s.worldState?.location || s.location || "Unknown Location";
    const trackedList = [];
    const seenNames = new Set();

    // 1. Gather Away Party Members. Party members are always tracked.
    const partyMembers = s.party?.members || [];
    for (const member of partyMembers) {
        const memberName = String(member?.identity?.name || member?.name || "").trim();
        if (!member || !memberName) continue;
        const memLoc = member.location || member.currentLocation || member.lastKnownLocation || currentLoc || "Unknown";
        if (!seenNames.has(memberName.toLowerCase())) {
            trackedList.push({
                name: memberName,
                category: "party",
                categoryLabel: "Party Member",
                role: member.partyRole || member.role || (memLoc === currentLoc ? "With you" : "Away"),
                location: memLoc,
                affinity: Number.isFinite(member.affinity) ? member.affinity : 50,
                avatar: member.images?.portrait || member.avatar || member.url || "",
                color: "#6fd3ff"
            });
            seenNames.add(memberName.toLowerCase());
        }
    }

    // 2. Gather Friends, Family, Romance, Rivals, Associates from Social settings
    const socialCategories = {
        friends: { label: "Friend", color: "#10b981" },
        family: { label: "Family", color: "#a855f7" },
        romance: { label: "Relationship", color: "#f43f5e" },
        associates: { label: "Associate", color: "#38bdf8" },
        rivals: { label: "Rival", color: "#f59e0b" }
    };

    for (const [cat, meta] of Object.entries(socialCategories)) {
        const list = s.social[cat] || [];
        for (const p of list) {
            if (!p || !p.name) continue;
            if (p.mapTracked !== true) continue;
            const pLoc = p.location || "Unknown";
            const isAway = pLoc !== currentLoc;
            if (!seenNames.has(p.name.toLowerCase())) {
                trackedList.push({
                    name: p.name,
                    category: cat,
                    categoryLabel: meta.label,
                    role: p.familyRole || p.relationshipStatus || "Contact",
                    location: pLoc,
                    affinity: Number.isFinite(p.affinity) ? p.affinity : 50,
                    avatar: p.avatar || p.url || "",
                    color: meta.color
                });
                seenNames.add(p.name.toLowerCase());
            }
        }
    }

    if (trackedList.length === 0) {
        container.prepend(`
            <div class="no-data-msg" style="text-align:center; margin-top:50px; color:#ffd166; font-family:serif; font-size:1.2em;">
                <i class="fa-solid fa-location-dot" style="font-size: 2em; opacity: 0.3; display: block; margin-bottom: 10px;"></i>
                No tracked characters yet. Party members are automatic; choose other NPCs from their Social profile.
            </div>
        `);
        return;
    }

    const grid = $("<div class=\"uie-social-grid\"></div>");

    trackedList.forEach((char) => {
        const heartsCount = Math.min(10, Math.max(0, Math.floor(char.affinity / 10)));
        let heartsHtml = "";
        for (let i = 1; i <= 10; i++) {
            if (i <= heartsCount) {
                heartsHtml += '<i class="fa-solid fa-heart" style="color: #ff4a5a; margin-right: 2px;"></i>';
            } else {
                heartsHtml += '<i class="fa-regular fa-heart" style="color: rgba(255, 74, 90, 0.4); margin-right: 2px;"></i>';
            }
        }

        let avatar = String(char.avatar || "").trim();
        if (!avatar) {
            avatar = findAvatarForNameFromChat(char.name);
        }

        const avatarHtml = avatar ?
             `<img class="tracker-avatar" src="${esc(avatar)}" style="width: 72px; height: 72px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.1); object-fit: cover;">`
            : `<div class="tracker-avatar" style="width: 72px; height: 72px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.1); display:grid; place-items:center; font-size:2em; color:#8a8a9e; background:rgba(255,255,255,0.05);"><i class="fa-solid fa-user"></i></div>`;

        const card = $(`
            <div class="uie-social-card tracker-card" data-name="${esc(char.name)}">
                <div class="uie-s-avatar">${avatar ? `<img src="${esc(avatar)}" alt="${esc(char.name)}">` : `<i class="fa-solid fa-user"></i>`}</div>
                <div class="uie-s-main">
                    <div class="uie-s-name">${esc(char.name)}</div>
                    <div class="uie-s-meta">
                        <span class="uie-s-chip" style="border-color:${esc(char.color)}; color:${esc(char.color)};">${esc(char.categoryLabel)}</span>
                        ${char.role ? `<span class="uie-s-chip">${esc(char.role)}</span>` : ""}
                    </div>
                    <div class="uie-s-notes">Tracked in the living social ledger. Click for profile details or lineage.</div>
                </div>
                <div class="uie-s-side">
                    <div class="uie-s-hearts" title="Relationship Affinity: ${esc(char.affinity)}%">${heartsHtml}</div>
                    <div class="uie-s-location"><i class="fa-solid fa-location-dot"></i> ${esc(char.location || "Unknown")}</div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                        <button class="tracker-nav-btn uie-p-btn" data-name="${esc(char.name)}" style="min-height:30px;"><i class="fa-solid fa-address-card"></i> Profile</button>
                        <button class="uie-track-location-btn uie-p-btn" data-name="${esc(char.name)}" data-loc="${esc(char.location)}" style="min-height:30px;"><i class="fa-solid fa-compass"></i> Track</button>
                    </div>
                </div>
            </div>
        `);

        grid.append(card);
    });

    // Bind view profile and track location
    grid.find(".tracker-nav-btn").off("click").on("click", function(e) {
        e.stopPropagation();
        const name = $(this).data("name");
        window.openProfileByName(name);
    });

    grid.find(".uie-track-location-btn").off("click").on("click", function(e) {
        e.stopPropagation();
        const name = $(this).data("name");
        const loc = $(this).data("loc");
        trackLocationOnMap(name, loc);
    });

    // Make clicking the whole card view profile as well
    grid.find(".tracker-card").off("click").on("click", function(e) {
        if ($(e.target).closest("button").length) return;
        const name = $(this).data("name");
        window.openProfileByName(name);
    });

    container.append(grid);
}

function hexToRgb(hex) {
    hex = String(hex).replace(/^#/, "");
    if (hex.length === 3) {
        hex = hex.split("").map(c => c + c).join("");
    }
    const num = parseInt(hex, 16);
    return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
}

try {
    window.removeEventListener("uie:set_social_tab", handleSetSocialTabEvent);
    window.addEventListener("uie:set_social_tab", handleSetSocialTabEvent);
} catch (_) {}

function handleSetSocialTabEvent(e) {
    currentTab = e.detail || "friends";
    if (currentTab === "sylvan") currentTab = "friends";
    const $win = $("#uie-social-window");
    if ($win.length) {
        $win.find(".uie-tab").removeClass("active");
        $win.find(`.uie-tab[data-tab='${currentTab}']`).addClass("active");
    }
}

function renderHeartString(affinity, max = 10) {
    const count = Math.max(0, Math.min(max, Math.floor(normalizeAffinity(affinity, 50) / 10)));
    let html = "";
    for (let i = 1; i <= max; i++) {
        if (i <= count) {
            html += '<i class="fa-solid fa-heart" style="color: #ff4a5a; margin-right: 2px;"></i>';
        } else {
            html += '<i class="fa-regular fa-heart" style="color: rgba(255, 74, 90, 0.4); margin-right: 2px;"></i>';
        }
    }
    return html;
}

function socialCategoryLabel(tab) {
    return SOCIAL_CATEGORY_LABELS[tab] || (String(tab || "Contact").replace(/^\w/, c => c.toUpperCase()));
}

function socialRoleText(person, tab) {
    return firstNonEmpty(person?.familyRole, person?.relationshipStatus, socialCategoryLabel(tab), "Contact");
}

function socialPresenceText(person) {
    if (person?.met_physically === true) return "Met";
    if (person?.known_from_past === true) return "Past";
    return "Mentioned";
}

function socialMemoryPreview(person) {
    const mems = Array.isArray(person?.memories) ? person.memories : [];
    const last = mems.length ? mems[mems.length - 1] : null;
    return String(last?.text || person?.thoughts || "No vital memory recorded yet.").trim();
}

export function renderSocial() {
    if (!isInitialized) {
        initSocial();
        isInitialized = true;
    }

    const s = getSettings();
    if (currentTab === "sylvan") currentTab = "friends";
    const changed = normalizeSocial(s);
    if (changed) commitStateUpdate({ save: true, layout: false, emit: true });

    const bgUrl = s.ui?.backgrounds?.social;
    if (bgUrl) {
        $("#uie-social-window").css({
            backgroundImage: `url("${bgUrl}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
        });
    }

    const loc = String(s?.worldState?.location || "").trim();
    const merged = collectMergedScenePeopleNames(s, loc);
    const sceneLine = merged.length ? merged.join(", ") : "No one else flagged in this area yet.";
    $("#uie-social-window .uie-social-context-strip").remove();
    $("#uie-social-window").prepend(
        `<div class="uie-social-context-strip" style="margin:10px 14px 0; padding:10px 12px; border-radius:10px; background:rgba(0,0,0,0.45); border:1px solid rgba(255,255,255,0.12); font-size:12px; line-height:1.45;">
            <div style="opacity:0.85; font-weight:700;">People in scene (area + omniscient roster)</div>
            <div style="opacity:0.92;">${esc(sceneLine)}</div>
            <div style="margin-top:6px; opacity:0.65; font-size:11px;">${loc ? `Location: ${esc(loc)} · ` : ""}Ties to map movement, room actions, and who can ping you on the phone.</div>
        </div>`
    );

    if (currentTab === "tracker") {
        renderSocialTracker(s);
        return;
    }

    const list = s.social[currentTab] || [];
    const container = $("#uie-social-content");
    container.find(".uie-social-grid, .no-data-msg, .uie-sylvan-tree").remove();

    if (list.length === 0) {
        const emptyTemplate = document.getElementById("uie-social-empty-msg")?.content;
        if (emptyTemplate) container.prepend(emptyTemplate.cloneNode(true));
    } else {
        const grid = $("<div class=\"uie-social-grid\"></div>");
        const cardTemplate = document.getElementById("uie-social-card-template")?.content;
        if (cardTemplate) {
            let avatarChanged = false;
            list.forEach((person, index) => {
                const isSel = deleteMode && selectedForDelete.includes(index);
                let avatar = String(person.avatar || "").trim();

                try {
                    const token = avatar.match(/^<char(?::([^>]+))?>$/i);
                    if (token) {
                        const want = String(token[1] || "").trim().toLowerCase();
                        if (!want) {
                            avatar = resolveCurrentCharAvatarUrl();
                        } else {
                            const s2 = getSettings();
                            const members = Array.isArray(s2?.party?.members) ? s2.party.members : [];
                            const hit = members.find(x => String(x?.identity?.name || "").trim().toLowerCase() === want);
                            avatar = String(hit?.images?.portrait || "").trim() || resolveCurrentCharAvatarUrl();
                        }
                    }
                } catch (_) {}

                if (!avatar) {
                    const fromChat = findAvatarForNameFromChat(person.name);
                    if (fromChat) {
                        avatar = fromChat;
                    } else {
                        try {
                            const ctx = getContext?.();
                            const name2 = String(ctx?.name2 || "").trim().toLowerCase();
                            if (name2 && String(person.name || "").trim().toLowerCase() === name2) {
                                avatar = resolveCurrentCharAvatarUrl();
                            }
                        } catch (_) {}
                    }
                }

                if (avatar && avatar !== person.avatar) {
                    person.avatar = avatar;
                    avatarChanged = true;
                }

                const el = $(cardTemplate.cloneNode(true));
                const cardDiv = el.find(".uie-social-card");
                cardDiv.attr("data-idx", index);
                if (isSel) cardDiv.addClass("delete-selected");

                const avContainer = el.find(".uie-s-avatar");
                if (avatar) {
                    avContainer.html(`<img src="${esc(avatar)}" style="width:100%; height:100%; object-fit:cover;">`);
                } else {
                    avContainer.html('<i class="fa-solid fa-user"></i>');
                }

                el.find(".uie-s-name").text(person.name);
                el.find(".uie-s-role").text(socialRoleText(person, currentTab));
                el.find(".uie-s-presence").text(socialPresenceText(person));
                el.find(".uie-s-notes").text(socialMemoryPreview(person));
                el.find(".uie-s-hearts").html(renderHeartString(person.affinity, 10)).attr("title", `Affinity: ${normalizeAffinity(person.affinity, 50)}/100`);
                el.find(".uie-s-location").html(`<i class="fa-solid fa-location-dot"></i> ${esc(person.location || "Unknown")}`);

                const tag = person?.met_physically === true ? "" : (person?.known_from_past === true ? "PAST" : "MENTION");
                const locked = isEntityLocationLocked(person);
                const tagHtml = [
                    tag ? `<div style="font-size:10px; opacity:0.75; border:1px solid rgba(255,255,255,0.18); padding:2px 8px; border-radius:999px;">${tag}</div>` : "",
                    locked ? `<div style="font-size:10px; background:rgba(203, 163, 92,0.18); border:1px solid rgba(203, 163, 92,0.35); padding:2px 8px; border-radius:999px; color:#cba35c;">🔒</div>` : ""
                ].filter(Boolean).join("");
                if (tagHtml) {
                    el.find(".uie-s-tag-container").html(tagHtml);
                }

                grid.append(el);
            });
            if (avatarChanged) commitStateUpdate({ save: true, layout: false, emit: true });
        }

        container.prepend(grid);
    }

    if (deleteMode) {
        $("#uie-delete-controls").css("display", "flex");
    } else {
        $("#uie-delete-controls").hide();
    }
}

export function render() {
    renderSocial();
}

function collectLineageRoster(s) {
    const roster = {};
    if (s.relationships && typeof s.relationships === "object") {
        Object.keys(s.relationships).forEach((id) => {
            if (id === "messages") return;
            const p = s.relationships[id];
            if (p && typeof p === "object" && p.name) roster[p.id || id] = { ...p, id: p.id || id };
        });
    }
    if (s.social && typeof s.social === "object") {
        ["family", "romance", "friends", "associates", "rivals"].forEach((tab) => {
            const arr = Array.isArray(s.social[tab]) ? s.social[tab] : [];
            arr.forEach((p, idx) => {
                if (!p || !p.name) return;
                const id = p.id || `${tab}_${idx}`;
                roster[id] = { ...p, id };
            });
        });
    }
    if (Array.isArray(s.personas)) {
        s.personas.forEach((p, idx) => {
            if (!p || typeof p !== "object") return;
            const name = String(p.name || "").trim();
            if (!name) return;
            const id = String(p.id || `persona_${idx}`);
            roster[id] = {
                ...p,
                id,
                name,
                familyName: p.familyName || p.family || "",
                currentAge: p.currentAge || p.age || "",
                portraitUrl: p.portraitUrl || p.imageUrl || p.avatar || null,
                role: p.familyRole || p.title || p.role || "Persona",
                relationshipStatus: p.familyRole || p.relationshipStatus || "",
                lineage: true
            };
        });
    }
    const playerName = String(s.character?.name || "User").trim() || "User";
    roster.player = {
        id: "player",
        name: playerName,
        familyName: s.character?.familyName || playerName,
        currentAge: s.character?.age || "",
        portraitUrl: s.character?.portraitUrl || null,
        lineage: true
    };
    return roster;
}

function renderFamilyTreeOverlay(rootName) {
    window.renderFamilyTreeOverlay = renderFamilyTreeOverlay;
    const s = getSettings();
    const engine = getGlobalAgeing();
    const roster = collectLineageRoster(s);
    if (s.lineageTree && typeof s.lineageTree === "object") engine.lineageTree = { ...engine.lineageTree, ...s.lineageTree };
    Object.values(roster).forEach((p) => {
        if (!p?.id) return;
        if (!engine.lineageTree[p.id]) {
            engine.lineageTree[p.id] = {
                parentId: p.parentId || null,
                childIds: Array.isArray(p.childIds) ? p.childIds : [],
                generation: Number(p.generation || 0) || 0,
                spouseId: p.spouseId || null
            };
        }
    });

    // If rootName is provided, try to find that character as root
    let rootId = null;
    if (rootName) {
        const nameLower = String(rootName).toLowerCase().trim();
        // Search in roster
        rootId = Object.keys(roster).find(id => String(roster[id]?.name || "").toLowerCase().trim() === nameLower);
        // If not found in roster, dynamically inject from social contacts
        if (!rootId) {
            const allSocial = [];
            for (const cat of ["friends", "associates", "romance", "family", "rivals"]) {
                for (const p of (s.social?.[cat] || [])) {
                    if (String(p?.name || "").toLowerCase().trim() === nameLower) {
                        allSocial.push({ ...p, _cat: cat });
                    }
                }
            }
            if (allSocial.length) {
                const person = allSocial[0];
                const id = person.id || newId("person");
                roster[id] = { ...person, id, lineage: true };
                engine.lineageTree[id] = {
                    parentId: null,
                    childIds: [],
                    generation: 0,
                    spouseId: null
                };
                // Also inject known family connections
                for (const cat of ["friends", "associates", "romance", "family", "rivals"]) {
                    for (const rel of (s.social?.[cat] || [])) {
                        if (!rel?.name || rel.name === person.name) continue;
                        const relRole = String(rel.familyRole || rel.relationshipStatus || "").toLowerCase();
                        const relId = rel.id || newId("person");
                        if (!roster[relId]) {
                            roster[relId] = { ...rel, id: relId };
                        }
                        if (!engine.lineageTree[relId]) {
                            const isChild = ["child", "son", "daughter"].some(r => relRole.includes(r));
                            const isParent = ["parent", "mother", "father"].some(r => relRole.includes(r));
                            const isSpouse = ["married", "spouse", "husband", "wife", "partner", "lover"].some(r => relRole.includes(r));
                            const isSibling = ["sibling", "brother", "sister"].some(r => relRole.includes(r));
                            engine.lineageTree[relId] = {
                                parentId: isChild ? id : null,
                                childIds: isParent ? [id] : [],
                                generation: isChild ? 1 : (isParent ? -1 : 0),
                                spouseId: isSpouse ? id : null
                            };
                            if (isParent) {
                                engine.lineageTree[id].parentId = relId;
                            }
                            if (isChild) {
                                if (!engine.lineageTree[id].childIds.includes(relId)) {
                                    engine.lineageTree[id].childIds.push(relId);
                                }
                            }
                            if (isSpouse) {
                                engine.lineageTree[id].spouseId = relId;
                            }
                            if (isSibling) {
                                engine.lineageTree[relId].parentId = engine.lineageTree[id].parentId;
                                engine.lineageTree[relId].generation = 0;
                            }
                        }
                    }
                }
                rootId = id;
            }
        }
    }

    const ids = Object.keys(roster).filter((id) => roster[id]?.lineage === true || engine.lineageTree[id]);
    if (!rootId) {
        rootId = ids.find((id) => engine.lineageTree[id]?.parentId == null && id !== "player") || ids.find((id) => id !== "player") || "player";
    }
    const album = engine.renderSylvanAlbum(rootId, roster);
    const canvas = $("#uie-family-tree-canvas").empty();
    const treeTitle = rootName ? `${rootName}'s Family Tree` : album.title;
    $("#uie-family-tree-sub").text(`${treeTitle} · ${album.characters.length} lineage record(s)`);

    // Populate the dropdown selectors for the direct relationship linker
    const selectA = $("#uie-lineage-link-a").empty();
    const selectB = $("#uie-lineage-link-b").empty();
    const sortedRosterIds = Object.keys(roster).filter(id => roster[id] && roster[id].name).sort((x, y) => String(roster[x].name).localeCompare(String(roster[y].name)));
    if (sortedRosterIds.length === 0) {
        selectA.append(`<option value="">- No characters -</option>`);
        selectB.append(`<option value="">- No characters -</option>`);
    } else {
        sortedRosterIds.forEach(id => {
            const name = roster[id].name;
            selectA.append(`<option value="${id}">${esc(name)}</option>`);
            selectB.append(`<option value="${id}">${esc(name)}</option>`);
        });
        if (rootId && roster[rootId]) {
            selectA.val(rootId);
            const otherId = sortedRosterIds.find(id => id !== rootId);
            if (otherId) selectB.val(otherId);
        }
    }
    if (!album.characters.length) {
        canvas.html(`<div style="grid-column:1/-1; text-align:center; padding:60px 20px; color:rgba(246,231,200,0.72);">No lineage records found yet. ${rootName ? `No family connections found for ${rootName}.` : 'Create entities in Roster → Custom Lineage.'}</div>`);
        return;
    }
    album.characters.sort((a, b) => Number(a.generation || 0) - Number(b.generation || 0)).forEach((person) => {
        const source = roster[person.id] || {};
        const portrait = person.portraitUrl || source.avatar || source.spriteBase64 || source.base64 || "";
        const generationLabel = Number(person.generation || 0) === 0 ? "Current generation" : `Generation ${person.generation}`;
        const tagsHtml = Array.isArray(person.tags) ?
             person.tags.slice(0, 4).map((tag) => `<span class="uie-family-chip">${esc(tag)}</span>`).join("")
            : "";
        canvas.append(`
            <div class="uie-family-node ${esc(person.cssClass || '')}">
                <div class="uie-family-portrait">${portrait ? `<img src="${esc(portrait)}" alt="">` : `<i class="fa-solid fa-seedling"></i>`}</div>
                <div class="uie-family-node-name">${esc(person.name || "Unknown")}</div>
                <div class="uie-family-node-meta">
                    ${source.currentAge || source.age ? `Age: ${esc(source.currentAge || source.age)}<br>` : ""}
                    ${source.birthDate || source.birthday ? `Born: ${esc(source.birthDate || source.birthday)}<br>` : ""}
                    ${generationLabel}<br>
                    Role: ${esc(person.role || "lineage")}
                </div>
                <div class="uie-family-node-ties">
                    <span class="uie-family-chip">${esc(album.theme || "botanical")}</span>
                    ${tagsHtml}
                </div>
            </div>
        `);
    });
}

try { window.renderFamilyTreeOverlay = renderFamilyTreeOverlay; } catch (_) {}

function safeUrl(raw) {
    let u = String(raw || "").trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    return u;
}

function openProfile(index, anchorEl) {
    const s = getSettings();
    normalizeSocial(s);
    const person = s.social[currentTab][index];
    if (!person) return;

    activeProfileIndex = index;
    let touched = false;
    if (!person.id) {
        person.id = newId("person");
        touched = true;
    }
    if (!Array.isArray(person.memories)) {
        person.memories = [];
        touched = true;
    }
    if (typeof person.liveSync !== "boolean") {
        person.liveSync = true;
        touched = true;
    }
    if (touched) commitStateUpdate({ save: true, layout: false, emit: true });

    $(".uie-p-name-lg").text(person.name);
    $("#p-val-status").text(`"${person.thoughts || "..."}"`);
    $("#p-val-bday").text(person.birthday || "Unknown");
    $("#p-val-loc").text(person.location || "Unknown");
    $("#p-val-age").text(person.age || "Unknown");
    $("#p-val-gender").text(person.gender || "Unknown");
    $("#p-val-family").text(person.knownFamily || "Unknown");
    $("#p-val-family-role").text(person.familyRole || "-");
    $("#p-val-phone").text(person.phoneNumber || person.phone || "Unknown");
    $("#p-val-standings").text(person.standings || person.standing || "-");
    $("#p-val-factions").text(Array.isArray(person.factions) && person.factions.length ? person.factions.join(", ") : "-");

    const affinity = Math.max(0, Math.min(100, Number(person.affinity ?? 50)));
    const affinityLabel = (() => {
        if (affinity <= 10) return "Hostile";
        if (affinity <= 25) return "Wary";
        if (affinity <= 45) return "Cold";
        if (affinity <= 60) return "Neutral";
        if (affinity <= 75) return "Warm";
        if (affinity <= 90) return "Friendly";
        return "Devoted";
    })();
    $("#p-val-rel-status").text(`${person.relationshipStatus || "-"} (${affinityLabel}, ${affinity}/100)`);
    $("#p-val-affinity-fill").css("width", `${affinity}%`);
    $("#p-val-memory-preview").text(socialMemoryPreview(person));

    try {
        const presence = person.met_physically === true ?
             "Present / met in scene"
            : (person.known_from_past === true ? "Known from the past (not present)" : "Mentioned only");
        $("#p-val-presence").text(presence);
    } catch (_) {}

    $("#p-val-likes").text(person.likes || "-");
    $("#p-val-dislikes").text(person.dislikes || "-");
    $("#p-val-schedule").text(person.schedule || "No schedule saved yet.");
    const drives = [
        person.wants ? `Wants: ${person.wants}` : "",
        person.needs ? `Needs: ${person.needs}` : "",
        person.desires ? `Desires: ${person.desires}` : ""
    ].filter(Boolean).join("\n");
    $("#p-val-drives").text(drives || "No wants, needs, or desires saved yet.");

    const avatar = String(person.avatar || "").trim();
    if (avatar) {
        $("#p-img-disp").attr("src", avatar).show();
        $(".uie-p-portrait i").hide();
    } else {
        $("#p-img-disp").hide();
        $(".uie-p-portrait i").show();
    }
    try { $("#uie-social-live-sync").prop("checked", person.liveSync !== false); } catch (_) {}
    try { $("#uie-social-map-track").prop("checked", person.mapTracked === true); } catch (_) {}

    // Location lock toggle on profile
    try {
        const lockChecked = isEntityLocationLocked(person);
        $("#uie-social-lock-location").prop("checked", lockChecked);
        $("#uie-social-lock-label").text(
            lockChecked ? `🔒 Locked to: ${String(person.lockedLocation || "Unknown")}` : "🔓 Not locked"
        );
    } catch (_) {}

    const filledCount = Math.min(10, Math.max(0, Math.floor(affinity / 10)));
    const emptyCount = Math.max(0, 10 - filledCount);
    const heartIcon = s.ui?.icons?.heart;
    if (heartIcon) {
        const filled = `<img src="${heartIcon}" style="width:24px; height:24px; object-fit:contain; vertical-align:middle; margin-right:2px;">`.repeat(filledCount);
        const empty = `<img src="${heartIcon}" style="width:24px; height:24px; object-fit:contain; vertical-align:middle; margin-right:2px; opacity:0.25; filter:grayscale(1);">`.repeat(emptyCount);
        $(".uie-p-hearts-lg").html(filled + empty);
    } else {
        let hHtml = "";
        for (let i = 1; i <= 10; i++) {
            if (i <= filledCount) {
                hHtml += '<i class="fa-solid fa-heart" style="color: #ff4a5a; margin-right: 4px; font-size: 22px;"></i>';
            } else {
                hHtml += '<i class="fa-regular fa-heart" style="color: rgba(255, 74, 90, 0.4); margin-right: 4px; font-size: 22px;"></i>';
            }
        }
        $(".uie-p-hearts-lg").html(hHtml);
    }

    const $overlay = $("#uie-social-overlay");
    try { $("#uie-profile-move-category").val(currentTab); } catch (_) {}
    $overlay.attr("data-open", "1").show();

    const $paper = $overlay.find(".uie-paper-box");
    try {
        const w = Math.max(240, Number($paper.outerWidth?.() || 0) || 360);
        const h = Math.max(240, Number($paper.outerHeight?.() || 0) || 520);
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const x = Math.max(14, Math.floor((vw - w) / 2));
        const y = Math.max(14, Math.floor((vh - h) / 2));
        const css = { top: y, left: x, right: "", bottom: "", transform: "none", maxHeight: "", overflowY: "", width: "" };
        $paper.css(css);
    } catch (_) {}
}

function readFileAsBase64(file) {
    return new Promise((resolve) => {
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = (e) => resolve(String(e?.target?.result || ""));
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}

function openAddModal({ mode, index }) {
    const s = getSettings();
    const person = (mode === "edit" && Number.isFinite(index)) ? (s.social[currentTab][index] || {}) : {};

    editingIndex = (mode === "edit" && Number.isFinite(index)) ? index : null;
    tempImgBase64 = person.avatar || null;

    $("#uie-add-modal > div:first").text(mode === "edit" ? "EDIT CONTACT" : "NEW CONTACT");
    $("#uie-submit-add").text(mode === "edit" ? "Save" : "Add to Book");

    $("#uie-add-name").val(person.name || "");
    $("#uie-add-age").val(person.age || "");
    const gender = String(person.gender || person.sex || "").trim();
    if (/^(man|woman)$/i.test(gender)) {
        $("#uie-add-gender").val(gender.replace(/^./, c => c.toUpperCase()));
        $("#uie-add-gender-custom").val("").prop("hidden", true);
    } else if (gender) {
        $("#uie-add-gender").val("Custom");
        $("#uie-add-gender-custom").val(gender).prop("hidden", false);
    } else {
        $("#uie-add-gender").val("");
        $("#uie-add-gender-custom").val("").prop("hidden", true);
    }
    $("#uie-add-family").val(person.knownFamily || "");
    // Populate role dropdown based on selected tab, then set value
    populateSocialRoleSelect(person.tab || currentTab);
    const activeRole = person.familyRole || person.relationshipStatus || "";
    const listTab = person.tab || currentTab;
    const roles = SOCIAL_ROLE_MAP[listTab] || SOCIAL_ROLE_MAP.family || [];
    if (roles.includes(activeRole)) {
        $("#uie-add-social-role").val(activeRole);
        $("#uie-add-custom-role").val("");
    } else {
        $("#uie-add-social-role").val("");
        $("#uie-add-custom-role").val(activeRole);
    }
    $("#uie-add-tab").val(person.tab || currentTab);
    $("#uie-add-affinity").val(Number.isFinite(Number(person?.affinity)) ? Number(person.affinity) : 50);
    $("#uie-add-url").val(person.url || "");
    $("#uie-add-bday").val(person.birthday || "");
    $("#uie-add-loc").val(person.location || "");
    $("#uie-add-thoughts").val(person.thoughts || "");
    $("#uie-add-likes").val(person.likes || "");
    $("#uie-add-dislikes").val(person.dislikes || "");
    try { $("#uie-add-live-sync").prop("checked", person.liveSync !== false); } catch (_) {}
    try { $("#uie-add-map-track").prop("checked", person.mapTracked === true); } catch (_) {}
    try { $("#uie-add-known-past").prop("checked", person.known_from_past === true); } catch (_) {}
    try { $("#uie-add-met-phys").prop("checked", person.met_physically === true); } catch (_) {}

    if (tempImgBase64) {
        $("#uie-add-preview").attr("src", tempImgBase64).show();
        $("#uie-add-icon").hide();
    } else {
        $("#uie-add-preview").hide();
        $("#uie-add-icon").show();
    }

    $("#uie-social-menu").hide();
    $("#uie-add-modal").show();
}

function closeAddModal() {
    $("#uie-add-modal").hide();
    $("#uie-add-img-file").val("");
    editingIndex = null;
    tempImgBase64 = null;
}

function applyAddOrEdit() {
    const s = getSettings();
    normalizeSocial(s);

    const name = String($("#uie-add-name").val() || "").trim();
    if (!name) return;

    const tab = String($("#uie-add-tab").val() || currentTab);
    const affinity = normalizeAffinity($("#uie-add-affinity").val(), 50);
    const genderChoice = String($("#uie-add-gender").val() || "").trim();
    const gender = genderChoice === "Custom"
        ? String($("#uie-add-gender-custom").val() || "").trim()
        : genderChoice;
    const person = {
        name,
        age: String($("#uie-add-age").val() || "").trim(),
        gender,
        knownFamily: String($("#uie-add-family").val() || "").trim(),
        familyRole: String($("#uie-add-social-role").val() || $("#uie-add-custom-role").val() || "").trim(),
        relationshipStatus: String($("#uie-add-social-role").val() || $("#uie-add-custom-role").val() || "").trim(),
        affinity,
        url: String($("#uie-add-url").val() || "").trim(),
        birthday: String($("#uie-add-bday").val() || "").trim(),
        location: String($("#uie-add-loc").val() || "").trim(),
        thoughts: String($("#uie-add-thoughts").val() || "").trim(),
        likes: String($("#uie-add-likes").val() || "").trim(),
        dislikes: String($("#uie-add-dislikes").val() || "").trim(),
        avatar: tempImgBase64 || "",
        tab,
        liveSync: $("#uie-add-live-sync").prop("checked") !== false,
        mapTracked: $("#uie-add-map-track").prop("checked") === true,
        known_from_past: $("#uie-add-known-past").prop("checked") === true,
        met_physically: $("#uie-add-met-phys").prop("checked") === true,
    };
    if (person.met_physically) person.known_from_past = false;

    if (editingIndex !== null && s.social[currentTab] && s.social[currentTab][editingIndex]) {
        const prev = s.social[currentTab][editingIndex];
        s.social[currentTab].splice(editingIndex, 1);
        const nextTab = tab || currentTab;
        s.social[nextTab].push({ ...prev, ...person });
    } else {
        const nextTab = tab || currentTab;
        s.social[nextTab].push({
            id: newId("person"),
            memories: [],
            familyRole: "",
            relationshipStatus: "",
            ...person,
        });
    }

    try { unforgetDeletedName(s, name); } catch (_) {}
    commitStateUpdate({ save: true, layout: false, emit: true });
    closeAddModal();
    renderSocial();
}

function toggleDeleteMode() {
    deleteMode = !deleteMode;
    selectedForDelete = [];
    $("#uie-social-menu").hide();
    try {
        if (deleteMode) window.toastr?.info?.("Mass delete: tap contacts to select, then CONFIRM DELETE.");
    } catch (_) {}
    renderSocial();
}

function confirmMassDelete() {
    const s = getSettings();
    normalizeSocial(s);
    const list = s.social[currentTab] || [];

    const selectedIdx = new Set((selectedForDelete || []).map(x => Number(x)).filter(n => Number.isFinite(n)));
    const selectedNames = new Set(
        (selectedForDelete || [])
            .map(x => (Number.isFinite(Number(x)) ? "" : String(x || "")))
            .map(x => x.trim().toLowerCase())
            .filter(Boolean)
    );

    const isSelected = (p, idx) => {
        if (selectedIdx.has(idx)) return true;
        const nm = String(p?.name || "").trim().toLowerCase();
        return nm && selectedNames.has(nm);
    };

    const removed = list.filter((p, idx) => isSelected(p, idx)).map(p => String(p?.name || "").trim()).filter(Boolean);
    if (!removed.length) {
        try { window.toastr?.info?.("No contacts selected."); } catch (_) {}
        return;
    }

    try { rememberDeletedNames(s, removed); } catch (_) {}
    s.social[currentTab] = list.filter((p, idx) => !isSelected(p, idx));
    commitStateUpdate({ save: true, layout: false, emit: true });

    deleteMode = false;
    selectedForDelete = [];
    renderSocial();

    try { window.toastr?.success?.(`Deleted ${removed.length} contact(s).`); } catch (_) {}
    try { injectRpEvent(`[System: Deleted ${removed.length} social contact(s): ${removed.join(", ")}.]`); } catch (_) {}
}

function cancelMassDelete() {
    deleteMode = false;
    selectedForDelete = [];
    renderSocial();
}

function extractNamesFromChatDom(maxMessages) {
    const names = new Set();
    try {
        const nodes = getChatMessageNodes(maxMessages || 180);
        const ctx = getContext ? getContext() : {};
        const userName = String(ctx?.name1 || "").trim().toLowerCase();

        for (const m of nodes) {
            const isUser =
                m.classList?.contains("is_user") ||
                m.getAttribute?.("is_user") === "true" ||
                m.getAttribute?.("data-is-user") === "true" ||
                m.dataset?.isUser === "true";
            if (isUser) continue;

            const nm =
                m.querySelector(".mes_name")?.textContent ||
                m.querySelector(".name_text")?.textContent ||
                m.querySelector(".name")?.textContent ||
                m.querySelector(".ch_name")?.textContent ||
                m.getAttribute?.("ch_name") ||
                m.getAttribute?.("data-name") ||
                m.dataset?.name ||
                m.dataset?.chName ||
                "";

            const n = String(nm || "").trim();
            if (userName && n.toLowerCase() === userName) continue;
            if (n && n.length <= 64) names.add(n);
        }
    } catch (_) {}
    return Array.from(names);
}

function extractTaggedNamesFromChatText(maxMessages) {
    const names = new Set();
    try {
        const nodes = Array.from(document.querySelectorAll("#chat .mes_text, #chat .mes_text *")).map(n => n.textContent).filter(Boolean);
        const blob = nodes.join("\n");
        const lines = blob.split("\n").slice(-1 * Math.max(20, Number(maxMessages || 120)));
        const reA = /<char:([^>]{2,48})>/ig;
        const reB = /<npc:([^>]{2,48})>/ig;
        const reC = /^<([^>]{2,48})>:\s/;
        for (const line of lines) {
            const s = String(line || "");
            let m = null;
            while ((m = reA.exec(s)) !== null) names.add(String(m[1] || "").trim());
            while ((m = reB.exec(s)) !== null) names.add(String(m[1] || "").trim());
            const c = s.match(reC);
            if (c && c[1]) names.add(String(c[1] || "").trim());
        }
    } catch (_) {}
    return Array.from(names);
}

function isLikelyToolOrMetaCardName(name) {
    const raw = String(name || "").trim();
    if (!raw) return true;
    const key = normalizeNameKey(raw).replace(/^[\[{(<\s]+|[\]})>\s]+$/g, "").trim();
    if (!key) return true;

    const exact = new Set([
        "system",
        "narrator",
        "story",
        "story narrator",
        "game",
        "game master",
        "gm",
        "assistant",
        "omniscient",
        "omniscent",
        "metadata",
        "meta",
        "tool",
        "tool card",
        "npc tool",
        "npc controller",
        "director",
        "story director",
        "lorebook",
        "author note",
        "author's note",
        "a/n",
        "an",
        "ooc",
        "ic",
    ]);
    if (exact.has(key)) return true;

    if (/^(meta|metadata|ooc|system|narrator|story|tool|gm|game master)\b/.test(key)) return true;
    if (/\b(omniscient|omniscent|tool\s*card|npc\s*tool|metadata\s*card|lorebook|author'?s?\s*note|control\s*card|system\s*prompt|stage\s*direction)\b/.test(key)) return true;
    if (/^[\[{(<].*[\]})>]$/.test(raw) && /\b(system|meta|ooc|narrator|tool|gm|omniscient|omniscent)\b/i.test(raw)) return true;

    return false;
}

function isLikelyRoleOnlyName(name) {
    const raw = String(name || "").trim();
    if (!raw) return true;
    const key = normalizeNameKey(raw).replace(/^[\[{(<\s"']+|[\]})>\s"']+$/g, "").trim();
    if (!key) return true;

    if (/^(mr|mrs|ms|dr|prof)\.?$/.test(key)) return true;

    const roleSingles = new Set([
        "captain", "commander", "general", "admiral", "colonel", "major", "lieutenant", "sergeant", "officer",
        "chief", "director", "agent", "master", "mistress", "professor", "doctor", "doc", "teacher",
        "king", "queen", "prince", "princess", "duke", "duchess", "lord", "lady", "sir", "madam",
        "merchant", "shopkeeper", "bartender", "innkeeper", "guard", "soldier", "knight", "nurse", "pilot",
        "driver", "clerk", "receptionist", "villager", "stranger", "boss",
    ]);
    if (roleSingles.has(key)) return true;

    if (/^(?:the\s+)?(?:captain|commander|general|admiral|colonel|major|lieutenant|sergeant|officer|chief|director|agent|merchant|shopkeeper|bartender|innkeeper|guard|soldier|knight|villager|stranger)(?:\s*#?\d+|\s+[ivx]+)?$/.test(key)) {
        return true;
    }

    return false;
}

function shouldExcludeName(n, { userNames, deletedSet } = {}) {
    const name = String(n || "").trim();
    if (!name) return true;
    if (name.length > 64) return true;
    const k = normalizeNameKey(name).replace(/^[\[{(<\s"']+|[\]})>\s"']+$/g, "").trim();
    if (!k) return true;
    if (deletedSet && deletedSet.has(k)) return true;
    if (isLikelyToolOrMetaCardName(name)) return true;
    if (isLikelyRoleOnlyName(name)) return true;

    const hard = new Set(["you", "user", "narrator", "system", "assistant", "story", "gm", "game master", "unknown"]);
    if (hard.has(k)) return true;
    if (Array.isArray(userNames) && userNames.some(u => normalizeNameKey(u).replace(/^[\[{(<\s"']+|[\]})>\s"']+$/g, "").trim() === k)) return true;
    return false;
}

async function promptOrganizationForNewContacts(names) {
    const list = Array.isArray(names) ? names.map(x => String(x || "").trim()).filter(Boolean) : [];
    if (!list.length) return;

    const max = 8;
    const subset = list.slice(0, max);
    for (const nm of subset) {
        const tabRaw = await customPrompt(`Organize contact: ${nm}\nTab (friends/associates/romance/family/rivals)\nBlank = keep default (friends)`, "");
        if (tabRaw === null) break;

        const t = String(tabRaw || "").trim().toLowerCase();
        const wantTab =
            (t === "romance" || t === "relationships") ? "romance" :
            (t === "family") ? "family" :
            (t === "rivals" || t === "rival") ? "rivals" :
            (t === "associates" || t === "associate" || t === "acquaintance" || t === "acquaintances") ? "associates" :
            (t === "friends" ? "friends" : "");

        const rel = (await customPrompt(`Relationship status for ${nm} (optional)`, "")) ?? "";
        const affRaw = await customPrompt(`Initial affinity for ${nm} (0-100)`, "50");
        if (affRaw === null) break;
        const aff = Math.max(0, Math.min(100, Number(affRaw || 50)));
        const origin = (await customPrompt(`Origin / where did ${nm} come from (optional)`, "")) ?? "";

        const s = getSettings();
        normalizeSocial(s);
        const allTabs = ["friends", "associates", "romance", "family", "rivals"];
        const curTab = allTabs.find(k => (s.social[k] || []).some(p => String(p?.name || "").trim().toLowerCase() === nm.toLowerCase())) || "friends";
        const idx = (s.social[curTab] || []).findIndex(p => String(p?.name || "").trim().toLowerCase() === nm.toLowerCase());
        if (idx < 0) continue;

        const p = s.social[curTab][idx];
        p.affinity = aff;
        if (String(rel || "").trim()) p.relationshipStatus = String(rel || "").trim().slice(0, 80);
        if (String(origin || "").trim()) {
            const o = String(origin || "").trim().slice(0, 160);
            p.thoughts = p.thoughts ? String(p.thoughts).slice(0, 240) : `Origin: ${o}`;
        }

        if (wantTab && wantTab !== curTab) {
            let changeAllowed = true;
            if (wantTab === "romance") {
                try {
                    const selfAge = Number(s.character?.age) || 18;
                    const selfStage = String(s.character?.ageStage || s.character?.age_stage || "adult").toLowerCase();
                    const targetAge = Number(p.age);
                    const targetStage = String(p.role || p.relationshipStatus || "").toLowerCase();

                    const selfIsMinor = selfAge < 18 || ["child", "baby_toddler", "teen"].includes(selfStage);
                    const selfIsChild = selfAge < 13 || ["child", "baby_toddler"].includes(selfStage);
                    const selfIsTeen = selfIsMinor && !selfIsChild;

                    const targetIsChild = (!isNaN(targetAge) && targetAge < 13) || targetStage.includes("child") || targetStage.includes("baby") || targetStage.includes("toddler");
                    const targetIsTeen = (!isNaN(targetAge) && targetAge >= 13 && targetAge < 18) || targetStage.includes("teen") || targetStage.includes("teenager");
                    const targetIsMinor = targetIsChild || targetIsTeen || (!isNaN(targetAge) && targetAge < 18);

                    if (selfIsChild || targetIsChild) {
                        alert("Safety Rule: Children cannot romance or be romanced.");
                        changeAllowed = false;
                        try { triggerSafetyWarning("Attempted romantic categorization of a child."); } catch (_) {}
                    } else if (selfIsTeen && targetIsMinor) {
                        if (!isNaN(targetAge) && !isNaN(selfAge)) {
                            const gap = Math.abs(selfAge - targetAge);
                            if (gap > 2) {
                                alert("Safety Rule: Teen-teen romantic pairing must be within a 2-year age gap.");
                                changeAllowed = false;
                                try { triggerSafetyWarning("Attempted romantic pairing between teens with >2-year age gap."); } catch (_) {}
                            }
                        }
                    } else if (selfIsTeen && !targetIsMinor) {
                        alert("Safety Rule: Teenager cannot romance an adult.");
                        changeAllowed = false;
                        try { triggerSafetyWarning("Attempted romantic pairing between teen and adult."); } catch (_) {}
                    } else if (!selfIsMinor && targetIsMinor) {
                        alert("Safety Rule: Adult cannot romance a minor.");
                        changeAllowed = false;
                        try { triggerSafetyWarning("Attempted romantic pairing between adult and minor."); } catch (_) {}
                    }
                } catch (_) {}
            }

            if (changeAllowed) {
                s.social[curTab].splice(idx, 1);
                p.tab = wantTab;
                s.social[wantTab].push(p);
            }
        }
        commitStateUpdate({ save: true, layout: false, emit: true });
    }

    renderSocial();
    if (list.length > max) {
        try { notify("info", `Added ${list.length} names. Prompted for ${max}; organize the rest later in Social.`, "Social", "social"); } catch (_) {}
    }
}

function extractNamesFromTextHeuristics(maxMessages) {
    const names = new Set();
    try {
        const nodes = Array.from(document.querySelectorAll("#chat .mes_text, #chat .mes_text *")).map(n => n.textContent).filter(Boolean);
        const blob = nodes.join("\n");
        const lines = blob.split("\n").slice(-1 * Math.max(20, Number(maxMessages || 80)));
        const re1 = /^([A-Za-z][A-Za-z0-9' -]{2,48}):\s/;
        const re2 = /\b(?:NPC|Character|Speaker|Name)\s*[:=-]\s*([A-Za-z][A-Za-z0-9' -]{2,48})\b/;
        for (const line of lines) {
            const a = String(line || "").match(re1);
            if (a && a[1]) names.add(String(a[1]).trim());
            const b = String(line || "").match(re2);
            if (b && b[1]) names.add(String(b[1]).trim());
        }
    } catch (_) {}
    return Array.from(names);
}

async function aiExtractNamesFromChat(maxMessages) {
    try {
        const msgs = [];
        const nodes = getChatMessageNodes(maxMessages || 140);
        for (const m of nodes) {
            const nm =
                m.querySelector(".mes_name")?.textContent ||
                m.querySelector(".name_text")?.textContent ||
                m.querySelector(".name")?.textContent ||
                "";
            const tx =
                m.querySelector(".mes_text")?.textContent ||
                m.querySelector(".mes-text")?.textContent ||
                m.textContent ||
                "";
            const n = String(nm || "").trim() || "Unknown";
            const t = String(tx || "").trim();
            if (!t) continue;
            msgs.push(`${n}: ${t}`);
        }

        const transcript = msgs.join("\n").slice(-14000);
        if (!transcript) return { names: [], questions: [] };

        const ctx = getContext ? getContext() : {};
        const user = String(ctx?.name1 || "").trim();
        const main = String(ctx?.name2 || "").trim();

        const prompt = `[UIE_LOCKED]
Task: Extract a list of distinct NPC/person names that the user should add to a Social/Contacts list.

Input chat transcript (may include omniscient tool cards / metadata; ignore anything that is not an in-world speaker/name):
${transcript}

User name: "${user}"
Main character name: "${main}"

Return ONLY valid JSON:
{"names":["..."],"questions":["..."]}

Rules:
- names: 0 to 24 distinct person names seen in chat (speakers or explicitly referenced as characters).
- Exclude the User name. Include the Main character name if it appears in chat.
- Do not invent new people. Only output names that appear in the transcript.
- If uncertain about whether a token is a name, do NOT include it; instead add a short question in questions asking what it refers to.
- Keep names short (2-40 chars), no emojis, no titles like "Mr.", no roles like "Guard #2" unless that is literally used as the name.`;

        const res = await generateContent(prompt, "System Check");
        if (!res) return { names: [], questions: [] };
        const obj = safeJsonParseObject(res) || {};
        const names = Array.isArray(obj?.names) ? obj.names.map(x => String(x || "").trim()).filter(Boolean) : [];
        const questions = Array.isArray(obj?.questions) ? obj.questions.map(x => String(x || "").trim()).filter(Boolean) : [];
        return { names: names.slice(0, 24), questions: questions.slice(0, 6) };
    } catch (_) {
        return { names: [], questions: [] };
    }
}

export async function scanChatIntoSocial({ silent, maxMessages, deep, allowMentionOnly } = {}) {
    const now = Date.now();
    if (autoScanRuntime.inFlight) {
        if (!silent) notify("info", "Social scan already running.", "Social", "social");
        return;
    }
    if (now - autoScanRuntime.lastAt < 1500) {
        if (!silent) notify("info", "Social scan already triggered. Please wait a moment.", "Social", "social");
        return;
    }

    autoScanRuntime.inFlight = true;
    autoScanRuntime.lastAt = now;

    try {
        const s = getSettings();
        normalizeSocial(s);
        const trackedCount = ["friends", "associates", "romance", "family", "rivals"].reduce((sum, tab) => {
            const list = Array.isArray(s?.social?.[tab]) ? s.social[tab] : [];
            return sum + list.length;
        }, 0);
        const firstRun = trackedCount === 0;
        const strictScan = s.socialMeta?.strictScan !== false;
        const allowMentionOnlyContacts = allowMentionOnly === true;

        const ctx = getContext ? getContext() : {};
        const userName = String(ctx?.name1 || "").trim();
        const mainCharName = String(ctx?.name2 || "").trim();
        const deleted = deletedNameSet(s);
        const userNames = [userName, mainCharName].filter(Boolean);

        const scanDepth = Math.max(120, Number(maxMessages || 0) || (deep === true || firstRun ? 420 : 260));
        const transcript = await getChatTranscript(scanDepth);
        if (!transcript) {
            if (!silent) notify("info", "No chat transcript found.", "Social", "social");
            return;
        }

    const prompt = `[UIE_LOCKED]
Analyze the following chat transcript to find characters/people for the Social Contacts list.
User Name: "${userName}"

Transcript:

${transcript.slice(-Math.max(22000, deep === true || firstRun ? 52000 : 32000))}

Task: Identify characters (NPCs/people) who are actually encountered in scene, directly interacting, speaking, messaging, traveling with the cast, or clearly established as known from the past.
Return ONLY valid JSON:
{"found":[{"name":"Name","role":"friend|rival|romance|family|associate|npc","affinity":50,"presence":"present|mentioned|known_past","relationshipStatus":"","thoughts":"","location":"","age":"","knownFamily":"","familyRole":"","birthday":"","likes":"","dislikes":"","phoneNumber":"","schedule":"","wants":"","needs":"","desires":"","standings":"","factions":[],"url":"","met_physically":false,"known_from_past":false}]}

Rules:
- STRICT SOCIAL TEMPLATE: every found object MUST use exactly the fields shown above. Keep field names stable because the frontend renders Stardew-style horizontal cards, profile sheets, memories, tracker rows, and lineage from this schema.
- Every named character knows their own fake phone number; if none appears, invent a plausible fake 555-style number.
- Include schedule, wants, needs, desires, standings, factions, and current location when the chat/lore implies them; these drive map movement, party behavior, and battle/party stat generation.
- Name quality is critical: use the exact in-world display name from the transcript. Do not merge two people, do not create placeholders, and do not use titles alone unless no personal name exists.
- If family, ancestry, marriage, siblings, children, descendants, guardianship, heirs, or bloodline information appears, put the tie in knownFamily and the specific role in familyRole so the lineage view can render it.
- Location should be the last clear in-world place for the person, not a vague guess.
- Include only characters grounded by the transcript. Do not invent.
- Exclude user/system/meta/tool controller names.
- Prefer people who are physically met, currently present, or directly participating.
- Set met_physically=true for people who are present, speaking, acting, calling, texting, or otherwise directly interacting in the log.
- Set known_from_past=true only when a prior relationship or history is clearly stated.
- STRICT ENCOUNTER MODE: You MUST strictly exclude characters who are only 'mentioned in passing' (non-encounter name drops, rumors, celebrities, background names). Only include characters who are physically met, speaking, calling, texting, or directly participating in a scene. If a character is only spoken about by others and does not appear in the scene, DO NOT include them.
- affinity must be 0..100; if unknown use 50.
- Fill unknown text fields with empty string.
- thoughts should summarize the character's current in-world mood, goal, or activity when the chat makes it clear.
- name must be concise and stable.`;

        try { window.toastr?.info?.("Scanning story for characters..."); } catch (_) {}

        let found = [];
        let res = "";
        try {
            res = await generateContent(prompt, "Social Scan");
        } catch (_) {
            res = "";
        }

        if (res) {
            const obj = safeJsonParseObject(res) || {};
            if (Array.isArray(obj?.found)) {
                found = obj.found;
            } else if (Array.isArray(obj?.names)) {
                found = obj.names
                    .map((name) => ({ name: String(name || "").trim(), role: "associate", affinity: 50, presence: "mentioned" }))
                    .filter((x) => x.name);
            }
        }

        if (!found.length && !strictScan) {
            try {
                const alt = await aiExtractNamesFromChat(240);
                const names = Array.isArray(alt?.names) ? alt.names : [];
                found = names
                    .map((name) => ({ name: String(name || "").trim(), role: "associate", affinity: 50, presence: "mentioned" }))
                    .filter((x) => x.name);
            } catch (_) {}
        }

        if (!found.length && !strictScan) {
            const fallbackNames = [
                ...extractNamesFromChatDom(240),
                ...extractTaggedNamesFromChatText(240),
                ...extractNamesFromTextHeuristics(240),
            ];
            const uniq = Array.from(new Set(fallbackNames.map(n => String(n || "").trim()).filter(Boolean)));
            found = uniq.map((name) => ({ name, role: "associate", affinity: 50, presence: "mentioned" }));
        }

        if (!found.length) {
            if (!silent) notify("info", "No characters found in chat.", "Social", "social");
            return;
        }

        const normalizeRoleToTab = (role, affinity = 50, familyRole = "", relationshipStatus = "") => {
            const r = `${String(role || "")} ${String(relationshipStatus || "")} ${String(familyRole || "")}`.toLowerCase();
            if (r.includes("family") || r.includes("mother") || r.includes("father") || r.includes("sister") || r.includes("brother") || r.includes("daughter") || r.includes("son")) return "family";
            
            // Check romance restriction conditions
            let romanceAllowed = true;
            try {
                const s = getSettings();
                const selfAge = Number(s.character?.age) || 18;
                const selfStage = String(s.character?.ageStage || s.character?.age_stage || "adult").toLowerCase();
                
                // Estimate target minor state from fields
                const targetAgeText = String(v?.age || "").trim();
                const targetAge = targetAgeText ? Number(targetAgeText) : NaN;
                const targetStage = String(v?.role || role || "").toLowerCase();
                
                const selfIsMinor = selfAge < 18 || ["child", "baby_toddler", "teen"].includes(selfStage);
                const selfIsChild = selfAge < 13 || ["child", "baby_toddler"].includes(selfStage);
                const selfIsTeen = selfIsMinor && !selfIsChild;
                
                const targetIsChild = (!isNaN(targetAge) && targetAge < 13) || targetStage.includes("child") || targetStage.includes("baby") || targetStage.includes("toddler");
                const targetIsTeen = (!isNaN(targetAge) && targetAge >= 13 && targetAge < 18) || targetStage.includes("teen") || targetStage.includes("teenager");
                const targetIsMinor = targetIsChild || targetIsTeen || (!isNaN(targetAge) && targetAge < 18);
                
                if (selfIsChild || targetIsChild) {
                    romanceAllowed = false; // Children can never romance
                } else if (selfIsTeen && targetIsMinor) {
                    // Teen can romance teen only if gap is <= 2 years
                    if (!isNaN(targetAge) && !isNaN(selfAge)) {
                         const gap = Math.abs(selfAge - targetAge);
                         if (gap > 2) romanceAllowed = false;
                    }
                } else if (selfIsTeen && !targetIsMinor) {
                    romanceAllowed = false; // Teen cannot romance adult
                } else if (!selfIsMinor && targetIsMinor) {
                    romanceAllowed = false; // Adult cannot romance minor
                }
            } catch (_) {}

            if (romanceAllowed && (r.includes("romance") || r.includes("lover") || r.includes("dating") || r.includes("spouse") || r.includes("wife") || r.includes("husband"))) {
                return "romance";
            }
            if (r.includes("rival") || r.includes("enemy") || r.includes("hostile") || Number(affinity) <= 20) return "rivals";
            if (r.includes("associate") || r.includes("acquaintance") || r.includes("contact") || r.includes("npc") || r.includes("merchant") || r.includes("stranger")) return "associates";
            return "associates";
        };

        const tabPriority = { friends: 1, associates: 2, family: 3, romance: 4, rivals: 5 };
        const tabs = ["friends", "associates", "romance", "family", "rivals"];
        const findByNameKey = (nameKey) => {
            for (const tab of tabs) {
                const idx = (s.social[tab] || []).findIndex(p => normalizeNameKey(p?.name || "") === nameKey);
                if (idx >= 0) return { tab, idx, person: s.social[tab][idx] };
            }
            return { tab: "friends", idx: -1, person: null };
        };

        let added = 0;
        let updated = 0;
        let accepted = 0;
        const seenThisRun = new Set();

        for (const v of found) {
            const nm = cleanFieldValue(v?.name, 64);
            if (!nm) continue;

            const key = normalizeNameKey(nm);
            if (!key || seenThisRun.has(key)) continue;
            seenThisRun.add(key);

            if (shouldExcludeName(nm, { userNames, deletedSet: deleted })) continue;

            const flags = derivePresenceFlags(v);
            const evidence = inferContactEvidenceFromTranscript(transcript, nm);
            const met = flags.met || evidence.met;
            const knownPast = !met && (flags.knownPast || evidence.knownPast);
            if (!met && !knownPast && !allowMentionOnlyContacts) continue;

            accepted++;
            if (accepted > 40) break;

            const familyRole = cleanFieldValue(firstNonEmpty(v?.familyRole, v?.family_role), 80);
            const relationshipRaw = cleanFieldValue(firstNonEmpty(v?.relationshipStatus, v?.relationship, v?.status, v?.role), 80);
            const aff = normalizeAffinity(v?.affinity, 50);
            const tab = normalizeRoleToTab(v?.role || relationshipRaw, aff, familyRole, relationshipRaw);

            const thoughts = cleanFieldValue(firstNonEmpty(v?.thoughts, v?.notes, v?.summary, v?.description), 240);
            const location = cleanFieldValue(v?.location, 120);
            const age = cleanFieldValue(v?.age, 40);
            const knownFamily = cleanFieldValue(firstNonEmpty(v?.knownFamily, v?.known_family, v?.family), 120);
            const birthday = cleanFieldValue(v?.birthday, 48);
            const likes = cleanFieldValue(v?.likes, 180);
            const dislikes = cleanFieldValue(v?.dislikes, 180);
            const phoneNumber = cleanFieldValue(firstNonEmpty(v?.phoneNumber, v?.phone), 40);
            const schedule = cleanFieldValue(v?.schedule, 600);
            const wants = cleanFieldValue(v?.wants, 300);
            const needs = cleanFieldValue(v?.needs, 300);
            const desires = cleanFieldValue(v?.desires, 300);
            const standings = cleanFieldValue(firstNonEmpty(v?.standings, v?.standing), 240);
            const factions = Array.isArray(v?.factions) ? v.factions.map((x) => cleanFieldValue(x, 80)).filter(Boolean).slice(0, 12) : [];
            const url = safeUrl(cleanFieldValue(v?.url, 240));
            const avatar = findAvatarForNameFromChat(nm);

            let relationshipStatus = relationshipRaw;
            if (!relationshipStatus && tab === "family") relationshipStatus = familyRole ? `Family: ${familyRole}` : "Family";
            if (!relationshipStatus && tab === "romance") relationshipStatus = "Romantic connection";
            if (!relationshipStatus && tab === "rivals") relationshipStatus = "Hostile / rival";
            if (!relationshipStatus && tab === "friends") relationshipStatus = "Friendly";
            if (!relationshipStatus) relationshipStatus = knownPast ? "Known from the past" : (met ? "Known contact" : "Mentioned in story");

            const hit = findByNameKey(key);
            if (hit.person) {
                const person = hit.person;
                let changed = false;

                if (!person.id) { person.id = newId("person"); changed = true; }
                if (!Array.isArray(person.memories)) { person.memories = []; changed = true; }
                if (!Number.isFinite(Number(person.affinity))) { person.affinity = 50; changed = true; }
                if (typeof person.liveSync !== "boolean") { person.liveSync = true; changed = true; }
                if (typeof person.mapTracked !== "boolean") { person.mapTracked = false; changed = true; }
                const liveSyncEnabled = person.liveSync !== false;

                const prevAff = normalizeAffinity(person.affinity, 50);
                if (liveSyncEnabled && prevAff !== aff && (prevAff === 50 || aff <= 30 || aff >= 70)) {
                    person.affinity = aff;
                    changed = true;
                    try { injectRpEvent(`[System: Affinity change: ${person.name} is now ${aff} (previously ${prevAff}).]`); } catch (_) {}
                }

                if (avatar && !String(person.avatar || "").trim()) {
                    person.avatar = avatar;
                    changed = true;
                }

                if (liveSyncEnabled) {
                    const prevLocationForMap = String(person.location || "").trim();
                    changed = maybeUpdateTextField(person, "relationshipStatus", relationshipStatus, 80) || changed;
                    changed = maybeUpdateTextField(person, "thoughts", thoughts, 240) || changed;
                    changed = maybeUpdateTextField(person, "location", met ? (location || "In current scene") : location, 120) || changed;
                    const nextLocationForMap = String(person.location || "").trim();
                    if (nextLocationForMap && nextLocationForMap !== prevLocationForMap) {
                        offerSocialLocationToMap(person.name || nm, nextLocationForMap);
                    }
                    changed = maybeUpdateTextField(person, "age", age, 40) || changed;
                    changed = maybeUpdateTextField(person, "knownFamily", knownFamily, 120) || changed;
                    changed = maybeUpdateTextField(person, "familyRole", familyRole, 80) || changed;
                    changed = maybeUpdateTextField(person, "birthday", birthday, 48) || changed;
                    changed = maybeUpdateTextField(person, "likes", likes, 180) || changed;
                    changed = maybeUpdateTextField(person, "dislikes", dislikes, 180) || changed;
                    changed = maybeUpdateTextField(person, "phoneNumber", phoneNumber, 40) || changed;
                    if (phoneNumber) person.phone = phoneNumber;
                    changed = maybeUpdateTextField(person, "schedule", schedule, 600) || changed;
                    changed = maybeUpdateTextField(person, "wants", wants, 300) || changed;
                    changed = maybeUpdateTextField(person, "needs", needs, 300) || changed;
                    changed = maybeUpdateTextField(person, "desires", desires, 300) || changed;
                    changed = maybeUpdateTextField(person, "standings", standings, 240) || changed;
                    if (factions.length) {
                        const merged = Array.from(new Set([...(Array.isArray(person.factions) ? person.factions : []), ...factions]));
                        if (JSON.stringify(merged) !== JSON.stringify(person.factions || [])) {
                            person.factions = merged;
                            changed = true;
                        }
                    }
                }

                if (url && String(person.url || "").trim() !== url) {
                    person.url = url;
                    changed = true;
                }

                if (met && person.met_physically !== true) {
                    person.met_physically = true;
                    changed = true;
                }
                if (knownPast && person.known_from_past !== true) {
                    person.known_from_past = true;
                    changed = true;
                }
                if (person.met_physically === true && person.known_from_past === true) {
                    person.known_from_past = false;
                    changed = true;
                }

                if (liveSyncEnabled && tab !== hit.tab && (tabPriority[tab] || 0) >= (tabPriority[hit.tab] || 0)) {
                    s.social[hit.tab].splice(hit.idx, 1);
                    person.tab = tab;
                    s.social[tab].push(person);
                    changed = true;
                }

                if (changed) updated++;
                continue;
            }

            const p = {
                id: newId("person"),
                name: nm,
                affinity: aff,
                thoughts,
                avatar: avatar || "",
                likes,
                dislikes,
                birthday,
                location: met ? (location || "In current scene") : location,
                age,
                knownFamily,
                familyRole,
                relationshipStatus,
                phoneNumber,
                phone: phoneNumber,
                schedule,
                wants,
                needs,
                desires,
                standings,
                factions,
                url,
                tab,
                memories: [],
                liveSync: true,
                mapTracked: false,
                met_physically: met,
                known_from_past: met ? false : knownPast,
            };

            s.social[tab].push(p);
            offerSocialLocationToMap(p.name, p.location);
            added++;
            try { injectRpEvent(`[System: Added contact: ${p.name}. Affinity: ${p.affinity}. Relationship: ${p.relationshipStatus || "None"}.]`); } catch (_) {}
        }

        if (added || updated) {
            commitStateUpdate({ save: true, layout: false, emit: true });
            renderSocial();
            if (!silent) {
                const parts = [];
                if (added) parts.push(`${added} added`);
                if (updated) parts.push(`${updated} updated`);
                notify("success", `Social scan complete: ${parts.join(", ")}.`, "Social", "social");
            }
        } else if (!silent) {
            notify("info", "No social updates found (all exist or ignored).", "Social", "social");
        }

        _publishOrgIntelFromSocialContacts(s);
    } finally {
        autoScanRuntime.inFlight = false;
    }
}

function _publishOrgIntelFromSocialContacts(s) {
    try {
        const tabs = ["friends", "associates", "romance", "family", "rivals"];
        for (const tab of tabs) {
            const list = Array.isArray(s?.social?.[tab]) ? s.social[tab] : [];
            for (const person of list) {
                if (!person?.name) continue;
                const affiliationFields = [
                    ...(Array.isArray(person.factions) ? person.factions : []),
                    ...(Array.isArray(person.affiliations) ? person.affiliations : []),
                    ...(Array.isArray(person.organizationAffiliations) ? person.organizationAffiliations : []),
                    ...(Array.isArray(person.organizations) ? person.organizations : []),
                ];
                const singleOrg = String(person.organization || person.org || "").trim();
                if (singleOrg) affiliationFields.push(singleOrg);
                const affiliations = Array.from(new Set(affiliationFields.map((a) => String(a || "").trim()).filter((a) => a && a.length >= 3)));
                for (const affiliation of affiliations) {
                    publishOrganizationIntel({
                        source: "social",
                        sourceId: person.id || person.name,
                        confidence: 0.82,
                        organizationName: affiliation,
                        people: [{
                            name: person.name,
                            rank: String(person.rank || person.status || "").trim(),
                            role: String(person.role || person.job || "").trim(),
                            location: String(person.currentLocation || person.location || "").trim(),
                            sourceType: "social",
                            sourceId: person.id || person.name
                        }],
                        proposedPatch: {
                            members: [person.name],
                            controlledSpaces: person.location ? [person.location] : [],
                            activeHooks: person.schedule ? [`${person.name} has schedule activity tied to this organization.`] : []
                        },
                        reason: "Social contact has organization/faction affiliation data."
                    });
                }
                const memories = Array.isArray(person.memories) ? person.memories : [];
                for (const mem of memories) {
                    const text = String(mem?.text || "").trim();
                    if (text.length < 20) continue;
                    const orgNames = _extractOrgNamesFromMemory(text);
                    for (const orgName of orgNames) {
                        publishOrganizationIntel({
                            source: "social_memory",
                            sourceId: `${person.id || person.name}:mem`,
                            confidence: 0.45,
                            organizationName: orgName,
                            text,
                            people: [{ name: person.name, sourceType: "social", sourceId: person.id || person.name }],
                            proposedPatch: {
                                rumors: [`${person.name}: ${text.slice(0, 200)}`]
                            },
                            reason: `Social memory for ${person.name} may reference organization "${orgName}".`
                        });
                    }
                }
            }
        }
    } catch (_) {}
}

function _extractOrgNamesFromMemory(text) {
    if (!text || typeof text !== "string") return [];
    const found = new Set();
    const pattern = /(?:the|a|an)\s+([A-Z][A-Za-z\s]{2,30}?)\s+(guild|club|council|crew|gang|family|house|company|agency|order|cult|team|school|academy|watch|guard|syndicate|union|committee|department|faction|tribe|clan|brotherhood|sisterhood|sect|temple|church|ministry|corporation|firm|bureau|society|circle|league|cartel|mafia|mob)/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        const name = `${match[1].trim()} ${match[2]}`.trim();
        if (name.length >= 4) found.add(name);
    }
    return Array.from(found);
}

function giftMemoriesSnippet(person) {
    const arr = Array.isArray(person?.memories) ? person.memories.slice(-12) : [];
    if (!arr.length) return "(none)";
    return arr
        .map((m) => String(m?.text || "").trim().slice(0, 220))
        .filter(Boolean)
        .map((t) => `- ${t}`)
        .join("\n");
}

/**
 * Apply a tangible gift to a social contact: model decides accept/reject and affinity delta from memories + scene context.
 * Party stash gifts skip “continue scene” nudges. Personal-inventory callers may consume the item only when accepted.
 */
export async function applyItemGiftToContact(contactName, itemSummary, { fromPartyStash = false } = {}) {
    const nm = String(contactName || "").trim();
    if (!nm) return { ok: false, error: "Name required" };
    const item = String(itemSummary || "gift").trim() || "gift";
    const s = getSettings();
    normalizeSocial(s);
    const tabs = ["friends", "associates", "romance", "family", "rivals"];
    let curTab =
        tabs.find((k) => (s.social[k] || []).some((p) => String(p?.name || "").trim().toLowerCase() === nm.toLowerCase())) || "friends";
    let idx = (s.social[curTab] || []).findIndex((p) => String(p?.name || "").trim().toLowerCase() === nm.toLowerCase());
    if (idx < 0) {
        s.social.friends.push({
            id: newId("person"),
            name: nm,
            affinity: 50,
            thoughts: "",
            avatar: "",
            likes: "",
            dislikes: "",
            birthday: "",
            location: "",
            age: "",
            knownFamily: "",
            familyRole: "",
            relationshipStatus: "",
            url: "",
            tab: "friends",
            memories: [],
            met_physically: false,
        });
        curTab = "friends";
        idx = s.social.friends.length - 1;
    }
    const person = s.social[curTab][idx];
    const prevAffinity = normalizeAffinity(Number(person.affinity ?? 50), 50);

    let chatCtx = "";
    try {
        chatCtx = (await getChatTranscriptText({ maxMessages: 24, maxChars: 3200 })) || "";
    } catch (_) {
        chatCtx = "";
    }
    chatCtx = String(chatCtx || "").trim().slice(0, 3200);

    const prompt = `You evaluate a roleplay moment: a gift is offered to a character.

Contact: ${nm}
Gift (label): ${item}
${fromPartyStash ? "Source: party shared stash (group inventory)." : "Source: the giver's personal inventory."}

Character (for judgment only):
- Affinity toward giver (0-100): ${prevAffinity}
- Thoughts: ${String(person.thoughts || "").trim().slice(0, 400) || "—"}
- Likes: ${String(person.likes || "").trim().slice(0, 400) || "—"}
- Dislikes: ${String(person.dislikes || "").trim().slice(0, 400) || "—"}
- Relationship: ${String(person.relationshipStatus || "").trim().slice(0, 120) || "—"}
- Location note: ${String(person.location || "").trim().slice(0, 160) || "—"}

Memories (newest last):
${giftMemoriesSnippet(person)}

Recent chat/scene (may be empty):
${chatCtx || "(none)"}

They may REFUSE if the gift is inappropriate, insulting, tactless, triggers bad history, violates boundaries, or clashes with dislikes/memories. If they accept, affinity may rise modestly; if they refuse or are offended, affinity may DROP.

Reply with ONLY valid JSON (no markdown):
{"accepted":true or false,"affinity_delta":integer from -25 to 18,"reason":"one short sentence","narration":"one short in-world line or empty string"}`;

    let accepted = true;
    let affinityDelta = 0;
    let reason = "";
    let narration = "";

    try {
        const res = await generateContent(prompt, "System Check");
        const obj = safeJsonParseObject(res || "") || {};
        if (obj.accepted === false || toBoolFlag(obj.rejected)) accepted = false;
        else if (obj.accepted === true) accepted = true;

        let d = Math.round(Number(obj.affinity_delta ?? obj.delta ?? 0));
        if (!Number.isFinite(d)) d = 0;
        affinityDelta = Math.max(-25, Math.min(18, d));
        reason = String(obj.reason || "").trim().slice(0, 280);
        narration = String(obj.narration || "").trim().slice(0, 400);
    } catch (_) {
        accepted = true;
        affinityDelta = Math.min(12, Math.max(4, 6 + Math.floor(Math.random() * 5)));
        reason = "";
        narration = "";
    }

    if (!accepted && affinityDelta > 0) {
        affinityDelta = -Math.min(18, Math.max(2, Math.abs(affinityDelta)));
    }
    if (accepted && affinityDelta < -12) affinityDelta = -12;

    person.affinity = normalizeAffinity(prevAffinity + affinityDelta, 50);

    if (!Array.isArray(person.memories)) person.memories = [];
    const stashNote = fromPartyStash ? " (party stash)" : "";
    const reasonBit = reason ? ` — ${reason.slice(0, 120)}` : "";
    person.memories.push({
        ts: Date.now(),
        text: accepted ?
             `Accepted a gift: ${item.slice(0, 100)}${reasonBit}${stashNote}.`
            : `Refused or returned a gift: ${item.slice(0, 100)}${reasonBit}${stashNote}.`,
    });
    if (person.memories.length > 40) person.memories.splice(0, person.memories.length - 40);

    if (!Array.isArray(person.giftsReceived)) person.giftsReceived = [];
    person.giftsReceived.push({
        item: item.slice(0, 120),
        at: Date.now(),
        fromPartyStash: !!fromPartyStash,
        accepted: !!accepted,
        affinityDelta,
    });
    if (person.giftsReceived.length > 60) person.giftsReceived.splice(0, person.giftsReceived.length - 60);

    commitStateUpdate({ save: true, layout: false, emit: true });

    try {
        const beat = narration ?
             ` ${narration}`
            : ` Affinity ${affinityDelta >= 0 ? "+" : ""}${affinityDelta} → ~${person.affinity}.`;
        injectRpEvent(
            `[Gift: ${nm} ${accepted ? "accepted" : "declined"} ${item.slice(0, 80)}${fromPartyStash ? " (party inventory)" : ""}.${beat}]`
        );
    } catch (_) {}

    if (!fromPartyStash && accepted) {
        try {
            injectRpEvent(`[The scene continues naturally after the gift exchange.]`);
        } catch (_) {}
    }

    return {
        ok: true,
        affinity: person.affinity,
        accepted: !!accepted,
        affinityDelta,
        reason,
        narration,
        fromPartyStash: !!fromPartyStash,
    };
}

export async function updateRelationshipScore(name, text, source) {
    const nm = String(name || "").trim();
    const tx = String(text || "").trim();
    const src = String(source || "").trim();
    if (!nm || !tx) return;

    const s = getSettings();
    normalizeSocial(s);
    const deleted = deletedNameSet(s);
    if (deleted.has(nm.toLowerCase())) return;

    const tabs = ["friends", "associates", "romance", "family", "rivals"];
    let curTab = tabs.find(k => (s.social[k] || []).some(p => String(p?.name || "").trim().toLowerCase() === nm.toLowerCase())) || "friends";
    let idx = (s.social[curTab] || []).findIndex(p => String(p?.name || "").trim().toLowerCase() === nm.toLowerCase());
    if (idx < 0) {
        s.social.friends.push({ id: newId("person"), name: nm, affinity: 50, thoughts: "", avatar: "", likes: "", dislikes: "", birthday: "", location: "", age: "", knownFamily: "", familyRole: "", relationshipStatus: "", url: "", tab: "friends", memories: [], met_physically: false });
        curTab = "friends";
        idx = s.social.friends.length - 1;
    }

    const person = s.social[curTab][idx];
    const prevAff = Math.max(0, Math.min(100, Number(person?.affinity ?? 50)));
    const prevRole = String(person?.relationshipStatus || "").trim();
    const prevMet = person?.met_physically === true;

    const prompt = SCAN_TEMPLATES.social.relationship(nm, src, tx.slice(0, 1200), prevAff, prevRole, prevMet);

    let delta = 0;
    let role = "";
    try {
        const res = await generateContent(prompt, "System Check");
        const obj = safeJsonParseObject(res || "") || {};
        delta = Math.max(-10, Math.min(10, Math.round(Number(obj?.delta || 0))));
        role = String(obj?.role || "").trim().slice(0, 80);
    } catch (_) {
        delta = 0;
        role = "";
    }

    const nextAff = Math.max(0, Math.min(100, prevAff + delta));
    if (delta !== 0) person.affinity = nextAff;
    if (role) person.relationshipStatus = role;
    if (src === "face_to_face") person.met_physically = true;
    else if (person.met_physically !== true) person.met_physically = false;

    if (delta !== 0 || (role && role !== prevRole)) {
        commitStateUpdate({ save: true, layout: false, emit: true });
        try {
            injectRpEvent(`[Canon Event: Interaction with ${nm}. Affinity: ${Math.round(Number(person.affinity || prevAff))}. Status: ${String(person.relationshipStatus || prevRole || "").trim() || "-"}.]`);
            if (delta !== 0) {
                injectRpEvent(`[System: Affinity change: ${nm} is now ${person.affinity} (previously ${prevAff}).]`);
            }
            if (role && role !== prevRole) {
                injectRpEvent(`[System: Relationship status of ${nm} changed to ${role} (previously ${prevRole || "none"}).]`);
            }
        } catch (_) {}
    } else {
        commitStateUpdate({ save: true, layout: false, emit: true });
    }
}

export function initSocial() {
    const $win = $("#uie-social-window");

    // Ensure correct visual active state on load
    $win.find(".uie-tab").removeClass("active");
    $win.find(`.uie-tab[data-tab='${currentTab}']`).addClass("active");

    $win.off("click", ".uie-tab");
    $win.on("click", ".uie-tab", function() {
        $win.find(".uie-tab").removeClass("active");
        $(this).addClass("active");
        currentTab = $(this).data("tab");
        renderSocial();
    });

    $win.off("change.uieSocialImg", "#uie-add-img-file");
    $win.on("change.uieSocialImg", "#uie-add-img-file", async function() {
        const f = this.files && this.files[0];
        const base64 = await readFileAsBase64(f);
        tempImgBase64 = base64;
        if (base64) {
            $("#uie-add-preview").attr("src", base64).show();
            $("#uie-add-icon").hide();
        }
    });

    $win.off("pointerdown.uieSocialCard touchstart.uieSocialCard");
    $win.on("pointerdown.uieSocialCard touchstart.uieSocialCard", ".uie-social-card", function() {
        const idx = Number($(this).data("idx"));
        if (!Number.isFinite(idx)) return;
        socialLongPressFired = false;
        try { clearTimeout(socialLongPressTimer); } catch (_) {}
        socialLongPressTimer = setTimeout(() => {
            socialLongPressFired = true;
            if (!deleteMode) {
                deleteMode = true;
                selectedForDelete = [];
            }
            if (selectedForDelete.includes(idx)) selectedForDelete = selectedForDelete.filter(x => x !== idx);
            else selectedForDelete.push(idx);
            renderSocial();
            try { window.toastr?.info?.("Mass delete: tap contacts to select, then CONFIRM DELETE."); } catch (_) {}
        }, 520);
    });

    $win.off("pointerup.uieSocialCard pointercancel.uieSocialCard touchend.uieSocialCard touchcancel.uieSocialCard");
    $win.on("pointerup.uieSocialCard pointercancel.uieSocialCard touchend.uieSocialCard touchcancel.uieSocialCard", ".uie-social-card", function() {
        try { clearTimeout(socialLongPressTimer); } catch (_) {}
    });

    $win.off("click", ".uie-social-card");
    $win.on("click", ".uie-social-card", function(e) {
        e.stopPropagation();
        if (socialLongPressFired) {
            socialLongPressFired = false;
            return;
        }

        const idx = $(this).data("idx");
        if (deleteMode) {
            const i = Number(idx);
            if (!Number.isFinite(i)) return;
            if (selectedForDelete.includes(i)) selectedForDelete = selectedForDelete.filter(x => x !== i);
            else selectedForDelete.push(i);
            renderSocial();
            return;
        }
        openProfile(idx, this);
    });

    $win.off("click.uieSocialClose");
    $win.on("click.uieSocialClose", "#uie-social-close", (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-overlay").removeAttr("data-open").hide(); $win.hide(); $("#uie-social-menu").hide(); closeAddModal(); });
    $win.on("click.uieSocialClose", ".uie-p-close", (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-overlay").removeAttr("data-open").hide(); });
    $win.on("click.uieSocialMemClose", "#uie-social-mem-close", (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-mem-overlay").hide(); });
    $win.on("click.uieSocialMemBackdrop", "#uie-social-mem-overlay", (e) => {
        if ($(e.target).closest(".uie-paper-box").length) return;
        $("#uie-social-mem-overlay").hide();
    });

    $win.off("click.uieSocialMenu");
    $win.on("click.uieSocialMenu", "#uie-social-sparkle", (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        $("#uie-social-menu").toggle();
    });
    $win.on("click.uieSocialMenu", function(e) {
        const $t = $(e.target);
        if ($t.closest("#uie-social-sparkle, #uie-social-menu").length) return;
        $("#uie-social-menu").hide();
    });

    $win.off("click.uieSocialMemBtn");
    $win.on("click.uieSocialMemBtn", "#uie-social-memories", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-social-mem-overlay").css("display", "flex");
        renderMemoryOverlay();
    });

    // Family Tree button on profile overlay
    $win.on("click.uieSocialTree", "#uie-social-tree", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const { person } = getActivePerson();
        if (!person) return;
        renderFamilyTreeOverlay(person.name);
        $("#uie-family-tree-overlay").css("display", "block");
    });

    $win.on("click.uieFamilyTreeClose", "#uie-family-tree-close", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-family-tree-overlay").hide();
    });

    $win.off("click.uieLineageLinkAdd");
    $win.on("click.uieLineageLinkAdd", "#uie-lineage-link-add-btn", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const a = String($("#uie-lineage-link-a").val() || "").trim();
        const b = String($("#uie-lineage-link-b").val() || "").trim();
        const rel = String($("#uie-lineage-link-rel").val() || "parent").trim();
        if (!a || !b) {
            try { window.toastr?.warning?.("Please select both characters."); } catch (_) { alert("Please select both characters."); }
            return;
        }
        if (a === b) {
            try { window.toastr?.warning?.("A character cannot be linked to themselves."); } catch (_) { alert("A character cannot be linked to themselves."); }
            return;
        }
        const s = getSettings();
        const engine = getGlobalAgeing();
        const roster = collectLineageRoster(s);
        if (!s.lineageTree || typeof s.lineageTree !== "object") s.lineageTree = {};
        if (!engine.lineageTree || typeof engine.lineageTree !== "object") engine.lineageTree = {};
        const ensureNode = (id) => {
            if (!s.lineageTree[id]) {
                const p = roster[id] || {};
                s.lineageTree[id] = {
                    parentId: p.parentId || null,
                    childIds: Array.isArray(p.childIds) ? p.childIds : [],
                    generation: Number(p.generation || 0) || 0,
                    spouseId: p.spouseId || null
                };
            }
            if (!engine.lineageTree[id]) {
                engine.lineageTree[id] = { ...s.lineageTree[id] };
            }
        };
        ensureNode(a);
        ensureNode(b);
        const pAObj = Array.isArray(s.personas) ? s.personas.find(p => p.id === a) : null;
        const pBObj = Array.isArray(s.personas) ? s.personas.find(p => p.id === b) : null;
        if (rel === "parent") {
            s.lineageTree[b].parentId = a;
            engine.lineageTree[b].parentId = a;
            if (!s.lineageTree[a].childIds.includes(b)) s.lineageTree[a].childIds.push(b);
            if (!engine.lineageTree[a].childIds.includes(b)) engine.lineageTree[a].childIds.push(b);
            s.lineageTree[b].generation = Number(s.lineageTree[a].generation || 0) + 1;
            engine.lineageTree[b].generation = s.lineageTree[b].generation;
            if (pBObj) pBObj.parentId = a;
            if (pAObj) {
                if (!Array.isArray(pAObj.childIds)) pAObj.childIds = [];
                if (!pAObj.childIds.includes(b)) pAObj.childIds.push(b);
            }
        } else if (rel === "child") {
            s.lineageTree[a].parentId = b;
            engine.lineageTree[a].parentId = b;
            if (!s.lineageTree[b].childIds.includes(a)) s.lineageTree[b].childIds.push(a);
            if (!engine.lineageTree[b].childIds.includes(a)) engine.lineageTree[b].childIds.push(a);
            s.lineageTree[a].generation = Number(s.lineageTree[b].generation || 0) + 1;
            engine.lineageTree[a].generation = s.lineageTree[a].generation;
            if (pAObj) pAObj.parentId = b;
            if (pBObj) {
                if (!Array.isArray(pBObj.childIds)) pBObj.childIds = [];
                if (!pBObj.childIds.includes(a)) pBObj.childIds.push(a);
            }
        } else if (rel === "spouse") {
            // Validate safety boundaries for spouses
            let marriageAllowed = true;
            try {
                const charA = roster[a] || {};
                const charB = roster[b] || {};
                
                const ageA = Number(charA.age || charA.currentAge);
                const ageB = Number(charB.age || charB.currentAge);
                const stageA = String(charA.ageStage || charA.role || "").toLowerCase();
                const stageB = String(charB.ageStage || charB.role || "").toLowerCase();

                const aIsMinor = (!isNaN(ageA) && ageA < 18) || ["child", "baby_toddler", "teen"].includes(stageA);
                const aIsChild = (!isNaN(ageA) && ageA < 13) || ["child", "baby_toddler"].includes(stageA);
                const aIsTeen = aIsMinor && !aIsChild;

                const bIsMinor = (!isNaN(ageB) && ageB < 18) || ["child", "baby_toddler", "teen"].includes(stageB);
                const bIsChild = (!isNaN(ageB) && ageB < 13) || ["child", "baby_toddler"].includes(stageB);
                const bIsTeen = bIsMinor && !bIsChild;

                if (aIsChild || bIsChild) {
                    alert("Safety Rule: Children cannot marry or be mapped as spouses.");
                    marriageAllowed = false;
                    try { triggerSafetyWarning("Attempted marriage involving a child."); } catch (_) {}
                } else if (aIsTeen && bIsMinor) {
                    if (!isNaN(ageA) && !isNaN(ageB)) {
                        const gap = Math.abs(ageA - ageB);
                        if (gap > 2) {
                            alert("Safety Rule: Teenagers can only marry within a 2-year age gap.");
                            marriageAllowed = false;
                            try { triggerSafetyWarning("Attempted marriage between teens with >2-year age gap."); } catch (_) {}
                        }
                    }
                } else if (aIsTeen && !bIsMinor) {
                    alert("Safety Rule: Teenagers cannot be linked as spouses to adults.");
                    marriageAllowed = false;
                    try { triggerSafetyWarning("Attempted marriage between teen and adult."); } catch (_) {}
                } else if (!aIsMinor && bIsMinor) {
                    alert("Safety Rule: Adults cannot be linked as spouses to minors.");
                    marriageAllowed = false;
                    try { triggerSafetyWarning("Attempted marriage between adult and minor."); } catch (_) {}
                }
            } catch (_) {}

            if (!marriageAllowed) return;

            s.lineageTree[a].spouseId = b;
            engine.lineageTree[a].spouseId = b;
            s.lineageTree[b].spouseId = a;
            engine.lineageTree[b].spouseId = a;
            s.lineageTree[b].generation = s.lineageTree[a].generation;
            engine.lineageTree[b].generation = s.lineageTree[a].generation;
            if (pAObj) pAObj.spouseId = b;
            if (pBObj) pBObj.spouseId = a;
        }
        commitStateUpdate({ save: true, layout: false, emit: true });
        renderFamilyTreeOverlay();
        try { window.toastr?.success?.("Relation linked successfully."); } catch (_) {}
    });

    $win.off("change.uieSocialLiveSync");
    $win.on("change.uieSocialLiveSync", "#uie-social-live-sync", function(e) {
        e.stopPropagation();
        const { person } = getActivePerson();
        if (!person) return;
        const next = $(this).prop("checked") === true;
        if (person.liveSync === next) return;
        person.liveSync = next;
        commitStateUpdate({ save: true, layout: false, emit: true });
        try { window.toastr?.info?.(`Auto-update ${next ? "enabled" : "disabled"} for ${person.name}.`); } catch (_) {}
    });

    $win.off("change.uieSocialLockLocation");
    $win.on("change.uieSocialLockLocation", "#uie-social-lock-location", function(e) {
        e.stopPropagation();
        const { person } = getActivePerson();
        if (!person) return;
        const lock = $(this).prop("checked") === true;
        setEntityLocationLock(person, lock);
        const label = lock ?
             `🔒 Locked to: ${String(person.lockedLocation || "Unknown")}`
            : "🔓 Not locked";
        $("#uie-social-lock-label").text(label);
        try {
            window.toastr?.info?.(`${person.name} ${lock ? "locked to current room" : "location unlocked"}.`);
        } catch (_) {}
        renderSocial();
    });

    $win.off("change.uieSocialMapTrack");
    $win.on("change.uieSocialMapTrack", "#uie-social-map-track", function(e) {
        e.stopPropagation();
        const { person } = getActivePerson();
        if (!person) return;
        const next = $(this).prop("checked") === true;
        if (person.mapTracked === next) return;
        person.mapTracked = next;
        commitStateUpdate({ save: true, layout: false, emit: true });
        try { window.toastr?.info?.(`${person.name} ${next ? "added to" : "removed from"} map tracking.`); } catch (_) {}
        renderSocial();
    });

    $win.off("click.uieSocialLifeFields");
    $win.on("click.uieSocialLifeFields", "#uie-social-edit-schedule, #uie-social-edit-drives, #uie-social-edit-stats", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const { person } = getActivePerson();
        if (!person) return;
        if (this.id === "uie-social-edit-schedule") {
            const next = await customPrompt(`Schedule for ${person.name}:\nUse simple lines like Morning: school, Evening: bar.`, String(person.schedule || ""));
            if (next === null) return;
            person.schedule = String(next || "").trim().slice(0, 3000);
        } else if (this.id === "uie-social-edit-drives") {
            const wants = await customPrompt(`${person.name} wants:`, String(person.wants || ""));
            if (wants === null) return;
            const needs = await customPrompt(`${person.name} needs:`, String(person.needs || ""));
            if (needs === null) return;
            const desires = await customPrompt(`${person.name} desires / flaws / pros:`, String(person.desires || ""));
            if (desires === null) return;
            person.wants = String(wants || "").trim().slice(0, 1200);
            person.needs = String(needs || "").trim().slice(0, 1200);
            person.desires = String(desires || "").trim().slice(0, 1200);
        } else if (this.id === "uie-social-edit-stats") {
            const current = JSON.stringify(person.stats && typeof person.stats === "object" ? person.stats : {}, null, 2);
            const raw = await customPrompt(`Dynamic stats JSON for ${person.name}:`, current);
            if (raw === null) return;
            try {
                const parsed = JSON.parse(String(raw || "{}"));
                person.stats = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
            } catch (_) {
                try { window.toastr?.warning?.("Stats must be valid JSON."); } catch (_) {}
                return;
            }
        }
        commitStateUpdate({ save: true, layout: false, emit: true });
        openProfile(activeProfileIndex);
        renderSocial();
    });

    $win.off("click.uieSocialMemActions");
    $win.on("click.uieSocialMemActions", "#uie-social-mem-add, #uie-social-mem-clear, #uie-social-mem-scan, #uie-social-mem-inject", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const { person } = getActivePerson();
        if (!person) return;

        if (this.id === "uie-social-mem-add") {
            const text = await customPrompt("Add a vital memory (consequence-based):", "");
            if (text === null) return;
            let t = String(text || "").trim();
            if (!t) return;
            if (!lineMentionsName(t, person.name)) t = `${person.name}: ${t}`;
            const impact = (await customPrompt("Impact on the character (optional):", "")) ?? "";
            const tagsRaw = (await customPrompt("Tags (comma-separated, optional):", "")) ?? "";
            if (isTrivialMemory(t) || isMetaMemoryText(t)) {
                try { window.toastr?.info?.("That looks trivial or meta. Keep only vital, in-world memories."); } catch (_) {}
                return;
            }
            person.memories.push({
                id: newId("mem"),
                t: Date.now(),
                text: t.slice(0, 320),
                impact: String(impact || "").trim().slice(0, 240),
                tags: parseTagsInput(tagsRaw, []),
            });
            commitStateUpdate({ save: true, layout: false, emit: true });
            renderMemoryOverlay();
            return;
        }

        if (this.id === "uie-social-mem-clear") {
            const ok = await customConfirm("Clear ALL memories for this character?");
            if (!ok) return;
            person.memories = [];
            commitStateUpdate({ save: true, layout: false, emit: true });
            renderMemoryOverlay();
            return;
        }

        if (this.id === "uie-social-mem-inject") {
            const block = buildMemoryBlock(person);
            if (!block) return;
            await injectRpEvent(block);
            try { window.toastr?.success?.("Injected memories into chat."); } catch (_) {}
            return;
        }

        if (this.id === "uie-social-mem-scan") {
            await scanMemoriesForActivePerson();
        }
    });

    $win.off("click.uieSocialMemEdit");
    $win.on("click.uieSocialMemEdit", ".uie-social-mem-edit", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const mid = String($(this).data("mid") || "");
        const { person } = getActivePerson();
        if (!person || !mid) return;
        const mem = (Array.isArray(person.memories) ? person.memories : []).find(m => String(m?.id || "") === mid);
        if (!mem) return;

        const nextTextRaw = await customPrompt("Edit memory text:", String(mem?.text || ""));
        if (nextTextRaw === null) return;
        const nextImpactRaw = await customPrompt("Edit impact (optional):", String(mem?.impact || ""));
        if (nextImpactRaw === null) return;
        const nextTagsRaw = await customPrompt("Edit tags (comma-separated):", Array.isArray(mem?.tags) ? mem.tags.join(", ") : "");
        if (nextTagsRaw === null) return;

        let nextText = String(nextTextRaw || "").trim();
        if (!nextText) return;
        if (!lineMentionsName(nextText, person.name)) nextText = `${person.name}: ${nextText}`;
        if (isTrivialMemory(nextText) || isMetaMemoryText(nextText)) {
            try { window.toastr?.info?.("Keep only vital, in-world, character-specific memories."); } catch (_) {}
            return;
        }

        mem.text = nextText.slice(0, 320);
        mem.impact = String(nextImpactRaw || "").trim().slice(0, 240);
        mem.tags = parseTagsInput(nextTagsRaw, mem?.tags).slice(0, 6);
        mem.t = Date.now();
        commitStateUpdate({ save: true, layout: false, emit: true });
        renderMemoryOverlay();
    });

    $win.off("click.uieSocialMemDel");
    $win.on("click.uieSocialMemDel", ".uie-social-mem-del", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const mid = String($(this).data("mid") || "");
        const { person } = getActivePerson();
        if (!person || !mid) return;
        person.memories = (Array.isArray(person.memories) ? person.memories : []).filter(m => String(m?.id || "") !== mid);
        commitStateUpdate({ save: true, layout: false, emit: true });
        renderMemoryOverlay();
    });

    $win.off("click.uieSocialActions");
    $win.on("click.uieSocialActions", "#uie-act-add", (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-menu").hide(); openAddModal({ mode: "add" }); });
    $win.on("click.uieSocialActions", "#uie-cancel-add", (e) => { e.preventDefault(); e.stopPropagation(); closeAddModal(); });
    $win.on("click.uieSocialActions", "#uie-submit-add", (e) => { e.preventDefault(); e.stopPropagation(); applyAddOrEdit(); });
    $win.off("change.uieSocialGender").on("change.uieSocialGender", "#uie-add-gender", function() {
        $("#uie-add-gender-custom").prop("hidden", String($(this).val() || "") !== "Custom");
    });

    $win.on("click.uieSocialActions", "#uie-act-delete", (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-menu").hide(); toggleDeleteMode(); });
    $win.on("click.uieSocialActions", "#uie-delete-controls .uie-del-confirm", (e) => { e.preventDefault(); e.stopPropagation(); confirmMassDelete(); });
    $win.on("click.uieSocialActions", "#uie-delete-controls .uie-del-cancel", (e) => { e.preventDefault(); e.stopPropagation(); cancelMassDelete(); });

    $win.on("click.uieSocialActions", "#uie-act-scan", async (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-menu").hide(); await scanChatIntoSocial({ deep: true, maxMessages: 420 }); });
    $win.on("click.uieSocialActions", "#uie-act-toggle-auto", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-social-menu").hide();
        const s = getSettings();
        if (!s.socialMeta) s.socialMeta = { autoScan: false };
        s.socialMeta.autoScan = !s.socialMeta.autoScan;
        commitStateUpdate({ save: true, layout: false, emit: true });
        $("#uie-auto-scan-state").text(s.socialMeta.autoScan ? "ON" : "OFF");
        notify("info", `Auto Scan: ${s.socialMeta.autoScan ? "ON" : "OFF"}`, "Social", "social");
        syncSocialAutoScanLoop({ immediate: s.socialMeta.autoScan === true });
    });

    $win.on("click.uieSocialActions", "#uie-act-bg", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-social-menu").hide();
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = "image/*";
        inp.onchange = async () => {
            try {
                const f = inp.files && inp.files[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = () => {
                    const dataUrl = String(r.result || "");
                    if (!dataUrl) return;
                    const s = getSettings();
                    if (!s.ui) s.ui = { backgrounds: {}, css: { global: "" } };
                    if (!s.ui.backgrounds) s.ui.backgrounds = {};
                    s.ui.backgrounds.social = dataUrl;
                    commitStateUpdate({ save: true, layout: false, emit: true });
                    try { (window.importUieModule ? window.importUieModule("core.js") : import("./core.js")).then(core => core.updateLayout?.()); } catch (_) {}
                };
                r.readAsDataURL(f);
            } catch (_) {}
        };
        inp.click();
    });

    $win.on("click.uieSocialActions", "#uie-act-heart", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-social-menu").hide();
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = "image/*";
        inp.onchange = async () => {
            try {
                const f = inp.files && inp.files[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = () => {
                    const dataUrl = String(r.result || "");
                    if (!dataUrl) return;
                    const s = getSettings();
                    if (!s.ui) s.ui = { backgrounds: {}, css: { global: "" } };
                    if (!s.ui.icons) s.ui.icons = { heart: "" };
                    s.ui.icons.heart = dataUrl;
                    commitStateUpdate({ save: true, layout: false, emit: true });
                };
                r.readAsDataURL(f);
            } catch (_) {}
        };
        inp.click();
    });

    $win.on("click.uieSocialActions", "#uie-social-edit", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeProfileIndex === null) return;
        $("#uie-social-overlay").removeAttr("data-open").hide();
        openAddModal({ mode: "edit", index: activeProfileIndex });
    });

    $win.on("click.uieSocialActions", "#uie-social-message", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        const p = s2?.social?.[currentTab]?.[activeProfileIndex] || null;
        const nm = String(p?.name || "").trim();
        $("#uie-social-overlay").removeAttr("data-open").hide();
        await ensurePaperTemplate(nm);
    });

    $win.on("click.uieSocialActions", "#uie-social-del-one", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (activeProfileIndex === null) return;
        const s = getSettings();
        normalizeSocial(s);
        if (!(await customConfirm("Delete this contact?"))) return;
        try {
            const p = s?.social?.[currentTab]?.[activeProfileIndex] || null;
            const nm = String(p?.name || "").trim();
            if (nm) rememberDeletedNames(s, [nm]);
        } catch (_) {}
        s.social[currentTab].splice(activeProfileIndex, 1);
        commitStateUpdate({ save: true, layout: false, emit: true });
        activeProfileIndex = null;
        $("#uie-social-overlay").removeAttr("data-open").hide();
        renderSocial();
    });

    try {
        const s = getSettings();
        if (s.socialMeta && typeof s.socialMeta.autoScan === "boolean") {
            $("#uie-auto-scan-state").text(s.socialMeta.autoScan ? "ON" : "OFF");
        }
    } catch (_) {}

    syncSocialAutoScanLoop();

    (window.importUieModule ? window.importUieModule("stateTracker.js") : import("./stateTracker.js")).then(mod => {
        if (typeof mod.initAutoScanning === "function") mod.initAutoScanning();
    });

    // --- Move Category handler ---
    $win.off("change.uieProfileMove").on("change.uieProfileMove", "#uie-profile-move-category", function(e) {
        e.stopPropagation();
        const newCat = $(this).val();
        if (!newCat || newCat === currentTab) return;
        const { s, person } = getActivePerson();
        if (!person || activeProfileIndex === null) return;

        // Remove from current category
        s.social[currentTab].splice(activeProfileIndex, 1);
        // Push to new category
        if (!Array.isArray(s.social[newCat])) s.social[newCat] = [];
        person.tab = newCat;
        s.social[newCat].push(person);

        commitStateUpdate({ save: true, layout: false, emit: true });

        // Switch tab to new category and refresh
        currentTab = newCat;
        $win.find(".uie-tab").removeClass("active");
        $win.find(`.uie-tab[data-tab='${newCat}']`).addClass("active");

        // Re-open profile at new index
        const newIdx = s.social[newCat].indexOf(person);
        $("#uie-social-overlay").removeAttr("data-open").hide();
        renderSocial();
        if (newIdx >= 0) openProfile(newIdx);

        try { window.toastr?.success?.(`Moved to ${SOCIAL_CATEGORY_LABELS[newCat] || newCat}!`); } catch (_) {}
    });

    // --- Role populator for add/edit modal ---
    $win.off("change.uieAddTabRole").on("change.uieAddTabRole", "#uie-add-tab", function() {
        const tab = $(this).val() || currentTab;
        populateSocialRoleSelect(tab);
    });
}

// ─── ROLE DROPDOWN POPULATOR ─────────────────────────────────────
function populateSocialRoleSelect(tab) {
    const $sel = $("#uie-add-social-role");
    if (!$sel.length) return;
    const roles = SOCIAL_ROLE_MAP[tab] || SOCIAL_ROLE_MAP.family || [];
    $sel.empty();
    $sel.append(`<option value="">Custom / None</option>`);
    for (const role of roles) {
        $sel.append(`<option value="${esc(role)}">${esc(role)}</option>`);
    }
}

// ─── GLOBAL PROFILE NAVIGATOR ────────────────────────────────────
window.openProfileByName = async function(name) {
    try {
        if (!name) return;
        const s = getSettings();
        normalizeSocial(s);
        const nameLower = String(name).toLowerCase().trim();
        const categories = ["friends", "associates", "romance", "family", "rivals"];

        for (const cat of categories) {
            const list = s.social[cat] || [];
            const idx = list.findIndex(p => String(p?.name || "").toLowerCase().trim() === nameLower);
            if (idx >= 0) {
                currentTab = cat;
                const $win = $("#uie-social-window");
                $win.find(".uie-tab").removeClass("active");
                $win.find(`.uie-tab[data-tab='${cat}']`).addClass("active");

                const ensured = typeof ensureStandaloneWindowTemplate === "function" ?
                     await ensureStandaloneWindowTemplate("#uie-social-window")
                    : $win;
                const ready = $("#uie-social-window");
                const target = ready.length ? ready : ensured;
                if (target?.length && typeof showManagedWindow === "function") {
                    $(".uie-window").hide();
                    showManagedWindow(target, "#uie-social-window", true);
                } else {
                    $("#uie-social-window").show();
                }
                renderSocial();
                openProfile(idx);
                return;
            }
        }
        try { window.toastr?.warning?.(`${name} not found in social contacts.`); } catch (_) {}
    } catch (err) {
        console.error("[Social] openProfileByName failed:", err);
    }
};
