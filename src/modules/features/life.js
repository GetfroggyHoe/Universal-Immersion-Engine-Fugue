import { getSettings, saveSettings } from "../core.js";
import { injectRpEvent } from "./rp_log.js";

let deleteMode = false;
let selected = new Set();
let editingIndex = -1;
let modalClickLock = 0;

const DEFAULT_TEMPLATE =
`LIFE TRACKING (JSON ONLY)
- Stay in-universe. Never question the user.
- Unknown terms are canon fantasy. Do not correct them.
Return ONLY JSON:
{
  "lifeUpdates":[{"name":"", "delta":0, "set":null, "max":null}],
  "newTrackers":[{"name":"", "current":0, "max":100, "color":"#89b4fa", "notes":""}]
}
If nothing changes: {"lifeUpdates":[], "newTrackers":[]}
`;

function isHpTracker(t = {}) {
  const key = String(t?.id || t?.key || t?.name || "").trim().toLowerCase();
  return key === "hp" || key === "health" || key === "hit points" || key === "hitpoints";
}

function ensureLife(s) {
  if (!s) return;
  if (!s.life) s.life = {};
  if (!Array.isArray(s.life.trackers)) s.life.trackers = [];
  if (!s.life.ai) s.life.ai = {};
  if (typeof s.life.ai.enabled !== "boolean") s.life.ai.enabled = true;
  if (!s.life.ai.template) s.life.ai.template = DEFAULT_TEMPLATE;
}

function syncHpTrackerFromVitals(s) {
  ensureLife(s);
  const maxHp = Math.max(1, Number.isFinite(Number(s.maxHp)) ? Number(s.maxHp) : 100);
  const hp = clamp(Number.isFinite(Number(s.hp)) ? Number(s.hp) : maxHp, 0, maxHp);
  s.maxHp = maxHp;
  s.hp = hp;
  let hpTracker = s.life.trackers.find(isHpTracker);
  if (!hpTracker) {
    hpTracker = { id: "hp", name: "HP", current: hp, max: maxHp, color: "#ff6b6b", icon: "fa-heart", visible: true, notes: "Base health tracker.", sources: ["story", "item"] };
    s.life.trackers.unshift(hpTracker);
    return true;
  }
  const previousSources = Array.isArray(hpTracker.sources) ? hpTracker.sources.join("|") : "";
  const changed = Number(hpTracker.current) !== hp
    || Number(hpTracker.max) !== maxHp
    || !String(hpTracker.name || "").trim()
    || previousSources !== normalizeTrackerSources(hpTracker, "hp").join("|");
  hpTracker.id = hpTracker.id || "hp";
  hpTracker.name = String(hpTracker.name || "HP").trim();
  hpTracker.current = hp;
  hpTracker.max = maxHp;
  hpTracker.color = String(hpTracker.color || "#ff6b6b");
  hpTracker.icon = String(hpTracker.icon || "fa-heart");
  hpTracker.sources = normalizeTrackerSources(hpTracker, "hp");
  return changed;
}

function syncVitalsFromHpTracker(s, tracker) {
  if (!s || !isHpTracker(tracker)) return false;
  const maxHp = Math.max(1, Number(tracker.max ?? s.maxHp ?? 100));
  const hp = clamp(Number(tracker.current ?? s.hp ?? maxHp), 0, maxHp);
  const changed = Number(s.hp) !== hp || Number(s.maxHp) !== maxHp;
  s.hp = hp;
  s.maxHp = maxHp;
  return changed;
}

function clamp(n, min, max) {
  n = Number(n);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function pct(cur, max) {
  cur = Number(cur || 0);
  max = Number(max || 0);
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (cur / max) * 100));
}

const TRACKER_SOURCES = ["time", "story", "item"];

function inferTrackerSources(raw = {}, name = "") {
  const key = String(name || raw?.name || raw?.id || "").toLowerCase();
  if (key === "hp" || key.includes("health") || key.includes("hit point")) return ["story", "item"];
  if (/(hunger|thirst|energy|stamina|fatigue|sleep|rest|hygiene|stress|sanity|mood|social|heat|cold|warmth|temperature)/.test(key)) {
    return ["time", "story", "item"];
  }
  if (/(xp|exp|level|quest|relationship|bond|reputation|corruption|morale|trust|affection|progress)/.test(key)) {
    return ["story"];
  }
  return ["story", "item"];
}

function normalizeTrackerSources(raw = {}, name = "") {
  const seen = new Set();
  const incoming = Array.isArray(raw?.sources) ? raw.sources : [];
  for (const src of incoming) {
    const val = String(src || "").toLowerCase().trim();
    if (TRACKER_SOURCES.includes(val)) seen.add(val);
  }
  if (!seen.size) inferTrackerSources(raw, name).forEach((src) => seen.add(src));
  return TRACKER_SOURCES.filter((src) => seen.has(src));
}

function readSourceChecks(prefix) {
  const sources = TRACKER_SOURCES.filter((src) => $(`#${prefix}-src-${src}`).prop("checked"));
  return sources.length ? sources : ["story"];
}

function setSourceChecks(prefix, sources) {
  const normalized = normalizeTrackerSources({ sources });
  for (const src of TRACKER_SOURCES) {
    $(`#${prefix}-src-${src}`).prop("checked", normalized.includes(src));
  }
}

function sourceLabel(src) {
  if (src === "time") return "Time";
  if (src === "item") return "Item";
  return "Story";
}

export function normalizeLifeTracker(raw = {}) {
  const name = String(raw?.name || "Tracker").trim().slice(0, 60) || "Tracker";
  const max = Math.max(1, Number.isFinite(Number(raw?.max)) ? Number(raw.max) : 100);
  const currentRaw = Number.isFinite(Number(raw?.current)) ? Number(raw.current) : 0;
  const current = clamp(currentRaw, -999999, 999999);
  const colorRaw = String(raw?.color || "").trim();
  const color = /^#[0-9a-fA-F]{6}$/.test(colorRaw) ? colorRaw : "#89b4fa";
  const notes = String(raw?.notes || "").slice(0, 800);
  const icon = String(raw?.icon || "fa-heart").trim().slice(0, 80) || "fa-heart";
  const sources = normalizeTrackerSources(raw, name);
  return { name, current, max, color, icon, notes, sources };
}

/** ✅ Portal modals to <body> so they overlay the shell (not behind / clipped) */
function portalModalsToBody() {
  const ids = ["#life-modal-create", "#life-modal-template", "#life-modal-edit"];
  for (const sel of ids) {
    // 1. Try to find the element ANYWHERE in the document
    let el = document.querySelector(sel);
    
    // 2. If found, but it's inside #uie-view-life, move it to body
    // If not found, it might be that querySelector missed it inside a shadow root or something (unlikely here)
    // or it hasn't been rendered yet.
    
    if (el) {
        if (el.parentNode !== document.body) {
            document.body.appendChild(el);
            el.dataset.uiePortaled = "1";
        }
        // If duplicate IDs exist from repeated template mounts, keep the first one only.
        const dups = document.querySelectorAll(sel);
        if (dups.length > 1) {
          for (let i = 1; i < dups.length; i++) {
            try { dups[i].remove(); } catch (_) {}
          }
        }
    } else {
        // Fallback: Look specifically inside the view container
        const container = document.getElementById("uie-view-life");
        if (container) {
            el = container.querySelector(sel);
            if (el) {
                document.body.appendChild(el);
                el.dataset.uiePortaled = "1";
                const dups = document.querySelectorAll(sel);
                if (dups.length > 1) {
                  for (let i = 1; i < dups.length; i++) {
                    try { dups[i].remove(); } catch (_) {}
                  }
                }
            }
        }
    }
  }
}

function gateModalClick(ms = 220) {
  const now = Date.now();
  if (now - modalClickLock < ms) return false;
  modalClickLock = now;
  return true;
}

export function render() {
  const s = getSettings();
  if (!s) return;
  ensureLife(s);
  const hpSynced = syncHpTrackerFromVitals(s);
  if (hpSynced) saveSafe(s);

  const $list = $("#life-list");
  if (!$list.length) return;

  $list.empty();

  if (!s.life.trackers.length) {
    const $msg = $("<div>").css({color:"rgba(255,255,255,.65)", fontWeight:900, padding:"10px"});
    $msg.append(document.createTextNode("No trackers yet. Tap "));
    $msg.append($("<b>").text("New"));
    $msg.append(document.createTextNode("."));
    $list.append($msg);
    return;
  }

  const template = document.getElementById("life-card-template");

  for (let i = 0; i < s.life.trackers.length; i++) {
    const t = s.life.trackers[i] || {};
    const name = String(t.name || "Tracker");
    const cur = Number(t.current ?? 0);
    const max = Number(t.max ?? 100);
    const color = String(t.color || "#89b4fa");
    const notes = String(t.notes || "");
    const sources = normalizeTrackerSources(t, name);
    if (!Array.isArray(t.sources) || t.sources.join("|") !== sources.join("|")) t.sources = sources;
    const barPct = pct(cur, max);

    const isSel = deleteMode && selected.has(i);

    const clone = template.content.cloneNode(true);
    const $card = $(clone).find(".life-card");
    
    $card.attr("data-idx", i);
    if (deleteMode) $card.addClass("selecting");
    if (isSel) $card.addClass("selected");
    
    $card.find(".life-dot").css("background", color);
    $card.find(".name-text").text(name);
    $card.find(".life-meta").text(`${cur}/${max}`);
    $card.find(".life-fill").css({width: `${barPct}%`, background: color});
    const $sources = $card.find(".life-sources");
    if ($sources.length) {
      $sources.empty();
      for (const src of sources) $("<span>").addClass(`life-source-tag life-source-${src}`).text(sourceLabel(src)).appendTo($sources);
    }
    
    if (notes) {
      $card.find(".life-notes").text(notes).show();
    }
    
    if (deleteMode) {
      const $pick = $("<div>").addClass("life-pick");
      if (isSel) $pick.addClass("on");
      $("<i>").addClass("fa-solid fa-check").css({fontSize:"10px", opacity: isSel ? "1" : "0"}).appendTo($pick);
      $card.find(".life-pick-container").append($pick);
      
      $card.find(".life-ctrls").remove();
    }
    
    $list.append($card);
  }
}

function openCreate() {
  portalModalsToBody();
  editingIndex = -1;
  $("#life-create-name").val("");
  $("#life-create-color").val("#89b4fa");
  $("#life-create-current").val(0);
  $("#life-create-max").val(100);
  $("#life-create-notes").val("");
  setSourceChecks("life-create", ["story", "item"]);
  $("body > #life-modal-create, #life-modal-create").first().css("display", "flex");
  const createColor = document.getElementById("life-create-color");
  if (createColor) createColor.style.backgroundColor = createColor.value;
}

function closeCreate() { $("body > #life-modal-create, #life-modal-create").hide(); }

function openTemplate() {
  const s = getSettings();
  if (!s) return;
  ensureLife(s);
  portalModalsToBody();
  $("#life-template-text").val(s.life.ai.template || DEFAULT_TEMPLATE);
  $("body > #life-modal-template, #life-modal-template").first().css("display", "flex");
}

function closeTemplate() { $("body > #life-modal-template, #life-modal-template").hide(); }

function createTrackerFromModal() {
  const s = getSettings();
  if (!s) return;
  ensureLife(s);

  const normalized = normalizeLifeTracker({
    name: $("#life-create-name").val(),
    color: $("#life-create-color").val(),
    current: $("#life-create-current").val(),
    max: $("#life-create-max").val(),
    notes: $("#life-create-notes").val(),
    sources: readSourceChecks("life-create"),
  });

  if (editingIndex >= 0 && s.life.trackers[editingIndex]) {
      s.life.trackers[editingIndex] = normalized;
  } else {
      s.life.trackers.push(normalized);
  }
  syncVitalsFromHpTracker(s, normalized);
  
  saveSettings(s);

  closeCreate();
  render();
  $(document).trigger("uie:updateVitals");
}

function bump(idx, delta) {
  const s = getSettings();
  if (!s) return;
  ensureLife(s);

  const t = s.life.trackers[idx];
  if (!t) return;

  t.current = clamp(Number(t.current ?? 0) + delta, -999999, 999999);
  t.max = clamp(t.max ?? 100, 0, 999999);
  syncVitalsFromHpTracker(s, t);

  saveSettingssafe(s);
  render();
  $(document).trigger("uie:updateVitals");
}

function updateDeleteUi() {
  if (deleteMode) {
    $("#life-btn-delete").show();
    $("#life-btn-cancel-delete").show();
  } else {
    $("#life-btn-delete").hide();
    $("#life-btn-cancel-delete").hide();
  }
}

function toggleDeleteMode(on) {
  deleteMode = !!on;
  if (!deleteMode) selected = new Set();
  updateDeleteUi();
  render();
}

function deleteSelected() {
  const s = getSettings();
  if (!s) return;
  ensureLife(s);
  const idxs = Array.from(selected).sort((a, b) => b - a);
  for (const idx of idxs) {
    if (idx >= 0 && idx < s.life.trackers.length) s.life.trackers.splice(idx, 1);
  }
  saveSafe(s);
  toggleDeleteMode(false);
  $(document).trigger("uie:updateVitals");
  try { injectRpEvent(`[System: Deleted ${idxs.length} Life Tracker(s).]`); } catch (_) {}
}

function openEdit(idx) {
  const s = getSettings();
  if (!s) return;
  ensureLife(s);
  if (!Number.isFinite(Number(idx))) return;
  const i = Number(idx);
  const t = s.life.trackers[i];
  if (!t) return;

  const normalized = normalizeLifeTracker(t);
  editingIndex = i;
  portalModalsToBody();

  $("#life-edit-title").text(`Edit Tracker: ${normalized.name}`);
  $("#life-edit-name").val(normalized.name);
  $("#life-edit-color").val(normalized.color);
  $("#life-edit-current").val(Number(normalized.current));
  $("#life-edit-max").val(Number(normalized.max));
  $("#life-edit-notes").val(normalized.notes);
  setSourceChecks("life-edit", normalized.sources);

  $("body > #life-modal-edit, #life-modal-edit").first().css("display", "flex");
  const editColor = document.getElementById("life-edit-color");
  if (editColor) editColor.style.backgroundColor = editColor.value;
}

/* avoid rare save failures */
function RAZ(){}

function saveSafe(s){
  try { saveSettings(s); } catch(e){ console.error("[UIE] saveSettings failed:", e); }
}
function saveSettingsSafe(s){ saveSafe(s); }
function saveSettingsSafes(s){ saveSafe(s); }
function saveSettingssafes(s){ saveSafe(s); }
function saveSettingssafe(s){ saveSafe(s); }

export function init() {
  // CRITICAL FIX: Do NOT remove existing modals from body if they are already there.
  // The view template is only loaded ONCE. If we move modals to body, they leave the view.
  // If we delete them from body here, they are gone forever because the view won't reload the HTML.
  
  const ids = ["#life-modal-create", "#life-modal-template", "#life-modal-edit"];
  const missing = ids.some(id => !document.querySelector(`body > ${id}`));
  
  if (missing) {
      // Only try to portal if we are missing pieces.
      // This happens on first load (they are in view, not body).
      portalModalsToBody();
      setTimeout(portalModalsToBody, 50);
  }

  render();
  updateDeleteUi();

  // Re-bind document events (safe to call multiple times as we use .off)
  // CRITICAL: We bind to BODY because the modals are now direct children of BODY.
  const $body = $("body");

  $body
    .off("click.uieLifeAdd", "#life-btn-add")
    .on("click.uieLifeAdd", "#life-btn-add", (e) => {
      e.preventDefault(); e.stopPropagation();
      openCreate();
    });

  $body
    .off("click.uieLifeTrash", "#life-btn-trash")
    .on("click.uieLifeTrash", "#life-btn-trash", (e) => {
      e.preventDefault(); e.stopPropagation();
      toggleDeleteMode(!deleteMode);
    });

  $body
    .off("click.uieLifeDelCancel", "#life-btn-cancel-delete")
    .on("click.uieLifeDelCancel", "#life-btn-cancel-delete", (e) => {
      e.preventDefault(); e.stopPropagation();
      toggleDeleteMode(false);
    });

  $body
    .off("click.uieLifeDelGo", "#life-btn-delete")
    .on("click.uieLifeDelGo", "#life-btn-delete", (e) => {
      e.preventDefault(); e.stopPropagation();
      deleteSelected();
    });

  $body
    .off("click.uieLifeTpl", "#life-btn-template")
    .on("click.uieLifeTpl", "#life-btn-template", (e) => {
      e.preventDefault(); e.stopPropagation();
      openTemplate();
    });

  // Create modal controls
  $body
    .off("pointerup.uieLifeCreateClose click.uieLifeCreateClose", "#life-create-close, #life-create-cancel")
    .on("pointerup.uieLifeCreateClose click.uieLifeCreateClose", "#life-create-close, #life-create-cancel", (e) => {
      if (!gateModalClick()) return;
      e.preventDefault(); e.stopPropagation();
      closeCreate();
    });

  $body
    .off("pointerup.uieLifeCreateSave click.uieLifeCreateSave", "#life-create-save")
    .on("pointerup.uieLifeCreateSave click.uieLifeCreateSave", "#life-create-save", (e) => {
      if (!gateModalClick()) return;
      e.preventDefault(); e.stopPropagation();
      
      // Validation check
      const name = $("#life-create-name").val();
      if (!name) {
          alert("Please enter a name for the tracker.");
          return;
      }
      
      createTrackerFromModal();
    });

  // Template modal controls
  $body
    .off("pointerup.uieLifeTplClose click.uieLifeTplClose", "#life-template-close")
    .on("pointerup.uieLifeTplClose click.uieLifeTplClose", "#life-template-close", (e) => {
      if (!gateModalClick()) return;
      e.preventDefault(); e.stopPropagation();
      closeTemplate();
    });

  $body
    .off("click.uieLifeTplReset", "#life-template-reset")
    .on("click.uieLifeTplReset", "#life-template-reset", (e) => {
      e.preventDefault(); e.stopPropagation();
      $("#life-template-text").val(DEFAULT_TEMPLATE);
    });

  $body
    .off("click.uieLifeTplSave", "#life-template-save")
    .on("click.uieLifeTplSave", "#life-template-save", (e) => {
      e.preventDefault(); e.stopPropagation();
      const s = getSettings();
      if (!s) return;
      ensureLife(s);
      s.life.ai.template = String($("#life-template-text").val() || DEFAULT_TEMPLATE);
      s.life.ai.enabled = true;
      saveSafe(s);
      closeTemplate();
    });
    
  // Edit modal controls
  $body
    .off("pointerup.uieLifeEditClose click.uieLifeEditClose", "#life-edit-close")
    .on("pointerup.uieLifeEditClose click.uieLifeEditClose", "#life-edit-close", (e) => {
        if (!gateModalClick()) return;
        e.preventDefault(); e.stopPropagation();
        $("#life-modal-edit").hide();
    });
    
  $body
    .off("click.uieLifeEditSave", "#life-edit-save")
    .on("click.uieLifeEditSave", "#life-edit-save", (e) => {
        e.preventDefault(); e.stopPropagation();
        
        const s = getSettings();
        ensureLife(s);
        if (!s || editingIndex < 0 || !s.life.trackers[editingIndex]) return;
        
        const normalized = normalizeLifeTracker({
          name: $("#life-edit-name").val(),
          color: $("#life-edit-color").val(),
          current: $("#life-edit-current").val(),
          max: $("#life-edit-max").val(),
          notes: $("#life-edit-notes").val(),
          sources: readSourceChecks("life-edit"),
        });
        const oldTracker = s.life.trackers[editingIndex];
        if (isHpTracker(oldTracker)) normalized.id = "hp";
        s.life.trackers[editingIndex] = normalized;
        syncVitalsFromHpTracker(s, normalized);
        saveSettings(s);
        
        $("#life-modal-edit").hide();
        render();
        $(document).trigger("uie:updateVitals");
    });
    
  $body
    .off("click.uieLifeEditDel", "#life-edit-delete")
    .on("click.uieLifeEditDel", "#life-edit-delete", (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!confirm("Delete this tracker?")) return;
        
        const s = getSettings();
        ensureLife(s);
        if (!s || editingIndex < 0) return;
        
        s.life.trackers.splice(editingIndex, 1);
        saveSettings(s);
        
        $("#life-modal-edit").hide();
        render();
        $(document).trigger("uie:updateVitals");
    });

  // Card +/-
  $body
    .off("click.uieLifeCard", "#life-list .life-card .life-mini")
    .on("click.uieLifeCard", "#life-list .life-card .life-mini", function (e) {
      e.preventDefault(); e.stopPropagation();
      const idx = Number($(this).closest(".life-card").data("idx"));
      const act = String($(this).data("act") || "");
      if (act === "edit") openEdit(idx);
      if (act === "minus") bump(idx, -1);
      if (act === "plus") bump(idx, +1);
    });

  $body
    .off("click.uieLifePick", "#life-list .life-card.selecting")
    .on("click.uieLifePick", "#life-list .life-card.selecting", function (e) {
      e.preventDefault(); e.stopPropagation();
      const idx = Number($(this).data("idx"));
      if (Number.isNaN(idx)) return;
      if (selected.has(idx)) selected.delete(idx);
      else selected.add(idx);
      render();
    });

  $body
    .off("click.uieLifeOpenEdit", "#life-list .life-card:not(.selecting)")
    .on("click.uieLifeOpenEdit", "#life-list .life-card:not(.selecting)", function (e) {
      if ($(e.target).closest(".life-mini, .life-ctrls").length) return;
      e.preventDefault(); e.stopPropagation();
      const idx = Number($(this).data("idx"));
      openEdit(idx);
    });

  $body.on("input change", "#life-create-color", function() {
    this.style.backgroundColor = this.value;
  });
  $body.on("input change", "#life-edit-color", function() {
    this.style.backgroundColor = this.value;
  });

  (function initLifeSwipe() {
    const list = document.getElementById("life-list");
    if (!list || list.dataset.uieSwipeBound) return;
    list.dataset.uieSwipeBound = "1";
    let startY = 0;
    list.addEventListener("touchstart", (e) => { startY = e.touches[0].clientY; }, { passive: true });
    list.addEventListener("touchmove", (e) => {
      const dy = startY - e.touches[0].clientY;
      list.scrollTop += dy * 0.5;
      startY = e.touches[0].clientY;
    }, { passive: true });
  })();
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}
