import { getSettings, saveSettings, isMobileUI, updateLayout } from "./core.js";
import { initDragging } from "./dragging.js";
import { init as initInventory } from "./features/items.js";
import { notify } from "./notifications.js";
import { applyCurrencySettings, getCurrencyPreset } from "./economy.js";
import { openHelpManualWindow, installHelpManualGlobals } from "./helpManual.js";
import { initVoiceLibraryPanel } from "./voiceLibraryPanel.js";

let uieMenuTabSwitchedAt = 0;
try { installHelpManualGlobals(); } catch (_) {}

const STANDALONE_TEMPLATE_BY_WINDOW = {
    "#uie-phone-window": "phone",
    "#uie-social-window": "social",
    "#uie-you-window": "you",
    "#uie-party-window": "party",
    "#uie-map-window": "map",
    "#uie-stats-window": "stats",
    "#uie-activities-window": "activities",
    "#uie-journal-window": "journal",
    "#uie-diary-window": "diary",
    "#uie-databank-window": "databank",
    "#uie-inventory-window": "inventory",
    "#uie-atmosphere-window": "atmosphere",
    "#uie-battle-window": "battle",
    "#battle-screen": "battle",
};

const POPUP_CATEGORY_BY_ID = {
    "uie-pop-quests-accepted": "questsAccepted",
    "uie-pop-quests-abandoned": "questsAbandoned",
    "uie-pop-quests-failed": "questsFailed",
    "uie-pop-quests-completed": "questsCompleted",
    "uie-pop-phone-calls": "phoneCalls",
    "uie-pop-phone-messages": "phoneMessages",
    "uie-pop-loot": "loot",
    "uie-pop-currency": "currency",
    "uie-pop-xp": "xp",
    "uie-pop-levelup": "levelUp",
    "uie-pop-api": "api",
    "uie-pop-social": "social",
    "uie-pop-lowhp-enabled": "lowHp",
};

async function ensureSettingsWindowLoaded() {
    try {
        if (document.getElementById("uie-settings-window")) return true;
        const baseUrl = String(window.UIE_BASEURL || "/").trim();
        const mod = await import("./templateFetch.js");
        const fetchTemplateHtml = mod?.fetchTemplateHtml;
        if (typeof fetchTemplateHtml !== "function") return false;

        const ts = (() => {
            try {
                const v = Number(window.UIE_BUILD);
                if (Number.isFinite(v) && v > 0) return v;
            } catch (_) {}
            return Date.now();
        })();

        const urls = [
            `${baseUrl}src/templates/settings_window.html?v=${ts}`,
            `${baseUrl}templates/settings_window.html?v=${ts}`,
        ];
        let html = "";
        for (const u of urls) {
            try { html = await fetchTemplateHtml(u); } catch (_) { html = ""; }
            if (html) break;
        }
        if (!html) return false;
        $("body").append(html);
        try { (await import("./i18n.js")).applyI18n?.(document); } catch (_) {}
        return !!document.getElementById("uie-settings-window");
    } catch (_) {
        return false;
    }
}

async function ensureStandaloneWindowLoaded(selector) {
    try {
        let win = $(selector);
        if (win.length) return win;
        if (selector === "#uie-settings-window") {
            await ensureSettingsWindowLoaded();
            return $(selector);
        }
        const templateName = STANDALONE_TEMPLATE_BY_WINDOW[String(selector || "")];
        if (!templateName) return win;
        const baseUrl = String(window.UIE_BASEURL || "/").trim();
        const mod = await import("./templateFetch.js");
        const fetchTemplateHtml = mod?.fetchTemplateHtml;
        if (typeof fetchTemplateHtml !== "function") return $(selector);
        const ts = (() => {
            try {
                const v = Number(window.UIE_BUILD);
                if (Number.isFinite(v) && v > 0) return v;
            } catch (_) {}
            return Date.now();
        })();
        const urls = [
            `${baseUrl}src/templates/${templateName}.html?v=${ts}`,
            `${baseUrl}templates/${templateName}.html?v=${ts}`,
        ];
        let html = "";
        for (const u of urls) {
            try { html = await fetchTemplateHtml(u); } catch (_) { html = ""; }
            if (html) break;
        }
        if (!html) return $(selector);
        $("body").append(html);
    } catch (_) {}
    return $(selector);
}

function resolveWindowDisplayMode(selector, win) {
    const explicit = String(win?.attr?.("data-open-display") || "").trim();
    if (explicit) return explicit;
    const key = String(selector || "").trim();
    if (/^#uie-[\w-]+-window$/.test(key)) return "flex";
    return "block";
}

function blurFocusInside(container) {
    try {
        const el = container && container.jquery ? container[0] : container;
        const active = document.activeElement;
        if (el && active && el.contains(active) && typeof active.blur === "function") active.blur();
    } catch (_) {}
}

function initStWandUieControls() {
    try {
        if (window.UIE_wandControlsInited) return;
        window.UIE_wandControlsInited = true;
    } catch (_) {}

    const needsInject = () => {
        try {
            const menu = document.getElementById("extensionsMenu");
            if (!menu) return false;
            const container = document.getElementById("uie_wand_container");
            const btn = document.getElementById("uie_wand_button");
            if (!container || container.parentElement !== menu) return true;
            if (!btn || !container.contains(btn)) return true;
            return false;
        } catch (_) {
            return true;
        }
    };

    const inject = () => {
        const menu = document.getElementById("extensionsMenu");
        if (!menu) return;

        // Create our container if it doesn't exist
        let container = document.getElementById("uie_wand_container");
        if (!container) {
            container = document.createElement("div");
            container.id = "uie_wand_container";
            container.className = "extension_container";
            // Prepend to ensure visibility at the top
            menu.prepend(container);
        } else if (container.parentElement !== menu) {
             // Ensure it's in the menu if it moved
             menu.prepend(container);
        }

        // Create/update button and ALWAYS (re)bind handler in case a stale node already exists.
        let btn = document.getElementById("uie_wand_button");
        if (!btn) {
            btn = document.createElement("div");
            btn.id = "uie_wand_button";
            btn.className = "list-group-item flex-container flexGap5";
            btn.style.cursor = "pointer";
            btn.style.fontWeight = "bold";
            btn.style.display = "flex";
            btn.style.alignItems = "center";
            container.appendChild(btn);
        }
        btn.title = "Run Full UIE Scan";
        btn.innerHTML = `
            <div class="fa-fw fa-solid fa-radar extensionsMenuExtensionButton" style="color:#cba35c;"></div>
            <span>UIE Scan All</span>
        `;
        btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();

            try { $(menu).hide(); } catch (_) {}
            try { $("#extensionsMenuButton").removeClass("active"); } catch (_) {}

            try {
                const { scanAll } = await import("./orchestration.js");
                await scanAll?.({ force: true, source: "wand_button" });
            } catch (err) {
                console.error("Scan failed", err);
                try { window.toastr?.error?.("UIE scan failed. Check console."); } catch (_) {}
            }
        };
    };

    // Try immediately
    inject();

    // And watch for changes (in case the menu is re-rendered)
    let bodyObsT = 0;
    const obs = new MutationObserver(() => {
        if (bodyObsT) return;
        bodyObsT = setTimeout(() => {
            bodyObsT = 0;
            if (needsInject()) inject();
        }, 120);
    });
    // Keep this shallow to avoid reacting to every chat token/DOM mutation.
    obs.observe(document.body, { childList: true, subtree: false });
    
    // Also specifically watch the menu if possible
    const menu = document.getElementById("extensionsMenu");
    if (menu) {
        let menuObsT = 0;
        const menuObs = new MutationObserver(() => {
            if (menuObsT) return;
            menuObsT = setTimeout(() => {
                menuObsT = 0;
                if (needsInject()) inject();
            }, 80);
        });
        menuObs.observe(menu, { childList: true, subtree: true });
    }

    // Low-overhead fallback: only attempt when missing.
    setInterval(() => {
        try {
            if (needsInject()) inject();
        } catch (_) {}
    }, 15000);
}

// --- SCAVENGE & INTERACTION MODULE ---

export function initInteractions() {
    window.UIE_openWindow = openWindow;
    initMobileFullscreenMode();
    initScavenge();
    initSpriteInteraction();
    initLauncher();
    initMobileBackNav();
    initReplyKeyboard();

    // Settings drawer (and other delegated UI handlers) must work even if the launcher
    // is missing/hidden or the user never opens the main menu.
    try { initMenuTabs(); } catch (_) {}
    try { initMenuButtons(); } catch (_) {}
    try { initGenericHandlers(); } catch (_) {}
    try { initStWandUieControls(); } catch (_) {}
    try { initVoiceLibraryPanel(); } catch (_) {}
}

function initMobileFullscreenMode() {
    if (window.__uieMobileFullscreenInstalled) return;
    window.__uieMobileFullscreenInstalled = true;
    try {
        const meta = document.querySelector("meta[name='viewport']");
        if (meta && !/viewport-fit=cover/i.test(meta.content || "")) {
            meta.content = `${meta.content || "width=device-width, initial-scale=1"}${meta.content ? ", " : ""}viewport-fit=cover`;
        }
    } catch (_) {}
}

let uieReplyKeyboardInited = false;

function initReplyKeyboard() {
    if (uieReplyKeyboardInited) return;
    uieReplyKeyboardInited = true;

    const insertText = (text) => {
        const input = document.getElementById("user-input");
        if (!input) return;
        const start = Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length;
        const end = Number.isFinite(input.selectionEnd) ? input.selectionEnd : input.value.length;
        input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
        const next = start + text.length;
        input.focus();
        try { input.setSelectionRange(next, next); } catch (_) {}
        input.dispatchEvent(new Event("input", { bubbles: true }));
        updatePredictions();
    };

    const backspace = () => {
        const input = document.getElementById("user-input");
        if (!input) return;
        const start = Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length;
        const end = Number.isFinite(input.selectionEnd) ? input.selectionEnd : input.value.length;
        if (start !== end) {
            input.value = `${input.value.slice(0, start)}${input.value.slice(end)}`;
            try { input.setSelectionRange(start, start); } catch (_) {}
        } else if (start > 0) {
            input.value = `${input.value.slice(0, start - 1)}${input.value.slice(start)}`;
            try { input.setSelectionRange(start - 1, start - 1); } catch (_) {}
        }
        input.focus();
        input.dispatchEvent(new Event("input", { bubbles: true }));
        updatePredictions();
    };

    const predictionBank = ["I understand", "Tell me more", "What happened next?", "Let us take a moment", "I need some space", "Can we try again?", "Thank you", "I am listening"];
    const updatePredictions = () => {
        const input = document.getElementById("user-input");
        const host = document.getElementById("reply-keyboard-predictions");
        if (!input || !host) return;
        const word = String(input.value || "").split(/\s+/).pop().toLowerCase();
        const choices = predictionBank.filter((item) => !word || item.toLowerCase().startsWith(word)).slice(0, 3);
        host.innerHTML = choices.map((item) => `<button type="button" class="reply-prediction" data-prediction="${item.replace(/&/g, "&amp;").replace(/\"/g, "&quot;")}" role="option">${item}</button>`).join("");
    };

    $(document)
        .off("click.uieReplyKeyboardToggle")
        .on("click.uieReplyKeyboardToggle", "#reply-keyboard-toggle", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const panel = document.getElementById("reply-keyboard-panel");
            if (!panel) return;
            const willOpen = !panel.classList.contains("active");
            // A fixed, body-level panel cannot be clipped by the compact reply bar.
            if (willOpen && panel.parentElement !== document.body) document.body.appendChild(panel);
            if (willOpen) {
                panel.style.position = "fixed";
                panel.style.right = "12px";
                panel.style.bottom = "96px";
                panel.style.left = "auto";
                panel.style.top = "auto";
            }
            panel.classList.toggle("active", willOpen);
            $(this).toggleClass("active", willOpen).attr("aria-expanded", String(willOpen));
        })
        .off("click.uieReplyKeyboardKey")
        .on("click.uieReplyKeyboardKey", ".reply-keyboard-key, .reply-keyboard-mini", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const action = String($(this).data("action") || "");
            const key = String($(this).data("key") || $(this).text() || "");
            if (action === "backspace") backspace();
            else if (action === "space") insertText(" ");
            else if (action === "enter") insertText("\n");
            else insertText(key);
        })
        .off("click.uieReplyPrediction")
        .on("click.uieReplyPrediction", ".reply-prediction", function (e) {
            e.preventDefault(); e.stopPropagation();
            const input = document.getElementById("user-input");
            const phrase = String($(this).data("prediction") || "");
            if (!input || !phrase) return;
            const start = Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length;
            const before = input.value.slice(0, start).replace(/[^\s]*$/, "");
            input.value = `${before}${phrase} ${input.value.slice(Number.isFinite(input.selectionEnd) ? input.selectionEnd : start)}`;
            input.focus(); input.setSelectionRange((`${before}${phrase} `).length, (`${before}${phrase} `).length);
            input.dispatchEvent(new Event("input", { bubbles: true })); updatePredictions();
        })
        .off("click.uieReplyKeyboardOutside")
        .on("click.uieReplyKeyboardOutside", function (e) {
            if ($(e.target).closest("#reply-keyboard-panel, #reply-keyboard-toggle").length) return;
            $("#reply-keyboard-panel").removeClass("active");
            $("#reply-keyboard-toggle").removeClass("active");
        });

    $(document).off("input.uieReplyPredictions", "#user-input").on("input.uieReplyPredictions", "#user-input", updatePredictions);
    updatePredictions();

    const panel = document.getElementById("reply-keyboard-panel");
    const grip = panel?.querySelector(".reply-keyboard-grip");
    if (panel && grip) {
        let dragging = false;
        let startX = 0, startY = 0, origLeft = 0, origTop = 0;
        const onPointerDown = (e) => {
            if (e.target.closest(".reply-keyboard-resize")) return;
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            origLeft = rect.left;
            origTop = rect.top;
            panel.style.position = "fixed";
            panel.style.left = origLeft + "px";
            panel.style.top = origTop + "px";
            panel.style.right = "auto";
            panel.style.bottom = "auto";
            panel.style.margin = "0";
            grip.style.cursor = "grabbing";
            e.preventDefault();
        };
        const onPointerMove = (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            panel.style.left = (origLeft + dx) + "px";
            panel.style.top = (origTop + dy) + "px";
        };
        const onPointerUp = () => {
            dragging = false;
            grip.style.cursor = "grab";
        };
        grip.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
    }
}

let uieNavInited = false;
let uieNavLock = false;
let uieNavStack = [];

function initMobileBackNav() {
    if (uieNavInited) return;
    uieNavInited = true;

    const isMobileNow = () => {
        try { return isMobileUI(); } catch (_) {}
        try { return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches; } catch (_) {}
        return false;
    };

    const navPush = (tag = "uie") => {
        if (!isMobileNow()) return;
        if (uieNavLock) return;
        try {
            uieNavStack.push(String(tag || "uie"));
            history.pushState({ uie: true, tag: String(tag || "uie"), t: Date.now() }, "");
        } catch (_) {}
    };

    const navPop = () => {
        if (!isMobileNow()) return;
        if (uieNavLock) return;
        if (!uieNavStack.length) return;
        uieNavLock = true;
        try { uieNavStack.pop(); } catch (_) {}
        try { history.back(); } catch (_) {}
        setTimeout(() => { uieNavLock = false; }, 120);
    };

    const closePhoneBack = () => {
        try {
            const phone = document.getElementById("uie-phone-window");
            if (!phone) return false;
            const disp = String(getComputedStyle(phone).display || "none");
            if (disp === "none") return false;

            const stickerDrawer = document.getElementById("uie-phone-sticker-drawer");
            if (stickerDrawer && String(getComputedStyle(stickerDrawer).display || "none") !== "none") {
                try { document.getElementById("uie-phone-sticker-close")?.click(); } catch (_) {}
                return true;
            }

            const $phone = $(phone);
            const $visibleApp = $phone.find(".phone-app-window:visible").first();
            if ($visibleApp.length) {
                const $btn = $visibleApp.find(".phone-back-btn").first();
                if ($btn.length) {
                    try { $btn.trigger("click"); } catch (_) {}
                    return true;
                }
            }

            const lock = document.getElementById("uie-phone-lockscreen");
            if (lock && String(getComputedStyle(lock).display || "none") !== "none") {
                try { $(phone).hide(); } catch (_) {}
                return true;
            }

            const home = document.getElementById("uie-phone-homescreen");
            if (home && String(getComputedStyle(home).display || "none") !== "none") {
                try { $(phone).hide(); } catch (_) {}
                return true;
            }
        } catch (_) {}
        return false;
    };

    const closeTopmostOverlay = () => {
        try {
            const kitchen = document.getElementById("uie-kitchen-overlay");
            if (kitchen) {
                const kd = String(getComputedStyle(kitchen).display || "none");
                if (kd !== "none") {
                    try {
                        const btn = document.getElementById("uie-kitchen-exit");
                        if (btn) {
                            btn.click();
                            return true;
                        }
                    } catch (_) {}
                    try {
                        if (typeof window.UIE_closeKitchen === "function") {
                            window.UIE_closeKitchen();
                            return true;
                        }
                    } catch (_) {}
                    try { $(kitchen).hide(); } catch (_) { try { kitchen.style.display = "none"; } catch (_) {} }
                    return true;
                }
            }

            const ids = [
                "re-quick-modal",
                "re-vn-settings-modal",
                "re-forge-modal",
                "re-st-menu",
                "uie-create-overlay",
                "uie-launcher-options-window"
            ];
            for (const id of ids) {
                const el = document.getElementById(id);
                if (!el) continue;
                const disp = String(getComputedStyle(el).display || "none");
                if (disp === "none") continue;

                if (id === "uie-create-overlay") {
                    try {
                        const btn = document.getElementById("uie-create-overlay-exit");
                        if (btn) {
                            btn.click();
                            return true;
                        }
                    } catch (_) {}
                }

                try { $(el).hide(); } catch (_) { try { el.style.display = "none"; } catch (_) {} }
                return true;
            }

            if (closePhoneBack()) return true;

            const $mods = $(".uie-modal:visible, .uie-overlay:visible, .uie-full-modal:visible");
            if ($mods.length) {
                let best = null;
                let bestZ = -Infinity;
                $mods.each(function () {
                    const z = Number(getComputedStyle(this).zIndex) || 0;
                    if (z >= bestZ) { bestZ = z; best = this; }
                });
                if (best) {
                    try { $(best).hide(); } catch (_) {}
                    return true;
                }
            }

            const $wins = $(".uie-window:visible");
            if ($wins.length) {
                let best = null;
                let bestZ = -Infinity;
                $wins.each(function () {
                    const z = Number(getComputedStyle(this).zIndex) || 0;
                    if (z >= bestZ) { bestZ = z; best = this; }
                });
                if (best) {
                    try { $(best).hide(); } catch (_) {}
                    return true;
                }
            }
        } catch (_) {}
        return false;
    };

    try {
        window.UIE_navPush = navPush;
        window.UIE_navPop = navPop;
        window.UIE_navCloseTop = closeTopmostOverlay;
    } catch (_) {}

    try {
        window.addEventListener("popstate", () => {
            if (!isMobileNow()) return;
            if (uieNavLock) return;
            if (uieNavStack.length) {
                try { uieNavStack.pop(); } catch (_) {}
                closeTopmostOverlay();
            } else {
                closeTopmostOverlay();
            }
        });
    } catch (_) {}
}

function clampToViewportPx(left, top, w, h, pad = 8) {
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const minVisible = 40;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const maxX = Math.max(pad, vw - minVisible);
    const maxY = Math.max(pad, vh - minVisible);
    const x = clamp(left, -Math.max(0, w - minVisible), maxX);
    const y = clamp(top, -Math.max(0, h - minVisible), maxY);
    return { x, y, vw, vh };
}

function ensureVisibleOnScreen($el, pad = 8) {
    if (!$el || !$el.length) return;
    const el = $el.get(0);
    if (!el) return;
    try {
        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const minVisible = 40;

        const badRect =
            !Number.isFinite(rect.left) ||
            !Number.isFinite(rect.top) ||
            !Number.isFinite(rect.right) ||
            !Number.isFinite(rect.bottom) ||
            rect.width <= 1 ||
            rect.height <= 1;

        if (badRect) {
            placeCenteredClamped($el);
            return;
        }

        // If it's completely (or almost completely) off-screen, snap it back.
        const fullyOff =
            rect.right < minVisible ||
            rect.bottom < minVisible ||
            rect.left > vw - minVisible ||
            rect.top > vh - minVisible;

        if (fullyOff) {
            placeCenteredClamped($el);
            return;
        }

        // If partially off-screen, clamp pixel position.
        if (rect.top < 0 || rect.left < 0 || rect.bottom > vh || rect.right > vw) {
            const w = rect.width || $el.outerWidth() || 320;
            const h = rect.height || $el.outerHeight() || 420;
            const pos = clampToViewportPx(rect.left, rect.top, w, h, pad);
            $el.css({ left: `${pos.x}px`, top: `${pos.y}px`, right: "auto", bottom: "auto", transform: "none", position: "fixed" });
        }
    } catch (_) {
        try { placeCenteredClamped($el); } catch (_) {}
    }
}

function getMenuHidden() {
    const s = getSettings();
    const hid = s?.menuHidden;
    return (hid && typeof hid === "object") ? hid : {};
}

function getMenuVisibilityMap() {
    return {
        "uie-hide-inventory": "quickBag",
        "uie-hide-journal": "journal",
        "uie-hide-diary": "diary",
        "uie-hide-social": "social",
        "uie-hide-you": "you",
        "uie-hide-party": "party",
        "uie-hide-stats": "stats",
        "uie-hide-activities": "activities",
        "uie-hide-phone": "phone",
        "uie-hide-map": "map",
        "uie-hide-calendar": "calendar",
        "uie-hide-databank": "databank",
        "uie-hide-settings": "settings",
        "uie-hide-help": "help",
    };
}

function applyMenuHiddenToButtons() {
    try {
        const hid = getMenuHidden();
        const set = (btnSel, key) => {
            try {
                const $b = $(btnSel);
                if (!$b.length) return;
                const hide = hid?.[key] === true;
                $b.toggle(!hide);
            } catch (_) {}
        };

        // Main tab
        set("#uie-btn-quick-bag", "quickBag");
        set("#uie-btn-journal", "journal");
        set("#uie-btn-diary", "diary");
        set("#uie-btn-social", "social");
        set("#uie-btn-you", "you");
        set("#uie-btn-party", "party");
        set("#uie-btn-stats", "stats");
        set("#uie-btn-activities", "activities");

        // Misc/Apps tab
        set("#uie-btn-open-phone", "phone");
        set("#uie-btn-open-map", "map");
        set("#uie-btn-open-calendar", "calendar");
        set("#uie-btn-databank", "databank");

        // System tab
        set("#uie-btn-open-settings", "settings");
        set("#uie-btn-help", "help");

        try {
            if (document.getElementById("game-root")) {
                $("#uie-btn-open-calendar").hide();
            }
        } catch (_) {}
    } catch (_) {}
}

function syncMenuVisibilityCheckboxes() {
    try {
        const hid = getMenuHidden();
        const map = getMenuVisibilityMap();
        for (const id of Object.keys(map)) {
            const key = map[id];
            const el = document.getElementById(id);
            if (!el) continue;
            try { $(el).prop("checked", hid?.[key] === true); } catch (_) {}
        }
    } catch (_) {}
}

function placeCenteredClamped($el) {
    if (!$el || !$el.length) return;
    const el = $el.get(0);
    if (!el) return;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const rect = el.getBoundingClientRect();
    const w = rect.width || $el.outerWidth() || Math.min(420, vw * 0.94);
    const h = rect.height || $el.outerHeight() || Math.min(520, vh * 0.88);
    const left = (vw - w) / 2;
    const top = (vh - h) / 2;
    const pos = clampToViewportPx(left, top, w, h, 8);
    $el.css({ left: `${pos.x}px`, top: `${pos.y}px`, right: "auto", bottom: "auto", transform: "none", position: "fixed" });
}

function placeMenuCenteredScaled($menu, desiredScale = 1) {
    if (!$menu || !$menu.length) return;

    try {
        const el = $menu.get(0);
        if (el && el.parentElement !== document.body) {
            document.body.appendChild(el);
        }
    } catch (_) {}

    const userScale = 1;

    // Measure at natural size (no transform) to compute fit-to-viewport scale.
    // This avoids the menu being bigger than the screen on mobile.
    let w = 320;
    let h = 420;
    try {
        $menu.css({ position: "fixed", left: "0px", top: "0px", right: "auto", bottom: "auto", transform: "none", transformOrigin: "center", visibility: "hidden" });
        const rect = $menu.get(0)?.getBoundingClientRect?.();
        w = rect?.width || $menu.outerWidth() || w;
        h = rect?.height || $menu.outerHeight() || h;
    } catch (_) {}

    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const fitW = vw > 0 ? (vw * 0.94) / Math.max(1, w) : 1;
    const fitH = vh > 0 ? (vh * 0.88) / Math.max(1, h) : 1;
    const fitScale = Math.max(0.5, Math.min(1, fitW, fitH));
    const scale = Math.max(0.5, Math.min(1.5, userScale, fitScale));

    const pad = 10;
    const scaledW = Math.max(1, w * scale);
    const scaledH = Math.max(1, h * scale);
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const minCx = pad + scaledW / 2;
    const maxCx = (vw || 0) - pad - scaledW / 2;
    const minCy = pad + scaledH / 2;
    const maxCy = (vh || 0) - pad - scaledH / 2;

    const targetCx = (vw || 0) / 2;
    const targetCy = (vh || 0) * 0.75;
    const cx = (vw && vw > 0) ? clamp(targetCx, minCx, Math.max(minCx, maxCx)) : 0;
    const cy = (vh && vh > 0) ? clamp(targetCy, minCy, Math.max(minCy, maxCy)) : 0;

    try {
        $menu.css({
            left: vw && vw > 0 ? `${cx}px` : "50%",
            top: vh && vh > 0 ? `${cy}px` : "50%",
            right: "auto",
            bottom: "auto",
            position: "fixed",
            transformOrigin: "center",
            transform: `translate(-50%, -50%) scale(${scale})`,
            visibility: "visible"
        });
    } catch (_) {}
}

function initLauncher() {
    const btn = document.getElementById("uie-launcher");
    if (!btn) return;

    let lastToggleAt = 0;
    let longPressFired = false;
    let touchDown = null;

    const toggleMenu = async (e) => {
        if (longPressFired) {
            longPressFired = false;
            return;
        }

        const now = Date.now();
        if (now - lastToggleAt < 320) return;
        lastToggleAt = now;

        try {
            e?.preventDefault?.();
            e?.stopPropagation?.();
        } catch (_) {}

        try {
            const mod = await (window.importUieModule ? window.importUieModule("features/quickBag.js") : import("./features/quickBag.js"));
            if (mod && typeof mod.toggleQuickBag === "function") {
                mod.toggleQuickBag();
            }
        } catch (err) {
            console.error("[UIE] Error toggling quick bag overlay:", err);
            // Fallback: open bulky inventory if quick bag module fails
            const invWindow = $("#uie-inventory-window");
            if (invWindow.is(":visible")) {
                invWindow.hide();
                return;
            }
            try {
                await openWindow("#uie-inventory-window");
            } catch (_) {}
        }
    };

    const openLauncherOptions = () => {
        try {
            const w = $("#uie-launcher-options-window");
            if (!w.length) return;
            w.show().css("display", "flex");
            w.css("z-index", "2147483652");
            placeCenteredClamped(w);

            const s = getSettings();
            const name = String(s?.launcher?.name || "");
            const hidden = s?.launcher?.hidden === true;
            const src = String(s?.launcher?.src || s?.launcherIcon || "");
            const cursorSrc = String(s?.launcher?.cursorSrc || s?.ui?.customCursor || "");
            $("#uie-launcher-opt-hide").prop("checked", hidden);
            $("#uie-launcher-opt-name").val(name);

            // Populate Saved Icons
            const sel = document.getElementById("uie-launcher-opt-icon");
            if (sel) {
                // Clear old custom options (keeping the hardcoded ones)
                // We identify hardcoded ones by their value not starting with data: or custom
                // Actually easier: remove options with class 'uie-custom-opt'
                $(sel).find(".uie-custom-opt").remove();

                const saved = Array.isArray(s?.launcher?.savedIcons) ? s.launcher.savedIcons : [];
                if (saved.length > 0) {
                    // Add separator
                    const sep = document.createElement("option");
                    sep.textContent = "--- Saved Icons ---";
                    sep.disabled = true;
                    sep.className = "uie-custom-opt";
                    sel.appendChild(sep);

                    saved.forEach((iconUrl, idx) => {
                        const opt = document.createElement("option");
                        opt.value = iconUrl;
                        opt.textContent = `Custom Icon ${idx + 1}`;
                        opt.className = "uie-custom-opt";
                        sel.appendChild(opt);
                    });
                }

                const has = Array.from(sel.options || []).some(o => String(o.value || "") === src);
                sel.value = has ? src : "custom";
            }

            const prev = document.getElementById("uie-launcher-opt-preview");
            if (prev && src) {
                prev.style.backgroundImage = `url("${src}")`;
                prev.style.display = "block";
            } else if (prev) {
                prev.style.backgroundImage = "";
                prev.style.display = "none";
            }
            $("#uie-launcher-opt-cursor").prop("checked", !!cursorSrc && cursorSrc === src);
        } catch (_) {}
    };

    // Block Context Menu (Right Click) to prevent ST Menu interference
    $(btn).off("contextmenu.uieLauncher").on("contextmenu.uieLauncher", function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        openLauncherOptions();
    });

    let lpT = 0;
    const clearLp = () => { if (lpT) { clearTimeout(lpT); lpT = 0; } };
    btn.addEventListener("pointerdown", (e) => {
        try {
            if (String(e.pointerType || "") !== "touch") return;
        } catch (_) { return; }
        touchDown = { x: Number(e.clientX || 0), y: Number(e.clientY || 0), t: Date.now(), moved: false };
        clearLp();
        lpT = setTimeout(() => {
            lpT = 0;
            longPressFired = true;
            openLauncherOptions();
        }, 520);
    }, { passive: true });
    btn.addEventListener("pointerup", clearLp, { passive: true });
    btn.addEventListener("pointercancel", clearLp, { passive: true });
    btn.addEventListener("pointermove", (e) => {
        clearLp();
        try {
            if (String(e.pointerType || "") !== "touch") return;
        } catch (_) { return; }
        if (!touchDown) return;
        const dx = Math.abs(Number(e.clientX || 0) - Number(touchDown.x || 0));
        const dy = Math.abs(Number(e.clientY || 0) - Number(touchDown.y || 0));
        if (dx > 10 || dy > 10) touchDown.moved = true;
    }, { passive: true });

    // Mobile reliability: toggle on pointerup for touch.
    btn.addEventListener("pointerup", (e) => {
        try {
            if (String(e.pointerType || "") !== "touch") return;
        } catch (_) { return; }
        const moved = touchDown?.moved === true;
        touchDown = null;
        if (moved) return;
        toggleMenu(e);
    }, { passive: false });

    // Desktop: click still works; on mobile this is de-duped against pointerup.
    $(btn).off("click.uieLauncher").on("click.uieLauncher", function(e) {
        toggleMenu(e);
    });

    // Menu handlers are initialized by initInteractions().
    initLauncherOptionsHandlers(openLauncherOptions);
}

function initLauncherOptionsHandlers(openLauncherOptions) {
    const syncIcon = (src) => {
        const prev = document.getElementById("uie-launcher-opt-preview");
        if (prev && src) {
            prev.style.backgroundImage = `url("${src}")`;
            prev.style.display = "block";
        } else if (prev) {
            prev.style.backgroundImage = "";
            prev.style.display = "none";
        }
    };

    const applyCustomCursor = () => {
        try { window.UIE_applyCustomCursorFromSettings?.(getSettings()); } catch (_) {}
    };

    const setLauncherCursorFromSource = (src, enabled) => {
        const s = getSettings();
        if (!s.launcher) s.launcher = {};
        if (!s.ui) s.ui = {};
        if (enabled && src && /^data:image\//i.test(src)) {
            s.launcher.cursorSrc = src;
            s.ui.customCursor = src;
        } else {
            delete s.launcher.cursorSrc;
            delete s.ui.customCursor;
        }
        saveSettings();
        applyCustomCursor();
    };

    $("body").off("change.uieLauncherOptHide").on("change.uieLauncherOptHide", "#uie-launcher-opt-hide", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        if (!s.launcher) s.launcher = {};
        s.launcher.hidden = $(this).prop("checked") === true;
        saveSettings();
        updateLayout();
    });

    $("body").off("input.uieLauncherOptName change.uieLauncherOptName").on("input.uieLauncherOptName change.uieLauncherOptName", "#uie-launcher-opt-name", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        if (!s.launcher) s.launcher = {};
        s.launcher.name = String($(this).val() || "");
        saveSettings();
        updateLayout();
    });

    const updateLauncherButton = (src) => {
        const btn = document.getElementById("uie-launcher");
        if (!btn) return;

        const defaultIcon = "https://user.uploads.dev/file/b3fc92e1b70f0c8f0c200b544f7a4cce.png";
        let iconUrl = (src && src.trim() !== "" && src !== "custom") ? src : defaultIcon;

        // Handle custom fallback
        if (src === "custom") {
             const s = getSettings();
             if (s?.launcher?.src && s.launcher.src !== "custom") {
                 iconUrl = s.launcher.src;
             }
        }

        // Try to update existing inner div first to preserve state/animations
        let imgDiv = btn.querySelector(".uie-launcher-img");
        if (!imgDiv) {
            btn.innerHTML = ""; // Clear fallback icons if any
            imgDiv = document.createElement("div");
            imgDiv.className = "uie-launcher-img";
            imgDiv.style.width = "100%";
            imgDiv.style.height = "100%";
            imgDiv.style.borderRadius = "0";
            imgDiv.style.boxShadow = "none";
            imgDiv.style.backgroundPosition = "center";
            imgDiv.style.backgroundSize = "contain";
            imgDiv.style.backgroundRepeat = "no-repeat";
            btn.appendChild(imgDiv);
        }

        // Update background image safely
        imgDiv.style.backgroundImage = `url('${iconUrl}')`;
        imgDiv.style.backgroundPosition = "center";
        imgDiv.style.backgroundSize = "contain";
        imgDiv.style.backgroundRepeat = "no-repeat";
        imgDiv.style.backgroundColor = "transparent";
        imgDiv.style.boxShadow = "none";
        imgDiv.style.borderRadius = "0";
        btn.style.background = "transparent";
        btn.style.border = "0";
        btn.style.boxShadow = "none";

        console.log("[UIE] Launcher icon updated to:", iconUrl);
    };

    $("body").off("change.uieLauncherOptIcon").on("change.uieLauncherOptIcon", "#uie-launcher-opt-icon", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const val = String($(this).val() || "");
        console.log("[UIE] Icon selection changed to:", val);

        if (val === "custom") {
            document.getElementById("uie-launcher-opt-file")?.click();
            return;
        }

        const s = getSettings();
        if (!s.launcher) s.launcher = {};
        s.launcher.src = val;
        if ($("#uie-launcher-opt-cursor").prop("checked") === true) {
            if (/^data:image\//i.test(val)) {
                s.launcher.cursorSrc = val;
                s.ui = s.ui || {};
                s.ui.customCursor = val;
            } else {
                delete s.launcher.cursorSrc;
                if (s.ui) delete s.ui.customCursor;
                $("#uie-launcher-opt-cursor").prop("checked", false);
            }
        }
        saveSettings();
        applyCustomCursor();

        // Update layout might move the button but we need to ensure the icon is correct
        updateLayout();

        // Sync preview and button
        syncIcon(val);
        updateLauncherButton(val);
    });

    $("body").off("change.uieLauncherOptFile").on("change.uieLauncherOptFile", "#uie-launcher-opt-file", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const file = this.files && this.files[0];
        if (!file) return;
        const r = new FileReader();
        r.onload = () => {
            const src = String(r.result || "");
            if (!src) return;
            const s = getSettings();
            if (!s.launcher) s.launcher = {};
            s.launcher.src = src;
            s.launcher.lastUploadName = String(file.name || "");
            if (!Array.isArray(s.launcher.savedIcons)) s.launcher.savedIcons = [];
            if (!s.launcher.savedIcons.includes(src)) s.launcher.savedIcons.unshift(src);
            if ($("#uie-launcher-opt-cursor").prop("checked") === true) {
                s.launcher.cursorSrc = src;
                s.ui = s.ui || {};
                s.ui.customCursor = src;
            }
            saveSettings();
            updateLayout();
            applyCustomCursor();
            syncIcon(src);
            updateLauncherButton(src);
        };
        r.readAsDataURL(file);
        try { this.value = ""; } catch (_) {}
    });

    $("body").off("click.uieLauncherOptResetPos").on("click.uieLauncherOptResetPos", "#uie-launcher-opt-resetpos", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        s.launcherX = 20;
        s.launcherY = 120;
        saveSettings();
        updateLayout();
        try { openLauncherOptions?.(); } catch (_) {}
    });

    $("body").off("click.uieLauncherOptOpenSettings").on("click.uieLauncherOptOpenSettings", "#uie-launcher-opt-open-settings", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        try {
            openUieSettingsDrawer();
            $("#uie-launcher-options-window").hide();
        } catch (_) {}
    });

    $("body").off("change.uieLauncherOptCursor").on("change.uieLauncherOptCursor", "#uie-launcher-opt-cursor", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        const src = String(s?.launcher?.src || s?.launcherIcon || "");
        const enabled = $(this).prop("checked") === true;
        if (enabled && !/^data:image\//i.test(src)) {
            $(this).prop("checked", false);
            window.showToast?.("Upload a custom launcher image first, then enable cursor mode.", 3600);
            return;
        }
        setLauncherCursorFromSource(src, enabled);
    });
}

function openUieSettingsDrawer() {
    try {
        if (window.UIE_STANDALONE && typeof window.openConfigModal === "function") {
            window.openConfigModal("mainapi");
            return;
        }
        const activateHostExtensionsTab = () => {
            try {
                const modal = document.getElementById("config-modal");
                if (!modal) return false;
                const tabBtn = modal.querySelector('.tab-btn[data-tab="extensions"]');
                const panel = modal.querySelector('.tab-panel[data-tab-panel="extensions"]');
                if (!tabBtn || !panel) return false;
                modal.style.display = "flex";
                modal.querySelectorAll(".tab-btn").forEach((el) => el.classList.remove("active"));
                tabBtn.classList.add("active");
                modal.querySelectorAll(".tab-panel").forEach((el) => el.classList.remove("active"));
                panel.classList.add("active");
                return true;
            } catch (_) {
                return false;
            }
        };

        try {
            if (typeof window.openConfigModal === "function") {
                window.openConfigModal("extensions");
                return;
            }
        } catch (_) {}

        if (activateHostExtensionsTab()) return;

        try {
            const hostBtn = document.getElementById("btn-config") || document.getElementById("nav-settings");
            if (hostBtn) {
                hostBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                setTimeout(() => {
                    try { activateHostExtensionsTab(); } catch (_) {}
                }, 0);
            }
            if (activateHostExtensionsTab()) return;
        } catch (_) {}

        const block = document.getElementById("uie-settings-block");
        if (!block) return;

        // Best-effort: ensure drawer is expanded.
        const content = block.querySelector(".inline-drawer-content");
        if (content && window.getComputedStyle(content).display === "none") {
            const toggle = block.querySelector(".inline-drawer-toggle");
            if (toggle) toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }

        try { syncKillSwitchUi(); } catch (_) {}
        try { syncSettingsDrawerUi(); } catch (_) {}

        // Scroll settings into view.
        block.scrollIntoView?.({ block: "start", behavior: "smooth" });
    } catch (_) {}
}

function initGenericHandlers() {
    // Generic Close Button for any UIE Window
    // Added pointerup for better responsiveness
    // COMPREHENSIVE LIST OF CLOSE BUTTONS
    const selectors = [
        ".uie-close-btn", ".uie-inv-close", ".uie-window-close", ".uie-p-close",
        "#uie-world-close", "#re-forge-close",
        "#uie-party-close",
        "#uie-activities-close-btn",
        "#uie-social-close", "#books-reader-close", "#uie-phone-sticker-close",
        "#uie-sprites-close", "#uie-map-card-close", ".uie-sticker-close",
        "#uie-chatbox-close", "#uie-chatbox-options-close",
        "#uie-stats-close-btn", "#uie-inv-editor-close", "#uie-fx-close",
        "#uie-create-overlay-exit",
        "#life-create-close", "#life-edit-close", "#life-template-close",
        "#uie-launcher-opt-close",
        "#life-create-cancel",
        "#uie-diary-close", "#uie-databank-close", "#uie-journal-close"
    ].join(", ");

    // A semantic click covers pointer, touch, and keyboard activation without double-firing.
    $("body").off("click.uieGenericClose", selectors).on("click.uieGenericClose", selectors, function(e) {
        const closeId = String(this?.id || "");
        if (closeId === "uie-create-overlay-exit") {
            e.preventDefault();
            e.stopPropagation();
            try { e.stopImmediatePropagation(); } catch (_) {}
            try {
                if (typeof window.UIE_closeCreateOverlay === "function") {
                    window.UIE_closeCreateOverlay();
                } else {
                    const ov = document.getElementById("uie-create-overlay");
                    if (ov) {
                        try { ov.style.setProperty("display", "none", "important"); } catch (_) { ov.style.display = "none"; }
                    }
                    const body = document.getElementById("uie-create-overlay-body");
                    if (body) {
                        body.style.background = "transparent";
                        body.innerHTML = "";
                    }
                }
            } catch (_) {}
            return;
        }

        if (
            closeId === "uie-create-overlay-exit" ||
            closeId === "uie-kitchen-exit" ||
            closeId === "uie-k-pick-close" ||
            $(this).is(".uie-create-close")
        ) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        const win = $(this).closest(".uie-window");
        if (win.length) {
            blurFocusInside(win);
            win.hide();
        } else {
            // Fallback for overlays that might not be .uie-window
            // Added .uie-book-overlay for Diary
            const $container = $(this).closest(".uie-overlay, .uie-modal, #uie-inventory-window, .uie-full-modal, .uie-book-overlay, #uie-diary-window");
            blurFocusInside($container);
            $container.hide();
            // Also handle specific parents if closest fails
            if (this.id === "re-forge-close") $("#re-forge-modal").hide();
            if (this.id === "uie-map-card-close") $("#uie-map-card").hide();
        }

        try { window.UIE_navPop?.(); } catch (_) {}
    });

    // Newer panels use semantic close labels instead of one of the legacy close classes.
    const semanticCloseSelectors = [
        "button[aria-label^='Close']",
        "button[aria-label^='close']",
        "button[id$='-close']",
        "button[id$='-close-btn']",
    ].join(", ");
    $("body").off("click.uieSemanticClose", semanticCloseSelectors).on("click.uieSemanticClose", semanticCloseSelectors, function(e) {
        if ($(this).is(selectors)) return;
        e.preventDefault();
        e.stopPropagation();
        const $container = $(this).closest([
            ".uie-map-modal",
            ".modal-overlay",
            ".uie-overlay",
            ".uie-modal",
            ".uie-full-modal",
            ".uie-book-overlay",
            ".uie-window",
            "[id$='-modal']",
            "[id$='-window']",
        ].join(", "));
        if (!$container.length) return;
        blurFocusInside($container);
        $container.prop("hidden", true).attr("aria-hidden", "true").hide();
        try { window.UIE_navPop?.(); } catch (_) {}
    });

    // The standalone navigation bar can be rebound or replaced after startup.
    $("body").off("click.uieAtlasNav", "#nav-map").on("click.uieAtlasNav", "#nav-map", async function(e) {
        e.preventDefault();
        try {
            const map = await (window.importUieModule ? window.importUieModule("map.js") : import("./map.js"));
            await map.openMap?.();
        } catch (err) {
            console.error("[Navigation] Failed to open map:", err);
            try { notify("error", "Map could not be opened.", "Navigation"); } catch (_) {}
        }
    });

    $("body").off("click.uieLauncherOptClose", "#uie-launcher-opt-close").on("click.uieLauncherOptClose", "#uie-launcher-opt-close", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-launcher-options-window").hide();
    });
}

window.openInventoryWindow = async function(tab = "items") {
    await openWindow("#uie-inventory-window");
    if (!window.uieInventoryLoaded) {
        const mod = await import("./inventory.js");
        if (mod.initInventory) mod.initInventory();
        window.uieInventoryLoaded = true;
    }
    setTimeout(() => {
        const root = document.getElementById("uie-inventory-window");
        if (root) {
            const btn = root.querySelector(`#inv-tab-${tab}-btn`);
            if (btn) btn.click();
        }
    }, 50);
};

async function openWindow(selector) {
    if (String(selector || "") === "#uie-battle-window") selector = "#battle-screen";
    const win = await ensureStandaloneWindowLoaded(selector);
    if (!win.length) return;

    // A full window and QuickBag occupy the same overlay lane.  Closing the
    // compact bag here prevents a stale panel from obscuring a newly opened
    // modal.
    try {
        const quickBag = await import("./features/quickBag.js");
        quickBag?.hideQuickBag?.();
    } catch (_) {}

    // Hide other UIE windows
    $(".uie-window").each(function() {
        blurFocusInside(this);
        $(this).hide();
    });

    // Show this window
    win.css("display", resolveWindowDisplayMode(selector, win));

    // Dynamic Z-Index Handling: Bring to front
    const visibleWins = $(".uie-window").filter(":visible").toArray();
    const highestZ = Math.max(2147483629, ...visibleWins.map(el => Number(getComputedStyle(el).zIndex) || 0));

    win.css("z-index", highestZ + 1);

    // Ensure it's a direct child of body to avoid stacking context traps
    if (win[0].parentElement !== document.body) {
        document.body.appendChild(win[0]);
    }

    if (String(selector || "") === "#uie-settings-window" || String(win.attr("id") || "") === "uie-settings-window") {
        try { syncKillSwitchUi(); } catch (_) {}
        try { syncSettingsDrawerUi(); } catch (_) {}
    }

    // One layout path at every viewport: preserve each window's desktop geometry,
    // then only clamp an already-dragged window back into the visible viewport.
    ensureVisibleOnScreen(win, 8);

    // Ensure on-screen: clamp pixel position, never force translate centering
    try {
        const rect = win[0].getBoundingClientRect();
        if (rect.top < 0 || rect.left < 0 || rect.bottom > window.innerHeight || rect.right > window.innerWidth) {
            const w = rect.width || win.outerWidth() || 320;
            const h = rect.height || win.outerHeight() || 420;
            const pos = clampToViewportPx(rect.left, rect.top, w, h, 8);
            win.css({ left: `${pos.x}px`, top: `${pos.y}px`, right: "auto", bottom: "auto", transform: "none", position: "fixed" });
        }
    } catch (_) {}

    // Close main menu
    $("#uie-main-menu").hide();

    try { window.UIE_navPush?.(`win:${String(selector || "")}`); } catch (_) {}
    try { window.UIE_refreshStateSaves?.(); } catch (_) {}
}

function initWindowLayering() {
    // Bring window to front on click
    $("body").off("mousedown.uieWindowLayering pointerdown.uieWindowLayering").on("mousedown.uieWindowLayering pointerdown.uieWindowLayering", ".uie-window", function() {
        const visibleWins = $(".uie-window:visible").toArray();
        const highestZ = Math.max(2147483629, ...visibleWins.map(el => Number(getComputedStyle(el).zIndex) || 0));

        const current = Number($(this).css("z-index")) || 0;
        const isPhone = $(this).is("#uie-phone-window");

        // Phone always wins
        if (isPhone) {
            $(this).css("z-index", 2147483646);
        } else if (current <= highestZ) {
            // Standard window
            $(this).css("z-index", highestZ + 1);
        }
    });
}

function initMenuButtons() {
    initWindowLayering();
    if (typeof window.importUieModule === "function") return;
    const $menu = $("#uie-main-menu");

    $menu.off("click.uieMenuInv").on("click.uieMenuInv", "#uie-btn-inventory", async function() {
        if (Date.now() - Number(uieMenuTabSwitchedAt || 0) < 350) return false;
        $("#uie-main-menu").hide();
        await openWindow("#uie-inventory-window");
        try {
            const mod = await import("./inventory.js");
            if (mod?.initInventory) mod.initInventory();
        } catch (e) { console.warn("Inventory init failed:", e); }
    });

    $menu.off("click.uieMenuSettings").on("click.uieMenuSettings", "#uie-btn-open-settings", async function() {
        if (Date.now() - Number(uieMenuTabSwitchedAt || 0) < 350) return false;
        openUieSettingsDrawer();
        $("#uie-main-menu").hide();
    });

    // Personas
    $menu.off("click.uieMenuPersonas").on("click.uieMenuPersonas", "#uie-btn-personas", async function() {
        if (Date.now() - Number(uieMenuTabSwitchedAt || 0) < 350) return false;
        $("#uie-main-menu").hide();
        $("#btn-personas").trigger("click");
    });

    // Tweaker
    $menu.off("click.uieMenuTweaker").on("click.uieMenuTweaker", "#uie-btn-tweaker", async function() {
        if (Date.now() - Number(uieMenuTabSwitchedAt || 0) < 350) return false;
        await openWindow("#uie-atmosphere-window");
        $("#uie-main-menu").hide();
        try { (await import("./atmosphere.js")).initAtmosphereWindow?.(); } catch(e) { console.error("[Tweaker] Failed to init atmosphere window:", e); }
    });

    // Journal
    $menu.off("click.uieMenuJournal").on("click.uieMenuJournal", "#uie-btn-journal", async function() {
        await openWindow("#uie-journal-window");
        try { (await import("./journal.js")).initJournal?.(); } catch (_) {}
    });

    // Character Cards
    $menu.off("click.uieMenuCharacterCards").on("click.uieMenuCharacterCards", "#uie-btn-character-cards", async function() {
        $("#uie-main-menu").hide();
        try { (await import("./character_cards.js")).renderCardManager?.(); } catch (e) { console.error("[UIE] Character cards failed:", e); }
    });

    // Party Command
    $menu.off("click.uieMenuParty").on("click.uieMenuParty", "#uie-btn-party", async function() {
        await openWindow("#uie-party-window");
        try { (await import("./party.js")).initParty?.(); } catch (_) {}
    });

    // Diary
    $menu.off("click.uieMenuDiary").on("click.uieMenuDiary", "#uie-btn-diary", async function() {
        await openWindow("#uie-diary-window");
        try {
            const diary = await import("./diary.js");
            diary.renderDiary?.();
            diary.initDiary?.();
            $("#uie-diary-window").css("display", resolveWindowDisplayMode("#uie-diary-window", $("#uie-diary-window")));
        } catch (_) {}
    });

    $menu.off("click.uieMenuFactions").on("click.uieMenuFactions", "#uie-btn-factions", async function() {
        await openWindow("#uie-factions-window");
        try {
            const mod = await import("./factions.js");
            mod.initFactions?.();
            mod.openFactions?.();
        } catch (_) {}
    });

    // Social
    $menu.off("click.uieMenuSocial").on("click.uieMenuSocial", "#uie-btn-social", async function() {
        await openWindow("#uie-social-window");
        try { (await import("./social.js")).initSocial?.(); } catch (_) {}
    });

    $menu.off("click.uieMenuYou").on("click.uieMenuYou", "#uie-btn-you", async function() {
        await openWindow("#uie-you-window");
        try {
            const mod = await import("./you.js");
            mod.initYou?.();
            mod.renderYou?.();
        } catch (e) {
            console.warn("[UIE] You window failed:", e);
        }
    });

    $menu.off("click.uieMenuSchedules").on("click.uieMenuSchedules", "#uie-btn-schedules", async function() {
        $("#uie-main-menu").hide();
        try { await (await import("./schedules.js")).openSchedules?.(); } catch (e) { console.error("[UIE] Schedules failed:", e); }
    });

    // Stats (Might be inventory tab or separate)
    $menu.off("click.uieMenuStats").on("click.uieMenuStats", "#uie-btn-stats", async function() {
        await openWindow("#uie-stats-window");
        try { (await import("./features/stats.js")).initStats?.(); } catch (_) {}
    });

    // Activities
    $menu.off("click.uieMenuActivities").on("click.uieMenuActivities", "#uie-btn-activities", async function() {
        await openWindow("#uie-activities-window");
        try { (await import("./features/activities.js")).initActivities?.(); } catch (_) {}
    });

    // Battle
    $menu.off("click.uieMenuBattle").on("click.uieMenuBattle", "#uie-btn-battle", async function() {
        try {
            $("#uie-main-menu").hide();
            const mod = await import("./battle.js");
            mod.initBattle?.();
            await mod.openBattleTargetPicker?.();
        } catch (e) {
            console.error("[MainMenu] Failed to open battle picker:", e);
            try { notify("error", "Battle UI could not be opened. Check console.", "Battle"); } catch (_) {}
        }
    });

    // Helper Pet
    $menu.off("click.uieMenuHelperPet").on("click.uieMenuHelperPet", "#uie-btn-helper-pet", async function() {
        try {
            $("#uie-main-menu").hide();
            const mod = await import("./helperPet.js");
            mod.initHelperPet?.();
            mod.openHelperPetSettings?.();
        } catch (e) {
            console.error("[MainMenu] Failed to open helper pet:", e);
            try { notify("error", "Helper Pet UI could not be opened. Check console.", "Helper Pet"); } catch (_) {}
        }
    });

    // Phone
    $menu.off("click.uieMenuPhone").on("click.uieMenuPhone", "#uie-btn-open-phone", async function() {
        try {
            await openWindow("#uie-phone-window");
            const mod = await import("./phone.js");
            if (mod.initPhone) mod.initPhone();
        } catch (e) { console.error("Phone load error:", e); }
        $("#uie-main-menu").hide();
    });

    $menu.off("click.uieMenuAddNpc").on("click.uieMenuAddNpc", "#uie-btn-add-npc", async function() {
        try {
            $("#uie-main-menu").hide();
            const mod = await import("./npcManagementModal.js");
            mod.initNPCManagementModal?.();
            mod.openNPCRosterPanel?.();
        } catch (e) {
            console.error("[MainMenu] Failed to open NPC creator:", e);
            try { notify("error", "NPC creator could not be opened.", "World"); } catch (_) {}
        }
    });

    // Map (fresh single-module atlas)
    $menu.off("click.uieMenuMap").on("click.uieMenuMap", "#uie-btn-open-map", async function() {
        try {
            $("#uie-main-menu").hide();
            const m = await (window.importUieModule ? window.importUieModule("map.js") : import("./map.js"));
            await m.openMap?.();
        } catch (e) {
            console.error("[MainMenu] Failed to open map:", e);
        }
    });

    // Calendar (use openCalendar so positioning matches game.html / UIE scale)
    $menu.off("click.uieMenuCalendar").on("click.uieMenuCalendar", "#uie-btn-open-calendar, #uie-btn-open-calendar-main", async function() {
        try {
            const cal = await import("./calendar.js");
            if (typeof cal.openCalendar === "function") {
                const ok = await cal.openCalendar({ hideOtherUieWindows: true, fade: true });
                if (!ok) {
                    try {
                        notify("warning", "Calendar could not be loaded (missing template or blocked fetch).", "UIE");
                    } catch (_) {}
                }
                return;
            }
            const ok = typeof cal.ensureCalendarMounted === "function" ? await cal.ensureCalendarMounted() : false;
            if (!ok && !document.getElementById("uie-calendar-window")) {
                try {
                    notify("warning", "Calendar could not be loaded (missing src/templates/calendar.html or blocked fetch).", "UIE");
                } catch (_) {}
                return;
            }
            openWindow("#uie-calendar-window");
            if (typeof cal.initCalendar === "function") await cal.initCalendar();
            if (typeof cal.renderCalendar === "function") cal.renderCalendar();
        } catch (_) {}
    });

    // Databank
    $menu.off("click.uieMenuDatabank").on("click.uieMenuDatabank", "#uie-btn-databank", async function() {
        await openWindow("#uie-databank-window");
        try { (await import("./databank.js")).initDatabank?.(); } catch (_) {}
    });

    // Databank
    $menu.off("click.uieMenuDatabank").on("click.uieMenuDatabank", "#uie-btn-databank", async function() {
        await openWindow("#uie-databank-window");
        try { (await import("./databank.js")).initDatabank?.(); } catch (_) {}
    });

    // Help
    $menu.off("click.uieMenuHelp").on("click.uieMenuHelp", "#uie-btn-help", async function() {
        openHelpManualWindow();
    });

    // Chatbox (Reality Engine Projection)
    $menu.off("click.uieMenuChatbox").on("click.uieMenuChatbox", "#uie-btn-chatbox", async function() {
        const win = $("#uie-chatbox-window");
        if (win.length) {
            win.show();
            win.css("z-index", "2147483655");
            try { (await import("./chatbox.js")).openChatbox?.(); } catch (_) {}
            $("#uie-main-menu").hide();
        } else {
             try { (await import("./chatbox.js")).openChatbox?.(); } catch (_) {}
             $("#uie-main-menu").hide();
        }
    });

    // Memories scan controls (settings window)
    $(document)
        .off("click.uieMemScanAll")
        .on("click.uieMemScanAll", "#uie-mem-scan-all", async function(e) {
            e.preventDefault();
            e.stopPropagation();
            try {
                notify("info", "Scanning memories from start...", "Memories");
                const mod = await import("./memories.js");
                await mod.scanAllMemoriesFromStart?.();
                notify("success", "Memory scan complete.", "Memories");
            } catch (err) {
                console.warn("[UIE] Memory full scan failed", err);
                notify("error", "Memory scan failed.", "Memories");
            }
        })
        .off("click.uieMemScanNext")
        .on("click.uieMemScanNext", "#uie-mem-scan-next", async function(e) {
            e.preventDefault();
            e.stopPropagation();
            try {
                const mod = await import("./memories.js");
                await mod.scanNextMemoriesChunk?.();
                notify("success", "Scanned next memory chunk.", "Memories");
            } catch (err) {
                console.warn("[UIE] Memory chunk scan failed", err);
                notify("error", "Memory chunk scan failed.", "Memories");
            }
        });
}

function initMenuTabs() {
    // Use one semantic click path. Browsers already synthesize click for touch and
    // keyboard activation; binding pointerup as well caused swallowed/double actions.
    $(document).off("click.uieMenuTabs", "#uie-main-menu .uie-menu-tab");
    $(document).on("click.uieMenuTabs", "#uie-main-menu .uie-menu-tab", function(e) {
        e.preventDefault();
        e.stopPropagation();

        uieMenuTabSwitchedAt = Date.now();
        const tab = $(this).data("tab");
        const target = $("#uie-tab-" + tab);
        if (!target.length) return;

        $("#uie-main-menu .uie-menu-tab").removeClass("active").attr("aria-selected", "false");
        $(this).addClass("active").attr("aria-selected", "true");

        $("#uie-main-menu .uie-menu-page").hide();
        target.show();
    });

    $(document).off("pointerup.uieMenuCloseButton touchend.uieMenuCloseButton click.uieMenuCloseButton", "#uie-menu-close").on("pointerup.uieMenuCloseButton touchend.uieMenuCloseButton click.uieMenuCloseButton", "#uie-menu-close", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-main-menu").hide();
    });

    // Settings Tabs Logic
    const $settingsTabs = $("#uie-settings-tabs");
    $(document).off("click.uieSettingsTabs");
    $(document).on("click.uieSettingsTabs", "#uie-settings-tabs .uie-set-tab", function(e) {
        e.preventDefault();
        e.stopPropagation();

        const tab = $(this).data("tab");

        const idPrefix = "uie-set-";
        const $scope = $(".uie-settings-block");
        const target = $("#" + idPrefix + tab);

        // Hide all setting pages (scoped)
        if ($scope && $scope.length) {
            $scope.find(`[id^='${idPrefix}']`).hide();
        } else {
            $(`[id^='${idPrefix}']`).hide();
        }

        // Reset all tabs (only within the clicked tabs container)
        const $tabsRoot = $(this).closest("#uie-settings-tabs");
        ($tabsRoot.length ? $tabsRoot : $("#uie-settings-tabs")).find(".uie-set-tab")
            .removeClass("active")
            .css({ "border-bottom-color": "transparent", "color": "#888", "font-weight": "normal" });

        // Activate clicked tab
        $(this).addClass("active").css({ "border-bottom-color": "#cba35c", "color": "#fff", "font-weight": "bold" });

        // Show target page
        if (target.length) target.show();

        // Profiles tab: sync host-app connection presets into selector.
        if (String(tab || "") === "profiles") {
            setTimeout(() => {
                try { syncConnectionPresetsToUi(true); } catch (_) {}
            }, 60);
        }
    });

    // (settings_window removed)

    $(document).off("click.uieSettingsWindowTabs");
    $(document).on("click.uieSettingsWindowTabs", "#uie-sw-tabs .uie-set-tab", function(e) {
        e.preventDefault();
        e.stopPropagation();

        const tab = String($(this).data("tab") || "").trim();
        if (!tab) return;

        const root = document.getElementById("uie-settings-window");
        if (root) {
            const pages = root.querySelectorAll(".uie-settings-section, #uie-sw-general, #uie-sw-menu, #uie-sw-rpg, #uie-sw-style, #uie-sw-image, #uie-sw-turbo, #uie-sw-prompts, #uie-sw-popups, #uie-sw-vnbox");
            for (const el of pages) {
                try { el.style.display = "none"; } catch (_) {}
            }
            const target = root.querySelector("#uie-sw-" + tab);
            if (target) {
                try { target.style.display = "block"; } catch (_) {}
            }
        }

        const $tabsRoot = $(this).closest("#uie-sw-tabs");
        ($tabsRoot.length ? $tabsRoot : $("#uie-sw-tabs")).find(".uie-set-tab")
            .removeClass("active")
            .css({ "border-bottom-color": "transparent", "color": "#888", "font-weight": "700" });

        $(this).addClass("active").css({ "border-bottom-color": "#cba35c", "color": "#fff", "font-weight": "700" });

        if (tab === "audio") {
            setTimeout(() => { try { syncAudioSettingsUi(); } catch (_) {} }, 20);
        }
    });

    $("body").off("click.uieSettingsWindowClose", "#uie-settings-close")
        .on("click.uieSettingsWindowClose", "#uie-settings-close", function(e) {
            e.preventDefault();
            e.stopPropagation();
            const win = $("#uie-settings-window");
            if (win.length) win.hide();
            try { window.UIE_navPop?.(); } catch (_) {}
        });

    // --- Host App Connection Presets (Main API) ---
    function ensureConnectionPresets(s) {
        if (!s.connections || typeof s.connections !== "object") s.connections = {};
        if (!Array.isArray(s.connections.presets)) s.connections.presets = [];

        if (!s.connections.presets.length) {
            const turbo = s.turbo && typeof s.turbo === "object" ? s.turbo : {};
            s.connections.presets = [{
                id: "default",
                name: "Default",
                url: String(turbo.url || "").trim(),
                model: String(turbo.model || "").trim(),
                key: String(turbo.key || "").trim(),
                temp: Number.isFinite(Number(turbo.temp)) ? Number(turbo.temp) : 0.7,
                topp: Number.isFinite(Number(turbo.topp)) ? Number(turbo.topp) : 1,
                topk: Number.isFinite(Number(turbo.topk)) ? Number(turbo.topk) : 0,
                maxTokens: Number.isFinite(Number(turbo.maxTokens)) ? Number(turbo.maxTokens) : 25000,
                historyLimit: Number.isFinite(Number(turbo.historyLimit)) ? Number(turbo.historyLimit) : 8,
            }];
        }

        s.connections.presets = s.connections.presets
            .filter((p) => p && typeof p === "object")
            .map((p, i) => {
                const id = String(p.id || `preset_${i + 1}`).trim() || `preset_${i + 1}`;
                return {
                    id,
                    name: String(p.name || id).trim() || id,
                    url: String(p.url || "").trim(),
                    model: String(p.model || "").trim(),
                    key: String(p.key || "").trim(),
                    temp: Number.isFinite(Number(p.temp)) ? Number(p.temp) : 0.7,
                    topp: Number.isFinite(Number(p.topp)) ? Number(p.topp) : 1,
                    topk: Number.isFinite(Number(p.topk)) ? Number(p.topk) : 0,
                    maxTokens: Number.isFinite(Number(p.maxTokens)) ? Number(p.maxTokens) : 25000,
                    historyLimit: Number.isFinite(Number(p.historyLimit)) ? Number(p.historyLimit) : 8,
                };
            });

        if (!String(s.connections.activePresetId || "").trim()) {
            s.connections.activePresetId = String(s.connections.presets[0]?.id || "default");
        }
        return s.connections;
    }

    function syncConnectionPresetsToUi(selectSaved = false) {
        const uieSel = document.getElementById("uie-st-preset-select");
        if (!uieSel) return;

        const s = getSettings();
        const conn = ensureConnectionPresets(s);
        const prev = String(uieSel.value || "");
        uieSel.innerHTML = "";

        for (const p of conn.presets) {
            const opt = document.createElement("option");
            opt.value = String(p.id || "");
            opt.textContent = String(p.name || p.id || "").trim() || "Preset";
            uieSel.appendChild(opt);
        }

        const saved = String(conn.activePresetId || "");
        const hasSaved = saved && Array.from(uieSel.options).some((o) => String(o.value || "") === saved);
        const hasPrev = prev && Array.from(uieSel.options).some((o) => String(o.value || "") === prev);
        if (selectSaved && hasSaved) uieSel.value = saved;
        else if (hasPrev) uieSel.value = prev;
        else if (uieSel.options.length) uieSel.value = String(uieSel.options[0].value || "");

        saveSettings();
    }

    $(document).off("click.uieStPresetRefresh").on("click.uieStPresetRefresh", "#uie-st-preset-refresh", function (e) {
        e.preventDefault();
        e.stopPropagation();
        try { syncConnectionPresetsToUi(true); } catch (_) {}
        try { notify("info", "Refreshed connection presets.", "UIE", "settings"); } catch (_) {}
    });

    $(document).off("change.uieStPreset").on("change.uieStPreset", "#uie-st-preset-select", function (e) {
        e.preventDefault();
        e.stopPropagation();

        const val = String($(this).val() || "");
        const s = getSettings();
        const conn = ensureConnectionPresets(s);
        conn.activePresetId = val;

        const preset = conn.presets.find((p) => String(p.id || "") === val);
        if (!preset) {
            saveSettings();
            return;
        }

        if (!s.turbo || typeof s.turbo !== "object") s.turbo = {};
        s.turbo.url = String(preset.url || "").trim() || s.turbo.url || "";
        s.turbo.model = String(preset.model || "").trim() || s.turbo.model || "";
        if (String(preset.key || "").trim()) s.turbo.key = String(preset.key || "").trim();
        s.turbo.temp = Number.isFinite(Number(preset.temp)) ? Number(preset.temp) : Number(s.turbo.temp || 0.7);
        s.turbo.topp = Number.isFinite(Number(preset.topp)) ? Number(preset.topp) : Number(s.turbo.topp || 1);
        s.turbo.topk = Number.isFinite(Number(preset.topk)) ? Number(preset.topk) : Number(s.turbo.topk || 0);
        s.turbo.maxTokens = Number.isFinite(Number(preset.maxTokens)) ? Number(preset.maxTokens) : Number(s.turbo.maxTokens || 25000);
        s.turbo.historyLimit = Number.isFinite(Number(preset.historyLimit)) ? Number(preset.historyLimit) : Number(s.turbo.historyLimit || 8);

        saveSettings();
        try { notify("success", "Applied preset to Turbo API settings.", "UIE", "settings"); } catch (_) {}
    });

    setTimeout(() => {
        try { syncConnectionPresetsToUi(true); } catch (_) {}
    }, 900);

    // Scan Now Button (Moved to Wand Menu)
    // Handler removed from here as the button was removed from settings.

    const ensureUiCustomization = (s) => {
        if (!s.ui || typeof s.ui !== "object") s.ui = {};
        if (!s.ui.css || typeof s.ui.css !== "object") s.ui.css = { global: "", stats: "", activities: "", byTarget: {} };
        if (typeof s.ui.css.global !== "string") s.ui.css.global = "";
        if (typeof s.ui.css.stats !== "string") s.ui.css.stats = "";
        if (typeof s.ui.css.activities !== "string") s.ui.css.activities = "";
        if (!s.ui.css.byTarget || typeof s.ui.css.byTarget !== "object") s.ui.css.byTarget = {};
        if (!s.ui.backgrounds || typeof s.ui.backgrounds !== "object") s.ui.backgrounds = {};
        if (!s.ui.appearance || typeof s.ui.appearance !== "object") s.ui.appearance = {};
        const ap = s.ui.appearance;
        if (typeof ap.fontFamily !== "string") ap.fontFamily = "";
        if (typeof ap.textColor !== "string") ap.textColor = "#e5e7eb";
        if (typeof ap.panelColor !== "string") ap.panelColor = "#050a13";
        if (typeof ap.inputColor !== "string") ap.inputColor = "#050a13";
        if (typeof ap.accentColor !== "string") ap.accentColor = "#cc7a2e";
        if (typeof ap.customCss !== "string") ap.customCss = "";
        if (typeof ap.mainLook !== "string") ap.mainLook = "";
        if (typeof ap.hamburgerLook !== "string") ap.hamburgerLook = "";
        if (typeof ap.modalLook !== "string") ap.modalLook = "";
        if (!ap.modalLooks || typeof ap.modalLooks !== "object") ap.modalLooks = {};
        const legacy = s.ui.style && typeof s.ui.style === "object" ? s.ui.style : null;
        if (legacy && ap.legacyStyleMigrated !== true) {
            ap.fontFamily = ap.fontFamily || String(legacy.fontFamily || "");
            if (legacy.textColor) ap.textColor = String(legacy.textColor);
            if (legacy.panelColor) ap.panelColor = String(legacy.panelColor);
            if (legacy.inputColor) ap.inputColor = String(legacy.inputColor);
            if (legacy.accentColor) ap.accentColor = String(legacy.accentColor);
            ap.customCss = ap.customCss || String(legacy.customCss || "");
            ap.mainLook = ap.mainLook || String(legacy.mainLook || "");
            ap.hamburgerLook = ap.hamburgerLook || String(legacy.hamburgerLook || "");
            ap.modalLook = ap.modalLook || String(legacy.modalLook || "");
            if (legacy.modalLooks && typeof legacy.modalLooks === "object") ap.modalLooks = { ...legacy.modalLooks, ...ap.modalLooks };
            ap.legacyStyleMigrated = true;
        }
        return s.ui;
    };

    const UI_LOOK_OPTIONS = [
        ["", "Use current look"],
        ["glass", "Glass"],
        ["parchment", "Parchment"],
        ["neon", "Neon"],
        ["academy", "Academy"],
        ["dark", "Dark Console"],
    ];

    const UI_MODAL_TARGETS = {
        all: ".modal-overlay .modal-card, .uie-overlay > .modal-card, .life-modal .box, .uie-map-modal__panel, .battle-result-card, [role='dialog']",
        settings: "#uie-settings-window",
        party: "#uie-party-window, #uie-party-member-card, #uie-party-node-modal .modal-card, #uie-party-tracker-modal .box",
        inventory: "#uie-inventory-window, #uie-class-reset-modal .uie-class-reset-box, #uie-rebirth-modal > div",
        social: "#uie-social-window, #uie-add-modal .modal-card, #group-scene-modal .modal-card, #scene-cards-modal .modal-card, #scene-card-action-modal .modal-card",
        phone: "#uie-phone-window, #computer-modal .modal-card, #image-gallery-modal .modal-card, #img-prompt-confirm-modal .modal-card",
        map: "#uie-map-window, .uie-map-modal__panel, #map-move-modal .modal-card, #edit-room-modal .modal-card",
        battle: "#battle-screen, .battle-result-card, #uie-battle-item-modal > div",
        character: "#persona-modal .modal-card, #uie-roster-modal .modal-card, #uie-npc-management-modal, #outfit-create-modal .modal-card",
    };

    const uiLookCss = (selector, look, options = {}) => {
        const target = String(selector || "").trim();
        const preset = String(look || "").trim().toLowerCase();
        if (!target || !preset) return "";
        const accent = String(options.accent || "#cc7a2e").trim() || "#cc7a2e";
        if (preset === "glass") {
            return `${target}{background:linear-gradient(145deg,rgba(14,21,34,.84),rgba(7,10,18,.92))!important;border-color:rgba(148,214,255,.30)!important;color:#edf7ff!important;box-shadow:0 24px 80px rgba(0,0,0,.52),inset 0 1px rgba(255,255,255,.12)!important;backdrop-filter:blur(4px)!important;}`;
        }
        if (preset === "parchment") {
            return `${target}{background:linear-gradient(145deg,#fff7df,#ead7a9)!important;border-color:rgba(107,75,32,.55)!important;color:#342512!important;box-shadow:0 20px 58px rgba(67,45,18,.32),inset 0 0 0 1px rgba(255,255,255,.52)!important;}`;
        }
        if (preset === "neon") {
            return `${target}{background:linear-gradient(150deg,rgba(5,10,24,.96),rgba(12,5,28,.94))!important;border-color:rgba(0,229,255,.45)!important;color:#e8fbff!important;box-shadow:0 0 0 1px rgba(0,229,255,.16),0 24px 80px rgba(0,0,0,.7),0 0 34px rgba(0,229,255,.18)!important;}`;
        }
        if (preset === "academy") {
            return `${target}{background:linear-gradient(150deg,rgba(31,39,55,.98),rgba(18,24,38,.96))!important;border-color:rgba(255,209,102,.34)!important;color:#f8f1df!important;box-shadow:0 22px 64px rgba(0,0,0,.58),inset 4px 0 0 ${accent}!important;}`;
        }
        if (preset === "dark") {
            return `${target}{background:linear-gradient(150deg,rgba(9,13,22,.98),rgba(3,7,15,.98))!important;border-color:rgba(148,163,184,.22)!important;color:#e5e7eb!important;box-shadow:0 24px 72px rgba(0,0,0,.72)!important;}`;
        }
        return "";
    };

    const populateUiLookSelects = () => {
        const ids = [
            "cfg-ui-main-look",
            "cfg-ui-hamburger-look",
            "cfg-ui-modal-look-all",
            "cfg-ui-modal-look-settings",
            "cfg-ui-modal-look-party",
            "cfg-ui-modal-look-inventory",
            "cfg-ui-modal-look-social",
            "cfg-ui-modal-look-phone",
            "cfg-ui-modal-look-map",
            "cfg-ui-modal-look-battle",
            "cfg-ui-modal-look-character",
        ];
        for (const id of ids) {
            const sel = document.getElementById(id);
            if (!sel || sel.options.length) continue;
            for (const [value, label] of UI_LOOK_OPTIONS) {
                const opt = document.createElement("option");
                opt.value = value;
                opt.textContent = label;
                sel.appendChild(opt);
            }
        }
    };

    const applyUiAppearanceFromSettings = () => {
        try {
            const s = getSettings();
            const ui = ensureUiCustomization(s);
            const ap = ui.appearance || {};
            const font = String(ap.fontFamily || "").trim();
            const text = String(ap.textColor || "#e5e7eb").trim() || "#e5e7eb";
            const panel = String(ap.panelColor || "#050a13").trim() || "#050a13";
            const input = String(ap.inputColor || "#050a13").trim() || "#050a13";
            const accent = String(ap.accentColor || "#cc7a2e").trim() || "#cc7a2e";
            const chunks = [
                `:root{--uie-user-text:${text};--uie-user-panel:${panel};--uie-user-input:${input};--uie-user-accent:${accent};}`,
                `body,.uie-window,.uie-modal,.modal-card,.modal-overlay,.uie-overlay,#uie-main-menu,#reply-menu-panel,#input-row,#message-box{color:var(--uie-user-text)!important;}`,
                font ? `body,.uie-window,.uie-modal,.modal-card,.modal-overlay,.uie-overlay,#uie-main-menu,#reply-menu-panel,button,input,select,textarea{font-family:${font}!important;}` : "",
                `#uie-settings-window input,#uie-settings-window select,#uie-settings-window textarea,.modal-input,.modal-select,.modal-textarea{background:var(--uie-user-input)!important;}`,
                `#uie-settings-window .uie-rpg-btn,.reply-tool-btn,.nav-btn,#send-btn,#q-menu-hamburger{border-color:color-mix(in srgb,var(--uie-user-accent),white 18%)!important;}`,
                uiLookCss(".uie-window,#reply-menu-panel,#input-row,#message-box", ap.mainLook, { accent }),
                uiLookCss("#uie-main-menu,#q-menu-hamburger", ap.hamburgerLook, { accent }),
                uiLookCss(UI_MODAL_TARGETS.all, ap.modalLook, { accent }),
            ];
            const scoped = ap.modalLooks && typeof ap.modalLooks === "object" ? ap.modalLooks : {};
            for (const [key, selector] of Object.entries(UI_MODAL_TARGETS)) {
                if (key === "all") continue;
                chunks.push(uiLookCss(selector, scoped[key], { accent }));
            }
            const custom = String(ap.customCss || "").trim();
            if (custom) chunks.push(custom);

            let styleEl = document.getElementById("uie-edit-ui-appearance-style");
            const finalCss = chunks.filter(Boolean).join("\n").trim();
            if (!finalCss) {
                if (styleEl) styleEl.remove();
                return;
            }
            if (!styleEl) {
                styleEl = document.createElement("style");
                styleEl.id = "uie-edit-ui-appearance-style";
                document.head.appendChild(styleEl);
            }
            styleEl.textContent = finalCss;
        } catch (err) {
            console.warn("[UIE] UI appearance apply failed:", err);
        }
    };

    const ensureNotificationsSettings = (s) => {
        if (!s.notifications || typeof s.notifications !== "object") s.notifications = {};
        const n = s.notifications;
        if (typeof n.css !== "string") n.css = "";
        if (!n.cssByCategory || typeof n.cssByCategory !== "object") n.cssByCategory = {};
        return n;
    };

    const ensureRpgToggleSettings = (s) => {
        if (!s.rpg || typeof s.rpg !== "object") s.rpg = {};
        const r = s.rpg;
        if (typeof r.enabled !== "boolean") r.enabled = false;
        if (typeof r.xpbar !== "boolean") r.xpbar = false;
        if (typeof r.equipment !== "boolean") r.equipment = false;
        if (typeof r.skills !== "boolean") r.skills = false;
        if (typeof r.party !== "boolean") r.party = false;
        if (typeof r.permadeath !== "boolean") r.permadeath = false;
        if (typeof r.taxSystemEnabled !== "boolean") r.taxSystemEnabled = false;
        if (typeof r.fantasyTaxEnabled !== "boolean") r.fantasyTaxEnabled = false;
        if (typeof r.cutscenesEnabled !== "boolean") r.cutscenesEnabled = true;
        if (typeof r.cutscenesAi !== "boolean") r.cutscenesAi = true;
        return r;
    };

    const ensureMemSettings = (s) => {
        if (!s.memory || typeof s.memory !== "object") s.memory = {};
        const m = s.memory;
        if (typeof m.auto !== "boolean") m.auto = false;
        return m;
    };

    const popupScopeToKey = (scopeRaw) => {
        const scope = String(scopeRaw || "global").trim().toLowerCase();
        return scope || "global";
    };

    const setPopupCssForScope = (s, scopeRaw, cssRaw) => {
        const n = ensureNotificationsSettings(s);
        const scope = popupScopeToKey(scopeRaw);
        const css = String(cssRaw || "").trim();
        if (scope === "global") {
            n.css = css;
            return;
        }
        if (!n.cssByCategory || typeof n.cssByCategory !== "object") n.cssByCategory = {};
        if (!css) delete n.cssByCategory[scope];
        else n.cssByCategory[scope] = css;
    };

    const popupScopeClass = (scopeRaw) => String(scopeRaw || "").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();

    const popupCssBlock = (scopeRaw, cssRaw) => {
        const scope = popupScopeToKey(scopeRaw);
        const css = String(cssRaw || "").trim();
        if (!css) return "";
        if (scope === "global") return css;
        if (/[{}]/.test(css)) return css;
        return `#toast-container .toast-uie-cat-${popupScopeClass(scope)} { ${css} }`;
    };

    const applyPopupCssFromSettings = () => {
        try {
            const s = getSettings();
            const n = ensureNotificationsSettings(s);
            const parts = [];
            const globalCss = popupCssBlock("global", n.css || "");
            if (globalCss) parts.push(globalCss);
            const scoped = n.cssByCategory && typeof n.cssByCategory === "object" ? n.cssByCategory : {};
            for (const [scope, raw] of Object.entries(scoped)) {
                const block = popupCssBlock(scope, raw);
                if (block) parts.push(block);
            }

            const finalCss = parts.join("\n\n").trim();
            let styleEl = document.getElementById("uie-popup-css-style");
            if (!finalCss) {
                if (styleEl) styleEl.remove();
                return;
            }
            if (!styleEl) {
                styleEl = document.createElement("style");
                styleEl.id = "uie-popup-css-style";
                document.head.appendChild(styleEl);
            }
            styleEl.textContent = finalCss;
        } catch (_) {}
    };

    const styleTargetSelectors = {
        menu: "#uie-main-menu",
        launcher: "#uie-launcher",
        settings: "#uie-settings-block",
        inventory: "#uie-inventory-window",
        items: "#uie-view-items",
        skills: "#uie-view-skills",
        assets: "#uie-view-assets",
        journal: "#uie-journal-window",
        diary: "#uie-diary-window",
        social: "#uie-social-window",
        you: "#uie-you-window",
        party: "#uie-party-window",
        phone: "#uie-phone-window",
        map: "#uie-map-window",
        calendar: "#uie-calendar-window",
        equipment: "#uie-view-equip",
        life: "#uie-view-life",
        create: "#uie-view-create",
        stats: "#uie-stats-window",
        activities: "#uie-activities-window",
    };

    const cssTargetSelectors = {
        global: "",
        menu: "#uie-main-menu",
        launcher: "#uie-launcher",
        settings: "#uie-settings-block",
        inventory: "#uie-inventory-window",
        items: "#uie-view-items",
        skills: "#uie-view-skills",
        assets: "#uie-view-assets",
        journal: "#uie-journal-window",
        diary: "#uie-diary-window",
        social: "#uie-social-window",
        you: "#uie-you-window",
        party: "#uie-party-window",
        phone: "#uie-phone-window",
        map: "#uie-map-window",
        calendar: "#uie-calendar-window",
        equipment: "#uie-view-equip",
        life: "#uie-view-life",
        create: "#uie-view-create",
        stats: "#uie-stats-window",
        activities: "#uie-activities-window",
    };

    const toScopedCss = (selector, cssRaw) => {
        const css = String(cssRaw || "").trim();
        if (!css) return "";
        if (!selector) return css;
        if (/[{}]/.test(css)) return css;
        return `${selector} { ${css} }`;
    };

    const applyCustomCssFromSettings = () => {
        try {
            const s = getSettings();
            const ui = ensureUiCustomization(s);
            const css = ui.css || {};
            const byTarget = css.byTarget && typeof css.byTarget === "object" ? css.byTarget : {};

            const parts = [];
            if (String(css.global || "").trim()) parts.push(String(css.global || ""));
            const statsBlock = toScopedCss("#uie-stats-window", css.stats || "");
            if (statsBlock) parts.push(statsBlock);
            const activitiesBlock = toScopedCss("#uie-activities-window", css.activities || "");
            if (activitiesBlock) parts.push(activitiesBlock);

            for (const [target, raw] of Object.entries(byTarget)) {
                const selector = cssTargetSelectors[String(target || "")] || "";
                const block = toScopedCss(selector, raw);
                if (block) parts.push(block);
            }

            const finalCss = parts.join("\n\n").trim();
            let styleEl = document.getElementById("uie-custom-css-style");
            if (!finalCss) {
                if (styleEl) styleEl.remove();
                return;
            }
            if (!styleEl) {
                styleEl = document.createElement("style");
                styleEl.id = "uie-custom-css-style";
                document.head.appendChild(styleEl);
            }
            styleEl.textContent = finalCss;
        } catch (_) {}
    };

    const applyBackgroundsFromSettings = () => {
        try {
            const s = getSettings();
            const ui = ensureUiCustomization(s);
            const bg = ui.backgrounds && typeof ui.backgrounds === "object" ? ui.backgrounds : {};
            for (const [target, selector] of Object.entries(styleTargetSelectors)) {
                const val = String(bg?.[target] || "").trim();
                if (!selector) continue;
                if (val) {
                    $(selector).css({
                        backgroundImage: `url("${val}")`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                    });
                } else {
                    $(selector).css({
                        backgroundImage: "",
                        backgroundSize: "",
                        backgroundPosition: "",
                        backgroundRepeat: "",
                    });
                }
            }
        } catch (_) {}
    };

    const syncPopupCssEditorFromScope = () => {
        try {
            const s = getSettings();
            const scope = String($("#uie-popup-css-scope").val() || "global");
            $("#uie-popup-css-text").val(getPopupCssForScope(s, scope));
        } catch (_) {}
    };

    const normalizeAudioProvider = (provider = "") => {
        const raw = String(provider || "").trim().toLowerCase();
        const aliases = {
            "alltalk xtts": "alltalk",
            "edge browser custom rvc": "edge_rvc",
            "edge-rvc": "edge_rvc",
            "edge": "edge_rvc",
            "rvc": "edge_rvc",
            "pocket-tts": "pocket",
        };
        const normalized = aliases[raw] || raw || "pocket";
        return ["pocket", "kokoro", "openai", "openrouter", "elevenlabs", "azure", "google", "alltalk", "edge_rvc", "custom"].includes(normalized) ? normalized : "pocket";
    };

    const ensureAudioSettings = (s) => {
        if (!s.audio || typeof s.audio !== "object") s.audio = {};
        s.audio.provider = normalizeAudioProvider(s.audio.provider);
        if (!s.audio.providers || typeof s.audio.providers !== "object") s.audio.providers = {};
        
        if (!s.audio.pocket || typeof s.audio.pocket !== "object") {
            s.audio.pocket = {
                url: "http://127.0.0.1:8101",
                voice: "alba",
                language: "english",
                reference: "",
                referenceText: "",
                refSeconds: 6,
                useReference: true
            };
        }
        if (!s.audio.kokoro || typeof s.audio.kokoro !== "object") {
            s.audio.kokoro = {
                voice: "af_heart",
                language: "english",
                speed: 1,
                genderBlend: 0.5,
                vibeBlend: 0.5
            };
        }
        return s.audio;
    };

    const syncAudioProviderPanels = () => {
        const provider = normalizeAudioProvider($("#cfg-audio-provider").val() || getSettings()?.audio?.provider || "openai");
        $("#cfg-audio-provider").val(provider);
        $(".cfg-tts-panel").removeClass("active").hide();
        $(`.cfg-tts-panel[data-tts-panel='${provider}']`).addClass("active").show();
    };

    const syncAudioSettingsUi = () => {
        try {
            const s = getSettings();
            const audio = ensureAudioSettings(s);
            const provider = normalizeAudioProvider(audio.provider);
            const providerData = audio.providers?.[provider] && typeof audio.providers[provider] === "object" ? audio.providers[provider] : {};
            $("#cfg-audio-enabled").prop("checked", audio.enabled !== false && audio.ttsEnabled !== false && String(audio.assignment || "").toLowerCase() !== "none");
            $("#cfg-audio-provider").val(provider);
            $("#cfg-audio-assignment").val(String(audio.assignment || "active"));
            $("#cfg-audio-url").val(String(audio.url || providerData.url || ""));
            $("#cfg-audio-key").val(String(audio.key || providerData.key || ""));
            $("#cfg-audio-model").val(String(audio.model || providerData.model || ""));
            $("#cfg-audio-voice").val(String(audio.voice || providerData.voice || ""));
            $("#cfg-audio-format").val(String(audio.format || providerData.format || "wav"));
            $("#cfg-audio-autoplay").prop("checked", audio.autoplay === true);

            // Pocket parameters
            $("#cfg-audio-pocket-url").val(String(audio.pocket?.url || providerData.url || ""));
            $("#cfg-audio-pocket-voice").val(String(audio.pocket?.voice || providerData.voice || "alba"));
            $("#cfg-audio-pocket-language").val(String(audio.pocket?.language || providerData.language || "english"));
            $("#cfg-audio-reference").val(String(audio.pocket?.reference || ""));
            $("#cfg-audio-reference-label").text(audio.pocket?.reference ? "Reference audio selected." : "No reference audio selected.");
            $("#cfg-audio-f5-ref-text").val(String(audio.pocket?.referenceText || ""));
            $("#cfg-audio-pocket-ref-seconds").val(String(audio.pocket?.refSeconds ?? 6));
            $("#cfg-audio-pocket-use-reference").prop("checked", audio.pocket?.useReference !== false);

            // Kokoro parameters
            $("#cfg-audio-kokoro-voice").val(String(audio.kokoro?.voice || "af_heart"));
            $("#cfg-audio-kokoro-language").val(String(audio.kokoro?.language || "english"));
            $("#cfg-audio-kokoro-speed").val(String(audio.kokoro?.speed || ""));
            $("#cfg-audio-kokoro-gender-blend").val(Number(audio.kokoro?.genderBlend ?? 0.5));
            $("#cfg-audio-kokoro-vibe-blend").val(Number(audio.kokoro?.vibeBlend ?? 0.5));

            if (String(audio.kokoro?.voice || "af_heart") === "custom") {
                $("#cfg-audio-kokoro-studio-gender-wrap, #cfg-audio-kokoro-studio-vibe-wrap").show();
            } else {
                $("#cfg-audio-kokoro-studio-gender-wrap, #cfg-audio-kokoro-studio-vibe-wrap").hide();
            }

            $("#cfg-audio-openai-model").val(String(audio.openai?.model || providerData.model || "gpt-4o-mini-tts"));
            $("#cfg-audio-openai-voice").val(String(audio.openai?.voice || providerData.voice || "marin"));
            $("#cfg-audio-openai-speed").val(String(audio.openai?.speed || ""));
            $("#cfg-audio-openai-instructions").val(String(audio.openai?.instructions || ""));

            $("#cfg-audio-openrouter-url").val(String(audio.openrouter?.url || providerData.url || "https://openrouter.ai/api/v1"));
            $("#cfg-audio-openrouter-model").val(String(audio.openrouter?.model || ""));
            $("#cfg-audio-openrouter-voice").val(String(audio.openrouter?.voice || ""));
            $("#cfg-audio-openrouter-speed").val(String(audio.openrouter?.speed || ""));

            $("#cfg-audio-eleven-model").val(String(audio.elevenlabs?.model || "eleven_multilingual_v2"));
            $("#cfg-audio-eleven-voice-id").val(String(audio.elevenlabs?.voiceId || ""));
            $("#cfg-audio-eleven-stability").val(String(audio.elevenlabs?.stability ?? ""));
            $("#cfg-audio-eleven-similarity").val(String(audio.elevenlabs?.similarityBoost ?? ""));
            $("#cfg-audio-eleven-style").val(String(audio.elevenlabs?.style ?? ""));
            $("#cfg-audio-eleven-speaker-boost").prop("checked", audio.elevenlabs?.speakerBoost === true);

            $("#cfg-audio-local-url").val(String(audio.alltalk?.url || ""));
            $("#cfg-audio-local-model").val(String(audio.alltalk?.model || ""));
            $("#cfg-audio-local-language").val(String(audio.alltalk?.language || "en"));
            $("#cfg-audio-local-voice").val(String(audio.alltalk?.voice || ""));
            $("#cfg-audio-local-streaming").prop("checked", audio.alltalk?.streaming === true);
            $("#cfg-audio-local-deepspeed").prop("checked", audio.alltalk?.deepspeed === true);

            $("#cfg-audio-azure-endpoint").val(String(audio.azure?.endpoint || ""));
            $("#cfg-audio-azure-region").val(String(audio.azure?.region || ""));
            $("#cfg-audio-azure-voice").val(String(audio.azure?.voice || ""));
            $("#cfg-audio-azure-language").val(String(audio.azure?.language || "en-US"));
            $("#cfg-audio-azure-style").val(String(audio.azure?.style || ""));
            $("#cfg-audio-azure-format").val(String(audio.azure?.format || ""));

            $("#cfg-audio-google-credentials").val(String(audio.google?.credentials || ""));
            $("#cfg-audio-google-project").val(String(audio.google?.project || ""));
            $("#cfg-audio-google-language").val(String(audio.google?.language || "en-US"));
            $("#cfg-audio-google-voice").val(String(audio.google?.voice || ""));
            $("#cfg-audio-google-encoding").val(String(audio.google?.encoding || "MP3"));
            $("#cfg-audio-google-rate").val(String(audio.google?.speakingRate || ""));
            $("#cfg-audio-google-pitch").val(String(audio.google?.pitch || ""));

            $("#cfg-audio-edge-voice").val(String(audio.edgeRvc?.voice || ""));
            $("#cfg-audio-speed").val(String(audio.edgeRvc?.rate || ""));
            $("#cfg-audio-pitch").val(String(audio.edgeRvc?.pitch || ""));
            $("#cfg-audio-edge-volume").val(String(audio.edgeRvc?.volume || ""));
            $("#cfg-audio-rvc-url").val(String(audio.edgeRvc?.rvcUrl || ""));
            $("#cfg-audio-rvc-model").val(String(audio.edgeRvc?.rvcModel || ""));
            $("#cfg-audio-rvc-index-rate").val(String(audio.edgeRvc?.indexRate || ""));

            $("#cfg-audio-custom-shape").val(String(audio.custom?.shape || "openai_speech"));
            $("#cfg-audio-custom-auth-header").val(String(audio.custom?.authHeader || "Authorization"));
            $("#cfg-audio-custom-headers").val(String(audio.custom?.headers || ""));
            syncAudioProviderPanels();
        } catch (_) {}
    };

    const readNumberOrString = (selector) => {
        const raw = String($(selector).val() ?? "").trim();
        if (!raw) return "";
        const n = Number(raw);
        return Number.isFinite(n) ? n : raw;
    };

    const saveAudioSettingsFromUi = () => {
        try {
            const s = getSettings();
            const audio = ensureAudioSettings(s);
            const provider = normalizeAudioProvider($("#cfg-audio-provider").val() || "pocket");
            audio.provider = provider;
            audio.enabled = $("#cfg-audio-enabled").prop("checked") === true;
            audio.ttsEnabled = audio.enabled;
            audio.assignment = String($("#cfg-audio-assignment").val() || "active");
            if (!audio.enabled) audio.assignment = "none";
            audio.url = String($("#cfg-audio-url").val() || "").trim();
            audio.key = String($("#cfg-audio-key").val() || "").trim();
            audio.model = String($("#cfg-audio-model").val() || "").trim();
            audio.voice = String($("#cfg-audio-voice").val() || "").trim();
            audio.format = String($("#cfg-audio-format").val() || "wav");
            audio.autoplay = $("#cfg-audio-autoplay").prop("checked") === true;

            audio.pocket = {
                url: String($("#cfg-audio-pocket-url").val() || "").trim(),
                voice: String($("#cfg-audio-pocket-voice").val() || "alba"),
                language: String($("#cfg-audio-pocket-language").val() || "english"),
                reference: String($("#cfg-audio-reference").val() || ""),
                referenceText: String($("#cfg-audio-f5-ref-text").val() || ""),
                refSeconds: Number($("#cfg-audio-pocket-ref-seconds").val() || 6),
                useReference: $("#cfg-audio-pocket-use-reference").prop("checked") === true,
            };
            audio.kokoro = {
                voice: String($("#cfg-audio-kokoro-voice").val() || "af_heart"),
                language: String($("#cfg-audio-kokoro-language").val() || "english"),
                speed: readNumberOrString("#cfg-audio-kokoro-speed"),
                genderBlend: Number($("#cfg-audio-kokoro-gender-blend").val() ?? 0.5),
                vibeBlend: Number($("#cfg-audio-kokoro-vibe-blend").val() ?? 0.5),
            };

            audio.openai = {
                model: String($("#cfg-audio-openai-model").val() || "gpt-4o-mini-tts"),
                voice: String($("#cfg-audio-openai-voice").val() || "marin"),
                speed: readNumberOrString("#cfg-audio-openai-speed"),
                instructions: String($("#cfg-audio-openai-instructions").val() || ""),
            };
            audio.openrouter = {
                url: String($("#cfg-audio-openrouter-url").val() || "https://openrouter.ai/api/v1"),
                model: String($("#cfg-audio-openrouter-model").val() || ""),
                voice: String($("#cfg-audio-openrouter-voice").val() || ""),
                speed: readNumberOrString("#cfg-audio-openrouter-speed"),
            };
            audio.elevenlabs = {
                model: String($("#cfg-audio-eleven-model").val() || "eleven_multilingual_v2"),
                voiceId: String($("#cfg-audio-eleven-voice-id").val() || ""),
                stability: readNumberOrString("#cfg-audio-eleven-stability"),
                similarityBoost: readNumberOrString("#cfg-audio-eleven-similarity"),
                style: readNumberOrString("#cfg-audio-eleven-style"),
                speakerBoost: $("#cfg-audio-eleven-speaker-boost").prop("checked") === true,
            };
            audio.alltalk = {
                url: String($("#cfg-audio-local-url").val() || ""),
                model: String($("#cfg-audio-local-model").val() || ""),
                language: String($("#cfg-audio-local-language").val() || "en"),
                voice: String($("#cfg-audio-local-voice").val() || ""),
                streaming: $("#cfg-audio-local-streaming").prop("checked") === true,
                deepspeed: $("#cfg-audio-local-deepspeed").prop("checked") === true,
            };
            audio.azure = {
                endpoint: String($("#cfg-audio-azure-endpoint").val() || ""),
                region: String($("#cfg-audio-azure-region").val() || ""),
                voice: String($("#cfg-audio-azure-voice").val() || ""),
                language: String($("#cfg-audio-azure-language").val() || "en-US"),
                style: String($("#cfg-audio-azure-style").val() || ""),
                format: String($("#cfg-audio-azure-format").val() || ""),
            };
            audio.google = {
                credentials: String($("#cfg-audio-google-credentials").val() || ""),
                project: String($("#cfg-audio-google-project").val() || ""),
                language: String($("#cfg-audio-google-language").val() || "en-US"),
                voice: String($("#cfg-audio-google-voice").val() || ""),
                encoding: String($("#cfg-audio-google-encoding").val() || "MP3"),
                speakingRate: readNumberOrString("#cfg-audio-google-rate"),
                pitch: readNumberOrString("#cfg-audio-google-pitch"),
            };
            audio.edgeRvc = {
                voice: String($("#cfg-audio-edge-voice").val() || ""),
                rate: String($("#cfg-audio-speed").val() || ""),
                pitch: String($("#cfg-audio-pitch").val() || ""),
                volume: String($("#cfg-audio-edge-volume").val() || ""),
                rvcUrl: String($("#cfg-audio-rvc-url").val() || ""),
                rvcModel: String($("#cfg-audio-rvc-model").val() || ""),
                indexRate: readNumberOrString("#cfg-audio-rvc-index-rate"),
            };
            audio.custom = {
                shape: String($("#cfg-audio-custom-shape").val() || "openai_speech"),
                authHeader: String($("#cfg-audio-custom-auth-header").val() || "Authorization"),
                headers: String($("#cfg-audio-custom-headers").val() || ""),
            };

            audio.providers[provider] = {
                url: audio.url,
                key: audio.key,
                model: audio.model,
                voice: audio.voice,
                format: audio.format,
            };
            saveSettings();
            syncAudioProviderPanels();
        } catch (_) {}
    };

    const syncKillSwitchUi = () => {
        try {
            const s = getSettings();
            const enabled = s.enabled !== false;
            $("#uie-setting-enable").prop("checked", enabled);

            const scanAll = s?.generation?.scanAllEnabled !== false;
            $("#uie-scanall-enable").prop("checked", scanAll);
            $("#uie-sw-scanall-enable").prop("checked", scanAll);

            const sysChecks = s?.generation?.allowSystemChecks === true;
            $("#uie-systemchecks-enable").prop("checked", sysChecks);
            $("#uie-sw-systemchecks-enable").prop("checked", sysChecks);

            const popups = s?.ui?.showPopups !== false;
            $("#uie-show-popups").prop("checked", popups);
        } catch (_) {}
    };

    const syncSettingsDrawerUi = () => {
        try {
            const s = getSettings();
            if (!s) return;

            if (!s.ui || typeof s.ui !== "object") s.ui = {};

            // AI allow toggles
            if (!s.ai || typeof s.ai !== "object") s.ai = {};
            $("#uie-ai-phone-browser").prop("checked", s.ai.phoneBrowser !== false);
            $("#uie-ai-phone-messages").prop("checked", s.ai.phoneMessages !== false);
            $("#uie-ai-phone-calls").prop("checked", s.ai.phoneCalls !== false);
            $("#uie-ai-app-builder").prop("checked", s.ai.appBuilder !== false);
            $("#uie-ai-books").prop("checked", s.ai.books !== false);
            $("#uie-ai-journal-quests").prop("checked", s.ai.journalQuestGen !== false);
            $("#uie-ai-databank").prop("checked", s.ai.databankScan !== false);
            $("#uie-ai-map").prop("checked", s.ai.map !== false);
            if ($("#uie-ai-shop").length) $("#uie-ai-shop").prop("checked", false);
            $("#uie-ai-loot").prop("checked", s.ai.loot !== false);
            $("#uie-sw-ai-phone-browser").prop("checked", s.ai.phoneBrowser !== false);
            $("#uie-sw-ai-phone-messages").prop("checked", s.ai.phoneMessages !== false);
            $("#uie-sw-ai-phone-calls").prop("checked", s.ai.phoneCalls !== false);
            $("#uie-sw-ai-app-builder").prop("checked", s.ai.appBuilder !== false);
            $("#uie-sw-ai-books").prop("checked", s.ai.books !== false);
            $("#uie-sw-ai-journal-quests").prop("checked", s.ai.journalQuestGen !== false);
            $("#uie-sw-ai-databank").prop("checked", s.ai.databankScan !== false);
            $("#uie-sw-ai-map").prop("checked", s.ai.map !== false);
            if ($("#uie-sw-ai-shop").length) $("#uie-sw-ai-shop").prop("checked", false);
            $("#uie-sw-ai-loot").prop("checked", s.ai.loot !== false);
            $("#uie-ai-journal-gen").prop("checked", s.ai.journalQuestGen !== false);
            $("#uie-ai-map-gen").prop("checked", s.ai.map !== false);

            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            $("#uie-gen-require-confirm").prop("checked", s.generation.requireConfirmUnverified === true);
            $("#uie-gen-show-prompt").prop("checked", s.generation.showPromptBox === true);
            $("#uie-ai-confirm-toggle").prop("checked", s.generation.aiConfirm === true);
            $("#uie-gen-scan-only-buttons").prop("checked", s.generation.scanOnlyOnGenerateButtons === true);

            const sysMinSec = Math.max(0, Math.round(Number(s.generation.systemCheckMinIntervalMs ?? 20000) / 1000));
            const autoMinSec = Math.max(0, Math.round(Number(s.generation.autoScanMinIntervalMs ?? 8000) / 1000));
            const $sys = $("#uie-gen-syscheck-min");
            if ($sys.length) $sys.val(String(Number.isFinite(sysMinSec) ? sysMinSec : 20));
            const $auto = $("#uie-gen-autoscan-min");
            if ($auto.length) $auto.val(String(Number.isFinite(autoMinSec) ? autoMinSec : 8));

            const $cs = $("#uie-gen-custom-system");
            if ($cs.length) $cs.val(String(s.generation.customSystemPrompt || ""));

            if (!s.features || typeof s.features !== "object") s.features = {};
            s.features.codexEnabled = true;
            $("#uie-feature-codex").prop("checked", true).prop("disabled", true);
            $("#uie-feature-codex-auto").prop("checked", s.features.codexAutoExtract === true);

            // Backups
            // (Buttons are stateless, nothing to sync)

            // Prompts
            const p = (s.generation.promptPrefixes && typeof s.generation.promptPrefixes === "object") ?
                 s.generation.promptPrefixes
                : (s.generation.promptPrefixes = { byType: {} });
            if (!p.byType || typeof p.byType !== "object") p.byType = {};
            $("#uie-gen-prompt-global").val(String(p.global || ""));
            $("#uie-gen-prompt-default").val(String(p.byType.default || ""));
            $("#uie-gen-prompt-webpage").val(String(p.byType.Webpage || ""));
            $("#uie-gen-prompt-systemcheck").val(String(p.byType["System Check"] || ""));
            $("#uie-gen-prompt-phonecall").val(String(p.byType["Phone Call"] || ""));
            $("#uie-gen-prompt-image").val(String(p.byType["Image Gen"] || ""));

            // Launcher Name
            $("#uie-launcher-name").val(s.launcher?.name || "");

            // Launcher Icon Select
            const lSrc = s.launcher?.src || "";
            const lSel = document.getElementById("uie-launcher-icon");
            if (lSel) {
                const has = Array.from(lSel.options).some(o => o.value === lSrc);
                lSel.value = has ? lSrc : "custom";
            }

            // Settings window: language + menu visibility + memory
            const langPref = String(s?.ui?.lang || "auto");
            const langSel = document.getElementById("uie-sw-lang-select");
            if (langSel) {
                const hasPref = Array.from(langSel.options || []).some((o) => String(o.value || "") === langPref);
                langSel.value = hasPref ? langPref : "auto";
            }
            $("#uie-set-currency-code").val(String(s.currencyCode || "CUSTOM"));
            $("#uie-set-currency-name").val(String(s.currencyName || getCurrencyPreset(s.currencyCode).name || "Currency"));
            $("#uie-set-currency-sym").val(String(s.currencySymbol || "G"));
            syncMenuVisibilityCheckboxes();
            const mem = ensureMemSettings(s);
            $("#uie-mem-auto").prop("checked", mem.auto === true);

            const rpg = ensureRpgToggleSettings(s);
            $("#uie-rpg-enable").prop("checked", rpg.enabled === true);
            $("#uie-rpg-xpbar").prop("checked", rpg.xpbar === true);
            $("#uie-rpg-equipment").prop("checked", rpg.equipment === true);
            $("#uie-rpg-skills").prop("checked", rpg.skills === true);
            $("#uie-rpg-party").prop("checked", rpg.party === true);
            $("#uie-check-permadeath").prop("checked", rpg.permadeath === true);
            $("#uie-rpg-tax-system").prop("checked", rpg.taxSystemEnabled === true);
            $("#uie-rpg-fantasy-tax").prop("checked", rpg.fantasyTaxEnabled === true);
            $("#uie-rpg-cutscenes-enabled").prop("checked", rpg.cutscenesEnabled !== false);
            $("#uie-rpg-cutscenes-ai").prop("checked", rpg.cutscenesAi !== false);

            // Popup settings
            const n = ensureNotificationsSettings(s);
            for (const [id, key] of Object.entries(POPUP_CATEGORY_BY_ID)) {
                const on = key === "lowHp" ?
                     n.lowHp?.enabled === true
                    : n.categories?.[key] !== false;
                $("#" + id).prop("checked", on);
            }
            const lowHpThreshold = Math.max(0.05, Math.min(0.9, Number(n.lowHp?.threshold || 0.25)));
            $("#uie-pop-lowhp-threshold").val(String(lowHpThreshold));
            const cssScopeEl = document.getElementById("uie-popup-css-scope");
            if (cssScopeEl && !String(cssScopeEl.value || "").trim()) cssScopeEl.value = "global";
            syncPopupCssEditorFromScope();
            applyPopupCssFromSettings();

            // Custom style/background settings
            const ui = ensureUiCustomization(s);
            populateUiLookSelects();
            const ap = ui.appearance || {};
            $("#cfg-ui-font-family").val(String(ap.fontFamily || ""));
            $("#cfg-ui-main-look").val(String(ap.mainLook || ""));
            $("#cfg-ui-hamburger-look").val(String(ap.hamburgerLook || ""));
            $("#cfg-ui-modal-look-all").val(String(ap.modalLook || ""));
            $("#cfg-ui-modal-look-settings").val(String(ap.modalLooks?.settings || ""));
            $("#cfg-ui-modal-look-party").val(String(ap.modalLooks?.party || ""));
            $("#cfg-ui-modal-look-inventory").val(String(ap.modalLooks?.inventory || ""));
            $("#cfg-ui-modal-look-social").val(String(ap.modalLooks?.social || ""));
            $("#cfg-ui-modal-look-phone").val(String(ap.modalLooks?.phone || ""));
            $("#cfg-ui-modal-look-map").val(String(ap.modalLooks?.map || ""));
            $("#cfg-ui-modal-look-battle").val(String(ap.modalLooks?.battle || ""));
            $("#cfg-ui-modal-look-character").val(String(ap.modalLooks?.character || ""));
            $("#cfg-ui-text-color").val(String(ap.textColor || "#e5e7eb"));
            $("#cfg-ui-panel-color").val(String(ap.panelColor || "#050a13"));
            $("#cfg-ui-input-color").val(String(ap.inputColor || "#050a13"));
            $("#cfg-ui-accent-color").val(String(ap.accentColor || "#cc7a2e"));
            $("#cfg-ui-custom-css").val(String(ap.customCss || ""));
            const cssTarget = String($("#uie-css-target").val() || "global");
            if (document.getElementById("uie-style-css")) {
                const cssByTarget = ui.css.byTarget && typeof ui.css.byTarget === "object" ? ui.css.byTarget : {};
                $("#uie-style-css").val(String(cssByTarget[cssTarget] || ""));
            }
            $("#uie-custom-css").val(String(ui.css.global || ""));
            $("#uie-custom-css-stats").val(String(ui.css.stats || ""));
            $("#uie-custom-css-activities").val(String(ui.css.activities || ""));
            const bgTarget = String($("#uie-bg-target").val() || "menu");
            if (document.getElementById("uie-bg-url")) {
                $("#uie-bg-url").val(String(ui.backgrounds?.[bgTarget] || ""));
            }
            applyCustomCssFromSettings();
            applyBackgroundsFromSettings();
            applyUiAppearanceFromSettings();

            // ComfyUI / Image Gen
            if (!s.image || typeof s.image !== "object") s.image = {};
            const img = s.image;
            $("#uie-img-enable, #uie-sw-img-enable").prop("checked", img.enabled === true);
            $("#uie-img-provider, #uie-sw-img-provider").val(img.provider || "openai");
            $("#uie-img-url, #uie-sw-img-url").val(String(img.url || ""));
            $("#uie-img-key, #uie-sw-img-key").val(String(img.key || ""));
            $("#uie-img-model, #uie-sw-img-model").val(String(img.model || ""));
            $("#uie-img-size, #uie-sw-img-size").val(img.size || "1024x1024");

            // Show/Hide blocks (game.html may save comfyui / automatic1111 / sdnext)
            const prov = String(img.provider || "openai").toLowerCase();
            const isComfy = prov === "comfy" || prov === "comfyui";
            const isSd = prov === "sdwebui" || prov === "automatic1111" || prov === "sdnext";
            $("#uie-img-comfy-block, #uie-sw-img-comfy-block").toggle(isComfy);
            $("#uie-img-sdwebui-block, #uie-sw-img-sdwebui-block").toggle(isSd);
            $("#uie-img-openai-block, #uie-sw-img-openai-block").toggle(!isComfy && !isSd);

            if (img.comfy && typeof img.comfy === "object") {
                $("#uie-img-comfy-base").val(img.comfy.base || "");
                $("#uie-img-comfy-key").val(img.comfy.key || "");
                $("#uie-img-comfy-workflow").val(img.comfy.workflow || "");
                $("#uie-img-comfy-posnode").val(img.comfy.positiveNodeId || "");
                $("#uie-img-comfy-negnode").val(img.comfy.negativeNodeId || "");
                $("#uie-img-comfy-outnode").val(img.comfy.outputNodeId || "");
            }

            const feats = (img.features && typeof img.features === "object") ? img.features : {};
            $("#uie-img-map, #uie-sw-img-map").prop("checked", feats.map !== false);
            $("#uie-img-doll, #uie-sw-img-doll").prop("checked", feats.doll !== false);
            $("#uie-img-social, #uie-sw-img-social").prop("checked", feats.social !== false);
            $("#uie-img-phone-bg, #uie-sw-img-phone-bg").prop("checked", feats.phoneBg !== false);
            $("#uie-img-msg, #uie-sw-img-msg").prop("checked", feats.msg !== false);
            $("#uie-img-party, #uie-sw-img-party").prop("checked", feats.party !== false);
            $("#uie-img-items, #uie-sw-img-items").prop("checked", feats.items !== false);

            syncAudioSettingsUi();

            // VN Dialogue Box Settings sync
            if (!s.ui.vnBox || typeof s.ui.vnBox !== "object") s.ui.vnBox = {};
            const vnB = s.ui.vnBox;
            const fSize = vnB.fontSize || 16;
            const opac = vnB.opacity !== undefined ? vnB.opacity : 0.78;
            const hght = vnB.height || 140;
            const fFam = vnB.fontFamily || "sans-serif";

            $("#uie-vnbox-fontsize").val(fSize);
            $("#uie-vnbox-fontsize-val").text(fSize + "px");
            $("#uie-vnbox-opacity").val(opac);
            $("#uie-vnbox-opacity-val").text(Number(opac).toFixed(2));
            $("#uie-vnbox-height").val(hght);
            $("#uie-vnbox-height-val").text(hght + "px");
            $("#uie-vnbox-fontfamily").val(fFam);

        } catch (_) {}
    };

    // Sync when the settings drawer is interacted with.
    // Use body delegation to ensure we catch it.
    $("body").off("click.uieSettingsDrawerSync").on("click.uieSettingsDrawerSync", ".uie-settings-block .inline-drawer-toggle", function () {
        setTimeout(() => { try { syncKillSwitchUi(); } catch (_) {} }, 40);
        setTimeout(() => { try { syncSettingsDrawerUi(); } catch (_) {} }, 60);
    });

    // Also sync shortly after init.
    setTimeout(() => { try { syncKillSwitchUi(); } catch (_) {} }, 900);
    setTimeout(() => { try { syncSettingsDrawerUi(); } catch (_) {} try { applyUiAppearanceFromSettings(); } catch (_) {} }, 950);

    $(document)
        .off("change.uieAudioProvider")
        .on("change.uieAudioProvider", "#cfg-audio-provider", function () {
            syncAudioProviderPanels();
            saveAudioSettingsFromUi();
        })
        .off("change.uieAudioReferenceFile", "#cfg-audio-reference-file")
        .on("change.uieAudioReferenceFile", "#cfg-audio-reference-file", function () {
            const file = this.files && this.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                $("#cfg-audio-reference").val(String(reader.result || ""));
                $("#cfg-audio-reference-label").text(file.name || "Reference audio selected.");
                saveAudioSettingsFromUi();
            };
            reader.onerror = () => $("#cfg-audio-reference-label").text("Could not read reference audio.");
            reader.readAsDataURL(file);
        })
        .off("change.uieAudioKokoroVoice", "#cfg-audio-kokoro-voice")
        .on("change.uieAudioKokoroVoice", "#cfg-audio-kokoro-voice", function () {
            const val = $(this).val();
            if (val === "custom") {
                $("#cfg-audio-kokoro-studio-gender-wrap, #cfg-audio-kokoro-studio-vibe-wrap").show();
            } else {
                $("#cfg-audio-kokoro-studio-gender-wrap, #cfg-audio-kokoro-studio-vibe-wrap").hide();
                if (val === "am_adam") {
                    $("#cfg-audio-kokoro-gender-blend").val(0);
                    $("#cfg-audio-kokoro-vibe-blend").val(0);
                } else if (val === "af_heart") {
                    $("#cfg-audio-kokoro-gender-blend").val(1);
                    $("#cfg-audio-kokoro-vibe-blend").val(0.3);
                } else if (val === "af_sky") {
                    $("#cfg-audio-kokoro-gender-blend").val(1);
                    $("#cfg-audio-kokoro-vibe-blend").val(0);
                } else if (val === "af_bella") {
                    $("#cfg-audio-kokoro-gender-blend").val(1);
                    $("#cfg-audio-kokoro-vibe-blend").val(1);
                }
            }
            saveAudioSettingsFromUi();
        })
        .off("input.uieAudioKokoroBlend change.uieAudioKokoroBlend", "#cfg-audio-kokoro-gender-blend, #cfg-audio-kokoro-vibe-blend")
        .on("input.uieAudioKokoroBlend change.uieAudioKokoroBlend", "#cfg-audio-kokoro-gender-blend, #cfg-audio-kokoro-vibe-blend", function() {
            $("#cfg-audio-kokoro-voice").val("custom");
            saveAudioSettingsFromUi();
        })
        .off("input.uieAudioSettings change.uieAudioSettings")
        .on("input.uieAudioSettings change.uieAudioSettings", [
            "#cfg-audio-enabled",
            "#cfg-audio-assignment",
            "#cfg-audio-url",
            "#cfg-audio-key",
            "#cfg-audio-model",
            "#cfg-audio-voice",
            "#cfg-audio-format",
            "#cfg-audio-pocket-url",
            "#cfg-audio-pocket-voice",
            "#cfg-audio-pocket-language",
            "#cfg-audio-pocket-ref-seconds",
            "#cfg-audio-pocket-use-reference",
            "#cfg-audio-f5-ref-text",
            "#cfg-audio-kokoro-voice",
            "#cfg-audio-kokoro-language",
            "#cfg-audio-kokoro-speed",
            "#cfg-audio-kokoro-gender-blend",
            "#cfg-audio-kokoro-vibe-blend",
            "#cfg-audio-openai-model",
            "#cfg-audio-openai-voice",
            "#cfg-audio-openai-speed",
            "#cfg-audio-openai-instructions",
            "#cfg-audio-openrouter-url",
            "#cfg-audio-openrouter-model",
            "#cfg-audio-openrouter-voice",
            "#cfg-audio-openrouter-speed",
            "#cfg-audio-eleven-model",
            "#cfg-audio-eleven-voice-id",
            "#cfg-audio-eleven-stability",
            "#cfg-audio-eleven-similarity",
            "#cfg-audio-eleven-style",
            "#cfg-audio-eleven-speaker-boost",
            "#cfg-audio-local-url",
            "#cfg-audio-local-model",
            "#cfg-audio-local-language",
            "#cfg-audio-local-voice",
            "#cfg-audio-local-streaming",
            "#cfg-audio-local-deepspeed",
            "#cfg-audio-azure-endpoint",
            "#cfg-audio-azure-region",
            "#cfg-audio-azure-voice",
            "#cfg-audio-azure-language",
            "#cfg-audio-azure-style",
            "#cfg-audio-azure-format",
            "#cfg-audio-google-credentials",
            "#cfg-audio-google-project",
            "#cfg-audio-google-language",
            "#cfg-audio-google-voice",
            "#cfg-audio-google-encoding",
            "#cfg-audio-google-rate",
            "#cfg-audio-google-pitch",
            "#cfg-audio-edge-voice",
            "#cfg-audio-speed",
            "#cfg-audio-pitch",
            "#cfg-audio-edge-volume",
            "#cfg-audio-rvc-url",
            "#cfg-audio-rvc-model",
            "#cfg-audio-rvc-index-rate",
            "#cfg-audio-custom-shape",
            "#cfg-audio-custom-auth-header",
            "#cfg-audio-custom-headers",
            "#cfg-audio-autoplay",
        ].join(", "), saveAudioSettingsFromUi);


    const setEnabled = (on) => {
        const s = getSettings();
        s.enabled = on === true;
        saveSettings();
        if (s.enabled === false) {
            try { $("#uie-main-menu").hide(); } catch (_) {}
            try { $(".uie-window, .uie-overlay, .uie-modal, .uie-full-modal").hide(); } catch (_) {}
            try { $("#uie-launcher").hide(); } catch (_) {}
        } else {
            try { $("#uie-launcher").css("display", "flex"); } catch (_) {}
        }
        try { updateLayout(); } catch (_) {}
    };

    const setScanAll = (on) => {
        const s = getSettings();
        if (!s.generation || typeof s.generation !== "object") s.generation = {};
        s.generation.scanAllEnabled = on === true;
        saveSettings();
    };

    const setSystemChecks = (on) => {
        const s = getSettings();
        if (!s.generation || typeof s.generation !== "object") s.generation = {};
        s.generation.allowSystemChecks = on === true;
        saveSettings();
    };

    const setPopups = (on) => {
        const s = getSettings();
        if (!s.ui || typeof s.ui !== "object") s.ui = {};
        s.ui.showPopups = on === true;
        saveSettings();
        $("[id='uie-show-popups']").prop("checked", on === true);
    };

    const aiSelectorsByKey = {
        phoneBrowser: "#uie-ai-phone-browser, #uie-sw-ai-phone-browser",
        phoneMessages: "#uie-ai-phone-messages, #uie-sw-ai-phone-messages",
        phoneCalls: "#uie-ai-phone-calls, #uie-sw-ai-phone-calls",
        appBuilder: "#uie-ai-app-builder, #uie-sw-ai-app-builder",
        books: "#uie-ai-books, #uie-sw-ai-books",
        journalQuestGen: "#uie-ai-journal-quests, #uie-sw-ai-journal-quests, #uie-ai-journal-gen",
        databankScan: "#uie-ai-databank, #uie-sw-ai-databank",
        map: "#uie-ai-map, #uie-sw-ai-map, #uie-ai-map-gen",
        loot: "#uie-ai-loot, #uie-sw-ai-loot",
    };

    const setAiAllow = (key, checked) => {
        const s = getSettings();
        if (!s.ai || typeof s.ai !== "object") s.ai = {};
        s.ai[key] = checked === true;
        saveSettings();
        const sel = aiSelectorsByKey[key];
        if (sel) $(sel).prop("checked", checked === true);
    };

    const setGenFlag = (key, checked) => {
        const s = getSettings();
        if (!s.generation || typeof s.generation !== "object") s.generation = {};
        s.generation[key] = checked === true;
        saveSettings();
    };

    const setGenNumberMs = (key, value) => {
        const s = getSettings();
        if (!s.generation || typeof s.generation !== "object") s.generation = {};
        const raw = Number(value);
        const sec = Number.isFinite(raw) ? Math.max(0, raw) : 0;
        s.generation[key] = Math.round(sec * 1000);
        saveSettings();
    };

    // Kill Switch Handlers - DELEGATED to BODY to ensure they catch clicks even if re-rendered
    $("body")
        .off("change.uieKillEnable")
        .on("change.uieKillEnable", "#uie-setting-enable", function (e) {
            e.preventDefault();
            e.stopPropagation();
            setEnabled($(this).prop("checked") === true);
        })
        .off("change.uieKillScanAll")
        .on("change.uieKillScanAll", "#uie-scanall-enable, #uie-sw-scanall-enable, #uie-wand-scanall-enable", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const on = $(this).prop("checked") === true;
            setScanAll(on);
            // Sync all checkboxes
            $("#uie-scanall-enable").prop("checked", on);
            $("#uie-sw-scanall-enable").prop("checked", on);
            $("#uie-wand-scanall-enable").prop("checked", on);
        })
        .off("change.uieKillSysChecks")
        .on("change.uieKillSysChecks", "#uie-systemchecks-enable, #uie-sw-systemchecks-enable, #uie-wand-systemchecks-enable", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const on = $(this).prop("checked") === true;
            setSystemChecks(on);
            $("#uie-systemchecks-enable").prop("checked", on);
            $("#uie-sw-systemchecks-enable").prop("checked", on);
            $("#uie-wand-systemchecks-enable").prop("checked", on);
        })
        .off("change.uieKillPopups")
        .on("change.uieKillPopups", "#uie-show-popups", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const on = $(this).prop("checked") === true;
            setPopups(on);
        });

    $(document)
        .off("change.uieAiAllowPhoneBrowser")
        .on("change.uieAiAllowPhoneBrowser", "#uie-ai-phone-browser, #uie-sw-ai-phone-browser", function () { setAiAllow("phoneBrowser", $(this).prop("checked") === true); })
        .off("change.uieAiAllowPhoneMessages")
        .on("change.uieAiAllowPhoneMessages", "#uie-ai-phone-messages, #uie-sw-ai-phone-messages", function () { setAiAllow("phoneMessages", $(this).prop("checked") === true); })
        .off("change.uieAiAllowPhoneCalls")
        .on("change.uieAiAllowPhoneCalls", "#uie-ai-phone-calls, #uie-sw-ai-phone-calls", function () { setAiAllow("phoneCalls", $(this).prop("checked") === true); })
        .off("change.uieAiAllowAppBuilder")
        .on("change.uieAiAllowAppBuilder", "#uie-ai-app-builder, #uie-sw-ai-app-builder", function () { setAiAllow("appBuilder", $(this).prop("checked") === true); })
        .off("change.uieAiAllowBooks")
        .on("change.uieAiAllowBooks", "#uie-ai-books, #uie-sw-ai-books", function () { setAiAllow("books", $(this).prop("checked") === true); })
        .off("change.uieAiAllowJournalQuests")
        .on("change.uieAiAllowJournalQuests", "#uie-ai-journal-quests, #uie-sw-ai-journal-quests, #uie-ai-journal-gen", function () { setAiAllow("journalQuestGen", $(this).prop("checked") === true); })
        .off("change.uieAiAllowDatabank")
        .on("change.uieAiAllowDatabank", "#uie-ai-databank, #uie-sw-ai-databank", function () { setAiAllow("databankScan", $(this).prop("checked") === true); })
        .off("change.uieAiAllowMap")
        .on("change.uieAiAllowMap", "#uie-ai-map, #uie-sw-ai-map, #uie-ai-map-gen", function () { setAiAllow("map", $(this).prop("checked") === true); })
        .off("change.uieAiAllowLoot")
        .on("change.uieAiAllowLoot", "#uie-ai-loot, #uie-sw-ai-loot", function () { setAiAllow("loot", $(this).prop("checked") === true); })
        .off("change.uieGenRequireConfirm")
        .on("change.uieGenRequireConfirm", "#uie-gen-require-confirm", function () { setGenFlag("requireConfirmUnverified", $(this).prop("checked") === true); })
        .off("change.uieGenShowPrompt")
        .on("change.uieGenShowPrompt", "#uie-gen-show-prompt", function () { setGenFlag("showPromptBox", $(this).prop("checked") === true); })
        .off("change.uieAiConfirm")
        .on("change.uieAiConfirm", "#uie-ai-confirm-toggle", function () { setGenFlag("aiConfirm", $(this).prop("checked") === true); })
        .off("change.uieScanOnlyButtons")
        .on("change.uieScanOnlyButtons", "#uie-gen-scan-only-buttons", function () { setGenFlag("scanOnlyOnGenerateButtons", $(this).prop("checked") === true); })
        .off("input.uieSyscheckMin change.uieSyscheckMin")
        .on("input.uieSyscheckMin change.uieSyscheckMin", "#uie-gen-syscheck-min", function () { setGenNumberMs("systemCheckMinIntervalMs", $(this).val()); })
        .off("input.uieAutoScanMin change.uieAutoScanMin")
        .on("input.uieAutoScanMin change.uieAutoScanMin", "#uie-gen-autoscan-min", function () { setGenNumberMs("autoScanMinIntervalMs", $(this).val()); })
        .off("input.uieCustomSystem change.uieCustomSystem")
        .on("input.uieCustomSystem change.uieCustomSystem", "#uie-gen-custom-system", function () {
            const s = getSettings();
            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            s.generation.customSystemPrompt = String($(this).val() || "");
            saveSettings();
        })
        .off("change.uieFeatureCodex")
        .on("change.uieFeatureCodex", "#uie-feature-codex", function () {
            const s = getSettings();
            if (!s.features || typeof s.features !== "object") s.features = {};
            s.features.codexEnabled = true;
            $(this).prop("checked", true).prop("disabled", true);
            saveSettings();
        })
        .off("change.uieFeatureCodexAuto")
        .on("change.uieFeatureCodexAuto", "#uie-feature-codex-auto", function () {
            const s = getSettings();
            if (!s.features || typeof s.features !== "object") s.features = {};
            s.features.codexAutoExtract = $(this).prop("checked") === true;
            saveSettings();
        })
        .off("input.uiePromptGlobal change.uiePromptGlobal")
        .on("input.uiePromptGlobal change.uiePromptGlobal", "#uie-gen-prompt-global", function () {
            const s = getSettings();
            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            if (!s.generation.promptPrefixes || typeof s.generation.promptPrefixes !== "object") s.generation.promptPrefixes = { byType: {} };
            s.generation.promptPrefixes.global = String($(this).val() || "");
            saveSettings();
        })
        .off("input.uiePromptDefault change.uiePromptDefault")
        .on("input.uiePromptDefault change.uiePromptDefault", "#uie-gen-prompt-default", function () {
            const s = getSettings();
            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            if (!s.generation.promptPrefixes || typeof s.generation.promptPrefixes !== "object") s.generation.promptPrefixes = { byType: {} };
            if (!s.generation.promptPrefixes.byType || typeof s.generation.promptPrefixes.byType !== "object") s.generation.promptPrefixes.byType = {};
            s.generation.promptPrefixes.byType.default = String($(this).val() || "");
            saveSettings();
        })
        .off("input.uiePromptWebpage change.uiePromptWebpage")
        .on("input.uiePromptWebpage change.uiePromptWebpage", "#uie-gen-prompt-webpage", function () {
            const s = getSettings();
            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            if (!s.generation.promptPrefixes || typeof s.generation.promptPrefixes !== "object") s.generation.promptPrefixes = { byType: {} };
            if (!s.generation.promptPrefixes.byType || typeof s.generation.promptPrefixes.byType !== "object") s.generation.promptPrefixes.byType = {};
            s.generation.promptPrefixes.byType.Webpage = String($(this).val() || "");
            saveSettings();
        })
        .off("input.uiePromptSysCheck change.uiePromptSysCheck")
        .on("input.uiePromptSysCheck change.uiePromptSysCheck", "#uie-gen-prompt-systemcheck", function () {
            const s = getSettings();
            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            if (!s.generation.promptPrefixes || typeof s.generation.promptPrefixes !== "object") s.generation.promptPrefixes = { byType: {} };
            if (!s.generation.promptPrefixes.byType || typeof s.generation.promptPrefixes.byType !== "object") s.generation.promptPrefixes.byType = {};
            s.generation.promptPrefixes.byType["System Check"] = String($(this).val() || "");
            saveSettings();
        })
        .off("input.uiePromptPhoneCall change.uiePromptPhoneCall")
        .on("input.uiePromptPhoneCall change.uiePromptPhoneCall", "#uie-gen-prompt-phonecall", function () {
            const s = getSettings();
            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            if (!s.generation.promptPrefixes || typeof s.generation.promptPrefixes !== "object") s.generation.promptPrefixes = { byType: {} };
            if (!s.generation.promptPrefixes.byType || typeof s.generation.promptPrefixes.byType !== "object") s.generation.promptPrefixes.byType = {};
            s.generation.promptPrefixes.byType["Phone Call"] = String($(this).val() || "");
            saveSettings();
        })
        .off("input.uiePromptImage change.uiePromptImage")
        .on("input.uiePromptImage change.uiePromptImage", "#uie-gen-prompt-image", function () {
            const s = getSettings();
            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            if (!s.generation.promptPrefixes || typeof s.generation.promptPrefixes !== "object") s.generation.promptPrefixes = { byType: {} };
            if (!s.generation.promptPrefixes.byType || typeof s.generation.promptPrefixes.byType !== "object") s.generation.promptPrefixes.byType = {};
            s.generation.promptPrefixes.byType["Image Gen"] = String($(this).val() || "");
            saveSettings();
        });

    const menuVisibilitySelector = Object.keys(getMenuVisibilityMap()).map((id) => `#${id}`).join(", ");
    const popupToggleSelector = Object.keys(POPUP_CATEGORY_BY_ID).map((id) => `#${id}`).join(", ");
    let styleCssWriteTimer = 0;

    $(document)
        .off("change.uieMenuVisibilitySave")
        .on("change.uieMenuVisibilitySave", menuVisibilitySelector, function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const id = String(this?.id || "");
            const key = getMenuVisibilityMap()[id];
            if (!key) return;
            const s = getSettings();
            if (!s.menuHidden || typeof s.menuHidden !== "object") s.menuHidden = {};
            s.menuHidden[key] = $(this).prop("checked") === true;
            saveSettings();
            try { applyMenuHiddenToButtons(); } catch (_) {}
            try { syncMenuVisibilityCheckboxes(); } catch (_) {}
        })
        .off("change.uieMemAutoSave")
        .on("change.uieMemAutoSave", "#uie-mem-auto", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            const mem = ensureMemSettings(s);
            mem.auto = $(this).prop("checked") === true;
            saveSettings();
        })
        .off("change.uieLangSelect")
        .on("change.uieLangSelect", "#uie-sw-lang-select", async function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const lang = String($(this).val() || "auto").trim() || "auto";
            try {
                const i18n = await import("./i18n.js");
                if (typeof i18n?.setLang === "function") i18n.setLang(lang);
                i18n?.applyI18n?.(document);
            } catch (_) {
                const s = getSettings();
                if (!s.ui || typeof s.ui !== "object") s.ui = {};
                s.ui.lang = lang;
                saveSettings();
            }
        })
        .off("click.uieCurrencySettingsSave")
        .on("click.uieCurrencySettingsSave", "#uie-currency-save-btn", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            const code = String($("#uie-set-currency-code").val() || "CUSTOM").trim() || "CUSTOM";
            const name = String($("#uie-set-currency-name").val() || "").trim();
            const sym = String($("#uie-set-currency-sym").val() || "").trim() || "G";
            const rate = 0;
            applyCurrencySettings(s, { code, name, symbol: sym, rate });
            saveSettings();
            try { updateLayout(); } catch (_) {}
            try { notify("success", "Economy settings saved.", "Settings", "currency"); } catch (_) {}
        })
        .off("change.uieCurrencyPreset")
        .on("change.uieCurrencyPreset", "#uie-set-currency-code", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const preset = getCurrencyPreset($(this).val());
            if (preset.code !== "CUSTOM") {
                $("#uie-set-currency-name").val(preset.name);
                $("#uie-set-currency-sym").val(preset.symbol);
            }
        })
        .off("change.uieRpgToggles")
        .on("change.uieRpgToggles", "#uie-rpg-enable, #uie-rpg-xpbar, #uie-rpg-equipment, #uie-rpg-skills, #uie-rpg-party, #uie-check-permadeath, #uie-rpg-tax-system, #uie-rpg-fantasy-tax, #uie-rpg-cutscenes-enabled, #uie-rpg-cutscenes-ai", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const id = String(this?.id || "");
            const on = $(this).prop("checked") === true;
            const s = getSettings();
            const rpg = ensureRpgToggleSettings(s);
            if (id === "uie-rpg-enable") rpg.enabled = on;
            if (id === "uie-rpg-xpbar") rpg.xpbar = on;
            if (id === "uie-rpg-equipment") rpg.equipment = on;
            if (id === "uie-rpg-skills") rpg.skills = on;
            if (id === "uie-rpg-party") rpg.party = on;
            if (id === "uie-check-permadeath") rpg.permadeath = on;
            if (id === "uie-rpg-tax-system") rpg.taxSystemEnabled = on;
            if (id === "uie-rpg-fantasy-tax") rpg.fantasyTaxEnabled = on;
            if (id === "uie-rpg-cutscenes-enabled") rpg.cutscenesEnabled = on;
            if (id === "uie-rpg-cutscenes-ai") rpg.cutscenesAi = on;
            saveSettings();
        })
        .off("change.uiePopupToggles")
        .on("change.uiePopupToggles", popupToggleSelector, function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const id = String(this?.id || "");
            const key = POPUP_CATEGORY_BY_ID[id];
            if (!key) return;
            const on = $(this).prop("checked") === true;
            const s = getSettings();
            const n = ensureNotificationsSettings(s);
            if (key === "lowHp") n.lowHp.enabled = on;
            else n.categories[key] = on;
            saveSettings();
        })
        .off("input.uieLowHpThreshold change.uieLowHpThreshold")
        .on("input.uieLowHpThreshold change.uieLowHpThreshold", "#uie-pop-lowhp-threshold", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            const n = ensureNotificationsSettings(s);
            const raw = Number($(this).val());
            const threshold = Math.max(0.05, Math.min(0.9, Number.isFinite(raw) ? raw : 0.25));
            n.lowHp.threshold = Math.round(threshold * 100) / 100;
            $(this).val(String(n.lowHp.threshold));
            saveSettings();
        })
        .off("change.uiePopupCssScope")
        .on("change.uiePopupCssScope", "#uie-popup-css-scope", function () {
            syncPopupCssEditorFromScope();
        })
        .off("click.uiePopupCssApply")
        .on("click.uiePopupCssApply", "#uie-popup-css-apply", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            const scope = String($("#uie-popup-css-scope").val() || "global");
            const css = String($("#uie-popup-css-text").val() || "");
            setPopupCssForScope(s, scope, css);
            saveSettings();
            applyPopupCssFromSettings();
        })
        .off("click.uiePopupCssReset")
        .on("click.uiePopupCssReset", "#uie-popup-css-reset", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            const scope = String($("#uie-popup-css-scope").val() || "global");
            setPopupCssForScope(s, scope, "");
            saveSettings();
            syncPopupCssEditorFromScope();
            applyPopupCssFromSettings();
        })
        .off("click.uiePopupCssTest")
        .on("click.uiePopupCssTest", "#uie-popup-test", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const scope = popupScopeToKey($("#uie-popup-css-scope").val() || "global");
            const category = scope === "global" ? "api" : scope;
            try { notify("info", "Popup style test", "UIE", category); } catch (_) {}
        })
        .off("input.uieEditUiAppearance change.uieEditUiAppearance")
        .on("input.uieEditUiAppearance change.uieEditUiAppearance", "#cfg-ui-font-family, #cfg-ui-main-look, #cfg-ui-hamburger-look, #cfg-ui-modal-look-all, #cfg-ui-modal-look-settings, #cfg-ui-modal-look-party, #cfg-ui-modal-look-inventory, #cfg-ui-modal-look-social, #cfg-ui-modal-look-phone, #cfg-ui-modal-look-map, #cfg-ui-modal-look-battle, #cfg-ui-modal-look-character, #cfg-ui-text-color, #cfg-ui-panel-color, #cfg-ui-input-color, #cfg-ui-accent-color, #cfg-ui-custom-css", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            const ui = ensureUiCustomization(s);
            const ap = ui.appearance;
            ap.fontFamily = String($("#cfg-ui-font-family").val() || "");
            ap.mainLook = String($("#cfg-ui-main-look").val() || "");
            ap.hamburgerLook = String($("#cfg-ui-hamburger-look").val() || "");
            ap.modalLook = String($("#cfg-ui-modal-look-all").val() || "");
            if (!ap.modalLooks || typeof ap.modalLooks !== "object") ap.modalLooks = {};
            ap.modalLooks.settings = String($("#cfg-ui-modal-look-settings").val() || "");
            ap.modalLooks.party = String($("#cfg-ui-modal-look-party").val() || "");
            ap.modalLooks.inventory = String($("#cfg-ui-modal-look-inventory").val() || "");
            ap.modalLooks.social = String($("#cfg-ui-modal-look-social").val() || "");
            ap.modalLooks.phone = String($("#cfg-ui-modal-look-phone").val() || "");
            ap.modalLooks.map = String($("#cfg-ui-modal-look-map").val() || "");
            ap.modalLooks.battle = String($("#cfg-ui-modal-look-battle").val() || "");
            ap.modalLooks.character = String($("#cfg-ui-modal-look-character").val() || "");
            ap.textColor = String($("#cfg-ui-text-color").val() || "#e5e7eb");
            ap.panelColor = String($("#cfg-ui-panel-color").val() || "#050a13");
            ap.inputColor = String($("#cfg-ui-input-color").val() || "#050a13");
            ap.accentColor = String($("#cfg-ui-accent-color").val() || "#cc7a2e");
            ap.customCss = String($("#cfg-ui-custom-css").val() || "");
            s.ui.style = {
                ...(s.ui.style && typeof s.ui.style === "object" ? s.ui.style : {}),
                fontFamily: ap.fontFamily,
                textColor: ap.textColor,
                panelColor: ap.panelColor,
                inputColor: ap.inputColor,
                accentColor: ap.accentColor,
                customCss: ap.customCss,
                mainLook: ap.mainLook,
                hamburgerLook: ap.hamburgerLook,
                modalLook: ap.modalLook,
                modalLooks: { ...(ap.modalLooks || {}) },
            };
            saveSettings();
            applyUiAppearanceFromSettings();
        })
        .off("click.uieCustomCssApply")
        .on("click.uieCustomCssApply", "#uie-custom-css-apply", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            const ui = ensureUiCustomization(s);
            ui.css.global = String($("#uie-custom-css").val() || "");
            ui.css.stats = String($("#uie-custom-css-stats").val() || "");
            ui.css.activities = String($("#uie-custom-css-activities").val() || "");
            saveSettings();
            applyCustomCssFromSettings();
        })
        .off("input.uieVnboxFontSize change.uieVnboxFontSize")
        .on("input.uieVnboxFontSize change.uieVnboxFontSize", "#uie-vnbox-fontsize", function () {
            const val = Number($(this).val()) || 16;
            $("#uie-vnbox-fontsize-val").text(val + "px");
            const s = getSettings();
            if (!s.ui.vnBox || typeof s.ui.vnBox !== "object") s.ui.vnBox = {};
            s.ui.vnBox.fontSize = val;
            saveSettings();
            if (typeof window.applyVnBoxSettings === "function") window.applyVnBoxSettings();
        })
        .off("input.uieVnboxOpacity change.uieVnboxOpacity")
        .on("input.uieVnboxOpacity change.uieVnboxOpacity", "#uie-vnbox-opacity", function () {
            const val = Number($(this).val()) || 0.78;
            $("#uie-vnbox-opacity-val").text(Number(val).toFixed(2));
            const s = getSettings();
            if (!s.ui.vnBox || typeof s.ui.vnBox !== "object") s.ui.vnBox = {};
            s.ui.vnBox.opacity = val;
            saveSettings();
            if (typeof window.applyVnBoxSettings === "function") window.applyVnBoxSettings();
        })
        .off("input.uieVnboxHeight change.uieVnboxHeight")
        .on("input.uieVnboxHeight change.uieVnboxHeight", "#uie-vnbox-height", function () {
            const val = Number($(this).val()) || 140;
            $("#uie-vnbox-height-val").text(val + "px");
            const s = getSettings();
            if (!s.ui.vnBox || typeof s.ui.vnBox !== "object") s.ui.vnBox = {};
            s.ui.vnBox.height = val;
            saveSettings();
            if (typeof window.applyVnBoxSettings === "function") window.applyVnBoxSettings();
        })
        .off("change.uieVnboxFontFamily")
        .on("change.uieVnboxFontFamily", "#uie-vnbox-fontfamily", function () {
            const val = String($(this).val()) || "sans-serif";
            const s = getSettings();
            if (!s.ui.vnBox || typeof s.ui.vnBox !== "object") s.ui.vnBox = {};
            s.ui.vnBox.fontFamily = val;
            saveSettings();
            if (typeof window.applyVnBoxSettings === "function") window.applyVnBoxSettings();
        })
        .off("change.uieCssTarget")
        .on("change.uieCssTarget", "#uie-css-target", function () {
            const s = getSettings();
            const ui = ensureUiCustomization(s);
            const target = String($(this).val() || "global");
            const cssByTarget = ui.css.byTarget && typeof ui.css.byTarget === "object" ? ui.css.byTarget : {};
            $("#uie-style-css").val(String(cssByTarget[target] || ""));
        })
        .off("input.uieStyleCss change.uieStyleCss")
        .on("input.uieStyleCss change.uieStyleCss", "#uie-style-css", function () {
            if (styleCssWriteTimer) clearTimeout(styleCssWriteTimer);
            styleCssWriteTimer = setTimeout(() => {
                const s = getSettings();
                const ui = ensureUiCustomization(s);
                const target = String($("#uie-css-target").val() || "global");
                const css = String($("#uie-style-css").val() || "");
                if (!ui.css.byTarget || typeof ui.css.byTarget !== "object") ui.css.byTarget = {};
                if (!css.trim()) delete ui.css.byTarget[target];
                else ui.css.byTarget[target] = css;
                saveSettings();
                applyCustomCssFromSettings();
            }, 180);
        })
        .off("change.uieBgTarget")
        .on("change.uieBgTarget", "#uie-bg-target", function () {
            const s = getSettings();
            const ui = ensureUiCustomization(s);
            const target = String($(this).val() || "menu");
            $("#uie-bg-url").val(String(ui.backgrounds?.[target] || ""));
        })
        .off("click.uieBgApply")
        .on("click.uieBgApply", "#uie-bg-apply", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            const ui = ensureUiCustomization(s);
            const target = String($("#uie-bg-target").val() || "menu");
            const raw = String($("#uie-bg-url").val() || "").trim();
            if (raw) ui.backgrounds[target] = raw;
            else delete ui.backgrounds[target];
            saveSettings();
            applyBackgroundsFromSettings();
        })
        .off("click.uieBgClear")
        .on("click.uieBgClear", "#uie-bg-clear", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            const ui = ensureUiCustomization(s);
            const target = String($("#uie-bg-target").val() || "menu");
            delete ui.backgrounds[target];
            $("#uie-bg-url").val("");
            saveSettings();
            applyBackgroundsFromSettings();
        })
        .off("click.uieBgPick")
        .on("click.uieBgPick", "#uie-bg-pick", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            document.getElementById("uie-bg-file")?.click?.();
        })
        .off("change.uieBgFile")
        .on("change.uieBgFile", "#uie-bg-file", function () {
            const file = this.files && this.files[0];
            if (!file) return;
            const r = new FileReader();
            r.onload = () => {
                const dataUrl = String(r.result || "");
                if (!dataUrl) return;
                $("#uie-bg-url").val(dataUrl);
                $("#uie-bg-apply").trigger("click");
            };
            r.readAsDataURL(file);
            try { this.value = ""; } catch (_) {}
        })
        .off("click.uieLauncherSave")
        .on("click.uieLauncherSave", "#uie-launcher-save", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            if (!s.launcher || typeof s.launcher !== "object") s.launcher = {};
            if (!Array.isArray(s.launcher.savedIcons)) s.launcher.savedIcons = [];
            const val = String($("#uie-launcher-icon").val() || "").trim();
            const src = val && val !== "custom" ? val : String(s.launcher.src || "").trim();
            if (!src) return;
            if (!s.launcher.savedIcons.includes(src)) s.launcher.savedIcons.unshift(src);
            saveSettings();
        })
        .off("click.uieLauncherDelete")
        .on("click.uieLauncherDelete", "#uie-launcher-delete", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            if (!s.launcher || typeof s.launcher !== "object") s.launcher = {};
            if (!Array.isArray(s.launcher.savedIcons)) s.launcher.savedIcons = [];
            const val = String($("#uie-launcher-icon").val() || "").trim();
            const src = val && val !== "custom" ? val : String(s.launcher.src || "").trim();
            if (!src) return;
            s.launcher.savedIcons = s.launcher.savedIcons.filter((x) => String(x || "") !== src);
            saveSettings();
        })
        .off("click.uiePromptsClear")
        .on("click.uiePromptsClear", "#uie-gen-prompts-clear", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            s.generation.promptPrefixes = { byType: {} };
            saveSettings();
            $("#uie-gen-prompt-global, #uie-gen-prompt-default, #uie-gen-prompt-webpage, #uie-gen-prompt-systemcheck, #uie-gen-prompt-phonecall, #uie-gen-prompt-image").val("");
        });

    // Save State
    $(document).off("click.uieStateSave").on("click.uieStateSave", ".uie-state-save-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const name = $(".uie-state-name").val() || "Manual Save " + new Date().toLocaleString();

        const s = getSettings();
        // Deep clone current state, stripping out other saves and image gallery
        const seen = new WeakSet();
        const state = JSON.parse(JSON.stringify(s, (k, v) => {
            if (k === "savedStates" || k === "storySaveSlots") return undefined;
            if (k === "gallery" && Array.isArray(v)) return undefined;
            if (v && typeof v === "object") {
                if (seen.has(v)) return undefined;
                seen.add(v);
            }
            return v;
        }));

        if (!window.UIE_savedStates) window.UIE_savedStates = {};
        window.UIE_savedStates[name] = state;
        try { window.UIE_saveSavedStatesToDb?.(window.UIE_savedStates); } catch (_) {}

        // Refresh dropdown
        refreshStateDropdown();

        // Notify
        try { window.toastr?.success?.(`State '${name}' saved!`, "UIE"); } catch (_) {}
    });

    // Load State - overwrites all UIE session data; never overwrites settings (launcher, ui, windows, generation, image, chats)
    const UIE_SETTINGS_KEYS = ["launcher", "ui", "uiScale", "windows", "generation", "image", "chats", "savedStates", "storySaveSlots", "__uie_saved_at"];
    const UIE_SESSION_KEYS = [
        "character", "currency", "currencySymbol", "currencyRate", "calendar", "map", "social", "party", "journal",
        "diary", "databank", "activities", "phone", "xp", "hp", "mp", "ap", "maxHp", "maxMp", "maxAp", "maxXp",
        "life", "worldState", "inventory", "mapEngine", "simpleMap", "mapData", "lorebooks", "aging", "skills",
        "assets", "factions", "reputation", "academy", "genericNpcs", "academicMemoryTags", "activePortrait",
        "currentLocation", "appearance", "battle", "currencyConfig", "gameCharacters", "loreContext", "memory",
        "memories", "realityEngine", "sceneCharacters", "world"
    ];
    $(document).off("click.uieStateLoad").on("click.uieStateLoad", ".uie-state-load-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const name = $(".uie-state-select").val();
        if (!name) return;

        const loaded = window.UIE_savedStates && window.UIE_savedStates[name];
        if (loaded) {
            const s = getSettings();

            UIE_SESSION_KEYS.forEach(k => {
                if (UIE_SETTINGS_KEYS.indexOf(k) < 0) delete s[k];
            });

            // Overwrite all keys except settings (never reset launcher, ui, windows, etc.)
            Object.keys(loaded).forEach(k => {
                if (UIE_SETTINGS_KEYS.indexOf(k) >= 0) return;
                s[k] = loaded[k];
            });

            saveSettings();

            // Reload UI
            try {
                updateLayout();
                import("./inventory.js").then(m => m.initInventory?.());
                import("./features/stats.js").then(m => m.initStats?.());
                import("./features/life.js").then(m => m.render?.());
                import("./features/items.js").then(m => m.render?.());
                import("./features/skills.js").then(m => m.init?.());
                import("./features/assets.js").then(m => m.init?.());
            } catch (_) {}

            try { window.toastr?.success?.(`State '${name}' loaded!`, "UIE"); } catch (_) {}
        }
    });

    // Delete State
    $(document).off("click.uieStateDel").on("click.uieStateDel", ".uie-state-del-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const name = $(".uie-state-select").val();
        if (!name) return;

        if (window.UIE_savedStates && window.UIE_savedStates[name]) {
            delete window.UIE_savedStates[name];
            try { window.UIE_saveSavedStatesToDb?.(window.UIE_savedStates); } catch (_) {}
            refreshStateDropdown();
            try { window.toastr?.info?.(`State '${name}' deleted.`, "UIE"); } catch (_) {}
        }
    });

    function refreshStateDropdown() {
        const $sel = $(".uie-state-select");
        $sel.empty();
        $sel.append('<option value="">(Select Save...)</option>');

        if (window.UIE_savedStates) {
            Object.keys(window.UIE_savedStates).forEach(k => {
                $sel.append(`<option value="${k}">${k}</option>`);
            });
        }
    }

    // Expose for external refresh
    window.UIE_refreshStateSaves = refreshStateDropdown;

    $(document).off("click.uieStateShare").on("click.uieStateShare", ".uie-state-share-btn", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const name = $(".uie-state-select").val();
        if (!name) { try { window.toastr?.warning?.("Select a save to share.", "UIE"); } catch (_) {} return; }
        const data = window.UIE_savedStates && window.UIE_savedStates[name];
        if (!data) return;
        const payload = JSON.stringify({ name, state: data }, null, 2);
        if (navigator.share) {
            try { await navigator.share({ title: `UIE Save: ${name}`, text: payload }); return; } catch (_) {}
        }
        if (navigator.clipboard?.writeText) {
            try { await navigator.clipboard.writeText(payload); try { window.toastr?.success?.(`Save '${name}' copied to clipboard.`, "UIE"); } catch (_) {} return; } catch (_) {}
        }
        try { window.toastr?.error?.("Could not share save.", "UIE"); } catch (_) {}
    });

    $(document).off("click.uieStateExport").on("click.uieStateExport", ".uie-state-export-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const name = $(".uie-state-select").val();
        if (!name) { try { window.toastr?.warning?.("Select a save to export.", "UIE"); } catch (_) {} return; }
        const data = window.UIE_savedStates && window.UIE_savedStates[name];
        if (!data) return;
        const blob = new Blob([JSON.stringify({ name, state: data }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `uie-save-${name.replace(/[^a-z0-9_-]/gi, "_")}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        try { window.toastr?.success?.(`Save '${name}' exported.`, "UIE"); } catch (_) {}
    });

    $(document).off("click.uieStateImport").on("click.uieStateImport", ".uie-state-import-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-save-import-file").trigger("click");
    });

    $(document).off("change.uieStateImportFile").on("change.uieStateImportFile", "#uie-save-import-file", function(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(ev) {
            try {
                const parsed = JSON.parse(String(ev.target?.result || ""));
                const saveName = parsed?.name || file.name.replace(/\.json$/i, "") || "Imported Save " + new Date().toLocaleString();
                const saveData = parsed?.state || parsed;
                if (!saveData || typeof saveData !== "object") throw new Error("Invalid save format");
                if (!window.UIE_savedStates) window.UIE_savedStates = {};
                window.UIE_savedStates[saveName] = saveData;
                try { window.UIE_saveSavedStatesToDb?.(window.UIE_savedStates); } catch (_) {}
                refreshStateDropdown();
                try { window.toastr?.success?.(`Save '${saveName}' imported.`, "UIE"); } catch (_) {}
            } catch (err) {
                try { window.toastr?.error?.(`Import failed: ${err?.message || err}`, "UIE"); } catch (_) {}
            }
        };
        reader.readAsText(file);
        $(this).val("");
    });

    try {
        window.removeEventListener("uie:state_updated", window.__uieStateUpdatedHandler);
    } catch (_) {}
    try {
        window.__uieStateUpdatedHandler = () => {
            try { refreshStateDropdown(); } catch (_) {}
        };
        window.addEventListener("uie:state_updated", window.__uieStateUpdatedHandler);
    } catch (_) {}

    // Initial refresh on open (handled by openWindow but also here for safety)
    // We'll hook into the tab click or window open

    $(document).off("input.uieLauncherName change.uieLauncherName").on("input.uieLauncherName change.uieLauncherName", "#uie-launcher-name", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const val = $(this).val();
        const s = getSettings();
        s.launcher = s.launcher || {};
        s.launcher.name = val;
        saveSettings();
    });

    $(document).off("change.uieLauncherIcon").on("change.uieLauncherIcon", "#uie-launcher-icon", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const val = $(this).val();
        if (val === "custom") {
             $("#uie-launcher-file").click();
             return;
        }
        const s = getSettings();
        s.launcher = s.launcher || {};
        s.launcher.src = val;
        saveSettings();

        // Update live preview
        const btn = document.getElementById("uie-launcher");
        if (btn) {
            let imgDiv = btn.querySelector(".uie-launcher-img");
            if (imgDiv) imgDiv.style.backgroundImage = `url('${val}')`;
        }
    });

    $(document).off("change.uieLauncherFile").on("change.uieLauncherFile", "#uie-launcher-file", function(e) {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(evt) {
            const res = evt.target.result;
            const s = getSettings();
            s.launcher = s.launcher || {};
            s.launcher.src = res;
            saveSettings();

            // Update live preview
            const btn = document.getElementById("uie-launcher");
            if (btn) {
                let imgDiv = btn.querySelector(".uie-launcher-img");
                if (imgDiv) imgDiv.style.backgroundImage = `url('${res}')`;
            }

            // Update select to show custom is active (visual only)
            const sel = document.getElementById("uie-launcher-icon");
            if(sel) sel.value = "custom";
        };
        reader.readAsDataURL(file);
    });

    // Menu Buttons - Delegate
    // We can add the specific open handlers here or let the specific modules handle them.
    // Ideally, specific modules should bind their buttons.
    // But basic "Close" or similar?
}

export function initScavenge() {
    // Scavenge logic initialized
    // Button injection removed as per user request ("remove quick buttons")
}

/**
 * Interactive scavenge: tap glowing nodes on a layer (modal or stage) to pick up items.
 * @param {{ containerId?: string, container?: HTMLElement, ttlMs?: number }} [opts]
 */
export function spawnScavengeNodes(opts = {}) {
    let layer = null;
    if (opts.container && opts.container.nodeType === 1) layer = opts.container;
    else if (opts.containerId) layer = document.getElementById(String(opts.containerId));
    if (!layer) layer = document.getElementById("re-bg");
    if (!layer) layer = document.body;

    const inModalLayer = layer.id === "scavenge-layer";
    if (inModalLayer) {
        try {
            layer.style.position = "relative";
            layer.style.minHeight = layer.style.minHeight || "420px";
        } catch (_) {}
    }

    document.querySelectorAll(".div-sparkle").forEach((e) => e.remove());

    const count = 4 + Math.floor(Math.random() * 4); // 4–7 finds
    for (let i = 0; i < count; i++) {
        const sparkle = document.createElement("div");
        sparkle.className = "div-sparkle";
        sparkle.setAttribute("role", "button");
        sparkle.setAttribute("aria-label", "Pick up");

        const top = 12 + Math.random() * 76;
        const left = 8 + Math.random() * 84;
        const size = inModalLayer ? 44 : 36;

        const pos = inModalLayer ? "absolute" : "fixed";
        sparkle.style.cssText = `
            position: ${pos};
            top: ${top}%;
            left: ${left}%;
            width: ${size}px;
            height: ${size}px;
            transform: translate(-50%, -50%);
            background: radial-gradient(circle, #cba35c 0%, rgba(203, 163, 92,0.2) 55%, transparent 72%);
            border-radius: 50%;
            cursor: pointer;
            z-index: ${inModalLayer ? 5 : 2147483661};
            animation: pulse-gold 1.1s ease-in-out 4;
            box-shadow: 0 0 12px #cba35c;
            touch-action: manipulation;
        `;

        sparkle.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            sparkle.remove();
            handleLoot();
        };

        layer.appendChild(sparkle);
    }

    if (!document.getElementById("re-sparkle-style")) {
        const style = document.createElement("style");
        style.id = "re-sparkle-style";
        style.textContent = `
            .div-sparkle::after {
                content: "Scavenge";
                position: absolute;
                left: 50%;
                top: 100%;
                transform: translateX(-50%);
                margin-top: 4px;
                padding: 2px 6px;
                border-radius: 6px;
                background: rgba(0,0,0,0.7);
                color: #fff6c2;
                font-size: 10px;
                font-weight: 800;
                white-space: nowrap;
            }
            @keyframes pulse-gold {
                0% { transform: translate(-50%, -50%) scale(0.85); opacity: 0.65; box-shadow: 0 0 6px #cba35c; }
                50% { transform: translate(-50%, -50%) scale(1.15); opacity: 1; box-shadow: 0 0 18px #cba35c; }
                100% { transform: translate(-50%, -50%) scale(1); opacity: 0.92; box-shadow: 0 0 12px #cba35c; }
            }
        `;
        document.head.appendChild(style);
    }

    const s = getSettings();
    const loc = s.worldState?.location || "Unknown";
    notify("info", inModalLayer ? `Tap the glowing spots in ${loc}.` : `Searching ${loc}…`, "Scavenge");

    const ttl = Number.isFinite(Number(opts.ttlMs)) ? Number(opts.ttlMs) : inModalLayer ? 90000 : 12000;
    if (ttl > 0) {
        setTimeout(() => {
            document.querySelectorAll(".div-sparkle").forEach((e) => e.remove());
        }, ttl);
    }
}

async function handleLoot() {
    const s = getSettings();
    const loc = s.worldState?.location || "Unknown Place";

    let item = "Strange Pebble";

    try {
        // Dynamic Story-Based Loot
        const { generateContent } = await import("./apiClient.js");
        const prompt = `Location: ${loc}.
The user searches the area. Generate ONE small, tangible item name that fits this specific story location.
Examples: "Rusty Key", "Cyberdeck Chip", "Dragon Scale", "Metro Ticket".
Return ONLY the item name. No punctuation.`;

        const res = await generateContent(prompt, "Loot");
        if (res) {
            item = res.replace(/["\.]/g, "").trim();
            // Safety cap length
            if (item.length > 30) item = item.substring(0, 30);
        }
    } catch (e) {
        console.warn("Loot Gen Failed", e);
        // Fallback logic
        const isLifeSim = s.rpg?.mode === "life_sim";
        const items = isLifeSim ?
             ["Lost Coin", "Grocery Coupon", "Shiny Marble", "Wild Flower", "Old Ticket", "Cool Rock", "Pen", "Lighter"]
            : ["Old Coin", "Strange Pebble", "Rusty Key", "Medicinal Herb", "Scrap Metal", "Gemstone", "Lost Note", "Small Potion"];
        item = items[Math.floor(Math.random() * items.length)];
    }

    if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
    if (!Array.isArray(s.worldState.worldItems)) s.worldState.worldItems = [];
    const worldItem = {
        kind: "item",
        name: item,
        qty: 1,
        type: "Material",
        description: `Discovered while searching ${loc}. It is present in the scene until the user explicitly takes it.`,
        rarity: "common",
        location: loc,
        statusEffects: [],
        mods: {},
        _meta: { source: "interaction_world_item", createdAt: Date.now(), updatedAt: Date.now() },
    };
    const key = `${loc}:${item}`.toLowerCase();
    const existing = s.worldState.worldItems.find((x) => String(x?._key || "").toLowerCase() === key);
    if (existing) Object.assign(existing, worldItem, { _key: key });
    else s.worldState.worldItems.push({ ...worldItem, _key: key });

    saveSettings();

    notify("success", `Found nearby: ${item}`, "Scavenge");
    injectRpEvent(`[System: A ${item} is now visible in ${loc}. It is a world item, not in inventory unless the user takes it.]`);
}

export function initSpriteInteraction() {
    $("body").off("pointerup.reSprite");
    $("body").on("pointerup.reSprite", ".re-sprite", function (e) {
        e.preventDefault();
        e.stopPropagation();

        const el = this;
        const charName = el.getAttribute("alt") || "Character";

        spawnContextMenu(e.clientX, e.clientY, charName, [
            {
                label: "Look",
                icon: "fa-solid fa-eye",
                action: () => {
                    injectRpEvent(`[System: You look closely at ${charName}. Describe their appearance and demeanor.]`);
                    notify("info", `Looking at ${charName}`, "Interaction");
                }
            },
            {
                label: "Talk",
                icon: "fa-solid fa-comment",
                action: () => {
                    injectRpEvent(`[System: You approach ${charName} to speak.]`);
                }
            },
            {
                label: "Touch",
                icon: "fa-solid fa-hand",
                action: () => {
                    injectRpEvent(`[System: You reach out to touch ${charName}.]`);
                }
            },
            {
                label: "Inspect",
                icon: "fa-solid fa-magnifying-glass",
                action: () => {
                    injectRpEvent(`[System: You inspect ${charName} for any unusual details.]`);
                }
            }
        ]);
    });
}

export function initBackgroundInteraction() {
    // Context menu for the background. Quick actions were replaced by the action wheel.
    // Bind to body to catch clicks even if passing through pointer-events:none layers
    $("body").off("contextmenu.reBg").on("contextmenu.reBg", function(e) {
        // Exclude ST UI and our UI
        if ($(e.target).closest(".re-sprite, .re-btn, .re-qbtn, .uie-window, .mes, .drawer-content, #chat, textarea, input, button, a").length) return;

        // Only active if Reality Engine is enabled?
        // Or if we are just in the global scope User wants interactivity.
        // Let's assume always active but maybe check if RE is enabled if we want to be strict.
        // For now, allow it as a general feature since it injects RP events.

        e.preventDefault();

        spawnContextMenu(e.clientX, e.clientY, "Area", [
            {
                label: "Investigate",
                icon: "fa-solid fa-magnifying-glass",
                action: () => {
                    try {
                        if (typeof window !== "undefined" && typeof window.UIE_openScavengeEmbedded === "function") {
                            window.UIE_openScavengeEmbedded();
                            return;
                        }
                    } catch (_) {}
                    const layer = document.getElementById("scavenge-layer");
                    if (layer) {
                        layer.innerHTML = "";
                        spawnScavengeNodes({ containerId: "scavenge-layer", ttlMs: 90000 });
                    } else {
                        spawnScavengeNodes();
                    }
                }
            },
            {
                label: "Relax",
                icon: "fa-solid fa-chair",
                action: () => {
                    injectRpEvent(`[System: You take a moment to relax and soak in the atmosphere.]`);
                }
            }
        ]);
    });
}

function spawnContextMenu(x, y, title, options) {
    // Remove existing
    $(".re-context-menu").remove();

    const menu = document.createElement("div");
    menu.className = "re-context-menu";
    menu.style.left = x + "px";
    menu.style.top = y + "px";

    const header = document.createElement("div");
    header.className = "re-ctx-header";
    header.textContent = title;
    menu.appendChild(header);

    options.forEach(opt => {
        const item = document.createElement("div");
        item.className = "re-ctx-item";
        item.innerHTML = `<i class="${opt.icon}"></i> ${opt.label}`;
        item.onclick = (e) => {
            e.stopPropagation();
            opt.action();
            menu.remove();
        };
        menu.appendChild(item);
    });

    document.body.appendChild(menu);

    // Close on click outside
    setTimeout(() => {
        $(document).one("click.reCtx", () => menu.remove());
    }, 10);

    // Bounds check
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 10) + "px";
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 10) + "px";
}
