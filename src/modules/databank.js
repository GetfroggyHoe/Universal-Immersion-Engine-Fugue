import { getSettings, saveSettings, ensureChatStateLoaded, commitStateUpdate } from "./core.js";
import { generateContent, hasVerifiedTextConnection } from "./apiClient.js";
import { getWorldState } from "./stateTracker.js";
import { getContext } from "./gameContext.js";
import { injectRpEvent } from "./features/rp_log.js";
import { customConfirm } from "./popups.js";
import { parseJsonLoose, normalizeDatabankArrayInPlace, toDatabankDisplayEntries, addDatabankEntryWithDedupe } from "./databankModel.js";

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function newId(prefix) {
    return `${String(prefix || "id")}_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}`;
}

const DATABANK_NODE_LIMIT = 320;
const DATABANK_NODE_CATEGORIES = [
    { id: "all", label: "ALL" },
    { id: "being", label: "BEINGS" },
    { id: "enemy", label: "ENEMIES" },
    { id: "place", label: "PLACES" },
    { id: "faction", label: "FACTIONS" },
    { id: "history", label: "HISTORY" },
    { id: "legend", label: "LEGENDS" },
    { id: "myth", label: "MYTHS" },
    { id: "deity", label: "DEITIES" },
    { id: "religion", label: "FAITHS" },
    { id: "cult", label: "CULTS" },
    { id: "story", label: "STORIES" },
    { id: "rule", label: "RULES" },
    { id: "event", label: "EVENTS" },
    { id: "item", label: "ITEMS" },
    { id: "concept", label: "CONCEPTS" },
];
const DATABANK_NODE_TYPE_IDS = new Set(DATABANK_NODE_CATEGORIES.map((c) => c.id).filter((id) => id !== "all"));
const DATABANK_NODE_ALIASES = {
    character: "being",
    creature: "being",
    entity: "being",
    monster: "enemy",
    opponent: "enemy",
    location: "place",
    region: "place",
    organization: "faction",
    group: "faction",
    legendary: "legend",
    folktale: "legend",
    god: "deity",
    goddess: "deity",
    divinity: "deity",
    faith: "religion",
    church: "religion",
    temple: "religion",
    artifact: "item",
    relic: "item",
    object: "item",
    law: "rule",
    system: "rule",
};
let dbNodeActiveCategory = "all";

function normalizeDatabankNodes(s = getSettings()) {
    if (!s || typeof s !== "object") return [];
    const legacyNodes = Array.isArray(s?.databank?.nodes) ? s.databank.nodes : [];
    if (!Array.isArray(s.databankNodes)) s.databankNodes = [];
    if (legacyNodes.length) {
        s.databankNodes.push(...legacyNodes);
        try { delete s.databank.nodes; } catch (_) {}
    }
    s.databankNodes = s.databankNodes.map((n) => ({
        id: String(n?.id || newId("dbnode")),
        title: String(n?.title || n?.name || "Untitled Node").trim().slice(0, 120),
        type: normalizeDatabankNodeType(n?.type || n?.category || "concept"),
        body: String(n?.body || n?.summary || n?.text || "").trim().slice(0, 6000),
        edges: Array.isArray(n?.edges) ? n.edges.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 40) : [],
        source: String(n?.source || "").trim().slice(0, 80),
        sources: Array.isArray(n?.sources) ? n.sources.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8) : [],
        createdAt: Number(n?.createdAt || n?.created || n?.updatedAt || Date.now()) || Date.now(),
        updatedAt: Number(n?.updatedAt || Date.now())
    })).filter((n) => n.title);
    while (s.databankNodes.length > DATABANK_NODE_LIMIT) {
        s.databankNodes.sort((a, b) => Number(a?.updatedAt || 0) - Number(b?.updatedAt || 0));
        s.databankNodes.shift();
    }
    return s.databankNodes;
}

function normalizeDatabankNodeType(raw) {
    const key = String(raw || "concept").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
    const mapped = DATABANK_NODE_ALIASES[key] || key;
    return DATABANK_NODE_TYPE_IDS.has(mapped) ? mapped : "concept";
}

function normalizeNodeKey(title, type) {
    return `${normalizeDatabankNodeType(type)}:${String(title || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120)}`;
}

function mergeDatabankNode(nodes, raw, opts = {}) {
    if (!Array.isArray(nodes) || !raw || typeof raw !== "object") return false;
    const title = String(raw?.title || raw?.name || "").trim().slice(0, 120);
    const body = String(raw?.body || raw?.summary || raw?.content || raw?.text || "").trim().slice(0, 6000);
    if (!title || !body) return false;
    const type = normalizeDatabankNodeType(raw?.type || raw?.category || "concept");
    const key = normalizeNodeKey(title, type);
    const now = Number(opts?.now || Date.now()) || Date.now();
    const edges = Array.isArray(raw?.edges) ? raw.edges.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 40) : [];
    const source = String(raw?.source || opts?.source || "").trim().slice(0, 80);
    const idx = nodes.findIndex((n) => normalizeNodeKey(n?.title, n?.type) === key);
    if (idx >= 0) {
        const node = nodes[idx];
        const oldBody = String(node.body || "").trim();
        if (body.length > oldBody.length || !oldBody) node.body = body;
        node.edges = Array.from(new Set([...(Array.isArray(node.edges) ? node.edges : []), ...edges])).slice(0, 40);
        node.sources = Array.from(new Set([...(Array.isArray(node.sources) ? node.sources : []), source].filter(Boolean))).slice(0, 8);
        node.source = node.source || source;
        node.updatedAt = now;
        return false;
    }
    nodes.unshift({
        id: newId("dbnode"),
        title,
        type,
        body,
        edges,
        source,
        sources: source ? [source] : [],
        createdAt: now,
        updatedAt: now,
    });
    return true;
}

function normalizeMemoryTitle(rawTitle, rawSummary = "") {
    const summary = String(rawSummary || "").trim();
    let title = String(rawTitle || "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/[\[\]{}<>]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);

    const generic = new Set([
        "memory",
        "memories",
        "entry",
        "log",
        "story",
        "event",
        "update",
        "specific title",
    ]);

    const key = title.toLowerCase().replace(/\s+/g, " ").trim();
    if (!title || title.length < 6 || generic.has(key)) {
        const lead = summary
            .replace(/[\r\n]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .split(/[.!?]/)
            .map((x) => String(x || "").trim())
            .find(Boolean) || "";
        title = lead.slice(0, 80);
    }

    if (!title) {
        const d = new Date();
        title = `Memory ${d.toLocaleDateString()}`;
    }
    return title;
}

function parseTagsInput(raw, fallback = []) {
    const tags = String(raw || "")
        .split(",")
        .map((t) => String(t || "").trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 12);
    if (tags.length) return tags;
    const fb = Array.isArray(fallback) ?
         fallback.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean).slice(0, 12)
        : [];
    return fb.length ? fb : ["manual"];
}

function collectMesLine(m) {
    const isUser =
        m.classList?.contains("is_user") ||
        m.getAttribute?.("is_user") === "true" ||
        m.getAttribute?.("data-is-user") === "true" ||
        m.dataset?.isUser === "true";
    const t =
        m.querySelector?.(".mes_text")?.textContent ||
        m.querySelector?.(".mes-text")?.textContent ||
        m.textContent ||
        "";
    const line = `${isUser ? "You" : "Story"}: ${String(t || "").trim()}`;
    if (!line.trim()) return "";
    return line.slice(0, 520) + "\n";
}

function getChatMessageCount() {
    try {
        const chatEl = document.getElementById("chat");
        if (chatEl) {
            const n = chatEl.querySelectorAll(".mes").length;
            if (n) return n;
        }
        const $txt = $(".chat-msg-txt");
        return $txt.length || 0;
    } catch (_) {
        return 0;
    }
}

function getChatSnippet(max) {
    try {
        let raw = "";
        const $txt = $(".chat-msg-txt");
        if ($txt.length) {
            $txt.slice(-1 * Math.max(1, Number(max || 50))).each(function () { raw += $(this).text() + "\n"; });
            return raw.trim().slice(0, 6000);
        }
        const chatEl = document.getElementById("chat");
        if (!chatEl) return "";
        const msgs = Array.from(chatEl.querySelectorAll(".mes")).slice(-1 * Math.max(1, Number(max || 50)));
        for (const m of msgs) {
            raw += collectMesLine(m);
        }
        return raw.trim().slice(0, 6000);
    } catch (_) {
        return "";
    }
}

/** 1-based inclusive indices; omit or pass undefined end → through last message. */
function getChatSnippetByRange(startOneBased, endOneBased) {
    try {
        const start = Math.max(1, Math.floor(Number(startOneBased) || 1));
        const chatEl = document.getElementById("chat");
        const $txt = $(".chat-msg-txt");
        if ($txt.length && (!chatEl || !chatEl.querySelector(".mes"))) {
            const total = $txt.length;
            const end = Math.min(total, Math.max(start, Math.floor(Number(endOneBased) || total)));
            let raw = "";
            $txt.slice(start - 1, end).each(function () { raw += $(this).text() + "\n"; });
            return raw.trim().slice(0, 6000);
        }
        if (!chatEl) return "";
        const msgs = Array.from(chatEl.querySelectorAll(".mes"));
        const n = msgs.length;
        if (!n) return "";
        const end = Math.min(n, Math.max(start, Math.floor(Number(endOneBased) || n)));
        let raw = "";
        for (let i = start - 1; i < end; i++) {
            raw += collectMesLine(msgs[i]);
        }
        return raw.trim().slice(0, 6000);
    } catch (_) {
        return "";
    }
}

function collectLorebookSnippet(maxChars = 10000) {
    try {
        const s = getSettings();
        const books = Array.isArray(s?.lorebooks) ? s.lorebooks : [];
        const lines = [];
        for (const book of books) {
            const bookName = String(book?.name || book?.title || "Lorebook").trim();
            const rawEntries = book?.entries;
            const entries = Array.isArray(rawEntries) ? rawEntries : (rawEntries && typeof rawEntries === "object" ? Object.values(rawEntries) : []);
            for (const entry of entries) {
                if (!entry || typeof entry !== "object") continue;
                if (entry.disable === true) continue;
                const title = String(entry.comment || entry.title || entry.key || "Entry").trim();
                const category = String(entry.category || "").trim();
                const keys = Array.isArray(entry.key) ? entry.key.join(", ") : String(entry.key || "");
                const content = String(entry.content || entry.summary || entry.text || "").trim();
                if (!content) continue;
                lines.push(`[${bookName}] ${title}${category ? ` (${category})` : ""}${keys ? ` keys: ${keys}` : ""}\n${content}`);
                if (lines.join("\n\n").length >= maxChars) break;
            }
            if (lines.join("\n\n").length >= maxChars) break;
        }
        return lines.join("\n\n").slice(0, maxChars);
    } catch (_) {
        return "";
    }
}

function parseDatabankNodeResponse(text) {
    const raw = String(text || "").replace(/```json|```/g, "").trim();
    if (!raw) return [];
    let obj = null;
    try { obj = JSON.parse(raw); } catch (_) { obj = parseJsonLoose(raw); }
    if (!obj && raw.includes("[")) {
        const m = raw.match(/\[[\s\S]*\]/);
        if (m) {
            try { obj = JSON.parse(m[0]); } catch (_) {}
        }
    }
    if (Array.isArray(obj)) return obj;
    if (Array.isArray(obj?.nodes)) return obj.nodes;
    if (Array.isArray(obj?.entries)) return obj.entries;
    return [];
}

export async function scanDatabankNodesFromSources(opts = {}) {
    const silent = opts?.silent === true;
    const allow = getSettings()?.ai?.databankScan !== false;
    if (!allow) {
        if (!silent) {
            try { window.toastr?.info?.("Databank scan is disabled in settings."); } catch (_) {}
        }
        return { ok: false, reason: "disabled" };
    }
    if (!hasVerifiedTextConnection()) {
        if (!silent) {
            try { window.toastr?.info?.("Connect and apply an AI profile before scanning world data."); } catch (_) {}
        }
        return { ok: false, reason: "api_unavailable" };
    }

    const loreText = collectLorebookSnippet(11000);
    const chatText = getChatSnippet(Math.max(80, Number(opts?.maxMessages || 100)));
    if (`${loreText}\n${chatText}`.trim().length < 50) {
        if (!silent) {
            try { window.toastr?.info?.("Not enough lorebook or chat data to scan."); } catch (_) {}
        }
        return { ok: false, reason: "not_enough_source" };
    }

    const prompt = `[UIE_LOCKED]
Build a USER-FACING world Codex from lorebook entries and recent in-game chat. This is for the player to browse; do not create AI-private tracking notes.

Codex categories allowed:
being, enemy, place, faction, history, legend, myth, deity, religion, cult, story, rule, event, item, concept

Lorebook source:
${loreText || "(none)"}

Recent chat source:
${chatText || "(none)"}

Return ONLY valid JSON:
{"nodes":[{"title":"...","type":"being|enemy|place|faction|history|legend|myth|deity|religion|cult|story|rule|event|item|concept","body":"...","edges":["..."],"source":"lorebook|chat|lorebook+chat"}]}

Rules:
- Extract durable player-useful knowledge: battled enemies, creatures, entities, gods/goddesses/deities, legends, myths, religions, cult activities/views, history, ancient legends, stories told, places, factions, rules, artifacts, and major events.
- If a person, place, item, creature, event, or unknown thing is mainly known as a legend, classify it as legend regardless of its physical form.
- If the player fought or encountered a named or typed hostile being, classify it as enemy.
- Keep body factual, concise, and browsable: 1 to 4 sentences with notable relationships, battle/encounter context, beliefs, myths, or source details.
- Do not include OOC/system/tool metadata, prompt instructions, character-card scaffolding, or private AI reasoning.
- Prefer 6 to 18 high-value nodes. Use an empty array if nothing is worth saving.`;

    try {
        const res = await generateContent(prompt.slice(0, 18000), "System Check");
        const rawNodes = parseDatabankNodeResponse(res);
        const s = getSettings();
        const nodes = normalizeDatabankNodes(s);
        const now = Date.now();
        let added = 0;
        let touched = 0;
        for (const raw of rawNodes.slice(0, 24)) {
            const beforeLen = nodes.length;
            const didAdd = mergeDatabankNode(nodes, raw, { now, source: "scan" });
            if (didAdd) added++;
            if (nodes.length !== beforeLen || didAdd) touched++;
        }
        if (rawNodes.length) {
            saveSettings();
            try { renderNodes(); } catch (_) {}
        }
        if (!silent) {
            try {
                window.toastr?.success?.(added ? `World data updated with ${added} new node${added === 1 ? "" : "s"}.` : "World data scan complete. No new nodes found.");
            } catch (_) {}
        }
        return { ok: true, added, scanned: rawNodes.length, touched };
    } catch (e) {
        if (!silent) {
            try { window.toastr?.error?.("World data scan failed (check console)."); } catch (_) {}
        }
        try { console.error(e); } catch (_) {}
        return { ok: false, reason: "scan_failed", error: String(e?.message || e || "") };
    }
}

export async function scanDatabankFromChat(opts = {}) {
    const maxMessages = Math.max(50, Number(opts?.maxMessages || 80));
    const silent = opts?.silent === true;
    const allow = getSettings()?.ai?.databankScan !== false;
    if (!allow) {
        if (!silent) {
            try { window.toastr?.info?.("Databank scan is disabled in settings."); } catch (_) {}
        }
        return { ok: false, reason: "disabled" };
    }
    if (!hasVerifiedTextConnection()) {
        if (!silent) {
            try { window.toastr?.info?.("Connect and apply an AI profile before scanning the Databank."); } catch (_) {}
        }
        return { ok: false, reason: "api_unavailable" };
    }

    const useRange = Number.isFinite(Number(opts.startMessage)) || Number.isFinite(Number(opts.endMessage));
    const rawLog = useRange ?
         getChatSnippetByRange(
            Number.isFinite(Number(opts.startMessage)) ? Number(opts.startMessage) : 1,
            Number.isFinite(Number(opts.endMessage)) ? Number(opts.endMessage) : undefined,
        )
        : getChatSnippet(maxMessages);
    if (!rawLog || rawLog.length < 50) {
        if (!silent) {
            try { window.toastr?.info?.("Not enough chat data to archive."); } catch (_) {}
        }
        return { ok: false, reason: "not_enough_chat" };
    }

    const prompt = `Task: Generate a detailed "Memory File" for the Databank based on this RP segment.
Input:
${rawLog.substring(0, 5000)}

Instructions:
1. Title must be specific and human-readable (4-10 words), format like: "Who/Where - What changed".
2. Never use generic names like "Memory", "Entry", "Story Update", or "Event".
3. Write a detailed summary (4-6 sentences) capturing key events, important decisions, new information about characters/locations, and any changes in relationships or quest status. Avoid vague phrasing. Be specific.
4. Optional tags should be short lowercase keywords.
5. Ignore omniscient metadata/tool cards/OOC/system text. Use only in-world events.

Output JSON: { "title": "Specific Title", "summary": "Detailed summary...", "tags": ["optional","tags"] }`;

    try {
        const res = await generateContent(prompt, "System Check");
        if (!String(res || "").trim()) return { ok: false, reason: "api_unavailable" };
        const data = parseJsonLoose(res);
        if (!data || typeof data !== "object") throw new Error("Bad JSON response");

        const s = getSettings();
        ensureDatabank(s);
        const beforeLen = Array.isArray(s.databank) ? s.databank.length : 0;

        const summary = String(data.summary || data.content || "").trim().slice(0, 1200);
        if (!summary) throw new Error("Missing summary");
        const title = normalizeMemoryTitle(data.title, summary);
        const tags = Array.isArray(data.tags) ?
             data.tags.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean).slice(0, 12)
            : ["auto"];

        const addOpts = { now: Date.now(), makeId: () => newId("db") };
        addDatabankEntryWithDedupe(s.databank, { title, summary, tags }, addOpts);
        const memSyncAdded = syncDatabankEntryToSocialMemories(s, { title, summary, tags });

        const afterLen = Array.isArray(s.databank) ? s.databank.length : 0;
        const added = Math.max(0, afterLen - beforeLen);

        saveSettings();
        try { render(); } catch (_) {}
        try { renderState(); } catch (_) {}

        if (!silent) {
            if (added > 0) {
                try { window.toastr?.success?.(`Databank updated${memSyncAdded > 0 ? ` (${memSyncAdded} social memories synced)` : ""}.`); } catch (_) {}
            } else {
                try { window.toastr?.info?.("No new databank entry to add."); } catch (_) {}
            }
        }
        return { ok: true, added, memSyncAdded };
    } catch (e) {
        if (!silent) {
            try { window.toastr?.error?.("Databank scan failed (check console)."); } catch (_) {}
        }
        try { console.error(e); } catch (_) {}
        return { ok: false, reason: "scan_failed", error: String(e?.message || e || "") };
    }
}

/** Archive a memory from an inclusive 1-based chat message range (same DOM order as the chat). */
export async function scanDatabankFromChatRange(startMessage, endMessage, opts = {}) {
    return scanDatabankFromChat({
        ...opts,
        startMessage,
        endMessage: endMessage == null ? undefined : endMessage,
    });
}

function ensureDatabank(s) {
    if (!s.databank) s.databank = [];
    if (!Array.isArray(s.databank)) s.databank = [];
    const changed = normalizeDatabankArrayInPlace(s.databank, { now: Date.now(), makeId: () => newId("db") });
    if (changed) saveSettings();
}

function ensureSocial(s) {
    if (!s.social) s.social = { friends: [], associates: [], romance: [], family: [], rivals: [] };
    ["friends", "associates", "romance", "family", "rivals"].forEach(k => { if (!Array.isArray(s.social[k])) s.social[k] = []; });
    ["friends", "associates", "romance", "family", "rivals"].forEach(k => {
        (s.social[k] || []).forEach(p => {
            if (!p || typeof p !== "object") return;
            if (!p.id) p.id = newId("person");
            if (!Array.isArray(p.memories)) p.memories = [];
        });
    });
}

let dbSocialActivePersonRef = { id: "", tab: "", name: "" };
let dbRenderLimit = 60;
let dbLastListSig = "";

function refreshLinkedSocialState({ rerenderProfiles = false, rerenderModal = false } = {}) {
    try {
        commitStateUpdate({ save: true, layout: false, emit: true });
    } catch (_) {
        try { saveSettings(); } catch (_) {}
    }
    if (rerenderProfiles) {
        try { renderSocialProfiles(); } catch (_) {}
    }
    if (rerenderModal) {
        try { renderSocialMemoriesModal(); } catch (_) {}
    }
}

function buildDatabankRenderSignature(entries, socialIndex) {
    const list = Array.isArray(entries) ? entries : [];
    const tailSig = list
        .slice(-8)
        .map((m) => {
            const id = String(m?.id || "");
            const title = String(m?.title || "").trim().slice(0, 48);
            const body = String(m?.body || "").trim().slice(0, 96);
            const date = String(m?.date || "").trim();
            return `${id}|${title}|${body}|${date}`;
        })
        .join("~");
    const socialSig = (Array.isArray(socialIndex?.list) ? socialIndex.list : [])
        .slice(0, 220)
        .map((p) => `${normalizeNameKey(p?.name || "")}:${String(p?.id || "")}`)
        .join("|");
    return `${list.length}|${dbRenderLimit}|${tailSig}|${socialSig}`;
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

function normalizeMemoryLineForPerson(rawText, personName = "") {
    let text = String(rawText || "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!text) return "";
    if (isMetaMemoryText(text)) return "";

    const name = String(personName || "").trim();
    if (name && !lineMentionsName(text, name)) {
        text = `${name}: ${text}`;
    }

    return text.slice(0, 320);
}

function syncDatabankEntryToSocialMemories(s, entry) {
    try {
        ensureSocial(s);
        const title = String(entry?.title || "").trim();
        const summary = String(entry?.summary || entry?.content || "").trim();
        if (!summary) return 0;
        if (isMetaMemoryText(`${title}\n${summary}`)) return 0;

        const tabs = ["friends", "associates", "romance", "family", "rivals"];
        let added = 0;
        for (const tab of tabs) {
            const list = Array.isArray(s?.social?.[tab]) ? s.social[tab] : [];
            for (const person of list) {
                const name = String(person?.name || "").trim();
                if (!name) continue;
                if (!lineMentionsName(`${title}\n${summary}`, name)) continue;
                if (!Array.isArray(person.memories)) person.memories = [];

                const text = normalizeMemoryLineForPerson(`${title}: ${summary}`, name);
                if (!text || isTrivialMemory(text)) continue;
                const key = text.toLowerCase().replace(/\s+/g, " ").trim();
                const exists = person.memories.some((m) => String(m?.text || "").toLowerCase().replace(/\s+/g, " ").trim() === key);
                if (exists) continue;

                person.memories.push({
                    id: newId("mem"),
                    t: Date.now(),
                    text: text.slice(0, 320),
                    impact: "Synced from Databank event",
                    tags: ["databank", "event-sync"],
                });
                added++;
            }
        }
        return added;
    } catch (_) {
        return 0;
    }
}

/**
 * Mirror every Social contact into the Databank as a tagged "Social — Name" entry so summaries and scans
 * can include character memories without re-reading the full chat.
 */
export function syncSocialContactsToDatabankMemories(opts = {}) {
    const silent = opts.silent === true;
    const s = getSettings();
    ensureDatabank(s);
    ensureSocial(s);
    const tabs = ["friends", "associates", "romance", "family", "rivals"];
    let touched = 0;
    const maxSummary = 1150;
    for (const tab of tabs) {
        for (const p of (s.social[tab] || [])) {
            const name = String(p?.name || "").trim();
            if (!name) continue;
            const title = `Social — ${name}`;
            const mems = Array.isArray(p.memories) ? [...p.memories] : [];
            mems.sort((a, b) => Number(b?.t || 0) - Number(a?.t || 0));
            const memLines = mems
                .slice(0, 8)
                .map((m) => String(m?.text || "").trim())
                .filter(Boolean);
            const aff = Math.round(Math.max(0, Math.min(100, Number(p?.affinity ?? 50))));
            const summaryRaw = memLines.length ?
                 `Relationship bucket: ${tab}. Affinity ~${aff}/100.\nCharacter memories:\n- ${memLines.join("\n- ")}`
                : `Relationship bucket: ${tab}. Affinity ~${aff}/100. (No granular memories yet.)`;
            const summary = summaryRaw.slice(0, maxSummary);
            const arr = s.databank || [];
            const idx = arr.findIndex((e) => String(e?.title || "").trim() === title);
            if (idx >= 0) {
                arr[idx].summary = summary;
                arr[idx].content = summary;
                const prevTags = Array.isArray(arr[idx].tags) ? arr[idx].tags : [];
                arr[idx].tags = Array.from(
                    new Set([...prevTags.map((t) => String(t || "").trim()).filter(Boolean), "social", "character-memory", tab]),
                );
                touched++;
            } else if (
                addDatabankEntryWithDedupe(
                    arr,
                    { title, summary, tags: ["social", "character-memory", tab] },
                    { now: Date.now(), makeId: () => newId("db") },
                )
            ) {
                touched++;
            }
        }
    }
    if (touched) saveSettings();
    try {
        render();
    } catch (_) {}
    if (!silent && touched) {
        try {
            window.toastr?.success?.(`Synced ${touched} social profile entr${touched === 1 ? "y" : "ies"} in Databank.`);
        } catch (_) {}
    }
    return touched;
}

function getSocialNameIndex(s) {
    ensureSocial(s);
    const byKey = new Map();
    for (const k of ["friends", "associates", "romance", "family", "rivals"]) {
        for (const p of (s.social[k] || [])) {
            const name = String(p?.name || "").trim();
            const key = normalizeNameKey(name);
            const id = String(p?.id || "").trim();
            if (!name || !key || !id) continue;
            if (!byKey.has(key)) byKey.set(key, { id, name, tab: k });
        }
    }
    const list = Array.from(byKey.values())
        .sort((a, b) => b.name.length - a.name.length)
        .slice(0, 180);
    return { byKey, list };
}

function extractMentionedSocialPeople(text, socialIndex) {
    const src = String(text || "");
    if (!src) return [];
    const list = Array.isArray(socialIndex?.list) ? socialIndex.list : [];
    if (!list.length) return [];
    const hits = [];
    for (const person of list) {
        if (hits.length >= 6) break;
        const name = String(person?.name || "").trim();
        if (!name) continue;
        const key = normalizeNameKey(name);
        if (!key) continue;
        const pattern = `\\b${escapeRegExp(key).replace(/\\\s+/g, "\\\\s+")}\\b`;
        try {
            if (!new RegExp(pattern, "i").test(src.toLowerCase())) continue;
        } catch (_) {
            if (!src.toLowerCase().includes(key)) continue;
        }
        hits.push(person);
    }
    return hits;
}

export function initDatabank() {
    const doc = $(document);
    if (!$("#uie-databank-window").length) {
        setTimeout(() => { try { initDatabank(); } catch (_) {} }, 120);
        return;
    }
    render();

    try { window.removeEventListener("uie:state_updated", window.__uieDatabankStateSync); } catch (_) {}
    try {
        window.__uieDatabankStateSync = () => {
            try {
                if (!$("#uie-databank-window").is(":visible")) return;
        const activeTab = String($(".uie-db-tab.active").data("tab") || "memories");
                if (activeTab === "nodes") {
                    try { renderNodes(); } catch (_) {}
                    return;
                }
                if (activeTab === "social") {
                    try { renderSocialProfiles(); } catch (_) {}
                    if ($("#uie-db-social-mem-overlay").is(":visible")) {
                        try { renderSocialMemoriesModal(); } catch (_) {}
                    }
                    return;
                }
                if (activeTab === "state") {
                    try { renderState(); } catch (_) {}
                    return;
                }
                dbLastListSig = "";
                try { render(); } catch (_) {}
            } catch (_) {}
        };
        window.addEventListener("uie:state_updated", window.__uieDatabankStateSync);
    } catch (_) {}

    $("body").off("click.uieDbHardClose pointerup.uieDbHardClose", "#uie-databank-close").on("click.uieDbHardClose pointerup.uieDbHardClose", "#uie-databank-close", function (e) {
        e.preventDefault();
        e.stopPropagation();
        try { $("#uie-db-social-mem-overlay").hide(); } catch (_) {}
        try { $("#uie-databank-window").hide(); } catch (_) {}
    });

    // Tab Switching
    doc.off("click", ".uie-db-tab").on("click", ".uie-db-tab", function() {
        $(".uie-db-tab").removeClass("active").css({ background: "transparent", color: "rgba(0,240,255,0.5)" });
        $(this).addClass("active").css({ background: "rgba(0,240,255,0.1)", color: "#00f0ff" });

        const tab = $(this).data("tab");
        $("#uie-db-view-memories").hide();
        $("#uie-db-view-state").hide();
        $("#uie-db-view-social").hide();

        if (tab === "memories") {
            $("#uie-db-view-memories").show();
            render();
            return;
        }
        if (tab === "social") {
            $("#uie-db-view-social").show();
            renderSocialProfiles();
            return;
        }
        $("#uie-db-view-state").show();
        renderState();
    });

    doc.off("click", "#uie-db-node-add").on("click", "#uie-db-node-add", function() {
        const s = getSettings();
        const nodes = normalizeDatabankNodes(s);
        const title = String($("#uie-db-node-title").val() || "").trim();
        if (!title) return;
        mergeDatabankNode(nodes, {
            title,
            type: String($("#uie-db-node-type").val() || "concept").trim(),
            body: String($("#uie-db-node-body").val() || "").trim() || "No details recorded yet.",
            edges: [],
            source: "manual"
        }, { now: Date.now(), source: "manual" });
        $("#uie-db-node-title,#uie-db-node-body").val("");
        saveSettings();
        renderNodes();
    });
    doc.off("click", ".uie-db-node-del").on("click", ".uie-db-node-del", function() {
        const id = String($(this).closest("[data-db-node-id]").attr("data-db-node-id") || "");
        const s = getSettings();
        normalizeDatabankNodes(s);
        s.databankNodes = s.databankNodes.filter((n) => String(n.id) !== id);
        saveSettings();
        renderNodes();
    });
    doc.off("click", "#uie-db-node-scan").on("click", "#uie-db-node-scan", async function() {
        const btn = $(this);
        const icon = btn.find("i");
        if (btn.data("busy") === "1") return;
        btn.data("busy", "1");
        btn.prop("disabled", true);
        icon.addClass("fa-spin");
        try {
            await scanDatabankNodesFromSources({ maxMessages: 100, silent: false });
        } finally {
            icon.removeClass("fa-spin");
            btn.prop("disabled", false);
            btn.data("busy", "0");
        }
    });
    doc.off("click", ".uie-db-node-cat").on("click", ".uie-db-node-cat", function(e) {
        e.preventDefault();
        dbNodeActiveCategory = String($(this).data("cat") || "all");
        renderNodes();
    });
    doc.off("input", "#uie-db-node-search").on("input", "#uie-db-node-search", function() {
        renderNodes();
    });

    // Databank Scan (Memories tab)
    doc.off("click", "#uie-db-scan").on("click", "#uie-db-scan", async function() {
        const btn = $(this);
        const icon = btn.find("i");
        if (btn.data("busy") === "1") return;
        btn.data("busy", "1");
        btn.prop("disabled", true);
        icon.addClass("fa-spin");
        try {
            await scanDatabankFromChat({ maxMessages: 80, silent: false });
        } finally {
            icon.removeClass("fa-spin");
            btn.prop("disabled", false);
            btn.data("busy", "0");
        }
    });

    doc.off("click", "#uie-db-scan-range").on("click", "#uie-db-scan-range", async function() {
        const btn = $(this);
        const icon = btn.find("i");
        if (btn.data("busy") === "1") return;
        const startRaw = String($("#uie-db-range-start").val() || "").trim();
        const endRaw = String($("#uie-db-range-end").val() || "").trim();
        const start = startRaw === "" ? 1 : Math.max(1, Math.floor(Number(startRaw) || 1));
        const end = endRaw === "" ? undefined : Math.max(1, Math.floor(Number(endRaw) || 1));
        if (end != null && end < start) {
            try { window.toastr?.info?.("'To' must be ≥ 'From'."); } catch (_) {}
            return;
        }
        btn.data("busy", "1");
        btn.prop("disabled", true);
        icon.addClass("fa-spin");
        try {
            await scanDatabankFromChat({ startMessage: start, endMessage: end, silent: false });
        } finally {
            icon.removeClass("fa-spin");
            btn.prop("disabled", false);
            btn.data("busy", "0");
        }
    });

    // State tab refresh (Databank-only, no full UIE Scan All)
    doc.off("click", "#uie-db-state-scan").on("click", "#uie-db-state-scan", async function() {
        const btn = $(this);
        const icon = btn.find("i");
        if (btn.data("busy") === "1") return;
        btn.data("busy", "1");
        btn.prop("disabled", true);
        icon.addClass("fa-spin");
        try {
            await scanDatabankFromChat({ maxMessages: 80, silent: true });
            try { renderState(); } catch (_) {}
            try { render(); } catch (_) {}
            try { window.toastr?.success?.("State refreshed."); } catch (_) {}
        } finally {
            icon.removeClass("fa-spin");
            btn.prop("disabled", false);
            btn.data("busy", "0");
        }
    });

    // Social tab quick scan button (adds/refreshes databank entries only)
    doc.off("click", "#uie-db-social-scan").on("click", "#uie-db-social-scan", async function () {
        const btn = $(this);
        const icon = btn.find("i");
        if (btn.data("busy") === "1") return;
        btn.data("busy", "1");
        btn.prop("disabled", true);
        icon.addClass("fa-spin");
        try {
            await scanDatabankFromChat({ maxMessages: 80, silent: false });
            try { renderSocialProfiles(); } catch (_) {}
        } finally {
            icon.removeClass("fa-spin");
            btn.prop("disabled", false);
            btn.data("busy", "0");
        }
    });
    doc.off("click", ".db-edit").on("click", ".db-edit", function() {
        const id = String($(this).data("id") || "");
        if (!id) return;
        const s = getSettings();
        ensureDatabank(s);
        const idx = (s.databank || []).findIndex(m => String(m?.id || "") === id);
        if (idx < 0) return;
        const entry = s.databank[idx] || {};
        const curTitle = String(entry?.title || entry?.key || "Entry").trim();
        const curSummary = String(entry?.summary || entry?.content || entry?.entry || "").trim();
        const nextTitleRaw = prompt("Edit memory title:", curTitle);
        if (nextTitleRaw === null) return;
        const nextSummaryRaw = prompt("Edit memory summary:", curSummary);
        if (nextSummaryRaw === null) return;
        const nextTagsRaw = prompt("Edit tags (comma-separated):", Array.isArray(entry?.tags) ? entry.tags.join(", ") : "");
        if (nextTagsRaw === null) return;

        const nextSummary = String(nextSummaryRaw || "").trim().slice(0, 1200);
        if (!nextSummary) {
            try { window.toastr?.info?.("Summary cannot be empty."); } catch (_) {}
            return;
        }

        entry.title = normalizeMemoryTitle(nextTitleRaw, nextSummary);
        entry.summary = nextSummary;
        entry.content = nextSummary;
        entry.tags = parseTagsInput(nextTagsRaw, entry?.tags);
        entry.created = Number(entry?.created || Date.now()) || Date.now();
        entry.date = entry?.date || new Date(Number(entry.created || Date.now())).toLocaleDateString();
        saveSettings();
        render();
    });

    // Delete Memory
    doc.off("click", ".db-delete").on("click", ".db-delete", async function() {
        if(await customConfirm("Delete this memory?")) {
            const id = String($(this).data("id") || "");
            const s = getSettings();
            s.databank = (s.databank || []).filter(m => String(m?.id || "") !== id);
            saveSettings(); render();
        }
    });

    doc.off("click.uieDbLoadMore").on("click.uieDbLoadMore", "#uie-db-load-more", function (e) {
        e.preventDefault();
        e.stopPropagation();
        dbRenderLimit = Math.min(600, dbRenderLimit + 60);
        render();
    });

    doc.off("input.uieDbSocialSearch").on("input.uieDbSocialSearch", "#uie-db-social-search", function () {
        renderSocialProfiles();
    });

    doc.off("click.uieDbSocialOpen").on("click.uieDbSocialOpen", ".uie-db-social-row", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const pid = String($(this).data("pid") || "");
        const tab = String($(this).data("ptab") || "").trim().toLowerCase();
        const name = String($(this).data("pname") || "").trim();
        if (!pid && !name) return;
        dbSocialActivePersonRef = { id: pid, tab, name };
        $("#uie-db-social-mem-overlay").css("display", "flex");
        renderSocialMemoriesModal();
    });

    doc.off("click.uieDbSocialLink").on("click.uieDbSocialLink", ".uie-db-social-link", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const pid = String($(this).data("pid") || "");
        const tab = String($(this).data("ptab") || "").trim().toLowerCase();
        const name = String($(this).data("pname") || "").trim();
        if (!pid && !name) return;
        dbSocialActivePersonRef = { id: pid, tab, name };
        $("#uie-db-social-mem-overlay").css("display", "flex");
        renderSocialMemoriesModal();
    });

    doc.off("click.uieDbSocialMemClose").on("click.uieDbSocialMemClose", "#uie-db-social-mem-close", function (e) {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-db-social-mem-overlay").hide();
    });
    doc.off("click.uieDbSocialMemBackdrop").on("click.uieDbSocialMemBackdrop", "#uie-db-social-mem-overlay", function (e) {
        if ($(e.target).closest("#uie-db-social-mem-overlay > div").length) return;
        $("#uie-db-social-mem-overlay").hide();
    });

    doc.off("click.uieDbSocialMemActions").on("click.uieDbSocialMemActions", "#uie-db-social-mem-scan, #uie-db-social-mem-add, #uie-db-social-mem-inject, #uie-db-social-mem-clear", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const { person } = getSocialPersonByRef();
        if (!person) return;

        if (this.id === "uie-db-social-mem-add") {
            const text = prompt("Add a vital memory (consequence-based):", "");
            if (text === null) return;
            const t = normalizeMemoryLineForPerson(text, person.name);
            if (!t) {
                try { window.toastr?.info?.("Memory text is empty or looks like meta content."); } catch (_) {}
                return;
            }
            const impact = prompt("Impact on the character (optional):", "") ?? "";
            const tagsRaw = prompt("Tags (comma-separated, optional):", "") ?? "";
            if (!Array.isArray(person.memories)) person.memories = [];

            const key = t.toLowerCase().replace(/\s+/g, " ").trim();
            const exists = person.memories.some((m) => String(m?.text || "").toLowerCase().replace(/\s+/g, " ").trim() === key);
            if (exists) {
                try { window.toastr?.info?.("That memory already exists for this character."); } catch (_) {}
                return;
            }

            person.memories.push({
                id: newId("mem"),
                t: Date.now(),
                text: t,
                impact: String(impact || "").trim().slice(0, 240),
                tags: parseTagsInput(tagsRaw, []).slice(0, 6),
            });
            refreshLinkedSocialState({ rerenderProfiles: true, rerenderModal: true });
            return;
        }

        if (this.id === "uie-db-social-mem-clear") {
            const ok = await customConfirm("Clear ALL memories for this character?");
            if (!ok) return;
            person.memories = [];
            refreshLinkedSocialState({ rerenderProfiles: true, rerenderModal: true });
            return;
        }

        if (this.id === "uie-db-social-mem-inject") {
            const block = buildMemoryBlock(person);
            if (!block) return;
            await injectRpEvent(block);
            try { window.toastr?.success?.("Injected memories into chat."); } catch (_) {}
            return;
        }

        if (this.id === "uie-db-social-mem-scan") {
            await scanMemoriesForPerson(person);
        }
    });

    doc.off("click.uieDbSocialMemDel").on("click.uieDbSocialMemDel", ".uie-db-social-mem-del", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const mid = String($(this).data("mid") || "");
        const { person } = getSocialPersonByRef();
        if (!person || !mid) return;
        person.memories = (Array.isArray(person.memories) ? person.memories : []).filter(m => String(m?.id || "") !== mid);
        refreshLinkedSocialState({ rerenderProfiles: true, rerenderModal: true });
    });

    doc.off("click.uieDbSocialMemEdit").on("click.uieDbSocialMemEdit", ".uie-db-social-mem-edit", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const mid = String($(this).data("mid") || "");
        const { person } = getSocialPersonByRef();
        if (!person || !mid) return;
        const mem = (Array.isArray(person.memories) ? person.memories : []).find((m) => String(m?.id || "") === mid);
        if (!mem) return;

        const nextTextRaw = prompt("Edit memory text:", String(mem?.text || ""));
        if (nextTextRaw === null) return;
        const nextImpactRaw = prompt("Edit impact (optional):", String(mem?.impact || ""));
        if (nextImpactRaw === null) return;
        const nextTagsRaw = prompt("Edit tags (comma-separated):", Array.isArray(mem?.tags) ? mem.tags.join(", ") : "");
        if (nextTagsRaw === null) return;

        const nextText = normalizeMemoryLineForPerson(nextTextRaw, person.name);
        if (!nextText) {
            try { window.toastr?.info?.("Memory text is empty or looks like meta content."); } catch (_) {}
            return;
        }

        mem.text = nextText;
        mem.impact = String(nextImpactRaw || "").trim().slice(0, 240);
        mem.tags = parseTagsInput(nextTagsRaw, mem?.tags).slice(0, 6);
        mem.t = Date.now();
        refreshLinkedSocialState({ rerenderProfiles: true, rerenderModal: true });
    });
}

function getSocialPersonByRef(ref = dbSocialActivePersonRef) {
    const s = getSettings();
    ensureSocial(s);
    const tabs = ["friends", "associates", "romance", "family", "rivals"];

    const pid = String(ref?.id || ref?.pid || "").trim();
    const tabHint = String(ref?.tab || ref?.ptab || "").trim().toLowerCase();
    const nameHint = String(ref?.name || ref?.pname || "").trim();
    const nameKey = normalizeNameKey(nameHint);

    let person = null;
    let foundTab = "";
    let foundIdx = -1;

    if (pid) {
        for (const k of tabs) {
            const idx = (s.social[k] || []).findIndex((p) => String(p?.id || "") === pid);
            if (idx >= 0) {
                person = s.social[k][idx];
                foundTab = k;
                foundIdx = idx;
                break;
            }
        }
    }

    if (!person && tabHint && nameKey && tabs.includes(tabHint)) {
        const idx = (s.social[tabHint] || []).findIndex((p) => normalizeNameKey(p?.name || "") === nameKey);
        if (idx >= 0) {
            person = s.social[tabHint][idx];
            foundTab = tabHint;
            foundIdx = idx;
        }
    }

    if (!person && nameKey) {
        for (const k of tabs) {
            const idx = (s.social[k] || []).findIndex((p) => normalizeNameKey(p?.name || "") === nameKey);
            if (idx >= 0) {
                person = s.social[k][idx];
                foundTab = k;
                foundIdx = idx;
                break;
            }
        }
    }

    if (!person) return { s, person: null, tab: "", index: -1 };

    if (!person.id) person.id = newId("person");
    if (!Array.isArray(person.memories)) person.memories = [];

    dbSocialActivePersonRef = {
        id: String(person.id || ""),
        tab: String(foundTab || tabHint || ""),
        name: String(person.name || nameHint || ""),
    };

    return { s, person, tab: foundTab, index: foundIdx };
}

function getSocialPersonById(personId) {
    return getSocialPersonByRef({ id: personId });
}

function isTrivialMemory(s) {
    const t = String(s || "").toLowerCase();
    if (!t) return true;
    if (t.length < 24) return true;
    const bad = /(said hi|said hello|walked in|greeted|small talk|chatted|talked a bit|they talked|made conversation|smiled and|laughed and)/i;
    return bad.test(t);
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

function renderSocialMemoriesModal() {
    const { person } = getSocialPersonByRef();
    if (!person) {
        $("#uie-db-social-mem-sub").text("No character selected");
        $("#uie-db-social-mem-list").empty();
        $("#uie-db-social-mem-empty").show();
        return;
    }
    const ctx = getContext ? getContext() : {};
    const user = String(ctx?.name1 || "User");
    $("#uie-db-social-mem-sub").text(`${person.name} ↔ ${user}`);

    const list = $("#uie-db-social-mem-list").empty();
    const mems = Array.isArray(person.memories) ? person.memories.slice() : [];
    mems.sort((a, b) => Number(b?.t || 0) - Number(a?.t || 0));
    if (!mems.length) {
        $("#uie-db-social-mem-empty").show();
        return;
    }
    $("#uie-db-social-mem-empty").hide();
    for (const mem of mems) {
        const id = String(mem?.id || "");
        const text = String(mem?.text || "").trim();
        const impact = String(mem?.impact || "").trim();
        const tags = Array.isArray(mem?.tags) ? mem.tags.map(t => String(t || "").trim()).filter(Boolean).slice(0, 6) : [];
        const tagHtml = tags.length ? `<div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">${tags.map(t => `<span style="font-size:10px; padding:2px 8px; border-radius:999px; background:rgba(0,240,255,0.08); border:1px solid rgba(0,240,255,0.2); color:#00f0ff; font-weight:900;">${esc(t)}</span>`).join("")}</div>` : "";
        list.append(`
            <div style="background:rgba(0, 240, 255, 0.05); border:1px solid rgba(0,240,255,0.22); border-radius:4px; padding:10px; position:relative; margin-bottom:10px;">
                <div style="font-weight:900; color:#fff; font-size:13px; line-height:1.35;">${esc(text)}</div>
                ${impact ? `<div style="margin-top:6px; font-size:12px; color:rgba(255,255,255,0.75);"><strong style="color:rgba(0,240,255,0.9);">Impact:</strong> ${esc(impact)}</div>` : ""}
                ${tagHtml}
                <i class="fa-solid fa-pen-to-square uie-db-social-mem-edit" data-mid="${esc(id)}" style="position:absolute; top:10px; right:32px; color:#7dd3ff; cursor:pointer; font-size:12px; opacity:0.9;"></i>
                <i class="fa-solid fa-trash uie-db-social-mem-del" data-mid="${esc(id)}" style="position:absolute; top:10px; right:10px; color:#ff3b30; cursor:pointer; font-size:12px; opacity:0.85;"></i>
            </div>
        `);
    }
}

function renderSocialProfiles() {
    const s = getSettings();
    ensureSocial(s);
    const q = String($("#uie-db-social-search").val() || "").trim().toLowerCase();
    const list = document.getElementById("uie-db-social-list");
    if (!list) return;
    list.innerHTML = "";

    const rows = [];
    for (const k of ["friends", "associates", "romance", "family", "rivals"]) {
        for (const p of (s.social[k] || [])) {
            const name = String(p?.name || "").trim();
            if (!name) continue;
            if (q && !name.toLowerCase().includes(q)) continue;
            rows.push({ k, p, name });
        }
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    if (!rows.length) {
        list.innerHTML = '<div style="text-align:center; color:rgba(0,240,255,0.55); margin-top:30px;">NO PROFILES FOUND</div>';
        return;
    }

    const tmpl = document.getElementById("uie-template-db-social-row");

    const frag = document.createDocumentFragment();
    for (const row of rows) {
        const memCount = Array.isArray(row.p?.memories) ? row.p.memories.length : 0;
        if (tmpl && tmpl.content) {
            const clone = tmpl.content.cloneNode(true);
            const el = clone.querySelector(".uie-db-social-row");
            const nameEl = clone.querySelector(".social-name");
            const relEl = clone.querySelector(".social-rel");
            const countEl = clone.querySelector(".social-count");
            if (!el || !nameEl || !relEl || !countEl) continue;

            el.dataset.pid = String(row.p.id || "");
            el.dataset.ptab = String(row.k || "");
            el.dataset.pname = String(row.name || "");
            nameEl.textContent = row.name;
            relEl.textContent = row.k.toUpperCase();
            countEl.textContent = `${memCount} mem`;
            frag.appendChild(clone);
            continue;
        }

        const el = document.createElement("div");
        el.className = "uie-db-social-row";
        el.dataset.pid = String(row.p.id || "");
        el.dataset.ptab = String(row.k || "");
        el.dataset.pname = String(row.name || "");
        el.style.cssText = "display:flex;align-items:center;gap:10px;background:rgba(0,240,255,0.05);border:1px solid rgba(0,240,255,0.24);border-radius:8px;padding:10px 12px;cursor:pointer;margin-bottom:8px;";
        el.innerHTML = `
            <div class="social-name" style="font-weight:900;color:#fff;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(row.name)}</div>
            <div class="social-rel" style="font-size:10px;color:rgba(0,240,255,0.8);border:1px solid rgba(0,240,255,0.25);padding:2px 8px;border-radius:999px;letter-spacing:0.6px;">${esc(row.k.toUpperCase())}</div>
            <div class="social-count" style="font-size:11px;color:rgba(255,255,255,0.7);">${memCount} mem</div>
        `;
        frag.appendChild(el);
    }
    list.appendChild(frag);
}

async function scanMemoriesForPerson(person) {
    const ctx = getContext ? getContext() : {};
    const user = String(ctx?.name1 || "User");
    const transcript = (() => {
        const out = [];
        try {
            const nodes = Array.from(document.querySelectorAll("#chat .mes")).slice(-90);
            for (const m of nodes) {
                const name =
                    m.querySelector(".mes_name")?.textContent ||
                    m.querySelector(".name_text")?.textContent ||
                    m.querySelector(".name")?.textContent ||
                    "";
                const text =
                    m.querySelector(".mes_text")?.textContent ||
                    m.querySelector(".message")?.textContent ||
                    "";
                const nm = String(name || "").trim() || "Unknown";
                const tx = String(text || "").trim();
                if (!tx) continue;
                out.push(`${nm}: ${tx}`);
            }
        } catch (_) {}
        return out.join("\n").slice(-20000);
    })();
    if (!transcript) return;

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
    let obj = null;
    try { obj = JSON.parse(String(res).replace(/```json|```/g, "").trim()); } catch (_) { obj = null; }
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
    refreshLinkedSocialState({ rerenderProfiles: true, rerenderModal: true });
    try { window.toastr?.success?.(added ? `Added ${added} memory${added === 1 ? "" : "ies"}.` : "No new vital memories found."); } catch (_) {}
}

function render() {
    try { ensureChatStateLoaded(); } catch (_) {}
    const s = getSettings();
    ensureDatabank(s);
    ensureSocial(s);
    const list = $("#uie-db-list");
    if (!list.length) {
        setTimeout(() => { try { render(); } catch (_) {} }, 160);
        return;
    }
    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    const entries = toDatabankDisplayEntries(s.databank || []);
    const socialIndex = getSocialNameIndex(s);
    const meta = $("#uie-db-meta");
    const sig = buildDatabankRenderSignature(entries, socialIndex);
    if (sig === dbLastListSig && list.children().length) {
        try {
            const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
            window.UIE_lastDatabankRenderMs = Math.max(0, (t1 - t0));
        } catch (_) {}
        return;
    }
    dbLastListSig = sig;
    list.empty();

    if (meta.length) {
        const nChat = getChatMessageCount();
        meta.text(
            `${entries.length} ${entries.length === 1 ? "entry" : "entries"} saved · ${nChat} chat message(s) (use 1–${Math.max(1, nChat)} for range archive)`,
        );
    }

    if (entries.length === 0) {
        list.html('<div style="text-align:center; color:#00f0ff; opacity:0.55; margin-top:50px;">NO MEMORIES FOUND IN THIS CHAT</div>');
        return;
    }

    const shown = entries.slice(-1 * Math.max(1, Math.min(dbRenderLimit, entries.length))).reverse();
    const html = [];
    for (const m of shown) {
        const title = String(m?.title || "Entry").trim() || "Entry";
        const body = String(m?.body || "").trim();
        const date = String(m?.date || "").trim();
        const tag = m?.type === "lore" ? "LORE" : "MEMORY";
        const mentionedPeople = extractMentionedSocialPeople(`${title}\n${body}`, socialIndex);
        const mentionHtml = mentionedPeople.length ?
             `<div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">${mentionedPeople.map((p) => `<span class="uie-db-social-link" data-pid="${esc(String(p.id || ""))}" data-ptab="${esc(String(p.tab || ""))}" data-pname="${esc(String(p.name || ""))}" style="font-size:10px; color:#9ff; border:1px solid rgba(0,240,255,0.28); background:rgba(0,240,255,0.08); border-radius:999px; padding:2px 8px; cursor:pointer;">${esc(p.name)}</span>`).join("")}</div>`
            : "";
        html.push(`
            <div style="background:rgba(0, 240, 255, 0.05); border:1px solid rgba(0,240,255,0.3); border-radius:6px; padding:12px; position:relative; margin-bottom:10px;">
                <div style="display:flex; align-items:flex-start; gap:8px;">
                    <div style="flex:1; min-width:0; font-weight:bold; color:#00f0ff; font-size:14px; margin-bottom:6px; letter-spacing:1px; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(title)}</div>
                    <div style="display:flex; align-items:center; gap:8px; margin-left:auto; flex:0 0 auto;">
                        <span style="font-size:10px; color:rgba(0,240,255,0.75); border:1px solid rgba(0,240,255,0.25); padding:2px 6px; border-radius:999px; letter-spacing:1px;">${esc(tag)}</span>
                        <span style="color:rgba(0,240,255,0.5); font-size:10px; white-space:nowrap;">${esc(date)}</span>
                    </div>
                </div>
                <div style="font-size:12px; color:rgba(255,255,255,0.88); line-height:1.45; white-space:pre-wrap; word-break:break-word;">${esc(body || "(empty)")}</div>
                ${mentionHtml}
                <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px;">
                    <button type="button" class="db-edit" data-id="${esc(String(m.id || ""))}" style="background:rgba(125,211,255,.10); border:1px solid rgba(125,211,255,.35); color:#7dd3ff; cursor:pointer; font-size:11px; font-weight:900; padding:5px 8px; border-radius:6px;"><i class="fa-solid fa-pen-to-square"></i> EDIT</button>
                    <button type="button" class="db-delete" data-id="${esc(String(m.id || ""))}" style="background:rgba(255,59,48,.10); border:1px solid rgba(255,59,48,.35); color:#ff6b61; cursor:pointer; font-size:11px; font-weight:900; padding:5px 8px; border-radius:6px;"><i class="fa-solid fa-trash"></i> DELETE</button>
                </div>
            </div>
        `);
    }
    if (entries.length > shown.length) {
        html.push(`<button id="uie-db-load-more" style="width:100%; margin:10px 0 2px; background:rgba(0,240,255,0.10); border:1px solid rgba(0,240,255,0.35); color:#00f0ff; padding:10px 12px; cursor:pointer; font-weight:900; font-size:12px; border-radius:10px;">LOAD MORE</button>`);
    }
    list.html(html.join(""));
    try {
        const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        window.UIE_lastDatabankRenderMs = Math.max(0, (t1 - t0));
    } catch (_) {}
}

function renderNodes() {
    const nodes = normalizeDatabankNodes(getSettings());
    const list = $("#uie-db-node-list");
    if (!list.length) return;
    const counts = new Map();
    for (const n of nodes) counts.set(n.type, (counts.get(n.type) || 0) + 1);
    const catWrap = $("#uie-db-node-cats");
    if (catWrap.length) {
        catWrap.html(DATABANK_NODE_CATEGORIES.map((cat) => {
            const active = dbNodeActiveCategory === cat.id;
            const count = cat.id === "all" ? nodes.length : (counts.get(cat.id) || 0);
            return `<button type="button" class="uie-db-node-cat" data-cat="${esc(cat.id)}" style="flex:0 0 auto; padding:6px 9px; border-radius:999px; cursor:pointer; font-size:10px; font-weight:900; letter-spacing:.5px; border:1px solid ${active ? "#00f0ff" : "rgba(0,240,255,.24)"}; color:${active ? "#001018" : "rgba(0,240,255,.8)"}; background:${active ? "#00f0ff" : "rgba(0,240,255,.06)"};">${esc(cat.label)} ${count}</button>`;
        }).join(""));
    }

    if (!nodes.length) {
        list.html(`<div style="padding:24px;text-align:center;color:rgba(0,240,255,.55);">NO WORLD DATA NODES YET</div>`);
        return;
    }
    const q = String($("#uie-db-node-search").val() || "").trim().toLowerCase();
    const filtered = nodes.filter((n) => {
        if (dbNodeActiveCategory !== "all" && normalizeDatabankNodeType(n?.type) !== dbNodeActiveCategory) return false;
        if (!q) return true;
        const hay = `${n?.title || ""}\n${n?.type || ""}\n${n?.body || ""}\n${Array.isArray(n?.edges) ? n.edges.join(" ") : ""}`.toLowerCase();
        return hay.includes(q);
    }).sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0));

    if (!filtered.length) {
        list.html(`<div style="padding:24px;text-align:center;color:rgba(0,240,255,.55);">NO MATCHING WORLD DATA NODES</div>`);
        return;
    }

    list.html(filtered.map((n) => {
        const edges = Array.isArray(n.edges) ? n.edges.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8) : [];
        const sources = Array.from(new Set([n.source, ...(Array.isArray(n.sources) ? n.sources : [])].map((x) => String(x || "").trim()).filter(Boolean))).slice(0, 4);
        const edgeHtml = edges.length ? `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:4px;">${edges.map((x) => `<span style="font-size:10px; color:#bdf8ff; border:1px solid rgba(0,240,255,.2); background:rgba(0,240,255,.06); padding:2px 7px; border-radius:999px;">${esc(x)}</span>`).join("")}</div>` : "";
        const sourceHtml = sources.length ? `<div style="font-size:10px; color:rgba(0,240,255,.58); text-transform:uppercase; letter-spacing:.5px;">${esc(sources.join(" / "))}</div>` : "";
        return `
        <div data-db-node-id="${esc(n.id)}" style="padding:10px; margin-bottom:8px; border:1px solid rgba(0,240,255,.25); background:rgba(0,240,255,.05); display:grid; gap:6px;">
            <div style="display:flex; gap:8px; align-items:center;">
                <strong style="color:#d9fbff; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(n.title)}</strong>
                <span style="font-size:10px; color:rgba(0,240,255,.72); border:1px solid rgba(0,240,255,.25); padding:2px 6px;">${esc(n.type)}</span>
                <button type="button" class="uie-db-node-del" style="margin-left:auto; background:rgba(255,59,48,.1); border:1px solid rgba(255,59,48,.35); color:#ff6b61; cursor:pointer;">DEL</button>
            </div>
            ${sourceHtml}
            <div style="white-space:pre-wrap; color:rgba(220,250,255,.8); font-size:12px;">${esc(n.body || "No body.")}</div>
            ${edgeHtml}
        </div>
    `;
    }).join(""));
}

function renderState() {
    const container = document.getElementById("uie-db-state-content");
    if (!container) return;
    container.innerHTML = "";

    let state = null;
    try {
        state = getWorldState();
    } catch (e) {
        container.innerHTML = `<div style="text-align:center; margin-top:50px; color:rgba(0,240,255,0.5); font-style:italic;">WORLD STATE ERROR<br><small>Check console for details.</small></div>`;
        try { console.warn("[UIE] getWorldState() failed:", e); } catch (_) {}
        return;
    }

    if (!state || Object.keys(state).length === 0) {
        container.innerHTML = `<div style="text-align:center; margin-top:50px; color:rgba(0,240,255,0.5); font-style:italic;">NO WORLD STATE DATA<br><small>Start chatting to generate state.</small></div>`;
        return;
    }

    // World state contains both player-facing facts and engine structures. Render
    // nested values as concise summaries so the UI never leaks "[object Object]".
    const displayStateValue = (value, depth = 0) => {
        if (value === null || value === undefined || value === "") return "—";
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
        if (Array.isArray(value)) {
            if (!value.length) return "None";
            const items = value.slice(0, 4).map((item) => displayStateValue(item, depth + 1));
            return `${items.join(", ")}${value.length > 4 ? ` +${value.length - 4} more` : ""}`;
        }
        if (typeof value === "object") {
            const entries = Object.entries(value).filter(([, v]) => v !== null && v !== undefined && v !== "");
            if (!entries.length) return "None";
            if (depth > 2) return `${entries.length} detail${entries.length === 1 ? "" : "s"}`;
            return entries.slice(0, 4).map(([key, val]) => `${String(key).replace(/([A-Z])/g, " $1")}: ${displayStateValue(val, depth + 1)}`).join(" · ") + (entries.length > 4 ? ` · +${entries.length - 4} more` : "");
        }
        return String(value);
    };
    const displayStateKey = (key) => String(key || "")
        .replace(/([A-Z])/g, " $1").replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()).trim();

    // Status Block
    const tmplStatus = document.getElementById("uie-template-db-state-status");
    const tmplRow = document.getElementById("uie-template-db-state-row");

    if (!(tmplStatus && tmplRow)) {
        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "10px";

        const makeGrid = () => {
            const grid = document.createElement("div");
            grid.style.display = "grid";
            grid.style.gridTemplateColumns = "minmax(120px, 0.9fr) 1.1fr";
            grid.style.gap = "6px 10px";
            grid.style.background = "rgba(0,240,255,0.05)";
            grid.style.border = "1px solid rgba(0,240,255,0.25)";
            grid.style.borderRadius = "10px";
            grid.style.padding = "10px";
            return grid;
        };

        const grid = makeGrid();
        for (const [k, v] of Object.entries(state)) {
            if (k === "custom") continue;
            const keyEl = document.createElement("div");
            keyEl.style.color = "rgba(0,240,255,0.9)";
            keyEl.style.fontWeight = "900";
            keyEl.style.letterSpacing = "0.4px";
            keyEl.style.wordBreak = "break-word";
            keyEl.textContent = displayStateKey(k);

            const valEl = document.createElement("div");
            valEl.style.color = "rgba(255,255,255,0.88)";
            valEl.style.wordBreak = "break-word";
            valEl.textContent = displayStateValue(v);

            grid.appendChild(keyEl);
            grid.appendChild(valEl);
        }
        wrap.appendChild(grid);

        if (state.custom && Object.keys(state.custom).length > 0) {
            const grid2 = makeGrid();
            for (const [k, v] of Object.entries(state.custom)) {
                const keyEl = document.createElement("div");
                keyEl.style.color = "rgba(0,240,255,0.9)";
                keyEl.style.fontWeight = "900";
                keyEl.style.letterSpacing = "0.4px";
                keyEl.style.wordBreak = "break-word";
                keyEl.textContent = displayStateKey(k);

                const valEl = document.createElement("div");
                valEl.style.color = "rgba(255,255,255,0.88)";
                valEl.style.wordBreak = "break-word";
                valEl.textContent = displayStateValue(v);

                grid2.appendChild(keyEl);
                grid2.appendChild(valEl);
            }
            wrap.appendChild(grid2);
        }

        container.appendChild(wrap);
        return;
    }

    if (tmplStatus && tmplRow) {
        const cloneStatus = tmplStatus.content.cloneNode(true);
        const grid = cloneStatus.querySelector(".db-state-grid");
        
        Object.entries(state).forEach(([k, v]) => {
            if (k === "custom") return;
            const cloneRow = tmplRow.content.cloneNode(true);
            const keyEl = cloneRow.querySelector(".db-state-key");
            const valEl = cloneRow.querySelector(".db-state-val");
            keyEl.textContent = displayStateKey(k);
            valEl.textContent = displayStateValue(v);
            grid.appendChild(cloneRow);
        });
        
        container.appendChild(cloneStatus);
    }

    // Custom Block
    if (state.custom && Object.keys(state.custom).length > 0) {
        const tmplCustom = document.getElementById("uie-template-db-state-custom");
        const tmplCustomRow = document.getElementById("uie-template-db-state-custom-row");
        
        if (tmplCustom && tmplCustomRow) {
            const cloneCustom = tmplCustom.content.cloneNode(true);
            const grid = cloneCustom.querySelector(".db-custom-grid");
            
            Object.entries(state.custom).forEach(([k, v]) => {
                const cloneRow = tmplCustomRow.content.cloneNode(true);
                const keyEl = cloneRow.querySelector(".db-custom-key");
                const valEl = cloneRow.querySelector(".db-custom-val");
                keyEl.textContent = displayStateKey(k);
                valEl.textContent = displayStateValue(v);
                grid.appendChild(cloneRow);
            });
            
            container.appendChild(cloneCustom);
        }
    }
}

// Export for other modules to read history
export function getFullHistoryContext() {
    try { ensureChatStateLoaded(); } catch (_) {}
    const s = getSettings();
    if(!s.databank || s.databank.length === 0) return "";
    ensureDatabank(s);
    const lines = (s.databank || [])
        .map(m => String(m?.summary || m?.content || m?.entry || "").trim())
        .filter(Boolean)
        .slice(-80);
    if (!lines.length) return "";
    return "PAST EVENTS:\n" + lines.map(x => `- ${x}`).join("\n");
}
