from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image

from .base import VisualTool, ToolContext, ToolResult
from ..inspection.inspector import InspectionReport
from ..schemas.types import ToolID

log = logging.getLogger("visuals.tools.compress")


class CompressTool(VisualTool):

    @property
    def tool_id(self) -> str:
        return ToolID.COMPRESS.value

    @property
    def name(self) -> str:
        return "Compression Optimizer"

    @property
    def description(self) -> str:
        return "Generate WebP, thumbnails, and preview images"

    async def analyze(self, image: Image.Image, report: InspectionReport, context: ToolContext) -> dict[str, Any]:
        return {
            "resolution": image.size,
            "should_compress": True,
        }

    async def should_run(self, report: InspectionReport, context: ToolContext) -> bool:
        return True

    async def process(self, image: Image.Image, context: ToolContext) -> ToolResult:
        try:
            buf_webp = io.BytesIO()
            image.save(buf_webp, format="WEBP", quality=85, method=4)
            webp_bytes = buf_webp.getvalue()

            buf_png = io.BytesIO()
            image.save(buf_png, format="PNG", optimize=True)
            png_bytes = buf_png.getvalue()

            result_bytes = webp_bytes if len(webp_bytes) < len(png_bytes) else png_bytes
            result_format = "webp" if len(webp_bytes) < len(png_bytes) else "png"

            return ToolResult(
                success=True,
                image_bytes=result_bytes,
                image=image,
                tool_id=self.tool_id,
                message=f"Compressed to {result_format} ({len(result_bytes)} bytes)",
                metadata={
                    "format": result_format,
                    "webp_size": len(webp_bytes),
                    "png_size": len(png_bytes),
                },
            )
        except Exception as exc:
            log.warning(f"Compression failed: {exc}")
            return ToolResult(
                success=False,
                image=image,
                tool_id=self.tool_id,
                message=f"Compression failed: {exc}",
            )
