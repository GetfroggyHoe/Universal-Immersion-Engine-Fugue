const TEXT_ENTRY_CLASS = "uie-text-entry-active";
const LANDSCAPE_REQUIRED_CLASS = "uie-landscape-required";
const PORTRAIT_CLASS = "uie-portrait";

let initialized = false;
let zoomGuardsInstalled = false;
let tapGuardsInstalled = false;
function isMobileDevice() {
    try {
        const coarse = window.matchMedia?.("(pointer: coarse)")?.matches === true;
        const viewport = window.visualViewport;
        const width = viewport?.width || document.documentElement.clientWidth || window.innerWidth;
        const height = viewport?.height || document.documentElement.clientHeight || window.innerHeight;
        const shortSide = Math.min(width, height);
        const mobileUa = /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent || "");
        return mobileUa || (coarse && shortSide <= 900);
    } catch (_) {
        return false;
    }
}

function isTextEntry(element) {
    if (!(element instanceof Element)) return false;
    if (element.matches("textarea, [contenteditable=''], [contenteditable='true']")) return true;
    if (!element.matches("input")) return false;
    const type = String(element.getAttribute("type") || "text").toLowerCase();
    return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type);
}

let viewportFrame = 0;
let viewportTimer = 0;

function ensureRotateOverlay() {
    if (document.getElementById("rotate-overlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "rotate-overlay";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = "<div><strong>Rotate your device</strong><span>This game is available in landscape only.</span></div>";
    document.body.appendChild(overlay);
}

export function updateAppViewport() {
    const viewport = window.visualViewport;
    const width = Math.round(viewport ? viewport.width : document.documentElement.clientWidth);
    const height = Math.round(viewport ? viewport.height : document.documentElement.clientHeight);
    if (!width || !height) return;

    const root = document.documentElement;
    root.style.setProperty("--app-width", `${width}px`);
    root.style.setProperty("--app-height", `${height}px`);
    const portrait = isMobileDevice() && height > width;
    root.classList.toggle(PORTRAIT_CLASS, portrait);
    document.getElementById("game-root")?.toggleAttribute("aria-hidden", portrait);
    updateViewportDiagnostic(width, height);
    runLandscapeLayoutDiagnostics();
}

function runLandscapeLayoutDiagnostics() {
    if (!new URLSearchParams(window.location.search).has("viewport-debug")) return;
    const nodes = [
        ["HUD", "#hud"], ["QuickBag", "#uie-quick-bag-overlay.active"],
        ["Composer", "#input-row"], ["Navigation", "#nav-row"], ["Map", "#uie-map-window:not([style*='display: none'])"]
    ].map(([name, selector]) => [name, document.querySelector(selector)])
        .filter(([, node]) => node && getComputedStyle(node).display !== "none");
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-panel-gap")) || 10;
    for (let i = 0; i < nodes.length; i += 1) {
        const [name, node] = nodes[i];
        const rect = node.getBoundingClientRect();
        if (node.matches("#hud, #uie-quick-bag-overlay, #input-row, #nav-row")) {
            node.querySelectorAll(".hud-item, .hud-tracker").forEach((row) => {
                if (row.scrollHeight > row.clientHeight || row.scrollWidth > row.clientWidth) {
                    console.warn("HUD overflow:", row.dataset.trackerName || row.dataset.hud || row.className, {
                        clientHeight: row.clientHeight, scrollHeight: row.scrollHeight,
                        clientWidth: row.clientWidth, scrollWidth: row.scrollWidth
                    });
                }
            });
        }
        for (let j = i + 1; j < nodes.length; j += 1) {
            const [otherName, other] = nodes[j];
            const otherRect = other.getBoundingClientRect();
            const overlapX = Math.min(rect.right, otherRect.right) - Math.max(rect.left, otherRect.left);
            const overlapY = Math.min(rect.bottom, otherRect.bottom) - Math.max(rect.top, otherRect.top);
            if (overlapX > 0 && overlapY > 0 && !((name === "HUD" && otherName === "QuickBag") || (name === "QuickBag" && otherName === "HUD"))) {
                console.warn(`UI collision: ${name} / ${otherName}`, { overlapX, overlapY, requiredGap: gap });
            }
        }
    }
}

function updateViewportDiagnostic(width, height) {
    // Explicitly opt-in: /game.html?viewport-debug=1. Never shown in production by default.
    if (!new URLSearchParams(window.location.search).has("viewport-debug")) return;
    let panel = document.getElementById("uie-viewport-debug");
    if (!panel) {
        panel = document.createElement("pre");
        panel.id = "uie-viewport-debug";
        Object.assign(panel.style, {
            position: "fixed", top: "4px", left: "4px", zIndex: "2147483646", margin: "0",
            padding: "6px", background: "rgba(0,0,0,.78)", color: "#7dffb2", font: "11px/1.35 monospace",
            pointerEvents: "none", whiteSpace: "pre-wrap"
        });
        document.body.appendChild(panel);
    }
    const vv = window.visualViewport;
    const gameRect = document.getElementById("game-root")?.getBoundingClientRect();
    const bodyRect = document.body.getBoundingClientRect();
    panel.textContent = [
        `visualViewport: ${width} x ${height}`,
        `inner: ${window.innerWidth} x ${window.innerHeight}`,
        `client: ${document.documentElement.clientWidth} x ${document.documentElement.clientHeight}`,
        `orientation: ${screen.orientation?.type || "unknown"}`,
        `fullscreen: ${Boolean(document.fullscreenElement)}`,
        `game root: ${Math.round(gameRect?.width || 0)} x ${Math.round(gameRect?.height || 0)}`,
        `body: ${Math.round(bodyRect.width)} x ${Math.round(bodyRect.height)}`,
        `classes: ${document.documentElement.className}`,
        vv ? `visual offset: ${Math.round(vv.offsetLeft)},${Math.round(vv.offsetTop)}` : ""
    ].filter(Boolean).join("\n");
}

export function scheduleViewportUpdate() {
    cancelAnimationFrame(viewportFrame);
    clearTimeout(viewportTimer);
    viewportFrame = requestAnimationFrame(updateAppViewport);
    viewportTimer = window.setTimeout(updateAppViewport, 250);
}

export async function enterLandscapeGame() {
    try {
        const root = document.documentElement;
        if (!document.fullscreenElement && root.requestFullscreen) await root.requestFullscreen();
        if (screen.orientation && typeof screen.orientation.lock === "function") {
            await screen.orientation.lock("landscape");
        }
    } catch (error) {
        console.warn("Landscape/fullscreen request was not accepted:", error);
    } finally {
        scheduleViewportUpdate();
    }
}

export function initMobileOrientation() {
    if (initialized) return;
    initialized = true;

    const root = document.documentElement;
    if (isMobileDevice()) {
        root.classList.add(LANDSCAPE_REQUIRED_CLASS);
        ensureRotateOverlay();
        installMobileZoomGuards();
        installMobileTapGuards();
        // Android accepts requestFullscreen only while this pointer event is active.
        // Do not depend on one particular start-menu button; launches/resumes may use
        // different controls or restore directly into gameplay.
        document.addEventListener("pointerdown", () => {
            if (!document.fullscreenElement) void enterLandscapeGame();
        }, { capture: true, passive: true });
    }
    updateAppViewport();

    document.addEventListener("focusin", (event) => {
        if (!isTextEntry(event.target)) return;
        root.classList.add(TEXT_ENTRY_CLASS);
    }, true);

    document.addEventListener("focusout", (event) => {
        if (!isTextEntry(event.target)) return;
        window.setTimeout(() => {
            if (isTextEntry(document.activeElement)) return;
            root.classList.remove(TEXT_ENTRY_CLASS);
        }, 180);
    }, true);

    window.addEventListener("resize", scheduleViewportUpdate, { passive: true });
    window.addEventListener("orientationchange", scheduleViewportUpdate, { passive: true });
    document.addEventListener("fullscreenchange", scheduleViewportUpdate);
    window.visualViewport?.addEventListener("resize", scheduleViewportUpdate, { passive: true });
    window.visualViewport?.addEventListener("scroll", scheduleViewportUpdate, { passive: true });
    screen.orientation?.addEventListener?.("change", scheduleViewportUpdate);
    window.UIE_enterLandscapeGame = enterLandscapeGame;
}

function isTapTarget(element) {
    return element?.closest?.("button, a, input, select, textarea, label, summary, [contenteditable='true'], [role='button'], [onclick], .reply-menu-item, .reply-tool-btn, .nav-btn, .direction-btn, .room-hotspot, .vn-room-component, .quick-bag-tab-btn, .uie-target-item, .img-gen-dd-item");
}

function installMobileTapGuards() {
    if (tapGuardsInstalled) return;
    tapGuardsInstalled = true;
    document.documentElement.style.touchAction = "manipulation";
    document.addEventListener("touchend", (event) => {
        if (event.defaultPrevented || event.changedTouches?.length !== 1) return;
        const target = isTapTarget(event.target);
        if (!target || isTextEntry(target)) return;
        const startupButton = target.closest?.("#start-new-universal, #start-continue-game, #start-load-game, #start-open-settings, #main-api-setup-open, #main-api-setup-later");
        if (startupButton) {
            event.preventDefault();
            event.stopPropagation();
            if (startupButton.disabled || startupButton.getAttribute("aria-disabled") === "true") return;
            startupButton.click?.();
            return;
        }
        const tag = String(target.tagName || "").toLowerCase();
        if (["button", "a", "label", "summary", "input", "select", "textarea"].includes(tag) || target.hasAttribute("onclick")) return;
        event.preventDefault();
        try {
            target.dispatchEvent(new PointerEvent("pointerup", {
                bubbles: true,
                cancelable: true,
                pointerType: "touch",
                clientX: event.changedTouches[0].clientX,
                clientY: event.changedTouches[0].clientY,
            }));
        } catch (_) {}
        target.click?.();
    }, { capture: true, passive: false });
}

function installMobileZoomGuards() {
    if (zoomGuardsInstalled) return;
    zoomGuardsInstalled = true;
    const stopPinch = (event) => {
        if (event.touches && event.touches.length < 2) return;
        event.preventDefault();
    };
    document.addEventListener("gesturestart", (event) => event.preventDefault(), { passive: false });
    document.addEventListener("gesturechange", (event) => event.preventDefault(), { passive: false });
    document.addEventListener("touchmove", stopPinch, { passive: false });
    document.addEventListener("wheel", (event) => {
        if (event.ctrlKey) event.preventDefault();
    }, { passive: false });
}
