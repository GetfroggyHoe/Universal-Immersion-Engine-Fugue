"""
Upscaler model download and setup module.

Downloads RealESRGAN_x4plus_anime_6B ONNX model for use as the
built-in visual upscaling pipeline.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any

log = logging.getLogger("upscaler_download")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

DEFAULT_MODELS_DIR = os.environ.get("VISUAL_MODELS_DIR", str(ROOT / "models"))
UPSCALER_DIR = Path(DEFAULT_MODELS_DIR) / "upscaler"

UPSCALER_HF_REPO = os.environ.get(
    "UPSCALER_HF_REPO",
    "ai-forever/Real-ESRGAN",
)
UPSCALER_ONNX_FILENAME = "realesrgan_anime_x4.onnx"
UPSCALER_ONNX_PATH = UPSCALER_DIR / UPSCALER_ONNX_FILENAME

MANIFEST_FILE = UPSCALER_DIR / "manifest.json"

REQUIRED_FILES = [
    UPSCALER_ONNX_FILENAME,
]

_download_lock = threading.Lock()
_download_state: dict[str, Any] = {
    "status": "idle",
    "progress": 0.0,
    "error": None,
    "started_at": None,
    "completed_at": None,
}


def _update_state(**kwargs: Any) -> None:
    for key, value in kwargs.items():
        _download_state[key] = value


def get_download_state() -> dict[str, Any]:
    return dict(_download_state)


def get_upscaler_dir() -> Path:
    return UPSCALER_DIR


def check_upscaler_available() -> bool:
    if not UPSCALER_DIR.exists():
        return False
    for rel_path in REQUIRED_FILES:
        if not (UPSCALER_DIR / rel_path).exists():
            return False
    onnx_file = UPSCALER_DIR / UPSCALER_ONNX_FILENAME
    if not onnx_file.exists() or onnx_file.stat().st_size < 1_000_000:
        return False
    return True


def get_upscaler_status() -> dict[str, Any]:
    downloaded = check_upscaler_available()
    ort_ready = False
    try:
        import onnxruntime
        ort_ready = True
    except ImportError:
        pass

    error = None
    state = get_download_state()
    if state.get("error"):
        error = state["error"]
    elif state.get("status") == "downloading":
        error = "Download in progress"

    manifest = _load_manifest()

    return {
        "upscaler": {
            "downloaded": downloaded,
            "available": downloaded and ort_ready,
            "path": str(UPSCALER_DIR),
            "onnx_path": str(UPSCALER_ONNX_PATH),
            "error": error,
            "repo": UPSCALER_HF_REPO,
            "ort_installed": ort_ready,
            "manifest": manifest,
        },
    }


def _load_manifest() -> dict[str, Any]:
    if MANIFEST_FILE.exists():
        try:
            return json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_manifest(data: dict[str, Any]) -> None:
    MANIFEST_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _do_download() -> bool:
    if check_upscaler_available():
        _update_state(status="ready", progress=1.0, error=None)
        return True

    _update_state(
        status="downloading",
        progress=0.0,
        error=None,
        started_at=time.time(),
        completed_at=None,
    )

    UPSCALER_DIR.mkdir(parents=True, exist_ok=True)

    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_API_TOKEN") or None

    try:
        from huggingface_hub import hf_hub_download

        def _progress_callback(current: int, total: int) -> None:
            if total > 0:
                _update_state(progress=current / total)

        local_path = hf_hub_download(
            repo_id=UPSCALER_HF_REPO,
            filename=UPSCALER_ONNX_FILENAME,
            token=token,
            local_dir=str(UPSCALER_DIR),
            local_dir_use_symlinks=False,
        )
        log.info(f"Upscaler ONNX model downloaded to: {local_path}")
    except ImportError:
        _update_state(
            status="failed",
            error="huggingface_hub is not installed. Run: pip install huggingface_hub",
        )
        return False
    except Exception as exc:
        error_msg = f"Download failed: {exc}"
        _update_state(status="failed", error=error_msg)
        log.error(error_msg)
        return False

    if check_upscaler_available():
        _save_manifest({
            "model": "RealESRGAN_x4plus_anime_6B",
            "source_repo": UPSCALER_HF_REPO,
            "onnx_file": UPSCALER_ONNX_FILENAME,
            "installed_at": time.time(),
        })
        _update_state(
            status="ready",
            progress=1.0,
            error=None,
            completed_at=time.time(),
        )
        log.info("Upscaler download complete and verified")
        return True

    error_msg = "Download completed but verification failed - missing required files"
    _update_state(status="failed", error=error_msg)
    log.error(error_msg)
    return False


def download_upscaler() -> dict[str, Any]:
    with _download_lock:
        current = get_download_state()
        if current.get("status") == "downloading":
            return {"ok": False, "error": "Download already in progress", "state": current}

        if check_upscaler_available():
            return {"ok": True, "already_downloaded": True, "state": get_download_state()}

        success = _do_download()
        return {
            "ok": success,
            "state": get_download_state(),
            "status": get_upscaler_status(),
        }


def download_upscaler_async() -> threading.Thread:
    def _run() -> None:
        download_upscaler()

    thread = threading.Thread(target=_run, daemon=True, name="upscaler-download")
    thread.start()
    return thread


def delete_upscaler() -> dict[str, Any]:
    with _download_lock:
        current = get_download_state()
        if current.get("status") == "downloading":
            return {"ok": False, "error": "Cannot delete while download is in progress"}

        if not UPSCALER_DIR.exists():
            return {"ok": True, "already_deleted": True}

        try:
            shutil.rmtree(str(UPSCALER_DIR))
            _update_state(status="idle", progress=0.0, error=None, started_at=None, completed_at=None)
            log.info("Upscaler model deleted")
            return {"ok": True, "deleted": True}
        except Exception as exc:
            return {"ok": False, "error": f"Failed to delete: {exc}"}


def repair_upscaler() -> dict[str, Any]:
    delete_result = delete_upscaler()
    if not delete_result.get("ok") and not delete_result.get("already_deleted"):
        return delete_result
    return download_upscaler()
