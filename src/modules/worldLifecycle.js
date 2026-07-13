import { getSettings, saveSettings } from "./core.js";

const WORLD_LIFECYCLE_VERSION = "1.0.0";
let initialized = false;

function ensureWorldLifecycleState(s) {
    if (!s || typeof s !== "object") return null;
    if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
    const ws = s.worldState;
    if (!ws.lifecycle || typeof ws.lifecycle !== "object") ws.lifecycle = {};
    const life = ws.lifecycle;
    if (!Number.isFinite(Number(life.tickCount))) life.tickCount = 0;
    if (!Array.isArray(life.recentTicks)) life.recentTicks = [];
    return life;
}

function snapshotClock(s) {
    const room = s?.playerRoom || {};
    return {
        day: Number(room.day || 1),
        hour: Number(room.hour || 8),
        minute: Number(room.minute || 0),
        timeOfDay: String(s?.worldState?.time || ""),
        location: String(s?.worldState?.location || s?.world?.location || ""),
    };
}

function dispatchWorldTick(reason, detail = {}) {
    const s = getSettings();
    const life = ensureWorldLifecycleState(s);
    if (!life) return null;

    const tick = {
        id: `tick_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        at: Date.now(),
        reason: String(reason || "world"),
        minutes: Math.max(0, Number(detail.minutes || detail.deltaMinutes || 0)),
        clock: snapshotClock(s),
    };

    life.tickCount += 1;
    life.lastTick = tick;
    life.recentTicks.unshift(tick);
    life.recentTicks = life.recentTicks.slice(0, 20);
    saveSettings();

    try {
        window.dispatchEvent(new CustomEvent("uie:world_tick", { detail: tick }));
    } catch (_) {}
    return tick;
}

function getWorldLifecycleSummary(s = getSettings()) {
    const life = ensureWorldLifecycleState(s) || {};
    return {
        version: WORLD_LIFECYCLE_VERSION,
        tickCount: Number(life.tickCount || 0),
        lastTick: life.lastTick || null,
        recentTicks: Array.isArray(life.recentTicks) ? life.recentTicks.slice(0, 10) : [],
    };
}

function initWorldLifecycle() {
    if (initialized) return;
    initialized = true;
    const s = getSettings();
    ensureWorldLifecycleState(s);

    try {
        window.UIE = window.UIE || {};
        window.UIE.worldLifecycle = {
            tick: (reason, detail) => dispatchWorldTick(reason, detail),
            getSummary: () => getWorldLifecycleSummary(getSettings()),
            version: WORLD_LIFECYCLE_VERSION,
        };
    } catch (_) {}

    try {
        window.addEventListener("uie:time_advanced", (e) => {
            dispatchWorldTick("time_advanced", e?.detail || {});
        });
    } catch (_) {}

    try {
        window.addEventListener("uie:location_changed", (e) => {
            dispatchWorldTick("location_changed", e?.detail || {});
        });
    } catch (_) {}
}

export {
    WORLD_LIFECYCLE_VERSION,
    ensureWorldLifecycleState,
    dispatchWorldTick,
    getWorldLifecycleSummary,
    initWorldLifecycle,
};
