"""
ModelManager - Centralized model lifecycle management.

Delegates actual model loading and generation to the GenerationWorker.
Provides a clean API for load/unload/reload/health_check.
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Any

from .download_koji import (
    KOJI_DIR,
    check_koji_available,
    get_model_status,
)

log = logging.getLogger("model_manager")

QUALITY_MODES = ("fast", "balanced", "quality")

_model_manager_instance: ModelManager | None = None
_instance_lock = threading.Lock()


def select_builtin_model(
    visual_type: str,
    quality_mode: str = "balanced",
    koji_available: bool = True,
) -> str | None:
    if koji_available:
        return "koji"
    return None


class ModelManager:
    def __init__(self) -> None:
        self._quality_mode: str = os.environ.get("VISUAL_QUALITY_MODE", "balanced")
        if self._quality_mode not in QUALITY_MODES:
            self._quality_mode = "balanced"
        log.info(f"ModelManager initialized (quality={self._quality_mode})")

    @property
    def quality_mode(self) -> str:
        return self._quality_mode

    @quality_mode.setter
    def quality_mode(self, value: str) -> None:
        if value in QUALITY_MODES:
            self._quality_mode = value
            from .workers.generation_worker import get_generation_worker
            get_generation_worker().quality_mode = value

    def koji_available(self) -> bool:
        if not check_koji_available():
            return False
        try:
            import diffusers
            import torch
            return True
        except ImportError:
            return False

    def get_status(self) -> dict[str, Any]:
        status = get_model_status()
        from .workers.generation_worker import get_generation_worker
        worker = get_generation_worker()
        status["device"] = worker.device
        status["quality_mode"] = self._quality_mode
        status["available_quality_modes"] = list(QUALITY_MODES)
        status["loaded"] = worker.is_loaded
        status["healthy"] = worker.is_healthy
        return status

    def select_model(self, visual_type: str) -> str | None:
        return select_builtin_model(
            visual_type=visual_type,
            quality_mode=self._quality_mode,
            koji_available=self.koji_available(),
        )

    def load(self) -> bool:
        from .workers.generation_worker import get_generation_worker
        return get_generation_worker().load_model()

    def unload(self) -> None:
        from .workers.generation_worker import get_generation_worker
        get_generation_worker().unload()

    def reload(self) -> bool:
        from .workers.generation_worker import get_generation_worker
        return get_generation_worker().reload()

    def health_check(self) -> dict[str, Any]:
        from .workers.generation_worker import get_generation_worker
        return get_generation_worker().health_check()

    def generate(
        self,
        prompt: str,
        width: int = 512,
        height: int = 512,
        negative_prompt: str = "",
        guidance_scale: float = 7.5,
        seed: int | None = None,
    ) -> bytes:
        from .workers.generation_worker import get_generation_worker
        worker = get_generation_worker()

        import asyncio
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                result = pool.submit(
                    worker._generate_sync,
                    prompt,
                    negative_prompt,
                    width,
                    height,
                    guidance_scale,
                    20,
                    seed,
                ).result()
                return result[0]
        else:
            result = worker._generate_sync(
                prompt,
                negative_prompt,
                width,
                height,
                guidance_scale,
                20,
                seed,
            )
            return result[0]

    def generate_with_fallback(
        self,
        visual_type: str,
        prompt: str,
        width: int = 512,
        height: int = 512,
        negative_prompt: str = "",
        guidance_scale: float = 7.5,
        seed: int | None = None,
    ) -> tuple[bytes, str, str]:
        if self.koji_available():
            data = self.generate(
                prompt=prompt,
                width=width,
                height=height,
                negative_prompt=negative_prompt,
                guidance_scale=guidance_scale,
                seed=seed,
            )
            return data, "image/png", "koji"

        raise RuntimeError("No local model is available. Install the optional Koji model or configure another image provider.")


def get_model_manager() -> ModelManager:
    global _model_manager_instance
    with _instance_lock:
        if _model_manager_instance is None:
            _model_manager_instance = ModelManager()
        return _model_manager_instance
