import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";
import { publishOrganizationIntel, detectOrganizationNamesInText } from "./organizationIntelBus.js";

const STYLE_ID = "uie-cutscene-style";
const OVERLAY_ID = "uie-cutscene-overlay";
const DEFAULT_DURATION = 6500;
let activeTimer = null;
let restoreSnapshot = null;
let isActive = false;
let escHandler = null;

function isCutsceneEnabled() {
  try {
    const s = getSettings();
    if (!s.rpg || typeof s.rpg !== "object") return true;
    return s.rpg.cutscenesEnabled !== false;
  } catch (_) {
    return true;
  }
}

function isAiCutsceneEnabled() {
  try {
    const s = getSettings();
    if (!s.rpg || typeof s.rpg !== "object") return true;
    return s.rpg.cutscenesAi !== false;
  } catch (_) {
    return true;
  }
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#${OVERLAY_ID}{position:fixed;inset:0;z-index:2147483642;display:none;background:#05070d;color:#f8fafc;overflow:hidden;font-family:Inter,"Segoe UI",system-ui,sans-serif}
#${OVERLAY_ID}.is-open{display:block}
.uie-cutscene-bg{position:absolute;inset:0;background:radial-gradient(circle at 50% 45%,rgba(30,64,175,.34),transparent 38%),linear-gradient(135deg,#111827,#030712);background-size:cover;background-position:center;filter:saturate(1.04);transition:background-image .8s ease}
.uie-cutscene-vignette{position:absolute;inset:0;background:linear-gradient(180deg,#000 0 10%,transparent 24% 76%,#000 90% 100%),radial-gradient(circle,transparent 45%,rgba(0,0,0,.78));pointer-events:none}
.uie-cutscene-sprites{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center;gap:clamp(8px,2vw,32px);padding-bottom:clamp(120px,22vh,240px);pointer-events:none;z-index:2}
.uie-cutscene-sprite{max-height:clamp(180px,40vh,420px);width:auto;object-fit:contain;filter:drop-shadow(0 8px 32px rgba(0,0,0,.7));opacity:0;transform:translateY(24px);transition:opacity .6s ease,transform .6s ease}
.uie-cutscene-sprite.is-visible{opacity:1;transform:translateY(0)}
.uie-cutscene-sprite-name{position:absolute;bottom:-28px;left:50%;transform:translateX(-50%);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(248,250,252,.7);text-shadow:0 2px 8px rgba(0,0,0,.9);white-space:nowrap;background:rgba(0,0,0,.4);padding:2px 10px;border-radius:999px}
.uie-cutscene-shot{position:absolute;left:clamp(18px,6vw,86px);right:clamp(18px,6vw,86px);bottom:clamp(34px,8vh,92px);max-width:920px;z-index:3}
.uie-cutscene-kicker{font-size:11px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#93c5fd;text-shadow:0 2px 8px rgba(0,0,0,.8)}
.uie-cutscene-title{margin-top:8px;font-size:clamp(24px,4vw,54px);font-weight:900;line-height:1.02;text-shadow:0 5px 28px rgba(0,0,0,.85)}
.uie-cutscene-body{margin-top:12px;max-width:720px;font-size:clamp(14px,1.8vw,20px);line-height:1.55;color:rgba(248,250,252,.86);text-shadow:0 2px 12px rgba(0,0,0,.9);white-space:pre-wrap}
.uie-cutscene-characters{margin-top:10px;display:flex;flex-wrap:wrap;gap:6px}
.uie-cutscene-char-tag{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:rgba(147,197,253,.85);background:rgba(30,64,175,.22);border:1px solid rgba(147,197,253,.18);padding:3px 10px;border-radius:999px}
.uie-cutscene-skip{position:absolute;right:18px;bottom:18px;padding:8px 18px;border-radius:999px;border:1px solid rgba(255,255,255,.22);background:rgba(0,0,0,.46);color:#fff;display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;z-index:10;backdrop-filter:blur(6px);transition:background .2s ease,border-color .2s ease}
.uie-cutscene-skip:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.38)}
.uie-cutscene-progress{position:absolute;bottom:0;left:0;right:0;height:3px;background:rgba(255,255,255,.08);z-index:5}
.uie-cutscene-progress-bar{height:100%;background:linear-gradient(90deg,#3b82f6,#93c5fd);width:0%;transition:width .1s linear;border-radius:0 2px 2px 0}
.uie-cutscene-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:8;background:rgba(5,7,13,.92)}
.uie-cutscene-loading-spinner{width:40px;height:40px;border:3px solid rgba(147,197,253,.2);border-top-color:#93c5fd;border-radius:50%;animation:uie-cutscene-spin .8s linear infinite}
@keyframes uie-cutscene-spin{to{transform:rotate(360deg)}}
body.uie-cutscene-active #ui-toast-wrap{display:none!important}
body.uie-cutscene-active .uie-window,
body.uie-cutscene-active #reply-menu-panel,
body.uie-cutscene-active #q-visibility-panel,
body.uie-cutscene-active #img-gen-dropdown-panel,
body.uie-cutscene-active #persona-quick-panel,
body.uie-cutscene-active #uie-launcher,
body.uie-cutscene-active #uie-action-wheel,
body.uie-cutscene-active #uie-action-wheel-fab,
body.uie-cutscene-active #vn-ui,
body.uie-cutscene-active #hud,
body.uie-cutscene-active #vn-sprite-layer,
body.uie-cutscene-active #room-hotspot-layer,
body.uie-cutscene-active #room-components-layer,
body.uie-cutscene-active #uie-chrome-restore,
body.uie-cutscene-active #next-beat-container,
body.uie-cutscene-active #main-screen-html-host{visibility:hidden!important;pointer-events:none!important;opacity:0!important}
@media(prefers-reduced-motion:no-preference){#${OVERLAY_ID}.is-open .uie-cutscene-bg{animation:uie-cutscene-drift var(--uie-cutscene-duration,6500ms) ease-in-out both}.uie-cutscene-shot{animation:uie-cutscene-text .7s ease-out both}@keyframes uie-cutscene-drift{from{transform:scale(1.04)}to{transform:scale(1.12)}}@keyframes uie-cutscene-text{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}}
`;
  document.head.appendChild(style);
}

function clean(value, fallback = "") {
  const out = String(value ?? "").trim();
  return out || fallback;
}

function normalizeCutscene(input = {}) {
  if (typeof input === "string") return { title: "Cutscene", body: input };
  const data = input && typeof input === "object" ? input : {};
  return {
    enabled: data.enabled !== false,
    title: clean(data.title, clean(data.label, "Cutscene")),
    body: clean(data.body, clean(data.text, clean(data.description, ""))),
    pov: clean(data.pov, clean(data.camera, "Breakaway")),
    location: clean(data.location || data.toLocation || data.sceneLocation, ""),
    background: clean(data.background || data.backgroundUrl || data.image, ""),
    duration: Math.max(1200, Math.min(120000, Number(data.duration || data.durationMs || DEFAULT_DURATION))),
    persistLocation: data.persistLocation === true || data.movePlayer === true || data.persist === true,
    characters: Array.isArray(data.characters) ? data.characters.map((x) => clean(x)).filter(Boolean).slice(0, 12) : [],
    sprites: Array.isArray(data.sprites) ? data.sprites.slice(0, 12) : [],
    organization: clean(data.organization || "", ""),
    organizations: Array.isArray(data.organizations) ? data.organizations.map((x) => clean(x)).filter(Boolean) : [],
    eventType: clean(data.eventType || data.type || "", ""),
    stakes: clean(data.stakes || "", ""),
    standingDelta: Number.isFinite(Number(data.standingDelta)) ? Number(data.standingDelta) : 0,
    heatDelta: Number.isFinite(Number(data.heatDelta)) ? Number(data.heatDelta) : 0,
    persistAsOrgEvent: data.persistAsOrgEvent === true || data.orgEvent === true,
    aiGenerate: data.aiGenerate === true,
    aiContext: clean(data.aiContext || "", "")
  };
}

function currentLocation(s) {
  return clean(s.currentLocation || s.worldState?.location || s.map?.currentLocation || "");
}

function setLocation(s, location) {
  if (!location) return;
  s.currentLocation = location;
  if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
  s.worldState.location = location;
  if (s.map && typeof s.map === "object") s.map.currentLocation = location;
}

function ensureOverlay() {
  injectStyles();
  let overlay = document.getElementById(OVERLAY_ID);
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = `
    <div class="uie-cutscene-bg"></div>
    <div class="uie-cutscene-vignette"></div>
    <div class="uie-cutscene-sprites"></div>
    <div class="uie-cutscene-shot">
      <div class="uie-cutscene-kicker"></div>
      <div class="uie-cutscene-title"></div>
      <div class="uie-cutscene-body"></div>
      <div class="uie-cutscene-characters"></div>
    </div>
    <div class="uie-cutscene-progress"><div class="uie-cutscene-progress-bar"></div></div>
    <button type="button" class="uie-cutscene-skip" title="Skip cutscene (Esc)" aria-label="Skip cutscene"><i class="fas fa-forward"></i> Skip</button>
  `;
  overlay.querySelector(".uie-cutscene-skip")?.addEventListener("click", () => endCutscene({ skipped: true }));
  document.body.appendChild(overlay);
  return overlay;
}

function showLoadingOverlay(overlay) {
  let loader = overlay.querySelector(".uie-cutscene-loading");
  if (!loader) {
    loader = document.createElement("div");
    loader.className = "uie-cutscene-loading";
    loader.innerHTML = `<div class="uie-cutscene-loading-spinner"></div>`;
    overlay.appendChild(loader);
  }
  loader.style.display = "flex";
}

function hideLoadingOverlay(overlay) {
  const loader = overlay.querySelector(".uie-cutscene-loading");
  if (loader) loader.style.display = "none";
}

function renderCutsceneSprites(overlay, cutscene) {
  const container = overlay.querySelector(".uie-cutscene-sprites");
  if (!container) return;
  container.innerHTML = "";
  const sprites = cutscene.sprites || [];
  const characters = cutscene.characters || [];
  const items = sprites.length ? sprites : characters.map((name) => ({ name: String(name) }));
  if (!items.length) return;
  for (const item of items) {
    const src = typeof item === "string" ? item : (item.src || item.url || item.image || "");
    const name = typeof item === "string" ? "" : String(item.name || item.character || "");
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "position:relative;display:flex;flex-direction:column;align-items:center;";
    if (src) {
      const img = document.createElement("img");
      img.className = "uie-cutscene-sprite";
      img.src = src;
      img.alt = name || "Character";
      img.loading = "eager";
      wrapper.appendChild(img);
      requestAnimationFrame(() => { requestAnimationFrame(() => { img.classList.add("is-visible"); }); });
    }
    if (name) {
      const label = document.createElement("div");
      label.className = "uie-cutscene-sprite-name";
      label.textContent = name;
      wrapper.appendChild(label);
    }
    container.appendChild(wrapper);
  }
}

function renderCutsceneCharacters(overlay, cutscene) {
  const container = overlay.querySelector(".uie-cutscene-characters");
  if (!container) return;
  container.innerHTML = "";
  const characters = cutscene.characters || [];
  if (!characters.length) return;
  for (const name of characters) {
    const tag = document.createElement("span");
    tag.className = "uie-cutscene-char-tag";
    tag.textContent = name;
    container.appendChild(tag);
  }
}

function startProgressBar(overlay, durationMs) {
  const bar = overlay.querySelector(".uie-cutscene-progress-bar");
  if (!bar) return;
  const start = Date.now();
  const tick = () => {
    if (!isActive) return;
    const elapsed = Date.now() - start;
    const pct = Math.min(100, (elapsed / durationMs) * 100);
    bar.style.width = `${pct}%`;
    if (pct < 100) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function publishCutsceneOrganizationIntel(cutscene) {
  if (!cutscene || !cutscene.enabled) return;
  const orgNames = new Set();
  if (cutscene.organization) orgNames.add(cutscene.organization);
  if (Array.isArray(cutscene.organizations)) {
    cutscene.organizations.forEach(org => { if (org) orgNames.add(org); });
  }
  const textToScan = `${cutscene.title || ""} ${cutscene.body || ""}`;
  const detectedOrgs = detectOrganizationNamesInText(textToScan);
  detectedOrgs.forEach(org => orgNames.add(org));
  for (const orgName of orgNames) {
    if (!orgName || orgName.length < 2) continue;
    publishOrganizationIntel({
      source: "cutscene",
      sourceId: `cutscene_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      confidence: 0.75,
      organizationName: orgName,
      text: `${cutscene.title || ""}\n${cutscene.body || ""}`,
      proposedPatch: {
        currentIssues: cutscene.stakes ? [cutscene.stakes] : [],
        activeHooks: cutscene.body ? [cutscene.body.slice(0, 200)] : [],
        standingDelta: cutscene.standingDelta || 0,
        heatDelta: cutscene.heatDelta || 0
      },
      reason: `Organization mentioned in cutscene: ${cutscene.title || "Untitled"}`
    });
  }
}

async function generateAiCutscene(cutscene) {
  if (!isAiCutsceneEnabled()) return null;
  try {
    const { generateContent } = await import("./apiClient.js");
    const s = getSettings();
    const location = cutscene.location || currentLocation(s) || "an unknown location";
    const characters = (cutscene.characters || []).join(", ") || "the scene";
    const context = cutscene.aiContext || cutscene.body || "";
    const prompt = [
      "You are a cinematic cutscene director for an immersive RPG.",
      `Generate a SHORT, vivid cutscene (2-4 sentences) for the following scenario:`,
      `Location: ${location}`,
      `Characters present: ${characters}`,
      context ? `Context: ${context}` : "",
      `Event type: ${cutscene.eventType || "dramatic moment"}`,
      cutscene.stakes ? `Stakes: ${cutscene.stakes}` : "",
      "",
      "Output ONLY the cutscene narration text. No JSON, no tags, no meta-commentary.",
      "Make it cinematic, atmospheric, and immersive. Focus on sensory details and dramatic tension.",
      "Do NOT narrate the player's thoughts. Describe what is seen, heard, and felt in the environment."
    ].filter(Boolean).join("\n");
    const result = await generateContent(prompt, "Cutscene");
    if (typeof result === "string" && result.trim()) {
      return result.trim().slice(0, 800);
    }
    if (result && typeof result === "object" && typeof result.text === "string" && result.text.trim()) {
      return result.text.trim().slice(0, 800);
    }
  } catch (err) {
    console.warn("[UIE Cutscene] AI generation failed:", err);
  }
  return null;
}

function bindEscSkip() {
  if (escHandler) return;
  escHandler = (e) => {
    if (isActive && (e.key === "Escape" || e.keyCode === 27)) {
      e.preventDefault();
      e.stopPropagation();
      endCutscene({ skipped: true });
    }
  };
  document.addEventListener("keydown", escHandler, true);
}

function unbindEscSkip() {
  if (escHandler) {
    document.removeEventListener("keydown", escHandler, true);
    escHandler = null;
  }
}

export function startCutscene(input = {}) {
  if (!isCutsceneEnabled()) return false;
  const cutscene = normalizeCutscene(input);
  if (!cutscene.enabled) return false;
  publishCutsceneOrganizationIntel(cutscene);
  endCutscene({ silent: true, preserveRestore: false });
  const s = getSettings();
  restoreSnapshot = {
    location: currentLocation(s),
    persistLocation: cutscene.persistLocation,
    startedAt: Date.now()
  };
  if (cutscene.location) {
    setLocation(s, cutscene.location);
    saveSettings();
    try { window.dispatchEvent(new CustomEvent("location:changed", { detail: { location: cutscene.location } })); } catch (_) {}
  }
  const overlay = ensureOverlay();
  overlay.style.setProperty("--uie-cutscene-duration", `${cutscene.duration}ms`);
  const bg = overlay.querySelector(".uie-cutscene-bg");
  if (bg) {
    bg.style.backgroundImage = cutscene.background
      ? `linear-gradient(180deg,rgba(0,0,0,.12),rgba(0,0,0,.52)),url("${cutscene.background.replace(/"/g, "%22")}")`
      : "";
  }
  overlay.querySelector(".uie-cutscene-kicker").textContent = [cutscene.pov, cutscene.location].filter(Boolean).join(" - ");
  overlay.querySelector(".uie-cutscene-title").textContent = cutscene.title;
  overlay.querySelector(".uie-cutscene-body").textContent = cutscene.body || (cutscene.characters.length ? `Watching: ${cutscene.characters.join(", ")}` : "");
  renderCutsceneSprites(overlay, cutscene);
  renderCutsceneCharacters(overlay, cutscene);
  isActive = true;
  document.body.classList.add("uie-cutscene-active");
  overlay.classList.add("is-open");
  bindEscSkip();
  startProgressBar(overlay, cutscene.duration);
  activeTimer = window.setTimeout(() => endCutscene(), cutscene.duration);
  try { window.dispatchEvent(new CustomEvent("uie:cutscene:started", { detail: cutscene })); } catch (_) {}
  return true;
}

export async function startAiCutscene(input = {}) {
  if (!isCutsceneEnabled()) return false;
  const cutscene = normalizeCutscene(input);
  if (!cutscene.enabled) return false;
  const overlay = ensureOverlay();
  overlay.querySelector(".uie-cutscene-kicker").textContent = cutscene.pov || "Cinematic";
  overlay.querySelector(".uie-cutscene-title").textContent = cutscene.title || "Cutscene";
  overlay.querySelector(".uie-cutscene-body").textContent = "";
  showLoadingOverlay(overlay);
  isActive = true;
  document.body.classList.add("uie-cutscene-active");
  overlay.classList.add("is-open");
  bindEscSkip();
  const aiBody = await generateAiCutscene(cutscene);
  hideLoadingOverlay(overlay);
  if (!isActive) return false;
  if (aiBody) cutscene.body = aiBody;
  publishCutsceneOrganizationIntel(cutscene);
  const s = getSettings();
  restoreSnapshot = {
    location: currentLocation(s),
    persistLocation: cutscene.persistLocation,
    startedAt: Date.now()
  };
  if (cutscene.location) {
    setLocation(s, cutscene.location);
    saveSettings();
    try { window.dispatchEvent(new CustomEvent("location:changed", { detail: { location: cutscene.location } })); } catch (_) {}
  }
  overlay.style.setProperty("--uie-cutscene-duration", `${cutscene.duration}ms`);
  const bg = overlay.querySelector(".uie-cutscene-bg");
  if (bg) {
    bg.style.backgroundImage = cutscene.background
      ? `linear-gradient(180deg,rgba(0,0,0,.12),rgba(0,0,0,.52)),url("${cutscene.background.replace(/"/g, "%22")}")`
      : "";
  }
  overlay.querySelector(".uie-cutscene-kicker").textContent = [cutscene.pov, cutscene.location].filter(Boolean).join(" - ");
  overlay.querySelector(".uie-cutscene-title").textContent = cutscene.title;
  overlay.querySelector(".uie-cutscene-body").textContent = cutscene.body || "The scene unfolds...";
  renderCutsceneSprites(overlay, cutscene);
  renderCutsceneCharacters(overlay, cutscene);
  startProgressBar(overlay, cutscene.duration);
  activeTimer = window.setTimeout(() => endCutscene(), cutscene.duration);
  try { window.dispatchEvent(new CustomEvent("uie:cutscene:started", { detail: cutscene })); } catch (_) {}
  return true;
}

export function endCutscene({ silent = false, preserveRestore = true, skipped = false } = {}) {
  if (activeTimer) window.clearTimeout(activeTimer);
  activeTimer = null;
  const wasActive = isActive;
  isActive = false;
  const overlay = document.getElementById(OVERLAY_ID);
  overlay?.classList.remove("is-open");
  document.body.classList.remove("uie-cutscene-active");
  unbindEscSkip();
  if (preserveRestore && restoreSnapshot && restoreSnapshot.persistLocation !== true && restoreSnapshot.location) {
    const s = getSettings();
    setLocation(s, restoreSnapshot.location);
    saveSettings();
    try { window.dispatchEvent(new CustomEvent("location:changed", { detail: { location: restoreSnapshot.location } })); } catch (_) {}
  }
  restoreSnapshot = null;
  if (wasActive) {
    try { window.dispatchEvent(new CustomEvent("uie:cutscene:ended", { detail: { skipped } })); } catch (_) {}
  }
  if (!silent) notify("info", skipped ? "Cutscene skipped." : "Cutscene ended.", "Cutscene");
}

export function runCutscenes(items = []) {
  if (!isCutsceneEnabled()) return false;
  const list = (Array.isArray(items) ? items : [items]).map(normalizeCutscene).filter((item) => item.enabled);
  if (!list.length) return false;
  let index = 0;
  const playNext = () => {
    const item = list[index++];
    if (!item) return;
    if (item.aiGenerate) {
      startAiCutscene(item);
    } else {
      startCutscene(item);
    }
    window.setTimeout(() => {
      if (index < list.length && isActive === false) playNext();
    }, item.duration + 200);
  };
  playNext();
  return true;
}

export function isCutsceneActive() {
  return isActive;
}

export function initCutscenes() {
  injectStyles();
  window.UIECutscenes = {
    start: startCutscene,
    startAi: startAiCutscene,
    end: endCutscene,
    run: runCutscenes,
    isActive: isCutsceneActive,
    trigger: (data) => {
      window.dispatchEvent(new CustomEvent("uie:cutscene", { detail: data }));
    }
  };
  window.addEventListener("uie:cutscene", (event) => {
    const detail = event?.detail || {};
    if (detail.aiGenerate) {
      startAiCutscene(detail);
    } else {
      startCutscene(detail);
    }
  });
}
