import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";
import { addInventoryItemWithStack, normalizeInventoryStacksInPlace } from "./inventoryItems.js";
import { advanceWorldTimeMinutes } from "./timeProgress.js";
import { updateUiePrompt } from "./prompt_injection.js";
import { inferItemType } from "./slot_types_infer.js";
import { injectRpEvent } from "./features/rp_log.js";

const CONTAINERS = new Map();
const WORKSTATIONS = new Map();
let mounted = false;

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function keyText(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value && typeof value === "object" ? { ...value } : value; }
}

function locId(s) {
    return String(s?.worldState?.location || s?.realityEngine?.locationId || "default").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "default";
}

function ensureWorldState(s) {
    if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
    if (!s.worldState.stashes || typeof s.worldState.stashes !== "object") s.worldState.stashes = {};
    if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
    if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
}

function stashKey(object, s) {
    const rawId = String(object?.containerId || object?.id || object?.slotId || object?.name || "container");
    const id = rawId.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "container";
    return `${locId(s)}_${id}`;
}

function findItemIndex(list, name) {
    const n = keyText(name);
    return Array.isArray(list) ? list.findIndex((it) => keyText(it?.name) === n) : -1;
}

function takeQty(list, idx, qty = 1) {
    const it = list[idx];
    if (!it || typeof it !== "object") return null;
    const have = Math.max(1, Math.floor(Number(it.qty || 1)));
    const take = Math.min(have, Math.max(1, Math.floor(Number(qty || 1))));
    const piece = clone(it);
    piece.qty = take;
    if (take >= have) list.splice(idx, 1);
    else it.qty = have - take;
    return piece;
}

function hasItems(list, requirements = []) {
    return requirements.every((req) => {
        const name = String(req?.name || req?.item || "").trim();
        const qty = Math.max(1, Math.floor(Number(req?.qty || 1)));
        if (!name) return true;
        return list.reduce((sum, it) => keyText(it?.name) === keyText(name) ? sum + Math.max(1, Number(it.qty || 1)) : sum, 0) >= qty;
    });
}

function consumeItems(list, requirements = []) {
    for (const req of requirements) {
        let remaining = Math.max(1, Math.floor(Number(req?.qty || 1)));
        const name = String(req?.name || req?.item || "").trim();
        while (remaining > 0) {
            const idx = findItemIndex(list, name);
            if (idx < 0) return false;
            const cur = Math.max(1, Math.floor(Number(list[idx]?.qty || 1)));
            const take = Math.min(cur, remaining);
            takeQty(list, idx, take);
            remaining -= take;
        }
    }
    return true;
}

function ensureModal() {
    let modal = document.getElementById("uie-interactable-modal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "uie-interactable-modal";
    modal.style.cssText = "display:none;position:fixed;inset:0;z-index:2147483642;align-items:center;justify-content:center;background:rgba(2,6,23,0.68);backdrop-filter:blur(10px);padding:16px;box-sizing:border-box;";
    modal.innerHTML = `
        <div style="width:min(860px,96vw);max-height:90vh;overflow:auto;border:1px solid rgba(111,211,255,0.32);background:rgba(8,13,25,0.96);color:#f8fafc;border-radius:14px;box-shadow:0 28px 90px rgba(0,0,0,0.7);">
            <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.1);">
                <h3 id="uie-interactable-title" style="margin:0;flex:1;color:#7dd3fc;">Interactable</h3>
                <button type="button" id="uie-interactable-close" style="border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.06);color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;">Close</button>
            </div>
            <div id="uie-interactable-body" style="padding:16px;"></div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.style.display = "none";
    });
    modal.querySelector("#uie-interactable-close")?.addEventListener("click", () => {
        modal.style.display = "none";
    });
    return modal;
}

function renderCategorizedList(items, actionType, object) {
    const grouped = {};
    items.forEach((it, idx) => {
        const inf = inferItemType(it);
        const cat = String(inf?.category || "UNCATEGORIZED").toUpperCase();
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push({ item: it, originalIndex: idx });
    });
    
    if (items.length === 0) {
        return `<div style="opacity:.7;padding:12px;text-align:center;">Empty.</div>`;
    }
    
    return Object.keys(grouped).sort().map(cat => {
        const rows = grouped[cat].map(({ item, originalIndex }) => {
            const btnText = actionType === "take" ? "Take" : "Stow";
            const btnClass = actionType === "take" ? "take-btn" : "stow-btn";
            const btnStyle = actionType === "take" 
                ? "padding:5px 9px;border-radius:6px;border:1px solid rgba(125,211,252,.35);background:rgba(125,211,252,.12);color:#bae6fd;cursor:pointer;font-size:12px;"
                : "padding:5px 9px;border-radius:6px;border:1px solid rgba(250,204,21,.35);background:rgba(250,204,21,.12);color:#fde68a;cursor:pointer;font-size:12px;";
            return `
                <div style="display:flex;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                    <div style="flex:1;min-width:0;font-size:13px;">
                        <strong>${esc(item?.name || "Item")}</strong> 
                        <span style="opacity:.7;font-size:11px;">×${esc(item?.qty ?? 1)}</span>
                    </div>
                    <button type="button" class="${btnClass}" data-idx="${originalIndex}" style="${btnStyle}">${btnText}</button>
                </div>
            `;
        }).join("");
        
        return `
            <div style="margin-bottom:12px;">
                <div style="font-size:11px;font-weight:900;color:#cba35c;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:2px;margin-bottom:4px;">
                    ${esc(cat)}
                </div>
                ${rows}
            </div>
        `;
    }).join("");
}

function renderContainer(object = {}) {
    const s = getSettings();
    ensureWorldState(s);
    const key = stashKey(object, s);
    if (!Array.isArray(s.worldState.stashes[key])) s.worldState.stashes[key] = [];
    const stash = s.worldState.stashes[key];
    const inv = s.inventory.items;
    const name = String(object.name || object.label || "Container");
    const modal = ensureModal();
    modal.querySelector("#uie-interactable-title").textContent = name;
    const body = modal.querySelector("#uie-interactable-body");
    
    body.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-height:60vh;overflow-y:auto;">
            <section style="display:flex;flex-direction:column;min-height:0;">
                <h4 style="margin:0 0 8px;color:#facc15;font-weight:900;">${esc(name)} Stash</h4>
                <div id="uie-stash-list" style="flex:1;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px;background:rgba(0,0,0,.18);overflow-y:auto;min-height:220px;">
                    ${renderCategorizedList(stash, "take", object)}
                </div>
            </section>
            <section style="display:flex;flex-direction:column;min-height:0;">
                <h4 style="margin:0 0 8px;color:#7dd3fc;font-weight:900;">Your Inventory</h4>
                <div id="uie-inventory-list" style="flex:1;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px;background:rgba(0,0,0,.18);overflow-y:auto;min-height:220px;">
                    ${renderCategorizedList(inv, "stow", object)}
                </div>
            </section>
        </div>
    `;
    
    body.querySelectorAll(".take-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const idx = Number(btn.getAttribute("data-idx"));
            const piece = takeQty(stash, idx, 1);
            if (!piece) return;
            addInventoryItemWithStack(inv, piece, { source: "room_container" });
            normalizeInventoryStacksInPlace(inv, { source: "room_container" });
            saveSettings();
            notify("info", `Took 1x ${String(piece.name || "Item")}`, name);
            try { await updateUiePrompt(); } catch (_) {}
            renderContainer(object);
        });
    });
    
    body.querySelectorAll(".stow-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const idx = Number(btn.getAttribute("data-idx"));
            const piece = takeQty(inv, idx, 1);
            if (!piece) return;
            addInventoryItemWithStack(stash, piece, { source: "room_container" });
            normalizeInventoryStacksInPlace(stash, { source: "room_container" });
            saveSettings();
            notify("info", `Stowed 1x ${String(piece.name || "Item")}`, name);
            try { await updateUiePrompt(); } catch (_) {}
            renderContainer(object);
        });
    });
    
    modal.style.display = "flex";
}

function renderWorkstation(object = {}) {
    const s = getSettings();
    ensureWorldState(s);
    const name = String(object.name || object.label || "Workstation");
    const recipes = Array.isArray(object.recipes) && object.recipes.length ? object.recipes : [
        { name: "Simple Craft", inputs: [{ name: "Apple", qty: 1 }], output: { name: "Prepared Apple", type: "Food", qty: 1 }, minutes: 10 }
    ];
    const modal = ensureModal();
    modal.querySelector("#uie-interactable-title").textContent = name;
    const body = modal.querySelector("#uie-interactable-body");
    body.innerHTML = recipes.map((recipe, idx) => {
        const ok = hasItems(s.inventory.items, recipe.inputs || recipe.requires || []);
        const inputs = (recipe.inputs || recipe.requires || []).map((r) => `${esc(r.name || r.item)} ×${esc(r.qty || 1)}`).join(", ") || "None";
        const out = recipe.output || recipe.result || {};
        return `
            <div style="border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px;margin-bottom:10px;background:rgba(255,255,255,.04);">
                <div style="display:flex;gap:10px;align-items:center;">
                    <div style="flex:1;">
                        <strong style="color:#f8fafc;">${esc(recipe.name || `Recipe ${idx + 1}`)}</strong>
                        <div style="font-size:12px;opacity:.72;margin-top:4px;">Requires: ${inputs}</div>
                        <div style="font-size:12px;opacity:.72;">Makes: ${esc(out.name || "Output")} ×${esc(out.qty || 1)} · ${Math.max(0, Number(recipe.minutes || recipe.timeMinutes || 0))} min</div>
                    </div>
                    <button type="button" data-craft="${idx}" ${ok ? "" : "disabled"} style="padding:9px 12px;border-radius:8px;border:1px solid ${ok ? "rgba(34,197,94,.42)" : "rgba(148,163,184,.24)"};background:${ok ? "rgba(34,197,94,.14)" : "rgba(148,163,184,.08)"};color:${ok ? "#bbf7d0" : "#94a3b8"};cursor:${ok ? "pointer" : "not-allowed"};">Craft</button>
                </div>
            </div>
        `;
    }).join("");
    body.querySelectorAll("[data-craft]").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const recipe = recipes[Number(btn.getAttribute("data-craft"))];
            if (!recipe || !hasItems(s.inventory.items, recipe.inputs || recipe.requires || [])) {
                notify("error", "Missing recipe requirements.", name);
                return;
            }
            if (!consumeItems(s.inventory.items, recipe.inputs || recipe.requires || [])) return;
            addInventoryItemWithStack(s.inventory.items, recipe.output || recipe.result || { name: "Crafted Item", type: "Item", qty: 1 }, { source: "workstation" });
            advanceWorldTimeMinutes(s, Number(recipe.minutes || recipe.timeMinutes || 0), { reason: name });
            saveSettings();
            notify("success", `Crafted ${String((recipe.output || recipe.result || {}).name || "item")}`, name);
            try { await updateUiePrompt(); } catch (_) {}
            renderWorkstation(object);
        });
    });
    modal.style.display = "flex";
}

export async function resolveObstacle(object = {}, obstacle = null) {
    const s = getSettings();
    ensureWorldState(s);
    const name = String(object.name || object.label || "Obstacle");
    const obs = obstacle || object.obstacle || (object.locked ? {
        required_capability: ["mechanical_bypass"],
        difficulty_rating: 15,
        tool_damage_factor: 1,
        action_name: "Bypass"
    } : null);
    
    if (!obs) {
        renderContainer(object);
        return;
    }
    
    const requiredCaps = obs.required_capability || [];
    const inventory = s.inventory.items;
    
    const matchingTools = inventory.map((it, idx) => ({ item: it, originalIndex: idx }))
        .filter(({ item }) => {
            const tp = item.tool_properties;
            return tp && Array.isArray(tp.provided_capabilities) && requiredCaps.some(rc => tp.provided_capabilities.includes(rc));
        });
        
    if (matchingTools.length === 0) {
        notify("error", `Requires a tool with capability: ${requiredCaps.join(", ")}.`, name);
        return;
    }
    
    if (matchingTools.length === 1) {
        await executeObstacleAttempt(object, obs, matchingTools[0].item, matchingTools[0].originalIndex);
    } else {
        const modal = ensureModal();
        modal.querySelector("#uie-interactable-title").textContent = `Select Tool for ${name}`;
        const body = modal.querySelector("#uie-interactable-body");
        
        const optionsHtml = matchingTools.map(({ item, originalIndex }) => {
            const tp = item.tool_properties;
            const durText = tp.durability_type === "infinite" ? "Infinite" : `${tp.current_durability}/${tp.max_durability}`;
            return `
                <option value="${originalIndex}">
                    ${esc(item.name)} (Durability: ${durText}, Mod: +${tp.action_modifier})
                </option>
            `;
        }).join("");
        
        body.innerHTML = `
            <div style="padding: 8px;">
                <p style="margin-top:0;opacity:0.9;">Multiple valid tools detected. Choose which one to risk:</p>
                <div class="uie-kfield" style="margin-bottom: 16px;">
                    <label>Select Tool</label>
                    <select id="uie-obstacle-tool-select">
                        ${optionsHtml}
                    </select>
                </div>
                <button type="button" id="uie-obstacle-submit" class="uie-kbtn primary" style="width:100%;">Attempt ${obs.action_name || "Bypass"}</button>
            </div>
        `;
        
        body.querySelector("#uie-obstacle-submit").addEventListener("click", async () => {
            const selectedIdx = Number(body.querySelector("#uie-obstacle-tool-select").value);
            modal.style.display = "none";
            const tool = inventory[selectedIdx];
            await executeObstacleAttempt(object, obs, tool, selectedIdx);
        });
        
        modal.style.display = "flex";
    }
}

async function executeObstacleAttempt(object, obs, tool, toolIndex) {
    const s = getSettings();
    ensureWorldState(s);
    const name = String(object.name || object.label || "Obstacle");
    const tp = tool.tool_properties;
    
    let stat = 10;
    const charStats = s.character?.stats || {};
    const primaryCap = obs.required_capability?.[0] || "";
    if (primaryCap === "mechanical_bypass" || primaryCap === "precision_forgery") {
        stat = charStats.dex !== undefined ? Number(charStats.dex) : 10;
    } else if (primaryCap === "arcane_etching" || primaryCap === "arcane_infusion") {
        stat = charStats.int !== undefined ? Number(charStats.int) : 10;
    } else if (primaryCap === "kinetic_crushing") {
        stat = charStats.str !== undefined ? Number(charStats.str) : 10;
    } else {
        stat = charStats.dex !== undefined ? Number(charStats.dex) : 10;
    }
    
    const modVal = tp.action_modifier || 1.0;
    const checkValue = modVal > 5 ? (stat + modVal) : (stat * modVal);
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = checkValue + roll;
    const diff = obs.difficulty_rating || 15;
    const success = total >= diff;
    
    const damage = obs.tool_damage_factor || 1;
    let toolBroke = false;
    
    if (tp.durability_type === "degrades_on_use" || (tp.durability_type === "degrades_on_fail" && !success)) {
        tp.current_durability = Math.max(0, tp.current_durability - damage);
        if (tp.current_durability <= 0) {
            toolBroke = true;
        }
    } else if (tp.durability_type === "consumable") {
        toolBroke = true;
    }
    
    if (toolBroke) {
        const curQty = Number(tool.qty || 1);
        if (curQty > 1) {
            tool.qty = curQty - 1;
            if (tp.durability_type !== "consumable") {
                tp.current_durability = tp.max_durability || 10;
            }
        } else {
            s.inventory.items.splice(toolIndex, 1);
        }
        notify("warning", `${tool.name} broke or was consumed.`, name);
    } else {
        saveSettings();
    }
    
    if (success) {
        notify("success", `Success! Obstacle bypassed.`, name);
        await injectRpEvent(`Successfully bypassed the ${name} obstacle using ${tool.name} (Roll: ${total} vs ${diff}).`, { uie: { type: "obstacle_success" } });
        
        const placements = s.roomEditor?.placements || [];
        const found = placements.find(p => p && String(p.id || p.name) === String(object.id || object.name));
        if (found) {
            found.locked = false;
            found.obstacle = null;
        }
        object.locked = false;
        object.obstacle = null;
        saveSettings();
        try { await updateUiePrompt(); } catch (_) {}
        
        renderContainer(object);
    } else {
        notify("error", `Failed to bypass obstacle.`, name);
        await injectRpEvent(`Failed to bypass the ${name} obstacle using ${tool.name} (Roll: ${total} vs ${diff}).`, { uie: { type: "obstacle_failure" } });
        saveSettings();
        try { await updateUiePrompt(); } catch (_) {}
    }
}

export function registerContainer(def = {}) {
    const id = String(def.id || def.containerId || def.name || "").trim();
    if (id) CONTAINERS.set(id, def);
}

export function registerWorkstation(def = {}) {
    const id = String(def.id || def.workstationId || def.name || "").trim();
    if (id) WORKSTATIONS.set(id, def);
}

export function openContainer(object = {}) {
    const s = getSettings();
    ensureWorldState(s);
    const merged = { ...(CONTAINERS.get(String(object.id || object.containerId || "")) || {}), ...object };
    
    if (merged.locked || merged.obstacle) {
        resolveObstacle(merged);
        return true;
    }
    renderContainer(merged);
    return true;
}

export function openWorkstation(object = {}) {
    const merged = { ...(WORKSTATIONS.get(String(object.id || object.workstationId || "")) || {}), ...object };
    if (Array.isArray(merged.capabilities) && merged.capabilities.length > 0) {
        import("./features/kitchen.js").then((mod) => {
            mod.init();
            mod.open({ mode: "body", object: merged });
        }).catch(err => {
            notify("error", `Failed to open workstation: ${err.message}`, "Workstation");
        });
        return true;
    }
    renderWorkstation(merged);
    return true;
}

export function initInteractables() {
    if (mounted) return;
    mounted = true;
    ensureModal();
    window.UIE_openContainer = openContainer;
    window.UIE_openWorkstation = openWorkstation;
    window.UIE_registerContainer = registerContainer;
    window.UIE_registerWorkstation = registerWorkstation;
}
