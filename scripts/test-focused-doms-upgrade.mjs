import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [map, hierarchy, mapTemplate, mapCss, reader, core, settings, startup, dynamicBox, rootCss, game, docs, pkgText] = await Promise.all([
  read("src/modules/map.js"), read("src/modules/domHierarchy.js"), read("src/templates/map.html"), read("src/css/map.css"),
  read("src/modules/readableHtml.js"), read("src/modules/core.js"), read("src/templates/settings_window.html"),
  read("src/modules/startup.js"), read("src/modules/dynamicResponseBox.js"), read("style.css"), read("game.html"),
  read("docs/FOCUSED_DOMS_UPGRADE_PLAN.md"), read("package.json"),
]);

for (const preset of ["school", "service", "retail", "office", "clinic", "craft", "performance"]) {
  assert.match(map, new RegExp(`\\b${preset}:\\s*\\{`), `missing ${preset} focused preset`);
}
for (const field of ["accent", "icon", "touchpoints", "notes", "documents", "schedule", "lastSection", "completed", "activeId"]) {
  assert.match(map, new RegExp(`\\b${field}\\b`), `focused contract missing ${field}`);
}
assert.match(map, /mergeStableRecords/);
assert.match(map, /normalizeFocusedDomState/);
assert.match(map, /switchFocusedDom/);
assert.match(map, /getActiveFocusedDom/);
assert.match(hierarchy, /syncFocusedDOMs/);
assert.match(hierarchy, /switchFocusedDOM/);
assert.match(hierarchy, /getActiveFocusedDOM/);
assert.match(hierarchy, /activeFocusedDomId/);

for (const section of ["overview", "tasks", "schedule", "notes", "documents"]) {
  assert.match(map, new RegExp(`\\b${section}\\b`), `workspace missing ${section}`);
}
for (const action of ["data-focus-switch", "data-focus-task", "data-focus-save-note", "data-focus-open-doc", "uie-focus-new-document"]) {
  assert.match(map, new RegExp(action), `workspace action missing ${action}`);
}
for (const html of [mapTemplate, game]) {
  assert.match(html, /id="uie-map-focus-open"/);
  assert.match(html, /id="uie-focused-doms-modal"/);
  assert.match(html, /id="uie-focus-workspace-body"/);
}
assert.match(mapCss, /@media \(max-width:760px\)/);
assert.match(mapCss, /\.uie-focus-switcher/);
assert.match(mapCss, /\.uie-focus-empty/);

for (const option of ["auto", "book", "letter", "scroll", "note", "document", "journal", "ledger", "manual", "board", "sign", "tablet", "file", "menu", "receipt", "assignment", "script"]) {
  assert.ok(reader.includes(`value: "${option}"`), `readable catalog missing ${option}`);
}
for (const api of ["READABLE_OPTIONS", "normalizeReadableKind", "getActiveReader", "uie-readable-kind-select"]) {
  assert.match(reader, new RegExp(api), `readable API missing ${api}`);
}
assert.match(reader, /uie-readable-sheet-tablet/);
assert.match(reader, /uie-readable-sheet-receipt/);
assert.match(reader, /@media \(max-width:640px\)/);
assert.doesNotMatch(reader, /@media not all/);

assert.match(core, /dynamicResponseBoxesEnabled\s*=\s*false/);
assert.match(core, /#uie-rpg-dynamic-response-boxes/);
assert.match(settings, /id="uie-rpg-dynamic-response-boxes"/);
assert.match(startup, /initDynamicResponseBox/);
assert.match(dynamicBox, /MutationObserver/);
assert.match(dynamicBox, /ResizeObserver/);
assert.match(dynamicBox, /orientationchange/);
assert.match(dynamicBox, /refreshDynamicResponseBox/);
assert.match(dynamicBox, /uie-dynamic-response-boxes/);
assert.match(rootCss, /html\.uie-dynamic-response-boxes #message-box/);
assert.match(rootCss, /max-height:\s*min\(430px,\s*42dvh\)/);
assert.match(game, /dynamicResponseBoxesEnabled/);
assert.match(game, /#uie-rpg-dynamic-response-boxes/);

assert.match(docs, /Academy \/ School/);
assert.match(docs, /Manual QA checklist/);
const pkg = JSON.parse(pkgText);
assert.equal(pkg.scripts["test:focused-doms"], "node scripts/test-focused-doms-upgrade.mjs");

console.log("Focused DOMs upgrade regression checks passed.");
