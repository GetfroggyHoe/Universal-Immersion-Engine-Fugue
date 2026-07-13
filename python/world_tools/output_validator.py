from __future__ import annotations

import json
import re
from typing import Any


class ValidationResult:
    __slots__ = ("valid", "errors", "warnings", "repaired", "original", "repaired_text")

    def __init__(
        self,
        valid: bool = True,
        errors: list[str] | None = None,
        warnings: list[str] | None = None,
        repaired: bool = False,
        original: str = "",
        repaired_text: str = "",
    ) -> None:
        self.valid = valid
        self.errors = errors or []
        self.warnings = warnings or []
        self.repaired = repaired
        self.original = original
        self.repaired_text = repaired_text

    def to_dict(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "errors": self.errors,
            "warnings": self.warnings,
            "repaired": self.repaired,
            "original_length": len(self.original),
            "repaired_text": self.repaired_text if self.repaired else "",
        }


class OutputValidator:

    _FORBIDDEN_PHRASES = [
        "as an ai", "i'm an ai", "as a language model", "i cannot", "i can't assist",
        "i don't have feelings", "i'm just a", "this is a simulation",
    ]

    _NPC_SPEAKS_FOR_PLAYER_RE = re.compile(
        r"\b(?:you say|you reply|you think|you feel|you decide|you walk|you move|your character)\b",
        re.I,
    )

    _JSON_WRAPPER_RE = re.compile(r"^```(?:json)?\s*\n?(.*?)\n?```$", re.S)

    def validate_json(self, text: str, required_fields: list[str] | None = None) -> ValidationResult:
        cleaned = self._strip_json_wrapper(text)
        errors: list[str] = []
        warnings: list[str] = []
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            repaired = self._try_repair_json(cleaned)
            if repaired is not None:
                if required_fields:
                    missing = [f for f in required_fields if f not in repaired]
                    if missing:
                        errors.append(f"Missing required fields after repair: {missing}")
                        return ValidationResult(False, errors, warnings, True, text, json.dumps(repaired))
                return ValidationResult(True, [], ["JSON was repaired"], True, text, json.dumps(repaired))
            errors.append(f"Invalid JSON: {exc}")
            return ValidationResult(False, errors, warnings, False, text, "")
        if not isinstance(data, dict):
            warnings.append("JSON root is not an object")
        if required_fields:
            missing = [f for f in required_fields if f not in data]
            if missing:
                errors.append(f"Missing required fields: {missing}")
        return ValidationResult(len(errors) == 0, errors, warnings, False, text, cleaned)

    def validate_rp_output(
        self,
        text: str,
        *,
        player_name: str = "User",
        active_npcs: list[str] | None = None,
        forbidden_phrases: list[str] | None = None,
    ) -> ValidationResult:
        errors: list[str] = []
        warnings: list[str] = []
        repaired_text = text
        repaired = False
        forbidden = forbidden_phrases or self._FORBIDDEN_PHRASES
        for phrase in forbidden:
            if phrase in text.lower():
                errors.append(f"Forbidden phrase detected: '{phrase}'")
                repaired_text = repaired_text.replace(phrase, "").replace(phrase.title(), "")
                repaired = True
        if self._NPC_SPEAKS_FOR_PLAYER_RE.search(text):
            pattern = self._NPC_SPEAKS_FOR_PLAYER_RE
            if player_name != "User":
                player_pattern = re.compile(
                    rf"\b(?:{re.escape(player_name)}\s+(?:says?|replies?|thinks?|feels?|decides?|walks?|moves?))\b",
                    re.I,
                )
                if player_pattern.search(text):
                    errors.append(f"NPC appears to be speaking or acting for the player ({player_name})")
            else:
                errors.append("NPC appears to be speaking or acting for the player")
        if active_npcs:
            dialogue_speakers = self._extract_speakers(text)
            for speaker in dialogue_speakers:
                if speaker.lower() not in {n.lower() for n in active_npcs} and speaker.lower() != player_name.lower():
                    if speaker.lower() not in ("narrator", "system", ""):
                        warnings.append(f"Unknown speaker in dialogue: {speaker}")
        duplicate_dialogue = self._detect_duplicate_dialogue(text)
        if duplicate_dialogue:
            warnings.append(f"Duplicate dialogue detected: '{duplicate_dialogue[:50]}...'")
        repaired_text = self._clean_whitespace(repaired_text)
        return ValidationResult(
            valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            repaired=repaired,
            original=text,
            repaired_text=repaired_text if repaired else text,
        )

    def should_retry(self, result: ValidationResult) -> bool:
        return not result.valid and any("forbidden" in e.lower() or "speaking" in e.lower() or "player" in e.lower() for e in result.errors)

    def should_repair(self, result: ValidationResult) -> bool:
        return result.repaired or any("repaired" in w.lower() for w in result.warnings)

    def _strip_json_wrapper(self, text: str) -> str:
        cleaned = text.strip()
        match = self._JSON_WRAPPER_RE.match(cleaned)
        if match:
            return match.group(1).strip()
        return cleaned

    def _try_repair_json(self, text: str) -> dict[str, Any] | None:
        cleaned = text.strip()
        if not cleaned.startswith("{"):
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start >= 0 and end > start:
                cleaned = cleaned[start:end + 1]
            else:
                return None
        cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
        cleaned = re.sub(r"([{,])\s*([a-zA-Z_]\w*)\s*:", r'\1"\2":', cleaned)
        cleaned = re.sub(r':\s*([a-zA-Z_]\w*)(?=\s*[,}\n])', r': "\1"', cleaned)
        try:
            result = json.loads(cleaned)
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass
        return None

    def _extract_speakers(self, text: str) -> list[str]:
        speakers: list[str] = []
        pattern = re.compile(r'^(["\']?)([^"\'\n:]{1,40})\1\s*:\s*', re.M)
        for match in pattern.finditer(text):
            speaker = match.group(2).strip()
            if speaker and len(speaker) > 1:
                speakers.append(speaker)
        return speakers

    def _detect_duplicate_dialogue(self, text: str) -> str:
        dialogue_lines = [
            line.strip()
            for line in text.split("\n")
            if re.match(r'^["\'].*["\']$', line.strip()) or ":" in line
        ]
        seen: dict[str, int] = {}
        for line in dialogue_lines:
            normalized = line.strip().lower()
            if len(normalized) > 10:
                seen[normalized] = seen.get(normalized, 0) + 1
        for line, count in seen.items():
            if count >= 3:
                return line
        return ""

    def _clean_whitespace(self, text: str) -> str:
        text = re.sub(r" {2,}", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()


_validator: OutputValidator | None = None


def get_output_validator() -> OutputValidator:
    global _validator
    if _validator is None:
        _validator = OutputValidator()
    return _validator
