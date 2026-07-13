import { getSettings, updateLayout } from "./core.js";
import { fetchTemplateHtml } from "./templateFetch.js";
import { initTurboUi } from "./apiClient.js";
import { initImageUi } from "./imageGen.js";
import { initBackups } from "./backup.js";
import { initPersonaManager } from "./personas.js";
import { initNextBeat } from "./nextBeat.js";
import { initCommunicationsManager } from "./CommunicationsManager.js";
import { initTimeEngine } from "./TimeEngine.js";
import { initReadableHtml } from "./readableHtml.js";
import { initVisualGen } from "./visualGen.js";
import { isSystemLockedOut, enforceLockoutScreen, runAsyncLockoutCheck } from "./safetyScanner.js";
import { ensureProcessedAssetLibrary } from "./assetLibrary.js";
import { mountLive2DSettings } from "./live2dSettings.js";

// Run persistent auto-ban lockout checks immediately at start of file load
if (isSystemLockedOut()) {
    enforceLockoutScreen();
}
try {
    runAsyncLockoutCheck().then((isLocked) => {
        if (isLocked) enforceLockoutScreen();
    }).catch(() => {});
} catch (_) {}
try { initReadableHtml(); } catch (_) {}

const baseUrl = (() => {
    try {
        const u = String(window.UIE_BASEURL || "");
        if (u) return u.endsWith("/") ? u : `${u}/`;
    } catch (_) {}
    return "/";
})();

function applyCustomCursorFromSettings(settings = getSettings()) {
    try {
        const cursorUrl = String(settings?.ui?.customCursor || settings?.launcher?.cursorSrc || "").trim();
        let style = document.getElementById("uie-custom-cursor-style");
        document.querySelectorAll([
            "#uie-custom-cursor",
            "#uie-cursor-photo",
            "#custom-cursor",
            "#cursor-photo",
            "#cursor-img",
            ".uie-custom-cursor",
            ".uie-cursor-photo",
            ".custom-cursor",
            ".cursor-photo",
            ".cursor-img",
            ".cursor-follower",
            ".mouse-follower",
            "[data-uie-cursor-photo]"
        ].join(",")).forEach((el) => el.remove());
        if (!cursorUrl || !/^data:image\//i.test(cursorUrl)) {
            style?.remove();
            return;
        }
        if (!style) {
            style = document.createElement("style");
            style.id = "uie-custom-cursor-style";
            document.head.appendChild(style);
        }
        const safeUrl = cursorUrl.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        style.textContent = `
html, body {
  cursor: url("${safeUrl}") 6 6, auto !important;
}
a, button, [role="button"], input[type="button"], input[type="submit"], input[type="file"], select, label, .clickable, .room-hotspot, .vn-room-component, .reply-keyboard-key, .reply-keyboard-mini, .reply-keyboard-toggle, .reply-tool-btn, .nav-btn, .direction-btn, [style*="cursor: pointer"], [style*="cursor:pointer"] {
  cursor: url("${safeUrl}") 6 6, pointer !important;
}
textarea, input[type="text"], input[type="search"], input[type="password"], input[type="number"], input[type="email"], [contenteditable="true"] {
  cursor: text !important;
}
`;
    } catch (err) {
        console.warn("[UIE] Failed to apply custom cursor:", err);
    }
}

try {
    window.UIE_applyCustomCursorFromSettings = applyCustomCursorFromSettings;
    applyCustomCursorFromSettings();
} catch (_) {}


let i18nModulePromise = null;
async function applyI18nBatch(root = document) {
    try {
        if (!i18nModulePromise) i18nModulePromise = import("./i18n.js");
        const m = await i18nModulePromise;
        m.applyI18n?.(root || document);
    } catch (_) {}
}

export async function loadTemplates() {
    // Manually inject launcher to ensure it exists (bypassing fetch failure risks)
    if ($("#uie-launcher").length === 0) {
        try {
            setTimeout(() => {
                try {
                    if (document.getElementById("uie-launcher-fallback-style")) return;
                    const st = document.createElement("style");
                    st.id = "uie-launcher-fallback-style";
                    st.textContent = `
#uie-launcher{position:fixed;bottom:20px;left:20px;width:54px;height:54px;z-index:2147483645;cursor:pointer;background:transparent;border:0;box-shadow:none;}
#uie-launcher:hover{filter:drop-shadow(0 0 8px #7dd3fc);}
#uie-launcher .uie-launcher-img{background-color:transparent!important;box-shadow:none!important;border-radius:0!important;background-size:contain!important;}
#uie-launcher .uie-launcher-fallback{display:block; filter: drop-shadow(0 0 4px rgba(0,0,0,0.8));}
`;
                    document.head.appendChild(st);
                } catch (_) {}
            }, 550);
        } catch (_) {}
        // Launcher Button Logic
        const s = getSettings();
        // Default to Emerald Pouch if no icon is set
        const defaultIcon = "https://user.uploads.dev/file/d0ab82cdfafc169c41c8ff7be6932710.png";
        const customIcon = s?.launcher?.src || s?.launcherIcon || defaultIcon;
        const launcherHidden = s?.launcher?.hidden === true;
        applyCustomCursorFromSettings(s);

        // Always use image logic now since default is an image
        const innerContent = `<div class="uie-launcher-img" style="width:100%; height:100%; background:url('${customIcon}') center/contain no-repeat; border-radius:0; box-shadow:none; background-color:transparent;"></div>`;

        const launcherHtml = `
            <div id="uie-launcher" title="Open Menu" style="display:${launcherHidden ? 'none' : 'flex'}; align-items:center; justify-content:center; background:transparent; border:0; box-shadow:none;">
                ${innerContent}
            </div>`;
        $("body").append(launcherHtml);
        try { updateLayout(); } catch(_) {}

        // Show SVG if background image fails to load (handled via CSS or error event usually,
        // but here we just leave it hidden unless we need it.
        // Actually, let's just rely on the CSS background image, but ensure the DIV is there.)
    }

    const required = ["menu", "inventory", "world"];
    const ts = (() => {
        try {
            const v = Number(window.UIE_BUILD);
            if (Number.isFinite(v) && v > 0) return v;
        } catch (_) {}
        return Date.now();
    })();
    for (const f of required) {
        const rootSelector = `#uie-${f === "menu" ? "main-menu" : `${f}-window`}`;
        // Keep embedded standalone templates when local-file security prevents fetch().
        const localStandalone = window.UIE_STANDALONE === true && window.location?.protocol === "file:";
        if ($(rootSelector).length && (f !== "menu" || localStandalone)) continue;
        const urls = f === "menu" ? [
            `${baseUrl}src/templates/hamburger_menu.html?v=${ts}`,
            `${baseUrl}templates/hamburger_menu.html?v=${ts}`,
            `${baseUrl}src/templates/menu.html?v=${ts}`,
            `${baseUrl}templates/menu.html?v=${ts}`,
        ] : [
            `${baseUrl}src/templates/${f}.html?v=${ts}`,
            `${baseUrl}templates/${f}.html?v=${ts}`,
        ];
        let html = "";
        for (const url of urls) {
            try {
                html = await fetchTemplateHtml(url);
                if (html) break;
            } catch (_) {}
        }
        if (!html) {
            try { console.error(`[UIE] Required template failed to load: ${f}`, { baseUrl, urls }); } catch (_) {}
            try { window.toastr?.error?.(`UIE failed to load required UI: ${f}. Check UIE_BASEURL / install.`); } catch (_) {}
            return;
        }
        if (f === "menu") $(rootSelector).remove();
        $("body").append(html);
    }

    try { setTimeout(() => { void applyI18nBatch(document); }, 0); } catch (_) {}
    try { setTimeout(() => { void ensureProcessedAssetLibrary({ injectFood: true }); }, 0); } catch (_) {}

    // Standalone windows are embedded or loaded on demand. Diary is small and user-facing enough
    // to mount eagerly so the menu button never opens against a missing template.
    if (window.UIE_STANDALONE === true) {
        try {
            if (!document.getElementById("uie-diary-window")) {
                let diaryHtml = "";
                for (const url of [
                    `${baseUrl}src/templates/diary.html?v=${ts}`,
                    `./src/templates/diary.html?v=${ts}`,
                    `/src/templates/diary.html?v=${ts}`,
                ]) {
                    try {
                        diaryHtml = await fetchTemplateHtml(url);
                        if (String(diaryHtml || "").trim()) break;
                    } catch (_) {
                        diaryHtml = "";
                    }
                }
                if (String(diaryHtml || "").trim()) $("body").append(diaryHtml);
            }
            setTimeout(() => { void applyI18nBatch(document); }, 0);
        } catch (err) {
            console.warn("[UIE] Standalone diary template failed to preload:", err);
        }
        return;
    }

    const optional = ['phone', 'calendar', 'debug', 'journal', 'social', 'diary', 'party', 'databank', 'factions', 'chatbox', 'launcher_options', 'sprites', 'activities', 'stats', 'settings_window', 'newgame', 'tracker', 'atmosphere', 'helper_pet'];
    const loadOptionalTemplates = () => {
        (async () => {
            const results = [];
            for (const f of optional) {
                try {
                    const optionalRootIds = {
                        phone: "uie-phone-window",
                        calendar: "uie-calendar-window",
                        debug: "uie-debug-window",
                        journal: "uie-journal-window",
                        social: "uie-social-window",
                        diary: "uie-diary-window",
                        party: "uie-party-window",
                        databank: "uie-databank-window",
                        factions: "uie-factions-window",
                        chatbox: "uie-chatbox-window",
                        launcher_options: "uie-launcher-options-window",
                        sprites: "uie-sprites-window",
                        activities: "uie-activities-window",
                        stats: "uie-stats-window",
                        settings_window: "uie-settings-window",
                        newgame: "uie-newgame-overlay",
                        tracker: "uie-tracker-window",
                        atmosphere: "uie-atmosphere-window",
                        helper_pet: "uie-helper-pet-template"
                    };
                    const existingId = optionalRootIds[f];
                    if (f === "factions") {
                        const existingFactionWindow = document.getElementById("uie-factions-window");
                        const tpl = existingFactionWindow?.getAttribute("data-uie-factions-template") || "";
                        if (existingFactionWindow && tpl !== "organizations-v1") {
                            existingFactionWindow.remove();
                        }
                    }
                    if (existingId && document.getElementById(existingId)) {
                        results.push({ status: "fulfilled", value: { f, skipped: true } });
                        continue;
                    }
                    const url = `${baseUrl}src/templates/${f}.html?v=${ts}`;
                    const html = await fetchTemplateHtml(url);

                    // SPECIAL HANDLING: Chatbox needs to go into #reality-stage if possible, others to body
                    if (f === "chatbox") {
                        const stage = document.getElementById("reality-stage");
                        if (stage) $(stage).append(html);
                        else $("body").append(html);
                    } else {
                        $("body").append(html);
                    }
                    results.push({ status: "fulfilled", value: { f, url } });
                } catch (err) {
                    results.push({ status: "rejected", reason: err, file: f });
                }
                await new Promise((resolve) => setTimeout(resolve, 24));
            }
            const failed = results
                .filter((r) => r.status === "rejected")
                .map((r) => ({ file: r.file, error: r.reason }));
            if (failed.length) console.warn("[UIE] Optional template load failures:", failed, { baseUrl });
            try { setTimeout(() => { void applyI18nBatch(document); }, 0); } catch (_) {}
        })();
    };
    setTimeout(() => {
        try {
            if (typeof window.requestIdleCallback === "function") {
                window.requestIdleCallback(loadOptionalTemplates, { timeout: 8000 });
            } else {
                loadOptionalTemplates();
            }
        } catch (_) {
            loadOptionalTemplates();
        }
    }, 3000);

    // Scanner hooks must be initialized globally so scans work even before Social module is opened.
    try {
        import("./stateTracker.js").then((mod) => {
            try { mod?.initAutoScanning?.(); } catch (_) {}
        });
    } catch (_) {}
}

export function patchToastr() {
    try {
        if (!window.toastr) return;
        const t = window.toastr;
        if (t._uiePatched) return;
        const orig = {
            info: t.info?.bind(t),
            success: t.success?.bind(t),
            warning: t.warning?.bind(t),
            error: t.error?.bind(t),
        };
        t._uieOrig = orig;
        t._uiePatched = true;
        const wrap = (fn) => (msg, title, opts) => {
            const s = getSettings();
            if (s?.ui?.showPopups === false) return;
            return fn ? fn(msg, title, { ...(opts || {}), positionClass: "toast-top-center" }) : undefined;
        };
        if (orig.info) t.info = wrap(orig.info);
        if (orig.success) t.success = wrap(orig.success);
        if (orig.warning) t.warning = wrap(orig.warning);
        if (orig.error) t.error = wrap(orig.error);
        try {
            // Keep all toastr notices in the shared top-center notification lane.
            // This deliberately replaces legacy saved/default positions so alerts do not
            // split between corners and the game shell.
            t.options = { ...(t.options || {}), progressBar: true, newestOnTop: true, closeButton: false, positionClass: "toast-top-center", timeOut: 3400, extendedTimeOut: 1200 };
        } catch (_) {}
    } catch (_) {}
}

export function injectSettingsUI() {
    // Standalone uses settings_window.html; the host-app drawer template is not part of this build.
    if (window.UIE_STANDALONE === true) return;

    let tries = 0;
    const settingsTargetSelector = [
        "#extensions_settings",
        "#extensions_settings_panel",
        "#extensions-settings-container",
        "#extensions_settings2",
        "#extensions-settings",
        "#extensionsSettings",
        "#extensions_settings_content",
        ".extensions_settings",
        "#extensions-settings-content"
    ].join(", ");

    const resolveSettingsTarget = () => {
        try {
            return $(settingsTargetSelector);
        } catch (_) {
            return $();
        }
    };

    const dedupeSettingsBlocks = () => {
        try {
            const target = resolveSettingsTarget();

            const blocks = $(".uie-settings-block");
            if (!blocks.length) return;

            let keep = null;
            try {
                const inside = target && target.length ? blocks.filter((_, el) => target.has(el).length > 0) : $();
                keep = inside.length ? inside.first() : null;
            } catch (_) {
                keep = null;
            }

            if (!keep || !keep.length) {
                try {
                    const byId = blocks.filter("#uie-settings-block");
                    keep = byId.length ? byId.first() : blocks.first();
                } catch (_) {
                    keep = blocks.first();
                }
            }

            try {
                if (target && target.length && target.has(keep).length === 0) target.append(keep);
            } catch (_) {}

            try { keep.attr("id", "uie-settings-block"); } catch (_) {}
            try { keep.attr("data-uie-settings-drawer", "1"); } catch (_) {}

            try { blocks.not(keep).remove(); } catch (_) {}
        } catch (_) {}
    };
    const inject = async () => {
        tries++;

        let target = resolveSettingsTarget();

        if (!target.length) {
            try {
                const nodes = Array.from(document.querySelectorAll(
                    "[id*='extensions'][id*='settings'], [class*='extensions'][class*='settings'], [id*='extension'][id*='settings'], [class*='extension'][class*='settings']"
                ));
                const scored = nodes
                    .map((el) => {
                        try {
                            const r = el.getBoundingClientRect();
                            const area = Math.max(0, r.width) * Math.max(0, r.height);
                            const visible = r.width > 40 && r.height > 40 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
                            return { el, area, visible };
                        } catch (_) {
                            return { el, area: 0, visible: false };
                        }
                    })
                    .filter((x) => x.visible)
                    .sort((a, b) => b.area - a.area);
                if (scored.length) target = $(scored[0].el);
            } catch (_) {}
        }

        // If ST already injected our settings block (or something duplicated it), reuse it and dedupe.
        // Prefer the block that's already inside the extensions settings container.
        try {
            const blocks = $(".uie-settings-block");
            if (blocks.length) {
                let keep = null;
                try {
                    const inside = target && target.length ? blocks.filter((_, el) => target.has(el).length > 0) : $();
                    keep = inside.length ? inside.first() : blocks.first();
                } catch (_) {
                    keep = blocks.first();
                }

                if (target && target.length) {
                    try {
                        if (target.has(keep).length === 0) target.append(keep);
                    } catch (_) {}
                }

                if (!keep.attr("id")) keep.attr("id", "uie-settings-block");
                keep.attr("data-uie-settings-drawer", "1");
                blocks.not(keep).remove();
                try { initTurboUi(); } catch (_) {}
                try { initImageUi(); } catch (_) {}
                try { initBackups(); } catch (_) {}
                try { initPersonaManager(); } catch (_) {}
                try { initNextBeat(); } catch (_) {}
                try { initCommunicationsManager(); } catch (_) {}
                try { initTimeEngine(); } catch (_) {}
                try { initVisualGen(); } catch (_) {}
                try { (await import("./i18n.js")).applyI18n?.(document); } catch (_) {}
                return;
            }
        } catch (_) {}

        const alreadyInjected = $(".uie-settings-block").length > 0;
        if (!target.length) {
            if (tries === 1 || tries === 5 || tries === 15 || tries === 40) {
                try { console.warn("[UIE] Settings drawer target not found yet; will retry", { tries }); } catch (_) {}
            }
            setTimeout(inject, 750);
            return;
        }

        if (target.length && !alreadyInjected) {
            try {
                const ts = (() => {
                    try {
                        const v = Number(window.UIE_BUILD);
                        if (Number.isFinite(v) && v > 0) return v;
                    } catch (_) {}
                    return Date.now();
                })();
                const urls = [
                    `${baseUrl}src/templates/settings.html?v=${ts}`,
                    `${baseUrl}templates/settings.html?v=${ts}`
                ];

                let html = "";
                for (const url of urls) {
                    try {
                        html = await fetchTemplateHtml(url);
                        if (html) break;
                    } catch (_) {}
                }
                if (!html) {
                    try { console.error("[UIE] Failed to load settings drawer template (settings.html)", { baseUrl, urls }); } catch (_) {}
                    setTimeout(inject, 750);
                    return;
                }
                const $html = $(html);
                let $block = $html.filter(".uie-settings-block").first();
                if (!$block.length) $block = $html.find(".uie-settings-block").first();
                if (!$block.length) {
                    try { console.error("[UIE] settings.html loaded but .uie-settings-block not found; cannot inject", { baseUrl, urls }); } catch (_) {}
                    setTimeout(inject, 750);
                    return;
                }
                $block.attr("id", "uie-settings-block");
                $block.attr("data-uie-settings-drawer", "1");
                target.append($block);
                try { mountLive2DSettings($block); } catch (_) {}
                initTurboUi();
                initImageUi();
                initBackups();
                initPersonaManager();
                initNextBeat();
                initCommunicationsManager();
                initTimeEngine();
                initVisualGen();
                try { (await import("./i18n.js")).applyI18n?.(document); } catch (_) {}
            } catch (e) {
                try { console.error("[UIE] Failed to inject settings drawer", e); } catch (_) {}
            }
        }
    };
    inject();

    try { dedupeSettingsBlocks(); } catch (_) {}

    try {
        if (!window.UIE_settingsDrawerObserver) {
            let reinjectT = 0;
            const scheduleReinject = () => {
                if (reinjectT) return;
                reinjectT = setTimeout(() => {
                    reinjectT = 0;
                    try {
                        if ($("#uie-settings-block").length === 0) inject();
                    } catch (_) {}
                }, 350);
            };

            const isRelevantMutation = (mutations) => {
                try {
                    for (const m of mutations || []) {
                        const nodes = [];
                        try {
                            if (m?.addedNodes?.length) nodes.push(...m.addedNodes);
                            if (m?.removedNodes?.length) nodes.push(...m.removedNodes);
                        } catch (_) {}

                        for (const n of nodes) {
                            if (!n || n.nodeType !== 1) continue;
                            const el = n;
                            const id = String(el.id || "").toLowerCase();
                            const cls = String(el.className || "").toLowerCase();
                            if (id === "uie-settings-block" || id.includes("extensions") || id.includes("settings")) return true;
                            if (cls.includes("uie-settings-block") || cls.includes("extensions") || cls.includes("settings")) return true;
                            if (typeof el.querySelector === "function") {
                                if (el.querySelector("#uie-settings-block, .uie-settings-block")) return true;
                            }
                        }
                    }
                } catch (_) {}
                return false;
            };

            const obs = new MutationObserver((mutations) => {
                try {
                    if (!isRelevantMutation(mutations)) return;
                    dedupeSettingsBlocks();
                    if ($("#uie-settings-block").length === 0) scheduleReinject();
                } catch (_) {}
            });

            const target = resolveSettingsTarget();
            const root = (target && target.length) ? target.get(0) : document.body;
            obs.observe(root, { childList: true, subtree: root !== document.body });
            window.UIE_settingsDrawerObserver = obs;
        }
    } catch (_) {}

    // Add Drawer Listener - Use specific class to avoid double-binding if ST already handles general drawers
    $("body").off("click.uieDrawer pointerup.uieDrawer touchend.uieDrawer").on("click.uieDrawer pointerup.uieDrawer touchend.uieDrawer", ".uie-settings-block .inline-drawer-toggle", function(e) {
        if (e.type === "pointerup") {
            const pt = String(e.pointerType || "").toLowerCase();
            if (pt && pt !== "touch" && pt !== "pen") return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const root = $(this).closest(".inline-drawer");
        const content = root.find(".inline-drawer-content");
        const icon = root.find(".inline-drawer-icon");

        // Force toggle logic regardless of animation state to fix "stuck" drawers
        // if (content.is(":animated")) return;

        if (content.is(":visible") && content.height() > 10) {
            content.slideUp(200);
            icon.css("transform", "rotate(-90deg)");
        } else {
            content
                .css("display", "flex")
                .hide()
                .slideDown(200, function () {
                    try { $(this).css("display", "flex"); } catch (_) {}
                });
            icon.css("transform", "rotate(0deg)");
        }
    });

    // Reset Chat Data Listener
    $("body").off("click.uieResetChat").on("click.uieResetChat", "#uie-reset-chat-data", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm("Are you sure This will reset gameplay data for this chat only. Your UI/settings/API presets will be preserved.")) return;
        
        const s2 = getSettings();
        const preserved = {
            ui: s2.ui,
            launcher: s2.launcher,
            windows: s2.windows,
            generation: s2.generation,
            turbo: s2.turbo,
            image: s2.image,
            connections: s2.connections,
            ai: s2.ai,
            features: s2.features,
            rpg: s2.rpg,
            memories: s2.memories,
            world: s2.world,
        };
        // Reset logic
        s2.inventory = { items: [], equipped: [], skills: [], assets: [], vitals: {} };
        s2.character = { 
            name: "User", className: "Adventurer", level: 1, 
            stats: { str:10, dex:10, con:10, int:10, wis:10, cha:10, per:10, luk:10, agi:10, vit:10, end:10, spi:10 },
            statusEffects: []
        };
        s2.currency = 0;
        s2.xp = 0;
        s2.hp = 100; s2.maxHp = 100;
        s2.mp = 50; s2.maxMp = 50;
        s2.ap = 10; s2.maxAp = 10;
        // Clear other modules
        s2.calendar = {};
        s2.map = {};
        s2.social = {};
        s2.socialMeta = {
            autoScan: s2?.socialMeta?.autoScan === true,
            deletedNames: [],
        };
        s2.worldState = {};
        s2.diary = {};
        s2.databank = {};
        s2.activities = {};

        // Restore user configuration blocks so reset never wipes preferences/connections.
        for (const [k, v] of Object.entries(preserved)) {
            if (v !== undefined) s2[k] = v;
        }
        
        // Save
        const { saveSettings, updateLayout } = await import("./core.js");
        saveSettings();
        updateLayout();
        
        // Notify
        try { window.toastr?.success?.("Current chat data reset complete.", "UIE"); } catch (_) {}
        
        // Reload views if open
        try { (await import("./inventory.js")).updateVitals?.(); } catch (_) {}
        try { (await import("./inventory.js")).applyInventoryUi?.(); } catch (_) {}
        try { (await import("./features/items.js")).render?.(); } catch (_) {}
        try { (await import("./features/skills.js")).init?.(); } catch (_) {}
        try { (await import("./features/assets.js")).init?.(); } catch (_) {}
        try { (await import("./features/equipment.js")).init?.(); } catch (_) {}
    });
}

try {
    window.uie = window.uie || {};
    window.uie.phone = window.uie.phone || {};
    window.uie.phone.openBooksGuide = async (sectionId) => {
        try {
            const mod = await import("./helpManual.js");
            if (typeof mod?.openHelpManualWindow === "function") mod.openHelpManualWindow(sectionId);
        } catch (_) {}
    };
    window.UIE_openGuide = window.uie.phone.openBooksGuide;
} catch (_) {}
