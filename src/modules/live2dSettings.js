// Live2D Settings
// ---------------------------------------------------------------------------
// Adds Live2D (Cubism SDK for Web) as its own, self-contained option in the
// engine settings. It exposes a settings card (enable toggle, model path,
// scale, position, and an automatic static-expression option) that can be
// mounted into either the standalone settings window (#uie-settings-window)
// or the host-app drawer (.uie-settings-block).
//
// Values are stored under getSettings().live2d and applied through the
// VN Animation Bridge (which owns the Live2DAnimator). When enabled, the
// bridge drives the Cubism model from the Animation Director's semantic
// directives; when disabled, the bridge is turned off and the paperdoll is
// not animated by Live2D.
//
// This module never loads the Cubism runtime itself — it stores the model
// path and calls window.UIE_loadLive2DModel(path, settings) if a runtime is
// wired up. That keeps the option available even before the SDK is installed.
// ---------------------------------------------------------------------------

import { getSettings, saveSettings } from "./core.js";

const DEFAULTS = {
    enabled: false,
    modelPath: "",          // path to the character's .model3.json
    scale: 1,               // 0.3 .. 2
    x: 0,                   // -100 .. 100 (% horizontal offset)
    y: 0,                   // -100 .. 100 (% vertical offset)
    autoStatic: true,       // hold expression + idle loop when no dialogue
    motionGroup: "tap",     // Cubism motion group folder name
    expressionScale: 1,    // expression blend weight (0 = no expressions)
    runtime: {},            // optional overrides: { core, pixi, display } CDN urls
};

function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

export function ensureLive2DSettings() {
    const s = getSettings();
    if (!s.live2d || typeof s.live2d !== "object") s.live2d = {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (s.live2d[k] === undefined) s.live2d[k] = v;
    }
    return s.live2d;
}

export function getLive2DSettings() {
    return ensureLive2DSettings();
}

export const LIVE2D_CARD_HTML = `
<div class="uie-rpg-card" id="uie-live2d-card" style="margin-top:18px;">
    <div class="uie-rpg-card-title"><i class="fa-solid fa-person-rays"></i> Live2D Paperdoll (Cubism)</div>
    <p style="font-size:12px; opacity:0.85; margin:0 0 12px; line-height:1.4;">
        Render the active speaker as a Live2D character. Emotion maps to <code>.exp3.json</code> expressions and
        motion hints map to <code>.motion3.json</code> motions, driven automatically by the Animation Director — no
        player input required. Set a model path and enable to use.
    </p>
    <div class="uie-switch-label" style="padding-bottom:14px;">
        <span style="font-weight:900; color:#a78bfa;"><i class="fa-solid fa-power-off"></i> Enable Live2D</span>
        <label class="uie-switch">
            <input type="checkbox" id="uie-live2d-enabled">
            <span class="uie-slider"></span>
        </label>
    </div>
    <div class="uie-rpg-field" style="grid-column:1/-1; margin-bottom:12px;">
        <label>Model File (.model3.json path)</label>
        <input id="uie-live2d-model" type="text" placeholder="models/Mira/mira.model3.json">
    </div>
    <div class="uie-rpg-field" style="grid-column:1/-1; margin-bottom:12px;">
        <label>Motion Group (Cubism folder name)</label>
        <input id="uie-live2d-motiongroup" type="text" placeholder="tap">
    </div>
    <div class="uie-rpg-grid-2">
        <div class="uie-rpg-field" style="margin-bottom:12px;">
            <label>Scale: <span id="uie-live2d-scale-lbl">100</span>%</label>
            <input id="uie-live2d-scale" type="range" min="30" max="200" step="5" value="100" style="padding:0; width:100%; accent-color:#cc7a2e;">
        </div>
        <div class="uie-rpg-field" style="margin-bottom:12px;">
            <label>Horizontal: <span id="uie-live2d-x-lbl">0</span>%</label>
            <input id="uie-live2d-x" type="range" min="-100" max="100" step="2" value="0" style="padding:0; width:100%; accent-color:#cc7a2e;">
        </div>
        <div class="uie-rpg-field" style="margin-bottom:12px;">
            <label>Vertical: <span id="uie-live2d-y-lbl">0</span>%</label>
            <input id="uie-live2d-y" type="range" min="-100" max="100" step="2" value="0" style="padding:0; width:100%; accent-color:#cc7a2e;">
        </div>
        <div class="uie-rpg-field" style="margin-bottom:12px;">
            <label>Expression Weight: <span id="uie-live2d-expression-lbl">100</span>%</label>
            <input id="uie-live2d-expression" type="range" min="0" max="100" step="5" value="100" style="padding:0; width:100%; accent-color:#cc7a2e;">
        </div>
    </div>
    <label class="uie-check-row" style="grid-column:1/-1;">
        <input type="checkbox" id="uie-live2d-autostatic" checked>
        <span>Keep a gentle idle animation when the character is static (breathing / blinking)</span>
    </label>
    <div id="uie-live2d-status" style="grid-column:1/-1; margin-top:10px; font-size:11px; line-height:1.4; padding:8px 10px; border-radius:8px; background:rgba(0,0,0,0.35); color:#cdbfe8;">
        <i class="fa-solid fa-circle-info"></i> Live2D runtime: not loaded yet.
    </div>
</div>
`;

function resolveRoot(scope) {
    // Accept a DOM node, a jQuery object, a selector string, or undefined.
    try {
        if (scope && scope.jquery) return scope;
        if (typeof scope === "string") return window.$ ? window.$(scope) : document.querySelectorAll(scope);
        if (scope && scope.nodeType) return scope;
    } catch (_) {}
    if (window.$) {
        const sel = window.$("#uie-sw-ui-edit");
        if (sel && sel.length) return sel;
        const blk = window.$(".uie-settings-block");
        if (blk && blk.length) return blk;
        const win = window.$("#uie-settings-window");
        if (win && win.length) return win;
    }
    return document;
}

// NOTE: The real runtime hook (window.UIE_loadLive2DModel) is installed by
// live2dRenderer.js via initLive2DRenderer() — it loads the Cubism Core + PIXI
// + pixi-live2d-display runtime and mounts the paperdoll canvas. This module
// only calls that hook; it never defines a stub here.

function applyLive2DSettings() {
    const s = ensureLive2DSettings();
    // Make sure the runtime hooks exist (idempotent; safe if already installed).
    try { window.UIE_initLive2DRenderer?.(); } catch (_) {}
    const bridge = window.UIE_vnAnimationBridge || null;
    if (bridge && typeof bridge.setLive2DEnabled === "function") bridge.setLive2DEnabled(s.enabled === true);
    if (bridge && typeof bridge.setMotionGroup === "function") bridge.setMotionGroup(s.motionGroup || "tap");
    if (s.enabled === true && s.modelPath) {
        try {
            if (typeof window.UIE_loadLive2DModel === "function") {
                window.UIE_loadLive2DModel(s.modelPath, s);
            } else {
                console.warn("[UIE Live2D] runtime not installed; enable Live2D after the page finishes loading.");
            }
        } catch (err) {
            console.warn("[UIE Live2D] load failed:", err);
        }
    } else if (bridge && typeof bridge.setLive2DEnabled === "function") {
        bridge.setLive2DEnabled(false);
        try { window.UIE_unloadLive2DModel?.(); } catch (_) {}
    }
    return s;
}

function readCard(win) {
    const q = (sel) => {
        try { return win.querySelector ? win.querySelector(sel) : (window.$(win).find(sel)[0]); }
        catch (_) { return null; }
    };
    const s = ensureLive2DSettings();
    const enabledEl = q("#uie-live2d-enabled");
    const modelEl = q("#uie-live2d-model");
    const groupEl = q("#uie-live2d-motiongroup");
    const scaleEl = q("#uie-live2d-scale");
    const xEl = q("#uie-live2d-x");
    const yEl = q("#uie-live2d-y");
    const exprEl = q("#uie-live2d-expression");
    const autoEl = q("#uie-live2d-autostatic");

    if (enabledEl) s.enabled = enabledEl.checked === true;
    if (modelEl) s.modelPath = String(modelEl.value || "").trim();
    if (groupEl) s.motionGroup = String(groupEl.value || "").trim() || "tap";
    if (scaleEl) s.scale = Number(scaleEl.value) / 100;
    if (xEl) s.x = Number(xEl.value);
    if (yEl) s.y = Number(yEl.value);
    if (exprEl) s.expressionScale = Number(exprEl.value) / 100;
    if (autoEl) s.autoStatic = autoEl.checked === true;
    try { saveSettings(); } catch (_) {}
    // Live transform when already running (no model reload needed).
    try { window.UIE_applyLive2DTransform?.(s); } catch (_) {}
    applyLive2DSettings();
}

function hydrateCard(win) {
    const s = ensureLive2DSettings();
    const setVal = (sel, val) => {
        const el = win.querySelector ? win.querySelector(sel) : (window.$(win).find(sel)[0]);
        if (el) {
            if (el.type === "checkbox" || el.type === "radio") el.checked = !!val;
            else if (el.value !== undefined) el.value = val;
        }
    };
    const setLbl = (sel, val) => {
        const el = win.querySelector ? win.querySelector(sel) : (window.$(win).find(sel)[0]);
        if (el) el.textContent = val;
    };
    setVal("#uie-live2d-enabled", s.enabled);
    setVal("#uie-live2d-model", s.modelPath);
    setVal("#uie-live2d-motiongroup", s.motionGroup || "tap");
    setVal("#uie-live2d-scale", Math.round((s.scale || 1) * 100));
    setLbl("#uie-live2d-scale-lbl", Math.round((s.scale || 1) * 100));
    setVal("#uie-live2d-x", s.x || 0);
    setLbl("#uie-live2d-x-lbl", s.x || 0);
    setVal("#uie-live2d-y", s.y || 0);
    setLbl("#uie-live2d-y-lbl", s.y || 0);
    setVal("#uie-live2d-expression", Math.round((s.expressionScale || 1) * 100));
    setLbl("#uie-live2d-expression-lbl", Math.round((s.expressionScale || 1) * 100));
    setVal("#uie-live2d-autostatic", s.autoStatic);
    updateLive2DStatus(card);
}

function updateLive2DStatus(scope) {
    const root = scope && scope.nodeType ? scope : document;
    const el = root.querySelector ? root.querySelector("#uie-live2d-status") : null;
    if (!el) return;
    const st = (typeof window.UIE_live2dRuntimeStatus === "function")
        ? window.UIE_live2dRuntimeStatus()
        : { state: "idle", message: "Live2D runtime: not loaded yet." };
    const map = {
        "idle": "#8b7fae", "loading": "#e0b648", "loading-model": "#e0b648",
        "runtime-ready": "#6fcf97", "model-ready": "#6fcf97",
        "no-model": "#8b7fae", "runtime-error": "#e06c6c", "model-error": "#e06c6c",
    };
    const color = map[st.state] || "#cdbfe8";
    el.style.color = color;
    el.innerHTML = `<i class="fa-solid fa-circle-info"></i> Live2D runtime: ${esc(st.message)}`;
}

let _mounted = false;

export function mountLive2DSettings(scope) {
    const root = resolveRoot(scope);
    if (!root) return false;

    // Locate an insertion target inside root.
    let mountInto = root;
    try {
        if (root.querySelector && root.querySelector("#uie-sw-ui-edit")) mountInto = root.querySelector("#uie-sw-ui-edit");
        else if (window.$ && root.find && root.find("#uie-sw-ui-edit").length) mountInto = root.find("#uie-sw-ui-edit")[0];
    } catch (_) {}

    const exists = () => {
        try { return mountInto.querySelector ? mountInto.querySelector("#uie-live2d-card") : (window.$(mountInto).find("#uie-live2d-card").length > 0); }
        catch (_) { return false; }
    };
    if (exists()) {
        hydrateCard(mountInto);
        return true;
    }

    // Inject the card.
    try {
        if (mountInto.insertAdjacentHTML) {
            mountInto.insertAdjacentHTML("beforeend", LIVE2D_CARD_HTML);
        } else if (window.$) {
            window.$(mountInto).append(LIVE2D_CARD_HTML);
        } else {
            const tmp = document.createElement("div");
            tmp.innerHTML = LIVE2D_CARD_HTML;
            while (tmp.firstChild) mountInto.appendChild(tmp.firstChild);
        }
    } catch (_) { return false; }

    hydrateCard(mountInto);

    // Bind controls.
    const card = mountInto.querySelector ? mountInto.querySelector("#uie-live2d-card") : window.$(mountInto).find("#uie-live2d-card")[0];
    if (!card) return true;

    const onInput = () => readCard(card);
    card.addEventListener("input", onInput);
    card.addEventListener("change", onInput);
    // Update slider labels live.
    card.addEventListener("input", (e) => {
        const map = { "uie-live2d-scale": "uie-live2d-scale-lbl", "uie-live2d-x": "uie-live2d-x-lbl", "uie-live2d-y": "uie-live2d-y-lbl", "uie-live2d-expression": "uie-live2d-expression-lbl" };
        const lbl = map[e.target?.id];
        if (lbl) { const l = card.querySelector("#" + lbl); if (l) l.textContent = e.target.value; }
    });
    // Live runtime status updates.
    const onStatus = (e) => { try { updateLive2DStatus(card); } catch (_) {} };
    window.addEventListener("uie-live2d-status", onStatus);
    updateLive2DStatus(card);

    // Apply on mount so a previously-enabled setting takes effect.
    applyLive2DSettings();
    _mounted = true;
    return true;
}

// Register a global so the settings window / host drawer can mount easily.
try { window.UIE_mountLive2DSettings = mountLive2DSettings; } catch (_) {}
try { window.UIE_ensureLive2DSettings = ensureLive2DSettings; } catch (_) {}

export default { mountLive2DSettings, ensureLive2DSettings, getLive2DSettings, applyLive2DSettings, LIVE2D_CARD_HTML };
