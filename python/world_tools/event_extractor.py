from __future__ import annotations

import re
from typing import Any


class ExtractedEvent:
    __slots__ = ("event_type", "actor", "target", "details", "confidence")

    def __init__(self, event_type: str, actor: str = "", target: str = "", details: dict[str, Any] | None = None, confidence: float = 0.7) -> None:
        self.event_type = event_type
        self.actor = actor
        self.target = target
        self.details = details or {}
        self.confidence = confidence

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_type": self.event_type,
            "actor": self.actor,
            "target": self.target,
            "details": self.details,
            "confidence": round(self.confidence, 2),
        }


class EventExtractor:

    _ITEM_PATTERNS = [
        re.compile(r"(\w+)\s+(?:gained?|received?|picked\s+up|found|obtained|looted)\s+(?:a\s+)?(.+?)(?:\.|,|$)", re.I),
        re.compile(r"(\w+)\s+(?:lost|dropped|gave\s+away|discarded|sold)\s+(?:a\s+)?(.+?)(?:\.|,|$)", re.I),
    ]
    _MOVEMENT_PATTERNS = [
        re.compile(r"(\w+)\s+(?:entered|arrived\s+at|came\s+to|reached)\s+(.+?)(?:\.|,|$)", re.I),
        re.compile(r"(\w+)\s+(?:left|departed|exited|went\s+to|headed\s+to)\s+(.+?)(?:\.|,|$)", re.I),
    ]
    _RELATIONSHIP_PATTERNS = [
        re.compile(r"(\w+)\s+(?:kissed|hugged|embraced|held)\s+(\w+)", re.I),
        re.compile(r"(\w+)\s+(?:insulted|slapped|hit|attacked|betrayed)\s+(\w+)", re.I),
        re.compile(r"(\w+)\s+(?:defended|helped|saved|protected)\s+(\w+)", re.I),
    ]
    _INJURY_PATTERNS = [
        re.compile(r"(\w+)\s+(?:was|is|got)\s+(?:injured|wounded|hurt|bleeding|burned)", re.I),
        re.compile(r"(\w+)\s+(?:took|suffered|received)\s+(?:a\s+)?(?:deep\s+)?(?:wound|injury|cut|burn)", re.I),
    ]
    _SECRET_PATTERNS = [
        re.compile(r"(\w+)\s+(?:revealed|confessed|admitted|disclosed)\s+(?:that\s+)?(.+?)(?:\.|,|$)", re.I),
        re.compile(r"(\w+)\s+(?:learned|discovered|found\s+out)\s+(?:that\s+)?(.+?)(?:\.|,|$)", re.I),
    ]
    _PROMISE_PATTERNS = [
        re.compile(r"(\w+)\s+(?:promised|swore|vowed|pledged)\s+(?:to\s+)?(.+?)(?:\.|,|$)", re.I),
    ]
    _COMBAT_PATTERNS = [
        re.compile(r"(?:battle|combat|fight|duel|skirmish)\s+(?:began|started|erupted|broke\s+out)", re.I),
        re.compile(r"(\w+)\s+(?:drew|pulled|unsheathed)\s+(?:their\s+)?(?:weapon|sword|blade|knife|gun)", re.I),
    ]

    def extract(self, text: str, *, context: dict[str, Any] | None = None) -> list[ExtractedEvent]:
        context = context or {}
        events: list[ExtractedEvent] = []
        events.extend(self._extract_item_changes(text))
        events.extend(self._extract_movements(text))
        events.extend(self._extract_relationship_changes(text))
        events.extend(self._extract_injuries(text))
        events.extend(self._extract_secrets(text))
        events.extend(self._extract_promises(text))
        events.extend(self._extract_combat(text))
        events.extend(self._extract_location_changes(text, context))
        deduped: dict[str, ExtractedEvent] = {}
        for event in events:
            key = f"{event.event_type}:{event.actor}:{event.target}"
            if key not in deduped or event.confidence > deduped[key].confidence:
                deduped[key] = event
        return list(deduped.values())

    def apply_to_state(self, events: list[ExtractedEvent], state: dict[str, Any]) -> dict[str, Any]:
        changes: dict[str, Any] = {
            "items_gained": [],
            "items_lost": [],
            "relationships_changed": [],
            "injuries": [],
            "secrets_revealed": [],
            "promises_made": [],
            "movements": [],
            "combat_started": False,
            "quests_advanced": [],
        }
        for event in events:
            if event.event_type == "item_gained":
                changes["items_gained"].append({"item": event.target, "actor": event.actor, **event.details})
            elif event.event_type == "item_lost":
                changes["items_lost"].append({"item": event.target, "actor": event.actor, **event.details})
            elif event.event_type in ("relationship_positive", "relationship_negative"):
                changes["relationships_changed"].append({
                    "actor": event.actor,
                    "target": event.target,
                    "type": event.event_type,
                    **event.details,
                })
            elif event.event_type == "injury":
                changes["injuries"].append({"character": event.actor, **event.details})
            elif event.event_type == "secret_revealed":
                changes["secrets_revealed"].append({"revealer": event.actor, "secret": event.target, **event.details})
            elif event.event_type == "promise":
                changes["promises_made"].append({"promiser": event.actor, "promise": event.target, **event.details})
            elif event.event_type == "movement":
                changes["movements"].append({"character": event.actor, "destination": event.target, **event.details})
            elif event.event_type == "combat_start":
                changes["combat_started"] = True
        return changes

    def _extract_item_changes(self, text: str) -> list[ExtractedEvent]:
        events: list[ExtractedEvent] = []
        for pattern in self._ITEM_PATTERNS:
            for match in pattern.finditer(text):
                actor = match.group(1).strip()
                item = match.group(2).strip()
                if not actor or not item:
                    continue
                verb = match.group(0).lower()
                if any(w in verb for w in ("gained", "received", "picked up", "found", "obtained", "looted")):
                    events.append(ExtractedEvent("item_gained", actor=actor, target=item, confidence=0.8))
                else:
                    events.append(ExtractedEvent("item_lost", actor=actor, target=item, confidence=0.8))
        return events

    def _extract_movements(self, text: str) -> list[ExtractedEvent]:
        events: list[ExtractedEvent] = []
        for pattern in self._MOVEMENT_PATTERNS:
            for match in pattern.finditer(text):
                actor = match.group(1).strip()
                location = match.group(2).strip()
                if not actor or not location:
                    continue
                verb = match.group(0).lower()
                if any(w in verb for w in ("entered", "arrived", "came to", "reached")):
                    events.append(ExtractedEvent("movement", actor=actor, target=location, details={"action": "arrive"}, confidence=0.75))
                else:
                    events.append(ExtractedEvent("movement", actor=actor, target=location, details={"action": "depart"}, confidence=0.75))
        return events

    def _extract_relationship_changes(self, text: str) -> list[ExtractedEvent]:
        events: list[ExtractedEvent] = []
        for pattern in self._RELATIONSHIP_PATTERNS:
            for match in pattern.finditer(text):
                actor = match.group(1).strip()
                target = match.group(2).strip()
                if not actor or not target:
                    continue
                verb = match.group(0).lower()
                if any(w in verb for w in ("kissed", "hugged", "embraced", "held", "defended", "helped", "saved", "protected")):
                    events.append(ExtractedEvent("relationship_positive", actor=actor, target=target, confidence=0.7))
                else:
                    events.append(ExtractedEvent("relationship_negative", actor=actor, target=target, confidence=0.7))
        return events

    def _extract_injuries(self, text: str) -> list[ExtractedEvent]:
        events: list[ExtractedEvent] = []
        for pattern in self._INJURY_PATTERNS:
            for match in pattern.finditer(text):
                actor = match.group(1).strip()
                if not actor:
                    continue
                events.append(ExtractedEvent("injury", actor=actor, confidence=0.75))
        return events

    def _extract_secrets(self, text: str) -> list[ExtractedEvent]:
        events: list[ExtractedEvent] = []
        for pattern in self._SECRET_PATTERNS:
            for match in pattern.finditer(text):
                actor = match.group(1).strip()
                secret = match.group(2).strip()
                if not actor or not secret:
                    continue
                events.append(ExtractedEvent("secret_revealed", actor=actor, target=secret[:200], confidence=0.65))
        return events

    def _extract_promises(self, text: str) -> list[ExtractedEvent]:
        events: list[ExtractedEvent] = []
        for pattern in self._PROMISE_PATTERNS:
            for match in pattern.finditer(text):
                actor = match.group(1).strip()
                promise = match.group(2).strip()
                if not actor or not promise:
                    continue
                events.append(ExtractedEvent("promise", actor=actor, target=promise[:200], confidence=0.7))
        return events

    def _extract_combat(self, text: str) -> list[ExtractedEvent]:
        events: list[ExtractedEvent] = []
        for pattern in self._COMBAT_PATTERNS:
            for match in pattern.finditer(text):
                groups = match.groups()
                actor = groups[0].strip() if groups and groups[0] else ""
                events.append(ExtractedEvent("combat_start", actor=actor, confidence=0.8))
                break
        return events

    def _extract_location_changes(self, text: str, context: dict[str, Any]) -> list[ExtractedEvent]:
        events: list[ExtractedEvent] = []
        new_location = str(context.get("new_location") or "").strip()
        character = str(context.get("character") or "").strip()
        if new_location and character:
            events.append(ExtractedEvent("movement", actor=character, target=new_location, details={"action": "move", "source": "context"}, confidence=0.9))
        return events


_extractor: EventExtractor | None = None


def get_event_extractor() -> EventExtractor:
    global _extractor
    if _extractor is None:
        _extractor = EventExtractor()
    return _extractor
