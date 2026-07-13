from __future__ import annotations

import hashlib
import random
import re
import time
from typing import Any


class Rumor:
    __slots__ = ("id", "origin_event", "text", "version", "category", "damage", "created_at", "last_spread_at", "spread_count")

    def __init__(self, data: dict[str, Any]) -> None:
        self.id = str(data.get("id") or "")
        self.origin_event = str(data.get("origin_event") or "")
        self.text = str(data.get("text") or "")
        self.version = int(data.get("version") or 1)
        self.category = str(data.get("category") or "general")
        self.damage = float(data.get("damage") or 0.3)
        self.created_at = float(data.get("created_at") or time.time())
        self.last_spread_at = float(data.get("last_spread_at") or self.created_at)
        self.spread_count = int(data.get("spread_count") or 0)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "origin_event": self.origin_event,
            "text": self.text,
            "version": self.version,
            "category": self.category,
            "damage": self.damage,
            "created_at": self.created_at,
            "last_spread_at": self.last_spread_at,
            "spread_count": self.spread_count,
        }


class RumorEngine:

    _MUTATION_WORDS = {
        "said": ["claimed", "insisted", "allegedly"],
        "saw": ["thought they saw", "swear they saw", "heard about"],
        "stole": ["allegedly took", "might have taken", "was rumored to have taken"],
        "kissed": ["allegedly kissed", "was seen close to", "was rumored to have kissed"],
        "attacked": ["allegedly attacked", "was said to have assaulted", "may have struck"],
        "betrayed": ["reportedly betrayed", "was accused of betraying", "might have turned on"],
    }

    _INTENSIFIERS = ["shocking", "disturbing", "unbelievable", "scandalous", "terrible", "awful"]
    _HEDGES = ["allegedly", "reportedly", "supposedly", "apparently", "rumor has it", "word is"]

    def create_rumor(self, event: dict[str, Any], witness: str) -> Rumor:
        text = str(event.get("text") or event.get("description") or "")
        category = self._categorize(text)
        damage = self._estimate_damage(text)
        rumor_id = hashlib.sha256(f"{text}:{witness}:{time.time()}".encode()).hexdigest()[:16]
        return Rumor({
            "id": f"rumor_{rumor_id}",
            "origin_event": str(event.get("id") or ""),
            "text": text[:300],
            "version": 1,
            "category": category,
            "damage": damage,
            "created_at": time.time(),
            "last_spread_at": time.time(),
            "spread_count": 0,
        })

    def spread(
        self,
        rumor: Rumor,
        source: str,
        target: str,
        *,
        faction_bias: str = "",
        relationship: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        mutated_text = self._mutate(rumor.text, rumor.version)
        confidence = self._calculate_confidence(rumor, source, target, relationship)
        if confidence < 0.2:
            return {"spread": False, "reason": "low_confidence", "confidence": confidence}
        should_spread = random.random() < confidence
        if not should_spread:
            return {"spread": False, "reason": "probability_check", "confidence": confidence}
        if faction_bias:
            mutated_text = self._apply_faction_bias(mutated_text, faction_bias)
        new_version = rumor.version + 1
        rumor.version = new_version
        rumor.text = mutated_text
        rumor.last_spread_at = time.time()
        rumor.spread_count += 1
        return {
            "spread": True,
            "version": new_version,
            "text": mutated_text,
            "confidence": round(confidence, 2),
            "source": source,
            "target": target,
        }

    def decay(self, rumor: Rumor, hours_elapsed: float) -> Rumor:
        decay_rate = 0.05 * (1 + rumor.version * 0.1)
        rumor.damage = max(0.0, rumor.damage - decay_rate * hours_elapsed / 24)
        return rumor

    def track_spread(
        self,
        rumor: Rumor,
        known_by: dict[str, str],
        spread_result: dict[str, Any],
    ) -> dict[str, Any]:
        if not spread_result.get("spread"):
            return {"known_by": known_by}
        target = str(spread_result.get("target") or "")
        if target:
            known_by[target] = f"v{spread_result.get('version', 1)}"
        return {"known_by": known_by, "spread": spread_result}

    def get_rumor_versions(self, rumor: Rumor, known_by: dict[str, str]) -> list[dict[str, Any]]:
        versions: dict[str, list[str]] = {}
        for person, version_tag in known_by.items():
            versions.setdefault(version_tag, []).append(person)
        return [
            {"version": version, "holders": holders, "count": len(holders)}
            for version, holders in sorted(versions.items())
        ]

    def _mutate(self, text: str, version: int) -> str:
        if version <= 1:
            return text
        mutated = text
        for original, replacements in self._MUTATION_WORDS.items():
            if original in mutated.lower() and random.random() < 0.4:
                replacement = random.choice(replacements)
                pattern = re.compile(re.escape(original), re.I)
                mutated = pattern.sub(replacement, mutated, count=1)
                break
        if version >= 3 and random.random() < 0.3:
            hedge = random.choice(self._HEDGES)
            mutated = f"{hedge}, {mutated[0].lower()}{mutated[1:]}" if mutated else mutated
        if version >= 5 and random.random() < 0.2:
            intensifier = random.choice(self._INTENSIFIERS)
            mutated = f"{intensifier}: {mutated}"
        if version >= 4 and random.random() < 0.25:
            details = ["near the market", "late at night", "in public", "during the festival", "outside the academy"]
            mutated = f"{mutated} ({random.choice(details)})"
        return mutated[:300]

    def _calculate_confidence(
        self,
        rumor: Rumor,
        source: str,
        target: str,
        relationship: dict[str, Any] | None,
    ) -> float:
        base = 0.6
        if relationship and isinstance(relationship, dict):
            trust = float(relationship.get("trust", 50))
            affinity = float(relationship.get("affinity", 50))
            base = (trust + affinity) / 200
        base -= rumor.version * 0.05
        base -= rumor.spread_count * 0.02
        base += rumor.damage * 0.2
        return max(0.05, min(0.95, base))

    def _apply_faction_bias(self, text: str, faction: str) -> str:
        faction_lower = faction.lower()
        if any(w in faction_lower for w in ("rival", "enemy", "hostile")):
            if random.random() < 0.4:
                text = f"{text} (which makes them look worse)"
        elif any(w in faction_lower for w in ("ally", "friend", "friendly")):
            if random.random() < 0.3:
                text = f"{text} (but there might be more to it)"
        return text

    def _categorize(self, text: str) -> str:
        lower = text.lower()
        if any(w in lower for w in ("affair", "kiss", "romance", "lover")):
            return "romantic"
        if any(w in lower for w in ("theft", "steal", "rob", "cheat")):
            return "criminal"
        if any(w in lower for w in ("betray", "traitor", "spy", "lied")):
            return "political"
        if any(w in lower for w in ("fight", "attack", "assault", "battle")):
            return "violent"
        if any(w in lower for w in ("money", "debt", "bribe", "gold")):
            return "financial"
        return "social"

    def _estimate_damage(self, text: str) -> float:
        lower = text.lower()
        high = ["murder", "treason", "blackmail", "assassination"]
        medium = ["betrayal", "theft", "affair", "scandal", "fraud"]
        low = ["argument", "insult", "embarrassment", "gossip"]
        for word in high:
            if word in lower:
                return 0.85
        for word in medium:
            if word in lower:
                return 0.55
        for word in low:
            if word in lower:
                return 0.25
        return 0.3


_engine: RumorEngine | None = None


def get_rumor_engine() -> RumorEngine:
    global _engine
    if _engine is None:
        _engine = RumorEngine()
    return _engine
