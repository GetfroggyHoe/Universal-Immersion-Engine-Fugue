from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image

from .base import VisualTool, ToolContext, ToolResult
from ..inspection.inspector import InspectionReport
from ..schemas.types import ToolID, PORTRAIT_TYPES, BACKGROUND_TYPES, ITEM_TYPES, SKILL_TYPES

log = logging.getLogger("visuals.tools.crop")


class SmartCropTool(VisualTool):

    @property
    def tool_id(self) -> str:
        return ToolID.SMART_CROP.value

    @property
    def name(self) -> str:
        return "Smart Cropper"

    @property
    def description(self) -> str:
        return "Intelligently crop images for different UI contexts"

    async def analyze(self, image: Image.Image, report: InspectionReport, context: ToolContext) -> dict[str, Any]:
        return {
            "subject_centered": report.subject_centered,
            "current_size": image.size,
            "visual_type": context.visual_type,
        }

    async def should_run(self, report: InspectionReport, context: ToolContext) -> bool:
        if context.visual_type in PORTRAIT_TYPES and not report.subject_centered:
            return True
        if context.visual_type in ITEM_TYPES and not report.subject_centered:
            return True
        if context.visual_type in SKILL_TYPES and not report.subject_centered:
            return True
        return False

    async def process(self, image: Image.Image, context: ToolContext) -> ToolResult:
        try:
            w, h = image.size

            if context.visual_type in PORTRAIT_TYPES:
                target_ratio = 1.0
                result = self._center_subject_crop(image, target_ratio)
            elif context.visual_type in BACKGROUND_TYPES:
                target_ratio = 16.0 / 9.0
                result = self._wide_crop(image, target_ratio)
            elif context.visual_type in ITEM_TYPES or context.visual_type in SKILL_TYPES:
                target_ratio = 1.0
                result = self._center_subject_crop(image, target_ratio)
            else:
                result = image

            buf = io.BytesIO()
            result.save(buf, format="PNG", optimize=True)
            result_bytes = buf.getvalue()

            return ToolResult(
                success=True,
                image_bytes=result_bytes,
                image=result,
                tool_id=self.tool_id,
                message=f"Cropped to {result.size} for {context.visual_type}",
                metadata={"original_size": image.size, "new_size": result.size},
            )
        except Exception as exc:
            log.warning(f"Smart crop failed: {exc}")
            return ToolResult(
                success=False,
                image=image,
                tool_id=self.tool_id,
                message=f"Crop failed: {exc}",
            )

    def _center_subject_crop(self, image: Image.Image, target_ratio: float) -> Image.Image:
        w, h = image.size
        current_ratio = w / max(h, 1)

        if abs(current_ratio - target_ratio) < 0.05:
            return image

        if current_ratio > target_ratio:
            new_w = int(h * target_ratio)
            left = (w - new_w) // 2
            box = (left, 0, left + new_w, h)
        else:
            new_h = int(w / target_ratio)
            top = (h - new_h) // 2
            box = (0, top, w, top + new_h)

        return image.crop(box)

    def _wide_crop(self, image: Image.Image, target_ratio: float) -> Image.Image:
        w, h = image.size
        current_ratio = w / max(h, 1)

        if abs(current_ratio - target_ratio) < 0.05:
            return image

        if current_ratio > target_ratio:
            new_w = int(h * target_ratio)
            left = (w - new_w) // 2
            box = (left, 0, left + new_w, h)
        else:
            new_h = int(w / target_ratio)
            top = max(0, (h - new_h) // 3)
            box = (0, top, w, min(top + new_h, h))

        return image.crop(box)
