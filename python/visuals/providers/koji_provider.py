from __future__ import annotations

import io
import logging
from typing import Any

from .base import ImageProvider, GeneratedImage

log = logging.getLogger("visuals.providers.koji")


class KojiProvider(ImageProvider):

    @property
    def provider_id(self) -> str:
        return "koji"

    @property
    def name(self) -> str:
        return "Koji (Optional Local Model)"

    async def available(self) -> bool:
        try:
            from ..model_manager import get_model_manager
            return get_model_manager().koji_available()
        except Exception:
            return False

    async def generate(
        self,
        prompt: str,
        negative_prompt: str | None = None,
        width: int = 512,
        height: int = 512,
        seed: int | None = None,
        options: dict[str, Any] | None = None,
    ) -> GeneratedImage:
        from ..workers.generation_worker import get_generation_worker
        worker = get_generation_worker()

        import time
        job_id = f"provider_{int(time.time() * 1000)}"

        image_bytes, w, h = await worker.generate(
            job_id=job_id,
            prompt=prompt,
            negative_prompt=negative_prompt or "",
            width=width,
            height=height,
            seed=seed,
        )

        return GeneratedImage(
            image_bytes=image_bytes,
            width=w,
            height=h,
            format="png",
            provider=self.provider_id,
            model="koji_v2.1",
            seed=seed,
        )

    def capabilities(self) -> dict[str, Any]:
        return {
            "max_width": 1024,
            "max_height": 1024,
            "supported_formats": ["png"],
            "style": "anime_game_art",
            "supports_negative_prompt": True,
            "supports_seed": False,
        }
