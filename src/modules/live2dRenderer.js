// Live2D Renderer (real Cubism runtime bridge)
// ---------------------------------------------------------------------------
// Turns the Live2D setting from a stub into a working paperdoll renderer. It
// lazily loads the Cubism Core + PIXI + pixi-live2d-display runtime (from CDN
// by default, overridable in settings), mounts a transparent canvas into the
// character-sprite layer, loads a `.model3.json`, and exposes a small adapter
// that the Live2DAnimator drives (setExpression / startMotion / stopAllMotions).
//
// It provides the runtime hooks the rest of the engine expects:
//   window.UIE_loadLive2DModel(path, settings)
//   window.UIE_applyLive2DTransform(settings)
//   window.UIE_unloadLive2DModel()
//   window.UIE_live2dRuntimeStatus()      -> { state, message }
//
// Everything degrades gracefully: if the runtime can't load (offline, blocked
// CDN, missing model) the pipeline stays alive with the no-op adapter and the
// settings card shows a clear status instead of throwing.
// ---------------------------------------------------------------------------

const DEFAULT_RUNTIME = {
    core: "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js",
    pixi: "https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js",
    display: "https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/index.min.js",
};

const CANVAS_ID = "uie-live2d-canvas";

let _status = { state: "idle", message: "Live2D runtime not loaded yet." };
let _loadingRuntime = null;
let _app = null;
let _pixi = null;
let _model = null;
let _modelPath = "";
let _settingsRef = null;
let _resizeBound = false;

function setStatus(state, message) {
    _status = { state, message: String(message || "") };
    try {
        window.dispatchEvent(new CustomEvent("uie-live2d-status", { detail: _status }));
    } catch (_) {}
    return _status;
}

export function live2dRuntimeStatus() {
    return { ..._status };
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (!src) return reject(new Error("empty script src"));
        // Reuse an existing tag if present.
        const existing = Array.from(document.scripts).find((s) => s.src === src);
        if (existing) {
            if (existing.dataset.loaded === "1") return resolve();
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error("failed: " + src)), { once: true });
            return;
        }
        const el = document.createElement("script");
        el.src = src;
        el.async = true;
        el.crossOrigin = "anonymous";
        el.addEventListener("load", () => { el.dataset.loaded = "1"; resolve(); }, { once: true });
        el.addEventListener("error", () => reject(new Error("failed: " + src)), { once: true });
        document.head.appendChild(el);
    });
}

async function ensureRuntime(runtime) {
    if (_pixi && _pixi.live2d && _pixi.live2d.Live2DModel) return _pixi;
    if (_loadingRuntime) return _loadingRuntime;

    const urls = { ...DEFAULT_RUNTIME, ...(runtime || {}) };
    _loadingRuntime = (async () => {
        setStatus("loading", "Loading Live2D Cubism runtime…");
        // 1) Cubism Core (required by pixi-live2d-display for Cubism 4 models).
        if (typeof window.Live2DCubismCore === "undefined") {
            await loadScript(urls.core);
        }
        // 2) PIXI (pixi-live2d-display expects a global PIXI).
        if (typeof window.PIXI === "undefined") {
            await loadScript(urls.pixi);
        }
        _pixi = window.PIXI;
        if (!_pixi) throw new Error("PIXI failed to load");
        // 3) pixi-live2d-display plugin (attaches PIXI.live2d).
        if (!_pixi.live2d || !_pixi.live2d.Live2DModel) {
            await loadScript(urls.display);
        }
        if (!_pixi.live2d || !_pixi.live2d.Live2DModel) {
            throw new Error("pixi-live2d-display failed to attach");
        }
        // Register the ticker so motions/physics update.
        try { _pixi.live2d.Live2DModel.registerTicker(_pixi.Ticker); } catch (_) {}
        setStatus("runtime-ready", "Live2D runtime ready.");
        return _pixi;
    })();

    try {
        return await _loadingRuntime;
    } catch (err) {
        _loadingRuntime = null;
        throw err;
    }
}

function spriteLayer() {
    return document.getElementById("vn-sprite-layer")
        || document.getElementById("re-sprites-layer")
        || document.getElementById("game-root")
        || document.body;
}

function ensureCanvas() {
    let canvas = document.getElementById(CANVAS_ID);
    if (canvas) return canvas;
    const layer = spriteLayer();
    canvas = document.createElement("canvas");
    canvas.id = CANVAS_ID;
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;";
    layer.appendChild(canvas);
    return canvas;
}

function canvasSize(canvas) {
    const layer = spriteLayer();
    const rect = layer.getBoundingClientRect ? layer.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
    const w = Math.max(64, Math.floor(rect.width || window.innerWidth));
    const h = Math.max(64, Math.floor(rect.height || window.innerHeight));
    return { w, h };
}

function applyTransform(settings) {
    if (!_model || !_app) return;
    const s = settings || _settingsRef || {};
    const { w, h } = canvasSize();
    // Fit the model to the canvas height, then apply the user scale.
    const baseScale = (h / (_model.internalModel?.height || _model.height || h)) * 0.9;
    const scale = baseScale * (Number(s.scale) || 1);
    try {
        _model.scale.set(scale);
        _model.anchor?.set?.(0.5, 0.5);
        const xPct = (Number(s.x) || 0) / 100;
        const yPct = (Number(s.y) || 0) / 100;
        _model.x = w / 2 + xPct * (w / 2);
        _model.y = h / 2 + yPct * (h / 2) + h * 0.05;
    } catch (_) {}
}

function bindResize() {
    if (_resizeBound) return;
    _resizeBound = true;
    window.addEventListener("resize", () => {
        if (!_app) return;
        const { w, h } = canvasSize();
        try { _app.renderer.resize(w, h); } catch (_) {}
        applyTransform(_settingsRef);
    });
}

// Build the adapter the Live2DAnimator expects.
function makeAdapter(model, settings) {
    return {
        _raw: model,
        setExpression(name) {
            const scale = Number(settings?.expressionScale);
            if (Number.isFinite(scale) && scale <= 0.05) return; // expression weight off
            try {
                if (typeof model.expression === "function") model.expression(name);
                else if (model.internalModel?.motionManager?.expressionManager) {
                    model.internalModel.motionManager.expressionManager.setExpression?.(name);
                }
            } catch (_) {}
        },
        startMotion(group, name, priority) {
            try {
                // pixi-live2d-display: motion(group, index?, priority?)
                if (typeof model.motion === "function") {
                    model.motion(group, undefined, priority);
                }
            } catch (_) {}
        },
        stopAllMotions() {
            try { model.internalModel?.motionManager?.stopAllMotions?.(); } catch (_) {}
        },
    };
}

async function loadModel(path, settings) {
    _settingsRef = settings || _settingsRef;
    const cleanPath = String(path || "").trim();
    if (!cleanPath) { setStatus("no-model", "No Live2D model path set."); return null; }

    let pixi;
    try {
        pixi = await ensureRuntime(settings?.runtime);
    } catch (err) {
        setStatus("runtime-error", "Live2D runtime unavailable: " + (err?.message || err) + " (paperdoll stays in fallback mode).");
        return null;
    }

    try {
        setStatus("loading-model", "Loading model: " + cleanPath);
        // Tear down a previous model.
        unloadModel({ keepCanvas: true });

        const canvas = ensureCanvas();
        const { w, h } = canvasSize(canvas);
        if (!_app) {
            _app = new pixi.Application({
                view: canvas,
                width: w, height: h,
                backgroundAlpha: 0,
                antialias: true,
                autoStart: true,
            });
        } else {
            try { _app.renderer.resize(w, h); } catch (_) {}
        }

        const base = (typeof window !== "undefined" && window.UIE_BASEURL) ? String(window.UIE_BASEURL).replace(/\/$/, "") : "";
        const url = /^https?:\/\//i.test(cleanPath) || cleanPath.startsWith("/") ? cleanPath : `${base}/${cleanPath}`.replace(/([^:])\/\//g, "$1/");

        _model = await pixi.live2d.Live2DModel.from(url, { autoInteract: false });
        _app.stage.addChild(_model);
        _modelPath = cleanPath;
        applyTransform(settings);
        bindResize();

        // Attach the adapter to the animation bridge so the Director drives it.
        const adapter = makeAdapter(_model, settings || _settingsRef);
        const bridge = window.UIE_vnAnimationBridge;
        if (bridge && typeof bridge.attachLive2DModel === "function") {
            bridge.attachLive2DModel(adapter);
            if (typeof bridge.setLive2DEnabled === "function") bridge.setLive2DEnabled(settings?.enabled !== false);
            if (typeof bridge.setMotionGroup === "function" && settings?.motionGroup) bridge.setMotionGroup(settings.motionGroup);
        }

        // Hold a gentle idle so the model breathes when static.
        if (settings?.autoStatic !== false && bridge && typeof bridge.applyStaticExpression === "function") {
            try { bridge.applyStaticExpression(settings?.lastEmotion || "neutral"); } catch (_) {}
        }

        setStatus("model-ready", "Live2D model loaded: " + cleanPath);
        return adapter;
    } catch (err) {
        setStatus("model-error", "Failed to load model: " + (err?.message || err));
        return null;
    }
}

function unloadModel({ keepCanvas = false } = {}) {
    try {
        if (_model) {
            _app?.stage?.removeChild?.(_model);
            _model.destroy?.({ children: true });
        }
    } catch (_) {}
    _model = null;
    _modelPath = "";
    // Detach from the bridge (fall back to a no-op adapter).
    try {
        const bridge = window.UIE_vnAnimationBridge;
        if (bridge && typeof bridge.attachLive2DModel === "function") bridge.attachLive2DModel(null);
    } catch (_) {}
    if (!keepCanvas) {
        try { _app?.destroy?.(true, { children: true }); } catch (_) {}
        _app = null;
        try { document.getElementById(CANVAS_ID)?.remove(); } catch (_) {}
    }
}

// ---- Public runtime hooks --------------------------------------------------
export function initLive2DRenderer() {
    if (typeof window === "undefined") return;
    // Unconditionally install the REAL loader (overrides the settings stub).
    window.UIE_loadLive2DModel = (path, settings) => loadModel(path, settings);
    window.UIE_applyLive2DTransform = (settings) => applyTransform(settings);
    window.UIE_unloadLive2DModel = () => unloadModel();
    window.UIE_live2dRuntimeStatus = () => live2dRuntimeStatus();
    window.UIE_initLive2DRenderer = () => initLive2DRenderer();
    window.UIE_live2dRenderer = { loadModel, unloadModel, applyTransform, status: live2dRuntimeStatus };
    return window.UIE_live2dRenderer;
}

export { loadModel, unloadModel, applyTransform };
export default { initLive2DRenderer, loadModel, unloadModel, applyTransform, live2dRuntimeStatus };
