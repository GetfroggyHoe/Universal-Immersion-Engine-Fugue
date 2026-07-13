from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from typing import Any

from ..jobs.queue import VisualJob, get_job_queue
from ..orchestration.decision_engine import get_decision_engine
from ..prompts.builder import get_prompt_builder
from ..schemas.types import (
    JobStatus,
    Priority,
    classify_visual_type,
    ENTITY_TYPE_TO_VISUAL_TYPE,
    VISUAL_TYPE_DEFAULT_SIZES,
)
from ..storage.media_store import MediaRecord, get_media_store
from ..tools.base import ToolContext
from ..workers.generation_worker import get_generation_worker
from ..workers.inspector_worker import get_inspector_worker
from ..workers.tool_worker import get_tool_worker
from ..workers.storage_worker import get_storage_worker
from ..workers.notification_service import get_notification_service
from ..workers.health_monitor import get_health_monitor
from ..providers.router import resolve_provider, ensure_provider_router

log = logging.getLogger("visuals.orchestration.coordinator")

MAX_REPAIR_PASSES = 2
MAX_REGENERATION_ATTEMPTS = 1


class VisualCoordinator:

    def __init__(self) -> None:
        self._decision = get_decision_engine()
        self._prompt_builder = get_prompt_builder()
        self._store = get_media_store()
        self._queue = get_job_queue()
        self._notifications = get_notification_service()
        self._health = get_health_monitor()

        self._generation_worker = get_generation_worker()
        self._inspector_worker = get_inspector_worker()
        self._tool_worker = get_tool_worker()
        self._storage_worker = get_storage_worker()

        self._settings: dict[str, Any] = {
            "visual_backend_mode": "built_in_backend",
            "default_provider": "koji",
            "automatic_quality_control": True,
            "automatic_upscaling": True,
            "automatic_background_removal": True,
            "automatic_color_correction": True,
            "automatic_navigation_processing": True,
            "maximum_repair_passes": MAX_REPAIR_PASSES,
            "maximum_regeneration_attempts": MAX_REGENERATION_ATTEMPTS,
        }

        self._health.register_worker("generation", self._generation_worker)
        self._health.register_worker("inspector", self._inspector_worker)
        self._health.register_worker("tool", self._tool_worker)
        self._health.register_worker("storage", self._storage_worker)

        self._queue.set_processor(self._process_job_internal)

    @property
    def settings(self) -> dict[str, Any]:
        return self._settings

    def update_settings(self, updates: dict[str, Any]) -> dict[str, Any]:
        for key, value in updates.items():
            if value is not None and key in self._settings:
                self._settings[key] = value
        return self._settings

    async def submit(
        self,
        entity_type: str,
        entity_id: str,
        visual_type: str = "",
        provider: str = "auto",
        style_preset: str = "anime_game_art",
        prompt_override: str | None = None,
        negative_prompt_override: str | None = None,
        force: bool = False,
        priority: Priority = Priority.NORMAL,
        entity_data: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        entity_data = entity_data or {}
        metadata = metadata or {}

        if not visual_type:
            visual_type = ENTITY_TYPE_TO_VISUAL_TYPE.get(entity_type, entity_type)

        visual_key = self._build_visual_key(entity_type, entity_id, entity_data)

        existing = self._queue.get_job_by_visual_key(visual_key)
        if existing and not force:
            return {
                "job_id": existing.job_id,
                "visual_key": visual_key,
                "status": existing.status.value,
                "media_id": existing.media_id or None,
            }

        existing_media = self._store.get_record_by_visual_key(visual_key)
        if existing_media and not force:
            return {
                "job_id": "",
                "visual_key": visual_key,
                "status": "complete",
                "media_id": existing_media.media_id,
            }

        prompt = self._prompt_builder.build_prompt(
            visual_type=visual_type,
            entity_data=entity_data,
            style_preset=style_preset,
            provider=provider,
            prompt_override=prompt_override,
        )
        negative_prompt = self._prompt_builder.build_negative_prompt(
            visual_type=visual_type,
            provider=provider,
            negative_override=negative_prompt_override,
        )

        media_id = self._store.generate_media_id(visual_key)
        job_id = f"vj_{hashlib.sha256(f'{visual_key}:{time.time()}'.encode()).hexdigest()[:12]}"

        job = VisualJob(
            job_id=job_id,
            visual_key=visual_key,
            entity_type=entity_type,
            entity_id=entity_id,
            visual_type=visual_type,
            prompt=prompt,
            negative_prompt=negative_prompt,
            provider=provider,
            style_preset=style_preset,
            priority=priority,
            media_id=media_id,
            entity_data=entity_data,
            metadata=metadata,
            prompt_override=prompt_override,
            negative_prompt_override=negative_prompt_override,
            force=force,
        )

        record = MediaRecord(
            media_id=media_id,
            entity_type=entity_type,
            entity_id=entity_id,
            visual_type=visual_type,
            visual_key=visual_key,
            status="queued",
            provider=provider,
            prompt=prompt,
            negative_prompt=negative_prompt,
            created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            updated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )
        self._store.save_record(record)

        self._queue.submit(job)

        await self._notifications.emit_job_event(
            "visual_job_queued",
            job_id,
            visual_key,
            {
                "status": "queued",
                "entity_type": entity_type,
                "entity_id": entity_id,
            },
        )

        return {
            "job_id": job_id,
            "visual_key": visual_key,
            "status": "queued",
            "media_id": media_id,
        }

    async def cancel_job(self, job_id: str) -> bool:
        self._generation_worker.cancel_job(job_id)
        return self._queue.cancel(job_id)

    async def retry_job(self, job_id: str, force_new_generation: bool = False) -> dict[str, Any] | None:
        job = self._queue.get_job(job_id)
        if job is None:
            return None

        return await self.submit(
            entity_type=job.entity_type,
            entity_id=job.entity_id,
            visual_type=job.visual_type,
            provider=job.provider,
            style_preset=job.style_preset,
            prompt_override=job.prompt_override if force_new_generation else None,
            negative_prompt_override=job.negative_prompt_override if force_new_generation else None,
            force=True,
            priority=job.priority,
            entity_data=job.entity_data,
            metadata=job.metadata,
        )

    async def _process_job_internal(self, job: VisualJob) -> None:
        try:
            await self._execute_pipeline(job)
        except Exception as exc:
            log.error(f"Pipeline failed for job {job.job_id}: {exc}", exc_info=True)
            self._queue.fail_job(job.job_id, str(exc))
            await self._notifications.emit_job_event(
                "visual_job_failed",
                job.job_id,
                job.visual_key,
                {"error": str(exc)[:400]},
            )

    async def _execute_pipeline(self, job: VisualJob) -> None:
        if self._health.should_pause_background() and job.priority.value in ("low", "background"):
            log.info(f"Pausing background job {job.job_id} due to memory pressure")
            self._queue.update_job(job.job_id, status=JobStatus.QUEUED, message="Paused: memory pressure")
            return

        await self._notifications.emit_job_event(
            "visual_job_generating",
            job.job_id,
            job.visual_key,
            {"status": "generating", "progress": 10},
        )
        self._update_stage(job, JobStatus.GENERATING, 10, "generation", "Generating image")

        ensure_provider_router()
        default_size = VISUAL_TYPE_DEFAULT_SIZES.get(job.visual_type, (512, 512))

        image_bytes, width, height = await self._generation_worker.generate(
            job_id=job.job_id,
            prompt=job.prompt,
            negative_prompt=job.negative_prompt,
            width=default_size[0],
            height=default_size[1],
        )

        original_bytes = image_bytes

        await self._notifications.emit_job_event(
            "visual_job_inspecting",
            job.job_id,
            job.visual_key,
            {"status": "inspecting", "progress": 30},
        )
        self._update_stage(job, JobStatus.INSPECTING, 30, "inspection", "Analyzing image quality")

        inspection = await self._inspector_worker.inspect(
            image_bytes=image_bytes,
            visual_type=job.visual_type,
        )

        self._inspector_worker.register_hash(job.visual_key, inspection.perceptual_hash)

        if inspection.is_corrupt or inspection.is_blank:
            if job.regeneration_attempts < self._settings.get("maximum_regeneration_attempts", MAX_REGENERATION_ATTEMPTS):
                job.regeneration_attempts += 1
                log.info(f"Regenerating image for job {job.job_id} (attempt {job.regeneration_attempts})")
                await self._execute_pipeline(job)
                return
            raise RuntimeError("Image generation produced corrupt/blank result")

        if self._decision.should_regenerate(inspection):
            if job.regeneration_attempts < self._settings.get("maximum_regeneration_attempts", MAX_REGENERATION_ATTEMPTS):
                job.regeneration_attempts += 1
                log.info(f"Regenerating — quality too low for job {job.job_id}")
                await self._execute_pipeline(job)
                return

        await self._notifications.emit_job_event(
            "visual_job_processing",
            job.job_id,
            job.visual_key,
            {"status": "processing", "progress": 40},
        )
        self._update_stage(job, JobStatus.PROCESSING, 40, "processing", "Applying specialist tools")

        tool_actions = self._decision.choose_tools(
            inspection=inspection,
            visual_type=job.visual_type,
            settings=self._settings,
        )

        context = ToolContext(
            visual_type=job.visual_type,
            entity_type=job.entity_type,
            entity_id=job.entity_id,
            visual_key=job.visual_key,
            settings=self._settings,
        )

        from PIL import Image
        import io
        image = Image.open(io.BytesIO(image_bytes))

        def progress_cb(tool_id, idx, total, repair_pass):
            progress = 40 + int((idx / max(total, 1)) * 30)
            self._update_stage(job, JobStatus.PROCESSING, progress, tool_id, f"Running {tool_id}")

        max_passes = self._settings.get("maximum_repair_passes", MAX_REPAIR_PASSES)
        processed_image, processed_bytes, tools_applied = await self._tool_worker.run_tools(
            tool_ids=tool_actions,
            image=image,
            image_bytes=image_bytes,
            inspection=inspection,
            context=context,
            max_repair_passes=max_passes,
            progress_callback=progress_cb,
        )

        await self._notifications.emit_job_event(
            "visual_job_saving",
            job.job_id,
            job.visual_key,
            {"status": "saving", "progress": 85},
        )
        self._update_stage(job, JobStatus.SAVING, 85, "saving", "Saving media assets")

        paths = await self._storage_worker.save_all(
            visual_type=job.visual_type,
            visual_key=job.visual_key,
            media_id=job.media_id,
            original_bytes=original_bytes,
            master_bytes=processed_bytes,
            tools_applied=tools_applied,
            inspection_report=inspection.to_dict(),
            provider="koji",
            model="koji_v2.1",
        )

        self._storage_worker.update_record(
            media_id=job.media_id,
            paths=paths,
            inspection_report=inspection.to_dict(),
            tools_applied=tools_applied,
            provider="koji",
            model="koji_v2.1",
        )

        self._queue.complete_job(job.job_id, media_id=job.media_id)

        display_url = self._storage_worker.path_to_url(paths.get("display", ""))
        thumbnail_url = self._storage_worker.path_to_url(paths.get("thumbnail", ""))

        await self._notifications.emit_job_event(
            "visual_job_complete",
            job.job_id,
            job.visual_key,
            {
                "status": "complete",
                "media_id": job.media_id,
                "display_url": display_url,
                "thumbnail_url": thumbnail_url,
                "entity_type": job.entity_type,
                "entity_id": job.entity_id,
                "tools_applied": tools_applied,
            },
        )

    def _update_stage(
        self,
        job: VisualJob,
        status: JobStatus,
        progress: int,
        stage: str,
        message: str,
    ) -> None:
        self._queue.update_job(
            job.job_id,
            status=status,
            progress=progress,
            stage=stage,
            message=message,
        )

    def _build_visual_key(self, entity_type: str, entity_id: str, entity_data: dict[str, Any]) -> str:
        if entity_type == "npc":
            name = entity_data.get("name", entity_id)
            return f"npc_{hashlib.sha256(name.encode()).hexdigest()[:16]}"
        if entity_type == "skill":
            element = entity_data.get("element", "generic")
            skill_type = entity_data.get("type", "ability")
            name = entity_data.get("name", entity_id)
            slug = "".join(c if c.isalnum() else "_" for c in name.lower())[:20]
            return f"skill_{element}_{skill_type}_{slug}"
        if entity_type in ("location_bg", "nav_background"):
            location_id = entity_data.get("id", entity_id)
            return f"location_bg_{location_id}"
        if entity_type == "faction":
            return f"faction_{entity_data.get('id', entity_id)}"
        if entity_type == "quest":
            return f"quest_{entity_data.get('id', entity_id)}"
        if entity_type in ("item_template", "equipment_template"):
            template_id = entity_data.get("template_id", entity_data.get("id", entity_id))
            return f"{entity_type}_{template_id}"
        if entity_type == "instavibe_profile_pic":
            return f"instavibe_profile_{entity_data.get('character_id', entity_id)}"
        if entity_type == "instavibe_post_image":
            return f"instavibe_post_{entity_data.get('post_id', entity_id)}"
        if entity_type == "message_image_attachment":
            msg_id = entity_data.get("message_id", entity_id)
            att_id = entity_data.get("attachment_id", "0")
            return f"message_img_{msg_id}_{att_id}"
        return f"{entity_type}_{entity_id}"

    def register_ws_callback(self, callback: Any) -> None:
        self._notifications.register_ws_callback(callback)

    def unregister_ws_callback(self, callback: Any) -> None:
        self._notifications.unregister_ws_callback(callback)

    def get_worker_status(self) -> dict[str, Any]:
        return {
            "generation": self._generation_worker.stats,
            "inspector": self._inspector_worker.stats,
            "tool": self._tool_worker.stats,
            "storage": self._storage_worker.stats,
            "health": self._health.get_summary(),
        }


_coordinator: VisualCoordinator | None = None


def get_coordinator() -> VisualCoordinator:
    global _coordinator
    if _coordinator is None:
        _coordinator = VisualCoordinator()
    return _coordinator
