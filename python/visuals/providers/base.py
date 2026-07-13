from __future__ import annotations

import abc
import io
import logging
from dataclasses import dataclass, field
from typing import Any

from PIL import Image

log = logging.getLogger("visuals.providers")


@dataclass
class GeneratedImage:
    image_bytes: bytes
    width: int
    height: int
    format: str = "png"
    provider: str = ""
    model: str = ""
    seed: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def image(self) -> Image.Image:
        return Image.open(io.BytesIO(self.image_bytes))


class ImageProvider(abc.ABC):

    @property
    @abc.abstractmethod
    def provider_id(self) -> str:
        ...

    @property
    @abc.abstractmethod
    def name(self) -> str:
        ...

    @abc.abstractmethod
    async def available(self) -> bool:
        ...

    @abc.abstractmethod
    async def generate(
        self,
        prompt: str,
        negative_prompt: str | None = None,
        width: int = 512,
        height: int = 512,
        seed: int | None = None,
        options: dict[str, Any] | None = None,
    ) -> GeneratedImage:
        ...

    @abc.abstractmethod
    def capabilities(self) -> dict[str, Any]:
        ...

    async def test_connection(self) -> dict[str, Any]:
        try:
            is_available = await self.available()
            return {"success": is_available, "message": "OK" if is_available else "Unavailable"}
        except Exception as exc:
            return {"success": False, "message": str(exc)}
