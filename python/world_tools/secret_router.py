from __future__ import annotations

from typing import Any


class SecretRouter:

    def classify_secret(self, secret: dict[str, Any]) -> dict[str, Any]:
        text = str(secret.get("text") or secret.get("content") or "").lower()
        title = str(secret.get("title") or "").lower()
        combined = f"{title} {text}"
        damage = self._estimate_damage(combined)
        spread_potential = self._estimate_spread(combined)
        evidence_strength = self._estimate_evidence(combined)
        category = self._categorize(combined)
        contradicts = secret.get("contradicts") if isinstance(secret.get("contradicts"), list) else []
        return {
            "id": str(secret.get("id") or "").strip(),
            "category": category,
            "damage": round(damage, 2),
            "spread_potential": round(spread_potential, 2),
            "evidence_strength": round(evidence_strength, 2),
            "can_spread": spread_potential > 0.3,
            "is_public": False,
            "known_by": list(secret.get("known_by") or []),
            "suspected_by": list(secret.get("suspected_by") or []),
            "contradicts": contradicts,
        }

    def route_to_npcs(
        self,
        secret: dict[str, Any],
        all_npcs: list[dict[str, Any]],
        *,
        location: str = "",
        recent_events: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        classified = self.classify_secret(secret) if "category" not in secret else secret
        spread_potential = float(classified.get("spread_potential", 0.3))
        known_by = {str(n).lower() for n in classified.get("known_by", [])}
        suspected_by = {str(n).lower() for n in classified.get("suspected_by", [])}
        candidates: list[dict[str, Any]] = []
        for npc in all_npcs:
            name = str(npc.get("name") or "").lower()
            if not name or name in known_by:
                continue
            npc_location = str(npc.get("location") or "")
            profile = npc.get("profile", {}) if isinstance(npc.get("profile"), dict) else {}
            relationships = npc.get("relationships", {}) if isinstance(npc.get("relationships"), dict) else {}
            score = 0.0
            if location and npc_location.lower() == location.lower():
                score += 0.3
            for known_name in known_by:
                rel = relationships.get(known_name.title()) or relationships.get(known_name)
                if isinstance(rel, dict):
                    trust = float(rel.get("trust", 50))
                    affinity = float(rel.get("affinity", 50))
                    score += (trust + affinity) / 400
            if str(profile.get("personality") or "") in ("curious", "nosy", "gossip", "suspicious"):
                score += 0.15
            suspicion = float(npc.get("stats", {}).get("suspicion", 0) or 0)
            score += suspicion / 200
            if recent_events:
                for event in recent_events[-5:]:
                    if str(event.get("actor", "")).lower() == name:
                        score += 0.05
            score *= spread_potential
            if score > 0.1:
                if score > 0.5:
                    candidates.append({"name": npc.get("name", ""), "status": "knows", "confidence": round(min(1.0, score), 2)})
                else:
                    candidates.append({"name": npc.get("name", ""), "status": "suspects", "confidence": round(min(1.0, score), 2)})
        candidates.sort(key=lambda c: c["confidence"], reverse=True)
        return candidates

    def propagate(
        self,
        secret: dict[str, Any],
        current_known: list[str],
        current_suspected: list[str],
        new_routes: list[dict[str, Any]],
    ) -> dict[str, Any]:
        known = set(str(n).lower() for n in current_known)
        suspected = set(str(n).lower() for n in current_suspected)
        newly_known: list[str] = []
        newly_suspected: list[str] = []
        for route in new_routes:
            name = str(route.get("name") or "").lower()
            if not name:
                continue
            if route.get("status") == "knows":
                if name not in known:
                    known.add(name)
                    suspected.discard(name)
                    newly_known.append(name)
            elif route.get("status") == "suspects":
                if name not in known and name not in suspected:
                    suspected.add(name)
                    newly_suspected.append(name)
        return {
            "known_by": sorted(known),
            "suspected_by": sorted(suspected),
            "newly_known": newly_known,
            "newly_suspected": newly_suspected,
        }

    def check_contradictions(self, secret: dict[str, Any], existing_secrets: list[dict[str, Any]]) -> list[dict[str, Any]]:
        text = str(secret.get("text") or "").lower()
        contradictions: list[dict[str, Any]] = []
        for existing in existing_secrets:
            if str(existing.get("id") or "") == str(secret.get("id") or ""):
                continue
            existing_text = str(existing.get("text") or "").lower()
            if not existing_text:
                continue
            overlap = self._text_overlap(text, existing_text)
            if overlap > 0.4:
                known_a = {str(n).lower() for n in secret.get("known_by", [])}
                known_b = {str(n).lower() for n in existing.get("known_by", [])}
                shared = known_a & known_b
                if shared:
                    contradictions.append({
                        "secret_id": existing.get("id", ""),
                        "overlap": round(overlap, 2),
                        "shared_knowers": sorted(shared),
                    })
        return contradictions

    def _estimate_damage(self, text: str) -> float:
        high_damage = ["murder", "assassination", "treason", "embezzle", "blackmail", "kidnap", "poison", "abuse"]
        medium_damage = ["affair", "theft", "lie", "betray", "spy", "sabotage", "fraud", "smuggle"]
        low_damage = ["crush", "embarrass", "gossip", "rivalry", "debt", "scandal"]
        for word in high_damage:
            if word in text:
                return 0.9
        for word in medium_damage:
            if word in text:
                return 0.6
        for word in low_damage:
            if word in text:
                return 0.3
        return 0.2

    def _estimate_spread(self, text: str) -> float:
        high_spread = ["publicly", "everyone", "announced", "rumor", "gossip", "news", "shocking"]
        medium_spread = ["whisper", "secretly", "told", "heard", "overheard"]
        for word in high_spread:
            if word in text:
                return 0.8
        for word in medium_spread:
            if word in text:
                return 0.5
        return 0.3

    def _estimate_evidence(self, text: str) -> float:
        strong = ["proof", "evidence", "document", "letter", "witness", "saw", "caught", "record"]
        weak = ["heard", "rumor", "suspect", "think", "maybe", "possibly"]
        for word in strong:
            if word in text:
                return 0.8
        for word in weak:
            if word in text:
                return 0.3
        return 0.5

    def _categorize(self, text: str) -> str:
        categories = {
            "criminal": ["murder", "theft", "robbery", "assassination", "smuggle", "kidnap"],
            "political": ["treason", "conspiracy", "coup", "alliance", "betray"],
            "romantic": ["affair", "lover", "romance", "infidelity", "crush"],
            "financial": ["debt", "embezzle", "fraud", "bribe", "money"],
            "personal": ["secret", "shame", "fear", "past", "identity"],
        }
        for category, keywords in categories.items():
            if any(kw in text for kw in keywords):
                return category
        return "general"

    def _text_overlap(self, a: str, b: str) -> float:
        words_a = set(a.split())
        words_b = set(b.split())
        if not words_a or not words_b:
            return 0.0
        intersection = words_a & words_b
        union = words_a | words_b
        return len(intersection) / len(union) if union else 0.0


_router: SecretRouter | None = None


def get_secret_router() -> SecretRouter:
    global _router
    if _router is None:
        _router = SecretRouter()
    return _router
