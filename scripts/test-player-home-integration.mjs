import fs from "node:fs";
import assert from "node:assert/strict";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const home = read("src/modules/playerHome.js");
const template = read("src/templates/player_home.html");
const startup = read("src/modules/startup.js");
const tutorial = read("src/modules/tutorial.js");
const manual = read("src/modules/helpManual.js");
const helper = read("src/modules/helperPet.js");
const readme = read("README.md");

assert.match(home, /primaryHome/);
assert.match(home, /ownedHomeAsset/);
assert.match(home, /ownedByPlayer/);
assert.match(home, /export function ringDoorbell/);
assert.match(home, /addVisitorToScene/);
assert.match(home, /uie:doorbell/);
assert.doesNotMatch(home, /generateContent|apiClient|\bfetch\s*\(/);
for (const action of ["answer", "admit", "turn-away", "ignore"]) assert.match(template, new RegExp(`data-home-door="${action}"`));
for (const action of ["kitchen", "storage", "wardrobe", "rest", "property", "social", "map", "homestead"]) assert.match(template, new RegExp(`data-home-action="${action}"`));
assert.match(startup, /player_home/);
assert.match(startup, /initPlayerHome/);
assert.match(tutorial, /#uie-player-home-window/);
assert.match(manual, /guide-player-home/);
assert.match(helper, /PLAYER HOME AND DOORBELL/);
assert.match(readme, /\*\*Player Home\*\*/);
console.log("Player-home integration contracts passed.");
