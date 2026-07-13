import { getSettings, saveSettings } from "../core.js";
import { notify } from "../notifications.js";
import { injectRpEvent } from "./rp_log.js";

let isInitialized = false;
let activeQbTab = "all";

// Personalities mapping for Helper Pet dialogue inside the QuickBag
const PET_QUICK_BAG_LINES = {
    neutral: "I am ready, Master. Select equipped gear to un-equip, or use starred items & skills.",
    sarcastic: "Oh, look, a bag. Truly a marvel of storage technology. Try not to drop it.",
    clinical: "Analysis: QuickBag fully loaded. Recommend optimal usage of active equipment slots.",
    whimsical: "Tadaa! Here are your shiny treasures and magical powers! Let's choose a fun one!",
    ominous: "Draw your weapons, consume your elixirs... the shadows are closing in...",
    loyal: "Your loyal assistant is at your service, Master. I will maintain compliance at all costs."
};

const PET_TYPES_ICONS = {
    floating_book: "📖",
    cat_girl: "🐱",
    droid: "🤖",
    spirit: "👻",
    owl: "🦉"
};

const PET_TYPES_NAMES = {
    floating_book: "Field Guide",
    cat_girl: "Familiar",
    droid: "A.I.D.",
    spirit: "Spirit",
    owl: "Mentor"
};

export function initQuickBag() {
    if (isInitialized) return;
    isInitialized = true;

    ensureQuickBagLauncher();

    const doc = $(document);

    // Bind Close Button
    doc.off("click.uieQbClose", "#uie-quick-bag-close")
       .on("click.uieQbClose", "#uie-quick-bag-close", function(e) {
           e.preventDefault();
           e.stopPropagation();
           hideQuickBag();
       });

    // Bind Open Full Inventory Button
    doc.off("click.uieQbFullInv", "#uie-quick-bag-full-inv")
       .on("click.uieQbFullInv", "#uie-quick-bag-full-inv", function(e) {
           e.preventDefault();
           e.stopPropagation();
           hideQuickBag();
           
           try {
               if (typeof window.openInventoryWindow === "function") {
                   window.openInventoryWindow("items");
               } else {
                   const $btn = $("#btn-inv");
                   if ($btn.length) {
                       $btn.trigger("click");
                   } else if (typeof window.openWindow === "function") {
                       window.openWindow("#uie-inventory-window", "inventory.js", "", "initInventory");
                   }
               }
           } catch (err) {
               console.error("[QuickBag] Failed to open full inventory:", err);
           }
       });

    // Bind Open Map Button
    doc.off("click.uieQbMap", "#uie-quick-bag-open-map")
       .on("click.uieQbMap", "#uie-quick-bag-open-map", async function(e) {
           e.preventDefault();
           e.stopPropagation();
           hideQuickBag();
           try {
               const m = await (window.importUieModule ? window.importUieModule("map.js") : import("../map.js"));
               await m.openMap?.();
           } catch (err) {
               console.error("[QuickBag] Failed to open map:", err);
           }
       });

    // Bind Battle target picker. This is the direct "fight anyone in scene" entry point.
    doc.off("click.uieQbBattle", "#uie-quick-bag-open-battle")
       .on("click.uieQbBattle", "#uie-quick-bag-open-battle", async function(e) {
           e.preventDefault();
           e.stopPropagation();
           hideQuickBag();
           try {
               const mod = await (window.importUieModule ? window.importUieModule("battle.js") : import("../battle.js"));
               mod.initBattle?.();
               await mod.openBattleTargetPicker?.();
           } catch (err) {
               console.error("[QuickBag] Failed to open battle target picker:", err);
               notify("error", "Battle target picker could not be opened.", "Battle");
           }
       });

    // Bind Helper Pet settings.
    doc.off("click.uieQbHelperPet", "#uie-quick-bag-open-helper-pet")
       .on("click.uieQbHelperPet", "#uie-quick-bag-open-helper-pet", async function(e) {
           e.preventDefault();
           e.stopPropagation();
           hideQuickBag();
           try {
               const mod = await (window.importUieModule ? window.importUieModule("helperPet.js") : import("../helperPet.js"));
               mod.initHelperPet?.();
               mod.openHelperPetSettings?.();
           } catch (err) {
               console.error("[QuickBag] Failed to open helper pet settings:", err);
               notify("error", "Helper Pet settings could not be opened.", "Helper Pet");
           }
       });

    // Bind click handlers for Equipment Slots
    doc.off("click.uieQbEquip", ".quick-bag-equip-slot")
       .on("click.uieQbEquip", ".quick-bag-equip-slot", function(e) {
           e.preventDefault();
           e.stopPropagation();
           const slotId = $(this).attr("data-slot");
           if ($(this).hasClass("equipped")) {
               unequipSlot(slotId);
           } else {
                notify("info", `Equip items of type ${slotId} from the full Inventory screen.`, "QuickBag");
           }
       });

    // Bind click handlers for usable grid cells (Starred items / Skills / Gear)
    doc.off("click.uieQbCell", ".quick-bag-cell")
       .on("click.uieQbCell", ".quick-bag-cell", function(e) {
           e.preventDefault();
           e.stopPropagation();
           const type = $(this).attr("data-type");
           const idx = Number($(this).attr("data-idx"));

           if (type === "item" || type === "gear_unequipped" || type === "gear_equipped") {
               showQuickBagOptions(type, idx, e.clientX, e.clientY);
           } else if (type === "skill") {
               const skillName = $(this).attr("data-name");
               useQuickSkill(skillName);
           }
       });

    doc.off("click.uieQbOpt", ".quick-bag-option")
       .on("click.uieQbOpt", ".quick-bag-option", async function(e) {
           e.preventDefault();
           e.stopPropagation();
           const action = String($(this).data("action") || "");
           const type = String($(this).data("type") || "");
           const idx = Number($(this).data("idx"));
           $("#uie-quick-bag-options").remove();
           if (action === "use") await useStarredItem(idx);
           else if (action === "equip") equipGear(idx);
           else if (action === "unequip") unequipSlotByItemIndex(idx);
           else if (action === "send") sendQuickBagEntry(type, idx);
           else if (action === "inspect") inspectQuickBagEntry(type, idx);
           else if (action === "drop") dropQuickBagItem(type, idx);
       });

    // Hide quick bag when clicking outside the panel
    $(document).off("click.uieQbOutside").on("click.uieQbOutside", function(e) {
        const overlay = document.getElementById("uie-quick-bag-overlay");
        if (!overlay || !overlay.classList.contains("active")) return;
        if ($(e.target).closest("#uie-quick-bag-options").length) return;
        if ($(e.target).closest("#uie-quick-bag-overlay, #uie-launcher").length === 0) {
            hideQuickBag();
        }
    });

    // Bind Tab Switching Buttons
    doc.off("click.uieQbTab", ".quick-bag-tab-btn")
       .on("click.uieQbTab", ".quick-bag-tab-btn", function(e) {
           e.preventDefault();
           e.stopPropagation();
           activeQbTab = $(this).attr("data-qb-tab");
           $(".quick-bag-tab-btn").removeClass("active").css("color", "#94a3b8");
           $(this).addClass("active").css("color", "#cba35c");
           renderQuickBag();
       });

    doc.off("pointerenter.uieQbDragMark mouseenter.uieQbDragMark", "#uie-items-grid-inner .uie-item, #uie-view-items .uie-item, .uie-skill-card")
       .on("pointerenter.uieQbDragMark mouseenter.uieQbDragMark", "#uie-items-grid-inner .uie-item, #uie-view-items .uie-item, .uie-skill-card", function() {
           $(this).attr("draggable", "true");
       });

    doc.off("dragstart.uieQbSource", "#uie-items-grid-inner .uie-item, #uie-view-items .uie-item, .uie-skill-card")
       .on("dragstart.uieQbSource", "#uie-items-grid-inner .uie-item, #uie-view-items .uie-item, .uie-skill-card", function(e) {
           const isSkill = $(this).hasClass("uie-skill-card");
           const idx = Number($(this).attr(isSkill ? "data-index" : "data-idx"));
           if (!Number.isFinite(idx)) return;
           const payload = JSON.stringify({ type: isSkill ? "skill" : "item", idx });
           try {
               e.originalEvent.dataTransfer.setData("application/x-uie-quickbag", payload);
               e.originalEvent.dataTransfer.setData("text/plain", payload);
               e.originalEvent.dataTransfer.effectAllowed = "copy";
           } catch (_) {}
       });

    doc.off("dragover.uieQbDrop", "#uie-quick-bag-overlay, #uie-quick-bag-grid")
       .on("dragover.uieQbDrop", "#uie-quick-bag-overlay, #uie-quick-bag-grid", function(e) {
           e.preventDefault();
           try { e.originalEvent.dataTransfer.dropEffect = "copy"; } catch (_) {}
           $("#uie-quick-bag-overlay").addClass("drag-over");
       });

    doc.off("dragleave.uieQbDrop", "#uie-quick-bag-overlay")
       .on("dragleave.uieQbDrop", "#uie-quick-bag-overlay", function() {
           $("#uie-quick-bag-overlay").removeClass("drag-over");
       });

    doc.off("drop.uieQbDrop", "#uie-quick-bag-overlay, #uie-quick-bag-grid")
       .on("drop.uieQbDrop", "#uie-quick-bag-overlay, #uie-quick-bag-grid", function(e) {
           e.preventDefault();
           $("#uie-quick-bag-overlay").removeClass("drag-over");
           let raw = "";
           try {
               raw = e.originalEvent.dataTransfer.getData("application/x-uie-quickbag") || e.originalEvent.dataTransfer.getData("text/plain");
           } catch (_) {}
           if (!raw) return;
           try {
               const payload = JSON.parse(raw);
               pinQuickBagEntry(payload.type, Number(payload.idx));
           } catch (err) {
               console.warn("[QuickBag] Drop payload ignored:", err);
           }
       });

    console.log("[QuickBag] Initialized floating quickbag");
}

function ensureQuickBagLauncher() {
    let launcher = document.getElementById("uie-launcher");
    if (!launcher) {
        launcher = document.createElement("button");
        launcher.id = "uie-launcher";
        launcher.type = "button";
        launcher.title = "Open QuickBag";
        launcher.setAttribute("aria-label", "Open QuickBag");
        launcher.innerHTML = '<i class="fa-solid fa-bag-shopping" aria-hidden="true"></i>';
        document.body.appendChild(launcher);
    }
    launcher.style.display = getSettings()?.ui?.quickBagHidden === true ? "none" : "grid";
    $(launcher).off("click.uieQbLauncher").on("click.uieQbLauncher", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleQuickBag();
    });
}

export function toggleQuickBagVisibility() {
    initQuickBag();
    const s = getSettings();
    s.ui = s.ui || {};
    s.ui.quickBagHidden = s.ui.quickBagHidden !== true;
    saveSettings();
    const launcher = document.getElementById("uie-launcher");
    if (launcher) launcher.style.display = s.ui.quickBagHidden ? "none" : "grid";
    if (s.ui.quickBagHidden) hideQuickBag();
    return !s.ui.quickBagHidden;
}

export function toggleQuickBag() {
    initQuickBag();
    const overlay = document.getElementById("uie-quick-bag-overlay");
    if (!overlay) return;

    if (overlay.classList.contains("active")) {
        hideQuickBag();
    } else {
        showQuickBag();
    }
}

export function showQuickBag() {
    const overlay = document.getElementById("uie-quick-bag-overlay");
    if (!overlay) return;
    if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
    overlay.style.position = "fixed";
    overlay.style.zIndex = "2147483650";

    // Render fresh grid contents
    renderQuickBag();

    const visualViewport = window.visualViewport;
    const viewportWidth = visualViewport?.width || window.innerWidth;
    const viewportHeight = visualViewport?.height || window.innerHeight;
    const landscape = viewportWidth > viewportHeight;
    if (landscape) {
        // Root landscape layout owns this panel's region. Do not anchor it to
        // the bottom launcher or calculate from stale innerWidth dimensions.
        overlay.style.left = "var(--ui-left-safe)";
        overlay.style.top = "var(--ui-top-safe)";
        overlay.style.right = "auto";
        overlay.style.bottom = "auto";
        overlay.style.width = "clamp(330px, 35vw, 500px)";
        overlay.style.maxHeight = "calc(100% - var(--ui-top-safe) - var(--desktop-nav-reserved-height) - var(--ui-bottom-gap))";
        overlay.style.pointerEvents = "auto";
        overlay.classList.add("active");
        return;
    }

    if (window.matchMedia?.("(max-width: 640px)")?.matches || window.innerWidth <= 640) {
        overlay.style.left = "10px";
        overlay.style.right = "10px";
        overlay.style.top = "auto";
        overlay.style.bottom = "calc(10px + env(safe-area-inset-bottom))";
        overlay.style.width = "auto";
        overlay.style.maxHeight = "min(70dvh, 480px)";
        overlay.style.pointerEvents = "auto";
        overlay.classList.add("active");
        return;
    }

    overlay.style.right = "";
    overlay.style.bottom = "";
    overlay.style.width = "";
    overlay.style.maxHeight = "";

    // Position overlay elegantly near the launcher button
    const launcher = document.getElementById("uie-launcher");
    const isLauncherVisible = launcher && launcher.style.display !== "none" && $(launcher).is(":visible");
    if (isLauncherVisible) {
        const lRect = launcher.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const panelH = Math.min(overlay.offsetHeight || 380, Math.max(280, vh - 20));
        
        let left = lRect.left - 10;
        let top = lRect.top - panelH - 10;

        if (left < 10) left = 10;
        if (left + 300 > vw) left = vw - 310;
        
        if (top < 10) {
            top = lRect.bottom + 10;
        }
        if (top + panelH > vh - 10) {
            top = Math.max(10, vh - panelH - 10);
        }

        overlay.style.left = `${left}px`;
        overlay.style.top = `${top}px`;
    } else {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        overlay.style.left = `${Math.max(10, (vw - 300) / 2)}px`;
        overlay.style.top = `${Math.max(10, (vh - 380) / 2)}px`;
    }

    overlay.classList.add("active");
}

export function hideQuickBag() {
    const overlay = document.getElementById("uie-quick-bag-overlay");
    if (overlay) {
        overlay.classList.remove("active");
    }
    $("#uie-quick-bag-options").remove();
}

function ensureQuickBagPins(s) {
    if (!s.inventory) s.inventory = {};
    if (!Array.isArray(s.inventory.quickBagPins)) s.inventory.quickBagPins = [];
    return s.inventory.quickBagPins;
}

function quickBagPinKey(type, idx) {
    return `${String(type || "")}:${Number(idx)}`;
}

export function addQuickBagEntry(type, idx) {
    pinQuickBagEntry(type, Number(idx));
}

function pinQuickBagEntry(type, idx) {
    if (!Number.isFinite(idx)) return;
    const normalized = String(type || "").toLowerCase() === "skill" ? "skill" : "item";
    const s = getSettings();
    const source = normalized === "skill" ? s.inventory?.skills : s.inventory?.items;
    const entry = Array.isArray(source) ? source[idx] : null;
    if (!entry) return;
    const pins = ensureQuickBagPins(s);
    const key = quickBagPinKey(normalized, idx);
    const existing = pins.findIndex((p) => quickBagPinKey(p.type, p.idx) === key);
    if (existing >= 0) pins.splice(existing, 1);
    pins.unshift({ type: normalized, idx, name: String(entry.name || entry.label || "Shortcut"), t: Date.now() });
    s.inventory.quickBagPins = pins.slice(0, 24);
    saveSettings();
    notify("success", `Added ${entry.name || entry.label || "shortcut"} to QuickBag.`, "QuickBag");
    activeQbTab = normalized === "skill" ? "skills" : "all";
    renderQuickBag();
}

function showQuickBagOptions(type, idx, x, y) {
    const s = getSettings();
    const source = type === "gear_equipped" ? s.inventory?.equipped : s.inventory?.items;
    const entry = Array.isArray(source) ? source[idx] : null;
    if (!entry) return;

    $("#uie-quick-bag-options").remove();
    const name = esc(entry.name || "Entry");
    const actions = [];
    if (type === "item") {
        if (isItemUsable(entry)) actions.push(["use", "Use", "fa-hand-sparkles"]);
        actions.push(["send", "Send to Chat", "fa-comment-dots"], ["inspect", "Inspect", "fa-circle-info"], ["drop", "Drop", "fa-trash"]);
    } else if (type === "gear_unequipped") {
        actions.push(["equip", "Equip", "fa-shield-halved"], ["send", "Send to Chat", "fa-comment-dots"], ["inspect", "Inspect", "fa-circle-info"], ["drop", "Drop", "fa-trash"]);
    } else if (type === "gear_equipped") {
        actions.push(["unequip", "Unequip", "fa-box-open"], ["send", "Send to Chat", "fa-comment-dots"], ["inspect", "Inspect", "fa-circle-info"]);
    }

    const menu = $(`
        <div id="uie-quick-bag-options" style="position:fixed; z-index:10650; min-width:180px; background:rgba(12,16,24,0.96); border:1px solid rgba(255,255,255,0.18); border-radius:10px; box-shadow:0 16px 36px rgba(0,0,0,0.45); padding:8px; color:#fff;">
            <div style="font-size:12px; font-weight:900; color:#ffd166; padding:6px 8px 8px; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:6px;">${name}</div>
            ${actions.map(([action, label, icon]) => `<button type="button" class="quick-bag-option" data-action="${action}" data-type="${type}" data-idx="${idx}" style="width:100%; display:flex; align-items:center; gap:8px; padding:8px; border:0; border-radius:7px; background:transparent; color:#e5e7eb; cursor:pointer; text-align:left;"><i class="fa-solid ${icon}" style="width:14px;color:#93c5fd;"></i>${label}</button>`).join("")}
        </div>
    `);
    $("body").append(menu);
    const w = menu.outerWidth() || 180;
    const h = menu.outerHeight() || 160;
    menu.css({
        left: `${Math.max(8, Math.min(window.innerWidth - w - 8, x || 24))}px`,
        top: `${Math.max(8, Math.min(window.innerHeight - h - 8, y || 24))}px`
    });
}

function sendQuickBagEntry(type, idx) {
    const s = getSettings();
    const source = type === "gear_equipped" ? s.inventory?.equipped : s.inventory?.items;
    const entry = Array.isArray(source) ? source[idx] : null;
    if (!entry) return;
    const name = String(entry.name || "item").trim();
    const detail = String(entry.description || entry.desc || entry.effect || "").trim();
    $("#user-input").val(`I use ${name}.${detail ? ` ${detail}` : ""}`);
    $("#send-btn").trigger("click");
    notify("info", `Sent ${name} from QuickBag.`, "QuickBag");
}

function inspectQuickBagEntry(type, idx) {
    const s = getSettings();
    const source = type === "gear_equipped" ? s.inventory?.equipped : s.inventory?.items;
    const entry = Array.isArray(source) ? source[idx] : null;
    if (!entry) return;
    const details = String(entry.description || entry.desc || entry.effect || entry.type || "No details recorded.").trim();
    notify("info", `${entry.name || "Entry"}: ${details.slice(0, 220)}`, "QuickBag");
}

function dropQuickBagItem(type, idx) {
    if (type === "gear_equipped") return;
    const s = getSettings();
    if (!Array.isArray(s.inventory?.items) || !s.inventory.items[idx]) return;
    const removed = s.inventory.items.splice(idx, 1)[0];
    saveSettings();
    notify("info", `Dropped ${removed?.name || "item"}.`, "QuickBag");
    try {
        window.dispatchEvent(new CustomEvent("uie:state_updated"));
    } catch (_) {}
    renderQuickBag();
}

export function renderQuickBag() {
    const s = getSettings();
    
    // 1. Populate Equipped strip
    const equipped = s.inventory?.equipped || [];
    const slots = {
        Head: { icon: "👑", el: "#qb-slot-head" },
        Chest: { icon: "👕", el: "#qb-slot-chest" },
        Feet: { icon: "🥾", el: "#qb-slot-feet" },
        "Main Hand": { icon: "🗡️", el: "#qb-slot-hand" },
        Accessory: { icon: "💍", el: "#qb-slot-accessory" }
    };

    Object.entries(slots).forEach(([slotId, info]) => {
        const item = equipped.find(e => String(e.slotId || "").toLowerCase() === slotId.toLowerCase());
        const $el = $(info.el);
        if (item) {
            $el.addClass("equipped")
               .html(item.img ? `<img src="${item.img}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">` : info.icon)
               .attr("title", `Equipped: ${item.name} (Click to unequip)`);
        } else {
            $el.removeClass("equipped")
               .html(info.icon)
               .attr("title", `${slotId} slot: empty`);
        }
    });

    // Synchronize tab highlights
    $(".quick-bag-tab-btn").removeClass("active").css("color", "#94a3b8");
    $(`.quick-bag-tab-btn[data-qb-tab="${activeQbTab}"]`).addClass("active").css("color", "#e0f2fe");

    // 2. Fetch inventory items and skills dynamically
    const items = s.inventory?.items || [];
    const skills = s.inventory?.skills || [];
    const pins = ensureQuickBagPins(s);

    const gridEl = $("#uie-quick-bag-grid");
    gridEl.empty();

    const cellsCount = 8;
    const combinedData = [];

    // Helper to determine if an item is a piece of gear
    const isGear = (it) => {
        if (!it) return false;
        const cat = String(it.slotCategory || it.slotId || "").toLowerCase();
        const type = String(it.type || "").toLowerCase();
        return cat.includes("head") || cat.includes("chest") || cat.includes("feet") || 
               cat.includes("hand") || cat.includes("weapon") || cat.includes("armor") || 
               cat.includes("accessory") || type.includes("weapon") || type.includes("armor") || 
               type.includes("shield") || type.includes("gear") || !!it.slotId;
    };

    if (activeQbTab === "all" || activeQbTab === "items") {
        // Filter out gear for items list
        items.forEach((it) => {
            if (!isGear(it)) {
                combinedData.push({
                    type: "item",
                    name: it.name || "Item",
                    icon: it.img || "📦",
                    originalIdx: items.indexOf(it),
                    badge: "ITM",
                    itemData: it
                });
            }
        });
    }

    if (activeQbTab === "all" || activeQbTab === "gear") {
        // Unequipped gear in items list
        items.forEach((it) => {
            if (isGear(it)) {
                combinedData.push({
                    type: "gear_unequipped",
                    name: it.name || "Gear",
                    icon: it.img || "🛡️",
                    originalIdx: items.indexOf(it),
                    badge: "GER",
                    itemData: it
                });
            }
        });
        // Equipped gear
        equipped.forEach((it, idx) => {
            combinedData.push({
                type: "gear_equipped",
                name: it.name || "Equipped Gear",
                icon: it.img || "👑",
                originalIdx: idx,
                badge: "EQP",
                itemData: it
            });
        });
    }

    if (activeQbTab === "all" || activeQbTab === "skills") {
        skills.forEach((sk, idx) => {
            combinedData.push({
                type: "skill",
                name: sk.name || sk.label || `Skill ${idx + 1}`,
                icon: sk.img || sk.icon || "⚡",
                originalIdx: idx,
                badge: "SKL",
                skillData: sk
            });
        });
    }

    if (pins.length) {
        const rank = new Map(pins.map((p, i) => [quickBagPinKey(p.type, p.idx), i]));
        combinedData.sort((a, b) => {
            const at = a.type === "skill" ? "skill" : "item";
            const bt = b.type === "skill" ? "skill" : "item";
            const av = rank.has(quickBagPinKey(at, a.originalIdx)) ? rank.get(quickBagPinKey(at, a.originalIdx)) : 9999;
            const bv = rank.has(quickBagPinKey(bt, b.originalIdx)) ? rank.get(quickBagPinKey(bt, b.originalIdx)) : 9999;
            return av - bv;
        });
    }

    // Render cells (scrolling enabled via grid, render at least 12 slots)
    const totalToRender = Math.max(cellsCount, combinedData.length);
    for (let i = 0; i < totalToRender; i++) {
        const data = combinedData[i];
        if (data) {
            const label = esc(data.name);
            const isSkill = data.type === "skill";
            const isEquipped = data.type === "gear_equipped";
            const isUnequipped = data.type === "gear_unequipped";
            
            let badgeClass = "badge-item";
            if (isSkill) badgeClass = "badge-skill";
            else if (isEquipped) badgeClass = "badge-equipped";
            else if (isUnequipped) badgeClass = "badge-gear";

            let cellClass = "item-starred";
            if (isSkill) cellClass = "skill-cell";
            else if (isEquipped) cellClass = "gear-equipped-cell";
            else if (isUnequipped) cellClass = "gear-unequipped-cell";
            
            const cellHtml = `
                <div class="quick-bag-cell ${cellClass}" 
                     draggable="true"
                     data-type="${data.type}" 
                     data-idx="${data.originalIdx ?? ''}" 
                     data-name="${esc(data.name)}"
                     title="${label} (${data.type.replace('_', ' ').toUpperCase()})">
                    <div style="font-size:18px; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));">
                        ${(typeof data.icon === "string" && (data.icon.startsWith("http") || data.icon.startsWith("data:"))) ? `<img src="${data.icon}" style="width:28px;height:28px;object-fit:cover;border-radius:4px;">` : (data.icon || "")}
                    </div>
                    <span class="quick-bag-cell-badge ${badgeClass}">${data.badge}</span>
                    <span class="quick-bag-cell-label">${label}</span>
                </div>
            `;
            gridEl.append(cellHtml);
        } else {
            // Empty slot
            gridEl.append('<div class="quick-bag-cell empty"></div>');
        }
    }

    // 3. Update floating Pet helper dialog based on active pet & personality settings
    const petType = s.helperPet?.type || "floating_book";
    const petPersona = s.helperPet?.personality || "neutral";
    const petSprite = PET_TYPES_ICONS[petType] || "📖";
    const petName = PET_TYPES_NAMES[petType] || "Field Guide";
    const petLine = PET_QUICK_BAG_LINES[petPersona] || PET_QUICK_BAG_LINES.neutral;

    $("#qb-pet-sprite").text(petSprite);
    $("#qb-pet-text").html(`<strong>${petName}</strong>: "${petLine}"`);
}

// Check if an item is consumable or usable from quick bar
function isItemUsable(item) {
    if (!item) return false;
    const type = String(item.type || "").toLowerCase();
    const cat = String(item.slotCategory || "").toLowerCase();
    
    // Consumables, potions, food, drink, elixirs are usable instantly
    if (type.includes("consumable") || type.includes("potion") || type.includes("food") || type.includes("drink") || type.includes("elixir") || type.includes("scroll") || type.includes("book")) {
        return true;
    }
    if (cat.includes("consumable") || cat.includes("usable") || cat.includes("potion")) {
        return true;
    }
    // Items that possess a custom 'use' block are usable
    if (item.use && typeof item.use === "object") {
        return true;
    }
    return false;
}

// Unequip Slot Action
function unequipSlot(slotId) {
    const s = getSettings();
    if (!s.inventory) s.inventory = {};
    if (!s.inventory.equipped) s.inventory.equipped = [];
    if (!s.inventory.items) s.inventory.items = [];

    const idx = s.inventory.equipped.findIndex(e => String(e.slotId || "").toLowerCase() === slotId.toLowerCase());
    if (idx !== -1) {
        const removed = s.inventory.equipped[idx];
        delete removed.slotId;
        
        s.inventory.equipped.splice(idx, 1);
        s.inventory.items.push(removed);
        
        saveSettings();
        notify("success", `Unequipped ${removed.name} from ${slotId}.`, "QuickBag");
        
        // Dispatch compliance check & sync state
        try {
            window.dispatchEvent(new CustomEvent("uie:state_updated"));
        } catch (_) {}

        renderQuickBag();
    }
}

// Starred Item Action
async function useStarredItem(originalIdx) {
    const s = getSettings();
    if (!s.inventory || !s.inventory.items) return;
    
    const it = s.inventory.items[originalIdx];
    if (!it) return;

    const name = String(it.name || "Item");
    const eff = String(it?.use?.desc || it?.desc || it?.effect || it?.description || "").trim().slice(0, 220) || "";
    
    // Consumable check
    const consumes = shouldConsumeStarredOnUse(it);
    
    // Apply need changes/hp updates
    applyStarredItemDeltas(it);

    if (consumes) {
        const qty = Number(it.qty || 1);
        it.qty = Math.max(0, qty - 1);
        if (it.qty <= 0) {
            s.inventory.items.splice(originalIdx, 1);
        }
    }

    saveSettings();
    notify("success", `Used item: ${name}.`, "QuickBag");

    const messageText = consumes ? 
         `[System: User used ${name} (consumed).${eff ? ` Effect: ${eff}.` : ""}]`
        : `[System: User used ${name} (retained).${eff ? ` Effect: ${eff}.` : ""}]`;

    // Inject to roleplay history
    try {
        await injectRpEvent(messageText);
    } catch (_) {}

    // Dispatch sync events & re-render
    try {
        window.dispatchEvent(new CustomEvent("uie:state_updated"));
    } catch (_) {}

    renderQuickBag();
}

function shouldConsumeStarredOnUse(it) {
    if (!it) return true;
    if (it.locked === true) return false;
    const u = it.use && typeof it.use === "object" ? it.use : {};
    if (u.consumes === false || u.consume === false) return false;
    return true;
}

function applyStarredItemDeltas(it) {
    if (!it) return;
    const fromUse = it.use && typeof it.use === "object" ? it.use : {};
    
    const looseNeeds = it.needs && typeof it.needs === "object" ? it.needs : {};
    const looseProg = it.progress && typeof it.progress === "object" ? it.progress : {};

    const mergedNeeds = { ...looseNeeds, ...(fromUse.needs || {}) };
    const mergedProg = { ...looseProg, ...(fromUse.progress || {}) };

    if (Object.keys(mergedNeeds).length) {
        try {
            if (typeof window.__UIE_applyNeedsDelta === "function") {
                window.__UIE_applyNeedsDelta(mergedNeeds);
            }
        } catch (_) {}
    }
    if (Object.keys(mergedProg).length) {
        try {
            if (typeof window.__UIE_applyProgressDelta === "function") {
                window.__UIE_applyProgressDelta(mergedProg);
            }
        } catch (_) {}
    }
}

// Casting Skill Action
function useQuickSkill(skillName) {
    hideQuickBag();
    
    // Auto-populate chat row with skill trigger action
    $("#user-input").val(`I use my skill "${skillName}" in this situation.`);
    $("#send-btn").trigger("click");
    
    notify("info", `Casting skill: ${skillName}`, "QuickBag");
}

function esc(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function equipGear(originalIdx) {
    const s = getSettings();
    if (!s.inventory || !s.inventory.items) return;
    
    const item = s.inventory.items[originalIdx];
    if (!item) return;

    // Determine slot based on category or name synonyms
    const cat = String(item.slotCategory || item.slotId || "Main Hand").trim();
    let slotId = "Main Hand";
    if (cat.toLowerCase().includes("head") || cat.toLowerCase().includes("crown") || cat.toLowerCase().includes("helmet")) slotId = "Head";
    else if (cat.toLowerCase().includes("chest") || cat.toLowerCase().includes("shirt") || cat.toLowerCase().includes("armor")) slotId = "Chest";
    else if (cat.toLowerCase().includes("feet") || cat.toLowerCase().includes("boot") || cat.toLowerCase().includes("shoes")) slotId = "Feet";
    else if (cat.toLowerCase().includes("accessory") || cat.toLowerCase().includes("ring") || cat.toLowerCase().includes("amulet")) slotId = "Accessory";

    if (!s.inventory.equipped) s.inventory.equipped = [];
    
    // Unequip existing slot first if occupied
    const existingIdx = s.inventory.equipped.findIndex(e => String(e.slotId || "").toLowerCase() === slotId.toLowerCase());
    if (existingIdx !== -1) {
        const removed = s.inventory.equipped[existingIdx];
        delete removed.slotId;
        s.inventory.equipped.splice(existingIdx, 1);
        s.inventory.items.push(removed);
    }

    // Remove from items and add to equipped
    s.inventory.items.splice(originalIdx, 1);
    item.slotId = slotId;
    s.inventory.equipped.push(item);

    saveSettings();
    notify("success", `Equipped ${item.name} to ${slotId}.`, "QuickBag");

    // Dispatch sync events & re-render
    try {
        window.dispatchEvent(new CustomEvent("uie:state_updated"));
    } catch (_) {}
    renderQuickBag();
}

function unequipSlotByItemIndex(equippedIdx) {
    const s = getSettings();
    if (!s.inventory || !s.inventory.equipped) return;
    
    const gear = s.inventory.equipped[equippedIdx];
    if (gear && gear.slotId) {
        unequipSlot(gear.slotId);
    }
}
