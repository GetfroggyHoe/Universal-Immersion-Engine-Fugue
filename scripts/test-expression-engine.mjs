import assert from "node:assert/strict";

const store = new Map();
globalThis.window = {
  addEventListener: () => {},
  dispatchEvent: () => {},
};
globalThis.document = { cookie: "", querySelector: () => null };
globalThis.localStorage = {
  getItem: (key) => store.get(`local:${key}`) || null,
  setItem: (key, value) => store.set(`local:${key}`, String(value)),
  removeItem: (key) => store.delete(`local:${key}`),
};

const {
  ExpressionDirector,
  ExpressionResolver,
  EXPRESSION_CATALOG,
} = await import("../src/modules/expressionEngine.js");

function freshDirector(extra = {}) {
  return new ExpressionDirector({ minStableLines: 2, ...extra });
}

let kept = 0;
let changed = 0;

function tally(res) {
  if (res.changeRequired) changed++;
  else kept++;
  return res;
}

const d = freshDirector();
d.registerCharacter("Mira", { currentExpression: "neutral" });

const r1 = tally(d.evaluate("Mira", { visibleEmotion: "neutral", socialStance: "neutral" }));
assert.equal(r1.changeRequired, false);
assert.equal(r1.selectedExpression, "neutral");

const r2 = tally(d.evaluate("Mira", {
  internalEmotion: "anger",
  visibleEmotion: "neutral",
  socialStance: "neutral",
  intensity: 0.9,
}));
assert.equal(r2.changeRequired, false, "internal-only anger must not change visible expression");
assert.equal(d.getState("Mira").internalEmotion, "anger");

const r3 = tally(d.evaluate("Mira", {
  visibleEmotion: "anger",
  composure: 0.8,
  intensity: 0.7,
}));
assert.equal(r3.changeRequired, true, "clear anger shift should change expression");
assert.equal(r3.selectedExpression, "controlled_anger");

const r4 = tally(d.evaluate("Mira", {
  visibleEmotion: "anger",
  composure: 0.8,
  intensity: 0.72,
}));
assert.equal(r4.changeRequired, false, "weak follow-up wording should not swap");

const r5 = tally(d.evaluate("Mira", {
  visibleEmotion: "fear",
  composure: 0.3,
  intensity: 0.7,
  isMajorBeat: true,
}));
assert.equal(r5.changeRequired, true, "major beat allows change despite recency");
assert.equal(r5.selectedExpression, "frightened");

const d2 = freshDirector();
d2.registerCharacter("Cael", { currentExpression: "guarded" });
const micro = tally(d2.evaluate("Cael", {
  visibleEmotion: "surprise",
  intensity: 0.85,
}));
assert.equal(micro.changeRequired, true);
assert.equal(micro.temporary, true);
assert.equal(micro.selectedExpression, "surprised");
assert.equal(micro.returnExpression, "guarded");

const micro2 = tally(d2.evaluate("Cael", { visibleEmotion: "neutral" }));
assert.equal(micro2.changeRequired, false, "micro-expression should persist for its duration");
assert.equal(micro2.selectedExpression, "surprised");

const micro3 = tally(d2.evaluate("Cael", { visibleEmotion: "neutral" }));
assert.equal(micro3.changeRequired, true, "micro-expression reverts after its duration");
assert.equal(micro3.selectedExpression, "guarded");
assert.equal(micro3.reason, "temporary_revert");

const d3 = freshDirector();
const listen = tally(d3.reactToEvent("Ilya", {
  affects: ["Mira", "Ilya"],
  emotionalImpact: 0.8,
  emotion: "shocked",
  isMajorBeat: true,
}));
assert.equal(listen.changeRequired, true);
assert.equal(listen.selectedExpression, "surprised");

const listen2 = tally(d3.reactToEvent("Mira", {
  affects: ["Ilya"],
  emotionalImpact: 0.9,
}));
assert.equal(listen2.changeRequired, false, "unaffected listener keeps expression");

const listen3 = tally(d3.reactToEvent("Ilya", {
  affects: ["Ilya"],
  emotionalImpact: 0.2,
}));
assert.equal(listen3.changeRequired, false, "low-impact event does not trigger listen reaction");

const d4 = freshDirector();
d4.registerCharacter("Sol", { currentExpression: "neutral" });
const maskRes = tally(d4.evaluate("Sol", {
  visibleEmotion: "neutral",
  mask: "fake_smile",
  concealment: 0.8,
}));
assert.equal(maskRes.changeRequired, true);
assert.equal(maskRes.selectedExpression, "fake_smile");

const resolver = new ExpressionResolver({ approvedAssets: { controlled_anger: "ca_01", neutral: "neu_00" }, fallback: "neutral" });
const mapped = resolver.resolve({ expressionKey: "controlled_anger", changeRequired: true, confidence: 0.9, reason: "anger_controlled", temporary: false });
assert.equal(mapped.selectedExpression, "ca_01");
assert.equal(mapped.fallbackExpression, "neu_00");
assert.ok(!/[/\\.]/.test(mapped.selectedExpression), "resolver must return a semantic asset key, not a path");
assert.equal(mapped.changeRequired, true);

assert.throws(() => {
  d4.evaluate("Sol", { visibleEmotion: "neutral", image: "sprites/sol/angry.png" });
}, /semantic/i, "asset-flavored input must be rejected");

assert.ok(EXPRESSION_CATALOG.base.includes("neutral"));
assert.ok(EXPRESSION_CATALOG.mask.includes("fake_smile"));
assert.ok(EXPRESSION_CATALOG.physical.includes("exhausted"));

const d5 = freshDirector();
d5.registerCharacter("Rhett", { currentExpression: "neutral" });
const scene = [
  { visibleEmotion: "neutral", socialStance: "neutral" },
  { internalEmotion: "amusement", visibleEmotion: "neutral", socialStance: "neutral" },
  { visibleEmotion: "neutral", socialStance: "neutral", intensity: 0.45 },
  { internalEmotion: "irritation", visibleEmotion: "neutral", socialStance: "neutral" },
  { visibleEmotion: "neutral", socialStance: "relaxed" },
  { visibleEmotion: "neutral", socialStance: "neutral", composure: 0.95 },
  { internalEmotion: "sadness", visibleEmotion: "neutral", socialStance: "neutral" },
  { visibleEmotion: "neutral", socialStance: "neutral" },
  { internalEmotion: "anger", visibleEmotion: "neutral", socialStance: "neutral", intensity: 0.5 },
  { visibleEmotion: "neutral", socialStance: "neutral" },
];
for (const line of scene) {
  const res = tally(d5.evaluate("Rhett", line));
  assert.equal(res.changeRequired, false, `mundane line should keep (${JSON.stringify(line)})`);
}

assert.ok(kept > changed, `most results should keep current (kept=${kept}, changed=${changed})`);

console.log(`expression-engine tests: ok (kept=${kept}, changed=${changed})`);
process.exit(0);
