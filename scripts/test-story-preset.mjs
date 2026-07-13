import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ADVENTURE_PATH_PRESET_ID,
  STORY_ASSET_ROUTES,
  createAdventurePathMap,
  getAdventurePathClassLoadout,
  installAdventurePathMap,
} from "../src/modules/storyPresets.js";

for (const route of [...STORY_ASSET_ROUTES.characters, ...STORY_ASSET_ROUTES.lorebooks]) {
  assert.equal(fs.existsSync(new URL(`../assets/${route}`, import.meta.url)), true, `missing routed asset: ${route}`);
}

const map = createAdventurePathMap();
assert.equal(map.version, 2);
assert.equal(map.world[0].name, "Tellara");
assert.equal(map.area[0].name, "Adventure'r's Path");
assert.equal(map.area[0].imagePrompt.includes("no text"), true);
assert.ok(map.area.length >= 40);
assert.ok(map.vicinity.length >= 5);
assert.equal(Object.keys(map.vicinityByArea).length, map.area.length);
assert.equal(Object.keys(map.blueprints).length, map.area.length);
assert.ok(map.area.every((local) => local.blueprintId === local.name), "every local space must expose its own blueprint");
assert.ok(map.area.every((local) => map.blueprints[local.name]?.rooms?.length >= 6), "every local space must contain a substantial bounded blueprint");
assert.ok(map.area.every((local) => map.vicinityByArea[local.name]?.length >= 5), "every local space must contain a nearby map");
assert.ok(Object.values(map.blueprints).every((bp) => bp.rooms.some((room) => room.isExit)));
assert.ok(Object.values(map.blueprints).flatMap((bp) => bp.rooms).every((room) => room.imagePrompt), "every blueprint room needs an image generation prompt");
assert.ok(Object.values(map.blueprints).flatMap((bp) => bp.rooms).some((room) => room.barrier));
assert.ok(map.area.flatMap((node) => node.encounters || []).some((entry) => entry.kind === "combat"));
assert.ok(map.area.flatMap((node) => node.encounters || []).some((entry) => entry.kind === "character"));

for (const className of ["warrior", "mage", "rogue", "paladin", "ranger", "cleric", "druid", "bard"]) {
  const loadout = getAdventurePathClassLoadout(className);
  assert.ok(loadout.items.length > 0, `${className} needs starting items`);
  assert.ok(loadout.skills.length > 0, `${className} needs starting skills`);
}

const settings = {};
installAdventurePathMap(settings);
assert.equal(settings.storyPreset.id, ADVENTURE_PATH_PRESET_ID);
assert.equal(settings.worldState.location, "Adventure'r's Path");
assert.equal(settings.worldState.background, "./assets/backgrounds/adventure_path.png");
assert.ok(Object.keys(settings.worldState.mapNodes).length > map.area.length);
assert.ok(Object.keys(settings.worldState.rooms).length > 0);
assert.equal(Object.keys(settings.worldState.rooms).length, Object.values(map.blueprints).reduce((sum, bp) => sum + bp.rooms.length, 0));

const gameHtml = fs.readFileSync(new URL("../game.html", import.meta.url), "utf8");
assert.match(gameHtml, /loadDynamicAssetLists/);
assert.match(gameHtml, /\/api\/character-cards\/list/);
assert.match(gameHtml, /\/api\/lorebooks\/list/);
const newGameJs = fs.readFileSync(new URL("../src/modules/features/newgame.js", import.meta.url), "utf8");
assert.match(newGameJs, /settings\.currency = Number\(newGameState\.currency\.amount/);
assert.match(newGameJs, /settings\.playerProgress = \{/);
assert.match(newGameJs, /newGameState\.presetId === ADVENTURE_PATH_PRESET_ID && requestedMapMode === "preset"/);
const mapJs = fs.readFileSync(new URL("../src/modules/map.js", import.meta.url), "utf8");
assert.match(mapJs, /vicinityByArea/);
assert.match(mapJs, /allowsGeneratedBlueprint/);

console.log("story-preset tests: ok");
