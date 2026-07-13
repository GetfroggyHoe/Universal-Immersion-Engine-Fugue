import { inferItemType } from "./slot_types_infer.js";

const FORGE_CATEGORIES = new Set(["CRAFTING", "CONSTRUCTION", "TAILORING", "ARCHAEOLOGY", "MERCHANT"]);
const ALCHEMY_CATEGORIES = new Set(["ALCHEMY", "FORAGING", "FARMING", "OCCULT", "COOKING", "ENTOMOLOGY"]);
const ENCHANT_CATEGORIES = new Set(["ENCHANTMENT", "OCCULT", "ARCHAEOLOGY", "ALCHEMY"]);

function textBlob(item) {
  return [
    item?.name,
    item?.type,
    item?.slotCategory,
    item?.category,
    item?.description,
    item?.desc,
    Array.isArray(item?.tags) ? item.tags.join(" ") : "",
  ].join(" ").toLowerCase();
}

export function normalizeSlotCategory(item) {
  const explicit = String(item?.slotCategory || "").trim().toUpperCase();
  if (explicit) return explicit;
  const inferred = inferItemType(item);
  const category = String(inferred?.category || "").trim().toUpperCase();
  return category || "UNCATEGORIZED";
}

export function ensureCraftingCategory(item) {
  if (!item || typeof item !== "object") return item;
  const category = normalizeSlotCategory(item);
  if (category && category !== "UNCATEGORIZED") item.slotCategory = category;
  if (!Array.isArray(item.tags)) item.tags = [];
  const tag = category && category !== "UNCATEGORIZED" ? `category:${category}` : "";
  if (tag && !item.tags.some((entry) => String(entry).toLowerCase() === tag.toLowerCase())) item.tags.push(tag);
  return item;
}

export function isForgeMaterial(item) {
  const category = normalizeSlotCategory(item);
  const blob = textBlob(item);
  return FORGE_CATEGORIES.has(category) || /\b(ore|ingot|alloy|metal|plate|leather|hide|wood|plank|cloth|thread|scrap|gear|rivet|crystal|forge|smith|blueprint|schematic|recipe)\b/.test(blob);
}

export function isAlchemyReagent(item) {
  const category = normalizeSlotCategory(item);
  const blob = textBlob(item);
  return ALCHEMY_CATEGORIES.has(category) || /\b(potion|elixir|poison|reagent|herb|mushroom|extract|essence|vial|flask|solvent|catalyst|venom|acid|root|berry|flower|recipe)\b/.test(blob);
}

export function isEnchantComponent(item) {
  const category = normalizeSlotCategory(item);
  const blob = textBlob(item);
  return ENCHANT_CATEGORIES.has(category) || /\b(rune|sigil|glyph|gem|jewel|crystal|dust|essence|shard|ward|seal|soul|mana|arcane|enchant|recipe)\b/.test(blob);
}

export function summarizeCraftInputs(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => `${item?.name || "Item"} [${normalizeSlotCategory(item)}]`)
    .slice(0, 12)
    .join(", ");
}
