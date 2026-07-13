from __future__ import annotations

import logging
import re
from typing import Any

from ..schemas.types import VisualType

log = logging.getLogger("visuals.prompts.builder")


STYLE_PRESETS: dict[str, str] = {
    "anime_game_art": "anime game art style, clean lineart, soft shading, colorful fantasy RPG visual, readable silhouette",
    "manhwa_webtoon": "manhwa webtoon art style, clean polished digital art, dramatic lighting, stylish character rendering",
    "dark_fantasy_anime": "dark fantasy anime art style, moody lighting, dramatic shadows, gothic fantasy atmosphere",
    "modern_anime_vn": "modern anime visual novel art style, clean polished character art, expressive face, soft lighting",
    "semi_realistic_fantasy": "semi-realistic fantasy game art, detailed but readable, cinematic lighting, grounded proportions",
    "painterly_concept_art": "painterly fantasy concept art, atmospheric lighting, soft brushwork, game illustration style",
}

DEFAULT_STYLE_PRESET = "anime_game_art"

NEGATIVE_SUFFIX = "no text, no watermark"

PROMPT_TEMPLATES: dict[str, str] = {
    VisualType.NPC_PORTRAIT: "{style_preset}, fantasy RPG NPC portrait, {age} {gender} {role}, {hair}, {expression}, {clothing}, shoulder-up portrait, clean character art, soft shading, no text, no watermark",
    VisualType.CHARACTER_PORTRAIT: "{style_preset}, fantasy RPG character portrait, {age} {gender} {role}, {hair}, {expression}, {clothing}, shoulder-up portrait, clean character art, soft shading, no text, no watermark",
    VisualType.NAV_BACKGROUND: "{style_preset}, fantasy RPG navigation background, {location}, {mood}, {lighting}, wide background composition, no characters, no text, no watermark",
    VisualType.LOCATION_BG: "{style_preset}, fantasy RPG navigation background, {location}, {mood}, {lighting}, wide background composition, no text, no watermark",
    VisualType.SKILL: "{style_preset}, fantasy RPG skill card art, {element} {skill_type}, {visual_effect}, magical energy effect, dramatic centered composition, no text, no watermark",
    VisualType.SPELL: "{style_preset}, fantasy RPG spell art, {element} magic, {visual_effect}, mystical energy, dramatic centered composition, no text, no watermark",
    VisualType.ITEM: "{style_preset}, fantasy RPG inventory item, {item_name}, {material}, {color}, centered object, clear readable silhouette, simple background, no text, no watermark",
    VisualType.EQUIPMENT: "{style_preset}, fantasy RPG equipment, {item_name}, {material}, {color}, centered object, clear readable silhouette, simple background, no text, no watermark",
    VisualType.WEAPON: "{style_preset}, fantasy RPG weapon, {item_name}, {material}, centered object, clear readable silhouette, simple background, no text, no watermark",
    VisualType.FACTION: "{style_preset}, fantasy RPG faction visual, {faction_type}, {symbol}, emblem or headquarters artwork, no text, no watermark",
    VisualType.QUEST: "{style_preset}, fantasy RPG quest illustration, {quest_theme}, {symbol}, dramatic atmosphere, cinematic game art, no text, no watermark",
    VisualType.QUEST_VISUAL: "{style_preset}, fantasy RPG quest illustration, {quest_theme}, {symbol}, dramatic atmosphere, cinematic game art, no text, no watermark",
    VisualType.INSTAVIBE_PROFILE_PIC: "{style_preset}, anime social media profile picture, {gender} {role}, {hair}, {expression}, casual pose, clean portrait, profile icon composition, no text, no watermark",
    VisualType.INSTAVIBE_POST_IMAGE: "{style_preset}, simulated social media post image, {caption}, {location}, {mood}, anime game visual, no text, no watermark",
    VisualType.INSTAVIBE_STORY_IMAGE: "{style_preset}, simulated social media story image, {caption}, {location}, {mood}, vertical composition, anime game visual, no text, no watermark",
    VisualType.MESSAGE_ATTACHMENT: "{style_preset}, image sent in a text message, {message_context}, casual in-world photo composition, no text, no watermark",
    VisualType.GROUP_MESSAGE_IMAGE: "{style_preset}, image sent in a group message, {message_context}, casual in-world photo composition, no text, no watermark",
    VisualType.CHARACTER_SELFIE: "{style_preset}, simulated social media selfie, {character_description}, {expression}, {location}, close-up social photo composition, no text, no watermark",
    VisualType.LOCATION_PHOTO: "{style_preset}, simulated social media location photo, {description}, {mood}, atmospheric background, game world travel photo, no text, no watermark",
    VisualType.FOOD_PHOTO: "{style_preset}, simulated social media food photo, {item_name}, {description}, warm lighting, cozy atmosphere, no text, no watermark",
    VisualType.OUTFIT_PHOTO: "{style_preset}, simulated social media outfit photo, {outfit_description}, full-body fashion pose, clean background, no text, no watermark",
    VisualType.ITEM_PHOTO: "{style_preset}, fantasy RPG inventory item, {item_name}, {material}, {color}, centered object, clear readable silhouette, simple background, no text, no watermark",
    VisualType.EVENT_PHOTO: "{style_preset}, simulated social media event photo, {description}, {location}, atmospheric game world photo, no text, no watermark",
    VisualType.SOCIAL_SCENE_IMAGE: "{style_preset}, social scene image, {location}, {mood}, detailed scene composition, atmospheric lighting, no text, no watermark",
    VisualType.BUILDING: "{style_preset}, fantasy RPG building, {description}, {mood}, {lighting}, architectural detail, game environment art, no text, no watermark",
    VisualType.CREATURE: "{style_preset}, fantasy RPG creature, {description}, detailed monster art, dramatic lighting, no text, no watermark",
    VisualType.VEHICLE: "{style_preset}, fantasy RPG vehicle, {description}, detailed vehicle art, dynamic composition, no text, no watermark",
}

NEGATIVE_PROMPTS: dict[str, str] = {
    "default": "no text, no watermark, no logo, no signature",
    "koji": "no text, no watermark, no logo, no signature, no ui elements, no readable text, low quality, blurry",
}

KOJI_ENRICHMENTS: dict[str, str] = {
    VisualType.LOCATION_BG: "wide background composition, atmospheric depth, detailed environment",
    VisualType.NAV_BACKGROUND: "wide background composition, atmospheric depth, detailed environment, no characters",
    VisualType.INSTAVIBE_POST_IMAGE: "clean anime game visual, social media aesthetic",
    VisualType.INSTAVIBE_STORY_IMAGE: "vertical composition, social media story format, clean anime game visual",
    VisualType.MESSAGE_ATTACHMENT: "casual in-world photo composition, soft lighting",
    VisualType.GROUP_MESSAGE_IMAGE: "casual in-world photo composition, soft lighting",
    VisualType.QUEST_VISUAL: "cinematic game art, dramatic atmosphere, detailed illustration",
    VisualType.EVENT_PHOTO: "atmospheric game world photo, cinematic composition",
    VisualType.LOCATION_PHOTO: "atmospheric background, game world travel photo",
    VisualType.SOCIAL_SCENE_IMAGE: "detailed scene composition, atmospheric lighting",
    VisualType.FACTION: "emblem or headquarters artwork, detailed organization visual",
    VisualType.CHARACTER_SELFIE: "close-up social photo composition, casual pose",
    VisualType.FOOD_PHOTO: "warm lighting, cozy atmosphere, appetizing presentation",
    VisualType.OUTFIT_PHOTO: "full-body fashion pose, clean background",
    VisualType.ITEM_PHOTO: "centered object, clean product photo style",
    VisualType.INSTAVIBE_PROFILE_PIC: "clean portrait, profile icon composition, social media aesthetic",
}


class PromptBuilder:

    def __init__(self) -> None:
        self._custom_templates: dict[str, str] = {}
        self._custom_negatives: dict[str, str] = {}

    def build_prompt(
        self,
        visual_type: str,
        entity_data: dict[str, Any],
        style_preset: str = "",
        provider: str = "koji",
        prompt_override: str | None = None,
    ) -> str:
        if prompt_override:
            prompt = prompt_override
        else:
            prompt = self._build_from_template(visual_type, entity_data, style_preset)

        prompt = self._enrich_for_provider(prompt, provider, visual_type)
        return prompt

    def build_negative_prompt(
        self,
        visual_type: str = "",
        provider: str = "koji",
        negative_override: str | None = None,
    ) -> str:
        if negative_override:
            return negative_override
        custom = self._custom_negatives.get(visual_type, "")
        if custom:
            return custom
        return NEGATIVE_PROMPTS.get(provider, NEGATIVE_PROMPTS["default"])

    def set_custom_template(self, visual_type: str, template: str) -> None:
        self._custom_templates[visual_type] = template

    def set_custom_negative(self, visual_type: str, negative: str) -> None:
        self._custom_negatives[visual_type] = negative

    def get_template(self, visual_type: str) -> tuple[str, bool]:
        custom = self._custom_templates.get(visual_type, "")
        if custom:
            return custom, True
        default = PROMPT_TEMPLATES.get(visual_type, "")
        return default, False

    def get_all_templates(self) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        all_types = set(PROMPT_TEMPLATES.keys()) | set(self._custom_templates.keys())
        for vt in sorted(all_types):
            template, is_custom = self.get_template(vt)
            result[vt] = {
                "visual_type": vt,
                "template": template,
                "negative_prompt": self._custom_negatives.get(vt, NEGATIVE_PROMPTS["default"]),
                "is_custom": is_custom,
            }
        return result

    def preview_prompt(
        self,
        visual_type: str,
        entity_data: dict[str, Any],
        style_preset: str = "",
        provider: str = "koji",
    ) -> dict[str, str]:
        prompt = self.build_prompt(visual_type, entity_data, style_preset, provider)
        negative = self.build_negative_prompt(visual_type, provider)
        return {
            "prompt": prompt,
            "negative_prompt": negative,
            "visual_type": visual_type,
            "style_preset": style_preset or DEFAULT_STYLE_PRESET,
            "provider": provider,
        }

    def _build_from_template(
        self,
        visual_type: str,
        entity_data: dict[str, Any],
        style_preset: str = "",
    ) -> str:
        custom = self._custom_templates.get(visual_type, "")
        if custom:
            template = custom
        else:
            template = PROMPT_TEMPLATES.get(visual_type, "")

        if not template:
            style = self._get_style_text(style_preset)
            name = entity_data.get("name", "Entity")
            return f"{style}, fantasy game art for {name}, {NEGATIVE_SUFFIX}"

        return self._render_template(template, entity_data, style_preset)

    def _render_template(
        self,
        template: str,
        entity_data: dict[str, Any],
        style_preset: str = "",
    ) -> str:
        variables: dict[str, str] = {
            "style_preset": self._get_style_text(style_preset),
            "name": str(entity_data.get("name", "")),
            "entity_type": str(entity_data.get("entity_type", "")),
            "role": str(entity_data.get("role", "")),
            "age": self._format_age(entity_data),
            "gender": str(entity_data.get("gender", "")),
            "hair": str(entity_data.get("hair", "")),
            "expression": str(entity_data.get("expression", "")),
            "clothing": str(entity_data.get("clothing", entity_data.get("appearance", ""))),
            "location": str(entity_data.get("location", "")),
            "mood": str(entity_data.get("mood", "")),
            "lighting": str(entity_data.get("time_of_day", entity_data.get("lighting", ""))),
            "item_name": str(entity_data.get("item_name", entity_data.get("name", ""))),
            "material": str(entity_data.get("material", "")),
            "color": str(entity_data.get("color", "")),
            "element": str(entity_data.get("element", "")),
            "skill_type": str(entity_data.get("type", entity_data.get("skill_type", ""))),
            "visual_effect": str(entity_data.get("visual_effect", "")),
            "quest_theme": str(entity_data.get("theme", entity_data.get("type", ""))),
            "faction_type": str(entity_data.get("type", "")),
            "symbol": str(entity_data.get("symbol", "")),
            "caption": str(entity_data.get("caption", entity_data.get("content", ""))),
            "message_context": str(entity_data.get("context", entity_data.get("subject", ""))),
            "world_style": str(entity_data.get("world_style", "")),
            "description": str(entity_data.get("description", "")),
            "subject": str(entity_data.get("subject", "")),
            "context": str(entity_data.get("context", "")),
            "character_description": str(entity_data.get("character_description", entity_data.get("appearance", ""))),
            "outfit_description": str(entity_data.get("outfit_description", entity_data.get("description", ""))),
        }

        result = template
        for key, value in variables.items():
            result = result.replace("{" + key + "}", value)
        result = re.sub(r"\{[^}]+\}", "", result)
        result = re.sub(r",\s*,", ",", result)
        result = re.sub(r"\s+", " ", result)
        return result.strip().strip(",")

    def _get_style_text(self, preset_name: str) -> str:
        return STYLE_PRESETS.get(preset_name, STYLE_PRESETS[DEFAULT_STYLE_PRESET])

    def _format_age(self, entity_data: dict[str, Any]) -> str:
        age = entity_data.get("age", "")
        gender = entity_data.get("gender", "")
        if age:
            pronoun = "her" if gender == "female" else "his"
            return f"in {pronoun} {age}s"
        return ""

    def _enrich_for_provider(self, prompt: str, provider: str, visual_type: str) -> str:
        if provider in ("koji", "local", "builtin"):
            enrichment = KOJI_ENRICHMENTS.get(visual_type, "")
            if enrichment and enrichment.lower() not in prompt.lower():
                prompt = f"{prompt}, {enrichment}"
            if "no text, no watermark" not in prompt.lower():
                prompt = f"{prompt}, no text, no watermark"
        return prompt


_prompt_builder: PromptBuilder | None = None


def get_prompt_builder() -> PromptBuilder:
    global _prompt_builder
    if _prompt_builder is None:
        _prompt_builder = PromptBuilder()
    return _prompt_builder
