from __future__ import annotations

import re
import unicodedata
from typing import Any

_SLUG_RE = re.compile(r"[^a-z0-9]+")
_MULTI_SPACE_RE = re.compile(r"\s{2,}")
_CASING_RE = re.compile(r"([a-z])([A-Z])")


def _slug(value: str) -> str:
    raw = unicodedata.normalize("NFKD", str(value or "").lower())
    raw = "".join(c for c in raw if not unicodedata.combining(c))
    return _SLUG_RE.sub("_", raw).strip("_")


def _title(value: str) -> str:
    return _MULTI_SPACE_RE.sub(" ", str(value or "").strip()).title()


def _canonical_tag(value: str) -> str:
    return _slug(value).replace("_", " ").strip()


class EntityNormalizer:

    def normalize_npc(self, data: dict[str, Any]) -> dict[str, Any]:
        out = dict(data)
        name = str(out.get("name") or "").strip()
        out["name"] = name
        out["id"] = str(out.get("id") or "").strip() or _slug(name)
        out["role"] = _title(str(out.get("role") or "NPC").strip())
        out["location"] = str(out.get("location") or "Starting Location").strip() or "Starting Location"
        out["faction"] = _slug(str(out.get("faction") or ""))
        out["party"] = _slug(str(out.get("party") or ""))
        out["likes"] = self._dedup_strings(out.get("likes"))
        out["dislikes"] = self._dedup_strings(out.get("dislikes"))
        out["wants"] = self._dedup_strings(out.get("wants"))
        out["desires"] = self._dedup_strings(out.get("desires"))
        out["tags"] = self._dedup_strings(out.get("tags"))
        out["phone_number"] = str(out.get("phone_number") or "").strip()
        profile = out.get("profile") if isinstance(out.get("profile"), dict) else {}
        profile["personality"] = _slug(str(profile.get("personality") or ""))
        profile["appearance"] = str(profile.get("appearance") or "").strip()
        profile["bio"] = str(profile.get("bio") or "").strip()
        out["profile"] = profile
        out["secrets"] = self._normalize_secrets(out.get("secrets"))
        out["privateIntel"] = self._normalize_intel(out.get("privateIntel"))
        schedule = out.get("schedule") if isinstance(out.get("schedule"), list) else []
        out["schedule"] = [self._normalize_schedule_slot(s) for s in schedule if isinstance(s, dict)]
        stats = out.get("stats") if isinstance(out.get("stats"), dict) else {}
        out["stats"] = {k: max(1, min(20, int(v))) for k, v in stats.items() if isinstance(v, (int, float))}
        needs = out.get("needs") if isinstance(out.get("needs"), dict) else {}
        out["needs"] = {k: max(0.0, min(1.0, float(v))) for k, v in needs.items() if isinstance(v, (int, float))}
        return out

    def normalize_item(self, data: dict[str, Any]) -> dict[str, Any]:
        out = dict(data)
        name = str(out.get("name") or "").strip()
        out["name"] = name
        out["id"] = str(out.get("id") or "").strip() or _slug(name)
        out["template_id"] = str(out.get("template_id") or "").strip() or out["id"]
        out["category"] = _slug(str(out.get("category") or "misc"))
        out["rarity"] = _slug(str(out.get("rarity") or "common"))
        out["tags"] = self._dedup_strings(out.get("tags"))
        qty = out.get("quantity", out.get("qty", 1))
        out["quantity"] = max(0, int(qty)) if isinstance(qty, (int, float)) else 1
        costs = out.get("costs") if isinstance(out.get("costs"), dict) else {}
        out["costs"] = {k: max(0, int(v)) for k, v in costs.items() if isinstance(v, (int, float))}
        stats = out.get("stats") if isinstance(out.get("stats"), dict) else {}
        out["stats"] = {k: int(v) for k, v in stats.items() if isinstance(v, (int, float))}
        return out

    def normalize_faction(self, data: dict[str, Any]) -> dict[str, Any]:
        out = dict(data)
        name = str(out.get("name") or "").strip()
        out["name"] = name
        out["id"] = str(out.get("id") or "").strip() or _slug(name)
        out["type"] = _slug(str(out.get("type") or "organization"))
        out["members"] = self._dedup_strings(out.get("members"))
        out["controlledSpaces"] = self._dedup_strings(out.get("controlledSpaces"))
        out["tags"] = self._dedup_strings(out.get("tags"))
        influence = out.get("influence") if isinstance(out.get("influence"), dict) else {}
        out["influence"] = {k: v for k, v in influence.items() if isinstance(v, (int, float, str, bool))}
        return out

    def normalize_location(self, data: dict[str, Any]) -> dict[str, Any]:
        out = dict(data)
        name = str(out.get("name") or "").strip()
        out["name"] = name or "Unknown Location"
        out["id"] = str(out.get("id") or "").strip() or _slug(name)
        out["layer"] = _slug(str(out.get("layer") or "local"))
        out["parent"] = str(out.get("parent") or "").strip()
        out["tags"] = self._dedup_strings(out.get("tags"))
        for axis in ("x", "y", "z"):
            val = out.get(axis, 0 if axis == "z" else 0.5)
            out[axis] = float(val) if isinstance(val, (int, float)) else (0 if axis == "z" else 0.5)
        exits = out.get("exits") if isinstance(out.get("exits"), dict) else {}
        out["exits"] = {str(k): str(v) for k, v in exits.items() if str(v or "").strip()}
        return out

    def normalize_quest(self, data: dict[str, Any]) -> dict[str, Any]:
        out = dict(data)
        name = str(out.get("name") or "").strip()
        out["name"] = name
        out["id"] = str(out.get("id") or "").strip() or _slug(name)
        out["status"] = _slug(str(out.get("status") or "available"))
        out["tags"] = self._dedup_strings(out.get("tags"))
        out["objectives"] = [
            self._normalize_objective(o) for o in (out.get("objectives") if isinstance(out.get("objectives"), list) else [])
            if isinstance(o, dict)
        ]
        rewards = out.get("rewards") if isinstance(out.get("rewards"), list) else []
        out["rewards"] = [r for r in rewards if isinstance(r, (dict, str))]
        return out

    def normalize_skill(self, data: dict[str, Any]) -> dict[str, Any]:
        out = dict(data)
        name = str(out.get("name") or "").strip()
        out["name"] = name
        out["id"] = str(out.get("id") or "").strip() or _slug(name)
        out["type"] = _slug(str(out.get("type") or "skill"))
        out["element"] = _slug(str(out.get("element") or "generic"))
        out["tags"] = self._dedup_strings(out.get("tags"))
        costs = out.get("costs") if isinstance(out.get("costs"), dict) else {}
        out["costs"] = {k: max(0, int(v)) for k, v in costs.items() if isinstance(v, (int, float))}
        return out

    def normalize_post(self, data: dict[str, Any]) -> dict[str, Any]:
        out = dict(data)
        out["author"] = str(out.get("author") or out.get("username") or "Local").strip()[:80]
        out["content"] = str(out.get("content") or "").strip()[:700]
        out["tag"] = _slug(str(out.get("tag") or "Cozy"))
        out["tone"] = _title(str(out.get("tone") or "Neutral").strip())
        out["mentions"] = self._dedup_strings(out.get("mentions"))
        metrics = out.get("metrics") if isinstance(out.get("metrics"), dict) else {}
        out["metrics"] = {
            "likes": max(0, int(metrics.get("likes", 0) or 0)),
            "comments": max(0, int(metrics.get("comments", 0) or 0)),
            "shares": max(0, int(metrics.get("shares", 0) or 0)),
            "reach": max(0, int(metrics.get("reach", 0) or 0)),
        }
        return out

    def normalize_memory(self, data: dict[str, Any]) -> dict[str, Any]:
        out = dict(data)
        out["text"] = str(out.get("text") or "").strip()
        out["kind"] = _slug(str(out.get("kind") or "memory"))
        out["importance"] = max(0.0, min(1.0, float(out.get("importance", 0.5) or 0.5)))
        out["tags"] = self._dedup_strings(out.get("tags"))
        out["source"] = str(out.get("source") or "system").strip()
        out["visible_to"] = self._dedup_strings(out.get("visible_to"))
        return out

    def normalize_all(self, entity_type: str, data: dict[str, Any]) -> dict[str, Any]:
        dispatch = {
            "npc": self.normalize_npc,
            "character": self.normalize_npc,
            "item": self.normalize_item,
            "item_template": self.normalize_item,
            "equipment_template": self.normalize_item,
            "faction": self.normalize_faction,
            "organization": self.normalize_faction,
            "location": self.normalize_location,
            "place": self.normalize_location,
            "quest": self.normalize_quest,
            "skill": self.normalize_skill,
            "post": self.normalize_post,
            "memory": self.normalize_memory,
        }
        handler = dispatch.get(entity_type)
        if handler:
            return handler(data)
        return dict(data)

    def _dedup_strings(self, values: Any) -> list[str]:
        if not isinstance(values, list):
            return []
        seen: set[str] = set()
        result: list[str] = []
        for item in values:
            cleaned = _canonical_tag(str(item or ""))
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                result.append(cleaned)
        return result

    def _normalize_secrets(self, secrets: Any) -> list[dict[str, Any]]:
        if not isinstance(secrets, list):
            return []
        result: list[dict[str, Any]] = []
        for s in secrets:
            if not isinstance(s, dict):
                continue
            entry = {
                "id": str(s.get("id") or "").strip() or _slug(str(s.get("text") or s.get("title") or "")),
                "text": str(s.get("text") or s.get("content") or "").strip(),
                "title": str(s.get("title") or "").strip(),
                "visibility": _slug(str(s.get("visibility") or "private")),
                "damage": max(0.0, min(1.0, float(s.get("damage", 0.5) or 0.5))),
                "known_by": self._dedup_strings(s.get("known_by")),
                "suspected_by": self._dedup_strings(s.get("suspected_by")),
                "evidence": self._dedup_strings(s.get("evidence")),
            }
            if entry["text"] or entry["title"]:
                result.append(entry)
        return result

    def _normalize_intel(self, intel: Any) -> list[dict[str, Any]]:
        if not isinstance(intel, list):
            return []
        result: list[dict[str, Any]] = []
        for item in intel:
            if not isinstance(item, dict):
                continue
            entry = {
                "id": str(item.get("id") or "").strip() or _slug(str(item.get("text") or "")),
                "text": str(item.get("text") or "").strip(),
                "source": str(item.get("source") or "").strip(),
                "reliability": max(0.0, min(1.0, float(item.get("reliability", 0.7) or 0.7))),
                "tags": self._dedup_strings(item.get("tags")),
            }
            if entry["text"]:
                result.append(entry)
        return result

    def _normalize_schedule_slot(self, slot: dict[str, Any]) -> dict[str, Any]:
        return {
            "start": max(0, min(23, int(slot.get("start", 0) or 0))),
            "end": max(1, min(24, int(slot.get("end", 24) or 24))),
            "location": str(slot.get("location") or "Starting Location").strip(),
            "activity": str(slot.get("activity") or "").strip(),
            "follow_chance": max(0.0, min(1.0, float(slot.get("follow_chance", 0.7) or 0.7))),
        }

    def _normalize_objective(self, obj: dict[str, Any]) -> dict[str, Any]:
        return {
            "text": str(obj.get("text") or obj.get("description") or "").strip(),
            "completed": bool(obj.get("completed", False)),
            "progress": max(0.0, min(1.0, float(obj.get("progress", 0.0) or 0.0))),
        }


_normalizer: EntityNormalizer | None = None


def get_entity_normalizer() -> EntityNormalizer:
    global _normalizer
    if _normalizer is None:
        _normalizer = EntityNormalizer()
    return _normalizer
