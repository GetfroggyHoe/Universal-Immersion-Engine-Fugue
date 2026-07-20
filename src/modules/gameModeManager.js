import { getSettings, saveSettings } from "./core.js";

const VALID_MODES = new Set(["lifesim", "rpg", "modern", "high-fantasy", "futuristic", "mmorpg"]);

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

export function ensureGameModeState(settings = getSettings()) {
    const s = settings || getSettings();
    if (!s.world || typeof s.world !== "object") s.world = {};
    if (!VALID_MODES.has(String(s.world.gameMode || ""))) s.world.gameMode = "lifesim";
    if (!Number.isFinite(Number(s.world.missiveTravelTime)) || Number(s.world.missiveTravelTime) <= 0) s.world.missiveTravelTime = 4;
    if (!Number.isFinite(Number(s.world.currentTime))) s.world.currentTime = Date.now();
    if (!Array.isArray(s.world.inTransitQueue)) s.world.inTransitQueue = [];
    if (!Array.isArray(s.world.debuffs)) s.world.debuffs = [];
    if (typeof s.world.permadeath !== "boolean") s.world.permadeath = s?.rpgSettings?.permadeath === true || s.permadeath === true;
    if (!s.relationships || typeof s.relationships !== "object") s.relationships = {};
    if (!Array.isArray(s.relationships.messages)) s.relationships.messages = [];
    if (!Number.isFinite(Number(s.maxHp)) || Number(s.maxHp) <= 0) s.maxHp = Number(s.inventory?.vitals?.maxHp || 100);
    if (!Number.isFinite(Number(s.hp))) s.hp = Number(s.inventory?.vitals?.hp ?? s.maxHp);
    if (!Number.isFinite(Number(s.maxAp)) || Number(s.maxAp) < 0) s.maxAp = Number(s.character?.vitals?.maxAp || 10);
    if (!Number.isFinite(Number(s.ap))) s.ap = Number(s.character?.vitals?.ap ?? s.maxAp);
    if (!Number.isFinite(Number(s.maxMp)) || Number(s.maxMp) < 0) s.maxMp = Number(s.inventory?.vitals?.maxMp || 50);
    if (!Number.isFinite(Number(s.mp))) s.mp = Number(s.inventory?.vitals?.mp ?? s.maxMp);
    if (!Number.isFinite(Number(s.maxStamina)) || Number(s.maxStamina) <= 0) s.maxStamina = Number(s.inventory?.vitals?.maxSp || 50);
    if (!Number.isFinite(Number(s.stamina))) s.stamina = Number(s.inventory?.vitals?.sp ?? s.maxStamina);
    s.hp = clamp(s.hp, 0, Math.max(0, Number(s.maxHp || 0)));
    s.ap = clamp(s.ap, 0, Math.max(0, Number(s.maxAp || 0)));
    s.mp = clamp(s.mp, 0, Math.max(0, Number(s.maxMp || 0)));
    s.stamina = clamp(s.stamina, 0, Math.max(0, Number(s.maxStamina || 0)));
    return s;
}

export function getGameMode(settings = getSettings()) {
    const s = ensureGameModeState(settings);
    return String(s.world.gameMode || "lifesim");
}

function isCodiceMode(settings = getSettings()) {
    const mode = getGameMode(settings);
    return mode === "high-fantasy" || mode === "rpg";
}

export function resolveUiTheme(settings = getSettings()) {
    const s = settings || getSettings();
    const text = `${s?.world?.gameMode || ""} ${s?.worldState?.genre || ""} ${s?.worldState?.era || ""} ${s?.worldState?.location || ""} ${s?.storyPreset?.genre || ""}`.toLowerCase();
    if (/\b(future|futuristic|cyber|sci[-\s]?fi|space|holographic|holo)\b/.test(text)) return "futuristic";
    if (/\b(school|academy|college|university|classroom|campus)\b/.test(text)) return "academic";
    if (/\b(high-fantasy|fantasy|rpg|medieval|magic|kingdom|guild)\b/.test(text)) return "fantasy";
    return "modern";
}

function genreValueForMode(mode) {
    const m = String(mode || "").toLowerCase();
    if (m === "high-fantasy" || m === "rpg") return ["high-fantasy", "fantasy", "rpg"];
    if (m === "futuristic") return ["futuristic", "sci-fi", "scifi", "science-fiction"];
    if (m === "modern" || m === "lifesim") return ["modern", "lifesim", "slice-of-life"];
    return [m].filter(Boolean);
}

function syncGenreDropdownsToGameMode(settings = getSettings()) {
    try {
        const candidates = genreValueForMode(getGameMode(settings));
        const selectors = [
            "#uie-map-style",
            "#edit-room-genre",
            "select[id*='genre' i]",
            "select[name*='genre' i]",
            "select[data-genre]",
            "select[data-uie-genre]"
        ].join(",");
        document.querySelectorAll(selectors).forEach((select) => {
            if (!(select instanceof HTMLSelectElement)) return;
            const values = Array.from(select.options).map((option) => String(option.value || "").toLowerCase());
            const match = candidates.find((value) => values.includes(value));
            if (!match || String(select.value || "").toLowerCase() === match) return;
            select.value = match;
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });
    } catch (_) {}
}

export function setGameMode(mode) {
    const s = ensureGameModeState(getSettings());
    const next = VALID_MODES.has(String(mode || "")) ? String(mode) : "lifesim";
    s.world.gameMode = next;
    saveSettings();
    renderModeHud();
    syncGenreDropdownsToGameMode(s);
    try { window.dispatchEvent(new CustomEvent("uie:game_mode_changed", { detail: { gameMode: next } })); } catch (_) {}
    return next;
}

function getTrackerConfig(s) {
    if (getGameMode(s) === "rpg") {
        return [
            { key: "hp", label: "HP", cur: s.hp, max: s.maxHp, color: "#ff5964", sources: ["story", "item"] },
            { key: "ap", label: "AP", cur: s.ap, max: s.maxAp, color: "#ffd166", sources: ["story", "item"] },
            { key: "mp", label: "MP", cur: s.mp, max: s.maxMp, color: "#7b8cff", sources: ["story", "item", "time"] },
        ];
    }
    return [
        { key: "hp", label: "HP", cur: s.hp, max: s.maxHp, color: "#ff5964", sources: ["story", "item"] },
        { key: "stamina", label: "Stamina", cur: s.stamina, max: s.maxStamina, color: "#5eead4", sources: ["time", "story", "item"] },
    ];
}

function ensureHudHost() {
    let hud = document.getElementById("hud");
    if (!hud) {
        hud = document.createElement("div");
        hud.id = "hud";
        document.body.appendChild(hud);
    }
    let host = document.getElementById("uie-mode-hud");
    if (!host) {
        host = document.createElement("div");
        host.id = "uie-mode-hud";
        hud.prepend(host);
    }
    return host;
}

function ensureModeHudStyles() {
    if (document.getElementById("uie-mode-hud-style")) return;
    const style = document.createElement("style");
    style.id = "uie-mode-hud-style";
    style.textContent = `
#uie-mode-hud{display:flex;flex-direction:column;gap:5px;width:min(210px,calc(100vw - 32px));pointer-events:auto;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.uie-mode-bar{background:linear-gradient(180deg,rgba(13,20,32,.58),rgba(8,13,23,.42));border:1px solid rgba(221,236,255,.32);border-left:3px solid var(--bar-color,#6fd3ff);border-radius:7px;padding:5px 7px;box-shadow:0 9px 21px rgba(0,0,0,.26),inset 0 1px rgba(255,255,255,.18);backdrop-filter:blur(14px) saturate(1.2)}
.uie-mode-bar-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;font-weight:900;letter-spacing:0;text-transform:uppercase;color:#f8fbff!important;text-shadow:0 1px 2px rgba(0,0,0,.72)}
.uie-mode-bar-head span{color:#f8fbff!important}
.uie-mode-bar-track{height:7px;margin-top:4px;border-radius:999px;background:rgba(232,242,255,.22);overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.24)}
.uie-mode-bar-fill{height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,var(--bar-color,#6fd3ff),rgba(255,255,255,.78));transition:width .22s ease;box-shadow:0 0 12px var(--bar-color,#6fd3ff)}
.uie-mode-bar-sources{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}
.uie-mode-source{font-size:9px;line-height:1;border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:3px 5px;background:rgba(255,255,255,.12);color:#f8fbff;text-transform:uppercase;letter-spacing:0}
.uie-stat-flash{animation:uieStatFlash .58s ease 0s 2}
#uie-debuff-strip{display:flex;gap:5px;flex-wrap:wrap;margin-top:2px}
.uie-debuff-icon{width:21px;height:21px;display:grid;place-items:center;border-radius:7px;background:rgba(96,15,22,.9);border:1px solid rgba(255,90,100,.55);font-size:11px;box-shadow:0 0 14px rgba(255,40,60,.22)}
@keyframes uieStatFlash{0%,100%{filter:none}50%{filter:drop-shadow(0 0 12px #6fd3ff);background:rgba(34,69,96,.64)}}`;
    document.head.appendChild(style);
}

export function renderModeHud() {
    try {
        ensureModeHudStyles();
        const s = ensureGameModeState(getSettings());
        const host = ensureHudHost();
        const uiTheme = resolveUiTheme(s);
        try {
            document.documentElement.setAttribute("data-uie-theme", uiTheme);
            document.getElementById("uie-main-menu")?.setAttribute("data-menu-theme", uiTheme);
            document.getElementById("uie-inventory-window")?.setAttribute("data-game-theme", uiTheme);
        } catch (_) {}
        syncGenreDropdownsToGameMode(s);
        const trackers = getTrackerConfig(s);
        const debuffs = Array.isArray(s.world?.debuffs) ? s.world.debuffs : [];
        s.world.trackerLogic = s.world.trackerLogic && typeof s.world.trackerLogic === "object" ? s.world.trackerLogic : {};
        trackers.forEach((tracker) => {
            const key = String(tracker.key || "").trim();
            if (!key) return;
            const existing = s.world.trackerLogic[key] && typeof s.world.trackerLogic[key] === "object" ? s.world.trackerLogic[key] : {};
            s.world.trackerLogic[key] = {
                sources: Array.isArray(existing.sources) && existing.sources.length ? existing.sources : tracker.sources,
                inferred: existing.inferred !== false,
                updatedAt: existing.updatedAt || Date.now()
            };
        });
        document.querySelectorAll("#uie-btn-open-phone i").forEach((el) => {
            el.className = isCodiceMode(s) ? "fa-solid fa-scroll" : "fa-solid fa-mobile-screen";
        });
        document.querySelectorAll("#uie-btn-open-phone span, #btn-phn").forEach((el) => {
            if (el.id === "btn-phn") el.innerHTML = `<i class="fas fa-${isCodiceMode(s) ? "scroll" : "mobile"}"></i> ${isCodiceMode(s) ? "Codice" : "Phone"}`;
            else el.textContent = isCodiceMode(s) ? "Codice" : "Phone";
        });
        host.innerHTML = `${trackers.map((tracker) => {
            const max = Math.max(0, Number(tracker.max || 0));
            const cur = clamp(tracker.cur, 0, max || 0);
            const pct = max > 0 ? Math.round((cur / max) * 100) : 0;
            const sourceLabels = (Array.isArray(s.world.trackerLogic?.[tracker.key]?.sources) ? s.world.trackerLogic[tracker.key].sources : tracker.sources)
                .map((source) => `<span class="uie-mode-source">${esc(source)}</span>`)
                .join("");
            return `<div class="uie-mode-bar" data-stat="${esc(tracker.key)}" data-tracker-sources="${esc((tracker.sources || []).join(","))}" style="--bar-color:${esc(tracker.color)}">
                <div class="uie-mode-bar-head"><span>${esc(tracker.label)}</span><span>${cur}/${max}</span></div>
                <div class="uie-mode-bar-track"><div class="uie-mode-bar-fill" style="width:${pct}%"></div></div>
                ${sourceLabels ? `<div class="uie-mode-bar-sources">${sourceLabels}</div>` : ""}
            </div>`;
        }).join("")}
        <div id="uie-debuff-strip">${debuffs.map((d) => `<div class="uie-debuff-icon" title="${esc(d?.name || "Debuff")}">${esc(d?.icon || "☠")}</div>`).join("")}</div>`;
    } catch (_) {}
}

export function flashTracker(statString) {
    try {
        const key = String(statString || "").trim().toLowerCase();
        const stat = key === "sp" ? "stamina" : key;
        const el = document.querySelector(`#uie-mode-hud [data-stat="${CSS.escape(stat)}"]`);
        if (!el) return;
        el.classList.remove("uie-stat-flash");
        void el.offsetWidth;
        el.classList.add("uie-stat-flash");
    } catch (_) {}
}

export function initGameModeManager() {
    ensureGameModeState(getSettings());
    renderModeHud();
    try { window.UIE = window.UIE || {}; window.UIE.gameMode = { ensureGameModeState, getGameMode, setGameMode, renderModeHud, flashTracker, resolveUiTheme, syncGenreDropdownsToGameMode }; } catch (_) {}
    window.addEventListener("uie:state_updated", renderModeHud);
    window.addEventListener("uie:time_advanced", renderModeHud);
    window.addEventListener("uie:game_mode_changed", () => syncGenreDropdownsToGameMode(getSettings()));
}
