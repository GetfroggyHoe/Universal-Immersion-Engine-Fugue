import { getSettings, saveSettings } from "./core.js";
import { getContext } from "./gameContext.js";
import { consumeAutoChartTags, stripAutoChartTags } from "./twoSisters.js";
import { notify } from "./notifications.js";

// --- CHAT SYNC MODULE (Standalone Native) ---

let chatObserver = null;
let chatSyncInited = false;

export function initChatSync() {
    if (chatSyncInited) return;
    chatSyncInited = true;
    initChatObserver();
}

export function stopChatSync() {
    chatSyncInited = false;
    try {
        if (chatObserver) chatObserver.disconnect();
    } catch (_) {}
    chatObserver = null;
}

function initChatObserver() {
    const chatEl = document.getElementById("chat");
    if (!chatEl) return;

    // Scan initial messages for AUTO_CHART tags
    try {
        const messages = chatEl.querySelectorAll(".mes");
        messages.forEach((node) => {
            void processAutoChartMessage(node);
        });
    } catch (_) {}

    try {
        if (chatObserver) chatObserver.disconnect();
    } catch (_) {}

    chatObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && node.classList.contains("mes")) {
                        void processAutoChartMessage(node);
                        // Auto-save on every new message
                        saveSettings();
                    }
                });
            }
        });
    });

    chatObserver.observe(chatEl, { childList: true });
}

async function processAutoChartMessage(stMsg) {
    try {
        const textEl = stMsg?.querySelector?.(".mes_text, .mes-text");
        const raw = String(textEl?.textContent || stMsg?.textContent || "").trim();
        if (!raw || !/\[\s*AUTO_CHART\s*:/i.test(raw)) return;
        const nodes = consumeAutoChartTags(raw);
        if (!nodes.length) return;
        const cleaned = stripAutoChartTags(raw);
        if (textEl && cleaned !== raw) textEl.textContent = cleaned;
        try {
            const ctx = typeof getContext === "function" ? getContext() : null;
            const mesId = Number.parseInt(String(stMsg.getAttribute("mesid") || stMsg.getAttribute("data-mes-id") || ""), 10);
            if (Number.isInteger(mesId) && Array.isArray(ctx?.chat) && ctx.chat[mesId]) {
                ctx.chat[mesId].mes = cleaned;
                ctx.chat[mesId].text = cleaned;
            }
        } catch (_) {}
        const last = nodes[nodes.length - 1];
        notify("success", `Charted ${last.name}.`, "Auto-Chart", "map");
        try {
            const map = await import("./map.js");
            if (typeof map.applyMoveToLocation === "function") {
                await map.applyMoveToLocation({ name: last.name, desc: last.desc, type: last.type });
            }
        } catch (_) {}
    } catch (e) {
        console.warn("[UIE] Auto-Chart processing failed", e);
    }
}
