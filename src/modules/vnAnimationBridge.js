// VN Animation Bridge
// ---------------------------------------------------------------------------
// Thin integration layer between the narrative flow and the Animation
// Director + Live2D animator. Keeps the Director as the final authority and
// never throws into the gameplay/narrative pipeline.
//
// Usage (from world.js updateFromChat):
//   import { vnAnimationBridge } from "./vnAnimationBridge.js";
//   vnAnimationBridge.processDialogue({ speaker, emotion, physicalAction, ... });
//
// The bridge:
//   1. builds a semantic narrative event from dialogue data,
//   2. lets the AnimationDirector decide (or decline) an animation,
//   3. forwards the semantic directive to the Live2D animator (if wired),
//   4. emits a DOM CustomEvent ("uie-animation-directive") so a CSS/WebGL
//      renderer can translate the directive into real playback.
// It does NOT pick CSS classes itself — that is the renderer's job.
// ---------------------------------------------------------------------------

import { AnimationDirector, DecisionLevel, Tone } from "./animationDirector.js";
import { Live2DAnimator, MotionPriority, createNoOpModel } from "./live2dAnimator.js";

class VNAnimationBridge {
    constructor() {
        this.director = new AnimationDirector();
        this.animator = new Live2DAnimator({ model: createNoOpModel() });
        this.enabled = true;          // master switch (full pipeline)
        this.live2dEnabled = false;   // opt-in: gates only the Live2D expression/motion track
        this._lastRawSpeaker = null;
    }

    // Master switch — fully enables/disables animation processing.
    setEnabled(on) { this.enabled = !!on; return this; }

    // Live2D-specific switch (driven by the Live2D settings option). Disabling
    // this still lets the Director emit semantic directives for CSS/WebGL
    // renderers; it only stops forwarding to the Live2D animator.
    setLive2DEnabled(on) { this.live2dEnabled = !!on; return this; }

    // Optionally attach a real Live2D model (Cubism SDK instance / adapter).
    attachLive2DModel(model) {
        this.animator.setModel(model);
        return this;
    }

    // Forward the Cubism motion group (model-specific) from the settings card.
    setMotionGroup(group) {
        if (typeof this.animator.setMotionGroup === "function") this.animator.setMotionGroup(group);
        return this;
    }

    setTone(tone) {
        if (tone && Tone[tone.toUpperCase()] !== undefined) {
            this.director.applyTonePreset(Tone[tone.toUpperCase()]);
        }
        return this.director.rhythm;
    }

    setRhythm(rhythm = {}) {
        return this.director.setSceneRhythm(rhythm);
    }

    // Build a semantic event from dialogue data and let the Director decide.
    processDialogue(data = {}) {
        if (!this.enabled) return null;
        const event = {
            type: "dialogue_line",
            speaker: data.speaker ?? null,
            emotion: data.emotion ?? "neutral",
            composure: data.composure,
            physicalAction: !!data.physicalAction,
            interruption: !!data.interruption,
            environmentChange: !!data.environmentChange,
            atmospheric: !!data.atmospheric,
            sceneTransition: !!data.sceneTransition,
            weather: !!data.weather,
            lighting: !!data.lighting,
            entrance: !!data.entrance,
            exit: !!data.exit,
            narrativeImportance: Number(data.narrativeImportance) || 0,
            narrativeBeat: data.narrativeBeat ?? null,
            motionHint: data.motionHint,
            durationMs: data.durationMs ?? null,
        };

        const directive = this.director.ingest(event);
        if (!directive) return null;

        // Forward to Live2D (expression/motion tracks) only when enabled.
        if (this.live2dEnabled) this.animator.handleDirective(directive);

        // Emit a semantic directive for any renderer (CSS/WebGL) to consume.
        if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
            try {
                window.dispatchEvent(new CustomEvent("uie-animation-directive", {
                    detail: { directive, event },
                }));
            } catch (_) {}
        }
        return directive;
    }

    // Called when the scene is idle/static to keep characters alive.
    applyStaticExpression(emotion = "neutral") {
        if (!this.enabled) return null;
        return this.animator.applyStaticExpression(emotion);
    }

    reset() {
        this.director.reset();
        this.animator.stop();
        this._lastRawSpeaker = null;
    }
}

export const vnAnimationBridge = new VNAnimationBridge();
try { window.UIE_vnAnimationBridge = vnAnimationBridge; } catch (_) {}
export { AnimationDirector, Live2DAnimator, DecisionLevel, Tone, MotionPriority };
export default vnAnimationBridge;
