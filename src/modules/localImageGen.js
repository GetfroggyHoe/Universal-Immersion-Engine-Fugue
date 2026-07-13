/**
 * localImageGen.js — SDXS Local Image Generation Integration
 *
 * Hooks into the game's location-change event system to:
 *  1. Show a fade-transition overlay while the image is generating (<1.5s)
 *  2. Call the local SDXS FastAPI endpoint (/generate_location) asynchronously
 *  3. Hot-swap the location background texture once the image arrives
 *
 * If user has their own image API configured, uses that instead of local SDXS.
 *
 * Usage: call initLocalImageGen() once during game startup.
 */

import { getRealityEngineV3 } from "./reality.js";
import { getSettings } from "./core.js";
import { notify } from "./notifications.js";
import { generateImageAPI } from "./imageGen.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const IMAGE_SERVICE_URL = "http://127.0.0.1:28094";
const GENERATE_ENDPOINT = `${IMAGE_SERVICE_URL}/generate_location`;
const HEALTH_ENDPOINT   = `${IMAGE_SERVICE_URL}/health`;
const TIMEOUT_MS        = 8000;   // generous timeout; typical is <1.5s on GPU
const OVERLAY_ID        = "uie-localgen-overlay";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let _serviceAvailable = false;
let _serviceChecked   = false;
let _pendingLocation  = null;   // most-recent requested location (debounce)

// ---------------------------------------------------------------------------
// Overlay (fade transition)
// ---------------------------------------------------------------------------

function _ensureOverlay() {
    let el = document.getElementById(OVERLAY_ID);
    if (!el) {
        el = document.createElement("div");
        el.id = OVERLAY_ID;
        el.setAttribute("aria-hidden", "true");

        Object.assign(el.style, {
            position:        "fixed",
            inset:           "0",
            background:      "linear-gradient(135deg, rgba(5,5,20,0.92) 0%, rgba(10,10,35,0.88) 100%)",
            zIndex:          "2147483640",
            display:         "flex",
            alignItems:      "center",
            justifyContent:  "center",
            flexDirection:   "column",
            gap:             "16px",
            opacity:         "0",
            pointerEvents:   "none",
            transition:      "opacity 0.25s ease",
            backdropFilter:  "blur(4px)",
            fontFamily:      "'Inter', 'Roboto', system-ui, sans-serif",
        });

        el.innerHTML = `
          <div id="${OVERLAY_ID}-spinner" style="
            width:48px; height:48px;
            border:3px solid rgba(150,120,255,0.25);
            border-top-color:#9b7fff;
            border-radius:50%;
            animation: uie-spin 0.8s linear infinite;
          "></div>
          <div id="${OVERLAY_ID}-label" style="
            color: rgba(210,200,255,0.9);
            font-size: 14px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            text-shadow: 0 1px 6px rgba(0,0,0,0.7);
          ">Painting scene…</div>
        `;

        // Inject keyframe if absent
        if (!document.getElementById("uie-spin-style")) {
            const style = document.createElement("style");
            style.id = "uie-spin-style";
            style.textContent = `
              @keyframes uie-spin {
                to { transform: rotate(360deg); }
              }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(el);
    }
    return el;
}

function _showOverlay(label = "Painting scene…") {
    const el = _ensureOverlay();
    const lbl = el.querySelector(`#${OVERLAY_ID}-label`);
    if (lbl) lbl.textContent = label;
    el.style.pointerEvents = "all";
    // Force reflow then fade in
    void el.offsetWidth;
    el.style.opacity = "1";
}

function _hideOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (!el) return;
    el.style.opacity = "0";
    setTimeout(() => {
        el.style.pointerEvents = "none";
    }, 280);
}

// ---------------------------------------------------------------------------
// Service health check
// ---------------------------------------------------------------------------

async function _checkServiceAvailable() {
    if (_serviceChecked) return _serviceAvailable;
    try {
        const res = await fetch(HEALTH_ENDPOINT, {
            method: "GET",
            signal: AbortSignal.timeout(1500),
        });
        const data = await res.json().catch(() => ({}));
        _serviceAvailable = res.ok && data?.ok === true;
        if (!_serviceAvailable) {
            console.warn("[localImageGen] Image service not healthy:", data);
        } else {
            const hasModels = data?.models_ready;
            if (!hasModels) {
                console.warn("[localImageGen] Service up but ONNX models not downloaded yet.");
                _serviceAvailable = false;   // don't try to generate
            } else {
                console.log("[localImageGen] SDXS image service ready ✓", data?.providers);
            }
        }
    } catch (_) {
        _serviceAvailable = false;
        console.info("[localImageGen] SDXS image service not reachable (will skip local generation).");
    }
    _serviceChecked = true;
    return _serviceAvailable;
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

async function _requestLocationImage(location) {
    const settings = getSettings();
    const s = settings?.sdxsLocalGen ?? {};
    const userImageApi = settings?.image?.enabled && settings?.image?.key;

    // If user has their own image API configured, use it instead of local SDXS
    if (userImageApi) {
        try {
            const prompt = [
                location?.imagePrompt || "",
                location?.name || "",
                location?.biome || location?.type || "",
                location?.description || "",
                "environment background, no people, no characters, no text, no UI"
            ].filter(Boolean).join(", ");

            const result = await generateImageAPI(prompt, {
                width: 1024,
                height: 576,
                feature: "background"
            });

            if (result?.url) {
                return { imageUrl: result.url, elapsedMs: 0 };
            }
        } catch (err) {
            console.warn("[localImageGen] User API failed, falling back to local:", err);
        }
    }

    // Fall back to local SDXS
    const prompt = [
        location?.imagePrompt || "",
        location?.name || "",
        location?.biome || location?.type || "",
        location?.description || "",
    ].filter(Boolean).join(", ");

    const body = {
        prompt,
        location: location?.name || "Unknown Location",
        biome:    location?.biome || location?.type || "fantasy",
        seed:     s.seed ?? undefined,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(GENERATE_ENDPOINT, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(body),
            signal:  controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
            const err = await res.text().catch(() => res.statusText);
            throw new Error(`HTTP ${res.status}: ${err}`);
        }

        const data = await res.json();
        if (!data?.ok) throw new Error(data?.error || "Generation failed");

        // Resolve relative URL → absolute URL on the image service
        const imageUrl = data.url?.startsWith("http")
            ? data.url
            : `${IMAGE_SERVICE_URL}${data.url}`;

        return { imageUrl, elapsedMs: data.elapsed_ms ?? 0 };

    } finally {
        clearTimeout(timer);
    }
}

// ---------------------------------------------------------------------------
// Hot-swap helper
// ---------------------------------------------------------------------------

function _applyBackground(locationId, imageUrl) {
    const reV3 = getRealityEngineV3();
    reV3.setBackground(locationId, imageUrl);
}

// ---------------------------------------------------------------------------
// Main location-change handler
// ---------------------------------------------------------------------------

async function _onLocationChanged({ id, location }) {
    const settings = getSettings();

    // Respect global image enabled setting AND local-gen setting
    if (settings?.image?.enabled !== true) return;
    if (settings?.sdxsLocalGen?.enabled === false) return;

    // Don't run if service is unavailable
    const available = await _checkServiceAvailable();
    if (!available) return;

    // Debounce: only process the most recent location request
    _pendingLocation = id;

    const locName = location?.name || id || "Unknown Place";
    _showOverlay(`Painting ${locName}…`);

    try {
        // Tiny yield so the overlay renders before the (blocking) fetch
        await new Promise((r) => setTimeout(r, 0));

        // Bail if a newer location was requested while we awaited
        if (_pendingLocation !== id) return;

        const { imageUrl, elapsedMs } = await _requestLocationImage(location);

        if (_pendingLocation !== id) return;  // stale result

        _applyBackground(id, imageUrl);
        notify("success", `Scene painted in ${(elapsedMs / 1000).toFixed(1)}s`, "Local AI");

    } catch (err) {
        console.error("[localImageGen] Generation error:", err);
        // Mark service as unchecked so we re-probe on next attempt
        _serviceChecked = false;
        _serviceAvailable = false;
    } finally {
        if (_pendingLocation === id) {
            _hideOverlay();
        }
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the local SDXS image generation listener.
 * Call once during game startup (e.g. from startup.js or initBackgroundManager).
 */
export function initLocalImageGen() {
    if (window.UIE_localImageGenBound) return;
    window.UIE_localImageGenBound = true;

    const reV3 = getRealityEngineV3();

    // Listen for location changes
    reV3.on("location:changed", ({ id, location }) => {
        _onLocationChanged({ id, location }).catch(console.error);
    });

    // Listen for missing backgrounds (e.g. on first load)
    reV3.on("background:missing", ({ id, location }) => {
        _onLocationChanged({ id, location }).catch(console.error);
    });

    // Probe service availability eagerly (non-blocking)
    _checkServiceAvailable().catch(() => {});

    console.log("[UIE] Local Image Generator (SDXS) Initialized");
}

/**
 * Force-generate an image for the given location object.
 * Returns the image URL or null on failure.
 *
 * @param {string} locationId
 * @param {object} location
 * @returns {Promise<string|null>}
 */
export async function generateLocalImage(locationId, location) {
    const available = await _checkServiceAvailable();
    if (!available) return null;

    try {
        _showOverlay(`Painting ${location?.name || locationId}…`);
        const { imageUrl } = await _requestLocationImage(location);
        _applyBackground(locationId, imageUrl);
        return imageUrl;
    } catch (err) {
        console.error("[localImageGen]", err);
        return null;
    } finally {
        _hideOverlay();
    }
}

/** Check whether the SDXS image service is reachable. */
export async function checkLocalImageService() {
    _serviceChecked = false;  // force re-check
    return _checkServiceAvailable();
}

export { IMAGE_SERVICE_URL };
