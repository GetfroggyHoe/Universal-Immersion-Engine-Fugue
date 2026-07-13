from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image

from .base import VisualTool, ToolContext, ToolResult
from ..inspection.inspector import InspectionReport
from ..schemas.types import ToolID

log = logging.getLogger("visuals.tools.duplicate")


class DuplicateDetectTool(VisualTool):

    @property
    def tool_id(self) -> str:
        return ToolID.DUPLICATE_CHECK.value

    @property
    def name(self) -> str:
        return "Duplicate Detector"

    @property
    def description(self) -> str:
        return "Detect visually identical or nearly identical images using perceptual hashing"

    async def analyze(self, image: Image.Image, report: InspectionReport, context: ToolContext) -> dict[str, Any]:
        return {
            "perceptual_hash": report.perceptual_hash,
            "is_duplicate": report.is_duplicate,
            "duplicate_of": report.duplicate_of,
        }

    async def should_run(self, report: InspectionReport, context: ToolContext) -> bool:
        return report.is_duplicate

    async def process(self, image: Image.Image, context: ToolContext) -> ToolResult:
        return ToolResult(
            success=True,
            image=image,
            tool_id=self.tool_id,
            message=f"Duplicate detected — matches {context.settings.get('duplicate_of', 'unknown')}",
            metadata={"is_duplicate": True},
        )
