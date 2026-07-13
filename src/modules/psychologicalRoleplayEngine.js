/* Deterministic, client-side adapter for Math-First VN responses. */
import { applyResponseStaticExpressions } from "./expressionBridge.js";
const BLOCKED = /\bnana\b/ig;
const clamp = (value, fallback = 0) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : fallback));
const EFFECTS = new Set(["none", "tremble", "glitch", "blur_dissolve"]);
const PROFILES = {
  praise: { weight: .72, volatility: .72 }, comfort: { weight: .48, volatility: .45 },
  challenge: { weight: .63, volatility: .62 }, control: { weight: .66, volatility: .70 },
  intimacy: { weight: .58, volatility: .58 }, conflict: { weight: .76, volatility: .75 }
};

export const READY_MACROS = Object.freeze([
  { label: "Observe", command: "Observe the immediate situation and respond to the most important visible change.", icon: "fa-eye" },
  { label: "Ask directly", command: "Ask one clear, grounded question about what matters right now.", icon: "fa-comment-dots" },
  { label: "Offer support", command: "Offer practical support without assuming anyone's feelings or choices.", icon: "fa-hand-holding-heart" },
  { label: "Set a boundary", command: "State a calm, specific boundary and leave room for a response.", icon: "fa-shield-heart" },
  { label: "Change approach", command: "Pause, reassess the context, and try a safer constructive approach.", icon: "fa-arrows-rotate" },
  { label: "Advance scene", command: "Advance to the next plausible beat, preserving established positions and agency.", icon: "fa-forward" }
]);

export function calculateState(action = {}, previous = {}) {
  const type = String(action.stimulusType || action.type || "comfort").toLowerCase();
  const profile = PROFILES[type] || PROFILES.comfort;
  const Sin = clamp(action.intensity, .45);
  const omega = clamp(Sin * profile.weight * profile.volatility);
  const willpower = clamp(clamp(previous.W_willpower, .72) * Math.exp(-omega));
  return { incoming_stimulus_type: type, Sin_intensity: Sin, Omega_t_targeted_obsession: omega, Dx_dissonance: clamp(action.dissonance, omega * .7), W_willpower: willpower };
}

function safeText(value) { return String(value || "").replace(BLOCKED, "").replace(/\s{2,}/g, " ").trim(); }
function inferEffect(text) {
  const source = safeText(text).toLowerCase();
  if (/\b(static|fracture|glitch|flicker)\b/.test(source)) return "glitch";
  if (/\b(trembl|shak|stammer|unsteady)\b/.test(source)) return "tremble";
  if (/\b(blur|fade|dissolv|dizzy)\b/.test(source)) return "blur_dissolve";
  return "none";
}
function normalizePose(raw = "") {
  const value = String(raw).toLowerCase();
  if (/angry|tense|challenge|fight/.test(value)) return { pose: "tense", expression: "angry" };
  if (/sad|hurt|tear|withdraw/.test(value)) return { pose: "downcast", expression: "sad" };
  if (/happy|relief|smile|praise/.test(value)) return { pose: "open", expression: "happy" };
  if (/shock|surprise|alarm/.test(value)) return { pose: "startled", expression: "surprised" };
  return { pose: "neutral", expression: "neutral" };
}
export function normalizeEngineResponse(raw, fallbackText = "") {
  let data = raw;
  if (typeof raw === "string") { try { data = JSON.parse(raw); } catch (_) { data = {}; } }
  data = data && typeof data === "object" ? data : {};
  const matrix = data.state_matrix && typeof data.state_matrix === "object" ? data.state_matrix : calculateState({});
  const visual = data.visual_triggers && typeof data.visual_triggers === "object" ? data.visual_triggers : {};
  const text = [data.dialogue, data.narration, data.internal_monologue, fallbackText].map(safeText).filter(Boolean).join(" ");
  const effect = EFFECTS.has(data.css_text_effect) ? data.css_text_effect : inferEffect(text);
  const pose = normalizePose(visual.standalone_sprite_pose || text);
  return { state_matrix: matrix, visual_triggers: { ...visual, standalone_sprite_pose: safeText(visual.standalone_sprite_pose || pose.pose) }, css_text_effect: effect, text, pose };
}
export function applyResponseVisuals(raw, fallbackText = "") {
  const response = normalizeEngineResponse(raw, fallbackText);
  const effect = response.css_text_effect;
  document.documentElement.dataset.uieTextEffect = effect;
  document.body.dataset.uieTextEffect = effect;
  document.querySelectorAll(".uie-dialogue-text, .mes_text, .message-text").forEach((node) => {
    node.classList.remove("uie-effect-tremble", "uie-effect-glitch", "uie-effect-blur-dissolve");
    if (effect !== "none") node.classList.add(`uie-effect-${effect.replace(/_/g, "-")}`);
  });
  document.querySelectorAll(".vn-character").forEach((node) => {
    node.dataset.pose = response.pose.pose;
    node.classList.remove("uie-pose-transition"); requestAnimationFrame(() => node.classList.add("uie-pose-transition"));
    const engine = node.__uieVnCharacterEngine;
    if (engine?.updateState) engine.updateState({ currentPose: response.pose.pose });
  });
  applyResponseStaticExpressions(raw, fallbackText);
  window.dispatchEvent(new CustomEvent("uie:response-visuals", { detail: response }));
  return response;
}
export function initPsychologicalRoleplayEngine() {
  if (window.UIEPsychologicalRoleplayEngine) return;
  window.UIEPsychologicalRoleplayEngine = { calculateState, normalizeEngineResponse, applyResponseVisuals, READY_MACROS };
  window.addEventListener("uie:response-visuals", (event) => {
    const effect = event.detail?.css_text_effect;
    if (!window.UIEEffects?.runSceneMacro) return;
    if (effect === "glitch") window.UIEEffects.runSceneMacro("GLITCH");
    else if (effect === "tremble") window.UIEEffects.runSceneMacro("SHAKE", "light");
    else if (effect === "blur_dissolve") window.UIEEffects.runSceneMacro("FOG");
  });
  const observer = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
    if (node.nodeType !== 1) return;
    const text = String(node.innerText || node.textContent || "").trim();
    if (!text || text.length < 3 || text.length > 12000) return;
    if (text.includes("state_matrix") || node.matches?.(".mes, .message, .chat-message, .uie-dialogue-card")) applyResponseVisuals(text, text);
  })));
  observer.observe(document.body, { childList: true, subtree: true });
}
