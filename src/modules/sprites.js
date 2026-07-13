
import { getSettings, saveSettings } from "./core.js";

let bound = false;
let activeSet = "";
let category = "character";
let spriteLayerWatchdog = null;
let spriteLayerDeepScanAt = 0;
/** When sprite UI is moved into Scene modal, remember where to restore. */
let spritePanelRestoreParent = null;
let spritePanelRestoreNextSibling = null;

// --- EXISTING CONFIG LOGIC (Preserved) ---
const DEFAULT_KEYS = [
    "admiration","amusement","anger","annoyance","approval",
    "caring","confusion","curiosity","desire","disappointment",
    "disapproval","disgust","embarrassment","excitement","fear",
    "gratitude","grief","joy","love","nervousness","neutral",
    "optimism","pride","realization","relief","remorse","sadness","surprise"
];

const LIFE_SIM_KEYS = [
    "awake","sleepy","tired","hungry","eating","working","studying","walking","running","relaxing",
    "happy","bored","stressed","sick","injured","shy","flirty","blushing","laughing","crying",
    "phone","texting","shopping","cooking","cleaning","driving"
];

const FANTASY_RPG_KEYS = [
    "battle","victory","defeat","casting","healing","stealth","danger","hurt","critical","levelup",
    "loot","merchant","quest","boss","taunt","guard","attack","parry","dodge","magic"
];

const normalizeKey = (k) => String(k || "").trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]+/g, "").slice(0, 64);

function ensureSpriteStore(s) {
    if (!s.ui || typeof s.ui !== "object") s.ui = {};
    if (!s.ui.spriteLibrary || typeof s.ui.spriteLibrary !== "object") {
        s.ui.spriteLibrary = {
            sets: {},
            speakerMap: {},
            customSpriteFolder: ""
        };
    }
    const sp = s.ui.spriteLibrary;
    if (!sp.sets || typeof sp.sets !== "object") sp.sets = {};
    if (!sp.speakerMap || typeof sp.speakerMap !== "object") sp.speakerMap = {};
    if (typeof sp.customSpriteFolder !== "string") sp.customSpriteFolder = "";

    // Ensure sets support type mapping
    for (const name of Object.keys(sp.sets)) {
        const setObj = sp.sets[name];
        if (setObj && typeof setObj === "object") {
            if (!setObj.type) setObj.type = "character";
            if (!setObj.expressions || typeof setObj.expressions !== "object") {
                setObj.expressions = {};
            }
        }
    }

    const old = s.realityEngine && typeof s.realityEngine === "object" ? s.realityEngine.sprites : null;
    if (old && typeof old === "object" && !sp._migratedFromReality) {
        const hasOld =
            (old.sets && Object.keys(old.sets).length) ||
            (old.speakerMap && Object.keys(old.speakerMap).length) ||
            (old.customSpriteFolder && String(old.customSpriteFolder).trim());
        if (hasOld) {
            if (!Object.keys(sp.sets).length && old.sets) Object.assign(sp.sets, old.sets);
            if (!Object.keys(sp.speakerMap).length && old.speakerMap) Object.assign(sp.speakerMap, old.speakerMap);
            if (!String(sp.customSpriteFolder || "").trim() && old.customSpriteFolder) {
                sp.customSpriteFolder = old.customSpriteFolder;
            }
        }
        sp._migratedFromReality = true;
    }
}

function getSpriteStore(s) {
    ensureSpriteStore(s);
    return s.ui.spriteLibrary;
}

function applySpeakerLinksFromInput(s, setName, raw) {
    if (!setName) return;
    ensureSpriteStore(s);
    const map = getSpriteStore(s).speakerMap;
    for (const k of Object.keys(map)) {
        if (map[k] === setName) delete map[k];
    }
    const parts = String(raw || "")
        .split(/[,;]/)
        .map((p) => p.trim())
        .filter(Boolean);
    for (const name of parts) {
        map[name] = setName;
        map[name.toLowerCase()] = setName;
    }
    saveSettings();
}

function getCustomSpriteFolder() {
    const s = getSettings();
    ensureSpriteStore(s);
    return String(getSpriteStore(s).customSpriteFolder || "")
        .trim()
        .replace(/\\/g, "/")
        .replace(/\/+$/, "");
}

function getSets() {
    const s = getSettings();
    ensureSpriteStore(s);
    return getSpriteStore(s).sets;
}

function getSetNames() {
    const sets = getSets();
    return Object.keys(sets).sort((a, b) => String(a).localeCompare(String(b)));
}

function renderSetSelect() {
    const sel = document.getElementById("uie-sprites-set");
    if (!sel) return;
    
    const s = getSettings();
    ensureSpriteStore(s);
    const sets = getSpriteStore(s).sets || {};
    
    // Filter sets based on selected category type
    const names = Object.keys(sets).filter(name => {
        const setObj = sets[name];
        const type = setObj ? (setObj.type || "character") : "character";
        return type === category;
    }).sort((a, b) => String(a).localeCompare(String(b)));
    
    sel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = names.length ? "(Choose a library)" : "(No libraries in this category)";
    sel.appendChild(opt0);
    
    for (const n of names) {
        const o = document.createElement("option");
        o.value = n;
        o.textContent = n;
        sel.appendChild(o);
    }
    
    // Automatically pick first library if activeSet is not in the filtered category
    const activeObj = sets[activeSet];
    const activeType = activeObj ? (activeObj.type || "character") : "character";
    if (activeType !== category || !names.includes(activeSet)) {
        activeSet = names.length ? names[0] : "";
    }
    
    sel.value = activeSet || "";
}

function getKeysForCategory(cat) {
    if (cat === "life_sim") return LIFE_SIM_KEYS.slice();
    if (cat === "fantasy_rpg") return FANTASY_RPG_KEYS.slice();
    if (cat === "custom") return [];
    return DEFAULT_KEYS.slice();
}

function getActiveSetObj() {
    const sets = getSets();
    if (!activeSet) return null;
    const obj = sets[activeSet];
    if (!obj || typeof obj !== "object") return null;
    if (!obj.expressions || typeof obj.expressions !== "object") obj.expressions = {};
    return obj;
}

function getLinkedNames(setName) {
    const s = getSettings();
    const map = getSpriteStore(s).speakerMap || {};
    // Return unique names (ignoring lowercase duplicates if possible, but for display just show what matches)
    // Filter out auto-generated lowercase keys if the original case key exists?
    // Let's just show all keys that map to this set, filtering out duplicates
    const keys = Object.entries(map)
        .filter(([k, v]) => v === setName)
        .map(([k]) => k);

    // Clean up: if we have "Seraphina" and "seraphina", just show "Seraphina"
    const unique = [];
    keys.forEach(k => {
        // If there is another key that is same letters but different case, prefer the one with capitals
        // If this key is lowercase, and we have a case-insensitive match in the list that isn't this one, skip
        if (k === k.toLowerCase() && keys.some(other => other.toLowerCase() === k && other !== k)) return;
        unique.push(k);
    });
    return unique.join(", ");
}

function renderList() {
    const list = document.getElementById("uie-sprites-list");
    if (!list) return;
    const setObj = getActiveSetObj();

    const linkInput = document.getElementById("uie-sprites-link-name");
    if (linkInput) {
        linkInput.value = activeSet ? getLinkedNames(activeSet) : "";
        linkInput.disabled = !activeSet;
    }

    if (!setObj) {
        list.innerHTML = `<div style="opacity:0.85; color:rgba(230,244,255,0.75);">Create a set above, or pick one from the list.</div>`;
        return;
    }
    list.innerHTML = "";

    const expr = setObj.expressions || {};
    const base = getKeysForCategory(category);
    const customKeys = Object.keys(expr || {}).sort((a, b) => String(a).localeCompare(String(b)));
    const keys = Array.from(new Set([...base, ...customKeys])).filter(Boolean);

    const tmpl = document.getElementById("uie-template-sprites-row");
    if (!tmpl) return;

    const frag = document.createDocumentFragment();

    keys.forEach(key => {
        const k = String(key || "").trim();
        const nk = normalizeKey(k);
        const v = expr?.[nk] || null;
        const has = !!(v && typeof v === "object" && typeof v.dataUrl === "string" && v.dataUrl.startsWith("data:"));

        const clone = tmpl.content.cloneNode(true);
        const row = clone.querySelector(".uie-spr-row");
        if (row) row.setAttribute("data-key", nk);

        const thumb = clone.querySelector(".uie-spr-thumb");
        if (thumb) {
            if (has && v?.dataUrl) {
                thumb.style.backgroundImage = `url('${v.dataUrl}')`;
                thumb.style.backgroundSize = "cover";
                thumb.style.backgroundPosition = "center";
                thumb.textContent = "";
                thumb.style.background = ""; // Clear default background color if any, keeping image
                thumb.style.backgroundImage = `url('${v.dataUrl}')`; // Re-apply just in case
            } else {
                thumb.style.background = "rgba(0,0,0,0.25)";
                thumb.style.opacity = "0.8";
                thumb.textContent = "";
            }
        }

        const keyEl = clone.querySelector(".uie-spr-key");
        if (keyEl) keyEl.textContent = k;

        const statusEl = clone.querySelector(".uie-spr-status");
        if (statusEl) statusEl.textContent = has ? "Image set" : "";

        frag.appendChild(clone);
    });

    list.appendChild(frag);
}

function saveSetExpression(setName, key, dataUrl, fileName) {
    const s = getSettings();
    ensureSpriteStore(s);
    const sets = getSpriteStore(s).sets;
    if (!sets[setName] || typeof sets[setName] !== "object") sets[setName] = { expressions: {} };
    if (!sets[setName].expressions || typeof sets[setName].expressions !== "object") sets[setName].expressions = {};
    const nk = normalizeKey(key);
    if (!nk) return;
    if (!dataUrl) {
        delete sets[setName].expressions[nk];
    } else {
        sets[setName].expressions[nk] = { dataUrl: String(dataUrl), fileName: String(fileName || "").slice(0, 120) };
    }
    saveSettings();
}

function readFileAsDataUrl(file) {
    return new Promise((resolve) => {
        if (!file) return resolve("");
        const r = new FileReader();
        r.onload = (e) => resolve(String(e?.target?.result || ""));
        r.onerror = () => resolve("");
        r.readAsDataURL(file);
    });
}

// --- NEW REALITY ENGINE LOGIC (Stage Manager & Entity Engine) ---

let activeEntities = {};

function normalizedLocation(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function characterIsAtCurrentLocation(s, charName) {
    const name = String(charName || "").trim();
    if (!name || /^(narrator|story|system|unknown)$/i.test(name)) return false;
    const current = normalizedLocation(s?.worldState?.location || s?.worldState?.currentLocation || s?.realityEngine?.locationId);
    const currentRoom = normalizedLocation(s?.worldState?.currentRoomId || s?.realityEngine?.locationId);
    const nameKey = name.toLowerCase();
    const scene = Array.isArray(s?.sceneCharacters) ? s.sceneCharacters : [];
    const match = scene.find((char) => String(char?.name || "").trim().toLowerCase() === nameKey);
    if (match) {
        const loc = normalizedLocation(match.location || match.currentLocation || match.locationId);
        return match.active !== false && match.presence !== "away" && (!loc || loc === current || (loc === "start_room" && currentRoom === "start_room"));
    }
    const node = s?.worldState?.mapNodes?.[s?.worldState?.location];
    return Array.isArray(node?.chars) && node.chars.some((x) => String(x || "").trim().toLowerCase() === nameKey);
}

// Robust Multi-Attribute Regex Tag Parser
export function parseStageTags(text) {
    const regex = /\[([^\]]+)\]/g;
    const tags = [];
    let match;
    while ((match = regex.exec(String(text || ""))) !== null) {
        const content = match[1];
        const parts = content.split(',').map(p => p.trim());
        if (parts.length === 0) continue;
        
        const firstPart = parts[0];
        const colonIdx = firstPart.indexOf(':');
        if (colonIdx === -1) {
            tags.push({ _tag: firstPart.toLowerCase(), _value: "" });
            continue;
        }
        
        const mainKey = firstPart.substring(0, colonIdx).trim().toLowerCase();
        const mainVal = firstPart.substring(colonIdx + 1).trim();
        
        const tagObj = {
            _tag: mainKey,
            _value: mainVal
        };
        
        for (let i = 1; i < parts.length; i++) {
            const part = parts[i];
            const cIdx = part.indexOf(':');
            if (cIdx !== -1) {
                const k = part.substring(0, cIdx).trim().toLowerCase();
                const v = part.substring(cIdx + 1).trim();
                tagObj[k] = v;
            }
        }
        tags.push(tagObj);
    }
    return tags;
}

// Event Bus Listener
export async function handleStageAction(event) {
    const detail = event.detail;
    if (!detail) return;
    
    console.log(`[UVE] Event Bus action received:`, detail);
    
    const { id, type, sprite, layer, pos, dist, action, charName, text } = detail;
    
    if (action === 'clear') {
        clearAllStageSprites({ remove: true });
        return;
    }
    
    if (action === 'despawn') {
        hideStageSprite(id);
        return;
    }
    
    // Default action === 'spawn'
    await spawnStageSprite({ id, type, sprite, layer, pos, dist, charName, text });
}

// Helper to wait for stage to load
async function waitForRealityStage(maxWait = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWait) {
        const stage = document.getElementById("reality-stage");
        if (stage) return stage;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
}

// Differentiate and build layers inside reality-stage
function getOrCreateLayer(layerName) {
    const stage = document.getElementById("reality-stage");
    if (!stage) return null;
    
    let spriteLayer = document.getElementById("re-sprites-layer");
    if (!spriteLayer) {
        spriteLayer = stage.querySelector("#re-sprites-layer");
    }
    if (!spriteLayer) {
        console.log(`[UVE] Parent sprites-layer not found, creating...`);
        spriteLayer = document.createElement("div");
        spriteLayer.id = "re-sprites-layer";
        spriteLayer.setAttribute("style", `
            position: absolute !important;
            inset: 0 !important;
            pointer-events: none !important;
            overflow: visible !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            z-index: 20 !important;
        `);
        const reUi = stage.querySelector("#re-ui");
        if (reUi) stage.insertBefore(spriteLayer, reUi);
        else stage.appendChild(spriteLayer);
    }
    
    // Ensure parent is visible
    spriteLayer.style.display = "block";
    spriteLayer.style.visibility = "visible";
    spriteLayer.style.opacity = "1";
    spriteLayer.style.zIndex = "20";
    
    let subLayerId = `re-layer-${layerName}`;
    let subLayer = document.getElementById(subLayerId);
    if (!subLayer) {
        console.log(`[UVE] Creating depth layer: ${layerName}`);
        subLayer = document.createElement("div");
        subLayer.id = subLayerId;
        let zIndex = 20;
        if (layerName === "background") zIndex = 10;
        if (layerName === "foreground") zIndex = 30;
        subLayer.setAttribute("style", `
            position: absolute !important;
            inset: 0 !important;
            pointer-events: none !important;
            overflow: visible !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            z-index: ${zIndex} !important;
        `);
        spriteLayer.appendChild(subLayer);
    }
    
    // Ensure sub-layer is visible
    subLayer.style.display = "block";
    subLayer.style.visibility = "visible";
    subLayer.style.opacity = "1";
    
    return subLayer;
}

// Convert relative path to absolute
const toAbsoluteUrl = (path) => {
    if (!path) return "";
    let p = String(path).trim();
    if (!p) return "";
    if (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('data:')) {
        return p;
    }
    p = p.replace(/\\/g, '/');
    try {
        if (p.startsWith('/')) {
            return new URL(p, window.location.origin).href;
        }
        if (p.startsWith('user/') || p.startsWith('characters/') || p.startsWith('scripts/')) {
            return new URL('/' + p, window.location.origin).href;
        }
        return new URL(p, window.location.origin).href;
    } catch (e) {
        return p;
    }
};

// Mirroring / fallback sprite resolver for ST Characters
async function resolveCharacterSpriteFallback(charName, mood, text) {
    let dataUrl = null;
    const moodSlug = String(mood || "neutral").toLowerCase().replace(/[^a-z0-9]+/g, "_");
    
    // Method 1: Mirror Character Expression extension API
    try {
        const spriteApiUrl = `/api/sprites/get?name=${encodeURIComponent(charName)}`;
        const spriteResponse = await fetch(spriteApiUrl);
        if (spriteResponse.ok) {
            const sprites = await spriteResponse.json();
            if (Array.isArray(sprites) && sprites.length > 0) {
                const targetMood = String(mood || "neutral").toLowerCase().trim();
                let matchingSprite = sprites.find(s => String(s.label || "").toLowerCase().trim() === targetMood);
                if (!matchingSprite) {
                    matchingSprite = sprites.find(s => {
                        const spriteLabel = String(s.label || "").toLowerCase().trim();
                        return spriteLabel.includes(targetMood) || targetMood.includes(spriteLabel);
                    });
                }
                if (!matchingSprite && targetMood !== "neutral") {
                    matchingSprite = sprites.find(s => String(s.label || "").toLowerCase().trim() === "neutral");
                }
                if (!matchingSprite && sprites.length > 0) {
                    matchingSprite = sprites[0];
                }
                if (matchingSprite && matchingSprite.path) {
                    if (typeof window.getAbsoluteSpriteUrl === "function") {
                        dataUrl = window.getAbsoluteSpriteUrl(matchingSprite.path);
                    } else {
                        if (matchingSprite.path.startsWith('http://') || matchingSprite.path.startsWith('https://') || matchingSprite.path.startsWith('data:')) {
                            dataUrl = matchingSprite.path;
                        } else if (matchingSprite.path.startsWith('/')) {
                            dataUrl = new URL(matchingSprite.path, window.location.origin).href;
                        } else {
                            dataUrl = new URL(`/characters/${charName}/${matchingSprite.path}`, window.location.origin).href;
                        }
                    }
                }
            }
        }
    } catch (apiErr) {
        console.warn("[UVE] ST API character check failed:", apiErr);
    }
    
    // Method 2: Check custom folder
    if (!dataUrl) {
        const customFolder = getCustomSpriteFolder();
        const charSlug = String(charName).toLowerCase().replace(/[^a-z0-9]+/g, "_");
        if (customFolder) {
            const customPaths = [
                `${customFolder}/${charSlug}/${moodSlug}.png`,
                `${customFolder}/${charName}/${mood || "neutral"}.png`,
                `${customFolder}/${charSlug}/${moodSlug}.webp`,
                `${customFolder}/${charName}/${mood || "neutral"}.webp`
            ];
            dataUrl = customPaths[0]; // will be checked by load attempts
        }
    }
    
    // Method 3: Check Character Expression extension API / DOM mirroring
    if (!dataUrl && window.CharacterExpression) {
        try {
            let exprResult = null;
            if (typeof window.CharacterExpression.getExpression === "function") {
                exprResult = window.CharacterExpression.getExpression(charName, mood || "neutral");
            } else if (typeof window.CharacterExpression.getCurrentExpression === "function") {
                exprResult = window.CharacterExpression.getCurrentExpression(charName);
            }
            if (exprResult) {
                dataUrl = typeof exprResult === "string" ? exprResult : (exprResult.url || exprResult.path);
                if (dataUrl && !dataUrl.startsWith("data:") && !dataUrl.startsWith("http")) {
                    dataUrl = new URL(dataUrl, window.location.origin).href;
                }
            }
        } catch (_) {}
    }
    
    // Method 4: Direct DOM check
    if (!dataUrl) {
        try {
            const exprHolder = document.querySelector("#expression-holder img, #expression-wrapper img");
            if (exprHolder && exprHolder.src && !exprHolder.src.includes("data:image/svg") && !exprHolder.src.includes("default-expressions")) {
                const context = typeof window.getContext === "function" ? window.getContext() : null;
                if (context && (context.name2 === charName || context.name === charName)) {
                    dataUrl = exprHolder.src;
                }
            }
        } catch (_) {}
    }
    
    // Method 5: Default relative server routes
    if (!dataUrl) {
        dataUrl = `/characters/${charName}/${mood || "neutral"}.png`;
    }
    
    return dataUrl;
}

// Generate the list of load attempts to handle different image formats
function getSpriteLoadAttempts(charName, mood, dataUrl) {
    const customFolder = getCustomSpriteFolder();
    const charSlug = String(charName).toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const moodSlug = String(mood || "neutral").toLowerCase().replace(/[^a-z0-9]+/g, "_");
    
    const s = getSettings();
    const catalog = s?.ui?.assetCatalog?.sprites || [];
    const catalogSet = new Set(catalog.map(function(url) { return String(url || "").toLowerCase(); }));
    
    function isKnownAsset(url) {
        if (!url) return false;
        const lower = String(url).toLowerCase();
        if (catalogSet.has(lower)) return true;
        return catalog.some(function(catalogUrl) {
            return catalogUrl.includes(lower) || lower.includes(catalogUrl);
        });
    }
    
    let attempts = [dataUrl];
    
    // ST character variations
    let charExprFolder = `/characters/${charName}`;
    try {
        const chars = window.characters;
        if (Array.isArray(chars)) {
            const char = chars.find(function(c) { return c.name === charName || c.name.toLowerCase() === charName.toLowerCase(); });
            if (char) {
                const spriteFolderOverride = char.spriteFolderOverride || char.sprite_folder_override || "";
                if (spriteFolderOverride && spriteFolderOverride.includes('/')) {
                    charExprFolder = spriteFolderOverride;
                }
            }
        }
    } catch (_) {}
    
    const candidates = [];
    candidates.push(toAbsoluteUrl(`${charExprFolder}/${mood || "neutral"}.png`));
    candidates.push(toAbsoluteUrl(`${charExprFolder}/${mood || "neutral"}.webp`));
    candidates.push(toAbsoluteUrl(`${charExprFolder}/${moodSlug}.png`));
    candidates.push(toAbsoluteUrl(`${charExprFolder}/${moodSlug}.webp`));
    
    for (let i = 0; i < 6; i++) {
        candidates.push(toAbsoluteUrl(`${charExprFolder}/${mood || "neutral"}-${i}.png`));
        candidates.push(toAbsoluteUrl(`${charExprFolder}/${mood || "neutral"}-${i}.webp`));
    }
    
    if (customFolder) {
        candidates.push(toAbsoluteUrl(`${customFolder}/${charSlug}/${moodSlug}.png`));
        candidates.push(toAbsoluteUrl(`${customFolder}/${charName}/${mood || "neutral"}.png`));
    }
    
    // Fallback default servers
    candidates.push(toAbsoluteUrl(`/assets/sprites/${charSlug}/${moodSlug}.png`));
    candidates.push(toAbsoluteUrl(`/assets/sprites/${charName}/${mood || "neutral"}.png`));
    candidates.push(toAbsoluteUrl(`/assets/Sprites/${charName}/${mood || "neutral"}.png`));
    candidates.push(toAbsoluteUrl(`/assets/Sprites/${charName}/${moodSlug}.png`));
    candidates.push(toAbsoluteUrl(`/characters/${charSlug}/${moodSlug}.png`));
    candidates.push(toAbsoluteUrl(`/characters/${charName}/${mood || "neutral"}.png`));
    candidates.push(toAbsoluteUrl(`/characters/${charSlug}/neutral.png`));
    candidates.push(toAbsoluteUrl(`/characters/${charName}/neutral.png`));
    
    // Filter candidates against the asset catalog to avoid 404s
    for (const candidate of candidates) {
        if (isKnownAsset(candidate)) {
            attempts.push(candidate);
        }
    }
    
    return attempts;
}

// Reposition visible elements side-by-side on a given layer (especially mid-layer)
function repositionLayerSprites(layerName = "mid") {
    const layer = document.getElementById(`re-layer-${layerName}`);
    if (!layer) return;
    
    const allInLayer = Array.from(layer.querySelectorAll(".re-sprite"));
    const visible = allInLayer.filter(s => {
        const style = window.getComputedStyle(s);
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0;
    });
    
    if (visible.length > 1) {
        visible.forEach((sprite, index) => {
            const entityId = sprite.getAttribute("data-entity-id");
            const entity = activeEntities[entityId];
            
            // If the entity has an explicit horizontal placement like "left" or "right" or a percentage, skip
            if (entity && (entity.pos === "left" || entity.pos === "right" || entity.pos === "center" || (entity.pos && (entity.pos.includes("%") || entity.pos.includes("px"))))) {
                return;
            }
            
            const spacing = 100 / (visible.length + 1);
            sprite.style.left = `${spacing * (index + 1)}%`;
            sprite.style.transform = "translateX(-50%)";
        });
    } else if (visible.length === 1) {
        const sprite = visible[0];
        const entityId = sprite.getAttribute("data-entity-id");
        const entity = activeEntities[entityId];
        if (entity && (entity.pos === "left" || entity.pos === "right" || entity.pos === "center" || (entity.pos && (entity.pos.includes("%") || entity.pos.includes("px"))))) {
            return;
        }
        sprite.style.left = "50%";
        sprite.style.transform = "translateX(-50%)";
    }
}

// Position & Zoom styles
function applySpritePlacements(img, pos, dist, layerName) {
    if (!img) return;
    
    let targetPos = String(pos || "").toLowerCase().trim();
    if (targetPos === "left") {
        img.style.left = "20%";
        img.style.transform = "translateX(-50%)";
    } else if (targetPos === "right") {
        img.style.left = "80%";
        img.style.transform = "translateX(-50%)";
    } else if (targetPos === "center") {
        img.style.left = "50%";
        img.style.transform = "translateX(-50%)";
    } else if (targetPos.endsWith("%") || targetPos.endsWith("px") || targetPos.endsWith("vw")) {
        img.style.left = targetPos;
        img.style.transform = "translateX(-50%)";
    } else {
        // Let auto-reposition handle it
        repositionLayerSprites(layerName);
    }
    
    let targetDist = String(dist || "").toLowerCase().trim();
    if (targetDist === "far") {
        img.style.height = "50vh";
        img.style.filter = "brightness(0.85)";
    } else if (targetDist === "close") {
        img.style.height = "95vh";
        img.style.filter = "none";
    } else if (targetDist === "normal") {
        img.style.height = "75vh";
        img.style.filter = "none";
    } else if (targetDist && (targetDist.endsWith("vh") || targetDist.endsWith("px") || targetDist.endsWith("vw"))) {
        img.style.height = targetDist;
    } else {
        img.style.height = "75vh";
        img.style.filter = "none";
    }
}

// Main Spawning Logic
export async function spawnStageSprite({ id, type, sprite, layer, pos, dist, charName, text }) {
    if (!id) return;
    
    const stage = document.getElementById("reality-stage");
    if (!stage) {
        console.warn(`[UVE] Canvas stage not loaded yet`);
        return;
    }
    
    try {
        const stageStyle = window.getComputedStyle(stage);
        if (stageStyle.display === "none" || stageStyle.visibility === "hidden") {
            return;
        }
    } catch (_) {}
    
    const s = getSettings();
    ensureSpriteStore(s);
    const sets = getSpriteStore(s).sets || {};
    
    let resolvedSetName = type;
    let resolvedType = "character"; // default set type
    
    if (type && sets[type]) {
        resolvedSetName = type;
        resolvedType = sets[type].type || "character";
    } else if (charName) {
        const map = getSpriteStore(s).speakerMap || {};
        const mappedName = map[charName] || map[String(charName).toLowerCase().trim()];
        if (mappedName && sets[mappedName]) {
            resolvedSetName = mappedName;
            resolvedType = sets[mappedName].type || "character";
        }
    }

    if (resolvedType === "character" && charName && !characterIsAtCurrentLocation(s, charName)) {
        hideStageSprite(id);
        return;
    }
    
    // Choose layer based on parameters or library type fallback
    let targetLayerName = layer || "mid";
    if (!layer) {
        if (resolvedType === "environment") targetLayerName = "background";
        else if (resolvedType === "effects") targetLayerName = "foreground";
    }
    
    const subLayer = getOrCreateLayer(targetLayerName);
    if (!subLayer) return;
    
    // Resolve Image dataUrl
    let dataUrl = null;
    let moodKey = (sprite || "neutral").toLowerCase().trim();
    
    if (resolvedSetName && sets[resolvedSetName]) {
        const setObj = sets[resolvedSetName];
        if (setObj && setObj.expressions) {
            // Fuzzy keyword check if no explicit mood tag is parsed
            if (!sprite && text) {
                const lower = text.toLowerCase();
                const available = Object.keys(setObj.expressions);
                available.sort((a, b) => b.length - a.length);
                
                const charNames = new Set();
                try {
                    if (Array.isArray(window.characters)) {
                        window.characters.forEach(c => charNames.add(String(c.name).toLowerCase().trim()));
                    }
                } catch (_) {}
                
                for (const k of available) {
                    const cleanKey = k.replace(/_/g, " ");
                    if (charNames.has(cleanKey)) continue;
                    if (lower.includes(cleanKey)) {
                        moodKey = k;
                        break;
                    }
                }
            }
            
            const nk = normalizeKey(moodKey);
            let expr = setObj.expressions[nk];
            if (!expr && nk !== "neutral") {
                expr = setObj.expressions["neutral"];
            }
            if (expr && expr.dataUrl) {
                dataUrl = expr.dataUrl;
            }
        }
    }
    
    // Call speaker mirroring/lookups if needed
    if (!dataUrl && charName) {
        dataUrl = await resolveCharacterSpriteFallback(charName, moodKey, text);
    }
    
    if (!dataUrl) {
        console.warn(`[UVE] Sprite artwork missing for ${id} (state: ${moodKey})`);
        hideStageSprite(id);
        return;
    }
    
    const slug = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const imgId = `re-sprite-${slug(id)}`;
    if (resolvedType === "character" && charName) {
        document.querySelectorAll(`.re-sprite[data-character-key="${slug(charName || id)}"]`).forEach((node) => {
            if (node.id !== imgId) node.remove();
        });
    }
    
    // Group chat stacking logic (hide others only if NOT a group chat and spawning a speaker)
    const context = (typeof window.getContext === "function") ? window.getContext() : null;
    const isGroupChat = !!(context && context.groupId && String(context.groupId).trim() !== "");
    
    if (!isGroupChat && resolvedType === "character") {
        const midLayer = document.getElementById("re-layer-mid");
        if (midLayer) {
            const visibleSprites = Array.from(midLayer.querySelectorAll(".re-sprite"));
            visibleSprites.forEach(sImg => {
                if (sImg.id !== imgId) {
                    sImg.style.display = "none";
                    sImg.style.visibility = "hidden";
                    sImg.style.opacity = "0";
                }
            });
        }
    }
    
    let img = document.getElementById(imgId);
    if (!img) {
        console.log(`[UVE] Spawning new stage canvas element: ${id}`);
        img = document.createElement("img");
        img.id = imgId;
        img.className = "re-sprite";
        img.alt = id;
        img.style.position = "absolute";
        img.style.bottom = "22dvh";
        img.style.height = "62dvh";
        img.style.width = "auto";
        img.style.maxWidth = "96vw";
        img.style.objectFit = "contain";
        img.style.transition = "filter 0.2s ease, left 0.3s ease, bottom 0.3s ease, height 0.3s ease";
        img.style.pointerEvents = "none";
        img.style.display = "block";
        img.style.visibility = "hidden";
        img.style.opacity = "0";
        img.setAttribute("data-entity-id", id);
        img.setAttribute("data-character-key", slug(charName || id));
        img.setAttribute("data-sprite-loaded", "false");
        
        subLayer.appendChild(img);
    } else {
        // If layer was updated, move it in DOM
        if (img.parentNode !== subLayer) {
            subLayer.appendChild(img);
        }
    }
    
    // Record active entry
    activeEntities[id] = { id, type, sprite: moodKey, layer: targetLayerName, pos, dist, charName };
    
    // Set source
    if (img.src !== dataUrl && !img.src.endsWith(dataUrl)) {
        if (dataUrl && !dataUrl.startsWith("data:") && !dataUrl.startsWith("http")) {
            dataUrl = toAbsoluteUrl(dataUrl);
        }
        
        if (!dataUrl || dataUrl === window.location.origin + "/") {
            img.style.display = "none";
            return;
        }
        
        img.style.visibility = "hidden";
        img.style.opacity = "0";
        
        let attempts = [dataUrl];
        if (dataUrl && !dataUrl.startsWith("data:") && !dataUrl.startsWith("http") && charName) {
            attempts = getSpriteLoadAttempts(charName, moodKey, dataUrl);
        }
        
        let attemptIndex = 0;
        attempts = attempts.filter(url => url && url.trim() !== "" && url !== window.location.origin + "/");
        
        const tryNext = () => {
            if (attemptIndex >= attempts.length) {
                img.style.display = "none";
                img.style.visibility = "hidden";
                img.style.opacity = "0";
                return;
            }
            img.src = attempts[attemptIndex];
            attemptIndex++;
        };
        
        img.onerror = function() {
            tryNext();
        };
        
        img.onload = function() {
            this.style.display = "block";
            this.style.visibility = "visible";
            this.style.opacity = "1";
            this.setAttribute("data-sprite-loaded", "true");
            this.onerror = null;
            
            repositionLayerSprites(targetLayerName);
            void this.offsetWidth;
        };
        
        tryNext();
    } else {
        img.style.display = "block";
        img.style.visibility = "visible";
        img.style.opacity = "1";
    }
    
    // Apply position & size overrides
    applySpritePlacements(img, pos, dist, targetLayerName);
}

// Decoupled updateSpriteStage that parses tags and emits standard bus events
export async function updateSpriteStage(text, charName, isInScene = true) {
    if (!charName || charName === "System") {
        if (!charName) console.warn(`[UVE] updateSpriteStage called without charName`);
        return;
    }
    
    console.log(`[UVE] updateSpriteStage parse loop for ${charName}`);
    
    const tags = parseStageTags(text);
    let handledCustomEntity = false;
    
    for (const tag of tags) {
        const tagType = tag._tag;
        
        if (tagType === "spawn" || tagType === "entity") {
            const entityId = tag.id || tag._value || tag.entityid;
            const assetType = tag.type || tag.set || tag.assettype;
            const mood = tag.mood || tag.sprite || tag.state || tag.expression || tag._value;
            const layer = tag.layer || tag.depth;
            const pos = tag.pos || tag.position;
            const dist = tag.dist || tag.distance || tag.zoom;
            
            if (entityId) {
                window.dispatchEvent(new CustomEvent('uie-stage-action', {
                    detail: {
                        id: entityId,
                        type: assetType,
                        sprite: mood,
                        layer: layer,
                        pos: pos,
                        dist: dist,
                        action: 'spawn'
                    }
                }));
                handledCustomEntity = true;
            }
        } else if (tagType === "despawn" || tagType === "remove") {
            const entityId = tag._value || tag.id;
            if (entityId) {
                window.dispatchEvent(new CustomEvent('uie-stage-action', {
                    detail: { id: entityId, action: 'despawn' }
                }));
                handledCustomEntity = true;
            }
        } else if (tagType === "clear" || tagType === "clearall") {
            window.dispatchEvent(new CustomEvent('uie-stage-action', {
                detail: { action: 'clear' }
            }));
            handledCustomEntity = true;
        }
    }
    
    // Backward compatibility speaker spawn
    if (isInScene) {
        let mood = "";
        const moodTag = tags.find(t => t._tag === "mood" || t._tag === "sprite");
        if (moodTag) mood = moodTag._value;
        
        const posTag = tags.find(t => t._tag === "pos" || t._tag === "position");
        const pos = posTag ? posTag._value : "";
        
        const distTag = tags.find(t => t._tag === "dist" || t._tag === "distance" || t._tag === "zoom");
        const dist = distTag ? distTag._value : "";
        
        const s = getSettings();
        ensureSpriteStore(s);
        const map = getSpriteStore(s).speakerMap || {};
        let setName = map[charName] || map[String(charName).toLowerCase().trim()];
        
        if (!setName) {
            const sets = getSpriteStore(s).sets || {};
            if (sets[charName]) setName = charName;
            else {
                const lower = String(charName).toLowerCase().trim();
                const found = Object.keys(sets).find(k => k.toLowerCase().trim() === lower);
                if (found) setName = found;
            }
        }
        
        let layer = "mid";
        if (setName) {
            const setObj = getSpriteStore(s).sets[setName];
            if (setObj && setObj.type) {
                if (setObj.type === "environment") layer = "background";
                else if (setObj.type === "effects") layer = "foreground";
            }
        }
        
        window.dispatchEvent(new CustomEvent('uie-stage-action', {
            detail: {
                id: `speaker_${charName}`,
                charName: charName,
                type: setName || charName,
                sprite: mood,
                text: text,
                layer: layer,
                pos: pos,
                dist: dist,
                action: 'spawn'
            }
        }));
    }
}

export function hideSprite(charName) {
    if (!charName) return;
    hideStageSprite(`speaker_${charName}`);
    hideStageSprite(charName);
}

export function hideStageSprite(entityId) {
    if (!entityId) return;
    const slug = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const id = `re-sprite-${slug(entityId)}`;
    const img = document.getElementById(id);
    if (img) {
        img.style.display = "none";
        img.style.visibility = "hidden";
        img.style.opacity = "0";
    }
    if (activeEntities[entityId]) {
        delete activeEntities[entityId];
    }
    repositionLayerSprites("mid");
}

export function clearAllSprites({ remove = false } = {}) {
    clearAllStageSprites({ remove });
}

export function clearAllStageSprites({ remove = false } = {}) {
    const layers = ["background", "mid", "foreground"];
    layers.forEach(lName => {
        const layer = document.getElementById(`re-layer-${lName}`);
        if (!layer) return;
        const sprites = Array.from(layer.querySelectorAll(".re-sprite"));
        sprites.forEach(el => {
            el.style.display = "none";
            el.style.visibility = "hidden";
            el.style.opacity = "0";
            if (remove) el.remove();
        });
    });
    activeEntities = {};
}

export function pruneSpritesForCurrentLocation() {
    const s = getSettings();
    for (const [id, entity] of Object.entries(activeEntities)) {
        if (entity?.charName && !characterIsAtCurrentLocation(s, entity.charName)) hideStageSprite(id);
    }
}

export function initSprites() {
    if (bound) return;
    bound = true;
    
    // Bind central Stage Event Bus
    window.removeEventListener('uie-stage-action', handleStageAction);
    window.addEventListener('uie-stage-action', handleStageAction);
    window.removeEventListener('uie:schedules_updated', pruneSpritesForCurrentLocation);
    window.addEventListener('uie:schedules_updated', pruneSpritesForCurrentLocation);
    window.removeEventListener('uie:state_updated', pruneSpritesForCurrentLocation);
    window.addEventListener('uie:state_updated', pruneSpritesForCurrentLocation);

    // Event hooks dispatching onto standard Event Bus
    try {
        if (typeof window.eventSource !== "undefined" && window.eventSource) {
            window.eventSource.on(window.event_types?.CHARACTER_MESSAGE_RENDERED || "character_message_rendered", (messageId, type) => {
                if (type === 'impersonate') return;
                if (typeof window.chat !== "undefined" && Array.isArray(window.chat)) {
                    const message = window.chat.find(m => m.mesId === messageId);
                    if (message && !message.is_user && message.name) {
                        updateSpriteStage(message.mes || message.text || "", message.name, true).catch(err => {
                            console.error(`[UVE] Auto-sprite update failed for ${message.name}:`, err);
                        });
                    }
                }
            });

            window.eventSource.on(window.event_types?.MESSAGE_RECEIVED || "message_received", (messageId, type) => {
                if (type === 'impersonate') return;
                if (typeof window.chat !== "undefined" && Array.isArray(window.chat)) {
                    const message = window.chat.find(m => m.mesId === messageId);
                    if (message && !message.is_user && message.name) {
                        updateSpriteStage(message.mes || message.text || "", message.name, true).catch(err => {
                            console.error(`[UVE] Auto-sprite update failed for ${message.name}:`, err);
                        });
                    }
                }
            });

            // Mirror Character Expressions DOM observer
            const setupExpressionMirror = () => {
                const expressionHolder = document.querySelector("#expression-holder, #expression-wrapper");
                if (expressionHolder) {
                    const exprObserver = new MutationObserver((mutations) => {
                        clearTimeout(window.uieExpressionMirrorTimeout);
                        window.uieExpressionMirrorTimeout = setTimeout(() => {
                            for (const mutation of mutations) {
                                if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
                                    const img = mutation.target;
                                    if (img && img.src && !img.src.includes("data:image/svg") && !img.src.includes("default-expressions")) {
                                        const context = typeof window.getContext === "function" ? window.getContext() : null;
                                        if (context) {
                                            const charName = context.name2 || context.name;
                                            if (charName) {
                                                if (typeof window.chat !== "undefined" && Array.isArray(window.chat) && window.chat.length > 0) {
                                                    const lastMsg = window.chat[window.chat.length - 1];
                                                    if (lastMsg && !lastMsg.is_user && lastMsg.name === charName) {
                                                        updateSpriteStage(lastMsg.mes || lastMsg.text || "", charName, true).catch(err => {
                                                            console.error(`[UVE] Failed to mirror:`, err);
                                                        });
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }, 300);
                    });

                    exprObserver.observe(expressionHolder, {
                        attributes: true,
                        attributeFilter: ['src'],
                        subtree: true,
                        childList: true
                    });
                    return exprObserver;
                }
                return null;
            };

            let exprObserver = setupExpressionMirror();
            if (!exprObserver) {
                const checkInterval = setInterval(() => {
                    exprObserver = setupExpressionMirror();
                    if (exprObserver) clearInterval(checkInterval);
                }, 500);
                setTimeout(() => clearInterval(checkInterval), 10000);
            }
        }
    } catch (e) {
        console.error("[UVE] Failed to set up auto observers:", e);
    }

    $(document).off(".uieSprites");
    const $w = $("#uie-sprites-window");
    if ($w.length) bindWindow($w[0]);

    console.log("[UVE] Component-Based Event Visibility Engine Initialized");
    // Watchdog deprecated: Visibility managed wholly by event updates.
}

function bindWindow(win) {
    if (!win) return;
    const $w = $(win);

    if (win.dataset.uieBound === "1") return;
    win.dataset.uieBound = "1";

    // Prevent propagation
    $w.on("pointerdown.uieSpritesRoot click.uieSpritesRoot", function (e) {
        if (e.target === win) e.stopPropagation();
    });

    // Close button
    $w.on("click.uieSprites", "#uie-sprites-close", (e) => {
        e.preventDefault(); e.stopPropagation();
        if (win.dataset.embedded === "1") {
            try { restoreSpritePanelHost(); } catch (_) { $w.hide(); }
        } else {
            $w.hide();
        }
    });

    // Category click dashboard
    $w.on("click.uieSprites", ".uve-cat-tile", function (e) {
        e.stopPropagation();
        $(".uve-cat-tile").removeClass("active");
        $(this).addClass("active");
        category = $(this).attr("data-type") || "character";
        
        // Reset preview state
        clearPreviewCard();
        
        renderSetSelect();
        renderList();
    });

    // Library Select dropdown change
    $w.on("change.uieSprites", "#uie-sprites-set", function (e) {
        e.stopPropagation();
        activeSet = String($(this).val() || "");
        clearPreviewCard();
        renderList();
    });

    // Dialogue tags key identity mapping blur
    $w.on("blur.uieSprites", "#uie-sprites-link-name", function (e) {
        e.stopPropagation();
        if (!activeSet) return;
        const s = getSettings();
        applySpeakerLinksFromInput(s, activeSet, String($(this).val() || ""));
        renderList();
    });

    // Row selection and previews
    let selectedRowKey = "";
    $w.on("click.uieSprites", ".uie-spr-row", function (e) {
        // Prevent click if clicking direct buttons on row
        if ($(e.target).closest(".uve-icon-btn, input").length) return;
        
        $(".uie-spr-row").css("border-color", "rgba(255,255,255,0.06)");
        $(this).css("border-color", "var(--uve-primary)");
        
        const key = $(this).attr("data-key");
        selectedRowKey = key;
        
        // Retrieve expression url
        const setObj = getActiveSetObj();
        const expr = setObj?.expressions?.[key];
        const previewDisplay = document.getElementById("uve-preview-display");
        const placeholder = document.getElementById("uve-preview-placeholder");
        const testBtn = document.getElementById("uve-test-stage-btn");
        const injectBtn = document.getElementById("uve-builder-inject");
        const copyBtn = document.getElementById("uve-builder-copy");
        
        if (expr && expr.dataUrl) {
            previewDisplay.src = expr.dataUrl;
            previewDisplay.style.display = "block";
            placeholder.style.display = "none";
            testBtn.removeAttribute("disabled");
            injectBtn.removeAttribute("disabled");
            copyBtn.removeAttribute("disabled");
        } else {
            previewDisplay.style.display = "none";
            placeholder.style.display = "flex";
            testBtn.setAttribute("disabled", "true");
            injectBtn.setAttribute("disabled", "true");
            copyBtn.setAttribute("disabled", "true");
        }
        
        updateActionTagPreview(key);
    });

    function clearPreviewCard() {
        selectedRowKey = "";
        const previewDisplay = document.getElementById("uve-preview-display");
        const placeholder = document.getElementById("uve-preview-placeholder");
        const testBtn = document.getElementById("uve-test-stage-btn");
        const injectBtn = document.getElementById("uve-builder-inject");
        const copyBtn = document.getElementById("uve-builder-copy");
        
        if (previewDisplay) previewDisplay.style.display = "none";
        if (placeholder) placeholder.style.display = "flex";
        if (testBtn) testBtn.setAttribute("disabled", "true");
        if (injectBtn) injectBtn.setAttribute("disabled", "true");
        if (copyBtn) copyBtn.setAttribute("disabled", "true");
        
        const tagPreview = document.getElementById("uve-tag-preview");
        if (tagPreview) tagPreview.textContent = "[Select a state row]";
    }

    // Action Builder update on dropdown change
    $w.on("change.uieSprites", "#uve-build-pos, #uve-build-dist, #uve-build-layer, #uve-build-action", function (e) {
        if (selectedRowKey) updateActionTagPreview(selectedRowKey);
    });

    function updateActionTagPreview(key) {
        const pos = $("#uve-build-pos").val();
        const dist = $("#uve-build-dist").val();
        const layer = $("#uve-build-layer").val();
        const action = $("#uve-build-action").val();
        const identity = $("#uie-sprites-link-name").val()?.split(",")?.[0]?.trim() || activeSet || "object";
        
        let tag = "";
        if (action === "despawn") {
            tag = `[Despawn: ${identity}]`;
        } else {
            // Spawn action
            tag = `[Spawn: ${category}, id: ${identity}, mood: ${key}`;
            if (pos !== "center") tag += `, pos: ${pos}`;
            if (dist !== "normal") tag += `, dist: ${dist}`;
            if (layer !== "mid") tag += `, layer: ${layer}`;
            tag += `]`;
        }
        
        const tagPreview = document.getElementById("uve-tag-preview");
        if (tagPreview) tagPreview.textContent = tag;
    }

    // Copy Tag button
    $w.on("click.uieSprites", "#uve-builder-copy", function (e) {
        e.preventDefault(); e.stopPropagation();
        const tag = $("#uve-tag-preview").text();
        if (tag && !tag.startsWith("[")) return;
        navigator.clipboard.writeText(tag).then(() => {
            try { notify("success", "Tag copied to clipboard: " + tag, "Visual Engine"); } catch(_) {}
        });
    });

    // Inject Tag into Chat input
    $w.on("click.uieSprites", "#uve-builder-inject", function (e) {
        e.preventDefault(); e.stopPropagation();
        const tag = $("#uve-tag-preview").text();
        if (tag && !tag.startsWith("[")) return;
        
        const chatInput = document.getElementById("user-input");
        if (chatInput) {
            const currentVal = chatInput.value || "";
            chatInput.value = currentVal ? `${currentVal} ${tag}` : tag;
            chatInput.dispatchEvent(new Event('input', { bubbles: true }));
            chatInput.focus();
            try { notify("success", "Tag injected into chat bar!", "Visual Engine"); } catch(_) {}
        }
    });

    // Test on Stage trigger (emits Stage Event Bus event directly!)
    $w.on("click.uieSprites", "#uve-test-stage-btn", function (e) {
        e.preventDefault(); e.stopPropagation();
        if (!selectedRowKey || !activeSet) return;
        
        const pos = $("#uve-build-pos").val();
        const dist = $("#uve-build-dist").val();
        const layer = $("#uve-build-layer").val();
        const action = $("#uve-build-action").val();
        const identity = $("#uie-sprites-link-name").val()?.split(",")?.[0]?.trim() || activeSet;
        
        window.dispatchEvent(new CustomEvent('uie-stage-action', {
            detail: {
                id: identity,
                type: activeSet,
                sprite: selectedRowKey,
                layer: layer,
                pos: pos,
                dist: dist,
                action: action
            }
        }));
    });

    // Delete current library
    $w.on("click.uieSprites", "#uve-delete-library", function (e) {
        e.preventDefault(); e.stopPropagation();
        if (!activeSet) return;
        
        if (!confirm(`Are you sure you want to delete the library "${activeSet}"?`)) return;
        
        const s = getSettings();
        ensureSpriteStore(s);
        const sp = getSpriteStore(s);
        
        // Remove mappings mapping to this set
        for (const k of Object.keys(sp.speakerMap)) {
            if (sp.speakerMap[k] === activeSet) delete sp.speakerMap[k];
        }
        
        delete sp.sets[activeSet];
        saveSettings();
        
        activeSet = "";
        clearPreviewCard();
        renderSetSelect();
        renderList();
        
        try { notify("success", "Library deleted.", "Visual Engine"); } catch(_) {}
    });

    // Row Picking / Choosing images
    $w.on("click.uieSprites", ".uie-spr-pick", function (e) {
        e.preventDefault(); e.stopPropagation();
        const row = $(this).closest(".uie-spr-row");
        const inp = row.find(".uie-spr-file");
        inp.val("");
        inp.trigger("click");
    });

    $w.on("change.uieSprites", ".uie-spr-file", async function (e) {
        e.stopPropagation();
        const row = $(this).closest(".uie-spr-row");
        const key = String(row.attr("data-key") || "");
        const f = e.target && e.target.files ? e.target.files[0] : null;
        const dataUrl = await readFileAsDataUrl(f);
        if (!activeSet || !key) return;
        if (!dataUrl) return;
        saveSetExpression(activeSet, key, dataUrl, String(f?.name || ""));
        renderList();
        
        // Update preview if the edited row was active
        if (selectedRowKey === key) {
            document.getElementById("uve-preview-display").src = dataUrl;
        }
    });

    // Clear row expression
    $w.on("click.uieSprites", ".uie-spr-clear", function (e) {
        e.preventDefault(); e.stopPropagation();
        const row = $(this).closest(".uie-spr-row");
        const key = String(row.attr("data-key") || "");
        if (!activeSet || !key) return;
        saveSetExpression(activeSet, key, "", "");
        renderList();
        if (selectedRowKey === key) {
            clearPreviewCard();
        }
    });

    // Optional folder save
    $w.on("click.uieSprites", "#uie-sprites-save-folder", function (e) {
        e.preventDefault(); e.stopPropagation();
        const folderInput = document.getElementById("uie-sprites-custom-folder");
        if (!folderInput) return;
        const path = String(folderInput.value || "").trim();
        const s = getSettings();
        ensureSpriteStore(s);
        getSpriteStore(s).customSpriteFolder = path;
        saveSettings();
        try {
            notify("success", path ? `Sprite folder path saved: ${path}` : "Using default paths on server.", "Visual Engine");
        } catch (_) {}
    });

    // Backdrop click close window
    $w.on("click.uieSpritesBackdrop", function (e) {
        if (e.target === win) {
            e.preventDefault(); e.stopPropagation();
            if (win.dataset.embedded === "1") {
                try { restoreSpritePanelHost(); } catch (_) { $w.hide(); }
            } else {
                $w.hide();
            }
        }
    });

    // --- SETUP WIZARD EVENT BINDINGS ---
    let wizardBuffer = {
        name: "",
        type: "character",
        files: [] // { name: "", dataUrl: "" }
    };

    // Open Wizard
    $w.on("click.uieSprites", "#uve-open-wizard", function(e) {
        e.preventDefault(); e.stopPropagation();
        wizardBuffer = { name: "", type: category || "character", files: [] };
        
        // Setup initial UI states
        $("#uve-wiz-name").val("");
        $("#uve-wiz-type").val(category || "character");
        $("#uve-wiz-import-summary").text("No files loaded yet.");
        $("#uve-wiz-btn-to-3").attr("disabled", "true");
        
        $(".uve-wizard-step-node").removeClass("active completed");
        $('.uve-wizard-step-node[data-step="1"]').addClass("active");
        
        $(".uve-wizard-slide").removeClass("active");
        $('.uve-wizard-slide[data-step="1"]').addClass("active");
        
        $("#uve-wizard").css("display", "flex");
    });

    // Cancel Wizard
    $w.on("click.uieSprites", ".uve-wiz-cancel", function(e) {
        e.preventDefault(); e.stopPropagation();
        $("#uve-wizard").hide();
    });

    // Wizard Slide 1 -> 2 (Next Step)
    $w.on("click.uieSprites", '.uve-wiz-next[data-step="1"]', function(e) {
        e.preventDefault(); e.stopPropagation();
        const name = String($("#uve-wiz-name").val() || "").trim();
        if (!name) {
            alert("Please name your asset library.");
            return;
        }
        
        wizardBuffer.name = name;
        wizardBuffer.type = $("#uve-wiz-type").val() || "character";
        
        // Advance indicator nodes
        $('.uve-wizard-step-node[data-step="1"]').removeClass("active").addClass("completed");
        $('.uve-wizard-step-node[data-step="2"]').addClass("active");
        
        // Open Slide 2
        $(".uve-wizard-slide").removeClass("active");
        $('.uve-wizard-slide[data-step="2"]').addClass("active");
    });

    // Wizard Prev steps
    $w.on("click.uieSprites", ".uve-wiz-prev", function(e) {
        e.preventDefault(); e.stopPropagation();
        const currentStep = Number($(this).attr("data-step"));
        const prevStep = currentStep - 1;
        
        $('.uve-wizard-step-node').removeClass("active");
        $(`.uve-wizard-step-node[data-step="${prevStep}"]`).removeClass("completed").addClass("active");
        $(`.uve-wizard-step-node[data-step="${currentStep}"]`).removeClass("completed");
        
        $(".uve-wizard-slide").removeClass("active");
        $(`.uve-wizard-slide[data-step="${prevStep}"]`).addClass("active");
    });

    // Browse files inside Wizard Slide 2
    $w.on("click.uieSprites", "#uve-wiz-browse-btn", function(e) {
        e.preventDefault(); e.stopPropagation();
        $("#uve-wiz-file-picker").trigger("click");
    });

    // Clicking the drop zone card opens the file picker (vital for mobile touch onboarding!)
    $w.on("click.uieSprites", "#uve-drop-zone", function(e) {
        if (e.target.id === "uve-wiz-browse-btn" || $(e.target).closest("#uve-wiz-browse-btn").length) return;
        e.preventDefault(); e.stopPropagation();
        $("#uve-wiz-file-picker").trigger("click");
    });

    $w.on("change.uieSprites", "#uve-wiz-file-picker", async function(e) {
        const files = e.target.files;
        if (!files || !files.length) return;
        await processWizFiles(files);
    });

    // Drag-and-Drop Dropzone
    const dropZone = document.getElementById("uve-drop-zone");
    if (dropZone) {
        $w.on("dragover.uieSprites dragenter.uieSprites", "#uve-drop-zone", function(e) {
            e.preventDefault(); e.stopPropagation();
            $(this).addClass("dragover");
        });
        
        $w.on("dragleave.uieSprites dragend.uieSprites drop.uieSprites", "#uve-drop-zone", function(e) {
            e.preventDefault(); e.stopPropagation();
            $(this).removeClass("dragover");
        });
        
        $w.on("drop.uieSprites", "#uve-drop-zone", async function(e) {
            e.preventDefault(); e.stopPropagation();
            const items = e.originalEvent?.dataTransfer?.items;
            const files = e.originalEvent?.dataTransfer?.files;
            
            if (items && items.length) {
                // Support directory reader or plain files
                let fileList = [];
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    if (typeof item.webkitGetAsEntry === "function") {
                        const entry = item.webkitGetAsEntry();
                        if (entry) {
                            await readEntryRecursively(entry, fileList);
                        }
                    }
                }
                if (fileList.length) {
                    await processWizFiles(fileList);
                    return;
                }
            }
            
            if (files && files.length) {
                await processWizFiles(files);
            }
        });
    }

    async function readEntryRecursively(entry, fileList) {
        if (entry.isFile) {
            const file = await new Promise(resolve => entry.file(resolve));
            if (file && file.type.startsWith("image/")) {
                fileList.push(file);
            }
        } else if (entry.isDirectory) {
            const dirReader = entry.createReader();
            const entries = await new Promise(resolve => dirReader.readEntries(resolve));
            for (const ent of entries) {
                await readEntryRecursively(ent, fileList);
            }
        }
    }

    async function processWizFiles(files) {
        wizardBuffer.files = [];
        $("#uve-wiz-import-summary").text(`Reading ${files.length} file(s)...`);
        
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (!f.type?.startsWith("image/")) continue;
            
            const dataUrl = await readFileAsDataUrl(f);
            if (dataUrl) {
                // Extract filename without extension for key mapping
                let baseName = f.name;
                const dotIdx = baseName.lastIndexOf('.');
                if (dotIdx !== -1) baseName = baseName.substring(0, dotIdx);
                
                wizardBuffer.files.push({
                    key: normalizeKey(baseName),
                    fileName: f.name,
                    dataUrl: dataUrl
                });
            }
        }
        
        if (wizardBuffer.files.length) {
            $("#uve-wiz-import-summary").text(`Successfully loaded ${wizardBuffer.files.length} expressions!`);
            $("#uve-wiz-btn-to-3").removeAttr("disabled");
        } else {
            $("#uve-wiz-import-summary").text("No valid image files loaded.");
            $("#uve-wiz-btn-to-3").attr("disabled", "true");
        }
    }

    // Wizard Step 2 -> 3 (Render Mapping choices)
    $w.on("click.uieSprites", '.uve-wiz-next[data-step="2"]', function(e) {
        e.preventDefault(); e.stopPropagation();
        
        // Populate step 3 mapping container with choices
        const container = document.getElementById("uve-wiz-mapping-container");
        if (!container) return;
        
        container.innerHTML = "";
        
        // standard keys based on wizard asset category
        let standardStates = [];
        if (wizardBuffer.type === "character" || wizardBuffer.type === "entity") {
            standardStates = ["idle", "active", "angry", "happy", "sad", "surprised", "dead", "attack"];
        } else if (wizardBuffer.type === "environment") {
            standardStates = ["quiet", "stormy", "burning", "active", "night", "day"];
        } else { // effects
            standardStates = ["cast", "impact", "looping", "active"];
        }
        
        // Render dropdown rows
        standardStates.forEach(state => {
            const row = document.createElement("div");
            row.className = "uve-mapping-row";
            
            const label = document.createElement("div");
            label.style.fontWeight = "bold";
            label.style.fontSize = "12px";
            label.textContent = state.toUpperCase();
            
            const sel = document.createElement("select");
            sel.className = "uve-select";
            sel.style.width = "180px";
            sel.style.padding = "6px 10px";
            sel.setAttribute("data-state", state);
            
            // Add choose option
            const optNone = document.createElement("option");
            optNone.value = "";
            optNone.textContent = "(None)";
            sel.appendChild(optNone);
            
            // Add choices from wizard files
            wizardBuffer.files.forEach(fObj => {
                const opt = document.createElement("option");
                opt.value = fObj.key;
                opt.textContent = fObj.fileName;
                
                // Fuzzy match for auto-mapping! E.g. filename contains 'idle' -> matches 'idle' state!
                if (fObj.key === state || fObj.key.includes(state) || state.includes(fObj.key)) {
                    opt.selected = true;
                }
                
                sel.appendChild(opt);
            });
            
            row.appendChild(label);
            row.appendChild(sel);
            container.appendChild(row);
        });
        
        // Indicator nodes
        $('.uve-wizard-step-node[data-step="2"]').removeClass("active").addClass("completed");
        $('.uve-wizard-step-node[data-step="3"]').addClass("active");
        
        // Open Slide 3
        $(".uve-wizard-slide").removeClass("active");
        $('.uve-wizard-slide[data-step="3"]').addClass("active");
    });

    // Wizard Slide 3 Complete Setup
    $w.on("click.uieSprites", "#uve-wiz-complete", function(e) {
        e.preventDefault(); e.stopPropagation();
        
        const s = getSettings();
        ensureSpriteStore(s);
        const sp = getSpriteStore(s);
        
        // Save the library set
        const setName = wizardBuffer.name;
        sp.sets[setName] = {
            type: wizardBuffer.type,
            expressions: {}
        };
        
        // Process mappings
        const dropdowns = $(".uve-mapping-row select");
        const mappedKeys = new Set();
        
        dropdowns.each(function() {
            const state = $(this).attr("data-state");
            const mappedFileKey = $(this).val();
            
            if (mappedFileKey) {
                const fileObj = wizardBuffer.files.find(f => f.key === mappedFileKey);
                if (fileObj) {
                    sp.sets[setName].expressions[state] = {
                        dataUrl: fileObj.dataUrl,
                        fileName: fileObj.fileName
                    };
                    mappedKeys.add(mappedFileKey);
                }
            }
        });
        
        // Keep all other uploaded files that weren't mapped under their direct keys!
        wizardBuffer.files.forEach(fileObj => {
            if (!mappedKeys.has(fileObj.key)) {
                sp.sets[setName].expressions[fileObj.key] = {
                    dataUrl: fileObj.dataUrl,
                    fileName: fileObj.fileName
                };
            }
        });
        
        saveSettings();
        
        // Set category to wizard's type and open the new library
        category = wizardBuffer.type;
        activeSet = setName;
        
        // Update tab styling
        $(".uve-cat-tile").removeClass("active");
        $(`.uve-cat-tile[data-type="${category}"]`).addClass("active");
        
        // Hide Wizard
        $("#uve-wizard").hide();
        
        // Refresh library selections
        clearPreviewCard();
        renderSetSelect();
        renderList();
        
        try { notify("success", `Asset Library "${setName}" created!`, "Visual Engine"); } catch(_) {}
    });
}

/**
 * Move the sprite panel back to document.body for full-screen overlay use.
 */
export function restoreSpritePanelHost() {
    const win = document.getElementById("uie-sprites-window");
    if (!win) return;
    if (win.dataset.embedded !== "1") return;
    win.dataset.embedded = "0";
    win.classList.remove("uie-sprites-embedded");
    try {
        if (spritePanelRestoreParent && spritePanelRestoreParent.appendChild) {
            if (spritePanelRestoreNextSibling && spritePanelRestoreNextSibling.parentNode === spritePanelRestoreParent) {
                spritePanelRestoreParent.insertBefore(win, spritePanelRestoreNextSibling);
            } else {
                spritePanelRestoreParent.appendChild(win);
            }
        } else {
            document.body.appendChild(win);
        }
    } catch (_) {
        try { document.body.appendChild(win); } catch (__) {}
    }
    spritePanelRestoreParent = null;
    spritePanelRestoreNextSibling = null;
    win.style.cssText = "display:none;";
}

/**
 * @param {{ embedParent?: string | HTMLElement } | undefined} opts - If embedParent is set, panel is moved into that node (Scene characters).
 */
export function openSprites(opts) {
    const win = document.getElementById("uie-sprites-window");
    if (!win) return;

    const embedSel = opts && opts.embedParent;
    if (embedSel) {
        const parent = typeof embedSel === "string" ? document.querySelector(embedSel) : embedSel;
        if (parent && parent.appendChild) {
            if (win.dataset.embedded !== "1") {
                spritePanelRestoreParent = win.parentNode;
                spritePanelRestoreNextSibling = win.nextSibling;
            }
            win.dataset.embedded = "1";
            win.classList.add("uie-sprites-embedded");
            parent.appendChild(win);
            win.style.cssText =
                "display:flex;flex:1 1 auto;min-height:0;position:relative;inset:auto;z-index:1;background:transparent;padding:0;width:100%;align-items:stretch;justify-content:flex-start;";
            bindWindow(win);
        } else {
            if (win.dataset.embedded === "1") restoreSpritePanelHost();
            win.classList.remove("uie-sprites-embedded");
            win.style.cssText =
                "display:flex;position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,0.78);align-items:center;justify-content:center;padding:12px;box-sizing:border-box;";
            bindWindow(win);
        }
    } else {
        if (win.dataset.embedded === "1") restoreSpritePanelHost();
        win.classList.remove("uie-sprites-embedded");
        win.style.cssText =
            "display:flex;position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,0.78);align-items:center;justify-content:center;padding:12px;box-sizing:border-box;";
        bindWindow(win);
    }

    // Dynamic indicator positioning
    $(".uve-cat-tile").removeClass("active");
    $(`.uve-cat-tile[data-type="${category || 'character'}"]`).addClass("active");

    renderSetSelect();
    renderList();

    const folderInput = document.getElementById("uie-sprites-custom-folder");
    if (folderInput) {
        const s = getSettings();
        ensureSpriteStore(s);
        folderInput.value = getSpriteStore(s).customSpriteFolder || "";
    }
}
