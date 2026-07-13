// Layered VN animation system — logic tests (no DOM required).
// Run: node scripts/test-layered-animation.mjs
import assert from "node:assert";

import {
    resolveDialogueAnimation,
    normalizeSpeakerState,
    detectStrongTriggers,
    DialogueFamily,
    DecisionLevel,
} from "../src/modules/animation/dialogueResolver.js";
import {
    characterMotionProfiles,
    BaselineStyle,
} from "../src/modules/animation/characterMotionProfiles.js";
import {
    AnimationPriorityManager,
    EnvironmentMode,
    EventCategory,
    priorityForCategory,
} from "../src/modules/animation/animationPriorityManager.js";
import {
    deriveSpeakerState,
    deriveEnvironmentEvents,
} from "../src/modules/animation/semanticExtract.js";

let passed = 0;
function test(name, fn) {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
}

console.log("Dialogue resolver:");

test("first line from a speaker produces a restrained entrance, not nothing", () => {
    const d = resolveDialogueAnimation({ speakerId: "Aria", emotion: "neutral", newSpeaker: true });
    assert.ok(d && d.family, "should return a directive");
    assert.notStrictEqual(d.decision, DecisionLevel.NONE);
});

test("consecutive same-speaker/same-state line does NOT replay entrance", () => {
    const d = resolveDialogueAnimation({
        speakerId: "Aria", emotion: "neutral", isContinuation: true,
    });
    // continuation (micro) or nothing — never a full accent entrance
    assert.ok(d.decision === DecisionLevel.MICRO || d.decision === DecisionLevel.NONE);
});

test("emotion alone never maps to one fixed animation (anger != always shake)", () => {
    // Controlled character: anger becomes rigid/still, not a shake.
    const controlled = resolveDialogueAnimation({
        speakerId: "Cool", emotion: "angry", emotionalIntensity: 0.8, composure: 0.85,
    }, { profile: { baselineStyle: BaselineStyle.CONTROLLED } });
    assert.strictEqual(controlled.family, DialogueFamily.RIGID_ENTRANCE);

    // Volatile character: anger becomes abrupt impact motion.
    const volatile = resolveDialogueAnimation({
        speakerId: "Hot", emotion: "angry", emotionalIntensity: 0.85, composure: 0.25,
    }, { profile: { baselineStyle: BaselineStyle.VOLATILE } });
    assert.notStrictEqual(volatile.family, controlled.family);
});

test("two characters, same emotion, different motion", () => {
    const timid = resolveDialogueAnimation({
        speakerId: "Timmy", emotion: "afraid", fear: 0.8, emotionalIntensity: 0.7, composure: 0.3,
    }, { profile: { baselineStyle: BaselineStyle.TIMID } });
    const stoic = resolveDialogueAnimation({
        speakerId: "Stone", emotion: "afraid", fear: 0.8, emotionalIntensity: 0.7, composure: 0.3,
    }, { profile: { baselineStyle: BaselineStyle.STOIC } });
    assert.notStrictEqual(timid.family, stoic.family);
});

test("strong animation requires justification (interruption)", () => {
    const d = resolveDialogueAnimation({
        speakerId: "A", emotion: "neutral", interruption: true, newSpeaker: true,
    });
    assert.ok(d.strong, "interruption + new speaker should be a strong takeover");
    assert.strictEqual(d.family, DialogueFamily.TAKEOVER);
});

test("strong family downgrades when no strong trigger present", () => {
    // physicalAction with low force should not force an impact shake
    const d = resolveDialogueAnimation({
        speakerId: "A", emotion: "neutral", physicalAction: true, physicalForce: 0.2,
    });
    assert.ok(!d.strong, "low-force action should not trigger a strong beat");
});

test("physical action with force justifies impact shake on the box", () => {
    const d = resolveDialogueAnimation({
        speakerId: "A", emotion: "angry", physicalAction: true, physicalForce: 0.8, composure: 0.4,
    });
    assert.strictEqual(d.family, DialogueFamily.IMPACT_SHAKE);
});

test("playful character adds a light overshoot on neutral-but-lively lines", () => {
    const d = resolveDialogueAnimation({
        speakerId: "Pip", emotion: "neutral", emotionalIntensity: 0.6,
    }, { profile: { baselineStyle: BaselineStyle.PLAYFUL } });
    assert.strictEqual(d.family, DialogueFamily.EXCITED_LIFT);
    assert.ok(Number(d.vars["--ua-overshoot"].replace("px", "")) > 0);
});

console.log("Strong triggers:");
test("intensity jump is detected", () => {
    const st = normalizeSpeakerState({ emotionalIntensity: 0.9, prevIntensity: 0.3, isContinuation: true });
    const tr = detectStrongTriggers(st);
    assert.ok(tr.majorIntensityIncrease);
});

console.log("Priority manager:");
test("high-priority override blocks a later ambient on the same layer", () => {
    const pm = new AnimationPriorityManager();
    pm.claim(["camera_viewport"], { priority: priorityForCategory(EventCategory.DANGER), mode: EnvironmentMode.OVERRIDE, durationMs: 1000 });
    const dec = pm.arbitrate({ category: EventCategory.AMBIENT, mode: EnvironmentMode.AMBIENT, affectedLayers: ["camera_viewport"] });
    assert.strictEqual(dec.allowed, false);
});

test("ambient continues under a compatible reaction on a different layer", () => {
    const pm = new AnimationPriorityManager();
    pm.claim(["environment_effects"], { priority: priorityForCategory(EventCategory.WEATHER), mode: EnvironmentMode.AMBIENT, durationMs: 5000 });
    const dec = pm.arbitrate({ category: EventCategory.IMPACT, mode: EnvironmentMode.REACTION, affectedLayers: ["camera_viewport"] });
    assert.strictEqual(dec.allowed, true);
});

console.log("Semantic extraction:");
test("angry speech alone does NOT create an environment event", () => {
    const events = deriveEnvironmentEvents({ text: "You IDIOT! I am absolutely furious with you!" });
    assert.strictEqual(events.length, 0, "emotion must never shake the screen");
});

test("a physical/environmental cue DOES create an environment event", () => {
    const events = deriveEnvironmentEvents({ text: "A deafening explosion rocked the building." });
    assert.ok(events.some((e) => e.type === "explosion"));
});

test("table slam tied to a line is detected", () => {
    const events = deriveEnvironmentEvents({ text: "He slammed his fist on the table." });
    assert.ok(events.some((e) => e.type === "table_impact"));
});

test("explicit semantic tags are honored, not raw CSS", () => {
    const events = deriveEnvironmentEvents({ text: "The room went dark. [event: blackout]" });
    assert.ok(events.some((e) => e.type === "blackout"));
});

test("deriveSpeakerState reads tags and infers composure", () => {
    const st = deriveSpeakerState({ speaker: "Aria", text: "[emotion: angry][intensity: 90] Get out. Now." });
    assert.strictEqual(st.emotion, "angry");
    assert.ok(st.emotionalIntensity >= 0.85);
    assert.ok(st.composure < 0.6);
});

console.log("Character motion profile registry:");
test("register + get returns a normalized profile influencing selection", () => {
    characterMotionProfiles.register("Boss", "controlled");
    const p = characterMotionProfiles.get("Boss");
    assert.strictEqual(p.baselineStyle, BaselineStyle.CONTROLLED);
    const d = resolveDialogueAnimation({ speakerId: "Boss", emotion: "angry", emotionalIntensity: 0.8, composure: 0.8 });
    assert.strictEqual(d.family, DialogueFamily.RIGID_ENTRANCE);
});

console.log(`\nAll ${passed} layered-animation tests passed.`);
