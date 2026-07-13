from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image

from .base import VisualTool, ToolContext, ToolResult
from ..inspection.inspector import InspectionReport
from ..schemas.types import ToolID

log = logging.getLogger("visuals.tools.upscale")


class AnimeUpscaleTool(VisualTool):

    @property
    def tool_id(self) -> str:
        return ToolID.ANIME_UPSCALE.value

    @property
    def name(self) -> str:
        return "Anime Upscaler"

    @property
    def description(self) -> str:
        return "Increase resolution while preserving anime line art and style"

    async def analyze(self, image: Image.Image, report: InspectionReport, context: ToolContext) -> dict[str, Any]:
        return {
            "current_resolution": image.size,
            "blur_score": report.blur_score,
            "needs_upscale": report.blur_score > 0.5 or image.size[0] < 768,
        }

    async def should_run(self, report: InspectionReport, context: ToolContext) -> bool:
        if not context.settings.get("automatic_upscaling", True):
            return False
        return report.blur_score > 0.5 or report.resolution[0] < 768

    async def process(self, image: Image.Image, context: ToolContext) -> ToolResult:
        try:
            from python.visuals.upscaler import get_upscaler_for_mode
            upscaler = get_upscaler_for_mode("anime")
            if upscaler is None:
                return ToolResult(
                    success=False,
                    image=image,
                    tool_id=self.tool_id,
                    message="Anime upscaler model not available",
                )

            buf = io.BytesIO()
            image.save(buf, format="PNG")
            image_bytes = buf.getvalue()

            result_bytes = await upscaler.upscale(image_bytes)
            result_image = Image.open(io.BytesIO(result_bytes))

            return ToolResult(
                success=True,
                image_bytes=result_bytes,
                image=result_image,
                tool_id=self.tool_id,
                message=f"Upscaled from {image.size} to {result_image.size}",
                metadata={"original_size": image.size, "new_size": result_image.size},
            )
        except Exception as exc:
            log.warning(f"Anime upscale failed: {exc}")
            return ToolResult(
                success=False,
                image=image,
                tool_id=self.tool_id,
                message=f"Upscale failed: {exc}",
            )

    async def validate(self, image: Image.Image, original: Image.Image) -> bool:
        return image.size[0] >= original.size[0]
