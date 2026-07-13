import assert from "node:assert/strict";

const store = new Map();
globalThis.window = {
  extension_settings: {
    "universal-immersion-engine": {
      inventory: { items: [] },
    },
  },
  addEventListener: () => {},
  dispatchEvent: () => {},
};
globalThis.document = {
  cookie: "",
  querySelector: () => null,
};
globalThis.localStorage = {
  getItem: (key) => store.get(`local:${key}`) || null,
  setItem: (key, value) => store.set(`local:${key}`, String(value)),
  removeItem: (key) => store.delete(`local:${key}`),
};
globalThis.sessionStorage = {
  getItem: (key) => store.get(`session:${key}`) || null,
  setItem: (key, value) => store.set(`session:${key}`, String(value)),
  removeItem: (key) => store.delete(`session:${key}`),
};
const jqStub = new Proxy(function () {}, {
  get: (_target, prop) => {
    if (prop === "is") return () => false;
    if (prop === "length") return 0;
    return () => jqStub;
  },
});
globalThis.$ = () => jqStub;

const { validateResponse } = await import("../src/modules/logicEnforcer.js");

const badStateSummary = `Player Character: Ryu (Human Paladin/Adventurer Lv 1).
 * Location: Horizon Gate - Side Room.
 * Time: Evening.
 * Current State: DP/HP/MP/AP all full. Inventory has clothing and currency.
 * Context: The player is in a side room at the "Horizon Gate". There are immediate interactives like Study, Bed, Computer, Closet.

 * Use`;

const bad = validateResponse(badStateSummary, { type: "VN Dialogue" });
assert.match(bad.issues.join("\n"), /scene-state summary/i);
assert.match(bad.issues.join("\n"), /first readable line/i);

const unlabeled = validateResponse("The room waits quietly.", { type: "VN Dialogue" });
assert.match(unlabeled.issues.join("\n"), /first readable line/i);

const badNarratorDialogue = validateResponse(`[Narrator]: Miko turns toward Irina. "I remember when you could barely lift a hilt."
===DATA===
{"state_updates":{"resource_impacts":{}},"action_wheel_options":[]}`, { type: "VN Dialogue" });
assert.match(badNarratorDialogue.issues.join("\n"), /Narrator may narrate only/i);

const badLiteralName = validateResponse(`[Name]: I am not a real speaker label.
===DATA===
{"state_updates":{"resource_impacts":{}},"action_wheel_options":[]}`, { type: "VN Dialogue" });
assert.match(badLiteralName.issues.join("\n"), /literal \[Name\]/i);

const good = validateResponse(`[Narrator]: The side room settles into evening quiet.
===DATA===
{"state_updates":{"resource_impacts":{}},"action_wheel_options":[]}`, { type: "VN Dialogue" });
assert.equal(good.issues.filter((issue) => /^VN response format:/i.test(issue)).length, 0);

console.log("vn-response-validation tests: ok");
process.exit(0);
