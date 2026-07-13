// Dialogue Animation Resolver
// ---------------------------------------------------------------------------
// Converts a SEMANTIC speaker animation state into an approved dialogue-box
// animation. This is the "smart" layer:
//   - It never maps one emotion to one animation.
//   - Strong animations only play when narratively justified.
//   - Consecutive same-speaker/same-state lines degrade to a minimal
//     continuation transition (or nothing).
//   - Character motion profiles reshape the result so two characters with the
//     same emotion animate differently.
//
// Pure logic. No DOM, no CSS strings beyond the semantic family name (which
// the controller maps to an approved CSS class).
// ---------------------------------------------------------------------------

import {
    characterMotionProfiles,
    normalizeProfile,
    DEFAULT_PROFILE,
    BaselineStyle,
    AnimationFamilyGroup,
    FAMILY_GROUP,
} from "./characterMotionProfiles.js";

export const DecisionLevel = {
    NONE: "none",
    MICRO: "micro",     // continuation only
    ACCENT: "accent",   // restrained, meaningful
    MAJOR: "major",     // strong; must be justified
};

// Families the resolver may emit (suffixes matching CSS `.ua-play-<family>`).
export const DialogueFamily = {
    FADE_SETTLE: "fade-settle",
    CONTINUATION: "continuation",
    FIRM_ENTRANCE: "firm-entrance",
    RIGID_ENTRANCE: "rigid-entrance",
    NERVOUS: "nervous",
    HEAVY_SETTLE: "heavy-settle",
    EXCITED_LIFT: "excited-lift",
    FLIRT_GLIDE: "flirt-glide",
    EXHAUSTED_RISE: "exhausted-rise",
    FEAR_TREMOR: "fear-tremor",
    IMPACT_SHAKE: "impact-shake",
    CUT_IN: "cut-in",
    TAKEOVER: "takeover",
    ESCALATE: "escalate",
    DEESCALATE: "deescalate",
};

const STRONG_FAMILIES = new Set([
    DialogueFamily.IMPACT_SHAKE,
    DialogueFamily.CUT_IN,
    DialogueFamily.TAKEOVER,
]);

// Base durations (ms) per family before profile speed scaling.
const BASE_DURATION = {
    [DialogueFamily.FADE_SETTLE]: 360,
    [DialogueFamily.CONTINUATION]: 200,
    [DialogueFamily.FIRM_ENTRANCE]: 380,
    [DialogueFamily.RIGID_ENTRANCE]: 300,
    [DialogueFamily.NERVOUS]: 620,
    [DialogueFamily.HEAVY_SETTLE]: 560,
    [DialogueFamily.EXCITED_LIFT]: 420,
    [DialogueFamily.FLIRT_GLIDE]: 620,
    [DialogueFamily.EXHAUSTED_RISE]: 900,
    [DialogueFamily.FEAR_TREMOR]: 700,
    [DialogueFamily.IMPACT_SHAKE]: 520,
    [DialogueFamily.CUT_IN]: 320,
    [DialogueFamily.TAKEOVER]: 460,
    [DialogueFamily.ESCALATE]: 380,
    [DialogueFamily.DEESCALATE]: 420,
};

function clamp01(v, dflt = 0) {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(0, Math.min(1, n));
}

function norm(s) {
    return String(s || "").toLowerCase().trim();
}

// Build a normalized semantic state with defaults.
export function normalizeSpeakerState(state = {}) {
    return {
        speakerId: String(state.speakerId ?? state.speaker ?? "").trim(),
        emotion: norm(state.emotion) || "neutral",
        emotionalIntensity: clamp01(state.emotionalIntensity, 0.4),
        composure: clamp01(state.composure, 0.7),
        urgency: clamp01(state.urgency, 0.3),
        confidence: clamp01(state.confidence, 0.5),
        hostility: clamp01(state.hostility, 0),
        fear: clamp01(state.fear, 0),
        physicalState: norm(state.physicalState) || "normal",
        deliveryStyle: norm(state.deliveryStyle) || "",
        interruption: !!state.interruption,
        relationshipPressure: clamp01(state.relationshipPressure, 0),
        isContinuation: !!state.isContinuation,
        emotionChanged: !!state.emotionChanged,
        physicalAction: !!state.physicalAction,
        physicalForce: clamp01(state.physicalForce, state.physicalAction ? 0.6 : 0),
        newSpeaker: !!state.newSpeaker,
        // optional prior intensity for escalation detection
        prevIntensity: state.prevIntensity == null ? null : clamp01(state.prevIntensity, 0),
        prevComposure: state.prevComposure == null ? null : clamp01(state.prevComposure, 0),
    };
}

// Detect the justification triggers for a STRONG animation.
export function detectStrongTriggers(st) {
    const intensityJump = st.prevIntensity != null ? (st.emotionalIntensity - st.prevIntensity) : (st.emotionChanged ? st.emotionalIntensity - 0.4 : 0);
    const composureDrop = st.prevComposure != null ? (st.prevComposure - st.composure) : 0;
    const triggers = {
        newSpeaker: st.newSpeaker,
        significantEmotionChange: st.emotionChanged && (st.emotionalIntensity >= 0.6 || intensityJump >= 0.3),
        majorIntensityIncrease: intensityJump >= 0.35,
        interruption: st.interruption,
        lossOfComposure: (composureDrop >= 0.3) || (st.composure <= 0.25 && st.emotionalIntensity >= 0.6),
        suddenThreat: (st.hostility >= 0.7 || st.fear >= 0.75),
        powerShift: st.relationshipPressure >= 0.7 || (st.confidence >= 0.85 && st.emotionChanged),
        physicalAction: st.physicalAction && st.physicalForce >= 0.5,
    };
    triggers.any = Object.values(triggers).some(Boolean);
    triggers.count = Object.values(triggers).filter((v) => v === true).length;
    return triggers;
}

// Pick a base family purely from the semantic signals (before profile bias).
function pickBaseFamily(st, triggers) {
    // Interruptions & takeovers dominate.
    if (triggers.interruption) {
        return st.newSpeaker ? DialogueFamily.TAKEOVER : DialogueFamily.CUT_IN;
    }
    if (triggers.physicalAction) {
        return DialogueFamily.IMPACT_SHAKE;
    }

    const delivery = st.deliveryStyle;
    if (delivery === "flirtatious" || st.emotion.includes("flirt") || st.emotion.includes("seduct")) {
        return DialogueFamily.FLIRT_GLIDE;
    }

    // Exhaustion / physical depletion.
    if (st.physicalState === "exhausted" || st.physicalState === "injured" || st.physicalState === "weak" || st.emotion.includes("exhaust") || st.emotion.includes("tired")) {
        return DialogueFamily.EXHAUSTED_RISE;
    }

    // Fear: tremor when still somewhat composed, nervous when unraveling.
    if (st.fear >= 0.5 || st.emotion.includes("afraid") || st.emotion.includes("fear") || st.emotion.includes("scared") || st.emotion.includes("terrified")) {
        return st.composure >= 0.4 ? DialogueFamily.FEAR_TREMOR : DialogueFamily.NERVOUS;
    }

    // Anger / hostility: controlled -> rigid; uncontrolled -> impact/nervous.
    if (st.hostility >= 0.5 || st.emotion.includes("angry") || st.emotion.includes("furious") || st.emotion.includes("hostile") || st.emotion.includes("rage")) {
        if (st.composure >= 0.6) return DialogueFamily.RIGID_ENTRANCE;
        if (st.emotionalIntensity >= 0.8) return DialogueFamily.IMPACT_SHAKE;
        return DialogueFamily.RIGID_ENTRANCE;
    }

    // Nervous / anxious.
    if (st.emotion.includes("nervous") || st.emotion.includes("anxious") || st.emotion.includes("tense") || (st.composure <= 0.35 && st.emotionalIntensity >= 0.5)) {
        return DialogueFamily.NERVOUS;
    }

    // Sadness / heaviness.
    if (st.emotion.includes("sad") || st.emotion.includes("grief") || st.emotion.includes("depress") || st.emotion.includes("defeat") || st.emotion.includes("somber")) {
        return DialogueFamily.HEAVY_SETTLE;
    }

    // Excitement / joy with urgency.
    if ((st.emotion.includes("excited") || st.emotion.includes("happy") || st.emotion.includes("joy") || st.emotion.includes("elated") || st.emotion.includes("hyped")) && (st.urgency >= 0.4 || st.emotionalIntensity >= 0.6)) {
        return DialogueFamily.EXCITED_LIFT;
    }

    // Confident / assertive.
    if (st.confidence >= 0.7 || st.emotion.includes("confident") || st.emotion.includes("proud") || st.emotion.includes("determined")) {
        return DialogueFamily.FIRM_ENTRANCE;
    }

    return DialogueFamily.FADE_SETTLE;
}

// Substitute a family if the profile avoids its group; pick an allowed fallback.
function respectAvoided(family, profile) {
    const group = FAMILY_GROUP[family];
    if (!profile.avoidedFamilies.includes(group)) return family;
    // Fallbacks in priority order, skipping avoided groups.
    const order = [
        DialogueFamily.RIGID_ENTRANCE,
        DialogueFamily.FIRM_ENTRANCE,
        DialogueFamily.NERVOUS,
        DialogueFamily.HEAVY_SETTLE,
        DialogueFamily.FADE_SETTLE,
    ];
    for (const f of order) {
        if (!profile.avoidedFamilies.includes(FAMILY_GROUP[f])) return f;
    }
    return DialogueFamily.FADE_SETTLE;
}

// Apply baseline-style personality bias to the chosen family.
function applyProfileStyle(family, st, profile) {
    const style = profile.baselineStyle;
    const group = FAMILY_GROUP[family];

    if (style === BaselineStyle.CONTROLLED || style === BaselineStyle.STOIC) {
        // Controlled characters convert loud motion into stillness/rigidity.
        if (group === AnimationFamilyGroup.IMPACT) return DialogueFamily.RIGID_ENTRANCE;
        if (group === AnimationFamilyGroup.LIGHT) return DialogueFamily.FIRM_ENTRANCE;
        if (family === DialogueFamily.NERVOUS && st.composure >= 0.3) return DialogueFamily.FEAR_TREMOR;
    } else if (style === BaselineStyle.VOLATILE) {
        // Volatile characters let control slip into abrupt motion.
        if (family === DialogueFamily.RIGID_ENTRANCE && st.emotionalIntensity >= 0.6) return DialogueFamily.IMPACT_SHAKE;
        if (family === DialogueFamily.FEAR_TREMOR) return DialogueFamily.NERVOUS;
    } else if (style === BaselineStyle.TIMID) {
        // Timid characters shrink outward motion into small inward motion.
        if (group === AnimationFamilyGroup.IMPACT) return DialogueFamily.NERVOUS;
        if (family === DialogueFamily.EXCITED_LIFT) return DialogueFamily.FADE_SETTLE;
    } else if (style === BaselineStyle.PLAYFUL) {
        // Playful characters add lightness to neutral deliveries.
        if (family === DialogueFamily.FADE_SETTLE && st.emotionalIntensity >= 0.45) return DialogueFamily.EXCITED_LIFT;
    }
    return family;
}

function pickEasing(profile) {
    // Blend sharpness/smoothness into an easing curve.
    if (profile.sharpness >= 0.8) return "steps(3, end)";
    if (profile.sharpness >= 0.6) return "cubic-bezier(0.9, 0.03, 0.69, 0.22)";
    if (profile.smoothness >= 0.75) return "cubic-bezier(0.25, 0.1, 0.25, 1)";
    if (profile.smoothness >= 0.55) return "cubic-bezier(0.22, 0.61, 0.36, 1)";
    return "cubic-bezier(0.34, 0.9, 0.4, 1)";
}

// The main entry: state -> directive (or null when nothing should play).
export function resolveDialogueAnimation(rawState, opts = {}) {
    const st = normalizeSpeakerState(rawState);
    const profile = opts.profile
        ? normalizeProfile(opts.profile)
        : characterMotionProfiles.get(st.speakerId);
    const triggers = detectStrongTriggers(st);

    // 1) Continuation handling: same speaker, same state, nothing meaningful.
    if (st.isContinuation && !triggers.any && !st.emotionChanged) {
        // Micro or nothing. Occasionally do a whisper-quiet continuation.
        if (opts.forceContinuation === false) {
            return { decision: DecisionLevel.NONE, family: null, reason: "continuation_no_change" };
        }
        return buildDirective(DialogueFamily.CONTINUATION, st, profile, triggers, DecisionLevel.MICRO, "continuation");
    }

    // 2) Escalation / de-escalation for continuing lines with intensity shifts.
    if (st.isContinuation && !triggers.any && st.prevIntensity != null) {
        const delta = st.emotionalIntensity - st.prevIntensity;
        if (delta >= 0.2) return buildDirective(DialogueFamily.ESCALATE, st, profile, triggers, DecisionLevel.ACCENT, "escalation");
        if (delta <= -0.2) return buildDirective(DialogueFamily.DEESCALATE, st, profile, triggers, DecisionLevel.ACCENT, "de_escalation");
    }

    // 3) Pick base family from semantics, then reshape via profile.
    let family = pickBaseFamily(st, triggers);
    family = applyProfileStyle(family, st, profile);
    family = respectAvoided(family, profile);

    // 4) Gate strong families behind justification. If a strong family was
    //    chosen but no strong trigger exists, downgrade it.
    if (STRONG_FAMILIES.has(family) && !triggers.any) {
        family = st.composure >= 0.5 ? DialogueFamily.FIRM_ENTRANCE : DialogueFamily.NERVOUS;
    }

    // 5) Decision level.
    let decision = STRONG_FAMILIES.has(family) ? DecisionLevel.MAJOR
        : (triggers.any || st.emotionChanged || st.newSpeaker) ? DecisionLevel.ACCENT
        : DecisionLevel.ACCENT; // non-continuation lines still get a restrained entrance

    const reason = triggers.newSpeaker ? "new_speaker"
        : triggers.interruption ? "interruption"
        : triggers.physicalAction ? "physical_action"
        : triggers.lossOfComposure ? "loss_of_composure"
        : triggers.suddenThreat ? "sudden_threat"
        : triggers.powerShift ? "power_shift"
        : triggers.majorIntensityIncrease ? "intensity_increase"
        : triggers.significantEmotionChange ? "emotion_change"
        : "entrance";

    return buildDirective(family, st, profile, triggers, decision, reason);
}

function buildDirective(family, st, profile, triggers, decision, reason) {
    const group = FAMILY_GROUP[family];

    // Intensity blends emotional intensity with trigger strength and amplitude.
    const triggerBoost = Math.min(0.4, triggers.count * 0.12);
    let intensity = clamp01(st.emotionalIntensity * 0.7 + triggerBoost + (st.urgency * 0.15));
    intensity *= profile.amplitude;

    // Group-specific multipliers.
    if (group === AnimationFamilyGroup.NERVOUS || group === AnimationFamilyGroup.IMPACT) {
        intensity *= profile.shakeMultiplier;
    }

    // Composure & escalation responses shape amplitude further.
    if (triggers.lossOfComposure) {
        intensity *= profile.composureResponse === "internalize" ? 0.6
            : profile.composureResponse === "externalize" ? 1.35 : 1.0;
    }
    if (triggers.majorIntensityIncrease || triggers.significantEmotionChange) {
        intensity *= profile.escalationResponse === "suppress" ? 0.65
            : profile.escalationResponse === "amplify" ? 1.3 : 1.0;
    }

    intensity = Math.max(0.12, Math.min(1.6, intensity));

    // Duration scales inversely with speed; exhaustion slows everything.
    let durationMs = (BASE_DURATION[family] || 400) / profile.speedMultiplier;
    if (st.physicalState === "exhausted" || st.physicalState === "injured") durationMs *= 1.25;
    if (st.urgency >= 0.7) durationMs *= 0.85;
    durationMs = Math.round(Math.max(140, Math.min(2000, durationMs)));

    // Overshoot only for bouncy groups, scaled by bounce multiplier.
    const overshootPx = (group === AnimationFamilyGroup.LIGHT)
        ? Math.round(3 + 5 * intensity * profile.bounceMultiplier)
        : 0;

    // Motion distances (used by families that reference --ua-x/--ua-y).
    const baseDist = 8 * intensity;
    const asym = 1 + profile.asymmetry * 0.6;

    return {
        decision,
        family,
        cssClass: `ua-play-${family}`,
        strong: STRONG_FAMILIES.has(family),
        reason,
        speakerId: st.speakerId,
        durationMs,
        intensity: Number(intensity.toFixed(3)),
        vars: {
            "--ua-intensity": intensity.toFixed(3),
            "--ua-dur": `${durationMs}ms`,
            "--ua-ease": pickEasing(profile),
            "--ua-overshoot": `${overshootPx}px`,
            "--ua-x": `${(baseDist * asym).toFixed(1)}px`,
            "--ua-y": `${(baseDist * 0.6).toFixed(1)}px`,
        },
        triggers,
        state: st,
    };
}
