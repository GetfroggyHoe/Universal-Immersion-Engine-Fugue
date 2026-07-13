// Animation Priority Manager
// ---------------------------------------------------------------------------
// Arbitrates ENVIRONMENT events across layers so higher-priority events are
// never accidentally replaced by low-priority ambient effects, while
// compatible ambient effects are allowed to continue underneath a high-priority
// reaction when appropriate.
//
// It tracks per-layer "claims" (an active animation owning a layer for a
// duration) and answers whether a new event may play, which layers are
// blocked, and whether ambient effects should be suppressed.
// ---------------------------------------------------------------------------

export const EventCategory = {
    AMBIENT: "ambient",
    MOVEMENT: "movement",
    WEATHER: "weather",
    NEARBY_ACTION: "nearby_action",
    IMPACT: "impact",
    DANGER: "danger",
    CINEMATIC: "cinematic",
};

export const EnvironmentMode = {
    AMBIENT: "ambient",       // persistent & stackable
    REACTION: "reaction",     // short physical response
    OVERRIDE: "override",     // temporarily controls the scene
    TRANSITION: "transition", // changes scene/location/camera/time
};

const CATEGORY_PRIORITY = {
    [EventCategory.AMBIENT]: 0,
    [EventCategory.MOVEMENT]: 1,
    [EventCategory.WEATHER]: 2,
    [EventCategory.NEARBY_ACTION]: 3,
    [EventCategory.IMPACT]: 4,
    [EventCategory.DANGER]: 5,
    [EventCategory.CINEMATIC]: 6,
};

function now() {
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
}

export function priorityForCategory(category) {
    const key = String(category || "").toLowerCase();
    return CATEGORY_PRIORITY[key] != null ? CATEGORY_PRIORITY[key] : 0;
}

export class AnimationPriorityManager {
    constructor() {
        // layerName -> array of active claims { id, priority, mode, until, category }
        this._claims = new Map();
        this._seq = 0;
    }

    _prune(layer) {
        const list = this._claims.get(layer);
        if (!list) return [];
        const t = now();
        const alive = list.filter((c) => c.until > t);
        if (alive.length) this._claims.set(layer, alive);
        else this._claims.delete(layer);
        return alive;
    }

    // Highest active priority currently owning a layer.
    activePriority(layer) {
        const alive = this._prune(layer);
        return alive.reduce((max, c) => Math.max(max, c.priority), -1);
    }

    // Is any override/transition currently controlling a layer?
    isOverridden(layer) {
        const alive = this._prune(layer);
        return alive.some((c) => c.mode === EnvironmentMode.OVERRIDE || c.mode === EnvironmentMode.TRANSITION);
    }

    // Decide whether an event may play, and how it interacts with ambients.
    // Returns { allowed, blockedLayers, layers, priority, suppressAmbient }.
    arbitrate(event = {}) {
        const category = String(event.category || EventCategory.AMBIENT).toLowerCase();
        const mode = String(event.mode || EnvironmentMode.REACTION).toLowerCase();
        const priority = Number.isFinite(event.priority) ? Number(event.priority) : priorityForCategory(category);
        const layers = Array.isArray(event.affectedLayers) && event.affectedLayers.length
            ? event.affectedLayers.slice()
            : ["camera_viewport"];

        const blockedLayers = [];
        for (const layer of layers) {
            const active = this.activePriority(layer);
            // A strictly higher-priority override/transition blocks lower events.
            if (active > priority && this.isOverridden(layer)) {
                blockedLayers.push(layer);
            }
        }

        // Ambient events yield entirely to any active higher-priority claim.
        const allowed = mode === EnvironmentMode.AMBIENT
            ? blockedLayers.length === 0
            : blockedLayers.length < layers.length; // reactions may play on free layers

        // A high-priority reaction/override/transition suppresses INCOMPATIBLE
        // ambient effects; compatible ambients are handled by the ambient
        // controller. We flag suppression only for override/transition or
        // danger/cinematic-tier reactions.
        const suppressAmbient = (mode === EnvironmentMode.OVERRIDE || mode === EnvironmentMode.TRANSITION)
            || priority >= CATEGORY_PRIORITY[EventCategory.DANGER];

        return { allowed, blockedLayers, layers, priority, mode, category, suppressAmbient };
    }

    // Register a claim on the given layers for a duration.
    claim(layers, { priority = 0, mode = EnvironmentMode.REACTION, category = EventCategory.AMBIENT, durationMs = 500, id = null } = {}) {
        const claimId = id || `claim_${++this._seq}`;
        const until = now() + Math.max(1, durationMs);
        for (const layer of layers) {
            const list = this._claims.get(layer) || [];
            list.push({ id: claimId, priority, mode, category, until });
            this._claims.set(layer, list);
        }
        return claimId;
    }

    release(claimId) {
        for (const [layer, list] of this._claims.entries()) {
            const next = list.filter((c) => c.id !== claimId);
            if (next.length) this._claims.set(layer, next);
            else this._claims.delete(layer);
        }
    }

    // Snapshot of active claims for diagnostics.
    getState() {
        const out = {};
        for (const layer of this._claims.keys()) {
            out[layer] = this._prune(layer).map((c) => ({ priority: c.priority, mode: c.mode, category: c.category }));
        }
        return out;
    }

    clear() {
        this._claims.clear();
    }
}

export const animationPriorityManager = new AnimationPriorityManager();
export { CATEGORY_PRIORITY };
