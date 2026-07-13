import { getSettings } from "./core.js";
import { queueSystemEvent } from "./logicEnforcer.js";
import { notify } from "./notifications.js";

const COMMAND_RE = /^\s*\[UIE_UI\s+({.*})\]\s*$/gmi;
const timers = new Map();
let initialized = false;

function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function safeText(value, max = 1200) {
    return String(value ?? "").trim().slice(0, max);
}

function ensureRuntime() {
    if (document.getElementById("uie-dynamic-layer")) return;
    const style = document.createElement("style");
    style.id = "uie-dynamic-style";
    style.textContent = `
#uie-dynamic-layer{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:Inter,system-ui,sans-serif}
.uie-dynamic-card{pointer-events:auto;position:fixed;color:#f8fafc;background:linear-gradient(160deg,rgba(15,23,42,.97),rgba(2,6,23,.95));border:1px solid rgba(148,163,184,.35);box-shadow:0 18px 60px rgba(0,0,0,.55);backdrop-filter:blur(14px)}
.uie-dynamic-close{border:0;background:rgba(255,255,255,.1);color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:18px}
.uie-dynamic-timer{top:18px;left:50%;transform:translateX(-50%);min-width:210px;padding:12px 18px;border-radius:16px;text-align:center}
.uie-dynamic-timer.danger{border-color:rgba(248,113,113,.75);box-shadow:0 0 30px rgba(239,68,68,.32)}
.uie-dynamic-note{top:8vh;right:3vw;width:min(390px,88vw);max-height:78vh;overflow:auto;padding:18px;border-radius:12px;transform:rotate(.4deg);background:linear-gradient(155deg,#fff9d8,#eadca6);color:#292317;border-color:rgba(101,82,34,.42);font-family:Georgia,serif}
.uie-wire-modal{inset:0;display:grid;place-items:center;background:rgba(2,6,23,.72);pointer-events:auto}
.uie-wire-box{width:min(520px,92vw);padding:22px;border-radius:18px}
.uie-wire-row{display:flex;gap:10px;align-items:center;margin:12px 0;padding:12px;border-radius:12px;background:rgba(255,255,255,.06)}
.uie-wire{height:18px;flex:1;border-radius:99px;box-shadow:inset 0 2px 3px rgba(255,255,255,.28),0 4px 10px rgba(0,0,0,.35)}
.uie-wire-cut{border:1px solid rgba(255,255,255,.28);background:#172033;color:#fff;border-radius:9px;padding:8px 12px;cursor:pointer}
`;
    document.head.appendChild(style);
    const layer = document.createElement("div");
    layer.id = "uie-dynamic-layer";
    document.body.appendChild(layer);
}

function layer() {
    ensureRuntime();
    return document.getElementById("uie-dynamic-layer");
}

function timerSnapshot(timer, actionType = "text_reply") {
    const deadline = Number(timer?.dataset?.deadline || 0);
    const duration = Number(timer?.dataset?.duration || 0);
    const remaining = Math.max(0, (deadline - Date.now()) / 1000);
    return {
        id: safeText(timer?.dataset?.timerId || timer?.id, 120),
        label: safeText(timer?.dataset?.label || "Countdown", 160),
        duration_seconds: duration,
        time_remaining_seconds: Number(remaining.toFixed(3)),
        time_elapsed_seconds: Number(Math.max(0, duration - remaining).toFixed(3)),
        completed_before_deadline: remaining > 0,
        action_type: actionType
    };
}

function stopTimer(id, reason = "dismissed") {
    const record = timers.get(id);
    if (!record) return null;
    clearInterval(record.interval);
    clearTimeout(record.timeout);
    const snap = timerSnapshot(record.element);
    record.element.remove();
    timers.delete(id);
    return { ...snap, stop_reason: reason };
}

function spawnTimer(command = {}) {
    ensureRuntime();
    const id = safeText(command.id || `timer_${Date.now()}`, 120);
    stopTimer(id, "replaced");
    const seconds = clampNumber(command.seconds ?? command.time, 0.1, 86400, 30);
    const label = safeText(command.label || command.title || "TIME REMAINING", 160);
    const el = document.createElement("section");
    el.className = "uie-dynamic-card uie-dynamic-timer";
    el.id = `uie-timer-${id.replace(/[^a-z0-9_-]/gi, "_")}`;
    el.dataset.timerId = id;
    el.dataset.label = label;
    el.dataset.duration = String(seconds);
    el.dataset.deadline = String(Date.now() + seconds * 1000);
    el.innerHTML = `<div style="font-size:11px;font-weight:900;letter-spacing:.18em;opacity:.72"></div><div data-time style="font:900 30px/1.1 ui-monospace,monospace;margin-top:5px"></div>`;
    el.firstElementChild.textContent = label;
    layer().appendChild(el);

    const tick = () => {
        const remaining = Math.max(0, (Number(el.dataset.deadline) - Date.now()) / 1000);
        el.dataset.timeLeft = remaining.toFixed(3);
        el.querySelector("[data-time]").textContent = remaining >= 60
            ? `${Math.floor(remaining / 60)}:${Math.floor(remaining % 60).toString().padStart(2, "0")}`
            : remaining.toFixed(remaining < 10 ? 1 : 0);
        el.classList.toggle("danger", remaining <= Math.min(10, seconds * 0.25));
    };
    tick();
    const interval = setInterval(tick, 50);
    const timeout = setTimeout(() => {
        const result = stopTimer(id, "expired");
        queueSystemEvent(`[REALTIME EVENT]\n${JSON.stringify({ system_event: "timer_expired", timer: result })}`, { type: "timer_expired", targetType: "VN Dialogue" });
        notify("warning", `${label} expired.`, "Time");
    }, seconds * 1000);
    timers.set(id, { element: el, interval, timeout });
    return id;
}

function showNote(command = {}) {
    const id = safeText(command.id || `note_${Date.now()}`, 120);
    const note = document.createElement("article");
    note.className = "uie-dynamic-card uie-dynamic-note";
    note.dataset.noteId = id;
    const top = document.createElement("div");
    top.style.cssText = "display:flex;align-items:flex-start;gap:12px;margin-bottom:12px";
    const title = document.createElement("strong");
    title.style.cssText = "font-size:20px;flex:1";
    title.textContent = safeText(command.title || "Note", 180);
    const close = document.createElement("button");
    close.className = "uie-dynamic-close";
    close.textContent = "x";
    close.setAttribute("aria-label", "Close note");
    close.onclick = () => note.remove();
    const body = document.createElement("div");
    body.style.cssText = "white-space:pre-wrap;line-height:1.55;font-size:16px";
    body.textContent = safeText(command.content || command.text || "", 6000);
    top.append(title, close);
    note.append(top, body);
    layer().appendChild(note);
}

function finishWireGame(modal, result) {
    const elapsed = (Date.now() - Number(modal.dataset.startedAt || Date.now())) / 1000;
    const timerId = modal.dataset.timerId || "";
    const timer = timerId ? stopTimer(timerId, "minigame_resolved") : null;
    modal.remove();
    const payload = {
        system_event: "Mini-game 'wire_box' concluded.",
        results: { ...result, time_elapsed: Number(elapsed.toFixed(3)), timer },
        instruction: "Narrate the immediate, physically consistent consequences. Respect the result exactly."
    };
    queueSystemEvent(`[MINIGAME RESULT]\n${JSON.stringify(payload)}`, { type: "minigame_result", targetType: "VN Dialogue" });
    notify(result.outcome === "success" ? "success" : "error", result.reason, "Wire Box");
}

function spawnWireBox(command = {}) {
    const expected = safeText(command.correct_wire || command.correct || "blue", 30).toLowerCase();
    const colors = Array.isArray(command.wires) && command.wires.length
        ? command.wires.map((x) => safeText(x, 30).toLowerCase()).filter(Boolean).slice(0, 8)
        : ["red", "blue", "yellow", "green"];
    const modal = document.createElement("div");
    modal.className = "uie-dynamic-card uie-wire-modal";
    modal.dataset.startedAt = String(Date.now());
    modal.dataset.timerId = safeText(command.id || `wire_${Date.now()}`, 120);
    modal.dataset.expectedWire = expected;
    modal.dataset.wires = JSON.stringify(colors);
    const box = document.createElement("section");
    box.className = "uie-dynamic-card uie-wire-box";
    const heading = document.createElement("h2");
    heading.textContent = safeText(command.title || "Which wire do you cut?", 180);
    box.appendChild(heading);
    colors.forEach((color) => {
        const row = document.createElement("div");
        row.className = "uie-wire-row";
        const wire = document.createElement("div");
        wire.className = "uie-wire";
        wire.style.background = color;
        const button = document.createElement("button");
        button.className = "uie-wire-cut";
        button.textContent = `Cut ${color}`;
        button.onclick = () => finishWireGame(modal, color === expected
            ? { outcome: "success", reason: `Player cut the ${color} wire.` }
            : { outcome: "failed", reason: `Player cut the ${color} wire instead of the ${expected} wire.` });
        row.append(wire, button);
        box.appendChild(row);
    });
    modal.appendChild(box);
    layer().appendChild(modal);
    spawnTimer({ id: modal.dataset.timerId, seconds: command.seconds ?? command.time ?? 30, label: command.timer_label || "WIRE DETONATION" });
    const record = timers.get(modal.dataset.timerId);
    if (record) {
        clearTimeout(record.timeout);
        record.timeout = setTimeout(() => {
            stopTimer(modal.dataset.timerId, "expired");
            finishWireGame(modal, { outcome: "failed", reason: "Time expired before the player cut a wire." });
        }, clampNumber(command.seconds ?? command.time, 0.1, 86400, 30) * 1000);
    }
}

function runCommand(command = {}) {
    const type = safeText(command.type || command.command, 80).toLowerCase();
    if (type === "spawn_timer" || type === "timer") return spawnTimer(command);
    if (type === "show_note" || type === "note") return showNote(command);
    if (type === "spawn_minigame" && safeText(command.game, 80).toLowerCase() === "wire_box") return spawnWireBox(command);
    if (type === "dismiss") {
        const id = safeText(command.id, 120);
        stopTimer(id, "dismissed");
        document.querySelector(`[data-note-id="${CSS.escape(id)}"]`)?.remove();
    }
    return null;
}

export function processDynamicUiCommands(text) {
    const commands = [];
    const visibleText = String(text || "").replace(COMMAND_RE, (_, raw) => {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") commands.push(parsed);
        } catch (error) {
            console.warn("[dynamic-immersion] Invalid UI command", error);
        }
        return "";
    }).replace(/\n{3,}/g, "\n\n").trim();
    commands.forEach(runCommand);
    return { text: visibleText, commands };
}

export function capturePlayerAction(playerInput, actionType = "text_reply") {
    const actionText = safeText(playerInput, 4000);
    const activeMinigames = Array.from(document.querySelectorAll(".uie-wire-modal")).map((modal) => {
        let wires = [];
        try { wires = JSON.parse(modal.dataset.wires || "[]"); } catch (_) {}
        const selected = wires.find((color) => new RegExp(`\\b${String(color).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(actionText)) || "";
        const expected = safeText(modal.dataset.expectedWire, 30);
        const elapsed = (Date.now() - Number(modal.dataset.startedAt || Date.now())) / 1000;
        modal.remove();
        return {
            game: "wire_box",
            id: safeText(modal.dataset.timerId, 120),
            outcome: selected ? (selected === expected ? "success" : "failed") : "narrative_resolution_requested",
            reason: selected
                ? `Player stated they cut the ${selected} wire${selected === expected ? "." : ` instead of the ${expected} wire.`}`
                : "Player responded by text without selecting an HTML wire.",
            time_elapsed_seconds: Number(elapsed.toFixed(3))
        };
    });
    const activeTimers = Array.from(timers.values()).map((record) => timerSnapshot(record.element, actionType));
    activeTimers.forEach((timer) => stopTimer(timer.id, "player_action"));
    const s = getSettings() || {};
    const statuses = [
        ...(Array.isArray(s?.inventory?.statuses) ? s.inventory.statuses : []),
        ...(Array.isArray(s?.character?.statusEffects) ? s.character.statusEffects : [])
    ].map((item) => safeText(typeof item === "string" ? item : item?.name || item?.title || item?.label, 120)).filter(Boolean);
    return {
        player_action: actionText,
        action_type: actionType,
        captured_at: new Date().toISOString(),
        realtime_timers: activeTimers,
        active_minigames_resolved_by_action: activeMinigames,
        background_state: {
            current_hp: Number(s?.hp ?? s?.character?.hp ?? 100),
            max_hp: Number(s?.maxHp ?? s?.character?.maxHp ?? 100),
            active_conditions: Array.from(new Set(statuses)).slice(0, 20)
        }
    };
}

export function buildRealtimeActionContext(playerInput, actionType = "text_reply") {
    return `[REALTIME ACTION CONTEXT]\n${JSON.stringify(capturePlayerAction(playerInput, actionType))}`;
}

export function initDynamicImmersion() {
    if (initialized) return;
    initialized = true;
    ensureRuntime();
    window.UIE_dynamicImmersion = {
        spawnTimer,
        showNote,
        spawnWireBox,
        processDynamicUiCommands,
        capturePlayerAction,
        buildRealtimeActionContext
    };
}
