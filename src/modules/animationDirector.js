// Animation Director
// ---------------------------------------------------------------------------
// Centralized authority for all VN motion. It consumes *semantic narrative
// events* (pure data) and decides, for every dialogue line or scene event,
// whether any animation is justified. It never selects CSS, keyframes,
// selectors, or DOM targets — it only emits semantic animation directives.
//
// A downstream renderer (CSS, WebGL, or the Live2D animator) is responsible
// for mapping a directive's `target`/`family` to an actual playback. The
// Director is the final authority: when it returns nothing, nothing plays.
//
// Pipeline (per event):
//   semantic narrative event
//     -> detect meaningful change
//     -> score narrative importance
//     -> evaluate scene rhythm
//     -> evaluate recent animation load
//     -> resolve target ownership
//     -> assign motion budget
//     -> choose decision level
//     -> choose animation family
//     -> parameterize intensity + duration
//     -> execute OR intentionally return no animation
// ---------------------------------------------------------------------------

export const DecisionLevel = {
    NONE: "none",     // no visible animation (the most common outcome)
    MICRO: "micro",   // nearly invisible transition for continuity
    ACCENT: "accent", // noticeable but restrained; marks a meaningful change
    MAJOR: "major",   // rare; physical events, transitions, major story beats
};

export const AnimationTarget = {
    CHARACTER_EXPRESSION: "character_expression", // -> Live2D .exp3.json
    CHARACTER_MOTION: "character_motion",         // -> Live2D .motion3.json
    DIALOGUE_BOX: "dialogue_box",
    ENVIRONMENT: "environment",
    CAMERA: "camera",
    UI_AMBIENT: "ui_ambient",
};

export const Tone = {
    NEUTRAL: "neutral",
    SLOW_TENSE: "slow_tense",
    COMEDY: "comedy",
    ROMANCE: "romance",
    ACTION: "action",
    HORROR: "horror",
};

const HISTORY_LIMIT = 40;
const DEFAULT_BUDGET = 1.0;

// Animation families are semantic only. Renderers decide how each one looks.
const FAMILIES = {
    // continuity / micro
    settle: { level: DecisionLevel.MICRO, defaultTarget: AnimationTarget.DIALOGUE_BOX },
    breath: { level: DecisionLevel.MICRO, defaultTarget: AnimationTarget.CHARACTER_MOTION },
    glance: { level: DecisionLevel.MICRO, defaultTarget: AnimationTarget.CHARACTER_MOTION },
    // accents (meaningful change)
    emphasis_pulse: { level: DecisionLevel.ACCENT, defaultTarget: AnimationTarget.DIALOGUE_BOX },
    expression_shift: { level: DecisionLevel.ACCENT, defaultTarget: AnimationTarget.CHARACTER_EXPRESSION },
    posture_turn: { level: DecisionLevel.ACCENT, defaultTarget: AnimationTarget.CHARACTER_MOTION },
    hand_gesture: { level: DecisionLevel.ACCENT, defaultTarget: AnimationTarget.CHARACTER_MOTION },
    beat_pause: { level: DecisionLevel.ACCENT, defaultTarget: AnimationTarget.DIALOGUE_BOX },
    // major (rare)
    entrance: { level: DecisionLevel.MAJOR, defaultTarget: AnimationTarget.CHARACTER_MOTION },
    exit: { level: DecisionLevel.MAJOR, defaultTarget: AnimationTarget.CHARACTER_MOTION },
    impact: { level: DecisionLevel.MAJOR, defaultTarget: AnimationTarget.CAMERA },
    scene_transition: { level: DecisionLevel.MAJOR, defaultTarget: AnimationTarget.ENVIRONMENT },
    weather_swell: { level: DecisionLevel.MAJOR, defaultTarget: AnimationTarget.ENVIRONMENT },
    tremor: { level: DecisionLevel.MAJOR, defaultTarget: AnimationTarget.CAMERA },
};

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function now() {
    return (typeof performance !== "undefined" && performance.now)
        ? performance.now()
        : Date.now();
}

function emotionDistance(a, b) {
    // Cheap ordinal distance between two emotion strings. Unknown -> treat as
    // a change so we never silently drop meaningful shifts.
    if (a === b) return 0;
    if (!a || !b) return 0.5;
    const valence = (e) => {
        const neg = ["angry", "furious", "sad", "afraid", "fear", "scared", "tense", "anxious", "nervous", "disgust", "cold", "hostile", "shocked"];
        const pos = ["happy", "joy", "calm", "relaxed", "loving", "content", "playful", "excited", "warm", "proud", "hopeful"];
        const e2 = String(e || "").toLowerCase();
        if (neg.some((n) => e2.includes(n))) return -1;
        if (pos.some((p) => e2.includes(p))) return 1;
        return 0;
    };
    return clamp(Math.abs(valence(a) - valence(b)) || 0.6, 0, 1);
}

export class AnimationDirector {
    constructor(opts = {}) {
        this.budgetMax = Number.isFinite(opts.budgetMax) ? opts.budgetMax : DEFAULT_BUDGET;
        this.budget = this.budgetMax;
        this.budgetRegenPerSec = Number.isFinite(opts.budgetRegenPerSec) ? opts.budgetRegenPerSec : 0.12;

        this.rhythm = {
            tone: Tone.NEUTRAL,
            pacing: "normal",          // slow | normal | fast
            motionTolerance: 0.6,       // 0..1 how much motion the scene allows
            preferredMotionStyle: "smooth", // smooth | sharp | delayed | restrained
            cameraStability: 0.8,       // 0..1 higher = keep camera still
            currentTension: 0.3,        // 0..1
            recentAnimationLoad: 0,     // 0..1 derived from history
        };

        // Track which target currently "owns" the viewer's attention.
        this._ownedBy = null;          // target string
        this._ownedUntil = 0;           // timestamp
        this._ownedPriority = 0;

        this.history = [];
        this._lastSpeaker = null;
        this._lastEmotion = null;
        this._lastComposure = null;
        this._lastByTarget = {};       // target -> last directive
        this.onDecision = typeof opts.onDecision === "function" ? opts.onDecision : null;
    }

    // ---- Scene rhythm ------------------------------------------------------
    setSceneRhythm(rhythm = {}) {
        Object.assign(this.rhythm, {
            tone: rhythm.tone ?? this.rhythm.tone,
            pacing: rhythm.pacing ?? this.rhythm.pacing,
            motionTolerance: clamp(rhythm.motionTolerance ?? this.rhythm.motionTolerance, 0, 1),
            preferredMotionStyle: rhythm.preferredMotionStyle ?? this.rhythm.preferredMotionStyle,
            cameraStability: clamp(rhythm.cameraStability ?? this.rhythm.cameraStability, 0, 1),
            currentTension: clamp(rhythm.currentTension ?? this.rhythm.currentTension, 0, 1),
        });
        return this.rhythm;
    }

    // Shortcuts for the common scene tones described in the brief.
    applyTonePreset(tone) {
        switch (tone) {
            case Tone.SLOW_TENSE:
                return this.setSceneRhythm({ tone, pacing: "slow", motionTolerance: 0.35, preferredMotionStyle: "delayed", cameraStability: 0.9, currentTension: 0.6 });
            case Tone.COMEDY:
                return this.setSceneRhythm({ tone, pacing: "fast", motionTolerance: 0.75, preferredMotionStyle: "sharp", cameraStability: 0.7, currentTension: 0.2 });
            case Tone.ROMANCE:
                return this.setSceneRhythm({ tone, pacing: "slow", motionTolerance: 0.5, preferredMotionStyle: "smooth", cameraStability: 0.85, currentTension: 0.25 });
            case Tone.ACTION:
                return this.setSceneRhythm({ tone, pacing: "fast", motionTolerance: 0.7, preferredMotionStyle: "sharp", cameraStability: 0.45, currentTension: 0.75 });
            case Tone.HORROR:
                return this.setSceneRhythm({ tone, pacing: "slow", motionTolerance: 0.3, preferredMotionStyle: "delayed", cameraStability: 0.92, currentTension: 0.7 });
            default:
                return this.setSceneRhythm({ tone: Tone.NEUTRAL, pacing: "normal", motionTolerance: 0.6, preferredMotionStyle: "smooth", cameraStability: 0.8, currentTension: 0.3 });
        }
    }

    // ---- Budget & load -----------------------------------------------------
    _regenBudget() {
        const t = now();
        if (this._lastRegen === undefined) this._lastRegen = t;
        const dt = (t - this._lastRegen) / 1000;
        this._lastRegen = t;
        this.budget = clamp(this.budget + dt * this.budgetRegenPerSec, 0, this.budgetMax);
    }

    _recordLoad() {
        // recentAnimationLoad = decayed count of recent directives.
        const cutoff = now() - 6000;
        const recent = this.history.filter((h) => h.timestamp >= cutoff);
        let load = 0;
        for (const h of recent) {
            const w = h.decision === DecisionLevel.MAJOR ? 0.4
                : h.decision === DecisionLevel.ACCENT ? 0.2
                : 0.06;
            load += w;
        }
        this.rhythm.recentAnimationLoad = clamp(load, 0, 1);
        return this.rhythm.recentAnimationLoad;
    }

    // ---- Target ownership --------------------------------------------------
    _claimOwnership(target, priority, durationMs) {
        this._ownedBy = target;
        this._ownedUntil = now() + durationMs;
        this._ownedPriority = priority;
    }

    _ownsAttention(target) {
        if (!this._ownedBy || now() > this._ownedUntil) return false;
        return this._ownedBy !== target; // someone else owns it
    }

    _priorityFor(target, level) {
        if (target === AnimationTarget.ENVIRONMENT && (level === DecisionLevel.MAJOR)) return 3;
        if (target === AnimationTarget.CAMERA) return 3;
        if (target === AnimationTarget.CHARACTER_MOTION) return 2;
        if (target === AnimationTarget.CHARACTER_EXPRESSION) return 1;
        if (target === AnimationTarget.DIALOGUE_BOX) return 1;
        return 0;
    }

    // ---- Meaningful-change detection --------------------------------------
    _detectChange(ev) {
        const speakerChanged = ev.speaker !== this._lastSpeaker && this._lastSpeaker !== null;
        const emotionChanged = ev.emotion !== this._lastEmotion;
        const emotionDelta = emotionDistance(this._lastEmotion, ev.emotion);
        const composureChanged = ev.composure !== this._lastComposure && ev.composure !== undefined;
        const physical = !!ev.physicalAction;
        const interruption = !!ev.interruption;
        const envChanged = !!ev.environmentChange;
        return {
            speakerChanged,
            emotionChanged,
            emotionDelta,
            composureChanged,
            physical,
            interruption,
            envChanged,
            meaningfullyChanged: speakerChanged || emotionChanged || composureChanged || physical || interruption || envChanged,
        };
    }

    // ---- Repetition guard --------------------------------------------------
    _recentlyRepeated(target, family) {
        const cutoff = now() - 4500;
        return this.history.some((h) =>
            h.timestamp >= cutoff && h.target === target && h.family === family);
    }

    // ---- Importance scoring -----------------------------------------------
    _scoreImportance(change, ev) {
        let score = 0;
        score += change.speakerChanged ? 0.35 : 0;
        score += change.emotionChanged ? 0.25 * (0.4 + change.emotionDelta) : 0;
        score += change.composureChanged ? 0.15 : 0;
        score += change.interruption ? 0.3 : 0;
        score += change.physical ? 0.4 : 0;
        score += change.envChanged ? 0.25 : 0;
        score += clamp(Number(ev.narrativeImportance) || 0, 0, 1) * 0.5;
        score += this.rhythm.currentTension * 0.1;
        return clamp(score, 0, 1.6);
    }

    // ---- Family selection --------------------------------------------------
    _chooseFamily(change, ev, target) {
        if (target === AnimationTarget.ENVIRONMENT) {
            if (change.envChanged) return change.physical ? "weather_swell" : "scene_transition";
        }
        if (target === AnimationTarget.CAMERA) {
            if (change.physical) return "impact";
            if (ev.environmentChange) return "tremor";
        }
        if (target === AnimationTarget.CHARACTER_MOTION) {
            if (ev.entrance) return "entrance";
            if (ev.exit) return "exit";
            if (change.physical) return "posture_turn";
            if (change.speakerChanged) return "posture_turn";
            if (change.composureChanged) return "hand_gesture";
            return "breath";
        }
        if (target === AnimationTarget.CHARACTER_EXPRESSION) {
            return "expression_shift";
        }
        // dialogue box
        if (change.interruption) return "emphasis_pulse";
        if (change.speakerChanged) return "emphasis_pulse";
        if (change.emotionChanged) return "beat_pause";
        return "settle";
    }

    // ---- Core decision -----------------------------------------------------
    // Returns a semantic directive object, or null when no animation is
    // justified. The renderer never sees a CSS class, keyframe, or selector.
    ingest(ev = {}) {
        this._regenBudget();
        const load = this._recordLoad();
        const change = this._detectChange(ev);
        const importance = this._scoreImportance(change, ev);

        const t = now();

        // 1) Dialogue emotion alone must never cause an environment animation.
        // 2) Environment animation requires physical/atmospheric/spatial/
        //    camera/lighting/weather/scene-transition events.
        let candidateTargets = [];
        if (change.envChanged && (change.physical || ev.atmospheric || ev.sceneTransition || ev.weather || ev.lighting)) {
            candidateTargets.push(AnimationTarget.ENVIRONMENT);
        }
        if (change.physical) {
            candidateTargets.push(change.envChanged ? AnimationTarget.CAMERA : AnimationTarget.CHARACTER_MOTION);
        }
        if (change.interruption || change.speakerChanged) {
            candidateTargets.push(AnimationTarget.DIALOGUE_BOX);
        }
        if (change.emotionChanged || change.composureChanged) {
            candidateTargets.push(AnimationTarget.CHARACTER_EXPRESSION);
            candidateTargets.push(AnimationTarget.CHARACTER_MOTION);
        }

        // Default continuity target when something minor changed.
        if (!candidateTargets.length && change.meaningfullyChanged) {
            candidateTargets.push(AnimationTarget.DIALOGUE_BOX);
        }

        // 3) Doing nothing is the most common decision.
        if (!change.meaningfullyChanged) {
            return this._finalize(null, ev, change, "no_meaningful_change", importance);
        }

        // 4) Budget + load gating. Low budget suppresses low-priority motion.
        const effectiveTolerance = this.rhythm.motionTolerance * (1 - load * 0.6);
        if (importance < 0.25 && effectiveTolerance < 0.5) {
            return this._finalize(null, ev, change, "low_importance_low_tolerance", importance);
        }

        // Pick the highest-value target that isn't blocked by ownership.
        let target = null;
        const ranked = candidateTargets.sort((a, b) => this._priorityFor(b, ev.major ? DecisionLevel.MAJOR : DecisionLevel.ACCENT) - this._priorityFor(a, DecisionLevel.ACCENT));
        for (const cand of ranked) {
            if (this._ownsAttention(cand)) continue; // prevent competition
            target = cand;
            break;
        }

        // Suppress if another element already owns the viewer's attention and
        // this candidate is not clearly more important.
        if (!target && this._ownsAttention()) {
            return this._finalize(null, ev, change, "attention_owned_by_other", importance);
        }
        if (!target) target = candidateTargets[0] || AnimationTarget.DIALOGUE_BOX;

        // 5) Choose decision level.
        const level = this._chooseLevel(ev, change, importance, effectiveTolerance);

        // 6) Persistent emotional states must not produce persistent motion.
        // Animate onset/escalation once, then settle to a stable visual state.
        if (level === DecisionLevel.NONE) {
            return this._finalize(null, ev, change, "below_threshold", importance);
        }

        // 7) Choose family + parameterize.
        const family = this._chooseFamily(change, ev, target);

        // Repetition guard: do not replay the same family on the same target.
        if (this._recentlyRepeated(target, family) && level !== DecisionLevel.MAJOR) {
            return this._finalize(null, ev, change, "recently_repeated", importance);
        }

        // Intensity is decided only AFTER the level is selected.
        const intensity = this._parameterizeIntensity(level, change, importance);
        const durationMs = this._parameterizeDuration(level, ev);

        // 8) Budget consumption.
        const cost = level === DecisionLevel.MAJOR ? 0.5 : level === DecisionLevel.ACCENT ? 0.22 : 0.08;
        this.budget = clamp(this.budget - cost, 0, this.budgetMax);

        const directive = {
            decision: level,
            target,
            family,
            intensity,
            durationMs,
            blend: level === DecisionLevel.MAJOR ? "replace" : "additive",
            priority: this._priorityFor(target, level),
            // Optional semantic hints for the renderer (NOT DOM/CSS).
            expression: target === AnimationTarget.CHARACTER_EXPRESSION ? ev.emotion : undefined,
            motion: target === AnimationTarget.CHARACTER_MOTION ? (ev.motionHint || family) : undefined,
            speaker: ev.speaker ?? null,
            narrativeBeat: ev.narrativeBeat ?? null,
            reason: change.speakerChanged ? "speaker_changed"
                : change.interruption ? "interruption"
                : change.physical ? "physical_action"
                : change.envChanged ? "environment_change"
                : change.emotionChanged ? "emotion_shift"
                : "composure_shift",
        };

        // Update persistent tracking.
        this._lastSpeaker = ev.speaker ?? this._lastSpeaker;
        this._lastEmotion = ev.emotion ?? this._lastEmotion;
        this._lastComposure = ev.composure ?? this._lastComposure;

        this._pushHistory({ ...directive, timestamp: t, interrupted: false });
        this._claimOwnership(target, directive.priority, durationMs + 120);

        if (this.onDecision) this.onDecision(directive, { change, importance, load });
        return directive;
    }

    _chooseLevel(ev, change, importance, tolerance) {
        if (ev.major || change.physical && (change.envChanged || ev.environmentChange && change.physical)) {
            return DecisionLevel.MAJOR;
        }
        if (ev.sceneTransition || ev.entrance || ev.exit) return DecisionLevel.MAJOR;
        if (importance >= 0.6 && tolerance >= 0.4) return DecisionLevel.ACCENT;
        if (importance >= 0.35 && tolerance >= 0.55) return DecisionLevel.ACCENT;
        if (importance >= 0.15) return DecisionLevel.MICRO;
        return DecisionLevel.NONE;
    }

    _parameterizeIntensity(level, change, importance) {
        const base = level === DecisionLevel.MAJOR ? 0.85
            : level === DecisionLevel.ACCENT ? 0.55
            : 0.25;
        const toneScale = this.rhythm.preferredMotionStyle === "restrained" ? 0.7
            : this.rhythm.preferredMotionStyle === "sharp" ? 1.15 : 1.0;
        return clamp(base + (importance - 0.4) * 0.25 * (level === DecisionLevel.MAJOR ? 1 : 0.6), 0.12, 1) * toneScale;
    }

    _parameterizeDuration(level, ev) {
        let base = level === DecisionLevel.MAJOR ? 900
            : level === DecisionLevel.ACCENT ? 460
            : 240;
        if (this.rhythm.preferredMotionStyle === "delayed") base += 180;
        if (this.rhythm.pacing === "fast") base *= 0.8;
        if (this.rhythm.pacing === "slow") base *= 1.2;
        return Math.round(ev.durationMs ? clamp(ev.durationMs, 120, 2400) : base);
    }

    _pushHistory(rec) {
        this.history.push(rec);
        if (this.history.length > HISTORY_LIMIT) this.history.shift();
    }

    _finalize(directive, ev, change, reason, importance) {
        // Still update persistent speaker/emotion tracking even when idle.
        if (ev.speaker !== undefined) this._lastSpeaker = ev.speaker;
        if (ev.emotion !== undefined) this._lastEmotion = ev.emotion;
        if (ev.composure !== undefined) this._lastComposure = ev.composure;
        if (this.onDecision) this.onDecision(null, { change, importance, load: this.rhythm.recentAnimationLoad, reason });
        return directive; // null
    }

    getState() {
        return {
            budget: this.budget,
            budgetMax: this.budgetMax,
            rhythm: { ...this.rhythm },
            ownedBy: this._ownedBy,
            historyCount: this.history.length,
        };
    }

    reset() {
        this.budget = this.budgetMax;
        this.history = [];
        this._lastSpeaker = null;
        this._lastEmotion = null;
        this._lastComposure = null;
        this._ownedBy = null;
        this._ownedUntil = 0;
    }
}

// Convenience factory used by the narrative layer.
export function createAnimationDirector(opts) {
    return new AnimationDirector(opts);
}

export { FAMILIES };
