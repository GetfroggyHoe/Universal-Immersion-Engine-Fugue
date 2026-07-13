// Ambient Effect Controller
// ---------------------------------------------------------------------------
// Owns PERSISTENT, STACKABLE environment ambience (rain, firelight, fog, wind,
// crowd motion, passing lights, ...). Ambient effects represent the world, not
// a speaker. Compatible ambients coexist; conflicting ones (same exclusive
// slot) replace each other. A high-priority override can temporarily suppress
// ambients and later restore them.
//
// The actual pixels are delegated to the existing sceneEffects layer
// (window.UIEEffects) so we reuse the project's proven, cleanup-safe overlay
// machinery instead of duplicating it. Everything here is bookkeeping +
// compatibility + lifecycle so ambient effects never leak.
// ---------------------------------------------------------------------------

// Semantic ambient definitions. `slot` decides compatibility: only one effect
// may occupy an exclusive slot at a time; different slots stack freely.
// `apply`/`remove` are resolved lazily against window.UIEEffects.
const AMBIENT_DEFS = {
    rain:        { slot: "precipitation", on: "rainOn", off: "rainOff" },
    storm:       { slot: "precipitation", on: "rainOn", off: "rainOff" },
    snow:        { slot: "precipitation", on: "snowOn", off: "snowOff" },
    fog:         { slot: "haze", on: "fogOn", off: "fogOff" },
    smoke:       { slot: "haze", on: "fogOn", off: "fogOff" },
    dust:        { slot: "airborne", on: "dustOn", off: "dustOff" },
    firelight:   { slot: "lighting", on: "fireplaceOn", off: "fireplaceOff" },
    fireplace:   { slot: "lighting", on: "fireplaceOn", off: "fireplaceOff" },
    shadows:     { slot: "shadow", on: "creepingShadows", off: "clearShadows" },
    // Generic macro-backed persistent ambients (different exclusive slots).
    scanlines:   { slot: "screen", macroOn: "MEMO" },
    toxic:       { slot: "atmosphere", macroOn: "TOXIC" },
    frost:       { slot: "atmosphere", macroOn: "FREEZE" },
    alarm:       { slot: "signal", macroOn: "ALARM" },
    laser:       { slot: "signal", macroOn: "LASER" },
};

function fx() {
    try { return (typeof window !== "undefined" && window.UIEEffects) ? window.UIEEffects : null; } catch (_) { return null; }
}

export class AmbientEffectController {
    constructor(opts = {}) {
        // id -> { id, type, slot, def, params }
        this._active = new Map();
        this._suppressed = new Map(); // id -> descriptor (for restore)
        this.maxConcurrent = Number.isFinite(opts.maxConcurrent) ? opts.maxConcurrent : 8;
    }

    _def(type) {
        return AMBIENT_DEFS[String(type || "").toLowerCase()] || null;
    }

    _resolveId(effect) {
        return String(effect.id || effect.effectId || effect.type || "").trim().toLowerCase();
    }

    // Start (or replace) an ambient effect. Returns the effect id or null.
    startAmbientEffect(effect = {}) {
        const type = String(effect.type || effect.id || "").toLowerCase();
        const def = this._def(type);
        if (!def) {
            // Unknown ambient type — ignore rather than injecting raw commands.
            return null;
        }
        const id = this._resolveId(effect) || type;

        // Same id already active -> no-op (avoid re-adding identical effect).
        if (this._active.has(id)) return id;

        // Compatibility: evict any active effect sharing this exclusive slot.
        if (def.slot) {
            for (const [activeId, rec] of this._active.entries()) {
                if (rec.slot === def.slot) this.stopAmbientEffect(activeId);
            }
        }

        // Concurrency cap: drop the oldest if we exceed the limit.
        if (this._active.size >= this.maxConcurrent) {
            const oldest = this._active.keys().next().value;
            if (oldest) this.stopAmbientEffect(oldest);
        }

        this._applyDef(def);
        this._active.set(id, { id, type, slot: def.slot, def, params: effect.params || null });
        return id;
    }

    _applyDef(def) {
        const api = fx();
        if (!api) return;
        try {
            if (def.on && typeof api[def.on] === "function") api[def.on]();
            else if (def.macroOn && typeof api.runSceneMacro === "function") api.runSceneMacro(def.macroOn);
        } catch (_) {}
    }

    _removeDef(def, id) {
        const api = fx();
        if (!api) return;
        try {
            if (def.off && typeof api[def.off] === "function") api[def.off]();
            else if (typeof api.clearEffect === "function") {
                // Macro-backed persistent effects register under known names.
                api.clearEffect(id);
                api.clearEffect(String(def.macroOn || "").toLowerCase());
            }
        } catch (_) {}
    }

    stopAmbientEffect(effectId) {
        const id = String(effectId || "").trim().toLowerCase();
        const rec = this._active.get(id);
        if (!rec) return false;
        this._removeDef(rec.def, id);
        this._active.delete(id);
        return true;
    }

    isActive(effectId) {
        return this._active.has(String(effectId || "").trim().toLowerCase());
    }

    listActive() {
        return Array.from(this._active.values()).map((r) => ({ id: r.id, type: r.type, slot: r.slot }));
    }

    // Temporarily hide all ambients (used when an override/transition takes the
    // scene). Records them so they can be restored afterwards.
    suppressAll() {
        for (const [id, rec] of this._active.entries()) {
            this._removeDef(rec.def, id);
            this._suppressed.set(id, rec);
        }
        this._active.clear();
    }

    // Restore ambients hidden by suppressAll().
    restoreSuppressed() {
        for (const [id, rec] of this._suppressed.entries()) {
            this._applyDef(rec.def);
            this._active.set(id, rec);
        }
        this._suppressed.clear();
    }

    // Full cleanup for scene changes.
    clear() {
        for (const [id, rec] of this._active.entries()) {
            this._removeDef(rec.def, id);
        }
        this._active.clear();
        this._suppressed.clear();
    }
}

export const ambientEffectController = new AmbientEffectController();
export { AMBIENT_DEFS };
