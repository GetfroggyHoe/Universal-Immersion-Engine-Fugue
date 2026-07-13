import { getSettings, saveSettings } from "./core.js";
import { getContext } from "./gameContext.js";
import { scanContentForSafetyViolations } from "./safetyScanner.js";

const PENDING_KEY = "__uiePendingSystemEvents";

function escBlock(s) {
  return String(s || "").replace(/\r/g, "").slice(0, 2400);
}

function ensurePending(s) {
  if (!s.logicEnforcer || typeof s.logicEnforcer !== "object") s.logicEnforcer = {};
  if (!Array.isArray(s.logicEnforcer[PENDING_KEY])) s.logicEnforcer[PENDING_KEY] = [];
  return s.logicEnforcer[PENDING_KEY];
}

function listStatuses(s) {
  const a = Array.isArray(s?.inventory?.statuses) ? s.inventory.statuses : [];
  const b = Array.isArray(s?.character?.statusEffects) ? s.character.statusEffects : [];
  const list = [...a, ...b];
  const names = list.map(x => (typeof x === "string" ? x : (x?.name || x?.title || x?.label || ""))).map(x => String(x || "").trim()).filter(Boolean);
  return Array.from(new Set(names)).slice(0, 12);
}

function activePhoneScreen(s) {
  const app = String(s?.phone?.activeAppName || "").trim();
  if (app) return app;
  const v = String(s?.phone?.activeApp || "").trim();
  return v;
}

function summarizePhoneLog(s) {
  try {
    const phone = s?.phone || {};
    const threads = phone?.smsThreads && typeof phone.smsThreads === "object" ? phone.smsThreads : {};
    const entries = [];
    for (const [k, list] of Object.entries(threads)) {
      if (!Array.isArray(list) || !list.length) continue;
      const last = list[list.length - 1];
      const ts = Number(last?.ts || 0) || 0;
      entries.push({ who: String(k || "").trim(), ts, list });
    }
    entries.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
    const topThreads = entries.slice(0, 3);
    const lines = [];
    for (const th of topThreads) {
      const who = String(th.who || "").trim() || "Unknown";
      const msgs = (Array.isArray(th.list) ? th.list : []).slice(-4);
      if (!msgs.length) continue;
      lines.push(`- ${who}:`);
      for (const m of msgs) {
        const isUser = !!m?.isUser;
        const txt = String(m?.text || "").replace(/\s+/g, " ").trim().slice(0, 220);
        if (!txt) continue;
        lines.push(`  - ${isUser ? "You" : who}: ${txt}`);
      }
    }
    const calls = Array.isArray(phone.callHistory) ? phone.callHistory : [];
    const recentCalls = calls.slice(-2);
    if (recentCalls.length) {
      lines.push("");
      lines.push("Recent Calls:");
      for (const c of recentCalls) {
        const who = String(c?.who || "Unknown").trim() || "Unknown";
        const msgs = Array.isArray(c?.lines) ? c.lines.slice(-8) : [];
        lines.push(`- Call with ${who}:`);
        for (const m of msgs) {
          const isUser = !!m?.isUser;
          const txt = String(m?.text || "").replace(/\s+/g, " ").trim().slice(0, 220);
          if (!txt) continue;
          lines.push(`  - ${isUser ? "You" : who}: ${txt}`);
        }
      }
    }
    const out = lines.join("\n").trim();
    return out ? out.slice(0, 2400) : "";
  } catch (_) {
    return "";
  }
}

function extractNsfwSystemRules(ctx) {
  const hit = [];
  const seen = new Set();
  const push = (v) => {
    const t = String(v || "").trim();
    if (!t) return;
    const key = t.slice(0, 2200);
    if (seen.has(key)) return;
    seen.add(key);
    hit.push(key);
  };

  const looksRelevantKey = (k) => /(system|prompt|nsfw|rules)/i.test(String(k || ""));
  const looksNsfw = (v) => /\bnsfw\b/i.test(String(v || ""));

  try {
    if (ctx && typeof ctx === "object") {
      for (const [k, v] of Object.entries(ctx)) {
        if (typeof v === "string") {
          if (looksRelevantKey(k) || looksNsfw(v)) push(v);
        } else if (v && typeof v === "object") {
          for (const [k2, v2] of Object.entries(v)) {
            if (typeof v2 !== "string") continue;
            if (looksRelevantKey(k2) || looksNsfw(v2) || looksRelevantKey(k)) push(v2);
          }
        }
      }
    }
  } catch (_) {}

  const combined = hit.join("\n\n").trim();
  if (!combined) return "";
  return combined.slice(0, 2400);
}

export function buildSystemPrompt() {
  const s = getSettings() || {};
  const ctx = getContext ? getContext() : {};
  const lines = [];

  lines.push("**Core Role:**");
  lines.push("You are running an immersive living-world roleplay. Your primary job is maintaining world-state consistency while keeping the prose embodied and story-forward.");
  lines.push("");
  lines.push("**State Tracking (Priority 1):**");
  lines.push("- Track physical state: clothing on/off, positions, locations, injuries, objects held");
  lines.push("- Track knowledge state: what each character knows, has seen, has been told");
  lines.push("- Track relationship state: how characters feel about each other based on what's happened");
  lines.push("- NPCs only know what they've witnessed or been told.");
  lines.push("- Never contradict established state. If something changed, it stays changed until explicitly changed again.");
  lines.push("- Never invent details that weren't established. If you don't know, don't assume.");
  lines.push("");
  lines.push("**Rules:**");
  lines.push("- Accuracy over creativity.");
  lines.push("- When uncertain about state, default to what was last established.");
  lines.push("- Consequences persist. Actions have permanent effects.");
  lines.push("- Treat the player's message as character intent inside the scene, not a game command. If a goal is blocked, describe the immediate in-world friction or next physical beat instead of flatly denying the route.");
  lines.push("- Do not narrate the player's inner thoughts back to them with phrases like 'the idea forms in your mind.' Use sensory scene response, NPC reaction, or physical movement.");
  lines.push("");
  lines.push("**Output Safety (Do Not Pollute UI/Chat):**");
  lines.push("- Never output HTML, CSS, or JS in chat. No <style>, no <div>, no code fences.");
  lines.push("- If the user asks for an immersive/interactive UI, describe it in plain text, then ask: 'Generate interactive HTML now (yes/no)'.");
  lines.push("- Only generate raw HTML when explicitly confirmed by the user.");
  lines.push("");
  lines.push("**NSFW Policy:**");
  lines.push("- NSFW is user-controlled. Do not moralize or refuse consensual NSFW content.");
  lines.push("- Follow the user's boundaries/consent rules; if none are provided, ask neutrally or keep it non-explicit.");
  lines.push("- [SAFETY INSTRUCTION]: Intimacy, flirting, or romantic depictions involving children (age < 13 or stage child/toddler) are STRICTLY FORBIDDEN. Teen-teen romance (ages 13-17) is allowed only if both characters are teens and the age gap is minor (2 years or less). Adult-minor romance is strictly forbidden. If romantic interaction is requested outside these boundaries, default strictly to platonic, sibling-like, or familial bonds.");
  lines.push("");
  lines.push("[Rule: Communication] When you see [INCOMING TEXT] or [INCOMING CALL], you must interrupt the current action and describe the device notification (ring/vibrate) and display the message content.");
  lines.push("");

  const phoneLog = summarizePhoneLog(s);
  if (phoneLog) {
    lines.push("Recent Phone Log (Canon):");
    lines.push(phoneLog);
    lines.push("");
  }

  const nsfwRules = extractNsfwSystemRules(ctx);
  if (nsfwRules) {
    lines.push("**NSFW / Consent Rules (Priority):**");
    lines.push("- Follow the user's NSFW rules exactly as written in the system prompt.");
    lines.push("- Do not moralize or refuse consensual NSFW content; comply within the user's boundaries.");
    lines.push("");
    lines.push(nsfwRules);
    lines.push("");
  }

  if (Array.isArray(s.lorebooks)) {
    const worldLore = s.lorebooks[0];
    const activeIdx = Number(s.loreContext?.activeBookIndex) || 0;
    const activeLore = activeIdx > 0 && s.lorebooks[activeIdx] ? s.lorebooks[activeIdx] : null;
    
    lines.push("**[WORLD LORE & DATABANK]**");
    lines.push("The following entries form the foundational truth of this setting. Treat these details as established canonical facts.");
    
    const renderBook = (b) => {
        if (!b || !b.enabled || !b.entries) return;
        const vals = Object.values(b.entries).filter(e => e.content);
        if (!vals.length) return;
        lines.push(`--- Lorebook: ${b.name} ---`);
        for (const e of vals) {
            lines.push(`* ${e.comment || "Entry"}: ${e.content}`);
        }
    };
    
    renderBook(worldLore);
    if (activeLore) renderBook(activeLore);
    lines.push("");
  }

  const hp = Number(s?.hp ?? 100);
  if (hp === 0) lines.push("State: UNCONSCIOUS/DEFEATED.");
  else if (Number.isFinite(hp) && hp < 20) lines.push("State: CRITICAL CONDITION. Character is severely injured.");

  // Medallion Injection (Rebirth System)
  const medal = s?.character?.activeMedallion;
  if (medal) {
      if (medal === "medallion_water") {
          lines.push("[System Note: User has 'Flow State'. Physics/friction apply loosely. Attacks phase through User like water. User has infinite stamina.]");
      } else if (medal === "medallion_earth") {
          lines.push("[System Note: User has 'Mountain Heart'. Skin is diamond-hard. User cannot be knocked back. User weighs immensely heavy.]");
      } else if (medal === "medallion_air") {
          lines.push("[System Note: User has 'Sky Walker'. User ignores gravity/fall damage. Movement is silent. Attacks are critical hits.]");
      } else if (medal === "medallion_fire") {
          lines.push("[System Note: User has 'Burning Soul'. User radiates intense heat. Wounds cauterize instantly. If User dies, trigger 'Phoenix Resurrection'.]");
      } else if (medal === "medallion_rebel") {
          lines.push("[System Note: User has 'Rule Breaker'. Ignore all class restrictions for items. Low-level NPCs are compelled to serve User.]");
      }
  }

  const statuses = listStatuses(s);
  if (statuses.length) lines.push(`Active Effects: ${statuses.map(x => `[${x}]`).join(" ")}`);

  const app = activePhoneScreen(s);
  if (app) lines.push(`User is currently looking at the [${app}] screen.`);

  const battleActive = !!(s?.battle?.state?.active);
  lines.push(`Battle Tracker: ${battleActive ? "ACTIVE" : "idle"}.`);

  try {
    const members = Array.isArray(s?.party?.members) ? s.party.members : [];
    const activeCount = members.filter(m => m && m.active !== false).length;
    const leader = members.find(m => String(m?.id || "") === String(s?.party?.leaderId || ""));
    const leaderName = String(leader?.identity?.name || "").trim();
    if (activeCount) lines.push(`Party: ${activeCount} active member(s)${leaderName ? ` | Leader: ${leaderName}` : ""}.`);
  } catch (_) {}

  const who = `${String(ctx?.name1 || "User")} / ${String(ctx?.name2 || "Character")}`.trim();
  lines.push(`Context Identities: ${who}`);

  const cutscenesEnabled = s?.rpg?.cutscenesEnabled !== false;
  if (cutscenesEnabled) {
    lines.push("");
    lines.push("**[CUTSCENE SYSTEM]**");
    lines.push("You can trigger immersive cinematic cutscenes that hide all UI, change location, show sprites, and play background images. Cutscenes are SMART — only trigger them when dramatically appropriate.");
    lines.push("");
    lines.push("**When to trigger cutscenes (use sparingly, max 1 per response):**");
    lines.push("- Major story revelations or plot twists");
    lines.push("- Location transitions (arriving at a new important area)");
    lines.push("- NPC entrances or dramatic confrontations");
    lines.push("- Combat beginnings or climactic moments");
    lines.push("- Time skips or significant world events");
    lines.push("- Emotional climaxes or relationship milestones");
    lines.push("");
    lines.push("**Do NOT trigger cutscenes for:**");
    lines.push("- Routine dialogue or casual conversation");
    lines.push("- Minor actions or small movements");
    lines.push("- Every response — they must feel special and earned");
    lines.push("");
    lines.push("**How to trigger (add to state_updates.cutscenes array in JSON):**");
    lines.push('```json');
    lines.push('"cutscenes": [{');
    lines.push('  "title": "Short dramatic title",');
    lines.push('  "body": "2-4 sentences of cinematic narration. Sensory details, atmosphere, tension.",');
    lines.push('  "location": "New location name (optional, only if scene moves)",');
    lines.push('  "background": "URL to background image (optional)",');
    lines.push('  "characters": ["NPC Name 1", "NPC Name 2"],');
    lines.push('  "duration": 6500,');
    lines.push('  "persistLocation": true,');
    lines.push('  "eventType": "revelation|transition|confrontation|climax",');
    lines.push('  "pov": "Camera angle: Wide Shot, Close-Up, Breakaway, etc."');
    lines.push('}]');
    lines.push('```');
    lines.push("");
    lines.push("Alternatively, use inline tag: [Cutscene: body text here]");
  }

  return lines.join("\n").trim();
}

export function handleIncomingCommunication(type, sender, content) {
  const s = getSettings() || {};
  const t = String(type || "").toLowerCase();
  const from = String(sender || "Unknown").trim();
  const body = String(content || "").trim();
  const pending = ensurePending(s);

  let block = "";
  if (t === "call") {
    block = `[INCOMING CALL] Caller: ${from} | Status: Ringing...`;
    try {
      if (typeof window.UIE_phone_incomingCall === "function") window.UIE_phone_incomingCall(from);
    } catch (_) {}
  } else {
    block = `[INCOMING TEXT] From: ${from} | Message: "${escBlock(body)}"`;
    try {
      if (typeof window.UIE_phone_incomingText === "function") window.UIE_phone_incomingText(from, body);
    } catch (_) {}
  }

  pending.push({ ts: Date.now(), type: t, sender: from, content: body, block });
  while (pending.length > 12) pending.shift();
  try { saveSettings(); } catch (_) {}
  return block;
}

export function consumePendingSystemEvents(options = {}) {
  const s = getSettings() || {};
  const pending = ensurePending(s);
  if (!pending.length) return "";
  const targetType = String(options?.type || "").trim();
  const consumed = [];
  const retained = [];
  for (const event of pending) {
    const eventTarget = String(event?.targetType || "").trim();
    if (!eventTarget || !targetType || eventTarget === targetType) consumed.push(event);
    else retained.push(event);
  }
  const blocks = consumed.map(e => String(e?.block || "")).filter(Boolean).slice(-6);
  s.logicEnforcer[PENDING_KEY] = retained;
  try { saveSettings(); } catch (_) {}
  return blocks.join("\n");
}

export function queueSystemEvent(block, metadata = {}) {
  const text = escBlock(block).trim();
  if (!text) return "";
  const s = getSettings() || {};
  const pending = ensurePending(s);
  pending.push({
    ts: Date.now(),
    type: String(metadata?.type || "system_event").slice(0, 80),
    sender: String(metadata?.sender || "UIE").slice(0, 120),
    content: String(metadata?.content || "").slice(0, 1200),
    targetType: String(metadata?.targetType || "").slice(0, 120),
    block: text
  });
  while (pending.length > 12) pending.shift();
  try { saveSettings(); } catch (_) {}
  return text;
}

export function validateResponse(responseText) {
  const opts = arguments.length > 1 && arguments[1] && typeof arguments[1] === "object" ? arguments[1] : {};
  const s = getSettings() || {};
  const issues = [];
  const text = String(responseText || "");

  // Scan LLM outputs for severe safety violations
  if (scanContentForSafetyViolations(text, "AI response")) {
      return { text: "", issues: ["Safety lockout active"] };
  }

  const inv = Array.isArray(s?.inventory?.items) ? s.inventory.items : [];
  const invBlob = inv.map(it => `${String(it?.name || "")} ${String(it?.type || "")}`).join(" ").toLowerCase();

  const keywords = ["sword", "dagger", "knife", "gun", "pistol", "rifle", "bow", "crossbow", "staff", "wand", "shield", "armor", "helm", "helmet"];
  const used = keywords.filter(k => text.toLowerCase().includes(k));
  if (used.length) {
    const missing = used.filter(k => !invBlob.includes(k));
    if (missing.length) issues.push(`Inventory mismatch: mentions ${missing.join(", ")} but it isn't in inventory.`);
  }

  if (String(opts?.type || opts?.responseType || "").trim() === "VN Dialogue") {
    const vnIssues = validateVnDialogueShape(text);
    issues.push(...vnIssues);
  }

  const callVisible = !!(typeof document !== "undefined" && document.querySelector("#uie-call-screen") && typeof $ === "function" && $("#uie-call-screen").is(":visible"));
  if (callVisible) {
    const looksNarrative = /\b(walks|looks|smiles|grabs|turns|moves|stands)\b/i.test(text);
    const hasSpeaker = /^\s*[^:\n]{1,30}:\s/m.test(text);
    if (hasSpeaker) issues.push("Phone call format: do not include speaker labels like 'Name: ...'.");
    if (looksNarrative) issues.push("Phone call format: output must be spoken words only (no narration/actions).");
  }

  return { text, issues };
}

const VN_STATE_SUMMARY_LABEL_RE = /^(?:[*-]\s*)?(?:player character|location|time|current state|context|current context|inventory|immediate interactives|interactives|use)\s*:/i;
const VN_TURN_RE = /^\s*\[[^\]\n]{1,80}\]:\s*\S/;
const VN_NARRATOR_TURN_RE = /^\s*\[(?:Narrator|Story|World|System)\]\s*:\s*(.+)$/i;

function validateVnDialogueShape(rawText) {
  const issues = [];
  let readable = String(rawText || "")
    .replace(/<think[\s\S]*?<\/think>/gi, "")
    .replace(/<analysis[\s\S]*?<\/analysis>/gi, "")
    .split("===DATA===")[0]
    .trim();

  readable = readable.replace(/```(?:json|text)?/gi, "").replace(/```/g, "").trim();
  const lines = readable.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const storyLines = lines.filter((line) => !/^\[OBJECT\b/i.test(line));
  const first = storyLines[0] || "";
  const stateLabelCount = storyLines.filter((line) => VN_STATE_SUMMARY_LABEL_RE.test(line)).length;
  const hasTurn = storyLines.some((line) => VN_TURN_RE.test(line));

  if (!readable || !storyLines.length) {
    issues.push("VN response format: empty readable story; expected [Name]: visual-novel turns.");
    return issues;
  }

  if (stateLabelCount >= 2 || VN_STATE_SUMMARY_LABEL_RE.test(first)) {
    issues.push("VN response format: model returned a scene-state summary instead of [Name]: visual-novel turns.");
  }

  if (!VN_TURN_RE.test(first)) {
    issues.push("VN response format: first readable line must be [Name]: Response.");
  }

  if (!hasTurn) {
    issues.push("VN response format: no [Name]: Response turn found.");
  }

  if (storyLines.some((line) => /^\s*\[Name\]\s*:/i.test(line))) {
    issues.push("VN response format: do not output literal [Name]; use [Unknown] or a typed entity label such as [Monster].");
  }

  // Group storyLines into turns to validate the entire block of each narrator turn
  const turns = [];
  let currentTurn = null;
  for (const line of storyLines) {
    const turnMatch = line.match(/^\s*\[([^\]\n]{1,80})\]\s*:\s*(.*)$/);
    if (turnMatch) {
      if (currentTurn) turns.push(currentTurn);
      currentTurn = {
        speaker: turnMatch[1].trim(),
        lines: [turnMatch[2].trim()]
      };
    } else {
      if (currentTurn) {
        currentTurn.lines.push(line);
      } else {
        currentTurn = {
          speaker: "Narrator",
          lines: [line]
        };
      }
    }
  }
  if (currentTurn) turns.push(currentTurn);

  let narratorSpoken = false;
  const ignoredWords = /^(he|she|they|it|the|a|an|this|that|but|then|now|there|here|when|as|if|while|although|indeed|someone|somebody|everyone|everybody|nobody|something|everything|nothing|one|both|either|neither)$/i;

  for (const turn of turns) {
    const isNarrator = /^(Narrator|Story|World|System)$/i.test(turn.speaker);
    if (!isNarrator) continue;

    const blockText = turn.lines.join("\n");

    // Check 1: Quoted speech or dialogue verbs followed by speech
    const hasQuotes = /["“”].{1,260}["“”]/.test(blockText) || 
                      /\b(?:says|said|asks|asked|replies|replied|whispers|shouts|calls|murmurs)\s*,?\s*["“”]/i.test(blockText);

    // Check 2: Named character actions (e.g., "Miko steps forward" or "Rowan Mercer stands")
    let hasCharacterAction = false;
    const actionRe = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b\s+(?:steps|leans|stands|walks|looks|smiles|grabs|turns|moves|sighs|nods|shakes|shrugs|says|asks|speaks|reaches|adjusts|crosses|laughs|frowns|points|whispers|shouts|calls|murmurs|replies|states|walked|looked|smiled|grabbed|turned|moved|sighed|nodded|shrugged|said|asked|spoke|reached|adjusted|crossed|laughed|frowned|pointed|whispered|shouted|called|murmured|replied|stated)\b/g;
    
    let match;
    while ((match = actionRe.exec(blockText)) !== null) {
      const name = match[1].trim();
      if (!ignoredWords.test(name)) {
        hasCharacterAction = true;
        break;
      }
    }

    if (hasQuotes || hasCharacterAction) {
      narratorSpoken = true;
      break;
    }
  }

  if (narratorSpoken) {
    issues.push("VN response format: Narrator may narrate only; character dialogue must be split into that character's own [Name]: Response turn.");
  }

  return Array.from(new Set(issues));
}
