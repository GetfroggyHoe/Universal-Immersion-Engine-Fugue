from __future__ import annotations

import asyncio
import logging
from typing import Any

from ..schemas.types import ToolID
from ..storage.media_store import MediaRecord, MediaStore, get_media_store

log = logging.getLogger("visuals.workers.storage")


class StorageWorker:
    _instance: StorageWorker | None = None

    def __init__(self) -> None:
        self._store = get_media_store()
        self._jobs_processeded = 0
        self._total_save_time = 0.0
        self._errors = 0
        self._save_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._running = False

    @property
    def stats(self) -> dict[str, Any]:
        avg = (
            self._total_save_time / self._jobs_processeded
            if self._jobs_processeded > 0
            else 0.0
        )
        return {
            "jobs_processeded": self._jobs_processeded,
            "avg_save_time": round(avg, 3),
            "errors": self._errors,
            "pending_saves": self._save_queue.qsize(),
        }

    async def save_all(
        self,
        visual_type: str,
        visual_key: str,
        media_id: str,
        original_bytes: bytes,
        master_bytes: bytes,
        tools_applied: list[str],
        inspection_report: dict[str, Any],
        provider: str = "",
        model: str = "",
    ) -> dict[str, str]:
        import time
        t0 = time.perf_counter()

        paths: dict[str, str] = {}

        try:
            original_path = await self._store.save_original(visual_type, visual_key, original_bytes)
            paths["original"] = original_path
        except Exception as exc:
            log.warning(f"Failed to save original: {exc}")
            self._errors += 1

        try:
            master_path = await self._store.save_master(visual_type, visual_key, master_bytes)
            paths["master"] = master_path
        except Exception as exc:
            log.warning(f"Failed to save master: {exc}")
            self._errors += 1

        try:
            display_path = await self._store.save_display(visual_type, visual_key, master_bytes)
            paths["display"] = display_path
        except Exception as exc:
            log.warning(f"Failed to save display: {exc}")
            self._errors += 1

        try:
            thumbnail_path = await self._store.save_thumbnail(visual_type, visual_key, master_bytes)
            paths["thumbnail"] = thumbnail_path
        except Exception as exc:
            log.warning(f"Failed to save thumbnail: {exc}")
            self._errors += 1

        transparent_path = ""
        if ToolID.BACKGROUND_REMOVE.value in tools_applied:
            try:
                transparent_path = await self._store.save_transparent(visual_type, visual_key, master_bytes)
                paths["transparent"] = transparent_path
            except Exception as exc:
                log.warning(f"Failed to save transparent: {exc}")
                self._errors += 1

        try:
            await self._store.save_derivatives(master_bytes, visual_type, visual_key)
        except Exception as exc:
            log.warning(f"Derivative generation failed: {exc}")

        elapsed = time.perf_counter() - t0
        self._jobs_processeded += 1
        self._total_save_time += elapsed

        return paths

    def update_record(
        self,
        media_id: str,
        paths: dict[str, str],
        inspection_report: dict[str, Any],
        tools_applied: list[str],
        provider: str = "",
        model: str = "",
    ) -> None:
        import time
        record = self._store.get_record(media_id)
        if record is None:
            return

        record.status = "complete"
        record.provider = provider
        record.model = model
        record.original_path = paths.get("original", "")
        record.master_path = paths.get("master", "")
        record.display_path = paths.get("display", "")
        record.thumbnail_path = paths.get("thumbnail", "")
        record.transparent_path = paths.get("transparent", "")
        record.inspection_report = inspection_report
        record.tools_applied = tools_applied
        record.updated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        self._store.save_record(record)

    def path_to_url(self, path: str) -> str:
        return self._store.path_to_url(path)

    def health_check(self) -> dict[str, Any]:
        return {
            "healthy": True,
            "jobs_processeded": self._jobs_processeded,
            "errors": self._errors,
        }


def get_storage_worker() -> StorageWorker:
    if StorageWorker._instance is None:
        StorageWorker._instance = StorageWorker()
    return StorageWorker._instance
