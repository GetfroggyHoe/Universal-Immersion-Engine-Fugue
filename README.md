# UIE: Fugue

![UIE: Fugue logo](assets/backgrounds/logo.jpg)

UIE: Fugue is a local-first visual-novel RPG workspace for long-running, AI-assisted stories. It combines freeform chat with character sheets, parties, maps, time and weather, combat, inventories, relationships, in-world apps, generated media, and persistent campaign state.

You choose the text, image, and voice providers. The browser game works without a Python backend in a reduced offline/procedural mode; the managed FastAPI backend adds the living-world database, NPC schedules and memory, map generation, social feeds, local voice routes, visual jobs, and deterministic world tools.

## UPDATE: `.venv` is now part of setup

UIE switched to a project-local Python virtual environment after the initial release. If you originally installed UIE before that change, run your normal `git pull` (or replace the files from a new ZIP), then launch with `uie.bat` on Windows or `./start.sh` on Linux/macOS. The launcher will detect that `.venv` or required packages are missing and ask:

```text
Create/update .venv and install the missing Python packages now? [Y/n]:
```

Press Enter or answer `Y`. The launcher creates `.venv` inside the UIE folder, downloads only the packages in `python/requirements-backend.txt`, validates them, and then starts the game. It does not change global Python and does not delete or move game saves. If Node.js, Python, or Linux `venv` support is missing, the launcher first asks to install it automatically and then continues setup in the same run. You can also trigger environment setup manually with `npm run backend:install`.

## Requirements

- Node.js 18 or newer.
- A current desktop or mobile browser. Chromium-based browsers receive the most testing.
- Python 3.10 or newer for backend features. Python is optional for the browser-only game.
- Enough free disk space for any optional local models you choose to install.

There are currently no third-party Node packages. The launcher therefore skips `npm install` unless dependencies are added later.

## Quick start

### Windows

1. Download or clone the repository and put it in a writable folder.
2. Double-click `uie.bat`.
3. When prompted, choose `Y` (or press Enter) to create or repair the project-local `.venv` and install the small core backend dependency set.
4. Open [http://localhost:8093/game.html](http://localhost:8093/game.html) if the browser does not open automatically.

The `.venv` prompt is expected after a fresh clone/ZIP download and when upgrading an installation from before UIE adopted virtual environments. A virtual environment itself is created locally rather than downloaded; only its required packages are downloaded. If a system prerequisite is missing, Windows uses `winget`, Android/Termux uses `pkg`, and Linux/macOS uses the detected supported package manager after one confirmation. Manual installation is only required when automatic installation is declined, fails, or no supported package manager is available. The launcher never installs Python packages globally. On the first launch it may also ask whether to download the optional Koji image model. Choose `N` if you only want the game, use a cloud image provider, or already run ComfyUI/AUTOMATIC1111. Koji can be installed later from **Settings > Image Generation**.

### Linux and macOS

```bash
chmod +x start.sh
./start.sh
```

Use `bash start.sh` if executable permissions or the shell header cause a launch problem.

If prerequisites are missing, `start.sh` asks permission and installs them with the available system package manager before continuing; users do not need to hunt down separate download pages.

### Android with Termux

```bash
pkg install git -y
git clone <repository-url> uie
cd uie
bash start.sh
```

`start.sh` detects missing Node.js, Python, and virtual-environment support. Answer `Y` or press Enter and Termux installs them with `pkg`, then continues directly into `.venv` creation. The living-world backend uses a portable core requirement set; optional local ONNX voice and image runtimes are not installed on Android because upstream wheels may be unavailable. You may still preinstall everything with `pkg install git nodejs-lts python -y` if preferred.

UIE is designed for a landscape, full-screen layout. Local model support depends on the device architecture, available memory, and whether the optional Python packages support that device.

### Start with npm

```bash
npm start
```

Then open [http://localhost:8093/game.html](http://localhost:8093/game.html). `npm start` serves the frontend on all interfaces and manages the FastAPI backend automatically.

Starting UIE twice is safe. If port 8093 already contains a healthy UIE server, `npm start` reports the existing URL and exits successfully instead of making npm report a crash. If another application owns the port, UIE reports a real port conflict and leaves that process alone.

Do not open `game.html` directly with a `file://` URL. Templates, modules, media, and same-origin API routes require the local server.

## Current UI gallery

Every image below is a current capture from `assets/ui/Screenshots`. They show the shipped interface rather than concept art.

### Character editor and Voice Studio

![Character editor open to the Voice Studio and portrait galleries](assets/ui/Screenshots/Screenshot%202026-07-01%20010124.png)

### Map

![Map with connected locations and map controls](assets/ui/Screenshots/Screenshot%202026-07-01%20010240.png)

### New Game setup

![New Game character setup with the full configuration tab rail](assets/ui/Screenshots/Screenshot%202026-07-01%20010849.png)

### Character Card roster

![Character Card roster showing reusable cast cards](assets/ui/Screenshots/Screenshot%202026-07-01%20012204.png)

### NPC Management

![NPC Management editor for a living-world character profile](assets/ui/Screenshots/Screenshot%202026-07-01%20012220.png)

### Calendar and schedules

![Calendar interface with dates, events, and schedule controls](assets/ui/Screenshots/Screenshot%202026-07-01%20012302.png)

### Distraction-free story view

![Visual-novel story stage with the surrounding HUD hidden](assets/ui/Screenshots/Screenshot%202026-07-16%20182827.png)

### Play HUD and field map

![In-game HUD with vitals, action composer, and draggable field map](assets/ui/Screenshots/Screenshot%202026-07-16%20192938.png)

### Photo diary

![Two-page diary entry with a saved scene photo](assets/ui/Screenshots/Screenshot%202026-07-17%20014725.png)

### Party ledger

![Party member ledger with portrait, stats, equipment, and progression](assets/ui/Screenshots/Screenshot%202026-07-17%20015604.png)

### Full-screen battle

![Full-screen battle interface with combatants, turn order, actions, and combat log](assets/ui/Screenshots/Screenshot%202026-07-17%20015658.png)

## First-session tutorial

### 1. Connect a text model

1. Open **Settings > Main API**.
2. Create or select a profile.
3. Choose the route type: chat completion, text completion, local model server, or AI Horde.
4. Pick a provider preset, or use **OpenAI-compatible**/**Custom** for another endpoint.
5. Enter the endpoint, exact model ID, and API key if the provider requires one.
6. Choose the endpoint shape or leave it on auto-detect.
7. Test the connection and save the profile.

Main API profiles hold the primary narrator/dialogue model. The separate **Turbo API** is optional and can route faster utility work such as UI generation, map tasks, tagging, scans, and summaries. Main and Turbo profiles persist across reloads and can use different providers.

Text presets in the UI include:

- Cloud: OpenRouter, OpenAI, Anthropic, Google Gemini, DeepSeek, Groq, Together AI, Fireworks AI, Cohere, Mistral, xAI, Perplexity, NVIDIA NIM, NanoGPT, Hugging Face Inference, Replicate, Anyscale, Cloudflare Workers AI, Cerebras, and SambaNova.
- Gateways: Azure OpenAI, AWS Bedrock, Vertex AI, generic OpenAI-compatible endpoints, AI Horde, and custom routes.
- Local servers: Ollama, LM Studio, KoboldCpp, Text Generation WebUI, vLLM, LocalAI, llama.cpp server, and Jan.

Provider compatibility still depends on that service accepting the selected endpoint shape and model. A preset fills defaults; it does not create an account, key, or local server for you.

### 2. Create a campaign

1. Choose **New Game** from the startup menu.
2. Fill in only the tabs your story needs:
   - **Character**: identity, job/class, level, vitals, stats, scenario, and story instructions.
   - **Appearance**: description, portrait, and visual identity.
   - **Currency & Groups**: currency, starting funds, organizations, and social group context.
   - **Life Trackers**: custom needs, conditions, meters, and recurring life-state values.
   - **Items & Equipment**: starting bag, equipment, containers, and quantities.
   - **Skills**: active/passive abilities and progression data.
   - **Quests**: initial objectives and plot hooks.
   - **Lorebook**: setting canon, rules, history, species, places, and factions.
   - **Assets**: property, vehicles, accounts, and other owned resources.
   - **NPCs**: starting cast, relationships, roles, and party choices.
   - **Starting Location**: world, region, room, coordinates, exits, and scene setup.
3. Use a preset or character card if it fits, or create everything manually.
4. Start the game. Setup creates a visible opening scene, registers the starting cast, and submits the first story response through the connected Main API. You can edit the persona, characters, lore, map, party, and assets later.

The included **Adventure Path** story preset demonstrates class loadouts, world/map installation, and reusable source data.

### 3. Learn the play loop

1. Write an action or line of dialogue in the chat/visual-novel view.
2. Review the narrator and character response, expressions, scene effects, state changes, and any generated choices.
3. Use the Command Deck for structured actions: travel, combat, inventory, social records, schedules, phone apps, and downtime.
4. Advance time deliberately. Schedules, weather, reminders, aging, needs, rumors, messages, and world events can react to elapsed time.
5. Save important information in the Journal, Diary, Databank, Lorebook, or character memories instead of relying only on chat history.
6. Export a backup periodically, especially before changing browsers, hostnames, or devices.

The **Helper Pet**, **Help / Manual**, and tutorial mode contain guided walkthroughs for the startup menu and every major window. Tutorial highlights cover more than eighty screens and modal flows, including map creation, room editing, combat, party sheets, family trees, calendars, phone apps, organizations, shops/trade, schedules, simulated MMO/LFG tools, Focused DOMs, images, sprites, diagnostics, music, and cutscenes.

## Implemented feature map

### Important connected systems

Several recent systems are intentionally wired through shared bridges instead of isolated UI buttons:

- **Transit is shared by map and phone.** Map transport nodes open the same departure board used by **Phone > Transit / Journey Planner**. Both flows call `src/modules/travelBridge.js`, which uses the shared route/state rules in `src/modules/travelRules.js`.
- **Transit is not only train and rideshare.** Supported travel modes include walking, bicycle, motorcycle, subway, bus, taxi, rideshare, car, horse, carriage, ferry, boat/ship, airship, plane, spaceship, and portal. Mode requirements can check discovery, schedules, fares, tickets, reputation, factions, quests, wanted status, party size, owned vehicles/assets, companions, and current world conditions.
- **Rideshare is a real phone-connected travel flow.** Phone rideshare service classes quote fares, pickup windows, cargo capacity, and driver flavor, then book through the same trip pipeline as map departures. Do not replace it with a cosmetic-only phone app.
- **Transit locks use generated DOM backgrounds by mode.** Generated 1600x900 WebP assets live in `assets/generated/transit/` and are mapped from `src/modules/travelBridge.js` for rail, road, carriage, ship, aircraft, spacecraft, and portal travel.
- **The bottom paint brush owns manual background upload.** The existing image-generation paint-brush dropdown in `game.html` has one `data-img-gen="upload-background"` item. It lazy-loads `src/modules/manualSceneImage.js`, validates and compresses local image files, then applies the image to the active scene/background state.
- **Locks, tools, and minigames share deterministic helpers.** `src/modules/accessControl.js`, `src/modules/contextualActions.js`, and `src/modules/minigameBridge.js` provide reusable access checks, tool actions, and player-facing challenge DOMs for containers, doors, obstacles, hotspots, and placed room objects.

### Story and visual-novel presentation

- Freeform narrator/character chat with separate system prompts, narrator styles, filters, persona injection, context packing, response cleanup, and cancelable generation.
- Configurable dialogue flow with up to three sentences per VN box. Rich character turns are prompted to use two-to-three sentences when appropriate; the box setting paginates long output and never limits an assistant response to a single sentence or a single turn.
- Visual-novel stage with character portraits, expression resolution, speech bubbles, dialogue and environmental animation layers, scene effects, cutscenes, and optional Live2D rendering.
- Character-specific motion profiles, animation priority rules, reduced-motion support, ambient effects, semantic action detection, and strong-animation safeguards.
- Group scenes, scene cards, tracked speakers, selectable characters, next-beat assistance, story presets, and reusable character cards.
- Main and Turbo model profiles, model discovery, endpoint-shape controls, sampler settings, API key failover, token/latency/cost monitoring, and context-pressure reporting.

### Player, characters, party, and relationships

- Player persona editor, appearance, portrait, job/class, level, attributes, vitals, currency, age, age group, and custom trackers.
- NPC/cast card library with JSON and PNG-card import/export, personalities, bios, scenario data, secrets, schedules, memories, voice assignments, and reusable portraits.
- Party roster with leader/control selection, front/mid/back formation lanes, reserves, tactics, roles, member sheets, shared inventory, equipment, progression, and skill trees.
- Social roster grouped by friends, family, romance, rivals, and associates, with affinity/disposition, relationship labels, notes, memories, family trees, contact details, and map tracking.
- Character location, proximity, relationships, memory/recall, schedule, and movement routes backed by SQLite when the living-world service is available.
- Developer-facing standalone character runtime under `app/` with modular emotion, attachment, empathy, control, romance, survival, morality, and rivalry state packs plus comfort, confrontation, withdrawal, protection, romance, control, and rivalry behavior modules. It is not part of the default launcher path.

### World, maps, travel, and physical scenes

- Hierarchical world/region/room state, generated or imported maps, directional travel, coordinates, exits, route discovery, transit hubs, and transit locks.
- Connected departures for walking, bikes, motorcycles, subway, bus, taxi, rideshare, cars, horses, carriages, ferries, boats/ships, airships, planes, spaceships, and portals, with persistent tickets, active trips, travel history, route favorites, discovered docks, and arrival consequences.
- Draggable minimap with hide/restore controls, current location, named exits, clickable travel, tracked party members, and selected social contacts.
- Manual and AI-assisted location creation, world generation, room scanning, layout generation, and map synchronization. AI mode reports provider failures; Hybrid mode may retain procedural structure when enrichment is unavailable.
- Editable rooms with hotspots, interactable objects, placement coordinates, actions, containers, doors, scenery, background prompts, and generated local backdrops.
- Physical-world and Reality Stage views, automatic object rendering, object placement, navigation assets, and location-linked organization assets.

### Time, simulation, memory, and consequences

- Game clock, time skipping, day/night state, fantasy calendar, weather forecast, birthdays, appointments, reminders, NPC schedules, activities, and aging on date changes.
- Atmosphere Console with Auto Scene, Game Clock, and Manual Hold modes; rain, snow, fog, lighting/filter controls, custom weather presets, and per-weather audio.
- Living-world ticks, ambient events, recent events/messages, NPC simulation, phone delivery, world feed, and WebSocket updates.
- AI-Driven World Event Simulation Engine that periodically simulates smart, high-impact occurrences (NPC deaths with bereavement, business bankruptcies/unemployment, faction takeovers, epidemics/contagions, breakthroughs, scandals/affairs, disasters, and crime arrests) that mutate the SQLite database and publish to the Instavibe social feed and private NPC-to-Player SMS logs.
- Causality propagation, queued consequences, reputation math, emotion contagion, gossip seeding/spread, secret routing, continuity checking, event extraction, rumor propagation, and notification prioritization.
- Tiered context memory, transcript compaction, importance scoring, entity normalization/deduplication, searchable world records, cache management, storage reports, and fallback management.
- Dynamic academy logic for assignments, final evaluation, applications, delivery mode, clubs, schedules, and school-related world state.

### RPG, combat, progression, and activities

- Structured full-screen turn-based battle with combatants, initiative/turn queue, selectable actions and targets, enemy generation/planning, status effects, vitals, costs, party tactics, formations, reserves, fleeing, and combat results.
- Icon-based status effects with descriptions, remaining duration, stat and damage-over-time modifiers, chat/hotspot/activity application and cures, expiration, and lethal HP consequences.
- Combat projection that merges persona, party, equipment, skills, modifiers, lanes, actions, portraits, and persistent HP/MP/AP state.
- Jobs/classes, stat scaling, skill trees, rune and rebirth systems, permanent bonuses, medallions, custom vitals, and life trackers.
- Downtime activities for training, work, study, rest, crafting, party assignments, and other time-consuming routines.
- AI-driven minigame/DOM overrides for tasks such as hacking, locks, timed challenges, and scene-specific interactions.
- Deterministic timing and sequence challenge DOMs for locks, hacking, puzzle seals, tool use, obstacle handling, fishing, treatment, repair, scanning, and other contextual actions.
- Plot armor, action evaluation, repetition/no-sell handling, and configurable RPG/economy rules.

### Inventory, crafting, assets, and economy

- Inventory bag, searchable item records, quantities, rarity, tags, weight/encumbrance, containers, item readers, equipment slots, outfits, and a quick bag.
- Equipment, skills, kitchen/cooking, alchemy, forge, enchantment, rune, item creation, and asset tabs with normalized crafting categories and inputs.
- Smart location shops with automatic commercial-location entry, persistent context-specific shopkeepers/NPC records, per-location AI-or-procedural catalogs, Buy/Sell modes, stock counts, resale values, and campaign currency; plus direct trade, dynamic pricing, bank accounts, transfers, savings/checking balances, bills, taxes, housing, arrest/jail, release, and escape flows.
- Owned assets such as property, vehicles, organizations, accounts, access records, and generated or uploaded item/equipment art.
- Context-aware tools such as lockpicks, keyrings, crowbars, hacking devices, scanners, cameras, fishing rods, cooking kits, medical kits, rope, shovels, axes, knives, wrenches, screwdrivers, flashlights, compasses, and repair kits, with durability/charges, evidence/suspicion, time costs, rewards, and persistent object results.
- Packed asset catalog support, asset manifests, macros, processed food/item libraries, and user-supplied artwork.

### Communication and in-world life

- Modern phone and fantasy Codice skins with messages/letters, contacts, calls/couriers, block lists, arrival queues, and distance-aware delivery.
- In-world browser pages, generated documents, applications, email/mail, calculator, connected transit/journey planning, banking, bills, settings, and custom apps.
- Instavibe social feed with onboarding, settings, generated profiles/posts, comments, likes, event capsules, sorting, and optional images.
- MMO-style chat, looking-for-group tools, schedules, roster, shops, trade, transit, and organization/war-room interfaces.
- Journal for quests, objectives, Codex entries, plot threads, and progress notes; private Diary entries with photos and IndexedDB-backed stickers; structured Databank and Lorebook records.

### Images, sprites, audio, and themes

- Portrait, persona, background, room, item, skill, asset, organization, map, message, profile, and social-post visual workflows.
- Image prompt confirmation, style and negative-prompt templates, background placement macros, explicit opt-in Pollinations fallback, hybrid local/cloud routing, job status, regeneration, replacement, uploads, and visual-key reuse. Failed providers are reported instead of being replaced by a fake generated image.
- Manual local background upload from the existing bottom paint-brush dropdown, including client-side validation, image compression, active-scene application, and persistence into the same background/custom scene state used by generated images.
- Sprite libraries, expression packs, sprite wizard, stage expressions, asset scanning, directional backgrounds, window background picker, and optional Live2D settings.
- Music library scanning, genres, upload/reclassification routes, main-menu music control, ambient/weather audio, and theme-aware presentation.
- Theme manager, custom palettes, game-mode themes, theme import/export, UI visibility controls, draggable windows, viewport recovery, and mobile/landscape adaptations.
- Optional TTS for narrator, persona, active targets, or character cards; per-character assignments; streaming coordination; preset and creator voice libraries; preview, reroll, locking, compilation, metadata, and watch refresh.

### Help, safety, diagnostics, and recovery

- Searchable in-app manual covering setup, Command Deck, every major game system, all Settings tabs, and modal tutorials.
- Helper Pet for contextual explanations, guided highlights, screen-aware help, item forging, compliance guidance, and rumor review.
- Prompt-injection handling, response validation, safety scanning, lockout handling, output sanitization, and strict browser/document schemas.
- Debug window, diagnostics report, state scan/repair helpers, console regression checks, backend health/capability discovery, and offline fallbacks.
- Connection Status HUD indicator showing active Main API and backend health (Green/Yellow/Red) and background scanner to auto-detect active local LLM/diffusion servers (Ollama, LM Studio, KoboldCpp, llama.cpp) on start.
- Automatic IndexedDB backups, save slots, load/import/export, latest-backup restore, settings mirror recovery, and full-state sanitation.

### How the less-obvious windows work

- **You** is a read-focused player dossier for identity, status effects, stats, and lineage. Make edits in Persona, Stats, Inventory, or Social, then refresh You; it is not a second character record.
- **World Simulation** reads shared campaign/living-world state. **Scan / Update State** refreshes its people, places, events, and messages. **Project** intentionally changes the target location/dimension and can synthesize a matching backdrop.
- **Social Chronicle / Tracker** is the tracked-character dossier and family-tree view. It reads relationship data owned by Social and character records.
- **Chatbox** is a compact alternate transcript/composer. It shares the same active story session as the main VN view, so do not submit from both while one generation is running. Its Inventory and Map buttons are shortcuts, not separate state.
- **Shop** opens automatically when the active location looks commercial from its name, type, tags, or description (store, market, cafe, pharmacy, smithy, bookstore, retail/service space, and related language). Each location retains a different merchant and catalog. Its shopkeeper is quietly registered as a full Character Card, NPC Management record, and Social associate; Social owns profile discovery, while NPC Management keeps secrets concealed in its edit workflow. Buy/Sell modes update currency, normalized inventory, and remaining stock. Context restocking uses location/lore/recent-story cues and falls back to deterministic specialty stock if a model is unavailable. **Trade** remains the direct two-party exchange workflow.
- **Player Home** opens automatically only at the registered primary home, a matching owned residence asset, or a map location explicitly marked as the player's home; merely visiting a house or another character's residence does not count. It is an in-world hub over the existing Kitchen, Inventory storage, Wardrobe, Activities, Assets, Social, Map, and phone Homestead systems. Known NPCs can ring the doorbell using deterministic saved-state logic with time/visit/cooldown checks—no AI call. Answering acknowledges them, letting them in moves them into the current scene, and turning them away or ignoring resolves the visit. Map/phone Homestead still owns primary-home registration, upgrades, return travel, bills, rent, and property costs.
- **Character Schedules** describes recurring NPC routines against the game clock. Calendar stores dated events; Activities consumes time for chosen tasks. Those systems are related but not interchangeable.
- **Server Chat** and **LFG** are simulated in-world MMO surfaces. Channel messages, AI flavor pulses, listings, and posts never contact real users or an external matchmaking service.
- **Archive** stores generated in-world books/documents. It is distinct from reusable character cards, Journal Codex entries, Databank discoveries, and Lorebook canon.
- **Focused DOMs** are dedicated task/dossier workspaces for prioritized locations or roles. Open them from **Map > Focus**; their completed actions write back to shared campaign state.
- **Credentials and access tools** cover keys, passes, IDs, licenses, memberships, tickets, magical seals, and digital records. Doors, containers, obstacles, and hotspots can also test schedules, reputation, quests, party state, tools, and world conditions before opening deterministic lock, hack, treatment, repair, scan, fishing, or obstacle challenges.
- **Launcher Options** changes the floating launcher icon and saved custom icons. Command Deck visibility and draggable-position reset remain under **Settings > Edit UI**.

### Where campaign knowledge belongs

| Need | Use | How it behaves |
| --- | --- | --- |
| Private player writing | Diary | Saved as personal entries; not narrator context by default. |
| Objectives and named discoveries | Journal / Codex | Tracks quests, objectives, plot threads, and named lore entities. |
| Facts learned during this run | Databank | Structured, searchable discoveries that can be scanned from recent narration. |
| Reusable setting canon | Lorebook | Trigger-keyed authored rules and lore selected for a campaign. |
| Generated readable fiction/documents | Archive or readable inventory items | Player-facing books, letters, manuals, newspapers, and similar content. |
| Character-specific promises/history | Social memories or character cards | Relationship and cast context attached to the relevant person. |

## Provider setup

### Image generation

Images are optional. Uploading art always remains available, and some asset types are intentionally upload-first.

1. Open **Settings > Image Generation**.
2. Choose a provider and fill in only its visible settings.
3. Test or refresh the provider/model list.
4. Choose quality, size, prompt confirmation, strict instructions, fallbacks, and auto-generation categories.
5. Set the shared style prefix, negative prompt, and background/character/persona templates.

Supported choices exposed by the UI are:

- Optional local download: Koji.
- Cloud/API: OpenAI Images, Stability AI, Black Forest Labs/FLUX, Google Imagen/Gemini Image, Pollinations, ImageRouter.io, LMRouter, AI/ARouter, NanoGPT, OpenRouter, Together AI, FAL.AI, and Hugging Face.
- Local/distributed services: ComfyUI, AUTOMATIC1111/SD WebUI, SD.Next, and Stable Horde.
- Custom OpenAI-style POST endpoints.

ComfyUI settings include endpoint detection, checkpoint, VAE, LoRA, quality/resolution presets, sampler, scheduler, steps, CFG, denoise, seed, and custom API workflow JSON. AUTOMATIC1111/SD.Next use the WebUI URL and generation controls.

#### Koji

Koji is an optional local image model from `calcuis/koji`, approximately 2.5 GB before caches and dependencies. It is not bundled and is never silently downloaded.

- Install it at first launch or through **Settings > Image Generation > Koji**.
- The settings panel reports byte-level progress and completion.
- No API key is required for the public model download.
- **Delete Model** removes the installed model and its download cache, not the ability to reinstall it.
- Local generation also requires the heavy optional packages in `python/requirements.txt` and suitable hardware.
- Hybrid mode can use Koji for selected NPC/skill/item/asset categories and fall back to the configured cloud provider for the rest.

The optional image sidecar on port 28094 is disabled by default. Set `UIE_AUTO_IMAGE_SERVICE=1` when you explicitly want `python.image_service` to start alongside the frontend.

### Voices and TTS

Text play continues normally when audio is disabled or a voice engine is unavailable.

1. Open **Settings > Audio & TTS**.
2. Enable voices and choose the assignment scope.
3. Select Pocket TTS, Kokoro Local, OpenAI, OpenRouter TTS, ElevenLabs, Azure AI Speech, Google Cloud TTS, AllTalk XTTS, Edge Browser/custom RVC, or a custom OpenAI-compatible service.
4. Enter the provider URL/key/model/voice and output format where applicable.
5. Use **Check Pocket + Kokoro** for local engines, then preview a voice.
6. Assign, reroll, or lock voices from character management.

Pocket TTS and Kokoro model files are included under `models/`, but their Python/ONNX runtime packages are optional. Install the full optional requirement set if you want every local audio/image capability ready:

```powershell
# Windows
.\.venv\Scripts\python.exe -m pip install -r python\requirements.txt
```

```bash
# Linux/macOS
./.venv/bin/python -m pip install -r python/requirements.txt
```

Pocket supports bundled preset embeddings and creator/reference voices. Kokoro supports preset voices and custom studio blends. The voice registry keeps model presets separate from creator presets and provides saved-voice, bulk compile/scan, metadata, test, and refresh routes.

## Command Deck reference

The main launcher is split into four groups:

- **Story**: Journal, Diary, Map, Organizations, Activities, and Battle.
- **Character**: Persona, Inventory, Characters, Party, Social, and You (the character sheet/stats view).
- **World**: Databank, Phone, Add NPC, Calendar, Atmosphere, and Helper.
- **System**: Settings, Edit Room, Help, Save, Load, and Exit. Portable export/import controls are available inside the save/load and backup interfaces.

Buttons can be hidden from **Settings > Edit UI**. The floating launcher, action wheel, HUD chips, AI usage display, quick bag, minimap, and other windows have their own visibility and layout controls.

## Saves, backups, and local data

The primary campaign state is browser-local:

- Current settings and state are stored in browser storage.
- A second IndexedDB mirror helps recover from localStorage quota problems.
- Automatic and manual backups use the `uie_backups` IndexedDB database.
- Diary sticker data also uses IndexedDB.
- The living-world backend stores NPCs, places, events, messages, image jobs, and related simulation state in `data/uie_living_world.sqlite3`.
- Instavibe and voice registry data live under `data/`.
- Generated backend media is stored under the configured visual/generated-data directories.

Use **System > Save Game** for named in-browser saves and **Export Data** or **Settings > Backups** for portable JSON. Importing or restoring a backup replaces the current state, so export the current campaign first if you may want it again.

Browser storage is scoped to the exact origin. `http://localhost:8093` and `http://127.0.0.1:8093` do not share the same browser save. Clearing site data, changing browser profiles, or using a different hostname can make a campaign appear missing; import an exported backup or return to the original origin.

## Launcher and startup behavior

The managed launcher performs these steps:

1. Checks Node.js and, for Git clones with a tracked remote, checks whether upstream commits are available.
2. If Node.js, Python, or OS-level `venv` support is missing, asks once for each missing prerequisite and installs it with `winget`, `pkg`, Homebrew, `apt`, `dnf`, `yum`, `pacman`, `apk`, or `zypper` when available.
3. Asks before a fast-forward update; it never updates silently or pulls over local modifications. Missing npm packages also receive an install prompt.
4. Checks `.venv` before opening the game. If it is missing, incomplete, or out of date, explains why setup is needed and prompts before making changes.
5. Creates or repairs `.venv` with the configured Python, accepts Python 3.10 or newer, and uses `ensurepip` when needed.
6. Installs only `python/requirements-backend.txt` into the local environment when its fingerprint changes, then validates the required imports.
7. Validates FastAPI, Uvicorn, and Pydantic.
8. Starts the frontend, selects an available backend port, starts/reuses the backend, and opens the browser when launched with `--open`.

Press Enter or answer `Y` at the environment prompt to use the recommended setup. Answering `N` leaves global Python untouched and starts the frontend in reduced offline/procedural mode; run `npm run backend:install` later to show the prompt again. In a non-interactive terminal the launcher uses the safe local-install default; set `UIE_VENV_SETUP=0` to opt out or `UIE_VENV_SETUP=1` to approve explicitly.

Concurrent launches use an installation lock so they do not both modify `.venv`. Stale locks are removed. If backend preparation fails, the frontend still starts in reduced offline/procedural mode with a visible warning instead of repeatedly attempting a broken backend start.

ZIP downloads have no `.git` metadata, so automatic update checks are unavailable. That is informational, not a startup error.

## Commands

### Runtime

| Command | Purpose |
| --- | --- |
| `npm start` | Managed frontend plus backend on port 8093; reuse an existing healthy UIE server. |
| `npm run start:lan` | Managed frontend/backend on all interfaces for a trusted LAN. |
| `npm run start:device` | Frontend-only server; do not launch backend or image sidecar. |
| `npm run start:mobile` | Alias-like frontend-only mobile/LAN server. |
| `npm run start:full` | Advanced explicit two-process launcher using `PYTHON`/system Python and environment-selected hosts/ports. |
| `npm run backend:install` | Create/repair `.venv`, install core backend requirements, validate imports, then exit. |
| `npm run backend:start` | Start the backend with the Windows `.venv` path on `127.0.0.1:28101`. |
| `npm run backend:start:lan` | Start the backend on `0.0.0.0:28101`. Use only on a trusted LAN; the frontend proxy is safer for normal remote-device access. |
| `npm run sync:ui` | Rebuild embedded UI template sections in `game.html` after template changes. |

On Linux/macOS, the direct backend equivalent is:

```bash
./.venv/bin/python -m uvicorn python.uie_backend:app --host 127.0.0.1 --port 28101
```

`npm run start:full` assumes its selected Python can already import the backend requirements. The normal launcher is preferred because it manages `.venv` for you.

### Tests

| Command | Coverage |
| --- | --- |
| `npm test` | Map navigation and map-state integration. |
| `npm run test:start` | Cold start plus duplicate-server reuse/clean exit behavior. |
| `npm run test:story-preset` | Adventure Path data, loadouts, and map installation. |
| `npm run test:combat` | Party-to-combat projection, actions, stats, portraits, and vitals persistence. |
| `npm run test:context` | Tiered context retrieval and transcript compaction. |
| `npm run test:api-response` | Text extraction from supported provider response shapes. |
| `npm run test:vn-response` | Visual-novel response validation. |
| `npm run test:expression` | Expression selection behavior. |
| `npm run test:expression-bridge` | Expression-to-stage integration. |
| `npm run test:layered-animation` | Dialogue/environment animation resolution and priority rules. |
| `npm run test:browser-backgrounds` | Directional backgrounds in a browser connected through Chrome DevTools on port 9222. |
| `npm run test:map-generation` | Browser/backend map-generation boundaries and credential isolation. |
| `npm run test:living-world` | Live FastAPI living-world smoke test. |
| `npm run test:ui-systems` | Tracking and major UI-system regression coverage. |
| `npm run test:transit` | Shared map/phone transit rules, fares, active trips, arrivals, events, and save/reload persistence. |
| `npm run test:access-tools` | Persistent access locks, lock inspection/methods, contextual tool compatibility, and rewards. |
| `npm run test:party-style-upgrades` | Party layout, viewport safety, and style upgrades. |
| `npm run test:main-menu-audio` | Startup-menu audio controls. |
| `npm run test:launcher-venv` | Local virtual-environment management contract. |
| `npm run test:launcher-maintenance` | Update and conditional npm-install launcher behavior. |
| `npm run test:console-regressions` | Static browser-console regression guards. |
| `npm run test:feedback-regressions` | Feedback, modal, and notification regression guards. |
| `npm run test:focused-doms` | Focused DOM upgrade coverage for major UI panels. |
| `npm run test:credentials` | Credential storage and provider-configuration regression coverage. |
| `npm run test:backend-startup` | Backend startup contract checks. |
| `npm run test:shop` | Smart shop-entry detection, context catalog, Buy/Sell UI, NPC registration, and startup wiring. |
| `npm run test:home` | Player-home recognition, shared-system actions, deterministic doorbell flow, scene admission, docs, and startup wiring. |
| `npm run test:mobile-parity` | Mobile layout and control parity checks. |
| `npm run test:comfy` | Mock ComfyUI end-to-end smoke test. |

`test:living-world` expects a running backend at `http://127.0.0.1:28101` unless `UIE_BACKEND_BASE_URL` is set. `test:browser-backgrounds` expects a Chrome instance with remote debugging enabled and an open UIE tab.

## Ports, LAN, and reverse proxies

| Port | Service | Default exposure |
| --- | --- | --- |
| 8093 | Node frontend, static assets, same-origin proxy, music/card/lore endpoints | `0.0.0.0` for normal npm/launcher starts |
| 28101 | FastAPI living-world backend | Loopback only |
| 28102, 28000-28002 | Automatic backend fallback ports | Loopback only |
| 28094 | Optional local image sidecar | Loopback only; disabled by default |
| 8188/8189 | Typical external ComfyUI ports | Controlled by your ComfyUI setup |
| 7860 | Typical AUTOMATIC1111/SD.Next port | Controlled by your WebUI setup |

Browser requests to backend and local-image features use same-origin routes under `/api/backend/` and `/api/image-service/`. LAN clients only need access to port 8093; the Python services can remain private on the host.

For an Nginx subpath such as `/uie/`, strip the prefix when forwarding:

```nginx
location /uie/ {
    proxy_pass http://127.0.0.1:8093/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Open `/uie/game.html` through the proxy. HTTPS termination belongs at Nginx/Caddy; do not expose the raw Python ports.

UIE's development server has no user authentication and includes a configurable proxy. Use it on your device or a trusted LAN. Do not publish it directly to the internet, especially when browser state contains provider keys.

## Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PYTHON` | Base Python for `.venv`, or Python used by `start:full` | `python` on Windows, `python3` elsewhere |
| `UIE_VENV_DIR` | Alternate managed virtual-environment directory | `.venv` |
| `UIE_VENV_SETUP` | Answer the `.venv` setup prompt non-interactively (`1` = install, `0` = decline) | prompt in a terminal; install in non-interactive runs |
| `UIE_FRONTEND_HOST` | Frontend host used by `start:full` | `127.0.0.1` |
| `UIE_FRONTEND_PORT` | Frontend port used by `start:full` | `8093` |
| `UIE_BACKEND_HOST` | Backend host used by the proxy/launcher | `127.0.0.1` |
| `UIE_BACKEND_PORT` | Preferred living-world backend port | `28101` |
| `UIE_BACKEND_START_TIMEOUT_MS` | How long the managed launcher waits for backend health before reporting startup failure | `25000` |
| `UIE_AUTO_START_BACKEND` | Set to `0` to prevent managed backend startup | enabled |
| `UIE_AUTO_IMAGE_SERVICE` | Set to `1` to start the optional image sidecar | disabled |
| `UIE_IMAGE_SERVICE_PORT` | Optional image-sidecar port | `28094` |
| `UIE_TEXT_MODEL_ENDPOINT` | Backend-owned OpenAI-compatible endpoint for AI map generation | unset |
| `UIE_TEXT_MODEL` | Backend-owned map-generation model ID | unset |
| `UIE_TEXT_MODEL_API_KEY` | Backend-owned map-generation key | unset |
| `HF_TOKEN` / `HUGGINGFACE_API_TOKEN` | Optional token for gated/rate-limited Hugging Face access | unset |
| `KOJI_HF_REPO` | Override Koji repository | `calcuis/koji` |
| `KOJI_GGUF_QUANT` | Preferred Koji GGUF quantization | `q4_k_m` |
| `VISUAL_MODELS_DIR` | Override visual model storage | `models` |
| `VISUAL_DATA_DIR` | Override visual job data | project visual-data default |
| `VISUAL_ASSET_DIR` | Override generated visual assets | project generated-assets default |

The map-generation backend deliberately reads its text endpoint/model/key from environment variables. The browser does not send its full settings object or provider credentials to those routes.

## Backend services and API docs

With the living-world backend running:

- Health and advertised capabilities: [http://127.0.0.1:28101/health](http://127.0.0.1:28101/health)
- Interactive OpenAPI docs: [http://127.0.0.1:28101/docs](http://127.0.0.1:28101/docs)

Major route groups cover:

- NPC profiles, movement, schedules, relationships, memories, recall, actions, and world ticks.
- Map generation, scanning, synchronization, placement, interception, and layout.
- Events, messages, phone, feeds, Instavibe, browser pages, and synchronized game UI state.
- Battle planning/enemy generation, school evaluation, organization assets, object rendering, and deterministic math tools.
- Audio generation, local voice registry, saved/creator voices, compilation, testing, scanning, and assignment.
- Visual generation/regeneration/upload/replace, model and upscaler management, templates, providers, queues, workers, and notifications.
- World-tool processing for output validation, context building, entity/event processing, search, cache, resource, and storage management.

The separate deterministic Character Runtime Engine in `app/` is not started by the normal UIE launcher. Developers can run it independently:

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 28110
```

It exposes turn/character resolution and debug registry endpoints for the modular state/behavior engine.

## Repository guide

| Path | Contents |
| --- | --- |
| `game.html` | Main served application and embedded boot/UI sections. |
| `src/modules/` | Browser game systems, state, providers, simulation, presentation, and UI controllers. |
| `src/modules/features/` | Inventory/progression feature modules such as items, equipment, skills, cooking, forge, enchant, alchemy, rebirth, and assets. |
| `src/templates/` | Source templates for windows and feature panels. |
| `src/styles/`, `src/css/`, `style.css` | Global, component, viewport, and animation styles. |
| `python/uie_backend.py` | Main FastAPI living-world, voice, visual, simulation, and world-tools service. |
| `python/world_tools/` | Deterministic normalization, context, memory, continuity, rumors, search, cache, and resource helpers. |
| `python/visuals/` | Visual job pipeline, providers, tools, storage, model management, and workers. |
| `python/image_service.py` | Optional local location-image sidecar. |
| `app/` | Standalone deterministic character state/behavior runtime. |
| `assets/` | Bundled backgrounds, UI, audio, sprites, voices, processed catalogs, maps, and generated-media directories. |
| `models/` | Bundled Pocket TTS/Kokoro files and optional downloaded model locations. |
| `data/` | SQLite world state, social feeds, voice registry, lorebooks, generated data, and install markers. |
| `scripts/` | Launchers, synchronization/build helpers, model downloads, asset processing, and tests. |
| `dev-server.mjs` | Static server, reverse proxy, local content routes, `.venv` manager, and sidecar lifecycle. |
| `uie.bat`, `start.sh` | User-facing Windows and Unix/Termux launchers. |

### Connected-system source files

| System | Source of truth |
| --- | --- |
| Transit rules and persistent trip state | `src/modules/travelRules.js` |
| Map/phone departure board and transit-lock DOM | `src/modules/travelBridge.js`, `src/templates/transit_hub.html`, `src/templates/transit_lock.html` |
| Phone journey planner and rideshare UI | `src/templates/phone.html`, `src/modules/phone.js` |
| Map transport-node launch points | `src/modules/map.js`, `src/css/map.css` |
| Transit DOM background assets | `assets/generated/transit/` |
| Existing bottom paint-brush upload action | `game.html`, `src/modules/manualSceneImage.js` |
| Reusable lock/access checks | `src/modules/accessControl.js` |
| Contextual carried-tool actions | `src/modules/contextualActions.js` |
| Deterministic challenge DOMs | `src/modules/minigameBridge.js` |
| Room object and hotspot routing | `src/modules/interactables.js`, `src/modules/hotspots.js` |

When changing one of these systems, keep the bridge intact. For example, add a new vehicle type in `travelRules.js`, expose it through the phone template when it should be bookable there, map its lock art in `travelBridge.js`, and run `npm run sync:ui` if a template changed.

### Editing UI templates

1. Edit the appropriate file under `src/templates/` or `src/templates/features/`.
2. Update its browser controller under `src/modules/` when behavior changes.
3. Run:

   ```bash
   npm run sync:ui
   ```

4. Run the relevant tests and reload the served page.

The runtime fetches templates where possible, but `game.html` also contains synchronized embedded sections used by boot and fallback paths. Keep them in sync instead of editing only one copy.

### Adding assets

- Keep credits/source notes with third-party or user-supplied files.
- Put source art in the matching `assets/` category.
- Update manifests or use the asset-processing scripts when an asset must enter a packed/processed catalog.
- Use the in-app upload and gallery tools for campaign-specific art that should remain in local state/generated storage.

## Troubleshooting

### npm appears to crash or immediately returns

- If it prints `UIE is already running`, that is a successful duplicate-launch check. Open the displayed URL.
- Run `npm run test:start` to verify cold start and duplicate-server behavior on an isolated port.
- If another application owns 8093, close it or run `node dev-server.mjs --port <free-port> --reuse-existing`.
- Run `node --check dev-server.mjs` if the error is a JavaScript syntax failure.
- No npm packages are currently required, so deleting/reinstalling `node_modules` normally does not fix startup.

### The launcher closes immediately

Run `uie.bat` from a terminal or double-click it again; real startup failures pause before closing. Confirm that `node --version` reports Node 18 or newer.

### `.venv` is missing, broken, or has no pip

Run `npm run backend:install`, then answer `Y` (or press Enter) at the setup prompt. The managed launcher attempts `ensurepip`, repairs incomplete environments, and recreates `.venv` when necessary. For a clean rebuild, stop UIE, remove only the project-local `.venv`/`venv`, then launch again.

### Python is unsupported

Install Python 3.10 or newer or point `PYTHON` at a compatible interpreter. UIE will still start the browser frontend if backend preparation fails.

### Backend routes return 502

Check [the backend health endpoint](http://127.0.0.1:28101/health), review the launcher terminal, and run `npm run backend:install`. If 28101 is occupied, the managed launcher may select 28102 or 28000-28002; `/api/backend-info` reports the active same-origin route.

### The browser does not open

Visit [http://localhost:8093/game.html](http://localhost:8093/game.html) manually. `npm start` does not force a browser open; `uie.bat` and `start.sh` pass the open flag.

### A save appears missing

Use the same browser profile and exact hostname used previously. Check **Load Game** and **Settings > Backups**, then import your latest JSON export. Remember that `localhost` and `127.0.0.1` have different browser storage.

### Images do not generate

Upload an image to confirm the UI path, then test the selected provider. For local services, confirm their ports and APIs independently. For Koji, check model status, optional Python dependencies, memory, and download progress. Enable fallback or hybrid routing if desired.

### Voices do not play

Confirm audio is enabled, the assignment scope includes the speaker, and the browser allows playback. Use **Check Pocket + Kokoro**, test the selected voice, and install `python/requirements.txt` for optional local runtimes.

### A reverse-proxied subpath cannot load templates/assets

Strip the prefix before forwarding, preserve the host/protocol headers, and open the path ending in `/game.html`. Use the same external origin consistently so browser saves remain visible.

## License

This project is licensed under the [GetfroggyHoe Free Frontend License 1.0](LICENSE.md).

You may use, modify, fork, and redistribute the frontend for free. You may use it with paid APIs, commercial projects, and monetized content. You may not sell, paywall, or commercially repackage the frontend or modified versions without written permission.

Third-party components and assets remain subject to their own licenses. See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) and retain accompanying source/credit notes.

## Credits and acknowledgments

- **FastAPI** by Sebastian Ramirez.
- **Pocket TTS** by Kyutai, with ONNX export/runtime work from KevinAHM.
- **Kokoro** by hexgrad, with `kokoro-onnx` by thewh1teagle and browser-side ONNX Community support where enabled.
- **Koji Image Gen** optional model files from `calcuis/koji`.
- **SDXS** real-time one-step image-generation research by Yuda Song, Zehao Sun, and Xuanwu Yin.
- **TAESD** by madebyollin and the applicable ONNX/Sentis conversion authors.
- **Font Awesome** interface icons.
- **Perchance AI** and **SillyTavern** for helping demonstrate the possibilities of imaginative AI roleplay tools.
- Bundled and user-supplied artwork remains credited according to its accompanying notes.
