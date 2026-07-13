from .base import VisualTool, ToolContext, ToolResult
from .registry import (
    register_tool,
    get_tool,
    list_tools,
    available_tool_ids,
    run_tool,
    run_tools_sequential,
    run_tools_parallel,
)
from .anime_upscale import AnimeUpscaleTool
from .smart_crop import SmartCropTool
from .background_remove import BackgroundRemoveTool
from .color_optimize import ColorOptimizeTool
from .navigation_optimize import NavigationOptimizeTool
from .sharpen import SharpenTool
from .compress import CompressTool
from .duplicate_detect import DuplicateDetectTool
from .thumbnail_create import ThumbnailCreateTool
from .format_convert import FormatConvertTool

_tools_initialized = False


def initialize_tools() -> None:
    global _tools_initialized
    if _tools_initialized:
        return
    register_tool(AnimeUpscaleTool())
    register_tool(SmartCropTool())
    register_tool(BackgroundRemoveTool())
    register_tool(ColorOptimizeTool())
    register_tool(NavigationOptimizeTool())
    register_tool(SharpenTool())
    register_tool(CompressTool())
    register_tool(DuplicateDetectTool())
    register_tool(ThumbnailCreateTool())
    register_tool(FormatConvertTool())
    _tools_initialized = True


__all__ = [
    "VisualTool",
    "ToolContext",
    "ToolResult",
    "register_tool",
    "get_tool",
    "list_tools",
    "available_tool_ids",
    "run_tool",
    "run_tools_sequential",
    "run_tools_parallel",
    "AnimeUpscaleTool",
    "SmartCropTool",
    "BackgroundRemoveTool",
    "ColorOptimizeTool",
    "NavigationOptimizeTool",
    "SharpenTool",
    "CompressTool",
    "DuplicateDetectTool",
    "ThumbnailCreateTool",
    "FormatConvertTool",
    "initialize_tools",
]
