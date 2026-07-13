from __future__ import annotations

import re
from typing import Any


class ContinuityViolation:
    __slots__ = ("rule", "severity", "message", "entity", "details")

    def __init__(self, rule: str, severity: str, message: str, entity: str = "", details: dict[str, Any] | None = None) -> None:
        self.rule = rule
        self.severity = severity
        self.message = message
        self.entity = entity
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "rule": self.rule,
            "severity": self.severity,
            "message": self.message,
            "entity": self.entity,
            "details": self.details,
        }


class ContinuityChecker:

    def check(
        self,
        output: dict[str, Any],
        *,
        characters: dict[str, dict[str, Any]],
        locations: dict[str, dict[str, Any]],
        world_state: dict[str, Any],
        active_secrets: list[dict[str, Any]] | None = None,
    ) -> list[ContinuityViolation]:
        violations: list[ContinuityViolation] = []
        violations.extend(self._check_character_presence(output, characters))
        violations.extend(self._check_character_alive(output, characters))
        violations.extend(self._check_location_validity(output, locations))
        violations.extend(self._check_secret_knowledge(output, active_secrets or [], characters))
        violations.extend(self._check_relationship_state(output, characters))
        violations.extend(self._check_inventory_consistency(output, characters))
        violations.extend(self._check_timestamp_consistency(output, world_state))
        violations.extend(self._check_location_destruction(output, locations))
        violations.sort(key=lambda v: {"critical": 0, "major": 1, "minor": 2}.get(v.severity, 3))
        return violations

    def check_text(self, text: str, **kwargs: Any) -> list[ContinuityViolation]:
        return self.check({"text": text, "dialogue": text}, **kwargs)

    def is_clean(self, violations: list[ContinuityViolation], max_severity: str = "major") -> bool:
        severity_order = {"critical": 0, "major": 1, "minor": 2, "info": 3}
        threshold = severity_order.get(max_severity, 1)
        return all(severity_order.get(v.severity, 3) > threshold for v in violations)

    def _check_character_presence(
        self,
        output: dict[str, Any],
        characters: dict[str, dict[str, Any]],
    ) -> list[ContinuityViolation]:
        violations: list[ContinuityViolation] = []
        text = self._get_text(output)
        scene_location = str(output.get("location") or "").strip().lower()
        for name, char in characters.items():
            char_location = str(char.get("location") or "").strip().lower()
            if not name or not char_location:
                continue
            if self._mentions_character(text, name) and scene_location and char_location != scene_location:
                if not output.get("allows_travel"):
                    violations.append(ContinuityViolation(
                        rule="character_not_present",
                        severity="major",
                        message=f"{name} is at {char.get('location', 'unknown')}, not at the scene location",
                        entity=name,
                        details={"expected_location": char.get("location", ""), "scene_location": scene_location},
                    ))
        return violations

    def _check_character_alive(
        self,
        output: dict[str, Any],
        characters: dict[str, dict[str, Any]],
    ) -> list[ContinuityViolation]:
        violations: list[ContinuityViolation] = []
        text = self._get_text(output)
        for name, char in characters.items():
            if not name:
                continue
            profile = char.get("profile", {}) if isinstance(char.get("profile"), dict) else {}
            is_dead = bool(profile.get("is_dead") or profile.get("dead") or char.get("status") == "dead")
            if is_dead and self._mentions_character(text, name):
                dialogue = str(output.get("dialogue") or "")
                if self._character_speaks(dialogue, name) or self._character_acts(text, name):
                    violations.append(ContinuityViolation(
                        rule="dead_character_active",
                        severity="critical",
                        message=f"{name} is dead but appears to be acting or speaking",
                        entity=name,
                    ))
        return violations

    def _check_location_validity(
        self,
        output: dict[str, Any],
        locations: dict[str, dict[str, Any]],
    ) -> list[ContinuityViolation]:
        violations: list[ContinuityViolation] = []
        mentioned_location = str(output.get("location") or "").strip()
        if not mentioned_location or not locations:
            return violations
        known_names = {str(loc.get("name") or "").lower() for loc in locations.values()}
        if mentioned_location.lower() not in known_names and known_names:
            violations.append(ContinuityViolation(
                rule="unknown_location",
                severity="minor",
                message=f"Location '{mentioned_location}' is not in the known locations database",
                details={"mentioned": mentioned_location, "known_count": len(known_names)},
            ))
        return violations

    def _check_secret_knowledge(
        self,
        output: dict[str, Any],
        secrets: list[dict[str, Any]],
        characters: dict[str, dict[str, Any]],
    ) -> list[ContinuityViolation]:
        violations: list[ContinuityViolation] = []
        text = self._get_text(output)
        if not text or not secrets:
            return violations
        speaker = str(output.get("speaker") or output.get("actor") or "")
        if not speaker:
            return violations
        speaker_lower = speaker.lower()
        for secret in secrets:
            secret_text = str(secret.get("text") or "").lower()
            if not secret_text:
                continue
            known_by = {str(n).lower() for n in secret.get("known_by", [])}
            if speaker_lower in known_by:
                continue
            keywords = [w for w in secret_text.split() if len(w) > 4]
            matched = sum(1 for kw in keywords if kw in text.lower())
            if matched >= min(3, len(keywords)):
                violations.append(ContinuityViolation(
                    rule="secret_knowledge_leak",
                    severity="critical",
                    message=f"{speaker} references secret information they should not know",
                    entity=speaker,
                    details={"secret_id": secret.get("id", ""), "matched_keywords": matched},
                ))
        return violations

    def _check_relationship_state(
        self,
        output: dict[str, Any],
        characters: dict[str, dict[str, Any]],
    ) -> list[ContinuityViolation]:
        violations: list[ContinuityViolation] = []
        text = self._get_text(output).lower()
        actor = str(output.get("actor") or "").strip()
        if not actor:
            return violations
        actor_lower = actor.lower()
        char = characters.get(actor) or characters.get(actor.title())
        if not char:
            return violations
        relationships = char.get("relationships", {}) if isinstance(char.get("relationships"), dict) else {}
        for other_name, rel in relationships.items():
            if not isinstance(rel, dict):
                continue
            romance = float(rel.get("romance", 0))
            if any(w in text for w in ("married to", "wedding", "spouse")) and other_name.lower() in text:
                if romance < 60:
                    violations.append(ContinuityViolation(
                        rule="relationship_inconsistency",
                        severity="major",
                        message=f"{actor} and {other_name} are referenced as married but romance level is only {romance}",
                        entity=actor,
                        details={"other": other_name, "romance": romance},
                    ))
        return violations

    def _check_inventory_consistency(
        self,
        output: dict[str, Any],
        characters: dict[str, dict[str, Any]],
    ) -> list[ContinuityViolation]:
        violations: list[ContinuityViolation] = []
        text = self._get_text(output).lower()
        actor = str(output.get("actor") or "").strip()
        if not actor:
            return violations
        char = characters.get(actor) or characters.get(actor.title())
        if not char:
            return violations
        inventory = char.get("inventory") if isinstance(char.get("inventory"), list) else []
        inventory_names = set()
        for item in inventory:
            if isinstance(item, dict):
                inventory_names.add(str(item.get("name") or "").lower())
            elif isinstance(item, str):
                inventory_names.add(item.lower())
        if not inventory_names:
            return violations
        weapon_patterns = ["drew their", "pulled out", "unsheathed", "grabbed their", "wielded"]
        for pattern in weapon_patterns:
            if pattern in text:
                idx = text.index(pattern) + len(pattern)
                snippet = text[idx:idx + 40].strip()
                for item_name in inventory_names:
                    if item_name and item_name in snippet:
                        return violations
                if snippet and not any(item_name in snippet for item_name in inventory_names if item_name):
                    pass
        return violations

    def _check_timestamp_consistency(
        self,
        output: dict[str, Any],
        world_state: dict[str, Any],
    ) -> list[ContinuityViolation]:
        violations: list[ContinuityViolation] = []
        text = self._get_text(output).lower()
        time_of_day = str(world_state.get("time_of_day") or "").lower()
        if "sunrise" in text and time_of_day in ("night", "midnight", "evening"):
            violations.append(ContinuityViolation(
                rule="time_contradiction",
                severity="major",
                message=f"Text mentions sunrise but world time is {time_of_day}",
            ))
        if "midnight" in text and time_of_day in ("morning", "noon", "afternoon"):
            violations.append(ContinuityViolation(
                rule="time_contradiction",
                severity="major",
                message=f"Text mentions midnight but world time is {time_of_day}",
            ))
        return violations

    def _check_location_destruction(
        self,
        output: dict[str, Any],
        locations: dict[str, dict[str, Any]],
    ) -> list[ContinuityViolation]:
        violations: list[ContinuityViolation] = []
        text = self._get_text(output).lower()
        for loc_id, loc in locations.items():
            if not isinstance(loc, dict):
                continue
            payload = loc.get("payload") if isinstance(loc.get("payload"), dict) else {}
            if payload.get("destroyed") or payload.get("state") == "destroyed":
                loc_name = str(loc.get("name") or loc_id).lower()
                if loc_name and loc_name in text:
                    if not any(w in text for w in ("ruins", "remains", "rubble", "destroyed", "wreckage")):
                        violations.append(ContinuityViolation(
                            rule="destroyed_location_active",
                            severity="major",
                            message=f"{loc.get('name', loc_id)} is destroyed but referenced as intact",
                            entity=str(loc.get("name", loc_id)),
                        ))
        return violations

    def _get_text(self, output: dict[str, Any]) -> str:
        parts = []
        for key in ("text", "dialogue", "narration", "body", "content"):
            val = output.get(key)
            if isinstance(val, str):
                parts.append(val)
        return " ".join(parts)

    def _mentions_character(self, text: str, name: str) -> bool:
        if not name or not text:
            return False
        pattern = re.compile(rf"\b{re.escape(name)}\b", re.I)
        return bool(pattern.search(text))

    def _character_speaks(self, dialogue: str, name: str) -> bool:
        if not dialogue or not name:
            return False
        pattern = re.compile(rf"(?:^|\n)\s*{re.escape(name)}\s*[:\"]", re.I)
        return bool(pattern.search(dialogue))

    def _character_acts(self, text: str, name: str) -> bool:
        if not text or not name:
            return False
        pattern = re.compile(rf"{re.escape(name)}\s+(?:says?|asks?|replies?|walks?|moves?|draws?|attacks?|casts?)\b", re.I)
        return bool(pattern.search(text))


_checker: ContinuityChecker | None = None


def get_continuity_checker() -> ContinuityChecker:
    global _checker
    if _checker is None:
        _checker = ContinuityChecker()
    return _checker
