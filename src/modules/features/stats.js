
import { getSettings, saveSettings } from "../core.js";
import { notify } from "../notifications.js";
import { ensureEconomyState, formatCurrency, ensureProgressionState } from "../economy.js";
import { MEDALLIONS } from "../inventory.js";
import { injectRpEvent } from "./rp_log.js";

let isEditing = false;

export function initStats() {
    // Bind global events or window specific events
    // Scope to main menu
    $("#uie-main-menu").off("click.uieStats").on("click.uieStats", "#uie-btn-stats", () => {
        try {
            $("#uie-btn-party").trigger("click");
            notify("info", "Stats now live inside Party. Click a character card to open their sheet.", "Party");
        } catch (_) {
            isEditing = false;
            renderStats();
        }
    });

    // Bind "+" buttons
    // Scope to stats window
    $("#uie-stats-window").off("click.uieStatUp").on("click.uieStatUp", ".uie-stat-up-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const stat = $(this).data("stat");
        upgradeStat(stat);
    });

    $("#uie-stats-window").off("click.uieStatAdd").on("click.uieStatAdd", "#uie-stats-add-stat", function(e) {
        e.preventDefault();
        e.stopPropagation();
        addCustomStat();
    });

    $("#uie-stats-window").off("click.uieStatDelete").on("click.uieStatDelete", ".uie-stat-delete-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        deleteCustomStat(String($(this).data("stat") || ""));
    });

    // Bind Edit Toggle
    $("#uie-stats-window").off("click.uieStatEdit").on("click.uieStatEdit", "#uie-stats-edit-toggle", function(e) {
        e.preventDefault();
        e.stopPropagation();
        isEditing = !isEditing;
        $(this).css("color", isEditing ? "#cba35c" : "");
        renderStats();
    });

    // Bind Input Changes
    $("#uie-stats-window").off("change.uieStatInput").on("change.uieStatInput", ".uie-stat-input", function(e) {
        const key = $(this).data("key");
        const type = $(this).data("type"); // 'root', 'char', 'stat'
        let val = $(this).val();

        const s = getSettings();
        if (!s.character) s.character = {};
        if (!s.character.stats) s.character.stats = {};

        // Parse number if needed
        if ($(this).attr("type") === "number") val = Number(val);

        if (type === "root") {
            s[key] = val;
            // Keep legacy inventory.vitals in sync (some installs still rely on it)
            if (!s.inventory) s.inventory = {};
            if (!s.inventory.vitals) s.inventory.vitals = {};
            if (key === "hp") s.inventory.vitals.hp = Number(val) || 0;
            if (key === "maxHp") s.inventory.vitals.maxHp = Number(val) || 0;
            if (key === "mp") s.inventory.vitals.mp = Number(val) || 0;
            if (key === "maxMp") s.inventory.vitals.maxMp = Number(val) || 0;
            // Inventory uses AP naming internally; older settings use SP
            if (key === "ap") s.inventory.vitals.sp = Number(val) || 0;
            if (key === "maxAp") s.inventory.vitals.maxSp = Number(val) || 0;
            if (key === "xp") s.inventory.vitals.xp = Number(val) || 0;
        } else if (type === "char") {
            s.character[key] = val;
            if (key === "name") s.character.syncPersona = false;
        } else if (type === "stat") {
            s.character.stats[key] = val;
        } else if (type === "label") {
            if (!s.statLabels) s.statLabels = {};
            s.statLabels[key] = String(val || "");
            if (!s.character.statLabels || typeof s.character.statLabels !== "object") s.character.statLabels = {};
            s.character.statLabels[key] = String(val || "");
        } else if (type === "vitalLabel") {
            if (!s.vitalLabels) s.vitalLabels = {};
            s.vitalLabels[key] = String(val || "");
        }

        saveSettings();
        // If vitals changed, refresh inventory bars immediately
        if (type === "root" && ["hp", "maxHp", "mp", "maxMp", "ap", "maxAp", "xp", "maxXp"].includes(String(key))) {
            import("../inventory.js").then(mod => {
                if (mod && mod.updateVitals) mod.updateVitals();
            });
        }
        if (type === "char" && key === "level") {
            import("../inventory.js").then(mod => {
                if (mod && mod.applyInventoryUi) mod.applyInventoryUi();
            });
        }
        // Don't re-render immediately to avoid losing focus, unless needed?
        // Actually, re-rendering might be safer to sync UI states, but input focus is tricky.
        // Let's just update the setting silently.
    });

    // Bind Rebirth events
    $("#uie-stats-window").off("click.uieRebirth").on("click.uieRebirth", "#uie-stats-rebirth-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        openRebirthMedallionModal();
    });

    $("#uie-stats-window").off("click.uieMedallionSelect").on("click.uieMedallionSelect", ".uie-medallion-card", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $(".uie-medallion-card").removeClass("selected");
        $(this).addClass("selected");
        $("#uie-rebirth-confirm-btn").removeAttr("disabled");
    });

    $("#uie-stats-window").off("click.uieRebirthConfirm").on("click.uieRebirthConfirm", "#uie-rebirth-confirm-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const selectedId = $(".uie-medallion-card.selected").data("id");
        if (selectedId) {
            confirmRebirthAscension(selectedId);
        }
    });

    $("#uie-stats-window").off("click.uieRebirthCancel").on("click.uieRebirthCancel", "#uie-rebirth-cancel-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-rebirth-medallion-modal").css("display", "none");
    });

    // Bind refresh/render on window show
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          const target = mutation.target;
          if (target.style.display !== 'none') {
            renderStats();
          }
        }
      });
    });

    const win = document.getElementById("uie-stats-window");
    if (win) {
        observer.observe(win, { attributes: true, attributeFilter: ["style"] });
        if (win.style.display !== "none") {
            renderStats();
        }
    }
}

export function renderStats() {
    const $win = $("#uie-stats-window");
    if (!$win.is(":visible")) return;

    const s = getSettings();
    if (!s.character) s.character = {};
    if (!s.character.stats) s.character.stats = {};
    ensureEconomyState(s);
    ensureProgressionState(s);

    const vit = s.inventory?.vitals && typeof s.inventory.vitals === "object" ? s.inventory.vitals : {};
    const hp = Number.isFinite(Number(s.hp)) ? Number(s.hp) : Number(vit.hp || 0);
    const maxHp = Number.isFinite(Number(s.maxHp)) ? Number(s.maxHp) : Number(vit.maxHp || 0);
    const mp = Number.isFinite(Number(s.mp)) ? Number(s.mp) : Number(vit.mp || 0);
    const maxMp = Number.isFinite(Number(s.maxMp)) ? Number(s.maxMp) : Number(vit.maxMp || 0);
    const ap = Number.isFinite(Number(s.ap)) ? Number(s.ap) : Number(vit.sp || 0);
    const maxAp = Number.isFinite(Number(s.maxAp)) ? Number(s.maxAp) : Number(vit.maxSp || 0);
    const xp = Number.isFinite(Number(s.xp)) ? Number(s.xp) : Number(vit.xp || 0);
    const maxXp = Number.isFinite(Number(s.maxXp)) ? Number(s.maxXp) : Number(s.maxXp || 0);

    const vitLabels = s.vitalLabels && typeof s.vitalLabels === "object" ? s.vitalLabels : {};
    const labelHp = String(vitLabels.hp || "Health");
    const labelMp = String(vitLabels.mp || "Mana");
    const labelAp = String(vitLabels.ap || "Stamina");
    const labelXp = String(vitLabels.xp || "Experience");

    // Check if elements exist
    if ($("#uie-stats-list").length === 0) {
        console.warn("[UIE] Stats window elements missing. Template not loaded?");
        return;
    }

    // 1. Portrait & Basic Info
    const name = s.character.name || "Unknown";
    const cls = s.character.className || "Adventurer";
    const lvl = s.character.level || 1;
    const pts = s.character.statPoints || 0;
    const skillPts = Number(s.character.skillPoints || s.character.progression?.skillPoints || 0);
    const portrait = s.character.portrait || s.character.avatar || "";

    const activeMedId = s.character.activeMedallion;
    const isReborn = s.character.isReborn === true;
    const medallion = isReborn && activeMedId ? MEDALLIONS[activeMedId] : null;
    let medallionHtml = "";

    if (medallion) {
        medallionHtml = `
            <img src="${medallion.img}" class="uie-stats-medallion-badge" title="${medallion.name}: ${medallion.desc.replace(/"/g, '&quot;')}" style="width:20px; height:20px; vertical-align:middle; margin-left:6px; cursor:help; border-radius:50%; box-shadow:0 0 6px rgba(203,163,92,0.8); border:1px solid rgba(203,163,92,0.6);" />
        `;
    }

    // Toggle Rebirth button visibility based on level cap (Level 150)
    const rebirthBtn = $("#uie-stats-rebirth-btn");
    if (lvl >= 150) {
        rebirthBtn.show();
    } else {
        rebirthBtn.hide();
    }

    if (isEditing) {
        $("#uie-stats-name").html(`<input type="text" class="uie-stat-input" data-key="name" data-type="char" value="${name}" style="background:rgba(0,0,0,0.5); border:1px solid #555; color:#fff; text-align:center; width:100%;">`);
        $("#uie-stats-class").html(`
            <input type="text" class="uie-stat-input" data-key="className" data-type="char" value="${cls}" style="background:rgba(0,0,0,0.5); border:1px solid #555; color:#cba35c; text-align:center; width:120px;">
            Lv. <input type="number" class="uie-stat-input" data-key="level" data-type="char" value="${lvl}" style="background:rgba(0,0,0,0.5); border:1px solid #555; color:#fff; text-align:center; width:50px;">
        `);
    } else {
        $("#uie-stats-name").text(name);
        // Make Class clickable to toggle edit mode as a hint
        $("#uie-stats-class").html(`<span style="cursor:pointer; border-bottom:1px dashed #666;" title="Click 'Edit' icon (pencil) to change class">${cls} - Lv. ${lvl}${medallionHtml} · ${skillPts} SP · ${formatCurrency(s.currency, s)}</span>`);
        $("#uie-stats-class").off("click").on("click", () => {
             // Flash the edit button to show user where it is
             const btn = $("#uie-stats-edit-toggle");
             btn.css("transition", "color 0.2s").css("color", "#fff");
             setTimeout(() => btn.css("color", ""), 200);
             setTimeout(() => btn.css("color", "#fff"), 400);
             setTimeout(() => btn.css("color", ""), 600);
             if(window.toastr) toastr.info("Click the Pencil icon to edit stats & class.", "Tip");
        });
    }

    if (portrait) {
        $("#uie-stats-portrait").attr("src", portrait).show();
        $("#uie-stats-portrait-fallback").hide();
    } else {
        $("#uie-stats-portrait").hide();
        $("#uie-stats-portrait-fallback").show();
    }

    const ptsEl = $("#uie-stats-points");
    // Always show the container but change text
    if (isEditing) {
        ptsEl.addClass("uie-char-points").html(`Points: <input type="number" class="uie-stat-input" data-key="statPoints" data-type="char" value="${pts}" style="background:rgba(0,0,0,0.5); border:none; color:#2ecc71; width:40px;">`);
    } else if (pts > 0) {
        ptsEl.addClass("uie-char-points").text(`Points: ${pts}`);
    } else {
        ptsEl.removeClass("uie-char-points").text("");
    }

    // Reset Button
    $("#uie-stats-reset-btn").show().off("click").on("click", resetStats);

    // 2. Attributes
    const statsList = $("#uie-stats-list");
    statsList.empty();

    const STAT_DEFAULTS = {
        str: "Strength", dex: "Dexterity", con: "Constitution",
        int: "Intelligence", wis: "Wisdom", cha: "Charisma",
        per: "Perception", luk: "Luck", agi: "Agility",
        vit: "Vitality", end: "Endurance", spi: "Spirit"
    };
    const labels = { ...(s.character.statLabels || {}), ...(s.statLabels || {}) };
    const defaultKeys = ["str", "dex", "con", "int", "wis", "cha", "per", "luk", "agi", "vit", "end", "spi"];
    const currentKeys = Object.keys(s.character.stats || {});
    const keys = currentKeys.length ? currentKeys : defaultKeys;

    if (isEditing) {
        statsList.append(`
            <button id="uie-stats-add-stat" style="grid-column:1/-1; min-height:38px; border-radius:10px; background:rgba(203,163,92,0.14); color:#cba35c; border:1px solid rgba(203,163,92,0.35); cursor:pointer; font-weight:bold;">
                + Add Stat
            </button>
        `);
    }

    keys.forEach(key => {
        const val = s.character.stats[key] || 0;
        const defaultLabel = STAT_DEFAULTS[key] || key.toUpperCase();
        const label = labels[key] || defaultLabel;

        let btnHtml = "";
        let labelHtml = "";

        if (isEditing) {
            btnHtml = `<input type="number" class="uie-stat-input" data-key="${key}" data-type="stat" value="${val}" style="width:50px; background:rgba(0,0,0,0.5); border:1px solid #555; color:#fff; text-align:center;">`;
            labelHtml = `<input type="text" class="uie-stat-input" data-key="${key}" data-type="label" value="${label}" style="width:80px; background:rgba(0,0,0,0.5); border:1px solid #555; color:#cba35c; font-size:0.8em;">`;
            btnHtml += `<button class="uie-stat-delete-btn" data-stat="${key}" title="Delete Stat" style="margin-left:6px; width:26px; height:26px; border-radius:8px; border:1px solid rgba(231,76,60,0.35); background:rgba(231,76,60,0.16); color:#ff8e8e; cursor:pointer;">x</button>`;
        } else {
            btnHtml = `<div class="uie-stat-val">${val}</div>`;
            if (pts > 0) {
                btnHtml += `<div class="uie-stat-up-btn" data-stat="${key}">+</div>`;
            }
            labelHtml = `<div class="uie-stat-label">${label}</div>`;
        }

        const html = `
            <div class="uie-stat-card">
                ${labelHtml}
                <div style="display:flex; align-items:center;">
                    ${btnHtml}
                </div>
            </div>
        `;
        statsList.append(html);
    });

    // 3. Vitals (Bars)
    const vitalsEl = $("#uie-stats-vitals");
    vitalsEl.empty();

    const renderBar = (label, cur, max, type, keyCur, keyMax, keyLabel) => {
        if (isEditing) {
            return `
                <div class="uie-bar-container" style="background:rgba(0,0,0,0.3); padding:5px; border-radius:6px;">
                    <div class="uie-bar-labels" style="align-items:center;">
                        <input type="text" class="uie-stat-input" data-key="${keyLabel}" data-type="vitalLabel" value="${String(label || "")}" style="width:120px; background:rgba(0,0,0,0.35); border:1px solid #555; color:#ddd; border-radius:6px; padding:2px 6px;">
                        <div style="display:flex; gap:5px; align-items:center;">
                            <input type="number" class="uie-stat-input" data-key="${keyCur}" data-type="root" value="${cur||0}" style="width:60px; background:rgba(0,0,0,0.5); border:1px solid #555; color:#fff; text-align:right;">
                            /
                            <input type="number" class="uie-stat-input" data-key="${keyMax}" data-type="root" value="${max||0}" style="width:60px; background:rgba(0,0,0,0.5); border:1px solid #555; color:#fff; text-align:right;">
                        </div>
                    </div>
                </div>
            `;
        } else {
            const c = Math.round(cur || 0);
            const m = Math.round(max || 0);
            const pct = m > 0 ? Math.max(0, Math.min(100, (c / m) * 100)) : 0;
            return `
                <div class="uie-bar-container">
                    <div class="uie-bar-labels">
                        <span>${label}</span>
                        <span>${c} / ${m}</span>
                    </div>
                    <div class="uie-bar-track">
                        <div class="uie-bar-fill uie-bar-${type}" style="width:${pct}%;"></div>
                    </div>
                </div>
            `;
        }
    };

    vitalsEl.append(renderBar(labelHp, hp, maxHp, "hp", "hp", "maxHp", "hp"));
    vitalsEl.append(renderBar(labelMp, mp, maxMp, "mp", "mp", "maxMp", "mp"));
    vitalsEl.append(renderBar(labelAp, ap, maxAp, "ap", "ap", "maxAp", "ap"));
    vitalsEl.append(renderBar(labelXp, xp, maxXp, "xp", "xp", "maxXp", "xp"));
}

function resetStats() {
    if (!confirm("Reset all stats to 10 and refund points?")) return;
    const s = getSettings();
    const keys = ["str", "dex", "con", "int", "wis", "cha", "per", "luk", "agi", "vit", "end", "spi"];

    let refunded = 0;
    keys.forEach(k => {
        const val = s.character.stats[k] || 0;
        if (val > 10) {
            refunded += (val - 10);
            s.character.stats[k] = 10;
        }
    });

    s.character.statPoints = (s.character.statPoints || 0) + refunded;
    saveSettings();
    renderStats();
    import("../inventory.js").then(mod => {
        if (mod && mod.updateVitals) mod.updateVitals();
    });
    notify("success", `Reset complete. Refunded ${refunded} points.`, "Stats");
    injectRpEvent(`[System: Stats reset. Refunded ${refunded} points.]`);
}

function addCustomStat() {
    const s = getSettings();
    if (!s.character) s.character = {};
    if (!s.character.stats || typeof s.character.stats !== "object") s.character.stats = {};
    if (!s.statLabels || typeof s.statLabels !== "object") s.statLabels = {};
    const rawName = prompt("Stat name?", "New Stat");
    const label = String(rawName || "").trim();
    if (!label) return;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || `stat_${Date.now()}`;
    if (Object.prototype.hasOwnProperty.call(s.character.stats, key)) {
        notify("warning", "That stat already exists.", "Stats");
        return;
    }
    s.character.stats[key] = 10;
    s.statLabels[key] = label;
    if (!s.character.statLabels || typeof s.character.statLabels !== "object") s.character.statLabels = {};
    s.character.statLabels[key] = label;
    saveSettings();
    renderStats();
}

function deleteCustomStat(key) {
    if (!key) return;
    if (!confirm("Delete this stat?")) return;
    const s = getSettings();
    if (!s.character?.stats) return;
    delete s.character.stats[key];
    if (s.statLabels) delete s.statLabels[key];
    if (s.character.statLabels) delete s.character.statLabels[key];
    saveSettings();
    renderStats();
}

function upgradeStat(key) {
    const s = getSettings();
    if (!s.character.statPoints || s.character.statPoints <= 0) return;

    if (!s.character.stats) s.character.stats = {};
    s.character.stats[key] = (s.character.stats[key] || 0) + 1;
    s.character.statPoints--;

    saveSettings();
    renderStats();
    import("../inventory.js").then(mod => {
        if (mod && mod.updateVitals) mod.updateVitals();
    });
    notify("success", `Upgraded ${key.toUpperCase()}`, "Stats");
}

const MEDALLION_SKILLS = {
    medallion_water: [
        { name: "Flow State", desc: "[Passive] Stamina cost reduced to 0, evasion rate significantly boosted.", type: "passive", skillType: "passive", level: "1" },
        { name: "Tidal Wave", desc: "[Active] Releases a massive wave of pressurized water, knocking back and drenching all foes.", type: "active", skillType: "active", level: "1" },
        { name: "Aqua Regeneration", desc: "[Active] Restores health and mana continuously in or near water.", type: "active", skillType: "active", level: "1" },
        { name: "Liquid Phase", desc: "[Active] Dissolve into pure liquid for 5 seconds, becoming completely immune to all physical damage.", type: "active", skillType: "active", level: "1" },
        { name: "Coiled Serpent Strike", desc: "[Active] A whip-like strike that entangles enemies in a crushing watery vortex.", type: "active", skillType: "active", level: "1" }
    ],
    medallion_earth: [
        { name: "Mountain's Heart", desc: "[Passive] Skin is hardened to diamond-like density, making you completely immune to knockbacks and reducing all incoming physical damage by 50%.", type: "passive", skillType: "passive", level: "1" },
        { name: "Tectonic Slam", desc: "[Active] Shatters the ground, causing high physical damage and stunning all enemies in a wide radius.", type: "active", skillType: "active", level: "1" },
        { name: "Diamond Aegis", desc: "[Active] Erects a crystalline shield that absorbs massive damage and reflects physical attacks back to the attacker.", type: "active", skillType: "active", level: "1" },
        { name: "Grave Weight", desc: "[Passive] Enemies within a 15-meter radius are crushed by your extreme gravity presence, slowing their movement by 40%.", type: "passive", skillType: "passive", level: "1" },
        { name: "Earthen Fortress", desc: "[Active] Pulls massive slabs of stone from the ground to form a defensive wall that blocks projectiles and traps foes.", type: "active", skillType: "active", level: "1" }
    ],
    medallion_air: [
        { name: "Sky Walker", desc: "[Passive] Ignores fall damage and gravity; leap high, run on walls, and move silently.", type: "passive", skillType: "passive", level: "1" },
        { name: "Zephyr Dash", desc: "[Active] A lightning-fast blink forward, slicing through all enemies in the path with guaranteed critical strikes.", type: "active", skillType: "active", level: "1" },
        { name: "Tornado Vortex", desc: "[Active] Summons a raging cyclone that draws enemies together and launches them into the air.", type: "active", skillType: "active", level: "1" },
        { name: "Silent Blade", desc: "[Passive] Sneak attacks from behind deal 400% critical damage and silences targets.", type: "passive", skillType: "passive", level: "1" },
        { name: "Gale Ward", desc: "[Active] Surrounds you with high-velocity wind, deflecting all incoming arrow and spell projectiles.", type: "active", skillType: "active", level: "1" }
    ],
    medallion_fire: [
        { name: "Burning Soul", desc: "[Passive] Soul is a furnace. Passively burns nearby enemies for fire damage. Revives with 50% HP upon death (Phoenix Resurrection).", type: "passive", skillType: "passive", level: "1" },
        { name: "Cauterizing Flame", desc: "[Passive] Immune to bleed and poison effects; wounds are instantly cauterized by flame.", type: "passive", skillType: "passive", level: "1" },
        { name: "Hellfire Slash", desc: "[Active] Infuses your weapon with white-hot flames, dealing explosive fire damage on impact.", type: "active", skillType: "active", level: "1" },
        { name: "Incinerate Aura", desc: "[Active] Radiate a blinding heat haze that reduces enemy accuracy by 50% and scorches their armor.", type: "active", skillType: "active", level: "1" },
        { name: "Blazing Recklessness", desc: "[Active] Trade 20% of current HP for a 100% boost to attack speed and physical damage for 15 seconds.", type: "active", skillType: "active", level: "1" }
    ],
    medallion_rebel: [
        { name: "Rule Breaker", desc: "[Passive] Ignores all class, stat, and alignment restrictions on all weapons, armor, and spells.", type: "passive", skillType: "passive", level: "1" },
        { name: "Usurper's Command", desc: "[Active] Compels low-level or weak-willed NPCs/enemies to fight on your behalf for 30 seconds.", type: "active", skillType: "active", level: "1" },
        { name: "Chaos Dagger", desc: "[Active] A quick strike that inflicts a random negative status effect on the target (burn, stun, freeze, or silence).", type: "active", skillType: "active", level: "1" },
        { name: "Sovereign Slayer", desc: "[Passive] Deals 50% bonus damage to elite, boss, or authority figures.", type: "passive", skillType: "passive", level: "1" },
        { name: "Defiant Will", desc: "[Active] Break free from all active crowd control, stun, or silence effects and become immune to them for 8 seconds.", type: "active", skillType: "active", level: "1" }
    ]
};

function openRebirthMedallionModal() {
    const listContainer = $("#uie-rebirth-medallions-list");
    listContainer.empty();
    
    // Disable Confirm button until selection is made
    $("#uie-rebirth-confirm-btn").attr("disabled", "true");

    Object.values(MEDALLIONS).forEach(m => {
        const itemHtml = `
            <div class="uie-medallion-card" data-id="${m.id}" style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:14px; padding:16px; display:flex; gap:16px; align-items:center; cursor:pointer; transition:all 0.25s cubic-bezier(0.4, 0, 0.2, 1); box-shadow:0 4px 15px rgba(0,0,0,0.15); box-sizing:border-box;">
                <div style="width:64px; height:64px; border-radius:50%; background:rgba(0,0,0,0.4); border:2px solid rgba(203,163,92,0.3); overflow:hidden; display:grid; place-items:center; flex-shrink:0;">
                    <img src="${m.img}" style="width:100%; height:100%; object-fit:cover;" />
                </div>
                <div style="flex:1;">
                    <div style="font-family:'Cinzel', serif; font-weight:800; font-size:1.1em; color:#cba35c; margin-bottom:4px;">${m.name}</div>
                    <div style="font-size:0.82em; color:#8e9cae; line-height:1.4; white-space:pre-wrap;">${m.desc}</div>
                </div>
            </div>
        `;
        listContainer.append(itemHtml);
    });

    $("#uie-rebirth-medallion-modal").css("display", "flex");
}

function confirmRebirthAscension(medallionId) {
    const m = MEDALLIONS[medallionId];
    if (!m) return;

    if (!confirm(`Are you absolutely sure you want to rebirth with the ${m.name} Your Level will be reset to 1 and you will receive legendary boons.`)) {
        return;
    }

    const s = getSettings();
    if (!s.character) s.character = {};
    if (!s.inventory) s.inventory = {};
    if (!Array.isArray(s.inventory.skills)) s.inventory.skills = [];
    if (!Array.isArray(s.character.statusEffects)) s.character.statusEffects = [];

    // Apply Rebirth Changes
    s.character.level = 1;
    s.character.isReborn = true;
    s.character.activeMedallion = medallionId;

    // Reset XP to 0 and set vitals to max
    s.xp = 0;
    if (!s.inventory.vitals) s.inventory.vitals = {};
    s.inventory.vitals.xp = 0;
    s.inventory.vitals.hp = s.maxHp;
    s.inventory.vitals.mp = s.maxMp;
    s.inventory.vitals.sp = s.maxAp;
    s.hp = s.maxHp;
    s.mp = s.maxMp;
    s.ap = s.maxAp;

    // Push Passive Status Effect if it doesn't exist
    if (m.statusEffects && m.statusEffects.length > 0) {
        m.statusEffects.forEach(effectName => {
            if (!s.character.statusEffects.includes(effectName)) {
                s.character.statusEffects.push(effectName);
            }
        });
    }

    // Inject the 5 custom Medallion Skills
    const skillsToInject = MEDALLION_SKILLS[medallionId] || [];
    let addedCount = 0;
    skillsToInject.forEach(skill => {
        const alreadyHas = s.inventory.skills.some(sk => String(sk.name).toLowerCase() === String(skill.name).toLowerCase());
        if (!alreadyHas) {
            s.inventory.skills.push({
                kind: "skill",
                name: skill.name,
                desc: skill.desc,
                description: skill.desc,
                level: skill.level,
                type: skill.type,
                skillType: skill.skillType,
                img: m.img
            });
            addedCount++;
        }
    });

    saveSettings();

    // Trigger updates in inventory module to keep stats in sync
    import("../inventory.js").then(mod => {
        if (mod && mod.updateVitals) mod.updateVitals();
        if (mod && mod.applyInventoryUi) mod.applyInventoryUi();
    });

    $("#uie-rebirth-medallion-modal").css("display", "none");
    renderStats();

    notify("success", `Ascended via Rebirth! Gained 5 skills & ${m.name}.`, "Rebirth");
    injectRpEvent(`[System Note: User has undergone Rebirth, ascending with the ${m.name}!]`);
}
