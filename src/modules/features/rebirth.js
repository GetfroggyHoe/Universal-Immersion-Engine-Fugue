import { getSettings, saveSettings } from "../core.js";
import { notify } from "../notifications.js";
import { injectRpEvent } from "./rp_log.js";

export function init() {
    const s = getSettings();
    if (!s.character) s.character = {};
    if (!s.party) s.party = {};
    if (!Array.isArray(s.party.members)) s.party.members = [];

    const listContainer = $("#uie-rebirth-vessels-list");
    const emptyMsg = $("#uie-rebirth-roster-empty");
    const countEl = $("#uie-rebirth-roster-count");
    const executeBtn = $("#uie-rebirth-execute-btn");

    if (!listContainer.length) return;

    // Filter out the active user vessel itself so they rebirth into a family/roster member
    const vessels = s.party.members.filter(m => m && m.isUser !== true && String(m.id) !== "party_user");

    listContainer.empty();

    if (vessels.length === 0) {
        listContainer.append(emptyMsg.show());
        countEl.text("0 Vessels Available");
        executeBtn.attr("disabled", "true");
        return;
    }

    emptyMsg.hide();
    countEl.text(`${vessels.length} Vessel${vessels.length === 1 ? "" : "s"} Available`);
    executeBtn.attr("disabled", "true"); // Disabled until selection

    vessels.forEach(v => {
        const name = v.identity?.name || v.name || "Unknown Roster Member";
        const cls = v.identity?.class || v.class || "Adventurer";
        const lvl = v.progression?.level || v.level || 1;
        const portrait = v.identity?.avatar || v.identity?.portrait || v.avatar || v.portrait || "";
        
        let imgHtml = `
            <div style="width:48px; height:48px; border-radius:10px; background:#0c0f17; border:1px solid rgba(203,163,92,0.3); display:grid; place-items:center; flex-shrink:0; overflow:hidden;">
                <i class="fa-solid fa-user-secret" style="font-size:22px; color:#cba35c; opacity:0.6;"></i>
            </div>
        `;
        if (portrait) {
            imgHtml = `
                <div style="width:48px; height:48px; border-radius:10px; background:#0c0f17; border:1px solid rgba(203,163,92,0.3); flex-shrink:0; overflow:hidden;">
                    <img src="${portrait}" style="width:100%; height:100%; object-fit:cover;" />
                </div>
            `;
        }

        const cardHtml = `
            <div class="uie-rebirth-card" data-id="${v.id}" style="background:rgba(255,255,255,0.02) !important; border:1px solid rgba(255,255,255,0.05) !important; border-radius:14px; padding:12px 16px; display:flex; gap:14px; align-items:center; cursor:pointer; transition:all 0.2s; box-sizing:border-box;">
                ${imgHtml}
                <div style="flex:1; min-width:0;">
                    <div style="font-family:'Cinzel', serif; font-weight:800; font-size:1.05em; color:#e2e8f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</div>
                    <div style="font-size:0.8em; color:#cba35c; font-weight:600; margin-top:2px;">${cls} · Lv. ${lvl}</div>
                </div>
            </div>
        `;

        listContainer.append(cardHtml);
    });

    // Unbind prior listeners to prevent double binds
    $(document)
        .off("click.uieVesselSelect", ".uie-rebirth-card")
        .on("click.uieVesselSelect", ".uie-rebirth-card", function(e) {
            e.preventDefault();
            e.stopPropagation();
            $(".uie-rebirth-card").removeClass("selected");
            $(this).addClass("selected");
            executeBtn.removeAttr("disabled");
        });

    $(document)
        .off("click.uieVesselExecute", "#uie-rebirth-execute-btn")
        .on("click.uieVesselExecute", "#uie-rebirth-execute-btn", function(e) {
            e.preventDefault();
            e.stopPropagation();
            const selectedId = $(".uie-rebirth-card.selected").data("id");
            if (selectedId) {
                executeRebirth(selectedId);
            }
        });
}

function executeRebirth(vesselId) {
    const s = getSettings();
    if (!s.party || !Array.isArray(s.party.members)) return;

    const vessel = s.party.members.find(m => String(m.id) === String(vesselId));
    if (!vessel) {
        notify("error", "Selected vessel could not be found.", "Rebirth");
        return;
    }

    const name = vessel.identity?.name || vessel.name || "Unknown Roster Member";
    if (!confirm(`Are you absolutely sure you want to wake up as ${name} This will transform your level, stats, and inventory to match theirs.`)) {
        return;
    }

    const syncPersona = $("#uie-rebirth-sync-persona").is(":checked");

    // Copy basic stats and info
    s.character.name = name;
    s.character.className = vessel.identity?.class || vessel.class || "Adventurer";
    s.character.level = Number(vessel.progression?.level ?? vessel.level ?? 1);
    s.character.portrait = vessel.identity?.avatar || vessel.identity?.portrait || vessel.avatar || vessel.portrait || "";

    // Sync persona flags
    s.character.syncPersona = syncPersona;

    // Reset XP and copy vitals
    s.maxHp = Number(vessel.vitals?.maxHp ?? vessel.maxHp ?? 100);
    s.hp = Number(vessel.vitals?.hp ?? vessel.hp ?? s.maxHp);
    s.maxMp = Number(vessel.vitals?.maxMp ?? vessel.maxMp ?? 50);
    s.mp = Number(vessel.vitals?.mp ?? vessel.mp ?? s.maxMp);
    s.maxAp = Number(vessel.vitals?.maxAp ?? vessel.maxAp ?? 10);
    s.ap = Number(vessel.vitals?.ap ?? vessel.ap ?? s.maxAp);
    s.xp = Number(vessel.progression?.xp ?? vessel.xp ?? 0);
    s.maxXp = Number(vessel.progression?.maxXp ?? vessel.maxXp ?? 1000);

    // Copy core attributes/stats if present
    if (vessel.stats && typeof vessel.stats === "object") {
        s.character.stats = { ...vessel.stats };
    } else {
        // Fallback default stats if vessel has none
        s.character.stats = {
            str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
            per: 10, luk: 10, agi: 10, vit: 10, end: 10, spi: 10
        };
    }

    // Deep copy vessel inventory and skills
    if (!s.inventory) s.inventory = {};
    s.inventory.items = Array.isArray(vessel.inventory?.items) ? JSON.parse(JSON.stringify(vessel.inventory.items)) : [];
    s.inventory.skills = Array.isArray(vessel.inventory?.skills) ? JSON.parse(JSON.stringify(vessel.inventory.skills)) : [];
    s.inventory.assets = Array.isArray(vessel.inventory?.assets) ? JSON.parse(JSON.stringify(vessel.inventory.assets)) : [];
    s.inventory.equipped = Array.isArray(vessel.inventory?.equipped) ? JSON.parse(JSON.stringify(vessel.inventory.equipped)) : [];

    saveSettings();

    // Trigger updates in inventory module to keep stats in sync
    import("../inventory.js").then(mod => {
        if (mod && mod.updateVitals) mod.updateVitals();
        if (mod && mod.applyInventoryUi) mod.applyInventoryUi();
    });

    // Close the Create overlay since rebirth ascension is complete
    if (window.UIE_closeCreateOverlay) {
        window.UIE_closeCreateOverlay();
    }

    notify("success", `Successfully woke up as ${name}!`, "Rebirth");
    injectRpEvent(`[System Note: User has reborn/woken up as ${name}. Chat Persona is now ${name} with Lv. ${s.character.level}, full vitals, custom inventory, and stats.]`);
}
