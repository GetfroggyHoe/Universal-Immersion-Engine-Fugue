from __future__ import annotations

import logging
import threading
from typing import Any

from .base import VisualTool, ToolContext, ToolResult
from ..inspection.inspector import InspectionReport

log = logging.getLogger("visuals.tools.registry")

_registry: dict[str, VisualTool] = {}
_lock = threading.Lock()


def register_tool(tool: VisualTool) -> None:
    with _lock:
        _registry[tool.tool_id] = tool
        log.info(f"Registered tool: {tool.tool_id} -> {tool.name}")


def get_tool(tool_id: str) -> VisualTool | None:
    return _registry.get(tool_id)


def list_tools() -> list[dict[str, str]]:
    return [
        {"tool_id": t.tool_id, "name": t.name, "description": t.description}
        for t in _registry.values()
    ]


def available_tool_ids() -> list[str]:
    return list(_registry.keys())


async def run_tool(
    tool_id: str,
    image,
    report: InspectionReport,
    context: ToolContext,
) -> ToolResult:
    tool = get_tool(tool_id)
    if tool is None:
        return ToolResult(
            success=False,
            image=image,
            tool_id=tool_id,
            message=f"Unknown tool: {tool_id}",
        )
    return await tool.run(image, report, context)


async def run_tools_sequential(
    tool_ids: list[str],
    image,
    report: InspectionReport,
    context: ToolContext,
) -> tuple[Any, list[ToolResult]]:
    results: list[ToolResult] = []
    current_image = image
    for tid in tool_ids:
        result = await run_tool(tid, current_image, report, context)
        results.append(result)
        if result.success and result.image is not None:
            current_image = result.image
    return current_image, results


async def run_tools_parallel(
    tool_ids: list[str],
    image,
    report: InspectionReport,
    context: ToolContext,
) -> list[ToolResult]:
    import asyncio
    tasks = [run_tool(tid, image, report, context) for tid in tool_ids]
    return await asyncio.gather(*tasks)
