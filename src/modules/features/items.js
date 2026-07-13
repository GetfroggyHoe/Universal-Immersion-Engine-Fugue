import { getSettings, saveSettings } from "../core.js";
import { generateContent } from "../apiClient.js";
import { notify } from "../notifications.js";
import { applyItemGiftToContact } from "../social.js";
import { getContext } from "../gameContext.js";
import { SLOT_TYPES_CORE } from "../slot_types_core.js";
import { inferItemType } from "../slot_types_infer.js";
import { injectRpEvent } from "./rp_log.js";
import {
  INVENTORY_STACK_LIMIT,
  addInventoryItemWithStack,
  addManyInventoryItemsWithStack,
  ensureOpenableContents,
  isBookItem,
  isContainerItem,
  isOpenableItem,
  normalizeInventoryStacksInPlace,
  normalizeItemUsePayload,
  summarizeItemsForLog,
} from "../inventoryItems.js";

let mounted = false;
let activeIdx = null;
let activeReader = { item: null, page: 0 };
let viewMode = "items";
let genNeedsConfirm = false;
let containerModalBag = null;
const CONTAINER_STACK_CAP = 24;

export function init() {
  const $root = $("#uie-items-root");
  if (!$root.length) return;
  if (mounted) {
    try { render(); } catch (_) {}
    return;
  }
  mounted = true;
  try { bind(); } catch (_) {}
  try { render(); } catch (_) {}
}

function ensureModel(s) {
  if (!s) return;
  if (!s.inventory) s.inventory = {};
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
  if (!Array.isArray(s.inventory.skills)) s.inventory.skills = [];
  if (!Array.isArray(s.inventory.assets)) s.inventory.assets = [];
  if (!Array.isArray(s.inventory.statuses)) s.inventory.statuses = [];
  try { normalizeInventoryStacksInPlace(s.inventory.items, { source: "items_module" }); } catch (_) {}
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loreKeys() {
  try {
    const ctx = getContext?.();
    const maybe = ctx?.world_info || ctx?.lorebook || ctx?.lore || ctx?.worldInfo;
    const keys = [];
    if (Array.isArray(maybe)) {
      for (const it of maybe) {
        const k = it?.key || it?.name || it?.title;
        if (k) keys.push(String(k));
      }
    } else if (maybe && typeof maybe === "object") {
      const entries = maybe.entries || maybe.world_info || maybe.items;
      if (Array.isArray(entries)) {
        for (const it of entries) {
          const k = it?.key || it?.name || it?.title;
          if (k) keys.push(String(k));
        }
      }
    }
    return Array.from(new Set(keys)).slice(0, 80);
  } catch (_) {
    return [];
  }
}

function chatSnippet() {
  try {
    let raw = "";
    const $txt = $(".chat-msg-txt");
    if ($txt.length) {
      $txt.slice(-20).each(function () { raw += $(this).text() + "\n"; });
      return raw.trim().slice(0, 2200);
    }
    const chatEl = document.querySelector("#chat");
    if (!chatEl) return "";
    const msgs = Array.from(chatEl.querySelectorAll(".mes")).slice(-20);
    for (const m of msgs) {
      const isUser =
        m.classList?.contains("is_user") ||
        m.getAttribute("is_user") === "true" ||
        m.getAttribute("data-is-user") === "true" ||
        m.dataset?.isUser === "true";
      const t =
        m.querySelector(".mes_text")?.textContent ||
        m.querySelector(".mes-text")?.textContent ||
        m.textContent ||
        "";
      raw += `${isUser ? "You" : "Story"}: ${String(t || "").trim()}\n`;
    }
    return raw.trim().slice(0, 2200);
  } catch (_) {
    return "";
  }
}

function normalizeKind(k) {
  const t = String(k || "").toLowerCase();
  if (t === "skills" || t === "skill") return "skill";
  if (t === "assets" || t === "asset") return "asset";
  return "item";
}

function cleanJsonText(t) {
  return String(t || "").replace(/```json|```/g, "").trim();
}

function contextBlob() {
  const lk = loreKeys();
  const chat = chatSnippet();
  return `${lk.join(", ")}\n${chat}`;
}

function filterEvidence(evidence, blob) {
  const out = [];
  const b = String(blob || "");
  const ev = Array.isArray(evidence) ? evidence : [];
  for (const e of ev) {
    const s = String(e || "").trim();
    if (!s) continue;
    if (s.length > 120) continue;
    if (b.includes(s)) out.push(s);
  }
  return Array.from(new Set(out)).slice(0, 8);
}

function validateEntry(kind, obj) {
  const k = normalizeKind(kind);
  const o = obj && typeof obj === "object" ? obj : {};
  const errors = [];

  const name = String(o.name || "").trim();
  if (!name) errors.push("Missing name");

  if (k === "item") {
    const type = String(o.type || "").trim();
    if (!type) errors.push("Missing type");
    const description = String(o.description || o.desc || "").trim();
    if (!description) errors.push("Missing description");
  }

  if (k === "skill") {
    const st = String(o.skillType || o.type || "").toLowerCase();
    if (!["active", "passive"].includes(st)) errors.push("skillType must be active or passive");
    const description = String(o.description || o.desc || "").trim();
    if (!description) errors.push("Missing description");
  }

  if (k === "asset") {
    const category = String(o.category || o.type || "").trim();
    if (!category) errors.push("Missing category");
    const description = String(o.description || o.desc || "").trim();
    if (!description) errors.push("Missing description");
    const location = String(o.location || "").trim();
    if (!location) errors.push("Missing location");
  }

  return { ok: errors.length === 0, errors };
}

const SLOT_ICON = {
  EQUIPMENT_CLASS: "fa-shield-halved",
  ALCHEMY: "fa-flask",
  ENCHANTMENT: "fa-wand-magic-sparkles",
  CRAFTING: "fa-hammer",
  COOKING: "fa-utensils",
  QUEST: "fa-key",
  FARMING: "fa-seedling",
  HUSBANDRY: "fa-horse",
  FISHING: "fa-fish",
  ENTOMOLOGY: "fa-bug",
  MERCHANT: "fa-receipt",
  FORAGING: "fa-leaf",
  TAILORING: "fa-scissors",
  OCCULT: "fa-skull",
  BARDIC: "fa-music",
  MISC: "fa-box",
  UNCATEGORIZED: "fa-tags"
};

function titleCase(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function closeBookReader() {
  saveActiveReaderPage();
  activeReader = { item: null, page: 0 };
  $("#uie-item-reader-modal").hide();
}

function normalizeBookPages(item, fallbackText = "") {
  if (!item.book || typeof item.book !== "object") item.book = {};
  const rawPages = Array.isArray(item.book.pages) ? item.book.pages : [];
  let pages = rawPages
    .map((page, index) => {
      if (typeof page === "string") return { title: `Page ${index + 1}`, text: page };
      if (page && typeof page === "object") {
        return {
          title: String(page.title || `Page ${index + 1}`).slice(0, 80),
          text: String(page.text || page.content || ""),
        };
      }
      return null;
    })
    .filter(Boolean);

  if (!pages.length) {
    const text = String(item.book.text || fallbackText || item.description || item.desc || "");
    const chunks = text.trim()
      ? text.match(/[\s\S]{1,1800}(?=\s|$)/g) || [text]
      : [""];
    pages = chunks.map((chunk, index) => ({ title: `Page ${index + 1}`, text: chunk.trim() }));
  }

  item.book.pages = pages;
  item.book.text = pages.map((page) => String(page.text || "")).join("\n\n");
  return pages;
}

function saveActiveReaderPage() {
  const item = activeReader?.item;
  if (!item?.book) return;
  const page = Math.max(0, Number(activeReader.page || 0));
  const pages = normalizeBookPages(item);
  if (!pages[page]) return;
  pages[page].text = String($("#uie-item-reader-page").html() || "");
  item.book.text = pages.map((entry) => String(entry.text || "")).join("\n\n");
  saveSettings();
}

function renderActiveReaderPage() {
  const item = activeReader?.item;
  if (!item?.book) return;
  const pages = normalizeBookPages(item);
  activeReader.page = Math.max(0, Math.min(Number(activeReader.page || 0), pages.length - 1));
  const page = pages[activeReader.page] || { text: "" };
  $("#uie-item-reader-page").html(page.text || "");
  $("#uie-item-reader-page-indicator").text(`${activeReader.page + 1}/${pages.length}`);
  $("#uie-item-reader-prev").prop("disabled", activeReader.page <= 0);
  $("#uie-item-reader-next").prop("disabled", activeReader.page >= pages.length - 1);
}

function openBookReader(title, text, item = null) {
  const safeTitle = String(title || "Book").trim() || "Book";
  const target = item && typeof item === "object" ? item : { book: { title: safeTitle, text } };
  normalizeBookPages(target, text);
  activeReader = { item: target, page: 0 };
  $("#uie-item-reader-title").text(safeTitle);
  renderActiveReaderPage();
  $("#uie-item-reader-modal").css("display", "flex");
}

function consumeOneFromStack(list, idx) {
  const it = list[idx];
  if (!it || typeof it !== "object") return false;
  const q = Number(it.qty || 1);
  if (Number.isFinite(q) && q > 1) {
    it.qty = q - 1;
    return true;
  }
  list.splice(idx, 1);
  return true;
}

function itemRetainsOnUse(it) {
  if (!it || typeof it !== "object") return false;
  return it.locked === true;
}

/** Default: Use / Use (Chat) consumes one. Lock skips; `use.consumes === false` skips. */
function shouldConsumeOnUse(it) {
  if (!it || typeof it !== "object") return true;
  if (itemRetainsOnUse(it)) return false;
  const u = it.use && typeof it.use === "object" ? it.use : {};
  if (u.consumes === false || u.consume === false) return false;
  return true;
}

function mergeStacksIntoPartyItemList(list, moved) {
  if (!Array.isArray(list) || !Array.isArray(moved) || !moved.length) return;
  const base = moved[0];
  const keyName = String(base?.name || "");
  const keyType = String(base?.type || "");
  let remaining = moved.length;
  for (const row of list) {
    if (remaining <= 0) break;
    const same = String(row?.name || "") === keyName && String(row?.type || "") === keyType;
    if (!same) continue;
    const cur = Math.max(0, Math.floor(Number(row.qty || 0)));
    const room = Math.max(0, INVENTORY_STACK_LIMIT - cur);
    if (!room) continue;
    const put = Math.min(room, remaining);
    row.qty = cur + put;
    remaining -= put;
  }
  while (remaining > 0) {
    const put = Math.min(INVENTORY_STACK_LIMIT, remaining);
    list.push({ ...base, qty: put });
    remaining -= put;
  }
}

function syncItemPersistModalButtons(it) {
  const $star = $("#uie-item-toggle-star");
  const $lock = $("#uie-item-toggle-lock");
  if (!$star.length || !$lock.length) return;
  const st = !!it?.starred;
  const lk = !!it?.locked;
  $star.toggleClass("uie-persist-on", st);
  $lock.toggleClass("uie-persist-on", lk);
  $star.find("i").attr("class", st ? "fa-solid fa-star" : "fa-regular fa-star");
  $lock.find("i").attr("class", lk ? "fa-solid fa-lock" : "fa-solid fa-lock-open");
}

function toggleItemPersistFlag(mode) {
  const s = getSettings();
  ensureModel(s);
  const idx = Number(activeIdx);
  if (!Number.isFinite(idx)) return;
  const list = s.inventory.items;
  const it = list[idx];
  if (!it) return;
  if (mode === "star") it.starred = !it.starred;
  else if (mode === "lock") it.locked = !it.locked;
  saveSettings();
  syncItemPersistModalButtons(it);
  render();
}

function isEnchantModdedItem(it) {
  if (!it || typeof it !== "object") return false;
  if (it.enchant && typeof it.enchant === "object") return true;
  const source = String(it._meta?.source || it.modSource || "").toLowerCase();
  return source.includes("enchant");
}

/** Applies `use.needs` / `use.progress` to HUD life trackers (needs.*, hp, uie, skillPoints, â€¦). */
function applyItemFunctionalEffects(it) {
  if (!it || typeof it !== "object") return;
  const fromUse = it.use && typeof it.use === "object" ? it.use : {};
  const loose = normalizeItemUsePayload({
    needs: it.needs && typeof it.needs === "object" ? it.needs : undefined,
    progress: it.progress && typeof it.progress === "object" ? it.progress : undefined,
  });
  const mergedNeeds = { ...(loose?.needs || {}), ...(fromUse.needs || {}) };
  const mergedProg = { ...(loose?.progress || {}), ...(fromUse.progress || {}) };
  const markItemTrackerSources = () => {
    try {
      const s = getSettings();
      const names = [
        ...Object.keys(mergedNeeds).map((k) => `needs.${k}`),
        ...Object.keys(mergedNeeds),
        ...Object.keys(mergedProg),
      ].map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
      const mark = (tracker) => {
        if (!tracker || typeof tracker !== "object") return;
        const id = String(tracker.id || tracker.key || tracker.name || "").trim().toLowerCase();
        if (!names.some((name) => id === name || id.endsWith(`.${name}`))) return;
        const sources = new Set(Array.isArray(tracker.sources) ? tracker.sources.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean) : []);
        sources.add("item");
        tracker.sources = Array.from(sources);
        tracker.lastChangedBy = "item";
      };
      (Array.isArray(s?.life?.trackers) ? s.life.trackers : []).forEach(mark);
      (Array.isArray(s?.ui?.customTrackers) ? s.ui.customTrackers : []).forEach(mark);
      saveSettings();
    } catch (_) {}
  };
  if (Object.keys(mergedNeeds).length) {
    try {
      if (typeof window.__UIE_applyNeedsDelta === "function") window.__UIE_applyNeedsDelta(mergedNeeds);
    } catch (_) {}
  }
  if (Object.keys(mergedProg).length) {
    try {
      if (typeof window.__UIE_applyProgressDelta === "function") window.__UIE_applyProgressDelta(mergedProg);
    } catch (_) {}
  }
  if (Object.keys(mergedNeeds).length || Object.keys(mergedProg).length) markItemTrackerSources();
}

async function ensureBookText(it) {
  if (!it || typeof it !== "object") return null;
  if (!it.book || typeof it.book !== "object") {
    it.book = {
      title: String(it.name || "Book").trim().slice(0, 120) || "Book",
      text: "",
      generatedAt: Date.now(),
      source: "item_open",
    };
  }

  if (String(it.book.text || "").trim() || (Array.isArray(it.book.pages) && it.book.pages.length)) return it.book;

  const itemName = String(it.name || "Book").trim().slice(0, 120) || "Book";
  const itemType = String(it.type || "Book").trim().slice(0, 80) || "Book";
  const itemDesc = String(it.description || it.desc || "").trim().slice(0, 1200);
  const context = String(chatSnippet() || "").trim().slice(0, 2400);

  let title = String(it.book.title || itemName || "Book").trim().slice(0, 120) || "Book";
  let text = String(it.book.text || "").trim();

  let pages = [];

  const bookPrompt = `Return ONLY JSON object:
{"title":"","pages":[{"title":"Page 1","text":""}],"text":""}

Task: Write the readable in-world content of a physical book, document, note, tome, grimoire, textbook, journal, ledger, letter, scroll, or manual.
Book item:
- Name: ${itemName}
- Type: ${itemType}
- Description: ${itemDesc || "(none)"}

Rules:
- Match the setting and tone of the context.
- Use as many concise pages as the item needs; long books, files, ledgers, or document stacks may exceed 30 pages. Use 1 page for a short note/letter.
- Each page text must be useful in-world content the player can read or write around later.
- Include study, lore, recipe, spell, clue, or personal details only when appropriate to the item.
- Also fill text as the plain combined page text.
- No markdown code fences.

Context excerpt:
${context || "(no context)"}`;

  try {
    const res = await generateContent(bookPrompt.slice(0, 6000), "System Check");
    const cleaned = String(res || "").replace(/```json|```/g, "").trim();
    if (cleaned) {
      try {
        const obj = JSON.parse(cleaned);
        if (obj && typeof obj === "object") {
          title = String(obj.title || title || itemName || "Book").trim().slice(0, 120) || "Book";
          text = String(obj.text || obj.content || "").trim();
          if (Array.isArray(obj.pages)) {
            pages = obj.pages
              .map((page, index) => {
                if (typeof page === "string") return { title: `Page ${index + 1}`, text: page.trim() };
                if (page && typeof page === "object") {
                  return {
                    title: String(page.title || `Page ${index + 1}`).trim().slice(0, 80),
                    text: String(page.text || page.content || "").trim(),
                  };
                }
                return null;
              })
              .filter((page) => page && page.text)
              .slice(0, 80);
          }
          if (!text && pages.length) text = pages.map((page) => page.text).join("\n\n");
        }
      } catch (_) {
        text = cleaned;
      }
    }
  } catch (_) {}

  if (!text) {
    text = itemDesc ?
       `Title: ${title}\n\n${itemDesc}`
      : `${title}\n\nThe pages are mostly blank, but a few faint lines suggest this text has weathered many journeys.`;
  }

  if (!pages.length) {
    pages = String(text).trim()
      .match(/[\s\S]{1,1800}(?=\s|$)/g)
      ?.map((chunk, index) => ({ title: `Page ${index + 1}`, text: chunk.trim() })) || [{ title: "Page 1", text: String(text).trim() }];
  }

  it.book = {
    title,
    text: String(text).trim().slice(0, 12000),
    pages,
    generatedAt: Number(it.book.generatedAt || Date.now()) || Date.now(),
    source: String(it.book.source || "item_open").trim().slice(0, 40) || "item_open",
  };

  return it.book;
}

function openContainerAndLoot(list, idx, it) {
  const hint = `${String(it?.description || it?.desc || "")}\n${String(chatSnippet() || "").slice(0, 1600)}`;
  const contents = ensureOpenableContents(it, hint);
  const loot = Array.isArray(contents) ? contents : [];

  if (it?.openable && typeof it.openable === "object") {
    it.openable.openedCount = Math.max(0, Number(it.openable.openedCount || 0)) + 1;
    it.openable.lastOpenedAt = Date.now();
  }

  const out = addManyInventoryItemsWithStack(list, loot, {
    source: "container_open",
    chatHint: hint,
  });

  consumeOneFromStack(list, idx);
  return {
    loot,
    addedQty: Number(out?.addedQty || 0),
    addedStacks: Number(out?.addedStacks || 0),
    stackedQty: Number(out?.stackedQty || 0),
  };
}

function closeContainerModal() {
  containerModalBag = null;
  $("#uie-container-modal").hide();
}

function resolveContainerInventoryIndex(list) {
  if (!containerModalBag || !Array.isArray(list)) return -1;
  return list.indexOf(containerModalBag);
}

function pullQtyFromInventoryList(list, invIdx, qtyWant) {
  const it = list[invIdx];
  if (!it || typeof it !== "object") return null;
  const q = Math.max(1, Math.floor(Number(it.qty) || 1));
  const take = Math.min(Math.max(1, Math.floor(Number(qtyWant) || 1)), q);
  let piece;
  try {
    piece = JSON.parse(JSON.stringify(it));
  } catch (_) {
    piece = { ...it };
  }
  piece.qty = take;
  if (take >= q) {
    list.splice(invIdx, 1);
  } else {
    it.qty = q - take;
  }
  return piece;
}

function renderContainerModal() {
  const s = getSettings();
  ensureModel(s);
  const list = s.inventory.items;
  const idx = resolveContainerInventoryIndex(list);
  const bag = containerModalBag;
  if (idx < 0 || !bag || !isContainerItem(bag)) {
    closeContainerModal();
    return;
  }

  const hint = `${String(bag?.description || bag?.desc || "")}\n${String(chatSnippet() || "").slice(0, 1600)}`;
  ensureOpenableContents(bag, hint);
  const contents = Array.isArray(bag.openable?.contents) ? bag.openable.contents : [];

  $("#uie-container-modal-title").text(String(bag.name || "Container"));
  $("#uie-container-modal-sub").text(
    `${contents.length} stack(s) Â· max ${CONTAINER_STACK_CAP} Â· inventory slot #${idx + 1}`,
  );

  const $list = $("#uie-container-contents-list");
  $list.empty();
  if (!contents.length) {
    $list.append(
      `<div style="padding:14px;color:rgba(255,255,255,0.55);font-size:13px;line-height:1.45;">This container is empty. Choose an inventory item below and press Stow.</div>`,
    );
  }
  contents.forEach((entry, ci) => {
    const name = esc(String(entry.name || "?"));
    const qty = entry.qty ?? 1;
    const row = $(
      `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);"></div>`,
    );
    row.append(
      `<span style="flex:1;min-width:0;font-weight:800;color:rgba(255,255,255,0.92);">${name} <span style="opacity:0.6;font-weight:700;">Ã—${esc(String(qty))}</span></span>`,
    );
    row.append(
      `<button type="button" class="uie-container-take" data-ci="${ci}" style="padding:8px 14px;border-radius:6px;border:1px solid rgba(76,201,240,0.4);background:rgba(76,201,240,0.12);color:#9ee;font-weight:900;cursor:pointer;font-size:12px;">Take</button>`,
    );
    $list.append(row);
  });

  const $sel = $("#uie-container-stow-select");
  $sel.empty();
  $sel.append(new Option("(Choose inventory itemâ€¦)", ""));
  list.forEach((invIt, ii) => {
    if (invIt === bag) return;
    const nm = String(invIt?.name || "Item").slice(0, 52);
    $sel.append(new Option(`${nm} (#${ii + 1})`, String(ii)));
  });
}

function openContainerManager(list, idx, it) {
  const hint = `${String(it?.description || it?.desc || "")}\n${String(chatSnippet() || "").slice(0, 1600)}`;
  ensureOpenableContents(it, hint);
  if (it?.openable && typeof it.openable === "object") {
    it.openable.openedCount = Math.max(0, Number(it.openable.openedCount || 0)) + 1;
    it.openable.lastOpenedAt = Date.now();
  }
  containerModalBag = it;
  saveSettings();
  renderContainerModal();
  $("#uie-container-modal").css("display", "flex");
  closeItemModal();
}

function ensureSlotCategory(s, it) {
  if (!it || typeof it !== "object") return "UNCATEGORIZED";
  try {
    if (s?.inventory?.ui?.slotTypesEnabled === false) {
      it.slotCategory = "UNCATEGORIZED";
      return "UNCATEGORIZED";
    }
  } catch (_) {}
  const existing = String(it.slotCategory || "").trim().toUpperCase();
  if (existing) return existing;
  const inferred = inferItemType(it);
  let cat = String(inferred?.category || "UNCATEGORIZED").toUpperCase();
  if (cat === "UNCATEGORIZED" && isBookItem(it) && inferred?.source !== "disabled") {
    cat = "KNOWLEDGE";
  }
  it.slotCategory = cat;
  return cat;
}

function getCategoryKeys() {
  return Object.keys(SLOT_TYPES_CORE || {}).filter((k) => k && k !== "UNCATEGORIZED");
}

function renderCategoryUi(viewMode) {
  const $sel = $("#uie-items-category");
  const $chips = $("#uie-items-cat-chips");
  if (!$sel.length || !$chips.length) return;

  if (String(viewMode) !== "items") {
    $chips.hide();
    return;
  }

  const s = getSettings();
  if (s?.inventory?.ui?.slotTypesEnabled === false) {
    $chips.hide();
    $sel.hide();
    $sel.val("all");
    return;
  }
  $sel.show();
  $chips.show();

  const keys = getCategoryKeys();
  const cur = String($sel.val() || "all");

  $sel.empty();
  $sel.append(new Option("All", "all"));
  keys.forEach((k) => $sel.append(new Option(titleCase(k), k.toLowerCase())));
  $sel.val(cur);

  $chips.empty();
  const chipTemplate = document.getElementById("uie-cat-chip-template");

  const addChip = (cat, title, icon) => {
    const clone = chipTemplate.content.cloneNode(true);
    const $btn = $(clone).find("button");
    $btn.attr("data-cat", cat).attr("title", title);
    $btn.find("i").addClass(icon);
    $chips.append($btn);
  };

  addChip("all", "All", "fa-layer-group");
  keys.forEach((k) => {
    addChip(k.toLowerCase(), titleCase(k), SLOT_ICON[k] || "fa-tags");
  });
}

export function render() {
  const s = getSettings();
  if (!s) return;
  ensureModel(s);

  viewMode = "items";
  renderCategoryUi(viewMode);
  const list = s.inventory.items;
  const $grid = $("#uie-items-grid-inner");
  const $empty = $("#uie-items-empty");
  const $root = $("#uie-items-root");
  if (!$grid.length) return;
  if ($root.length) {
    $root.css({ display: "flex", flexDirection: "column", minHeight: "120px", overflow: "auto" });
  }
  $grid.css({
    display: "flex",
    flexWrap: "wrap",
    gridTemplateColumns: "",
    gridAutoRows: "",
    gap: "12px",
    alignContent: "start",
    alignItems: "stretch",
    minWidth: "0",
  });

  const q = String($("#uie-items-search").val() || "").toLowerCase();
  const cat = String($("#uie-items-category").val() || "all");
  $(".uie-cat-chip").removeClass("active");
  $(`.uie-cat-chip[data-cat="${cat}"]`).addClass("active");

  let didMutate = false;
  const filtered = list.filter((it) => {
    const name = String(it?.name || "");
    let okCat = true;
    const slotCat = ensureSlotCategory(s, it).toLowerCase();
    okCat = cat === "all" ? true : slotCat === cat;
    if (!it.slotCategory) didMutate = true;
    const okQ = !q ? true : name.toLowerCase().includes(q);
    return okCat && okQ;
  });
  if (didMutate) saveSettings();

  $grid.empty();

  if (!filtered.length) {
    if ($empty.length) $empty.show();
    return;
  }
  if ($empty.length) $empty.hide();

  const cardTemplate = document.getElementById("uie-item-card-template");

  filtered.forEach((it) => {
    const idx = list.indexOf(it);
    const rarity = String(it?.rarity || "common").toLowerCase();
    const cls =
      rarity === "uncommon" ?
         "rarity-uncommon"
        : rarity === "rare" ?
           "rarity-rare"
          : rarity === "epic" ?
             "rarity-epic"
            : rarity === "legendary" ?
               "rarity-legendary"
              : "rarity-common";

    const slotCat = String(it?.slotCategory || "UNCATEGORIZED").toUpperCase();
    const icon = SLOT_ICON[slotCat] || "fa-box";

    const clone = cardTemplate.content.cloneNode(true);
    const $el = $(clone).find(".uie-item");
    const itemName = String(it?.name || "Unnamed");

    $el.addClass(cls).attr("data-idx", idx).attr("data-view", viewMode).attr("title", itemName).attr("aria-label", itemName);
    // Qty
    const qty = Number.isFinite(Number(it?.qty)) ? Number(it.qty) : (String(it?.qty || "").trim() ? it.qty : "");
    if (qty !== "" && qty !== null && qty !== undefined) {
        $el.find(".uie-item-qty").text(qty);
    } else {
        $el.find(".uie-item-qty").remove();
    }

    // Thumb
    const $thumb = $el.find(".uie-thumb");
    const itemImg = String(it?.img || it?.image || "").trim();
    if (itemImg) {
        $("<img>").attr("src", itemImg).attr("alt", "").appendTo($thumb);
    } else {
        $("<i>").addClass(`fa-solid ${icon}`).css({fontSize:"34px", opacity:"0.92", color:"rgba(203, 163, 92,0.95)"}).appendTo($thumb);
    }

    // Body
    $el.find(".uie-item-name").text(itemName).attr("title", itemName);

    const $markers = $el.find(".uie-item-persist-markers");
    $markers.empty();
    if (it?.starred) {
      $markers.append(
        $('<i class="fa-solid fa-star" title="Favorite â€” quick access item"></i>').css({ color: "#cba35c" }),
      );
    }
    if (it?.locked) {
      $markers.append(
        $('<i class="fa-solid fa-lock" title="Locked â€” kept when used"></i>').css({ color: "#89b4fa" }),
      );
    }

    // Notes/FX
    const fx = it?.statusEffects && Array.isArray(it.statusEffects) && it.statusEffects.length ? it.statusEffects.join(", ") : "";
    if (fx) {
        $el.find(".uie-item-notes").text(fx);
    } else {
        $el.find(".uie-item-notes").remove();
    }

    $grid.append($el);
  });

}

function bind() {
  const doc = $(document);

  doc.off("input.uieItemsSearch", "#uie-items-search").on("input.uieItemsSearch", "#uie-items-search", () => render());
  doc.off("change.uieItemsCat", "#uie-items-category").on("change.uieItemsCat", "#uie-items-category", () => render());
  doc.off("click.uieItemsCatChip", ".uie-cat-chip").on("click.uieItemsCatChip", ".uie-cat-chip", function(e){
    e.preventDefault();
    e.stopPropagation();
    const cat = String($(this).data("cat") || "all");
    $("#uie-items-category").val(cat);
    render();
  });

  doc.off("click.uieItemsCard", "#uie-items-grid-inner .uie-item").on("click.uieItemsCard", "#uie-items-grid-inner .uie-item", function (e) {
    e.preventDefault();
    e.stopPropagation();

    const idx = Number($(this).data("idx"));
    const editMode = typeof window.UIE_isInventoryEditMode === "function" ? !!window.UIE_isInventoryEditMode() : false;
    if (editMode) {
      if (typeof window.UIE_openItemEditor === "function") window.UIE_openItemEditor(idx);
      return;
    }

    openItemModal(idx, this);
  });

  doc.off("contextmenu.uieItemsCard", "#uie-items-grid-inner .uie-item").on("contextmenu.uieItemsCard", "#uie-items-grid-inner .uie-item", function (e) {
    e.preventDefault();
    e.stopPropagation();
    const idx = Number($(this).data("idx"));
    openItemContextMenu(idx, e.clientX, e.clientY);
  });

  doc.off("click.uieItemModalClose", "#uie-item-modal-close").on("click.uieItemModalClose", "#uie-item-modal-close", (e) => {
    e.preventDefault(); 
    e.stopPropagation();
    e.stopImmediatePropagation();
    closeItemModal();
  });

  doc.off("click.uieItemModalBackdrop", "#uie-item-modal").on("click.uieItemModalBackdrop", "#uie-item-modal", function (e) {
    if (e.target !== this) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    closeItemModal();
  });

  doc.off("click.uieItemUse", "#uie-item-use").on("click.uieItemUse", "#uie-item-use", () => actOnItem("use"));
  doc.off("click.uieItemOpen", "#uie-item-open").on("click.uieItemOpen", "#uie-item-open", () => actOnItem("open"));
  doc.off("click.uieItemCustomUse", "#uie-item-custom-use").on("click.uieItemCustomUse", "#uie-item-custom-use", () => actOnItem("custom_use"));
  doc.off("click.uieItemUseChat", "#uie-item-use-chat").on("click.uieItemUseChat", "#uie-item-use-chat", () => actOnItem("use_chat"));

  doc.off("click.uieCtxItem", ".uie-ctx-item").on("click.uieCtxItem", ".uie-ctx-item", function(e) {
      e.preventDefault(); e.stopPropagation();
      const act = $(this).data("action");
      const idx = Number($(this).data("idx"));
      if (Number.isFinite(idx)) activeIdx = idx;
      if (act) actOnItem(act);
      $(".uie-ctx-menu-overlay").remove();
  });

  doc.off("click.uieItemEquip", "#uie-item-equip").on("click.uieItemEquip", "#uie-item-equip", () => actOnItem("equip"));
  doc.off("click.uieItemCustomEquip", "#uie-item-custom-equip").on("click.uieItemCustomEquip", "#uie-item-custom-equip", () => actOnItem("custom_equip"));
  doc.off("click.uieItemDiscard", "#uie-item-discard").on("click.uieItemDiscard", "#uie-item-discard", () => actOnItem("discard"));
  doc.off("click.uieItemSendParty", "#uie-item-send-party").on("click.uieItemSendParty", "#uie-item-send-party", () => actOnItem("send_party"));
  doc.off("click.uieItemGift", "#uie-item-gift").on("click.uieItemGift", "#uie-item-gift", () => actOnItem("gift"));

  doc.off("click.uieItemGiveCurChat", "#uie-item-give-currency-chat").on("click.uieItemGiveCurChat", "#uie-item-give-currency-chat", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    ensureModel(s);
    const it = s.inventory.items[activeIdx];
    if (!it) return;
    const sym = String(it.symbol || "").trim() || "Â¤";
    const line = `[Payment: ${String(it.name || "Funds")} (${sym}) â€” user hands over currency from inventory (stack qty ${Math.max(0, Number(it.qty || 0))}). Continue the scene; infer if the amount fits the price or social reaction.]`;
    try {
      await injectRpEvent(line);
    } catch (_) {}
    closeItemModal();
  });
  doc.off("click.uieItemGiveCurAmt", "#uie-item-give-currency-amt-go").on("click.uieItemGiveCurAmt", "#uie-item-give-currency-amt-go", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    ensureModel(s);
    const list = s.inventory.items;
    const it = list[activeIdx];
    if (!it) return;
    const amt = Math.max(1, Math.floor(Number($("#uie-item-give-currency-amt").val() || 1)));
    const q = Math.max(0, Number(it.qty || 0));
    if (!q) return;
    if (amt > q) {
      try {
        window.toastr?.warning?.(`Only ${q} available in this stack.`);
      } catch (_) {}
      return;
    }
    const sym = String(it.symbol || "").trim() || "Â¤";
    if (q > amt) it.qty = q - amt;
    else list.splice(activeIdx, 1);
    saveSettings();
    try {
      await injectRpEvent(
        `[Payment: User gives exactly ${amt} ${sym} (${String(it.name || "currency")}). Inventory stack updated; narrate the exchange and consequences.]`,
      );
    } catch (_) {}
    closeItemModal();
    try {
      render();
    } catch (_) {}
  });

  doc.off("click.uieItemToggleStar", "#uie-item-toggle-star").on("click.uieItemToggleStar", "#uie-item-toggle-star", (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    toggleItemPersistFlag("star");
  });
  doc.off("click.uieItemToggleLock", "#uie-item-toggle-lock").on("click.uieItemToggleLock", "#uie-item-toggle-lock", (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    toggleItemPersistFlag("lock");
  });

  doc.off("click.uieItemReaderClose", "#uie-item-reader-close").on("click.uieItemReaderClose", "#uie-item-reader-close", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeBookReader();
  });
  doc.off("input.uieItemReaderEdit", "#uie-item-reader-page").on("input.uieItemReaderEdit", "#uie-item-reader-page", () => {
    saveActiveReaderPage();
  });
  doc.off("click.uieItemReaderPrev", "#uie-item-reader-prev").on("click.uieItemReaderPrev", "#uie-item-reader-prev", (e) => {
    e.preventDefault();
    saveActiveReaderPage();
    activeReader.page = Math.max(0, Number(activeReader.page || 0) - 1);
    renderActiveReaderPage();
  });
  doc.off("click.uieItemReaderNext", "#uie-item-reader-next").on("click.uieItemReaderNext", "#uie-item-reader-next", (e) => {
    e.preventDefault();
    saveActiveReaderPage();
    activeReader.page = Number(activeReader.page || 0) + 1;
    renderActiveReaderPage();
  });
  doc.off("click.uieItemReaderAddPage", "#uie-item-reader-add-page").on("click.uieItemReaderAddPage", "#uie-item-reader-add-page", (e) => {
    e.preventDefault();
    saveActiveReaderPage();
    const item = activeReader?.item;
    if (!item) return;
    const pages = normalizeBookPages(item);
    pages.push({ title: `Page ${pages.length + 1}`, text: "" });
    activeReader.page = pages.length - 1;
    renderActiveReaderPage();
    saveSettings();
  });
  doc.off("click.uieItemReaderHighlight", "#uie-item-reader-highlight").on("click.uieItemReaderHighlight", "#uie-item-reader-highlight", (e) => {
    e.preventDefault();
    $("#uie-item-reader-page").focus();
    try {
      document.execCommand("hiliteColor", false, "#f6d365");
    } catch (_) {
      try { document.execCommand("backColor", false, "#f6d365"); } catch (_) {}
    }
    saveActiveReaderPage();
  });
  doc.off("click.uieItemReaderSave", "#uie-item-reader-save").on("click.uieItemReaderSave", "#uie-item-reader-save", (e) => {
    e.preventDefault();
    saveActiveReaderPage();
  });
  doc.off("click.uieItemReaderBackdrop", "#uie-item-reader-modal").on("click.uieItemReaderBackdrop", "#uie-item-reader-modal", function (e) {
    if (e.target !== this) return;
    e.preventDefault();
    e.stopPropagation();
    closeBookReader();
  });

  doc.off("click.uieContainerClose", "#uie-container-modal-close").on("click.uieContainerClose", "#uie-container-modal-close", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeContainerModal();
  });
  doc.off("click.uieContainerBackdrop", "#uie-container-modal").on("click.uieContainerBackdrop", "#uie-container-modal", function (e) {
    if (e.target !== this) return;
    e.preventDefault();
    e.stopPropagation();
    closeContainerModal();
  });
  doc.off("click.uieContainerTake", "#uie-container-modal").on("click.uieContainerTake", "#uie-container-modal", ".uie-container-take", function (e) {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    ensureModel(s);
    const list = s.inventory.items;
    const bagIdx = resolveContainerInventoryIndex(list);
    const bag = containerModalBag;
    if (bagIdx < 0 || !bag?.openable?.contents) return;
    const ci = Number($(this).data("ci"));
    const contents = bag.openable.contents;
    const entry = contents[ci];
    if (!entry) return;
    let piece;
    try {
      piece = JSON.parse(JSON.stringify(entry));
    } catch (_) {
      piece = { ...entry };
    }
    contents.splice(ci, 1);
    addInventoryItemWithStack(list, piece, { source: "container_take", chatHint: chatSnippet() });
    logAction(s, { action: "container_take", item: String(bag.name || "Container"), taken: String(entry.name || "") });
    saveSettings();
    renderContainerModal();
    render();
    try {
      window.toastr?.success?.(`Took ${String(entry.name || "item")}.`);
    } catch (_) {}
  });
  doc.off("click.uieContainerStow", "#uie-container-stow-run").on("click.uieContainerStow", "#uie-container-stow-run", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    ensureModel(s);
    const list = s.inventory.items;
    const bagIdx = resolveContainerInventoryIndex(list);
    const bag = containerModalBag;
    if (bagIdx < 0 || !bag?.openable) return;
    const invSel = String($("#uie-container-stow-select").val() || "").trim();
    if (!invSel) {
      try {
        window.toastr?.info?.("Pick an inventory item to stow.");
      } catch (_) {}
      return;
    }
    const invIdx = Number(invSel);
    if (!Number.isFinite(invIdx) || invIdx < 0 || invIdx >= list.length) return;
    if (list[invIdx] === bag) return;
    const qtyWant = Math.max(1, Math.floor(Number($("#uie-container-stow-qty").val()) || 1));
    const piece = pullQtyFromInventoryList(list, invIdx, qtyWant);
    if (!piece) return;
    const contents = Array.isArray(bag.openable.contents) ? bag.openable.contents : [];
    const trial = JSON.parse(JSON.stringify(contents));
    addInventoryItemWithStack(trial, piece, { source: "container_stow", chatHint: chatSnippet() });
    if (trial.length > CONTAINER_STACK_CAP) {
      addInventoryItemWithStack(list, piece, { source: "container_stow_rollback", chatHint: chatSnippet() });
      saveSettings();
      try {
        window.toastr?.info?.(`This container holds at most ${CONTAINER_STACK_CAP} stacks (merge duplicates or take items out first).`);
      } catch (_) {}
      renderContainerModal();
      render();
      return;
    }
    bag.openable.contents = trial;
    logAction(s, { action: "container_stow", item: String(bag.name || "Container"), stowed: String(piece.name || "") });
    saveSettings();
    renderContainerModal();
    render();
    try {
      window.toastr?.success?.(`Stowed ${String(piece.name || "item")}.`);
    } catch (_) {}
  });
  doc.off("click.uieContainerLootAll", "#uie-container-loot-all").on("click.uieContainerLootAll", "#uie-container-loot-all", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    ensureModel(s);
    const list = s.inventory.items;
    const bagIdx = resolveContainerInventoryIndex(list);
    const bag = containerModalBag;
    if (bagIdx < 0 || !bag) return;
    let ok = false;
    try {
      ok = confirm(
        "Take every stack from this container into your inventory and remove this bag (one stack from your inventory)?",
      );
    } catch (_) {
      ok = false;
    }
    if (!ok) return;
    const name = String(bag.name || "Container");
    const out = openContainerAndLoot(list, bagIdx, bag);
    logAction(s, { action: "open", item: name, qty: Number(out?.addedQty || 0), note: "container_loot_all" });
    saveSettings();
    closeContainerModal();
    render();
    const lootLine = summarizeItemsForLog(out?.loot || [], 4);
    const addedQty = Number(out?.addedQty || 0);
    if (addedQty > 0) {
      try {
        window.toastr?.success?.(`Emptied ${name}: ${lootLine}`);
      } catch (_) {}
    } else {
      try {
        window.toastr?.info?.(`${name} was empty; bag removed.`);
      } catch (_) {}
    }
    try {
      await injectRpEvent(`[System: Emptied ${name}. Loot: ${lootLine}.]`);
    } catch (_) {}
  });
}

function closeItemModal() {
  activeIdx = null;
  try {
    $("#uie-item-currency-actions").hide();
  } catch (_) {}
  $("#uie-item-modal").hide();
}

function openItemModal(idx, anchorEl) {
  const s = getSettings();
  ensureModel(s);
  const list = s.inventory.items;
  const it = list[idx];
  if (!it) return;
  activeIdx = idx;
  $("#uie-item-modal").attr("data-mode", "items");

  $("#uie-item-modal-title").text(String(it.name || "Item"));
  $("#uie-item-modal-sub").text(String(it.slotCategory ? titleCase(it.slotCategory) : (it.type || "item")));
  const tags = [];
  if (it.rarity) tags.push(String(it.rarity));
  const fx = Array.isArray(it.statusEffects) ? it.statusEffects : [];
  if (fx.length) tags.push(fx.join(", "));
  if (it.needsUserConfirm) tags.push("UNVERIFIED");
  if (typeof it.confidence === "number") tags.push(`conf ${Math.round(it.confidence * 100)}%`);
  $("#uie-item-modal-tags").text(tags.length ? tags.join(" â€¢ ") : "â€”");
  $("#uie-item-modal-desc").text(String(it.description || it.desc || "No description."));
  const meta = [];
  const slotCat = String(it.slotCategory || "");
  const type = String(it.type || "");
  meta.push(`<div><strong>Category:</strong> ${esc(slotCat ? titleCase(slotCat) : "UNCATEGORIZED")}</div>`);
  meta.push(`<div><strong>Type:</strong> ${esc(type || "—")}</div>`);
  meta.push(`<div><strong>Qty:</strong> ${esc(it.qty ?? 1)}</div>`);
  meta.push(`<div><strong>Status Effects:</strong> ${esc(fx.length ? fx.join(", ") : "—")}</div>`);
  if (isEnchantModdedItem(it)) {
    const mods = it.mods && typeof it.mods === "object" ? it.mods : {};
    const modKeys = ["str","dex","int","vit","luk","cha"];
    const modPairs = modKeys
      .map(k => [k, Number(mods?.[k] ?? 0)])
      .filter(([,v]) => Number.isFinite(v) && v !== 0)
      .map(([k,v]) => `${k.toUpperCase()} ${v > 0 ? `+${v}` : `${v}`}`);
    meta.push(`<div><strong>Enchant Mods:</strong> ${esc(modPairs.length ? modPairs.join(" • ") : "—")}</div>`);
  }
  const eq = isEquippable(it);
  if (eq) {
    const guess = inferEquipSlotId(it);
    meta.push(`<div><strong>Equip Slot (suggested):</strong> ${esc(guess || "manual")}</div>`);
  }
  if (isContainerItem(it)) {
    const count = Array.isArray(it?.openable?.contents) ? it.openable.contents.length : 0;
    meta.push(`<div><strong>Container:</strong> ${esc(count ? `${count} stack(s) inside` : "empty")}</div>`);
  }
  if (isBookItem(it)) {
    const title = String(it?.book?.title || it?.name || "Document").trim().slice(0, 120) || "Document";
    meta.push(`<div><strong>Readable:</strong> ${esc(title)}</div>`);
  }
  $("#uie-item-modal-meta").html(meta.join(""));
  syncItemPersistModalButtons(it);

  const modalImg = String(it.img || it.image || "").trim();
  if (modalImg) {
    $("#uie-item-modal-icon").html(`<img src="${esc(modalImg)}" style="width:100%;height:100%;object-fit:cover;border-radius:16px;">`);
  } else {
    $("#uie-item-modal-icon").html(`<i class="fa-solid fa-box" style="font-size:22px; color: rgba(203, 163, 92,0.95);"></i>`);
  }

  const equippable = isEquippable(it);
  $("#uie-item-equip").toggle(!!equippable);
  $("#uie-item-custom-equip").toggle(!!equippable);
  const openable = isOpenableItem(it);
  const readableBook = isBookItem(it);
  $("#uie-item-open")
    .text(readableBook ? "Read" : isContainerItem(it) ? "Manage" : "Open")
    .toggle(openable || readableBook);
  const isCurrencyType =
    String(it.type || "").toLowerCase() === "currency" ||
    it.currencyToken === true ||
    it.altCurrency === true;
  $("#uie-item-currency-actions").css("display", isCurrencyType ? "flex" : "none");
  const $modal = $("#uie-item-modal");
  const $card = $("#uie-item-modal > div").first();
  $modal.css("display", "flex");
  $modal.css({ alignItems: "stretch", justifyContent: "flex-start", padding: "0" });
  $card.css({
    position: "fixed",
    inset: "auto",
    width: "min(360px, 92vw)",
    maxHeight: "66vh",
    borderRadius: "8px",
  });

  try {
    const a = anchorEl && anchorEl.getBoundingClientRect ? anchorEl.getBoundingClientRect() : null;
    if (!a) return;

    $card.css({ visibility: "hidden", top: "0px", left: "0px" });
    const rect = $card.get(0)?.getBoundingClientRect?.();
    const w = rect?.width || 340;
    const h = rect?.height || 420;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const pad = 10;

    const preferRight = (vw - a.right) >= w + pad;
    let left = preferRight ? Math.round(a.right + 10) : Math.round(a.left - w - 10);
    left = Math.max(pad, Math.min(left, vw - w - pad));

    let top = Math.round(a.top + (a.height / 2) - (h / 2));
    top = Math.max(pad, Math.min(top, vh - h - pad));

    $card.css({ left: `${left}px`, top: `${top}px`, visibility: "" });
  } catch (_) {}
}

function openItemContextMenu(idx, x, y) {
  const s = getSettings();
  ensureModel(s);
  const list = s.inventory.items;
  const it = list[idx];
  if (!it) return;

  // Remove existing
  $(".uie-ctx-menu-overlay").remove();

  const overlay = $(`<div class="uie-ctx-menu-overlay" style="position:fixed; inset:0; z-index:2147483660; cursor:default;"></div>`);
  const menu = $(`<div class="uie-ctx-menu" style="position:absolute; background:rgba(15,10,8,0.98); border:1px solid rgba(255,255,255,0.15); border-radius:8px; padding:6px; min-width:140px; box-shadow:0 4px 12px rgba(0,0,0,0.5); display:flex; flex-direction:column; gap:2px;"></div>`);

  const mkBtn = (lbl, act, icon, color="#fff") => {
      return $(`<div class="uie-ctx-item" data-action="${act}" data-idx="${idx}" style="padding:8px 12px; border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:8px; color:${color}; font-weight:600; font-size:13px;">
        <i class="fa-solid ${icon}" style="width:20px; text-align:center; opacity:0.8;"></i> ${lbl}
      </div>`).hover(
          function(){ $(this).css("background", "rgba(255,255,255,0.1)"); },
          function(){ $(this).css("background", "transparent"); }
      );
  };

  menu.append(mkBtn("Inspect", "inspect", "fa-circle-info"));
  if (isBookItem(it)) {
    menu.append(mkBtn("Read", "open", "fa-book-open"));
  } else if (isOpenableItem(it)) {
    menu.append(mkBtn("Manage", "open", "fa-box-open"));
  }
  menu.append(mkBtn("Use", "use", "fa-hand-sparkles"));
  menu.append(mkBtn("Use (Chat)", "use_chat", "fa-comment-dots"));
  menu.append(mkBtn("Send to Quick Bag", "quickbag", "fa-bag-shopping", "#cba35c"));

  if (isEquippable(it)) {
      menu.append(mkBtn("Equip", "equip", "fa-shield-halved"));
      menu.append(mkBtn("Custom Equip", "custom_equip", "fa-pen-ruler"));
  }

  menu.append(mkBtn("Send to Party", "send_party", "fa-users"));
  menu.append(mkBtn("Gift to Contact", "gift", "fa-gift"));

  // Separator
  menu.append($(`<div style="height:1px; background:rgba(255,255,255,0.1); margin:4px 0;"></div>`));

  menu.append(mkBtn("Discard", "discard", "fa-trash", "#e74c3c"));

  // Positioning
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Temporary append to measure
  menu.css({ visibility: "hidden" }).appendTo(document.body);
  const mw = 160; // Approx
  const mh = 240; // Approx
  menu.detach();
  menu.css({ visibility: "" });

  let left = x;
  let top = y;

  if (left + mw > vw) left = vw - mw;
  if (top + mh > vh) top = y - mh;

  const pad = 10;
  left = Math.max(pad, Math.min(left, vw - mw - pad));
  top = Math.max(pad, Math.min(top, vh - mh - pad));

  menu.css({ left: left + "px", top: top + "px" });

  overlay.append(menu);
  $("body").append(overlay);
}

function logAction(s, entry) {
  if (!s.logs) s.logs = {};
  if (!Array.isArray(s.logs.inventory)) s.logs.inventory = [];
  s.logs.inventory.push({ ts: Date.now(), ...entry });
}

function isEquippable(it) {
  return !!it;
}

function inferEquipSlotId(it) {
  const t = `${String(it?.type || "")} ${String(it?.name || "")} ${String(it?.description || it?.desc || "")}`.toLowerCase();
  if (/(shield|buckler)/.test(t)) return "off";
  if (/(ring)/.test(t)) return "r1";
  if (/(amulet|necklace|torc)/.test(t)) return "neck";
  if (/(helmet|helm|hood|crown|hat)/.test(t)) return "head";
  if (/(boots|shoe|greaves)/.test(t)) return "feet";
  if (/(glove|gauntlet)/.test(t)) return "hands";
  if (/(pants|trouser|leggings)/.test(t)) return "legs";
  if (/(chest|armor|plate|mail|robe|tunic|shirt)/.test(t)) return "chest";
  if (/(cloak|cape)/.test(t)) return "cloak";
  if (/(belt|strap)/.test(t)) return "belt";
  if (/(socks)/.test(t)) return "socks";
  if (/(undies|underwear)/.test(t)) return "undies";
  if (/(wand|staff|orb|focus|talisman)/.test(t)) return "focus";
  if (/(weapon|sword|dagger|bow|crossbow|mace|hammer|spear|axe|blade)/.test(t)) return "main";
  return "";
}

function equipItemToSlot(s, item, slotId) {
  if (!s.inventory) s.inventory = {};
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
  if (!Array.isArray(s.inventory.equipped)) s.inventory.equipped = [];
  const sid = String(slotId || "").trim();
  if (!sid) return { ok: false, reason: "No slot selected." };

  const idxExisting = s.inventory.equipped.findIndex(e => String(e?.slotId || "") === sid);
  if (idxExisting >= 0) {
    const prev = { ...s.inventory.equipped[idxExisting] };
    delete prev.slotId;
    addInventoryItemWithStack(s.inventory.items, prev, { source: "unequip_swap" });
    s.inventory.equipped.splice(idxExisting, 1);
  }

  const put = { ...item, slotId: sid };
  s.inventory.equipped.push(put);
  return { ok: true };
}

function takeOneFromStack(list, idx) {
  const it = list[idx];
  if (!it || typeof it !== "object") return null;
  const q = Number(it.qty || 1);
  if (Number.isFinite(q) && q > 1) {
    it.qty = q - 1;
    return { ...it, qty: 1 };
  }
  list.splice(idx, 1);
  return { ...it, qty: 1 };
}

function collectGiftContacts(s) {
  const social = s?.social && typeof s.social === "object" ? s.social : {};
  const tabs = ["friends", "associates", "romance", "family", "rivals", "npc"];
  const seen = new Set();
  const out = [];
  for (const tab of tabs) {
    const list = Array.isArray(social[tab]) ? social[tab] : [];
    for (const p of list) {
      const name = String(p?.name || "").trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push({ name, tab });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function pickGiftContact(itemName) {
  const s = getSettings();
  const contacts = collectGiftContacts(s);
  $(".uie-item-gift-picker").remove();

  return new Promise((resolve) => {
    const options = contacts.length
      ? contacts.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}${c.tab ? ` / ${esc(c.tab)}` : ""}</option>`).join("")
      : `<option value="">No contacts available</option>`;
    const modal = $(`
      <div class="uie-item-gift-picker" style="position:fixed; inset:0; z-index:2147483665; background:rgba(0,0,0,0.72); display:flex; align-items:center; justify-content:center; padding:16px;">
        <div style="width:min(420px, 94vw); border:1px solid rgba(233,150,122,0.45); border-radius:8px; background:rgba(14,10,8,0.98); color:#fff; box-shadow:0 24px 80px rgba(0,0,0,0.6); padding:14px; display:grid; gap:12px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="font-weight:900; color:#e9a07a; letter-spacing:0.5px;">Gift to Contact</div>
            <button type="button" class="uie-item-gift-close" style="margin-left:auto; width:34px; height:34px; border-radius:6px; border:1px solid rgba(255,255,255,0.16); background:rgba(0,0,0,0.32); color:#fff; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div style="font-size:12px; color:rgba(255,255,255,0.72); line-height:1.45;">${esc(itemName)} will be offered to the selected contact.</div>
          <select class="uie-item-gift-select" ${contacts.length ? "" : "disabled"} style="width:100%; min-height:40px; border-radius:6px; border:1px solid rgba(233,150,122,0.35); background:rgba(0,0,0,0.35); color:#fff; padding:8px 10px; font-weight:800;">
            ${options}
          </select>
          <div style="display:flex; gap:8px; justify-content:flex-end;">
            <button type="button" class="uie-item-gift-close" style="height:38px; padding:0 12px; border-radius:6px; border:1px solid rgba(255,255,255,0.16); background:rgba(0,0,0,0.26); color:#fff; cursor:pointer; font-weight:800;">Cancel</button>
            <button type="button" class="uie-item-gift-confirm" ${contacts.length ? "" : "disabled"} style="height:38px; padding:0 14px; border-radius:6px; border:1px solid rgba(233,150,122,0.55); background:rgba(233,150,122,0.16); color:#e9a07a; cursor:pointer; font-weight:900;">Gift</button>
          </div>
        </div>
      </div>
    `);
    const finish = (value = "") => {
      modal.remove();
      resolve(String(value || "").trim());
    };
    modal.on("click", ".uie-item-gift-close", (e) => {
      e.preventDefault();
      e.stopPropagation();
      finish("");
    });
    modal.on("click", ".uie-item-gift-confirm", (e) => {
      e.preventDefault();
      e.stopPropagation();
      finish(modal.find(".uie-item-gift-select").val());
    });
    modal.on("click", function (e) {
      if (e.target === this) finish("");
    });
    $("body").append(modal);
    setTimeout(() => modal.find(".uie-item-gift-select").trigger("focus"), 0);
  });
}

async function actOnItem(kind) {
  const s = getSettings();
  ensureModel(s);
  const idx = Number(activeIdx);
  const list = s.inventory.items;
  const it = list[idx];
  if (!it) return;

  const name = String(it.name || "Item");

  try {
    const confirmKinds = new Set(["use", "use_chat", "custom_use", "equip", "custom_equip", "send_party", "gift", "open", "quickbag"]);
    if (it.needsUserConfirm && confirmKinds.has(String(kind || ""))) {
      const ok = confirm(`${name} is marked as UNVERIFIED. Continue?`);
      if (!ok) return;
      it.needsUserConfirm = false;
      saveSettings();
    }
  } catch (_) {}

  if (kind === "inspect") {
    openItemModal(idx);
    return;
  }

  if (kind === "quickbag") {
    try {
      const mod = await import("./quickBag.js");
      mod.addQuickBagEntry?.("item", idx);
    } catch (err) {
      console.error("[Items] Failed to add item to Quick Bag:", err);
      notify("error", "Could not add item to Quick Bag.", "Inventory");
    }
    closeItemModal();
    render();
    return;
  }

  if (kind === "open") {
    if (isBookItem(it)) {
      const book = await ensureBookText(it);
      logAction(s, { action: "read", item: name });
      saveSettings();
      openBookReader(book?.title || name, book?.text || it.description || "(No readable text)", it);
      try {
        const readable = await import("../readableHtml.js");
        void readable.maybeBuildReadableHtmlForBook?.(book?.title || name, book?.text || it.description || "(No readable text)", it);
      } catch (_) {}
      return;
    }

    if (isContainerItem(it)) {
      openContainerManager(list, idx, it);
      logAction(s, { action: "open", item: name, note: "container_ui" });
      saveSettings();
      try { await injectRpEvent(`[System: Opened ${name} (container).]`); } catch (_) {}
      return;
    }
  }

  if (kind === "use_chat") {
    const consumes = shouldConsumeOnUse(it);
    const eff = String(it?.use?.desc || it?.desc || it?.effect || it?.description || "").trim().slice(0, 220) || "";
    let msg = `*uses ${name}*`;
    if (eff) msg += `\n(Effect: ${eff})`;

    // Log internally
    logAction(s, { action: "use_chat", item: name, note: consumes ? "consumed" : "retained" });

    applyItemFunctionalEffects(it);

    // Consume
    if (consumes) {
        const q = Number(it.qty || 1);
        it.qty = Math.max(0, q - 1);
        if (it.qty <= 0) list.splice(idx, 1);
    }

    saveSettings();
    closeItemModal();
    render();

    // Send to Chat
    const textarea = document.getElementById("send_textarea");
    if (textarea) {
        textarea.value = msg;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        const sendBtn = document.getElementById("send_but");
        if (sendBtn) sendBtn.click();
    }
    return;
  }

  if (kind === "custom_use") {
    const note = window.prompt("Custom Use (what happened?)") || "";
    const msg = String(note || "").trim() ? `Custom use: ${name} â€” ${String(note).trim()}` : `Custom use: ${name}`;
    logAction(s, { action: "custom_use", item: name, note: String(note).slice(0, 500) });
    saveSettings();
    closeItemModal();
    await injectRpEvent(msg, { uie: { type: "custom_use", item: name } });
    return;
  }

  if (kind === "custom_equip") {
    const slotGuess = inferEquipSlotId(it) || "main";
    const slotId = (window.prompt("Equip slot (examples: head, chest, legs, feet, hands, neck, main, off, cloak, belt, r1, r2, focus)", slotGuess) || "").trim();
    if (!slotId) return;
    const note = window.prompt("Custom Equip (what happened?)") || "";
    const one = takeOneFromStack(list, idx);
    if (!one) return;
    const out = equipItemToSlot(s, one, slotId);
    if (!out.ok) return;
    logAction(s, { action: "custom_equip", item: name, slotId, note: String(note).slice(0, 500) });
    saveSettings();
    closeItemModal();
    render();
    try { const mod = await import("./equipment.js"); if (mod?.render) mod.render(); } catch (_) {}
    const msg = String(note || "").trim() ?
       `[System: User equipped ${name}. Stats updated.] (${String(note).trim()})`
      : `[System: User equipped ${name}. Stats updated.]`;
    await injectRpEvent(msg);
    return;
  }

  if (kind === "equip") {
    let slotId = inferEquipSlotId(it);
    if (!slotId) slotId = (window.prompt("Equip slot (examples: head, chest, legs, feet, hands, neck, main, off, cloak, belt, r1, r2, focus)", "main") || "").trim();
    if (!slotId) return;
    const one = takeOneFromStack(list, idx);
    if (!one) return;
    const out = equipItemToSlot(s, one, slotId);
    if (!out.ok) return;
    logAction(s, { action: "equip", item: name, slotId });
    saveSettings();
    closeItemModal();
    render();
    try { const mod = await import("./equipment.js"); if (mod?.render) mod.render(); } catch (_) {}
    await injectRpEvent(`[System: User equipped ${name}. Stats updated.]`);
    return;
  }

  if (kind === "discard") {
    if (!confirm(`Discard ${name}?`)) return;
    logAction(s, { action: "discard", item: name });
    list.splice(idx, 1);
    saveSettings();
    closeItemModal();
    render();
    await injectRpEvent(`Discarded ${name}.`, { uie: { type: "discard", item: name } });
    return;
  }

  if (kind === "send_party") {
    if (!s.party) s.party = { members: [], sharedItems: [] };
    if (!Array.isArray(s.party.members)) s.party.members = [];
    if (!Array.isArray(s.party.sharedItems)) s.party.sharedItems = [];
    for (const pm of s.party.members) {
      if (pm && typeof pm === "object" && !Array.isArray(pm.personalItems)) pm.personalItems = [];
    }
    const activeMembers = (s.party.members || []).filter((m) => m && m.active !== false);
    const destLines = ["0 â€” Party shared stash"];
    activeMembers.forEach((m, i) => {
      const nm = String(m?.identity?.name || "Member").trim() || "Member";
      destLines.push(`${i + 1} â€” Personal: ${nm}`);
    });
    const rawDest = window.prompt(`Send to which stash?\n${destLines.join("\n")}`, "0");
    if (rawDest == null) return;
    const destPick = Number(String(rawDest).trim());
    if (!Number.isFinite(destPick) || destPick < 0) return;
    let targetList = null;
    let destLabel = "";
    if (destPick === 0) {
      targetList = s.party.sharedItems;
      destLabel = "party shared stash";
    } else {
      const m = activeMembers[destPick - 1];
      if (!m) return;
      if (!Array.isArray(m.personalItems)) m.personalItems = [];
      targetList = m.personalItems;
      destLabel = `personal (${String(m?.identity?.name || "Member").trim() || "member"})`;
    }
    let qty = 1;
    const cur = Number(it.qty || 1);
    if (Number.isFinite(cur) && cur > 1) {
      const raw = String(window.prompt("Send how many to party (number or 'all')", "1") || "").trim().toLowerCase();
      if (!raw) return;
      if (raw === "all") qty = cur;
      else {
        const qn = Number(raw);
        if (!Number.isFinite(qn) || qn <= 0) return;
        qty = Math.min(cur, Math.floor(qn));
      }
    }

    const moved = [];
    for (let i = 0; i < qty; i++) {
      const one = takeOneFromStack(list, idx);
      if (!one) break;
      moved.push(one);
    }
    if (!moved.length) return;

    mergeStacksIntoPartyItemList(targetList, moved);

    logAction(s, { action: "send_party", item: name, qty: moved.length, dest: destLabel });
    saveSettings();
    closeItemModal();
    render();
    await injectRpEvent(`Sent ${moved.length}x ${name} to ${destLabel}.`, {
      uie: { type: "send_party", item: name, qty: moved.length, dest: destLabel },
    });
    return;
  }

  if (kind === "gift") {
    const who = await pickGiftContact(name);
    if (!who) return;
    const itemLabel = `${name}${Number(it.qty || 1) > 1 ? ` x${it.qty}` : ""} (${String(it.type || "misc")})`;
    const stableName = String(it.name || name);
    const stableIdx = idx;
    try {
      notify("info", "Deciding reactionâ€¦", "Inventory");
    } catch (_) {}
    const r = await applyItemGiftToContact(who, itemLabel, { fromPartyStash: false });
    const s2 = getSettings();
    ensureModel(s2);
    const list2 = s2.inventory.items;
    const it2 = list2[stableIdx];
    if (r?.ok && r.accepted && it2 && String(it2.name || "") === stableName) {
      takeOneFromStack(list2, stableIdx);
    }
    logAction(s2, { action: "gift", item: name, contact: who, accepted: !!r?.accepted, affinityDelta: r?.affinityDelta });
    saveSettings();
    closeItemModal();
    render();
    const d = r?.affinityDelta ?? 0;
    const dTxt = `${d >= 0 ? "+" : ""}${d}`;
    if (r?.ok) {
      if (r.accepted) {
        try {
          notify("success", `${who} accepted the gift. Affinity ~${r.affinity} (${dTxt}).`, "Inventory");
        } catch (_) {}
      } else {
        try {
          notify("warning", `${who} refused the gift. Affinity ~${r.affinity} (${dTxt}). ${r.reason || ""}`, "Inventory");
        } catch (_) {}
      }
    } else {
      try {
        notify("warning", String(r?.error || "Gift failed."), "Inventory");
      } catch (_) {}
    }
    return;
  }

  const consumes = shouldConsumeOnUse(it);
  applyItemFunctionalEffects(it);
  const note = consumes ? "consumed" : "retained";
  logAction(s, { action: "use", item: name, note });
  if (consumes) {
    const q = Number(it.qty || 1);
    it.qty = Math.max(0, q - 1);
    if (it.qty <= 0) list.splice(idx, 1);
  }
  saveSettings();
  closeItemModal();
  render();
  const eff = String(it?.use?.desc || it?.desc || it?.effect || it?.description || "").trim().slice(0, 220) || "";
  if (consumes) {
    await injectRpEvent(
      `[System: User used ${name} (consumed).${eff ? ` Effect: ${eff}.` : ""}]`,
    );
  } else {
    await injectRpEvent(
      `[System: User used ${name} (kept in inventory).${eff ? ` Effect: ${eff}.` : ""}]`,
    );
  }
}
