// Character Sprite Controller
// ---------------------------------------------------------------------------
// The character-sprite layer's animation track. In this engine that layer is
// rendered by Live2D (Cubism) when enabled, so this controller forwards the
// SAME semantic speaker state that drives the dialogue box into the VN
// Animation Bridge, which owns the Live2DAnimator + AnimationDirector.
//
// This keeps chat-box (dialogue box) and character-sprite (Live2D) as two
// INDEPENDENT layers that are nonetheless fed from one coherent semantic state,
// so the character's expression/motion and the dialogue box stay in sync
// without being coupled to each other's rendering.
//
// If Live2D is disabled or no model is loaded, the bridge simply declines to
// forward to the animator — the pipeline stays alive and harmless.
// ---------------------------------------------------------------------------

import { vnAnimationBridge } from "../vnAnimationBridge.js";

function clamp01(v, dflt = 0) {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(0, Math.min(1, n));
}

export class CharacterSpriteController {
    constructor(bridge = vnAnimationBridge) {
        this.bridge = bridge;
    }

    // Map a normalized semantic speaker state onto a bridge dialogue event so
    // the Director can decide the Live2D expression/motion (or decline).
    playCharacterAnimation(state = {}) {
        if (!this.bridge || typeof this.bridge.processDialogue !== "function") return null;
        const intensity = clamp01(state.emotionalIntensity, 0.4);
        const importance = clamp01(
            Math.max(
                intensity * 0.6,
                state.interruption ? 0.7 : 0,
                state.physicalAction ? 0.6 : 0,
                (state.hostility || 0) * 0.5,
                (state.fear || 0) * 0.5,
            ),
            0.1,
        );
        try {
            return this.bridge.processDialogue({
                speaker: state.speakerId ?? state.speaker ?? null,
                emotion: state.emotion || "neutral",
                composure: state.composure,
                physicalAction: !!state.physicalAction,
                interruption: !!state.interruption,
                narrativeImportance: importance,
                narrativeBeat: "dialogue",
                // Remember the last emotion so a static hold uses it.
                motionHint: state.motionHint,
            });
        } catch (_) {
            return null;
        }
    }

    // Hold a static expression when the scene is idle (breathing/blink).
    applyStatic(emotion = "neutral") {
        try { return this.bridge?.applyStaticExpression?.(emotion); } catch (_) { return null; }
    }

    setLive2DEnabled(on) {
        try { return this.bridge?.setLive2DEnabled?.(on); } catch (_) { return null; }
    }

    reset() {
        try { this.bridge?.reset?.(); } catch (_) {}
    }
}

export const characterSpriteController = new CharacterSpriteController();
