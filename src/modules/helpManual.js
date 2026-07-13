import { getSettings, saveSettings } from "./core.js";

export const HELP_SECTIONS = [
  {
    id: "guide-start",
    group: "First Steps",
    title: "Start Playing",
    summary: "Begin a new game, learn the main controls, and decide whether to take the tutorial.",
    steps: [
      "Use New Game to create your character, starting place, resources, party, and opening story.",
      "After the game begins, the Helper Pet offers a guided tour. Choose Start Tutorial for a walkthrough or Skip Tutorial if you already know the interface.",
      "Open the Command Deck from the menu button. It is the hub for story, character, world, and system tools.",
      "Use Help / Manual any time you need a full reference, and use Tutorial Mode when you want the pet to point at the active window."
    ]
  },
  {
    id: "guide-command-deck",
    group: "First Steps",
    title: "Command Deck",
    summary: "Your main launcher for every game system.",
    steps: [
      "Story contains Journal, Diary, Map, Organizations, Activities, and Battle.",
      "Character contains Persona, Inventory, Characters, Party, Social, and Stats.",
      "World contains Databank, Phone, Calendar, Atmosphere, and Helper Pet.",
      "System contains Settings, Help / Manual, Save, Load, and Exit."
    ]
  },
  {
    id: "guide-helper",
    group: "First Steps",
    title: "Helper Pet",
    summary: "A draggable companion that explains windows, creates things, and warns you about rules.",
    steps: [
      "Click the Helper Pet to chat. Use the gear button to choose its look, name, personality, and voice behavior.",
      "When Tutorial Mode is active, the pet explains the current modal or window and lights up the relevant controls.",
      "Ask it for generated items, kits, quests, skills, or status effects. It will try to place results in the correct game system.",
      "Rule and compliance warnings appear near the pet when local laws conflict with equipped gear."
    ]
  },
  {
    id: "guide-inventory",
    group: "Character",
    title: "Inventory and Field Kit",
    summary: "Manage items, gear, skills, assets, crafting, food, and character resources.",
    steps: [
      "Items is the main bag. Open, use, equip, inspect, split stacks, or read generated books from item actions.",
      "Equipment manages outfits, equipped slots, sprites, and outfit drafts.",
      "Skills stores abilities and can add useful powers to quick access.",
      "Kitchen, Alchemy, Forge, Enchant, Create, and Assets are specialist tabs for making or improving things.",
      "Life trackers let you create custom needs such as hunger, stamina, stress, or reputation pressure."
    ]
  },
  {
    id: "guide-stats",
    group: "Character",
    title: "Stats",
    summary: "Your character sheet, vitals, attributes, portrait, and progression.",
    steps: [
      "Vitals show HP, AP, MP, XP, and any custom trackers created during setup.",
      "Attributes affect rolls, combat, activities, and story checks.",
      "Use edit controls when you need to correct or manually tune a value.",
      "Portrait controls let you upload or change the character image."
    ]
  },
  {
    id: "guide-party",
    group: "Character",
    title: "Party",
    summary: "Companion roster, tactics, formation, shared inventory, and member sheets.",
    steps: [
      "Roster adds, imports, edits, removes, and activates party members.",
      "Member view edits vitals, biography, trackers, equipment, skills, and notes.",
      "Tactics sets party strategy, protect targets, focus targets, and resource conservation.",
      "Formation places companions into front, middle, and back lanes.",
      "Inventory stores shared party items separately from the solo bag."
    ]
  },
  {
    id: "guide-social",
    group: "Character",
    title: "Social",
    summary: "Relationships, NPC memory, affinity, disposition, contacts, and social notes.",
    steps: [
      "Cards show known NPCs, affinity, mood, notes, tags, and current location.",
      "Manual Add creates a person when the scanner has not detected them yet.",
      "Social memory helps NPCs remember gifts, arguments, promises, and important shared events.",
      "Use Help in the Social menu to jump back to this reference."
    ]
  },
  {
    id: "guide-persona",
    group: "Character",
    title: "Persona and Characters",
    summary: "Manage your player identity and reusable character cards.",
    steps: [
      "Persona controls the active player identity used for story context.",
      "Characters stores reusable NPC or cast cards that can be imported into new games.",
      "Use clear names, roles, goals, and descriptions so story generation has strong anchors.",
      "Keep lore and character-card metadata out of visible roleplay unless you intend it to appear."
    ]
  },
  {
    id: "guide-journal",
    group: "Story",
    title: "Journal",
    summary: "Quests, objectives, plot threads, and progress notes.",
    steps: [
      "Use quests for goals you want tracked across scenes.",
      "Add clear objective wording so the AI and state scanners can follow what changed.",
      "Mark finished or failed tasks to keep the active story list focused.",
      "Use Journal separately from Diary: Journal is for tasks; Diary is for private reflection."
    ]
  },
  {
    id: "guide-diary",
    group: "Story",
    title: "Diary",
    summary: "Private entries, memories, photos, stickers, and personal roleplay notes.",
    steps: [
      "Write daily reflections, secrets, plans, or emotional beats.",
      "Attach images or stickers to make important scenes easy to remember.",
      "Diary entries are for you; quest-critical instructions belong in Journal."
    ]
  },
  {
    id: "guide-map",
    group: "World",
    title: "Map and Travel",
    summary: "Explore rooms, places, regions, routes, generated maps, and transit.",
    steps: [
      "The map shows known places and connections. Select a node to inspect or travel.",
      "Nearby routes can be discovered from narration and added to the map.",
      "Manual cartography lets you create locations that the story has not generated yet.",
      "Transit systems such as train, airport, bus, subway, or ferry can move you between larger areas."
    ]
  },
  {
    id: "guide-calendar",
    group: "World",
    title: "Calendar and Schedules",
    summary: "Time, day/night behavior, birthdays, appointments, and character routines.",
    steps: [
      "Time advances through roleplay, travel, activities, and manual controls.",
      "Schedules influence where people are and what they might be doing.",
      "Calendar events help you plan dates, deadlines, holidays, and recurring obligations.",
      "Use the schedule tools when a world should feel alive even when you are not watching one NPC."
    ]
  },
  {
    id: "guide-activities",
    group: "Story",
    title: "Activities",
    summary: "Downtime jobs, training, studying, crafting, resting, and routine tasks.",
    steps: [
      "Start an activity when your character spends time on a defined task.",
      "Activities can grant rewards, advance time, improve stats, or change resources.",
      "Party activities let companions train, work, recover, or support the group.",
      "Use activities for repeated routines so every routine does not need a full manual scene."
    ]
  },
  {
    id: "guide-battle",
    group: "Story",
    title: "Battle",
    summary: "Combat, enemy targeting, turn order, tactics, and action decks.",
    steps: [
      "Open Battle when a scene needs structured conflict.",
      "Use targets, actions, and party formation to keep combat readable.",
      "Stats, equipment, skills, status effects, and party tactics can all matter.",
      "End or clear battle state when the fight is over so normal roleplay resumes cleanly."
    ]
  },
  {
    id: "guide-cutscenes",
    group: "Story",
    title: "Cutscenes",
    summary: "Cinematic narrative sequences driven by location, time, and active characters.",
    steps: [
      "Cutscenes trigger when key events or transitions occur in the story.",
      "Sit back and watch the visual-novel sprites, ambient lighting, and descriptions unfold dynamically.",
      "A progress bar at the bottom shows the timing of the active cinematic beat.",
      "Use the Skip button in the bottom right corner if you prefer to skip a cutscene and return to active gameplay."
    ]
  },
  {
    id: "guide-minigames",
    group: "Story",
    title: "Minigames & Hacks",
    summary: "AI-driven interactive DOM Switch overlays, security bypasses, and time-sensitive tasks.",
    steps: [
      "Minigames trigger when you attempt specialized actions like lockpicking, hacking, or executing a time-sensitive job.",
      "They feature fully dynamic CSS/HTML overlays that build themselves auto-procedurally or through AI narrative context.",
      "Watch out for time-limit gauges (like cutting a wire on a ticking countdown) and react quickly.",
      "Completing the minigame successfully updates the story and characters automatically.",
      "If a minigame is unplayable or you need to exit, click the ABORT button to exit cleanly."
    ]
  },
  {
    id: "guide-phone",
    group: "World",
    title: "Phone",
    summary: "Messages, calls, contacts, browser, storage, banking, transit, and in-world books.",
    steps: [
      "The phone is for in-world utilities. Manuals now live in Help / Manual instead of the phone.",
      "Messages and calls let you contact NPCs.",
      "Contacts stores numbers and people you can reach.",
      "Books is now for generated or found in-world documents only.",
      "Settings changes phone style, wallpaper, PIN, message colors, and incoming call/text toggles."
    ]
  },
  {
    id: "guide-databank",
    group: "World",
    title: "Databank",
    summary: "Structured world facts, discoveries, memories, and reference records.",
    steps: [
      "Use Databank for facts you want the system to remember as organized records.",
      "Keep entries concise and factual for better retrieval.",
      "Review scanned records when the AI seems to remember the wrong thing.",
      "Pair Databank with Lorebooks for big setting facts and with Journal for active goals."
    ]
  },
  {
    id: "guide-lorebook",
    group: "World",
    title: "Lorebooks",
    summary: "Reusable setting knowledge, world rules, factions, histories, and campaign reference material.",
    steps: [
      "Use Lorebooks for facts that should travel between sessions or new games.",
      "Select saved lorebooks during New Game only when they belong in that run.",
      "Keep entries focused: one place, rule, faction, species, or history per entry is easier to retrieve.",
      "Use Databank for discoveries made during play, and Lorebook for planned setting canon."
    ]
  },
  {
    id: "guide-room-editing",
    group: "World",
    title: "Room Editing and Hotspots",
    summary: "Build interactive rooms, place objects, define actions, and tune generated room art.",
    steps: [
      "Open Edit Room when you want to add or move a hotspot in the current place.",
      "Pick a slot, then use coordinates or sliders to position the object.",
      "Describe the room or object clearly before generating art or saving custom actions.",
      "Use custom CSS and system prompts only when you need advanced presentation or special behavior."
    ]
  },
  {
    id: "guide-atmosphere",
    group: "World",
    title: "Atmosphere",
    summary: "Weather, time filters, ambience, flashlight, mood, and scene presentation.",
    steps: [
      "Change time of day or weather to match the current scene.",
      "Use ambience and visual filters to make locations feel distinct.",
      "Night scenes can use lighting tools such as flashlight effects.",
      "Atmosphere is presentational; use Map or Calendar when the location or time should truly change."
    ]
  },
  {
    id: "guide-media",
    group: "System",
    title: "Images, Sprites, Music, and Themes",
    summary: "Generate, organize, and apply portraits, backgrounds, sprites, music rules, and interface themes.",
    steps: [
      "Use Image Gallery to find generated images by scene, character, or key.",
      "Use Sprites to manage expression packs and stage visuals.",
      "Use Music to define genre, location, and keyword rules for ambience.",
      "Use Themes when you want the interface mood to change without changing the story state."
    ]
  },
  {
    id: "guide-modal-tutorials",
    group: "First Steps",
    title: "Modal and Window Tutorials",
    summary: "The Helper Pet explains each opened screen and lights up the controls that matter most.",
    steps: [
      "Start Tutorial Mode from Help / Manual or the Helper Pet settings.",
      "Open any modal or window; the pet will explain what the screen is for.",
      "Highlighted buttons and fields are the controls to inspect first.",
      "Use Skip Tutorial when you want the guide to stop appearing automatically."
    ]
  },
  {
    id: "guide-settings",
    group: "System",
    title: "Settings",
    summary: "APIs, models, prompts, image/audio providers, UI preferences, backups, and visibility.",
    steps: [
      "Main API controls the storyteller model and connection route.",
      "Turbo and image/audio sections configure secondary generation features.",
      "Prompts and filters control style, safety filters, and profile behavior.",
      "UI settings hide menu entries, customize visuals, and preserve your preferred layout.",
      "Backups, import/export, and reset controls protect your setup and saves."
    ]
  },
  {
    id: "guide-debug",
    group: "System",
    title: "Debug and Diagnostics",
    summary: "Troubleshooting, reports, scans, save data, and repair tools.",
    steps: [
      "Run diagnostics when a window, save, or state scanner behaves strangely.",
      "Copy reports when you need to share an issue.",
      "Export data before risky experiments.",
      "Clear logs only when you no longer need troubleshooting history."
    ]
  },
  {
    id: "guide-sprites",
    group: "System",
    title: "Sprites and Visuals",
    summary: "Sprite libraries, stage images, expressions, imports, and visual setup.",
    steps: [
      "Import or create sprite libraries for characters and scenes.",
      "Use clear library names so different campaigns do not get mixed together.",
      "Expression states help the stage show the right mood.",
      "If a sprite does not appear, check its library, active character, and image path."
    ]
  }
];

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function sectionHtml(section) {
  return `
    <article class="uie-help-card" id="${escapeHtml(section.id)}" data-help-group="${escapeHtml(section.group)}">
      <div class="uie-help-card__head">
        <span>${escapeHtml(section.group)}</span>
        <h3>${escapeHtml(section.title)}</h3>
      </div>
      <p>${escapeHtml(section.summary)}</p>
      <ol>${section.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
    </article>
  `;
}

function ensureHelpManualModal() {
  let modal = document.getElementById("help-manual-modal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "help-manual-modal";
  modal.className = "modal-overlay uie-help-manual-modal";
  modal.style.display = "none";
  modal.innerHTML = `
    <div class="modal-card uie-help-manual-card" role="dialog" aria-modal="true" aria-labelledby="uie-help-title">
      <style>
        .uie-help-manual-modal { position:fixed; inset:0; z-index:2147483647; align-items:center; justify-content:center; background:rgba(0,0,0,.72); padding:16px; box-sizing:border-box; }
        .uie-help-manual-card { width:min(980px, calc(100vw - 24px)); max-height:min(86vh, 860px); display:flex; flex-direction:column; gap:12px; background:#10141f; color:#eef5ff; border:1px solid rgba(203,163,92,.5); border-radius:14px; box-shadow:0 24px 90px rgba(0,0,0,.75); overflow:hidden; }
        .uie-help-head { display:flex; align-items:center; gap:10px; padding:14px 16px; border-bottom:1px solid rgba(255,255,255,.1); background:rgba(203,163,92,.08); }
        .uie-help-head h2 { margin:0; font-size:20px; letter-spacing:0; }
        .uie-help-head p { margin:2px 0 0; color:#b8c5d8; font-size:12px; }
        .uie-help-close { margin-left:auto; min-width:36px; height:34px; border-radius:9px; border:1px solid rgba(255,255,255,.14); background:rgba(0,0,0,.25); color:#fff; cursor:pointer; }
        .uie-help-tools { display:flex; gap:8px; padding:0 16px; flex-wrap:wrap; }
        .uie-help-search { flex:1 1 240px; min-height:38px; border-radius:10px; border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.06); color:#fff; padding:0 12px; outline:none; }
        .uie-help-filter { min-height:38px; border-radius:10px; border:1px solid rgba(255,255,255,.14); background:#141a28; color:#fff; padding:0 10px; }
        .uie-help-start-tutorial { min-height:38px; border-radius:10px; border:1px solid rgba(203,163,92,.55); background:rgba(203,163,92,.18); color:#ffe3a3; font-weight:900; padding:0 12px; cursor:pointer; }
        .uie-help-body { min-height:0; overflow:auto; padding:4px 16px 16px; display:grid; grid-template-columns:repeat(auto-fit, minmax(270px, 1fr)); gap:12px; }
        .uie-help-card { border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.055); border-radius:10px; padding:12px; }
        .uie-help-card.is-hidden { display:none; }
        .uie-help-card.is-target { outline:2px solid #cba35c; box-shadow:0 0 0 5px rgba(203,163,92,.18); }
        .uie-help-card__head span { display:block; margin-bottom:4px; color:#cba35c; font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:.12em; }
        .uie-help-card h3 { margin:0; font-size:16px; }
        .uie-help-card p { margin:8px 0; color:#cad5e5; font-size:13px; line-height:1.45; }
        .uie-help-card ol { margin:0; padding-left:20px; color:#eef5ff; font-size:13px; line-height:1.55; }
        .uie-help-card li { margin:5px 0; }
      </style>
      <div class="uie-help-head">
        <i class="fa-solid fa-circle-question" aria-hidden="true"></i>
        <div>
          <h2 id="uie-help-title">Help / Manual</h2>
          <p>Organized player guides for every major window, modal, and phone app.</p>
        </div>
        <button type="button" class="uie-help-close" id="help-manual-close" title="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="uie-help-tools">
        <input id="uie-help-search" class="uie-help-search" placeholder="Search the manual..." autocomplete="off">
        <select id="uie-help-filter" class="uie-help-filter" title="Filter manual">
          <option value="">All sections</option>
          ${Array.from(new Set(HELP_SECTIONS.map((s) => s.group))).map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join("")}
        </select>
        <button type="button" id="uie-help-start-tutorial" class="uie-help-start-tutorial"><i class="fa-solid fa-wand-magic-sparkles"></i> Tutorial Mode</button>
      </div>
      <div id="uie-help-body" class="uie-help-body">
        ${HELP_SECTIONS.map(sectionHtml).join("")}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector("#help-manual-close")?.addEventListener("click", () => closeHelpManualWindow());
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeHelpManualWindow();
  });
  modal.querySelector("#uie-help-search")?.addEventListener("input", filterHelpManual);
  modal.querySelector("#uie-help-filter")?.addEventListener("change", filterHelpManual);
  modal.querySelector("#uie-help-start-tutorial")?.addEventListener("click", async () => {
    try {
      const mod = await import("./tutorial.js");
      mod.startTutorial?.({ force: true, source: "manual" });
    } catch (_) {}
  });
  return modal;
}

function filterHelpManual() {
  const query = String(document.getElementById("uie-help-search")?.value || "").toLowerCase().trim();
  const group = String(document.getElementById("uie-help-filter")?.value || "").trim();
  document.querySelectorAll("#uie-help-body .uie-help-card").forEach((card) => {
    const text = String(card.textContent || "").toLowerCase();
    const cardGroup = String(card.getAttribute("data-help-group") || "");
    const show = (!query || text.includes(query)) && (!group || cardGroup === group);
    card.classList.toggle("is-hidden", !show);
  });
}

export function openHelpManualWindow(sectionId = "") {
  const modal = ensureHelpManualModal();
  modal.style.display = "flex";
  filterHelpManual();
  if (sectionId) {
    setTimeout(() => {
      const target = document.getElementById(sectionId);
      if (!target) return;
      document.querySelectorAll("#uie-help-body .uie-help-card.is-target").forEach((el) => el.classList.remove("is-target"));
      target.classList.remove("is-hidden");
      target.classList.add("is-target");
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => target.classList.remove("is-target"), 2200);
    }, 80);
  }
}

export function closeHelpManualWindow() {
  const modal = document.getElementById("help-manual-modal");
  if (modal) modal.style.display = "none";
}

export function markTutorialSkipped(skipped = true) {
  const settings = getSettings();
  settings.ui = settings.ui || {};
  settings.ui.helperTutorialSkipped = skipped === true;
  settings.ui.helperTutorialCompleted = skipped !== true ? settings.ui.helperTutorialCompleted : settings.ui.helperTutorialCompleted === true;
  saveSettings();
}

export function installHelpManualGlobals() {
  window.UIE_openHelpManual = openHelpManualWindow;
  window.UIE_openGuide = openHelpManualWindow;
  window.openHelpManualWindow = openHelpManualWindow;
  window.uie = window.uie || {};
  window.uie.phone = window.uie.phone || {};
  window.uie.phone.openBooksGuide = openHelpManualWindow;
}

try { installHelpManualGlobals(); } catch (_) {}

export default {
  HELP_SECTIONS,
  openHelpManualWindow,
  closeHelpManualWindow,
  installHelpManualGlobals,
  markTutorialSkipped
};
