#!/usr/bin/env bash
# Run the living-world backend and game server on the same device (Android + Termux).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BACKEND_HOST="${UIE_BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${UIE_BACKEND_PORT:-28101}"
FRONTEND_HOST="${UIE_FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${UIE_FRONTEND_PORT:-8093}"

# Optional KOJI local image generation model. Ask once per installation only.
KOJI_PROMPT_MARKER="data/.koji-install-choice-recorded"
if [ ! -f "$KOJI_PROMPT_MARKER" ] && [ ! -f "models/koji/koji_v21.safetensors" ] && [ ! -f "models/koji/koji_v21-q4_k_m.gguf" ]; then
  echo ""
  echo "[Optional] KOJI Local Image Generation Model"
  echo "  Size: ~2.5 GB download from HuggingFace (calcuis/koji)"
  echo "  No API key required once installed. You can skip and install later in Settings."
  printf "Install KOJI image gen now? (requires ~2.5 GB) [Y/N]: "
  read -r INSTALL_KOJI
  mkdir -p "$(dirname "$KOJI_PROMPT_MARKER")"
  : > "$KOJI_PROMPT_MARKER"
  case "$INSTALL_KOJI" in
    [Yy])
      echo "Starting KOJI download in the background (watch progress in Settings > Visual Gen)..."
      nohup .venv/bin/python -c "import sys,logging,time; sys.path.insert(0, '.'); logging.basicConfig(level=logging.INFO); from python.visuals.download_koji import download_koji; download_koji(); time.sleep(1)" > koji_download.log 2>&1 &
      ;;
    *)
      echo "Skipping KOJI image gen install. You can install it later from Settings."
      ;;
  esac
elif [ -f "models/koji/koji_v21.safetensors" ] || [ -f "models/koji/koji_v21-q4_k_m.gguf" ]; then
  echo "KOJI model already present. Skipping prompt."
fi

if [ ! -f "python/requirements-backend.txt" ]; then
  echo "Required file missing: $ROOT/python/requirements-backend.txt"
  echo "Your download is incomplete. Re-download or update UIE."
  exit 1
fi

# Use the same local, portable dependency installer as start.sh. In particular,
# do not require optional ONNX voice packages that have no Termux wheels.
export PYTHON="${PYTHON_BIN:-python}"
export UIE_VENV_SETUP="${UIE_VENV_SETUP:-1}"
node dev-server.mjs --prepare-only --no-image-service
PYTHON_BIN=".venv/bin/python"

"$PYTHON_BIN" -m uvicorn python.uie_backend:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" &
BACKEND_PID="$!"
trap 'kill "$BACKEND_PID" 2>/dev/null || true' EXIT INT TERM

echo "Living world backend: http://$BACKEND_HOST:$BACKEND_PORT"
echo "Game frontend: http://$FRONTEND_HOST:$FRONTEND_PORT/game.html"
exec node dev-server.mjs --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" --backend-host "$BACKEND_HOST" --backend-port "$BACKEND_PORT" --no-backend
