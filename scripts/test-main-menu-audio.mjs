import assert from "node:assert/strict";
import fs from "node:fs";

const game = fs.readFileSync("game.html", "utf8");
assert.match(game, /id="start-menu-music-toggle"/);
assert.match(game, /aria-pressed/);
assert.match(game, /function setMenuMusicEnabled/);
assert.match(game, /realityEngine\.audio\.enabled/);
assert.match(game, /if \(enabled\) playMainMenuBgm\(\); else stopMainMenuBgm\(\)/);
assert.match(game, /let _mainMenuBgmEpoch = 0/);
assert.match(game, /const playbackEpoch = \+\+_mainMenuBgmEpoch/);
assert.match(game, /playbackEpoch !== _mainMenuBgmEpoch \|\| window\.__uieGameplayActive === true/);
assert.match(game, /\$\(document\)\.on\("click", "\.load-slot-btn", function\(\) \{\s*stopMainMenuBgm\(\)/);
assert.match(game, /function stopMainMenuBgm\(\) \{\s*_mainMenuBgmEpoch \+= 1/);
console.log("main-menu music control: ok");
