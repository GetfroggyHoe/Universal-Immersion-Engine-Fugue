#!/usr/bin/env bash
# Run the living-world backend and game server on the same device (Android + Termux).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PYTHON_BIN="${PYTHON_BIN:-python}"
BACKEND_HOST="${UIE_BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${UIE_BACKEND_PORT:-8101}"
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
      nohup "$PYTHON_BIN" -c "import sys,logging,time; sys.path.insert(0, '.'); logging.basicConfig(level=logging.INFO); from python.visuals.download_koji import download_koji; download_koji(); time.sleep(1)" > koji_download.log 2>&1 &
      ;;
    *)
      echo "Skipping KOJI image gen install. You can install it later from Settings."
      ;;
  esac
elif [ -f "models/koji/koji_v21.safetensors" ] || [ -f "models/koji/koji_v21-q4_k_m.gguf" ]; then
  echo "KOJI model already present. Skipping prompt."
fi

if ! "$PYTHON_BIN" - <<'PY' >/dev/null 2>&1
import fastapi, uvicorn
PY
then
  echo "FastAPI dependencies are missing. Run: $PYTHON_BIN -m pip install -r python/requirements.txt"
  exit 1
fi

"$PYTHON_BIN" -m uvicorn python.uie_backend:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" &
BACKEND_PID="$!"
trap 'kill "$BACKEND_PID" 2>/dev/null || true' EXIT INT TERM

echo "Living world backend: http://$BACKEND_HOST:$BACKEND_PORT"
echo "Game frontend: http://$FRONTEND_HOST:$FRONTEND_PORT/game.html"
exec node dev-server.mjs --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
