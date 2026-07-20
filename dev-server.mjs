import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;

const args = process.argv.slice(2);
const getArgValue = (key, fallback) => {
  const idx = args.indexOf(key);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return fallback;
};

const host = getArgValue("--host", "localhost");
const port = Number.parseInt(getArgValue("--port", "8093"), 10) || 8093;
const reuseExistingServer = args.includes("--reuse-existing");
const backendHost = getArgValue("--backend-host", process.env.UIE_BACKEND_HOST || "127.0.0.1");
const configuredBackendPort = Number.parseInt(getArgValue("--backend-port", process.env.UIE_BACKEND_PORT || "28101"), 10) || 28101;
let activeBackendPort = configuredBackendPort;
let shouldAutoStartBackend = !args.includes("--no-backend") && process.env.UIE_AUTO_START_BACKEND !== "0";
const configuredPython = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const venvDir = path.resolve(process.env.UIE_VENV_DIR || path.join(rootDir, ".venv"));
const venvPython = path.join(venvDir, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const requirementsPath = path.join(rootDir, "python", "requirements-backend.txt");
const venvMarker = path.join(venvDir, ".uie-requirements.sha256");
const venvInstallLock = path.join(venvDir, ".uie-install-lock");
let pythonCmd = venvPython;
let backendProcess = null;
let selectedBasePython = null;
let backendStartupState = "pending";
let backendStartupError = "";
const REQUIRED_BACKEND_PACKAGES = [
  "websockets>=12,<16",
  "wsproto>=1.2,<2",
  "numpy>=1.26,<3",
  "scipy>=1.11,<2",
  "onnxruntime>=1.16,<2",
  "sentencepiece>=0.2,<1",
  "soundfile>=0.12,<1",
  "safetensors>=0.4,<1",
  "kokoro-onnx>=0.5,<1",
];
const BACKEND_INSTALL_SCHEMA = "uie-backend-v6-voicebridge-runtime";
const CORE_IMPORT_CHECK = "import fastapi, uvicorn, pydantic, pydantic_core, websockets, wsproto, numpy, scipy, onnxruntime, soundfile, sentencepiece, kokoro_onnx; from uvicorn.protocols.websockets.wsproto_impl import WSProtocol; import python.pocket_tts_onnx; import python.uie_backend";
const PYTHON_VERSION_CHECK = "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')";

async function askYesNo(question, defaultYes = false) {
  const configuredAnswer = String(process.env.UIE_VENV_SETUP || "").trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(configuredAnswer)) return true;
  if (["0", "false", "no", "n"].includes(configuredAnswer)) return false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log("[setup] No interactive terminal is available; continuing with the safe default (install locally). Set UIE_VENV_SETUP=0 to opt out.");
    return true;
  }
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

function runPython(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    shell: false,
    stdio: options.inherit ? "inherit" : "pipe",
  });
}

function parsedPythonVersion(result) {
  if (result?.error || result?.status !== 0) return null;
  const text = String(result.stdout || "").trim();
  const [major, minor] = text.split(".").map(Number);
  return { text, supported: major === 3 && minor >= 10 };
}

function resolveBasePython() {
  if (selectedBasePython) return selectedBasePython;
  const candidates = [
    { command: configuredPython, prefixArgs: [] },
    ...(process.platform === "win32" ? ["3.13", "3.12", "3.11", "3.10", "3"].map((version) => ({ command: "py", prefixArgs: [`-${version}`] })) : []),
    ...(process.platform === "win32" ? [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Python", "Python313", "python.exe") : "",
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Python313", "python.exe") : "",
    ].filter(Boolean).map((command) => ({ command, prefixArgs: [] })) : []),
    { command: process.platform === "win32" ? "python" : "python3", prefixArgs: [] },
    ...(process.platform === "win32" ? [] : [{ command: "python", prefixArgs: [] }]),
  ];
  const seen = new Set();
  const unsupported = [];
  for (const candidate of candidates) {
    const key = `${candidate.command}\0${candidate.prefixArgs.join("\0")}`;
    if (!candidate.command || seen.has(key)) continue;
    seen.add(key);
    const result = runPython(candidate.command, [...candidate.prefixArgs, "-c", PYTHON_VERSION_CHECK]);
    const version = parsedPythonVersion(result);
    if (version?.supported) {
      selectedBasePython = candidate;
      return candidate;
    }
    if (version?.text) unsupported.push(version.text);
  }
  if (unsupported.length) throw new Error(`Only unsupported Python version(s) were found (${[...new Set(unsupported)].join(", ")}); Python 3.10 or newer is required.`);
  throw new Error("Python 3.10 or newer was not found.");
}

async function ensureBasePythonAvailable() {
  try {
    return resolveBasePython();
  } catch (initialError) {
    if (process.platform !== "win32") {
      throw new Error(`${initialError.message} Run ./start.sh to install missing system prerequisites automatically.`);
    }
    const winget = spawnSync("winget", ["--version"], { encoding: "utf8", shell: false });
    if (winget.error || winget.status !== 0) {
      throw new Error(`${initialError.message} Windows Package Manager (winget) is unavailable, so automatic Python installation cannot continue.`);
    }
    const approved = await askYesNo("Python 3.13 is missing. Download and install it automatically now?", true);
    if (!approved) throw new Error("Automatic Python installation was declined. Run this launcher again when ready.");
    console.log("[setup] Installing Python 3.13 with Windows Package Manager...");
    const install = spawnSync("winget", [
      "install", "--id", "Python.Python.3.13", "-e", "--source", "winget",
      "--accept-package-agreements", "--accept-source-agreements", "--silent",
    ], { cwd: rootDir, stdio: "inherit", shell: false, timeout: 600_000 });
    if (install.error || install.status !== 0) throw new Error("Windows Package Manager could not install Python 3.13.");
    selectedBasePython = null;
    return resolveBasePython();
  }
}

function runBasePython(args, options = {}) {
  const base = resolveBasePython();
  return runPython(base.command, [...base.prefixArgs, ...args], options);
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function createOrRepairVenv(clearExisting = false) {
  console.log(clearExisting
    ? "[backend] Repairing the incomplete project-local .venv..."
    : "[backend] Creating project-local .venv...");
  const args = ["-m", "venv"];
  if (clearExisting) args.push("--clear");
  if (process.env.PREFIX && process.env.PREFIX.includes("com.termux")) { args.push("--system-site-packages"); }
  args.push(venvDir);
  const created = runBasePython(args, { inherit: true });
  if (created.error || created.status !== 0) {
    throw new Error(`Could not ${clearExisting ? "repair" : "create"} .venv${created.error?.message ? `: ${created.error.message}` : ""}.`);
  }
}

function ensureVenvPip() {
  let pip = runPython(venvPython, ["-m", "pip", "--version"]);
  if (pip.status === 0) return;
  console.log("[backend] pip is missing from .venv; installing it with ensurepip...");
  const ensured = runPython(venvPython, ["-m", "ensurepip", "--upgrade"], { inherit: true });
  pip = runPython(venvPython, ["-m", "pip", "--version"]);
  if (ensured.status === 0 && pip.status === 0) return;
  createOrRepairVenv(true);
  pip = runPython(venvPython, ["-m", "pip", "--version"]);
  if (pip.status !== 0) throw new Error("The repaired .venv does not contain pip.");
}

async function acquireVenvInstallLock() {
  await fs.mkdir(path.dirname(venvInstallLock), { recursive: true });
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const handle = await fs.open(venvInstallLock, "wx");
      await handle.writeFile(`${process.pid}\n`);
      return handle;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const lockPid = Number.parseInt((await fs.readFile(venvInstallLock, "utf8")).trim(), 10);
        if (Number.isFinite(lockPid)) process.kill(lockPid, 0);
      } catch {
        await fs.unlink(venvInstallLock).catch(() => {});
        continue;
      }
      const ready = runPython(venvPython, ["-c", CORE_IMPORT_CHECK]);
      if (ready.status === 0) return null;
      if (attempt === 0) console.log("[backend] Another launcher is preparing .venv; waiting for it to finish...");
      await wait(1_000);
    }
  }
  throw new Error("Timed out waiting for another .venv dependency installation.");
}

function openLocalBrowser(url) {
  if (!args.includes("--open")) return;
  let command = "";
  let commandArgs = [];
  if (process.platform === "win32") {
    command = "cmd.exe";
    commandArgs = ["/d", "/s", "/c", "start", "", url];
  } else if (process.platform === "darwin") {
    command = "open";
    commandArgs = [url];
  } else if (process.env.TERMUX_VERSION) {
    command = "termux-open-url";
    commandArgs = [url];
  } else {
    command = "xdg-open";
    commandArgs = [url];
  }
  try {
    const opener = spawn(command, commandArgs, {
      cwd: rootDir,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    opener.unref();
  } catch (error) {
    console.warn(`[launcher] Could not open the browser automatically: ${error?.message || error}`);
  }
}

const isTermux = Boolean(
  process.env.TERMUX_VERSION ||
  (process.env.PREFIX && process.env.PREFIX.includes("com.termux"))
);

const PROOT_DISTRO_NAME = process.env.UIE_PROOT_DISTRO || "uie-debian";
const PROOT_APP_DIR = "/app";
const PROOT_VENV_DIR = "/root/uie-venv";
const PROOT_PYTHON = `${PROOT_VENV_DIR}/bin/python`;
const PROOT_SETUP_MARKER = "/root/.uie-proot-setup-v3";
const PROOT_CLEAN_ENV = [
  "/usr/bin/env", "-i",
  "HOME=/root",
  "USER=root",
  "LOGNAME=root",
  "SHELL=/bin/bash",
  `TERM=${process.env.TERM || "xterm-256color"}`,
  "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  "TMPDIR=/tmp",
  `PYTHONPATH=${PROOT_APP_DIR}`,
];
const PROOT_IMPORT_CHECK = `import sys; sys.path.insert(0, ${JSON.stringify(PROOT_APP_DIR)}); ${CORE_IMPORT_CHECK}`;
const PROOT_PLATFORM_CHECK = [
  "import sys, sysconfig",
  "soabi = str(sysconfig.get_config_var('SOABI') or '')",
  "print(sys.executable)",
  "print(sys.platform)",
  "print(soabi)",
  "raise SystemExit(0 if sys.platform == 'linux' and 'android' not in soabi.lower() else 1)",
].join("; ");

function prootLoginArgs(commandArgs, { bindApp = true, cleanEnv = true } = {}) {
  const command = ["login", PROOT_DISTRO_NAME];
  if (bindApp) command.push("--bind", `${rootDir}:${PROOT_APP_DIR}`);
  command.push("--");
  if (cleanEnv) command.push(...PROOT_CLEAN_ENV);
  command.push(...commandArgs);
  return command;
}

function runProot(commandArgs, options = {}) {
  const { bindApp = true, cleanEnv = true, inherit = false, timeout } = options;
  return spawnSync(
    "proot-distro",
    prootLoginArgs(commandArgs, { bindApp, cleanEnv }),
    {
      cwd: rootDir,
      encoding: inherit ? undefined : "utf8",
      stdio: inherit ? "inherit" : "pipe",
      shell: false,
      timeout,
    },
  );
}

function spawnProot(commandArgs, options = {}) {
  return spawn(
    "proot-distro",
    prootLoginArgs(commandArgs),
    {
      cwd: rootDir,
      stdio: options.stdio || "inherit",
      shell: false,
      windowsHide: true,
    },
  );
}

function commandSucceeded(result) {
  return !result?.error && result?.status === 0;
}

function installDedicatedProotDistro() {
  console.log(`[setup] Installing dedicated Debian environment '${PROOT_DISTRO_NAME}'...`);
  const installed = spawnSync(
    "proot-distro",
    ["install", "debian", "--name", PROOT_DISTRO_NAME],
    { cwd: rootDir, stdio: "inherit", shell: false },
  );
  if (!commandSucceeded(installed)) {
    throw new Error(`Failed to install dedicated PRoot Debian environment '${PROOT_DISTRO_NAME}'.`);
  }
}

function dedicatedProotExists() {
  const check = spawnSync(
    "proot-distro",
    ["login", PROOT_DISTRO_NAME, "--", "/bin/sh", "-c", "exit 0"],
    { cwd: rootDir, encoding: "utf8", shell: false },
  );
  return commandSucceeded(check);
}

function ensureProotBasePackages() {
  const ready = runProot(
    ["/bin/sh", "-c", `test -f ${PROOT_SETUP_MARKER} && test -x /usr/bin/python3`],
    { bindApp: false, cleanEnv: false },
  );
  if (commandSucceeded(ready)) return;

  console.log("[setup] Initializing Debian Python environment...");
  const aptUpdate = runProot(
    ["/usr/bin/apt-get", "update"],
    { bindApp: false, cleanEnv: false, inherit: true, timeout: 900_000 },
  );
  if (!commandSucceeded(aptUpdate)) {
    throw new Error("Failed to update packages inside the dedicated Debian environment.");
  }

  const aptInstall = runProot(
    ["/usr/bin/apt-get", "install", "-y", "python3", "python3-pip", "python3-venv", "ca-certificates", "libgomp1", "libsndfile1", "espeak-ng"],
    { bindApp: false, cleanEnv: false, inherit: true, timeout: 900_000 },
  );
  if (!commandSucceeded(aptInstall)) {
    throw new Error("Failed to install Debian Python, pip, or venv support.");
  }

  const marked = runProot(
    ["/usr/bin/touch", PROOT_SETUP_MARKER],
    { bindApp: false, cleanEnv: false },
  );
  if (!commandSucceeded(marked)) {
    throw new Error("Debian setup completed, but its setup marker could not be written.");
  }
}

function validateGuestPython() {
  return runProot(
    ["/usr/bin/python3", "-c", PROOT_PLATFORM_CHECK],
    { bindApp: false, cleanEnv: true },
  );
}

function resetDedicatedProotDistro() {
  console.warn(`[setup] '${PROOT_DISTRO_NAME}' is incomplete or is using Android Python. Rebuilding this UIE-only environment automatically...`);
  const removed = spawnSync(
    "proot-distro",
    ["remove", PROOT_DISTRO_NAME],
    { cwd: rootDir, stdio: "inherit", shell: false },
  );
  if (!commandSucceeded(removed)) {
    throw new Error(`Could not remove the invalid UIE PRoot environment '${PROOT_DISTRO_NAME}'.`);
  }
  installDedicatedProotDistro();
  ensureProotBasePackages();
}

function ensureDedicatedProotDistro() {
  const pdCheck = spawnSync(
    "sh",
    ["-lc", "command -v proot-distro >/dev/null 2>&1"],
    { cwd: rootDir, encoding: "utf8", shell: false },
  );
  if (!commandSucceeded(pdCheck)) {
    console.log("[setup] Installing proot-distro...");
    const pdInstall = spawnSync(
      "pkg",
      ["install", "proot-distro", "-y"],
      { cwd: rootDir, stdio: "inherit", shell: false },
    );
    if (!commandSucceeded(pdInstall)) {
      throw new Error("Failed to install proot-distro through Termux pkg.");
    }
  }

  if (!dedicatedProotExists()) {
    // A container with this name may exist but be unusable. Because the name is
    // UIE-specific, it is safe to remove that broken instance and recreate it.
    spawnSync(
      "proot-distro",
      ["remove", PROOT_DISTRO_NAME],
      { cwd: rootDir, stdio: "ignore", shell: false },
    );
    installDedicatedProotDistro();
  }
  ensureProotBasePackages();

  let pythonCheck = validateGuestPython();
  if (!commandSucceeded(pythonCheck)) {
    resetDedicatedProotDistro();
    pythonCheck = validateGuestPython();
  }
  if (!commandSucceeded(pythonCheck)) {
    const details = `${pythonCheck?.stdout || ""}${pythonCheck?.stderr || ""}`.trim();
    throw new Error(`The dedicated Debian environment does not provide Linux Python${details ? `: ${details}` : "."}`);
  }
}

function ensureProotVenv() {
  let venvCheck = runProot([PROOT_PYTHON, "-c", PROOT_PLATFORM_CHECK]);
  if (commandSucceeded(venvCheck)) return;

  console.log(`[setup] Creating isolated backend environment at ${PROOT_VENV_DIR}...`);
  runProot(["/bin/rm", "-rf", PROOT_VENV_DIR], { bindApp: false });
  const created = runProot(
    ["/usr/bin/python3", "-m", "venv", "--copies", PROOT_VENV_DIR],
    { bindApp: false, inherit: true },
  );
  if (!commandSucceeded(created)) {
    throw new Error("Failed to create the isolated Python environment inside Debian.");
  }

  venvCheck = runProot([PROOT_PYTHON, "-c", PROOT_PLATFORM_CHECK]);
  if (!commandSucceeded(venvCheck)) {
    throw new Error("The newly created Debian venv is not using Linux Python.");
  }
}

async function prepareProotDebian() {
  console.log(`[backend] Termux detected. Using dedicated PRoot environment '${PROOT_DISTRO_NAME}'.`);

  try {
    await fs.access(requirementsPath);
  } catch {
    throw new Error("Backend setup failed: python/requirements-backend.txt is missing.");
  }

  ensureDedicatedProotDistro();
  ensureProotVenv();

  const requirements = await fs.readFile(requirementsPath);
  const fingerprint = crypto.createHash("sha256")
    .update(requirements)
    .update("\n" + BACKEND_INSTALL_SCHEMA + "\n" + REQUIRED_BACKEND_PACKAGES.join("\n"))
    .digest("hex");
  const prootMarker = path.join(rootDir, "data", ".proot-requirements.sha256");
  await fs.mkdir(path.dirname(prootMarker), { recursive: true });

  let installedFingerprint = "";
  try {
    installedFingerprint = (await fs.readFile(prootMarker, "utf8")).trim();
  } catch (_) {}

  let guestImports = runProot([PROOT_PYTHON, "-c", PROOT_IMPORT_CHECK]);
  if (installedFingerprint !== fingerprint || !commandSucceeded(guestImports)) {
    console.log("[backend] Installing/updating FastAPI, WebSocket, and VoiceBridge dependencies inside Debian...");
    const pipInstall = runProot(
      [
        PROOT_PYTHON, "-m", "pip", "install",
        "--disable-pip-version-check", "--no-input",
        "-r", `${PROOT_APP_DIR}/python/requirements-backend.txt`,
        ...REQUIRED_BACKEND_PACKAGES,
      ],
      { inherit: true, timeout: 1_800_000 },
    );
    if (!commandSucceeded(pipInstall)) {
      throw new Error("Backend or VoiceBridge dependency installation failed inside Debian. See the package error above.");
    }
    await fs.writeFile(prootMarker, `${fingerprint}\n`);
    guestImports = runProot([PROOT_PYTHON, "-c", PROOT_IMPORT_CHECK]);
  }

  if (!commandSucceeded(guestImports)) {
    const details = `${guestImports?.stdout || ""}${guestImports?.stderr || ""}`.trim();
    throw new Error(`Backend import validation failed${details ? `: ${details}` : "."}`);
  }

  console.log("[backend] Validating Debian backend environment...");
  const validateCode = [
    "import sys, sysconfig",
    "sys.path.insert(0, '/app')",
    "import fastapi, pydantic, pydantic_core, uvicorn, websockets, wsproto",
    "import numpy, scipy, onnxruntime, soundfile, sentencepiece, kokoro_onnx",
    "from uvicorn.protocols.websockets.wsproto_impl import WSProtocol",
    "import python.pocket_tts_onnx",
    "import python.uie_backend",
    "print('Interpreter:', sys.executable)",
    "print('Platform:', sys.platform)",
    "print('SOABI:', sysconfig.get_config_var('SOABI'))",
    "print('FastAPI:', fastapi.__version__)",
    "print('Pydantic:', pydantic.__version__)",
    "print('pydantic-core:', pydantic_core.__version__)",
    "print('Uvicorn:', uvicorn.__version__)",
    "print('WebSockets:', websockets.__version__)",
    "print('NumPy:', numpy.__version__)",
    "print('SciPy:', scipy.__version__)",
    "print('ONNX Runtime:', onnxruntime.__version__)",
    "import importlib.metadata as metadata",
    "print('SoundFile:', metadata.version('soundfile'))",
    "print('SentencePiece:', metadata.version('sentencepiece'))",
    "print('Kokoro ONNX:', metadata.version('kokoro-onnx'))",
    "print('wsproto:', metadata.version('wsproto'))",
  ].join("; ");
  const validation = runProot([PROOT_PYTHON, "-c", validateCode], { inherit: true });
  if (!commandSucceeded(validation)) {
    throw new Error("Backend validation failed inside the dedicated Debian environment.");
  }

  console.log("[backend] Running pip check inside Debian...");
  const pipCheck = runProot([PROOT_PYTHON, "-m", "pip", "check"], { inherit: true });
  if (!commandSucceeded(pipCheck)) {
    throw new Error("Installed backend packages have incompatible dependencies.");
  }

  console.log("[backend] PRoot Debian backend and VoiceBridge runtime are ready.");
}

async function prepareBackendVenv() {
  if (!shouldAutoStartBackend && !shouldAutoStartImageService) return;
  if (isTermux) {
    await prepareProotDebian();
    return;
  }
  try {
    await fs.access(requirementsPath);
  } catch {
    throw new Error("Backend startup failed: python/requirements-backend.txt is missing.");
  }
  const requirements = await fs.readFile(requirementsPath);
  const fingerprint = crypto.createHash("sha256")
    .update(requirements)
    .update("\n" + BACKEND_INSTALL_SCHEMA + "\n" + REQUIRED_BACKEND_PACKAGES.join("\n"))
    .digest("hex");
  const probe = runPython(venvPython, ["-c", "import sys; print(sys.prefix)"]);
  const venvVersion = probe.status === 0 ? parsedPythonVersion(runPython(venvPython, ["-c", PYTHON_VERSION_CHECK])) : null;
  const pipProbe = probe.status === 0 ? runPython(venvPython, ["-m", "pip", "--version"]) : probe;
  const imports = probe.status === 0 ? runPython(venvPython, ["-c", CORE_IMPORT_CHECK]) : probe;
  let installed = "";
  try { installed = (await fs.readFile(venvMarker, "utf8")).trim(); } catch (_) {}

  let includeSystemSitePackages = false;
  if (isTermux && probe.status === 0) {
    try {
      const cfg = await fs.readFile(path.join(venvDir, "pyvenv.cfg"), "utf8");
      if (cfg.includes("include-system-site-packages = true")) {
        includeSystemSitePackages = true;
      }
    } catch (_) {}
  }

  const setupReasons = [];
  if (probe.error || probe.status !== 0) setupReasons.push("the project-local .venv is missing or incomplete");
  else if (!venvVersion?.supported) setupReasons.push(`.venv uses unsupported Python ${venvVersion?.text || "unknown"}`);
  else if (pipProbe.status !== 0) setupReasons.push("pip is missing from .venv");
  else if (isTermux && !includeSystemSitePackages) setupReasons.push("Termux requires .venv to use --system-site-packages");
  if (installed !== fingerprint) setupReasons.push("the backend dependency list is new or changed");
  if (imports.status !== 0) setupReasons.push("required FastAPI packages are missing");

  if (setupReasons.length) {
    console.log("");
    console.log("[setup] Python environment setup is required:");
    for (const reason of setupReasons) console.log(`[setup]   - ${reason}`);
    console.log("[setup] UIE creates .venv inside this game folder and downloads packages listed in python/requirements-backend.txt.");
    console.log("[setup] Nothing is installed into your global Python. This prompt is expected for fresh downloads and upgrades from pre-.venv releases.");
    const approved = await askYesNo("Create/update .venv and install the missing Python packages now?", true);
    if (!approved) {
      throw new Error("Local Python environment setup was declined. Run `npm run backend:install` when you are ready.");
    }
  }

  if (probe.error || probe.status !== 0 || !venvVersion?.supported || pipProbe.status !== 0 || (isTermux && !includeSystemSitePackages)) {
    await ensureBasePythonAvailable();
  }
  if (probe.error || probe.status !== 0) createOrRepairVenv(false);
  else if (!venvVersion?.supported || (isTermux && !includeSystemSitePackages)) createOrRepairVenv(true);
  ensureVenvPip();
  const currentImports = runPython(venvPython, ["-c", CORE_IMPORT_CHECK]);
  if (installed !== fingerprint || currentImports.status !== 0) {
    const lock = await acquireVenvInstallLock();
    try {
      ensureVenvPip();
      const recheck = runPython(venvPython, ["-c", CORE_IMPORT_CHECK]);
      let currentFingerprint = "";
      try { currentFingerprint = (await fs.readFile(venvMarker, "utf8")).trim(); } catch (_) {}
      if (recheck.status !== 0 || currentFingerprint !== fingerprint) {
        console.log("[backend] Installing core FastAPI dependencies into .venv...");
        console.log("[backend] Installation progress will appear below. This happens only when the core requirements change.");
        const pip = runPython(
          venvPython,
          ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "-r", requirementsPath, ...REQUIRED_BACKEND_PACKAGES],
          { inherit: true },
        );
        if (pip.error || pip.status !== 0) {
          throw new Error(`Backend dependency installation failed${pip.error?.message ? `: ${pip.error.message}` : ""}.`);
        }
        await fs.writeFile(venvMarker, `${fingerprint}\n`);
      }
    } finally {
      if (lock) {
        await lock.close().catch(() => {});
        await fs.unlink(venvInstallLock).catch(() => {});
      }
    }
  }
  const validated = runPython(venvPython, ["-c", `${CORE_IMPORT_CHECK}; print('FastAPI backend dependencies ready')`]);
  if (validated.status !== 0) throw new Error("Backend dependency validation failed: FastAPI, Uvicorn, or WebSocket support could not be imported from .venv.");
  console.log("[backend] Running pip check...");
  runPython(venvPython, ["-m", "pip", "check"], { inherit: true });
}

// ---- SDXS Image Service sidecar ----
const IMAGE_SERVICE_PORT = Number.parseInt(process.env.UIE_IMAGE_SERVICE_PORT || "28094", 10) || 28094;
let shouldAutoStartImageService = !args.includes("--no-image-service") && process.env.UIE_AUTO_IMAGE_SERVICE === "1";
let imageServiceProcess = null;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

const rewriteLegacyPrefix = (urlPath) => {
  const src = String(urlPath || "/");
  if (src.startsWith("/UIEGame/")) return src.replace("/UIEGame/", "/");
  if (src === "/UIEGame") return "/";
  return src;
};

const resolveSafePath = (urlPath) => {
  let decoded;
  try {
    decoded = decodeURIComponent(rewriteLegacyPrefix(urlPath).split("?")[0] || "/");
  } catch {
    return null;
  }
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const candidate = path.join(rootDir, normalized);
  const absolute = path.resolve(candidate);
  const absoluteRoot = path.resolve(rootDir);
  const relative = path.relative(absoluteRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return absolute;
};

const sendFile = async (req, res, filePath) => {
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      const indexPath = path.join(filePath, "index.html");
      try {
        await fs.access(indexPath);
        return sendFile(req, res, indexPath);
      } catch {
        const entries = await fs.readdir(filePath, { withFileTypes: true });
        const relDir = path.relative(rootDir, filePath).replace(/\\/g, "/");
        const baseHref = relDir ? `/${relDir}/` : "/";
        const list = entries
          .map((entry) => {
            const suffix = entry.isDirectory() ? "/" : "";
            const name = `${entry.name}${suffix}`;
            const encoded = encodeURIComponent(entry.name).replace(/%2F/g, "/") + suffix;
            return `<li><a href="${baseHref}${encoded}">${name}</a></li>`;
          })
          .join("");
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Index of ${baseHref}</title></head><body><h1>Index of ${baseHref}</h1><ul>${list}</ul></body></html>`;
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
          "Access-Control-Allow-Headers": "*"
        });
        res.end(html);
        return;
      }
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = mimeTypes[ext] || "application/octet-stream";
    
    // Smart Caching: Cache large assets like images & fonts for 1 day to make local loading instant,
    // while keeping HTML, JS, CSS, and manifest files uncached for instant development updates.
    let cacheControl = "no-store, no-cache, must-revalidate, proxy-revalidate";
    let pragma = "no-cache";
    if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf"].includes(ext)) {
      cacheControl = "public, max-age=86400";
      pragma = "public";
    }
    
    const headers = {
      "Content-Type": type,
      "Cache-Control": cacheControl,
      "Pragma": pragma,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
      "Access-Control-Allow-Headers": "*"
    };
    if (cacheControl.includes("no-cache")) {
      headers["Expires"] = "0";
    }
    
    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    const data = await fs.readFile(filePath);
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    // If base file not found, try common image extensions (for extension-less asset requests)
    const ext = path.extname(filePath);
    if (!ext) {
      const candidates = [".png", ".jpg", ".jpeg", ".webp"];
      for (const candidateExt of candidates) {
        const altPath = filePath + candidateExt;
        try {
          const altStat = await fs.stat(altPath);
          if (altStat.isFile()) {
            return sendFile(req, res, altPath);
          }
        } catch (_) {}
      }
    }
    res.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
      "Access-Control-Allow-Headers": "*"
    });
    res.end("Not found");
  }
};

const getLanIps = () => {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(interfaces)) {
    for (const item of iface || []) {
      if (item.family === "IPv4" && !item.internal) ips.push(item.address);
    }
  }
  return [...new Set(ips)];
};

const readBody = (req) => {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      resolve(body);
    });
    req.on("error", (err) => {
      reject(err);
    });
  });
};

function requestUrl(url, timeoutMs = 900, expectedText = "") {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      resolve(value);
    };
    const req = http.get(url, (res) => {
      const successful = Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300);
      if (!successful) {
        res.resume();
        res.on("end", () => finish(false));
        return;
      }
      if (!expectedText) {
        res.resume();
        res.on("end", () => finish(true));
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        if (body.includes(expectedText)) {
          finish(true);
          req.destroy();
        } else if (body.length > 131_072) {
          finish(false);
          req.destroy();
        }
      });
      res.on("end", () => finish(body.includes(expectedText)));
    });
    req.on("error", () => finish(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish(false);
    });
  });
}

function tcpPortOpen(hostname, portNumber, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: hostname, port: portNumber });
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
  });
}

async function isBackendRunning(portNumber = activeBackendPort) {
  return requestUrl(`http://${backendHost}:${portNumber}/health`);
}

async function isBackendWebSocketRunning(portNumber = activeBackendPort) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: backendHost, port: portNumber });
    const key = crypto.randomBytes(16).toString("base64");
    let response = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), 2_000);
    socket.once("connect", () => {
      socket.write([
        "GET /ws/stream HTTP/1.1",
        `Host: ${backendHost}:${portNumber}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n"));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("latin1");
      if (response.includes("\r\n\r\n")) {
        finish(/^HTTP\/1\.[01] 101\b/.test(response));
      }
    });
    socket.once("error", () => finish(false));
    socket.once("end", () => finish(/^HTTP\/1\.[01] 101\b/.test(response)));
  });
}

async function selectBackendPort() {
  const candidates = [configuredBackendPort, 28102, 28000, 28001, 28002]
    .filter((value, index, arr) => Number.isFinite(value) && value > 0 && arr.indexOf(value) === index);
  for (const candidate of candidates) {
    if (!(await isBackendRunning(candidate))) continue;
    if (await isBackendWebSocketRunning(candidate)) {
      return { port: candidate, alreadyRunning: true };
    }
    console.warn(`Backend on port ${candidate} answers /health but failed the WebSocket handshake; it will not be reused.`);
  }
  for (const candidate of candidates) {
    if (!(await tcpPortOpen(backendHost, candidate))) return { port: candidate, alreadyRunning: false };
    console.warn(`FastAPI backend port ${candidate} is occupied or stale; trying next port.`);
  }
  return { port: candidates[0] || configuredBackendPort, alreadyRunning: false };
}

async function stopExistingTermuxBackendProcesses(portNumber) {
  if (!isTermux) return;

  const signalMatchingBackends = (signalNumber) => {
    const code = [
      "import os, signal",
      `sig = ${signalNumber}`,
      "killed = []",
      "for entry in os.listdir('/proc'):",
      "    if not entry.isdigit():",
      "        continue",
      "    pid = int(entry)",
      "    if pid == os.getpid():",
      "        continue",
      "    try:",
      "        cmd = open(f'/proc/{pid}/cmdline', 'rb').read()",
      "    except Exception:",
      "        continue",
      "    if b'uvicorn' not in cmd or b'python.uie_backend:app' not in cmd:",
      "        continue",
      "    try:",
      "        os.kill(pid, sig)",
      "        killed.append(pid)",
      "    except (ProcessLookupError, PermissionError):",
      "        pass",
      "print(' '.join(map(str, killed)))",
    ].join("\\n");
    return runProot([PROOT_PYTHON, "-c", code], { bindApp: false });
  };

  const terminated = signalMatchingBackends(15);
  const terminatedPids = String(terminated?.stdout || "").trim();
  if (terminatedPids) {
    console.log(`[backend] Restarting stale UIE backend process(es): ${terminatedPids}`);
  }

  const gracefulDeadline = Date.now() + 5_000;
  while (Date.now() < gracefulDeadline) {
    if (!(await isBackendRunning(portNumber))) return;
    await wait(200);
  }

  signalMatchingBackends(9);
  const forcedDeadline = Date.now() + 2_000;
  while (Date.now() < forcedDeadline) {
    if (!(await isBackendRunning(portNumber))) return;
    await wait(100);
  }

  throw new Error(
    `An older UIE backend is still occupying port ${portNumber}. Close the previous Termux session and launch UIE again.`,
  );
}

async function startBackendIfNeeded() {
  if (!shouldAutoStartBackend) {
    backendStartupState = "disabled";
    return false;
  }
  let selected = await selectBackendPort();
  activeBackendPort = selected.port;
  process.env.UIE_BACKEND_PORT = String(activeBackendPort);
  if (selected.alreadyRunning && isTermux) {
    // A backend that was started before an installer update keeps its old
    // imports in memory. Restart it after dependency validation so newly
    // installed transports such as websockets are actually loaded.
    await stopExistingTermuxBackendProcesses(activeBackendPort);
    selected = { port: activeBackendPort, alreadyRunning: false };
  }
  if (selected.alreadyRunning) {
    console.log(`FastAPI audio/living backend already running: http://${backendHost}:${activeBackendPort}`);
    backendStartupState = "ready";
    return true;
  }
  backendStartupState = "starting";
  backendStartupError = "";

  const pidFile = path.join(rootDir, "data", "backend.pid");
  try {
    const stalePidText = await fs.readFile(pidFile, "utf8");
    const stalePid = Number.parseInt(stalePidText.trim(), 10);
    if (Number.isFinite(stalePid)) {
      try {
        process.kill(stalePid, 0); // Check if running
        console.log(`[backend] Stopping stale backend process (PID ${stalePid})...`);
        process.kill(stalePid, "SIGTERM");
        await wait(1000);
        try {
          process.kill(stalePid, 0);
          process.kill(stalePid, "SIGKILL");
        } catch (_) {}
      } catch (_) {}
    }
  } catch (_) {}

  if (isTermux) {
    console.log(`Starting FastAPI audio/living backend inside PRoot Debian: http://${backendHost}:${activeBackendPort}`);
    backendProcess = spawnProot([
      PROOT_PYTHON,
      "-m", "uvicorn", "python.uie_backend:app",
      "--host", backendHost,
      "--port", String(activeBackendPort),
      "--ws", "wsproto",
    ]);
  } else {
    console.log(`Starting FastAPI audio/living backend: http://${backendHost}:${activeBackendPort}`);
    backendProcess = spawn(pythonCmd, ["-m", "uvicorn", "python.uie_backend:app", "--host", backendHost, "--port", String(activeBackendPort), "--ws", "wsproto"], {
      cwd: rootDir,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
  }

  if (backendProcess && backendProcess.pid) {
    await fs.mkdir(path.join(rootDir, "data"), { recursive: true });
    await fs.writeFile(pidFile, String(backendProcess.pid));
  }
  backendProcess.on("error", (err) => {
    console.warn(`[backend] failed to start: ${err.message}`);
    backendStartupState = "error";
    backendStartupError = err.message;
    backendProcess = null;
  });
  backendProcess.on("exit", (code, signal) => {
    if (signal) console.log(`[backend] stopped by ${signal}`);
    else if (code) console.log(`[backend] exited with ${code}`);
    const wasReady = backendStartupState === "ready";
    backendStartupState = "error";
    backendStartupError = wasReady
      ? `Backend stopped unexpectedly (code ${code ?? "unknown"}).`
      : `Backend exited before it became ready (code ${code ?? "unknown"}).`;
    backendProcess = null;
  });
  console.log(`Starting FastAPI audio/living backend: http://${backendHost}:${activeBackendPort}`);
  const timeoutMs = Math.max(5_000, Number(process.env.UIE_BACKEND_START_TIMEOUT_MS || 25_000));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isBackendRunning(activeBackendPort) && await isBackendWebSocketRunning(activeBackendPort)) {
      backendStartupState = "ready";
      console.log(`FastAPI audio/living backend ready with WebSocket support: http://${backendHost}:${activeBackendPort}`);
      return true;
    }
    if (backendStartupState === "error") throw new Error(backendStartupError || "FastAPI backend failed during startup.");
    await wait(200);
  }
  backendStartupState = "error";
  backendStartupError = `FastAPI backend did not pass HTTP and WebSocket readiness checks within ${Math.round(timeoutMs / 1000)} seconds.`;
  stopBackend();
  throw new Error(backendStartupError);
}

function stopBackend() {
  if (!backendProcess || backendProcess.killed) return;
  try { backendProcess.kill(); } catch (_) {}
  const pidFile = path.join(rootDir, "data", "backend.pid");
  fs.unlink(pidFile).catch(() => {});
}

async function isImageServiceRunning(p) {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: p, path: "/health", method: "GET", timeout: 1000 },
      (res) => { resolve(res.statusCode === 200); }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function startImageServiceIfNeeded() {
  if (!shouldAutoStartImageService) return;
  const alreadyUp = await isImageServiceRunning(IMAGE_SERVICE_PORT);
  if (alreadyUp) {
    console.log(`[image-service] Already running: http://127.0.0.1:${IMAGE_SERVICE_PORT}`);
    return;
  }
  console.log(`[image-service] Starting SDXS image service on port ${IMAGE_SERVICE_PORT}...`);
  if (isTermux) {
    imageServiceProcess = spawnProot([
      PROOT_PYTHON,
      "-m", "uvicorn", "python.image_service:app",
      "--host", "127.0.0.1",
      "--port", String(IMAGE_SERVICE_PORT),
    ]);
  } else {
    imageServiceProcess = spawn(
      pythonCmd,
      ["-m", "uvicorn", "python.image_service:app", "--host", "127.0.0.1", "--port", String(IMAGE_SERVICE_PORT)],
      {
        cwd: rootDir,
        stdio: "inherit",
        shell: false,
        windowsHide: true,
      }
    );
  }
  imageServiceProcess.on("error", (err) => {
    console.warn(`[image-service] failed to start: ${err.message}`);
    imageServiceProcess = null;
  });
  imageServiceProcess.on("exit", (code, signal) => {
    if (signal) console.log(`[image-service] stopped by ${signal}`);
    else if (code) console.log(`[image-service] exited with code ${code}`);
    imageServiceProcess = null;
  });
}

function stopImageService() {
  if (!imageServiceProcess || imageServiceProcess.killed) return;
  try { imageServiceProcess.kill(); } catch (_) {}
}

const listCharacterSprites = async (characterName) => {
  const requestedName = String(characterName || "").trim();
  if (!requestedName) return [];

  const spriteRoots = [
    path.join(rootDir, "assets", "Sprites"),
    path.join(rootDir, "assets", "characters")
  ];
  const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  const sprites = [];

  for (const spriteRoot of spriteRoots) {
    let entries = [];
    try {
      entries = await fs.readdir(spriteRoot, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    const characterDir = entries.find((entry) =>
      entry.isDirectory() && entry.name.localeCompare(requestedName, undefined, { sensitivity: "base" }) === 0
    );
    if (!characterDir) continue;

    const absoluteDir = path.join(spriteRoot, characterDir.name);
    let files = [];
    try {
      files = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    for (const file of files) {
      if (!file.isFile() || !imageExtensions.has(path.extname(file.name).toLowerCase())) continue;
      const label = path.basename(file.name, path.extname(file.name)).replace(/-\d+$/, "");
      const relativePath = path.relative(rootDir, path.join(absoluteDir, file.name)).replace(/\\/g, "/");
      sprites.push({ label, path: `/${relativePath}` });
    }
  }

  return sprites;
};

const handleProxyRequest = async (req, res, targetUrl, method, headers, body) => {
  try {
    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      res.end("Missing target URL");
      return;
    }
    
    // Safety check: avoid looping proxy requests on the same port of local host
    try {
      const u = new URL(targetUrl);
      const isLoop = (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "0.0.0.0") && Number(u.port || 80) === port;
      if (isLoop) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        res.end("Proxy loop detected");
        return;
      }
    } catch (_) {
      if (targetUrl.includes(`127.0.0.1:${port}`) || targetUrl.includes(`localhost:${port}`)) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        res.end("Proxy loop detected");
        return;
      }
    }

    console.log(`[Proxy] ${method} ${targetUrl}`);

    const fetchHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
      const lower = k.toLowerCase();
      if (["host", "connection", "content-length", "origin", "referer", "sec-fetch-mode", "sec-fetch-site", "sec-fetch-dest", "transfer-encoding", "te"].includes(lower)) {
        continue;
      }
      fetchHeaders[k] = v;
    }

    const fetchOptions = {
      method: method,
      headers: fetchHeaders
    };

    if (body && method !== "GET" && method !== "HEAD") {
      fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const response = await fetch(targetUrl, fetchOptions);

    const resHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
      "Access-Control-Allow-Headers": "*",
      "x-uie-proxy": "true"
    };

    for (const [k, v] of response.headers.entries()) {
      const lower = k.toLowerCase();
      if (["content-encoding", "transfer-encoding", "connection", "access-control-allow-origin", "x-uie-proxy"].includes(lower)) {
        continue;
      }
      resHeaders[k] = v;
    }

    res.writeHead(response.status, resHeaders);
    const arrayBuffer = await response.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    const causeMsg = err.cause ? ` (cause: ${err.cause.message || err.cause})` : "";
    console.error(`[Proxy Error] Failed to proxy to ${targetUrl}:`, err);
    if (err.cause?.code === "ECONNREFUSED") {
      try {
        const u = new URL(targetUrl);
        if (u.port === String(activeBackendPort) || u.port === String(IMAGE_SERVICE_PORT)) {
          console.warn(`[Proxy Warning] Connection was refused to local service on port ${u.port}. Is the backend uvicorn process running?`);
        }
      } catch (_) {}
    }
    let isBackendTarget = false;
    try {
      const failed = new URL(targetUrl);
      isBackendTarget = failed.hostname === backendHost && failed.port === String(activeBackendPort);
    } catch (_) {}
    const status = isBackendTarget ? 503 : 502;
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Retry-After": isBackendTarget ? "2" : "0"
    });
    res.end(JSON.stringify({
      ok: false,
      service: isBackendTarget ? "uie-backend" : "proxy",
      status: isBackendTarget ? backendStartupState : "error",
      error: isBackendTarget
        ? (backendStartupError || "The local backend is not ready.")
        : `Proxy error: ${err.message}${causeMsg}`
    }));
  }
};

const scanAudioFiles = async (dirPath, baseDirName) => {
  const list = [];
  const genres = new Set();
  
  const scan = async (currentDir, relSubDir = "") => {
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subGenre = entry.name;
        genres.add(subGenre);
        await scan(path.join(currentDir, entry.name), path.join(relSubDir, entry.name));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if ([".mp3", ".wav", ".ogg", ".aac", ".flac", ".m4a", ".webm"].includes(ext)) {
          const genre = relSubDir ? path.basename(relSubDir) : "General";
          const normPath = path.join(baseDirName, relSubDir, entry.name).replace(/\\/g, "/");
          list.push({
            name: entry.name,
            path: `/${normPath}`,
            genre: genre
          });
        }
      }
    }
  };
  
  await scan(dirPath);
  return { list, genres: Array.from(genres) };
};

const server = http.createServer(async (req, res) => {
  // CORS Preflight handling
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400"
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url || "/", "http://localhost");
  let reqUrl = rewriteLegacyPrefix(parsedUrl.pathname);

  // CSRF token route fallback
  if (reqUrl === "/csrf-token") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({ csrfToken: "dev-token-for-local-development" }));
    return;
  }

  // Stable same-origin sidecar routes. These keep browser clients working when the
  // UI is accessed from another device or mounted behind an HTTPS reverse proxy.
  if (reqUrl === "/api/backend" || reqUrl.startsWith("/api/backend/")) {
    const suffix = reqUrl.slice("/api/backend".length) || "/";
    const targetUrl = `http://${backendHost}:${activeBackendPort}${suffix}${parsedUrl.search}`;
    const body = req.method === "GET" || req.method === "HEAD" ? null : await readBody(req);
    await handleProxyRequest(req, res, targetUrl, req.method || "GET", req.headers, body);
    return;
  }

  if (reqUrl === "/api/image-service" || reqUrl.startsWith("/api/image-service/")) {
    const suffix = reqUrl.slice("/api/image-service".length) || "/";
    const targetUrl = `http://127.0.0.1:${IMAGE_SERVICE_PORT}${suffix}${parsedUrl.search}`;
    const body = req.method === "GET" || req.method === "HEAD" ? null : await readBody(req);
    await handleProxyRequest(req, res, targetUrl, req.method || "GET", req.headers, body);
    return;
  }

  if (req.method === "GET" && reqUrl === "/api/sprites/get") {
    const sprites = await listCharacterSprites(parsedUrl.searchParams.get("name"));
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify(sprites));
    return;
  }

  if (req.method === "GET" && reqUrl === "/api/backend-info") {
    const backendUrl = "./api/backend";
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({
      port: activeBackendPort,
      url: backendUrl,
      internalUrl: `http://${backendHost}:${activeBackendPort}`,
      host: backendHost,
      enabled: shouldAutoStartBackend,
      status: backendStartupState,
      error: backendStartupError,
      isRunning: await isBackendRunning(activeBackendPort)
    }));
    return;
  }

  if (req.method === "GET" && reqUrl === "/api/character-cards/list") {
    const cardsDir = path.join(rootDir, "assets", "Character Cards");
    const cards = [];
    try {
      const entries = await fs.readdir(cardsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
          cards.push({
            name: entry.name,
            path: `assets/Character Cards/${entry.name}`
          });
        }
      }
    } catch (_) {}
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify(cards));
    return;
  }

  if (req.method === "GET" && reqUrl === "/api/lorebooks/list") {
    const loreDir = path.join(rootDir, "assets", "Lorebooks");
    const lorebooks = [];
    try {
      const entries = await fs.readdir(loreDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
          lorebooks.push({
            name: entry.name,
            path: `assets/Lorebooks/${entry.name}`
          });
        }
      }
    } catch (_) {}
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify(lorebooks));
    return;
  }

  if (req.method === "GET" && reqUrl === "/api/music/list") {
    const allTracks = [];
    const allGenres = new Set(["General", "Chill", "Battle", "Boss"]);
    
    const primaryMusicPath = path.join(rootDir, "assets", "audio", "Music");
    try {
      await fs.mkdir(primaryMusicPath, { recursive: true });
    } catch (_) {}
    const primaryScan = await scanAudioFiles(primaryMusicPath, "assets/audio/Music");
    allTracks.push(...primaryScan.list);
    primaryScan.genres.forEach(g => allGenres.add(g));
    
    try {
      const p = path.join(rootDir, "Music");
      const stat = await fs.stat(p);
      if (stat.isDirectory()) {
        const rootScan = await scanAudioFiles(p, "Music");
        allTracks.push(...rootScan.list);
        rootScan.genres.forEach(g => allGenres.add(g));
      }
    } catch (_) {}

    try {
      const p = path.join(rootDir, "music");
      const stat = await fs.stat(p);
      if (stat.isDirectory()) {
        const rootScanLower = await scanAudioFiles(p, "music");
        allTracks.push(...rootScanLower.list);
        rootScanLower.genres.forEach(g => allGenres.add(g));
      }
    } catch (_) {}

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({ tracks: allTracks, genres: Array.from(allGenres) }));
    return;
  }

  if (req.method === "POST" && reqUrl === "/api/music/add-genre") {
    try {
      const rawBody = await readBody(req);
      const payload = JSON.parse(rawBody || "{}");
      const genre = String(payload.genre || "").trim();
      if (!genre) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        res.end("Missing genre");
        return;
      }
      
      const primaryMusicPath = path.join(rootDir, "assets", "audio", "Music");
      await fs.mkdir(path.join(primaryMusicPath, genre), { recursive: true });
      
      try {
        const p = path.join(rootDir, "Music");
        const stat = await fs.stat(p);
        if (stat.isDirectory()) await fs.mkdir(path.join(p, genre), { recursive: true });
      } catch (_) {}
      
      try {
        const p = path.join(rootDir, "music");
        const stat = await fs.stat(p);
        if (stat.isDirectory()) await fs.mkdir(path.join(p, genre), { recursive: true });
      } catch (_) {}
      
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      res.end(err.message);
    }
    return;
  }

  if (req.method === "POST" && reqUrl === "/api/music/set-genre") {
    try {
      const rawBody = await readBody(req);
      const payload = JSON.parse(rawBody || "{}");
      const relativeFilePath = String(payload.filePath || "").trim();
      const genre = String(payload.genre || "").trim();
      
      if (!relativeFilePath || !genre) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        res.end("Missing filePath or genre");
        return;
      }
      
      const sourceAbsPath = resolveSafePath(relativeFilePath);
      if (!sourceAbsPath) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        res.end("Invalid file path");
        return;
      }
      
      let baseDir = "";
      if (sourceAbsPath.includes(path.join("assets", "audio", "Music"))) {
        baseDir = path.join(rootDir, "assets", "audio", "Music");
      } else if (sourceAbsPath.includes(path.join(rootDir, "Music"))) {
        baseDir = path.join(rootDir, "Music");
      } else if (sourceAbsPath.includes(path.join(rootDir, "music"))) {
        baseDir = path.join(rootDir, "music");
      } else {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        res.end("File is not inside a recognized music folder");
        return;
      }
      
      const filename = path.basename(sourceAbsPath);
      let destDir = baseDir;
      if (genre !== "General") {
        destDir = path.join(baseDir, genre);
      }
      
      await fs.mkdir(destDir, { recursive: true });
      const destAbsPath = path.join(destDir, filename);
      
      await fs.rename(sourceAbsPath, destAbsPath);
      
      const newRelativePath = "/" + path.relative(rootDir, destAbsPath).replace(/\\/g, "/");
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(JSON.stringify({ success: true, newPath: newRelativePath }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      res.end(err.message);
    }
    return;
  }

  if (req.method === "POST" && reqUrl === "/api/music/upload") {
    try {
      const rawBody = await readBody(req);
      const payload = JSON.parse(rawBody || "{}");
      const filename = String(payload.filename || "").trim();
      const dataUrl = String(payload.dataUrl || "").trim();
      
      if (!filename || !dataUrl) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        res.end("Missing filename or dataUrl");
        return;
      }
      
      const base64Data = dataUrl.split(";base64,").pop();
      const buffer = Buffer.from(base64Data, "base64");
      
      const primaryMusicPath = path.join(rootDir, "assets", "audio", "Music");
      await fs.mkdir(primaryMusicPath, { recursive: true });
      const targetPath = path.join(primaryMusicPath, filename);
      
      await fs.writeFile(targetPath, buffer);
      
      const newRelativePath = "/assets/audio/Music/" + filename;
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(JSON.stringify({ success: true, path: newRelativePath }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      res.end(err.message);
    }
    return;
  }

  // Local CORS proxy logic
  let targetUrl = "";
  let isJsonProxy = false;

  const jsonProxyPaths = ["/api/forward", "/api/proxy", "/api/cors-proxy", "/api/corsProxy"];
  const hasUrlParam = parsedUrl.searchParams.has("url");
  const isJsonRequest = req.method === "POST" && jsonProxyPaths.includes(reqUrl) && !hasUrlParam;

  if (isJsonRequest) {
    isJsonProxy = true;
  } else {
    // Check if target URL is in query params
    targetUrl = parsedUrl.searchParams.get("url") || "";

    // If not, check path-based encoded URL parameter
    if (!targetUrl) {
      const pathPrefixes = [
        "/api/proxy/", "/proxy/",
        "/api/cors-proxy/", "/cors-proxy/",
        "/api/corsProxy/", "/corsProxy/",
        "/api/openrouter/v1/chat/completions/",
        "/api/openrouter/v1/models/"
      ];
      for (const prefix of pathPrefixes) {
        if (reqUrl.startsWith(prefix)) {
          const rest = reqUrl.substring(prefix.length);
          try {
            targetUrl = decodeURIComponent(rest);
          } catch (_) {}
          if (targetUrl) break;
        }
      }
    }
  }

  if (isJsonProxy) {
    try {
      const rawBody = await readBody(req);
      const payload = JSON.parse(rawBody || "{}");
      const url = payload.url;
      const method = payload.method || "POST";
      const headers = payload.headers || {};
      const body = payload.body;
      await handleProxyRequest(req, res, url, method, headers, body);
      return;
    } catch (err) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      res.end(`Bad proxy payload: ${err.message}`);
      return;
    }
  }

  if (targetUrl) {
    const rawBody = await readBody(req);
    await handleProxyRequest(req, res, targetUrl, req.method, req.headers, rawBody);
    return;
  }

  const safePath = resolveSafePath(reqUrl);
  if (!safePath) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  if (reqUrl === "/" || reqUrl === "") {
    await sendFile(req, res, path.join(rootDir, "game.html"));
    return;
  }

  await sendFile(req, res, safePath);
});

server.on("upgrade", (req, socket, head) => {
  let parsedUrl;
  try {
    parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  } catch (_) {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    return;
  }

  const prefix = "/api/backend";
  if (parsedUrl.pathname !== prefix && !parsedUrl.pathname.startsWith(`${prefix}/`)) {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    return;
  }

  const upstreamPath = `${parsedUrl.pathname.slice(prefix.length) || "/"}${parsedUrl.search}`;
  const upstream = net.connect({ host: backendHost, port: activeBackendPort });
  let connected = false;

  const fail = () => {
    if (!socket.destroyed) {
      socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    }
    if (!upstream.destroyed) upstream.destroy();
  };

  upstream.once("connect", () => {
    connected = true;
    const headerLines = [];
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      const name = req.rawHeaders[index];
      const value = req.rawHeaders[index + 1];
      if (String(name).toLowerCase() === "host") {
        headerLines.push(`Host: ${backendHost}:${activeBackendPort}`);
      } else if (String(name).toLowerCase() !== "proxy-connection") {
        headerLines.push(`${name}: ${value}`);
      }
    }
    upstream.write(`${req.method || "GET"} ${upstreamPath} HTTP/${req.httpVersion}\r\n${headerLines.join("\r\n")}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });

  upstream.once("error", fail);
  socket.once("error", () => {
    if (!upstream.destroyed) upstream.destroy();
  });
  socket.once("close", () => {
    if (!connected && !upstream.destroyed) upstream.destroy();
  });
});

server.on("error", (err) => {
  if (err?.code === "EADDRINUSE") {
    void (async () => {
      const existingUi = await requestUrl(`http://127.0.0.1:${port}/game.html`, 1200, "<title>UIE: Fugue</title>")
        || await requestUrl(`http://localhost:${port}/game.html`, 1200, "<title>UIE: Fugue</title>");
      if (existingUi) {
        console.log(`UIE is already running on port ${port}.`);
        console.log(`Open: http://localhost:${port}/game.html`);
        openLocalBrowser(`http://localhost:${port}/game.html`);
        // npm treats every non-zero exit as a startup failure. Its start script
        // opts into a successful no-op when this exact UIE server is already
        // healthy; the Windows launcher keeps exit 3 for its existing contract.
        process.exit(reuseExistingServer ? 0 : 3);
        return;
      }
      console.error(`UIE server cannot start: ${host}:${port} is already in use by another app.`);
      console.error(`Close the app using port ${port}, then run npm run start:mobile again.`);
      stopBackend();
      stopImageService();
      process.exit(1);
    })();
    return;
  } else {
    console.error(`UIE server failed to start: ${err?.message || err}`);
  }
  stopBackend();
  stopImageService();
  process.exit(1);
});

try {
  await prepareBackendVenv();
} catch (err) {
  console.error(`[backend] ${err?.message || err}`);
  console.error("Starting the frontend in offline/procedural mode; resolve the backend error to restore FastAPI features.");
  shouldAutoStartBackend = false;
  shouldAutoStartImageService = false;
}

if (args.includes("--prepare-only")) {
  if (!shouldAutoStartBackend) process.exit(1);
  console.log("[backend] .venv setup and dependency validation completed successfully.");
  process.exit(0);
}

try {
  await startBackendIfNeeded();
} catch (err) {
  backendStartupState = "error";
  backendStartupError = String(err?.message || err || "Backend startup failed.");
  console.error(`[backend] ${backendStartupError}`);
  console.error("The browser will show this backend failure on the loading screen instead of silently opening a partially working game.");
}

server.listen(port, host, () => {
  const localUrl = `http://localhost:${port}/game.html`;
  console.log("UIE local server is running.");
  console.log(`Open on this device: ${localUrl}`);
  if (process.env.TERMUX_VERSION) {
    console.log("Termux: open in browser → termux-open-url " + localUrl);
  }
  const lanIps = getLanIps();
  if (host === "0.0.0.0" && lanIps.length) {
    for (const ip of lanIps) {
      console.log(`Other devices on LAN: http://${ip}:${port}/game.html`);
    }
  } else if (host === "0.0.0.0") {
    console.log("LAN: no non-loopback IPv4 found; other devices may still reach this host via its IP.");
  }
  console.log("Press Ctrl+C to stop.");
  openLocalBrowser(localUrl);
  void startImageServiceIfNeeded();
});

process.on("SIGINT", () => {
  stopBackend();
  stopImageService();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stopBackend();
  stopImageService();
  process.exit(143);
});
process.on("exit", () => { stopBackend(); stopImageService(); });
