import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const gamePath = path.join(root, "game.html");
const menuPath = path.join(root, "src", "templates", "hamburger_menu.html");
const inventoryPath = path.join(root, "src", "templates", "inventory.html");
const calendarPath = path.join(root, "src", "templates", "calendar.html");
const socialPath = path.join(root, "src", "templates", "social.html");
const phonePath = path.join(root, "src", "templates", "phone.html");

let game = fs.readFileSync(gamePath, "utf8");
const menu = fs.readFileSync(menuPath, "utf8").trimEnd();
const inventory = fs.readFileSync(inventoryPath, "utf8").trimEnd();
const calendar = fs.readFileSync(calendarPath, "utf8").trimEnd();
const social = fs.readFileSync(socialPath, "utf8").trimEnd();
const phone = fs.readFileSync(phonePath, "utf8").trimEnd();

const calendarStart = [
  game.indexOf("<style>\n  /* Stardew Valley cozy wood-parchment theme */"),
  game.indexOf("<style>\r\n  /* Stardew Valley cozy wood-parchment theme */"),
  game.indexOf("<style>\n  #cal-toolbar"),
  game.indexOf("<style>\r\n  #cal-toolbar")
].find((index) => index >= 0) ?? -1;
const calendarEnd = game.indexOf('<div id="uie-main-menu"', calendarStart);
if (calendarStart < 0 || calendarEnd < 0) {
  throw new Error(`sync-ui-embeds: embedded calendar boundaries not found (calendarStart=${calendarStart}, calendarEnd=${calendarEnd})`);
}

game = `${game.slice(0, calendarStart)}${calendar}\n\n${game.slice(calendarEnd)}`;

const menuStart = game.indexOf('<div id="uie-main-menu"');
const menuEnd = game.indexOf('<div id="uie-inventory-window"', menuStart);

if (menuStart < 0 || menuEnd < 0) {
  throw new Error("sync-ui-embeds: embedded menu boundaries not found");
}

game = `${game.slice(0, menuStart)}${menu}\n\n${game.slice(menuEnd)}`;

const inventoryStart = game.indexOf('<div id="uie-inventory-window"');
const inventoryEnd = game.indexOf('<div id="uie-social-window"', inventoryStart);
if (inventoryStart < 0 || inventoryEnd < 0) {
  throw new Error("sync-ui-embeds: embedded inventory boundaries not found");
}

game = `${game.slice(0, inventoryStart)}${inventory}\n\n${game.slice(inventoryEnd)}`;

const socialStart = game.indexOf('<div id="uie-social-window"');
const socialEnd = game.indexOf('<div id="re-quick-modal"', socialStart);
if (socialStart < 0 || socialEnd < 0) {
  throw new Error("sync-ui-embeds: embedded social boundaries not found");
}

game = `${game.slice(0, socialStart)}${social}\n\n${game.slice(socialEnd)}`;

const phoneStart = game.indexOf('<div id="uie-phone-window"');
if (phoneStart >= 0) {
  // The generated phone template is appended immediately before </body>. Replacing
  // that tail is robust to its nested divs and to either LF or CRLF line endings.
  const bodyEnd = game.lastIndexOf('</body>');
  if (bodyEnd < phoneStart) throw new Error("sync-ui-embeds: embedded phone body boundary not found");
  game = `${game.slice(0, phoneStart)}${phone}\n\n${game.slice(bodyEnd)}`;
} else {
  const bodyEnd = game.lastIndexOf('</body>');
  if (bodyEnd < 0) throw new Error("sync-ui-embeds: game body end not found for phone template");
  game = `${game.slice(0, bodyEnd)}\n${phone}\n\n${game.slice(bodyEnd)}`;
}

fs.writeFileSync(gamePath, game);
console.log("sync-ui-embeds: ok");
