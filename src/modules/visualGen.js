/**
 * visualGen.js - Frontend visual generation service
 * Handles image generation requests, status polling, and UI integration
 */

import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";

const VISUAL_SERVICE_URL = "./api/backend";
const POLL_INTERVAL = 2000;
const MAX_POLL_ATTEMPTS = 60;

const pendingVisuals = new Map();
const pollingIntervals = new Map();

const STYLE_PRESETS = {
    anime_game_art: "anime game art style, clean lineart, soft shading, colorful fantasy RPG visual, readable silhouette",
    manhwa_webtoon: "manhwa webtoon art style, clean polished digital art, dramatic lighting, stylish character rendering",
    dark_fantasy_anime: "dark fantasy anime art style, moody lighting, dramatic shadows, gothic fantasy atmosphere",
    modern_anime_vn: "modern anime visual novel art style, clean polished character art, expressive face, soft lighting",
    semi_realistic_fantasy: "semi-realistic fantasy game art, detailed but readable, cinematic lighting, grounded proportions",
    painterly_concept_art: "painterly fantasy concept art, atmospheric lighting, soft brushwork, game illustration style",
};

const ENTITY_TYPE_CONFIG = {
    npc: { label: "NPC Portrait", priority: 2 },
    skill: { label: "Skill Art", priority: 3 },
    location_bg: { label: "Location Background", priority: 1 },
    faction: { label: "Faction Visual", priority: 6 },
    quest: { label: "Quest Visual", priority: 4 },
    item_template: { label: "Item Image", priority: 5 },
    equipment_template: { label: "Equipment Image", priority: 5 },
    instavibe_profile_pic: { label: "InstaVibe Profile Pic", priority: 4 },
    instavibe_post_image: { label: "InstaVibe Post Image", priority: 2 },
    instavibe_story_image: { label: "InstaVibe Story Image", priority: 3 },
    message_image_attachment: { label: "Message Image", priority: 1 },
    group_message_image_attachment: { label: "Group Message Image", priority: 1 },
    character_selfie: { label: "Character Selfie", priority: 3 },
    location_photo: { label: "Location Photo", priority: 3 },
    food_photo: { label: "Food Photo", priority: 5 },
    outfit_photo: { label: "Outfit Photo", priority: 4 },
    item_photo: { label: "Item Photo", priority: 5 },
    event_photo: { label: "Event Photo", priority: 4 },
};

const MANUAL_ONLY_TYPES = new Set([
    "item_template",
    "equipment_template",
    "item_photo",
]);

export function isManualOnlyType(entityType) {
    return MANUAL_ONLY_TYPES.has(entityType);
}

export async function requestVisualGeneration(entityType, entityId, entityData = {}, options = {}) {
    if (isManualOnlyType(entityType)) {
        throw new Error(`${ENTITY_TYPE_CONFIG[entityType]?.label || entityType} requires manual upload. Use the file picker to add images.`);
    }

    const {
        provider = "auto",
        stylePreset = "",
        promptOverride = "",
        force = false,
        priority = 5,
        visualType = "",
        onStatusChange = null,
    } = options;

    const payload = {
        entity_type: entityType,
        entity_id: entityId,
        visual_type: visualType || entityType,
        entity_data: entityData,
        provider,
        style_preset: stylePreset,
        prompt_override: promptOverride,
        force,
        priority,
    };

    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.ok && result.visual) {
            const visualKey = result.visual.visual_key;

            if (result.visual.image_status === "pending" || result.visual.image_status === "generating") {
                startPolling(visualKey, onStatusChange);
            }

            return result.visual;
        }

        throw new Error(result.error || "Visual generation request failed");
    } catch (error) {
        console.error("[VisualGen] Request failed:", error);
        throw error;
    }
}

export async function getVisualStatus(visualKey) {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/status/${visualKey}`);

        if (!response.ok) {
            return null;
        }

        const result = await response.json();
        return result.ok ? result.visual : null;
    } catch (error) {
        console.error("[VisualGen] Status check failed:", error);
        return null;
    }
}

export async function regenerateVisual(entityType, entityId, entityData = {}, options = {}) {
    return requestVisualGeneration(entityType, entityId, entityData, { ...options, force: true });
}

export async function uploadVisualImage(visualKey, imageData, entityType = "", entityId = "") {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                visual_key: visualKey,
                image_data: imageData,
                entity_type: entityType,
                entity_id: entityId,
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.ok && result.visual) {
            stopPolling(visualKey);
            return result.visual;
        }

        throw new Error(result.error || "Upload failed");
    } catch (error) {
        console.error("[VisualGen] Upload failed:", error);
        throw error;
    }
}

export async function requestMessageImage(messageId, imageData = {}, options = {}) {
    const {
        provider = "auto",
        stylePreset = "",
        promptOverride = "",
        group = false,
        onStatusChange = null,
    } = options;

    const payload = {
        message_id: messageId,
        attachment_id: imageData.attachment_id || "0",
        sender_id: imageData.sender_id || "",
        subject: imageData.subject || "",
        context: imageData.context || "",
        message_type: imageData.message_type || "photo",
        group,
        provider,
        style_preset: stylePreset,
        prompt_override: promptOverride,
        entity_data: imageData,
    };

    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/message_image`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.ok && result.visual) {
            const visualKey = result.visual.visual_key;
            if (result.visual.image_status === "pending" || result.visual.image_status === "generating") {
                startPolling(visualKey, onStatusChange);
            }
            return result.visual;
        }

        throw new Error(result.error || "Message image generation failed");
    } catch (error) {
        console.error("[VisualGen] Message image request failed:", error);
        throw error;
    }
}

export async function requestInstavibeProfilePic(characterId, characterData = {}, options = {}) {
    return requestVisualGeneration("instavibe_profile_pic", characterId, characterData, {
        visualType: "instavibe_profile_pic",
        priority: 4,
        ...options,
    });
}

export async function requestInstavibePostImage(postId, postData = {}, options = {}) {
    return requestVisualGeneration("instavibe_post_image", postId, postData, {
        visualType: "instavibe_post_image",
        priority: 2,
        ...options,
    });
}

function startPolling(visualKey, onStatusChange = null) {
    if (pollingIntervals.has(visualKey)) {
        return;
    }

    let attempts = 0;

    const interval = setInterval(async () => {
        attempts++;

        const status = await getVisualStatus(visualKey);

        if (!status) {
            if (attempts >= MAX_POLL_ATTEMPTS) {
                stopPolling(visualKey);
                if (onStatusChange) {
                    onStatusChange({ visual_key: visualKey, image_status: "failed", image_error: "Polling timeout" });
                }
            }
            return;
        }

        if (onStatusChange) {
            onStatusChange(status);
        }

        updateVisualUI(visualKey, status);

        if (status.image_status === "complete" || status.image_status === "ready" || status.image_status === "failed") {
            stopPolling(visualKey);

            if (status.image_status === "complete" || status.image_status === "ready") {
                notify("success", "Image generated successfully", "Visual Gen");
            } else if (status.image_status === "failed") {
                notify("error", `Image generation failed: ${status.image_error || "Unknown error"}`, "Visual Gen");
            }
        }

        if (attempts >= MAX_POLL_ATTEMPTS) {
            stopPolling(visualKey);
        }
    }, POLL_INTERVAL);

    pollingIntervals.set(visualKey, interval);
}

function stopPolling(visualKey) {
    const interval = pollingIntervals.get(visualKey);
    if (interval) {
        clearInterval(interval);
        pollingIntervals.delete(visualKey);
    }
}

function updateVisualUI(visualKey, status) {
    const elements = document.querySelectorAll(`[data-visual-key="${visualKey}"]`);

    elements.forEach(element => {
        const currentStatus = status.image_status;

        if ((currentStatus === "complete" || currentStatus === "ready") && status.image_url) {
            const img = element.querySelector("img") || document.createElement("img");
            img.src = status.image_url;
            img.alt = status.image_prompt || "Generated image";

            if (!element.querySelector("img")) {
                element.innerHTML = "";
                element.appendChild(img);
            }

            element.dataset.visualStatus = "ready";
            element.classList.remove("visual-pending", "visual-generating", "visual-failed");
            element.classList.add("visual-ready");

        } else if (currentStatus === "generating" || currentStatus === "pending") {
            element.dataset.visualStatus = currentStatus;
            element.classList.remove("visual-ready", "visual-failed");
            element.classList.add(currentStatus === "generating" ? "visual-generating" : "visual-pending");

        } else if (currentStatus === "failed") {
            element.dataset.visualStatus = "failed";
            element.classList.remove("visual-ready", "visual-pending", "visual-generating");
            element.classList.add("visual-failed");

            const errorEl = element.querySelector(".visual-error") || document.createElement("div");
            errorEl.className = "visual-error";
            errorEl.textContent = status.image_error || "Generation failed";
            errorEl.title = "Click to retry";
            errorEl.onclick = () => retryVisualGeneration(visualKey, element);

            if (!element.querySelector(".visual-error")) {
                element.appendChild(errorEl);
            }
        }
    });
}

async function retryVisualGeneration(visualKey, element) {
    const entityType = element.dataset.entityType;
    const entityId = element.dataset.entityId;
    const entityData = JSON.parse(element.dataset.entityData || "{}");

    try {
        await regenerateVisual(entityType, entityId, entityData, {
            onStatusChange: (status) => updateVisualUI(visualKey, status),
        });
    } catch (error) {
        notify("error", "Failed to retry generation", "Visual Gen");
    }
}

export function createVisualContainer(entityType, entityId, entityData = {}, options = {}) {
    const {
        width = "100%",
        height = "auto",
        className = "",
        autoGenerate = true,
        stylePreset = "",
        showControls = true,
    } = options;

    const container = document.createElement("div");
    container.className = `visual-container visual-pending ${className}`;
    container.dataset.entityType = entityType;
    container.dataset.entityId = entityId;
    container.dataset.entityData = JSON.stringify(entityData);
    container.dataset.visualType = entityType;
    container.style.width = width;
    container.style.height = height;
    container.style.position = "relative";
    container.style.overflow = "hidden";
    container.style.background = "rgba(0,0,0,0.2)";
    container.style.borderRadius = "8px";
    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.justifyContent = "center";

    const spinner = document.createElement("div");
    spinner.className = "visual-spinner";
    spinner.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    spinner.style.fontSize = "24px";
    spinner.style.color = "#cba35c";
    container.appendChild(spinner);

    if (showControls) {
        const controlsBar = document.createElement("div");
        controlsBar.className = "visual-controls-bar";
        controlsBar.style.position = "absolute";
        controlsBar.style.top = "4px";
        controlsBar.style.right = "4px";
        controlsBar.style.display = "flex";
        controlsBar.style.gap = "4px";
        controlsBar.style.zIndex = "2";

        const regenBtn = document.createElement("button");
        regenBtn.className = "visual-regen-btn";
        regenBtn.innerHTML = `<i class="fa-solid fa-rotate"></i>`;
        regenBtn.title = "Regenerate image";
        regenBtn.style.cssText = "width:28px;height:28px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.5);color:#fff;cursor:pointer;display:none;font-size:12px;";
        regenBtn.onclick = async () => {
            const vk = container.dataset.visualKey;
            if (vk) {
                await retryVisualGeneration(vk, container);
            }
        };
        controlsBar.appendChild(regenBtn);

        const uploadBtn = document.createElement("button");
        uploadBtn.className = "visual-upload-btn";
        uploadBtn.innerHTML = `<i class="fa-solid fa-upload"></i>`;
        uploadBtn.title = "Upload custom image";
        uploadBtn.style.cssText = "width:28px;height:28px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.5);color:#fff;cursor:pointer;font-size:12px;";
        uploadBtn.onclick = () => {
            const fileInput = document.createElement("input");
            fileInput.type = "file";
            fileInput.accept = "image/*";
            fileInput.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    const vk = container.dataset.visualKey;
                    if (vk) {
                        try {
                            await uploadVisualImage(vk, ev.target.result, entityType, entityId);
                            notify("success", "Image uploaded", "Visual Gen");
                        } catch (err) {
                            notify("error", "Upload failed", "Visual Gen");
                        }
                    }
                };
                reader.readAsDataURL(file);
            };
            fileInput.click();
        };
        controlsBar.appendChild(uploadBtn);

        container.appendChild(controlsBar);
        container._regenBtn = regenBtn;
    }

    if (autoGenerate) {
        requestVisualGeneration(entityType, entityId, entityData, {
            stylePreset,
            onStatusChange: (status) => {
                container.dataset.visualKey = status.visual_key;
                updateVisualUI(status.visual_key, status);

                if (status.image_status === "complete" || status.image_status === "ready") {
                    if (container._regenBtn) {
                        container._regenBtn.style.display = "block";
                    }
                    spinner.style.display = "none";
                }
            },
        });
    }

    return container;
}

export function createMessageImageCard(messageId, imageData = {}, options = {}) {
    const {
        width = "200px",
        height = "200px",
        group = false,
        onStatusChange = null,
    } = options;

    const card = document.createElement("div");
    card.className = "visual-container visual-pending message-image-card";
    card.dataset.entityType = group ? "group_message_image_attachment" : "message_image_attachment";
    card.dataset.entityId = messageId;
    card.dataset.entityData = JSON.stringify(imageData);
    card.style.width = width;
    card.style.height = height;
    card.style.position = "relative";
    card.style.overflow = "hidden";
    card.style.background = "rgba(0,0,0,0.15)";
    card.style.borderRadius = "12px";
    card.style.display = "flex";
    card.style.alignItems = "center";
    card.style.justifyContent = "center";

    const spinner = document.createElement("div");
    spinner.className = "visual-spinner";
    spinner.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    spinner.style.fontSize = "20px";
    spinner.style.color = "#cba35c";
    card.appendChild(spinner);

    const retryBtn = document.createElement("button");
    retryBtn.className = "visual-retry-btn";
    retryBtn.innerHTML = `<i class="fa-solid fa-rotate"></i> Retry`;
    retryBtn.style.cssText = "position:absolute;bottom:4px;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.5);color:#fff;cursor:pointer;font-size:11px;display:none;";
    card.appendChild(retryBtn);

    requestMessageImage(messageId, imageData, {
        group,
        onStatusChange: (status) => {
            card.dataset.visualKey = status.visual_key;
            updateVisualUI(status.visual_key, status);

            if (status.image_status === "complete" || status.image_status === "ready") {
                spinner.style.display = "none";
                retryBtn.style.display = "none";
            } else if (status.image_status === "failed") {
                spinner.style.display = "none";
                retryBtn.style.display = "block";
                retryBtn.onclick = async () => {
                    retryBtn.style.display = "none";
                    spinner.style.display = "block";
                    card.classList.remove("visual-failed");
                    card.classList.add("visual-pending");
                    await requestMessageImage(messageId, imageData, {
                        group,
                        onStatusChange: (s) => {
                            card.dataset.visualKey = s.visual_key;
                            updateVisualUI(s.visual_key, s);
                        },
                    });
                };
            }

            if (onStatusChange) {
                onStatusChange(status);
            }
        },
    });

    return card;
}

export function createInstavibePostImageCard(postId, postData = {}, options = {}) {
    return createVisualContainer("instavibe_post_image", postId, postData, {
        visualType: "instavibe_post_image",
        priority: 2,
        ...options,
    });
}

export function createInstavibeProfilePic(characterId, characterData = {}, options = {}) {
    return createVisualContainer("instavibe_profile_pic", characterId, characterData, {
        visualType: "instavibe_profile_pic",
        priority: 4,
        width: "64px",
        height: "64px",
        ...options,
    });
}

export function initVisualForEntity(entityType, entityId, entityData = {}, containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) {
        console.warn(`[VisualGen] Container not found: ${containerSelector}`);
        return;
    }

    container.dataset.entityType = entityType;
    container.dataset.entityId = entityId;
    container.dataset.entityData = JSON.stringify(entityData);

    const visualKey = generateVisualKey(entityType, entityId, entityData);
    container.dataset.visualKey = visualKey;

    requestVisualGeneration(entityType, entityId, entityData, {
        onStatusChange: (status) => updateVisualUI(visualKey, status),
    });
}

function generateVisualKey(entityType, entityId, entityData = {}) {
    if (entityType === "npc") {
        const name = entityData.name || entityId;
        return `npc_${simpleHash(name)}`;
    } else if (entityType === "location_bg") {
        return `location_bg_${entityData.id || entityId}`;
    } else if (entityType === "skill") {
        const element = entityData.element || "generic";
        const type = entityData.type || "ability";
        const slug = (entityData.name || entityId).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 20);
        return `skill_${element}_${type}_${slug}`;
    } else if (entityType === "instavibe_profile_pic") {
        return `instavibe_profile_${entityData.character_id || entityId}`;
    } else if (entityType === "instavibe_post_image") {
        return `instavibe_post_${entityData.post_id || entityId}`;
    } else if (entityType === "message_image_attachment") {
        return `message_img_${entityData.message_id || entityId}_${entityData.attachment_id || "0"}`;
    }

    return `${entityType}_${entityId}`;
}

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16).slice(0, 16);
}

export async function getVisualSettings() {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/settings`);
        const result = await response.json();
        return result.ok ? result.settings : null;
    } catch (error) {
        console.error("[VisualGen] Failed to get settings:", error);
        return null;
    }
}

export async function updateVisualSettings(settings) {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/settings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(settings),
        });
        const result = await response.json();
        return result.ok;
    } catch (error) {
        console.error("[VisualGen] Failed to update settings:", error);
        return false;
    }
}

export async function pushUserApiToBackend() {
    try {
        const settings = getSettings();
        const imageSettings = settings?.image || {};
        
        const payload = {
            provider: imageSettings.provider || "",
            url: imageSettings.url || "",
            key: imageSettings.key || "",
            model: imageSettings.model || "",
            connected: Boolean(imageSettings.url && imageSettings.key),
            hybridMode: imageSettings.hybridMode === true,
            hybridKojiCategories: imageSettings.hybridKojiCategories || {},
            autoGenerateCategories: imageSettings.autoGenerateCategories || {},
        };
        
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/settings/user-api`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        return result.ok;
    } catch (error) {
        console.error("[VisualGen] Failed to push user API settings:", error);
        return false;
    }
}

export async function getStylePresets() {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/style_presets`);
        const result = await response.json();
        return result.ok ? result : { style_presets: STYLE_PRESETS, available_style_presets: Object.keys(STYLE_PRESETS), default_style_preset: "anime_game_art" };
    } catch (error) {
        console.error("[VisualGen] Failed to get style presets:", error);
        return { style_presets: STYLE_PRESETS, available_style_presets: Object.keys(STYLE_PRESETS), default_style_preset: "anime_game_art" };
    }
}

export function getEntityTypeLabel(entityType) {
    return ENTITY_TYPE_CONFIG[entityType]?.label || entityType;
}

export function initVisualGen() {
    console.log("[VisualGen] Visual generation service initialized");

    const style = document.createElement("style");
    style.textContent = `
        .visual-container {
            transition: all 0.3s ease;
        }
        .visual-pending {
            background: linear-gradient(90deg, rgba(203,163,92,0.1) 0%, rgba(203,163,92,0.2) 50%, rgba(203,163,92,0.1) 100%);
            background-size: 200% 100%;
            animation: visual-shimmer 1.5s infinite;
        }
        .visual-generating {
            background: linear-gradient(90deg, rgba(14,165,233,0.1) 0%, rgba(14,165,233,0.2) 50%, rgba(14,165,233,0.1) 100%);
            background-size: 200% 100%;
            animation: visual-shimmer 1.5s infinite;
        }
        .visual-ready img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .visual-failed {
            background: rgba(239,68,68,0.1);
            border: 1px solid rgba(239,68,68,0.3);
        }
        .visual-error {
            position: absolute;
            bottom: 4px;
            left: 4px;
            right: 4px;
            padding: 4px 8px;
            background: rgba(239,68,68,0.8);
            color: #fff;
            font-size: 10px;
            border-radius: 4px;
            cursor: pointer;
        }
        .visual-regen-btn:hover,
        .visual-upload-btn:hover {
            background: rgba(203,163,92,0.8) !important;
        }
        .message-image-card {
            border-radius: 12px;
        }
        .visual-controls-bar button {
            transition: background 0.2s;
        }
        @keyframes visual-shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }
        .visual-settings-panel {
            padding: 16px;
            background: rgba(0,0,0,0.15);
            border-radius: 8px;
            margin: 8px 0;
        }
        .visual-settings-panel h3 {
            margin: 0 0 12px 0;
            font-size: 14px;
            color: #cba35c;
        }
        .visual-settings-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            flex-wrap: wrap;
        }
        .visual-settings-row label {
            min-width: 140px;
            font-size: 12px;
            color: #ccc;
        }
        .visual-settings-row select,
        .visual-settings-row input[type="text"],
        .visual-settings-row input[type="password"],
        .visual-settings-row input[type="url"] {
            background: rgba(0,0,0,0.3);
            border: 1px solid rgba(255,255,255,0.15);
            border-radius: 4px;
            color: #eee;
            padding: 4px 8px;
            font-size: 12px;
            flex: 1;
            min-width: 120px;
        }
        .visual-settings-row select:focus,
        .visual-settings-row input:focus {
            outline: none;
            border-color: #cba35c;
        }
        .visual-model-status {
            display: flex;
            gap: 12px;
            margin: 8px 0;
            flex-wrap: wrap;
        }
        .visual-model-card {
            padding: 8px 12px;
            border-radius: 6px;
            background: rgba(0,0,0,0.2);
            border: 1px solid rgba(255,255,255,0.1);
            font-size: 11px;
            min-width: 160px;
        }
        .visual-model-card.available {
            border-color: rgba(34,197,94,0.4);
        }
        .visual-model-card.unavailable {
            border-color: rgba(239,68,68,0.3);
        }
        .visual-model-card.downloading {
            border-color: rgba(14,165,233,0.4);
        }
        .visual-model-card .model-name {
            font-weight: bold;
            color: #cba35c;
            margin-bottom: 4px;
        }
        .visual-model-card .model-status {
            color: #aaa;
        }
        .visual-model-card .model-status.ok { color: #22c55e; }
        .visual-model-card .model-status.error { color: #ef4444; }
        .visual-model-card .model-status.pending { color: #0ea5e9; }
        .visual-btn {
            padding: 4px 12px;
            border-radius: 4px;
            border: 1px solid rgba(203,163,92,0.4);
            background: rgba(203,163,92,0.15);
            color: #cba35c;
            cursor: pointer;
            font-size: 11px;
            transition: background 0.2s;
        }
        .visual-btn:hover {
            background: rgba(203,163,92,0.3);
        }
        .visual-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .visual-prompt-editor {
            margin: 8px 0;
        }
        .visual-prompt-editor textarea {
            width: 100%;
            min-height: 60px;
            background: rgba(0,0,0,0.3);
            border: 1px solid rgba(255,255,255,0.15);
            border-radius: 4px;
            color: #eee;
            padding: 6px 8px;
            font-size: 11px;
            font-family: monospace;
            resize: vertical;
        }
        .visual-prompt-editor textarea:focus {
            outline: none;
            border-color: #cba35c;
        }
        .visual-prompt-vars {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-top: 4px;
        }
        .visual-prompt-vars span {
            padding: 2px 6px;
            background: rgba(203,163,92,0.1);
            border: 1px solid rgba(203,163,92,0.2);
            border-radius: 3px;
            font-size: 10px;
            color: #cba35c;
            cursor: pointer;
        }
        .visual-prompt-vars span:hover {
            background: rgba(203,163,92,0.25);
        }
        .visual-custom-model-section {
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid rgba(255,255,255,0.1);
        }
    `;
    document.head.appendChild(style);

    pushUserApiToBackend();
}


export async function getModelStatus() {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/models/status`);
        if (!response.ok) return null;
        const result = await response.json();
        return result.ok ? result : null;
    } catch (error) {
        console.error("[VisualGen] Failed to get model status:", error);
        return null;
    }
}


export async function downloadKoji() {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/models/koji/download`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        const result = await response.json();
        return result;
    } catch (error) {
        console.error("[VisualGen] Koji download failed:", error);
        return { ok: false, error: String(error) };
    }
}


export async function downloadKojiAsync() {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/models/koji/download-async`, {
            method: "POST",
        });
        return await response.json();
    } catch (error) {
        return { ok: false, error: String(error) };
    }
}


export async function getKojiDownloadState() {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/models/koji/download-state`);
        const result = await response.json();
        // The endpoint wraps the state in { ok, state }; expose the actual
        // state object so every caller can render its progress correctly.
        return result?.state || result;
    } catch (error) {
        return { ok: false, error: String(error) };
    }
}


export async function getPromptTemplates() {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/prompt-templates`);
        const result = await response.json();
        return result.ok ? result : null;
    } catch (error) {
        console.error("[VisualGen] Failed to get prompt templates:", error);
        return null;
    }
}


export async function updatePromptTemplates(templates, negativePrompts = {}) {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/prompt-templates`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ templates, negative_prompts: negativePrompts }),
        });
        const result = await response.json();
        return result.ok;
    } catch (error) {
        console.error("[VisualGen] Failed to update prompt templates:", error);
        return false;
    }
}


export async function testCustomModel() {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/test-custom-model`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        return await response.json();
    } catch (error) {
        return { ok: false, error: String(error) };
    }
}


export async function testPrompt(entityType, entityData = {}, stylePreset = "", model = "koji") {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/test-prompt`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                entity_type: entityType,
                entity_data: entityData,
                style_preset: stylePreset,
                model,
            }),
        });
        return await response.json();
    } catch (error) {
        return { ok: false, error: String(error) };
    }
}

export async function generateWithKoji(prompt, options = {}) {
    const { width = 1024, height = 1024, stylePreset = "" } = options;
    
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                entity_type: "npc",
                entity_id: `koji_${Date.now()}`,
                visual_type: "koji_generation",
                entity_data: { prompt, width, height },
                provider: "built_in_backend",
                style_preset: stylePreset,
                prompt_override: prompt,
                force: true,
                priority: 10,
                model: "koji",
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.ok && result.visual) {
            const visualKey = result.visual.visual_key;
            
            if (result.visual.image_status === "ready" && result.visual.image_url) {
                return { ok: true, dataUrl: result.visual.image_url };
            }
            
            // Poll for completion
            for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
                await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
                const status = await getVisualStatus(visualKey);
                
                if (status.ok && status.visual) {
                    if (status.visual.image_status === "ready" && status.visual.image_url) {
                        return { ok: true, dataUrl: status.visual.image_url };
                    }
                    if (status.visual.image_status === "failed") {
                        throw new Error(status.visual.error || "Koji generation failed");
                    }
                }
            }
            
            throw new Error("Koji generation timed out");
        }

        throw new Error(result.error || "Koji generation request failed");
    } catch (error) {
        return { ok: false, error: String(error?.message || error) };
    }
}


export function createVisualSettingsPanel(container, options = {}) {
    const {
        onSettingsChange = null,
        onDownloadKoji = null,
    } = options;

    const panel = document.createElement("div");
    panel.className = "visual-settings-panel";

    const title = document.createElement("h3");
    title.textContent = "Visual Generation";
    panel.appendChild(title);

    const backendRow = document.createElement("div");
    backendRow.className = "visual-settings-row";
    const backendLabel = document.createElement("label");
    backendLabel.textContent = "Built-In Backend";
    const backendSelect = document.createElement("select");
    backendSelect.innerHTML = `
        <option value="built_in_backend">Built-In Backend</option>
        <option value="custom_model">Custom Model</option>
    `;
    backendSelect.value = "built_in_backend";
    backendSelect.addEventListener("change", () => {
        const val = backendSelect.value;
        updateVisualSettings({ visual_backend_mode: val });
        customSection.style.display = val === "custom_model" ? "block" : "none";
        if (onSettingsChange) onSettingsChange({ visual_backend_mode: val });
    });
    backendRow.appendChild(backendLabel);
    backendRow.appendChild(backendSelect);
    panel.appendChild(backendRow);

    const qualityRow = document.createElement("div");
    qualityRow.className = "visual-settings-row";
    const qualityLabel = document.createElement("label");
    qualityLabel.textContent = "Quality Mode";
    const qualitySelect = document.createElement("select");
    qualitySelect.innerHTML = `
        <option value="fast">Fast (fewer steps)</option>
        <option value="balanced">Balanced (standard)</option>
        <option value="quality">Quality (more steps)</option>
    `;
    qualitySelect.value = "balanced";
    qualitySelect.addEventListener("change", () => {
        updateVisualSettings({ visual_quality_mode: qualitySelect.value });
        if (onSettingsChange) onSettingsChange({ visual_quality_mode: qualitySelect.value });
    });
    qualityRow.appendChild(qualityLabel);
    qualityRow.appendChild(qualitySelect);
    panel.appendChild(qualityRow);

    const upscalingRow = document.createElement("div");
    upscalingRow.className = "visual-settings-row";
    const upscalingLabel = document.createElement("label");
    upscalingLabel.textContent = "Visual Upscaling";
    const upscalingSelect = document.createElement("select");
    upscalingSelect.innerHTML = `
        <option value="off">Off</option>
        <option value="anime">Anime (Recommended)</option>
    `;
    upscalingSelect.value = "off";
    upscalingSelect.addEventListener("change", () => {
        updateVisualSettings({ upscaling_mode: upscalingSelect.value });
        if (onSettingsChange) onSettingsChange({ upscaling_mode: upscalingSelect.value });
        upscalerStatusDiv.style.display = upscalingSelect.value !== "off" ? "block" : "none";
        if (upscalingSelect.value !== "off") {
            refreshUpscalerStatus(upscalerStatusDiv);
        }
    });
    upscalingRow.appendChild(upscalingLabel);
    upscalingRow.appendChild(upscalingSelect);
    panel.appendChild(upscalingRow);

    const upscalerStatusDiv = document.createElement("div");
    upscalerStatusDiv.className = "visual-upscaler-status";
    upscalerStatusDiv.style.display = "none";
    panel.appendChild(upscalerStatusDiv);

    const styleRow = document.createElement("div");
    styleRow.className = "visual-settings-row";
    const styleLabel = document.createElement("label");
    styleLabel.textContent = "Default Style Preset";
    const styleSelect = document.createElement("select");
    for (const [key, desc] of Object.entries(STYLE_PRESETS)) {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        styleSelect.appendChild(opt);
    }
    styleSelect.value = "anime_game_art";
    styleSelect.addEventListener("change", () => {
        updateVisualSettings({ default_style_preset: styleSelect.value });
        if (onSettingsChange) onSettingsChange({ default_style_preset: styleSelect.value });
    });
    styleRow.appendChild(styleLabel);
    styleRow.appendChild(styleSelect);
    panel.appendChild(styleRow);

    const modelStatusDiv = document.createElement("div");
    modelStatusDiv.className = "visual-model-status";
    panel.appendChild(modelStatusDiv);

    const customSection = document.createElement("div");
    customSection.className = "visual-custom-model-section";
    customSection.style.display = "none";

    const customTitle = document.createElement("h4");
    customTitle.textContent = "Custom Model Configuration";
    customTitle.style.cssText = "font-size:12px;color:#cba35c;margin:0 0 8px 0;";
    customSection.appendChild(customTitle);

    const fields = [
        { key: "custom_model_provider", label: "Provider Name", type: "text", placeholder: "ComfyUI / Qwen / Custom" },
        { key: "custom_model_base_url", label: "Base URL / Endpoint", type: "url", placeholder: "http://localhost:8188" },
        { key: "custom_model_auth_type", label: "Auth Type", type: "select", options: ["none", "bearer", "basic", "header"] },
        { key: "custom_model_api_key", label: "API Key / Token", type: "password", placeholder: "sk-..." },
    ];

    for (const field of fields) {
        const row = document.createElement("div");
        row.className = "visual-settings-row";
        const label = document.createElement("label");
        label.textContent = field.label;
        let input;
        if (field.type === "select") {
            input = document.createElement("select");
            for (const opt of field.options) {
                const o = document.createElement("option");
                o.value = opt;
                o.textContent = opt;
                input.appendChild(o);
            }
        } else {
            input = document.createElement("input");
            input.type = field.type;
            input.placeholder = field.placeholder || "";
        }
        input.dataset.settingKey = field.key;
        input.addEventListener("change", () => {
            const update = {};
            update[field.key] = input.value;
            updateVisualSettings(update);
        });
        row.appendChild(label);
        row.appendChild(input);
        customSection.appendChild(row);
    }

    const testBtn = document.createElement("button");
    testBtn.className = "visual-btn";
    testBtn.textContent = "Test Connection";
    testBtn.style.marginTop = "8px";
    testBtn.addEventListener("click", async () => {
        testBtn.disabled = true;
        testBtn.textContent = "Testing...";
        const result = await testCustomModel();
        testBtn.disabled = false;
        testBtn.textContent = "Test Connection";
        if (result.ok) {
            notify("success", "Custom model connection successful", "Visual Gen");
        } else {
            notify("error", `Connection failed: ${result.error || "Unknown error"}`, "Visual Gen");
        }
    });
    customSection.appendChild(testBtn);
    panel.appendChild(customSection);

    const promptSection = document.createElement("div");
    promptSection.style.marginTop = "12px";
    const promptTitle = document.createElement("h4");
    promptTitle.textContent = "Prompt Templates";
    promptTitle.style.cssText = "font-size:12px;color:#cba35c;margin:0 0 8px 0;";
    promptSection.appendChild(promptTitle);

    const promptTypeSelect = document.createElement("select");
    promptTypeSelect.style.cssText = "width:100%;margin-bottom:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#eee;padding:4px 8px;font-size:12px;";
    for (const [key, config] of Object.entries(ENTITY_TYPE_CONFIG)) {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = config.label;
        promptTypeSelect.appendChild(opt);
    }
    promptSection.appendChild(promptTypeSelect);

    const promptTextarea = document.createElement("textarea");
    promptTextarea.className = "visual-prompt-editor";
    promptTextarea.rows = 3;
    promptTextarea.placeholder = "Enter prompt template with {variables}...";
    promptSection.appendChild(promptTextarea);

    const varsDiv = document.createElement("div");
    varsDiv.className = "visual-prompt-vars";
    const variables = [
        "style_preset", "name", "role", "age", "gender", "hair", "expression",
        "clothing", "location", "mood", "lighting", "item_name", "material",
        "color", "element", "skill_type", "visual_effect", "quest_theme",
        "faction_type", "symbol", "caption", "message_context", "world_style",
    ];
    for (const v of variables) {
        const tag = document.createElement("span");
        tag.textContent = `{${v}}`;
        tag.title = `Click to insert ${v} variable`;
        tag.addEventListener("click", () => {
            const pos = promptTextarea.selectionStart;
            const before = promptTextarea.value.substring(0, pos);
            const after = promptTextarea.value.substring(pos);
            promptTextarea.value = `${before}{${v}}${after}`;
            promptTextarea.focus();
            promptTextarea.selectionStart = promptTextarea.selectionEnd = pos + v.length + 2;
        });
        varsDiv.appendChild(tag);
    }
    promptSection.appendChild(varsDiv);

    const promptBtnRow = document.createElement("div");
    promptBtnRow.style.cssText = "display:flex;gap:8px;margin-top:8px;";
    const savePromptBtn = document.createElement("button");
    savePromptBtn.className = "visual-btn";
    savePromptBtn.textContent = "Save Template";
    savePromptBtn.addEventListener("click", async () => {
        const entityType = promptTypeSelect.value;
        const template = promptTextarea.value;
        if (!template.trim()) return;
        const templates = {};
        templates[entityType] = template;
        const ok = await updatePromptTemplates(templates);
        if (ok) {
            notify("success", `Template saved for ${ENTITY_TYPE_CONFIG[entityType]?.label || entityType}`, "Visual Gen");
        } else {
            notify("error", "Failed to save template", "Visual Gen");
        }
    });
    const resetPromptBtn = document.createElement("button");
    resetPromptBtn.className = "visual-btn";
    resetPromptBtn.textContent = "Reset to Default";
    resetPromptBtn.addEventListener("click", async () => {
        const templates = await getPromptTemplates();
        if (templates) {
            const entityType = promptTypeSelect.value;
            const defaultTemplate = templates.default_templates?.[entityType] || "";
            promptTextarea.value = defaultTemplate;
        }
    });
    const testPromptBtn = document.createElement("button");
    testPromptBtn.className = "visual-btn";
    testPromptBtn.textContent = "Test Prompt";
    testPromptBtn.addEventListener("click", async () => {
        const entityType = promptTypeSelect.value;
        const result = await testPrompt(entityType, { name: "Test", role: "NPC", location: "Tavern" });
        if (result.ok) {
            notify("info", `Preview: ${result.rendered_prompt?.substring(0, 120)}...`, "Visual Gen");
        }
    });
    promptBtnRow.appendChild(savePromptBtn);
    promptBtnRow.appendChild(resetPromptBtn);
    promptBtnRow.appendChild(testPromptBtn);
    promptSection.appendChild(promptBtnRow);
    panel.appendChild(promptSection);

    getVisualSettings().then(settings => {
        if (settings) {
            const s = settings.settings || settings;
            backendSelect.value = s.visual_backend_mode || "built_in_backend";
            qualitySelect.value = s.visual_quality_mode || "balanced";
            styleSelect.value = s.default_style_preset || "anime_game_art";
            upscalingSelect.value = s.upscaling_mode || "off";
            customSection.style.display = (s.visual_backend_mode || "built_in_backend") === "custom_model" ? "block" : "none";
            upscalerStatusDiv.style.display = (s.upscaling_mode || "off") !== "off" ? "block" : "none";
            for (const field of fields) {
                const input = customSection.querySelector(`[data-setting-key="${field.key}"]`);
                if (input && s[field.key] != null) {
                    input.value = s[field.key];
                }
            }
            if ((s.upscaling_mode || "off") !== "off") {
                refreshUpscalerStatus(upscalerStatusDiv);
            }
        }
    });

    refreshModelStatus(modelStatusDiv);

    return panel;
}


async function refreshModelStatus(container) {
    container.innerHTML = "";

    const status = await getModelStatus();
    if (!status) {
        container.innerHTML = `<div style="font-size:11px;color:#888;">Could not load model status</div>`;
        return;
    }

    const models = [
        {
            key: "koji",
            label: "Koji",
            info: status.koji,
        },
    ];

    for (const model of models) {
        const card = document.createElement("div");
        const info = model.info || {};
        const isAvailable = info.available;
        const isDownloading = status.koji_download_state?.status === "downloading" && model.key === "koji";
        card.className = `visual-model-card ${isAvailable ? "available" : isDownloading ? "downloading" : "unavailable"}`;

        const nameEl = document.createElement("div");
        nameEl.className = "model-name";
        nameEl.textContent = model.label;
        card.appendChild(nameEl);

        const statusEl = document.createElement("div");
        statusEl.className = "model-status";
        if (isAvailable) {
            statusEl.className += " ok";
            statusEl.textContent = "Available";
        } else if (isDownloading) {
            statusEl.className += " pending";
            const progress = status.koji_download_state?.progress || 0;
            statusEl.textContent = `Downloading... ${Math.round(progress * 100)}%`;
        } else if (info.error) {
            statusEl.className += " error";
            statusEl.textContent = info.error;
        } else {
            statusEl.textContent = "Not downloaded";
        }
        card.appendChild(statusEl);

        if (!isAvailable && model.key === "koji" && !isDownloading) {
            const dlBtn = document.createElement("button");
            dlBtn.className = "visual-btn";
            dlBtn.textContent = "Download Koji";
            dlBtn.style.marginTop = "4px";
            dlBtn.addEventListener("click", async () => {
                dlBtn.disabled = true;
                dlBtn.textContent = "Downloading...";
                const result = await downloadKojiAsync();
                if (result.ok) {
                    notify("info", "Koji download started", "Visual Gen");
                    const pollInterval = setInterval(async () => {
                        const state = await getKojiDownloadState();
                        if (state.ok && state.state) {
                            const s = state.state;
                            if (s.status === "ready") {
                                clearInterval(pollInterval);
                                notify("success", "Koji downloaded successfully", "Visual Gen");
                                refreshModelStatus(container);
                            } else if (s.status === "failed") {
                                clearInterval(pollInterval);
                                notify("error", `Koji download failed: ${s.error}`, "Visual Gen");
                                refreshModelStatus(container);
                            }
                        }
                    }, 3000);
                } else {
                    dlBtn.disabled = false;
                    dlBtn.textContent = "Download Koji";
                    notify("error", `Download failed: ${result.error}`, "Visual Gen");
                }
            });
            card.appendChild(dlBtn);
        }

        container.appendChild(card);
    }

    const activeModel = document.createElement("div");
    activeModel.style.cssText = "font-size:11px;color:#888;margin-top:4px;";
    activeModel.textContent = `Active: ${status.active_builtin_model || "none"} | Backend: ${status.visual_backend_mode || "built_in_backend"}`;
    container.appendChild(activeModel);
}


async function refreshUpscalerStatus(container) {
    container.innerHTML = "";

    const status = await getUpscalerStatus();
    if (!status || !status.ok) {
        container.innerHTML = `<div style="font-size:11px;color:#888;">Could not load upscaler status</div>`;
        return;
    }

    const info = status.upscaler || {};
    const isAvailable = info.available;
    const isDownloading = status.state?.status === "downloading";

    const card = document.createElement("div");
    card.className = `visual-model-card ${isAvailable ? "available" : isDownloading ? "downloading" : "unavailable"}`;

    const nameEl = document.createElement("div");
    nameEl.className = "model-name";
    nameEl.textContent = "RealESRGAN Anime Upscaler";
    card.appendChild(nameEl);

    const statusEl = document.createElement("div");
    statusEl.className = "model-status";
    if (isAvailable) {
        statusEl.className += " ok";
        statusEl.textContent = "Available";
    } else if (isDownloading) {
        statusEl.className += " pending";
        const progress = status.state?.progress || 0;
        statusEl.textContent = `Downloading... ${Math.round(progress * 100)}%`;
    } else if (info.error) {
        statusEl.className += " error";
        statusEl.textContent = info.error;
    } else {
        statusEl.textContent = "Not downloaded";
    }
    card.appendChild(statusEl);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:4px;margin-top:4px;flex-wrap:wrap;";

    if (!isAvailable && !isDownloading) {
        const dlBtn = document.createElement("button");
        dlBtn.className = "visual-btn";
        dlBtn.textContent = "Download Upscaler";
        dlBtn.addEventListener("click", async () => {
            dlBtn.disabled = true;
            dlBtn.textContent = "Downloading...";
            const result = await downloadUpscalerAsync();
            if (result.ok) {
                notify("info", "Upscaler download started", "Visual Gen");
                const pollInterval = setInterval(async () => {
                    const state = await getUpscalerDownloadState();
                    if (state.ok && state.state) {
                        const s = state.state;
                        if (s.status === "ready") {
                            clearInterval(pollInterval);
                            notify("success", "Upscaler downloaded successfully", "Visual Gen");
                            refreshUpscalerStatus(container);
                        } else if (s.status === "failed") {
                            clearInterval(pollInterval);
                            notify("error", `Upscaler download failed: ${s.error}`, "Visual Gen");
                            refreshUpscalerStatus(container);
                        }
                    }
                }, 3000);
            } else {
                dlBtn.disabled = false;
                dlBtn.textContent = "Download Upscaler";
                notify("error", `Download failed: ${result.error}`, "Visual Gen");
            }
        });
        btnRow.appendChild(dlBtn);
    }

    if (isAvailable) {
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "visual-btn";
        deleteBtn.textContent = "Delete";
        deleteBtn.style.background = "rgba(200,50,50,0.3)";
        deleteBtn.addEventListener("click", async () => {
            if (!confirm("Delete the upscaler model? Previously generated images will not be deleted.")) return;
            const result = await deleteUpscaler();
            if (result.ok) {
                notify("success", "Upscaler deleted", "Visual Gen");
                refreshUpscalerStatus(container);
            } else {
                notify("error", `Delete failed: ${result.error}`, "Visual Gen");
            }
        });
        btnRow.appendChild(deleteBtn);

        const repairBtn = document.createElement("button");
        repairBtn.className = "visual-btn";
        repairBtn.textContent = "Repair";
        repairBtn.addEventListener("click", async () => {
            repairBtn.disabled = true;
            repairBtn.textContent = "Repairing...";
            const result = await repairUpscaler();
            repairBtn.disabled = false;
            repairBtn.textContent = "Repair";
            if (result.ok) {
                notify("success", "Upscaler repaired/re-downloaded", "Visual Gen");
                refreshUpscalerStatus(container);
            } else {
                notify("error", `Repair failed: ${result.error}`, "Visual Gen");
            }
        });
        btnRow.appendChild(repairBtn);
    }

    card.appendChild(btnRow);
    container.appendChild(card);
}


export async function getUpscalerStatus() {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/models/upscaler/status`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        return null;
    }
}


export async function downloadUpscalerAsync() {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/models/upscaler/download-async`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
        return await response.json();
    } catch (error) {
        return { ok: false, error: String(error) };
    }
}


export async function getUpscalerDownloadState() {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/models/upscaler/download-state`);
        if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
        return await response.json();
    } catch (error) {
        return { ok: false, error: String(error) };
    }
}


export async function deleteUpscaler() {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/models/upscaler/delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
        return await response.json();
    } catch (error) {
        return { ok: false, error: String(error) };
    }
}


export async function repairUpscaler() {
    try {
        const response = await fetch(`${VISUAL_SERVICE_URL}/visuals/models/upscaler/repair`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
        return await response.json();
    } catch (error) {
        return { ok: false, error: String(error) };
    }
}
