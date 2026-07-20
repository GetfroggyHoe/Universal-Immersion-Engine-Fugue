import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_EDGE = 1920;

function currentLocation(settings) {
  return String(settings?.worldState?.currentLocation || settings?.worldState?.location || "Current Location").trim() || "Current Location";
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The selected image could not be decoded.")); };
    image.src = url;
  });
}

async function optimizeImage(file) {
  const bitmap = await loadBitmap(file);
  const sourceWidth = Math.max(1, Number(bitmap.width || bitmap.naturalWidth || 1));
  const sourceHeight = Math.max(1, Number(bitmap.height || bitmap.naturalHeight || 1));
  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Your browser could not prepare the image canvas.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const webp = canvas.toDataURL("image/webp", 0.88);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.9);
}

export function applyManualSceneImage(imageUrl, meta = {}) {
  const url = String(imageUrl || "").trim();
  if (!url) return false;
  const settings = getSettings();
  if (!settings.worldState || typeof settings.worldState !== "object") settings.worldState = {};
  if (!settings.worldState.customBackgrounds || typeof settings.worldState.customBackgrounds !== "object") settings.worldState.customBackgrounds = {};
  if (!settings.worldState.areaScenes || typeof settings.worldState.areaScenes !== "object") settings.worldState.areaScenes = {};
  const location = currentLocation(settings);
  settings.worldState.customBackgrounds[location] = url;
  settings.worldState.background = url;
  settings.worldState.backgroundUrl = url;
  settings.worldState.areaScenes[location] = {
    ...(settings.worldState.areaScenes[location] || {}),
    imageUrl: url,
    source: String(meta.source || "manual_file"),
    updatedAt: Date.now(),
  };
  const mapNode = settings.worldState.mapNodes?.[location];
  if (mapNode && typeof mapNode === "object") mapNode.backgroundUrl = url;
  saveSettings();

  try {
    if (typeof window.setLocalSceneBackgroundFromDataUrl === "function") window.setLocalSceneBackgroundFromDataUrl(url);
    else {
      for (const selector of ["#re-bg", "#bg1", "#game-root"]) {
        const element = document.querySelector(selector);
        if (!element) continue;
        element.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
        element.style.backgroundSize = "cover";
        element.style.backgroundPosition = "center";
      }
    }
  } catch (_) {}
  try { window.dispatchEvent(new CustomEvent("uie:state_updated", { detail: { background: true, location, source: meta.source || "manual_file" } })); } catch (_) {}
  return true;
}

export async function importManualSceneImage(file) {
  if (!(file instanceof Blob) || !String(file.type || "").startsWith("image/")) throw new Error("Choose an image file.");
  if (Number(file.size || 0) > MAX_FILE_BYTES) throw new Error("Choose an image smaller than 25 MB.");
  const dataUrl = await optimizeImage(file);
  applyManualSceneImage(dataUrl, { source: "paint_brush_file", name: file.name || "scene image" });
  notify("success", `${file.name || "Image"} is now the current location background.`, "Background");
  return dataUrl;
}

export function pickManualSceneImage() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif,image/avif";
    input.hidden = true;
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) { input.remove(); resolve(false); return; }
      try {
        await importManualSceneImage(file);
        resolve(true);
      } catch (error) {
        notify("error", String(error?.message || error), "Background");
        resolve(false);
      } finally {
        input.remove();
      }
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}
