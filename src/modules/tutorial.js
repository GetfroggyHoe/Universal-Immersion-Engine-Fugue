import { getSettings, saveSettings } from "./core.js";
import { HELP_SECTIONS, openHelpManualWindow } from "./helpManual.js";

const HELPER_CAPABILITY_LINE = "I can help you explain screens, restart tutorials, open the Help / Manual, answer system questions, search files you mention, and create items, kits, skills, quests, or status effects.";

const TUTORIAL_TARGETS = [
  {
    selector: "#startup-modal",
    title: "Startup Menu",
    guideId: "guide-start",
    steps: [
      { text: "Welcome! I'm your Helper Pet, here to show you around so you don't get lost. 🐾", highlight: "" },
      { text: HELPER_CAPABILITY_LINE, highlight: "#start-new-universal, #start-continue-game, #start-open-settings" },
      { text: "If you want to start a brand new custom story, click the NEW GAME button!", highlight: "#start-new-universal" },
      { text: "Have a saved game already? Click CONTINUE to jump right back in.", highlight: "#start-continue-game" },
      { text: "To load a specific slot from your save history, click LOAD GAME.", highlight: "#start-load-game" },
      { text: "To configure your settings or connect your AI key first, click SETTINGS.", highlight: "#start-open-settings" }
    ]
  },
  {
    selector: "#load-state-modal",
    title: "Load Game",
    guideId: "guide-start",
    steps: [
      { text: "This loader is for choosing an existing run or save slot. Check the save name and timestamp before committing.", highlight: "" },
      { text: "Pick the slot or file you want to restore. Loading replaces the active runtime state with that save.", highlight: "select, input, .save-slot, .load-slot" },
      { text: "Use the load/confirm button only after the highlighted save is the one you mean to resume.", highlight: "button[id*='load'], button[id*='confirm'], .load-confirm" }
    ]
  },
  {
    selector: "#persona-modal",
    title: "Persona Editor",
    guideId: "guide-persona",
    steps: [
      { text: "Persona controls who the player is in prompt context. Names, descriptions, portraits, and notes can change how scenes address you.", highlight: "" },
      { text: "Choose a persona from the list with circular portrait thumbnails, or use the copy icon to duplicate a persona and its portrait references.", highlight: "#persona-list" },
      { text: "Start with the identity fields: name, role, description, and any portrait/reference details that should stay visible to the story engine.", highlight: "input, textarea" },
      { text: "Save when the identity should become active for future narration and character targeting.", highlight: "button[id*='save'], button[id*='apply']" }
    ]
  },
  {
    selector: "#main-api-setup-modal",
    title: "API Connection",
    guideId: "guide-settings",
    steps: [
      { text: "Let's connect your AI! UIE uses an AI brain to generate dialogues and build worlds in real-time.", highlight: "" },
      { text: "Choose your preferred AI API provider (like OpenAI or OpenRouter) from the list.", highlight: "#main-api-provider" },
      { text: "Paste your API key here. It is saved safely and locally on your device.", highlight: "#main-api-key" },
      { text: "When done, click Save and Connect to activate the engine!", highlight: "#main-api-save" }
    ]
  },
  {
    selector: "#uie-newgame-tutorial-choice",
    title: "Tutorial Choice",
    guideId: "guide-modal-tutorials",
    steps: [
      { text: "This prompt appears when New Game opens. Start Tutorial lets me walk through the setup screens; Skip keeps the flow manual.", highlight: "" },
      { text: HELPER_CAPABILITY_LINE, highlight: "#uie-newgame-tutorial-start" },
      { text: "Choose Start Tutorial if you want highlighted controls and short explanations while building the run.", highlight: "#uie-newgame-tutorial-start" },
      { text: "Choose Skip Tutorial if you already know the windows. You can restart it later from Helper Pet settings or Help / Manual.", highlight: "#uie-newgame-tutorial-skip" }
    ]
  },
  {
    selector: "#uie-newgame-overlay",
    title: "New Game Setup",
    guideId: "guide-start",
    steps: [
      { text: "Welcome to character creation! The tabs at the top divide your setup into simple sections.", highlight: ".uie-newgame-tab" },
      { text: HELPER_CAPABILITY_LINE, highlight: ".uie-newgame-tab" },
      { text: "First, type your character's name in this input box.", highlight: "#ng-char-name" },
      { text: "Choose a Job Class, then review the level, primary bars, and base stats that define the starting character.", highlight: "#ng-char-class" },
      { text: "Appearance controls portrait and visual identity. Currency & Groups configures money, memberships, and starting organizations.", highlight: ".uie-newgame-tab[data-tab='appearance'], .uie-newgame-tab[data-tab='currency']" },
      { text: "Life Trackers, Items & Equipment, and Skills build the starting mechanical loadout.", highlight: ".uie-newgame-tab[data-tab='trackers'], .uie-newgame-tab[data-tab='inventory'], .uie-newgame-tab[data-tab='skills']" },
      { text: "Quests, Lorebook, Assets, and NPCs seed objectives, canon, property, cast, relationships, schedules, and party choices.", highlight: ".uie-newgame-tab[data-tab='quests'], .uie-newgame-tab[data-tab='lorebook'], .uie-newgame-tab[data-tab='assets'], .uie-newgame-tab[data-tab='npcs']" },
      { text: "Starting Location defines the world, region, room, exits, and opening scene. Check it before launch.", highlight: ".uie-newgame-tab[data-tab='location']" },
      { text: "When ready, Start Game validates the setup, installs the campaign state, and sends the opening story beat through Main API.", highlight: "#uie-newgame-start-btn" }
    ]
  },
  {
    selector: "#uie-ng-card-picker-overlay",
    title: "Character Card Picker",
    guideId: "guide-persona",
    steps: [
      { text: "This picker imports reusable character cards into the new run. Use it when you want established cast data instead of typing a fresh NPC.", highlight: "" },
      { text: "Select the card that matches the person you want to add. The imported name, role, portrait, and notes become setup context.", highlight: ".uie-card, .card, button" },
      { text: "Confirm the selection to attach it to New Game, or close the picker if you only meant to inspect cards.", highlight: "button[id*='confirm'], button[id*='select'], button[id*='close']" }
    ]
  },
  {
    selector: "#uie-presets-gallery-overlay",
    title: "Preset Gallery",
    guideId: "guide-sprites",
    steps: [
      { text: "The gallery chooses a starter visual preset or background package. It can also update compatible New Game fields such as mode or terrain.", highlight: "" },
      { text: "Filter or scan the preview cards until the setting matches the world you want to start in.", highlight: "input, select, .uie-preset-card" },
      { text: "Select a card to apply its image and setup hints to the current flow.", highlight: ".uie-preset-card, button[id*='select']" }
    ]
  },
  {
    selector: "#uie-main-menu",
    title: "Command Deck",
    guideId: "guide-command-deck",
    steps: [
      { text: "This is your Command Deck—the central control room of the engine!", highlight: "" },
      { text: "Use these category buttons to toggle different modules.", highlight: ".uie-menu-btn" },
      { text: "Click on Inventory to check your equipment, skills, and crafting tabs.", highlight: "#uie-btn-inventory" },
      { text: "Click on Map to inspect nodes, travel, or edit locations.", highlight: "#uie-btn-open-map" },
      { text: "Need help or want to customize my look? Click the Helper button here!", highlight: "#uie-btn-helper-pet" }
    ]
  },
  {
    selector: "#uie-launcher, #uie-action-wheel-fab, #uie-quick-bag-overlay",
    title: "UI Buttons",
    guideId: "guide-command-deck",
    steps: [
      { text: "The floating launcher opens the main UI controls. You can drag it if it is covering the scene.", highlight: "#uie-launcher" },
      { text: "The Action Wheel button opens and closes custom action shortcuts. Use the plus button inside the wheel to add your own actions.", highlight: "#uie-action-wheel-fab" },
      { text: "HUD chips are clickable too: the clock opens game-time controls, weather opens atmosphere controls, status opens effects, and the microchip opens the AI token watcher after requests have usage data.", highlight: "#hud-time-trigger, #hud-weather-trigger, #hud-status-trigger, #hud-api-line" },
      { text: "Quick Bag is for fast item and skill access. Send items or skills there from their cards, or drag them in when using a pointer.", highlight: "#uie-quick-bag-overlay, #uie-btn-quick-bag" },
      { text: "Journal keeps quests and the Codex. Codex tracks monsters, legends, people, places, and stable lore.", highlight: "#uie-btn-journal, #uie-journal-window" },
      { text: "Phone, Map, Inventory, Social, and Stats buttons open the core management panels for repeated play.", highlight: "#uie-main-menu .uie-menu-btn, .uie-menu-btn" }
    ]
  },
  {
    selector: "#help-manual-modal",
    title: "Help / Manual",
    guideId: "guide-start",
    steps: [
      { text: "This is the built-in reference manual. It is organized by First Steps, Character, Story, World, and System groups.", highlight: "" },
      { text: "Search for a feature name when you need direct instructions instead of browsing every card.", highlight: "#uie-help-search" },
      { text: "Use the group filter to narrow the manual, or press Tutorial Mode to make me explain the currently open window.", highlight: "#uie-help-filter" },
      { text: "Tutorial Mode starts the same highlight-and-speech walkthrough used by the Helper Pet.", highlight: "#uie-help-start-tutorial" }
    ]
  },
  {
    selector: "#uie-inventory-window",
    title: "Inventory Bag",
    guideId: "guide-inventory",
    steps: [
      { text: "Here is your inventory! You can manage items, equipment, skills, and crafting here.", highlight: "" },
      { text: "Your main item bag is displayed here. Click an item to use, equip, or trash it.", highlight: "#uie-inventory-items-list" },
      { text: "Click the Skills tab at the top to view your active abilities and passive perks.", highlight: ".inventory-tab[data-tab='skills']" },
      { text: "Click the Forge or Alchemy tabs to combine materials and craft new gear!", highlight: ".inventory-tab[data-tab='forge']" }
    ]
  },
  {
    selector: "#uie-class-reset-modal",
    title: "Class Reset",
    guideId: "guide-stats",
    steps: [
      { text: "Class Reset is for changing or rebuilding the player's job/class progression. Use it when your build needs a hard correction.", highlight: "" },
      { text: "Review the new class, stat, and reset options carefully. These can change vitals, skills, and progression assumptions.", highlight: "select, input, .class-option" },
      { text: "Confirm only when you are ready for the rebuilt class data to replace the current setup.", highlight: "button[id*='confirm'], button[id*='reset'], button[id*='save']" }
    ]
  },
  {
    selector: "#uie-create-station-overlay",
    title: "Create Station",
    guideId: "guide-inventory",
    steps: [
      { text: "Create Station generates or records new inventory objects, skills, assets, and crafting outputs.", highlight: "" },
      { text: "Describe the thing you want in concrete terms: what it is, what it does, rarity, tags, and any limits.", highlight: "textarea, input" },
      { text: "Generate or save when the draft is ready. Created objects are routed into the matching inventory domain.", highlight: "button[id*='generate'], button[id*='save'], button[id*='create']" }
    ]
  },
  {
    selector: "#uie-rebirth-modal",
    title: "Rebirth",
    guideId: "guide-stats",
    steps: [
      { text: "Rebirth handles major progression reshaping. It can preserve some legacy power while changing the character path.", highlight: "" },
      { text: "Compare the listed rebirth options and rewards before choosing; this is meant to be a long-term build decision.", highlight: ".rebirth-option, button, select" },
      { text: "Confirm only when the selected path is the one you want applied to the current run.", highlight: "button[id*='confirm'], button[id*='rebirth'], button[id*='apply']" }
    ]
  },
  {
    selector: "#uie-stats-window",
    title: "Character Stats",
    guideId: "guide-stats",
    steps: [
      { text: "This is your Stats sheet! It tracks your vitals, attributes, and progression.", highlight: "" },
      { text: "Your current HP, Mana, and XP bars are shown at the top.", highlight: ".stats-vitals-container" },
      { text: "Check your attributes (like Strength or Intelligence) in this grid.", highlight: ".stats-grid" },
      { text: "If you want to reset your class or choose a new path, click Class Reset.", highlight: "#uie-class-reset-modal" }
    ]
  },
  {
    selector: "#uie-rebirth-medallion-modal",
    title: "Rebirth Medallion",
    guideId: "guide-stats",
    steps: [
      { text: "This modal spends or resolves a rebirth-style reward. Read each option as a build reward, not a cosmetic choice.", highlight: "" },
      { text: "Compare the reward text, stat impact, and long-term fit for your character before selecting one.", highlight: "button, .medallion-option, .rebirth-option" },
      { text: "Confirm the selected reward when you are ready to apply it to the character.", highlight: "button[id*='confirm'], button[id*='choose'], button[id*='apply']" }
    ]
  },
  {
    selector: "#uie-party-window",
    title: "Party Management",
    guideId: "guide-party",
    steps: [
      { text: "This is the Party panel. Use it to coordinate with traveling companions!", highlight: "" },
      { text: "The Roster shows all party members. Click a companion card to view their stats.", highlight: ".uie-party-tab[data-tab='roster']" },
      { text: "Use the Tactics tab to set character combat behaviors (like aggressive or passive).", highlight: ".uie-party-tab[data-tab='tactics']" },
      { text: "Use the Formation tab to drag characters into front, middle, or back lanes.", highlight: ".uie-party-tab[data-tab='formation']" }
    ]
  },
  {
    selector: "#uie-party-member-modal",
    title: "Party Member Sheet",
    guideId: "guide-party",
    steps: [
      { text: "This sheet edits one companion. It covers stats, custom trackers, equipment, skills, and skill-tree progression.", highlight: "" },
      { text: "Stats shows vitals, biography, custom life trackers, and core attributes for the selected member.", highlight: ".party-mm-tab[data-tab='sheet']" },
      { text: "Gear manages member equipment and paper-doll/portrait references. Use Save Outfit to store the current look including the character image — loading that outfit later restores the image and changes the main paperdoll.", highlight: ".party-mm-tab[data-tab='equip']" },
      { text: "Skills and Tree control active/passive abilities and unlockable progression nodes.", highlight: ".party-mm-tab[data-tab='skills']" },
      { text: "At level 150+, characters can Rebirth to reset level but gain permanent bonuses and unlock special medallions. This is a powerful progression mechanic!", highlight: ".rebirth-section" }
    ]
  },
  {
    selector: "#uie-party-tracker-modal",
    title: "Party Member Tracker",
    guideId: "guide-party",
    steps: [
      { text: "Trackers are custom meters for a companion: stamina, stress, hunger, loyalty, injuries, or any campaign-specific resource.", highlight: "" },
      { text: "Name the tracker, choose a color, and set current/max values so it can render as a clear bar.", highlight: "#party-track-modal-name" },
      { text: "Use notes for rules or narrative context, then save to attach it to the member sheet.", highlight: "#party-track-modal-save" }
    ]
  },
  {
    selector: "#uie-party-node-modal",
    title: "Skill Tree Node",
    guideId: "guide-party",
    steps: [
      { text: "This editor changes one party member skill-tree node. It affects unlock cost, type, description, and stat boosts.", highlight: "" },
      { text: "Use the name, type, cost, stats, and description fields to define what the node unlocks.", highlight: "input, select, textarea" },
      { text: "Save when the node should become part of that companion's progression tree.", highlight: "button[id*='save']" }
    ]
  },
  {
    selector: "#uie-social-window",
    title: "Social Roster",
    guideId: "guide-social",
    steps: [
      { text: "This is the Social Tracker. It maps relationships, impressions, and memories.", highlight: "" },
      { text: "Click an NPC card to check their Affinity (closeness) and Disposition (opinions).", highlight: ".social-card" },
      { text: "Click Add Contact at the bottom to manually record a new character you met.", highlight: "#uie-add-modal" }
    ]
  },
  {
    selector: "#uie-add-modal",
    title: "Add Social Contact",
    guideId: "guide-social",
    steps: [
      { text: "Add Contact manually records someone when scanning did not catch them or when you want a cleaner relationship entry.", highlight: "" },
      { text: "Fill the identity fields first: name, category, relationship labels, location, and any tags that help retrieval.", highlight: "input, select" },
      { text: "Use notes for impressions, promises, conflicts, or memory anchors, then save the contact.", highlight: "textarea, button[id*='save'], button[id*='add']" }
    ]
  },
  {
    selector: "#uie-social-overlay, #uie-social-details-overlay",
    title: "Social Details",
    guideId: "guide-social",
    steps: [
      { text: "This detail view is for one known person. It keeps relationship numbers, notes, disposition, and current context together.", highlight: "" },
      { text: "Review affinity, mood, tags, and notes before changing relationship state.", highlight: "input, select, textarea" },
      { text: "Save edits when the contact record should update, or close if you only needed to inspect them.", highlight: "button[id*='save'], button[id*='close']" }
    ]
  },
  {
    selector: "#uie-social-mem-overlay, #uie-db-social-mem-overlay",
    title: "Social Memory",
    guideId: "guide-social",
    steps: [
      { text: "Social Memory stores remembered events about a character: gifts, fights, promises, favors, and important scenes.", highlight: "" },
      { text: "Add or edit concise memories. Strong memories are easier for the engine to retrieve later.", highlight: "textarea, input" },
      { text: "Save changes when the memory should affect future social context.", highlight: "button[id*='save'], button[id*='add']" }
    ]
  },
  {
    selector: "#uie-family-tree-overlay",
    title: "Family Tree",
    guideId: "guide-social",
    steps: [
      { text: "Family Tree links characters by lineage or household relationship. Use it for siblings, parents, spouses, clans, and dynasties.", highlight: "" },
      { text: "Inspect or adjust links so names and relationship types match your story canon.", highlight: "select, input, button" },
      { text: "Close after review, or save if you changed the relationship graph.", highlight: "button[id*='save'], button[id*='close']" }
    ]
  },
  {
    selector: "#uie-journal-window",
    title: "Quest Journal",
    guideId: "guide-journal",
    steps: [
      { text: "Here is your Journal. It tracks all active quests, rumors, and goals.", highlight: "" },
      { text: "Select a quest from the list to see its description and steps.", highlight: ".journal-quest-list" },
      { text: "Toggle between filters to see Main, Side, or Completed quests.", highlight: ".journal-filter-tab" }
    ]
  },
  {
    selector: "#uie-diary-window",
    title: "Personal Diary",
    guideId: "guide-diary",
    steps: [
      { text: "This is your Diary! Use it to write notes, document memories, or attach photos.", highlight: "" },
      { text: "Type your thoughts or character reflections in the main text box.", highlight: "#diary-entry-text" },
      { text: "Click Add Photo or Add Sticker to customize your page!", highlight: "#diary-add-media" },
      { text: "Click Save Page to write it permanently into your journal history.", highlight: "#diary-save-btn" }
    ]
  },
  {
    selector: "#uie-map-window",
    title: "World Map",
    guideId: "guide-map",
    steps: [
      { text: "This is the World Map! You can travel between cities or build new areas.", highlight: "" },
      { text: "Click on any node to see details about the location.", highlight: ".map-node" },
      { text: "Click Travel to move there. Locked locations will require key or lockpicking!", highlight: "#map-travel-btn" },
      { text: "Click Build Location to design a new room or building on this node.", highlight: "#map-build-btn" }
    ]
  },
  {
    selector: "#uie-map-scan-modal",
    title: "Map Scan",
    guideId: "guide-map",
    steps: [
      { text: "Map Scan searches recent chat for concrete places the story mentioned but the map has not recorded yet.", highlight: "" },
      { text: "Review the candidate list and choose only real locations, not vague mood text or temporary descriptions.", highlight: ".uie-map-scan-row, input, select" },
      { text: "Add Selected Place to create the node in the current map layer.", highlight: "#uie-map-scan-add" }
    ]
  },
  {
    selector: "#worldgen-modal",
    title: "World Generator",
    guideId: "guide-map",
    steps: [
      { text: "World Generator builds map structure from a setting brief while the engine owns the topology and route data.", highlight: "" },
      { text: "Describe genre, era, geography, traversal, location types, transit rules, and exclusions in the prompt.", highlight: "#wg-prompt" },
      { text: "Choose generation scope and blueprint behavior before generating, because those decide how much map hierarchy is created.", highlight: "#wg-mode, #wg-blueprint-mode" },
      { text: "Generate when the brief is ready. The result can create world, region, local, nearby, and blueprint layers.", highlight: "button[id*='generate'], button[id*='worldgen']" }
    ]
  },
  {
    selector: "#uie-map-location-modal",
    title: "Add Map Location",
    guideId: "guide-map",
    steps: [
      { text: "This modal creates a new place in the map. Use it for locations the story needs to revisit.", highlight: "" },
      { text: "Enter a clear place name and description. Mention what the player can do there and how it connects to the current area.", highlight: "input, #uie-map-add-desc" },
      { text: "Add To Map saves the node into the current map layer for travel and future discovery.", highlight: "#uie-map-add-save" }
    ]
  },
  {
    selector: "#uie-map-import-modal",
    title: "Import Map",
    guideId: "guide-map",
    steps: [
      { text: "Import Map replaces or merges map data from exported JSON. Use it for backups or shared worlds.", highlight: "" },
      { text: "Paste valid map JSON into the text area. Invalid structure will not import cleanly.", highlight: "#uie-map-import-json" },
      { text: "Apply the import only when you are sure this data belongs in the current run.", highlight: "#uie-map-import-apply" }
    ]
  },
  {
    selector: "#map-move-modal",
    title: "Map Move",
    guideId: "guide-map",
    steps: [
      { text: "Map Move confirms travel before the engine changes location, route context, and sometimes in-world time.", highlight: "" },
      { text: "Check the destination and any travel details. Locked or transit-linked routes may have extra requirements.", highlight: ".map-move-destination, .map-move-details" },
      { text: "Confirm to move, or cancel if the destination is wrong.", highlight: "button[id*='confirm'], button[id*='move'], button[id*='cancel']" }
    ]
  },
  {
    selector: "#edit-room-modal",
    title: "Edit Room",
    guideId: "guide-room-editing",
    steps: [
      { text: "Edit Room builds interactive room data: hotspots, object prompts, coordinates, custom actions, styling, and local AI instructions.", highlight: "" },
      { text: "Set object names, positions, prompts, and any action text that should appear when the player clicks the hotspot.", highlight: "input, textarea, select" },
      { text: "Save after the room behavior and visuals match what should exist in the current location.", highlight: "button[id*='save'], button[id*='apply']" }
    ]
  },
  {
    selector: "#room-action-modal",
    title: "Room Action",
    guideId: "guide-room-editing",
    steps: [
      { text: "Room Action appears when a hotspot or room object has defined interactions.", highlight: "" },
      { text: "Pick the action that matches what your character is doing. Actions can advance time, change resources, or inject story context.", highlight: "button, select" },
      { text: "Cancel if you only meant to inspect the object.", highlight: "button[id*='cancel'], button[id*='close']" }
    ]
  },
  {
    selector: "#physical-world-modal",
    title: "Physical World",
    guideId: "guide-map",
    steps: [
      { text: "Physical World shows grounded scene details: nearby objects, room state, environmental clues, and what can be acted on.", highlight: "" },
      { text: "Use it to inspect concrete scene facts before choosing an action or editing room data.", highlight: ".physical-world-list, .physical-world-item, button" },
      { text: "Close when you have the context you need, or open an available action from the listed objects.", highlight: "button[id*='close'], button[id*='action']" }
    ]
  },
  {
    selector: "#uie-calendar-window",
    title: "Calendar",
    guideId: "guide-calendar",
    steps: [
      { text: "This is the Calendar. It tracks time, seasons, and scheduled routines.", highlight: "" },
      { text: "The monthly grid shows upcoming events, festivals, and birthdays.", highlight: ".calendar-grid" },
      { text: "Use the Schedules tab to set daily routines for your party.", highlight: ".calendar-tab[data-tab='schedules']" }
    ]
  },
  {
    selector: "#cal-modal",
    title: "Calendar Day",
    guideId: "guide-calendar",
    steps: [
      { text: "This day modal shows weather, events, reminders, birthdays, and schedule notes for the selected date.", highlight: "" },
      { text: "Weather override changes the day's label for atmosphere and scheduling context.", highlight: "#cal-modal-weather-override" },
      { text: "Review the event list before adding or editing anything tied to that date.", highlight: "#cal-modal-events-list" }
    ]
  },
  {
    selector: "#cal-ai-prompt-modal",
    title: "Calendar AI Event",
    guideId: "guide-calendar",
    steps: [
      { text: "This prompt asks the AI to create or organize calendar events from your instructions.", highlight: "" },
      { text: "Write the event brief with date, time, participants, recurrence, and consequences if they matter.", highlight: "textarea, input" },
      { text: "Generate or save once the prompt describes the schedule item clearly.", highlight: "button[id*='generate'], button[id*='save']" }
    ]
  },
  {
    selector: "#time-weather-modal",
    title: "Time and Weather",
    guideId: "guide-calendar",
    steps: [
      { text: "Time and Weather controls the current clock, day, weather label, weather visual, and climate notes for the world.", highlight: "" },
      { text: "Adjust time deliberately; travel, activities, NPC schedules, and scene mood may depend on it.", highlight: "input, select" },
      { text: "Save or apply when the changed clock/weather should become the active world state.", highlight: "button[id*='save'], button[id*='apply']" }
    ]
  },
  {
    selector: "#uie-calendar-reminder-overlay",
    title: "Calendar Reminder",
    guideId: "guide-calendar",
    steps: [
      { text: "A scheduled reminder has triggered. Read it before dismissing so you do not miss a time-sensitive event.", highlight: "" },
      { text: "Open Calendar if you need more context around the date, schedule, or related events.", highlight: "button[id*='calendar'], button[id*='open']" },
      { text: "Acknowledge or close once you have handled the reminder.", highlight: "button[id*='close'], button[id*='ok'], button[id*='dismiss']" }
    ]
  },
  {
    selector: "#uie-activities-window",
    title: "Downtime Activities",
    guideId: "guide-activities",
    steps: [
      { text: "Use Activities to spend downtime, advance time, and gain stats from one combined activity list.", highlight: "" },
      { text: "Click an activity card to start it for yourself.", highlight: "#uie-activities-list .uie-activity-card" },
      { text: "Select a party member, then use the assign icon on the same activity cards to assign that member.", highlight: "#uie-activity-party-members, .uie-activity-assign" }
    ]
  },
  {
    selector: "#battle-screen, #uie-battle-window",
    title: "Combat Screen",
    guideId: "guide-battle",
    steps: [
      { text: "You are in combat over the same location background as the main scene.", highlight: "" },
      { text: "Select an action for the active character here.", highlight: "#battle-bottom-dock .btn-action" },
      { text: "Choose which enemy sprite to target on the battlefield.", highlight: "#battle-enemy-stage .battle-sprite-container" },
      { text: "Use Flee to leave combat and return to the visual novel stage.", highlight: "#battle-close-btn" }
    ]
  },
  {
    selector: "#uie-phone-window",
    title: "Mobile Phone",
    guideId: "guide-phone",
    steps: [
      { text: "This is your in-game Phone! It contains communications and utilities.", highlight: "" },
      { text: "Open Messages to view text history or chat with NPCs.", highlight: ".phone-app[data-app='messages']" },
      { text: "Check Banking to manage cash, transfer funds, or take loans.", highlight: ".phone-app[data-app='banking']" }
    ]
  },
  {
    selector: "#computer-modal",
    title: "Computer",
    guideId: "guide-phone",
    steps: [
      { text: "Computer is an in-world interface for scene-specific digital actions such as logging in, searching, messaging, or using local tools.", highlight: "" },
      { text: "Use the available buttons as actions your character is taking in the current scene.", highlight: "button, input" },
      { text: "Close the computer when you are done so normal scene controls are visible again.", highlight: "button[id*='close']" }
    ]
  },
  {
    selector: "#transit-hub-overlay",
    title: "Transit Hub",
    guideId: "guide-map",
    steps: [
      { text: "Transit Hub is for large movement systems: train stations, docks, airports, bus terminals, hangars, and similar routes.", highlight: "" },
      { text: "Choose a destination or route that fits the current hub and your available fare/access.", highlight: "button, select" },
      { text: "Confirm travel to update location and travel history.", highlight: "button[id*='confirm'], button[id*='travel']" }
    ]
  },
  {
    selector: "#transit-lock-overlay",
    title: "Transit Lock",
    guideId: "guide-map",
    steps: [
      { text: "Transit Lock appears when a route requires access, fare, permission, a key item, or another condition.", highlight: "" },
      { text: "Read the requirement before trying to force movement; it explains what blocks the route.", highlight: ".transit-lock-requirement, .transit-lock-body" },
      { text: "Use the available unlock, pay, or cancel action depending on what the route needs.", highlight: "button" }
    ]
  },
  {
    selector: "#uie-databank-window",
    title: "World Databank",
    guideId: "guide-databank",
    steps: [
      { text: "This is the Databank. It stores official world lore, monsters, and items.", highlight: "" },
      { text: "Browse through categories (Characters, Factions, Items, History) on the sidebar.", highlight: ".databank-sidebar" },
      { text: "Use the search bar at the top to find specific terms.", highlight: "#databank-search" }
    ]
  },
  {
    selector: "#uie-roster-modal",
    title: "Roster",
    guideId: "guide-social",
    steps: [
      { text: "Roster reviews known characters, custom lineage, active sprites, profile links, and reusable cast records.", highlight: "" },
      { text: "Click a card to inspect or attach a person to the current workflow.", highlight: ".roster-card, .character-card, button" },
      { text: "Close after choosing, or save/import if the roster action offers one.", highlight: "button[id*='close'], button[id*='import'], button[id*='save']" }
    ]
  },
  {
    selector: "#group-scene-modal",
    title: "Group Scene",
    guideId: "guide-social",
    steps: [
      { text: "Group Scene controls multi-character replies. Use it when several present characters should speak or take turns.", highlight: "" },
      { text: "Set the roster, turn order, muted characters, and automatic reply limit so the scene stays readable.", highlight: "select, input, textarea" },
      { text: "Start or apply when the group rules match the scene you want.", highlight: "button[id*='start'], button[id*='apply'], button[id*='save']" }
    ]
  },
  {
    selector: "#scene-cards-modal",
    title: "Scene Cards",
    guideId: "guide-social",
    steps: [
      { text: "Scene Cards manages who is currently present. Keep this list focused so prompts do not pull in the wrong people.", highlight: "" },
      { text: "Add, remove, or inspect characters based on who is actually in the scene right now.", highlight: ".scene-card, button" },
      { text: "Save or close after the active scene roster is accurate.", highlight: "button[id*='save'], button[id*='close']" }
    ]
  },
  {
    selector: "#scene-card-action-modal",
    title: "Scene Character Action",
    guideId: "guide-social",
    steps: [
      { text: "This action modal targets one scene character. Use it to ask that character to act, speak, inspect, or leave.", highlight: "" },
      { text: "Pick the action that matches your intent. Cancel if you only meant to inspect the character.", highlight: "button, select" },
      { text: "Confirm to inject the chosen character action into the current scene flow.", highlight: "button[id*='confirm'], button[id*='apply']" }
    ]
  },
  {
    selector: "#uie-disamb-modal",
    title: "Choose Character",
    guideId: "guide-social",
    steps: [
      { text: "This appears when multiple characters match the same name or target phrase.", highlight: "" },
      { text: "Choose the exact person so memories, gifts, targeting, and scene actions update the right record.", highlight: ".disamb-char" },
      { text: "Cancel if none of the listed people are the target you meant.", highlight: "#disamb-cancel" }
    ]
  },
  {
    selector: "#uie-you-window",
    title: "You — Player Dossier",
    guideId: "guide-you-world",
    steps: [
      { text: "You is a read-focused snapshot of the active player record.", highlight: "" },
      { text: "Review identity, status effects, stats, and lineage. Edit source data in Persona, Stats, Inventory, or Social.", highlight: "#uie-you-core-grid" },
      { text: "Refresh after changing another system so the dossier redraws from shared campaign state.", highlight: "#uie-you-refresh" }
    ]
  },
  {
    selector: "#uie-world-window",
    title: "World Simulation",
    guideId: "guide-you-world",
    steps: [
      { text: "World Simulation summarizes active campaign and living-world state.", highlight: "#uie-world-content" },
      { text: "Scan / Update State refreshes the view from current state and the available backend.", highlight: "#uie-world-update" },
      { text: "Project changes the target location or dimension and can synthesize a matching backdrop.", highlight: "#uie-world-input" },
      { text: "Use Project only when you intend to change the active location.", highlight: "#uie-world-gen" }
    ]
  },
  {
    selector: "#uie-chatbox-window",
    title: "Chatbox",
    guideId: "guide-chatbox",
    steps: [
      { text: "Chatbox is a compact alternate view of the current story conversation.", highlight: "" },
      { text: "Its transcript and composer share the active story session with the main view.", highlight: "#uie-chatbox-list, #uie-chatbox-composer" },
      { text: "Inventory and Map are shortcuts into shared campaign systems.", highlight: "#uie-chatbox-open-inv, #uie-chatbox-open-map" },
      { text: "Options configures character chat boxes and launcher/gear presentation.", highlight: "#uie-chatbox-gear" }
    ]
  },
  {
    selector: "#uie-shop-window",
    title: "Shop",
    guideId: "guide-shop-trade",
    steps: [
      { text: "Shop opens automatically when you enter a recognized commercial location. Each location owns its shopkeeper, greeting, and persistent catalog.", highlight: "#uie-shopkeeper-panel" },
      { text: "The shopkeeper is a full NPC registered with Character Cards, NPC Management, and Social. Their profile is uncovered through Social, not from a Shop profile button.", highlight: "#uie-shopkeeper-name" },
      { text: "Switch between Buy and Sell. Search narrows the visible catalog or sellable inventory without changing stock.", highlight: "#uie-shop-mode-buy, #uie-shop-mode-sell" },
      { text: "Buy shows rarity, category, price, and stock. A purchase updates currency, inventory, and this shop's remaining stock.", highlight: "#uie-shop-items" },
      { text: "Ask for a kind of item, then Restock. Model-generated context stock falls back to a smart local specialty catalog when needed.", highlight: "#uie-shop-keywords" }
    ]
  },
  {
    selector: "#uie-player-home-window",
    title: "Player Home",
    guideId: "guide-player-home",
    steps: [
      { text: "The Home hub opens when you enter your registered primary home or another residence the campaign explicitly marks as yours. Other people's homes do not trigger it.", highlight: "#uie-home-name" },
      { text: "Home actions open the real Kitchen, Inventory storage, Wardrobe, Activities, Assets, Social, Map, and phone Homestead systems.", highlight: ".uie-home-actions" },
      { text: "Visitors can ring the doorbell through deterministic game logic—no AI is required. Answer, let them in, turn them away, or ignore the ring.", highlight: "#uie-home-doorbell" },
      { text: "Let In moves that NPC into the current home scene. Home arrivals and door choices are saved in Recent Home Events.", highlight: "#uie-home-events" }
    ]
  },
  {
    selector: "#uie-trade-window",
    title: "Trade",
    guideId: "guide-shop-trade",
    steps: [
      { text: "Trade exchanges items and currency with a selected campaign character.", highlight: "#uie-trade-npc" },
      { text: "Build your offer with gold, item, and quantity, then review its value.", highlight: "#uie-trade-gold" },
      { text: "Check their requested item, flags, and status before accepting.", highlight: "#uie-trade-their-item" },
      { text: "Accept commits both sides; Clear resets the draft.", highlight: "#uie-trade-accept" }
    ]
  },
  {
    selector: "#uie-schedules-window",
    title: "Character Schedules",
    guideId: "guide-schedules",
    steps: [
      { text: "Schedules shows recurring NPC routines against the current game clock.", highlight: "#uie-schedules-clock" },
      { text: "Each card summarizes a character's current activity and schedule entries.", highlight: "#uie-schedules-list" },
      { text: "Calendar is for dated events; Activities advances time; Schedules describes recurring routines.", highlight: "" }
    ]
  },
  {
    selector: "#uie-tracker-window",
    title: "Social Chronicle",
    guideId: "guide-you-world",
    steps: [
      { text: "Social Chronicle is a tracked-character dossier and relationship-history view.", highlight: "" },
      { text: "Select a known character to inspect their details and relationship context.", highlight: "#sd-details-name" },
      { text: "Use the family-tree view to inspect recorded genealogical connections.", highlight: "#uie-tracker-window" }
    ]
  },
  {
    selector: "#uie-mmo-chat-window",
    title: "Simulated Server Chat",
    guideId: "guide-mmo",
    steps: [
      { text: "Server Chat simulates Global, Trade, LFG, and Local channels; it does not contact real users.", highlight: "#uie-mmo-chat-list" },
      { text: "Write a message or use the bolt to generate a world-flavor pulse.", highlight: "#uie-mmo-chat-input" },
      { text: "Pause stops live pulses, while AI flavor controls ambient chatter.", highlight: "#uie-mmo-chat-pause" }
    ]
  },
  {
    selector: "#uie-lfg-window",
    title: "Looking For Group",
    guideId: "guide-mmo",
    steps: [
      { text: "LFG is an in-world simulated party board, not a real matchmaking service.", highlight: "#uie-lfg-listings" },
      { text: "Filter open listings by role and refresh for a new board snapshot.", highlight: "#uie-lfg-filter-role" },
      { text: "Create your post with an activity, role, and note.", highlight: "#uie-lfg-post-form" }
    ]
  },
  {
    selector: "#uie-library-window",
    title: "Archive",
    guideId: "guide-archive-access",
    steps: [
      { text: "Archive stores generated in-world books and documents.", highlight: "" },
      { text: "It is separate from reusable character cards and Lorebook canon.", highlight: "#uie-library-window .uie-content" },
      { text: "Use the pen control to generate a new in-world document when a model is available.", highlight: "#uie-lib-gen-btn" }
    ]
  },
  {
    selector: "#uie-focused-doms-modal",
    title: "Focused DOM Workspace",
    guideId: "guide-archive-access",
    steps: [
      { text: "Focused DOMs are dedicated task and dossier workspaces for prioritized locations or roles.", highlight: "#uie-focused-doms-modal" },
      { text: "Choose a dossier and use its local controls to complete focused actions.", highlight: "#uie-focus-workspace-body" },
      { text: "Close to return to Map; completed actions remain in shared campaign state.", highlight: "[data-map-modal-close]" }
    ]
  },
  {
    selector: "#uie-sprites-window",
    title: "Sprites Manager",
    guideId: "guide-sprites",
    steps: [
      { text: "Sprites Manager organizes character libraries, expression images, and stage presentation.", highlight: "" },
      { text: "Choose a library, then map imported or generated images to expression states.", highlight: "#uie-sprites-window input, #uie-sprites-window select" },
      { text: "Save so dialogue and expression detection can reuse the library on stage.", highlight: "#uie-sprites-window button" }
    ]
  },
  {
    selector: "#uie-debug-window",
    title: "Debug and Diagnostics",
    guideId: "guide-debug",
    steps: [
      { text: "Debug exposes diagnostics, connection checks, state reports, and recovery tools.", highlight: "" },
      { text: "Run diagnostics and export/copy the report before applying repairs.", highlight: "#uie-debug-window button" },
      { text: "Export current data before clear, reset, import, or state-replacement operations.", highlight: "#uie-debug-window" }
    ]
  },
  {
    selector: "#uie-launcher-options-window",
    title: "Launcher Options",
    guideId: "guide-launcher-portability",
    steps: [
      { text: "Launcher Options customizes the floating launcher's appearance and saved icons.", highlight: "" },
      { text: "Save applies and keeps the selected icon settings.", highlight: "#uie-launcher-opt-save" },
      { text: "Delete removes a saved icon. Visibility and position reset live in Settings > Edit UI.", highlight: "#uie-launcher-opt-delete" }
    ]
  },
  {
    selector: "#uie-atmosphere-window",
    title: "Atmosphere Console",
    guideId: "guide-atmosphere",
    steps: [
      { text: "Atmosphere controls scene weather, visual mood, filters, and presentation modes.", highlight: "#uie-atmosphere-window" },
      { text: "Choose weather and visual presets, or tune the fields and switches manually.", highlight: "#uie-atmosphere-window .atmo-weather" },
      { text: "Use the clock controls when you intend to advance authoritative game time.", highlight: "#uie-atmosphere-window .atmo-clock" },
      { text: "Presentation filters alone do not move the player or replace Calendar/Map state.", highlight: "#uie-atmosphere-window .atmo-content" }
    ]
  },
  {
    selector: "#uie-settings-window",
    title: "Settings Window",
    guideId: "guide-settings",
    steps: [
      { text: "Welcome to UIE Settings! Here you can connect your AI APIs, customize the RPG engine, manage saves, and adjust UI preferences.", highlight: "" },
      { text: "Select a tab on the left to configure different settings, like Main API, Audio, RPG, or Saves.", highlight: "#uie-sw-tabs" },
      { text: "Under Main API, you can write an optional Prompt Preset to set the narration tone or style.", highlight: "#cfg-main-prompt-preset" },
      { text: "Character saves are managed through the Persona system. Save your character progress, inventory, and stats via the Persona panel.", highlight: "#persona-save" },
      { text: "Under Edit UI, you can write custom CSS or scale HUD chips, dialogue cards, and toast notifications.", highlight: ".uie-set-tab[data-tab='ui-edit']" },
      { text: "Click the close button at the top right when you are finished.", highlight: "#uie-settings-close" }
    ]
  },
  {
    selector: "#re-vn-settings-modal",
    title: "Visual Novel Settings",
    guideId: "guide-settings",
    steps: [
      { text: "Visual Novel settings let you adjust how story text scrolls, paginates, and is guided by the AI.", highlight: "" },
      { text: "Adjust text typewriter speed. Lower values speed up the text narration.", highlight: "#re-vn-speed" },
      { text: "Set the max words per text box to control when narration breaks to a new page.", highlight: "#re-vn-words" },
      { text: "Add a narrator prompt prefix to guide the visual novel tone and description style.", highlight: "#re-vn-prompt" },
      { text: "Enable Auto Mode to automatically advance pages when text typing completes.", highlight: "#re-vn-auto-check" },
      { text: "Click Save to apply your visual novel settings and refresh the text.", highlight: "#re-vn-save-settings" }
    ]
  },
  {
    selector: "#config-modal",
    title: "Configurations",
    guideId: "guide-settings",
    steps: [
      { text: "Welcome to UIE Configurations! Adjust API keys, prompt profiles, quick bar icons, and banned phrases.", highlight: "" },
      { text: "Use these tab buttons to switch between settings categories, like Main API, Prompts, or UI icons.", highlight: ".tabbar" },
      { text: "Under Prompts tab, you can import or define prompt profiles (Story, AI Core, Forbidden Overrides).", highlight: ".tab-btn[data-tab='prompts']" },
      { text: "Under Banned tab, you can enter comma-separated words, phrases, or character names that the AI must not generate.", highlight: ".tab-btn[data-tab='bans']" },
      { text: "Under UI tab, you can customize the Font Awesome icons used in your Quick Bar.", highlight: ".tab-btn[data-tab='icons']" }
    ]
  },
  {
    selector: "#uie-pet-menu-modal",
    title: "Helper Pet Settings",
    guideId: "guide-helper",
    steps: [
      { text: "Helper Pet Settings controls the floating companion: character art, name, personality, voice, tutorial tools, and visibility.", highlight: "" },
      { text: "I can explain the current window, guide New Game setup, open Help / Manual, restart tutorials, and answer system questions locally. Pet Chat does not change game state.", highlight: "#uie-pet-restart-tutorials" },
      { text: "Pick the guide character here. The choice changes the floating pet art but keeps the tutorial logic the same.", highlight: "#uie-pet-type-select" },
      { text: "Name and personality change how the pet labels itself and how chat guidance is worded.", highlight: "#uie-pet-name" },
      { text: "Explain Screen runs the same modal-specific tutorial logic used by Tutorial Mode.", highlight: "#uie-pet-explain-screen" },
      { text: "Restart Tutorials clears the skipped/completed flags and starts the guided tour again.", highlight: "#uie-pet-restart-tutorials" }
    ]
  },
  {
    selector: "#uie-pet-chat-panel",
    title: "Helper Pet Chat",
    guideId: "guide-helper",
    steps: [
      { text: `Pet Chat is the out-of-character assistant. ${HELPER_CAPABILITY_LINE}`, highlight: "" },
      { text: "Type a question about a screen, control, or workflow. For creation, I point you to the explicit editor; Pet Chat itself is read-only.", highlight: "#uie-pet-chat-input" },
      { text: "Send the message to get guidance based on the Help Manual and the same tutorial target registry used by the modal walkthrough.", highlight: "#uie-pet-chat-send" }
    ]
  },
  {
    selector: "#uie-cheat-code-modal",
    title: "Forge Item",
    guideId: "guide-helper",
    steps: [
      { text: "Forge Item turns a natural-language request into inventory data. Use it for gear, supplies, books, artifacts, or useful kits.", highlight: "" },
      { text: "Describe the item with purpose, rarity, limits, and setting fit. Clear requests create cleaner item records.", highlight: "#cheat-command" },
      { text: "Forge Item generates the result and adds valid items to inventory.", highlight: "#cheat-execute" }
    ]
  },
  {
    selector: "#uie-rumor-log-modal",
    title: "Rumor Log",
    guideId: "guide-helper",
    steps: [
      { text: "Rumor Log stores helper-pet notices and world-facing hints gathered during play.", highlight: "" },
      { text: "Review recent entries for reminders, warnings, or loose threads that may deserve follow-up.", highlight: ".rumor-row, .rumor-entry" },
      { text: "Close when you are done reading; this modal is informational.", highlight: "#rumor-modal-close" }
    ]
  },
  {
    selector: "#image-gallery-modal",
    title: "Image Gallery",
    guideId: "guide-sprites",
    steps: [
      { text: "Image Gallery browses generated or imported images by scope, character, scene, or key.", highlight: "" },
      { text: "Filter until you find the portrait, background, sprite, or reference image you need.", highlight: "input, select, .image-card" },
      { text: "Pick an image to reuse it for portraits, backgrounds, sprites, or references.", highlight: "button[id*='select'], .image-card" }
    ]
  },
  {
    selector: "#img-prompt-confirm-modal",
    title: "Image Prompt",
    guideId: "guide-sprites",
    steps: [
      { text: "Image Prompt lets you review generation text before sending it to the image provider.", highlight: "" },
      { text: "Tighten subject, style, composition, exclusions, and use case if the draft is too vague.", highlight: "textarea, input" },
      { text: "Confirm only when the prompt describes the visual asset you actually want created.", highlight: "button[id*='confirm'], button[id*='generate']" }
    ]
  },
  {
    selector: "#uie-background-picker-modal, #uie-bg-changer-modal",
    title: "Background Picker",
    guideId: "guide-sprites",
    steps: [
      { text: "Background Picker changes the scene or UI backdrop without changing story location by itself.", highlight: "" },
      { text: "Choose or generate a background that matches the active scene, room, or interface mood.", highlight: "button, .background-card, .uie-bg-card" },
      { text: "Apply the background when it should become the visible stage image.", highlight: "button[id*='apply'], button[id*='select']" }
    ]
  },
  {
    selector: "#uie-image-gen-modal, #uie-character-generator-modal",
    title: "Image Generator",
    guideId: "guide-sprites",
    steps: [
      { text: "Image Generator creates portraits, references, character art, or scene images from a prompt.", highlight: "" },
      { text: "Describe the subject, camera/framing, style, outfit, background, and any exclusions.", highlight: "textarea, input" },
      { text: "Generate when the prompt is specific enough to produce a useful asset.", highlight: "button[id*='generate']" }
    ]
  },
  {
    selector: "#music-modal",
    title: "Music",
    guideId: "guide-atmosphere",
    steps: [
      { text: "Music rules decide what plays by genre, location, keyword, or scene context.", highlight: "" },
      { text: "Add or edit rules so the current location and story keywords map to the right ambience.", highlight: "input, select, textarea" },
      { text: "Save the rule set when future scenes should use it automatically.", highlight: "button[id*='save'], button[id*='apply']" }
    ]
  },
  {
    selector: "#war-room-modal",
    title: "War Room",
    guideId: "guide-battle",
    steps: [
      { text: "War Room summarizes large-scale conflict: factions, pressure, fronts, threats, and strategic choices.", highlight: "" },
      { text: "Review the strategic situation before choosing a move, because it can affect factions and future encounters.", highlight: ".war-room-section, button" },
      { text: "Apply a strategy only when it matches what the party is committing to do.", highlight: "button[id*='apply'], button[id*='confirm']" }
    ]
  },
  {
    selector: "#uie-org-member-modal",
    title: "Organization Member",
    guideId: "guide-databank",
    steps: [
      { text: "This modal adds or edits a member of the current organization. Use it for leaders, ranks, guards, classmates, agents, or hidden members.", highlight: "" },
      { text: "Choose or type the member, then set rank/role, standing, location, and notes that belong to the organization record.", highlight: "input, select, textarea" },
      { text: "Save when the member should become part of the organization roster.", highlight: "button[id*='save'], button[id*='add']" }
    ]
  },
  {
    selector: "#outfit-create-modal, #equip-outfit-modal",
    title: "Outfit Creator",
    guideId: "guide-inventory",
    steps: [
      { text: "Outfit Creator builds wearable outfit records manually or from AI context.", highlight: "" },
      { text: "Set slots, category, sprite references, image links, and description so equipment and visuals can use the outfit correctly.", highlight: "input, select, textarea" },
      { text: "Save when the outfit is ready to appear in equipment workflows.", highlight: "button[id*='save'], button[id*='create']" }
    ]
  },
  {
    selector: "#uie-item-modal",
    title: "Item Details",
    guideId: "guide-inventory",
    steps: [
      { text: "Item Details shows one inventory object and its available actions.", highlight: "" },
      { text: "Review description, tags, quantity, rarity, slot category, and any generated metadata before acting.", highlight: "#uie-item-modal-desc, #uie-item-modal-meta" },
      { text: "Use, equip, read, gift, send to party, open, or trash from the action buttons depending on item type.", highlight: "button" }
    ]
  },
  {
    selector: "#uie-item-reader-modal",
    title: "Item Reader",
    guideId: "guide-inventory",
    steps: [
      { text: "Item Reader opens readable item content such as generated books, notes, manuals, or documents.", highlight: "" },
      { text: "Read the content for lore or instructions. It does not need to be copied into chat unless you want the scene to react to it.", highlight: ".uie-item-reader-body, textarea" },
      { text: "Close when finished reading.", highlight: "button[id*='close']" }
    ]
  },
  {
    selector: "#uie-container-modal",
    title: "Container",
    guideId: "guide-inventory",
    steps: [
      { text: "Container shows items inside a bag, box, chest, or nested storage object.", highlight: "" },
      { text: "Review contained items and choose what to take or leave.", highlight: ".uie-container-row, button" },
      { text: "Close after transferring the items you want.", highlight: "#uie-container-modal-close" }
    ]
  },
  {
    selector: "#uve-wizard",
    title: "Sprite Wizard",
    guideId: "guide-sprites",
    steps: [
      { text: "Sprite Wizard helps import or organize character sprite images and expression states.", highlight: "" },
      { text: "Follow the fields for character/library name, image choices, expression labels, and stage usage.", highlight: "input, select, button" },
      { text: "Finish when the sprite library is ready for VN staging.", highlight: "button[id*='finish'], button[id*='save']" }
    ]
  },
  {
    selector: "#uie-view-life",
    title: "Life Trackers",
    guideId: "guide-inventory",
    steps: [
      { text: "Life Trackers are your vital bars: HP, Hunger, Sanity, Heat, Corruption, anything the story or items can change.", highlight: "" },
      { text: "Up to 6 trackers show at once. Scroll or swipe to see more if you have added extra trackers.", highlight: "#life-list" },
      { text: "Tap + or - on a card to bump its value. Tap Edit to change name, color, max, notes, or which systems can update it.", highlight: ".life-mini" },
      { text: "Use New to create a tracker. The AI will update enabled trackers automatically when Life Tracking is on.", highlight: "#life-btn-add" }
    ]
  },
  {
    selector: "#uie-factions-window",
    title: "Organizations",
    guideId: "guide-organizations",
    steps: [
      { text: "Organizations is your Power Network. Every guild, gang, school, council, company, cult, family, or crew you interact with shows up here.", highlight: "" },
      { text: "Each card shows the organization emblem, type, location, standing bar, heat badge, active hooks, leader, and member count at a glance.", highlight: "#uie-organization-list" },
      { text: "Use the filter bar to search by name, category, or status. Filter for Joined, Friendly, Hostile, High Heat, or Has Hook.", highlight: ".uie-org-filter-bar" },
      { text: "The Network Status dashboard shows total organizations, allies, hostiles, controlled places, open invitations, active conflicts, debts, and restricted access counts.", highlight: ".uie-org-network-dashboard" },
      { text: "Click an organization card to open its dossier. The first view is a read-mode dashboard showing Power, Access, Threat, Current Drama, Key People, Rules, and Rewards.", highlight: "[data-org-open]" },
      { text: "Switch to the Edit tab inside the dossier to change any field. All existing data stays compatible.", highlight: ".uie-org-tab" },
      { text: "The Intel Found panel shows organizations auto-discovered from chat, lorebook, character cards, and map data. Accept, reject, merge, or edit before adding.", highlight: ".uie-org-intel-panel" },
      { text: "On mobile, swipe the organization list to scroll and tap cards to open dossiers.", highlight: "#uie-organization-list" }
    ]
  },
  {
    selector: "#re-ds-modal, #re-lockpick-modal, #re-scratch-modal",
    title: "Minigame Override",
    guideId: "guide-minigames",
    steps: [
      { text: "This is an active minigame challenge (like lockpicking, hacking, or a time-sensitive shift job).", highlight: "" },
      { text: "Read the minigame goal and use the interactive controls. If there is a timer, complete the task before it expires!", highlight: "" },
      { text: "Once you succeed or fail, the outcome will be submitted back to the AI storyteller automatically.", highlight: "" },
      { text: "If you want to abort the minigame at any time, click the ABORT button in the header.", highlight: "#re-ds-abort-btn, #re-lock-close, #re-scratch-close" }
    ]
  },
  {
    selector: "#uie-cutscene-overlay",
    title: "Cinematic Cutscene",
    guideId: "guide-cutscenes",
    steps: [
      { text: "A cinematic cutscene is currently playing. Sit back and watch the scenes unfold!", highlight: "" },
      { text: "The progress bar at the bottom shows the duration of the current shot.", highlight: ".uie-cutscene-progress" },
      { text: "You can skip the cutscene at any time by clicking the SKIP button in the bottom-right corner.", highlight: ".uie-cutscene-skip" }
    ]
  },
  // Backwards compatibility list with single-step fallbacks:
  { selector: ".modal-overlay:not(#help-manual-modal)", title: "Modal", guideId: "guide-start", explain: "This modal is asking for focused input. Read the title, check the highlighted controls, then save, confirm, cancel, or close." }
];

export function getTutorialGuideText() {
  return TUTORIAL_TARGETS.map((target) => {
    const lines = [`## ${target.title}`, `Selector: ${target.selector}`, `Manual section: ${target.guideId || "guide-start"}`];
    const steps = target.steps || [{ text: target.explain || "Focused modal or window." }];
    lines.push(...steps.map((step) => `- ${step.text}${step.highlight ? ` [control: ${step.highlight}]` : ""}`));
    return lines.join("\n");
  }).join("\n\n");
}

let installed = false;
let active = false;
let currentTarget = null;
let currentStepIndex = 0;
let observer = null;
let activeHighlightEl = null;

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function isVisible(el) {
  if (!el || !el.isConnected) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 8 && rect.height > 8;
}

function getFirstVisible(selector) {
  try {
    return Array.from(document.querySelectorAll(selector)).find(isVisible) || null;
  } catch (_) {
    return null;
  }
}

export function getVisibleTarget() {
  const visibleTargets = [];
  for (const target of TUTORIAL_TARGETS) {
    const el = getFirstVisible(target.selector);
    if (el) visibleTargets.push({ ...target, el });
  }
  if (visibleTargets.length) {
    visibleTargets.sort((a, b) => {
      const modalish = (target) => /modal|overlay|panel|picker|wizard|transit|dialog/i.test(`${target.selector} ${target.title || ""}`);
      const modalDelta = (modalish(b) ? 1 : 0) - (modalish(a) ? 1 : 0);
      if (modalDelta !== 0) return modalDelta;
      const az = Number.parseInt(window.getComputedStyle(a.el).zIndex, 10);
      const bz = Number.parseInt(window.getComputedStyle(b.el).zIndex, 10);
      const zDelta = (Number.isFinite(bz) ? bz : 0) - (Number.isFinite(az) ? az : 0);
      if (zDelta !== 0) return zDelta;
      const depth = (el) => {
        let n = 0;
        for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) n++;
        return n;
      };
      return depth(b.el) - depth(a.el);
    });
    return visibleTargets[0];
  }

  // Keep Tutorial Mode useful for extension modules and newly added dialogs even
  // before they receive a hand-authored walkthrough. Registered targets above
  // always win; this fallback describes the topmost visible focused surface.
  const genericSurfaces = Array.from(document.querySelectorAll([
    ".uie-window",
    ".modal-overlay",
    "[role='dialog']",
    "[aria-modal='true']",
    "[id$='-modal']",
    "[id$='-overlay']"
  ].join(","))).filter((el) => {
    if (!isVisible(el)) return false;
    if (el.closest("#uie-helper-tutorial-panel, #uie-helper-pet-container, #uie-pet-chat-panel")) return false;
    return !TUTORIAL_TARGETS.some((target) => {
      try { return el.matches(target.selector); } catch (_) { return false; }
    });
  });
  if (genericSurfaces.length) {
    genericSurfaces.sort((a, b) => {
      const az = Number.parseInt(window.getComputedStyle(a).zIndex, 10);
      const bz = Number.parseInt(window.getComputedStyle(b).zIndex, 10);
      return (Number.isFinite(bz) ? bz : 0) - (Number.isFinite(az) ? az : 0);
    });
    const el = genericSurfaces[0];
    const heading = el.querySelector("h1, h2, h3, [role='heading'], [aria-label]");
    const rawTitle = heading?.textContent?.trim() || heading?.getAttribute?.("aria-label") || el.getAttribute("aria-label") || el.id || "Focused Window";
    const title = rawTitle.replace(/\s+/g, " ").slice(0, 80);
    const escapedId = window.CSS?.escape ? window.CSS.escape(el.id || "") : String(el.id || "").replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    const selector = el.id ? `#${escapedId}` : ".uie-window, .modal-overlay, [role='dialog']";
    return {
      selector,
      el,
      title,
      guideId: "guide-modal-tutorials",
      steps: [
        { text: `${title} is the active focused window. Read its heading and current status before changing campaign state.`, highlight: "" },
        { text: "Work from top to bottom: choose a tab or section, complete the visible fields, then review the result or preview.", highlight: `${selector} [role='tab'], ${selector} input, ${selector} select, ${selector} textarea` },
        { text: "Use the labeled primary action to apply changes, or Close / Cancel to leave without committing a draft.", highlight: `${selector} button` }
      ]
    };
  }
  return {
    selector: "body",
    el: document.body,
    title: "Gameplay",
    guideId: "guide-start",
    steps: [
      { text: "You are exploring the main scene! Open the Command Deck to reach menus, or click my character icon to open options.", highlight: "" }
    ]
  };
}

function ensureStyles() {
  if (document.getElementById("uie-helper-tutorial-styles")) return;
  const style = document.createElement("style");
  style.id = "uie-helper-tutorial-styles";
  style.textContent = `
    .uie-tutorial-root-highlight {
      outline: 2.5px solid rgba(203, 163, 92, 0.95) !important;
      box-shadow: 0 0 0 5px rgba(203, 163, 92, 0.2), 0 0 28px rgba(203, 163, 92, 0.4) !important;
    }
    .uie-tutorial-button-highlight {
      position: relative !important;
      outline: 2.5px solid rgba(45, 212, 191, 0.95) !important;
      box-shadow: 0 0 0 4px rgba(45, 212, 191, 0.18), 0 0 18px rgba(45, 212, 191, 0.3) !important;
      z-index: 10005 !important;
      animation: pulse-border-highlight 1.5s infinite !important;
    }
    @keyframes pulse-border-highlight {
      0% { box-shadow: 0 0 0 0px rgba(45, 212, 191, 0.75); }
      70% { box-shadow: 0 0 0 6px rgba(45, 212, 191, 0); }
      100% { box-shadow: 0 0 0 0px rgba(45, 212, 191, 0); }
    }
    #uie-helper-tutorial-panel {
      position: fixed;
      z-index: 2147483647;
      width: 290px;
      background: rgba(22, 18, 14, 0.97);
      border: 1.5px solid #cba35c;
      border-radius: 16px;
      color: #f0f0f0;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(12px);
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      overflow: visible;
      transition: transform 0.2s ease, opacity 0.2s ease;
    }
    #uie-helper-tutorial-panel:hover {
      transform: scale(1.02);
    }
    #uie-helper-tutorial-panel header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: rgba(203, 163, 92, 0.15);
      border-bottom: 1px solid rgba(203, 163, 92, 0.3);
      border-top-left-radius: 14px;
      border-top-right-radius: 14px;
      font-family: 'Cinzel', serif;
      font-size: 11px;
      font-weight: bold;
      color: #cba35c;
    }
    #uie-helper-tutorial-panel header button {
      margin-left: auto;
      background: none;
      border: none;
      color: #ff5555;
      font-size: 14px;
      cursor: pointer;
      outline: none;
      padding: 2px 6px;
    }
    #uie-helper-tutorial-body {
      padding: 12px 14px;
      font-size: 13px;
      line-height: 1.45;
      color: #e2e8f0;
    }
    #uie-helper-tutorial-body .pet-name {
      font-family: 'Cinzel', serif;
      font-weight: bold;
      color: #cba35c;
      margin-bottom: 2px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    #uie-helper-tutorial-body .uie-tutorial-title {
      font-family: 'Cinzel', serif;
      font-weight: 800;
      color: #cba35c;
      font-size: 10px;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      opacity: 0.8;
    }
    #uie-helper-tutorial-body .speech-text {
      color: #e2e8f0;
      margin-bottom: 6px;
    }
    #uie-helper-tutorial-body .click-to-continue {
      font-size: 9px;
      color: #cba35c;
      opacity: 0.7;
      margin-top: 8px;
      text-align: right;
      font-style: italic;
    }
    #uie-helper-tutorial-actions {
      display: flex;
      justify-content: flex-end;
      padding: 0 14px 12px;
      gap: 8px;
    }
    #uie-helper-tutorial-actions button {
      height: 26px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(255, 255, 255, 0.05);
      color: #fff;
      font-size: 11px;
      padding: 0 10px;
      cursor: pointer;
      outline: none;
    }
    #uie-helper-tutorial-actions button.primary {
      border-color: #cba35c;
      background: rgba(203, 163, 92, 0.2);
      color: #ffe2a1;
      font-weight: bold;
    }
    #uie-helper-tutorial-panel.bubble-above::after {
      content: '';
      position: absolute;
      bottom: -10px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-top: 10px solid #cba35c;
    }
    #uie-helper-tutorial-panel.bubble-above::before {
      content: '';
      position: absolute;
      bottom: -8px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-top: 10px solid rgba(22, 18, 14, 0.97);
      z-index: 1;
    }
    #uie-helper-tutorial-panel.bubble-below::after {
      content: '';
      position: absolute;
      top: -10px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-bottom: 10px solid #cba35c;
    }
    #uie-helper-tutorial-panel.bubble-below::before {
      content: '';
      position: absolute;
      top: -8px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-bottom: 10px solid rgba(22, 18, 14, 0.97);
      z-index: 1;
    }
    #uie-helper-tutorial-panel.bubble-fallback::after,
    #uie-helper-tutorial-panel.bubble-fallback::before {
      display: none !important;
    }
    @keyframes bubble-bounce-in {
      0% { transform: scale(0.8) translateY(10px); opacity: 0; }
      100% { transform: scale(1) translateY(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

export function repositionBubble() {
  const panel = document.getElementById("uie-helper-tutorial-panel");
  if (!panel) return;

  const pet = document.getElementById("uie-helper-pet-container");
  const isPetVisible = pet && pet.style.display !== "none" && window.getComputedStyle(pet).display !== "none";

  if (isPetVisible) {
    const petRect = pet.getBoundingClientRect();
    const bubbleWidth = panel.offsetWidth || 290;
    const bubbleHeight = panel.offsetHeight || 120;

    let left = petRect.left + (petRect.width / 2) - (bubbleWidth / 2);
    let top = petRect.top - bubbleHeight - 16;

    // Bound check (keep inside viewport)
    if (left < 10) left = 10;
    if (left + bubbleWidth > window.innerWidth - 10) {
      left = window.innerWidth - bubbleWidth - 10;
    }

    if (top < 10) {
      // Show below the pet if it goes off top
      top = petRect.bottom + 16;
      panel.classList.add("bubble-below");
      panel.classList.remove("bubble-above");
    } else {
      panel.classList.add("bubble-above");
      panel.classList.remove("bubble-below");
    }

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.bottom = "auto";
    panel.style.right = "auto";
  } else {
    // Fallback to default bottom-right floating position if pet is not visible
    panel.className = "bubble-fallback";
    panel.style.right = "22px";
    panel.style.bottom = "30px";
    panel.style.left = "auto";
    panel.style.top = "auto";
  }
}

function handleHighlightClick() {
  // Delay slightly so the natural click event handles first, then advance
  setTimeout(() => {
    advanceStep();
  }, 100);
}

function addHighlightClickListener(el) {
  activeHighlightEl = el;
  el.addEventListener("click", handleHighlightClick);
}

function removeHighlightClickListeners() {
  if (activeHighlightEl) {
    activeHighlightEl.removeEventListener("click", handleHighlightClick);
    activeHighlightEl = null;
  }
}

function advanceStep() {
  const targetSteps = currentTarget?.steps || [{ text: currentTarget?.explain, highlight: "" }];
  currentStepIndex++;
  if (currentStepIndex >= targetSteps.length) {
    // End of steps for this window. Close it.
    stopTutorial({ complete: true });
  } else {
    showCurrentStep();
  }
}

function showCurrentStep() {
  if (!active || !currentTarget) return;

  const targetSteps = currentTarget.steps || [{ text: currentTarget.explain, highlight: "" }];
  
  if (currentStepIndex >= targetSteps.length) {
    stopTutorial({ complete: true });
    return;
  }

  const step = targetSteps[currentStepIndex];

  // Clear previous highlights & listeners
  clearHighlights();
  removeHighlightClickListeners();

  // Highlight modal root window
  if (currentTarget.el) {
    currentTarget.el.classList.add("uie-tutorial-root-highlight");
  }

  // Highlight specific step target
  let highlightedEl = null;
  if (step.highlight) {
    try {
      highlightedEl = currentTarget.el ? currentTarget.el.querySelector(step.highlight) : document.querySelector(step.highlight);
    } catch (e) {
      console.warn("Invalid step highlight selector:", step.highlight);
    }
  }

  if (highlightedEl) {
    highlightedEl.classList.add("uie-tutorial-button-highlight");
    addHighlightClickListener(highlightedEl);
  }

  // Update Speech Bubble
  const panel = ensurePanel();
  const body = panel.querySelector("#uie-helper-tutorial-body");
  
  const settings = getSettings();
  const petName = settings.helperPet?.name || "Helper Pet";

  if (body) {
    body.innerHTML = `
      <div class="pet-name">${escapeHtml(petName)}</div>
      <div class="uie-tutorial-title" style="margin-top:2px;">Target: ${escapeHtml(currentTarget.title)}</div>
      <div class="speech-text" style="margin-top:6px;">${escapeHtml(step.text)}</div>
      <div class="click-to-continue">Click bubble or highlighted element to continue... (${currentStepIndex + 1}/${targetSteps.length})</div>
    `;
  }

  repositionBubble();
}

function ensurePanel() {
  ensureStyles();
  let panel = document.getElementById("uie-helper-tutorial-panel");
  if (panel) return panel;
  panel = document.createElement("div");
  panel.id = "uie-helper-tutorial-panel";
  panel.style.animation = "bubble-bounce-in 0.25s ease-out";
  panel.innerHTML = `
    <header>
      <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
      <strong>Helper Companion</strong>
      <button type="button" id="uie-tutorial-close" title="Close tutorial"><i class="fa-solid fa-xmark"></i></button>
    </header>
    <div id="uie-helper-tutorial-body"></div>
    <div id="uie-helper-tutorial-actions">
      <button type="button" id="uie-tutorial-skip">Skip</button>
      <button type="button" class="primary" id="uie-tutorial-next-btn">Next</button>
    </div>
  `;
  document.body.appendChild(panel);

  panel.addEventListener("click", (e) => {
    if (e.target.closest("button") || e.target.closest("a")) return;
    advanceStep();
  });

  panel.querySelector("#uie-tutorial-close")?.addEventListener("click", (e) => {
    e.stopPropagation();
    stopTutorial({ complete: true });
  });
  panel.querySelector("#uie-tutorial-skip")?.addEventListener("click", (e) => {
    e.stopPropagation();
    stopTutorial({ skipped: true });
  });
  panel.querySelector("#uie-tutorial-next-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    advanceStep();
  });
  return panel;
}

function getTargetSection(id) {
  return HELP_SECTIONS.find((section) => section.id === id) || HELP_SECTIONS[0];
}

function clearHighlights() {
  document.querySelectorAll(".uie-tutorial-root-highlight, .uie-tutorial-button-highlight").forEach((el) => {
    el.classList.remove("uie-tutorial-root-highlight", "uie-tutorial-button-highlight");
  });
}

export function explainCurrentWindow({ force = false } = {}) {
  if (!active && !force) return;
  const target = getVisibleTarget();
  
  if (!force && currentTarget?.el === target.el && currentTarget?.title === target.title) return;
  
  currentTarget = target;
  currentStepIndex = 0;
  showCurrentStep();
}

export function startTutorial(options = {}) {
  const settings = getSettings();
  settings.ui = settings.ui || {};
  if (settings.ui.helperTutorialSkipped === true && options.force !== true) return false;
  active = true;
  settings.ui.helperTutorialActive = true;
  settings.ui.helperTutorialSkipped = false;
  saveSettings();
  ensurePanel();
  installTutorialSystem();
  explainCurrentWindow({ force: true });
  return true;
}

export function promptNewGameTutorial() {
  const settings = getSettings();
  settings.ui = settings.ui || {};
  if (settings.ui.helperTutorialCompleted === true || settings.ui.helperTutorialSkipped === true) return;
  ensureStyles();
  let modal = document.getElementById("uie-newgame-tutorial-choice");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "uie-newgame-tutorial-choice";
    modal.className = "modal-overlay";
    modal.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.72);padding:16px;box-sizing:border-box;";
    modal.innerHTML = `
      <div class="modal-card" style="width:min(520px, calc(100vw - 24px)); background:#10141f; color:#eef5ff; border:1px solid rgba(203,163,92,.65); border-radius:14px; padding:18px; box-shadow:0 24px 90px rgba(0,0,0,.75);">
        <h3 style="margin:0 0 8px;color:#cba35c;">Let the Helper Pet show you around?</h3>
        <p style="margin:0 0 14px;line-height:1.5;color:#d8e2f1;">New Game setup is open. I can help you choose character basics, appearance, currency and groups, life trackers, items, skills, quests, lorebooks, assets, NPCs, and the starting location while keeping the walkthrough inside the setup flow. You can skip it now and open Tutorial Mode later from Help / Manual.</p>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
          <button type="button" id="uie-newgame-tutorial-skip" class="reply-tool-btn" style="width:auto;padding:8px 14px;">Skip Tutorial</button>
          <button type="button" id="uie-newgame-tutorial-start" class="reply-tool-btn" style="width:auto;padding:8px 16px;border-color:#cba35c;color:#ffe2a1;background:rgba(203,163,92,.18);">Start Tutorial</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector("#uie-newgame-tutorial-start")?.addEventListener("click", () => {
      modal.remove();
      startTutorial({ force: true, source: "newgame" });
    });
    modal.querySelector("#uie-newgame-tutorial-skip")?.addEventListener("click", () => {
      modal.remove();
      stopTutorial({ skipped: true });
    });
  }
}

export function stopTutorial({ skipped = false, complete = false } = {}) {
  active = false;
  clearHighlights();
  removeHighlightClickListeners();
  document.getElementById("uie-helper-tutorial-panel")?.remove();
  const settings = getSettings();
  settings.ui = settings.ui || {};
  settings.ui.helperTutorialActive = false;
  if (skipped) settings.ui.helperTutorialSkipped = true;
  if (complete) settings.ui.helperTutorialCompleted = true;
  saveSettings();
}

function observeTutorialTargets() {
  if (observer) return;
  observer = new MutationObserver(() => {
    if (!active) return;
    window.clearTimeout(window.__uieTutorialExplainTimer);
    window.__uieTutorialExplainTimer = window.setTimeout(() => explainCurrentWindow(), 120);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "aria-hidden"] });
}

export function installTutorialSystem() {
  if (installed) return;
  installed = true;
  ensureStyles();
  observeTutorialTargets();
  
  window.UIE_startHelperTutorial = startTutorial;
  window.UIE_stopHelperTutorial = stopTutorial;
  window.UIE_promptNewGameTutorial = promptNewGameTutorial;
  window.UIE_explainCurrentWindow = explainCurrentWindow;
  window.UIE_repositionTutorialBubble = repositionBubble;
  
  window.addEventListener("resize", repositionBubble);
  window.addEventListener("scroll", repositionBubble);

  const settings = getSettings();
  if (settings?.ui?.helperTutorialActive === true && settings?.ui?.helperTutorialSkipped !== true) {
    active = true;
    setTimeout(() => explainCurrentWindow({ force: true }), 500);
  }
}

try { installTutorialSystem(); } catch (_) {}

export default {
  installTutorialSystem,
  startTutorial,
  stopTutorial,
  promptNewGameTutorial,
  explainCurrentWindow,
  repositionBubble,
  getVisibleTarget
};
