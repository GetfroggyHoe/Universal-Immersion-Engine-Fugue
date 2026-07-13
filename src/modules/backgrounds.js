
import { getRealityEngineV3 } from "./reality.js";
import { notify } from "./notifications.js";
import { getSettings, saveSettings } from "./core.js";
import { pollLocationImageAsset, requestLocationImageAsset } from "./serverAssets.js";
import { generateLocalImage } from "./localImageGen.js";


const reV3 = getRealityEngineV3();

/**
 * Generates a background image using Pollinations AI
 * @param {string} locationName 
 * @param {string} biome 
 * @returns {Promise<string>}
 */
async function generateBackground(locationName, biome) {
    const prompt = `${locationName}, ${biome}, high-detail visual novel environment.`;
    const asset = await requestLocationImageAsset(locationName, { name: locationName, biome, imagePrompt: prompt }, {
        kind: "background",
        prompt,
        source: "background_manager",
        timeoutMs: 1200,
    });
    if (asset?.status === "ready") return String(asset.urlAbsolute || asset.url || "");
    if (asset?.asset_id) {
        pollLocationImageAsset(locationName, asset.asset_id, { name: locationName, biome }, {
            kind: "background",
            onReady: (_asset, url) => {
                if (url) reV3.setBackground(locationName, url);
            },
        });
    }
    return "";
}

/**
 * The "Check-Gen-Cache" Loop
 * Listens for missing background events and resolves them.
 */
export function initBackgroundManager() {
    if (window.UIE_backgroundManagerBound) return;
    window.UIE_backgroundManagerBound = true;

    // ── Local SDXS 1-step generation (fast, offline) ──────────────────────────
    // Runs first; if the image service is available it will handle the event.
    // The Pollinations fallback below only fires when local gen is disabled/unavailable.
    reV3.on("background:missing", async ({ id, location }) => {
        if (window.UIE_realityForgeV3Bound) return;

        // Double check if it's already being handled
        if (reV3.getBackground(id)) return;

        const s = getSettings();
        if (s?.image?.enabled !== true) return;

        const locName = location?.name || id || "Unknown Place";
        const biome = location?.biome || "fantasy";
        
        notify("info", `Painting ${locName}...`, "Reality Engine");

        try {
            // One coordinator owns this event. Previously the local generator
            // and this fallback both listened, which could generate twice.
            const localUrl = await generateLocalImage(id, location);
            if (localUrl) {
                notify("success", `Background created for ${locName}`, "Reality Engine");
                return;
            }
            const dataUrl = await generateBackground(locName, biome);
            if (dataUrl) {
                reV3.setBackground(id, dataUrl);
                notify("success", `Background created for ${locName}`, "Reality Engine");
            } else {
                notify("warn", `Failed to paint ${locName}`, "Reality Engine");
            }
        } catch (err) {
            console.error(err);
        }
    });

    // Also handle location changes to ensure we have a background
    reV3.on("location:changed", ({ id, location }) => {
        reV3.ensureBackgroundOrRequest();
    });

    console.log("[UIE] Background Manager Initialized");
}

// Window Background Management
export function getWindowBackgrounds() {
    const s = getSettings();
    return s.windowBackgrounds || {};
}

export function setWindowBackground(windowId, imageUrl) {
    const s = getSettings();
    if (!s.windowBackgrounds) s.windowBackgrounds = {};
    s.windowBackgrounds[windowId] = imageUrl;
    saveSettings();
    applyWindowBackground(windowId, imageUrl);
}

export function removeWindowBackground(windowId) {
    const s = getSettings();
    if (!s.windowBackgrounds) return;
    delete s.windowBackgrounds[windowId];
    saveSettings();
    
    if (windowId === "vnRoom") {
        if (typeof window.setLocalSceneBackgroundFromDataUrl === "function") {
            window.setLocalSceneBackgroundFromDataUrl("");
        }
        return;
    }

    removeWindowBackgroundStyle(windowId);
}

export function applyWindowBackground(windowId, imageUrl) {
    if (windowId === "vnRoom") {
        if (typeof window.setLocalSceneBackgroundFromDataUrl === "function") {
            window.setLocalSceneBackgroundFromDataUrl(imageUrl);
        } else {
            // fallback if function isn't exposed properly
            $("#re-bg").css({
                "background-image": `url("${imageUrl}")`,
                "background-size": "cover",
                "background-position": "center"
            });
        }
        return;
    }

    // Remove existing style for this window
    removeWindowBackgroundStyle(windowId);
    
    if (!imageUrl) return;
    
    // Create new style
    const styleId = `window-bg-${windowId}`;
    const css = `
        #${windowId}, .${windowId} {
            background-image: url('${imageUrl}') !important;
            background-size: cover !important;
            background-position: center !important;
            background-repeat: no-repeat !important;
        }
    `;
    
    let styleElement = document.getElementById(styleId);
    if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = styleId;
        document.head.appendChild(styleElement);
    }
    styleElement.textContent = css;
}

function removeWindowBackgroundStyle(windowId) {
    const styleElement = document.getElementById(`window-bg-${windowId}`);
    if (styleElement) {
        styleElement.remove();
    }
}

export function showBackgroundPicker(windowId, windowTitle) {
    // Create background picker modal if it doesn't exist
    if (!$("#uie-background-picker-modal").length) {
        const modalHtml = '<div id="uie-background-picker-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:2147483647; align-items:center; justify-content:center; padding:20px;">' +
            '<div style="background:#1a1a1a; border:1px solid #444; border-radius:12px; padding:20px; width:100%; max-width:500px; color:#fff; box-shadow:0 20px 50px rgba(0,0,0,0.5); max-height:90vh; overflow-y:auto;">' +
                '<h3 style="margin:0 0 15px 0; color:#cba35c;">Background for ' + windowTitle + '</h3>' +
                
                '<div style="display:flex; gap:10px; margin-bottom:15px;">' +
                    '<button id="uie-bg-upload" style="flex:1; padding:8px; border:none; border-radius:6px; background:#3498db; color:#fff; cursor:pointer;">Upload Image</button>' +
                    '<button id="uie-bg-url" style="flex:1; padding:8px; border:none; border-radius:6px; background:#9b59b6; color:#fff; cursor:pointer;">From URL</button>' +
                    '<button id="uie-bg-remove" style="flex:1; padding:8px; border:none; border-radius:6px; background:#e74c3c; color:#fff; cursor:pointer;">Remove</button>' +
                '</div>' +
                
                '<div id="uie-bg-url-section" style="display:none; margin-bottom:15px;">' +
                    '<label style="display:block; margin-bottom:5px; font-weight:bold;">Image URL</label>' +
                    '<input type="text" id="uie-bg-url-input" placeholder="https://example.com/image.jpg" style="width:100%; padding:8px; border:1px solid #444; border-radius:6px; background:#2a2a2a; color:#fff;">' +
                    '<button id="uie-bg-url-apply" style="margin-top:8px; width:100%; padding:8px; border:none; border-radius:6px; background:#27ae60; color:#fff; cursor:pointer;">Apply URL</button>' +
                '</div>' +
                
                '<div id="uie-bg-preview" style="margin-bottom:15px;"></div>' +
                
                '<div style="display:flex; justify-content:flex-end; margin-top:15px;">' +
                    '<button id="uie-bg-picker-close" style="padding:8px 16px; border:none; border-radius:6px; background:#e74c3c; color:#fff; cursor:pointer;">Close</button>' +
                '</div>' +
            '</div>' +
        '</div>';
        $("body").append(modalHtml);

        const getCurrentWindowId = () => String($("#uie-background-picker-modal").data("currentWindow") || "").trim();
        
        // Add event handlers
        $(document).on("click.uieBgPicker", "#uie-bg-upload", function() {
            const input = $('<input type="file" accept="image/*">');
            input.on('change', function() {
                const file = this.files[0];
                if (!file) return;
                
                const reader = new FileReader();
                reader.onload = function(e) {
                    const imageUrl = e.target.result;
                    const currentWindowId = getCurrentWindowId();
                    if (!currentWindowId) return;
                    setWindowBackground(currentWindowId, imageUrl);
                    showBackgroundPreview(imageUrl);
                };
                reader.readAsDataURL(file);
            });
            input.click();
        });
        
        $(document).on("click.uieBgPicker", "#uie-bg-url", function() {
            $("#uie-bg-url-section").toggle();
        });
        
        $(document).on("click.uieBgPicker", "#uie-bg-url-apply", function() {
            const url = $("#uie-bg-url-input").val().trim();
            if (url) {
                const currentWindowId = getCurrentWindowId();
                if (!currentWindowId) return;
                setWindowBackground(currentWindowId, url);
                showBackgroundPreview(url);
            }
        });
        
        $(document).on("click.uieBgPicker", "#uie-bg-remove", function() {
            const currentWindowId = getCurrentWindowId();
            if (!currentWindowId) return;
            removeWindowBackground(currentWindowId);
            $("#uie-bg-preview").empty();
            showToast("Background removed.");
        });
        
        $(document).on("click.uieBgPicker", "#uie-bg-picker-close", function() {
            hideBackgroundPicker();
        });
        
        $(document).on("click.uieBgPicker", "#uie-background-picker-modal", function(e) {
            if (e.target === this) {
                hideBackgroundPicker();
            }
        });
    }
    
    // Store current window ID
    $("#uie-background-picker-modal").data("currentWindow", windowId);
    
    // Show current background if exists
    const backgrounds = getWindowBackgrounds();
    const currentBg = backgrounds[windowId];
    if (currentBg) {
        showBackgroundPreview(currentBg);
    } else {
        $("#uie-bg-preview").empty();
    }
    
    $("#uie-background-picker-modal").show();
}

function showBackgroundPreview(imageUrl) {
    const preview = $("#uie-bg-preview");
    preview.empty().append(`
        <div style="margin-bottom:8px; font-weight:bold;">Preview:</div>
        <img src="${imageUrl}" style="width:100%; max-height:200px; object-fit:cover; border-radius:6px; border:1px solid #444;" onerror="this.style.display='none';">
    `);
}

function hideBackgroundPicker() {
    $("#uie-background-picker-modal").hide();
    $("#uie-bg-url-section").hide();
    $("#uie-bg-url-input").val("");
}

export function initWindowBackgrounds() {
    // Apply all saved window backgrounds on load
    const backgrounds = getWindowBackgrounds();
    Object.keys(backgrounds).forEach(windowId => {
        applyWindowBackground(windowId, backgrounds[windowId]);
    });
}
