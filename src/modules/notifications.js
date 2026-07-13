import { getSettings, saveSettings } from "./core.js";

function ensureNotificationsModel(s) {
  if (!s) return;
  if (!s.ui) s.ui = {};
  if (s.ui.showPopups === undefined) s.ui.showPopups = true;
  if (!s.ui.notifications || typeof s.ui.notifications !== "object") s.ui.notifications = {};
  const n = s.ui.notifications;
  if (!n.categories || typeof n.categories !== "object") n.categories = {};
  if (!n.lowHp || typeof n.lowHp !== "object") n.lowHp = { enabled: false, threshold: 0.25, lastWarnAt: 0 };
  if (n.lowHp.enabled === undefined) n.lowHp.enabled = false;
  if (!Number.isFinite(Number(n.lowHp.threshold))) n.lowHp.threshold = 0.25;
  if (!Number.isFinite(Number(n.lowHp.lastWarnAt))) n.lowHp.lastWarnAt = 0;
  if (!n.postBattle || typeof n.postBattle !== "object") n.postBattle = { enabled: false };
  if (n.postBattle.enabled === undefined) n.postBattle.enabled = false;
  if (n.css === undefined) n.css = "";
}

export function shouldNotify(category) {
  const s = getSettings();
  ensureNotificationsModel(s);
  if (s?.ui?.showPopups === false) return false;
  if (!category) return true;
  const key = String(category || "").trim();
  if (!key) return true;
  const enabled = s.ui.notifications?.categories?.[key];
  return enabled !== false;
}

export function notify(level, message, title, category, options) {
  const s = getSettings();
  ensureNotificationsModel(s);
  
  // Ensure toast container is on top of Projection window (Z-Index fix) and does not block clicks (pointer-events)
  if (!document.getElementById("uie-toast-fix")) {
      const style = document.createElement("style");
      style.id = "uie-toast-fix";
      style.innerHTML = `
          #toast-container {
            position: fixed !important;
            top: max(12px, env(safe-area-inset-top, 0px)) !important;
            right: auto !important;
            bottom: auto !important;
            left: 50% !important;
            width: min(600px, calc(100vw - 24px)) !important;
            margin: 0 !important;
            transform: translateX(-50%) !important;
            z-index: 2147483647 !important;
            pointer-events: none !important;
          }
          #toast-container > div {
            pointer-events: auto !important;
            opacity: 1 !important;
            width: 100% !important;
            min-width: 0 !important;
            margin: 0 0 8px !important;
            padding: 16px 20px !important;
            border-radius: 12px !important;
            box-sizing: border-box !important;
            box-shadow: 0 10px 28px rgba(0,0,0,0.42);
          }
          #toast-container .toast-title { font-size: 16px !important; line-height: 1.25 !important; }
          #toast-container .toast-message { font-size: 14px !important; line-height: 1.45 !important; }
          #toast-container.toast-top-center > div { animation: uie-toast-drop .22s ease-out both !important; }
          @keyframes uie-toast-drop { from { opacity: 0; transform: translateY(-14px); } to { opacity: 1; transform: translateY(0); } }
          @media (max-width: 480px) {
            #toast-container { top: max(8px, env(safe-area-inset-top, 0px)) !important; width: calc(100vw - 16px) !important; }
            #toast-container > div { padding: 13px 15px !important; }
          }
      `;
      document.head.appendChild(style);
  }

  if (s?.ui?.showPopups === false) return;
  if (!shouldNotify(category)) return;
  if (!window.toastr) return;

  const lvl = String(level || "info");
  const fn =
    lvl === "success" ? window.toastr.success :
    lvl === "warning" ? window.toastr.warning :
    lvl === "error" ? window.toastr.error :
    window.toastr.info;

  const opts = options && typeof options === "object" ? { ...options } : {};
  opts.positionClass = "toast-top-center";
  const key = String(category || "").trim();
  if (key) {
    const safe = key.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
    const base = String(opts.toastClass || "toast");
    const parts = base.split(/\s+/).filter(Boolean);
    if (!parts.includes(`toast-uie-cat-${safe}`)) parts.push(`toast-uie-cat-${safe}`);
    opts.toastClass = parts.join(" ");
  }
  try { fn.call(window.toastr, String(message || ""), title ? String(title) : undefined, opts); } catch (_) {}
}

export function notifyLowHpIfNeeded() {
  const s = getSettings();
  ensureNotificationsModel(s);
  if (!shouldNotify("lowHp")) return;
  if (s.ui.notifications.lowHp?.enabled !== true) return;

  const hp = Number(s.hp || 0);
  const maxHp = Math.max(1, Number(s.maxHp || 100));
  const pct = hp / maxHp;
  const threshold = Math.max(0.05, Math.min(0.9, Number(s.ui.notifications.lowHp.threshold || 0.25)));
  if (pct > threshold) return;

  const now = Date.now();
  const last = Number(s.ui.notifications.lowHp.lastWarnAt || 0);
  if (now - last < 90000) return;

  s.ui.notifications.lowHp.lastWarnAt = now;
  saveSettings();
  notify("warning", `Low HP: ${Math.max(0, Math.round(pct * 100))}%`, "Warning", "lowHp");
}
