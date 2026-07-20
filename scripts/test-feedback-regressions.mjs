import assert from "node:assert/strict";
import fs from "node:fs";

const game = fs.readFileSync("game.html", "utf8");
const stateMutator = fs.readFileSync("src/modules/stateMutator.js", "utf8");
const map = fs.readFileSync("src/modules/map.js", "utf8");
const objects = fs.readFileSync("src/modules/objectAutoRenderer.js", "utf8");
const battle = fs.readFileSync("src/modules/battle.js", "utf8");
const backend = fs.readFileSync("python/uie_backend.py", "utf8");

const emptyReplyBranch = game.match(/if\s*\(!cleanReply\)\s*\{[\s\S]*?\n\s*\}/)?.[0] || "";
assert.match(emptyReplyBranch, /finishSendCycle\(\)/, "an empty provider response must release the send lock");

const narrativeGate = stateMutator.indexOf("if (!visibleNarrative)");
const mutation = stateMutator.indexOf("processStateUpdates(data.state_updates)", narrativeGate);
assert.ok(narrativeGate >= 0 && mutation > narrativeGate, "mechanics must not apply before readable narrative validation");
assert.match(map, /Ignored a location-change ping without readable arrival narration/, "silent model pings must not move the player");

assert.match(map, /queueContextualObjectsForLocation/, "location movement must queue contextual objects");
assert.match(objects, /unplacedItems/, "generated objects must enter the unplaced Objects inventory");
assert.match(objects, /placeQueuedObjectInRoom/, "queued objects must support free placement");
assert.match(game, /UIE_beginObjectPlacement/, "the Objects tab must expose free placement");

assert.match(battle, /Defeat — You Survived/, "ordinary defeat must be presented as survivable");
assert.match(battle, /permadeathEnabled/, "battle defeat must respect active permadeath");
assert.match(battle, /enemyShouldYield/, "enemies must be able to yield instead of requiring death");
assert.match(battle, /tryUseEnemyBattleItem/, "enemies must be able to use carried battle items");
assert.match(battle, /equipment:\s*enemy\.equipment/, "FastAPI plans must receive enemy equipment");
assert.match(backend, /profile = payload\.context\.get\("enemyProfile"/, "generated enemies must be accepted by the FastAPI battle planner");
assert.match(backend, /ENEMY_EQUIPMENT/, "backend enemy generation must include equipment knowledge");
assert.match(backend, /ENEMY_OBJECTIVES/, "backend enemy generation must include non-kill objectives");

console.log("feedback regression tests: ok");
