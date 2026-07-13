from __future__ import annotations

import abc
import logging
from dataclasses import dataclass, field
from typing import Any

from PIL import Image

from ..inspection.inspector import InspectionReport

log = logging.getLogger("visuals.tools")


@dataclass
class ToolContext:
    visual_type: str = ""
    entity_type: str = ""
    entity_id: str = ""
    visual_key: str = ""
    settings: dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolResult:
    success: bool
    image_bytes: bytes = b""
    image: Image.Image | None = None
    tool_id: str = ""
    message: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


class VisualTool(abc.ABC):

    @property
    @abc.abstractmethod
    def tool_id(self) -> str:
        ...

    @property
    @abc.abstractmethod
    def name(self) -> str:
        ...

    @property
    @abc.abstractmethod
    def description(self) -> str:
        ...

    @abc.abstractmethod
    async def analyze(self, image: Image.Image, report: InspectionReport, context: ToolContext) -> dict[str, Any]:
        ...

    @abc.abstractmethod
    async def should_run(self, report: InspectionReport, context: ToolContext) -> bool:
        ...

    @abc.abstractmethod
    async def process(self, image: Image.Image, context: ToolContext) -> ToolResult:
        ...

    async def validate(self, image: Image.Image, original: Image.Image) -> bool:
        return image.size[0] >= original.size[0] * 0.5

    async def run(self, image: Image.Image, report: InspectionReport, context: ToolContext) -> ToolResult:
        try:
            if not await self.should_run(report, context):
                return ToolResult(
                    success=True,
                    image_bytes=b"",
                    image=image,
                    tool_id=self.tool_id,
                    message="Skipped — not needed",
                )
            analysis = await self.analyze(image, report, context)
            result = await self.process(image, context)
            if result.success and result.image:
                is_valid = await self.validate(result.image, image)
                if not is_valid:
                    return ToolResult(
                        success=False,
                        image=image,
                        tool_id=self.tool_id,
                        message="Validation failed — output worse than input",
                    )
            return result
        except Exception as exc:
            log.warning(f"Tool {self.tool_id} failed: {exc}")
            return ToolResult(
                success=False,
                image=image,
                tool_id=self.tool_id,
                message=f"Tool failed: {exc}",
            )
