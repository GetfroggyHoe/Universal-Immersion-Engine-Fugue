from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image, ImageEnhance

from .base import VisualTool, ToolContext, ToolResult
from ..inspection.inspector import InspectionReport
from ..schemas.types import ToolID

log = logging.getLogger("visuals.tools.color")


class ColorOptimizeTool(VisualTool):

    @property
    def tool_id(self) -> str:
        return ToolID.COLOR_OPTIMIZE.value

    @property
    def name(self) -> str:
        return "Color Optimizer"

    @property
    def description(self) -> str:
        return "Correct exposure, contrast, white balance, and saturation"

    async def analyze(self, image: Image.Image, report: InspectionReport, context: ToolContext) -> dict[str, Any]:
        return {
            "brightness": report.brightness_score,
            "contrast": report.contrast_score,
            "saturation": report.saturation_score,
            "needs_correction": (
                report.brightness_score < 0.3
                or report.brightness_score > 0.85
                or report.contrast_score < 0.3
                or report.saturation_score < 0.15
                or report.saturation_score > 0.85
            ),
        }

    async def should_run(self, report: InspectionReport, context: ToolContext) -> bool:
        if not context.settings.get("automatic_color_correction", True):
            return False
        return (
            report.brightness_score < 0.3
            or report.brightness_score > 0.85
            or report.contrast_score < 0.3
            or report.saturation_score < 0.15
            or report.saturation_score > 0.85
        )

    async def process(self, image: Image.Image, context: ToolContext) -> ToolResult:
        try:
            from PIL import ImageStat
            result = image.copy()

            stat = ImageStat.Stat(result.convert("L"))
            mean_brightness = stat.mean[0] / 255.0

            if mean_brightness < 0.3:
                factor = 1.0 + (0.5 - mean_brightness) * 0.8
                enhancer = ImageEnhance.Brightness(result)
                result = enhancer.enhance(min(factor, 1.4))
            elif mean_brightness > 0.85:
                factor = 1.0 - (mean_brightness - 0.7) * 0.6
                enhancer = ImageEnhance.Brightness(result)
                result = enhancer.enhance(max(factor, 0.7))

            stat = ImageStat.Stat(result.convert("L"))
            std_dev = stat.stddev[0]
            if std_dev < 40:
                factor = 1.0 + (50 - std_dev) / 100.0
                enhancer = ImageEnhance.Contrast(result)
                result = enhancer.enhance(min(factor, 1.3))

            hsv = result.convert("HSV")
            import numpy as np
            arr = np.array(hsv, dtype=np.float32)
            mean_sat = np.mean(arr[:, :, 1]) / 255.0

            if mean_sat < 0.15:
                enhancer = ImageEnhance.Color(result)
                result = enhancer.enhance(1.2)
            elif mean_sat > 0.85:
                enhancer = ImageEnhance.Color(result)
                result = enhancer.enhance(0.85)

            buf = io.BytesIO()
            result.save(buf, format="PNG", optimize=True)
            result_bytes = buf.getvalue()

            return ToolResult(
                success=True,
                image_bytes=result_bytes,
                image=result,
                tool_id=self.tool_id,
                message="Color optimized — exposure, contrast, and saturation balanced",
            )
        except Exception as exc:
            log.warning(f"Color optimization failed: {exc}")
            return ToolResult(
                success=False,
                image=image,
                tool_id=self.tool_id,
                message=f"Color optimization failed: {exc}",
            )
