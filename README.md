# Universal Immersion Engine: Fugue

![Universal Immersion Engine: Fugue logo](assets/backgrounds/logo.jpg)

> **You create the starting point. You and the AI create the story. Fugue turns that story into the game.**

**Universal Immersion Engine: Fugue** is a local-first visual-novel RPG frontend for long-running, character-driven stories. It combines freeform roleplay with persistent characters, maps, travel, parties, combat, inventories, relationships, schedules, homes, in-world communication, generated media, and deterministic world logic.

Fugue is not built around one model, one provider, or one genre. Bring a cloud API, a local model server, or run the browser game in reduced offline/procedural mode. The AI writes and reacts; Fugue tracks the game.

## Project status

Fugue is under active development.

- Desktop is the primary reference layout.
- Android/Termux is supported in **landscape mode** and continues to receive mobile-parity work.
- The browser frontend can run without Python, but the managed FastAPI backend unlocks the living-world database, schedules, memories, map tools, local voice routes, visual jobs, and deeper simulation.
- Optional local image and voice models can add several gigabytes. They are not required to play.
- Bugs and rough edges are expected while systems are being connected and refined.

This repository is free to use, modify, fork, and redistribute under the included custom license. Selling or paywalling Fugue itself or modified repackages requires written permission.

## Why Fugue is different

Most roleplay frontends give a model prompts, chat history, and a text box. Fugue adds a game layer around the story.

- **Systems share state.** Maps, travel, NPC schedules, relationships, parties, inventory, phones, combat, homes, and events are designed to affect one another.
- **Logic is not left entirely to the model.** Travel rules, access checks, item quantities, vitals, schedules, combat costs, time, weather, and many consequences use deterministic code.
- **NPCs can exist beyond the current reply.** Characters can keep locations, memories, relationships, schedules, secrets, affiliations, social activity, household roles, and world-state records.
- **AI remains replaceable.** Main narration, fast utility work, images, and voices can use different providers—or none.
- **The story remains yours.** Fugue supplies tools and state. It does not require a preset world, cast, tone, or campaign structure.

## Major systems

| System | What it does |
| --- | --- |
| **Visual-novel story stage** | Freeform chat, portraits, expressions, speech bubbles, scene effects, cutscenes, animation layers, group scenes, and optional Live2D. |
| **Character Cards and NPC Management** | Reusable cast cards, bios, personalities, secrets, memories, schedules, voices, relationships, location, and living-world state. |
| **Maps and travel** | Hierarchical worlds, regions, rooms, exits, connected locations, editable nodes, transit hubs, route requirements, travel history, and arrival consequences. |
| **Player Home** | Map-linked residences, multiple homes, a primary residence, rooms, residents, relatives, children, guardians, visitors, storage, and household presence. |
| **Party and progression** | Party leadership, formations, reserves, roles, tactics, equipment, shared inventory, skills, classes, custom vitals, and progression. |
| **Battle** | Full-screen turn-based combat with initiative, targets, actions, resources, statuses, break/stagger, enemy planning, party switching, and persistent results. |
| **World simulation** | Time, weather, schedules, aging, rumors, gossip, memories, consequences, messages, world events, organizations, and living-world ticks. |
| **Inventory and economy** | Items, containers, equipment, crafting, cooking, alchemy, forge, enchantment, shops, trade, currency, banking, bills, and owned assets. |
| **In-world communication** | Modern phone and fantasy Codice modes, texts, letters, calls, email, browser pages, social posts, contacts, transit, banking, and custom apps. |
| **Images, sprites, and audio** | Uploads, cloud and local generation, portrait/background workflows, sprite libraries, music, ambient audio, TTS, voice presets, and creator voices. |
| **Customization and recovery** | Themes, draggable windows, visibility controls, mobile layout rules, diagnostics, save slots, exports, imports, and automatic IndexedDB backups. |

## Connected gameplay

Fugue's systems are intended to work together rather than behave like unrelated modals.

### Characters, family, and households

Character Cards are reusable definitions. NPC Management stores the character's active campaign state. Social and Lineage describe relationships. Player Home describes who actually lives together.

This allows situations such as:

- A child living with grandparents.
- Siblings who are related but live in different homes.
- Multiple family residences.
- A guardian who is not biologically related.
- A partner who visits often but has another primary residence.
- A resident leaving for work or school while remaining part of the household.
- A known character becoming a party member, shopkeeper, visitor, caller, rival, tenant, or travel companion without creating a disconnected duplicate.

### Maps, travel, and homes

A map node can represent a city, district, building, room, camp, cave, ship, vehicle, station, or another physical location. Travel is routed through shared rules rather than cosmetic buttons.

Supported travel modes include:

- Walking, bicycle, motorcycle, car, taxi, and rideshare.
- Subway, train, and bus.
- Horse and carriage.
- Ferry, boat, ship, and airship.
- Plane, spaceship, and portal.

Routes can check discovery, schedules, tickets, fares, reputation, factions, quests, wanted status, party size, vehicles, companions, access credentials, and world conditions.

Player Home uses those same map locations. A residence can be a house, apartment, rented room, guild quarter, castle, ship cabin, campsite, cave, mobile vehicle, or other claimed location. Opening Player Home does not require the character to be physically there, but location-bound actions can.

### Time and NPC autonomy

The game clock can affect:

- Day/night presentation and weather.
- Appointments, birthdays, reminders, and calendar events.
- NPC movement and recurring schedules.
- Work, school, rest, training, travel, and other activities.
- Hunger, fatigue, sleep, hygiene, status effects, and custom trackers.
- Aging and family changes.
- Messages, deliveries, visitors, social posts, rumors, and world events.

The world can continue to change without forcing every event into the current narration.

## Current UI gallery

These are shipped interface captures from `assets/ui/Screenshots`.

### Character editor and Voice Studio

![Character editor open to the Voice Studio and portrait galleries](assets/ui/Screenshots/Screenshot%202026-07-01%20010124.png)

### Map

![Map with connected locations and map controls](assets/ui/Screenshots/Screenshot%202026-07-01%20010240.png)

### New Game setup

![New Game character setup with the configuration tab rail](assets/ui/Screenshots/Screenshot%202026-07-01%20010849.png)

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

## Requirements

- **Node.js 18 or newer**
- A current desktop or mobile browser
- **Python 3.10 or newer** for backend features
- Free disk space for optional local models

Chromium-based browsers receive the most testing. The game is designed for a full-screen landscape layout.

There are currently no required third-party Node packages. The launcher skips `npm install` unless dependencies are added later.

## Quick start

### Windows

1. Download or clone the repository into a writable folder.
2. Double-click `uie.bat`.
3. Press Enter or answer `Y` when asked to create or repair `.venv`.
4. Open `http://localhost:8093/game.html` if the browser does not open automatically.

### Linux and macOS

```bash
git clone https://github.com/GetfroggyHoe/Universal-Immersion-Engine-Fugue.git uie
cd uie
chmod +x start.sh
./start.sh
```

Use `bash start.sh` when executable permissions or the shell header cause a launch problem.

### Android with Termux

```bash
pkg install git -y
git clone https://github.com/GetfroggyHoe/Universal-Immersion-Engine-Fugue.git uie
cd uie
bash start.sh
```

Termux installs missing Node.js, Python, and virtual-environment support through `pkg` after confirmation. Optional ONNX image and voice runtimes depend on Android wheel availability and device architecture.

### Start through npm

```bash
npm start
```

Then open:

```text
http://localhost:8093/game.html
```

Do not open `game.html` directly through a `file://` URL. Templates, modules, media, and same-origin API routes require the local server.

## The project-local `.venv`

Fugue uses a project-local Python virtual environment for backend dependencies.

On a fresh install or after backend requirements change, the launcher asks:

```text
Create/update .venv and install the missing Python packages now? [Y/n]:
```

Press Enter or answer `Y`.

The launcher:

- Creates `.venv` inside the project.
- Installs `python/requirements-backend.txt`.
- Does not modify global Python.
- Validates FastAPI, Uvicorn, and Pydantic.
- Starts the frontend even when backend setup fails, using reduced offline/procedural mode.

Manual setup:

```bash
npm run backend:install
```

The `.venv` directory should remain ignored by Git and should not be included in public ZIP releases.

## Optional local models

Fugue does not require local image or voice models.

### Koji image generation

Koji is an optional local image model from `calcuis/koji`, approximately 2.5 GB before additional caches and dependencies.

- It is not bundled.
- It is never silently downloaded.
- It can be installed during setup or later through **Settings > Image Generation**.
- It can be deleted without removing the ability to reinstall it.
- Cloud image providers and uploads remain available without Koji.

### Local voice engines

Pocket TTS and Kokoro model files are supported. Their Python/ONNX runtime packages are optional and may not be available on every Android architecture.

Install the full optional requirements only when local media features are needed:

```bash
./.venv/bin/python -m pip install -r python/requirements.txt
```

Windows:

```powershell
.\.venv\Scripts\python.exe -m pip install -r python\requirements.txt
```

## First campaign

### 1. Connect a text model

Open **Settings > Main API**, then:

1. Create or select a profile.
2. Choose chat completion, text completion, a local model server, AI Horde, or a custom route.
3. Enter the endpoint, exact model ID, and API key when required.
4. Test the connection.
5. Save the profile.

The optional **Turbo API** can use a different provider for faster utility work such as summaries, scans, tagging, map enrichment, or UI tasks.

<details>
<summary><strong>Supported text providers and local servers</strong></summary>

Cloud and gateway presets include OpenRouter, OpenAI, Anthropic, Google Gemini, DeepSeek, Groq, Together AI, Fireworks AI, Cohere, Mistral, xAI, Perplexity, NVIDIA NIM, NanoGPT, Hugging Face Inference, Replicate, Azure OpenAI, AWS Bedrock, Vertex AI, AI Horde, Cloudflare Workers AI, Cerebras, SambaNova, and generic OpenAI-compatible routes.

Local-server presets include Ollama, LM Studio, KoboldCpp, Text Generation WebUI, vLLM, LocalAI, llama.cpp server, and Jan.

A preset fills defaults. Provider compatibility still depends on the selected service, model, and endpoint shape.

</details>

### 2. Create the starting point

Choose **New Game** and complete only the sections the campaign needs:

- Character and appearance
- Currency, groups, and organizations
- Life trackers and custom vitals
- Items, equipment, skills, and quests
- Lorebook and setting rules
- Assets and property
- Starting NPCs and party choices
- Starting world, region, room, exits, and scene

Fugue creates the initial state and opening scene. Everything can be edited later.

### 3. Play

1. Write an action or dialogue in the main story view.
2. Let the connected model produce narration and character responses.
3. Use the Command Deck for structured systems.
4. Advance time when activities or travel should consume it.
5. Save important facts in the correct system rather than relying only on chat history.
6. Export backups periodically.

## Command Deck

The floating launcher is divided into four groups.

- **Story:** Journal, Diary, Map, Organizations, Activities, and Battle
- **Character:** Persona, Player Home, Inventory, Characters, Party, Social, and You
- **World:** Databank, Phone/Codice, Add NPC, Calendar, Atmosphere, and Helper
- **System:** Settings, Edit Room, Help, Save, Load, and Exit

Buttons, HUD elements, the action wheel, minimap, quick bag, Helper Pet, and other interfaces can be hidden, restored, or repositioned through UI settings.

## Where campaign knowledge belongs

| Need | Use |
| --- | --- |
| Private player writing | **Diary** |
| Objectives and named discoveries | **Journal / Codex** |
| Facts learned during this campaign | **Databank** |
| Reusable setting canon and rules | **Lorebook** |
| Generated readable books, letters, and documents | **Archive or readable inventory items** |
| Character-specific history and promises | **Social memories or Character Cards** |
| Current NPC state, schedule, secrets, and location | **NPC Management** |
| Biological and social family connections | **Lineage / Social** |
| Who lives together and where | **Player Home / Household** |

## Saves, backups, and local data

Campaign state is currently browser-local, with backend persistence for living-world services.

- Main state is stored in browser storage.
- IndexedDB mirrors and automatic backups help recover from quota or corruption problems.
- Named saves and portable JSON exports are available in the Save/Load and Backup interfaces.
- The living-world backend stores NPCs, places, events, messages, and related records in `data/uie_living_world.sqlite3`.
- Instavibe and voice registry data live under `data/`.
- Generated media uses configured visual and generated-data directories.

Browser storage belongs to the exact origin. These do not share saves:

```text
http://localhost:8093
http://127.0.0.1:8093
```

Use the same browser profile and hostname, and export backups before moving devices, changing origins, or clearing site data.

Campaign-specific exports, saves, API credentials, virtual environments, and personal media should not be committed to the public repository.

## Providers

<details>
<summary><strong>Image providers</strong></summary>

Supported UI choices include:

- Optional local Koji
- OpenAI Images
- Stability AI
- Black Forest Labs / FLUX
- Google Imagen / Gemini Image
- Pollinations
- ImageRouter.io
- LMRouter
- AI/ARouter
- NanoGPT
- OpenRouter
- Together AI
- FAL.AI
- Hugging Face
- ComfyUI
- AUTOMATIC1111 / SD WebUI
- SD.Next
- Stable Horde
- Custom OpenAI-style POST endpoints

Uploads remain available when generation is disabled or unavailable.

</details>

<details>
<summary><strong>Voice and TTS providers</strong></summary>

Supported UI choices include Pocket TTS, Kokoro Local, OpenAI, OpenRouter TTS, ElevenLabs, Azure AI Speech, Google Cloud TTS, AllTalk XTTS, Edge Browser/custom RVC, and custom OpenAI-compatible services.

Voice assignments can target the narrator, persona, active target, or individual Character Cards. Preset voices and creator/reference voices remain separated in the registry.

</details>

## Architecture

### Browser frontend

The frontend owns presentation, interaction, campaign state, provider profiles, local caches, and reduced offline/procedural behavior.

### Managed FastAPI backend

The optional backend adds:

- NPC profiles, locations, memories, schedules, and relationships
- Living-world ticks and event processing
- Map generation, scanning, layout, and synchronization
- Battle planning and enemy generation
- Voice registry, audio routes, and optional local engines
- Visual jobs, providers, uploads, model management, and workers
- Deterministic world tools for context, continuity, rumors, search, normalization, and resources

Health and API documentation:

```text
http://127.0.0.1:28101/health
http://127.0.0.1:28101/docs
```

### Standalone character runtime

The modular deterministic character state/behavior engine under `app/` is a developer tool and is not started by the normal launcher.

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 28110
```

## Common commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start the managed frontend and backend on port 8093. |
| `npm run start:lan` | Start for a trusted LAN. |
| `npm run start:device` | Frontend-only server. |
| `npm run start:mobile` | Frontend-only mobile/LAN alias. |
| `npm run start:full` | Advanced explicit two-process launcher. |
| `npm run backend:install` | Create or repair `.venv` and install core backend requirements. |
| `npm run backend:start` | Start the backend directly on Windows. |
| `npm run backend:start:lan` | Expose the backend directly on a trusted LAN. |
| `npm run sync:ui` | Synchronize source templates into embedded `game.html` sections. |
| `npm test` | Run map navigation and state integration tests. |

<details>
<summary><strong>Additional regression tests</strong></summary>

The repository includes targeted tests for launcher behavior, story presets, combat projection, context packing, API responses, VN responses, expressions, animations, backgrounds, map generation, the living world, transit, access tools, party layouts, audio, credentials, backend startup, smart shops, Player Home, mobile parity, ComfyUI, console regressions, feedback regressions, and Focused DOMs.

Review `package.json` for the current script names.

</details>

## Ports and LAN use

| Port | Service | Default exposure |
| --- | --- | --- |
| `8093` | Frontend, static assets, local routes, and same-origin proxy | All interfaces for normal launcher starts |
| `28101` | FastAPI living-world backend | Loopback |
| `28102`, `28000-28002` | Automatic backend fallback ports | Loopback |
| `28094` | Optional image sidecar | Loopback and disabled by default |
| `8188/8189` | Typical external ComfyUI ports | Controlled by ComfyUI |
| `7860` | Typical AUTOMATIC1111 / SD.Next port | Controlled by that WebUI |

LAN clients should normally connect only to port `8093`. The Python services can remain private on the host.

The development server does not include user authentication. Use it on your device or a trusted LAN. Do not expose it directly to the public internet, especially when browser state contains provider credentials.

## Repository guide

| Path | Contents |
| --- | --- |
| `game.html` | Main application, boot logic, and embedded fallback UI. |
| `src/modules/` | Browser systems, state, providers, simulation, presentation, and controllers. |
| `src/modules/features/` | Inventory and progression features. |
| `src/templates/` | Source templates for windows and panels. |
| `src/styles/`, `src/css/`, `style.css` | Global, component, viewport, and animation styles. |
| `python/uie_backend.py` | Main FastAPI backend. |
| `python/world_tools/` | Deterministic context, memory, continuity, rumor, search, and resource helpers. |
| `python/visuals/` | Visual providers, jobs, storage, models, and workers. |
| `python/image_service.py` | Optional local image sidecar. |
| `app/` | Standalone deterministic character runtime. |
| `assets/` | UI, backgrounds, audio, sprites, voices, maps, and catalogs. |
| `models/` | Optional and bundled local model locations. |
| `data/` | Living-world database, social data, voice registry, and generated state. |
| `scripts/` | Launchers, synchronization tools, processing scripts, and tests. |
| `dev-server.mjs` | Static server, proxy, `.venv` manager, and sidecar lifecycle. |
| `uie.bat`, `start.sh` | Windows and Unix/Termux launchers. |

### Editing templates

1. Edit the source file under `src/templates/`.
2. Update the matching controller under `src/modules/`.
3. Run:

```bash
npm run sync:ui
```

4. Run the relevant tests and reload the served page.

Do not edit only one embedded copy when a synchronized source template exists.

## Troubleshooting

### The launcher asks for `.venv`

That is expected on a fresh install or when backend requirements change. Press Enter or answer `Y`.

### The launcher closes or npm returns immediately

Run the launcher from a terminal. If it says UIE is already running, open the displayed URL. That is a successful reuse check rather than a crash.

### Backend routes return `502`

Check:

```text
http://127.0.0.1:28101/health
```

Then run:

```bash
npm run backend:install
```

The managed launcher may use a fallback backend port when `28101` is occupied.

### A save appears missing

Use the same browser profile and exact hostname as before. Check Save/Load and Backups, then import the latest JSON export.

### Images do not generate

Test the configured provider independently, verify its URL/model/key, or use an upload. Local engines require their own running service and compatible dependencies.

### Voices do not play

Confirm that browser audio is allowed, TTS is enabled, the speaker is included in the assignment scope, and the selected local or cloud provider is available.

### Android layout is incorrect

Use landscape mode, refresh after clearing stale site CSS, and confirm the latest mobile-parity source files are installed. Mobile remains under active refinement.

## Contributing and feedback

Useful reports include:

- Device and operating system
- Browser
- Installation method
- Exact steps that caused the issue
- Console or launcher error
- Screenshot or recording
- Whether the Python backend was active
- Whether the problem occurs after a clean reload

General criticism is less actionable than a reproducible bug, broken workflow, or concrete UI example.

## License

Fugue is licensed under the [GetfroggyHoe Free Frontend License 1.0](LICENSE.md).

You may use, modify, fork, and redistribute the frontend for free. You may use it with paid APIs, commercial projects, and monetized content. You may not sell, paywall, or commercially repackage the frontend or modified versions without written permission.

Third-party components and assets remain subject to their own licenses. See `THIRD_PARTY_LICENSES.md` and retain accompanying source and credit notes.

## Credits and acknowledgments

- **FastAPI** by Sebastian Ramírez
- **Pocket TTS** by Kyutai, with ONNX export/runtime work from KevinAHM
- **Kokoro** by hexgrad, with `kokoro-onnx` by thewh1teagle and browser-side ONNX Community support where enabled
- **Koji Image Gen** optional model files from `calcuis/koji`
- **SDXS** research by Yuda Song, Zehao Sun, and Xuanwu Yin
- **TAESD** by madebyollin and applicable ONNX/Sentis conversion authors
- **Font Awesome**
- **Perchance AI** and **SillyTavern** for helping demonstrate the possibilities of imaginative AI roleplay tools
- Bundled and user-supplied artwork remains credited according to its accompanying notes
