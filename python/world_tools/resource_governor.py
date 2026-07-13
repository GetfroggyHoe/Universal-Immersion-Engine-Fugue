from __future__ import annotations

import os
import threading
import time
from typing import Any


class ResourceSnapshot:
    __slots__ = ("timestamp", "ram_available_mb", "ram_total_mb", "cpu_percent", "battery_percent", "temperature_c", "storage_free_gb", "is_constrained")

    def __init__(self, data: dict[str, Any]) -> None:
        self.timestamp = float(data.get("timestamp") or time.time())
        self.ram_available_mb = float(data.get("ram_available_mb") or 0)
        self.ram_total_mb = float(data.get("ram_total_mb") or 0)
        self.cpu_percent = float(data.get("cpu_percent") or 0)
        self.battery_percent = float(data.get("battery_percent") or 100)
        self.temperature_c = float(data.get("temperature_c") or 0)
        self.storage_free_gb = float(data.get("storage_free_gb") or 0)
        self.is_constrained = bool(data.get("is_constrained") or False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "ram_available_mb": self.ram_available_mb,
            "ram_total_mb": self.ram_total_mb,
            "cpu_percent": self.cpu_percent,
            "battery_percent": self.battery_percent,
            "temperature_c": self.temperature_c,
            "storage_free_gb": self.storage_free_gb,
            "is_constrained": self.is_constrained,
        }


class ResourceGovernor:

    def __init__(
        self,
        *,
        ram_threshold_mb: int = 256,
        cpu_threshold_percent: int = 85,
        battery_threshold_percent: int = 15,
        temperature_threshold_c: int = 42,
        storage_threshold_gb: int = 1,
    ) -> None:
        self._lock = threading.RLock()
        self._snapshots: list[ResourceSnapshot] = []
        self._max_snapshots = 60
        self._ram_threshold = ram_threshold_mb
        self._cpu_threshold = cpu_threshold_percent
        self._battery_threshold = battery_threshold_percent
        self._temp_threshold = temperature_threshold_c
        self._storage_threshold = storage_threshold_gb
        self._paused_jobs: list[str] = []
        self._reduced_workers = False

    def report(self, snapshot: dict[str, Any]) -> ResourceSnapshot:
        snap = ResourceSnapshot(snapshot)
        if not snap.is_constrained:
            snap.is_constrained = self._evaluate_constrained(snap)
        with self._lock:
            self._snapshots.append(snap)
            if len(self._snapshots) > self._max_snapshots:
                self._snapshots = self._snapshots[-self._max_snapshots:]
        return snap

    def get_current_snapshot(self) -> ResourceSnapshot | None:
        with self._lock:
            return self._snapshots[-1] if self._snapshots else None

    def should_pause_background_jobs(self) -> bool:
        snap = self.get_current_snapshot()
        if not snap:
            return False
        return snap.is_constrained

    def should_reduce_workers(self) -> bool:
        snap = self.get_current_snapshot()
        if not snap:
            return False
        return snap.cpu_percent > self._cpu_threshold or snap.ram_available_mb < self._ram_threshold * 1.5

    def get_recommended_workers(self, default: int = 4) -> int:
        if self.should_reduce_workers():
            return max(1, default // 2)
        return default

    def should_throttle_image_generation(self) -> bool:
        snap = self.get_current_snapshot()
        if not snap:
            return False
        return snap.is_constrained or snap.ram_available_mb < self._ram_threshold * 2

    def should_enable_power_saving(self) -> bool:
        snap = self.get_current_snapshot()
        if not snap:
            return False
        return snap.battery_percent < self._battery_threshold or snap.temperature_c > self._temp_threshold

    def register_paused_job(self, job_id: str) -> None:
        with self._lock:
            if job_id not in self._paused_jobs:
                self._paused_jobs.append(job_id)

    def get_paused_jobs(self) -> list[str]:
        with self._lock:
            return list(self._paused_jobs)

    def clear_paused_jobs(self) -> None:
        with self._lock:
            self._paused_jobs.clear()

    def get_adaptation_advice(self) -> dict[str, Any]:
        snap = self.get_current_snapshot()
        if not snap:
            return {"status": "no_data", "actions": []}
        actions: list[str] = []
        if snap.ram_available_mb < self._ram_threshold:
            actions.append("pause_background_image_jobs")
            actions.append("reduce_worker_count")
            actions.append("clear_caches")
        elif snap.ram_available_mb < self._ram_threshold * 2:
            actions.append("reduce_worker_count")
            actions.append("throttle_image_generation")
        if snap.cpu_percent > self._cpu_threshold:
            actions.append("reduce_worker_count")
            actions.append("defer_non_urgent_tasks")
        if snap.battery_percent < self._battery_threshold:
            actions.append("enable_power_saving")
            actions.append("pause_background_image_jobs")
        if snap.temperature_c > self._temp_threshold:
            actions.append("enable_cooldown_period")
            actions.append("pause_background_image_jobs")
        if snap.storage_free_gb < self._storage_threshold:
            actions.append("run_storage_cleanup")
            actions.append("warn_low_storage")
        if not actions:
            actions.append("all_systems_normal")
        return {
            "status": "constrained" if snap.is_constrained else "normal",
            "actions": actions,
            "snapshot": snap.to_dict(),
        }

    def _evaluate_constrained(self, snap: ResourceSnapshot) -> bool:
        if snap.ram_available_mb > 0 and snap.ram_available_mb < self._ram_threshold:
            return True
        if snap.cpu_percent > self._cpu_threshold:
            return True
        if 0 < snap.battery_percent < self._battery_threshold:
            return True
        if snap.temperature_c > self._temp_threshold:
            return True
        if 0 < snap.storage_free_gb < self._storage_threshold:
            return True
        return False


_governor: ResourceGovernor | None = None


def get_resource_governor() -> ResourceGovernor:
    global _governor
    if _governor is None:
        _governor = ResourceGovernor()
    return _governor
