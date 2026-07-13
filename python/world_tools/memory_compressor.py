from __future__ import annotations

import re
from typing import Any

_EVENT_PATTERNS = [
    re.compile(r"(\w+)\s+(publicly\s+)?(defended|attacked|betrayed|helped|insulted|kissed|threatened|saved|abandoned)\s+(\w+)", re.I),
    re.compile(r"(\w+)\s+(confessed|revealed|admitted)\s+(to\s+)?(.+)", re.I),
    re.compile(r"(\w+)\s+(gave|received|stole|lost|found|broke|crafted)\s+(.+)"),
    re.compile(r"(\w+)\s+(promised|swore|vowed)\s+(to\s+)?(.+)", re.I),
    re.compile(r"(\w+)\s+(left|entered|arrived at|departed)\s+(.+)", re.I),
]

_RELATIONSHIP_VERBS = {
    "defended": {"trust": 5, "affinity": 4, "loyalty": 3},
    "helped": {"trust": 3, "affinity": 3},
    "betrayed": {"trust": -15, "affinity": -10, "loyalty": -8},
    "attacked": {"trust": -8, "affinity": -6, "fear": 5},
    "insulted": {"affinity": -4, "resentment": 3},
    "kissed": {"affinity": 6, "romance": 5},
    "threatened": {"trust": -5, "fear": 4, "suspicion": 3},
    "saved": {"trust": 8, "affinity": 6, "loyalty": 5},
    "abandoned": {"trust": -6, "affinity": -5, "resentment": 4},
    "confessed": {"trust": 4, "affinity": 2},
    "revealed": {"trust": -2, "suspicion": 3},
    "promised": {"trust": 2, "loyalty": 1},
}

_DECAY_RATES = {
    "betrayal": "very_slow",
    "romance": "slow",
    "conflict": "medium",
    "daily": "fast",
    "observation": "medium",
    "movement": "fast",
    "promise": "slow",
    "secret": "very_slow",
    "default": "medium",
}

_DECAY_MULTIPLIERS = {
    "very_slow": 0.02,
    "slow": 0.05,
    "medium": 0.10,
    "fast": 0.20,
}


class MemoryCompressor:

    def compress_event(self, text: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        context = context or {}
        participants = self._extract_participants(text, context)
        event_type = self._classify_event(text)
        emotional_weight = self._estimate_emotional_weight(text, event_type)
        relationship_effects = self._calculate_relationship_effects(text, event_type)
        visibility = self._determine_visibility(text, context)
        decay = self._determine_decay(event_type, emotional_weight)
        return {
            "event": text.strip()[:300],
            "event_type": event_type,
            "participants": participants,
            "emotional_weight": round(emotional_weight, 2),
            "relationship_effect": relationship_effects,
            "visibility": visibility,
            "decay": decay,
            "location": str(context.get("location", "")),
            "tags": self._extract_tags(text, event_type),
        }

    def compress_memories(self, memories: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if len(memories) <= 5:
            return memories
        grouped: dict[str, list[dict[str, Any]]] = {}
        for mem in memories:
            kind = str(mem.get("kind") or "memory")
            grouped.setdefault(kind, []).append(mem)
        compressed: list[dict[str, Any]] = []
        for kind, group in grouped.items():
            if len(group) <= 2:
                compressed.extend(group)
            else:
                high_importance = [m for m in group if float(m.get("importance", 0.5)) >= 0.6]
                low_importance = [m for m in group if float(m.get("importance", 0.5)) < 0.6]
                compressed.extend(high_importance)
                if low_importance:
                    summary_texts = [str(m.get("text", "")) for m in low_importance[:5]]
                    combined = f"Multiple {kind} events: " + "; ".join(summary_texts)
                    avg_importance = sum(float(m.get("importance", 0.5)) for m in low_importance) / len(low_importance)
                    all_tags: list[str] = []
                    for m in low_importance:
                        all_tags.extend(m.get("tags", []))
                    unique_tags = list(dict.fromkeys(all_tags))[:8]
                    compressed.append({
                        "kind": f"{kind}_summary",
                        "text": combined[:400],
                        "importance": round(avg_importance, 2),
                        "tags": unique_tags,
                        "source": "compressed",
                        "compressed_count": len(low_importance),
                    })
        compressed.sort(key=lambda m: float(m.get("importance", 0.5)), reverse=True)
        return compressed

    def apply_decay(self, memories: list[dict[str, Any]], elapsed_hours: float) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for mem in memories:
            decay = str(mem.get("decay") or "medium")
            multiplier = _DECAY_MULTIPLIERS.get(decay, _DECAY_MULTIPLIERS["medium"])
            importance = float(mem.get("importance", 0.5))
            decayed = importance * max(0.1, 1.0 - multiplier * elapsed_hours / 24)
            if decayed < 0.05:
                continue
            updated = dict(mem)
            updated["importance"] = round(decayed, 3)
            result.append(updated)
        return result

    def _extract_participants(self, text: str, context: dict[str, Any]) -> list[str]:
        participants: list[str] = []
        for pattern in _EVENT_PATTERNS:
            match = pattern.search(text)
            if match:
                for group in match.groups():
                    if group and isinstance(group, str) and len(group) > 1 and group[0].isupper():
                        name = group.strip()
                        if name not in participants:
                            participants.append(name)
        if context.get("actor"):
            actor = str(context["actor"])
            if actor not in participants:
                participants.insert(0, actor)
        return participants[:6]

    def _classify_event(self, text: str) -> str:
        lower = text.lower()
        if any(w in lower for w in ("betray", "backstab", "lied", "deceit")):
            return "betrayal"
        if any(w in lower for w in ("kiss", "romance", "love", "date", "confess")):
            return "romance"
        if any(w in lower for w in ("attack", "fight", "combat", "battle", "strike")):
            return "conflict"
        if any(w in lower for w in ("promise", "swear", "vow", "oath")):
            return "promise"
        if any(w in lower for w in ("secret", "whisper", "confide", "reveal")):
            return "secret"
        if any(w in lower for w in ("left", "arrived", "entered", "departed", "moved")):
            return "movement"
        if any(w in lower for w in ("gave", "received", "trade", "bought", "sold")):
            return "exchange"
        return "observation"

    def _estimate_emotional_weight(self, text: str, event_type: str) -> float:
        base = {"betrayal": 0.9, "romance": 0.75, "conflict": 0.7, "promise": 0.5, "secret": 0.6, "movement": 0.2, "exchange": 0.3, "observation": 0.3}
        weight = base.get(event_type, 0.3)
        intensifiers = ["publicly", "suddenly", "violently", "desperate", "passionate", "brutal", "tender", "shocking"]
        for word in intensifiers:
            if word in text.lower():
                weight = min(1.0, weight + 0.08)
        return weight

    def _calculate_relationship_effects(self, text: str, event_type: str) -> dict[str, int]:
        effects: dict[str, int] = {}
        lower = text.lower()
        for verb, deltas in _RELATIONSHIP_VERBS.items():
            if verb in lower:
                for key, value in deltas.items():
                    effects[key] = effects.get(key, 0) + value
        if not effects:
            type_defaults = {
                "betrayal": {"trust": -10, "affinity": -8},
                "romance": {"affinity": 4, "romance": 3},
                "conflict": {"trust": -3, "fear": 2},
                "promise": {"trust": 2},
                "secret": {"trust": 1},
            }
            effects = type_defaults.get(event_type, {})
        return effects

    def _determine_visibility(self, text: str, context: dict[str, Any]) -> str:
        lower = text.lower()
        if any(w in lower for w in ("publicly", "crowd", "everyone", "announced", "declared")):
            return "public"
        if context.get("witnesses") and len(context["witnesses"]) > 2:
            return "public"
        if context.get("witnesses") and len(context["witnesses"]) > 0:
            return "witnessed"
        if any(w in lower for w in ("whisper", "private", "alone", "secretly")):
            return "private"
        return "witnessed"

    def _determine_decay(self, event_type: str, emotional_weight: float) -> str:
        base = _DECAY_RATES.get(event_type, "medium")
        if emotional_weight >= 0.8:
            return "very_slow"
        if emotional_weight >= 0.6:
            return "slow" if base in ("fast", "medium") else base
        return base

    def _extract_tags(self, text: str, event_type: str) -> list[str]:
        tags = [event_type]
        lower = text.lower()
        location_patterns = ["at the", "in the", "near the", "inside the"]
        for pattern in location_patterns:
            if pattern in lower:
                idx = lower.index(pattern) + len(pattern)
                rest = text[idx:].strip().split()[0] if idx < len(text) else ""
                if rest and len(rest) > 2:
                    tags.append(f"location:{rest.lower().rstrip('.,!?')}")
                break
        return tags[:6]


_compressor: MemoryCompressor | None = None


def get_memory_compressor() -> MemoryCompressor:
    global _compressor
    if _compressor is None:
        _compressor = MemoryCompressor()
    return _compressor
