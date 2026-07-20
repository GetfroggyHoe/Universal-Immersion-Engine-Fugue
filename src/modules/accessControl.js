import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";
import { runTimingChallenge, runSequenceChallenge, initMinigameBridge } from "./minigameBridge.js";

const TYPE_LABELS = {
    unlocked: "Unlocked", latch: "Simple latch", key: "Key lock", keycard: "Credential reader",
    combination: "Combination lock", puzzle: "Puzzle mechanism", skill: "Skill gate", stat: "Physical barrier",
    reputation: "Reputation access", faction: "Faction access", relationship: "Personal permission",
    quest: "Quest access", time: "Scheduled access", owner: "Owner-only", magical: "Arcane seal",
    electronic: "Electronic lock", jammed: "Jammed lock", barred: "Barred passage", disabled: "Temporarily disabled",
};

function esc(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function slug(value, fallback = "lock") {
    return String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
}

function ensureState(s = getSettings()) {
    if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
    if (!s.worldState.accessLocks || typeof s.worldState.accessLocks !== "object" || Array.isArray(s.worldState.accessLocks)) s.worldState.accessLocks = {};
    if (!s.worldState.accessPermissions || typeof s.worldState.accessPermissions !== "object" || Array.isArray(s.worldState.accessPermissions)) s.worldState.accessPermissions = {};
    if (!s.worldState.objectStates || typeof s.worldState.objectStates !== "object" || Array.isArray(s.worldState.objectStates)) s.worldState.objectStates = {};
    if (!Array.isArray(s.worldState.evidence)) s.worldState.evidence = [];
    if (!Number.isFinite(Number(s.worldState.suspicion))) s.worldState.suspicion = 0;
    if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
    if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
    return s;
}

function locationId(s) {
    return slug(s?.worldState?.location || s?.worldState?.currentLocation || "world", "world");
}

function inferType(source, object) {
    const explicit = String(source.type || source.lockType || object.lockType || "").toLowerCase().replace(/[_\s-]+/g, "");
    const aliases = { simplelatch: "latch", keylock: "key", keycardlock: "keycard", combinationlock: "combination", puzzlelock: "puzzle", skilllock: "skill", statrequirement: "stat", reputationrequirement: "reputation", factionrequirement: "faction", relationshiprequirement: "relationship", questrequirement: "quest", timebased: "time", owneronly: "owner", fantasyseal: "magical", magicalseal: "magical", electroniclock: "electronic", broken: "jammed", temporarilydisabled: "disabled" };
    if (aliases[explicit]) return aliases[explicit];
    if (TYPE_LABELS[explicit]) return explicit;
    const text = `${object.name || ""} ${object.type || ""} ${object.requiredTool || ""}`.toLowerCase();
    if (/terminal|computer|electronic|hack|keypad/.test(text)) return "electronic";
    if (/keycard|badge|credential/.test(text)) return "keycard";
    if (/safe|combination/.test(text)) return "combination";
    if (/seal|arcane|magic|rune/.test(text)) return "magical";
    return object.locked === false ? "unlocked" : "key";
}

export function normalizeLock(object = {}, s = getSettings()) {
    s = ensureState(s);
    const raw = object.accessLock || object.lock || object.lockDefinition || {};
    const source = raw && typeof raw === "object" ? raw : {};
    const objectId = String(object.id || object.slotId || object.containerId || object.name || "object");
    const id = String(source.id || source.lockId || object.lockId || `${locationId(s)}_${slug(objectId)}_lock`);
    const persisted = s.worldState.accessLocks[id] && typeof s.worldState.accessLocks[id] === "object" ? s.worldState.accessLocks[id] : {};
    const type = inferType(source, object);
    const initiallyLocked = type !== "unlocked" && object.locked !== false && source.locked !== false;
    return {
        id,
        objectId,
        objectName: String(object.name || object.label || "Secured object"),
        type,
        difficulty: Math.max(1, Math.min(100, Number(source.difficulty || source.difficultyRating || object.difficulty || 38))),
        state: persisted.state || source.state || (initiallyLocked ? "locked" : "unlocked"),
        validKeys: [...(source.validKeys || []), ...(source.key ? [source.key] : []), ...(object.requiredKey ? [object.requiredKey] : [])].filter(Boolean),
        accessItems: [...(source.accessItems || []), ...(source.keycard ? [source.keycard] : [])].filter(Boolean),
        code: String(source.code || source.combination || object.code || ""),
        requiredStats: source.requiredStats || source.stats || {},
        requiredSkill: String(source.requiredSkill || source.skill || ""),
        requiredFaction: String(source.requiredFaction || ""),
        requiredReputation: Number(source.requiredReputation || 0),
        requiredRelationship: source.requiredRelationship || null,
        requiredQuest: String(source.requiredQuest || ""),
        owner: String(source.owner || object.owner || ""),
        schedule: source.schedule || null,
        validAbilities: Array.isArray(source.validAbilities) ? source.validAbilities : [],
        alternateEntrance: source.alternateEntrance || null,
        failureConsequences: source.failureConsequences || {},
        successConsequences: source.successConsequences || {},
        remembersAttempts: source.remembersAttempts !== false,
        damagePersists: source.damagePersists !== false,
        noticeTampering: source.noticeTampering !== false,
        canRelock: source.canRelock === true,
        attempts: Number(persisted.attempts || 0),
        damage: Number(persisted.damage || 0),
        tampered: Boolean(persisted.tampered),
        unlockedBy: String(persisted.unlockedBy || ""),
        updatedAt: Number(persisted.updatedAt || 0),
    };
}

function itemText(item) {
    return [item?.id, item?.name, item?.type, item?.category, item?.tags, item?.tool_properties?.provided_capabilities].flat(3).join(" ").toLowerCase();
}

function findItem(s, terms = []) {
    const needles = terms.flat().map((term) => String(term || "").trim().toLowerCase()).filter(Boolean);
    return s.inventory.items.find((item) => needles.some((needle) => itemText(item).includes(needle))) || null;
}

function skillLevel(s, name) {
    const needle = String(name || "").toLowerCase();
    const skill = [...(s.inventory?.skills || []), ...(s.character?.skills || [])].find((entry) => String(entry?.name || entry?.id || "").toLowerCase().includes(needle));
    return Number(skill?.level || skill?.rank || 0);
}

function permissionSatisfied(lock, s) {
    if (lock.requiredFaction) {
        const factions = [s.character?.faction, ...(s.character?.factions || []), ...(s.worldState?.factions || [])].flat().map((entry) => String(entry?.name || entry || "").toLowerCase());
        if (!factions.some((name) => name === lock.requiredFaction.toLowerCase())) return false;
    }
    if (lock.requiredReputation > 0 && Number(s.character?.reputation || s.worldState?.reputation || 0) < lock.requiredReputation) return false;
    if (lock.requiredQuest) {
        const quests = [...(s.quests?.completed || []), ...(s.worldState?.completedQuests || [])].map((entry) => String(entry?.id || entry?.name || entry).toLowerCase());
        if (!quests.includes(lock.requiredQuest.toLowerCase())) return false;
    }
    if (lock.owner) {
        const name = String(s.character?.name || "").toLowerCase();
        if (name !== lock.owner.toLowerCase() && !s.worldState.accessPermissions[lock.id]) return false;
    }
    return true;
}

export function inspectLock(lock) {
    if (lock.state === "unlocked") return lock.damage > 0 ? "It is open, though old damage remains visible." : "It is currently open.";
    if (lock.state === "disabled" || lock.type === "disabled") return "The access mechanism is temporarily offline.";
    const descriptions = {
        latch: "A simple latch holds it shut.", key: "A physical keyhole sits beneath the handle.", keycard: "A powered credential reader guards access.",
        combination: "A numbered mechanism waits for the correct sequence.", puzzle: "Interlocking pieces suggest a deliberate solution.",
        skill: "The mechanism demands practiced technique.", stat: "The barrier looks vulnerable to enough force.",
        reputation: "Access appears to depend on how this place regards you.", faction: "The insignia marks this as controlled access.",
        relationship: "This is private; permission from someone close to it may matter.", quest: "Something unfinished is keeping this route closed.",
        time: "The posted access window is currently closed.", owner: "The lock recognizes its owner or an authorized guest.",
        magical: "The seal responds with a faint arcane pulse.", electronic: "The keypad is powered and monitoring input.",
        jammed: "The mechanism is damaged and jammed in place.", barred: "The door is barred from the far side.",
    };
    const damage = lock.damage > 0 ? " It has already been forced once." : "";
    const tamper = lock.tampered ? " Signs of an earlier attempt remain." : "";
    return `${descriptions[lock.type] || "It is secured."}${damage}${tamper}`;
}

export function listAccessMethods(lock, s = getSettings()) {
    s = ensureState(s);
    if (lock.state === "unlocked") return lock.canRelock ? [{ id: "relock", label: "Relock", available: true, detail: "Secure it again." }] : [];
    const methods = [];
    const key = findItem(s, lock.validKeys.length ? lock.validKeys : ["keyring", `${lock.objectName} key`]);
    const card = findItem(s, lock.accessItems.length ? lock.accessItems : ["keycard", "access badge", "credential"]);
    const pick = findItem(s, ["lockpick", "mechanical_bypass"]);
    const hack = findItem(s, ["hacking device", "data spike", "cyberdeck", "electronic_bypass"]);
    const force = findItem(s, ["crowbar", "pry bar", "axe", "kinetic_crushing"]);
    const ability = findItem(s, lock.validAbilities);
    if (["key", "latch", "jammed"].includes(lock.type)) methods.push({ id: "key", label: "Use key", available: Boolean(key) || lock.type === "latch", tool: key, detail: key ? `Use ${key.name}.` : lock.type === "latch" ? "Release the latch." : "No matching key is available." });
    if (["keycard", "electronic"].includes(lock.type)) methods.push({ id: "credential", label: "Present access", available: Boolean(card), tool: card, detail: card ? `Present ${card.name}.` : "A compatible credential is needed." });
    if (["combination", "electronic"].includes(lock.type)) methods.push({ id: "code", label: "Enter code", available: true, detail: "Use the keypad without revealing the stored code." });
    if (["key", "latch", "combination", "jammed"].includes(lock.type)) methods.push({ id: "pick", label: "Pick mechanism", available: Boolean(pick) || skillLevel(s, "lockpick") > 0, tool: pick, detail: pick ? `Use ${pick.name}.` : "Requires lockpicks or lockpicking skill." });
    if (["electronic", "keycard", "disabled"].includes(lock.type)) methods.push({ id: "hack", label: "Hack access", available: Boolean(hack) || skillLevel(s, "hack") > 0, tool: hack, detail: hack ? `Use ${hack.name}.` : "Requires a hacking tool or skill." });
    if (["puzzle", "magical"].includes(lock.type)) methods.push({ id: "solve", label: lock.type === "magical" ? "Unweave seal" : "Solve mechanism", available: true, tool: ability, detail: ability ? `Channel ${ability.name}.` : "Study and repeat the mechanism's pattern." });
    if (!["magical", "disabled", "owner", "time"].includes(lock.type)) methods.push({ id: "force", label: "Force open", available: Boolean(force) || Number(s.character?.stats?.str || 0) >= 12, tool: force, detail: force ? `Use ${force.name}; this will make noise.` : "Requires strength or a prying tool." });
    if (["reputation", "faction", "relationship", "quest", "owner", "skill", "stat"].includes(lock.type) || lock.requiredFaction || lock.requiredQuest || lock.owner) methods.push({ id: "permission", label: "Check permission", available: permissionSatisfied(lock, s), detail: permissionSatisfied(lock, s) ? "Your current standing grants access." : "You do not currently have recognized permission." });
    if (lock.alternateEntrance) methods.push({ id: "alternate", label: "Use alternate route", available: Boolean(lock.alternateEntrance.discovered || s.worldState.accessPermissions[`${lock.id}:alternate`]), detail: "An alternate approach may bypass this lock." });
    return methods;
}

function persistLock(lock, object, patch = {}) {
    const s = ensureState();
    Object.assign(lock, patch, { updatedAt: Date.now() });
    s.worldState.accessLocks[lock.id] = {
        state: lock.state, attempts: lock.attempts, damage: lock.damage, tampered: lock.tampered,
        unlockedBy: lock.unlockedBy, updatedAt: lock.updatedAt,
    };
    s.worldState.objectStates[lock.objectId] = { ...(s.worldState.objectStates[lock.objectId] || {}), locked: lock.state !== "unlocked", lockState: lock.state, damage: lock.damage, updatedAt: Date.now() };
    if (object && typeof object === "object") object.locked = lock.state !== "unlocked";
    const placements = Array.isArray(s.roomEditor?.placements) ? s.roomEditor.placements : [];
    const placement = placements.find((entry) => String(entry?.id || entry?.name || "") === String(lock.objectId));
    if (placement) placement.locked = lock.state !== "unlocked";
    saveSettings();
    try { window.dispatchEvent(new CustomEvent("uie:access_changed", { detail: { lockId: lock.id, objectId: lock.objectId, state: lock.state } })); } catch (_) {}
}

function wearTool(tool, amount = 1) {
    if (!tool || typeof tool !== "object") return;
    const props = tool.tool_properties || tool.toolProperties || {};
    const current = Number(props.current_durability ?? tool.durability);
    if (Number.isFinite(current)) {
        const next = Math.max(0, current - amount);
        if (props.current_durability != null) props.current_durability = next;
        else tool.durability = next;
    } else if (Number.isFinite(Number(tool.charges))) tool.charges = Math.max(0, Number(tool.charges) - amount);
}

function noteFailure(lock, object, method, tool) {
    const s = ensureState();
    lock.attempts += 1;
    lock.tampered = lock.remembersAttempts || lock.tampered;
    if (method === "force" && lock.damagePersists) lock.damage += 1;
    if (lock.noticeTampering || method === "force") {
        s.worldState.suspicion = Math.min(100, Number(s.worldState.suspicion || 0) + (method === "force" ? 8 : 3));
        s.worldState.evidence.push({ id: `${lock.id}_${Date.now()}`, type: "tampering", objectId: lock.objectId, location: locationId(s), method, noticed: false, createdAt: Date.now() });
        s.worldState.evidence = s.worldState.evidence.slice(-100);
    }
    wearTool(tool, 1);
    persistLock(lock, object);
    notify("warning", method === "force" ? "The attempt failed loudly; damage and evidence remain." : "The attempt failed and signs of tampering remain.", lock.objectName);
}

function unlock(lock, object, method, tool, onUnlocked) {
    wearTool(tool, method === "key" || method === "credential" || method === "permission" ? 0 : 1);
    persistLock(lock, object, { state: "unlocked", unlockedBy: method });
    notify("success", `${lock.objectName} is now accessible.`, "Access granted");
    try { onUnlocked?.({ lock, method }); } catch (_) {}
    closeAccessPanel();
}

function ensureModal() {
    let modal = document.getElementById("uie-access-modal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "uie-access-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.style.cssText = "display:none;position:fixed;inset:0;z-index:2147483644;align-items:center;justify-content:center;background:rgba(2,6,23,.76);backdrop-filter:blur(10px);padding:14px;box-sizing:border-box";
    modal.innerHTML = `<section style="width:min(760px,96vw);max-height:88vh;overflow:auto;background:#0b1220;border:1px solid rgba(251,191,36,.35);border-radius:16px;color:#f8fafc;box-shadow:0 25px 90px #000"><header style="display:flex;gap:12px;align-items:center;padding:15px 17px;border-bottom:1px solid rgba(255,255,255,.1)"><div style="flex:1"><small id="uie-access-type" style="color:#fbbf24;text-transform:uppercase;letter-spacing:.12em"></small><h2 id="uie-access-title" style="margin:3px 0 0;font-size:20px"></h2></div><button id="uie-access-close" type="button" style="border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff;border-radius:9px;padding:9px 12px;cursor:pointer">Close</button></header><div id="uie-access-body" style="padding:17px"></div></section>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => { if (event.target === modal) closeAccessPanel(); });
    modal.querySelector("#uie-access-close")?.addEventListener("click", closeAccessPanel);
    return modal;
}

export function closeAccessPanel() {
    const modal = document.getElementById("uie-access-modal");
    if (modal) modal.style.display = "none";
}

export function openAccessPanel(object = {}, options = {}) {
    initMinigameBridge();
    const s = ensureState();
    const lock = normalizeLock(object, s);
    const modal = ensureModal();
    modal.querySelector("#uie-access-type").textContent = TYPE_LABELS[lock.type] || "Access control";
    modal.querySelector("#uie-access-title").textContent = lock.objectName;
    const body = modal.querySelector("#uie-access-body");
    const methods = listAccessMethods(lock, s);
    body.innerHTML = `
      <div style="padding:12px 14px;border:1px solid rgba(255,255,255,.1);border-radius:11px;background:rgba(255,255,255,.04);color:#cbd5e1">${esc(inspectLock(lock))}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;color:#94a3b8;font-size:12px"><span>Condition: ${esc(lock.state)}</span><span>·</span><span>Difficulty: ${lock.difficulty < 30 ? "modest" : lock.difficulty < 60 ? "challenging" : "severe"}</span>${lock.attempts ? `<span>·</span><span>Known attempts: ${lock.attempts}</span>` : ""}</div>
      <div id="uie-access-code" style="display:none;margin:13px 0;padding:12px;border:1px solid rgba(56,189,248,.25);border-radius:11px"><label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:7px">Access code</label><div style="display:flex;gap:8px"><input id="uie-access-code-input" type="password" inputmode="numeric" autocomplete="off" style="min-width:0;flex:1;background:#020617;border:1px solid #334155;color:#fff;border-radius:8px;padding:10px"><button id="uie-access-code-submit" type="button" style="border:1px solid #38bdf8;background:rgba(14,165,233,.18);color:#e0f2fe;border-radius:8px;padding:9px 14px">Submit</button></div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px">${methods.map((method) => `<button type="button" data-access-method="${esc(method.id)}" ${method.available ? "" : "disabled"} style="text-align:left;border:1px solid ${method.available ? "rgba(125,211,252,.32)" : "rgba(148,163,184,.16)"};background:${method.available ? "rgba(14,165,233,.1)" : "rgba(51,65,85,.12)"};color:${method.available ? "#f8fafc" : "#64748b"};border-radius:11px;padding:11px;cursor:${method.available ? "pointer" : "not-allowed"}"><strong style="display:block">${esc(method.label)}</strong><small>${esc(method.detail)}</small></button>`).join("") || `<p style="color:#94a3b8">No known access method is currently available.</p>`}</div>`;
    const methodById = new Map(methods.map((method) => [method.id, method]));
    const fail = (method) => { noteFailure(lock, object, method.id, method.tool); openAccessPanel(object, options); };
    body.querySelectorAll("[data-access-method]").forEach((button) => {
        button.addEventListener("click", () => {
            const method = methodById.get(button.dataset.accessMethod);
            if (!method?.available) return;
            if (["key", "credential", "permission", "alternate"].includes(method.id)) { unlock(lock, object, method.id, method.tool, options.onUnlocked); return; }
            if (method.id === "relock") { persistLock(lock, object, { state: "locked", unlockedBy: "" }); openAccessPanel(object, options); return; }
            if (method.id === "code") {
                const codeBox = body.querySelector("#uie-access-code");
                codeBox.style.display = "block";
                body.querySelector("#uie-access-code-input")?.focus();
                return;
            }
            closeAccessPanel();
            if (["hack", "solve"].includes(method.id)) {
                runSequenceChallenge({ id: `${lock.id}:${method.id}:${lock.attempts}`, title: method.id === "hack" ? "Electronic bypass" : "Pattern mechanism", difficulty: lock.difficulty, onSuccess: () => unlock(lock, object, method.id, method.tool, options.onUnlocked), onFailure: () => fail(method), onAbort: () => openAccessPanel(object, options) });
            } else {
                runTimingChallenge({ id: `${lock.id}:${method.id}:${lock.attempts}`, title: method.id === "force" ? "Force the barrier" : "Manipulate the lock", actionLabel: method.id === "force" ? "Heave" : "Set pin", difficulty: lock.difficulty, attempts: method.id === "force" ? 2 : 3, onSuccess: () => unlock(lock, object, method.id, method.tool, options.onUnlocked), onFailure: () => fail(method), onAbort: () => openAccessPanel(object, options) });
            }
        });
    });
    const submit = () => {
        const entered = String(body.querySelector("#uie-access-code-input")?.value || "").trim();
        const codeMethod = methodById.get("code");
        if (lock.code && entered === lock.code) unlock(lock, object, "code", null, options.onUnlocked);
        else fail(codeMethod || { id: "code", tool: null });
    };
    body.querySelector("#uie-access-code-submit")?.addEventListener("click", submit);
    body.querySelector("#uie-access-code-input")?.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
    modal.style.display = "flex";
    return true;
}

export function initAccessControl() {
    ensureState();
    ensureModal();
    initMinigameBridge();
    window.UIE_AccessControl = { open: openAccessPanel, close: closeAccessPanel, normalizeLock, inspectLock, listAccessMethods };
}

