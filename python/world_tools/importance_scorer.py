from __future__ import annotations

import re
from typing import Any


class ImportanceScorer:

    def __init__(
        self,
        *,
        min_threshold: float = 0.15,
        permanent_threshold: float = 0.7,
    ) -> None:
        self._min_threshold = min_threshold
        self._permanent_threshold = permanent_threshold

    def score(self, event: dict[str, Any]) -> dict[str, Any]:
        text = str(event.get("text") or event.get("description") or "").lower()
        emotional_intensity = self._score_emotional_intensity(text)
        rarity = self._score_rarity(text, event)
        plot_relevance = self._score_plot_relevance(text, event)
        relationship_impact = self._score_relationship_impact(text, event)
        permanence = self._score_permanence(text, event)
        witness_count = self._score_witnesses(event)
        user_emphasis = self._score_user_emphasis(event)
        raw = (
            emotional_intensity * 0.25
            + rarity * 0.10
            + plot_relevance * 0.20
            + relationship_impact * 0.20
            + permanence * 0.15
            + witness_count * 0.05
            + user_emphasis * 0.05
        )
        final_score = max(0.0, min(1.0, raw))
        return {
            "score": round(final_score, 3),
            "should_store": final_score >= self._min_threshold,
            "is_permanent": final_score >= self._permanent_threshold,
            "components": {
                "emotional_intensity": round(emotional_intensity, 3),
                "rarity": round(rarity, 3),
                "plot_relevance": round(plot_relevance, 3),
                "relationship_impact": round(relationship_impact, 3),
                "permanence": round(permanence, 3),
                "witness_count": round(witness_count, 3),
                "user_emphasis": round(user_emphasis, 3),
            },
            "decay_rate": self._determine_decay(final_score),
            "category": self._categorize(text),
        }

    def batch_score(self, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
        scored = [(self.score(e), e) for e in events]
        scored.sort(key=lambda pair: pair[0]["score"], reverse=True)
        return [
            {**score, "original_event": event}
            for score, event in scored
        ]

    def _score_emotional_intensity(self, text: str) -> float:
        high = ["betrayal", "murder", "death", "confession", "declaration", "scream", "desperate", "passionate", "furious", "ecstatic"]
        medium = ["argument", "threat", "promise", "kiss", "surprise", "shock", "embarrassment", "tension"]
        low = ["conversation", "walk", "meal", "shopping", "greeting", "farewell"]
        for word in high:
            if word in text:
                return 0.9
        for word in medium:
            if word in text:
                return 0.55
        for word in low:
            if word in text:
                return 0.15
        return 0.3

    def _score_rarity(self, text: str, event: dict[str, Any]) -> float:
        rare_events = ["first time", "never before", "once in a lifetime", "historic", "unprecedented", "unique"]
        for phrase in rare_events:
            if phrase in text:
                return 0.9
        event_type = str(event.get("type") or event.get("event_type") or "")
        rare_types = ["betrayal", "death", "marriage", "birth", "revelation", "transformation"]
        if event_type in rare_types:
            return 0.8
        common_types = ["movement", "observation", "daily", "routine"]
        if event_type in common_types:
            return 0.1
        return 0.4

    def _score_plot_relevance(self, text: str, event: dict[str, Any]) -> float:
        plot_keywords = ["quest", "mission", "objective", "goal", "main story", "plot", "arc", "chapter", "act"]
        for keyword in plot_keywords:
            if keyword in text:
                return 0.85
        event_type = str(event.get("type") or event.get("event_type") or "")
        plot_types = ["quest_start", "quest_complete", "plot_point", "story_beat", "revelation"]
        if event_type in plot_types:
            return 0.9
        faction_keywords = ["faction", "organization", "guild", "alliance", "war", "treaty"]
        for keyword in faction_keywords:
            if keyword in text:
                return 0.7
        return 0.3

    def _score_relationship_impact(self, text: str, event: dict[str, Any]) -> float:
        high_impact = ["fell in love", "got married", "divorced", "betrayed", "swore loyalty", "declared hatred"]
        medium_impact = ["became friends", "had argument", "made peace", "kissed", "confessed", "promised"]
        for phrase in high_impact:
            if phrase in text:
                return 0.95
        for phrase in medium_impact:
            if phrase in text:
                return 0.6
        rel_effects = event.get("relationship_effect")
        if isinstance(rel_effects, dict):
            max_effect = max(abs(float(v)) for v in rel_effects.values()) if rel_effects else 0
            return min(1.0, max_effect / 15)
        return 0.2

    def _score_permanence(self, text: str, event: dict[str, Any]) -> float:
        permanent_events = ["death", "birth", "marriage", "divorce", "scar", "destruction", "creation", "transformation"]
        for word in permanent_events:
            if word in text:
                return 0.95
        event_type = str(event.get("type") or event.get("event_type") or "")
        if event_type in ("death", "birth", "marriage", "destruction"):
            return 0.95
        temporary = ["conversation", "movement", "observation", "mood", "weather"]
        if event_type in temporary:
            return 0.1
        return 0.4

    def _score_witnesses(self, event: dict[str, Any]) -> float:
        witnesses = event.get("witnesses")
        if isinstance(witnesses, list):
            count = len(witnesses)
            if count == 0:
                return 0.1
            if count <= 2:
                return 0.3
            if count <= 5:
                return 0.5
            if count <= 10:
                return 0.7
            return 0.9
        visibility = str(event.get("visibility") or "")
        if visibility == "public":
            return 0.8
        if visibility == "witnessed":
            return 0.4
        return 0.1

    def _score_user_emphasis(self, event: dict[str, Any]) -> float:
        if event.get("user_flagged") or event.get("important"):
            return 1.0
        if event.get("user_emphasis"):
            return 0.7
        tags = event.get("tags") if isinstance(event.get("tags"), list) else []
        if any("important" in str(t).lower() or "key" in str(t).lower() for t in tags):
            return 0.7
        return 0.2

    def _determine_decay(self, score: float) -> str:
        if score >= 0.8:
            return "very_slow"
        if score >= 0.6:
            return "slow"
        if score >= 0.35:
            return "medium"
        return "fast"

    def _categorize(self, text: str) -> str:
        if any(w in text for w in ("death", "kill", "murder", "die")):
            return "mortality"
        if any(w in text for w in ("love", "kiss", "romance", "marriage")):
            return "romance"
        if any(w in text for w in ("betray", "traitor", "spy", "lie")):
            return "betrayal"
        if any(w in text for w in ("quest", "mission", "adventure")):
            return "adventure"
        if any(w in text for w in ("fight", "battle", "combat", "attack")):
            return "conflict"
        if any(w in text for w in ("secret", "reveal", "confess")):
            return "revelation"
        return "general"


_scorer: ImportanceScorer | None = None


def get_importance_scorer() -> ImportanceScorer:
    global _scorer
    if _scorer is None:
        _scorer = ImportanceScorer()
    return _scorer
