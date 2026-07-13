from __future__ import annotations

import logging
import time
from typing import Any

from .cache_manager import get_cache_manager
from .continuity_checker import get_continuity_checker
from .context_packer import get_context_packer
from .entity_dedup import get_entity_deduplicator
from .entity_normalizer import get_entity_normalizer
from .event_extractor import get_event_extractor
from .fallback_manager import get_fallback_manager
from .importance_scorer import get_importance_scorer
from .memory_compressor import get_memory_compressor
from .notification_prioritizer import get_notification_prioritizer
from .output_validator import get_output_validator
from .prompt_compiler import get_prompt_compiler
from .resource_governor import get_resource_governor
from .rumor_engine import get_rumor_engine
from .secret_router import get_secret_router

log = logging.getLogger("world_tools.pipeline")


class PipelineResult:
    __slots__ = ("success", "stage", "data", "violations", "extracted_events", "notifications", "errors", "elapsed_ms", "tools_used")

    def __init__(self, data: dict[str, Any]) -> None:
        self.success = bool(data.get("success", True))
        self.stage = str(data.get("stage") or "complete")
        self.data = data.get("data", {})
        self.violations = data.get("violations", [])
        self.extracted_events = data.get("extracted_events", [])
        self.notifications = data.get("notifications", [])
        self.errors = data.get("errors", [])
        self.elapsed_ms = float(data.get("elapsed_ms") or 0)
        self.tools_used = data.get("tools_used", [])

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "stage": self.stage,
            "data": self.data,
            "violations": [v.to_dict() if hasattr(v, "to_dict") else v for v in self.violations],
            "extracted_events": [e.to_dict() if hasattr(e, "to_dict") else e for e in self.extracted_events],
            "notifications": [n.to_dict() if hasattr(n, "to_dict") else n for n in self.notifications],
            "errors": self.errors,
            "elapsed_ms": round(self.elapsed_ms, 1),
            "tools_used": self.tools_used,
        }


class WorldPipeline:

    def process_llm_output(
        self,
        text: str,
        *,
        character: dict[str, Any],
        characters: dict[str, dict[str, Any]],
        locations: dict[str, dict[str, Any]],
        world_state: dict[str, Any],
        active_secrets: list[dict[str, Any]] | None = None,
        player_name: str = "User",
        active_npcs: list[str] | None = None,
    ) -> PipelineResult:
        start = time.time()
        tools_used: list[str] = []
        errors: list[str] = []

        validator = get_output_validator()
        validation = validator.validate_rp_output(text, player_name=player_name, active_npcs=active_npcs)
        tools_used.append("output_validator")
        if validation.repaired:
            text = validation.repaired_text
        if not validation.valid and validator.should_retry(validation):
            return PipelineResult({
                "success": False,
                "stage": "validation",
                "errors": validation.errors,
                "tools_used": tools_used,
                "elapsed_ms": (time.time() - start) * 1000,
                "data": {"validation": validation.to_dict()},
            })

        checker = get_continuity_checker()
        violations = checker.check_text(
            text,
            characters=characters,
            locations=locations,
            world_state=world_state,
            active_secrets=active_secrets,
        )
        tools_used.append("continuity_checker")
        critical_violations = [v for v in violations if v.severity == "critical"]
        if critical_violations:
            return PipelineResult({
                "success": False,
                "stage": "continuity",
                "violations": violations,
                "errors": [v.message for v in critical_violations],
                "tools_used": tools_used,
                "elapsed_ms": (time.time() - start) * 1000,
                "data": {"text": text, "validation": validation.to_dict()},
            })

        extractor = get_event_extractor()
        extracted = extractor.extract(text)
        tools_used.append("event_extractor")

        scorer = get_importance_scorer()
        scored_events = []
        for event in extracted:
            event_dict = event.to_dict() if hasattr(event, "to_dict") else event
            score_result = scorer.score(event_dict)
            scored_events.append({**event_dict, **score_result})
        tools_used.append("importance_scorer")

        prioritizer = get_notification_prioritizer()
        notifications = [prioritizer.prioritize(e) for e in scored_events if e.get("should_store")]
        tools_used.append("notification_prioritizer")

        return PipelineResult({
            "success": True,
            "stage": "complete",
            "data": {
                "text": text,
                "validation": validation.to_dict(),
                "scored_events": scored_events,
            },
            "violations": violations,
            "extracted_events": extracted,
            "notifications": notifications,
            "errors": errors + validation.errors,
            "tools_used": tools_used,
            "elapsed_ms": (time.time() - start) * 1000,
        })

    def process_entity(
        self,
        entity_type: str,
        data: dict[str, Any],
        *,
        existing_entities: list[dict[str, Any]] | None = None,
    ) -> PipelineResult:
        start = time.time()
        tools_used: list[str] = []

        normalizer = get_entity_normalizer()
        normalized = normalizer.normalize_all(entity_type, data)
        tools_used.append("entity_normalizer")

        dedup = get_entity_deduplicator()
        existing = existing_entities or []
        if existing:
            candidates = dedup.find_duplicates(normalized, existing)
            tools_used.append("entity_deduplicator")
            if candidates and dedup.should_merge(normalized, candidates[0].entity, candidates[0].score):
                merged = dedup.merge_entities(candidates[0].entity, normalized)
                return PipelineResult({
                    "success": True,
                    "stage": "merged",
                    "data": {
                        "entity": merged,
                        "merged_with": candidates[0].entity.get("name", ""),
                        "merge_score": candidates[0].score,
                    },
                    "tools_used": tools_used,
                    "elapsed_ms": (time.time() - start) * 1000,
                })

        return PipelineResult({
            "success": True,
            "stage": "normalized",
            "data": {"entity": normalized},
            "tools_used": tools_used,
            "elapsed_ms": (time.time() - start) * 1000,
        })

    def build_context(
        self,
        character: dict[str, Any],
        *,
        location: str = "",
        present_npcs: list[dict[str, Any]] | None = None,
        active_secrets: list[dict[str, Any]] | None = None,
        recent_events: list[dict[str, Any]] | None = None,
        current_conflict: dict[str, Any] | None = None,
        world_state: dict[str, Any] | None = None,
        user_character: dict[str, Any] | None = None,
        use_cache: bool = True,
    ) -> PipelineResult:
        start = time.time()
        tools_used: list[str] = []
        cache = get_cache_manager()

        char_name = character.get("name", "")
        if use_cache:
            cached = cache.get_context_pack(char_name)
            if cached is not None:
                return PipelineResult({
                    "success": True,
                    "stage": "cached",
                    "data": cached,
                    "tools_used": ["cache_manager"],
                    "elapsed_ms": (time.time() - start) * 1000,
                })

        packer = get_context_packer()
        pack = packer.pack(
            character=character,
            location=location,
            present_npcs=present_npcs,
            active_secrets=active_secrets,
            recent_events=recent_events,
            current_conflict=current_conflict,
            world_state=world_state,
            user_character=user_character,
        )
        tools_used.append("context_packer")

        if use_cache:
            cache.cache_context_pack(char_name, pack)

        return PipelineResult({
            "success": True,
            "stage": "complete",
            "data": pack,
            "tools_used": tools_used,
            "elapsed_ms": (time.time() - start) * 1000,
        })

    def process_event(
        self,
        event: dict[str, Any],
        *,
        all_npcs: list[dict[str, Any]] | None = None,
        location: str = "",
    ) -> PipelineResult:
        start = time.time()
        tools_used: list[str] = []

        scorer = get_importance_scorer()
        score = scorer.score(event)
        tools_used.append("importance_scorer")

        compressor = get_memory_compressor()
        compressed = compressor.compress_event(str(event.get("text") or event.get("description") or ""), event)
        tools_used.append("memory_compressor")

        notifications: list[Any] = []
        prioritizer = get_notification_prioritizer()
        notif = prioritizer.prioritize(event)
        notifications.append(notif)
        tools_used.append("notification_prioritizer")

        rumor_spreads: list[dict[str, Any]] = []
        if all_npcs and score.get("should_store"):
            router = get_secret_router()
            classified = router.classify_secret(event)
            if classified.get("can_spread"):
                routes = router.route_to_npcs(classified, all_npcs, location=location)
                rumor_spreads = routes
                tools_used.append("secret_router")

        return PipelineResult({
            "success": True,
            "stage": "complete",
            "data": {
                "score": score,
                "compressed_memory": compressed,
                "rumor_spreads": rumor_spreads,
            },
            "notifications": notifications,
            "tools_used": tools_used,
            "elapsed_ms": (time.time() - start) * 1000,
        })

    def check_resources(self) -> PipelineResult:
        governor = get_resource_governor()
        advice = governor.get_adaptation_advice()
        return PipelineResult({
            "success": True,
            "stage": "resource_check",
            "data": advice,
            "tools_used": ["resource_governor"],
            "elapsed_ms": 0,
        })


_pipeline: WorldPipeline | None = None


def get_world_pipeline() -> WorldPipeline:
    global _pipeline
    if _pipeline is None:
        _pipeline = WorldPipeline()
    return _pipeline
