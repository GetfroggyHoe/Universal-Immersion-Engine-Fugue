# UIE: Fugue

## License

This project is licensed under the [GetfroggyHoe Free Frontend License 1.0](LICENSE.md).

You may use, modify, fork, and redistribute the frontend for free.

You may also use it with paid APIs, commercial projects, and monetized content. However, you may not sell, paywall, or commercially repackage the frontend or modified versions without written permission.

Third-party components remain subject to their own licenses.

![UIE: Fugue Logo](assets/backgrounds/logo.jpg)

UIE: Fugue is a local visual-novel RPG workspace for running your own ongoing stories. Make a character, choose a setting, talk to NPCs, manage a party, explore a map, collect things, make choices, and keep a campaign moving across as many sessions as you like.

It is built to be played your way: you choose the story provider, art provider, voice options, characters, lore, and rules that fit the run you want.

## What you can do

- Start a new game with a custom player, class or job, appearance, starting scene, party, NPCs, lorebooks, and story tone.
- Play through chat in a visual-novel layout with portraits, expressions, scene effects, cutscenes, speech bubbles, and optional Live2D support.
- Create and manage NPCs with profiles, schedules, personalities, relationships, secrets, phone details, memories, and voice settings.
- Explore maps, travel between locations, discover hotspots and interactable objects, and keep track of time, weather, activities, and events.
- Build a party, manage inventory and equipment, craft, cook, trade, shop, use the bank, and follow jobs, classes, factions, and organizations.
- Run combat, encounters, minigames, social scenes, academy life, calendars, diaries, journals, readable books, and phone or MMO-style messages.
- Generate or upload portraits, backgrounds, objects, items, and other story art; use a compatible online provider, a local ComfyUI setup, or the optional local Koji model.
- Choose your chat, image, and voice providers in Settings. Compatible choices include OpenAI-compatible services, OpenRouter, local servers, ComfyUI, Pocket TTS, Kokoro, and the other providers exposed in the app.
- Give characters distinct voices. Model voices and creator voices are organized separately, and creator voices can be saved, previewed, and reused.
- Use Help, the manual, and the Helper Pet for guided walkthroughs and explanations of the current screen.
- Save, load, back up, and continue a long-running game without treating it like a one-off chat.

## Quick start

### Windows

1. Download or clone this repository and extract it somewhere writable.
2. Double-click `uie.bat`.
3. Let the launcher check Node.js and Python, install needed packages, and open the game.
4. Open [http://localhost:8093/game.html](http://localhost:8093/game.html) if the browser does not open automatically.

On the first launch with no Koji files installed, the launcher asks `Install KOJI image gen now? (requires ~2.5 GB) [Y/N]`. Choose **Y** to download it alongside setup or **N** to skip it. Koji is optional: the repository contains no Koji model files and the game works without them. You can download it later from **Settings > Visual Generation > Koji**, where download progress and completion are shown.

### Linux and macOS

```bash
chmod +x start.sh
./start.sh
```

### Android with Termux

```bash
pkg update && pkg upgrade -y
pkg install git nodejs-lts python -y
git clone <GitHub_Repository_Link> uie
cd uie
bash start.sh
```

Use `bash start.sh` if executable permissions or the shell header cause a launch problem.

## First-session checklist

1. Open **Settings** and choose the chat provider you want to use. Add its URL, model, and key only if that provider needs one.
2. Optionally configure image generation and test the connection before asking for new art.
3. Optionally enable voices in **Settings > Audio & TTS**, choose a provider, and preview a voice.
4. Choose **New Game**, then fill in as much or as little detail as you want. You can edit characters, lore, and assets later.
5. Use the map, party, journal, phone, and character menus as the story grows. The Helper Pet can explain any screen along the way.

## Voices and audio

Voices are optional. Text play continues normally if no TTS provider or model is configured.

- **Pocket TTS** and **Kokoro** can run locally when their required model files and dependencies are available.
- Voice menus separate bundled **Model Preset Voices** from saved **Creator Preset Voices**.
- Creator voices can be named, reused, previewed, and assigned to characters.
- NPC voice choices can be changed, rerolled, or locked from character management.
- Use the preview button to hear a short sample before committing to a voice.

## Images and assets

You can use uploaded art, a configured external image provider, ComfyUI, or optional local generation.

- **Koji** is an optional local download from Hugging Face (`calcuis/koji`), roughly 2.5 GB. On first launch, answer the displayed Y/N prompt to install or skip it; alternatively install it through **Settings > Visual Generation > Koji**.
- It is not downloaded automatically and does not need an API key for its public model download.
- The Koji settings panel displays byte-level download progress and a finished status. To remove it later, use **Delete Model**; this removes the installed model and its download cache, not the download option.
- Some asset types intentionally remain upload-first, so you can keep exact control over item and equipment art.

## Useful commands

```bash
npm run start
npm run start:full
npm run backend:install
npm run backend:start

npm test
npm run test:living-world
npm run test:vn-response
npm run test:context
npm run test:combat
npm run test:api-response
npm run test:expression
npm run test:expression-bridge
npm run test:layered-animation
npm run test:browser-backgrounds
npm run sync:ui
```

`npm run sync:ui` refreshes embedded UI template sections in `game.html` after template edits.

## Credits and acknowledgments

- **FastAPI** - local backend framework by [Sebastian Ramirez](https://github.com/tiangolo/fastapi).
- **Pocket TTS** - voice synthesis by [Kyutai](https://github.com/kyutai-labs/pocket-tts), with ONNX export/runtime work from [KevinAHM](https://github.com/KevinAHM/pocket-tts-onnx).
- **Kokoro** - local TTS by [hexgrad](https://huggingface.co/hexgrad), with [`kokoro-onnx`](https://github.com/thewh1teagle/kokoro-onnx) by thewh1teagle and browser-side ONNX Community model support where enabled.
- **Koji Image Gen** - optional local model files from [`calcuis/koji`](https://huggingface.co/calcuis/koji).
- **SDXS** - real-time one-step image-generation research by Yuda Song, Zehao Sun, and Xuanwu Yin.
- **TAESD** - Tiny AutoEncoder for Stable Diffusion by [madebyollin](https://github.com/madebyollin/taesd), plus the applicable ONNX/Sentis conversion authors for any corresponding model files.
- **Font Awesome** - interface icons.
- **Bundled and user-supplied assets** - artwork in `assets/` remains credited according to its accompanying source notes. Please keep those notes with any asset you add or redistribute.
- **Perchance AI** and **SillyTavern** - thanks for helping demonstrate what imaginative AI roleplay tools can become.
# Universal-Immersion-Engine-Fugue
