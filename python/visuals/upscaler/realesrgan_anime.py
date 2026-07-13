from __future__ import annotations

import asyncio
import hashlib
import io
import logging
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np

from .base import ImageUpscaler

log = logging.getLogger("upscaler.realesrgan")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]

DEFAULT_MODELS_DIR = os.environ.get("VISUAL_MODELS_DIR", str(ROOT / "models"))
UPSCALER_DIR = Path(DEFAULT_MODELS_DIR) / "upscaler"
ONNX_MODEL_PATH = UPSCALER_DIR / "realesrgan_anime_x4.onnx"

TILE_SIZE = 192
TILE_PAD = 16


def _detect_platform() -> dict[str, Any]:
    is_android = (
        "ANDROID_DATA" in os.environ
        or (sys.platform.startswith("linux") and Path("/data/data").exists())
    )
    info: dict[str, Any] = {"is_android": is_android, "providers": []}
    try:
        import onnxruntime as ort
        available = set(ort.get_available_providers())
        info["ort_available"] = True
        info["all_providers"] = sorted(available)

        if is_android:
            if "NNAPIExecutionProvider" in available:
                info["providers"] = ["NNAPIExecutionProvider", "CPUExecutionProvider"]
            else:
                info["providers"] = ["CPUExecutionProvider"]
        else:
            if "CUDAExecutionProvider" in available:
                info["providers"] = ["CUDAExecutionProvider", "CPUExecutionProvider"]
            elif "DmlExecutionProvider" in available:
                info["providers"] = ["DmlExecutionProvider", "CPUExecutionProvider"]
            elif "ROCMExecutionProvider" in available:
                info["providers"] = ["ROCMExecutionProvider", "CPUExecutionProvider"]
            else:
                info["providers"] = ["CPUExecutionProvider"]
    except ImportError:
        info["ort_available"] = False
        info["providers"] = ["CPUExecutionProvider"]
    return info


def _check_memory_ok() -> bool:
    try:
        import onnxruntime as ort
        session_options = ort.SessionOptions()
        session_options.enable_mem_pattern = False
        return True
    except ImportError:
        return False


def _preprocess_image(image_bytes: bytes) -> tuple[np.ndarray, int, int]:
    from PIL import Image as PILImage
    img = PILImage.open(io.BytesIO(image_bytes)).convert("RGB")
    w, h = img.size
    img_array = np.array(img, dtype=np.float32) / 255.0
    img_array = np.transpose(img_array, (2, 0, 1))
    img_array = np.expand_dims(img_array, axis=0).astype(np.float32)
    return img_array, h, w


def _postprocess_image(output_array: np.ndarray, target_h: int, target_w: int) -> bytes:
    from PIL import Image as PILImage
    output = np.squeeze(output_array, axis=0)
    output = np.transpose(output, (1, 2, 0))
    output = np.clip(output * 255.0, 0, 255).astype(np.uint8)
    img = PILImage.fromarray(output, "RGB")
    if img.size != (target_w, target_h):
        img = img.resize((target_w, target_h), PILImage.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


def _tile_process(session: Any, img_array: np.ndarray) -> np.ndarray:
    _, _, h, w = img_array.shape
    scale = 4
    output_h = h * scale
    output_w = w * scale
    output = np.zeros((1, 3, output_h, output_w), dtype=np.float32)

    tiles_y = max(1, (h + TILE_SIZE - 1) // TILE_SIZE)
    tiles_x = max(1, (w + TILE_SIZE - 1) // TILE_SIZE)

    input_name = session.get_inputs()[0].name

    for ty in range(tiles_y):
        for tx in range(tiles_x):
            y_start = ty * TILE_SIZE
            x_start = tx * TILE_SIZE
            y_end = min(y_start + TILE_SIZE, h)
            x_end = min(x_start + TILE_SIZE, w)

            y_start_pad = max(0, y_start - TILE_PAD)
            x_start_pad = max(0, x_start - TILE_PAD)
            y_end_pad = min(h, y_end + TILE_PAD)
            x_end_pad = min(w, x_end + TILE_PAD)

            tile_input = img_array[:, :, y_start_pad:y_end_pad, x_start_pad:x_end_pad]

            tile_output = session.run(None, {input_name: tile_input})[0]

            out_y_start = (y_start - y_start_pad) * scale
            out_x_start = (x_start - x_start_pad) * scale
            out_y_end = out_y_start + (y_end - y_start) * scale
            out_x_end = out_x_start + (x_end - x_start) * scale

            output[:, :, y_start * scale:y_end * scale, x_start * scale:x_end * scale] = (
                tile_output[:, :, out_y_start:out_y_end, out_x_start:out_x_end]
            )

    return output


class RealESRGANAnimeUpscaler(ImageUpscaler):

    def __init__(self) -> None:
        self._session: Any = None
        self._lock = asyncio.Lock()
        self._load_lock = threading.Lock()
        self._loaded = False
        self._platform_info: dict[str, Any] | None = None
        self._cache: dict[str, bytes] = {}
        self._cache_lock = threading.Lock()
        self._max_cache = 64
        self._cancelled: set[str] = set()
        self._cancel_lock = threading.Lock()

    @property
    def name(self) -> str:
        return "RealESRGAN_x4plus_anime_6B"

    @property
    def scale_factor(self) -> int:
        return 4

    def is_loaded(self) -> bool:
        return self._loaded and self._session is not None

    def capabilities(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "scale_factor": self.scale_factor,
            "loaded": self.is_loaded(),
            "model_path": str(ONNX_MODEL_PATH),
            "model_exists": ONNX_MODEL_PATH.exists(),
            "platform": self._platform_info or _detect_platform(),
            "supports_gpu": self._supports_gpu(),
            "tile_size": TILE_SIZE,
        }

    def _supports_gpu(self) -> bool:
        info = self._platform_info or _detect_platform()
        providers = info.get("providers", [])
        return any(p != "CPUExecutionProvider" for p in providers)

    async def load(self) -> None:
        if self._loaded and self._session is not None:
            return

        if not ONNX_MODEL_PATH.exists():
            raise RuntimeError(
                f"Upscaler model not found at {ONNX_MODEL_PATH}. "
                "Download it first via /visuals/models/upscaler/download"
            )

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._load_sync)

    def _load_sync(self) -> None:
        with self._load_lock:
            if self._loaded and self._session is not None:
                return

            import onnxruntime as ort

            self._platform_info = _detect_platform()
            providers = self._platform_info["providers"]

            if self._platform_info["is_android"]:
                import shutil
                free_mem = shutil.disk_usage(str(UPSCALER_DIR)).free
                if free_mem < 500 * 1024 * 1024:
                    log.warning("Low disk space, upscaler may fail")

            session_options = ort.SessionOptions()
            session_options.enable_mem_pattern = False
            session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            session_options.inter_op_num_threads = 2
            session_options.intra_op_num_threads = 2

            log.info(f"Loading RealESRGAN anime upscaler from {ONNX_MODEL_PATH} with providers={providers}")
            self._session = ort.InferenceSession(
                str(ONNX_MODEL_PATH),
                sess_options=session_options,
                providers=providers,
            )
            self._loaded = True
            log.info("RealESRGAN anime upscaler loaded successfully")

    async def upscale(self, image_bytes: bytes) -> bytes:
        cache_key = hashlib.sha256(image_bytes).hexdigest()

        with self._cache_lock:
            if cache_key in self._cache:
                log.debug("Upscaler cache hit")
                return self._cache[cache_key]

        if not self.is_loaded():
            await self.load()

        job_id = cache_key[:16]

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, self._upscale_sync, image_bytes, job_id)

        with self._cancel_lock:
            self._cancelled.discard(job_id)

        self._cache_result(cache_key, result)

        return result

    def _upscale_sync(self, image_bytes: bytes, job_id: str) -> bytes:
        t0 = time.perf_counter()

        with self._cancel_lock:
            if job_id in self._cancelled:
                raise RuntimeError("Upscale job cancelled")

        img_array, orig_h, orig_w = _preprocess_image(image_bytes)
        _, _, h, w = img_array.shape

        target_h = h * self.scale_factor
        target_w = w * self.scale_factor

        if h <= TILE_SIZE and w <= TILE_SIZE:
            input_name = self._session.get_inputs()[0].name
            output = self._session.run(None, {input_name: img_array})[0]
        else:
            output = _tile_process(self._session, img_array)

        result = _postprocess_image(output, target_h, target_w)

        elapsed = time.perf_counter() - t0
        log.info(f"Upscaled {orig_w}x{orig_h} -> {target_w}x{target_h} in {elapsed:.2f}s")

        return result

    def _cache_result(self, key: str, data: bytes) -> None:
        with self._cache_lock:
            if len(self._cache) >= self._max_cache:
                oldest_key = next(iter(self._cache))
                del self._cache[oldest_key]
            self._cache[key] = data

    def request_cancel(self, job_id_prefix: str) -> int:
        count = 0
        with self._cancel_lock:
            for key in list(self._cancelled):
                if key.startswith(job_id_prefix):
                    count += 1
        return count

    async def unload(self) -> None:
        with self._load_lock:
            if self._session is not None:
                del self._session
                self._session = None
            self._loaded = False
            with self._cache_lock:
                self._cache.clear()
            log.info("RealESRGAN anime upscaler unloaded")

    def clear_cache(self) -> int:
        with self._cache_lock:
            count = len(self._cache)
            self._cache.clear()
            return count
