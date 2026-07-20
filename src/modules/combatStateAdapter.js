import {
  COMBAT_LANES,
  calculateDerivedStats,
  collectModifierTotals,
  combatSlug,
  finiteNumber,
  normalizeCombatAction,
  normalizeLane,
  normalizeStats,
  normalizeStatusList,
  normalizeVitals,
  withLegacyCombatAliases,
} from "./combatModels.js";
import { resolvePartyPortraitUrl } from "./partyPortraits.js";

function memberName(member, fallback = "Party Member") {
  return String(member?.identity?.name || member?.name || fallback).trim() || fallback;
}

function memberClass(member) {
  return String(member?.identity?.class || member?.className || member?.class || "Adventurer").trim() || "Adventurer";
}

function isUserMember(settings, member) {
  const roles = Array.isArray(member?.roles) ? member.roles.map((role) => String(role || "").toLowerCase()) : [];
  if (roles.includes("user") || member?.isUser === true) return true;
  const memberKey = memberName(member, "").toLowerCase();
  const userKey = String(settings?.character?.name || settings?.name || "").trim().toLowerCase();
  return !!memberKey && !!userKey && memberKey === userKey;
}

function inferLaneFromRole(role) {
  const value = String(role || "").toLowerCase();
  if (/(tank|bruiser|guardian|vanguard|front)/.test(value)) return "front";
  if (/(healer|mage|caster|ranger|support|sniper|back)/.test(value)) return "back";
  return "mid";
}

function normalizeEquipment(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean).map((item) => typeof item === "string" ? { name: item } : { ...item });
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw)
    .filter(([, item]) => !!item)
    .map(([slotId, item]) => typeof item === "string" ? { slotId, name: item } : { slotId, ...item });
}

function mergeEquipment(...lists) {
  const merged = new Map();
  for (const list of lists) {
    for (const item of normalizeEquipment(list)) {
      const key = String(item?.slotId || item?.id || item?.name || `item_${merged.size}`).trim().toLowerCase();
      merged.set(key, item);
    }
  }
  return Array.from(merged.values());
}

function collectMemberActions(member, extraSkills = []) {
  const actions = [];
  const seen = new Set();
  const add = (raw, source) => {
    const action = normalizeCombatAction(raw, source);
    if (!action || seen.has(action.id)) return;
    seen.add(action.id);
    actions.push(action);
  };

  for (const skill of Array.isArray(member?.skills) ? member.skills : []) add(skill, skill?.source || "memberSkill");
  for (const node of Array.isArray(member?.skillTree?.nodes) ? member.skillTree.nodes : []) {
    if (node?.unlocked === true && String(node?.type || "").toLowerCase() === "active") add({ ...node, description: node.desc, source: "SkillTree" }, "SkillTree");
  }
  for (const skill of Array.isArray(extraSkills) ? extraSkills : []) add(skill, "InventorySkill");
  return actions;
}

function projectMember(settings, member, lane, laneIndex, options = {}) {
  const user = isUserMember(settings, member);
  const equipment = user
    ? mergeEquipment(member?.equipment, settings?.inventory?.equipped)
    : normalizeEquipment(member?.equipment);
  const statuses = normalizeStatusList(user
    ? [...(Array.isArray(member?.statusEffects) ? member.statusEffects : []), ...(Array.isArray(settings?.character?.statusEffects) ? settings.character.statusEffects : [])]
    : member?.statusEffects);
  const extraSkills = user ? settings?.inventory?.skills : [];
  const actions = collectMemberActions(member, extraSkills);
  const passiveSkills = (Array.isArray(member?.skills) ? member.skills : []).filter((skill) => String(skill?.skillType || skill?.type || "").toLowerCase() === "passive");
  const modifierTotals = collectModifierTotals([...equipment, ...statuses, ...passiveSkills]);
  const stats = normalizeStats(member?.stats || (user ? settings?.character?.stats : {}));
  const sourceVitals = user
    ? {
        ...member?.vitals,
        hp: member?.vitals?.hp ?? settings?.hp,
        maxHp: member?.vitals?.maxHp ?? settings?.maxHp,
        mp: member?.vitals?.mp ?? settings?.mp,
        maxMp: member?.vitals?.maxMp ?? settings?.maxMp,
        ap: member?.vitals?.ap ?? settings?.ap,
        maxAp: member?.vitals?.maxAp ?? settings?.maxAp,
      }
    : member?.vitals;
  const vitals = normalizeVitals({
    ...sourceVitals,
    maxHp: finiteNumber(sourceVitals?.maxHp, 100) + finiteNumber(modifierTotals.maxHp, 0),
    maxMp: finiteNumber(sourceVitals?.maxMp, 50) + finiteNumber(modifierTotals.maxMp, 0),
    maxAp: finiteNumber(sourceVitals?.maxAp, 10) + finiteNumber(modifierTotals.maxAp, 0),
  });
  const role = String(member?.partyRole || (user ? "Leader" : "DPS"));
  const derived = calculateDerivedStats(stats, modifierTotals, lane, role);
  const id = String(member?.id || `party_${combatSlug(memberName(member))}`);
  const level = Math.max(1, Math.round(finiteNumber(member?.progression?.level ?? (user ? settings?.character?.level : 1), 1)));
  const portrait = resolvePartyPortraitUrl(settings, member, { isUser: user });

  return withLegacyCombatAliases({
    id,
    persistentRef: { domain: "partyMember", id, user },
    entityType: "character",
    side: "ally",
    name: memberName(member),
    className: memberClass(member),
    role,
    lane: normalizeLane(lane),
    laneIndex,
    stats,
    derived,
    vitals,
    equipment,
    statuses,
    actions,
    tactics: member?.tactics && typeof member.tactics === "object" ? { ...member.tactics } : {},
    presentation: {
      portrait,
      spriteIdentity: memberName(member),
      defaultExpression: "neutral",
      currentExpression: "neutral",
    },
    jobClass: { level, baseStats: derived.stats },
    level,
    source: options.source || "party",
  });
}

function fallbackPlayer(settings) {
  const name = String(settings?.character?.name || settings?.name || "Player").trim() || "Player";
  const member = {
    id: "party_user",
    identity: { name, class: settings?.character?.className || settings?.character?.class || "Adventurer" },
    images: { portrait: settings?.character?.avatar || settings?.character?.portrait || "" },
    stats: settings?.character?.stats || {},
    vitals: {
      hp: settings?.hp,
      maxHp: settings?.maxHp,
      mp: settings?.mp,
      maxMp: settings?.maxMp,
      ap: settings?.ap,
      maxAp: settings?.maxAp,
    },
    progression: { level: settings?.character?.level || 1 },
    roles: ["User"],
    partyRole: "Leader",
    skills: [],
    statusEffects: settings?.character?.statusEffects || [],
  };
  return projectMember(settings, member, "mid", 0, { source: "playerFallback" });
}

function autoAssignThreatTier(enemy) {
  const explicit = Number(enemy?.threatTier ?? enemy?.tier);
  if (Number.isFinite(explicit) && explicit >= 1) return Math.max(1, Math.min(5, Math.round(explicit)));
  const name = String(enemy?.name || "").toLowerCase();
  const className = String(enemy?.className || enemy?.class || enemy?.type || "").toLowerCase();
  const text = name + " " + className;

  let tier = 2; // Default Standard (Tier 2)

  if (text.match(/minion|weak|grunt|trash|crawler|goblin|rat|slime/)) {
    tier = 1; // Minion
  } else if (text.match(/legendary|overlord|deity|god|mythic|ancient/)) {
    tier = 5; // Legendary
  } else if (text.match(/boss|captain|general|commander|champion|elite|guard|elder|chief/)) {
    if (text.match(/boss|overlord|god|nemesis/)) {
      tier = 4; // Boss
    } else {
      tier = 3; // Elite
    }
  } else {
    const lvl = Number(enemy?.level || 1);
    if (lvl >= 50) tier = 4;
    else if (lvl >= 25) tier = 3;
  }

  return tier;
}

export function normalizeEnemyCombatant(enemy, index = 0) {
  const name = String(enemy?.name || `Enemy ${index + 1}`).trim() || `Enemy ${index + 1}`;
  
  const threatTier = autoAssignThreatTier(enemy);
  const mult = [0.6, 0.8, 1.0, 1.4, 2.0][threatTier - 1] || 1.0;

  const baseStats = enemy?.stats || {};
  const scaledStats = {};
  // If stats is empty, provide some default values based on level
  const defaultKeys = ["str", "dex", "con", "int", "wis", "cha", "per", "luk", "agi", "vit", "end", "spi"];
  const lvl = Math.max(1, finiteNumber(enemy?.level, 1));
  defaultKeys.forEach(k => {
    const baseVal = Number(baseStats[k] ?? (10 + Math.round(lvl * 0.8)));
    scaledStats[k] = Math.max(1, Math.round(baseVal * mult));
  });

  const equipment = normalizeEquipment(enemy?.equipment);
  const statuses = normalizeStatusList(enemy?.statusEffects);
  const passiveSkills = (Array.isArray(enemy?.skills) ? enemy.skills : []).filter((skill) => String(skill?.skillType || skill?.type || "").toLowerCase() === "passive");
  const modifierTotals = collectModifierTotals([...equipment, ...statuses, ...passiveSkills]);
  const stats = normalizeStats(scaledStats);
  const rawVitals = normalizeVitals(enemy);
  const scaledMaxHp = Math.max(1, Math.round(finiteNumber(rawVitals.maxHp || (lvl * 15 + 30), 100) * mult + finiteNumber(modifierTotals.maxHp, 0)));
  const scaledMaxMp = Math.max(0, Math.round(finiteNumber(rawVitals.maxMp || (lvl * 5 + 10), 50) * mult + finiteNumber(modifierTotals.maxMp, 0)));
  const scaledMaxAp = Math.max(0, Math.round(finiteNumber(rawVitals.maxAp, 10) * mult + finiteNumber(modifierTotals.maxAp, 0)));
  const vitals = {
    hp: Math.min(scaledMaxHp, Math.max(1, Math.round(finiteNumber(rawVitals.hp || (lvl * 15 + 30), 100) * mult + finiteNumber(modifierTotals.maxHp, 0)))),
    maxHp: scaledMaxHp,
    mp: Math.min(scaledMaxMp, Math.max(0, Math.round(finiteNumber(rawVitals.mp || (lvl * 5 + 10), 50) * mult + finiteNumber(modifierTotals.maxMp, 0)))),
    maxMp: scaledMaxMp,
    ap: Math.min(scaledMaxAp, Math.max(0, Math.round(finiteNumber(rawVitals.ap, 10) * mult + finiteNumber(modifierTotals.maxAp, 0)))),
    maxAp: scaledMaxAp,
  };

  const lane = normalizeLane(enemy?.lane || "front", "front");
  const derived = calculateDerivedStats(stats, modifierTotals, lane, enemy?.role || "Enemy");
  
  return withLegacyCombatAliases({
    ...enemy,
    id: String(enemy?.id || `enemy_${combatSlug(name)}_${index}`),
    persistentRef: enemy?.persistentRef || null,
    entityType: String(enemy?.entityType || "character"),
    side: "enemy",
    name,
    className: String(enemy?.className || enemy?.class || enemy?.type || "Enemy"),
    role: String(enemy?.role || "Enemy"),
    lane,
    laneIndex: index,
    stats,
    derived,
    vitals,
    equipment,
    items: (Array.isArray(enemy?.items) ? enemy.items : []).filter(Boolean).map((item) => typeof item === "string" ? { name: item } : { ...item }),
    threatTier,
    statuses,
    actions: (Array.isArray(enemy?.attacks) ? enemy.attacks : []).map((action) => normalizeCombatAction(action, "Enemy")).filter(Boolean),
    presentation: {
      portrait: String(enemy?.imageUrl || enemy?.sprite || enemy?.portrait || ""),
      spriteIdentity: name,
      defaultExpression: "neutral",
      currentExpression: "neutral",
    },
    jobClass: { level: lvl, baseStats: derived.stats },
  });
}

export function buildCombatProjection(settings, encounterOptions = {}) {
  const partyMembers = Array.isArray(settings?.party?.members) ? settings.party.members.filter((member) => member && member.active !== false) : [];
  const laneSource = settings?.party?.formation?.lanes && typeof settings.party.formation.lanes === "object"
    ? settings.party.formation.lanes
    : {};
  const byId = new Map(partyMembers.map((member) => [String(member?.id || ""), member]));
  const explicitLaneIds = COMBAT_LANES.flatMap((lane) => Array.isArray(laneSource[lane]) ? laneSource[lane].map(String) : []);
  const deployed = [];
  const deployedIds = new Set();

  if (explicitLaneIds.length) {
    for (const lane of COMBAT_LANES) {
      const ids = Array.isArray(laneSource[lane]) ? laneSource[lane] : [];
      ids.forEach((rawId, laneIndex) => {
        const id = String(rawId || "");
        const member = byId.get(id);
        if (!member || deployedIds.has(id)) return;
        deployedIds.add(id);
        deployed.push(projectMember(settings, member, lane, laneIndex, encounterOptions));
      });
    }
  } else {
    const laneCounts = { front: 0, mid: 0, back: 0 };
    for (const member of partyMembers) {
      const lane = inferLaneFromRole(member?.partyRole || memberClass(member));
      deployedIds.add(String(member?.id || ""));
      deployed.push(projectMember(settings, member, lane, laneCounts[lane]++, encounterOptions));
    }
  }

  if (!deployed.length) deployed.push(fallbackPlayer(settings));
  const reserves = partyMembers.filter((member) => !deployedIds.has(String(member?.id || ""))).map((member) => String(member?.id || ""));
  const controlled = deployed.find((combatant) => combatant.persistentRef?.user)
    || deployed.find((combatant) => String(combatant.id) === String(settings?.party?.leaderId || ""))
    || deployed[0];
  const enemies = (Array.isArray(encounterOptions.enemies) ? encounterOptions.enemies : []).map(normalizeEnemyCombatant);

  return {
    id: String(encounterOptions.id || `combat_${Date.now().toString(36)}`),
    scale: String(encounterOptions.scale || "skirmish"),
    status: "starting",
    allies: deployed,
    enemies,
    reserves,
    controlledCombatantId: controlled?.id || null,
    activeCombatantId: controlled?.id || null,
    battlefield: encounterOptions.battlefield || {},
    source: String(encounterOptions.source || "battle"),
    startedAt: Date.now(),
  };
}

export function applyCombatantVitalsToSettings(settings, combatant) {
  if (!settings || !combatant?.persistentRef || combatant.persistentRef.domain !== "partyMember") return false;
  const vitals = normalizeVitals(combatant.vitals || combatant);
  const members = Array.isArray(settings?.party?.members) ? settings.party.members : [];
  const member = members.find((candidate) => String(candidate?.id || "") === String(combatant.persistentRef.id || ""));
  if (member) {
    member.vitals = {
      ...(member.vitals || {}),
      hp: vitals.hp,
      mp: vitals.mp,
      ap: vitals.ap,
    };
  }
  if (combatant.persistentRef.user) {
    settings.hp = vitals.hp;
    settings.mp = vitals.mp;
    settings.ap = vitals.ap;
  }
  return !!member || combatant.persistentRef.user;
}
