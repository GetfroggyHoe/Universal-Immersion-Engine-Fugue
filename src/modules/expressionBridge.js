import { ExpressionDirector, ExpressionResolver, EXPRESSION_CATEGORIES } from "./expressionEngine.js";

let director = new ExpressionDirector({}, new ExpressionResolver({ fallback: "neutral" }));
let resolver = director.resolver;

const EMOTION_SYNONYMS = {
  angry: "anger", furious: "anger", rage: "anger", hostile: "anger", enraged: "anger", mad: "anger",
  irritated: "anger", irritation: "anger", frustrated: "anger", frustration: "anger",
  annoyed: "anger", annoyance: "anger", contempt: "anger", disgusted: "disgust", disgust: "disgust",
  sad: "sadness", grief: "sadness", grieving: "sadness", miserable: "sadness", depressed: "sadness",
  tearful: "sadness", weepy: "sadness", heartbroken: "sadness",
  afraid: "fear", scared: "fear", terrified: "fear", panic: "fear", panicked: "fear",
  anxious: "fear", anxiety: "fear", nervous: "fear", frightened: "fear", dread: "fear",
  worried: "fear", worrying: "fear",
  happy: "joy", joy: "joy", joyous: "joy", elated: "joy", excited: "joy", cheerful: "joy",
  content: "joy", contentment: "joy", relieved: "relief", relief: "relief",
  amused: "joy", amusement: "joy", playful: "joy", gleeful: "joy",
  suspicious: "suspicion", distrustful: "suspicion", wary: "suspicion",
  confused: "confusion", unsure: "confusion", uncertain: "confusion", doubtful: "confusion",
  shocked: "surprise", shock: "surprise", astonished: "surprise", startled: "surprise",
  surprised: "surprise", realization: "surprise",
  calm: "neutral", composed: "neutral", relaxed: "neutral", serene: "neutral",
  tired: "exhausted", weary: "exhausted",
};

function normalizeEmotion(raw) {
  const key = String(raw || "neutral").trim().toLowerCase();
  if (!key || key === "none") return "neutral";
  if (EMOTION_SYNONYMS[key]) return EMOTION_SYNONYMS[key];
  return key;
}

function mapPhysicalState(raw) {
  const key = String(raw || "normal").trim().toLowerCase();
  if (key === "exhausted" || key === "tired" || key === "weary") return "exhausted";
  if (key === "injured" || key === "wounded" || key === "hurt" || key === "bleeding") return "injured";
  if (key === "sick" || key === "ill") return "sick";
  return "none";
}

export function mapSpeakerStateToInput(speakerState = {}) {
  const emotion = normalizeEmotion(speakerState.emotion);
  const intensity = typeof speakerState.emotionalIntensity === "number" ? speakerState.emotionalIntensity : 0.5;
  const composure = typeof speakerState.composure === "number" ? speakerState.composure : 1 - intensity * 0.4;
  const confidence = typeof speakerState.confidence === "number" ? speakerState.confidence : 0.6;

  const hostility = typeof speakerState.hostility === "number" ? speakerState.hostility : 0;
  const fear = typeof speakerState.fear === "number" ? speakerState.fear : 0;
  let socialStance = "neutral";
  if (hostility >= 0.5) socialStance = "aggressive";
  else if (fear >= 0.5) socialStance = "submissive";

  const physicalCondition = mapPhysicalState(speakerState.physicalState);
  const isMajorBeat = !!speakerState.interruption || (!!speakerState.physicalAction && (speakerState.physicalForce || 0) >= 0.7);

  return {
    internalEmotion: emotion,
    visibleEmotion: emotion,
    intensity,
    composure,
    concealment: 0,
    confidence,
    socialStance,
    relationshipContext: "scene",
    physicalCondition,
    mask: "none",
    isMajorBeat,
  };
}

function coarseInputFromPose(pose = {}) {
  const expression = String(pose.expression || "neutral").trim().toLowerCase();
  const stance = String(pose.pose || "").trim().toLowerCase();
  const emotion = normalizeEmotion(expression);
  let intensity = 0.5;
  let composure = 1;
  let socialStance = "neutral";
  if (emotion === "anger") { intensity = 0.7; composure = 0.4; socialStance = "aggressive"; }
  else if (emotion === "sadness") { intensity = 0.6; composure = 0.6; }
  else if (emotion === "joy") { intensity = 0.6; composure = 0.85; }
  else if (emotion === "surprise") { intensity = 0.85; composure = 0.5; }
  if (stance === "tense") socialStance = "tense";
  else if (stance === "downcast") socialStance = "submissive";
  return {
    internalEmotion: emotion,
    visibleEmotion: emotion,
    intensity,
    composure,
    concealment: 0,
    confidence: 0.6,
    socialStance,
    relationshipContext: "scene",
    physicalCondition: "none",
    mask: "none",
    isMajorBeat: false,
  };
}

function findCharacterContainers(name) {
  const key = String(name || "").trim().toLowerCase();
  const nodes = Array.from(document.querySelectorAll(".vn-character"));
  return nodes.filter((node) => {
    const id = String(node.dataset.characterId || node.getAttribute("data-character-id") || "").trim().toLowerCase();
    return !key || id === key;
  });
}

function applyToContainer(node, expressionKey) {
  node.dataset.expression = expressionKey;
  const engine = node.__uieVnCharacterEngine;
  if (engine && typeof engine.updateState === "function") {
    engine.updateState({ currentExpression: expressionKey });
  }
}

function dispatchExpressionEvent(name, result) {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("uie:expression", {
      detail: {
        name,
        selectedExpression: result.selectedExpression,
        changeRequired: result.changeRequired,
        temporary: result.temporary,
        returnExpression: result.returnExpression,
        reason: result.reason,
        confidence: result.confidence,
      },
    }));
  }
}

export function applySpeakerExpression(name, speakerState, { container } = {}) {
  const input = mapSpeakerStateToInput(speakerState);
  const result = director.evaluate(name, input);
  const targets = container ? [container] : findCharacterContainers(name);
  for (const node of targets) {
    applyToContainer(node, result.selectedExpression);
    if (node.__uieVnCharacterEngine && !name) {
      const id = node.dataset.characterId || node.getAttribute("data-character-id");
      if (id) director.getState(id);
    }
  }
  if (!container) dispatchExpressionEvent(name, result);
  return result;
}

export function applyCoarseExpression(name, pose) {
  const input = coarseInputFromPose(pose);
  const result = director.evaluate(name, input);
  for (const node of findCharacterContainers(name)) applyToContainer(node, result.selectedExpression);
  dispatchExpressionEvent(name, result);
  return result;
}

export function applySceneReaction(event) {
  if (!event || !Array.isArray(event.affects)) return [];
  const results = [];
  for (const name of event.affects) {
    const result = director.reactToEvent(name, event);
    for (const node of findCharacterContainers(name)) applyToContainer(node, result.selectedExpression);
    dispatchExpressionEvent(name, result);
    results.push({ name, ...result });
  }
  return results;
}

export function applyResponseStaticExpressions(raw, fallbackText = "") {
  let data = raw;
  if (typeof raw === "string") {
    try { data = JSON.parse(raw); } catch (_) { data = {}; }
  }
  data = data && typeof data === "object" ? data : {};
  const characterStates = data.character_states && typeof data.character_states === "object" ? data.character_states : null;

  if (characterStates) {
    const out = [];
    for (const [name, semanticInput] of Object.entries(characterStates)) {
      const result = director.evaluate(name, semanticInput && typeof semanticInput === "object" ? semanticInput : {});
      const isSpeaking = !!(semanticInput && semanticInput.speaking);
      for (const node of findCharacterContainers(name)) applyToContainer(node, result.selectedExpression);
      dispatchExpressionEvent(name, result);
      out.push({ name, speaking: isSpeaking, ...result });
    }
    return out;
  }

  const nodes = findCharacterContainers("");
  if (!nodes.length) return [];
  const pose = data.visual_triggers && data.visual_triggers.standalone_sprite_pose
    ? { pose: data.visual_triggers.standalone_sprite_pose, expression: data.visual_triggers.expression || "neutral" }
    : { pose: "neutral", expression: "neutral" };
  const out = [];
  for (const node of nodes) {
    const id = node.dataset.characterId || node.getAttribute("data-character-id") || "";
    const result = director.evaluate(id, coarseInputFromPose(pose));
    applyToContainer(node, result.selectedExpression);
    dispatchExpressionEvent(id, result);
    out.push({ name: id, ...result });
  }
  return out;
}

export function getDirector() {
  return director;
}

export function configureExpressionEngine(config = {}, resolverOpts = null) {
  director = new ExpressionDirector(config, resolverOpts ? new ExpressionResolver(resolverOpts) : resolver);
  resolver = director.resolver;
  return director;
}

export const EXPRESSION_ENGINE_CATEGORY = EXPRESSION_CATEGORIES;

if (typeof window !== "undefined") {
  window.UIEExpressionBridge = {
    applySpeakerExpression,
    applyCoarseExpression,
    applySceneReaction,
    applyResponseStaticExpressions,
    mapSpeakerStateToInput,
    getDirector,
    configureExpressionEngine,
  };
}
