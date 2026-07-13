from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image

from .base import VisualTool, ToolContext, ToolResult
from ..inspection.inspector import InspectionReport
from ..schemas.types import ToolID

log = logging.getLogger("visuals.tools.thumbnail")


class ThumbnailCreateTool(VisualTool):

    @property
    def tool_id(self) -> str:
        return ToolID.THUMBNAIL_CREATE.value

    @property
    def name(self) -> str:
        return "Thumbnail Creator"

    @property
    def description(self) -> str:
        return "Generate thumbnail variants for UI display"

    async def analyze(self, image: Image.Image, report: InspectionReport, context: ToolContext) -> dict[str, Any]:
        return {
            "resolution": image.size,
            "should_create_thumbnail": image.size[0] >= 256,
        }

    async def should_run(self, report: InspectionReport, context: ToolContext) -> bool:
        return report.resolution[0] >= 256

    async def process(self, image: Image.Image, context: ToolContext) -> ToolResult:
        try:
            thumb_size = 128
            thumb = image.copy()
            thumb.thumbnail((thumb_size, thumb_size), Image.LANCZOS)

            buf = io.BytesIO()
            thumb.save(buf, format="WEBP", quality=75, method=4)
            thumb_bytes = buf.getvalue()

            return ToolResult(
                success=True,
                image_bytes=thumb_bytes,
                image=thumb,
                tool_id=self.tool_id,
                message=f"Thumbnail created ({thumb.size})",
                metadata={"thumbnail_size": thumb.size},
            )
        except Exception as exc:
            log.warning(f"Thumbnail creation failed: {exc}")
            return ToolResult(
                success=False,
                image=image,
                tool_id=self.tool_id,
                message=f"Thumbnail creation failed: {exc}",
            )

    async def validate(self, image: Image.Image, original: Image.Image) -> bool:
        return True
