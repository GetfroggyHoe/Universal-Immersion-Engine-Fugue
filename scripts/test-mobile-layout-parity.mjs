import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [mountJs, viewportCss, orientationJs, styleCss, gameHtml, navigationJs, partyJs, diagnosticsJs, packageJson] = await Promise.all([
  read("src/modules/modalViewport.js"),
  read("src/styles/modalViewport.css"),
  read("src/modules/mobileOrientation.js"),
  read("style.css"),
  read("game.html"),
  read("src/modules/navigation.js"),
  read("src/modules/party.js"),
  read("src/modules/diagnostics.js"),
  read("package.json"),
]);

assert.match(gameHtml, /<div id="game-root">/, "scene root must exist in game.html");
assert.doesNotMatch(gameHtml, /id="game-viewport"/, "game-viewport must be removed");
assert.doesNotMatch(gameHtml, /id="game-scale-root"/, "game-scale-root must be removed");
assert.match(gameHtml, /<div id="game-overlay-root"[^>]*><\/div>/,
  "shared gameplay overlay mount is missing");

for (const selector of [
  "#uie-inventory-window", "#uie-party-window", "#uie-factions-window",
  "#uie-map-window", "#chatlog-modal", "#map-move-modal",
  "#ui-toast-wrap", "#toast-container", "#immersive-nav-popup",
]) {
  const sources = `${mountJs}\n${viewportCss}`;
  assert.match(sources, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `${selector} must belong to the shared gameplay overlay system`);
}
for (const selector of ["#uie-inventory-window", "#uie-factions-window", "#uie-party-window"]) {
  assert.match(mountJs, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `${selector} must be an explicit gameplay overlay candidate even when its template has no class`);
}

assert.match(orientationJs, /matchMedia\("\(pointer: coarse\)"\)\.matches/);
assert.match(orientationJs, /matchMedia\("\(orientation: landscape\)"\)\.matches/);
assert.match(orientationJs, /root\.classList\.toggle\("uie-mobile-landscape", isMobileLandscape\)/,
  "must toggle mobile landscape class");
assert.match(orientationJs, /0\.9 \* Math\.max\(0\.65, Math\.min\(0\.81, width \/ 1310, height \/ 578\)\)/,
  "must apply the requested additional ten percent bottom-deck reduction");
assert.match(orientationJs, /const hudScale = 0\.578/,
  "mobile landscape must apply the requested additional twenty-percent HUD reduction");
assert.match(orientationJs, /function updateMobileHudCapacity\(\)/,
  "mobile HUD tracker overflow must be calculated from available screen space");
assert.match(orientationJs, /rows\.length > capacity/,
  "the HUD scroller must appear only when the rendered tracker count exceeds capacity");
assert.match(orientationJs, /overlapsHudHorizontally[\s\S]{0,360}viewportHeight - 8/,
  "HUD capacity must use the full height when the right-aligned deck does not overlap it");
assert.match(viewportCss, /#hud-secondary-scroll:not\(\[data-overflowing\]\)[\s\S]{0,160}flex:\s*0 0 auto\s*!important/,
  "a short life-tracker list must use natural height instead of being clamped");
assert.match(orientationJs, /function installPressInfo\(\)/,
  "coarse-pointer controls must expose hover information through a press gesture");

assert.doesNotMatch(styleCss, /#game-root[^{}]*\{[^}]*transform:[^;}]*scale/,
  "#game-root must not be scaled");
assert.doesNotMatch(viewportCss, /game-modal-desktop-canvas|--modal-scale/,
  "gameplay overlays must not use an independent modal scaler");
assert.doesNotMatch(`${viewportCss}\n${styleCss}\n${gameHtml}`, /#game-overlay-root\s*>\s*\*\s*\{[^}]*pointer-events\s*:\s*auto/,
  "the overlay root must not blindly make every full-screen child clickable");
assert.match(viewportCss, /#uie-map-window[\s\S]{0,500}pointer-events:\s*none\s*!important/,
  "the map window wrapper must be click-through");
assert.match(viewportCss, /\.re-screen-minimap:not\(\[hidden\]\):not\(\[aria-hidden="true"\]\)[\s\S]{0,100}pointer-events:\s*auto\s*!important/,
  "only a visible field-map panel should receive pointer events");
assert.match(viewportCss, /\[aria-hidden="true"\] \*[\s\S]{0,180}pointer-events:\s*none\s*!important/,
  "hidden overlay descendants must not retain hit areas");
assert.match(viewportCss, /width:\s*clamp\(220px,\s*28vw,\s*280px\)\s*!important/,
  "coarse landscape must use the reduced Field Map width");
assert.match(viewportCss, /\.re-screen-minimap[\s\S]{0,420}transform:\s*scale\(0\.7\)\s*!important/,
  "coarse landscape must uniformly reduce the Field Map another thirty percent");
assert.match(viewportCss, /max-height:\s*42dvh\s*!important/,
  "coarse landscape must cap the Field Map stage height");
assert.match(mountJs, /export function fitDesktopModal\(panel\)/,
  "modal viewport must expose reusable desktop-proportional panel fitting");
assert.match(mountJs, /Math\.min\(1, \(viewportWidth - 24\) \/ desktopWidth, \(viewportHeight - 24\) \/ desktopHeight\)/,
  "modal fit must be uniform and never upscale desktop panels");
assert.match(mountJs, /bodyMajorOpen/,
  "body-level blocking windows must participate in major-modal overlap ordering");
assert.match(mountJs, /FULLSCREEN_GAMEPLAY_WINDOWS\.has\(panel\.id\)/,
  "classless Inventory, Organizations, and Party windows must use the same proportional fitter");
assert.match(mountJs, /FULLSCREEN_GAMEPLAY_WINDOWS\.has\(node\.id\)[\s\S]{0,220}node\.matches/,
  "classless full-screen windows must hide the floating Field Map while open");
assert.doesNotMatch(styleCss, /font-size:\s*1\.08em[\s\S]{0,160}max-width:\s*min\(96vw,\s*1300px\)/,
  "generic modal enlargement must remain removed");
assert.doesNotMatch(styleCss, /\.uie-window:not\([^}]+width:\s*min\(1040px,\s*96vw\)/,
  "generic 1040px/96vw modal shells must remain removed");
assert.match(gameHtml, /sanitizeModalLookCss/,
  "custom modal look CSS must pass through the structural-property filter");
assert.match(gameHtml, /class="reply-send-column"[\s\S]{0,300}id="reply-image-attach"/,
  "image attachment control must live under the send control");
assert.match(styleCss, /#input-row[\s\S]{0,260}display:\s*grid\s*!important/,
  "mobile landscape must use a CSS grid response row");
assert.match(styleCss, /#input-row[\s\S]{0,400}minmax\(var\(--uie-input-min\)[\s\S]{0,120}1fr\)\s*max-content\s*!important/,
  "the response input must be the only flexible column");
assert.match(styleCss, /#nav-row[\s\S]{0,600}margin:\s*clamp\(4px,\s*1dvh,\s*8px\)[\s\S]{0,200}var\(--uie-bottom-left,\s*230px\)\s*!important/,
  "bottom navigation must align under the main control row with left clearance");
assert.match(gameHtml, /id="reply-send-utilities"[\s\S]{0,180}id="reply-image-attach"/,
  "the attachment control must have a utility row beneath Send");
assert.match(diagnosticsJs, /\$\("#reply-send-utilities"\)[\s\S]{0,180}utilityRow\.append\(dot\)/,
  "the connection indicator must sit next to the attachment control, not above Send");
assert.match(gameHtml, /function organizeReplyImages\(\)/,
  "reply images must be automatically named, captioned, and ordered");
const scripts = JSON.parse(packageJson).scripts;
assert.doesNotMatch(scripts["start:mobile"], /--no-backend/,
  "mobile startup must install/start the FastAPI backend");
assert.doesNotMatch(scripts["start:device"], /--no-backend/,
  "device startup must install/start the FastAPI backend");
assert.match(viewportCss, /#game-overlay-root[\s\S]{0,1800}#uie-inventory-window[\s\S]{0,500}#uie-factions-window[\s\S]{0,500}#uie-party-window/,
  "Inventory, Organizations, and Party must be full-screen gameplay windows");
assert.doesNotMatch(partyJs, /function ensurePartyWindowClickable\(\)[\s\S]{0,700}(?:width:\s*"100vw"|height:\s*"100vh")/,
  "Party must size against the shared gameplay canvas, not the physical viewport");
assert.match(partyJs, /function ensurePartyWindowClickable\(\)[\s\S]{0,900}fitDesktopModal\(win\)/,
  "Party's late layout lock must reapply desktop-proportional mobile fitting");

assert.match(navigationJs, /document\.addEventListener\("touchstart"/,
  "mobile swipe needs a touch fallback");
assert.match(navigationJs, /document\.addEventListener\("pointerdown"/,
  "mobile swipe needs pointer events");
assert.match(navigationJs, /mountGameplayLayer\(popup\)/,
  "destination confirmation must mount inside the gameplay overlay root");

const mobileViewports = [
  [915, 412], [844, 390], [800, 360], [740, 360], [667, 375],
];
for (const [width, height] of mobileViewports) {
  const scale = 0.9 * Math.max(0.65, Math.min(0.81, width / 1310, height / 578));
  assert.ok(scale >= 0.585 && scale <= 0.729, `${width}x${height} produced invalid scale`);
}

for (const [width, height] of [[915, 412], [844, 390], [740, 360]]) {
  const fit = Math.min(1, (width - 24) / 760, (height - 24) / 620);
  assert.ok(fit > 0 && fit < 1, `${width}x${height} must uniformly reduce a 760x620 desktop modal`);
  assert.ok(760 * fit <= width - 24 + 0.001);
  assert.ok(620 * fit <= height - 24 + 0.001);
  assert.ok(Math.abs((760 * fit) / (620 * fit) - 760 / 620) < 1e-12,
    `${width}x${height} must preserve the desktop modal aspect ratio`);
}
for (const [width, height] of [[1366, 768], [1536, 864], [1920, 1080]]) {
  const fit = Math.min(1, (width - 24) / 760, (height - 24) / 620);
  assert.equal(fit, 1, `${width}x${height} must not transform a desktop modal that already fits`);
}

console.log(`mobile landscape invariants: ${mobileViewports.length} mobile viewports passed`);
