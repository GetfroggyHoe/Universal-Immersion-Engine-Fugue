import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const gamePath = path.join(root, "game.html");
const mapPath = path.join(root, "src", "templates", "map.html");

let g = fs.readFileSync(gamePath, "utf8");
const m = fs.readFileSync(mapPath, "utf8").trimEnd();
const marker = "    <!-- World map shell: same markup as src/templates/map.html. -->";
const markerMatch = /[ \t]*<!-- World map shell: same markup as src\/templates\/map\.html\. -->/.exec(g);
const start = markerMatch ? markerMatch.index : -1;
let end = start >= 0 ? g.indexOf("    <!-- Calendar UI:", start) : -1;
if (start >= 0 && end < 0) {
    end = g.indexOf("\n<style>\n  #cal-toolbar", start);
}
if (start >= 0 && end < 0) {
    end = g.indexOf("\r\n<style>\r\n  #cal-toolbar", start);
}
if (start >= 0 && end < 0) {
    const calendarStyle = /[\r\n]+<style>[\r\n]+[ \t]*\/\* Stardew Valley cozy wood-parchment theme \*\//g;
    calendarStyle.lastIndex = start;
    const calendarStyleMatch = calendarStyle.exec(g);
    end = calendarStyleMatch ? calendarStyleMatch.index + (calendarStyleMatch[0].startsWith("\r\n") ? 2 : 1) : -1;
}
if (start < 0 || end < 0) {
    console.error("sync-map-embed: map shell markers not found");
    process.exit(1);
}
g = `${g.slice(0, start)}${marker}\n${m}\n${g.slice(end)}`;
fs.writeFileSync(gamePath, g);
console.log("sync-map-embed: ok");
