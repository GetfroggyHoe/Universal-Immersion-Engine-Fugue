import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";
import { generateContent, cleanOutput } from "./apiClient.js";
import { updateUiePrompt } from "./prompt_injection.js";

const DB_NAME = "uie_multiversal_archivist";
const DB_STORE = "worlds";
const RUNE_SUBMIT_MS = 1300;
let mounted = false;
let runeSubmitTimer = null;
let activeReadTimer = null;

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function slug(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80) || "entry";
}

function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value && typeof value === "object" ? { ...value } : value; }
}

function ensureEngineState(s = getSettings()) {
    if (!s.magicKnowledge || typeof s.magicKnowledge !== "object") s.magicKnowledge = {};
    const mk = s.magicKnowledge;
    if (!Array.isArray(mk.runeCombo)) mk.runeCombo = [];
    if (!Array.isArray(mk.knownRunes)) mk.knownRunes = ["fire", "projectile", "shield", "inspect"];
    if (!mk.spellHistory || typeof mk.spellHistory !== "object") mk.spellHistory = { casts: [] };
    if (!Array.isArray(mk.spellHistory.casts)) mk.spellHistory.casts = [];
    if (!mk.grimoire || typeof mk.grimoire !== "object") mk.grimoire = { pages: [], boundPages: [], unlockedRunes: [] };
    if (!Array.isArray(mk.grimoire.pages)) mk.grimoire.pages = [];
    if (!Array.isArray(mk.grimoire.boundPages)) mk.grimoire.boundPages = [];
    if (!Array.isArray(mk.grimoire.unlockedRunes)) mk.grimoire.unlockedRunes = [];
    if (!mk.books || typeof mk.books !== "object") mk.books = {};
    if (!Array.isArray(mk.knowledgeFlags)) mk.knowledgeFlags = [];
    if (!mk.socialActions || typeof mk.socialActions !== "object") mk.socialActions = { log: [], stamps: [] };
    if (!Array.isArray(mk.socialActions.log)) mk.socialActions.log = [];
    if (!Array.isArray(mk.socialActions.stamps)) mk.socialActions.stamps = [];
    if (!mk.multiverse || typeof mk.multiverse !== "object") mk.multiverse = { activeWorldId: "default", index: [] };
    if (!Array.isArray(mk.multiverse.index)) mk.multiverse.index = [];
    if (!mk.diegeticWeb || typeof mk.diegeticWeb !== "object") mk.diegeticWeb = { pages: {} };
    if (!mk.diegeticWeb.pages || typeof mk.diegeticWeb.pages !== "object") mk.diegeticWeb.pages = {};
    if (!s.character || typeof s.character !== "object") s.character = {};
    if (!Array.isArray(s.character.knowledgeFlags)) s.character.knowledgeFlags = [];
    return mk;
}

function getInventoryItems(s = getSettings()) {
    if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
    if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
    return s.inventory.items;
}

function setInputAndSend(text) {
    const line = String(text || "").trim();
    if (!line) return false;
    const input = document.getElementById("user-input");
    if (input) {
        input.value = line;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const send = document.getElementById("send-btn");
        if (send) {
            send.click();
            return true;
        }
    }
    const ta = document.getElementById("send_textarea");
    if (ta) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
        if (setter) setter.call(ta, line);
        else ta.value = line;
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        document.getElementById("send_but")?.click?.();
        return true;
    }
    return false;
}

function normalizeRuneName(name) {
    const key = slug(name).replace(/_/g, " ");
    if (/attack|projectile|bolt|line/.test(key)) return "projectile";
    if (/magic|fire|flame|spark/.test(key)) return "fire";
    if (/shield|defend|ward|circle/.test(key)) return "shield";
    if (/heal|mend|life/.test(key)) return "heal";
    if (/inspect|look|reveal|vertical/.test(key)) return "inspect";
    if (/water|ice|tide/.test(key)) return "water";
    if (/air|wind|gale/.test(key)) return "air";
    if (/earth|stone|root/.test(key)) return "earth";
    return key || "unknown";
}

function buildSpellPayload(combo = []) {
    const runes = combo.map((x) => normalizeRuneName(x?.rune || x?.shape || x)).filter(Boolean);
    const has = (r) => runes.includes(r);
    let kind = "cantrip";
    let verb = "pulse";
    let element = runes[0] || "arcane";
    let command = "/cast cantrip";
    let effects = [];
    if (has("fire") && has("projectile")) {
        kind = "projectile";
        verb = "launch";
        element = "fire";
        command = "/cast fire projectile";
        effects = ["ignite", "damage"];
    } else if (has("fire") && (has("inspect") || has("shield"))) {
        kind = "utility";
        verb = "kindle";
        element = "fire";
        command = "/cast kindle flame";
        effects = ["ignite", "reveal"];
    } else if (has("shield")) {
        kind = "ward";
        verb = "raise";
        element = has("water") ? "water" : "arcane";
        command = "/cast shield";
        effects = ["protect"];
    } else if (has("heal")) {
        kind = "restoration";
        verb = "mend";
        element = "life";
        command = "/cast heal";
        effects = ["heal"];
    } else if (has("inspect")) {
        kind = "divination";
        verb = "reveal";
        element = "sight";
        command = "/look with rune sight";
        effects = ["reveal"];
    }
    return { id: `spell_${Date.now().toString(16)}`, runes, sentence: runes.join(" + "), kind, verb, element, effects, command, at: Date.now() };
}

function applySpellToDom(payload, target) {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    const txt = `${el.id || ""} ${el.className || ""} ${el.getAttribute("title") || ""} ${el.getAttribute("aria-label") || ""} ${el.textContent || ""}`.toLowerCase();
    let changed = false;
    if (payload.effects.includes("ignite") && /(torch|candle|lamp|brazier|fireplace|unlit|lantern)/.test(txt)) {
        el.dataset.uieLit = "true";
        el.dataset.uieState = "lit";
        el.classList.add("uie-lit", "uie-magic-altered");
        changed = true;
    }
    if (payload.effects.includes("reveal")) {
        el.dataset.uieRevealed = "true";
        el.classList.add("uie-revealed", "uie-magic-altered");
        changed = true;
    }
    if (payload.effects.includes("protect")) {
        el.dataset.uieWard = payload.element;
        el.classList.add("uie-warded", "uie-magic-altered");
        changed = true;
    }
    return changed;
}

export function recordRuneGesture(shape, detail = {}) {
    const s = getSettings();
    const mk = ensureEngineState(s);
    const rune = normalizeRuneName(shape);
    const known = new Set([...(mk.knownRunes || []), ...(mk.grimoire.unlockedRunes || [])].map(normalizeRuneName));
    if (!known.has(rune)) {
        notify("warning", `Unknown rune: ${rune}`, "Grimoire");
        return null;
    }
    mk.runeCombo.push({ rune, raw: String(shape || ""), at: Date.now(), detail: clone(detail) || {} });
    mk.runeCombo = mk.runeCombo.slice(-8);
    saveSettings();
    notify("info", mk.runeCombo.map((x) => x.rune).join(" + "), "Rune Sentence");
    if (runeSubmitTimer) clearTimeout(runeSubmitTimer);
    runeSubmitTimer = setTimeout(() => submitRuneCombo(), RUNE_SUBMIT_MS);
    return mk.runeCombo.slice();
}

export function submitRuneCombo(target = null) {
    const s = getSettings();
    const mk = ensureEngineState(s);
    const combo = mk.runeCombo.slice();
    if (!combo.length) return null;
    const payload = buildSpellPayload(combo);
    const resolvedTarget = target || document.querySelector("[data-uie-spell-target='true']") || document.activeElement;
    const altered = applySpellToDom(payload, resolvedTarget);
    payload.domAltered = altered;
    payload.target = resolvedTarget instanceof Element ? String(resolvedTarget.id || resolvedTarget.getAttribute("title") || resolvedTarget.getAttribute("aria-label") || resolvedTarget.textContent || "").trim().slice(0, 80) : "";
    mk.spellHistory.casts.push(payload);
    mk.spellHistory.casts = mk.spellHistory.casts.slice(-80);
    mk.runeCombo = [];
    saveSettings();
    try { updateUiePrompt(); } catch (_) {}
    if (altered) notify("success", `${payload.sentence} altered ${payload.target || "the object"}.`, "Magic");
    else notify("success", payload.sentence, "Spell Cast");
    setInputAndSend(`[Spell Sentence: ${payload.sentence}] ${payload.command}${payload.target ? ` targeting ${payload.target}` : ""}.`);
    return payload;
}

export function addLooseGrimoirePage(page = {}) {
    const s = getSettings();
    const mk = ensureEngineState(s);
    const rune = normalizeRuneName(page.rune || page.name || page.title || "unknown");
    const id = String(page.id || `page_${slug(rune)}_${Date.now().toString(16)}`);
    if (!mk.grimoire.pages.some((p) => String(p.id) === id)) {
        mk.grimoire.pages.push({ id, rune, title: String(page.title || `${rune} page`), text: String(page.text || page.desc || "Loose grimoire page."), foundAt: Date.now() });
    }
    saveSettings();
    notify("info", `Loose page found: ${rune}`, "Grimoire");
    return id;
}

export function bindPageToGrimoire(pageIdOrRune) {
    const s = getSettings();
    const mk = ensureEngineState(s);
    const key = String(pageIdOrRune || "").trim();
    const page = mk.grimoire.pages.find((p) => String(p.id) === key || normalizeRuneName(p.rune) === normalizeRuneName(key));
    if (!page) return false;
    if (!mk.grimoire.boundPages.some((p) => String(p.id) === String(page.id))) mk.grimoire.boundPages.push({ ...page, boundAt: Date.now() });
    const rune = normalizeRuneName(page.rune);
    if (!mk.grimoire.unlockedRunes.map(normalizeRuneName).includes(rune)) mk.grimoire.unlockedRunes.push(rune);
    if (!mk.knownRunes.map(normalizeRuneName).includes(rune)) mk.knownRunes.push(rune);
    saveSettings();
    notify("success", `${rune} bound into the Grimoire.`, "Grimoire");
    try { updateUiePrompt(); } catch (_) {}
    return true;
}

async function generateBookText(title, theme = "parchment") {
    const prompt = [
        "Write an in-universe lore book between 500 and 800 words.",
        "Use immersive prose and concrete lore facts that can become player knowledge.",
        `Title: ${title}`,
        `Reading theme: ${theme}`,
    ].join("\n");
    try {
        const raw = await generateContent(prompt, "Lore Book");
        const cleaned = cleanOutput ? cleanOutput(raw) : raw;
        return String(cleaned || "").trim();
    } catch (_) {
        const seed = String(title || "Untitled Lore").trim() || "Untitled Lore";
        const para = `The volume titled ${seed} records places, names, customs, and warnings that locals treat as common sense. Its passages describe how power moves through the world, which signs reveal danger, and why old bargains still matter. The reader learns enough to recognize the symbols, repeat the safer rites, and avoid mistaking legend for metaphor.`;
        return Array.from({ length: 12 }, () => para).join("\n\n");
    }
}

export async function acquireBook(book = {}) {
    const s = getSettings();
    const mk = ensureEngineState(s);
    const title = String(book.title || book.name || "Untitled Lore").trim();
    const id = String(book.id || `book_${slug(title)}_${Date.now().toString(16)}`);
    if (!mk.books[id]) {
        mk.books[id] = { id, title, theme: String(book.theme || inferReadingTheme(s)), status: "generating", acquiredAt: Date.now(), text: "" };
        saveSettings();
        void generateBookText(title, mk.books[id].theme).then((text) => {
            const s2 = getSettings();
            const mk2 = ensureEngineState(s2);
            if (!mk2.books[id]) return;
            mk2.books[id].text = text;
            mk2.books[id].status = "ready";
            saveSettings();
            try { updateUiePrompt(); } catch (_) {}
        });
    }
    notify("info", `Book acquired: ${title}`, "Library");
    return id;
}

function inferReadingTheme(s = getSettings()) {
    const world = `${s?.worldState?.genre || ""} ${s?.worldState?.location || ""} ${s?.worldSpark?.seed || ""}`.toLowerCase();
    if (/cyber|neon|sci|space|terminal/.test(world)) return "neon";
    if (/noir|sepia|1920|old|detective/.test(world)) return "sepia";
    return "parchment";
}

function ensureReaderModal() {
    let modal = document.getElementById("uie-reading-modal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "uie-reading-modal";
    modal.innerHTML = `<div class="uie-reading-card"><div class="uie-reading-head"><h2 id="uie-reading-title"></h2><button type="button" id="uie-reading-close">Close</button></div><div id="uie-reading-body"></div><div id="uie-reading-status"></div></div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeReadingModal(); });
    modal.querySelector("#uie-reading-close")?.addEventListener("click", closeReadingModal);
    return modal;
}

function closeReadingModal() {
    const modal = document.getElementById("uie-reading-modal");
    if (modal) modal.style.display = "none";
    if (activeReadTimer) clearTimeout(activeReadTimer);
    activeReadTimer = null;
}

function addKnowledgeFlag(book) {
    const s = getSettings();
    const mk = ensureEngineState(s);
    const flag = `read_${slug(book?.title || book?.id || "book")}`;
    if (!mk.knowledgeFlags.includes(flag)) mk.knowledgeFlags.push(flag);
    if (!s.character.knowledgeFlags.includes(flag)) s.character.knowledgeFlags.push(flag);
    if (!Array.isArray(s.databank)) s.databank = [];
    if (!s.databank.some((x) => String(x?.id || x?.title || "") === flag || String(x?.title || "") === `Knowledge: ${book.title}`)) {
        s.databank.push({ id: flag, title: `Knowledge: ${book.title}`, summary: `Player read ${book.title} long enough to understand its lore and related spells.`, source: "reading", at: Date.now() });
    }
    saveSettings();
    notify("success", `Knowledge flag gained: ${book.title}`, "Reading");
    try { updateUiePrompt(); } catch (_) {}
}

export function openBookReader(bookId) {
    const s = getSettings();
    const mk = ensureEngineState(s);
    const book = mk.books[String(bookId || "")] || Object.values(mk.books)[0];
    if (!book) return false;
    const modal = ensureReaderModal();
    modal.dataset.theme = String(book.theme || inferReadingTheme(s));
    modal.querySelector("#uie-reading-title").textContent = book.title || "Book";
    modal.querySelector("#uie-reading-body").textContent = book.status === "ready" ? String(book.text || "") : "The pages are still resolving into readable text...";
    modal.querySelector("#uie-reading-status").textContent = "Read for 10 seconds to internalize this knowledge.";
    modal.style.display = "flex";
    if (activeReadTimer) clearTimeout(activeReadTimer);
    activeReadTimer = setTimeout(() => addKnowledgeFlag(book), 10000);
    return true;
}

function ensureRadialMenu() {
    let menu = document.getElementById("uie-npc-radial");
    if (menu) return menu;
    menu = document.createElement("div");
    menu.id = "uie-npc-radial";
    document.body.appendChild(menu);
    return menu;
}

function resolveNpcName(el) {
    return String(el?.dataset?.npcName || el?.dataset?.characterName || el?.dataset?.name || el?.getAttribute?.("alt") || el?.getAttribute?.("title") || document.getElementById("target-select")?.value || "Stranger").trim() || "Stranger";
}

function ensureSocialProfile(name) {
    const s = getSettings();
    ensureEngineState(s);
    if (!s.social || typeof s.social !== "object") s.social = {};
    if (!Array.isArray(s.social.friends)) s.social.friends = [];
    const key = slug(name);
    let existing = s.social.friends.find((p) => slug(p?.name) === key);
    if (!existing) {
        existing = { id: `soc_${key}_${Date.now().toString(16)}`, name, relation: "Met", affinity: 50, notes: "Promoted from a temporary scene target.", met: true, source: "social_promotion" };
        s.social.friends.push(existing);
        notify("info", `${name} added to Social Hub.`, "Social Promotion");
    }
    saveSettings();
    return existing;
}

function spendAp(cost = 1) {
    const s = getSettings();
    if (!s.character || typeof s.character !== "object") s.character = {};
    const cur = Number(s.character.ap ?? s.ap ?? s.actionPoints ?? 10);
    if (Number.isFinite(cur)) {
        const next = Math.max(0, cur - Math.max(0, Number(cost || 0)));
        s.character.ap = next;
        s.ap = next;
    }
    saveSettings();
}

export function runSocialAction(name, verb, opts = {}) {
    const target = String(name || "Stranger").trim() || "Stranger";
    const action = String(verb || "Chat").trim() || "Chat";
    const s = getSettings();
    const mk = ensureEngineState(s);
    ensureSocialProfile(target);
    spendAp(Number(opts.apCost ?? 1));
    mk.socialActions.log.push({ target, action, at: Date.now() });
    mk.socialActions.log = mk.socialActions.log.slice(-80);
    saveSettings();
    try { updateUiePrompt(); } catch (_) {}
    setInputAndSend(`[Social Action: ${action} -> ${target}] Resolve this mechanical action silently through Big Sister narration. Deducted AP; update consequences, affinity, and scene reaction.`);
    return true;
}

function openNpcRadial(name, x, y) {
    const menu = ensureRadialMenu();
    const actions = ["Chat", "Flirt", "Slap", "Pickpocket"];
    menu.innerHTML = `<div class="uie-npc-radial-title">${esc(name)}</div>${actions.map((a) => `<button type="button" data-social-action="${esc(a)}">${esc(a)}</button>`).join("")}`;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - 180, Number(x || 0)))}px`;
    menu.style.top = `${Math.max(8, Math.min(window.innerHeight - 180, Number(y || 0)))}px`;
    menu.style.display = "grid";
    menu.querySelectorAll("[data-social-action]").forEach((btn) => btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        menu.style.display = "none";
        runSocialAction(name, btn.getAttribute("data-social-action"));
    }));
}

export function spawnNpcStamp(def = {}) {
    const s = getSettings();
    const mk = ensureEngineState(s);
    const layer = document.getElementById("vn-sprite-layer") || document.getElementById("game-root") || document.body;
    const name = String(def.name || def.role || "Local NPC").trim();
    const id = String(def.id || `stamp_${slug(name)}_${Date.now().toString(16)}`);
    if (!mk.socialActions.stamps.some((x) => x.id === id)) mk.socialActions.stamps.push({ id, name, role: String(def.role || "stamp"), actions: def.actions || [], at: Date.now() });
    let node = document.getElementById(id);
    if (!node) {
        node = document.createElement("button");
        node.id = id;
        node.type = "button";
        node.className = "uie-npc-stamp";
        node.dataset.npcName = name;
        node.textContent = name;
        layer.appendChild(node);
    }
    node.style.left = def.left || "72%";
    node.style.top = def.top || "48%";
    node.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const actions = Array.isArray(def.actions) && def.actions.length ? def.actions : ["Buy Drink", "Rent Room", "Ask Rumor"];
        const menu = ensureRadialMenu();
        menu.innerHTML = `<div class="uie-npc-radial-title">${esc(name)}</div>${actions.map((a) => `<button type="button" data-stamp-action="${esc(a)}">${esc(a)}</button>`).join("")}`;
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        menu.style.display = "grid";
        menu.querySelectorAll("[data-stamp-action]").forEach((btn) => btn.addEventListener("click", () => {
            menu.style.display = "none";
            setInputAndSend(`[Stagnant NPC Action: ${btn.getAttribute("data-stamp-action")} -> ${name}] Resolve as a functional furniture interaction.`);
        }));
    };
    saveSettings();
    return id;
}

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbPut(record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.objectStore(DB_STORE).put(record);
    }).finally(() => { try { db.close(); } catch (_) {} });
}

async function idbGet(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, "readonly");
        const req = tx.objectStore(DB_STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    }).finally(() => { try { db.close(); } catch (_) {} });
}

function summarizeState(s = getSettings()) {
    return {
        worldState: clone(s.worldState || {}),
        databank: clone(s.databank || {}),
        social: clone(s.social || {}),
        jobs: clone(s.jobs || s.questLog || {}),
        familyTrees: clone(s.familyTrees || s.families || {}),
        map: clone(s.map || {}),
        magicKnowledge: clone(s.magicKnowledge || {}),
        at: Date.now(),
    };
}

export async function archiveCurrentWorld(worldId = "") {
    const s = getSettings();
    const mk = ensureEngineState(s);
    const id = String(worldId || mk.multiverse.activeWorldId || s?.worldState?.worldId || s?.worldState?.genre || "default").trim() || "default";
    const record = { id, label: id, summary: summarizeState(s), at: Date.now() };
    await idbPut(record);
    const idx = mk.multiverse.index.filter((x) => x.id !== id);
    idx.unshift({ id, label: record.label, at: record.at });
    mk.multiverse.index = idx.slice(0, 80);
    saveSettings();
    notify("success", `Archived world: ${id}`, "Multiversal Archivist");
    return record;
}

export async function restoreArchivedWorld(worldId) {
    const record = await idbGet(String(worldId || "default"));
    if (!record?.summary) return false;
    const s = getSettings();
    Object.assign(s, clone(record.summary));
    ensureEngineState(s).multiverse.activeWorldId = String(worldId || record.id || "default");
    saveSettings();
    notify("success", `Restored world: ${record.id}`, "Multiversal Archivist");
    try { updateUiePrompt(); } catch (_) {}
    return true;
}

export function purgeChatLogKeepState() {
    document.querySelectorAll("#chat .mes").forEach((el) => el.remove());
    const s = getSettings();
    ensureEngineState(s).cleanSlateAnchor = { at: Date.now(), worldState: clone(s.worldState || {}), databankKeys: Object.keys(s.databank || {}).slice(0, 80), socialKeys: Object.keys(s.social || {}).slice(0, 20) };
    saveSettings();
    const anchor = "[Clean Slate Anchor] Chat log purged. Preserve World State, Databank facts, Social affinities, inventory, active target, and current scene continuity exactly.";
    setInputAndSend(anchor);
    notify("success", "Chat log purged; state anchor injected.", "Clean Slate");
    return true;
}

function hasItemLike(items, pattern) {
    return items.find((it) => pattern.test(`${it?.name || ""} ${it?.description || it?.desc || ""}`));
}

export function openDynamicStation(station = {}) {
    const s = getSettings();
    const items = getInventoryItems(s);
    const name = String(station.name || station.id || "Station").trim();
    const apple = hasItemLike(items, /apple/i);
    const protein = hasItemLike(items, /protein\s*powder|protein/i);
    const actions = [];
    if (/blender/i.test(name)) {
        if (apple) actions.push({ label: "Blend Apple", line: "Blend Apple in the blender." });
        if (protein) actions.push({ label: "Mix Protein Powder", line: "Mix Protein Powder in the blender." });
        if (apple && protein) actions.push({ label: "Make Protein Apple Smoothie", line: "Blend Apple with Protein Powder into a smoothie." });
    }
    if (!actions.length) actions.push({ label: "Inspect", line: `Inspect ${name}.` });
    const modal = document.getElementById("uie-interactable-modal") || document.body.appendChild(document.createElement("div"));
    modal.id = "uie-interactable-modal";
    modal.style.cssText = "display:flex;position:fixed;inset:0;z-index:2147483642;align-items:center;justify-content:center;background:rgba(2,6,23,.68);padding:16px;box-sizing:border-box;";
    modal.innerHTML = `<div style="width:min(640px,96vw);border:1px solid rgba(111,211,255,.32);background:rgba(8,13,25,.96);color:#f8fafc;border-radius:14px;padding:16px;"><div style="display:flex;gap:10px;align-items:center;"><h3 style="margin:0;flex:1;color:#7dd3fc;">${esc(name)}</h3><button type="button" data-close-dynamic>Close</button></div><div style="display:grid;gap:8px;margin-top:14px;">${actions.map((a, i) => `<button type="button" data-dynamic-station="${i}">${esc(a.label)}</button>`).join("")}</div></div>`;
    modal.querySelector("[data-close-dynamic]")?.addEventListener("click", () => { modal.style.display = "none"; });
    modal.querySelectorAll("[data-dynamic-station]").forEach((btn) => btn.addEventListener("click", () => {
        modal.style.display = "none";
        setInputAndSend(`[Dynamic Kitchen: ${name}] ${actions[Number(btn.getAttribute("data-dynamic-station"))]?.line || "Use station."}`);
    }));
    return true;
}

function renderDiegeticPage(url) {
    const s = getSettings();
    const mk = ensureEngineState(s);
    const key = String(url || "").trim();
    if (!mk.diegeticWeb.pages[key]) {
        const host = (() => { try { return new URL(key, location.href).host || key; } catch (_) { return key; } })();
        mk.diegeticWeb.pages[key] = { url: key, title: host, html: `<h1>${esc(host)}</h1><p>This fictional domain resolves through the local world state.</p><p>Location: ${esc(s?.worldState?.location || "Unknown")}</p>`, at: Date.now() };
        saveSettings();
    }
    const page = mk.diegeticWeb.pages[key];
    const host = document.getElementById("main-screen-html-host") || document.body;
    let panel = document.getElementById("uie-diegetic-web-panel");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "uie-diegetic-web-panel";
        document.body.appendChild(panel);
    }
    panel.innerHTML = `<div class="uie-web-card"><button type="button" id="uie-web-close">Close</button>${page.html}</div>`;
    panel.style.display = "flex";
    panel.querySelector("#uie-web-close")?.addEventListener("click", () => { panel.style.display = "none"; });
    host.dataset.uieLastDomain = key;
}

export function generateWorldSpark(seed = "", lorebook = "") {
    const s = getSettings();
    const mk = ensureEngineState(s);
    const prompt = String(seed || "New world").trim() || "New world";
    const worldId = `world_${slug(prompt)}_${Date.now().toString(16)}`;
    const itemRoot = slug(prompt).replace(/_/g, " ");
    const items = Array.from({ length: 1000 }, (_, i) => ({ id: `spark_item_${i + 1}`, name: `${itemRoot} item ${i + 1}`, type: i % 7 === 0 ? "Key Item" : "Item", rarity: i % 50 === 0 ? "rare" : "common", qty: 1 }));
    const npcs = Array.from({ length: 100 }, (_, i) => ({ id: `spark_npc_${i + 1}`, name: `Local ${i + 1}`, role: i % 10 === 0 ? "anchor" : "background", affinity: 50 }));
    const rooms = Array.from({ length: 24 }, (_, i) => ({ id: `room_${i + 1}`, name: `${prompt} ${i === 0 ? "Starting Room" : `District ${i + 1}`}`, exits: {} }));
    s.worldSpark = { id: worldId, seed: prompt, lorebook: String(lorebook || ""), startingRoom: rooms[0], items, npcs, map: { rooms }, generatedAt: Date.now() };
    s.worldState = { ...(s.worldState || {}), worldId, location: rooms[0].name, genre: prompt };
    mk.multiverse.activeWorldId = worldId;
    saveSettings();
    notify("success", "World Spark generated.", "Universal Seed");
    try { updateUiePrompt(); } catch (_) {}
    return s.worldSpark;
}

function injectStyle() {
    if (document.getElementById("uie-magic-knowledge-style")) return;
    const style = document.createElement("style");
    style.id = "uie-magic-knowledge-style";
    style.textContent = `#uie-reading-modal{display:none;position:fixed;inset:0;z-index:2147483643;align-items:center;justify-content:center;background:rgba(0,0,0,.72);padding:18px;box-sizing:border-box}#uie-reading-modal .uie-reading-card{width:min(820px,96vw);max-height:88vh;overflow:auto;border-radius:16px;padding:22px;box-shadow:0 24px 80px rgba(0,0,0,.65)}#uie-reading-modal[data-theme=parchment] .uie-reading-card{background:#ead6aa;color:#2b1a08;border:1px solid #8a6330}#uie-reading-modal[data-theme=neon] .uie-reading-card{background:#06111f;color:#d7fbff;border:1px solid #22d3ee;box-shadow:0 0 42px rgba(34,211,238,.28)}#uie-reading-modal[data-theme=sepia] .uie-reading-card{background:#2b2118;color:#f1dcc0;border:1px solid #9a7048}.uie-reading-head{display:flex;gap:10px;align-items:center}.uie-reading-head h2{flex:1;margin:0}#uie-reading-body{white-space:pre-wrap;line-height:1.55;margin-top:14px}#uie-npc-radial{display:none;position:fixed;z-index:2147483644;gap:7px;padding:10px;border-radius:14px;background:rgba(10,16,24,.96);border:1px solid rgba(111,211,255,.35);box-shadow:0 18px 48px rgba(0,0,0,.62)}#uie-npc-radial button,#uie-diegetic-web-panel button,#uie-interactable-modal button{cursor:pointer;border:1px solid rgba(111,211,255,.28);border-radius:9px;background:rgba(111,211,255,.12);color:inherit;padding:8px 10px}.uie-npc-radial-title{font-weight:900;color:#7dd3fc;text-align:center}.uie-npc-stamp{position:absolute;z-index:2465;pointer-events:auto;border-radius:999px;padding:8px 12px;background:rgba(15,23,42,.88);color:#f8fafc;border:1px solid rgba(250,204,21,.45)}#vn-sprite-layer .manual-stage-sprite,#vn-sprite-layer .re-sprite,#vn-sprite-layer .vn-scene-sprite{pointer-events:auto!important}.uie-lit{filter:drop-shadow(0 0 12px #f59e0b)!important}.uie-revealed{outline:2px solid rgba(125,211,252,.85)!important}.uie-warded{box-shadow:0 0 0 3px rgba(96,165,250,.45)!important}#uie-diegetic-web-panel{display:none;position:fixed;inset:0;z-index:2147483641;align-items:center;justify-content:center;background:rgba(0,0,0,.68);padding:16px}.uie-web-card{width:min(900px,96vw);max-height:86vh;overflow:auto;border-radius:14px;background:#07111f;color:#e5f7ff;border:1px solid rgba(56,189,248,.4);padding:18px}`;
    document.head.appendChild(style);
}

function injectCleanSlateButton() {
    const section = document.querySelector("#reply-menu-panel .reply-menu-section:last-child");
    if (!section || document.getElementById("btn-purge-chat-log")) return;
    const btn = document.createElement("div");
    btn.className = "reply-menu-item";
    btn.id = "btn-purge-chat-log";
    btn.innerHTML = `<i class="fas fa-broom"></i> Purge Chat Log`;
    section.appendChild(btn);
}

function bindEvents() {
    document.addEventListener("click", (e) => {
        const npc = e.target?.closest?.("[data-npc-name], [data-character-name], #vn-sprite-layer .manual-stage-sprite, #vn-sprite-layer .re-sprite, #vn-sprite-layer .vn-scene-sprite");
        if (npc) {
            e.preventDefault();
            e.stopPropagation();
            openNpcRadial(resolveNpcName(npc), e.clientX, e.clientY);
            return;
        }
        if (!e.target?.closest?.("#uie-npc-radial")) {
            const menu = document.getElementById("uie-npc-radial");
            if (menu) menu.style.display = "none";
        }
    }, true);
    document.addEventListener("click", (e) => {
        const pageBtn = e.target?.closest?.("[data-bind-grimoire-page]");
        if (pageBtn) {
            e.preventDefault();
            bindPageToGrimoire(pageBtn.getAttribute("data-bind-grimoire-page"));
            return;
        }
        const readBtn = e.target?.closest?.("[data-uie-read-book]");
        if (readBtn) {
            e.preventDefault();
            openBookReader(readBtn.getAttribute("data-uie-read-book"));
            return;
        }
        const purge = e.target?.closest?.("#btn-purge-chat-log");
        if (purge) {
            e.preventDefault();
            purgeChatLogKeepState();
            return;
        }
        const a = e.target?.closest?.("a[href]");
        if (a && (a.matches("[data-uie-diegetic-link]") || a.closest("#main-screen-html-host, .uie-diegetic-web, #uie-phone-window, #uie-interactable-modal, #uie-diegetic-web-panel"))) {
            const href = a.getAttribute("href") || "";
            if (href && !/^(#|javascript:|mailto:|tel:|blob:|data:)/i.test(href)) {
                e.preventDefault();
                renderDiegeticPage(href);
            }
        }
    }, true);
}

export function getMagicKnowledgePromptBlock() {
    const s = getSettings();
    const mk = ensureEngineState(s);
    const flags = Array.from(new Set([...(mk.knowledgeFlags || []), ...(s?.character?.knowledgeFlags || [])])).slice(-30);
    const runes = Array.from(new Set([...(mk.knownRunes || []), ...(mk.grimoire?.unlockedRunes || [])])).slice(0, 40);
    const casts = (mk.spellHistory?.casts || []).slice(-8).map((c) => `${c.sentence}${c.target ? ` -> ${c.target}` : ""}${c.domAltered ? " [DOM altered]" : ""}`);
    const social = (mk.socialActions?.log || []).slice(-8).map((x) => `${x.action}->${x.target}`);
    const world = mk.multiverse?.activeWorldId || "default";
    return `[MAGIC & KNOWLEDGE ENGINE]\nKnown runes: ${runes.join(", ") || "None"}\nKnowledge flags: ${flags.join(", ") || "None"}\nRecent spells: ${casts.join(" | ") || "None"}\nRecent social mechanics: ${social.join(" | ") || "None"}\nActive archived world: ${world}`;
}

export function initMagicKnowledgeEngine() {
    if (mounted) return;
    mounted = true;
    ensureEngineState();
    injectStyle();
    injectCleanSlateButton();
    bindEvents();
    window.UIE_recordRuneGesture = recordRuneGesture;
    window.UIE_submitRuneCombo = submitRuneCombo;
    window.UIE_addLooseGrimoirePage = addLooseGrimoirePage;
    window.UIE_bindPageToGrimoire = bindPageToGrimoire;
    window.UIE_acquireBook = acquireBook;
    window.UIE_openBookReader = openBookReader;
    window.UIE_runSocialAction = runSocialAction;
    window.UIE_spawnNpcStamp = spawnNpcStamp;
    window.UIE_archiveCurrentWorld = archiveCurrentWorld;
    window.UIE_restoreArchivedWorld = restoreArchivedWorld;
    window.UIE_purgeChatLogKeepState = purgeChatLogKeepState;
    window.UIE_openDynamicStation = openDynamicStation;
    window.UIE_generateWorldSpark = generateWorldSpark;
    window.UIE_magicKnowledgePromptBlock = getMagicKnowledgePromptBlock;
    setTimeout(injectCleanSlateButton, 1000);
}
