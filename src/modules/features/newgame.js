import { getSettings, resetForNewGame, saveSettings } from "../core.js";
import { generateContent } from "../apiClient.js";
import { normalizeLifeTracker } from "./life.js";
import { fetchTemplateHtml } from "../templateFetch.js";
import { ensureTravelAssetFields } from "../travelAssets.js";
import { generateRandomName } from "../nameRandomizer.js";
import {
  ADVENTURE_PATH_PRESET_ID,
  applyAdventurePathClassLoadout,
  applyAdventurePathPresetState,
  installAdventurePathMap,
  loadAdventurePathSourceData
} from "../storyPresets.js";

let mounted = false;
let editingStatIndex = -1;
let editingTrackerIndex = -1;
let editingItemIndex = -1;
let editingSkillIndex = -1;
let editingQuestIndex = -1;
let editingAssetIndex = -1;
let itemFormMode = "standard";
let awaitingNewGameNpc = false;

function lifeTrackerKey(value = "") {
  return String(value || "tracker").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "tracker";
}

function isHpLifeTracker(tracker) {
  const key = lifeTrackerKey(tracker?.id || tracker?.key || tracker?.name || tracker?.label || "");
  return key === "hp" || key === "health" || key === "hit_points" || key === "hitpoints";
}

function applyLifeTrackersToSettings(settings, rawTrackers = [], vitalIcons = {}) {
  if (!settings || typeof settings !== "object") return [];
  const normalized = (Array.isArray(rawTrackers) ? rawTrackers : []).map((raw) => {
    const tracker = normalizeLifeTracker(raw);
    return {
      ...tracker,
      id: raw?.id || lifeTrackerKey(tracker.name),
      visible: raw?.visible !== false
    };
  });

  if (!normalized.some(isHpLifeTracker)) {
    normalized.unshift({
      id: "hp",
      name: "HP",
      current: Number(settings.hp || settings.playerProgress?.hp || 100) || 100,
      max: Number(settings.maxHp || settings.playerProgress?.maxHp || 100) || 100,
      color: "#ff6b6b",
      icon: vitalIcons.hp || "fa-heart",
      notes: "Base health tracker.",
      sources: ["story", "item"],
      visible: true
    });
  }

  const hpTracker = normalized.find(isHpLifeTracker);
  const maxHp = Math.max(1, Number(hpTracker?.max || settings.maxHp || 100));
  const hp = Math.max(0, Math.min(maxHp, Number(hpTracker?.current ?? settings.hp ?? maxHp)));
  settings.hp = hp;
  settings.maxHp = maxHp;

  settings.life = { ...(settings.life || {}), trackers: normalized };
  settings.playerProgress = settings.playerProgress && typeof settings.playerProgress === "object" ? settings.playerProgress : {};
  settings.playerProgress.hp = hp;
  settings.playerProgress.maxHp = maxHp;
  settings.playerProgress.needs = settings.playerProgress.needs && typeof settings.playerProgress.needs === "object" ? settings.playerProgress.needs : {};

  for (const tracker of normalized) {
    if (isHpLifeTracker(tracker)) continue;
    const key = lifeTrackerKey(tracker.name);
    const current = Number(tracker.current);
    if (Number.isFinite(current)) settings.playerProgress.needs[key] = current;
  }

  settings.ui = settings.ui || {};
  settings.ui.hudToggles = settings.ui.hudToggles || {};
  settings.ui.hudToggles.hp = hpTracker?.visible !== false;
  settings.ui.hudToggles.hpIcon = vitalIcons.hp || settings.ui.hudToggles.hpIcon || "fa-heart";
  settings.ui.customTrackers = normalized
    .filter((tracker) => !isHpLifeTracker(tracker))
    .map((tracker, index) => ({
      id: `trk_${lifeTrackerKey(tracker.name || index)}`,
      key: lifeTrackerKey(tracker.name || `tracker_${index}`),
      label: tracker.name,
      icon: tracker.icon || "fa-heart",
      max: tracker.max,
      color: tracker.color,
      showBar: true,
      enabled: tracker.visible !== false
    }));

  return normalized;
}

function setNewGameLoading(status, progress = null) {
  const loadingEl = document.getElementById("loading");
  if (!loadingEl) return null;
  loadingEl.classList.remove("uie-loading-hidden");
  loadingEl.style.removeProperty("visibility");
  loadingEl.style.removeProperty("pointer-events");
  loadingEl.style.display = "flex";
  loadingEl.style.opacity = "1";
  const statusEl = loadingEl.querySelector(".loading-status, .loading-subtitle");
  if (statusEl && status) statusEl.textContent = status;
  const fillEl = document.getElementById("loading-fill") || document.getElementById("loading-bar-fill");
  if (fillEl && Number.isFinite(Number(progress))) fillEl.style.width = `${Math.max(0, Math.min(100, Number(progress)))}%`;
  return loadingEl;
}

const DEFAULT_STAT_LABELS = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};

function applyModeBackplate(mode = "modern") {
  const value = ["lifesim", "rpg", "modern", "high-fantasy", "futuristic"].includes(String(mode || ""))
    ? String(mode)
    : "modern";
  document.getElementById("uie-newgame-overlay")?.setAttribute("data-mode-backplate", value);
}

const NG_FACTION_TYPES = [
  { value: "crew", label: "Crew", hint: "Small active group" },
  { value: "family", label: "Family", hint: "House or clan" },
  { value: "school", label: "School", hint: "Class, club, faculty" },
  { value: "business", label: "Business", hint: "Shop, company, venue" },
  { value: "guild", label: "Guild", hint: "Trade or craft body" },
  { value: "government", label: "Government", hint: "Town, city, state" },
  { value: "gang", label: "Gang", hint: "Street or underworld" },
  { value: "religion", label: "Faith", hint: "Temple or order" }
];

const NG_FACTION_REP = [
  { value: -80, label: "Hostile", hint: "They oppose you" },
  { value: -35, label: "Distrust", hint: "Trouble already" },
  { value: 0, label: "Neutral", hint: "No history yet" },
  { value: 35, label: "Friendly", hint: "They know you" },
  { value: 80, label: "Trusted", hint: "You have pull" }
];

const NG_FACTION_STATUS = [
  { value: "none", label: "Outsider", hint: "No membership" },
  { value: "initiate", label: "Initiate", hint: "Newly connected" },
  { value: "member", label: "Member", hint: "Belongs there" },
  { value: "officer", label: "Officer", hint: "Has authority" },
  { value: "leader", label: "Leader", hint: "Runs it" }
];

const NG_FACTION_SCOPES = [
  { value: "room", label: "Room", hint: "One interior" },
  { value: "building", label: "Building", hint: "Home, shop, school" },
  { value: "settlement", label: "Town / City", hint: "Civic control" },
  { value: "region", label: "Region", hint: "District, province" },
  { value: "world", label: "World", hint: "Global authority" }
];

let newGameState = {
  character: {
    name: "",
    class: "warrior",
    customClass: "",
    resourceProfile: "ap",
    race: "",
    mode: "modern",
    level: 1,
    age: 18,
    aging: { enabled: false, speed: 1 },
    vitalIcons: { hp: "fa-heart", ap: "fa-bolt", mp: "fa-wand-magic-sparkles", xp: "fa-star" },
    vitalLabels: { hp: "HP", ap: "AP", mp: "MP", xp: "XP" },
    stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    statLabels: { ...DEFAULT_STAT_LABELS },
    alignment: "neutral-good"
  },
  appearance: {
    description: "",
    backstory: "",
    sprites: []
  },
  lorebook: {
    entries: [],
    selectedBooks: []
  },
  currency: {
    name: "Gold",
    symbol: "🪙",
    amount: 100,
    realValue: 0.01
  },
  factions: [],
  reputation: {},
  lifeTrackers: [
    { name: "HP", current: 100, max: 100, color: "#ff6b6b", icon: "fa-heart", visible: true },
    { name: "AP", current: 100, max: 100, color: "#4dadf7", icon: "fa-bolt", visible: true },
    { name: "MP", current: 100, max: 100, color: "#b26cff", icon: "fa-wand-magic-sparkles", visible: true },
    { name: "XP", current: 0, max: 100, color: "#ffc107", icon: "fa-star", visible: true }
  ],
  inventory: [],
  skills: [],
  quests: [],
  assets: [],
  location: {
    type: "room",
    name: "",
    description: "",
    terrain: "forest",
    danger: "safe",
    npcs: [],
    npcDetails: [],
    bg: "",
    startingSequence: ""
  },
  worldScope: {
    type: "local",
    mode: "hybrid",
    seedName: "",
    counts: { worlds: 1, regions: 1, settlements: 1, places: 6, roomsPerInterior: 8, blueprintMode: "sites" },
    description: ""
  }
};

async function ensureNewGameOverlay() {
  let overlay = document.getElementById("uie-newgame-overlay");
  if (overlay) return overlay;
  const urls = [];
  const rawBase = String(window.UIE_BASEURL || "").trim();
  if (rawBase && rawBase !== "/") {
    const cleanBase = rawBase.replace(/\/+$/, "");
    urls.push(`${cleanBase}/src/templates/newgame.html`);
  }
  urls.push(`./src/templates/newgame.html`);
  urls.push(`src/templates/newgame.html`);
  urls.push(`/src/templates/newgame.html`);

  for (const url of urls) {
    try {
      const html = await fetchTemplateHtml(url);
      if (String(html || "").trim()) {
        document.body.insertAdjacentHTML("beforeend", html);
        overlay = document.getElementById("uie-newgame-overlay");
        if (overlay) return overlay;
      }
    } catch (_) {}
  }
  return null;
}

function forceNewGameOverlayVisible(overlay = document.getElementById("uie-newgame-overlay")) {
  if (!overlay || window.__uieNewGameSetupActive !== true) return;
  overlay.classList.add("active");
  overlay.style.setProperty("display", "flex", "important");
  overlay.style.removeProperty("visibility");
  overlay.style.removeProperty("opacity");
  overlay.style.setProperty("pointer-events", "auto", "important");
  overlay.setAttribute("aria-hidden", "false");
}

export async function showNewGamePopup() {
  window.__uieNewGameSetupOpening = true;
  const overlay = await ensureNewGameOverlay();
  if (!overlay) {
    window.__uieNewGameSetupOpening = false;
    return console.warn("[NewGame] Overlay not found");
  }
  try {
    const loading = document.getElementById("loading");
    if (loading) {
      loading.classList.add("uie-loading-hidden");
      loading.style.setProperty("display", "none", "important");
      loading.style.setProperty("visibility", "hidden", "important");
      loading.style.setProperty("pointer-events", "none", "important");
    }
    const startup = document.getElementById("startup-modal");
    if (startup) {
      startup.style.setProperty("display", "none", "important");
      startup.style.setProperty("pointer-events", "none", "important");
    }
    document.getElementById("uie-newgame-tutorial-choice")?.remove();
  } catch (_) {}
  window.__uieNewGameSetupActive = true;
  forceNewGameOverlayVisible(overlay);
  init();
  const tutorialChkBx = document.getElementById("ng-location-tutorial-enabled");
  if (tutorialChkBx) {
    tutorialChkBx.checked = true;
  }
  const activeTab = overlay.querySelector(".uie-newgame-tab.active")?.getAttribute("data-tab") || "character";
  switchTab(activeTab);
  try {
    const mod = window.importUieModule ? await window.importUieModule("tutorial.js") : await import("../tutorial.js");
    mod.installTutorialSystem?.();
  } catch (_) {}
  renderFactionChoiceControls();
  renderLocationNpcs();
  renderLibraryCards();
  renderSavedLorebooks();
  window.__uieNewGameSetupOpening = false;
  forceNewGameOverlayVisible(overlay);
  setTimeout(() => forceNewGameOverlayVisible(overlay), 50);
  setTimeout(() => forceNewGameOverlayVisible(overlay), 250);
  setTimeout(() => forceNewGameOverlayVisible(overlay), 1000);
  window.playMainMenuBgm?.();
}

export function hideNewGamePopup(returnToMenu = true) {
  window.__uieNewGameSetupOpening = false;
  window.__uieNewGameSetupActive = false;
  const overlay = document.getElementById("uie-newgame-overlay");
  if (overlay) {
    overlay.classList.remove("active");
    overlay.style.removeProperty("display");
    overlay.setAttribute("aria-hidden", "true");
  }
  // Smoothly return to Main Menu
  if (returnToMenu) {
    if (window.$) {
      const startup = document.getElementById("startup-modal");
      if (startup) {
        startup.style.removeProperty("display");
        startup.style.removeProperty("pointer-events");
      }
      window.$("#startup-modal").fadeIn(300);
    } else {
      const startup = document.getElementById("startup-modal");
      if (startup) {
        startup.style.removeProperty("display");
        startup.style.display = "flex";
        startup.style.opacity = "1";
        startup.style.removeProperty("pointer-events");
      }
    }
  }
}

function updateEnabledStatsFromUi() {
  const enabledStats = {};
  for (const tracker of newGameState.lifeTrackers || []) {
    const key = String(tracker?.name || "").trim().toLowerCase();
    if (/^(hp|ap|mp|xp)$/.test(key)) enabledStats[key] = tracker.visible !== false;
  }
  newGameState.character.enabledStats = enabledStats;
  newGameState.character.vitalLabels = newGameState.character.vitalLabels || {};
  newGameState.character.vitalIcons = newGameState.character.vitalIcons || {};
  for (const tracker of newGameState.lifeTrackers || []) {
    const key = String(tracker?.name || "").trim().toLowerCase();
    if (!/^(hp|ap|mp|xp)$/.test(key)) continue;
    newGameState.character.vitalLabels[key] = String(tracker.name || key.toUpperCase()).slice(0, 24);
    newGameState.character.vitalIcons[key] = String(tracker.icon || newGameState.character.vitalIcons[key] || "fa-heart");
  }
}

function syncCheckboxesFromClass(cls) {
  const profile = String(newGameState.character.resourceProfile || "").trim();
  for (const tracker of newGameState.lifeTrackers || []) {
    const key = String(tracker?.name || "").trim().toLowerCase();
    if (key === "hp" || key === "xp") tracker.visible = true;
    if (key === "ap") tracker.visible = profile !== "mp";
    if (key === "mp") tracker.visible = profile !== "ap";
  }
  updateEnabledStatsFromUi();
  renderPrimaryBars();
  renderTrackers();
}

const TRACKER_ICONS = [
  "fa-heart","fa-shield-heart","fa-bolt","fa-wand-magic-sparkles","fa-star","fa-trophy","fa-seedling","fa-crown",
  "fa-book-open","fa-brain","fa-fire","fa-droplet","fa-moon","fa-sun","fa-cloud","fa-snowflake","fa-wind","fa-gem",
  "fa-coins","fa-wallet","fa-music","fa-microphone","fa-person-running","fa-dumbbell","fa-shield-halved","fa-khanda",
  "fa-bowl-food","fa-mug-hot","fa-bed","fa-bath","fa-face-smile","fa-face-angry","fa-hand-fist","fa-briefcase",
  "fa-graduation-cap","fa-car","fa-house","fa-users","fa-scale-balanced","fa-location-dot"
];

function populateIconPickers() {
  document.querySelectorAll(".ng-icon-picker").forEach((select) => {
    const existing = new Set(Array.from(select.options).map((option) => option.value));
    TRACKER_ICONS.forEach((icon) => {
      if (!existing.has(icon)) select.add(new Option(icon.replace(/^fa-/, "").replaceAll("-", " "), icon));
    });
  });
}

function renderChoiceButtons(containerId, options, activeValue, inputId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  options.forEach((option) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `uie-ng-choice${String(option.value) === String(activeValue) ? " active" : ""}`;
    btn.innerHTML = `<b>${escapeHtml(option.label)}</b><span>${escapeHtml(option.hint || "")}</span>`;
    btn.addEventListener("click", () => {
      const input = document.getElementById(inputId);
      if (input) input.value = String(option.value);
      renderChoiceButtons(containerId, options, option.value, inputId);
    });
    container.appendChild(btn);
  });
}

function renderFactionChoiceControls() {
  renderChoiceButtons("ng-faction-type-picks", NG_FACTION_TYPES, document.getElementById("ng-faction-type")?.value || "crew", "ng-faction-type");
  renderChoiceButtons("ng-faction-rep-picks", NG_FACTION_REP, document.getElementById("ng-faction-rep")?.value || "0", "ng-faction-rep");
  renderChoiceButtons("ng-faction-status-picks", NG_FACTION_STATUS, document.getElementById("ng-faction-status")?.value || "none", "ng-faction-status");
  renderChoiceButtons("ng-faction-scope-picks", NG_FACTION_SCOPES, document.getElementById("ng-faction-scope")?.value || "building", "ng-faction-scope");
}

function slugKey(value, fallback = "stat") {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || fallback;
}

function getBaseStatEntries() {
  const stats = newGameState.character.stats && typeof newGameState.character.stats === "object" ? newGameState.character.stats : {};
  const labels = newGameState.character.statLabels && typeof newGameState.character.statLabels === "object" ? newGameState.character.statLabels : {};
  return Object.keys(stats).map((key) => ({
    key,
    label: String(labels[key] || DEFAULT_STAT_LABELS[key] || key.toUpperCase()),
    value: Number(stats[key] ?? 0)
  }));
}

function resetStatForm() {
  editingStatIndex = -1;
  const ids = ["ng-stat-name", "ng-stat-key"];
  ids.forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
  const val = document.getElementById("ng-stat-value");
  if (val) val.value = "10";
  const btn = document.getElementById("ng-stat-add-btn");
  if (btn) btn.textContent = "+ Add Stat";
  const cancel = document.getElementById("ng-stat-cancel-btn");
  if (cancel) cancel.style.display = "none";
}

function normalizeNewGameSkill(raw = {}) {
  const category = String(raw.category || raw.categoryType || raw.school || raw.type || "combat").trim() || "combat";
  const proficiency = String(raw.proficiency || raw.rank || raw.levelLabel || raw.level || "novice").trim() || "novice";
  const numericLevel = /^\d+$/.test(proficiency) ? proficiency : ({
    novice: "1",
    apprentice: "2",
    proficient: "3",
    expert: "4",
    master: "5"
  }[proficiency.toLowerCase()] || "1");
  const description = String(raw.description || raw.desc || "").trim();
  return {
    ...raw,
    kind: "skill",
    name: String(raw.name || "Skill").trim() || "Skill",
    category,
    proficiency,
    level: numericLevel,
    levelLabel: proficiency,
    type: String(raw.skillType || raw.actionType || "active").trim().toLowerCase() === "passive" ? "passive" : "active",
    skillType: String(raw.skillType || raw.actionType || "active").trim().toLowerCase() === "passive" ? "passive" : "active",
    description,
    desc: description
  };
}

function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

function setAvatarPreview(url) {
  const preview = document.getElementById("ng-character-avatar-preview");
  const hidden = document.getElementById("ng-character-avatar");
  if (hidden) hidden.value = String(url || "");
  if (!preview) return;
  if (url) {
    preview.style.backgroundImage = `url("${url}")`;
    preview.style.display = "block";
  } else {
    preview.style.backgroundImage = "";
    preview.style.display = "none";
  }
}

function buildPersonaExpressionsFromSprites(sprites = []) {
  const grouped = new Map();
  for (const sprite of Array.isArray(sprites) ? sprites : []) {
    const name = String(sprite?.label || "neutral").trim() || "neutral";
    const key = name.toLowerCase();
    if (!grouped.has(key)) grouped.set(key, { name, emoji: "", intensity: 1, sprites: [] });
    grouped.get(key).sprites.push({
      name: String(sprite?.label || "sprite"),
      src: String(sprite?.url || ""),
      agingVariant: sprite?.agingVariant === true
    });
  }
  return Array.from(grouped.values()).filter((entry) => entry.sprites.some((sprite) => sprite.src));
}

function init() {
  const ngOverlay = document.getElementById("uie-newgame-overlay");
  if (ngOverlay?.dataset.uieNewgameMounted === "true") {
    mounted = true;
    const activeTab = ngOverlay.querySelector(".uie-newgame-tab.active")?.getAttribute("data-tab") || "character";
    switchTab(activeTab);
    return;
  }
  if (ngOverlay) ngOverlay.dataset.uieNewgameMounted = "true";
  mounted = true;
  populateIconPickers();
  renderFactionChoiceControls();
  installCharacterCardsSyncHook();

  // Backdrop click dismissal
  let uieNewGameMousedownTarget = null;
  ngOverlay?.addEventListener("mousedown", (e) => {
    uieNewGameMousedownTarget = e.target;
  });
  ngOverlay?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget && uieNewGameMousedownTarget === e.currentTarget) {
      hideNewGamePopup();
    }
  });

  // Tab switching
  const tabs = document.querySelectorAll(".uie-newgame-tab");
  tabs.forEach(tab => {
    tab.setAttribute("type", "button");
    tab.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      switchTab(tab.getAttribute("data-tab"));
    });
  });
  ngOverlay?.addEventListener("click", (event) => {
    const tab = event.target?.closest?.(".uie-newgame-tab");
    if (!tab) return;
    event.preventDefault();
    event.stopPropagation();
    switchTab(tab.getAttribute("data-tab"));
  });

  // Close buttons
  document.getElementById("uie-newgame-close-btn")?.addEventListener("click", hideNewGamePopup);
  document.getElementById("uie-newgame-cancel-btn")?.addEventListener("click", hideNewGamePopup);
  document.getElementById("uie-newgame-start-btn")?.addEventListener("click", startNewGame);
  document.getElementById("ng-preset-custom")?.addEventListener("click", selectCustomPreset);
  document.getElementById("ng-preset-adventure-path")?.addEventListener("click", selectAdventurePathPreset);

  // Initialize enabledStats from UI
  updateEnabledStatsFromUi();
  if (!newGameState.character.vitalLabels) newGameState.character.vitalLabels = { ap: "AP", mp: "MP", xp: "XP" };

  // Character tab
  document.getElementById("ng-char-name")?.addEventListener("input", (e) => {
    newGameState.character.name = e.target.value;
  });
  document.getElementById("ng-char-class")?.addEventListener("change", (e) => {
    const val = e.target.value;
    newGameState.character.class = val;
    
    // Toggle custom class input visibility
    const customContainer = document.getElementById("ng-custom-class-container");
    if (customContainer) {
      customContainer.style.display = (val === "custom") ? "block" : "none";
    }

    // Auto-map resource profile based on standard classes
    const profileSelect = document.getElementById("ng-char-resource-profile");
    if (profileSelect) {
      let targetProfile = "";
      if (["warrior", "rogue", "ranger"].includes(val)) {
        targetProfile = "ap";
      } else if (["mage", "cleric", "druid"].includes(val)) {
        targetProfile = "mp";
      } else if (["paladin", "bard"].includes(val)) {
        targetProfile = "both";
      }
      
      if (targetProfile) {
        profileSelect.value = targetProfile;
        newGameState.character.resourceProfile = targetProfile;
      }
    }
    syncCheckboxesFromClass(val);
    if (newGameState.presetId === ADVENTURE_PATH_PRESET_ID) {
      applyAdventurePathClassLoadout(newGameState, val);
      syncPresetFieldsToUi();
    }
  });
  document.getElementById("ng-char-class-custom")?.addEventListener("input", (e) => {
    newGameState.character.customClass = e.target.value;
  });
  document.getElementById("ng-char-resource-profile")?.addEventListener("change", (e) => {
    const val = e.target.value;
    newGameState.character.resourceProfile = val;
    syncCheckboxesFromClass(newGameState.character.class);
  });
  document.getElementById("ng-char-race")?.addEventListener("input", (e) => {
    newGameState.character.race = e.target.value;
  });
  document.getElementById("ng-char-mode")?.addEventListener("change", (e) => {
    newGameState.character.mode = e.target.value;
    applyModeBackplate(newGameState.character.mode);
  });
  document.getElementById("ng-char-level")?.addEventListener("change", (e) => {
    newGameState.character.level = Math.max(1, parseInt(e.target.value) || 1);
  });
  document.getElementById("ng-char-age")?.addEventListener("change", (e) => {
    newGameState.character.age = Math.max(0, parseInt(e.target.value) || 0);
  });
  document.getElementById("ng-aging-enabled")?.addEventListener("change", (e) => {
    newGameState.character.aging.enabled = e.target.checked === true;
  });
  document.getElementById("ng-aging-speed")?.addEventListener("change", (e) => {
    newGameState.character.aging.speed = parseFloat(e.target.value) || 1;
  });
  document.getElementById("ng-alignment")?.addEventListener("change", (e) => {
    newGameState.character.alignment = e.target.value;
  });

  // Stats
  document.getElementById("ng-stat-add-btn")?.addEventListener("click", addOrUpdateBaseStat);
  document.getElementById("ng-stat-cancel-btn")?.addEventListener("click", resetStatForm);

  // Appearance tab
  document.getElementById("ng-appearance-desc")?.addEventListener("input", (e) => {
    newGameState.appearance.description = e.target.value;
  });
  document.getElementById("ng-backstory")?.addEventListener("input", (e) => {
    newGameState.appearance.backstory = e.target.value;
  });

  // Active portrait
  document.getElementById("ng-character-avatar")?.addEventListener("input", (e) => {
    newGameState.character.avatar = e.target.value;
    setAvatarPreview(newGameState.character.avatar);
  });
  document.getElementById("ng-character-avatar-picker-btn")?.addEventListener("click", () => {
    document.getElementById("ng-character-avatar-file")?.click();
  });
  document.getElementById("ng-character-avatar-clear-btn")?.addEventListener("click", () => {
    newGameState.character.avatar = "";
    setAvatarPreview("");
  });
  document.getElementById("ng-character-avatar-file")?.addEventListener("change", async function () {
    const file = this.files && this.files[0] ? this.files[0] : null;
    this.value = "";
    if (!file || !String(file.type || "").startsWith("image/")) return;
    const dataUrl = await readImageFileAsDataUrl(file);
    newGameState.character.avatar = dataUrl;
    setAvatarPreview(dataUrl);
  });
  document.getElementById("ng-sprite-picker-btn")?.addEventListener("click", () => {
    document.getElementById("ng-sprite-file")?.click();
  });
  document.getElementById("ng-sprite-file")?.addEventListener("change", addCharacterSpriteFromFile);

  // Currency & Organizations
  document.getElementById("ng-currency-name")?.addEventListener("input", (e) => {
    newGameState.currency.name = e.target.value;
  });
  document.getElementById("ng-currency-symbol")?.addEventListener("input", (e) => {
    newGameState.currency.symbol = e.target.value;
  });
  document.getElementById("ng-currency-amount")?.addEventListener("change", (e) => {
    newGameState.currency.amount = parseInt(e.target.value) || 0;
  });
  document.getElementById("ng-currency-value")?.addEventListener("change", (e) => {
    newGameState.currency.realValue = parseFloat(e.target.value) || 0;
  });

  document.getElementById("ng-faction-add-btn")?.addEventListener("click", addFaction);

  // Life Trackers
  document.getElementById("ng-tracker-add-btn")?.addEventListener("click", addLifeTracker);
  document.getElementById("ng-primary-bar-add-btn")?.addEventListener("click", () => {
    resetTrackerForm();
    switchTab("trackers");
    setTimeout(() => document.getElementById("ng-tracker-name")?.focus(), 0);
  });

  // Items
  document.getElementById("ng-item-add-btn")?.addEventListener("click", addItem);
  document.getElementById("ng-item-cancel-btn")?.addEventListener("click", resetItemForm);
  document.getElementById("ng-item-btn-mode-standard")?.addEventListener("click", () => setItemFormMode("standard"));
  document.getElementById("ng-item-btn-mode-equipment")?.addEventListener("click", () => setItemFormMode("equipment"));
  document.getElementById("ng-item-category-select")?.addEventListener("change", toggleItemCustomFields);
  document.getElementById("ng-item-eq-type-select")?.addEventListener("change", toggleItemCustomFields);

  // Skills
  document.getElementById("ng-skill-add-btn")?.addEventListener("click", addSkill);
  document.getElementById("ng-skill-cancel-btn")?.addEventListener("click", resetSkillForm);

  // Quests
  document.getElementById("ng-quest-add-btn")?.addEventListener("click", addQuest);
  document.getElementById("ng-quest-cancel-btn")?.addEventListener("click", resetQuestForm);

  // Lorebook
  document.getElementById("ng-lore-add-btn")?.addEventListener("click", addLoreEntry);
  document.getElementById("ng-lore-import-btn")?.addEventListener("click", () => document.getElementById("ng-lore-import-file")?.click());
  document.getElementById("ng-lore-export-btn")?.addEventListener("click", exportLorebook);
  document.getElementById("ng-lore-import-file")?.addEventListener("change", importLoreFile);

  // Assets
  document.getElementById("ng-asset-add-btn")?.addEventListener("click", addAsset);
  document.getElementById("ng-asset-cancel-btn")?.addEventListener("click", resetAssetForm);

  // Location
  document.getElementById("ng-location-generate-btn")?.addEventListener("click", generateLocationWithAI);
  
  // Location Background Picker
  document.getElementById("ng-location-bg-picker-btn")?.addEventListener("click", () => {
    document.getElementById("ng-location-bg-file")?.click();
  });
  document.getElementById("ng-location-bg-presets-btn")?.addEventListener("click", showPresetsGallery);
  document.getElementById("ng-location-bg-file")?.addEventListener("change", function () {
    const f = this.files && this.files[0] ? this.files[0] : null;
    if (!f || !String(f.type || "").startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const u = String(reader.result || "");
      if (u.length > 12000000) {
        alert("Image too large to store in save (try a smaller file).");
        return;
      }
      const bgUrlInput = document.getElementById("ng-location-bg-url");
      if (bgUrlInput) bgUrlInput.value = u;
      const bgPreview = document.getElementById("ng-location-bg-preview");
      if (bgPreview) {
        bgPreview.style.backgroundImage = `url("${u}")`;
        bgPreview.style.display = "block";
      }
      newGameState.location.bg = u;
    };
    reader.readAsDataURL(f);
  });
  document.getElementById("ng-location-bg-url")?.addEventListener("input", (e) => {
    const u = e.target.value || "";
    newGameState.location.bg = u;
    const bgPreview = document.getElementById("ng-location-bg-preview");
    if (bgPreview) {
      if (u) {
        bgPreview.style.backgroundImage = `url("${u}")`;
        bgPreview.style.display = "block";
      } else {
        bgPreview.style.display = "none";
      }
    }
  });
  document.getElementById("ng-location-npc-add-btn")?.addEventListener("click", addLocationNpc);
  document.getElementById("ng-open-character-cards-btn")?.addEventListener("click", openCharacterCardsManager);
  document.getElementById("ng-open-npc-modal-btn")?.addEventListener("click", openDynamicNpcManager);
  document.getElementById("uie-ng-card-picker-close")?.addEventListener("click", hideCharacterCardPicker);
  installNewGameNpcCreatedHook();
  let uieNgCardPickerMousedownTarget = null;
  const pickerOverlay = document.getElementById("uie-ng-card-picker-overlay");
  pickerOverlay?.addEventListener("mousedown", (e) => {
    uieNgCardPickerMousedownTarget = e.target;
  });
  pickerOverlay?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget && uieNgCardPickerMousedownTarget === e.currentTarget) {
      hideCharacterCardPicker();
    }
  });

  document.getElementById("ng-world-scope")?.addEventListener("change", () => { newGameState.worldScope.type = "local"; });
  document.getElementById("ng-world-mode")?.addEventListener("change", (e) => { newGameState.worldScope.mode = e.target.value || "hybrid"; });
  document.getElementById("ng-world-blueprint-mode")?.addEventListener("change", (e) => { newGameState.worldScope.counts.blueprintMode = e.target.value || "sites"; });
  document.getElementById("ng-world-seed-name")?.addEventListener("input", (e) => { newGameState.worldScope.seedName = e.target.value || ""; });
  [
    ["worlds", "ng-world-count-worlds"], ["regions", "ng-world-count-regions"],
    ["settlements", "ng-world-count-settlements"], ["places", "ng-world-count-places"],
    ["roomsPerInterior", "ng-world-count-rooms"]
  ].forEach(([key, id]) => document.getElementById(id)?.addEventListener("change", (e) => {
    newGameState.worldScope.counts[key] = Math.max(key === "settlements" ? 0 : 1, parseInt(e.target.value) || 0);
  }));
  document.getElementById("ng-world-description")?.addEventListener("input", (e) => {
    newGameState.worldScope.description = e.target.value || "";
  });

  // Initial renders
  renderFactions();
  renderBaseStats();
  renderPrimaryBars();
  renderCharacterSprites();
  renderTrackers();
  renderItems();
  renderSkills();
  renderQuests();
  renderLoreEntriesList();
  renderSavedLorebooks();
  renderAssets();
  renderLocationNpcs();
  setItemFormMode(itemFormMode);
}

function switchTab(tabName) {
  const overlay = document.getElementById("uie-newgame-overlay");
  const root = overlay || document;
  const safeTab = String(tabName || "character").trim() || "character";
  const escapedTab = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(safeTab) : safeTab.replace(/"/g, '\\"');
  const selectedContents = root.querySelectorAll(`.uie-newgame-content[data-tab="${escapedTab}"]`);
  const selectedTab = root.querySelector(`.uie-newgame-tab[data-tab="${escapedTab}"]`);
  if (!selectedContents.length || !selectedTab) {
    console.warn("[NewGame] Missing tab content:", safeTab);
    if (safeTab !== "character") switchTab("character");
    return;
  }
  // Hide all New Game tab contents without touching other tabbed UI.
  const contents = root.querySelectorAll(".uie-newgame-content");
  contents.forEach(content => content.classList.remove("active"));

  // Hide all New Game tabs without touching other tabbed UI.
  const tabButtons = root.querySelectorAll(".uie-newgame-tab");
  tabButtons.forEach(btn => btn.classList.remove("active"));

  selectedContents.forEach(content => content.classList.add("active"));
  selectedTab.classList.add("active");
  renderNewGameTab(safeTab);
}

function renderNewGameTab(tabName) {
  switch (String(tabName || "")) {
    case "character":
      renderBaseStats();
      renderPrimaryBars();
      break;
    case "appearance":
      renderCharacterSprites();
      break;
    case "currency":
      renderFactionChoiceControls();
      renderFactions();
      break;
    case "trackers":
      renderTrackers();
      renderPrimaryBars();
      break;
    case "inventory":
      renderItems();
      break;
    case "skills":
      renderSkills();
      break;
    case "quests":
      renderQuests();
      break;
    case "lorebook":
      renderSavedLorebooks();
      renderLoreEntriesList();
      break;
    case "assets":
      renderAssets();
      break;
    case "npcs":
      renderLibraryCards();
      renderLocationNpcs();
      break;
    case "location":
      syncLocationFieldsFromState();
      break;
    default:
      break;
  }
}

function addLocationNpc() {
  const nameEl = document.getElementById("ng-location-npc-name");
  const descEl = document.getElementById("ng-location-npc-desc");
  const classEl = document.getElementById("ng-location-npc-class");
  const partyEl = document.getElementById("ng-location-npc-party");
  const name = String(nameEl?.value || "").trim();
  const description = String(descEl?.value || "").trim();
  if (!name) {
    alert("Please enter an NPC name.");
    return;
  }
  if (!Array.isArray(newGameState.location.npcDetails)) newGameState.location.npcDetails = [];
  const existing = newGameState.location.npcDetails.findIndex(n => String(n?.name || "").trim().toLowerCase() === name.toLowerCase());
  const entry = {
    id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    source: "cardless",
    name,
    className: String(classEl?.value || "Companion").trim() || "Companion",
    description,
    inParty: partyEl?.checked === true
  };
  if (existing >= 0) newGameState.location.npcDetails[existing] = entry;
  else newGameState.location.npcDetails.push(entry);
  if (nameEl) nameEl.value = "";
  if (descEl) descEl.value = "";
  if (partyEl) partyEl.checked = false;
  renderLocationNpcs();
}

function addLibraryCardNpc(card) {
  if (!card || !String(card.name || "").trim()) return;
  if (!Array.isArray(newGameState.location.npcDetails)) newGameState.location.npcDetails = [];
  const cardId = String(card.id || "").trim();
  if (newGameState.location.npcDetails.some(n => String(n?.cardId || "") === cardId)) return;
  newGameState.location.npcDetails.push({
    id: cardId || `card_${Date.now()}`,
    cardId,
    source: "character_card",
    name: String(card.name || "Unnamed").trim(),
    className: String(card.class || card.className || card.role || "Companion").trim() || "Companion",
    description: String(card.description || card.personality || card.background || "").trim(),
    avatar: String(card.avatar || card.image || "").trim(),
    stats: card.stats && typeof card.stats === "object" ? { ...card.stats } : null,
    vitals: card.vitals && typeof card.vitals === "object" ? { ...card.vitals } : null,
    inParty: false,
    startsInLocation: false
  });
  renderLocationNpcs();
  renderLibraryCards();
}

function renderLibraryCards() {
  const list = document.getElementById("ng-library-cards-list");
  const settings = getSettings();
  const cards = Array.isArray(settings.character_cards) ? settings.character_cards : [];
  const added = new Set((newGameState.location.npcDetails || []).map(n => String(n?.cardId || "")).filter(Boolean));
  if (list) list.textContent = `${cards.length} character cards available`;
  renderCharacterCardPickerList(cards, added);
}

function getSelectedLorebookNames() {
  if (!Array.isArray(newGameState.lorebook.selectedBooks)) newGameState.lorebook.selectedBooks = [];
  return new Set(newGameState.lorebook.selectedBooks.map((name) => String(name || "").trim()).filter(Boolean));
}

function renderEmptyList(list, message) {
  if (!list) return;
  const empty = document.createElement("div");
  empty.className = "uie-newgame-list-item uie-newgame-empty";
  empty.textContent = message;
  list.appendChild(empty);
}

function renderSavedLorebooks() {
  const list = document.getElementById("ng-saved-lorebooks-list");
  if (!list) return;
  const settings = getSettings();
  const books = Array.isArray(settings.lorebooks) ? settings.lorebooks : [];
  const selected = getSelectedLorebookNames();
  list.innerHTML = "";
  if (!books.length) {
    list.innerHTML = `<div style="padding:10px;opacity:.7;border:1px dashed rgba(205,127,50,.25);border-radius:6px;">No saved lorebooks yet. Imported or created lorebooks will appear here for future new games.</div>`;
    return;
  }
  books.forEach((book) => {
    const name = String(book?.name || book?.title || "").trim();
    if (!name) return;
    const count = book?.entries && typeof book.entries === "object" ? Object.keys(book.entries).length : 0;
    const item = document.createElement("label");
    item.className = "uie-newgame-list-item";
    item.style.cursor = "pointer";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(name)}</strong>
        <p style="margin:4px 0 0;font-size:11px;opacity:.7;">${count} entries - only used if checked here.</p>
      </div>
      <input type="checkbox" ${selected.has(name) ? "checked" : ""} aria-label="Use ${escapeHtml(name)}">
    `;
    item.querySelector("input")?.addEventListener("change", (e) => {
      const next = getSelectedLorebookNames();
      if (e.target.checked) next.add(name);
      else next.delete(name);
      newGameState.lorebook.selectedBooks = Array.from(next);
    });
    list.appendChild(item);
  });
}

function hideCharacterCardPicker() {
  document.getElementById("uie-ng-card-picker-overlay")?.classList.remove("active");
}

function renderCharacterCardPickerList(cards = null, added = null) {
  const list = document.getElementById("uie-ng-card-picker-list");
  if (!list) return;
  const settings = getSettings();
  const allCards = Array.isArray(cards) ? cards : (Array.isArray(settings.character_cards) ? settings.character_cards : []);
  const addedIds = added instanceof Set ? added : new Set((newGameState.location.npcDetails || []).map(n => String(n?.cardId || "")).filter(Boolean));
  list.innerHTML = "";
  if (!allCards.length) {
    list.innerHTML = `<div style="padding:12px;opacity:.75;border:1px dashed rgba(205,127,50,.25);border-radius:8px;">No Character Cards saved yet.</div>`;
    return;
  }
  allCards.forEach((card) => {
    const cardId = String(card.id || "").trim();
    const item = document.createElement("div");
    item.className = "uie-newgame-list-item";
    const disabled = addedIds.has(cardId);
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(card.name || "Unnamed")}</strong>
        <p style="margin:4px 0 0;font-size:11px;opacity:.7;">${escapeHtml(card.role || card.class || card.className || "Character Card")}</p>
      </div>
      <button type="button" class="uie-newgame-btn mini" ${disabled ? "disabled" : ""}>${disabled ? "Added" : "Add to Game"}</button>
    `;
    item.querySelector("button")?.addEventListener("click", () => {
      addLibraryCardNpc(card);
      hideCharacterCardPicker();
    });
    list.appendChild(item);
  });
}

async function openCharacterCardsManager() {
  try {
    if (typeof window.openCharacterCardsWindow === "function") {
      await window.openCharacterCardsWindow();
    } else {
      const mod = await import("../character_cards.js");
      mod.renderCardManager?.();
    }
    for (const id of ["uie-card-manager", "uie-card-editor"]) {
      const el = document.getElementById(id);
      if (!el) continue;
      document.body.appendChild(el);
      el.style.setProperty("z-index", "2147483651", "important");
      el.style.setProperty("position", "fixed", "important");
    }
  } catch (err) {
    console.error("[NewGame] Character cards manager failed to open:", err);
  }
}

async function openDynamicNpcManager() {
  try {
    awaitingNewGameNpc = true;
    const mod = window.importUieModule ? await window.importUieModule("npcManagementModal.js") : await import("../npcManagementModal.js");
    mod.initNPCManagementModal?.();
    mod.openNPCManagementModal?.({
      role: "NPC",
      location: document.getElementById("ng-location-name")?.value?.trim() || newGameState.location?.name || "Starting Room"
    });
    const modal = document.getElementById("uie-npc-management-modal");
    if (modal) {
      document.body.appendChild(modal);
      modal.style.setProperty("z-index", "2147483651", "important");
      modal.style.setProperty("position", "fixed", "important");
    }
  } catch (error) {
    awaitingNewGameNpc = false;
    console.warn("[NewGame] NPC manager failed to open:", error);
    alert(`NPC manager failed to open: ${String(error?.message || error)}`);
  }
}

function installNewGameNpcCreatedHook() {
  if (window.__uieNewGameNpcCreatedHookInstalled) return;
  window.addEventListener("uie:npc-created", (event) => {
    const overlay = document.getElementById("uie-newgame-overlay");
    if (!awaitingNewGameNpc || !overlay?.classList?.contains("active")) return;
    awaitingNewGameNpc = false;
    const npc = event?.detail?.npc || event?.detail?.profile || event?.detail || {};
    if (!npc || !String(npc.name || "").trim()) return;
    if (!Array.isArray(newGameState.location.npcDetails)) newGameState.location.npcDetails = [];
    const id = String(npc.id || npc.uid || npc.name || `npc_${Date.now()}`).trim();
    const existing = newGameState.location.npcDetails.findIndex((entry) => String(entry?.id || entry?.cardId || entry?.name || "") === id);
    const entry = {
      id,
      source: "npc_manager",
      name: String(npc.name || "Unnamed NPC").trim(),
      className: String(npc.role || npc.className || npc.title || "NPC").trim() || "NPC",
      description: String(npc.bio || npc.description || npc.personality || npc.appearance || "").trim(),
      avatar: String(npc.avatar || npc.image || "").trim(),
      stats: npc.stats && typeof npc.stats === "object" ? { ...npc.stats } : null,
      vitals: npc.vitals && typeof npc.vitals === "object" ? { ...npc.vitals } : null,
      npcManagement: npc.npcManagement || npc.managementOptions || null,
      inParty: false,
      startsInLocation: false
    };
    if (existing >= 0) newGameState.location.npcDetails[existing] = entry;
    else newGameState.location.npcDetails.push(entry);
    renderLocationNpcs();
  });
  window.__uieNewGameNpcCreatedHookInstalled = true;
}

function installCharacterCardsSyncHook() {
  if (window.__uieNewGameCardsHookInstalled) return;
  const previous = window.__UIE_afterCharacterCardsSaved;
  window.__UIE_afterCharacterCardsSaved = (...args) => {
    try { if (typeof previous === "function") previous(...args); } catch (_) {}
    renderLibraryCards();
  };
  window.__uieNewGameCardsHookInstalled = true;
}

function removeLocationNpc(index) {
  if (!Array.isArray(newGameState.location.npcDetails)) newGameState.location.npcDetails = [];
  newGameState.location.npcDetails.splice(index, 1);
  renderLocationNpcs();
}

function renderLocationNpcs() {
  const list = document.getElementById("ng-added-npcs-list");
  if (!list) return;
  const npcs = Array.isArray(newGameState.location.npcDetails) ? newGameState.location.npcDetails : [];
  list.innerHTML = "";
  if (!npcs.length) {
    list.innerHTML = `<div style="padding:10px; opacity:.7; border:1px dashed rgba(205,127,50,.25); border-radius:6px;">No NPCs added to this game yet.</div>`;
    return;
  }
  npcs.forEach((npc, idx) => {
    const item = document.createElement("div");
    item.className = "uie-newgame-list-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(npc.name)}</strong>
        <p style="margin:4px 0 0 0; font-size:11px; color:rgba(225,193,122,.65);">${escapeHtml(npc.className || "NPC")} - ${escapeHtml(npc.description || "No description.")}</p>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-location-toggle ${npc.startsInLocation ? "checked" : ""}> Starting Room</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-party-toggle ${npc.inParty ? "checked" : ""}> Start in Party</label>
      <button class="uie-newgame-btn danger" style="padding:6px 10px; font-size:11px;">Remove</button>
    `;
    item.querySelector("[data-location-toggle]").addEventListener("change", (e) => { npc.startsInLocation = e.target.checked === true; });
    item.querySelector("[data-party-toggle]").addEventListener("change", (e) => { npc.inParty = e.target.checked === true; });
    item.querySelector("button").addEventListener("click", () => removeLocationNpc(idx));
    list.appendChild(item);
  });
}
function addFaction() {
  const name = document.getElementById("ng-faction-name")?.value?.trim();
  if (!name) {
    alert("Please enter an organization name");
    return;
  }

  const rep = parseInt(document.getElementById("ng-faction-rep")?.value) || 0;
  const status = document.getElementById("ng-faction-status")?.value || "none";
  const type = document.getElementById("ng-faction-type")?.value || "crew";
  const scope = document.getElementById("ng-faction-scope")?.value || "building";
  const base = document.getElementById("ng-faction-base")?.value?.trim() || "";

  newGameState.factions.push({
    name,
    reputation: rep,
    status,
    type,
    scope,
    base,
    baseType: scope,
    controlledSpaces: base ? [base] : [],
    assets: base ? [base] : []
  });

  document.getElementById("ng-faction-name").value = "";
  document.getElementById("ng-faction-rep").value = "0";
  document.getElementById("ng-faction-status").value = "none";
  document.getElementById("ng-faction-type").value = "crew";
  document.getElementById("ng-faction-scope").value = "building";
  document.getElementById("ng-faction-base").value = "";
  renderFactionChoiceControls();

  renderFactions();
}

function removeFaction(index) {
  newGameState.factions.splice(index, 1);
  renderFactions();
}

function syncLocationFieldsFromState() {
  const location = newGameState.location || {};
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el && !String(el.value || "").trim() && value) el.value = value;
  };
  setValue("ng-location-name", location.name || "");
  setValue("ng-location-description", location.description || "");
  setValue("ng-location-starting-sequence", location.startingSequence || "");
  setValue("ng-location-bg-url", location.bg || "");
  const danger = document.getElementById("ng-location-danger");
  if (danger && location.danger) danger.value = location.danger;
}

function toggleFactionMembership(index) {
  const faction = newGameState.factions[index];
  if (!faction) return;
  faction.status = String(faction.status || "none").toLowerCase() === "none" ? "member" : "none";
  if (faction.status !== "none" && Number(faction.reputation || 0) < 30) faction.reputation = 30;
  renderFactions();
}

function renderFactions() {
  const list = document.getElementById("ng-factions-list");
  if (!list) return;

  list.innerHTML = "";
  newGameState.factions.forEach((faction, idx) => {
    const item = document.createElement("div");
    item.className = "uie-newgame-list-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(faction.name)}</strong>
        <p style="margin: 4px 0 0 0; font-size: 11px; color: rgba(225, 193, 122, 0.6);">${escapeHtml(faction.type || "group")} | ${escapeHtml(faction.scope || "building")} | Standing ${faction.reputation} | ${escapeHtml(faction.status || "none")}${faction.base ? ` | Base: ${escapeHtml(faction.base)}` : ""}</p>
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
        <button class="uie-newgame-btn" data-join style="padding: 6px 10px; font-size: 11px;">${String(faction.status || "none").toLowerCase() === "none" ? "Join" : "Joined"}</button>
        <button class="uie-newgame-btn danger" data-remove style="padding: 6px 10px; font-size: 11px;">Remove</button>
      </div>
    `;
    item.querySelector("[data-join]")?.addEventListener("click", () => toggleFactionMembership(idx));
    item.querySelector("[data-remove]")?.addEventListener("click", () => removeFaction(idx));
    list.appendChild(item);
  });
}

function addOrUpdateBaseStat() {
  const nameEl = document.getElementById("ng-stat-name");
  const keyEl = document.getElementById("ng-stat-key");
  const valueEl = document.getElementById("ng-stat-value");
  const label = String(nameEl?.value || "").trim();
  const key = slugKey(keyEl?.value || label, "stat");
  const value = Number(valueEl?.value ?? 10);
  if (!label || !key) {
    alert("Please enter a stat name.");
    return;
  }
  if (!newGameState.character.stats || typeof newGameState.character.stats !== "object") newGameState.character.stats = {};
  if (!newGameState.character.statLabels || typeof newGameState.character.statLabels !== "object") newGameState.character.statLabels = {};

  const entries = getBaseStatEntries();
  const old = editingStatIndex >= 0 ? entries[editingStatIndex] : null;
  if (old && old.key !== key) {
    delete newGameState.character.stats[old.key];
    delete newGameState.character.statLabels[old.key];
  }
  newGameState.character.stats[key] = Number.isFinite(value) ? value : 10;
  newGameState.character.statLabels[key] = label;
  resetStatForm();
  renderBaseStats();
}

function editBaseStat(index) {
  const entry = getBaseStatEntries()[index];
  if (!entry) return;
  editingStatIndex = index;
  const nameEl = document.getElementById("ng-stat-name");
  const keyEl = document.getElementById("ng-stat-key");
  const valueEl = document.getElementById("ng-stat-value");
  if (nameEl) nameEl.value = entry.label;
  if (keyEl) keyEl.value = entry.key;
  if (valueEl) valueEl.value = String(entry.value);
  const btn = document.getElementById("ng-stat-add-btn");
  if (btn) btn.textContent = "Save Stat";
  const cancel = document.getElementById("ng-stat-cancel-btn");
  if (cancel) cancel.style.display = "";
}

function removeBaseStat(index) {
  const entry = getBaseStatEntries()[index];
  if (!entry) return;
  delete newGameState.character.stats[entry.key];
  if (newGameState.character.statLabels) delete newGameState.character.statLabels[entry.key];
  resetStatForm();
  renderBaseStats();
}

function renderBaseStats() {
  const list = document.getElementById("ng-base-stats-list");
  if (!list) return;
  list.innerHTML = "";
  const entries = getBaseStatEntries();
  if (!entries.length) {
    list.innerHTML = `<div style="padding:10px;opacity:.7;border:1px dashed rgba(205,127,50,.25);border-radius:6px;">No base stats yet.</div>`;
    return;
  }
  entries.forEach((entry, idx) => {
    const item = document.createElement("div");
    item.className = "uie-newgame-list-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(entry.label)}</strong>
        <p style="margin:4px 0 0 0;font-size:11px;color:rgba(225,193,122,.6);">${escapeHtml(entry.key)} - ${entry.value}</p>
      </div>
      <div class="uie-newgame-list-actions">
        <button class="uie-newgame-btn mini" data-edit>Edit</button>
        <button class="uie-newgame-btn danger mini" data-remove>Remove</button>
      </div>
    `;
    item.querySelector("[data-edit]")?.addEventListener("click", () => editBaseStat(idx));
    item.querySelector("[data-remove]")?.addEventListener("click", () => removeBaseStat(idx));
    list.appendChild(item);
  });
}

function renderPrimaryBars() {
  const list = document.getElementById("ng-primary-bars-list");
  if (!list) return;
  const trackers = Array.isArray(newGameState.lifeTrackers) ? newGameState.lifeTrackers : [];
  list.innerHTML = "";
  if (!trackers.length) {
    list.innerHTML = `<div style="padding:10px;opacity:.7;border:1px dashed rgba(205,127,50,.25);border-radius:6px;">No primary bars yet. Add one in Life Trackers.</div>`;
    return;
  }
  trackers.forEach((tracker, idx) => {
    const item = document.createElement("div");
    item.className = "uie-newgame-list-item";
    const pct = tracker.max > 0 ? Math.max(0, Math.min(100, Math.round((tracker.current / tracker.max) * 100))) : 0;
    item.innerHTML = `
      <div style="flex:1;">
        <strong>${escapeHtml(tracker.name)}</strong>
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
          <div style="width:110px;height:8px;background:rgba(0,0,0,.35);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${escapeHtml(tracker.color || "#89b4fa")};"></div></div>
          <span style="font-size:11px;color:rgba(225,193,122,.65);">${tracker.current}/${tracker.max}</span>
          <span style="font-size:11px;color:rgba(225,193,122,.65);">${tracker.visible === false ? "Hidden" : "Visible"}</span>
        </div>
      </div>
      <div class="uie-newgame-list-actions">
        <button class="uie-newgame-btn mini" data-edit>Edit</button>
        <button class="uie-newgame-btn danger mini" data-remove>Remove</button>
      </div>
    `;
    item.querySelector("[data-edit]")?.addEventListener("click", () => editTracker(idx));
    item.querySelector("[data-remove]")?.addEventListener("click", () => removeTracker(idx));
    list.appendChild(item);
  });
}

function renderCharacterSprites() {
  const list = document.getElementById("ng-character-sprites-list");
  if (!list) return;
  if (!Array.isArray(newGameState.appearance.sprites)) newGameState.appearance.sprites = [];
  list.innerHTML = "";
  if (!newGameState.appearance.sprites.length) {
    list.innerHTML = `<div style="padding:10px;opacity:.7;border:1px dashed rgba(205,127,50,.25);border-radius:6px;">No expression sprites added.</div>`;
    return;
  }
  newGameState.appearance.sprites.forEach((sprite, idx) => {
    const item = document.createElement("div");
    item.className = "uie-newgame-list-item";
    item.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;min-width:0;">
        <div style="width:44px;height:44px;border-radius:8px;background:url('${escapeHtml(sprite.url)}') center/cover, rgba(0,0,0,.35);border:1px solid rgba(205,127,50,.22);"></div>
        <div>
          <strong>${escapeHtml(sprite.label || "Expression")}</strong>
          <p style="margin:4px 0 0 0;font-size:11px;color:rgba(225,193,122,.6);">${sprite.agingVariant ? "Aging variant" : "Default sprite"}</p>
        </div>
      </div>
      <button class="uie-newgame-btn danger mini">Remove</button>
    `;
    item.querySelector("button")?.addEventListener("click", () => {
      newGameState.appearance.sprites.splice(idx, 1);
      renderCharacterSprites();
    });
    list.appendChild(item);
  });
}

async function addCharacterSpriteFromFile() {
  const input = document.getElementById("ng-sprite-file");
  const file = input?.files && input.files[0] ? input.files[0] : null;
  if (input) input.value = "";
  if (!file || !String(file.type || "").startsWith("image/")) return;
  const url = await readImageFileAsDataUrl(file);
  const labelEl = document.getElementById("ng-sprite-label");
  const agingEl = document.getElementById("ng-sprite-aging-enabled");
  if (!Array.isArray(newGameState.appearance.sprites)) newGameState.appearance.sprites = [];
  newGameState.appearance.sprites.push({
    id: `sprite_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label: String(labelEl?.value || file.name || "Expression").trim(),
    url,
    agingVariant: agingEl?.checked === true
  });
  if (labelEl) labelEl.value = "";
  if (agingEl) agingEl.checked = false;
  renderCharacterSprites();
}

function addLifeTracker() {
  const name = document.getElementById("ng-tracker-name")?.value?.trim();
  if (!name) {
    alert("Please enter a tracker name");
    return;
  }

  const current = parseInt(document.getElementById("ng-tracker-current")?.value) || 0;
  const max = parseInt(document.getElementById("ng-tracker-max")?.value) || 100;
  const color = document.getElementById("ng-tracker-color")?.value || "#89b4fa";
  const icon = document.getElementById("ng-tracker-icon")?.value || "fa-heart";
  const visible = document.getElementById("ng-tracker-visible")?.checked || false;
  const notes = document.getElementById("ng-tracker-notes")?.value?.trim() || "";

  const tracker = normalizeLifeTracker({ name, current, max, color, icon, notes });

  if (editingTrackerIndex >= 0 && newGameState.lifeTrackers[editingTrackerIndex]) {
    newGameState.lifeTrackers[editingTrackerIndex] = { ...tracker, visible };
  } else {
    newGameState.lifeTrackers.push({ ...tracker, visible });
  }

  resetTrackerForm();

  renderTrackers();
  renderPrimaryBars();
}

function resetTrackerForm() {
  editingTrackerIndex = -1;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
  set("ng-tracker-name", "");
  set("ng-tracker-current", "100");
  set("ng-tracker-max", "100");
  set("ng-tracker-color", "#89b4fa");
  set("ng-tracker-icon", "fa-heart");
  set("ng-tracker-notes", "");
  const visible = document.getElementById("ng-tracker-visible");
  if (visible) visible.checked = true;
  const btn = document.getElementById("ng-tracker-add-btn");
  if (btn) btn.textContent = "+ Add Tracker";
}

function editTracker(index) {
  const tracker = newGameState.lifeTrackers[index];
  if (!tracker) return;
  editingTrackerIndex = index;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
  set("ng-tracker-name", tracker.name || "");
  set("ng-tracker-current", tracker.current ?? 0);
  set("ng-tracker-max", tracker.max ?? 100);
  set("ng-tracker-color", tracker.color || "#89b4fa");
  set("ng-tracker-icon", tracker.icon || "fa-heart");
  set("ng-tracker-notes", tracker.notes || "");
  const visible = document.getElementById("ng-tracker-visible");
  if (visible) visible.checked = tracker.visible !== false;
  const btn = document.getElementById("ng-tracker-add-btn");
  if (btn) btn.textContent = "Save Tracker";
  switchTab("trackers");
}

function removeTracker(index) {
  newGameState.lifeTrackers.splice(index, 1);
  resetTrackerForm();
  renderTrackers();
  renderPrimaryBars();
}

function renderTrackers() {
  const list = document.getElementById("ng-trackers-list");
  if (!list) return;

  list.innerHTML = "";
  newGameState.lifeTrackers.forEach((tracker, idx) => {
    const item = document.createElement("div");
    item.className = "uie-newgame-list-item";
    const pct = tracker.max > 0 ? Math.round((tracker.current / tracker.max) * 100) : 0;
    item.innerHTML = `
      <div style="flex: 1;">
        <strong class="ng-tracker-name-edit" contenteditable="true" title="Click to rename">${escapeHtml(tracker.name)}</strong>
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
          <div style="width: 100px; height: 8px; background: rgba(0,0,0,0.3); border-radius: 4px; overflow: hidden;">
            <div style="height: 100%; width: ${pct}%; background: ${tracker.color};"></div>
          </div>
          <span style="font-size: 11px; color: rgba(225, 193, 122, 0.6);">${tracker.current}/${tracker.max}</span>
          <span style="font-size: 11px; color: rgba(225, 193, 122, 0.6); margin-left: auto;">${tracker.visible ? "📺 Visible" : "👁️ Hidden"}</span>
        </div>
      </div>
      <div class="uie-newgame-list-actions">
        <button class="uie-newgame-btn mini" data-edit>Edit</button>
        <button class="uie-newgame-btn danger mini" data-remove>Remove</button>
      </div>
    `;
    item.querySelector(".ng-tracker-name-edit")?.addEventListener("input", (e) => {
      tracker.name = String(e.currentTarget.textContent || "").trim().slice(0, 40) || `Tracker ${idx + 1}`;
      renderPrimaryBars();
    });
    item.querySelector("[data-edit]")?.addEventListener("click", () => editTracker(idx));
    item.querySelector("[data-remove]")?.addEventListener("click", () => removeTracker(idx));
    list.appendChild(item);
  });
}

function getItemTypeValue() {
  if (itemFormMode === "equipment") {
    const selected = document.getElementById("ng-item-eq-type-select")?.value || "Equipment";
    if (selected === "custom") return document.getElementById("ng-item-eq-type-custom")?.value?.trim() || "Equipment";
    return selected;
  }
  const selected = document.getElementById("ng-item-category-select")?.value || "Misc";
  if (selected === "custom") return document.getElementById("ng-item-category-custom")?.value?.trim() || "Misc";
  return selected;
}

function getItemNameValue() {
  return itemFormMode === "equipment"
    ? document.getElementById("ng-item-eq-name")?.value?.trim()
    : document.getElementById("ng-item-name")?.value?.trim();
}

function getItemDescriptionValue() {
  return itemFormMode === "equipment"
    ? document.getElementById("ng-item-eq-description")?.value?.trim() || ""
    : document.getElementById("ng-item-description")?.value?.trim() || "";
}

function toggleItemCustomFields() {
  const categoryCustom = document.getElementById("ng-item-category-custom");
  const eqTypeCustom = document.getElementById("ng-item-eq-type-custom");
  if (categoryCustom) categoryCustom.style.display = document.getElementById("ng-item-category-select")?.value === "custom" ? "" : "none";
  if (eqTypeCustom) eqTypeCustom.style.display = document.getElementById("ng-item-eq-type-select")?.value === "custom" ? "" : "none";
}

function setItemFormMode(mode = "standard") {
  itemFormMode = mode === "equipment" ? "equipment" : "standard";
  const standardFields = document.getElementById("ng-item-fields-standard");
  const equipmentFields = document.getElementById("ng-item-fields-equipment");
  const standardBtn = document.getElementById("ng-item-btn-mode-standard");
  const equipmentBtn = document.getElementById("ng-item-btn-mode-equipment");
  if (standardFields) standardFields.style.display = itemFormMode === "standard" ? "" : "none";
  if (equipmentFields) equipmentFields.style.display = itemFormMode === "equipment" ? "" : "none";
  standardBtn?.classList.toggle("active", itemFormMode === "standard");
  equipmentBtn?.classList.toggle("active", itemFormMode === "equipment");
  const title = document.getElementById("ng-item-form-title");
  if (title) title.textContent = itemFormMode === "equipment" ? "Add Equipment" : "Add Item";
  const addBtn = document.getElementById("ng-item-add-btn");
  if (addBtn && editingItemIndex < 0) addBtn.textContent = itemFormMode === "equipment" ? "+ Add Equipment" : "+ Add Item";
  toggleItemCustomFields();
}

function addItem() {
  const name = getItemNameValue();
  if (!name) {
    alert(itemFormMode === "equipment" ? "Please enter equipment name" : "Please enter an item name");
    return;
  }

  const type = getItemTypeValue();
  const quantity = itemFormMode === "equipment" ? 1 : (parseInt(document.getElementById("ng-item-quantity")?.value) || 1);
  const slot = itemFormMode === "equipment" ? (document.getElementById("ng-item-eq-slot-select")?.value || "main") : "";
  const description = getItemDescriptionValue();

  const entry = { name, type, quantity, qty: quantity, slot, description, desc: description, kind: itemFormMode === "equipment" ? "equipment" : "item" };
  if (editingItemIndex >= 0 && newGameState.inventory[editingItemIndex]) newGameState.inventory[editingItemIndex] = entry;
  else newGameState.inventory.push(entry);

  resetItemForm();

  renderItems();
}

function resetItemForm() {
  editingItemIndex = -1;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
  set("ng-item-name", "");
  set("ng-item-category-select", "Consumable");
  set("ng-item-category-custom", "");
  set("ng-item-quantity", "1");
  set("ng-item-description", "");
  set("ng-item-eq-name", "");
  set("ng-item-eq-slot-select", "main");
  set("ng-item-eq-type-select", "Sword");
  set("ng-item-eq-type-custom", "");
  set("ng-item-eq-description", "");
  const btn = document.getElementById("ng-item-add-btn");
  if (btn) btn.textContent = itemFormMode === "equipment" ? "+ Add Equipment" : "+ Add Item";
  const cancel = document.getElementById("ng-item-cancel-btn");
  if (cancel) cancel.style.display = "none";
  toggleItemCustomFields();
}

function editItem(index) {
  const item = newGameState.inventory[index];
  if (!item) return;
  editingItemIndex = index;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value ?? ""; };
  const isEquipment = String(item.kind || "").toLowerCase() === "equipment" || !!item.slot;
  setItemFormMode(isEquipment ? "equipment" : "standard");
  if (isEquipment) {
    set("ng-item-eq-name", item.name);
    set("ng-item-eq-slot-select", item.slot || "main");
    set("ng-item-eq-type-select", item.type || "Sword");
    set("ng-item-eq-description", item.description || item.desc || "");
  } else {
    set("ng-item-name", item.name);
    set("ng-item-category-select", item.type || "Consumable");
    set("ng-item-quantity", item.quantity || item.qty || 1);
    set("ng-item-description", item.description || item.desc || "");
  }
  const btn = document.getElementById("ng-item-add-btn");
  if (btn) btn.textContent = isEquipment ? "Save Equipment" : "Save Item";
  const cancel = document.getElementById("ng-item-cancel-btn");
  if (cancel) cancel.style.display = "";
  toggleItemCustomFields();
}

function removeItem(index) {
  newGameState.inventory.splice(index, 1);
  resetItemForm();
  renderItems();
}

function renderItems() {
  const list = document.getElementById("ng-items-list");
  if (!list) return;

  list.innerHTML = "";
  if (!Array.isArray(newGameState.inventory) || !newGameState.inventory.length) {
    renderEmptyList(list, "No starting items or equipment yet.");
    return;
  }
  newGameState.inventory.forEach((item, idx) => {
    const itemEl = document.createElement("div");
    itemEl.className = "uie-newgame-list-item";
    itemEl.innerHTML = `
      <div>
        <strong>${escapeHtml(item.name)} ×${item.quantity}</strong>
        <p style="margin: 4px 0 0 0; font-size: 11px; color: rgba(225, 193, 122, 0.6);">${item.type}${item.slot ? " • Slot: " + item.slot : ""}</p>
      </div>
      <div class="uie-newgame-list-actions">
        <button class="uie-newgame-btn mini" data-edit>Edit</button>
        <button class="uie-newgame-btn danger mini" data-remove>Remove</button>
      </div>
    `;
    itemEl.querySelector("[data-edit]")?.addEventListener("click", () => editItem(idx));
    itemEl.querySelector("[data-remove]")?.addEventListener("click", () => removeItem(idx));
    list.appendChild(itemEl);
  });
}

function addSkill() {
  const name = document.getElementById("ng-skill-name")?.value?.trim();
  if (!name) {
    alert("Please enter a skill name");
    return;
  }

  const type = document.getElementById("ng-skill-type")?.value || "combat";
  const level = document.getElementById("ng-skill-level")?.value || "novice";
  const description = document.getElementById("ng-skill-description")?.value?.trim() || "";

  const entry = normalizeNewGameSkill({ name, category: type, proficiency: level, description });
  if (editingSkillIndex >= 0 && newGameState.skills[editingSkillIndex]) newGameState.skills[editingSkillIndex] = entry;
  else newGameState.skills.push(entry);

  resetSkillForm();

  renderSkills();
}

function resetSkillForm() {
  editingSkillIndex = -1;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
  set("ng-skill-name", "");
  set("ng-skill-type", "combat");
  set("ng-skill-level", "novice");
  set("ng-skill-description", "");
  const btn = document.getElementById("ng-skill-add-btn");
  if (btn) btn.textContent = "+ Learn Skill";
  const cancel = document.getElementById("ng-skill-cancel-btn");
  if (cancel) cancel.style.display = "none";
}

function editSkill(index) {
  const skill = normalizeNewGameSkill(newGameState.skills[index]);
  if (!skill) return;
  editingSkillIndex = index;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value ?? ""; };
  set("ng-skill-name", skill.name);
  set("ng-skill-type", skill.category || "combat");
  set("ng-skill-level", skill.proficiency || skill.levelLabel || "novice");
  set("ng-skill-description", skill.description || skill.desc || "");
  const btn = document.getElementById("ng-skill-add-btn");
  if (btn) btn.textContent = "Save Skill";
  const cancel = document.getElementById("ng-skill-cancel-btn");
  if (cancel) cancel.style.display = "";
}

function removeSkill(index) {
  newGameState.skills.splice(index, 1);
  resetSkillForm();
  renderSkills();
}

function renderSkills() {
  const list = document.getElementById("ng-skills-list");
  if (!list) return;

  list.innerHTML = "";
  list.style.maxHeight = "none";
  list.style.overflowY = "visible";
  list.style.display = "grid";
  list.style.gap = "10px";

  const skills = Array.isArray(newGameState.skills) ? newGameState.skills.map((skill) => normalizeNewGameSkill(skill)) : [];
  if (!skills.length) {
    const empty = document.createElement("div");
    empty.className = "uie-newgame-list-item";
    empty.style.cssText = "border-style:dashed;opacity:.78;";
    empty.textContent = "No starting skills yet.";
    list.appendChild(empty);
    return;
  }

  const tree = document.createElement("div");
  tree.className = "ng-skill-tree";
  tree.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;position:relative;";
  skills.forEach((normalized, idx) => {
    const skillEl = document.createElement("div");
    skillEl.className = "uie-newgame-list-item ng-skill-node";
    skillEl.style.cssText = "position:relative;display:grid;grid-template-columns:40px minmax(0,1fr);gap:10px;align-items:center;min-height:82px;border-radius:10px;background:rgba(12,18,32,.72);";
    const color = normalized.type === "passive" ? "#4ecdc4" : "#ffb86b";
    skillEl.innerHTML = `
      <div style="width:40px;height:40px;border-radius:10px;display:grid;place-items:center;border:1px solid ${color}66;background:${color}22;color:${color};">
        <i class="fas ${normalized.type === "passive" ? "fa-shield" : "fa-bolt"}"></i>
      </div>
      <div style="min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;min-width:0;">
          <strong style="overflow-wrap:anywhere;">${escapeHtml(normalized.name)}</strong>
          <span style="margin-left:auto;font-size:10px;color:${color};font-weight:900;">Lv ${escapeHtml(normalized.level)}</span>
        </div>
        <p style="margin: 4px 0 0 0; font-size: 11px; color: rgba(225, 193, 122, 0.72);">${escapeHtml(normalized.category)} - ${escapeHtml(normalized.proficiency)}</p>
        ${normalized.description ? `<p style="margin:6px 0 0;font-size:11px;line-height:1.35;opacity:.78;">${escapeHtml(normalized.description)}</p>` : ""}
        <div class="uie-newgame-list-actions" style="margin-top:8px;justify-content:flex-start;flex-wrap:wrap;">
          <button class="uie-newgame-btn mini" data-edit>Edit</button>
          <button class="uie-newgame-btn danger mini" data-remove>Remove</button>
        </div>
      </div>
    `;
    skillEl.querySelector("[data-edit]")?.addEventListener("click", () => editSkill(idx));
    skillEl.querySelector("[data-remove]")?.addEventListener("click", () => removeSkill(idx));
    tree.appendChild(skillEl);
  });
  list.appendChild(tree);
}

function addQuest() {
  const title = document.getElementById("ng-quest-title")?.value?.trim();
  if (!title) {
    alert("Please enter a quest title");
    return;
  }

  const type = document.getElementById("ng-quest-type")?.value || "side";
  const status = document.getElementById("ng-quest-status")?.value || "active";
  const description = document.getElementById("ng-quest-description")?.value?.trim() || "";
  const objectives = document.getElementById("ng-quest-objectives")?.value?.trim()?.split(",").map(s => s.trim()).filter(s => s) || [];

  const entry = { title, type, status, description, desc: description, objectives };
  if (editingQuestIndex >= 0 && newGameState.quests[editingQuestIndex]) newGameState.quests[editingQuestIndex] = entry;
  else newGameState.quests.push(entry);

  resetQuestForm();

  renderQuests();
}

function resetQuestForm() {
  editingQuestIndex = -1;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
  set("ng-quest-title", "");
  set("ng-quest-type", "side");
  set("ng-quest-status", "active");
  set("ng-quest-description", "");
  set("ng-quest-objectives", "");
  const btn = document.getElementById("ng-quest-add-btn");
  if (btn) btn.textContent = "+ Add Quest";
  const cancel = document.getElementById("ng-quest-cancel-btn");
  if (cancel) cancel.style.display = "none";
}

function editQuest(index) {
  const quest = newGameState.quests[index];
  if (!quest) return;
  editingQuestIndex = index;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value ?? ""; };
  set("ng-quest-title", quest.title);
  set("ng-quest-type", quest.type || "side");
  set("ng-quest-status", quest.status || "active");
  set("ng-quest-description", quest.description || quest.desc || "");
  set("ng-quest-objectives", Array.isArray(quest.objectives) ? quest.objectives.join(", ") : "");
  const btn = document.getElementById("ng-quest-add-btn");
  if (btn) btn.textContent = "Save Quest";
  const cancel = document.getElementById("ng-quest-cancel-btn");
  if (cancel) cancel.style.display = "";
}

function removeQuest(index) {
  newGameState.quests.splice(index, 1);
  resetQuestForm();
  renderQuests();
}

function renderQuests() {
  const list = document.getElementById("ng-quests-list");
  if (!list) return;

  list.innerHTML = "";
  if (!Array.isArray(newGameState.quests) || !newGameState.quests.length) {
    renderEmptyList(list, "No starting quests yet.");
    return;
  }
  newGameState.quests.forEach((quest, idx) => {
    const questEl = document.createElement("div");
    questEl.className = "uie-newgame-list-item";
    questEl.innerHTML = `
      <div>
        <strong>${escapeHtml(quest.title)}</strong>
        <p style="margin: 4px 0 0 0; font-size: 11px; color: rgba(225, 193, 122, 0.6);">${quest.type} • ${quest.status} • ${quest.objectives.length} objectives</p>
      </div>
      <div class="uie-newgame-list-actions">
        <button class="uie-newgame-btn mini" data-edit>Edit</button>
        <button class="uie-newgame-btn danger mini" data-remove>Remove</button>
      </div>
    `;
    questEl.querySelector("[data-edit]")?.addEventListener("click", () => editQuest(idx));
    questEl.querySelector("[data-remove]")?.addEventListener("click", () => removeQuest(idx));
    list.appendChild(questEl);
  });
}

function addLoreEntry() {
  const title = document.getElementById("ng-lore-title")?.value?.trim() || "";
  const keys = document.getElementById("ng-lore-keys")?.value?.trim() || "";
  const content = document.getElementById("ng-lore-content")?.value?.trim() || "";

  if (!title || !content) {
    alert("Please provide both a title and content for the lore entry");
    return;
  }

  const keyArray = keys.split(",").map(k => k.trim()).filter(k => k);
  const uid = Date.now();

  newGameState.lorebook.entries.push({
    uid,
    comment: title,
    key: keyArray,
    keysecondary: [],
    content,
    constant: false,
    selective: true,
    position: 4,
    order: 100,
    depth: 4,
    probability: 100
  });

  document.getElementById("ng-lore-title").value = "";
  document.getElementById("ng-lore-keys").value = "";
  document.getElementById("ng-lore-content").value = "";

  renderLoreEntriesList();
}

function removeLoreEntry(index) {
  newGameState.lorebook.entries.splice(index, 1);
  renderLoreEntriesList();
}

function renderLoreEntriesList() {
  const list = document.getElementById("ng-lore-entries-list");
  if (!list) return;

  list.innerHTML = "";
  if (!Array.isArray(newGameState.lorebook.entries) || !newGameState.lorebook.entries.length) {
    renderEmptyList(list, "No custom lore entries in this new game yet.");
    return;
  }
  newGameState.lorebook.entries.forEach((entry, idx) => {
    const entryEl = document.createElement("div");
    entryEl.className = "uie-newgame-list-item";
    entryEl.innerHTML = `
      <div>
        <strong>${escapeHtml(entry.comment)}</strong>
        <p style="margin: 4px 0 0 0; font-size: 11px; color: rgba(225, 193, 122, 0.6);">Keys: ${escapeHtml((entry.key || []).join(", "))}</p>
      </div>
      <button class="uie-newgame-btn danger" style="padding: 6px 10px; font-size: 11px;">Remove</button>
    `;
    entryEl.querySelector("button").addEventListener("click", () => removeLoreEntry(idx));
    list.appendChild(entryEl);
  });
}

function exportLorebook() {
  const lorebook = {
    name: "New Game Lorebook",
    entries: {}
  };

  newGameState.lorebook.entries.forEach((entry, idx) => {
    lorebook.entries[entry.uid || idx] = entry;
  });

  const blob = new Blob([JSON.stringify(lorebook, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "newgame_lorebook.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importLoreFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    
    if (data.entries) {
      const entries = Object.values(data.entries);
      newGameState.lorebook.entries.push(...entries);
      renderLoreEntriesList();
    } else {
      alert("Invalid lorebook format");
    }
  } catch (err) {
    alert("Failed to import lorebook: " + err.message);
  } finally {
    e.target.value = "";
  }
}

function addAsset() {
  const name = document.getElementById("ng-asset-name")?.value?.trim() || "";
  const type = document.getElementById("ng-asset-type")?.value || "property";
  const value = parseInt(document.getElementById("ng-asset-value")?.value) || 0;
  const description = document.getElementById("ng-asset-description")?.value?.trim() || "";

  if (!name) {
    alert("Please provide an asset name");
    return;
  }

  const entry = ensureTravelAssetFields({
    id: `asset_${Date.now()}`,
    name,
    type,
    value,
    description,
    location: "",
    acquired: new Date().toISOString()
  }, { forceUnplaced: true });
  if (editingAssetIndex >= 0 && newGameState.assets[editingAssetIndex]) {
    newGameState.assets[editingAssetIndex] = { ...newGameState.assets[editingAssetIndex], ...entry };
  } else {
    newGameState.assets.push(entry);
  }

  resetAssetForm();

  renderAssets();
  renderLocationNpcs();
  renderLibraryCards();
}

function removeAsset(index) {
  newGameState.assets.splice(index, 1);
  resetAssetForm();
  renderAssets();
}

function resetAssetForm() {
  editingAssetIndex = -1;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
  set("ng-asset-name", "");
  set("ng-asset-type", "property");
  set("ng-asset-value", "");
  set("ng-asset-description", "");
  const btn = document.getElementById("ng-asset-add-btn");
  if (btn) btn.textContent = "+ Add Asset";
  const cancel = document.getElementById("ng-asset-cancel-btn");
  if (cancel) cancel.style.display = "none";
}

function editAsset(index) {
  const asset = newGameState.assets[index];
  if (!asset) return;
  editingAssetIndex = index;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value ?? ""; };
  set("ng-asset-name", asset.name);
  set("ng-asset-type", asset.type || "property");
  set("ng-asset-value", asset.value || 0);
  set("ng-asset-description", asset.description || asset.desc || "");
  const btn = document.getElementById("ng-asset-add-btn");
  if (btn) btn.textContent = "Save Asset";
  const cancel = document.getElementById("ng-asset-cancel-btn");
  if (cancel) cancel.style.display = "";
}

function syncPresetFieldsToUi() {
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value ?? "";
  };
  setValue("ng-char-resource-profile", newGameState.character.resourceProfile);
  setValue("ng-char-mode", newGameState.character.mode);
  applyModeBackplate(newGameState.character.mode);
  setValue("ng-currency-name", newGameState.currency.name);
  setValue("ng-currency-symbol", newGameState.currency.symbol);
  setValue("ng-currency-amount", newGameState.currency.amount);
  setValue("ng-currency-value", newGameState.currency.realValue);
  setValue("ng-location-name", newGameState.location.name);
  setValue("ng-location-description", newGameState.location.description);
  setValue("ng-location-starting-sequence", newGameState.location.startingSequence);
  setValue("ng-location-terrain", newGameState.location.terrain);
  setValue("ng-location-danger", newGameState.location.danger);
  setValue("ng-location-bg-url", newGameState.location.bg);
  setValue("ng-world-scope", newGameState.worldScope.type);
  setValue("ng-world-mode", newGameState.worldScope.mode);
  setValue("ng-world-seed-name", newGameState.worldScope.seedName);
  setValue("ng-world-count-worlds", newGameState.worldScope.counts.worlds);
  setValue("ng-world-count-regions", newGameState.worldScope.counts.regions);
  setValue("ng-world-count-settlements", newGameState.worldScope.counts.settlements);
  setValue("ng-world-count-places", newGameState.worldScope.counts.places);
  setValue("ng-world-count-rooms", newGameState.worldScope.counts.roomsPerInterior);
  setValue("ng-world-blueprint-mode", newGameState.worldScope.counts.blueprintMode || "sites");
  setValue("ng-world-description", newGameState.worldScope.description);
  setAvatarPreview(newGameState.character.avatar || "");
  const preview = document.getElementById("ng-location-bg-preview");
  if (preview && newGameState.location.bg) {
    preview.style.backgroundImage = `url("${newGameState.location.bg}")`;
    preview.style.display = "block";
  } else if (preview) {
    preview.style.backgroundImage = "";
    preview.style.display = "none";
  }
  document.getElementById("ng-preset-custom")?.classList.toggle("primary", !newGameState.presetId);
  document.getElementById("ng-preset-adventure-path")?.classList.toggle("primary", newGameState.presetId === ADVENTURE_PATH_PRESET_ID);
  syncCheckboxesFromClass(newGameState.character.class);
  renderFactions();
  renderBaseStats();
  renderPrimaryBars();
  renderCharacterSprites();
  renderItems();
  renderSkills();
  renderQuests();
  renderLoreEntriesList();
  renderSavedLorebooks();
  renderAssets();
  renderLocationNpcs();
}

function selectCustomPreset() {
  newGameState.presetId = "";
  newGameState.inventory = [];
  newGameState.skills = [];
  newGameState.quests = [];
  newGameState.assets = [];
  newGameState.factions = [];
  newGameState.lorebook.entries = [];
  newGameState.lorebook.selectedBooks = [];
  newGameState.appearance.sprites = [];
  newGameState.location = { type: "room", name: "", description: "", terrain: "forest", danger: "safe", npcs: [], npcDetails: [], bg: "" };
  newGameState.worldScope = { type: "local", mode: "hybrid", seedName: "", counts: { worlds: 1, regions: 1, settlements: 1, places: 6, roomsPerInterior: 8, blueprintMode: "sites" }, description: "" };
  syncPresetFieldsToUi();
  window.showToast?.("Custom preset selected. Story fields are empty and ready for you.", 3200);
}

async function selectAdventurePathPreset() {
  const button = document.getElementById("ng-preset-adventure-path");
  if (button) button.disabled = true;
  try {
    const settings = getSettings();
    const sourceData = await loadAdventurePathSourceData(settings);
    applyAdventurePathPresetState(newGameState, sourceData);
    syncPresetFieldsToUi();
    saveSettings();
    window.showToast?.("Adventure'r's Path story preset loaded. Choose your class, then create your character.", 4200);
  } catch (err) {
    console.error("[NewGame] Adventure path preset failed:", err);
    alert(`Adventure'r's Path preset failed to load: ${String(err?.message || err)}`);
  } finally {
    if (button) button.disabled = false;
  }
}

function renderAssets() {
  const list = document.getElementById("ng-assets-list");
  if (!list) return;

  list.innerHTML = "";
  if (!Array.isArray(newGameState.assets) || !newGameState.assets.length) {
    renderEmptyList(list, "No starting assets yet.");
    return;
  }
  newGameState.assets.forEach((asset, idx) => {
    const assetEl = document.createElement("div");
    assetEl.className = "uie-newgame-list-item";
    assetEl.innerHTML = `
      <div>
        <strong>${escapeHtml(asset.name)}</strong>
        <p style="margin: 4px 0 0 0; font-size: 11px; color: rgba(225, 193, 122, 0.6);">${asset.type} • Value: ${asset.value}</p>
      </div>
      <div class="uie-newgame-list-actions">
        <button class="uie-newgame-btn mini" data-edit>Edit</button>
        <button class="uie-newgame-btn danger mini" data-remove>Remove</button>
      </div>
    `;
    assetEl.querySelector("[data-edit]")?.addEventListener("click", () => editAsset(idx));
    assetEl.querySelector("[data-remove]")?.addEventListener("click", () => removeAsset(idx));
    list.appendChild(assetEl);
  });
}

async function generateLocationWithAI() {
  const locationName = document.getElementById("ng-location-name")?.value?.trim();
  const terrain = document.getElementById("ng-location-terrain")?.value || "forest";

  if (!locationName) {
    alert("Please enter a location name first");
    return;
  }

  const btn = document.getElementById("ng-location-generate-btn");
  if (btn) btn.disabled = true;

  try {
    const worldDescription = document.getElementById("ng-world-description")?.value?.trim() || newGameState.worldScope.description || "";
    const prompt = `You are a universal world-building AI. Generate a rich region description for the starting location "${locationName}" with terrain/environment type "${terrain}".
Infer the genre, era, technology, culture, and naming conventions from the location name and world context. Never default to medieval fantasy.
World context: ${worldDescription || "No explicit world description supplied; remain genre-neutral and avoid unsupported fantasy concepts."}
Include:
1. Detailed description of the region
2. Local settlements and points of interest
3. NPCs that live there
4. Local dangers and wildlife
5. Resources available
Keep the response atmospheric, immersive, and strictly consistent with the inferred setting.`;

    if (typeof window.skipNextAiConfirmOnce === "function") {
      window.skipNextAiConfirmOnce();
    } else {
      window.__uieSkipAiConfirmOnce = true;
    }
    const result = await generateContent(prompt);
    document.getElementById("ng-location-description").value = result || "";
  } catch (err) {
    alert("Failed to generate location: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function prepareNewGameStoryApi(settings) {
  settings.connections = settings.connections && typeof settings.connections === "object" ? settings.connections : {};

  const profiles = Array.isArray(settings.connections.mainProfiles) ? settings.connections.mainProfiles : [];
  const activeId = String(settings.connections.activeMainProfileId || "").trim();
  const activeProfile = profiles.find(profile => String(profile?.id || "").trim() === activeId) || null;
  if (activeProfile) {
    settings.connections.mainApi = JSON.parse(JSON.stringify(activeProfile));
  }

  const mainApi = settings.connections.mainApi || settings.mainApi || {};
  const mainUrl = String(mainApi.url || "").trim();
  const mainProvider = String(mainApi.provider || "").trim();

  const turbo = settings.turbo || {};
  const turboUrl = String(turbo.url || "").trim();

  return !!mainUrl || !!mainProvider || !!turboUrl || !!settings.connections?.activeMainProfileId || !!settings.mainApi?.url;
}

function slugLocation(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "default";
}

function persistStartingBackground(settings, locationName, imageUrl) {
  const bg = String(imageUrl || "").trim();
  const location = String(locationName || settings?.worldState?.location || "Starting Point").trim() || "Starting Point";
  if (!bg) return;

  settings.ui = settings.ui || {};
  settings.ui.manualBedroomBg = bg;
  settings.ui.backgrounds = settings.ui.backgrounds || {};
  settings.ui.backgrounds.vnRoom = bg;

  settings.worldState = settings.worldState || {};
  settings.worldState.location = location;
  settings.worldState.currentLocation = location;
  settings.worldState.customBackgrounds = settings.worldState.customBackgrounds || {};
  settings.worldState.customBackgrounds[location] = bg;
  settings.worldState.background = bg;
  settings.worldState.backgroundUrl = bg;
  settings.worldState.areaScenes = settings.worldState.areaScenes || {};
  settings.worldState.areaScenes[location] = settings.worldState.areaScenes[location] || {};
  settings.worldState.areaScenes[location].imageUrl = bg;

  const locationId = slugLocation(location);
  settings.realityEngine = settings.realityEngine || {};
  settings.realityEngine.backgrounds = settings.realityEngine.backgrounds || {};
  settings.realityEngine.backgrounds[locationId] = bg;
  settings.realityEngine.backgrounds["0_-1"] = bg;
  settings.realityEngine.backgrounds["0,-1"] = bg;
  settings.realityEngine.locationId = locationId;
  settings.realityEngine.worldData = settings.realityEngine.worldData || {};
  settings.realityEngine.worldData.player = settings.realityEngine.worldData.player || {};
  settings.realityEngine.worldData.player.locationId = locationId;
  settings.realityEngine.worldData.locationRegistry = settings.realityEngine.worldData.locationRegistry || {};
  settings.realityEngine.worldData.locationRegistry.backgrounds = settings.realityEngine.worldData.locationRegistry.backgrounds || {};
  settings.realityEngine.worldData.locationRegistry.backgrounds[locationId] = bg;
}

function createStartingPartyMember(npc, isUser = false) {
  const stats = npc?.stats && typeof npc.stats === "object" ? npc.stats : {};
  const vitals = npc?.vitals && typeof npc.vitals === "object" ? npc.vitals : {};
  const name = String(npc?.name || "Player").trim() || "Player";
  const className = String(npc?.className || npc?.class || (isUser ? "Adventurer" : "Companion")).trim() || "Companion";
  return {
    id: String(npc?.id || (isUser ? "party_user" : `party_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`)),
    cardId: String(npc?.cardId || ""),
    identity: { name, class: className, species: String(npc?.race || "Human"), alignment: String(npc?.alignment || "Neutral") },
    images: { portrait: String(npc?.avatar || "") },
    stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, per: 10, luk: 10, ...stats },
    vitals: { hp: 100, maxHp: 100, mp: 50, maxMp: 50, ap: 100, maxAp: 100, stamina: 100, maxStamina: 100, ...vitals },
    progression: { level: Math.max(1, Number(npc?.level || 1)), xp: 0, skillPoints: 0, perkPoints: 0 },
    equipment: {},
    trackers: [],
    partyRole: isUser ? "Leader" : className,
    roles: isUser ? ["User"] : [],
    statusEffects: [],
    bio: String(npc?.description || ""),
    active: true,
    personalItems: [],
    tactics: { preset: "Balanced", focus: "auto", protectId: "", conserveMana: false }
  };
}

function ensureGeneratedStartingNpcs() {
  if (!Array.isArray(newGameState.location.npcDetails)) newGameState.location.npcDetails = [];
  const target = Math.max(3, Math.min(8, Number(newGameState.worldScope?.counts?.settlements || 4)));
  const used = newGameState.location.npcDetails.map((npc) => npc?.name).filter(Boolean);
  const roles = [
    { role: "Local coordinator", job: "Operations Hub", home: "Riverside Residence" },
    { role: "Independent specialist", job: "Private Workshop", home: "Courtyard Home" },
    { role: "Community regular", job: "Neighborhood Commons", home: "Upper Floor Apartment" },
    { role: "Information broker", job: "Transit Cafe", home: "Quiet Side-Street Flat" },
    { role: "Field worker", job: "Regional Depot", home: "Edge District House" },
    { role: "Caretaker", job: "Community Clinic", home: "Garden Residence" }
  ];
  while (newGameState.location.npcDetails.length < target) {
    const index = newGameState.location.npcDetails.length;
    const profile = roles[index % roles.length];
    const name = generateRandomName({ used });
    used.push(name);
    newGameState.location.npcDetails.push({
      id: `generated_npc_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
      kind: "uie.npc_card",
      source: "generated_game_npc",
      name,
      role: profile.role,
      title: profile.role,
      className: profile.role,
      description: `${name} has an established life in this setting, including work, relationships, routines, and personal priorities.`,
      bio: `${name} has an established life in this setting, including work, relationships, routines, and personal priorities.`,
      age: "",
      appearance: "",
      personality: "Grounded, socially responsive, shaped by local routines.",
      organizationAffiliations: [],
      affiliations: [],
      rumors: [],
      avatar: "",
      inParty: false,
      transientGameNpc: true,
      locked: true,
      autoLocked: true,
      canUnlock: true,
      lockMode: "auto",
      homeLocation: profile.home,
      workLocation: profile.job,
      schedule: [
        { time: "08:00", activity: "Start the day nearby", location: newGameState.location.name || "Starting Location" },
        { time: "09:00", activity: "Work", location: profile.job },
        { time: "18:00", activity: "Personal time", location: "Neighborhood Commons" },
        { time: "22:00", activity: "Rest", location: profile.home }
      ],
      wants: "Make meaningful progress on a personal goal",
      needs: "Balance work, rest, and relationships",
      desires: "Build a life that feels self-directed"
    });
  }
}

function addGeneratedNpcLivesToWorld(settings, npcs, startLocation) {
  settings.worldState = settings.worldState || {};
  settings.worldState.mapNodes = settings.worldState.mapNodes || {};
  settings.worldState.navGraph = settings.worldState.navGraph || {};
  const addPlace = (name, type, owner) => {
    const place = String(name || "").trim();
    if (!place || settings.worldState.mapNodes[place]) return;
    settings.worldState.mapNodes[place] = {
      name: place,
      type,
      district: "Generated Character Places",
      chars: [],
      interactions: ["observe", "visit", "talk"],
      exits: {},
      description: `${owner}'s ${type === "home" ? "home" : "regular workplace"}, generated for this game.`,
      discovered: true
    };
    settings.worldState.navGraph[place] = settings.worldState.navGraph[place] || {};
  };
  for (const npc of npcs) {
    addPlace(npc.homeLocation, "home", npc.name);
    addPlace(npc.workLocation, "workplace", npc.name);
  }
  settings.worldState.navGraph[startLocation] = settings.worldState.navGraph[startLocation] || {};
}

async function resetLiveNewGameRuntime(settings) {
  resetForNewGame(settings);
  // New-game identity and live encounter state must never inherit the previous campaign.
  settings.sceneCharacters = [];
  settings.gameCharacters = [];
  settings.social = { associates: [] };
  settings.party = { members: [], leaderId: "" };
  settings.battle = {
    enabled: true,
    autoOpen: false,
    actionDeckStyle: "buttons",
    state: { active: false, enemies: [], turnOrder: [], log: [], player: {} }
  };
  settings.databank = {};
  settings.databankNodes = [];
  settings.memories = [];
  settings.memory = {};
  if (!Array.isArray(settings.personas)) settings.personas = [];
  if (!settings.activePersonaId && settings.personas[0]?.id) settings.activePersonaId = String(settings.personas[0].id || "");
  if (!Array.isArray(settings.lorebooks)) settings.lorebooks = [];
  settings.loreContext = {
    globalBooks: [],
    characterBindings: {},
    personaBindings: {},
    chatBindings: {},
    insertionStrategy: "sorted_evenly",
    activeChatId: "default"
  };
  const selectedLorebooks = Array.isArray(newGameState.lorebook?.selectedBooks)
    ? newGameState.lorebook.selectedBooks.map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  if (selectedLorebooks.length) settings.loreContext.globalBooks = Array.from(new Set(selectedLorebooks));
  settings.ui = settings.ui || {};
  settings.ui.expressionState = {};
  settings.ui.personaExpressionState = {};
  settings.ui.sceneCharacters = [];
  try {
    const modules = await Promise.all([
      import("../map.js"),
      import("../memory.js"),
      import("./rp_log.js"),
      import("../chatbox.js"),
      import("../sprites.js")
    ]);
    modules[0].resetMapState?.();
    modules[1].resetMemory?.();
    modules[2].resetRpEventBuffer?.();
    modules[3].resetChatboxRuntime?.();
    modules[4].clearAllSprites?.({ remove: true });
  } catch (err) {
    console.warn("[NewGame] Runtime cache reset was incomplete:", err);
  }
  try {
    document.querySelectorAll("#chat .mes, #re-chat-log .mes, #re-chat-log > *").forEach((node) => node.remove());
  } catch (_) {}
  try {
    if (Array.isArray(window.chat)) window.chat.length = 0;
  } catch (_) {}
}

async function startNewGame() {
  window.__uieGameStarted = true;
  // Stop main menu BGM immediately when starting a new game
  window.stopMainMenuBgm?.();
  updateEnabledStatsFromUi();
  // Validate required fields first
  if (!newGameState.character.name.trim()) {
    alert("Please enter a character name");
    return;
  }

  if (!newGameState.location.name && !document.getElementById("ng-location-name")?.value?.trim()) {
    alert("Please select or create a starting location");
    return;
  }
  if (!prepareNewGameStoryApi(getSettings())) {
    alert("Connect a Main AI API before starting. New Game requires the AI to generate the first response.");
    window.__uieGameStarted = false;
    return;
  }

  // Show the real loading screen immediately and keep it up while generation runs.
  const loadingEl = setNewGameLoading("Booting Reality Modules...", 20);

  // Hide the new game popup so it doesn't clutter the screen during loading
  hideNewGamePopup(false);

  // Load Reality Engine subsystems before starting game
  if (window.bootRealityEngineModules) {
    try {
      await window.bootRealityEngineModules();
    } catch (e) {
      console.warn("[NewGame] Failed to load Reality Engine modules:", e);
    }
  }

  if (loadingEl) {
    setNewGameLoading("Weaving Character DNA & Starting Scenario...", 40);
  }

  newGameState.location.name = document.getElementById("ng-location-name")?.value?.trim() || newGameState.location.name;
  newGameState.location.description = document.getElementById("ng-location-description")?.value?.trim() || "";
  newGameState.location.startingSequence = document.getElementById("ng-location-starting-sequence")?.value?.trim() || "";
  newGameState.location.terrain = document.getElementById("ng-location-terrain")?.value || newGameState.location.terrain || "forest";
  newGameState.location.danger = document.getElementById("ng-location-danger")?.value || newGameState.location.danger || "safe";
  ensureGeneratedStartingNpcs();
  const detailNames = (Array.isArray(newGameState.location.npcDetails) ? newGameState.location.npcDetails : []).map(n => String(n?.name || "").trim()).filter(Boolean);
  newGameState.location.npcs = Array.from(new Set(detailNames));
  newGameState.worldScope.type = "local";
  newGameState.worldScope.mode = document.getElementById("ng-world-mode")?.value || newGameState.worldScope.mode || "hybrid";
  newGameState.worldScope.seedName = document.getElementById("ng-world-seed-name")?.value?.trim() || newGameState.worldScope.seedName || "";
  newGameState.worldScope.counts = {
    worlds: Math.max(1, parseInt(document.getElementById("ng-world-count-worlds")?.value) || 1),
    regions: 1,
    settlements: 1,
    places: 6,
    roomsPerInterior: Math.max(1, parseInt(document.getElementById("ng-world-count-rooms")?.value) || 8),
    blueprintMode: document.getElementById("ng-world-blueprint-mode")?.value || "sites"
  };
  newGameState.worldScope.description = document.getElementById("ng-world-description")?.value?.trim() || newGameState.worldScope.description || "";

  const settings = getSettings();
  await resetLiveNewGameRuntime(settings);
  const normalizedSkills = (newGameState.skills || []).map((skill) => normalizeNewGameSkill(skill));

  // Apply state to settings
  settings.character = { ...settings.character, ...newGameState.character };
  settings.appearance = newGameState.appearance;
  settings.currency = Number(newGameState.currency.amount || 0);
  settings.currencySymbol = String(newGameState.currency.symbol || "G");
  settings.currencyConfig = { ...newGameState.currency };
  settings.factions = {
    list: newGameState.factions.map((faction, index) => ({
      id: `newgame_group_${index + 1}`,
      name: faction.name,
      type: faction.type || "group",
      standing: Number(faction.reputation || 0),
      scope: faction.scope || "building",
      membershipStatus: faction.status || "none",
      base: faction.base || "",
      baseType: faction.baseType || faction.scope || "",
      controlledSpaces: Array.isArray(faction.controlledSpaces) ? faction.controlledSpaces : (faction.base ? [faction.base] : []),
      assets: Array.isArray(faction.assets) ? faction.assets : [],
      members: String(faction.status || "none").toLowerCase() === "none" ? [] : [{
        id: "user_member",
        name: newGameState.character.name,
        rank: faction.status || "Member",
        role: faction.status || "member",
        sourceType: "user",
        sourceId: "user",
        count: 1
      }],
      notes: "",
      npcTemplate: "",
      updatedAt: Date.now()
    })),
    laws: []
  };
  settings.reputation = newGameState.reputation;
  settings.world = { ...settings.world, gameMode: newGameState.character.mode };
  settings.ui = settings.ui || {};
  const tutorialEnabled = document.getElementById("ng-location-tutorial-enabled")?.checked !== false;
  settings.ui.helperTutorialActive = tutorialEnabled;
  if (tutorialEnabled) {
    settings.ui.helperTutorialSkipped = false;
    settings.ui.helperTutorialCompleted = false;
  } else {
    settings.ui.helperTutorialSkipped = true;
  }
  settings.ui.vitalIcons = { ...newGameState.character.vitalIcons };
  settings.ui.vitalLabels = { ...newGameState.character.vitalLabels };
  applyLifeTrackersToSettings(settings, newGameState.lifeTrackers, settings.ui.vitalIcons);
  settings.skills = normalizedSkills;
  settings.journal = { quests: newGameState.quests };
  const existingAssets = Array.isArray(settings.assets) ? settings.assets : [];
  const setupAssets = Array.isArray(newGameState.assets) ? newGameState.assets : [];
  settings.assets = [...existingAssets, ...setupAssets];
  const locName = newGameState.location.name || "Backstage Dressing Room";
  settings.worldState = {
    location: locName,
    currentLocation: locName,
    locationDesc: newGameState.location.description || "A cozy starting space.",
    background: newGameState.location.bg || "",
    backgroundUrl: newGameState.location.bg || "",
    currentRoomId: "start_room",
    currentCoords: { x: 0, y: -1, z: 0 },
    x: 0,
    y: -1,
    areaScenes: {
      [locName]: {
        name: locName,
        description: newGameState.location.description || "A cozy starting space.",
        imageUrl: newGameState.location.bg || ""
      }
    },
    mapNodes: {
      [locName]: {
        name: locName,
        type: "room",
        district: "Custom Starting Location",
        chars: [],
        interactions: ["observe", "rest", "plan"],
        exits: {},
        description: newGameState.location.description || "A cozy starting space.",
        isStartingRoom: true
      }
    },
    navGraph: {
      [locName]: {}
    }
  };
  const gameNpcs = (Array.isArray(newGameState.location.npcDetails) ? newGameState.location.npcDetails : []).map((npc, idx) => ({
    id: String(npc.id || npc.cardId || `start_npc_${idx + 1}_${String(npc.name || "npc").toLowerCase().replace(/[^a-z0-9]+/g, "_")}`),
    kind: "uie.npc_card",
    cardId: String(npc.cardId || ""),
    source: String(npc.source || "cardless"),
    name: String(npc.name || "").trim(),
    role: String(npc.role || npc.className || "NPC").trim(),
    title: String(npc.title || npc.role || npc.className || "").trim(),
    age: npc.age ?? "",
    appearance: String(npc.appearance || "").trim(),
    personality: String(npc.personality || "").trim(),
    organizationAffiliations: Array.isArray(npc.organizationAffiliations) ? [...npc.organizationAffiliations] : [],
    affiliations: Array.isArray(npc.affiliations) ? [...npc.affiliations] : [],
    rumors: Array.isArray(npc.rumors) ? [...npc.rumors] : [],
    className: String(npc.className || "Companion").trim(),
    description: String(npc.description || npc.bio || "").trim(),
    bio: String(npc.bio || npc.description || "").trim(),
    avatar: String(npc.avatar || "").trim(),
    stats: npc.stats && typeof npc.stats === "object" ? { ...npc.stats } : null,
    vitals: npc.vitals && typeof npc.vitals === "object" ? { ...npc.vitals } : { hp: 100, maxHp: 100, mp: 50, maxMp: 50, ap: 100, maxAp: 100 },
    inParty: npc.inParty === true,
    startsInLocation: npc.startsInLocation === true,
    locationId: npc.startsInLocation === true ? "start_room" : "",
    transientGameNpc: true,
    locked: npc.locked !== false,
    autoLocked: npc.autoLocked !== false,
    canUnlock: npc.canUnlock !== false,
    lockMode: String(npc.lockMode || "auto"),
    active: true,
    presence: "present",
    homeLocation: String(npc.homeLocation || "").trim(),
    workLocation: String(npc.workLocation || "").trim(),
    schedule: Array.isArray(npc.schedule) ? npc.schedule.map((entry) => ({ ...entry })) : (npc.schedule || ""),
    wants: String(npc.wants || "").trim(),
    needs: String(npc.needs || "").trim(),
    desires: String(npc.desires || "").trim()
  })).filter(n => n.name);
  const startingNpcs = gameNpcs.filter((npc) => npc.startsInLocation === true);
  settings.sceneCharacters = startingNpcs;
  settings.npcs = gameNpcs.map((npc) => ({ ...npc }));
  settings.gameCharacters = gameNpcs.map(n => n.cardId || n.id);
  settings.worldState.mapNodes[locName].chars = startingNpcs.map(n => n.name);
  settings.social = settings.social && typeof settings.social === "object" ? settings.social : {};
  settings.social.associates = Array.isArray(settings.social.associates) ? settings.social.associates : [];
  for (const npc of gameNpcs) {
    if (settings.social.associates.some((person) => String(person?.name || "").trim().toLowerCase() === npc.name.toLowerCase())) continue;
    settings.social.associates.push({
      ...npc,
      affinity: 50,
      relationshipStatus: "Local acquaintance",
      location: npc.startsInLocation ? locName : "",
      currentLocation: npc.startsInLocation ? locName : "",
      met_physically: npc.startsInLocation === true,
      liveSync: true
    });
  }

  // Synchronize dynamic starting location and background in the map engine and reality backgrounds list
  settings.mapEngine = settings.mapEngine || {};
  settings.mapEngine.selectedRegionId = settings.mapEngine.selectedRegionId || "reg_start";
  const regId = settings.mapEngine.selectedRegionId;
  settings.mapEngine.sceneGraph = settings.mapEngine.sceneGraph || {};
  settings.mapEngine.sceneGraph.locals = settings.mapEngine.sceneGraph.locals || {};
  settings.mapEngine.sceneGraph.locals[regId] = settings.mapEngine.sceneGraph.locals[regId] || [];

  // Find or insert the starting coordinate room
  let startRoom = settings.mapEngine.sceneGraph.locals[regId].find(r => r.x === 0 && r.y === -1 && r.z === 0);
  if (!startRoom) {
    startRoom = {
      id: `local_start_${Date.now()}`,
      x: 0,
      y: -1,
      z: 0,
      connections: []
    };
    settings.mapEngine.sceneGraph.locals[regId].push(startRoom);
  }
  startRoom.name = newGameState.location.name || "Backstage Dressing Room";
  startRoom.description = newGameState.location.description || "A cozy starting space.";
  startRoom.theme = newGameState.location.terrain || "backstage";
  startRoom.type = "room";
  startRoom.isStartingRoom = true;

  settings.realityEngine = settings.realityEngine || {};
  settings.realityEngine.backgrounds = settings.realityEngine.backgrounds || {};
  if (newGameState.location.bg) {
    persistStartingBackground(settings, locName, newGameState.location.bg);
  }

  // Inject lorebook entries into actual lorebook system
  if (newGameState.lorebook.entries.length > 0) {
    if (!Array.isArray(settings.lorebooks)) settings.lorebooks = [];
    
    // Find or create "New Game Lorebook"
    let newGameBook = settings.lorebooks.find(b => b.name === "New Game Lorebook");
    if (!newGameBook) {
      newGameBook = {
        name: "New Game Lorebook",
        enabled: false,
        scanDepth: 2,
        tokenBudget: 1000,
        entries: {}
      };
      settings.lorebooks.push(newGameBook);
    }

    // Inject all entries
    newGameState.lorebook.entries.forEach(entry => {
      newGameBook.entries[String(entry.uid)] = entry;
    });
  }
  
  // Apply character data
  if (!settings.character) settings.character = {};
  settings.character.name = newGameState.character.name;
  
  let finalClassName = newGameState.character.class;
  if (finalClassName === "custom") {
    finalClassName = (document.getElementById("ng-char-class-custom")?.value || "").trim() || "Custom";
  } else {
    finalClassName = finalClassName.charAt(0).toUpperCase() + finalClassName.slice(1);
  }
  
  settings.character.class = finalClassName;
  settings.character.resourceProfile = newGameState.character.resourceProfile || "ap";
  settings.character.race = newGameState.character.race;
  settings.character.mode = newGameState.character.mode;
  settings.character.level = newGameState.character.level;
  settings.character.currentAge = newGameState.character.age;
  settings.character.age = newGameState.character.age;
  settings.character.agingMultiplier = parseFloat(document.getElementById('ng-aging-speed')?.value) || 1;
  settings.character.stats = newGameState.character.stats;
  settings.character.statLabels = { ...(newGameState.character.statLabels || {}) };
  settings.statLabels = { ...(newGameState.character.statLabels || {}) };
  settings.character.alignment = newGameState.character.alignment;
  const joinedOrganizationNames = newGameState.factions
    .filter((faction) => String(faction?.status || "none").toLowerCase() !== "none")
    .map((faction) => String(faction?.name || "").trim())
    .filter(Boolean);
  settings.character.organizationAffiliations = joinedOrganizationNames;
  settings.character.affiliation = joinedOrganizationNames[0] || "";
  settings.character.organization = joinedOrganizationNames[0] || "";
  settings.party = settings.party && typeof settings.party === "object" ? settings.party : {};
  const playerPartyMember = createStartingPartyMember({
    id: "party_user",
    name: settings.character.name,
    className: settings.character.class,
    race: settings.character.race,
    alignment: settings.character.alignment,
    level: settings.character.level,
    stats: settings.character.stats,
    avatar: newGameState.character.avatar,
    description: settings.appearance?.description || ""
  }, true);
  settings.party.members = [
    playerPartyMember,
    ...startingNpcs.filter(npc => npc.inParty === true).map(npc => createStartingPartyMember(npc))
  ];
  settings.party.leaderId = playerPartyMember.id;
  
  settings.character.avatar = document.getElementById('ng-character-avatar')?.value?.trim() || newGameState.character.avatar || "";
  settings.character.sprites = Array.isArray(newGameState.appearance.sprites) ? newGameState.appearance.sprites.map((sprite) => ({ ...sprite })) : [];
  settings.character.generatedSprites = {};
  settings.character.aging = {
    enabled: document.getElementById('ng-aging-enabled')?.checked === true,
    speed: parseFloat(document.getElementById('ng-aging-speed')?.value) || 1
  };

  settings.character_master = settings.character_master || {};
  settings.character_master.name = newGameState.character.name;
  settings.character_master.race = newGameState.character.race;
  settings.character_master.species = newGameState.character.race;
  settings.character_master.className = settings.character.class;
  settings.character_master.level = newGameState.character.level;
  settings.character_master.currentAge = newGameState.character.age;

  // Apply appearance data
  if (!settings.appearance) settings.appearance = {};
  settings.appearance.description = newGameState.appearance.description;
  settings.appearance.backstory = newGameState.appearance.backstory;
  settings.appearance.sprites = Array.isArray(newGameState.appearance.sprites) ? newGameState.appearance.sprites.map((sprite) => ({ ...sprite })) : [];

  // Apply the primary wallet in the numeric format used by HUD, shops, and state mutations.
  settings.currency = Number(newGameState.currency.amount || 0);
  settings.currencySymbol = String(newGameState.currency.symbol || "G");
  settings.currencyConfig = { ...newGameState.currency };

  settings.playerProgress = {
    hp: 100,
    maxHp: 100,
    uie: ["mp", "both", "custom"].includes(newGameState.character.resourceProfile) ? 100 : 0,
    skillPoints: 0,
    abilityPoints: ["ap", "both", "custom"].includes(newGameState.character.resourceProfile) ? 100 : 0,
    skills: Object.fromEntries(normalizedSkills.map((skill) => [String(skill.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_"), Number(skill.level || 1)])),
    needs: Object.fromEntries((newGameState.lifeTrackers || []).map((tracker) => [String(tracker.name || "").toLowerCase(), Number(tracker.current || 0)]))
  };

  // Apply factions
  settings.factions = {
    list: newGameState.factions.map((faction, index) => ({
      id: `newgame_group_${index + 1}`,
      name: faction.name,
      type: faction.type || "group",
      standing: Number(faction.reputation || 0),
      scope: faction.scope || "building",
      membershipStatus: faction.status || "none",
      base: faction.base || "",
      baseType: faction.baseType || faction.scope || "",
      controlledSpaces: Array.isArray(faction.controlledSpaces) ? faction.controlledSpaces : (faction.base ? [faction.base] : []),
      assets: Array.isArray(faction.assets) ? faction.assets : [],
      members: String(faction.status || "none").toLowerCase() === "none" ? [] : [{
        id: "user_member",
        name: newGameState.character.name,
        rank: faction.status || "Member",
        role: faction.status || "member",
        sourceType: "user",
        sourceId: "user",
        count: 1
      }],
      notes: "",
      npcTemplate: "",
      updatedAt: Date.now()
    })),
    laws: []
  };

  // Apply life trackers through the same state paths used by Inventory -> Life and the HUD.
  applyLifeTrackersToSettings(settings, newGameState.lifeTrackers, settings.ui?.vitalIcons || {});
  settings.simpleMap = settings.simpleMap || {};
  settings.simpleMap.mapStyle = newGameState.character.mode === "high-fantasy"
    ? "high-fantasy"
    : newGameState.character.mode === "futuristic" ? "futuristic" : "modern";

  // Starting setup items are world items until the player explicitly takes them.
  if (!settings.inventory) settings.inventory = { items: [], skills: [], assets: [] };
  settings.inventory.items = [];
  settings.inventory.skills = normalizedSkills;
  settings.inventory.assets = [];
  settings.worldState = settings.worldState || {};
  settings.worldState.availableAssets = setupAssets.map((asset) => ({
    ...asset,
    location: asset.location || newGameState.location.name || "Starting Location",
    _meta: { ...(asset._meta || {}), source: "newgame_available_asset", owned: false, updatedAt: Date.now() },
  }));
  settings.worldState = settings.worldState || {};
  const startingLocForItems = newGameState.location.name || "Starting Location";
  settings.worldState.worldItems = (Array.isArray(newGameState.inventory) ? newGameState.inventory : []).map((item, index) => ({
    ...item,
    qty: Math.max(1, Number(item?.qty || item?.quantity || 1)),
    statusEffects: Array.isArray(item?.statusEffects) ? item.statusEffects : [],
    mods: item?.mods && typeof item.mods === "object" ? item.mods : {},
    location: startingLocForItems,
    _key: `${startingLocForItems}:${String(item?.name || `item_${index}`).trim()}`.toLowerCase(),
    _meta: { ...(item?._meta || {}), source: "newgame_world_item", createdAt: Date.now(), updatedAt: Date.now() },
  }));

  // Apply quests
  if (!settings.journal) settings.journal = { quests: [] };
  settings.journal.quests = [...newGameState.quests];

  // Apply location
  if (!settings.world) settings.world = {};
  settings.world.startingLocation = newGameState.location;
  settings.world.gameMode = newGameState.character.mode || "modern";
  settings.world.generationScope = { ...newGameState.worldScope };
  settings.world.aging = {
    enabled: newGameState.character.aging.enabled === true,
    speed: newGameState.character.aging.speed
  };
  settings.worldState = settings.worldState || {};
  settings.worldState.generationScope = { ...newGameState.worldScope };
  if (newGameState.worldScope.description) settings.worldState.description = newGameState.worldScope.description;
  settings.aging = {
    enabled: newGameState.character.aging.enabled === true,
    agingEnabled: newGameState.character.aging.enabled === true,
    speed: newGameState.character.aging.speed,
    playerStartAge: newGameState.character.age
  };

  // Update loading subtitle
  if (loadingEl) {
    setNewGameLoading("Summoning AI Storyteller for dynamic opening scenario...", 65);
  }

  // Dynamic starting narrative via AI storyteller
  const characterNameVal = settings.character?.name || "Player";
  const startLocNameVal = settings.worldState?.location || "Starting Point";
  const startLocDescVal = settings.worldState?.locationDesc || "";
  const backstoryVal = settings.appearance?.backstory || "";
  const charClassVal = settings.character?.class || "Adventurer";
  const charRaceVal = settings.character?.race || "Human";
  const charAgeVal = settings.character?.age || 18;

  const aiStoryPrompt = `You are the narrator of a highly immersive, atmospheric RPG.
Generate a premium welcome and wake-up starting scenario for the following character and setting.

[CHARACTER]
- Name: ${characterNameVal}
- Race: ${charRaceVal}
- Class: ${charClassVal}
- Backstory: ${backstoryVal}
- Description: ${settings.appearance?.description || ""}
- Age: ${charAgeVal}

[STARTING LOCATION]
- Name: ${startLocNameVal}
- Description: ${startLocDescVal}
- Terrain: ${startRoom.theme || "unknown"}
- Danger: ${newGameState.location?.danger || "safe"}
- NPCs: ${newGameState.location?.npcs?.join(", ") || "none"}
- Prompt: ${newGameState.location?.startingSequence || "Begin with an immediate grounded first beat."}
`;

  let introText = "";
  let storyGenerationError = "";
  let newGameAiReady = prepareNewGameStoryApi(settings);
  if (newGameAiReady) {
    try {
      console.log("[NewGame] Generating scenario via AI...");
      if (typeof window.skipNextAiConfirmOnce === "function") window.skipNextAiConfirmOnce();
      else window.__uieSkipAiConfirmOnce = true;
      introText = String(await generateContent(aiStoryPrompt, "Story opening snippet") || "").trim();
      if (!introText) {
        newGameAiReady = false;
      }
    } catch (err) {
      console.warn("[NewGame] AI generation failed, using procedural fallback.", err);
      newGameAiReady = false;
      storyGenerationError = String(err?.message || err || "AI failed");
    }
  }

  if (!introText) {
    const terrain = startRoom.theme || "unknown";
    let ambientText = "A calm quietude wraps around the environment, as though the world itself is pausing in anticipation of your first steps.";
    if (/forest|nature/i.test(terrain)) {
      ambientText = "Rustling leaves whisper in the gentle breeze under the dense forest canopy. Moss and wild pine fill the air.";
    } else if (/backstage|room/i.test(terrain)) {
      ambientText = "The warm glow of vanity bulbs glints off polished backstage mirrors. The scent of stage wax lingers.";
    }
    const backstoryParagraph = backstoryVal
      ? `Memories of your past stir within your chest: ${backstoryVal}.`
      : `Standing with renewed purpose, you feel the pull of destiny as a ${charRaceVal} ${charClassVal}.`;

    introText = `[Narrator]: You open your eyes in the ${startLocNameVal}. ${startLocDescVal || "A starting area."} ${ambientText}\n\n[Narrator]: ${backstoryParagraph}`;
  }

  settings.ui = settings.ui || {};
  settings.ui.storyIntro = settings.ui.storyIntro || {};
  settings.ui.storyIntro.wakeMbUniversal = introText;
  settings.ui.storyIntro.wakeChatUniversal = introText;
  settings.ui.storyIntro.worldbuilding = introText;

  // Create active persona
  const newPersonaId = `persona_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const personaExpressions = buildPersonaExpressionsFromSprites(settings.appearance?.sprites || settings.character?.sprites || []);
  const newPersona = {
    id: newPersonaId,
    name: characterNameVal,
    title: `${charRaceVal} ${charClassVal}`,
    age: Number(charAgeVal),
    description: `A ${charRaceVal} ${charClassVal} with the following details.\n\nBackstory:\n${backstoryVal}\n\nAppearance:\n${settings.appearance?.description || ""}`,
    imageUrl: settings.character?.avatar || "",
    portrait_gallery: settings.character?.avatar ? [{ id: `port_${Date.now()}`, url: settings.character.avatar }] : [],
    description_variants: [],
    persona_expression_mode: "stage",
    expressions: personaExpressions,
    position: "prompt",
    depth: 4,
    role: "system",
    createdAt: Date.now(),
    family: []
  };
  if (!Array.isArray(settings.personas)) settings.personas = [];
  settings.personas.push(newPersona);
  settings.activePersonaId = newPersonaId;
  settings.character.activePersonaId = newPersonaId;

  if (loadingEl) {
    setNewGameLoading("AI Cartographer is generating the world map...", 82);
  }
  try {
    saveSettings();
    if (typeof window.skipNextAiConfirmOnce === "function") window.skipNextAiConfirmOnce();
    else window.__uieSkipAiConfirmOnce = true;
    const mapModule = await import("../map.js");
    if (typeof mapModule.generateForTier !== "function") throw new Error("Cartographer generateForTier() is unavailable.");
    mapModule.resetMapState?.();
    const requestedMapMode = newGameState.worldScope.mode || "hybrid";
    const mapMode = newGameAiReady ? requestedMapMode : "procedural";
    if (newGameState.presetId === ADVENTURE_PATH_PRESET_ID && requestedMapMode === "preset") {
      installAdventurePathMap(settings);
      settings.lastNewGameWorldGeneration = {
        ok: true,
        at: Date.now(),
        ...newGameState.worldScope,
        mode: "preset",
        usedProceduralFallback: false
      };
    } else if (requestedMapMode === "none") {
      // Setup simple, single-node worldState and simpleMap bypass
      settings.worldState = settings.worldState || {};
      settings.worldState.location = startLocNameVal;
      settings.worldState.locationDesc = startLocDescVal;
      
      settings.worldState.navGraph = {};
      settings.worldState.mapNodes = {};
      settings.worldState.areaScenes = {};
      settings.worldState.rooms = {};
      
      settings.worldState.mapNodes[startLocNameVal] = {
        name: startLocNameVal,
        type: startRoom.theme || "room",
        district: "General",
        chars: [],
        interactions: ["observe", "search"],
        exits: {},
        description: startLocDescVal || "A starting area with map generation disabled.",
        coords: { x: 200, y: 150, z: 0 },
        theme: startRoom.theme || "",
        blueprintId: "",
        backgroundPrompt: `visual novel background, ${startLocNameVal}, ${startRoom.theme || "room"}, detailed environment, no text, no logo`,
        discoveryState: { discovered: true, visited: true }
      };
      
      settings.worldState.areaScenes[startLocNameVal] = {
        name: startLocNameVal,
        description: startLocDescVal || "A starting area with map generation disabled.",
        imagePrompt: `visual novel background, ${startLocNameVal}, ${startRoom.theme || "room"}, detailed environment, no text, no logo`,
        imageUrl: newGameState.location.bg || ""
      };
      
      settings.simpleMap = {
        view: "world",
        area: [
          {
            id: "start_node",
            name: startLocNameVal,
            type: startRoom.theme || "room",
            desc: startLocDescVal || "A starting area with map generation disabled.",
            x: 200,
            y: 150,
            isStartingRoom: true,
            discovered: true,
            visited: true
          }
        ],
        vicinity: [],
        blueprints: {},
        selectedId: "start_node",
        generated: {
          counts: { ...newGameState.worldScope.counts },
          prompt: "Map generation disabled",
          scope: "world",
          seed: "none",
          mode: "none",
          generatedAt: Date.now()
        }
      };
      
      settings.lastNewGameWorldGeneration = {
        ok: true,
        at: Date.now(),
        ...newGameState.worldScope,
        mode: "none",
        usedProceduralFallback: false
      };
    } else {
      await mapModule.generateForTier("local", {
        mode: mapMode,
        label: newGameState.worldScope.seedName || "",
        prompt: [
          `Build the surroundings, local area, regions, and world outward from the starting room "${startLocNameVal}".`,
          `The starting room must remain named "${startLocNameVal}" and must stay in the generated map.`,
          startLocDescVal ? `Starting room description: ${startLocDescVal}` : "",
          newGameState.worldScope.description || ""
        ].filter(Boolean).join("\n"),
        anchorRoom: {
          name: startLocNameVal,
          description: startLocDescVal,
          theme: startRoom.theme || "unknown"
        },
        counts: { ...newGameState.worldScope.counts }
      });
      settings.lastNewGameWorldGeneration = {
        ok: true,
        at: Date.now(),
        ...newGameState.worldScope,
        mode: mapMode,
        usedProceduralFallback: mapMode === "procedural" && requestedMapMode !== "procedural"
      };
    }
  } catch (err) {
    console.error("[NewGame] World generation failed:", err);
    settings.lastNewGameWorldGeneration = {
      ok: false,
      at: Date.now(),
      error: String(err?.message || err || "Unknown world generation error").slice(0, 500)
    };
    window.showToast?.(`World generation failed: ${settings.lastNewGameWorldGeneration.error}`, 10000);
  }

  addGeneratedNpcLivesToWorld(settings, gameNpcs, startLocNameVal);
  try {
    const schedules = await import("../schedules.js");
    schedules.updateCharacterSchedules?.(settings, { allowDeviation: false });
  } catch (err) {
    console.warn("[NewGame] Character schedules could not be initialized:", err);
  }

  if (loadingEl) {
    setNewGameLoading("Finalizing Quantum Reality Matrix...", 90);
  }

  // Fix background routing: Save custom start background so bedroom fallbacks never override it
  const bgToApply = newGameState.location.bg || "";
  if (bgToApply) {
    const finalStartLocation = String(startLocNameVal || settings.worldState?.location || "Immersion Sandbox").trim();
    persistStartingBackground(settings, finalStartLocation, bgToApply);
  }

  // Save settings
  saveSettings();
  try {
    const life = await import("./life.js");
    life.init?.();
    life.render?.();
  } catch (_) {}
  try { window.updateHudFromState?.(); } catch (_) {}
  try { window.renderCustomHudTrackers?.(); } catch (_) {}
  if (typeof window.UIE_initGameModeTheme === "function") {
    window.UIE_initGameModeTheme();
  }

  // Reset character creator state
  newGameState = {
    character: { name: "", class: "warrior", customClass: "", resourceProfile: "ap", race: "", mode: "modern", level: 1, age: 18, aging: { enabled: false, speed: 1 }, vitalIcons: { hp: "fa-heart", ap: "fa-bolt", mp: "fa-wand-magic-sparkles", xp: "fa-star" }, vitalLabels: { hp: "HP", ap: "AP", mp: "MP", xp: "XP" }, stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, statLabels: { ...DEFAULT_STAT_LABELS }, alignment: "neutral-good" },
    appearance: { description: "", backstory: "", sprites: [] },
    lorebook: { entries: [], selectedBooks: [] },
    currency: { name: "Gold", symbol: "🪙", amount: 100, realValue: 0.01 },
    factions: [],
    reputation: {},
    lifeTrackers: [
      { name: "HP", current: 100, max: 100, color: "#ff6b6b", icon: "fa-heart", visible: true },
      { name: "AP", current: 100, max: 100, color: "#4dadf7", icon: "fa-bolt", visible: true },
      { name: "MP", current: 100, max: 100, color: "#b26cff", icon: "fa-wand-magic-sparkles", visible: true },
      { name: "XP", current: 0, max: 100, color: "#ffc107", icon: "fa-star", visible: true }
    ],
    inventory: [],
    skills: [],
    quests: [],
    assets: [],
    location: { type: "room", name: "", description: "", terrain: "forest", danger: "safe", npcs: [], npcDetails: [], bg: "", startingSequence: "" },
    worldScope: { type: "local", mode: "hybrid", seedName: "", counts: { worlds: 1, regions: 1, settlements: 1, places: 6, roomsPerInterior: 8, blueprintMode: "sites" }, description: "" }
  };
  mounted = false;

  // Enter the newly-created game directly. Reloading here re-runs startup and returns to the menu.
  try {
    localStorage.removeItem("uie_newgame_started");
    hideNewGamePopup(false);
    setNewGameLoading("Entering generated world...", 98);
    if (typeof window.UIE_enterGameplay === "function") {
      window.UIE_enterGameplay();
    } else {
      window.$?.("#startup-modal")?.hide?.();
      window.UIE_showGameplayUi?.(300);
    }
    try {
      import("../navigation.js").then((mod) => {
        mod.showNavigationTutorialPopup?.(true);
      }).catch((e) => console.warn(e));
    } catch (_) {}
    if (loadingEl) {
      setTimeout(() => {
        loadingEl.style.display = "none";
        loadingEl.classList.add("uie-loading-hidden");
      }, 650);
    }
    if (bgToApply) {
      if (typeof window.setLocalSceneBackgroundFromDataUrl === "function") {
        window.setLocalSceneBackgroundFromDataUrl(bgToApply);
      } else {
        document.querySelectorAll("#re-bg, #game-root").forEach((el) => {
          el.style.setProperty("background-image", `url("${bgToApply.replace(/"/g, "%22")}")`, "important");
          el.style.setProperty("background-size", "cover", "important");
          el.style.setProperty("background-position", "center", "important");
        });
      }
    }
    document.getElementById("uie-newgame-tutorial-choice")?.remove();
  } catch (e) {
    console.error("[NewGame] Failed to enter gameplay:", e);
  }
}

const PRESET_BACKGROUNDS = [
  // Game Modes
  {
    name: "Adventure Path",
    description: "A winding dirt road through green hills under open sky. It is a clean general-adventure start with obvious routes outward and enough breathing room for merchants, companions, or the first hint of trouble.",
    url: "./assets/backgrounds/adventure_path.png",
    category: "modes",
    type: "Adventure",
    mode: "rpg",
    terrain: "plains"
  },
  {
    name: "Ruined Arena",
    description: "Ancient stone arena remnants sit under a bruised sky. It is an immediate action setup for tests of strength, rival introductions, ceremonial combat, or the aftermath of a battle.",
    url: "./assets/backgrounds/ruined_arena.png",
    category: "modes",
    type: "Combat",
    mode: "rpg",
    terrain: "ruins"
  },
  {
    name: "Desolate Campsite",
    description: "A lone campfire burns in dark wilderness with supplies close at hand and shadows pressing in. It supports survival openings, uneasy watches, failed expeditions, or a quiet night before pursuit.",
    url: "./assets/backgrounds/desolate_campsite.png",
    category: "modes",
    type: "Survival",
    mode: "rpg",
    terrain: "forest"
  },
  {
    name: "Abandoned Cabin",
    description: "A weather-beaten cabin stands silent in a dense forest. It is a contained survival or mystery start with shelter, old belongings, and the possibility that someone was here before you.",
    url: "./assets/backgrounds/abandoned_cabin.png",
    category: "modes",
    type: "Survival",
    mode: "rpg",
    terrain: "forest"
  },

  // Starting Locations
  {
    name: "Sunlit Classroom",
    description: "A bright academy classroom with orderly desks, a broad chalkboard, and morning sunlight spilling across polished floors. It is a grounded school-life start with room for classmates, teachers, clubs, or quiet after-class scenes.",
    url: "./assets/backgrounds/starting-classroom-modern.png",
    category: "locations",
    type: "Classroom",
    terrain: "urban"
  },
  {
    name: "Classic Classroom",
    description: "A familiar classroom anchor ready for homeroom arrivals, transfer-student introductions, academy mysteries, and quiet slice-of-life openings.",
    url: "./assets/backgrounds/Classroom.png",
    category: "locations",
    type: "Classroom",
    terrain: "urban"
  },
  {
    name: "After-School Classroom",
    description: "The same classroom after the bell, calmer and more private, with empty desks, fading daylight, and space for club meetings, tutoring, confessions, or an unusual discovery.",
    url: "./assets/backgrounds/starting-classroom-modern.png",
    category: "locations",
    type: "Classroom",
    terrain: "urban"
  },
  {
    name: "Homeroom Classroom",
    description: "A dependable first-period classroom preset for roll call, seat assignments, teacher briefings, rival classmates, and ordinary school routines before the story bends.",
    url: "./assets/backgrounds/Classroom.png",
    category: "locations",
    type: "Classroom",
    terrain: "urban"
  },
  {
    name: "Rainy Corner Cafe",
    description: "A cozy neighborhood cafe glowing with warm lamps while rain beads on the front windows. It is an intimate modern start for conversations, chance meetings, part-time work, or low-stakes mystery.",
    url: "./assets/backgrounds/starting-rainy-cafe.png",
    category: "locations",
    type: "Interior",
    terrain: "urban"
  },
  {
    name: "Apartment Studio",
    description: "A compact bedroom studio overlooking the city at blue hour, with a desk, bed, balcony, and lived-in details. It suits personal beginnings, daily routines, online life, and late-night decisions.",
    url: "./assets/backgrounds/starting-apartment-studio.png",
    category: "locations",
    type: "Interior",
    terrain: "urban"
  },
  {
    name: "Moonlit Guild Hall",
    description: "A timber-and-stone guild hall lit by hearthfire and moonlight, with maps, job boards, long tables, and packed travel gear. It is a strong fantasy start for quests, parties, contracts, and tavern politics.",
    url: "./assets/backgrounds/starting-moonlit-guild-hall.png",
    category: "locations",
    type: "Guild",
    terrain: "urban"
  },
  {
    name: "Neon Transit Platform",
    description: "A rain-slick elevated transit platform surrounded by neon towers, glowing route boards, vending machines, and empty rails. It is a kinetic futuristic start for travel, surveillance, city drama, or first contact.",
    url: "./assets/backgrounds/starting-neon-transit-platform.png",
    category: "locations",
    type: "Transit",
    terrain: "urban"
  },
  {
    name: "Frontier Airship Dock",
    description: "A high sky dock above the clouds with an airship, cargo crates, wind flags, and floating islands in the distance. It is an open-world adventure start with immediate routes outward.",
    url: "./assets/backgrounds/starting-frontier-airship-dock.png",
    category: "locations",
    type: "Skyport",
    terrain: "coastal"
  },
  {
    name: "Sand Dunes",
    description: "Sweeping waves of red sand roll toward the horizon under a hard desert sun. The open sightlines make it a clean survival, caravan, exile, or lost-expedition starting point.",
    url: "./assets/backgrounds/sand_dunes.png",
    category: "locations",
    type: "Desert",
    terrain: "desert"
  },
  {
    name: "Desert Oasis",
    description: "Lush palms ring a clear desert spring beneath a cool night sky. It works well for rest stops, hidden settlements, negotiations, or a fragile refuge surrounded by danger.",
    url: "./assets/backgrounds/desert_oasis.png",
    category: "locations",
    type: "Desert",
    terrain: "desert"
  },
  {
    name: "Foggy Marsh",
    description: "Murky swamp water winds between ancient trees and thick banks of white fog. It is a tense start for exploration, curses, hidden paths, and uncertain sounds beyond sight.",
    url: "./assets/backgrounds/foggy_marsh.png",
    category: "locations",
    type: "Swamp",
    terrain: "swamp"
  }
];

let galleryEventsBound = false;

function showPresetsGallery() {
  const overlay = document.getElementById("uie-presets-gallery-overlay");
  if (overlay) {
    overlay.classList.add("active");
    renderPresetsGallery("all");
    if (!galleryEventsBound) {
      bindPresetsGalleryEvents();
      galleryEventsBound = true;
    }
  }
}

function hidePresetsGallery() {
  const overlay = document.getElementById("uie-presets-gallery-overlay");
  if (overlay) {
    overlay.classList.remove("active");
  }
}

function bindPresetsGalleryEvents() {
  document.getElementById("uie-presets-gallery-close-btn")?.addEventListener("click", hidePresetsGallery);
  
  // Close on overlay background click
  document.getElementById("uie-presets-gallery-overlay")?.addEventListener("click", function(e) {
    if (e.target === this) hidePresetsGallery();
  });

  // Category navigation tabs
  const navBtns = document.querySelectorAll(".uie-presets-gallery-nav-btn");
  navBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      navBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderPresetsGallery(btn.getAttribute("data-category"));
    });
  });
}

function renderPresetsGallery(category = "all") {
  const grid = document.getElementById("uie-presets-gallery-grid");
  if (!grid) return;

  grid.innerHTML = "";
  const filtered = PRESET_BACKGROUNDS.filter(preset => {
    if (category === "all") return true;
    return preset.category === category;
  });

  filtered.forEach(preset => {
    const card = document.createElement("div");
    card.className = "uie-presets-gallery-card";
    
    const displayUrl = preset.url;
    
    card.innerHTML = `
      <div class="uie-presets-gallery-card-img" style="background-image: url('${displayUrl}');">
        <span class="uie-presets-gallery-card-badge">${preset.type}</span>
      </div>
      <div class="uie-presets-gallery-card-info">
        <h4 class="uie-presets-gallery-card-name">${escapeHtml(preset.name)}</h4>
        <p class="uie-presets-gallery-card-desc">${escapeHtml(preset.description)}</p>
      </div>
    `;

    card.addEventListener("click", () => {
      newGameState.location.bg = preset.url;
      
      const bgUrlInput = document.getElementById("ng-location-bg-url");
      if (bgUrlInput) bgUrlInput.value = preset.url;

      const bgPreview = document.getElementById("ng-location-bg-preview");
      if (bgPreview) {
        bgPreview.style.backgroundImage = `url("${preset.url}")`;
        bgPreview.style.display = "block";
      }

      if (preset.category === "locations") {
        newGameState.location.name = preset.name;
        newGameState.location.description = preset.description;
        const nameInput = document.getElementById("ng-location-name");
        const descInput = document.getElementById("ng-location-description");
        if (nameInput) nameInput.value = preset.name;
        if (descInput) descInput.value = preset.description;
      }

      // Automatically coexist: update game mode or starting terrain if applicable
      if (preset.mode) {
        const modeSelect = document.getElementById("ng-char-mode");
        if (modeSelect) {
          modeSelect.value = preset.mode;
          newGameState.character.mode = preset.mode;
          applyModeBackplate(newGameState.character.mode);
        }
      }
      if (preset.terrain) {
        const terrainSelect = document.getElementById("ng-location-terrain");
        if (terrainSelect) {
          terrainSelect.value = preset.terrain;
          newGameState.location.terrain = preset.terrain;
        }
      }

      if (window.showToast) {
        window.showToast(`Selected Preset: ${preset.name} (Matched with ${preset.type})`, 3000);
      }

      hidePresetsGallery();
    });

    grid.appendChild(card);
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function initNewGame() {
  // Called from startup to initialize the module
  // The UI is already created by the template loading
  // We just need to mount it when the user opens it
  // Make functions globally accessible
  window.UIE_showNewGamePopup = showNewGamePopup;
  window.UIE_hideNewGamePopup = hideNewGamePopup;
}

// Initialize on import
try {
  initNewGame();
} catch (err) {
  console.warn("[NewGame] Failed to initialize:", err);
}
