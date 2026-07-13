// Semantic Extraction
// ---------------------------------------------------------------------------
// Turns raw narrative text into SEMANTIC data only. It reads tags and
// conservative keyword cues; it NEVER produces CSS classes, animation names,
// selectors, or raw animation code. The controllers/resolvers decide the
// visuals. This is the boundary that stops malformed model output from
// controlling the UI directly.
//
// Two extractors:
//   deriveSpeakerState()      -> semantic speaker animation state (chat box)
//   deriveEnvironmentEvents() -> semantic environment events (screen)
//
// Crucially: emotion words alone NEVER become environment events. Only explicit
// physical / atmospheric / spatial cues do, so "a character speaking angrily"
// cannot shake the screen.
// ---------------------------------------------------------------------------

function tag(text, key) {
    const re = new RegExp(`\\[\\s*${key}\\s*:\\s*([^\\]]+)\\]`, "i");
    const m = re.exec(String(text || ""));
    return m ? String(m[1]).trim() : "";
}

function hasTag(text, key) {
    const re = new RegExp(`\\[\\s*${key}\\s*(?::[^\\]]*)?\\]`, "i");
    return re.test(String(text || ""));
}

// Parse a 0..1 number, a 0..100 number, or a word (low/med/high/extreme).
function level(value, dflt = null) {
    if (value == null || value === "") return dflt;
    const s = String(value).trim().toLowerCase();
    const n = Number(s);
    if (Number.isFinite(n)) {
        if (n > 1 && n <= 100) return Math.max(0, Math.min(1, n / 100));
        return Math.max(0, Math.min(1, n));
    }
    const words = {
        none: 0, calm: 0.15, low: 0.25, mild: 0.35, moderate: 0.5, medium: 0.5,
        high: 0.75, strong: 0.8, intense: 0.85, extreme: 0.95, max: 1,
    };
    return words[s] != null ? words[s] : dflt;
}

const NEG_EMOTIONS = ["angry", "furious", "rage", "hostile", "sad", "grief", "afraid", "fear", "scared", "terrified", "nervous", "anxious", "tense", "disgust", "cold", "shocked", "panic", "defeated", "somber", "exhausted", "tired"];

function scanEmotion(clean) {
    const t = clean.toLowerCase();
    for (const e of NEG_EMOTIONS) if (t.includes(e)) return e;
    const pos = ["happy", "joy", "excited", "elated", "playful", "flirt", "confident", "proud", "calm", "content", "determined", "hyped"];
    for (const e of pos) if (t.includes(e)) return e;
    return "";
}

// ---------------------------------------------------------------------------
// Speaker state (chat box)
// ---------------------------------------------------------------------------
export function deriveSpeakerState({ speaker, text, isUser = false } = {}) {
    const raw = String(text || "");
    const clean = raw.replace(/\[[^\]]*\]/g, " ").trim();

    const emotion = (tag(raw, "emotion") || tag(raw, "mood") || scanEmotion(clean) || "neutral").toLowerCase();

    // Intensity: explicit tag, else inferred from emphasis.
    let intensity = level(tag(raw, "intensity"), null);
    if (intensity == null) {
        const exclaims = (clean.match(/!/g) || []).length;
        const caps = clean.replace(/[^A-Za-z]/g, "");
        const capsRatio = caps ? (caps.replace(/[^A-Z]/g, "").length / caps.length) : 0;
        intensity = 0.35 + Math.min(0.35, exclaims * 0.12) + (capsRatio > 0.6 ? 0.25 : 0);
        intensity = Math.max(0.15, Math.min(1, intensity));
    }

    // Hostility / fear from tags or emotion words.
    let hostility = level(tag(raw, "hostility"), null);
    if (hostility == null) hostility = /angry|furious|rage|hostile|snarl|threat/.test(clean.toLowerCase()) ? Math.min(1, 0.4 + intensity * 0.5) : 0;
    let fear = level(tag(raw, "fear"), null);
    if (fear == null) fear = /afraid|fear|scared|terrified|trembl|panic/.test(clean.toLowerCase()) ? Math.min(1, 0.4 + intensity * 0.4) : 0;

    // Composure: explicit, else inverse of intensity/hostility/fear.
    let composure = level(tag(raw, "composure"), null);
    if (composure == null) composure = Math.max(0.05, 1 - Math.max(intensity * 0.5, hostility * 0.6, fear * 0.7));

    const urgency = level(tag(raw, "urgency"), /\b(now|hurry|quick|run|go|move)\b/.test(clean.toLowerCase()) || /!\s*$/.test(clean) ? 0.6 : 0.3);
    const confidence = level(tag(raw, "confidence"), /confident|certain|proud|determined/.test(clean.toLowerCase()) ? 0.8 : 0.5);
    const relationshipPressure = level(tag(raw, "pressure"), 0);

    // Delivery style.
    let deliveryStyle = (tag(raw, "delivery") || "").toLowerCase();
    if (!deliveryStyle) {
        const t = clean.toLowerCase();
        if (/whisper|murmur|mutter/.test(t)) deliveryStyle = "whisper";
        else if (/flirt|purr|tease|wink/.test(t) || emotion.includes("flirt")) deliveryStyle = "flirtatious";
        else if (/shout|yell|scream|bellow/.test(t)) deliveryStyle = "shouting";
    }

    // Physical state.
    let physicalState = (tag(raw, "physical") || tag(raw, "state") || "").toLowerCase();
    if (!physicalState) {
        const t = clean.toLowerCase();
        if (/exhaust|weary|out of breath|panting/.test(t)) physicalState = "exhausted";
        else if (/injur|wounded|bleeding|hurt/.test(t)) physicalState = "injured";
        else physicalState = "normal";
    }

    // Interruption: explicit tag or em-dash cut.
    const interruption = hasTag(raw, "interrupt") || /[—–-]\s*$/.test(clean) || /^\s*[—–-]/.test(clean);

    // Physical action CONNECTED to the line (e.g. *slams the table*).
    const actionTag = tag(raw, "action");
    const emphasized = /\*([^*]+)\*/g;
    let physicalAction = !!actionTag;
    let physicalForce = level(tag(raw, "force"), null);
    const forceVerbs = /(slam|smash|strike|punch|kick|throw|shove|pound|hit|bang|crash)/i;
    let m;
    while ((m = emphasized.exec(clean)) !== null) {
        if (forceVerbs.test(m[1])) { physicalAction = true; if (physicalForce == null) physicalForce = 0.7; }
    }
    if (physicalAction && physicalForce == null) physicalForce = 0.6;

    return {
        speakerId: String(speaker || "").trim(),
        emotion,
        emotionalIntensity: intensity,
        composure,
        urgency,
        confidence,
        hostility,
        fear,
        physicalState,
        deliveryStyle,
        interruption,
        relationshipPressure,
        physicalAction,
        physicalForce: physicalForce == null ? 0 : physicalForce,
    };
}

// ---------------------------------------------------------------------------
// Environment events (screen)
// ---------------------------------------------------------------------------

// Explicit tag value -> semantic env type.
const EXPLICIT_MAP = {
    door_slam: "door_slam", doorslam: "door_slam", door: "door_slam",
    table: "table_impact", table_impact: "table_impact", slam: "table_impact",
    footsteps: "footsteps", explosion: "explosion", blast: "explosion",
    gunfire: "gunfire", gunshot: "gunfire", shot: "gunfire",
    thunder: "thunder", lightning: "lightning",
    earthquake: "earthquake", quake: "earthquake", tremor: "earthquake",
    collapse: "building_collapse",
    vehicle: "vehicle_movement", car: "vehicle_movement",
    magic: "magic_discharge", spell: "magic_discharge",
    blackout: "blackout", lights_out: "blackout",
    wind: "wind", rain: "rain", storm: "storm", snow: "snow", fog: "fog",
    crowd: "crowd_surge",
    lighting: "lighting_change", light: "lighting_change",
    camera: "camera_focus", focus: "camera_focus",
    scene: "scene_transition", location: "location_transition", time: "time_transition",
    foreground: "foreground_move",
};

// Conservative keyword cues (must describe a real physical/environmental event).
const KEYWORD_CUES = [
    { re: /\b(door\s+(?:slam(?:s|med)?|bang(?:s|ed)?)|slam(?:s|med)?\s+the\s+door)\b/i, type: "door_slam", intensity: 0.6 },
    { re: /\b(slam(?:s|med)?|pound(?:s|ed)?|bang(?:s|ed)?|fist)\b[^.?!]*\btable\b/i, type: "table_impact", intensity: 0.5 },
    { re: /\bexplosion|explodes?|detonat|blast\b/i, type: "explosion", intensity: 1.0 },
    { re: /\bgun(?:shot|fire)|gunshots?|fires?\s+(?:a|the|his|her)\s+(?:gun|pistol|rifle)|bang\s+of\s+a\s+gun\b/i, type: "gunfire", intensity: 0.75 },
    { re: /\bthunder(?:claps?|s)?\b/i, type: "thunder", intensity: 0.7 },
    { re: /\blightning\b/i, type: "lightning", intensity: 0.8 },
    { re: /\bearthquake|the\s+ground\s+(?:shakes?|trembles?)|the\s+floor\s+(?:shakes?|trembles?)\b/i, type: "earthquake", intensity: 0.9 },
    { re: /\b(?:building|ceiling|structure)\s+collaps/i, type: "building_collapse", intensity: 1.0 },
    { re: /\b(?:footsteps?|boots?)\s+(?:approach|echo|thud|pound|draw near)/i, type: "footsteps", intensity: 0.25 },
    { re: /\bcrowd\s+(?:surge|push|roar|swell)/i, type: "crowd_surge", intensity: 0.5 },
    { re: /\b(?:car|truck|engine|vehicle)\s+(?:roars?|speeds?|rushes?|passes?)/i, type: "vehicle_movement", intensity: 0.35 },
    { re: /\b(?:the\s+lights?\s+(?:go|went|cut)\s+out|blackout|pitch\s+dark)\b/i, type: "blackout", intensity: 1.0 },
];

export function deriveEnvironmentEvents({ text } = {}) {
    const raw = String(text || "");
    const events = [];
    const seen = new Set();

    const push = (type, extra = {}) => {
        if (!type || seen.has(type)) return;
        seen.add(type);
        events.push({ type, ...extra });
    };

    // 1) Explicit tags win: [event:X] [sfx:X] [screen:X] [env:X]
    for (const key of ["event", "sfx", "screen", "env", "fx"]) {
        const re = new RegExp(`\\[\\s*${key}\\s*:\\s*([^\\]]+)\\]`, "ig");
        let m;
        while ((m = re.exec(raw)) !== null) {
            const val = String(m[1] || "").trim().toLowerCase().replace(/\s+/g, "_");
            const type = EXPLICIT_MAP[val] || (Object.values(EXPLICIT_MAP).includes(val) ? val : null);
            if (type) push(type);
        }
    }

    // 2) Direction / intensity hints from tags (applied to all derived events).
    const dir = tag(raw, "direction") || tag(raw, "from") || null;
    const clean = raw.replace(/\[[^\]]*\]/g, " ");

    // 3) Conservative keyword cues (physical/environmental only).
    for (const cue of KEYWORD_CUES) {
        if (cue.re.test(clean)) push(cue.type, { intensity: cue.intensity, ...(dir ? { direction: dir } : {}) });
    }

    return events;
}

export { EXPLICIT_MAP };
