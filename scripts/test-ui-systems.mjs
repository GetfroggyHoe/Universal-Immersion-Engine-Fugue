import assert from "node:assert/strict";
import fs from "node:fs";
import { getTrackedCharacters, getTrackedCharactersAt } from "../src/modules/trackedCharacters.js";

const settings = {
  character: { name: "Player" },
  worldState: { location: "Atrium" },
  party: { members: [{ name: "Mika" }, { name: "Player" }] },
  social: {
    friends: [{ name: "Ren", location: "Library", mapTracked: true }, { name: "Ignored", location: "Cafe", mapTracked: false }],
    family: [{ name: "Mika", location: "Home", mapTracked: true }],
    romance: [], associates: [], rivals: [],
  },
};
const tracked = getTrackedCharacters(settings);
assert.deepEqual(tracked.map((row) => row.name), ["Mika", "Ren"]);
assert.equal(tracked[0].automatic, true);
assert.equal(tracked[0].withPlayer, true);
assert.deepEqual(getTrackedCharactersAt(settings, "Library").map((row) => row.name), ["Ren"]);

const gameHtml = fs.readFileSync(new URL("../game.html", import.meta.url), "utf8");
const apiClientJs = fs.readFileSync(new URL("../src/modules/apiClient.js", import.meta.url), "utf8");
const settingsHtml = fs.readFileSync(new URL("../src/templates/settings_window.html", import.meta.url), "utf8");
const atmosphereHtml = fs.readFileSync(new URL("../src/templates/atmosphere.html", import.meta.url), "utf8");
const chatboxHtml = fs.readFileSync(new URL("../src/templates/chatbox.html", import.meta.url), "utf8");
const chatboxJs = fs.readFileSync(new URL("../src/modules/chatbox.js", import.meta.url), "utf8");
const draggingJs = fs.readFileSync(new URL("../src/modules/dragging.js", import.meta.url), "utf8");
const quickBagJs = fs.readFileSync(new URL("../src/modules/features/quickBag.js", import.meta.url), "utf8");
const battleJs = fs.readFileSync(new URL("../src/modules/battle.js", import.meta.url), "utf8");
const mapJs = fs.readFileSync(new URL("../src/modules/map.js", import.meta.url), "utf8");
const phoneJs = fs.readFileSync(new URL("../src/modules/phone.js", import.meta.url), "utf8");
const phoneHtml = fs.readFileSync(new URL("../src/templates/phone.html", import.meta.url), "utf8");
const taxJailJs = fs.readFileSync(new URL("../src/modules/taxJailManager.js", import.meta.url), "utf8");
assert.match(gameHtml, /key:\s*String\(\$\("#cfg-main-key"\)\.val\(\)\s*\|\|\s*""\)\.trim\(\)\s*\|\|\s*String\(prev\?\.key\s*\|\|\s*""\)/);
assert.match(gameHtml, /s\.turbo\.key\s*=\s*String\(win\.find\("#cfg-turbo-key"\)\.val\(\)\s*\|\|\s*""\)\.trim\(\)\s*\|\|\s*String\(s\.turbo\.key\s*\|\|\s*""\)/);
assert.match(gameHtml, /class="minimap-node minimap-node--exit"/);
assert.doesNotMatch(gameHtml, /id="re-screen-minimap-close"/);
assert.match(gameHtml, /if \(last && isUserChatRow\(last\)\)/);
assert.match(gameHtml, /regenerateFromExistingUserLine\(userText, "regenerate"\)/);
assert.match(gameHtml, /appendChatLog\(getUserPersonaChatName\(\), text, true,/);
assert.match(gameHtml, /personaThumb:\s*getUserPersonaChatThumbUrl\(\)/);
assert.match(gameHtml, /id="reply-image-attach"/);
assert.match(gameHtml, /Api\.generateContent\(payload, "VN Dialogue", \{ images: replyImages \}\)/);
assert.match(gameHtml, /class="chatlog-reasoning"/);
assert.doesNotMatch(gameHtml, /class="uie-response-details"/);
assert.match(apiClientJs, /type: "image_url"/);
assert.match(apiClientJs, /type: "input_image"/);
assert.match(gameHtml, /connectionHealth:\s*prev\?\.connectionHealth/);
assert.match(gameHtml, /Connection testing is optional/);
assert.doesNotMatch(gameHtml, /Not tested after configuration change/);
assert.match(gameHtml, /speaker-style-drag-handle/);
assert.match(gameHtml, /document\.body\.appendChild\(pop\)/);
assert.match(gameHtml, /body\.uie-chrome-hidden #uie-launcher/);
assert.match(gameHtml, /#game-root\.uie-chrome-hidden #vn-ui > :not\(#message-box-wrap\)/);
assert.doesNotMatch(gameHtml, /uie-dialogue-move-handle/);
assert.doesNotMatch(gameHtml, /responseBoxPosition/);
assert.match(gameHtml, /\.uie-dialogue-card\s*\{[\s\S]*gap:\s*18px;[\s\S]*padding:\s*24px 28px 22px;[\s\S]*margin-top:\s*22px;[\s\S]*margin-right:\s*5%;[\s\S]*min-height:\s*132px;/);
assert.match(gameHtml, /transform:\s*translate\(-50%, -50%\) scale\(var\(--uie-chatbox-scale, 1\)\) !important/);
assert.match(gameHtml, /per-box limit, never a one-response or one-turn limit/);
assert.match(gameHtml, /Math\.min\(3,\s*Math\.floor\(Number\(_ms\.sentencesPerBox\)\)\)/);
assert.match(gameHtml, /use two to \$\{sentencesPerBox\} sentences in each displayed \[Name\]: block/);
assert.match(apiClientJs, /use two or three sentences in each character's displayed turn/);
assert.match(gameHtml, /followsUser !== true/);
assert.match(apiClientJs, /if \(!out && mainReady\)/);
assert.doesNotMatch(apiClientJs, /if \(!out && !useTurbo && mainReady/);
assert.match(apiClientJs, /export function isLocalNetworkUrl/);
assert.match(apiClientJs, /Connection testing is optional/);
assert.doesNotMatch(apiClientJs, /run Connect & apply/);
assert.match(apiClientJs, /for \(const url of urls\.slice\(0, 1\)\)/);
assert.match(apiClientJs, /while \(attempt < 1\)/);
assert.match(apiClientJs, /while \(hordeAttempt < 1\)/);
assert.doesNotMatch(apiClientJs, /\["\/api\/proxy", "\/api\/cors-proxy", "\/api\/corsProxy"\]/);
assert.match(settingsHtml, /cfg-proxy-mode/);
assert.match(settingsHtml, /cfg-api-save-status/);
assert.match(settingsHtml, /id="cfg-main-apply"[\s\S]*Apply profile/);
assert.match(atmosphereHtml, /data-atmo-mode="auto"/);
assert.match(atmosphereHtml, /uie-atmo-save-preset/);
assert.match(atmosphereHtml, /uie-atmo-sound-url/);
assert.match(chatboxHtml, /height:\s*min\(600px,\s*calc\(100dvh - 32px\)\)/);
assert.match(chatboxHtml, /resize:\s*both/);
assert.match(chatboxHtml, /cursor:move/);
assert.match(chatboxJs, /header\.length && !control\.length && e\.type !== "click"/);
assert.match(chatboxJs, /chatboxDock/);
assert.match(draggingJs, /winId === "uie-chatbox-window"/);
assert.match(draggingJs, /s\.ui\.chatboxDock/);
assert.match(quickBagJs, /overlay\.style\.pointerEvents = "none"/);
assert.match(gameHtml, /q\.style\.pointerEvents='none'/);
assert.match(battleJs, /<div id="battle-bottom-dock"><\/div>\s*<aside id="battle-log-panel"/);
assert.doesNotMatch(battleJs, /mainRow\.appendChild\(rightPanel\)/);
assert.doesNotMatch(battleJs, /\{ id: "flee", label: "Flee", tab:/);
assert.doesNotMatch(battleJs, /\{ id: "wait", label: "Wait", tab:/);
assert.match(mapJs, /if \(action === "add"\) \{\s*return openAddLocationModal\(\);/);
assert.match(mapJs, /if \(s\.image\?\.enabled !== true\) eng\.ensureBackgroundOrRequest\(\)/);
assert.match(phoneHtml, /id="uie-phone-battery"/);
assert.match(phoneHtml, /id="app-bills"/);
assert.match(phoneHtml, /id="p-battery-sim"/);
assert.match(phoneHtml, /padding:\s*92px 20px 20px/);
assert.match(phoneJs, /function tickPhonePower\(\)/);
assert.match(phoneJs, /Phone & Network Plan|monthlyPlanCost/);
assert.match(taxJailJs, /export function listBills/);
assert.match(taxJailJs, /assetBillProfile/);

const inlineModule = gameHtml.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || "";
assert.ok(inlineModule.length > 1000, "main inline module must be present");
assert.doesNotThrow(() => new Function(inlineModule), "main inline module must parse");

globalThis.window = {
  UIE_STANDALONE: true,
  extension_settings: { "universal-immersion-engine": { generation: {}, turbo: {} } },
  addEventListener() {}, dispatchEvent() {}, location: { protocol: "http:", host: "localhost:8093", origin: "http://localhost:8093" },
};
globalThis.document = { querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; }, body: {}, head: {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.CustomEvent = class CustomEvent {};
globalThis.$ = () => ({ length: 0, on() { return this; }, off() { return this; } });
const { extractUsageFromApiJson, isLocalNetworkUrl } = await import("../src/modules/apiClient.js");
assert.equal(isLocalNetworkUrl("http://localhost:11434/v1"), true);
assert.equal(isLocalNetworkUrl("192.168.1.22:1234/v1"), true);
assert.equal(isLocalNetworkUrl("http://uie-box.local:5001"), true);
assert.equal(isLocalNetworkUrl("https://api.openai.com/v1"), false);
const usage = extractUsageFromApiJson({
  usage: {
    prompt_tokens: 100,
    completion_tokens: 30,
    total_tokens: 130,
    prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 10 },
    completion_tokens_details: { reasoning_tokens: 12 },
    cost: 0.0042,
  },
});
assert.deepEqual(usage, { promptTokens: 100, completionTokens: 30, totalTokens: 130, cachedTokens: 60, cacheWriteTokens: 10, reasoningTokens: 12, cost: 0.0042 });
console.log("ui-systems tests: ok");
