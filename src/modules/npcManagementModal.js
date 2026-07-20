import { getSettings, saveSettings } from "./core.js";
import {
  VoiceBridge,
  createDefaultPocketVoiceRecipe,
  createKokoroVoiceRecipe,
  createKokoroStudioVoiceRecipe,
  createPocketVoiceRecipe,
  createRandomPocketVoiceRecipe,
  KOKORO_LANGUAGE_OPTIONS,
  KOKORO_PRESET_VOICES,
  POCKET_PRESET_VOICES
} from "./voiceBridge.js";
import { createNpc } from "./backendBridge.js";
import { publishOrganizationIntel } from "./organizationIntelBus.js";
import {
    SECRET_CATEGORIES,
    normalizeNpcSecrets,
    normalizeSimpleSecret,
    normalizeObjectSecret,
    sanitizeNpcForPlayer,
    buildPrivateNpcContext,
    buildNpcKnowledgeContext,
    cleanOrphanedReferences
} from "./secretsEngine.js";

const DEFAULT_VOICES = ["pocket-reference"];


const DEFAULT_ARCHETYPES = {
  none: "",
  male: createDefaultPocketVoiceRecipe("Pocket male reference"),
  female: createDefaultPocketVoiceRecipe("Pocket female reference"),
  child: createDefaultPocketVoiceRecipe("Pocket child reference"),
  projected: createDefaultPocketVoiceRecipe("Pocket projected reference")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const state = {
  voices: [...DEFAULT_VOICES],
  archetypes: { ...DEFAULT_ARCHETYPES },
  activeAudio: null,
  voiceBridge: null,
  hydrated: false,
  testing: false,
  saving: false,
  expressions: [],
  currentNpcId: "",
  currentCardId: "",
  currentCreatedAt: "",
  currentNpcSecrets: [],
  currentNpcPrivateIntel: [],
  secretsRevealed: false,
  includeHiddenSecretsInDebug: false
};

function splitList(value) {
  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function getModal() {
  return document.getElementById("uie-npc-management-modal");
}

function getField(id) {
  return document.getElementById(id);
}

function selectedRatio() {
  return Math.max(0, Math.min(1, Number(getField("uie-npc-voice-ratio")?.value || 50) / 100));
}

function currentCustomRecipe() {
  const provider = String(getField("uie-npc-voice-provider")?.value || "pocket").toLowerCase();
  if (provider === "none") return "";
  const speed = Number(getField("uie-npc-voice-speed")?.value || 1);
  const pitch = Number(getField("uie-npc-voice-pitch")?.value || 1);
  if (provider === "kokoro") {
    const kokoroVoice = getField("uie-npc-kokoro-voice")?.value || "af_heart";
    const gender = Number(getField("uie-npc-voice-gender-blend")?.value ?? 0.5);
    const vibe = Number(getField("uie-npc-voice-vibe-blend")?.value ?? 0.5);
    if (kokoroVoice === "custom") {
      return createKokoroStudioVoiceRecipe({
        genderBlend: gender,
        vibeBlend: vibe,
        speed,
        pitch,
        label: getField("uie-npc-f5-label")?.value || "Kokoro Studio Voice"
      });
    }
    return createKokoroVoiceRecipe({
      voice: kokoroVoice,
      label: getField("uie-npc-f5-label")?.value || "Kokoro Voice",
      language: getField("uie-npc-kokoro-language")?.value || "english",
      speed,
      pitch
    });
  }
  return createPocketVoiceRecipe({
    refAudioUrl: getField("uie-npc-f5-reference")?.value || "",
    refText: getField("uie-npc-f5-ref-text")?.value || "",
    label: getField("uie-npc-f5-label")?.value || "Pocket Reference Voice",
    fallbackVoice: getField("uie-npc-pocket-fallback-voice")?.value || "alba",
    speed,
    pitch,
    warmth: Number(getField("uie-npc-voice-warmth")?.value || 0.5),
    clarity: Number(getField("uie-npc-voice-clarity")?.value || 0.5)
  });
}

function recipeFromBlend(blend = {}) {
  if (typeof blend === "string" && blend.startsWith("pocket-tts-v1|")) return blend;
  return createPocketVoiceRecipe({
    refAudioUrl: blend?.refAudioUrl || blend?.referenceAudioUrl || blend?.voiceRef || blend?.reference || "",
    refText: blend?.refText || blend?.referenceText || blend?.transcript || "",
    label: blend?.label || blend?.name || "Pocket Reference Voice"
  });
}

function currentVoiceRecipe() {
  const key = String(getField("uie-npc-archetype")?.value || "none");
  if (key === "none") return "";
  if (key !== "custom" && state.archetypes[key]) return state.archetypes[key];
  return currentCustomRecipe();
}

function setStatus(message, tone = "neutral") {
  const el = getField("uie-npc-modal-status");
  if (!el) return;
  el.textContent = message || "";
  el.dataset.tone = tone;
}

function setBusy(testing = state.testing, saving = state.saving) {
  state.testing = testing;
  state.saving = saving;
  const test = getField("uie-npc-test-voice");
  const save = getField("uie-npc-save");
  if (test) test.disabled = testing || saving;
  if (save) save.disabled = testing || saving;
}

function getVoiceBridge() {
  if (!state.voiceBridge) state.voiceBridge = new VoiceBridge();
  return state.voiceBridge;
}

function renderVoiceOptions(selected = "") {
  return state.voices
    .map((voice) => `<option value="${escapeHtml(voice)}"${voice === selected ? " selected" : ""}>${escapeHtml(voice)}</option>`)
    .join("");
}

function splitSchedule(value) {
  return String(value || "")
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 32);
}

function shouldAutoLockNpc(payload = {}) {
  const mode = String(payload.lockMode || "auto").toLowerCase();
  if (mode === "locked") return true;
  if (mode === "unlocked") return false;
  const haystack = [
    payload.name,
    payload.role,
    payload.title,
    payload.bio,
    payload.appearance,
    payload.personality,
    payload.location
  ].join(" ").toLowerCase();
  if (/\b(store owner|shopkeeper|vendor|merchant|guard|gatekeeper|receptionist|clerk|innkeeper|bartender|teacher|monster|barrier|sentinel|warden|boss|station master)\b/.test(haystack)) return true;
  if (/\b(passing|background|crowd|bystander|unnamed|random|incidental|does not matter|minor)\b/.test(haystack)) return true;
  if (Array.isArray(payload.schedules) && payload.schedules.length) return true;
  return false;
}

function syncMixerFromRecipe(recipe) {
  if (!String(recipe || "").trim()) {
    if (getField("uie-npc-voice-provider")) getField("uie-npc-voice-provider").value = "none";
    if (getField("uie-npc-archetype")) getField("uie-npc-archetype").value = "none";
    updateMixerLabel();
    return;
  }
  const parsed = getVoiceBridge().parseStudioRecipe(recipe);
  if (getField("uie-npc-voice-provider")) getField("uie-npc-voice-provider").value = parsed.engine || "pocket";
  if (getField("uie-npc-pocket-fallback-voice")) getField("uie-npc-pocket-fallback-voice").value = parsed.fallbackVoice || parsed.voice || "alba";
  if (parsed.isStudio) {
    if (getField("uie-npc-kokoro-voice")) getField("uie-npc-kokoro-voice").value = "custom";
  } else {
    if (getField("uie-npc-kokoro-voice")) getField("uie-npc-kokoro-voice").value = parsed.voice || "af_heart";
  }
  if (getField("uie-npc-voice-gender-blend")) getField("uie-npc-voice-gender-blend").value = parsed.genderBlend ?? 0.5;
  if (getField("uie-npc-voice-vibe-blend")) getField("uie-npc-voice-vibe-blend").value = parsed.vibeBlend ?? 0.5;
  if (getField("uie-npc-kokoro-language")) getField("uie-npc-kokoro-language").value = parsed.language || "english";
  if (getField("uie-npc-voice-speed")) getField("uie-npc-voice-speed").value = parsed.speed || 1;
  if (getField("uie-npc-voice-pitch")) getField("uie-npc-voice-pitch").value = parsed.pitch || 1;
  if (getField("uie-npc-voice-warmth")) getField("uie-npc-voice-warmth").value = parsed.warmth ?? 0.5;
  if (getField("uie-npc-voice-clarity")) getField("uie-npc-voice-clarity").value = parsed.clarity ?? 0.5;
  if (getField("uie-npc-f5-reference")) getField("uie-npc-f5-reference").value = parsed.refAudioUrl || "";
  if (getField("uie-npc-f5-reference-label")) getField("uie-npc-f5-reference-label").textContent = parsed.refAudioUrl ? "Reference audio selected." : "No reference audio selected.";
  if (getField("uie-npc-f5-ref-text")) getField("uie-npc-f5-ref-text").value = parsed.refText || "";
  if (getField("uie-npc-f5-label")) getField("uie-npc-f5-label").value = parsed.label || "Pocket Reference Voice";
  updateMixerLabel();
}

function updateMixerLabel() {
  const hidden = getField("uie-npc-voice-recipe");
  if (hidden) hidden.value = currentCustomRecipe();
  const label = getField("uie-npc-f5-summary");
  const ref = String(getField("uie-npc-f5-reference")?.value || "").trim();
  const provider = String(getField("uie-npc-voice-provider")?.value || "pocket").toLowerCase();
  const kokoroVoice = String(getField("uie-npc-kokoro-voice")?.value || "af_heart");
  if (provider === "none") {
    document.querySelectorAll("#uie-npc-management-modal .uie-npc-pocket-panel, #uie-npc-management-modal .uie-npc-kokoro-panel, #uie-npc-management-modal .uie-npc-kokoro-studio-panel").forEach((el) => { el.style.display = "none"; });
    if (hidden) hidden.value = "";
    if (label) label.textContent = "No voice selected for this NPC.";
    return;
  }
  
  document.querySelectorAll("#uie-npc-management-modal .uie-npc-pocket-panel").forEach((el) => { el.style.display = provider === "kokoro" ? "none" : ""; });
  document.querySelectorAll("#uie-npc-management-modal .uie-npc-kokoro-panel").forEach((el) => { el.style.display = provider === "kokoro" ? "" : "none"; });
  document.querySelectorAll("#uie-npc-management-modal .uie-npc-kokoro-studio-panel").forEach((el) => { el.style.display = (provider === "kokoro" && kokoroVoice === "custom") ? "" : "none"; });
  
  if (label) label.textContent = provider === "kokoro"
    ? "Kokoro voice selected for this NPC."
    : (ref ? "Pocket reference voice ready for this NPC." : "Add a 10-second reference audio URL or file path before previewing.");
}

function savedNpcVoices() {
  const s = getSettings() || {};
  s.audio = s.audio && typeof s.audio === "object" ? s.audio : {};
  if (!Array.isArray(s.audio.savedVoices)) s.audio.savedVoices = [];
  return s.audio.savedVoices;
}

function renderNpcSavedVoiceOptions(selected = "") {
  const select = getField("uie-npc-saved-voice");
  if (!select) return;
  select.innerHTML = `<option value="">Saved voices...</option>${savedNpcVoices().map((voice) => {
    const id = escapeHtml(voice?.id || "");
    const name = escapeHtml(voice?.name || voice?.id || "Saved Voice");
    const provider = escapeHtml(voice?.provider || "pocket");
    return `<option value="${id}"${String(selected) === String(voice?.id || "") ? " selected" : ""}>${name} (${provider})</option>`;
  }).join("")}`;
}

function recipeFromSavedVoice(item = {}) {
  const provider = String(item.provider || "pocket").toLowerCase();
  if (provider === "kokoro") {
    if (item.voiceRecipe && item.voiceRecipe.startsWith("kokoro-studio-v1")) {
      return item.voiceRecipe;
    }
    if (item.isStudio || item.genderBlend !== undefined || item.vibeBlend !== undefined) {
      return createKokoroStudioVoiceRecipe({
        genderBlend: item.genderBlend,
        vibeBlend: item.vibeBlend,
        speed: item.speed || 1,
        pitch: item.pitch || 1,
        label: item.name || "Kokoro Studio Voice"
      });
    }
    return createKokoroVoiceRecipe({
      voice: item.voice || "af_heart",
      language: item.language || "english",
      speed: item.speed || 1,
      pitch: item.pitch || 1,
      label: item.name || "Kokoro Voice"
    });
  }
  return createPocketVoiceRecipe({
    refAudioUrl: item.reference || item.referenceAudioUrl || item.reference_audio_url || "",
    refText: item.referenceText || item.refText || item.reference_text || "",
    label: item.name || "Pocket Reference Voice",
    language: item.language || "english",
    fallbackVoice: item.voice || item.fallbackVoice || "alba",
    speed: item.speed || 1,
    pitch: item.pitch || 1,
    warmth: item.warmth ?? 0.5,
    clarity: item.clarity ?? 0.5
  });
}

function injectStyles() {
  if (document.getElementById("uie-npc-management-style")) return;
  const style = document.createElement("style");
  style.id = "uie-npc-management-style";
  style.textContent = `
#uie-npc-management-modal{position:fixed;inset:0;z-index:2147483646;display:none;align-items:center;justify-content:center;background:rgba(57,34,20,.34);color:#392214;font-family:inherit;}
#uie-npc-management-modal.is-open{display:flex;}
.uie-npc-panel{width:min(760px,94vw);max-height:92vh;overflow:auto;background:#fff8ed;border:1px solid rgba(151,91,39,.42);border-radius:8px;box-shadow:0 20px 80px rgba(57,34,20,.28);}
.uie-npc-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(151,91,39,.2);background:#f3d7b5;}
.uie-npc-title{font-weight:900;font-size:18px;color:#3a2211;line-height:1.2;}
.uie-npc-close{margin-left:auto;width:34px;height:34px;border:1px solid rgba(122,74,32,.5);border-radius:6px;background:#c9853d;color:#fffdf9;cursor:pointer;}
.uie-npc-form{padding:16px;display:grid;gap:14px;}
.uie-npc-tabs{display:flex;gap:8px;flex-wrap:wrap;padding:10px 16px 0;background:#fff8ed;}
.uie-npc-tab{height:34px;border-radius:999px;border:1px solid rgba(151,91,39,.35);background:#fff4e3;color:#5c3a21;font-weight:900;padding:0 13px;cursor:pointer;}
.uie-npc-tab.active{background:#c9853d;color:#fffdf9;border-color:rgba(122,74,32,.55);}
.uie-npc-tab-panel{display:none;gap:14px;}
.uie-npc-tab-panel.active{display:grid;}
.uie-npc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.uie-npc-field{display:grid;gap:6px;min-width:0;}
.uie-npc-field label{font-size:12px;font-weight:800;color:#5c3a21;}
.uie-npc-panel input,
.uie-npc-panel select,
.uie-npc-panel textarea,
.uie-npc-roster input,
.uie-npc-roster select,
.uie-npc-roster textarea {
    background: #f7ebd9 !important;
    color: #4a2810 !important;
    border: 1.5px solid #c9853d !important;
}
.uie-npc-field input,.uie-npc-field select,.uie-npc-field textarea{width:100%;box-sizing:border-box;border:1px solid #c9853d !important;border-radius:6px;background:#f7ebd9 !important;color:#4a2810 !important;padding:9px 10px;font:inherit;}
.uie-npc-field textarea{min-height:82px;resize:vertical;}
.uie-npc-mixer{display:grid;gap:10px;border:1px solid rgba(151,91,39,.26);border-radius:8px;padding:12px;background:#fff1db;}
.uie-npc-slider-row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;}
.uie-npc-slider-row input[type=range]{width:100%;}
.uie-npc-slider-row strong{min-width:86px;text-align:right;font-size:12px;color:#5c3a21;}
.uie-npc-roster{width:min(920px,94vw);max-height:88vh;overflow:auto;background:#fff8ed;border:1px solid rgba(151,91,39,.42);border-radius:8px;box-shadow:0 20px 80px rgba(57,34,20,.28);}
.uie-npc-roster-body{padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;}
.uie-npc-card{border:1px solid rgba(151,91,39,.32);border-radius:8px;background:#fffdf7;padding:12px;display:grid;gap:7px;color:#392214;}
.uie-npc-card strong{font-size:14px;color:#2f1a0e;}
.uie-npc-card span{font-size:12px;color:#80512d;}
.uie-npc-lock-pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:900;color:#744210;background:#fff1db;border:1px solid rgba(151,91,39,.26);border-radius:999px;padding:3px 7px;width:max-content;}
.uie-npc-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;}
.uie-npc-btn{height:38px;border-radius:6px;border:1px solid rgba(122,74,32,.55);background:#c9853d;color:#fffdf9;font-weight:900;padding:0 14px;cursor:pointer;}
.uie-npc-btn.secondary{border-color:rgba(151,91,39,.35);background:#fff4e3;color:#5c3a21;}
.uie-npc-btn:disabled{opacity:.55;cursor:wait;}
#uie-npc-modal-status{min-height:18px;font-size:12px;color:#80512d;}
#uie-npc-modal-status[data-tone=error]{color:#b42318;}
#uie-npc-modal-status[data-tone=success]{color:#166534;}
@media (min-width:99999px){
  #uie-npc-management-modal{align-items:flex-start;overflow:auto;padding:8px;}
  .uie-npc-grid{grid-template-columns:1fr}
  .uie-npc-panel{width:calc(100vw - 16px);max-height:calc(100dvh - 16px);border-radius:8px;}
  .uie-npc-head{padding:10px 12px;min-height:48px;}
  .uie-npc-title{font-size:16px;}
  .uie-npc-form{padding:12px;gap:10px;}
  .uie-npc-tabs{padding:8px 12px 0;gap:6px;}
  .uie-npc-tab{flex:1;min-width:92px;height:32px;padding:0 8px;}
  .uie-npc-mixer{padding:10px;gap:8px;}
  .uie-npc-field textarea{min-height:64px;}
  .uie-npc-actions{justify-content:stretch;gap:8px}
  .uie-npc-btn{flex:1;min-width:120px;height:34px;padding:0 10px}
  .uie-npc-roster{width:calc(100vw - 16px);max-height:calc(100dvh - 16px);border-radius:8px;}
  .uie-npc-roster-body{grid-template-columns:1fr;padding:10px;}
}
`;
  document.head.appendChild(style);
}

function ensureModal() {
  injectStyles();
  let modal = getModal();
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "uie-npc-management-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <div class="uie-npc-panel">
      <div class="uie-npc-head">
        <div class="uie-npc-title">NPC Management</div>
        <button type="button" class="uie-npc-close" id="uie-npc-close" title="Close" aria-label="Close"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="uie-npc-tabs" role="tablist" aria-label="NPC editor sections">
        <button type="button" class="uie-npc-tab active" data-npc-tab="profile">Profile</button>
        <button type="button" class="uie-npc-tab" data-npc-tab="psychology">Psychology</button>
        <button type="button" class="uie-npc-tab" data-npc-tab="secrets">Secrets</button>
        <button type="button" class="uie-npc-tab" data-npc-tab="voice">Voice Studio</button>
        <button type="button" class="uie-npc-tab" data-npc-tab="media">Portraits</button>
      </div>
      <form class="uie-npc-form" id="uie-npc-form">
        <section class="uie-npc-tab-panel active" data-npc-panel="profile">
        <div class="uie-npc-grid">
          <div class="uie-npc-field">
            <label for="uie-npc-name">Name</label>
            <input id="uie-npc-name" name="name" maxlength="120" required autocomplete="off">
          </div>
          <div class="uie-npc-field">
            <label for="uie-npc-role">Role</label>
            <input id="uie-npc-role" name="role" maxlength="120" value="NPC" autocomplete="off">
          </div>
        </div>
        <div class="uie-npc-grid">
          <div class="uie-npc-field">
            <label for="uie-npc-title">Title</label>
            <input id="uie-npc-title" name="title" maxlength="160" autocomplete="off" placeholder="Store owner, barrier guardian, rumor broker">
          </div>
          <div class="uie-npc-field">
            <label for="uie-npc-age">Age</label>
            <input id="uie-npc-age" name="age" type="number" min="0" max="999" autocomplete="off">
          </div>
        </div>
        <div class="uie-npc-field">
          <label for="uie-npc-location">Map Location</label>
          <div style="display: flex; gap: 8px; align-items: center; width: 100%;">
            <select id="uie-npc-location" name="location" style="flex: 1;"></select>
            <button type="button" id="uie-npc-add-loc-btn" class="uie-npc-btn secondary" style="height: 38px; padding: 0 10px; font-size: 13px; font-weight: 800; white-space: nowrap; flex: 0 0 auto;">+ Add</button>
          </div>
        </div>
        <div class="uie-npc-field">
          <label for="uie-npc-appearance">Appearance</label>
          <textarea id="uie-npc-appearance" name="appearance"></textarea>
        </div>
        <div class="uie-npc-grid">
          <div class="uie-npc-field">
            <label for="uie-npc-affiliations">Organization Affiliations</label>
            <textarea id="uie-npc-affiliations" name="affiliations" placeholder="Guild, shop, academy club"></textarea>
          </div>
          <div class="uie-npc-field">
            <label for="uie-npc-rumors">Rumors</label>
            <textarea id="uie-npc-rumors" name="rumors" placeholder="What people say about them"></textarea>
          </div>
        </div>
        <div class="uie-npc-field">
          <label for="uie-npc-bio">Bio</label>
          <textarea id="uie-npc-bio" name="bio"></textarea>
        </div>
        <div class="uie-npc-grid">
          <div class="uie-npc-field">
            <label for="uie-npc-schedule">Schedules</label>
            <textarea id="uie-npc-schedule" name="schedule" placeholder="09:00: Opens the shop @ Market Street"></textarea>
          </div>
          <div class="uie-npc-field">
            <label for="uie-npc-lock-mode">Placement Lock</label>
            <select id="uie-npc-lock-mode">
              <option value="auto" selected>Auto lock if incidental</option>
              <option value="locked">Locked in place</option>
              <option value="unlocked">Unlocked / migrates by story</option>
            </select>
          </div>
        </div>
        </section>
        
        <section class="uie-npc-tab-panel" data-npc-panel="psychology">
          <div class="uie-npc-field">
            <label for="uie-npc-personality">Personality</label>
            <textarea id="uie-npc-personality" name="personality"></textarea>
          </div>
          <div class="uie-npc-grid">
            <div class="uie-npc-field">
              <label for="uie-npc-likes">Likes</label>
              <textarea id="uie-npc-likes" name="likes"></textarea>
            </div>
            <div class="uie-npc-field">
              <label for="uie-npc-dislikes">Dislikes</label>
              <textarea id="uie-npc-dislikes" name="dislikes"></textarea>
            </div>
          </div>
          <div class="uie-npc-grid">
            <div class="uie-npc-field">
              <label for="uie-npc-wants">Desires / Goals (wants)</label>
              <textarea id="uie-npc-wants" name="wants" placeholder="What the NPC desires/wants..."></textarea>
            </div>
            <div class="uie-npc-field">
              <label for="uie-npc-needs">Biological / Psychological Needs</label>
              <textarea id="uie-npc-needs" name="needs" placeholder="e.g. hunger: 0.2, energy: 0.82, social: 0.48..."></textarea>
            </div>
          </div>
        </section>
        
        <section class="uie-npc-tab-panel" data-npc-panel="secrets">
          <div id="uie-npc-secrets-container" style="padding: 10px; display: flex; flex-direction: column; gap: 15px;"></div>
        </section>
        <section class="uie-npc-tab-panel" data-npc-panel="voice">
        <div class="uie-npc-field">
          <label for="uie-npc-archetype">Voice Archetype</label>
          <select id="uie-npc-archetype">
            <option value="none">None</option>
            <option value="male">Pocket male reference</option>
            <option value="female">Pocket female reference</option>
            <option value="child">Pocket child reference</option>
            <option value="projected">Pocket projected reference</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div class="uie-npc-mixer">
          <div class="uie-npc-grid">
            <div class="uie-npc-field">
              <label for="uie-npc-voice-provider">Voice Utility</label>
              <select id="uie-npc-voice-provider">
                <option value="none" selected>None</option>
                <option value="pocket">Pocket-TTS</option>
                <option value="kokoro">Kokoro</option>
              </select>
            </div>
            <div class="uie-npc-field uie-npc-pocket-panel">
              <label for="uie-npc-saved-voice">Saved Voice</label>
              <select id="uie-npc-saved-voice"></select>
            </div>
          </div>
          <div class="uie-npc-field uie-npc-pocket-panel">
            <label for="uie-npc-f5-label">Pocket TTS Reference Label</label>
            <input id="uie-npc-f5-label" value="Pocket Reference Voice">
          </div>
          <div class="uie-npc-grid">
            <div class="uie-npc-field uie-npc-pocket-panel">
              <label for="uie-npc-pocket-fallback-voice">Pocket Fallback Voice</label>
              <select id="uie-npc-pocket-fallback-voice">
                <option value="">None</option>
                ${POCKET_PRESET_VOICES.map((voice) => `<option value="${escapeHtml(voice)}"${voice === "alba" ? " selected" : ""}>${escapeHtml(voice)}</option>`).join("")}
              </select>
            </div>
            <div class="uie-npc-field uie-npc-kokoro-panel">
              <label for="uie-npc-kokoro-voice">Kokoro Voice</label>
              <select id="uie-npc-kokoro-voice">
                <option value="">None</option>
                <option value="custom">Custom Blend (Studio)</option>
                ${KOKORO_PRESET_VOICES.map((voice) => `<option value="${escapeHtml(voice)}"${voice === "af_heart" ? " selected" : ""}>${escapeHtml(voice)}</option>`).join("")}
              </select>
            </div>
            <div class="uie-npc-field uie-npc-kokoro-panel">
              <label for="uie-npc-kokoro-language">Kokoro / WASM Language</label>
              <select id="uie-npc-kokoro-language">
                ${KOKORO_LANGUAGE_OPTIONS.map((lang) => `<option value="${escapeHtml(lang.value)}"${lang.value === "english" ? " selected" : ""}>${escapeHtml(lang.label)}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="uie-npc-grid uie-npc-kokoro-panel uie-npc-kokoro-studio-panel" style="display:none;">
            <div class="uie-npc-field"><label for="uie-npc-voice-gender-blend">Gender (Masc vs Fem)</label><input id="uie-npc-voice-gender-blend" type="range" min="0" max="1" step="0.01" value="0.5"></div>
            <div class="uie-npc-field"><label for="uie-npc-voice-vibe-blend">Vibe (Calm vs Energetic)</label><input id="uie-npc-voice-vibe-blend" type="range" min="0" max="1" step="0.01" value="0.5"></div>
          </div>
          <div class="uie-npc-grid uie-npc-pocket-panel">
            <div class="uie-npc-field">
              <label for="uie-npc-f5-reference-file">Reference Audio</label>
              <input id="uie-npc-f5-reference" type="hidden">
              <input id="uie-npc-f5-reference-file" type="file" accept=".wav,.mp3,audio/wav,audio/x-wav,audio/mpeg,audio/mp3">
              <small id="uie-npc-f5-reference-label" style="font-size:11px; opacity:.7;">No reference audio selected.</small>
            </div>
            <div class="uie-npc-field">
              <label for="uie-npc-f5-ref-text">Reference Transcript</label>
              <input id="uie-npc-f5-ref-text" placeholder="Exact words spoken in the reference audio">
            </div>
          </div>
          <div class="uie-npc-grid">
            <div class="uie-npc-field"><label for="uie-npc-voice-pitch">Pitch</label><input id="uie-npc-voice-pitch" type="range" min="0.75" max="1.35" step="0.01" value="1"></div>
            <div class="uie-npc-field"><label for="uie-npc-voice-speed">Speed</label><input id="uie-npc-voice-speed" type="range" min="0.7" max="1.4" step="0.01" value="1"></div>
            <div class="uie-npc-field uie-npc-pocket-panel"><label for="uie-npc-voice-warmth">Warmth</label><input id="uie-npc-voice-warmth" type="range" min="0" max="1" step="0.01" value="0.5"></div>
            <div class="uie-npc-field uie-npc-pocket-panel"><label for="uie-npc-voice-clarity">Clarity</label><input id="uie-npc-voice-clarity" type="range" min="0" max="1" step="0.01" value="0.5"></div>
          </div>
          <p id="uie-npc-f5-summary" style="font-size:11px; opacity:.72; margin:0;">Add a 10-second reference audio URL or file path before previewing.</p>
          <input id="uie-npc-voice-ratio" type="hidden" value="50">
          <input id="uie-npc-voice-recipe" type="hidden" value="">
        </div>
        <div class="uie-npc-actions">
          <button type="button" class="uie-npc-btn secondary" id="uie-npc-test-voice"><i class="fas fa-volume-high"></i> Test Voice</button>
          <button type="button" class="uie-npc-btn secondary" id="uie-npc-random-voice"><i class="fas fa-shuffle"></i> Generate Random Voice</button>
          <button type="button" class="uie-npc-btn secondary" id="uie-npc-save-voice"><i class="fas fa-floppy-disk"></i> Save Voice</button>
          <button type="button" class="uie-npc-btn secondary" id="uie-npc-delete-voice"><i class="fas fa-trash"></i> Delete Voice</button>
        </div>
        </section>
        <section class="uie-npc-tab-panel" data-npc-panel="media">
        <!-- Portrait & Expressions Section -->
        <div style="border: 1px solid rgba(255,255,255,.11); border-radius: 8px; padding: 12px; background: rgba(255,255,255,.035); display: flex; flex-direction: column; gap: 12px;">
          <div class="uie-npc-field">
            <label>Avatar Portrait Image</label>
            <div style="display: flex; gap: 10px; align-items: center;">
              <button type="button" class="uie-npc-btn secondary" id="uie-npc-avatar-btn" style="height: 32px; padding: 0 10px; font-size: 12px;"><i class="fas fa-image"></i> Pick Avatar</button>
              <button type="button" class="uie-npc-btn secondary" id="uie-npc-avatar-clear" style="height: 32px; padding: 0 10px; font-size: 12px; color: #ff9aa2; border-color: rgba(255,154,162,0.3); background: rgba(255,154,162,0.1);">Clear</button>
              <div id="uie-npc-avatar-preview" style="width: 40px; height: 40px; border-radius: 6px; border: 1px solid rgba(225,193,122,0.25); display: none; background-size: cover; background-position: center; background-color: rgba(0,0,0,0.5);"></div>
            </div>
            <input type="file" id="uie-npc-avatar-file" accept="image/*" style="display: none;">
            <input type="hidden" id="uie-npc-avatar-url">
          </div>

          <div class="uie-npc-field">
            <label>Sprites & Expressions</label>
            <div id="uie-npc-sprites-list" style="display: flex; flex-direction: column; gap: 6px; max-height: 150px; overflow-y: auto; margin-bottom: 8px;"></div>
            <div style="display: flex; gap: 8px;">
              <input type="text" id="uie-npc-sprite-label" placeholder="Expression, e.g. Happy" style="flex: 1; height: 32px; padding: 0 10px; background: #fffdf7; border: 1px solid rgba(151,91,39,.42); border-radius: 6px; color: #392214;">
              <button type="button" class="uie-npc-btn" id="uie-npc-add-sprite-btn" style="height: 32px; padding: 0 10px; font-size: 12px;"><i class="fas fa-plus"></i> Add Sprite</button>
            </div>
            <input type="file" id="uie-npc-sprite-file" accept="image/*" style="display: none;">
          </div>
        </div>
        </section>
        <div id="uie-npc-modal-status" aria-live="polite"></div>
        <div class="uie-npc-actions">
          <button type="submit" class="uie-npc-btn" id="uie-npc-save"><i class="fas fa-floppy-disk"></i> Save NPC</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  bindModalEvents(modal);
  renderNpcSavedVoiceOptions("");
  updateMixerLabel();
  return modal;
}

function bindModalEvents(modal) {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeNPCManagementModal();
  });
  modal.querySelectorAll("[data-npc-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const key = tab.getAttribute("data-npc-tab") || "profile";
      modal.querySelectorAll("[data-npc-tab]").forEach((btn) => btn.classList.toggle("active", btn === tab));
      modal.querySelectorAll("[data-npc-panel]").forEach((panel) => panel.classList.toggle("active", panel.getAttribute("data-npc-panel") === key));
    });
  });
  getField("uie-npc-close")?.addEventListener("click", closeNPCManagementModal);
  getField("uie-npc-add-loc-btn")?.addEventListener("click", () => {
    const newLoc = prompt("Enter name of new location to add to the map:");
    if (newLoc && newLoc.trim()) {
      const locName = newLoc.trim();
      const s = getSettings() || {};
      if (!s.worldState) s.worldState = {};
      if (!s.worldState.mapNodes) s.worldState.mapNodes = {};
      if (!s.worldState.mapNodes[locName]) {
        s.worldState.mapNodes[locName] = {
          name: locName,
          type: "area",
          exits: {},
          description: "A newly discovered location."
        };
        saveSettings();
      }
      populateLocationsDropdown(locName);
    }
  });
  getField("uie-npc-archetype")?.addEventListener("change", () => {
    const key = getField("uie-npc-archetype")?.value || "female";
    if (key !== "custom" && state.archetypes[key]) syncMixerFromRecipe(state.archetypes[key]);
    updateMixerLabel();
  });
  ["uie-npc-f5-label", "uie-npc-f5-reference", "uie-npc-f5-ref-text", "uie-npc-voice-provider", "uie-npc-pocket-fallback-voice", "uie-npc-kokoro-voice", "uie-npc-kokoro-language", "uie-npc-voice-pitch", "uie-npc-voice-speed", "uie-npc-voice-warmth", "uie-npc-voice-clarity", "uie-npc-voice-gender-blend", "uie-npc-voice-vibe-blend"].forEach((id) => {
    getField(id)?.addEventListener("input", () => {
      const quick = getField("uie-npc-archetype");
      if (quick) quick.value = "custom";
      updateMixerLabel();
    });
    getField(id)?.addEventListener("change", () => {
      const quick = getField("uie-npc-archetype");
      if (quick) quick.value = "custom";
      updateMixerLabel();
    });
  });
  getField("uie-npc-kokoro-voice")?.addEventListener("change", function() {
    const val = this.value;
    if (val === "am_adam") {
      const g = getField("uie-npc-voice-gender-blend"); if (g) g.value = 0;
      const v = getField("uie-npc-voice-vibe-blend"); if (v) v.value = 0;
    } else if (val === "af_heart") {
      const g = getField("uie-npc-voice-gender-blend"); if (g) g.value = 1;
      const v = getField("uie-npc-voice-vibe-blend"); if (v) v.value = 0.3;
    } else if (val === "af_sky") {
      const g = getField("uie-npc-voice-gender-blend"); if (g) g.value = 1;
      const v = getField("uie-npc-voice-vibe-blend"); if (v) v.value = 0;
    } else if (val === "af_bella") {
      const g = getField("uie-npc-voice-gender-blend"); if (g) g.value = 1;
      const v = getField("uie-npc-voice-vibe-blend"); if (v) v.value = 1;
    }
    updateMixerLabel();
  });
  ["uie-npc-voice-gender-blend", "uie-npc-voice-vibe-blend"].forEach((id) => {
    getField(id)?.addEventListener("input", () => {
      const kv = getField("uie-npc-kokoro-voice");
      if (kv) kv.value = "custom";
      updateMixerLabel();
    });
    getField(id)?.addEventListener("change", () => {
      const kv = getField("uie-npc-kokoro-voice");
      if (kv) kv.value = "custom";
      updateMixerLabel();
    });
  });
  getField("uie-npc-test-voice")?.addEventListener("click", () => {
    void testCurrentVoice();
  });
  getField("uie-npc-saved-voice")?.addEventListener("change", () => {
    const item = savedNpcVoices().find((voice) => String(voice?.id || "") === String(getField("uie-npc-saved-voice")?.value || ""));
    if (!item) return;
    syncMixerFromRecipe(String(item.voiceRecipe || recipeFromSavedVoice(item)));
  });
  getField("uie-npc-save-voice")?.addEventListener("click", () => {
    const s = getSettings() || {};
    s.audio = s.audio && typeof s.audio === "object" ? s.audio : {};
    const list = Array.isArray(s.audio.savedVoices) ? s.audio.savedVoices : [];
    const provider = String(getField("uie-npc-voice-provider")?.value || "pocket").toLowerCase();
    if (provider === "none" || !currentVoiceRecipe()) {
      setStatus("No voice selected to save.", "error");
      return;
    }
    const name = String(getField("uie-npc-f5-label")?.value || getField("uie-npc-name")?.value || "Saved Voice").trim();
    const item = {
      id: `voice_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_") || Date.now()}`,
      name,
      provider,
      voiceRecipe: currentVoiceRecipe(),
      voice: provider === "kokoro" ? (getField("uie-npc-kokoro-voice")?.value || "af_heart") : (getField("uie-npc-pocket-fallback-voice")?.value || "alba"),
      reference: getField("uie-npc-f5-reference")?.value || "",
      referenceText: getField("uie-npc-f5-ref-text")?.value || "",
      language: provider === "kokoro" ? (getField("uie-npc-kokoro-language")?.value || "english") : "english",
      speed: Number(getField("uie-npc-voice-speed")?.value || 1),
      pitch: Number(getField("uie-npc-voice-pitch")?.value || 1),
      warmth: Number(getField("uie-npc-voice-warmth")?.value || 0.5),
      clarity: Number(getField("uie-npc-voice-clarity")?.value || 0.5),
      genderBlend: Number(getField("uie-npc-voice-gender-blend")?.value ?? 0.5),
      vibeBlend: Number(getField("uie-npc-voice-vibe-blend")?.value ?? 0.5),
      isStudio: provider === "kokoro" && getField("uie-npc-kokoro-voice")?.value === "custom",
      updatedAt: Date.now()
    };
    s.audio.savedVoices = [item, ...list.filter((voice) => String(voice?.id || "") !== item.id)].slice(0, 100);
    saveSettings();
    renderNpcSavedVoiceOptions(item.id);
    setStatus(`Saved voice: ${name}`, "success");
  });
  getField("uie-npc-delete-voice")?.addEventListener("click", () => {
    const target = String(getField("uie-npc-saved-voice")?.value || "");
    if (!target) return;
    const s = getSettings() || {};
    s.audio = s.audio && typeof s.audio === "object" ? s.audio : {};
    s.audio.savedVoices = (Array.isArray(s.audio.savedVoices) ? s.audio.savedVoices : []).filter((voice) => String(voice?.id || "") !== target);
    saveSettings();
    renderNpcSavedVoiceOptions("");
    setStatus("Saved voice deleted.", "success");
  });
  getField("uie-npc-f5-reference-file")?.addEventListener("change", async function() {
    const file = this.files?.[0];
    if (!file) return;
    if (!/\.(wav|mp3)$/i.test(file.name || "") && !/^audio\/(wav|x-wav|mpeg|mp3)$/i.test(file.type || "")) {
      const label = getField("uie-npc-f5-reference-label");
      if (label) label.textContent = "Pick a WAV or MP3 reference audio file.";
      return;
    }
    try {
      const url = await readAsDataUrl(file);
      const hidden = getField("uie-npc-f5-reference");
      const label = getField("uie-npc-f5-reference-label");
      if (hidden) hidden.value = url;
      if (label) label.textContent = file.name || "Reference audio selected.";
      const quick = getField("uie-npc-archetype");
      if (quick) quick.value = "custom";
      updateMixerLabel();
    } catch (error) {
      const label = getField("uie-npc-f5-reference-label");
      if (label) label.textContent = "Could not read reference audio.";
    }
  });
  getField("uie-npc-random-voice")?.addEventListener("click", () => {
    const archetype = getField("uie-npc-archetype");
    if (archetype) archetype.value = "custom";
    const parsed = getVoiceBridge().parseStudioRecipe(createRandomPocketVoiceRecipe(Math.random()));
    if (getField("uie-npc-f5-label")) getField("uie-npc-f5-label").value = parsed.label;
    updateMixerLabel();
    void testCurrentVoice();
  });
  getField("uie-npc-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitCurrentNpc();
  });
  // Avatar image upload
  getField("uie-npc-avatar-btn")?.addEventListener("click", () => {
    getField("uie-npc-avatar-file")?.click();
  });
  getField("uie-npc-avatar-file")?.addEventListener("change", async function() {
    const file = this.files?.[0];
    this.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const url = await readAsDataUrl(file);
      const hidden = getField("uie-npc-avatar-url");
      if (hidden) hidden.value = url;
      const preview = getField("uie-npc-avatar-preview");
      if (preview) {
        preview.style.backgroundImage = `url("${url}")`;
        preview.style.display = "block";
      }
    } catch (e) {
      console.warn("Failed to load avatar", e);
    }
  });
  getField("uie-npc-avatar-clear")?.addEventListener("click", () => {
    const hidden = getField("uie-npc-avatar-url");
    if (hidden) hidden.value = "";
    const preview = getField("uie-npc-avatar-preview");
    if (preview) {
      preview.style.backgroundImage = "";
      preview.style.display = "none";
    }
  });

  // Sprite image upload
  getField("uie-npc-add-sprite-btn")?.addEventListener("click", () => {
    const label = getField("uie-npc-sprite-label")?.value?.trim();
    if (!label) {
      alert("Please enter an expression name first");
      return;
    }
    getField("uie-npc-sprite-file")?.click();
  });
  getField("uie-npc-sprite-file")?.addEventListener("change", async function() {
    const file = this.files?.[0];
    this.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    const labelInput = getField("uie-npc-sprite-label");
    const label = labelInput?.value?.trim() || "Expression";
    try {
      const url = await readAsDataUrl(file);
      state.expressions = state.expressions || [];
      state.expressions.push({
        id: `sprite_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        label,
        url
      });
      if (labelInput) labelInput.value = "";
      renderNpcSprites();
    } catch (e) {
      console.warn("Failed to load sprite image", e);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && getModal()?.classList.contains("is-open")) closeNPCManagementModal();
  });
}

async function hydrateVoiceCatalog() {
  if (state.hydrated) return;
  state.hydrated = true;
  try {
    const voices = await getVoiceBridge().listVoices();
    if (Array.isArray(voices) && voices.length) state.voices = voices.map(String);
    syncMixerFromRecipe(currentVoiceRecipe());
  } catch (_) {}
}

function collectNpcPayload() {
  const name = String(getField("uie-npc-name")?.value || "").trim();
  const role = String(getField("uie-npc-role")?.value || "NPC").trim() || "NPC";
  const title = String(getField("uie-npc-title")?.value || "").trim();
  const ageValue = Number(getField("uie-npc-age")?.value);
  const location = String(getField("uie-npc-location")?.value || "").trim();
  const bio = String(getField("uie-npc-bio")?.value || "").trim();
  if (!name) throw new Error("NPC name is required.");
  const avatar = getField("uie-npc-avatar-url")?.value || "";
  const appearanceText = String(getField("uie-npc-appearance")?.value || "").trim();
  const wants = String(getField("uie-npc-wants")?.value || "").split(/[\n,]/).map(x => x.trim()).filter(Boolean);
  const needsArr = String(getField("uie-npc-needs")?.value || "").split(/[\n,]/).map(x => x.trim()).filter(Boolean);
  const needs = {};
  needsArr.forEach(item => {
      const parts = item.split(":");
      const k = parts[0].trim().toLowerCase();
      const v = parts[1] ? Number(parts[1].trim()) : 0.5;
      if (k) needs[k] = Number.isFinite(v) ? v : 0.5;
  });

  let payload = {
    id: state.currentNpcId || `npc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    cardId: state.currentCardId || "",
    characterCardId: state.currentCardId || "",
    createdAt: state.currentCreatedAt || new Date().toISOString(),
    kind: "uie.npc_card",
    source: "game_npc",
    name,
    role,
    title,
    age: Number.isFinite(ageValue) ? ageValue : "",
    location,
    currentLocation: location,
    appearance: appearanceText,
    personality: String(getField("uie-npc-personality")?.value || "").trim(),
    organizationAffiliations: splitList(getField("uie-npc-affiliations")?.value),
    affiliations: splitList(getField("uie-npc-affiliations")?.value),
    rumors: splitList(getField("uie-npc-rumors")?.value),
    schedules: splitSchedule(getField("uie-npc-schedule")?.value),
    schedule: String(getField("uie-npc-schedule")?.value || "").trim(),
    lockMode: String(getField("uie-npc-lock-mode")?.value || "auto"),
    likes: splitList(getField("uie-npc-likes")?.value),
    dislikes: splitList(getField("uie-npc-dislikes")?.value),
    bio,
    wants,
    needs,
    secrets: state.currentNpcSecrets || [],
    privateIntel: state.currentNpcPrivateIntel || [],
    inventory: {
      items: [],
      equipment: [],
      equipped: [],
      outfits: appearanceText ? [{
        id: `npc_outfit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: "Default Look",
        type: "clothing",
        slotId: "outfit",
        equipmentKind: "outfit",
        description: appearanceText,
        source: "npc_appearance"
      }] : [],
      appearanceStyle: appearanceText
    },
    voice_recipe: currentVoiceRecipe(),
    generate_missing_bio: bio.length === 0,
    avatar,
    expressions: state.expressions || []
  };
  payload = completeNpcManagementPayload(payload);
  payload.autoLocked = shouldAutoLockNpc(payload);
  payload.locked = payload.autoLocked;
  payload.managementOptions.locked = payload.locked;
  payload.managementOptions.autoLocked = payload.autoLocked;
  payload.npcManagement.locked = payload.locked;
  payload.npcManagement.autoLocked = payload.autoLocked;
  payload.canUnlock = true;
  return payload;
}

function buildLocalNpcBio(payload) {
  const likes = Array.isArray(payload.likes) && payload.likes.length ? ` Likes ${payload.likes.join(", ")}.` : "";
  const dislikes = Array.isArray(payload.dislikes) && payload.dislikes.length ? ` Dislikes ${payload.dislikes.join(", ")}.` : "";
  const title = payload.title ? ` known as ${payload.title}` : "";
  const appearance = payload.appearance ? ` Appearance: ${payload.appearance}.` : "";
  const personality = payload.personality ? ` Personality: ${payload.personality}.` : "";
  return `${payload.name} is a ${payload.role || "NPC"}${title} available to the current story.${appearance}${personality}${likes}${dislikes}`.trim();
}

function slugId(value) {
  return String(value || "npc")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "npc";
}

function listText(value) {
  return Array.isArray(value) ? value.filter(Boolean).join(", ") : String(value || "").trim();
}

function keepNewOrOld(newValue, oldValue) {
  const raw = Array.isArray(newValue) ? newValue : String(newValue ?? "").trim();
  if (Array.isArray(newValue)) return newValue.length ? newValue : oldValue;
  if (raw !== "") return newValue;
  return oldValue;
}

function currentWorldLocationFallback() {
  const s = getSettings() || {};
  return String(s.worldState?.location || s.map?.location || "Unplaced").trim() || "Unplaced";
}

function ensureList(value, fallback = []) {
  if (Array.isArray(value)) {
    const clean = value.map((item) => String(item || "").trim()).filter(Boolean);
    return clean.length ? clean : fallback.slice();
  }
  const clean = splitList(value);
  return clean.length ? clean : fallback.slice();
}

function ensureSchedule(value, fallback = []) {
  if (Array.isArray(value)) {
    const clean = value.map((item) => String(item || "").trim()).filter(Boolean);
    return clean.length ? clean : fallback.slice();
  }
  const clean = splitSchedule(value);
  return clean.length ? clean : fallback.slice();
}

function completeNpcManagementPayload(raw = {}) {
  const payload = { ...(raw || {}) };
  const role = String(payload.role || "NPC").trim() || "NPC";
  const name = String(payload.name || "Unnamed NPC").trim() || "Unnamed NPC";
  const title = String(payload.title || role).trim() || role;
  const location = String(payload.location || payload.currentLocation || currentWorldLocationFallback()).trim() || "Unplaced";
  const appearance = String(payload.appearance || `Distinct ${role.toLowerCase()} presentation; refine clothing, build, and visual tells in NPC Management.`).trim();
  const personality = String(payload.personality || `Role-consistent, scene-aware, and responsive to the player's actions.`).trim();
  const affiliations = ensureList(payload.organizationAffiliations || payload.affiliations, []);
  const rumors = ensureList(payload.rumors, ["No public rumors recorded yet."]);
  const likes = ensureList(payload.likes, ["Respectful conversation", "Clear intentions"]);
  const dislikes = ensureList(payload.dislikes, ["Being ignored", "Needless conflict"]);
  const schedules = ensureSchedule(payload.schedules || payload.schedule, ["Flexible; follows the current scene until assigned a routine."]);
  const schedule = String(payload.schedule || schedules.join("\n")).trim();
  const bio = String(payload.bio || buildLocalNpcBio({ ...payload, name, role, title, appearance, personality, likes, dislikes })).trim();
  const age = payload.age !== undefined && payload.age !== "" ? payload.age : "unknown";
  const organization = affiliations[0] || "None";
  const lockMode = String(payload.lockMode || "auto").trim() || "auto";
  const wants = payload.wants || payload.desires || [];
  const needs = payload.needs || {};
  const secrets = payload.secrets || [];
  const privateIntel = payload.privateIntel || [];

  const managementOptions = {
    name,
    role,
    title,
    age,
    location,
    currentLocation: location,
    appearance,
    personality,
    organization,
    organizationAffiliations: affiliations,
    affiliations,
    rumors,
    likes,
    dislikes,
    bio,
    schedules,
    schedule,
    lockMode,
    locked: payload.locked === true,
    autoLocked: payload.autoLocked === true,
    canUnlock: payload.canUnlock !== false,
    voice_recipe: payload.voice_recipe || currentVoiceRecipe(),
    avatar: payload.avatar || "",
    expressions: Array.isArray(payload.expressions) ? payload.expressions : [],
    wants,
    needs,
    secrets,
    privateIntel
  };
  return {
    ...payload,
    name,
    role,
    title,
    age,
    location,
    currentLocation: location,
    appearance,
    personality,
    organization,
    organizationAffiliations: affiliations,
    affiliations,
    rumors,
    likes,
    dislikes,
    schedules,
    schedule,
    bio,
    lockMode,
    managementOptions,
    npcManagement: managementOptions,
    npcManagementComplete: true,
    managementComplete: true,
    wants,
    needs,
    secrets,
    privateIntel
  };
}

function findNpcCharacterCard(s, npc) {
  if (!Array.isArray(s.character_cards)) s.character_cards = [];
  const cardId = String(npc?.cardId || npc?.characterCardId || "").trim();
  const nameKey = String(npc?.name || "").trim().toLowerCase();
  if (cardId) {
    const byId = s.character_cards.find((card) => String(card?.id || "").trim() === cardId);
    if (byId) return byId;
  }
  if (nameKey) {
    return s.character_cards.find((card) => String(card?.name || card?.data?.name || card?.data?.char_name || "").trim().toLowerCase() === nameKey) || null;
  }
  return null;
}

function upsertNpcCharacterCard(s, npc) {
  if (!npc || !String(npc.name || "").trim()) return null;
  npc = completeNpcManagementPayload(npc);
  if (!Array.isArray(s.character_cards)) s.character_cards = [];
  const existing = findNpcCharacterCard(s, npc);
  const now = new Date().toISOString();
  const id = String(existing?.id || npc.cardId || npc.characterCardId || `npc_card_${slugId(npc.name)}_${Date.now().toString(36)}`).trim();
  const bio = String(npc.bio || existing?.bio || buildLocalNpcBio(npc)).trim();
  const description = String(npc.appearance || existing?.description || existing?.data?.description || bio).trim();
  const personality = String(npc.personality || existing?.personality || existing?.data?.personality || "").trim();
  const scenario = [
    npc.location ? `Current location: ${npc.location}.` : "",
    npc.role ? `Role: ${npc.role}.` : "",
    npc.title ? `Title: ${npc.title}.` : "",
    npc.schedule ? `Schedule: ${npc.schedule}.` : "",
    Array.isArray(npc.rumors) && npc.rumors.length ? `Rumors: ${npc.rumors.join(", ")}.` : ""
  ].filter(Boolean).join(" ");
  const card = {
    ...(existing || {}),
    id,
    kind: "uie.character_card",
    source: existing?.source || "npc_management",
    sourceNpcId: keepNewOrOld(npc.id, existing?.sourceNpcId),
    name: String(npc.name || existing?.name || "NPC").trim(),
    role: keepNewOrOld(npc.role, existing?.role || "NPC"),
    title: keepNewOrOld(npc.title, existing?.title),
    age: keepNewOrOld(npc.age, existing?.age),
    bio,
    description,
    appearance: keepNewOrOld(npc.appearance, existing?.appearance),
    personality,
    traits: personality || existing?.traits || "",
    likes: listText(npc.likes) || existing?.likes || "",
    dislikes: listText(npc.dislikes) || existing?.dislikes || "",
    likesList: Array.isArray(npc.likes) && npc.likes.length ? npc.likes.map((text) => ({ text, weight: 50 })) : existing?.likesList,
    dislikesList: Array.isArray(npc.dislikes) && npc.dislikes.length ? npc.dislikes.map((text) => ({ text, weight: 50 })) : existing?.dislikesList,
    organizationAffiliations: keepNewOrOld(npc.organizationAffiliations || npc.affiliations, existing?.organizationAffiliations),
    affiliations: keepNewOrOld(npc.affiliations || npc.organizationAffiliations, existing?.affiliations),
    rumors: keepNewOrOld(npc.rumors, existing?.rumors),
    schedules: keepNewOrOld(npc.schedules, existing?.schedules),
    schedule: keepNewOrOld(npc.schedule, existing?.schedule),
    location: keepNewOrOld(npc.location || npc.currentLocation, existing?.location),
    currentLocation: keepNewOrOld(npc.currentLocation || npc.location, existing?.currentLocation),
    avatar: keepNewOrOld(npc.avatar, existing?.avatar),
    portrait: keepNewOrOld(npc.avatar, existing?.portrait),
    expressions: Array.isArray(npc.expressions) && npc.expressions.length ? npc.expressions : (existing?.expressions || []),
    voice_recipe: keepNewOrOld(npc.voice_recipe, existing?.voice_recipe),
    inventory: npc.inventory && typeof npc.inventory === "object" ? { ...(existing?.inventory || {}), ...npc.inventory } : existing?.inventory,
    organization: npc.organization || existing?.organization || "None",
    managementOptions: npc.managementOptions || existing?.managementOptions,
    npcManagement: npc.npcManagement || existing?.npcManagement,
    npcManagementComplete: true,
    managementComplete: true,
    dynamic: true,
    allowStoryUpdates: true,
    updatedAt: now,
    createdAt: existing?.createdAt || now,
    wants: npc.wants || [],
    needs: npc.needs || {},
    secrets: npc.secrets || [],
    privateIntel: npc.privateIntel || [],
    data: {
      ...(existing?.data || {}),
      name: String(npc.name || existing?.name || "NPC").trim(),
      char_name: String(npc.name || existing?.name || "NPC").trim(),
      description,
      personality,
      scenario: scenario || existing?.data?.scenario || "",
      first_mes: existing?.data?.first_mes || "",
      mes_example: existing?.data?.mes_example || "",
      npcManagement: npc.npcManagement || npc.managementOptions || existing?.data?.npcManagement,
      wants: npc.wants || [],
      needs: npc.needs || {},
      secrets: npc.secrets || [],
      privateIntel: npc.privateIntel || []
    }
  };
  const idx = s.character_cards.findIndex((item) => String(item?.id || "") === id || String(item?.name || "").trim().toLowerCase() === String(card.name || "").trim().toLowerCase());
  if (idx >= 0) s.character_cards[idx] = { ...s.character_cards[idx], ...card };
  else s.character_cards.push(card);
  return card;
}

function upsertSceneNpcRecord(s, npc, card) {
  if (!card?.id) return;
  npc = completeNpcManagementPayload(npc);
  if (!Array.isArray(s.gameCharacters)) s.gameCharacters = [];
  if (!s.gameCharacters.map(String).includes(String(card.id))) s.gameCharacters.push(card.id);
  if (!Array.isArray(s.sceneCharacters)) s.sceneCharacters = [];
  const key = String(card.id);
  const patch = {
    id: key,
    cardId: key,
    source: "npc_management",
    name: card.name || npc.name,
    role: npc.role || card.role || "NPC",
    title: npc.title || card.title || "",
    description: card.bio || npc.bio || "",
    avatar: card.avatar || npc.avatar || "",
    organization: npc.organization || "None",
    organizationAffiliations: npc.organizationAffiliations || [],
    npcManagement: npc.npcManagement || npc.managementOptions,
    managementOptions: npc.managementOptions || npc.npcManagement,
    npcManagementComplete: true,
    inParty: false,
    dynamic: true,
    wants: npc.wants || [],
    needs: npc.needs || {},
    secrets: npc.secrets || [],
    privateIntel: npc.privateIntel || []
  };
  const idx = s.sceneCharacters.findIndex((item) => String(item?.cardId || item?.id || "") === key || String(item?.name || "").trim().toLowerCase() === String(card.name || "").trim().toLowerCase());
  if (idx >= 0) s.sceneCharacters[idx] = { ...s.sceneCharacters[idx], ...patch };
  else s.sceneCharacters.push(patch);
}

function inferNpcOrganizationCategory(affiliation, npc) {
  const hay = `${affiliation || ""} ${npc?.role || ""} ${npc?.title || ""}`.toLowerCase();
  if (/guild/.test(hay)) return "guild";
  if (/school|academy|class|teacher/.test(hay)) return "school";
  if (/club/.test(hay)) return "club";
  if (/council|committee/.test(hay)) return "council";
  if (/guard|watch|warden|sentinel|government/.test(hay)) return "government";
  if (/gang|crew|syndicate|mafia/.test(hay)) return "crew";
  if (/company|corp|shop|store|business|merchant/.test(hay)) return "company";
  if (/cult|temple|church|order/.test(hay)) return "order";
  if (/family|house|clan/.test(hay)) return "family";
  return "custom";
}

function inferNpcRank(npc) {
  const hay = `${npc?.title || ""} ${npc?.role || ""}`.toLowerCase();
  const leaderPattern = /\b(captain|boss|leader|chief|director|president|guildmaster|owner|founder|commander)\b/;
  const rolePattern = /\b(teacher|professor|guard|vendor|shopkeeper|clerk|bartender|receptionist)\b/;
  const leaderMatch = hay.match(leaderPattern);
  if (leaderMatch) return leaderMatch[1].charAt(0).toUpperCase() + leaderMatch[1].slice(1);
  const roleMatch = hay.match(rolePattern);
  if (roleMatch) return roleMatch[1].charAt(0).toUpperCase() + roleMatch[1].slice(1);
  return npc?.title || npc?.role || "Member";
}

function buildNpcOrgHooks(npc, affiliation) {
  const hooks = [];
  if (npc?.name && affiliation) hooks.push(`${npc.name} is affiliated with ${affiliation}.`);
  if (npc?.name && (npc.location || npc.currentLocation)) hooks.push(`${npc.name} can be found at ${npc.location || npc.currentLocation}.`);
  if (npc?.name && (npc.schedule || (Array.isArray(npc.schedules) && npc.schedules.length))) hooks.push(`${npc.name} has schedule activity tied to ${affiliation}.`);
  if (affiliation && Array.isArray(npc?.rumors) && npc.rumors.length) hooks.push(`${affiliation} has rumors connected to ${npc.name}.`);
  return hooks;
}

function publishNpcOrganizationIntel(npc = {}, card = null) {
  if (!npc?.name) return;
  const affiliations = [
    ...(Array.isArray(npc.organizationAffiliations) ? npc.organizationAffiliations : []),
    ...(Array.isArray(npc.affiliations) ? npc.affiliations : []),
  ];
  const singleOrg = String(npc.organization || "").trim();
  if (singleOrg && singleOrg !== "None") affiliations.push(singleOrg);
  const unique = Array.from(new Set(affiliations.map((a) => String(a || "").trim()).filter((a) => a && a.length >= 3)));
  if (!unique.length) return;
  const s = getSettings();
  if (!s.factions || typeof s.factions !== "object") s.factions = {};
  if (!Array.isArray(s.factions.recentNpcIntelSigs)) s.factions.recentNpcIntelSigs = [];
  const npcId = npc.id || npc.cardId || npc.characterCardId || npc.name;
  const rumors = Array.isArray(npc.rumors) ? npc.rumors.slice() : [];
  const rawSecrets = Array.isArray(npc.secrets) ? npc.secrets : [];
  rawSecrets.forEach(s => {
      if (typeof s === "object" && (s.exposure?.status === "public" || s.exposure?.status === "discovered")) {
          rumors.push(`Secret Discovered: ${s.title} (${s.truth})`);
      }
  });
  const rank = inferNpcRank(npc);
  const isLeader = /\b(captain|boss|leader|chief|director|president|guildmaster|owner|founder|commander)\b/i.test(`${npc.title || ""} ${npc.role || ""}`);
  for (const affiliation of unique) {
    const sig = `${npc.name}|${affiliation}|${npc.location || ""}|${npc.schedule || ""}|${rumors.join("|")}`;
    if (s.factions.recentNpcIntelSigs.includes(sig)) continue;
    s.factions.recentNpcIntelSigs.push(sig);
    s.factions.recentNpcIntelSigs = s.factions.recentNpcIntelSigs.slice(-100);
    const patch = {
      members: [{
        name: npc.name,
        rank,
        role: npc.role || npc.title || "Member",
        location: npc.currentLocation || npc.location || "",
        notes: npc.bio || "",
        sourceType: "npc_management",
        sourceId: String(npcId)
      }],
      controlledSpaces: (npc.location || npc.currentLocation) ? [npc.currentLocation || npc.location] : [],
      rumors: rumors.slice(),
      activeHooks: buildNpcOrgHooks(npc, affiliation),
      scheduleHints: Array.isArray(npc.schedules) ? npc.schedules.slice() : splitSchedule(npc.schedule),
      sourceRefs: [{
        source: "npc_management",
        sourceId: String(npcId),
        label: `NPC Management: ${npc.name}`
      }]
    };
    if (isLeader) {
      patch.leader = npc.name;
      patch.leaderTitle = rank;
    }
    publishOrganizationIntel({
      source: "npc_management",
      sourceId: String(npcId),
      confidence: 0.9,
      organizationName: affiliation,
      category: inferNpcOrganizationCategory(affiliation, npc),
      people: [{
        name: npc.name,
        rank,
        role: npc.role || npc.title || "Member",
        location: npc.currentLocation || npc.location || "",
        sourceType: "npc_management",
        sourceId: String(npcId)
      }],
      proposedPatch: patch,
      reason: "NPC was created or edited with organization affiliation data."
    });
  }
  try { saveSettings(); } catch (_) {}
}

function upsertLocalNpc(npc) {
  npc = completeNpcManagementPayload(npc);
  const s = getSettings();
  const card = upsertNpcCharacterCard(s, npc);
  if (card?.id) {
    npc.cardId = card.id;
    npc.characterCardId = card.id;
    upsertSceneNpcRecord(s, npc, card);
  }
  if (!Array.isArray(s.npcs)) s.npcs = [];
  const key = String(npc?.name || "").trim().toLowerCase();
  const idx = s.npcs.findIndex((item) => String(item?.cardId || item?.characterCardId || "").trim() === String(npc.cardId || "") || String(item?.name || "").trim().toLowerCase() === key);
  if (idx >= 0) s.npcs[idx] = { ...s.npcs[idx], ...npc };
  else s.npcs.push(npc);

  if (!s.social || typeof s.social !== "object") s.social = { friends: [], associates: [], romance: [], family: [], rivals: [] };
  if (!Array.isArray(s.social.associates)) s.social.associates = [];
  const personPatch = {
    role: npc.role,
    title: npc.title || "",
    age: npc.age ?? "",
    thoughts: npc.bio,
    appearance: npc.appearance || "",
    personality: npc.personality || "",
    organizationAffiliations: npc.organizationAffiliations || npc.affiliations || [],
    affiliations: npc.affiliations || npc.organizationAffiliations || [],
    rumors: npc.rumors || [],
    schedules: npc.schedules || [],
    schedule: npc.schedule || "",
    locked: npc.locked === true,
    autoLocked: npc.autoLocked === true,
    canUnlock: npc.canUnlock !== false,
    likes: Array.isArray(npc.likes) ? npc.likes.join(", ") : "",
    dislikes: Array.isArray(npc.dislikes) ? npc.dislikes.join(", ") : "",
    location: npc.location || npc.currentLocation || "",
    currentLocation: npc.currentLocation || npc.location || "",
    organization: npc.organization || "None",
    managementOptions: npc.managementOptions || npc.npcManagement,
    npcManagement: npc.npcManagement || npc.managementOptions,
    npcManagementComplete: true,
    managementComplete: true,
    voice_recipe: npc.voice_recipe,
    met_physically: true,
    liveSync: true,
    affinity: 50,
    avatar: npc.avatar || "",
    expressions: npc.expressions || [],
    cardId: npc.cardId || "",
    characterCardId: npc.characterCardId || npc.cardId || "",
    wants: npc.wants || [],
    needs: npc.needs || {},
    secrets: npc.secrets || [],
    privateIntel: npc.privateIntel || []
  };
  const existingPerson = s.social.associates.find((person) => String(person?.name || "").trim().toLowerCase() === key);
  if (existingPerson) {
    Object.assign(existingPerson, personPatch);
  } else {
    s.social.associates.push({
      id: npc.cardId || `npc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: npc.name,
      ...personPatch
    });
  }
  publishNpcOrganizationIntel(npc, card);
  saveSettings();
}

/**
 * Register a character as a full game NPC without opening the editor.
 * This is the shared entry point for systems that discover or create people
 * (shops, scene generation, imports). It fills every NPC Management section,
 * creates/updates the Character Card, adds the NPC to the active registries,
 * and exposes the public profile through Social. Secrets remain stored for the
 * NPC editor/secrets engine and are not rendered by Social's read profile.
 */
export function registerNPCRecord(raw = {}, options = {}) {
  const payload = completeNpcManagementPayload(raw);
  upsertLocalNpc(payload);
  const s = getSettings();
  const key = String(payload.name || "").trim().toLowerCase();
  const npc = (Array.isArray(s.npcs) ? s.npcs : []).find((item) =>
    String(item?.name || "").trim().toLowerCase() === key ||
    (payload.cardId && String(item?.cardId || item?.characterCardId || "") === String(payload.cardId))
  ) || payload;
  if (options.emit !== false) {
    try { window.dispatchEvent(new CustomEvent("uie:npc-created", { detail: { npc, source: options.source || "registry" } })); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent("uie:social_updated", { detail: { name: npc.name, source: options.source || "registry" } })); } catch (_) {}
  }
  return npc;
}

/** Register active Character Cards as NPCs so cards used by the current game
 * automatically receive NPC Management and Social records. Library-only cards
 * remain reusable templates until added to the game or a scene. */
export function syncActiveCharacterCardsToNpcs(options = {}) {
  const s = getSettings();
  const cards = Array.isArray(s.character_cards) ? s.character_cards : [];
  const activeIds = new Set((Array.isArray(s.gameCharacters) ? s.gameCharacters : []).map(String));
  for (const scene of (Array.isArray(s.sceneCharacters) ? s.sceneCharacters : [])) {
    const id = String(scene?.cardId || scene?.characterCardId || scene?.id || "").trim();
    if (id) activeIds.add(id);
  }
  let count = 0;
  for (const card of cards) {
    if (!card?.id || (!activeIds.has(String(card.id)) && card?.source !== "context_shop" && card?.data?.source !== "context_shop")) continue;
    registerNPCRecord({
      id: card.sourceNpcId || card.id,
      cardId: card.id,
      characterCardId: card.id,
      name: card.name || card.data?.name,
      role: card.role || card.title || "NPC",
      title: card.title || card.role || "NPC",
      age: card.age,
      location: card.location || card.currentLocation,
      appearance: card.appearance || card.description || card.data?.description,
      personality: card.personality || card.traits || card.data?.personality,
      bio: card.bio || card.description,
      likes: card.likesList?.map?.((item) => item?.text || item) || card.likes,
      dislikes: card.dislikesList?.map?.((item) => item?.text || item) || card.dislikes,
      affiliations: card.affiliations || card.organizationAffiliations,
      schedule: card.schedule,
      schedules: card.schedules,
      rumors: card.rumors,
      avatar: card.avatar || card.portrait,
      expressions: card.expressions,
      voice_recipe: card.voice_recipe || card.voiceRecipe,
      wants: card.wants || card.data?.wants,
      needs: card.needs || card.data?.needs,
      secrets: card.secrets || card.data?.secrets,
      privateIntel: card.privateIntel || card.data?.privateIntel,
      managementOptions: card.managementOptions || card.npcManagement || card.data?.npcManagement
    }, { emit: false, source: options.source || "character_card_sync" });
    count++;
  }
  if (count && options.emit !== false) {
    try { window.dispatchEvent(new CustomEvent("uie:npc-registry-synced", { detail: { count } })); } catch (_) {}
  }
  return count;
}
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderNpcSprites() {
  const list = getField("uie-npc-sprites-list");
  if (!list) return;
  list.innerHTML = "";
  if (!state.expressions || !state.expressions.length) {
    list.innerHTML = `<div style="font-size: 11px; opacity: 0.6; padding: 4px;">No custom expression sprites.</div>`;
    return;
  }
  state.expressions.forEach((sprite, idx) => {
    const item = document.createElement("div");
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.justifyContent = "space-between";
    item.style.padding = "6px";
    item.style.background = "rgba(255,255,255,0.05)";
    item.style.border = "1px solid rgba(255,255,255,0.08)";
    item.style.borderRadius = "4px";
    item.innerHTML = `
      <div style="display: flex; gap: 8px; align-items: center; min-width: 0;">
        <div style="width: 32px; height: 32px; border-radius: 4px; background: url('${escapeHtml(sprite.url)}') center/cover, rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.12);"></div>
        <strong style="font-size: 12px; color: #e8dcbf;">${escapeHtml(sprite.label)}</strong>
      </div>
      <button type="button" class="uie-npc-btn secondary" style="height: 24px; padding: 0 8px; font-size: 11px; color: #ff9aa2; border-color: rgba(255,154,162,0.3); background: rgba(255,154,162,0.1);">Remove</button>
    `;
    item.querySelector("button").addEventListener("click", () => {
      state.expressions.splice(idx, 1);
      renderNpcSprites();
    });
    list.appendChild(item);
  });
}

function populateLocationsDropdown(selectedValue = "") {
  const select = document.getElementById("uie-npc-location");
  if (!select) return;

  select.innerHTML = "";

  const s = getSettings() || {};
  const locationsSet = new Set();

  if (s.worldState?.location) {
    locationsSet.add(String(s.worldState.location).trim());
  }

  if (s.worldState?.mapNodes) {
    Object.keys(s.worldState.mapNodes).forEach(k => {
      if (k) locationsSet.add(k.trim());
    });
  }

  if (selectedValue) {
    locationsSet.add(String(selectedValue).trim());
  }

  const sortedLocations = Array.from(locationsSet).sort();

  const optDefault = document.createElement("option");
  optDefault.value = "";
  optDefault.textContent = "Select location...";
  select.appendChild(optDefault);

  sortedLocations.forEach(loc => {
    if (!loc) return;
    const opt = document.createElement("option");
    opt.value = loc;
    opt.textContent = loc;
    select.appendChild(opt);
  });

  select.value = selectedValue || "";
}

export function openNPCManagementModal(seed = {}) {
  const modal = ensureModal();
  
  const initialLoc = seed ? (seed.location || seed.currentLocation || "") : "";
  populateLocationsDropdown(initialLoc);

  void hydrateVoiceCatalog();
  state.expressions = Array.isArray(seed.expressions) ? [...seed.expressions] : [];
  state.currentNpcId = seed?.id || "";
  state.currentCardId = seed?.cardId || seed?.characterCardId || "";
  state.currentCreatedAt = seed?.createdAt || "";
  state.currentNpcSecrets = seed?.secrets ? JSON.parse(JSON.stringify(seed.secrets)) : [];
  state.currentNpcPrivateIntel = seed?.privateIntel ? JSON.parse(JSON.stringify(seed.privateIntel)) : [];
  state.secretsRevealed = false;
  state.includeHiddenSecretsInDebug = getSettings().includeHiddenSecretsInDebug === true;
  
  // Clear/reset fields first
  getField("uie-npc-name").value = "";
  if (getField("uie-npc-wants")) getField("uie-npc-wants").value = "";
  if (getField("uie-npc-needs")) getField("uie-npc-needs").value = "";
  getField("uie-npc-role").value = "NPC";
  getField("uie-npc-title").value = "";
  getField("uie-npc-age").value = "";
  getField("uie-npc-location").value = "";
  getField("uie-npc-appearance").value = "";
  getField("uie-npc-personality").value = "";
  getField("uie-npc-affiliations").value = "";
  getField("uie-npc-rumors").value = "";
  getField("uie-npc-schedule").value = "";
  getField("uie-npc-lock-mode").value = "auto";
  getField("uie-npc-bio").value = "";
  getField("uie-npc-likes").value = "";
  getField("uie-npc-dislikes").value = "";
  const avatarInput = getField("uie-npc-avatar-url");
  if (avatarInput) avatarInput.value = "";
  const avatarPreview = getField("uie-npc-avatar-preview");
  if (avatarPreview) {
    avatarPreview.style.backgroundImage = "";
    avatarPreview.style.display = "none";
  }

  if (seed && typeof seed === "object") {
    if (seed.name) getField("uie-npc-name").value = String(seed.name);
    if (seed.role) getField("uie-npc-role").value = String(seed.role);
    if (seed.title) getField("uie-npc-title").value = String(seed.title);
    if (seed.age !== undefined && seed.age !== "") getField("uie-npc-age").value = String(seed.age);
    if (seed.location || seed.currentLocation) getField("uie-npc-location").value = String(seed.location || seed.currentLocation);
    if (seed.appearance) getField("uie-npc-appearance").value = String(seed.appearance);
    if (seed.personality) getField("uie-npc-personality").value = String(seed.personality);
    if (Array.isArray(seed.affiliations || seed.organizationAffiliations)) getField("uie-npc-affiliations").value = (seed.affiliations || seed.organizationAffiliations).join(", ");
    if (Array.isArray(seed.rumors)) getField("uie-npc-rumors").value = seed.rumors.join(", ");
    if (Array.isArray(seed.schedules)) getField("uie-npc-schedule").value = seed.schedules.join("\n");
    else if (seed.schedule) getField("uie-npc-schedule").value = String(seed.schedule);
    getField("uie-npc-lock-mode").value = seed.locked ? "locked" : "auto";
    if (seed.bio) getField("uie-npc-bio").value = String(seed.bio);
    if (Array.isArray(seed.likes)) getField("uie-npc-likes").value = seed.likes.join(", ");
    if (Array.isArray(seed.dislikes)) getField("uie-npc-dislikes").value = seed.dislikes.join(", ");
    if (seed.wants || seed.desires) {
      const w = seed.wants || seed.desires || [];
      if (getField("uie-npc-wants")) getField("uie-npc-wants").value = Array.isArray(w) ? w.join(", ") : String(w);
    }
    if (seed.needs && getField("uie-npc-needs")) {
      if (typeof seed.needs === "object") {
        getField("uie-npc-needs").value = Object.entries(seed.needs).map(([k, v]) => `${k}: ${v}`).join(", ");
      } else {
        getField("uie-npc-needs").value = String(seed.needs);
      }
    }
    if (seed.voice_recipe) {
      const quick = Object.entries(state.archetypes).find(([, recipe]) => recipe === seed.voice_recipe);
      const archetype = getField("uie-npc-archetype");
      if (archetype) archetype.value = quick?.[0] || "custom";
      syncMixerFromRecipe(seed.voice_recipe);
    }
    const avatarUrl = seed.avatar || seed.image || "";
    if (avatarUrl) {
      if (avatarInput) avatarInput.value = avatarUrl;
      if (avatarPreview) {
        avatarPreview.style.backgroundImage = `url("${avatarUrl}")`;
        avatarPreview.style.display = "block";
      }
    }
  }
  
  renderNpcSprites();
  setStatus("");
  renderSecretsTab();
  modal.classList.add("is-open");
  setTimeout(() => getField("uie-npc-name")?.focus(), 0);
}

export function closeNPCManagementModal() {
  const modal = getModal();
  if (!modal) return;
  modal.classList.remove("is-open");
}

export async function testCurrentVoice() {
  try {
    const recipe = currentVoiceRecipe();
    if (!recipe) {
      setStatus("No voice selected for this NPC.", "error");
      return;
    }
    setBusy(true, state.saving);
    setStatus("Generating browser voice test...");
    const voiceBridge = getVoiceBridge();
    const audioBuffer = await voiceBridge.synthesizeVoice("This is a quick local voice test.", "preview", {
      voice_recipe: recipe,
      speed: Number(getField("uie-npc-voice-speed")?.value || 1),
      pitch: Number(getField("uie-npc-voice-pitch")?.value || 1),
      useFallback: false
    });
    try { state.activeAudio?.stop?.(); } catch (_) {}
    state.activeAudio = voiceBridge.playVoiceWithEffects(audioBuffer, { volume: 0.95, pitch: Number(getField("uie-npc-voice-pitch")?.value || 1) });
    setStatus("Voice test playing.", "success");
  } catch (error) {
    setStatus(error?.message || "Voice test failed.", "error");
  } finally {
    setBusy(false, state.saving);
  }
}

export async function submitCurrentNpc() {
  try {
    setBusy(state.testing, true);
    setStatus("Saving living NPC profile...");
    const payload = collectNpcPayload();
    let result = null;
    try {
      result = await createNpc(payload, { required: false, timeoutMs: 2200 });
    } catch (error) {
      console.warn("[NPCManager] Living backend unavailable; saving local NPC only:", error);
    }
    const backendNpc = result?.npc;
    const npcDraft = backendNpc
      ? {
          ...payload,
          ...backendNpc.profile,
          name: backendNpc.name || payload.name,
          role: backendNpc.role || payload.role,
          bio: backendNpc.profile?.bio || payload.bio || buildLocalNpcBio(payload),
          voice_recipe: backendNpc.profile?.voice_recipe || payload.voice_recipe,
          living_profile: backendNpc
        }
      : {
          ...payload,
          bio: payload.bio || buildLocalNpcBio(payload),
          generate_missing_bio: false
        };
    const npc = completeNpcManagementPayload(npcDraft);
    const detail = result ? { ...result, npc } : { npc, source: "client" };
    upsertLocalNpc(npc);
    window.dispatchEvent(new CustomEvent("uie:npc-created", { detail }));
    setStatus(result?.source === "fastapi" ? `Living profile saved for ${npc.name}.` : `Saved ${npc.name} locally.`, "success");
    setTimeout(closeNPCManagementModal, 450);
  } catch (error) {
    setStatus(error?.message || "NPC save failed.", "error");
  } finally {
    setBusy(state.testing, false);
  }
}

function collectRosterNpcs() {
  const s = getSettings();
  const byKey = new Map();
  const add = (npc, source = "npc") => {
    if (!npc || !String(npc.name || "").trim()) return;
    const key = String(npc.id || npc.name).trim().toLowerCase();
    byKey.set(key, { ...npc, sourceLabel: source });
  };
  (Array.isArray(s.npcs) ? s.npcs : []).forEach((npc) => add(npc, "NPC"));
  (Array.isArray(s.sceneCharacters) ? s.sceneCharacters : []).forEach((npc) => add(npc, "Scene"));
  const social = s.social && typeof s.social === "object" ? s.social : {};
  Object.entries(social).forEach(([group, list]) => {
    (Array.isArray(list) ? list : []).forEach((person) => {
      if (person?.liveSync || person?.voice_recipe || person?.role || person?.thoughts) {
        add({
          ...person,
          bio: person.bio || person.thoughts || "",
          location: person.location || person.currentLocation || "",
          affiliations: person.affiliations || person.organizationAffiliations || [],
          sourceGroup: group
        }, group);
      }
    });
  });
  const active = s.genericNpcs?.active && typeof s.genericNpcs.active === "object" ? s.genericNpcs.active : {};
  Object.values(active).forEach((npc) => add(npc, "Generated"));
  return Array.from(byKey.values());
}

function renderNpcRoster() {
  const modal = document.getElementById("uie-npc-roster-modal");
  const body = document.getElementById("uie-npc-roster-body");
  if (!modal || !body) return;
  const npcs = collectRosterNpcs();
  body.innerHTML = npcs.length ? npcs.map((npc, index) => {
    const locked = npc.locked || npc.autoLocked;
    const role = npc.title || npc.role || npc.className || "NPC";
    const loc = npc.location || npc.currentLocation || "No location";
    const rawSecrets = Array.isArray(npc.secrets) ? npc.secrets : [];
    const normalizedSecrets = rawSecrets.map(s => {
        if (typeof s === "string") return { active: true, archived: false, exposure: { status: "hidden" } };
        return s;
    });
    const hiddenCount = normalizedSecrets.filter(s => s.active && !s.archived && (!s.exposure || s.exposure.status === "hidden")).length;
    const knownCount = normalizedSecrets.filter(s => s.active && !s.archived && s.exposure && (s.exposure.status === "discovered" || s.exposure.status === "public")).length;
    let secretBadge = "";
    if (hiddenCount > 0) {
        secretBadge = `<span class="uie-npc-secrets-badge" style="font-size:11px; font-weight:800; color:#c9853d; margin-top:2px;">◉ ${hiddenCount} hidden</span>`;
    } else if (knownCount > 0) {
        secretBadge = `<span class="uie-npc-secrets-badge" style="font-size:11px; font-weight:800; color:#166534; margin-top:2px;">◉ 0 hidden · ${knownCount} known</span>`;
    }

    return `
      <article class="uie-npc-card" data-npc-index="${index}">
        <strong>${escapeHtml(npc.name || "Unnamed NPC")}</strong>
        <span>${escapeHtml(role)}</span>
        <span>${escapeHtml(loc)}</span>
        <div style="display:flex; gap:8px; align-items:center;">
          <span class="uie-npc-lock-pill"><i class="fas ${locked ? "fa-lock" : "fa-lock-open"}"></i>${locked ? "Locked" : "Unlocked"}</span>
          ${secretBadge}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
          <button type="button" class="uie-npc-btn secondary uie-npc-roster-edit" data-npc-index="${index}" style="height:30px;padding:0 10px;font-size:12px;">Edit</button>
          <button type="button" class="uie-npc-btn secondary uie-npc-roster-unlock" data-npc-index="${index}" style="height:30px;padding:0 10px;font-size:12px;">${locked ? "Unlock" : "Lock"}</button>
        </div>
      </article>`;
  }).join("") : `<div style="grid-column:1/-1;padding:18px;border:1px dashed rgba(151,91,39,.32);border-radius:8px;color:#80512d;">No NPC cards in this game yet.</div>`;
  modal.dataset.npcs = JSON.stringify(npcs);
}

function ensureRosterPanel() {
  injectStyles();
  let modal = document.getElementById("uie-npc-roster-modal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "uie-npc-roster-modal";
  modal.style.cssText = "position:fixed;inset:0;z-index:2147483645;display:none;align-items:center;justify-content:center;background:rgba(57,34,20,.34);";
  modal.innerHTML = `
    <div class="uie-npc-roster">
      <div class="uie-npc-head">
        <div class="uie-npc-title">Game NPCs</div>
        <button type="button" class="uie-npc-btn" id="uie-npc-roster-add" style="margin-left:auto;"><i class="fas fa-user-plus"></i> Add New NPC</button>
        <button type="button" class="uie-npc-close" id="uie-npc-roster-close" title="Close" aria-label="Close"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="uie-npc-roster-body" id="uie-npc-roster-body"></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeNPCRosterPanel();
  });
  modal.querySelector("#uie-npc-roster-close")?.addEventListener("click", closeNPCRosterPanel);
  modal.querySelector("#uie-npc-roster-add")?.addEventListener("click", () => openNPCManagementModal({
    location: String(getSettings()?.worldState?.location || "").trim()
  }));
  modal.addEventListener("click", (event) => {
    const edit = event.target.closest?.(".uie-npc-roster-edit");
    const unlock = event.target.closest?.(".uie-npc-roster-unlock");
    if (!edit && !unlock) return;
    const npcs = JSON.parse(modal.dataset.npcs || "[]");
    const npc = npcs[Number((edit || unlock).dataset.npcIndex || 0)];
    if (!npc) return;
    if (edit) {
      openNPCManagementModal(npc);
      return;
    }
    const s = getSettings();
    const key = String(npc.name || "").trim().toLowerCase();
    const nextLocked = !(npc.locked || npc.autoLocked);
    (Array.isArray(s.npcs) ? s.npcs : []).forEach((item) => {
      if (String(item?.name || "").trim().toLowerCase() === key) {
        item.locked = nextLocked;
        item.autoLocked = nextLocked;
        item.canUnlock = true;
      }
    });
    Object.values(s.social || {}).forEach((list) => {
      (Array.isArray(list) ? list : []).forEach((item) => {
        if (String(item?.name || "").trim().toLowerCase() === key) {
          item.locked = nextLocked;
          item.autoLocked = nextLocked;
          item.canUnlock = true;
        }
      });
    });
    saveSettings();
    renderNpcRoster();
  });
  return modal;
}

export function openNPCRosterPanel() {
  const modal = ensureRosterPanel();
  renderNpcRoster();
  modal.style.display = "flex";
}

export function closeNPCRosterPanel() {
  const modal = document.getElementById("uie-npc-roster-modal");
  if (modal) modal.style.display = "none";
}

export function initNPCManagementModal() {
  ensureModal();
  ensureRosterPanel();
  syncActiveCharacterCardsToNpcs({ emit: false, source: "npc_manager_init" });
  window.UIE_NPC_MANAGER = {
    open: openNPCManagementModal,
    openRoster: openNPCRosterPanel,
    close: closeNPCManagementModal,
    testVoice: testCurrentVoice,
    submit: submitCurrentNpc,
    register: registerNPCRecord,
    syncCharacterCards: syncActiveCharacterCardsToNpcs,
    recipeFromBlend
  };
  window.addEventListener("uie:open-npc-manager", (event) => openNPCManagementModal(event?.detail || {}));
  window.addEventListener("uie:npc-created", () => renderNpcRoster());
}


// Helper to set nested properties on an object using dot notation
function setNestedProperty(obj, path, value) {
    const parts = path.split(".");
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (current[part] === undefined) {
            current[part] = {};
        }
        current = current[part];
    }
    current[parts[parts.length - 1]] = value;
}

export function renderSecretsTab() {
    const container = document.getElementById("uie-npc-secrets-container");
    if (!container) return;

    if (!state.secretsRevealed) {
        const activeSecretsCount = state.currentNpcSecrets.filter(s => s.active && !s.archived).length;
        container.innerHTML = `
            <div class="uie-npc-secrets-concealed" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 30px; gap: 12px; background: rgba(0,0,0,0.03); border: 1px dashed rgba(151,91,39,.3); border-radius: 8px; width: 100%;">
              <i class="fas fa-eye-slash" style="font-size: 36px; color: #80512d; opacity: 0.8;"></i>
              <strong style="font-size: 16px; color: #5c3a21;">Secrets Hidden</strong>
              <span style="font-size: 13px; color: #80512d;">${activeSecretsCount} secrets recorded</span>
              <button type="button" class="uie-npc-btn" id="uie-npc-secrets-reveal-btn" style="margin-top: 8px;"><i class="fas fa-eye"></i> Reveal Secrets</button>
            </div>
        `;
        document.getElementById("uie-npc-secrets-reveal-btn")?.addEventListener("click", () => {
            state.secretsRevealed = true;
            renderSecretsTab();
        });
        return;
    }

    // Secrets are revealed!
    let html = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(151,91,39,.2); padding-bottom: 10px; width: 100%;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-eye" style="color: #166534; font-size: 18px;"></i>
                <span style="font-weight: 800; color: #3e2723;">Secrets Revealed</span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <label style="font-size: 12px; font-weight: 800; color: #5c3a21; display: flex; align-items: center; gap: 4px;">
                    <input type="checkbox" id="uie-npc-secrets-debug-toggle" ${state.includeHiddenSecretsInDebug ? "checked" : ""}> Debug Context
                </label>
                <button type="button" class="uie-npc-btn" id="uie-npc-add-secret-btn" style="height: 30px; font-size: 12px; font-weight: 800;">+ Add Secret</button>
            </div>
        </div>
        <div id="uie-npc-secrets-list" style="display: flex; flex-direction: column; gap: 15px; max-height: 450px; overflow-y: auto; padding-right: 5px; width: 100%;">
    `;

    if (!state.currentNpcSecrets || !state.currentNpcSecrets.length) {
        html += `<div style="text-align: center; color: #80512d; font-style: italic; padding: 20px;">No secrets recorded for this NPC.</div>`;
    } else {
        state.currentNpcSecrets.forEach((sec, idx) => {
            const normalized = normalizeObjectSecret(sec, { name: getField("uie-npc-name")?.value });
            state.currentNpcSecrets[idx] = normalized;
            
            const isArchived = normalized.archived || !normalized.active;
            const categoryOptions = SECRET_CATEGORIES.map(cat => 
                `<option value="${cat}" ${normalized.category === cat ? "selected" : ""}>${cat.replace(/_/g, " ")}</option>`
            ).join("");

            html += `
                <div class="uie-npc-secret-card" data-index="${idx}" style="border: 1px solid rgba(151,91,39,.25); border-radius: 8px; background: ${isArchived ? "rgba(0,0,0,0.04)" : "#fffdf9"}; padding: 12px; display: flex; flex-direction: column; gap: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <input type="text" class="uie-secret-field" data-index="${idx}" data-field="title" value="${escapeHtml(normalized.title)}" placeholder="Secret Title" style="flex: 1; font-weight: 800; border: none; border-bottom: 1px solid rgba(151,91,39,.15); background: transparent; padding: 2px 4px; font-size: 14px;">
                        <div style="display: flex; align-items: center; gap: 6px; margin-left: 8px;">
                            <select class="uie-secret-field" data-index="${idx}" data-field="category" style="height: 28px; padding: 0 4px; font-size: 11px; font-weight: 800;">
                                ${categoryOptions}
                            </select>
                            <button type="button" class="uie-npc-btn secondary uie-duplicate-secret-btn" data-index="${idx}" style="height: 26px; padding: 0 6px; font-size: 11px;" title="Duplicate"><i class="fas fa-copy"></i></button>
                            <button type="button" class="uie-npc-btn secondary uie-archive-secret-btn" data-index="${idx}" style="height: 26px; padding: 0 6px; font-size: 11px;">${isArchived ? "Restore" : "Archive"}</button>
                            <button type="button" class="uie-npc-btn secondary uie-delete-secret-btn" data-index="${idx}" style="height: 26px; padding: 0 6px; font-size: 11px; background: #fee2e2; color: #991b1b; border-color: #fca5a5;"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="uie-npc-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <div class="uie-npc-field">
                            <label style="font-size: 11px; font-weight: 800;">Real Truth (Private)</label>
                            <textarea class="uie-secret-field" data-index="${idx}" data-field="truth" style="height: 60px; font-size: 12px;" placeholder="What is the actual secret truth?">${escapeHtml(normalized.truth)}</textarea>
                        </div>
                        <div class="uie-npc-field">
                            <label style="font-size: 11px; font-weight: 800;">Public Cover Story</label>
                            <textarea class="uie-secret-field" data-index="${idx}" data-field="publicCover" style="height: 60px; font-size: 12px;" placeholder="What cover story is told to others?">${escapeHtml(normalized.publicCover)}</textarea>
                        </div>
                    </div>
                    <div class="uie-npc-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <div class="uie-npc-field">
                            <label style="font-size: 11px; font-weight: 800;">Hidden Motive</label>
                            <input type="text" class="uie-secret-field" data-index="${idx}" data-field="motive" value="${escapeHtml(normalized.motive)}" placeholder="Why keep this secret?" style="font-size: 12px; height: 30px;">
                        </div>
                        <div class="uie-npc-field">
                            <label style="font-size: 11px; font-weight: 800;">Objective</label>
                            <input type="text" class="uie-secret-field" data-index="${idx}" data-field="objective" value="${escapeHtml(normalized.objective)}" placeholder="What is the end goal?" style="font-size: 12px; height: 30px;">
                        </div>
                    </div>
                    <div class="uie-npc-field">
                        <label style="font-size: 11px; font-weight: 800;">Strategy</label>
                        <input type="text" class="uie-secret-field" data-index="${idx}" data-field="strategy" value="${escapeHtml(normalized.strategy)}" placeholder="Concealment or exploitation strategy" style="font-size: 12px; height: 30px;">
                    </div>
                    <div class="uie-npc-grid" style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                        <div class="uie-npc-field">
                            <label style="font-size: 11px; font-weight: 800;">Targets (comma sep)</label>
                            <input type="text" class="uie-secret-field" data-index="${idx}" data-field="targets" value="${escapeHtml(normalized.targets.join(", "))}" placeholder="Names/IDs" style="font-size: 12px; height: 30px;">
                        </div>
                        <div class="uie-npc-field">
                            <label style="font-size: 11px; font-weight: 800;">Accomplices (comma sep)</label>
                            <input type="text" class="uie-secret-field" data-index="${idx}" data-field="accomplices" value="${escapeHtml(normalized.accomplices.join(", "))}" placeholder="Names/IDs" style="font-size: 12px; height: 30px;">
                        </div>
                        <div class="uie-npc-field">
                            <label style="font-size: 11px; font-weight: 800;">Witnesses (comma sep)</label>
                            <input type="text" class="uie-secret-field" data-index="${idx}" data-field="witnesses" value="${escapeHtml(normalized.witnesses.join(", "))}" placeholder="Names/IDs" style="font-size: 12px; height: 30px;">
                        </div>
                    </div>
                    <div class="uie-npc-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <div class="uie-npc-field">
                            <label style="font-size: 11px; font-weight: 800;">Behavior Rules (one per line)</label>
                            <textarea class="uie-secret-field" data-index="${idx}" data-field="behaviorRules" style="height: 50px; font-size: 12px;" placeholder="NPC behaves differently because...">${escapeHtml(normalized.behaviorRules.join("\n"))}</textarea>
                        </div>
                        <div class="uie-npc-field">
                            <label style="font-size: 11px; font-weight: 800;">Contradiction Rules (one per line)</label>
                            <textarea class="uie-secret-field" data-index="${idx}" data-field="contradictionRules" style="height: 50px; font-size: 12px;" placeholder="Contradicts core personality to cover up...">${escapeHtml(normalized.contradictionRules.join("\n"))}</textarea>
                        </div>
                    </div>
                    <div class="uie-npc-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <div class="uie-npc-field">
                            <label style="font-size: 11px; font-weight: 800;">Trigger Conditions (one per line)</label>
                            <textarea class="uie-secret-field" data-index="${idx}" data-field="triggerConditions" style="height: 50px; font-size: 12px;" placeholder="Triggers panic or fallback...">${escapeHtml(normalized.triggerConditions.join("\n"))}</textarea>
                        </div>
                        <div class="uie-npc-field">
                            <label style="font-size: 11px; font-weight: 800;">Escalation Plan (one per line)</label>
                            <textarea class="uie-secret-field" data-index="${idx}" data-field="escalationPlan" style="height: 50px; font-size: 12px;" placeholder="Steps taken if risk increases...">${escapeHtml(normalized.escalationPlan.join("\n"))}</textarea>
                        </div>
                    </div>
                    <div class="uie-npc-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <div class="uie-npc-field">
                            <label style="font-size: 11px; font-weight: 800;">Fallback Cover Story</label>
                            <input type="text" class="uie-secret-field" data-index="${idx}" data-field="fallbackPlan" value="${escapeHtml(normalized.fallbackPlan)}" placeholder="Secondary excuse if primary fails" style="font-size: 12px; height: 30px;">
                        </div>
                        <div class="uie-npc-field">
                            <label style="font-size: 11px; font-weight: 800;">Notes</label>
                            <input type="text" class="uie-secret-field" data-index="${idx}" data-field="notes" value="${escapeHtml(normalized.notes)}" placeholder="Developer notes" style="font-size: 12px; height: 30px;">
                        </div>
                    </div>
                    <div style="border-top: 1px dashed rgba(151,91,39,.15); padding-top: 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                            <span style="font-size: 11px; font-weight: 800; color: #5c3a21;">Evidence Cards</span>
                            <button type="button" class="uie-npc-btn secondary uie-add-evidence-btn" data-index="${idx}" style="height: 24px; padding: 0 6px; font-size: 10px;">+ Add Evidence</button>
                        </div>
                        <div class="uie-evidence-list" style="display: flex; flex-direction: column; gap: 6px;">
                            ${normalized.evidence.map((ev, evIdx) => `
                                <div style="display: flex; gap: 6px; align-items: center; background: rgba(0,0,0,0.02); border: 1px solid rgba(151,91,39,.1); border-radius: 4px; padding: 4px 6px;">
                                    <input type="text" class="uie-evidence-field" data-index="${idx}" data-ev-index="${evIdx}" data-field="description" value="${escapeHtml(ev.description)}" placeholder="Description" style="flex: 1; font-size: 11px; height: 26px;">
                                    <input type="text" class="uie-evidence-field" data-index="${idx}" data-ev-index="${evIdx}" data-field="location" value="${escapeHtml(ev.location)}" placeholder="Location" style="flex: 1; font-size: 11px; height: 26px;">
                                    <select class="uie-evidence-field" data-index="${idx}" data-ev-index="${evIdx}" data-field="type" style="font-size: 11px; height: 26px; width: 80px;">
                                        <option value="physical" ${ev.type === "physical" ? "selected" : ""}>Physical</option>
                                        <option value="digital" ${ev.type === "digital" ? "selected" : ""}>Digital</option>
                                        <option value="rumor" ${ev.type === "rumor" ? "selected" : ""}>Rumor</option>
                                        <option value="testimony" ${ev.type === "testimony" ? "selected" : ""}>Testimony</option>
                                    </select>
                                    <label style="font-size: 10px; display: flex; align-items: center; gap: 2px;">
                                        <input type="checkbox" class="uie-evidence-field-check" data-index="${idx}" data-ev-index="${evIdx}" data-field="discovered" ${ev.discovered ? "checked" : ""}> Found
                                    </label>
                                    <label style="font-size: 10px; display: flex; align-items: center; gap: 2px;">
                                        <input type="checkbox" class="uie-evidence-field-check" data-index="${idx}" data-ev-index="${evIdx}" data-field="destroyed" ${ev.destroyed ? "checked" : ""}> Destroyed
                                    </label>
                                    <button type="button" class="uie-npc-btn secondary uie-delete-evidence-btn" data-index="${idx}" data-ev-index="${evIdx}" style="height: 24px; padding: 0 4px; color: #991b1b; border-color: #fca5a5;"><i class="fas fa-times"></i></button>
                                </div>
                            `).join("")}
                        </div>
                    </div>
                </div>
            `;
        });
    }

    html += `</div>`;
    container.innerHTML = html;

    // Bind event listeners for input changes
    container.querySelectorAll(".uie-secret-field").forEach(el => {
        const idx = parseInt(el.dataset.index, 10);
        const field = el.dataset.field;
        el.addEventListener("input", (e) => {
            const val = e.target.value;
            const sec = state.currentNpcSecrets[idx];
            if (field === "targets" || field === "accomplices" || field === "witnesses") {
                sec[field] = val.split(",").map(x => x.trim()).filter(Boolean);
            } else if (field === "behaviorRules" || field === "contradictionRules" || field === "triggerConditions" || field === "escalationPlan" || field === "consequencesIfExposed") {
                sec[field] = val.split("\n").map(x => x.trim()).filter(Boolean);
            } else {
                sec[field] = val;
            }
        });
        el.addEventListener("change", (e) => {
            const sec = state.currentNpcSecrets[idx];
            sec.updatedAt = new Date().toISOString();
        });
    });

    container.querySelectorAll(".uie-evidence-field").forEach(el => {
        const idx = parseInt(el.dataset.index, 10);
        const evIdx = parseInt(el.dataset.evIndex, 10);
        const field = el.dataset.field;
        el.addEventListener("input", (e) => {
            state.currentNpcSecrets[idx].evidence[evIdx][field] = e.target.value;
        });
    });

    container.querySelectorAll(".uie-evidence-field-check").forEach(el => {
        const idx = parseInt(el.dataset.index, 10);
        const evIdx = parseInt(el.dataset.evIndex, 10);
        const field = el.dataset.field;
        el.addEventListener("change", (e) => {
            state.currentNpcSecrets[idx].evidence[evIdx][field] = e.target.checked;
        });
    });

    // Toggle debug mode
    document.getElementById("uie-npc-secrets-debug-toggle")?.addEventListener("change", (e) => {
        state.includeHiddenSecretsInDebug = e.target.checked;
        const s = getSettings();
        s.includeHiddenSecretsInDebug = e.target.checked;
        saveSettings();
    });

    // Add Secret
    document.getElementById("uie-npc-add-secret-btn")?.addEventListener("click", () => {
        const newSec = normalizeSimpleSecret("New hidden secret truth", { name: getField("uie-npc-name")?.value });
        newSec.title = "New Secret";
        state.currentNpcSecrets.push(newSec);
        renderSecretsTab();
    });

    // Duplicate Secret
    container.querySelectorAll(".uie-duplicate-secret-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = parseInt(btn.dataset.index, 10);
            const secCopy = JSON.parse(JSON.stringify(state.currentNpcSecrets[idx]));
            secCopy.id = `secret_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
            secCopy.title = "Copy of " + secCopy.title;
            state.currentNpcSecrets.push(secCopy);
            renderSecretsTab();
        });
    });

    // Archive / Restore
    container.querySelectorAll(".uie-archive-secret-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = parseInt(btn.dataset.index, 10);
            const sec = state.currentNpcSecrets[idx];
            if (sec.archived) {
                sec.archived = false;
                sec.active = true;
            } else {
                sec.archived = true;
            }
            renderSecretsTab();
        });
    });

    // Delete Secret
    container.querySelectorAll(".uie-delete-secret-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = parseInt(btn.dataset.index, 10);
            if (confirm(`Are you sure you want to delete the secret "${state.currentNpcSecrets[idx].title}"?`)) {
                const deleted = state.currentNpcSecrets.splice(idx, 1)[0];
                cleanOrphanedReferences(deleted.id);
                renderSecretsTab();
            }
        });
    });

    // Add Evidence
    container.querySelectorAll(".uie-add-evidence-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = parseInt(btn.dataset.index, 10);
            const sec = state.currentNpcSecrets[idx];
            if (!Array.isArray(sec.evidence)) sec.evidence = [];
            sec.evidence.push({
                id: `evidence_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
                type: "physical",
                description: "Evidence description",
                location: "Location",
                discovered: false,
                destroyed: false
            });
            renderSecretsTab();
        });
    });

    // Delete Evidence
    container.querySelectorAll(".uie-delete-evidence-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = parseInt(btn.dataset.index, 10);
            const evIdx = parseInt(btn.dataset.evIndex, 10);
            state.currentNpcSecrets[idx].evidence.splice(evIdx, 1);
            renderSecretsTab();
        });
    });
}

export function applySecretPatches(patches) {
    if (!Array.isArray(patches) || !patches.length) return;
    const s = getSettings();
    let changed = false;

    patches.forEach(patch => {
        const npcId = String(patch.npcId || "").trim();
        const secretId = String(patch.secretId || "").trim();
        const op = String(patch.operation || "").toLowerCase();
        if (!npcId) return;

        if (!s.npcs) s.npcs = [];
        let npc = s.npcs.find(n => n.id === npcId || n.name === npcId || n.cardId === npcId);
        
        if (!npc && s.social && Array.isArray(s.social.associates)) {
            npc = s.social.associates.find(n => n.id === npcId || n.name === npcId || n.cardId === npcId);
        }
        if (!npc && Array.isArray(s.character_cards)) {
            npc = s.character_cards.find(n => n.id === npcId || n.name === npcId || n.cardId === npcId);
        }

        if (!npc) return;

        if (!Array.isArray(npc.secrets)) npc.secrets = [];

        if (op === "create") {
            const newSecret = normalizeObjectSecret(patch.changes || {}, npc);
            if (patch.secretId) newSecret.id = patch.secretId;
            if (!npc.secrets.some(s => s.id === newSecret.id || s.title === newSecret.title)) {
                npc.secrets.push(newSecret);
                changed = true;
            }
        } else {
            const secIdx = npc.secrets.findIndex(sec => sec.id === secretId || (typeof sec === "object" && sec.title === secretId));
            if (secIdx !== -1) {
                const sec = npc.secrets[secIdx];
                if (op === "patch") {
                    const changes = patch.changes || {};
                    for (const [key, val] of Object.entries(changes)) {
                        setNestedProperty(sec, key, val);
                    }
                    sec.updatedAt = new Date().toISOString();
                    changed = true;
                } else if (op === "archive") {
                    sec.archived = true;
                    sec.updatedAt = new Date().toISOString();
                    changed = true;
                } else if (op === "restore") {
                    sec.archived = false;
                    sec.active = true;
                    sec.updatedAt = new Date().toISOString();
                    changed = true;
                } else if (op === "delete") {
                    npc.secrets.splice(secIdx, 1);
                    cleanOrphanedReferences(secretId);
                    changed = true;
                } else if (op === "reveal_to_character") {
                    if (!sec.awareness) sec.awareness = {};
                    if (!Array.isArray(sec.awareness.knownByNpcIds)) sec.awareness.knownByNpcIds = [];
                    const charId = String(patch.changes?.characterId || patch.changes || "").trim();
                    if (charId && !sec.awareness.knownByNpcIds.includes(charId)) {
                        sec.awareness.knownByNpcIds.push(charId);
                    }
                    sec.updatedAt = new Date().toISOString();
                    changed = true;
                } else if (op === "conceal_from_character") {
                    if (sec.awareness) {
                        const charId = String(patch.changes?.characterId || patch.changes || "").trim();
                        if (sec.awareness.knownByNpcIds) {
                            sec.awareness.knownByNpcIds = sec.awareness.knownByNpcIds.filter(id => id !== charId);
                        }
                        if (sec.awareness.suspectedByNpcIds) {
                            sec.awareness.suspectedByNpcIds = sec.awareness.suspectedByNpcIds.filter(id => id !== charId);
                        }
                    }
                    sec.updatedAt = new Date().toISOString();
                    changed = true;
                } else if (op === "mark_suspected") {
                    if (!sec.awareness) sec.awareness = {};
                    if (!Array.isArray(sec.awareness.suspectedByNpcIds)) sec.awareness.suspectedByNpcIds = [];
                    const charId = String(patch.changes?.characterId || patch.changes || "").trim();
                    if (charId && !sec.awareness.suspectedByNpcIds.includes(charId)) {
                        sec.awareness.suspectedByNpcIds.push(charId);
                    }
                    if (!sec.exposure) sec.exposure = {};
                    sec.exposure.status = "suspected";
                    sec.updatedAt = new Date().toISOString();
                    changed = true;
                } else if (op === "mark_partially_discovered") {
                    if (!sec.exposure) sec.exposure = {};
                    if (!sec.awareness) sec.awareness = {};
                    sec.exposure.status = "partially_discovered";
                    sec.awareness.playerKnows = true;
                    sec.exposure.lastNearExposureAt = new Date().toISOString();
                    sec.updatedAt = new Date().toISOString();
                    changed = true;
                } else if (op === "mark_discovered") {
                    if (!sec.exposure) sec.exposure = {};
                    if (!sec.awareness) sec.awareness = {};
                    sec.exposure.status = "discovered";
                    sec.awareness.playerKnows = true;
                    sec.exposure.exposedAt = new Date().toISOString();
                    sec.updatedAt = new Date().toISOString();
                    changed = true;
                } else if (op === "mark_public") {
                    if (!sec.exposure) sec.exposure = {};
                    sec.exposure.status = "public";
                    sec.updatedAt = new Date().toISOString();
                    changed = true;
                } else if (op === "attach_evidence") {
                    if (!Array.isArray(sec.evidence)) sec.evidence = [];
                    const evidenceObj = patch.changes || {};
                    if (!sec.evidence.some(e => e.id === evidenceObj.id)) {
                        sec.evidence.push({
                            id: evidenceObj.id || `evidence_${Date.now().toString(36)}`,
                            type: evidenceObj.type || "physical",
                            description: evidenceObj.description || "",
                            location: evidenceObj.location || "",
                            discovered: !!evidenceObj.discovered,
                            destroyed: !!evidenceObj.destroyed
                        });
                    }
                    sec.updatedAt = new Date().toISOString();
                    changed = true;
                } else if (op === "destroy_evidence") {
                    const evidenceId = String(patch.changes?.evidenceId || patch.changes || "").trim();
                    if (Array.isArray(sec.evidence)) {
                        const ev = sec.evidence.find(e => e.id === evidenceId);
                        if (ev) {
                            ev.destroyed = true;
                            changed = true;
                        }
                    }
                    sec.updatedAt = new Date().toISOString();
                } else if (op === "link_secret") {
                    if (!Array.isArray(sec.relatedSecretIds)) sec.relatedSecretIds = [];
                    const linkId = String(patch.changes?.secretId || patch.changes || "").trim();
                    if (linkId && !sec.relatedSecretIds.includes(linkId)) {
                        sec.relatedSecretIds.push(linkId);
                        changed = true;
                    }
                    sec.updatedAt = new Date().toISOString();
                } else if (op === "unlink_secret") {
                    if (Array.isArray(sec.relatedSecretIds)) {
                        const linkId = String(patch.changes?.secretId || patch.changes || "").trim();
                        sec.relatedSecretIds = sec.relatedSecretIds.filter(id => id !== linkId);
                        changed = true;
                    }
                    sec.updatedAt = new Date().toISOString();
                }
            }
        }

        if (changed) {
            upsertLocalNpc(npc);
        }
    });

    if (changed) {
        saveSettings();
    }
}
