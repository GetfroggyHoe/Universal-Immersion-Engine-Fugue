const TEXT_ENTRY_CLASS = "uie-text-entry-active";
const LANDSCAPE_REQUIRED_CLASS = "uie-landscape-required";
const PORTRAIT_CLASS = "uie-portrait";
const GAME_DESIGN_WIDTH = 1536;
const GAME_DESIGN_HEIGHT = 864;

let initialized = false;
let zoomGuardsInstalled = false;
let tapGuardsInstalled = false;
let safeAreaProbe = null;
let hudCapacityObserver = null;
let hudCapacityFrame = 0;

function safeAreaInsets() {
    if (!safeAreaProbe) {
        safeAreaProbe = document.createElement("div");
        safeAreaProbe.setAttribute("aria-hidden", "true");
        Object.assign(safeAreaProbe.style, {
            position: "fixed",
            visibility: "hidden",
            pointerEvents: "none",
            paddingTop: "env(safe-area-inset-top, 0px)",
            paddingRight: "env(safe-area-inset-right, 0px)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
            paddingLeft: "env(safe-area-inset-left, 0px)",
        });
        document.body.appendChild(safeAreaProbe);
    }
    const style = getComputedStyle(safeAreaProbe);
    return {
        top: parseFloat(style.paddingTop) || 0,
        right: parseFloat(style.paddingRight) || 0,
        bottom: parseFloat(style.paddingBottom) || 0,
        left: parseFloat(style.paddingLeft) || 0,
    };
}
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
    root.style.setProperty("--app-left", `${Math.round(viewport?.offsetLeft || 0)}px`);
    root.style.setProperty("--app-top", `${Math.round(viewport?.offsetTop || 0)}px`);
    root.style.setProperty("--game-design-width", String(GAME_DESIGN_WIDTH));
    root.style.setProperty("--game-design-height", String(GAME_DESIGN_HEIGHT));
    const portrait = isMobileDevice() && height > width;
    root.classList.toggle(PORTRAIT_CLASS, portrait);
    document.getElementById("game-root")?.toggleAttribute("aria-hidden", portrait);

    const isMobileLandscape =
        window.matchMedia("(pointer: coarse)").matches &&
        window.matchMedia("(orientation: landscape)").matches;

    root.classList.toggle("uie-mobile-landscape", isMobileLandscape);

    if (!isMobileLandscape) {
        root.style.setProperty("--uie-ui-scale", "1");
        root.style.setProperty("--uie-hud-scale", "1");
        root.style.setProperty("--uie-bottom-clear-width", "1180px");
    } else {
        const bottomScale = 0.9 * Math.max(0.65, Math.min(0.81, width / 1310, height / 578));
        const hudScale = 0.578;
        root.style.setProperty("--uie-ui-scale", String(bottomScale));
        root.style.setProperty("--uie-hud-scale", String(hudScale));
        root.style.setProperty("--uie-bottom-clear-width", `${Math.max(320, (width - 165) / bottomScale)}px`);
    }

    resizeDesktopMirrorMode();
    scheduleMobileHudCapacity();
    updateViewportDiagnostic(width, height);
    runLandscapeLayoutDiagnostics();
}

export function isMobileLandscapeMirror() {
    return false;
}

export function resizeDesktopMirrorMode() {
    const root = document.getElementById("game-root");
    if (!root) return;
    document.documentElement.classList.remove("uie-mobile-mirror");
    document.documentElement.classList.remove("uie-mobile-legacy-disabled");
}

function updateMobileHudCapacity() {
    hudCapacityFrame = 0;
    const scroller = document.getElementById("hud-secondary-scroll");
    const trackers = document.getElementById("hud-custom-trackers");
    const hud = document.getElementById("hud");
    if (!scroller || !trackers || !hud) return;

    const mobileLandscape =
        window.matchMedia("(pointer: coarse)").matches &&
        window.matchMedia("(orientation: landscape)").matches;
    if (!mobileLandscape) {
        scroller.style.removeProperty("--uie-hud-secondary-max");
        scroller.style.removeProperty("--uie-hud-secondary-overflow");
        scroller.removeAttribute("data-overflowing");
        return;
    }

    const rows = Array.from(trackers.children).filter((row) => getComputedStyle(row).display !== "none");
    if (!rows.length) {
        scroller.style.setProperty("--uie-hud-secondary-max", "0px");
        scroller.style.setProperty("--uie-hud-secondary-overflow", "hidden");
        scroller.removeAttribute("data-overflowing");
        return;
    }

    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const deck = document.getElementById("input-row") || document.getElementById("vn-ui");
    const deckRect = deck?.getBoundingClientRect();
    const hudRect = hud.getBoundingClientRect();
    const overlapsHudHorizontally = deckRect &&
        Math.min(hudRect.right, deckRect.right) > Math.max(hudRect.left, deckRect.left);
    const lowerBoundary = deckRect && overlapsHudHorizontally && getComputedStyle(deck).display !== "none" && deckRect.top > 0
        ? Math.min(viewportHeight - 6, deckRect.top - 6)
        : viewportHeight - 8;
    const scrollerTop = scroller.getBoundingClientRect().top;
    const available = Math.max(0, lowerBoundary - scrollerTop);
    const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--uie-hud-scale")) || 1;
    const rowGap = (Number.parseFloat(getComputedStyle(trackers).rowGap || getComputedStyle(trackers).gap) || 0) * scale;

    let used = 0;
    let capacity = 0;
    for (const row of rows) {
        const next = row.getBoundingClientRect().height + (capacity ? rowGap : 0);
        if (used + next > available + 0.5) break;
        used += next;
        capacity += 1;
    }
    if (!capacity && available > 18) {
        capacity = 1;
        used = Math.min(available, rows[0].getBoundingClientRect().height);
    }

    const overflowing = rows.length > capacity;
    scroller.style.setProperty("--uie-hud-secondary-max", overflowing ? `${Math.max(0, used / scale)}px` : "none");
    scroller.style.setProperty("--uie-hud-secondary-overflow", overflowing ? "auto" : "visible");
    scroller.toggleAttribute("data-overflowing", overflowing);
}

function scheduleMobileHudCapacity() {
    cancelAnimationFrame(hudCapacityFrame);
    hudCapacityFrame = requestAnimationFrame(() => requestAnimationFrame(updateMobileHudCapacity));
}

function installHudCapacityObserver() {
    if (hudCapacityObserver) return;
    const hud = document.getElementById("hud");
    if (!hud) return;
    hudCapacityObserver = new MutationObserver(scheduleMobileHudCapacity);
    hudCapacityObserver.observe(hud, { childList: true, subtree: true });
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
    installHudCapacityObserver();

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
    installPressInfo();
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

function installPressInfo() {
    let timer = 0;
    let origin = null;
    let pressedTarget = null;
    let suppressClickFor = null;
    let hideTimer = 0;

    const ensureTooltip = () => {
        let tooltip = document.getElementById("uie-press-info");
        if (tooltip) return tooltip;
        tooltip = document.createElement("div");
        tooltip.id = "uie-press-info";
        tooltip.setAttribute("role", "tooltip");
        tooltip.hidden = true;
        document.body.appendChild(tooltip);
        return tooltip;
    };

    const clearPress = () => {
        window.clearTimeout(timer);
        timer = 0;
        origin = null;
        pressedTarget = null;
    };

    const showPressInfo = (target) => {
        const text = String(target.getAttribute("data-press-info") || target.getAttribute("title") || target.getAttribute("aria-label") || "").trim();
        if (!text) return;
        const tooltip = ensureTooltip();
        tooltip.textContent = text;
        tooltip.hidden = false;
        const rect = target.getBoundingClientRect();
        const tipRect = tooltip.getBoundingClientRect();
        const left = Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, rect.left + (rect.width - tipRect.width) / 2));
        const above = rect.top - tipRect.height - 10;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${above >= 8 ? above : Math.min(window.innerHeight - tipRect.height - 8, rect.bottom + 10)}px`;
        window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => { tooltip.hidden = true; }, 2600);
        suppressClickFor = target;
    };

    document.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "touch" || !isMobileDevice()) return;
        const target = event.target?.closest?.("[data-press-info], [title], [aria-label]");
        if (!target) return;
        clearPress();
        pressedTarget = target;
        origin = { x: event.clientX, y: event.clientY };
        timer = window.setTimeout(() => showPressInfo(target), 480);
    }, { capture: true, passive: true });

    document.addEventListener("pointermove", (event) => {
        if (!origin || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) <= 8) return;
        clearPress();
    }, { capture: true, passive: true });
    document.addEventListener("pointerup", clearPress, { capture: true, passive: true });
    document.addEventListener("pointercancel", clearPress, { capture: true, passive: true });
    document.addEventListener("click", (event) => {
        if (!suppressClickFor || !event.target?.closest?.("[data-press-info], [title], [aria-label]")?.isSameNode(suppressClickFor)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClickFor = null;
    }, true);
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
