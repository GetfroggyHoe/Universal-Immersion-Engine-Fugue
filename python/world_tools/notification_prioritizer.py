from __future__ import annotations

from typing import Any


class Notification:
    __slots__ = ("id", "category", "priority", "title", "body", "source", "timestamp", "delivered", "read")

    def __init__(self, data: dict[str, Any]) -> None:
        self.id = str(data.get("id") or "")
        self.category = str(data.get("category") or "general")
        self.priority = str(data.get("priority") or "normal")
        self.title = str(data.get("title") or "")
        self.body = str(data.get("body") or "")
        self.source = str(data.get("source") or "")
        self.timestamp = float(data.get("timestamp") or 0)
        self.delivered = bool(data.get("delivered") or False)
        self.read = bool(data.get("read") or False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "category": self.category,
            "priority": self.priority,
            "title": self.title,
            "body": self.body,
            "source": self.source,
            "timestamp": self.timestamp,
            "delivered": self.delivered,
            "read": self.read,
        }


_PRIORITY_ORDER = {"critical": 0, "high": 1, "normal": 2, "low": 3, "silent": 4}

_PRIORITY_MAP = {
    "companion_injured": "critical",
    "companion_dead": "critical",
    "faction_war": "critical",
    "important_message": "high",
    "lover_message": "high",
    "quest_update": "high",
    "secret_revealed": "high",
    "relationship_change": "normal",
    "rumor_spread": "low",
    "shop_stock_change": "silent",
    "weather_change": "silent",
    "npc_moved": "silent",
    "schedule_change": "silent",
}


class NotificationPrioritizer:

    def prioritize(self, event: dict[str, Any]) -> Notification:
        event_type = str(event.get("type") or event.get("event_type") or "")
        category = str(event.get("category") or self._infer_category(event_type))
        priority = self._determine_priority(event_type, event)
        title = str(event.get("title") or self._generate_title(event_type, event))
        body = str(event.get("body") or event.get("text") or event.get("description") or "")[:300]
        import time
        return Notification({
            "id": str(event.get("id") or f"notif_{int(time.time() * 1000)}"),
            "category": category,
            "priority": priority,
            "title": title[:120],
            "body": body,
            "source": str(event.get("source") or event.get("actor") or ""),
            "timestamp": float(event.get("timestamp") or event.get("ts") or time.time()),
        })

    def should_interrupt(self, notification: Notification) -> bool:
        return notification.priority in ("critical", "high")

    def should_show_in_feed(self, notification: Notification) -> bool:
        return notification.priority in ("critical", "high", "normal")

    def should_silence(self, notification: Notification) -> bool:
        return notification.priority in ("silent",)

    def sort_by_priority(self, notifications: list[Notification]) -> list[Notification]:
        return sorted(notifications, key=lambda n: _PRIORITY_ORDER.get(n.priority, 2))

    def filter_for_display(self, notifications: list[Notification], *, include_silent: bool = False) -> list[Notification]:
        if include_silent:
            return self.sort_by_priority(notifications)
        return self.sort_by_priority([n for n in notifications if not self.should_silence(n)])

    def batch_prioritize(self, events: list[dict[str, Any]]) -> list[Notification]:
        notifications = [self.prioritize(e) for e in events]
        return self.sort_by_priority(notifications)

    def _determine_priority(self, event_type: str, event: dict[str, Any]) -> str:
        explicit = _PRIORITY_MAP.get(event_type)
        if explicit:
            return explicit
        if event.get("priority"):
            p = str(event["priority"]).lower()
            if p in _PRIORITY_ORDER:
                return p
        emotional_weight = float(event.get("emotional_weight") or 0)
        if emotional_weight >= 0.8:
            return "high"
        if emotional_weight >= 0.5:
            return "normal"
        importance = float(event.get("importance") or 0)
        if importance >= 0.8:
            return "high"
        if importance >= 0.5:
            return "normal"
        if importance >= 0.2:
            return "low"
        return "silent"

    def _infer_category(self, event_type: str) -> str:
        if any(w in event_type for w in ("combat", "injury", "death", "battle")):
            return "combat"
        if any(w in event_type for w in ("romance", "relationship", "affinity")):
            return "relationships"
        if any(w in event_type for w in ("message", "phone", "sms", "call")):
            return "communication"
        if any(w in event_type for w in ("quest", "mission", "objective")):
            return "quests"
        if any(w in event_type for w in ("secret", "reveal", "intel")):
            return "secrets"
        if any(w in event_type for w in ("faction", "organization", "war")):
            return "factions"
        if any(w in event_type for w in ("movement", "schedule", "tick")):
            return "world"
        if any(w in event_type for w in ("item", "inventory", "trade")):
            return "inventory"
        return "general"

    def _generate_title(self, event_type: str, event: dict[str, Any]) -> str:
        actor = str(event.get("actor") or event.get("source") or "")
        target = str(event.get("target") or "")
        location = str(event.get("location") or "")
        if "injury" in event_type or "death" in event_type:
            return f"{actor or 'Someone'} was {'killed' if 'death' in event_type else 'injured'}"
        if "message" in event_type:
            return f"New message from {actor}" if actor else "New message"
        if "quest" in event_type:
            return f"Quest update: {target or event_type}"
        if "secret" in event_type:
            return f"Secret {'revealed' if 'reveal' in event_type else 'discovered'}"
        if "relationship" in event_type:
            return f"Relationship changed: {actor} & {target}" if actor and target else "Relationship changed"
        if "faction" in event_type:
            return f"Faction event: {actor or target or event_type}"
        if "movement" in event_type:
            return f"{actor or 'Someone'} moved to {location}" if location else f"{actor or 'Someone'} moved"
        return f"World event: {event_type}" if event_type else "World event"


_prioritizer: NotificationPrioritizer | None = None


def get_notification_prioritizer() -> NotificationPrioritizer:
    global _prioritizer
    if _prioritizer is None:
        _prioritizer = NotificationPrioritizer()
    return _prioritizer
