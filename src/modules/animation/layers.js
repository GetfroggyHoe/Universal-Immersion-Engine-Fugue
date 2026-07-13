// Layered Animation — Layer Registry & Reduced-Motion manager
// ---------------------------------------------------------------------------
// The VN screen is composed of INDEPENDENT visual layers. Animations target a
// specific layer and MUST NOT animate the root application container unless an
// event is explicitly whole-view. This module resolves semantic layer names to
// live DOM elements (with graceful fallbacks) and centralizes reduced-motion
// state so every controller honors it identically.
// ---------------------------------------------------------------------------

export const Layer = {
    ROOT: "root",                       // whole application view (rarely animated)
    ENVIRONMENT_BACKGROUND: "environment_background",
    ENVIRONMENT_EFFECTS: "environment_effects",
    CHARACTER_SPRITES: "character_sprites",
    FOREGROUND_PROPS: "foreground_props",
    CAMERA_VIEWPORT: "camera_viewport",
    DIALOGUE_BOX: "dialogue_box",
    DIALOGUE_TEXT: "dialogue_text",
    HUD: "hud",
};

// Ordered selector candidates per layer. First match in the DOM wins.
const LAYER_SELECTORS = {
    [Layer.ROOT]: ["#game-root"],
    [Layer.ENVIRONMENT_BACKGROUND]: ["#re-bg", "#main-screen-html-host"],
    [Layer.ENVIRONMENT_EFFECTS]: ["#re-weather-layer", "#uie-effects-layer", "#re-time-filter"],
    [Layer.CHARACTER_SPRITES]: ["#re-sprites-layer", "#vn-sprite-layer"],
    [Layer.FOREGROUND_PROPS]: ["#uie-foreground-layer", "#re-sprites-layer"],
    [Layer.CAMERA_VIEWPORT]: ["#game-viewport", "#game-scale-root"],
    [Layer.DIALOGUE_BOX]: ["#re-vn-box", "#message-box-wrap", "#message-box"],
    [Layer.DIALOGUE_TEXT]: ["#re-text", "#message-box"],
    [Layer.HUD]: ["#hud"],
};

let _reducedMotion = false;
let _reducedMotionAuto = false;
let _mql = null;

function detectSystemReducedMotion() {
    try {
        return typeof window !== "undefined"
            && typeof window.matchMedia === "function"
            && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (_) {
        return false;
    }
}

// Initialize reduced-motion tracking. Honors the OS setting automatically and
// keeps in sync if the user changes it while playing.
export function initReducedMotion() {
    _reducedMotionAuto = detectSystemReducedMotion();
    _reducedMotion = _reducedMotionAuto;
    applyReducedMotionClass();
    try {
        if (typeof window !== "undefined" && window.matchMedia && !_mql) {
            _mql = window.matchMedia("(prefers-reduced-motion: reduce)");
            const handler = (e) => {
                _reducedMotionAuto = !!e.matches;
                // OS preference wins unless an explicit app override is stronger.
                _reducedMotion = _reducedMotionAuto || _reducedMotion;
                applyReducedMotionClass();
            };
            if (typeof _mql.addEventListener === "function") _mql.addEventListener("change", handler);
            else if (typeof _mql.addListener === "function") _mql.addListener(handler);
        }
    } catch (_) {}
    return _reducedMotion;
}

export function setReducedMotion(enabled) {
    _reducedMotion = !!enabled || _reducedMotionAuto;
    applyReducedMotionClass();
    return _reducedMotion;
}

export function isReducedMotion() {
    return _reducedMotion;
}

function applyReducedMotionClass() {
    try {
        if (typeof document === "undefined" || !document.body) return;
        document.body.classList.toggle("uie-reduced-motion", _reducedMotion);
    } catch (_) {}
}

// Resolve a semantic layer to a live element (or null).
export function resolveLayer(layer) {
    if (layer instanceof Element) return layer;
    const selectors = LAYER_SELECTORS[layer];
    if (!selectors) {
        // Allow raw selectors / ids as an escape hatch.
        if (typeof layer === "string" && layer) {
            try { return document.querySelector(layer) || document.getElementById(layer); } catch (_) { return null; }
        }
        return null;
    }
    for (const sel of selectors) {
        try {
            const el = document.querySelector(sel);
            if (el) return el;
        } catch (_) {}
    }
    return null;
}

export function resolveLayers(layers = []) {
    const out = [];
    const seen = new Set();
    for (const name of layers) {
        const el = resolveLayer(name);
        if (el && !seen.has(el)) { seen.add(el); out.push({ name, el }); }
    }
    return out;
}

// Ensure the dedicated foreground-props layer exists (created lazily so we
// never depend on it being in the static HTML). It sits above sprites but
// below the dialogue UI.
export function ensureForegroundLayer() {
    let el = document.getElementById("uie-foreground-layer");
    if (el) return el;
    const stage = document.getElementById("vn-stage")
        || document.getElementById("game-scale-root")
        || document.getElementById("game-root");
    if (!stage) return null;
    el = document.createElement("div");
    el.id = "uie-foreground-layer";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:12;";
    const spriteLayer = document.getElementById("re-sprites-layer");
    if (spriteLayer && spriteLayer.parentElement === stage) {
        spriteLayer.after(el);
    } else {
        stage.appendChild(el);
    }
    return el;
}

export { LAYER_SELECTORS };
