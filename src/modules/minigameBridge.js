import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";

let activeGame = null;

function esc(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function ensureResults() {
    const s = getSettings();
    if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
    if (!s.worldState.minigameResults || typeof s.worldState.minigameResults !== "object") s.worldState.minigameResults = {};
    return { s, results: s.worldState.minigameResults };
}

function recordResult(id, type, outcome, detail = {}) {
    const { s, results } = ensureResults();
    const key = String(id || `${type}_challenge`);
    const previous = results[key] && typeof results[key] === "object" ? results[key] : {};
    results[key] = {
        ...previous,
        id: key,
        type,
        attempts: Number(previous.attempts || 0) + 1,
        wins: Number(previous.wins || 0) + (outcome === "success" ? 1 : 0),
        failures: Number(previous.failures || 0) + (outcome === "failure" ? 1 : 0),
        lastOutcome: outcome,
        lastDetail: detail,
        updatedAt: Date.now(),
    };
    saveSettings();
    try { window.dispatchEvent(new CustomEvent("uie:minigame_result", { detail: { id: key, type, outcome, ...detail } })); } catch (_) {}
}

function ensureModal() {
    let modal = document.getElementById("uie-challenge-modal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "uie-challenge-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-hidden", "true");
    modal.style.cssText = "display:none;position:fixed;inset:0;z-index:2147483645;align-items:center;justify-content:center;background:rgba(2,6,23,.82);backdrop-filter:blur(12px);padding:14px;box-sizing:border-box;";
    modal.innerHTML = `
      <section style="width:min(680px,96vw);max-height:min(88vh,680px);overflow:auto;background:linear-gradient(165deg,#111827,#050914);border:1px solid rgba(125,211,252,.38);border-radius:16px;color:#f8fafc;box-shadow:0 28px 90px #000;">
        <header style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1);">
          <div style="flex:1"><small style="color:#7dd3fc;text-transform:uppercase;letter-spacing:.12em">Interactive challenge</small><h2 id="uie-challenge-title" style="margin:3px 0 0;font-size:20px"></h2></div>
          <button id="uie-challenge-abort" type="button" style="border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#fff;border-radius:9px;padding:9px 12px;cursor:pointer">Abort</button>
        </header>
        <div id="uie-challenge-body" style="padding:18px"></div>
      </section>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => { if (event.target === modal) finishActive("abort"); });
    modal.querySelector("#uie-challenge-abort")?.addEventListener("click", () => finishActive("abort"));
    return modal;
}

function clearActiveRuntime() {
    if (!activeGame) return;
    if (activeGame.raf) cancelAnimationFrame(activeGame.raf);
    (activeGame.timers || []).forEach((timer) => clearTimeout(timer));
    (activeGame.cleanups || []).forEach((cleanup) => { try { cleanup(); } catch (_) {} });
    activeGame.raf = 0;
    activeGame.timers = [];
    activeGame.cleanups = [];
}

function finishActive(outcome, detail = {}) {
    if (!activeGame) return;
    const game = activeGame;
    clearActiveRuntime();
    activeGame = null;
    const modal = ensureModal();
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    if (outcome !== "abort") recordResult(game.id, game.type, outcome, detail);
    const callback = outcome === "success" ? game.onSuccess : outcome === "failure" ? game.onFailure : game.onAbort;
    try { callback?.(detail); } catch (error) { console.warn("[minigameBridge] result callback failed", error); }
    try { window.dispatchEvent(new CustomEvent("uie:modal_closed", { detail: { modal: "challenge", outcome } })); } catch (_) {}
}

function openShell(options, type) {
    if (activeGame) finishActive("abort", { replaced: true });
    const modal = ensureModal();
    modal.querySelector("#uie-challenge-title").textContent = String(options.title || "Challenge");
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
    activeGame = {
        id: String(options.id || `${type}_${Date.now()}`), type,
        onSuccess: options.onSuccess, onFailure: options.onFailure, onAbort: options.onAbort,
        timers: [], cleanups: [], raf: 0,
    };
    try { window.dispatchEvent(new CustomEvent("uie:modal_opened", { detail: { modal: "challenge", type } })); } catch (_) {}
    return modal.querySelector("#uie-challenge-body");
}

export function runTimingChallenge(options = {}) {
    const body = openShell(options, "timing");
    const difficulty = Math.max(1, Math.min(100, Number(options.difficulty || 40)));
    const zoneWidth = Math.max(9, 38 - difficulty * .24);
    const seed = Array.from(String(activeGame.id)).reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 17);
    const zoneLeft = 8 + (seed % Math.max(1, Math.floor(82 - zoneWidth)));
    const speed = .045 + difficulty * .00055;
    let position = 0;
    let direction = 1;
    let last = performance.now();
    let attempts = Math.max(1, Number(options.attempts || 3));
    body.innerHTML = `
      <p style="margin-top:0;color:#cbd5e1">${esc(options.instructions || "Stop the marker inside the highlighted zone.")}</p>
      <div style="position:relative;height:42px;border-radius:12px;background:#020617;border:1px solid rgba(255,255,255,.18);overflow:hidden;margin:22px 0">
        <div style="position:absolute;left:${zoneLeft}%;width:${zoneWidth}%;inset-block:0;background:rgba(34,197,94,.34);border-inline:2px solid #4ade80"></div>
        <div id="uie-timing-marker" style="position:absolute;left:0;top:0;width:5px;height:100%;background:#f8fafc;box-shadow:0 0 12px #38bdf8"></div>
      </div>
      <div style="display:flex;align-items:center;gap:12px"><span id="uie-timing-attempts" style="flex:1;color:#94a3b8">Attempts: ${attempts}</span><button id="uie-timing-act" type="button" style="border:1px solid #38bdf8;background:rgba(14,165,233,.18);color:#e0f2fe;border-radius:10px;padding:12px 22px;font-weight:800;cursor:pointer">${esc(options.actionLabel || "Act now")}</button></div>
      <small style="display:block;margin-top:10px;color:#64748b">Mouse/touch: button · Keyboard: Space or Enter</small>`;
    const marker = body.querySelector("#uie-timing-marker");
    const attemptLabel = body.querySelector("#uie-timing-attempts");
    const tick = (now) => {
        if (!activeGame) return;
        const delta = Math.min(40, now - last);
        last = now;
        position += direction * speed * delta;
        if (position >= 100) { position = 100; direction = -1; }
        if (position <= 0) { position = 0; direction = 1; }
        marker.style.left = `${position}%`;
        activeGame.raf = requestAnimationFrame(tick);
    };
    const act = () => {
        if (!activeGame) return;
        const success = position >= zoneLeft && position <= zoneLeft + zoneWidth;
        if (success) { finishActive("success", { accuracy: Math.round(100 - Math.abs(position - (zoneLeft + zoneWidth / 2))) }); return; }
        attempts -= 1;
        if (attempts <= 0) { finishActive("failure", { position: Math.round(position) }); return; }
        attemptLabel.textContent = `Attempts: ${attempts} · missed`;
        attemptLabel.style.color = "#fbbf24";
    };
    const keyHandler = (event) => {
        if ((event.code === "Space" || event.key === "Enter") && activeGame) { event.preventDefault(); event.stopPropagation(); act(); }
        if (event.key === "Escape" && activeGame) { event.preventDefault(); finishActive("abort"); }
    };
    body.querySelector("#uie-timing-act")?.addEventListener("click", act);
    document.addEventListener("keydown", keyHandler, true);
    activeGame.cleanups.push(() => document.removeEventListener("keydown", keyHandler, true));
    activeGame.raf = requestAnimationFrame(tick);
}

export function runSequenceChallenge(options = {}) {
    const body = openShell(options, "sequence");
    const difficulty = Math.max(1, Math.min(100, Number(options.difficulty || 40)));
    const length = Math.max(3, Math.min(8, Number(options.length || 3 + Math.floor(difficulty / 22))));
    const symbols = Array.isArray(options.symbols) && options.symbols.length >= 4 ? options.symbols.slice(0, 8) : ["◆", "●", "▲", "■"];
    const seed = Array.from(String(activeGame.id)).reduce((sum, ch) => (sum * 33 + ch.charCodeAt(0)) >>> 0, 29);
    const sequence = Array.from({ length }, (_, index) => (seed + index * 7 + Math.floor(index * index / 2)) % symbols.length);
    let entered = [];
    let accepting = false;
    body.innerHTML = `
      <p style="margin-top:0;color:#cbd5e1">${esc(options.instructions || "Memorize the signal, then repeat it in order.")}</p>
      <div id="uie-sequence-status" aria-live="polite" style="text-align:center;color:#7dd3fc;min-height:25px;margin:14px 0">Observe…</div>
      <div style="display:grid;grid-template-columns:repeat(${Math.min(4, symbols.length)},minmax(58px,1fr));gap:10px">${symbols.map((symbol, index) => `<button type="button" data-sequence-pad="${index}" disabled style="min-height:68px;border:1px solid rgba(125,211,252,.3);background:rgba(30,41,59,.8);color:#fff;border-radius:12px;font-size:25px;cursor:pointer">${esc(symbol)}</button>`).join("")}</div>`;
    const pads = Array.from(body.querySelectorAll("[data-sequence-pad]"));
    const status = body.querySelector("#uie-sequence-status");
    const flash = (index, on) => {
        const pad = pads[index];
        if (!pad) return;
        pad.style.background = on ? "rgba(56,189,248,.58)" : "rgba(30,41,59,.8)";
        pad.style.transform = on ? "scale(1.04)" : "none";
    };
    sequence.forEach((padIndex, order) => {
        activeGame.timers.push(setTimeout(() => flash(padIndex, true), 600 + order * 650));
        activeGame.timers.push(setTimeout(() => flash(padIndex, false), 970 + order * 650));
    });
    activeGame.timers.push(setTimeout(() => {
        accepting = true;
        status.textContent = "Repeat the sequence";
        pads.forEach((pad) => { pad.disabled = false; });
        pads[0]?.focus();
    }, 700 + sequence.length * 650));
    const press = (index) => {
        if (!accepting || !activeGame) return;
        flash(index, true);
        activeGame.timers.push(setTimeout(() => flash(index, false), 170));
        entered.push(index);
        const position = entered.length - 1;
        if (sequence[position] !== index) { finishActive("failure", { completed: position, length }); return; }
        status.textContent = `${entered.length} / ${sequence.length}`;
        if (entered.length === sequence.length) finishActive("success", { length });
    };
    pads.forEach((pad) => pad.addEventListener("click", () => press(Number(pad.dataset.sequencePad))));
    const keyHandler = (event) => {
        const number = Number(event.key) - 1;
        if (number >= 0 && number < pads.length) { event.preventDefault(); press(number); }
        if (event.key === "Escape" && activeGame) { event.preventDefault(); finishActive("abort"); }
    };
    document.addEventListener("keydown", keyHandler, true);
    activeGame.cleanups.push(() => document.removeEventListener("keydown", keyHandler, true));
}

export function cancelActiveChallenge() {
    if (activeGame) finishActive("abort");
}

export function initMinigameBridge() {
    ensureModal();
    window.UIE_MinigameBridge = { runTimingChallenge, runSequenceChallenge, cancelActiveChallenge };
}

