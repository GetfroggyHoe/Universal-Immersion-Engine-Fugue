import assert from "node:assert/strict";

import {
  applyCombatantVitalsToSettings,
  buildCombatProjection,
} from "../src/modules/combatStateAdapter.js";

function member(id, name, role, extra = {}) {
  return {
    id,
    identity: { name, class: extra.className || "Adventurer" },
    images: { portrait: extra.portrait || "" },
    stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, per: 10, luk: 10, ...(extra.stats || {}) },
    vitals: { hp: 100, maxHp: 100, mp: 50, maxMp: 50, ap: 10, maxAp: 10, ...(extra.vitals || {}) },
    progression: { level: extra.level || 1, xp: 0 },
    equipment: extra.equipment || {},
    skills: extra.skills || [],
    skillTree: extra.skillTree,
    roles: extra.roles || [],
    partyRole: role,
    statusEffects: extra.statusEffects || [],
    active: extra.active !== false,
  };
}

{
  const settings = {
    character: {
      name: "Alyx",
      level: 4,
      avatar: "alyx.png",
      statusEffects: [{ name: "Focused", mods: { accuracy: 2 } }],
    },
    hp: 88,
    maxHp: 100,
    mp: 35,
    maxMp: 50,
    ap: 9,
    maxAp: 10,
    inventory: {
      equipped: [{ name: "Power Ring", slotId: "r1", mods: { str: 3, maxHp: 20 } }],
      skills: [{ name: "Elemental Burst", skillType: "active", costs: { mp: 8 } }],
    },
    party: {
      leaderId: "user",
      members: [
        member("user", "Alyx", "Leader", { roles: ["User"], stats: { str: 12 }, vitals: { hp: 88, mp: 35, ap: 9 } }),
        member("tank", "Ronan", "Tank", {
          stats: { con: 18 },
          portrait: "ronan.png",
          skills: [{ name: "Shield Wall", skillType: "active", source: "SkillTree" }],
        }),
        member("mage", "Revin", "Mage", {
          skillTree: {
            nodes: [
              { id: "m_1", name: "Elemental Burst", type: "active", unlocked: true, desc: "Release elemental energy." },
              { id: "m_2", name: "Mana Flow", type: "passive", unlocked: true },
            ],
          },
        }),
        member("reserve", "Maeve", "Mage"),
      ],
      formation: {
        lanes: {
          front: ["tank"],
          mid: ["user"],
          back: ["mage"],
        },
      },
    },
  };

  const projection = buildCombatProjection(settings, {
    source: "test",
    enemies: [{ name: "Training Golem", hp: 150, maxHp: 150 }],
  });

  assert.deepEqual(projection.allies.map((combatant) => [combatant.name, combatant.lane]), [
    ["Ronan", "front"],
    ["Alyx", "mid"],
    ["Revin", "back"],
  ]);
  assert.deepEqual(projection.reserves, ["reserve"]);
  assert.equal(projection.controlledCombatantId, "user");

  const alyx = projection.allies.find((combatant) => combatant.id === "user");
  assert.equal(alyx.hp, 88);
  assert.equal(alyx.maxHp, 120);
  assert.equal(alyx.derived.stats.str, 15);
  assert.ok(alyx.actions.some((action) => action.name === "Elemental Burst" && action.costs.mp === 8));
  assert.equal(alyx.baseStats.str, alyx.derived.stats.str);

  const ronan = projection.allies.find((combatant) => combatant.id === "tank");
  assert.equal(ronan.presentation.portrait, "ronan.png");
  assert.ok(ronan.derived.interceptChance > 0.7);
  assert.ok(ronan.actions.some((action) => action.name === "Shield Wall"));

  const revin = projection.allies.find((combatant) => combatant.id === "mage");
  assert.deepEqual(revin.actions.map((action) => action.name), ["Elemental Burst"]);
  assert.equal(revin.derived.magicalEvasion, 0.15);
  assert.equal(revin.presentation.portrait, "assets/ui/generated/Sil-F.png");
  assert.equal(revin.imageUrl, revin.presentation.portrait);

  alyx.vitals.hp = 42;
  alyx.hp = 42;
  assert.equal(applyCombatantVitalsToSettings(settings, alyx), true);
  assert.equal(settings.hp, 42);
  assert.equal(settings.maxHp, 100);
  assert.equal(settings.party.members[0].vitals.hp, 42);
  assert.equal(settings.party.members[0].vitals.maxHp, 100);
}

{
  const settings = {
    character: { name: "Player" },
    party: {
      members: [
        member("front", "Vanguard", "Tank"),
        member("mid", "Duelist", "DPS"),
        member("back", "Archer", "Ranger"),
      ],
      formation: { lanes: { front: [], mid: [], back: [] } },
    },
  };
  const projection = buildCombatProjection(settings);
  assert.deepEqual(projection.allies.map((combatant) => combatant.lane), ["front", "mid", "back"]);
  assert.deepEqual(projection.reserves, []);
}

console.log("Combat projection tests passed.");
