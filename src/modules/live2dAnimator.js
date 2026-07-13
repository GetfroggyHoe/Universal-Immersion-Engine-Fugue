// Live2D Animator (Cubism SDK for Web bridge)
// ---------------------------------------------------------------------------
// Maps the Animation Director's semantic output onto Live2D Cubism resources:
//   - emotion / pose  -> .exp3.json expressions   (expression track)
//   - motion hints    -> .motion3.json motions     (motion track)
//
// The two tracks are independent and blended by the Cubism runtime, so a
// character can hold an expression while a motion plays. Motion priority
// follows CubismMotionPriority (Idle < Normal < Force) so chat-context
// gestures can interrupt ambient idle loops without fighting them.
//
// IMPORTANT: This module never touches CSS, keyframes, or DOM. It only asks a
// Live2D model (or an injected adapter) to load an *expression name* or play a
// *motion name*. The Director remains the final authority over *whether*
// anything plays; this class maps *what* plays onto Cubism resources.
//
// When the engine must render static poses, `applyStaticExpression()` holds
// the expression and starts a low-priority idle motion so a motionless
// character is still alive (breathing / blinking) instead of frozen.
// ---------------------------------------------------------------------------

export const MotionPriority = {
    NONE: 0,
    IDLE: 1,
    NORMAL: 2,
    FORCE: 3,
};

// Default emotion -> Cubism expression file name (without path/.exp3.json).
const DEFAULT_EMOTION_MAP = {
    neutral: "neutral",
    happy: "happy",
    joy: "happy",
    calm: "calm",
    relaxed: "calm",
    content: "calm",
    sad: "sad",
    angry: "angry",
    furious: "angry",
    fear: "fear",
    afraid: "fear",
    scared: "fear",
    surprised: "surprise",
    shock: "surprise",
    shocked: "surprise",
    nervous: "nervous",
    anxious: "nervous",
    tense: "nervous",
    love: "love",
    loving: "love",
    playful: "playful",
    excited: "excited",
    cold: "cold",
    hostile: "hostile",
    thinking: "thinking",
    embarrassed: "embarrassed",
};

// Default motion hint -> { file, priority }.
const DEFAULT_MOTION_MAP = {
    breath: { file: "idle", priority: MotionPriority.IDLE, loop: true },
    glance: { file: "glance", priority: MotionPriority.IDLE },
    settle: { file: "idle", priority: MotionPriority.IDLE, loop: true },
    posture_turn: { file: "turn", priority: MotionPriority.NORMAL },
    hand_gesture: { file: "gesture", priority: MotionPriority.NORMAL },
    emphasis_pulse: { file: "gesture", priority: MotionPriority.NORMAL },
    beat_pause: { file: "idle", priority: MotionPriority.IDLE, loop: true },
    entrance: { file: "entrance", priority: MotionPriority.FORCE },
    exit: { file: "exit", priority: MotionPriority.FORCE },
    impact: { file: "impact", priority: MotionPriority.FORCE },
};

function normalizeEmotion(e) {
    return String(e || "neutral").toLowerCase().trim();
}

export class Live2DAnimator {
    constructor({ model = null, director = null, emotionMap = {}, motionMap = {}, onEvent = null, motionGroup = "tap" } = {}) {
        this.model = model; // Live2D model or adapter implementing the bridge below
        this.director = director;
        this.emotionMap = { ...DEFAULT_EMOTION_MAP, ...emotionMap };
        this.motionMap = { ...DEFAULT_MOTION_MAP, ...motionMap };
        this.onEvent = typeof onEvent === "function" ? onEvent : null;
        this.motionGroup = String(motionGroup || "tap");
        this.currentExpression = "neutral";
        this.currentMotion = null;
        this._staticTimer = null;
    }

    setModel(model) {
        this.model = model;
        return this;
    }

    // Cubism motion group folder name (model-specific), driven by settings.
    setMotionGroup(group) {
        if (group) this.motionGroup = String(group);
        return this;
    }

    _emit(type, payload) {
        if (this.onEvent) {
            try { this.onEvent(type, payload); } catch (_) {}
        }
    }

    // ---- Expression track (.exp3.json) -----------------------------------
    resolveExpressionName(emotion) {
        const e = normalizeEmotion(emotion);
        return this.emotionMap[e] || this.emotionMap.neutral || "neutral";
    }

    setExpression(emotion, { blend = "normal" } = {}) {
        const name = this.resolveExpressionName(emotion);
        this.currentExpression = name;
        if (this.model && typeof this.model.setExpression === "function") {
            try { this.model.setExpression(name); } catch (err) { this._emit("expression_error", { name, error: String(err) }); }
        }
        this._emit("expression", { name, blend, emotion });
        return name;
    }

    // ---- Motion track (.motion3.json) ------------------------------------
    resolveMotion(hint) {
        const key = String(hint || "settle").toLowerCase();
        return this.motionMap[key] || this.motionMap.settle;
    }

    playMotion(hint, { priority = MotionPriority.NORMAL, intensity = 0.6, additive = true } = {}) {
        const spec = this.resolveMotion(hint);
        const prio = spec.priority != null ? spec.priority : priority;
        const motionName = spec.file || hint;
        this.currentMotion = motionName;
        if (this.model && typeof this.model.startMotion === "function") {
            try {
                this.model.startMotion(this.motionGroup, motionName, prio);
            } catch (err) {
                this._emit("motion_error", { motionName, priority: prio, error: String(err) });
            }
        }
        this._emit("motion", { name: motionName, priority: prio, intensity, additive, loop: !!spec.loop });
        return { name: motionName, priority: prio, intensity };
    }

    // ---- Director bridge --------------------------------------------------
    // Translate a semantic directive from the Animation Director into
    // expression and/or motion requests. No DOM, no CSS.
    handleDirective(directive) {
        if (!directive) return null;
        const result = {};
        if (directive.target === "character_expression" && directive.expression) {
            result.expression = this.setExpression(directive.expression, { blend: directive.blend });
        }
        if (directive.target === "character_motion" && directive.motion) {
            const prio = directive.decision === "major" ? MotionPriority.FORCE
                : directive.decision === "accent" ? MotionPriority.NORMAL
                : MotionPriority.IDLE;
            result.motion = this.playMotion(directive.motion, {
                priority: prio,
                intensity: directive.intensity,
                additive: directive.blend !== "replace",
            });
        }
        return result;
    }

    // ---- Static expressions ----------------------------------------------
    // Hold an expression and keep a gentle idle motion alive so a static
    // character never looks frozen. Called when no dialogue is active.
    applyStaticExpression(emotion) {
        this.setExpression(emotion, { blend: "normal" });
        // Low-priority looping idle keeps breathing/blink without competing.
        this.playMotion("breath", { priority: MotionPriority.IDLE, intensity: 0.3, additive: true });
        return this.currentExpression;
    }

    stop() {
        if (this._staticTimer) { clearInterval(this._staticTimer); this._staticTimer = null; }
        if (this.model && typeof this.model.stopAllMotions === "function") {
            try { this.model.stopAllMotions(); } catch (_) {}
        }
    }
}

// Minimal no-op adapter for environments without the Cubism SDK loaded.
// Records the last requested expression/motion so callers can assert behavior
// in tests or wire a real runtime later.
export function createNoOpModel() {
    return {
        _expressions: [],
        _motions: [],
        setExpression(name) { this._expressions.push(name); },
        startMotion(group, name, priority) { this._motions.push({ group, name, priority }); },
        stopAllMotions() { this._motions.push({ stop: true }); },
    };
}

export { DEFAULT_EMOTION_MAP, DEFAULT_MOTION_MAP };
