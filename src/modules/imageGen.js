import { getSettings, saveSettings, resolveApiKey } from "./core.js";
import { notify } from "./notifications.js";
import { generateContent } from "./apiClient.js";
import { environmentTemplate } from "./mapTemplate.js";

let uieImgCsrfCache = { t: 0, token: "" };
let comfyWorkflowCache = { raw: "", parsed: null, ids: null, err: "", at: 0 };
let missingApiKeyWarned = false;
// Multiple UI events can request the same asset in the same frame. Share that
// work instead of sending duplicate generation requests.
const imageRequestsInFlight = new Map();
const IMAGE_PROMPT_MAX_CHARS = 3000;

const BACKGROUND_PROMPT_TEMPLATE = [
    "{{style}}",
    "{{layout}}",
    "{{contents}}",
    "{{placement_grid}}",
].join("\n");

const BACKGROUND_STRICT_TEMPLATE = [
    "Wide 16:9 visual novel environment background.",
    "Generate one full-bleed, unoccupied establishing shot from natural eye level.",
    "Use one coherent perspective with foreground, middle distance, and background.",
    "Treat every object below as a placement instruction, not a loose mood board.",
    "Do not add people, faces, character silhouettes, UI, text, logos, signs, captions, panels, maps, or split screens.",
    "Keep the lower dialogue band and central character overlay space readable for later visual-novel layers.",
].join("\n");

const BACKGROUND_NEGATIVE_PROMPT = [
    "people", "person", "character", "woman", "man", "silhouette", "portrait", "face", "hands",
    "text", "letters", "numbers", "caption", "title", "logo", "watermark", "writing",
    "interface", "UI", "website", "infographic", "menu", "button", "dialog box", "speech bubble",
    "map", "minimap", "isometric", "top-down", "bird's-eye view", "split screen", "panel", "frame",
    "placeholder", "error screen", "black border",
].join(", ");

function naturalRegion(box = {}) {
    const x = clamp01(box.x, 0.5);
    const y = clamp01(box.y, 0.55);
    const horizontal = x < 0.34 ? "left" : x > 0.66 ? "right" : "center";
    const depth = y > 0.7 ? "foreground" : y < 0.38 ? "background" : "middle distance";
    return `${horizontal} ${depth}`;
}

function pct(value) {
    return `${Math.round(clamp01(value) * 100)}%`;
}

function sceneBand(box = {}) {
    const x = clamp01(box.x, 0.5);
    const y = clamp01(box.y, 0.55);
    const horizontal = x < 0.34 ? "LEFT THIRD" : x > 0.66 ? "RIGHT THIRD" : "CENTER THIRD";
    const depth = y > 0.72 ? "FOREGROUND" : y < 0.38 ? "BACKGROUND" : "MIDDLE DISTANCE";
    return `${horizontal} / ${depth}`;
}

function environmentPlacementRules(environment = "interior") {
    const env = String(environment || "interior").toLowerCase();
    if (env === "urban") {
        return [
            "Location class: exterior urban place, street, plaza, alley, dock, market, or building-front environment.",
            "Place building faces and skyline in the upper/background band; put walkable pavement, curb, market edges, or route surface in the lower half.",
            "Keep traversable routes visibly open at one or both side edges; do not turn the scene into an indoor room unless the map says interior.",
        ].join("\n");
    }
    if (env === "wild" || env === "field") {
        return [
            "Location class: open outdoor natural terrain, not a room.",
            "Place horizon, tree line, ridges, weather, or distant landmarks in the upper/background band; place paths, grass, stones, water edges, or usable ground in the lower half.",
            "Make at least one clear route or trail readable from foreground into distance; do not add walls, doors, bedrooms, halls, or indoor furniture.",
        ].join("\n");
    }
    if (env === "aquatic") {
        return [
            "Location class: open aquatic or shoreline environment, not a room.",
            "Place water surface, shore, dock edge, reef, current, or channel routes as the major spatial structure.",
            "Make safe landing, route direction, and navigable water readable; do not add hallways, stairs, or indoor architecture unless explicitly supplied.",
        ].join("\n");
    }
    if (env === "subterranean") {
        return [
            "Location class: bounded cave, tunnel, mine, ruin, or underground passage.",
            "Place ceiling and back wall in the upper/background band; place floor path, ledges, supplies, or usable ground in the lower half.",
            "Make side tunnels, exits, shelves, camps, or interactable alcoves distinct and separated.",
        ].join("\n");
    }
    if (env === "vehicle") {
        return [
            "Location class: bounded vehicle, ship, train, aircraft, or spacecraft interior.",
            "Place walls, bulkheads, windows, instruments, or panels in the upper/background band; place floor, seats, cargo, consoles, or path lanes in the lower half.",
            "Make compartments, hatches, control surfaces, and service routes visually distinct without adding readable labels.",
        ].join("\n");
    }
    return [
        "Location class: bounded architectural interior or room.",
        "Place back wall, windows, shelves, doors, ceiling line, and tall furniture in the upper/background band; place floor, rug, seating, bed, table, desk, storage, or paths in the lower half.",
        "Make doors, exits, furniture groups, and interactive surfaces separated and readable; do not turn it into an outdoor street unless the map says exterior.",
    ].join("\n");
}

function compactSceneText(value, maxLength = 700) {
    return String(value || "")
        .replace(/\[[^\]]{0,120}\]/g, " ")
        .replace(/\b(?:no text|no ui|visual novel background|wide establishing shot)\b[,. ]*/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
}

function imageGenreDirective(settings, node = {}, scene = {}, chat = "") {
    const text = [
        settings?.world?.gameMode,
        settings?.character?.mode,
        settings?.worldState?.generationScope?.description,
        settings?.worldState?.locationDesc,
        node?.theme, node?.district, node?.type, node?.description,
        scene?.description,
        chat
    ].filter(Boolean).join(" ").toLowerCase();
    if (/\b(high fantasy|fantasy|medieval|castle|kingdom|magic|wizard|dragon|elf|dwarf)\b/.test(text)) {
        return "AUTHORITATIVE GENRE: HIGH FANTASY. Use a pre-industrial magical world, fantasy architecture, materials, clothing, transport, and technology. Exclude modern streets, cars, phones, offices, and contemporary objects unless explicitly established.";
    }
    if (/\b(futuristic|science fiction|sci-fi|cyberpunk|starship|spacecraft|orbital|android|neon megacity)\b/.test(text)) {
        return "AUTHORITATIVE GENRE: FUTURISTIC / SCIENCE FICTION. Use setting-supported advanced technology, architecture, clothing, transport, and materials. Exclude medieval-fantasy imagery unless explicitly established.";
    }
    return "AUTHORITATIVE GENRE: MODERN / CONTEMPORARY unless the supplied setting explicitly establishes another era. Use believable present-day architecture, clothing, infrastructure, transport, and objects. Exclude medieval-fantasy and futuristic elements unless explicitly established.";
}

export function buildBackgroundNegativePrompt(base = "") {
    const common = String(base || "").trim();
    return common ? `${common}, ${BACKGROUND_NEGATIVE_PROMPT}` : BACKGROUND_NEGATIVE_PROMPT;
}

function readRecentChatContext(limit = 2400) {
    try {
        for (const selector of ["#re-chat-log", "#chat", "#chat-log", ".chat-log"]) {
            const el = document.querySelector(selector);
            const text = String(el?.innerText || el?.textContent || "").trim();
            if (text) return text.slice(-limit);
        }
    } catch (_) {}
    return "";
}

function expandPromptTemplate(template, context = {}) {
    return String(template || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key) => String(context[key] || ""));
}

function sanitizeImagePromptText(value) {
    return String(value || "")
        .replace(/\[UIE_CONTEXT_READY\]/gi, "")
        .replace(/^\s*\[(?:AUTHORITATIVE CONTEXT|IMAGE CONSTRAINTS)\]\s*/gim, "")
        .replace(/^\s*(?:STRICT\s+)?(?:ENVIRONMENT\s+PLATE|CONTENT\s+LIST|SPATIAL\s+LAYOUT|AUTHORITATIVE\s+CONTEXT|IMAGE\s+CONSTRAINTS)\s*:\s*/gim, "")
        .replace(/\b(?:strict environment plate|strict content list|strict spatial layout|authoritative context|image constraints)\s*:\s*/gi, "")
        .replace(/\bempty environment plate\b/gi, "empty environment background")
        .replace(/\bplate\b/gi, "background")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function clamp01(value, fallback = 0.5) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

function findLocationValue(source, location) {
    if (!source || typeof source !== "object" || !location) return null;
    const wanted = String(location).trim().toLowerCase();
    const key = Object.keys(source).find((candidate) => String(candidate || "").trim().toLowerCase() === wanted);
    return key ? source[key] : null;
}

function normalizeBackgroundHotspot(raw, index = 0, source = "location") {
    if (!raw) return null;
    const item = typeof raw === "string" ? { label: raw } : raw;
    if (!item || typeof item !== "object") return null;
    const label = String(item.label || item.name || item.title || item.action || item.interaction || item.slotId || `Hotspot ${index + 1}`).trim();
    if (!label) return null;
    if (isNavigationBackgroundHotspot(item, label)) return null;
    const coords = item.coordinates && typeof item.coordinates === "object" ? item.coordinates : item;
    const box = item.box && typeof item.box === "object" ? item.box : {};
    const x = clamp01(box.x ?? box.left ?? coords.x ?? coords.left, 0.5);
    const y = clamp01(box.y ?? box.top ?? coords.y ?? coords.top, 0.55);
    const width = Math.max(0.05, Math.min(0.5, clamp01(box.width ?? coords.width, 0.16)));
    const height = Math.max(0.05, Math.min(0.5, clamp01(box.height ?? coords.height, 0.16)));
    return {
        id: String(item.id || item.slotId || `hotspot_${index + 1}`).trim(),
        label,
        action: String(item.action || item.interaction || item.purpose || "").trim(),
        source,
        box: { x, y, width, height },
    };
}

function domBackgroundHotspots(location) {
    if (!String(location || "").toLowerCase().includes("room")) return [];
    try {
        return Array.from(document.querySelectorAll(".room-hotspot")).map((el, index) => {
            const style = String(el.getAttribute?.("style") || "");
            const pct = (name, fallback) => Number((style.match(new RegExp(`${name}:\\s*([0-9.]+)%`, "i")) || [])[1] || fallback) / 100;
            return normalizeBackgroundHotspot({
                id: el.id,
                label: el.title || el.textContent,
                action: el.title || el.textContent,
                x: pct("left", 50),
                y: pct("top", 55),
                width: pct("width", 16),
                height: pct("height", 16),
            }, index, "visible room hotspot");
        }).filter(Boolean);
    } catch (_) {
        return [];
    }
}

export function buildBackgroundHotspotContract(options = {}) {
    const s = getSettings();
    const ws = s?.worldState || {};
    const location = String(options.location || ws?.mapContext?.location || ws.location || "Current Location").trim();
    const node = findLocationValue(ws.mapNodes, location) || {};
    const scene = findLocationValue(ws.areaScenes, location) || {};
    const explicitGroups = [
        [options.hotspots, "request hotspot"],
        [scene.backgroundHotspots, "scene hotspot"],
        [scene.hotspots, "scene hotspot"],
        [node.backgroundHotspots, "map hotspot"],
        [node.hotspots, "map hotspot"],
    ];
    const spatial = [];
    for (const [items, source] of explicitGroups) {
        if (!Array.isArray(items)) continue;
        items.forEach((item, index) => spatial.push(normalizeBackgroundHotspot(item, index, source)));
    }
    spatial.push(...domBackgroundHotspots(location));

    const placements = Array.isArray(s?.roomEditor?.placements) ? s.roomEditor.placements : [];
    placements
        .filter((item) => {
            const itemLocation = String(item?.location || item?.locationName || "").trim();
            return (!itemLocation || itemLocation.toLowerCase() === location.toLowerCase()) &&
                Boolean(item?.interactive || item?.interactionSlot || item?.action);
        })
        .forEach((item, index) => spatial.push(normalizeBackgroundHotspot({
            ...item,
            label: item.label || item.title || item.assetId || item.slotId,
            action: item.action || item.interactionSlot,
            width: item.width || 0.14,
            height: item.height || 0.14,
        }, index, "placed interactive")));

    const seen = new Set();
    const uniqueSpatial = spatial.filter((item) => {
        if (!item) return false;
        const key = `${item.id}|${item.label}|${item.box.x.toFixed(3)}|${item.box.y.toFixed(3)}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, 16);
    const represented = new Set(uniqueSpatial.flatMap((item) => [item.label, item.action]).map((value) => String(value || "").toLowerCase()).filter(Boolean));
    const nonVisualInteractions = new Set(["observe", "look", "move", "walk", "listen", "talk", "wait", "reflect"]);
    const interactions = [...(Array.isArray(scene.interactions) ? scene.interactions : []), ...(Array.isArray(node.interactions) ? node.interactions : [])]
        .map((value) => String(value || "").trim())
        .filter((value, index, all) => value &&
            all.indexOf(value) === index &&
            !represented.has(value.toLowerCase()) &&
            !nonVisualInteractions.has(value.toLowerCase()))
        .slice(0, 12);

    const spatialLines = uniqueSpatial.map((item, index) => {
        const b = item.box;
        const left = clamp01(b.x);
        const top = clamp01(b.y);
        const right = clamp01(left + clamp01(b.width, 0.16));
        const bottom = clamp01(top + clamp01(b.height, 0.16));
        const legacyPlacement = `A clearly visible ${item.label}${item.action ? ` suitable for ${item.action}` : ""} in the ${naturalRegion(b)}.`;
        return `${index + 1}. ${legacyPlacement} Exact placement: ${item.label}${item.action ? ` (${item.action})` : ""} belongs in ${sceneBand(b)}, center near x=${pct(left)}, y=${pct(top)}, occupying roughly x ${pct(left)}-${pct(right)} and y ${pct(top)}-${pct(bottom)}; keep it clearly separated and recognizable as an edit-room anchor.`;
    });
    return [
        spatialLines.length
            ? `Composition anchors / exact anchor placements:\n${spatialLines.join("\n")}`
            : "Exact anchor placements:\nNo explicit object hot spots were supplied. Do not invent clickable route, exit, or navigation anchors. Keep visible room contents natural and let the user add object hot spots explicitly.",
        interactions.length ? `Include natural environmental features that support: ${interactions.join(", ")}. Give each feature a stable visible location instead of scattering tiny props.` : "",
    ].filter(Boolean).join("\n");
}

function isNavigationBackgroundHotspot(item = {}, label = "") {
    const action = String(item.action || item.interaction || item.purpose || "").trim();
    const id = String(item.id || item.slotId || "").trim();
    const sourceText = `${id} ${label} ${action}`.toLowerCase();
    if (/\b(north|south|east|west|northeast|northwest|southeast|southwest)\s+(route|exit|path|road|street|way)\b/.test(sourceText)) return true;
    if (/\b(route|exit|path|road|street|trail|walkway|doorway|gateway|corridor|hallway|stairs|ladder|portal|transit|travel|navigate|navigation|go to|move to)\b/.test(sourceText)) return true;
    if (/^(enter|leave|exit|travel|move|walk|navigate|go)$/i.test(action)) return true;

    // Retrieve all known map node and room names to filter them out of visible hotspots
    try {
        const s = getSettings();
        const ws = s?.worldState || {};
        const locations = new Set();
        if (ws.mapNodes) {
            Object.keys(ws.mapNodes).forEach(k => locations.add(k.toLowerCase().trim()));
            Object.values(ws.mapNodes).forEach(n => {
                if (n.name) locations.add(n.name.toLowerCase().trim());
                if (n.id) locations.add(n.id.toLowerCase().trim());
            });
        }
        if (ws.rooms) {
            Object.keys(ws.rooms).forEach(k => locations.add(k.toLowerCase().trim()));
            Object.values(ws.rooms).forEach(r => {
                if (r.name) locations.add(r.name.toLowerCase().trim());
                if (r.id) locations.add(r.id.toLowerCase().trim());
            });
        }
        if (ws.navGraph) {
            Object.keys(ws.navGraph).forEach(k => locations.add(k.toLowerCase().trim()));
            Object.values(ws.navGraph).forEach(exits => {
                if (exits && typeof exits === 'object') {
                    Object.values(exits).forEach(to => {
                        if (typeof to === 'string') locations.add(to.toLowerCase().trim());
                    });
                }
            });
        }

        const normLabel = label.toLowerCase().trim();
        const normAction = action.toLowerCase().trim();
        const normId = id.toLowerCase().trim();

        for (const locName of locations) {
            if (locName.length > 2) {
                if (normLabel === locName || normAction === locName || normId === locName) {
                    return true;
                }
                if (normLabel.includes(locName) && (normLabel.includes("go to") || normLabel.includes("travel") || normLabel.includes("enter") || normLabel.includes("exit") || normLabel.includes("move") || normLabel.includes("cross"))) {
                    return true;
                }
            }
        }
    } catch (_) {}

    return false;
}

function buildBackgroundContentContract({ location, environment, node = {}, scene = {}, prompt = "", details = "" } = {}) {
    const rawInteractions = [
        ...(Array.isArray(scene.interactions) ? scene.interactions : []),
        ...(Array.isArray(node.interactions) ? node.interactions : []),
    ].map((value) => String(value || "").trim()).filter(Boolean);
    const interactions = rawInteractions.filter((value, index, all) => all.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index).slice(0, 10);
    const extras = [
        node.backgroundPrompt,
        scene.imagePrompt,
        node.description || scene.description,
        prompt,
    ].map((value) => compactSceneText(value, 360)).filter(Boolean);
    const uniqueExtras = extras.filter((value, index, all) => all.indexOf(value) === index).slice(0, 5);
    return [
        "Scene contents to depict:",
        `Base location: ${location}.`,
        `Environment category: ${environment || "interior"}.`,
        details ? `Base description to preserve: ${details}` : "",
        uniqueExtras.length ? `Additional known contents: ${uniqueExtras.join(" / ")}` : "Additional known contents: none supplied; add only context-appropriate permanent scenery, furniture, terrain, routes, fixtures, and lighting.",
        interactions.length ? `Functional contents to make visible: ${interactions.join(", ")}.` : "Functional contents to make visible: one focal landmark or furnishing group and two supporting environmental details. Do not turn navigation routes, exits, roads, or paths into hot spots.",
        "Every visible object must belong to this location and era. Do not invent genre-breaking technology, magic, vehicles, signage, or furniture.",
    ].filter(Boolean).join("\n");
}

function buildBackgroundLayoutContract({ location, environment, map = "", continuity = "" } = {}) {
    return [
        "Spatial layout guidance:",
        `Scene name: ${location}.`,
        "Canvas grid: x=0% is far left, x=50% is center, x=100% is far right; y=0% is top/background, y=50% is middle distance, y=100% is bottom/foreground.",
        "Camera: straight-on natural eye-level view, slight wide-angle establishing composition, no top-down map, no isometric view, no collage.",
        "Reserved overlay space: keep x=35%-65% and y=28%-76% visually open enough for a character sprite; keep y=78%-100% clean enough for dialogue UI.",
        "Depth plan: background landmarks and walls at y=5%-38%; main usable anchors at y=38%-72%; foreground floor or ground plane at y=72%-100%.",
        "Object separation: do not overlap important anchors; leave clear negative space around doors, paths, furniture groups, terrain features, consoles, shelves, or landmarks.",
        environmentPlacementRules(environment),
        map ? `Map facts: ${map}` : "",
        continuity,
    ].filter(Boolean).join("\n");
}

export function buildStrictBackgroundPromptMacros(options = {}) {
    const s = getSettings();
    const ws = s?.worldState || {};
    const mapContext = ws.mapContext || {};
    const location = String(options.location || mapContext.location || ws.location || "Current Location").trim();
    const node = findLocationValue(ws.mapNodes, location) || {};
    const scene = findLocationValue(ws.areaScenes, location) || {};
    const environmentInfo = environmentTemplate({
        ...node,
        name: location,
        desc: node.description || scene.description || "",
    });
    const prompt = String(options.prompt || options.base || "").trim();
    const map = String(options.map || [
        `Location=${location}`,
        mapContext.previousLocation ? `Previous=${mapContext.previousLocation}` : "",
        mapContext.travelDirection ? `Direction=${mapContext.travelDirection}` : "",
        node.type ? `Type=${node.type}` : "",
        node.theme || mapContext.theme ? `Theme=${node.theme || mapContext.theme}` : "",
        node.district ? `Region=${node.district}` : "",
        node.description ? `Description=${node.description}` : "",
        node.backgroundPrompt ? `LocationPrompt=${node.backgroundPrompt}` : "",
    ].filter(Boolean).join("; ")).trim();
    const details = [
        compactSceneText(node.backgroundPrompt),
        compactSceneText(scene.imagePrompt),
        compactSceneText(node.description || scene.description),
        compactSceneText(prompt),
    ].filter((value, index, all) => value && all.indexOf(value) === index).join(". ");
    const continuity = [
        mapContext.theme || node.theme ? `Mood and visual identity: ${mapContext.theme || node.theme}.` : "",
        mapContext.travelDirection ? `The traversable route continues toward the ${mapContext.travelDirection}.` : "",
        options.includeBackgroundChatContext === true && options.chat ? `Environmental continuity only: ${compactSceneText(options.chat, 400)}` : "",
    ].filter(Boolean).join("\n");
    return {
        location,
        map,
        environment: environmentInfo.environment,
        environmentImage: environmentInfo.image,
        details,
        continuity,
        layout: buildBackgroundLayoutContract({ location, environment: environmentInfo.environment, map, continuity }),
        contents: buildBackgroundContentContract({ location, environment: environmentInfo.environment, node, scene, prompt, details }),
        placement_grid: buildBackgroundHotspotContract({ ...options, location }),
    };
}

export function limitImagePrompt(prompt, maxChars = IMAGE_PROMPT_MAX_CHARS) {
    const text = String(prompt || "").trim();
    const limit = Math.max(1, Number(maxChars) || IMAGE_PROMPT_MAX_CHARS);
    if (text.length <= limit) return text;

    const suffix = "\n[Context shortened to fit image API prompt limit.]";
    const available = Math.max(1, limit - suffix.length);
    let shortened = text.slice(0, available);
    const boundary = Math.max(
        shortened.lastIndexOf("\n"),
        shortened.lastIndexOf(". "),
        shortened.lastIndexOf("; ")
    );
    if (boundary >= Math.floor(available * 0.75)) shortened = shortened.slice(0, boundary + 1);
    return `${shortened.trimEnd()}${suffix}`.slice(0, limit);
}

export function buildContextualImagePrompt(prompt, options = {}) {
    const s = getSettings();
    const img = s?.image || {};
    const ws = s?.worldState || {};
    const mapContext = ws.mapContext || {};
    const location = String(options.location || mapContext.location || ws.location || "Current Location").trim();
    const node = findLocationValue(ws.mapNodes, location) || {};
    const scene = findLocationValue(ws.areaScenes, location) || {};
    const mode = String(options.mode || "image").toLowerCase();
    const background = mode === "background";
    const chat = String(options.chat || readRecentChatContext()).trim();
    const map = [
        `Location=${location}`,
        mapContext.previousLocation ? `Previous=${mapContext.previousLocation}` : "",
        mapContext.travelDirection ? `Direction=${mapContext.travelDirection}` : "",
        node.type ? `Type=${node.type}` : "",
        node.theme || mapContext.theme ? `Theme=${node.theme || mapContext.theme}` : "",
        node.district ? `Region=${node.district}` : "",
        node.description ? `Description=${node.description}` : "",
        node.backgroundPrompt ? `LocationPrompt=${node.backgroundPrompt}` : "",
    ].filter(Boolean).join("; ");
    const strictBackground = background ? buildStrictBackgroundPromptMacros({
        ...options,
        location,
        map,
        prompt,
        chat,
    }) : null;
    const context = {
        style: String(s?.imageStylePrompt || s?.generation?.promptPrefixes?.byType?.image || "").trim(),
        location,
        map,
        chat: background && options.includeBackgroundChatContext !== true ? "" : chat,
        base: String(prompt || "").trim(),
        hotspots: strictBackground?.placement_grid || "",
        layout: strictBackground?.layout || "",
        contents: strictBackground?.contents || "",
        placement_grid: strictBackground?.placement_grid || "",
        environment: strictBackground?.environment || "",
        environment_image: strictBackground?.environmentImage || "",
    };
    const genreDirective = imageGenreDirective(s, node, scene, chat);
    const customTemplate = background ? String(img.promptTemplateBackground || "").trim() : "";
    let full = expandPromptTemplate(customTemplate || (background ? BACKGROUND_PROMPT_TEMPLATE : "{{style}}\n{{base}}\nMap context: {{map}}\nRecent story context: {{chat}}"), context).trim();
    if (background) {
        if (customTemplate) {
            const requiredBlocks = [];
            if (!/\{\{\s*layout\s*\}\}/i.test(customTemplate)) requiredBlocks.push(context.layout);
            if (!/\{\{\s*contents\s*\}\}/i.test(customTemplate)) requiredBlocks.push(context.contents);
            if (!/\{\{\s*(?:placement_grid|hotspots)\s*\}\}/i.test(customTemplate)) requiredBlocks.push(context.placement_grid);
            if (requiredBlocks.length) full = [full, ...requiredBlocks].filter(Boolean).join("\n");
        }
        full = [
            BACKGROUND_STRICT_TEMPLATE,
            genreDirective,
            `Scene: ${location}.`,
            full,
            `Setting type guard: ${strictBackground.environmentImage}.`,
            "The final image is only the empty environment background, ready for later visual-novel overlays.",
        ].filter(Boolean).join("\n");
        return sanitizeImagePromptText(full);
    }
    full = [
        genreDirective,
        full,
        "[AUTHORITATIVE CONTEXT]",
        `Map: ${map || `Location=${location}`}`,
        `Recent story: ${chat || "No recent chat text is available; preserve established map details."}`,
    ].filter(Boolean).join("\n");
    if (img.strictImagePrompts !== false) {
        full = `[IMAGE CONSTRAINTS] Follow the current map location and recent story context. Single readable composition. No watermark, UI, logos, captions, or lettering.\n${full}`;
    }
    return sanitizeImagePromptText(full);
}

function safeStructuredClone(v) {
    try {
        if (typeof structuredClone === "function") return structuredClone(v);
    } catch (_) {}
    return JSON.parse(JSON.stringify(v));
}

function parseComfyWorkflowRaw(workflowRaw) {
    const obj = JSON.parse(String(workflowRaw || ""));
    if (obj && typeof obj === "object" && obj.prompt && typeof obj.prompt === "object") return obj.prompt;
    if (obj && typeof obj === "object" && Array.isArray(obj.nodes) && Array.isArray(obj.links)) {
        throw new Error("This is a ComfyUI UI workflow export (nodes/links), not an API-format workflow. In ComfyUI, enable Dev Mode (Settings > Enable Dev mode options), then use \"Export (API)\" / \"Save (API Format)\" and paste that JSON instead.");
    }
    return obj;
}

function comfyGraphNeedsCheckpoint(graph) {
    if (!graph || typeof graph !== "object") return true;
    return Object.values(graph).some(n => /CheckpointLoaderSimple/i.test(String(n?.class_type || "")));
}

function detectComfyNodeIds(graph) {
    const g = graph && typeof graph === "object" ? graph : {};
    const clip = [];
    const save = [];
    const preview = [];
    for (const [id, n] of Object.entries(g)) {
        const ct = String(n?.class_type || "");
        if (/CLIPTextEncode/i.test(ct)) clip.push(id);
        if (/SaveImage/i.test(ct)) save.push(id);
        if (/PreviewImage/i.test(ct)) preview.push(id);
    }
    const positiveNodeId = clip.length ? String(clip[0]) : "";
    const negativeNodeId = clip.length > 1 ? String(clip[1]) : "";
    const outputNodeId = save.length ? String(save[0]) : preview.length ? String(preview[0]) : "";
    return { positiveNodeId, negativeNodeId, outputNodeId };
}

function buildDefaultComfyWorkflowJson() {
    return JSON.stringify({
        "3": {
            class_type: "KSampler",
            inputs: {
                cfg: "%scale%",
                denoise: "%denoise%",
                latent_image: ["5", 0],
                model: ["4", 0],
                negative: ["7", 0],
                positive: ["6", 0],
                sampler_name: "%sampler%",
                scheduler: "%scheduler%",
                seed: "%seed%",
                steps: "%steps%"
            }
        },
        "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "%model%" } },
        "5": { class_type: "EmptyLatentImage", inputs: { batch_size: 1, height: "%height%", width: "%width%" } },
        "6": { class_type: "CLIPTextEncode", inputs: { clip: ["4", 1], text: "%prompt%" } },
        "7": { class_type: "CLIPTextEncode", inputs: { clip: ["4", 1], text: "%negative_prompt%" } },
        "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
        "9": { class_type: "SaveImage", inputs: { filename_prefix: "UIE", images: ["8", 0] } }
    });
}

function makeSvgFallbackDataUrl(promptText, reason) {
    void promptText;
    void reason;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1d2233"/><stop offset="100%" stop-color="#111827"/></linearGradient>
  <radialGradient id="r" cx="50%" cy="42%" r="58%"><stop offset="0%" stop-color="#7dd3fc" stop-opacity="0.22"/><stop offset="100%" stop-color="#7dd3fc" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1024" height="1024" fill="url(#g)"/>
<rect width="1024" height="1024" fill="url(#r)"/>
<rect x="64" y="64" width="896" height="896" rx="24" fill="none" stroke="#7dd3fc" stroke-opacity="0.32" stroke-width="3"/>
<path d="M148 738 C286 604 391 654 501 538 C620 412 733 428 876 286 L876 876 L148 876 Z" fill="#0f766e" fill-opacity="0.42"/>
<path d="M148 808 C294 698 432 744 547 625 C674 493 757 532 876 421 L876 876 L148 876 Z" fill="#38bdf8" fill-opacity="0.22"/>
<circle cx="748" cy="244" r="82" fill="#f8fafc" fill-opacity="0.22"/>
</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function applyComfySettings(graph, { checkpoint, sampler, scheduler, steps, cfg, denoise, seed, width, height }) {
    const g = graph && typeof graph === "object" ? graph : graph;
    try {
        for (const n of Object.values(g || {})) {
            const ct = String(n?.class_type || "");
            if (!n || typeof n !== "object") continue;
            if (!n.inputs || typeof n.inputs !== "object") n.inputs = {};

            if (/CheckpointLoaderSimple/i.test(ct) && checkpoint) {
                if ("ckpt_name" in n.inputs || n.inputs.ckpt_name === undefined) n.inputs.ckpt_name = String(checkpoint);
            }
            if (/KSampler/i.test(ct)) {
                if (sampler && ("sampler_name" in n.inputs || n.inputs.sampler_name === undefined)) n.inputs.sampler_name = String(sampler);
                if (scheduler && ("scheduler" in n.inputs || n.inputs.scheduler === undefined)) n.inputs.scheduler = String(scheduler);
                if (Number.isFinite(steps) && steps > 0 && ("steps" in n.inputs || n.inputs.steps === undefined)) n.inputs.steps = steps;
                if (Number.isFinite(cfg) && cfg >= 0 && ("cfg" in n.inputs || n.inputs.cfg === undefined)) n.inputs.cfg = cfg;
                if (Number.isFinite(denoise) && denoise >= 0 && denoise <= 1 && ("denoise" in n.inputs || n.inputs.denoise === undefined)) n.inputs.denoise = denoise;
                if (Number.isFinite(seed) && seed >= 0 && ("seed" in n.inputs || n.inputs.seed === undefined)) n.inputs.seed = seed;
            }
            if (/EmptyLatentImage/i.test(ct)) {
                if (Number.isFinite(width) && width > 0 && ("width" in n.inputs || n.inputs.width === undefined)) n.inputs.width = width;
                if (Number.isFinite(height) && height > 0 && ("height" in n.inputs || n.inputs.height === undefined)) n.inputs.height = height;
            }
        }
    } catch (_) {}
    return g;
}

async function getCsrfToken() {
    const now = Date.now();
    if (uieImgCsrfCache.token && now - uieImgCsrfCache.t < 5 * 60 * 1000) return uieImgCsrfCache.token;
    try {
        let r = await fetch("/csrf-token", { method: "GET" }).catch(() => null);
        if (!r || !r.ok) {
            if (window.location.port !== "8091") {
                r = await fetch("http://127.0.0.1:8091/csrf-token", { method: "GET" }).catch(() => null);
            }
        }
        if (!r || !r.ok) return "";
        const j = await r.json().catch(() => null);
        const tok = String(j?.csrfToken || j?.token || "").trim();
        if (tok) uieImgCsrfCache = { t: now, token: tok };
        return tok;
    } catch (_) {
        return "";
    }
}

function buildCorsProxyCandidates(targetUrl) {
    const u = String(targetUrl || "").trim();
    if (!u) return [];
    const enc = encodeURIComponent(u);
    const out = [];
    const add = (x) => { if (x && !out.includes(x)) out.push(x); };
    
    // Add port 8091 absolute versions if we are not running on port 8091
    const prefix = (window.location.port !== "8091") ? "http://127.0.0.1:8091" : "";
    
    add(`${prefix}/api/proxy?url=${enc}`);
    add(`${prefix}/proxy?url=${enc}`);
    add(`${prefix}/api/cors-proxy?url=${enc}`);
    add(`${prefix}/cors-proxy?url=${enc}`);
    add(`${prefix}/api/extra/proxy?url=${enc}`);
    add(`${prefix}/api/proxy/${enc}`);

    if (prefix) {
        add(`/api/proxy?url=${enc}`);
        add(`/proxy?url=${enc}`);
        add(`/api/cors-proxy?url=${enc}`);
        add(`/cors-proxy?url=${enc}`);
        add(`/api/extra/proxy?url=${enc}`);
        add(`/api/proxy/${enc}`);
    }

    return out;
}

function isFailedToFetchError(e) {
    const m = String(e?.message || e || "").toLowerCase();
    return m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed") || m.includes("cors");
}

async function fetchWithCorsProxyFallback(targetUrl, options, opts = {}) {
    const currentHost = String(window.location?.hostname || "").toLowerCase();
    const standaloneLocal = window.UIE_STANDALONE === true || ["localhost", "127.0.0.1", "0.0.0.0"].includes(currentHost);
    const remoteTarget = /^https?:\/\//i.test(String(targetUrl || "")) &&
        !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(String(targetUrl || ""));
    const skipDirect = opts.skipDirect === true || /nvidia\.com/i.test(String(targetUrl || "")) || (standaloneLocal && remoteTarget);
    const isLocalHost = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(String(targetUrl || ""));
    let hasLocalProxy404 = false;
    if (/\/prompt$|\/history|comfy/i.test(String(targetUrl || ""))) {
        console.log("[UIE-Comfy] fetchWithCorsProxyFallback routing", {
            targetUrl, currentHost, pageOrigin: window.location?.origin, standaloneLocal, remoteTarget, skipDirect, isLocalHost, method: options?.method || "GET", optsSkipDirect: opts.skipDirect,
        });
    }

    const tryServerForward = async (endpoint) => {
        try {
            const targetHdr = new Headers(options?.headers || {});
            const hdr = new Headers();
            hdr.set("Content-Type", "application/json");
            const payload = {
                url: String(targetUrl || ""),
                method: String(options?.method || "GET"),
                headers: Object.fromEntries(targetHdr.entries()),
                body: typeof options?.body === "string" ? options.body : (options?.body != null ? JSON.stringify(options.body) : null)
            };
            const tok = await getCsrfToken();
            if (tok && !hdr.has("X-CSRF-Token")) hdr.set("X-CSRF-Token", tok);

            // 1. Try relative endpoint
            let r = null;
            try {
                r = await fetch(String(endpoint || ""), { method: "POST", headers: hdr, body: JSON.stringify(payload), credentials: "same-origin" });
                console.log(`[UIE-Comfy] tryServerForward relative ${endpoint} -> status ${r.status}`);
            } catch (e) {
                console.warn(`[UIE-Comfy] tryServerForward relative ${endpoint} threw`, e);
            }

            // 2. Try port 8091 absolute endpoint if relative failed or returned !ok or 404/502, and port is not 8091
            if ((!r || r.status === 404 || r.status === 502) && window.location.port !== "8091") {
                console.warn(`[UIE-Comfy] relative ${endpoint} failed/404/502 (page is on port ${window.location.port}), trying hardcoded http://127.0.0.1:8091${endpoint} -- this is WRONG if your dev-server is not on port 8091`);
                try {
                    r = await fetch(`http://127.0.0.1:8091${endpoint}`, { method: "POST", headers: hdr, body: JSON.stringify(payload) });
                    console.log(`[UIE-Comfy] tryServerForward :8091 fallback ${endpoint} -> status ${r.status}`);
                } catch (e) {
                    console.warn(`[UIE-Comfy] tryServerForward :8091 fallback ${endpoint} threw`, e);
                }
            }

            if (!r) return null;

            if (r.status >= 400) {
                const isForwarded = r.headers.get("x-uie-proxy") === "true";
                if (!isForwarded) {
                    if (r.status === 404) {
                        hasLocalProxy404 = true;
                    }
                    return null;
                }
            }
            return r;
        } catch (_) {
            return null;
        }
    };

    const runProxyFallback = async (lastErr) => {
        if (/\/prompt$|\/history|comfy/i.test(String(targetUrl || ""))) {
            console.log("[UIE-Comfy] runProxyFallback engaged, initial reason:", lastErr?.message || lastErr);
        }
        const candidates = buildCorsProxyCandidates(targetUrl);
        for (const ep of ["/api/proxy", "/api/extra/proxy", "/api/cors-proxy", "/api/corsProxy"]) {
            const r = await tryServerForward(ep);
            if (r) return { response: r, via: "server-forward", requestUrl: ep };
        }
        for (const proxyUrl of candidates) {
            try {
                let r = await fetch(proxyUrl, options);
                if (r.status >= 400) {
                    const isForwarded = r.headers.get("x-uie-proxy") === "true";
                    if (!isForwarded) {
                        if (r.status === 404) {
                            hasLocalProxy404 = true;
                        }
                        if (r.status === 403 || r.status === 401) {
                            const tok = await getCsrfToken();
                            if (tok) {
                                const h = new Headers(options?.headers || {});
                                if (!h.has("X-CSRF-Token")) h.set("X-CSRF-Token", tok);
                                const r2 = await fetch(proxyUrl, { ...options, headers: h });
                                if (r2.status >= 400 && r2.headers.get("x-uie-proxy") !== "true") {
                                    if (r2.status === 404) hasLocalProxy404 = true;
                                    continue;
                                }
                                r = r2;
                            } else {
                                continue;
                            }
                        } else {
                            continue;
                        }
                    }
                }
                return { response: r, via: "proxy", requestUrl: proxyUrl };
            } catch (e2) {
                lastErr = e2;
                continue;
            }
        }
        if (hasLocalProxy404 && lastErr) {
            lastErr.message = (lastErr.message || "") + " (Local proxy returned 404. Make sure dev-server.mjs is running on port 8091)";
        }
        throw lastErr;
    };

    if (skipDirect || (isLocalHost && (options?.method || "GET") === "POST")) {
        return await runProxyFallback(new Error("Skipped direct (local/CORS)"));
    }

    try {
        const r = await fetch(targetUrl, options);
        return { response: r, via: "direct", requestUrl: targetUrl };
    } catch (e) {
        if (!isFailedToFetchError(e) && !skipDirect) throw e;
        return await runProxyFallback(e);
    }
}

function normalizeEndpoint(x, providerRaw = "") {
    let clean = String(x || "").trim();
    if (!clean || clean === "null" || clean === "undefined") {
        clean = "https://api.openai.com/v1/images/generations";
    }
    clean = clean.replace(/\/+$/, "");
    const provider = String(providerRaw || "").toLowerCase().trim();
    const isImageRouter = provider === "imagerouter" || /^https:\/\/api\.imagerouter\.io(?:\/|$)/i.test(clean);
    if (provider === "google") {
        if (/^https:\/\/generativelanguage\.googleapis\.com$/i.test(clean)) return `${clean}/v1beta`;
        if (/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/openai$/i.test(clean)) return "https://generativelanguage.googleapis.com/v1beta";
    }
    if (isImageRouter && (
        /^https:\/\/api\.imagerouter\.io\/v1$/i.test(clean) ||
        /^https:\/\/api\.imagerouter\.io\/v1\/images\/generations$/i.test(clean)
    )) {
        return "https://api.imagerouter.io/v1/openai/images/generations";
    }
    if (provider === "nanogpt" && /^https:\/\/nano-gpt\.com\/api\/v1(?:\/images\/generations)?$/i.test(clean)) {
        return "https://nano-gpt.com/v1/images/generations";
    }
    if (/^https:\/\/api\.openai\.com$/i.test(clean)) return `${clean}/v1/images/generations`;
    if (["openai", "lmrouter", "arouter", "nanogpt", "nvidia_nim"].includes(provider) && /^https?:\/\/[^/]+$/i.test(clean)) {
        return `${clean}/v1/images/generations`;
    }
    if (/\/api\/v1$/i.test(clean)) return `${clean}/images/generations`;
    if (/\/v1$/i.test(clean)) return `${clean}/images/generations`;
    return clean;
}

function normalizeGeneratedImageUrl(value, requestEndpoint) {
    const raw = String(value || "").trim();
    if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return raw;
    try {
        return new URL(raw, requestEndpoint).href;
    } catch (_) {
        return raw;
    }
}

/** Map settings UI provider values to internal routing keys. */
function normalizeImageProvider(raw) {
    const p = String(raw || "").toLowerCase().trim();
    if (p === "comfyui") return "comfy";
    if (p === "automatic1111" || p === "sdnext") return "sdwebui";
    if (p === "nvidia") return "nvidia_nim";
    if (p === "koji") return "koji";
    return p;
}

function resolveImageApiKey(img, provider) {
    const candidates = [
        img?.key,
        img?.apiKey,
        img?.token,
        img?.pollinationsKey,
        img?.stability?.key,
        img?.comfy?.key,
        img?.providers?.[provider]?.key,
        img?.providerKeys?.[provider]
    ];
    for (const v of candidates) {
        const s = String(v || "").trim();
        if (s) return resolveApiKey(s);
    }
    return "";
}

function normalizeSdTxt2ImgUrl(raw) {
    let u = String(raw || "").trim().replace(/\/+$/, "");
    if (!u) return "";
    if (!/\/sdapi\/v1\/txt2img/i.test(u)) u = `${u}/sdapi/v1/txt2img`;
    return u;
}

const IMAGE_PROVIDER_PRESETS = {
    openai: { url: "https://api.openai.com/v1/images/generations", model: "gpt-image-1" },
    imagerouter: { url: "https://api.imagerouter.io/v1/openai/images/generations", model: "openai/gpt-image-1" },
    google: { url: "https://generativelanguage.googleapis.com/v1beta", model: "imagen-4.0-generate-001" },
    pollinations: { url: "https://image.pollinations.ai/prompt", model: "flux" },
    stability: { url: "https://api.stability.ai/v2beta/stable-image/generate/core", model: "" },
    lmrouter: { url: "https://api.lmrouter.com/openai/v1/images/generations", model: "stabilityai/stable-diffusion-3.5-large" },
    arouter: { url: "https://api.arouter.com/v1/images/generations", model: "stabilityai/stable-diffusion-3.5-large" },
    nanogpt: { url: "https://nano-gpt.com/v1/images/generations", model: "hidream" },
    nvidia_nim: { url: "https://integrate.api.nvidia.com/v1/images/generations", model: "stabilityai/stable-diffusion-3.5-large" },
};

const IMAGE_PROVIDER_MODELS = {
    openai: [
        { id: "gpt-image-1", label: "gpt-image-1" },
        { id: "dall-e-3", label: "dall-e-3" },
        { id: "dall-e-2", label: "dall-e-2" },
    ],
    imagerouter: [
        { id: "openai/gpt-image-1", label: "openai/gpt-image-1" },
        { id: "openai/dall-e-3", label: "openai/dall-e-3" },
    ],
    google: [
        { id: "imagen-4.0-fast-generate-001", label: "imagen-4.0-fast-generate-001" },
        { id: "imagen-4.0-generate-001", label: "imagen-4.0-generate-001" },
        { id: "imagen-4.0-ultra-generate-001", label: "imagen-4.0-ultra-generate-001" },
    ],
    pollinations: [
        { id: "flux", label: "flux" },
        { id: "turbo", label: "turbo" },
    ],
    stability: [
        { id: "", label: "(uses endpoint engine)" },
    ],
    lmrouter: [
        { id: "stabilityai/stable-diffusion-3.5-large", label: "stabilityai/stable-diffusion-3.5-large" },
        { id: "stabilityai/stable-diffusion-3.5-large-turbo", label: "stabilityai/stable-diffusion-3.5-large-turbo" },
    ],
    arouter: [
        { id: "stabilityai/stable-diffusion-3.5-large", label: "stabilityai/stable-diffusion-3.5-large" },
        { id: "stabilityai/stable-diffusion-3.5-large-turbo", label: "stabilityai/stable-diffusion-3.5-large-turbo" },
    ],
    nanogpt: [
        { id: "hidream", label: "hidream" },
        { id: "flux", label: "flux" },
    ],
    nvidia_nim: [
        { id: "stabilityai/stable-diffusion-3.5-large", label: "stabilityai/stable-diffusion-3.5-large" },
        { id: "stabilityai/stable-diffusion-3.5-large-turbo", label: "stabilityai/stable-diffusion-3.5-large-turbo" },
    ],
};

function imageProviderPreset(providerRaw = "") {
    const provider = normalizeImageProvider(providerRaw);
    return IMAGE_PROVIDER_PRESETS[provider] || { url: "", model: "" };
}

function blobToImageDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error("read failed"));
        r.readAsDataURL(blob);
    });
}

async function generateStabilityV2Beta({ apiKey, promptText, negativePrompt, stability }) {
    const st = stability && typeof stability === "object" ? stability : {};
    let engine = String(st.engine || "core").trim().toLowerCase();
    if (!["core", "sd3", "ultra"].includes(engine)) engine = "core";
    let aspect = String(st.aspectRatio || "1:1").trim();
    const aspectMap = { "4:3": "3:2", "3:4": "2:3" };
    if (aspectMap[aspect]) aspect = aspectMap[aspect];
    const url = `https://api.stability.ai/v2beta/stable-image/generate/${engine}`;
    const form = new FormData();
    form.append("prompt", String(promptText || ""));
    const neg = String(negativePrompt || "").trim();
    if (neg) form.append("negative_prompt", neg);
    form.append("aspect_ratio", aspect);
    form.append("output_format", "png");
    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${String(apiKey || "").trim()}`,
            Accept: "image/*"
        },
        body: form
    });
    const ct = String(res.headers.get("content-type") || "");
    if (res.ok && ct.includes("image")) {
        const blob = await res.blob();
        return await blobToImageDataUrl(blob);
    }
    const errBody = await res.text().catch(() => "");
    throw new Error(`Stability ${res.status}: ${String(errBody || res.statusText || "").slice(0, 240)}`);
}

async function generateGoogleImagen({ apiKey, endpoint, model, promptText }) {
    const mdl = String(model || "imagen-4.0-generate-001").trim();
    let url = String(endpoint || "").trim();
    if (!url || /images\/generations$/i.test(url) || /\/v1beta$/i.test(url) || /\/v1beta\/openai$/i.test(url)) {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mdl)}:predict`;
    } else if (/\/models\/[^:]+:predict$/i.test(url)) {
        url = url.replace(/\/models\/[^:]+:predict$/i, `/models/${encodeURIComponent(mdl)}:predict`);
    }
    const headers = { "Content-Type": "application/json", "Accept": "application/json" };
    if (apiKey) headers["x-goog-api-key"] = apiKey;
    const body = {
        instances: [{ prompt: String(promptText || "") }],
        parameters: { sampleCount: 1 }
    };
    const fx = await fetchWithCorsProxyFallback(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
    });
    const res = fx.response;
    if (!res.ok) {
        const err = await res.text().catch(() => "");
        throw new Error(`Google image ${res.status}: ${String(err || res.statusText || "").slice(0, 220)}`);
    }
    const data = await res.json();
    const pred = Array.isArray(data?.predictions) ? data.predictions[0] : null;
    const b64 = String(pred?.bytesBase64Encoded || pred?.image?.bytesBase64Encoded || pred?.b64_json || "").trim();
    const urlOut = String(pred?.url || data?.url || "").trim();
    if (urlOut) return normalizeGeneratedImageUrl(urlOut, url);
    if (b64) return b64.startsWith("data:image") ? b64 : `data:image/png;base64,${b64}`;
    throw new Error("Google image API returned no image payload");
}

/**
 * Checks if an image should be generated based on context, then generates it.
 * @param {string} context - The text content (chat, item desc, etc.)
 * @param {string} feature - The feature key (map, doll, social, phoneBg, msg, party, items)
 * @returns {Promise<string|null>} - The image URL or null
 */
export async function checkAndGenerateImage(context, feature) {
    const s = getSettings();
    if (!s.image || !s.image.enabled) return null;
    if (s.image.features && s.image.features[feature] === false) return null;

    // Single-pass AI request: decide + generate prompt in one API call.
    const combinedPrompt = `
You are deciding whether an image should be generated, and if so, creating the prompt.

Context:
${context.slice(0, 2000)}

Return ONLY valid JSON with this exact shape:
{"generate":true|false,"prompt":"string"}

Rules:
- Set "generate" to true only if the context explicitly describes a visual scene, item, or character that should be shown.
- If "generate" is false, set "prompt" to an empty string.
- If "generate" is true, make "prompt" a detailed image-generation prompt.
- No markdown, no extra keys, no extra text.`;

    const combinedRes = await generateContent(combinedPrompt, "System Image Decide+Prompt");
    if (!combinedRes) return null;

    let shouldGenerate = false;
    let imagePrompt = "";

    try {
        const raw = String(combinedRes).trim();
        const m = raw.match(/\{[\s\S]*\}/);
        if (!m) return null;
        const parsed = JSON.parse(m[0]);
        shouldGenerate = parsed?.generate === true;
        imagePrompt = String(parsed?.prompt || "").trim();
    } catch (_) {
        return null;
    }

    if (!shouldGenerate || !imagePrompt) return null;

    // 3. Call Image API
    return await generateImageAPI(imagePrompt);
}

// --- PAYWALL HANDLER ---
function handleNanoPayment(data) {
    // Find Nano option
    const nano = data.accepts?.find(x => x.scheme === "nano" || x.network === "nano-mainnet");
    if (!nano) return;

    const amount = nano.maxAmountRequiredFormatted || "0.193 XNO";
    const address = nano.payTo;
    const usd = nano.maxAmountRequiredUSD || "0.00";

    // Create Modal
    const id = "uie-pay-modal";
    $(`#${id}`).remove();

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`nano:${address}?amount=${nano.maxAmountRequired}`)}`;

    const html = `
    <div id="${id}" style="position:fixed; inset:0; z-index:2147483660; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center;">
        <div style="background:#1a1a1a; border:1px solid #cba35c; padding:20px; border-radius:12px; width:min(400px, 90vw); color:#fff; text-align:center; font-family:sans-serif;">
            <h3 style="color:#cba35c; margin-top:0;">Payment Required</h3>
            <div style="font-size:0.9em; color:#ccc; margin-bottom:15px;">
                NanoGPT requires a micro-payment for this request.
            </div>

            <div style="background:#fff; padding:10px; display:inline-block; border-radius:8px; margin-bottom:15px;">
                <img src="${qrUrl}" alt="QR Code" style="display:block; width:150px; height:150px;">
            </div>

            <div style="font-weight:bold; font-size:1.1em; margin-bottom:5px;">${amount}</div>
            <div style="font-size:0.8em; color:#888; margin-bottom:15px;">(approx $${usd})</div>

            <div style="background:#222; padding:10px; border-radius:6px; word-break:break-all; font-family:monospace; font-size:0.85em; user-select:all; border:1px solid #444; margin-bottom:15px; cursor:pointer;" onclick="navigator.clipboard.writeText('${address}'); toastr.success('Copied Address');">
                ${address}
            </div>

            <div style="font-size:0.8em; color:#aaa; margin-bottom:20px;">
                Send exactly this amount to continue. The request will retry automatically or you can close this and try again.
            </div>

            <button onclick="$('#${id}').remove()" style="background:#333; border:1px solid #555; color:#fff; padding:8px 20px; border-radius:6px; cursor:pointer;">Close</button>
        </div>
    </div>
    `;

    $("body").append(html);
}

/**
 * Direct call to Image API
 */
export function generateImageAPI(prompt, options = {}) {
    const settings = getSettings()?.image || {};
    const requestKey = JSON.stringify({
        prompt: String(prompt || "").trim(),
        provider: normalizeImageProvider(settings.provider),
        model: String(settings.model || ""),
        endpoint: String(settings.url || ""),
        mode: String(options.mode || options.feature || ""),
        size: String(options.size || ""),
        width: Number(options.width || 0),
        height: Number(options.height || 0)
    });
    if (imageRequestsInFlight.has(requestKey)) return imageRequestsInFlight.get(requestKey);
    const task = generateImageAPIOnce(prompt, options);
    imageRequestsInFlight.set(requestKey, task);
    task.then(
        () => imageRequestsInFlight.delete(requestKey),
        () => imageRequestsInFlight.delete(requestKey)
    );
    return task;
}

export function imageCategoryForRequest(options = {}, prompt = "") {
    const declared = String(options.imageCategory || options.category || options.entityType || options.feature || options.mode || "").toLowerCase();
    const text = `${declared} ${String(prompt || "")}`.toLowerCase();
    if (/\b(npc|character|portrait|enemy|persona)\b/.test(text)) return "npc";
    if (/\b(skill|spell|ability|rune)\b/.test(text)) return "skills";
    if (/\b(item|inventory|equipment|weapon|armor|icon)\b/.test(text)) return "items";
    return "assets";
}

function categoryEnabled(config, category) {
    return !config || typeof config !== "object" || config[category] !== false;
}

async function generateImageAPIOnce(prompt, options = {}) {
    const s = getSettings();
    const img = s.image || {};
    const rawPrompt = String(prompt || "").trim();
    if (!rawPrompt) {
        try { notify("warning", "Image generation is waiting for an AI-authored contextual prompt.", "Image Gen"); } catch (_) {}
        return null;
    }
    const provider = normalizeImageProvider(img.provider);
    const endpoint = normalizeEndpoint(String(img.url || "https://api.openai.com/v1/images/generations"), provider);
    const model = String(img.model || "gpt-image-1").trim();
    const apiKey = resolveImageApiKey(img, provider);
    const isBackground = String(options.mode || "").toLowerCase() === "background";
    const negText = isBackground
        ? buildBackgroundNegativePrompt(img.negativePrompt)
        : String(img.negativePrompt || "").trim();

    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(endpoint);
    const isPollinations = provider === "pollinations";
    const isGoogle = provider === "google" || /generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/i.test(endpoint);
    const isSdWebUi = provider === "sdwebui" || /\/sdapi\/v1\/txt2img\s*$/i.test(endpoint);
    const isStability = provider === "stability";
    const isComfy = (() => {
        if (provider === "comfy") return true;
        if (isSdWebUi) return false;
        if (/\/v1\/images\/generations\s*$/i.test(endpoint)) return false;
        if (/\/images\/generations\s*$/i.test(endpoint)) return false;
        if (/\/prompt\s*$/i.test(endpoint)) return true;
        if (/:(8188|8189)(\/|$)/i.test(endpoint)) return true;
        const wf = String(img?.comfy?.workflow || "").trim();
        return !!wf && isLocal;
    })();
    const isKoji = provider === "koji";
    const hybridMode = img.hybridMode === true;
    const imageCategory = imageCategoryForRequest(options, rawPrompt);
    const localCategoryEnabled = categoryEnabled(img.hybridKojiCategories, imageCategory);
    const mainCategoryEnabled = categoryEnabled(img.autoGenerateCategories, imageCategory);

    // Automated callers honor the player's category choice. Manual Generate
    // buttons remain available even when automatic generation is turned off.
    if (options.automatic === true && !mainCategoryEnabled && !(hybridMode && localCategoryEnabled)) {
        return null;
    }

    if (window.toastr) toastr.info("Generating Image...", "AI Fabricator");

    const lockedPrompt = /^\[UIE_LOCKED\]/i.test(rawPrompt.trim());
    const contextReady = /^\s*(?:\[UIE_LOCKED\]\s*)?\[UIE_CONTEXT_READY\]/i.test(rawPrompt);
    let finalPrompt = rawPrompt
        .replace(/^\s*\[UIE_LOCKED\]\s*/i, "")
        .replace(/^\s*\[UIE_CONTEXT_READY\]\s*/i, "")
        .trim();

    if (!contextReady) {
        finalPrompt = buildContextualImagePrompt(finalPrompt, options).replace(/^\s*\[UIE_CONTEXT_READY\]\s*/i, "").trim();
    }
    finalPrompt = sanitizeImagePromptText(finalPrompt);

    if (!lockedPrompt) {
        try {
            const p = s?.generation?.promptPrefixes || {};
            const global = String(p?.global || "").trim();
            if (global) finalPrompt = `${global}, ${finalPrompt}`;
        } catch (_) {}
    }
    finalPrompt = limitImagePrompt(finalPrompt);

    const startedAt = Date.now();

    // Hybrid mode: Try Koji first, then fall back to configured provider
    if (hybridMode && localCategoryEnabled && !isKoji && provider !== "pollinations") {
        try {
            const VisualGen = await import("./visualGen.js");
            const kojiResult = await VisualGen.generateWithKoji?.(finalPrompt, {
                width: isBackground ? 1280 : 1024,
                height: isBackground ? 720 : 1024,
            });
            if (kojiResult?.ok && kojiResult.dataUrl) {
                try { window.UIE_lastImage = { ok: true, ms: Date.now() - startedAt, endpoint: "koji", mode: "hybrid-koji" }; } catch (_) {}
                return kojiResult.dataUrl;
            }
        } catch (kojiErr) {
            console.warn("Hybrid mode: Koji failed, falling back to configured provider", kojiErr);
        }
    }

    const pollinationsUrlFor = (text) => {
        const params = new URLSearchParams();
        params.set("nologo", "true");
        params.set("width", isBackground ? "1280" : "1024");
        params.set("height", isBackground ? "720" : "1024");
        params.set("seed", String(Math.floor(Math.random() * 100000)));
        const pollModel = String(img.pollinationsModel || (provider === "pollinations" ? img.model : "") || "").trim();
        if (pollModel) params.set("model", pollModel);
        const pollKey = resolveApiKey(String(img.pollinationsKey || (provider === "pollinations" ? apiKey : "") || "").trim());
        if (pollKey) params.set("token", pollKey);
        return `https://image.pollinations.ai/prompt/${encodeURIComponent(text || "fantasy concept art")}?${params.toString()}`;
    };

    const pollinationsFallback = async (reason) => {
        const fallbackReason = String(reason || "Primary provider unavailable");
        if (options.allowFallback === false) return null;
        if (img.fallbackEnabled === false) return null;
        try {
            const pollUrl = pollinationsUrlFor(finalPrompt || "fantasy concept art");
            const hdr = {};
            const pollKey = resolveApiKey(String(img.pollinationsKey || "").trim());
            if (pollKey) hdr.Authorization = `Bearer ${pollKey}`;
            const fx = await fetchWithCorsProxyFallback(pollUrl, { method: "GET", headers: hdr }, { skipDirect: false });
            if (!fx?.response?.ok) throw new Error(`Pollinations fallback failed (${fx?.response?.status || 0})`);
            const blob = await fx.response.blob();
            const dataUrl = await new Promise(resolve => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.readAsDataURL(blob);
            });
            try {
                window.UIE_lastImage = {
                    ok: true,
                    ms: Date.now() - startedAt,
                    endpoint: "pollinations",
                    mode: "fallback-pollinations",
                    reason: fallbackReason.slice(0, 120)
                };
            } catch (_) {}
            try { window.toastr?.warning?.("Primary image API failed, used fallback renderer."); } catch (_) {}
            return dataUrl;
        } catch (e) {
            const svgOut = makeSvgFallbackDataUrl(finalPrompt, fallbackReason);
            try {
                window.UIE_lastImage = {
                    ok: true,
                    ms: Date.now() - startedAt,
                    endpoint: "uie:svg-fallback",
                    mode: "fallback-svg",
                    error: String(e?.message || e || "Fallback failed").slice(0, 160),
                    reason: fallbackReason.slice(0, 120)
                };
            } catch (_) {}
            try { window.toastr?.warning?.("All image APIs failed, used local fallback image."); } catch (_) {}
            return svgOut;
        }
    };

    if (!apiKey && !isLocal && !isSdWebUi && !isComfy && !isPollinations && !isStability && !isGoogle && !isKoji) {
        if (!missingApiKeyWarned) {
            missingApiKeyWarned = true;
            console.warn("Image Gen: Missing API key, switching to fallback.");
        }
        return await pollinationsFallback("Missing API key");
    }

    try {
        if (isKoji) {
            try {
                const VisualGen = await import("./visualGen.js");
                const result = await VisualGen.generateWithKoji?.(finalPrompt, {
                    width: isBackground ? 1280 : 1024,
                    height: isBackground ? 720 : 1024,
                });
                if (result?.ok && result.dataUrl) {
                    try { window.UIE_lastImage = { ok: true, ms: Date.now() - startedAt, endpoint: "koji", mode: "koji" }; } catch (_) {}
                    return result.dataUrl;
                }
                throw new Error(result?.error || "Koji generation failed");
            } catch (kojiErr) {
                const msg = String(kojiErr?.message || kojiErr || "Koji unavailable");
                try { window.UIE_lastImage = { ok: false, ms: Date.now() - startedAt, endpoint: "koji", mode: "koji", error: msg.slice(0, 280) }; } catch (_) {}
                return await pollinationsFallback(msg);
            }
        }

        if (isPollinations) {
            const url = pollinationsUrlFor(finalPrompt);
            const hdr = {};
            if (apiKey) hdr.Authorization = `Bearer ${apiKey}`;
            const fx = await fetchWithCorsProxyFallback(url, { method: "GET", headers: hdr });
            if (!fx.response.ok) throw new Error("Pollinations API failed");
            const blob = await fx.response.blob();
            const dataUrl = await new Promise(resolve => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.readAsDataURL(blob);
            });
            try { window.UIE_lastImage = { ok: true, ms: Date.now() - startedAt, endpoint: "pollinations", mode: "pollinations" }; } catch (_) {}
            return dataUrl;
        }

        if (isGoogle) {
            if (!apiKey) return await pollinationsFallback("Missing Google API key");
            try {
                const out = await generateGoogleImagen({ apiKey, endpoint, model, promptText: finalPrompt });
                try { window.UIE_lastImage = { ok: true, ms: Date.now() - startedAt, endpoint, mode: "google" }; } catch (_) {}
                return out;
            } catch (e) {
                const msg = String(e?.message || e || "Google image request failed");
                try { window.UIE_lastImage = { ok: false, ms: Date.now() - startedAt, endpoint, mode: "google", error: msg.slice(0, 280) }; } catch (_) {}
                return await pollinationsFallback(msg);
            }
        }

        if (isComfy) {
            const comfyBase = String(img?.comfy?.base || "").trim();
            const comfyKey = resolveApiKey(String(img?.comfy?.key || apiKey || "").trim());
            const endpoint2 = comfyBase || endpoint;

            // Check if endpoint is local (127.0.0.1 or localhost)
            // If it is, we should assume the backend can reach it and try to proxy
            // to avoid CORS issues if the user is accessing UIE from a different IP/domain.
            const isLocalTarget = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(endpoint2);

            let wfRaw = String(img?.comfy?.workflow || "").trim();
            if (!wfRaw) {
                wfRaw = buildDefaultComfyWorkflowJson();
                try {
                    if (!s.image) s.image = {};
                    if (!s.image.comfy) s.image.comfy = {};
                    s.image.comfy.workflow = wfRaw;
                    saveSettings();
                } catch (_) {}
            }

            let ids = null;
            try {
                const baseGraph = parseComfyWorkflowRaw(wfRaw);
                ids = detectComfyNodeIds(baseGraph);
            } catch (_) {}

            // For local ComfyUI always use proxy-first to avoid CORS/403 from browser
            const useProxy = isLocalTarget;

            console.log("[UIE-Comfy] Starting request", {
                comfyBaseSetting: comfyBase,
                endpointUsed: endpoint2,
                isLocalTarget,
                useProxy,
                workflowSource: img?.comfy?.workflow ? "settings" : "default-fallback",
                workflowChars: wfRaw.length,
                detectedIds: ids,
                overrideIds: {
                    positive: String(img?.comfy?.positiveNodeId || "").trim(),
                    negative: String(img?.comfy?.negativeNodeId || "").trim(),
                    output: String(img?.comfy?.outputNodeId || "").trim(),
                },
                checkpoint: String(img?.comfy?.checkpoint || "").trim(),
                promptChars: finalPrompt.length,
            });

            const out = await generateComfyUI({
                endpoint: endpoint2,
                workflowRaw: wfRaw,
                promptText: finalPrompt,
                negativePrompt: negText,
                checkpoint: String(img?.comfy?.checkpoint || "").trim(),
                positiveNodeId: String(img?.comfy?.positiveNodeId || "").trim() || String(ids?.positiveNodeId || ""),
                negativeNodeId: String(img?.comfy?.negativeNodeId || "").trim() || String(ids?.negativeNodeId || ""),
                outputNodeId: String(img?.comfy?.outputNodeId || "").trim() || String(ids?.outputNodeId || ""),
                apiKey: comfyKey,
                forceProxy: useProxy,
                preferredWidth: isBackground ? 1280 : null,
                preferredHeight: isBackground ? 720 : null,
            });
            console.log("[UIE-Comfy] generateComfyUI finished", { gotImage: !!out, ms: Date.now() - startedAt });
            try { window.UIE_lastImage = { ok: !!out, ms: Date.now() - startedAt, endpoint: endpoint2, mode: "comfy" }; } catch (_) {}
            if (out) return out;
            console.warn("[UIE-Comfy] No image returned, falling back to Pollinations/SVG. Check window.UIE_lastImage and preceding [UIE-Comfy] logs for the real cause.");
            return await pollinationsFallback("ComfyUI returned no image");
        }

        if (isSdWebUi) {
            const sdCfg = img.sdwebui && typeof img.sdwebui === "object" ? img.sdwebui : {};
            const basePrefer = String(img.sdwebuiUrl || img.url || endpoint || "").trim();
            const sdUrl = normalizeSdTxt2ImgUrl(basePrefer);
            const steps = Number(sdCfg.steps) > 0 ? Number(sdCfg.steps) : 20;
            const cfg_scale = Number(sdCfg.cfg_scale ?? sdCfg.cfg) > 0 ? Number(sdCfg.cfg_scale ?? sdCfg.cfg) : 7;
            const width = isBackground
                ? (Number(sdCfg.backgroundWidth) > 0 ? Number(sdCfg.backgroundWidth) : 1280)
                : (Number(sdCfg.width) > 0 ? Number(sdCfg.width) : 512);
            const height = isBackground
                ? (Number(sdCfg.backgroundHeight) > 0 ? Number(sdCfg.backgroundHeight) : 720)
                : (Number(sdCfg.height) > 0 ? Number(sdCfg.height) : 512);
            const payload = {
                prompt: finalPrompt,
                negative_prompt: negText,
                steps,
                width,
                height,
                cfg_scale
            };
            const fx = await fetchWithCorsProxyFallback(sdUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const res = fx.response;
            if (!res.ok) {
                const err = await res.text();
                try { window.UIE_lastImage = { ok: false, ms: Date.now() - startedAt, endpoint: sdUrl, mode: "sdwebui", status: res.status, error: String(err || "").slice(0, 280) }; } catch (_) {}
                return await pollinationsFallback(`SDWebUI error ${res.status}`);
            }
            const data = await res.json();
            const imgB64 = Array.isArray(data?.images) ? String(data.images[0] || "") : "";
            if (!imgB64) return await pollinationsFallback("SDWebUI returned empty image");
            const out = imgB64.startsWith("data:image") ? imgB64 : `data:image/png;base64,${imgB64}`;
            try { window.UIE_lastImage = { ok: true, ms: Date.now() - startedAt, endpoint: sdUrl, mode: "sdwebui", status: 200 }; } catch (_) {}
            return out;
        }

        if (isStability) {
            if (!apiKey) return await pollinationsFallback("Missing Stability API key");
            try {
                const stObj = img.stability && typeof img.stability === "object" ? img.stability : {};
                const out = await generateStabilityV2Beta({
                    apiKey,
                    promptText: finalPrompt,
                    negativePrompt: negText,
                    stability: stObj
                });
                if (out) {
                    try { window.UIE_lastImage = { ok: true, ms: Date.now() - startedAt, endpoint: "stability-v2beta", mode: "stability" }; } catch (_) {}
                    return out;
                }
            } catch (e) {
                const msg = String(e?.message || e || "Stability request failed");
                try { window.UIE_lastImage = { ok: false, ms: Date.now() - startedAt, endpoint: "stability-v2beta", mode: "stability", error: msg.slice(0, 280) }; } catch (_) {}
                return await pollinationsFallback(msg);
            }
        }

        const headers = { "Content-Type": "application/json", "Accept": "application/json" };
        if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`;
            if (provider === "nvidia_nim" || endpoint.includes("nvidia.com")) {
                headers["x-api-key"] = apiKey;
                headers["api-key"] = apiKey;
            }
        }
        const backgroundSize = provider === "nanogpt"
            ? (img.nanoGptBackgroundSize || "1024x576")
            : (img.backgroundSize || "1536x1024");
        const size = String(options.size || (isBackground ? backgroundSize : (img.size || "1024x1024"))).trim();
        if (provider === "nanogpt" && apiKey) headers["x-api-key"] = apiKey;
        const requestBody = { model, prompt: finalPrompt, n: 1, size, response_format: "url" };
        if (provider === "nanogpt" && negText) requestBody.negative_prompt = negText;
        const fx = await fetchWithCorsProxyFallback(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(requestBody)
        });
        const res = fx.response;

        if (res.status === 402) {
            if (!apiKey) {
                try {
                    const data = await res.json();
                    handleNanoPayment(data);
                } catch (_) {}
            }
            const paymentMessage = provider === "nanogpt" && apiKey
                ? "NanoGPT rejected the API credentials or API billing access. Check that the saved NanoGPT API key belongs to your subscribed account."
                : "Payment Required";
            try { notify("warning", paymentMessage, "Image Gen"); } catch (_) {}
            if (window.toastr) toastr.warning(paymentMessage);
            return await pollinationsFallback("Upstream payment required");
        }

        if (!res.ok) {
            const err = await res.text();
            console.error("Image Gen Error:", err);
            try { window.UIE_lastImage = { ok: false, ms: Date.now() - startedAt, endpoint, mode: "openai", status: res.status, error: String(err || "").slice(0, 280), via: fx?.via || "" }; } catch (_) {}
            return await pollinationsFallback(`Image API error ${res.status}`);
        }

        const data = await res.json();
        const first = Array.isArray(data?.data) ? data.data[0] : null;
        const urlOut = String(first?.url || data?.url || "").trim();
        const b64 = String(first?.b64_json || first?.b64 || "").trim();
        if (urlOut) return normalizeGeneratedImageUrl(urlOut, endpoint);
        if (b64) return b64.startsWith("data:image") ? b64 : `data:image/png;base64,${b64}`;
        return await pollinationsFallback("Image API returned no image payload");
    } catch (e) {
        const msg = String(e?.message || e || "Image gen failed");
        try { console.error("Image Gen Exception:", { message: msg, endpoint, stack: String(e?.stack || "").slice(0, 3000) }); } catch (_) { console.error("Image Gen Exception:", msg); }
        try { notify("error", "Image Gen Error: " + msg.slice(0, 220), "UIE", "api"); } catch (_) {}
        try {
            window.UIE_lastImage = {
                ok: false,
                ms: 0,
                endpoint,
                mode: isComfy ? "comfy" : isSdWebUi ? "sdwebui" : isStability ? "stability" : "openai",
                status: 0,
                error: msg.slice(0, 280)
            };
        } catch (_) {}
        return await pollinationsFallback(msg);
    }
}

async function generateComfyUI({ endpoint, workflowRaw, promptText, negativePrompt, checkpoint, positiveNodeId, negativeNodeId, outputNodeId, apiKey, forceProxy, preferredWidth = null, preferredHeight = null }) {
    const s = getSettings();
    const comfy = s?.image?.comfy && typeof s.image.comfy === "object" ? s.image.comfy : {};
    const ez = comfy?.easy && typeof comfy.easy === "object" ? comfy.easy : {};

    const common = String(comfy?.common || "").trim();
    const commonNeg = String(comfy?.commonNeg || "").trim();
    if (common) promptText = `${common}\n${String(promptText || "")}`.trim();
    if (commonNeg) negativePrompt = `${commonNeg}\n${String(negativePrompt || "")}`.trim();

    const numOrNull = (v) => {
        const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
        return Number.isFinite(n) ? n : null;
    };

    const steps = numOrNull(ez.steps);
    const cfg = numOrNull(ez.cfg);
    const denoise = numOrNull(ez.denoise);
    const width = numOrNull(preferredWidth) ?? numOrNull(ez.width);
    const height = numOrNull(preferredHeight) ?? numOrNull(ez.height);
    const seedIn = numOrNull(ez.seed);
    const seed = Number.isFinite(seedIn) && seedIn >= 0 ? seedIn : Math.floor(Math.random() * 1e9);

    const sampler = String(comfy.sampler || "").trim();
    const scheduler = String(comfy.scheduler || "").trim();
    checkpoint = String(checkpoint || comfy.checkpoint || "").trim();

    try {
        if (comfyWorkflowCache.raw !== String(workflowRaw || "") || !comfyWorkflowCache.parsed) {
            const parsed = parseComfyWorkflowRaw(workflowRaw);
            comfyWorkflowCache = {
                raw: String(workflowRaw || ""),
                parsed,
                ids: detectComfyNodeIds(parsed),
                err: "",
                at: Date.now()
            };
        }
    } catch (e) {
        comfyWorkflowCache = { raw: String(workflowRaw || ""), parsed: null, ids: null, err: String(e?.message || e || ""), at: Date.now() };
    }

    const baseGraph = comfyWorkflowCache.parsed;
    if (!baseGraph) {
        console.error("[UIE-Comfy] Workflow JSON failed to parse:", comfyWorkflowCache.err || "(no error message)");
        try {
            window.UIE_lastImage = {
                ok: false,
                endpoint,
                mode: "comfy",
                status: 0,
                error: comfyWorkflowCache.err || "Could not parse the ComfyUI workflow JSON."
            };
        } catch (_) {}
        if (window.toastr && comfyWorkflowCache.err) toastr.error(comfyWorkflowCache.err, "", { timeOut: 8000 });
        return null;
    }

    const needsCheckpoint = comfyGraphNeedsCheckpoint(baseGraph);
    console.log("[UIE-Comfy] Workflow parsed OK", { nodeCount: Object.keys(baseGraph).length, needsCheckpoint, checkpointBeforeDetect: checkpoint });

    if (needsCheckpoint && !checkpoint) {
        try {
            const infoFx = await fetchWithCorsProxyFallback(
                `${String(endpoint || "").trim().replace(/\/+$/, "").replace(/\/prompt$/i, "")}/object_info`,
                { method: "GET", headers: comfyAuthHeaders(apiKey) },
                forceProxy ? { skipDirect: true } : {}
            );
            if (infoFx.response.ok) {
                const info = await infoFx.response.json();
                checkpoint = String(getComfyEnum(info, "CheckpointLoaderSimple", "ckpt_name")[0] || "").trim();
            }
        } catch (_) {}
    }
    if (needsCheckpoint && !checkpoint) {
        console.error("[UIE-Comfy] Aborting: graph has a CheckpointLoaderSimple node but no checkpoint was configured or auto-detected.");
        try {
            window.UIE_lastImage = {
                ok: false,
                endpoint,
                mode: "comfy",
                status: 0,
                error: "No ComfyUI checkpoint was selected or detected."
            };
        } catch (_) {}
        return null;
    }

    const ids = comfyWorkflowCache.ids || {};
    if (!positiveNodeId) positiveNodeId = String(ids.positiveNodeId || "");
    if (!negativeNodeId) negativeNodeId = String(ids.negativeNodeId || "");
    if (!outputNodeId) outputNodeId = String(ids.outputNodeId || "");
    console.log("[UIE-Comfy] Node IDs resolved", { positiveNodeId, negativeNodeId, outputNodeId, checkpoint });

    const normalizeBase = (u) => String(u || "").trim().replace(/\/+$/, "").replace(/\/prompt$/i, "");
    const base = normalizeBase(endpoint);
    const promptUrl = `${base}/prompt`;
    const viewUrl = `${base}/view`;
    const historyUrl = `${base}/history`;

    const deepReplace = (v) => {
        if (typeof v === "string") {
            return v
                .replace(/\{\{\s*(prompt|positive_prompt|positive)\s*\}\}/gi, String(promptText || ""))
                .replace(/\{\{\s*(negative_prompt|negative)\s*\}\}/gi, String(negativePrompt || ""))
                .replace(/\{\{\s*(checkpoint|ckpt|model)\s*\}\}/gi, String(checkpoint || ""))
                .replace(/\{\{\s*(width|w)\s*\}\}/gi, width === null ? "{{width}}" : String(width))
                .replace(/\{\{\s*(height|h)\s*\}\}/gi, height === null ? "{{height}}" : String(height))
                .replace(/\{\{\s*(size|resolution)\s*\}\}/gi, (width === null || height === null) ? "{{size}}" : `${width}x${height}`)
                .replace(/\{\{\s*(steps)\s*\}\}/gi, steps === null ? "{{steps}}" : String(steps))
                .replace(/\{\{\s*(scale|cfg|cfg_scale)\s*\}\}/gi, cfg === null ? "{{scale}}" : String(cfg))
                .replace(/\{\{\s*(denoise|denoising)\s*\}\}/gi, denoise === null ? "{{denoise}}" : String(denoise))
                .replace(/\{\{\s*(sampler)\s*\}\}/gi, String(sampler || ""))
                .replace(/\{\{\s*(scheduler)\s*\}\}/gi, String(scheduler || ""))
                .replace(/\{\{\s*(seed)\s*\}\}/gi, String(seed))
                .replace(/%prompt%/gi, String(promptText || ""))
                .replace(/%negative_prompt%/gi, String(negativePrompt || ""))
                .replace(/%model%/gi, String(checkpoint || ""))
                .replace(/%sampler%/gi, String(sampler || ""))
                .replace(/%scheduler%/gi, String(scheduler || ""))
                .replace(/%steps%/gi, steps === null ? "%steps%" : String(steps))
                .replace(/%scale%/gi, cfg === null ? "%scale%" : String(cfg))
                .replace(/%denoise%/gi, denoise === null ? "%denoise%" : String(denoise))
                .replace(/%width%/gi, width === null ? "%width%" : String(width))
                .replace(/%height%/gi, height === null ? "%height%" : String(height))
                .replace(/%size%/gi, (width === null || height === null) ? "%size%" : `${width}x${height}`)
                .replace(/%seed%/gi, String(seed));
        }
        if (Array.isArray(v)) return v.map(deepReplace);
        if (v && typeof v === "object") {
            const out = {};
            for (const [k, val] of Object.entries(v)) out[k] = deepReplace(val);
            return out;
        }
        return v;
    };

    const injectTextNodes = (graph) => {
        if (!graph || typeof graph !== "object") return graph;
        const g = graph;
        const setText = (nodeId, text) => {
            const n = g?.[nodeId];
            if (!n || typeof n !== "object") return false;
            if (!n.inputs || typeof n.inputs !== "object") n.inputs = {};
            if ("text" in n.inputs || n.class_type?.toLowerCase?.().includes("cliptextencode")) {
                n.inputs.text = String(text || "");
                return true;
            }
            return false;
        };

        let did = false;
        if (positiveNodeId) did = setText(positiveNodeId, promptText) || did;
        if (negativeNodeId) did = setText(negativeNodeId, negativePrompt) || did;
        if (did) return g;

        const clipNodes = Object.entries(g).filter(([_, n]) => /CLIPTextEncode/i.test(String(n?.class_type || "")));
        if (clipNodes.length) {
            const [id1] = clipNodes[0];
            setText(id1, promptText);
            if (clipNodes.length > 1) {
                const [id2] = clipNodes[1];
                setText(id2, negativePrompt);
            }
        }
        return g;
    };

    let graph = safeStructuredClone(baseGraph);
    graph = deepReplace(graph);
    graph = applyComfySettings(graph, { checkpoint, sampler, scheduler, steps, cfg, denoise, seed, width, height });
    graph = injectTextNodes(graph);

    try {
        for (const n of Object.values(graph || {})) {
            const ct = String(n?.class_type || "");
            if (!/KSampler/i.test(ct)) continue;
            if (!n.inputs || typeof n.inputs !== "object") n.inputs = {};
            const sd = Number(n.inputs.seed);
            if (!Number.isFinite(sd) || sd < 0) n.inputs.seed = seed;
        }
    } catch (_) {}

    const client_id = `uie_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}`;
    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
        headers["X-Api-Key"] = apiKey;
    }

    const proxyOpts = forceProxy ? { skipDirect: true } : {};
    console.log("[UIE-Comfy] POSTing to", promptUrl, { forceProxy, client_id });
    const fx = await fetchWithCorsProxyFallback(promptUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: graph, client_id })
    }, proxyOpts);

    const res = fx.response;
    console.log("[UIE-Comfy] /prompt response", { status: res.status, ok: res.ok, via: fx?.via, requestUrl: fx?.requestUrl });
    if (!res.ok) {
        const err = await res.text();
        console.error("[UIE-Comfy] ComfyUI Error:", err);
        try { window.UIE_lastImage = { ok: false, endpoint, mode: "comfy", status: res.status, error: String(err || res.statusText || "ComfyUI prompt failed").slice(0, 280), via: fx?.via }; } catch (_) {}
        if (window.toastr) toastr.error("ComfyUI prompt failed");
        return null;
    }
    const data = await res.json();
    console.log("[UIE-Comfy] /prompt response body", data);
    const prompt_id = String(data?.prompt_id || "");
    if (!prompt_id) {
        console.error("[UIE-Comfy] No prompt_id in response -- ComfyUI accepted the connection but did not queue a job.", data);
        return null;
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const deadline = Date.now() + 120_000;
    let pollCount = 0;

    while (Date.now() < deadline) {
        await sleep(1000);
        pollCount++;
        let h;
        try {
            const hrFx = await fetchWithCorsProxyFallback(`${historyUrl}/${encodeURIComponent(prompt_id)}`, { method: "GET" }, proxyOpts);
            const hr = hrFx.response;
            if (!hr.ok) { console.warn("[UIE-Comfy] history poll non-OK", hr.status); continue; }
            h = await hr.json();
        } catch (e) {
            console.warn("[UIE-Comfy] history poll fetch failed", e);
            continue;
        }
        const job = h?.[prompt_id];
        if (pollCount === 1 || pollCount % 5 === 0) {
            console.log(`[UIE-Comfy] poll #${pollCount}`, { found: !!job, status: job?.status, hasOutputs: !!job?.outputs });
        }
        const statusStr = String(job?.status?.status_str || "").toLowerCase();
        if (statusStr === "error") {
            console.error("[UIE-Comfy] ComfyUI execution errored", job.status);
            try { window.UIE_lastImage = { ok: false, endpoint, mode: "comfy", status: 0, error: `ComfyUI execution error: ${JSON.stringify(job.status.messages || job.status).slice(0, 260)}` }; } catch (_) {}
            return null;
        }
        const outputs = job?.outputs && typeof job.outputs === "object" ? job.outputs : null;
        if (!outputs) continue;

        const pickFromNode = (nodeId) => {
            const o = outputs?.[nodeId];
            const imgs = Array.isArray(o?.images) ? o.images : [];
            return imgs[0];
        };

        let target = null;
        if (outputNodeId) target = pickFromNode(outputNodeId);
        if (!target) {
            for (const k of Object.keys(outputs)) {
                target = pickFromNode(k);
                if (target) break;
            }
        }

        if (target) {
            const fname = target.filename;
            const sub = target.subfolder;
            const type = target.type;
            const query = `filename=${encodeURIComponent(fname)}&subfolder=${encodeURIComponent(sub)}&type=${encodeURIComponent(type)}`;
            const url = `${viewUrl}?${query}`;
            console.log("[UIE-Comfy] Found output image, fetching", { fname, sub, type, pollCount });
            const r = await fetchWithCorsProxyFallback(url, { method: "GET" }, proxyOpts);
            const blob = await r.response.blob();
            return new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
        }
    }
    console.error(`[UIE-Comfy] Timed out after ${pollCount} polls (120s) waiting for prompt_id=${prompt_id} to produce outputs.`);
    return null;
}

export async function populateImageSettings(baseUrl, ckSel, saSel, scSel, apiKeyRaw = "") {
    if (ckSel) ckSel.innerHTML = `<option value="">Loading…</option>`;
    if (saSel) saSel.innerHTML = `<option value="">Loading…</option>`;
    if (scSel) scSel.innerHTML = `<option value="">Loading…</option>`;

    const s = getSettings();
    const det = await detectBackend(baseUrl, apiKeyRaw);

    if (det.type === "comfy") {
        const info = det.info;
        const checkpoints = getComfyEnum(info, "CheckpointLoaderSimple", "ckpt_name");
        const samplers = getComfyEnum(info, "KSampler", "sampler_name");
        const schedulers = getComfyEnum(info, "KSampler", "scheduler");

        fillSelect(ckSel, checkpoints, s.image?.comfy?.checkpoint);
        fillSelect(saSel, samplers, s.image?.comfy?.sampler);
        fillSelect(scSel, schedulers, s.image?.comfy?.scheduler);
        if (window.toastr) toastr.success(`Connected to ComfyUI. Loaded ${checkpoints.length} checkpoint(s).`);
        return { ok: true, type: "comfy", checkpoints, samplers, schedulers };
    }

    if (det.type === "a1111") {
        const opts = await loadA1111(baseUrl, apiKeyRaw);
        fillSelect(ckSel, opts.checkpoints, s.image?.comfy?.checkpoint);
        fillSelect(saSel, opts.samplers, s.image?.comfy?.sampler);
        fillSelect(scSel, opts.schedulers.length ? opts.schedulers : ["karras","sgm_uniform","exponential","ddim_uniform","normal","beta","beta57"], s.image?.comfy?.scheduler);
        if (window.toastr) toastr.success("Connected to A1111/SD.Next!");
        return { ok: true, type: "a1111", ...opts };
    }

    // Unknown backend
    const errMsg = `<option value="">(Couldn’t detect backend)</option>`;
    if (ckSel) ckSel.innerHTML = errMsg;
    if (saSel) saSel.innerHTML = errMsg;
    if (scSel) scSel.innerHTML = errMsg;
    if (window.toastr) toastr.warning("Could not detect ComfyUI or A1111 at that URL.");
    return { ok: false, type: "unknown", error: "Could not detect ComfyUI or A1111 at that URL." };
}

function comfyAuthHeaders(apiKeyRaw = "") {
    const apiKey = resolveApiKey(String(apiKeyRaw || "").trim());
    return apiKey ? { Authorization: `Bearer ${apiKey}`, "X-Api-Key": apiKey } : {};
}

export async function testComfyConnection(baseUrl, apiKeyRaw = "") {
    const base = String(baseUrl || "").trim().replace(/\/+$/, "").replace(/\/prompt$/i, "");
    if (!base) return { ok: false, type: "unknown", error: "Enter a ComfyUI URL first." };
    const headers = comfyAuthHeaders(apiKeyRaw);
    try {
        const statsFx = await fetchWithCorsProxyFallback(`${base}/system_stats`, { method: "GET", headers });
        if (!statsFx.response.ok) {
            return { ok: false, type: "unknown", status: statsFx.response.status, error: `ComfyUI system_stats returned HTTP ${statsFx.response.status}.` };
        }
        const infoFx = await fetchWithCorsProxyFallback(`${base}/object_info`, { method: "GET", headers });
        if (!infoFx.response.ok) {
            return { ok: false, type: "comfy", status: infoFx.response.status, error: `ComfyUI object_info returned HTTP ${infoFx.response.status}.` };
        }
        const info = await infoFx.response.json();
        return {
            ok: true,
            type: "comfy",
            via: String(statsFx.via || ""),
            checkpoints: getComfyEnum(info, "CheckpointLoaderSimple", "ckpt_name"),
            samplers: getComfyEnum(info, "KSampler", "sampler_name"),
            schedulers: getComfyEnum(info, "KSampler", "scheduler")
        };
    } catch (e) {
        return { ok: false, type: "unknown", error: String(e?.message || e || "ComfyUI connection failed") };
    }
}

async function detectBackend(url, apiKeyRaw = "") {
    const headers = comfyAuthHeaders(apiKeyRaw);
    try {
        const r = await fetchWithCorsProxyFallback(`${url}/system_stats`, { method: "GET", headers });
        if(r.response.ok) return { type: "comfy", info: await fetchObjectInfo(url, apiKeyRaw) };
    } catch(_) {}

    try {
        const r = await fetchWithCorsProxyFallback(`${url}/sdapi/v1/options`, { method: "GET", headers });
        if(r.response.ok) return { type: "a1111" };
    } catch(_) {}

    return { type: "unknown" };
}

async function fetchObjectInfo(url, apiKeyRaw = "") {
    try {
        const r = await fetchWithCorsProxyFallback(`${url}/object_info`, { method: "GET", headers: comfyAuthHeaders(apiKeyRaw) });
        return await r.response.json();
    } catch(e) { return {}; }
}

async function loadA1111(url, apiKeyRaw = "") {
    const out = { checkpoints: [], samplers: [], schedulers: [] };
    const headers = comfyAuthHeaders(apiKeyRaw);
    try {
        const r1 = await fetchWithCorsProxyFallback(`${url}/sdapi/v1/sd-models`, { method: "GET", headers });
        const d1 = await r1.response.json();
        out.checkpoints = d1.map(x => x.title);
    } catch(_) {}
    try {
        const r2 = await fetchWithCorsProxyFallback(`${url}/sdapi/v1/samplers`, { method: "GET", headers });
        const d2 = await r2.response.json();
        out.samplers = d2.map(x => x.name);
    } catch(_) {}
    return out;
}

function getComfyEnum(info, classType, field) {
    try {
        const def = info?.[classType]?.input?.required?.[field];
        if(Array.isArray(def) && Array.isArray(def[0])) return def[0];
    } catch(_) {}
    return [];
}

function fillSelect(sel, items, selected) {
    if(!sel) return;
    sel.innerHTML = "";
    items.forEach(i => {
        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent = i;
        if(i === selected) opt.selected = true;
        sel.appendChild(opt);
    });
}

export function initImageUi() {
    const providerSelectors = "#uie-img-provider, #uie-sw-img-provider";
    const urlSelectors = "#uie-img-url, #uie-img-url-adv, #uie-sw-img-url";
    const keySelectors = "#uie-img-key, #uie-img-key-adv, #uie-sw-img-key";
    const modelSelectors = "#uie-img-model, #uie-img-model-adv, #uie-sw-img-model";
    const modelSelectSelectors = "#uie-img-model-select, #uie-sw-img-model-select";

    const refreshUi = () => {
        const val = $("#uie-img-provider").val() || $("#uie-sw-img-provider").val() || "openai";
        $("#uie-img-openai-block, #uie-sw-img-openai-block").hide();
        $("#uie-img-comfy-block, #uie-sw-img-comfy-block").hide();
        $("#uie-img-sdwebui-block, #uie-sw-img-sdwebui-block").hide();
        $("#uie-img-pollinations-help, #uie-sw-img-pollinations-help").hide();

        if (val === "comfy") $("#uie-img-comfy-block, #uie-sw-img-comfy-block").show();
        else if (val === "sdwebui") $("#uie-img-sdwebui-block, #uie-sw-img-sdwebui-block").show();
        else $("#uie-img-openai-block, #uie-sw-img-openai-block").show();
        if (val === "pollinations") $("#uie-img-pollinations-help, #uie-sw-img-pollinations-help").show();
    };

    const applySettingsToInputs = () => {
        const s = getSettings();
        const img = s.image || {};
        if (typeof img.enabled === "boolean") $("#uie-img-enable").prop("checked", img.enabled);
        if (typeof img.enabled === "boolean") $("#uie-sw-img-enable").prop("checked", img.enabled);
        applyProviderStateToInputs(img.provider || "openai", getStoredProviderState(img, img.provider || "openai"));
        if (img.negativePrompt) $("#uie-img-negative").val(img.negativePrompt);
        const sdUrlPref = String(img.sdwebuiUrl || img.sdwebui?.url || "").trim();
        if (sdUrlPref) $("#uie-img-sdwebui-url").val(sdUrlPref.replace(/\/sdapi\/v1\/txt2img\s*$/i, ""));
        if (img.comfy) {
            if (img.comfy.base) $("#uie-img-comfy-base").val(img.comfy.base);
            if (img.comfy.key) $("#uie-img-comfy-key").val(img.comfy.key);
            if (img.comfy.checkpoint) $("#uie-img-comfy-ckpt").val(img.comfy.checkpoint);
            if (img.comfy.quality) $("#uie-img-comfy-quality").val(img.comfy.quality);
            if (img.comfy.sampler) $("#uie-img-comfy-sampler").val(img.comfy.sampler);
            if (img.comfy.scheduler) $("#uie-img-comfy-scheduler").val(img.comfy.scheduler);
            if (img.comfy.common) $("#uie-img-comfy-common").val(img.comfy.common);
            if (img.comfy.commonNeg) $("#uie-img-comfy-common-neg").val(img.comfy.commonNeg);
            if (img.comfy.workflow) $("#uie-img-comfy-workflow").val(img.comfy.workflow);
            if (img.comfy.positiveNodeId) $("#uie-img-comfy-posnode").val(img.comfy.positiveNodeId);
            if (img.comfy.negativeNodeId) $("#uie-img-comfy-negnode").val(img.comfy.negativeNodeId);
            if (img.comfy.outputNodeId) $("#uie-img-comfy-outnode").val(img.comfy.outputNodeId);
        }
        $("#uie-img-url-adv").val(img.url || "");
        $("#uie-img-key-adv").val(img.key || "");
        $("#uie-img-model-adv").val(img.model || "");
        $("#uie-img-size").val(img.size || "1024x1024");
        $("#uie-sw-img-size").val(img.size || "1024x1024");

        const feats = (img.features && typeof img.features === "object") ? img.features : {};
        $("#uie-img-map, #uie-sw-img-map").prop("checked", feats.map !== false);
        $("#uie-img-doll, #uie-sw-img-doll").prop("checked", feats.doll !== false);
        $("#uie-img-social, #uie-sw-img-social").prop("checked", feats.social !== false);
        $("#uie-img-phone-bg, #uie-sw-img-phone-bg").prop("checked", feats.phoneBg !== false);
        $("#uie-img-msg, #uie-sw-img-msg").prop("checked", feats.msg !== false);
        $("#uie-img-party, #uie-sw-img-party").prop("checked", feats.party !== false);
        $("#uie-img-items, #uie-sw-img-items").prop("checked", feats.items !== false);
    };

    const syncSetting = (updater) => {
        const s = getSettings();
        if (!s.image) s.image = {};
        updater(s.image);
        saveSettings();
    };

    const ensureProviderStore = (img) => {
        if (!img.providerSettings || typeof img.providerSettings !== "object") img.providerSettings = {};
        if (!img.providerKeys || typeof img.providerKeys !== "object") img.providerKeys = {};
        return img.providerSettings;
    };

    const getStoredProviderState = (img, providerRaw = "") => {
        const provider = normalizeImageProvider(providerRaw || img?.provider || "openai");
        const preset = imageProviderPreset(provider);
        const store = ensureProviderStore(img || {});
        const saved = store[provider] && typeof store[provider] === "object" ? store[provider] : {};
        const activeProvider = normalizeImageProvider(img?.provider || provider);
        const sameProvider = activeProvider === provider;
        const legacyKey = provider === "pollinations"
            ? String(img?.pollinationsKey || saved.key || "").trim()
            : provider === "comfy"
                ? String(img?.comfy?.key || saved.key || "").trim()
                : String(img?.providerKeys?.[provider] || saved.key || (sameProvider ? img?.key : "") || "").trim();
        return {
            provider,
            url: normalizeEndpoint(String(saved.url || (sameProvider ? img?.url : "") || preset.url || "").trim(), provider),
            model: String(saved.model || (sameProvider ? img?.model : "") || preset.model || "").trim(),
            key: legacyKey,
        };
    };

    const persistProviderState = (img, providerRaw, patch = {}) => {
        const provider = normalizeImageProvider(providerRaw || img?.provider || "openai");
        const store = ensureProviderStore(img);
        const current = getStoredProviderState(img, provider);
        const next = {
            ...current,
            ...patch,
            provider,
        };
        next.url = normalizeEndpoint(String(next.url || imageProviderPreset(provider).url || "").trim(), provider);
        next.model = String(next.model || imageProviderPreset(provider).model || "").trim();
        next.key = String(next.key || "").trim();
        store[provider] = { url: next.url, model: next.model, key: next.key };
        img.provider = provider;
        img.url = next.url;
        img.model = next.model;
        img.key = next.key;
        img.providerKeys[provider] = next.key;
        if (provider === "pollinations") img.pollinationsKey = next.key;
        if (provider === "comfy") {
            if (!img.comfy || typeof img.comfy !== "object") img.comfy = {};
            img.comfy.key = next.key;
            img.comfy.base = String(img.comfy.base || next.url || "").trim();
        }
        return next;
    };

    const setImageModelOptions = (models = [], current = "") => {
        const normalized = [];
        for (const entry of models || []) {
            if (!entry) continue;
            if (typeof entry === "string") normalized.push({ id: entry, label: entry });
            else normalized.push({ id: String(entry.id || "").trim(), label: String(entry.label || entry.id || "").trim() });
        }
        const currentValue = String(current || "").trim();
        const $sels = $(modelSelectSelectors);
        $sels.each(function () {
            const sel = $(this);
            sel.empty();
            sel.append(`<option value="">(pick model)</option>`);
            for (const item of normalized) {
                if (!item.id && item.label === "(uses endpoint engine)") continue;
                sel.append(`<option value="${item.id}">${item.label}</option>`);
            }
            sel.append(`<option value="__custom__">Custom...</option>`);
            if (currentValue && normalized.some((item) => item.id === currentValue)) sel.val(currentValue);
            else if (currentValue) sel.val("__custom__");
            else sel.val("");
        });
    };

    const buildCustomOnlyModelOptions = (current = "") => {
        const value = String(current || "").trim();
        return value ? [{ id: value, label: `${value} (Saved)` }] : [];
    };

    const applyProviderStateToInputs = (providerRaw = "", stateOverride = null) => {
        const s = getSettings();
        const provider = normalizeImageProvider(providerRaw || $(providerSelectors).first().val() || s.image?.provider || "openai");
        const state = stateOverride || getStoredProviderState(s.image || {}, provider);
        $(providerSelectors).val(provider);
        $(urlSelectors).val(state.url || "");
        $(keySelectors).val(state.key || "");
        $(modelSelectors).val(state.model || "");
        setImageModelOptions(IMAGE_PROVIDER_MODELS[provider] || [], state.model || imageProviderPreset(provider).model || "");
        if (state.model) {
            if ($(modelSelectSelectors).find(`option[value='${state.model.replace(/'/g, "\\'")}']`).length) $(modelSelectSelectors).val(state.model);
            else $(modelSelectSelectors).val("__custom__");
        }
        refreshUi();
    };

    const coerceNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };

    const pickFirst = (...vals) => {
        for (const v of vals) {
            if (v === undefined || v === null) continue;
            if (typeof v === "string" && !v.trim()) continue;
            return v;
        }
        return null;
    };

    const readFromLocalStorage = () => {
        try {
            const keys = Object.keys(localStorage || {});
            const candidates = keys
                .filter(k => /comfy|comfyui|stable[_-]?diffusion|stablediffusion|sd[_-]?settings|sd[_-]?config|image[_-]?gen/i.test(String(k)))
                .slice(0, 40);
            for (const k of candidates) {
                let raw = "";
                try { raw = localStorage.getItem(k); } catch (_) { raw = ""; }
                if (!raw || raw.length < 2) continue;
                let obj = null;
                try { obj = JSON.parse(raw); } catch (_) { obj = null; }
                if (!obj || typeof obj !== "object") continue;
                const asStr = JSON.stringify(obj);
                if (!/8188|comfy|workflow|sampler|scheduler|cfg|denoise|checkpoint|ckpt/i.test(asStr)) continue;
                return obj;
            }
        } catch (_) {}
        return null;
    };

    const bestEffortExtract = (root) => {
        const out = {};
        if (!root || typeof root !== "object") return out;

        const comfy =
            root.comfy ||
            root.comfyui ||
            root.ComfyUI ||
            root.comfyUi ||
            root.stable_diffusion ||
            root.stablediffusion ||
            root.sd ||
            root.sdSettings ||
            root.sd_settings ||
            root.image ||
            root.imageGen ||
            root.image_generation ||
            null;

        const r = (comfy && typeof comfy === "object") ? comfy : root;

        out.base = pickFirst(r.base, r.base_url, r.baseUrl, r.url, r.endpoint, r.host, r.server, r.address);
        out.key = pickFirst(r.key, r.api_key, r.apiKey, r.token, r.auth, r.authorization);
        out.checkpoint = pickFirst(r.checkpoint, r.ckpt, r.ckpt_name, r.model, r.model_name);
        out.sampler = pickFirst(r.sampler, r.sampler_name, r.sampling_method, r.samplingMethod);
        out.scheduler = pickFirst(r.scheduler, r.schedule, r.scheduling, r.sigma_schedule);
        out.steps = pickFirst(r.steps, r.sampling_steps, r.samplingSteps);
        out.cfg = pickFirst(r.cfg, r.cfg_scale, r.cfgScale, r.guidance_scale, r.guidanceScale);
        out.width = pickFirst(r.width, r.w, r.image_width, r.imageWidth);
        out.height = pickFirst(r.height, r.h, r.image_height, r.imageHeight);
        out.denoise = pickFirst(r.denoise, r.denoising_strength, r.denoisingStrength, r.strength);
        out.seed = pickFirst(r.seed, r.random_seed, r.randomSeed);
        out.common = pickFirst(r.common, r.common_prompt, r.commonPrompt, r.prompt_prefix, r.promptPrefix);
        out.commonNeg = pickFirst(r.commonNeg, r.common_negative, r.commonNegative, r.negative_prefix, r.negativePrefix);
        out.negativePrompt = pickFirst(r.negativePrompt, r.negative_prompt, r.negativePromptText, r.negative);
        out.workflow = pickFirst(r.workflow, r.workflow_json, r.workflowJson);

        return out;
    };

    $(document).off("change.uieImg").on("change.uieImg", "#uie-img-provider, #uie-sw-img-provider", function() {
        const val = String($(this).val() || "openai");
        $(providerSelectors).val(val);
        syncSetting((img) => {
            const state = getStoredProviderState(img, val);
            persistProviderState(img, val, state);
        });
        applyProviderStateToInputs(val);
    });


    $(document).off("change.uieImgEnable").on("change.uieImgEnable", "#uie-img-enable, #uie-sw-img-enable", function() {
        const on = $(this).is(":checked");
        $("#uie-img-enable, #uie-sw-img-enable").prop("checked", on);
        syncSetting((img) => { img.enabled = on; });
    });

    $(document).off("input.uieImgUrl change.uieImgUrl").on("input.uieImgUrl change.uieImgUrl", "#uie-img-url, #uie-img-url-adv, #uie-sw-img-url", function() {
        const val = String($(this).val() || "").trim();
        $(urlSelectors).val(val);
        syncSetting((img) => {
            persistProviderState(img, $(providerSelectors).first().val() || "openai", { url: val });
        });
    });

    $(document).off("input.uieImgKey change.uieImgKey").on("input.uieImgKey change.uieImgKey", "#uie-img-key, #uie-img-key-adv, #uie-sw-img-key", function() {
        const val = String($(this).val() || "").trim();
        $(keySelectors).val(val);
        syncSetting((img) => {
            persistProviderState(img, $(providerSelectors).first().val() || "openai", { key: val });
        });
    });

    $(document).off("change.uieImgModelSelect").on("change.uieImgModelSelect", "#uie-img-model-select, #uie-sw-img-model-select", function() {
        const val = String($(this).val() || "").trim();
        if (!val || val === "__custom__") return;
        $(modelSelectors).val(val);
        $(modelSelectSelectors).val(val);
        syncSetting((img) => {
            persistProviderState(img, $(providerSelectors).first().val() || "openai", { model: val });
        });
    });

    $(document).off("input.uieImgModel change.uieImgModel").on("input.uieImgModel change.uieImgModel", "#uie-img-model, #uie-img-model-adv, #uie-sw-img-model", function() {
        const val = String($(this).val() || "").trim();
        if (val) {
            if ($("#uie-img-model-select option[value='" + val + "']").length) $("#uie-img-model-select").val(val);
            else $("#uie-img-model-select").val("__custom__");
            if ($("#uie-sw-img-model-select option[value='" + val + "']").length) $("#uie-sw-img-model-select").val(val);
            else $("#uie-sw-img-model-select").val("__custom__");
        }
        $(modelSelectors).val(val);
        syncSetting((img) => {
            persistProviderState(img, $(providerSelectors).first().val() || "openai", { model: val });
        });
    });

    $(document).off("input.uieImgNeg change.uieImgNeg").on("input.uieImgNeg change.uieImgNeg", "#uie-img-negative, #uie-sw-img-negative", function() {
        const val = String($(this).val() || "").trim();
        $("#uie-img-negative, #uie-sw-img-negative").val(val);
        syncSetting((img) => { img.negativePrompt = val; });
    });

    $(document).off("change.uieImgSize").on("change.uieImgSize", "#uie-img-size, #uie-sw-img-size", function() {
        const val = String($(this).val() || "1024x1024").trim();
        syncSetting((img) => { img.size = val; });
    });

    $(document).off("input.uieImgSd change.uieImgSd").on("input.uieImgSd change.uieImgSd", "#uie-img-sdwebui-url", function() {
        const val = String($(this).val() || "").trim();
        syncSetting((img) => { img.sdwebuiUrl = val; });
    });

    $(document).off("input.uieImgComfy change.uieImgComfy").on("input.uieImgComfy change.uieImgComfy", "#uie-img-comfy-base, #uie-img-comfy-key, #uie-img-comfy-ckpt, #uie-img-comfy-quality, #uie-img-comfy-sampler, #uie-img-comfy-scheduler, #uie-img-comfy-common, #uie-img-comfy-common-neg, #uie-img-comfy-workflow, #uie-img-comfy-posnode, #uie-img-comfy-negnode, #uie-img-comfy-outnode, #uie-img-comfy-steps, #uie-img-comfy-cfg, #uie-img-comfy-width, #uie-img-comfy-height, #uie-img-comfy-denoise, #uie-img-comfy-seed", function() {
        const s = getSettings();
        if (!s.image) s.image = {};
        if (!s.image.comfy) s.image.comfy = {};
        if (!s.image.comfy.easy) s.image.comfy.easy = {};
        s.image.comfy.base = String($("#uie-img-comfy-base").val() || "").trim();
        s.image.comfy.key = String($("#uie-img-comfy-key").val() || "").trim();
        s.image.comfy.checkpoint = String($("#uie-img-comfy-ckpt").val() || "").trim();
        s.image.comfy.quality = String($("#uie-img-comfy-quality").val() || "").trim();
        s.image.comfy.sampler = String($("#uie-img-comfy-sampler").val() || "").trim();
        s.image.comfy.scheduler = String($("#uie-img-comfy-scheduler").val() || "").trim();
        s.image.comfy.common = String($("#uie-img-comfy-common").val() || "").trim();
        s.image.comfy.commonNeg = String($("#uie-img-comfy-common-neg").val() || "").trim();
        s.image.comfy.workflow = String($("#uie-img-comfy-workflow").val() || "").trim();
        s.image.comfy.positiveNodeId = String($("#uie-img-comfy-posnode").val() || "").trim();
        s.image.comfy.negativeNodeId = String($("#uie-img-comfy-negnode").val() || "").trim();
        s.image.comfy.outputNodeId = String($("#uie-img-comfy-outnode").val() || "").trim();
        s.image.comfy.easy.steps = String($("#uie-img-comfy-steps").val() || "").trim();
        s.image.comfy.easy.cfg = String($("#uie-img-comfy-cfg").val() || "").trim();
        s.image.comfy.easy.width = String($("#uie-img-comfy-width").val() || "").trim();
        s.image.comfy.easy.height = String($("#uie-img-comfy-height").val() || "").trim();
        s.image.comfy.easy.denoise = String($("#uie-img-comfy-denoise").val() || "").trim();
        s.image.comfy.easy.seed = String($("#uie-img-comfy-seed").val() || "").trim();
        saveSettings();
    });

    $(document).off("click.uieImgComfyApply").on("click.uieImgComfyApply", "#uie-img-comfy-apply", function(e) {
        e.preventDefault();
        e.stopPropagation();

        const s = getSettings();
        if (!s.image) s.image = {};
        if (!s.image.comfy) s.image.comfy = {};
        if (!s.image.comfy.easy) s.image.comfy.easy = {};

        const base = String($("#uie-img-comfy-base").val() || "").trim();
        if (!base) {
            try { window.toastr?.warning?.("Enter ComfyUI URL first"); } catch (_) {}
            return;
        }

        const q = String($("#uie-img-comfy-quality").val() || "balanced");
        const defaults = q === "fast" ? { w: 512, h: 512, steps: 16 } : q === "hq" ? { w: 1024, h: 1024, steps: 32 } : { w: 768, h: 768, steps: 24 };
        if (!String($("#uie-img-comfy-width").val() || "").trim()) $("#uie-img-comfy-width").val(String(defaults.w));
        if (!String($("#uie-img-comfy-height").val() || "").trim()) $("#uie-img-comfy-height").val(String(defaults.h));
        if (!String($("#uie-img-comfy-steps").val() || "").trim()) $("#uie-img-comfy-steps").val(String(defaults.steps));
        if (!String($("#uie-img-comfy-cfg").val() || "").trim()) $("#uie-img-comfy-cfg").val("7");
        if (!String($("#uie-img-comfy-denoise").val() || "").trim()) $("#uie-img-comfy-denoise").val("1");
        if (!String($("#uie-img-comfy-seed").val() || "").trim()) $("#uie-img-comfy-seed").val("-1");

        s.image.provider = "comfy";
        s.image.url = base;
        s.image.comfy.base = base;

        if (!String(s.image.comfy.workflow || "").trim()) {
            s.image.comfy.workflow = buildDefaultComfyWorkflowJson();
        }

        // Let auto-detect handle these unless the user explicitly set them.
        if (!String(s.image.comfy.positiveNodeId || "").trim()) s.image.comfy.positiveNodeId = "";
        if (!String(s.image.comfy.negativeNodeId || "").trim()) s.image.comfy.negativeNodeId = "";
        if (!String(s.image.comfy.outputNodeId || "").trim()) s.image.comfy.outputNodeId = "";

        // Trigger the shared sync handler
        $("#uie-img-provider").val("comfy");
        $("#uie-img-url").val(base);
        $("#uie-img-comfy-workflow").val(String(s.image.comfy.workflow || ""));
        $("#uie-img-comfy-base, #uie-img-comfy-quality, #uie-img-comfy-steps, #uie-img-comfy-cfg, #uie-img-comfy-width, #uie-img-comfy-height, #uie-img-comfy-denoise, #uie-img-comfy-seed").trigger("change");
        saveSettings();
        refreshUi();
        try { window.toastr?.success?.("Applied ComfyUI Easy Setup"); } catch (_) {}
    });

    $(document).off("click.uieImgTest").on("click.uieImgTest", "#uie-img-test, #uie-sw-img-test", async function(e) {
        e.preventDefault();
        e.stopPropagation();

        const out = await generateImageAPI("[UIE_LOCKED] A cinematic fantasy illustration of a traveler in a lantern-lit forest, ultra-detailed, sharp focus");
        if (!out) {
            const last = window.UIE_lastImage;
            const err = last?.error ? String(last.error).slice(0, 120) : "Unknown error";
            const hint = last?.mode === "comfy" ? " For ComfyUI, enable a CORS proxy or run ComfyUI with --allow-cors."
                : "";
            try { window.toastr?.error?.(`Test image failed: ${err}${hint}`); } catch (_) {}
            return;
        }
        const id = "uie-img-test-modal";
        $("#" + id).remove();
        const html = `
            <div id="${id}" style="position:fixed; inset:0; z-index:2147483660; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center;">
                <div style="background:#111; border:1px solid rgba(255,255,255,0.2); padding:12px; border-radius:12px; width:min(820px, 94vw); max-height:92vh; overflow:auto;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
                        <div style="color:#fff; font-weight:700;">UIE Image Test</div>
                        <button style="background:#333; border:1px solid #555; color:#fff; padding:6px 10px; border-radius:8px; cursor:pointer;" onclick="$('#${id}').remove()">Close</button>
                    </div>
                    <img src="${String(out)}" style="width:100%; height:auto; border-radius:10px; display:block;" />
                </div>
            </div>
        `;
        $("body").append(html);
    });

    $(document).off("click.uieImgRefresh").on("click.uieImgRefresh", "#uie-img-comfy-ckpt-refresh", function(e) {
        e.preventDefault();
        const url = $("#uie-img-comfy-base").val();
        if(!url) return toastr.warning("Enter ComfyUI URL first");
        $("#uie-img-comfy-status").text("Detecting...");
        populateImageSettings(url,
            document.getElementById("uie-img-comfy-ckpt"),
            document.getElementById("uie-img-comfy-sampler"),
            document.getElementById("uie-img-comfy-scheduler"),
            String($("#uie-img-comfy-key").val() || "").trim()
        ).then((result) => {
            if (result?.ok && result.type === "comfy") {
                $("#uie-img-comfy-status").text(`Connected: ${result.checkpoints.length} checkpoint(s), ${result.samplers.length} sampler(s)`);
            } else {
                $("#uie-img-comfy-status").text("Connection failed");
            }
        });
    });

    $(document).off("change.uieImgComfyUrlPreset").on("change.uieImgComfyUrlPreset", "#uie-img-comfy-url-preset", function () {
        const value = String($(this).val() || "custom");
        if (value !== "custom") $("#uie-img-comfy-base").val(value).trigger("change");
        $("#uie-img-comfy-status").text("Not tested");
    });
    $(document).off("input.uieImgComfyUrl").on("input.uieImgComfyUrl", "#uie-img-comfy-base", function () {
        const value = String($(this).val() || "").trim().replace(/\/+$/, "");
        $("#uie-img-comfy-url-preset").val(["http://127.0.0.1:8188", "http://127.0.0.1:8189"].includes(value) ? value : "custom");
        $("#uie-img-comfy-status").text("Not tested");
    });

    const applyImgPreset = () => {
        const p = normalizeImageProvider($("#uie-img-preset").val() || $("#uie-sw-img-preset").val() || "openai");
        const preset = imageProviderPreset(p);
        syncSetting((img) => {
            persistProviderState(img, p, { url: preset.url, model: preset.model });
        });
        applyProviderStateToInputs(p);
        if(window.toastr) toastr.success(`Applied ${p === "google" ? "Google Imagen" : p === "nvidia_nim" ? "NVIDIA NIM" : p.charAt(0).toUpperCase() + p.slice(1)} Preset`);
    };

    $(document).off("click.uieImgPreset").on("click.uieImgPreset", "#uie-img-preset-apply, #uie-sw-img-preset-apply", function(e) {
        e.preventDefault();
        e.stopPropagation();
        applyImgPreset();
    });
    // Auto-apply on change as well
    $(document).off("change.uieImgPreset").on("change.uieImgPreset", "#uie-img-preset, #uie-sw-img-preset", function(e) {
        e.preventDefault();
        e.stopPropagation();
        applyImgPreset();
    });

    // Refresh Image Models
    $(document).off("click.uieImgModelRef").on("click.uieImgModelRef", "#uie-img-model-refresh, #uie-sw-img-model-refresh", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const icon = $(this).find("i");
        icon.addClass("fa-spin");

        const s = getSettings();
        const provider = normalizeImageProvider($(providerSelectors).first().val() || s.image?.provider || "openai");
        const url = String($(urlSelectors).first().val() || s.image?.url || "").trim();
        const key = String($(keySelectors).first().val() || s.image?.key || "").trim();

        try {
            const current = String($(modelSelectors).first().val() || s.image?.model || "").trim();
            const presetModels = IMAGE_PROVIDER_MODELS[provider];
            if (Array.isArray(presetModels) && presetModels.length) {
                setImageModelOptions(presetModels, current);
                if (window.toastr) toastr.success(`Loaded ${presetModels.length} ${provider} image models.`, "Image Gen");
                return;
            }
            const customModels = buildCustomOnlyModelOptions(current);
            setImageModelOptions(customModels, current);
            if (window.toastr) toastr.info("No built-in model catalog for this image provider. Use the custom model field.", "Image Gen");
            return;
            if (res.ok && res.models) {
                const current = String($("#uie-img-model").val() || $("#uie-sw-img-model").val() || s.image?.model || "").trim();
                const sel = $("#uie-img-model-select, #uie-sw-img-model-select");
                sel.empty();
                sel.append(`<option value="">(pick model)</option>`);
                let found = false;
                res.models.forEach((m) => {
                    sel.append(`<option value="${m.id}">${m.label}</option>`);
                    if (m.id === current) found = true;
                });
                sel.append(`<option value="__custom__">Custom…</option>`);
                if (current && !found) {
                    sel.prepend(`<option value="${current}">${current} (Saved)</option>`);
                }
                if (current) {
                    sel.val(current);
                } else {
                    sel.val("");
                }
                if (window.toastr) toastr.success(`Loaded ${res.models.length} models.`, "Image Gen");
            } else {
                if (window.toastr) toastr.warning(`Failed to load models: ${res.error || "Unknown error"}`, "Image Gen");
            }
        } catch (err) {
            console.error(err);
            if (window.toastr) toastr.error("Error refreshing image models.", "Image Gen");
        } finally {
            icon.removeClass("fa-spin");
        }
    });

    // Initial State
    const s = getSettings();
    if (s.image?.provider) {
        let pv = String(s.image.provider).toLowerCase();
        if (pv === "comfyui") pv = "comfy";
        if (pv === "automatic1111" || pv === "sdnext") pv = "sdwebui";
        $(providerSelectors).val(pv);
    }
    applySettingsToInputs();
    refreshUi();
}
