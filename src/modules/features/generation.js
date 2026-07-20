import { getSettings, saveSettings } from "../core.js";
import { generateContent } from "../apiClient.js";
import { addInventoryItemWithStack } from "../inventoryItems.js";
import { pollLocationImageAsset, requestLocationImageAsset } from "../serverAssets.js";

function ensureGenerateModal() {
    if (document.getElementById("uie-modal-generate")) return;
    const modal = document.createElement("div");
    modal.id = "uie-modal-generate";
    modal.style.cssText = "display:none; position:fixed; inset:0; z-index:2147483645; background:rgba(2,5,15,0.82); backdrop-filter:blur(8px); align-items:center; justify-content:center;";
    modal.innerHTML = `
      <div style="width:min(560px,96vw); border-radius:16px; border:1px solid rgba(203,163,92,0.35); background:linear-gradient(155deg,rgba(18,12,22,0.99),rgba(8,12,26,0.99)); color:#f0e8d8; padding:28px 30px; box-shadow:0 28px 80px rgba(0,0,0,0.8); font-family:Inter,system-ui,sans-serif;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:22px;">
          <div>
            <div style="font-size:11px; font-weight:900; letter-spacing:.14em; text-transform:uppercase; color:#cba35c; margin-bottom:4px;">✨ AI Forge</div>
            <h2 style="margin:0; font-size:22px; color:#fff;">Generate Something</h2>
          </div>
          <button id="uie-modal-generate-close" style="width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#fff;font-size:16px;cursor:pointer;">✕</button>
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block; font-size:12px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; color:rgba(240,232,216,0.7); margin-bottom:8px;">What do you want to generate?</label>
          <select id="gen-type" style="width:100%; padding:11px 14px; border-radius:10px; border:1px solid rgba(203,163,92,0.28); background:rgba(5,8,18,0.8); color:#f0e8d8; font-size:14px; font-weight:700; cursor:pointer;">
            <option value="skill">🌟 Skill — A new ability for the skill tree</option>
            <option value="item">🎒 Item — A consumable, material, or tool</option>
            <option value="equipment">⚔️ Equipment — Weapon, armor, or accessory</option>
            <option value="rune">💎 Rune — A magical enchantment rune</option>
            <option value="quest">📜 Quest — A mission or objective</option>
            <option value="lore">📖 Lore — A lore entry for the lorebook</option>
            <option value="location">🗺️ Location — A new map location</option>
          </select>
        </div>
        <div style="margin-bottom:8px;">
          <label style="display:block; font-size:12px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; color:rgba(240,232,216,0.7); margin-bottom:8px;">Description / Concept</label>
          <textarea id="gen-desc" rows="4" placeholder="Describe what you want... e.g. 'A dark fire skill that burns enemies over time and has 3 charges' or 'A poisoned dagger from the ancient guild'" style="width:100%; padding:11px 14px; border-radius:10px; border:1px solid rgba(203,163,92,0.28); background:rgba(5,8,18,0.8); color:#f0e8d8; font-size:13px; resize:vertical; line-height:1.5; box-sizing:border-box;"></textarea>
        </div>
        <div id="gen-type-hint" style="font-size:11px; color:rgba(203,163,92,0.8); margin-bottom:18px; min-height:16px;">💡 Tip: Be descriptive! The AI uses your description to craft something fitting your current character and world.</div>
        <div style="display:flex; gap:10px; justify-content:flex-end;">
          <button id="uie-modal-generate-cancel" style="padding:10px 20px; border-radius:8px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.04); color:#aaa; font-weight:700; cursor:pointer;">Cancel</button>
          <button id="btn-do-generate" style="padding:10px 28px; border-radius:8px; border:1px solid rgba(203,163,92,0.45); background:linear-gradient(135deg,rgba(203,163,92,0.22),rgba(180,130,60,0.18)); color:#ffd06f; font-weight:900; font-size:14px; cursor:pointer;">✨ Generate</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Type-specific hints
    const hints = {
        skill: "💡 Skills go to your Skill Tree (Inventory → Skills tab). Name it, describe its effect and type (active/passive).",
        item: "💡 Items appear in your Inventory. Describe rarity, use, and any special effects.",
        equipment: "💡 Equipment appears in your Inventory. Specify slot: weapon, armor, head, chest, feet, or accessory.",
        rune: "💡 Runes are magical enchantments. Describe the school of magic and what it does when used.",
        quest: "💡 Quests appear in your Journal. Describe the goal, stakes, and any reward.",
        lore: "💡 Lore entries go into your Lorebook for the AI to reference. Describe a place, person, or world fact.",
        location: "💡 Locations are added to the World Map. Describe where it is, what's there, and its vibe.",
    };
    modal.querySelector("#gen-type").addEventListener("change", function() {
        modal.querySelector("#gen-type-hint").textContent = hints[this.value] || "";
    });

    function closeModal() { modal.style.display = "none"; }
    modal.querySelector("#uie-modal-generate-close").addEventListener("click", closeModal);
    modal.querySelector("#uie-modal-generate-cancel").addEventListener("click", closeModal);
    modal.addEventListener("click", function(e) { if (e.target === modal) closeModal(); });
}

export function init() {
    ensureGenerateModal();
    const doc = $(document);

    // Open Modal
    doc.off("click", "#uie-btn-generate").on("click", "#uie-btn-generate", () => {
        ensureGenerateModal();
        const modal = document.getElementById("uie-modal-generate");
        if (modal) { modal.style.display = "flex"; }
    });

    // Execute Generation
    doc.off("click", "#btn-do-generate").on("click", "#btn-do-generate", async function() {
        const type = $("#gen-type").val();
        const desc = $("#gen-desc").val();
        if (!desc) {
            if (window.toastr) toastr.warning("Please describe what you want to generate.");
            return;
        }

        const btn = $(this);
        const originalHtml = btn.html();
        btn.html("✨ Forging...").prop("disabled", true);

        const prompts = {
            item: `Generate Item "${desc}". JSON: { "name": "String", "type": "consumable/tool/book/material", "description": "String", "effect": "String", "rarity": "common/rare/legendary", "qty": 1 }`,
            equipment: `Generate Equipment "${desc}". JSON: { "name": "String", "type": "weapon/armor/accessory", "slotCategory": "Head/Chest/Feet/Main Hand/Accessory", "description": "String", "effect": "String", "rarity": "common/rare/legendary" }`,
            skill: `Generate a Skill for "${desc}". Return ONLY valid JSON with keys: { "name": "String", "skillType": "active" or "passive", "description": "String", "level": 1, "branch": "String (the skill tree branch name)", "mastery": 0, "affinity": "String", "prerequisites": [], "unlockRule": "String explaining how to unlock", "icon": "String (2-4 char abbreviation)" }`,
            rune: `Generate Rune "${desc}". JSON: { "name": "String", "kind": "item", "type": "rune", "category": "rune", "slotCategory": "ENCHANTMENT", "school": "String", "useMode": "single|multiple|unlimited", "charges": 1, "description": "String", "effects": ["String"], "statusEffects": ["String"], "cost": "String", "runeLock": { "mode": "auto|key|seal|none", "canUnlock": true, "canSeal": false, "gameMayPlaceLocks": true }, "tags": ["rune","magic"], "rarity": "common|rare|legendary", "qty": 1 }`,
            quest: `Generate Quest "${desc}". JSON: { "title": "String", "description": "String", "status": "active", "objectives": ["String"], "reward": "String" }`,
            lore: `Generate Lore Entry "${desc}". JSON: { "key": ["keyword"], "comment": "String", "content": "String", "constant": false }`,
            location: `Generate Location "${desc}". JSON: { "name": "String", "type": "interior/exterior/region", "description": "String", "exits": {}, "interactions": ["observe", "search"] }`
        };
        let prompt = prompts[type] || `Generate ${type}: "${desc}". JSON only.`;

        try {
            const res = await generateContent(prompt, "System Check");
            // Clean markdown if present
            if (!res) throw new Error("Empty response from AI");
            const cleanRes = String(res).replace(/```json|```/g, "").trim();
            // Find JSON bounds robustly
            const jsonStart = cleanRes.indexOf("{");
            const jsonEnd = cleanRes.lastIndexOf("}");
            const jsonStr = jsonStart >= 0 && jsonEnd > jsonStart ? cleanRes.slice(jsonStart, jsonEnd + 1) : cleanRes;
            const data = JSON.parse(jsonStr);
            const s = getSettings();

            if (!s.inventory) s.inventory = {};
            if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
            if (!Array.isArray(s.inventory.skills)) s.inventory.skills = [];

            if (type === "item" || type === "equipment" || type === "rune") {
                if (!s.inventory) s.inventory = {};
                if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
                if (type === "rune") {
                    data.kind = "item";
                    data.type = "rune";
                    data.category = "rune";
                    data.slotCategory = data.slotCategory || "ENCHANTMENT";
                    data.tags = Array.from(new Set([...(Array.isArray(data.tags) ? data.tags : []), "rune", "magic"]));
                    if (!data.runeLock || typeof data.runeLock !== "object") data.runeLock = { mode: "auto", canUnlock: true, canSeal: false, gameMayPlaceLocks: true };
                    if (!Array.isArray(s.inventory.runes)) s.inventory.runes = [];
                    if (!s.magic || typeof s.magic !== "object") s.magic = {};
                    if (!Array.isArray(s.magic.runes)) s.magic.runes = [];
                    s.inventory.runes.push({ ...data });
                    s.magic.runes.push({ ...data });
                }
                addInventoryItemWithStack(s.inventory.items, data, { source: "generation" });
            } else if (type === "skill") {
                // Normalize skill so it's compatible with the skill tree
                const skill = {
                    kind: "skill",
                    name: String(data.name || "Generated Skill").trim(),
                    description: String(data.description || "").trim(),
                    skillType: String(data.skillType || data.type || "active").toLowerCase() === "passive" ? "passive" : "active",
                    level: "1",
                    branch: String(data.branch || "Generated").trim(),
                    mastery: 0,
                    affinity: String(data.affinity || "").trim(),
                    prerequisites: Array.isArray(data.prerequisites) ? data.prerequisites : [],
                    unlockRule: String(data.unlockRule || "").trim(),
                    icon: String(data.icon || "GEN").trim().slice(0, 4),
                    x: null,
                    y: null,
                };
                s.inventory.skills.push(skill);
                if (!Array.isArray(s.skills)) s.skills = [];
                s.skills.push(skill);
            } else if (type === "quest") {
                if (!s.journal) s.journal = {};
                if (!Array.isArray(s.journal.quests)) s.journal.quests = [];
                s.journal.quests.push(data);
            } else if (type === "lore") {
                if (!Array.isArray(s.lorebooks)) s.lorebooks = [];
                let book = s.lorebooks.find((b) => b.name === "Generated Lore");
                if (!book) {
                    book = { name: "Generated Lore", enabled: true, entries: {} };
                    s.lorebooks.push(book);
                }
                const id = `gen_${Date.now().toString(16)}`;
                book.entries[id] = { uid: id, ...data };
            } else if (type === "location") {
                if (!s.worldState) s.worldState = {};
                if (!s.worldState.mapNodes || typeof s.worldState.mapNodes !== "object") s.worldState.mapNodes = {};
                if (!s.worldState.navGraph || typeof s.worldState.navGraph !== "object") s.worldState.navGraph = {};
                const name = String(data.name || "Generated Location").trim();
                s.worldState.mapNodes[name] = { ...data, name, exits: data.exits || {}, interactions: data.interactions || ["observe"] };
                s.worldState.navGraph[name] = data.exits || {};
                void requestLocationImageAsset(name, s.worldState.mapNodes[name], {
                    kind: "thumbnail",
                    source: "generated_location",
                    timeoutMs: 1000,
                }).then((asset) => {
                    if (asset?.status && asset.status !== "ready") {
                        pollLocationImageAsset(name, asset.asset_id, s.worldState.mapNodes[name], { kind: "thumbnail" });
                    }
                });
            }

            saveSettings();
            try { window.dispatchEvent(new CustomEvent("uie:state_updated")); } catch (_) {}
            const modal = document.getElementById("uie-modal-generate");
            if (modal) modal.style.display = "none";
            // Clear the description for next use
            const descEl = document.getElementById("gen-desc");
            if (descEl) descEl.value = "";
            const typeLabel = { skill: "Skill", item: "Item", equipment: "Equipment", rune: "Rune", quest: "Quest", lore: "Lore Entry", location: "Location" }[type] || type;
            if (window.toastr) toastr.success(`${typeLabel} generated and added! Check your Inventory or Skill Tree.`, "✨ Generation Complete");
        } catch(e) {
            console.error("Generation Failed", e);
            if (window.toastr) toastr.error(`Generation failed: ${String(e?.message || e || "Unknown error")}. Make sure your API key is configured in API / Image Keys.`, "Generation Error");
        }

        btn.html(originalHtml).prop("disabled", false);
    });
}
