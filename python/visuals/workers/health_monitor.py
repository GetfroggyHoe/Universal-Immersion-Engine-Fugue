from __future__ import annotations

import logging
import os
import platform
import time
from typing import Any

log = logging.getLogger("visuals.workers.health")


class HealthMonitor:
    _instance: HealthMonitor | None = None

    def __init__(self) -> None:
        self._workers: dict[str, Any] = {}
        self._last_check = 0.0
        self._memory_warning = False

    def register_worker(self, name: str, worker: Any) -> None:
        self._workers[name] = worker

    def check_all(self) -> dict[str, dict[str, Any]]:
        self._last_check = time.time()
        results: dict[str, dict[str, Any]] = {}

        for name, worker in self._workers.items():
            try:
                if hasattr(worker, "health_check"):
                    results[name] = worker.health_check()
                else:
                    results[name] = {"healthy": True}
            except Exception as exc:
                results[name] = {"healthy": False, "error": str(exc)}

        memory_status = self._check_memory_pressure()
        results["_system"] = {
            "platform": platform.system(),
            "memory_pressure": memory_status,
            "is_android": self._is_android(),
        }

        return results

    def _check_memory_pressure(self) -> str:
        if not self._is_android():
            return "none"

        try:
            meminfo_path = "/proc/meminfo"
            if os.path.exists(meminfo_path):
                with open(meminfo_path, "r") as f:
                    content = f.read()

                mem_available = 0
                mem_total = 0
                for line in content.split("\n"):
                    if line.startswith("MemAvailable:"):
                        mem_available = int(line.split()[1])
                    elif line.startswith("MemTotal:"):
                        mem_total = int(line.split()[1])

                if mem_total > 0:
                    usage_pct = 100.0 * (1.0 - mem_available / mem_total)
                    if usage_pct > 90:
                        self._memory_warning = True
                        return "critical"
                    elif usage_pct > 75:
                        self._memory_warning = True
                        return "high"
                    elif usage_pct > 60:
                        return "moderate"
                    else:
                        self._memory_warning = False
                        return "none"
        except Exception:
            pass

        return "unknown"

    @staticmethod
    def _is_android() -> bool:
        return platform.system() == "Linux" and os.environ.get("ANDROID_ROOT") is not None

    @property
    def memory_warning(self) -> bool:
        return self._memory_warning

    def should_pause_background(self) -> bool:
        if not self._is_android():
            return False
        pressure = self._check_memory_pressure()
        return pressure in ("critical", "high")

    def get_summary(self) -> dict[str, Any]:
        checks = self.check_all()
        all_healthy = all(
            v.get("healthy", False)
            for k, v in checks.items()
            if not k.startswith("_")
        )
        return {
            "all_healthy": all_healthy,
            "worker_count": len(self._workers),
            "last_check": self._last_check,
            "memory_warning": self._memory_warning,
            "checks": checks,
        }


def get_health_monitor() -> HealthMonitor:
    if HealthMonitor._instance is None:
        HealthMonitor._instance = HealthMonitor()
    return HealthMonitor._instance
