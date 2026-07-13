import { getSettings, saveSettings } from "./core.js";
import { getServerAssetImageStatus, requestServerAssetImage } from "./backendBridge.js";

function slug(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80);
}

function providerSnapshot(settings = getSettings()) {
    const img = settings?.image && typeof settings.image === "object" ? settings.image : {};
    const provider = String(img.provider || "pollinations").trim().toLowerCase() || "pollinations";
    return {
        provider,
        url: String(img.url || "").trim(),
        model: String(img.model || "").trim(),
        key: String(img.key || img.apiKey || img.token || "").trim(),
        pollinationsKey: String(img.pollinationsKey || "").trim(),
        pollinationsModel: String(img.pollinationsModel || "").trim(),
        negativePrompt: String(img.negativePrompt || "").trim(),
        size: String(img.size || "").trim(),
        backgroundSize: String(img.backgroundSize || "").trim(),
        stability: img.stability && typeof img.stability === "object" ? { ...img.stability } : {},
        sdwebui: img.sdwebui && typeof img.sdwebui === "object" ? { ...img.sdwebui } : {},
        sdwebuiUrl: String(img.sdwebuiUrl || "").trim(),
        providers: img.providers && typeof img.providers === "object" ? img.providers : {},
        providerKeys: img.providerKeys && typeof img.providerKeys === "object" ? img.providerKeys : {},
        comfy: img.comfy && typeof img.comfy === "object"
            ? {
                base: String(img.comfy.base || "").trim(),
                key: String(img.comfy.key || "").trim(),
                checkpoint: String(img.comfy.checkpoint || "").trim(),
                sampler: String(img.comfy.sampler || "").trim(),
                scheduler: String(img.comfy.scheduler || "").trim(),
            }
            : {},
    };
}

function locationPrompt(locationName, node = {}, kind = "background") {
    const name = String(locationName || node.name || "Current Location").trim();
    const description = String(node.description || node.desc || node.imagePrompt || "").trim();
    const base = [
        node.backgroundPrompt || node.imagePrompt || "",
        description,
        `${node.type || "location"} named ${name}`,
        node.theme ? `Theme: ${node.theme}` : "",
        node.district ? `Region: ${node.district}` : "",
    ].filter(Boolean).join(". ");
    if (kind === "background") return base;
    return [
        `Custom location thumbnail for ${name}`,
        base,
        "Readable at small size, iconic physical landmark, no text, no UI.",
    ].filter(Boolean).join(". ");
}

function cleanImagePrompt(value) {
    return String(value || "")
        .replace(/\[UIE_CONTEXT_READY\]/gi, "")
        .replace(/^\s*\[(?:AUTHORITATIVE CONTEXT|IMAGE CONSTRAINTS)\]\s*/gim, "")
        .replace(/^\s*(?:STRICT\s+)?(?:ENVIRONMENT\s+PLATE|CONTENT\s+LIST|SPATIAL\s+LAYOUT|AUTHORITATIVE\s+CONTEXT|IMAGE\s+CONSTRAINTS)\s*:\s*/gim, "")
        .replace(/\b(?:strict environment plate|strict content list|strict spatial layout|authoritative context|image constraints)\s*:\s*/gi, "")
        .replace(/\bempty environment plate\b/gi, "empty environment background")
        .replace(/\bplate\b/gi, "background")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function normalizeAsset(data) {
    const asset = data?.asset || data;
    if (!asset || typeof asset !== "object") return null;
    if (!asset.urlAbsolute && asset.url && /^https?:\/\//i.test(asset.url)) asset.urlAbsolute = asset.url;
    return asset;
}

export function applyLocationAsset(locationName, asset, node = {}, options = {}) {
    const ready = normalizeAsset(asset);
    const url = String(ready?.urlAbsolute || ready?.url || "").trim();
    if (!url) return "";
    const kind = String(options.kind || ready.kind || "background").toLowerCase();
    const s = getSettings();
    if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
    if (!s.worldState.mapNodes || typeof s.worldState.mapNodes !== "object") s.worldState.mapNodes = {};
    if (!s.worldState.areaScenes || typeof s.worldState.areaScenes !== "object") s.worldState.areaScenes = {};
    const name = String(locationName || ready.location || node.name || "").trim();
    if (!name) return url;

    const mapNode = s.worldState.mapNodes[name] || node || {};
    s.worldState.mapNodes[name] = mapNode;
    s.worldState.areaScenes[name] = { ...(s.worldState.areaScenes[name] || {}), name };

    if (kind === "background") {
        if (!s.realityEngine || typeof s.realityEngine !== "object") s.realityEngine = {};
        if (!s.realityEngine.backgrounds || typeof s.realityEngine.backgrounds !== "object") s.realityEngine.backgrounds = {};
        s.realityEngine.backgrounds[name] = url;
        s.realityEngine.backgrounds[slug(name)] = url;
        s.worldState.areaScenes[name].imageUrl = url;
        mapNode.backgroundUrl = url;
    } else {
        mapNode.thumbnailUrl = url;
        mapNode.iconUrl = kind === "icon" ? url : mapNode.iconUrl || "";
        s.worldState.areaScenes[name].thumbnailUrl = url;
    }
    saveSettings();
    try {
        window.dispatchEvent(new CustomEvent("uie:asset_image_ready", { detail: { location: name, kind, url, asset: ready } }));
    } catch (_) {}
    return url;
}

export async function requestLocationImageAsset(locationName, node = {}, options = {}) {
    const s = getSettings();
    const kind = String(options.kind || "background").toLowerCase();
    const name = String(locationName || node.name || "").trim();
    if (!name) return null;
    const width = Number(options.width || (kind === "background" ? 1280 : kind === "thumbnail" ? 768 : 512));
    const height = Number(options.height || (kind === "background" ? 720 : kind === "thumbnail" ? 512 : 512));
    const payload = {
        asset_id: `${kind}:${name}`,
        name,
        location_id: name,
        kind,
        mode: options.mode || kind,
        prompt: cleanImagePrompt(options.prompt || locationPrompt(name, node, kind)),
        description: String(node.description || node.desc || "").trim(),
        width,
        height,
        provider_settings: providerSnapshot(s),
        metadata: {
            source: options.source || "frontend",
            nodeType: node.type || "",
            theme: node.theme || "",
            district: node.district || "",
        },
    };
    try {
        const data = await requestServerAssetImage(payload, { required: false, timeoutMs: options.timeoutMs ?? 1400 });
        const asset = normalizeAsset(data);
        if (asset?.status === "ready") applyLocationAsset(name, asset, node, { kind });
        return asset;
    } catch (err) {
        console.warn("[server-assets] Backend image request failed", err);
        return null;
    }
}

export function pollLocationImageAsset(locationName, assetId, node = {}, options = {}) {
    const id = String(assetId || "").trim();
    if (!id) return;
    const intervalMs = Math.max(500, Number(options.intervalMs || 1200));
    const maxTries = Math.max(1, Number(options.maxTries || 18));
    let tries = 0;
    const tick = async () => {
        tries += 1;
        try {
            const data = await getServerAssetImageStatus(id, { required: false, timeoutMs: 1200 });
            const asset = normalizeAsset(data);
            if (asset?.status === "ready") {
                const url = applyLocationAsset(locationName, asset, node, { kind: options.kind || asset.kind });
                options.onReady?.(asset, url);
                return;
            }
            if (asset?.status === "failed") {
                options.onFailed?.(asset);
                return;
            }
        } catch (_) {}
        if (tries < maxTries) setTimeout(tick, intervalMs);
    };
    setTimeout(tick, intervalMs);
}
