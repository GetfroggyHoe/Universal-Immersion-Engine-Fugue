from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException, BackgroundTasks

from ..orchestration.coordinator import get_coordinator
from ..schemas.requests import (
    VisualGenerateRequest,
    VisualRegenerateRequest,
    JobRetryRequest,
    ProviderTestRequest,
    NvidiaTestRequest,
    PromptTemplateUpdate,
    PromptPreviewRequest,
    ModelInstallRequest,
    PipelineSettingsUpdate,
)
from ..schemas.responses import (
    VisualJobResponse,
    VisualJobStatusResponse,
    VisualStatusResponse,
    MediaRecordResponse,
    InspectionReportResponse,
    ProviderInfoResponse,
    ProviderTestResponse,
    ModelStatusResponse,
    PromptTemplateResponse,
    PromptPreviewResponse,
    PipelineSettingsResponse,
)
from ..schemas.types import Priority
from ..jobs.queue import get_job_queue
from ..storage.media_store import get_media_store
from ..prompts.builder import get_prompt_builder
from ..providers.router import list_providers, get_provider, ensure_provider_router
from ..tools import list_tools, initialize_tools
from ..inspection.inspector import get_inspector

log = logging.getLogger("visuals.api.routes")

router = APIRouter(prefix="/visuals", tags=["visuals"])


@router.on_event("startup")
async def startup() -> None:
    initialize_tools()
    ensure_provider_router()
    coordinator = get_coordinator()
    queue = get_job_queue()
    queue.start()
    log.info("Visual processing pipeline initialized")


@router.post("/generate", response_model=VisualJobResponse)
async def generate_visual(request: VisualGenerateRequest, background_tasks: BackgroundTasks) -> VisualJobResponse:
    coordinator = get_coordinator()
    result = await coordinator.submit(
        entity_type=request.entity_type,
        entity_id=request.entity_id,
        visual_type=request.visual_type,
        provider=request.provider,
        style_preset=request.style_preset,
        prompt_override=request.prompt_override,
        negative_prompt_override=request.negative_prompt_override,
        force=request.force,
        priority=Priority(request.priority) if isinstance(request.priority, str) else request.priority,
        entity_data=request.metadata,
        metadata=request.metadata,
    )
    return VisualJobResponse(**result)


@router.post("/regenerate", response_model=VisualJobResponse)
async def regenerate_visual(request: VisualRegenerateRequest, background_tasks: BackgroundTasks) -> VisualJobResponse:
    coordinator = get_coordinator()
    result = await coordinator.submit(
        entity_type=request.entity_type,
        entity_id=request.entity_id,
        visual_type=request.visual_type,
        provider=request.provider,
        style_preset=request.style_preset,
        prompt_override=request.prompt_override,
        negative_prompt_override=request.negative_prompt_override,
        force=True,
        priority=Priority(request.priority) if isinstance(request.priority, str) else request.priority,
        entity_data=request.metadata,
        metadata=request.metadata,
    )
    return VisualJobResponse(**result)


@router.post("/jobs/{job_id}/retry")
async def retry_job(job_id: str, request: JobRetryRequest | None = None) -> dict[str, Any]:
    coordinator = get_coordinator()
    force_new = request.force_new_generation if request else False
    result = await coordinator.retry_job(job_id, force_new_generation=force_new)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return result


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str) -> dict[str, str]:
    coordinator = get_coordinator()
    success = await coordinator.cancel_job(job_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found or already completed")
    return {"status": "cancelled", "job_id": job_id}


@router.get("/jobs/{job_id}", response_model=VisualJobStatusResponse)
async def get_job_status(job_id: str) -> VisualJobStatusResponse:
    queue = get_job_queue()
    job = queue.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return VisualJobStatusResponse(
        job_id=job.job_id,
        status=job.status.value,
        progress=job.progress,
        current_stage=job.current_stage,
        message=job.message,
        error=job.error,
        visual_key=job.visual_key,
        media_id=job.media_id or None,
        eta_seconds=job.eta_seconds,
    )


@router.get("/status/{visual_key}", response_model=VisualStatusResponse)
async def get_visual_status(visual_key: str) -> VisualStatusResponse:
    store = get_media_store()
    record = store.get_record_by_visual_key(visual_key)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Visual {visual_key} not found")
    return VisualStatusResponse(
        visual_key=record.visual_key,
        image_status=record.status,
        image_url=store.path_to_url(record.original_path) if record.original_path else None,
        image_path=record.original_path,
        thumbnail_url=store.path_to_url(record.thumbnail_path) if record.thumbnail_path else None,
        display_url=store.path_to_url(record.display_path) if record.display_path else None,
        master_url=store.path_to_url(record.master_path) if record.master_path else None,
        image_provider=record.provider,
        image_prompt=record.prompt,
        image_style_preset="",
        image_last_generated_at=record.updated_at,
        image_error=None,
        image_is_user_uploaded=False,
        image_is_protected=False,
        tools_applied=record.tools_applied,
        inspection_report=record.inspection_report,
    )


@router.get("/entity/{entity_type}/{entity_id}")
async def get_entity_visuals(entity_type: str, entity_id: str) -> dict[str, Any]:
    store = get_media_store()
    queue = get_job_queue()
    results: list[dict[str, Any]] = []
    for record_dict in [r.to_dict() for r in store._records.values()]:
        if record_dict["entity_type"] == entity_type and record_dict["entity_id"] == entity_id:
            results.append(record_dict)
    return {"entity_type": entity_type, "entity_id": entity_id, "visuals": results}


@router.delete("/media/{media_id}")
async def delete_media(media_id: str) -> dict[str, str]:
    store = get_media_store()
    success = store.delete_media(media_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Media {media_id} not found")
    return {"status": "deleted", "media_id": media_id}


@router.get("/models")
async def list_models() -> list[dict[str, Any]]:
    models = [
        {
            "model_id": "koji",
            "name": "Koji v2.1 (Anime Game Art)",
            "type": "diffusion",
            "installed": False,
            "status": "unknown",
        },
        {
            "model_id": "anime_upscaler",
            "name": "RealESRGAN Anime x4",
            "type": "upscaler",
            "installed": False,
            "status": "unknown",
        },
    ]
    try:
        from python.visuals.download_koji import check_koji_available
        models[0]["installed"] = check_koji_available()
        models[0]["status"] = "installed" if models[0]["installed"] else "not_installed"
    except Exception:
        pass
    try:
        from python.visuals.download_upscaler import check_upscaler_available
        models[1]["installed"] = check_upscaler_available()
        models[1]["status"] = "installed" if models[1]["installed"] else "not_installed"
    except Exception:
        pass
    return models


@router.get("/models/status")
async def get_models_status() -> dict[str, Any]:
    result: dict[str, Any] = {}
    try:
        from python.visuals.download_koji import get_model_status, get_download_state
        result["koji"] = {
            "status": get_model_status(),
            "download": get_download_state(),
        }
    except Exception as exc:
        result["koji"] = {"error": str(exc)}
    try:
        from python.visuals.download_upscaler import get_upscaler_status, get_upscaler_dir
        result["upscaler"] = {
            "status": get_upscaler_status(),
            "path": str(get_upscaler_dir()),
        }
    except Exception as exc:
        result["upscaler"] = {"error": str(exc)}
    return result


@router.post("/models/{model_id}/install")
async def install_model(model_id: str, request: ModelInstallRequest | None = None) -> dict[str, str]:
    if model_id == "koji":
        from python.visuals.download_koji import download_koji_async
        download_koji_async()
        return {"status": "downloading", "model_id": model_id}
    if model_id == "anime_upscaler":
        from python.visuals.download_upscaler import download_upscaler_async
        download_upscaler_async()
        return {"status": "downloading", "model_id": model_id}
    raise HTTPException(status_code=404, detail=f"Unknown model: {model_id}")


@router.post("/models/{model_id}/repair")
async def repair_model(model_id: str) -> dict[str, str]:
    if model_id == "anime_upscaler":
        from python.visuals.download_upscaler import repair_upscaler
        repair_upscaler()
        return {"status": "repaired", "model_id": model_id}
    raise HTTPException(status_code=404, detail=f"Repair not supported for: {model_id}")


@router.delete("/models/{model_id}")
async def delete_model(model_id: str) -> dict[str, str]:
    if model_id == "anime_upscaler":
        from python.visuals.download_upscaler import delete_upscaler
        delete_upscaler()
        return {"status": "deleted", "model_id": model_id}
    raise HTTPException(status_code=404, detail=f"Delete not supported for: {model_id}")


@router.get("/providers")
async def get_providers() -> list[dict[str, Any]]:
    ensure_provider_router()
    return list_providers()


@router.post("/providers/test", response_model=ProviderTestResponse)
async def test_provider(request: ProviderTestRequest) -> ProviderTestResponse:
    from ..providers.custom_http_provider import CustomHttpProvider
    provider = CustomHttpProvider(
        base_url=request.base_url,
        api_key=request.api_key,
        model=request.model,
        headers=request.headers,
    )
    result = await provider.test_connection()
    return ProviderTestResponse(
        success=result["success"],
        message=result["message"],
        latency_ms=result.get("latency_ms", 0),
    )


@router.post("/providers/nvidia/test", response_model=ProviderTestResponse)
async def test_nvidia_provider(request: NvidiaTestRequest) -> ProviderTestResponse:
    return ProviderTestResponse(
        success=True,
        message="NVIDIA NIM provider test placeholder",
        latency_ms=0,
    )


@router.get("/prompts/templates")
async def get_prompt_templates() -> dict[str, Any]:
    builder = get_prompt_builder()
    return builder.get_all_templates()


@router.put("/prompts/templates/{visual_type}")
async def update_prompt_template(visual_type: str, request: PromptTemplateUpdate) -> dict[str, str]:
    builder = get_prompt_builder()
    builder.set_custom_template(visual_type, request.template)
    if request.negative_prompt:
        builder.set_custom_negative(visual_type, request.negative_prompt)
    return {"status": "updated", "visual_type": visual_type}


@router.post("/prompts/preview", response_model=PromptPreviewResponse)
async def preview_prompt(request: PromptPreviewRequest) -> PromptPreviewResponse:
    builder = get_prompt_builder()
    result = builder.preview_prompt(
        visual_type=request.visual_type,
        entity_data=request.entity_data,
        style_preset=request.style_preset,
        provider=request.provider,
    )
    return PromptPreviewResponse(**result)


@router.get("/tools")
async def get_tools() -> list[dict[str, str]]:
    initialize_tools()
    return list_tools()


@router.get("/settings", response_model=PipelineSettingsResponse)
async def get_settings() -> PipelineSettingsResponse:
    coordinator = get_coordinator()
    s = coordinator.settings
    return PipelineSettingsResponse(
        visual_backend_mode=s.get("visual_backend_mode", "built_in_backend"),
        default_provider=s.get("default_provider", "koji"),
        automatic_quality_control=s.get("automatic_quality_control", True),
        automatic_upscaling=s.get("automatic_upscaling", True),
        automatic_background_removal=s.get("automatic_background_removal", True),
        automatic_color_correction=s.get("automatic_color_correction", True),
        automatic_navigation_processing=s.get("automatic_navigation_processing", True),
        maximum_repair_passes=s.get("maximum_repair_passes", 2),
        maximum_regeneration_attempts=s.get("maximum_regeneration_attempts", 1),
        android_worker_count=s.get("android_worker_count", 1),
        windows_worker_count=s.get("windows_worker_count", 2),
        upscaling_mode=s.get("upscaling_mode", "off"),
    )


@router.put("/settings", response_model=PipelineSettingsResponse)
async def update_settings(request: PipelineSettingsUpdate) -> PipelineSettingsResponse:
    coordinator = get_coordinator()
    updates = request.model_dump(exclude_none=True)
    coordinator.update_settings(updates)
    return await get_settings()


@router.get("/queue")
async def get_queue_status() -> dict[str, Any]:
    queue = get_job_queue()
    return {
        "queued": queue.list_queued(),
        "in_flight": queue.list_in_flight(),
        "queue_size": queue.queue_size,
        "in_flight_count": queue.in_flight_count,
    }


@router.post("/queue/pause")
async def pause_queue() -> dict[str, str]:
    get_job_queue().pause()
    return {"status": "paused"}


@router.post("/queue/resume")
async def resume_queue() -> dict[str, str]:
    get_job_queue().resume()
    return {"status": "resumed"}


@router.post("/queue/retry/{job_id}")
async def retry_queue_job(job_id: str) -> dict[str, Any]:
    queue = get_job_queue()
    success = queue.retry_job(job_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Job {job_id} cannot be retried")
    return {"status": "requeued", "job_id": job_id}


@router.get("/workers")
async def get_worker_status() -> dict[str, Any]:
    coordinator = get_coordinator()
    return coordinator.get_worker_status()


@router.get("/workers/health")
async def get_health_status() -> dict[str, Any]:
    from ..workers.health_monitor import get_health_monitor
    monitor = get_health_monitor()
    return monitor.get_summary()


@router.post("/workers/generation/load")
async def load_generation_model() -> dict[str, Any]:
    from ..workers.generation_worker import get_generation_worker
    worker = get_generation_worker()
    success = worker.load_model()
    return {"loaded": success, "stats": worker.stats}


@router.post("/workers/generation/unload")
async def unload_generation_model() -> dict[str, str]:
    from ..workers.generation_worker import get_generation_worker
    get_generation_worker().unload()
    return {"status": "unloaded"}


@router.get("/notifications/recent")
async def get_recent_notifications(limit: int = 50) -> list[dict[str, Any]]:
    from ..workers.notification_service import get_notification_service
    return get_notification_service().get_recent_events(limit)
