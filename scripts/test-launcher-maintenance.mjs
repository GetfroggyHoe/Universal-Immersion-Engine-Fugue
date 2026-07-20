import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const helper = fs.readFileSync("scripts/launcher-maintenance.mjs", "utf8");
const windows = fs.readFileSync("uie.bat", "utf8");
const unix = fs.readFileSync("start.sh", "utf8");

assert.match(helper, /git", \["fetch", "--quiet"\]/);
assert.match(helper, /Install the available repository update now/);
assert.match(helper, /launcher will now check \.venv and all declared dependencies/);
assert.match(helper, /git", \["pull", "--ff-only"\]/);
assert.match(helper, /dependencyFingerprint/);
assert.match(helper, /Download and install the required Node packages/);
assert.match(helper, /No Node packages are declared\. Skipping npm completely/);
assert.doesNotMatch(windows, /call npm install/);
assert.doesNotMatch(unix, /^\s*npm install/m);

const result = spawnSync(process.execPath, ["scripts/launcher-maintenance.mjs", "--npm"], {
  encoding: "utf8",
});
assert.equal(result.status, 0);
assert.match(result.stdout, /Skipping npm completely/);
console.log("launcher maintenance: ok");
