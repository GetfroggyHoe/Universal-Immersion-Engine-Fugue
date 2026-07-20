import { getSettings, commitStateUpdate, isMobileUI } from "./core.js";
import { injectRpEvent } from "./features/rp_log.js";
import { generateContent } from "./apiClient.js";
import { notify } from "./notifications.js";
import { applyItemGiftToContact } from "./social.js";
import { MEDALLIONS } from "./inventory.js";
import { SCAN_TEMPLATES } from "./scanTemplates.js";
import { normalizeLifeTracker } from "./features/life.js";
import { DEFAULT_PARTY_PORTRAITS, resolvePartyPortraitUrl } from "./partyPortraits.js";
import { spawnStageSprite } from "./sprites.js";
import { normalizeStatusList, formatRemaining, summarizeMods, statusKey } from "./statusFx.js";
import { fitDesktopModal } from "./modalViewport.js";

let selectedId = null;
/** `"shared"` or `"member:<id>"` — party inventory tab target list */
let partyInventoryTarget = "shared";
let partyAttributeEditMode = false;
let tab = "stats";
let partyCurrentLayerIndex = 3; // ARMOR default

const COMPANION_LAYERS = [
  { name: "OUTFITS", type: "outfits", slots: [] },
  { name: "INNER", slots: [
    { id:"undies", side:"left", icon:"fa-venus-mars" },
    { id:"socks", side:"left", icon:"fa-socks" },
    { id:"tattoo", side:"left", icon:"fa-dragon" },
    { id:"scar", side:"left", icon:"fa-heart-crack" },
    { id:"ears", side:"right", icon:"fa-ear-listen" },
    { id:"face", side:"right", icon:"fa-face-smile" },
    { id:"ink", side:"right", icon:"fa-wand-sparkles" },
    { id:"soul", side:"right", icon:"fa-ghost" }
  ]},
  { name: "CLOTH", slots: [
    { id:"shirt", side:"left", icon:"fa-shirt" },
    { id:"vest", side:"left", icon:"fa-box" },
    { id:"gloves", side:"left", icon:"fa-hand" },
    { id:"aura", side:"left", icon:"fa-star" },
    { id:"pants", side:"right", icon:"fa-user" },
    { id:"belt", side:"right", icon:"fa-grip-lines" },
    { id:"boots", side:"right", icon:"fa-shoe-prints" },
    { id:"bag", side:"right", icon:"fa-bag-shopping" }
  ]},
  { name: "ARMOR", slots: [
    { id:"head", side:"left", icon:"fa-hard-hat" },
    { id:"chest", side:"left", icon:"fa-shield" },
    { id:"legs", side:"left", icon:"fa-person" },
    { id:"feet", side:"left", icon:"fa-shoe-prints" },
    { id:"hands", side:"right", icon:"fa-hand-fist" },
    { id:"shldr", side:"right", icon:"fa-user-shield" },
    { id:"back", side:"right", icon:"fa-feather" },
    { id:"neck", side:"right", icon:"fa-link" }
  ]},
  { name: "GEAR", slots: [
    { id:"main", side:"left", icon:"fa-hammer" },
    { id:"off", side:"left", icon:"fa-shield-halved" },
    { id:"range", side:"left", icon:"fa-crosshairs" },
    { id:"ammo", side:"left", icon:"fa-bullseye" },
    { id:"tool", side:"left", icon:"fa-screwdriver-wrench" },
    { id:"relic", side:"left", icon:"fa-gem" },
    { id:"r1", side:"right", icon:"fa-gem" },
    { id:"r2", side:"right", icon:"fa-gem" },
    { id:"trinket", side:"right", icon:"fa-star" },
    { id:"focus", side:"right", icon:"fa-wand-sparkles" },
    { id:"quick", side:"right", icon:"fa-bolt" },
    { id:"utility", side:"right", icon:"fa-toolbox" }
  ]}
];

function getCustomEquipmentSlots(s) {
    if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
    if (!Array.isArray(s.inventory.customEquipmentSlots)) s.inventory.customEquipmentSlots = [];
    return s.inventory.customEquipmentSlots
        .map((slot, index) => {
            const label = String(slot?.label || slot?.name || "").trim().slice(0, 40);
            const id = String(slot?.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
            if (!label || !id) return null;
            return { id, label, side: index % 2 ? "right" : "left", icon: String(slot?.icon || "fa-gem"), custom: true };
        })
        .filter(Boolean);
}

function addCustomEquipmentSlot(s, rawLabel) {
    const label = String(rawLabel || "").trim().slice(0, 40);
    if (!label) return null;
    const current = getCustomEquipmentSlots(s);
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "custom_slot";
    const used = new Set([...COMPANION_LAYERS.flatMap((layer) => layer.slots.map((slot) => slot.id)), ...current.map((slot) => slot.id)]);
    let id = `custom_${base}`;
    let suffix = 2;
    while (used.has(id)) id = `custom_${base}_${suffix++}`;
    s.inventory.customEquipmentSlots.push({ id, label, icon: "fa-gem" });
    return id;
}

let memberModalOpen = false;
let memberEdit = false;
let memberModalTab = "sheet";
let memberModalOpenedAt = 0;
let ignoreNextBackdropClick = false;
let partyInit = false;
let trackerModalEditId = "";

function saveSettings() {
    commitStateUpdate({ emit: true, domain: "party" });
}

const CLASS_TREE_PROFILES = {
    Warrior: { keywords: ["warrior", "knight", "fighter", "guardian", "soldier"], stat: "str", support: "con", icon: "fa-solid fa-shield-halved", core: ["Opening Strike", "Guarded Footwork", "Breaker Stance", "Veteran's Resolve"] },
    Mage: { keywords: ["mage", "wizard", "sorcerer", "witch", "arcanist"], stat: "int", support: "wis", icon: "fa-solid fa-hat-wizard", core: ["Spark Theory", "Arcane Guard", "Elemental Surge", "Mana Confluence"] },
    Rogue: { keywords: ["rogue", "thief", "assassin", "scout", "ninja"], stat: "dex", support: "luk", icon: "fa-solid fa-mask", core: ["Silent Entry", "Evasive Step", "Critical Angle", "Shadow Contract"] },
    Priest: { keywords: ["priest", "cleric", "healer", "monk", "oracle"], stat: "wis", support: "cha", icon: "fa-solid fa-hands-praying", core: ["Mending Touch", "Sanctuary", "Bright Edict", "Grace Overflow"] },
    Bard: { keywords: ["bard", "singer", "musician", "idol", "performer"], stat: "cha", support: "dex", icon: "fa-solid fa-music", core: ["Opening Verse", "Harmonic Guard", "Captive Chorus", "Encore Technique"] },
    Adventurer: { keywords: [], stat: "dex", support: "str", icon: "fa-solid fa-compass", core: ["Field Instinct", "Steady Hand", "Adaptive Gambit", "Lucky Break"] }
};

let currentEditingNode = null;
let currentEditingMember = null;

function createTreeNodeId(prefix = "node") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function detectSkillTreeClass(m) {
    const cls = String(m?.identity?.class || m?.className || m?.role || "").trim();
    const lower = cls.toLowerCase();
    for (const [key, profile] of Object.entries(CLASS_TREE_PROFILES)) {
        if (profile.keywords.some((kw) => lower.includes(kw))) return key;
    }
    return CLASS_TREE_PROFILES[cls] ? cls : "Adventurer";
}

function sceneContextWords(s, m) {
    const ctx = getRuntimeContext();
    const raw = [
        s?.worldState?.playerLocation,
        s?.worldState?.currentLocation,
        s?.player?.location,
        ctx?.location,
        ctx?.scene,
        ctx?.summary,
        m?.bio,
        m?.notes
    ].map((x) => String(x || "")).join(" ");
    const words = raw.toLowerCase().match(/[a-z][a-z'-]{3,}/g) || [];
    const stop = new Set(["with", "from", "that", "this", "there", "their", "about", "character", "party", "scene"]);
    return Array.from(new Set(words.filter((w) => !stop.has(w)).slice(0, 10)));
}

function titleCaseWords(value) {
    return String(value || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function normalizeTreeNode(raw, fallback = {}) {
    const rawType = String(raw?.type || raw?.skillType || fallback.type || "active").toLowerCase();
    const type = ["active", "passive", "utility", "reaction", "toggle"].includes(rawType) ? rawType : "active";
    const custom = raw?.custom === true || fallback.custom === true;
    const category = ({
        passive: "Passive",
        utility: "Utility",
        reaction: "Reaction",
        toggle: "Toggle",
        active: "Active"
    }[type] || "Active");
    return {
        id: String(raw?.id || fallback.id || createTreeNodeId("skill")).trim(),
        name: String(raw?.name || raw?.title || fallback.name || "New Skill").trim().slice(0, 80) || "New Skill",
        type,
        cost: Math.max(1, Math.min(9, Number.parseInt(raw?.cost ?? fallback.cost ?? 1, 10) || 1)),
        stats: String(raw?.stats || fallback.stats || "").trim(),
        desc: String(raw?.desc || raw?.description || fallback.desc || "").trim(),
        // Categories are intentionally derived from skill behavior. Legacy branch
        // names (Class Core, Known Skills, Scene Context) are migrated here.
        branch: category,
        icon: String(raw?.icon || fallback.icon || (type === "passive" ? "fa-solid fa-shield" : "fa-solid fa-bolt")).trim(),
        requires: Array.isArray(raw?.requires) ? raw.requires.map(String).filter(Boolean) : (Array.isArray(fallback.requires) ? fallback.requires : []),
        unlocked: raw?.unlocked === true,
        custom
    };
}

function generatedSkillTreeNodes(s, m) {
    const key = detectSkillTreeClass(m);
    const profile = CLASS_TREE_PROFILES[key] || CLASS_TREE_PROFILES.Adventurer;
    const context = sceneContextWords(s, m);
    const rootId = `auto_${key.toLowerCase()}_root`;
    const nodes = [
        normalizeTreeNode({
            id: rootId,
            name: `${key} Foundation`,
            type: "passive",
            cost: 1,
            stats: `${profile.stat}:+1, ${profile.support}:+1`,
            desc: `The core posture and habits of a ${key.toLowerCase()}.`,
            branch: "Passive",
            icon: profile.icon
        })
    ];

    profile.core.slice(1).forEach((name, idx) => {
        const id = `auto_${key.toLowerCase()}_core_${idx + 1}`;
        nodes.push(normalizeTreeNode({
            id,
            name,
            type: idx % 2 ? "active" : "passive",
            cost: idx < 1 ? 1 : 2,
            stats: idx % 2 ? `${profile.stat}:+${idx + 2}` : `${profile.support}:+${idx + 2}`,
            desc: `${key} class technique generated from class style.`,
            branch: idx % 2 ? "Active" : "Passive",
            icon: idx % 2 ? "fa-solid fa-bolt" : profile.icon,
            requires: [idx === 0 ? rootId : `auto_${key.toLowerCase()}_core_${idx}`]
        }));
    });

    const naturalSkills = (Array.isArray(m?.skills) ? m.skills : [])
        .filter((sk) => sk && sk.source !== "SkillTree")
        .slice(0, 4);
    naturalSkills.forEach((sk, idx) => {
        const type = String(sk.skillType || sk.type || "active").toLowerCase() === "passive" ? "passive" : "active";
        nodes.push(normalizeTreeNode({
            id: `auto_${key.toLowerCase()}_known_${idx}`,
            name: sk.name || `Known Skill ${idx + 1}`,
            type,
            cost: idx < 2 ? 1 : 2,
            stats: type === "passive" ? `${profile.support}:+2` : `${profile.stat}:+2`,
            desc: sk.description || sk.desc || "A known skill folded into this member's class tree.",
            branch: type === "passive" ? "Passive" : "Active",
            icon: type === "passive" ? "fa-solid fa-gem" : "fa-solid fa-bolt",
            requires: [idx === 0 ? rootId : `auto_${key.toLowerCase()}_known_${idx - 1}`]
        }));
    });

    const contextNames = (context.length ? context : ["Scene", "Travel", "Social"]).slice(0, 3);
    contextNames.forEach((word, idx) => {
        nodes.push(normalizeTreeNode({
            id: `auto_${key.toLowerCase()}_context_${idx}`,
            name: `${titleCaseWords(word)} Sense`,
            type: idx === 1 ? "active" : "passive",
            cost: idx === 2 ? 2 : 1,
            stats: idx === 1 ? `${profile.stat}:+2` : `${profile.support}:+1`,
            desc: `Context skill generated from the current story/world setup.`,
            branch: idx === 1 ? "Active" : "Passive",
            icon: idx === 1 ? "fa-solid fa-location-crosshairs" : "fa-solid fa-eye",
            requires: [idx === 0 ? rootId : `auto_${key.toLowerCase()}_context_${idx - 1}`]
        }));
    });

    return nodes;
}

function mergeGeneratedSkillTree(s, m) {
    const generated = generatedSkillTreeNodes(s, m);
    const existing = Array.isArray(m?.skillTree?.nodes) ? m.skillTree.nodes : [];
    const byName = new Map(existing.map((n) => [String(n?.name || "").toLowerCase(), n]));
    const byId = new Map(existing.map((n) => [String(n?.id || ""), n]));
    const merged = generated.map((node) => {
        const old = byId.get(node.id) || byName.get(node.name.toLowerCase());
        return normalizeTreeNode({ ...node, ...(old || {}), id: node.id, requires: node.requires }, node);
    });
    existing.filter((n) => n?.custom === true || !String(n?.id || "").startsWith("auto_")).forEach((n) => {
        if (!merged.some((x) => x.id === n.id)) merged.push(normalizeTreeNode(n, { custom: true, branch: n.branch || "Custom" }));
    });
    return merged;
}

function layoutSkillTreeNodes(nodes, width, height) {
    const branches = Array.from(new Set(nodes.map((n) => n.branch || "Skills")));
    const numBranches = Math.max(1, branches.length);
    const colWidth = width / numBranches;

    // Helper to calculate depth
    const depths = new Map();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const nameMap = new Map(nodes.map(n => [String(n.name).toLowerCase(), n]));

    function getDepth(node) {
        if (!node) return 0;
        if (depths.has(node.id)) return depths.get(node.id);
        
        const reqs = Array.isArray(node.requires) ? node.requires : [];
        if (!reqs.length) {
            depths.set(node.id, 0);
            return 0;
        }

        let maxD = -1;
        reqs.forEach(reqId => {
            let parent = nodeMap.get(reqId);
            if (!parent) {
                parent = nameMap.get(String(reqId).toLowerCase());
            }
            if (parent && parent.id !== node.id) {
                maxD = Math.max(maxD, getDepth(parent));
            }
        });

        const d = maxD + 1;
        depths.set(node.id, d);
        return d;
    }

    nodes.forEach(node => getDepth(node));

    const branchDepthGroups = {};
    branches.forEach(br => {
        branchDepthGroups[br] = {};
    });

    nodes.forEach(node => {
        const br = node.branch || "Skills";
        const d = depths.get(node.id) || 0;
        if (!branchDepthGroups[br][d]) {
            branchDepthGroups[br][d] = [];
        }
        branchDepthGroups[br][d].push(node);
    });

    branches.forEach((br, bIdx) => {
        const xStart = bIdx * colWidth;
        const xCenter = xStart + colWidth / 2;
        const depthsInBr = Object.keys(branchDepthGroups[br]).map(Number).sort((a, b) => a - b);
        
        depthsInBr.forEach(d => {
            const list = branchDepthGroups[br][d];
            list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
            const count = list.length;
            const y = 80 + d * 110; // Row height of 110px

            list.forEach((node, idx) => {
                const spread = Math.min(100, (colWidth - 40) / Math.max(1, count));
                const offset = count > 1 ? (idx - (count - 1) / 2) * spread : 0;
                
                node.x = Math.max(xStart + 10, Math.min(xStart + colWidth - 100, xCenter + offset - 45));
                node.y = y;
            });
        });
    });
}

function ensureNodeEditorModal() {
    if (document.getElementById("uie-party-node-modal")) return;
    const modal = document.createElement("div");
    modal.id = "uie-party-node-modal";
    modal.className = "modal-overlay";
    modal.style.cssText = "display:none;position:fixed;inset:0;align-items:center;justify-content:center;padding:16px;background:rgba(3,7,18,.62);backdrop-filter:blur(10px);";
    modal.innerHTML = `
        <div class="modal-card" style="width:min(520px,96vw);max-height:min(88vh,720px);overflow:auto;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">
                <h3 style="margin:0;">Skill</h3>
                <button type="button" id="uie-node-modal-close" class="reply-tool-btn" style="width:36px;padding:0;" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 130px 90px;gap:10px;">
                <label style="grid-column:1 / -1;">Name<input id="uie-node-name" class="modal-input" style="width:100%;"></label>
                <label>Type<select id="uie-node-type" class="modal-select" style="width:100%;"><option value="active">Active</option><option value="passive">Passive</option><option value="utility">Utility</option><option value="reaction">Reaction</option><option value="toggle">Toggle</option></select></label>
                <label>Cost<input id="uie-node-cost" class="modal-input" type="number" min="1" max="9" style="width:100%;"></label>
                <label>Stats<input id="uie-node-stats" class="modal-input" placeholder="str:+2, hp:+10" style="width:100%;"></label>
                <label style="grid-column:1 / -1;">Description<textarea id="uie-node-desc" class="modal-textarea" style="min-height:96px;"></textarea></label>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:12px;">
                <button type="button" id="uie-node-delete" class="reply-tool-btn" style="width:auto;padding:0 12px;color:#ffb4b4;">Delete</button>
                <button type="button" id="uie-node-save" class="reply-tool-btn" style="width:auto;padding:0 12px;">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function addCustomSkillTreeNode(s, m) {
    initMemberSkillTree(s, m);
    const nodes = m.skillTree.nodes || [];
    const root = nodes.find((n) => !n.requires?.length) || nodes[0];
    const unlocked = [...nodes].reverse().find((n) => n.unlocked);
    const req = unlocked || root;
    const node = normalizeTreeNode({
        id: createTreeNodeId("custom_skill"),
        name: "Custom Technique",
        type: "active",
        cost: 1,
        stats: "",
        desc: "A custom skill for this member.",
        branch: "Custom",
        custom: true,
        requires: req?.id ? [req.id] : []
    });
    nodes.push(node);
    saveSettings();
    openNodeEditorModal(s, m, node);
}

async function generatePartySkillTreeWithAi(s, m) {
    initMemberSkillTree(s, m);
    const key = detectSkillTreeClass(m);
    const existing = Array.isArray(m.skillTree?.nodes) ? m.skillTree.nodes : [];
    const prompt = `Return only JSON with a "skills" array of 8 RPG class skill-tree skills for this party member. Each skill must include name, type ("active" or "passive"), cost (1-4), stats, desc, branch, icon, requires (array of previous skill names), and unlocked false. Keep it suitable for the class, party role, and current scene. Do not include video or Livepeer features.\n\nMember:\n${JSON.stringify({
        name: m?.identity?.name || m?.name || "Party Member",
        className: key,
        role: m?.role || m?.identity?.role || "",
        level: m?.progression?.level || 1,
        stats: m?.stats || {},
        knownSkills: Array.isArray(m?.skills) ? m.skills.slice(0, 12).map((x) => x?.name || x?.label || x) : []
    })}\n\nExisting skill tree:\n${JSON.stringify(existing.slice(0, 24).map((x) => ({ name: x.name, branch: x.branch, type: x.type })))}`;

    const raw = await generateContent(prompt, "Party Skill Tree Generation");
    const text = String(raw || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const parsed = JSON.parse(start >= 0 && end >= start ? text.slice(start, end + 1) : text);
    const list = Array.isArray(parsed?.skills) ? parsed.skills : (Array.isArray(parsed) ? parsed : []);
    if (!list.length) throw new Error("No skills returned.");

    const nameToId = new Map();
    const aiNodes = list.slice(0, 12).map((rawSkill, idx) => {
        const fallbackId = createTreeNodeId("ai_skill");
        const requiresNames = Array.isArray(rawSkill?.requires) ? rawSkill.requires : [];
        const requires = requiresNames.map((name) => nameToId.get(String(name || "").trim().toLowerCase())).filter(Boolean);
        const node = normalizeTreeNode({
            ...rawSkill,
            id: String(rawSkill?.id || fallbackId),
            branch: rawSkill?.branch || `${key} AI`,
            custom: true,
            requires: idx === 0 ? [] : requires,
            unlocked: false
        }, { branch: `${key} AI`, custom: true });
        nameToId.set(String(node.name || "").trim().toLowerCase(), node.id);
        return node;
    });

    const generatedBase = mergeGeneratedSkillTree(s, m);
    m.skillTree = {
        ...m.skillTree,
        className: key,
        generatedVersion: 3,
        aiGeneratedAt: Date.now(),
        nodes: [...generatedBase, ...aiNodes],
        pointsSpent: 0
    };
    saveSettings();
}

function initMemberSkillTree(s, m) {
    if (!m) return;
    ensureMember(m);

    const key = detectSkillTreeClass(m);
    if (!m.skillTree || typeof m.skillTree !== "object") m.skillTree = {};
    if (m.skillTree.generatedVersion !== 3 || m.skillTree.className !== key || !Array.isArray(m.skillTree.nodes)) {
        m.skillTree = {
            ...m.skillTree,
            className: key,
            generatedVersion: 3,
            nodes: mergeGeneratedSkillTree(s, m),
            pointsSpent: 0
        };
    } else {
        m.skillTree.nodes = m.skillTree.nodes.map((n) => normalizeTreeNode(n)).filter(Boolean);
    }
    
    let lvl = Math.max(1, Number(m.progression?.level || 1));
    let totalSP = lvl - 1;
    let spent = m.skillTree.nodes.filter(n => n.unlocked).reduce((sum, n) => sum + (n.cost || 1), 0);
    m.skillTree.pointsSpent = spent;
    m.skillTree.sp = Math.max(0, totalSP - spent);
}

export function recalculateMemberSkillsAndStats(s, m) {
    if (!m) return;
    ensureMember(m);
    initMemberSkillTree(s, m);
    
    m.skillTreeBoosts = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0, per: 0, luk: 0, hp: 0, mp: 0, ap: 0, maxHp: 0, maxMp: 0, maxAp: 0 };
    
    const unlocked = m.skillTree.nodes.filter(n => n.unlocked);
    
    m.skills = (m.skills || []).filter(sk => sk.source !== "SkillTree");
    
    unlocked.forEach(node => {
        if (node.type === "active") {
            const skillItem = {
                name: node.name,
                description: node.desc || "",
                skillType: "active",
                source: "SkillTree"
            };
            m.skills.push(skillItem);
        }
        
        const statsStr = String(node.stats || "").trim();
        if (statsStr) {
            const parts = statsStr.split(",");
            parts.forEach(part => {
                const sub = part.split(":");
                if (sub.length === 2) {
                    const statKey = sub[0].trim().toLowerCase();
                    const statVal = parseInt(sub[1].trim());
                    if (Number.isFinite(statVal)) {
                        let targetKey = statKey;
                        if (statKey === "hp") targetKey = "maxHp";
                        else if (statKey === "mp") targetKey = "maxMp";
                        else if (statKey === "ap") targetKey = "maxAp";
                        
                        if (m.skillTreeBoosts[targetKey] !== undefined) {
                            m.skillTreeBoosts[targetKey] += statVal;
                        }
                    }
                }
            });
        }
    });
    
    if (!m.baseStats) {
        m.baseStats = JSON.parse(JSON.stringify(m.stats));
    }
    if (!m.baseVitals) {
        m.baseVitals = JSON.parse(JSON.stringify(m.vitals));
    }
    
    // Determine lane position
    const mid = String(m.id);
    let position = "reserve";
    const lanes = s.party?.formation?.lanes;
    if (lanes) {
        if (Array.isArray(lanes.front) && lanes.front.map(String).includes(mid)) position = "front";
        else if (Array.isArray(lanes.mid) && lanes.mid.map(String).includes(mid)) position = "mid";
        else if (Array.isArray(lanes.back) && lanes.back.map(String).includes(mid)) position = "back";
    }
    m.formationPosition = position;
    
    for (const key of Object.keys(m.stats)) {
        const base = Number(m.baseStats[key] ?? 10);
        const boost = Number(m.skillTreeBoosts[key] ?? 0);
        
        let multiplier = 1.0;
        if (position === "front") {
            if (key === "con" || key === "vit") multiplier = 1.20; // Vanguard: +20% VIT/CON
        } else if (position === "mid") {
            if (key === "str" || key === "dex") multiplier = 1.15; // Assault: +15% STR/DEX
        } else if (position === "back") {
            if (key === "int" || key === "wis") multiplier = 1.20; // Rearguard: +20% INT/WIS
        } else if (position === "reserve") {
            if (key === "cha") multiplier = 1.10; // Reserve Support: +10% CHA
        }
        
        m.stats[key] = Math.round((base + boost) * multiplier + 1e-9);
    }
    
    for (const key of ["maxHp", "maxMp", "maxAp"]) {
        const base = Number(m.baseVitals[key] ?? (key === "maxHp" ? 100 : (key === "maxMp" ? 50 : 10)));
        const boost = Number(m.skillTreeBoosts[key] ?? 0);
        
        let multiplier = 1.0;
        if (position === "front" && key === "maxHp") {
            multiplier = 1.20; // Vanguard: +20% MaxHP
        } else if (position === "back" && key === "maxMp") {
            multiplier = 1.15; // Rearguard: +15% MaxMP
        }
        
        m.vitals[key] = Math.round((base + boost) * multiplier + 1e-9);
    }
    
    // Clamp current hp/mp to new maxes
    if (m.vitals.hp > m.vitals.maxHp) m.vitals.hp = m.vitals.maxHp;
    if (m.vitals.mp > m.vitals.maxMp) m.vitals.mp = m.vitals.maxMp;
    
    if (isUserMember(s, m)) {
        applyMemberToCore(s, m);
        try { $(document).trigger("uie:updateVitals"); } catch (_) {}
    }
}

function openNodeEditorModal(s, m, node) {
    ensureNodeEditorModal();
    currentEditingNode = node;
    currentEditingMember = m;
    
    $("#uie-node-name").val(node.name || "");
    $("#uie-node-type").val(node.type || "active");
    $("#uie-node-cost").val(node.cost || 1);
    $("#uie-node-desc").val(node.desc || "");
    $("#uie-node-stats").val(node.stats || "");
    $("#uie-node-delete").toggle(node.custom === true);
    
    const popZ = String(getMemberModalZIndex() + 5);
    $("#uie-party-node-modal").css({ display: "flex", zIndex: popZ });
}
function renderSkillTree(container, s, m) {
    initMemberSkillTree(s, m);
    recalculateMemberSkillsAndStats(s, m);
    
    const view = container.find("#uie-party-skilltree-view");
    if (!view.length) {
        const paneTmpl = document.getElementById("uie-party-modal-skilltree-pane");
        if (paneTmpl && paneTmpl.content) {
            container.empty().append(paneTmpl.content.cloneNode(true));
        }
    }
    
    $("#uie-skilltree-class-lbl").text(`${m.skillTree.className || "Adventurer"} manual skill layout`);
    $("#uie-skilltree-points-val").text(`${m.skillTree.sp} SP`);
    
    const nodesContainer = $("#uie-skilltree-nodes-container").empty();
    const svgOverlay = document.getElementById("uie-skilltree-connections");
    if (svgOverlay) {
        svgOverlay.innerHTML = "";
    }
    
    const nodes = m.skillTree.nodes || [];
    const board = view.find(".uie-skilltree-board").get(0);
    const availableWidth = Math.round(board?.getBoundingClientRect?.().width || container.get(0)?.getBoundingClientRect?.().width || 860);
    const availableHeight = Math.round(board?.getBoundingClientRect?.().height || 520);
    const width = Math.max(300, availableWidth - 18);
    const branches = Array.from(new Set(nodes.map((n) => n.branch || "Skills")));
    const numBranches = Math.max(1, branches.length);

    // Calculate vertical height based on max depth
    const depths = new Map();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const nameMap = new Map(nodes.map(n => [String(n.name).toLowerCase(), n]));
    function getDepth(node) {
        if (!node) return 0;
        if (depths.has(node.id)) return depths.get(node.id);
        const reqs = Array.isArray(node.requires) ? node.requires : [];
        if (!reqs.length) {
            depths.set(node.id, 0);
            return 0;
        }
        let maxD = -1;
        reqs.forEach(reqId => {
            let parent = nodeMap.get(reqId);
            if (!parent) parent = nameMap.get(String(reqId).toLowerCase());
            if (parent && parent.id !== node.id) maxD = Math.max(maxD, getDepth(parent));
        });
        const d = maxD + 1;
        depths.set(node.id, d);
        return d;
    }
    nodes.forEach(node => getDepth(node));
    
    let maxD = 1;
    nodes.forEach(node => {
        const d = depths.get(node.id) || 0;
        if (d > maxD) maxD = d;
    });
    const height = Math.max(300, availableHeight - 18, 120 + (maxD + 1) * 110);

    layoutSkillTreeNodes(nodes, width, height);
    nodesContainer.css({ width: `${width}px`, height: `${height}px` });
    if (svgOverlay) {
        svgOverlay.setAttribute("width", String(width));
        svgOverlay.setAttribute("height", String(height));
        svgOverlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }

    $("#uie-skilltree-add-node").off("click.partyTreeAdd").on("click.partyTreeAdd", function(e) {
        e.preventDefault();
        e.stopPropagation();
        addCustomSkillTreeNode(s, m);
        renderSkillTree(container, s, m);
    });

    const branchLayer = $('<div class="uie-skilltree-branches" style="position:absolute;inset:0;pointer-events:none;z-index:1;"></div>');
    branches.forEach((branch, bIdx) => {
        const xCenter = (bIdx + 0.5) * (width / numBranches);
        branchLayer.append(`<div class="uie-skilltree-branch-label" style="position:absolute; left:${xCenter}px; transform:translateX(-50%); top:15px;">${esc(branch)}</div>`);
    });
    nodesContainer.append(branchLayer);
    
    if (svgOverlay) {
        nodes.forEach(node => {
            if (node.requires && Array.isArray(node.requires)) {
                node.requires.forEach(reqId => {
                    let parent = nodes.find(n => n.id === reqId);
                    if (!parent) parent = nodes.find(n => String(n.name).toLowerCase() === String(reqId).toLowerCase());
                    if (parent) {
                        const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
                        const x1 = parent.x + 45;
                        const y1 = parent.y + 58; // Bottom center of parent square
                        const x2 = node.x + 45;
                        const y2 = node.y;      // Top center of child square
                        const mid = Math.max(24, (y2 - y1) / 2);
                        line.setAttribute("d", `M ${x1} ${y1} C ${x1} ${y1 + mid}, ${x2} ${y2 - mid}, ${x2} ${y2}`);
                        line.setAttribute("fill", "none");
                        
                        if (parent.unlocked && node.unlocked) {
                            line.setAttribute("stroke", "#10b981");
                            line.setAttribute("stroke-width", "3");
                            line.setAttribute("style", "filter: drop-shadow(0 0 6px #10b981);");
                        } else if (parent.unlocked) {
                            line.setAttribute("stroke", "#00e5ff");
                            line.setAttribute("stroke-width", "2.5");
                        } else {
                            line.setAttribute("stroke", "rgba(255,255,255,0.18)");
                            line.setAttribute("stroke-width", "2");
                        }
                        svgOverlay.appendChild(line);
                    }
                });
            }
        });
    }
    
    // Create tooltip element if not exists
    let tooltip = $("#uie-skill-tree-tooltip");
    if (!tooltip.length) {
        tooltip = $('<div id="uie-skill-tree-tooltip" class="uie-skill-tooltip"></div>');
        $("#uie-party-skilltree-view").append(tooltip);
    }

    nodes.forEach(node => {
        const isSelectable = !node.unlocked && 
            (m.skillTree.sp >= (node.cost || 1)) && 
            (!node.requires || node.requires.length === 0 || node.requires.every(reqId => {
                const parent = nodes.find(n => n.id === reqId) || nodes.find(n => String(n.name).toLowerCase() === String(reqId).toLowerCase());
                return parent?.unlocked;
            }));
            
        const statusClass = node.unlocked ? "is-unlocked" : (isSelectable ? "is-ready" : "is-locked");
        const nodeEl = $(`
            <div class="uie-skill-node ${statusClass}" data-id="${esc(node.id)}" style="position:absolute; left:${node.x}px; top:${node.y}px;">
                <div class="node-medallion">
                    <i class="${esc(node.icon || (node.type === "active" ? "fa-solid fa-bolt" : "fa-solid fa-shield"))}"></i>
                    <div class="node-rank-badge">${node.unlocked ? "1/1" : "0/1"}</div>
                    <button class="node-edit-btn" data-id="${esc(node.id)}" title="Edit node"><i class="fa-solid fa-pencil"></i></button>
                </div>
                <div class="node-label">
                    <div class="node-name-lbl">${esc(node.name)}</div>
                    <div class="node-cost-lbl">${node.cost || 1} SP</div>
                    <div class="node-meta">${esc(titleCaseWords(node.type))}${node.stats ? ` | ${esc(node.stats)}` : ""}</div>
                </div>
            </div>
        `);
        
        nodeEl.on("click.party", function(e) {
            if ($(e.target).closest(".node-edit-btn").length) return;
            e.stopPropagation();
            if (node.unlocked) {
                notify("info", `${node.name}: Unlocked.\n${node.desc || ""}`, "Skills");
                return;
            }
            
            const missingReq = node.requires && node.requires.some(reqId => {
                const parent = nodes.find(n => n.id === reqId) || nodes.find(n => String(n.name).toLowerCase() === String(reqId).toLowerCase());
                return !parent?.unlocked;
            });
            if (missingReq) {
                notify("warning", `Requires prerequisite skills to be unlocked first.`, "Skills");
                return;
            }
            
            const cost = node.cost || 1;
            if (m.skillTree.sp < cost) {
                notify("warning", `Need ${cost} SP to unlock (Have ${m.skillTree.sp} SP).`, "Skills");
                return;
            }
            
            if (window.confirm(`Unlock ${node.name} for ${cost} SP?`)) {
                node.unlocked = true;
                recalculateMemberSkillsAndStats(s, m);
                saveSettings();
                renderSkillTree(container, s, m);
                notify("success", `Unlocked skill: ${node.name}!`, "Skills");
                try { injectRpEvent(`[System: ${m.identity.name} unlocked skill '${node.name}'.]`); } catch (_) {}
            }
        });
        
        nodeEl.find(".node-edit-btn").on("click.party", function(e) {
            e.preventDefault();
            e.stopPropagation();
            openNodeEditorModal(s, m, node);
        });

        // Hover events for tooltip
        nodeEl.on("mouseenter.tooltip", function() {
            const rect = this.getBoundingClientRect();
            const boardRect = $("#uie-party-skilltree-view")[0].getBoundingClientRect();
            const left = rect.left - boardRect.left + 95;
            const top = rect.top - boardRect.top;
            
            let reqsHtml = "";
            if (node.requires && node.requires.length) {
                node.requires.forEach(reqId => {
                    const parent = nodes.find(n => n.id === reqId) || nodes.find(n => String(n.name).toLowerCase() === String(reqId).toLowerCase());
                    if (parent) {
                        const met = parent.unlocked;
                        reqsHtml += `<div class="req-item ${met ? 'met' : 'unmet'}">
                            <i class="fa-solid ${met ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
                            Requires ${parent.name}
                        </div>`;
                    }
                });
            }
            
            tooltip.html(`
                <div class="tooltip-name">${esc(node.name)}</div>
                <div class="tooltip-meta">
                    <span class="type-${node.type}">${esc(titleCaseWords(node.type))}</span>
                    <span>${node.cost || 1} SP</span>
                </div>
                ${node.desc ? `<div class="tooltip-desc">${esc(node.desc)}</div>` : ""}
                ${node.stats ? `<div class="tooltip-stats">Effects: ${esc(node.stats)}</div>` : ""}
                ${reqsHtml ? `<div class="tooltip-reqs">${reqsHtml}</div>` : ""}
            `).css({
                left: `${left}px`,
                top: `${top}px`,
                display: "block"
            });
        });

        nodeEl.on("mouseleave.tooltip", function() {
            tooltip.hide();
        });
        
        nodesContainer.append(nodeEl);
    });
}

function getRuntimeContext() {
    try {
        if (typeof window.getContext === "function") return window.getContext() || {};
    } catch (_) {}
    return {};
}

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function collectGiftContacts(s) {
    const social = s?.social && typeof s.social === "object" ? s.social : {};
    const tabs = ["friends", "associates", "romance", "family", "rivals", "npc"];
    const seen = new Set();
    const out = [];
    for (const tabName of tabs) {
        const list = Array.isArray(social[tabName]) ? social[tabName] : [];
        for (const p of list) {
            const name = String(p?.name || "").trim();
            const key = name.toLowerCase();
            if (!name || seen.has(key)) continue;
            seen.add(key);
            out.push({ name, tab: tabName });
        }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

function pickGiftContact(itemName) {
    const contacts = collectGiftContacts(getSettings());
    $(".uie-party-gift-picker").remove();
    return new Promise((resolve) => {
        const options = contacts.length
            ? contacts.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}${c.tab ? ` / ${esc(c.tab)}` : ""}</option>`).join("")
            : `<option value="">No contacts available</option>`;
        const modal = $(`
            <div class="uie-party-gift-picker" style="position:fixed; inset:0; z-index:2147483665; background:rgba(0,0,0,0.72); display:flex; align-items:center; justify-content:center; padding:16px;">
                <div style="width:min(420px, 94vw); border:1px solid rgba(225,193,122,0.45); border-radius:8px; background:rgba(14,10,8,0.98); color:#fff; box-shadow:0 24px 80px rgba(0,0,0,0.6); padding:14px; display:grid; gap:12px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="font-weight:900; color:#f6e7c8; letter-spacing:0.5px;">Gift to Contact</div>
                        <button type="button" class="uie-party-gift-close" style="margin-left:auto; width:34px; height:34px; border-radius:6px; border:1px solid rgba(255,255,255,0.16); background:rgba(0,0,0,0.32); color:#fff; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div style="font-size:12px; color:rgba(255,255,255,0.72); line-height:1.45;">${esc(itemName)} will be offered to the selected contact.</div>
                    <select class="uie-party-gift-select" ${contacts.length ? "" : "disabled"} style="width:100%; min-height:40px; border-radius:6px; border:1px solid rgba(225,193,122,0.35); background:rgba(0,0,0,0.35); color:#fff; padding:8px 10px; font-weight:800;">
                        ${options}
                    </select>
                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                        <button type="button" class="uie-party-gift-close" style="height:38px; padding:0 12px; border-radius:6px; border:1px solid rgba(255,255,255,0.16); background:rgba(0,0,0,0.26); color:#fff; cursor:pointer; font-weight:800;">Cancel</button>
                        <button type="button" class="uie-party-gift-confirm" ${contacts.length ? "" : "disabled"} style="height:38px; padding:0 14px; border-radius:6px; border:1px solid rgba(225,193,122,0.55); background:rgba(225,193,122,0.16); color:#f6e7c8; cursor:pointer; font-weight:900;">Gift</button>
                    </div>
                </div>
            </div>
        `);
        const finish = (value = "") => {
            modal.remove();
            resolve(String(value || "").trim());
        };
        modal.on("click.party", ".uie-party-gift-close", (e) => {
            e.preventDefault();
            e.stopPropagation();
            finish("");
        });
        modal.on("click.party", ".uie-party-gift-confirm", (e) => {
            e.preventDefault();
            e.stopPropagation();
            finish(modal.find(".uie-party-gift-select").val());
        });
        modal.on("click.party", function (e) {
            if (e.target === this) finish("");
        });
        $("body").append(modal);
        setTimeout(() => modal.find(".uie-party-gift-select").trigger("focus"), 0);
    });
}

function clampNum(n, min, max) {
    const v = Number(n);
    if (!Number.isFinite(v)) return min;
    return Math.max(min, Math.min(max, v));
}

function meterPct(cur, max) {
    const c = Number(cur || 0);
    const m = Number(max || 0);
    if (!Number.isFinite(c) || !Number.isFinite(m) || m <= 0) return 0;
    return Math.max(0, Math.min(100, (c / m) * 100));
}

function normalizeHexColor(v) {
    const raw = String(v || "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : "#89b4fa";
}

function nextTrackerId() {
    return `trk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMemberTracker(raw = {}) {
    const id = String(raw?.id || nextTrackerId()).trim() || nextTrackerId();
    const base = normalizeLifeTracker(raw);
    const max = Math.max(1, clampNum(base.max, 1, 999999));
    const current = clampNum(base.current, -999999, 999999);
    const color = normalizeHexColor(base.color);
    return {
        id,
        name: String(base.name || "Tracker").trim().slice(0, 60) || "Tracker",
        current,
        max,
        color,
        notes: String(base.notes || "").slice(0, 800),
    };
}

function getSheetTrackerRows(m) {
    const rows = [];

    const baseVitalDefs = [
        { key: "hp", name: "HP", color: "#fb7185", cur: () => Number(m?.vitals?.hp || 0), max: () => Number(m?.vitals?.maxHp || 0) },
        { key: "mp", name: "MP", color: "#61dafb", cur: () => Number(m?.vitals?.mp || 0), max: () => Number(m?.vitals?.maxMp || 0) },
        { key: "ap", name: "AP", color: "#f2c86b", cur: () => Number(m?.vitals?.ap || 0), max: () => Number(m?.vitals?.maxAp || 0) },
    ];

    for (const def of baseVitalDefs) {
        const cur = def.cur();
        const max = def.max();
        if (max > 0 || cur > 0) {
            rows.push({
                kind: "base",
                key: def.key,
                id: def.key,
                name: def.name,
                current: cur,
                max: Math.max(1, max),
                color: def.color,
                notes: "",
            });
        }
    }

    if (m?.progression?.xp !== undefined || (m?.progression?.level || 0) > 0) {
        const xp = Number(m?.progression?.xp || 0);
        const maxXp = Math.max(1, Number(m?.progression?.level || 1) * 1000);
        rows.push({
            kind: "base",
            key: "xp",
            id: "xp",
            name: "XP",
            current: xp,
            max: maxXp,
            color: "#77e2a5",
            notes: "",
        });
    }

    const custom = Array.isArray(m?.trackers) ? m.trackers : [];
    for (let i = 0; i < custom.length; i++) {
        const t = normalizeMemberTracker(custom[i]);
        custom[i] = t;
        rows.push({
            kind: "custom",
            key: t.id,
            id: t.id,
            name: t.name,
            current: Number(t.current || 0),
            max: Math.max(1, Number(t.max || 1)),
            color: t.color,
            notes: t.notes,
        });
    }

    return rows;
}

function renderSheetTrackers(container, m) {
    const host = container.find(".party-member-trackers");
    if (!host.length) return;
    host.empty();

    const tmpl = document.getElementById("uie-party-tracker-row");
    if (!tmpl || !tmpl.content) return;

    const rows = getSheetTrackerRows(m);
    if (!rows.length) {
        host.html(`<div style="opacity:0.65; font-weight:800; padding:8px; border:1px dashed rgba(255,255,255,0.16); border-radius:10px;">No life trackers yet.</div>`);
        return;
    }

    rows.forEach((row) => {
        const el = $(tmpl.content.cloneNode(true));
        const card = el.find(".party-tracker-card");
        card.attr("data-track-kind", row.kind);
        card.attr("data-track-key", row.key);
        card.attr("data-track-id", row.id || "");

        el.find(".party-tracker-dot").css("background", row.color || "#89b4fa");
        el.find(".party-tracker-name").text(row.name || "Tracker");
        el.find(".party-tracker-meta").text(`${Math.round(Number(row.current || 0))}/${Math.round(Math.max(1, Number(row.max || 0)))}`);
        el.find(".party-tracker-fill").css({ width: `${meterPct(row.current, row.max)}%`, background: row.color || "#89b4fa" });

        const notes = String(row.notes || "").trim();
        if (notes) el.find(".party-tracker-notes").text(notes).show();

        if (row.kind === "custom") {
            el.find(".party-track-edit, .party-track-del").show();
        }

        host.append(el);
    });
}

function applyTrackerDelta(m, rowMeta, delta) {
    if (!m || !rowMeta) return false;
    const kind = String(rowMeta.kind || "");
    const key = String(rowMeta.key || "");
    const amt = Number(delta || 0);
    if (!Number.isFinite(amt) || amt === 0) return false;

    if (kind === "base") {
        if (!m.vitals) m.vitals = {};
        if (!m.progression) m.progression = { level: 1, xp: 0, skillPoints: 0, perkPoints: 0 };

        if (key === "hp" || key === "mp" || key === "ap") {
            const map = {
                hp: ["hp", "maxHp"],
                mp: ["mp", "maxMp"],
                ap: ["ap", "maxAp"],
            };
            const pair = map[key];
            if (!pair) return false;
            const curKey = pair[0];
            const maxKey = pair[1];
            const cur = Number(m.vitals?.[curKey] || 0);
            const max = Math.max(1, Number(m.vitals?.[maxKey] || 1));
            const next = clampNum(cur + amt, 0, max);
            if (next === cur) return false;
            m.vitals[curKey] = next;
            if (curKey === "hp" && next <= 0) {
                try { injectRpEvent(`[System: Companion ${m.identity?.name || "member"} has died! HP fell to 0.]`); } catch (_) {}
            }
            return true;
        }

        if (key === "xp") {
            let level = Math.max(1, Math.round(Number(m.progression?.level || 1)));
            let xp = Number(m.progression?.xp || 0);
            if (!Number.isFinite(xp)) xp = 0;
            xp += amt;

            const xpGoal = (lv) => Math.max(100, lv * 1000);
            while (xp >= xpGoal(level) && level < 999) {
                xp -= xpGoal(level);
                level += 1;
            }
            while (xp < 0 && level > 1) {
                level -= 1;
                xp += xpGoal(level);
            }
            if (level <= 1 && xp < 0) xp = 0;

            const nextXp = Math.max(0, Math.round(xp));
            const prevXp = Math.max(0, Math.round(Number(m.progression?.xp || 0)));
            const prevLevel = Math.max(1, Math.round(Number(m.progression?.level || 1)));
            if (nextXp === prevXp && level === prevLevel) return false;

            m.progression.level = level;
            m.progression.xp = nextXp;
            try {
                injectRpEvent(`[System: Companion ${m.identity?.name || "member"} XP change: ${amt >= 0 ? "+" : ""}${amt} XP. Progression: Level ${level}, ${nextXp}/${xpGoal(level)} XP.]`);
                if (level > prevLevel) {
                    injectRpEvent(`[System: Companion ${m.identity?.name || "member"} leveled up! Gained level ${level}.]`);
                }
            } catch (_) {}
            return true;
        }

        return false;
    }

    if (!Array.isArray(m.trackers)) m.trackers = [];
    const id = String(rowMeta.id || rowMeta.key || "").trim();
    if (!id) return false;
    const t = m.trackers.find((x) => String(x?.id || "").trim() === id);
    if (!t) return false;

    const cur = Number(t.current || 0);
    const next = clampNum(cur + amt, -999999, 999999);
    if (next === cur) return false;
    t.current = next;
    t.max = clampNum(t.max, 0, 999999);
    return true;
}

function getSelectedTrackerMember(s) {
    ensureParty(s);
    const m = selectedId ? getMember(s, selectedId) : (Array.isArray(s.party?.members) ? s.party.members[0] : null);
    if (!m) return null;
    ensureMember(m);
    if (!selectedId && m.id) selectedId = String(m.id);
    return m;
}

function openMemberTrackerModal(m, trackerId = "") {
    if (!m) return;
    ensureMember(m);
    if (!Array.isArray(m.trackers)) m.trackers = [];

    const id = String(trackerId || "").trim();
    const existing = id ? m.trackers.find((x) => String(x?.id || "").trim() === id) : null;
    trackerModalEditId = existing ? String(existing.id || "") : "";

    const normalized = normalizeMemberTracker(existing || {
        id: nextTrackerId(),
        name: "",
        current: 0,
        max: 100,
        color: "#89b4fa",
        notes: "",
    });

    $("#party-track-modal-title").text(existing ? `Edit Tracker: ${normalized.name}` : "New Tracker");
    $("#party-track-modal-name").val(existing ? normalized.name : "");
    $("#party-track-modal-color").val(normalized.color || "#89b4fa");
    $("#party-track-modal-current").val(Number(normalized.current || 0));
    $("#party-track-modal-max").val(Math.max(1, Number(normalized.max || 100)));
    $("#party-track-modal-notes").val(normalized.notes || "");
    $("#party-track-modal-delete").toggle(!!existing);
    $("#uie-party-tracker-modal").css({ display: "flex", zIndex: String(getMemberModalZIndex() + 2) });
}

function closeMemberTrackerModal() {
    trackerModalEditId = "";
    $("#uie-party-tracker-modal").hide();
}

function saveMemberTrackerModal() {
    const s = getSettings();
    const m = getSelectedTrackerMember(s);
    if (!m) return;
    if (!Array.isArray(m.trackers)) m.trackers = [];

    const normalized = normalizeMemberTracker({
        id: trackerModalEditId || nextTrackerId(),
        name: $("#party-track-modal-name").val(),
        color: $("#party-track-modal-color").val(),
        current: $("#party-track-modal-current").val(),
        max: $("#party-track-modal-max").val(),
        notes: $("#party-track-modal-notes").val(),
    });

    const idx = trackerModalEditId ?
         m.trackers.findIndex((x) => String(x?.id || "").trim() === String(trackerModalEditId))
        : -1;
    if (idx >= 0) m.trackers[idx] = normalized;
    else m.trackers.push(normalized);

    saveSettings();
    closeMemberTrackerModal();
    render();
    if (memberModalOpen) {
        try { renderMemberModal(s, m); } catch (_) {}
    }
}

function deleteMemberTrackerFromModal() {
    if (!trackerModalEditId) return;
    const s = getSettings();
    const m = getSelectedTrackerMember(s);
    if (!m || !Array.isArray(m.trackers)) return;

    const idx = m.trackers.findIndex((x) => String(x?.id || "").trim() === String(trackerModalEditId));
    if (idx < 0) return;
    if (!window.confirm("Delete this tracker?")) return;

    m.trackers.splice(idx, 1);
    saveSettings();
    closeMemberTrackerModal();
    render();
    if (memberModalOpen) {
        try { renderMemberModal(s, m); } catch (_) {}
    }
}

function downloadJsonFile(filename, data) {
    try {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = String(filename || "party_export.json");
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (_) {}
}

function pickJsonFile() {
    return new Promise((resolve) => {
        try {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "application/json,.json";
            input.style.display = "none";
            document.body.appendChild(input);
            input.onchange = async () => {
                try {
                    const f = input.files && input.files[0] ? input.files[0] : null;
                    if (!f) { input.remove(); return resolve(null); }
                    const r = new FileReader();
                    r.onload = () => {
                        const txt = String(r.result || "");
                        try { input.remove(); } catch (_) {}
                        resolve(txt || null);
                    };
                    r.onerror = () => {
                        try { input.remove(); } catch (_) {}
                        resolve(null);
                    };
                    r.readAsText(f);
                } catch (_) {
                    try { input.remove(); } catch (_) {}
                    resolve(null);
                }
            };
            input.click();
        } catch (_) {
            resolve(null);
        }
    });
}

function pickPartyCardFile() {
    return new Promise((resolve) => {
        try {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "application/json,.json,image/png,.png";
            input.style.display = "none";
            document.body.appendChild(input);
            input.onchange = async () => {
                const file = input.files && input.files[0] ? input.files[0] : null;
                if (!file) { input.remove(); return resolve(null); }
                try {
                    const buffer = await file.arrayBuffer();
                    const text = /^image\/png$/i.test(file.type) || /\.png$/i.test(file.name || "")
                        ? ""
                        : await file.text();
                    input.remove();
                    resolve({ file, buffer, text });
                } catch (_) {
                    try { input.remove(); } catch (_) {}
                    resolve(null);
                }
            };
            input.click();
        } catch (_) {
            resolve(null);
        }
    });
}

function decodeLatin1(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
}

function extractPngTextChunks(buffer) {
    const bytes = new Uint8Array(buffer || []);
    const chunks = {};
    if (bytes.length < 16 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return chunks;
    const readU32 = (offset) => ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    let p = 8;
    while (p + 12 <= bytes.length) {
        const len = readU32(p);
        const type = decodeLatin1(bytes.slice(p + 4, p + 8));
        const start = p + 8;
        const end = start + len;
        if (end > bytes.length) break;
        if (type === "tEXt") {
            const nul = bytes.indexOf(0, start);
            if (nul > start && nul < end) {
                const key = decodeLatin1(bytes.slice(start, nul));
                const value = decodeLatin1(bytes.slice(nul + 1, end));
                chunks[key] = value;
            }
        }
        p = end + 4;
        if (type === "IEND") break;
    }
    return chunks;
}

function arrayBufferToDataUrl(buffer, mime = "image/png") {
    try {
        const bytes = new Uint8Array(buffer || []);
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.slice(i, i + chunk));
        }
        return `data:${mime};base64,${btoa(binary)}`;
    } catch (_) {
        return "";
    }
}

function parsePossiblyBase64Json(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;
    const attempts = [text];
    try { attempts.push(decodeURIComponent(escape(atob(text)))); } catch (_) {}
    try { attempts.push(atob(text)); } catch (_) {}
    for (const candidate of attempts) {
        try { return JSON.parse(candidate); } catch (_) {}
        const match = String(candidate || "").match(/\{[\s\S]*\}/);
        if (match) {
            try { return JSON.parse(match[0]); } catch (_) {}
        }
    }
    return null;
}

function normalizeExternalCardToMember(card, fallbackPortrait = "") {
    const data = card?.data && typeof card.data === "object" ? card.data : card;
    const name = String(data?.name || data?.char_name || card?.name || card?.title || "").trim();
    if (!name) return null;
    const desc = String(data?.description || data?.desc || card?.description || "").trim();
    const personality = String(data?.personality || card?.personality || "").trim();
    const scenario = String(data?.scenario || card?.scenario || "").trim();
    const avatar = String(data?.avatar || data?.image || data?.portrait || data?.thumbnail || card?.avatar || card?.image || card?.portrait || fallbackPortrait || "").trim();
    const m = defaultMember(name);
    m.bio = [desc, personality ? `Personality: ${personality}` : "", scenario ? `Scenario: ${scenario}` : ""].filter(Boolean).join("\n\n");
    if (avatar) m.images.portrait = avatar;
    if (Array.isArray(data?.tags)) m.tags = data.tags.slice(0, 30);
    return m;
}

async function importPartyCharacterCard() {
    const picked = await pickPartyCardFile();
    if (!picked) return;
    const isPng = /^image\/png$/i.test(picked.file?.type || "") || /\.png$/i.test(picked.file?.name || "");
    let card = null;
    let portrait = "";
    if (isPng) {
        const chunks = extractPngTextChunks(picked.buffer);
        const raw = chunks.chara || chunks.Chara || chunks.ccv3 || chunks.ccv2 || chunks.chub || chunks.data || chunks.comment || "";
        card = parsePossiblyBase64Json(raw);
        portrait = arrayBufferToDataUrl(picked.buffer, "image/png");
    } else {
        card = parsePossiblyBase64Json(picked.text);
    }
    const m = normalizeExternalCardToMember(card, portrait);
    if (!m) {
        notify("warning", "Could not find character metadata in that card.", "Party");
        return;
    }
    const s = getSettings();
    ensureParty(s);
    const existing = s.party.members.findIndex((x) => String(x?.identity?.name || "").trim().toLowerCase() === String(m.identity?.name || "").trim().toLowerCase());
    if (existing >= 0) s.party.members[existing] = { ...s.party.members[existing], ...m, id: s.party.members[existing].id || m.id };
    else s.party.members.push(m);
    selectedId = String((existing >= 0 ? s.party.members[existing] : m).id || "");
    saveSettings();
    render();
    notify("success", `Imported ${m.identity.name}.`, "Party");
}

function skillKey(name) {
    return String(name || "").trim().toLowerCase();
}

function normalizeSkill(x, source) {
    if (!x) return null;
    const name = typeof x === "string" ? x : (x.name || x.title || x.skill || "");
    const n = String(name || "").trim();
    if (!n) return null;
    const desc = typeof x === "string" ? "" : String(x.desc || x.description || x.text || "").trim();
    const skillType = typeof x === "string" ? "active" : String(x.skillType || x.type || "active").toLowerCase();
    const lifeTracker = typeof x === "string" ? "" : String(x.lifeTracker || x.tracker || "").trim();
    const result = { name: n.slice(0, 80), desc: desc.slice(0, 320), source: String(source || "Party"), skillType: (skillType === "passive" ? "passive" : "active") };
    if (lifeTracker) result.lifeTracker = lifeTracker.slice(0, 60);
    return result;
}

function getActiveLorebooks(s) {
    const books = Array.isArray(s?.lorebooks) ? s.lorebooks : [];
    const ctx = s?.loreContext && typeof s.loreContext === "object" ? s.loreContext : {};
    const names = new Set();
    const addList = (list) => (Array.isArray(list) ? list : []).forEach((name) => {
        const nm = String(name || "").trim();
        if (nm) names.add(nm);
    });
    addList(ctx.globalBooks);
    Object.values(ctx.chatBindings || {}).forEach(addList);
    Object.values(ctx.characterBindings || {}).forEach(addList);
    Object.values(ctx.personaBindings || {}).forEach(addList);
    if (!names.size) return [];
    return books.filter((book) => names.has(String(book?.name || "").trim()));
}

function entryMatchesCharacter(entry, characterName) {
    if (!characterName || !entry) return false;
    const charNameLower = characterName.trim().toLowerCase();
    const keys = Array.isArray(entry.key) ? entry.key : String(entry.key || "").split(",");
    if (keys.some(k => String(k).trim().toLowerCase() === charNameLower)) {
        return true;
    }
    const keys2 = Array.isArray(entry.keysecondary) ? entry.keysecondary : String(entry.keysecondary || "").split(",");
    if (keys2.some(k => String(k).trim().toLowerCase() === charNameLower)) {
        return true;
    }
    const commentLower = String(entry.comment || "").toLowerCase();
    if (commentLower.includes(charNameLower)) {
        return true;
    }
    return false;
}

function resolveMemberSkills(s, m) {
    const out = [];
    const seen = new Set();
    const add = (sk) => {
        if (!sk) return;
        const k = skillKey(sk.name);
        if (!k || seen.has(k)) return;
        seen.add(k);
        out.push(sk);
    };

    const partySkills = Array.isArray(m?.skills) ? m.skills : [];
    for (const x of partySkills) add(normalizeSkill(x, "Party"));

    const nm = String(m?.identity?.name || "").trim().toLowerCase();
    const coreNm = String(s?.character?.name || "").trim().toLowerCase();
    const isUser = (Array.isArray(m?.roles) && m.roles.includes("User")) || (nm && coreNm && nm === coreNm);

    if (isUser) {
        const invSkills = Array.isArray(s?.inventory?.skills) ? s.inventory.skills : [];
        for (const x of invSkills) add(normalizeSkill(x, "Inventory"));
    }

    if (s && Array.isArray(s.lorebooks)) {
        const charName = String(m?.identity?.name || "").trim();
        for (const book of getActiveLorebooks(s)) {
                for (const entry of Object.values(book.entries || {})) {
                    if (entry && !entry.disable && entry.category === "skill") {
                        if (entryMatchesCharacter(entry, charName)) {
                            add({
                                name: entry.comment || "Unnamed Skill",
                                desc: entry.content || "",
                                description: entry.content || "",
                                skillType: "active",
                                source: "Lorebook"
                            });
                        }
                    }
                }
        }
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

function ensureMemberStarterContent(s, m) {
    if (!m) return;
    ensureMember(m);
    initMemberSkillTree(s, m);
    if (!Array.isArray(m.skills)) m.skills = [];
    if (!m.skills.length) {
        const className = String(m.identity?.class || m.partyRole || "Companion").trim() || "Companion";
        m.skills.push(
            { name: `${className} Aid`, description: "Supports the party with a reliable class action during scenes.", skillType: "active", source: "Starter" },
            { name: "Team Awareness", description: "Keeps track of allies, threats, and openings during travel or conflict.", skillType: "passive", source: "Starter" }
        );
    }
    recalculateMemberSkillsAndStats(s, m);
}

function ensureParty(s) {
    if (!s.party) s.party = { members: [], awayMembers: [], sharedItems: [], relationships: {}, partyTactics: {}, formation: { lanes: { front:[], mid:[], back:[] } } };
    if (!Array.isArray(s.party.members)) s.party.members = [];
    if (!Array.isArray(s.party.awayMembers)) s.party.awayMembers = [];
    if (!Array.isArray(s.party.sharedItems)) s.party.sharedItems = [];
    if (!s.party.partyTactics) s.party.partyTactics = { preset: "Balanced" };
    if (!["adventure", "gothic", "modern", "futuristic"].includes(String(s.party.uiMode || ""))) s.party.uiMode = "adventure";

    if (s && Array.isArray(s.lorebooks)) {
        for (const book of getActiveLorebooks(s)) {
                for (const entry of Object.values(book.entries || {})) {
                    if (entry && !entry.disable && entry.category === "party") {
                        const name = String(entry.comment || "").trim();
                        if (name) {
                            let m = s.party.members.find(x => String(x.identity?.name || "").trim().toLowerCase() === name.toLowerCase());
                            if (!m) {
                                m = defaultMember(name);
                                m.bio = entry.content || "";
                                s.party.members.push(m);
                            } else {
                                if (entry.content && m.bio !== entry.content) {
                                    m.bio = entry.content;
                                }
                            }
                        }
                    }
                }
        }
    }

    for (const m of s.party.members) {
        if (m && typeof m === "object") ensureMember(m);
    }
}

function isUserMember(s, m) {
    const memberName = String(m?.identity?.name || "").trim().toLowerCase();
    const coreName = String(s?.character?.name || "").trim().toLowerCase();
    return (Array.isArray(m?.roles) && m.roles.includes("User")) || (!!memberName && !!coreName && memberName === coreName);
}

function findUserMember(s) {
    const members = Array.isArray(s?.party?.members) ? s.party.members : [];
    const m = members.find((x) => isUserMember(s, x));
    return m || null;
}

function applyCoreToMember(s, m) {
    if (!s || !m) return false;
    ensureMember(m);
    const before = JSON.stringify({ n: m.identity?.name, c: m.identity?.class, v: m.vitals, p: m.progression, st: m.stats, img: m.images });
    const nm = String(s?.character?.name || "User");
    if (nm) m.identity.name = nm;
    const cls = String(s?.character?.className || "").trim();
    if (cls) m.identity.class = cls;
    const coreStats = s?.character?.stats && typeof s.character.stats === "object" ? s.character.stats : null;
    if (coreStats) {
        if (!m.stats || typeof m.stats !== "object") m.stats = {};
        for (const k of Object.keys(coreStats)) {
            const v = Number(coreStats[k]);
            if (Number.isFinite(v)) m.stats[k] = v;
        }
    }
    const av = String(s?.character?.avatar || "").trim();
    const pt = String(s?.character?.portrait || "").trim();
    if (!m.images) m.images = { portrait: "" };
    if (av) m.images.portrait = av;
    else if (pt) m.images.portrait = pt;
    m.vitals.hp = Number(s.hp || 0);
    m.vitals.maxHp = Number(s.maxHp || 0);
    m.vitals.mp = Number(s.mp || 0);
    m.vitals.maxMp = Number(s.maxMp || 0);
    m.vitals.ap = Number(s.ap || 0);
    m.vitals.maxAp = Number(s.maxAp || 0);
    if (!m.progression) m.progression = { level: 1, xp: 0, skillPoints: 0, perkPoints: 0 };
    m.progression.level = Number(s?.character?.level || 1);
    m.progression.xp = Number(s.xp || 0);
    const after = JSON.stringify({ n: m.identity?.name, c: m.identity?.class, v: m.vitals, p: m.progression, st: m.stats, img: m.images });
    return before !== after;
}

function applyMemberToCore(s, m) {
    if (!s || !m) return false;
    ensureMember(m);
    const before = JSON.stringify({ hp: s.hp, maxHp: s.maxHp, mp: s.mp, maxMp: s.maxMp, ap: s.ap, maxAp: s.maxAp, xp: s.xp, lvl: s?.character?.level, name: s?.character?.name, cls: s?.character?.className, st: s?.character?.stats, av: s?.character?.avatar });
    if (!s.character) s.character = {};
    s.character.name = String(m.identity?.name || s.character.name || "User");
    s.character.className = String(m.identity?.class || s.character.className || "").trim() || s.character.className;
    if (!s.character.stats || typeof s.character.stats !== "object") s.character.stats = {};
    const memberStats = m?.stats && typeof m.stats === "object" ? m.stats : null;
    if (memberStats) {
        for (const k of Object.keys(s.character.stats)) {
            const v = Number(memberStats[k]);
            if (Number.isFinite(v)) s.character.stats[k] = v;
        }
    }
    const av = String(m?.images?.portrait || "").trim();
    if (av) s.character.avatar = av;
    s.hp = Number(m.vitals?.hp || 0);
    s.maxHp = Number(m.vitals?.maxHp || 0);
    s.mp = Number(m.vitals?.mp || 0);
    s.maxMp = Number(m.vitals?.maxMp || 0);
    s.ap = Number(m.vitals?.ap || 0);
    s.maxAp = Number(m.vitals?.maxAp || 0);
    s.xp = Number(m.progression?.xp || s.xp || 0);
    s.character.level = Number(m.progression?.level || s.character.level || 1);
    const after = JSON.stringify({ hp: s.hp, maxHp: s.maxHp, mp: s.mp, maxMp: s.maxMp, ap: s.ap, maxAp: s.maxAp, xp: s.xp, lvl: s?.character?.level, name: s?.character?.name, cls: s?.character?.className, st: s?.character?.stats, av: s?.character?.avatar });
    return before !== after;
}

export function syncPartyUserFromCore() {
    const s = getSettings();
    if (!s) return;
    ensureParty(s);
    const m = findUserMember(s);
    if (!m) return;
    const changed = applyCoreToMember(s, m);
    if (changed) saveSettings();
}

function defaultMember(name) {
    return {
        id: Date.now() + Math.random().toString(36).substr(2, 5),
        identity: { name: name || "Character", class: "Companion", species: "Human", alignment: "Neutral" },
        images: { portrait: "" },
        stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, per: 10, luk: 10, agi: 10, vit: 10, end: 10, spi: 10 },
        vitals: { hp: 100, maxHp: 100, mp: 50, maxMp: 50, ap: 10, maxAp: 10, stamina: 100, maxStamina: 100 },
        progression: { level: 1, xp: 0, skillPoints: 0, perkPoints: 0, reborn: false, activeMedallion: null },
        equipment: {},
        trackers: [],
        partyRole: "DPS",
        roles: [],
        statusEffects: [],
        bio: "",
        notes: "",
        customCSS: "",
        active: true,
        temporary: false,
        followsUser: false,
        personalItems: [],
        tactics: { preset: "Balanced", focus: "auto", protectId: "", conserveMana: false }
    };
}

function getMember(s, id) {
    return s.party.members.find(m => String(m.id) === String(id));
}

function summarizePartyTacticsForRp(s) {
    try {
        ensureParty(s);
        const pt = s?.party?.partyTactics && typeof s.party.partyTactics === "object" ? s.party.partyTactics : {};
        const preset = String(pt?.preset || "Balanced").trim() || "Balanced";
        const conserve = !!pt?.conserveMana;
        const protectLeader = !!pt?.protectLeader;
        return `Preset=${preset}${conserve ? ", ConserveMana=On" : ", ConserveMana=Off"}${protectLeader ? ", ProtectLeader=On" : ", ProtectLeader=Off"}`;
    } catch (_) {
        return "Preset=Balanced";
    }
}

function summarizeFormationForRp(s) {
    try {
        ensureParty(s);
        const lanes = s?.party?.formation?.lanes && typeof s.party.formation.lanes === "object" ?
             s.party.formation.lanes
            : { front: [], mid: [], back: [] };
        const byId = new Map((Array.isArray(s?.party?.members) ? s.party.members : []).map((m) => [String(m?.id || ""), String(m?.identity?.name || "Member")]));
        const laneNames = (laneKey) => (Array.isArray(lanes[laneKey]) ? lanes[laneKey] : [])
            .map((id) => byId.get(String(id || "")) || String(id || ""))
            .filter(Boolean)
            .slice(0, 8);
        const front = laneNames("front");
        const mid = laneNames("mid");
        const back = laneNames("back");
        const used = new Set([...front, ...mid, ...back]);
        const reserve = (Array.isArray(s?.party?.members) ? s.party.members : [])
            .filter((m) => m && m.active !== false)
            .map((m) => String(m?.identity?.name || "").trim())
            .filter((n) => n && !used.has(n))
            .slice(0, 8);
        return `Front=[${front.join(", ") || "-"}], Mid=[${mid.join(", ") || "-"}], Back=[${back.join(", ") || "-"}], Reserve=[${reserve.join(", ") || "-"}]`;
    } catch (_) {
        return "Front=[-], Mid=[-], Back=[-], Reserve=[-]";
    }
}

function ensureMember(m) {
    if (!m.identity) m.identity = { name: "Member" };
    try {
        const legacy = String(m?.name || "").trim();
        const cur = String(m.identity?.name || "").trim();
        if (legacy && (!cur || cur === "Member")) m.identity.name = legacy;
    } catch (_) {}
    if (!m.images) m.images = { portrait: "" };
    if (typeof m.images.paperDoll !== "string") m.images.paperDoll = "";
    if (!Array.isArray(m.skills)) m.skills = [];
    m.skills = m.skills
        .map((x) => {
            if (!x) return null;
            if (typeof x === "string") return { name: x, description: "", skillType: "active" };
            if (typeof x !== "object") return null;
            const name = String(x.name || x.title || x.skill || "").trim();
            const description = String(x.description || x.desc || x.text || "").trim();
            const skillType = String(x.skillType || x.type || "active").toLowerCase();
            return { ...x, name, description, skillType: (skillType === "passive" ? "passive" : "active") };
        })
        .filter(Boolean);

    // Ensure stats object exists
    if (!m.stats) m.stats = {};
    if (!Array.isArray(m.hiddenStats)) m.hiddenStats = [];
    // Fill missing stats with defaults
    const defaultStats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, per: 10, luk: 10, agi: 10, vit: 10, end: 10, spi: 10 };
    for (const k in defaultStats) {
        if (typeof m.stats[k] !== "number") m.stats[k] = defaultStats[k];
    }

    // Ensure vitals object exists
    if (!m.vitals) m.vitals = {};
    const defaultVitals = { hp: 100, maxHp: 100, mp: 50, maxMp: 50, ap: 10, maxAp: 10 };
    for (const k in defaultVitals) {
        if (typeof m.vitals[k] !== "number") m.vitals[k] = defaultVitals[k];
    }

    if (!m.equipment) m.equipment = {};

    // Sync user inventory equipment to user companion card
    if (m && (m.isUser || m.id === "party_user")) {
        let s2 = null;
        try {
            if (typeof window.ensureUiSettings === "function") {
                s2 = window.ensureUiSettings();
            } else if (typeof ensureUiSettings === "function") {
                s2 = ensureUiSettings();
            }
        } catch (_) {}
        if (s2 && s2.inventory && Array.isArray(s2.inventory.equipped)) {
            m.equipment = {};
            s2.inventory.equipped.forEach(eq => {
                if (eq && eq.slotId) {
                    m.equipment[eq.slotId] = eq;
                }
            });
        }
    }

    if (!Array.isArray(m.trackers)) m.trackers = [];
    m.trackers = m.trackers.map((t) => normalizeMemberTracker(t)).filter(Boolean).slice(0, 24);
    if (!m.tactics) m.tactics = { preset: "Balanced" };
    if (!Array.isArray(m.statusEffects)) m.statusEffects = [];
    if (!m.partyRole) m.partyRole = "DPS";
    if (!Array.isArray(m.personalItems)) m.personalItems = [];
    if (typeof m.temporary !== "boolean") m.temporary = false;
    if (typeof m.followsUser !== "boolean") m.followsUser = false;
}

function resolvePartyStashList(s, target) {
    ensureParty(s);
    const t = String(target || "shared");
    
    let list = [];
    if (t === "shared") {
        if (!Array.isArray(s.party.sharedItems)) s.party.sharedItems = [];
        list = [...s.party.sharedItems];
        
        if (s && Array.isArray(s.lorebooks)) {
            for (const book of getActiveLorebooks(s)) {
                    for (const entry of Object.values(book.entries || {})) {
                        if (entry && !entry.disable) {
                            if (entry.category === "item" || entry.category === "world_item" || entry.category === "equipment" || entry.category === "world_equipment") {
                                const isCharSpecific = s.party.members.some(m => {
                                    const mName = String(m.identity?.name || "").trim();
                                    return mName && mName.toLowerCase() !== "companion" && entryMatchesCharacter(entry, mName);
                                });
                                const hasPartyKey = Array.isArray(entry.key) && entry.key.some(k => ["party", "shared", "stash"].includes(String(k).trim().toLowerCase()));
                                if (!isCharSpecific || hasPartyKey) {
                                    list.push({
                                        name: entry.comment || "Unnamed Item",
                                        type: entry.category.includes("equipment") ? "Equipment" : "Item",
                                        description: entry.content || "",
                                        qty: 1,
                                        rarity: "common",
                                        source: "Lorebook"
                                    });
                                }
                            }
                        }
                    }
            }
        }
        return list;
    }
    if (t.startsWith("member:")) {
        const id = t.slice("member:".length);
        const m = getMember(s, id);
        if (!m) return null;
        ensureMember(m);
        list = [...m.personalItems];
        
        if (s && Array.isArray(s.lorebooks)) {
            const charName = String(m.identity?.name || "").trim();
            for (const book of getActiveLorebooks(s)) {
                    for (const entry of Object.values(book.entries || {})) {
                        if (entry && !entry.disable && (entry.category === "item" || entry.category === "world_item" || entry.category === "equipment" || entry.category === "world_equipment")) {
                            if (entryMatchesCharacter(entry, charName)) {
                                list.push({
                                    name: entry.comment || "Unnamed Item",
                                    type: entry.category.includes("equipment") ? "Equipment" : "Item",
                                    description: entry.content || "",
                                    qty: 1,
                                    rarity: "common",
                                    source: "Lorebook"
                                });
                            }
                        }
                    }
            }
        }
        return list;
    }
    return null;
}

function actualPartyInventoryList(s, target) {
    ensureParty(s);
    const t = String(target || "shared");
    if (t === "shared") return s.party.sharedItems;
    if (t.startsWith("member:")) {
        const m = getMember(s, t.slice("member:".length));
        if (!m) return null;
        ensureMember(m);
        return m.personalItems;
    }
    return null;
}

function cloneInventoryItem(item) {
    if (!item || typeof item !== "object") return { name: String(item || "Item"), type: "misc", qty: 1 };
    return JSON.parse(JSON.stringify(item));
}

function itemQuantity(item) {
    const qty = Number(item?.qty ?? item?.quantity ?? 1);
    return Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1;
}

function setItemQuantity(item, qty) {
    const next = Math.max(0, Math.floor(Number(qty) || 0));
    if ("quantity" in item && !("qty" in item)) item.quantity = next;
    else item.qty = next;
}

function findMatchingActualItem(list, clickedItem) {
    if (!Array.isArray(list) || !clickedItem) return -1;
    const id = String(clickedItem.id || "").trim();
    if (id) {
        const byId = list.findIndex((item) => String(item?.id || "").trim() === id);
        if (byId >= 0) return byId;
    }
    const name = String(clickedItem.name || clickedItem.title || "").trim().toLowerCase();
    const type = String(clickedItem.type || clickedItem.category || clickedItem.slot || "misc").trim().toLowerCase();
    return list.findIndex((item) => {
        const itemName = String(item?.name || item?.title || "").trim().toLowerCase();
        const itemType = String(item?.type || item?.category || item?.slot || "misc").trim().toLowerCase();
        return itemName === name && itemType === type;
    });
}

export function transferInventoryItem(s, fromTarget, toTarget, itemIndexOrItem, qty = 1, options = {}) {
    ensureParty(s);
    const from = actualPartyInventoryList(s, fromTarget);
    const to = actualPartyInventoryList(s, toTarget);
    if (!from || !to) return false;
    const displayList = resolvePartyStashList(s, fromTarget) || from;
    const picked = typeof itemIndexOrItem === "number" ? displayList[itemIndexOrItem] : itemIndexOrItem;
    if (!picked || picked.source === "Lorebook") return false;
    const actualIdx = findMatchingActualItem(from, picked);
    if (actualIdx < 0) return false;
    const actual = from[actualIdx];
    const moveQty = Math.max(1, Math.min(itemQuantity(actual), Math.floor(Number(qty) || 1)));
    const moved = cloneInventoryItem(actual);
    setItemQuantity(moved, moveQty);
    const remaining = itemQuantity(actual) - moveQty;
    if (remaining > 0) setItemQuantity(actual, remaining);
    else from.splice(actualIdx, 1);
    to.push(moved);
    if (options.save !== false) {
        const memberId = String(toTarget || "").startsWith("member:") ? String(toTarget).slice("member:".length) : String(fromTarget || "").slice("member:".length);
        const m = memberId ? getMember(s, memberId) : null;
        if (m) recalculateMemberSkillsAndStats(s, m);
        commitStateUpdate({ emit: true, domain: "party" });
    }
    return moved;
}

function equippedVisualOverride(m) {
    const equipment = m?.equipment && typeof m.equipment === "object" ? m.equipment : {};
    const preferred = ["chest", "legs", "head", "hands", "feet", "boots", "armor", "outfit", "accessory1", "accessory2", "weapon", "offhand"];
    const values = preferred.map((slot) => equipment[slot]).concat(Object.values(equipment));
    for (const item of values) {
        if (!item || typeof item !== "object") continue;
        const url = String(item.visualOverride || item.portraitOverride || item.spriteOverride || "").trim();
        if (url) return url;
    }
    return "";
}

export function saveEquipmentLoadout(s, m, slot, item, options = {}) {
    if (!s || !m || !slot) return false;
    ensureParty(s);
    ensureMember(m);
    const slotKey = String(slot || "").trim();
    if (!slotKey) return false;
    if (!m.equipment || typeof m.equipment !== "object") m.equipment = {};
    const previous = m.equipment[slotKey];
    if (previous && options.returnPreviousTo) {
        const list = actualPartyInventoryList(s, options.returnPreviousTo);
        if (list) list.push(cloneInventoryItem(previous));
    }
    if (item) m.equipment[slotKey] = cloneInventoryItem(item);
    else delete m.equipment[slotKey];

    // Sync back to inventory if this is the user
    if (m.isUser || m.id === "party_user") {
        if (!s.inventory) s.inventory = {};
        if (!Array.isArray(s.inventory.equipped)) s.inventory.equipped = [];
        s.inventory.equipped = s.inventory.equipped.filter(eq => eq && eq.slotId !== slotKey);
        if (item) {
            const newItem = cloneInventoryItem(item);
            newItem.slotId = slotKey;
            s.inventory.equipped.push(newItem);
        }
    }

    recalculateMemberSkillsAndStats(s, m);
    commitStateUpdate({ emit: true, domain: "party" });
    return true;
}

export function savePartyOutfit(s, m, outfitName) {
    if (!s || !m || !outfitName) return false;
    ensureParty(s);
    ensureMember(m);
    if (!Array.isArray(m.savedOutfits)) m.savedOutfits = [];
    const name = String(outfitName || "").trim();
    if (!name) return false;
    
    const slotsSnapshot = {};
    if (m.equipment && typeof m.equipment === "object") {
        for (const [k, v] of Object.entries(m.equipment)) {
            if (v) slotsSnapshot[k] = cloneInventoryItem(v);
        }
    }
    
    const portraitSnapshot = String(m.images?.portrait || "").trim();
    const paperDollSnapshot = String(m.images?.paperDoll || "").trim();
    
    const existingIdx = m.savedOutfits.findIndex(o => o.name.toLowerCase() === name.toLowerCase());
    const previous = existingIdx >= 0 ? m.savedOutfits[existingIdx] : null;
    const outfitObj = {
        id: String(previous?.id || `outfit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`),
        name,
        equipment: slotsSnapshot,
        portrait: portraitSnapshot,
        paperDoll: paperDollSnapshot
    };
    
    if (existingIdx >= 0) {
        m.savedOutfits[existingIdx] = outfitObj;
    } else {
        m.savedOutfits.push(outfitObj);
    }
    
    commitStateUpdate({ emit: true, domain: "party" });
    return true;
}

export function loadPartyOutfit(s, m, outfitName) {
    if (!s || !m || !outfitName) return false;
    ensureParty(s);
    ensureMember(m);
    if (!Array.isArray(m.savedOutfits)) return false;
    const name = String(outfitName || "").trim().toLowerCase();
    const outfit = m.savedOutfits.find(o => o.name.toLowerCase() === name);
    if (!outfit) return false;
    
    m.equipment = {};
    if (outfit.equipment && typeof outfit.equipment === "object") {
        for (const [k, v] of Object.entries(outfit.equipment)) {
            if (v) m.equipment[k] = cloneInventoryItem(v);
        }
    }
    
    if (!m.images || typeof m.images !== "object") m.images = {};
    // Restore the snapshot exactly, including a deliberately blank image.
    m.images.portrait = String(outfit.portrait || "");
    m.images.paperDoll = String(outfit.paperDoll || "");
    
    if (isUserMember(s, m)) {
        applyMemberToCore(s, m);
    }
    
    recalculateMemberSkillsAndStats(s, m);
    commitStateUpdate({ emit: true, domain: "party" });
    return true;
}

export function deletePartyOutfit(s, m, outfitName) {
    if (!s || !m || !outfitName) return false;
    ensureParty(s);
    ensureMember(m);
    if (!Array.isArray(m.savedOutfits)) return false;
    const name = String(outfitName || "").trim().toLowerCase();
    const idx = m.savedOutfits.findIndex(o => o.name.toLowerCase() === name);
    if (idx >= 0) {
        m.savedOutfits.splice(idx, 1);
        commitStateUpdate({ emit: true, domain: "party" });
        return true;
    }
    return false;
}

function resolvePortraitUrl(s, m) {
    const visual = equippedVisualOverride(m);
    if (visual) return visual;
    return resolvePartyPortraitUrl(s, m, { isUser: isUserMember(s, m) });
}

function memberInitials(m) {
    const name = String(m?.identity?.name || m?.name || "NPC").trim();
    const parts = name.split(/\s+/).filter(Boolean);
    const letters = (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.slice(0, 2)).toUpperCase();
    return letters.replace(/[^A-Z0-9]/g, "").slice(0, 2) || "NPC";
}

function memberPortraitFallbackHtml(m, size = 60) {
    return `<div class="party-avatar-safe" style="position:relative;width:100%;height:100%;display:grid;place-items:center;overflow:hidden;border-radius:inherit;background:linear-gradient(145deg,rgba(40,26,14,0.8),rgba(20,12,6,0.9));"><img src="${esc(DEFAULT_PARTY_PORTRAITS.party)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center bottom;"></div>`;
}

function partyStatusIcon(effect) {
    const name = String(effect?.name || effect || "").toLowerCase();
    if (/poison|toxic|venom/.test(name)) return "fa-flask-vial";
    if (/burn|fire/.test(name)) return "fa-fire-flame-curved";
    if (/bleed|hemorr/.test(name)) return "fa-droplet";
    if (/stun|shock|paraly/.test(name)) return "fa-bolt";
    if (/freeze|frost|cold/.test(name)) return "fa-snowflake";
    if (/disease|sick|infect/.test(name)) return "fa-virus";
    if (/curse|hex|doom/.test(name)) return "fa-skull";
    if (/bless|inspir|energ|haste/.test(name)) return "fa-sun";
    if (/regen|heal/.test(name)) return "fa-heart-pulse";
    if (/sleep|tired|fatigue|exhaust/.test(name)) return "fa-bed";
    return "fa-shield-halved";
}

function partyStatusDetail(effect, now = Date.now()) {
    const remaining = formatRemaining(effect?.expiresAt, now) || "No set duration";
    const description = String(effect?.desc || "No description recorded.").trim();
    const modifiers = summarizeMods(effect?.mods).join(", ") || "No numeric modifiers";
    return `${effect?.name || "Status effect"}\n${description}\nDuration: ${remaining}\nEffects: ${modifiers}`;
}

function memberPortraitHtml(s, m, size = 60, imgStyle = "") {
    const portraitUrl = resolvePortraitUrl(s, m);
    if (portraitUrl) {
        const style = imgStyle || "width:100%;height:100%;object-fit:contain;object-position:center bottom;";
        return `<div class="party-avatar-safe" style="position:relative;width:100%;height:100%;display:grid;place-items:center;overflow:hidden;border-radius:inherit;background:linear-gradient(145deg,rgba(40,26,14,0.8),rgba(20,12,6,0.9));"><img src="${esc(portraitUrl)}" style="position:absolute;inset:0;${style}" onerror="if(!this.dataset.partyFallback){this.dataset.partyFallback='1';this.src='${esc(DEFAULT_PARTY_PORTRAITS.party)}';}else{this.style.display='none';}"></div>`;
    }
    return memberPortraitFallbackHtml(m, size);
}

function pickLocalImage() {
    return new Promise((resolve) => {
        const input = document.getElementById("uie-party-file");
        if (!input) return resolve(null);

        // Reset value so change event triggers even if same file selected
        input.value = "";

        const prev = {
            display: input.style.display,
            position: input.style.position,
            left: input.style.left,
            top: input.style.top,
            width: input.style.width,
            height: input.style.height,
            opacity: input.style.opacity,
            pointerEvents: input.style.pointerEvents,
            zIndex: input.style.zIndex
        };
        try {
            input.style.display = "block";
            input.style.position = "fixed";
            input.style.left = "-9999px";
            input.style.top = "0px";
            input.style.width = "1px";
            input.style.height = "1px";
            input.style.opacity = "0";
            input.style.pointerEvents = "none";
            input.style.zIndex = "2147483647";
        } catch (_) {}

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) {
                try { Object.assign(input.style, prev); } catch (_) {}
                return resolve(null);
            }
            const reader = new FileReader();
            reader.onload = (ev) => {
                try { Object.assign(input.style, prev); } catch (_) {}
                resolve(ev.target.result);
            };
            reader.readAsDataURL(file);
        };
        input.click();
    });
}

function renderRoster(s) {
    const container = $("#uie-party-body").empty();
    const controlsTpl = document.getElementById("uie-party-roster-controls");
    const mode = ["modern", "futuristic"].includes(String(s?.party?.uiMode || "")) ? String(s.party.uiMode) : "gothic";
    const itemTpl = document.getElementById(`uie-party-roster-item-${mode}`) || document.getElementById("uie-party-roster-item");
    if (!controlsTpl?.content || !itemTpl?.content) {
        const members = Array.isArray(s?.party?.members) ? s.party.members : [];
        const rows = members.length ?
             members.map((m) => {
                const active = selectedId === String(m?.id || "") ? " style=\"border-color:rgba(245,212,138,0.7);\"" : "";
                const name = esc(String(m?.identity?.name || "Member"));
                const lvl = Number(m?.progression?.level || 1);
                const role = esc(String(m?.partyRole || "DPS"));
                return `<div class="party-row" data-id="${esc(String(m?.id || ""))}"${active}><div class="party-row-name">${name}</div><div class="party-row-desc">Lv.${lvl} • ${role}</div></div>`;
            }).join("")
            : `<div class="party-empty" style="opacity:0.75;">No party characters yet.</div>`;
        container.html(`
            <div style="display:flex; gap:8px; margin-bottom:10px;">
                <select id="party-add-scene-select" style="flex:1;min-width:180px;"></select>
                <button id="party-add">Add</button>
                <button id="party-import-card">Import Card</button>
                <button id="party-scan-chat">Scan Chat</button>
            </div>
            <div class="party-list">${rows}</div>
        `);
        populatePartySceneAddSelect(s, container);
        return;
    }
    const controls = controlsTpl.content.cloneNode(true);
    container.append(controls);
    populatePartySceneAddSelect(s, container);

    const list = container.find(".party-list");
    const members = s.party.members || [];

    if (members.length === 0) {
        container.find(".party-empty").show();
    } else {
        const tmpl = itemTpl.content;
        members.forEach(m => {
            ensureMember(m);
            const el = $(tmpl.cloneNode(true));
            const row = el.find(".party-row");
            row.attr("data-id", m.id);
            row.css({ cursor: "pointer", pointerEvents: "auto" });
            if (selectedId === String(m.id)) row.addClass("active");

            const imgContainer = el.find(".party-row-img-container");
            imgContainer.html(memberPortraitHtml(s, m, 60));

            el.find(".party-row-name").text(m.identity?.name || "Member");
            el.find(".party-row-name").css("color", m.active ? "#fff" : "rgba(255,255,255,0.45)");

            const tempTag = m.temporary === true ? " • Temporary" : "";
            el.find(".party-row-desc").text(`Lv.${m.progression?.level || 1} · ${m.partyRole || "DPS"} · ${m.identity?.class || "Companion"}${tempTag}`);

            const isLeader = s.party.leaderId === String(m.id);
            row.toggleClass("reserve", m.active === false);
            row.toggleClass("leader", isLeader);
            const actionsHtml = `
                <div class="party-row-actions" style="display:flex;gap:4px;align-items:center;flex-shrink:0;">
                    <button class="party-mini" data-act="edit" data-id="${esc(String(m.id))}" title="Edit Member" style="padding:5px 8px;font-size:11px;"><i class="fa-solid fa-pen"></i></button>
                    <button class="party-mini" data-act="leader" data-id="${esc(String(m.id))}" title="Set Leader" style="padding:5px 8px;font-size:11px;color:${isLeader ? '#cba35c' : 'inherit'};"><i class="fa-solid fa-crown"></i></button>
                    <button class="party-mini" data-act="toggleFollow" data-id="${esc(String(m.id))}" title="${m.followsUser === true ? 'Stop following user' : 'Follow user'}" style="padding:5px 8px;font-size:11px;color:${m.followsUser === true ? '#7dd3fc' : 'rgba(255,255,255,0.3)'};"><i class="fa-solid fa-shoe-prints"></i></button>
                    <button class="party-mini" data-act="toggleActive" data-id="${esc(String(m.id))}" title="${m.active !== false ? 'Deactivate' : 'Activate'}" style="padding:5px 8px;font-size:11px;color:${m.active !== false ? '#2ecc71' : 'rgba(255,255,255,0.3)'};"><i class="fa-solid fa-circle-check"></i></button>
                    <button class="party-mini" data-act="delete" data-id="${esc(String(m.id))}" title="Remove" style="padding:5px 8px;font-size:11px;color:var(--danger);"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
            // Append action buttons to the roster row (stop propagation so row click doesn't fire)
            const actionsEl = $(actionsHtml);
            row.append(actionsEl);

            list.append(el);
        });
    }
}

function renderSheet(s) {
    const members = s.party.members || [];
    if (!members.length) {
        $("#uie-party-body").html(`<div style="opacity:0.75; text-align:center; padding:30px; border-radius:14px; border:1px dashed rgba(255,255,255,0.18);">Add a party member first.</div>`);
        return;
    }

    const m = getActiveOrFirstMember(s);
    ensureMember(m);

    const container = $("#uie-party-body").empty();
    const content = $(document.getElementById("uie-party-sheet-view").content.cloneNode(true));
    container.append(content);

    container.find(".sheet-portrait").html(memberPortraitHtml(s, m, 180, "width:100%;height:100%;object-fit:contain;object-position:center bottom;"));

    container.find(".sheet-name").text(m.identity.name);
    container.find(".sheet-details").text(`${m.identity.class || "Companion"} · Lv.${Number(m.progression?.level || 1)} · ${m.partyRole || "DPS"}`);

    const select = container.find(".party-sheet-member-select");
    if (select.length) {
        select.attr("id", "party-sheet-member");
        members.forEach(x => {
            const opt = $("<option>").val(x.id).text(x.identity?.name || "Member");
            if (String(x.id) === String(m.id)) opt.prop("selected", true);
            select.append(opt);
        });
    }

    const statGrid = container.find(".stats-grid");
    const statTmpl = document.getElementById("uie-party-stat-row").content;
    const labels = { ...(s?.character?.statLabels || {}), ...(s?.statLabels || {}) };
    const defaultKeys = ["str", "dex", "con", "int", "wis", "cha", "per", "luk", "agi", "vit", "end", "spi"];
    const hiddenStats = new Set((m.hiddenStats || []).map(String));
    const stats = Array.from(new Set([...defaultKeys, ...Object.keys(m.stats || {})]))
        .filter(Boolean)
        .filter((k) => !hiddenStats.has(k))
        .map((k) => ({ l: String(labels[k] || k).toUpperCase(), k }));
    stats.forEach(st => {
        const el = $(statTmpl.cloneNode(true));
        el.attr("data-stat-key", st.k);
        el.find(".stat-lbl").text(st.l);
        el.find(".stat-val").text(Number(m.stats[st.k] || 0));
        if (partyAttributeEditMode) {
            el.append(`<span class="party-sheet-stat-actions"><button type="button" class="party-sheet-stat-edit party-mini" data-stat="${esc(st.k)}" title="Edit ${esc(st.l)}"><i class="fa-solid fa-pen"></i><span class="sr-only">Edit ${esc(st.l)}</span></button><button type="button" class="party-sheet-stat-delete party-mini danger" data-stat="${esc(st.k)}" title="Remove ${esc(st.l)}"><i class="fa-solid fa-trash"></i><span class="sr-only">Remove ${esc(st.l)}</span></button></span>`);
        }
        statGrid.append(el);
    });
    container.find(".party-sheet-stat-add").toggle(partyAttributeEditMode);
    container.find(".party-sheet-stat-mode")
        .toggleClass("active", partyAttributeEditMode)
        .attr("aria-pressed", partyAttributeEditMode ? "true" : "false")
        .attr("title", partyAttributeEditMode ? "Finish editing attributes" : "Edit attributes");

    renderSheetTrackers(container, m);
    const effects = container.find(".party-sheet-effects").empty();
    const statusEffects = normalizeStatusList(m.statusEffects, Date.now());
    if (!statusEffects.length) {
        effects.append(`<div class="party-empty">No effects on this character.</div>`);
    } else {
        statusEffects.forEach((effect, index) => {
            const remaining = formatRemaining(effect.expiresAt, Date.now());
            effects.append(`<div class="party-tracker-card party-sheet-effect-row"><button type="button" class="party-fx party-status-summary" data-detail="${esc(partyStatusDetail(effect))}" title="Open ${esc(effect.name)} details"><i class="fa-solid ${partyStatusIcon(effect)}"></i><span>${esc(effect.name)}</span>${remaining ? `<small>${esc(remaining)}</small>` : ""}</button><button type="button" class="party-sheet-effect-delete party-mini" data-effect-key="${esc(statusKey(effect))}" title="Remove effect"><i class="fa-solid fa-xmark"></i></button></div>`);
        });
    }

    if (select.length) {
        select.on("change", function() {
            selectedId = $(this).val();
            render();
        });
    }
}

function renderGear(s) {
    const members = s.party.members || [];
    if (!members.length) {
        $("#uie-party-body").html(`<div style="opacity:0.75; text-align:center; padding:30px; border-radius:14px; border:1px dashed rgba(255,255,255,0.18);">Add a party member first.</div>`);
        return;
    }

    const m = getActiveOrFirstMember(s);
    ensureMember(m);

    const container = $("#uie-party-body").empty();
    const content = $(document.getElementById("uie-party-gear-view").content.cloneNode(true));
    container.append(content);

    container.prepend(`
        <div class="party-gear-portrait-row" style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:12px;border:1px solid rgba(255,255,255,0.08);border-radius:14px;background:rgba(0,0,0,0.18);">
            <div style="width:58px;height:58px;flex:0 0 58px;overflow:hidden;border-radius:50%;">${memberPortraitHtml(s, m, 58)}</div>
            <div style="min-width:0;flex:1;">
                <div style="font-weight:900;color:var(--accent-gold);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(m.identity?.name || "Member")}</div>
                <div style="font-size:12px;color:var(--text-muted);">Companion gear profile image</div>
            </div>
            <button type="button" class="party-gear-portrait-pick" data-id="${esc(String(m.id))}" style="padding:8px 12px!important;">Image</button>
        </div>
    `);

    // Member Select
    const select = container.find(".party-gear-member-select");
    select.attr("id", "party-gear-member");
    members.forEach(x => {
        const opt = $("<option>").val(x.id).text(x.identity?.name || "Member");
        if (String(x.id) === String(m.id)) opt.prop("selected", true);
        select.append(opt);
    });

    const grid = container.find(".gear-grid");
    const slotTmpl = document.getElementById("uie-party-gear-slot").content;

    // Render Layer Tabs
    const layerNav = $(`<div class="party-layer-tabs" style="display:flex;gap:6px;margin-bottom:12px;overflow-x:auto;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.08);width:100%;"></div>`);
    COMPANION_LAYERS.forEach((layer, idx) => {
        const active = partyCurrentLayerIndex === idx;
        const btn = $(`<button type="button" class="party-layer-tab reply-tool-btn" style="width:auto;padding:6px 12px;font-size:11px;font-weight:900;background:${active ? 'linear-gradient(135deg, var(--party-gold), var(--party-green))' : 'rgba(255,255,255,0.04)'};color:${active ? '#07111f' : '#fff'};border-color:${active ? 'var(--party-gold)' : 'rgba(255,255,255,0.1)'};">${layer.name}</button>`);
        btn.on("click", () => {
            partyCurrentLayerIndex = idx;
            renderGear(s);
        });
        layerNav.append(btn);
    });
    grid.before(layerNav);

    // OUTFITS Tab rendering
    if (partyCurrentLayerIndex === 0) {
        grid.hide();
        const outfitContainer = $(`<div class="party-outfits-container" style="display:grid;gap:12px;width:100%;"></div>`);
        
        // Toolbar
        const toolbar = $(`<div class="party-outfit-toolbar"></div>`);
        const saveCurrentBtn = $(`<button type="button" class="reply-tool-btn party-outfit-save"><i class="fa-solid fa-floppy-disk"></i> Save current outfit</button>`);
        saveCurrentBtn.on("click", () => {
            const name = window.prompt("Enter outfit name:", "Companion Fit");
            if (name && name.trim()) {
                savePartyOutfit(s, m, name.trim());
                renderGear(s);
                notify("success", `Outfit saved with current image and equipment.`, "Party");
            }
        });
        toolbar.append(saveCurrentBtn);
        outfitContainer.append(toolbar);
        
        const outfits = Array.isArray(m.savedOutfits) ? m.savedOutfits : [];
        if (outfits.length === 0) {
            outfitContainer.append(`<div style="opacity:0.75;text-align:center;padding:24px;border:1px dashed rgba(255,255,255,0.12);border-radius:8px;font-size:12px;background:rgba(0,0,0,0.12);">No saved outfits yet. Equip items in other layers and click Save Current Loadout above to store a preset.</div>`);
        } else {
            outfits.forEach((outfit) => {
                const outfitImage = String(outfit.paperDoll || outfit.portrait || "").trim();
                const thumb = outfitImage
                    ? `<img src="${esc(outfitImage)}" alt="${esc(outfit.name)} outfit preview">`
                    : `<i class="fa-solid fa-shirt" aria-hidden="true"></i>`;
                const card = $(`
                    <div class="party-outfit-card">
                        <div class="party-outfit-thumb">${thumb}</div>
                        <div class="party-outfit-copy">
                            <strong>${esc(outfit.name)}</strong>
                            <span>${Object.keys(outfit.equipment || {}).length} equipped item${Object.keys(outfit.equipment || {}).length === 1 ? "" : "s"}</span>
                        </div>
                        <div class="party-outfit-actions">
                            <button type="button" class="reply-tool-btn wear-btn"><i class="fa-solid fa-shirt"></i> Wear</button>
                            <button type="button" class="reply-tool-btn delete-btn" style="border-color:var(--party-red)!important;color:var(--party-red)!important;"><i class="fa-solid fa-trash"></i> Delete</button>
                        </div>
                    </div>
                `);
                card.find(".wear-btn").on("click", () => {
                    loadPartyOutfit(s, m, outfit.name);
                    renderGear(s);
                    notify("success", `Equipped outfit: ${outfit.name}`, "Party");
                });
                card.find(".delete-btn").on("click", () => {
                    if (confirm(`Delete outfit "${outfit.name}"?`)) {
                        deletePartyOutfit(s, m, outfit.name);
                        renderGear(s);
                    }
                });
                outfitContainer.append(card);
            });
        }
        
        grid.after(outfitContainer);
    } else {
        grid.show();
        grid.empty();
        const activeLayer = COMPANION_LAYERS[partyCurrentLayerIndex];
        const slots = activeLayer.name === "GEAR"
            ? [...activeLayer.slots, ...getCustomEquipmentSlots(s), { id: "__add_custom_slot__", label: "Add Equipment Slot", icon: "fa-plus", _add: true }]
            : activeLayer.slots;
        const SLOT_LABELS = {
            undies: "Undies", socks: "Socks", tattoo: "Tattoo", scar: "Scar",
            ears: "Ears", face: "Face", ink: "Ink", soul: "Soul",
            shirt: "Shirt", pants: "Pants", vest: "Vest", belt: "Belt",
            boots: "Boots", gloves: "Gloves", aura: "Aura", bag: "Bag",
            head: "Head", chest: "Chest", legs: "Legs", feet: "Feet",
            hands: "Hands", shldr: "Shoulder", back: "Back", neck: "Neck",
            main: "Main Hand", off: "Off Hand", range: "Ranged", ammo: "Ammo",
            r1: "Ring 1", r2: "Ring 2", relic: "Relic", tool: "Tool",
            trinket: "Trinket", focus: "Focus", quick: "Quick Slot", utility: "Utility",
            outfit: "Outfit"
        };

        slots.forEach(slotObj => {
            const slot = slotObj.id;
            const el = $(slotTmpl.cloneNode(true));
            const slotEl = el.find(".party-slot");
            slotEl.attr("data-slot", slot);
            if (slotObj._add) slotEl.attr("data-add-slot", "true").addClass("party-add-equipment-slot");

            const item = slotObj._add ? null : m.equipment?.[slot];
            const iconContainer = el.find(".slot-icon-container");

            if (item && typeof item === "object") {
                const rarity = String(item.rarity || item.quality || "common").toLowerCase().trim();
                slotEl.addClass(`rarity-${rarity}`);
            }

            const itemImg = item && typeof item === "object" ? String(item.img || item.image || item.icon || item.visualOverride || "").trim() : "";
            if (itemImg) {
                iconContainer.html(`<img src="${esc(itemImg)}" style="width:100%;height:100%;object-fit:cover;">`);
            } else {
                iconContainer.html(`<i class="fa-solid ${slotObj.icon || 'fa-circle-question'}" style="opacity:0.3;font-size:22px;color:var(--party-muted);"></i>`);
            }

            el.find(".slot-label").text(slotObj.label || SLOT_LABELS[slot] || slot);
            grid.append(el);
        });
    }

    select.on("change", function() {
        selectedId = $(this).val();
        render();
    });
}

function renderInventory(s) {
    const container = $("#uie-party-body").empty();
    const content = $(document.getElementById("uie-party-inventory-view").content.cloneNode(true));
    container.append(content);

    const members = (s.party.members || []).filter((m) => m && m.active !== false);
    for (const m of members) ensureMember(m);

    const $targetSel = container.find("#party-inv-target");
    const validTargets = new Set(["shared", ...members.map((m) => `member:${m.id}`)]);
    if (!validTargets.has(partyInventoryTarget)) partyInventoryTarget = "shared";

    $targetSel.empty();
    $targetSel.append($("<option>").val("shared").text("Party shared stash"));
    for (const m of members) {
        const nm = String(m.identity?.name || "Member").trim() || "Member";
        $targetSel.append($("<option>").val(`member:${m.id}`).text(`Personal — ${nm}`));
    }
    $targetSel.val(partyInventoryTarget);
    const selectedMember = String(partyInventoryTarget || "").startsWith("member:")
        ? getMember(s, String(partyInventoryTarget).slice("member:".length))
        : null;
    container.find(".party-inv-title").text(partyInventoryTarget === "shared"
        ? "Shared Party Bag"
        : `${selectedMember?.identity?.name || "Member"}'s Bag`);
    container.find(".party-inv-tab").removeClass("active").attr("aria-selected", "false");
    container.find(`.party-inv-tab[data-inventory-scope="${partyInventoryTarget === "shared" ? "shared" : "personal"}"]`)
        .addClass("active").attr("aria-selected", "true");
    container.find(".party-inv-description").text(partyInventoryTarget === "shared"
        ? "Supplies available to the whole party. Transfer, equip, or gift them from here."
        : `Items carried by ${selectedMember?.identity?.name || "this companion"}.`);
    container.find(".party-inv-tab[data-inventory-scope='personal']").prop("disabled", !members.length);
    $targetSel.off("change.partyInvTgt").on("change.partyInvTgt", function () {
        partyInventoryTarget = String($(this).val() || "shared");
        render();
    });

    const btn = container.find(".party-inv-add");
    btn.attr("id", "party-inv-add");

    const items = resolvePartyStashList(s, partyInventoryTarget) || [];
    const list = container.find(".party-inv-list");

    if (items.length) {
        const itemTmpl = document.getElementById("uie-party-inventory-item").content;
        items.forEach((it, i) => {
            const el = $(itemTmpl.cloneNode(true));
            const row = el.find(".party-inv-row");
            row.attr("data-inv-target", partyInventoryTarget);
            el.find(".inv-name").text(it.name || "Item");
            if (it.source === "Lorebook") {
                el.find(".inv-name").css("color", "rgba(111,211,255,0.9)");
                el.find(".inv-type").text(`${it.type} (Lore)`);
                el.find(".party-inv-del").css({ opacity: 0.3, cursor: "not-allowed" }).prop("title", "Defined in Lorebooks");
                el.find(".party-inv-gift").css({ opacity: 0.3, cursor: "not-allowed" }).prop("title", "Lorebook items cannot be gifted");
            } else {
                el.find(".inv-type").text(it.type || "Misc");
            }
            const delBtn = el.find(".party-inv-del");
            delBtn.attr("data-idx", i);
            const giftBtn = el.find(".party-inv-gift");
            giftBtn.attr("data-idx", i);
            const transferBtn = $(`<button type="button" class="party-inv-transfer reply-tool-btn" data-idx="${i}" style="width:auto; padding:0 10px; font-size:12px; font-weight:800;" title="Transfer between personal bag and shared stash">${partyInventoryTarget === "shared" ? "To Bag" : "To Stash"}</button>`);
            giftBtn.before(transferBtn);
            list.append(el);
        });
        container.find(".party-inv-empty").hide();
    } else {
        container.find(".party-inv-empty")
            .html(partyInventoryTarget === "shared"
                ? `<i class="fa-solid fa-people-group"></i><strong>The shared bag is ready.</strong><span>Add supplies here so every companion can use them.</span>`
                : `<i class="fa-solid fa-bag-shopping"></i><strong>This personal bag is empty.</strong><span>Add an item or transfer one from the shared bag.</span>`)
            .css("display", "grid");
    }
}

function cropPartyImage(dataUrl, kind = "portrait") {
    return new Promise((resolve) => {
        const portraitMode = kind !== "paperDoll";
        const outWidth = portraitMode ? 720 : 720;
        const outHeight = portraitMode ? 720 : 960;
        const modal = document.createElement("div");
        modal.className = "party-cropper-overlay";
        modal.innerHTML = `
            <section class="party-cropper" role="dialog" aria-modal="true" aria-labelledby="party-crop-title">
                <header><div><h3 id="party-crop-title">Fit ${portraitMode ? "portrait" : "paper doll"}</h3><p>Drag to reposition. Use the slider to zoom.</p></div><button type="button" data-crop-cancel aria-label="Cancel"><i class="fa-solid fa-xmark"></i></button></header>
                <div class="party-crop-stage ${portraitMode ? "is-square" : "is-paperdoll"}"><canvas width="${outWidth}" height="${outHeight}"></canvas></div>
                <label class="party-crop-zoom"><span>Zoom</span><input type="range" min="1" max="3" step="0.01" value="1"></label>
                <footer><button type="button" data-crop-cancel>Cancel</button><button type="button" data-crop-save><i class="fa-solid fa-crop-simple"></i> Use image</button></footer>
            </section>`;
        document.body.appendChild(modal);
        const canvas = modal.querySelector("canvas");
        const ctx = canvas.getContext("2d");
        const zoomInput = modal.querySelector("input[type=range]");
        const img = new Image();
        let zoom = 1;
        let offsetX = 0;
        let offsetY = 0;
        let dragging = false;
        let lastX = 0;
        let lastY = 0;
        const baseScale = () => Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
        const clamp = () => {
            const sw = img.naturalWidth * baseScale() * zoom;
            const sh = img.naturalHeight * baseScale() * zoom;
            offsetX = Math.max((canvas.width - sw) / 2, Math.min((sw - canvas.width) / 2, offsetX));
            offsetY = Math.max((canvas.height - sh) / 2, Math.min((sh - canvas.height) / 2, offsetY));
        };
        const draw = () => {
            if (!img.naturalWidth) return;
            clamp();
            const scale = baseScale() * zoom;
            const sw = img.naturalWidth * scale;
            const sh = img.naturalHeight * scale;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, (canvas.width - sw) / 2 + offsetX, (canvas.height - sh) / 2 + offsetY, sw, sh);
        };
        const finish = (value) => { modal.remove(); resolve(value); };
        img.onload = draw;
        img.onerror = () => finish(null);
        img.src = dataUrl;
        zoomInput.addEventListener("input", () => { zoom = Number(zoomInput.value) || 1; draw(); });
        canvas.addEventListener("pointerdown", (event) => { dragging = true; lastX = event.clientX; lastY = event.clientY; canvas.setPointerCapture(event.pointerId); });
        canvas.addEventListener("pointermove", (event) => {
            if (!dragging) return;
            const rect = canvas.getBoundingClientRect();
            offsetX += (event.clientX - lastX) * canvas.width / rect.width;
            offsetY += (event.clientY - lastY) * canvas.height / rect.height;
            lastX = event.clientX; lastY = event.clientY; draw();
        });
        canvas.addEventListener("pointerup", () => { dragging = false; });
        modal.querySelectorAll("[data-crop-cancel]").forEach((button) => button.addEventListener("click", () => finish(null)));
        modal.querySelector("[data-crop-save]").addEventListener("click", () => finish(canvas.toDataURL("image/jpeg", 0.9)));
    });
}

function renderFormation(s) {
    const container = $("#uie-party-body").empty();
    const content = $(`
        <section class="party-panel" style="overflow-y:auto; height:100%; max-height:100%;">
            <div style="font-weight:900; font-size:14px; text-transform:uppercase; color:var(--party-gold-bright); margin-bottom:16px; border-bottom:1px solid rgba(0, 229, 255, 0.15); padding-bottom:6px;">
                Tactical Positioning &amp; Roles
            </div>
            <div class="formation-board-grid">
                <!-- Back Line Column -->
                <div class="formation-lane-column lane-rearguard" data-lane="back">
                    <div class="lane-header">
                        <i class="fa-solid fa-wand-sparkles"></i>
                        <span class="lane-header-title">Back Line (Rearguard)</span>
                    </div>
                    <div class="lane-buff-tag">Rearguard: +20% INT/WIS, +15% MP</div>
                    <div class="lane-member-list" id="lane-back-list"></div>
                </div>
                
                <!-- Mid Line Column -->
                <div class="formation-lane-column lane-assault" data-lane="mid">
                    <div class="lane-header">
                        <i class="fa-solid fa-swords"></i>
                        <span class="lane-header-title">Mid Line (Assault)</span>
                    </div>
                    <div class="lane-buff-tag">Assault: +15% STR/DEX, +10% Crit</div>
                    <div class="lane-member-list" id="lane-mid-list"></div>
                </div>
                
                <!-- Front Line Column -->
                <div class="formation-lane-column lane-vanguard" data-lane="front">
                    <div class="lane-header">
                        <i class="fa-solid fa-shield-halved"></i>
                        <span class="lane-header-title">Front Line (Vanguard)</span>
                    </div>
                    <div class="lane-buff-tag">Vanguard: +20% HP/VIT, +15% Phys Res</div>
                    <div class="lane-member-list" id="lane-front-list"></div>
                </div>
            </div>
            
            <!-- Reserve Pool Column -->
            <div class="lane-reserve" data-lane="reserve">
                <div class="lane-header">
                    <i class="fa-solid fa-leaf"></i>
                    <span class="lane-header-title">Reserve Pool (Inactive Support)</span>
                </div>
                <div class="lane-buff-tag">Support: +2% HP/MP passive recovery per turn</div>
                <div class="lane-member-list" id="lane-reserve-list"></div>
            </div>
        </section>
    `);
    container.append(content);

    const members = Array.isArray(s.party.members) ? s.party.members : [];
    const roleOptions = ["Tank","Healer","DPS","Support","Mage","Ranger","Scout","Leader","Bruiser"];
    
    if (!s.party.formation) s.party.formation = { lanes: { front: [], mid: [], back: [] } };
    if (!s.party.formation.lanes) s.party.formation.lanes = { front: [], mid: [], back: [] };
    const lanes = s.party.formation.lanes;

    const laneLists = {
        front: container.find("#lane-front-list"),
        mid: container.find("#lane-mid-list"),
        back: container.find("#lane-back-list"),
        reserve: container.find("#lane-reserve-list")
    };

    if (!members.length) {
        container.html(`<div class="party-empty">No party members.</div>`);
        return;
    }

    members.forEach(m => {
        ensureMember(m);
        const mid = String(m.id);
        
        let currentPos = "reserve";
        if (Array.isArray(lanes.front) && lanes.front.map(String).includes(mid)) currentPos = "front";
        else if (Array.isArray(lanes.mid) && lanes.mid.map(String).includes(mid)) currentPos = "mid";
        else if (Array.isArray(lanes.back) && lanes.back.map(String).includes(mid)) currentPos = "back";

        // Create character card
        const card = $(`
            <div class="formation-member-card">
                <div class="card-avatar">${memberPortraitHtml(s, m, 38)}</div>
                <div style="min-width:0; flex:1;">
                    <div class="card-name">${esc(m.identity?.name || "Member")}</div>
                    <div class="card-info">Lv ${Number(m.progression?.level||1)} · ${esc(m.identity?.class||"Companion")}</div>
                    
                    <!-- Combat Role Mini-Select -->
                    <select class="form-role-select" style="margin-top:4px; padding:2px 4px; font-size:10px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:4px; color:#fff; cursor:pointer;" title="Change Combat Role"></select>
                </div>
                
                <div class="card-actions">
                    <!-- Action Move Buttons -->
                    <button type="button" class="action-arrow-btn move-left" title="Shift Left/Backwards"><i class="fa-solid fa-chevron-left"></i></button>
                    <button type="button" class="action-arrow-btn move-right" title="Shift Right/Forwards"><i class="fa-solid fa-chevron-right"></i></button>
                    ${currentPos !== "reserve" ? `<button type="button" class="action-arrow-btn send-to-reserve" title="Send to Reserve" style="color:var(--party-red);"><i class="fa-solid fa-xmark"></i></button>` : ""}
                </div>
            </div>
        `);

        // Populate role dropdown
        const roleSel = card.find(".form-role-select");
        roleOptions.forEach(r => {
            const opt = $("<option>").val(r).text(r);
            if ((m.partyRole || "DPS") === r) opt.prop("selected", true);
            roleSel.append(opt);
        });

        roleSel.on("change", function(e) {
            e.stopPropagation();
            m.partyRole = $(this).val();
            saveSettings();
            commitStateUpdate({ emit: true, domain: "party" });
        });

        // Set action event handlers
        const moveLeft = card.find(".move-left");
        const moveRight = card.find(".move-right");
        const toReserve = card.find(".send-to-reserve");

        // Action logic based on current position
        if (currentPos === "front") {
            moveRight.hide(); // Can't go right/forward of front
            moveLeft.on("click", () => moveMemberPosition(s, mid, "mid"));
        } else if (currentPos === "mid") {
            moveRight.on("click", () => moveMemberPosition(s, mid, "front"));
            moveLeft.on("click", () => moveMemberPosition(s, mid, "back"));
        } else if (currentPos === "back") {
            moveRight.on("click", () => moveMemberPosition(s, mid, "mid"));
            moveLeft.on("click", () => moveMemberPosition(s, mid, "reserve"));
        } else if (currentPos === "reserve") {
            moveLeft.hide(); // Can't go left
            moveRight.on("click", () => moveMemberPosition(s, mid, "back"));
        }

        if (toReserve.length) {
            toReserve.on("click", () => moveMemberPosition(s, mid, "reserve"));
        }

        laneLists[currentPos].append(card);
    });

    // If a lane has no members, show a placeholder
    Object.entries(laneLists).forEach(([laneKey, $list]) => {
        if (!$list.children().length) {
            $list.html(`<div class="party-empty" style="padding:12px; font-size:11px; border:1.5px dashed rgba(255,255,255,0.06); background:transparent;">Empty Lane</div>`);
        }
    });

}

function moveMemberPosition(s, mid, newPos) {
    const lanes = s.party.formation.lanes;
    ["front", "mid", "back"].forEach(l => {
        if (Array.isArray(lanes[l])) {
            lanes[l] = lanes[l].filter(x => String(x) !== String(mid));
        }
    });
    if (newPos !== "reserve") {
        if (!Array.isArray(lanes[newPos])) lanes[newPos] = [];
        lanes[newPos].push(String(mid));
    }
    
    // Recalculate stats for this member since their position changed
    const m = s.party.members.find(x => String(x.id) === String(mid));
    if (m) recalculateMemberSkillsAndStats(s, m);
    
    saveSettings();
    commitStateUpdate({ emit: true, domain: "party" });
    render();
}

function ensurePartyWindowClickable() {
    try {
        const win = document.getElementById("uie-party-window");
        if (!win) return;
        const props = {
            display: "grid",
            "pointer-events": "auto",
            position: "absolute",
            left: "0px",
            top: "0px",
            right: "0px",
            bottom: "0px",
            width: "100%",
            height: "100%",
            "max-width": "none",
            "max-height": "none",
            "border-radius": "0",
            transform: "none"
        };
        Object.entries(props).forEach(([key, value]) => {
            win.style.setProperty(key, value, "important");
        });
    } catch (_) {}
}

function getActiveOrFirstMember(s) {
    const members = Array.isArray(s?.party?.members) ? s.party.members : [];
    let m = selectedId ? getMember(s, selectedId) : null;
    if (!m) m = members.find((x) => x && x.active !== false) || members[0] || null;
    if (m) {
        ensureMember(m);
        selectedId = String(m.id || "");
    }
    return m;
}

function renderRosterRail(s) {
    const rail = $("#uie-party-roster-list").empty();
    if (!rail.length) return;
    populatePartySceneAddSelect(s, $("#uie-party-window"));
    const members = Array.isArray(s?.party?.members) ? s.party.members : [];
    const awayMembers = Array.isArray(s?.party?.awayMembers) ? s.party.awayMembers : [];
    
    if (!members.length && !awayMembers.length) {
        rail.html(`<div class="party-empty">No party characters yet.</div>`);
        selectedId = null;
        return;
    }
    
    const selected = getActiveOrFirstMember(s);
    const tmpl = document.getElementById("uie-party-roster-item");
    
    // Render active members
    members.forEach((m) => {
        ensureMember(m);
        const el = tmpl?.content ? $(tmpl.content.cloneNode(true)) : $(`<div><div class="party-row"><div class="party-row-img-container"></div><div><div class="party-row-name"></div><div class="party-row-desc"></div></div></div></div>`);
        const row = el.find(".party-row");
        row.attr("data-id", m.id);
        row.toggleClass("active", String(selected?.id || "") === String(m.id || ""));
        row.toggleClass("reserve", m.active === false);
        el.find(".party-row-img-container").html(memberPortraitHtml(s, m, 42));
        el.find(".party-row-name").text(m.identity?.name || "Member");
        el.find(".party-row-desc").text(`Lv.${Number(m.progression?.level || 1)} · ${m.partyRole || "DPS"} · ${m.identity?.class || "Companion"}`);
        
        const hpPct = meterPct(m.vitals?.hp, m.vitals?.maxHp || 100);
        const mpPct = meterPct(m.vitals?.mp, m.vitals?.maxMp || 100);
        el.find(".mini-bar.hp .fill").css("width", `${hpPct}%`);
        el.find(".mini-bar.mp .fill").css("width", `${mpPct}%`);
        
        rail.append(el);
    });
    
    // Render away members section
    if (awayMembers.length > 0) {
        rail.append(`<div style="padding:8px 10px; font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:0.08em; color:var(--party-muted); border-top:1px solid rgba(255,255,255,0.08); margin-top:8px;"><i class="fa-solid fa-person-walking-luggage" style="margin-right:4px;"></i> Away (${awayMembers.length})</div>`);
        
        awayMembers.forEach((m) => {
            ensureMember(m);
            const el = tmpl?.content ? $(tmpl.content.cloneNode(true)) : $(`<div><div class="party-row"><div class="party-row-img-container"></div><div><div class="party-row-name"></div><div class="party-row-desc"></div></div></div></div>`);
            const row = el.find(".party-row");
            row.attr("data-id", m.id);
            row.addClass("away-member");
            row.css({ opacity: "0.6", border: "1px dashed rgba(255,255,255,0.15)" });
            el.find(".party-row-img-container").html(memberPortraitHtml(s, m, 42));
            el.find(".party-row-name").text(m.identity?.name || "Member");
            const leftTime = m.leftAt ? ` · Left ${timeAgo(m.leftAt)}` : "";
            el.find(".party-row-desc").text(`Away${leftTime} · Recall to return`);
            el.find(".mini-bar.hp .fill").css("width", "0%");
            el.find(".mini-bar.mp .fill").css("width", "0%");
            
            // Add recall button
            const recallBtn = $(`<button type="button" class="party-recall-btn" style="position:absolute; right:4px; top:50%; transform:translateY(-50%); width:24px; height:24px; border-radius:4px; border:1px solid rgba(0,229,255,0.3); background:rgba(0,229,255,0.1); color:var(--party-cyan); font-size:10px; cursor:pointer;" title="Recall to party"><i class="fa-solid fa-rotate-left"></i></button>`);
            recallBtn.on("click", (e) => {
                e.stopPropagation();
                recallAwayMember(s, m.id);
            });
            row.css("position", "relative");
            row.append(recallBtn);
            
            rail.append(el);
        });
    }
}

function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function recallAwayMember(s, memberId) {
    ensureParty(s);
    const awayIdx = s.party.awayMembers.findIndex(m => String(m.id) === String(memberId));
    if (awayIdx === -1) return;
    
    const m = s.party.awayMembers.splice(awayIdx, 1)[0];
    m.active = true;
    m.leftAt = null;
    m.leaveReason = null;
    s.party.members.push(m);
    
    const memberName = m.identity?.name || "Member";
    
    // Spawn sprite on stage
    try {
        const portraitUrl = resolvePartyPortraitUrl(s, m);
        if (portraitUrl) {
            spawnStageSprite({
                id: `party_${m.id}`,
                type: memberName,
                sprite: "neutral",
                layer: "mid",
                pos: "center",
                dist: "medium",
                charName: memberName
            });
        }
    } catch (_) {}
    
    // Set as current target
    try {
        const targetSelect = document.getElementById("target-select");
        if (targetSelect) {
            const options = Array.from(targetSelect.options);
            const matchingOption = options.find(opt => 
                opt.value.toLowerCase().includes(memberName.toLowerCase()) ||
                opt.text.toLowerCase().includes(memberName.toLowerCase())
            );
            if (matchingOption) {
                targetSelect.value = matchingOption.value;
                targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
            }
        }
    } catch (_) {}
    
    saveSettings();
    render();
    notify("success", `${memberName} returned to the party!`, "Party", "recall");
    try { injectRpEvent(`[System: ${memberName} was recalled to the party and joined the scene.]`); } catch (_) {}
}

function renderSkillsWorkspace(s) {
    const m = getActiveOrFirstMember(s);
    if (!m) {
        renderNoMember();
        return;
    }
    const container = $("#uie-party-body").empty();
    renderSkillTree(container, s, m);
}

function renderPartyFooter(s) {
    const footer = $("#uie-party-status-content");
    if (!footer.length) return;
    const members = Array.isArray(s?.party?.members) ? s.party.members : [];
    const active = members.filter(m => m && m.active !== false);
    if (!active.length) {
        footer.html(`<span style="opacity:0.6; font-size:11px; text-transform:uppercase; letter-spacing:0.06em;">Party status: Idle</span>`);
        return;
    }
    
    const avgLvl = Math.round(active.reduce((sum, m) => sum + Number(m.progression?.level || 1), 0) / active.length);
    const roles = Array.from(new Set(active.map(m => m.partyRole || "DPS").filter(Boolean)));
    const fxCount = active.reduce((sum, m) => sum + (Array.isArray(m.statusEffects) ? m.statusEffects.length : 0), 0);
    
    let formationText = "No active formation";
    if (s.party.formation?.lanes) {
        const lanes = s.party.formation.lanes;
        const front = Array.isArray(lanes.front) ? lanes.front.length : 0;
        const mid = Array.isArray(lanes.mid) ? lanes.mid.length : 0;
        const back = Array.isArray(lanes.back) ? lanes.back.length : 0;
        formationText = `Front: ${front} | Mid: ${mid} | Back: ${back}`;
    }
    
    const weapons = active.map(m => {
        const wp = m.equipment?.weapon || m.equipment?.main;
        if (!wp) return "";
        return typeof wp === "object" ? (wp.name || wp.title) : wp;
    }).filter(Boolean);
    const weaponText = weapons.length ? `Weapons: ${weapons.slice(0, 3).join(", ")}${weapons.length > 3 ? '...' : ''}` : 'No weapons';

    footer.html(`
        <div style="display:flex; align-items:center; justify-content:space-between; width:100%; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:var(--party-text);">
            <div style="display:flex; align-items:center; gap:16px;">
                <span><i class="fa-solid fa-users" style="color:var(--party-cyan); margin-right:4px;"></i> Active: <b style="color:#fff;">${active.length}</b> (Avg. Lv ${avgLvl})</span>
                <span style="opacity:0.3;">|</span>
                <span><i class="fa-solid fa-chess-board" style="color:var(--party-magenta); margin-right:4px;"></i> Grid: <b style="color:#fff;">${formationText}</b></span>
                <span style="opacity:0.3;">|</span>
                <span><i class="fa-solid fa-shield-halved" style="color:var(--party-gold); margin-right:4px;"></i> Roles: <b style="color:#fff;">${roles.join(", ") || "None"}</b></span>
            </div>
            <div style="display:flex; align-items:center; gap:16px;">
                <span><i class="fa-solid fa-burst" style="color:var(--party-red); margin-right:4px;"></i> Status Effects: <b style="color:var(--party-red);">${fxCount}</b></span>
                <span style="opacity:0.3;">|</span>
                <span style="color:var(--party-muted); font-size:10px;">${esc(weaponText)}</span>
            </div>
        </div>
    `);
}

function renderNoMember() {
    $("#uie-party-body").html(`<div class="party-empty">Add or import a party member to configure them.</div>`);
}

function schedulePartyLayoutLock() {
    [0, 60, 240, 600].forEach((delay) => {
        setTimeout(() => {
            ensurePartyWindowClickable();
            applyMemberModalFullscreenStyles(memberModalOpen);
        }, delay);
    });
}

function getMemberModalZIndex() {
    let z = 2147483636;
    try {
        const party = document.getElementById("uie-party-window");
        if (!party) return z;
        const partyZ = Number(window.getComputedStyle(party).zIndex || 0);
        if (Number.isFinite(partyZ) && partyZ > 0) z = Math.max(z, partyZ + 2);
    } catch (_) {}
    return z;
}

function applyMemberModalFullscreenStyles(show = memberModalOpen) {
    try {
        const party = document.getElementById("uie-party-window");
        document.querySelectorAll("[id='uie-party-member-modal']").forEach((modal) => {
            if (show && party && modal.parentElement !== party) {
                party.appendChild(modal);
            }
            const modalProps = {
                display: show ? "block" : "none",
                "pointer-events": show ? "auto" : "none",
                background: "transparent",
                position: "relative",
                left: "auto",
                top: "auto",
                right: "auto",
                bottom: "auto",
                inset: "auto",
                width: "auto",
                height: "auto",
                "min-width": "0",
                "min-height": "0",
                overflow: "hidden",
                "z-index": "35",
                "grid-column": "2",
                "grid-row": "2 / 4"
            };
            Object.entries(modalProps).forEach(([key, value]) => {
                modal.style.setProperty(key, value, "important");
            });
        });

        document.querySelectorAll("[id='uie-party-member-card']").forEach((card) => {
            const cardProps = {
                position: "absolute",
                left: "0",
                top: "0",
                right: "0",
                bottom: "0",
                inset: "0",
                width: "100%",
                height: "100%",
                "max-width": "none",
                "max-height": "none",
                "border-radius": "0",
                margin: "0",
                transform: "none",
                "box-shadow": "none"
            };
            Object.entries(cardProps).forEach(([key, value]) => {
                card.style.setProperty(key, value, "important");
            });
        });
    } catch (_) {}
}

function ensurePartyAdventureOverrideStyles() {
    document.getElementById("uie-party-adventure-override-style")?.remove();
    return;
    if (document.getElementById("uie-party-adventure-override-style")) return;
    const style = document.createElement("style");
    style.id = "uie-party-adventure-override-style";
    style.textContent = `
#uie-party-window.uie-party-ff{display:grid!important;grid-template-columns:230px minmax(0,1fr)!important;grid-template-rows:76px minmax(0,1fr) auto!important;background:radial-gradient(90% 70% at 76% 6%,rgba(116,190,255,.34),transparent 48%),linear-gradient(135deg,rgba(255,252,232,.98),rgba(194,235,205,.95) 48%,rgba(178,222,255,.95)),url("assets/ui/Modal Plates/Board for adventur.png") center/cover!important;background-color:#f7efd4!important;border:2px solid rgba(138,102,42,.5)!important;color:#24321f!important}
#uie-party-window.uie-party-ff>.uie-header{grid-column:1/-1!important;grid-row:1!important;background:linear-gradient(90deg,rgba(63,104,52,.92),rgba(103,145,68,.78),rgba(218,177,85,.74))!important;border-bottom:1px solid rgba(255,235,168,.58)!important;color:#fffbea!important}
#uie-party-window.uie-party-ff>.uie-header h2,#uie-party-window.uie-party-ff #uie-party-name,#uie-party-window.uie-party-ff #uie-party-leader{color:#fff4b8!important;text-shadow:0 2px 8px rgba(32,58,25,.45)!important}
#uie-party-window.uie-party-ff>#uie-party-tabs{grid-column:1!important;grid-row:2/4!important;display:flex!important;flex-direction:column!important;align-items:stretch!important;justify-content:flex-start!important;gap:12px!important;padding:22px 18px!important;background:linear-gradient(180deg,rgba(80,122,55,.9),rgba(44,72,43,.88))!important;border-right:1px solid rgba(255,235,168,.46)!important;border-bottom:0!important;overflow-x:hidden!important;overflow-y:auto!important}
#uie-party-window.uie-party-ff .uie-party-tab{width:100%!important;min-width:0!important;height:56px!important;flex:0 0 56px!important;justify-content:flex-start!important;gap:12px!important;padding:0 16px!important;background:linear-gradient(180deg,rgba(255,246,194,.96),rgba(236,191,94,.9))!important;border:1px solid rgba(106,75,26,.55)!important;color:#3e2d14!important;box-shadow:0 6px 18px rgba(38,65,35,.22),inset 0 1px 0 rgba(255,255,255,.7)!important;transform:none!important}
#uie-party-window.uie-party-ff .uie-party-tab .party-tab-label{display:inline!important}
#uie-party-window.uie-party-ff .uie-party-tab:hover,#uie-party-window.uie-party-ff .uie-party-tab.active{color:#17391f!important;background:linear-gradient(180deg,#fff8c7,#91d179)!important;border-color:rgba(35,94,44,.62)!important;box-shadow:0 8px 22px rgba(42,95,52,.28),inset 4px 0 0 #2f8d4f!important}
#uie-party-window.uie-party-ff>#uie-party-body{grid-column:2!important;grid-row:2!important;background:rgba(255,253,232,.5)!important;color:#24321f!important}
#uie-party-window.uie-party-ff>.party-command-meta{grid-column:2!important;grid-row:3!important;background:rgba(255,249,220,.9)!important;border-top:1px solid rgba(138,102,42,.28)!important}
@media(min-width:99999px){#uie-party-window.uie-party-ff{grid-template-columns:82px minmax(0,1fr)!important}#uie-party-window.uie-party-ff .uie-party-tab{justify-content:center!important;padding:0!important}#uie-party-window.uie-party-ff .uie-party-tab .party-tab-label{display:none!important}}
`;
    document.head.appendChild(style);
}

function render() {
    const s = getSettings();
    ensureParty(s);
    ensurePartyAdventureOverrideStyles();
    applyMemberModalFullscreenStyles(memberModalOpen);
    ensurePartyWindowClickable();
    if (!s.ui) s.ui = {};
    if (!s.ui.backgrounds) s.ui.backgrounds = {};
    const $partyWindow = $("#uie-party-window");
    const partyMode = ["adventure", "gothic", "modern", "futuristic"].includes(String(s.party.uiMode || "")) ? String(s.party.uiMode) : "adventure";
    $partyWindow
        .addClass("uie-party-ff")
        .removeClass("party-theme-adventure party-theme-gothic party-theme-modern party-theme-futuristic")
        .addClass(`party-theme-${partyMode}`)
        .attr("data-party-mode", partyMode);
    ensurePartyWindowClickable();
    $("[id='uie-party-member-modal']")
        .removeClass("party-member-theme-adventure party-member-theme-gothic party-member-theme-modern party-member-theme-futuristic")
        .addClass(`party-member-theme-${partyMode}`);
    const partyBg = String(s.ui.backgrounds.party || "assets/ui/generated/party_bg.png");
    $partyWindow.css({
        backgroundImage: `linear-gradient(135deg, rgba(255, 244, 215, 0.94), rgba(225, 202, 164, 0.88) 52%, rgba(209, 229, 219, 0.88)), url("${partyBg}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundBlendMode: "normal, soft-light",
        pointerEvents: "auto",
        position: "fixed"
    });

    try { syncPartyUserFromCore(); } catch (_) {}

    $("#uie-party-name").text(s.party.name || "My Party");
    $("#uie-party-window .party-title").text(s.party.name || "Party Ledger");
    const leader = s.party.members.find(m => String(m.id) === String(s.party.leaderId));
    $("#uie-party-leader").text(leader ? (leader.identity?.name || "Member") : "None");
    $("#uie-party-name-input").val(s.party.name || "");
    renderRosterRail(s);
    renderPartyFooter(s);

    const aliases = { roster: "stats", sheet: "stats", gear: "equipment", inventory: "bag", formation: "position", tactics: "position" };
    tab = aliases[tab] || tab;
    if (!["stats", "equipment", "bag", "skills", "position"].includes(tab)) tab = "stats";
    $(".uie-party-tab").removeClass("active").css({ cursor: "pointer", pointerEvents: "auto", touchAction: "manipulation" });
    $(`.uie-party-tab[data-tab="${tab}"]`).addClass("active");
    $("#uie-party-body").css({ pointerEvents: "auto" });

    if (!getActiveOrFirstMember(s)) {
        renderNoMember();
        return;
    }
    if (tab === "stats") renderSheet(s);
    else if (tab === "equipment") renderGear(s);
    else if (tab === "bag") {
        const m = getActiveOrFirstMember(s);
        if (String(partyInventoryTarget).startsWith("member:") && !getMember(s, String(partyInventoryTarget).slice("member:".length))) {
            partyInventoryTarget = m ? `member:${m.id}` : "shared";
        }
        renderInventory(s);
    }
    else if (tab === "skills") renderSkillsWorkspace(s);
    else if (tab === "position") renderFormation(s);
}
function sceneCharacterCandidates(s = getSettings()) {
    const names = [];
    const add = (value) => {
        const n = String(value || "").trim();
        if (!n || /^you$/i.test(n)) return;
        if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
    };
    try {
        document.querySelectorAll("#target-select option").forEach((option) => {
            const value = String(option.value || option.textContent || "").trim();
            if (value) add(value);
        });
    } catch (_) {}
    try {
        (Array.isArray(s?.omniscient?.sceneCharacterNames) ? s.omniscient.sceneCharacterNames : []).forEach(add);
    } catch (_) {}
    try {
        const active = String(document.getElementById("target-select")?.value || "").trim();
        if (active) add(active);
    } catch (_) {}
    return names;
}

function populatePartySceneAddSelect(s, container = $("#uie-party-body")) {
    const sel = container.find("#party-add-scene-select");
    if (!sel.length) return;
    const existing = new Set((Array.isArray(s?.party?.members) ? s.party.members : [])
        .map((m) => String(m?.identity?.name || "").trim().toLowerCase())
        .filter(Boolean));
    const candidates = sceneCharacterCandidates(s).filter((name) => !existing.has(name.toLowerCase()));
    sel.empty();
    if (!candidates.length) {
        sel.append($("<option>", { value: "" }).text("No scene characters available"));
        sel.prop("disabled", true);
        container.find("#party-add").prop("disabled", true).attr("title", "Add a character to the target scene first.");
        return;
    }
    sel.prop("disabled", false);
    container.find("#party-add").prop("disabled", false).attr("title", "Add selected scene character to party");
    sel.append($("<option>", { value: "" }).text("Choose scene character..."));
    candidates.forEach((name) => sel.append($("<option>", { value: name }).text(name)));
}

function addCharacterFromSceneSelection(s, nameRaw) {
    try {
        const name = String(nameRaw || "").trim();
        if (!name) {
            notify("warning", "Choose a character currently in the scene first.", "Party", "roster");
            return;
        }
        const allowed = sceneCharacterCandidates(s).some((x) => x.toLowerCase() === name.toLowerCase());
        if (!allowed) {
            notify("warning", "Party members must come from characters currently in the target scene.", "Party", "roster");
            return;
        }
        if (s.party.members.some((m) => String(m?.identity?.name || "").trim().toLowerCase() === name.toLowerCase())) {
            notify("info", `${name} is already in the party.`, "Party", "roster");
            return;
        }
        const m = defaultMember(name);
        s.party.members.push(m);
        saveSettings();
        try { injectRpEvent(`[System: ${String(name || "Character")} joined the party.]`); } catch (_) {}
        render();
        if(window.toastr) toastr.success(`Added character: ${name}`);
    } catch(e) { console.error(e); }
}

async function scanPartyFromChat() {
    const s = getSettings();
    ensureParty(s);

    // Gather Chat Context
    let raw = "";
    $(".chat-msg-txt").slice(-25).each(function() { raw += $(this).text() + "\n"; });
    if (!raw.trim()) {
        notify("warning", "Not enough chat history to scan.", "Party", "scan");
        return;
    }

    const currentMembers = s.party.members.map(m => String(m?.identity?.name || "Member")).join(", ");
    const awayMembersList = s.party.awayMembers.map(m => String(m?.identity?.name || "Member")).join(", ");
    const contextInfo = awayMembersList ? `Current Roster: ${currentMembers || "None"}\nAway Members: ${awayMembersList}` : `Current Roster: ${currentMembers || "None"}`;
    const prompt = SCAN_TEMPLATES.party.roster(contextInfo, raw.slice(0, 3000));

    const res = await generateContent(prompt, "Party Scan");
    if (!res) return;

    let data;
    try { data = JSON.parse(String(res).replace(/```json|```/g, "").trim()); } catch(_) { return; }

    if (!data || typeof data !== "object") return;

    let changes = 0;

    // Handle Returns (away members coming back)
    if (Array.isArray(data.returned)) {
        for (const name of data.returned) {
            const awayIdx = s.party.awayMembers.findIndex(m => String(m?.identity?.name || "").trim().toLowerCase() === name.toLowerCase());
            if (awayIdx !== -1) {
                const returningMember = s.party.awayMembers.splice(awayIdx, 1)[0];
                returningMember.active = true;
                returningMember.leftAt = null;
                s.party.members.push(returningMember);
                
                // Spawn sprite on stage
                try {
                    spawnStageSprite({
                        id: `party_${returningMember.id}`,
                        type: returningMember.identity?.name || name,
                        sprite: "neutral",
                        layer: "mid",
                        pos: "center",
                        dist: "medium",
                        charName: returningMember.identity?.name || name
                    });
                } catch (_) {}
                
                // Set as current target
                try {
                    const targetSelect = document.getElementById("target-select");
                    if (targetSelect) {
                        const options = Array.from(targetSelect.options);
                        const memberName = returningMember.identity?.name || name;
                        const matchingOption = options.find(opt => 
                            opt.value.toLowerCase().includes(memberName.toLowerCase()) ||
                            opt.text.toLowerCase().includes(memberName.toLowerCase())
                        );
                        if (matchingOption) {
                            targetSelect.value = matchingOption.value;
                            targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
                        }
                    }
                } catch (_) {}
                
                changes++;
                notify("success", `${name} returned to the party!`, "Party", "scan");
            }
        }
    }

    // Handle Temporary Leavers (move to awayMembers)
    if (Array.isArray(data.left_temporary)) {
        for (const name of data.left_temporary) {
            const idx = s.party.members.findIndex(m => String(m?.identity?.name || "").trim().toLowerCase() === name.toLowerCase());
            if (idx !== -1) {
                const leavingMember = s.party.members.splice(idx, 1)[0];
                leavingMember.active = false;
                leavingMember.leftAt = Date.now();
                leavingMember.leaveReason = "temporary";
                s.party.awayMembers.push(leavingMember);
                changes++;
                notify("info", `${name} stepped away temporarily.`, "Party", "scan");
            }
        }
    }

    // Handle Permanent Leavers (remove completely)
    if (Array.isArray(data.left_permanent)) {
        for (const name of data.left_permanent) {
            const idx = s.party.members.findIndex(m => String(m?.identity?.name || "").trim().toLowerCase() === name.toLowerCase());
            if (idx !== -1) {
                s.party.members.splice(idx, 1);
                changes++;
                notify("info", `${name} left the party permanently.`, "Party", "scan");
            }
            // Also check away members
            const awayIdx = s.party.awayMembers.findIndex(m => String(m?.identity?.name || "").trim().toLowerCase() === name.toLowerCase());
            if (awayIdx !== -1) {
                s.party.awayMembers.splice(awayIdx, 1);
                changes++;
            }
        }
    }

    // Handle Joiners / Updates
    if (Array.isArray(data.active)) {
        for (const char of data.active) {
            const name = String(char.name || "").trim();
            if (!name) continue;

            let m = s.party.members.find(x => String(x?.identity?.name || "").trim().toLowerCase() === name.toLowerCase());
            if (!m) {
                // Check if they're in away members (returned but not in returned array)
                const awayIdx = s.party.awayMembers.findIndex(x => String(x?.identity?.name || "").trim().toLowerCase() === name.toLowerCase());
                if (awayIdx !== -1) {
                    m = s.party.awayMembers.splice(awayIdx, 1)[0];
                    m.active = true;
                    m.leftAt = null;
                    s.party.members.push(m);
                    
                    // Spawn sprite on stage
                    try {
                        spawnStageSprite({
                            id: `party_${m.id}`,
                            type: m.identity?.name || name,
                            sprite: "neutral",
                            layer: "mid",
                            pos: "center",
                            dist: "medium",
                            charName: m.identity?.name || name
                        });
                    } catch (_) {}
                    
                    // Set as current target
                    try {
                        const targetSelect = document.getElementById("target-select");
                        if (targetSelect) {
                            const options = Array.from(targetSelect.options);
                            const matchingOption = options.find(opt => 
                                opt.value.toLowerCase().includes(name.toLowerCase()) ||
                                opt.text.toLowerCase().includes(name.toLowerCase())
                            );
                            if (matchingOption) {
                                targetSelect.value = matchingOption.value;
                                targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
                            }
                        }
                    } catch (_) {}
                    
                    changes++;
                    notify("success", `${name} returned to the party!`, "Party", "scan");
                } else {
                    // New Member
                    m = defaultMember(name);
                    m.roles.push("Character");
                    s.party.members.push(m);
                    changes++;
                    notify("success", `${name} joined the party!`, "Party", "scan");
                }
            }

            // Update Info
            if (char.class) m.identity.class = char.class;
            if (char.role) m.partyRole = char.role;
            if (char.level && Number(char.level) > (m.progression.level || 0)) m.progression.level = Number(char.level);

            // Try to auto-link portrait if friend exists
            if (!m.images.portrait) {
                const friend = s.social?.friends?.find(f => f.name.toLowerCase() === name.toLowerCase());
                if (friend && friend.img) m.images.portrait = friend.img;
            }
        }
    }

    if (changes > 0) {
        saveSettings();
        render();
        notify("success", "Party Roster Updated.", "Party", "scan");
        try { injectRpEvent(`[System: Party roster updated via chat scan.]`); } catch (_) {}
    } else {
        notify("info", "No roster changes detected.", "Party", "scan");
    }
}

function resolveMemberModalLayoutTemplate() {
    const ids = ["uie-party-modal-layout-desktop", "uie-party-modal-layout"];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.content) return el;
    }
    return null;
}

function renderMemberModal(s, m) {
    ensureMember(m);
    ensureMemberStarterContent(s, m);
    $("#uie-party-member-title").text(`${m.identity?.name || "Member"}`);
    try {
        const bg = String(s?.ui?.backgrounds?.partyMember || "");
        const card = document.getElementById("uie-party-member-card");
        if (card) {
            if (bg) {
                card.style.backgroundImage = `linear-gradient(180deg, rgba(255,250,240,0.94), rgba(255,244,224,0.82)), url("${bg}")`;
                card.style.backgroundSize = "cover";
                card.style.backgroundPosition = "center";
            } else {
                card.style.backgroundImage = "";
                card.style.backgroundSize = "";
                card.style.backgroundPosition = "";
            }
        }
    } catch (_) {}

    const container = $("#uie-party-member-content").empty().css({ minHeight: "200px", overflow: "auto" });
    const layoutTmpl = resolveMemberModalLayoutTemplate();
    if (!layoutTmpl || !layoutTmpl.content) {
        container.html(`<div style="padding:20px;color:#fff;">Member: ${esc(m.identity?.name || "Unknown")}</div>`);
        return;
    }
    const layout = $(layoutTmpl.content.cloneNode(true));
    container.append(layout);

    // Active Tab — use class-based active state
    container.find(".party-mm-tab").removeClass("active").css({ pointerEvents: "auto", touchAction: "manipulation" });
    if (!container.find(`.party-mm-tab[data-tab="${memberModalTab}"]`).length) memberModalTab = "sheet";
    container.find(`.party-mm-tab[data-tab="${memberModalTab}"]`).addClass("active");

    container.find(`#party-mm-pane-${memberModalTab}`).show();

    // --- SHEET PANE ---
    const sheetPane = container.find("#party-mm-pane-sheet");
    const sheetTmplEl = document.getElementById("uie-party-modal-sheet-pane");
    if (sheetTmplEl && sheetTmplEl.content) {
        sheetPane.append(sheetTmplEl.content.cloneNode(true));
    }

    // Portrait
    const pContainer = sheetPane.find(".sheet-portrait-container");
    pContainer.html(memberPortraitHtml(s, m, 120));
    if (memberEdit) {
        pContainer.css("cursor", "pointer").attr("title", "Pick portrait image");
        if (!sheetPane.find("#party-mm-pick-portrait").length) {
            $(`<button id="party-mm-pick-portrait" type="button" style="align-self:flex-start;padding:8px 12px!important;">Pick portrait</button>`)
                .insertAfter(pContainer);
        }
    }

    // Inputs
    const dis = memberEdit ? false : true;
    const pe = memberEdit ? {} : { "pointer-events": "none", "opacity": "0.85" };

    sheetPane.find("#party-mm-name").val(m.identity?.name || "").prop("disabled", dis).css(pe);
    sheetPane.find("#party-mm-class").val(m.identity?.class || "").prop("disabled", dis).css(pe);
    sheetPane.find("#party-mm-level").val(Number(m.progression?.level || 1)).prop("disabled", dis).css(pe);

    const roleSel = sheetPane.find("#party-mm-role");
    ["Tank","Healer","DPS","Support","Mage","Ranger","Scout","Leader","Bruiser"].forEach(r => {
        const opt = $("<option>").val(r).text(r);
        if ((m.partyRole||"DPS")===r) opt.prop("selected", true);
        roleSel.append(opt);
    });
    roleSel.prop("disabled", dis).css(pe);

    renderSheetTrackers(sheetPane, m);
    sheetPane.find("#party-mm-track-add").show();

    // Status FX
    const fxList = sheetPane.find(".status-fx-list");
    const fx = normalizeStatusList(m.statusEffects, Date.now());
    if (fx.length === 0) fxList.html(`<div style="opacity:0.6; font-weight:900;">None</div>`);
    else {
        fx.slice(0, 16).forEach(x => {
            const icon = $(`<button type="button" class="party-fx" data-detail="${esc(partyStatusDetail(x))}" title="Open ${esc(x.name)} details" style="width:32px;height:32px;border-radius:8px;border:1px solid rgba(142,99,48,0.35);background:#fff5dc;display:grid;place-items:center;font-weight:900;color:#5b361b;user-select:none;cursor:pointer;"><i class="fa-solid ${partyStatusIcon(x)}"></i></button>`);
            fxList.append(icon);
        });
    }

    if (memberEdit) {
        sheetPane.find("#party-mm-fx").val(fx.map((effect) => effect.name).join(", ")).show();
        const saveBtn = sheetPane.find("#party-mm-save");
        saveBtn.show();
        if (!sheetPane.find("#party-mm-profile-scan").length) {
            $(`<button id="party-mm-profile-scan" class="reply-tool-btn" style="width:auto; padding:0 12px; margin-left:8px; background:rgba(45,212,191,0.2); border:1px solid rgba(45,212,191,0.4); color:#2dd4bf; font-weight:700;">Lore Check (AI)</button>`)
                .insertAfter(saveBtn);
        }
    }

    // Stats
    const statsGrid = sheetPane.find(".stats-grid");
    const statInputTmpl = document.getElementById("uie-party-modal-stat-input").content;
    const defaultStatKeys = ["str","dex","con","int","wis","cha","per","luk","agi","vit","end","spi"];
    const statLabels = { ...(s?.character?.statLabels || {}), ...(s?.statLabels || {}) };
    const hiddenStats = new Set((m.hiddenStats || []).map(String));
    const statKeys = Array.from(new Set([...defaultStatKeys, ...Object.keys(m.stats || {})])).filter(Boolean).filter((key) => !hiddenStats.has(key));
    
    if (memberEdit) {
        const addStatBtn = $(`<button type="button" id="party-mm-add-stat" class="reply-tool-btn" style="width:auto; padding:6px 12px; margin-bottom:8px; background:rgba(45,212,191,0.2); border:1px solid rgba(45,212,191,0.4); color:#2dd4bf; font-weight:700;"><i class="fa-solid fa-plus"></i> Add Stat</button>`);
        statsGrid.before(addStatBtn);
    }
    
    statKeys.forEach(k => {
        const el = $(statInputTmpl.cloneNode(true));
        const label = String(statLabels[k] || k).toUpperCase();
        el.find(".stat-lbl").text(label);
        const input = el.find(".stat-val");
        input.val(Number(m.stats?.[k] || 0));
        input.attr("data-stat", k);
        input.prop("disabled", dis).css(pe);
        
        if (memberEdit) {
            const deleteBtn = $(`<button type="button" class="party-stat-del reply-tool-btn" data-stat-del="${esc(k)}" style="width:28px; height:28px; min-width:28px; padding:0; background:rgba(239,68,68,0.2); border:1px solid rgba(239,68,68,0.4); color:#ef4444; margin-left:4px;" title="Delete stat"><i class="fa-solid fa-trash"></i></button>`);
            el.append(deleteBtn);
        }
        
        statsGrid.append(el);
    });

    // --- EQUIP PANE ---
    const equipPane = container.find("#party-mm-pane-equip");
    const equipTmpl = document.getElementById("uie-party-modal-equip-pane").content.cloneNode(true);
    equipPane.append(equipTmpl);

    const pdPick = equipPane.find("#party-paperdoll-pick");
    pdPick.css("cursor", memberEdit ? "pointer" : "default");
    const paperDollImg = m.images.paperDoll || "";
    if (paperDollImg) {
        pdPick.addClass("has-image");
        pdPick.html(`<img class="party-paperdoll-img" src="${esc(paperDollImg)}" alt="Paper Doll">`);
    } else {
        const portraitImg = resolvePortraitUrl(s, m);
        if (portraitImg) {
            pdPick.addClass("has-image");
            pdPick.html(`<img class="party-paperdoll-img" src="${esc(portraitImg)}" alt="Paper Doll">`);
        } else {
            pdPick.removeClass("has-image");
            pdPick.html(`<div class="party-paperdoll-empty" style="display:grid;place-items:center;width:100%;height:100%;color:#8a684d;font-weight:900;font-size:24px;">${esc(memberInitials(m))}</div>`);
        }
    }
    if (memberEdit) equipPane.find("#party-mm-pick-portrait-equip").show();

    const equipLeft = equipPane.find(".equip-left");
    const equipRight = equipPane.find(".equip-right");
    const eqRowTmpl = document.getElementById("uie-party-modal-equip-row").content;
    const slotLabel = {
        head: "Head", chest: "Chest", legs: "Legs", feet: "Feet", hands: "Hands",
        weapon: "Main Hand", offhand: "Off Hand", accessory1: "Accessory 1", accessory2: "Accessory 2"
    };
    ["head","chest","legs","feet","hands","weapon","offhand","accessory1","accessory2"].forEach((k, idx) => {
        const el = $(eqRowTmpl.cloneNode(true));
        el.find(".eq-lbl").text(slotLabel[k] || k);
        const equipped = m.equipment?.[k];
        const eqName = equipped && typeof equipped === "object"
            ? String(equipped.name || equipped.title || equipped.type || "").trim()
            : String(equipped || "").trim();
        const eqImg = equipped && typeof equipped === "object" ? String(equipped.img || equipped.image || equipped.icon || equipped.visualOverride || "").trim() : "";
        const iconBox = el.find(".party-mm-equip-icon");
        if (eqImg) {
            iconBox.html(`<img src="${esc(eqImg)}" alt="">`).addClass("has-image");
        } else {
            iconBox.removeClass("has-image");
        }
        const input = el.find(".eq-val");
        input.val(eqName);
        input.attr("title", eqName || "Empty slot");
        input.attr("data-eq", k); // for save handler
        input.prop("disabled", dis).css(pe);
        (idx < 5 ? equipLeft : equipRight).append(el);
    });

    if (memberEdit) equipPane.find(".party-mm-save-btn").show();

    // --- SKILLS PANE ---
    const skillsPane = container.find("#party-mm-pane-skills");
    const skillsTmpl = document.getElementById("uie-party-modal-skills-pane").content.cloneNode(true);
    skillsPane.append(skillsTmpl);

    // Rebirth
    if (m.progression.level >= 150 || m.progression.reborn || memberEdit) {
        const rbSec = skillsPane.find(".rebirth-section");
        rbSec.show();
        rbSec.find("#party-mm-reborn").prop("checked", m.progression.reborn).prop("disabled", dis);
        const medSel = rbSec.find("#party-mm-medallion");
        medSel.prop("disabled", dis);
        Object.values(MEDALLIONS).forEach(md => {
            const opt = $("<option>").val(md.id).text(md.name);
            if (m.progression.activeMedallion === md.id) opt.prop("selected", true);
            medSel.append(opt);
        });
    }

    if (memberEdit) skillsPane.find("#party-mm-add-skill").show();

    const skillsList = skillsPane.find(".skills-list");
    if (memberEdit) {
        // Edit Mode: Rows
        const editRowTmpl = document.getElementById("uie-party-modal-skill-edit-row").content;
        const skillData = Array.isArray(m.skills) ? m.skills : [];
        if (skillData.length === 0) {
            skillsList.html(`<div style="opacity:0.7; font-weight:900; padding:10px; border:1px dashed rgba(255,255,255,0.18); border-radius:14px;">No skills yet.</div>`);
        } else {
            skillData.forEach((sk, idx) => {
                const el = $(editRowTmpl.cloneNode(true));
                el.find(".skill-name-in").val(sk.name || "").attr("data-skill-name", idx);
                el.find(".skill-desc-in").val(sk.description || "").attr("data-skill-desc", idx);
                const typeSel = el.find(".skill-type-in").attr("data-skill-type", idx);
                typeSel.val((sk.skillType||"active") === "passive" ? "passive" : "active");
                el.find(".skill-tracker-in").val(sk.lifeTracker || "").attr("data-skill-tracker", idx);
                el.find(".party-mm-skill-del").attr("data-skill-del", idx);
                skillsList.append(el);
            });
        }
        skillsPane.find(".skills-save-container").show();
    } else {
        // View Mode: Items
        const viewRowTmpl = document.getElementById("uie-party-modal-skill-view-row").content;
        const resolvedSkills = resolveMemberSkills(s, m);
        if (resolvedSkills.length === 0) {
            skillsList.html(`<div style="opacity:0.6; font-weight:900;">No skills</div>`);
        } else {
            resolvedSkills.forEach(sk => {
                const el = $(viewRowTmpl.cloneNode(true));
                let src = "PTY";
                let color = "rgba(203, 163, 92,0.85)";
                if (sk.source === "Inventory") {
                    src = "INV";
                    color = "rgba(52,152,219,0.85)";
                } else if (sk.source === "Lorebook") {
                    src = "LORE";
                    color = "rgba(111,211,255,0.85)";
                }
                el.find(".skill-src").text(src).css("color", color);
                el.find(".skill-name").text(sk.name);
                el.find(".skill-desc").text(sk.desc || "");
                
                const trackerBadge = el.find(".skill-tracker-badge");
                if (sk.lifeTracker) {
                    trackerBadge.text(`⚡ ${sk.lifeTracker}`).show();
                }

                const skillDiv = el.find(".party-skill");
                skillDiv.attr("data-name", sk.name);
                skillDiv.attr("data-desc", sk.desc || "");

                skillsList.append(el);
            });
        }
    }

    // --- SKILL TREE PANE ---
    const skilltreePane = container.find("#party-mm-pane-skilltree");
    if (memberModalTab === "skilltree") {
        renderSkillTree(skilltreePane, s, m);
    }
}

function openMemberModal(s, id, edit = false) {
    const m = getMember(s, id);
    if (!m) return;
    ensureMember(m);
    selectedId = String(m.id);
    memberModalOpen = true;
    memberModalOpenedAt = Date.now();
    ignoreNextBackdropClick = true;
    memberEdit = edit === true;
    const modalEls = Array.from(document.querySelectorAll("[id='uie-party-member-modal']"));
    if (!modalEls.length) return;
    const modal = modalEls[0];
    if (modalEls.length > 1) {
        for (let i = 1; i < modalEls.length; i++) {
            try { modalEls[i].remove(); } catch (_) {}
        }
    }
    const party = document.getElementById("uie-party-window");
    if (party && modal.parentElement !== party) {
        party.appendChild(modal);
    }
    applyMemberModalFullscreenStyles(true);
    renderMemberModal(s, m);
}

function closeMemberModal() {
    memberModalOpen = false;
    ignoreNextBackdropClick = false;
    memberEdit = false;
    closeMemberTrackerModal();
    applyMemberModalFullscreenStyles(false);
}

export function refreshParty() {
    if (!partyInit) {
        initParty();
        return;
    }
    render();
    schedulePartyLayoutLock();
}

async function pickPortraitForMember(s, m, kind) {
    const img = await pickLocalImage();
    if (!img) return;
    const cropped = await cropPartyImage(img, kind);
    if (!cropped) return;
    if (kind === "paperDoll") m.images.paperDoll = cropped;
    else m.images.portrait = cropped;
    saveSettings();
    renderMemberModal(s, m);
}

export function initParty() {
    if (partyInit) {
        render();
        return;
    }
    partyInit = true;
    const s = getSettings();
    ensureParty(s);

    ensurePartyWindowClickable();

    const $win = $("#uie-party-window");
    const $modal = $("#uie-party-member-modal");
    const $body = $("body");

    $(document).off("click.party change.party pointerup.party");
    $win.off("click.party change.party pointerup.party");
    $modal.off("click.party change.party pointerup.party");
    $body.off("click.party pointerup.party", "[id='uie-party-member-modal'] [id='uie-party-member-close']");
    $body.off("click.party pointerup.party", "[id='uie-party-member-modal']");

    let lastTouchOpenAt = 0;
    let lastTouchTabAt = 0;

    const shouldHandleTouchPointer = (e) => {
        if (e?.type !== "pointerup") return true;
        const pt = String(e.pointerType || "").toLowerCase();
        return !pt || pt === "touch" || pt === "pen";
    };

    $(document).on("click.party pointerup.party", "#uie-party-window .uie-party-tab", function(e) {
        if (!shouldHandleTouchPointer(e)) return;
        if (e.type === "pointerup") {
            lastTouchTabAt = Date.now();
            e.preventDefault();
            e.stopPropagation();
        } else {
            const t = Number(lastTouchTabAt || 0);
            if (t && Date.now() - t < 650) return;
        }
        tab = $(this).data("tab");
        render();
    });

    $(document).on("click.party pointerup.party", "#uie-party-close", function (e) {
        e.preventDefault();
        e.stopPropagation();
        try { closeMemberModal(); } catch (_) {}
        $("#uie-party-window").hide();
    });

    $(document).on("keydown.party", function (e) {
        if (String(e?.key || "").toLowerCase() !== "escape") return;
        const $party = $("#uie-party-window");
        if ($party.length && $party.is(":visible")) {
            const $popup = $("#uie-party-doll-popup");
            if ($popup.length && $popup.is(":visible")) {
                $popup.hide();
                return;
            }
            const $picker = $("#uie-party-equip-picker-modal");
            if ($picker.length && $picker.is(":visible")) {
                $picker.hide();
                return;
            }
            try { closeMemberModal(); } catch (_) {}
            $party.hide();
        }
    });

    $(document).on("click.party", "#uie-party-window .sheet-portrait", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        const m = getActiveOrFirstMember(s2);
        if (!m) return;
        const portraitUrl = resolvePartyPortraitUrl(s2, m);
        if (!portraitUrl) return;
        $("#uie-party-doll-popup-img").attr("src", portraitUrl);
        $("#uie-party-doll-popup-name").text(m.identity?.name || "Companion");
        $("#uie-party-doll-popup").css("display", "flex");
    });

    $(document).on("click.party", "#uie-party-doll-popup, #uie-party-doll-popup-close", function(e) {
        if (e.target === this || $(e.target).closest("#uie-party-doll-popup-close").length) {
            $("#uie-party-doll-popup").hide();
        }
    });

    $(document).on("click.party", "#uie-party-equip-picker-create", function() {
        const slot = $(this).attr("data-slot");
        const memberId = $(this).attr("data-member");
        if (!memberId) return;
        
        // Populate slot select
        const select = $("#uie-party-equip-slot-select").empty();
        COMPANION_LAYERS.forEach(layer => {
            if (Array.isArray(layer.slots)) {
                layer.slots.forEach(sl => {
                    const opt = $("<option>").val(sl.id).text(sl.label || sl.id);
                    if (sl.id === slot) opt.prop("selected", true);
                    select.append(opt);
                });
            }
        });
        
        // Reset inputs
        $("#uie-party-equip-name").val("");
        $("#uie-party-equip-desc").val("");
        $("#uie-party-equip-rarity").val("common");
        $("#uie-party-equip-image").val("");
        $("#uie-party-equip-str").val(0);
        $("#uie-party-equip-dex").val(0);
        $("#uie-party-equip-int").val(0);
        $("#uie-party-equip-vit").val(0);
        $("#uie-party-equip-cha").val(0);
        $("#uie-party-equip-ai-prompt").val("");
        
        $("#uie-party-equip-tab-manual").trigger("click");
        $("#uie-party-equipment-create-modal").css("display", "flex");
    });

    $(document).on("click.party", "#uie-party-equipment-create-close, #uie-party-equipment-create-cancel", function() {
        $("#uie-party-equipment-create-modal").hide();
    });

    $(document).on("click.party", "#uie-party-equip-tab-manual", function() {
        $("#uie-party-equip-tab-manual").addClass("active");
        $("#uie-party-equip-tab-ai").removeClass("active");
        $("#uie-party-equip-form-manual").css("display", "flex");
        $("#uie-party-equip-form-ai").hide();
    });

    $(document).on("click.party", "#uie-party-equip-tab-ai", function() {
        $("#uie-party-equip-tab-ai").addClass("active");
        $("#uie-party-equip-tab-manual").removeClass("active");
        $("#uie-party-equip-form-ai").css("display", "flex");
        $("#uie-party-equip-form-manual").hide();
    });

    $(document).on("click.party", "#uie-party-equipment-create-save", function() {
        const memberId = $("#uie-party-equip-picker-create").attr("data-member");
        if (!memberId) return;
        const s2 = getSettings();
        ensureParty(s2);
        const m = getMember(s2, memberId);
        if (!m) return;
        
        const name = String($("#uie-party-equip-name").val() || "").trim();
        const desc = String($("#uie-party-equip-desc").val() || "").trim();
        const slot = $("#uie-party-equip-slot-select").val();
        const rarity = $("#uie-party-equip-rarity").val();
        const img = String($("#uie-party-equip-image").val() || "").trim();
        const str = Number($("#uie-party-equip-str").val() || 0);
        const dex = Number($("#uie-party-equip-dex").val() || 0);
        const int = Number($("#uie-party-equip-int").val() || 0);
        const vit = Number($("#uie-party-equip-vit").val() || 0);
        const cha = Number($("#uie-party-equip-cha").val() || 0);
        
        const item = {
            name: name || "Custom Item",
            description: desc,
            type: "Equipment",
            slotId: slot,
            rarity,
            img,
            mods: { str, dex, int, vit, cha }
        };
        
        saveEquipmentLoadout(s2, m, slot, item);
        render();
        $("#uie-party-equipment-create-modal").hide();
        $("#uie-party-equip-picker-modal").hide();
    });

    $(document).on("click.party", "#uie-party-equip-ai-gen", async function() {
        const desc = String($("#uie-party-equip-ai-prompt").val() || "").trim();
        if (!desc) {
            alert("Please describe the equipment first.");
            return;
        }
        const btn = $(this);
        btn.prop("disabled", true).text("Generating...");
        
        const slot = $("#uie-party-equip-slot-select").val();
        const validSlots = COMPANION_LAYERS.flatMap(l => l.slots.map(sl => sl.id)).join("|");
        const schema = `{"name":"","description":"","type":"Equipment","slotId":"${slot}","rarity":"common|uncommon|rare|epic|legendary","statusEffects":[""],"mods":{"str":0,"dex":0,"int":0,"vit":0,"cha":0},"img":""}`;
        const prompt = `Generate a single visual novel equipment item matching the description: "${desc}".
Use exact slotId "${slot}".
Valid slotId values: ${validSlots}.
Return ONLY JSON matching this schema:
${schema}
Do NOT wrap in markdown block. Return raw JSON text.`;

        try {
            if (typeof generateContent === "function") {
                const res = await generateContent(prompt, "System Check");
                if (res) {
                    let cleaned = String(res).replace(/```json|```/g, "").trim();
                    let obj = JSON.parse(cleaned);
                    if (obj && typeof obj === "object") {
                        if (obj.name) $("#uie-party-equip-name").val(obj.name);
                        if (obj.description) $("#uie-party-equip-desc").val(obj.description);
                        if (obj.rarity) $("#uie-party-equip-rarity").val(obj.rarity);
                        if (obj.img) $("#uie-party-equip-image").val(obj.img);
                        if (obj.mods) {
                            if (typeof obj.mods.str === "number") $("#uie-party-equip-str").val(obj.mods.str);
                            if (typeof obj.mods.dex === "number") $("#uie-party-equip-dex").val(obj.mods.dex);
                            if (typeof obj.mods.int === "number") $("#uie-party-equip-int").val(obj.mods.int);
                            if (typeof obj.mods.vit === "number") $("#uie-party-equip-vit").val(obj.mods.vit);
                            if (typeof obj.mods.cha === "number") $("#uie-party-equip-cha").val(obj.mods.cha);
                        }
                        $("#uie-party-equip-tab-manual").trigger("click");
                    }
                }
            } else {
                alert("AI generation function generateContent is not available.");
            }
        } catch(err) {
            alert("AI Generation failed: " + String(err?.message || err));
        } finally {
            btn.prop("disabled", false).html(`<i class="fa-solid fa-wand-magic-sparkles"></i> Generate with AI`);
        }
    });

    $(document).on("click.party pointerup.party", "#uie-party-member-modal .party-mm-tab", function (e) {
        if (!shouldHandleTouchPointer(e)) return;
        if (e.type === "pointerup") {
            lastTouchTabAt = Date.now();
            e.preventDefault();
            e.stopPropagation();
        } else {
            const t = Number(lastTouchTabAt || 0);
            if (t && Date.now() - t < 650) return;
            e.preventDefault();
            e.stopPropagation();
        }
        memberModalTab = String($(this).data("tab") || "sheet");
        const s2 = getSettings();
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (m) renderMemberModal(s2, m);
    });

    $(document).on("click.party", "#uie-party-window #party-add", function() {
        const s = getSettings();
        addCharacterFromSceneSelection(s, $("#uie-party-window #party-add-scene-select").val());
    });

    $(document).on("click.party", "#uie-party-window #party-track-add, #uie-party-member-modal #party-mm-track-add", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        const m = getSelectedTrackerMember(s2);
        if (!m) return;
        openMemberTrackerModal(m);
    });

    $(document).on("click.party", "#uie-party-window .party-sheet-stat-add", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        const m = getActiveOrFirstMember(s2);
        if (!m) return;
        ensureMember(m);
        const label = String(prompt("Attribute name:") || "").trim();
        if (!label) return;
        const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        if (!key) return;
        if (m.stats[key] !== undefined && !(m.hiddenStats || []).includes(key)) {
            notify("warning", "That attribute already exists.", "Party");
            return;
        }
        const value = Number(prompt(`Starting value for ${label}:`, String(m.stats[key] ?? 0)));
        m.stats[key] = Number.isFinite(value) ? value : 0;
        m.hiddenStats = (m.hiddenStats || []).filter((item) => String(item) !== key);
        saveSettings();
        render();
    });

    $(document).on("click.party", "#uie-party-window .party-sheet-stat-mode", function(e) {
        e.preventDefault();
        e.stopPropagation();
        partyAttributeEditMode = !partyAttributeEditMode;
        render();
    });

    $(document).on("click.party", "#uie-party-window .party-inv-tab", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const scope = String($(this).attr("data-inventory-scope") || "shared");
        const s2 = getSettings();
        const member = getActiveOrFirstMember(s2);
        partyInventoryTarget = scope === "personal" && member ? `member:${member.id}` : "shared";
        render();
    });

    $(document).on("click.party", "#uie-party-window .party-sheet-stat-edit", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const key = String($(this).data("stat") || "");
        const s2 = getSettings();
        const m = getActiveOrFirstMember(s2);
        if (!m || !key) return;
        const value = Number(prompt(`Set ${key.toUpperCase()}:`, String(m.stats?.[key] ?? 0)));
        if (!Number.isFinite(value)) return;
        m.stats[key] = value;
        saveSettings();
        render();
    });

    $(document).on("click.party", "#uie-party-window .party-sheet-stat-delete", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const key = String($(this).data("stat") || "");
        const s2 = getSettings();
        const m = getActiveOrFirstMember(s2);
        if (!m || !key || !confirm(`Remove attribute '${key}' from this character?`)) return;
        m.hiddenStats = Array.from(new Set([...(m.hiddenStats || []), key]));
        saveSettings();
        render();
    });

    $(document).on("click.party", "#uie-party-window .party-sheet-effect-add", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        const m = getActiveOrFirstMember(s2);
        if (!m) return;
        ensureMember(m);
        const effect = String(prompt("Add an effect, condition, buff, or debuff:") || "").trim();
        if (!effect) return;
        m.statusEffects.push(effect.slice(0, 120));
        saveSettings();
        render();
    });

    $(document).on("click.party", "#uie-party-window .party-sheet-effect-delete", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const key = String($(this).data("effect-key") || "").trim();
        const s2 = getSettings();
        const m = getActiveOrFirstMember(s2);
        if (!m || !key) return;
        m.statusEffects = (Array.isArray(m.statusEffects) ? m.statusEffects : []).filter((effect) => statusKey(effect) !== key);
        saveSettings();
        render();
    });

    $(document).on("click.party", "#uie-party-window .party-track-btn, #uie-party-member-modal .party-track-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const card = $(this).closest(".party-tracker-card");
        if (!card.length) return;
        const act = String($(this).attr("data-act") || "").trim();
        const delta = act === "minus" ? -1 : act === "plus" ? 1 : 0;
        if (!delta) return;

        const s2 = getSettings();
        ensureParty(s2);
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (!m) return;
        ensureMember(m);

        const rowMeta = {
            kind: String(card.attr("data-track-kind") || ""),
            key: String(card.attr("data-track-key") || ""),
            id: String(card.attr("data-track-id") || ""),
        };
        const changed = applyTrackerDelta(m, rowMeta, delta);
        if (!changed) return;

        const isUser = isUserMember(s2, m);
        if (isUser) {
            applyMemberToCore(s2, m);
            try { $(document).trigger("uie:updateVitals"); } catch (_) {}
        }

        saveSettings();
        render();
        if (memberModalOpen) {
            try { renderMemberModal(s2, m); } catch (_) {}
        }
    });

    $(document).on("click.party", "#uie-party-window .party-track-edit, #uie-party-member-modal .party-track-edit", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const card = $(this).closest(".party-tracker-card");
        if (!card.length) return;

        const id = String(card.attr("data-track-id") || "").trim();
        if (!id) return;

        const s2 = getSettings();
        const m = getSelectedTrackerMember(s2);
        if (!m) return;
        openMemberTrackerModal(m, id);
    });

    $(document).on("click.party", "#party-track-modal-close, #party-track-modal-cancel", function(e) {
        e.preventDefault();
        e.stopPropagation();
        closeMemberTrackerModal();
    });

    $(document).on("click.party", "#party-track-modal-save", function(e) {
        e.preventDefault();
        e.stopPropagation();
        saveMemberTrackerModal();
    });

    $(document).on("click.party", "#party-track-modal-delete", function(e) {
        e.preventDefault();
        e.stopPropagation();
        deleteMemberTrackerFromModal();
    });

    $(document).on("click.party", "#uie-party-tracker-modal", function(e) {
        e.stopPropagation();
        if ($(e.target).closest("#party-track-modal-box").length) return;
        closeMemberTrackerModal();
    });

    $(document).on("click.party", "#uie-party-window .party-track-del, #uie-party-member-modal .party-track-del", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const card = $(this).closest(".party-tracker-card");
        if (!card.length) return;
        const id = String(card.attr("data-track-id") || "").trim();
        if (!id) return;

        const s2 = getSettings();
        ensureParty(s2);
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (!m) return;
        ensureMember(m);

        const idx = m.trackers.findIndex((x) => String(x?.id || "").trim() === id);
        if (idx < 0) return;
        if (!window.confirm("Delete this tracker?")) return;
        m.trackers.splice(idx, 1);
        saveSettings();
        render();
        if (memberModalOpen) {
            try { renderMemberModal(s2, m); } catch (_) {}
        }
    });

    $(document).on("click.party", "#uie-party-window #party-scan-chat", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        await scanPartyFromChat();
    });

    $(document).on("click.party", "#uie-party-window #party-import-card", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        await importPartyCharacterCard();
    });

    $(document).on("click.party", "#uie-party-window #uie-party-export", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        ensureParty(s2);
        downloadJsonFile(`uie_party_${new Date().toISOString().slice(0, 10)}.json`, s2.party);
        try { window.toastr?.success?.("Party exported."); } catch (_) {}
    });

    $(document).on("click.party", "#uie-party-window #uie-party-import", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const txt = await pickJsonFile();
        if (!txt) return;
        let obj = null;
        try {
            const cleaned = String(txt || "").replace(/^\uFEFF/, "").trim();
            obj = JSON.parse(cleaned);
        } catch (_) {
            obj = null;
        }
        const incoming = obj && typeof obj === "object" ? (obj.party && typeof obj.party === "object" ? obj.party : obj) : null;
        if (!incoming || typeof incoming !== "object") {
            try { window.toastr?.error?.("Invalid party file."); } catch (_) {}
            return;
        }
        const s2 = getSettings();
        s2.party = { ...incoming };
        ensureParty(s2);
        if (!Array.isArray(s2.party.members)) s2.party.members = [];
        for (const m of s2.party.members) ensureMember(m);
        saveSettings();
        render();
        try { window.toastr?.success?.("Party imported."); } catch (_) {}
    });

    $(document).on("click.party", "#uie-party-window #uie-party-save-meta", function() {
        const s = getSettings();
        s.party.name = $("#uie-party-name-input").val();
        saveSettings();
        render();
        if(window.toastr) toastr.success("Party info saved.");
    });

    $(document).on("click.party", "#uie-party-window #party-inv-add", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        ensureParty(s2);
        const target = String($("#party-inv-target").val() || partyInventoryTarget || "shared");
        const list = target === "shared" ? s2.party.sharedItems : (getMember(s2, target.slice("member:".length))?.personalItems);
        if (!list) {
            notify("warning", "Select a valid party member.", "Party");
            return;
        }
        const name = String(window.prompt("Item name:", "") || "").trim();
        if (!name) return;
        const type = String(window.prompt("Item type:", "misc") || "misc").trim() || "misc";
        const qtyIn = Number(window.prompt("Quantity:", "1"));
        const qty = Number.isFinite(qtyIn) && qtyIn > 0 ? Math.floor(qtyIn) : 1;
        list.push({ name, type, qty });
        saveSettings();
        render();
    });

    $(document).on("click.party", "#uie-party-window .party-inv-del", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number($(this).attr("data-idx"));
        if (!Number.isFinite(idx)) return;
        const s2 = getSettings();
        ensureParty(s2);
        const target = String($(this).closest(".party-inv-row").attr("data-inv-target") || partyInventoryTarget || "shared");
        const combined = resolvePartyStashList(s2, target);
        if (!combined || idx < 0 || idx >= combined.length) return;
        const clickedItem = combined[idx];
        if (clickedItem && clickedItem.source === "Lorebook") {
            notify("warning", "This item is defined in a Lorebook. Edit or delete the lorebook entry to remove it.", "Party");
            return;
        }
        const actualList = target === "shared" ? s2.party.sharedItems : (getMember(s2, target.slice("member:".length))?.personalItems);
        if (!actualList) return;
        const actualIdx = actualList.findIndex(item => item && item.name === clickedItem.name && item.type === clickedItem.type);
        if (actualIdx >= 0) {
            actualList.splice(actualIdx, 1);
            saveSettings();
            render();
        }
    });

    $(document).on("click.party", "#uie-party-window .party-inv-transfer", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number($(this).attr("data-idx"));
        if (!Number.isFinite(idx)) return;
        const s2 = getSettings();
        ensureParty(s2);
        const fromTarget = String($(this).closest(".party-inv-row").attr("data-inv-target") || partyInventoryTarget || "shared");
        const items = resolvePartyStashList(s2, fromTarget);
        const it = items?.[idx];
        if (!it) return;
        if (it.source === "Lorebook") {
            notify("warning", "Lorebook items cannot be transferred from here.", "Party");
            return;
        }
        let toTarget = "shared";
        if (fromTarget === "shared") {
            const m = selectedId ? getMember(s2, selectedId) : (Array.isArray(s2.party.members) ? s2.party.members.find(x => x && x.active !== false) : null);
            if (!m) {
                notify("warning", "Select a party member before transferring from the shared stash.", "Party");
                return;
            }
            toTarget = `member:${m.id}`;
        }
        if (toTarget === fromTarget) return;
        const moved = transferInventoryItem(s2, fromTarget, toTarget, it, 1);
        if (moved) {
            const toLabel = toTarget === "shared" ? "shared stash" : (getMember(s2, toTarget.slice("member:".length))?.identity?.name || "member bag");
            notify("success", `Transferred ${String(moved.name || "item")} to ${toLabel}.`, "Party");
            render();
        }
    });

    $(document).on("click.party", "#uie-party-window .party-inv-gift", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number($(this).attr("data-idx"));
        if (!Number.isFinite(idx)) return;
        const s2 = getSettings();
        ensureParty(s2);
        const target = String($(this).closest(".party-inv-row").attr("data-inv-target") || partyInventoryTarget || "shared");
        const items = resolvePartyStashList(s2, target);
        if (!items) return;
        const it = items[idx];
        if (!it) return;
        if (it.source === "Lorebook") {
            notify("warning", "Lorebook items cannot be gifted.", "Party");
            return;
        }
        const itemLabel = `${String(it.name || "Item").trim()}${it.qty > 1 ? ` x${it.qty}` : ""} (${String(it.type || "misc")})`;
        const who = await pickGiftContact(String(it.name || "Item").trim() || "Item");
        if (!who) return;
        try {
            notify("info", "Deciding reaction…", "Party");
        } catch (_) {}
        const r = await applyItemGiftToContact(who, itemLabel, { fromPartyStash: true });
        if (r?.ok) {
            const d = r.affinityDelta ?? 0;
            const dTxt = `${d >= 0 ? "+" : ""}${d}`;
            if (r.accepted) {
                const actualList = target === "shared" ? s2.party.sharedItems : (getMember(s2, target.slice("member:".length))?.personalItems);
                if (actualList) {
                    const actualIdx = actualList.findIndex(item => item && item.name === it.name && item.type === it.type);
                    if (actualIdx >= 0) {
                        const actualIt = actualList[actualIdx];
                        const q = Number(actualIt.qty || 1);
                        if (Number.isFinite(q) && q > 1) actualIt.qty = q - 1;
                        else actualList.splice(actualIdx, 1);
                        saveSettings();
                    }
                }
                notify("success", `${who} accepted the gift. Affinity ~${r.affinity} (${dTxt}).`, "Party");
            } else {
                notify("warning", `${who} refused the gift. Affinity ~${r.affinity} (${dTxt}). ${r.reason || ""}`, "Party");
            }
        } else {
            notify("warning", String(r?.error || "Gift failed."), "Party");
        }
        render();
    });

    $(document).on("click.party", "#uie-party-window .party-slot", function(e) {
        e.preventDefault();
        e.stopPropagation();
        if ($(this).attr("data-add-slot") === "true") {
            const label = String(window.prompt("Name the new equipment slot:", "") || "").trim();
            if (!label) return;
            const s2 = getSettings();
            ensureParty(s2);
            if (addCustomEquipmentSlot(s2, label)) {
                saveSettings();
                render();
            }
            return;
        }
        const slot = String($(this).attr("data-slot") || "").trim();
        if (!slot) return;
        const s2 = getSettings();
        ensureParty(s2);
        const memberId = String($("#party-gear-member").val() || selectedId || "");
        const m = memberId ? getMember(s2, memberId) : null;
        if (!m) return;
        ensureMember(m);
        
        const shared = resolvePartyStashList(s2, "shared") || [];
        const personal = resolvePartyStashList(s2, `member:${m.id}`) || [];
        
        $("#uie-party-equip-picker-title").text(`Equip ${slot.toUpperCase()}`);
        $("#uie-party-equip-picker-create").attr("data-slot", slot).attr("data-member", m.id);
        const grid = $("#uie-party-equip-picker-grid").empty();
        
        const candidates = [];
        shared.forEach((it, idx) => {
            candidates.push({ item: it, index: idx, isShared: true });
        });
        personal.forEach((it, idx) => {
            candidates.push({ item: it, index: idx, isShared: false });
        });
        
        if (!candidates.length) {
            grid.html(`<div class="party-empty" style="font-size:12px; padding:16px;">No stash or bag items.</div>`);
        } else {
            candidates.forEach((cand) => {
                const it = cand.item;
                const sourceText = cand.isShared ? "Shared Stash" : "Personal Bag";
                const badgeColor = cand.isShared ? "var(--party-cyan)" : "var(--party-gold)";
                
                const itemEl = $(`
                    <div class="party-inv-row" style="cursor:pointer; display:flex; align-items:center; justify-content:space-between; padding:10px 12px; margin-bottom:4px; border:1px solid rgba(255,255,255,0.06); transition:all 0.2s;">
                        <div style="min-width:0; flex:1;">
                            <div class="inv-name" style="font-size:12px; font-weight:900; color:#fff;">${esc(it.name || "Unnamed Item")}</div>
                            <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
                                <span class="inv-type" style="font-size:10px; color:var(--party-muted);">${esc(it.type || "misc")}</span>
                                <span style="font-size:9px; font-weight:900; text-transform:uppercase; padding:1px 4px; border-radius:3px; background:rgba(255,255,255,0.04); border:1px solid ${badgeColor}; color:${badgeColor};">${sourceText}</span>
                            </div>
                        </div>
                        <i class="fa-solid fa-chevron-right" style="font-size:12px; color:var(--party-muted); margin-left:8px;"></i>
                    </div>
                `);
                
                itemEl.on("click", function() {
                    const equipped = cloneInventoryItem(it);
                    delete equipped.qty;
                    delete equipped.quantity;
                    if (equipped.image && !equipped.img) equipped.img = equipped.image;
                    if (it.source !== "Lorebook") {
                        const actualList = cand.isShared ? s2.party.sharedItems : m.personalItems;
                        const actualIdx = findMatchingActualItem(actualList, it);
                        if (actualIdx >= 0) {
                            const q = itemQuantity(actualList[actualIdx]);
                            if (q > 1) setItemQuantity(actualList[actualIdx], q - 1);
                            else actualList.splice(actualIdx, 1);
                        }
                    }
                    equipped.name = String(equipped.name || equipped.title || "Item");
                    equipped.type = String(equipped.type || equipped.category || "misc");
                    saveEquipmentLoadout(s2, m, slot, equipped, { returnPreviousTo: `member:${m.id}` });
                    render();
                    $("#uie-party-equip-picker-modal").hide();
                });
                
                grid.append(itemEl);
            });
        }
        
        $("#uie-party-equip-picker-unequip").off("click").on("click", function() {
            saveEquipmentLoadout(s2, m, slot, null, { returnPreviousTo: `member:${m.id}` });
            render();
            $("#uie-party-equip-picker-modal").hide();
        });
        
        $("#uie-party-equip-picker-close, #uie-party-equip-picker-cancel").off("click").on("click", function() {
            $("#uie-party-equip-picker-modal").hide();
        });
        
        $("#uie-party-equip-picker-modal").css("display", "flex");
    });

    $(document).on("click.party", "#uie-party-window .party-gear-portrait-pick", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const id = String($(this).attr("data-id") || selectedId || "");
        const s2 = getSettings();
        ensureParty(s2);
        const m = id ? getMember(s2, id) : null;
        if (!m) return;
        await pickPortraitForMember(s2, m, "portrait");
        render();
    });

    $(document).on("click.party", "#uie-party-member-modal #uie-party-member-bg-edit", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        try {
            const Backgrounds = await import("./backgrounds.js");
            Backgrounds.showBackgroundPicker("partyMember", "Party Member Background");
        } catch (_) {}
    });

    $(document).on("click.party pointerup.party", "#uie-party-window .party-row", function(e) {
        if (e.type === "pointerup") {
            const pt = String(e.pointerType || "").toLowerCase();
            if (pt && pt !== "touch" && pt !== "pen") return;
        }
        if ($(e.target).closest("button").length) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "pointerup") {
            lastTouchOpenAt = Date.now();
        } else {
            const t = Number(lastTouchOpenAt || 0);
            if (t && Date.now() - t < 650) return;
        }
        const id = String($(this).data("id"));
        if (!id) return;
        selectedId = id;
        render();
    });

    $(document).on("click.party pointerup.party", "#uie-party-window .party-form-member", function(e) {
        if (e.type === "pointerup") {
            const pt = String(e.pointerType || "").toLowerCase();
            if (pt && pt !== "touch" && pt !== "pen") return;
        }
        if ($(e.target).closest("button, select, option").length) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "pointerup") {
            lastTouchOpenAt = Date.now();
        } else {
            const t = Number(lastTouchOpenAt || 0);
            if (t && Date.now() - t < 650) return;
        }
        const id = String($(this).data("id"));
        if (!id) return;
        selectedId = id;
        render();
    });

    $body.on("click.party pointerup.party", "[id='uie-party-member-modal'] [id='uie-party-member-close']", function(e){
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        closeMemberModal();
    });

    $body.on("click.party pointerup.party", "[id='uie-party-member-modal']", function(e){
        if ($(e.target).closest("[id='uie-party-member-card']").length) return;
        e.stopPropagation();
        e.stopImmediatePropagation();
        if ($(e.target).closest("[id='uie-party-member-close']").length) {
            closeMemberModal();
            return;
        }
        const now = Date.now();
        const openedAgo = now - Number(memberModalOpenedAt || 0);
        if (ignoreNextBackdropClick || openedAgo < 220) {
            ignoreNextBackdropClick = false;
            return;
        }
        closeMemberModal();
    });

    $(document).on("click.party", "#uie-party-member-modal #party-paperdoll-pick", async function(e){
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (!m) return;
        await pickPortraitForMember(s2, m, "paperDoll");
    });

    $(document).on("click.party", "#uie-party-member-modal #party-mm-pick-portrait, #uie-party-member-modal .sheet-portrait-container, #uie-party-member-modal #party-mm-pick-portrait-equip", async function(e){
        e.preventDefault();
        e.stopPropagation();
        if (!memberEdit) return;
        const s2 = getSettings();
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (!m) return;
        await pickPortraitForMember(s2, m, "portrait");
    });

    $(document).on("click.party", "#uie-party-member-modal #party-mm-add-skill", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (!m) return;
        ensureMember(m);
        m.skills.push({ name: "", description: "", skillType: "active" });
        saveSettings();
        renderMemberModal(s2, m);
    });

    $(document).on("click.party", "#uie-party-member-modal .party-mm-skill-del", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number($(this).data("skill-del"));
        if (!Number.isFinite(idx)) return;
        const s2 = getSettings();
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (!m) return;
        ensureMember(m);
        const removed = m.skills[idx];
        m.skills.splice(idx, 1);
        saveSettings();
        renderMemberModal(s2, m);
        try { injectRpEvent(`[System: Removed skill '${removed?.name || "Unknown"}' from ${m.identity.name}.]`); } catch (_) {}
    });

    $(document).on("click.party", "#uie-party-member-modal #party-mm-add-stat", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (!m) return;
        ensureMember(m);
        if (!m.stats) m.stats = {};
        const statName = prompt("Enter stat name (e.g., 'magic', 'stamina', 'luck'):");
        if (!statName || !statName.trim()) return;
        const key = statName.trim().toLowerCase().replace(/\s+/g, "_");
        if (m.stats[key] !== undefined && !(m.hiddenStats || []).includes(key)) {
            alert("Stat already exists!");
            return;
        }
        m.stats[key] = 0;
        m.hiddenStats = (m.hiddenStats || []).filter((item) => String(item) !== key);
        saveSettings();
        renderMemberModal(s2, m);
    });

    $(document).on("click.party", "#uie-party-member-modal .party-stat-del", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const statKey = String($(this).data("stat-del") || "");
        if (!statKey) return;
        const s2 = getSettings();
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (!m) return;
        ensureMember(m);
        if (!confirm(`Delete stat '${statKey}'?`)) return;
        m.hiddenStats = Array.from(new Set([...(m.hiddenStats || []), statKey]));
        saveSettings();
        renderMemberModal(s2, m);
    });

    $(document).on("click.party", "#uie-party-member-modal #party-mm-save", function(e){
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (!m) return;
        ensureMember(m);

        m.identity.name = String($("#party-mm-name").val() || "").trim() || m.identity.name;
        m.identity.class = String($("#party-mm-class").val() || "").trim();
        m.partyRole = String($("#party-mm-role").val() || m.partyRole || "DPS");
        if (!m.progression) m.progression = { level: 1, xp: 0, skillPoints: 0, perkPoints: 0 };
        m.progression.level = Number($("#party-mm-level").val() || m.progression.level || 1);

        $("#uie-party-member-content [data-stat]").each(function(){
            const k = String($(this).data("stat") || "");
            if (!k) return;
            m.stats[k] = Number($(this).val() || m.stats[k] || 0);
        });
        $("#uie-party-member-content [data-vital]").each(function(){
            const k = String($(this).data("vital") || "");
            if (!k) return;
            m.vitals[k] = Number($(this).val() || m.vitals[k] || 0);
        });
        $("#uie-party-member-content [data-eq]").each(function(){
            const k = String($(this).data("eq") || "");
            if (!k) return;
            const v = String($(this).val() || "").trim();
            if (!m.equipment) m.equipment = {};
            if (v) {
                const existing = m.equipment[k];
                m.equipment[k] = existing && typeof existing === "object" ? { ...existing, name: v } : v;
            }
            else delete m.equipment[k];
        });

        const skillInputs = $("#uie-party-member-content [data-skill-name]");
        if (skillInputs.length) {
            const out = [];
            skillInputs.each(function () {
                const idx = Number($(this).attr("data-skill-name"));
                if (!Number.isFinite(idx)) return;
                const name = String($(this).val() || "").trim();
                const desc = String($(`#uie-party-member-content [data-skill-desc="${idx}"]`).val() || "").trim();
                const type = String($(`#uie-party-member-content [data-skill-type="${idx}"]`).val() || "active").toLowerCase();
                const tracker = String($(`#uie-party-member-content [data-skill-tracker="${idx}"]`).val() || "").trim();
                if (!name) return;
                const skill = { name: name.slice(0, 80), description: desc.slice(0, 1200), skillType: (type === "passive" ? "passive" : "active") };
                if (tracker) skill.lifeTracker = tracker.slice(0, 60);
                out.push(skill);
            });
            m.skills = out;
        } else {
            const sk = String($("#party-mm-skills").val() || "");
            m.skills = sk.split("\n").map(x => x.trim()).filter(Boolean);
        }
        const fx = String($("#party-mm-fx").val() || "");
        m.statusEffects = fx.split(",").map(x => x.trim()).filter(Boolean).slice(0, 30);

        saveSettings();
        render();
        renderMemberModal(s2, m);
    });

    $(document).on("click.party", "#uie-party-member-modal #party-mm-profile-scan", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const btn = $(this);
        const prevText = btn.text();
        btn.prop("disabled", true).text("Checking Lore...");
        
        try {
            const s2 = getSettings();
            const m = selectedId ? getMember(s2, selectedId) : null;
            if (!m) return;
            ensureMember(m);
            
            let profileText = "";
            if (m.notes) profileText += `Notes:\n${m.notes}\n\n`;
            
            const cardName = String(m.identity?.name || "").trim().toLowerCase();
            if (cardName && Array.isArray(s2.character_cards)) {
                const card = s2.character_cards.find(c => {
                    const cName = String(c?.name || c?.data?.name || "").trim().toLowerCase();
                    return cName === cardName;
                });
                if (card) {
                    const desc = String(card?.data?.description || card?.description || "").trim();
                    const personality = String(card?.data?.personality || card?.personality || "").trim();
                    if (desc) profileText += `Character Description:\n${desc}\n\n`;
                    if (personality) profileText += `Character Personality:\n${personality}\n\n`;
                }
            }
            
            if (!profileText.trim()) {
                notify("warning", "Character notes and character card are empty. Add some description first.", "Party");
                return;
            }
            
            const prompt = SCAN_TEMPLATES.profile.extract(m.identity?.name || "Companion", profileText);
            const res = await generateContent(prompt, "Profile Lore Scan");
            if (!res) throw new Error("No response from AI.");
            
            let parsed = null;
            try {
                parsed = JSON.parse(res.trim());
            } catch (_) {
                const repaired = res.match(/\{[\s\S]*\}/);
                if (repaired) {
                    parsed = JSON.parse(repaired[0]);
                }
            }
            
            if (!parsed || typeof parsed !== "object") {
                throw new Error("AI response was not valid JSON.");
            }
            
            // Apply items
            if (Array.isArray(parsed.items) && parsed.items.length) {
                if (!Array.isArray(m.personalItems)) m.personalItems = [];
                parsed.items.forEach(it => {
                    const exists = m.personalItems.some(x => String(x.name || "").toLowerCase() === String(it.name || "").toLowerCase());
                    if (!exists) {
                        m.personalItems.push({
                            name: String(it.name || "Item"),
                            type: String(it.type || "item"),
                            description: String(it.desc || it.description || ""),
                            qty: Number(it.qty) || 1,
                            rarity: "common"
                        });
                    }
                });
            }
            
            // Apply skills
            if (Array.isArray(parsed.skills) && parsed.skills.length) {
                if (!Array.isArray(m.skills)) m.skills = [];
                parsed.skills.forEach(sk => {
                    const exists = m.skills.some(x => String(x.name || "").toLowerCase() === String(sk.name || "").toLowerCase());
                    if (!exists) {
                        m.skills.push({
                            name: String(sk.name || "Skill"),
                            description: String(sk.desc || sk.description || ""),
                            skillType: String(sk.type || "active").toLowerCase() === "passive" ? "passive" : "active"
                        });
                    }
                });
            }
            
            // Apply equipment
            if (Array.isArray(parsed.equipped) && parsed.equipped.length) {
                if (!m.equipment) m.equipment = {};
                parsed.equipped.forEach(eq => {
                    const slot = String(eq.slotId || eq.slot || "").trim().toLowerCase();
                    const validSlots = ["head", "chest", "legs", "feet", "hands", "weapon", "offhand", "accessory1", "accessory2"];
                    if (validSlots.includes(slot) && !m.equipment[slot]) {
                        m.equipment[slot] = String(eq.name || "");
                    }
                });
            }
            
            // Apply appearance notes
            if (parsed.appearance && String(parsed.appearance).trim()) {
                const appText = `Appearance details: ${String(parsed.appearance).trim()}`;
                if (!String(m.notes || "").includes("Appearance details:")) {
                    m.notes = m.notes ? `${m.notes}\n\n${appText}` : appText;
                }
            }
            
            saveSettings();
            notify("success", `Lore checked successfully! Extracted components have been integrated.`, "Party");
            render();
            renderMemberModal(s2, m);
        } catch (err) {
            console.error(err);
            notify("warning", `Lore check failed: ${String(err.message || err)}`, "Party");
        } finally {
            btn.prop("disabled", false).text(prevText);
        }
    });

    $(document).on("click.party", "#uie-party-member-modal .party-fx, #uie-party-window .party-fx", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const txt = String(this.getAttribute("data-detail") || this.getAttribute("title") || "").trim();
        if (!txt) return;
        let box = document.getElementById("uie-party-fx-pop");
        const popZ = String(getMemberModalZIndex() + 2);
        if (!box) {
            box = document.createElement("div");
            box.id = "uie-party-fx-pop";
            box.style.cssText = `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:${popZ};max-width:min(380px,92vw);padding:12px 14px;border-radius:16px;border:1px solid rgba(255,255,255,0.12);background:rgba(15,10,8,0.96);color:#fff;font-weight:750;white-space:pre-line;line-height:1.55;cursor:pointer;`;
            document.body.appendChild(box);
            box.addEventListener("click", () => { try { box.remove(); } catch (_) {} });
        }
        box.style.zIndex = popZ;
        box.textContent = txt;
    });

    $(document).on("click.party", "#uie-party-member-modal .party-skill", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const name = String(this.getAttribute("data-name") || "").trim();
        const desc = String(this.getAttribute("data-desc") || "").trim();
        const txt = desc ? `${name}\n\n${desc}` : name;
        if (!txt.trim()) return;
        let box = document.getElementById("uie-party-skill-pop");
        const popZ = String(getMemberModalZIndex() + 2);
        if (!box) {
            box = document.createElement("div");
            box.id = "uie-party-skill-pop";
            box.style.cssText = `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:${popZ};max-width:min(420px,92vw);max-height:min(60vh,520px);overflow:auto;white-space:pre-wrap;padding:12px 14px;border-radius:16px;border:1px solid rgba(255,255,255,0.12);background:rgba(15,10,8,0.96);color:#fff;font-weight:900;`;
            document.body.appendChild(box);
            box.addEventListener("click", () => { try { box.remove(); } catch (_) {} });
        }
        box.style.zIndex = popZ;
        box.textContent = txt;
    });

    $(document).on("click.party", "#uie-party-window .party-mini", function(e) {
        e.stopPropagation();
        const act = $(this).data("act");
        const id = String($(this).data("id"));
        const s = getSettings();
        const idx = s.party.members.findIndex(m => String(m.id) === id);
        if (idx === -1) return;

        if (act === "edit") {
            openMemberModal(getSettings(), id, true);
        } else if (act === "delete") {
            if (confirm("Remove this member?")) {
                const leavingName = String(s.party?.members?.[idx]?.identity?.name || s.party?.members?.[idx]?.name || "Member");
                if (selectedId === id) {
                    try { closeMemberModal(); } catch (_) {}
                    selectedId = null;
                }
                if (s.party.leaderId === id) s.party.leaderId = null;
                try {
                    const lanes = s.party?.formation?.lanes || null;
                    if (lanes && typeof lanes === "object") {
                        for (const key of ["front", "mid", "back"]) {
                            if (!Array.isArray(lanes[key])) lanes[key] = [];
                            lanes[key] = lanes[key].filter(x => String(x || "") !== id);
                        }
                    }
                } catch (_) {}
                try {
                    const members = Array.isArray(s.party?.members) ? s.party.members : [];
                    for (const m of members) {
                        if (!m || typeof m !== "object") continue;
                        if (m?.tactics?.protectId && String(m.tactics.protectId) === id) m.tactics.protectId = "";
                    }
                } catch (_) {}
                try {
                    if (s.party?.partyTactics?.protectId && String(s.party.partyTactics.protectId) === id) s.party.partyTactics.protectId = "";
                } catch (_) {}
                try {
                    const rel = s.party?.relationships;
                    if (rel && typeof rel === "object") {
                        delete rel[id];
                        for (const [k, v] of Object.entries(rel)) {
                            if (!v || typeof v !== "object") continue;
                            if (v[id] !== undefined) delete v[id];
                        }
                    }
                } catch (_) {}
                s.party.members.splice(idx, 1);
                try { injectRpEvent(`[System: ${leavingName} left the party.]`); } catch (_) {}
                if (!selectedId) {
                    const next = s.party.members.find(m => m && m.active !== false);
                    selectedId = next ? String(next.id || "") : null;
                }
                saveSettings();
                render();
            }
        } else if (act === "leader") {
            s.party.leaderId = id;
            saveSettings();
            render();
        } else if (act === "toggleActive") {
            s.party.members[idx].active = s.party.members[idx].active === false;
            saveSettings();
            render();
        } else if (act === "toggleFollow") {
            s.party.members[idx].followsUser = s.party.members[idx].followsUser !== true;
            saveSettings();
            render();
        }
    });

    $(document).on("change.party", "#uie-party-window #party-tac-preset, #uie-party-window #party-tac-conserve, #uie-party-window #party-tac-protect-leader", function(e){
        e.preventDefault();
        const s2 = getSettings();
        ensureParty(s2);
        if (!s2.party.partyTactics) s2.party.partyTactics = { preset: "Balanced", conserveMana: false, protectLeader: false };
        s2.party.partyTactics.preset = String($("#party-tac-preset").val() || "Balanced");
        s2.party.partyTactics.conserveMana = !!$("#party-tac-conserve").prop("checked");
        s2.party.partyTactics.protectLeader = !!$("#party-tac-protect-leader").prop("checked");
        saveSettings();
        try { injectRpEvent(`[System: Party tactics updated. ${summarizePartyTacticsForRp(s2)}]`); } catch (_) {}
    });

    $(document).on("change.party", "#uie-party-window .member-tac-preset, #uie-party-window .member-tac-focus, #uie-party-window .member-tac-protect, #uie-party-window .member-tac-mana", function(e){
        e.preventDefault();
        const id = String($(this).data("id") || "");
        if (!id) return;
        const s2 = getSettings();
        ensureParty(s2);
        const m = getMember(s2, id);
        if (!m) return;
        ensureMember(m);
        const preset = String($(`.member-tac-preset[data-id="${id}"]`).val() || m.tactics?.preset || "Balanced");
        const focus = String($(`.member-tac-focus[data-id="${id}"]`).val() || m.tactics?.focus || "auto");
        const protectId = String($(`.member-tac-protect[data-id="${id}"]`).val() || m.tactics?.protectId || "");
        const conserveMana = !!$(`.member-tac-mana[data-id="${id}"]`).prop("checked");
        m.tactics = { ...(m.tactics || {}), preset, focus, protectId, conserveMana };
        saveSettings();
        try {
            const protectName = protectId ? (getMember(s2, protectId)?.identity?.name || protectId) : "none";
            injectRpEvent(`[System: ${String(m.identity?.name || "Member")} tactics updated. Preset=${preset}, Focus=${focus}, Protect=${protectName}, ConserveMana=${conserveMana ? "On" : "Off"}.]`);
        } catch (_) {}
    });

    $(document).on("click.party", "#uie-party-window .form-add", function(e){
        e.preventDefault();
        e.stopPropagation();
        const lane = String($(this).data("lane") || "");
        const s2 = getSettings();
        ensureParty(s2);
        if (!s2.party.formation) s2.party.formation = { lanes: { front: [], mid: [], back: [] } };
        if (!s2.party.formation.lanes) s2.party.formation.lanes = { front: [], mid: [], back: [] };
        const id = String($(`#form-add-${lane}`).val() || "");
        if (!id) return;
        const lanes = s2.party.formation.lanes;
        for (const k of ["front","mid","back"]) lanes[k] = (lanes[k] || []).filter(x => String(x) !== id);
        if (!Array.isArray(lanes[lane])) lanes[lane] = [];
        lanes[lane].push(id);
        saveSettings();
        render();
        try { injectRpEvent(`[System: Party formation updated. ${summarizeFormationForRp(s2)}]`); } catch (_) {}
    });

    $(document).on("dragstart.party", "#uie-party-window .party-form-member", function(e) {
        const id = String($(this).data("id") || "");
        if (!id) return;
        e.originalEvent?.dataTransfer?.setData("text/plain", id);
        e.originalEvent?.dataTransfer?.setData("application/x-uie-party-member", id);
        selectedId = id;
    });

    $(document).on("dragover.party", "#uie-party-window .lane-card", function(e) {
        e.preventDefault();
    });

    $(document).on("drop.party", "#uie-party-window .lane-card", function(e) {
        e.preventDefault();
        const lane = String($(this).data("lane") || "");
        const id = String(e.originalEvent?.dataTransfer?.getData("application/x-uie-party-member") || e.originalEvent?.dataTransfer?.getData("text/plain") || "");
        if (!lane || !id) return;
        const s2 = getSettings();
        ensureParty(s2);
        if (!s2.party.formation) s2.party.formation = { lanes: { front: [], mid: [], back: [] } };
        if (!s2.party.formation.lanes) s2.party.formation.lanes = { front: [], mid: [], back: [] };
        const lanes = s2.party.formation.lanes;
        for (const k of ["front", "mid", "back"]) lanes[k] = (Array.isArray(lanes[k]) ? lanes[k] : []).filter(x => String(x) !== id);
        if (!Array.isArray(lanes[lane])) lanes[lane] = [];
        lanes[lane].push(id);
        selectedId = id;
        saveSettings();
        render();
        try { injectRpEvent(`[System: Party formation updated. ${summarizeFormationForRp(s2)}]`); } catch (_) {}
    });

    $(document).on("click.party", "#uie-party-window .form-rm", function(e){
        e.preventDefault();
        e.stopPropagation();
        const lane = String($(this).data("lane") || "");
        const id = String($(this).data("id") || "");
        const s2 = getSettings();
        ensureParty(s2);
        const lanes = s2.party.formation?.lanes;
        if (!lanes || !Array.isArray(lanes[lane])) return;
        lanes[lane] = lanes[lane].filter(x => String(x) !== id);
        saveSettings();
        render();
        try { injectRpEvent(`[System: Party formation updated. ${summarizeFormationForRp(s2)}]`); } catch (_) {}
    });

    $(document).on("click.party", "#uie-party-window .form-mv", function(e){
        e.preventDefault();
        e.stopPropagation();
        const act = String($(this).data("act") || "");
        const lane = String($(this).data("lane") || "");
        const id = String($(this).data("id") || "");
        const s2 = getSettings();
        ensureParty(s2);
        const lanes = s2.party.formation?.lanes;
        if (!lanes || !Array.isArray(lanes[lane])) return;
        const arr = lanes[lane].map(String);
        const idx = arr.findIndex(x => x === id);
        if (idx < 0) return;
        const next = act === "up" ? idx - 1 : idx + 1;
        if (next < 0 || next >= arr.length) return;
        const tmp = arr[idx];
        arr[idx] = arr[next];
        arr[next] = tmp;
        lanes[lane] = arr;
        saveSettings();
        render();
        try { injectRpEvent(`[System: Party formation updated. ${summarizeFormationForRp(s2)}]`); } catch (_) {}
    });

    $(document).on("change.party", "#uie-party-window .form-role", function(e){
        e.preventDefault();
        const id = String($(this).data("id") || "");
        if (!id) return;
        const s2 = getSettings();
        ensureParty(s2);
        const m = getMember(s2, id);
        if (!m) return;
        ensureMember(m);
        m.partyRole = String($(this).val() || m.partyRole || "DPS");
        saveSettings();
        render();
        try { injectRpEvent(`[System: ${String(m.identity?.name || "Member")} role set to ${String(m.partyRole || "DPS")}.]`); } catch (_) {}
    });

    $(document).on("click.party", "#uie-party-window #pm-save", function() {
        const s = getSettings();
        const m = getMember(s, selectedId);
        if (!m) return;

        m.identity.name = $("#pm-name").val();
        m.identity.class = $("#pm-class").val();
        m.stats.str = Number($("#pm-str").val());
        m.stats.dex = Number($("#pm-dex").val());
        m.stats.con = Number($("#pm-con").val());
        m.stats.int = Number($("#pm-int").val());
        m.stats.wis = Number($("#pm-wis").val());
        m.stats.cha = Number($("#pm-cha").val());
        m.stats.per = Number($("#pm-per").val());
        m.stats.luk = Number($("#pm-luk").val());

        m.vitals.hp = Number($("#pm-hp").val());
        m.vitals.maxHp = Number($("#pm-maxhp").val());
        m.vitals.mp = Number($("#pm-mp").val());
        m.vitals.maxMp = Number($("#pm-maxmp").val());

        m.notes = $("#pm-notes").val();
        m.customCSS = $("#pm-css").val();

        const isUser = isUserMember(s, m);
        if (isUser) {
            applyMemberToCore(s, m);
            try { $(document).trigger("uie:updateVitals"); } catch (_) {}
        }

        saveSettings();
        if(window.toastr) toastr.success("Member saved.");
        render();
    });

    $(document).on("click.party", "#uie-party-window #party-pick-portrait", async function() {
        const id = $(this).data("id");
        const s = getSettings();
        const m = getMember(s, id);
        if (!m) return;
        const img = await pickLocalImage();
        if (img) {
            m.images.portrait = img;
            saveSettings();
            render();
        }
    });

    $(document).on("click.party", "#uie-node-modal-close", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-party-node-modal").hide();
        currentEditingNode = null;
        currentEditingMember = null;
    });

    $(document).on("click.party", "#uie-node-save", function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!currentEditingNode || !currentEditingMember) return;
        
        const m = currentEditingMember;
        const node = currentEditingNode;
        
        node.name = String($("#uie-node-name").val() || "").trim() || node.name;
        node.type = String($("#uie-node-type").val() || "active");
        node.cost = Math.max(1, parseInt($("#uie-node-cost").val() || "1"));
        node.desc = String($("#uie-node-desc").val() || "").trim();
        node.stats = String($("#uie-node-stats").val() || "").trim();
        
        const s2 = getSettings();
        recalculateMemberSkillsAndStats(s2, m);
        saveSettings();
        
        $("#uie-party-node-modal").hide();
        
        const paneSkilltree = $("#party-mm-pane-skilltree");
        if (paneSkilltree.length) {
            renderSkillTree(paneSkilltree, s2, m);
        }
        
        currentEditingNode = null;
        currentEditingMember = null;
        notify("success", "Skill node updated successfully.", "Skills");
    });

    $(document).on("click.party", "#uie-node-delete", function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!currentEditingNode || !currentEditingMember) return;
        if (currentEditingNode.custom !== true) return;
        if (!window.confirm(`Delete ${currentEditingNode.name || "this custom skill"}?`)) return;

        const m = currentEditingMember;
        const nodeId = String(currentEditingNode.id || "");
        if (m.skillTree && Array.isArray(m.skillTree.nodes)) {
            m.skillTree.nodes = m.skillTree.nodes
                .filter((n) => String(n?.id || "") !== nodeId)
                .map((n) => ({ ...n, requires: Array.isArray(n.requires) ? n.requires.filter((id) => String(id) !== nodeId) : [] }));
        }
        const s2 = getSettings();
        recalculateMemberSkillsAndStats(s2, m);
        saveSettings();
        $("#uie-party-node-modal").hide();
        const paneSkilltree = $("#party-mm-pane-skilltree");
        if (paneSkilltree.length) renderSkillTree(paneSkilltree, s2, m);
        currentEditingNode = null;
        currentEditingMember = null;
        notify("success", "Custom skill deleted.", "Skills");
    });

    render();
    schedulePartyLayoutLock();
}
