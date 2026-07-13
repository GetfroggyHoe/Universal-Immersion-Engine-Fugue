from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image

from .base import VisualTool, ToolContext, ToolResult
from ..inspection.inspector import InspectionReport
from ..schemas.types import ToolID

log = logging.getLogger("visuals.tools.format")


class FormatConvertTool(VisualTool):

    @property
    def tool_id(self) -> str:
        return ToolID.FORMAT_CONVERT.value

    @property
    def name(self) -> str:
        return "Format Converter"

    @property
    def description(self) -> str:
        return "Convert between image formats (PNG, WebP, JPEG)"

    async def analyze(self, image: Image.Image, report: InspectionReport, context: ToolContext) -> dict[str, Any]:
        target_format = context.settings.get("target_format", "webp")
        return {
            "current_format": "PNG",
            "target_format": target_format,
        }

    async def should_run(self, report: InspectionReport, context: ToolContext) -> bool:
        target_format = context.settings.get("target_format", "")
        return bool(target_format)

    async def process(self, image: Image.Image, context: ToolContext) -> ToolResult:
        try:
            target_format = context.settings.get("target_format", "webp").upper()
            if target_format == "WEBP":
                buf = io.BytesIO()
                image.save(buf, format="WEBP", quality=85, method=4)
                result_bytes = buf.getvalue()
            elif target_format == "JPEG" or target_format == "JPG":
                rgb = image.convert("RGB")
                buf = io.BytesIO()
                rgb.save(buf, format="JPEG", quality=90, optimize=True)
                result_bytes = buf.getvalue()
            else:
                buf = io.BytesIO()
                image.save(buf, format="PNG", optimize=True)
                result_bytes = buf.getvalue()

            return ToolResult(
                success=True,
                image_bytes=result_bytes,
                image=image,
                tool_id=self.tool_id,
                message=f"Converted to {target_format}",
                metadata={"format": target_format, "size": len(result_bytes)},
            )
        except Exception as exc:
            log.warning(f"Format conversion failed: {exc}")
            return ToolResult(
                success=False,
                image=image,
                tool_id=self.tool_id,
                message=f"Format conversion failed: {exc}",
            )
