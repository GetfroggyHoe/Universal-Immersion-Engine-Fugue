from __future__ import annotations

import hashlib
import re
from typing import Any

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slug(value: str) -> str:
    return _SLUG_RE.sub("", str(value or "").lower())


def _levenshtein(a: str, b: str) -> int:
    if len(a) < len(b):
        return _levenshtein(b, a)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        curr = [i + 1]
        for j, cb in enumerate(b):
            cost = 0 if ca == cb else 1
            curr.append(min(curr[j] + 1, prev[j + 1] + 1, prev[j] + cost))
        prev = curr
    return prev[-1]


def _similarity(a: str, b: str) -> float:
    sa, sb = _slug(a), _slug(b)
    if sa == sb:
        return 1.0
    if not sa or not sb:
        return 0.0
    if sa in sb or sb in sa:
        return 0.85
    dist = _levenshtein(sa, sb)
    max_len = max(len(sa), len(sb))
    return max(0.0, 1.0 - dist / max_len) if max_len else 0.0


def _content_hash(data: dict[str, Any]) -> str:
    canonical = repr(sorted((k, v) for k, v in data.items() if k not in {"id", "ts", "updated_at", "created_at"}))
    return hashlib.sha256(canonical.encode("utf-8", "ignore")).hexdigest()[:16]


class DedupCandidate:
    __slots__ = ("entity", "score", "reason")

    def __init__(self, entity: dict[str, Any], score: float, reason: str) -> None:
        self.entity = entity
        self.score = score
        self.reason = reason


class EntityDeduplicator:

    def __init__(self, name_threshold: float = 0.82, content_threshold: float = 0.9) -> None:
        self._name_threshold = name_threshold
        self._content_threshold = content_threshold

    def find_duplicates(
        self,
        candidate: dict[str, Any],
        existing: list[dict[str, Any]],
        *,
        name_key: str = "name",
        extra_fields: list[str] | None = None,
    ) -> list[DedupCandidate]:
        candidate_name = str(candidate.get(name_key) or "").strip()
        if not candidate_name:
            return []
        results: list[DedupCandidate] = []
        candidate_hash = _content_hash(candidate)
        for entity in existing:
            entity_name = str(entity.get(name_key) or "").strip()
            if not entity_name:
                continue
            name_sim = _similarity(candidate_name, entity_name)
            if name_sim >= 1.0:
                results.append(DedupCandidate(entity, 1.0, "exact_name_match"))
                continue
            entity_hash = _content_hash(entity)
            if candidate_hash == entity_hash:
                results.append(DedupCandidate(entity, 0.98, "content_hash_match"))
                continue
            field_bonus = 0.0
            if extra_fields:
                matches = sum(
                    1 for f in extra_fields
                    if _slug(str(candidate.get(f) or "")) == _slug(str(entity.get(f) or ""))
                    and _slug(str(candidate.get(f) or ""))
                )
                field_bonus = min(0.15, matches * 0.05)
            score = name_sim + field_bonus
            if score >= self._name_threshold:
                results.append(DedupCandidate(entity, score, f"name_similarity:{name_sim:.2f}"))
        results.sort(key=lambda c: c.score, reverse=True)
        return results

    def should_merge(self, candidate: dict[str, Any], target: dict[str, Any], score: float) -> bool:
        return score >= self._content_threshold

    def merge_entities(self, primary: dict[str, Any], secondary: dict[str, Any]) -> dict[str, Any]:
        merged = dict(primary)
        for key, value in secondary.items():
            if key in {"id", "name"}:
                continue
            if key not in merged or not merged[key]:
                merged[key] = value
            elif isinstance(value, list) and isinstance(merged.get(key), list):
                existing_slugs = {_slug(str(item)) for item in merged[key] if isinstance(item, str)}
                for item in value:
                    if isinstance(item, str) and _slug(item) not in existing_slugs:
                        merged[key].append(item)
                        existing_slugs.add(_slug(item))
            elif isinstance(value, dict) and isinstance(merged.get(key), dict):
                for sub_key, sub_val in value.items():
                    if sub_key not in merged[key] or not merged[key][sub_key]:
                        merged[key][sub_key] = sub_val
        return merged

    def deduplicate_batch(
        self,
        entities: list[dict[str, Any]],
        *,
        name_key: str = "name",
        extra_fields: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        if len(entities) <= 1:
            return list(entities)
        kept: list[dict[str, Any]] = []
        for entity in entities:
            dupes = self.find_duplicates(entity, kept, name_key=name_key, extra_fields=extra_fields)
            if dupes and self.should_merge(entity, dupes[0].entity, dupes[0].score):
                idx = kept.index(dupes[0].entity)
                kept[idx] = self.merge_entities(kept[idx], entity)
            else:
                kept.append(entity)
        return kept


_deduplicator: EntityDeduplicator | None = None


def get_entity_deduplicator() -> EntityDeduplicator:
    global _deduplicator
    if _deduplicator is None:
        _deduplicator = EntityDeduplicator()
    return _deduplicator
