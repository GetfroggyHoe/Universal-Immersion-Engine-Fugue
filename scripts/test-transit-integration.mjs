import assert from "node:assert/strict";
import {
  TRANSIT_MODES,
  accessModesForNode,
  applyTransitNeeds,
  availableModesForNode,
  buildTransitRoutes,
  debitTransitFare,
  ensureTravelState,
  evaluateTransitRoute,
  recordTransitArrival,
  selectTransitEvent,
} from "../src/modules/travelRules.js";

const nodes = [
  { id: "central", name: "Central Exchange", type: "station bus terminal road", x: 0, y: 0, discoveryState: "generated" },
  { id: "north_rail", name: "North Rail Platform", type: "train station", x: 10, y: 0, discoveryState: "generated" },
  { id: "harbor_3", name: "North Harbor Dock 3", type: "harbor dock ferry", x: 20, y: 0, discoveryState: "generated" },
  { id: "airfield", name: "East Airfield", type: "airport hangar", x: 30, y: 0, discoveryState: "generated" },
  { id: "orbital", name: "Orbital Dock A-12", type: "spaceport orbital dock", x: 40, y: 0, discoveryState: "generated" },
  { id: "stable", name: "Moon Road Stable", type: "stable trail road", x: 12, y: 8, discoveryState: "generated" },
  { id: "gate", name: "Glass Portal Gate", type: "portal gateway", x: 50, y: 0, discoveryState: "generated" },
];
const settings = {
  currency: 250,
  currencySymbol: "G",
  playerRoom: { day: 2, hour: 10, minute: 0 },
  playerProgress: { needs: { hunger: 90, thirst: 90, energy: 90 } },
  inventory: {
    items: [{ name: "Harbor Pass", qty: 1 }],
    assets: [
      { name: "Roadster", travelCategory: "road_vehicle", location: "Central Exchange" },
      { name: "Chestnut", travelCategory: "mount", location: "Central Exchange" },
      { name: "Royal Coach", travelCategory: "cart", location: "Central Exchange" },
      { name: "Sea Wren", travelCategory: "boat", location: "North Harbor Dock 3" },
      { name: "Wayfarer", travelCategory: "spacecraft", location: "Orbital Dock A-12" },
    ],
  },
  party: { members: [{ name: "Mara", active: true, followsUser: true }] },
  worldState: {
    location: "Central Exchange",
    currentLocation: "Central Exchange",
    weather: "Clear",
    mapNodes: Object.fromEntries(nodes.map((node) => [node.name, node])),
    transitRoutes: [{
      id: "harbor_ferry",
      from: "Central Exchange",
      to: "North Harbor Dock 3",
      mode: "bus",
      fare: 9,
      duration: 18,
      requirements: { item: "Harbor Pass" },
    }],
  },
};
const mapState = { version: 2, area: nodes, vicinity: [], vicinityByArea: {}, blueprints: {} };

const travel = ensureTravelState(settings);
assert.equal(travel.version, 1);
assert.deepEqual(travel.history, []);

const origin = nodes[0];
assert.ok(accessModesForNode(origin).includes("rail"));
const modes = availableModesForNode(origin, settings.inventory.assets);
for (const mode of ["train", "bus", "rideshare", "car", "horse", "carriage"]) assert.ok(modes.includes(mode), `${mode} should be available`);

for (const [mode, destination] of [
  ["train", "North Rail Platform"],
  ["boat", "North Harbor Dock 3"],
  ["plane", "East Airfield"],
  ["spaceship", "Orbital Dock A-12"],
  ["horse", "Moon Road Stable"],
  ["carriage", "Moon Road Stable"],
  ["portal", "Glass Portal Gate"],
]) {
  assert.ok(TRANSIT_MODES[mode]);
  const routes = buildTransitRoutes({ settings, mapState, origin, mode });
  assert.ok(routes.some((route) => route.to === destination), `${mode} should route to ${destination}`);
}

const explicit = buildTransitRoutes({ settings, mapState, origin, mode: "bus" }).find((route) => route.id === "harbor_ferry");
assert.ok(explicit);
assert.equal(evaluateTransitRoute(settings, explicit).ok, true);
settings.inventory.items = [];
assert.equal(evaluateTransitRoute(settings, explicit).ok, false);
settings.inventory.items = [{ name: "Harbor Pass", qty: 1 }];

const before = settings.currency;
assert.equal(debitTransitFare(settings, explicit.fare), true);
assert.equal(settings.currency, before - explicit.fare);
const needs = applyTransitNeeds(settings, explicit.duration);
assert.ok(needs.hunger < 90 && needs.thirst < 90 && needs.energy < 90);

travel.tripCounter = 7;
assert.deepEqual(selectTransitEvent(settings, explicit), selectTransitEvent(settings, explicit), "events must be deterministic for the same trip state");
recordTransitArrival(settings, explicit, null);
assert.equal(settings.worldState.travel.currentDockName, explicit.to);
assert.equal(settings.worldState.travel.discoveredDocks[explicit.toId], true);
assert.equal(settings.worldState.travel.history.length, 1);

const restored = JSON.parse(JSON.stringify(settings));
const restoredTravel = ensureTravelState(restored);
assert.equal(restoredTravel.currentDockName, explicit.to);
assert.equal(restoredTravel.history.length, 1);

console.log("transit integration tests: ok");
