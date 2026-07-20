import assert from "node:assert/strict";
import fs from "node:fs";

const gameHtml = fs.readFileSync(new URL("../game.html", import.meta.url), "utf8");
const devServer = fs.readFileSync(new URL("../dev-server.mjs", import.meta.url), "utf8");
const voiceBridge = fs.readFileSync(new URL("../src/modules/voiceBridge.js", import.meta.url), "utf8");
const startup = fs.readFileSync(new URL("../src/modules/startup.js", import.meta.url), "utf8");
const templateFetch = fs.readFileSync(new URL("../src/modules/templateFetch.js", import.meta.url), "utf8");
const social = fs.readFileSync(new URL("../src/modules/social.js", import.meta.url), "utf8");
const core = fs.readFileSync(new URL("../src/modules/core.js", import.meta.url), "utf8");
const diagnostics = fs.readFileSync(new URL("../src/modules/diagnostics.js", import.meta.url), "utf8");
const backend = fs.readFileSync(new URL("../python/uie_backend.py", import.meta.url), "utf8");

assert.doesNotMatch(gameHtml, /mode-dungeon-ruin-entrance\.png/);
assert.match(gameHtml, /mode-high-fantasy-courtyard\.png/);
assert.match(gameHtml, /const rows = Array\.from\(document\.querySelectorAll\("#chat \.mes"\)\)\s*\.filter\(\(row\) =>/);
assert.match(gameHtml, /attempt === 0\s*\?\s*base/);
assert.doesNotMatch(gameHtml, /document\.hidden\s*\?\s*180000/);
assert.doesNotMatch(gameHtml, /"minigames\.js",\s*"features\/assets\.js"/);
assert.ok(fs.existsSync(new URL("../assets/Sprites/.gitkeep", import.meta.url)));

assert.match(devServer, /server\.on\("upgrade"/);
assert.match(devServer, /const prefix = "\/api\/backend"/);
assert.match(devServer, /await startBackendIfNeeded\(\)/);
assert.match(devServer, /backendStartupState/);
assert.match(voiceBridge, /createOfflineVoiceRegistry/);
assert.match(voiceBridge, /parsed\.port === "8101"/);
assert.match(startup, /const embeddedStandalone = window\.UIE_STANDALONE === true/);
assert.match(templateFetch, /if \(fetchErr\?\.name === "UIETemplateTimeout"\) throw fetchErr/);
assert.match(social, /window\.__uieSocialAutoScanRuntime/);
assert.match(core, /export async function waitForSettingsHydration/);
assert.match(core, /mirrorIdbLoadPromise && !mirrorIdbLoadComplete/);
assert.match(core, /deferSanitizeUntilSettingsHydrate\(\)/);
assert.match(core, /detail: \{ settingsHydrated: true \}/);
assert.doesNotMatch(core, /throw new Error\("extension_settings not hydrated yet"\)/);
assert.doesNotMatch(diagnostics, /fetch\(apiUrl/, "heartbeat must not GET provider namespace URLs");
assert.match(backend, /"voice_bridge": voice_runtime_health\(\)/);
assert.match(gameHtml, /for \(let attempt = 1; attempt <= 3; attempt \+= 1\)/);
assert.match(gameHtml, /!loading\.classList\.contains\("uie-loading-error"\)/);

globalThis.window = {
  UIE_BASEURL: "./",
  location: {
    href: "http://localhost:8093/game.html",
    protocol: "http:",
    hostname: "localhost",
    host: "localhost:8093",
    origin: "http://localhost:8093",
  },
  dispatchEvent() {},
};
globalThis.CustomEvent = class CustomEvent {};

const { toWebSocketUrl } = await import("../src/modules/backendBridge.js");
assert.equal(
  toWebSocketUrl({ baseUrl: "http://localhost:8093/api/backend", token: "" }),
  "ws://localhost:8093/api/backend/ws/stream",
);
assert.equal(
  toWebSocketUrl({ baseUrl: "http://127.0.0.1:28101", token: "abc" }),
  "ws://127.0.0.1:28101/ws/stream?token=abc",
);

console.log("console regression tests: ok");
