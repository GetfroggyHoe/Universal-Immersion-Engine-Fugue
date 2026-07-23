"""
Koji model download and setup module.

Downloads calcuis/koji from HuggingFace for use as the
built-in visual generation model.

The repo contains:
- koji_v21.safetensors (main model checkpoint, ~2.13 GB)
- koji_v21_clip_l.safetensors (CLIP text encoder, ~247 MB)
- koji_v21_vae.safetensors (VAE, ~167 MB)
- workflow-koji.json (ComfyUI workflow)
- Various GGUF quantized versions (q4_k_m, q8_0, etc.)
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

log = logging.getLogger("koji")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

DEFAULT_MODELS_DIR = os.environ.get("VISUAL_MODELS_DIR", str(ROOT / "models"))
KOJI_DIR = Path(DEFAULT_MODELS_DIR) / "koji"

KOJI_HF_REPO = os.environ.get("KOJI_HF_REPO", "calcuis/koji")

# Files required for full-precision operation
REQUIRED_FILES = [
    "koji_v21.safetensors",
    "koji_v21_clip_l.safetensors",
    "koji_v21_vae.safetensors",
    "workflow-koji.json",
]

# GGUF quant options (user can pick one instead of full model)
GGUF_OPTIONS = {
    "q2_k": "koji_v21-q2_k.gguf",
    "q3_k_s": "koji_v21-q3_k_s.gguf",
    "q3_k_m": "koji_v21-q3_k_m.gguf",
    "q3_k_l": "koji_v21-q3_k_l.gguf",
    "q4_0": "koji_v21-q4_0.gguf",
    "q4_1": "koji_v21-q4_1.gguf",
    "q4_k_s": "koji_v21-q4_k_s.gguf",
    "q4_k_m": "koji_v21-q4_k_m.gguf",
    "q5_0": "koji_v21-q5_0.gguf",
    "q5_1": "koji_v21-q5_1.gguf",
    "q5_k_s": "koji_v21-q5_k_s.gguf",
    "q5_k_m": "koji_v21-q5_k_m.gguf",
    "q6_k": "koji_v21-q6_k.gguf",
    "q8_0": "koji_v21-q8_0.gguf",
    "f16": "koji_v21-f16.gguf",
}

# Default quant to download if not using full safetensors
DEFAULT_GGUF_QUANT = os.environ.get("KOJI_GGUF_QUANT", "q4_k_m")

_download_lock = threading.Lock()
_download_state: dict[str, Any] = {
    "status": "idle",
    "progress": 0.0,
    "error": None,
    "started_at": None,
    "completed_at": None,
    "files_downloaded": [],
    "total_files": 0,
    "current_file": None,
    "bytes_downloaded": 0,
    "bytes_total": 0,
}


def _update_state(**kwargs: Any) -> None:
    for key, value in kwargs.items():
        _download_state[key] = value


def get_download_state() -> dict[str, Any]:
    return dict(_download_state)


def get_koji_dir() -> Path:
    return KOJI_DIR


def check_koji_available() -> bool:
    """Check if Koji model files are present (full safetensors or GGUF quant)."""
    if not KOJI_DIR.exists():
        return False

    # Check for workflow file (always required)
    if not (KOJI_DIR / "workflow-koji.json").exists():
        return False

    # Check for VAE and CLIP (always required)
    if not (KOJI_DIR / "koji_v21_vae.safetensors").exists():
        return False
    if not (KOJI_DIR / "koji_v21_clip_l.safetensors").exists():
        return False

    # Check for main model (full safetensors OR any GGUF quant)
    has_main_model = (KOJI_DIR / "koji_v21.safetensors").exists()
    if not has_main_model:
        # Check for any GGUF quant
        has_main_model = any(
            (KOJI_DIR / fname).exists()
            for fname in GGUF_OPTIONS.values()
        )

    return has_main_model


def get_model_status() -> dict[str, Any]:
    koji_enabled = os.environ.get("ENABLE_KOJI", "true").lower() in ("true", "1", "yes")
    koji_downloaded = check_koji_available()
    koji_error = None
    if koji_enabled and not koji_downloaded:
        state = get_download_state()
        if state.get("error"):
            koji_error = state["error"]
        elif state.get("status") == "downloading":
            koji_error = "Download in progress"

    # Check which format is available
    model_format = None
    if (KOJI_DIR / "koji_v21.safetensors").exists():
        model_format = "safetensors"
    else:
        for quant_key, fname in GGUF_OPTIONS.items():
            if (KOJI_DIR / fname).exists():
                model_format = f"gguf_{quant_key}"
                break

    return {
        "koji": {
            "enabled": koji_enabled,
            "downloaded": koji_downloaded,
            "available": koji_enabled and koji_downloaded,
            "path": str(KOJI_DIR),
            "error": koji_error,
            "repo": KOJI_HF_REPO,
            "model_format": model_format,
            "files_present": _list_present_files(),
        },
        "active_builtin_model": "koji" if (koji_enabled and koji_downloaded) else None,
    }


def _list_present_files() -> list[str]:
    """List which Koji files are present in the directory."""
    if not KOJI_DIR.exists():
        return []
    present = []
    for fname in REQUIRED_FILES:
        if (KOJI_DIR / fname).exists():
            present.append(fname)
    for quant_key, fname in GGUF_OPTIONS.items():
        if (KOJI_DIR / fname).exists():
            present.append(fname)
    return present


def _do_download(use_gguf: bool = False, gguf_quant: str | None = None) -> bool:
    if check_koji_available():
        _update_state(status="ready", progress=1.0, error=None)
        return True

    _update_state(
        status="downloading",
        progress=0.0,
        error=None,
        started_at=time.time(),
        completed_at=None,
        files_downloaded=[],
        total_files=0,
        current_file=None,
        bytes_downloaded=0,
        bytes_total=0,
    )

    KOJI_DIR.mkdir(parents=True, exist_ok=True)

    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_API_TOKEN") or None

    # Determine which files to download
    if use_gguf:
        quant = gguf_quant or DEFAULT_GGUF_QUANT
        if quant not in GGUF_OPTIONS:
            _update_state(status="failed", error=f"Unknown GGUF quant: {quant}")
            return False
        files_to_download = [
            GGUF_OPTIONS[quant],
            "koji_v21_clip_l.safetensors",
            "koji_v21_vae.safetensors",
            "workflow-koji.json",
        ]
    else:
        files_to_download = REQUIRED_FILES[:]

    _update_state(total_files=len(files_to_download))

    try:
        from huggingface_hub import HfApi, hf_hub_download

        # Fetch the file sizes first so Settings can show real byte-level
        # progress rather than only changing after each multi-GB file.
        try:
            repo_info = HfApi(token=token).repo_info(KOJI_HF_REPO, files_metadata=True)
            remote_sizes = {
                sibling.rfilename: int(sibling.size or 0)
                for sibling in repo_info.siblings
                if sibling.rfilename in files_to_download
            }
        except Exception as exc:
            log.warning("Could not fetch Koji file sizes: %s", exc)
            remote_sizes = {}

        total_bytes = sum(remote_sizes.get(filename, 0) for filename in files_to_download)
        _update_state(bytes_total=total_bytes)

        downloaded = []
        for i, filename in enumerate(files_to_download):
            log.info(f"Downloading Koji file {i+1}/{len(files_to_download)}: {filename}")
            completed_bytes = sum(remote_sizes.get(done, 0) for done in downloaded)
            file_size = remote_sizes.get(filename, 0)
            _update_state(
                progress=(completed_bytes / total_bytes) if total_bytes else (i / len(files_to_download)),
                current_file=filename,
                bytes_downloaded=completed_bytes,
            )

            class KojiDownloadProgress:
                """Minimal tqdm-compatible reporter used by huggingface_hub."""
                def __init__(self, total=None, initial=0, **_kwargs):
                    self.total = int(total or file_size or 0)
                    self.current = int(initial or 0)
                    self._report()

                def _report(self):
                    current_bytes = completed_bytes + self.current
                    denominator = total_bytes or (completed_bytes + self.total)
                    _update_state(
                        bytes_downloaded=current_bytes,
                        bytes_total=denominator,
                        progress=(current_bytes / denominator) if denominator else (i / len(files_to_download)),
                    )

                def update(self, amount=1):
                    self.current += int(amount or 0)
                    self._report()

                def __enter__(self):
                    return self

                def __exit__(self, *_args):
                    self.close()

                def close(self):
                    self.current = max(self.current, self.total)
                    self._report()

            # UIE_HF_HUB_DOWNLOAD_COMPAT
            # Do not pass tqdm_class to hf_hub_download; it is not accepted
            # by several supported huggingface_hub releases. Only pass optional
            # keywords that the installed version explicitly exposes.
            download_kwargs = {
                "repo_id": KOJI_HF_REPO,
                "filename": filename,
                "token": token,
                "local_dir": str(KOJI_DIR),
            }
            try:
                import inspect
                hub_parameters = inspect.signature(hf_hub_download).parameters
            except (TypeError, ValueError):
                hub_parameters = {}
            if "local_dir_use_symlinks" in hub_parameters:
                download_kwargs["local_dir_use_symlinks"] = False
            local_path = hf_hub_download(**download_kwargs)
            downloaded.append(filename)
            _update_state(files_downloaded=downloaded, current_file=None)
            log.info(f"Downloaded: {local_path}")

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

    if check_koji_available():
        _update_state(
            status="ready",
            progress=1.0,
            error=None,
            completed_at=time.time(),
            current_file=None,
            bytes_downloaded=_download_state.get("bytes_total", 0),
        )
        log.info("Koji download complete and verified")
        return True

    error_msg = "Download completed but verification failed - missing required files"
    _update_state(status="failed", error=error_msg)
    log.error(error_msg)
    return False


def download_koji(use_gguf: bool = False, gguf_quant: str | None = None) -> dict[str, Any]:
    # UIE_KOJI_DEPENDENCY_PREFLIGHT_V2
    from .koji_dependencies import ensure_koji_dependencies
    dependency_status = ensure_koji_dependencies(auto_repair=True)
    if not dependency_status.get("ok"):
        raise RuntimeError(
            dependency_status.get("error") or "Koji dependencies could not be prepared."
        )
    with _download_lock:
        current = get_download_state()
        if current.get("status") == "downloading":
            return {"ok": False, "error": "Download already in progress", "state": current}

        if check_koji_available():
            return {"ok": True, "already_downloaded": True, "state": get_download_state()}

        success = _do_download(use_gguf=use_gguf, gguf_quant=gguf_quant)
        return {
            "ok": success,
            "state": get_download_state(),
            "status": get_model_status(),
        }


def download_koji_async(use_gguf: bool = False, gguf_quant: str | None = None) -> threading.Thread:
    def _run() -> None:
        download_koji(use_gguf=use_gguf, gguf_quant=gguf_quant)

    thread = threading.Thread(target=_run, daemon=True, name="koji-download")
    thread.start()
    return thread


def delete_koji() -> dict[str, Any]:
    """Remove the Koji model folder entirely.

    This clears the model files, the HuggingFace ``.cache`` directory, and any
    partial/leftover downloads so nothing irrelevant remains behind.
    """
    if not KOJI_DIR.exists():
        return {"ok": True, "already_deleted": True, "path": str(KOJI_DIR)}

    # Best-effort: unload a loaded model so file handles are released first.
    try:
        from .model_manager import get_model_manager

        get_model_manager().unload()
    except Exception:
        pass

    try:
        shutil.rmtree(str(KOJI_DIR))
        log.info("Koji model deleted")
        return {"ok": True, "deleted": True, "path": str(KOJI_DIR)}
    except Exception as exc:
        return {"ok": False, "error": f"Failed to delete: {exc}", "path": str(KOJI_DIR)}
