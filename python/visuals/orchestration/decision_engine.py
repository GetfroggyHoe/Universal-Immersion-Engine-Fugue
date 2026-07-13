from __future__ import annotations

import logging
from typing import Any

from ..inspection.inspector import InspectionReport
from ..schemas.types import (
    ToolID,
    ImageCategory,
    classify_visual_type,
    PORTRAIT_TYPES,
    BACKGROUND_TYPES,
    ITEM_TYPES,
    SKILL_TYPES,
    SOCIAL_TYPES,
)

log = logging.getLogger("visuals.orchestration.decision")


REGENERATION_TRIGGERS: frozenset[str] = frozenset({
    "is_blank",
    "is_corrupt",
})

SEVERE_FAILURE_TRIGGERS: frozenset[str] = frozenset({
    "is_blank",
    "is_corrupt",
})


class DecisionEngine:

    def choose_tools(
        self,
        inspection: InspectionReport,
        visual_type: str,
        output_requirements: dict[str, Any] | None = None,
        settings: dict[str, Any] | None = None,
    ) -> list[str]:
        settings = settings or {}
        output_requirements = output_requirements or {}
        category = classify_visual_type(visual_type)

        if not settings.get("automatic_quality_control", True):
            return self._minimal_tools(inspection, visual_type, category)

        actions: list[str] = []

        actions = self._apply_portrait_rules(actions, inspection, visual_type, category, settings)
        actions = self._apply_background_rules(actions, inspection, visual_type, category, settings)
        actions = self._apply_item_rules(actions, inspection, visual_type, category, settings)
        actions = self._apply_skill_rules(actions, inspection, visual_type, category, settings)
        actions = self._apply_social_rules(actions, inspection, visual_type, category, settings)
        actions = self._apply_quality_rules(actions, inspection, visual_type, settings)
        actions = self._apply_output_rules(actions, inspection, output_requirements)

        seen: set[str] = set()
        deduped: list[str] = []
        for a in actions:
            if a not in seen:
                seen.add(a)
                deduped.append(a)

        return deduped

    def should_regenerate(self, inspection: InspectionReport) -> bool:
        if inspection.is_blank:
            return True
        if inspection.is_corrupt:
            return True
        if inspection.blur_score > 0.9 and inspection.contrast_score < 0.1:
            return True
        if inspection.face_detected is False and inspection.image_category in ("portrait",):
            if inspection.composition_score < 0.1:
                return True
        return False

    def should_repair(self, inspection: InspectionReport) -> bool:
        if inspection.is_blank or inspection.is_corrupt:
            return False
        if inspection.blur_score > 0.7:
            return True
        if inspection.brightness_score < 0.2 or inspection.brightness_score > 0.9:
            return True
        if inspection.contrast_score < 0.15:
            return True
        return False

    def _minimal_tools(
        self,
        inspection: InspectionReport,
        visual_type: str,
        category: ImageCategory,
    ) -> list[str]:
        actions: list[str] = []
        if visual_type in ITEM_TYPES:
            actions.append(ToolID.BACKGROUND_REMOVE.value)
        actions.append(ToolID.COMPRESS.value)
        actions.append(ToolID.THUMBNAIL_CREATE.value)
        return actions

    def _apply_portrait_rules(
        self,
        actions: list[str],
        inspection: InspectionReport,
        visual_type: str,
        category: ImageCategory,
        settings: dict[str, Any],
    ) -> list[str]:
        if visual_type not in PORTRAIT_TYPES:
            return actions

        if settings.get("automatic_upscaling", True):
            if inspection.blur_score > 0.5 or inspection.resolution[0] < 768:
                actions.append(ToolID.ANIME_UPSCALE.value)

        if not inspection.subject_centered:
            actions.append(ToolID.SMART_CROP.value)

        return actions

    def _apply_background_rules(
        self,
        actions: list[str],
        inspection: InspectionReport,
        visual_type: str,
        category: ImageCategory,
        settings: dict[str, Any],
    ) -> list[str]:
        if visual_type not in BACKGROUND_TYPES:
            return actions

        if settings.get("automatic_upscaling", True):
            if inspection.resolution[0] < 1024:
                actions.append(ToolID.ANIME_UPSCALE.value)

        if settings.get("automatic_navigation_processing", True):
            actions.append(ToolID.NAVIGATION_OPTIMIZE.value)

        return actions

    def _apply_item_rules(
        self,
        actions: list[str],
        inspection: InspectionReport,
        visual_type: str,
        category: ImageCategory,
        settings: dict[str, Any],
    ) -> list[str]:
        if visual_type not in ITEM_TYPES:
            return actions

        if settings.get("automatic_background_removal", True):
            actions.append(ToolID.BACKGROUND_REMOVE.value)

        if not inspection.subject_centered:
            actions.append(ToolID.SMART_CROP.value)

        if settings.get("automatic_upscaling", True):
            if inspection.resolution[0] < 512:
                actions.append(ToolID.ANIME_UPSCALE.value)

        return actions

    def _apply_skill_rules(
        self,
        actions: list[str],
        inspection: InspectionReport,
        visual_type: str,
        category: ImageCategory,
        settings: dict[str, Any],
    ) -> list[str]:
        if visual_type not in SKILL_TYPES:
            return actions

        if not inspection.subject_centered:
            actions.append(ToolID.SMART_CROP.value)

        if settings.get("automatic_upscaling", True):
            if inspection.resolution[0] < 512:
                actions.append(ToolID.ANIME_UPSCALE.value)

        if inspection.blur_score > 0.6 and ToolID.ANIME_UPSCALE.value not in actions:
            actions.append(ToolID.SHARPEN.value)

        return actions

    def _apply_social_rules(
        self,
        actions: list[str],
        inspection: InspectionReport,
        visual_type: str,
        category: ImageCategory,
        settings: dict[str, Any],
    ) -> list[str]:
        if visual_type not in SOCIAL_TYPES:
            return actions

        if settings.get("automatic_upscaling", True):
            if inspection.resolution[0] < 512:
                actions.append(ToolID.ANIME_UPSCALE.value)

        if not inspection.subject_centered:
            actions.append(ToolID.SMART_CROP.value)

        return actions

    def _apply_quality_rules(
        self,
        actions: list[str],
        inspection: InspectionReport,
        visual_type: str,
        settings: dict[str, Any],
    ) -> list[str]:
        if settings.get("automatic_color_correction", True):
            needs_color = (
                inspection.brightness_score < 0.3
                or inspection.brightness_score > 0.85
                or inspection.contrast_score < 0.3
                or inspection.saturation_score < 0.15
                or inspection.saturation_score > 0.85
            )
            if needs_color and ToolID.COLOR_OPTIMIZE.value not in actions:
                actions.append(ToolID.COLOR_OPTIMIZE.value)

        if inspection.blur_score > 0.6:
            if ToolID.ANIME_UPSCALE.value not in actions and ToolID.SHARPEN.value not in actions:
                actions.append(ToolID.SHARPEN.value)

        return actions

    def _apply_output_rules(
        self,
        actions: list[str],
        inspection: InspectionReport,
        output_requirements: dict[str, Any],
    ) -> list[str]:
        if inspection.resolution[0] >= 256:
            if ToolID.THUMBNAIL_CREATE.value not in actions:
                actions.append(ToolID.THUMBNAIL_CREATE.value)
            if ToolID.COMPRESS.value not in actions:
                actions.append(ToolID.COMPRESS.value)

        if output_requirements.get("transparent"):
            if ToolID.BACKGROUND_REMOVE.value not in actions:
                actions.append(ToolID.BACKGROUND_REMOVE.value)

        target_format = output_requirements.get("format", "")
        if target_format:
            if ToolID.FORMAT_CONVERT.value not in actions:
                actions.append(ToolID.FORMAT_CONVERT.value)

        return actions


_decision_engine: DecisionEngine | None = None


def get_decision_engine() -> DecisionEngine:
    global _decision_engine
    if _decision_engine is None:
        _decision_engine = DecisionEngine()
    return _decision_engine
