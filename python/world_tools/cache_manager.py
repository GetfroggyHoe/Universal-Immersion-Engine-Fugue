from __future__ import annotations

import hashlib
import json
import threading
import time
from pathlib import Path
from typing import Any


class CacheEntry:
    __slots__ = ("key", "value", "created_at", "expires_at", "access_count", "size_bytes")

    def __init__(self, key: str, value: Any, ttl_seconds: float = 300) -> None:
        self.key = key
        self.value = value
        self.created_at = time.time()
        self.expires_at = self.created_at + ttl_seconds
        self.access_count = 0
        try:
            self.size_bytes = len(json.dumps(value, ensure_ascii=False).encode("utf-8"))
        except Exception:
            self.size_bytes = 0

    def is_expired(self) -> bool:
        return time.time() > self.expires_at

    def touch(self) -> None:
        self.access_count += 1


class CacheManager:

    def __init__(self, max_entries: int = 500, max_memory_mb: int = 128) -> None:
        self._cache: dict[str, CacheEntry] = {}
        self._lock = threading.RLock()
        self._max_entries = max_entries
        self._max_memory_bytes = max_memory_mb * 1024 * 1024
        self._hits = 0
        self._misses = 0

    def get(self, key: str) -> Any | None:
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                self._misses += 1
                return None
            if entry.is_expired():
                del self._cache[key]
                self._misses += 1
                return None
            entry.touch()
            self._hits += 1
            return entry.value

    def set(self, key: str, value: Any, ttl_seconds: float = 300) -> None:
        with self._lock:
            self._evict_if_needed()
            self._cache[key] = CacheEntry(key, value, ttl_seconds)

    def delete(self, key: str) -> bool:
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                return True
            return False

    def clear(self, *, category: str = "") -> int:
        with self._lock:
            if not category:
                count = len(self._cache)
                self._cache.clear()
                return count
            to_remove = [k for k in self._cache if k.startswith(f"{category}:")]
            for k in to_remove:
                del self._cache[k]
            return len(to_remove)

    def get_or_compute(self, key: str, compute_fn: Any, ttl_seconds: float = 300) -> Any:
        cached = self.get(key)
        if cached is not None:
            return cached
        value = compute_fn()
        self.set(key, value, ttl_seconds)
        return value

    def cache_context_pack(self, character_name: str, pack: dict[str, Any], ttl_seconds: float = 60) -> None:
        self.set(f"context_pack:{character_name}", pack, ttl_seconds)

    def get_context_pack(self, character_name: str) -> dict[str, Any] | None:
        return self.get(f"context_pack:{character_name}")

    def cache_image(self, cache_key: str, image_data: bytes, ttl_seconds: float = 3600) -> None:
        self.set(f"image:{cache_key}", image_data, ttl_seconds)

    def get_image(self, cache_key: str) -> bytes | None:
        result = self.get(f"image:{cache_key}")
        if isinstance(result, bytes):
            return result
        return None

    def cache_embedding(self, text: str, embedding: list[float], ttl_seconds: float = 86400) -> None:
        key = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
        self.set(f"embedding:{key}", embedding, ttl_seconds)

    def get_embedding(self, text: str) -> list[float] | None:
        key = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
        result = self.get(f"embedding:{key}")
        if isinstance(result, list):
            return result
        return None

    def cache_location_summary(self, location_id: str, summary: dict[str, Any], ttl_seconds: float = 300) -> None:
        self.set(f"location_summary:{location_id}", summary, ttl_seconds)

    def get_location_summary(self, location_id: str) -> dict[str, Any] | None:
        return self.get(f"location_summary:{location_id}")

    def stats(self) -> dict[str, Any]:
        with self._lock:
            total_entries = len(self._cache)
            total_size = sum(e.size_bytes for e in self._cache.values())
            expired = sum(1 for e in self._cache.values() if e.is_expired())
            total_requests = self._hits + self._misses
            hit_rate = self._hits / total_requests if total_requests > 0 else 0.0
            categories: dict[str, int] = {}
            for key in self._cache:
                category = key.split(":")[0] if ":" in key else "default"
                categories[category] = categories.get(category, 0) + 1
        return {
            "entries": total_entries,
            "size_bytes": total_size,
            "size_mb": round(total_size / (1024 * 1024), 2),
            "expired": expired,
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate": round(hit_rate, 3),
            "max_entries": self._max_entries,
            "max_memory_mb": self._max_memory_bytes // (1024 * 1024),
            "categories": categories,
        }

    def cleanup(self) -> int:
        with self._lock:
            expired_keys = [k for k, v in self._cache.items() if v.is_expired()]
            for k in expired_keys:
                del self._cache[k]
            return len(expired_keys)

    def _evict_if_needed(self) -> None:
        while len(self._cache) >= self._max_entries:
            self._evict_lru()
        total_size = sum(e.size_bytes for e in self._cache.values())
        while total_size > self._max_memory_bytes and self._cache:
            self._evict_lru()
            total_size = sum(e.size_bytes for e in self._cache.values())

    def _evict_lru(self) -> None:
        if not self._cache:
            return
        expired = [(k, v) for k, v in self._cache.items() if v.is_expired()]
        if expired:
            key = expired[0][0]
            del self._cache[key]
            return
        lru_key = min(self._cache, key=lambda k: (self._cache[k].access_count, self._cache[k].created_at))
        del self._cache[lru_key]


_manager: CacheManager | None = None


def get_cache_manager() -> CacheManager:
    global _manager
    if _manager is None:
        _manager = CacheManager()
    return _manager
