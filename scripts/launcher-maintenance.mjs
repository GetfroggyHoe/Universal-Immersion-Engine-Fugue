import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: options.timeout ?? 30_000,
    stdio: options.inherit ? "inherit" : "pipe",
  });
}

function commandExists(command) {
  const probe = run(command, ["--version"], { timeout: 5_000 });
  return !probe.error && probe.status === 0;
}

async function askYesNo(question, defaultYes = false) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return defaultYes;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = defaultYes ? "[Y/n]" : "[y/N]";
    const answer = (await rl.question(`${question} ${suffix}: `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function checkGitHubUpdates() {
  if (!fs.existsSync(path.join(root, ".git"))) {
    console.log("[updates] This copy has no .git metadata (usually a downloaded ZIP), so automatic GitHub update checks are unavailable.");
    return;
  }
  if (!commandExists("git")) {
    console.log("[updates] Git is not installed; skipping the GitHub update check.");
    return;
  }
  const upstream = run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  if (upstream.status !== 0) {
    console.log("[updates] No upstream GitHub branch is configured; skipping the update check.");
    return;
  }
  const remoteBranch = String(upstream.stdout || "").trim();
  const fetch = run("git", ["fetch", "--quiet"], { timeout: 45_000 });
  if (fetch.status !== 0) {
    console.log(`[updates] Could not contact the configured Git remote: ${String(fetch.stderr || "network or authentication error").trim()}`);
    return;
  }
  const counts = run("git", ["rev-list", "--left-right", "--count", `HEAD...${remoteBranch}`]);
  const [ahead, behind] = String(counts.stdout || "").trim().split(/\s+/).map(Number);
  if (!Number.isFinite(behind) || behind <= 0) {
    console.log(ahead > 0
      ? `[updates] Local branch is ${ahead} commit(s) ahead; no remote update is waiting.`
      : "[updates] Repository is up to date.");
    return;
  }
  console.log(`[updates] ${behind} GitHub update commit(s) are available from ${remoteBranch}.`);
  const wantsUpdate = await askYesNo("Install the available repository update now?");
  if (!wantsUpdate) {
    console.log("[updates] Update declined. Continuing with the current version.");
    return;
  }
  const dirty = run("git", ["status", "--porcelain"]);
  if (String(dirty.stdout || "").trim()) {
    console.log("[updates] Update not applied because local files have changes. Commit or back them up, then launch again.");
    return;
  }
  const pull = run("git", ["pull", "--ff-only"], { inherit: true, timeout: 120_000 });
  if (pull.status !== 0) {
    console.log("[updates] Git could not fast-forward safely. The current version was left unchanged.");
    return;
  }
  console.log("[updates] Repository update installed. The launcher will now check .venv and all declared dependencies.");
}

function dependencyFingerprint(packageJson, lockText) {
  const declared = {
    dependencies: packageJson.dependencies || {},
    devDependencies: packageJson.devDependencies || {},
    optionalDependencies: packageJson.optionalDependencies || {},
    peerDependencies: packageJson.peerDependencies || {},
  };
  return crypto.createHash("sha256")
    .update(JSON.stringify(declared))
    .update("\n")
    .update(lockText)
    .digest("hex");
}

function dependencyCount(packageJson) {
  return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
    .reduce((total, key) => total + Object.keys(packageJson[key] || {}).length, 0);
}

async function ensureNodeDependencies() {
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(packagePath)) {
    console.log("[npm] package.json is missing; no Node dependency install was attempted.");
    return;
  }
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const count = dependencyCount(packageJson);
  if (count === 0) {
    console.log("[npm] No Node packages are declared. Skipping npm completely.");
    return;
  }
  if (!commandExists("npm")) {
    console.log("[npm] Dependencies are declared, but npm is unavailable. Install npm and launch again.");
    return;
  }
  const lockPath = path.join(root, "package-lock.json");
  const lockText = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, "utf8") : "";
  const fingerprint = dependencyFingerprint(packageJson, lockText);
  const markerPath = path.join(root, "node_modules", ".uie-dependencies.sha256");
  const previous = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf8").trim() : "";
  if (previous === fingerprint && fs.existsSync(path.join(root, "node_modules"))) {
    console.log("[npm] Node dependencies are unchanged; reusing the existing install.");
    return;
  }
  const commandArgs = lockText ? ["ci", "--no-audit", "--no-fund"] : ["install", "--no-audit", "--no-fund"];
  console.log(`[npm] ${count} declared Node package(s) are missing or changed.`);
  const approved = await askYesNo(`Download and install the required Node packages with npm ${commandArgs[0]} now?`, true);
  if (!approved) {
    console.log("[npm] Node dependency installation was declined. Features that need those packages may not start.");
    return;
  }
  console.log(`[npm] Dependency definitions changed; running npm ${commandArgs[0]} once...`);
  const install = run("npm", commandArgs, { inherit: true, timeout: 300_000 });
  if (install.status !== 0) {
    console.log("[npm] Installation failed. The launcher will continue, but features requiring Node packages may be unavailable.");
    return;
  }
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, `${fingerprint}\n`);
  console.log("[npm] Node dependencies are ready.");
}

if (args.has("--updates")) await checkGitHubUpdates();
if (args.has("--npm")) await ensureNodeDependencies();
