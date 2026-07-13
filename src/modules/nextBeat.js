import { getSettings, saveSettings } from "./core.js";

function ensureNextBeatState() {
    const s = getSettings?.() || {};
    if (!s.ui || typeof s.ui !== "object") s.ui = {};
    if (typeof s.ui.priorityBeatPrompt !== "string") s.ui.priorityBeatPrompt = "";
    return s;
}

function readNextBeatInput() {
    return document.getElementById("next-beat-input");
}

function normalizeNextBeatPrompt(value) {
    return String(value || "").trim();
}

function syncNextBeatInput(value) {
    const nextBeatInput = readNextBeatInput();
    if (nextBeatInput && String(nextBeatInput.value || "") !== String(value || "")) {
        nextBeatInput.value = String(value || "");
    }
}

function setNextBeatPrompt(value = "") {
    const s = ensureNextBeatState();
    const prompt = String(value || "");
    s.ui.priorityBeatPrompt = prompt;
    syncNextBeatInput(prompt);
    try {
        saveSettings?.();
    } catch (_) {}
    return prompt;
}

function clearNextBeatPrompt() {
    setNextBeatPrompt("");
}

function getNextBeatPrompt() {
    const live = normalizeNextBeatPrompt(readNextBeatInput()?.value || "");
    if (live) {
        const s = ensureNextBeatState();
        if (normalizeNextBeatPrompt(s.ui.priorityBeatPrompt) !== live) {
            s.ui.priorityBeatPrompt = live;
            try {
                saveSettings?.();
            } catch (_) {}
        }
        return live;
    }
    const s = ensureNextBeatState();
    return normalizeNextBeatPrompt(s.ui.priorityBeatPrompt || "") || null;
}

function consumeNextBeatPrompt() {
    const prompt = getNextBeatPrompt();
    if (prompt) clearNextBeatPrompt();
    return prompt;
}

function initNextBeat() {
    const nextBeatInput = readNextBeatInput();
    const nextBeatDelete = document.getElementById("next-beat-delete");

    syncNextBeatInput(ensureNextBeatState().ui.priorityBeatPrompt || "");

    if (nextBeatInput && !nextBeatInput.dataset.nextBeatBound) {
        nextBeatInput.dataset.nextBeatBound = "true";
        nextBeatInput.addEventListener("input", () => {
            setNextBeatPrompt(nextBeatInput.value || "");
        });
    }

    if (nextBeatDelete && !nextBeatDelete.dataset.nextBeatBound) {
        nextBeatDelete.dataset.nextBeatBound = "true";
        nextBeatDelete.addEventListener("click", () => {
            clearNextBeatPrompt();
        });
    }
}

export { clearNextBeatPrompt, consumeNextBeatPrompt, getNextBeatPrompt, initNextBeat, setNextBeatPrompt };
