from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image, ImageFilter

from .base import VisualTool, ToolContext, ToolResult
from ..inspection.inspector import InspectionReport
from ..schemas.types import ToolID

log = logging.getLogger("visuals.tools.sharpen")


class SharpenTool(VisualTool):

    @property
    def tool_id(self) -> str:
        return ToolID.SHARPEN.value

    @property
    def name(self) -> str:
        return "Sharpen"

    @property
    def description(self) -> str:
        return "Controlled sharpening for blurry images"

    async def analyze(self, image: Image.Image, report: InspectionReport, context: ToolContext) -> dict[str, Any]:
        return {
            "blur_score": report.blur_score,
            "needs_sharpen": report.blur_score > 0.6,
        }

    async def should_run(self, report: InspectionReport, context: ToolContext) -> bool:
        return report.blur_score > 0.6

    async def process(self, image: Image.Image, context: ToolContext) -> ToolResult:
        try:
            result = image.filter(ImageFilter.SHARPEN)
            result = result.filter(ImageFilter.DETAIL)

            buf = io.BytesIO()
            result.save(buf, format="PNG", optimize=True)
            result_bytes = buf.getvalue()

            return ToolResult(
                success=True,
                image_bytes=result_bytes,
                image=result,
                tool_id=self.tool_id,
                message="Image sharpened",
            )
        except Exception as exc:
            log.warning(f"Sharpen failed: {exc}")
            return ToolResult(
                success=False,
                image=image,
                tool_id=self.tool_id,
                message=f"Sharpen failed: {exc}",
            )
