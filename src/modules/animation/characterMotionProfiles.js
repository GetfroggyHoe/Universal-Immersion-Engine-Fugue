// Character Motion Profiles
// ---------------------------------------------------------------------------
// Every speaker/NPC MAY register an optional motion profile that biases how
// their dialogue box animates. Two characters expressing the SAME emotion must
// be able to animate differently: a controlled character becomes more rigid
// and still when angry; a volatile one uses abrupt uneven movement; a timid
// one uses small inward motion; a playful one uses a light overshoot.
//
// A profile is pure data. The DialogueAnimationResolver consumes it. Nothing
// here touches the DOM or CSS.
// ---------------------------------------------------------------------------

// Baseline motion styles bias family selection & shaping.
export const BaselineStyle = {
    NEUTRAL: "neutral",
    CONTROLLED: "controlled",   // minimizes motion, prefers rigid/still
    VOLATILE: "volatile",       // abrupt, uneven, sharp
    TIMID: "timid",             // small, inward, low amplitude
    PLAYFUL: "playful",         // light overshoot, bouncy but tasteful
    STOIC: "stoic",             // almost no motion
    THEATRICAL: "theatrical",   // larger, expressive (still gated by scene)
};

// Animation families grouped into "families" so profiles can prefer/avoid
// whole categories instead of individual animations.
export const AnimationFamilyGroup = {
    RESTRAINED: "restrained",   // fade-settle, continuation, firm-entrance
    RIGID: "rigid",             // rigid-entrance
    NERVOUS: "nervous",         // nervous, fear-tremor
    HEAVY: "heavy",             // heavy-settle, exhausted-rise
    LIGHT: "light",             // excited-lift, flirt-glide, escalate
    IMPACT: "impact",           // impact-shake, takeover, cut-in
};

// Which group each concrete family belongs to.
export const FAMILY_GROUP = {
    "fade-settle": AnimationFamilyGroup.RESTRAINED,
    "continuation": AnimationFamilyGroup.RESTRAINED,
    "firm-entrance": AnimationFamilyGroup.RESTRAINED,
    "rigid-entrance": AnimationFamilyGroup.RIGID,
    "nervous": AnimationFamilyGroup.NERVOUS,
    "fear-tremor": AnimationFamilyGroup.NERVOUS,
    "heavy-settle": AnimationFamilyGroup.HEAVY,
    "exhausted-rise": AnimationFamilyGroup.HEAVY,
    "excited-lift": AnimationFamilyGroup.LIGHT,
    "flirt-glide": AnimationFamilyGroup.LIGHT,
    "escalate": AnimationFamilyGroup.LIGHT,
    "deescalate": AnimationFamilyGroup.RESTRAINED,
    "impact-shake": AnimationFamilyGroup.IMPACT,
    "takeover": AnimationFamilyGroup.IMPACT,
    "cut-in": AnimationFamilyGroup.IMPACT,
};

function clamp(v, lo, hi, dflt) {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
}

// The canonical profile shape with defaults. Missing fields fall back here.
export const DEFAULT_PROFILE = {
    baselineStyle: BaselineStyle.NEUTRAL,
    speedMultiplier: 1.0,        // scales duration inversely (faster = shorter)
    bounceMultiplier: 1.0,       // scales overshoot
    shakeMultiplier: 1.0,        // scales shake/tremor amplitude
    sharpness: 0.5,              // 0 smooth easing .. 1 hard/stepped easing
    smoothness: 0.5,             // 0 abrupt .. 1 very smooth (opposes sharpness)
    asymmetry: 0.0,              // 0 symmetric .. 1 lopsided/uneven motion
    preferredFamilies: [],       // array of AnimationFamilyGroup
    avoidedFamilies: [],         // array of AnimationFamilyGroup
    composureResponse: "normal", // how they visibly react to lost composure:
                                 //   "internalize" | "normal" | "externalize"
    escalationResponse: "normal",// how big an emotional jump looks:
                                 //   "suppress" | "normal" | "amplify"
    amplitude: 1.0,              // global motion-distance multiplier
};

export function normalizeProfile(profile = {}) {
    const p = profile && typeof profile === "object" ? profile : {};
    const style = String(p.baselineStyle || p.style || DEFAULT_PROFILE.baselineStyle).toLowerCase();
    const norm = {
        baselineStyle: Object.values(BaselineStyle).includes(style) ? style : BaselineStyle.NEUTRAL,
        speedMultiplier: clamp(p.speedMultiplier, 0.4, 2.5, DEFAULT_PROFILE.speedMultiplier),
        bounceMultiplier: clamp(p.bounceMultiplier, 0, 3, DEFAULT_PROFILE.bounceMultiplier),
        shakeMultiplier: clamp(p.shakeMultiplier, 0, 3, DEFAULT_PROFILE.shakeMultiplier),
        sharpness: clamp(p.sharpness, 0, 1, DEFAULT_PROFILE.sharpness),
        smoothness: clamp(p.smoothness, 0, 1, DEFAULT_PROFILE.smoothness),
        asymmetry: clamp(p.asymmetry, 0, 1, DEFAULT_PROFILE.asymmetry),
        preferredFamilies: Array.isArray(p.preferredFamilies) ? p.preferredFamilies.slice(0, 8) : [],
        avoidedFamilies: Array.isArray(p.avoidedFamilies) ? p.avoidedFamilies.slice(0, 8) : [],
        composureResponse: ["internalize", "normal", "externalize"].includes(p.composureResponse) ? p.composureResponse : "normal",
        escalationResponse: ["suppress", "normal", "amplify"].includes(p.escalationResponse) ? p.escalationResponse : "normal",
        amplitude: clamp(p.amplitude, 0.2, 2.5, DEFAULT_PROFILE.amplitude),
    };
    return norm;
}

// Ready-made archetypes derived from the baseline styles so callers can wire a
// character with one word. registerCharacterMotionProfile still accepts full
// custom profiles.
export const ARCHETYPES = {
    [BaselineStyle.CONTROLLED]: normalizeProfile({
        baselineStyle: BaselineStyle.CONTROLLED,
        speedMultiplier: 1.05, bounceMultiplier: 0.2, shakeMultiplier: 0.35,
        sharpness: 0.75, smoothness: 0.4, asymmetry: 0.05, amplitude: 0.7,
        preferredFamilies: [AnimationFamilyGroup.RIGID, AnimationFamilyGroup.RESTRAINED],
        avoidedFamilies: [AnimationFamilyGroup.LIGHT],
        composureResponse: "internalize", escalationResponse: "suppress",
    }),
    [BaselineStyle.VOLATILE]: normalizeProfile({
        baselineStyle: BaselineStyle.VOLATILE,
        speedMultiplier: 1.35, bounceMultiplier: 1.0, shakeMultiplier: 1.6,
        sharpness: 0.9, smoothness: 0.15, asymmetry: 0.8, amplitude: 1.35,
        preferredFamilies: [AnimationFamilyGroup.IMPACT, AnimationFamilyGroup.NERVOUS],
        escalationResponse: "amplify",
    }),
    [BaselineStyle.TIMID]: normalizeProfile({
        baselineStyle: BaselineStyle.TIMID,
        speedMultiplier: 0.9, bounceMultiplier: 0.25, shakeMultiplier: 0.9,
        sharpness: 0.25, smoothness: 0.7, asymmetry: 0.35, amplitude: 0.55,
        preferredFamilies: [AnimationFamilyGroup.NERVOUS, AnimationFamilyGroup.RESTRAINED],
        avoidedFamilies: [AnimationFamilyGroup.IMPACT, AnimationFamilyGroup.LIGHT],
        composureResponse: "internalize",
    }),
    [BaselineStyle.PLAYFUL]: normalizeProfile({
        baselineStyle: BaselineStyle.PLAYFUL,
        speedMultiplier: 1.2, bounceMultiplier: 1.7, shakeMultiplier: 0.8,
        sharpness: 0.35, smoothness: 0.75, asymmetry: 0.2, amplitude: 1.1,
        preferredFamilies: [AnimationFamilyGroup.LIGHT],
    }),
    [BaselineStyle.STOIC]: normalizeProfile({
        baselineStyle: BaselineStyle.STOIC,
        speedMultiplier: 0.95, bounceMultiplier: 0.05, shakeMultiplier: 0.15,
        sharpness: 0.6, smoothness: 0.5, asymmetry: 0.0, amplitude: 0.45,
        preferredFamilies: [AnimationFamilyGroup.RESTRAINED, AnimationFamilyGroup.RIGID],
        avoidedFamilies: [AnimationFamilyGroup.LIGHT, AnimationFamilyGroup.IMPACT],
        composureResponse: "internalize", escalationResponse: "suppress",
    }),
    [BaselineStyle.THEATRICAL]: normalizeProfile({
        baselineStyle: BaselineStyle.THEATRICAL,
        speedMultiplier: 1.1, bounceMultiplier: 1.4, shakeMultiplier: 1.2,
        sharpness: 0.5, smoothness: 0.6, asymmetry: 0.3, amplitude: 1.4,
        escalationResponse: "amplify",
    }),
};

export class CharacterMotionProfiles {
    constructor() {
        this._byId = new Map();
    }

    _key(speakerId) {
        return String(speakerId || "").trim().toLowerCase();
    }

    // Accepts a full profile object, or a string archetype/baseline name.
    register(speakerId, profile) {
        const key = this._key(speakerId);
        if (!key) return null;
        let resolved;
        if (typeof profile === "string") {
            const arche = ARCHETYPES[profile.toLowerCase()];
            resolved = arche ? { ...arche } : normalizeProfile({ baselineStyle: profile });
        } else {
            const base = ARCHETYPES[this._key(profile?.baselineStyle)] || DEFAULT_PROFILE;
            resolved = normalizeProfile({ ...base, ...(profile || {}) });
        }
        this._byId.set(key, resolved);
        return resolved;
    }

    unregister(speakerId) {
        return this._byId.delete(this._key(speakerId));
    }

    has(speakerId) {
        return this._byId.has(this._key(speakerId));
    }

    // Always returns a usable profile (falls back to default).
    get(speakerId) {
        return this._byId.get(this._key(speakerId)) || DEFAULT_PROFILE;
    }

    clear() {
        this._byId.clear();
    }
}

export const characterMotionProfiles = new CharacterMotionProfiles();
