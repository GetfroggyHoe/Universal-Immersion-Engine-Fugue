/**
 * jobClass.js — Job/Class System & Progression
 * 
 * Manages character sheets with strict RPG progression.
 * Decouples math from AI narrative.
 * Tracks abilities, skill slots, stat distribution, and XP/leveling.
 */

const CLASS_DEFINITIONS = {
  adventurer: {
    name: "Adventurer",
    innateAbilities: [
      { id: "steady_focus", name: "Steady Focus", cooldown: 0, cost: 0, type: "innate", description: "Center yourself before a demanding action" },
      { id: "read_the_room", name: "Read the Room", cooldown: 3, cost: 0, type: "innate", description: "Notice nearby risks, exits, and opportunities" }
    ],
    statMods: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
    skillSlots: { lv1: 2, lv5: 3, lv10: 4, lv15: 5, lv20: 6 },
    abilitySlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 8 }
  },
  UIE: {
    name: "UIE",
    innateAbilities: [
      { id: "perfect_pitch", name: "Perfect Pitch", cooldown: 0, cost: 0, type: "innate", description: "Identify any sound's frequency instantly" },
      { id: "sonar_call", name: "Sonar Call", cooldown: 3, cost: 0, type: "innate", description: "Emit a sound wave to sense nearby entities" }
    ],
    statMods: { str: 0, dex: 1, con: 1, int: 2, wis: 2, cha: 3 },
    skillSlots: { lv1: 2, lv5: 3, lv10: 4, lv15: 5, lv20: 6 },
    abilitySlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 8 }
  },
  mage: {
    name: "Mage",
    innateAbilities: [
      { id: "mana_sense", name: "Mana Sense", cooldown: 0, cost: 0, type: "innate", description: "Detect magical auras in the area" }
    ],
    statMods: { str: -1, dex: 1, con: 0, int: 3, wis: 3, cha: 1 },
    skillSlots: { lv1: 2, lv5: 3, lv10: 4, lv15: 5, lv20: 6 },
    abilitySlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 8 }
  },
  rogue: {
    name: "Rogue",
    innateAbilities: [
      { id: "shadow_step", name: "Shadow Step", cooldown: 2, cost: 0, type: "innate", description: "Move silently and unseen for one turn" }
    ],
    statMods: { str: 0, dex: 3, con: 0, int: 2, wis: 1, cha: 1 },
    skillSlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 7 },
    abilitySlots: { lv1: 4, lv5: 5, lv10: 6, lv15: 7, lv20: 9 }
  },
  paladin: {
    name: "Paladin",
    innateAbilities: [
      { id: "holy_shield", name: "Holy Shield", cooldown: 0, cost: 0, type: "innate", description: "Gain temporary defense boost" }
    ],
    statMods: { str: 2, dex: 1, con: 2, int: 1, wis: 3, cha: 2 },
    skillSlots: { lv1: 2, lv5: 3, lv10: 4, lv15: 5, lv20: 6 },
    abilitySlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 8 }
  },
  // High Fantasy Additions
  warrior: {
    name: "Warrior",
    innateAbilities: [
      { id: "battle_cry", name: "Battle Cry", cooldown: 4, cost: 0, type: "innate", description: "Bolster allies and intimidate foes." },
      { id: "shield_bash", name: "Shield Bash", cooldown: 2, cost: 0, type: "innate", description: "Stun target with offhand shield strike." }
    ],
    statMods: { str: 3, dex: 1, con: 2, int: -1, wis: 0, cha: 1 },
    skillSlots: { lv1: 2, lv5: 3, lv10: 4, lv15: 5, lv20: 6 },
    abilitySlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 8 }
  },
  ranger: {
    name: "Ranger",
    innateAbilities: [
      { id: "eagle_eye", name: "Eagle Eye", cooldown: 0, cost: 0, type: "innate", description: "Increased accuracy and visual perception." },
      { id: "hunters_mark", name: "Hunter's Mark", cooldown: 3, cost: 0, type: "innate", description: "Designate target to take extra physical damage." }
    ],
    statMods: { str: 1, dex: 3, con: 1, int: 1, wis: 2, cha: 0 },
    skillSlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 7 },
    abilitySlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 8 }
  },
  cleric: {
    name: "Cleric",
    innateAbilities: [
      { id: "healing_light", name: "Healing Light", cooldown: 3, cost: 0, type: "innate", description: "Channel divinity to heal moderate wounds." },
      { id: "turn_undead", name: "Turn Undead", cooldown: 5, cost: 0, type: "innate", description: "Frighten and burn nearby undead creatures." }
    ],
    statMods: { str: 1, dex: 0, con: 2, int: 1, wis: 3, cha: 2 },
    skillSlots: { lv1: 2, lv5: 3, lv10: 4, lv15: 5, lv20: 6 },
    abilitySlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 8 }
  },
  druid: {
    name: "Druid",
    innateAbilities: [
      { id: "natures_embrace", name: "Nature's Embrace", cooldown: 3, cost: 0, type: "innate", description: "Summon vines to shield or bind a target." },
      { id: "wild_shape", name: "Wild Shape", cooldown: 6, cost: 0, type: "innate", description: "Transform into a beast, modifying current stats." }
    ],
    statMods: { str: 0, dex: 1, con: 1, int: 2, wis: 3, cha: 1 },
    skillSlots: { lv1: 2, lv5: 3, lv10: 4, lv15: 5, lv20: 6 },
    abilitySlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 8 }
  },
  bard: {
    name: "Bard",
    innateAbilities: [
      { id: "inspiring_song", name: "Inspiring Song", cooldown: 4, cost: 0, type: "innate", description: "Play melody granting teammates skill bonuses." },
      { id: "vicious_mockery", name: "Vicious Mockery", cooldown: 2, cost: 0, type: "innate", description: "Unleash verbal barbs causing psychic damage." }
    ],
    statMods: { str: -1, dex: 2, con: 0, int: 2, wis: 1, cha: 4 },
    skillSlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 7 },
    abilitySlots: { lv1: 4, lv5: 5, lv10: 6, lv15: 7, lv20: 9 }
  },
  // Modern Additions
  hacker: {
    name: "Hacker",
    innateAbilities: [
      { id: "overload_network", name: "Overload Network", cooldown: 4, cost: 0, type: "innate", description: "Disable nearby devices or shock cybernetic foes." },
      { id: "system_scan", name: "System Scan", cooldown: 2, cost: 0, type: "innate", description: "Bypass electronic locks or gather data." }
    ],
    statMods: { str: -1, dex: 1, con: 0, int: 4, wis: 2, cha: 0 },
    skillSlots: { lv1: 2, lv5: 3, lv10: 4, lv15: 5, lv20: 6 },
    abilitySlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 8 }
  },
  detective: {
    name: "Detective",
    innateAbilities: [
      { id: "keen_analysis", name: "Keen Analysis", cooldown: 0, cost: 0, type: "innate", description: "Notice subtle clues and psychological tells." },
      { id: "interrogate", name: "Interrogate", cooldown: 3, cost: 0, type: "innate", description: "Compel target to reveal hidden information." }
    ],
    statMods: { str: 1, dex: 1, con: 1, int: 3, wis: 3, cha: 1 },
    skillSlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 7 },
    abilitySlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 8 }
  },
  medic: {
    name: "Medic",
    innateAbilities: [
      { id: "first_aid", name: "First Aid", cooldown: 2, cost: 0, type: "innate", description: "Apply trauma patch or battlefield dressings." },
      { id: "stabilize", name: "Stabilize", cooldown: 4, cost: 0, type: "innate", description: "Cure status ailments and restore vitality." }
    ],
    statMods: { str: 0, dex: 2, con: 1, int: 3, wis: 2, cha: 2 },
    skillSlots: { lv1: 2, lv5: 3, lv10: 4, lv15: 5, lv20: 6 },
    abilitySlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 8 }
  },
  athlete: {
    name: "Athlete",
    innateAbilities: [
      { id: "sprint", name: "Sprint", cooldown: 3, cost: 0, type: "innate", description: "Double movement speed and evade attacks." },
      { id: "second_wind", name: "Second Wind", cooldown: 5, cost: 0, type: "innate", description: "Recover minor stamina and health during rest." }
    ],
    statMods: { str: 3, dex: 3, con: 2, int: -1, wis: 0, cha: 1 },
    skillSlots: { lv1: 2, lv5: 3, lv10: 4, lv15: 5, lv20: 6 },
    abilitySlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 8 }
  },
  agent: {
    name: "Agent",
    innateAbilities: [
      { id: "cover_identity", name: "Cover Identity", cooldown: 0, cost: 0, type: "innate", description: "Disguise intent, bypass checkpoints easily." },
      { id: "tactical_roll", name: "Tactical Roll", cooldown: 2, cost: 0, type: "innate", description: "Reposition safely and gain critical hit chance." }
    ],
    statMods: { str: 1, dex: 2, con: 1, int: 2, wis: 1, cha: 3 },
    skillSlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 7 },
    abilitySlots: { lv1: 4, lv5: 5, lv10: 6, lv15: 7, lv20: 9 }
  }
};

const XP_TO_LEVEL = [
  0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700,
  3250, 3850, 4500, 5200, 5950, 6750, 7600, 8500, 9450, 10450
];

/**
 * Initialize job/class system for a character
 */
export function initializeClassSystem(character, className = "adventurer") {
  const normName = String(className || "adventurer").trim();
  const lowerName = normName.toLowerCase();
  
  let matchedKey = Object.keys(CLASS_DEFINITIONS).find(k => k.toLowerCase() === lowerName);
  if (!matchedKey) {
    // Custom class caching: build a dynamic custom class definition
    const properName = normName.charAt(0).toUpperCase() + normName.slice(1);
    CLASS_DEFINITIONS[normName] = {
      name: properName,
      innateAbilities: [
        { id: `custom_${lowerName.replace(/[^a-z0-9]/g, "_")}_innate`, name: "Resourcefulness", cooldown: 0, cost: 0, type: "innate", description: "Utilize custom ingenuity and unique class skills." }
      ],
      statMods: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
      skillSlots: { lv1: 2, lv5: 3, lv10: 4, lv15: 5, lv20: 6 },
      abilitySlots: { lv1: 3, lv5: 4, lv10: 5, lv15: 6, lv20: 8 }
    };
    matchedKey = normName;
  }
  
  const classDef = CLASS_DEFINITIONS[matchedKey];
  
  return {
    name: character.name,
    class: matchedKey,
    level: character.level || 1,
    xp: 0,
    baseStats: {
      str: (character.stats?.str || 10) + classDef.statMods.str,
      dex: (character.stats?.dex || 10) + classDef.statMods.dex,
      con: (character.stats?.con || 10) + classDef.statMods.con,
      int: (character.stats?.int || 10) + classDef.statMods.int,
      wis: (character.stats?.wis || 10) + classDef.statMods.wis,
      cha: (character.stats?.cha || 10) + classDef.statMods.cha
    },
    equippedAbilities: classDef.innateAbilities.slice(0, 3),
    allAbilities: [...classDef.innateAbilities],
    skillPoints: 0,
    classDefinition: classDef
  };
}

/**
 * Calculate effective stat with modifiers (items, buffs, etc)
 */
export function getEffectiveStat(charSheet, statKey, modifiers = {}) {
  const base = charSheet.baseStats[statKey] || 10;
  const itemMod = modifiers.items?.[statKey] || 0;
  const buffMod = modifiers.buffs?.[statKey] || 0;
  return Math.max(1, base + itemMod + buffMod);
}

/**
 * Grant XP and handle leveling
 */
export function grantXp(character, amount, source = "default") {
  if (!character.jobClass) {
    character.jobClass = initializeClassSystem(character, character.class || "adventurer");
  }

  const classDef = CLASS_DEFINITIONS[character.jobClass.class];
  const prevLevel = character.jobClass.level;
  character.jobClass.xp += amount;

  let leveledUp = 0;
  const nextLevelThreshold = XP_TO_LEVEL[Math.min(character.jobClass.level, XP_TO_LEVEL.length - 1)];

  while (character.jobClass.xp >= nextLevelThreshold && character.jobClass.level < 20) {
    character.jobClass.level++;
    character.jobClass.xp -= nextLevelThreshold;
    character.jobClass.skillPoints += 3; // Award 3 skill points per level
    leveledUp++;
  }

  if (leveledUp > 0) {
    console.log(`[JobClass] ${character.name} leveled up ${leveledUp} times (now Lv.${character.jobClass.level})`);
    return { leveled: true, levels: leveledUp, newLevel: character.jobClass.level };
  }
  return { leveled: false, levels: 0 };
}

/**
 * Distribute skill points into attributes
 */
export function distributeSkillPoints(character, distribution) {
  const jobClass = character.jobClass;
  const totalToSpend = Object.values(distribution).reduce((a, b) => a + b, 0);

  if (totalToSpend > jobClass.skillPoints) {
    console.warn(`[JobClass] Tried to spend ${totalToSpend} points but only have ${jobClass.skillPoints}`);
    return false;
  }

  Object.keys(distribution).forEach(stat => {
    if (jobClass.baseStats[stat] !== undefined) {
      jobClass.baseStats[stat] += distribution[stat];
    }
  });

  jobClass.skillPoints -= totalToSpend;
  return true;
}

/**
 * Equip an ability into a slot (limited by skill slots)
 */
export function equipAbility(character, abilityId) {
  const jobClass = character.jobClass;
  const classDef = CLASS_DEFINITIONS[jobClass.class];
  
  // Find max ability slots for current level
  let maxSlots = 3;
  const levelBrackets = Object.keys(classDef.abilitySlots).map(Number).sort((a, b) => b - a);
  for (const bracket of levelBrackets) {
    if (jobClass.level >= bracket) {
      maxSlots = classDef.abilitySlots[bracket];
      break;
    }
  }

  // Check if ability exists
  const ability = jobClass.allAbilities.find(a => a.id === abilityId);
  if (!ability) {
    console.warn(`[JobClass] Ability ${abilityId} not found`);
    return false;
  }

  // Check if already equipped
  if (jobClass.equippedAbilities.find(a => a.id === abilityId)) {
    console.warn(`[JobClass] Ability ${abilityId} already equipped`);
    return false;
  }

  // Check slot limit
  if (jobClass.equippedAbilities.length >= maxSlots) {
    console.warn(`[JobClass] Max ability slots (${maxSlots}) reached`);
    return false;
  }

  jobClass.equippedAbilities.push(ability);
  return true;
}

/**
 * Unequip an ability
 */
export function unequipAbility(character, abilityId) {
  const jobClass = character.jobClass;
  const idx = jobClass.equippedAbilities.findIndex(a => a.id === abilityId);
  if (idx >= 0) {
    jobClass.equippedAbilities.splice(idx, 1);
    return true;
  }
  return false;
}

/**
 * Learn a new ability (story/item grant)
 */
export function learnAbility(character, ability) {
  const jobClass = character.jobClass;
  
  // Check if already known
  if (jobClass.allAbilities.find(a => a.id === ability.id)) {
    console.warn(`[JobClass] Already knows ${ability.id}`);
    return false;
  }

  jobClass.allAbilities.push(ability);
  return true;
}

/**
 * Get combat damage modifier based on attribute roll
 * Pillar 1: Attribute Roll (D20 + stat mods)
 */
export function calculateAttributeRoll(character, actionType = "attack") {
  const jobClass = character.jobClass;
  const statMap = {
    attack: "str",
    spell: "int",
    social: "cha",
    dodge: "dex",
    endure: "con"
  };

  const statKey = statMap[actionType] || "str";
  const baseStat = getEffectiveStat(character, statKey);
  const statMod = Math.floor((baseStat - 10) / 2);
  const d20 = Math.floor(Math.random() * 20) + 1;
  const levelBonus = Math.floor(jobClass.level / 5);

  return {
    d20: d20,
    statMod: statMod,
    levelBonus: levelBonus,
    total: d20 + statMod + levelBonus,
    critical: d20 === 20,
    fumble: d20 === 1,
    baseStat: baseStat
  };
}

/**
 * Initialize job class on module load
 */
export function initJobClass() {
  window.UIE_JobClass = {
    initializeClassSystem,
    grantXp,
    distributeSkillPoints,
    equipAbility,
    unequipAbility,
    learnAbility,
    calculateAttributeRoll,
    getEffectiveStat,
    CLASS_DEFINITIONS,
    XP_TO_LEVEL
  };
  console.log("[JobClass] Initialized - Classes: Adventurer, Mage, Rogue, Paladin, plus legacy classes");
}
