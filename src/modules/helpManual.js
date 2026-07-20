import { getSettings, saveSettings } from "./core.js";

export const HELP_SECTIONS = [
  // ─── FIRST STEPS ────────────────────────────────────────────────────────────
  {
    id: "guide-start",
    group: "First Steps",
    title: "Start Playing",
    summary: "Begin a new game, learn the main controls, and decide whether to take the tutorial.",
    steps: [
      "From the Startup screen, click NEW GAME to enter character creation, or CONTINUE to resume the last active session.",
      "LOAD GAME opens a slot picker so you can restore any named save, auto-save, or backup file independently.",
      "SETTINGS on the startup screen connects your AI API key, image provider, and audio before the first run.",
      "After a new game begins, the Helper Pet pops up asking whether you want a guided tutorial or prefer to explore on your own.",
      "Open the Command Deck (hamburger icon, bottom-left) to access every major system: Journal, Map, Inventory, Social, Phone, Settings, and more.",
      "Use Help / Manual (System tab in the Command Deck) any time you need detailed documentation on a feature.",
      "The Helper Pet can answer questions, explain the current screen, generate items, and restart tutorials — click it or the speech bubble button that appears on hover."
    ]
  },
  {
    id: "guide-command-deck",
    group: "First Steps",
    title: "Command Deck",
    summary: "Your main launcher for every game system — know what every section and button does.",
    steps: [
      "STORY section: Journal (quests / objectives / Codex), Diary (private notes and photos), Map (travel and room editing), Organizations (factions and groups), Activities (downtime and work), Battle (structured combat).",
      "CHARACTER section: Persona (your player identity), Inventory (items / equipment / skills / crafting), Characters (NPC and cast card library), Party (companion roster), Social (relationship tracker), Stats (character sheet).",
      "WORLD section: Databank (structured fact records), Phone (in-world apps, messages, banking), Calendar (time and schedules), Atmosphere (weather, filters, lighting), Helper Pet (companion guide settings).",
      "SYSTEM section: Settings (full config), Help / Manual (this document), Save Game, Load Game, Export Data, and Exit.",
      "Each category button is a toggle. Clicking it again closes all panels in that group.",
      "The hamburger/launcher button itself is draggable — hold and drag it anywhere on screen if it covers a scene element.",
      "HUD chips at the top of the chat window are also interactive: clock chip opens time controls, weather chip opens atmosphere, status chip opens effect viewer, API chip opens token usage stats."
    ]
  },
  {
    id: "guide-helper",
    group: "First Steps",
    title: "Helper Pet — Full Reference",
    summary: "Your local guide, tutorial companion, compliance helper, procedural forge launcher, and rumor tracker.",
    steps: [
      "The Helper Pet is the floating chibi character on screen. Hover to reveal two mini-buttons: ⚙ Gear (settings) and 💬 Chat bubble (AI assistant panel).",
      "Click the pet body to toggle the chat assistant panel directly. Drag the pet to any corner of the screen — position is saved and persists across sessions.",
      "CHAT PANEL: type any question and press Enter or the gold send button. The local guide answers questions about game systems, screens, and controls without spending model tokens or changing campaign state.",
      "CREATION REQUESTS: Pet Chat points you to the appropriate explicit editor. Use Inventory Create/Station for structured items, Journal for quests, Skills for abilities, and character/status editors for effects.",
      "EXPLAIN SCREEN: the Gear menu → Explain Screen button tells the pet to describe whatever modal is currently open and highlight the relevant controls.",
      "RUMOR LOG: stores in-world information the pet has overheard during narration. Rumors degrade in confidence as they spread through NPCs.",
      "CHEAT CODE ENGINE: type a freeform creation command (e.g. 'an elven ring of swiftness') and click Forge Item. The engine scans lore context, matches asset types, and adds the result directly to inventory.",
      "COMPLIANCE WARNINGS: if your equipped gear violates a local law (e.g. weapons in a pacified zone, shoes in a shoeless temple), the pet pops a warning bubble with a one-click unequip button.",
      "PET SETTINGS (Gear icon): choose chibi appearance (Fox, Cat Boy, Familiar, Phoenix, Crow), rename the pet, pick personality (Neutral / Sarcastic / Clinical / Whimsical / Ominous / Loyal), toggle TTS voice synthesis.",
      "HIDE / SHOW pet: Gear → 'Hide companion on screen'. Restore via Settings → Helper Pet or Command Deck → World → Helper Pet → toggle.",
      "RESTART TUTORIALS: Gear → Restart Tutorials resets tutorial progress and begins the highlight-and-explain walkthrough from the start.",
      "OPEN MANUAL: Gear → Help / Manual jumps directly to this reference document."
    ]
  },
  {
    id: "guide-tutorial-mode",
    group: "First Steps",
    title: "Tutorial Mode",
    summary: "The Helper Pet walks you through every open window with highlighted controls and voice-optional narration.",
    steps: [
      "Start Tutorial Mode from: Help / Manual → Tutorial Mode button, or Helper Pet Gear → Restart Tutorials, or the startup popup when New Game first loads.",
      "When Tutorial Mode is active, the pet explains the currently open modal or screen and highlights the most important controls with a golden glow ring.",
      "Each tutorial target (Startup, New Game, Inventory, Map, Settings, etc.) has 3–6 steps. Click the pet speech bubble or the Next button to advance steps.",
      "Skip Tutorial dismisses the walkthrough without clearing progress. Restart Tutorials resets the entire sequence.",
      "Tutorial bubbles reposition automatically if the pet is dragged while a tutorial is active.",
      "Tutorial Mode does not prevent interaction — you can still click any button during a tutorial step.",
      "After completing all targeted modals, Tutorial Mode deactivates automatically and the pet returns to normal assistant mode."
    ]
  },
  {
    id: "guide-hud",
    group: "First Steps",
    title: "HUD and Quick Controls",
    summary: "The heads-up display chips, quick bag, action wheel, and floating launcher.",
    steps: [
      "CLOCK CHIP: shows in-world time (hour, day, date). Click to open the time advancement controls — advance by minutes, hours, or full days.",
      "WEATHER CHIP: shows current weather icon. Click to open Atmosphere quickly without opening the full Command Deck.",
      "STATUS CHIP: shows active status effect count. Click to open the status effects viewer and remove or inspect effects.",
      "API CHIP / TOKEN LINE: shows model and token usage. Appears only after at least one generation request. Click for full token budget breakdown.",
      "QUICK BAG (bag icon, bottom-right area): a fast-access panel for items and skills you want reachable without opening full Inventory. Send items to Quick Bag from their item card action menu.",
      "ACTION WHEEL FAB (floating action button): opens your custom shortcut actions. Click the + inside the wheel to create a new shortcut linked to any game command or text macro.",
      "HAMBURGER BUTTON: opens/closes the Command Deck. Draggable — hold and move to reposition it on screen."
    ]
  },

  // ─── CHARACTER ──────────────────────────────────────────────────────────────
  {
    id: "guide-inventory",
    group: "Character",
    title: "Inventory — All Tabs",
    summary: "Items, equipment, skills, kitchen, alchemy, forge, enchant, create, and assets — every tab explained.",
    steps: [
      "ITEMS TAB: your main bag. Each item card shows name, quantity, rarity, and description. Card action buttons: USE (activate in story), EQUIP (move to equipment slot), INSPECT (read full description), SPLIT STACK (divide qty), TRASH (delete), SEND TO QUICK BAG.",
      "EQUIPMENT TAB: shows your body slot grid (head, chest, hands, feet, off-hand, accessory, etc.). Click an occupied slot to unequip. Click an empty slot to see compatible items. Outfit Drafts panel saves named full-outfit configurations for quick switching.",
      "SKILLS TAB: lists active abilities and passive perks. Each skill card shows type (active/passive), level, and description. Use the Add to Quick Bag button to make a skill reachable from the HUD ring without opening Inventory.",
      "KITCHEN TAB: recipe-based food crafting. Select a dish or recipe, add ingredient items from your bag, and Generate to let the AI produce the cooked result with nutritional tags.",
      "ALCHEMY TAB: potion and consumable crafting. Combine reagents, set potency and batch size, and Generate to produce tinctures, brews, or elixirs with system-tagged stat effects.",
      "FORGE TAB: weapon and armor smithing. Select a base item type, add material components, choose quality tier, and Generate to produce smithed gear with slot assignments and mods.",
      "ENCHANT TAB: add magical properties to existing equipped or bag items. Select the target item, pick or describe the enchantment effect, and Apply to modify the item's description and statusEffects array.",
      "CREATE / STATION TAB: freeform creation. Describe any item, vehicle, construct, asset, or object in the text box. Set rarity, type tags, and slot category. Generate sends the description to the AI which returns a fully structured item record and adds it to your bag.",
      "ASSETS TAB: high-value or bulk property (ships, buildings, land plots, accounts, vehicles). Assets do not take up normal item slots. Manage, trade, or use them from this panel.",
      "LIFE TRACKERS: custom needs bars (hunger, stamina, stress, reputation, sanity, etc.). Create trackers here, set max values and decay rates, and they appear on the Stats screen and in the HUD chip area.",
      "FILTER AND SORT bar at the top of Items: filter by type (weapon, armor, consumable, quest item, etc.) or rarity; sort by name, date acquired, or rarity."
    ]
  },
  {
    id: "guide-stats",
    group: "Character",
    title: "Stats and Character Sheet",
    summary: "Vitals, attributes, portrait, progression, rebirth, and class tools.",
    steps: [
      "VITALS PANEL: HP (health), AP (action points), MP (mana/energy), XP (experience). Each bar has a current / max display. Click the edit icon to manually set a value.",
      "ATTRIBUTES GRID: strength, dexterity, constitution, intelligence, wisdom, charisma, and any custom attributes defined during setup or modified by equipment and skills.",
      "PORTRAIT: click the portrait area to upload a new image or generate one from your character description using the configured image provider.",
      "CLASS RESET BUTTON: opens the class rebuild modal. Choose a new job class, review stat and skill changes, and confirm to apply. This can reset progression assumptions — save first.",
      "REBIRTH: a deep progression reshape that may preserve legacy bonuses while changing the character arc. Compare the listed paths before confirming — this is a long-term build decision.",
      "REBIRTH MEDALLION: spends a single earned rebirth reward. Read the stat impact and effect description before selecting.",
      "EDIT CONTROLS: small pencil icons next to each stat let you override values manually when AI narration produces an unexpected number or when you want to correct an error.",
      "CUSTOM TRACKERS from Inventory → Life Trackers appear in the vitals panel as extra bars under HP/MP/AP."
    ]
  },
  {
    id: "guide-party",
    group: "Character",
    title: "Party — Full Reference",
    summary: "Companion roster, member sheets, tactics, formation, shared inventory, and NPC management.",
    steps: [
      "ROSTER TAB: lists all party members. ADD button opens the NPC card picker or lets you create a new companion from scratch. Each member card has: Edit (open full sheet), Remove (dismiss from party), Activate/Deactivate (toggle combat and activity participation).",
      "MEMBER VIEW: selecting a party member opens their full sheet with tabs for Vitals (HP/MP/AP), Biography (backstory, goals, personality), Trackers (custom need bars), Equipment (their gear slots), Skills (their ability list), and Notes (freeform text).",
      "TACTICS TAB: set party-level strategy for combat and activities. Options include Aggressive, Defensive, Balanced, Support-First, and Custom. Protect Target selects a priority member the AI will have companions shield. Focus Target selects a priority enemy.",
      "FORMATION TAB: drag member portraits into Front Lane, Middle Lane, or Back Lane. Lane position can affect which enemies they are targeted by and which they can reach in combat.",
      "SHARED INVENTORY TAB: a separate item bag for the group (rations, camp supplies, shared currency, group quest items). Clicking Move To Personal transfers an item from group bag to your solo bag.",
      "IMPORT FROM CHARACTERS: the party roster has an Import button that pulls from the Characters library so established NPCs join with their full card data intact.",
      "NPC MANAGEMENT MODAL: opened from certain party and social contexts. Allows editing NPC disposition, affinity scores, relationship flags, and memory notes in detail."
    ]
  },
  {
    id: "guide-social",
    group: "Character",
    title: "Social — Relationships and Memory",
    summary: "Known NPCs, affinity tracking, disposition, contacts, social events, and memory notes.",
    steps: [
      "SOCIAL CARDS: each NPC the system has detected or you have manually added has a card showing: name, portrait thumbnail, affinity score (−100 to +100), current mood/disposition, last-seen location, and relationship tag (friend, enemy, rival, romantic, neutral).",
      "AFFINITY SCORE: changes automatically based on narrated events (gifts +, insults −, betrayal −−). You can manually edit the score by clicking the number on the card.",
      "MANUAL ADD: creates an NPC card when the auto-scanner has not yet detected the person. Fill in name, role, and any notes about them.",
      "MEMORY NOTES: each card has a notes area for promises, shared secrets, grudges, or important events. The AI uses these notes in future dialogue generation.",
      "SOCIAL EVENTS LOG: a chronological list of story-detected social interactions (arguments, gifts, shared meals, betrayals). Helps you audit what the AI remembers about each relationship.",
      "CONTACT LINK: for NPCs who are also phone contacts, a link icon appears on the card to open their phone contact entry.",
      "TAGS: apply relationship tags (Trusted, Suspicious, Romantic, Enemy, Ally, Informant) to help filter and organize long NPC lists."
    ]
  },
  {
    id: "guide-persona",
    group: "Character",
    title: "Persona and Characters Library",
    summary: "Manage your player identity and the reusable NPC / cast card library.",
    steps: [
      "PERSONA: the active player identity used by the story engine. Persona controls the name, description, portrait, pronouns, and narrative voice that appears in generated scenes.",
      "Multiple personas can be saved and swapped. Circular portrait thumbnails in the persona list identify each entry. Duplicate with the copy icon to create a variant without losing the original.",
      "PERSONA FIELDS: Name, Role/Title, Description (visible to AI narrator), Background (private lore), Portrait URL or upload, and Freeform Notes for anything else the narrator should know.",
      "CHARACTERS LIBRARY: a separate panel that stores reusable NPC and cast cards that can be imported into any new game run. These are not active participants until imported.",
      "CHARACTER CARD FIELDS: Name, Role, Portrait, Personality, Goals, Appearance, Voice/Speech style, and Relationship Notes. These fields populate the AI's character context when the card is active.",
      "IMPORT INTO PARTY: from the Characters library, click Import on any card to add them as a party member or active NPC in the current run.",
      "CARD PICKER: a gallery modal that appears during New Game setup or party management, showing all saved character cards as visual tiles for quick selection."
    ]
  },

  // ─── STORY ──────────────────────────────────────────────────────────────────
  {
    id: "guide-journal",
    group: "Story",
    title: "Journal — Quests and Codex",
    summary: "Active quests, objectives, Codex entries, plot threads, and progress notes.",
    steps: [
      "QUESTS PANEL: add quests with title, description, type (Main / Side / Personal / Faction), and status (Active / Completed / Failed). Active quests appear in the AI story context so the narrator tracks their progress.",
      "OBJECTIVES: each quest can have sub-objectives. Check them off as they are completed. The AI scanner can automatically detect completions during narration.",
      "CODEX TAB: structured lore entries for monsters, legends, important people, notable places, and stable setting facts. Different from Databank (which is for discovered in-play facts) — Codex is for reference material.",
      "PLOT THREADS: freeform notes for story arcs that do not yet have quest status but should not be forgotten.",
      "MARK FAILED: failed quests move to a separate Failed list so the Active view stays focused on current goals.",
      "GENERATE QUEST button (inside Journal): describe a scenario and the AI generates a structured quest with title, objectives, and suggested rewards.",
      "JOURNAL vs DIARY: Journal is for goals and tasks the AI narrator should track. Diary is for private reflection — the narrator does not read Diary entries by default."
    ]
  },
  {
    id: "guide-diary",
    group: "Story",
    title: "Diary — Private Entries",
    summary: "Personal logs, memories, photos, stickers, and private roleplay notes.",
    steps: [
      "DIARY ENTRIES: write daily reflections, emotional beats, secret plans, in-character thoughts, or private scene summaries.",
      "IMAGE ATTACHMENTS: attach a generated or uploaded image to any diary entry to mark the scene visually.",
      "STICKERS: apply emoji or icon stickers to entries to quickly tag tone (happy, danger, mystery, romance, etc.).",
      "ENTRY DATES: diary entries are stamped with in-world calendar date and real timestamp. Scroll the sidebar to browse history by date.",
      "DIARY IS PRIVATE: entries are not included in the AI narrator's prompt context by default. Use Journal for any notes the story engine should act on.",
      "EXPORT: diary entries can be exported as a plain text or HTML file from the System tab.",
      "DELETE or EDIT: click the pencil icon on any entry to edit it, or the trash icon to remove it permanently."
    ]
  },
  {
    id: "guide-map",
    group: "Story",
    title: "Map and Travel — Full Reference",
    summary: "Room nodes, region maps, transit, route discovery, manual cartography, and image generation.",
    steps: [
      "MAP VIEW: shows known locations as connected nodes. Click a node to see its description, connections, and action buttons. Nodes can be rooms, buildings, districts, regions, or world areas depending on scale.",
      "TRAVEL: select a destination node and click Travel. If a route is direct, the narration describes the journey. Long routes may trigger transit or time advancement.",
      "DISCOVER ROUTES: the system scans narration for place names and travel descriptions and auto-adds links to the map. You can also click Add Route manually and describe the path.",
      "EDIT ROOM button (on any node): opens the room editor for the selected location. Change name, description, environment type, custom prompt, hotspot slots, and art generation settings.",
      "HOTSPOT SLOTS: each room can have multiple interactive hotspot objects (a bookshelf, a door, a treasure chest). In Edit Room, add a slot, set its label and position (x/y grid), and define its action or description.",
      "GENERATE ROOM ART: on any node, click Generate Art to create a background image using your configured image provider. The prompt is auto-built from the room description, environment type, and hotspot list.",
      "MANUAL CARTOGRAPHY: click New Location to create a place the story has not yet described. Set the name, environment (interior / urban / wild / aquatic / subterranean / vehicle), and description, then link it to an existing node.",
      "TRANSIT HUB: for large-scale travel (trains, airports, ferries, buses, subways). Open Transit from the Map or Command Deck → Story → Map → Transit. Choose a departure and destination stop, select transport mode, and confirm departure.",
      "MAP SCALE: zoom in/out to toggle between room-level, district-level, and world-level map views. Nodes re-organize at each scale.",
      "REGION GROUPS: nodes can be assigned to named regions. The region tab filters the map to show only nodes within a selected territory.",
      "CUSTOM CSS for rooms: advanced users can add room-specific CSS overrides in the Edit Room panel to change visual presentation without modifying the engine's base styles."
    ]
  },
  {
    id: "guide-organizations",
    group: "Story",
    title: "Organizations / Factions",
    summary: "Faction sheets, membership, rank, relations, territory, and political events.",
    steps: [
      "FACTION CARDS: each organization has a card showing name, type (guild, government, cult, army, company, etc.), alignment, and your current standing.",
      "STANDING / RANK: your reputation with each faction is tracked as a numeric score. High standing unlocks rank titles and services; low standing triggers hostility events.",
      "MEMBERSHIP: mark yourself as a member or mark NPCs as affiliates. Membership affects what missions are offered and which locations are accessible.",
      "RELATIONS MATRIX: shows faction-to-faction relationship scores. An enemy faction of your ally will treat you as suspicious by default.",
      "TERRITORY: assign map nodes to a faction's territory. This affects patrol NPCs, local laws, and ambient world events generated in that region.",
      "POLITICAL EVENTS: faction-level events (elections, coup, war declaration, alliance) are generated or manually triggered and affect faction stats and player standing.",
      "GENERATE FACTION: describe a group (e.g. 'a rogue alchemist guild') and click Generate to have the AI produce a full faction entry with name, goals, ranks, and starting relations."
    ]
  },
  {
    id: "guide-activities",
    group: "Story",
    title: "Activities — Downtime and Routines",
    summary: "Structured time-passing tasks: training, jobs, study, crafting, rest, and party work.",
    steps: [
      "START AN ACTIVITY: select an activity type (Train, Work, Study, Rest, Craft, Explore, Socialize, Custom) and a duration (hours or days).",
      "ACTIVITY OUTCOME: the AI generates a result based on your stats, skills, and the chosen activity. Training may improve an attribute; working may earn currency; resting may restore HP or reduce stress.",
      "PARTY ACTIVITIES: assign each party member to their own activity for the time period. A companion on Training may level a skill; one on Work may earn shared income.",
      "CUSTOM ACTIVITIES: type any description for an activity not in the preset list. The AI interprets the task and produces an appropriate result.",
      "TIME ADVANCEMENT: activities advance in-game time. Short activities advance minutes to hours; long activities advance days. Calendar and schedule updates happen automatically.",
      "REWARD CUSTOMIZATION: if you want to specify a particular reward (a skill upgrade, a specific item, a contact introduced), add it to the custom description and the AI will include it.",
      "QUICK REPEAT: after completing an activity, the Repeat button re-runs the same task without re-filling the form."
    ]
  },
  {
    id: "guide-battle",
    group: "Story",
    title: "Battle — Combat System",
    summary: "Turn order, targeting, action decks, party tactics, status effects, and combat end.",
    steps: [
      "OPEN BATTLE: click Battle in the Command Deck → Story section. The combat panel appears with combatant list, turn tracker, action buttons, and target selector.",
      "COMBATANTS: your character and active party members appear on the ally side. Enemy combatants are added by the AI from narration context or can be added manually via the Add Enemy button.",
      "TURN ORDER: displayed as a queue at the top. Order is determined by speed stats and any initiative modifiers from skills or equipment.",
      "ACTIONS: on your turn, choose from the action buttons: Attack, Skill, Item, Defend, Flee, Custom. Selecting Skill opens your skill list; selecting Item opens consumables from your bag.",
      "TARGETING: after selecting an action, click the target combatant from the enemy list. Multi-target skills will auto-select all valid targets based on skill tags.",
      "PARTY AI TURNS: companions take their turns based on the Tactics setting (Aggressive, Defensive, Support-First). You can override any companion's action by clicking their turn slot before it resolves.",
      "STATUS EFFECTS: applied effects appear as badges under each combatant. Poison, burn, stun, bleed, buff, and debuff effects tick each round. Click an effect badge to inspect its remaining duration.",
      "FORMATION in battle: front-lane characters are primary attack and defense targets; back-lane characters are protected and can use ranged attacks or support skills.",
      "END COMBAT: click End Battle when the fight is resolved. The engine clears combat state and resumes normal narration. Any HP changes, item uses, or deaths are committed to game state.",
      "FLEE: selecting Flee rolls your Dexterity / speed against enemy pursuit. Success ends the battle; failure costs AP and potentially triggers a pursuit event.",
      "AUTO-BATTLE toggle: enables the AI to resolve an entire combat automatically with narrated outcome, skipping manual turns."
    ]
  },
  {
    id: "guide-cutscenes",
    group: "Story",
    title: "Cutscenes",
    summary: "Cinematic narrative sequences — sprites, lighting, timing, and skip controls.",
    steps: [
      "Cutscenes trigger automatically when key story events or location transitions are detected by the AI engine.",
      "During a cutscene, VN-style sprites appear on screen, ambient lighting changes to match the scene mood, and narrative text is displayed in timed beats.",
      "A progress bar at the bottom shows the timing of the active cinematic beat. The bar fills until the next beat begins.",
      "SKIP BUTTON (bottom-right): exits the cutscene immediately and returns to interactive gameplay without losing the state change the cutscene was marking.",
      "Cutscene triggers can also be set manually from the Map or Journal panels for scripted events you have planned.",
      "Sprite expressions during cutscenes are driven by the VN character engine — expressions change based on detected emotional keywords in the narration."
    ]
  },
  {
    id: "guide-minigames",
    group: "Story",
    title: "Minigames and Hacks",
    summary: "AI-driven interactive DOM overlays for lockpicking, hacking, timed tasks, and special challenges.",
    steps: [
      "Minigames trigger when a scene calls for a specialized skill challenge: lockpicking, hacking, wire-cutting, safe-cracking, decoding, etc.",
      "Each minigame is a fully dynamic CSS/HTML overlay built either procedurally or from AI narrative context — no two are identical.",
      "Time-limit gauges appear for timed challenges (e.g., cutting a wire on a countdown). Watch the gauge and click or interact before it expires.",
      "Success or failure is detected automatically and fed back into the story narration and state.",
      "ABORT BUTTON: exits the minigame cleanly without a pass or fail. The narration will note the abandoned attempt.",
      "Minigame difficulty scales with your relevant skill level and any equipment bonuses. High Dexterity or Hacking skill narrows tolerances or slows timers.",
      "Some minigames are multi-stage — completing stage 1 unlocks stage 2 with a harder challenge."
    ]
  },

  // ─── WORLD ──────────────────────────────────────────────────────────────────
  {
    id: "guide-phone",
    group: "World",
    title: "Phone — In-World Apps",
    summary: "Messages, calls, contacts, browser, banking, transit, and in-world documents.",
    steps: [
      "MESSAGES APP: sends and receives text messages from NPCs. Messages are AI-generated based on NPC personality and relationship. Tap a contact to open their thread.",
      "CALLS APP: place in-world phone calls. The AI narrates the conversation. Incoming calls from NPCs can be enabled or disabled per contact in Contacts.",
      "CONTACTS APP: stores NPC phone numbers, email addresses, and relationship tags. Add manually or import from Social. Contacts here link back to Social cards.",
      "BROWSER APP: a styled in-world internet browser. Visit generated news sites, social media feeds, shop listings, or reference pages that exist in the game world.",
      "BANKING APP: in-world bank account view. Shows balance, recent transactions, transfer options, and loan status if economy is active.",
      "TRANSIT APP: lists nearby transit stops and schedules. Links to the Transit Hub for large-scale travel bookings.",
      "BOOKS APP: stores generated in-world documents — books, tomes, manuals, newspapers, letters — found during play. Different from Help / Manual which is the system reference.",
      "STORAGE APP: a cloud-storage metaphor for digital assets (files, data, plans, schematics, codes) your character has collected.",
      "PHONE SETTINGS APP: change phone theme (colors, wallpaper), set a PIN, customize message bubble colors, and toggle incoming call and text notifications.",
      "CALCULATOR, CLOCK, MAP MINI-APPS: small utility tools that mirror real-world phone functions inside the game world."
    ]
  },
  {
    id: "guide-databank",
    group: "World",
    title: "Databank — Structured Facts",
    summary: "Organize discovered world facts, memories, and reference records for AI retrieval.",
    steps: [
      "DATABANK PURPOSE: stores facts you want the AI to remember as organized, retrievable records — different from the story chat log which the AI reads sequentially.",
      "ENTRY TYPES: Person, Place, Event, Rule, Object, Faction, Other. Type tags help the AI prioritize which records to load for a given scene.",
      "CREATING ENTRIES: click Add Entry, choose a type, enter a title (key), and write the fact in concise, declarative language. 'The docks open at 6am and close at 10pm' is better than 'The docks have varied hours'.",
      "SCANNING: the Scan button reads recent narration and extracts candidate facts to add as new Databank entries. Review and approve or discard before they are committed.",
      "SEARCH: type any keyword to filter Databank entries by title or content. Useful for auditing what the AI knows about a specific topic.",
      "EDIT / DELETE: click the pencil or trash icons on any entry card to update it or remove an outdated fact.",
      "DATABANK vs LOREBOOK: Databank is for in-run discoveries. Lorebook is for pre-planned setting canon that travels between games.",
      "DATABANK vs CODEX: Codex (inside Journal) is for named lore entities (monsters, legends, key people). Databank is for rules, facts, and discovered truths."
    ]
  },
  {
    id: "guide-lorebook",
    group: "World",
    title: "Lorebooks — Setting Canon",
    summary: "Pre-planned world rules, faction histories, geography, species, and reusable campaign material.",
    steps: [
      "LOREBOOKS store facts that should persist across multiple sessions and new games — world building canon, not in-run discoveries.",
      "ENTRIES: one entry per distinct fact, rule, place, species, faction, era, or historical event. Short focused entries retrieve better than long multi-topic blocks.",
      "ACTIVE / INACTIVE: lorebook entries can be marked active or inactive. Only active entries are included in the AI context. Deactivate entries for locations you have not reached yet.",
      "SELECT DURING NEW GAME: at New Game setup, a lorebook picker lets you choose which saved lorebooks to attach to that run. Only attach what is relevant.",
      "IMPORT / EXPORT: lorebooks can be exported as JSON and imported on another machine or shared with other players.",
      "LOREBOOK vs DATABANK: Lorebook is for planned setting facts you authored. Databank is for facts discovered during play.",
      "TRIGGER KEYS: each entry can have trigger keywords. When those words appear in narration, the entry is automatically injected into context."
    ]
  },
  {
    id: "guide-you-world",
    group: "World",
    title: "You, World Simulation, and Social Chronicle",
    summary: "Read the player dossier, refresh living-world state, and inspect tracked character history.",
    steps: [
      "YOU is a read-focused player dossier with identity, status effects, stats, and lineage. Edit source data in Persona, Stats, Inventory, or Social, then Refresh the dossier.",
      "WORLD SIMULATION displays current campaign and living-world people, places, events, and messages. Scan / Update State refreshes it from local state and the backend when available.",
      "PROJECT changes the target location or dimension and can synthesize a matching environment/backdrop. Use it only when the active location should change.",
      "SOCIAL CHRONICLE / TRACKER is a known-character dossier with relationship context and a genealogical family-tree view.",
      "These screens share campaign records; they are not separate saves. Correct a fact in the system that owns it, such as Social, Party, Databank, Schedules, or Organizations."
    ]
  },
  {
    id: "guide-chatbox",
    group: "Story",
    title: "Chatbox and Story Input",
    summary: "Use the compact transcript/composer and understand how it shares the active story session.",
    steps: [
      "CHATBOX is an alternate compact view of the current transcript and story composer.",
      "The main composer and Chatbox submit to the same active session. Do not submit twice while a generation is running.",
      "Inventory and Map buttons are shortcuts to shared campaign systems; opening them does not create a second copy of state.",
      "CHATBOX OPTIONS configures character chat boxes and launcher/gear presentation. VN Settings separately controls pagination, typewriter speed, and auto advance.",
      "Stop an active generation before switching providers, loading a save, importing data, or replacing campaign state."
    ]
  },
  {
    id: "guide-shop-trade",
    group: "RPG",
    title: "Shop, Trade, and Economy",
    summary: "Generate merchant stock, buy items, and exchange goods or currency with campaign characters.",
    steps: [
      "ENTERING A SHOP: travel into a location whose name, type, tags, or description identifies a store, market, merchant, cafe, pharmacy, smithy, bookstore, restaurant, retail space, or other place that sells goods. The Shop opens automatically.",
      "SHOPKEEPERS ARE PEOPLE: first entry creates a persistent, location-specific shopkeeper with a full Character Card, NPC Management options, schedule, drives, private data, and a Social associate record. Social is where the player uncovers the public-facing profile; secrets remain concealed and editable in NPC Management.",
      "CONTEXT STOCK: each shop keeps its own catalog. The engine uses location description/type, lore keys, recent story, merchant specialty, and an optional customer request. If a model is unavailable, a deterministic local catalog keeps the shop usable.",
      "BUY MODE: search the catalog and inspect rarity, category, price, and remaining stock. Buy deducts campaign currency, adds one normalized inventory item, and reduces that shop's stock.",
      "SELL MODE: lists eligible carried items and pays a conservative resale value for one unit at a time. Currency and inventory update only when Sell is pressed.",
      "RESTOCK: type a request such as remedies, travel gear, or rare books, then Restock. A context-capable model can produce tailored goods; local specialty stock is the fallback.",
      "LEAVING: moving to a non-commercial location closes the Shop. Returning reopens the same location-owned merchant and catalog with a returning-customer greeting.",
      "TRADE starts by choosing a campaign character. Build your offer from gold, item, and quantity, then select what you request from them.",
      "Review offer value, flags, and status. Accept commits both sides; Clear discards only the draft.",
      "Prices can reflect currency settings, value/rarity, merchant context, reputation, and economy rules. Banking, loans, bills, taxes, and fares remain connected systems."
    ]
  },
  {
    id: "guide-player-home",
    group: "RPG",
    title: "Player Home and Doorbell",
    summary: "Use owned residences as living hubs and handle deterministic NPC visits at the door.",
    steps: [
      "HOME RECOGNITION: entering the registered primary home, a matching owned residence asset, or a map node explicitly marked as the player's home opens the Home hub. A generic house, hotel, or another NPC's residence does not qualify.",
      "SHARED SYSTEMS: Kitchen, Storage, Wardrobe, Rest & Activities, Property, Social, Map, and the phone Homestead Manager open their existing campaign tools. The Home hub does not create duplicate inventories, bills, or activity state.",
      "DOORBELL LOGIC: eligible known NPCs can visit according to deterministic saved-state logic using the home, day/time bucket, visit count, NPC availability, and cooldown. Doorbell visits never require an AI provider.",
      "ANSWER reveals and acknowledges the visitor without moving them inside. LET IN moves the NPC into the current scene. TURN AWAY and IGNORE resolve the visit without adding them to the scene.",
      "Events can also trigger a specific visitor with the uie:doorbell event or UIE_ringDoorbell(visitorId). This keeps quests and authored systems in control without generated dialogue.",
      "PRIMARY HOME remains managed from Map and the phone Homestead app. That system owns return anchors, upgrades, rent/property tax, utilities, insurance, and bills; the in-world Home hub reflects it."
    ]
  },
  {
    id: "guide-schedules",
    group: "World",
    title: "Character Schedules",
    summary: "Understand recurring NPC routines and how they differ from Calendar events and Activities.",
    steps: [
      "SCHEDULES displays recurring character routines against the current game clock and summarizes each character's expected activity.",
      "Fixed routines are strict, Flexible routines may deviate, and Dynamic routines can react to world events.",
      "Edit schedule data from the relevant character/NPC workflow, including place, time, recurrence, priority, and notes where available.",
      "Calendar stores dated events and reminders. Activities advances time for chosen tasks. Schedules describes recurring NPC behavior.",
      "Time, access rules, travel, conflicts, and world events can make a character deviate from the displayed plan."
    ]
  },
  {
    id: "guide-mmo",
    group: "World",
    title: "Simulated Server Chat and LFG",
    summary: "Use in-world MMO-style chatter and party listings without confusing them for real online services.",
    steps: [
      "SERVER CHAT simulates Global, Trade, LFG, and Local channels. Messages and generated pulses stay inside the campaign and never contact real users.",
      "Write a message manually, use the bolt for a generated flavor pulse, toggle AI flavor, or Pause live pulses.",
      "LFG shows simulated group listings and filters them by role. Refresh produces an updated board snapshot.",
      "YOUR POST takes an activity/dungeon, desired role, and note, then adds the request to the campaign's board.",
      "Use Party, Trade, or Activities for actual state changes after an in-world listing leads to a decision."
    ]
  },
  {
    id: "guide-archive-access",
    group: "World",
    title: "Archive, Focused DOMs, Credentials, and Access Tools",
    summary: "Read generated documents and understand dedicated workspaces, access records, and challenge tools.",
    steps: [
      "ARCHIVE stores generated in-world books and documents. It is separate from reusable character cards, Journal Codex entries, Databank facts, and Lorebook canon.",
      "FOCUSED DOMS are task/dossier workspaces generated for prioritized locations or roles. Open Map > Focus, choose a dossier, and use its local controls.",
      "Credentials can represent keys, passes, IDs, licenses, memberships, tickets, magical seals, or digital records. Relevant workflows can issue, inspect, use, copy, revoke, or destroy them.",
      "Doors, containers, obstacles, and hotspots can check credentials, tools, schedules, reputation, quests, party state, and world conditions.",
      "When direct access fails, contextual tools may open deterministic timing, sequence, lock, hacking, treatment, repair, fishing, scanning, or obstacle challenges."
    ]
  },
  {
    id: "guide-calendar",
    group: "World",
    title: "Calendar and Schedules",
    summary: "In-world time, day/night cycle, birthdays, appointments, and NPC routines.",
    steps: [
      "CALENDAR VIEW: shows the current in-world date on a month grid. Click any day to add an event, appointment, holiday, or deadline.",
      "TIME ADVANCEMENT: time advances through roleplay events, activities, travel, and combat. Manual time advancement is available via the clock HUD chip or Calendar controls.",
      "CUSTOM CALENDARS: you can rename months, days, and era names for non-Earth settings. Settings → RPG & Economy → Calendar Rules.",
      "BIRTHDAYS AND ANNIVERSARIES: flag calendar entries as recurring annual events. The AI uses these to generate greetings, gift opportunities, and NPC reactions.",
      "SCHEDULES: NPC daily schedules define where they are and what they are doing at each hour. Set schedules in the NPC sheet's Schedule tab or in the Calendar → Schedules panel.",
      "SCHEDULE TYPES: Fixed (NPC is always at a specific place at a specific time), Flexible (NPC generally follows a pattern but can deviate), Dynamic (AI-determined based on world events).",
      "DAY/NIGHT CYCLE: certain map nodes, NPCs, and events are time-locked (open only during business hours, hostile only at night, available only on weekends). Calendar state drives these locks."
    ]
  },
  {
    id: "guide-atmosphere",
    group: "World",
    title: "Atmosphere — Weather, Filters, and Lighting",
    summary: "Scene presentation, weather, time-of-day visual filters, flashlight, and mood tools.",
    steps: [
      "WEATHER CONTROLS: set current weather (clear, overcast, rain, storm, fog, snow, haze, sandstorm, blizzard). Weather affects AI narration tone and ambient audio cues.",
      "TIME-OF-DAY FILTER: dawn, morning, noon, afternoon, dusk, evening, night, deep night. Applies a color overlay and lighting shift to the background scene.",
      "VISUAL FILTERS: cinematic, sepia, grayscale, high contrast, noir, vivid — apply artistic post-processing overlays to the scene without changing the underlying art.",
      "FLASHLIGHT EFFECT: activates a spotlight/torch cone overlay for dark scenes. Useful for dungeon corridors, night exploration, or horror encounters.",
      "MOOD PRESETS: quick preset buttons for common scene moods — Tense, Romantic, Mysterious, Joyful, Bleak, Epic. Each applies a combined weather + filter + lighting combination.",
      "CUSTOM PROMPT INJECTION: add custom atmosphere text that gets appended to image generation prompts for the current location.",
      "ATMOSPHERE IS PRESENTATIONAL: changing weather or filter here does not change the in-world calendar time or location. Use Calendar and Map for authoritative state changes."
    ]
  },
  {
    id: "guide-room-editing",
    group: "World",
    title: "Room Editing and Hotspots",
    summary: "Add interactive objects, set coordinates, define actions, and tune room art generation.",
    steps: [
      "OPEN EDIT ROOM from the Map panel on any selected node, or from the Atmosphere panel's room-specific tools.",
      "ROOM FIELDS: Name, Description (used in AI narration and image generation), Environment Type (interior / urban / wild / aquatic / subterranean / vehicle), and Custom Prompt (appended to image generation only).",
      "HOTSPOT SLOTS: interactive objects placed in the room scene. Each slot has: Label (display name), Position (x/y as 0–1 fractions of the scene, e.g. x=0.5 y=0.3 is center-upper), Size (width/height fractions), and Action (what clicking it does).",
      "HOTSPOT ACTIONS: Link (navigate to another node), Inspect (show description popup), Custom Script (trigger a named game event), Generate (ask AI to describe the object on first inspection).",
      "GENERATE ART button: builds a background image prompt from room description + environment type + hotspot layout and sends it to your image provider. Result is saved and displayed as the room background.",
      "CUSTOM CSS: advanced panel in Edit Room for writing CSS that applies only to this room's display layer. Useful for unique visual styles without touching engine CSS.",
      "SYSTEM PROMPT OVERRIDE: replace the default narration context for this specific room. The override is prepended to every story generation while the player is in this room.",
      "SAVE: changes to room data are saved locally and persist across sessions. Art must be regenerated after significant description changes."
    ]
  },

  // ─── SYSTEM ─────────────────────────────────────────────────────────────────
  {
    id: "guide-settings-main-api",
    group: "System",
    title: "Settings — Main API (Text Generation)",
    summary: "Connect your AI storyteller: providers, models, keys, parameters, and multi-profile support.",
    steps: [
      "MAIN API TAB is the first settings tab. It controls the AI model that writes story, dialogue, item descriptions, and all generated text.",
      "PROFILES: create multiple named connection profiles (e.g., 'OpenRouter Free', 'Claude Sonnet', 'Local Ollama'). Switch between them from the Saved Profiles dropdown.",
      "ROUTE TYPE: Chat Completion (standard chat/messages endpoint), Text Completion (instruct/completion endpoint), Local model server, or AI Horde (distributed compute).",
      "PROVIDERS supported: OpenRouter, OpenAI, Anthropic, Google Gemini, DeepSeek, Groq, Together AI, Fireworks AI, Cohere, Mistral, xAI, Perplexity, NVIDIA NIM, NanoGPT, HuggingFace, Replicate, Anyscale, Cloudflare Workers AI, Cerebras, SambaNova, AI Horde, Azure OpenAI, AWS Bedrock (gateway), Vertex AI (gateway), generic OpenAI-compatible, Ollama (local), LM Studio (local), KoboldCpp (local), Text Generation WebUI (local), vLLM (local), LocalAI (local), llama.cpp server (local), Jan API (local), Custom.",
      "API URL: the base endpoint URL for your chosen provider. Defaults are pre-filled when you pick a provider. Override for custom endpoints or self-hosted servers.",
      "API KEY: paste your provider API key or token. Stored locally in your browser's storage — never sent to any server other than the provider.",
      "AUTO-SWITCH KEYS checkbox: if checked, the engine will automatically try the next saved key in the profile if the current key returns a 401 or 403 error.",
      "MODEL PRESET dropdown: click Refresh to fetch the model list from your provider. Pick a model or type a custom Model ID in the field below.",
      "TEMPERATURE (0–2): controls creativity / randomness. Lower = more predictable prose; higher = more creative but less coherent. 0.7–1.0 is typical for roleplay.",
      "TOP P (0–1): nucleus sampling threshold. Leave at 1.0 for most models unless you are tuning advanced behavior.",
      "TOP K: limits token candidates per step. 0 = disabled. Only available on some providers.",
      "TOP A: advanced token candidate filter. 0 = disabled. Only available on some providers.",
      "OUTPUT TOKEN LIMIT: maximum tokens per AI response. 4096 is standard; raise for longer narration, lower to save cost.",
      "CONTEXT TOKEN LIMIT: total token budget the engine can use for the full prompt. Larger = more history + more world data included.",
      "HISTORY WINDOW: how many recent chat messages to include in the AI context. More history = more coherent but costs more tokens.",
      "PROMPT PRESET: optional short instruction line prepended to every prompt (e.g., 'Concise roleplay prose, grounded actions.').",
      "ENDPOINT SHAPE: auto-detect or manually set the request format. Options: Chat Completions, Text Completions, OpenAI Responses, Anthropic Messages, Custom/OpenAI-compatible.",
      "Test Connection button: sends a minimal ping to verify the API responds correctly before generating.",
      "SAVE & APPLY: always save before leaving the tab. Profile saves are per-profile — switching profiles loads that profile's saved values."
    ]
  },
  {
    id: "guide-settings-turbo",
    group: "System",
    title: "Settings — Turbo API",
    summary: "A second, faster AI model for quick tasks like item scans, NPC tags, and state summaries.",
    steps: [
      "TURBO API TAB is the second settings tab. Turbo is a secondary AI model used for fast, lightweight tasks that do not need the full main model.",
      "Turbo tasks include: item description generation, NPC tag scanning, state summary condensing, quick fact extraction, and short utility prompts.",
      "TURBO PROVIDER: same provider list as Main API. It is common to use a smaller/faster model here (e.g., GPT-4o-mini or a free OpenRouter model) while using a larger model for Main.",
      "TURBO API URL and KEY: can match Main API or point to a completely different service.",
      "TURBO MODEL: pick or type the model ID for the turbo service. Refresh loads the model list from the Turbo provider.",
      "TEMPERATURE / PARAMS: Turbo has its own temperature and token settings, typically set lower (0.4–0.6) for consistent, factual short outputs.",
      "TEST TURBO CONNECTION: button at the bottom of the Turbo panel. Sends a test request to verify the Turbo endpoint.",
      "If Turbo is not configured, the engine falls back to Main API for all requests (slower, costs more tokens per session)."
    ]
  },
  {
    id: "guide-settings-image",
    group: "System",
    title: "Settings — Image Generation",
    summary: "All image providers, model options, quality controls, and local generation setup.",
    steps: [
      "IMAGE GENERATION TAB is the third settings tab. All background art, portraits, and visual generation routes through the selected provider here.",
      "IMAGE PROVIDERS — Local Download: Koji (optional ~2.5 GB download, runs fully offline on your machine — images generate instantly once downloaded).",
      "IMAGE PROVIDERS — Cloud APIs: OpenAI (DALL·E / Images API), Stability AI (v2beta: Core / SD3 / Ultra engines), Black Forest Labs / FLUX, Google Imagen / Gemini Image, Pollinations (free tier available), ImageRouter.io, LMRouter Images, AI/ARouter Images, NanoGPT Image API, OpenRouter, Together AI, FAL.AI, Hugging Face.",
      "IMAGE PROVIDERS — Local Services: ComfyUI, AUTOMATIC1111 / SD WebUI, SD.Next, Stable Horde (distributed).",
      "IMAGE PROVIDERS — Other: Custom (OpenAI-style POST endpoint).",
      "DEFAULT IMAGE ACCENT: a color picker that sets the accent color overlaid or blended into generated images for visual consistency with your UI theme.",
      "GENERIC (OpenAI-style) SUBPANEL: API Base URL, API Key, Model ID dropdown (click Refresh to fetch from provider), and Model ID Override field for exact model strings.",
      "STABILITY AI SUBPANEL: Stability API Key, Engine selector (Core / SD3 / Ultra), and Aspect Ratio selector (16:9, 1:1, 4:3, 3:4, 9:16, and others).",
      "POLLINATIONS SUBPANEL: optional API key/token, and Pollinations model selector (Flux, Turbo, etc.).",
      "KOJI (LOCAL) SUBPANEL: Check Status button (verifies if model is downloaded), Download Model button (~2.5 GB, one-time), Delete Model button, and progress bar during download. Also installable during first-run setup.",
      "COMFYUI SUBPANEL: URL preset selector (localhost, RunPod, Vast.ai), ComfyUI Base URL field (default: http://127.0.0.1:8188), API Key field (for cloud-hosted instances), Detect & Fill Dropdowns button, Test ComfyUI button, and workflow JSON editor for custom pipelines.",
      "AUTOMATIC1111 SUBPANEL: Base URL, API Key, model/checkpoint list refresh, steps, CFG scale, and sampler settings.",
      "HORDE SUBPANEL: Stable Horde API key (or anonymous), model selection from distributed pool, and quality tier.",
      "CUSTOM SUBPANEL: full URL, HTTP method, auth header format, and a JSON body template editor for any non-standard image API."
    ]
  },
  {
    id: "guide-settings-audio",
    group: "System",
    title: "Settings — Audio and TTS",
    summary: "Music generation, ambient sound rules, TTS voice provider, and speech synthesis settings.",
    steps: [
      "AUDIO TAB is the fourth settings tab. Controls music, ambient audio, and text-to-speech (TTS) output.",
      "MUSIC PROVIDER: select your music generation or streaming service. Connect an API key if required.",
      "MUSIC RULES: define genre, instruments, energy level, and keyword triggers. The engine matches rules to the current scene type and location.",
      "AMBIENT SOUND: set ambient audio loops for environment types (forest, cave, city, dungeon, ocean, etc.). Ambient sound changes automatically when the player moves to a new environment node.",
      "TTS PROVIDER: select the voice synthesis service for Helper Pet speech and optional narration read-aloud. Options vary by installed services.",
      "TTS VOICE: pick a specific voice ID or name from the provider's voice list.",
      "TTS PITCH and SPEED: fine-tune the voice output. Helper Pet personality presets (Sarcastic, Ominous, etc.) auto-adjust pitch and speed when the pet speaks.",
      "ENABLE TTS FOR NARRATION: separate toggle to read story narration aloud vs only Helper Pet chat responses.",
      "VOICE LIBRARY PANEL: manage downloaded or saved voice profiles. Import voice packs and assign them to specific characters."
    ]
  },
  {
    id: "guide-settings-prompts",
    group: "System",
    title: "Settings — Prompts and Filters",
    summary: "Story instructions, narrator style, safety filters, and persona profile injection.",
    steps: [
      "PROMPTS AND FILTERS TAB is the fifth settings tab. Everything here shapes how the AI narrator writes.",
      "SYSTEM PROMPT: the master instruction to the AI narrator. This is prepended to every story generation request. Write your desired prose style, content rules, and narrative voice here.",
      "NARRATOR STYLE PRESETS: quick-select presets for common styles (Gritty Noir, High Fantasy Epic, Slice of Life, Horror, etc.) that fill the system prompt with a starting template.",
      "PERSONA INJECTION: toggle to include your active Persona data in every prompt so the AI always knows who the player is.",
      "WORLD CONTEXT INJECTION: toggle to include Databank and Lorebook summaries in the prompt context.",
      "SAFETY FILTER: content policy settings. Ranges from Strict (no mature content) to Off (no filtering by the engine — provider may still apply their own filters).",
      "CONTENT TAGS: whitelist or blacklist specific themes. Blacklisted themes are soft-filtered from generated output.",
      "PROFILE INJECTION: import a prompt profile file (.json) that contains a complete set of system prompt + filter + persona settings. Useful for quickly swapping between tonal profiles.",
      "EXPORT PROFILE: save your current prompt and filter setup as a .json file to share or back up.",
      "PROMPT INJECTION OVERLAY: a debug tool that shows the exact full prompt sent on the last request, including all injected context blocks."
    ]
  },
  {
    id: "guide-settings-rpg",
    group: "System",
    title: "Settings — RPG and Economy",
    summary: "Game rules, dice, stat scaling, economy rates, and calendar configuration.",
    steps: [
      "RPG AND ECONOMY TAB is the sixth settings tab. Controls the mechanical rules of the game simulation.",
      "DICE RULES: set which dice system is used for rolls (d20, percentile, d6 pool, narrative, none). The AI narrator uses these when describing success/failure of actions.",
      "STAT SCALING: define how attribute values map to roll modifiers. Default uses a D&D-style modifier table.",
      "ECONOMY: set currency names, exchange rates, starting gold/credits, inflation rate, and shop price variance.",
      "CALENDAR RULES: rename month names, day names, era/epoch name, year length, and day length. Used for all in-world time displays.",
      "WORLD SIMULATION: configure whether the world simulates NPC routines, economic ticks, faction events, and ambient world changes while the player is not watching.",
      "DEATH MECHANICS: set what happens when HP reaches 0 — options: Defeat (full combat loss), Downed (down but saveable by party), Narrative (HP is flavor, not fatal), Permadeath.",
      "XP AND LEVELING: set XP thresholds, auto-level notifications, and whether level-ups are narrative-only or trigger a full level-up modal with attribute choices."
    ]
  },
  {
    id: "guide-settings-ui",
    group: "System",
    title: "Settings — Edit UI",
    summary: "Menu visibility, layout customization, themes, and display preferences.",
    steps: [
      "EDIT UI TAB is the seventh settings tab. Customize what the interface shows and how it looks.",
      "MENU VISIBILITY: toggle individual Command Deck buttons on or off. Hide sections you never use to reduce clutter.",
      "THEME SELECTOR: choose from built-in UI themes (Dark Gold, Midnight Blue, Forest Green, Blood Red, Clean White, etc.) or create a custom theme.",
      "CUSTOM THEME: edit primary color, background color, border color, text color, and card surface color. Preview changes live before saving.",
      "FONT SETTINGS: choose the UI font family from available web fonts. Change font size scale for accessibility.",
      "LAYOUT MODE: Standard (sidebar + content), Compact (narrower panels), Wide (fills more screen), or Fullscreen.",
      "BACKGROUND OVERLAY OPACITY: how much the dimmed overlay behind modals obscures the chat scene behind it.",
      "DRAG POSITION RESET: a button to reset all saved draggable element positions (Helper Pet, hamburger button) back to their defaults.",
      "BACKUP / IMPORT / EXPORT: save your entire settings as a JSON file, import a settings backup, or reset all settings to factory defaults. Always export before experimenting with major changes."
    ]
  },
  {
    id: "guide-launcher-portability",
    group: "System",
    title: "Launcher Options, Saves, and Portable Play",
    summary: "Customize the floating launcher and avoid losing access to browser-scoped campaign data.",
    steps: [
      "LAUNCHER OPTIONS changes the floating launcher icon and manages saved custom icons. Save applies the current choice; Delete removes the selected saved icon.",
      "COMMAND DECK VISIBILITY is configured in Settings > Edit UI. Use Reset Draggable Positions there if the launcher, Helper Pet, or another movable control is off-screen.",
      "Named Save/Load slots stay in browser storage. Exported backup JSON is the portable path between origins, browsers, profiles, or devices.",
      "Browser storage belongs to the exact origin: localhost and 127.0.0.1, or different ports, do not automatically share saves.",
      "Export before changing hostname/port, clearing site data, restoring another save, importing state, or applying destructive repair/reset tools."
    ]
  },
  {
    id: "guide-debug",
    group: "System",
    title: "Debug and Diagnostics",
    summary: "Troubleshoot issues, scan state, view logs, export reports, and repair corrupted data.",
    steps: [
      "DIAGNOSTICS opens from Command Deck → System → Debug, or from the HUD API chip after a failed request.",
      "RUN DIAGNOSTICS: scans the current state object for corruption, missing required fields, circular references, and anomalous values. Produces a report with a list of issues and suggested fixes.",
      "COPY REPORT: copies the full diagnostics report to clipboard for pasting into a support thread or bug report.",
      "STATE VIEWER: shows the raw JSON of the current game state. Use search to find specific keys when troubleshooting.",
      "LOG VIEWER: shows the last N system log entries including API calls, state mutations, errors, and tutorial events.",
      "EXPORT DATA: saves the current full game state as a JSON file to your downloads folder. Do this before any risky operation.",
      "REPAIR TOOL: attempts to auto-fix known corrupted data patterns (duplicate IDs, malformed inventory entries, broken party references).",
      "CLEAR LOGS: removes cached log entries. Only do this when you no longer need troubleshooting history.",
      "RESET STATE: a destructive operation that wipes the current run state. Always export first. Requires a confirmation dialog."
    ]
  },
  {
    id: "guide-sprites",
    group: "System",
    title: "Sprites and Visuals",
    summary: "Sprite libraries, stage expressions, imports, and character visual setup.",
    steps: [
      "SPRITES panel is in the Command Deck → System section or accessible from a character's Stats/Party sheet portrait area.",
      "SPRITE LIBRARIES: named collections of image assets for a specific character. Each library contains images for different expression states (neutral, happy, sad, angry, surprised, etc.).",
      "CREATE LIBRARY: click New Library, name it (use the character's name for clarity), then add images for each expression state.",
      "IMPORT IMAGES: images can be uploaded from disk, pasted as URLs, or generated using the configured image provider with an expression prompt.",
      "EXPRESSION STATES: the stage shows the matching expression when the AI narration detects the corresponding emotional keyword. Map each expression to keywords in the library settings.",
      "ACTIVE CHARACTER: the stage shows the sprite for the currently active character or the character whose expression is detected in the latest narration beat.",
      "STAGE POSITION: choose where the sprite appears on screen (left, center, right, off-screen) and its scale.",
      "LIVE2D: if a Live2D model is configured, the Sprites panel controls its active model, idle animation, expression blend weights, and physics settings.",
      "TROUBLESHOOTING: if a sprite does not appear, check that the library name matches the character name exactly, the image path is valid, and the character is set as active."
    ]
  },
  {
    id: "guide-themes",
    group: "System",
    title: "Themes and Interface Mood",
    summary: "Switch interface themes, create custom palettes, and configure visual presentation.",
    steps: [
      "THEMES control the entire color palette and visual mood of the UI without affecting game state.",
      "Built-in themes: Dark Gold (default), Midnight Blue, Blood Red, Forest Green, Purple Void, Clean White, Cyberpunk Neon, Soft Pastel.",
      "CUSTOM THEME EDITOR: set primary accent, background, surface, border, text, and highlight colors using color pickers. Preview applies live.",
      "SAVE THEME: saved themes appear in the theme picker and can be exported as JSON to share or reuse.",
      "THEME vs ATMOSPHERE: themes change the UI chrome color. Atmosphere changes the scene visual filters and background mood. They are independent.",
      "FONT OVERRIDE: themes can include a font family override so different themes use different typefaces for a complete aesthetic shift."
    ]
  },
  {
    id: "guide-newgame",
    group: "First Steps",
    title: "New Game Setup — All Tabs",
    summary: "Complete walkthrough of the new game creation screen — every field, tab, and button.",
    steps: [
      "New Game has eleven tabs: Character, Appearance, Currency & Groups, Life Trackers, Items & Equipment, Skills, Quests, Lorebook, Assets, NPCs, and Starting Location.",
      "CHARACTER: identity, job/class, level, primary bars, base stats, scenario, and story instructions.",
      "APPEARANCE: description, portrait upload/generation, visual style, and character visual identity.",
      "CURRENCY & GROUPS: currency format, starting funds, organizations, memberships, ranks, and social-group context.",
      "LIFE TRACKERS: custom needs, conditions, meters, current/max values, colors, and automatic tracking behavior.",
      "ITEMS & EQUIPMENT: starting bag items, quantities, containers, worn equipment, slots, and metadata.",
      "SKILLS and QUESTS: starting active/passive abilities and progression data, plus initial objectives, rewards, status, and plot hooks.",
      "LOREBOOK: setting canon, trigger keys, rules, history, species, places, and factions attached to this run.",
      "ASSETS: owned property, vehicles, businesses, accounts, organizations, and other persistent resources.",
      "NPCS: create or import the starting cast, relationships, roles, schedules, and party membership.",
      "STARTING LOCATION: world/region/room names, description, coordinates, exits, environment, and opening scene setup.",
      "PRESET GALLERY button: opens a visual gallery of starter visual presets (world backgrounds, art styles, location themes) that auto-fill matching New Game fields.",
      "CHARACTER CARD PICKER button: opens the Characters library picker to quickly import established NPCs or pre-made player characters.",
      "START GAME validates the setup, installs the cast/world state, opens the first visible scene, and submits the opening story beat through Main API."
    ]
  },
  {
    id: "guide-settings",
    group: "System",
    title: "Settings — Overview",
    summary: "Quick index of all seven settings tabs and what each one controls.",
    steps: [
      "TAB 1 — MAIN API: AI storyteller model, provider, URL, key, temperature, tokens, history window, and connection profiles.",
      "TAB 2 — TURBO API: secondary fast AI model for lightweight tasks (scans, tags, summaries).",
      "TAB 3 — IMAGE GENERATION: all image providers (Koji local, OpenAI, Stability, BFL/Flux, Google, Pollinations, ComfyUI, A1111, Horde, and more), model selection, and quality controls.",
      "TAB 4 — AUDIO AND TTS: music provider, ambient rules, TTS voice provider, voice ID, pitch, speed, and narration read-aloud toggle.",
      "TAB 5 — PROMPTS AND FILTERS: system prompt, narrator style presets, safety filters, content tags, persona and world context injection, and profile import/export.",
      "TAB 6 — RPG AND ECONOMY: dice rules, stat scaling, currency, calendar, world simulation, death mechanics, and XP/leveling.",
      "TAB 7 — EDIT UI: menu visibility toggles, themes, custom colors, fonts, layout mode, background opacity, position reset, and save/load/reset controls.",
      "Use the ? circle icon (top-right of the Settings window) to jump directly to the relevant manual section for the active tab."
    ]
  },
  {
    id: "guide-media",
    group: "System",
    title: "Images, Sprites, Music, and Themes",
    summary: "Generate, organize, and apply portraits, backgrounds, sprites, music rules, and interface themes.",
    steps: [
      "IMAGE GALLERY: browse all previously generated images organized by scene key, character, or location. Click to inspect, regenerate, or download any image.",
      "REGENERATE: select any gallery image and click Regenerate to create a new version using the same prompt and provider. Useful when a result does not match expectations.",
      "ASSIGN: from the gallery, assign an image as the background for a specific room, as a character portrait, or as a sprite expression.",
      "SPRITES MANAGER: create and manage sprite libraries as described in the Sprites section. Accessed from the gallery or from character sheets.",
      "MUSIC RULES: define trigger rules for ambient music — map a genre or track type to location keywords, time of day, or scene mood tags.",
      "THEMES: the interface theme picker is in Settings → Edit UI. Built-in and custom themes control all UI colors.",
      "IMAGE PROMPT TIPS: include environment type, art style keywords (oil painting, anime, photorealistic, watercolor), lighting descriptors, and mood keywords for best results."
    ]
  },
  {
    id: "guide-modal-tutorials",
    group: "First Steps",
    title: "Modal Tutorial Reference — All Windows",
    summary: "The Helper Pet has built-in tutorial steps for every major window. Here is what each one covers.",
    steps: [
      "STARTUP MENU: explains New Game, Continue, Load Game, and Settings buttons.",
      "TUTORIAL CHOICE: explains the Start Tutorial vs Skip Tutorial prompt that appears on first New Game.",
      "NEW GAME SETUP: walks through the character name, job class, vitals, appearance, location, and Start Game button.",
      "COMMAND DECK: explains the four category groups and the most important buttons within each.",
      "UI BUTTONS: explains the HUD chips, Quick Bag, Action Wheel, and the floating launcher.",
      "INVENTORY BAG: explains item cards, action buttons, skill tab, and forge/alchemy tabs.",
      "CHARACTER STATS: explains vitals, attributes, class reset, and portrait controls.",
      "PARTY MANAGEMENT: explains roster, member sheets, tactics, formation, and shared inventory.",
      "MAP AND TRAVEL: explains node selection, travel, route discovery, and room editing.",
      "SOCIAL CARDS: explains affinity, memory notes, manual add, and contact links.",
      "PERSONA EDITOR: explains persona fields, duplicate, and save/apply.",
      "JOURNAL: explains quest creation, objectives, Codex, and plot threads.",
      "HELP / MANUAL: explains search, group filter, and Tutorial Mode button.",
      "SETTINGS: explains all seven tabs and the connection test button.",
      "All other windows (Diary, Databank, Phone, Calendar, Organizations, Battle, Activities, etc.) have similar multi-step tutorials that activate when the window is opened while Tutorial Mode is active."
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
        .uie-help-manual-card { width:min(1100px, calc(100vw - 24px)); max-height:min(90vh, 920px); display:flex; flex-direction:column; gap:12px; background:#10141f; color:#eef5ff; border:1px solid rgba(203,163,92,.5); border-radius:14px; box-shadow:0 24px 90px rgba(0,0,0,.75); overflow:hidden; }
        .uie-help-head { display:flex; align-items:center; gap:10px; padding:14px 16px; border-bottom:1px solid rgba(255,255,255,.1); background:rgba(203,163,92,.08); }
        .uie-help-head h2 { margin:0; font-size:20px; letter-spacing:0; }
        .uie-help-head p { margin:2px 0 0; color:#b8c5d8; font-size:12px; }
        .uie-help-close { margin-left:auto; min-width:36px; height:34px; border-radius:9px; border:1px solid rgba(255,255,255,.14); background:rgba(0,0,0,.25); color:#fff; cursor:pointer; }
        .uie-help-tools { display:flex; gap:8px; padding:0 16px; flex-wrap:wrap; }
        .uie-help-search { flex:1 1 240px; min-height:38px; border-radius:10px; border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.06); color:#fff; padding:0 12px; outline:none; }
        .uie-help-filter { min-height:38px; border-radius:10px; border:1px solid rgba(255,255,255,.14); background:#141a28; color:#fff; padding:0 10px; }
        .uie-help-start-tutorial { min-height:38px; border-radius:10px; border:1px solid rgba(203,163,92,.55); background:rgba(203,163,92,.18); color:#ffe3a3; font-weight:900; padding:0 12px; cursor:pointer; }
        .uie-help-body { min-height:0; overflow:auto; padding:4px 16px 16px; display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:12px; }
        .uie-help-card { border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.055); border-radius:10px; padding:14px; }
        .uie-help-card.is-hidden { display:none; }
        .uie-help-card.is-target { outline:2px solid #cba35c; box-shadow:0 0 0 5px rgba(203,163,92,.18); }
        .uie-help-card__head span { display:block; margin-bottom:4px; color:#cba35c; font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:.12em; }
        .uie-help-card h3 { margin:0; font-size:15px; }
        .uie-help-card p { margin:8px 0; color:#cad5e5; font-size:12px; line-height:1.45; }
        .uie-help-card ol { margin:0; padding-left:20px; color:#eef5ff; font-size:12px; line-height:1.6; }
        .uie-help-card li { margin:5px 0; }
      </style>
      <div class="uie-help-head">
        <i class="fa-solid fa-circle-question" aria-hidden="true"></i>
        <div>
          <h2 id="uie-help-title">Help / Manual</h2>
          <p>Deep-dive reference for every window, modal, tab, button, and generation option in the engine.</p>
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
