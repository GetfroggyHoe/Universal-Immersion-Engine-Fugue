import assert from "node:assert/strict";
import fs from "node:fs";

const map = fs.readFileSync("src/modules/map.js", "utf8");
const backend = fs.readFileSync("python/uie_backend.py", "utf8");
assert.equal(/generateContent/.test(map), false, "map generation must not call the browser model client");
assert.equal(/payload:\s*node/.test(map), false, "map sync must not send raw nodes");
assert.match(map, /serializeMapNodeForBackend/, "map sync needs an allowlisted serializer");
assert.match(map, /generateMapLocation/, "adjacent generation must use FastAPI");
assert.match(map, /generateMapWorld/, "world generation must use FastAPI");
assert.match(map, /compactGenerationContext\(context\)/, "generation boundary must compact all adjacent context");
assert.match(backend, /@app\.post\("\/map\/generate-location"\)/);
assert.match(backend, /@app\.post\("\/map\/generate-world"\)/);
console.log("map generation boundaries: ok");
