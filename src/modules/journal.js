import { getSettings, saveSettings } from "./core.js";
import { generateContent } from "./apiClient.js";
import { notify } from "./notifications.js";
import { injectRpEvent } from "./features/rp_log.js";

let currentTab = "active";
let bound = false;
let chatObserver = null;
let lastSeenHash = "";
const JOURNAL_KEYS = ["active", "pending", "abandoned", "completed"];
const JOURNAL_THEMES = ["map", "datapad", "board"];

function esc(s) {
    return String(s ?? "")
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;")
        .replace(/"/g,"&quot;")
        .replace(/'/g,"&#39;");
}

function simpleHash(str) {
    let h = 0;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return String(h);
}

function ensureJournal(s) {
    if (!s || typeof s !== "object") return;
    if (!s.journal || typeof s.journal !== "object") s.journal = {};
    for (const k of JOURNAL_KEYS) {
        if (!Array.isArray(s.journal[k])) s.journal[k] = [];
    }
    if (!Array.isArray(s.journal.codex)) s.journal.codex = [];
    if (!JOURNAL_THEMES.includes(String(s.journal.theme || ""))) s.journal.theme = "map";
}

function questKey(q) {
    const title = String(q?.title || "").trim().toLowerCase();
    const desc = String(q?.desc || q?.description || "").trim().toLowerCase();
    return `${title}::${desc}`;
}

function questExists(s, q) {
    const key = questKey(q);
    if (!key || key === "::") return false;
    for (const k of JOURNAL_KEYS) {
        if (!Array.isArray(s?.journal?.[k])) continue;
        if (s.journal[k].some((it) => questKey(it) === key)) return true;
    }
    return false;
}

function normalizeQuest(q) {
    const title = String(q?.title || q?.name || q?.quest || "").trim().slice(0, 80);
    const desc = String(q?.desc || q?.description || q?.details || q?.objective || q?.summary || "").trim().slice(0, 700);
    if (!title && !desc) return null;
    return { title: title || "Quest", desc };
}

function extractQuestPayloads(text) {
    const out = [];
    const t = String(text || "");

    const tagRe = /```(?:uie_journal|uie_quests|json)?\s*([\s\S]*?)```/gi;
    let m;
    while ((m = tagRe.exec(t))) {
        out.push(m[1]);
    }

    const xmlRe = /<uie_journal[^>]*>([\s\S]*?)<\/uie_journal>/gi;
    while ((m = xmlRe.exec(t))) {
        out.push(m[1]);
    }

    // Fallback: try parsing any JSON object containing "quests"
    if (!out.length) {
        const start = t.indexOf("{");
        const end = t.lastIndexOf("}");
        if (start !== -1 && end !== -1 && end > start) out.push(t.slice(start, end + 1));
    }

    return out;
}

function ingestQuestsFromChatText(text, opts = {}) {
    const silent = opts.silent === true;
    const s = getSettings();
    if (!s) return 0;
    ensureJournal(s);

    const payloads = extractQuestPayloads(text);
    let added = 0;

    for (const raw of payloads) {
        const cleaned = String(raw || "").replace(/```json|```/g, "").trim();
        let data = null;
        try { data = JSON.parse(cleaned); } catch (_) { continue; }

        const quests = Array.isArray(data)
            ? data
            : (
                Array.isArray(data?.quests) ? data.quests
                : Array.isArray(data?.questOptions) ? data.questOptions
                : Array.isArray(data?.options) ? data.options
                : Array.isArray(data?.new) ? data.new
                : Array.isArray(data?.pending) ? data.pending
                : null
            );
        if (!quests) continue;

        for (const q of quests) {
            const nq = normalizeQuest(q);
            if (!nq) continue;
            if (questExists(s, nq)) continue;

            s.journal.pending.push({ ...nq, status: "pending", source: "chat", ts: Date.now() });
            added++;
        }
    }

    if (added) {
        saveSettings();
        if (!silent) {
            notify("success", `New Quest Suggestions: ${added}`, "Journal", "questsAccepted");
        }
    }
    return added;
}

/** Walk recent #chat RP lines and pick up ```json``` / UIE journal quest blocks (e.g. after Scan chat log). */
export function rescanJournalFromChatDom(maxMessages = 200, opts = {}) {
    const silent = opts.silent === true;
    const chat = document.getElementById("chat");
    if (!chat) return 0;
    const nodes = Array.from(chat.querySelectorAll(".mes .mes_text, .mes_text.chat-msg-txt"));
    const slice = nodes.length > maxMessages ? nodes.slice(-maxMessages) : nodes;
    let total = 0;
    for (const el of slice) {
        const txt = String(el.textContent || "").trim();
        if (txt.length < 8) continue;
        total += ingestQuestsFromChatText(txt, { silent: true });
    }
    if (total && !silent) {
        notify("success", `Journal: ${total} quest hint(s) from chat`, "Journal", "questsAccepted");
    }
    if (total) {
        try {
            renderJournal();
        } catch (_) {}
    }
    return total;
}

function startChatIngest() {
    if (window.UIE_journal_chatObserver) return;
    const chatEl = document.querySelector("#chat");
    if (!chatEl) return;

    chatObserver = new MutationObserver(() => {
        if (!window.UIE_bootFinished) return;
        const last = $(".chat-msg-txt").last();
        if (!last.length) return;
        const txt = last.text() || "";
        const h = simpleHash(txt);
        if (h === lastSeenHash) return;
        lastSeenHash = h;
        ingestQuestsFromChatText(txt);
        const s = getSettings();
        
        // Auto-Codex
            if (s?.features?.codexAutoExtract === true) {
                 if (Math.random() < 0.1) extractCodexFromChat();
            }
            
            // Auto-Quests
            if (!window.UIE_questDebounce) {
                 window.UIE_questDebounce = setTimeout(() => {
                     autoUpdateQuests();
                     window.UIE_questDebounce = null;
                 }, 20000); 
            }
    });
    chatObserver.observe(chatEl, { childList: true, subtree: true });
    window.UIE_journal_chatObserver = chatObserver;
}

async function autoUpdateQuests() {
    if (!window.UIE_bootFinished) return;
    const s = getSettings();
    if (s?.ai?.journalQuestGen === false) return;
    ensureJournal(s);

    // Debounce check (global)
    if (window.UIE_questAutoRunning) return;
    window.UIE_questAutoRunning = true;
    
    try {
        let raw = "";
        $(".chat-msg-txt").slice(-15).each(function() { raw += $(this).text() + "\n"; });
        if (!raw.trim()) return;

        const active = (s.journal.active || []).map(q => String(q.title).slice(0, 60));
        const pending = (s.journal.pending || []).map(q => String(q.title).slice(0, 60));

        const prompt = `
Context: RPG/Story.
Recent Chat:
${raw.slice(0, 2500)}

Active Quests:
${active.map(x => "- " + x).join("\n") || "(none)"}

Pending Quests:
${pending.map(x => "- " + x).join("\n") || "(none)"}

Task: Suggest NEW quest options only.
Do NOT move/update existing quests. Do NOT output accepted/completed/failed.
Return many options when possible.
Return JSON ONLY:
{
  "new": [{"title":"Short Title","desc":"Objective"}]
}
`;
        const res = await generateContent(prompt, "Quest Update");
        if (!res) return;

        let data;
        try { data = JSON.parse(String(res).replace(/```json|```/g, "").trim()); } catch(_) { return; }

        let changed = false;

        const incoming = Array.isArray(data?.new) ?
             data.new
            : (Array.isArray(data?.quests) ? data.quests : (Array.isArray(data) ? data : []));
        for (const n of incoming.slice(0, 8)) {
            const nq = normalizeQuest(n);
            if (!nq) continue;
            if (questExists(s, nq)) continue;
            s.journal.pending.push({ ...nq, status: "pending", source: "auto", ts: Date.now() });
            notify("info", `New Quest Option: ${nq.title}`, "Journal");
            changed = true;
        }

        if (changed) {
            saveSettings();
            renderJournal();
        }

    } catch(e) {
        console.error("AutoQuest Error:", e);
    } finally {
        window.UIE_questAutoRunning = false;
    }
}

export function renderJournal() {
    if (!bound) initJournal();
    const s = getSettings();
    ensureJournal(s);
    ensureCodex(s);
    document.getElementById("uie-journal-window")?.setAttribute("data-theme", s.journal.theme || "map");
    
    const counts = {
        active: (s.journal.active || []).length,
        pending: (s.journal.pending || []).length,
        abandoned: (s.journal.abandoned || []).length,
        completed: (s.journal.completed || []).length,
        codex: (s.journal?.codex || []).length,
        databank: (s.databank || []).length
    };

    $("#uie-journal-counts").text(`Active ${counts.active} • Pending ${counts.pending} • Abandoned ${counts.abandoned} • Completed ${counts.completed} • Codex ${counts.codex}`);

    const titles = { active: "Active", pending: "Pending", codex: "Codex", battles: "Battle History", abandoned: "Abandoned", completed: "Completed", databank: "Databank", state: "World State" };
    $("#uie-journal-tab-title").text(titles[currentTab] || "Journal");

    const host = $("#uie-journal-list");
    const container = host.length ? host : $("#uie-journal-content");
    container.empty();

    const search = String($("#uie-journal-search").val() || "").trim().toLowerCase();

    // CODEX: JOURNAL LORE ENCYCLOPEDIA
    if (currentTab === "codex") {
        const autoActive = s.features?.codexAutoExtract === true;
        const autoColor = autoActive ? "#2ecc71" : "rgba(255,255,255,0.14)";
        const autoText = autoActive ? "Auto: ON" : "Auto: OFF";
        const autoBg = autoActive ? "rgba(46,204,113,0.2)" : "rgba(0,0,0,0.25)";
        
        const battleCount = (s.journal.codex || []).filter(e => String(e?.category || "").toLowerCase() === "battles").length;

        container.append(`
            <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
                <button id="uie-codex-add" style="height:30px; padding:0 10px; border-radius:10px; border:none; background:#2ecc71; color:#000; font-weight:900; cursor:pointer; font-size:0.85em;">New Entry</button>
                <button id="uie-codex-extract-desc" style="height:30px; padding:0 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.14); background:rgba(0,0,0,0.25); color:#fff; font-weight:900; cursor:pointer; font-size:0.85em;">Generate From Description</button>
                <button id="uie-codex-extract-chat" style="height:30px; padding:0 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.14); background:rgba(0,0,0,0.25); color:#fff; font-weight:900; cursor:pointer; font-size:0.85em;">Extract Lore From Chat</button>
                <button id="uie-codex-filter-battles" style="height:30px; padding:0 10px; border-radius:10px; border:1px solid rgba(220,20,60,0.4); background:rgba(220,20,60,0.15); color:#ff6b81; font-weight:900; cursor:pointer; font-size:0.85em;">Battles (${battleCount})</button>
                <button id="uie-codex-clear-old-battles" style="height:30px; padding:0 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.14); background:rgba(0,0,0,0.25); color:#fff; font-weight:900; cursor:pointer; font-size:0.85em;">Clear Old Battles</button>
                <button id="uie-codex-toggle-auto" style="height:30px; padding:0 10px; border-radius:10px; border:1px solid ${autoColor}; background:${autoBg}; color:#fff; font-weight:900; cursor:pointer; font-size:0.85em;">${autoText}</button>
            </div>
        `);

        const data = s.journal.codex || [];
        if (data.length === 0) {
            container.append(`<div style="text-align:center; margin-top:30px; color:#aaa; font-style:italic;">No Codex Entries<br><small style="opacity:0.7;">Codex tracks monsters, legends, people, places, factions, and stable lore.</small></div>`);
            return;
        }

        const tmpl = document.getElementById("uie-template-codex-entry");
        if (tmpl) {
            const frag = document.createDocumentFragment();
            data
                .slice()
                .sort((a, b) => Number(b?.updatedAt || b?.ts || 0) - Number(a?.updatedAt || a?.ts || 0))
                .filter(m => {
                    if (!search) return true;
                    const t = String(m?.title || "").toLowerCase();
                    const body = String(m?.body || "").toLowerCase();
                    const kw = Array.isArray(m?.keywords) ? m.keywords.join(" ").toLowerCase() : "";
                    const cat = String(m?.category || "").toLowerCase();
                    return t.includes(search) || body.includes(search) || kw.includes(search) || cat.includes(search);
                })
                .forEach(m => {
                    const id = String(m.id || "");
                    const title = m.title || "Codex Entry";
                    const category = m.category || "Lore";
                    const isBattle = String(category).toLowerCase() === "battles";
                    const when = m.updatedAt ? new Date(m.updatedAt).toLocaleDateString() : (m.ts ? new Date(m.ts).toLocaleDateString() : "");
                    const keywords = Array.isArray(m.keywords) ? m.keywords.join(", ") : "";
                    
                    const clone = tmpl.content.cloneNode(true);
                    const el = clone.querySelector(".uie-codex-entry");
                    const tEl = clone.querySelector(".codex-title");
                    const dEl = clone.querySelector(".codex-date");
                    const mEl = clone.querySelector(".codex-meta");
                    const bEl = clone.querySelector(".uie-codex-body");
                    const editBtn = clone.querySelector(".uie-codex-edit");
                    const delBtn = clone.querySelector(".uie-codex-del");
                    
                    el.dataset.id = id;
                    if (isBattle) {
                        el.style.borderColor = "rgba(220,20,60,0.4)";
                        el.style.background = "rgba(220,20,60,0.08)";
                    }
                    tEl.textContent = title;
                    dEl.textContent = when;
                    mEl.textContent = `${category}${keywords ? ` • ${keywords}` : ""}`;
                    if (isBattle) mEl.style.color = "#ff6b81";
                    bEl.textContent = m.body || "";
                    editBtn.dataset.id = id;
                    delBtn.dataset.id = id;
                    
                    frag.appendChild(clone);
                });
            container.append(frag);
        }
        return;
    }

    // BATTLES TAB: Filtered view of codex battles
    if (currentTab === "battles") {
        const battleEntries = (s.journal.codex || []).filter(e => String(e?.category || "").toLowerCase() === "battles");
        
        container.append(`
            <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px; align-items:center;">
                <span style="color:#ff6b81; font-weight:900; font-size:0.9em;"><i class="fa-solid fa-shield-halved"></i> ${battleEntries.length} Battle${battleEntries.length !== 1 ? "s" : ""} Recorded</span>
                <button id="uie-battles-clear-all" style="height:28px; padding:0 10px; border-radius:8px; border:1px solid rgba(220,20,60,0.4); background:rgba(220,20,60,0.15); color:#ff6b81; font-weight:900; cursor:pointer; font-size:0.8em; margin-left:auto;">Clear All</button>
            </div>
        `);
        
        if (battleEntries.length === 0) {
            container.append(`<div style="text-align:center; margin-top:30px; color:#aaa; font-style:italic;">No battles recorded yet.<br><small style="opacity:0.7;">Battle results are automatically saved to the Codex.</small></div>`);
            return;
        }
        
        const tmpl = document.getElementById("uie-template-codex-entry");
        if (tmpl) {
            const frag = document.createDocumentFragment();
            battleEntries
                .slice()
                .sort((a, b) => Number(b?.ts || 0) - Number(a?.ts || 0))
                .filter(m => {
                    if (!search) return true;
                    const t = String(m?.title || "").toLowerCase();
                    const body = String(m?.body || "").toLowerCase();
                    const kw = Array.isArray(m?.keywords) ? m.keywords.join(" ").toLowerCase() : "";
                    return t.includes(search) || body.includes(search) || kw.includes(search);
                })
                .forEach(m => {
                    const id = String(m.id || "");
                    const title = m.title || "Battle";
                    const when = m.ts ? new Date(m.ts).toLocaleDateString() : "";
                    const keywords = Array.isArray(m.keywords) ? m.keywords.join(", ") : "";
                    
                    const clone = tmpl.content.cloneNode(true);
                    const el = clone.querySelector(".uie-codex-entry");
                    const tEl = clone.querySelector(".codex-title");
                    const dEl = clone.querySelector(".codex-date");
                    const mEl = clone.querySelector(".codex-meta");
                    const bEl = clone.querySelector(".uie-codex-body");
                    const editBtn = clone.querySelector(".uie-codex-edit");
                    const delBtn = clone.querySelector(".uie-codex-del");
                    
                    el.dataset.id = id;
                    el.style.borderColor = "rgba(220,20,60,0.4)";
                    el.style.background = "rgba(220,20,60,0.08)";
                    tEl.textContent = title;
                    dEl.textContent = when;
                    mEl.textContent = keywords ? `Keywords: ${keywords}` : "Battle";
                    mEl.style.color = "#ff6b81";
                    bEl.textContent = m.body || "";
                    editBtn.dataset.id = id;
                    delBtn.dataset.id = id;
                    
                    frag.appendChild(clone);
                });
            container.append(frag);
        }
        return;
    }

    const list = s.journal[currentTab] || [];
    const filtered = list
        .map((q, idx) => ({ q, idx }))
        .filter(({ q }) => {
        if (!search) return true;
        return String(q?.title || "").toLowerCase().includes(search) || String(q?.desc || "").toLowerCase().includes(search);
    });

    if (filtered.length === 0) {
        container.html(`<div style="text-align:center; margin-top:50px; color:#aaa; font-style:italic;">No entries here.</div>`);
        return;
    }
    
    const tmplQuest = document.getElementById("uie-template-quest-entry");
    if (tmplQuest) {
        const frag = document.createDocumentFragment();
        filtered.forEach(({ q, idx }) => {
            const clone = tmplQuest.content.cloneNode(true);
            const title = clone.querySelector(".uie-quest-title");
            const desc = clone.querySelector(".uie-quest-desc");
            const actionsDiv = clone.querySelector(".uie-quest-actions");
            
            title.textContent = q.title || "Unknown Quest";
            desc.textContent = q.desc || "Details faded...";
            
            if(currentTab === "pending") {
                actionsDiv.style.display = "flex";
                
                const btnAccept = document.createElement("button");
                btnAccept.className = "uie-btn-accept";
                btnAccept.dataset.idx = idx;
                btnAccept.textContent = "Accept";
                btnAccept.style.cssText = "background:#2ecc71; border:none; color:white; padding:8px 12px; border-radius:10px; cursor:pointer; font-weight:900;";
                
                const btnDeny = document.createElement("button");
                btnDeny.className = "uie-btn-deny";
                btnDeny.dataset.idx = idx;
                btnDeny.textContent = "Reject";
                btnDeny.style.cssText = "background:#e74c3c; border:none; color:white; padding:8px 12px; border-radius:10px; cursor:pointer; font-weight:900;";
                
                actionsDiv.appendChild(btnAccept);
                actionsDiv.appendChild(btnDeny);
            } else if(currentTab === "active") {
                actionsDiv.style.display = "flex";
                
                const btnComplete = document.createElement("button");
                btnComplete.className = "uie-btn-complete";
                btnComplete.dataset.idx = idx;
                btnComplete.textContent = "Complete";
                btnComplete.style.cssText = "background:#3498db; border:none; color:white; padding:5px 10px; border-radius:8px; cursor:pointer; font-weight:900; font-size:0.8em;";
                
                const btnAbandon = document.createElement("button");
                btnAbandon.className = "uie-btn-abandon";
                btnAbandon.dataset.idx = idx;
                btnAbandon.textContent = "Abandon";
                btnAbandon.style.cssText = "background:#e74c3c; border:none; color:white; padding:5px 10px; border-radius:8px; cursor:pointer; font-weight:900; font-size:0.8em;";
                
                actionsDiv.appendChild(btnComplete);
                actionsDiv.appendChild(btnAbandon);
            }
            
            frag.appendChild(clone);
        });
        container.append(frag);
    }
}

export function initJournal() {
    const existingWin = $("#uie-journal-window");
    if (bound && existingWin.length && existingWin.attr("data-uie-journal-bound") === "1") {
        renderJournal();
        return;
    }
    bound = true;
    startChatIngest();
    
    const journalEl = document.getElementById("uie-journal-window");
    if (journalEl && journalEl !== document.body) document.body.appendChild(journalEl);
    const $win = $("#uie-journal-window");
    $win.attr("data-uie-journal-bound", "1");
    $win.css({ "pointer-events": "auto", "z-index": 2147483647 });
    $win.off(".uieCodex .uieJournal .uieJournalTheme .uieJournalAdd .uieJournalSparkle .uieJournalGen .uieJournalNew .uieJournalExtract");
    $(document).off(".uieCodex .uieJournal .uieJournalAdd .uieJournalSparkle .uieJournalGen .uieJournalNew .uieJournalExtract");
    // No-op touchOk since we bind only to click events.
    const touchOk = (e) => true;

    $win.on("click.uieJournal", "#uie-journal-close", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-journal-menu").hide();
        $win.hide();
    });

    $win.on("click.uieCodex", "#uie-codex-add", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        ensureCodex(s);
        const title = (prompt("Codex title:") || "").trim();
        if (!title) return;
        const category = (prompt("Category (People/Places/Organizations/Monsters/Legends/etc):", "Lore") || "").trim() || "Lore";
        const body = (prompt("Codex body (reference text):") || "").trim();
        if (!body) return;
        const keywords = (prompt("Keywords (comma separated):") || "").split(",").map(x => x.trim()).filter(Boolean);
        upsertCodexEntry(s, { title, category, body, keywords });
        saveSettings();
        renderJournal();
    });
    $win.on("click.uieCodex", "#uie-codex-extract-desc", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const desc = (prompt("Describe the lore you want to add to the Codex:") || "").trim();
        if (!desc) return;
        const btn = $(this);
        btn.prop("disabled", true);
        try { await generateCodexFromDescription(desc); } finally { btn.prop("disabled", false); }
        renderJournal();
    });
    $win.on("click.uieCodex", "#uie-codex-extract-chat", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const btn = $(this);
        btn.prop("disabled", true);
        try { await extractCodexFromChat(); } finally { btn.prop("disabled", false); }
        renderJournal();
    });
    $win.on("click.uieCodex", "#uie-codex-toggle-auto", function(e) {
        e.preventDefault(); e.stopPropagation();
        const s = getSettings();
        if (!s.features) s.features = {};
        s.features.codexAutoExtract = !s.features.codexAutoExtract;
        saveSettings();
        renderJournal();
        notify("info", `Codex Auto-Extract: ${s.features.codexAutoExtract ? "ON" : "OFF"}`, "Journal");
    });
    $win.on("click.uieCodex", "#uie-codex-filter-battles", function(e) {
        e.preventDefault(); e.stopPropagation();
        $("#uie-journal-search").val("battles").trigger("input");
        notify("info", "Showing battle history", "Journal");
    });
    $win.on("click.uieCodex", "#uie-codex-clear-old-battles", function(e) {
        e.preventDefault(); e.stopPropagation();
        if (!confirm("Clear all battle entries older than 7 days from Codex?")) return;
        const s = getSettings();
        ensureCodex(s);
        const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const before = s.journal.codex.length;
        s.journal.codex = s.journal.codex.filter(entry => {
            const isBattle = String(entry?.category || "").toLowerCase() === "battles";
            const isOld = Number(entry?.ts || 0) < cutoff;
            return !(isBattle && isOld);
        });
        s.codex = { entries: s.journal.codex };
        saveSettings();
        const removed = before - s.journal.codex.length;
        renderJournal();
        notify("info", `Cleared ${removed} old battle entries`, "Journal");
    });
    $win.on("click.uieCodex", "#uie-battles-clear-all", function(e) {
        e.preventDefault(); e.stopPropagation();
        if (!confirm("Clear ALL battle entries from Codex? This cannot be undone.")) return;
        const s = getSettings();
        ensureCodex(s);
        const before = s.journal.codex.length;
        s.journal.codex = s.journal.codex.filter(entry => String(entry?.category || "").toLowerCase() !== "battles");
        s.codex = { entries: s.journal.codex };
        saveSettings();
        const removed = before - s.journal.codex.length;
        renderJournal();
        notify("info", `Cleared ${removed} battle entries`, "Journal");
    });
    $win.on("click.uieCodex", ".uie-codex-entry", function(e) {
        const t = $(e.target);
        if (t.closest("button").length) return;
        const $body = $(this).find(".uie-codex-body");
        const $actions = $(this).find(".uie-codex-actions");
        const open = $body.is(":visible");
        $body.toggle(!open);
        $actions.toggle(!open);
    });
    $win.on("click.uieCodex", ".uie-codex-del", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const id = String($(this).data("id") || "");
        if (!id) return;
        if (!confirm("Delete this Codex entry?")) return;
        const s = getSettings();
        ensureCodex(s);
        s.journal.codex = (s.journal.codex || []).filter(x => String(x?.id || "") !== id);
        s.codex = { entries: s.journal.codex };
        saveSettings();
        renderJournal();
    });
    $win.on("click.uieCodex", ".uie-codex-edit", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const id = String($(this).data("id") || "");
        if (!id) return;
        const s = getSettings();
        ensureCodex(s);
        const cur = (s.journal.codex || []).find(x => String(x?.id || "") === id);
        if (!cur) return;
        const title = (prompt("Codex title:", cur.title || "") || "").trim() || cur.title;
        const category = (prompt("Category:", cur.category || "Lore") || "").trim() || cur.category;
        const body = (prompt("Body:", cur.body || "") || "").trim() || cur.body;
        const keywords = (prompt("Keywords (comma separated):", Array.isArray(cur.keywords) ? cur.keywords.join(", ") : "") || "").split(",").map(x => x.trim()).filter(Boolean);
        upsertCodexEntry(s, { id, title, category, body, keywords });
        saveSettings();
        renderJournal();
    });
    $win.on("click.uieJournal", ".uie-journal-sidebar .uie-tab", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $(".uie-journal-sidebar .uie-tab").removeClass("active");
        $(this).addClass("active");
        currentTab = $(this).data("tab");
        renderJournal();
    });

    $win.on("click.uieJournalTheme", "#uie-journal-theme", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        ensureJournal(s);
        const current = Math.max(0, JOURNAL_THEMES.indexOf(String(s.journal.theme || "map")));
        s.journal.theme = JOURNAL_THEMES[(current + 1) % JOURNAL_THEMES.length];
        saveSettings();
        renderJournal();
        const label = s.journal.theme === "map" ? "Quest Map" : s.journal.theme === "datapad" ? "Futuristic Data Pad" : "Modern Bulletin Board";
        notify("info", `Journal theme: ${label}`, "Journal");
    });

    // Journal sparkle dropdown
    $win.on("click.uieJournalSparkle", "#uie-journal-sparkle", function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        $("#uie-journal-menu").toggle();
    });

    // GENERATE QUESTS
    $win.on("click.uieJournalGen", "#uie-journal-act-gen", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-journal-menu").hide();
        const sAllow = getSettings();
        if (sAllow?.ai && sAllow.ai.journalQuestGen === false) return;
        const btn = $("#uie-journal-sparkle");
        btn.addClass("fa-spin");
        notify("info", "Analyzing timeline for opportunities...", "Journal", "api");

        let rawLog = "";
        try {
            const $txt = $(".chat-msg-txt");
            if ($txt.length) {
                $txt.slice(-30).each(function () { rawLog += $(this).text() + "\n"; });
            } else {
                const chatEl = document.querySelector("#chat");
                if (chatEl) {
                    const msgs = Array.from(chatEl.querySelectorAll(".mes")).slice(-20);
                    for (const m of msgs) {
                        const isUser =
                            m.classList?.contains("is_user") ||
                            m.getAttribute("is_user") === "true" ||
                            m.getAttribute("data-is-user") === "true" ||
                            m.dataset?.isUser === "true";
                        const t =
                            m.querySelector(".mes_text")?.textContent ||
                            m.querySelector(".mes-text")?.textContent ||
                            m.textContent ||
                            "";
                        rawLog += `${isUser ? "You" : "Story"}: ${String(t || "").trim()}\n`;
                    }
                }
            }
        } catch (_) {}
        rawLog = String(rawLog || "").trim();

        const prompt = [
            "Generate 4-8 quest/objective options for the player based on available context.",
            "You must work even if there is only 1 message of chat; if context is thin, create a safe, generic quest that matches the current setting, character card, lorebooks/world info, and persona.",
            "Be lenient and provide multiple viable options whenever possible.",
            "",
            rawLog ? `CHAT (recent):\n${rawLog.slice(0, 2200)}` : "CHAT (recent): [none]",
            "",
            "Output ONLY JSON array (no markdown):",
            `[{"title":"Quest Title","desc":"Short objective description (1-2 sentences)."}]`
        ].join("\n");

        try {
            const res = await generateContent(prompt, "Journal Quests");
            if (!res) throw new Error("No AI response");
            const quests = JSON.parse(String(res || "").replace(/```json|```/g, "").trim());

            if (Array.isArray(quests) && quests.length > 0) {
                const s = getSettings();
                ensureJournal(s);
                const all = []
                     .concat(Array.isArray(s.journal.pending) ? s.journal.pending : [])
                     .concat(Array.isArray(s.journal.active) ? s.journal.active : [])
                     .concat(Array.isArray(s.journal.completed) ? s.journal.completed : [])
                     .concat(Array.isArray(s.journal.abandoned) ? s.journal.abandoned : []);
                const seen = new Set(all.map(q => `${String(q?.title || "").toLowerCase().trim()}::${String(q?.desc || "").toLowerCase().trim()}`));
                let added = 0;
                for (const q of quests.slice(0, 10)) {
                    const title = String(q?.title || q?.name || "").trim().slice(0, 80);
                    const desc = String(q?.desc || q?.objective || q?.summary || "").trim().slice(0, 700);
                    if (!title && !desc) continue;
                    const sig = `${title.toLowerCase()}::${desc.toLowerCase()}`;
                    if (seen.has(sig)) continue;
                    seen.add(sig);
                    s.journal.pending.push({ title: title || "Quest", desc, status: "pending", source: "ai", ts: Date.now() });
                    added++;
                }
                saveSettings();
                $(".uie-journal-sidebar .uie-tab[data-tab='pending']").click();
                if (added) notify("success", `Found ${added} new potential quest(s)!`, "Journal", "questsAccepted");
                else notify("info", "No new quests (already tracked).", "Journal", "questsAccepted");
            } else {
                notify("warning", "No quests returned.", "Journal", "questsAccepted");
            }

        } catch(e) {
            console.error(e);
            notify("error", "Failed to generate quests.", "Journal", "api");
        }
        btn.removeClass("fa-spin");
    });

    // MANUAL QUEST ADD
    $win.on("click.uieJournalNew", "#uie-journal-act-new", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-journal-menu").hide();
        const title = (prompt("Entry title:") || "").trim();
        if (!title) return;
        const desc = (prompt("Entry details (optional):") || "").trim();
        const s = getSettings();
        ensureJournal(s);
        s.journal.pending.push({ title: title.slice(0, 80), desc: desc.slice(0, 600), status: "pending", source: "manual", ts: Date.now() });
        saveSettings();
        $(".uie-journal-sidebar .uie-tab[data-tab='pending']").click();
    });

    $win.on("click.uieJournalExtract", "#uie-journal-act-extract", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-journal-menu").hide();
        let raw = "";
        $(".chat-msg-txt").slice(-30).each(function() { raw += $(this).text() + "\n"; });
        const added = ingestQuestsFromChatText(raw);
        if (!added) notify("info", "No quests found to extract.", "Journal", "questsAccepted");
        else $(".uie-journal-sidebar .uie-tab[data-tab='pending']").click();
    });

    // ACCEPT QUEST
    $win.on("click.uieJournal", ".uie-btn-accept", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number($(this).data("idx"));
        if (!Number.isInteger(idx) || idx < 0) return;
        const s = getSettings();
        ensureJournal(s);
        const quest = s.journal.pending[idx];
        if (!quest) return;
        
        s.journal.pending.splice(idx, 1);
        s.journal.active.push({ ...quest, status: "active", acceptedAt: Date.now() });
        saveSettings();
        try { if (quest) injectRpEvent(`[System: Quest '${String(quest.title || "Quest")}' is now Active.]`); } catch (_) {}
        renderJournal();
        notify("success", `Quest Accepted: ${String(quest.title || "Quest")}`, "Quests", "questsAccepted");
    });

    // DENY QUEST
    $win.on("click.uieJournal", ".uie-btn-deny", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number($(this).data("idx"));
        if (!Number.isInteger(idx) || idx < 0) return;
        const s = getSettings();
        ensureJournal(s);

        const quest = s.journal.pending[idx];
        if (!quest) return;
        s.journal.pending.splice(idx, 1);
        if (!Array.isArray(s.journal.abandoned)) s.journal.abandoned = [];
        s.journal.abandoned.push({ ...quest, status: "abandoned", failed: false, rejected: true, abandonedAt: Date.now() });
        saveSettings();
        try { if (quest) injectRpEvent(`[System: Quest '${String(quest.title || "Quest")}' is now Abandoned.]`); } catch (_) {}
        renderJournal();
        notify("info", "Quest Abandoned.", "Quests", "questsAbandoned");
    });

    // COMPLETE QUEST
    $win.on("click.uieJournal", ".uie-btn-complete", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number($(this).data("idx"));
        if (!Number.isInteger(idx) || idx < 0) return;
        const s = getSettings();
        ensureJournal(s);
        const quest = s.journal.active[idx];
        if(!quest) return;

        s.journal.active.splice(idx, 1);
        s.journal.completed.push({ ...quest, status: "completed", completedAt: Date.now() });

        const gain = 50;
        s.xp = Number(s.xp || 0) + gain;

        saveSettings();
        try { injectRpEvent(`[System: Quest '${String(quest.title || "Quest")}' is now Completed.]`); } catch (_) {}
        renderJournal();
        notify("success", `Quest Completed! +${gain} XP`, "Quests", "questsCompleted");
        $(document).trigger("uie:updateVitals");
    });

    // ABANDON ACTIVE QUEST (only failure path)
    $win.on("click.uieJournal", ".uie-btn-abandon", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number($(this).data("idx"));
        if (!Number.isInteger(idx) || idx < 0) return;
        const s = getSettings();
        ensureJournal(s);
        const quest = s.journal.active[idx];
        if(!quest) return;

        s.journal.active.splice(idx, 1);
        s.journal.abandoned.push({ ...quest, status: "abandoned", failed: true, abandonedAt: Date.now() });

        saveSettings();
        try { injectRpEvent(`[System: Quest '${String(quest.title || "Quest")}' was abandoned.]`); } catch (_) {}
        renderJournal();
        notify("info", "Quest Abandoned.", "Quests", "questsAbandoned");
    });
}

function ensureCodex(s) {
    ensureJournal(s);
    if (!Array.isArray(s.journal.codex)) s.journal.codex = [];
    const legacyEntries = Array.isArray(s.codex?.entries) ? s.codex.entries : [];
    if (legacyEntries.length && legacyEntries !== s.journal.codex) {
        const seen = new Set(s.journal.codex.map((entry) => String(entry?.id || "")));
        for (const entry of legacyEntries) {
            const id = String(entry?.id || "");
            if (id && seen.has(id)) continue;
            s.journal.codex.push(entry);
            if (id) seen.add(id);
        }
    }
    s.codex = { entries: s.journal.codex };
    let migrated = false;
    if (Array.isArray(s.databankNodes) && s.databankNodes.length) {
        const existing = new Set(s.journal.codex.map((entry) => String(entry?._sourceNodeId || entry?.id || "")));
        for (const [index, node] of s.databankNodes.entries()) {
            const nodeId = String(node?.id || "").trim();
            const title = String(node?.title || node?.name || "").trim();
            const body = String(node?.body || node?.summary || node?.text || "").trim();
            if (!title || !body || (nodeId && existing.has(nodeId))) continue;
            s.journal.codex.push({
                id: `codex_${nodeId || `${Date.now()}_${index}`}`,
                title: title.slice(0, 80),
                category: String(node?.type || node?.category || "Lore").trim() || "Lore",
                body: body.slice(0, 3000),
                keywords: Array.isArray(node?.edges) ? node.edges.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12) : [],
                ts: Number(node?.createdAt || node?.updatedAt || Date.now()) || Date.now(),
                updatedAt: Number(node?.updatedAt || Date.now()) || Date.now(),
                _sourceNodeId: nodeId,
                _source: "databankNodes"
            });
            if (nodeId) existing.add(nodeId);
            migrated = true;
        }
    }
    if (migrated) saveSettings();
}

function upsertCodexEntry(s, entry) {
    ensureCodex(s);
    const e = entry && typeof entry === "object" ? entry : {};
    const id = String(e.id || Date.now());
    const title = String(e.title || "Codex").slice(0, 80);
    const category = String(e.category || "Lore").slice(0, 60);
    const body = String(e.body || e.text || "").slice(0, 5000);
    const keywords = Array.isArray(e.keywords) ? e.keywords.map(x => String(x || "").trim()).filter(Boolean).slice(0, 16) : [];
    const updatedAt = Date.now();

    const idx = s.journal.codex.findIndex(x => String(x?.id || "") === id);
    const obj = { id, title, category, body, keywords, updatedAt };
    if (idx >= 0) s.journal.codex[idx] = obj;
    else s.journal.codex.push(obj);
    s.codex = { entries: s.journal.codex };
}

async function generateCodexFromDescription(desc) {
    const s = getSettings();
    ensureCodex(s);

    const prompt = `
Create a Codex entry (Dragon Age style encyclopedia). Lore only.
Hard rules:
- Do NOT log small events (no "picked up a sword", no moment-to-moment actions).
- Do NOT invent world-changing canon unless supported by context.
- Write as reference text: neutral, informative, in-universe.
- If you cannot justify the entry as stable lore, return {"entries":[]}.
Return ONLY JSON:
{
  "entries":[{"title":"","category":"People|Places|Organizations|Monsters|Legends|Creatures|Magic|History|Religion|Technology|Culture|Items","body":"","keywords":["",""]}]
}

Description:
${desc}
`;
    const res = await generateContent(prompt.slice(0, 6000), "System Check");
    if (!res) return;
    let obj = null;
    try { obj = JSON.parse(String(res).replace(/```json|```/g, "").trim()); } catch (_) { obj = null; }
    const arr = Array.isArray(obj?.entries) ? obj.entries : [];
    if (!arr.length) return;
    for (const e of arr.slice(0, 6)) upsertCodexEntry(s, e);
    saveSettings();
}

async function extractCodexFromChat() {
    const s = getSettings();
    ensureCodex(s);

    let raw = "";
    $(".chat-msg-txt").slice(-60).each(function () { raw += $(this).text() + "\n"; });
    raw = raw.trim().slice(0, 5000);
    if (!raw) return;

    const prompt = `
Extract Codex-grade lore from this chat. Lore only.
Hard rules:
- Ignore small actions, loot, minor scene beats, casual dialogue.
- Keep only stable encyclopedia-worthy lore: monsters, legends, factions, locations, history, species, magic rules, institutions, tech, culture.
- If nothing qualifies, return {"entries":[]} .
Return ONLY JSON:
{
  "entries":[{"title":"","category":"People|Places|Organizations|Monsters|Legends|Creatures|Magic|History|Religion|Technology|Culture|Items","body":"","keywords":["",""]}]
}

CHAT LOG:
${raw}
`;
    const res = await generateContent(prompt.slice(0, 6000), "System Check");
    if (!res) return;
    let obj = null;
    try { obj = JSON.parse(String(res).replace(/```json|```/g, "").trim()); } catch (_) { obj = null; }
    const arr = Array.isArray(obj?.entries) ? obj.entries : [];
    if (!arr.length) return;
    for (const e of arr.slice(0, 8)) upsertCodexEntry(s, e);
    saveSettings();
}
