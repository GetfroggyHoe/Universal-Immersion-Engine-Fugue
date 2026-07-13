from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image

from .base import VisualTool, ToolContext, ToolResult
from ..inspection.inspector import InspectionReport
from ..schemas.types import ToolID, ITEM_TYPES

log = logging.getLogger("visuals.tools.bgremove")


class BackgroundRemoveTool(VisualTool):

    @property
    def tool_id(self) -> str:
        return ToolID.BACKGROUND_REMOVE.value

    @property
    def name(self) -> str:
        return "Background Remover"

    @property
    def description(self) -> str:
        return "Remove background for items, equipment, weapons, and assets"

    async def analyze(self, image: Image.Image, report: InspectionReport, context: ToolContext) -> dict[str, Any]:
        return {
            "visual_type": context.visual_type,
            "is_item_type": context.visual_type in ITEM_TYPES,
            "should_remove": context.visual_type in ITEM_TYPES,
        }

    async def should_run(self, report: InspectionReport, context: ToolContext) -> bool:
        if not context.settings.get("automatic_background_removal", True):
            return False
        return context.visual_type in ITEM_TYPES

    async def process(self, image: Image.Image, context: ToolContext) -> ToolResult:
        try:
            if image.mode != "RGBA":
                image = image.convert("RGBA")

            result = self._simple_background_removal(image)

            buf = io.BytesIO()
            result.save(buf, format="PNG", optimize=True)
            result_bytes = buf.getvalue()

            return ToolResult(
                success=True,
                image_bytes=result_bytes,
                image=result,
                tool_id=self.tool_id,
                message="Background removed — transparent PNG created",
                metadata={"transparent": True},
            )
        except Exception as exc:
            log.warning(f"Background removal failed: {exc}")
            return ToolResult(
                success=False,
                image=image,
                tool_id=self.tool_id,
                message=f"Background removal failed: {exc}",
            )

    def _simple_background_removal(self, image: Image.Image) -> Image.Image:
        import numpy as np

        arr = np.array(image, dtype=np.float32)
        h, w = arr.shape[:2]

        corners = [
            arr[0, 0, :3],
            arr[0, w-1, :3],
            arr[h-1, 0, :3],
            arr[h-1, w-1, :3],
        ]
        bg_color = np.mean(corners, axis=0)

        rgb = arr[:, :, :3]
        diff = np.sqrt(np.sum((rgb - bg_color) ** 2, axis=2))

        threshold = 40.0
        alpha = np.clip(diff * (255.0 / threshold), 0, 255).astype(np.uint8)

        kernel_size = 3
        from PIL import ImageFilter
        alpha_img = Image.fromarray(alpha, mode="L")
        alpha_img = alpha_img.filter(ImageFilter.MinFilter(kernel_size))

        result = arr.copy()
        result[:, :, 3] = np.array(alpha_img, dtype=np.float32)

        return Image.fromarray(result.astype(np.uint8), mode="RGBA")

    async def validate(self, image: Image.Image, original: Image.Image) -> bool:
        return image.mode == "RGBA" and image.size == original.size
