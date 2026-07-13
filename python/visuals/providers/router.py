from __future__ import annotations

import logging
import threading
from typing import Any

from .base import ImageProvider
from .koji_provider import KojiProvider
from .custom_http_provider import CustomHttpProvider

log = logging.getLogger("visuals.providers.router")

_providers: dict[str, ImageProvider] = {}
_lock = threading.Lock()


def register_provider(provider: ImageProvider) -> None:
    with _lock:
        _providers[provider.provider_id] = provider
        log.info(f"Registered provider: {provider.provider_id} -> {provider.name}")


def get_provider(provider_id: str) -> ImageProvider | None:
    return _providers.get(provider_id)


def list_providers() -> list[dict[str, Any]]:
    return [
        {
            "provider_id": p.provider_id,
            "name": p.name,
            "capabilities": p.capabilities(),
        }
        for p in _providers.values()
    ]


async def resolve_provider(
    requested: str = "auto",
    visual_type: str = "",
    settings: dict[str, Any] | None = None,
) -> ImageProvider | None:
    settings = settings or {}

    if requested and requested != "auto":
        provider = get_provider(requested)
        if provider and await provider.available():
            return provider
        return None

    backend_mode = settings.get("visual_backend_mode", "built_in_backend")

    if backend_mode == "custom_model":
        provider = get_provider("custom_model")
        if provider and await provider.available():
            return provider

    koji = get_provider("koji")
    if koji and await koji.available():
        return koji

    return None


def initialize_default_providers() -> None:
    register_provider(KojiProvider())


_provider_router_initialized = False


def ensure_provider_router() -> None:
    global _provider_router_initialized
    if not _provider_router_initialized:
        initialize_default_providers()
        _provider_router_initialized = True
