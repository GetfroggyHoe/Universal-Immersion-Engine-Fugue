import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const launcher = fs.readFileSync("dev-server.mjs", "utf8");
const windows = fs.readFileSync("uie.bat", "utf8");
const unix = fs.readFileSync("start.sh", "utf8");
const readme = fs.readFileSync("README.md", "utf8");
const ignore = fs.readFileSync(".gitignore", "utf8");
assert.match(ignore, /^\.venv\/$/m);
assert.match(launcher, /Scripts\/python\.exe/);
assert.match(launcher, /bin\/python/);
assert.match(launcher, /const args = \["-m", "venv"\]/);
assert.match(launcher, /args\.push\(venvDir\)/);
assert.match(launcher, /UIE_VENV_DIR/);
assert.match(launcher, /uie-requirements\.sha256/);
assert.match(launcher, /import fastapi, uvicorn/);
assert.match(launcher, /import python\.uie_backend/);
assert.match(launcher, /requirements-backend\.txt/);
assert.match(launcher, /Python environment setup is required/);
assert.match(launcher, /Create\/update \.venv and install the missing Python packages now/);
assert.match(launcher, /fresh downloads and upgrades from pre-\.venv releases/);
assert.match(launcher, /UIE_VENV_SETUP/);
assert.match(launcher, /stdio: options\.inherit \? "inherit" : "pipe"/);
assert.match(launcher, /process\.kill\(lockPid, 0\)/);
assert.match(launcher, /ensureVenvPip/);
assert.match(launcher, /"-m", "ensurepip", "--upgrade"/);
assert.match(launcher, /args\.includes\("--prepare-only"\)/);
assert.match(launcher, /expectedText = ""/);
assert.match(launcher, /<title>UIE: Fugue<\/title>/);
assert.match(launcher, /openLocalBrowser\(`http:\/\/localhost:/);
assert.doesNotMatch(windows, /pip install/);
assert.doesNotMatch(windows, /taskkill/);
assert.match(windows, /--open/);
assert.match(windows, /--prepare-only --no-image-service/);
assert.match(windows, /UIE_AUTO_START_BACKEND=0/);
assert.match(windows, /Continue in reduced offline\/procedural mode anyway\? \[y\/N\]/);
assert.match(windows, /Press any key to close this launcher window/);
assert.match(windows, /winget install --id OpenJS\.NodeJS\.LTS/);
assert.match(windows, /winget install --id Python\.Python\.3\.13/);
assert.doesNotMatch(unix, /pip install/);
assert.match(unix, /--prepare-only --no-image-service/);
assert.match(unix, /UIE_AUTO_START_BACKEND=0/);
assert.match(unix, /Continue in reduced offline\/procedural mode anyway/);
assert.match(unix, /pkg install nodejs-lts -y/);
assert.match(unix, /pkg install python -y/);
assert.match(unix, /apt-get install -y python3 python3-venv python3-pip/);
assert.match(readme, /^## UPDATE: `\.venv` is now part of setup$/m);
assert.match(readme, /run your normal `git pull`/);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "uie-venv-prompt-"));
const missingVenv = path.join(sandbox, ".venv");
try {
  const declined = spawnSync(process.execPath, ["dev-server.mjs", "--prepare-only", "--no-image-service"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, UIE_VENV_DIR: missingVenv, UIE_VENV_SETUP: "0" },
  });
  const output = `${declined.stdout || ""}\n${declined.stderr || ""}`;
  assert.equal(declined.status, 1, output);
  assert.match(output, /Python environment setup is required/);
  assert.match(output, /setup was declined/);
  assert.equal(fs.existsSync(missingVenv), false, "declining setup must not create .venv");

  const unavailablePythonVenv = path.join(sandbox, ".venv-no-python");
  const noPython = spawnSync(process.execPath, ["dev-server.mjs", "--prepare-only", "--no-image-service"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: "",
      Path: "",
      LOCALAPPDATA: "",
      ProgramFiles: "",
      PYTHON: "uie-python-not-installed",
      UIE_VENV_DIR: unavailablePythonVenv,
      UIE_VENV_SETUP: "1",
    },
  });
  const noPythonOutput = `${noPython.stdout || ""}\n${noPython.stderr || ""}`;
  assert.equal(noPython.status, 1, noPythonOutput);
  assert.match(noPythonOutput, /Python 3\.10 or newer was not found/);
  assert.match(noPythonOutput, /automatic Python installation cannot continue/);
  assert.equal(fs.existsSync(unavailablePythonVenv), false, "missing base Python must not leave a partial .venv");
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
console.log("launcher virtual environment: ok");
