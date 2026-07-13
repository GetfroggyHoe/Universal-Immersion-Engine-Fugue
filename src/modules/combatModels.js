export const COMBAT_LANES = ["front", "mid", "back"];
export const COMBAT_STAT_KEYS = ["str", "dex", "con", "int", "wis", "cha", "per", "luk"];

const LANE_MODIFIERS = {
  front: { threatMultiplier: 1.75, interceptChance: 0.5, magicalEvasion: 0, rangedAccuracy: 0 },
  mid: { threatMultiplier: 1, interceptChance: 0, magicalEvasion: 0.1, rangedAccuracy: 0 },
  back: { threatMultiplier: 0.6, interceptChance: 0, magicalEvasion: 0.15, rangedAccuracy: 0.1 },
};

export function combatSlug(value, fallback = "combatant") {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || fallback;
}

export function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeLane(value, fallback = "mid") {
  const lane = String(value || "").trim().toLowerCase();
  return COMBAT_LANES.includes(lane) ? lane : fallback;
}

export function normalizeStats(raw = {}) {
  const stats = {};
  for (const key of COMBAT_STAT_KEYS) stats[key] = finiteNumber(raw?.[key], 10);
  return stats;
}

export function normalizeVitals(raw = {}) {
  const maxHp = Math.max(1, finiteNumber(raw?.maxHp, 100));
  const maxMp = Math.max(1, finiteNumber(raw?.maxMp, 50));
  const maxAp = Math.max(1, finiteNumber(raw?.maxAp, 10));
  return {
    hp: Math.max(0, Math.min(maxHp, finiteNumber(raw?.hp, maxHp))),
    maxHp,
    mp: Math.max(0, Math.min(maxMp, finiteNumber(raw?.mp, maxMp))),
    maxMp,
    ap: Math.max(0, Math.min(maxAp, finiteNumber(raw?.ap, maxAp))),
    maxAp,
  };
}

export function normalizeStatusList(raw = []) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((status) => {
      if (typeof status === "string") return { id: combatSlug(status, "status"), name: status.trim(), mods: {} };
      if (!status || typeof status !== "object") return null;
      const name = String(status.name || status.label || status.id || "").trim();
      if (!name) return null;
      return { ...status, id: String(status.id || combatSlug(name, "status")), name, mods: normalizeModifierMap(status.mods) };
    })
    .filter(Boolean)
    .slice(0, 40);
}

export function normalizeModifierMap(raw = {}) {
  if (!raw || typeof raw !== "object") return {};
  const nestedStats = raw.stats && typeof raw.stats === "object" ? raw.stats : {};
  const result = {};
  for (const key of [...COMBAT_STAT_KEYS, "vit", "maxHp", "maxMp", "maxAp", "defense", "magicalDefense", "accuracy", "evasion", "magicalEvasion", "criticalChance", "speed", "threat", "interceptChance", "healingPower"]) {
    const value = finiteNumber(raw[key] ?? nestedStats[key], 0);
    if (value) result[key === "vit" ? "con" : key] = value;
  }
  return result;
}

export function collectModifierTotals(sources = []) {
  const totals = {};
  for (const source of sources) {
    const mods = normalizeModifierMap(source?.mods || source);
    for (const [key, value] of Object.entries(mods)) totals[key] = finiteNumber(totals[key], 0) + value;
  }
  return totals;
}

export function normalizeCombatAction(raw, source = "member") {
  if (!raw) return null;
  const data = typeof raw === "string" ? { name: raw } : raw;
  if (!data || typeof data !== "object") return null;
  const name = String(data.name || data.title || data.skill || "").trim();
  if (!name) return null;
  const skillType = String(data.skillType || data.type || "active").trim().toLowerCase();
  if (skillType === "passive") return null;
  const sourceName = String(data.source || source || "member");
  const costs = data.costs && typeof data.costs === "object"
    ? { ...data.costs }
    : (data.cost && typeof data.cost === "object" ? { ...data.cost } : {});
  if (!Object.keys(costs).length && sourceName.toLowerCase().includes("skill")) costs.mp = 5;
  return {
    ...data,
    id: String(data.id || `${combatSlug(sourceName, "skill")}:${combatSlug(name, "action")}`),
    name,
    label: String(data.label || name),
    description: String(data.description || data.desc || ""),
    source: sourceName,
    type: "skill",
    tags: Array.isArray(data.tags) ? data.tags.map((tag) => String(tag || "").trim()).filter(Boolean) : [],
    costs,
    cost: costs,
    targeting: data.targeting && typeof data.targeting === "object"
      ? { ...data.targeting }
      : { side: "enemy", scope: "single" },
  };
}

export function calculateDerivedStats(stats, modifierTotals = {}, lane = "mid", role = "") {
  const laneKey = normalizeLane(lane);
  const laneMods = LANE_MODIFIERS[laneKey];
  const effective = {};
  for (const key of COMBAT_STAT_KEYS) effective[key] = Math.max(1, finiteNumber(stats?.[key], 10) + finiteNumber(modifierTotals?.[key], 0));
  const roleText = String(role || "").toLowerCase();
  const frontRoleBonus = laneKey === "front" && /(tank|guardian|bruiser|vanguard)/.test(roleText) ? 0.2 : 0;
  return {
    stats: effective,
    physicalAttack: effective.str + Math.floor(effective.dex / 4),
    magicalAttack: effective.int + Math.floor(effective.wis / 4),
    defense: effective.con + finiteNumber(modifierTotals.defense, 0),
    magicalDefense: effective.wis + finiteNumber(modifierTotals.magicalDefense, 0),
    accuracy: effective.dex + effective.per + finiteNumber(modifierTotals.accuracy, 0),
    evasion: Math.floor((effective.dex + effective.luk) / 2) + finiteNumber(modifierTotals.evasion, 0),
    magicalEvasion: laneMods.magicalEvasion + finiteNumber(modifierTotals.magicalEvasion, 0),
    criticalChance: Math.min(0.75, 0.05 + (effective.luk * 0.005) + finiteNumber(modifierTotals.criticalChance, 0)),
    speed: effective.dex + finiteNumber(modifierTotals.speed, 0),
    threat: Math.max(0.1, laneMods.threatMultiplier + finiteNumber(modifierTotals.threat, 0)),
    interceptChance: Math.min(0.9, laneMods.interceptChance + frontRoleBonus + Math.max(0, effective.con - 10) * 0.01 + finiteNumber(modifierTotals.interceptChance, 0)),
    rangedAccuracy: laneMods.rangedAccuracy,
    healingPower: effective.wis + Math.floor(effective.cha / 4) + finiteNumber(modifierTotals.healingPower, 0),
  };
}

export function withLegacyCombatAliases(combatant) {
  const vitals = combatant.vitals || normalizeVitals();
  return {
    ...combatant,
    hp: vitals.hp,
    maxHp: vitals.maxHp,
    mp: vitals.mp,
    maxMp: vitals.maxMp,
    ap: vitals.ap,
    maxAp: vitals.maxAp,
    imageUrl: combatant.presentation?.portrait || combatant.imageUrl || "",
    sprite: combatant.presentation?.portrait || combatant.sprite || "",
    baseStats: combatant.baseStats || combatant.derived?.stats || combatant.stats || normalizeStats(),
  };
}
