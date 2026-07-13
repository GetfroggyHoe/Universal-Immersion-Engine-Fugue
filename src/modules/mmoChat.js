import { getSettings } from "./core.js";
import { ensureMmoState, persistMmo, esc, uid, pick, clampText, getWorldBrief, aiJson, toast, randomName } from "./mmoCommon.js";

const CHANNELS = ["Global", "Trade", "LFG", "Local"];
let initialized = false;
let pulseTimer = null;
let aiInFlight = false;

function isMmorpgMode(s = getSettings()) {
  const hay = [
    s?.world?.gameMode,
    s?.character?.mode,
    s?.worldState?.genre,
    s?.storyPreset?.genre,
    s?.storyPreset,
  ].map((x) => String(x || "").toLowerCase()).join(" ");
  return /\b(mmorpg|mmo|online\s*rpg|simulated\s*server|server\s*shard)\b/.test(hay);
}

function message(channel, name, text, extra = {}) {
  return {
    id: uid("mchat"),
    ts: Date.now(),
    channel: CHANNELS.includes(channel) ? channel : "Global",
    name: clampText(name || randomName(), 42),
    text: clampText(text, 420),
    ...extra,
  };
}

function seedMessages(s) {
  const m = ensureMmoState(s);
  if (m.chat.messages.length) return;
  const brief = getWorldBrief();
  m.chat.messages.push(
    message("Global", "Mira Starfall", `Server is lively around ${brief.location}. Anyone seeing rare spawns?`),
    message("Trade", "Kade Quickcast", "WTS starter mats, fair prices. Also buying odd relics."),
    message("LFG", "Sable Riftborn", "LFG daily dungeon, need healer and one steady DPS."),
    message("Local", "Ren Dawnward", `People keep talking about ${brief.campaign}. Feels like a world event brewing.`)
  );
}

function proceduralBatch(count = 4) {
  const brief = getWorldBrief();
  const topics = [
    `heard something shifted near ${brief.location}`,
    "queue popped and someone declined at the last second",
    "crafting prices are weird today",
    "anyone else lagging in town or is that just my map",
    "world boss timer looks close",
    "need one more for a clean dungeon run",
    "trade board is wild tonight",
    `${brief.character} just passed through my shard, I think`,
  ];
  const trade = [
    "WTS clean potions, cheap stack.",
    "WTB upgrade stones, paying above board.",
    "Price check on an uncommon charm?",
    "Selling repair kits before dungeon rush.",
  ];
  const lfg = [
    "LFG fast clear, need Tank.",
    "Need Healer for story dungeon, chill pace.",
    "DPS looking for group, can follow marks.",
    "Forming exploration party, no rush.",
  ];
  const out = [];
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    const channel = r < 0.22 ? "Trade" : r < 0.44 ? "LFG" : r < 0.72 ? "Global" : "Local";
    const text = channel === "Trade" ? pick(trade) : channel === "LFG" ? pick(lfg) : pick(topics);
    out.push(message(channel, randomName(), text));
  }
  return out;
}

function responseToUser(userText) {
  const t = String(userText || "").toLowerCase();
  if (/\b(help|how|where|what|anyone|lfg|group)\b/.test(t)) {
    return message("Global", randomName(), "Check the LFG board. People are cycling groups right now.");
  }
  if (/\b(wtb|wts|buy|sell|trade|price|gold)\b/.test(t)) {
    return message("Trade", randomName(), "Open trade and make an offer. Most folks counter if it is close.");
  }
  if (/\b(boss|dungeon|raid|queue)\b/.test(t)) {
    return message("LFG", randomName(), "I can fill DPS if you have a tank. Ping the board.");
  }
  return message("Local", randomName(), "Saw that. The server has been spicy today.");
}

async function aiBatch(count = 4, userText = "") {
  if (aiInFlight) return null;
  aiInFlight = true;
  try {
    const brief = getWorldBrief();
    const prompt = [
      "Generate simulated MMORPG chat messages for a single-player game mode.",
      "Return ONLY JSON: an array of objects with channel, name, text.",
      `Use ${count} messages. Channels must be Global, Trade, LFG, or Local.`,
      "Keep messages short, casual, and believable. No real user names. No markdown.",
      `World brief: ${JSON.stringify(brief)}`,
      userText ? `The player just typed: ${userText}` : "",
    ].filter(Boolean).join("\n");
    const data = await aiJson(prompt, "MMO Chat");
    const arr = Array.isArray(data) ? data : [];
    const out = arr.slice(0, Math.max(1, count)).map((x) => message(x?.channel, x?.name, x?.text)).filter((x) => x.text);
    return out.length ? out : null;
  } finally {
    aiInFlight = false;
  }
}

function pushMessages(s, list) {
  const m = ensureMmoState(s);
  for (const item of list || []) {
    if (item && item.text) m.chat.messages.push(item);
  }
  m.chat.messages = m.chat.messages.slice(-180);
  m.chat.lastGeneratedAt = Date.now();
  m.chat.nextPulseAt = Date.now() + 55000 + Math.floor(Math.random() * 45000);
  persistMmo("mmo-chat");
}

async function generatePulse({ userText = "", forceAi = false } = {}) {
  const s = getSettings();
  const m = ensureMmoState(s);
  seedMessages(s);
  const want = userText ? 2 : 3 + Math.floor(Math.random() * 3);
  let next = null;
  if (forceAi || m.aiEnabled) next = await aiBatch(want, userText);
  if (!next) {
    next = userText ? [responseToUser(userText)] : proceduralBatch(want);
  }
  pushMessages(s, next);
  renderMessages();
}

function renderMessages() {
  const s = getSettings();
  const m = ensureMmoState(s);
  seedMessages(s);
  const list = document.getElementById("uie-mmo-chat-list");
  if (!list) return;
  list.innerHTML = m.chat.messages.map((msg) => {
    const cls = `chan-${String(msg.channel || "Global").toLowerCase()}`;
    const time = new Date(Number(msg.ts || Date.now())).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `<div class="mmo-chat-line ${cls}">
      <span class="mmo-chat-time">${esc(time)}</span>
      <span class="mmo-chat-channel">[${esc(msg.channel || "Global")}]</span>
      <span class="mmo-chat-name">${esc(msg.name || "Player")}</span>
      <span class="mmo-chat-text">${esc(msg.text || "")}</span>
    </div>`;
  }).join("");
  list.scrollTop = list.scrollHeight;
  const status = document.getElementById("uie-mmo-chat-status");
  if (status) {
    status.textContent = m.backgroundChat ? "Live pulse on" : "Paused";
  }
  const ai = document.getElementById("uie-mmo-chat-ai");
  if (ai) ai.checked = m.aiEnabled !== false;
}

function bindEvents() {
  const win = document.getElementById("uie-mmo-chat-window");
  if (!win) return;
  win.addEventListener("click", (ev) => {
    const target = ev.target;
    const close = target?.closest?.("#uie-mmo-chat-close");
    if (close) {
      win.style.display = "none";
      return;
    }
    if (target?.closest?.("#uie-mmo-chat-pulse")) {
      void generatePulse({ forceAi: true });
      return;
    }
    if (target?.closest?.("#uie-mmo-chat-pause")) {
      const s = getSettings();
      const m = ensureMmoState(s);
      m.backgroundChat = !m.backgroundChat;
      persistMmo("mmo-chat");
      renderMessages();
    }
  });

  win.addEventListener("change", (ev) => {
    if (ev.target?.id !== "uie-mmo-chat-ai") return;
    const s = getSettings();
    const m = ensureMmoState(s);
    m.aiEnabled = ev.target.checked === true;
    persistMmo("mmo-chat");
  });

  win.addEventListener("submit", (ev) => {
    if (ev.target?.id !== "uie-mmo-chat-form") return;
    ev.preventDefault();
    const input = document.getElementById("uie-mmo-chat-input");
    const text = clampText(input?.value || "", 280);
    if (!text) return;
    input.value = "";
    const s = getSettings();
    const m = ensureMmoState(s);
    m.chat.messages.push(message("Global", m.chat.playerHandle || "You", text, { isUser: true }));
    persistMmo("mmo-chat");
    renderMessages();
    void generatePulse({ userText: text });
  });
}

function startPulseTimer() {
  if (pulseTimer) return;
  pulseTimer = setInterval(() => {
    const s = getSettings();
    if (!isMmorpgMode(s)) {
      const win = document.getElementById("uie-mmo-chat-window");
      if (win) win.style.display = "none";
      return;
    }
    const m = ensureMmoState(s);
    const win = document.getElementById("uie-mmo-chat-window");
    const visible = !!win && getComputedStyle(win).display !== "none";
    if (!visible || !m.enabled || !m.backgroundChat) return;
    if (Date.now() < Number(m.chat.nextPulseAt || 0)) return;
    void generatePulse();
  }, 7000);
}

export function render() {
  const s = getSettings();
  ensureMmoState(s);
  seedMessages(s);
  renderMessages();
}

export function initMmoChat() {
  if (!isMmorpgMode()) {
    const win = document.getElementById("uie-mmo-chat-window");
    if (win) win.style.display = "none";
    return;
  }
  if (initialized) {
    render();
    return;
  }
  initialized = true;
  const s = getSettings();
  ensureMmoState(s);
  seedMessages(s);
  bindEvents();
  startPulseTimer();
  render();
  toast("info", "MMO chat connected to simulated shard.", "MMO");
}

export function openMmoChat() {
  if (!isMmorpgMode()) {
    const win = document.getElementById("uie-mmo-chat-window");
    if (win) win.style.display = "none";
    toast("info", "MMO chat is available in MMORPG mode only.", "MMO");
    return;
  }
  const win = document.getElementById("uie-mmo-chat-window");
  if (win) win.style.display = "flex";
  initMmoChat();
}
