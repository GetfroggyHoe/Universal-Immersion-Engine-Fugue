/*
 * Gameplay overlay ownership.
 *
 * Full-screen game applications (Inventory, Organizations, Party, Battle,
 * Surroundings, Settings, Persona, NPC Management, Journal, Calendar,
 * Card Forge, Map editor, ...) OWN the real visible viewport. They are
 * placed directly under #game-overlay-root and are never scaled, never
 * centered, never given a fixed desktop reference size.
 *
 * Only genuine small dialogs (confirmations, prompts, short editors) may be
 * centered and sized. Full-screen apps use CSS Grid/Flexbox for layout.
 */

const FULLSCREEN_CLASS = "uie-fullscreen-app";

const GAMEPLAY_SELECTOR = [
  ".uie-window",
  "#uie-inventory-window",
  "#uie-factions-window",
  "#uie-party-window",
  ".modal-overlay",
  ".uie-map-modal",
  ".uie-rune-lock",
  ".uie-location-discovery",
  ".party-cropper-overlay",
  "#uie-party-member-modal",
  "#uie-party-tracker-modal",
  "#uie-class-reset-modal",
  "#uie-rebirth-modal",
  "#uie-create-station-overlay",
  ".uie-modal",
  ".uie-overlay",
  ".uie-full-modal",
  ".life-modal",
  "#chatlog-modal",
  "#map-move-modal",
  "#re-screen-minimap",
  "#uie-quick-bag-overlay",
  "#screen-popup-overlay",
  "#ui-toast-wrap",
  "#toast-container",
  "#immersive-nav-popup",
  "#uie-nav-tutorial-modal",
  "#uie-barrier-inspection",
  ".re-movement-fade",
].join(",");

const FULLSCREEN_GAMEPLAY_WINDOWS = new Set([
  "uie-inventory-window",
  "uie-factions-window",
  "uie-party-window",
  "uie-surroundings-window",
  "uie-settings-window",
  "persona-modal",
  "uie-npc-management-modal",
  "uie-journal-window",
  "uie-calendar-window",
  "uie-card-manager",
  "uie-card-editor",
  "uie-map-editor-window",
  "battle-screen",
  "uie-battle-window",
]);

const BODY_LEVEL_IDS = new Set([
  "loading",
  "rotate-overlay",
  "startup-modal",
  "main-api-setup-modal",
  "load-state-modal",
  "config-modal",
  "uie-settings-window",
  "uie-newgame-overlay",
  "uie-presets-gallery-overlay",
  "uie-ng-card-picker-overlay",
]);

const NON_BLOCKING_IDS = new Set([
  "re-screen-minimap",
  "uie-quick-bag-overlay",
  "ui-toast-wrap",
  "toast-container",
  "immersive-nav-popup",
]);

const DESKTOP_REFERENCE_SIZES = new Map([
  ["uie-settings-window", [1040, 845]],
  ["uie-map-window", [1180, 760]],
  ["uie-inventory-window", [1536, 864]],
  ["uie-factions-window", [1536, 864]],
  ["uie-party-window", [1536, 864]],
  ["uie-phone-window", [430, 760]],
  ["uie-stats-window", [800, 650]],
  ["uie-activities-window", [980, 760]],
  ["uie-diary-window", [980, 720]],
  ["uie-journal-window", [1040, 760]],
  ["uie-calendar-window", [1100, 760]],
  ["uie-social-window", [1100, 760]],
  ["uie-npc-management-modal", [1040, 760]],
  ["uie-card-manager", [1100, 760]],
  ["uie-card-editor", [1100, 760]],
]);

const PANEL_SELECTOR = [
  ":scope > .modal-card",
  ":scope > .uie-modal-card",
  ":scope > .modal-content",
  ":scope > .modal-panel",
  ":scope > .modal-window",
  ":scope > .box",
  ":scope > [role='dialog']",
  ":scope > .uie-map-modal__panel",
  ":scope > .uie-focus-workspace",
].join(",");

const originalPanelStyles = new WeakMap();

let initialized = false;
let observer = null;
let visibilityFrame = 0;
let resizeFrame = 0;

function overlayRoot() {
  return document.getElementById("game-overlay-root");
}

function isBodyLevelUi(node, selector = "") {
  if (!(node instanceof Element)) return true;
  if (BODY_LEVEL_IDS.has(node.id)) return true;
  if (String(selector || "") === "#uie-settings-window") return true;
  return Boolean(node.closest(Array.from(BODY_LEVEL_IDS, (id) => `#${id}`).join(",")));
}

function isGameplayCandidate(node, selector = "") {
  if (!(node instanceof Element) || isBodyLevelUi(node, selector)) return false;
  if (node.matches(GAMEPLAY_SELECTOR)) return true;
  return false;
}

function directGameplayCandidates(scope) {
  const candidates = [];
  if (scope instanceof Element && isGameplayCandidate(scope)) candidates.push(scope);
  scope.querySelectorAll?.(GAMEPLAY_SELECTOR).forEach((node) => {
    if (!isGameplayCandidate(node)) return;
    if (node.parentElement?.closest?.(GAMEPLAY_SELECTOR) &&
        !node.parentElement?.closest?.("#game-root, #game-overlay-root")) return;
    candidates.push(node);
  });
  return candidates;
}

function markFullscreenWindow(node) {
  if (!FULLSCREEN_GAMEPLAY_WINDOWS.has(node.id)) return;
  node.classList.add(FULLSCREEN_CLASS);
  node.dataset.gameplayFullscreen = "true";
  node.dataset.fullscreen = "true";
}

/* A full-screen application must never be scaled or center-fitted. */
function isFullscreenApp(node) {
  if (!(node instanceof Element)) return false;
  if (FULLSCREEN_GAMEPLAY_WINDOWS.has(node.id)) return true;
  return node.classList.contains(FULLSCREEN_CLASS);
}

export function mountGameplayOverlay(node, selector = "") {
  const root = overlayRoot();
  if (!root || !isGameplayCandidate(node, selector)) return false;
  markFullscreenWindow(node);
  if (node.parentElement !== root) root.appendChild(node);
  node.dataset.gameplayOverlay = "true";
  scheduleVisibilityUpdate();
  return true;
}

function discoverGameplayOverlays(scope = document) {
  directGameplayCandidates(scope).forEach((node) => mountGameplayOverlay(node));
}

function isVisible(node) {
  if (!(node instanceof Element) || node.hidden || node.getAttribute("aria-hidden") === "true") return false;
  const inlineDisplay = String(node.style.display || "").trim().toLowerCase();
  if (inlineDisplay === "none") return false;
  const style = getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden";
}

function isMobileLandscape() {
  return window.matchMedia("(pointer: coarse)").matches &&
    window.matchMedia("(orientation: landscape)").matches;
}

function panelFor(node) {
  if (!(node instanceof Element) || NON_BLOCKING_IDS.has(node.id)) return null;
  /* Full-screen game applications own the viewport directly. They must
   * never be fitted, scaled, or center-fixed by this system. */
  if (isFullscreenApp(node)) return null;
  if (node.id === "uie-map-window") return node.querySelector(":scope > .uie-simple-map__shell");
  if (FULLSCREEN_GAMEPLAY_WINDOWS.has(node.id)) return node;
  if (node.matches(".uie-window, #uie-settings-window, #uie-npc-management-modal, #uie-card-manager, #uie-card-editor")) return node;
  return node.querySelector(PANEL_SELECTOR);
}

function rememberPanelStyles(panel) {
  if (originalPanelStyles.has(panel)) return;
  const names = [
    "position", "inset", "top", "right", "bottom", "left", "width", "height",
    "max-width", "max-height", "margin", "transform", "transform-origin", "zoom",
  ];
  originalPanelStyles.set(panel, names.map((name) => ({
    name,
    value: panel.style.getPropertyValue(name),
    priority: panel.style.getPropertyPriority(name),
  })));
}

function restorePanel(panel) {
  const saved = originalPanelStyles.get(panel);
  if (!saved) return;
  for (const { name, value, priority } of saved) {
    if (value) panel.style.setProperty(name, value, priority);
    else panel.style.removeProperty(name);
  }
  panel.removeAttribute("data-uie-modal-fit");
  panel.style.removeProperty("--uie-modal-fit");
  originalPanelStyles.delete(panel);
}

function finiteSize(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function fitDesktopModal(panel) {
  if (!(panel instanceof Element)) return;
  /* Full-screen game applications never receive desktop reference sizing,
     scaling, or centering. If one slipped through, just restore it and
     let the .uie-fullscreen-app CSS own the viewport. */
  if (isFullscreenApp(panel) || isFullscreenApp(panel.closest?.(".uie-fullscreen-app"))) {
    restorePanel(panel);
    return;
  }
  if (!isMobileLandscape()) {
    restorePanel(panel);
    return;
  }

  rememberPanelStyles(panel);
  const referenceId = panel.id || panel.closest("[id]")?.id || "";
  const reference = DESKTOP_REFERENCE_SIZES.get(referenceId) || [];
  const computed = getComputedStyle(panel);
  const measuredWidth = Math.max(panel.scrollWidth || 0, panel.offsetWidth || 0);
  const measuredHeight = Math.max(panel.scrollHeight || 0, panel.offsetHeight || 0);
  const desktopWidth = finiteSize(panel.dataset.desktopWidth,
    finiteSize(reference[0], finiteSize(computed.width, measuredWidth || 760)));
  const desktopHeight = finiteSize(panel.dataset.desktopHeight,
    finiteSize(reference[1], finiteSize(computed.height, measuredHeight || 620)));

  const viewport = window.visualViewport;
  const viewportWidth = viewport?.width || window.innerWidth;
  const viewportHeight = viewport?.height || window.innerHeight;
  const fit = Math.min(1, (viewportWidth - 24) / desktopWidth, (viewportHeight - 24) / desktopHeight);
  const isStandalone = FULLSCREEN_GAMEPLAY_WINDOWS.has(panel.id) ||
    panel.matches(".uie-window, .uie-simple-map__shell, #uie-settings-window, #uie-npc-management-modal, #uie-card-manager, #uie-card-editor");

  panel.dataset.desktopWidth = String(desktopWidth);
  panel.dataset.desktopHeight = String(desktopHeight);
  panel.dataset.uieModalFit = "true";
  panel.style.setProperty("width", `${desktopWidth}px`, "important");
  panel.style.setProperty("height", `${desktopHeight}px`, "important");
  panel.style.setProperty("max-width", "none", "important");
  panel.style.setProperty("max-height", "none", "important");
  panel.style.setProperty("zoom", "1", "important");
  panel.style.setProperty("transform-origin", "center center", "important");

  if (isStandalone) {
    panel.style.setProperty("position", "fixed", "important");
    panel.style.setProperty("inset", "auto", "important");
    panel.style.setProperty("left", "50%", "important");
    panel.style.setProperty("top", "50%", "important");
    panel.style.setProperty("right", "auto", "important");
    panel.style.setProperty("bottom", "auto", "important");
    panel.style.setProperty("margin", "0", "important");
  }

  if (fit < 0.999) {
    panel.style.setProperty("--uie-modal-fit", String(fit));
    panel.style.setProperty("transform", `${isStandalone ? "translate(-50%, -50%) " : ""}scale(${fit})`, "important");
  } else if (isStandalone) {
    panel.style.setProperty("transform", "translate(-50%, -50%)", "important");
  } else {
    panel.style.removeProperty("transform");
  }
}

function updateModalFits() {
  resizeFrame = 0;
  const candidates = new Set([
    ...document.querySelectorAll(`${GAMEPLAY_SELECTOR}, #uie-settings-window, #uie-npc-management-modal, #uie-card-manager, #uie-card-editor`),
  ]);
  for (const node of candidates) {
    const panel = panelFor(node);
    if (!panel) continue;
    if (isVisible(node)) fitDesktopModal(panel);
    else restorePanel(panel);
  }
}

function scheduleModalFits() {
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(updateModalFits);
}

function updateMajorModalState() {
  visibilityFrame = 0;
  const root = overlayRoot();
  if (!root) return;
  const gameplayMajorOpen = Array.from(root.children).some((node) =>
    isVisible(node) && !NON_BLOCKING_IDS.has(node.id) &&
    (FULLSCREEN_GAMEPLAY_WINDOWS.has(node.id) ||
      node.matches(".uie-window, .modal-overlay, .uie-map-modal, .uie-modal, .uie-overlay, .uie-full-modal, .life-modal, .party-cropper-overlay"))
  );
  const bodyMajorOpen = [
    document.getElementById("uie-settings-window"),
    document.getElementById("uie-npc-management-modal"),
    document.getElementById("uie-card-manager"),
    document.getElementById("uie-card-editor"),
  ].some(isVisible);
  const majorOpen = gameplayMajorOpen || bodyMajorOpen;
  document.body?.classList.toggle("game-major-modal-open", majorOpen);
  scheduleModalFits();
}

function scheduleVisibilityUpdate() {
  if (visibilityFrame) return;
  visibilityFrame = requestAnimationFrame(updateMajorModalState);
}

export function initModalViewportSystem() {
  if (initialized) return;
  initialized = true;
  discoverGameplayOverlays(document);

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) discoverGameplayOverlays(node);
      });
    }
    scheduleVisibilityUpdate();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "hidden", "aria-hidden"],
  });

  window.UIE_mountGameplayOverlay = mountGameplayOverlay;
  window.UIE_updateModalScales = () => {
    scheduleVisibilityUpdate();
    scheduleModalFits();
  };
  window.UIE_fitDesktopModal = fitDesktopModal;
  window.UIE_getManagedModals = () => Array.from(overlayRoot()?.children || []).map((node) => ({
    selector: node.id ? `#${node.id}` : node.className,
    open: isVisible(node),
    scale: 1,
    sharedRoot: true,
  }));
  scheduleVisibilityUpdate();
  window.addEventListener("resize", scheduleModalFits, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleModalFits, { passive: true });
  window.visualViewport?.addEventListener("scroll", scheduleModalFits, { passive: true });
}

export function destroyModalViewportSystem() {
  observer?.disconnect();
  observer = null;
  cancelAnimationFrame(visibilityFrame);
  cancelAnimationFrame(resizeFrame);
  visibilityFrame = 0;
  resizeFrame = 0;
  initialized = false;
}
