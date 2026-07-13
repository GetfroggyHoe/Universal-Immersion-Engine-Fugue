// Dialogue Animation Controller
// ---------------------------------------------------------------------------
// Owns the DIALOGUE BOX layer. It treats the dialogue box as an extension of
// the current speaker's delivery — never as the environment. It:
//   - tracks per-speaker state to derive continuation / emotion-change flags,
//   - asks the resolver for an approved animation (or nothing),
//   - enforces cooldowns and repetition prevention,
//   - applies the approved CSS family + custom-property variables,
//   - cancels obsolete animations and cleans up (never continuously animates),
//   - degrades to a subtle fade under reduced motion.
//
// It does NOT touch environment/camera/background layers.
// ---------------------------------------------------------------------------

import { resolveDialogueAnimation, DecisionLevel } from "./dialogueResolver.js";
import { Layer, resolveLayer, isReducedMotion } from "./layers.js";

const ALL_FAMILY_CLASSES = [
    "ua-play-fade-settle", "ua-play-continuation", "ua-play-firm-entrance",
    "ua-play-rigid-entrance", "ua-play-nervous", "ua-play-heavy-settle",
    "ua-play-excited-lift", "ua-play-flirt-glide", "ua-play-exhausted-rise",
    "ua-play-fear-tremor", "ua-play-impact-shake", "ua-play-cut-in",
    "ua-play-takeover", "ua-play-escalate", "ua-play-deescalate",
];

function now() {
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
}

export class DialogueAnimationController {
    constructor(opts = {}) {
        this._lastSpeaker = null;
        this._lastEmotion = null;
        this._lastIntensity = null;
        this._lastComposure = null;
        this._lastFamilyAt = 0;
        this._recentFamilies = []; // { family, at }
        this._cleanupTimer = null;
        this._boundEl = null;
        this._boundHandler = null;

        // Tuning.
        this.entranceCooldownMs = Number.isFinite(opts.entranceCooldownMs) ? opts.entranceCooldownMs : 650;
        this.repetitionWindowMs = Number.isFinite(opts.repetitionWindowMs) ? opts.repetitionWindowMs : 3500;
        this.onDecision = typeof opts.onDecision === "function" ? opts.onDecision : null;
    }

    // Public entry. Accepts a partial semantic speaker state; the controller
    // fills continuation/change flags from its own memory.
    playDialogueAnimation(state = {}) {
        const speakerId = String(state.speakerId ?? state.speaker ?? "").trim();
        const emotion = String(state.emotion || "neutral").toLowerCase();
        const intensity = Number.isFinite(state.emotionalIntensity) ? state.emotionalIntensity : 0.4;
        const composure = Number.isFinite(state.composure) ? state.composure : 0.7;

        const sameSpeaker = this._lastSpeaker != null && this._normId(speakerId) === this._normId(this._lastSpeaker);
        const newSpeaker = this._lastSpeaker != null && !sameSpeaker;
        const emotionChanged = this._lastEmotion != null && emotion !== this._lastEmotion;

        const fullState = {
            ...state,
            speakerId,
            emotion,
            emotionalIntensity: intensity,
            composure,
            isContinuation: sameSpeaker,
            newSpeaker,
            emotionChanged,
            prevIntensity: sameSpeaker ? this._lastIntensity : null,
            prevComposure: sameSpeaker ? this._lastComposure : null,
        };
        // First-ever line for a speaker counts as a (soft) new speaker entrance.
        if (this._lastSpeaker == null && speakerId) fullState.newSpeaker = true;

        const directive = resolveDialogueAnimation(fullState);

        // Persist memory regardless of whether we animate.
        this._lastSpeaker = speakerId || this._lastSpeaker;
        this._lastEmotion = emotion;
        this._lastIntensity = intensity;
        this._lastComposure = composure;

        if (!directive || directive.decision === DecisionLevel.NONE || !directive.family) {
            if (this.onDecision) this.onDecision(null, { reason: directive?.reason || "no_animation", state: fullState });
            return null;
        }

        // Cooldown: block repeated full entrances in quick succession, but
        // always allow micro continuations and justified STRONG animations.
        const t = now();
        if (directive.decision === DecisionLevel.ACCENT
            && (t - this._lastFamilyAt) < this.entranceCooldownMs
            && !directive.strong) {
            // Degrade to a minimal continuation instead of replaying entrance.
            return this._apply({ ...directive, family: "continuation", cssClass: "ua-play-continuation", decision: DecisionLevel.MICRO, reason: "cooldown_downgrade" });
        }

        // Repetition prevention: don't replay the same family within the window
        // (unless it's a justified strong beat).
        if (!directive.strong && this._recentlyPlayed(directive.family)) {
            if (directive.decision === DecisionLevel.MICRO) {
                if (this.onDecision) this.onDecision(null, { reason: "repetition_skipped", family: directive.family });
                return null;
            }
            return this._apply({ ...directive, family: "continuation", cssClass: "ua-play-continuation", decision: DecisionLevel.MICRO, reason: "repetition_downgrade" });
        }

        return this._apply(directive);
    }

    _normId(id) {
        return String(id || "").trim().toLowerCase();
    }

    _recentlyPlayed(family) {
        const cutoff = now() - this.repetitionWindowMs;
        this._recentFamilies = this._recentFamilies.filter((r) => r.at >= cutoff);
        return this._recentFamilies.some((r) => r.family === family);
    }

    _apply(directive) {
        const box = resolveLayer(Layer.DIALOGUE_BOX);
        if (!box) {
            if (this.onDecision) this.onDecision(directive, { reason: "no_dialogue_layer" });
            return directive;
        }

        // Never animate a hidden element.
        try {
            const cs = typeof getComputedStyle === "function" ? getComputedStyle(box) : null;
            if (cs && (cs.display === "none" || cs.visibility === "hidden")) {
                if (this.onDecision) this.onDecision(directive, { reason: "hidden_box_skipped" });
                return directive;
            }
        } catch (_) {}

        // Cancel any obsolete animation first.
        this._clearClasses(box);

        // Reduced motion: swap to a subtle fade family and short duration.
        let cssClass = directive.cssClass;
        let vars = { ...(directive.vars || {}) };
        if (isReducedMotion()) {
            cssClass = "ua-play-continuation";
            vars = { "--ua-dur": "180ms", "--ua-intensity": "0.2" };
        }

        // Apply CSS custom properties then the family class.
        for (const [k, v] of Object.entries(vars)) {
            try { box.style.setProperty(k, String(v)); } catch (_) {}
        }
        // Force reflow so re-adding the same class restarts the animation.
        void box.offsetWidth;
        box.classList.add(cssClass);

        const t = now();
        this._lastFamilyAt = t;
        this._recentFamilies.push({ family: directive.family, at: t });

        this._bindCleanup(box, cssClass);

        if (this.onDecision) this.onDecision(directive, { reason: directive.reason, applied: cssClass });
        return directive;
    }

    _clearClasses(box) {
        if (!box) return;
        box.classList.remove(...ALL_FAMILY_CLASSES);
        if (this._boundEl && this._boundHandler) {
            try { this._boundEl.removeEventListener("animationend", this._boundHandler); } catch (_) {}
            try { this._boundEl.removeEventListener("animationcancel", this._boundHandler); } catch (_) {}
        }
        if (this._cleanupTimer) { clearTimeout(this._cleanupTimer); this._cleanupTimer = null; }
        this._boundEl = null;
        this._boundHandler = null;
    }

    _bindCleanup(box, cssClass) {
        const handler = () => this._clearClasses(box);
        this._boundEl = box;
        this._boundHandler = handler;
        try {
            box.addEventListener("animationend", handler, { once: true });
            box.addEventListener("animationcancel", handler, { once: true });
        } catch (_) {}
        // Safety fallback in case animationend never fires (e.g. hidden mid-play).
        this._cleanupTimer = setTimeout(handler, 2400);
    }

    // Reset speaker memory (e.g. on scene change).
    reset() {
        const box = resolveLayer(Layer.DIALOGUE_BOX);
        this._clearClasses(box);
        this._lastSpeaker = null;
        this._lastEmotion = null;
        this._lastIntensity = null;
        this._lastComposure = null;
        this._lastFamilyAt = 0;
        this._recentFamilies = [];
    }
}

export const dialogueAnimationController = new DialogueAnimationController();
