import { getSettings } from "./core.js";

/**
 * Build a chat-shaped message array from the standalone #chat DOM log so UIE modules
 * (social, databank, turbo context, etc.) see real messages natively.
 */
export function buildStandaloneChatArrayFromDom() {
    try {
        const chatEl = document.getElementById("chat");
        if (!chatEl) return [];
        const nodes = Array.from(chatEl.querySelectorAll(".mes"));
        const out = [];
        for (let i = 0; i < nodes.length; i++) {
            const m = nodes[i];
            const isUser =
                m.classList?.contains("is_user") ||
                m.getAttribute("is_user") === "true" ||
                m.getAttribute("data-is-user") === "true" ||
                m.dataset?.isUser === "true";
            const mesid =
                String(m.getAttribute("mesid") || m.dataset?.mesId || m.dataset?.mesid || i).trim() || String(i);
            const name = String(m.querySelector(".mes_name")?.textContent || "").trim() || (isUser ? "You" : "Story");
            const text = String(m.querySelector(".mes_text")?.textContent || m.querySelector(".mes-text")?.textContent || "").trim();
            if (!text) continue;
            out.push({
                mesid,
                message_id: i,
                name,
                mes: text,
                message: text,
                is_user: !!isUser,
                isUser: !!isUser,
                role: isUser ? "user" : "assistant",
            });
        }
        return out;
    } catch (_) {
        return [];
    }
}

/**
 * Returns the game context (user name, active chat messages, current location)
 * reading natively from UIE settings and the DOM instead of external APIs.
 */
export function getContext() {
    const s = getSettings();
    const userName = String(s?.character?.name || "User").trim() || "User";
    const location = String(s?.worldState?.location || "").trim();
    return {
        name1: userName,
        name2: "",
        chat: buildStandaloneChatArrayFromDom(),
        extensionSettings: {},
        location,
    };
}
