
import { getSettings, saveSettings } from "../core.js";

/**
 * RP log / injection helper for the game chat pipeline.
 * Inventory actions (USE/EQUIP/etc) can inject lines the model should see.
 * Supports "hidden from user" injection via a buffer.
 */

// Buffer for events that should be hidden from UI but sent to AI
export const hiddenEventBuffer = [];

export function peekHiddenEvents() {
    if (hiddenEventBuffer.length === 0) return "";
    return hiddenEventBuffer.join("\n");
}

export function flushHiddenEvents() {
    if (hiddenEventBuffer.length === 0) return "";
    const events = [...hiddenEventBuffer];
    hiddenEventBuffer.length = 0; // Clear buffer
    try { window.UIE_rpBufferLen = 0; } catch (_) {}
    return events.join("\n");
}

export function resetRpEventBuffer() {
    hiddenEventBuffer.length = 0;
    try {
        window.UIE_rpBufferLen = 0;
        window.UIE_rpLastBufferedAt = 0;
    } catch (_) {}
}

export async function injectRpEvent(text, opts = {}) {
  const msg = String(text || "").trim();
  if (!msg) return false;

  // Always buffer for AI context
  hiddenEventBuffer.push(msg);
  try {
    window.UIE_rpBufferLen = hiddenEventBuffer.length;
    window.UIE_rpLastBufferedAt = Date.now();
  } catch (_) {}

  // Save to System Events for the Chat Log System Tab
  try {
    const s = getSettings();
    if (s && s.ui) {
      if (!Array.isArray(s.ui.systemEvents)) s.ui.systemEvents = [];
      s.ui.systemEvents.push({ text: msg, ts: Date.now() });
      if (s.ui.systemEvents.length > 200) s.ui.systemEvents.shift();
      saveSettings();
    }
  } catch (_) {}

  // Show Toast
  try { if (window.toastr) window.toastr.info(msg); } catch (_) {}

  // Trigger update immediately so prompt is ready before user types
  try { $(document).trigger("uie:events-buffered"); } catch (_) {}
  
  return true;
}
