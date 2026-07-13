from __future__ import annotations

import asyncio
import io
import logging
from typing import Any

from PIL import Image

from ..inspection.inspector import InspectionReport
from ..tools.base import ToolContext, ToolResult
from ..tools.registry import run_tool

log = logging.getLogger("visuals.workers.tool")


class ToolWorker:
    _instance: ToolWorker | None = None

    def __init__(self) -> None:
        self._jobs_processeded = 0
        self._tools_applied_total = 0
        self._total_tool_time = 0.0
        self._errors = 0

    @property
    def stats(self) -> dict[str, Any]:
        avg = (
            self._total_tool_time / self._jobs_processeded
            if self._jobs_processeded > 0
            else 0.0
        )
        return {
            "jobs_processeded": self._jobs_processeded,
            "tools_applied_total": self._tools_applied_total,
            "avg_tool_time": round(avg, 3),
            "errors": self._errors,
        }

    async def run_tools(
        self,
        tool_ids: list[str],
        image: Image.Image,
        image_bytes: bytes,
        inspection: InspectionReport,
        context: ToolContext,
        max_repair_passes: int = 2,
        progress_callback: Any = None,
    ) -> tuple[Image.Image, bytes, list[str]]:
        import time
        t0 = time.perf_counter()

        current_image = image
        current_bytes = image_bytes
        tools_applied: list[str] = []
        repair_pass = 0

        while tool_ids and repair_pass < max_repair_passes:
            repair_pass += 1
            total_tools = len(tool_ids)

            for idx, tool_id in enumerate(tool_ids):
                if progress_callback:
                    progress_callback(tool_id, idx, total_tools, repair_pass)

                try:
                    result = await run_tool(tool_id, current_image, inspection, context)
                    if result.success and result.image is not None:
                        current_image = result.image
                        buf = io.BytesIO()
                        current_image.save(buf, format="PNG")
                        current_bytes = buf.getvalue()
                        tools_applied.append(tool_id)
                        self._tools_applied_total += 1
                except Exception as exc:
                    log.warning(f"Tool {tool_id} failed: {exc}")
                    self._errors += 1

            if repair_pass < max_repair_passes:
                from ..workers.inspector_worker import get_inspector_worker
                inspector_worker = get_inspector_worker()
                re_inspection = await inspector_worker.inspect(
                    image_bytes=current_bytes,
                    visual_type=context.visual_type,
                )
                from ..orchestration.decision_engine import get_decision_engine
                decision = get_decision_engine()
                if decision.should_repair(re_inspection):
                    inspection = re_inspection
                    tool_ids = [t for t in tool_ids if t not in tools_applied]
                else:
                    break

        elapsed = time.perf_counter() - t0
        self._jobs_processeded += 1
        self._total_tool_time += elapsed

        return current_image, current_bytes, tools_applied

    def health_check(self) -> dict[str, Any]:
        return {
            "healthy": True,
            "jobs_processeded": self._jobs_processeded,
            "tools_applied_total": self._tools_applied_total,
            "errors": self._errors,
        }


def get_tool_worker() -> ToolWorker:
    if ToolWorker._instance is None:
        ToolWorker._instance = ToolWorker()
    return ToolWorker._instance
