import { getSettings, saveSettings } from "../core.js";
import { generateContent } from "../apiClient.js";
import { addInventoryItemWithStack } from "../inventoryItems.js";
import { injectRpEvent } from "./rp_log.js";

let tracedRunePoints = [];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function ensureRuneModel(s) {
  if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
  if (!Array.isArray(s.inventory.runes)) s.inventory.runes = [];
  if (!s.magic || typeof s.magic !== "object") s.magic = {};
  if (!Array.isArray(s.magic.runes)) s.magic.runes = [];
}

function selectedTags() {
  return Array.from(document.querySelectorAll("#uie-rune-root .uie-rune-chip input:checked")).map((el) => String(el.value || "").trim()).filter(Boolean);
}

function usePayload() {
  const useMode = String($("#uie-rune-uses").val() || "multiple");
  const charges = useMode === "single" ? 1 : useMode === "unlimited" ? null : Math.max(2, Number($("#uie-rune-charges").val() || 3));
  return { useMode, charges };
}

function readDraft() {
  const { useMode, charges } = usePayload();
  const name = String($("#uie-rune-name").val() || "").trim() || "Unnamed Rune";
  const desc = String($("#uie-rune-desc").val() || "").trim();
  const pattern = String($("#uie-rune-design").val() || "").trim();
  const glyph = String($("#uie-rune-glyph").val() || "").trim().slice(0, 3) || "*";
  const effects = String($("#uie-rune-effects").val() || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12);
  const lockMode = String($("#uie-rune-lock-mode").val() || "auto");
  const trace = tracedRunePoints.map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 })).slice(0, 600);
  const tags = Array.from(new Set(["rune", "magic", ...selectedTags(), lockMode !== "none" ? "rune_lock" : ""].filter(Boolean)));
  return {
    id: `rune_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 7)}`,
    kind: "item",
    category: "rune",
    slotCategory: "ENCHANTMENT",
    type: "rune",
    name,
    description: desc || `${name} is a crafted magic rune.`,
    desc: desc || `${name} is a crafted magic rune.`,
    school: String($("#uie-rune-school").val() || "").trim() || "arcane",
    useMode,
    charges,
    maxCharges: charges,
    unlimited: useMode === "unlimited",
    trigger: String($("#uie-rune-trigger").val() || "touch"),
    targeting: String($("#uie-rune-targeting").val() || "self"),
    effects,
    statusEffects: effects,
    cost: String($("#uie-rune-cost").val() || "").trim(),
    design: {
      pattern,
      glyph,
      trace,
    },
    runeDesign: pattern,
    activationTrace: trace,
    mustTraceToActivate: true,
    glyph,
    runeLock: {
      mode: lockMode,
      canUnlock: lockMode === "auto" || lockMode === "key",
      canSeal: lockMode === "seal",
      gameMayPlaceLocks: true,
    },
    rarity: "uncommon",
    qty: 1,
    tags,
  };
}

function writeDraftToForm(data = {}) {
  $("#uie-rune-name").val(data.name || "");
  $("#uie-rune-school").val(data.school || data.magicSchool || "");
  $("#uie-rune-desc").val(data.description || data.desc || "");
  $("#uie-rune-design").val(data.runeDesign || data.design?.pattern || data.designPattern || "");
  $("#uie-rune-glyph").val(data.glyph || data.design?.glyph || "");
  $("#uie-rune-effects").val(Array.isArray(data.effects) ? data.effects.join(", ") : (Array.isArray(data.statusEffects) ? data.statusEffects.join(", ") : data.effects || ""));
  $("#uie-rune-cost").val(data.cost || data.costs || "");
  $("#uie-rune-trigger").val(data.trigger || "touch");
  $("#uie-rune-targeting").val(data.targeting || "self");
  const useMode = data.useMode || data.uses || "multiple";
  $("#uie-rune-uses").val(["single", "multiple", "unlimited"].includes(useMode) ? useMode : "multiple");
  if (Number.isFinite(Number(data.charges))) $("#uie-rune-charges").val(Math.max(2, Number(data.charges)));
  $("#uie-rune-lock-mode").val(data.lockMode || data.runeLock?.mode || "auto");
  renderPreview();
}

function log(line) {
  const cur = String($("#uie-rune-log").text() || "");
  $("#uie-rune-log").text([String(line || ""), cur].filter(Boolean).join("\n").slice(0, 2400));
}

function renderPreview() {
  const draft = readDraft();
  $("#uie-rune-preview .uie-rune-glyph").text(String(draft.glyph || "*").slice(0, 3));
  $("#uie-rune-charge-row").toggle(draft.useMode === "multiple");
  const uses = draft.useMode === "unlimited" ? "Unlimited use" : draft.useMode === "single" ? "Single use" : `${draft.charges} charges`;
  const traceStatus = document.getElementById("uie-rune-trace-status");
  if (traceStatus) traceStatus.textContent = tracedRunePoints.length ? `${tracedRunePoints.length} traced points captured` : "Trace the rune pattern to enable creation.";
  $("#uie-rune-summary").html(`
    <strong>${esc(draft.name)}</strong><br>
    ${esc(draft.school)} magic · ${esc(uses)} · ${esc(draft.trigger)} trigger<br>
    ${esc(draft.runeLock.mode === "none" ? "No lock behavior" : `Rune lock: ${draft.runeLock.mode}`)}<br>
    Pattern: ${esc(draft.design.pattern || "User-defined activation trace")}
  `);
  drawTracePreview();
}

async function aiDraft() {
  const seed = String($("#uie-rune-ai-seed").val() || $("#uie-rune-desc").val() || "").trim();
  const btn = $("#uie-rune-ai");
  btn.prop("disabled", true).text("Drafting...");
  try {
    const prompt = `Return ONLY JSON for a browser RPG rune item.
Schema: {"name":"","school":"","useMode":"single|multiple|unlimited","charges":3,"trigger":"touch|spoken|drawn|impact|proximity|ritual","targeting":"self|single|area|object|door|location","effects":[""],"cost":"","description":"","designPattern":"","glyph":"","lockMode":"auto|key|seal|none","tags":[""]}
Rules:
- Runes are magic.
- Every rune has a visible activation design/pattern the user can draw or describe.
- Rune locks may exist only when the setting/mode supports fantasy or magic; set lockMode "none" for nonmagical runes.
- The game may add rune locks where it sees fit; do not force a location.
- Use limits must be single, multiple, or unlimited.
Seed: ${seed || "Create a useful rune for the current scene."}`;
    const res = await generateContent(prompt, "Rune Creation");
    const clean = String(res || "").replace(/```json|```/g, "").trim();
    const data = JSON.parse(clean);
    writeDraftToForm(data);
    log("AI draft loaded.");
  } catch (err) {
    console.error("[rune] AI draft failed", err);
    log("AI draft failed. You can still create manually.");
  } finally {
    btn.prop("disabled", false).text("AI Draft");
  }
}

async function saveRune() {
  const s = getSettings();
  ensureRuneModel(s);
  const rune = readDraft();
  if (!Array.isArray(rune.activationTrace) || rune.activationTrace.length < 8) {
    log("Trace the rune pattern first. Runes must be traced to work.");
    return;
  }
  addInventoryItemWithStack(s.inventory.items, rune, { source: "rune_creation" });
  s.inventory.runes.push({ ...rune });
  s.magic.runes.push({ ...rune });
  saveSettings(s);
  try { window.dispatchEvent(new CustomEvent("uie:state_updated", { detail: { type: "rune_created", rune } })); } catch (_) {}
  log(`Created ${rune.name}.`);
  await injectRpEvent(`[System: Created rune "${rune.name}". Use mode: ${rune.useMode}${rune.charges ? ` (${rune.charges} charges)` : ""}. Rune lock mode: ${rune.runeLock.mode}. Activation pattern: ${rune.design?.pattern || "user-defined trace"}.]`, { uie: { type: "rune_created", rune } });
}

function resetRune() {
  $("#uie-rune-root input[type='text'], #uie-rune-root textarea").val("");
  $("#uie-rune-uses").val("multiple");
  $("#uie-rune-charges").val("3");
  $("#uie-rune-lock-mode").val("auto");
  $("#uie-rune-trigger").val("touch");
  $("#uie-rune-targeting").val("self");
  $("#uie-rune-root .uie-rune-chip input").prop("checked", false);
  tracedRunePoints = [];
  clearTraceCanvas();
  renderPreview();
  log("Reset.");
}

function normalizeCanvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const x = rect.width ? ((event.clientX - rect.left) / rect.width) * 100 : 0;
  const y = rect.height ? ((event.clientY - rect.top) / rect.height) * 100 : 0;
  return {
    x: Math.max(0, Math.min(100, Math.round(x * 10) / 10)),
    y: Math.max(0, Math.min(100, Math.round(y * 10) / 10)),
  };
}

function setupTraceCanvas() {
  const canvas = document.getElementById("uie-rune-trace-canvas");
  if (!canvas || canvas.dataset.uieTraceBound === "1") return;
  canvas.dataset.uieTraceBound = "1";
  let drawing = false;
  const addPoint = (event, fresh = false) => {
    if (fresh) tracedRunePoints = [];
    tracedRunePoints.push(normalizeCanvasPoint(canvas, event));
    drawTracePreview();
  };
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    drawing = true;
    try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
    addPoint(event, true);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    event.preventDefault();
    addPoint(event);
  });
  const finish = () => {
    if (!drawing) return;
    drawing = false;
    log(`Trace captured (${tracedRunePoints.length} points).`);
    renderPreview();
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  drawTracePreview();
}

function drawTracePreview() {
  const canvas = document.getElementById("uie-rune-trace-canvas");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || 280));
  const height = Math.max(1, Math.round(rect.height || 280));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255, 211, 141, 0.34)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, Math.min(width, height) * 0.32, 0, Math.PI * 2);
  ctx.stroke();
  if (tracedRunePoints.length < 2) return;
  ctx.strokeStyle = "#68f7ff";
  ctx.lineWidth = 5;
  ctx.shadowColor = "#68f7ff";
  ctx.shadowBlur = 14;
  ctx.beginPath();
  tracedRunePoints.forEach((point, index) => {
    const x = (point.x / 100) * width;
    const y = (point.y / 100) * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function clearTraceCanvas() {
  const canvas = document.getElementById("uie-rune-trace-canvas");
  const ctx = canvas?.getContext?.("2d");
  if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export function init() {
  $(document)
    .off("input.uieRune change.uieRune", "#uie-rune-root input, #uie-rune-root textarea, #uie-rune-root select")
    .on("input.uieRune change.uieRune", "#uie-rune-root input, #uie-rune-root textarea, #uie-rune-root select", renderPreview)
    .off("click.uieRuneSave", "#uie-rune-save")
    .on("click.uieRuneSave", "#uie-rune-save", (e) => { e.preventDefault(); void saveRune(); })
    .off("click.uieRuneAi", "#uie-rune-ai")
    .on("click.uieRuneAi", "#uie-rune-ai", (e) => { e.preventDefault(); void aiDraft(); })
    .off("click.uieRuneClearTrace", "#uie-rune-clear-trace")
    .on("click.uieRuneClearTrace", "#uie-rune-clear-trace", (e) => {
      e.preventDefault();
      tracedRunePoints = [];
      clearTraceCanvas();
      renderPreview();
      log("Trace cleared.");
    })
    .off("click.uieRuneReset", "#uie-rune-reset")
    .on("click.uieRuneReset", "#uie-rune-reset", (e) => { e.preventDefault(); resetRune(); });
  setupTraceCanvas();
  renderPreview();
}
