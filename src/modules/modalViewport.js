const MODAL_CONFIGS = [
  ["#uie-inventory-window", 1156, 906],
  ["#chatlog-modal", 760, 560],
  ["#uie-journal-window", 1296, 810],
  ["#uie-diary-window", 880, 640],
  ["#uie-settings-window", 980, 820],
  ["#uie-party-window", 1440, 810],
  ["#uie-factions-window", 1440, 810],
  ["#uie-npc-management-modal", 1200, 800],
  ["#uie-battle-window", 1440, 810],
  ["#uie-battle-overlay", 1440, 810],
  ["#uie-map-window", 1200, 800],
  ["#uie-world-window", 1200, 800],
  ["#uie-social-window", 1200, 800],
  ["#uie-databank-window", 1200, 800],
  ["#uie-calendar-window", 1100, 760],
  ["#uie-activities-window", 1200, 800],
  ["#uie-stats-window", 800, 650],
  ["#uie-tracker-window", 1150, 760],
  ["#uie-sprites-window", 1200, 800],
  ["#uie-shop-window", 1100, 760],
  ["#uie-trade-window", 1100, 720],
  ["#uie-you-window", 1100, 760],
  ["#uie-library-window", 800, 600],
  ["#uie-phone-window", 390, 760],
  ["#uie-chatbox-window", 900, 680],
  ["#uie-mmo-chat-window", 900, 680],
  ["#uie-lfg-window", 900, 680],
  ["#uie-schedules-window", 820, 700],
  ["#uie-atmosphere-window", 1000, 760],
  ["#uie-debug-window", 1000, 720],
  ["#uie-launcher-options-window", 420, 600],
  ["#uie-card-manager", 1200, 800],
  ["#uie-card-editor", 1100, 800],
  ["#battle-screen", 1440, 810],
];

const DIALOG_CONFIGS = [
  ["#startup-modal", 680, 465],
  ["#config-modal", 1000, 820],
  ["#main-api-setup-modal", 720, 650],
  ["#load-state-modal", 720, 650],
  ["#edit-room-modal", 1100, 800],
  ["#physical-world-modal", 1100, 800],
  ["#war-room-modal", 1200, 800],
  ["#persona-modal", 1080, 820],
  ["#time-weather-modal", 760, 650],
  ["#music-modal", 760, 650],
  ["#scene-cards-modal", 1000, 760],
  ["#scene-card-action-modal", 720, 650],
  ["#map-move-modal", 720, 650],
  ["#image-gallery-modal", 1000, 760],
  ["#group-scene-modal", 1000, 760],
  ["#room-action-modal", 720, 650],
  ["#persona-expressions-modal", 900, 720],
  ["#persona-family-member-modal", 900, 720],
  [".uie-help-manual-modal", 980, 860],
];

const managed = new Map();
let frame = 0;
let initialized = false;
let observer = null;

function viewportBounds() {
  const viewport = window.visualViewport;
  return {
    left: Number.isFinite(viewport?.offsetLeft) ? viewport.offsetLeft : 0,
    top: Number.isFinite(viewport?.offsetTop) ? viewport.offsetTop : 0,
    width: Number.isFinite(viewport?.width) ? viewport.width : window.innerWidth,
    height: Number.isFinite(viewport?.height) ? viewport.height : window.innerHeight,
  };
}

function validDimension(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeCanvasContent(content) {
  if (!content) return;
  const fixed = {
    position: "absolute",
    top: "0px",
    right: "0px",
    bottom: "0px",
    left: "0px",
    width: "100%",
    height: "100%",
    "min-width": "0px",
    "min-height": "0px",
    "max-width": "none",
    "max-height": "none",
    margin: "0px",
    transform: "none",
    "transform-origin": "center center",
    zoom: "1",
    "box-sizing": "border-box",
  };
  Object.entries(fixed).forEach(([property, value]) => {
    if (content.style.getPropertyValue(property) === value &&
        content.style.getPropertyPriority(property) === "important") return;
    content.style.setProperty(property, value, "important");
  });
}

function rootIsOpen(root) {
  if (!root || root.hidden || root.getAttribute("aria-hidden") === "true") return false;
  const inlineDisplay = String(root.style.display || "").trim().toLowerCase();
  if (inlineDisplay === "none") return false;
  return getComputedStyle(root).display !== "none";
}

function updateModalScale(record) {
  const { overlay, canvas, root } = record;
  const canvasContent = record.content || root;
  if (canvasContent.parentElement !== canvas) canvas.appendChild(canvasContent);
  normalizeCanvasContent(canvasContent);
  const designWidth = validDimension(canvas.dataset.designWidth, 1100);
  const designHeight = validDimension(canvas.dataset.designHeight, 760);
  const viewport = viewportBounds();
  const padding = 16;
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const scale = Math.min(availableWidth / designWidth, availableHeight / designHeight, 1);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

  overlay.style.left = `${viewport.left}px`;
  overlay.style.top = `${viewport.top}px`;
  overlay.style.width = `${viewport.width}px`;
  overlay.style.height = `${viewport.height}px`;
  canvas.style.setProperty("--modal-scale", String(safeScale));
  record.scale = safeScale;

  const open = rootIsOpen(root);
  overlay.classList.toggle("is-open", open);
  overlay.setAttribute("aria-hidden", open ? "false" : "true");
  return open;
}

function updateAllModalScales() {
  frame = 0;
  let anyOpen = false;
  managed.forEach((record) => {
    anyOpen = updateModalScale(record) || anyOpen;
  });
  document.body?.classList.toggle("game-major-modal-open", anyOpen);
}

function scheduleModalScaleUpdate() {
  if (frame) return;
  frame = requestAnimationFrame(updateAllModalScales);
}

function ensureRotateBlocker() {
  if (document.getElementById("uie-rotate-device-blocker")) return;
  const blocker = document.createElement("div");
  blocker.id = "uie-rotate-device-blocker";
  blocker.innerHTML = "<div><div style=\"font-size:42px;margin-bottom:12px\">↻</div>Rotate your device to landscape to continue.</div>";
  document.body.appendChild(blocker);
}

function manageModal(root, selector, designWidth, designHeight) {
  if (!root || managed.has(root) || root.closest(".game-modal-desktop-canvas")) return;

  const overlay = document.createElement("div");
  overlay.className = "game-modal-overlay";
  overlay.dataset.modalSelector = selector;
  overlay.setAttribute("role", "presentation");
  overlay.setAttribute("aria-hidden", "true");

  const viewport = document.createElement("div");
  viewport.className = "game-modal-viewport";

  const canvas = document.createElement("div");
  canvas.className = "game-modal-desktop-canvas";
  canvas.dataset.modalSelector = selector;
  canvas.dataset.designWidth = String(validDimension(designWidth, 1100));
  canvas.dataset.designHeight = String(validDimension(designHeight, 760));
  canvas.style.setProperty("--modal-design-width", canvas.dataset.designWidth);
  canvas.style.setProperty("--modal-design-height", canvas.dataset.designHeight);

  overlay.appendChild(viewport);
  viewport.appendChild(canvas);
  document.body.appendChild(overlay);
  canvas.appendChild(root);
  root.classList.add("game-modal-scaled-root");
  root.dataset.modalViewportManaged = "true";
  normalizeCanvasContent(root);

  const record = { root, overlay, viewport, canvas, selector, scale: 1 };
  const rootObserver = new MutationObserver(scheduleModalScaleUpdate);
  rootObserver.observe(root, {
    attributes: true,
    attributeFilter: ["style", "class", "hidden", "aria-hidden"],
  });
  record.observer = rootObserver;
  managed.set(root, record);
  scheduleModalScaleUpdate();
}

function dialogContent(host) {
  return host.querySelector(":scope > .modal-card, :scope > .uie-modal-card, :scope > .tw-modal-card, :scope > [role='dialog']") ||
    Array.from(host.children).find((child) =>
      child instanceof HTMLElement && !["STYLE", "SCRIPT", "TEMPLATE"].includes(child.tagName)
    );
}

function manageDialogHost(host, selector, designWidth, designHeight) {
  if (!host || managed.has(host) || host.closest(".game-modal-desktop-canvas")) return;
  const content = dialogContent(host);
  if (!content) return;

  const viewport = document.createElement("div");
  viewport.className = "game-modal-viewport";
  const canvas = document.createElement("div");
  canvas.className = "game-modal-desktop-canvas";
  canvas.dataset.modalSelector = selector;
  canvas.dataset.designWidth = String(validDimension(designWidth, 900));
  canvas.dataset.designHeight = String(validDimension(designHeight, 700));
  canvas.style.setProperty("--modal-design-width", canvas.dataset.designWidth);
  canvas.style.setProperty("--modal-design-height", canvas.dataset.designHeight);

  host.classList.add("game-modal-overlay", "game-modal-host");
  host.dataset.modalSelector = selector;
  host.appendChild(viewport);
  viewport.appendChild(canvas);
  canvas.appendChild(content);
  content.classList.add("game-modal-scaled-root");
  content.dataset.modalViewportManaged = "true";
  normalizeCanvasContent(content);
  host.dataset.modalViewportManaged = "true";

  const record = { root: host, overlay: host, viewport, canvas, content, selector, scale: 1 };
  const rootObserver = new MutationObserver(scheduleModalScaleUpdate);
  rootObserver.observe(host, {
    attributes: true,
    attributeFilter: ["style", "class", "hidden", "aria-hidden"],
  });
  record.observer = rootObserver;
  managed.set(host, record);
  scheduleModalScaleUpdate();
}

function discoverModals(scope = document) {
  for (const [selector, width, height] of MODAL_CONFIGS) {
    const nodes = [];
    if (scope instanceof Element && scope.matches(selector)) nodes.push(scope);
    scope.querySelectorAll?.(selector).forEach((node) => nodes.push(node));
    nodes.forEach((root) => manageModal(root, selector, width, height));
  }
  for (const [selector, width, height] of DIALOG_CONFIGS) {
    const nodes = [];
    if (scope instanceof Element && scope.matches(selector)) nodes.push(scope);
    scope.querySelectorAll?.(selector).forEach((node) => nodes.push(node));
    nodes.forEach((host) => manageDialogHost(host, selector, width, height));
  }
}

export function initModalViewportSystem() {
  if (initialized) return;
  initialized = true;
  ensureRotateBlocker();
  discoverModals(document);

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) discoverModals(node);
      });
    }
    scheduleModalScaleUpdate();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("resize", scheduleModalScaleUpdate, { passive: true });
  window.addEventListener("orientationchange", scheduleModalScaleUpdate, { passive: true });
  window.addEventListener("fullscreenchange", scheduleModalScaleUpdate);
  window.visualViewport?.addEventListener("resize", scheduleModalScaleUpdate, { passive: true });
  window.visualViewport?.addEventListener("scroll", scheduleModalScaleUpdate, { passive: true });

  window.UIE_updateModalScales = scheduleModalScaleUpdate;
  window.UIE_getManagedModals = () => Array.from(managed.values()).map((record) => ({
    selector: record.selector,
    open: rootIsOpen(record.root),
    scale: record.scale,
    designWidth: Number(record.canvas.dataset.designWidth),
    designHeight: Number(record.canvas.dataset.designHeight),
  }));
  scheduleModalScaleUpdate();
}

export function destroyModalViewportSystem() {
  observer?.disconnect();
  observer = null;
  managed.forEach((record) => record.observer?.disconnect());
  managed.clear();
  initialized = false;
}
