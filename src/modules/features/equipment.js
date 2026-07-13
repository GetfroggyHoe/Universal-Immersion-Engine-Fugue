import { getSettings, saveSettings } from "../core.js";
import { injectRpEvent } from "./rp_log.js";
import { addInventoryItemWithStack } from "../inventoryItems.js";
import { generateContent } from "../apiClient.js";

let currentLayerIndex = 0; // ARMOR default
let currentPage = 0;       // page within layer (3 per side)
const OUTFIT_BASE_CATEGORIES = ["Everyday", "Sleepwear", "Party wear", "Custom"];
const outfitEditorState = { idx: -1, mode: "manual" };

const SLOT_LABELS = {
  // INNER
  undies: "Undies", socks: "Socks", tattoo: "Tattoo", scar: "Scar",
  ears: "Ears", face: "Face", ink: "Ink", soul: "Soul",

  // CLOTH
  shirt: "Shirt", pants: "Pants", vest: "Vest", belt: "Belt",
  boots: "Boots", gloves: "Gloves", aura: "Aura", bag: "Bag",

  // ARMOR
  head: "Head", chest: "Chest", legs: "Legs", feet: "Feet",
  hands: "Hands", shldr: "Shoulder", back: "Back", neck: "Neck",

  // GEAR
  main: "Main", off: "Off", range: "Range", ammo: "Ammo",
  r1: "Ring 1", r2: "Ring 2", relic: "Relic", tool: "Tool",

  // Extra utility (kept)
  trinket: "Trinket", focus: "Focus", quick: "Quick", utility: "Utility",
  outfit: "Outfit",
};

// Your canonical slot sets (unchanged)
const LAYERS = [
  { name: "OUTFITS", type: "outfits", slots: [] },
  { name: "INNER", slots: [
    { id:"undies", side:"left", icon:"fa-venus-mars" },
    { id:"socks", side:"left", icon:"fa-socks" },
    { id:"tattoo", side:"left", icon:"fa-dragon" },
    { id:"scar", side:"left", icon:"fa-heart-crack" },

    { id:"ears", side:"right", icon:"fa-ear-listen" },
    { id:"face", side:"right", icon:"fa-face-smile" },
    { id:"ink", side:"right", icon:"fa-wand-sparkles" },
    { id:"soul", side:"right", icon:"fa-ghost" },
  ]},
  { name: "CLOTH", slots: [
    { id:"shirt", side:"left", icon:"fa-shirt" },
    { id:"vest", side:"left", icon:"fa-box" },
    { id:"gloves", side:"left", icon:"fa-hand" },
    { id:"aura", side:"left", icon:"fa-star" },

    { id:"pants", side:"right", icon:"fa-user" },
    { id:"belt", side:"right", icon:"fa-grip-lines" },
    { id:"boots", side:"right", icon:"fa-shoe-prints" },
    { id:"bag", side:"right", icon:"fa-bag-shopping" },
  ]},
  { name: "ARMOR", slots: [
    { id:"head", side:"left", icon:"fa-hard-hat" },
    { id:"chest", side:"left", icon:"fa-shield" },
    { id:"legs", side:"left", icon:"fa-person" },
    { id:"feet", side:"left", icon:"fa-shoe-prints" },

    { id:"hands", side:"right", icon:"fa-hand-fist" },
    { id:"shldr", side:"right", icon:"fa-user-shield" },
    { id:"back", side:"right", icon:"fa-feather" },
    { id:"neck", side:"right", icon:"fa-link" },
  ]},
  { name: "GEAR", slots: [
    // left (6)
    { id:"main", side:"left", icon:"fa-hammer" },
    { id:"off", side:"left", icon:"fa-shield-halved" },
    { id:"range", side:"left", icon:"fa-crosshairs" },
    { id:"ammo", side:"left", icon:"fa-bullseye" },
    { id:"tool", side:"left", icon:"fa-screwdriver-wrench" },
    { id:"relic", side:"left", icon:"fa-gem" },

    // right (6)
    { id:"r1", side:"right", icon:"fa-gem" },
    { id:"r2", side:"right", icon:"fa-gem" },
    { id:"trinket", side:"right", icon:"fa-star" },
    { id:"focus", side:"right", icon:"fa-wand-sparkles" },
    { id:"quick", side:"right", icon:"fa-bolt" },
    { id:"utility", side:"right", icon:"fa-toolbox" },
  ]},
];

/**
 * Immersion padding:
 * When a layer side has < 3 slots on the current page, we pad it with other
 * thematic slots (ink/soul/etc) so page 2 doesn't feel empty on mobile.
 *
 * This does NOT remove your slot types — it only displays extra slots as "bonus views".
 */
const FILLERS = {
  // Armor page 2 feels empty -> show spiritual/cosmetic slots as immersion
  ARMOR: {
    left:  ["tattoo","scar","undies","socks","shirt","belt"],
    right: ["ink","soul","ears","face","aura","bag"],
  },
  // Cloth page 2 feels empty -> show body/ritual slots as immersion
  CLOTH: {
    left:  ["tattoo","scar","undies","socks","head","neck"],
    right: ["ink","soul","ears","face","relic","r1"],
  },
  // Optional (not really needed, but keeps symmetry if you ever change paging)
  INNER: {
    left:  ["shirt","vest","gloves"],
    right: ["pants","belt","boots"],
  },
  // GEAR already fills 3/3 on both pages, so no fillers needed
  GEAR: { left: [], right: [] },
};

// Build icon lookup from every known slot (across layers)
const ICON_BY_ID = (() => {
  const map = {};
  for (const layer of LAYERS) {
    for (const s of layer.slots) map[s.id] = s.icon;
  }
  // Provide sensible icons for any filler ids not already mapped (rare)
  map.relic = map.relic || "fa-gem";
  map.r1 = map.r1 || "fa-gem";
  map.r2 = map.r2 || "fa-gem";
  map.trinket = map.trinket || "fa-star";
  return map;
})();

function ensureEquipArrays(s) {
  if (!s.inventory) s.inventory = { items: [], skills: [], assets: [], statuses: [], equipped: [] };
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
  if (!Array.isArray(s.inventory.equipped)) s.inventory.equipped = [];
  if (!Array.isArray(s.inventory.outfits)) s.inventory.outfits = [];
}

function findEquippedBySlot(equippedArr, slotId) {
  for (let i = 0; i < equippedArr.length; i++) {
    if (String(equippedArr[i].slotId) === slotId) return { item: equippedArr[i], index: i };
  }
  return { item: null, index: -1 };
}

function splitBySide(layer) {
  const left = layer.slots.filter(s => s.side === "left");
  const right = layer.slots.filter(s => s.side === "right");
  const leftPages = Math.max(1, Math.ceil(left.length / 3));
  const rightPages = Math.max(1, Math.ceil(right.length / 3));
  const totalPages = Math.max(leftPages, rightPages);
  return { left, right, totalPages };
}

function isCompactMobileLayout() {
  try {
    return window.matchMedia("(max-width: 700px), (pointer: coarse)").matches;
  } catch (_) {
    return window.innerWidth <= 700;
  }
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function normalizeOutfitName(raw) {
  return String(raw || "New Outfit").replace(/\bwear\b/ig, "").replace(/\s{2,}/g, " ").trim().slice(0, 80) || "New Outfit";
}

function normalizeOutfitCategory(raw) {
  const value = String(raw || "Everyday").trim().toLowerCase();
  if (value === "sleepwear") return "Sleepwear";
  if (value === "party wear" || value === "partywear" || value === "party") return "Party wear";
  if (value === "custom") return "Custom";
  return "Everyday";
}

function createOutfitId() {
  return `outfit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeOutfit(raw = {}) {
  const name = normalizeOutfitName(raw.name || raw.title || "New Outfit");
  const category = normalizeOutfitCategory(raw.category || raw.categoryBase || "Everyday");
  const customCategory = String(raw.customCategory || raw.categoryLabel || raw.custom || "").trim().slice(0, 80);
  const slotCategory = String(raw.slotCategory || raw.slot || "Full Body").trim().slice(0, 40) || "Full Body";
  const img = String(raw.img || raw.image || raw.sprite || "").trim();
  const description = String(raw.description || raw.desc || "").trim().slice(0, 1200);
  const source = raw.source === "manual" ?
     "manual"
    : raw.source === "ai" ?
       "ai"
      : (raw.readOnly === true || raw.locked === true ? "manual" : "ai");
  const outfitId = String(raw.outfitId || raw.id || "").trim() || createOutfitId();
  const readOnly = raw.readOnly === true || raw.locked === true || source === "manual";
  const worn = raw.worn === true || raw.equipped === true;
  return {
    ...raw,
    id: outfitId,
    outfitId,
    kind: "equipment",
    equipmentKind: "outfit",
    slotId: "outfit",
    source,
    readOnly,
    worn,
    name,
    category,
    customCategory: category === "Custom" ? customCategory : "",
    slotCategory,
    img,
    image: img,
    description,
  };
}

function getOutfitDisplayCategory(outfit) {
  if (!outfit || typeof outfit !== "object") return "Everyday";
  if (outfit.category === "Custom") {
    const label = String(outfit.customCategory || "").trim();
    return label || "Custom";
  }
  return normalizeOutfitCategory(outfit.category);
}

function toggleOutfitCustomCategoryField(value) {
  const wrap = document.getElementById("equip-outfit-custom-category-wrap");
  if (!wrap) return;
  wrap.classList.toggle("equip-outfit-hidden", String(value || "") !== "Custom");
}

function syncOutfitModalPreview(img = "") {
  const box = document.getElementById("equip-outfit-preview-box");
  if (!box) return;
  const src = String(img || "").trim();
  box.innerHTML = src ?
     `<img src="${esc(src)}" alt="">`
    : '<i class="fa-solid fa-shirt" style="font-size:34px;color:#cba35c;"></i>';
}

function readOutfitEditorDraft() {
  const category = normalizeOutfitCategory($("#equip-outfit-category-input").val() || "Everyday");
  const customCategory = String($("#equip-outfit-custom-category-input").val() || "").trim();
  const sprite = String($("#equip-outfit-sprite-input").val() || "").trim();
  return normalizeOutfit({
    name: $("#equip-outfit-name-input").val(),
    category,
    customCategory,
    slotCategory: $("#equip-outfit-slot-category-input").val(),
    description: $("#equip-outfit-description-input").val(),
    img: sprite,
    sprite,
  });
}

function findEquippedOutfitEntry(s) {
  ensureEquipArrays(s);
  const equipped = Array.isArray(s.inventory.equipped) ? s.inventory.equipped : [];
  return equipped.find((item) => String(item?.slotId || "") === "outfit" || String(item?.equipmentKind || "") === "outfit") || null;
}

function syncOutfitMirrorState(s) {
  ensureEquipArrays(s);
  const outfits = Array.isArray(s.inventory.outfits) ? s.inventory.outfits : [];
  const equippedOutfitRaw = findEquippedOutfitEntry(s);
  const equippedOutfit = equippedOutfitRaw ? normalizeOutfit({ ...equippedOutfitRaw, worn: true }) : null;
  const wornId = String(equippedOutfit?.outfitId || equippedOutfit?.id || "").trim();
  let foundWorn = false;

  s.inventory.outfits = outfits.map((raw) => {
    const outfit = normalizeOutfit(raw);
    if (wornId && outfit.outfitId === wornId) {
      foundWorn = true;
      return normalizeOutfit({ ...outfit, ...equippedOutfit, id: outfit.outfitId, outfitId: outfit.outfitId, worn: true });
    }
    return normalizeOutfit({ ...outfit, worn: wornId ? outfit.outfitId === wornId : false });
  });

  if (equippedOutfit && !foundWorn) {
    s.inventory.outfits.push(normalizeOutfit({ ...equippedOutfit, worn: true }));
  }

  if (equippedOutfitRaw) {
    const idx = s.inventory.equipped.findIndex((item) => String(item?.slotId || "") === "outfit" || String(item?.equipmentKind || "") === "outfit");
    if (idx >= 0) {
      s.inventory.equipped[idx] = {
        ...s.inventory.equipped[idx],
        ...equippedOutfit,
        id: equippedOutfit.outfitId,
        outfitId: equippedOutfit.outfitId,
        slotId: "outfit",
        equipmentKind: "outfit",
        worn: true,
      };
    }
  }

  if (!s.playerRoom || typeof s.playerRoom !== "object") s.playerRoom = {};
  if (equippedOutfit?.name) s.playerRoom.outfit = equippedOutfit.name;
  else if (String(s.playerRoom.outfit || "").trim()) s.playerRoom.outfit = "";
}

function closeOutfitEditor() {
  outfitEditorState.idx = -1;
  outfitEditorState.mode = "manual";
  $("#equip-outfit-modal").hide();
}

function openOutfitEditor({ idx = -1, mode = "manual", draft = null } = {}) {
  const s = getSettings();
  if (!s) return;
  ensureEquipArrays(s);
  const base = normalizeOutfit(draft || s.inventory.outfits[idx] || {});
  outfitEditorState.idx = Number.isFinite(idx) ? idx : -1;
  outfitEditorState.mode = mode === "ai" ? "ai" : "manual";
  $("#equip-outfit-modal-title").text(idx >= 0 ? "Edit outfit" : mode === "ai" ? "Create outfit (AI)" : "Create outfit (Manual)");
  $("#equip-outfit-modal-sub").text(mode === "ai" ?
     "Generate a draft, then review and save it yourself."
    : "Edit the outfit directly, including category, sprite, and image.");
  $("#equip-outfit-name-input").val(base.name || "");
  $("#equip-outfit-category-input").val(base.category || "Everyday");
  $("#equip-outfit-custom-category-input").val(base.customCategory || "");
  $("#equip-outfit-slot-category-input").val(base.slotCategory || "Full Body");
  $("#equip-outfit-description-input").val(base.description || "");
  $("#equip-outfit-sprite-input").val(base.img || "");
  $("#equip-outfit-ai-context").val("");
  toggleOutfitCustomCategoryField(base.category || "Everyday");
  syncOutfitModalPreview(base.img || "");
  $("#equip-outfit-ai-wrap").toggleClass("equip-outfit-hidden", outfitEditorState.mode !== "ai");
  $("#equip-outfit-delete").toggleClass("equip-outfit-hidden", !(idx >= 0));
  $("#equip-outfit-modal").css("display", "flex");
}

function saveOutfitFromEditor() {
  const s = getSettings();
  if (!s) return;
  ensureEquipArrays(s);
  const existing = outfitEditorState.idx >= 0 && s.inventory.outfits[outfitEditorState.idx] ?
     normalizeOutfit(s.inventory.outfits[outfitEditorState.idx])
    : null;
  const source = existing?.source || (outfitEditorState.mode === "ai" ? "ai" : "manual");
  const readOnly = existing ? existing.readOnly === true : outfitEditorState.mode !== "ai";
  const draft = normalizeOutfit({ ...existing, ...readOutfitEditorDraft(), source, readOnly, worn: existing?.worn === true });
  if (outfitEditorState.idx >= 0 && s.inventory.outfits[outfitEditorState.idx]) s.inventory.outfits[outfitEditorState.idx] = draft;
  else s.inventory.outfits.push(draft);
  if (draft.worn) upsertEquipped(s, { ...draft, id: draft.outfitId, outfitId: draft.outfitId, slotId: "outfit", equipmentKind: "outfit", worn: true });
  syncOutfitMirrorState(s);
  saveSettings();
  closeOutfitEditor();
  renderLayer();
}

async function generateOutfitDraftFromEditor() {
  const context = String($("#equip-outfit-ai-context").val() || "").trim();
  const current = readOutfitEditorDraft();
  const promptText = `Return ONLY JSON for an outfit draft with fields: name, category, customCategory, slotCategory, description. Categories must be one of Everyday, Sleepwear, Party wear, Custom. Keep the name concise and remove the word Wear from it.\nCurrent draft:\n${JSON.stringify({ name: current.name, category: current.category, customCategory: current.customCategory, slotCategory: current.slotCategory, description: current.description })}\nContext:\n${String(context || document.body?.innerText || "").slice(0, 4000)}`;
  let draft = null;
  try {
    const raw = await generateContent(promptText, "System Check");
    draft = JSON.parse(String(raw || "").replace(/```json|```/g, "").trim());
  } catch (_) {
    draft = null;
  }
  const merged = normalizeOutfit({ ...current, ...(draft && typeof draft === "object" ? draft : {}), img: current.img || current.image || current.sprite || "" });
  $("#equip-outfit-name-input").val(merged.name || "");
  $("#equip-outfit-category-input").val(merged.category || "Everyday");
  $("#equip-outfit-custom-category-input").val(merged.customCategory || "");
  $("#equip-outfit-slot-category-input").val(merged.slotCategory || "Full Body");
  $("#equip-outfit-description-input").val(merged.description || "");
  toggleOutfitCustomCategoryField(merged.category || "Everyday");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

async function pickInventoryImage() {
  const input = document.getElementById("uie-inv-file");
  if (!input) return "";
  input.value = "";
  return await new Promise((resolve) => {
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return resolve("");
      try { resolve(await readFileAsDataUrl(file)); } catch (_) { resolve(""); }
    }, { once: true });
    input.click();
  });
}

function upsertEquipped(s, item) {
  ensureEquipArrays(s);
  const slotId = String(item?.slotId || "outfit").trim() || "outfit";
  const idx = s.inventory.equipped.findIndex(e => String(e?.slotId || "") === slotId);
  if (idx >= 0) s.inventory.equipped[idx] = { ...s.inventory.equipped[idx], ...item, slotId };
  else s.inventory.equipped.push({ ...item, slotId });
}

function wearOutfit(idx) {
  const s = getSettings();
  if (!s) return;
  ensureEquipArrays(s);
  const outfit = normalizeOutfit({ ...s.inventory.outfits[idx], worn: true });
  s.inventory.outfits = s.inventory.outfits.map((raw, outfitIdx) => normalizeOutfit({ ...raw, worn: outfitIdx === idx }));
  s.inventory.outfits[idx] = outfit;
  upsertEquipped(s, { ...outfit, id: outfit.outfitId, outfitId: outfit.outfitId, slotId: "outfit", equipmentKind: "outfit", worn: true });
  if (Array.isArray(outfit.equipment)) {
    for (const piece of outfit.equipment) {
      if (piece && typeof piece === "object" && piece.slotId) upsertEquipped(s, piece);
    }
  }
  if (outfit.img) {
    if (!s.character) s.character = {};
    s.character.avatar = outfit.img;
    s.character.portrait = outfit.img;
  }
  syncOutfitMirrorState(s);
  saveSettings();
  renderLayer();
  injectRpEvent(`[System: User wears outfit "${outfit.name}".]`);
}

function wearOutfitByName(name, options = {}) {
  const s = getSettings();
  if (!s) return false;
  ensureEquipArrays(s);
  const target = String(name || "").trim().toLowerCase();
  if (!target) return false;
  let idx = s.inventory.outfits.findIndex((raw) => String(raw?.name || "").trim().toLowerCase() === target);
  if (idx < 0) {
    const legacyItem = (Array.isArray(s.inventory.items) ? s.inventory.items : []).find((item) => String(item?.name || "").trim().toLowerCase() === target);
    const created = normalizeOutfit({
      name: String(name || "").trim(),
      description: String(options?.description || legacyItem?.desc || "Closet outfit.").trim(),
      slotCategory: String(options?.slotCategory || "Full Body").trim() || "Full Body",
      img: String(options?.img || legacyItem?.img || legacyItem?.image || "").trim(),
      source: "manual",
      readOnly: true,
    });
    s.inventory.outfits.push(created);
    idx = s.inventory.outfits.length - 1;
  }
  wearOutfit(idx);
  return true;
}

function editOutfit(idx) {
  const s = getSettings();
  if (!s) return;
  ensureEquipArrays(s);
  openOutfitEditor({ idx, mode: "manual" });
}

async function addOutfit(mode) {
  const s = getSettings();
  if (!s) return;
  ensureEquipArrays(s);
  openOutfitEditor({ idx: -1, mode: mode === "ai" ? "ai" : "manual" });
}

async function setOutfitImage(idx) {
  const img = await pickInventoryImage();
  if (!img) return;
  const s = getSettings();
  if (!s) return;
  ensureEquipArrays(s);
  if (!s.inventory.outfits[idx]) return;
  s.inventory.outfits[idx] = normalizeOutfit({ ...s.inventory.outfits[idx], img });
  if (s.inventory.outfits[idx]?.worn) upsertEquipped(s, { ...s.inventory.outfits[idx], id: s.inventory.outfits[idx].outfitId, outfitId: s.inventory.outfits[idx].outfitId, slotId: "outfit", equipmentKind: "outfit", worn: true });
  syncOutfitMirrorState(s);
  saveSettings();
  renderLayer();
}

async function setOutfitSprite(idx) {
  openOutfitEditor({ idx, mode: "manual" });
  const input = document.getElementById("equip-outfit-sprite-input");
  if (input) {
    input.focus();
    input.select();
  }
}

function renderOutfits() {
  const s = getSettings();
  if (!s) return;
  ensureEquipArrays(s);
  syncOutfitMirrorState(s);
  $("#equip-status-wrap").empty().append(`<div class="equip-chip">${s.inventory.outfits.length} outfit${s.inventory.outfits.length === 1 ? "" : "s"}</div>`);

  const $container = $("#equip-outfit-container").empty();

  const byCategory = {};
  OUTFIT_BASE_CATEGORIES.forEach(c => { byCategory[c] = []; });
  const customGroups = new Map();
  s.inventory.outfits.forEach((raw, idx) => {
    const outfit = normalizeOutfit(raw);
    s.inventory.outfits[idx] = outfit;
    if (outfit.category === "Custom") {
      const label = getOutfitDisplayCategory(outfit);
      const bucket = customGroups.get(label) || [];
      bucket.push({ outfit, idx });
      customGroups.set(label, bucket);
      return;
    }
    byCategory[outfit.category].push({ outfit, idx });
  });

  const hasAny = s.inventory.outfits.length > 0;
  if (!hasAny) {
    $container.append(`<div style="opacity:0.75;padding:18px;border:1px solid rgba(255,255,255,0.10);border-radius:12px;background:rgba(255,255,255,0.04);margin-bottom:10px;">No outfits yet. Use the header buttons to create a manual outfit or generate an AI draft, then attach sprite or image media inside the editor.</div>`);
    return;
  }

  const sections = [
    ...OUTFIT_BASE_CATEGORIES.filter((cat) => cat !== "Custom").map((cat) => ({ label: cat, items: byCategory[cat] })),
    ...Array.from(customGroups.entries()).map(([label, items]) => ({ label, items })),
  ];

  sections.forEach(({ label, items }) => {
    if (!items.length) return;
    const $section = $(`<div style="margin-bottom:16px;"></div>`);
    $section.append(`<div style="font-size:11px;font-weight:900;color:#cba35c;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;padding:4px 0;border-bottom:1px solid rgba(203, 163, 92,0.18);display:flex;align-items:center;justify-content:space-between;gap:10px;"><span>${esc(label)}</span><span style="opacity:0.72;">${items.length}</span></div>`);
    const $grid = $('<div class="equip-outfit-grid"></div>');
    items.forEach(({ outfit, idx }) => {
      const img = outfit.img ? `<img src="${esc(outfit.img)}" alt="">` : `<i class="fa-solid fa-shirt" style="font-size:36px;color:#cba35c;"></i>`;
      const meta = [
        outfit.worn ? '<span class="equip-chip" style="background:rgba(46,204,113,0.18); border-color:rgba(46,204,113,0.34); color:#8df0b1;">Worn</span>' : '',
        outfit.source === 'manual' ? '<span class="equip-chip">Manual</span>' : '<span class="equip-chip">AI</span>',
        outfit.readOnly ? '<span class="equip-chip" style="background:rgba(52,152,219,0.16); border-color:rgba(52,152,219,0.30); color:#8cc8ff;">Read Only</span>' : '',
      ].filter(Boolean).join('');
      $grid.append(`
        <div class="equip-outfit-card" data-idx="${idx}">
          <div class="equip-outfit-media">${img}</div>
          <div class="equip-outfit-info">
            <div class="equip-outfit-category">${esc(outfit.slotCategory)}</div>
            <div class="equip-outfit-title">${esc(outfit.name)}</div>
            <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">${meta}</div>
            <div class="equip-outfit-sub">${esc(outfit.description || `${getOutfitDisplayCategory(outfit)} outfit.`)}</div>
            <div class="equip-outfit-actions">
              <button type="button" class="equip-btn primary equip-outfit-wear" data-idx="${idx}">${outfit.worn ? 'Wearing' : 'Wear'}</button>
              <button type="button" class="equip-btn equip-outfit-edit" data-idx="${idx}">Edit</button>
              <button type="button" class="equip-btn equip-outfit-sprite-set" data-idx="${idx}">Sprite</button>
              <button type="button" class="equip-btn equip-outfit-img" data-idx="${idx}">Image</button>
            </div>
          </div>
        </div>
      `);
    });
    $section.append($grid);
    $container.append($section);
  });
}

// Pads a slice up to 3 slots using immersion fillers (unique per page)
function padToThree(slice, side, layerName, alreadyUsedIds) {
  const out = [...slice];
  const want = 3 - out.length;
  if (want <= 0) return out;

  const pool = (FILLERS[layerName] && FILLERS[layerName][side]) ? FILLERS[layerName][side] : [];
  for (const id of pool) {
    if (out.length >= 3) break;
    if (alreadyUsedIds.has(id)) continue;
    alreadyUsedIds.add(id);
    out.push({ id, side, icon: ICON_BY_ID[id] || "fa-circle-question" });
  }

  // If still short (unlikely), add blank pads (non-interactive)
  while (out.length < 3) {
    const pid = `pad_${layerName}_${side}_${out.length}`;
    alreadyUsedIds.add(pid);
    out.push({ id: pid, side, icon: "fa-circle" , _pad: true });
  }

  return out;
}

function renderLayer() {
  const s = getSettings();
  if (!s) return;
  ensureEquipArrays(s);
  syncOutfitMirrorState(s);

  const layer = LAYERS[currentLayerIndex];
  const pageInfo = splitBySide(layer);

  $("#equip-layer-name").text(layer.name);
  $(".equip-outfit-toolbar").toggle(layer.type === "outfits");

  const isOutfits = layer.type === "outfits";
  $("#equip-paper-doll-grid").toggle(!isOutfits);
  $("#equip-outfit-container").toggle(isOutfits);

  if (isOutfits) {
    renderOutfits();
    return;
  }

  // Desktop Mode: Show ALL slots (No Paging)
  $("#equip-page-prev, #equip-page-next, #equip-page-ind").hide();

  const avatar = String(s.character?.avatar || s.character?.portrait || s.avatar || "").trim();
  if (avatar) {
    $("#equip-doll-img").attr("src", avatar).show();
    $("#equip-doll-empty").hide();
  } else {
    $("#equip-doll-img").hide();
    $("#equip-doll-empty").show();
  }

  const leftCol = $("#equip-slot-left");
  const rightCol = $("#equip-slot-right");
  if (!leftCol.length || !rightCol.length) return;

  leftCol.empty();
  rightCol.empty();

  const equipped = Array.isArray(s.inventory.equipped) ? s.inventory.equipped : [];

  // Show ALL slots for the layer
  const compactMobile = isCompactMobileLayout();
  let leftSlice = [...pageInfo.left];
  let rightSlice = [...pageInfo.right];

  // GLOBAL MAX LENGTH FIX:
  // The user wants "all paper dolls to be the longest one".
  // The 'GEAR' layer has 6 slots per side. We must force ALL layers to have 6 slots per side.
  const GLOBAL_MAX = 6;

  // Pad left side to GLOBAL_MAX
  if (!compactMobile && leftSlice.length < GLOBAL_MAX) {
      while(leftSlice.length < GLOBAL_MAX) {
          const pid = `pad_${layer.name}_left_${leftSlice.length}`;
          leftSlice.push({ id: pid, side: "left", icon: "fa-circle", _pad: true });
      }
  }

  // Pad right side to GLOBAL_MAX
  if (!compactMobile && rightSlice.length < GLOBAL_MAX) {
      while(rightSlice.length < GLOBAL_MAX) {
          const pid = `pad_${layer.name}_right_${rightSlice.length}`;
          rightSlice.push({ id: pid, side: "right", icon: "fa-circle", _pad: true });
      }
  }

  function makeWrap(slot) {
    const isPad = !!slot._pad || String(slot.id).startsWith("pad_");
    const label = isPad ? "Empty Slot" : (SLOT_LABELS[slot.id] || String(slot.id || "").trim() || "Slot");
    const mobileLabel = isPad ? "EMPTY" : label.toUpperCase();

    let inner = `<i class="fa-solid ${slot.icon}" style="font-size:1.5em; color:rgba(255,255,255,0.5);"></i>`;
    let itemName = isPad ? "" : "No item equipped";
    let isEquipped = false;
    let eqItem = null;

    if (!isPad) {
      const found = findEquippedBySlot(equipped, slot.id);
      eqItem = found.item;

      if (eqItem) {
        isEquipped = true;
        itemName = eqItem.name || "Unknown Item";
        const itemImg = String(eqItem.img || eqItem.image || "").trim();
        if (itemImg) {
          inner = `<img src="${itemImg}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
        } else {
           // If item has no image, keep default icon but maybe brighter?
           // Or use a generic bag icon. Let's stick to the slot icon but brighter.
           inner = `<i class="fa-solid ${slot.icon}" style="font-size:1.5em; color:#cba35c;"></i>`;
        }
      }
    }

    // New Desktop-Friendly Row Structure
    // Uses 'equip-slot' class to match equipment.html CSS
    return $(`
      <div class="equip-slot ${isPad ? 'pad' : ''} ${isEquipped ? 'filled' : ''}" data-id="${slot.id}">
        <div class="equip-icon">
          ${inner}
        </div>
        <div class="equip-mid">
          <div class="slot-name">${label}</div>
          <div class="slot-name-mobile">${mobileLabel}</div>
          <div class="item-name" style="${isEquipped ? '' : 'opacity:0.62; font-weight:700;'}">${itemName}</div>
        </div>
      </div>
    `);
  }

  leftSlice.forEach(slot => leftCol.append(makeWrap(slot)));
  rightSlice.forEach(slot => rightCol.append(makeWrap(slot)));
}

export function init() {
  try {
    $(document)
      .off("click.uieEquipPrev", "#equip-layer-prev")
      .on("click.uieEquipPrev", "#equip-layer-prev", (e) => {
        e.preventDefault();
        currentLayerIndex = (currentLayerIndex - 1 + LAYERS.length) % LAYERS.length;
        currentPage = 0;
        renderLayer();
      });

    $(document)
      .off("click.uieEquipNext", "#equip-layer-next")
      .on("click.uieEquipNext", "#equip-layer-next", (e) => {
        e.preventDefault();
        currentLayerIndex = (currentLayerIndex + 1) % LAYERS.length;
        currentPage = 0;
        renderLayer();
      });

    $(document)
      .off("click.uieEquipPagePrev", "#equip-page-prev")
      .on("click.uieEquipPagePrev", "#equip-page-prev", (e) => {
        e.preventDefault();
        currentPage -= 1;
        renderLayer();
      });

    $(document)
      .off("click.uieEquipPageNext", "#equip-page-next")
      .on("click.uieEquipPageNext", "#equip-page-next", (e) => {
        e.preventDefault();
        currentPage += 1;
        renderLayer();
      });

    $(document)
      .off("click.uieOutfitHeader", "#equip-outfit-manual, #equip-outfit-ai")
      .on("click.uieOutfitHeader", "#equip-outfit-manual, #equip-outfit-ai", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const id = String(this.id || "");
        if (id === "equip-outfit-ai") await addOutfit("ai");
        else await addOutfit("manual");
      });

    $(document)
      .off("click.uieOutfitCard", ".equip-outfit-wear, .equip-outfit-edit, .equip-outfit-img, .equip-outfit-sprite-set")
      .on("click.uieOutfitCard", ".equip-outfit-wear, .equip-outfit-edit, .equip-outfit-img, .equip-outfit-sprite-set", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number($(this).data("idx"));
        if (!Number.isFinite(idx)) return;
        if ($(this).hasClass("equip-outfit-wear")) wearOutfit(idx);
        else if ($(this).hasClass("equip-outfit-edit")) editOutfit(idx);
        else if ($(this).hasClass("equip-outfit-sprite-set")) await setOutfitSprite(idx);
        else await setOutfitImage(idx);
      });

    $(document)
      .off("change.uieOutfitCategory", "#equip-outfit-category-input")
      .on("change.uieOutfitCategory", "#equip-outfit-category-input", function () {
        toggleOutfitCustomCategoryField($(this).val());
      });

    $(document)
      .off("input.uieOutfitPreview", "#equip-outfit-sprite-input")
      .on("input.uieOutfitPreview", "#equip-outfit-sprite-input", function () {
        syncOutfitModalPreview($(this).val());
      });

    $(document)
      .off("click.uieOutfitModalClose", "#equip-outfit-modal-close, #equip-outfit-cancel")
      .on("click.uieOutfitModalClose", "#equip-outfit-modal-close, #equip-outfit-cancel", function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeOutfitEditor();
      });

    $(document)
      .off("click.uieOutfitModalBackdrop", "#equip-outfit-modal")
      .on("click.uieOutfitModalBackdrop", "#equip-outfit-modal", function (e) {
        if (e.target !== this) return;
        e.preventDefault();
        e.stopPropagation();
        closeOutfitEditor();
      });

    $(document)
      .off("click.uieOutfitModalPick", "#equip-outfit-pick-image")
      .on("click.uieOutfitModalPick", "#equip-outfit-pick-image", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const img = await pickInventoryImage();
        if (!img) return;
        $("#equip-outfit-sprite-input").val(img);
        syncOutfitModalPreview(img);
      });

    $(document)
      .off("click.uieOutfitModalApplySprite", "#equip-outfit-apply-sprite")
      .on("click.uieOutfitModalApplySprite", "#equip-outfit-apply-sprite", function (e) {
        e.preventDefault();
        e.stopPropagation();
        syncOutfitModalPreview($("#equip-outfit-sprite-input").val());
      });

    $(document)
      .off("click.uieOutfitModalClear", "#equip-outfit-clear-image")
      .on("click.uieOutfitModalClear", "#equip-outfit-clear-image", function (e) {
        e.preventDefault();
        e.stopPropagation();
        $("#equip-outfit-sprite-input").val("");
        syncOutfitModalPreview("");
      });

    $(document)
      .off("click.uieOutfitModalSave", "#equip-outfit-save")
      .on("click.uieOutfitModalSave", "#equip-outfit-save", function (e) {
        e.preventDefault();
        e.stopPropagation();
        saveOutfitFromEditor();
      });

    $(document)
      .off("click.uieOutfitModalDelete", "#equip-outfit-delete")
      .on("click.uieOutfitModalDelete", "#equip-outfit-delete", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        if (!s) return;
        ensureEquipArrays(s);
        if (outfitEditorState.idx < 0 || !s.inventory.outfits[outfitEditorState.idx]) return;
        const target = normalizeOutfit(s.inventory.outfits[outfitEditorState.idx]);
        s.inventory.outfits.splice(outfitEditorState.idx, 1);
        s.inventory.equipped = (Array.isArray(s.inventory.equipped) ? s.inventory.equipped : []).filter((item) => {
          const slotId = String(item?.slotId || "").trim();
          const outfitId = String(item?.outfitId || item?.id || "").trim();
          if (slotId !== "outfit" && String(item?.equipmentKind || "") !== "outfit") return true;
          return outfitId !== target.outfitId;
        });
        syncOutfitMirrorState(s);
        saveSettings();
        closeOutfitEditor();
        renderLayer();
      });

    $(document)
      .off("click.uieOutfitModalAi", "#equip-outfit-ai-generate")
      .on("click.uieOutfitModalAi", "#equip-outfit-ai-generate", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        await generateOutfitDraftFromEditor();
      });

    // Updated selector to match new class name '.equip-slot'
    $(document)
      .off("click.uieEquipSlot", "#uie-view-equip .equip-slot")
      .on("click.uieEquipSlot", "#uie-view-equip .equip-slot", function (e) {
        e.preventDefault();

        // ignore pad slots
        if ($(this).hasClass("pad")) return;

        const slotId = String($(this).data("id") || "");
        if (!slotId) return;

        const s = getSettings();
        if (!s) return;
        ensureEquipArrays(s);

        const found = findEquippedBySlot(s.inventory.equipped, slotId);
        if (found.item) {
          const putBack = { ...found.item };
          delete putBack.slotId;
          s.inventory.equipped.splice(found.index, 1);
          addInventoryItemWithStack(s.inventory.items, putBack, { source: "unequip" });
          saveSettings();
          renderLayer();
          injectRpEvent(`[System: User unequipped ${putBack.name}.]`);
        }
      });

    renderLayer();
  } catch (err) {
    console.error("[UIE] equipment.js init prevented crash:", err);
  }
}

export function openOutfitCreator(mode = "manual") {
  openOutfitEditor({ idx: -1, mode: mode === "ai" ? "ai" : "manual" });
}

export function openOutfitEditorByIndex(idx, mode = "manual") {
  openOutfitEditor({ idx: Number.isFinite(Number(idx)) ? Number(idx) : -1, mode: mode === "ai" ? "ai" : "manual" });
}

export function wearNamedOutfit(name, options = {}) {
  return wearOutfitByName(name, options);
}

export function render() {
  // Only re-render when the Equip tab is active
  try {
    if (!$("#uie-inventory-window .tab-wrap[data-tab='equipment']").hasClass("active")) return;
  } catch (e) {
    // If DOM isn't ready, just bail safely
    return;
  }

  try { renderLayer(); }
  catch (e) { console.error("[UIE] Equipment.render failed", e); }
}

