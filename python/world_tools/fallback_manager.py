from __future__ import annotations

import logging
import time
from typing import Any, Callable

log = logging.getLogger("world_tools.fallback")


class FallbackResult:
    __slots__ = ("success", "value", "provider_used", "attempts", "errors", "elapsed_ms")

    def __init__(
        self,
        success: bool,
        value: Any = None,
        provider_used: str = "",
        attempts: int = 1,
        errors: list[str] | None = None,
        elapsed_ms: float = 0,
    ) -> None:
        self.success = success
        self.value = value
        self.provider_used = provider_used
        self.attempts = attempts
        self.errors = errors or []
        self.elapsed_ms = elapsed_ms

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "provider_used": self.provider_used,
            "attempts": self.attempts,
            "errors": self.errors,
            "elapsed_ms": round(self.elapsed_ms, 1),
        }


class FallbackManager:

    def __init__(
        self,
        *,
        max_retries: int = 2,
        retry_delay_seconds: float = 1.0,
        max_elapsed_seconds: float = 120.0,
    ) -> None:
        self._max_retries = max_retries
        self._retry_delay = retry_delay_seconds
        self._max_elapsed = max_elapsed_seconds
        self._provider_history: dict[str, list[dict[str, Any]]] = {}

    def execute_with_fallback(
        self,
        providers: list[tuple[str, Callable[..., Any]]],
        *args: Any,
        **kwargs: Any,
    ) -> FallbackResult:
        start = time.time()
        errors: list[str] = []
        for attempt_idx, (provider_name, provider_fn) in enumerate(providers):
            for retry in range(self._max_retries + 1):
                elapsed = time.time() - start
                if elapsed > self._max_elapsed:
                    errors.append(f"Max elapsed time exceeded after {elapsed:.1f}s")
                    return FallbackResult(False, None, "", attempt_idx + 1, errors, elapsed * 1000)
                try:
                    value = provider_fn(*args, **kwargs)
                    self._record_success(provider_name)
                    return FallbackResult(True, value, provider_name, attempt_idx + 1, errors, (time.time() - start) * 1000)
                except Exception as exc:
                    error_msg = f"{provider_name} attempt {retry + 1}: {exc}"
                    errors.append(error_msg)
                    log.warning(error_msg)
                    self._record_failure(provider_name, str(exc))
                    if retry < self._max_retries:
                        time.sleep(self._retry_delay * (retry + 1))
        return FallbackResult(False, None, "", len(providers), errors, (time.time() - start) * 1000)

    async def execute_with_fallback_async(
        self,
        providers: list[tuple[str, Callable[..., Any]]],
        *args: Any,
        **kwargs: Any,
    ) -> FallbackResult:
        import asyncio
        start = time.time()
        errors: list[str] = []
        for attempt_idx, (provider_name, provider_fn) in enumerate(providers):
            for retry in range(self._max_retries + 1):
                elapsed = time.time() - start
                if elapsed > self._max_elapsed:
                    errors.append(f"Max elapsed time exceeded after {elapsed:.1f}s")
                    return FallbackResult(False, None, "", attempt_idx + 1, errors, elapsed * 1000)
                try:
                    value = provider_fn(*args, **kwargs)
                    if asyncio.iscoroutine(value):
                        value = await value
                    self._record_success(provider_name)
                    return FallbackResult(True, value, provider_name, attempt_idx + 1, errors, (time.time() - start) * 1000)
                except Exception as exc:
                    error_msg = f"{provider_name} attempt {retry + 1}: {exc}"
                    errors.append(error_msg)
                    log.warning(error_msg)
                    self._record_failure(provider_name, str(exc))
                    if retry < self._max_retries:
                        await asyncio.sleep(self._retry_delay * (retry + 1))
        return FallbackResult(False, None, "", len(providers), errors, (time.time() - start) * 1000)

    def get_provider_stats(self, provider_name: str = "") -> dict[str, Any]:
        if provider_name:
            history = self._provider_history.get(provider_name, [])
            successes = sum(1 for h in history if h.get("success"))
            failures = sum(1 for h in history if not h.get("success"))
            return {
                "provider": provider_name,
                "total_calls": len(history),
                "successes": successes,
                "failures": failures,
                "success_rate": round(successes / len(history), 3) if history else 0.0,
                "last_error": history[-1].get("error") if history and not history[-1].get("success") else "",
            }
        return {
            name: {
                "total_calls": len(h),
                "successes": sum(1 for e in h if e.get("success")),
                "failures": sum(1 for e in h if not e.get("success")),
            }
            for name, h in self._provider_history.items()
        }

    def get_reliable_providers(self, min_success_rate: float = 0.5) -> list[str]:
        reliable: list[str] = []
        for name, history in self._provider_history.items():
            if not history:
                continue
            successes = sum(1 for h in history if h.get("success"))
            rate = successes / len(history)
            if rate >= min_success_rate:
                reliable.append(name)
        return reliable

    def _record_success(self, provider_name: str) -> None:
        history = self._provider_history.setdefault(provider_name, [])
        history.append({"success": True, "ts": time.time()})
        if len(history) > 100:
            self._provider_history[provider_name] = history[-100:]

    def _record_failure(self, provider_name: str, error: str) -> None:
        history = self._provider_history.setdefault(provider_name, [])
        history.append({"success": False, "error": error[:200], "ts": time.time()})
        if len(history) > 100:
            self._provider_history[provider_name] = history[-100:]


_manager: FallbackManager | None = None


def get_fallback_manager() -> FallbackManager:
    global _manager
    if _manager is None:
        _manager = FallbackManager()
    return _manager
