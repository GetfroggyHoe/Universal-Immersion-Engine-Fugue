#!/usr/bin/env bash
# Universal Immersion Engine: Fugue - Startup Script

echo "=================================================="
echo " Starting Universal Immersion Engine: Fugue"
echo "=================================================="

# Navigate to script directory
cd "$(dirname "$0")"

confirm_install() {
  if [ ! -t 0 ]; then return 0; fi
  printf "%s [Y/n]: " "$1"
  read -r answer
  case "$answer" in
    [Nn]*) return 1 ;;
    *) return 0 ;;
  esac
}

run_as_root() {
  if [ "$(id -u)" = "0" ]; then "$@"
  elif command -v sudo >/dev/null 2>&1; then sudo "$@"
  else
    echo "Automatic installation needs root access, but sudo is unavailable."
    return 1
  fi
}

install_node_runtime() {
  confirm_install "Node.js 18+ is missing. Download and install it automatically now?" || return 1
  if command -v pkg >/dev/null 2>&1; then pkg update -y && pkg install nodejs-lts -y
  elif command -v brew >/dev/null 2>&1; then brew install node
  elif command -v apt-get >/dev/null 2>&1; then run_as_root apt-get update && run_as_root apt-get install -y nodejs npm
  elif command -v dnf >/dev/null 2>&1; then run_as_root dnf install -y nodejs npm
  elif command -v yum >/dev/null 2>&1; then run_as_root yum install -y nodejs npm
  elif command -v pacman >/dev/null 2>&1; then run_as_root pacman -Sy --needed --noconfirm nodejs npm
  elif command -v apk >/dev/null 2>&1; then run_as_root apk add nodejs npm
  elif command -v zypper >/dev/null 2>&1; then run_as_root zypper --non-interactive install nodejs npm
  else
    echo "No supported package manager was found for automatic Node.js installation."
    return 1
  fi
}

install_python_runtime() {
  confirm_install "Python 3.10+ or its venv support is missing. Download and install it automatically now?" || return 1
  if command -v pkg >/dev/null 2>&1; then pkg update -y && pkg install python python-pip python-pydantic python-numpy python-scipy python-pillow rust clang cmake make pkg-config binutils -y
  elif command -v brew >/dev/null 2>&1; then brew install python@3.13
  elif command -v apt-get >/dev/null 2>&1; then run_as_root apt-get update && run_as_root apt-get install -y python3 python3-venv python3-pip
  elif command -v dnf >/dev/null 2>&1; then run_as_root dnf install -y python3 python3-pip
  elif command -v yum >/dev/null 2>&1; then run_as_root yum install -y python3 python3-pip
  elif command -v pacman >/dev/null 2>&1; then run_as_root pacman -Sy --needed --noconfirm python python-pip
  elif command -v apk >/dev/null 2>&1; then run_as_root apk add python3 py3-pip
  elif command -v zypper >/dev/null 2>&1; then run_as_root zypper --non-interactive install python3 python3-pip
  else
    echo "No supported package manager was found for automatic Python installation."
    return 1
  fi
}

node_is_supported() {
  command -v node >/dev/null 2>&1 || return 1
  node_major=$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null) || return 1
  [ "$node_major" -ge 18 ] 2>/dev/null
}

python_is_supported() {
  [ -n "$1" ] || return 1
  "$1" -c "import sys; raise SystemExit(0 if sys.version_info[:2] >= (3, 10) else 1)" >/dev/null 2>&1
}

find_supported_python() {
  for candidate in python3.13 python3.12 python3.11 python3.10 python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && python_is_supported "$candidate"; then
      PY_CMD="$candidate"
      return 0
    fi
  done
  return 1
}

# 1. Check Node.js installation
if ! node_is_supported; then
  if ! install_node_runtime; then
    echo "ERROR: Node.js 18+ could not be installed automatically."
    echo "Install it with your system package manager, then run start.sh again."
    echo "On Termux: pkg install nodejs-lts -y"
    echo "=================================================="
    exit 1
  fi
  rehash 2>/dev/null || true
fi
if ! node_is_supported; then
  echo "ERROR: The installed Node.js version is still missing or older than 18."
  echo "=================================================="
  exit 1
fi

# 2. Install Node.js dependencies
node scripts/launcher-maintenance.mjs --updates
echo ""
echo "[1/3] Checking Node.js dependencies..."
node scripts/launcher-maintenance.mjs --npm

# 3. The dev server manages a project-local virtual environment.
echo "[2/3] Checking isolated FastAPI backend setup..."
PY_CMD=""
VENV_READY=0

# Detect Termux
IS_TERMUX=0
if [ -n "${TERMUX_VERSION:-}" ] || { [ -n "${PREFIX:-}" ] && echo "$PREFIX" | grep -q "com.termux"; }; then
  IS_TERMUX=1
fi

if [ "$IS_TERMUX" = "1" ]; then
  echo "Termux detected. Using automated PRoot Debian environment."
  if node dev-server.mjs --prepare-only --no-image-service; then
    VENV_READY=1
  else
    echo "ERROR: Automated PRoot Debian backend setup did not complete."
    echo "The detailed setup error is shown above."
    echo "Run this launcher again or use: npm run backend:install"
    if confirm_install "Continue in reduced offline/procedural mode anyway?"; then
      export UIE_AUTO_START_BACKEND=0
    else
      echo "Startup cancelled so the game does not open partially initialized."
      exit 1
    fi
  fi
else
  if [ -f ".venv/bin/python" ]; then
    echo "Local virtual environment (.venv) found. Using virtual environment python."
    PY_CMD=".venv/bin/python"
    export PYTHON=".venv/bin/python"
  elif [ -f "venv/bin/python" ]; then
    echo "Local virtual environment (venv) found. Using virtual environment python."
    PY_CMD="venv/bin/python"
    export PYTHON="venv/bin/python"
  elif command -v python3 >/dev/null 2>&1; then
    PY_CMD="python3"
  elif command -v python >/dev/null 2>&1; then
    PY_CMD="python"
  fi

  if [ -n "$PY_CMD" ] && ! python_is_supported "$PY_CMD"; then
    echo "The detected Python is older than the supported 3.10 minimum."
    PY_CMD=""
  fi

  if [ -z "$PY_CMD" ] && ! find_supported_python; then
    if install_python_runtime; then
      rehash 2>/dev/null || true
      find_supported_python || true
    fi
  fi

  if [ -n "$PY_CMD" ] && ! "$PY_CMD" -m venv --help >/dev/null 2>&1; then
    echo "Python was found, but the venv module is missing."
    if install_python_runtime; then rehash 2>/dev/null || true; fi
    if ! "$PY_CMD" -m venv --help >/dev/null 2>&1; then PY_CMD=""; fi
  fi

  if [ -n "$PY_CMD" ] && [ -f "python/requirements-backend.txt" ]; then
    export PYTHON="$PY_CMD"
    echo "Python found ($PY_CMD). Checking .venv before the game opens..."
    if node dev-server.mjs --prepare-only --no-image-service; then
      PY_CMD=".venv/bin/python"
      export PYTHON="$PY_CMD"
      VENV_READY=1
    else
      echo "ERROR: .venv setup did not complete. VoiceBridge and backend game systems are not ready."
      echo "Run this launcher again or use: npm run backend:install"
      if confirm_install "Continue in reduced offline/procedural mode anyway?"; then
        export UIE_AUTO_START_BACKEND=0
      else
        echo "Startup cancelled so the game does not open partially initialized."
        exit 1
      fi
    fi
  elif [ -z "$PY_CMD" ]; then
    echo "Python 3.10+ is unavailable. Skipping backend install."
    echo "The frontend RPG will run as a standalone app."
    echo "Automatic Python setup was declined, failed, or no supported package manager was available."
    export UIE_AUTO_START_BACKEND=0
  else
    echo "Required file missing: $PWD/python/requirements-backend.txt"
    echo "Your download is incomplete. Re-download or update UIE, then run bash start.sh again."
    echo "The frontend RPG will run as a standalone app."
    export UIE_AUTO_START_BACKEND=0
  fi
fi

# 2.5. Optional KOJI local image generation model. Record the first answer so
# restarting the server never asks again unless the user deliberately removes it.
KOJI_PROMPT_MARKER="data/.koji-install-choice-recorded"
if [ "$VENV_READY" = "1" ] && [ -f "python/requirements.txt" ] && [ ! -f "$KOJI_PROMPT_MARKER" ]; then
  echo ""
  echo "[Optional] KOJI Local Image Generation Model"
  echo "  Size: ~2.5 GB download from HuggingFace (calcuis/koji)"
  echo "  No API key required once installed. You can skip and install later in Settings."
  if [ ! -f "models/koji/koji_v21.safetensors" ] && [ ! -f "models/koji/koji_v21-q4_k_m.gguf" ]; then
    printf "Install KOJI image gen now? (requires ~2.5 GB) [Y/N]: "
    read -r INSTALL_KOJI
    mkdir -p "$(dirname "$KOJI_PROMPT_MARKER")"
    : > "$KOJI_PROMPT_MARKER"
    case "$INSTALL_KOJI" in
      [Yy])
        echo "Starting KOJI download in the background (watch progress in Settings > Visual Gen)..."
        if [ "$IS_TERMUX" = "1" ]; then
          nohup proot-distro login uie-debian --bind "$PWD:/app" -- \
            /usr/bin/env -i HOME=/root USER=root LOGNAME=root \
            PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
            TMPDIR=/tmp PYTHONPATH=/app \
            /root/uie-venv/bin/python -c "import sys,logging,time; sys.path.insert(0, '/app'); logging.basicConfig(level=logging.INFO); from python.visuals.download_koji import download_koji; download_koji(); time.sleep(1)" \
            > koji_download.log 2>&1 &
        else
          nohup "$PY_CMD" -c "import sys,logging,time; sys.path.insert(0, '.'); logging.basicConfig(level=logging.INFO); from python.visuals.download_koji import download_koji; download_koji(); time.sleep(1)" > koji_download.log 2>&1 &
        fi
        ;;
      *)
        echo "Skipping KOJI image gen install. You can install it later from Settings."
        ;;
    esac
  else
    echo "KOJI model already present. Skipping prompt."
  fi
fi

# 4. Start the Dev Server
# On Termux, replace an older UIE Node launcher from this same project folder.
# Otherwise an already-running pre-update launcher can keep an old backend alive
# even after the installer has repaired the Python environment.
if [ "$IS_TERMUX" = "1" ] && [ -d /proc ]; then
  UIE_ROOT="$PWD" node --input-type=module - <<'NODE' 2>/dev/null || true
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.env.UIE_ROOT || process.cwd());
for (const entry of fs.readdirSync("/proc")) {
  if (!/^\d+$/.test(entry)) continue;
  const pid = Number(entry);
  if (!Number.isFinite(pid) || pid === process.pid || pid === process.ppid) continue;
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`).toString("utf8").replaceAll("\0", " ");
    if (!cmdline.includes("dev-server.mjs")) continue;
    const cwd = path.resolve(fs.readlinkSync(`/proc/${pid}/cwd`));
    if (cwd !== root) continue;
    process.kill(pid, "SIGTERM");
    console.log(`[launcher] Stopped stale UIE launcher process ${pid}.`);
  } catch {}
}
NODE
  sleep 1
fi

echo "[3/3] Starting the local dev server..."
echo "Serving on: http://localhost:8093/game.html"
node dev-server.mjs --host 0.0.0.0 --port 8093 --open
STATUS=$?
if [ "$STATUS" = "3" ]; then
  echo ""
  echo "Existing UIE server reused successfully. This launcher can be closed."
  exit 0
fi
if [ "$STATUS" != "0" ]; then
  echo ""
  echo "UIE stopped with exit code $STATUS. Review any error shown above."
  exit "$STATUS"
fi
echo ""
echo "UIE stopped normally."
