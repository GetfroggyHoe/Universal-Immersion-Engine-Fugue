import { getSettings } from "./core.js";
import { ensureEconomyState, spendCurrency, formatCurrency } from "./economy.js";
import { addInventoryItemWithStack } from "./inventoryItems.js";
import { ensureMmoState, persistMmo, esc, uid, pick, clampText, aiJson, toast, randomName } from "./mmoCommon.js";

let initialized = false;
let aiInFlight = false;

const SHOP_ITEMS = [
  { name: "Minor Health Potion", type: "consumable", rarity: "common", qty: 1, value: 25, description: "A cheap recovery potion from an adventurer's pouch." },
  { name: "Repair Kit", type: "tool", rarity: "common", qty: 1, value: 35, description: "Basic field kit for battered equipment." },
  { name: "Map Fragment", type: "quest", rarity: "uncommon", qty: 1, value: 60, description: "A torn route marker for a nearby hidden path." },
  { name: "Polished Charm", type: "accessory", rarity: "uncommon", qty: 1, value: 90, description: "A small charm traded between dungeon runners." },
];

function ensureTradeState(s) {
  const m = ensureMmoState(s);
  ensureEconomyState(s);
  if (!m.trade.session || typeof m.trade.session !== "object") {
    m.trade.session = {
      npcId: "",
      offeredGold: 0,
      offeredItemKey: "",
      offeredQty: 1,
      theirItemKey: "0",
      userAccepted: false,
      npcAccepted: false,
      status: "Choose offers and confirm.",
    };
  }
  if (!m.trade.npcs.length) {
    m.trade.npcs = [
      { id: uid("trader"), name: "Brannik Copperflip", style: "Practical merchant", mood: "open" },
      { id: uid("trader"), name: randomName(), style: "Dungeon runner", mood: "curious" },
      { id: uid("trader"), name: randomName(), style: "Crafting broker", mood: "shrewd" },
    ];
  }
  return m.trade;
}

function getNpcOptions(s) {
  const t = ensureTradeState(s);
  const party = (Array.isArray(s?.party?.members) ? s.party.members : [])
    .filter((m) => m && !m.isUser)
    .map((m) => ({
      id: `party:${m.id}`,
      name: clampText(m?.identity?.name || m?.name || "Party Member", 48),
      style: clampText(m?.identity?.class || m?.partyRole || "Companion", 48),
      mood: "friendly",
    }));
  return [...party, ...t.npcs];
}

function getInventoryOptions(s) {
  const items = Array.isArray(s?.inventory?.items) ? s.inventory.items : [];
  return items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => it && String(it.type || "").toLowerCase() !== "currency" && Math.max(1, Number(it.qty || 1)) > 0);
}

function selectedNpc(s) {
  const t = ensureTradeState(s);
  const opts = getNpcOptions(s);
  if (!t.session.npcId || !opts.some((x) => String(x.id) === String(t.session.npcId))) t.session.npcId = opts[0]?.id || "";
  return opts.find((x) => String(x.id) === String(t.session.npcId)) || opts[0] || null;
}

function selectedTheirItem(s) {
  const t = ensureTradeState(s);
  const idx = Math.max(0, Math.min(SHOP_ITEMS.length - 1, Math.floor(Number(t.session.theirItemKey || 0))));
  t.session.theirItemKey = String(idx);
  return SHOP_ITEMS[idx];
}

function selectedOfferItem(s) {
  const t = ensureTradeState(s);
  const opts = getInventoryOptions(s);
  if (!t.session.offeredItemKey) return null;
  const idx = Number(String(t.session.offeredItemKey).replace("inv:", ""));
  return opts.find((x) => Number(x.idx) === idx) || null;
}

function offerValue(s) {
  const t = ensureTradeState(s);
  const gold = Math.max(0, Math.floor(Number(t.session.offeredGold || 0)));
  const offered = selectedOfferItem(s);
  const qty = Math.max(1, Math.floor(Number(t.session.offeredQty || 1)));
  const itemValue = offered ? Math.max(5, Math.floor(Number(offered.it.value || offered.it.price || 20))) * Math.min(qty, Math.max(1, Number(offered.it.qty || 1))) : 0;
  return gold + itemValue;
}

async function aiEvaluate(s) {
  if (aiInFlight) return null;
  const t = ensureTradeState(s);
  if (ensureMmoState(s).aiEnabled === false) return null;
  aiInFlight = true;
  try {
    const npc = selectedNpc(s);
    const their = selectedTheirItem(s);
    const offered = selectedOfferItem(s);
    const prompt = [
      "Evaluate a simulated MMORPG player-to-player trade.",
      "Return ONLY JSON: {\"decision\":\"accept|reject|counter\",\"counterGold\":number,\"comment\":\"short\"}.",
      `NPC: ${JSON.stringify(npc)}`,
      `Player offers gold: ${Number(t.session.offeredGold || 0)}`,
      offered ? `Player offers item: ${offered.it.name} x${Number(t.session.offeredQty || 1)}` : "Player offers no item.",
      `NPC offers item: ${their.name}, rough value ${their.value}.`,
      "Accept if the offer is fair. Counter if close. Reject if far too low.",
    ].join("\n");
    const data = await aiJson(prompt, "MMO Trade");
    if (!data || typeof data !== "object") return null;
    const decision = String(data.decision || "").toLowerCase();
    if (!["accept", "reject", "counter"].includes(decision)) return null;
    return {
      decision,
      counterGold: Math.max(0, Math.floor(Number(data.counterGold || 0))),
      comment: clampText(data.comment || "", 140),
    };
  } finally {
    aiInFlight = false;
  }
}

function proceduralEvaluate(s) {
  const their = selectedTheirItem(s);
  const value = offerValue(s);
  if (value >= Number(their.value || 0)) return { decision: "accept", comment: "Fair enough. Deal." };
  if (value >= Number(their.value || 0) * 0.65) {
    return {
      decision: "counter",
      counterGold: Math.max(0, Math.ceil(Number(their.value || 0) - value)),
      comment: "Close. Add a little more and I will take it.",
    };
  }
  return { decision: "reject", comment: "Too light for what I am offering." };
}

function removeOfferedItem(s) {
  const t = ensureTradeState(s);
  const picked = selectedOfferItem(s);
  if (!picked) return true;
  const qty = Math.max(1, Math.floor(Number(t.session.offeredQty || 1)));
  const current = Math.max(1, Math.floor(Number(picked.it.qty || 1)));
  if (current < qty) return false;
  picked.it.qty = current - qty;
  if (picked.it.qty <= 0) {
    s.inventory.items.splice(picked.idx, 1);
  }
  return true;
}

function completeTrade(s) {
  const t = ensureTradeState(s);
  const their = selectedTheirItem(s);
  const gold = Math.max(0, Math.floor(Number(t.session.offeredGold || 0)));
  if (gold > 0 && !spendCurrency(s, gold)) {
    t.session.status = `Not enough ${s.currencySymbol || "G"} for that offer.`;
    return false;
  }
  if (!removeOfferedItem(s)) {
    t.session.status = "You do not have enough of that item.";
    return false;
  }
  if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
  addInventoryItemWithStack(s.inventory.items, { ...their, qty: 1, _meta: { source: "mmo_trade" } }, { source: "mmo_trade" });
  t.log.unshift({
    id: uid("trade_log"),
    ts: Date.now(),
    npc: selectedNpc(s)?.name || "Trader",
    offeredGold: gold,
    received: their.name,
  });
  t.log = t.log.slice(0, 25);
  t.session.userAccepted = false;
  t.session.npcAccepted = false;
  t.session.offeredGold = 0;
  t.session.offeredItemKey = "";
  t.session.offeredQty = 1;
  t.session.status = `Trade complete: received ${their.name}.`;
  return true;
}

async function acceptTrade() {
  const s = getSettings();
  const t = ensureTradeState(s);
  t.session.userAccepted = true;
  t.session.status = "Waiting for their confirmation...";
  persistMmo("mmo-trade");
  render();
  const verdict = await aiEvaluate(s) || proceduralEvaluate(s);
  if (verdict.decision === "accept") {
    t.session.npcAccepted = true;
    t.session.status = verdict.comment || "Accepted.";
    completeTrade(s);
    persistMmo("mmo-trade");
    toast("success", "Trade accepted.", "Trade");
  } else if (verdict.decision === "counter") {
    t.session.userAccepted = false;
    t.session.npcAccepted = false;
    const add = Math.max(1, Math.floor(Number(verdict.counterGold || 1)));
    t.session.status = `${verdict.comment || "Counter offer."} Add ${formatCurrency(add, s, { exchange: false })}.`;
    persistMmo("mmo-trade");
    toast("info", "The trader countered your offer.", "Trade");
  } else {
    t.session.userAccepted = false;
    t.session.npcAccepted = false;
    t.session.status = verdict.comment || "Offer rejected.";
    persistMmo("mmo-trade");
    toast("warning", "Trade rejected.", "Trade");
  }
  render();
}

function saveDraftFromInputs() {
  const s = getSettings();
  const t = ensureTradeState(s);
  t.session.npcId = String(document.getElementById("uie-trade-npc")?.value || t.session.npcId || "");
  t.session.offeredGold = Math.max(0, Math.floor(Number(document.getElementById("uie-trade-gold")?.value || 0)));
  t.session.offeredItemKey = String(document.getElementById("uie-trade-item")?.value || "");
  t.session.offeredQty = Math.max(1, Math.floor(Number(document.getElementById("uie-trade-qty")?.value || 1)));
  t.session.theirItemKey = String(document.getElementById("uie-trade-their-item")?.value || "0");
  t.session.userAccepted = false;
  t.session.npcAccepted = false;
  persistMmo("mmo-trade");
  render();
}

function renderTrade() {
  const s = getSettings();
  const t = ensureTradeState(s);
  const sess = t.session;
  const npc = selectedNpc(s);
  const their = selectedTheirItem(s);
  const inv = getInventoryOptions(s);
  const balance = formatCurrency(Number(s.currency || 0), s, { exchange: false });

  const npcSel = document.getElementById("uie-trade-npc");
  if (npcSel) {
    npcSel.innerHTML = getNpcOptions(s).map((x) => `<option value="${esc(x.id)}">${esc(x.name)} - ${esc(x.style || "Trader")}</option>`).join("");
    npcSel.value = npc?.id || "";
  }
  const itemSel = document.getElementById("uie-trade-item");
  if (itemSel) {
    itemSel.innerHTML = `<option value="">No item</option>` + inv.map(({ it, idx }) => `<option value="inv:${esc(idx)}">${esc(it.name)} x${esc(it.qty || 1)}</option>`).join("");
    itemSel.value = sess.offeredItemKey || "";
  }
  const theirSel = document.getElementById("uie-trade-their-item");
  if (theirSel) {
    theirSel.innerHTML = SHOP_ITEMS.map((it, idx) => `<option value="${idx}">${esc(it.name)} (${esc(formatCurrency(it.value, s, { exchange: false }))})</option>`).join("");
    theirSel.value = sess.theirItemKey || "0";
  }
  const goldInput = document.getElementById("uie-trade-gold");
  if (goldInput) goldInput.value = String(sess.offeredGold || 0);
  const qtyInput = document.getElementById("uie-trade-qty");
  if (qtyInput) qtyInput.value = String(sess.offeredQty || 1);
  const balanceEl = document.getElementById("uie-trade-balance");
  if (balanceEl) balanceEl.textContent = balance;
  const valueEl = document.getElementById("uie-trade-value");
  if (valueEl) valueEl.textContent = formatCurrency(offerValue(s), s, { exchange: false });
  const theirBox = document.getElementById("uie-trade-their-preview");
  if (theirBox) {
    theirBox.innerHTML = `<div class="trade-item-name">${esc(their.name)}</div><div class="trade-item-meta">${esc(their.rarity)} ${esc(their.type)} - ${esc(formatCurrency(their.value, s, { exchange: false }))}</div><p>${esc(their.description || "")}</p>`;
  }
  const status = document.getElementById("uie-trade-status");
  if (status) status.textContent = sess.status || "Choose offers and confirm.";
  const flags = document.getElementById("uie-trade-flags");
  if (flags) {
    flags.innerHTML = `
      <span class="${sess.userAccepted ? "on" : ""}">You ${sess.userAccepted ? "accepted" : "pending"}</span>
      <span class="${sess.npcAccepted ? "on" : ""}">Them ${sess.npcAccepted ? "accepted" : "pending"}</span>
    `;
  }
  const log = document.getElementById("uie-trade-log");
  if (log) {
    log.innerHTML = t.log.length ? t.log.map((x) => `<div>${esc(x.npc)} traded ${esc(x.received)} for ${esc(formatCurrency(x.offeredGold || 0, s, { exchange: false }))}</div>`).join("") : `<div>No completed trades yet.</div>`;
  }
}

function bindEvents() {
  const win = document.getElementById("uie-trade-window");
  if (!win) return;
  win.addEventListener("click", (ev) => {
    const target = ev.target;
    if (target?.closest?.("#uie-trade-close")) {
      win.style.display = "none";
      return;
    }
    if (target?.closest?.("#uie-trade-accept")) {
      void acceptTrade();
      return;
    }
    if (target?.closest?.("#uie-trade-reset")) {
      const s = getSettings();
      const t = ensureTradeState(s);
      t.session.offeredGold = 0;
      t.session.offeredItemKey = "";
      t.session.offeredQty = 1;
      t.session.userAccepted = false;
      t.session.npcAccepted = false;
      t.session.status = "Offer cleared.";
      persistMmo("mmo-trade");
      render();
    }
  });
  win.addEventListener("change", (ev) => {
    if (["uie-trade-npc", "uie-trade-item", "uie-trade-qty", "uie-trade-gold", "uie-trade-their-item"].includes(ev.target?.id)) saveDraftFromInputs();
  });
  win.addEventListener("input", (ev) => {
    if (["uie-trade-qty", "uie-trade-gold"].includes(ev.target?.id)) saveDraftFromInputs();
  });
}

export function render() {
  const s = getSettings();
  ensureTradeState(s);
  renderTrade();
}

export function initTrade() {
  if (!initialized) {
    initialized = true;
    bindEvents();
  }
  render();
}

export function openTrade() {
  const win = document.getElementById("uie-trade-window");
  if (win) win.style.display = "flex";
  initTrade();
}
