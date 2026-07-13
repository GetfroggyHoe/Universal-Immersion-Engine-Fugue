import { getSettings, saveSettings } from "../core.js";
import { generateContent } from "../apiClient.js";
import { addInventoryItemWithStack } from "../inventoryItems.js";
import { pollLocationImageAsset, requestLocationImageAsset } from "../serverAssets.js";

export function init() {
    const doc = $(document);

    // Open Modal
    doc.off("click", "#uie-btn-generate").on("click", "#uie-btn-generate", () => {
        $("#uie-modal-generate").fadeIn();
    });

    // Execute Generation
    doc.off("click", "#btn-do-generate").on("click", "#btn-do-generate", async function() {
        const type = $("#gen-type").val();
        const desc = $("#gen-desc").val();
        if(!desc) return;

        const btn = $(this);
        const originalText = btn.text();
        btn.text("Forging...").prop("disabled", true);

        const prompts = {
            item: `Generate Item "${desc}". JSON: { "name": "String", "type": "consumable/tool/book/material", "description": "String", "effect": "String", "rarity": "common/rare/legendary", "qty": 1 }`,
            equipment: `Generate Equipment "${desc}". JSON: { "name": "String", "type": "weapon/armor/accessory", "slotCategory": "Head/Chest/Feet/Main Hand/Accessory", "description": "String", "effect": "String", "rarity": "common/rare/legendary" }`,
            skill: `Generate Skill "${desc}". JSON: { "name": "String", "type": "active/passive", "description": "String", "cost": "String", "cooldown": "String" }`,
            rune: `Generate Rune "${desc}". JSON: { "name": "String", "kind": "item", "type": "rune", "category": "rune", "slotCategory": "ENCHANTMENT", "school": "String", "useMode": "single|multiple|unlimited", "charges": 1, "description": "String", "effects": ["String"], "statusEffects": ["String"], "cost": "String", "runeLock": { "mode": "auto|key|seal|none", "canUnlock": true, "canSeal": false, "gameMayPlaceLocks": true }, "tags": ["rune","magic"], "rarity": "common|rare|legendary", "qty": 1 }`,
            quest: `Generate Quest "${desc}". JSON: { "title": "String", "description": "String", "status": "active", "objectives": ["String"], "reward": "String" }`,
            lore: `Generate Lore Entry "${desc}". JSON: { "key": ["keyword"], "comment": "String", "content": "String", "constant": false }`,
            location: `Generate Location "${desc}". JSON: { "name": "String", "type": "interior/exterior/region", "description": "String", "exits": {}, "interactions": ["observe", "search"] }`
        };
        let prompt = prompts[type] || `Generate ${type}: "${desc}". JSON only.`;

        try {
            const res = await generateContent(prompt, "System Check");
            // Clean markdown if present
            if (!res) throw new Error("Empty response");
            const cleanRes = String(res).replace(/```json|```/g, "").trim();
            const data = JSON.parse(cleanRes);
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
                s.inventory.skills.push(data);
                if (!Array.isArray(s.skills)) s.skills = [];
                s.skills.push(data);
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
            $("#uie-modal-generate").fadeOut();
            if(window.toastr) toastr.success(`${type} Generated`);
        } catch(e) {
            console.error("Generation Failed", e);
            if(window.toastr) toastr.error("Generation Failed");
        }

        btn.text(originalText).prop("disabled", false);
    });
}
