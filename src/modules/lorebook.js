import { getSettings, saveSettings } from "./core.js";
import { generateContent } from "./apiClient.js";
import { repairJson } from "./jsonUtil.js";

const WIN_ID = "uie-lorebook-window";
const BOOK_SELECT_ID = "uie-lorebook-book-select";
const ENTRY_LIST_ID = "uie-lorebook-entry-list";
const ENTRY_MEMO_ID = "uie-lorebook-entry-memo";
const ENTRY_KEY_ID = "uie-lorebook-entry-key";
const ENTRY_KEY2_ID = "uie-lorebook-entry-key2";
const ENTRY_CONTENT_ID = "uie-lorebook-entry-content";
const ENTRY_ORDER_ID = "uie-lorebook-entry-order";
const ENTRY_POSITION_ID = "uie-lorebook-entry-position";
const ENTRY_PROB_ID = "uie-lorebook-entry-probability";
const ENTRY_DEPTH_ID = "uie-lorebook-entry-depth";
const ENTRY_ROLE_ID = "uie-lorebook-entry-role";
const CTX_STRATEGY_ID = "uie-lb-ctx-strategy";
const CTX_SCOPE_ID = "uie-lb-ctx-scope";
const CTX_TARGET_ID = "uie-lb-ctx-target";
const CTX_BOOK_ID = "uie-lb-ctx-book";
const CTX_LIST_ID = "uie-lb-ctx-list";
const CTX_DEBUG_ID = "uie-lb-ctx-debug";

let activeBookIndex = 0;
let activeEntryUid = -1;

function readJsonSafe(text, fallback) {
    try {
        return JSON.parse(String(text || "").trim());
    } catch (_) {
        try {
            const repaired = repairJson(String(text || ""));
            return JSON.parse(repaired);
        } catch (__) {
            return fallback;
        }
    }
}

function extractJsonObject(text = "") {
    const raw = String(text || "").trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) {}
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
        try { return JSON.parse(m[0]); } catch (_) {}
    }
    return null;
}

function coalesceKeys(v) {
    if (v == null) return [];
    if (Array.isArray(v)) return v.map((x) => String(x || "").trim()).filter(Boolean);
    return String(v).split(",").map((x) => x.trim()).filter(Boolean);
}

function createDefaultEntry(uid = 0) {
    return {
        uid: Number(uid),
        key: [],
        keysecondary: [],
        comment: "New Entry",
        content: "",
        category: "",
        constant: false,
        vectorized: false,
        selective: true,
        selectiveLogic: 0,
        addMemo: true,
        order: 100,
        position: 4,
        disable: false,
        excludeRecursion: false,
        preventRecursion: false,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        delayUntilRecursion: false,
        probability: 100,
        useProbability: true,
        depth: 4,
        group: "",
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: "",
        role: 0,
        sticky: 0,
        cooldown: 0,
        delay: 0,
        displayIndex: Number(uid)
    };
}

function normalizeEntry(raw, fallbackUid = 0) {
    const base = createDefaultEntry(fallbackUid);
    const src = raw && typeof raw === "object" ? raw : {};
    const uid = Number.isFinite(Number(src.uid)) ? Number(src.uid) : Number(fallbackUid);
    return {
        ...base,
        ...src,
        uid,
        key: Array.isArray(src.key) ?
             src.key.map((x) => String(x || "").trim()).filter(Boolean)
            : String(src.key || "").split(",").map((x) => x.trim()).filter(Boolean),
        keysecondary: Array.isArray(src.keysecondary) ?
             src.keysecondary.map((x) => String(x || "").trim()).filter(Boolean)
            : String(src.keysecondary || "").split(",").map((x) => x.trim()).filter(Boolean),
        comment: String(src.comment || base.comment).trim(),
        content: String(src.content || "").trim(),
        category: String(src.category || base.category || "").trim(),
        order: Number.isFinite(Number(src.order)) ? Number(src.order) : 100,
        position: Number.isFinite(Number(src.position)) ? Number(src.position) : 4,
        probability: Number.isFinite(Number(src.probability)) ? Number(src.probability) : 100,
        depth: Number.isFinite(Number(src.depth)) ? Number(src.depth) : 4,
        role: Number.isFinite(Number(src.role)) ? Number(src.role) : 0
    };
}

function normalizeEntriesObject(rawEntries) {
    const out = {};
    if (rawEntries && typeof rawEntries === "object" && !Array.isArray(rawEntries)) {
        const pairs = Object.entries(rawEntries);
        pairs.forEach(([k, v], idx) => {
            const uid = Number.isFinite(Number(v?.uid)) ? Number(v.uid) : (Number.isFinite(Number(k)) ? Number(k) : idx);
            out[String(uid)] = normalizeEntry(v, uid);
        });
        return out;
    }
    if (Array.isArray(rawEntries)) {
        rawEntries.forEach((v, idx) => {
            const uid = Number.isFinite(Number(v?.uid)) ? Number(v.uid) : idx;
            out[String(uid)] = normalizeEntry(v, uid);
        });
    }
    return out;
}

function normalizeLorebook(raw, idx = 0) {
    const obj = raw && typeof raw === "object" ? raw : {};
    const name = String(obj.name || obj.title || `Lorebook ${idx + 1}`).trim() || `Lorebook ${idx + 1}`;
    const entriesObj = normalizeEntriesObject(obj.entries);
    return {
        name,
        enabled: obj.enabled !== false,
        scanDepth: Number.isFinite(Number(obj.scanDepth)) ? Number(obj.scanDepth) : 2,
        tokenBudget: Number.isFinite(Number(obj.tokenBudget)) ? Number(obj.tokenBudget) : 1000,
        entries: entriesObj
    };
}

function ensureState(settings) {
    const s = settings || getSettings();
    if (!Array.isArray(s.lorebooks)) s.lorebooks = [];
    s.lorebooks = s.lorebooks.map((b, idx) => normalizeLorebook(b, idx));
    if (!s.lorebooks.length) {
        s.lorebooks.push(normalizeLorebook({
            name: "Shared Story World",
            enabled: false,
            entries: {}
        }, 0));
    }
    if (!s.loreContext || typeof s.loreContext !== "object") s.loreContext = {};
    if (!Array.isArray(s.loreContext.globalBooks)) s.loreContext.globalBooks = [];
    if (!s.loreContext.characterBindings || typeof s.loreContext.characterBindings !== "object") s.loreContext.characterBindings = {};
    if (!s.loreContext.personaBindings || typeof s.loreContext.personaBindings !== "object") s.loreContext.personaBindings = {};
    if (!s.loreContext.chatBindings || typeof s.loreContext.chatBindings !== "object") s.loreContext.chatBindings = {};
    if (!String(s.loreContext.insertionStrategy || "").trim()) s.loreContext.insertionStrategy = "sorted_evenly";
    if (!String(s.loreContext.activeChatId || "").trim()) s.loreContext.activeChatId = "default";
    return s;
}

function getActiveBook(settings) {
    const s = ensureState(settings || getSettings());
    activeBookIndex = Math.max(0, Math.min(activeBookIndex, s.lorebooks.length - 1));
    return s.lorebooks[activeBookIndex];
}

function getBookEntriesArray(book) {
    const entries = normalizeEntriesObject(book?.entries || {});
    return Object.values(entries).sort((a, b) => Number(a.displayIndex || a.uid || 0) - Number(b.displayIndex || b.uid || 0));
}

function ensureWindow() {
    let win = document.getElementById(WIN_ID);
    if (win) return win;
    win = document.createElement("div");
    win.id = WIN_ID;
    win.style.cssText = [
        "position:fixed",
        "top:5vh",
        "left:50%",
        "transform:translateX(-50%)",
        "z-index:9001",
        "width:min(1220px, 96vw)",
        "height:min(820px, 90vh)",
        "overflow:hidden",
        "display:flex",
        "flex-direction:column",
        "background:rgba(10,16,24,0.96)",
        "border:1px solid rgba(111,211,255,0.4)",
        "border-radius:12px",
        "box-shadow:0 16px 40px rgba(0,0,0,0.45)"
    ].join(";");
    win.innerHTML = `
        <div style="flex:0 0 auto; display:flex; align-items:center; gap:8px; justify-content:space-between; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.12);">
            <div style="display:flex; align-items:center; gap:8px;">
                <strong>World Info / Lorebooks</strong>
                <select id="${BOOK_SELECT_ID}" class="modal-select" style="min-width:280px;"></select>
                <button id="uie-lb-new-book" class="reply-tool-btn" style="width:auto; padding:0 10px;">+ Book</button>
                <button id="uie-lb-rename-book" class="reply-tool-btn" style="width:auto; padding:0 10px;">Rename</button>
                <button id="uie-lb-delete-book" class="reply-tool-btn" style="width:auto; padding:0 10px;">Delete</button>
            </div>
            <div style="display:flex; gap:8px;">
                <button id="uie-lb-import-book" class="reply-tool-btn" style="width:auto; padding:0 10px;">Import Book</button>
                <button id="uie-lb-export-book" class="reply-tool-btn" style="width:auto; padding:0 10px;">Export Book</button>
                <button id="uie-lb-close" class="reply-tool-btn" style="width:auto; padding:0 10px;">Close</button>
            </div>
        </div>
        <input id="uie-lb-import-file" type="file" accept=".json,application/json" style="display:none;">
        <div style="flex:0 0 auto; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.03);">
            <div style="display:grid; grid-template-columns: 200px 130px 1fr 1fr auto auto; gap:8px; align-items:end;">
                <div>
                    <label style="font-size:12px; opacity:0.8;">Insertion Strategy</label>
                    <select id="${CTX_STRATEGY_ID}" class="modal-select">
                        <option value="sorted_evenly">Sorted Evenly</option>
                        <option value="character_first">Character Lore First</option>
                        <option value="global_first">Global Lore First</option>
                    </select>
                </div>
                <div>
                    <label style="font-size:12px; opacity:0.8;">Scope</label>
                    <select id="${CTX_SCOPE_ID}" class="modal-select">
                        <option value="global">Global</option>
                        <option value="character">Character</option>
                        <option value="persona">Persona</option>
                        <option value="chat">Chat</option>
                    </select>
                </div>
                <div>
                    <label style="font-size:12px; opacity:0.8;">Target (name/chat id)</label>
                    <input id="${CTX_TARGET_ID}" class="modal-input" placeholder="Ren / Player / default">
                </div>
                <div>
                    <label style="font-size:12px; opacity:0.8;">Lorebook</label>
                    <select id="${CTX_BOOK_ID}" class="modal-select"></select>
                </div>
                <button id="uie-lb-ctx-add" class="reply-tool-btn" style="width:auto; padding:0 10px;">Bind</button>
                <button id="uie-lb-ctx-remove" class="reply-tool-btn" style="width:auto; padding:0 10px;">Unbind</button>
            </div>
            <div id="${CTX_LIST_ID}" style="margin-top:8px; max-height:80px; overflow-y:auto; overflow-x:hidden; font-size:12px; opacity:0.9;"></div>
            <div style="display:flex; align-items:center; justify-content:space-between; margin-top:8px;">
                <label style="font-size:12px; opacity:0.8;">Activation Debug</label>
                <button id="uie-lb-ctx-debug-refresh" class="reply-tool-btn" style="width:auto; padding:0 10px;">Refresh Debug</button>
            </div>
            <pre id="${CTX_DEBUG_ID}" style="margin:6px 0 0; max-height:100px; overflow-y:auto; overflow-x:auto; font-size:11px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.12); border-radius:8px; padding:8px; white-space:pre-wrap; word-break:break-word;"></pre>
        </div>
        <div style="flex:1 1 auto; display:grid; grid-template-columns:360px 1fr; overflow:hidden;">
            <div style="border-right:1px solid rgba(255,255,255,0.12); padding:10px; display:flex; flex-direction:column; overflow:hidden;">
                <div style="flex:0 0 auto; display:flex; flex-direction:column; gap:6px; margin-bottom:10px;">
                    <label style="font-size:12px; opacity:0.8;">AI — describe the lore entry (place, faction, rule, item…)</label>
                    <textarea id="uie-lb-gen-brief" class="modal-textarea" style="min-height:52px;" placeholder="e.g. The riverside rehearsal studio — should fire on Riverside, studio, rehearsal"></textarea>
                    <button type="button" id="uie-lb-gen-entry-ai" class="reply-tool-btn" style="width:auto; padding:0 10px; align-self:flex-start;">Generate entry (AI)</button>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <button type="button" id="uie-lb-add-entry" class="reply-tool-btn" style="width:auto; padding:0 10px;">+ Entry</button>
                        <button type="button" id="uie-lb-save-entry" class="reply-tool-btn" style="width:auto; padding:0 10px;">Save Entry</button>
                    </div>
                </div>
                <div id="${ENTRY_LIST_ID}" style="flex:1 1 auto; display:flex; flex-direction:column; gap:8px; overflow-y:auto; padding-right:4px;"></div>
            </div>
            <div style="padding:12px; display:flex; flex-direction:column; overflow-y:auto; gap:10px;">
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; flex:0 0 auto;">
                    <div><label style="font-size:11px; opacity:0.8; display:block; margin-bottom:2px;">Memo / Title</label><input id="${ENTRY_MEMO_ID}" class="modal-input"></div>
                    <div><label style="font-size:11px; opacity:0.8; display:block; margin-bottom:2px;">Primary Keys (comma)</label><input id="${ENTRY_KEY_ID}" class="modal-input"></div>
                    <div><label style="font-size:11px; opacity:0.8; display:block; margin-bottom:2px;">Secondary Keys (comma)</label><input id="${ENTRY_KEY2_ID}" class="modal-input"></div>
                    <div>
                        <label style="font-size:11px; opacity:0.8; display:block; margin-bottom:2px;">Category</label>
                        <select id="uie-lb-category" class="modal-select">
                            <option value="">None (General Lore)</option>
                            <option value="item">Item</option>
                            <option value="equipment">Equipment</option>
                            <option value="skill">Skill</option>
                            <option value="party">Party Member</option>
                            <option value="world_item">World Item</option>
                            <option value="world_equipment">World Equipment</option>
                        </select>
                    </div>
                    <div><label style="font-size:11px; opacity:0.8; display:block; margin-bottom:2px;">Order</label><input id="${ENTRY_ORDER_ID}" type="number" class="modal-input" value="100"></div>
                    <div><label style="font-size:11px; opacity:0.8; display:block; margin-bottom:2px;">Position</label><input id="${ENTRY_POSITION_ID}" type="number" class="modal-input" value="4"></div>
                    <div><label style="font-size:11px; opacity:0.8; display:block; margin-bottom:2px;">Probability</label><input id="${ENTRY_PROB_ID}" type="number" class="modal-input" value="100"></div>
                    <div><label style="font-size:11px; opacity:0.8; display:block; margin-bottom:2px;">Depth</label><input id="${ENTRY_DEPTH_ID}" type="number" class="modal-input" value="4"></div>
                    <div><label style="font-size:11px; opacity:0.8; display:block; margin-bottom:2px;">Role</label><input id="${ENTRY_ROLE_ID}" type="number" class="modal-input" value="0"></div>
                </div>
                <div style="display:grid; grid-template-columns:repeat(4, minmax(130px, 1fr)); gap:8px; margin:8px 0; flex:0 0 auto;">
                    <label style="font-size:12px; display:flex; align-items:center; gap:4px;"><input id="uie-lb-constant" type="checkbox"> Constant</label>
                    <label style="font-size:12px; display:flex; align-items:center; gap:4px;"><input id="uie-lb-disable" type="checkbox"> Disable</label>
                    <label style="font-size:12px; display:flex; align-items:center; gap:4px;"><input id="uie-lb-vectorized" type="checkbox"> Vectorized</label>
                    <label style="font-size:12px; display:flex; align-items:center; gap:4px;"><input id="uie-lb-use-prob" type="checkbox" checked> Use Probability</label>
                    <label style="font-size:12px; display:flex; align-items:center; gap:4px;"><input id="uie-lb-selective" type="checkbox" checked> Selective</label>
                    <label style="font-size:12px; display:flex; align-items:center; gap:4px;"><input id="uie-lb-ex-rec" type="checkbox"> Exclude Recursion</label>
                    <label style="font-size:12px; display:flex; align-items:center; gap:4px;"><input id="uie-lb-prevent-rec" type="checkbox"> Prevent Recursion</label>
                    <label style="font-size:12px; display:flex; align-items:center; gap:4px;"><input id="uie-lb-delay-rec" type="checkbox"> Delay Until Recursion</label>
                </div>
                <div style="flex:1 1 auto; display:flex; flex-direction:column; min-height:180px;">
                    <label style="font-size:11px; opacity:0.8; display:block; margin-bottom:2px;">Entry Content</label>
                    <textarea id="${ENTRY_CONTENT_ID}" class="modal-textarea" style="flex:1 1 auto; min-height:140px; resize:none;"></textarea>
                </div>
                <div style="flex:0 0 auto; display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
                    <button id="uie-lb-delete-entry" class="reply-tool-btn" style="width:auto; padding:0 10px;">Delete Entry</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(win);
    return win;
}

function escapeHtml(v) {
    return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fillBookSelect() {
    const s = ensureState(getSettings());
    const sel = document.getElementById(BOOK_SELECT_ID);
    const ctxBook = document.getElementById(CTX_BOOK_ID);
    if (!sel) return;
    sel.innerHTML = "";
    if (ctxBook) ctxBook.innerHTML = "";
    s.lorebooks.forEach((b, idx) => {
        const opt = document.createElement("option");
        opt.value = String(idx);
        opt.textContent = String(b.name || `Lorebook ${idx + 1}`);
        sel.appendChild(opt);
        if (ctxBook) {
            const c = document.createElement("option");
            c.value = String(b.name || "");
            c.textContent = String(b.name || `Lorebook ${idx + 1}`);
            ctxBook.appendChild(c);
        }
    });
    sel.value = String(activeBookIndex);
}

function getContextBucket(scope, target, ctx) {
    const s = String(scope || "").trim().toLowerCase();
    if (s === "global") return { map: null, key: "__global__", list: ctx.globalBooks };
    if (s === "character") return { map: ctx.characterBindings, key: String(target || "").trim(), list: null };
    if (s === "persona") return { map: ctx.personaBindings, key: String(target || "").trim(), list: null };
    return { map: ctx.chatBindings, key: String(target || "").trim() || "default", list: null };
}

function renderContextBindings() {
    const s = ensureState(getSettings());
    const ctx = s.loreContext;
    const listEl = document.getElementById(CTX_LIST_ID);
    const strategyEl = document.getElementById(CTX_STRATEGY_ID);
    if (strategyEl) strategyEl.value = String(ctx.insertionStrategy || "sorted_evenly");
    if (!listEl) return;
    const lines = [];
    lines.push(`<div><strong>Global:</strong> ${(ctx.globalBooks || []).join(", ") || "(none)"}</div>`);
    Object.entries(ctx.characterBindings || {}).forEach(([k, v]) => {
        const arr = Array.isArray(v) ? v : [];
        if (arr.length) lines.push(`<div><strong>Character:${escapeHtml(k)}</strong> -> ${escapeHtml(arr.join(", "))}</div>`);
    });
    Object.entries(ctx.personaBindings || {}).forEach(([k, v]) => {
        const arr = Array.isArray(v) ? v : [];
        if (arr.length) lines.push(`<div><strong>Persona:${escapeHtml(k)}</strong> -> ${escapeHtml(arr.join(", "))}</div>`);
    });
    Object.entries(ctx.chatBindings || {}).forEach(([k, v]) => {
        const arr = Array.isArray(v) ? v : [];
        if (arr.length) lines.push(`<div><strong>Chat:${escapeHtml(k)}</strong> -> ${escapeHtml(arr.join(", "))}</div>`);
    });
    listEl.innerHTML = lines.join("") || `<div style="opacity:0.7;">No context bindings yet.</div>`;
}

function renderActivationDebug() {
    const el = document.getElementById(CTX_DEBUG_ID);
    if (!el) return;
    const dbg = (typeof window !== "undefined" && window.UIE_loreLastActivation) ? window.UIE_loreLastActivation : null;
    if (!dbg || typeof dbg !== "object") {
        el.textContent = "No activation debug yet. Generate a message, then refresh.";
        return;
    }
    const compact = {
        timestamp: dbg.timestamp || "",
        strategy: dbg.strategy || "",
        activeChatId: dbg.activeChatId || "",
        activePersona: dbg.activePersona || "",
        activeCharacter: dbg.activeCharacter || "",
        sourceBooks: Array.isArray(dbg.sourceBooks) ? dbg.sourceBooks : [],
        activatedCount: Number(dbg.activatedCount || 0),
        chosenCount: Number(dbg.chosenCount || 0),
        chosenPreview: Array.isArray(dbg.chosenPreview) ? dbg.chosenPreview : []
    };
    el.textContent = JSON.stringify(compact, null, 2);
}

function fillEditor(entry) {
    const e = normalizeEntry(entry || createDefaultEntry(0), entry?.uid ?? 0);
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = String(val ?? ""); };
    const chk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val === true; };
    set(ENTRY_MEMO_ID, e.comment);
    set(ENTRY_KEY_ID, e.key.join(", "));
    set(ENTRY_KEY2_ID, e.keysecondary.join(", "));
    set(ENTRY_CONTENT_ID, e.content);
    set("uie-lb-category", e.category);
    set(ENTRY_ORDER_ID, e.order);
    set(ENTRY_POSITION_ID, e.position);
    set(ENTRY_PROB_ID, e.probability);
    set(ENTRY_DEPTH_ID, e.depth);
    set(ENTRY_ROLE_ID, e.role);
    chk("uie-lb-constant", e.constant);
    chk("uie-lb-disable", e.disable);
    chk("uie-lb-vectorized", e.vectorized);
    chk("uie-lb-use-prob", e.useProbability !== false);
    chk("uie-lb-selective", e.selective !== false);
    chk("uie-lb-ex-rec", e.excludeRecursion);
    chk("uie-lb-prevent-rec", e.preventRecursion);
    chk("uie-lb-delay-rec", e.delayUntilRecursion);
}

function readEditor(uid = 0) {
    const get = (id) => document.getElementById(id);
    const parseList = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
    return normalizeEntry({
        uid,
        key: parseList(get(ENTRY_KEY_ID)?.value),
        keysecondary: parseList(get(ENTRY_KEY2_ID)?.value),
        comment: String(get(ENTRY_MEMO_ID)?.value || "").trim(),
        content: String(get(ENTRY_CONTENT_ID)?.value || "").trim(),
        category: String(get("uie-lb-category")?.value || "").trim(),
        order: Number(get(ENTRY_ORDER_ID)?.value || 100),
        position: Number(get(ENTRY_POSITION_ID)?.value || 4),
        probability: Number(get(ENTRY_PROB_ID)?.value || 100),
        depth: Number(get(ENTRY_DEPTH_ID)?.value || 4),
        role: Number(get(ENTRY_ROLE_ID)?.value || 0),
        constant: get("uie-lb-constant")?.checked === true,
        disable: get("uie-lb-disable")?.checked === true,
        vectorized: get("uie-lb-vectorized")?.checked === true,
        useProbability: get("uie-lb-use-prob")?.checked !== false,
        selective: get("uie-lb-selective")?.checked !== false,
        excludeRecursion: get("uie-lb-ex-rec")?.checked === true,
        preventRecursion: get("uie-lb-prevent-rec")?.checked === true,
        delayUntilRecursion: get("uie-lb-delay-rec")?.checked === true
    }, uid);
}

function renderEntryList() {
    const s = ensureState(getSettings());
    const book = getActiveBook(s);
    const wrap = document.getElementById(ENTRY_LIST_ID);
    if (!wrap) return;
    wrap.innerHTML = "";
    const arr = getBookEntriesArray(book);
    if (!arr.length) {
        wrap.innerHTML = `<div style="opacity:0.75; font-size:12px;">No entries. Click + Entry.</div>`;
        fillEditor(createDefaultEntry(0));
        activeEntryUid = -1;
        return;
    }
    if (!arr.some((e) => Number(e.uid) === Number(activeEntryUid))) activeEntryUid = Number(arr[0].uid);
    arr.forEach((entry) => {
        const active = Number(entry.uid) === Number(activeEntryUid);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.style.cssText = [
            "text-align:left",
            "padding:8px",
            "border:1px solid rgba(255,255,255,0.15)",
            "border-radius:8px",
            `background:${active ? "rgba(111,211,255,0.2)" : "rgba(255,255,255,0.04)"}`,
            "color:#fff",
            "cursor:pointer"
        ].join(";");
        btn.innerHTML = `
            <div style="font-weight:700;">${escapeHtml(entry.comment || "Untitled")}</div>
            <div style="font-size:11px; opacity:0.75;">${escapeHtml((entry.key || []).join(", "))}</div>
        `;
        btn.addEventListener("click", () => {
            activeEntryUid = Number(entry.uid);
            fillEditor(entry);
            renderEntryList();
        });
        wrap.appendChild(btn);
    });
    const active = arr.find((x) => Number(x.uid) === Number(activeEntryUid)) || arr[0];
    fillEditor(active);
}

function saveEntry() {
    const s = ensureState(getSettings());
    const book = getActiveBook(s);
    const entries = normalizeEntriesObject(book.entries);
    const uid = Number(activeEntryUid >= 0 ? activeEntryUid : Date.now());
    const record = readEditor(uid);
    entries[String(uid)] = record;
    book.entries = entries;
    activeEntryUid = uid;
    saveSettings();
    renderEntryList();
}

function addEntry() {
    const s = ensureState(getSettings());
    const book = getActiveBook(s);
    const arr = getBookEntriesArray(book);
    const uid = arr.length ? Math.max(...arr.map((e) => Number(e.uid || 0))) + 1 : 0;
    book.entries[String(uid)] = createDefaultEntry(uid);
    activeEntryUid = uid;
    saveSettings();
    renderEntryList();
}

function deleteEntry() {
    if (activeEntryUid < 0) return;
    const s = ensureState(getSettings());
    const book = getActiveBook(s);
    const entries = normalizeEntriesObject(book.entries);
    delete entries[String(activeEntryUid)];
    book.entries = entries;
    activeEntryUid = -1;
    saveSettings();
    renderEntryList();
}

function exportCurrentBook() {
    const s = ensureState(getSettings());
    const book = getActiveBook(s);
    const payload = {
        entries: normalizeEntriesObject(book.entries)
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${String(book.name || "lorebook").replace(/[^\w\-]+/g, "_")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

async function importBookFromFile(file) {
    if (!file) return;
    const text = await file.text();
    const parsed = readJsonSafe(text, null);
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid JSON");
    const entries = normalizeEntriesObject(parsed.entries || parsed.worldInfo || parsed.data || {});
    const s = ensureState(getSettings());
    const book = normalizeLorebook({
        name: String(file.name || "Imported Lorebook").replace(/\.json$/i, ""),
        enabled: false,
        entries
    }, s.lorebooks.length);
    s.lorebooks.push(book);
    activeBookIndex = s.lorebooks.length - 1;
    activeEntryUid = -1;
    saveSettings();
}

async function generateLoreEntryWithAi() {
    const briefEl = document.getElementById("uie-lb-gen-brief");
    const brief = String(briefEl?.value || "").trim();
    if (!brief) {
        alert("Describe what this lore entry should cover.");
        return;
    }
    const contentEl = document.getElementById(ENTRY_CONTENT_ID);
    const existingContent = String(contentEl?.value || "").trim();
    if (existingContent && !window.confirm("Replace the selected entry’s fields with AI output?")) return;

    const win = document.getElementById(WIN_ID);
    const btn = win?.querySelector("#uie-lb-gen-entry-ai");
    const prev = btn ? btn.textContent : "Generate entry (AI)";
    try {
        if (btn) {
            btn.disabled = true;
            btn.textContent = "Generating…";
        }
        ensureState(getSettings());
        const bookBefore = getActiveBook(getSettings());
        let arr = getBookEntriesArray(bookBefore);
        if (!arr.length) addEntry();

        const s = getSettings();
        const book = getActiveBook(s);
        const loc = String(s.worldState?.location || "").trim() || "unknown";
        const target = String(s?.ui?.activeTargetCharacter || "").trim();
        const prompt = [
            "You write one World Info / lorebook entry for a roleplay engine.",
            "Output ONLY valid JSON (no markdown, no code fences). Keys:",
            "- \"comment\": short entry title.",
            "- \"primary_keys\": comma-separated activation phrases OR a JSON array of strings.",
            "- \"secondary_keys\": optional comma-separated string or array; may be empty.",
            "- \"category\": optional category string, must be one of: \"\" (none), \"item\", \"equipment\", \"skill\", \"party\", \"world_item\", \"world_equipment\".",
            "- \"content\": factual lore the model should treat as true when active.",
            `Lorebook name: ${book.name}`,
            `Current story location: ${loc}`,
            `Active character target (context): ${target || "none"}`,
            `Author request: ${brief}`
        ].join("\n");
        const raw = await generateContent(prompt, "JSON");
        const o = extractJsonObject(raw);
        if (!o || typeof o !== "object") throw new Error("Model did not return JSON.");
        const comment = String(o.comment || o.title || "AI entry").trim() || "AI entry";
        let k1 = coalesceKeys(o.primary_keys ?? o.keys ?? o.key);
        const k2 = coalesceKeys(o.secondary_keys ?? o.keysecondary);
        const category = String(o.category || "").trim().toLowerCase();
        const content = String(o.content || o.text || "").trim();
        if (!content) throw new Error("Empty content in model response.");
        if (!k1.length) {
            const bits = comment.split(/\s+/).filter((w) => w.length > 2).slice(0, 4);
            k1 = bits.length ? bits : ["lore"];
        }
        fillEditor(normalizeEntry({
            uid: Number(activeEntryUid),
            comment,
            key: k1,
            keysecondary: k2,
            category,
            content
        }, Number(activeEntryUid)));
        saveEntry();
        try { window.showToast?.(`Lorebook: saved “${comment}”.`); } catch (_) {}
    } catch (e) {
        alert(`Lore generation failed: ${String(e?.message || e || "error")}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = prev;
        }
    }
}

function bind(win) {
    const on = (id, ev, fn) => { const el = win.querySelector(`#${id}`); if (el) el.addEventListener(ev, fn); };
    on("uie-lb-close", "click", () => { win.style.display = "none"; });
    on(BOOK_SELECT_ID, "change", (e) => {
        activeBookIndex = Number(e?.target?.value || 0);
        activeEntryUid = -1;
        renderAll();
    });
    on("uie-lb-new-book", "click", () => {
        const s = ensureState(getSettings());
        const name = prompt("Lorebook name:", `Lorebook ${s.lorebooks.length + 1}`) || "";
        const nm = String(name || "").trim();
        if (!nm) return;
        s.lorebooks.push(normalizeLorebook({ name: nm, enabled: true, entries: {} }, s.lorebooks.length));
        activeBookIndex = s.lorebooks.length - 1;
        activeEntryUid = -1;
        saveSettings();
        renderAll();
    });
    on("uie-lb-rename-book", "click", () => {
        const s = ensureState(getSettings());
        const book = getActiveBook(s);
        const name = prompt("Rename lorebook:", String(book.name || "")) || "";
        const nm = String(name || "").trim();
        if (!nm) return;
        book.name = nm;
        saveSettings();
        renderAll();
    });
    on("uie-lb-delete-book", "click", () => {
        const s = ensureState(getSettings());
        if (s.lorebooks.length <= 1) return;
        s.lorebooks.splice(activeBookIndex, 1);
        activeBookIndex = Math.max(0, Math.min(activeBookIndex, s.lorebooks.length - 1));
        activeEntryUid = -1;
        saveSettings();
        renderAll();
    });
    on("uie-lb-gen-entry-ai", "click", (e) => {
        e.preventDefault();
        generateLoreEntryWithAi();
    });
    on("uie-lb-add-entry", "click", addEntry);
    on("uie-lb-save-entry", "click", saveEntry);
    on("uie-lb-delete-entry", "click", deleteEntry);
    on("uie-lb-export-book", "click", exportCurrentBook);
    on("uie-lb-import-book", "click", () => win.querySelector("#uie-lb-import-file")?.click());
    on("uie-lb-import-file", "change", async (e) => {
        const file = e?.target?.files?.[0];
        if (!file) return;
        try {
            await importBookFromFile(file);
            renderAll();
        } catch (err) {
            alert(`Lorebook import failed: ${String(err?.message || err || "Unknown error")}`);
        } finally {
            e.target.value = "";
        }
    });
    on(CTX_STRATEGY_ID, "change", (e) => {
        const s = ensureState(getSettings());
        s.loreContext.insertionStrategy = String(e?.target?.value || "sorted_evenly");
        saveSettings();
        renderContextBindings();
    });
    on(CTX_SCOPE_ID, "change", (e) => {
        const scope = String(e?.target?.value || "global");
        const t = win.querySelector(`#${CTX_TARGET_ID}`);
        if (t) {
            if (scope === "global") t.placeholder = "(not used for global)";
            else if (scope === "character") t.placeholder = "Character name";
            else if (scope === "persona") t.placeholder = "Persona name";
            else t.placeholder = "Chat id (default)";
        }
    });
    on("uie-lb-ctx-add", "click", () => {
        const s = ensureState(getSettings());
        const ctx = s.loreContext;
        const scope = String(win.querySelector(`#${CTX_SCOPE_ID}`)?.value || "global");
        const target = String(win.querySelector(`#${CTX_TARGET_ID}`)?.value || "").trim();
        const bookName = String(win.querySelector(`#${CTX_BOOK_ID}`)?.value || "").trim();
        if (!bookName) return;
        const bucket = getContextBucket(scope, target, ctx);
        if (bucket.map) {
            if (!bucket.key) {
                alert("Target is required for this scope.");
                return;
            }
            if (!Array.isArray(bucket.map[bucket.key])) bucket.map[bucket.key] = [];
            if (!bucket.map[bucket.key].includes(bookName)) bucket.map[bucket.key].push(bookName);
        } else {
            if (!bucket.list.includes(bookName)) bucket.list.push(bookName);
        }
        saveSettings();
        renderContextBindings();
    });
    on("uie-lb-ctx-remove", "click", () => {
        const s = ensureState(getSettings());
        const ctx = s.loreContext;
        const scope = String(win.querySelector(`#${CTX_SCOPE_ID}`)?.value || "global");
        const target = String(win.querySelector(`#${CTX_TARGET_ID}`)?.value || "").trim();
        const bookName = String(win.querySelector(`#${CTX_BOOK_ID}`)?.value || "").trim();
        if (!bookName) return;
        const bucket = getContextBucket(scope, target, ctx);
        if (bucket.map) {
            if (!bucket.key || !Array.isArray(bucket.map[bucket.key])) return;
            bucket.map[bucket.key] = bucket.map[bucket.key].filter((x) => String(x || "") !== bookName);
            if (!bucket.map[bucket.key].length) delete bucket.map[bucket.key];
        } else {
            bucket.list = (bucket.list || []).filter((x) => String(x || "") !== bookName);
            ctx.globalBooks = bucket.list;
        }
        saveSettings();
        renderContextBindings();
    });
    on("uie-lb-ctx-debug-refresh", "click", renderActivationDebug);
}

function renderAll() {
    fillBookSelect();
    renderEntryList();
    renderContextBindings();
    renderActivationDebug();
}

export function render() {
    ensureState(getSettings());
    const win = ensureWindow();
    if (!win.dataset.bound) {
        bind(win);
        win.dataset.bound = "1";
    }
    renderAll();
    win.style.display = "block";
}

