import { getSettings, saveSettings } from "./core.js";
import { ensureGameModeState, flashTracker, renderModeHud } from "./gameModeManager.js";

function normalizeStat(statString) {
    const raw = String(statString || "").trim().toLowerCase();
    if (["hp", "health", "hitpoints", "hit_points"].includes(raw)) return { cur: "hp", max: "maxHp", hud: "hp" };
    if (["ap", "action", "actionpoints", "action_points"].includes(raw)) return { cur: "ap", max: "maxAp", hud: "ap" };
    if (["mp", "mana", "magic"].includes(raw)) return { cur: "mp", max: "maxMp", hud: "mp" };
    if (["stamina", "sta", "sp", "energy"].includes(raw)) return { cur: "stamina", max: "maxStamina", hud: "stamina" };
    return { cur: raw, max: `max${raw.charAt(0).toUpperCase()}${raw.slice(1)}`, hud: raw };
}

function tryNotify(message, title = "Penalty") {
    try { window.toastr?.warning?.(message, title); } catch (_) {
        try { window.showToast?.(message, 4200); } catch (_) {}
    }
}

function resolveSavePath(s) {
    return String(s?.world?.saveFilePath || s?.saveFilePath || s?.localSavePath || "").trim();
}

function deletePermadeathSave(s) {
    const savePath = resolveSavePath(s);
    if (!savePath) return false;
    try {
        const req = typeof window !== "undefined" && typeof window.require === "function" ? window.require : (typeof require === "function" ? require : null);
        if (!req) return false;
        const fs = req("fs");
        if (!fs || typeof fs.unlinkSync !== "function") return false;
        fs.unlinkSync(savePath);
        return true;
    } catch (e) {
        try { console.error("[UIE] Permadeath save deletion failed", e); } catch (_) {}
        return false;
    }
}

function showGameOverOverlay(deleted) {
    let overlay = document.getElementById("uie-game-over-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "uie-game-over-overlay";
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div class="uie-game-over-card"><h1>Game Over</h1><p>${deleted ? "Permadeath save deleted." : "Your HP has reached zero."}</p><button id="uie-game-over-main-menu">Return to Main Menu</button></div>`;
    overlay.style.display = "grid";
    const btn = document.getElementById("uie-game-over-main-menu");
    if (btn) btn.onclick = () => {
        try { overlay.style.display = "none"; } catch (_) {}
        try { document.getElementById("uie-device-window")?.remove(); } catch (_) {}
        try { document.getElementById("uie-main-menu")?.show?.(); } catch (_) {}
    };
}

function ensurePenaltyStyles() {
    if (document.getElementById("uie-penalty-style")) return;
    const style = document.createElement("style");
    style.id = "uie-penalty-style";
    style.textContent = `
#uie-game-over-overlay{position:fixed;inset:0;z-index:2147483645;display:none;place-items:center;background:radial-gradient(circle at center,rgba(110,0,20,.45),rgba(0,0,0,.92));color:#fff}
.uie-game-over-card{width:min(460px,92vw);padding:30px;border:1px solid rgba(255,80,100,.45);border-radius:22px;background:rgba(12,8,12,.94);text-align:center;box-shadow:0 30px 90px rgba(0,0,0,.65)}
.uie-game-over-card h1{margin:0 0 10px;font-size:44px;letter-spacing:.08em;text-transform:uppercase;color:#ff5964}
.uie-game-over-card button{border:0;border-radius:999px;padding:11px 18px;background:#ff5964;color:#fff;font-weight:900;cursor:pointer}`;
    document.head.appendChild(style);
}

export function applyStatLoss(statString, amount) {
    const s = ensureGameModeState(getSettings());
    const stat = normalizeStat(statString);
    const loss = Math.max(0, Number(amount || 0));
    const cur = Number(s[stat.cur] || 0);
    s[stat.cur] = Math.max(0, cur - loss);
    saveSettings();
    renderModeHud();
    flashTracker(stat.hud);
    checkDeathState();
    return s[stat.cur];
}

export function applyDebuff(debuffName, ruleset = {}) {
    const s = ensureGameModeState(getSettings());
    const name = String(debuffName || "Debuff").trim() || "Debuff";
    if (!Array.isArray(s.world.debuffs)) s.world.debuffs = [];
    const existing = s.world.debuffs.find((d) => String(d?.name || "").toLowerCase() === name.toLowerCase());
    const next = {
        id: existing?.id || `debuff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name,
        icon: String(ruleset?.icon || "☠"),
        ruleset: ruleset && typeof ruleset === "object" ? ruleset : {},
        appliedAt: existing?.appliedAt || Date.now(),
        lastTickAt: Date.now(),
    };
    if (existing) Object.assign(existing, next);
    else s.world.debuffs.push(next);
    saveSettings();
    renderModeHud();
    return next;
}

export function processDebuffTicks(hours) {
    const elapsed = Math.max(0, Number(hours || 0));
    if (elapsed <= 0) return false;
    const s = ensureGameModeState(getSettings());
    const debuffs = Array.isArray(s.world?.debuffs) ? s.world.debuffs : [];
    let changed = false;
    for (const debuff of debuffs) {
        const ruleset = debuff?.ruleset && typeof debuff.ruleset === "object" ? debuff.ruleset : {};
        const perHour = ruleset.perHour && typeof ruleset.perHour === "object" ? ruleset.perHour : null;
        if (perHour) {
            for (const [statName, rawAmount] of Object.entries(perHour)) {
                const amount = Math.max(0, Number(rawAmount || 0)) * elapsed;
                if (amount <= 0) continue;
                const stat = normalizeStat(statName);
                s[stat.cur] = Math.max(0, Number(s[stat.cur] || 0) - amount);
                changed = true;
            }
        } else if (ruleset.stat) {
            const amount = Math.max(0, Number(ruleset.amountPerHour ?? ruleset.amount ?? 0)) * elapsed;
            if (amount > 0) {
                const stat = normalizeStat(ruleset.stat);
                s[stat.cur] = Math.max(0, Number(s[stat.cur] || 0) - amount);
                changed = true;
            }
        }
        debuff.lastTickAt = Date.now();
    }
    if (changed) {
        saveSettings();
        renderModeHud();
        checkDeathState();
    }
    return changed;
}

export function checkDeathState() {
    ensurePenaltyStyles();
    const s = ensureGameModeState(getSettings());
    if (Number(s.hp || 0) > 0) return false;
    const deleted = s.world?.permadeath === true ? deletePermadeathSave(s) : false;
    showGameOverOverlay(deleted);
    tryNotify(deleted ? "Permadeath save deleted." : "HP reached zero.", "Game Over");
    return true;
}

export function initPenaltyManager() {
    ensurePenaltyStyles();
    ensureGameModeState(getSettings());
    try { window.UIE = window.UIE || {}; window.UIE.penalties = { applyStatLoss, applyDebuff, processDebuffTicks, checkDeathState }; } catch (_) {}
}
