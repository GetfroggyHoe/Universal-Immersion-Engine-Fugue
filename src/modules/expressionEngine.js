export const EXPRESSION_CATEGORIES = Object.freeze({
  BASE: "base",
  SUSTAINED: "sustained",
  REACTION: "reaction",
  MICRO: "micro",
  MASK: "mask",
  PHYSICAL: "physical",
});

export const EXPRESSIONS = Object.freeze({
  neutral: EXPRESSION_CATEGORIES.BASE,
  relaxed: EXPRESSION_CATEGORIES.BASE,
  guarded: EXPRESSION_CATEGORIES.BASE,
  neutral_tense: EXPRESSION_CATEGORIES.BASE,
  amused: EXPRESSION_CATEGORIES.SUSTAINED,
  restrained_amusement: EXPRESSION_CATEGORIES.SUSTAINED,
  irritated: EXPRESSION_CATEGORIES.SUSTAINED,
  controlled_anger: EXPRESSION_CATEGORIES.SUSTAINED,
  open_anger: EXPRESSION_CATEGORIES.SUSTAINED,
  worried: EXPRESSION_CATEGORIES.SUSTAINED,
  frightened: EXPRESSION_CATEGORIES.SUSTAINED,
  sad: EXPRESSION_CATEGORIES.SUSTAINED,
  exhausted: EXPRESSION_CATEGORIES.PHYSICAL,
  suspicious: EXPRESSION_CATEGORIES.SUSTAINED,
  confused: EXPRESSION_CATEGORIES.SUSTAINED,
  surprised: EXPRESSION_CATEGORIES.SUSTAINED,
  fake_smile: EXPRESSION_CATEGORIES.MASK,
  polite_smile: EXPRESSION_CATEGORIES.MASK,
  forced_calm: EXPRESSION_CATEGORIES.MASK,
  emotionally_withdrawn: EXPRESSION_CATEGORIES.SUSTAINED,
});

export const EXPRESSION_CATALOG = Object.freeze(
  Object.keys(EXPRESSIONS).reduce((groups, key) => {
    const cat = EXPRESSIONS[key];
    (groups[cat] = groups[cat] || []).push(key);
    return groups;
  }, {})
);

export const EMOTION_FAMILIES = Object.freeze({
  neutral: "neutral",
  calm: "neutral",
  composed: "neutral",
  relaxed: "neutral",
  anger: "anger",
  irritation: "anger",
  irritated: "anger",
  frustration: "anger",
  frustrated: "anger",
  contempt: "anger",
  disgust: "anger",
  amusement: "joy",
  amused: "joy",
  joy: "joy",
  happy: "joy",
  happiness: "joy",
  contentment: "joy",
  relief: "joy",
  fear: "fear",
  afraid: "fear",
  frightened: "fear",
  fright: "fear",
  anxiety: "fear",
  anxious: "fear",
  nervous: "fear",
  nervousness: "fear",
  worry: "fear",
  worried: "fear",
  sad: "sadness",
  sadness: "sadness",
  grief: "sadness",
  shame: "sadness",
  guilt: "sadness",
  remorse: "sadness",
  disappointment: "sadness",
  suspicion: "suspicion",
  suspicious: "suspicion",
  distrust: "suspicion",
  wariness: "suspicion",
  wary: "suspicion",
  confused: "confusion",
  confusion: "confusion",
  doubt: "confusion",
  uncertainty: "confusion",
  surprise: "surprise",
  shocked: "surprise",
  shock: "surprise",
  realization: "surprise",
  astonished: "surprise",
  anticipation: "neutral",
  curiosity: "neutral",
  trust: "neutral",
  embarrassed: "sadness",
  embarrassment: "sadness",
});

export const DEFAULT_CONFIG = Object.freeze({
  minEmotionDelta: 0.3,
  minConfidence: 0.55,
  minComposureDrop: 0.25,
  minIntensityShift: 0.3,
  minStableLines: 2,
  reactionIntensityThreshold: 0.6,
  relationshipBeatWeight: 0.5,
  listeningReactionThreshold: 0.6,
  strongReactionRelax: 0.6,
});

const FORBIDDEN_INPUT_KEYS = [
  "image", "images", "img", "path", "paths", "url", "src", "href",
  "asset", "assets", "css", "cssclass", "css_class", "sheet", "spritesheet",
  "sprite_sheet", "coordinates", "coords", "filename", "file", "dataurl",
  "data_url", "class", "style",
];

function clamp01(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function num(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function emotionFamily(emotion) {
  const key = String(emotion || "neutral").trim().toLowerCase();
  return EMOTION_FAMILIES[key] || "neutral";
}

function emotionDistance(a, b) {
  const fa = emotionFamily(a);
  const fb = emotionFamily(b);
  if (fa === fb) return 0;
  const neutral = "neutral";
  if (fa === neutral || fb === neutral) return 0.5;
  return 1;
}

function assertSemanticOnly(input, label) {
  if (!input || typeof input !== "object") return;
  for (const raw of Object.keys(input)) {
    const key = String(raw).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (FORBIDDEN_INPUT_KEYS.includes(key)) {
      throw new Error(
        `Expression input must carry semantic state only (${label || "input"}); rejected field "${raw}" which looks like an asset reference.`
      );
    }
  }
}

function stableFromVisible(visibleEmotion, ctx) {
  const { intensity, composure, concealment, socialStance } = ctx;
  const fam = emotionFamily(visibleEmotion);
  switch (fam) {
    case "anger":
      if (composure >= 0.7) return expr("controlled_anger", EXPRESSION_CATEGORIES.SUSTAINED, 0.9, "anger_controlled");
      if (composure <= 0.35) return expr("open_anger", EXPRESSION_CATEGORIES.SUSTAINED, 0.9, "anger_open");
      return expr("irritated", EXPRESSION_CATEGORIES.SUSTAINED, 0.8, "anger_mild");
    case "joy":
      if (socialStance === "guarded" || concealment >= 0.5) {
        return expr("restrained_amusement", EXPRESSION_CATEGORIES.SUSTAINED, 0.8, "amusement_restrained");
      }
      return expr("amused", EXPRESSION_CATEGORIES.SUSTAINED, 0.85, "amusement");
    case "fear":
      if (composure <= 0.4 && intensity >= 0.6) {
        return expr("frightened", EXPRESSION_CATEGORIES.SUSTAINED, 0.85, "fear_strong");
      }
      return expr("worried", EXPRESSION_CATEGORIES.SUSTAINED, 0.8, "fear_mild");
    case "sadness":
      return expr("sad", EXPRESSION_CATEGORIES.SUSTAINED, 0.85, "sadness");
    case "suspicion":
      return expr("suspicious", EXPRESSION_CATEGORIES.SUSTAINED, 0.85, "suspicion");
    case "confusion":
      return expr("confused", EXPRESSION_CATEGORIES.SUSTAINED, 0.8, "confusion");
    case "surprise":
      return expr("surprised", EXPRESSION_CATEGORIES.SUSTAINED, 0.7, "surprise");
    case "neutral":
    default:
      if (socialStance === "guarded") return expr("guarded", EXPRESSION_CATEGORIES.BASE, 0.8, "neutral_guarded");
      if (socialStance === "tense" || (intensity >= 0.5 && composure <= 0.6)) {
        return expr("neutral_tense", EXPRESSION_CATEGORIES.BASE, 0.8, "neutral_tense");
      }
      if (socialStance === "relaxed" || (composure >= 0.9 && intensity <= 0.3)) {
        return expr("relaxed", EXPRESSION_CATEGORIES.BASE, 0.8, "neutral_relaxed");
      }
      if (concealment >= 0.6 && (socialStance === "distant" || socialStance === "polite")) {
        return expr("emotionally_withdrawn", EXPRESSION_CATEGORIES.SUSTAINED, 0.8, "withdrawn");
      }
      return expr("neutral", EXPRESSION_CATEGORIES.BASE, 0.9, "neutral");
  }
}

function expr(key, category, confidence, reason) {
  return {
    key,
    category,
    confidence,
    reason,
    temporary: false,
    duration: 0,
    returnExpression: null,
  };
}

function isStrongSurprise(visibleEmotion) {
  const e = String(visibleEmotion || "").trim().toLowerCase();
  return e === "surprise" || e === "shocked" || e === "shock" || e === "realization" || e === "astonished";
}

function isStrongReaction(input, cfg) {
  const intensity = num(input.intensity, 0.5);
  if (input.isMajorBeat && intensity >= cfg.reactionIntensityThreshold) return true;
  if (isStrongSurprise(input.visibleEmotion) && intensity >= cfg.reactionIntensityThreshold) return true;
  return false;
}

function chooseExpression(input, cfg) {
  const visibleEmotion = input.visibleEmotion || "neutral";
  const intensity = num(input.intensity, 0.5);
  const composure = num(input.composure, 1);
  const concealment = num(input.concealment, 0);
  const confidence = num(input.confidence, 1);
  const socialStance = input.socialStance || "neutral";
  const physicalCondition = input.physicalCondition || "none";
  const mask = input.mask || "none";

  if (physicalCondition && physicalCondition !== "none") {
    return expr(physicalCondition, EXPRESSION_CATEGORIES.PHYSICAL, 0.9, "physical_condition");
  }

  if (mask && mask !== "none") {
    return expr(mask, EXPRESSION_CATEGORIES.MASK, 0.85, "social_mask");
  }

  if (isStrongSurprise(visibleEmotion) && intensity >= cfg.reactionIntensityThreshold && !input.isMajorBeat) {
    return {
      key: visibleEmotion === "frightened" || visibleEmotion === "fright" ? "frightened" : "surprised",
      category: EXPRESSION_CATEGORIES.MICRO,
      confidence: clamp01(0.6 + intensity * 0.4),
      reason: "micro_reaction",
      temporary: true,
      duration: 1,
      returnExpression: null,
    };
  }

  if (isStrongSurprise(visibleEmotion) && input.isMajorBeat) {
    return expr("surprised", EXPRESSION_CATEGORIES.REACTION, clamp01(0.6 + intensity * 0.4), "major_reaction");
  }

  return stableFromVisible(visibleEmotion, { intensity, composure, concealment, socialStance });
}

function visibleSignature(input) {
  return [
    input.visibleEmotion || "neutral",
    input.socialStance || "neutral",
    input.physicalCondition && input.physicalCondition !== "none" ? input.physicalCondition : "",
    input.mask && input.mask !== "none" ? input.mask : "",
  ].join("|");
}

function stanceAffectsPresentation(stance) {
  return stance === "guarded" || stance === "tense" || stance === "relaxed" || stance === "aggressive" || stance === "distant";
}

export class ExpressionResolver {
  constructor(opts = {}) {
    this.approvedAssets = opts.approvedAssets && typeof opts.approvedAssets === "object" ? opts.approvedAssets : null;
    this.fallback = opts.fallback || "neutral";
  }

  _asset(key) {
    if (!this.approvedAssets) return key;
    if (Object.prototype.hasOwnProperty.call(this.approvedAssets, key)) return this.approvedAssets[key];
    return key;
  }

  resolve(decision) {
    const expressionKey = decision.expressionKey || "neutral";
    const returnExpression = decision.returnExpression || null;
    return {
      selectedExpression: this._asset(expressionKey),
      changeRequired: !!decision.changeRequired,
      confidence: clamp01(typeof decision.confidence === "number" ? decision.confidence : 1),
      reason: decision.reason || "keep",
      temporary: !!decision.temporary,
      fallbackExpression: this._asset(this.fallback),
      returnExpression: returnExpression ? this._asset(returnExpression) : null,
    };
  }
}

export function createDefaultCharacterExpressionState(name) {
  return {
    name: String(name || ""),
    internalEmotion: "neutral",
    visibleEmotion: "neutral",
    emotionalIntensity: 0.5,
    composure: 1,
    concealment: 0,
    confidence: 1,
    socialStance: "neutral",
    relationshipContext: "baseline",
    physicalCondition: "none",
    mask: "none",
    currentExpression: "neutral",
    previousExpression: null,
    linesSinceLastChange: 0,
    majorBeat: false,
    temporary: null,
    lastSignature: "neutral|neutral||",
  };
}

export class ExpressionDirector {
  constructor(config = {}, resolver = null) {
    this.config = { ...DEFAULT_CONFIG, ...(config && typeof config === "object" ? config : {}) };
    this.resolver = resolver instanceof ExpressionResolver
      ? resolver
      : new ExpressionResolver(resolver && typeof resolver === "object" ? resolver : {});
    this.states = new Map();
  }

  getState(name) {
    const key = String(name || "").trim().toLowerCase();
    const state = this.states.get(key);
    return state ? { ...state } : null;
  }

  registerCharacter(name, initialState = {}) {
    const key = String(name || "").trim().toLowerCase();
    const base = createDefaultCharacterExpressionState(name);
    const merged = { ...base, ...(initialState && typeof initialState === "object" ? initialState : {}) };
    if (!EXPRESSIONS[merged.currentExpression]) merged.currentExpression = "neutral";
    this.states.set(key, merged);
    return { ...merged };
  }

  _ensure(name) {
    const key = String(name || "").trim().toLowerCase();
    let state = this.states.get(key);
    if (!state) {
      state = createDefaultCharacterExpressionState(name);
      this.states.set(key, state);
    }
    return state;
  }

  _applyExpression(state, key, candidate) {
    state.previousExpression = state.currentExpression;
    state.currentExpression = key;
    state.linesSinceLastChange = 0;
    state.temporary = candidate && candidate.temporary
      ? { expression: key, remainingLines: candidate.duration || 1, returnExpression: candidate.returnExpression || state.previousExpression || "neutral" }
      : null;
  }

  _keep(state, key, reason) {
    return this.resolver.resolve({
      expressionKey: key,
      changeRequired: false,
      confidence: 1,
      reason,
      temporary: !!(state.temporary && state.temporary.expression === key),
      returnExpression: state.temporary ? state.temporary.returnExpression : null,
    });
  }

  _change(state, key, reason, confidence) {
    return this.resolver.resolve({
      expressionKey: key,
      changeRequired: true,
      confidence,
      reason,
      temporary: !!(state.temporary && state.temporary.expression === key),
      returnExpression: state.temporary ? state.temporary.returnExpression : null,
    });
  }

  _decideChange(state, candidate, input, prevSignature) {
    const cfg = this.config;
    const reasons = [];
    let change = false;

    const oldVisible = state.visibleEmotion;
    const oldComposure = state.composure;
    const oldStance = state.socialStance;
    const oldPhysical = state.physicalCondition;
    const oldMask = state.mask;
    const oldRel = state.relationshipContext;
    const oldLines = state.linesSinceLastChange;

    const emotionDelta = emotionDistance(oldVisible, input.visibleEmotion);
    const intensityShift = Math.abs(state.emotionalIntensity - num(input.intensity, 0.5));
    const composureDrop = oldComposure - num(input.composure, 1);
    const stanceChanged = oldStance !== (input.socialStance || "neutral");
    const physicalChanged = oldPhysical !== (input.physicalCondition || "none");
    const maskChanged = oldMask !== (input.mask || "none");
    const relBeat = input.relationshipContext && input.relationshipContext !== oldRel;
    const relWeight = num(input.relationshipWeight, 0);

    if (input.isMajorBeat && isStrongReaction(input, cfg) && (emotionDelta >= cfg.minEmotionDelta * cfg.strongReactionRelax || state.linesSinceLastChange < cfg.minStableLines)) {
      change = true;
      reasons.push("major_reaction");
    }

    if (visibleSignature(input) !== prevSignature && emotionDelta >= cfg.minEmotionDelta && candidate.confidence >= cfg.minConfidence) {
      change = true;
      reasons.push("visible_emotion_shift");
    }

    if (composureDrop >= cfg.minComposureDrop && emotionDelta >= cfg.minEmotionDelta * 0.5) {
      change = true;
      reasons.push("composure_loss");
    }

    if (maskChanged && (input.mask || "none") !== "none") {
      change = true;
      reasons.push("social_mask");
    }

    if (stanceChanged && stanceAffectsPresentation(input.socialStance || "neutral") && emotionDelta >= cfg.minEmotionDelta * 0.5) {
      change = true;
      reasons.push("stance_change");
    }

    if (intensityShift >= cfg.minIntensityShift && candidate.key !== state.currentExpression) {
      change = true;
      reasons.push("intensity_shift");
    }

    if (physicalChanged && (input.physicalCondition || "none") !== "none") {
      change = true;
      reasons.push("physical_change");
    }

    if (relBeat && relWeight >= cfg.relationshipBeatWeight) {
      change = true;
      reasons.push("relationship_beat");
    }

    if (change && !input.isMajorBeat && oldLines < cfg.minStableLines && state.previousExpression !== null && !candidate.temporary && candidate.category !== EXPRESSION_CATEGORIES.REACTION) {
      const deliberate = ["social_mask", "physical_change", "relationship_beat"];
      if (!deliberate.includes(reasons[0])) {
        change = false;
        reasons.length = 0;
        reasons.push("too_recent");
      }
    }

    return { change, reason: reasons[0] || "below_threshold" };
  }

  evaluate(name, input = {}) {
    assertSemanticOnly(input, "evaluate");
    const state = this._ensure(name);
    const cfg = this.config;
    const candidate = chooseExpression(input, cfg);
    const prevSignature = state.lastSignature;

    const activeTemp = state.temporary && state.temporary.expression;
    const override = !!(activeTemp && input.isMajorBeat && isStrongReaction(input, cfg));

    if (activeTemp && !override) {
      if (state.temporary.remainingLines > 0) {
        state.temporary.remainingLines -= 1;
        state.linesSinceLastChange += 1;
        return this._keep(state, state.temporary.expression, "temporary_hold");
      }
      const ret = state.temporary.returnExpression || state.previousExpression || "neutral";
      state.temporary = null;
      this._applyExpression(state, ret, null);
      return this._change(state, ret, "temporary_revert", 0.9);
    }

    if (activeTemp && override) {
      state.temporary = null;
    }

    const { change, reason } = this._decideChange(state, candidate, input, prevSignature);

    if (candidate.key === state.currentExpression) {
      this._recordState(state, input);
      state.linesSinceLastChange += 1;
      return this._keep(state, candidate.key, "current_fits");
    }

    if (change) {
      this._recordState(state, input);
      this._applyExpression(state, candidate.key, candidate);
      return this._change(state, candidate.key, reason, candidate.confidence);
    }

    this._recordState(state, input);
    state.linesSinceLastChange += 1;
    return this._keep(state, state.currentExpression, reason);
  }

  _recordState(state, input) {
    state.internalEmotion = input.internalEmotion || input.visibleEmotion || state.internalEmotion;
    state.visibleEmotion = input.visibleEmotion || "neutral";
    state.emotionalIntensity = num(input.intensity, 0.5);
    state.composure = num(input.composure, 1);
    state.concealment = num(input.concealment, 0);
    state.confidence = num(input.confidence, 1);
    state.socialStance = input.socialStance || "neutral";
    state.relationshipContext = input.relationshipContext || state.relationshipContext;
    state.physicalCondition = input.physicalCondition || "none";
    state.mask = input.mask || "none";
    state.majorBeat = !!input.isMajorBeat;
    state.lastSignature = visibleSignature(input);
  }

  reactToEvent(name, event = {}) {
    assertSemanticOnly(event, "reactToEvent");
    const state = this._ensure(name);
    const affects = Array.isArray(event.affects) ? event.affects.map((n) => String(n).toLowerCase()) : [];
    const key = String(name || "").trim().toLowerCase();

    if (!affects.includes(key)) {
      return this._keep(state, state.currentExpression, "unaffected");
    }

    const impact = num(event.emotionalImpact, 0);
    if (impact < this.config.listeningReactionThreshold) {
      return this._keep(state, state.currentExpression, "low_impact");
    }

    const reactionEmotion = event.emotion || "surprised";
    const candidate = chooseExpression(
      {
        visibleEmotion: reactionEmotion,
        internalEmotion: reactionEmotion,
        intensity: Math.max(this.config.reactionIntensityThreshold, impact),
        composure: state.composure,
        concealment: 0,
        socialStance: state.socialStance,
        physicalCondition: "none",
        mask: "none",
        isMajorBeat: !!event.isMajorBeat,
      },
      this.config
    );

    if (candidate.key === state.currentExpression) {
      return this._keep(state, candidate.key, "current_fits");
    }

    this._applyExpression(state, candidate.key, candidate);
    return this._change(state, candidate.key, "listening_reaction", candidate.confidence);
  }

  reset(name) {
    const key = String(name || "").trim().toLowerCase();
    this.states.delete(key);
  }
}

export function createExpressionDirector(config = {}, resolver = null) {
  return new ExpressionDirector(config, resolver);
}

if (typeof window !== "undefined") {
  window.ExpressionDirector = ExpressionDirector;
  window.ExpressionResolver = ExpressionResolver;
  window.EXPRESSION_CATEGORIES = EXPRESSION_CATEGORIES;
  window.EXPRESSIONS = EXPRESSIONS;
  window.EXPRESSION_CATALOG = EXPRESSION_CATALOG;
}
