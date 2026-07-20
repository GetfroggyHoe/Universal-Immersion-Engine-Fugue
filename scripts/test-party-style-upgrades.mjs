import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clampViewportPosition, defaultViewportPosition } from "../src/modules/viewportSafe.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const game = fs.readFileSync(path.join(root, "game.html"), "utf8");
const party = fs.readFileSync(path.join(root, "src/modules/party.js"), "utf8");
const partyTemplate = fs.readFileSync(path.join(root, "src/templates/party.html"), "utf8");
const helperPet = fs.readFileSync(path.join(root, "src/modules/helperPet.js"), "utf8");
const hotspots = fs.readFileSync(path.join(root, "src/modules/hotspots.js"), "utf8");
const interaction = fs.readFileSync(path.join(root, "src/modules/interaction.js"), "utf8");

const presetBlock = game.match(/const UIE_SPEAKER_STYLE_PRESETS = \[([\s\S]*?)\n\s*\];/);
assert.ok(presetBlock, "speaker preset registry exists");
const ids = [...presetBlock[1].matchAll(/\bid:"([a-z0-9-]+)"/g)].map((match) => match[1]);
assert.equal(ids.length, 20, "exactly 20 speaker presets");
assert.equal(new Set(ids).size, 20, "speaker preset IDs are stable and unique");
const presets = Function(`"use strict"; return [${presetBlock[1]}];`)();
assert.equal(new Set(presets.map((preset) => [preset.bg, preset.radius, preset.borderStyle, preset.shadow, preset.padding].join("|"))).size, 20, "genre presets differ across multiple visual properties");
for (const group of ["Fantasy", "Mystery & Horror", "Science Fiction", "Modern & Romance", "Historical & Adventure"]) {
    assert.match(presetBlock[1], new RegExp(`group:"${group.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.equal(presets.filter((preset) => preset.group === group).length, 4, `${group} has four presets`);
}
assert.match(game, /function speakerCssTemplate[\s\S]*\.uie-dialogue-card\[data-speaker=/, "speaker CSS is seeded with a scoped working selector");
assert.match(game, /background:\s*var\(--speaker-bg\)/, "seeded speaker CSS follows live control variables instead of freezing preset colors");
assert.match(game, /speaker-style-bg-image[\s\S]*data:image\/png;base64/, "reply editor documents image URL and data URI support");
assert.match(game, /bgImage:\s*String\(\$\("#speaker-style-bg-image"\)/, "reply background image is read into persisted speaker state");
assert.match(game, /imageLayer[\s\S]*center \/ cover no-repeat/, "reply background image is composed as a fitted CSS layer");
assert.doesNotMatch(game, /\.uie-dialogue-card\{background:linear-gradient\(180deg,rgba\(255,250,239/, "late living skin no longer hard-overrides reply background controls");
assert.match(game, /\.uie-dialogue-card\{background:var\(--speaker-bg/, "late reply styling consumes saved speaker background variables");
assert.match(game, /upsertDynamicCss\("uie-speaker-custom-css"/, "speaker CSS is applied through a dedicated style element");
assert.match(game, /id="speaker-style-voice"/, "speaker gear panel includes a per-speaker voice selector");
for (const voiceGroup of ["Kokoro voices", "Pocket TTS presets", "User custom \/ saved voices"]) {
    assert.match(game, new RegExp(voiceGroup), `${voiceGroup} voice group is available`);
}
assert.match(game, /voiceChoice:\s*String\(\$\("#speaker-style-voice"\)/, "speaker voice choice is stored with speaker style state");
assert.match(game, /resolveSpeakerVoiceRecipe\(speaker, mod\)[\s\S]*voice_recipe:\s*voiceRecipe/, "dialogue playback honors the selected per-speaker voice recipe");
assert.match(game, /createKokoroVoiceRecipe[\s\S]*createPocketVoiceRecipe[\s\S]*savedVoices/, "voice choices reuse Kokoro, Pocket, and saved voice state");
assert.match(helperPet, /voiceEnabled:\s*true/, "helper voice defaults on");
assert.match(helperPet, /typeof s\.helperPet\.voiceEnabled !== "boolean"[\s\S]*s\.helperPet\.voiceEnabled = true/, "missing helper voice setting migrates on");
assert.match(helperPet, /petState\.voiceEnabled = !!s\.helperPet\.voiceEnabled/, "explicit saved helper voice opt-out remains authoritative");
assert.match(hotspots, /Costume card CSS template/, "costume CSS editor is seeded with editable declarations");
assert.match(hotspots, /Room-only CSS example/, "room CSS editor is seeded with a scoped example");
assert.match(interaction, /Global UI CSS template[\s\S]*Stats custom CSS[\s\S]*Activities custom CSS/, "global custom CSS editors are seeded with editable examples");
assert.match(party, /if \(!Array\.isArray\(s\.party\.sharedItems\)\) s\.party\.sharedItems = \[\]/, "shared inventory is normalized");
assert.match(partyTemplate, /data-inventory-scope="personal"[\s\S]*data-inventory-scope="shared"/, "personal and shared inventory tabs exist");
assert.match(partyTemplate, /party-sheet-stat-mode/, "attributes use one edit-mode control");

const viewport = { left: 0, top: 0, width: 390, height: 844 };
assert.deepEqual(clampViewportPosition(-900, 2000, 80, 80, 12, viewport), { left: 12, top: 752 });
assert.deepEqual(defaultViewportPosition(80, 80, "bottom-right", 18, viewport), { left: 292, top: 746 });

console.log("party/style upgrade tests: ok");
