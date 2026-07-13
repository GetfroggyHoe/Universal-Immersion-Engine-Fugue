from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import platform
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Awaitable

from ..schemas.types import JobStatus, Priority, PRIORITY_VALUES

log = logging.getLogger("visuals.jobs.queue")


@dataclass
class VisualJob:
    job_id: str
    visual_key: str
    entity_type: str
    entity_id: str
    visual_type: str
    prompt: str
    negative_prompt: str = ""
    provider: str = "auto"
    style_preset: str = "anime_game_art"
    priority: Priority = Priority.NORMAL
    status: JobStatus = JobStatus.QUEUED
    progress: int = 0
    current_stage: str = ""
    message: str = ""
    error: str | None = None
    media_id: str = ""
    entity_data: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    prompt_override: str | None = None
    negative_prompt_override: str | None = None
    force: bool = False
    created_at: float = 0.0
    updated_at: float = 0.0
    started_at: float = 0.0
    completed_at: float = 0.0
    repair_passes: int = 0
    regeneration_attempts: int = 0
    cancelled: bool = False
    retry_count: int = 0
    max_retries: int = 2

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "visual_key": self.visual_key,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "visual_type": self.visual_type,
            "prompt": self.prompt,
            "negative_prompt": self.negative_prompt,
            "provider": self.provider,
            "style_preset": self.style_preset,
            "priority": self.priority.value,
            "status": self.status.value,
            "progress": self.progress,
            "current_stage": self.current_stage,
            "message": self.message,
            "error": self.error,
            "media_id": self.media_id,
            "entity_data": self.entity_data,
            "metadata": self.metadata,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "repair_passes": self.repair_passes,
            "regeneration_attempts": self.regeneration_attempts,
            "retry_count": self.retry_count,
            "max_retries": self.max_retries,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> VisualJob:
        data = dict(data)
        data["priority"] = Priority(data.get("priority", "normal"))
        data["status"] = JobStatus(data.get("status", "queued"))
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})

    @property
    def priority_value(self) -> int:
        return PRIORITY_VALUES.get(self.priority.value, 3)

    @property
    def eta_seconds(self) -> float | None:
        if self.status not in (JobStatus.GENERATING, JobStatus.PROCESSING, JobStatus.INSPECTING):
            return None
        if not self.started_at or self.progress <= 0:
            return None
        elapsed = time.time() - self.started_at
        if elapsed <= 0:
            return None
        rate = self.progress / elapsed
        remaining = max(0, (100 - self.progress) / max(rate, 0.001))
        return round(remaining, 1)


def _get_queue_persist_path() -> Path:
    env_dir = os.environ.get("VISUAL_DATA_DIR", "")
    if env_dir:
        base = Path(env_dir)
    else:
        base = Path(__file__).resolve().parents[3] / "data"
    base.mkdir(parents=True, exist_ok=True)
    return base / "visual_job_queue.json"


class JobQueue:

    def __init__(self, max_workers: int | None = None, persist_path: Path | None = None) -> None:
        if max_workers is None:
            max_workers = self._default_worker_count()
        self._max_workers = max_workers
        self._queue: list[VisualJob] = []
        self._in_flight: dict[str, VisualJob] = {}
        self._completed: dict[str, VisualJob] = {}
        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._paused = False
        self._running = False
        self._workers: list[threading.Thread] = []
        self._processor: Callable[[VisualJob], Awaitable[None]] | None = None
        self._progress_callbacks: list[Callable[[VisualJob], None]] = []
        self._persist_path = persist_path or _get_queue_persist_path()
        self._recover_from_disk()

    @staticmethod
    def _default_worker_count() -> int:
        is_android = platform.system() == "Linux" and os.environ.get("ANDROID_ROOT")
        if is_android:
            return 1
        return min(2, os.cpu_count() or 1)

    def _recover_from_disk(self) -> None:
        try:
            if not self._persist_path.exists():
                return
            data = json.loads(self._persist_path.read_text(encoding="utf-8"))
            recovered = 0
            for item in data.get("queued", []):
                try:
                    job = VisualJob.from_dict(item)
                    job.status = JobStatus.QUEUED
                    job.progress = 0
                    job.current_stage = ""
                    job.message = ""
                    self._queue.append(job)
                    recovered += 1
                except Exception as exc:
                    log.warning(f"Failed to recover job: {exc}")
            for item in data.get("in_flight", []):
                try:
                    job = VisualJob.from_dict(item)
                    if job.retry_count < job.max_retries:
                        job.status = JobStatus.QUEUED
                        job.progress = 0
                        job.current_stage = ""
                        job.message = ""
                        job.retry_count += 1
                        self._queue.append(job)
                        recovered += 1
                    else:
                        job.status = JobStatus.FAILED
                        job.error = "Lost after restart"
                        self._completed[job.job_id] = job
                except Exception as exc:
                    log.warning(f"Failed to recover in-flight job: {exc}")
            self._queue.sort(key=lambda j: j.priority_value)
            if recovered > 0:
                log.info(f"Recovered {recovered} jobs from disk")
        except Exception as exc:
            log.warning(f"Queue recovery failed: {exc}")

    def _persist_to_disk(self) -> None:
        try:
            data = {
                "queued": [j.to_dict() for j in self._queue],
                "in_flight": [j.to_dict() for j in self._in_flight.values()],
            }
            self._persist_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except Exception as exc:
            log.warning(f"Queue persist failed: {exc}")

    def set_processor(self, processor: Callable[[VisualJob], Awaitable[None]]) -> None:
        self._processor = processor

    def on_progress(self, callback: Callable[[VisualJob], None]) -> None:
        self._progress_callbacks.append(callback)

    def _notify_progress(self, job: VisualJob) -> None:
        for cb in self._progress_callbacks:
            try:
                cb(job)
            except Exception as exc:
                log.warning(f"Progress callback failed: {exc}")

    def submit(self, job: VisualJob) -> bool:
        with self._lock:
            for existing in self._queue:
                if existing.visual_key == job.visual_key and not existing.cancelled:
                    return False
            for existing in self._in_flight.values():
                if existing.visual_key == job.visual_key:
                    return False
            job.created_at = time.time()
            job.updated_at = time.time()
            self._queue.append(job)
            self._queue.sort(key=lambda j: j.priority_value)
            self._condition.notify()
            self._persist_to_disk()
            return True

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            for job in self._queue:
                if job.job_id == job_id:
                    job.cancelled = True
                    job.status = JobStatus.CANCELLED
                    job.updated_at = time.time()
                    self._queue.remove(job)
                    self._completed[job_id] = job
                    self._notify_progress(job)
                    self._persist_to_disk()
                    return True
            if job_id in self._in_flight:
                self._in_flight[job_id].cancelled = True
                return True
        return False

    def get_job(self, job_id: str) -> VisualJob | None:
        with self._lock:
            if job_id in self._in_flight:
                return self._in_flight[job_id]
            for job in self._queue:
                if job.job_id == job_id:
                    return job
            return self._completed.get(job_id)

    def get_job_by_visual_key(self, visual_key: str) -> VisualJob | None:
        with self._lock:
            for job in self._in_flight.values():
                if job.visual_key == visual_key:
                    return job
            for job in self._queue:
                if job.visual_key == visual_key:
                    return job
            for job in self._completed.values():
                if job.visual_key == visual_key:
                    return job
        return None

    def update_job(
        self,
        job_id: str,
        status: JobStatus | None = None,
        progress: int | None = None,
        stage: str | None = None,
        message: str | None = None,
        error: str | None = None,
        media_id: str | None = None,
    ) -> VisualJob | None:
        with self._lock:
            job = self._in_flight.get(job_id)
            if job is None:
                for j in self._queue:
                    if j.job_id == job_id:
                        job = j
                        break
            if job is None:
                job = self._completed.get(job_id)
            if job is None:
                return None

            if status is not None:
                job.status = status
            if progress is not None:
                job.progress = progress
            if stage is not None:
                job.current_stage = stage
            if message is not None:
                job.message = message
            if error is not None:
                job.error = error
            if media_id is not None:
                job.media_id = media_id
            job.updated_at = time.time()

            if status in (JobStatus.COMPLETE, JobStatus.COMPLETED_WITH_WARNING, JobStatus.FAILED, JobStatus.CANCELLED):
                job.completed_at = time.time()
                if job_id in self._in_flight:
                    del self._in_flight[job_id]
                self._completed[job_id] = job

            self._notify_progress(job)
            return job

    def complete_job(self, job_id: str, media_id: str = "") -> None:
        self.update_job(
            job_id,
            status=JobStatus.COMPLETE,
            progress=100,
            stage="complete",
            message="Complete",
            media_id=media_id,
        )
        self._persist_to_disk()

    def fail_job(self, job_id: str, error: str) -> None:
        self.update_job(
            job_id,
            status=JobStatus.FAILED,
            error=error[:800],
            message="Failed",
        )
        self._persist_to_disk()

    def retry_job(self, job_id: str) -> bool:
        with self._lock:
            job = self._completed.get(job_id)
            if job is None:
                return False
            if job.retry_count >= job.max_retries:
                return False
            job.retry_count += 1
            job.status = JobStatus.QUEUED
            job.progress = 0
            job.current_stage = ""
            job.message = ""
            job.error = None
            job.started_at = 0.0
            job.completed_at = 0.0
            job.cancelled = False
            del self._completed[job_id]
            self._queue.append(job)
            self._queue.sort(key=lambda j: j.priority_value)
            self._condition.notify()
            self._persist_to_disk()
            return True

    def pause(self) -> None:
        with self._lock:
            self._paused = True

    def resume(self) -> None:
        with self._lock:
            self._paused = False
            self._condition.notify_all()

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        for i in range(self._max_workers):
            t = threading.Thread(
                target=self._worker_loop,
                name=f"visual-worker-{i}",
                daemon=True,
            )
            t.start()
            self._workers.append(t)
        log.info(f"Started {self._max_workers} visual processing workers")

    def stop(self) -> None:
        self._running = False
        with self._lock:
            self._condition.notify_all()
        for t in self._workers:
            t.join(timeout=5)
        self._workers.clear()
        self._persist_to_disk()

    def _worker_loop(self) -> None:
        while self._running:
            job = self._dequeue()
            if job is None:
                continue
            self._process_job(job)

    def _dequeue(self) -> VisualJob | None:
        with self._lock:
            while self._running:
                if self._paused:
                    self._condition.wait(timeout=1)
                    continue
                if self._queue:
                    job = self._queue.pop(0)
                    job.status = JobStatus.PREPARING
                    job.started_at = time.time()
                    job.updated_at = time.time()
                    self._in_flight[job.job_id] = job
                    self._notify_progress(job)
                    self._persist_to_disk()
                    return job
                self._condition.wait(timeout=1)
        return None

    def _process_job(self, job: VisualJob) -> None:
        if self._processor is None:
            log.error("No processor set for job queue")
            self.fail_job(job.job_id, "No processor configured")
            return

        try:
            loop = asyncio.new_event_loop()
            try:
                loop.run_until_complete(self._processor(job))
            finally:
                loop.close()
        except Exception as exc:
            log.error(f"Job {job.job_id} processing failed: {exc}")
            if job.retry_count < job.max_retries:
                job.retry_count += 1
                job.status = JobStatus.QUEUED
                job.progress = 0
                job.started_at = 0.0
                with self._lock:
                    if job.job_id in self._in_flight:
                        del self._in_flight[job.job_id]
                    self._queue.append(job)
                    self._queue.sort(key=lambda j: j.priority_value)
                    self._condition.notify()
                    self._persist_to_disk()
                log.info(f"Job {job.job_id} requeued (retry {job.retry_count}/{job.max_retries})")
            else:
                self.fail_job(job.job_id, str(exc))

    def list_queued(self) -> list[dict[str, Any]]:
        with self._lock:
            return [j.to_dict() for j in self._queue]

    def list_in_flight(self) -> list[dict[str, Any]]:
        with self._lock:
            return [j.to_dict() for j in self._in_flight.values()]

    def list_completed(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            jobs = sorted(
                self._completed.values(),
                key=lambda j: j.completed_at,
                reverse=True,
            )
            return [j.to_dict() for j in jobs[:limit]]

    @property
    def queue_size(self) -> int:
        with self._lock:
            return len(self._queue)

    @property
    def in_flight_count(self) -> int:
        with self._lock:
            return len(self._in_flight)


_job_queue: JobQueue | None = None


def get_job_queue() -> JobQueue:
    global _job_queue
    if _job_queue is None:
        _job_queue = JobQueue()
    return _job_queue
