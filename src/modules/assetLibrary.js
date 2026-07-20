import { getSettings, saveSettings } from "./core.js";
import { normalizeInventoryItem } from "./inventoryItems.js";

const ASSET_LIBRARY_VERSION = "processed-assets-v4-food-misc-in-game";
const MANIFEST_PATH = "assets/processed/asset-tags.json";
const PUBLIC_ASSET_MANIFEST_PATH = "assets/asset-manifest.json";

let manifestPromise = null;
let pakManifestPromise = null;

function baseUrl() {
  try {
    const raw = String(window.UIE_BASEURL || "");
    if (raw) return raw.endsWith("/") ? raw : `${raw}/`;
  } catch (_) {}
  return "";
}

function cleanText(value, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

function macroSafeId(value) {
  return cleanText(value, 180).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "asset";
}

async function fetchJson(path) {
  const roots = [
    `${baseUrl()}${path}`,
    `./${path}`,
    `/${path}`,
  ];
  for (const url of roots) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      return await res.json();
    } catch (_) {}
  }
  return null;
}

async function fetchArrayBuffer(path) {
  const roots = [
    `${baseUrl()}${path}`,
    `./${path}`,
    `/${path}`,
  ];
  for (const url of roots) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      return await res.arrayBuffer();
    } catch (_) {}
  }
  return null;
}

async function inflateGzipToObjectUrl(bytes, mime) {
  if (typeof DecompressionStream !== "function" || typeof Blob !== "function" || typeof URL?.createObjectURL !== "function") {
    return "";
  }
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const inflated = await new Response(stream).arrayBuffer();
    return URL.createObjectURL(new Blob([inflated], { type: mime || "image/png" }));
  } catch (_) {
    return "";
  }
}

async function loadBinaryApak(path) {
  const buffer = await fetchArrayBuffer(path);
  if (!buffer || buffer.byteLength < 12) return null;
  const bytes = new Uint8Array(buffer);
  const magic = new TextDecoder().decode(bytes.slice(0, 8));
  if (magic !== "UIEAPAK1") return null;
  const view = new DataView(buffer);
  const manifestLength = view.getUint32(8, true);
  const manifestStart = 12;
  const payloadStart = manifestStart + manifestLength;
  if (payloadStart > bytes.length) return null;
  let pak = null;
  try {
    pak = JSON.parse(new TextDecoder().decode(bytes.slice(manifestStart, payloadStart)));
  } catch (_) {
    return null;
  }
  if (!pak || !Array.isArray(pak.assets)) return null;
  const hydrated = [];
  for (const record of pak.assets) {
    const packed = record?._packed && typeof record._packed === "object" ? record._packed : {};
    const offset = Number(packed.offset);
    const length = Number(packed.length);
    if (!Number.isFinite(offset) || !Number.isFinite(length) || offset < 0 || length <= 0 || payloadStart + offset + length > bytes.length) {
      hydrated.push(record);
      continue;
    }
    let imageData = "";
    const packedBytes = bytes.slice(payloadStart + offset, payloadStart + offset + length);
    if (String(packed.encoding || "").toLowerCase() === "gzip") {
      imageData = await inflateGzipToObjectUrl(packedBytes, packed.mime || "image/png");
    } else if (typeof Blob === "function" && typeof URL?.createObjectURL === "function") {
      try {
        imageData = URL.createObjectURL(new Blob([packedBytes], { type: packed.mime || "image/webp" }));
      } catch (_) {
        imageData = "";
      }
    }
    hydrated.push({
      ...record,
      imageData: imageData || record.imageData || "",
      packed: true,
    });
  }
  return { ...pak, assets: hydrated };
}

export async function loadProcessedAssetManifest() {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      const manifest = await fetchJson(MANIFEST_PATH);
      if (!manifest || typeof manifest !== "object") return null;
      return manifest;
    })();
  }
  return manifestPromise;
}

async function loadPakBackedManifest() {
  if (!pakManifestPromise) {
    pakManifestPromise = (async () => {
      const baseManifest = await loadProcessedAssetManifest();
      const publicManifest = await fetchJson(PUBLIC_ASSET_MANIFEST_PATH);
      const paks = publicManifest?.paks && typeof publicManifest.paks === "object" ? publicManifest.paks : {};
      const [foodPak, miscPak, uneditedPak] = await Promise.all([
        paks.food ? loadBinaryApak(String(paks.food)) : null,
        paks.misc ? loadBinaryApak(String(paks.misc)) : null,
        paks.unedited ? loadBinaryApak(String(paks.unedited)) : null,
      ]);
      const manifest = baseManifest && typeof baseManifest === "object" ? { ...baseManifest } : {};
      if (Array.isArray(foodPak?.assets)) manifest.food = foodPak.assets;
      if (Array.isArray(miscPak?.assets)) manifest.misc = miscPak.assets;
      if (Array.isArray(uneditedPak?.assets)) manifest.misc = [...(manifest.misc || []), ...uneditedPak.assets];
      return manifest;
    })();
  }
  return pakManifestPromise;
}

function isAutoInjectedProcessedFood(item, manifestFoodIds) {
  const meta = item?._meta && typeof item._meta === "object" ? item._meta : {};
  const source = cleanText(meta.source || "", 80);
  const assetId = cleanText(meta.assetId || "", 160);
  return source === "processed_food_asset" || (assetId && manifestFoodIds.has(assetId));
}

function isAutoInjectedProcessedAsset(asset, manifestAssetIds) {
  const meta = asset?._meta && typeof asset._meta === "object" ? asset._meta : {};
  const source = cleanText(meta.source || asset?.source || "", 80).toLowerCase();
  const assetId = cleanText(meta.assetId || asset?.assetId || "", 160);
  return source === "processed_misc_asset" || source === "processed_catalog_asset" || (assetId && manifestAssetIds.has(assetId));
}

function isProcessedCatalogInventoryAsset(asset, manifestAssetIds) {
  if (!asset || typeof asset !== "object") return false;
  const source = cleanText(asset.source || asset._meta?.source || "", 80).toLowerCase();
  const assetId = cleanText(asset._meta?.assetId || asset.assetId || "", 160);
  const category = cleanText(asset.category || asset.type || "", 80).toLowerCase();
  const img = cleanText(asset.img || asset.image || "", 1200).replace(/\\/g, "/").toLowerCase();
  const name = cleanText(asset.name || asset.title || "", 120).toLowerCase();
  if (source === "uie_template_seed" || source === "processed_food_asset" || source === "processed_misc_asset" || source === "processed_catalog_asset") return true;
  if (assetId && manifestAssetIds.has(assetId)) return true;
  if (category === "ui_template" || category === "inventory-plate" || category === "food" || category === "equipment" || category === "item") return true;
  if (img.includes("assets/ui/generated/inventory-") || img.includes("assets/processed/") || img.includes("assets/food/") || img.includes("assets/items & equipment/")) return true;
  return /\binventory\s+(background|slot|plate)\b/.test(name);
}

function itemTags(record) {
  return Array.isArray(record?.tags)
    ? record.tags.map((tag) => cleanText(tag, 40).toLowerCase()).filter(Boolean).slice(0, 24)
    : [];
}

function hungerValue(tags) {
  const set = new Set(tags);
  if (set.has("drink")) return 4;
  if (set.has("spice") || set.has("seasoning") || set.has("herb")) return 2;
  if (set.has("meat") || set.has("meal") || set.has("bread") || set.has("pasta")) return 18;
  if (set.has("fruit") || set.has("vegetable")) return 10;
  return 8;
}

function buildFoodItem(record) {
  const tags = itemTags(record);
  const name = cleanText(record?.name || "Food", 90) || "Food";
  const macroId = macroSafeId(`food_${name}`);
  return {
    kind: "item",
    name,
    type: "Food",
    description: `Processed food asset. Tags: ${tags.join(", ")}`,
    rarity: "common",
    qty: 1,
    img: cleanText(record?.imageData || record?.path || "", 5000000),
    slotCategory: "CONSUMABLE",
    tags,
    macros: Array.isArray(record?.macros) ? record.macros : [],
    use: {
      consumes: true,
      desc: `Eat ${name}.`,
      needs: {
        hunger: hungerValue(tags),
        energy: tags.includes("drink") ? 4 : 2,
      },
    },
    kitchen: {
      ingredient: true,
      baseType: tags.find((tag) => ["meat", "fish", "fruit", "vegetable", "herb", "spice", "grain", "dairy", "drink"].includes(tag)) || "food",
      state: tags.includes("cooked") ? "cooked" : "raw",
      macros: [
        {
          id: `${macroId}_chop`,
          when: { state: "raw", toolTags: ["knife"] },
          then: { state: "chopped", log: `The ${name} was cut into usable pieces.` },
        },
        {
          id: `${macroId}_cook`,
          when: { state: "chopped", surfaceTags: ["heat", "stove", "boiling", "pan"] },
          then: { state: "cooked", event: "PushedToPot", log: `The ${name} cooked through.` },
        },
      ],
    },
    _meta: {
      source: "processed_food_asset",
      assetId: cleanText(record?.id || "", 160),
      assetSource: cleanText(record?.source || "", 1200),
      macro: `${macroId}_eat`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };
}

function buildCatalogAsset(record) {
  const tags = itemTags(record);
  const name = cleanText(record?.name || "Asset", 90) || "Asset";
  const category = cleanText(record?.category || "misc", 60).toLowerCase() || "misc";
  return {
    kind: "asset",
    name,
    title: name,
    category,
    type: category,
    owned: true,
    img: cleanText(record?.imageData || record?.path || "", 5000000),
    image: cleanText(record?.imageData || record?.path || "", 5000000),
    description: `Processed ${category} asset. Tags: ${tags.join(", ")}`,
    keywords: tags,
    tags,
    macros: Array.isArray(record?.macros) ? record.macros : [],
    travelCategory: "none",
    _meta: {
      source: "processed_misc_asset",
      assetId: cleanText(record?.id || "", 160),
      assetSource: cleanText(record?.source || "", 1200),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };
}

function buildAssetMacroRegistry(manifest) {
  const registry = {};
  for (const list of Object.values(manifest || {})) {
    if (!Array.isArray(list)) continue;
    for (const record of list) {
      const id = cleanText(record?.id || macroSafeId(`${record?.category || "asset"}_${record?.name || "asset"}`), 180);
      if (!id) continue;
      registry[id] = {
        id,
        name: cleanText(record?.name || "Asset", 120),
        category: cleanText(record?.category || "asset", 60),
        path: cleanText(record?.imageData || record?.path || "", 5000000),
        tags: itemTags(record),
        macros: Array.isArray(record?.macros) ? record.macros : [],
      };
    }
  }
  return registry;
}

export async function ensureProcessedAssetLibrary() {
  const manifest = await loadPakBackedManifest();
  if (!manifest) return null;

  const registry = buildAssetMacroRegistry(manifest);
  try {
    window.UIE_PROCESSED_ASSET_LIBRARY = manifest;
    window.UIE_ASSET_MACROS = registry;
  } catch (_) {}

  const s = getSettings();
  if (!s) return manifest;
  if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
  if (!Array.isArray(s.inventory.assets)) s.inventory.assets = [];
  if (!s.inventory.assetLibrary || typeof s.inventory.assetLibrary !== "object") s.inventory.assetLibrary = {};
  s.inventory.assetLibrary.version = ASSET_LIBRARY_VERSION;
  s.inventory.assetLibrary.manifest = MANIFEST_PATH;
  s.inventory.assetLibrary.counts = {
    inventoryPlates: Array.isArray(manifest.inventoryPlates) ? manifest.inventoryPlates.length : 0,
    itemsEquipment: Array.isArray(manifest.itemsEquipment) ? manifest.itemsEquipment.length : 0,
    food: Array.isArray(manifest.food) ? manifest.food.length : 0,
    misc: Array.isArray(manifest.misc) ? manifest.misc.length : 0,
  };
  s.inventory.assetLibrary.macroCount = Object.keys(registry).length;

  const manifestFoodIds = new Set(
    (Array.isArray(manifest.food) ? manifest.food : [])
      .map((record) => cleanText(record?.id || "", 160))
      .filter(Boolean),
  );
  const manifestAssetIds = new Set();
  for (const list of Object.values(manifest || {})) {
    if (!Array.isArray(list)) continue;
    for (const record of list) {
      const id = cleanText(record?.id || "", 160);
      if (id) manifestAssetIds.add(id);
    }
  }
  const originalItemCount = s.inventory.items.length;
  s.inventory.items = s.inventory.items.filter((item) => !isAutoInjectedProcessedFood(item, manifestFoodIds));
  if (s.inventory.items.length !== originalItemCount) {
    delete s.inventory.processedFoodInjectedVersion;
  }
  const originalAssetCount = s.inventory.assets.length;
  s.inventory.assets = s.inventory.assets.filter((asset) => !isAutoInjectedProcessedAsset(asset, manifestAssetIds) && !isProcessedCatalogInventoryAsset(asset, manifestAssetIds));
  if (s.inventory.assets.length !== originalAssetCount) {
    delete s.inventory.processedAssetInjectedVersion;
  }

  // The processed manifest is a visual/macro catalog, not player inventory.
  // Older builds copied the whole catalog into items/assets on startup. Keep
  // the library available through the globals above, but migrate those seeded
  // records out and never recreate them. Real inventory entries are added only
  // by gameplay, explicit user creation, import, or state mutation.
  delete s.inventory.processedFoodInjectedVersion;
  delete s.inventory.processedAssetInjectedVersion;
  s.inventory.assetLibrary.autoInjection = false;

  saveSettings();
  return manifest;
}
