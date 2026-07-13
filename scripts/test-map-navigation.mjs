import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const settings = {
  worldState: {
    location: "Starting Location",
    currentLocation: "Starting Location",
    currentCoords: { x: 48, y: 50, z: 0 },
    x: 48,
    y: 50,
    weather: "Clear",
    navGraph: {},
    mapNodes: {
      "Starting Location": { name: "Starting Location", type: "interior", coords: { x: 48, y: 50, z: 0 } },
      "Glass Harbor": { name: "Glass Harbor", type: "dock", coords: { x: 72, y: 50, z: 0 } },
    },
  },
  inventory: {
    assets: [
      { name: "Star Runner", category: "spacecraft", owned: true, speedModifier: 0.25, durability: 100, maxDurability: 100 },
      { name: "Copper", category: "horse", owned: true },
      { name: "Supply Cart", category: "cart", owned: true },
      { name: "Tide Skiff", category: "boat", owned: true },
    ],
  },
  party: { members: [{ name: "Mika" }] },
  playerRoom: { day: 1, hour: 8, minute: 0 },
  ui: { timeProgress: { enabled: true, logToChat: false, toastAck: false, mapUnitMinutes: 1 } },
};

const jq = new Proxy({ length: 0 }, {
  get(target, prop) {
    if (prop === Symbol.iterator) return function* iterator() {};
    if (prop in target) return target[prop];
    return () => jq;
  },
});

globalThis.window = {
  UIE_STANDALONE: true,
  extension_settings: { "universal-immersion-engine": settings },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
};
globalThis.document = {
  hidden: false,
  body: { insertAdjacentHTML() {} },
  head: { appendChild() {} },
  createElement() { return { style: {}, appendChild() {}, setAttribute() {} }; },
  getElementById() { return null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
};
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.CustomEvent = class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
globalThis.CSS = { escape: (value) => String(value) };
globalThis.$ = () => jq;

const map = await import("../src/modules/map.js");
const mapTemplate = await import("../src/modules/mapTemplate.js");
const imageGen = await import("../src/modules/imageGen.js");
const reality = await import("../src/modules/reality.js");
const time = await import("../src/modules/timeProgress.js");
const travelAssets = await import("../src/modules/travelAssets.js");

{
  settings.image = {
    enabled: false,
    strictImagePrompts: true,
    promptTemplateBackground: "{{style}}\n{{base}}\nAt {{location}}\n{{map}}\n{{chat}}",
  };
  settings.imageStylePrompt = "Custom watercolor VN style";
  settings.worldState.mapContext = {
    location: "Starting Location",
    previousLocation: "Glass Harbor",
    travelDirection: "north",
    theme: "Warm apartment",
  };
  settings.worldState.areaScenes = {
    "Starting Location": {
      interactions: ["rest", "study"],
      backgroundHotspots: [
        { id: "bed", label: "Bed", action: "rest", box: { x: 0.55, y: 0.42, width: 0.35, height: 0.4 } },
      ],
    },
  };
  const prompt = imageGen.buildContextualImagePrompt("Morning light through the windows.", {
    mode: "background",
    chat: "Mika: The hallway is quiet.",
  });
  assert.match(prompt, /Wide 16:9 visual novel environment background/);
  assert.match(prompt, /Composition anchors/);
  assert.match(prompt, /clearly visible Bed suitable for rest/i);
  assert.match(prompt, /center middle distance/);
  assert.match(prompt, /natural environmental features that support: study/);
  assert.match(prompt, /Wide 16:9 visual novel environment background/);
  assert.match(prompt, /Custom watercolor VN style/);
  assert.match(prompt, /Scene: Starting Location/);
  assert.match(prompt, /route continues toward the north/);
  assert.doesNotMatch(prompt, /Mika: The hallway is quiet|Map context|hotspot|percentage box/i);
  assert.match(prompt, /unoccupied establishing shot/i);
  const trailPrompt = imageGen.buildContextualImagePrompt("A quiet dirt trail beneath old trees.", {
    mode: "background",
    location: "Adventure's Path - Trail",
    chat: "A heroine studies a map while a dialogue box asks where to go.",
  });
  assert.match(trailPrompt, /open natural landscape, continuous terrain, no indoor architecture/i);
  assert.match(trailPrompt, /Scene: Adventure's Path - Trail/);
  assert.doesNotMatch(trailPrompt, /heroine|dialogue box asks|Map context|hotspot/i);
  const backgroundNegative = imageGen.buildBackgroundNegativePrompt("low quality, blurry");
  assert.match(backgroundNegative, /low quality, blurry/);
  assert.match(backgroundNegative, /infographic/);
  assert.match(backgroundNegative, /isometric/);
  const ordinaryPrompt = imageGen.buildContextualImagePrompt("A red potion icon.", { mode: "image", chat: "" });
  assert.doesNotMatch(ordinaryPrompt, /STRICT BACKGROUND TEMPLATE|LOCATION HOTSPOT CONTRACT|16:9 landscape/);
  const limitedPrompt = imageGen.limitImagePrompt("A".repeat(4153));
  assert.equal(limitedPrompt.length, 3000);
  assert.match(limitedPrompt, /Context shortened to fit image API prompt limit/);
  assert.equal(await imageGen.generateImageAPI(""), null);

  const preset = reality.resolveBackgroundPreset(settings, {
    name: "Moonlit Forest",
    type: "exterior",
    imagePrompt: "dense forest trail beneath old trees",
  });
  assert.match(preset, /desolate_campsite\.png$/);

  reality.initForgeV3();
  const eng = reality.getRealityEngineV3();
  const wd = eng.getState();
  wd.locations.preset_forest_test = {
    id: "preset_forest_test",
    name: "Preset Forest Test",
    type: "exterior",
    biome: "forest",
    imagePrompt: "dense forest trail beneath old trees",
    exits: {},
  };
  eng.setLocation("Preset Forest Test");
  eng.ensureBackgroundOrRequest();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(eng.getBackground("Preset Forest Test"), /desolate_campsite\.png$/);
  eng.setLocation("Starting Location");
}

{
  assert.equal(mapTemplate.classifySpatialEnvironment({ name: "Golden Fields", type: "exterior" }), "field");
  assert.equal(mapTemplate.allowsBlueprint({ name: "Golden Fields", type: "exterior" }), false);
  assert.equal(mapTemplate.allowsBlueprint({ name: "Witches Castle", type: "castle" }), true);
  assert.equal(mapTemplate.allowsGeneratedBlueprint({ name: "Witches Castle", type: "castle" }, "sites"), false);
  assert.equal(mapTemplate.allowsGeneratedBlueprint({ name: "Echo Cave", type: "cave" }, "sites"), true);
  assert.equal(mapTemplate.allowsGeneratedBlueprint({ name: "Echo Cave", type: "cave" }, "none"), false);
  assert.equal(mapTemplate.sanitizePresetName("Stairway to a Deeper Room", { name: "Moonlit Forest", type: "exterior" }, 2), "Dense Thicket");
  assert.ok(mapTemplate.proceduralSpatialPresets({ name: "Moonlit Forest", type: "exterior" }, 6).every((preset) => !/\b(room|hall|stairs?)\b/i.test(preset.name)));
  assert.ok(mapTemplate.proceduralEditRoomPresets({ name: "Bridge" }, { name: "Star Runner", type: "spacecraft" }).every((preset) => preset.imagePrompt));
}

{
  assert.equal(travelAssets.inferTravelCategory({ name: "Copper", category: "horse" }), "mount");
  assert.equal(travelAssets.inferTravelCategory({ name: "Tide Skiff", category: "boat" }), "boat");
  assert.equal(travelAssets.canPlaceTravelAssetAt({ category: "cart" }, { name: "Open Road", type: "exterior" }), true);
  assert.equal(travelAssets.canPlaceTravelAssetAt({ category: "cart" }, { name: "Kitchen", type: "interior" }), false);
  assert.equal(travelAssets.canPlaceTravelAssetAt({ category: "spacecraft" }, { name: "Glass Harbor", type: "dock" }), false);
  assert.equal(travelAssets.canPlaceTravelAssetAt({ category: "spacecraft" }, { name: "Orbital Dock", type: "spaceport" }), true);
}

{
  const parsed = map.parseOrganicLocationResponse(
    '[Narrator]\nA beam carries you beyond the clouds.\n[UIE_LOCATION_CHANGE]{"locationChanged":true,"newLocation":"Pearly White Gates","direction":"teleport","type":"exterior"}[/UIE_LOCATION_CHANGE]',
  );
  assert.equal(parsed.ping.newLocation, "Pearly White Gates");
  assert.equal(parsed.ping.direction, "teleport");
  assert.equal(parsed.text.includes("UIE_LOCATION_CHANGE"), false);
}

{
  const result = await map.processOrganicLocationResponse(
    'The northern path opens.\n{"locationChanged":true,"newLocation":"Sky Gate","direction":"north","type":"exterior"}',
    { sourceLocation: "Starting Location" },
  );
  assert.equal(result.handled, true);
  assert.equal(result.text, "The northern path opens.");
  const skyGate = settings.simpleMap.area.find((node) => node.name === "Sky Gate");
  assert.equal(skyGate.y, 35);
  assert.equal(settings.worldState.location, "Sky Gate");
  assert.match(settings.worldState.locationPath, />/);
  assert.equal(settings.worldState.locationIds.localId, skyGate.id);

  const collision = await map.addOrganicLocation(
    { locationChanged: true, newLocation: "Moon Dock", direction: "north", type: "exterior" },
    { sourceLocation: "Starting Location" },
  );
  assert.notDeepEqual({ x: collision.x, y: collision.y }, { x: skyGate.x, y: skyGate.y });
  assert.equal(collision.type, "dock");
  assert.equal(collision.docking.kind, "ship");
}

{
  const areaCount = settings.simpleMap.area.length;
  const nearbyApartment = await map.addOrganicLocation(
    {
      locationChanged: true,
      newLocation: "Apartment Next Door",
      direction: "east",
      relationship: "adjacent",
      scope: "nearby",
      type: "interior",
      description: "Scratching sounds come from behind the neighboring apartment door.",
    },
    { sourceLocation: "Starting Location" },
  );
  assert.equal(settings.simpleMap.area.length, areaCount, "nearby discoveries must remain inside the current Local");
  assert.equal(nearbyApartment.localId, "area_current");
  assert.ok(settings.simpleMap.vicinityByArea["Starting Location"].some((node) => node.name === "Apartment Next Door"));
}

{
  const origin = await map.addOrganicLocation(
    { locationChanged: true, newLocation: "Movement Test Origin", direction: "teleport", type: "exterior" },
    { sourceLocation: "Starting Location" },
  );
  await map.travelToLocationName(origin.name, { useActiveVehicle: false });
  const originX = settings.worldState.currentCoords.x;
  const moved = await map.navigateDirection("west");
  assert.equal(moved, true);
  const westName = settings.worldState.location;
  assert.notEqual(westName, origin.name);
  assert.equal(settings.worldState.navGraph[origin.name].west, westName);
  assert.equal(settings.worldState.navGraph[westName].east, origin.name);
  assert.ok(settings.worldState.currentCoords.x < originX);
  assert.match(reality.getRealityEngineV3().getBackground(westName), /^\.\/assets\/backgrounds\//);
}

{
  const before = settings.worldState.location;
  const falsePositive = await map.preflightKnownLocationMovement("I walk over to Ren and tell him about Glass Harbor.");
  assert.equal(falsePositive.handled, false);
  assert.equal(settings.worldState.location, before);

  const known = await map.preflightKnownLocationMovement("I walk back to Glass Harbor.");
  assert.equal(known.handled, true);
  assert.equal(settings.worldState.location, "Glass Harbor");
}

{
  const teleport = await map.processOrganicLocationResponse(
    'White light folds around the ship.\n[UIE_LOCATION_CHANGE]{"locationChanged":true,"newLocation":"Far Meridian","direction":"teleport","type":"exterior"}[/UIE_LOCATION_CHANGE]',
    { sourceLocation: "Glass Harbor" },
  );
  assert.equal(teleport.created, true);
  assert.equal(teleport.node.district, "Disconnected Region");
  assert.equal(teleport.node.links.length, 0);
}

{
  const boarded = await map.preflightKnownLocationMovement("I board the Star Runner.");
  assert.equal(boarded.handled, true);
  assert.equal(boarded.blocked, true);
  assert.equal(settings.worldState.activeVehicle, undefined);

  const invalidPlacement = map.placeTravelAssetHere("Star Runner");
  assert.equal(invalidPlacement, false);

  const orbitalDock = await map.addOrganicLocation(
    { locationChanged: true, newLocation: "Orbital Dock", direction: "east", type: "spaceport" },
    { sourceLocation: settings.worldState.location },
  );
  await map.travelToLocationName(orbitalDock.name, { useActiveVehicle: false });
  assert.equal(map.placeTravelAssetHere("Star Runner"), true);

  await map.travelToLocationName("Glass Harbor", { useActiveVehicle: false });
  assert.equal(await map.boardTravelAsset("Star Runner"), false);
  assert.equal(await map.moveToTravelAsset("Star Runner"), true);
  assert.equal(settings.worldState.location, "Orbital Dock");
  assert.equal(await map.boardTravelAsset("Star Runner"), true);
  assert.equal(settings.worldState.activeVehicle.name, "Star Runner");
  assert.equal(settings.simpleMap.view, "blueprint");
  assert.equal(settings.simpleMap.blueprint.parentName, "Star Runner");
  assert.equal(settings.party.location, "Orbital Dock");
  assert.equal(settings.party.members[0].location, "Orbital Dock");
  const blueprintExit = settings.simpleMap.blueprint.rooms.find((room) => room.isExit);
  assert.ok(blueprintExit, "every blueprint should designate an exit room");
  assert.ok(
    settings.worldState.rooms[blueprintExit.name].customRoomPresets.every((preset) => preset.imagePrompt),
    "generated blueprint rooms should expose procedural Edit Room presets with image prompts",
  );
  assert.ok(
    map.getContextualExits(blueprintExit).some((exit) => exit.to),
    "the designated blueprint exit should lead somewhere",
  );

  assert.equal(await map.travelToLocationName("Glass Harbor"), false);
  assert.equal(settings.worldState.location, "Orbital Dock");

  const lunarSpaceport = await map.addOrganicLocation(
    { locationChanged: true, newLocation: "Lunar Spaceport", direction: "east", type: "spaceport" },
    { sourceLocation: "Orbital Dock" },
  );
  assert.equal(await map.travelToLocationName(lunarSpaceport.name), true);
  assert.equal(settings.inventory.assets[0].location, "Lunar Spaceport");
  assert.equal(settings.party.location, "Lunar Spaceport");
  assert.equal(settings.party.members[0].location, "Lunar Spaceport");
  assert.equal(map.parkTravelAssetHere("Star Runner"), true);
  assert.equal(settings.worldState.activeVehicle, undefined);
}

{
  await map.travelToLocationName("Starting Location", { useActiveVehicle: false });
  assert.equal(map.placeTravelAssetHere("Copper"), false);
  assert.equal(map.placeTravelAssetHere("Supply Cart"), false);

  await map.travelToLocationName("Sky Gate", { useActiveVehicle: false });
  assert.equal(map.placeTravelAssetHere("Copper"), true);
  assert.equal(map.placeTravelAssetHere("Supply Cart"), true);
  assert.equal(map.placeTravelAssetHere("Tide Skiff"), false);

  await map.travelToLocationName("Glass Harbor", { useActiveVehicle: false });
  assert.equal(map.placeTravelAssetHere("Tide Skiff"), true);

  const blockedUse = await map.preflightKnownLocationMovement("I ride Copper.");
  assert.equal(blockedUse.handled, true);
  assert.equal(blockedUse.blocked, true);
  assert.equal(settings.worldState.location, "Glass Harbor");
  assert.equal(await map.moveToTravelAsset("Copper"), true);
  assert.equal(await map.boardTravelAsset("Copper"), true);
  assert.equal(map.parkTravelAssetHere("Copper"), true);
  const negatedUse = await map.preflightKnownLocationMovement("I don't ride Copper.");
  assert.equal(negatedUse.handled, false);
  assert.equal(settings.worldState.activeVehicle, undefined);
}

{
  settings.worldState.weather = "Space storm";
  settings.worldState.location = "Starting Location";
  settings.worldState.activeVehicle = { name: "Star Runner" };
  settings.playerRoom = { day: 1, hour: 8, minute: 0 };
  const asset = settings.inventory.assets[0];
  asset.durability = 100;
  const effects = time.applyTravelEffects(settings, "Starting Location", "Glass Harbor", { vehicle: "Star Runner" });
  assert.equal(effects.minutes, 9);
  assert.equal(effects.weather.timeMultiplier, 1.5);
  assert.equal(effects.durabilityDamage, 1);
  assert.equal(asset.durability, 99);
  assert.equal(settings.playerRoom.minute, 9);
}

{
  const modernProfile = map.inferMapGenreProfile({
    worldDescription: "A present-day Japanese city centered on apartments, schools, train stations, offices, and live music venues.",
    recentChat: "The band takes the subway downtown after rehearsal.",
    lore: ["A fantasy kingdom of castles, keeps, taverns, dungeons, dragons, wizards, knights, magic, and royal guilds.".repeat(8)],
  });
  assert.equal(modernProfile.genre, "modern");

  settings.worldState.description = "A present-day Japanese city centered on apartments, schools, train stations, offices, and live music venues.";
  const modernMap = await map.generateForTier("local", {
    mode: "procedural",
    label: "Generated Region",
    prompt: "Build the contemporary city around the band's apartment and rehearsal studio.",
    counts: { worlds: 1, regions: 2, settlements: 4, places: 8, roomsPerInterior: 4, blueprintMode: "none" },
  });
  assert.ok(modernMap.area.every((node) => !/\b(keep|hold|holdfast|castle|kingdom|tavern|dungeon)\b/i.test(`${node.name} ${node.type} ${node.desc} ${node.theme} ${node.faction}`)), "modern generation must not leak medieval-fantasy locations");
}

{
  const generated = await map.generateForTier("local", {
    mode: "procedural",
    label: "Complete Package Test",
    prompt: "A road, a forest, a town, and a cave.",
    counts: { worlds: 1, regions: 1, settlements: 2, places: 6, roomsPerInterior: 4, blueprintMode: "none" },
  });
  assert.equal(generated.area.length, 6);
  assert.ok(generated.area.every((local) => !local.blueprintId), "layout-free generation must not create individual interiors");
  assert.equal(Object.keys(generated.blueprints).length, 0, "layout-free generation must not create blueprint rooms");
  assert.ok(generated.area.every((local) => generated.vicinityByArea[local.name]?.length > 0), "generated locals must always contain their own nearby layer");
  assert.ok(generated.region.every((region) => region.worldId), "every generated region must belong to a world");
  assert.ok(generated.area.every((local) => local.worldId && local.regionId), "every generated local must belong to a world and region");
  const packageValidation = map.getMapPackageValidation();
  assert.equal(packageValidation.valid, true, packageValidation.errors.join("\n"));
}

{
  assert.equal(await map.applyMoveToLocation({ name: "Context Bridge Room", type: "interior", desc: "A room reached through narrative context." }), true);
  assert.equal(settings.worldState.location, "Context Bridge Room");
  assert.match(settings.worldState.locationPath, /Context Bridge Room/);
}

{
  let blurred = false;
  let ariaHidden = "";
  const focusedClose = { blur() { blurred = true; } };
  const mapWindow = {
    inert: false,
    contains(el) { return el === focusedClose; },
    setAttribute(name, value) { if (name === "aria-hidden") ariaHidden = value; },
  };
  const previousGetElementById = document.getElementById;
  document.activeElement = focusedClose;
  document.getElementById = (id) => id === "uie-map-window" ? mapWindow : null;
  map.closeMap();
  document.getElementById = previousGetElementById;
  assert.equal(blurred, true);
  assert.equal(mapWindow.inert, true);
  assert.equal(ariaHidden, "true");
}

{
  const assetsHtml = fs.readFileSync(new URL("../src/templates/features/assets.html", import.meta.url), "utf8");
  const inventoryHtml = fs.readFileSync(new URL("../src/templates/inventory.html", import.meta.url), "utf8");
  const newGameHtml = fs.readFileSync(new URL("../src/templates/newgame.html", import.meta.url), "utf8");
  assert.match(assetsHtml, /asset-action-place/);
  assert.match(assetsHtml, /asset-action-board/);
  assert.match(inventoryHtml, /uie-create-asset-travel-category/);
  assert.match(newGameHtml, /option value="boat"/);
  assert.match(newGameHtml, /option value="spacecraft"/);

  const html = fs.readFileSync(new URL("../game.html", import.meta.url), "utf8");
  const menuHtml = fs.readFileSync(new URL("../src/templates/hamburger_menu.html", import.meta.url), "utf8");
  const navigationJs = fs.readFileSync(new URL("../src/modules/navigation.js", import.meta.url), "utf8");
  const mapJs = fs.readFileSync(new URL("../src/modules/map.js", import.meta.url), "utf8");
  const interactionJs = fs.readFileSync(new URL("../src/modules/interaction.js", import.meta.url), "utf8");
  const styleCss = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const journalJs = fs.readFileSync(new URL("../src/modules/journal.js", import.meta.url), "utf8");
  const apiClient = fs.readFileSync(new URL("../src/modules/apiClient.js", import.meta.url), "utf8");
  const imageGen = fs.readFileSync(new URL("../src/modules/imageGen.js", import.meta.url), "utf8");
  assert.match(menuHtml, /uie-menu-tab/);
  assert.match(menuHtml, /uie-menu-page/);
  assert.match(menuHtml, /uie-menu-workspace/);
  assert.match(menuHtml, /flex-direction:column/);
  assert.match(navigationJs, /document\.getElementById\("re-nav-arrows"\)\?\.remove/);
  assert.match(styleCss, /#nav-row[\s\S]*display: flex !important/);
  assert.match(navigationJs, /export async function attemptMove/);
  assert.match(navigationJs, /export function rotateView/);
  assert.match(navigationJs, /export function activateDirection/);
  assert.match(navigationJs, /addEventListener\("keydown"/);
  assert.match(navigationJs, /First swipe previews the destination/);
  assert.match(navigationJs, /void activateDirection\(direction\)/);
  assert.match(navigationJs, /document\.body\.appendChild\(popup\)/);
  assert.match(navigationJs, /z-index:2147483646/);
  assert.match(navigationJs, /#vn-stage,#re-bg\{touch-action:none/);
  assert.doesNotMatch(navigationJs, /re-screen-minimap/);
  assert.doesNotMatch(html, /data-visibility="minimap"/);
  assert.doesNotMatch(navigationJs, /addEventListener\("touchend"/);
  assert.doesNotMatch(navigationJs, /addEventListener\("dblclick"/);
  assert.match(navigationJs, /openBarrierInspection/);
  assert.match(mapJs, /export async function unlockExit/);
  assert.doesNotMatch(navigationJs, /btn\.onpointerup|btn\.ontouchend/);
  assert.doesNotMatch(interactionJs, /click\.uieGenericClose pointerup\.uieGenericClose/);
  assert.doesNotMatch(interactionJs, /click\.uieSettingsTabs pointerup\.uieSettingsTabs/);
  assert.doesNotMatch(styleCss, /\.uie-window \*\s*,/);
  assert.match(styleCss, /\.re-viewport-zone--forward/);
  assert.match(styleCss, /\.uie-barrier-inspection/);
  assert.match(menuHtml, /id="uie-btn-journal"/);
  assert.match(menuHtml, /id="uie-btn-diary"/);
  assert.match(menuHtml, /id="uie-btn-factions"/);
  assert.match(menuHtml, /id="uie-btn-open-map"/);
  assert.match(journalJs, /if \(!bound\) initJournal\(\)/);
  assert.match(journalJs, /bound = true;\s*startChatIngest\(\)/);
  assert.match(html, /mapMod\.navigateDirection\(dir\)/);
  assert.doesNotMatch(html, /id="reality-stage"|setRealityStageActive|data-reality-stage/);
  assert.match(html, /function ensureVnStageDom/);
  assert.match(html, /function ensureStoryWorldState/);
  assert.match(html, /async function ensureAreaScene/);
  assert.match(html, /click\.uieMainMenuTabs/);
  assert.match(html, /click\.uieMainMenuClose/);
  assert.match(html, /window\.runNavigation = runNavigation/);
  assert.match(html, /onclick="window\.runNavigation\?\.\('map'\)"/);
  assert.doesNotMatch(html, /id="msg-box-prev"|id="msg-box-next"/);
  assert.doesNotMatch(html, /id="msg-box-continue"/);
  assert.match(html, /class="uie-dialogue-continue"/);
  assert.match(html, /cfg-msg-auto-continue/);
  assert.match(html, /sentencesPerBox/);
  assert.match(html, /navigation\.activateDirection\?\.\(dir\)/);
  assert.match(html, /__uieNativeCloseFallbackBound/);
  assert.match(html, /Quick Bag/);
  assert.match(html, /window\.__uieBootWatchdog/);
  assert.match(html, /Boot watchdog released the loading screen/);
  assert.match(html, /await m\.openMap\?\.\(\)/);
  assert.match(html, /window\.openConfigModal\("mainapi"\)/);
  assert.match(html, /#uie-diary-window", "diary\.js", "renderDiary", "initDiary"/);
  assert.match(html, /id === "uie-btn-factions"/);
  assert.match(apiClient, /type === "Helper Pet Mutation"/);
  assert.match(imageGen, /normalizeGeneratedImageUrl\(urlOut, endpoint\)/);
  const mapTemplateHtml = fs.readFileSync(new URL("../src/templates/map.html", import.meta.url), "utf8");
  assert.match(mapTemplateHtml, /data-map-view="world">World</);
  assert.match(mapTemplateHtml, /data-map-view="region">Region</);
  assert.match(mapTemplateHtml, /data-map-view="area">Local</);
  assert.match(mapTemplateHtml, /data-map-view="vicinity">Nearby</);
  assert.match(mapTemplateHtml, /data-map-view="blueprint">Area</);
  assert.doesNotMatch(mapTemplateHtml, /Regenerate Current Nearby Layer/);
  const scriptRe = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match = null;
  let parsedScripts = 0;
  while ((match = scriptRe.exec(html))) {
    const attrs = String(match[1] || "").toLowerCase();
    if (attrs.includes("src=") || attrs.includes('type="module"')) continue;
    const code = String(match[2] || "").trim();
    if (!code) continue;
    parsedScripts += 1;
    new vm.Script(code, { filename: `game-inline-${parsedScripts}.js` });
  }
  assert.ok(parsedScripts > 0);
}

console.log("map-navigation tests: ok");
