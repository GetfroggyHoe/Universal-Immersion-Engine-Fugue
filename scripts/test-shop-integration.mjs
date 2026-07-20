import assert from "node:assert/strict";
import fs from "node:fs";

const shop = fs.readFileSync(new URL("../src/modules/shop.js", import.meta.url), "utf8");
const template = fs.readFileSync(new URL("../src/templates/shop.html", import.meta.url), "utf8");
const npc = fs.readFileSync(new URL("../src/modules/npcManagementModal.js", import.meta.url), "utf8");
const startup = fs.readFileSync(new URL("../src/modules/startup.js", import.meta.url), "utf8");
const game = fs.readFileSync(new URL("../game.html", import.meta.url), "utf8");

assert.match(shop, /const SHOP_WORDS[\s\S]*shop[\s\S]*store[\s\S]*retail/);
assert.match(shop, /uie:state_updated\.uieShop/);
assert.match(shop, /openContextShop\(context/);
assert.match(shop, /proceduralCatalog/);
assert.match(shop, /generateContent/);
assert.match(shop, /registerNPCRecord/);
assert.match(shop, /s\.shop\.locations/);
assert.match(shop, /uie-shop-mode-sell/);
assert.match(template, /id="uie-shopkeeper-panel"/);
assert.match(template, /id="uie-shop-mode-buy"/);
assert.match(template, /id="uie-shop-mode-sell"/);
assert.match(template, /id="uie-shop-search"/);
assert.match(npc, /export function registerNPCRecord/);
assert.match(npc, /export function syncActiveCharacterCardsToNpcs/);
assert.match(npc, /secrets remain stored[\s\S]*not rendered by Social/i);
assert.match(startup, /import\("\.\/shop\.js"\)[\s\S]*initShop/);
assert.match(startup, /src\/templates\/shop\.html/);
assert.doesNotMatch(game, /s\.ai\.shop\s*=\s*false/);
assert.match(game, /shop:\s*aiNeedsIn\.shop\s*!==\s*false/);

console.log("shop integration tests: ok");
