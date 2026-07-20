import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";
import { advanceWorldTimeMinutes } from "./timeProgress.js";
import { addInventoryItemWithStack } from "./inventoryItems.js";
import { runTimingChallenge, runSequenceChallenge, initMinigameBridge } from "./minigameBridge.js";
import { openAccessPanel } from "./accessControl.js";

const TOOL_PROFILES = [
    { match: /crowbar|pry bar/, actions: ["pry", "force", "lift"], targets: /door|crate|container|debris|panel|window|locker|safe/ },
    { match: /lockpick|pick set/, actions: ["pick"], targets: /door|lock|container|chest|locker|safe/ },
    { match: /screwdriver/, actions: ["open panel", "repair"], targets: /panel|terminal|machine|vehicle|electronic|computer/ },
    { match: /wrench|spanner/, actions: ["repair", "loosen"], targets: /pipe|machine|vehicle|engine|valve|ship/ },
    { match: /shovel|spade/, actions: ["dig", "clear debris"], targets: /ground|soil|grave|garden|debris|snow|sand/ },
    { match: /axe|hatchet/, actions: ["chop", "break"], targets: /wood|tree|door|crate|barricade|root/ },
    { match: /knife|blade/, actions: ["cut", "prepare"], targets: /rope|food|plant|cloth|net|package/ },
    { match: /flashlight|torch|lantern/, actions: ["illuminate"], targets: /dark|cave|room|tunnel|object|area/ },
    { match: /scanner|detector/, actions: ["scan"], targets: /object|creature|evidence|terminal|vehicle|area|anomaly/ },
    { match: /camera/, actions: ["photograph"], targets: /object|person|evidence|scene|area|sign/ },
    { match: /fishing rod|fishing pole/, actions: ["fish"], targets: /water|river|lake|sea|ocean|dock|pier|shore/ },
    { match: /cooking kit|cookware/, actions: ["cook"], targets: /food|campfire|stove|kitchen|hearth/ },
    { match: /medical kit|medkit|first aid/, actions: ["treat"], targets: /person|patient|injury|wound|self/ },
    { match: /hacking device|data spike|cyberdeck/, actions: ["hack"], targets: /terminal|computer|electronic|keypad|door|console/ },
    { match: /keyring|keys/, actions: ["try keys"], targets: /door|lock|container|vehicle|safe|locker/ },
    { match: /rope|grappling/, actions: ["climb", "tie", "descend", "rescue"], targets: /ledge|wall|pit|cliff|person|post|shaft|window/ },
    { match: /repair kit|tool kit/, actions: ["repair"], targets: /machine|vehicle|ship|carriage|car|spaceship|device|object/ },
    { match: /compass/, actions: ["navigate"], targets: /route|trail|wilderness|sea|desert|area/ },
];

function esc(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function ensureState(s = getSettings()) {
    if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
    if (!s.worldState.objectStates || typeof s.worldState.objectStates !== "object" || Array.isArray(s.worldState.objectStates)) s.worldState.objectStates = {};
    if (!Array.isArray(s.worldState.evidence)) s.worldState.evidence = [];
    if (!Array.isArray(s.worldState.toolActionLog)) s.worldState.toolActionLog = [];
    if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
    if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
    return s;
}

function targetText(target) {
    return [target?.id, target?.name, target?.label, target?.type, target?.objectType, target?.description, target?.tags].flat(3).join(" ").toLowerCase() || "object";
}

function toolText(tool) {
    return [tool?.id, tool?.name, tool?.type, tool?.category, tool?.tags, tool?.tool_properties?.provided_capabilities].flat(3).join(" ").toLowerCase();
}

function objectId(target) {
    return String(target?.id || target?.slotId || target?.name || "world_object");
}

function profileFor(tool) {
    const text = toolText(tool);
    return TOOL_PROFILES.find((profile) => profile.match.test(text)) || null;
}

export function resolveContextualActions(target = {}, s = getSettings()) {
    s = ensureState(s);
    const text = targetText(target);
    const locked = target.locked || target.lock || target.accessLock;
    const actions = [];
    s.inventory.items.forEach((tool, toolIndex) => {
        const profile = profileFor(tool);
        if (!profile) return;
        const compatible = profile.targets.test(text) || (locked && /pick|force|hack|try keys/.test(profile.actions.join(" ")));
        if (!compatible) return;
        profile.actions.forEach((action) => actions.push({
            id: `${toolIndex}:${action}`,
            action,
            label: `${action.charAt(0).toUpperCase()}${action.slice(1)}`,
            tool,
            toolIndex,
            risky: /force|break|hack|pry/.test(action),
            challenge: /hack/.test(action) ? "sequence" : /repair|fish|cook|treat|pick|force|pry|climb|dig|chop|cut/.test(action) ? "timing" : "instant",
        }));
    });
    return actions;
}

function wearTool(tool, amount = 1) {
    if (!tool || amount <= 0) return;
    const props = tool.tool_properties || tool.toolProperties || {};
    if (Number.isFinite(Number(props.current_durability))) props.current_durability = Math.max(0, Number(props.current_durability) - amount);
    else if (Number.isFinite(Number(tool.durability))) tool.durability = Math.max(0, Number(tool.durability) - amount);
    else if (Number.isFinite(Number(tool.charges))) tool.charges = Math.max(0, Number(tool.charges) - amount);
}

function applyOutcome(target, action, tool, success) {
    const s = ensureState();
    const id = objectId(target);
    const previous = s.worldState.objectStates[id] && typeof s.worldState.objectStates[id] === "object" ? s.worldState.objectStates[id] : {};
    const patch = { lastAction: action, lastTool: tool?.name || "tool", lastOutcome: success ? "success" : "failure", updatedAt: Date.now() };
    if (success && /repair/.test(action)) patch.condition = "repaired";
    if (success && /illuminate/.test(action)) patch.illuminated = true;
    if (success && /scan/.test(action)) patch.scanned = true;
    if (success && /photograph/.test(action)) patch.photographed = true;
    if (success && /dig|clear debris|chop|cut|break|pry|force/.test(action)) patch.cleared = true;
    if (success && /navigate/.test(action)) patch.routeSurveyed = true;
    s.worldState.objectStates[id] = { ...previous, ...patch };
    if (/force|break|pry|hack/.test(action)) {
        s.worldState.evidence.push({ id: `${id}_${Date.now()}`, type: success ? "tool_use" : "failed_tampering", objectId: id, action, tool: tool?.name || "", createdAt: Date.now() });
        s.worldState.evidence = s.worldState.evidence.slice(-100);
        s.worldState.suspicion = Math.min(100, Number(s.worldState.suspicion || 0) + (success ? 2 : 5));
    }
    if (success && action === "photograph") {
        if (!Array.isArray(s.worldState.photographs)) s.worldState.photographs = [];
        s.worldState.photographs.push({ id: `${id}_${Date.now()}`, subject: target.name || target.label || "Scene", location: s.worldState.location || s.worldState.currentLocation || "", createdAt: Date.now() });
        s.worldState.photographs = s.worldState.photographs.slice(-120);
    }
    if (success && action === "fish") addInventoryItemWithStack(s.inventory.items, { name: target.catchName || "Fresh Catch", type: "Food", qty: 1 }, { source: "fishing" });
    if (success && action === "cook") addInventoryItemWithStack(s.inventory.items, { name: target.recipeOutput || "Prepared Meal", type: "Food", qty: 1 }, { source: "contextual_cooking" });
    if (success && action === "treat") {
        const vitals = s.inventory.vitals || (s.inventory.vitals = {});
        vitals.hp = Math.min(Number(vitals.maxHp || 100), Number(vitals.hp || 0) + 12);
    }
    wearTool(tool, success ? 1 : 2);
    advanceWorldTimeMinutes(s, /fish|cook|repair|treat/.test(action) ? 20 : 5, { reason: `${action} ${target.name || "object"}` });
    s.worldState.toolActionLog.push({ objectId: id, action, tool: tool?.name || "", success, at: Date.now() });
    s.worldState.toolActionLog = s.worldState.toolActionLog.slice(-150);
    saveSettings();
    try { window.dispatchEvent(new CustomEvent("uie:object_changed", { detail: { objectId: id, action, success } })); } catch (_) {}
    notify(success ? "success" : "warning", success ? `${action} succeeded; the world object now remembers the change.` : `${action} failed; time and tool wear still apply.`, target.name || "Tool action");
}

export function performContextualAction(target, resolvedAction, callbacks = {}) {
    if (!resolvedAction) return false;
    const { action, tool, challenge } = resolvedAction;
    if (/pick|hack|try keys|force|pry/.test(action) && (target.locked || target.lock || target.accessLock)) {
        closeContextActions();
        openAccessPanel(target, { onUnlocked: callbacks.onUnlocked });
        return true;
    }
    const success = () => { applyOutcome(target, action, tool, true); callbacks.onComplete?.({ success: true, action, tool }); closeContextActions(); };
    const failure = () => { applyOutcome(target, action, tool, false); callbacks.onComplete?.({ success: false, action, tool }); closeContextActions(); };
    if (challenge === "sequence") runSequenceChallenge({ id: `tool:${objectId(target)}:${action}`, title: `${action}: ${target.name || "target"}`, difficulty: Number(target.difficulty || 40), onSuccess: success, onFailure: failure, onAbort: () => openContextActions(target, callbacks) });
    else if (challenge === "timing") runTimingChallenge({ id: `tool:${objectId(target)}:${action}`, title: `${action}: ${target.name || "target"}`, instructions: `Use ${tool.name} at the right moment.`, difficulty: Number(target.difficulty || 35), onSuccess: success, onFailure: failure, onAbort: () => openContextActions(target, callbacks) });
    else success();
    return true;
}

function ensureModal() {
    let modal = document.getElementById("uie-context-actions-modal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "uie-context-actions-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.style.cssText = "display:none;position:fixed;inset:0;z-index:2147483643;align-items:center;justify-content:center;background:rgba(2,6,23,.72);backdrop-filter:blur(9px);padding:14px;box-sizing:border-box";
    modal.innerHTML = `<section style="width:min(720px,96vw);max-height:88vh;overflow:auto;background:#0b1220;border:1px solid rgba(167,139,250,.35);border-radius:16px;color:#f8fafc"><header style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1)"><div style="flex:1"><small style="color:#c4b5fd;text-transform:uppercase;letter-spacing:.12em">Contextual tools</small><h2 id="uie-context-title" style="margin:3px 0 0;font-size:20px"></h2></div><button id="uie-context-close" type="button" style="border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff;border-radius:9px;padding:9px 12px">Close</button></header><div id="uie-context-body" style="padding:16px"></div></section>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => { if (event.target === modal) closeContextActions(); });
    modal.querySelector("#uie-context-close")?.addEventListener("click", closeContextActions);
    return modal;
}

export function closeContextActions() {
    const modal = document.getElementById("uie-context-actions-modal");
    if (modal) modal.style.display = "none";
}

export function openContextActions(target = {}, callbacks = {}) {
    initMinigameBridge();
    const actions = resolveContextualActions(target);
    const modal = ensureModal();
    modal.querySelector("#uie-context-title").textContent = String(target.name || target.label || "World object");
    const body = modal.querySelector("#uie-context-body");
    body.innerHTML = `<p style="margin-top:0;color:#cbd5e1">${esc(target.description || "Choose a compatible tool from your inventory. Impossible actions are omitted.")}</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">${actions.map((entry) => `<button type="button" data-context-action="${esc(entry.id)}" style="text-align:left;border:1px solid rgba(167,139,250,.3);background:rgba(124,58,237,.1);color:#f8fafc;border-radius:11px;padding:11px;cursor:pointer"><strong style="display:block">${esc(entry.label)}</strong><small style="color:#a5b4fc">${esc(entry.tool.name || "Tool")}${entry.risky ? " · noisy/risky" : ""}</small></button>`).join("") || `<div style="padding:14px;border:1px dashed #475569;border-radius:10px;color:#94a3b8">No carried tool has a valid action for this target.</div>`}</div>`;
    const byId = new Map(actions.map((entry) => [entry.id, entry]));
    body.querySelectorAll("[data-context-action]").forEach((button) => button.addEventListener("click", () => performContextualAction(target, byId.get(button.dataset.contextAction), callbacks)));
    modal.style.display = "flex";
    return true;
}

export function initContextualActions() {
    ensureState();
    ensureModal();
    initMinigameBridge();
    window.UIE_ContextActions = { open: openContextActions, close: closeContextActions, resolve: resolveContextualActions, perform: performContextualAction };
}

