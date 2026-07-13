import { getSettings, saveSettings } from "../core.js";
import { inferItemType } from "../slot_types_infer.js";
import { injectRpEvent } from "./rp_log.js";
import { addInventoryItemWithStack } from "../inventoryItems.js";
import { advanceWorldTimeMinutes } from "../timeProgress.js";
import { createKitchenEngine } from "../kitchenEngine.js";

let mounted = false;
let openCtx = { onExit: null };
let tickInterval = null;
let pickCtx = null;
let saveTimer = null;
let kitchenEngine = null;

const STATES = ["idle", "prepping", "cooking", "paused", "done", "burned", "canceled"];

const RECIPES = [
  { id: "stew", name: "Hearty Stew", required_capabilities: ["thermal_heating"], minimum_efficiency: 0.5, minutes: 15, burn_buffer: 5, requires: [{ tag: "meat" }, { tag: "vegetable" }, { tag: "herb" }] },
  { id: "flatbread", name: "Flatbread", required_capabilities: ["thermal_heating"], minimum_efficiency: 0.8, minutes: 10, burn_buffer: 3, requires: [{ tag: "grain" }, { tag: "dairy" }] },
  { id: "fried_fish", name: "Fried Fish", required_capabilities: ["thermal_heating"], minimum_efficiency: 0.5, minutes: 8, burn_buffer: 2, requires: [{ tag: "fish" }, { tag: "oil" }] },
  { id: "tea", name: "Herbal Tea", required_capabilities: ["thermal_heating"], minimum_efficiency: 0.5, minutes: 5, burn_buffer: 4, requires: [{ tag: "herb" }, { tag: "water" }] },
  { id: "blended_smoothie", name: "Fruit Smoothie", required_capabilities: ["kinetic_crushing"], minimum_efficiency: 1.0, minutes: 3, burn_buffer: 10, requires: [{ tag: "fruit" }, { tag: "dairy" }] },
  { id: "infused_potion", name: "Infused Potion", required_capabilities: ["arcane_infusion"], minimum_efficiency: 1.0, minutes: 20, burn_buffer: 5, requires: [{ tag: "herb" }, { tag: "magic" }] }
];

const DEFAULT_WORKSTATION = {
  name: "Standard Stove",
  capabilities: ["thermal_heating"],
  efficiency_multiplier: 1.0,
  capacity: 3,
  state_toggles: ["powered", "clean"]
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function timeToClock(m) {
  m = Math.max(0, Number(m || 0));
  const hrs = Math.floor(m / 60);
  const mins = m % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function clamp01(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function ensureIds(s) {
  if (!s.inventory) s.inventory = { items: [] };
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
  for (const it of s.inventory.items) {
    if (!it || typeof it !== "object") continue;
    if (!it.id) it.id = `uie_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    if (!it.slotCategory) {
      const inf = inferItemType(it);
      it.slotCategory = String(inf?.category || "UNCATEGORIZED");
    }
  }
}

function ensureKitchen(s) {
  if (!s.kitchen || typeof s.kitchen !== "object") s.kitchen = {};
  if (!Array.isArray(s.kitchen.log)) s.kitchen.log = [];
  if (!s.kitchenStyle) s.kitchenStyle = "modern";
  if (!s.kitchen.session || typeof s.kitchen.session !== "object") s.kitchen.session = {};
  
  const ses = s.kitchen.session;
  if (!STATES.includes(String(ses.state || ""))) ses.state = "idle";
  if (!ses.workstation || typeof ses.workstation !== "object") {
    ses.workstation = { ...DEFAULT_WORKSTATION };
  }
  if (!ses.heatLevel) ses.heatLevel = "med";
  if (!Array.isArray(ses.requires)) ses.requires = [];
  if (!Array.isArray(ses.slots)) ses.slots = [];
  if (!Array.isArray(ses.reserved)) ses.reserved = [];
  if (!Array.isArray(ses.events)) ses.events = [];
  if (typeof ses.pausedTotalMinutes !== "number") ses.pausedTotalMinutes = 0;
  if (typeof ses.mistakes !== "number") ses.mistakes = 0;
  if (typeof ses.prepScore !== "number") ses.prepScore = 0;
  
  if (!ses.prepDone || typeof ses.prepDone !== "object") ses.prepDone = {};
  if (typeof ses.prepDone.chop !== "boolean") ses.prepDone.chop = false;
  if (typeof ses.prepDone.season !== "boolean") ses.prepDone.season = false;
  if (typeof ses.prepDone.taste !== "boolean") ses.prepDone.taste = false;
  if (typeof ses.prepDone.plate !== "boolean") ses.prepDone.plate = false;
  
  if (!ses.flavorProfile) ses.flavorProfile = "balanced";
  if (!ses.serviceStyle) ses.serviceStyle = "homey";
  
  if (!ses.activeToggles || typeof ses.activeToggles !== "object") {
    ses.activeToggles = {};
    if (Array.isArray(ses.workstation.state_toggles)) {
      ses.workstation.state_toggles.forEach(t => {
        ses.activeToggles[t] = true;
      });
    }
  }
  return ses;
}

function resetPrep(ses) {
  ses.prepScore = 0;
  ses.prepDone = { chop: false, season: false, taste: false, plate: false };
  ses.flavorProfile = "balanced";
  ses.serviceStyle = "homey";
}

function getGameMinutes(s) {
  if (!s.playerRoom) s.playerRoom = {};
  const d = Math.max(1, Number(s.playerRoom.day || 1));
  const h = Math.max(0, Number(s.playerRoom.hour || 8));
  const m = Math.max(0, Number(s.playerRoom.minute || 0));
  return (d - 1) * 1440 + h * 60 + m;
}

function qualityFromSession(ses) {
  if (String(ses?.state || "") === "burned") return "burned";
  const r = findRecipe(ses?.recipeId);
  if (!r) return "rough";

  // Check state toggles
  const activeToggles = ses.activeToggles || {};
  const togglesOk = Array.isArray(ses.workstation.state_toggles)
    ? ses.workstation.state_toggles.every(t => activeToggles[t] === true)
    : true;
  if (!togglesOk) return "failed/destroyed";

  // Check capability mismatch
  const supported = r.required_capabilities.every(cap => ses.workstation.capabilities.includes(cap));
  if (!supported) return "rough";

  // Check efficiency threshold
  const lowEff = (ses.workstation.efficiency_multiplier || 1.0) < (r.minimum_efficiency || 0.0);
  if (lowEff) return "rough";

  const mistakes = Number(ses?.mistakes || 0);
  const prep = Number(ses?.prepScore || 0);
  const score = 2 - mistakes + prep;
  if (score >= 3) return "perfect";
  if (score >= 1.5) return "ok";
  return "rough";
}

function prepStatusText(ses) {
  const prep = Number(ses?.prepScore || 0);
  if (prep >= 2.5) return "Prep is excellent";
  if (prep >= 1.5) return "Prep is solid";
  if (prep >= 0.6) return "Prep is improving";
  return "Prep is basic";
}

function ambienceText(ses) {
  const st = String(ses?.state || "idle");
  const wsName = String(ses?.workstation?.name || "Stove");
  const flavor = String(ses?.flavorProfile || "balanced");
  const service = String(ses?.serviceStyle || "homey");
  if (st === "cooking") return `Sizzle and aroma fill the ${wsName} station. Flavor tone: ${flavor}. Service target: ${service}.`;
  if (st === "done") return "Dish is ready - plate and serve while it's hot.";
  if (st === "paused") return "Heat is paused; ingredients wait on the line.";
  if (st === "burned") return "Smoke hangs in the kitchen - recover and reset.";
  return "Prep your ingredients to boost dish quality before cooking.";
}

function addKitchenLog(s, line) {
  ensureKitchen(s);
  s.kitchen.log.push(String(line || "").slice(0, 240));
  s.kitchen.log = s.kitchen.log.slice(-120);
  saveKitchenDebounced();
  renderKitchen();
}

function addSessionEvent(s, line) {
  ensureKitchen(s);
  const ses = s.kitchen.session;
  ses.events.push({ ts: Date.now(), text: String(line || "").slice(0, 240) });
  ses.events = ses.events.slice(-80);
  addKitchenLog(s, line);
}

function saveKitchenDebounced() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveSettings();
  }, 350);
}

function setKitchenBackground() {
  const s = getSettings();
  if (!s) return;
  ensureKitchen(s);
  const style = String(s.kitchenStyle || "modern").toLowerCase() === "medieval" ? "medieval" : "modern";
  $("#uie-kitchen-overlay").attr("data-style", style);
}

function transitionAllowed(from, to) {
  const f = String(from);
  const t = String(to);
  if (f === t) return true;
  if (f === "idle" && t === "prepping") return true;
  if (f === "prepping" && t === "cooking") return true;
  if (f === "cooking" && t === "paused") return true;
  if (f === "paused" && t === "cooking") return true;
  if (f === "cooking" && (t === "done" || t === "burned")) return true;
  if (f === "done" && t === "idle") return true;
  if ((f === "cooking" || f === "paused") && t === "canceled") return true;
  return false;
}

async function setState(next, reason) {
  const s = getSettings();
  if (!s) return false;
  ensureIds(s);
  const ses = ensureKitchen(s);
  const from = String(ses.state);
  const to = String(next);
  if (!transitionAllowed(from, to)) return false;
  ses.state = to;
  if (reason) addSessionEvent(s, reason);
  saveKitchenDebounced();
  renderKitchen();
  return true;
}

function findRecipe(id) {
  return RECIPES.find(r => r.id === String(id)) || null;
}

function computeElapsed(ses, s) {
  const startAt = Number(ses.startMinutes || 0);
  if (!startAt) return 0;
  const current = getGameMinutes(s);
  const pausedTotal = Number(ses.pausedTotalMinutes || 0);
  return Math.max(0, current - startAt - pausedTotal);
}

function computeProgress(ses, s) {
  const dur = Number(ses.durationMinutes || 0);
  const elapsed = computeElapsed(ses, s);
  const pct = dur > 0 ? clamp01(elapsed / dur) : 0;
  const rem = dur > 0 ? Math.max(0, dur - elapsed) : 0;
  return { elapsed, pct, rem };
}

function tagForItem(it) {
  const text = `${String(it?.name || "")} ${String(it?.description || it?.desc || "")}`.toLowerCase();
  if (/(fish|salmon|trout)/.test(text)) return "fish";
  if (/(meat|beef|pork|chicken|venison)/.test(text)) return "meat";
  if (/(herb|mint|basil|thyme|sage|leaf)/.test(text)) return "herb";
  if (/(water|spring)/.test(text)) return "water";
  if (/(milk|butter|cheese|egg)/.test(text)) return "dairy";
  if (/(grain|flour|bread|dough|wheat)/.test(text)) return "grain";
  if (/(oil|fat|lard)/.test(text)) return "oil";
  if (/(vegetable|carrot|potato|onion|mushroom)/.test(text)) return "vegetable";
  if (/(fruit|apple|berry|banana)/.test(text)) return "fruit";
  if (/(magic|mana|arcane|potion)/.test(text)) return "magic";
  return "any";
}

function inventoryMatchesTag(it, tag) {
  if (!it) return false;
  const t = String(tag || "any");
  if (t === "any") return true;
  const cat = String(it?.slotCategory || "").toUpperCase();
  if (cat === "COOKING") return tagForItem(it) === t || t === "any";
  return tagForItem(it) === t;
}

function listRecipeRows(query) {
  const q = String(query || "").toLowerCase().trim();
  return RECIPES.filter(r => !q || r.name.toLowerCase().includes(q) || r.id.includes(q));
}

function renderRecipes() {
  const s = getSettings();
  if (!s) return;
  const ses = ensureKitchen(s);
  const ws = ses.workstation || DEFAULT_WORKSTATION;
  const q = String($("#uie-k-recipe-search").val() || "");
  const list = listRecipeRows(q);
  const $wrap = $("#uie-k-recipes");
  if (!$wrap.length) return;
  $wrap.empty();
  
  const template = document.getElementById("uie-k-recipe-template");
  
  list.forEach(r => {
    const active = String(ses.recipeId || "") === r.id;
    const okStation = r.required_capabilities.every(cap => ws.capabilities.includes(cap));
    
    const clone = template.content.cloneNode(true);
    const $row = $(clone).find(".uie-krow");
    
    $row.attr("data-recipe", r.id);
    if (active) $row.addClass("active");
    
    $row.find(".name").text(r.name);
    
    const $status = $row.find(".status");
    $status.css("opacity", okStation ? "0.9" : "0.5").text(okStation ? "OK" : "Mismatched");
    if (!okStation) {
      $status.css("background", "rgba(239, 68, 68, 0.15)").css("color", "#f87171");
    } else {
      $status.css("background", "").css("color", "");
    }
    
    $row.find(".meta").text(`Requires: ${r.required_capabilities.join(", ")} • ${r.minutes} min`);
    
    $wrap.append($row);
  });
}

function renderSlots() {
  const s = getSettings();
  if (!s) return;
  ensureIds(s);
  const ses = ensureKitchen(s);
  const r = findRecipe(ses.recipeId);
  const reqs = r ? r.requires : [];
  if (!Array.isArray(ses.slots) || ses.slots.length !== reqs.length) {
    ses.slots = reqs.map((x, i) => ({ slot: i, tag: x.tag, itemId: "", name: "", img: "" }));
  }
  const $wrap = $("#uie-k-slots");
  if (!$wrap.length) return;
  $wrap.empty();
  
  const template = document.getElementById("uie-k-slot-template");
  
  ses.slots.forEach(sl => {
    const filled = !!sl.itemId;
    const clone = template.content.cloneNode(true);
    const $row = $(clone).find(".uie-krow");
    
    $row.attr("data-slot", sl.slot);
    if (filled) $row.addClass("active");
    
    $row.find(".name").text(filled ? sl.name : `Slot ${sl.slot + 1}`);
    $row.find(".tag").text(sl.tag);
    $row.find(".meta").text(filled ? "Click to change" : "Click to choose from inventory");
    
    $wrap.append($row);
  });
  saveKitchenDebounced();
}

function renderSession() {
  const s = getSettings();
  if (!s) return;
  const ses = ensureKitchen(s);
  const ws = ses.workstation || DEFAULT_WORKSTATION;
  
  $("#uie-k-state").text(String(ses.state || "idle").toUpperCase());
  $("#uie-k-heat").val(String(ses.heatLevel || "med"));
  $("#uie-k-flavor-profile").val(String(ses.flavorProfile || "balanced"));
  $("#uie-k-service-style").val(String(ses.serviceStyle || "homey"));

  // Workstation dynamic details
  let togglesHtml = "";
  if (Array.isArray(ws.state_toggles)) {
    togglesHtml = ws.state_toggles.map(t => {
      const active = ses.activeToggles?.[t] === true;
      return `
        <label class="uie-kpill" style="cursor:pointer; margin-right: 6px; user-select:none;">
          <input type="checkbox" class="uie-k-toggle-state" data-toggle="${t}" ${active ? "checked" : ""} style="margin-right:4px;">
          ${t}
        </label>
      `;
    }).join("");
  }
  
  $("#uie-k-station-details").html(`
    <div style="font-weight:900; font-size:14px; color:#ffd166;">${esc(ws.name)}</div>
    <div style="font-size:11px; opacity:0.8; margin-top:2px;">
      Capabilities: ${esc(ws.capabilities.join(", "))} <br>
      Efficiency: ${ws.efficiency_multiplier}x
    </div>
    <div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:4px;">
      ${togglesHtml}
    </div>
  `);

  const r = findRecipe(ses.recipeId);
  $("#uie-k-active-recipe").text(r ? r.name : "No recipe selected");

  const prog = computeProgress(ses, s);
  $("#uie-kprogress > div").css("width", `${Math.round(prog.pct * 100)}%`);
  $("#uie-k-percent").text(`${Math.round(prog.pct * 100)}%`);

  const burnGrace = Number(ses.burnGraceMinutes || 0);
  const dur = Number(ses.durationMinutes || 0);
  const elapsed = computeElapsed(ses, s);
  const burnIn = Math.max(0, dur + burnGrace - elapsed);
  $("#uie-k-burn").text(dur ? `${timeToClock(burnIn)}` : "—");

  $("#uie-k-remaining").text(dur ? timeToClock(prog.rem) : "—");
  $("#uie-k-mistakes").text(`mistakes: ${Number(ses.mistakes || 0)}`);

  const quality = qualityFromSession(ses);
  $("#uie-k-quality").text(`quality: ${quality}`);
  $("#uie-k-prep-score").text(`prep: ${Number(ses.prepScore || 0).toFixed(1)}`);
  $("#uie-k-prep-status").text(prepStatusText(ses));
  $("#uie-k-ambience").text(ambienceText(ses));

  const warn = [];
  if (ses.state === "cooking" || ses.state === "done") {
    if (dur && burnGrace && elapsed >= dur && elapsed < dur + burnGrace) warn.push("BURN WARNING: serve soon.");
    if (dur && burnGrace && elapsed >= dur + burnGrace) warn.push("BURNED.");
  }
  $("#uie-k-warning").text(warn.join(" "));
  $("#uie-k-outcome").text(outcomeText(s, quality));

  const log = Array.isArray(s.kitchen?.log) ? s.kitchen.log.slice(-18) : [];
  $("#uie-klog").text(log.join("\n"));

  const st = String(ses.state);
  $("#uie-k-start").prop("disabled", !(st === "prepping"));
  $("#uie-k-pause").prop("disabled", !(st === "cooking"));
  $("#uie-k-resume").prop("disabled", !(st === "paused"));
  $("#uie-k-stir").prop("disabled", true);
  $("#uie-k-cancel").prop("disabled", !((st === "cooking") || (st === "paused")));
  $("#uie-k-serve").prop("disabled", !(st === "done"));
  
  const prepLocked = !(st === "idle" || st === "prepping" || st === "cooking" || st === "done");
  $("#uie-k-prep-chop").prop("disabled", prepLocked || ses.prepDone?.chop === true);
  $("#uie-k-prep-season").prop("disabled", prepLocked || ses.prepDone?.season === true);
  $("#uie-k-prep-taste").prop("disabled", prepLocked || ses.prepDone?.taste === true);
  $("#uie-k-prep-plate").prop("disabled", prepLocked || ses.prepDone?.plate === true);
}

function outcomeText(s, quality) {
  const ses = ensureKitchen(s);
  const r = findRecipe(ses.recipeId);
  if (!r) return "Pick a recipe, select ingredients, then Start.";
  if (ses.state === "idle") return "Select a recipe to begin.";
  if (ses.state === "prepping") return "Fill ingredient slots, toggle workstation, then Start.";
  if (ses.state === "cooking") return "Cooking in progress.";
  if (ses.state === "paused") return "Paused.";
  if (ses.state === "burned") return "Burned. Cancel/Dump to clear.";
  if (ses.state === "done") return `Ready to serve (${quality}).`;
  if (ses.state === "canceled") return "Canceled.";
  return "—";
}

function renderKitchen() {
  setKitchenBackground();
  renderRecipes();
  renderSlots();
  renderSession();
}

function startTick() {
  if (tickInterval) return;
  tickInterval = setInterval(() => tick(), 1000);
}

function stopTick() {
  if (!tickInterval) return;
  clearInterval(tickInterval);
  tickInterval = null;
}

async function tick() {
  const s = getSettings();
  if (!s) return;
  const ses = ensureKitchen(s);
  const st = String(ses.state);
  if (!(st === "cooking" || st === "done")) { renderSession(); return; }
  
  advanceWorldTimeMinutes(s, 1);

  const currentMinutes = getGameMinutes(s);
  const elapsed = currentMinutes - ses.startMinutes - (ses.pausedTotalMinutes || 0);
  const dur = Number(ses.durationMinutes || 0);
  const burnGrace = Number(ses.burnGraceMinutes || 0);

  if (st === "cooking" && dur && elapsed >= dur) {
    await setState("done", `Finished cooking ${findRecipe(ses.recipeId)?.name || "recipe"}.`);
    await injectRpEvent(`Finished cooking ${findRecipe(ses.recipeId)?.name || "a recipe"}.`, { uie: { type: "kitchen_done" } });
  }

  const tooLate = dur && burnGrace && elapsed >= dur + burnGrace;
  if ((st === "cooking" || st === "done") && tooLate) {
    await setState("burned", "Burned: left past burn window.");
    await injectRpEvent("Burned the dish (overtime).", { uie: { type: "kitchen_burned" } });
  }

  renderSession();
}

function openPicker(slotIdx) {
  const s = getSettings();
  if (!s) return;
  ensureIds(s);
  const ses = ensureKitchen(s);
  const slot = ses.slots.find(x => Number(x.slot) === Number(slotIdx));
  if (!slot) return;
  pickCtx = { slot: Number(slotIdx), tag: String(slot.tag || "any"), query: "" };
  $("#uie-k-pick-search").val("");
  $("#uie-kitchen-picker").css("display", "flex");
  $("#uie-k-pick-title").text(`Pick Ingredient (${slot.tag})`);
  renderPicker();
}

function closePicker() {
  pickCtx = null;
  $("#uie-kitchen-picker").hide();
}

function renderPicker() {
  const s = getSettings();
  if (!s || !pickCtx) return;
  ensureIds(s);
  const tag = String(pickCtx.tag || "any");
  const q = String($("#uie-k-pick-search").val() || "").toLowerCase().trim();
  const list = (s.inventory.items || []).filter(it => {
    const okTag = inventoryMatchesTag(it, tag);
    if (!okTag) return false;
    if (!q) return true;
    return `${String(it?.name || "")} ${String(it?.description || it?.desc || "")}`.toLowerCase().includes(q);
  }).slice(0, 120);

  const grouped = {};
  list.forEach(it => {
    const inf = inferItemType(it);
    const cat = String(inf?.category || "UNCATEGORIZED").toUpperCase();
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(it);
  });

  const $wrap = $("#uie-k-pick-list");
  if (!$wrap.length) return;
  $wrap.empty();
  if (!list.length) {
    $wrap.append($("<div>").css({opacity:0.7, fontWeight:900, padding:"10px"}).text("No matches."));
    return;
  }
  
  const template = document.getElementById("uie-k-pick-template");
  
  Object.keys(grouped).sort().forEach(cat => {
    $wrap.append(`
      <div style="font-weight:900; color:#ffd166; font-size:12px; margin-top:8px; margin-bottom:4px; padding-left:4px; border-left:3px solid #cba35c; text-transform:uppercase;">
        ${esc(cat)}
      </div>
    `);
    
    grouped[cat].forEach(it => {
      const clone = template.content.cloneNode(true);
      const $row = $(clone).find(".pick-row");
      
      $row.attr("data-id", it.id);
      
      const $icon = $row.find(".icon");
      if (it.img) {
        $("<img>").attr("src", it.img).appendTo($icon);
      } else {
        $("<i>").addClass("fa-solid fa-utensils").css("opacity", "0.85").appendTo($icon);
      }
      
      $row.find(".name").text(it.name || "Item");
      $row.find(".sub").text(`x${it.qty || 1} • ${it.description || it.desc || ""}`);
      
      $wrap.append($row);
    });
  });
}

function applyHeatModifiers(ses) {
  const heat = String(ses.heatLevel || "med");
  let dur = Number(ses.durationMinutes || 0);
  let grace = Number(ses.burnGraceMinutes || 0);
  if (heat === "high") { dur = Math.round(dur * 0.9); grace = Math.round(grace * 0.6); }
  if (heat === "low") { dur = Math.round(dur * 1.15); grace = Math.round(grace * 1.2); }
  ses.durationMinutes = Math.max(1, dur);
  ses.burnGraceMinutes = Math.max(1, grace);
}

function takeOneById(s, itemId) {
  ensureIds(s);
  const list = s.inventory.items || [];
  const idx = list.findIndex(x => String(x?.id || "") === String(itemId));
  if (idx < 0) return null;
  const it = list[idx];
  const q = Number(it.qty || 1);
  if (Number.isFinite(q) && q > 1) {
    it.qty = q - 1;
    const unit = { ...it, qty: 1 };
    unit.id = `uie_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return unit;
  }
  list.splice(idx, 1);
  return { ...it, qty: 1 };
}

function mergeBack(s, unit) {
  ensureIds(s);
  const list = s.inventory.items || [];
  addInventoryItemWithStack(list, { ...unit, qty: 1, id: `uie_${Date.now()}_${Math.random().toString(16).slice(2)}` }, { source: "kitchen_refund" });
}

async function startCooking() {
  const s = getSettings();
  if (!s) return;
  ensureIds(s);
  const ses = ensureKitchen(s);
  const r = findRecipe(ses.recipeId);
  if (!r) return;

  if (ses.slots.length > (ses.workstation.capacity || 3)) {
    addSessionEvent(s, "Capacity exceeded.");
    return;
  }

  const filled = (ses.slots || []).every(x => x.itemId);
  if (!filled) { addSessionEvent(s, "Missing ingredients."); return; }
  if (Number(ses.prepScore || 0) < 0.6) {
    ses.mistakes = Number(ses.mistakes || 0) + 1;
    addSessionEvent(s, "Rushed prep. Mistake +1.");
  }

  ses.reserved = [];
  for (const sl of ses.slots) {
    const unit = takeOneById(s, sl.itemId);
    if (unit) ses.reserved.push({ unit });
  }
  if (!ses.reserved.length) { addSessionEvent(s, "Could not reserve ingredients."); return; }

  ses.startMinutes = getGameMinutes(s);
  ses.pausedMinutes = 0;
  ses.pausedTotalMinutes = 0;
  
  const eff = ses.workstation.efficiency_multiplier || 1.0;
  ses.durationMinutes = Math.max(1, Math.round(r.minutes / eff));
  ses.burnGraceMinutes = Math.max(1, Math.round(r.burn_buffer));
  ses.mistakes = Number(ses.mistakes || 0);
  applyHeatModifiers(ses);

  await setState("cooking", `Started cooking ${r.name} on ${ses.workstation.name}.`);
  saveKitchenDebounced();
  await injectRpEvent(`Started cooking ${r.name}.`, { uie: { type: "kitchen_start", recipe: r.id } });
}

async function pauseCooking() {
  const s = getSettings();
  if (!s) return;
  const ses = ensureKitchen(s);
  if (ses.state !== "cooking") return;
  ses.pausedMinutes = getGameMinutes(s);
  await setState("paused", "Paused.");
}

async function resumeCooking() {
  const s = getSettings();
  if (!s) return;
  const ses = ensureKitchen(s);
  if (ses.state !== "paused") return;
  const current = getGameMinutes(s);
  const pausedAt = Number(ses.pausedMinutes || current);
  ses.pausedTotalMinutes = Number(ses.pausedTotalMinutes || 0) + Math.max(0, current - pausedAt);
  ses.pausedMinutes = 0;
  await setState("cooking", "Resumed.");
}

async function prepAction(actionId) {
  const s = getSettings();
  if (!s) return;
  const ses = ensureKitchen(s);
  const st = String(ses.state || "idle");
  if (!(st === "idle" || st === "prepping" || st === "cooking" || st === "done")) return;
  const act = String(actionId || "").trim().toLowerCase();
  if (!act || ses.prepDone?.[act] === true) return;
  if (st === "idle") await setState("prepping", "Prepping.");
  let delta = 0.4;
  let line = "Prep action complete.";
  if (act === "chop") { delta = 0.7; line = "Ingredients chopped and staged."; }
  else if (act === "season") { delta = 0.9; line = "Seasoning balanced for depth."; }
  else if (act === "taste") {
    delta = 0.6;
    line = "Taste-check complete.";
    if (Number(ses.mistakes || 0) > 0) {
      ses.mistakes = Math.max(0, Number(ses.mistakes || 0) - 1);
      line += " Corrected one mistake.";
    }
  } else if (act === "plate") {
    delta = 1.0;
    line = "Plating pass improved presentation.";
  }
  ses.prepDone[act] = true;
  ses.prepScore = Math.max(0, Number(ses.prepScore || 0) + delta);
  addSessionEvent(s, line);
  saveKitchenDebounced();
  renderKitchen();
}

async function cancelCooking() {
  const s = getSettings();
  if (!s) return;
  ensureIds(s);
  const ses = ensureKitchen(s);
  if (!(ses.state === "cooking" || ses.state === "paused" || ses.state === "burned")) return;
  for (const r of ses.reserved || []) {
    if (r?.unit) mergeBack(s, r.unit);
  }
  ses.reserved = [];
  await setState("canceled", "Canceled/Dumped.");
  await injectRpEvent("Canceled cooking.", { uie: { type: "kitchen_cancel" } });
  ses.recipeId = "";
  ses.slots = [];
  ses.requires = [];
  ses.startMinutes = 0;
  ses.durationMinutes = 0;
  ses.burnGraceMinutes = 0;
  ses.pausedMinutes = 0;
  ses.pausedTotalMinutes = 0;
  ses.mistakes = 0;
  resetPrep(ses);
  await setState("idle", "Back to idle.");
}

function outputItemFor(s, quality) {
  const ses = ensureKitchen(s);
  const r = findRecipe(ses.recipeId);
  const nameBase = r ? r.name : "Meal";
  const burned = ses.state === "burned" || quality === "failed/destroyed";
  const name = burned ? `Ruined ${nameBase}` : `${nameBase}`;
  const fx = [];
  if (burned) fx.push("Nauseated (short)");
  else if (quality === "perfect") fx.push("Well Fed (10m)");
  else if (quality === "ok") fx.push("Well Fed (6m)");
  else fx.push("Well Fed (3m)");
  
  const out = {
    kind: "item",
    name,
    type: "consumable",
    rarity: burned ? "common" : (quality === "perfect" ? "rare" : "uncommon"),
    qty: 1,
    description: `Cooked on ${ses.workstation.name}. Flavor: ${ses.flavorProfile || "balanced"}. Service: ${ses.serviceStyle || "homey"}. Quality: ${quality}. Ingredients: ${(ses.reserved || []).map(x => x?.unit?.name).filter(Boolean).join(", ")}`,
    mods: {},
    statusEffects: fx,
    use: { hint: "Eat to apply effects.", consumes: true, apCost: 0, mpCost: 0 },
    slotCategory: "COOKING"
  };
  out.id = `uie_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return out;
}

async function serve() {
  const s = getSettings();
  if (!s) return;
  ensureIds(s);
  const ses = ensureKitchen(s);
  if (ses.state !== "done") return;
  const quality = qualityFromSession(ses);
  const out = outputItemFor(s, quality);
  addInventoryItemWithStack(s.inventory.items, out, { source: "kitchen_serve" });
  ses.reserved = [];
  await injectRpEvent(`Served ${out.name}.`, { uie: { type: "kitchen_serve", item: out.name } });
  await setState("idle", `Served ${out.name}.`);
  ses.recipeId = "";
  ses.slots = [];
  ses.requires = [];
  ses.startMinutes = 0;
  ses.durationMinutes = 0;
  ses.burnGraceMinutes = 0;
  ses.pausedMinutes = 0;
  ses.pausedTotalMinutes = 0;
  ses.mistakes = 0;
  resetPrep(ses);
  saveKitchenDebounced();
  renderKitchen();
}

function resetKitchen() {
  const s = getSettings();
  if (!s) return;
  ensureIds(s);
  const ses = ensureKitchen(s);
  ses.state = "idle";
  ses.recipeId = "";
  ses.slots = [];
  ses.requires = [];
  ses.reserved = [];
  ses.startMinutes = 0;
  ses.durationMinutes = 0;
  ses.burnGraceMinutes = 0;
  ses.pausedMinutes = 0;
  ses.pausedTotalMinutes = 0;
  ses.mistakes = 0;
  resetPrep(ses);
  addKitchenLog(s, "Reset.");
  saveKitchenDebounced();
  renderKitchen();
}

function onPickItem(itemId) {
  const s = getSettings();
  if (!s || !pickCtx) return;
  ensureIds(s);
  const ses = ensureKitchen(s);
  const sl = ses.slots.find(x => Number(x.slot) === Number(pickCtx.slot));
  const it = (s.inventory.items || []).find(x => String(x?.id || "") === String(itemId));
  if (!sl || !it) return;
  sl.itemId = String(it.id);
  sl.name = String(it.name || "Item");
  sl.img = String(it.img || "");
  saveKitchenDebounced();
  renderSlots();
  closePicker();
}

function mountToBody() {
  const $overlay = $("#uie-kitchen-overlay");
  if (!$overlay.length) return;
  if (!$overlay.parent().is("body")) $overlay.detach().appendTo(document.body);
  mounted = true;
}

function registerInventoryKitchenMacros(s) {
  if (!kitchenEngine || !s?.inventory || !Array.isArray(s.inventory.items)) return;
  for (const item of s.inventory.items) {
    const macros = Array.isArray(item?.kitchen?.macros) ? item.kitchen.macros : [];
    for (const macro of macros) {
      try { kitchenEngine.registerMacro(macro); } catch (_) {}
    }
  }
}

export function open(opts = {}) {
  const s = getSettings();
  const mode = String(opts?.mode || "body");
  const zIndex = Number.isFinite(Number(opts?.zIndex)) ? Number(opts.zIndex) : 2147483662;
  openCtx = { onExit: (typeof opts?.onExit === "function") ? opts.onExit : null };

  if (mode === "inline") {
    const hostEl = opts?.hostEl || null;
    const $overlay = $("#uie-kitchen-overlay");
    if ($overlay.length && hostEl && $overlay.parent().get(0) !== hostEl) $overlay.detach().appendTo(hostEl);
    mounted = true;
  } else {
    mountToBody();
  }

  if (!mounted || !$("#uie-kitchen-overlay").length) return;
  if (!kitchenEngine) kitchenEngine = createKitchenEngine();
  window.UIE_KitchenEngine = kitchenEngine;
  ensureIds(s);
  registerInventoryKitchenMacros(s);
  const ses = ensureKitchen(s);
  
  if (opts.object && typeof opts.object === "object") {
    const obj = opts.object;
    ses.workstation = {
      name: String(obj.name || obj.label || "Workstation"),
      capabilities: Array.isArray(obj.capabilities) ? obj.capabilities : ["thermal_heating"],
      efficiency_multiplier: typeof obj.efficiency_multiplier === "number" ? obj.efficiency_multiplier : 1.0,
      capacity: typeof obj.capacity === "number" ? obj.capacity : 3,
      state_toggles: Array.isArray(obj.state_toggles) ? obj.state_toggles : []
    };
    ses.activeToggles = {};
    if (Array.isArray(ses.workstation.state_toggles)) {
      ses.workstation.state_toggles.forEach(t => {
        ses.activeToggles[t] = true;
      });
    }
    ses.slots = [];
    ses.recipeId = "";
  }
  
  setKitchenBackground();
  $("#uie-kitchen-overlay").css({ position: mode === "inline" ? "absolute" : "fixed", inset: "0", zIndex, isolation: "isolate" });
  $("#uie-kitchen-overlay").show();
  startTick();
  renderKitchen();
}

export function close(opts = {}) {
  const skipOnExit = opts?.skipOnExit === true;
  $("#uie-kitchen-overlay").hide();
  closePicker();
  stopTick();

  const onExit = openCtx?.onExit;
  openCtx = { onExit: null };

  if (!skipOnExit && typeof onExit === "function") {
    try { onExit(); } catch (_) {}
    return;
  }

  if (skipOnExit) return;

  $("#uie-feature-container").hide().empty();
  $("#uie-craft-home").show();
}

function toggleStyle() {
  const s = getSettings();
  if (!s) return;
  ensureKitchen(s);
  s.kitchenStyle = String(s.kitchenStyle || "modern").toLowerCase() === "medieval" ? "modern" : "medieval";
  saveSettings();
  setKitchenBackground();
}

export function init() {
  mountToBody();
  if (!mounted) return;
  try { window.UIE_closeKitchen = close; } catch (_) {}

  $(document)
    .off("click.uieKitchenExit", "#uie-kitchen-exit")
    .on("click.uieKitchenExit", "#uie-kitchen-exit", function(e){ e.preventDefault(); e.stopPropagation(); close(); });

  $(document)
    .off("click.uieKitchenStyle", "#uie-kitchen-style")
    .on("click.uieKitchenStyle", "#uie-kitchen-style", function(e){ e.preventDefault(); e.stopPropagation(); toggleStyle(); });

  $(document)
    .off("click.uieKitchenReset", "#uie-kitchen-reset")
    .on("click.uieKitchenReset", "#uie-kitchen-reset", function(e){ e.preventDefault(); e.stopPropagation(); resetKitchen(); });

  $(document)
    .off("change.uieKitchenHeat", "#uie-k-heat")
    .on("change.uieKitchenHeat", "#uie-k-heat", function(){
      const s = getSettings();
      if (!s) return;
      const ses = ensureKitchen(s);
      ses.heatLevel = String($(this).val() || "med");
      addSessionEvent(s, `Heat set to ${ses.heatLevel}.`);
      saveKitchenDebounced();
      renderKitchen();
    });

  $(document)
    .off("change.uieKitchenFlavor", "#uie-k-flavor-profile")
    .on("change.uieKitchenFlavor", "#uie-k-flavor-profile", function(){
      const s = getSettings();
      if (!s) return;
      const ses = ensureKitchen(s);
      ses.flavorProfile = String($(this).val() || "balanced");
      addSessionEvent(s, `Flavor profile set: ${ses.flavorProfile}.`);
      saveKitchenDebounced();
      renderKitchen();
    });

  $(document)
    .off("change.uieKitchenService", "#uie-k-service-style")
    .on("change.uieKitchenService", "#uie-k-service-style", function(){
      const s = getSettings();
      if (!s) return;
      const ses = ensureKitchen(s);
      ses.serviceStyle = String($(this).val() || "homey");
      addSessionEvent(s, `Service style set: ${ses.serviceStyle}.`);
      saveKitchenDebounced();
      renderKitchen();
    });

  $(document)
    .off("change.uieKitchenToggleState", ".uie-k-toggle-state")
    .on("change.uieKitchenToggleState", ".uie-k-toggle-state", function() {
      const s = getSettings();
      if (!s) return;
      const ses = ensureKitchen(s);
      const toggle = $(this).data("toggle");
      if (!ses.activeToggles) ses.activeToggles = {};
      ses.activeToggles[toggle] = $(this).is(":checked");
      addSessionEvent(s, `Workstation toggle '${toggle}' set to ${ses.activeToggles[toggle]}`);
      saveKitchenDebounced();
      renderKitchen();
    });

  $(document)
    .off("input.uieKitchenRecipeSearch", "#uie-k-recipe-search")
    .on("input.uieKitchenRecipeSearch", "#uie-k-recipe-search", function(){ renderRecipes(); });

  $(document)
    .off("click.uieKitchenPickRecipe", "#uie-k-recipes .uie-krow")
    .on("click.uieKitchenPickRecipe", "#uie-k-recipes .uie-krow", async function(e){
      e.preventDefault(); e.stopPropagation();
      const id = String($(this).data("recipe") || "");
      const s = getSettings();
      if (!s) return;
      const ses = ensureKitchen(s);
      if (ses.state !== "idle" && ses.state !== "prepping") return;
      ses.recipeId = id;
      const r = findRecipe(id);
      ses.requires = r ? r.requires : [];
      ses.slots = [];
      resetPrep(ses);
      await setState("prepping", `Selected recipe: ${r?.name || id}.`);
      saveKitchenDebounced();
      renderKitchen();
    });

  $(document)
    .off("click.uieKitchenPickSlot", "#uie-k-slots .uie-krow")
    .on("click.uieKitchenPickSlot", "#uie-k-slots .uie-krow", function(e){
      e.preventDefault(); e.stopPropagation();
      const s = getSettings();
      if (!s) return;
      const ses = ensureKitchen(s);
      if (ses.state !== "prepping") return;
      const idx = Number($(this).data("slot"));
      openPicker(idx);
    });

  $(document)
    .off("click.uieKitchenPickClose", "#uie-k-pick-close")
    .on("click.uieKitchenPickClose", "#uie-k-pick-close", function(e){ e.preventDefault(); e.stopPropagation(); closePicker(); });

  $(document)
    .off("input.uieKitchenPickSearch", "#uie-k-pick-search")
    .on("input.uieKitchenPickSearch", "#uie-k-pick-search", function(){ renderPicker(); });

  $(document)
    .off("click.uieKitchenPickRow", "#uie-k-pick-list .pick-row")
    .on("click.uieKitchenPickRow", "#uie-k-pick-list .pick-row", function(e){
      e.preventDefault(); e.stopPropagation();
      const id = String($(this).data("id") || "");
      if (!id) return;
      onPickItem(id);
    });

  $(document)
    .off("click.uieKitchenStart", "#uie-k-start")
    .on("click.uieKitchenStart", "#uie-k-start", async function(e){ e.preventDefault(); e.stopPropagation(); await startCooking(); });

  $(document)
    .off("click.uieKitchenPause", "#uie-k-pause")
    .on("click.uieKitchenPause", "#uie-k-pause", async function(e){ e.preventDefault(); e.stopPropagation(); await pauseCooking(); });

  $(document)
    .off("click.uieKitchenResume", "#uie-k-resume")
    .on("click.uieKitchenResume", "#uie-k-resume", async function(e){ e.preventDefault(); e.stopPropagation(); await resumeCooking(); });

  $(document)
    .off("click.uieKitchenCancel", "#uie-k-cancel")
    .on("click.uieKitchenCancel", "#uie-k-cancel", async function(e){ e.preventDefault(); e.stopPropagation(); await cancelCooking(); });

  $(document)
    .off("click.uieKitchenServe", "#uie-k-serve")
    .on("click.uieKitchenServe", "#uie-k-serve", async function(e){ e.preventDefault(); e.stopPropagation(); await serve(); });

  $(document)
    .off("click.uieKitchenPrepChop", "#uie-k-prep-chop")
    .on("click.uieKitchenPrepChop", "#uie-k-prep-chop", async function(e){ e.preventDefault(); e.stopPropagation(); await prepAction("chop"); });

  $(document)
    .off("click.uieKitchenPrepSeason", "#uie-k-prep-season")
    .on("click.uieKitchenPrepSeason", "#uie-k-prep-season", async function(e){ e.preventDefault(); e.stopPropagation(); await prepAction("season"); });

  $(document)
    .off("click.uieKitchenPrepTaste", "#uie-k-prep-taste")
    .on("click.uieKitchenPrepTaste", "#uie-k-prep-taste", async function(e){ e.preventDefault(); e.stopPropagation(); await prepAction("taste"); });

  $(document)
    .off("click.uieKitchenPrepPlate", "#uie-k-prep-plate")
    .on("click.uieKitchenPrepPlate", "#uie-k-prep-plate", async function(e){ e.preventDefault(); e.stopPropagation(); await prepAction("plate"); });

  renderKitchen();
}
