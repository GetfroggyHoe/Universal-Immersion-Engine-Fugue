/**
 * genericNpcs.js — Generic NPC database, Autopilot probability engine, and "Decorate" Upgrade UI
 */

import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";

// Pre-loaded Roster of Generic NPCs
export const GENERIC_NPC_ARCHETYPES = {
    bartender: {
        archetype: "Bartender",
        tags: ["Civilian", "Adult Male", "Modest Wealth"],
        habits: ["Friendly", "Gossip", "Observant"],
        wants: "Earn a steady living behind the counter",
        needs: "Keep customers happy and glasses full",
        desires: "Open a grand metropolitan high-end tavern",
        portrait: "https://files.catbox.moe/k6bhpb.jpg", // Default placeholder
        baseAffinity: 50
    },
    guard: {
        archetype: "Guard",
        tags: ["Military", "Adult Male", "Average Wealth"],
        habits: ["Disciplined", "Alert", "Stubborn"],
        wants: "Maintain local order and complete patrol routes",
        needs: "Stay awake on long night shifts",
        desires: "Be promoted to Guard Captain of the region",
        portrait: "https://files.catbox.moe/8swn6p.jpg",
        baseAffinity: 50
    },
    vendor: {
        archetype: "Vendor",
        tags: ["Merchant", "Adult Female", "Modest Wealth"],
        habits: ["Greedy", "Loud", "Persuasive"],
        wants: "Sell as much stock as possible today",
        needs: "Secure cheap wholesale inventory",
        desires: "Own the largest mercantile shop in the capital",
        portrait: "https://files.catbox.moe/4e8b8p.jpg",
        baseAffinity: 55
    },
    thief: {
        archetype: "Thief",
        tags: ["Criminal", "Young Male", "Low Wealth"],
        habits: ["Sly", "Paranoid", "Agile"],
        wants: "Steal valuables from unsuspecting crowds",
        needs: "Escape guard detection and find black markets",
        desires: "Secure one massive score to retire in luxury",
        portrait: "https://files.catbox.moe/k6bhpb.jpg",
        baseAffinity: 30
    },
    scholar: {
        archetype: "Scholar",
        tags: ["Intellectual", "Older Female", "High Wealth"],
        habits: ["Introvert", "Absent-minded", "Curious"],
        wants: "Uncover ancient lore and mysterious history",
        needs: "Quiet hours to study fragile codex scripts",
        desires: "Solve the ultimate cosmic puzzle of the ancients",
        portrait: "https://files.catbox.moe/4e8b8p.jpg",
        baseAffinity: 60
    }
};

/**
 * Initialize dynamic states for active generic NPCs in this session
 */
export function ensureGenericNpcsState(s) {
    s.genericNpcs = s.genericNpcs || {};
    s.genericNpcs.active = s.genericNpcs.active || {};
    
    // Instances are created per game. Archetypes remain templates, never automatic cast members.
    return s.genericNpcs;
}

/**
 * Autopilot Probability Engine — Rolls background Wants/Needs/Desires ticks when time advances.
 * Simulated off-screen activities that get injected into dialogue.
 */
export function rollOffScreenNpcAutopilot(minutesPassed) {
    const s = getSettings();
    ensureGenericNpcsState(s);
    
    const active = s.genericNpcs.active;
    let anyChange = false;

    Object.entries(active).forEach(([key, npc]) => {
        // 20% base probability per game hour that something happens off-screen
        const probability = (minutesPassed / 60) * 0.22;
        if (Math.random() < probability) {
            anyChange = true;
            let logMsg = "";
            
            switch (npc.archetype) {
                case "Thief":
                    const stolen = Math.random() > 0.4 ? "a silver pocketwatch" : "a heavy purse of coin";
                    logMsg = `Successfully pickpocketed ${stolen} off-screen in a crowded alley.`;
                    npc.wants = "Hide the stolen goods and avoid the guard patrol.";
                    break;
                case "Guard":
                    const fight = Math.random() > 0.5 ? "detained a suspicious thief" : "broke up a rowdy tavern brawl";
                    logMsg = `Patrolled the perimeter and ${fight}.`;
                    npc.needs = "Get some strong coffee to stay alert.";
                    break;
                case "Bartender":
                    const rumor = Math.random() > 0.5 ? "a merchant shipping route collapse" : "strange glowing runes in the nearby ruins";
                    logMsg = `Overheard gossip from a regular customer about ${rumor}.`;
                    npc.wants = "Share this juicy piece of news with the next curious traveller.";
                    break;
                case "Vendor":
                    const price = Math.random() > 0.5 ? "negotiated a 15% discount on textiles" : "sold a rare trinket for double retail price";
                    logMsg = `Finished a trade wholesale deal: ${price}.`;
                    npc.wants = "Celebrate by having a fine dinner.";
                    break;
                case "Scholar":
                    const discovery = Math.random() > 0.4 ? "translated three lines of a sylvan tablet" : "found a misplaced journal in the archive stacks";
                    logMsg = `Made academic progress: ${discovery}.`;
                    npc.wants = "Verify this discovery with external world references.";
                    break;
            }
            
            if (logMsg) {
                npc.recentEvents.unshift({
                    text: logMsg,
                    ts: Date.now()
                });
                // Keep history compact
                npc.recentEvents = npc.recentEvents.slice(0, 3);
            }
        }
    });

    if (anyChange) {
        saveSettings();
    }
}

/**
 * Open the "Decorate" Upgrade UI Modal
 * Elevates a cardless background NPC into a permanent custom Main Cast member card!
 */
export function openDecorateModal(npcId) {
    const s = getSettings();
    ensureGenericNpcsState(s);
    
    const npc = s.genericNpcs.active[npcId];
    if (!npc) return;

    // Create Modal HTML Structure if not present
    let modal = document.getElementById("uie-decorate-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "uie-decorate-modal";
        modal.className = "modal-overlay";
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(57, 34, 20, 0.34); display: flex; align-items: center;
            justify-content: center; z-index: 15000; font-family: 'Inter', system-ui, sans-serif;
            backdrop-filter: blur(10px);
        `;
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="modal-card" style="
            width: 480px; max-width: 95vw; background: #fff8ed;
            border: 1px solid rgba(151,91,39,0.46); border-radius: 16px; padding: 24px;
            box-shadow: 0 20px 60px rgba(57,34,20,0.28); color: #392214;
            display: flex; flex-direction: column; gap: 16px;
        ">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(151,91,39,0.28); padding-bottom:12px;">
                <h3 style="margin: 0; font-size: 18px; font-weight:800; color:#5c3a21; text-transform:uppercase; letter-spacing:0.05em;">🎭 Elevate to Main Cast</h3>
                <button id="dec-close" style="background:none; border:none; color:#5c3a21; cursor:pointer; font-size:18px;"><i class="fas fa-times"></i></button>
            </div>
            
            <div style="display:flex; gap:16px; align-items:center;">
                <div id="dec-avatar-preview" style="
                    width: 72px; height: 72px; border-radius: 50%;
                    border: 2px solid #c9853d; background-image: url('${npc.portrait}');
                    background-size: cover; background-position: center; cursor: pointer;
                    display:flex; align-items:center; justify-content:center;
                " title="Click to upload sprite image">
                </div>
                <div>
                    <strong style="font-size: 15px; color:#392214;">${npc.name}</strong>
                    <div style="font-size:12px; color:#80512d; margin-top:2px;">Archetype: [${npc.tags.join(", ")}]</div>
                </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:6px;">
                <label style="font-size:12px; color:#5c3a21; font-weight:700;">Assign Custom Name</label>
                <input id="dec-custom-name" type="text" class="modal-input" value="${npc.name === npc.archetype ? '' : npc.name}" placeholder="Enter unique name..." style="background:#fffdf7; border:1.5px solid rgba(151,91,39,0.5); color:#392214; padding:8px 12px; border-radius:6px; font-size:13px;">
            </div>

            <div style="display:flex; flex-direction:column; gap:6px;">
                <label style="font-size:12px; color:#5c3a21; font-weight:700;">Select Visual Sprite (Optional)</label>
                <input id="dec-file" type="file" accept="image/*" style="display:none;">
                <button id="dec-file-btn" style="background:#fff4e3; border:1px solid rgba(151,91,39,0.35); color:#5c3a21; padding:8px 12px; border-radius:6px; cursor:pointer; font-size:12px; text-align:left; display:flex; align-items:center; gap:8px;">
                    <i class="fas fa-upload"></i> Upload PNG or JPG image...
                </button>
            </div>

            <div style="display:flex; flex-direction:column; gap:6px;">
                <label style="font-size:12px; color:#5c3a21; font-weight:700;">Set Affinity Relationship</label>
                <select id="dec-affinity" style="background:#fffdf7; border:1.5px solid rgba(151,91,39,0.5); color:#392214; padding:8px; border-radius:6px; font-size:13px;">
                    <option value="50" ${npc.affinity >= 40 && npc.affinity < 70 ? 'selected' : ''}>Neutral (Bronze Ring)</option>
                    <option value="80" ${npc.affinity >= 70 ? 'selected' : ''}>Friend (Green Ring)</option>
                    <option value="20" ${npc.affinity < 40 ? 'selected' : ''}>Rival / Foe (Red Ring)</option>
                </select>
            </div>

            <div style="font-size:11px; color:#80512d; line-height:1.45; background:#fff1db; padding:10px; border-radius:6px; border:1px solid rgba(151,91,39,0.26);">
                💡 <strong>AUTOPILOT PROFILE:</strong> ${npc.wants}. 
                ${npc.recentEvents.length > 0 ? `<br><strong>RECENT:</strong> ${npc.recentEvents[0].text}` : ''}
            </div>

            <button id="dec-elevate-btn" class="crt-btn" style="
                background: linear-gradient(135deg, #00f0ff 0%, #0072ff 100%);
                color: #fff; border: none; padding: 12px; border-radius: 8px;
                font-weight: 800; cursor: pointer; text-transform: uppercase;
                letter-spacing: 0.05em; margin-top: 8px; box-shadow: 0 0 10px rgba(0, 240, 255, 0.25);
            ">Elevate to Main Cast Card</button>
        </div>
    `;

    modal.style.display = "flex";

    // Bind Event Listeners
    $("#dec-close").on("click", () => modal.style.display = "none");
    
    // File upload binding
    let base64Sprite = npc.portrait;
    $("#dec-file-btn, #dec-avatar-preview").on("click", () => $("#dec-file").click());
    $("#dec-file").on("change", function() {
        const f = this.files && this.files[0] ? this.files[0] : null;
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
            base64Sprite = reader.result;
            $("#dec-avatar-preview").css("background-image", `url("${base64Sprite}")`);
        };
        reader.readAsDataURL(f);
    });

    // Elevate Button
    $("#dec-elevate-btn").on("click", () => {
        const customName = $("#dec-custom-name").val().trim() || npc.name;
        const affVal = parseInt($("#dec-affinity").val()) || 50;

        npc.name = customName;
        npc.portrait = base64Sprite;
        npc.affinity = affVal;

        // 1. Save social card relation in s.social
        const group = affVal >= 70 ? "friends" : affVal <= 30 ? "rivals" : "associates";
        s.social = s.social || {};
        s.social[group] = s.social[group] || [];
        
        // Remove from other groups if exists
        ["friends", "associates", "romance", "family", "rivals"].forEach(g => {
            if (Array.isArray(s.social[g])) {
                s.social[g] = s.social[g].filter(x => String(x.name || "").toLowerCase() !== customName.toLowerCase());
            }
        });

        s.social[group].push({
            name: customName,
            avatar: base64Sprite,
            affinity: affVal,
            location: s.worldState?.location || "Starting Location",
            notes: `Elevated from a generic ${npc.archetype} archetype.`
        });

        // 2. Create custom Character Card inside s.personas
        s.personas = s.personas || [];
        const personaId = `persona_${npc.id}_${Date.now()}`;
        const newPersona = {
            id: personaId,
            name: customName,
            role: npc.archetype,
            avatar: base64Sprite,
            bio: `A prominent character in the world.\n\nArchetype: [${npc.tags.join(", ")}]\nHabits: ${npc.habits.join(", ")}\nWants: ${npc.wants}\nNeeds: ${npc.needs}\nDesires: ${npc.desires}`,
            affinity: affVal,
            expressions: {},
            createdAt: Date.now()
        };
        s.personas.push(newPersona);

        saveSettings();
        modal.style.display = "none";
        
        // Refresh scene targets dropdown
        if (typeof window.setRoomHotspotsVisibility === "function") window.setRoomHotspotsVisibility();
        
        notify("success", `✨ Elevated ${customName} to a permanent character card!`, "UIE");
        showToast(`✨ ${customName} is now in your Main Cast!`);
    });
}
