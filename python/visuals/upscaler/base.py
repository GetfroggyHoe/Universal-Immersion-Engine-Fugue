from __future__ import annotations

import abc
from typing import Any


class ImageUpscaler(abc.ABC):

    @abc.abstractmethod
    async def load(self) -> None:
        ...

    @abc.abstractmethod
    async def upscale(self, image_bytes: bytes) -> bytes:
        ...

    @abc.abstractmethod
    async def unload(self) -> None:
        ...

    @abc.abstractmethod
    def capabilities(self) -> dict[str, Any]:
        ...

    @property
    @abc.abstractmethod
    def name(self) -> str:
        ...

    @property
    @abc.abstractmethod
    def scale_factor(self) -> int:
        ...

    @abc.abstractmethod
    def is_loaded(self) -> bool:
        ...
