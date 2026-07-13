
import { getSettings, saveSettings, isMobileUI } from "./core.js";
import { notify } from "./notifications.js";
import { initBackgroundManager } from "./backgrounds.js";
import { initAtmosphere, updateAtmosphere } from "./atmosphere.js";
import { updateSpriteStage, initSprites } from "./sprites.js";
import { initScavenge, initSpriteInteraction, spawnScavengeNodes } from "./interaction.js";
import { initChatSync, stopChatSync } from "./chat_sync.js";
import { initNavigation, setNavVisible, refreshNavVisibility } from "./navigation.js";
import { generateContent } from "./apiClient.js";
import {
    initGestures,
    initSensory,
    initInputAssist,
    initTrophies,
    initHaptics,
    initVisualPhysics,
    addTrauma,
    getRealityEngineV3,
    initForgeV3,
    initGameplayV3
} from "./reality.js";
import { initRuneCasting } from "./reality.js";
import { initLockpicking, initScratchCard, initDomSwitches, domSwitchManager } from "./minigames.js";
import { initSimulation, worldGen, utilityAI } from "./simulation.js";
import { initMods, openModsWindow } from "./mods.js";
import { openCalendar } from "./calendar.js";
import { safeJsonParseObject } from "./jsonUtil.js";
import { initMagicKnowledgeEngine } from "./magicKnowledgeEngine.js";
import { advanceWorldTimeMinutes } from "./timeProgress.js";
import { injectRpEvent } from "./features/rp_log.js";
import { layeredAnimation, initLayeredAnimation } from "./animation/index.js";

let reBound = false;
let reObserver = null;
let reLastSig = "";
let reEngine = null;
let reV3 = null;
let reModulesInited = false;

function ensureRealityModulesInited() {
    if (reModulesInited) return;
    reModulesInited = true;

    try { initBackgroundManager(); } catch (e) { console.error(e); }
    try { initSprites(); } catch (e) { console.error(e); }
    try { initAtmosphere(); } catch (e) { console.error(e); }
    try { initLayeredAnimation(); } catch (e) { console.error(e); }
    try { registerMotionProfilesFromSettings(); } catch (e) { console.error(e); }
    try { initScavenge(); } catch (e) { console.error(e); }
    try { initSpriteInteraction(); } catch (e) { console.error(e); }
    import("./interaction.js").then(m => m.initBackgroundInteraction?.()).catch(console.error);
    try { initGestures(); } catch (e) { console.error(e); }
    try { initRuneCasting(); } catch (e) { console.error(e); }
    try { initLockpicking(); } catch (e) { console.error(e); }
    try { initScratchCard(); } catch (e) { console.error(e); }
    try { initDomSwitches(); } catch (e) { console.error(e); }
    try { initSensory(); } catch (e) { console.error(e); }
    try { initInputAssist(); } catch (e) { console.error(e); }
    try { initTrophies(); } catch (e) { console.error(e); }
    try { initHaptics(); } catch (e) { console.error(e); }
    try { initVisualPhysics(); } catch (e) { console.error(e); }
    try { initSimulation(); } catch (e) { console.error(e); }
    try { initMods(); } catch (e) { console.error(e); }
    try { initMagicKnowledgeEngine(); } catch (e) { console.error(e); }
}

// Register optional per-character motion profiles from persona / social data so
// two characters with the same emotion can still animate differently. A profile
// may be an archetype string (e.g. "controlled") or a full profile object under
// `motionProfile` / `motionStyle`.
function registerMotionProfilesFromSettings() {
    const s = getSettings();
    const seen = new Set();
    const consider = (entry) => {
        if (!entry || typeof entry !== "object") return;
        const name = String(entry.name || "").trim();
        if (!name || seen.has(name.toLowerCase())) return;
        const profile = entry.motionProfile || entry.motionStyle;
        if (!profile) return;
        seen.add(name.toLowerCase());
        try { layeredAnimation.registerCharacterMotionProfile(name, profile); } catch (_) {}
    };
    (Array.isArray(s?.personas) ? s.personas : []).forEach(consider);
    for (const cat of ["family", "romance", "friends", "associates", "rivals"]) {
        (Array.isArray(s?.social?.[cat]) ? s.social[cat] : []).forEach(consider);
    }
    if (s?.relationships && typeof s.relationships === "object") {
        Object.values(s.relationships).forEach(consider);
    }
    // The player character may also carry a profile.
    if (s?.character) consider({ name: s.character.name || "You", motionProfile: s.character.motionProfile, motionStyle: s.character.motionStyle });
}

async function ensureRealityV3() {
    if (reV3) return reV3;
    try {
        reV3 = getRealityEngineV3();
        try { initForgeV3(); } catch (_) {}
        try { initGameplayV3(); } catch (_) {}
        return reV3;
    } catch (_) {
        return null;
    }
}

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function slug(s) {
    return String(s || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 60);
}

function hash(str) {
    let h = 0;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return String(h);
}

function parseBackgroundImageUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const match = raw.match(/url\((['"]?)(.*?)\1\)/i);
    return String(match?.[2] || raw).trim();
}

function getStageFallbackBackgroundUrl() {
    try {
        const bg = document.getElementById("bg1");
        const inline = parseBackgroundImageUrl(bg?.style?.backgroundImage || "");
        const computed = bg ? parseBackgroundImageUrl(window.getComputedStyle(bg).backgroundImage || "") : "";
        const picked = inline || computed;
        if (picked && !/__transparent\.png/i.test(picked)) return picked;
    } catch (_) {}
    try {
        const direct = parseBackgroundImageUrl(window?.background_settings?.url || "");
        if (direct && !/__transparent\.png/i.test(direct)) return direct;
    } catch (_) {}
    return "";
}

function canAutoGenerateBackgrounds(s) {
    const img = s?.image || {};
    const provider = String(img.provider || "").toLowerCase();
    const endpoint = String(img.url || "").trim();
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(endpoint);
    const isComfy = provider === "comfy" || provider === "comfyui";
    const isSd = provider === "sdwebui" || provider === "automatic1111" || provider === "sdnext";
    return img.enabled === true && (provider === "pollinations" || provider === "stability" || isSd || isComfy || local || !!String(img.key || "").trim());
}

function setStageBackgroundImage(bgEl, src) {
    if (!bgEl) return;
    const url = String(src || "").trim();
    if (!url) {
        bgEl.style.backgroundImage = "";
        return;
    }
    bgEl.style.backgroundImage = `url("${url}")`;
    bgEl.style.backgroundSize = "cover";
    bgEl.style.backgroundPosition = "center";
    bgEl.style.backgroundRepeat = "no-repeat";
}

function insertTextIntoTextarea(textarea, text) {
    const el = textarea;
    const next = String(text || "");
    if (!el || !next) return false;
    const value = String(el.value || "");
    const start = Number.isFinite(Number(el.selectionStart)) ? Number(el.selectionStart) : value.length;
    const end = Number.isFinite(Number(el.selectionEnd)) ? Number(el.selectionEnd) : value.length;
    el.value = `${value.substring(0, start)}${next}${value.substring(end)}`;
    try { el.selectionStart = el.selectionEnd = start + next.length; } catch (_) {}
    try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
    try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
    try { el.focus(); } catch (_) {}
    return true;
}

function insertQuickActionText(text) {
    const next = String(text || "");
    if (!next) return false;
    const targets = [
        document.getElementById("re-user-input"),
        document.querySelector("textarea#send_textarea"),
        document.querySelector("textarea#send_text"),
        document.querySelector("textarea")
    ];
    for (const target of targets) {
        if (insertTextIntoTextarea(target, next)) return true;
    }
    return false;
}

function getRealityQuickButtons() {
    const s = getSettings();
    ensureReality(s);
    if (!Array.isArray(s.realityEngine.quickButtons)) s.realityEngine.quickButtons = [];
    return s.realityEngine.quickButtons
        .map((btn, idx) => {
            const label = String(btn?.label || "").trim().slice(0, 60);
            const text = String(btn?.text || "").trim();
            if (!label || !text) return null;
            return {
                idx,
                label,
                text,
                icon: String(btn?.icon || "fa-bolt").trim() || "fa-bolt",
                desc: String(btn?.desc || text).trim().slice(0, 140)
            };
        })
        .filter(Boolean);
}

function readLastChatMessage() {
    try {
        const chatEl = document.getElementById("chat");
        if (!chatEl) return null;
        const last = chatEl.querySelector(".mes:last-child") || chatEl.lastElementChild;
        if (!last) return null;
        const name =
            last.querySelector?.(".mes_name")?.textContent ||
            last.querySelector?.(".name_text")?.textContent ||
            last.querySelector?.(".name")?.textContent ||
            last.getAttribute?.("ch_name") ||
            last.getAttribute?.("data-name") ||
            last.dataset?.name ||
            "";
        const text =
            last.querySelector?.(".mes_text")?.textContent ||
            last.querySelector?.(".mes-text")?.textContent ||
            last.textContent ||
            "";
        const nm = String(name || "").trim() || "Story";
        const tx = String(text || "").trim();
        if (!tx) return null;
        return { name: nm.slice(0, 80), text: tx.slice(0, 6000) };
    } catch (_) {
        return null;
    }
}

function extractTagValue(text, key) {
    const re = new RegExp(`\\[\\s*${key}\\s*:\\s*([^\\]]+)\\]`, "ig");
    let out = [];
    let m = null;
    while ((m = re.exec(String(text || ""))) !== null) out.push(String(m[1] || "").trim());
    out = out.filter(Boolean);
    return out.length ? out[out.length - 1] : "";
}

function stripTags(text) {
    let t = String(text || "");
    t = t.replace(/<think[\s\S]*?<\/think>/gi, "");
    t = t.replace(/<analysis[\s\S]*?<\/analysis>/gi, "");
    t = t.replace(/^\s*(thinking|analysis)\s*:[^\n]*$/gim, "");
    t = stripCssBlocks(t);
    t = t.replace(/<[^>]*?>/g, "");
    t = t.replace(/\[[^\]]*?\]/g, "");
    t = t.replace(/\s+\n/g, "\n");
    return t.trim();
}

function stripCssBlocks(text) {
    const src = String(text || "").replace(/\r/g, "");
    const lines = src.split("\n");
    const out = [];
    let depth = 0;
    for (const line of lines) {
        const t = String(line || "");
        const s = t.trim();
        if (!s) {
            if (depth === 0) out.push("");
            continue;
        }
        const opens = (s.match(/\{/g) || []).length;
        const closes = (s.match(/\}/g) || []).length;
        if (depth > 0) {
            depth = Math.max(0, depth + opens - closes);
            continue;
        }
        const looksCssStart =
            /^(\.|\#|:root\b|@keyframes\b|@media\b|@font-face\b)/i.test(s) ||
            (s.includes("--") && s.includes(":")) ||
            (s.includes("{") && s.includes(":") && !/\bhttps?:\/\//i.test(s));
        if (looksCssStart) {
            depth = Math.max(1, opens - closes);
            continue;
        }
        out.push(t);
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function ensureReality(s) {
    if (!s.realityEngine || typeof s.realityEngine !== "object") {
        s.realityEngine = {
            enabled: false,
            view: "room",
            locationId: "",
            backgrounds: {},
            audio: { enabled: true },
            ui: { showQuickButtons: true, showHud: true, hideStUi: true, vnInstant: true }
        };
    }
    const r = s.realityEngine;
    if (typeof r.enabled !== "boolean") r.enabled = false;
    if (typeof r.view !== "string") r.view = "room";
    if (typeof r.locationId !== "string") r.locationId = "";
    if (!r.backgrounds || typeof r.backgrounds !== "object") r.backgrounds = {};
    if (!r.audio || typeof r.audio !== "object") r.audio = { enabled: true };
    if (typeof r.audio.enabled !== "boolean") r.audio.enabled = true;
    if (!r.ui || typeof r.ui !== "object") r.ui = { showQuickButtons: true };
    if (typeof r.ui.showQuickButtons !== "boolean") r.ui.showQuickButtons = true;
    if (typeof r.ui.showHud !== "boolean") r.ui.showHud = true;
    // Default to HIDING ST UI for full immersion
    if (typeof r.ui.hideStUi !== "boolean") r.ui.hideStUi = true;
    if (typeof r.ui.vnInstant !== "boolean") r.ui.vnInstant = true;
    if (typeof r.ui.allowBg !== "boolean") r.ui.allowBg = true;

    r.comingSoon = false;
    if (typeof r.warningAck !== "boolean") r.warningAck = false;

    if (!r.sprites || typeof r.sprites !== "object") r.sprites = { sets: {}, speakerMap: {} };
    if (!r.sprites.sets || typeof r.sprites.sets !== "object") r.sprites.sets = {};
    if (!r.sprites.speakerMap || typeof r.sprites.speakerMap !== "object") r.sprites.speakerMap = {};
}

function setStageEnabled(enabled) {
    const el = document.getElementById("reality-stage");
    if (!el) return;
    const s = getSettings();
    ensureReality(s);
    if (s.realityEngine.comingSoon === true) enabled = false;
    if (enabled) {
        try { ensureRealityModulesInited(); } catch (_) {}
        try { initChatSync(); } catch (_) {}
        // IMPORTANT: CSS handles layout changes now.
        // We toggle 'display' but the children are 'fixed'
        el.style.display = "block";

        try {
            const wrap = document.getElementById("re-composer-wrap");
            if (wrap) {
                wrap.style.display = "flex";
                wrap.style.visibility = "visible";
                wrap.style.opacity = "1";
            }
            const ui = document.getElementById("re-user-input");
            if (ui) {
                ui.style.display = "block";
                ui.style.visibility = "visible";
                ui.style.opacity = "1";
            }
        } catch (_) {}

        if (s.realityEngine.ui?.hideStUi !== false) document.body.dataset.realityStage = "1";
        else delete document.body.dataset.realityStage;
    } else {
        el.style.display = "none";
        delete document.body.dataset.realityStage;
        try {
            if (reObserver) reObserver.disconnect();
        } catch (_) {}
        reObserver = null;
        try { stopChatSync(); } catch (_) {}
        try { document.getElementById("re-bg")?.style && (document.getElementById("re-bg").style.backgroundImage = ""); } catch (_) {}
        try { const m = document.getElementById("re-st-menu"); if (m) m.style.display = "none"; } catch (_) {}
        try { const f = document.getElementById("re-forge-modal"); if (f) f.style.display = "none"; } catch (_) {}
    }
}

async function ensureMapEngine() {
    // Legacy function removed.
    return null;
}

class RealityEngine {
    constructor() {
        this.typingTimer = null;
        this.typingText = "";
        this.typingIdx = 0;
        this.map = null;
        this.audio = { el: null, cache: new Map() };
        this.vn = {
            text: "",
            pages: [],
            pageIdx: 0,
            autoMode: false,
            autoTimer: null,
            settings: {
                speed: 30,
                wordsPerBox: 20, // Default changed to 20 per request
                promptPrefix: ""
            }
        };
        this.loadVnSettings();
    }

    loadVnSettings() {
        try {
            const s = getSettings();
            if (s.realityEngine?.vn) {
                this.vn.settings = { ...this.vn.settings, ...s.realityEngine.vn };
                // Ensure default is 20 if undefined/invalid
                if (!Number.isFinite(Number(this.vn.settings.wordsPerBox))) this.vn.settings.wordsPerBox = 20;
                // Load Auto Mode
                if (typeof s.realityEngine.vn.autoMode === "boolean") {
                    this.vn.autoMode = s.realityEngine.vn.autoMode;
                }
            }
        } catch (_) {}
    }

    saveVnSettings() {
        const s = getSettings();
        ensureReality(s);
        s.realityEngine.vn = { ...this.vn.settings, autoMode: this.vn.autoMode };
        saveSettings();
    }

    paginateText(text) {
        const limit = Number(this.vn.settings.wordsPerBox) || 20;
        if (limit <= 0) return [text];

        const words = text.split(/\s+/);
        const pages = [];
        let current = [];

        for (const w of words) {
            current.push(w);
            if (current.length >= limit && /[.!?"]$/.test(w)) { // Try to break on sentences
                pages.push(current.join(" "));
                current = [];
            } else if (current.length >= limit * 1.5) { // Hard limit
                pages.push(current.join(" "));
                current = [];
            }
        }
        if (current.length) pages.push(current.join(" "));
        if (pages.length === 0) pages.push("");

        return pages;
    }

    renderVnPage() {
        const text = this.vn.pages[this.vn.pageIdx] || "";
        const box = document.getElementById("re-vn-box");
        if (!String(text || "").trim()) {
            if (box) box.style.display = "none";
            const textEl = document.getElementById("re-text");
            if (textEl) textEl.textContent = "";
            return;
        }
        this.startTypewriter(text, () => {
            if (this.vn.autoMode) this.scheduleAutoAdvance();
        });

        const prev = document.getElementById("re-vn-prev");
        const next = document.getElementById("re-vn-next");

        // Show box if hidden (sanity check)
        if (box && box.style.display === "none") box.style.display = "flex";

        if (prev) {
            // Hide prev on first page
            prev.style.opacity = this.vn.pageIdx > 0 ? "1" : "0";
            prev.style.pointerEvents = this.vn.pageIdx > 0 ? "auto" : "none";
        }
        if (next) {
            // Always show next (it acts as "Close" on last page)
            next.style.opacity = "1";
            next.style.pointerEvents = "auto";

            // Optional: Change icon on last page?
            // next.innerHTML = this.vn.pageIdx < this.vn.pages.length - 1 ? '<i class="fa-solid fa-chevron-right"></i>' : '<i class="fa-solid fa-xmark"></i>';
        }
    }

    scheduleAutoAdvance() {
        if (this.vn.autoTimer) clearTimeout(this.vn.autoTimer);
        const text = this.vn.pages[this.vn.pageIdx] || "";
        // reading speed: ~200 wpm -> ~3 words/sec.
        // 20 words -> ~6-7 sec.
        // Formula: base 1s + words * 300ms
        const words = text.split(/\s+/).length;
        const delay = 1000 + (words * 300) + Number(this.vn.settings.speed) * 10;

        this.vn.autoTimer = setTimeout(() => {
            if (!this.vn.autoMode) return;
            this.advancePage();
        }, delay);
    }

    advancePage() {
        if (this.vn.pageIdx < this.vn.pages.length - 1) {
            this.vn.pageIdx++;
            this.renderVnPage();
        } else {
            // End of message
            // If auto mode, maybe we just hide?
            const box = document.getElementById("re-vn-box");
            if (box) box.style.display = "none";
        }
    }

    getLocationId() {
        const s = getSettings();
        ensureReality(s);
        const wsLoc = String(s?.worldState?.location || "").trim();
        const locId = slug(wsLoc || s.realityEngine.locationId || "unknown");
        s.realityEngine.locationId = locId;
        saveSettings();
        return locId;
    }

    applyBackground() {
        const s = getSettings();
        ensureReality(s);
        const locId = this.getLocationId();
        const fallbackBg = getStageFallbackBackgroundUrl();
        const canGenerate = canAutoGenerateBackgrounds(s);
        if (s.realityEngine.ui?.allowBg !== true) {
            try {
                const bgEl0 = document.getElementById("re-bg");
                if (bgEl0) bgEl0.style.backgroundImage = "";
            } catch (_) {}
            return;
        }
        let bg = "";
        try {
            const v3 = window.UIE_realityV3;
            if (v3 && typeof v3.getBackground === "function") bg = String(v3.getBackground(locId) || "").trim();
        } catch (_) {}
        if (!bg) bg = String(s.realityEngine.backgrounds?.[locId] || "").trim();
        if (!bg) {
            const location = String(s.worldState?.location || "").trim().toLowerCase();
            const findLocationValue = (source, readValue) => {
                if (!source || typeof source !== "object" || !location) return "";
                const key = Object.keys(source).find((candidate) => String(candidate || "").trim().toLowerCase() === location);
                return key ? String(readValue(source[key]) || "").trim() : "";
            };
            bg = String(
                findLocationValue(s.worldState?.areaScenes, (scene) => scene?.imageUrl) ||
                findLocationValue(s.worldState?.customBackgrounds, (url) => url) ||
                s.worldState?.backgroundUrl ||
                s.worldState?.background ||
                s.ui?.manualBedroomBg ||
                s.ui?.backgrounds?.vnRoom ||
                ""
            ).trim();
            if (bg) {
                s.realityEngine.backgrounds[locId] = bg;
                try { window.UIE_realityV3?.setBackground?.(locId, bg); } catch (_) {}
                saveSettings();
            }
        }
        if (bg.includes("No-Image-Placeholder")) bg = "";

        if (!bg && !canGenerate && fallbackBg) {
            bg = fallbackBg;
            s.realityEngine.backgrounds[locId] = bg;
            try { window.UIE_realityV3?.setBackground?.(locId, bg); } catch (_) {}
            saveSettings();
        }

        // Lazy Generation Check
        if (!bg && s.worldState?.mapData?.nodes) {
            const node = s.worldState.mapData.nodes.find(n => slug(n.id) === locId || slug(n.name) === locId);
            if (!canGenerate && fallbackBg) {
                bg = fallbackBg;
                s.realityEngine.backgrounds[locId] = bg;
                try { window.UIE_realityV3?.setBackground?.(locId, bg); } catch (_) {}
                saveSettings();
            } else if (node && node.desc && !s.realityEngine._generating?.[locId]) {
                if (!s.realityEngine._generating) s.realityEngine._generating = {};
                s.realityEngine._generating[locId] = true;

                try { notify("info", `Generating scene: ${node.name || locId}...`, "Reality Engine"); } catch (_) {}

                import("./imageGen.js").then(mod => {
                    mod.generateImageAPI(`[UIE_LOCKED]\n${node.desc}`, {
                        mode: "background",
                        location: node.name || s.worldState?.location || locId,
                        hotspots: node.hotspots || node.backgroundHotspots || [],
                    }).then(url => {
                        delete s.realityEngine._generating[locId];
                        if (url) {
                            s.realityEngine.backgrounds[locId] = url;
                            try { window.UIE_realityV3?.setBackground?.(locId, url); } catch (_) {}
                            saveSettings();
                            if (this.getLocationId() === locId) {
                                this.applyBackground();
                            }
                            try { notify("success", "Scene generated.", "Reality Engine"); } catch (_) {}
                        }
                    }).catch(() => {
                        delete s.realityEngine._generating[locId];
                    });
                });
            }
        }

        const bgEl = document.getElementById("re-bg");
        if (bgEl) {
            if (bg && bg !== "null" && bg !== "undefined") {
                // Pre-validate image to avoid "broken image" icon
                const img = new Image();
                img.onload = () => {
                    if (bgEl) {
                        setStageBackgroundImage(bgEl, bg);
                    }
                };
                img.onerror = () => {
                    console.warn("[UIE] Failed to load background:", bg);
                    if (fallbackBg) setStageBackgroundImage(bgEl, fallbackBg);
                    else if (bgEl) bgEl.style.backgroundImage = "";
                };
                img.src = bg;
            } else {
                if (fallbackBg) setStageBackgroundImage(bgEl, fallbackBg);
                else bgEl.style.backgroundImage = "";
            }
        }
    }

    updateSprite(charName, mood) {
        // ... (Legacy sprite function, logic moved to sprites.js but keeping for compatibility)
    }

    triggerShake() {
        try {
            if (typeof addTrauma === "function") {
                addTrauma(0.5);
                return;
            }
        } catch (_) {}

        const st = document.getElementById("reality-stage");
        if (!st) return;
        st.classList.remove("re-shake");
        void st.offsetWidth;
        st.classList.add("re-shake");
        setTimeout(() => { try { st.classList.remove("re-shake"); } catch (_) {} }, 520);
    }

    ensureAudioEl() {
        if (this.audio.el) return this.audio.el;
        const a = document.createElement("audio");
        a.preload = "auto";
        a.volume = 0.8;
        a.style.display = "none";
        document.body.appendChild(a);
        this.audio.el = a;
        return a;
    }

    playSound(tag) {
        const s = getSettings();
        ensureReality(s);
        if (s.realityEngine.audio?.enabled !== true) return;
        const key = slug(tag);
        if (!key) return;
        const baseUrl = String(window.UIE_BASEURL || "/").trim();
        const src = `${baseUrl}assets/audio/${key}.mp3`;
        const a = this.ensureAudioEl();
        a.src = src;
        a.currentTime = 0;
        a.play().catch(() => {});
    }

    updateHud() {
        const s = getSettings();
        ensureReality(s);
        const hp = Math.max(0, Number(s.hp || 0));
        const maxHp = Math.max(1, Number(s.maxHp || 1));
        const hpPct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
        const hpFill = document.getElementById("re-hp-fill");
        if (hpFill) hpFill.style.width = `${hpPct}%`;
    }

    setView(view) {
        const s = getSettings();
        ensureReality(s);
        s.realityEngine.view = view === "map" ? "map" : "room";
        saveSettings();
        const canvas = document.getElementById("re-map");
        const sprites = document.getElementById("re-sprites-layer");
        const objs = document.getElementById("re-objects");
        const bg = document.getElementById("re-bg");
        if (canvas) canvas.style.display = s.realityEngine.view === "map" ? "block" : "none";
        if (sprites) sprites.style.display = s.realityEngine.view === "map" ? "none" : "block";
        if (objs) objs.style.display = s.realityEngine.view === "map" ? "none" : "";
        if (bg) bg.style.display = s.realityEngine.view === "map" ? "none" : "";
        if (s.realityEngine.view === "map") this.ensureMap();
    }

    async ensureMap() {
        const div = document.getElementById("re-map");
        if (!div) return;
        div.innerHTML = ""; // Clear
        const s = getSettings();
        const fallbackBg = getStageFallbackBackgroundUrl();
        const mapImg = String(s.map?.image || "").trim();
        const nodes = Array.isArray(s.worldState?.mapData?.nodes) ? s.worldState.mapData.nodes.filter(Boolean) : [];
        const currentLoc = this.getLocationId();

        if (mapImg) {
            div.style.backgroundImage = `url("${mapImg}")`;
            div.style.backgroundSize = "contain";
            div.style.backgroundRepeat = "no-repeat";
            div.style.backgroundPosition = "center";
        } else if (fallbackBg) {
            div.style.backgroundImage = `linear-gradient(180deg, rgba(5,8,12,0.72), rgba(5,8,12,0.82)), url("${fallbackBg}")`;
            div.style.backgroundSize = "cover";
            div.style.backgroundRepeat = "no-repeat";
            div.style.backgroundPosition = "center";
        } else {
            div.style.backgroundImage = "";
            div.style.backgroundSize = "";
            div.style.backgroundRepeat = "";
            div.style.backgroundPosition = "";
        }

        if (nodes.length) {
            const panel = document.createElement("div");
            panel.style.cssText = `margin:${isMobileUI() ? "16px 12px 24px" : "22px auto"}; width:min(${isMobileUI() ? "96vw" : "720px"}, calc(100% - 24px)); padding:${isMobileUI() ? "14px" : "18px"}; border-radius:18px; border:1px solid rgba(255,255,255,0.14); background:rgba(5,8,12,0.72); backdrop-filter:blur(8px); color:#fff; box-shadow:0 12px 32px rgba(0,0,0,0.45);`;
            panel.innerHTML = `<div style="font-size:1.05em; font-weight:900; color:#cba35c; margin-bottom:6px;">World Map</div><div style="font-size:0.88em; opacity:0.78; margin-bottom:12px;">Tap a discovered location to travel there and update the scene.</div>`;

            const grid = document.createElement("div");
            grid.style.cssText = `display:grid; grid-template-columns:repeat(${isMobileUI() ? 1 : 2}, minmax(0, 1fr)); gap:10px;`;
            nodes.slice(0, 32).forEach((node, index) => {
                const id = String(node?.id || node?.name || `scene_${index + 1}`).trim();
                const name = String(node?.name || node?.id || `Scene ${index + 1}`).trim();
                const desc = String(node?.desc || "").trim();
                const isCurrent = slug(id) === currentLoc || slug(name) === currentLoc;
                const btn = document.createElement("button");
                btn.type = "button";
                btn.style.cssText = `text-align:left; padding:12px 14px; border-radius:14px; border:1px solid ${isCurrent ? "rgba(203,163,92,0.55)" : "rgba(255,255,255,0.12)"}; background:${isCurrent ? "rgba(203,163,92,0.14)" : "rgba(255,255,255,0.05)"}; color:#fff; cursor:pointer;`;
                btn.innerHTML = `<div style="font-weight:800; color:${isCurrent ? "#f1d18b" : "#fff"};">${esc(name)}</div><div style="font-size:0.82em; opacity:0.75; margin-top:4px;">${esc(desc || "Travel to this location.")}</div>`;
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.injectTravel({ id, name, desc });
                    this.setView("room");
                };
                grid.appendChild(btn);
            });
            panel.appendChild(grid);
            div.appendChild(panel);
            return;
        }

        if (!mapImg && !fallbackBg) {
            div.innerHTML = `<div style="color:rgba(255,255,255,0.5); text-align:center; padding-top:40%;"><h2>World Map</h2><p>No map image or layout saved yet.</p></div>`;
        }
    }

    injectTravel(town) {
        const locId = String(town?.id || "").trim();
        if (!locId) return;
        const s = getSettings();
        ensureReality(s);
        if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};

        const prevLoc = s.worldState.location || "Unknown";
        s.worldState.location = locId;
        s.realityEngine.locationId = slug(locId);
        if (Number.isFinite(Number(town?.x)) && Number.isFinite(Number(town?.y))) {
            s.worldState.x = Number(town.x);
            s.worldState.y = Number(town.y);
        }
        saveSettings();

        try { window.UIE_realityV3?.setLocation?.(locId); } catch (_) {}
        try { window.UIE_realityV3?.ensureBackgroundOrRequest?.(); } catch (_) {}
        try { this.applyBackground(); } catch (_) {}
        try { notify("success", `Moved to: ${locId}`, "Reality Engine", "api"); } catch (_) {}

        if (prevLoc !== locId) {
            injectRpEvent(`[System: Party traveled from ${prevLoc} to ${locId}.]`);
        }
    }

    startTypewriter(text, callback) {
        const el = document.getElementById("re-text");
        if (!el) return;
        if (this.typingTimer) clearInterval(this.typingTimer);
        try {
            const s = getSettings();
            ensureReality(s);
            if (s.realityEngine.ui?.vnInstant === true) {
                this.typingText = String(text || "");
                this.typingIdx = this.typingText.length;
                el.textContent = this.typingText;
                this.typingTimer = null;
                if (typeof callback === "function") callback();
                return;
            }
        } catch (_) {}
        this.typingText = String(text || "");
        this.typingIdx = 0;
        el.textContent = "";
        this.typingTimer = setInterval(() => {
            if (!el) return;
            el.textContent += this.typingText.charAt(this.typingIdx);
            this.typingIdx++;
            if (this.typingIdx >= this.typingText.length) {
                clearInterval(this.typingTimer);
                this.typingTimer = null;
                if (typeof callback === "function") callback();
            }
        }, Number(this.vn.settings.speed) || 20);
    }

    skipTypewriter() {
        const el = document.getElementById("re-text");
        if (!el) return;
        if (this.typingTimer) {
            clearInterval(this.typingTimer);
            this.typingTimer = null;
            el.textContent = this.typingText;
            if (this.vn.autoMode) this.scheduleAutoAdvance();
        }
    }

    updateFromChat(charName, messageText) {
        const speaker = document.getElementById("re-speaker");
        const raw = String(messageText || "");
        const clean = stripTags(raw);
        if (!clean.trim()) {
            const box = document.getElementById("re-vn-box");
            if (box) box.style.display = "none";
            this.vn.text = "";
            this.vn.pages = [];
            this.vn.pageIdx = 0;
            return;
        }

        // Track who is speaking for CSS styling
        this.vn.isUser = (String(charName || "").toLowerCase() === "you");

        // Show box and render
        const box = document.getElementById("re-vn-box");
        if (box) box.style.display = "flex";

        // Resolve speaking portrait and dynamic name-hashed fallback
        const s = getSettings();
        let portrait = "";
        const speakName = String(charName || "").trim().toLowerCase();
        
        if (speakName === "you" || speakName === "player") {
            portrait = s.character?.avatar || s.character?.imageUrl || "";
        } else if (speakName) {
            const personas = Array.isArray(s.personas) ? s.personas : [];
            const p = personas.find(x => x && String(x.name || "").trim().toLowerCase() === speakName);
            if (p) {
                portrait = p.imageUrl || p.avatar || "";
            } else {
                for (const cat of ["family", "romance", "friends", "associates", "rivals"]) {
                    const arr = Array.isArray(s.social?.[cat]) ? s.social[cat] : [];
                    const found = arr.find(x => x && String(x.name || "").trim().toLowerCase() === speakName);
                    if (found) {
                        portrait = found.avatar || found.imageUrl || "";
                        break;
                    }
                }
                if (!portrait && s.relationships) {
                    const found = Object.values(s.relationships).find(x => x && String(x.name || "").trim().toLowerCase() === speakName);
                    if (found) {
                        portrait = found.avatar || found.imageUrl || "";
                    }
                }
            }
        }

        const hashString = (str) => {
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                hash = str.charCodeAt(i) + ((hash << 5) - hash);
            }
            return hash;
        };

        const getHslColor = (name) => {
            const h = Math.abs(hashString(name)) % 360;
            return `hsl(${h}, 75%, 45%)`;
        };

        const avatarEl = document.getElementById("re-vn-avatar");
        const avatarImg = document.getElementById("re-vn-avatar-img");
        const avatarInitial = document.getElementById("re-vn-avatar-initial");
        const trimmedName = String(charName || "").trim();
        const isStory = !trimmedName || trimmedName.toLowerCase() === "story" || trimmedName.toLowerCase() === "narrator";

        if (speaker) {
            if (isStory) {
                speaker.style.display = "none";
            } else {
                speaker.style.display = "block";
                speaker.textContent = trimmedName.slice(0, 80);
            }
        }

        if (avatarEl) {
            if (!isStory) {
                avatarEl.style.display = "flex";
                if (box) box.style.paddingLeft = "114px";
                if (avatarInitial) {
                    avatarInitial.textContent = trimmedName.charAt(0).toUpperCase();
                }
                avatarEl.style.backgroundColor = getHslColor(trimmedName);
                if (portrait) {
                    if (avatarImg) {
                        avatarImg.src = portrait;
                        avatarImg.style.display = "block";
                    }
                    if (avatarInitial) avatarInitial.style.display = "none";
                } else {
                    if (avatarImg) {
                        avatarImg.src = "";
                        avatarImg.style.display = "none";
                    }
                    if (avatarInitial) avatarInitial.style.display = "block";
                }
            } else {
                avatarEl.style.display = "none";
                if (box) box.style.paddingLeft = "20px";
            }
        }

        this.vn.text = clean;
        this.vn.pages = this.paginateText(clean);
        this.vn.pageIdx = 0;
        this.renderVnPage();

        // --- NEW UPDATES ---
        try {
            // IMMERSIVE HTML PARSER
            if (raw.includes("[[IMM_HTML]]")) {
                import("./reality.js").then(m => {
                    if (m.renderImmersiveOverlay) m.renderImmersiveOverlay(raw);
                });
            }
            // CONTEXTUAL DOM SWITCH PARSER
            if (domSwitchManager && typeof domSwitchManager.checkAndTrigger === "function") {
                domSwitchManager.checkAndTrigger(raw);
            }
        } catch (_) {}

        const mood = extractTagValue(raw, "mood");
        // this.updateSprite(charName, mood || "neutral"); // Legacy

        // --- NEW UPDATES ---
        updateSpriteStage(raw, charName); // Handle Pos, Dist, Anim

        // Handle [Show: Name] tags to spawn other entities
        try {
            const showMatches = raw.matchAll(/\[(?:Show|Appear|Spawn)\s*:\s*([^\]]+)\]/gi);
            for (const m of showMatches) {
                const name = String(m[1] || "").trim();
                if (name) updateSpriteStage(raw, name);
            }
        } catch (_) {}

        // Handle [Hide: Name] tags to remove entities
        try {
            const hideMatches = raw.matchAll(/\[(?:Hide|Remove|Despawn)\s*:\s*([^\]]+)\]/gi);
            for (const m of hideMatches) {
                const name = String(m[1] || "").trim();
                if (name) hideSprite(name);
            }
        } catch (_) {}

        updateAtmosphere(raw);  // Handle Weather/Time
        // -------------------

        // --- Layered VN animation: chat-box (speaker) and screen (environment)
        // are driven as two INDEPENDENT systems from the same narrative beat.
        // The narrative only supplies semantic tags/keywords; JS resolves them.
        try {
            // Cancel obsolete animations + persistent ambients when the scene
            // (location) changes, then let this beat rebuild them.
            const locNow = String(s?.worldState?.location || "").trim().toLowerCase();
            if (this._animLocId !== undefined && this._animLocId !== locNow) {
                layeredAnimation.clearSceneAnimations();
            }
            this._animLocId = locNow;

            layeredAnimation.processNarrative({
                speaker: charName,
                text: raw,
                isUser: this.vn.isUser,
                isStory,
            });
        } catch (_) {}


        const vfx = extractTagValue(raw, "vfx");
        if (String(vfx).toLowerCase().includes("shake")) this.triggerShake();
        const snd = extractTagValue(raw, "sound");
        if (snd) this.playSound(snd);
        this.updateHud();
    }

    openForge() {
        const modal = document.getElementById("re-forge-modal");
        const prompt = document.getElementById("re-forge-prompt");
        const imgEl = document.getElementById("re-forge-img");
        const empty = document.getElementById("re-forge-empty");
        if (!modal || !prompt) return;
        try {
            if (modal.parentElement !== document.body) {
                document.body.appendChild(modal);
            }
        } catch (_) {}
        const s = getSettings();
        ensureReality(s);
        try {
            const locId = this.getLocationId();
            const cur = String(s.realityEngine.backgrounds?.[locId] || "").trim();
            if (imgEl) {
                if (cur) {
                    imgEl.src = cur;
                    imgEl.style.display = "block";
                    if (empty) empty.style.display = "none";
                } else {
                    imgEl.style.display = "none";
                    if (empty) { empty.textContent = "No preview yet"; empty.style.display = "block"; }
                }
            }
        } catch (_) {}
        const ws = s.worldState || {};
        const hint = `Location: ${String(ws.location || "Unknown")}\nTime: ${String(ws.time || "")}\nWeather: ${String(ws.weather || "")}\n\nDescribe the scene background in detail.`;
        prompt.value = prompt.value ? String(prompt.value) : hint;
        modal.style.display = "flex";
    }

    closeForge() {
        const modal = document.getElementById("re-forge-modal");
        if (modal) modal.style.display = "none";
    }

    async forgeGenerate() {
        const prompt = document.getElementById("re-forge-prompt");
        if (!prompt) return;
        const text = String(prompt.value || "").trim();
        if (!text) return;
        const s = getSettings();
        ensureReality(s);
        const imgEl = document.getElementById("re-forge-img");
        const empty = document.getElementById("re-forge-empty");

        // Multi-scene / Map Detection
        if (/(?:entire|full|whole)\s+map|castle\s+layout|home\s+layout|multiple\s+scenes/i.test(text)) {
            if (empty) empty.textContent = "Map generating";
            if (imgEl) imgEl.style.display = "none";

            try {
                const settingContext = {
                    currentLocation: String(s.worldState?.location || "").trim(),
                    currentDescription: String(s.worldState?.locationDesc || "").trim(),
                    worldDescription: String(s.worldState?.description || s.world?.generationScope?.description || "").trim(),
                    currentTheme: String(s.worldState?.mapContext?.theme || "").trim(),
                };
                const sys = `You are a universal World Forge engine. The user wants a multi-scene layout.
Infer genre, era, technology, architecture, and naming from the supplied setting context and request.
Never default to medieval fantasy. Do not introduce keeps, holds, castles, kingdoms, taverns, or dungeons unless the supplied context explicitly supports them.
Output ONLY valid JSON containing a list of nodes (scenes).
Schema: { "nodes": [ { "id": "unique_id", "name": "Display Name", "desc": "Visual description for image generation" } ] }
Do not output markdown or explanations.`;
                const userPrompt = `[UIE_LOCKED]\nSetting context: ${JSON.stringify(settingContext)}\nGenerate a map layout based on: ${text}`;

                const jsonStr = await generateContent(`${sys}\n\n${userPrompt}`, "Map");
                const data = safeJsonParseObject(jsonStr);

                if (data && Array.isArray(data.nodes)) {
                    const nodes = data.nodes
                        .map((node, index) => {
                            const id = slug(node?.id || node?.name || `scene_${index + 1}`) || `scene_${index + 1}`;
                            const name = String(node?.name || node?.id || `Scene ${index + 1}`).trim().slice(0, 80) || `Scene ${index + 1}`;
                            const desc = String(node?.desc || node?.description || "").trim();
                            return { id, name, desc };
                        })
                        .filter(node => node.id);
                    if (nodes.length) {
                        const s = getSettings();
                        ensureReality(s);
                        if (!s.worldState) s.worldState = {};
                        s.worldState.mapData = { ...data, nodes };
                        const currentLoc = slug(s.worldState.location || "");
                        if (!currentLoc || !nodes.some(node => slug(node.id) === currentLoc)) {
                            s.worldState.location = nodes[0].id;
                            s.realityEngine.locationId = slug(nodes[0].id);
                        }
                        saveSettings();

                        if (empty) {
                            empty.textContent = `Layout generated: ${nodes.length} scenes. Images will generate upon entry.`;
                            empty.style.display = "block";
                        }
                        try { this.ensureMap(); } catch (_) {}
                        try { notify("success", `Map layout created with ${nodes.length} scenes.`, "World Forge"); } catch(_) {}
                        return;
                    }
                }
            } catch (e) {
                console.error("Map Gen Error", e);
                if (empty) empty.textContent = "Map generation failed.";
            }
            return;
        }

        if (empty) empty.textContent = "Generating...";
        if (imgEl) imgEl.style.display = "none";
        let url = "";
        try {
            const mod = await import("./imageGen.js");
            url = await mod.generateImageAPI(`[UIE_LOCKED]\n${text}`, {
                mode: "background",
                location: String(s.worldState?.location || "").trim(),
            });
        } catch (_) {
            url = "";
        }
        if (!url) {
            if (empty) empty.textContent = "Generation failed";
            return;
        }
        if (imgEl) {
            imgEl.src = url;
            imgEl.style.display = "block";
        }
        if (empty) empty.style.display = "none";
        s.realityEngine._pendingBg = url;
        saveSettings();
    }

    forgeBind() {
        const s = getSettings();
        ensureReality(s);
        const locId = this.getLocationId();
        const url = String(s.realityEngine._pendingBg || "").trim();
        if (!url) {
            try { notify("info", "Generate a preview first, then Save/Bind.", "World Forge", "api"); } catch (_) {}
            return;
        }
        s.realityEngine.backgrounds[locId] = url;
        delete s.realityEngine._pendingBg;
        try { window.UIE_realityV3?.setBackground?.(locId, url); } catch (_) {}
        saveSettings();
        this.applyBackground();
        this.closeForge();
        try { notify("success", "Background bound to this location.", "World Forge", "api"); } catch (_) {}
    }

    bindUi() {
        if (reBound) return;
        reBound = true;

        // Clean up old document-level listeners to prevent duplicates
        $(document).off(".realityEngine");

        const actGate = (() => {
            const last = new Map();
            return (key, ms = 600) => { // Increased default from 450 to 600
                // strict generation check for action keys
                if (key && (key === "regen" || key === "cont" || key === "imp" || key === "send" || key.startsWith("qbtn_") || key === "actforge" || key === "forgegen")) {
                    try {
                        if (typeof is_send_press !== "undefined" && is_send_press) return false;
                        const stop = document.getElementById("stop_but");
                        if (stop && stop.style.display !== "none") return false;
                    } catch (_) {}
                }

                const k = String(key || "");
                const now = Date.now();
                const prev = Number(last.get(k) || 0);
                if (now - prev < ms) return false;
                last.set(k, now);
                return true;
            };
        })();

        // --- NUCLEAR EVENT BLOCKER ---
    // Prevent events on our UI from bubbling up to host global listeners (which toggle drawers)
    const blockerEvents = "mousedown pointerdown touchstart click contextmenu dblclick";
    // We bind to specific containers instead of document for our own logic, so blocking at the container level is safe.
    // EXCLUDE .uie-settings-drawer if it exists to allow ST settings to work if they are somehow caught here (unlikely but safe).
    // ADDED: #uie-journal-window, #uie-party-window, #uie-databank-window, #uie-inventory-window, #uie-social-window
    // REMOVED: #uie-calendar-window, #uie-map-window (Handled internally to allow dragging)
    const getRoots = () => $("#reality-stage, #re-st-menu, #re-vn-box, #re-vn-settings-modal, #re-quick-modal, #re-forge-modal, #re-gesture-canvas, #uie-chatbox-window, #uie-sprites-window").not(".uie-settings-drawer");

    // Apply blocker to current roots
    // Note: We use a capture-like approach by binding early or just relying on bubble order.
    // Since we bind specific logic to these roots below, and handlers on the same element execute in order of binding,
    // we should bind the specific logic FIRST, then the blocker?
    // Actually, if we bind the blocker here, and it calls stopPropagation(), it stops bubbling to PARENTS.
    // It does NOT stop other listeners on the SAME element unless stopImmediatePropagation is used.
    // So this is safe for listeners bound to the same roots.
    // Use a delegating listener on body for robustness against dynamic addition?
    // No, that would be a document listener which is what we are trying to avoid.
    // Instead, we just bind to the elements themselves. Since they are persistent after load, this works.

    // BUT: If elements are re-created (like chatbox), we need to re-bind.
    // The chatbox is re-created or re-appended?
    // startup.js appends them once.

    getRoots().on(blockerEvents, (e) => {
        e.stopPropagation();
    });

    const $roots = getRoots();

        // VN Box Interaction
        $roots.on("pointerup click", "#re-vn-box", (e) => {
            if ($(e.target).closest("#re-vn-controls").length) return;
            if (!actGate("vnbox")) return;
            e.stopPropagation();
            this.skipTypewriter();
        });

        // Controls Blocker (Redundant but safe)
        $roots.on("pointerdown mousedown click", "#re-vn-controls, #re-vn-settings, #re-vn-edit", (e) => {
            e.stopPropagation();
        });

        // VN Edit (Triggers ST Edit)
        $roots.on("pointerup click", "#re-vn-edit", (e) => {
            e.preventDefault(); e.stopPropagation();
            const chat = document.getElementById("chat");
            if (!chat) return;
            const last = chat.querySelector(".mes:last-child");
            if (!last) return;
            const btn = last.querySelector(".mes_edit");
            if (btn) btn.click();
        });

        // VN Delete
        $roots.on("pointerup click", "#re-vn-del", (e) => {
            e.preventDefault(); e.stopPropagation();
            const chat = document.getElementById("chat");
            if (!chat) return;
            const last = chat.querySelector(".mes:last-child");
            if (!last) return;
            const btn = last.querySelector(".mes_del");
            if (btn) btn.click();
        });

        // VN Navigation
        $roots.on("pointerup click", "#re-vn-next", (e) => {
            if (!actGate("vnnext", 200)) return;
            e.preventDefault(); e.stopPropagation();
            if (this.typingTimer) {
                this.skipTypewriter();
            } else {
                if (this.vn.pageIdx < this.vn.pages.length - 1) {
                    this.vn.pageIdx++;
                    this.renderVnPage();
                } else {
                    // Close on last page
                    $("#re-vn-box").hide();
                    if (this.vn.autoTimer) clearTimeout(this.vn.autoTimer);
                }
            }
        });

        $roots.on("pointerup click", "#re-vn-prev", (e) => {
            if (!actGate("vnprev", 200)) return;
            e.preventDefault(); e.stopPropagation();
            if (this.vn.pageIdx > 0) {
                this.vn.pageIdx--;
                this.renderVnPage();
            }
        });

        // VN Auto Toggle
        $roots.on("pointerup click", "#re-vn-auto-toggle", (e) => {
            e.preventDefault(); e.stopPropagation();
            this.vn.autoMode = !this.vn.autoMode;
            this.saveVnSettings(); // Persist setting
            const btn = document.getElementById("re-vn-auto-toggle");
            if (btn) {
                btn.style.color = this.vn.autoMode ? "#cba35c" : "";
                btn.style.opacity = this.vn.autoMode ? "1" : "0.5";
            }
            if (this.vn.autoMode && !this.typingTimer) {
                this.scheduleAutoAdvance();
            } else if (!this.vn.autoMode) {
                if (this.vn.autoTimer) clearTimeout(this.vn.autoTimer);
            }
        });

        // VN Settings
        $roots.on("pointerup click", "#re-vn-settings", (e) => {
            e.preventDefault(); e.stopPropagation();
            const modal = document.getElementById("re-vn-settings-modal");
            if (modal) {
                modal.style.display = "flex";
                document.getElementById("re-vn-speed").value = this.vn.settings.speed;
                document.getElementById("re-vn-words").value = this.vn.settings.wordsPerBox;
                document.getElementById("re-vn-prompt").value = this.vn.settings.promptPrefix;
                const autoCheck = document.getElementById("re-vn-auto-check");
                if (autoCheck) autoCheck.checked = this.vn.autoMode;
            }
        });

        $(document)
            .off("pointerup.realityEngine click.realityEngine", "#re-vn-save-settings")
            .on("pointerup.realityEngine click.realityEngine", "#re-vn-save-settings", (e) => {
            e.preventDefault(); e.stopPropagation();
            const speed = parseInt(document.getElementById("re-vn-speed").value) || 30;
            const words = parseInt(document.getElementById("re-vn-words").value) || 50;
            const prompt = document.getElementById("re-vn-prompt").value || "";
            const autoCheck = document.getElementById("re-vn-auto-check");

            this.vn.settings.speed = speed;
            this.vn.settings.wordsPerBox = words;
            this.vn.settings.promptPrefix = prompt;

            if (autoCheck) {
                this.vn.autoMode = autoCheck.checked;
                // Update the toggle button UI too
                const btn = document.getElementById("re-vn-auto-toggle");
                if (btn) {
                    btn.style.color = this.vn.autoMode ? "#cba35c" : "";
                    btn.style.opacity = this.vn.autoMode ? "1" : "0.5";
                }
            }

            this.saveVnSettings();

            $("#re-vn-settings-modal").hide();
            this.vn.pages = this.paginateText(this.vn.text);
            this.vn.pageIdx = 0;
            this.renderVnPage();
        });

        // Main UI Controls
        $roots.on("pointerup click", "#re-exit", (e) => {
            if (!actGate("exit")) return;
            e.preventDefault(); e.stopPropagation();
            const s = getSettings();
            ensureReality(s);
            s.realityEngine.enabled = false;
            saveSettings();
            setStageEnabled(false);
        });

        $roots.on("pointerup click", "#re-toggle-view", (e) => {
            if (!actGate("toggleview")) return;
            e.preventDefault(); e.stopPropagation();
            const s = getSettings();
            ensureReality(s);
            const next = s.realityEngine.view === "map" ? "room" : "map";
            this.setView(next);
        });

        $roots.on("pointerup click", "#re-toggle-nav", (e) => {
            if (!actGate("togglenav")) return;
            e.preventDefault(); e.stopPropagation();
            const s = getSettings();
            ensureReality(s);
            if (!s.realityEngine.ui) s.realityEngine.ui = {};
            s.realityEngine.ui.showNav = !s.realityEngine.ui.showNav;
            saveSettings();
            import("./navigation.js").then(m => m.refreshNavVisibility?.()).catch(() => {});
        });

        // Input Handling
        $roots.on("keydown", "#re-user-input", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault(); e.stopPropagation();
                proxySend();
            }
        });

        $roots.on("pointerup click", "#re-q-send", (e) => {
            e.preventDefault(); e.stopPropagation();
            proxySend();
        });

        // UNIFIED PROJECTION BUTTON HANDLER
        $roots.on("pointerdown mousedown pointerup click contextmenu", ".re-qbtn", async (e) => {
            e.stopPropagation();
        });

    // --- GLOBAL UI HANDLERS (Document Level) ---
    // Force pointerup/click capture to bypass blockers
    let menuToggleLock = 0;

    const reVv = () => {
        // NOTE: getBoundingClientRect() is already relative to the *current* viewport in most mobile browsers.
        // Adding visualViewport offsets can double-apply the offset and effectively pin UI to the top.
        const vv = (typeof window !== "undefined") ? window.visualViewport : null;
        const vw = Number(vv?.width || window.innerWidth || 0);
        const vh = Number(vv?.height || window.innerHeight || 0);
        return { vw, vh };
    };
    const reClamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const rePlaceFixed = (el, left, top) => {
        if (!el) return;
        try { el.style.setProperty("position", "fixed", "important"); } catch (_) { el.style.position = "fixed"; }
        try { el.style.setProperty("left", `${Math.round(left)}px`, "important"); } catch (_) { el.style.left = `${Math.round(left)}px`; }
        try { el.style.setProperty("top", `${Math.round(top)}px`, "important"); } catch (_) { el.style.top = `${Math.round(top)}px`; }
        try { el.style.setProperty("right", "auto", "important"); } catch (_) { el.style.right = "auto"; }
        try { el.style.setProperty("bottom", "auto", "important"); } catch (_) { el.style.bottom = "auto"; }
        try { el.style.setProperty("transform", "none", "important"); } catch (_) { el.style.transform = "none"; }
    };
    const reCenterFixedClamped = (el, pad = 10) => {
        if (!el) return;
        const { vw, vh } = reVv();
        const r = el.getBoundingClientRect();
        const w = Number(r.width || 320);
        const h = Number(r.height || 260);
        const left = reClamp((vw - w) / 2, pad, vw - w - pad);
        const top = reClamp((vh - h) / 2, pad, vh - h - pad);
        rePlaceFixed(el, left, top);
    };
    const rePlaceNearAnchor = (el, anchorEl, pad = 10) => {
        if (!el) return;
        const { vw, vh } = reVv();
        const a = anchorEl?.getBoundingClientRect?.();
        const r = el.getBoundingClientRect();
        const w = Number(r.width || 320);
        const h = Number(r.height || 260);
        const ar = a || { left: vw / 2, top: vh / 2, width: 0, height: 0, bottom: vh / 2, right: vw / 2 };

        // Prefer above anchor; if not enough room, place below.
        let left = ar.left + (ar.width / 2) - (w / 2);
        let top = ar.top - h - 10;
        const minLeft = pad;
        const maxLeft = vw - w - pad;
        const minTop = pad;
        const maxTop = vh - h - pad;
        left = reClamp(left, minLeft, maxLeft);
        if (top < minTop) top = reClamp((ar.bottom || (ar.top + ar.height)) + 10, minTop, maxTop);
        top = reClamp(top, minTop, maxTop);
        rePlaceFixed(el, left, top);
    };

    const reFitToViewport = (el, pad = 10, opts = {}) => {
        if (!el) return;
        const { vw, vh } = reVv();
        const minH = Number(opts.minH ?? 140);
        const minW = Number(opts.minW ?? 200);
        const maxH = Math.max(minH, Math.floor(vh - pad * 2));
        const maxW = Math.max(minW, Math.floor(vw - pad * 2));
        try {
            el.style.setProperty("max-height", `${maxH}px`, "important");
            el.style.setProperty("max-width", `${maxW}px`, "important");
            el.style.setProperty("overflow", "auto", "important");
        } catch (_) {}
    };

    const reNormalizeQuickModal = (modal) => {
        if (!modal) return;
        try {
            // If any other code mutated styles, force the overlay back to a safe centering baseline.
            modal.style.setProperty("position", "fixed", "important");
            modal.style.setProperty("inset", "0", "important");
            modal.style.setProperty("top", "0", "important");
            modal.style.setProperty("left", "0", "important");
            modal.style.setProperty("right", "0", "important");
            modal.style.setProperty("bottom", "0", "important");
            modal.style.setProperty("align-items", "center", "important");
            modal.style.setProperty("justify-content", "center", "important");
            modal.style.setProperty("padding", "14px", "important");
            modal.style.setProperty("pointer-events", "auto", "important");
            modal.style.setProperty("z-index", "2147483647", "important");
        } catch (_) {}
        try {
            const card = modal.firstElementChild;
            if (card) {
                reFitToViewport(card, 14, { minH: 160, minW: 260 });
                try { card.style.setProperty("position", "fixed", "important"); } catch (_) { card.style.position = "fixed"; }
            }
        } catch (_) {}
    };

    const rePulseWhileOpen = (() => {
        let t = 0;
        return () => {
            if (t) return;
            let n = 0;
            t = window.setInterval(() => {
                n++;
                try {
                    const menu = document.getElementById("re-st-menu");
                    if (menu && String(getComputedStyle(menu).display || "") !== "none") {
                        reFitToViewport(menu, 10, { minH: 120, minW: 240 });
                        const anchor = document.getElementById("re-q-menu") || document.getElementById("uie-launcher");
                        rePlaceNearAnchor(menu, anchor, 10);
                    }
                } catch (_) {}
                try {
                    const modal = document.getElementById("re-quick-modal");
                    if (modal && String(getComputedStyle(modal).display || "") !== "none") {
                        reNormalizeQuickModal(modal);
                        const card = modal.firstElementChild;
                        if (card) {
                            reFitToViewport(card, 14, { minH: 160, minW: 260 });
                            reCenterFixedClamped(card, 10);
                        }
                    }
                } catch (_) {}

                // Run a few times to defeat late style overrides, then stop.
                if (n >= 12) {
                    try { window.clearInterval(t); } catch (_) {}
                    t = 0;
                }
            }, 120);
        };
    })();

    const ensureReViewportWatcher = (() => {
        let on = false;
        return () => {
            if (on) return;
            on = true;
            const handler = () => {
                try {
                    const menu = document.getElementById("re-st-menu");
                    if (menu && String(getComputedStyle(menu).display || "") !== "none") {
                        const anchor = document.getElementById("re-q-menu") || document.getElementById("uie-launcher");
                        rePlaceNearAnchor(menu, anchor, 10);
                    }
                } catch (_) {}
                try {
                    const modal = document.getElementById("re-quick-modal");
                    if (modal && String(getComputedStyle(modal).display || "") !== "none") {
                        const card = modal.firstElementChild;
                        if (card) {
                            // Keep card within visible viewport
                            reFitToViewport(card, 14, { minH: 160, minW: 260 });
                            reCenterFixedClamped(card, 10);
                        }
                    }
                } catch (_) {}
            };
            try { window.addEventListener("resize", handler, { passive: true }); } catch (_) {}
            try { window.addEventListener("orientationchange", handler, { passive: true }); } catch (_) {}
            try {
                if (window.visualViewport) {
                    window.visualViewport.addEventListener("resize", handler, { passive: true });
                    window.visualViewport.addEventListener("scroll", handler, { passive: true });
                }
            } catch (_) {}
        };
    })();

    const syncStageMenu = () => {
        const menu = document.getElementById("re-st-menu");
        if (!menu) return null;
        const quickButtons = getRealityQuickButtons();
        const items = [
            { id: "re-act-continue", icon: "fa-forward", label: "Continue" },
            { id: "re-act-regenerate", icon: "fa-rotate-right", label: "Regenerate" },
            { id: "re-act-stop", icon: "fa-stop", label: "Stop response" },
            { id: "re-act-scan-all", icon: "fa-arrows-rotate", label: "UIE Scan All" },
            { id: "re-act-user-prompt", icon: "fa-lightbulb", label: "User Prompt" },
            { sep: true },
            { id: "re-act-skip-school", icon: "fa-graduation-cap", label: "Skip School Day" },
            { id: "re-act-skip-work", icon: "fa-briefcase", label: "Skip Work Day" },
            { id: "re-act-skip-travel", icon: "fa-route", label: "Skip Travel" },
            { id: "re-act-add-menu-icon", icon: "fa-plus", label: "Add Menu Icon" }
        ];

        if (quickButtons.length) {
            items.push({ sep: true });
            quickButtons.forEach((btn) => {
                items.push({
                    id: `re-act-quick-${btn.idx}`,
                    icon: btn.icon,
                    label: btn.label,
                    quickIdx: btn.idx,
                    title: btn.desc
                });
            });
        }

        menu.innerHTML = "";
        items.forEach((item) => {
            if (item.sep) {
                const sep = document.createElement("div");
                sep.style.cssText = "height:1px; background:rgba(255,255,255,0.1); margin:4px 0;";
                menu.appendChild(sep);
                return;
            }
            const el = document.createElement("div");
            el.className = "re-menu-item";
            el.id = item.id;
            if (item.quickIdx !== undefined) el.dataset.quickIdx = String(item.quickIdx);
            if (item.title) el.title = item.title;
            el.innerHTML = `<i class="fa-solid ${item.icon}"></i> ${esc(item.label)}`;
            menu.appendChild(el);
        });
        return menu;
    };

    try { window.UIE_syncRealityMenu = syncStageMenu; } catch (_) {}

    const skipContextBlock = (kind) => {
        const s = getSettings();
        const loc = String(s.worldState?.location || s.map?.location || "current area").trim();
        const lower = loc.toLowerCase();
        const atSchool = /\b(school|academy|campus|classroom|university|college)\b/.test(lower);
        const atWork = /\b(work|job|office|shop|store|cafe|factory|guild|station|clinic|studio)\b/.test(lower);
        if (kind === "school" && !atSchool) return { ok: false, message: "You are not in a school area." };
        if (kind === "work" && !atWork) return { ok: false, message: "You are not in a work area." };
        return { ok: true, loc };
    };

    const skipToEndOfBlock = (kind) => {
        const s = getSettings();
        const check = skipContextBlock(kind);
        if (!check.ok && kind !== "travel") {
            notify("warning", check.message, "Skip");
            return;
        }
        const nowHour = Number(s.playerRoom?.hour ?? 8);
        const targets = { school: 15, work: 17, travel: nowHour + 2 };
        const targetHour = targets[kind] ?? nowHour + 1;
        let minutes = Math.max(30, Math.round((targetHour - nowHour) * 60));
        if (kind === "travel") minutes = 120;
        if (minutes <= 0) minutes += 24 * 60;
        const result = advanceWorldTimeMinutes(s, minutes, { reason: `Skip ${kind}` });
        saveSettings();
        const loc = check.loc || String(s.worldState?.location || "the destination").trim();
        const summary = kind === "school"
            ? `School day skipped at ${loc}. Classes, routine social contact, lunch, and end-of-day dismissal passed without a major scene interruption.`
            : kind === "work"
                ? `Work day skipped at ${loc}. The shift, ordinary tasks, coworkers/customers, and closing routine passed without a major scene interruption.`
                : `Travel skipped. The party reached the intended route endpoint after ${minutes} minutes of uneventful travel.`;
        injectRpEvent(`[System: ${summary} Time is now Day ${result.day}, ${String(result.hour).padStart(2, "0")}:${String(result.minute).padStart(2, "0")}.]`);
        notify("success", summary, "Skip");
        try { window.dispatchEvent(new CustomEvent("uie:state_updated", { detail: { skipped: kind, minutes } })); } catch (_) {}
    };

    window.reToggleMenu = (e) => {
        // Prevent double-firing (pointerup + click)
        const now = Date.now();
        if (now - menuToggleLock < 300) {
            if (e) { try{e.preventDefault(); e.stopPropagation();}catch(_){} }
            return;
        }
        menuToggleLock = now;

        if(e) { try{e.preventDefault(); e.stopPropagation();}catch(_){} }

        // --- INJECTION: Ensure Menu Exists ---
        let m = document.getElementById("re-st-menu");
        if (!m) {
            console.warn("[UIE] Menu missing, injecting...");
            m = document.createElement("div");
            m.id = "re-st-menu";
            m.style.cssText = "position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); width:min(320px, 86vw); display:none; flex-direction:column; gap:8px; padding:10px; border-radius:16px; border:1px solid rgba(255,255,255,0.14); background:rgba(15,10,10,0.96); box-shadow:0 20px 40px rgba(0,0,0,0.75); z-index:2147483640; pointer-events:auto;";
            document.body.appendChild(m);
        }
        m = syncStageMenu() || m;
        // -----------------------------------------

        // Ensure it's not trapped inside the stage DOM (mobile fixed-position can behave badly in transformed/contained ancestors)
        try {
            if (m && m.parentElement !== document.body) {
                document.body.appendChild(m);
            }
        } catch (_) {}

        if (!m) {
            console.error("[UIE] Menu element #re-st-menu not found!");
            try { notify("error", "Menu element not found!", "UIE"); } catch (_) {}
            return;
        }

        // If hidden, show it
        const isHidden = window.getComputedStyle(m).display === "none";

        if (isHidden) {
            // First make it display flex but hidden to measure
            m.style.visibility = "hidden";
            m.style.display = "flex";
            m.style.zIndex = "2147483640"; // Force max z-index
            m.style.pointerEvents = "auto"; // Force clickable

            const isMobile = (() => {
                try { return isMobileUI(); } catch (_) {}
                try { return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches; } catch (_) { return window.innerWidth < 768; }
            })();

            if (isMobile) {
                // Mobile: place near the menu button, but relative to the VISUAL viewport (keyboard/address-bar safe).
                const anchor = document.getElementById("re-q-menu") || document.getElementById("uie-launcher");
                reFitToViewport(m, 10, { minH: 120, minW: 240 });
                rePlaceNearAnchor(m, anchor, 10);
            } else {
                // Desktop: position next to the launcher/quick menu button
                const anchor = document.getElementById("re-q-menu") || document.getElementById("uie-launcher");
                if (anchor) {
                    const btnRect = anchor.getBoundingClientRect();
                    const menuRect = m.getBoundingClientRect();
                    m.style.position = "fixed";
                    m.style.left = `${btnRect.right + 8}px`;
                    m.style.top = `${btnRect.top}px`;
                    m.style.transform = "none";

                    // Keep on screen - clamp to viewport bounds
                    let left = parseFloat(m.style.left) || 0;
                    let top = parseFloat(m.style.top) || 0;

                    // If it doesn't fit to the right, place it on the left
                    if (left + menuRect.width > window.innerWidth - 10) {
                        left = btnRect.left - menuRect.width - 8;
                    }

                    // Clamp to viewport bounds (never off-screen)
                    left = Math.max(10, Math.min(left, window.innerWidth - menuRect.width - 10));
                    top = Math.max(10, Math.min(top, window.innerHeight - menuRect.height - 10));

                    m.style.left = `${left}px`;
                    m.style.top = `${top}px`;
                } else {
                    // Fallback to center
                    m.style.position = "fixed";
                    m.style.top = "50%";
                    m.style.left = "50%";
                    m.style.transform = "translate(-50%, -50%)";
                }
            }

            m.style.visibility = "visible";
            ensureReViewportWatcher();
            rePulseWhileOpen();
            // try { notify("info", "Menu Opened", "UIE"); } catch (_) {}
        } else {
            m.style.display = "none";
        }
    };

    // Initial Menu Injection (Ensure it exists before click)
    try {
        if (!document.getElementById("re-st-menu")) {
             window.reToggleMenu(null); // Force inject
             // But hide it immediately if it shows up
             const m = document.getElementById("re-st-menu");
             if (m) m.style.display = "none";
        }
    } catch (_) {}

    // Bind to roots directly because body listener is blocked by stopPropagation
    $roots.on("pointerup click", "#re-q-menu", (e) => { if(window.reToggleMenu) window.reToggleMenu(e); });

    // --- MAGNIFYING GLASS FIX ---
    $roots.on("pointerup click", "#re-q-scavenge", (e) => {
        e.preventDefault(); e.stopPropagation();
        try {
            if (typeof window !== "undefined" && typeof window.UIE_openScavengeEmbedded === "function") {
                window.UIE_openScavengeEmbedded();
                return;
            }
        } catch (_) {}
        spawnScavengeNodes();
    });

    // --- QUICK SKILLS/ITEMS FIX ---
    // Ensure clicks on the grid items are not blocked
    $roots.on("pointerup click", ".re-actbtn", (e) => {
        // Allow the native onclick to fire, but stop propagation to prevent stage clicks
        e.stopPropagation();
    });
    // Fix "Add" button if needed (Open Modal)
    $roots.on("pointerup click", "#re-q-add", (e) => {
        e.preventDefault(); e.stopPropagation();
        const modal = document.getElementById("re-quick-modal");
        if (modal) {
            try {
                if (modal.parentElement !== document.body) {
                    document.body.appendChild(modal);
                }
            } catch (_) {}
            modal.style.display = "flex";
            reNormalizeQuickModal(modal);
            const l = document.getElementById("re-quick-label"); if(l) l.value = "";
            const i = document.getElementById("re-quick-icon"); if(i) i.value = "";
            const p = document.getElementById("re-quick-prompt"); if(p) p.value = "";

            try {
                const card = modal.firstElementChild;
                if (card) {
                    card.style.position = "fixed";
                    reFitToViewport(card, 14, { minH: 160, minW: 260 });
                    // Measure after display:flex is applied
                    requestAnimationFrame(() => {
                        try { reCenterFixedClamped(card, 10); } catch (_) {}
                    });
                }
            } catch (_) {}
            ensureReViewportWatcher();
            rePulseWhileOpen();
        }
    });


    // Menu binding is handled via window.reToggleMenu + $roots handler above.

    $roots.on("pointerup click", ".re-qbtn, .re-custom-btn", async (e) => {
            if (e.type === "contextmenu") {
                e.preventDefault();
                const el = e.currentTarget;
                if (el.classList.contains("re-custom-btn")) {
                    const idx = parseInt(el.dataset.idx);
                    const label = el.dataset.label || "Action";
                    if (confirm(`Delete button "${label}"?`)) {
                        const s = getSettings();
                        if (s.realityEngine?.quickButtons) {
                            s.realityEngine.quickButtons.splice(idx, 1);
                            saveSettings();
                            this.syncEnabled();
                        }
                    }
                }
                return;
            }

            if (e.type !== "click" && e.type !== "pointerup") return;
            // Skip if handled by global handler
            if (e.currentTarget.id === "re-q-menu") return;

            if (!actGate("qbtn_action_" + e.currentTarget.id, 450)) return;

            e.preventDefault();
            const el = e.currentTarget;
            const id = el.id;

            if (id === "re-q-chatbox") {
                try {
                    const openChat = async () => {
                        const win = $("#uie-chatbox-window");
                        if (win.length) {
                            win.show();
                            win.css("z-index", "2147483635");
                            win.css("display", "flex");
                            try {
                                if (isMobileUI()) {
                                    const el = win.get(0);
                                    if (el) {
                                        el.style.setProperty("position", "fixed", "important");
                                        el.style.setProperty("left", "50%", "important");
                                        el.style.setProperty("top", "50%", "important");
                                        el.style.setProperty("right", "auto", "important");
                                        el.style.setProperty("bottom", "auto", "important");
                                        el.style.setProperty("transform", "translate(-50%, -50%)", "important");
                                    }
                                }
                            } catch (_) {}
                            try { (await import("./chatbox.js")).openChatbox?.(); } catch (_) {}
                        } else {
                            try { (await import("./chatbox.js")).openChatbox?.(); } catch (_) {}
                        }
                    };
                    if (document.getElementById("uie-chatbox-window")) { await openChat(); return; }
                    const baseUrl = String(window.UIE_BASEURL || "/").trim();
                    import("./templateFetch.js").then(async (m) => {
                        const fetchTemplateHtml = m?.fetchTemplateHtml;
                        if (typeof fetchTemplateHtml !== "function") { await openChat(); return; }
                        let html = "";
                        const urls = [`${baseUrl}src/templates/chatbox.html`];
                        for (const u of urls) {
                            try { html = await fetchTemplateHtml(u); if (html) break; } catch (_) {}
                        }
                        if (html) $("body").append(html);
                        await openChat();
                    }).catch(async () => await openChat());
                } catch (_) {}
            }
            else if (id === "re-q-add") {
                const modal = document.getElementById("re-quick-modal");
                if (modal) {
                    try {
                        if (modal.parentElement !== document.body) {
                            document.body.appendChild(modal);
                        }
                    } catch (_) {}
                    modal.style.display = "flex";
                    reNormalizeQuickModal(modal);
                    // Reset fields
                    const l = document.getElementById("re-quick-label"); if(l) l.value = "";
                    const i = document.getElementById("re-quick-icon"); if(i) i.value = "";
                    const p = document.getElementById("re-quick-prompt"); if(p) p.value = "";

                    try {
                        const card = modal.firstElementChild;
                        if (card) {
                            card.style.position = "fixed";
                            reFitToViewport(card, 14, { minH: 160, minW: 260 });
                            requestAnimationFrame(() => {
                                try { reCenterFixedClamped(card, 10); } catch (_) {}
                            });
                        }
                    } catch (_) {}
                    ensureReViewportWatcher();
                    rePulseWhileOpen();
                }
            }
            else if (el.classList.contains("re-custom-btn")) {
                const text = el.dataset.text || "";
                const ta = document.getElementById("send_textarea");
                if (ta) {
                    const start = ta.selectionStart || ta.value.length;
                    const end = ta.selectionEnd || ta.value.length;
                    const val = ta.value;
                    ta.value = val.substring(0, start) + text + val.substring(end);
                    ta.selectionStart = ta.selectionEnd = start + text.length;
                    ta.dispatchEvent(new Event("input", { bubbles: true }));
                    ta.focus();
                }
            }
        });

        // Composer / Menu dismissal
        $roots.on("pointerup click", "#re-composer-wrap", (e) => {
            if ($(e.target).closest("#re-st-menu, #re-q-menu").length) return;
            const m = document.getElementById("re-st-menu");
            if (m && m.style.display === "flex") m.style.display = "none";
        });

        // Menu Actions
        $roots.on("pointerup click", "#re-act-regenerate", (e) => {
            if (!actGate("regen")) return;
            e.preventDefault(); e.stopPropagation();
            const els = stEls(); if (els.regen) els.regen.click();
            $("#re-st-menu").hide();
        });
        $roots.on("pointerup click", "#re-act-continue", (e) => {
            if (!actGate("cont")) return;
            e.preventDefault(); e.stopPropagation();
            const els = stEls(); if (els.cont) els.cont.click();
            $("#re-st-menu").hide();
        });

        $(document).off("pointerup click.uieUserPrompt", "#re-act-user-prompt").on("pointerup click.uieUserPrompt", "#re-act-user-prompt", (e) => {
            if (!actGate("prompt")) return;
            e.preventDefault(); e.stopPropagation();
            try { $("#re-st-menu").hide(); } catch (_) {}
            showUserPromptModal(e.currentTarget);
        });

        $(document).off("click.uieImpersonation", "#q-impersonation").on("click.uieImpersonation", "#q-impersonation", (e) => {
            e.preventDefault(); e.stopPropagation();
            showImpersonationPopup(e.currentTarget);
        });

        // Next beat functionality - keep always visible
        $("#next-beat-container").show();
        $(document).off("input.uieUserInput", "#user-input").on("input.uieUserInput", "#user-input", function() {
            $("#next-beat-container").show();
        });

        $(document).off("pointerup click.uieNextBeatDel", "#next-beat-delete").on("pointerup click.uieNextBeatDel", "#next-beat-delete", function() {
            $("#next-beat-input").val("");
        });

        // Handle next beat input when sending message
        $(document).off("pointerup click.uieSendBtn", "#send-btn").on("pointerup click.uieSendBtn", "#send-btn", function() {
            const nextBeat = $("#next-beat-input").val().trim();
            if (nextBeat) {
                // Store next beat for the next AI response
                window.UIE_nextBeatPrompt = nextBeat;
                // Clear next beat after use
                $("#next-beat-input").val("");
            }
        });

        $roots.on("pointerup click", "#re-act-stop", (e) => {
            if (!actGate("stop")) return;
            e.preventDefault(); e.stopPropagation();
            const els = stEls(); if (els.stop) els.stop.click();
            $("#re-st-menu").hide();
        });
        $roots.on("pointerup click", "#re-act-scan-all", async (e) => {
            if (!actGate("scanall", 1200)) return;
            e.preventDefault(); e.stopPropagation();
            $("#re-st-menu").hide();
            try {
                const mod = await import("./orchestration.js");
                await mod.scanAll?.({ force: true, source: "re_menu" });
            } catch (err) {
                console.error("[UIE] Reality menu scan-all failed", err);
                try { notify("error", "UIE scan failed.", "Scanner"); } catch (_) {}
            }
        });
        $roots.on("pointerup click", "#re-act-skip-school, #re-act-skip-work, #re-act-skip-travel", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = String(e.currentTarget?.id || "");
            if (id.endsWith("school")) skipToEndOfBlock("school");
            else if (id.endsWith("work")) skipToEndOfBlock("work");
            else skipToEndOfBlock("travel");
            $("#re-st-menu").hide();
        });
        $roots.on("pointerup click", "#re-act-add-menu-icon", (e) => {
            e.preventDefault();
            e.stopPropagation();
            $("#re-st-menu").hide();
            const add = document.getElementById("re-q-add");
            if (add) add.click();
        });
        $roots.on("pointerup click", "#re-st-menu .re-menu-item[data-quick-idx]", (e) => {
            const idx = Number.parseInt(String(e.currentTarget?.dataset?.quickIdx || ""), 10);
            if (!Number.isInteger(idx)) return;
            if (!actGate(`menu_quick_${idx}`, 250)) return;
            e.preventDefault(); e.stopPropagation();
            const btn = getRealityQuickButtons().find((entry) => entry.idx === idx);
            if (!btn) return;
            insertQuickActionText(btn.text);
            $("#re-st-menu").hide();
        });

        // Forge Handlers
        $roots.on("pointerup click", "#re-forge-btn", (e) => {
            if (!actGate("forgebtn")) return;
            e.preventDefault(); e.stopPropagation();
            this.openForge();
        });
        $roots.on("pointerup click", "#re-forge-close", (e) => {
            if (!actGate("forgeclose")) return;
            e.preventDefault(); e.stopPropagation();
            this.closeForge();
        });
        $roots.on("pointerup click", "#re-forge-modal", (e) => {
            if ($(e.target).closest("#re-forge-card").length) return;
            this.closeForge();
        });
        $roots.on("pointerup click", "#re-forge-generate", async (e) => {
            if (!actGate("forgegen", 900)) return;
            e.preventDefault(); e.stopPropagation();
            await this.forgeGenerate();
        });
        $roots.on("pointerup click", "#re-forge-bind", (e) => {
            if (!actGate("forgebind")) return;
            e.preventDefault(); e.stopPropagation();
            this.forgeBind();
        });

        $roots.on("pointerup", "#re-phone, #re-journal, #re-q-phone, #re-q-journal", (e) => {
            e.preventDefault(); e.stopPropagation();
        });

        // Helper for proxying text input
        const stEls = () => {
            const pick = (sels) => {
                for (const sel of sels) {
                    try {
                        const el = document.querySelector(sel);
                        if (el) return el;
                    } catch (_) {}
                }
                return null;
            };
            return {
                ta: pick(["textarea#send_textarea", "textarea#send_text", "textarea"]) ,
                send: pick(["#send_but", "#send_button", "#send", "[data-testid='send']"]),
                regen: pick(["#option_regenerate", "#regenerate_but", "#regenerate_button", "#regenerate", "#regen", "[data-action='regenerate']", "[data-testid='regenerate']"]),
                cont: pick(["#option_continue", "#continue_but", "#continue_button", "#continue", "[data-action='continue']", "[data-testid='continue']"]),
                imp: pick(["#option_impersonate", "#impersonate_but", "#impersonate_button", "#impersonate", "#impersonate_button_sheld", "[data-action='impersonate']"]),
                stop: pick(["#stop_but", "#stop_button", "#stop", "[data-testid='stop']"])
            };
        };

        const proxySend = () => {
            const ui = document.getElementById("re-user-input");
            if (!ui) return;
            let t = String(ui.value || "").trim();
            if (this.vn.settings.promptPrefix && t && !t.startsWith(this.vn.settings.promptPrefix)) {
                t = `${this.vn.settings.promptPrefix}\n${t}`;
            }
            const els = stEls();
            if (els.ta) {
                els.ta.value = t;
                els.ta.dispatchEvent(new Event("input", { bubbles: true }));
                els.ta.dispatchEvent(new Event("change", { bubbles: true }));
            }
            if (els.send) els.send.click();
            ui.value = "";
        };

        const stMenu = {
            btn() {
                const selectors = ["#options_button", "#options_button_sheld", "#chat_options_button", "#chat_options", "#options", "#three_dots"];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) return el;
                }
                return null;
            },
            findMenuRoot() {
                const candidates = ["#optionsMenu", "#options_menu", "#options-panel", ".context-menu", ".dropdown-menu.show", "#app_options", "#shadow_popup"];
                for (const sel of candidates) {
                    const el = document.querySelector(sel);
                    if (!el) continue;
                    const st = window.getComputedStyle(el);
                    if (st.display !== "none" && st.visibility !== "hidden" && st.opacity !== "0") return el;
                }
                // Fallback: Look for any visible element with high z-index that looks like a menu
                return null;
            },
            openNearWand() {
                const b = this.btn(); if (b) b.click();
                setTimeout(() => {
                    const m = this.findMenuRoot();
                    if (!m) return;
                    try { m.style.zIndex = "2147483647"; m.style.position = "fixed"; } catch (_) {}
                    try {
                        const wand = document.getElementById("re-q-menu");
                        const r = wand?.getBoundingClientRect?.();
                        if (!r) return;
                        const pad = 8;
                        const w = Math.min(360, Math.max(240, m.getBoundingClientRect().width || 300));
                        const h = Math.min(520, Math.max(240, m.getBoundingClientRect().height || 320));
                        const left = Math.max(pad, Math.min(window.innerWidth - w - pad, r.left));
                        const top = Math.max(pad, Math.min(window.innerHeight - h - pad, r.bottom + 6));
                        m.style.left = `${left}px`;
                        m.style.top = `${top}px`;
                    } catch (_) {}
                }, 0);
            },
            clickItem(textRe) {
                const root = this.findMenuRoot();
                if (!root) return false;
                const els = root.querySelectorAll("button, a, div, li, span");
                for (const el of els) {
                    const t = String(el.textContent || "").trim();
                    if (t && textRe.test(t)) { el.click(); return true; }
                }
                return false;
            }
        };
    }

    startChatObserver() {
        const chat = document.getElementById("chat");
        if (!chat) return;
        if (reObserver) reObserver.disconnect();
        let t = 0;
        reObserver = new MutationObserver(() => {
            const s = getSettings();
            ensureReality(s);
            if (s.realityEngine.enabled !== true) return;
            if (t) clearTimeout(t);
            t = setTimeout(() => {
                const last = readLastChatMessage();
                if (!last) return;
                const sig = hash(`${last.name}::${last.text}`.slice(-1600));
                if (sig === reLastSig) return;
                reLastSig = sig;
                this.updateFromChat(last.name, last.text);
            }, 900);
        });
        reObserver.observe(chat, { childList: true, subtree: true });
    }

    syncEnabled() {
        const s = getSettings();
        ensureReality(s);
        if (s.realityEngine.comingSoon === true) {
            setStageEnabled(false);
            return;
        }

        setStageEnabled(s.realityEngine.enabled === true);
        if (s.realityEngine.enabled) {
            this.applyBackground();
            this.bindUi();
            this.updateHud();
            this.setView(s.realityEngine.view);
            this.startChatObserver();

            // --- INITIALIZE SYNC MODULES ---
            try { initChatSync(); } catch (e) { console.error("ChatSync init failed", e); }
            try { initNavigation(); } catch (e) { console.error("Navigation init failed", e); }
            // -------------------------------

            try {
                ensureRealityV3().then((eng) => {
                    if (!eng) return;
                    try { eng.ensureLocationFromWorldState(); } catch (_) {}
                });
            } catch (_) {}

            try {
                const q = document.getElementById("re-quick");
                const grid = document.getElementById("re-action-grid");

                // CUSTOM QUICK BUTTONS LOGIC
                if (q && grid) {
                    // Do NOT clear q.innerHTML (System buttons are in HTML now)
                    // q.innerHTML = "";
                    grid.innerHTML = ""; // Clear Action Grid (Custom buttons only)

                    const s = getSettings();
                    if (!s.realityEngine.quickButtons) s.realityEngine.quickButtons = [];

                    const beforeCount = s.realityEngine.quickButtons.length;
                    // AGGRESSIVE CLEANUP: Remove banned buttons from settings permanently
                    const banList = ["work", "flirt", "chat", "shop", "talk", "actions"];
                    s.realityEngine.quickButtons = s.realityEngine.quickButtons.filter(btn => {
                        const lbl = String(btn.label || "").trim().toLowerCase();
                        return !banList.some(b => lbl.includes(b));
                    });

                    if (s.realityEngine.quickButtons.length !== beforeCount) {
                        saveSettings();
                    }

                    // IF NO BUTTONS, SHOW GUIDE TEXT
                    if (s.realityEngine.quickButtons.length === 0) {
                        const guide = document.createElement("div");
                        guide.style.cssText = "color:rgba(255,255,255,0.4); font-size:0.8em; text-align:center; padding:10px; width:100%; grid-column:1/-1; pointer-events:none; font-family:sans-serif;";
                        guide.innerText = "No Quick Buttons set. Use the + button to add them.";
                        grid.appendChild(guide);
                    }

                    // System Buttons are static in HTML.
                    // We only need to bind specific dynamic behaviors if they aren't global.
                    // The event listeners in bindUi handle clicks.
                    // Note: Menu positioning (qMenuPos) logic for the button itself is deprecated in favor of CSS flow,
                    // but if users want floating menu button, that would need specific handling.
                    // For now, we respect the HTML layout.

                    // 2. Render Custom Action Buttons -> #re-action-grid (Above)
                    const quickButtons = getRealityQuickButtons();

                    quickButtons.forEach((btn) => {
                        const el = document.createElement("button");
                        el.className = "re-actbtn"; // Larger Grid Button
                        el.innerHTML = `<i class="fa-solid ${btn.icon || 'fa-bolt'}"></i> ${btn.label}`;
                        el.title = btn.desc || "";
                        el.dataset.quickIdx = String(btn.idx);
                        el.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            insertQuickActionText(btn.text);
                        };
                        el.oncontextmenu = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if(confirm(`Delete button "${btn.label}"?`)) {
                                s.realityEngine.quickButtons.splice(btn.idx, 1);
                                saveSettings();
                                this.syncEnabled();
                            }
                        };
                        grid.appendChild(el);
                    });

                    if (window.reToggleMenu) {
                        try { window.UIE_syncRealityMenu?.(); } catch (_) {}
                    }

                    const show = s.realityEngine.ui?.showQuickButtons !== false;

                    // Toggle visibility
                    if (!show) {
                        q.style.display = "none";
                        grid.style.display = "none";
                    } else {
                        q.style.display = "flex";
                        grid.style.display = "flex";
                    }
                }
            } catch (_) {}

            try {
                const hud = document.getElementById("re-hud");
                if (hud) hud.style.display = s.realityEngine.ui?.showHud === false ? "none" : "flex";
            } catch (_) {}
            const last = readLastChatMessage();
            if (last) this.updateFromChat(last.name, last.text);
        } else {
            this.closeForge();
        }
    }
}

export function syncWgScopeHint() {
    const v = String($("#wg-scope").val() || "area");
    const hints = {
        blueprint: "Explicitly regenerates the detailed layout for the active bounded site. The scale control specifies its location count.",
        area: "Builds local destinations and their Nearby places. Detailed layouts follow your Detailed Layouts choice.",
        region: "Builds a regional route structure containing cities, towns, wilderness, and visitable places.",
        world: "Builds a full multi-world atlas system (planets, realms, planes) based on lorebook, chat, and prompt directives."
    };
    $("#wg-scope-hint").html(hints[v] || hints.area);

    const isBlueprint = (v === "blueprint");
    const isArea = (v === "area");
    const isRegion = (v === "region");
    const isWorld = (v === "world");

    const countWorlds = $("#wg-count-worlds");
    const countWorldsWrapper = $("#wg-count-worlds-wrapper");
    if (countWorlds.length) {
        const active = isWorld;
        countWorlds.prop("disabled", !active).css("opacity", active ? "1" : "0.35");
        countWorldsWrapper.css("opacity", active ? "1" : "0.35");
    }

    const countRegions = $("#wg-count-regions");
    const countRegionsWrapper = $("#wg-count-regions-wrapper");
    if (countRegions.length) {
        const active = isWorld || isRegion;
        countRegions.prop("disabled", !active).css("opacity", active ? "1" : "0.35");
        countRegionsWrapper.css("opacity", active ? "1" : "0.35");
    }

    const countSettlements = $("#wg-count-settlements");
    const countSettlementsWrapper = $("#wg-count-settlements-wrapper");
    if (countSettlements.length) {
        const active = isWorld || isRegion || isArea;
        countSettlements.prop("disabled", !active).css("opacity", active ? "1" : "0.35");
        countSettlementsWrapper.css("opacity", active ? "1" : "0.35");
    }

    const countPlaces = $("#wg-count-places");
    const countPlacesWrapper = $("#wg-count-places-wrapper");
    if (countPlaces.length) {
        const active = isWorld || isRegion || isArea;
        countPlaces.prop("disabled", !active).css("opacity", active ? "1" : "0.35");
        countPlacesWrapper.css("opacity", active ? "1" : "0.35");
    }

    const countRooms = $("#wg-count-rooms");
    const countRoomsWrapper = $("#wg-count-rooms-wrapper");
    if (countRooms.length) {
        const active = true;
        countRooms.prop("disabled", !active).css("opacity", active ? "1" : "0.35");
        countRoomsWrapper.css("opacity", active ? "1" : "0.35");
    }
}
try { window.syncWgScopeHint = syncWgScopeHint; } catch (_) {}

export function initWorld() {
    const s = getSettings();
    $("#uie-world-id").text(s.worldSimId || "WAITING...");
    try {
        ensureReality(s);
        // Enable by default or keep previous state
        if (s.realityEngine.enabled) {
            setStageEnabled(true);
        }
    } catch (_) {}

    if (s.realityEngine.comingSoon === true) s.realityEngine.comingSoon = false;

    $(document).off("click.world");

    // Heavy Reality modules are lazy-initialized when the projector is enabled.

    const render = () => {
        const s2 = getSettings();
        try { ensureReality(s2); } catch (_) {}

        const ws = s2?.worldState || {};
        const container = $("#uie-world-content").empty();
        const content = $(document.getElementById("uie-world-state-view").content.cloneNode(true));

        content.find(".val-loc").text(ws.location || "Unknown");
        content.find(".val-time").text(ws.time || "Day");
        content.find(".val-weather").text(ws.weather || "Clear");
        content.find(".val-threat").text(ws.threat || "None");

        // Simulation Status
        let statusText = ws.status || "Normal";
        if (utilityAI) {
             const best = utilityAI.decide();
             if (best) statusText += ` (Agent wants to: ${best.name})`;
        }
        content.find(".val-status").text(statusText);

        if (ws.mapData && ws.mapData.nodes) {
            content.find(".val-loc").append(` <span style="opacity:0.5; font-size:0.8em;">[${ws.mapData.nodes.length} nodes]</span>`);
        }

        content.find("#uie-world-toggle-re").text(s2.realityEngine.enabled ? "Projector: ON" : "Projector: OFF");

        // Save Mode Toggle
        const saveMode = s2.realityEngine.saveMode || "local"; // Default to local per user request for "option" (usually local is better for immersion)
        // Actually, user said "give people the option".
        content.find("#uie-world-save-mode").prop("checked", saveMode === "local");

        content.find("#uie-world-hide-quick").prop("checked", s2.realityEngine.ui?.showQuickButtons === false);
        content.find("#uie-world-hide-hud").prop("checked", s2.realityEngine.ui?.showHud === false);
        content.find("#uie-world-show-st-ui").prop("checked", s2.realityEngine.ui?.hideStUi === false);

        container.append(content);
    };

    render();
    if (!reEngine) {
        reEngine = new RealityEngine();
        window.reForgeGenerate = (promptText) => {
            const el = document.getElementById("re-forge-prompt");
            if (el && promptText) el.value = promptText;
            reEngine.forgeGenerate();
        };
        // Add Skill to Quick Menu Helper
        window.UIE_addSkillToQuick = (skillName, skillIcon) => {
            const s = getSettings();
            if (!s.realityEngine) s.realityEngine = {};
            if (!s.realityEngine.quickButtons) s.realityEngine.quickButtons = [];

            // Check for duplicate
            if (s.realityEngine.quickButtons.some(b => b.label === skillName)) {
                try { notify("info", "Skill already in Quick Menu", "Skills"); } catch (_) {}
                return;
            }

            s.realityEngine.quickButtons.push({
                label: skillName,
                icon: skillIcon || "fa-bolt",
                text: `[Uses ${skillName}]`,
                desc: `Cast ${skillName}`
            });
            saveSettings();
            try { notify("success", "Added to Quick Menu", "Skills"); } catch (_) {}
            try { reEngine.syncEnabled(); } catch (_) {}
        };
    }
    try { reEngine.syncEnabled(); } catch (_) {}

    // --- UI EVENT BINDING ---
    // Replaced $(document).on with specific container bindings to support the Event Blocker.
    // We bind to #uie-world-window (if present) and #reality-stage (if present) or fall back to body but with selector context.
    // However, since we want to avoid document bubbling, we MUST bind to the container.
    // Since #uie-world-window is persistent in DOM after init, we can bind to it.

    const $worldWin = $("#uie-world-window");
    $worldWin.off(".uieWorld"); // Clear all namespaced events

    $worldWin.on("click.uieWorld", "#uie-world-gen", async (e) => {
        const now = Date.now();
        if (now - worldGenGateAt < 500) return;
        worldGenGateAt = now;
        e.preventDefault();
        e.stopPropagation();
        const input = String($("#uie-world-input").val() || "").trim();
        if(!input) return;

        const s = getSettings();
        s.worldSimId = input.toUpperCase().substring(0, 15);
        $("#uie-world-id").text(s.worldSimId);
        if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
        s.worldState.location = input.slice(0, 80);
        saveSettings();
        render();
        try {
            const eng = await ensureRealityV3();
            if (eng) {
                eng.ensureLocationFromWorldState();
                eng.ensureBackgroundOrRequest();
            }
        } catch (_) {}
        try { reEngine.syncEnabled(); } catch (_) {}
    });

    $worldWin.on("click.uieWorld", "#uie-world-update", async (e) => {
        e.stopPropagation();
        const btn = $("#uie-world-update");
        btn.addClass("fa-spin");
        try {
            const mod = await import("./stateTracker.js");
            await mod.scanEverything?.({ force: true, scope: "world" });
            render();
        } catch(e) {}
        finally { btn.removeClass("fa-spin"); }
    });

    // --- Warning Modal Bindings Removed ---
    /*
    const $warn = $("#re-warning-modal");
    $warn.off("click.uieWorld", "#re-warn-cancel").on("click.uieWorld", "#re-warn-cancel", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $("#re-warning-modal").hide();
    });

    $warn.off("click.uieWorld", "#re-warn-continue").on("click.uieWorld", "#re-warn-continue", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        ensureReality(s);
        s.realityEngine.warningAck = true;
        s.realityEngine.enabled = true;
        saveSettings();
        $("#re-warning-modal").hide();
        render();
        try { reEngine.syncEnabled(); } catch (_) {}
        try { notify("success", "Reality Stage enabled.", "Reality Engine", "api"); } catch (_) {}
    });
    */

    $worldWin.on("click.uieWorld", "#uie-world-projector, #uie-world-toggle-re", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        ensureReality(s2);

        // Force enable if it was false
        if (!s2.realityEngine.enabled) {
             s2.realityEngine.enabled = true;
             // Warning removed per user request
             s2.realityEngine.warningAck = true;
        } else {
             s2.realityEngine.enabled = false;
        }

        saveSettings();
        render();

        // SYNC VISIBILITY IMMEDIATELY
        setStageEnabled(s2.realityEngine.enabled);

        try { reEngine.syncEnabled(); } catch (_) {}

        if (s2.realityEngine.enabled) {
            try { notify("success", "Reality Stage enabled.", "Reality Engine", "api"); } catch (_) {}
        } else {
            try { notify("info", "Reality Stage disabled.", "Reality Engine", "api"); } catch (_) {}
        }
    });

    $worldWin.on("click.uieWorld", "#uie-world-toggle-room", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        ensureReality(s2);
        if (s2.realityEngine.comingSoon === true) return;
        s2.realityEngine.view = "room";
        saveSettings();
        try { reEngine.syncEnabled(); } catch (_) {}
    });

    $worldWin.on("click.uieWorld", "#uie-world-toggle-map", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        ensureReality(s2);
        if (s2.realityEngine.comingSoon === true) return;
        s2.realityEngine.view = "map";
        if (s2.realityEngine.enabled !== true) s2.realityEngine.enabled = true;
        saveSettings();
        render();
        try { reEngine.syncEnabled(); } catch (_) {}
    });

    $worldWin.on("change.uieWorld", "#uie-world-save-mode", (e) => {
        e.stopPropagation();
        const s2 = getSettings();
        ensureReality(s2);
        const isLocal = $("#uie-world-save-mode").prop("checked") === true;
        s2.realityEngine.saveMode = isLocal ? "local" : "global";
        saveSettings();
        // Trigger state reload
        try { (async () => {
            const { ensureChatStateLoaded } = await import("./core.js");
            ensureChatStateLoaded();
            render();
        })(); } catch (_) {}
    });

    $worldWin.on("change.uieWorld", "#uie-world-hide-quick", (e) => {
        e.stopPropagation();
        const s2 = getSettings();
        ensureReality(s2);
        s2.realityEngine.ui.showQuickButtons = !($("#uie-world-hide-quick").prop("checked") === true);
        saveSettings();
        try { reEngine.syncEnabled(); } catch (_) {}
    });

    $worldWin.on("change.uieWorld", "#uie-world-hide-hud", (e) => {
        e.stopPropagation();
        const s2 = getSettings();
        ensureReality(s2);
        s2.realityEngine.ui.showHud = !($("#uie-world-hide-hud").prop("checked") === true);
        saveSettings();
        try { reEngine.syncEnabled(); } catch (_) {}
    });

    $worldWin.on("change.uieWorld", "#uie-world-show-st-ui", (e) => {
        e.stopPropagation();
        const s2 = getSettings();
        ensureReality(s2);
        s2.realityEngine.ui.hideStUi = !($("#uie-world-show-st-ui").prop("checked") === true);
        saveSettings();
        try { reEngine.syncEnabled(); } catch (_) {}
    });

    $worldWin.on("click.uieWorld", "#uie-world-open-sprites", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            if (!document.getElementById("uie-sprites-window")) {
                const baseUrl = String(window.UIE_BASEURL || "/").trim();
                const mod = await import("./templateFetch.js");
                const fetchTemplateHtml = mod?.fetchTemplateHtml;
                if (typeof fetchTemplateHtml === "function") {
                    let html = "";
                    for (const u of [`${baseUrl}src/templates/sprites.html`]) {
                        try { html = await fetchTemplateHtml(u); if (html) break; } catch (_) {}
                    }
                    if (html) $("body").append(html);
                }
            }
            if (window.UIE_forceOpenWindow) window.UIE_forceOpenWindow("#uie-sprites-window", "./sprites.js", "openSprites");
            else {
                const mod = await import("./sprites.js");
                if (mod.openSprites) mod.openSprites();
            }
        } catch (_) {}
    });

    $worldWin.on("pointerup click", "#uie-world-open-mods", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModsWindow();
    });

    $worldWin.on("click.uieWorld", "#uie-world-open-calendar", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openCalendar();
    });

    // Custom Button Handlers - Bound to document because the modal might be outside the window?
    // #re-quick-modal is appended to body in world.html.
    // So we bind to #re-quick-modal or document.
    // But #re-quick-modal is likely blocked by .uie-window blocker if it has class uie-window?
    // In world.html, it is: <div id="re-quick-modal" ...> (No class uie-window).
    // So document binding is safe for it.
    $(document).off("click.world"); // Clear old

    const $quickModal = $("#re-quick-modal");
    $quickModal.off("click.world").on("click.world", "#re-quick-save", (e) => {
        e.preventDefault(); e.stopPropagation();
        const label = $("#re-quick-label").val().trim();
        const icon = $("#re-quick-icon").val().trim();
        const text = $("#re-quick-prompt").val().trim();
        if (!label || !text) return;

        const s = getSettings();
        if (!s.realityEngine.quickButtons) s.realityEngine.quickButtons = [];
        s.realityEngine.quickButtons.push({ label, icon, text, desc: text.slice(0, 50) });
        saveSettings();
        $("#re-quick-modal").hide();
        if (reEngine) reEngine.syncEnabled();
    });

    $quickModal.on("click.world", "#re-quick-cancel", (e) => {
        e.preventDefault(); e.stopPropagation();
        $("#re-quick-modal").hide();
    });

    $(document)
        .off(".wgScope")
        .on("change.wgScope", "#wg-scope", () => {
            syncWgScopeHint();
        })
        .off(".wgCancel")
        .on("click.wgCancel", "#wg-cancel", (e) => {
            e.preventDefault();
            e.stopPropagation();
            $("#worldgen-modal").hide();
        })
        .off(".wgGenerate")
        .on("click.wgGenerate", "#wg-generate", async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const scope = $("#wg-scope").val();
            const mode = $("#wg-mode").val();
            const label = $("#wg-location").val().trim() || "Generated Location";
            const prompt = $("#wg-prompt").val().trim();

            const counts = {
                worlds: parseInt($("#wg-count-worlds").val()) || 1,
                regions: parseInt($("#wg-count-regions").val()) || 4,
                settlements: parseInt($("#wg-count-settlements").val()) || 4,
                places: parseInt($("#wg-count-places").val()) || 10,
                roomsPerInterior: parseInt($("#wg-count-rooms").val()) || 8,
                blueprintMode: String($("#wg-blueprint-mode").val() || "sites")
            };

            try {
                $("#wg-generate").text("Generating...").prop("disabled", true);
                const mapMod = await import("./map.js");

                mapMod.openMap();

                let targetTier = scope;
                if (scope === "area") targetTier = "local";

                let targetState;
                if (scope === "blueprint") {
                    targetState = await mapMod.generateForTier("blueprint", {
                        mode,
                        label: mapMod.currentLocationName(),
                        prompt,
                        counts
                    });
                } else {
                    targetState = await mapMod.generateForTier(targetTier, {
                        mode,
                        label,
                        prompt,
                        counts
                    });
                }

                $("#worldgen-modal").hide();

                if (targetState) {
                    let startNode = null;
                    if (scope === "blueprint") {
                        startNode = targetState.blueprint?.rooms?.[0];
                    } else {
                        startNode = targetState.area?.[0];
                    }

                    if (startNode && startNode.name) {
                        await mapMod.travelToLocationName(startNode.name);
                        notify("success", `Map generated! Traveled to: ${startNode.name}`, "Map Gen");
                    }
                }
            } catch (err) {
                console.error(err);
                notify("error", `Generation failed: ${err.message || err}`, "Map Gen");
            } finally {
                $("#wg-generate").text("Generate Map").prop("disabled", false);
            }
        });

    $(document)
        .off("click.btnWorldGen", "#uie-btn-worldgen, #btn-worldgen")
        .on("click.btnWorldGen", "#uie-btn-worldgen, #btn-worldgen", (e) => {
            e.preventDefault();
            e.stopPropagation();

            $("#uie-main-menu").hide();
            $("#reply-menu-panel").hide();
            $("#uie-world-window").show().css("display", "flex");
            $("#worldgen-modal").css("display", "flex");

            syncWgScopeHint();
        });
}

// User Prompt Modal System
function showUserPromptModal(anchorEl) {
    const focusTypingBox = () => {
        try {
            const $ui = $("#user-input");
            if ($ui.length) $ui.trigger("focus");
        } catch (_) {}
        try {
            const ta = document.getElementById("send_textarea");
            if (ta) ta.focus();
        } catch (_) {}
    };

    // Create popover if it doesn't exist
    if (!$("#uie-user-prompt-popover").length) {
        $("body").append(`
            <div id="uie-user-prompt-popover" style="display:none; position:fixed; z-index:2147483641; width:min(360px, 92vw);">
                <div style="background:#1a1a1a; border:1px solid #444; border-radius:12px; padding:12px; width:100%; color:#fff; box-shadow:0 20px 50px rgba(0,0,0,0.5);">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin:0 0 8px 0;">
                        <div style="font-weight:bold; color:#cba35c;">User Prompt</div>
                        <button id="uie-prompt-close" style="border:none; background:transparent; color:#fff; opacity:0.8; cursor:pointer; font-size:16px; line-height:16px; padding:4px;">×</button>
                    </div>
                    <textarea id="uie-user-prompt-input" placeholder="Describe what you want to do..." style="width:100%; height:70px; border:1px solid #444; border-radius:8px; background:#2a2a2a; color:#fff; padding:10px; resize:none; outline:none; font-size:14px;"></textarea>
                    <div id="uie-prompt-options" style="margin:10px 0 0 0; display:none;">
                        <div style="font-size:12px; opacity:0.8; margin-bottom:8px;">Choose:</div>
                        <div id="uie-prompt-choices" style="display:flex; flex-direction:column; gap:8px;"></div>
                    </div>
                    <div style="display:flex; gap:8px; margin-top:10px;">
                        <button id="uie-prompt-generate" style="flex:1; padding:9px; border:none; border-radius:8px; background:#cba35c; color:#000; font-weight:bold; cursor:pointer;">Generate</button>
                        <button id="uie-prompt-reroll" style="flex:1; padding:9px; border:none; border-radius:8px; background:#3498db; color:#fff; font-weight:bold; cursor:pointer; display:none;">Reroll</button>
                        <button id="uie-prompt-cancel" style="flex:1; padding:9px; border:none; border-radius:8px; background:#e74c3c; color:#fff; font-weight:bold; cursor:pointer;">Cancel</button>
                    </div>
                </div>
            </div>
        `);

        // Add event handlers
        $(document).on("click.uiePrompt", "#uie-prompt-generate", async () => {
            const prompt = $("#uie-user-prompt-input").val().trim();
            if (!prompt) return;

            const s = getSettings();
            const turboEnabled = !!(s.turbo && s.turbo.enabled);

            try {
                $("#uie-prompt-generate").text("Generating...").prop("disabled", true);
                const options = await generatePromptOptions(prompt, turboEnabled);
                displayPromptOptions(options);
                $("#uie-prompt-reroll").show();
                $("#uie-prompt-generate").text("Regenerate").prop("disabled", false);
            } catch (error) {
                console.error("Failed to generate prompt options:", error);
                $("#uie-prompt-generate").text("Generate").prop("disabled", false);
            }
        });

        $(document).on("click.uiePrompt", "#uie-prompt-reroll", async () => {
            $("#uie-prompt-reroll").text("Rerolling...").prop("disabled", true);
            const prompt = $("#uie-user-prompt-input").val().trim();
            if (prompt) {
                const s = getSettings();
                const turboEnabled = !!(s.turbo && s.turbo.enabled);
                const options = await generatePromptOptions(prompt, turboEnabled);
                displayPromptOptions(options);
            }
            $("#uie-prompt-reroll").text("Reroll").prop("disabled", false);
        });

        const closePopover = () => {
            $("#uie-user-prompt-popover").hide();
            resetPromptModal();
            focusTypingBox();
        };

        $(document).on("click.uiePrompt", "#uie-prompt-cancel", closePopover);
        $(document).on("click.uiePrompt", "#uie-prompt-close", closePopover);

        // Click-outside to close
        $(document).on("pointerdown.uiePrompt", (e) => {
            const pop = document.getElementById("uie-user-prompt-popover");
            if (!pop) return;
            if (String(getComputedStyle(pop).display || "") === "none") return;
            if (e.target && pop.contains(e.target)) return;
            closePopover();
        });
    }

    // Show popover near anchor (lightbulb menu item), fallback to launcher
    const pop = document.getElementById("uie-user-prompt-popover");
    if (!pop) return;
    pop.style.display = "block";
    pop.style.visibility = "hidden";

    try {
        const anchor = anchorEl || document.getElementById("re-act-user-prompt") || document.getElementById("uie-launcher") || document.getElementById("re-q-menu");
        if (typeof rePlaceNearAnchor === "function") {
            rePlaceNearAnchor(pop, anchor, 10);
        } else if (anchor && anchor.getBoundingClientRect) {
            const r = anchor.getBoundingClientRect();
            pop.style.left = `${Math.max(10, Math.min(window.innerWidth - pop.getBoundingClientRect().width - 10, r.left))}px`;
            pop.style.top = `${Math.max(10, Math.min(window.innerHeight - pop.getBoundingClientRect().height - 10, r.bottom + 8))}px`;
        }
    } catch (_) {}

    pop.style.visibility = "visible";
    resetPromptModal();
    try { $("#uie-user-prompt-input").trigger("focus"); } catch (_) {}
}

function resetPromptModal() {
    $("#uie-user-prompt-input").val("");
    $("#uie-prompt-options").hide();
    $("#uie-prompt-choices").empty();
    $("#uie-prompt-generate").text("Generate").prop("disabled", false);
    $("#uie-prompt-reroll").hide();
}

async function generatePromptOptions(userPrompt, useTurbo = true) {
    const s = getSettings();
    const turboEnabled = useTurbo && !!(s.turbo && s.turbo.enabled);
    
    const prompt = `Generate 3 different roleplaying responses for this user action: "${userPrompt}"
    
    Requirements:
    - Each response should be 1-2 sentences long
    - Each response should be written in first person ("I...")
    - Each response should be distinct in tone or approach
    - Format as a numbered list (1., 2., 3.)
    - Do not include any other text or explanations`;
    
    if (turboEnabled) {
        try {
            const { generateContent } = await import("./apiClient.js");
            const response = await generateContent(prompt, "user_prompt");
            const text = response?.choices?.[0]?.message?.content || response?.content || "";
            return parsePromptOptions(text);
        } catch (error) {
            console.error("Turbo API failed, falling back to local generation:", error);
        }
    }
    
    // Fallback to local generation
    return generateFallbackOptions(userPrompt);
}

function parsePromptOptions(text) {
    const options = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
        const match = line.match(/^\d+\.\s*(.+)$/);
        if (match) {
            options.push(match[1].trim());
        }
    }
    
    // If we didn't get exactly 3 options, generate fallback
    if (options.length !== 3) {
        return generateFallbackOptions(lines[0] || "I want to act");
    }
    
    return options;
}

function generateFallbackOptions(userPrompt) {
    return [
        `I ${userPrompt.toLowerCase().replace(/^i want to /, '')} with determination.`,
        `I decide to ${userPrompt.toLowerCase().replace(/^i want to /, '')} in a clever way.`,
        `I approach the situation by ${userPrompt.toLowerCase().replace(/^i want to /, '')}.`
    ];
}

function displayPromptOptions(options) {
    const $choices = $("#uie-prompt-choices");
    $choices.empty();
    
    options.forEach((option, index) => {
        const $option = $(`
            <div class="prompt-option" data-option="${option}" style="padding:12px; border:1px solid #444; border-radius:8px; background:#2a2a2a; cursor:pointer; transition:all 0.2s;">
                <div style="font-weight:bold; color:#cba35c; margin-bottom:4px;">Option ${index + 1}</div>
                <div style="font-size:14px;">${option}</div>
            </div>
        `);
        
        $option.on("click", function() {
            const selectedOption = $(this).data("option");
            sendUserPromptChoice(selectedOption);
        });
        
        $option.on("mouseenter", function() {
            $(this).css({ background: "#3a3a3a", borderColor: "#cba35c" });
        });
        
        $option.on("mouseleave", function() {
            $(this).css({ background: "#2a2a2a", borderColor: "#444" });
        });
        
        $choices.append($option);
    });
    
    $("#uie-prompt-options").show();
}

function sendUserPromptChoice(choice) {
    // Send the chosen option to the chat
    const $userInput = $("#user-input");
    const $sendBtn = $("#send-btn");
    
    if ($userInput.length && $sendBtn.length) {
        $userInput.val(choice);
        $sendBtn.trigger("click");
    }
    
    // Close popover
    $("#uie-user-prompt-popover").hide();
    resetPromptModal();

    try { $("#user-input").trigger("focus"); } catch (_) {}
    try {
        const ta = document.getElementById("send_textarea");
        if (ta) ta.focus();
    } catch (_) {}
}

// Impersonation Popover System (Drop-up/Pop-up Layout)
function showImpersonationPopup(anchorEl) {
    const focusTypingBox = () => {
        try {
            const $ui = $("#user-input");
            if ($ui.length) $ui.trigger("focus");
        } catch (_) {}
    };

    // Create popover if it doesn't exist
    if (!$("#uie-impersonation-popover").length) {
        $("body").append(`
            <div id="uie-impersonation-popover" style="display:none; position:fixed; z-index:2147483641; width:min(360px, 92vw);">
                <div style="background:#1a1a1a; border:1px solid #444; border-radius:12px; padding:12px; width:100%; color:#fff; box-shadow:0 20px 50px rgba(0,0,0,0.5);">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin:0 0 8px 0;">
                        <div style="font-weight:bold; color:#cba35c;"><i class="fas fa-lightbulb"></i> Line Suggestions</div>
                        <button id="uie-impersonation-close" style="border:none; background:transparent; color:#fff; opacity:0.8; cursor:pointer; font-size:16px; line-height:16px; padding:4px;">×</button>
                    </div>
                    <textarea id="uie-impersonation-input" placeholder="Type your response intent (e.g. say yes, react with anger)..." style="width:100%; height:70px; border:1px solid #444; border-radius:8px; background:#2a2a2a; color:#fff; padding:10px; resize:none; outline:none; font-size:14px;"></textarea>
                    
                    <div id="uie-impersonation-options" style="margin:10px 0 0 0; display:none;">
                        <div style="font-size:12px; opacity:0.8; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
                            <span>Choose a reply:</span>
                            <button id="uie-impersonation-refresh" style="border:none; background:transparent; color:#cba35c; cursor:pointer; font-size:14px; padding:2px;" title="Reroll replies"><i class="fas fa-rotate-right"></i></button>
                        </div>
                        <div id="uie-impersonation-choices" style="display:flex; flex-direction:column; gap:8px;"></div>
                    </div>
                    
                    <div style="display:flex; gap:8px; margin-top:10px;">
                        <button id="uie-impersonation-generate" style="flex:1; padding:9px; border:none; border-radius:8px; background:#cba35c; color:#000; font-weight:bold; cursor:pointer;">Generate</button>
                        <button id="uie-impersonation-cancel" style="flex:1; padding:9px; border:none; border-radius:8px; background:#e74c3c; color:#fff; font-weight:bold; cursor:pointer;">Cancel</button>
                    </div>
                </div>
            </div>
        `);

        // Add event handlers
        $(document).on("click.uieImpersonation", "#uie-impersonation-generate", async () => {
            const prompt = $("#uie-impersonation-input").val().trim();
            if (!prompt) return;

            const s = getSettings();
            const turboEnabled = !!(s.turbo && s.turbo.enabled);

            try {
                $("#uie-impersonation-generate").text("Generating...").prop("disabled", true);
                const options = await generateImpersonationOptions(prompt, turboEnabled);
                displayImpersonationOptions(options);
                $("#uie-impersonation-generate").text("Regenerate").prop("disabled", false);
            } catch (error) {
                console.error("Failed to generate impersonation options:", error);
                $("#uie-impersonation-generate").text("Generate").prop("disabled", false);
            }
        });

        $(document).on("click.uieImpersonation", "#uie-impersonation-refresh", async () => {
            const $refresh = $("#uie-impersonation-refresh i");
            $refresh.addClass("fa-spin");
            const prompt = $("#uie-impersonation-input").val().trim();
            if (prompt) {
                const s = getSettings();
                const turboEnabled = !!(s.turbo && s.turbo.enabled);
                const options = await generateImpersonationOptions(prompt, turboEnabled);
                displayImpersonationOptions(options);
            }
            $refresh.removeClass("fa-spin");
        });

        const closePopover = () => {
            $("#uie-impersonation-popover").hide();
            resetImpersonationModal();
            focusTypingBox();
        };

        $(document).on("click.uieImpersonation", "#uie-impersonation-cancel", closePopover);
        $(document).on("click.uieImpersonation", "#uie-impersonation-close", closePopover);

        // Click-outside to close
        $(document).on("pointerdown.uieImpersonation", (e) => {
            const pop = document.getElementById("uie-impersonation-popover");
            if (!pop) return;
            if (String(getComputedStyle(pop).display || "") === "none") return;
            if (e.target && pop.contains(e.target)) return;
            closePopover();
        });
    }

    // Show popover near anchor (#q-impersonation lightbulb button)
    const pop = document.getElementById("uie-impersonation-popover");
    if (!pop) return;
    pop.style.display = "block";
    pop.style.visibility = "hidden";

    // Force layout calculation / get actual dimensions
    let popW = pop.offsetWidth;
    let popH = pop.offsetHeight;
    if (!popW) popW = 360;
    if (!popH) popH = 220;

    try {
        const anchor = anchorEl || document.getElementById("q-impersonation") || document.getElementById("user-input") || document.getElementById("send-btn");
        if (anchor && anchor.getBoundingClientRect) {
            const r = anchor.getBoundingClientRect();
            // Align center above anchor
            const targetLeft = r.left - popW / 2 + r.width / 2;
            const targetTop = r.top - popH - 10;
            pop.style.left = `${Math.max(10, Math.min(window.innerWidth - popW - 10, targetLeft))}px`;
            pop.style.top = `${Math.max(10, Math.min(window.innerHeight - popH - 10, targetTop))}px`;
        }
    } catch (_) {}

    pop.style.visibility = "visible";
    resetImpersonationModal();
    try { $("#uie-impersonation-input").trigger("focus"); } catch (_) {}
}

function resetImpersonationModal() {
    $("#uie-impersonation-input").val("");
    $("#uie-impersonation-options").hide();
    $("#uie-impersonation-choices").empty();
    $("#uie-impersonation-generate").text("Generate").prop("disabled", false);
}

async function generateImpersonationOptions(userPrompt, useTurbo = true) {
    const s = getSettings();
    const turboEnabled = useTurbo && !!(s.turbo && s.turbo.enabled);
    
    const prompt = `Generate 3 different character responses for this action: "${userPrompt}"
    
    Requirements:
    - Each response should be 1-2 sentences long  
    - Each response should be written in first person ("I...")
    - Each response should reflect character personality and voice
    - Each response should be distinct in tone or approach
    - Format as a numbered list (1., 2., 3.)
    - Do not include any other text or explanations`;
    
    if (turboEnabled) {
        try {
            const { generateContent } = await import("./apiClient.js");
            const response = await generateContent(prompt, "User Line Drafts");
            const text = typeof response === "string" ? response : (response?.choices?.[0]?.message?.content || response?.content || "");
            return parseImpersonationOptions(text);
        } catch (error) {
            console.error("Turbo API failed, falling back to local generation:", error);
        }
    }
    
    // Fallback to local generation
    return generateImpersonationFallback(userPrompt);
}

function parseImpersonationOptions(text) {
    const options = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
        const match = line.match(/^\d+\.\s*(.+)$/);
        if (match) {
            options.push(match[1].trim());
        }
    }
    
    // If we didn't get exactly 3 options, generate fallback
    if (options.length !== 3) {
        return generateImpersonationFallback(lines[0] || "I want to act");
    }
    
    return options;
}

function generateImpersonationFallback(userPrompt) {
    return [
        `I ${userPrompt.toLowerCase().replace(/^i want to /, '')} with determination and conviction.`,
        `I decide to ${userPrompt.toLowerCase().replace(/^i want to /, '')} in a thoughtful way.`,
        `I approach this by ${userPrompt.toLowerCase().replace(/^i want to /, '')}.`
    ];
}

function displayImpersonationOptions(options) {
    const $choices = $("#uie-impersonation-choices");
    $choices.empty();
    
    options.forEach((option, index) => {
        const $option = $(`
            <div class="impersonation-option" data-option="${option}" style="padding:10px; border:1px solid #444; border-radius:8px; background:#2a2a2a; cursor:pointer; transition:all 0.2s;">
                <div style="font-weight:bold; color:#cba35c; margin-bottom:4px; font-size:11px;">Choice ${index + 1}</div>
                <div style="font-size:13px; line-height:1.45;">${option}</div>
            </div>
        `);
        
        $option.on("click", function() {
            const selectedOption = $(this).data("option");
            sendImpersonationChoice(selectedOption);
        });
        
        $option.on("mouseenter", function() {
            $(this).css({ background: "#3a3a3a", borderColor: "#cba35c" });
        });
        
        $option.on("mouseleave", function() {
            $(this).css({ background: "#2a2a2a", borderColor: "#444" });
        });
        
        $choices.append($option);
    });
    
    $("#uie-impersonation-options").show();
}

function sendImpersonationChoice(choice) {
    const $userInput = $("#user-input");
    const $sendBtn = $("#send-btn");
    
    if ($userInput.length) {
        $userInput.val(choice);
        try {
            const el = $userInput.get(0);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.focus();
        } catch (_) {}
    }
    
    $("#uie-impersonation-popover").hide();
    resetImpersonationModal();
}
