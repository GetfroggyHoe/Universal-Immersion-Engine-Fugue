from __future__ import annotations

import json
import time
from typing import Any


class ContextPacker:

    def __init__(self, max_tokens_estimate: int = 3200, max_memories: int = 8, max_relationships: int = 12) -> None:
        self._max_tokens = max_tokens_estimate
        self._max_memories = max_memories
        self._max_relationships = max_relationships

    def pack(
        self,
        *,
        character: dict[str, Any],
        location: str = "",
        present_npcs: list[dict[str, Any]] | None = None,
        active_secrets: list[dict[str, Any]] | None = None,
        recent_events: list[dict[str, Any]] | None = None,
        current_conflict: dict[str, Any] | None = None,
        world_state: dict[str, Any] | None = None,
        user_character: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        present = present_npcs or []
        secrets = active_secrets or []
        events = recent_events or []
        profile = character.get("profile", {}) if isinstance(character.get("profile"), dict) else {}
        memories = self._select_relevant_memories(character.get("memories", []), location, present)
        relationships = self._select_relevant_relationships(
            character.get("relationships", {}),
            [str(n.get("name") or "") for n in present],
        )
        emotional_state = self._extract_emotional_state(character)
        schedule_context = self._current_schedule_context(character)
        inventory_summary = self._summarize_inventory(character)
        known_secrets = self._filter_character_secrets(secrets, character.get("name", ""))
        pack = {
            "character": {
                "name": character.get("name", ""),
                "role": character.get("role", "NPC"),
                "location": location or character.get("location", ""),
                "personality": profile.get("personality", ""),
                "bio": profile.get("bio", "")[:300],
                "appearance": profile.get("appearance", "")[:200],
                "current_goal": character.get("desires", {}).get("current_goal", ""),
                "emotional_state": emotional_state,
            },
            "needs": character.get("needs", {}),
            "schedule": schedule_context,
            "relationships": relationships,
            "memories": memories,
            "present_npcs": [
                {"name": n.get("name", ""), "role": n.get("role", ""), "mood": self._extract_emotional_state(n)}
                for n in present[:6]
            ],
            "active_secrets": known_secrets,
            "recent_events": [self._compact_event(e) for e in events[:10]],
            "current_conflict": current_conflict,
            "inventory_summary": inventory_summary,
            "world_state": self._compact_world_state(world_state),
            "user": self._compact_user(user_character),
            "assembled_at": time.time(),
        }
        return self._trim_to_budget(pack)

    def pack_for_rp(
        self,
        *,
        character: dict[str, Any],
        location: str = "",
        present_npcs: list[dict[str, Any]] | None = None,
        active_secrets: list[dict[str, Any]] | None = None,
        recent_events: list[dict[str, Any]] | None = None,
        current_conflict: dict[str, Any] | None = None,
        world_state: dict[str, Any] | None = None,
        user_character: dict[str, Any] | None = None,
    ) -> str:
        pack = self.pack(
            character=character,
            location=location,
            present_npcs=present_npcs,
            active_secrets=active_secrets,
            recent_events=recent_events,
            current_conflict=current_conflict,
            world_state=world_state,
            user_character=user_character,
        )
        return self._format_context_text(pack)

    def _select_relevant_memories(
        self,
        memories: list[dict[str, Any]],
        location: str,
        present_npcs: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        if not memories:
            return []
        present_names = {str(n.get("name") or "").lower() for n in present_npcs}
        location_lower = location.lower()
        scored: list[tuple[float, dict[str, Any]]] = []
        for mem in memories:
            score = float(mem.get("importance", 0.5))
            text = str(mem.get("text") or "").lower()
            tags = [str(t).lower() for t in mem.get("tags", [])]
            if location_lower and location_lower in text:
                score += 0.3
            for name in present_names:
                if name and name in text:
                    score += 0.2
                    break
            for tag in tags:
                if tag in present_names or tag == location_lower:
                    score += 0.15
                    break
            scored.append((score, mem))
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [
            {"text": mem.get("text", ""), "kind": mem.get("kind", ""), "importance": round(mem.get("importance", 0.5), 2)}
            for _, mem in scored[:self._max_memories]
        ]

    def _select_relevant_relationships(
        self,
        relationships: dict[str, Any],
        present_names: list[str],
    ) -> list[dict[str, Any]]:
        present_set = {n.lower() for n in present_names if n}
        result: list[dict[str, Any]] = []
        for name, rel in relationships.items():
            if not isinstance(rel, dict):
                continue
            entry = {
                "name": name,
                "affinity": round(float(rel.get("affinity", 50)), 1),
                "trust": round(float(rel.get("trust", 50)), 1),
                "suspicion": round(float(rel.get("suspicion", 0)), 1),
                "romance": round(float(rel.get("romance", 0)), 1),
                "rivalry": round(float(rel.get("rivalry", 0)), 1),
            }
            priority = 0
            if name.lower() in present_set:
                priority += 10
            priority += abs(float(rel.get("affinity", 50)) - 50) / 50
            priority += float(rel.get("suspicion", 0)) / 100
            priority += float(rel.get("romance", 0)) / 100
            entry["_priority"] = priority
            result.append(entry)
        result.sort(key=lambda r: r.get("_priority", 0), reverse=True)
        trimmed = result[:self._max_relationships]
        for r in trimmed:
            r.pop("_priority", None)
        return trimmed

    def _extract_emotional_state(self, character: dict[str, Any]) -> dict[str, Any]:
        runtime = character.get("runtime") if isinstance(character.get("runtime"), dict) else {}
        states = runtime.get("states") if isinstance(runtime.get("states"), dict) else {}
        mood = str(character.get("profile", {}).get("current_mood") or character.get("current_mood") or "neutral")
        mood_tags = character.get("mood_tags") if isinstance(character.get("mood_tags"), list) else []
        return {
            "mood": mood,
            "mood_tags": [str(t) for t in mood_tags[:8]],
            "active_states": {
                k: round(float(v), 1)
                for k, v in states.items()
                if isinstance(v, (int, float)) and abs(float(v)) > 1.0
            },
        }

    def _current_schedule_context(self, character: dict[str, Any]) -> dict[str, Any]:
        schedule = character.get("schedule") if isinstance(character.get("schedule"), list) else []
        from datetime import datetime
        hour = datetime.now().hour
        current_slot = None
        for slot in schedule:
            start = int(slot.get("start", 0))
            end = int(slot.get("end", 24))
            if start <= hour < end:
                current_slot = slot
                break
        return {
            "current_activity": current_slot.get("activity", "") if current_slot else "",
            "current_location": current_slot.get("location", "") if current_slot else "",
            "next_activity": "",
        }

    def _summarize_inventory(self, character: dict[str, Any]) -> list[dict[str, Any]]:
        inventory = character.get("inventory") if isinstance(character.get("inventory"), list) else []
        summary: list[dict[str, Any]] = []
        for item in inventory[:12]:
            if isinstance(item, dict):
                summary.append({
                    "name": item.get("name", ""),
                    "category": item.get("category", ""),
                    "quantity": item.get("quantity", 1),
                })
            elif isinstance(item, str):
                summary.append({"name": item, "category": "", "quantity": 1})
        return summary

    def _filter_character_secrets(
        self,
        secrets: list[dict[str, Any]],
        character_name: str,
    ) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for secret in secrets:
            if not isinstance(secret, dict):
                continue
            known_by = [str(k).lower() for k in secret.get("known_by", [])]
            suspected_by = [str(k).lower() for k in secret.get("suspected_by", [])]
            name_lower = character_name.lower()
            if name_lower in known_by or name_lower in suspected_by:
                result.append({
                    "id": secret.get("id", ""),
                    "summary": secret.get("text", secret.get("title", ""))[:200],
                    "visibility": secret.get("visibility", "private"),
                    "character_knows": name_lower in known_by,
                })
        return result[:8]

    def _compact_event(self, event: dict[str, Any]) -> dict[str, Any]:
        return {
            "type": event.get("type", ""),
            "actor": event.get("actor", ""),
            "location": event.get("location", ""),
            "ts": event.get("ts", ""),
        }

    def _compact_world_state(self, world_state: dict[str, Any] | None) -> dict[str, Any]:
        if not world_state or not isinstance(world_state, dict):
            return {}
        return {
            "time_of_day": world_state.get("time_of_day", ""),
            "weather": world_state.get("weather", ""),
            "active_conflicts": len(world_state.get("active_conflicts", [])),
            "faction_tensions": world_state.get("faction_tensions", {}),
        }

    def _compact_user(self, user_character: dict[str, Any] | None) -> dict[str, Any]:
        if not user_character or not isinstance(user_character, dict):
            return {}
        profile = user_character.get("profile", {}) if isinstance(user_character.get("profile"), dict) else {}
        return {
            "name": user_character.get("name", "User"),
            "location": user_character.get("location", ""),
            "appearance": profile.get("appearance", "")[:150],
        }

    def _trim_to_budget(self, pack: dict[str, Any]) -> dict[str, Any]:
        serialized = json.dumps(pack, ensure_ascii=False, separators=(",", ":"))
        estimated_tokens = len(serialized) // 4
        if estimated_tokens <= self._max_tokens:
            return pack
        trimmed = dict(pack)
        if len(trimmed.get("memories", [])) > 3:
            trimmed["memories"] = trimmed["memories"][:3]
        if len(trimmed.get("relationships", [])) > 6:
            trimmed["relationships"] = trimmed["relationships"][:6]
        if len(trimmed.get("recent_events", [])) > 5:
            trimmed["recent_events"] = trimmed["recent_events"][:5]
        if len(trimmed.get("active_secrets", [])) > 4:
            trimmed["active_secrets"] = trimmed["active_secrets"][:4]
        return trimmed

    def _format_context_text(self, pack: dict[str, Any]) -> str:
        lines: list[str] = []
        char = pack.get("character", {})
        lines.append(f"[Character: {char.get('name', '')} | Role: {char.get('role', '')} | Location: {char.get('location', '')}]")
        if char.get("personality"):
            lines.append(f"Personality: {char['personality']}")
        if char.get("bio"):
            lines.append(f"Bio: {char['bio']}")
        emotional = pack.get("character", {}).get("emotional_state", {})
        if emotional.get("mood") and emotional["mood"] != "neutral":
            lines.append(f"Mood: {emotional['mood']}")
        if emotional.get("active_states"):
            states_str = ", ".join(f"{k}={v}" for k, v in emotional["active_states"].items())
            lines.append(f"Emotional states: {states_str}")
        needs = pack.get("needs", {})
        if needs:
            needs_str = ", ".join(f"{k}={v:.2f}" for k, v in needs.items())
            lines.append(f"Needs: {needs_str}")
        if char.get("current_goal"):
            lines.append(f"Current goal: {char['current_goal']}")
        schedule = pack.get("schedule", {})
        if schedule.get("current_activity"):
            lines.append(f"Currently: {schedule['current_activity']} at {schedule.get('current_location', '')}")
        rels = pack.get("relationships", [])
        if rels:
            lines.append("Relationships:")
            for r in rels[:6]:
                lines.append(f"  - {r['name']}: affinity={r['affinity']}, trust={r['trust']}, suspicion={r['suspicion']}")
        memories = pack.get("memories", [])
        if memories:
            lines.append("Relevant memories:")
            for m in memories[:5]:
                lines.append(f"  - [{m.get('kind', '')}] {m['text']}")
        present = pack.get("present_npcs", [])
        if present:
            names = ", ".join(n.get("name", "") for n in present)
            lines.append(f"Present: {names}")
        secrets = pack.get("active_secrets", [])
        if secrets:
            lines.append("Secrets this character knows or suspects:")
            for s in secrets[:4]:
                knows = "knows" if s.get("character_knows") else "suspects"
                lines.append(f"  - {knows}: {s['summary']}")
        events = pack.get("recent_events", [])
        if events:
            lines.append("Recent events:")
            for e in events[:5]:
                lines.append(f"  - {e.get('type', '')}: {e.get('actor', '')} at {e.get('location', '')}")
        conflict = pack.get("current_conflict")
        if conflict:
            lines.append(f"Active conflict: {conflict}")
        user = pack.get("user", {})
        if user:
            lines.append(f"User: {user.get('name', 'User')} at {user.get('location', '')}")
        return "\n".join(lines)


_packer: ContextPacker | None = None


def get_context_packer() -> ContextPacker:
    global _packer
    if _packer is None:
        _packer = ContextPacker()
    return _packer
