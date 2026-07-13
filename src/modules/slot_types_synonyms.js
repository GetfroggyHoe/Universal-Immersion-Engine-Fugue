/**
 * Slot Types Synonyms / Alias Map (Hybrid inference)
 * Goal: catch different AI model wording.
 *
 * - Keys should be normalized tokens (lowercase).
 * - Values can set: category, group, subtype
 */

export const SLOT_SYNONYMS = {
  // Enchantment / Spirit / Containers
  "soul jar":        { category:"ENCHANTMENT", group:"Catalysts", subtype:"Phylactery" },
  "spirit jar":      { category:"ENCHANTMENT", group:"Spirit", subtype:"Spirit Orb" },
  "lich jar":        { category:"ENCHANTMENT", group:"Catalysts", subtype:"Phylactery" },
  "soul container":  { category:"ENCHANTMENT", group:"Catalysts", subtype:"Phylactery" },
  "binding thread":  { category:"ENCHANTMENT", group:"Binding Agents" },
  "runeword":        { category:"ENCHANTMENT", group:"Sockets (Runewords)" },

  // Alchemy
  "healing brew":    { category:"ALCHEMY", group:"Refined States", subtype:"Solution" },
  "healing potion":  { category:"ALCHEMY", group:"Refined States", subtype:"Solution" },
  "antidote":        { category:"ALCHEMY", group:"Refined States", subtype:"Solution" },
  "sleep gas":       { category:"ALCHEMY", group:"Gases", subtype:"Gas (Sleep)" },
  "poison gas":      { category:"ALCHEMY", group:"Gases", subtype:"Gas (Poison)" },

  // Crafting / Engineering
  "pcb":             { category:"CRAFTING", group:"Electronics", subtype:"Circuit Board" },
  "microcontroller": { category:"CRAFTING", group:"Electronics", subtype:"Microchip" },
  "duct tape":       { category:"CRAFTING", group:"Adhesives", subtype:"Tape (Duct)" },
  "electrical tape": { category:"CRAFTING", group:"Adhesives", subtype:"Tape (Electrical)" },

  // Fishing
  "fishing license": { category:"FISHING", group:"Utility", subtype:"License" },
  "crab trap":       { category:"FISHING", group:"Traps", subtype:"Crab Pot" },

  // Entomology
  "bug net":         { category:"ENTOMOLOGY", group:"Collection Tools", subtype:"Net (Bug)" },
  "specimen jar":    { category:"ENTOMOLOGY", group:"Collection Tools", subtype:"Jar (Specimen)" },

  // Quest
  "access card":     { category:"QUEST", group:"Keys", subtype:"Card Key" },
  "keycard":         { category:"QUEST", group:"Keys", subtype:"Card Key" },
  "evidence bag":    { category:"QUEST", group:"Crime", subtype:"Evidence (Bagged)" },

  // Merchant
  "bill of lading":  { category:"MERCHANT", group:"Documents", subtype:"Bill of Lading" },
  "shipping invoice":{ category:"MERCHANT", group:"Documents", subtype:"Invoice" },

  // Foraging & Botany
  "glowing moss":     { category:"FORAGING", group:"Fungi", subtype:"Glowing Moss" },
  "cave mushroom":    { category:"FORAGING", group:"Fungi", subtype:"Cave Mushroom" },
  "medicinal herb":   { category:"FORAGING", group:"Medicinal Herbs" },
  "swamp root":       { category:"FORAGING", group:"Medicinal Herbs" },

  // Tailoring & Alchemical Textiles
  "mana thread":       { category:"TAILORING", group:"Alchemical Stitching", subtype:"Mana Thread" },
  "spirit stitch":     { category:"TAILORING", group:"Alchemical Stitching" },
  "reagent pouch":     { category:"TAILORING", group:"Reagent Carriers" },
  "transmutation bolt":{ category:"TAILORING", group:"Woven Fabrics" },

  // Occult & Necromancy
  "cursed doll":      { category:"OCCULT", group:"Cursed Objects" },
  "black candle":     { category:"OCCULT", group:"Ritual Components" },
  "ouija board":      { category:"OCCULT", group:"Divination Tools" },
  "voodoo doll":      { category:"OCCULT", group:"Cursed Objects" },

  // Bardic & Performance
  "sheet music":      { category:"BARDIC", group:"Sheet Music" },
  "troubadour sonnet":{ category:"BARDIC", group:"Sheet Music" },
  "wooden lute":      { category:"BARDIC", group:"String Instruments" },
};

export function normalizeToken(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
