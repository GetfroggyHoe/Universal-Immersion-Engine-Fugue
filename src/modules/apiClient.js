import { getSettings, saveSettings, resolveApiKey } from "./core.js";
import { getContext } from "./gameContext.js";
import { buildSystemPrompt, consumePendingSystemEvents, validateResponse } from "./logicEnforcer.js";
import { notify } from "./notifications.js";
import { getChatTranscriptText } from "./chatLog.js";
import { flushHiddenEvents } from "./features/rp_log.js";
import { clearNextBeatPrompt, getNextBeatPrompt } from "./nextBeat.js";
import { buildBigSisterNarrationDirectives, buildSystemPrompt as buildLittleSisContext, consumeAutoChartTags, stripAutoChartTags } from "./twoSisters.js";
import { compactTranscriptTail, retrieveTieredMemoryContext } from "./contextMemory.js";
import { extractApiResponseText } from "./apiResponse.js";
import { scanContentForSafetyViolations, isSystemLockedOut, enforceLockoutScreen } from "./safetyScanner.js";
import { buildAcademyPromptBlock } from "./dynamicAcademy.js";
import { buildSecretsPromptContext } from "./secretsEngine.js";


export { extractApiResponseText } from "./apiResponse.js";

let activeVnAbortController = null;
let generationInFlight = false;

export function stopActiveGeneration() {
    if (!activeVnAbortController) return false;
    try { window.__uieGenerationStopped = true; } catch (_) {}
    try { activeVnAbortController.abort(); } catch (_) {}
    return true;
}

function clampTokenLimit(value, fallback, min = 256, max = 1000000) {
    const n = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(n) ? Math.floor(n) : fallback));
}

function trimTextToApproxTokens(text, tokenLimit, keepStartRatio = 0.35) {
    const src = String(text || "");
    const charLimit = Math.max(0, Math.floor(Number(tokenLimit || 0) * 4));
    if (!charLimit || src.length <= charLimit) return src;
    const headChars = Math.floor(charLimit * keepStartRatio);
    return `${src.slice(0, headChars)}\n\n[CONTEXT TRIMMED TO TOKEN LIMIT]\n\n${src.slice(-(charLimit - headChars))}`;
}

function applyRequestTokenLimits(config, prompt, systemPrompt) {
    const generation = getSettings()?.generation || {};
    const contextTokens = clampTokenLimit(config?.contextTokens ?? generation.contextTokenLimit, 24000, 1024);
    const outputTokens = clampTokenLimit(config?.maxTokens ?? generation.outputTokenLimit, 4096, 128, 32768);
    const limitedSystem = trimTextToApproxTokens(systemPrompt, Math.max(512, Math.floor(contextTokens * 0.45)), 0.7);
    const promptBudget = Math.max(512, contextTokens - Math.ceil(limitedSystem.length / 4));
    return {
        prompt: trimTextToApproxTokens(prompt, promptBudget, 0.2),
        systemPrompt: limitedSystem,
        contextTokens,
        outputTokens,
    };
}
function ensureConfirmModal() {
    if ($("#uie-ai-confirm").length) return;
    $("body").append(`
        <div id="uie-ai-confirm" style="display:none; position:fixed; inset:0; z-index:2147483647; background:rgba(0,0,0,0.65); align-items:center; justify-content:center;">
            <div style="width:min(560px, 92vw); border-radius:16px; border:1px solid rgba(203, 163, 92,0.35); background:rgba(15,10,8,0.95); color:#f6e7c8; padding:14px; box-sizing:border-box;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                    <div style="font-weight:900; letter-spacing:0.6px; color:#cba35c;">Confirm Generation</div>
                    <div style="margin-left:auto; font-size:12px; opacity:0.85;">This may spend credits.</div>
                </div>
                <div style="display:grid; grid-template-columns: 1fr; gap:10px;">
                    <div style="display:flex; gap:10px; flex-wrap:wrap;">
                        <div style="flex:1; min-width:180px; border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:10px; background:rgba(0,0,0,0.25);">
                            <div style="font-weight:900; opacity:0.85; margin-bottom:4px;">What</div>
                            <div id="uie-ai-confirm-what" style="font-weight:800;"></div>
                        </div>
                        <div style="flex:1; min-width:180px; border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:10px; background:rgba(0,0,0,0.25);">
                            <div style="font-weight:900; opacity:0.85; margin-bottom:4px;">Provider/Model</div>
                            <div id="uie-ai-confirm-model" style="font-weight:800;"></div>
                        </div>
                    </div>
                    <div id="uie-ai-confirm-preview-wrap" style="border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:10px; background:rgba(0,0,0,0.25);">
                        <div style="font-weight:900; opacity:0.85; margin-bottom:6px;">Preview</div>
                        <div id="uie-ai-confirm-preview" style="font-size:12px; opacity:0.9; white-space:pre-wrap; max-height:160px; overflow:auto;"></div>
                    </div>
                </div>
                <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap;">
                    <button id="uie-ai-confirm-cancel" style="flex:1; min-width:180px; height:40px; border-radius:12px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.25); color:#fff; font-weight:900; cursor:pointer;">Cancel</button>
                    <button id="uie-ai-confirm-go" style="flex:1; min-width:180px; height:40px; border-radius:12px; border:1px solid rgba(203, 163, 92,0.35); background:rgba(203, 163, 92,0.18); color:#cba35c; font-weight:900; cursor:pointer;">Generate</button>
                </div>
            </div>
        </div>
    `);
}

async function chatLogCheck({ maxMessages = 10, maxChars = 2400 } = {}) {
    try {
        const t = await getChatTranscriptText({ maxMessages, maxChars });
        return compactTranscriptTail(t, maxChars);
    } catch (_) {
        return "";
    }
}

function loreCheck() {
    try {
        const ctx = getContext?.();
        const maybe = ctx?.world_info || ctx?.lorebook || ctx?.lore || ctx?.worldInfo;
        const keys = [];
        if (Array.isArray(maybe)) {
            for (const it of maybe) {
                const k = it?.key || it?.name || it?.title;
                if (k) keys.push(String(k));
            }
        }
        return Array.from(new Set(keys)).slice(0, 80).join(", ");
    } catch (_) {
        return "";
    }
}

function characterCheck() {
    try {
        const ctx = getContext?.();
        const out = {
            user: ctx?.name1,
            character: ctx?.name2,
            chatId: ctx?.chatId,
            characterId: ctx?.characterId,
            groupId: ctx?.groupId
        };
        return JSON.stringify(out);
    } catch (_) {
        return "{}";
    }
}

function userCheck() {
    try {
        const ctx = getContext?.();
        return String(ctx?.name1 || "You");
    } catch (_) {
        return "You";
    }
}

function personaCheck() {
    try {
        const ctx = getContext?.() || {};
        const user = String(ctx?.name1 || ctx?.user || "User").trim() || "User";
        const name =
            String(
                ctx?.persona?.name ||
                ctx?.userPersona?.name ||
                ctx?.user_persona?.name ||
                ctx?.personaName ||
                ctx?.userPersonaName ||
                ctx?.user_persona_name ||
                ""
            ).trim();
        const desc =
            String(
                ctx?.persona?.description ||
                ctx?.userPersona?.description ||
                ctx?.user_persona?.description ||
                ctx?.persona_description ||
                ctx?.userPersonaDescription ||
                ctx?.user_persona_description ||
                ""
            ).trim();
        const combined = [name && `Name: ${name}`, desc && `Description: ${desc}`].filter(Boolean).join("\n").trim();
        if (!combined) return "";
        return `[USER PERSONA]\nUser: ${user}\n${combined}`.slice(0, 1800);
    } catch (_) {
        return "";
    }
}

function characterCardCheck() {
    try {
        const ctx = getContext?.() || {};
        const ch =
            ctx?.character ||
            ctx?.char ||
            (ctx?.characters && typeof ctx.characters === "object" ? (ctx.characters[ctx?.characterId] || ctx.characters[ctx?.charId]) : null) ||
            null;
        const name = String(ctx?.name2 || ch?.name || ch?.char_name || "").trim();
        const desc = String(ch?.description || ch?.desc || ch?.persona || "").trim();
        const personality = String(ch?.personality || ch?.personality_summary || "").trim();
        const scenario = String(ch?.scenario || ch?.world_scenario || "").trim();
        const first = String(ch?.first_mes || ch?.first_message || "").trim();
        const ex = String(ch?.mes_example || ch?.example_dialogue || "").trim();
        const lines = [];
        if (name) lines.push(`Name: ${name}`);
        if (desc) lines.push(`Description: ${desc}`);
        if (personality) lines.push(`Personality: ${personality}`);
        if (scenario) lines.push(`Scenario: ${scenario}`);
        if (first) lines.push(`First_Message: ${first}`);
        if (ex) lines.push(`Example_Dialogue: ${ex}`);
        const out = lines.join("\n").trim();
        if (!out) return "";
        return `[CHARACTER CARD]\n${out}`.slice(0, 2200);
    } catch (_) {
        return "";
    }
}

function worldInfoDetailsCheck() {
    try {
        const ctx = getContext?.() || {};
        const raw = ctx?.world_info || ctx?.worldInfo || ctx?.lorebook || ctx?.lore || [];
        const arr = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? Object.values(raw) : []);
        const items = [];
        for (const it of arr) {
            if (!it) continue;
            const key = String(it?.key || it?.name || it?.title || it?.keys?.[0] || "").trim();
            const val = String(it?.content || it?.text || it?.entry || it?.value || it?.desc || "").trim();
            if (!key && !val) continue;
            items.push({ key, val });
        }
        const picked = items.slice(0, 6);
        if (!picked.length) return "";
        const lines = picked.map(x => `- ${x.key || "Entry"}: ${String(x.val || "").replace(/\s+/g, " ").trim().slice(0, 220)}`).join("\n");
        return `[WORLD INFO]\n${lines}`.slice(0, 1800);
    } catch (_) {
        return "";
    }
}

function inventoryAudit() {
    try {
        const s = getSettings();
        const inv = s?.inventory || {};
        const items = Array.isArray(inv.items) ? inv.items : [];
        const equipped = Array.isArray(inv.equipped) ? inv.equipped : [];
        const lines = [];
        const sym = String(s?.currencySymbol || "G").trim() || "G";
        const wallet = Math.max(0, Math.floor(Number(s?.currency ?? 0)));
        lines.push(`[Primary_Wallet = ${wallet} ${sym}] (tracked funds; spending must match narration)`);
        const altCur = items
            .filter((it) => it && String(it?.type || "").toLowerCase() === "currency" && String(it?.symbol || "").trim() && String(it?.symbol) !== sym)
            .slice(0, 12)
            .map((it) => `${String(it.name || "Funds").slice(0, 48)} x${Number(it.qty || 0)} [${String(it.symbol)}]`);
        if (altCur.length) lines.push(`[Alternate_currency_items (physical / foreign tokens) = ${altCur.join(" | ")}]`);
        lines.push(`[Inventory_Items_Count = ${items.length}]`);
        lines.push(`[Inventory_Equipped_Count = ${equipped.length}]`);
        const tail = items.slice(0, 60).map(it => {
            const name = String(it?.name || "Item").slice(0, 60);
            const qty = it?.qty !== undefined ? Number(it.qty) : "";
            const type = String(it?.type || it?.slotCategory || "").slice(0, 30);
            const fx = Array.isArray(it?.statusEffects) ? it.statusEffects.slice(0, 4).join(", ") : "";
            return `- ${name}${qty !== "" ? ` x${qty}` : ""}${type ? ` [Type=${type}]` : ""}${fx ? ` [Effects=${fx}]` : ""}`;
        });
        lines.push(...tail);
        if (equipped.length) {
            lines.push(`---`);
            equipped.slice(0, 30).forEach(e => {
                const slot = String(e?.slotId || "").slice(0, 30);
                const name = String(e?.name || "Equipped").slice(0, 60);
                lines.push(`- [Slot=${slot}] ${name}`);
            });
        }
        return lines.join("\n").slice(0, 3800);
    } catch (_) {
        return "";
    }
}

function temporalAnchor() {
    try {
        const s = getSettings();
        const cal = s?.calendar && typeof s.calendar === "object" ? s.calendar : {};
        const useRp = cal.rpEnabled === true;
        const ref = (() => {
            if (!useRp) return new Date();
            const raw = String(cal.rpDate || "").trim();
            const m = raw.match(/^(\d{1,6})-(\d{1,2})-(\d{1,2})$/);
            if (!m) return new Date();
            const y = Number(m[1]);
            const mo = Number(m[2]);
            const d = Number(m[3]);
            const dt = new Date(y, mo - 1, d);
            if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return new Date();
            return dt;
        })();
        const y = ref.getFullYear();
        const mo = String(ref.getMonth() + 1).padStart(2, "0");
        const d = String(ref.getDate()).padStart(2, "0");
        const todayKey = `${y}-${mo}-${d}`;
        const events = cal.events && typeof cal.events === "object" ? cal.events[todayKey] : null;
        const ev = Array.isArray(events) ? events.slice(0, 8).map((e) => `- ${String(e?.title || "Event").slice(0, 80)}`) : [];
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
        const nowReal = new Date();
        const tp = cal.timePhysics && typeof cal.timePhysics === "object" ? cal.timePhysics : {};
        const rules = String(tp.summary || "").trim();
        const lines = [
            useRp ? `[RP_Calendar_Date = ${todayKey}] (in-world; continues indefinitely)` : `[Story_Calendar_Date = ${todayKey}]`,
            `[Real_World_Timezone = ${tz}]`,
            `[Real_World_Time = ${nowReal.toLocaleString()}]`,
            ev.length ? `[Calendar_Events_This_Date]` : `[Calendar_Events_This_Date = None]`,
            ...ev
        ];
        if (rules) {
            lines.push(`[In_World_Date_And_Time_Rules]`);
            lines.push(rules.slice(0, 1800));
        }
        return lines.join("\n");
    } catch (_) {
        return "";
    }
}

function digitalStateCheck() {
    try {
        const s = getSettings();
        const phoneActive = $("#uie-phone-window").is(":visible");
        const unread = Number(s?.phone?.unreadCount || 0);
        const newSms = unread > 0;
        return [
            `[Phone_Active = ${phoneActive ? "True" : "False"}]`,
            `[New_SMS_Detected = ${newSms ? "True" : "False"}]`,
            newSms ? `[Unread_SMS_Count = ${unread}]` : `[Unread_SMS_Count = 0]`
        ].join("\n");
    } catch (_) {
        return `[Phone_Active = False]\n[New_SMS_Detected = False]\n[Unread_SMS_Count = 0]`;
    }
}

function normalizeNameKey(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function lineMentionsName(line, name) {
    const src = String(line || "").toLowerCase();
    const key = normalizeNameKey(name);
    if (!src || !key) return false;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    try {
        return new RegExp(`\\b${escaped}\\b`, "i").test(src);
    } catch (_) {
        return src.includes(key);
    }
}

function isLikelyMetaDatabankText(text) {
    return /\b(character\s*card|lorebook|metadata|tool\s*card|system\s*prompt|author\s*note|ooc|omniscient|omniscent)\b/i.test(String(text || ""));
}

function resolvePrimaryCharacterNames(seedText = "") {
    const names = [];
    try {
        const ctx = getContext?.() || {};
        if (ctx?.name2) names.push(String(ctx.name2));
    } catch (_) {}
    const raw = String(seedText || "");
    const tagged = raw.match(/(?:^|\n)\s*([A-Za-z][A-Za-z0-9' -]{1,48})\s*:/g) || [];
    for (const hit of tagged.slice(-8)) {
        const m = String(hit || "").match(/([A-Za-z][A-Za-z0-9' -]{1,48})\s*:/);
        if (m?.[1]) names.push(String(m[1]));
    }
    const uniq = [];
    const seen = new Set();
    for (const n of names) {
        const k = normalizeNameKey(n);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        uniq.push(String(n).trim());
    }
    return uniq.slice(0, 3);
}

function retrieveMemories(seedText, options = {}) {
    try {
        const s = getSettings();
        return retrieveTieredMemoryContext(s, seedText, options);
    } catch (_) {
        return "";
    }
}

function battleStateCheck() {
    try {
        const s = getSettings();
        const st = s?.battle?.state;
        if (!st || st.active !== true) return "";
        const enemies = Array.isArray(st.enemies) ? st.enemies : [];
        const e0 = enemies.find(e => String(e?.name || "").trim()) || enemies[0] || null;
        if (!e0) return "[COMBAT ACTIVE]";
        const name = String(e0.name || "Enemy").trim();
        const hp = Number.isFinite(Number(e0.hp)) ? Number(e0.hp) : 0;
        const max = Number.isFinite(Number(e0.maxHp)) ? Number(e0.maxHp) : 0;
        const se = Array.isArray(e0.statusEffects) ? e0.statusEffects.map(x => String(x || "").trim()).filter(Boolean).slice(0, 4) : [];
        const status = se.length ? ` ${se.join(", ")}` : "";
        const intelLines = enemies
            .filter((e) => e?.intel?.revealed === true)
            .slice(0, 3)
            .map((e) => {
                const stt = e?.intel?.stats || {};
                const abil = Array.isArray(e?.intel?.abilities) ? e.intel.abilities.slice(0, 3).join(", ") : "";
                const statsTxt = `STR=${Number(stt?.str || 0)} DEX=${Number(stt?.dex || 0)} CON=${Number(stt?.con || 0)} INT=${Number(stt?.int || 0)} WIS=${Number(stt?.wis || 0)} CHA=${Number(stt?.cha || 0)}`;
                return `${String(e?.name || "Enemy").slice(0, 40)} {${statsTxt}${abil ? ` | ${abil}` : ""}}`;
            });
        const intelBlock = intelLines.length ? `\n[ENEMY INTEL: ${intelLines.join(" || ")}]` : "";
        return `[COMBAT ACTIVE: ${name} (${hp}/${max} HP)${status}]${intelBlock}`;
    } catch (_) {
        return "";
    }
}

function statsCheck() {
    try {
        const s = getSettings();
        const c = s?.character || {};
        const stats = c.stats || {};
        const kv = Object.entries(stats).map(([k,v]) => `${k.toUpperCase()}=${v}`).join(" ");
        
        const hp = `${s.hp || 0}/${s.maxHp || 100}`;
        const mp = `${s.mp || 0}/${s.maxMp || 100}`;
        const ap = `${s.ap || 0}/${s.maxAp || 100}`;
        const xp = `${s.xp || 0}`;
        const lvl = c.level || 1;
        const cls = c.class || c.className || "Unknown";
        
        const rProfile = String(c.resourceProfile || "both").toLowerCase();
        let vitalsStr = `HP=${hp}`;
        if (rProfile === "ap") {
            vitalsStr += ` AP=${ap}`;
        } else if (rProfile === "mp") {
            vitalsStr += ` MP=${mp}`;
        } else if (rProfile === "both" || rProfile === "custom") {
            vitalsStr += ` MP=${mp} AP=${ap}`;
        }
        vitalsStr += ` XP=${xp}`;
        
        let energyInfo = "";
        if (rProfile === "mp") {
            energyInfo = "\nEnergy System: Magic-Based (Uses MP for spells and magical abilities. No AP is active.)";
        } else if (rProfile === "ap") {
            energyInfo = "\nEnergy System: Physical-Based (Uses Action Points/AP for physical techniques and attacks. No MP is active.)";
        } else if (rProfile === "both") {
            energyInfo = "\nEnergy System: Hybrid (Uses MP for spells and AP for physical skills. Mage Warrior style.)";
        } else if (rProfile === "custom") {
            energyInfo = "\nEnergy System: Custom/Complex (All vitals active.)";
        }
        
        return `[CHARACTER SHEET]\nClass: ${cls} (Lv.${lvl})\nVitals: ${vitalsStr}${energyInfo}\nStats: ${kv}`;
    } catch (_) {
        return "";
    }
}

function statusEffectCheck() {
    try {
        const s = getSettings();
        const eff = Array.isArray(s?.character?.statusEffects) ? s.character.statusEffects : [];
        const list = eff.map(x => String(x || "").trim()).filter(Boolean).slice(0, 10);
        if (!list.length) return "";
        return `[PLAYER STATUS: ${list.join(", ")}]`;
    } catch (_) {
        return "";
    }
}

function progressionCheck() {
    try {
        const s = getSettings();
        const c = s?.character || {};
        const lvl = Number(c.level || 1);
        const stats = c.stats && typeof c.stats === "object" ? c.stats : {};
        const statPairs = Object.entries(stats)
            .map(([k, v]) => `${String(k || "").toUpperCase()}=${Number(v) || 0}`)
            .slice(0, 16);

        const skills = Array.isArray(s?.inventory?.skills) ? s.inventory.skills : [];
        const topSkills = skills
            .map((x) => String(x?.name || x?.title || x || "").trim())
            .filter(Boolean)
            .slice(0, 8);

        const battleLog = Array.isArray(s?.battle?.state?.log) ? s.battle.state.log.slice(-16).join(" | ") : "";
        const diceFromLog = String(battleLog).match(/\b(?:d\d+|[1-9]\d?\s*\/\s*[1-9]\d?|roll(?:ed)?\s+\d+)\b/ig) || [];
        const diceRecent = diceFromLog.slice(-5).join(", ");

        return `[RPG CHECK]\nLevel=${lvl}\nSkills(${topSkills.length}): ${topSkills.join(", ") || "None"}\nStats: ${statPairs.join(" ") || "None"}\nDice/Checks: ${diceRecent || "None observed"}`;
    } catch (_) {
        return "";
    }
}

function worldStateCheck() {
    try {
        const s = getSettings();
        const ws = s?.worldState || {};
        if (!ws || typeof ws !== "object") return "";
        const loc = String(ws.location || "").trim();
        const time = String(ws.time || "").trim();
        const weather = String(ws.weather || "").trim();
        const path = String(ws.locationPath || "").trim();
        const mapPrompt = (() => {
            try {
                if (typeof window?.UIE_getMapLocationContext === "function") {
                    return String(window.UIE_getMapLocationContext() || "").trim();
                }
            } catch (_) {}
            try {
                const ctx = ws.mapContext || s?.mapEngine?.locationContext;
                if (!ctx || typeof ctx !== "object") return "";
                const routeText = Array.isArray(ctx.transportHere) && ctx.transportHere.length ?
                     ctx.transportHere.map((r) => `${r.mode || "travel"}->${r.destination || ""}`).join(" | ")
                    : "None";
                const assetText = Array.isArray(ctx.assetsHere) && ctx.assetsHere.length ?
                     ctx.assetsHere.map((a) => `${a.name}(${a.type || "asset"})`).join(", ")
                    : "None";
                const rules = Array.isArray(ctx.activeRules) ? ctx.activeRules.join("; ") : "";
                return `[MAP LOCATION CONTEXT]\nPath=${path || [ctx.world?.name, ctx.region?.name, ctx.local?.name].filter(Boolean).join(" > ")}\nTransport=${routeText}\nAssetsHere=${assetText}\nRules=${rules || "None"}\nFastTravelOverride=${ctx.fastTravelOverride ? "Allowed" : "Off"}`;
            } catch (_) {
                return "";
            }
        })();
        const parts = [loc && `Location=${loc}`, path && `Path=${path}`, time && `Time=${time}`, weather && `Weather=${weather}`].filter(Boolean);
        if (!parts.length && !mapPrompt) return "";
        return [`[WORLD: ${parts.join(", ")}]`, mapPrompt].filter(Boolean).join("\n");
    } catch (_) {
        return "";
    }
}

function magicKnowledgeCheck() {
    try {
        const fn = window?.UIE_magicKnowledgePromptBlock;
        if (typeof fn === "function") return String(fn() || "");
    } catch (_) {}
    try {
        const s = getSettings();
        const mk = s?.magicKnowledge || {};
        const flags = Array.from(new Set([...(mk.knowledgeFlags || []), ...(s?.character?.knowledgeFlags || [])])).slice(-30);
        const runes = Array.from(new Set([...(mk.knownRunes || []), ...(mk.grimoire?.unlockedRunes || [])])).slice(0, 40);
        const casts = (mk.spellHistory?.casts || []).slice(-8).map((c) => `${c.sentence}${c.target ? ` -> ${c.target}` : ""}`);
        if (!flags.length && !runes.length && !casts.length) return "";
        return `[MAGIC & KNOWLEDGE ENGINE]\nKnown runes: ${runes.join(", ") || "None"}\nKnowledge flags: ${flags.join(", ") || "None"}\nRecent spells: ${casts.join(" | ") || "None"}`;
    } catch (_) {
        return "";
    }
}

function questLogCheck() {
    try {
        const s = getSettings();
        const q0 = Array.isArray(s?.journal?.active) ? s.journal.active[0] : null;
        if (!q0 || typeof q0 !== "object") return "";
        const title = String(q0.title || q0.name || "").trim();
        const obj = String(q0.desc || q0.objective || q0.summary || "").trim();
        if (!title && !obj) return "";
        return `[QUEST: ${title || "Untitled"}${obj ? ` - ${obj}` : ""}]`;
    } catch (_) {
        return "";
    }
}

function socialContextCheck() {
    try {
        const s = getSettings();
        const threads = s?.phone?.smsThreads;
        if (!threads || typeof threads !== "object") return "";
        const rows = [];
        for (const [name, list] of Object.entries(threads)) {
            if (!Array.isArray(list) || !list.length) continue;
            const last = list[list.length - 1];
            const ts = Number(last?.ts || 0);
            const text = String(last?.text || "").trim();
            if (!text) continue;
            rows.push({ name: String(name || "").trim(), text, ts });
        }
        rows.sort((a, b) => (Number(b.ts || 0) - Number(a.ts || 0)));
        const pick = rows.slice(0, 2).filter(x => x.name && x.text);
        if (!pick.length) return "";
        const formatted = pick.map(x => `${x.name}: "${x.text.slice(0, 160)}"`).join(" | ");
        return `[RECENT TEXTS: ${formatted}]`;
    } catch (_) {
        return "";
    }
}

function phoneTriggerPromptCheck() {
    try {
        const s = getSettings();
        if (s?.phone?.npcPhonePromptInjection !== true) return "";
        const callsOn = s?.phone?.allowCalls !== false;
        const textsOn = s?.phone?.allowTexts !== false;
        if (!callsOn && !textsOn) return "";
        return `[OPTIONAL PHONE TRIGGER INJECTION = ON]
When narratively appropriate, you MAY emit one tag:
- [UIE_CALL: Name] (inbound NPC call)
- [UIE_TEXT: Name | short message] (inbound NPC text)
Rules:
- Use only when grounded in current story context and relationship state.
- Maximum one phone-trigger tag per assistant turn.
- Keep names and message bodies concise; no spam tags.`;
    } catch (_) {
        return "";
    }
}

function partyBattleContextCheck() {
    try {
        const s = getSettings();
        const party = s?.party && typeof s.party === "object" ? s.party : {};
        const membersRaw = Array.isArray(party.members) ? party.members : [];
        const members = membersRaw
            .filter((m) => m && m.active !== false)
            .map((m) => {
                const name = String(m?.identity?.name || m?.name || "").trim();
                if (!name) return null;
                const cls = String(m?.identity?.class || "Adventurer").trim() || "Adventurer";
                const role = String(m?.partyRole || "DPS").trim() || "DPS";
                const level = Math.max(1, Number(m?.progression?.level || 1) || 1);
                const hp = Number(m?.vitals?.hp || 0) || 0;
                const maxHp = Math.max(1, Number(m?.vitals?.maxHp || 100) || 100);
                const mp = Number(m?.vitals?.mp || 0) || 0;
                const maxMp = Math.max(1, Number(m?.vitals?.maxMp || 50) || 50);
                const ap = Number(m?.vitals?.ap || 0) || 0;
                const maxAp = Math.max(1, Number(m?.vitals?.maxAp || 10) || 10);
                const tactics = m?.tactics && typeof m.tactics === "object" ? m.tactics : {};
                return {
                    id: String(m?.id || "").trim(),
                    name,
                    cls,
                    role,
                    level,
                    hp,
                    maxHp,
                    mp,
                    maxMp,
                    ap,
                    maxAp,
                    tacticPreset: String(tactics?.preset || "Balanced").trim() || "Balanced",
                    tacticFocus: String(tactics?.focus || "auto").trim() || "auto",
                    protectId: String(tactics?.protectId || "").trim(),
                    conserveMana: !!tactics?.conserveMana,
                };
            })
            .filter(Boolean)
            .slice(0, 12);

        if (!members.length) return "";

        const byId = new Map(members.map((m) => [m.id, m]));
        const lanesRaw = party?.formation?.lanes && typeof party.formation.lanes === "object" ? party.formation.lanes : {};
        const laneMap = { front: [], mid: [], back: [] };
        const assigned = new Set();
        for (const lane of ["front", "mid", "back"]) {
            const ids = Array.isArray(lanesRaw[lane]) ? lanesRaw[lane] : [];
            for (const id of ids) {
                const m = byId.get(String(id || "").trim());
                if (!m || assigned.has(m.id)) continue;
                laneMap[lane].push(m.name);
                assigned.add(m.id);
            }
        }
        const reserves = members.filter((m) => !assigned.has(m.id)).map((m) => m.name);
        const leaderId = String(party?.leaderId || "").trim();
        const leader = members.find((m) => m.id && m.id === leaderId)?.name || members[0]?.name || "Unknown";

        const partyTactics = party?.partyTactics && typeof party.partyTactics === "object" ? party.partyTactics : {};
        const preset = String(partyTactics?.preset || "Balanced").trim() || "Balanced";
        const conserve = !!partyTactics?.conserveMana;
        const protectLeader = !!partyTactics?.protectLeader;

        const roster = members.map((m) => {
            const protectName = m.protectId ? (byId.get(m.protectId)?.name || m.protectId) : "";
            return `${m.name} Lv${m.level} ${m.cls}/${m.role} HP=${m.hp}/${m.maxHp} MP=${m.mp}/${m.maxMp} AP=${m.ap}/${m.maxAp} TAC=${m.tacticPreset}/${m.tacticFocus}${m.conserveMana ? "/ConserveMP" : ""}${protectName ? `/Protect:${protectName}` : ""}`;
        }).join(" | ");

        const laneText = `Front=[${laneMap.front.join(", ") || "-"}] Mid=[${laneMap.mid.join(", ") || "-"}] Back=[${laneMap.back.join(", ") || "-"}] Reserve=[${reserves.join(", ") || "-"}]`;
        return `[PARTY COMBAT CONTEXT]\nLeader=${leader}\nPartyTactics=${preset}${conserve ? "/ConserveMP" : ""}${protectLeader ? "/ProtectLeader" : ""}\nFormation=${laneText}\nRoster=${roster}`;
    } catch (_) {
        return "";
    }
}

export async function rootProtocolBlock(seedText) {
    const settings = getSettings();
    const contextConfig = settings?.generation?.contextBudget || {};
    const recentMessages = Math.max(4, Math.min(20, Number(contextConfig.recentMessages) || 10));
    const recentChars = Math.max(1200, Math.min(6000, Number(contextConfig.recentChars) || 2400));
    const archiveChars = Math.max(400, Math.min(4000, Number(contextConfig.archiveChars) || 1200));
    const archiveItems = Math.max(1, Math.min(6, Number(contextConfig.archiveItems) || 3));
    const chat = await chatLogCheck({ maxMessages: recentMessages, maxChars: recentChars });
    const combat = battleStateCheck();
    const combatQuarantine = !!combat;
    const lore = combatQuarantine ? "" : loreCheck();
    const worldInfo = combatQuarantine ? "" : worldInfoDetailsCheck();
    const who = userCheck();
    const char = characterCheck();
    const card = characterCardCheck();
    const persona = personaCheck();
    const inv = inventoryAudit();
    const digital = digitalStateCheck();
    const temporal = temporalAnchor();
    const mem = retrieveMemories(`${seedText}\n${chat}`, { maxChars: archiveChars, maxItems: archiveItems });
    const stats = statsCheck();
    const status = statusEffectCheck();
    const progression = progressionCheck();
    const partyBattle = partyBattleContextCheck();
    const world = worldStateCheck();
    const academy = buildAcademyPromptBlock(settings);
    const magicKnowledge = magicKnowledgeCheck();
    const quest = questLogCheck();
    const texts = socialContextCheck();
    const phoneTrigger = phoneTriggerPromptCheck();
    const buckets = [
        tokenBucket("chat_history", chat, { source: "recent_chat", maxMessages: recentMessages }),
        tokenBucket("game_state", [combat, stats, progression, partyBattle, status, world, academy, magicKnowledge, quest, texts, phoneTrigger].filter(Boolean).join("\n"), { source: "state_modules" }),
        tokenBucket("inventory", inv, { source: "inventory_audit" }),
        tokenBucket("digital_state", digital, { source: "phone_state" }),
        tokenBucket("temporal_anchor", temporal, { source: "calendar_time" }),
        tokenBucket("lore_index", lore, { source: "lorebook_names" }),
        tokenBucket("world_info", worldInfo, { source: "world_info" }),
        tokenBucket("identity_context", [who, char, persona, card].filter(Boolean).join("\n"), { source: "character_persona_card" }),
        tokenBucket("memory_retrieval", mem, { source: "archive_memory", maxItems: archiveItems }),
    ].filter((bucket) => bucket.chars > 0);
    try { window.__uieLastRootProtocolBuckets = buckets; } catch (_) {}
    return `
[SYSTEM OVERRIDE: IMMERSION_PROTOCOL_V26]
[CRITICAL PRIORITY: HIGHEST]

[CRITICAL DIALOGUE RULE: RESPONSE FORMATTING]
- The AI must NEVER end its response with questions prompting the player, such as "What do you do?", "What do you do next?", "How do you respond?", or any variant asking the player for action.
- Trailing questions that prompt the player for input are strictly forbidden. Conclude all responses naturally with dialogue or descriptive narration. The player interface handles action prompt inputs.
- This is immersive AI roleplay first, not a menu-driven game. Treat the player's message as embodied character intent inside the current scene.
- Never answer player intent with bland navigation denial or meta summaries like "the idea forms in your mind" or "you would first need to leave this building." If the desired destination is not immediately reachable, dramatize the nearest physical step, obstacle, sensory cue, or NPC reaction in-world.

/// EXECUTION MANDATE ///
Before generating output, the AI MUST execute the following Reality Check sequence.
Failure to connect these data points is a system failure.
[SYSTEM: Do not hallucinate system hardware/interfaces (e.g., turnstiles, screens) unless explicitly part of the setting. Describe inventory naturally.]

1) CHAT LOG SYNC (MANDATORY)
Scan the recent ${recentMessages} messages provided below.
Current action MUST flow logically from recent events.
Do not reset the scene.
--- CHAT LOG (last messages) ---
${chat}

1B) OMNISCIENT GAME STATE (High Priority Overrides)
${[combat, stats, progression, partyBattle, status, world, academy, magicKnowledge, quest, texts, phoneTrigger].filter(Boolean).join("\n") || "[GAME STATE = None]"}

2) INVENTORY AUDIT
Scan user's current inventory. If user attempts to use an unowned item -> NARRATE FAILURE.
If user uses an item -> describe it based on its properties/tags.
--- INVENTORY ---
${inv}

3) DIGITAL STATE CHECK (Conditional)
${digital}

4) TEMPORAL ANCHOR
${temporal}

5) LOREBOOK INDEX (Names Only)
[Lore_Keys = ${combatQuarantine ? "Combat quarantine active: only immediate combatants and recent chat may guide narration." : lore}]

5B) WORLD INFO (Selected)
${worldInfo || "[WORLD INFO = None]"}

6) IDENTITIES (Hard Facts)
[User = ${who}]
[Character_Context = ${char}]
${persona ? `\n${persona}` : ""}
${card ? `\n${card}` : ""}

7) ARCHIVE RETRIEVAL
Integrate any injected memories as absolute facts.
${mem ? `--- INJECTED MEMORIES ---\n${mem}` : `[INJECTED MEMORIES = None]`}
`.trim();
}

async function confirmAICall({ what, providerModel, preview }) {
    try {
        if (window.__uieSkipAiConfirmOnce) {
            window.__uieSkipAiConfirmOnce = false;
            return true;
        }
    } catch (_) {}
    ensureConfirmModal();
    $("#uie-ai-confirm-what").text(String(what || "Generation"));
    $("#uie-ai-confirm-model").text(String(providerModel || "Unknown"));
    $("#uie-ai-confirm-preview").text(String(preview || ""));
    try {
        const s = getSettings();
        const show = s?.generation?.showPromptBox === true;
        $("#uie-ai-confirm-preview-wrap").toggle(!!show);
        if (!show) $("#uie-ai-confirm-preview").text("");
    } catch (_) {}

    return await new Promise((resolve) => {
        const $m = $("#uie-ai-confirm");
        const cancel = () => {
            cleanup();
            resolve(false);
        };
        const go = () => {
            cleanup();
            resolve(true);
        };
        const cleanup = () => {
            $(document).off("keydown.uieAiConfirm");
            $("#uie-ai-confirm-cancel").off("click.uieAiConfirm");
            $("#uie-ai-confirm-go").off("click.uieAiConfirm");
            $m.hide();
        };

        $("#uie-ai-confirm-cancel").off("click.uieAiConfirm").on("click.uieAiConfirm", cancel);
        $("#uie-ai-confirm-go").off("click.uieAiConfirm").on("click.uieAiConfirm", go);
        $(document).off("keydown.uieAiConfirm").on("keydown.uieAiConfirm", (e) => {
            if (e.key === "Escape") cancel();
        });

        $m.css("display", "flex");
        setTimeout(() => $("#uie-ai-confirm-cancel").trigger("focus"), 0);
    });
}

function normalizeTurboInputUrl(u) {
    let raw = String(u || "").trim();
    if (!raw) return "";
    raw = raw.replace(/,/g, ".");
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    return raw;
}

export function apiConfigFingerprint(config = {}) {
    const key = resolveApiKey(String(config?.key || "").trim());
    return [
        String(config?.provider || "").trim().toLowerCase(),
        normalizeTurboInputUrl(config?.url).replace(/\/+$/g, ""),
        String(config?.model || "").trim(),
        String(config?.endpointShape || "auto").trim().toLowerCase(),
        key ? `${key.length}:${key.slice(0, 3)}:${key.slice(-3)}` : "no-key",
    ].join("|");
}

function isVerifiedApiConfig(config = {}) {
    const health = config?.connectionHealth;
    return health?.ok === true && String(health?.fingerprint || "") === apiConfigFingerprint(config);
}

function extractProviderErrorMessage(raw = "") {
    const text = String(raw || "").trim();
    if (!text) return "";
    try {
        const parsed = JSON.parse(text);
        return String(
            parsed?.error?.message ||
            parsed?.error?.detail ||
            parsed?.message ||
            parsed?.detail ||
            parsed?.error ||
            ""
        ).trim();
    } catch (_) {
        return text.replace(/\s+/g, " ").trim();
    }
}

export function describeApiFailure(detail = {}, label = "API") {
    const status = Number(detail?.status || detail?.httpStatus || 0);
    const raw = extractProviderErrorMessage(detail?.error || detail?.message || "");
    const suffix = raw ? ` ${raw.replace(/^API Error \d+:\s*/i, "").slice(0, 320)}` : "";
    if (status === 400) return `${label}: the provider rejected the request (400). Check the selected model and endpoint shape.${suffix}`;
    if (status === 401) return `${label}: authentication failed (401). The API key is missing, invalid, or expired.${suffix}`;
    if (status === 403) return `${label}: access denied (403). This key or account cannot use the selected model.${suffix}`;
    if (status === 404) return `${label}: endpoint or model not found (404). Check the provider URL and exact model ID.${suffix}`;
    if (status === 429) return `${label}: rate limit or quota exceeded (429). Wait, add credits, or select another provider.${suffix}`;
    if (status >= 500) return `${label}: provider server error (${status}). Try again later or select another provider.${suffix}`;
    if (/local proxy returned 404|port \d+/i.test(raw)) return `${label}: the UIE proxy is unavailable. Start this app with the project dev server and reload the current page.`;
    if (/failed to fetch|networkerror|load failed|cors/i.test(raw)) return `${label}: network/CORS failure. The provider could not be reached through the UIE proxy.${suffix}`;
    if (raw) return `${label}: ${raw.slice(0, 380)}`;
    return `${label}: generation could not start because no verified provider is available. Test a connection in Settings.`;
}

function buildTurboUrlCandidates(rawUrl) {
    const input = normalizeTurboInputUrl(rawUrl);
    if (!input) return [];
    const m = input.match(/^([^?#]+)([?#].*)?$/);
    const base0 = String(m?.[1] || input).trim().replace(/\/+$/g, "");
    const suffix = String(m?.[2] || "");

    const add = (u, out) => {
        const x = String(u || "").trim();
        if (!x) return;
        if (!out.includes(x)) out.push(x);
    };

    const out = [];

    const isOpenRouterHost = (() => {
        try {
            const u = new URL(base0);
            return String(u.hostname || "").toLowerCase().includes("openrouter.ai");
        } catch (_) {
            return /openrouter\.ai/i.test(base0);
        }
    })();

    const isNanoGptHost = (() => {
        try {
            const u = new URL(base0);
            const h = String(u.hostname || "").toLowerCase();
            return h.includes("nano-gpt.com") || h.includes("nanogpt");
        } catch (_) {
            return /nano-?gpt/i.test(base0);
        }
    })();

    const isGoogleOpenAiCompat = (() => {
        try {
            const u = new URL(base0);
            return String(u.hostname || "").toLowerCase().includes("generativelanguage.googleapis.com")
                && /\/openai(\/|$)/i.test(u.pathname);
        } catch (_) {
            return /generativelanguage\.googleapis\.com\/.*\/openai(\/|$)/i.test(base0);
        }
    })();

    const hasApiV1 = /\/api\/v1$/i.test(base0) || /\/api\/v1\//i.test(base0);

    if (/\/v1\/messages$/i.test(base0)) {
        add(`${base0}${suffix}`, out);
        return out;
    }

    // Gemini's OpenAI-compatible API supports chat completions, but not the
    // Responses or legacy completions endpoints. Avoid expected 404 fallbacks.
    if (isGoogleOpenAiCompat && /\/openai$/i.test(base0)) {
        add(`${base0}/chat/completions${suffix}`, out);
        return out;
    }

    if (/\/v1$/i.test(base0)) {
        if (isOpenRouterHost && !/\/api\/v1$/i.test(base0)) {
            add(`${base0.replace(/\/v1$/i, "/api/v1")}/chat/completions${suffix}`, out);
            add(`${base0.replace(/\/v1$/i, "/api/v1")}/completions${suffix}`, out);
            add(`${base0.replace(/\/v1$/i, "/api/v1")}/responses${suffix}`, out);
        }
        add(`${base0}/chat/completions${suffix}`, out);
        add(`${base0}/completions${suffix}`, out);
        add(`${base0}/responses${suffix}`, out);
        if (isOpenRouterHost) {
            add(`/api/openrouter/v1/chat/completions${suffix}`, out);
            add(`/api/openrouter/chat/completions${suffix}`, out);
            add(`/api/openrouter/v1/completions${suffix}`, out);
            add(`/api/openrouter/completions${suffix}`, out);
            add(`/api/openrouter/v1/responses${suffix}`, out);
            add(`/api/openrouter/responses${suffix}`, out);
        }
        return out;
    }

    if (/\/api\/v1$/i.test(base0)) {
        add(`${base0}/chat/completions${suffix}`, out);
        add(`${base0}/completions${suffix}`, out);
        add(`${base0}/responses${suffix}`, out);
        if (isNanoGptHost) {
            add(`${base0.replace(/\/api\/v1$/i, "/v1")}/chat/completions${suffix}`, out);
            add(`${base0.replace(/\/api\/v1$/i, "/v1")}/completions${suffix}`, out);
            add(`${base0.replace(/\/api\/v1$/i, "/v1")}/responses${suffix}`, out);
        }
        return out;
    }

    if (/\/v1\/chat\/completions$/i.test(base0)) {
        if (isOpenRouterHost && !/\/api\/v1\/chat\/completions$/i.test(base0)) {
            add(`${base0.replace(/\/v1\/chat\/completions$/i, "/api/v1/chat/completions")}${suffix}`, out);
        }
        add(`${base0}${suffix}`, out);
        add(`${base0.replace(/\/chat\/completions$/i, "/completions")}${suffix}`, out);
        add(`${base0.replace(/\/chat\/completions$/i, "/responses")}${suffix}`, out);
        return out;
    }

    if (/\/api\/v1\/chat\/completions$/i.test(base0)) {
        add(`${base0}${suffix}`, out);
        add(`${base0.replace(/\/chat\/completions$/i, "/completions")}${suffix}`, out);
        add(`${base0.replace(/\/chat\/completions$/i, "/responses")}${suffix}`, out);
        if (isNanoGptHost) {
            add(`${base0.replace(/\/api\/v1\/chat\/completions$/i, "/v1/chat/completions")}${suffix}`, out);
        }
        return out;
    }

    if (/\/v1\/completions$/i.test(base0)) {
        if (isOpenRouterHost && !/\/api\/v1\/completions$/i.test(base0)) {
            add(`${base0.replace(/\/v1\/completions$/i, "/api/v1/chat/completions")}${suffix}`, out);
            add(`${base0.replace(/\/v1\/completions$/i, "/api/v1/completions")}${suffix}`, out);
            add(`${base0.replace(/\/v1\/completions$/i, "/api/v1/responses")}${suffix}`, out);
        }
        add(`${base0.replace(/\/completions$/i, "/chat/completions")}${suffix}`, out);
        add(`${base0}${suffix}`, out);
        add(`${base0.replace(/\/completions$/i, "/responses")}${suffix}`, out);
        return out;
    }

    if (/\/api\/v1\/completions$/i.test(base0)) {
        add(`${base0.replace(/\/completions$/i, "/chat/completions")}${suffix}`, out);
        add(`${base0}${suffix}`, out);
        add(`${base0.replace(/\/completions$/i, "/responses")}${suffix}`, out);
        if (isNanoGptHost) add(`${base0.replace(/\/api\/v1\/completions$/i, "/v1/completions")}${suffix}`, out);
        return out;
    }

    if (/\/v1\/responses$/i.test(base0)) {
        if (isOpenRouterHost && !/\/api\/v1\/responses$/i.test(base0)) {
            add(`${base0.replace(/\/v1\/responses$/i, "/api/v1/chat/completions")}${suffix}`, out);
            add(`${base0.replace(/\/v1\/responses$/i, "/api/v1/completions")}${suffix}`, out);
            add(`${base0.replace(/\/v1\/responses$/i, "/api/v1/responses")}${suffix}`, out);
        }
        add(`${base0.replace(/\/responses$/i, "/chat/completions")}${suffix}`, out);
        add(`${base0.replace(/\/responses$/i, "/completions")}${suffix}`, out);
        add(`${base0}${suffix}`, out);
        return out;
    }

    if (/\/api\/v1\/responses$/i.test(base0)) {
        add(`${base0.replace(/\/responses$/i, "/chat/completions")}${suffix}`, out);
        add(`${base0.replace(/\/responses$/i, "/completions")}${suffix}`, out);
        add(`${base0}${suffix}`, out);
        if (isNanoGptHost) add(`${base0.replace(/\/api\/v1\/responses$/i, "/v1/responses")}${suffix}`, out);
        return out;
    }

    if (/\/chat$/i.test(base0)) {
        add(`${base0}/completions${suffix}`, out);
        return out;
    }

    if (/\/chat\/completions$/i.test(base0)) {
        add(`${base0}${suffix}`, out);
        return out;
    }

    if (isOpenRouterHost && !/\/api(\/|$)/i.test(base0)) {
        add(`${base0}/api/v1/chat/completions${suffix}`, out);
        add(`${base0}/api/v1/completions${suffix}`, out);
        add(`${base0}/api/v1/responses${suffix}`, out);
    }
    if (isOpenRouterHost) {
        add(`/api/openrouter/v1/chat/completions${suffix}`, out);
        add(`/api/openrouter/chat/completions${suffix}`, out);
        add(`/api/openrouter/v1/completions${suffix}`, out);
        add(`/api/openrouter/completions${suffix}`, out);
        add(`/api/openrouter/v1/responses${suffix}`, out);
        add(`/api/openrouter/responses${suffix}`, out);
    }

    if (hasApiV1) {
        add(`${base0.replace(/\/+$/g, "")}/api/v1/chat/completions${suffix}`, out);
        add(`${base0.replace(/\/+$/g, "")}/api/v1/completions${suffix}`, out);
        add(`${base0.replace(/\/+$/g, "")}/api/v1/responses${suffix}`, out);
    }

    add(`${base0}/v1/chat/completions${suffix}`, out);
    add(`${base0}/v1/completions${suffix}`, out);
    add(`${base0}/v1/responses${suffix}`, out);
    add(`${base0}/chat/completions${suffix}`, out);
    add(`${base0}/completions${suffix}`, out);
    add(`${base0}/responses${suffix}`, out);
    return out;
}

function numOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function maybeNumber(v, fallback = null) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function csvList(v) {
    if (Array.isArray(v)) return v.map((x) => String(x || "").trim()).filter(Boolean);
    return String(v || "").split(/\r?\n|,/g).map((x) => String(x || "").trim()).filter(Boolean);
}

function applyTextCompletionSamplers(config = {}, body = {}, mode = "openai") {
    const map = [
        ["minP", "min_p"],
        ["topA", "top_a"],
        ["typicalP", "typical"],
        ["tfs", "tfs"],
        ["repPen", "rep_pen"],
        ["repPenRange", "rep_pen_range"],
        ["repPenSlope", "rep_pen_slope"],
        ["smoothingFactor", "smoothing_factor"],
        ["dynatempRange", "dynatemp_range"],
        ["dynatempExponent", "dynatemp_exponent"],
        ["mirostatMode", "mirostat_mode"],
        ["mirostatTau", "mirostat_tau"],
        ["mirostatEta", "mirostat_eta"],
        ["epsilonCutoff", "epsilon_cutoff"],
        ["etaCutoff", "eta_cutoff"],
    ];
    for (const [key, outKey] of map) {
        const value = maybeNumber(config[key], null);
        if (value == null) continue;
        const isNeutral =
            (["minP", "topA", "smoothingFactor", "dynatempRange", "mirostatMode", "epsilonCutoff", "etaCutoff"].includes(key) && value === 0) ||
            (["typicalP", "tfs", "repPen"].includes(key) && value === 1);
        if (!isNeutral) body[outKey] = value;
    }
    if (config.singleline === true) body.singleline = true;
    if (config.trimIncomplete === true) body.frmttriminc = true;
    if (config.removeSpecial === true) body.frmtrmspch = true;
    const grammar = String(config.grammar || "").trim();
    if (grammar) body.grammar = grammar;
    if (mode === "horde") {
        const order = csvList(config.hordeSamplerOrder).map((x) => Number(x)).filter((x) => Number.isInteger(x));
        if (order.length) body.sampler_order = order;
    }
    return body;
}

function estimateUsageFromText(promptText = "", replyText = "") {
    const promptTokens = Math.max(0, Math.ceil(String(promptText || "").length / 4));
    const completionTokens = Math.max(0, Math.ceil(String(replyText || "").length / 4));
    return {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimated: true,
    };
}

function approxTokenCount(text = "") {
    return Math.max(0, Math.ceil(String(text || "").length / 4));
}

function tokenBucket(label, text = "", meta = {}) {
    const chars = String(text || "").length;
    return {
        label: String(label || "unknown"),
        chars,
        tokens: approxTokenCount(text),
        ...meta,
    };
}

function publishTokenUsageTrace(trace = {}) {
    try {
        const s = getSettings();
        if (!s.generation || typeof s.generation !== "object") s.generation = {};
        const buckets = Array.isArray(trace.buckets) ? trace.buckets : [];
        const usage = trace.usage && typeof trace.usage === "object" ? trace.usage : null;
        const inputTokens = usage?.promptTokens ?? buckets.reduce((sum, b) => sum + (Number(b?.tokens) || 0), 0);
        const outputTokens = usage?.completionTokens ?? approxTokenCount(trace.outputText || "");
        const totalTokens = usage?.totalTokens ?? (inputTokens + outputTokens);
        const row = {
            id: `trace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            at: Date.now(),
            kind: String(trace.kind || "Generation"),
            route: String(trace.route || ""),
            model: String(trace.model || ""),
            wallMs: Number(trace.wallMs || 0) || 0,
            usage: {
                promptTokens: inputTokens,
                completionTokens: outputTokens,
                totalTokens,
                estimated: usage?.estimated === true || !usage,
            },
            buckets,
        };
        s.generation.tokenUsageLog = Array.isArray(s.generation.tokenUsageLog) ? s.generation.tokenUsageLog : [];
        s.generation.tokenUsageLog.unshift(row);
        s.generation.tokenUsageLog = s.generation.tokenUsageLog.slice(0, 200);
        try { window.UIE_lastTokenUsageTrace = row; } catch (_) {}
        try { window.dispatchEvent(new CustomEvent("uie-token-usage", { detail: row })); } catch (_) {}
        try { saveSettings(); } catch (_) {}
        return row;
    } catch (_) {
        return null;
    }
}

/** OpenAI / OpenRouter / Anthropic-style usage blocks for console + UIE_lastTurbo. */
function extractUsageFromApiJson(data) {
    try {
        const u = data?.usage;
        if (!u || typeof u !== "object") return null;
        const promptTokens = numOrNull(u.prompt_tokens ?? u.promptTokens ?? u.input_tokens);
        const completionTokens = numOrNull(u.completion_tokens ?? u.completionTokens ?? u.output_tokens);
        let totalTokens = numOrNull(u.total_tokens ?? u.totalTokens);
        if (totalTokens == null && promptTokens != null && completionTokens != null) {
            totalTokens = promptTokens + completionTokens;
        }
        if (promptTokens == null && completionTokens == null && totalTokens == null) return null;
        return { promptTokens, completionTokens, totalTokens };
    } catch (_) {
        return null;
    }
}

function uieApiTraceEnabled() {
    try {
        const s = getSettings();
        if (s?.generation?.quietConsoleApiLog === true) return false;
        if (s?.turbo?.consoleApiLog === false) return false;
        return true;
    } catch (_) {
        return true;
    }
}

function uieApiConsole(phase, payload = {}) {
    if (!uieApiTraceEnabled()) return;
    try {
        const row = { phase, ts: new Date().toISOString(), ...payload };
        console.log(`[UIE/API] ${phase}`, row);
    } catch (_) {}
}

function dispatchUieGenerationEvent(detail) {
    try {
        window.dispatchEvent(new CustomEvent("uie-generation", { detail }));
    } catch (_) {}
}

try {
    window.UIE_getTokenUsageLog = () => {
        try {
            const log = getSettings()?.generation?.tokenUsageLog;
            return Array.isArray(log) ? log.slice() : [];
        } catch (_) {
            return [];
        }
    };
} catch (_) {}

/** Skip the next AI confirmation modal once (e.g. ambient Living HTML during VN send). */
export function skipNextAiConfirmOnce() {
    try {
        window.__uieSkipAiConfirmOnce = true;
    } catch (_) {}
}

/** Call from VN host after parsing speaker + cleaned reply (token usage is logged separately on the HTTP response). */
export function logDialogueReplyMeta({ speaker = "", replyChars = 0, kind = "VN Dialogue" } = {}) {
    uieApiConsole("dialogue_attributed", {
        speaker: String(speaker || "").trim() || "?",
        replyChars: Number(replyChars) || 0,
        kind: String(kind || "").trim() || "VN Dialogue",
    });
}

let uieCsrfCache = { t: 0, token: "" };

function getConfiguredProxyOrigin() {
    try {
        const explicit = String(window.UIE_PROXY_ORIGIN || localStorage.getItem("uie_proxy_origin") || "").trim();
        if (/^https?:\/\//i.test(explicit)) return explicit.replace(/\/+$/g, "");
    } catch (_) {}
    try {
        if (/^https?:$/i.test(window.location.protocol || "") && window.location.host) return window.location.origin;
    } catch (_) {}
    return "";
}

async function getCsrfToken() {
    const now = Date.now();
    if (uieCsrfCache.token && now - uieCsrfCache.t < 5 * 60 * 1000) return uieCsrfCache.token;
    try {
        const origin = getConfiguredProxyOrigin();
        const url = origin ? `${origin}/csrf-token` : "/csrf-token";
        const r = await fetch(url, { method: "GET" }).catch(() => null);
        if (!r || !r.ok) return "";
        const j = await r.json().catch(() => null);
        const tok = String(j?.csrfToken || j?.token || "").trim();
        if (tok) uieCsrfCache = { t: now, token: tok };
        return tok;
    } catch (_) {
        return "";
    }
}

function buildCorsProxyCandidates(targetUrl) {
    const u = String(targetUrl || "").trim();
    if (!u) return [];
    const enc = encodeURIComponent(u);
    const out = [];
    const add = (x) => { if (x && !out.includes(x)) out.push(x); };

    const origin = getConfiguredProxyOrigin();

    add(`/api/proxy?url=${enc}`);
    add(`/api/cors-proxy?url=${enc}`);
    add(`/cors-proxy?url=${enc}`);
    add(`/api/proxy/${enc}`);

    if (origin && origin !== window.location.origin) {
        add(`${origin}/api/proxy?url=${enc}`);
        add(`${origin}/api/cors-proxy?url=${enc}`);
        add(`${origin}/cors-proxy?url=${enc}`);
        add(`${origin}/api/proxy/${enc}`);
    }

    return out;
}

function isFailedToFetchError(e) {
    const m = String(e?.message || e || "").toLowerCase();
    return m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed");
}

async function fetchWithCorsProxyFallback(targetUrl, options) {
    const isLocalhost = window.location.hostname === "localhost" || 
                        window.location.hostname === "127.0.0.1" || 
                        window.location.hostname === "0.0.0.0" ||
                        /^192\.168\./.test(window.location.hostname) ||
                        /^10\./.test(window.location.hostname) ||
                        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(window.location.hostname) ||
                        window.location.protocol === "file:";
    const isRemote = /^https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(targetUrl);
    let hasLocalProxy404 = false;
    
    const tryServerForward = async (endpoint) => {
        try {
            const targetHdr = new Headers(options?.headers || {});
            const hdr = new Headers();
            hdr.set("Content-Type", "application/json");
            const payload = {
                url: String(targetUrl || ""),
                method: String(options?.method || "GET"),
                headers: Object.fromEntries(targetHdr.entries()),
                body: options?.body ?? null
            };
            const tok = await getCsrfToken();
            if (tok && !hdr.has("X-CSRF-Token")) hdr.set("X-CSRF-Token", tok);

            // 1. Try relative endpoint
            let r = null;
            try {
                r = await fetch(String(endpoint || ""), { method: "POST", headers: hdr, body: JSON.stringify(payload), credentials: "same-origin", signal: options?.signal });
            } catch (_) {}

            // 2. Try the configured proxy origin if it is different from the current page.
            const origin = getConfiguredProxyOrigin();
            if ((!r || r.status === 404 || r.status === 502) && origin && origin !== window.location.origin) {
                try {
                    r = await fetch(`${origin}${endpoint}`, { method: "POST", headers: hdr, body: JSON.stringify(payload), signal: options?.signal });
                } catch (_) {}
            }

            if (!r) return null;

            if (r.status >= 400) {
                const isForwarded = r.headers.get("x-uie-proxy") === "true";
                if (!isForwarded) {
                    if (r.status === 404) {
                        hasLocalProxy404 = true;
                    }
                    return null;
                }
            }
            return r;
        } catch (_) {
            return null;
        }
    };

    // If running on localhost and target is a remote third-party API, route through local proxy first to avoid CORS preflight console errors.
    if (isLocalhost && isRemote) {
        for (const ep of ["/api/proxy", "/api/cors-proxy", "/api/corsProxy"]) {
            const r = await tryServerForward(ep);
            if (r) return { response: r, via: "server-forward", requestUrl: ep };
        }
    }

    try {
        const r = await fetch(targetUrl, options);
        return { response: r, via: "direct", requestUrl: targetUrl };
    } catch (e) {
        if (isLocalhost) {
            for (const ep of ["/api/proxy", "/api/cors-proxy", "/api/corsProxy"]) {
                const r = await tryServerForward(ep);
                if (r) return { response: r, via: "server-forward", requestUrl: ep };
            }
        }
        if (!isFailedToFetchError(e)) throw e;
        const candidates = buildCorsProxyCandidates(targetUrl);
        let lastErr = e;
        for (const ep of ["/api/proxy", "/api/cors-proxy", "/api/corsProxy"]) {
            const r = await tryServerForward(ep);
            if (r) return { response: r, via: "server-forward", requestUrl: ep };
        }
        for (const proxyUrl of candidates) {
            try {
                let r = await fetch(proxyUrl, options);
                if (r.status >= 400) {
                    const isForwarded = r.headers.get("x-uie-proxy") === "true";
                    if (!isForwarded) {
                        if (r.status === 404) {
                            hasLocalProxy404 = true;
                        }
                        if (r.status === 403 || r.status === 401) {
                            const tok = await getCsrfToken();
                            if (tok) {
                                const h = new Headers(options?.headers || {});
                                if (!h.has("X-CSRF-Token")) h.set("X-CSRF-Token", tok);
                                const r2 = await fetch(proxyUrl, { ...options, headers: h });
                                if (r2.status >= 400 && r2.headers.get("x-uie-proxy") !== "true") {
                                    if (r2.status === 404) hasLocalProxy404 = true;
                                    continue;
                                }
                                r = r2;
                            } else {
                                continue;
                            }
                        } else {
                            continue;
                        }
                    }
                }
                return { response: r, via: "proxy", requestUrl: proxyUrl };
            } catch (e2) {
                lastErr = e2;
                continue;
            }
        }
        let msg = "Failed to fetch (CORS/network). Enable a host-side CORS proxy or use a local gateway, then retry.";
        if (hasLocalProxy404) {
            msg = "Failed to fetch (CORS/network) and the local proxy returned 404. " +
                  "This usually means the current page is not being served by dev-server.mjs, " +
                  "or another static server is occupying the project URL. " +
                  "Close the extra server, start the app with the project dev server, and reload.";
            console.error("[UIE/API] " + msg);
            try {
                if (typeof window.showToast === "function") {
                    window.showToast("Dev server proxy unavailable. Reload the project server and try again.", 8000);
                }
            } catch (_) {}
        }
        throw new Error(msg);
    }
}

async function generateFromApiConfig(t, prompt, systemPrompt, traceMeta = {}) {
    if (isSystemLockedOut()) {
        enforceLockoutScreen();
        throw new Error("UIE Security Lockout Active: Fatal System Tamper");
    }
    if (!t || typeof t !== "object") return null;
    
    const kind = String(traceMeta?.kind || "").trim();
    const isSystemCheck = ["Auto-Warp Detection", "System Check", "Shop", "Gathering list!", "Journal Quests", "Unified State Scan", "Helper Pet Mutation"].includes(kind);

    // Safety scanner scan
    if (!isSystemCheck) {
        if (scanContentForSafetyViolations(prompt, "user prompt") || scanContentForSafetyViolations(systemPrompt, "system instructions")) {
            return null;
        }
    }

    const limited = applyRequestTokenLimits(t, prompt, systemPrompt);
    prompt = limited.prompt;
    systemPrompt = limited.systemPrompt;

    const isAiHorde = t.apiMode === "aihorde" || String(t.provider).toLowerCase() === "aihorde";

    if (isAiHorde) {
        const startedAt = Date.now();
        const traceKind = String(traceMeta?.kind || "llm").trim() || "llm";
        const asyncUrl = "https://aihorde.net/api/v2/generate/text/async";
        try {
        const decodeEscape = (str) => {
            if (typeof str !== "string") return "";
            return str.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
        };
        const sysPrefix = decodeEscape(t.textSystemPrefix !== undefined ? t.textSystemPrefix : "### System:\\n");
        const sysSuffix = decodeEscape(t.textSystemSuffix !== undefined ? t.textSystemSuffix : "\\n\\n");
        const userPrefix = decodeEscape(t.textUserPrefix !== undefined ? t.textUserPrefix : "### Instruction:\\n");
        const userSuffix = decodeEscape(t.textUserSuffix !== undefined ? t.textUserSuffix : "\\n\\n");
        const aiPrefix = decodeEscape(t.textAiPrefix !== undefined ? t.textAiPrefix : "### Response:\\n");
        const wrapNewline = t.textWrapNewline !== false;

        let hordePrompt = "";
        if (systemPrompt && String(systemPrompt).trim()) {
            hordePrompt += sysPrefix + String(systemPrompt).trim() + sysSuffix;
        }
        hordePrompt += userPrefix + String(prompt || "").trim() + userSuffix + aiPrefix;
        if (wrapNewline && !hordePrompt.endsWith("\n")) {
            hordePrompt += "\n";
        }

        const apiKey = resolveApiKey(String(t.key || "").trim()) || "0000000000";
        const hordeHeaders = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "apikey": apiKey,
            "Client-Agent": "UniversalImmersionEngine:1.0.0"
        };

        const hordeBody = {
            "prompt": hordePrompt,
            "params": {
                "temperature": Number.isFinite(Number(t.temp)) ? Number(t.temp) : 0.7,
                "top_p": Number.isFinite(Number(t.topp)) ? Number(t.topp) : 1.0,
                "top_k": Number.isFinite(Number(t.topk)) ? Number(t.topk) : 0,
                "max_context_length": limited.contextTokens,
                "max_length": limited.outputTokens
            },
            "models": [String(t.model || "meta-llama/Llama-3-8b-Instruct").trim()]
        };
        applyTextCompletionSamplers(t, hordeBody.params, "horde");
        const workers = csvList(t.hordeWorkers);
        if (workers.length) hordeBody.workers = workers;
        if (t.hordeTrustedWorkers === true) hordeBody.trusted_workers = true;
        if (t.hordeSlowWorkers === false) hordeBody.slow_workers = false;
        if (typeof t.hordeWorkerBlacklist === "boolean") hordeBody.worker_blacklist = t.hordeWorkerBlacklist;
        if (typeof t.hordeCensorNsfw === "boolean") hordeBody.censor_nsfw = t.hordeCensorNsfw;
        if (typeof t.hordeDryRun === "boolean") hordeBody.dry_run = t.hordeDryRun;
        if (typeof t.hordeDisableBatching === "boolean") hordeBody.disable_batching = t.hordeDisableBatching;
        if (String(t.hordeSoftprompt || "").trim()) hordeBody.softprompt = String(t.hordeSoftprompt || "").trim();

        const reqWallStart = Date.now();
        uieApiConsole("llm_request_start", {
            kind: traceKind,
            transport: "non-streaming",
            model: String(t.model || "meta-llama/Llama-3-8b-Instruct").trim(),
            endpointHost: "aihorde.net",
            systemChars: String(systemPrompt || "").length,
            userChars: String(prompt || "").length,
            note: "Submitting generation job to AI Horde asynchronously.",
        });

        let postRes = null;
        let postData = null;
        let hordeAttempt = 0;
        const triedHordeKeys = new Set([String(t.key || "").trim()]);

        while (hordeAttempt < 5) {
            hordeAttempt++;
            try {
                const currentHordeKey = resolveApiKey(String(t.key || "").trim()) || "0000000000";
                hordeHeaders.apikey = currentHordeKey;

                postRes = await fetchWithCorsProxyFallback(asyncUrl, {
                    method: "POST",
                    headers: hordeHeaders,
                    body: JSON.stringify(hordeBody),
                    signal: traceMeta?.signal
                });

                if (!postRes || !postRes.response || !postRes.response.ok) {
                    const status = postRes?.response?.status || 0;
                    if (status === 401 || status === 403) {
                        const next = handleApiKeyFailureAndSwitch(t, t.key);
                        if (next && !triedHordeKeys.has(next.keyId)) {
                            triedHordeKeys.add(next.keyId);
                            t.key = next.keyId;
                            continue;
                        }
                    }
                    const errText = postRes?.response ? await postRes.response.text().catch(() => "") : "";
                    const errMsg = `AI Horde Request failed: ${errText || "No response"}`;
                    window.UIE_lastTurbo = { ok: false, url: asyncUrl, ms: Date.now() - startedAt, status: status, error: errMsg };
                    uieApiConsole("llm_request_done", {
                        kind: traceKind,
                        ok: false,
                        httpStatus: status,
                        wallMs: Date.now() - reqWallStart,
                        transport: "non-streaming",
                        error: errMsg,
                    });
                    return null;
                }

                postData = await postRes.response.json().catch(() => null);
                break;
            } catch (e) {
                if (e?.name === "AbortError" || traceMeta?.signal?.aborted) throw e;
                break;
            }
        }
            if (!postData || !postData.id) {
                const errMsg = `AI Horde async call did not return a valid Job ID: ${JSON.stringify(postData)}`;
                window.UIE_lastTurbo = { ok: false, url: asyncUrl, ms: Date.now() - startedAt, status: 200, error: errMsg };
                uieApiConsole("llm_request_done", {
                    kind: traceKind,
                    ok: false,
                    httpStatus: 200,
                    wallMs: Date.now() - reqWallStart,
                    transport: "non-streaming",
                    error: errMsg,
                });
                return null;
            }

            const jobId = postData.id;
            let done = false;
            let attempts = 0;
            const maxAttempts = 60;
            let textResult = "";

            while (!done && attempts < maxAttempts) {
                attempts++;
                await new Promise(r => setTimeout(r, 2000));

                const statusUrl = `https://aihorde.net/api/v2/generate/text/status/${jobId}`;
                const statusRes = await fetchWithCorsProxyFallback(statusUrl, {
                    method: "GET",
                    headers: {
                        "Accept": "application/json",
                        "Client-Agent": "UniversalImmersionEngine:1.0.0"
                    }
                });

                if (!statusRes || !statusRes.response || !statusRes.response.ok) {
                    console.warn(`[UIE/AI Horde] Polling attempt ${attempts} failed to fetch status.`);
                    continue;
                }

                const statusData = await statusRes.response.json().catch(() => null);
                if (!statusData) continue;

                if (statusData.faulted) {
                    const errMsg = "AI Horde generation job faulted.";
                    window.UIE_lastTurbo = { ok: false, url: statusUrl, ms: Date.now() - startedAt, status: 200, error: errMsg };
                    uieApiConsole("llm_request_done", {
                        kind: traceKind,
                        ok: false,
                        httpStatus: 200,
                        wallMs: Date.now() - reqWallStart,
                        transport: "non-streaming",
                        error: errMsg,
                    });
                    return null;
                }

                if (statusData.done) {
                    done = true;
                    if (statusData.generations && statusData.generations[0]) {
                        textResult = statusData.generations[0].text;
                    } else {
                        const errMsg = "AI Horde generation completed but returned no text.";
                        window.UIE_lastTurbo = { ok: false, url: statusUrl, ms: Date.now() - startedAt, status: 200, error: errMsg };
                        uieApiConsole("llm_request_done", {
                            kind: traceKind,
                            ok: false,
                            httpStatus: 200,
                            wallMs: Date.now() - reqWallStart,
                            transport: "non-streaming",
                            error: errMsg,
                        });
                        return null;
                    }
                }
            }

            if (!done) {
                const errMsg = "AI Horde generation timed out after 120 seconds.";
                window.UIE_lastTurbo = { ok: false, url: asyncUrl, ms: Date.now() - startedAt, status: 0, error: errMsg };
                uieApiConsole("llm_request_done", {
                    kind: traceKind,
                    ok: false,
                    wallMs: Date.now() - reqWallStart,
                    transport: "non-streaming",
                    error: errMsg,
                });
                return null;
            }

            window.UIE_lastTurbo = {
                ok: true,
                url: asyncUrl,
                ms: Date.now() - startedAt,
                status: 200,
                error: "",
                via: "direct",
                requestUrl: asyncUrl,
                model: String(t.model || "meta-llama/Llama-3-8b-Instruct").trim(),
                provider: "aihorde",
                usage: {
                    promptTokens: 0,
                    completionTokens: 0,
                    totalTokens: 0
                }
            };

            uieApiConsole("llm_request_done", {
                kind: traceKind,
                ok: true,
                wallMs: Date.now() - reqWallStart,
                transport: "non-streaming",
                replyChars: textResult.length,
            });

            return textResult;

        } catch (e) {
            const errMsg = String(e?.message || e || "AI Horde request failed").slice(0, 360);
            window.UIE_lastTurbo = { ok: false, url: asyncUrl, ms: Date.now() - startedAt, status: 0, error: errMsg };
            uieApiConsole("llm_request_done", {
                kind: traceKind,
                ok: false,
                wallMs: Date.now() - startedAt,
                transport: "non-streaming",
                error: errMsg,
            });
            return null;
        }
    }

    let finalPrompt = prompt;
    let finalSystemPrompt = systemPrompt;
    if (t.apiMode === "text") {
        const decodeEscape = (str) => {
            if (typeof str !== "string") return "";
            return str.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
        };
        const sysPrefix = decodeEscape(t.textSystemPrefix !== undefined ? t.textSystemPrefix : "### System:\\n");
        const sysSuffix = decodeEscape(t.textSystemSuffix !== undefined ? t.textSystemSuffix : "\\n\\n");
        const userPrefix = decodeEscape(t.textUserPrefix !== undefined ? t.textUserPrefix : "### Instruction:\\n");
        const userSuffix = decodeEscape(t.textUserSuffix !== undefined ? t.textUserSuffix : "\\n\\n");
        const aiPrefix = decodeEscape(t.textAiPrefix !== undefined ? t.textAiPrefix : "### Response:\\n");
        const wrapNewline = t.textWrapNewline !== false;

        let constructed = "";
        if (systemPrompt && String(systemPrompt).trim()) {
            constructed += sysPrefix + String(systemPrompt).trim() + sysSuffix;
        }
        constructed += userPrefix + String(prompt || "").trim() + userSuffix + aiPrefix;
        if (wrapNewline && !constructed.endsWith("\n")) {
            constructed += "\n";
        }
        finalPrompt = constructed;
        finalSystemPrompt = "";
    }

    const rawUrl = String(t.url || "").trim();
    const rawKey = resolveApiKey(String(t.key || "").trim());
    if (!rawUrl) return null;
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(normalizeTurboInputUrl(rawUrl));
    if (!rawKey && !isLocal && !isAiHorde) return null;

    const urls = buildTurboUrlCandidates(rawUrl);
    if (!urls.length) {
        try { window.UIE_lastTurbo = { ok: false, url: "", ms: 0, status: 0, error: "Invalid API endpoint." }; } catch (_) {}
        return null;
    }

    try {
        const headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "HTTP-Referer": "https://uie.local",
            "X-Title": "UIE"
        };
        const key = rawKey ? rawKey.replace(/^bearer\s+/i, "").trim() : "";
        const providerHost = (() => {
            try { return String(new URL(normalizeTurboInputUrl(rawUrl)).hostname || "").toLowerCase(); } catch (_) { return ""; }
        })();
        const isOpenRouter = providerHost.includes("openrouter.ai");
        const isNvidia = providerHost.includes("nvidia.com");
        const isNanoGpt = providerHost.includes("nano-gpt.com") || providerHost.includes("nanogpt");
        const configuredEndpointShape = String(t.endpointShape || "auto").trim().toLowerCase();
        const endpointShape = providerHost.includes("generativelanguage.googleapis.com") && /\/openai(\/|$)/i.test(rawUrl)
            ? "openai_chat"
            : configuredEndpointShape;
        const stopSequences = Array.isArray(t.stopSequences) ?
             t.stopSequences.map((x) => String(x || "").trim()).filter(Boolean)
            : String(t.stopSequences || "").split(/\r?\n|,/g).map((x) => String(x || "").trim()).filter(Boolean);
        const seed = Number(t.seed || 0);
        const frequencyPenalty = Number(t.frequencyPenalty || 0);
        const presencePenalty = Number(t.presencePenalty || 0);
        const reasoningEffort = String(t.reasoningEffort || "").trim();
        const reasoningTokens = Number(t.reasoningTokens || 0);
        let customHeaders = {};
        try {
            const rawHeaders = String(t.customHeaders || "{}").trim();
            const parsed = rawHeaders ? JSON.parse(rawHeaders) : {};
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) customHeaders = parsed;
        } catch (_) {}
        if (key) {
            headers.Authorization = `Bearer ${key}`;
            if (isNvidia || isNanoGpt) {
                headers["x-api-key"] = key;
                headers["api-key"] = key;
            }
            if (isOpenRouter) {
                delete headers["x-api-key"];
                delete headers["api-key"];
            }
        }
        if (endpointShape === "anthropic_messages" && key) {
            delete headers.Authorization;
            headers["x-api-key"] = key;
            headers["anthropic-version"] = "2023-06-01";
        }
        Object.entries(customHeaders).forEach(([k, v]) => {
            const hk = String(k || "").trim();
            if (!hk) return;
            headers[hk] = String(v ?? "");
        });

        const norm = normalizeTurboInputUrl(rawUrl);
        let model = String(t.model || "").trim();
        if (!model) model = "google/gemini-2.0-flash-exp";
        if (/^https?:\/\/api\.openai\.com(\/|$)/i.test(norm)) {
            const looksDefault = model === "google/gemini-2.0-flash-exp" || /gemini|deepseek|openrouter|google\//i.test(model);
            if (looksDefault) model = "gpt-4o-mini";
        }
        const messages = [
            ...(finalSystemPrompt ? [{ role: "system", content: String(finalSystemPrompt) }] : []),
            { role: "user", content: String(finalPrompt || "") }
        ];
        const baseBody = {
            model,
            temperature: Number.isFinite(Number(t.temp)) ? Number(t.temp) : 0.5,
            top_p: Number.isFinite(Number(t.topp)) ? Number(t.topp) : 1,
            max_tokens: limited.outputTokens,
            stream: false
        };
        const topkVal = Number.isFinite(Number(t.topk)) ? Number(t.topk) : 0;
        const isGoogle = providerHost.includes("googleapis.com") || providerHost.includes("google");
        if (topkVal > 0 && !isGoogle) {
            baseBody.top_k = topkVal;
        }
        if (Number.isFinite(frequencyPenalty) && Math.abs(frequencyPenalty) > 0) baseBody.frequency_penalty = frequencyPenalty;
        if (Number.isFinite(presencePenalty) && Math.abs(presencePenalty) > 0) baseBody.presence_penalty = presencePenalty;
        if (Number.isFinite(seed) && seed !== 0) baseBody.seed = seed;
        if (stopSequences.length) baseBody.stop = stopSequences;
        if (endpointShape === "openai_completions" || t.apiMode === "text") {
            applyTextCompletionSamplers(t, baseBody, "openai");
        }

        let lastErr = "";
        const startedAt = Date.now();
        const traceKind = String(traceMeta?.kind || "llm").trim() || "llm";

        for (const url of urls) {
            let attempt = 0;
            const triedKeys = new Set([String(t.key || "").trim()]);
            while (attempt < 5) {
                attempt++;
                try {
                    let body = null;
                    const resolvedShape = endpointShape !== "auto" ?
                         endpointShape
                        : (/\/responses/i.test(url) ? "openai_responses" : (/\/completions/i.test(url) && !/\/chat\/completions/i.test(url) ? "openai_completions" : "openai_chat"));
                    if (resolvedShape === "anthropic_messages") {
                        body = {
                            model,
                            max_tokens: baseBody.max_tokens,
                            temperature: baseBody.temperature,
                            top_p: baseBody.top_p,
                            system: String(finalSystemPrompt || ""),
                            messages: [{ role: "user", content: String(finalPrompt || "") }],
                            stream: false
                        };
                        if (topkVal > 0) body.top_k = topkVal;
                        if (stopSequences.length) body.stop_sequences = stopSequences;
                        if (Number.isFinite(reasoningTokens) && reasoningTokens > 0) {
                            body.thinking = { type: "enabled", budget_tokens: reasoningTokens };
                        }
                    } else if (resolvedShape === "openai_chat") {
                        body = { ...baseBody, messages };
                        if (reasoningEffort) body.reasoning_effort = reasoningEffort;
                        if (Number.isFinite(reasoningTokens) && reasoningTokens > 0) body.reasoning = { effort: reasoningEffort || "medium", max_tokens: reasoningTokens };
                    } else if (resolvedShape === "openai_completions") {
                        const flat = t.apiMode === "text" ? finalPrompt : messages.map(m => `${String(m.role).toUpperCase()}: ${String(m.content)}`).join("\n\n");
                        body = { ...baseBody, prompt: flat };
                    } else if (resolvedShape === "openai_responses") {
                        body = { ...baseBody, input: messages };
                        if (reasoningEffort || (Number.isFinite(reasoningTokens) && reasoningTokens > 0)) {
                            body.reasoning = {};
                            if (reasoningEffort) body.reasoning.effort = reasoningEffort;
                            if (Number.isFinite(reasoningTokens) && reasoningTokens > 0) body.reasoning.max_tokens = reasoningTokens;
                        }
                    } else {
                        body = { ...baseBody, messages };
                    }

                    const reqWallStart = Date.now();
                    uieApiConsole("llm_request_start", {
                        kind: traceKind,
                        transport: "non-streaming",
                        model,
                        endpointHost: providerHost || (() => {
                            try {
                                return String(new URL(String(url || "").split("?")[0]).hostname || "");
                            } catch (_) {
                                return "";
                            }
                        })(),
                        chatContextMessages: Number(traceMeta?.chatContextMessages) >= 0 ? Number(traceMeta.chatContextMessages) : undefined,
                        systemChars: String(finalSystemPrompt || "").length,
                        userChars: String(finalPrompt || "").length,
                        note: "Waiting for provider response (no SSE in this build).",
                    });

                    const fx = await fetchWithCorsProxyFallback(url, { method: "POST", headers, body: JSON.stringify(body), signal: traceMeta?.signal });
                    const response = fx.response;
                    const ms = Date.now() - startedAt;
                    if (!response.ok) {
                        const errText = await response.text().catch(() => "");
                        lastErr = `API Error ${response.status}: ${String(errText || "").slice(0, 360)}`;
                        
                        if (response.status === 401 || response.status === 403) {
                            const next = handleApiKeyFailureAndSwitch(t, t.key);
                            if (next && !triedKeys.has(next.keyId)) {
                                triedKeys.add(next.keyId);
                                t.key = next.keyId;
                                const key = next.keyValue.replace(/^bearer\s+/i, "").trim();
                                if (headers.Authorization) headers.Authorization = `Bearer ${key}`;
                                if (headers["x-api-key"]) headers["x-api-key"] = key;
                                if (headers["api-key"]) headers["api-key"] = key;
                                if (endpointShape === "anthropic_messages") {
                                    headers["x-api-key"] = key;
                                }
                                continue;
                            }
                        }

                        window.UIE_lastTurbo = { ok: false, url, ms, status: response.status, error: lastErr, via: fx.via, requestUrl: fx.requestUrl };
                        uieApiConsole("llm_request_done", {
                            kind: traceKind,
                            ok: false,
                            httpStatus: response.status,
                            wallMs: Date.now() - reqWallStart,
                            transport: "non-streaming",
                            error: lastErr.slice(0, 200),
                        });
                        
                        if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404 || response.status === 429) {
                            break;
                        }
                        break;
                    }
                    const data = await response.json().catch(() => null);
                const text = extractApiResponseText(data);
                const usage = extractUsageFromApiJson(data);
                if (!text) {
                    const providerError = data?.error ? extractProviderErrorMessage(JSON.stringify(data)) : "";
                    const responseKeys = data && typeof data === "object"
                        ? Object.keys(data).slice(0, 12).join(", ")
                        : "";
                    const finishReason = String(data?.choices?.[0]?.finish_reason || data?.candidates?.[0]?.finishReason || "").trim();
                    const shapeHint = [
                        responseKeys ? `response keys: ${responseKeys}` : (data === null ? "response was not valid JSON" : ""),
                        finishReason ? `finish reason: ${finishReason}` : "",
                    ].filter(Boolean).join("; ");
                    lastErr = providerError
                        ? `Provider returned an error: ${providerError.slice(0, 300)}`
                        : `Invalid API response (no text${shapeHint ? `; ${shapeHint}` : ""}).`;
                    window.UIE_lastTurbo = { ok: false, url, ms, status: 200, error: lastErr, via: fx.via, requestUrl: fx.requestUrl, usage, responseKeys, finishReason };
                    uieApiConsole("llm_request_done", {
                        kind: traceKind,
                        ok: false,
                        wallMs: Date.now() - reqWallStart,
                        transport: "non-streaming",
                        usage,
                        error: lastErr,
                    });
                    continue;
                }
                window.UIE_lastTurbo = {
                    ok: true,
                    url,
                    ms,
                    status: 200,
                    error: "",
                    via: fx.via,
                    requestUrl: fx.requestUrl,
                    model,
                    provider: providerHost || String(t.provider || ""),
                    usage,
                };
                uieApiConsole("llm_request_done", {
                    kind: traceKind,
                    ok: true,
                    wallMs: Date.now() - reqWallStart,
                    transport: "non-streaming",
                    replyChars: text.length,
                    usage,
                    tokensPrompt: usage?.promptTokens ?? null,
                    tokensCompletion: usage?.completionTokens ?? null,
                    tokensTotal: usage?.totalTokens ?? null,
                });
                return text;
            } catch (e) {
                if (e?.name === "AbortError" || traceMeta?.signal?.aborted) throw e;
                const ms = Date.now() - startedAt;
                lastErr = String(e?.message || e || "API fetch failed").slice(0, 360);
                window.UIE_lastTurbo = { ok: false, url, ms, status: 0, error: lastErr, via: "direct", requestUrl: url };
                uieApiConsole("llm_request_done", {
                    kind: traceKind,
                    ok: false,
                    wallMs: ms,
                    transport: "non-streaming",
                    error: lastErr.slice(0, 200),
                });
                continue;
            }
        }

        try {
            const ms = Date.now() - startedAt;
            const previous = window.UIE_lastTurbo || {};
            window.UIE_lastTurbo = {
                ...previous,
                ok: false,
                url: String(previous?.url || urls[0] || ""),
                ms,
                status: Number(previous?.status || 0),
                error: lastErr || String(previous?.error || "API request failed."),
            };
        } catch (_) {}
        return null;

    }
    } catch (e) {
        if (e?.name === "AbortError" || traceMeta?.signal?.aborted) throw e;
        try { console.warn("[UIE] API request failed:", e); } catch (_) {}
        return null;
    }
}

async function generateTurbo(prompt, systemPrompt, traceMeta = {}) {
    const s = getSettings();
    const t = s.turbo || {};
    return await generateFromApiConfig(t, prompt, systemPrompt, traceMeta);
}

function getActiveMainApiConfig(s = getSettings()) {
    const connections = s?.connections && typeof s.connections === "object" ? s.connections : {};
    const profiles = Array.isArray(connections.mainProfiles) ? connections.mainProfiles : [];
    const activeId = String(connections.activeMainProfileId || "").trim();
    const active = profiles.find((profile) => String(profile?.id || "").trim() === activeId) || profiles[0] || null;
    const mirrored = connections.mainApi && typeof connections.mainApi === "object" ? connections.mainApi : null;
    const legacy = s?.mainApi && typeof s.mainApi === "object" ? s.mainApi : null;
    const candidates = [mirrored, active, legacy].filter(Boolean);
    return candidates.find((config) => String(config?.url || "").trim()) || candidates[0] || null;
}

export function hasVerifiedTextConnection() {
    const s = getSettings();
    const localProviders = new Set(["ollama", "lmstudio", "koboldcpp", "textgen_webui", "vllm", "localai", "llamacpp", "jan"]);
    const isReady = (config = {}, requireEnabled = false) => {
        if (requireEnabled && config?.enabled !== true) return false;
        const url = String(config?.url || "").trim();
        const provider = String(config?.provider || "").trim().toLowerCase();
        const local = localProviders.has(provider) || /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(normalizeTurboInputUrl(url));
        const allowsBlankKey = provider === "aihorde" || provider === "horde";
        const key = resolveApiKey(String(config?.key || "").trim());
        return !!(url && (local || allowsBlankKey || key) && isVerifiedApiConfig(config));
    };
    return isReady(getActiveMainApiConfig(s)) || (s?.turbo?.applyToText !== false && isReady(s?.turbo || {}, true));
}



export async function testTurboConnection(opts = {}) {
    const s = getSettings();
    const t = opts.config || s.turbo || {};
    const isTurbo = opts.isTurbo !== false;
    const label = isTurbo ? "Turbo" : "Main API";
    const rawUrl = String(t.url || "").trim();
    const rawKey = resolveApiKey(String(t.key || "").trim());
    const urls = buildTurboUrlCandidates(rawUrl);
    if (!urls.length) return { ok: false, error: `No ${label} endpoint set.` };
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(normalizeTurboInputUrl(rawUrl));
    const provider = String(t.provider || "").trim().toLowerCase();
    const allowsBlankKey = provider === "aihorde" || provider === "horde";
    if (!rawKey && !isLocal && !allowsBlankKey) return { ok: false, error: `No ${label} API key.` };

    const startedAt = Date.now();
    try {
        const probeConfig = {
            ...t,
            // Reasoning models can consume a very small budget before emitting visible text.
            maxTokens: 256,
            temp: 0,
            topp: 1,
            stopSequences: [],
            reasoningTokens: 0,
        };
        const sample = await generateFromApiConfig(
            probeConfig,
            "Reply with exactly: UIE_CONNECTION_OK",
            "This is a connection test. Follow the user's instruction exactly.",
            { kind: `${label} connection test` },
        );
        const ms = Date.now() - startedAt;
        if (sample) {
            return {
                ok: true,
                ms,
                tried: urls,
                sample: String(sample).slice(0, 200),
                url: String(window.UIE_lastTurbo?.url || rawUrl),
                fingerprint: apiConfigFingerprint(t),
            };
        }
        const last = window.UIE_lastTurbo || {};
        return {
            ok: false,
            ms,
            tried: urls,
            status: Number(last?.status || 0),
            error: describeApiFailure(last, label),
            fingerprint: apiConfigFingerprint(t),
        };
    } catch (e) {
        const ms = Date.now() - startedAt;
        return { ok: false, ms, tried: urls, error: describeApiFailure(e, label), fingerprint: apiConfigFingerprint(t) };
    }
}
export async function listTurboModels(opts = {}) {
    const s = getSettings();
    const t = s?.turbo || {};
    const rawUrl = String(opts.url != null ? opts.url : t.url || "").trim();
    const rawKey = resolveApiKey(String(opts.key != null ? opts.key : t.key || "").trim());
    if (!rawUrl) return { ok: false, error: "No Turbo endpoint set.", models: [] };

    const key = rawKey ? rawKey.replace(/^bearer\s+/i, "").trim() : "";
    const headers = { "Accept": "application/json", "HTTP-Referer": "https://uie.local", "X-Title": "UIE" };
    if (key) headers.Authorization = `Bearer ${key}`;

    const norm = normalizeTurboInputUrl(rawUrl);
    let base;
    try { base = new URL(norm); } catch (_) { base = null; }
    const host = base ? String(base.hostname || "").toLowerCase() : "";
    const path = base ? String(base.pathname || "") : "";
    const origin = base ? base.origin : norm.replace(/\/+$/g, "");

    const stripKnown = (p) => String(p || "")
        .replace(/\/chat\/completions$/i, "")
        .replace(/\/completions$/i, "")
        .replace(/\/responses$/i, "")
        .replace(/\/models$/i, "")
        .replace(/\/images\/generations$/i, "")
        .replace(/\/+$/g, "");

    const p0 = stripKnown(path);
    const isOpenRouter = host.includes("openrouter.ai") || /openrouter\.ai/i.test(origin);
    const isNanoGpt = host.includes("nano-gpt.com") || host.includes("nanogpt") || /nano-?gpt/i.test(origin);
    const isNvidia = host.includes("nvidia.com") || /nvidia\.com/i.test(origin);
    const isPollinations = host.includes("pollinations.ai") || /pollinations\.ai/i.test(origin);
    const isDeepSeek = host.includes("deepseek.com") || /deepseek\.com/i.test(origin);
    if (isOpenRouter) {
        delete headers["x-api-key"];
        delete headers["api-key"];
    }
    if (key && (isNvidia || isNanoGpt)) {
        headers["x-api-key"] = key;
        headers["api-key"] = key;
    }
    if (isDeepSeek) {
        delete headers["x-api-key"];
        delete headers["api-key"];
    }
    const add = (u, out) => { const x = String(u || "").trim(); if (x && !out.includes(x)) out.push(x); };
    const urls = [];

    if (isOpenRouter) {
        const basePath = /\/api\/v1$/i.test(p0) ? p0 : (p0.replace(/\/v1$/i, "/api/v1") || "/api/v1");
        add(`${origin}${basePath}/models`, urls);
        add(`https://openrouter.ai/api/v1/models`, urls);
        add(`/api/openrouter/v1/models`, urls);
        add(`/api/openrouter/models`, urls);
    } else if (isPollinations) {
        add(`${origin}/models`, urls);
        add(`https://text.pollinations.ai/models`, urls);
    } else if (isNanoGpt) {
        add(`${origin}/api/v1/models`, urls);
        add(`${origin}/api/v1/models?detailed=true`, urls);
        add(`${origin}/v1/models`, urls);
        add(`${origin}/models`, urls);
    } else {
        if (/\/v1$/i.test(p0)) add(`${origin}${p0}/models`, urls);
        add(`${origin}/v1/models`, urls);
        add(`${origin}${p0}/models`, urls);
        add(`${origin}/models`, urls);
        if (isNvidia) {
            add(`https://api.nvidia.com/v1/models`, urls);
            add(`https://integrate.api.nvidia.com/v1/models`, urls);
        }
    }

    const startedAt = Date.now();
    let lastErr = "";
    for (const url of urls) {
        try {
            const fx = await fetchWithCorsProxyFallback(url, { method: "GET", headers });
            const r = fx.response;
            if (!r.ok) {
                const txt = await r.text().catch(() => "");
                lastErr = `API Error ${r.status}: ${String(txt || "").slice(0, 220)}`;
                continue;
            }
            const data = await r.json().catch(() => null);
            const arr = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : null));
            if (!Array.isArray(arr)) {
                lastErr = "Invalid models response.";
                continue;
            }
            const out = [];
            const seen = new Set();
            for (const m of arr) {
                const id = String(m?.id || m?.name || m?.model || "").trim();
                if (!id || seen.has(id)) continue;
                seen.add(id);
                const label = String(m?.name || m?.display_name || m?.label || id).trim();
                out.push({ id, label });
            }
            out.sort((a, b) => String(a.label).localeCompare(String(b.label)));
            const ms = Date.now() - startedAt;
            try { window.UIE_lastTurboModels = { ok: true, url, ms, count: out.length, via: fx.via, requestUrl: fx.requestUrl }; } catch (_) {}
            return { ok: true, models: out, ms, url };
        } catch (e) {
            lastErr = String(e?.message || e || "Model list failed").slice(0, 220);
            continue;
        }
    }
    if (isNvidia) {
        const fallback = [
            // OpenAI Models
            { id: "openai/gpt-4o", label: "OpenAI: GPT-4o" },
            { id: "openai/gpt-4o-mini", label: "OpenAI: GPT-4o Mini" },
            { id: "openai/gpt-4-turbo", label: "OpenAI: GPT-4 Turbo" },
            { id: "openai/gpt-3.5-turbo", label: "OpenAI: GPT-3.5 Turbo" },
            
            // Anthropic Models
            { id: "anthropic/claude-3-5-sonnet-20241022", label: "Anthropic: Claude 3.5 Sonnet" },
            { id: "anthropic/claude-3-5-haiku-20241022", label: "Anthropic: Claude 3.5 Haiku" },
            { id: "anthropic/claude-3-opus-20240229", label: "Anthropic: Claude 3 Opus" },
            { id: "anthropic/claude-3-sonnet-20240229", label: "Anthropic: Claude 3 Sonnet" },
            { id: "anthropic/claude-3-haiku-20240307", label: "Anthropic: Claude 3 Haiku" },
            
            // Google Models
            { id: "google/gemini-2.0-flash-exp", label: "Google: Gemini 2.0 Flash Exp" },
            { id: "google/gemini-2.0-flash-thinking-exp", label: "Google: Gemini 2.0 Flash Thinking Exp" },
            { id: "google/gemini-1.5-pro", label: "Google: Gemini 1.5 Pro" },
            { id: "google/gemini-1.5-flash", label: "Google: Gemini 1.5 Flash" },
            { id: "google/gemini-1.5-flash-8b", label: "Google: Gemini 1.5 Flash 8B" },
            { id: "google/gemma-2-27b-it", label: "Google: Gemma 2 27B IT" },
            { id: "google/gemma-2-9b-it", label: "Google: Gemma 2 9B IT" },
            
            // Meta Models
            { id: "meta-llama/llama-3.1-405b-instruct", label: "Meta: Llama 3.1 405B Instruct" },
            { id: "meta-llama/llama-3.1-70b-instruct", label: "Meta: Llama 3.1 70B Instruct" },
            { id: "meta-llama/llama-3.1-8b-instruct", label: "Meta: Llama 3.1 8B Instruct" },
            { id: "meta-llama/llama-3.2-1b-instruct", label: "Meta: Llama 3.2 1B Instruct" },
            { id: "meta-llama/llama-3.2-3b-instruct", label: "Meta: Llama 3.2 3B Instruct" },
            { id: "meta-llama/llama-3.2-11b-vision-instruct", label: "Meta: Llama 3.2 11B Vision Instruct" },
            { id: "meta-llama/llama-3.2-90b-vision-instruct", label: "Meta: Llama 3.2 90B Vision Instruct" },
            { id: "meta-llama/llama-3.3-70b-instruct", label: "Meta: Llama 3.3 70B Instruct" },
            
            // Microsoft Models
            { id: "microsoft/phi-3-medium-128k-instruct", label: "Microsoft: Phi-3 Medium 128K" },
            { id: "microsoft/phi-3-mini-128k-instruct", label: "Microsoft: Phi-3 Mini 128K" },
            { id: "microsoft/phi-3.5-mini-instruct", label: "Microsoft: Phi-3.5 Mini" },
            { id: "microsoft/phi-3.5-moe-instruct", label: "Microsoft: Phi-3.5 MoE" },
            
            // Mistral Models
            { id: "mistralai/mistral-7b-instruct-v0.3", label: "Mistral: Mistral 7B Instruct v0.3" },
            { id: "mistralai/mixtral-8x7b-instruct-v0.1", label: "Mistral: Mixtral 8x7B Instruct" },
            { id: "mistralai/mixtral-8x22b-instruct-v0.1", label: "Mistral: Mixtral 8x22B Instruct" },
            { id: "mistralai/mistral-large-2402", label: "Mistral: Mistral Large" },
            { id: "mistralai/mistral-small-2402", label: "Mistral: Mistral Small" },
            { id: "mistralai/codestral-2401", label: "Mistral: Codestral" },
            
            // Qwen Models
            { id: "qwen/qwen-2.5-72b-instruct", label: "Qwen: Qwen 2.5 72B Instruct" },
            { id: "qwen/qwen-2.5-32b-instruct", label: "Qwen: Qwen 2.5 32B Instruct" },
            { id: "qwen/qwen-2.5-14b-instruct", label: "Qwen: Qwen 2.5 14B Instruct" },
            { id: "qwen/qwen-2.5-7b-instruct", label: "Qwen: Qwen 2.5 7B Instruct" },
            { id: "qwen/qwen-2.5-1.5b-instruct", label: "Qwen: Qwen 2.5 1.5B Instruct" },
            { id: "qwen/qwen-2.5-0.5b-instruct", label: "Qwen: Qwen 2.5 0.5B Instruct" },
            { id: "qwen/qwen-2.5-coder-32b-instruct", label: "Qwen: Qwen 2.5 Coder 32B" },
            
            // DeepSeek Models
            { id: "deepseek/deepseek-chat", label: "DeepSeek: DeepSeek Chat" },
            { id: "deepseek/deepseek-coder", label: "DeepSeek: DeepSeek Coder" },
            { id: "deepseek/deepseek-coder-v2", label: "DeepSeek: DeepSeek Coder V2" },
            
            // NVIDIA Models
            { id: "nvidia/llama-3.1-nemotron-70b-instruct", label: "NVIDIA: Llama 3.1 Nemotron 70B" },
            { id: "nvidia/nemotron-4-340b-reward", label: "NVIDIA: Nemotron 4 340B Reward" },
            { id: "nvidia/cosmos-1-7b", label: "NVIDIA: Cosmos 1 7B" },
            { id: "nvidia/stella-en-5b", label: "NVIDIA: Stella EN 5B" },
            
            // Other Popular Models
            { id: "cohere/command-r-plus", label: "Cohere: Command R+" },
            { id: "cohere/command", label: "Cohere: Command" },
            { id: "perplexity/llama-3.1-sonar-large-128k-online", label: "Perplexity: Llama 3.1 Sonar Large 128K Online" },
            { id: "perplexity/llama-3.1-sonar-small-128k-online", label: "Perplexity: Llama 3.1 Sonar Small 128K Online" },
            { id: "groq/llama-3.1-70b-versatile", label: "Groq: Llama 3.1 70B Versatile" },
            { id: "groq/llama-3.1-8b-instant", label: "Groq: Llama 3.1 8B Instant" },
            { id: "togetherai/striver-7b", label: "TogetherAI: Striver 7B" },
            { id: "togetherai/hermes-2-pro-mistral-7b", label: "TogetherAI: Hermes 2 Pro Mistral 7B" }
        ];
        const ms = Date.now() - startedAt;
        try { window.UIE_lastTurboModels = { ok: true, url: urls[0] || "", ms, count: fallback.length, note: "fallback" }; } catch (_) {}
        return { ok: true, models: fallback, ms, url: urls[0] || "", note: "fallback" };
    }
    const ms = Date.now() - startedAt;
    try {
        const normTry = normalizeTurboInputUrl(rawUrl);
        const hostTry = (() => {
            try {
                return String(new URL(normTry).hostname || "").toLowerCase();
            } catch (_) {
                return "";
            }
        })();
        if (/nano-gpt|nanogpt/i.test(hostTry) || /nano-gpt|nanogpt/i.test(String(rawUrl || "").toLowerCase())) {
            const fallback = [
                // OpenAI Models
                { id: "gpt-4o", label: "NanoGPT: GPT-4o" },
                { id: "gpt-4o-mini", label: "NanoGPT: GPT-4o Mini" },
                { id: "gpt-4-turbo", label: "NanoGPT: GPT-4 Turbo" },
                { id: "gpt-4", label: "NanoGPT: GPT-4" },
                { id: "gpt-3.5-turbo", label: "NanoGPT: GPT-3.5 Turbo" },
                { id: "gpt-3.5-turbo-16k", label: "NanoGPT: GPT-3.5 Turbo 16K" },
                
                // Anthropic Models
                { id: "claude-3-5-sonnet-20241022", label: "NanoGPT: Claude 3.5 Sonnet" },
                { id: "claude-3-5-haiku-20241022", label: "NanoGPT: Claude 3.5 Haiku" },
                { id: "claude-3-opus-20240229", label: "NanoGPT: Claude 3 Opus" },
                { id: "claude-3-sonnet-20240229", label: "NanoGPT: Claude 3 Sonnet" },
                { id: "claude-3-haiku-20240307", label: "NanoGPT: Claude 3 Haiku" },
                
                // Google Models
                { id: "gemini-2.0-flash-exp", label: "NanoGPT: Gemini 2.0 Flash Exp" },
                { id: "gemini-2.0-flash-thinking-exp", label: "NanoGPT: Gemini 2.0 Flash Thinking Exp" },
                { id: "gemini-1.5-pro", label: "NanoGPT: Gemini 1.5 Pro" },
                { id: "gemini-1.5-flash", label: "NanoGPT: Gemini 1.5 Flash" },
                { id: "gemini-1.5-flash-8b", label: "NanoGPT: Gemini 1.5 Flash 8B" },
                { id: "gemini-pro", label: "NanoGPT: Gemini Pro" },
                { id: "gemini-pro-vision", label: "NanoGPT: Gemini Pro Vision" },
                
                // Meta Models
                { id: "llama-3.1-405b-instruct", label: "NanoGPT: Llama 3.1 405B Instruct" },
                { id: "llama-3.1-70b-instruct", label: "NanoGPT: Llama 3.1 70B Instruct" },
                { id: "llama-3.1-8b-instruct", label: "NanoGPT: Llama 3.1 8B Instruct" },
                { id: "llama-3.2-1b-instruct", label: "NanoGPT: Llama 3.2 1B Instruct" },
                { id: "llama-3.2-3b-instruct", label: "NanoGPT: Llama 3.2 3B Instruct" },
                { id: "llama-3.2-11b-vision-instruct", label: "NanoGPT: Llama 3.2 11B Vision Instruct" },
                { id: "llama-3.3-70b-instruct", label: "NanoGPT: Llama 3.3 70B Instruct" },
                
                // DeepSeek Models
                { id: "deepseek-chat", label: "NanoGPT: DeepSeek Chat" },
                { id: "deepseek-coder", label: "NanoGPT: DeepSeek Coder" },
                { id: "deepseek-coder-v2", label: "NanoGPT: DeepSeek Coder V2" },
                
                // Qwen Models
                { id: "qwen-2.5-72b-instruct", label: "NanoGPT: Qwen 2.5 72B Instruct" },
                { id: "qwen-2.5-32b-instruct", label: "NanoGPT: Qwen 2.5 32B Instruct" },
                { id: "qwen-2.5-14b-instruct", label: "NanoGPT: Qwen 2.5 14B Instruct" },
                { id: "qwen-2.5-7b-instruct", label: "NanoGPT: Qwen 2.5 7B Instruct" },
                { id: "qwen-2.5-coder-32b-instruct", label: "NanoGPT: Qwen 2.5 Coder 32B" },
                
                // Mistral Models
                { id: "mistral-7b-instruct-v0.3", label: "NanoGPT: Mistral 7B Instruct v0.3" },
                { id: "mixtral-8x7b-instruct-v0.1", label: "NanoGPT: Mixtral 8x7B Instruct" },
                { id: "mixtral-8x22b-instruct-v0.1", label: "NanoGPT: Mixtral 8x22B Instruct" },
                { id: "mistral-large-2402", label: "NanoGPT: Mistral Large" },
                { id: "mistral-small-2402", label: "NanoGPT: Mistral Small" },
                
                // Microsoft Models
                { id: "phi-3-medium-128k-instruct", label: "NanoGPT: Phi-3 Medium 128K" },
                { id: "phi-3-mini-128k-instruct", label: "NanoGPT: Phi-3 Mini 128K" },
                { id: "phi-3.5-mini-instruct", label: "NanoGPT: Phi-3.5 Mini" },
                { id: "phi-3.5-moe-instruct", label: "NanoGPT: Phi-3.5 MoE" }
            ];
            try {
                window.UIE_lastTurboModels = { ok: true, url: rawUrl, ms, count: fallback.length, note: "nano-fallback" };
            } catch (_) {}
            return { ok: true, models: fallback, ms, url: rawUrl, note: "nano-fallback" };
        }
    } catch (_) {}
    try { window.UIE_lastTurboModels = { ok: false, url: urls[0] || "", ms, error: lastErr }; } catch (_) {}
    return { ok: false, error: lastErr || "Model list failed.", models: [] };
}

export async function generateContent(prompt, type) {
    if (isSystemLockedOut()) {
        enforceLockoutScreen();
        throw new Error("UIE Security Lockout Active: Fatal System Tamper");
    }
    const s = getSettings();
    const turboEnabled = !!(s.turbo && s.turbo.enabled);
    const turboUrl = String(s?.turbo?.url || "").trim();
    const turboKeyRaw = resolveApiKey(String(s?.turbo?.key || "").trim());
    const turboProvider = String(s?.turbo?.provider || "").trim().toLowerCase();
    const turboIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(normalizeTurboInputUrl(turboUrl));
    const turboAllowsBlankKey = turboProvider === "aihorde" || turboProvider === "horde";
    const turboReady = turboEnabled && !!turboUrl && (turboIsLocal || turboAllowsBlankKey || !!turboKeyRaw) && isVerifiedApiConfig(s.turbo);
    const typeStr = String(type || "").trim();
    const isImageAiType =
        typeStr === "Image Gen" ||
        typeStr === "System Image Decide+Prompt" ||
        (/\bimage\b/i.test(typeStr) && typeStr !== "VN Dialogue");
    const applyTurboText = s?.turbo?.applyToText !== false;
    if (generationInFlight) {
        const now = Date.now();
        if (now - Number(window.UIE_lastConcurrentGenerationNoticeAt || 0) > 2500) {
            window.UIE_lastConcurrentGenerationNoticeAt = now;
            notify("warning", "A generation is already running.", "UIE", "api");
        }
        return null;
    }
    generationInFlight = true;
    const vnAbortController = new AbortController();
    activeVnAbortController = vnAbortController;
    try { window.__uieGenerationStopped = false; } catch (_) {}
    /** Every request selects one verified provider and performs one full generation. */
    const forceTurboAux = typeStr === "User Line Drafts";
    const isStandalone = window.UIE_gameOwnsPostReplyScan === true;
    /* Turbo is OPTIONAL — only use when explicitly enabled AND ready.
       Previously standalone mode always tried turbo first if any turbo URL was set,
       causing CORS/proxy log spam when turbo wasn't actually connected. */
    const useTurbo = (
        (forceTurboAux && turboReady) ||
        (!forceTurboAux &&
            !isImageAiType &&
            turboReady &&
            applyTurboText &&
            !new Set(["Creating World", "Map", "Map Names"]).has(typeStr))
    );

    if (type === "Logic" || type === "JSON") type = "System Check";
    
    // Block regular system checks if disabled, but allow user-forced ones
    if ((type === "System Check" || type === "Unified State Scan") && s?.generation?.allowSystemChecks !== true) {
        try {
            const last = String(window.UIE_lastSystemCheckBlockedType || "");
            const cur = String(type || "System Check");
            if (last !== cur) {
                window.UIE_lastSystemCheckBlockedType = cur;
                notify("warning", "Blocked by settings: enable 'Allow System Checks (AI)' in UIE Settings → Generation.", "UIE", "api");
            }
        } catch (_) {}
        generationInFlight = false;
        if (activeVnAbortController === vnAbortController) activeVnAbortController = null;
        return null;
    }

    const sysGate = await (async () => {
        if (type !== "System Check") return { release: () => {} };
        try {
            const g = (window.UIE_systemCheckGate = window.UIE_systemCheckGate || { inFlight: false, lastAt: 0 });
            const now = Date.now();
            const min = Math.max(0, Number(s?.generation?.systemCheckMinIntervalMs ?? 20000));
            const since = now - Number(g.lastAt || 0);
            
            // Abort if already running or too soon, rather than queuing
            if (g.inFlight || (min > 0 && since < min)) {
                return null;
            }
            
            g.inFlight = true;
            g.lastAt = now;
            return { release: () => { try { g.inFlight = false; } catch (_) {} } };
        } catch (_) {
            return { release: () => {} };
        }
    })();
    
    if (sysGate === null) {
        generationInFlight = false;
        if (activeVnAbortController === vnAbortController) activeVnAbortController = null;
        return null;
    }

    let _uieGenTrace = { t0: 0, kind: String(type || "") };
    let traceRoute = useTurbo ? "turbo" : "main";
    let traceUsage = null;

    try {
    const displayType = type === "System Check" ? "System Check" : (type === "Shop" ? "Gathering list!" : type);
    _uieGenTrace.kind = displayType;

    const customSystem = String(s?.generation?.customSystemPrompt || "").trim();
    const logicSystem = String(buildSystemPrompt ? buildSystemPrompt() : "").trim();

    let system = "";
    if(type === "Webpage") system = "You are a UI Engine. Output ONLY raw valid HTML for an immersive/interactive UI. No markdown, no code fences. Avoid <script> unless absolutely necessary. Prefer CSS-only interaction.";
    if (type === "Living HTML")
        system =
            "You are a UI Engine. Output ONLY raw valid HTML/CSS for a short in-scene prop the player glances at while waiting: notice board, TV crawl, wall clock, sticky note, terminal screen, shop sign, etc. No markdown, no code fences. Avoid <script>; use CSS-only motion if needed. Keep it compact and readable on mobile.";
    if(type === "Phone Call") system = "You are speaking on a phone call. Output ONLY the words spoken (dialogue only). No narration, no actions, no stage directions, no quotes, no markdown, no brackets. one short line.";
    system = [customSystem, logicSystem, system].filter(Boolean).join("\n\n");
    if (type === "System Check" || type === "Unified State Scan" || type === "Unified State Scan (User)" || type === "Shop" || type === "Journal Quests" || type === "Auto-Warp Detection" || type === "Navigation Location JSON") {
        const strict = [
            "STRICT MODE:",
            type === "Journal Quests" ?
                 "- Output ONLY valid JSON (an array of quest objects). No markdown, no code fences."
                : "- Output ONLY a single valid JSON object (no markdown, no code fences).",
            "- Do NOT write any story, narration, dialogue, roleplay, or continuation.",
            "- Do NOT address the user or the characters.",
            "- If unsure, output the most conservative JSON that follows the schema."
        ].join("\n");
        system = [system, strict].filter(Boolean).join("\n\n");
    }

    const providerModel = useTurbo ?
         `Turbo: ${String((s.turbo && s.turbo.model) || "unknown")}`
        : "Main API";

    let rawBase = String(prompt || "").trim();
    const nextBeat = String(getNextBeatPrompt() || "").trim();
    const shouldApplyNextBeat = typeStr === "VN Dialogue" && !!nextBeat;
    const lockedPrompt = /^\[UIE_LOCKED\]/i.test(rawBase);
    let base = rawBase.replace(/^\[UIE_LOCKED\]\s*/i, "").trim();

    /** Split engine priority block into the API system message so prompts are not treated as user chat. */
    let vnSystemPriority = "";
    if (!lockedPrompt && String(type || "").trim() === "VN Dialogue") {
        const marker = "\n\n[USER ACTION]\n";
        const j = base.indexOf(marker);
        if (j >= 0) {
            vnSystemPriority = base.slice(0, j).trim();
            base = `[USER ACTION]\n${base.slice(j + marker.length).trim()}`;
        }
    }
    if (typeStr === "User Line Drafts") {
        system = [
            system,
            "You help a roleplaying game player phrase their next chat message.",
            "Output ONLY valid JSON: {\"lines\":[\"line1\",\"line2\",\"line3\"]} with exactly three strings.",
            "Each string is one candidate message the player could send next (first-person or natural player voice). Keep each under ~320 characters. No markdown, no code fences, no extra keys."
        ]
            .filter(Boolean)
            .join("\n\n");
    }
    if (String(type || "").trim() === "VN Dialogue") {
        const currentLocation = String(s?.worldState?.location || s?.realityEngine?.locationId || "").trim();
        const presentEntities = (() => {
            try {
                const scene = Array.isArray(s?.ui?.sceneCharacters) ? s.ui.sceneCharacters : [];
                const localRel = Array.isArray(s?.gameState?.relationships) ?
                     s.gameState.relationships
                        .filter((r) => String(r?.location || "").trim() && String(r.location).trim() === currentLocation)
                        .map((r) => r.name)
                    : [];
                return Array.from(new Set([...scene, ...localRel]
                    .map((x) => String(typeof x === "string" ? x : x?.name || "").trim())
                    .filter(Boolean)))
                    .slice(0, 12);
            } catch (_) {
                return [];
            }
        })();
        const littleSisContext = buildLittleSisContext(currentLocation, presentEntities);
        const strictStateOutput = [
            "[STRICT STATE OUTPUT]",
            "The readable portion must contain only [Name]: Response visual-novel turns. Do not print unlabeled story, JSON, schemas, code fences, or engine commentary before the data separator.",
            "Never reveal hidden reasoning, planning notes, system/developer prompt details, player-progress summaries, bullet-point analysis, or comments about what you will do. If you need to reason, keep it private and output only the final in-world narration.",
            "Do not output self-correction text such as 'Wait,' 'I need to reconcile,' 'I should,' or notes about narrative context versus system tags.",
            "Never output prompt scaffolding labels such as Recent Context, Constraint Check, scene_summary, Current Context, or instructions about no HTML/CSS/JS.",
            "After the readable story, output exactly this separator on its own line: ===DATA===",
            "After that separator, output one strict JSON object and nothing else.",
            "JSON schema: {\"state_updates\":{\"resource_impacts\":{},\"social_impacts\":[],\"new_rumor_or_memory_generated\":\"\",\"xp_change\":0,\"stat_impacts\":{\"hp\":0,\"stamina\":0,\"ap\":0,\"mp\":0,\"base_stats\":{}},\"inventory_updates\":{\"items_gained\":[],\"items_lost\":[],\"equipment_changed\":{},\"assets_updated\":[]},\"currency_updates\":{\"primary_change\":0,\"temporary_currency\":{\"name\":\"\",\"amount_change\":0}},\"combat_log\":{\"battles_won\":0,\"battles_lost\":0,\"new_enemies_encountered\":[]},\"codex_updates\":[],\"phone_updates\":{\"social_media_notifications\":[],\"dating_app_matches\":[],\"bank_transactions\":0,\"transit_funds_change\":0},\"status_effects\":[],\"quest_triggers\":[]},\"action_wheel_options\":[{\"label\":\"\",\"type\":\"neutral\",\"cost\":{},\"command\":\"\"}]}",
            "Use empty arrays, empty strings, or 0 when nothing changes."
        ].join("\n");
        const vnOut = [
            "[VN DIALOGUE — READABLE OUTPUT]",
            "- Write as the NPCs and immediate world the player is directly interacting with, not as an author telling or summarizing a story.",
            "- Treat the player's latest line as live character intent, not a command-menu selection or route-validation request.",
            "- If the player considers going somewhere, continue the scene through grounded movement, hesitation, friction, or a nearby path. Do not flatten it into a travel denial.",
            "- Output only individual visual-novel turns. Never output unlabeled story prose, summaries, markdown, or paragraphs outside a turn.",
            "- Every readable turn MUST use the exact macro [Name]: Response. The colon comes after the closing bracket.",
            "- The very first readable character in the response must be '['. Do not write any sentence before a [Name]: macro.",
            "- If narration is needed, it must be a [Narrator]: Response turn. Never output bare/unlabeled story prose.",
            "- [Narrator]: narrates environment, sensory detail, and world events only. Narrator must NEVER speak quoted dialogue, write a character's words, or describe character actions.",
            "- [Narrator]: must NEVER contain a character's name followed by their action or speech. If Miko speaks or acts, that MUST be a [Miko]: turn, not narrated inside [Narrator]:.",
            "- Character dialogue, character movements, expressions, gestures, and actions must never be written in the [Narrator]: turn; they must always belong to that character's own [Exact Character Name]: Response turn. The Narrator must never speak or act for them.",
            "- If the speaker identity is genuinely unknown, use [Unknown]: Response. Do not invent the literal name [Name].",
            "- If an unnamed entity has a clear type, label by type instead of Unknown, such as [Monster]:, [Guard]:, [Merchant]:, [Creature]:, [Soldier]:, [Teacher]:, or [Worker]:.",
            "- Never output prompt notes, constraint checks, recent-context summaries, scene_summary fields, or implementation instructions.",
            "- Valid examples: [Jill]: I found the key.  [Jack]: Then we should leave.  [Monster]: It drags its claws over the stone.  [Unknown]: Stay back.  [Narrator]: Rain strikes the window.",
            "- Characters are not subject to a limit of one sentence or one action. In their own [Name]: turn, characters can perform multiple actions, gestures, and speak multiple sentences. Do not split a character's rich actions and speech into separate turns or dump them into the [Narrator]: turn; let them do what they like within their own turn.",
            "- Never write the player's dialogue, thoughts, decisions, feelings, or actions for them.",
            "- Do not paraphrase the player's inner monologue with phrases like 'the thought occurs to you' or 'the idea forms in your mind.' Respond to what can be seen, heard, touched, or said.",
            "- Do not narrate or paraphrase engine syntax (no 'OBJECT id=', no explaining bracket tags).",
            "- Interactive object tracking: if required, emit at most one machine line at the very end, alone on its own line: [OBJECT id=stable_snake_case state=short_status]",
            "- Do not repeat that line or similar tokens inside story prose; the UI strips bracket lines from the dialogue view.",
            "- Phone texts: never write SMS/iMessage/chat-bubble dialogue, quoted text threads, or “you got a text that says…” in this narration. In-world texting happens only in the in-game phone UI; here you may describe reactions or tone without reproducing the message text."
        ].join("\n");
        const nextBeatSystem = shouldApplyNextBeat ?
             [
                "[NEXT BEAT]",
                "Steer the immediate next response toward this requested beat while still honestly responding to the user's action and the scene state.",
                nextBeat,
            ].join("\n")
            : "";
        const secretsContext = buildSecretsPromptContext(s, currentLocation, presentEntities);
        system = [system, littleSisContext, secretsContext, vnOut, strictStateOutput, vnSystemPriority, nextBeatSystem].filter(Boolean).join("\n\n");
        system = [system, buildBigSisterNarrationDirectives(base || rawBase)].filter(Boolean).join("\n\n");
    }
    const wantsJson =
        type === "System Check" ||
        type === "Unified State Scan" ||
        type === "Unified State Scan (User)" ||
        type === "Journal Quests" ||
        type === "Auto-Warp Detection" ||
        type === "Navigation Location JSON" ||
        type === "Helper Pet Mutation" ||
        type === "User Line Drafts";
    const prefixes = (() => {
        try {
            const typeKey = String(type || "").trim();
            if (lockedPrompt) return "";
            if (typeKey === "Creating World") return "";
            const p = s?.generation?.promptPrefixes || {};
            const global = String(p?.global || "").trim();
            const by = (p?.byType && typeof p.byType === "object") ? p.byType : {};
            const def = String(by?.default || "").trim();
            let typed = String(by?.[typeKey] || "").trim();
            if (!typed && typeKey === "Shop") typed = String(by?.["System Check"] || "").trim();
            const combined = [global, def, typed].filter(Boolean).join("\n\n").trim();
            if (!combined) return "";
            return `UIE CUSTOM PROMPT:\n${combined}\n\n---\n\n`;
        } catch (_) {
            return "";
        }
    })();
    const pending = String(consumePendingSystemEvents ? consumePendingSystemEvents({ type }) : "").trim();
    const baseWithCustom = `${prefixes}${base}`.trim();

    // Drain buffered RP-log events so UI actions (items, phone, etc.) become AI-visible
    // to THIS generation call. This is the authoritative path for UIE module generation.
    let rpEvents = "";
    try { rpEvents = String(flushHiddenEvents ? flushHiddenEvents() : "").trim(); } catch (_) { rpEvents = ""; }

    const rootProtocol = await rootProtocolBlock(baseWithCustom);
    const finalPrompt = `${rootProtocol}\n\n${baseWithCustom}`
        + `${pending ? `\n\n[SYSTEM EVENT]\n${pending}` : ""}`
        + `${rpEvents ? `\n\n[RECENT_ACTIVITY_LOG]\n${rpEvents}` : ""}`;
    const rootBuckets = (() => {
        try { return Array.isArray(window.__uieLastRootProtocolBuckets) ? window.__uieLastRootProtocolBuckets.slice() : []; } catch (_) { return []; }
    })();
    const requestBuckets = [
        tokenBucket("system_prompt", system, { source: "api_system_message" }),
        ...rootBuckets,
        tokenBucket("user_input", baseWithCustom, { source: "current_prompt" }),
        tokenBucket("system_events", pending, { source: "pending_system_events" }),
        tokenBucket("recent_activity_log", rpEvents, { source: "rp_log_buffer" }),
    ].filter((bucket) => bucket.chars > 0);

    if (type === "Webpage" || type === "Living HTML") {
        const ok = await confirmAICall({
            what: type === "Living HTML" ? "Generate ambient scene HTML" : "Generate interactive HTML UI",
            providerModel,
            preview: String(finalPrompt || "").slice(0, 900)
        });
        if (!ok) return null;
    } else if (s.generation?.aiConfirm && type !== "User Line Drafts") {
        const ok = await confirmAICall({
            what: displayType || "Generation",
            providerModel,
            preview: String(finalPrompt || "").slice(0, 900)
        });
        if (!ok) return null;
    }

    _uieGenTrace.t0 = Date.now();
    _uieGenTrace.intendedRoute = useTurbo ? "turbo" : "main";
    _uieGenTrace.buckets = requestBuckets;
    uieApiConsole("generation_run_start", {
        kind: displayType,
        route: useTurbo ? "turbo" : "main-generateRaw",
        finalPromptChars: String(finalPrompt || "").length,
        systemChars: String(system || "").length,
        tokenBuckets: requestBuckets,
    });
    dispatchUieGenerationEvent({
        phase: "start",
        kind: displayType,
        route: useTurbo ? "turbo" : "main",
        buckets: requestBuckets,
        note: "non-streaming batch (Turbo path has no SSE in this build)",
        runPost: () => {
            if (turboEnabled && !turboReady && turboUrl) {
                const why = !turboUrl ? "missing endpoint" : (!turboIsLocal && !turboKeyRaw ? "missing key" : "not ready");
                if (window.UIE_warnedTurboNotReady !== why) {
                    window.UIE_warnedTurboNotReady = why;
                    notify("warning", `Turbo enabled but ${why} — using Main API.`, "UIE", "api");
                }
            }
        }
    });

    notify("info", useTurbo ? `⚡ ${displayType}` : `📝 ${displayType}`, undefined, "api");

    const normalizeJsonOut = (txt) => {
        const t0 = String(txt || "").trim().replace(/```json|```/g, "").trim();
        if (!t0) return null;
        try {
            const obj = JSON.parse(t0);
            return JSON.stringify(obj);
        } catch (_) {}
        const first = t0.indexOf("{");
        const last = t0.lastIndexOf("}");
        if (first >= 0 && last > first) {
            const sub = t0.slice(first, last + 1).trim();
            try {
                const obj = JSON.parse(sub);
                return JSON.stringify(obj);
            } catch (_) {}
        }
        return null;
    };

    const stripHtmlAndCss = (txt) => {
        let t = String(txt || "");
        t = t.replace(/<think[\s\S]*?<\/think>/gi, "");
        t = t.replace(/<analysis[\s\S]*?<\/analysis>/gi, "");
        t = t.replace(/```[\s\S]*?```/g, "");
        t = t.replace(/<style[\s\S]*?<\/style>/gi, "");
        t = t.replace(/<script[\s\S]*?<\/script>/gi, "");
        t = t.replace(/<[^>]*?>/g, "");
        const lines = t.replace(/\r/g, "").split("\n");
        const out = [];
        let depth = 0;
        for (const line of lines) {
            const s = String(line || "").trim();
            if (!s) { if (depth === 0) out.push(""); continue; }
            if (/\[\/?UIE_LOCATION_CHANGE\]|"locationChanged"\s*:/i.test(s)) {
                out.push(line);
                continue;
            }
            const opens = (s.match(/\{/g) || []).length;
            const closes = (s.match(/\}/g) || []).length;
            if (depth > 0) { depth = Math.max(0, depth + opens - closes); continue; }
            const looksCssStart =
                /^(\.|\#|:root\b|@keyframes\b|@media\b|@font-face\b)/i.test(s) ||
                (s.includes("--") && s.includes(":")) ||
                (s.includes("{") && s.includes(":") && !/\bhttps?:\/\//i.test(s));
            if (looksCssStart) { depth = Math.max(1, opens - closes); continue; }
            out.push(line);
        }
        return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    };

    const normalizeWebpageOut = (txt) => {
        let t = String(txt || "").trim();
        if (!t) return "";
        t = t.replace(/```html/gi, "```");
        t = t.replace(/```/g, "").trim();
        t = t.replace(/<think[\s\S]*?<\/think>/gi, "");
        t = t.replace(/<analysis[\s\S]*?<\/analysis>/gi, "");
        // If the model wrapped the HTML with explanation, try to extract the HTML block.
        const firstLt = t.indexOf("<");
        const lastGt = t.lastIndexOf(">");
        if (firstLt >= 0 && lastGt > firstLt) {
            const sub = t.slice(firstLt, lastGt + 1).trim();
            // Heuristic: require at least one tag.
            if (/<[a-z][\s\S]*?>/i.test(sub)) return sub;
        }
        return t;
    };

    const emptyVnDataJson = () => JSON.stringify({
        state_updates: {
            resource_impacts: {},
            social_impacts: [],
            new_rumor_or_memory_generated: "",
            xp_change: 0,
            stat_impacts: { hp: 0, stamina: 0, ap: 0, mp: 0, base_stats: {} },
            inventory_updates: { items_gained: [], items_lost: [], equipment_changed: {}, assets_updated: [] },
            currency_updates: { primary_change: 0, temporary_currency: { name: "", amount_change: 0 } },
            combat_log: { battles_won: 0, battles_lost: 0, new_enemies_encountered: [] },
            codex_updates: [],
            phone_updates: { social_media_notifications: [], dating_app_matches: [], bank_transactions: 0, transit_funds_change: 0 },
            status_effects: [],
            quest_triggers: []
        },
        action_wheel_options: []
    });

    let out = null;
    if (useTurbo && !out) {
        // rootProtocolBlock already carries the budgeted recent transcript and retrieved archive.
        // Adding a second Turbo chat tail duplicated the highest-cost dynamic context.
        out = await generateTurbo(finalPrompt, system, {
            kind: displayType,
            chatContextMessages: 0,
            signal: vnAbortController?.signal,
        });
        if (out) {
            traceRoute = "turbo";
            try {
                traceUsage = window.UIE_lastTurbo?.usage || null;
            } catch (_) {
                traceUsage = null;
            }
        }
    }

    // 2. Use Main API only when Turbo was not selected for this request.
    const mainConfig = getActiveMainApiConfig(s);
    const mainUrl = String(mainConfig?.url || "").trim();
    const mainKeyRaw = resolveApiKey(String(mainConfig?.key || "").trim());
    const mainProvider = String(mainConfig?.provider || "").trim().toLowerCase();
    const locals = new Set(["ollama", "lmstudio", "koboldcpp", "textgen_webui", "vllm", "localai", "llamacpp", "jan"]);
    const mainIsLocal = locals.has(mainProvider) || /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(normalizeTurboInputUrl(mainUrl));
    const mainReady = !!(mainConfig && mainUrl && (mainIsLocal || mainProvider === "aihorde" || mainProvider === "horde" || !!mainKeyRaw) && isVerifiedApiConfig(mainConfig));
    const turboUrl = String(s?.turbo?.url || "").trim();
    const mainDuplicatesTurbo = !!(
        useTurbo &&
        turboUrl &&
        normalizeTurboInputUrl(mainUrl).replace(/\/+$/, "") === normalizeTurboInputUrl(turboUrl).replace(/\/+$/, "")
    );

    if (!out && !useTurbo && mainReady && !mainDuplicatesTurbo) {
        try {
            out = await generateFromApiConfig(mainConfig, finalPrompt, system, {
                kind: displayType,
                signal: vnAbortController?.signal,
            });
            if (out) {
                traceRoute = "main-api";
                try {
                    traceUsage = window.UIE_lastTurbo?.usage || null;
                } catch (_) {
                    traceUsage = null;
                }
            }
        } catch (e) {
            if (e?.name === "AbortError" || vnAbortController?.signal?.aborted) throw e;
            console.error("[UIE] Main API call failed:", e);
        }
    }

    // 3. Fallback to native generateRaw (host integration) or report standalone failure
    if (!out) {
        try {
            if (!out) {
                if (isStandalone) {
                    const lastApi = window.UIE_lastTurbo || {};
                    const label = traceRoute === "turbo" ? "Turbo AI" : "Main API";
                    const message = !useTurbo && !mainReady
                        ? `${label}: no verified connection is available. Open Settings, choose a profile, and run Connect & apply.`
                        : describeApiFailure(lastApi, label);
                    console.error(`[UIE] Standalone generation failed: ${message}`);
                    notify(
                        "error",
                        message,
                        "UIE",
                        "api",
                    );
                    return null;
                }
                const mainPrompt = `${system}\n\n${finalPrompt}`;
                out = null;
            }
        } catch (e) {
            if (e?.name === "AbortError" || vnAbortController?.signal?.aborted) throw e;
            if (out) {
                try { consumeAutoChartTags(out); } catch (_) {}
                out = stripAutoChartTags(out);
            } else {
                try {
                    window.UIE_lastGenError = {
                        at: Date.now(),
                        type: String(type || ""),
                        message: String(e?.message || e || "Unknown error").slice(0, 800),
                        stack: String(e?.stack || "").slice(0, 3000)
                    };
                } catch (_) {}
                try { notify("error", "Generation failed. Check console for details.", "UIE", "api"); } catch (_) {}
                try { console.error("[UIE] generateRaw failed", { type, error: e }); } catch (_) {}
                return null;
            }
        }
    }
    if (!out) {
        try {
            const t = Number(window.UIE_lastGenEmptyToastAt || 0);
            if (!t || Date.now() - t > 3000) {
                window.UIE_lastGenEmptyToastAt = Date.now();
                notify("warning", "AI returned no output.", "UIE", "api");
            }
        } catch (_) {}
        return null;
    }
    if (wantsJson) {
        const fixed = normalizeJsonOut(out);
        if (fixed) out = fixed;
        else {
            const correctionRule =
                type === "Journal Quests" ?
                     "Your previous output was invalid. Output ONLY valid JSON: an array like [{\"title\":\"...\",\"desc\":\"...\"}]. No markdown, no extra text."
                    : type === "User Line Drafts" ?
                       "Your previous output was invalid. Output ONLY valid JSON: {\"lines\":[\"...\",\"...\",\"...\"]}. Exactly 3 strings. No markdown, no extra text."
                      : "Your previous output was invalid. Output ONLY a single valid JSON object. No markdown, no extra text.";
            const correction = `${finalPrompt}\n\n[CORRECTION]\n${correctionRule}`;
            try {
                if (out && traceRoute === "turbo") {
                    out = await generateTurbo(correction, system, {
                        kind: `${displayType} (json-correction)`,
                        chatContextMessages: 0,
                    });
                } else if (out && traceRoute === "main-api") {
                    out = await generateFromApiConfig(mainConfig, correction, system, {
                        kind: `${displayType} (json-correction)`,
                        chatContextMessages: 0,
                    });
                } else if (out) {
                    if (isStandalone) {
                        console.error("[UIE] Standalone generation failed during JSON correction.");
                        return null;
                    }
                    const mainCorrectionPrompt = `${system}\n\n${correction}`;
                    out = await generateRaw({ prompt: mainCorrectionPrompt, quietToLoud: false, skip_w_info: true });
                    if (out) {
                        traceRoute = "main-raw";
                        traceUsage = estimateUsageFromText(mainCorrectionPrompt, out);
                    }
                }
            } catch (_) {}
            const fixed2 = normalizeJsonOut(out);
            if (fixed2) out = fixed2;
        }
    }
    if (!wantsJson && String(type || "").trim() === "VN Dialogue") {
        const isVnFormatIssue = (issues) => Array.isArray(issues) && issues.some((issue) => /^VN response format:/i.test(String(issue || "")));
        const firstVnCheck = validateResponse ? validateResponse(out, { type: "VN Dialogue" }) : null;
        if (isVnFormatIssue(firstVnCheck?.issues)) {
            const correctionRule = [
                "Your previous output used the wrong response type and exposed scene/player state scaffolding.",
                "Regenerate the reply as visual-novel output only.",
                "The first readable character must be '['.",
                "Every readable line must be [Name]: Response, using [Narrator]: for narration.",
                "Narrator cannot contain quoted speech, character dialogue, or character actions. Move every spoken line, character action, expression, or gesture into [Exact Character Name]:, [Unknown]:, or a typed entity label like [Monster]:. Characters are free to speak multiple sentences and perform multiple actions/gestures inside their own [Name]: turns; the Narrator must never speak or act for them.",
                "Do not include Player Character, Location, Time, Current State, Context, Inventory, interactives, bullet summaries, markdown, or prompt labels.",
                "After the readable turns, output exactly ===DATA=== and then one strict JSON object following the requested schema."
            ].join("\n");
            const correction = `${finalPrompt}\n\n[INVALID OUTPUT REMOVED]\nThe prior answer was a scene-state summary, not visual-novel turns.\n\n[CORRECTION]\n${correctionRule}`;
            let corrected = null;
            try {
                if (traceRoute === "turbo") {
                    corrected = await generateTurbo(correction, system, {
                        kind: `${displayType} (vn-format-correction)`,
                        chatContextMessages: 0,
                        signal: vnAbortController?.signal,
                    });
                } else if (traceRoute === "main-api") {
                    corrected = await generateFromApiConfig(mainConfig, correction, system, {
                        kind: `${displayType} (vn-format-correction)`,
                        chatContextMessages: 0,
                        signal: vnAbortController?.signal,
                    });
                } else if (!isStandalone) {
                    const mainCorrectionPrompt = `${system}\n\n${correction}`;
                    corrected = await generateRaw({ prompt: mainCorrectionPrompt, quietToLoud: false, skip_w_info: true });
                    if (corrected) {
                        traceRoute = "main-raw";
                        traceUsage = estimateUsageFromText(mainCorrectionPrompt, corrected);
                    }
                }
            } catch (e) {
                if (e?.name === "AbortError" || vnAbortController?.signal?.aborted) throw e;
            }

            const secondVnCheck = validateResponse ? validateResponse(corrected, { type: "VN Dialogue" }) : null;
            if (corrected && !isVnFormatIssue(secondVnCheck?.issues)) {
                out = corrected;
            } else {
                console.warn("[UIE] VN format correction failed; no fallback narration will be written.", {
                    firstIssues: firstVnCheck?.issues || [],
                    secondIssues: secondVnCheck?.issues || []
                });
                out = null;
            }
        }
    }
    try {
        const finalizeOutput = (value) => {
            if (shouldApplyNextBeat) clearNextBeatPrompt();
            return value;
        };
        if (typeStr === "User Line Drafts") {
            const t0 = String(out || "").trim();
            const j = normalizeJsonOut(t0);
            if (j) return j;
            return t0;
        }
        if (String(type || "").trim() === "VN Dialogue") {
            try { consumeAutoChartTags(out); } catch (_) {}
            out = stripAutoChartTags(out);
        }
        const vr = validateResponse ? validateResponse(out, { type }) : null;
        const issues = Array.isArray(vr?.issues) ? vr.issues : [];
        if (issues.length) console.warn("[UIE] LogicEnforcer issues:", issues);
        const baseOut = String(vr?.text ?? out);
        if (type === "Webpage" || type === "Living HTML") return finalizeOutput(normalizeWebpageOut(baseOut));
        if (!wantsJson) return finalizeOutput(stripHtmlAndCss(baseOut));
        return finalizeOutput(baseOut);
    } catch (_) {
        const finalizeOutput = (value) => {
            if (shouldApplyNextBeat) clearNextBeatPrompt();
            return value;
        };
        if (type === "Webpage" || type === "Living HTML") return finalizeOutput(normalizeWebpageOut(out));
        if (!wantsJson) return finalizeOutput(stripHtmlAndCss(out));
        return finalizeOutput(out);
    }
    } finally {
        if (vnAbortController && activeVnAbortController === vnAbortController) activeVnAbortController = null;
        generationInFlight = false;
        try {
            sysGate.release();
        } catch (_) {}
        try {
            if (_uieGenTrace.t0 > 0) {
                const finalUsage = (typeof traceUsage !== "undefined" && traceUsage)
                    ? traceUsage
                    : estimateUsageFromText([system, finalPrompt].filter(Boolean).join("\n\n"), out || "");
                const tokenTrace = publishTokenUsageTrace({
                    kind: _uieGenTrace.kind,
                    route: typeof traceRoute !== "undefined" ? traceRoute : _uieGenTrace.intendedRoute,
                    model: String(window.UIE_lastTurbo?.model || ""),
                    wallMs: Date.now() - _uieGenTrace.t0,
                    usage: finalUsage,
                    buckets: _uieGenTrace.buckets || [],
                    outputText: out || "",
                });
                uieApiConsole("generation_run_end", {
                    kind: _uieGenTrace.kind,
                    wallMs: Date.now() - _uieGenTrace.t0,
                    tokenTrace,
                });
                dispatchUieGenerationEvent({
                    phase: "end",
                    kind: _uieGenTrace.kind,
                    wallMs: Date.now() - _uieGenTrace.t0,
                    route: typeof traceRoute !== "undefined" ? traceRoute : _uieGenTrace.intendedRoute,
                    usage: finalUsage,
                    buckets: _uieGenTrace.buckets || [],
                    tokenTrace,
                });
            }
        } catch (_) {}
    }
}

export async function sendToBigSis(userMessage, systemContext = "") {
    const s = getSettings();
    const readableSystem = [
        String(systemContext || "").trim(),
        "[BIG_SIS_STORY_CHANNEL]",
        "Write the narrative reply for the player as immersive roleplay, not game navigation prose. Turbo/Little Sis may provide context, but Main API owns story prose.",
        "Treat player travel/goal statements as embodied intent. If blocked, show the in-world obstacle or next physical beat instead of blandly explaining route requirements.",
        "Output readable story first, then exactly ===DATA===, then strict JSON only.",
        "JSON schema: {\"state_updates\":{\"resource_impacts\":{},\"social_impacts\":[],\"new_rumor_or_memory_generated\":\"\"},\"action_wheel_options\":[]}"
    ].filter(Boolean).join("\n\n");
    const finalPrompt = `[USER ACTION]\n${String(userMessage || "").trim()}`;
    const mainConfig = getActiveMainApiConfig(s);
    const mainUrl = String(mainConfig?.url || "").trim();
    const mainKeyRaw = resolveApiKey(String(mainConfig?.key || "").trim());
    const mainProvider = String(mainConfig?.provider || "").trim().toLowerCase();
    const locals = new Set(["ollama", "lmstudio", "koboldcpp", "textgen_webui", "vllm", "localai", "llamacpp", "jan"]);
    const mainIsLocal = locals.has(mainProvider) || /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(normalizeTurboInputUrl(mainUrl));
    const mainReady = !!(mainConfig && mainUrl && (mainIsLocal || mainProvider === "aihorde" || mainProvider === "horde" || !!mainKeyRaw) && isVerifiedApiConfig(mainConfig));
    if (mainReady) {
        return await generateFromApiConfig(mainConfig, finalPrompt, readableSystem, { kind: "Big Sis" });
    }
    return null;
}

export function cleanOutput(text) {
    if (!text) return "";
    return text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
}

/* UIE turbo switch (extension-only) */
function uieTurboEnabled() {
  try {
    const st = window?.UIE?.getSettings?.() || null;
    if (!st) return false;
    const t = st.turbo || {};
    const rawUrl = String(t.url || "").trim();
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(normalizeTurboInputUrl(rawUrl));
    return !!(t.enabled === true && rawUrl && (local || String(t.key || "").trim()) && isVerifiedApiConfig(t));
  } catch (_) {
    return false;
  }
}

let turboHealthTimer = null;
let turboHealthInFlight = false;
let turboHealthLastOk = null;
let turboHealthLastNotifyAt = 0;

async function runTurboHealthCheck({ silent = true } = {}) {
    // Disabled to stop background API console/proxy spam
    return { ok: true, ms: 0 };
}

function startTurboHealthMonitor() {
    // Disabled to stop background API console/proxy spam
}

export function initTurboUi() {
    const ensureTurboSettings = () => {
        const s = getSettings();
        if (!s.turbo || typeof s.turbo !== "object") s.turbo = {};
        return s;
    };

    const turboUrlFields = "#uie-turbo-url, #cfg-turbo-url";
    const turboKeyFields = "#uie-turbo-key, #cfg-turbo-key";
    const turboModelFields = "#uie-turbo-model, #cfg-turbo-model";
    const turboModelSelects = "#uie-turbo-model-select, #cfg-turbo-model-select";
    const turboEnableChecks = "#uie-turbo-enable, #cfg-turbo-enabled";

    const syncTurboModelSelect = (modelRaw) => {
        const model = String(modelRaw || "").trim();
        $(turboModelSelects).each(function () {
            const sel = $(this);
            if (!sel.length) return;
            if (!model) {
                sel.val("");
                return;
            }
            const hasModelOption = sel.find("option").toArray().some((opt) => String(opt?.value || "") === model);
            if (hasModelOption) {
                sel.val(model);
                return;
            }
            if (!sel.find("option[value='__custom__']").length) {
                sel.append("<option value='__custom__'>Custom...</option>");
            }
            sel.val("__custom__");
        });
    };

    const syncTurboInputsFromSettings = () => {
        const s = ensureTurboSettings();
        const t = s.turbo || {};

        $(turboEnableChecks).prop("checked", t.enabled === true);
        $(turboUrlFields).val(String(t.url || ""));
        $(turboKeyFields).val(String(t.key || ""));
        $(turboModelFields).val(String(t.model || ""));
        syncTurboModelSelect(t.model);
    };

    // Presets Logic
    const applyPreset = function(e) {
        if (e && e.preventDefault) e.preventDefault();
        const val = String($("#uie-turbo-preset").val() || $("#cfg-turbo-preset").val() || "");
        const s = ensureTurboSettings();
        if (!s.turbo.providerKeys || typeof s.turbo.providerKeys !== "object") s.turbo.providerKeys = {};
        s.turbo.provider = val || "custom";
        const providerKey = String(s.turbo.providerKeys[s.turbo.provider] || "").trim();
        $(turboKeyFields).val(providerKey);
        s.turbo.key = providerKey;

        if (val === "openrouter") {
            $(turboUrlFields).val("https://openrouter.ai/api/v1");
            s.turbo.url = "https://openrouter.ai/api/v1";
            notify("success", "Applied OpenRouter preset. Please enter your API Key.", "Turbo API");
        } else if (val === "nanogpt") {
            $(turboUrlFields).val("https://nano-gpt.com/api/v1");
            s.turbo.url = "https://nano-gpt.com/api/v1";
            notify("success", "Applied NanoGPT preset. Please enter your API Key.", "Turbo API");
        } else if (val === "groq") {
            $(turboUrlFields).val("https://api.groq.com/openai/v1");
            s.turbo.url = "https://api.groq.com/openai/v1";
            notify("success", "Applied Groq preset. Please enter your API Key.", "Turbo API");
        } else if (val === "deepseek") {
            $(turboUrlFields).val("https://api.deepseek.com/v1");
            s.turbo.url = "https://api.deepseek.com/v1";
            $(turboModelFields).val("deepseek-chat");
            s.turbo.model = "deepseek-chat";
            try {
                $(turboModelSelects).each(function () {
                    const sel = $(this);
                    sel.empty();
                    sel.append(`<option value="deepseek-chat">DeepSeek: deepseek-chat</option>`);
                    sel.append(`<option value="deepseek-reasoner">DeepSeek: deepseek-reasoner</option>`);
                    sel.append(`<option value="__custom__">Custom…</option>`);
                    sel.val("deepseek-chat");
                });
            } catch (_) {}
            notify("success", "Applied DeepSeek preset. Please enter your API Key.", "Turbo API");
        } else if (val === "pollinations") {
            $(turboUrlFields).val("https://text.pollinations.ai/");
            s.turbo.url = "https://text.pollinations.ai/";
            notify("success", "Applied Pollinations preset.", "Turbo API");
        } else if (val === "kobold") {
            $(turboUrlFields).val("http://127.0.0.1:5001/api/v1");
            s.turbo.url = "http://127.0.0.1:5001/api/v1";
            notify("success", "Applied KoboldAI preset.", "Turbo API");
        } else if (val === "llamacpp") {
            $(turboUrlFields).val("http://127.0.0.1:8080/v1");
            s.turbo.url = "http://127.0.0.1:8080/v1";
            notify("success", "Applied Llama.cpp preset.", "Turbo API");
        } else if (val === "lmstudio") {
            $(turboUrlFields).val("http://127.0.0.1:1234/v1");
            s.turbo.url = "http://127.0.0.1:1234/v1";
            notify("success", "Applied LM Studio preset.", "Turbo API");
        } else if (val === "ollama") {
            $(turboUrlFields).val("http://127.0.0.1:11434/v1");
            s.turbo.url = "http://127.0.0.1:11434/v1";
            notify("success", "Applied Ollama preset.", "Turbo API");
        } else if (val === "openai") {
            $(turboUrlFields).val("https://api.openai.com/v1");
            s.turbo.url = "https://api.openai.com/v1";
            notify("success", "Applied OpenAI preset.", "Turbo API");
        }

        saveSettings();
    };

    $(document).off("click.uieTurbo change.uieTurbo")
        .on("click.uieTurbo", "#uie-turbo-preset-apply, #cfg-turbo-preset-apply", applyPreset)
        .on("change.uieTurbo", "#uie-turbo-preset, #cfg-turbo-preset", applyPreset);

    $(document)
        .off("change.uieTurboEnabled input.uieTurboFields change.uieTurboFields")
        .on("change.uieTurboEnabled", turboEnableChecks, function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const on = $(this).prop("checked") === true;
            $(turboEnableChecks).prop("checked", on);
            const s = ensureTurboSettings();
            s.turbo.enabled = on;
            saveSettings();
        })
        .on("input.uieTurboFields change.uieTurboFields", turboUrlFields, function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const v = String($(this).val() || "").trim();
            $(turboUrlFields).val(v);
            const s = ensureTurboSettings();
            s.turbo.url = v;
            saveSettings();
        })
        .on("input.uieTurboFields change.uieTurboFields", turboKeyFields, function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const v = String($(this).val() || "").trim();
            $(turboKeyFields).val(v);
            const s = ensureTurboSettings();
            s.turbo.key = v;
            if (!s.turbo.providerKeys || typeof s.turbo.providerKeys !== "object") s.turbo.providerKeys = {};
            s.turbo.providerKeys[String(s.turbo.provider || "custom")] = v;
            saveSettings();
        });

    $(document).off("click.uieTurboTest").on("click.uieTurboTest", "#uie-turbo-test", async function (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const btn = $(this);
        btn.prop("disabled", true);
        const s = ensureTurboSettings();
        s.turbo.enabled = $(turboEnableChecks).first().prop("checked") === true;
        s.turbo.url = String($(turboUrlFields).first().val() || "").trim();
        s.turbo.key = String($(turboKeyFields).first().val() || "").trim();
        const pick = String($(turboModelSelects).first().val() || "").trim();
        const typed = String($(turboModelFields).first().val() || "").trim();
        s.turbo.model = (pick && pick !== "__custom__") ? pick : typed;
        saveSettings();

        try {
            const res = await testTurboConnection({ isTurbo: true });
            s.turbo.connectionHealth = {
                ok: !!res?.ok,
                checkedAt: Date.now(),
                fingerprint: apiConfigFingerprint(s.turbo),
                error: String(res?.error || ""),
            };
            saveSettings();
            if (res?.ok) {
                notify("success", `Turbo OK (${Number(res.ms || 0)}ms)`, "Turbo API");
            } else {
                notify("warning", `Turbo failed: ${String(res?.error || "Unknown error")}`, "Turbo API");
            }
            try {
                turboHealthLastOk = !!res?.ok;
                window.UIE_turboHealth = {
                    at: Date.now(),
                    ok: !!res?.ok,
                    ms: Number(res?.ms || 0) || 0,
                    error: String(res?.error || ""),
                    endpoint: String(s?.turbo?.url || ""),
                };
            } catch (_) {}
        } catch (err) {
            notify("error", `Turbo test error: ${String(err?.message || err || "Unknown")}`, "Turbo API");
        } finally {
            btn.prop("disabled", false);
        }
    });

    $(document)
        .off("click.uieTurboSync pointerup.uieTurboSync")
        .on("click.uieTurboSync pointerup.uieTurboSync", "#uie-settings-tabs .uie-set-tab[data-tab='turbo']", function () {
            syncTurboInputsFromSettings();
        });

    syncTurboInputsFromSettings();
}

try {
    window.UIE = window.UIE || {};
    window.UIE.generateContent = generateContent;
    window.UIE.hasVerifiedTextConnection = hasVerifiedTextConnection;
    window.UIE_generateContent = generateContent;
} catch (_) {}


export function handleApiKeyFailureAndSwitch(t, failedKeyIdOrValue) {
    const s = getSettings();
    if (!s.autoSwitchKeys) return null;
    
    let failedKeyId = failedKeyIdOrValue;
    const registry = s.savedApiKeys || {};
    
    if (registry[failedKeyIdOrValue] == null) {
        const foundId = Object.keys(registry).find(k => String(registry[k]?.value).trim() === String(failedKeyIdOrValue).trim());
        if (foundId) failedKeyId = foundId;
    }
    
    const failedKeyRec = registry[failedKeyId];
    if (!failedKeyRec) return null;
    
    const provider = failedKeyRec.provider;
    if (!provider) return null;
    
    const providerKeys = Object.keys(registry)
        .filter(k => registry[k]?.provider === provider)
        .sort((a, b) => Number(registry[a]?.createdAt || 0) - Number(registry[b]?.createdAt || 0));
        
    if (providerKeys.length <= 1) return null;
    
    const currentIndex = providerKeys.indexOf(failedKeyId);
    if (currentIndex === -1) return null;
    
    const nextIndex = (currentIndex + 1) % providerKeys.length;
    const nextKeyId = providerKeys[nextIndex];
    const nextKeyRec = registry[nextKeyId];
    if (!nextKeyRec) return null;
    
    let updated = false;
    
    const mainProfiles = s.connections?.mainProfiles || [];
    mainProfiles.forEach(p => {
        if (p.key === failedKeyId) {
            p.key = nextKeyId;
            updated = true;
        }
    });
    
    if (s.connections?.mainApi?.key === failedKeyId) {
        s.connections.mainApi.key = nextKeyId;
        updated = true;
    }
    if (s.turbo?.key === failedKeyId) {
        s.turbo.key = nextKeyId;
        updated = true;
    }
    if (s.image?.key === failedKeyId) {
        s.image.key = nextKeyId;
        updated = true;
    }
    if (s.image?.comfy?.key === failedKeyId) {
        s.image.comfy.key = nextKeyId;
        updated = true;
    }
    if (s.audio?.key === failedKeyId) {
        s.audio.key = nextKeyId;
        updated = true;
    }
    
    if (updated) {
        saveSettings();
        try {
            if (typeof window !== "undefined" && window.$) {
                const inputs = ["cfg-main-key", "cfg-turbo-key", "cfg-image-key", "cfg-image-stability-key", "cfg-image-comfy-key", "cfg-audio-key"];
                inputs.forEach(id => {
                    const $input = window.$("#" + id);
                    if ($input.length && $input.val() === failedKeyId) {
                        $input.val(nextKeyId);
                        if (typeof window.updateKeyInfoLabel === "function") {
                            window.updateKeyInfoLabel(id);
                        }
                    }
                });
                if (typeof window.showToast === "function") {
                    window.showToast("API Key failed. Auto-switched to key: " + (nextKeyRec.name || nextKeyId), 4500);
                }
            }
        } catch (_) {}
        
        return {
            keyId: nextKeyId,
            keyValue: String(nextKeyRec.value || "").trim()
        };
    }
    return null;
}
