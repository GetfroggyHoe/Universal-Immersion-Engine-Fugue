import assert from "node:assert/strict";

const store = new Map();
globalThis.window = { addEventListener: () => {}, dispatchEvent: () => {} };
globalThis.document = { cookie: "", querySelector: () => null };
globalThis.localStorage = {
  getItem: (key) => store.get(`local:${key}`) || null,
  setItem: (key, value) => store.set(`local:${key}`, String(value)),
  removeItem: (key) => store.delete(`local:${key}`),
};

const {
  applyCoarseExpression,
  applySpeakerExpression,
  applySceneReaction,
  applyResponseStaticExpressions,
  mapSpeakerStateToInput,
  configureExpressionEngine,
} = await import("../src/modules/expressionBridge.js");

const { deriveSpeakerState } = await import("../src/modules/animation/semanticExtract.js");

const vnNodes = [];
function addNode(id) {
  const n = {
    dataset: { characterId: id },
    classList: { add() {}, remove() {} },
    __uieVnCharacterEngine: { updateState(s) { Object.assign(n.dataset, s); } },
  };
  vnNodes.push(n);
  return n;
}
globalThis.document.querySelectorAll = (sel) => (sel === ".vn-character" ? vnNodes.slice() : []);

configureExpressionEngine({ minStableLines: 2 });

addNode("Mira");

const r1 = applyCoarseExpression("Mira", { pose: "neutral", expression: "neutral" });
assert.equal(r1.changeRequired, false);
assert.equal(r1.selectedExpression, "neutral");

const r1b = applyCoarseExpression("Mira", { pose: "neutral", expression: "neutral" });
assert.equal(r1b.changeRequired, false);

const r2 = applyCoarseExpression("Mira", { pose: "tense", expression: "angry" });
assert.equal(r2.changeRequired, true);
assert.ok(["irritated", "open_anger", "controlled_anger"].includes(r2.selectedExpression), "anger resolves to a sustained anger expression");
const angerExpr = r2.selectedExpression;
assert.equal(vnNodes[0].dataset.expression, angerExpr);

const r3 = applyCoarseExpression("Mira", { pose: "tense", expression: "angry" });
assert.equal(r3.changeRequired, false, "repeated same expression should hold (hysteresis)");

const r4 = applyCoarseExpression("Mira", { pose: "neutral", expression: "neutral" });
assert.equal(r4.changeRequired, false, "rapid drop back to neutral is suppressed while recent");
assert.equal(r4.selectedExpression, angerExpr, "stable expression persists until recency clears");

const speakerState = deriveSpeakerState({ speaker: "Mira", text: "I can't believe you did that! *slams the table*" });
const input = mapSpeakerStateToInput(speakerState);
assert.ok(input.visibleEmotion, "speaker state maps to semantic input");
const r5 = applySpeakerExpression("Mira", speakerState);
assert.ok(r5.selectedExpression, "speaker expression applied");

const reaction = applySceneReaction({ affects: ["Mira"], emotionalImpact: 0.95, emotion: "shocked", isMajorBeat: true });
assert.equal(reaction.length, 1);
assert.equal(reaction[0].changeRequired, true);
assert.equal(reaction[0].selectedExpression, "surprised");

const dataOut = applyResponseStaticExpressions(JSON.stringify({
  character_states: { Lena: { visibleEmotion: "sadness", intensity: 0.6, composure: 0.6 } },
}));
assert.equal(dataOut[0].selectedExpression, "sad");

console.log("expression-bridge tests: ok");
process.exit(0);
