import assert from "node:assert/strict";

globalThis.window = globalThis.window || { addEventListener() {}, dispatchEvent() {}, UIE_STANDALONE: true };
globalThis.document = globalThis.document || { addEventListener() {}, getElementById() { return null; } };
globalThis.localStorage = globalThis.localStorage || { getItem() { return null; }, setItem() {}, removeItem() {} };
const jqueryStub = () => new Proxy({}, { get: (_target, key) => key === "length" ? 0 : () => jqueryStub() });
globalThis.$ = globalThis.$ || jqueryStub;
globalThis.jQuery = globalThis.jQuery || globalThis.$;

const { normalizeLock, inspectLock, listAccessMethods } = await import("../src/modules/accessControl.js");
const { resolveContextualActions } = await import("../src/modules/contextualActions.js");

const settings = {
  character: { name: "Mara", stats: { str: 14, dex: 12, int: 13 }, faction: "Harbor Guild", reputation: 18 },
  inventory: {
    items: [
      { name: "Warehouse Brass Key" },
      { name: "Lockpick Set", tool_properties: { provided_capabilities: ["mechanical_bypass"], current_durability: 8 } },
      { name: "Data Spike", tool_properties: { provided_capabilities: ["electronic_bypass"], current_durability: 6 } },
      { name: "Crowbar", durability: 10 },
      { name: "Fishing Rod", durability: 12 },
    ],
    skills: [{ name: "Lockpicking", level: 2 }, { name: "Hacking", level: 1 }],
  },
  worldState: {
    currentLocation: "North Harbor Dock 3",
    accessLocks: {}, accessPermissions: {}, objectStates: {}, evidence: [], suspicion: 0,
  },
};

const keyLock = normalizeLock({ id: "warehouse", name: "Warehouse Door", locked: true, lock: { type: "key", validKeys: ["Warehouse Brass Key"], difficulty: 35 } }, settings);
assert.equal(keyLock.type, "key");
assert.match(inspectLock(keyLock), /keyhole/i);
const keyMethods = listAccessMethods(keyLock, settings);
assert.equal(keyMethods.find((method) => method.id === "key")?.available, true);
assert.equal(keyMethods.find((method) => method.id === "pick")?.available, true);
assert.equal(keyMethods.find((method) => method.id === "force")?.available, true);

const terminal = normalizeLock({ id: "console", name: "Dock Console", locked: true, lock: { type: "electronic", code: "4132" } }, settings);
const terminalMethods = listAccessMethods(terminal, settings);
assert.equal(terminalMethods.find((method) => method.id === "code")?.available, true);
assert.equal(terminalMethods.find((method) => method.id === "hack")?.available, true);

settings.worldState.accessLocks[keyLock.id] = { state: "unlocked", attempts: 2, damage: 1, tampered: true, unlockedBy: "pick" };
const restored = normalizeLock({ id: "warehouse", name: "Warehouse Door", locked: true, lock: { type: "key" } }, settings);
assert.equal(restored.state, "unlocked");
assert.equal(restored.attempts, 2);
assert.equal(restored.damage, 1);

const dockTools = resolveContextualActions({ id: "pier_water", name: "Village Ferry Pier Water", type: "water" }, settings);
assert.ok(dockTools.some((entry) => entry.action === "fish"), "fishing rod must expose fishing only at compatible water targets");
const officeTools = resolveContextualActions({ id: "office_chair", name: "Office Chair", type: "furniture" }, settings);
assert.ok(!officeTools.some((entry) => entry.action === "fish"), "fishing must not appear on incompatible targets");

console.log("access and contextual tool integration tests: ok");
