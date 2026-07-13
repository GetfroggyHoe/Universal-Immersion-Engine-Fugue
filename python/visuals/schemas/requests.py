from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from .types import Priority


class VisualGenerateRequest(BaseModel):
    entity_type: str
    entity_id: str
    visual_type: str = ""
    provider: str = "auto"
    style_preset: str = "anime_game_art"
    prompt_override: str | None = None
    negative_prompt_override: str | None = None
    force: bool = False
    priority: Priority = Priority.NORMAL
    metadata: dict[str, Any] = Field(default_factory=dict)


class VisualRegenerateRequest(BaseModel):
    visual_key: str
    entity_type: str
    entity_id: str
    visual_type: str = ""
    provider: str = "auto"
    style_preset: str = "anime_game_art"
    prompt_override: str | None = None
    negative_prompt_override: str | None = None
    priority: Priority = Priority.NORMAL
    metadata: dict[str, Any] = Field(default_factory=dict)


class JobRetryRequest(BaseModel):
    force_new_generation: bool = False


class ProviderTestRequest(BaseModel):
    provider: str
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    headers: dict[str, str] = Field(default_factory=dict)


class NvidiaTestRequest(BaseModel):
    api_key: str
    model: str = "nvidia/sdxl-turbo"
    base_url: str = "https://ai.api.nvidia.com/v1"


class PromptTemplateUpdate(BaseModel):
    visual_type: str
    template: str
    negative_prompt: str = ""


class PromptPreviewRequest(BaseModel):
    visual_type: str
    entity_data: dict[str, Any] = Field(default_factory=dict)
    style_preset: str = "anime_game_art"
    provider: str = "koji"


class ModelInstallRequest(BaseModel):
    model_id: str
    force: bool = False


class PipelineSettingsUpdate(BaseModel):
    visual_backend_mode: str | None = None
    default_provider: str | None = None
    automatic_quality_control: bool | None = None
    automatic_upscaling: bool | None = None
    automatic_background_removal: bool | None = None
    automatic_color_correction: bool | None = None
    automatic_navigation_processing: bool | None = None
    maximum_repair_passes: int | None = None
    maximum_regeneration_attempts: int | None = None
    android_worker_count: int | None = None
    windows_worker_count: int | None = None
    upscaling_mode: str | None = None
