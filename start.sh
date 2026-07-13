#!/usr/bin/env bash
# Universal Immersion Engine: Fugue - Startup Script

echo "=================================================="
echo " Starting Universal Immersion Engine: Fugue"
echo "=================================================="

# Navigate to script directory
cd "$(dirname "$0")"

# 1. Check Node.js installation
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed or not in your PATH."
  echo "Please install Node.js (version 18+) to run the engine."
  echo "On Termux: pkg install nodejs-lts -y"
  echo "=================================================="
  exit 1
fi

# 2. Install Node.js dependencies
echo "[1/3] Checking Node.js dependencies..."
if command -v npm >/dev/null 2>&1; then
  if [ -f "package.json" ]; then
    npm install || echo "Warning: npm install returned an error. Proceeding anyway..."
  fi
else
  echo "Warning: npm command not found! Skipping dependency install."
fi

# 3. Install Python dependencies (optional but recommended for voice/living-world backend)
echo "[2/3] Checking Python dependencies..."
PY_CMD=""
if command -v python3 >/dev/null 2>&1; then
  PY_CMD="python3"
elif command -v python >/dev/null 2>&1; then
  PY_CMD="python"
fi

if [ -n "$PY_CMD" ] && [ -f "python/requirements.txt" ]; then
  echo "Python found ($PY_CMD). Installing voice/backend requirements..."
  # Run in non-blocking way so that if compiling/downloading fails, frontend still runs
  if $PY_CMD -m pip install -r python/requirements.txt; then
    echo "Python requirements installed successfully."
  else
    echo "--------------------------------------------------"
    echo "Warning: Python pip installation failed."
    echo "The frontend will still work, but local voice/backend"
    echo "features may not be available."
    echo "--------------------------------------------------"
  fi
else
  echo "Python or python/requirements.txt not found. Skipping backend install."
  echo "The frontend RPG will run as a standalone app."
fi

# 2.5. Optional KOJI local image generation model. Record the first answer so
# restarting the server never asks again unless the user deliberately removes it.
KOJI_PROMPT_MARKER="data/.koji-install-choice-recorded"
if [ -n "$PY_CMD" ] && [ -f "python/requirements.txt" ] && [ ! -f "$KOJI_PROMPT_MARKER" ]; then
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
        nohup "$PY_CMD" -c "import sys,logging,time; sys.path.insert(0, '.'); logging.basicConfig(level=logging.INFO); from python.visuals.download_koji import download_koji; download_koji(); time.sleep(1)" > koji_download.log 2>&1 &
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
echo "[3/3] Starting the local dev server..."
echo "Serving on: http://localhost:8093/game.html"
if command -v termux-open-url >/dev/null 2>&1; then
  echo "Termux detected! Opening game in your default browser..."
  termux-open-url "http://localhost:8093/game.html" &
fi

node dev-server.mjs --host 0.0.0.0 --port 8093 --no-backend --no-image-service
