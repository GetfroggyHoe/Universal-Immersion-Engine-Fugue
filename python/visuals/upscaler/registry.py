from __future__ import annotations

import logging
import threading
from typing import Any

from .base import ImageUpscaler

log = logging.getLogger("upscaler.registry")

_registry: dict[str, type[ImageUpscaler]] = {}
_instances: dict[str, ImageUpscaler] = {}
_lock = threading.Lock()


def register_upscaler(key: str, cls: type[ImageUpscaler]) -> None:
    _registry[key] = cls
    log.info(f"Registered upscaler: {key} -> {cls.__name__}")


def get_upscaler(key: str) -> ImageUpscaler | None:
    cls = _registry.get(key)
    if cls is None:
        return None
    with _lock:
        if key not in _instances:
            _instances[key] = cls()
        return _instances[key]


def list_upscalers() -> list[dict[str, Any]]:
    result = []
    for key, cls in _registry.items():
        result.append({
            "key": key,
            "class": cls.__name__,
        })
    return result


def available_upscaler_keys() -> list[str]:
    return list(_registry.keys())


def clear_instances() -> None:
    with _lock:
        _instances.clear()
