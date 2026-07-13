from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable, Awaitable

log = logging.getLogger("visuals.workers.notifications")


class NotificationService:
    _instance: NotificationService | None = None

    def __init__(self) -> None:
        self._ws_callbacks: list[Callable[[dict[str, Any]], Any]] = []
        self._sse_listeners: list[asyncio.Queue[dict[str, Any]]] = []
        self._event_history: list[dict[str, Any]] = []
        self._max_history = 500

    def register_ws_callback(self, callback: Callable[[dict[str, Any]], Any]) -> None:
        self._ws_callbacks.append(callback)

    def unregister_ws_callback(self, callback: Callable[[dict[str, Any]], Any]) -> None:
        if callback in self._ws_callbacks:
            self._ws_callbacks.remove(callback)

    def subscribe_sse(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
        self._sse_listeners.append(queue)
        return queue

    def unsubscribe_sse(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        if queue in self._sse_listeners:
            self._sse_listeners.remove(queue)

    async def emit(self, event: dict[str, Any]) -> None:
        if "ts" not in event:
            event["ts"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        self._event_history.append(event)
        if len(self._event_history) > self._max_history:
            self._event_history = self._event_history[-self._max_history:]

        for cb in list(self._ws_callbacks):
            try:
                result = cb(event)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as exc:
                log.warning(f"WS callback failed: {exc}")

        for queue in list(self._sse_listeners):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                try:
                    queue.get_nowait()
                    queue.put_nowait(event)
                except Exception:
                    pass

    def emit_sync(self, event: dict[str, Any]) -> None:
        if "ts" not in event:
            event["ts"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        self._event_history.append(event)
        if len(self._event_history) > self._max_history:
            self._event_history = self._event_history[-self._max_history:]

        for cb in list(self._ws_callbacks):
            try:
                result = cb(event)
                if asyncio.iscoroutine(result):
                    log.warning("Sync emit skipped async callback")
            except Exception as exc:
                log.warning(f"WS callback failed: {exc}")

    async def emit_job_event(
        self,
        event_type: str,
        job_id: str,
        visual_key: str,
        extra: dict[str, Any] | None = None,
    ) -> None:
        event: dict[str, Any] = {
            "event": event_type,
            "job_id": job_id,
            "visual_key": visual_key,
        }
        if extra:
            event.update(extra)
        await self.emit(event)

    def get_recent_events(self, limit: int = 50) -> list[dict[str, Any]]:
        return self._event_history[-limit:]

    @property
    def listener_count(self) -> int:
        return len(self._ws_callbacks) + len(self._sse_listeners)


def get_notification_service() -> NotificationService:
    if NotificationService._instance is None:
        NotificationService._instance = NotificationService()
    return NotificationService._instance
