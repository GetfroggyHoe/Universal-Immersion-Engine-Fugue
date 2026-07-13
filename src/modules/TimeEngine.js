import { getSettings, saveSettings } from "./core.js";
import { ensureGameModeState, renderModeHud } from "./gameModeManager.js";
import { processTransitQueue } from "./CommunicationsManager.js";
import { processDebuffTicks } from "./PenaltyManager.js";

export function getCurrentTime() {
    const s = ensureGameModeState(getSettings());
    return Number(s.world.currentTime || Date.now()) || Date.now();
}

export async function advanceTime(hours) {
    const amount = Math.max(0, Number(hours || 0));
    if (amount <= 0) return getCurrentTime();
    const s = ensureGameModeState(getSettings());
    s.world.currentTime = (Number(s.world.currentTime || Date.now()) || Date.now()) + amount * 3600000;
    saveSettings();
    processDebuffTicks(amount);
    await processTransitQueue();
    renderModeHud();
    try { window.dispatchEvent(new CustomEvent("uie:time_advanced", { detail: { hours: amount, currentTime: s.world.currentTime } })); } catch (_) {}
    return s.world.currentTime;
}

export function initTimeEngine() {
    ensureGameModeState(getSettings());
    try { window.UIE = window.UIE || {}; window.UIE.time = { advanceTime, getCurrentTime }; window.advanceTime = advanceTime; } catch (_) {}
}
