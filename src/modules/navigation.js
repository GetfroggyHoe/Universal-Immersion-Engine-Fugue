
import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";
import { clearAllSprites } from "./sprites.js";
import { getRealityEngineV3 } from "./reality.js";
import { injectRpEvent } from "./features/rp_log.js";
import { ensureEconomyState, inferTransitMode, payTransitFare, formatCurrency } from "./economy.js";
import { isSystemLockedOut, enforceLockoutScreen } from "./safetyScanner.js";

// --- SPATIAL NAVIGATION MODULE (v4.0) ---

let pendingNarrativeLocation = null;
let immersiveInputBound = false;
let facingDirection = "north";
let inspectedBarrierDirection = "";
let movementAnimationPending = false;
let narrativeScanTimer = null;
let lastNarrativeScanFingerprint = "";

const CARDINAL_DIRECTIONS = ["north", "east", "south", "west"];
const NAV_HELP_KEY = "uie_directional_navigation_help_seen_v2";

function mountGameplayLayer(node) {
    if (!node) return null;
    if (window.UIE_mountGameplayOverlay?.(node) === true) return node;
    const root = document.getElementById("game-overlay-root");
    (root || document.body).appendChild(node);
    return node;
}

function recentNarrativeText() {
    try {
        return Array.from(document.querySelectorAll("#chat-log .mes_text, #chat .mes_text"))
            .slice(-8)
            .map(function(el) { return String(el.innerText || el.textContent || "").trim(); })
            .filter(Boolean)
            .join("\n")
            .slice(-6000);
    } catch (_) {
        return "";
    }
}

function shouldScanNarrativeLocations(text) {
    const value = String(text || "").trim();
    if (value.length < 40) return false;
    return /\b(?:arriv(?:e|es|ed|ing)|enter(?:s|ed|ing)?|reach(?:es|ed|ing)?|head(?:s|ed|ing)?\s+(?:to|toward)|travel(?:s|ed|ing)?|road|street|district|building|room|hall|station|harbor|port|shop|cafe|castle|forest|village|city|town|school|park|temple|office|apartment|house|hotel|hospital|bar|club|venue|market|bridge|gate|tower|island|planet|realm)\b/i.test(value);
}

function parseLocationDetectorJson(raw) {
    const cleaned = String(raw || "")
        .replace(/```(?:json)?/gi, "")
        .replace(/```/g, "")
        .trim();
    if (!cleaned) return null;
    try {
        return JSON.parse(cleaned);
    } catch (_) {}
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) {
        try {
            return JSON.parse(cleaned.slice(first, last + 1));
        } catch (_) {}
    }
    return null;
}

async function detectNarrativeLocation() {
    if (pendingNarrativeLocation) return pendingNarrativeLocation;
    try {
        const { generateContent } = await import("./apiClient.js");
        const log = recentNarrativeText();
        if (!shouldScanNarrativeLocations(log)) return null;
        const mapEngine = window.UIE_MapEngine;
        const current = String(getSettings()?.worldState?.location || "").trim();
        const aiPrompt = [
            "Find at most one concrete, stable physical location newly introduced in the recent roleplay chat.",
            "Do not return the current location, generic spaces, a person, an organization, an imagined place, or a place already known on the map.",
            "Classify spatial relationship carefully. adjacent means directly reachable from the current place. distant means mentioned or visible but not next door. same_site means a room or sub-location inside the current site. disconnected means portal/world/region travel. unknown means the chat does not establish proximity.",
            "Only give a cardinal direction when the chat explicitly establishes it and relationship is adjacent.",
            "Return JSON only: {\"locationName\":\"\",\"type\":\"\",\"description\":\"\",\"direction\":\"unknown\",\"relationship\":\"adjacent|distant|same_site|disconnected|unknown\",\"confidence\":0}.",
            "If there is no strong candidate, return an empty locationName and confidence 0. Do not invent.",
            `Current location: ${current || "Unknown"}`,
            "Recent Narrative:",
            log
        ].join("\n");
        
        const jsonStr = await generateContent(aiPrompt, "Auto-Warp Detection");
        if (!jsonStr) return null;
        const data = parseLocationDetectorJson(jsonStr);
        if (!data || typeof data !== "object") return null;
        const confidence = Number(data?.confidence || 0);
        const name = String(data?.locationName || "").trim();
        const known = name && typeof mapEngine?.getNodeByName === "function" ? mapEngine.getNodeByName(name) : null;
        if (name && confidence >= 0.72 && !known && name.toLowerCase() !== current.toLowerCase()) {
            data.locationName = name;
            data.relationship = String(data.relationship || "unknown").toLowerCase();
            data.direction = data.relationship === "adjacent" ? String(data.direction || "unknown").toLowerCase() : "unknown";
            pendingNarrativeLocation = data;
            return data;
        }
    } catch (err) {
        console.warn("[Narrative Location] Detection failed:", err);
    }
    return null;
}

async function handleNarrativeLocationAction(action) {
    const data = await detectNarrativeLocation();
    if (!data?.locationName) {
        notify("info", "No new contextual location was detected in the recent story.", "Navigation");
        return false;
    }
    const mapEngine = window.UIE_MapEngine;
    if (!mapEngine) return false;
    let node = typeof mapEngine.getNodeByName === "function" ? mapEngine.getNodeByName(data.locationName) : null;
    if (!node && typeof mapEngine.addOrganicLocation === "function") {
        const adjacent = data.relationship === "adjacent" && CARDINAL_DIRECTIONS.includes(data.direction);
        node = await mapEngine.addOrganicLocation({
            locationChanged: true,
            newLocation: data.locationName,
            type: data.type || "exterior",
            description: data.description || "",
            direction: adjacent ? data.direction : data.relationship === "disconnected" ? "teleport" : "unknown",
            relationship: data.relationship || "unknown",
        });
    }
    if (!node) return false;
    if (action === "move" && typeof mapEngine.travelToLocationName === "function") {
        const moved = await mapEngine.travelToLocationName(node.name || data.locationName, {
            reason: "Contextual narrative travel",
            dir: data.direction || "",
            source: "navigation_discovery",
            useActiveVehicle: false,
        });
        if (moved) notify("success", `Party moved to ${node.name || data.locationName}.`, "Navigation");
        pendingNarrativeLocation = null;
        return moved;
    }
    notify("success", `${node.name || data.locationName} added to the Local map.`, "Map");
    pendingNarrativeLocation = null;
    return true;
}

function dismissNarrativeLocationPrompt() {
    pendingNarrativeLocation = null;
    document.getElementById("uie-location-discovery")?.remove?.();
}

function showNarrativeLocationPrompt(data) {
    if (!data?.locationName) return;
    document.getElementById("uie-location-discovery")?.remove?.();
    const prompt = document.createElement("div");
    prompt.id = "uie-location-discovery";
    prompt.className = "uie-location-discovery";
    prompt.innerHTML = `
        <div class="uie-location-discovery__icon" aria-hidden="true">+</div>
        <div class="uie-location-discovery__copy">
            <strong>${escapeHtml(data.locationName)}</strong>
            <span>${escapeHtml(data.relationship === "adjacent" ? "Nearby route found" : "Location mentioned in chat")}</span>
        </div>
        <button type="button" data-location-discovery-add title="Add location to map">Add</button>
        <button type="button" data-location-discovery-dismiss title="Dismiss">x</button>
    `;
    prompt.querySelector("[data-location-discovery-add]").onclick = async function() {
        await handleNarrativeLocationAction("add");
        dismissNarrativeLocationPrompt();
    };
    prompt.querySelector("[data-location-discovery-dismiss]").onclick = dismissNarrativeLocationPrompt;
    mountGameplayLayer(prompt);
}

function scheduleNarrativeLocationScan(event) {
    const detail = event?.detail || {};
    if (detail.isUser === true) return;
    const text = String(detail.text || recentNarrativeText()).trim();
    if (!shouldScanNarrativeLocations(text)) return;
    const fingerprint = text.slice(-1200);
    if (!fingerprint || fingerprint === lastNarrativeScanFingerprint) return;
    lastNarrativeScanFingerprint = fingerprint;
    clearTimeout(narrativeScanTimer);
    narrativeScanTimer = setTimeout(async function() {
        pendingNarrativeLocation = null;
        const found = await detectNarrativeLocation();
        if (found) showNarrativeLocationPrompt(found);
    }, 900);
}

export function initNavigation() {
    if (isSystemLockedOut()) {
        enforceLockoutScreen();
        throw new Error("System lockout active");
    }
    injectNavHudStyles();
    renderNavHud();
    // Bind physical keyboard input before any first-run UI is mounted. A bad
    // tutorial overlay must never prevent the navigation controller itself
    // from initializing.
    bindImmersiveInputController();
    try {
        showDirectionalNavigationHelpOnce();
    } catch (error) {
        console.warn("[Navigation] Tutorial could not be shown:", error);
    }
    updateNavVisibility();
    try {
        import("./map.js").then(async function(m) {
            if (typeof m.initMap === "function") await m.initMap();
            refreshNavVisibility();
        }).catch(function() {});
    } catch (_) {}
    try {
        window.removeEventListener("uie:state_updated", refreshNavVisibility);
        window.addEventListener("uie:state_updated", refreshNavVisibility);
        window.removeEventListener("uie:chat_appended", scheduleNarrativeLocationScan);
        window.addEventListener("uie:chat_appended", scheduleNarrativeLocationScan);
    } catch (_) {}
}

export function setNavVisible(show) {
    const s = getSettings();
    if (!s.realityEngine) s.realityEngine = {};
    if (!s.realityEngine.ui) s.realityEngine.ui = {};
    s.realityEngine.ui.showNav = show === true;
    saveSettings();
    updateNavVisibility();
}

export function refreshNavVisibility() {
    if (isSystemLockedOut()) {
        enforceLockoutScreen();
        return;
    }
    renderNavHud();
    updateNavVisibility();
}

function isMobileNavLayout() {
    try { return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches; } catch (_) { return window.innerWidth < 768; }
}

function slugLocationId(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80);
}

function parseBackgroundUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const match = raw.match(/url\((['"]?)(.*?)\1\)/i);
    return String(match?.[2] || raw).trim();
}

function getStageFallbackBackgroundUrl() {
    try {
        const bg = document.getElementById("bg1");
        const inline = parseBackgroundUrl(bg?.style?.backgroundImage || "");
        const computed = bg ? parseBackgroundUrl(window.getComputedStyle(bg).backgroundImage || "") : "";
        const picked = inline || computed;
        if (picked && !/__transparent\.png/i.test(picked)) return picked;
    } catch (_) {}
    try {
        const direct = parseBackgroundUrl(window?.background_settings?.url || "");
        if (direct && !/__transparent\.png/i.test(direct)) return direct;
    } catch (_) {}
    return "";
}

function canAutoGenerateBackgrounds() {
    try {
        const img = getSettings()?.image || {};
        const provider = String(img.provider || "").toLowerCase();
        const endpoint = String(img.url || "").trim();
        const local = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(endpoint);
        const isComfy = provider === "comfy" || provider === "comfyui";
        const isSd = provider === "sdwebui" || provider === "automatic1111" || provider === "sdnext";
        return img.enabled === true && (provider === "pollinations" || provider === "stability" || isSd || isComfy || local || !!String(img.key || "").trim());
    } catch (_) {
        return false;
    }
}

function setStageBackground(bgEl, src) {
    if (!bgEl) return;
    const url = String(src || "").trim();
    if (!url) {
        bgEl.style.backgroundImage = "";
        return;
    }
    bgEl.style.backgroundImage = `url("${url}")`;
    bgEl.style.backgroundSize = "cover";
    bgEl.style.backgroundPosition = "center";
    bgEl.style.backgroundRepeat = "no-repeat";
}

function renderNavHud() {
    // Legacy ownership marker for tests that ensure this module controls the old nav layer:
    // document.getElementById("re-nav-arrows")?.remove
    let layer = document.getElementById("re-nav-arrows");
    if (!layer) {
        layer = document.createElement("div");
        layer.id = "re-nav-arrows";
        const root = document.getElementById("vn-stage") || document.getElementById("game-root") || document.body;
        root.appendChild(layer);
    }
    layer.style.setProperty("display", "none", "important");
    layer.style.setProperty("pointer-events", "none", "important");
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = "";
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function currentLocationName() {
    const s = getSettings();
    return String(s.worldState?.location || s.map?.location || "Current Location").trim() || "Current Location";
}

function readContextualExits() {
    try {
        const api = window?.UIE_MapEngine;
        if (typeof api?.getContextualExits === "function") {
            const exits = api.getContextualExits().filter(function(exit) { return exit.state !== "hidden"; });
            if (exits.length) return exits;
        }
    } catch (_) {}
    return [
        { dir: "north", state: "open", label: "Enter: North" },
        { dir: "south", state: "open", label: "Return to: South" },
        { dir: "west", state: "open", label: "Cross to: West" },
        { dir: "east", state: "open", label: "Proceed to: East" },
    ];
}

function updateNavVisibility() {
    const s = getSettings();
    const show = s?.realityEngine?.ui?.showNav !== false;
    const layer = document.getElementById("re-nav-arrows");
    if (layer) {
        layer.hidden = !show;
        if (show) updateViewportZoneStates();
    }
}

function normalizeFacing(value) {
    const direction = String(value || "").toLowerCase();
    return CARDINAL_DIRECTIONS.includes(direction) ? direction : "north";
}

function currentFacing() {
    const s = getSettings();
    facingDirection = normalizeFacing(s?.worldState?.orientation || facingDirection);
    return facingDirection;
}

function relativeDirection(relative) {
    const facing = currentFacing();
    const index = CARDINAL_DIRECTIONS.indexOf(facing);
    if (relative === "backward") return CARDINAL_DIRECTIONS[(index + 2) % 4];
    if (relative === "left") return CARDINAL_DIRECTIONS[(index + 3) % 4];
    if (relative === "right") return CARDINAL_DIRECTIONS[(index + 1) % 4];
    return facing;
}

function contextualExitForDirection(direction) {
    return readContextualExits().find(function(exit) { return exit.dir === direction; }) || {
        dir: direction,
        state: "blocked",
        label: "No visible route",
        to: "",
    };
}

function updateViewportZoneStates() {
    const layer = document.getElementById("re-nav-arrows");
    if (!layer) return;
    const facing = currentFacing();
    const apply = function(dir) {
        const exit = contextualExitForDirection(dir);
        let relative = "forward";
        if (dir === facing) relative = "forward";
        else if (dir === relativeDirection("backward")) relative = "backward";
        else if (dir === relativeDirection("left")) relative = "left";
        else if (dir === relativeDirection("right")) relative = "right";

        const relZone = layer.querySelector(`.re-viewport-zone--${relative}`);
        if (relZone) {
            relZone.dataset.state = exit.state || "open";
            relZone.dataset.direction = exit.dir || "";
            relZone.title = exit.label || relZone.getAttribute("aria-label") || "";
            relZone.setAttribute("aria-label", exit.label || relZone.getAttribute("aria-label") || "");
            const isBlocked = exit.state === "blocked" || !exit.to;
            relZone.disabled = isBlocked;
            relZone.hidden = isBlocked;
            relZone.style.display = isBlocked ? "none" : "block";
            relZone.classList.toggle("is-inspected", inspectedBarrierDirection === exit.dir);
        }

        const cardZone = layer.querySelector(`.re-viewport-zone--${dir}`);
        if (cardZone) {
            cardZone.dataset.state = exit.state || "open";
            cardZone.dataset.direction = exit.dir || "";
            cardZone.title = exit.label || cardZone.getAttribute("aria-label") || "";
            cardZone.setAttribute("aria-label", exit.label || cardZone.getAttribute("aria-label") || "");
            const text = cardZone.querySelector("span");
            if (text) text.textContent = exit.to || exit.label || dir;
            const glyph = cardZone.querySelector("b");
            if (glyph) glyph.textContent = exit.state === "locked" ? "L" : exit.state === "override" ? "!" : String(exit.dir || "?").slice(0, 1).toUpperCase();
            const isBlocked = exit.state === "blocked";
            cardZone.disabled = isBlocked;
            cardZone.hidden = isBlocked;
            cardZone.style.display = isBlocked ? "none" : "block";
            cardZone.classList.toggle("is-inspected", inspectedBarrierDirection === exit.dir);
        }
    };
    CARDINAL_DIRECTIONS.forEach(apply);
    layer.dataset.facing = facing;
}

function injectNavHudStyles() {
    if (document.getElementById("re-nav-overlay-style")) return;
    const style = document.createElement("style");
    style.id = "re-nav-overlay-style";
    style.textContent = `
        #re-nav-arrows.re-nav-overlay{position:fixed;left:50%;bottom:calc(190px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:10018;display:none!important;pointer-events:none!important}
        #re-nav-arrows .re-viewport-zone{display:none!important;pointer-events:none!important}
        #re-nav-arrows .re-viewport-zone b{font-size:13px;color:#6fd3ff}
        #re-nav-arrows .re-viewport-zone span{max-width:48px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.9}
        #re-nav-arrows .re-viewport-zone:disabled,#re-nav-arrows .re-viewport-zone[hidden]{display:none!important}
        #re-nav-arrows .re-viewport-zone--north{grid-column:2;grid-row:1}
        #re-nav-arrows .re-viewport-zone--west{grid-column:1;grid-row:2}
        #re-nav-arrows .re-viewport-zone--east{grid-column:3;grid-row:2}
        #re-nav-arrows .re-viewport-zone--south{grid-column:2;grid-row:3}
        #vn-stage,#re-bg{touch-action:none;overscroll-behavior:none}
        .re-turn-btn{display:none!important;pointer-events:none!important}
        .uie-nav-first-run{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:10020;max-width:min(340px,calc(100vw - 32px));padding:8px 12px;border:1px solid rgba(255,255,255,.22);border-radius:8px;background:rgba(7,12,24,.86);color:#fff;font:700 12px/1.3 Inter,system-ui,sans-serif;box-shadow:0 10px 24px rgba(0,0,0,.35);backdrop-filter:blur(10px);text-align:center}
        .immersive-nav-popup{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(.98);z-index:2147483646;max-width:min(380px,calc(100vw - 40px));padding:12px 16px;border:1px solid rgba(111,211,255,.28);border-radius:12px;background:rgba(3,8,18,.72);color:#fff;font:900 clamp(18px,3.5vw,32px)/1.08 Inter,system-ui,sans-serif;text-align:center;text-shadow:0 0 10px rgba(0,0,0,0.95),0 0 20px rgba(0,0,0,0.9),0 0 35px rgba(111,211,255,0.75);box-shadow:0 12px 38px rgba(0,0,0,.62);backdrop-filter:blur(6px);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .16s ease,transform .16s ease,visibility 0s linear .16s}
        .immersive-nav-popup::before{content:"Destination";display:block;margin-bottom:6px;color:#9ae8ff;font:900 11px/1 Inter,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;text-shadow:0 2px 5px rgba(0,0,0,0.95)}
        .immersive-nav-popup::after{content:"Press again to move";display:block;margin-top:7px;color:#cfefff;font:800 12px/1.2 Inter,system-ui,sans-serif;text-shadow:0 2px 5px rgba(0,0,0,0.95);opacity:.9}
        .immersive-nav-popup.is-visible{opacity:1;visibility:visible;transform:translate(-50%,-50%) scale(1);transition-delay:0s}
        @media not all{#re-nav-arrows.re-nav-overlay{display:none}.uie-nav-first-run{top:10px;font-size:11px;max-width:min(280px,calc(100vw - 24px))}.immersive-nav-popup{font-size:clamp(16px,5vw,26px)}}
    `;
    document.head.appendChild(style);
}

function showDirectionalNavigationHelpOnce() {
    showNavigationTutorialPopup(false);
}

function isTextEntryTarget(target) {
    if (!target) return false;
    const tag = String(target.tagName || "").toLowerCase();
    return target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
}

function isBlockingOverlayOpen() {
    // Persistent UIE windows are not necessarily modal. Treat only explicit
    // overlays/aria-modal dialogs as blockers, otherwise a visible HUD window
    // can disable the physical arrow keys for the entire session.
    return Array.from(document.querySelectorAll(".modal-overlay, .uie-overlay, [aria-modal='true'], [role='dialog']"))
        .some(function(el) {
            if (el.id === "uie-barrier-inspection") return false;
            const explicitlyModal = el.matches?.(".modal-overlay, .uie-overlay, [aria-modal='true']")
                || el.getAttribute?.("aria-modal") === "true";
            if (!explicitlyModal) return false;

            let current = el;
            while (current && current !== document.documentElement) {
                if (current.hidden || current.getAttribute?.("aria-hidden") === "true") return false;
                const style = window.getComputedStyle?.(current);
                if (style?.display === "none" || style?.visibility === "hidden" || style?.opacity === "0") return false;
                // A decorative overlay with pointer-events:none cannot block
                // interaction and should not suppress keyboard navigation.
                if (current === el && style?.pointerEvents === "none") return false;
                current = current.parentElement;
            }
            return true;
        });
}

let pendingDestination = null;
let confirmationTimeout = null;

function createImmersivePopupElement() {
    let popup = document.getElementById("immersive-nav-popup");
    if (!popup) {
        popup = document.createElement("div");
        popup.id = "immersive-nav-popup";
        popup.className = "immersive-nav-popup";
    }
    // The destination confirmation is gameplay chrome and shares the game's
    // one mobile-landscape transform.
    mountGameplayLayer(popup);
    return popup;
}

function displayNameForExit(dir, to, label = "") {
    const direct = String(to || "").trim();
    if (direct) return direct;
    const cleanLabel = String(label || "").replace(/^(enter|return to|cross to|proceed to|exit to)\s*:?\s*/i, "").trim();
    if (cleanLabel && !/^blocked$/i.test(cleanLabel)) return cleanLabel;
    return `${dir.slice(0, 1).toUpperCase()}${dir.slice(1)} route`;
}

function showImmersivePopup(dir, to, label) {
    injectNavHudStyles();
    clearTimeout(confirmationTimeout);
    const popup = createImmersivePopupElement();
    popup.classList.remove("is-visible");
    void popup.offsetWidth; // Force reflow
    
    const displayName = displayNameForExit(dir, to, label);
    popup.textContent = displayName;
    popup.classList.add("is-visible");
    
    pendingDestination = { dir, to, label };
    
    confirmationTimeout = setTimeout(function() {
        hideImmersivePopup();
    }, 4000);
}

function isOnDemandDirection(exit) {
    const state = String(exit?.state || "").toLowerCase();
    const label = String(exit?.label || "").trim();
    return !exit?.to && (state === "blocked" || !state) && (!label || /^blocked$|^no visible route$/i.test(label));
}

function hideImmersivePopup() {
    clearTimeout(confirmationTimeout);
    const popup = document.getElementById("immersive-nav-popup");
    if (popup) {
        popup.classList.remove("is-visible");
    }
    pendingDestination = null;
}

async function executePendingTravel() {
    if (!pendingDestination) return;
    const { dir } = pendingDestination;
    hideImmersivePopup();
    
    const facing = currentFacing();
    let relative = "forward";
    if (dir === facing) relative = "forward";
    else if (dir === relativeDirection("backward")) relative = "backward";
    else if (dir === relativeDirection("left")) relative = "left";
    else if (dir === relativeDirection("right")) relative = "right";
    
    const exit = contextualExitForDirection(dir);
    if (exit.state === "locked" || exit.state === "override") {
        attemptMove(relative);
        return;
    }
    await playStageTransition(relative, function() { return moveDirectionSilent(dir); });
}

async function resolvePreviewExit(direction) {
    const exit = contextualExitForDirection(direction);
    if (exit?.to) return exit;
    try {
        const api = window?.UIE_MapEngine;
        if (typeof api?.previewDirectionDestination === "function") {
            const preview = await api.previewDirectionDestination(direction);
            if (preview?.to) return { ...exit, ...preview };
        }
    } catch (error) {
        console.warn("[Navigation] Direction preview failed:", error);
    }
    return exit;
}

async function handleDirectionAction(direction) {
    const exit = await resolvePreviewExit(direction);
    showImmersivePopup(direction, exit.to || "", exit.label);
}

function relativeDirectionToRelative(dir) {
    const facing = currentFacing();
    if (dir === facing) return "forward";
    if (dir === relativeDirection("backward")) return "backward";
    if (dir === relativeDirection("left")) return "left";
    if (dir === relativeDirection("right")) return "right";
    return "forward";
}

export function activateDirection(direction) {
    return activateDirectionAsync(direction);
}

async function activateDirectionAsync(direction) {
    if (isSystemLockedOut()) {
        enforceLockoutScreen();
        throw new Error("System lockout active");
    }
    const dir = String(direction || "").toLowerCase();
    if (!CARDINAL_DIRECTIONS.includes(dir)) return false;

    const exit = await resolvePreviewExit(dir);
    if ((exit.state === "blocked" || !exit.to) && !isOnDemandDirection(exit)) {
        setDiegeticFeedback(exit.label && exit.label !== "Blocked" ? exit.label : "There is no route that way.");
        const rel = relativeDirectionToRelative(dir);
        const zone = document.querySelector(`.re-viewport-zone--${rel}`);
        if (zone) rattleZone(zone);
        hideImmersivePopup();
        return false;
    }

    if (pendingDestination && pendingDestination.dir === dir) {
        void executePendingTravel();
        return true;
    }
    await handleDirectionAction(dir);
    return true;
}

function bindImmersiveInputController() {
    if (immersiveInputBound) return;
    immersiveInputBound = true;

    window.addEventListener("keydown", function(event) {
        const key = String(event.key || "").toLowerCase();
        const tutorial = document.getElementById("uie-nav-tutorial-modal");
        if (tutorial) {
            if (key === "enter" || key === " " || key === "spacebar" || key === "escape") {
                event.preventDefault();
                event.stopPropagation();
                tutorial.querySelector("#uie-nav-tutorial-close-btn")?.click();
            }
            return;
        }
        if (isTextEntryTarget(event.target) || isBlockingOverlayOpen()) return;
        
        if (key === "m") {
            event.preventDefault();
            import("./map.js").then(function(m) { return m.openMap?.(); }).catch(function(e) { console.warn(e); });
            return;
        }
        if (key === "n") {
            event.preventDefault();
            $("#music-modal").css("display", "flex");
            return;
        }
        if (key === "t") {
            event.preventDefault();
            $("#btn-edit-room, #nav-room-edit, .room-edit-toggle-btn").first().click();
            return;
        }
        if (key === "c") {
            event.preventDefault();
            $("#config-modal").css("display", "flex");
            return;
        }
        
        let direction = "";
        if (key === "arrowup") direction = "north";
        else if (key === "arrowdown") direction = "south";
        else if (key === "arrowleft") direction = "west";
        else if (key === "arrowright") direction = "east";
        
        if (direction) {
            event.preventDefault();
            event.stopPropagation();
            void activateDirection(direction);
        }
    }, true);

    document.addEventListener("click", function(event) {
        const target = event.target;
        const turn = target?.closest?.("[data-turn]");
        if (turn) {
            event.preventDefault();
            rotateView(turn.getAttribute("data-turn"));
            return;
        }
    }, true);

    let pointerSwipe = null;
    let touchSwipe = null;
    let lastSwipeAt = 0;
    let swipeSequence = Promise.resolve();

    const swipeTargetBlocked = (target) => isTextEntryTarget(target) || Boolean(target?.closest?.(
        "button, a, input, textarea, select, [contenteditable='true'], #vn-ui, #hud, #nav-row, #game-overlay-root"
    ));

    const finishSwipe = (start, x, y) => {
        if (!start || isBlockingOverlayOpen() || Date.now() - start.at > 1600) return false;
        const dx = x - start.x;
        const dy = y - start.y;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        if (distance < 36 || distance < Math.min(window.innerWidth, window.innerHeight) * 0.07) return false;
        if (Date.now() - lastSwipeAt < 180) return false;
        lastSwipeAt = Date.now();
        const direction = Math.abs(dx) > Math.abs(dy)
            ? (dx < 0 ? "west" : "east")
            : (dy < 0 ? "north" : "south");
        // Serialize async previews so a quick second swipe cannot overtake the
        // first one before it has installed pendingDestination. First swipe
        // shows path info; the next matching swipe performs movement.
        swipeSequence = swipeSequence
            .catch(() => false)
            .then(() => activateDirection(direction));
        return true;
    };

    document.addEventListener("pointerdown", function(event) {
        if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
        if (swipeTargetBlocked(event.target) || isBlockingOverlayOpen()) return;
        pointerSwipe = { x: event.clientX, y: event.clientY, at: Date.now(), pointerId: event.pointerId };
    }, { capture: true, passive: true });

    document.addEventListener("pointerup", function(event) {
        if (!pointerSwipe || event.pointerId !== pointerSwipe.pointerId) return;
        const start = pointerSwipe;
        pointerSwipe = null;
        finishSwipe(start, event.clientX, event.clientY);
    }, { capture: true, passive: true });

    document.addEventListener("pointercancel", function() {
        pointerSwipe = null;
    }, { capture: true, passive: true });

    // Touch fallback covers WebViews that advertise PointerEvent but fail to
    // deliver pointerup after a gesture crosses a transformed child.
    document.addEventListener("touchstart", function(event) {
        if (event.touches?.length !== 1 || swipeTargetBlocked(event.target) || isBlockingOverlayOpen()) return;
        const touch = event.touches[0];
        touchSwipe = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    }, { capture: true, passive: true });

    document.addEventListener("touchmove", function(event) {
        if (!touchSwipe || event.touches?.length !== 1) return;
        const touch = event.touches[0];
        if (Math.max(Math.abs(touch.clientX - touchSwipe.x), Math.abs(touch.clientY - touchSwipe.y)) >= 18) {
            event.preventDefault();
        }
    }, { capture: true, passive: false });

    document.addEventListener("touchend", function(event) {
        if (!touchSwipe || event.changedTouches?.length !== 1) return;
        const start = touchSwipe;
        touchSwipe = null;
        const touch = event.changedTouches[0];
        if (finishSwipe(start, touch.clientX, touch.clientY)) event.preventDefault();
    }, { capture: true, passive: false });

    document.addEventListener("touchcancel", function() {
        touchSwipe = null;
    }, { capture: true, passive: true });
}

function setDiegeticFeedback(text) {
    const message = String(text || "").trim();
    if (!message) return;
    const reText = document.getElementById("re-text");
    if (reText) reText.textContent = message;
    notify("warning", message, "Navigation", "navigation");
}

function rattleZone(zone) {
    if (!zone) return;
    zone.classList.remove("anim-screen-shake");
    void zone.offsetWidth;
    zone.classList.add("anim-screen-shake");
    setTimeout(function() { zone.classList.remove("anim-screen-shake"); }, 420);
}

function playStageTransition(kind, operation) {
    if (movementAnimationPending) return Promise.resolve(false);
    movementAnimationPending = true;
    const stage = document.getElementById("re-bg") || document.getElementById("game-root");
    const overlay = document.createElement("div");
    overlay.className = "re-movement-fade";
    mountGameplayLayer(overlay);
    stage?.classList?.add(kind === "backward" ? "re-moving-backward" : "re-moving-forward");
    return new Promise(function(resolve) { return setTimeout(resolve, 110); })
        .then(operation)
        .finally(function() {
            setTimeout(function() {
                stage?.classList?.remove("re-moving-forward", "re-moving-backward");
                overlay.classList.add("is-clearing");
                setTimeout(function() { overlay.remove(); }, 220);
                movementAnimationPending = false;
            }, 35);
        });
}

function barrierDescription(exit) {
    const barrier = exit?.barrier || {};
    return barrier.denial || `The ${barrier.lockName || "route"} won't budge. Something is holding it shut.`;
}

function openBarrierInspection(exit) {
    document.getElementById("uie-barrier-inspection")?.remove?.();
    const barrier = exit?.barrier || {};
    const overlay = document.createElement("div");
    overlay.id = "uie-barrier-inspection";
    overlay.className = "uie-barrier-inspection";
    overlay.innerHTML = `
        <button type="button" class="uie-barrier-inspection__close" aria-label="Close inspection">&times;</button>
        <button type="button" class="uie-barrier-inspection__lock" aria-label="Interact with ${escapeHtml(barrier.lockName || "lock")}">
            <i class="fa-solid fa-lock"></i>
            <strong>Pick Lock?</strong>
            <span>${escapeHtml(barrierDescription(exit))}</span>
            <small>${escapeHtml(barrier.lockName || barrier.requirementId || "Inspect the mechanism")}</small>
        </button>
    `;
    overlay.querySelector(".uie-barrier-inspection__close").onclick = function() { overlay.remove(); };
    overlay.onclick = function(event) {
        if (event.target === overlay) overlay.remove();
    };
    overlay.querySelector(".uie-barrier-inspection__lock").onclick = async function() {
        try {
            const map = await import("./map.js");
            const unlocked = await map.unlockExit?.(exit.dir);
            if (!unlocked) {
                rattleZone(overlay.querySelector(".uie-barrier-inspection__lock"));
                setDiegeticFeedback(barrierDescription(exit));
                return;
            }
            setDiegeticFeedback(`${barrier.lockName || "The lock"} opens.`);
            inspectedBarrierDirection = "";
            overlay.classList.add("is-unlocked");
            setTimeout(function() {
                overlay.remove();
                refreshNavVisibility();
            }, 420);
        } catch (error) {
            console.warn("[Navigation] Barrier inspection failed:", error);
        }
    };
    mountGameplayLayer(overlay);
}

export async function attemptMove(relative = "forward") {
    const direction = relativeDirection(relative);
    const exit = contextualExitForDirection(direction);
    const zone = document.querySelector(`.re-viewport-zone--${relative === "backward" ? "backward" : "forward"}`);
    if (exit.state === "blocked" || !exit.to) {
        return await playStageTransition(relative, async function() {
            const moved = await moveDirectionSilent(direction);
            if (!moved) {
                rattleZone(zone);
                setDiegeticFeedback(exit.label && exit.label !== "Blocked" ? exit.label : "There is no route that way.");
            }
            return moved;
        });
    }
    if (exit.state === "locked") {
        rattleZone(zone);
        if (inspectedBarrierDirection === direction) openBarrierInspection(exit);
        else {
            inspectedBarrierDirection = direction;
            setDiegeticFeedback(barrierDescription(exit));
            updateViewportZoneStates();
        }
        return false;
    }
    if (exit.state === "override") {
        openBarrierInspection(exit);
        return false;
    }
    inspectedBarrierDirection = "";
    return await playStageTransition(relative, function() { return moveDirectionSilent(direction); });
}

export function rotateView(turn = "right") {
    if (movementAnimationPending) return false;
    const s = getSettings();
    if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
    const index = CARDINAL_DIRECTIONS.indexOf(currentFacing());
    facingDirection = CARDINAL_DIRECTIONS[(index + (turn === "left" ? 3 : 1)) % 4];
    s.worldState.orientation = facingDirection;
    saveSettings();
    inspectedBarrierDirection = "";
    const stage = document.getElementById("re-bg") || document.getElementById("game-root");
    stage?.classList?.add(turn === "left" ? "re-turning-left" : "re-turning-right");
    setTimeout(function() { stage?.classList?.remove("re-turning-left", "re-turning-right"); }, 260);
    updateViewportZoneStates();
    window.dispatchEvent(new CustomEvent("uie:view_rotated", { detail: { facing: facingDirection, turn } }));
    return true;
}

function showTooltip(dir, label = "") {
    const tip = document.getElementById("re-nav-tooltip");
    if (!tip) return;

    if (label) {
        tip.textContent = label;
        tip.style.display = "block";
        return;
    }

    // Calculate next coord
    const s = getSettings();
    const x = s.worldState?.x || 0;
    const y = s.worldState?.y || 0;
    let nx = x, ny = y;
    if (dir === "north") ny--;
    if (dir === "south") ny++;
    if (dir === "west") nx--;
    if (dir === "east") nx++;

    const key = `${nx},${ny}`;
    const known = s.realityEngine?.backgrounds?.[key] ? "Known Location" : "Unknown Area";

    tip.textContent = `To ${dir.toUpperCase()} (${known})`;
    tip.style.display = "block";
}

function hideTooltip() {
    const tip = document.getElementById("re-nav-tooltip");
    if (tip) tip.style.display = "none";
}

let navLastAt = 0;
const navPending = new Map();

// Global generation lock to prevent navigation during generation
function isGenerating() {
    try {
        if (typeof is_send_press !== "undefined" && is_send_press) return true;
        const btn = document.getElementById("send_but");
        const stop = document.getElementById("stop_but");
        const isVisible = function(el) {
            if (!el || el.hidden || el.getAttribute?.("aria-hidden") === "true") return false;
            const style = window.getComputedStyle?.(el);
            return style ? style.display !== "none" && style.visibility !== "hidden" : el.style.display !== "none";
        };
        if (btn && !isVisible(btn) && isVisible(stop)) return true;
        if (isVisible(stop)) return true;
    } catch (_) {}
    return false;
}

export async function moveDirectionSilent(dir) {
    // strict debounce + generation lock
    if (isGenerating()) {
        try { notify("warn", "Cannot move while generating.", "Navigation"); } catch (_) {}
        return;
    }

    const now = Date.now();
    if (now - navLastAt < 220) return;
    navLastAt = now;

    // Prefer the tier map graph so arrows update the user's map-aware location for AI context.
    try {
        const mapNav = window?.UIE_MapEngine?.navigateDirection;
        if (typeof mapNav === "function") {
            const ok = await mapNav(dir);
            if (ok) {
                refreshNavVisibility();
                return ok;
            }
        }
    } catch (e) {
        console.warn("[UIE] Map navigation bridge failed, falling back.", e);
    }

    // Delegate to window.runNavigation if available for compatibility with the main game loop.
    if (typeof window !== "undefined" && typeof window.runNavigation === "function") {
        return await window.runNavigation(dir);
    }

    const s = getSettings();
    if (!s.worldState) s.worldState = { x: 0, y: 0 };
    if (!s.worldState.currentCoords) s.worldState.currentCoords = { x: 0, y: -1, z: 0 };
    if (typeof s.worldState.x !== "number") s.worldState.x = s.worldState.currentCoords.x || 0;
    if (typeof s.worldState.y !== "number") s.worldState.y = s.worldState.currentCoords.y || -1;

    const prevLoc = String(s.worldState.location || `${s.worldState.x},${s.worldState.y}` || "0,-1").trim() || "0,-1";

    // Screen/map coordinates: north is Y-1 and south is Y+1.
    if (dir === "north") s.worldState.y--;
    if (dir === "south") s.worldState.y++;
    if (dir === "west") s.worldState.x--;
    if (dir === "east") s.worldState.x++;

    s.worldState.currentCoords.x = s.worldState.x;
    s.worldState.currentCoords.y = s.worldState.y;

    const locId = `${s.worldState.x},${s.worldState.y}`;
    const locSlug = slugLocationId(locId);
    const transitMode = inferTransitMode(String(s.worldState.nextLocationType || s.worldState.nextLocation || ""));
    if (transitMode) {
        ensureEconomyState(s);
        const trip = payTransitFare(s, { mode: transitMode, destination: locId });
        if (!trip.ok) {
            if (dir === "north") s.worldState.y++;
            if (dir === "south") s.worldState.y--;
            if (dir === "west") s.worldState.x++;
            if (dir === "east") s.worldState.x--;
            notify("warning", `Need ${formatCurrency(trip.fare, s)} for ${transitMode} travel.`, "Navigation", "currency");
            return;
        }
        notify("success", `Paid ${formatCurrency(trip.fare, s)} fare.`, "Navigation", "currency");
    }
    s.worldState.location = locId;
    saveSettings();

    const reV3 = getRealityEngineV3();
    try { reV3.setLocation(locId); } catch (_) {}
    if (prevLoc !== locId) {
        try { injectRpEvent(`[System: Party traveled ${dir} from ${prevLoc} to ${locId}.]`); } catch (_) {}
    }

    clearAllSprites({ remove: true });

    const bg = document.getElementById("re-bg");
    const fallbackBg = getStageFallbackBackgroundUrl();
    const persistBackground = function(src) {
        const cleaned = String(src || "").trim();
        if (!cleaned) return;
        try { reV3.setBackground(locId, cleaned); } catch (_) {}
        try {
            if (!s.realityEngine || typeof s.realityEngine !== "object") s.realityEngine = {};
            if (!s.realityEngine.backgrounds || typeof s.realityEngine.backgrounds !== "object") s.realityEngine.backgrounds = {};
            s.realityEngine.backgrounds[locSlug] = cleaned;
            saveSettings();
        } catch (_) {}
    };
    const readKnownBackground = function() {
        let savedBg = "";
        try { savedBg = String(reV3.getBackground(locId) || "").trim(); } catch (_) {}
        if (!savedBg) savedBg = String(s.realityEngine?.backgrounds?.[locId] || s.realityEngine?.backgrounds?.[locSlug] || "").trim();
        return savedBg;
    };

    let savedBg = readKnownBackground();
    if (!savedBg && !canAutoGenerateBackgrounds() && fallbackBg) {
        savedBg = fallbackBg;
        persistBackground(savedBg);
    }

    if (savedBg) {
        setStageBackground(bg, savedBg);
        notify("info", `Arrived at ${locId}`, "Navigation");
        refreshNavVisibility();
        return;
    }

    if (!canAutoGenerateBackgrounds()) {
        setStageBackground(bg, fallbackBg);
        notify("info", `Moved to ${locId}`, "Navigation");
        refreshNavVisibility();
        return;
    }

    setStageBackground(bg, fallbackBg);
    notify("info", `New Area: ${locId}. Generating...`, "Navigation");
    refreshNavVisibility();

    if (!navPending.has(locSlug)) {
        navPending.set(locSlug, Date.now());
        try { reV3.ensureBackgroundOrRequest(); } catch (_) {}
        const poll = function(tries = 0) {
            const nextBg = readKnownBackground();
            if (nextBg) {
                setStageBackground(bg, nextBg);
                navPending.delete(locSlug);
                return;
            }
            if (tries >= 8) {
                if (fallbackBg) {
                    setStageBackground(bg, fallbackBg);
                    persistBackground(fallbackBg);
                }
                navPending.delete(locSlug);
                return;
            }
            setTimeout(function() { poll(tries + 1); }, 350);
        };
        poll();
    }
}

// Backwards compatibility for older callers inside this module
async function moveDirection(dir) {
    return await moveDirectionSilent(dir);
}

export function showNavigationTutorialPopup(force = false) {
    const tutorialKey = "uie_navigation_tutorial_seen_v3";
    if (!force) {
        try {
            if (localStorage.getItem(tutorialKey) === "1") return;
        } catch (_) {}
    }

    document.getElementById("uie-nav-tutorial-modal")?.remove();

    const modal = document.createElement("div");
    modal.id = "uie-nav-tutorial-modal";
    modal.className = "uie-nav-tutorial-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "uie-nav-tutorial-title");
    modal.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: rgba(4, 8, 16, 0.85);
        backdrop-filter: blur(12px);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        touch-action: manipulation;
        isolation: isolate;
        animation: uieFadeIn 0.3s ease forwards;
    `;

    const card = document.createElement("div");
    card.className = "uie-nav-tutorial-card";
    card.style.cssText = `
        width: min(500px, 90vw);
        background: linear-gradient(135deg, rgba(16, 24, 48, 0.95), rgba(8, 12, 24, 0.98));
        border: 1px solid rgba(111, 211, 255, 0.25);
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(111, 211, 255, 0.1);
        border-radius: 16px;
        padding: 32px;
        color: #eaf8ff;
        font-family: 'Inter', system-ui, sans-serif;
        text-align: center;
        pointer-events: auto;
        transform: scale(0.9);
        animation: uieScaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    `;

    card.innerHTML = `
        <div style="font-size: 42px; margin-bottom: 16px; color: #6fd3ff;">🧭</div>
        <h2 id="uie-nav-tutorial-title" style="font-size: 24px; font-weight: 800; margin: 0 0 12px 0; color: #fff; letter-spacing: -0.5px;">Spatial Navigation</h2>
        <p style="font-size: 14px; line-height: 1.6; opacity: 0.85; margin: 0 0 24px 0;">
            Move with arrow keys on desktop or a directional swipe on mobile. Swipe to move—do not scroll the scene.
        </p>
        
        <div style="text-align: left; background: rgba(0, 0, 0, 0.3); border-radius: 12px; padding: 18px; margin-bottom: 28px; border: 1px solid rgba(255, 255, 255, 0.05); display: flex; flex-direction: column; gap: 14px;">
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <span style="font-size: 16px;">⌨️</span>
                <div>
                    <strong style="display: block; font-size: 13px; color: #fff;">Keyboard Controls</strong>
                    <span style="font-size: 12px; opacity: 0.75;">Press standard keyboard <b>Arrow Keys (Up, Down, Left, Right)</b> to steer. (WASD keys are disabled.)</span>
                </div>
            </div>
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <span style="font-size: 16px;">📱</span>
                <div>
                    <strong style="display: block; font-size: 13px; color: #fff;">Mobile Swipe</strong>
                    <span style="font-size: 12px; opacity: 0.75;">Swipe left, right, up, or down to move that way. This is navigation, not scrolling.</span>
                </div>
            </div>
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <span style="font-size: 16px; color: #ff6b6b;">🚫</span>
                <div>
                    <strong style="display: block; font-size: 13px; color: #ff6b6b;">No Click Navigation</strong>
                    <span style="font-size: 12px; opacity: 0.75;">There are no navigation hotspot buttons or clicking on the screen background to travel.</span>
                </div>
            </div>
            <div style="display: flex; align-items: flex-start; gap: 12px; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 12px; margin-top: 2px;">
                <span style="font-size: 16px; color: #ffe066;">💡</span>
                <div>
                    <strong style="display: block; font-size: 13px; color: #ffe066;">Two-Press Confirmation</strong>
                    <span style="font-size: 12px; opacity: 0.8;">The first arrow press or swipe shows the destination. Repeat the same direction to travel there.</span>
                </div>
            </div>
        </div>

        <button type="button" id="uie-nav-tutorial-close-btn" style="
            background: linear-gradient(135deg, #0088cc, #0055aa);
            color: #fff;
            border: none;
            padding: 12px 36px;
            min-height: 44px;
            font-size: 14px;
            font-weight: 700;
            border-radius: 8px;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(0, 136, 204, 0.4);
            transition: all 0.2s ease;
            outline: none;
            width: 100%;
            pointer-events: auto;
            touch-action: manipulation;
        ">Got it, let's go!</button>
    `;

    if (!document.getElementById("uie-nav-tutorial-animations")) {
        const style = document.createElement("style");
        style.id = "uie-nav-tutorial-animations";
        style.textContent = `
            @keyframes uieFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes uieScaleUp {
                from { transform: scale(0.9); opacity: 0; }
                to { transform: scale(1); opacity: 1; }
            }
            #uie-nav-tutorial-close-btn:hover {
                background: linear-gradient(135deg, #0099ee, #0066cc) !important;
                box-shadow: 0 6px 20px rgba(0, 136, 204, 0.6) !important;
                transform: translateY(-1px);
            }
            #uie-nav-tutorial-close-btn:active { transform: translateY(1px); }
            .uie-nav-tutorial-modal { padding: 12px; box-sizing: border-box; }
            .uie-nav-tutorial-card { box-sizing: border-box; max-height: calc(100dvh - 24px); overflow: auto; }
            @media (max-width: 640px), (max-height: 620px) {
                .uie-nav-tutorial-modal { align-items: center !important; justify-content: center !important; padding: 12px !important; }
                .uie-nav-tutorial-card { width: min(420px, calc(100vw - 24px)) !important; max-height: calc(100dvh - 24px) !important; padding: 18px !important; border-radius: 14px !important; }
                .uie-nav-tutorial-card > div:first-child { font-size: 30px !important; margin-bottom: 8px !important; }
                .uie-nav-tutorial-card h2 { font-size: 20px !important; margin-bottom: 8px !important; }
                .uie-nav-tutorial-card p { font-size: 13px !important; line-height: 1.4 !important; margin-bottom: 14px !important; }
                .uie-nav-tutorial-card > div:nth-of-type(2) { gap: 10px !important; padding: 12px !important; margin-bottom: 14px !important; }
                #uie-nav-tutorial-close-btn { position: sticky; bottom: 0; padding: 10px 18px !important; }
            }
        `;
        document.head.appendChild(style);
    }

    modal.appendChild(card);
    // First-run dialogs must live at document level. The gameplay overlay root
    // may intentionally use pointer-events:none or a landscape transform, which
    // made this visible button impossible to click on some builds.
    document.body.appendChild(modal);

    const closeButton = card.querySelector("#uie-nav-tutorial-close-btn");
    let closing = false;
    const closeTutorial = function() {
        if (closing) return;
        closing = true;
        try {
            localStorage.setItem(tutorialKey, "1");
            localStorage.setItem(NAV_HELP_KEY, "1");
        } catch (_) {}
        try { document.activeElement?.blur?.(); } catch (_) {}
        modal.style.pointerEvents = "none";
        modal.style.animation = "uieFadeIn 0.2s ease reverse forwards";
        card.style.animation = "uieScaleUp 0.2s ease reverse forwards";
        setTimeout(function() {
            modal.remove();
            try { window.focus(); } catch (_) {}
        }, 200);
    };

    closeButton?.addEventListener("click", function(event) {
        event.preventDefault();
        event.stopPropagation();
        closeTutorial();
    });
    // pointerup covers WebViews where a transformed ancestor swallowed click.
    closeButton?.addEventListener("pointerup", function(event) {
        if (event.pointerType === "touch" || event.pointerType === "pen") {
            event.preventDefault();
            closeTutorial();
        }
    });
    modal.addEventListener("click", function(event) {
        if (event.target === modal) closeTutorial();
    });

    requestAnimationFrame(function() {
        try { closeButton?.focus({ preventScroll: true }); } catch (_) { closeButton?.focus?.(); }
    });
}
