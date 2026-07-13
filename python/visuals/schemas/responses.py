from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class VisualJobResponse(BaseModel):
    job_id: str
    visual_key: str
    status: str
    media_id: str | None = None


class VisualJobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: int = 0
    current_stage: str = ""
    message: str = ""
    error: str | None = None
    visual_key: str = ""
    media_id: str | None = None
    eta_seconds: float | None = None


class VisualStatusResponse(BaseModel):
    visual_key: str
    image_status: str
    image_url: str | None = None
    image_path: str | None = None
    thumbnail_url: str | None = None
    display_url: str | None = None
    master_url: str | None = None
    image_provider: str | None = None
    image_prompt: str | None = None
    image_style_preset: str | None = None
    image_last_generated_at: str | None = None
    image_error: str | None = None
    image_is_user_uploaded: bool = False
    image_is_protected: bool = False
    tools_applied: list[str] = Field(default_factory=list)
    inspection_report: dict[str, Any] = Field(default_factory=dict)


class MediaRecordResponse(BaseModel):
    media_id: str
    entity_type: str
    entity_id: str
    visual_type: str
    visual_key: str
    status: str
    provider: str
    model: str = ""
    prompt: str = ""
    negative_prompt: str = ""
    original_url: str | None = None
    master_url: str | None = None
    display_url: str | None = None
    thumbnail_url: str | None = None
    transparent_url: str | None = None
    wide_crop_url: str | None = None
    inspection_report: dict[str, Any] = Field(default_factory=dict)
    tools_applied: list[str] = Field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""


class InspectionReportResponse(BaseModel):
    valid: bool
    blur_score: float = 0.0
    brightness_score: float = 0.0
    contrast_score: float = 0.0
    saturation_score: float = 0.0
    face_detected: bool = False
    face_count: int = 0
    subject_centered: bool = False
    text_detected: bool = False
    watermark_detected: bool = False
    crop_safe: bool = True
    background_complexity: float = 0.0
    resolution: tuple[int, int] = (0, 0)
    aspect_ratio: float = 0.0
    is_blank: bool = False
    is_corrupt: bool = False
    is_duplicate: bool = False
    duplicate_of: str | None = None
    composition_score: float = 0.0
    recommended_actions: list[str] = Field(default_factory=list)
    image_category: str = ""


class ProviderInfoResponse(BaseModel):
    provider_id: str
    name: str
    available: bool
    capabilities: dict[str, Any] = Field(default_factory=dict)
    models: list[str] = Field(default_factory=list)


class ProviderTestResponse(BaseModel):
    success: bool
    message: str = ""
    latency_ms: float = 0.0
    sample_image_url: str | None = None


class ModelStatusResponse(BaseModel):
    model_id: str
    name: str
    installed: bool
    status: str
    path: str | None = None
    size_mb: float = 0.0
    download_progress: float = 0.0
    error: str | None = None


class PromptTemplateResponse(BaseModel):
    visual_type: str
    template: str
    negative_prompt: str = ""
    is_custom: bool = False


class PromptPreviewResponse(BaseModel):
    prompt: str
    negative_prompt: str
    visual_type: str
    style_preset: str
    provider: str


class PipelineSettingsResponse(BaseModel):
    visual_backend_mode: str
    default_provider: str
    automatic_quality_control: bool
    automatic_upscaling: bool
    automatic_background_removal: bool
    automatic_color_correction: bool
    automatic_navigation_processing: bool
    maximum_repair_passes: int
    maximum_regeneration_attempts: int
    android_worker_count: int
    windows_worker_count: int
    upscaling_mode: str


class WSEventPayload(BaseModel):
    event: str
    job_id: str = ""
    status: str = ""
    progress: int = 0
    stage: str = ""
    message: str = ""
    media_id: str | None = None
    display_url: str | None = None
    thumbnail_url: str | None = None
    error: str | None = None
    visual_key: str = ""
    entity_type: str = ""
    entity_id: str = ""
    ts: str = ""
