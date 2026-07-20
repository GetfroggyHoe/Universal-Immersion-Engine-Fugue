import { getSettings } from "./core.js";

let observer = null;
let resizeObserver = null;
let frame = 0;

function enabled() {
  try { return getSettings()?.rpgSettings?.dynamicResponseBoxesEnabled === true; } catch (_) { return false; }
}

function responseBox() {
  return document.getElementById("message-box");
}

export function refreshDynamicResponseBox() {
  if (typeof document === "undefined") return 0;
  const root = document.documentElement;
  const box = responseBox();
  const isEnabled = enabled();
  root.classList.toggle("uie-dynamic-response-boxes", isEnabled);
  root.dataset.dynamicResponseBoxes = isEnabled ? "enabled" : "disabled";
  if (!box || !isEnabled) {
    box?.style.removeProperty("--uie-dynamic-response-height");
    return 0;
  }
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const viewport = Math.max(320, window.visualViewport?.height || window.innerHeight || 720);
    const compactMin = viewport < 560 ? 58 : 86;
    const cap = Math.max(compactMin, Math.min(viewport * (viewport < 560 ? 0.28 : 0.42), viewport < 560 ? 180 : 430));
    const priorHeight = box.style.height;
    box.style.height = "auto";
    const natural = Math.ceil(Math.max(box.scrollHeight, box.querySelector(".uie-dialogue-card")?.scrollHeight || 0) + 2);
    box.style.height = priorHeight;
    const target = Math.max(compactMin, Math.min(cap, natural));
    box.style.setProperty("--uie-dynamic-response-height", `${target}px`);
    box.dataset.dynamicResponseOverflow = natural > cap ? "scroll" : "fit";
  });
  return 1;
}

export function initDynamicResponseBox() {
  if (typeof window === "undefined" || observer) return;
  const mount = () => {
    const box = responseBox();
    if (!box) return false;
    observer = new MutationObserver(refreshDynamicResponseBox);
    observer.observe(box, { childList: true, subtree: true, characterData: true });
    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(refreshDynamicResponseBox);
      box.querySelectorAll(".uie-dialogue-text,.uie-dialogue-card").forEach((node) => resizeObserver.observe(node));
    }
    refreshDynamicResponseBox();
    return true;
  };
  if (!mount()) {
    const bodyObserver = new MutationObserver(() => { if (mount()) bodyObserver.disconnect(); });
    bodyObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  window.addEventListener("resize", refreshDynamicResponseBox, { passive: true });
  window.addEventListener("orientationchange", refreshDynamicResponseBox, { passive: true });
  window.addEventListener("uie:rpg_settings_changed", refreshDynamicResponseBox);
  window.UIE_dynamicResponseBox = { init: initDynamicResponseBox, refresh: refreshDynamicResponseBox, isEnabled: enabled };
}

