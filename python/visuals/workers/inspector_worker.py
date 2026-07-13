from __future__ import annotations

import asyncio
import logging
from typing import Any

from ..inspection.inspector import InspectionReport, get_inspector

log = logging.getLogger("visuals.workers.inspector")


class InspectorWorker:
    _instance: InspectorWorker | None = None

    def __init__(self) -> None:
        self._inspector = get_inspector()
        self._jobs_processeded = 0
        self._total_inspection_time = 0.0
        self._errors = 0

    @property
    def stats(self) -> dict[str, Any]:
        avg = (
            self._total_inspection_time / self._jobs_processeded
            if self._jobs_processeded > 0
            else 0.0
        )
        return {
            "jobs_processeded": self._jobs_processeded,
            "avg_inspection_time": round(avg, 3),
            "errors": self._errors,
        }

    async def inspect(
        self,
        image_bytes: bytes,
        visual_type: str = "",
        target_usage: str = "",
    ) -> InspectionReport:
        import time
        t0 = time.perf_counter()

        try:
            report = await self._inspector.inspect(
                image_bytes=image_bytes,
                visual_type=visual_type,
                target_usage=target_usage,
            )
            elapsed = time.perf_counter() - t0
            self._jobs_processeded += 1
            self._total_inspection_time += elapsed
            return report
        except Exception as exc:
            self._errors += 1
            log.error(f"Inspection failed: {exc}")
            raise

    def register_hash(self, visual_key: str, phash: str) -> None:
        self._inspector.register_hash(visual_key, phash)

    def health_check(self) -> dict[str, Any]:
        return {
            "healthy": True,
            "jobs_processeded": self._jobs_processeded,
            "errors": self._errors,
        }


def get_inspector_worker() -> InspectorWorker:
    if InspectorWorker._instance is None:
        InspectorWorker._instance = InspectorWorker()
    return InspectorWorker._instance
