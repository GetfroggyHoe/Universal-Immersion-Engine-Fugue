// Layered VN Animation System — public facade
// ---------------------------------------------------------------------------
// One clean entry point that wires the four independent controllers together
// and exposes the required API:
//
//   playDialogueAnimation(state)          -> DialogueAnimationController
//   playEnvironmentEvent(event)           -> EnvironmentAnimationController
//   startAmbientEffect(effect)            -> AmbientEffectController
//   stopAmbientEffect(effectId)           -> AmbientEffectController
//   clearSceneAnimations()                -> all controllers
//   setReducedMotion(enabled)             -> reduced-motion manager
//   registerCharacterMotionProfile(id, p) -> CharacterMotionProfiles
//
// Chat-box animation (the speaker as a person) and screen animation (the
// environment) are STRICTLY separate systems. When a single narrative beat
// contains both a line and a physical action, both systems activate
// independently.
//
// The narrative layer only ever provides SEMANTIC information (tags, flags,
// keywords). This module resolves that into approved animations. Malformed
// model output can never inject CSS classes, keyframes, selectors, or raw
// animation code because none of that is accepted here.
// ---------------------------------------------------------------------------

import { dialogueAnimationController } from "./dialogueAnimationController.js";
import { environmentAnimationController } from "./environmentAnimationController.js";
import { ambientEffectController } from "./ambientEffectController.js";
import { animationPriorityManager } from "./animationPriorityManager.js";
import { characterMotionProfiles } from "./characterMotionProfiles.js";
import { characterSpriteController } from "./characterSpriteController.js";
import { initReducedMotion, setReducedMotion as setRM, isReducedMotion, ensureForegroundLayer } from "./layers.js";
import { deriveSpeakerState, deriveEnvironmentEvents } from "./semanticExtract.js";
import { initLive2DRenderer } from "../live2dRenderer.js";

const CSS_HREF = "./src/styles/layeredAnimations.css";
const CSS_ID = "uie-layered-animations-css";

function ensureStylesheet() {
    try {
        if (typeof document === "undefined") return;
        if (document.getElementById(CSS_ID)) return;
        // Only inject if it isn't already linked (game.html links it directly).
        const existing = Array.from(document.querySelectorAll("link[rel=stylesheet]"))
            .some((l) => String(l.getAttribute("href") || "").includes("layeredAnimations.css"));
        if (existing) return;
        const link = document.createElement("link");
        link.id = CSS_ID;
        link.rel = "stylesheet";
        const base = (typeof window !== "undefined" && window.UIE_BASEURL) ? String(window.UIE_BASEURL) : "";
        link.href = base ? `${base.replace(/\/$/, "")}/src/styles/layeredAnimations.css` : CSS_HREF;
        document.head.appendChild(link);
    } catch (_) {}
}

export class LayeredAnimationSystem {
    constructor() {
        this.dialogue = dialogueAnimationController;
        this.environment = environmentAnimationController;
        this.ambient = ambientEffectController;
        this.priority = animationPriorityManager;
        this.profiles = characterMotionProfiles;
        this.character = characterSpriteController;
        this._inited = false;
    }

    init() {
        if (this._inited) return this;
        this._inited = true;
        ensureStylesheet();
        initReducedMotion();
        try { ensureForegroundLayer(); } catch (_) {}
        // Install the real Live2D runtime hooks (character-sprite renderer).
        try { initLive2DRenderer(); } catch (_) {}
        return this;
    }

    // ---- Chat-box (speaker-as-person) -------------------------------------
    playDialogueAnimation(state) {
        try { return this.dialogue.playDialogueAnimation(state || {}); }
        catch (e) { console.error("[LayeredAnim] dialogue error", e); return null; }
    }

    // ---- Screen / environment ---------------------------------------------
    playEnvironmentEvent(event) {
        try { return this.environment.playEnvironmentEvent(event || {}); }
        catch (e) { console.error("[LayeredAnim] environment error", e); return null; }
    }

    startAmbientEffect(effect) {
        try { return this.ambient.startAmbientEffect(effect || {}); }
        catch (e) { console.error("[LayeredAnim] ambient start error", e); return null; }
    }

    stopAmbientEffect(effectId) {
        try { return this.ambient.stopAmbientEffect(effectId); }
        catch (e) { console.error("[LayeredAnim] ambient stop error", e); return false; }
    }

    // ---- Lifecycle / accessibility ----------------------------------------
    clearSceneAnimations() {
        try { this.dialogue.reset(); } catch (_) {}
        try { this.environment.clear(); } catch (_) {}
        try { this.ambient.clear(); } catch (_) {}
        try { this.priority.clear(); } catch (_) {}
        try { this.character.reset(); } catch (_) {}
    }

    setReducedMotion(enabled) {
        return setRM(enabled);
    }

    isReducedMotion() {
        return isReducedMotion();
    }

    registerCharacterMotionProfile(speakerId, profile) {
        return this.profiles.register(speakerId, profile);
    }

    unregisterCharacterMotionProfile(speakerId) {
        return this.profiles.unregister(speakerId);
    }

    // ---- Convenience: one narrative beat -> both systems independently -----
    // The narrative layer passes raw message data; we derive SEMANTIC state and
    // events and dispatch dialogue + environment on their own tracks. This is
    // where chat-box and screen animation are guaranteed to stay decoupled.
    processNarrative({ speaker, text, isUser = false, isStory = false } = {}) {
        const result = { dialogue: null, character: null, environment: [] };

        // 1) Chat-box + character-sprite (Live2D) share ONE semantic state but
        //    render on their own independent layers.
        if (!isStory) {
            const state = deriveSpeakerState({ speaker, text, isUser });
            result.dialogue = this.playDialogueAnimation(state);
            result.character = this.playCharacterAnimation(state);
        }

        // 2) Screen animation ONLY from explicit physical/environmental cues.
        const events = deriveEnvironmentEvents({ text });
        for (const ev of events) {
            result.environment.push(this.playEnvironmentEvent(ev));
        }
        return result;
    }

    // Character-sprite (Live2D) track — independent from the dialogue box.
    playCharacterAnimation(state) {
        try { return this.character.playCharacterAnimation(state || {}); }
        catch (e) { console.error("[LayeredAnim] character error", e); return null; }
    }
}

export const layeredAnimation = new LayeredAnimationSystem();

export function initLayeredAnimation() {
    layeredAnimation.init();
    if (typeof window !== "undefined") {
        window.UIEAnim = layeredAnimation;
    }
    return layeredAnimation;
}

export default layeredAnimation;
