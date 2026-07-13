import { getSettings, saveSettings } from "../core.js";
import { notify } from "../notifications.js";

export function initBackgroundChanger() {
    if (window.UIE_backgroundChangerInited) return;
    window.UIE_backgroundChangerInited = true;

    injectBackgroundChangerUI();
    console.log("[UIE] Background Changer Initialized");
}

function injectBackgroundChangerUI() {
    const inject = () => {
        const menu = document.getElementById("re-st-menu");
        if (!menu) return false;
        
        if (document.getElementById("re-act-change-background")) return true;
        
        const menuItem = document.createElement("div");
        menuItem.className = "re-menu-item";
        menuItem.id = "re-act-change-background";
        menuItem.innerHTML = '<i class="fa-solid fa-image"></i> Change Background';
        menuItem.style.cursor = "pointer";
        
        menuItem.addEventListener("click", () => {
            showBackgroundChanger();
            hideMenu();
        });
        
        const scanAllItem = document.getElementById("re-act-scan-all");
        if (scanAllItem) {
            scanAllItem.parentNode.insertBefore(menuItem, scanAllItem.nextSibling);
        } else {
            menu.appendChild(menuItem);
        }
        
        return true;
    };

    if (!inject()) {
        setTimeout(inject, 500);
        setTimeout(inject, 1500);
        setTimeout(inject, 3000);
    }
}

function hideMenu() {
    const menu = document.getElementById("re-st-menu");
    if (menu) menu.style.display = "none";
}

function showBackgroundChanger() {
    if (!$("#uie-bg-changer-modal").length) {
        createBackgroundChangerModal();
    }
    
    updateBackgroundPreview();
    $("#uie-bg-changer-modal").css("display", "flex").hide().fadeIn(200);
}

function createBackgroundChangerModal() {
    const modalHtml = `
        <div id="uie-bg-changer-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:2147483647; align-items:center; justify-content:center; padding:20px;">
            <div style="background:rgba(12,16,22,0.92); border:1px solid rgba(203, 163, 92,0.55); border-radius:12px; width:100%; max-width:540px; color:#fff; box-shadow:0 20px 60px rgba(0,0,0,0.7); max-height:90vh; overflow:hidden; display:flex; flex-direction:column; backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px);">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px; border-bottom:1px solid rgba(203,163,92,0.28); flex:0 0 auto;">
                    <h3 style="margin:0; color:#cba35c; display:flex; align-items:center; gap:10px;">
                        <i class="fa-solid fa-image"></i> Background Manager
                    </h3>
                    <button id="uie-bg-changer-close" style="background:transparent; border:none; color:#e74c3c; font-size:24px; cursor:pointer; padding:0; width:32px; height:32px; display:flex; align-items:center; justify-content:center;">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div style="padding:18px; overflow-y:auto; min-height:0;">
                
                <div style="margin-bottom:20px; padding:12px; background:rgba(203, 163, 92,0.1); border-left:3px solid #cba35c; border-radius:6px; font-size:13px; line-height:1.5; color:#f6e7c8;">
                    <i class="fa-solid fa-info-circle"></i> Change the background for the current scene. Add your own images or use URLs.
                </div>
                
                <div id="uie-bg-current-preview" style="margin-bottom:20px;"></div>
                
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:20px;">
                    <button id="uie-bg-upload-btn" style="padding:12px; border:none; border-radius:10px; background:linear-gradient(135deg, #3498db, #2980b9); color:#fff; cursor:pointer; font-weight:bold; display:flex; align-items:center; justify-content:center; gap:8px; transition:all 0.2s;">
                        <i class="fa-solid fa-upload"></i> Upload Image
                    </button>
                    <button id="uie-bg-url-btn" style="padding:12px; border:none; border-radius:10px; background:linear-gradient(135deg, #9b59b6, #8e44ad); color:#fff; cursor:pointer; font-weight:bold; display:flex; align-items:center; justify-content:center; gap:8px; transition:all 0.2s;">
                        <i class="fa-solid fa-link"></i> From URL
                    </button>
                </div>
                
                <div id="uie-bg-url-section" style="display:none; margin-bottom:20px;">
                    <label style="display:block; margin-bottom:8px; font-weight:bold; color:#cba35c;">Image URL</label>
                    <input type="text" id="uie-bg-url-input" placeholder="https://example.com/image.jpg" style="width:100%; padding:10px; border:1px solid rgba(255,255,255,0.2); border-radius:8px; background:rgba(0,0,0,0.3); color:#fff; margin-bottom:10px;">
                    <button id="uie-bg-url-apply" style="width:100%; padding:10px; border:none; border-radius:8px; background:linear-gradient(135deg, #27ae60, #229954); color:#fff; cursor:pointer; font-weight:bold;">
                        <i class="fa-solid fa-check"></i> Apply URL
                    </button>
                </div>
                
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <button id="uie-bg-remove-btn" style="padding:12px; border:none; border-radius:10px; background:linear-gradient(135deg, #e74c3c, #c0392b); color:#fff; cursor:pointer; font-weight:bold; display:flex; align-items:center; justify-content:center; gap:8px;">
                        <i class="fa-solid fa-trash"></i> Remove
                    </button>
                    <button id="uie-bg-reset-btn" style="padding:12px; border:none; border-radius:10px; background:linear-gradient(135deg, #95a5a6, #7f8c8d); color:#fff; cursor:pointer; font-weight:bold; display:flex; align-items:center; justify-content:center; gap:8px;">
                        <i class="fa-solid fa-rotate-left"></i> Reset
                    </button>
                </div>
                </div>
            </div>
        </div>
    `;
    
    $("body").append(modalHtml);
    bindBackgroundChangerEvents();
}

function bindBackgroundChangerEvents() {
    $(document).off("click.uieBgChanger").on("click.uieBgChanger", "#uie-bg-changer-close", () => {
        $("#uie-bg-changer-modal").fadeOut(200);
    });
    
    $(document).on("click.uieBgChanger", "#uie-bg-changer-modal", function(e) {
        if (e.target === this) {
            $("#uie-bg-changer-modal").fadeOut(200);
        }
    });
    
    $(document).on("click.uieBgChanger", "#uie-bg-upload-btn", () => {
        const input = $('<input type="file" accept="image/*">');
        input.on('change', function() {
            const file = this.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = function(e) {
                const imageUrl = e.target.result;
                applyBackground(imageUrl);
                updateBackgroundPreview();
                notify("success", "Background uploaded successfully", "Background Manager");
            };
            reader.readAsDataURL(file);
        });
        input.click();
    });
    
    $(document).on("click.uieBgChanger", "#uie-bg-url-btn", () => {
        $("#uie-bg-url-section").slideToggle(200);
    });
    
    $(document).on("click.uieBgChanger", "#uie-bg-url-apply", () => {
        const url = $("#uie-bg-url-input").val().trim();
        if (url) {
            applyBackground(url);
            updateBackgroundPreview();
            $("#uie-bg-url-section").slideUp(200);
            $("#uie-bg-url-input").val("");
            notify("success", "Background applied from URL", "Background Manager");
        }
    });
    
    $(document).on("click.uieBgChanger", "#uie-bg-remove-btn", () => {
        removeBackground();
        updateBackgroundPreview();
        notify("info", "Background removed", "Background Manager");
    });
    
    $(document).on("click.uieBgChanger", "#uie-bg-reset-btn", () => {
        resetBackground();
        updateBackgroundPreview();
        notify("info", "Background reset to default", "Background Manager");
    });
}

function applyBackground(imageUrl) {
    const s = getSettings();
    if (!s.worldState) s.worldState = {};
    if (!s.worldState.customBackgrounds) s.worldState.customBackgrounds = {};
    
    const location = getCurrentLocation();
    s.worldState.customBackgrounds[location] = imageUrl;
    s.worldState.background = imageUrl;
    s.worldState.backgroundUrl = imageUrl;
    s.worldState.areaScenes = s.worldState.areaScenes || {};
    s.worldState.areaScenes[location] = s.worldState.areaScenes[location] || {};
    s.worldState.areaScenes[location].imageUrl = imageUrl;
    saveSettings();
    
    setBackgroundImage(imageUrl);
}

function removeBackground() {
    const s = getSettings();
    if (!s.worldState) s.worldState = {};
    if (!s.worldState.customBackgrounds) s.worldState.customBackgrounds = {};
    
    const location = getCurrentLocation();
    delete s.worldState.customBackgrounds[location];
    saveSettings();
    
    setBackgroundImage("");
}

function resetBackground() {
    removeBackground();
    
    if (typeof window.applyLocationBackground === "function") {
        const location = getCurrentLocation();
        window.applyLocationBackground(location.toLowerCase());
    }
}

function setBackgroundImage(imageUrl) {
    const bg = $("#re-bg");
    const root = $("#game-root");
    if (!bg.length && !root.length) return;
    
    if (!imageUrl) {
        bg.css("background-image", "");
        root.css("background-image", "");
        return;
    }
    
    bg.css({
        "background-image": `url("${imageUrl}")`,
        "background-size": "cover",
        "background-position": "center",
        "background-repeat": "no-repeat"
    });
    root.css({
        "background-image": `url("${imageUrl}")`,
        "background-size": "cover",
        "background-position": "center",
        "background-repeat": "no-repeat"
    });
}

function getCurrentLocation() {
    const s = getSettings();
    return String(s.worldState?.location || "Unknown Location").trim();
}

function getCurrentBackgroundUrl() {
    const s = getSettings();
    const location = getCurrentLocation();
    return s.worldState?.customBackgrounds?.[location] || "";
}

function updateBackgroundPreview() {
    const preview = $("#uie-bg-current-preview");
    if (!preview.length) return;
    
    const location = getCurrentLocation();
    const bgUrl = getCurrentBackgroundUrl();
    
    if (bgUrl) {
        preview.html(`
            <div style="margin-bottom:8px; font-weight:bold; color:#cba35c;">Current: ${escapeHtml(location)}</div>
            <img src="${escapeHtml(bgUrl)}" style="width:100%; max-height:200px; object-fit:cover; border-radius:10px; border:2px solid rgba(203, 163, 92,0.3);" onerror="this.style.display='none';">
        `);
    } else {
        preview.html(`
            <div style="padding:20px; text-align:center; background:rgba(255,255,255,0.05); border-radius:10px; border:1px dashed rgba(255,255,255,0.2);">
                <i class="fa-solid fa-image" style="font-size:48px; color:rgba(255,255,255,0.2); margin-bottom:10px;"></i>
                <div style="color:rgba(255,255,255,0.5); font-size:13px;">No custom background set</div>
                <div style="color:#cba35c; font-size:12px; margin-top:5px;">${escapeHtml(location)}</div>
            </div>
        `);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function loadCustomBackgrounds() {
    const s = getSettings();
    const location = getCurrentLocation();
    const bgUrl = s.worldState?.customBackgrounds?.[location];
    
    if (bgUrl) {
        setBackgroundImage(bgUrl);
    }
}
