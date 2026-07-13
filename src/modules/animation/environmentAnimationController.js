// Environment Animation Controller
// ---------------------------------------------------------------------------
// Owns SCREEN / ENVIRONMENT animation. Screen animations represent the world,
// camera, atmosphere, location, and physical events — NOT a speaker's feelings.
// A character merely speaking angrily must never reach this controller; only
// real physical/atmospheric/spatial events do.
//
// It consumes SEMANTIC environment events (pure data — never CSS/DOM/selectors)
// and:
//   - arbitrates them through the AnimationPriorityManager (per affected layer),
//   - routes them by mode: ambient | reaction | override | transition,
//   - animates ONLY the affected layers (never the root unless affectsUI),
//   - degrades shakes/zoom/parallax to fades under reduced motion,
//   - reuses the sceneEffects overlay layer for big overlays,
//   - claims/releases layers so higher-priority events aren't stomped.
// ---------------------------------------------------------------------------

import {
    animationPriorityManager,
    EnvironmentMode,
    EventCategory,
    priorityForCategory,
} from "./animationPriorityManager.js";
import { ambientEffectController } from "./ambientEffectController.js";
import { Layer, resolveLayer, resolveLayers, isReducedMotion, ensureForegroundLayer } from "./layers.js";

const MAX_DURATION_MS = 7000;

// Semantic event-type registry. Each entry declares sensible defaults so the
// narrative layer only needs to send a `type`. Explicit event fields override.
// `kind`: how the reaction is rendered — "camera" | "prop" | "shake" | "macro".
const EVENT_DEFS = {
    // impacts / nearby action
    door_slam:        { mode: "reaction", category: "impact", kind: "camera", layers: ["camera_viewport", "foreground_props"], intensity: 0.6 },
    table_impact:     { mode: "reaction", category: "impact", kind: "camera", layers: ["camera_viewport", "foreground_props"], intensity: 0.45 },
    footsteps:        { mode: "reaction", category: "nearby_action", kind: "camera", layers: ["camera_viewport"], intensity: 0.18 },
    crowd_surge:      { mode: "reaction", category: "nearby_action", kind: "camera", layers: ["camera_viewport", "character_sprites"], intensity: 0.4 },
    // danger
    explosion:        { mode: "override", category: "danger", kind: "macro", macro: "EXPLOSION", layers: ["camera_viewport", "environment_background", "environment_effects"], intensity: 1.0 },
    gunfire:          { mode: "reaction", category: "danger", kind: "shake", layers: ["camera_viewport"], intensity: 0.7 },
    magic_discharge:  { mode: "reaction", category: "danger", kind: "macro", macro: "PSYCHIC", layers: ["camera_viewport", "environment_effects"], intensity: 0.7 },
    earthquake:       { mode: "override", category: "danger", kind: "macro", macro: "EARTHQUAKE", layers: ["camera_viewport", "environment_background", "foreground_props"], intensity: 0.9 },
    building_collapse:{ mode: "override", category: "danger", kind: "macro", macro: "EARTHQUAKE", layers: ["camera_viewport", "environment_background", "foreground_props"], intensity: 1.0 },
    // vehicle
    vehicle_movement: { mode: "reaction", category: "movement", kind: "camera", layers: ["camera_viewport"], intensity: 0.3 },
    // weather / atmosphere (reaction flashes; persistent handled as ambient)
    thunder:          { mode: "reaction", category: "weather", kind: "macro", macro: "THUNDER", layers: ["environment_effects"], intensity: 0.7, affectsUI: false },
    lightning:        { mode: "reaction", category: "weather", kind: "macro", macro: "THUNDER", layers: ["environment_effects"], intensity: 0.8 },
    wind:             { mode: "ambient", category: "weather", ambient: "dust" },
    rain:             { mode: "ambient", category: "weather", ambient: "rain" },
    storm:            { mode: "ambient", category: "weather", ambient: "storm" },
    snow:             { mode: "ambient", category: "weather", ambient: "snow" },
    fog:              { mode: "ambient", category: "weather", ambient: "fog" },
    // lighting
    blackout:         { mode: "override", category: "cinematic", kind: "macro", macro: "BLACKOUT", layers: ["environment_background", "environment_effects", "character_sprites"], intensity: 1.0, affectsUI: false },
    lighting_change:  { mode: "reaction", category: "ambient", kind: "prop", layers: ["environment_background"], intensity: 0.3 },
    // camera / scene
    camera_focus:     { mode: "reaction", category: "cinematic", kind: "camera", layers: ["camera_viewport"], intensity: 0.35 },
    location_transition:{ mode: "transition", category: "cinematic", kind: "transition", layers: ["environment_background", "environment_effects", "character_sprites"], intensity: 0.8 },
    time_transition:  { mode: "transition", category: "cinematic", kind: "transition", layers: ["environment_background", "environment_effects"], intensity: 0.6 },
    scene_transition: { mode: "transition", category: "cinematic", kind: "transition", layers: ["environment_background", "environment_effects", "character_sprites"], intensity: 0.9 },
    // foreground
    foreground_move:  { mode: "reaction", category: "movement", kind: "prop", layers: ["foreground_props"], intensity: 0.5 },
};

function clamp(v, lo, hi, dflt) {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
}

// Direction string/number -> unit vector.
function directionVector(direction) {
    if (direction == null) return { x: 1, y: 0.4 };
    if (typeof direction === "number") {
        const rad = direction * Math.PI / 180;
        return { x: Math.cos(rad), y: Math.sin(rad) };
    }
    const d = String(direction).toLowerCase();
    const map = {
        left: { x: -1, y: 0 }, west: { x: -1, y: 0 },
        right: { x: 1, y: 0 }, east: { x: 1, y: 0 },
        up: { x: 0, y: -1 }, north: { x: 0, y: -1 },
        down: { x: 0, y: 1 }, south: { x: 0, y: 1 },
        center: { x: 0, y: 0 },
    };
    return map[d] || { x: 1, y: 0.4 };
}

export class EnvironmentAnimationController {
    constructor() {
        this._activeWAAPI = new Set(); // live Animation objects for cleanup
    }

    // Public entry. `event` is pure semantic data.
    playEnvironmentEvent(event = {}) {
        const type = String(event.type || "").toLowerCase();
        const def = EVENT_DEFS[type] || {};
        const mode = String(event.mode || def.mode || EnvironmentMode.REACTION).toLowerCase();
        const category = String(event.category || def.category || EventCategory.NEARBY_ACTION).toLowerCase();
        const priority = Number.isFinite(event.priority) ? Number(event.priority) : priorityForCategory(category);
        const intensity = clamp(event.intensity, 0, 1, def.intensity != null ? def.intensity : 0.5);
        const affectedLayers = Array.isArray(event.affectedLayers) && event.affectedLayers.length
            ? event.affectedLayers.slice()
            : (def.layers ? def.layers.slice() : [Layer.CAMERA_VIEWPORT]);
        const affectsUI = event.affectsUI === true || def.affectsUI === true;
        const durationMs = clamp(event.duration || event.durationMs, 60, MAX_DURATION_MS, this._defaultDuration(mode, category));

        // Ambient mode is delegated to the ambient controller (stackable).
        if (mode === EnvironmentMode.AMBIENT) {
            const ambientType = event.ambient || def.ambient || type;
            const id = ambientEffectController.startAmbientEffect({
                id: event.id || ambientType,
                type: ambientType,
                params: event,
            });
            return { played: !!id, mode, id, layers: [] };
        }

        // Arbitrate against active claims (priority protection).
        const decision = animationPriorityManager.arbitrate({
            category, mode, priority,
            affectedLayers,
        });
        if (!decision.allowed) {
            return { played: false, mode, blocked: true, blockedLayers: decision.blockedLayers };
        }

        // Overrides / transitions temporarily take the scene: hide ambients.
        if (mode === EnvironmentMode.OVERRIDE || mode === EnvironmentMode.TRANSITION) {
            if (decision.suppressAmbient) ambientEffectController.suppressAll();
        }

        // Claim the layers this event will control for its duration.
        const claimId = animationPriorityManager.claim(affectedLayers, {
            priority, mode, category, durationMs, id: event.id,
        });

        // Render.
        const kind = String(event.kind || def.kind || "camera").toLowerCase();
        const dir = directionVector(event.direction);
        const ctx = { intensity, durationMs, dir, affectsUI };

        if (mode === EnvironmentMode.TRANSITION || kind === "transition") {
            this._runTransition(event, def, ctx, affectedLayers);
        } else if (kind === "macro") {
            this._runMacro(event.macro || def.macro, ctx);
            this._playOnLayers(affectedLayers, "camera", { ...ctx, intensity: intensity * 0.5 });
        } else {
            this._playOnLayers(affectedLayers, kind, ctx);
        }

        // Root is only touched when the event explicitly affects the whole UI.
        if (affectsUI) {
            this._playOnLayers([Layer.HUD], "camera", { ...ctx, intensity: intensity * 0.4 });
        }

        // Release the claim + restore ambients after the event completes.
        const restore = () => {
            animationPriorityManager.release(claimId);
            if (mode === EnvironmentMode.OVERRIDE && decision.suppressAmbient) {
                ambientEffectController.restoreSuppressed();
            }
        };
        setTimeout(restore, durationMs + 60);

        return { played: true, mode, claimId, layers: affectedLayers, priority };
    }

    _defaultDuration(mode, category) {
        if (mode === EnvironmentMode.TRANSITION) return 900;
        if (mode === EnvironmentMode.OVERRIDE) return 1400;
        if (category === EventCategory.DANGER) return 620;
        if (category === EventCategory.CINEMATIC) return 700;
        return 420;
    }

    // Apply a transient, transform-only reaction on each affected layer.
    _playOnLayers(layers, kind, ctx) {
        if (layers.includes(Layer.FOREGROUND_PROPS)) ensureForegroundLayer();
        const resolved = resolveLayers(layers);
        for (const { name, el } of resolved) {
            if (name === Layer.ROOT && !ctx.affectsUI) continue; // never animate root implicitly
            this._animateElement(el, kind, ctx);
        }
    }

    _animateElement(el, kind, ctx) {
        if (!el || typeof el.animate !== "function") return null;
        try {
            const cs = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
            if (cs && (cs.display === "none" || cs.visibility === "hidden")) return null; // don't animate hidden
        } catch (_) {}

        const reduced = isReducedMotion();
        const dur = Math.round(ctx.durationMs);

        // Reduced motion: replace movement/zoom/shake with a subtle opacity dip.
        if (reduced) {
            const anim = el.animate(
                [{ opacity: 1 }, { opacity: 0.82, offset: 0.4 }, { opacity: 1 }],
                { duration: Math.min(260, dur), easing: "ease" }
            );
            this._track(anim);
            return anim;
        }

        const i = ctx.intensity;
        let keyframes;
        let easing = "cubic-bezier(0.36,0.07,0.19,0.97)";
        if (kind === "shake") {
            keyframes = [
                { transform: "translate(0,0)" },
                { transform: `translate(${-8 * i}px, ${3 * i}px)`, offset: 0.15 },
                { transform: `translate(${7 * i}px, ${-3 * i}px)`, offset: 0.35 },
                { transform: `translate(${-5 * i}px, ${2 * i}px)`, offset: 0.55 },
                { transform: `translate(${3 * i}px, 0)`, offset: 0.75 },
                { transform: "translate(0,0)" },
            ];
        } else if (kind === "prop") {
            easing = "cubic-bezier(0.2,0.8,0.3,1)";
            keyframes = [
                { transform: "translateY(0) rotate(0)" },
                { transform: `translateY(${-4 * i}px) rotate(${0.8 * i}deg)`, offset: 0.3 },
                { transform: `translateY(0) rotate(${-0.4 * i}deg)`, offset: 0.65 },
                { transform: "translateY(0) rotate(0)" },
            ];
        } else { // camera jolt (directional)
            easing = "cubic-bezier(0.22,0.61,0.36,1)";
            const dx = ctx.dir.x * 9 * i;
            const dy = ctx.dir.y * 6 * i;
            keyframes = [
                { transform: "translate(0,0) scale(1)" },
                { transform: `translate(${dx}px, ${dy}px) scale(${1 + 0.006 * i})`, offset: 0.18 },
                { transform: `translate(${dx * -0.55}px, ${dy * -0.5}px) scale(1)`, offset: 0.5 },
                { transform: `translate(${dx * 0.25}px, 0) scale(1)`, offset: 0.75 },
                { transform: "translate(0,0) scale(1)" },
            ];
        }
        const anim = el.animate(keyframes, { duration: dur, easing, fill: "none" });
        this._track(anim);
        return anim;
    }

    _runMacro(macro, ctx) {
        if (!macro) return;
        try {
            const api = (typeof window !== "undefined") ? window.UIEEffects : null;
            if (api && typeof api.runSceneMacro === "function") {
                if (isReducedMotion()) {
                    // Only allow non-motion overlays under reduced motion.
                    const gentle = ["BLACKOUT", "THUNDER", "MEMO"];
                    if (gentle.includes(String(macro).toUpperCase())) api.runSceneMacro(String(macro).toUpperCase());
                    return;
                }
                api.runSceneMacro(String(macro).toUpperCase());
            }
        } catch (_) {}
    }

    _runTransition(event, def, ctx, layers) {
        const api = (typeof window !== "undefined") ? window.UIEEffects : null;
        // Cross-fade the affected environment layers.
        const resolved = resolveLayers(layers);
        const dur = Math.round(ctx.durationMs);
        for (const { name, el } of resolved) {
            if (!el || typeof el.animate !== "function") continue;
            const anim = el.animate(
                [{ opacity: 1, filter: "none" }, { opacity: 0.15, filter: "blur(6px)", offset: 0.5 }, { opacity: 1, filter: "none" }],
                { duration: dur, easing: "ease-in-out", fill: "none" }
            );
            this._track(anim);
        }
        // Optional letterbox flourish for cinematic scene transitions.
        if (!isReducedMotion() && api && typeof api.letterbox === "function" && event.cinematic) {
            try { api.letterbox({ duration: 500 }); setTimeout(() => api.clearLetterbox?.(), dur + 400); } catch (_) {}
        }
    }

    _track(anim) {
        if (!anim) return;
        this._activeWAAPI.add(anim);
        const done = () => this._activeWAAPI.delete(anim);
        try { anim.finished.then(done).catch(done); } catch (_) { setTimeout(done, 3000); }
    }

    // Cancel every in-flight environment animation (scene change).
    clear() {
        for (const anim of this._activeWAAPI) {
            try { anim.cancel(); } catch (_) {}
        }
        this._activeWAAPI.clear();
        animationPriorityManager.clear();
    }
}

export const environmentAnimationController = new EnvironmentAnimationController();
export { EVENT_DEFS };
