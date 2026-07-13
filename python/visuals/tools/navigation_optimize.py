from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image, ImageFilter, ImageEnhance

from .base import VisualTool, ToolContext, ToolResult
from ..inspection.inspector import InspectionReport
from ..schemas.types import ToolID, BACKGROUND_TYPES

log = logging.getLogger("visuals.tools.navopt")


class NavigationOptimizeTool(VisualTool):

    @property
    def tool_id(self) -> str:
        return ToolID.NAVIGATION_OPTIMIZE.value

    @property
    def name(self) -> str:
        return "Navigation Background Optimizer"

    @property
    def description(self) -> str:
        return "Optimize backgrounds for UI readability — darken and blur overlay regions"

    async def analyze(self, image: Image.Image, report: InspectionReport, context: ToolContext) -> dict[str, Any]:
        return {
            "is_background": context.visual_type in BACKGROUND_TYPES,
            "background_complexity": report.background_complexity,
        }

    async def should_run(self, report: InspectionReport, context: ToolContext) -> bool:
        if not context.settings.get("automatic_navigation_processing", True):
            return False
        return context.visual_type in BACKGROUND_TYPES

    async def process(self, image: Image.Image, context: ToolContext) -> ToolResult:
        try:
            result = image.copy()
            w, h = result.size

            ui_overlay_height = int(h * 0.3)
            overlay_region = result.crop((0, h - ui_overlay_height, w, h))

            blurred_overlay = overlay_region.filter(ImageFilter.GaussianBlur(radius=3))

            from PIL import ImageEnhance
            darkener = ImageEnhance.Brightness(blurred_overlay)
            blurred_overlay = darkener.enhance(0.7)

            result.paste(blurred_overlay, (0, h - ui_overlay_height))

            top_bar_height = int(h * 0.08)
            top_region = result.crop((0, 0, w, top_bar_height))
            blurred_top = top_region.filter(ImageFilter.GaussianBlur(radius=2))
            darkener_top = ImageEnhance.Brightness(blurred_top)
            blurred_top = darkener_top.enhance(0.75)
            result.paste(blurred_top, (0, 0))

            buf = io.BytesIO()
            result.save(buf, format="PNG", optimize=True)
            result_bytes = buf.getvalue()

            return ToolResult(
                success=True,
                image_bytes=result_bytes,
                image=result,
                tool_id=self.tool_id,
                message="Navigation background optimized — UI regions darkened and blurred",
                metadata={"ui_overlay_height": ui_overlay_height, "top_bar_height": top_bar_height},
            )
        except Exception as exc:
            log.warning(f"Navigation optimization failed: {exc}")
            return ToolResult(
                success=False,
                image=image,
                tool_id=self.tool_id,
                message=f"Navigation optimization failed: {exc}",
            )

    async def validate(self, image: Image.Image, original: Image.Image) -> bool:
        return image.size == original.size
