"""
Visual Generation Service - Central pipeline for entity image generation

Generation routing priority:
  1. User API (external)  → backgrounds only (location_bg, nav_background)
   2. Koji (local, optional download) → everything (backgrounds + NPCs + skills + items + all)
  3. Hybrid (both active)  → User API does backgrounds, Koji does everything else
  4. Neither active        → manual only (user uploads via file picker)

Small-asset photos (item_photo) never auto-generate regardless of backend.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib import parse as urlparse

log = logging.getLogger("visual_service")

from fastapi import BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from .uie_backend import (
    db, db_lock, now_iso, encode, decode, GENERATED_ASSET_DIR,
    normalize_provider, provider_api_key, image_dimensions,
    generate_image_bytes, update_image_asset_status,
    queue_ws_broadcast, image_job_lock, image_jobs_in_flight,
    content_extension, first_string
)


STYLE_PRESETS: dict[str, str] = {
    "anime_game_art": "anime game art style, clean lineart, soft shading, colorful fantasy RPG visual, readable silhouette",
    "manhwa_webtoon": "manhwa webtoon art style, clean polished digital art, dramatic lighting, stylish character rendering",
    "dark_fantasy_anime": "dark fantasy anime art style, moody lighting, dramatic shadows, gothic fantasy atmosphere",
    "modern_anime_vn": "modern anime visual novel art style, clean polished character art, expressive face, soft lighting",
    "semi_realistic_fantasy": "semi-realistic fantasy game art, detailed but readable, cinematic lighting, grounded proportions",
    "painterly_concept_art": "painterly fantasy concept art, atmospheric lighting, soft brushwork, game illustration style",
}

DEFAULT_STYLE_PRESET = "anime_game_art"

AVAILABLE_STYLE_PRESETS = list(STYLE_PRESETS.keys())

NEGATIVE_SUFFIX = "no text, no watermark"

# ---------------------------------------------------------------------------
# Entity type routing tiers
# ---------------------------------------------------------------------------

# User API (external provider) auto-generates these types when connected.
# In hybrid mode, User API handles these, Koji handles the rest.
USER_API_AUTO_TYPES: frozenset[str] = frozenset({
    "npc",
    "location_bg",
    "nav_background",
    "skill",
    "faction",
    "quest",
    "quest_visual",
    "instavibe_profile_pic",
    "instavibe_post_image",
    "instavibe_story_image",
    "message_image_attachment",
    "group_message_image_attachment",
    "character_selfie",
    "location_photo",
    "event_photo",
    "social_scene_image",
    "food_photo",
    "outfit_photo",
})

# Photos remain manual. Template item/equipment art is routable because players
# can explicitly opt it into Koji or their connected main image provider.
MANUAL_ONLY_TYPES: frozenset[str] = frozenset({
    "item_photo",
})

VISUAL_SETTINGS: dict[str, Any] = {
    "auto_generate_images": True,
    "preferred_image_provider": "auto",
    "default_style_preset": DEFAULT_STYLE_PRESET,
    "builtin_image_gen_enabled": True,
    "generate_npc_portraits_on_creation": False,
    "generate_location_backgrounds_on_creation": True,
    "generate_skill_art_on_creation": True,
    "generate_item_template_images_on_creation": False,
    "generate_equipment_template_images_on_creation": False,
    "generate_quest_visuals_on_creation": True,
    "generate_faction_visuals_on_creation": True,
    "generate_per_item_instance_images": False,
    "generate_instavibe_profile_pics": True,
    "generate_instavibe_post_images": True,
    "generate_message_images": True,
    "max_concurrent_jobs": 3,
    "job_timeout_seconds": 120,
    "visual_backend_mode": "built_in_backend",
    "visual_quality_mode": "balanced",
    "builtin_visual_model": "koji",
    "enable_koji": True,
    "hybrid_mode": False,
    "hybrid_koji_categories": {"npc": True, "skills": True, "items": True, "assets": True},
    "auto_generate_categories": {"npc": True, "skills": True, "items": True, "assets": True},
    # Koji is NOT auto-downloaded. It is an optional model the user installs
    # on demand (from Visual Gen settings or during first-run setup).
    "auto_download_koji": False,
    "koji_downloaded": False,
    "koji_model_path": None,
    "custom_model_enabled": False,
    "custom_model_provider": None,
    "custom_model_base_url": None,
    "custom_model_auth_type": None,
    "custom_model_api_key": None,
    "custom_model_headers": {},
    "custom_model_request_template": {},
    "custom_model_response_mapping": {},
    "custom_model_timeout": 120,
    "custom_model_retry_count": 1,
    "visual_prompt_templates": {},
    "visual_negative_prompts": {},
    "visual_auto_generate_flags": {},
    # User image API (pushed from frontend settings)
    "user_api_provider": "",
    "user_api_url": "",
    "user_api_key": "",
    "user_api_model": "",
    "user_api_connected": False,
    # Visual Upscaling
    "upscaling_mode": "off",
    "auto_download_upscaler": True,
    "upscaler_downloaded": False,
    "upscaler_model_path": None,
    "generate_derivatives_from_master": True,
}

ENTITY_TYPES: dict[str, dict[str, Any]] = {
    "npc": {"priority": 2, "default_size": (512, 512), "folder": "npcs"},
    "skill": {"priority": 3, "default_size": (512, 512), "folder": "skills"},
    "location_bg": {"priority": 1, "default_size": (1280, 720), "folder": "locations"},
    "nav_background": {"priority": 1, "default_size": (1280, 720), "folder": "locations"},
    "faction": {"priority": 6, "default_size": (512, 512), "folder": "factions"},
    "quest": {"priority": 4, "default_size": (768, 512), "folder": "quests"},
    "quest_visual": {"priority": 4, "default_size": (768, 512), "folder": "quests"},
    "item_template": {"priority": 5, "default_size": (512, 512), "folder": "items"},
    "equipment_template": {"priority": 5, "default_size": (512, 512), "folder": "equipment"},
    "instavibe_profile_pic": {"priority": 4, "default_size": (512, 512), "folder": "instavibe/profiles"},
    "instavibe_post_image": {"priority": 2, "default_size": (768, 768), "folder": "instavibe/posts"},
    "instavibe_story_image": {"priority": 3, "default_size": (768, 1024), "folder": "instavibe/stories"},
    "message_image_attachment": {"priority": 1, "default_size": (512, 512), "folder": "messages"},
    "group_message_image_attachment": {"priority": 1, "default_size": (512, 512), "folder": "messages"},
    "character_selfie": {"priority": 3, "default_size": (512, 512), "folder": "messages"},
    "location_photo": {"priority": 3, "default_size": (768, 512), "folder": "instavibe/posts"},
    "food_photo": {"priority": 5, "default_size": (512, 512), "folder": "instavibe/posts"},
    "outfit_photo": {"priority": 4, "default_size": (512, 768), "folder": "instavibe/posts"},
    "item_photo": {"priority": 5, "default_size": (512, 512), "folder": "instavibe/posts"},
    "event_photo": {"priority": 4, "default_size": (768, 512), "folder": "instavibe/posts"},
    "social_scene_image": {"priority": 4, "default_size": (768, 768), "folder": "instavibe/posts"},
}

GENERATION_PRIORITY_ORDER: list[str] = [
    "message_image_attachment",
    "group_message_image_attachment",
    "instavibe_post_image",
    "location_bg",
    "npc",
    "instavibe_profile_pic",
    "character_selfie",
    "skill",
    "quest",
    "item_template",
    "equipment_template",
    "outfit_photo",
    "event_photo",
    "location_photo",
    "food_photo",
    "item_photo",
    "faction",
    "instavibe_story_image",
]

visual_job_queue: list[dict[str, Any]] = []
visual_job_queue_lock = threading.RLock()
visual_jobs_in_flight: set[str] = set()
visual_jobs_in_flight_lock = threading.RLock()


class VisualGenerationRequest(BaseModel):
    entity_type: str
    entity_id: str
    visual_key: str = ""
    visual_type: str = ""
    provider: str = "auto"
    style_preset: str = ""
    prompt_override: str = ""
    force: bool = False
    entity_data: dict[str, Any] = Field(default_factory=dict)
    width: int | None = None
    height: int | None = None
    priority: int = 5


class VisualStatusResponse(BaseModel):
    visual_key: str
    image_status: str
    image_url: str | None = None
    image_path: str | None = None
    thumbnail_url: str | None = None
    image_provider: str | None = None
    image_prompt: str | None = None
    image_style_preset: str | None = None
    image_last_generated_at: str | None = None
    image_error: str | None = None
    image_is_user_uploaded: bool = False
    image_is_protected: bool = False


def get_style_preset_text(preset_name: str) -> str:
    return STYLE_PRESETS.get(preset_name, STYLE_PRESETS[DEFAULT_STYLE_PRESET])


def expand_style_preset(preset_name: str) -> str:
    base = get_style_preset_text(preset_name)
    return f"{base}, {NEGATIVE_SUFFIX}"


def adapt_prompt_for_provider(prompt: str, provider: str, entity_type: str) -> str:
    normalized = normalize_provider(provider)
    if normalized in ("koji",):
        return prompt
    if normalized in ("qwen", "qwen_image", "qwen-image"):
        return prompt
    if normalized in ("comfy", "comfyui"):
        return prompt
    if normalized == "custom_model":
        return prompt
    return prompt


def generate_storage_path(entity_type: str, visual_key: str, ext: str = ".png") -> Path:
    config = ENTITY_TYPES.get(entity_type, {"folder": "misc"})
    folder = config["folder"]
    base = GENERATED_ASSET_DIR / "generated" / folder
    base.mkdir(parents=True, exist_ok=True)
    return base / f"{visual_key}{ext}"


def generate_thumbnail_path(entity_type: str, visual_key: str, ext: str = ".png") -> Path:
    config = ENTITY_TYPES.get(entity_type, {"folder": "misc"})
    folder = config["folder"]
    base = GENERATED_ASSET_DIR / "generated" / folder / "thumbs"
    base.mkdir(parents=True, exist_ok=True)
    return base / f"{visual_key}_thumb{ext}"


def generate_visual_key(entity_type: str, entity_id: str, entity_data: dict[str, Any] = None) -> str:
    entity_data = entity_data or {}
    if entity_type == "npc":
        name = entity_data.get("name", entity_id)
        return f"npc_{hashlib.sha256(name.encode()).hexdigest()[:16]}"
    if entity_type == "skill":
        element = entity_data.get("element", "generic")
        skill_type = entity_data.get("type", "ability")
        name = entity_data.get("name", entity_id)
        slug = re.sub(r"[^a-z0-9]+", "_", name.lower())[:20]
        return f"skill_{element}_{skill_type}_{slug}"
    if entity_type == "location_bg":
        location_id = entity_data.get("id", entity_id)
        return f"location_bg_{location_id}"
    if entity_type == "faction":
        faction_id = entity_data.get("id", entity_id)
        return f"faction_{faction_id}"
    if entity_type == "quest":
        quest_id = entity_data.get("id", entity_id)
        return f"quest_{quest_id}"
    if entity_type in ("item_template", "equipment_template"):
        template_id = entity_data.get("template_id", entity_data.get("id", entity_id))
        return f"{entity_type}_{template_id}"
    if entity_type == "instavibe_profile_pic":
        character_id = entity_data.get("character_id", entity_id)
        return f"instavibe_profile_{character_id}"
    if entity_type == "instavibe_post_image":
        post_id = entity_data.get("post_id", entity_id)
        return f"instavibe_post_{post_id}"
    if entity_type == "instavibe_story_image":
        story_id = entity_data.get("story_id", entity_id)
        return f"instavibe_story_{story_id}"
    if entity_type == "message_image_attachment":
        message_id = entity_data.get("message_id", entity_id)
        attachment_id = entity_data.get("attachment_id", "0")
        return f"message_img_{message_id}_{attachment_id}"
    if entity_type == "group_message_image_attachment":
        message_id = entity_data.get("message_id", entity_id)
        attachment_id = entity_data.get("attachment_id", "0")
        return f"group_message_img_{message_id}_{attachment_id}"
    if entity_type == "character_selfie":
        character_id = entity_data.get("character_id", entity_id)
        context_id = entity_data.get("context_id", "default")
        return f"selfie_{character_id}_{context_id}"
    if entity_type == "location_photo":
        location_id = entity_data.get("location_id", entity_id)
        context_id = entity_data.get("context_id", "default")
        return f"location_photo_{location_id}_{context_id}"
    if entity_type == "food_photo":
        item_or_context_id = entity_data.get("item_id", entity_data.get("context_id", entity_id))
        return f"food_photo_{item_or_context_id}"
    if entity_type == "outfit_photo":
        character_id = entity_data.get("character_id", entity_id)
        outfit_id = entity_data.get("outfit_id", "default")
        return f"outfit_photo_{character_id}_{outfit_id}"
    if entity_type == "item_photo":
        item_id = entity_data.get("item_id", entity_id)
        return f"item_photo_{item_id}"
    if entity_type == "event_photo":
        event_id = entity_data.get("event_id", entity_id)
        return f"event_photo_{event_id}"
    return f"{entity_type}_{entity_id}"


def build_npc_prompt(entity_data: dict[str, Any], style_preset: str = "") -> str:
    style = get_style_preset_text(style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET))
    name = entity_data.get("name", "Character")
    role = entity_data.get("role", "NPC")
    age = entity_data.get("age", "")
    gender = entity_data.get("gender", "")
    hair = entity_data.get("hair", "")
    expression = entity_data.get("expression", "")
    clothing = entity_data.get("clothing", "")
    age_str = ""
    if age:
        age_str = f"in {'her' if gender == 'female' else 'his'} {age}s"
    parts = [
        style,
        "fantasy RPG NPC portrait",
    ]
    if gender:
        parts.append(gender)
    if role:
        parts.append(role)
    if age_str:
        parts.append(age_str)
    if hair:
        parts.append(hair)
    if expression:
        parts.append(f"{expression} expression")
    if clothing:
        parts.append(clothing)
    parts.extend([
        "shoulder-up portrait",
        "clean character art",
        "soft shading",
        NEGATIVE_SUFFIX,
    ])
    return ", ".join(p for p in parts if p)


def build_location_prompt(entity_data: dict[str, Any], style_preset: str = "") -> str:
    style = get_style_preset_text(style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET))
    name = entity_data.get("name", "Location")
    location_type = entity_data.get("type", entity_data.get("biome", "fantasy"))
    description = entity_data.get("description", "")
    mood = entity_data.get("mood", "")
    lighting = entity_data.get("time_of_day", entity_data.get("lighting", ""))
    weather = entity_data.get("weather", "")
    parts = [
        style,
        "fantasy RPG location background",
        location_type,
    ]
    if name:
        parts.append(name.lower())
    if mood:
        parts.append(mood)
    if lighting:
        parts.append(f"{lighting} lighting")
    if weather:
        parts.append(f"{weather} weather")
    if description:
        parts.append(description)
    parts.extend([
        "wide game navigation background",
        NEGATIVE_SUFFIX,
    ])
    return ", ".join(p for p in parts if p)


def build_skill_prompt(entity_data: dict[str, Any], style_preset: str = "") -> str:
    style = get_style_preset_text(style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET))
    name = entity_data.get("name", "Ability")
    element = entity_data.get("element", "generic")
    skill_type = entity_data.get("type", "ability")
    description = entity_data.get("description", "")
    visual_effect = entity_data.get("visual_effect", "")
    parts = [
        style,
        "fantasy RPG skill card art",
        f"{element} {skill_type}",
    ]
    if visual_effect:
        parts.append(visual_effect)
    elif description:
        parts.append(description)
    else:
        parts.append(f"{name} effect")
    parts.extend([
        "magical energy effect",
        "dramatic centered composition",
        NEGATIVE_SUFFIX,
    ])
    return ", ".join(p for p in parts if p)


def build_item_prompt(entity_data: dict[str, Any], style_preset: str = "") -> str:
    style = get_style_preset_text(style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET))
    name = entity_data.get("name", "Item")
    item_type = entity_data.get("type", "item")
    material = entity_data.get("material", "")
    color = entity_data.get("color", "")
    description = entity_data.get("description", "")
    parts = [
        style,
        "fantasy RPG inventory item",
        name,
    ]
    if material:
        parts.append(material)
    if color:
        parts.append(color)
    if description:
        parts.append(description)
    parts.extend([
        "centered object",
        "clear readable silhouette",
        "simple background",
        NEGATIVE_SUFFIX,
    ])
    return ", ".join(p for p in parts if p)


def build_faction_prompt(entity_data: dict[str, Any], style_preset: str = "") -> str:
    style = get_style_preset_text(style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET))
    name = entity_data.get("name", "Organization")
    faction_type = entity_data.get("type", "guild")
    symbol = entity_data.get("symbol", "")
    mood = entity_data.get("mood", "")
    theme = entity_data.get("theme", "")
    description = entity_data.get("description", "")
    parts = [
        style,
        "fantasy RPG faction visual",
        faction_type,
    ]
    if symbol:
        parts.append(symbol)
    if mood:
        parts.append(mood)
    if theme:
        parts.append(f"{theme} theme")
    if description:
        parts.append(description)
    parts.extend([
        "emblem or headquarters artwork",
        NEGATIVE_SUFFIX,
    ])
    return ", ".join(p for p in parts if p)


def build_quest_prompt(entity_data: dict[str, Any], style_preset: str = "") -> str:
    style = get_style_preset_text(style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET))
    name = entity_data.get("name", "Quest")
    quest_theme = entity_data.get("theme", entity_data.get("type", "adventure"))
    main_symbol = entity_data.get("symbol", entity_data.get("location", ""))
    stakes = entity_data.get("stakes", "")
    parts = [
        style,
        "fantasy RPG quest illustration",
        quest_theme,
    ]
    if main_symbol:
        parts.append(main_symbol)
    if stakes:
        parts.append(f"{stakes} stakes")
    parts.extend([
        "atmospheric game art",
        NEGATIVE_SUFFIX,
    ])
    return ", ".join(p for p in parts if p)


def build_instavibe_profile_prompt(entity_data: dict[str, Any], style_preset: str = "") -> str:
    style = get_style_preset_text(style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET))
    age = entity_data.get("age", "")
    gender = entity_data.get("gender", "")
    role = entity_data.get("role", "character")
    hair = entity_data.get("hair", "")
    expression = entity_data.get("expression", "")
    appearance = entity_data.get("appearance", "")
    age_str = ""
    if age:
        age_str = f"in {'her' if gender == 'female' else 'his'} {age}s"
    parts = [
        style,
        "anime social media profile picture",
    ]
    if gender:
        parts.append(gender)
    if role:
        parts.append(role)
    if age_str:
        parts.append(age_str)
    if hair:
        parts.append(hair)
    if expression:
        parts.append(f"{expression} expression")
    if appearance:
        parts.append(appearance)
    parts.extend([
        "casual pose",
        "clean portrait",
        "profile icon composition",
        "clean character art",
        NEGATIVE_SUFFIX,
    ])
    return ", ".join(p for p in parts if p)


def build_instavibe_post_prompt(entity_data: dict[str, Any], style_preset: str = "") -> str:
    style = get_style_preset_text(style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET))
    subject = entity_data.get("subject", entity_data.get("content", ""))
    location_or_context = entity_data.get("location", entity_data.get("context", ""))
    mood = entity_data.get("mood", entity_data.get("tone", ""))
    post_type = entity_data.get("post_type", "general")
    parts = [
        style,
        "simulated social media post image",
    ]
    if subject:
        parts.append(subject)
    if location_or_context:
        parts.append(location_or_context)
    if mood:
        parts.append(mood)
    parts.extend([
        "anime game visual",
        NEGATIVE_SUFFIX,
    ])
    return ", ".join(p for p in parts if p)


def build_selfie_prompt(entity_data: dict[str, Any], style_preset: str = "") -> str:
    style = get_style_preset_text(style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET))
    character_desc = entity_data.get("character_description", entity_data.get("appearance", ""))
    expression = entity_data.get("expression", "")
    location = entity_data.get("location", "")
    parts = [
        style,
        "simulated social media selfie",
    ]
    if character_desc:
        parts.append(character_desc)
    if expression:
        parts.append(f"{expression} expression")
    if location:
        parts.append(location)
    parts.extend([
        "close-up social photo composition",
        NEGATIVE_SUFFIX,
    ])
    return ", ".join(p for p in parts if p)


def build_message_image_prompt(entity_data: dict[str, Any], style_preset: str = "") -> str:
    style = get_style_preset_text(style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET))
    subject = entity_data.get("subject", "")
    context = entity_data.get("context", "")
    message_type = entity_data.get("message_type", "photo")
    parts = [
        style,
        "image sent in a text message",
    ]
    if subject:
        parts.append(subject)
    if context:
        parts.append(context)
    parts.extend([
        "casual in-world photo composition",
        NEGATIVE_SUFFIX,
    ])
    return ", ".join(p for p in parts if p)


def build_food_photo_prompt(entity_data: dict[str, Any], style_preset: str = "") -> str:
    style = get_style_preset_text(style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET))
    item_name = entity_data.get("name", entity_data.get("item_name", "meal"))
    description = entity_data.get("description", "")
    location = entity_data.get("location", "")
    parts = [
        style,
        "simulated social media food photo",
        item_name,
    ]
    if description:
        parts.append(description)
    if location:
        parts.append(location)
    parts.extend([
        "warm lighting",
        "cozy atmosphere",
        NEGATIVE_SUFFIX,
    ])
    return ", ".join(p for p in parts if p)


def build_outfit_photo_prompt(entity_data: dict[str, Any], style_preset: str = "") -> str:
    style = get_style_preset_text(style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET))
    character_desc = entity_data.get("character_description", "")
    outfit_desc = entity_data.get("outfit_description", entity_data.get("description", ""))
    parts = [
        style,
        "simulated social media outfit photo",
    ]
    if character_desc:
        parts.append(character_desc)
    if outfit_desc:
        parts.append(f"wearing {outfit_desc}")
    parts.extend([
        "full-body fashion pose",
        "clean background",
        NEGATIVE_SUFFIX,
    ])
    return ", ".join(p for p in parts if p)


def build_location_photo_prompt(entity_data: dict[str, Any], style_preset: str = "") -> str:
    style = get_style_preset_text(style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET))
    location_desc = entity_data.get("description", entity_data.get("name", ""))
    mood = entity_data.get("mood", "")
    parts = [
        style,
        "simulated social media location photo",
    ]
    if location_desc:
        parts.append(location_desc)
    if mood:
        parts.append(mood)
    parts.extend([
        "atmospheric background",
        "game world travel photo",
        NEGATIVE_SUFFIX,
    ])
    return ", ".join(p for p in parts if p)


def build_event_photo_prompt(entity_data: dict[str, Any], style_preset: str = "") -> str:
    style = get_style_preset_text(style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET))
    event_desc = entity_data.get("description", entity_data.get("event", ""))
    location = entity_data.get("location", "")
    parts = [
        style,
        "simulated social media event photo",
    ]
    if event_desc:
        parts.append(event_desc)
    if location:
        parts.append(location)
    parts.extend([
        "atmospheric game world photo",
        NEGATIVE_SUFFIX,
    ])
    return ", ".join(p for p in parts if p)


def build_visual_prompt(entity_type: str, entity_data: dict[str, Any], style_preset: str = "") -> str:
    custom_templates = VISUAL_SETTINGS.get("visual_prompt_templates", {})
    if entity_type in custom_templates:
        return _render_prompt_template(custom_templates[entity_type], entity_data, style_preset)
    builders = {
        "npc": build_npc_prompt,
        "location_bg": build_location_prompt,
        "skill": build_skill_prompt,
        "item_template": build_item_prompt,
        "equipment_template": build_item_prompt,
        "faction": build_faction_prompt,
        "quest": build_quest_prompt,
        "instavibe_profile_pic": build_instavibe_profile_prompt,
        "instavibe_post_image": build_instavibe_post_prompt,
        "instavibe_story_image": build_instavibe_post_prompt,
        "message_image_attachment": build_message_image_prompt,
        "group_message_image_attachment": build_message_image_prompt,
        "character_selfie": build_selfie_prompt,
        "location_photo": build_location_photo_prompt,
        "food_photo": build_food_photo_prompt,
        "outfit_photo": build_outfit_photo_prompt,
        "item_photo": build_item_prompt,
        "event_photo": build_event_photo_prompt,
    }
    builder = builders.get(entity_type)
    if builder:
        return builder(entity_data, style_preset)
    style = get_style_preset_text(style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET))
    name = entity_data.get("name", "Entity")
    return f"{style}, fantasy game art for {name}, {NEGATIVE_SUFFIX}"


KOJI_PROMPT_ENRICHMENT: dict[str, str] = {
    "location_bg": "wide background composition, atmospheric depth, detailed environment",
    "nav_background": "wide background composition, atmospheric depth, detailed environment, no characters",
    "instavibe_post_image": "clean anime game visual, social media aesthetic",
    "instavibe_story_image": "vertical composition, social media story format, clean anime game visual",
    "message_image_attachment": "casual in-world photo composition, soft lighting",
    "group_message_image_attachment": "casual in-world photo composition, soft lighting",
    "quest_visual": "cinematic game art, dramatic atmosphere, detailed illustration",
    "event_photo": "atmospheric game world photo, cinematic composition",
    "location_photo": "atmospheric background, game world travel photo",
    "social_scene_image": "detailed scene composition, atmospheric lighting",
    "faction": "emblem or headquarters artwork, detailed organization visual",
    "character_selfie": "close-up social photo composition, casual pose",
    "food_photo": "warm lighting, cozy atmosphere, appetizing presentation",
    "outfit_photo": "full-body fashion pose, clean background",
    "item_photo": "centered object, clean product photo style",
    "instavibe_profile_pic": "clean portrait, profile icon composition, social media aesthetic",
}


def enrich_prompt_for_model(prompt: str, model: str, entity_type: str, entity_data: dict[str, Any] | None = None) -> str:
    entity_data = entity_data or {}
    if model == "koji":
        enrichment = KOJI_PROMPT_ENRICHMENT.get(entity_type, "")
        if enrichment and enrichment.lower() not in prompt.lower():
            prompt = f"{prompt}, {enrichment}"
        if "no text, no watermark" not in prompt.lower():
            prompt = f"{prompt}, no text, no watermark"
        return prompt
    return prompt


def get_negative_prompt(entity_type: str, model: str = "") -> str:
    custom_negatives = VISUAL_SETTINGS.get("visual_negative_prompts", {})
    if entity_type in custom_negatives:
        return custom_negatives[entity_type]
    base = "no text, no watermark, no logo, no signature"
    if model == "koji":
        return base + ", no ui elements, no readable text, low quality, blurry"
    return "no text, no watermark"


def _render_prompt_template(template: str, entity_data: dict[str, Any], style_preset: str = "") -> str:
    style = get_style_preset_text(style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET))
    variables: dict[str, str] = {
        "style_preset": style,
        "name": str(entity_data.get("name", "")),
        "entity_type": str(entity_data.get("entity_type", "")),
        "role": str(entity_data.get("role", "")),
        "age": str(entity_data.get("age", "")),
        "gender": str(entity_data.get("gender", "")),
        "hair": str(entity_data.get("hair", "")),
        "expression": str(entity_data.get("expression", "")),
        "clothing": str(entity_data.get("clothing", entity_data.get("appearance", ""))),
        "location": str(entity_data.get("location", "")),
        "mood": str(entity_data.get("mood", "")),
        "lighting": str(entity_data.get("lighting", entity_data.get("time_of_day", ""))),
        "item_name": str(entity_data.get("item_name", entity_data.get("name", ""))),
        "material": str(entity_data.get("material", "")),
        "color": str(entity_data.get("color", "")),
        "element": str(entity_data.get("element", "")),
        "skill_type": str(entity_data.get("type", entity_data.get("skill_type", ""))),
        "visual_effect": str(entity_data.get("visual_effect", "")),
        "quest_theme": str(entity_data.get("theme", entity_data.get("quest_theme", ""))),
        "faction_type": str(entity_data.get("type", entity_data.get("faction_type", ""))),
        "symbol": str(entity_data.get("symbol", "")),
        "caption": str(entity_data.get("caption", entity_data.get("content", ""))),
        "message_context": str(entity_data.get("context", entity_data.get("subject", ""))),
        "world_style": str(entity_data.get("world_style", "")),
        "description": str(entity_data.get("description", "")),
        "subject": str(entity_data.get("subject", "")),
        "context": str(entity_data.get("context", "")),
    }
    result = template
    for key, value in variables.items():
        result = result.replace("{" + key + "}", value)
    result = re.sub(r"\{[^}]+\}", "", result)
    result = re.sub(r",\s*,", ",", result)
    return result.strip().strip(",")


DEFAULT_PROMPT_TEMPLATES: dict[str, str] = {
    "npc": "{style_preset}, fantasy RPG NPC portrait, {age} {gender} {role}, {hair}, {expression}, {clothing}, shoulder-up portrait, clean character art, soft shading, no text, no watermark",
    "location_bg": "{style_preset}, fantasy RPG navigation background, {location}, {mood}, {lighting}, wide background composition, no characters, no text, no watermark",
    "nav_background": "{style_preset}, fantasy RPG navigation background, {location}, {mood}, {lighting}, wide background composition, no characters, no text, no watermark",
    "skill": "{style_preset}, fantasy RPG skill card art, {element} {skill_type}, {visual_effect}, magical energy effect, dramatic centered composition, no text, no watermark",
    "item_template": "{style_preset}, fantasy RPG inventory item, {item_name}, {material}, {color}, centered object, clear readable silhouette, simple background, no text, no watermark",
    "equipment_template": "{style_preset}, fantasy RPG equipment template, {item_name}, {material}, {color}, centered object, clear readable silhouette, simple background, no text, no watermark",
    "quest": "{style_preset}, fantasy RPG quest illustration, {quest_theme}, {symbol}, dramatic atmosphere, cinematic game art, no text, no watermark",
    "quest_visual": "{style_preset}, fantasy RPG quest illustration, {quest_theme}, {symbol}, dramatic atmosphere, cinematic game art, no text, no watermark",
    "faction": "{style_preset}, fantasy RPG faction visual, {faction_type}, {symbol}, emblem or headquarters artwork, no text, no watermark",
    "instavibe_profile_pic": "{style_preset}, anime social media profile picture, {gender} {role}, {hair}, {expression}, casual pose, clean portrait, profile icon composition, no text, no watermark",
    "instavibe_post_image": "{style_preset}, simulated social media post image, {caption}, {location}, {mood}, anime game visual, no text, no watermark",
    "instavibe_story_image": "{style_preset}, simulated social media story image, {caption}, {location}, {mood}, vertical composition, anime game visual, no text, no watermark",
    "message_image_attachment": "{style_preset}, image sent in a text message, {message_context}, casual in-world photo composition, no text, no watermark",
    "group_message_image_attachment": "{style_preset}, image sent in a group message, {message_context}, casual in-world photo composition, no text, no watermark",
    "event_photo": "{style_preset}, simulated social media event photo, {description}, {location}, atmospheric game world photo, no text, no watermark",
    "location_photo": "{style_preset}, simulated social media location photo, {description}, {mood}, atmospheric background, game world travel photo, no text, no watermark",
    "social_scene_image": "{style_preset}, social scene image, {location}, {mood}, detailed scene composition, atmospheric lighting, no text, no watermark",
    "character_selfie": "{style_preset}, simulated social media selfie, {clothing}, {expression}, {location}, close-up social photo composition, no text, no watermark",
    "food_photo": "{style_preset}, simulated social media food photo, {item_name}, {description}, warm lighting, cozy atmosphere, no text, no watermark",
    "outfit_photo": "{style_preset}, simulated social media outfit photo, {clothing}, full-body fashion pose, clean background, no text, no watermark",
}


def get_prompt_template(entity_type: str) -> str:
    custom = VISUAL_SETTINGS.get("visual_prompt_templates", {})
    if entity_type in custom:
        return custom[entity_type]
    return DEFAULT_PROMPT_TEMPLATES.get(entity_type, "{style_preset}, fantasy game art, {name}, no text, no watermark")


def build_prompt_from_template(entity_type: str, entity_data: dict[str, Any], style_preset: str = "") -> str:
    template = get_prompt_template(entity_type)
    return _render_prompt_template(template, entity_data, style_preset)


def custom_model_generate(
    prompt: str,
    negative_prompt: str = "",
    width: int = 512,
    height: int = 512,
    entity_type: str = "",
) -> tuple[bytes, str, str]:
    settings = VISUAL_SETTINGS
    if not settings.get("custom_model_enabled"):
        raise RuntimeError("Custom model is not enabled")
    base_url = settings.get("custom_model_base_url")
    if not base_url:
        raise RuntimeError("Custom model base URL is not configured")
    api_key = settings.get("custom_model_api_key") or ""
    auth_type = settings.get("custom_model_auth_type") or "bearer"
    extra_headers = settings.get("custom_model_headers") or {}
    request_template = settings.get("custom_model_request_template") or {}
    response_mapping = settings.get("custom_model_response_mapping") or {}
    timeout = int(settings.get("custom_model_timeout", 120))
    retries = int(settings.get("custom_model_retry_count", 1))

    if not request_template:
        request_template = {
            "prompt": "{prompt}",
            "negative_prompt": "{negative_prompt}",
            "width": "{width}",
            "height": "{height}",
            "steps": "20",
            "guidance_scale": "7.0",
        }

    body: dict[str, Any] = {}
    for key, value_template in request_template.items():
        if isinstance(value_template, str):
            rendered = value_template.replace("{prompt}", prompt)
            rendered = rendered.replace("{negative_prompt}", negative_prompt)
            rendered = rendered.replace("{width}", str(width))
            rendered = rendered.replace("{height}", str(height))
            try:
                body[key] = int(rendered)
            except (ValueError, TypeError):
                try:
                    body[key] = float(rendered)
                except (ValueError, TypeError):
                    body[key] = rendered
        else:
            body[key] = value_template

    headers: dict[str, str] = {"Content-Type": "application/json"}
    headers.update(extra_headers)
    if api_key:
        if auth_type == "bearer":
            headers["Authorization"] = f"Bearer {api_key}"
        elif auth_type == "basic":
            import base64
            encoded = base64.b64encode(f":{api_key}".encode()).decode()
            headers["Authorization"] = f"Basic {encoded}"
        elif auth_type == "header":
            headers["X-API-Key"] = api_key
        else:
            headers["Authorization"] = f"Bearer {api_key}"

    from .uie_backend import http_bytes, http_json
    last_error: Exception | None = None
    for attempt in range(max(1, retries)):
        try:
            data = http_json(base_url, body, headers=headers, timeout=timeout)
            response_format = response_mapping.get("format", "base64")
            image_path = response_mapping.get("image_path", "images.0.b64_json")
            if response_format == "url":
                image_url = response_mapping.get("url_path", "images.0.url")
                parts = image_url.split(".")
                value: Any = data
                for part in parts:
                    if isinstance(value, dict):
                        value = value.get(part)
                    elif isinstance(value, list) and part.isdigit():
                        value = value[int(part)]
                    else:
                        value = None
                        break
                if value:
                    img_data, content_type = http_bytes(str(value), headers={"Accept": "image/*"}, timeout=timeout)
                    return img_data, content_type, "custom_model"
                raise RuntimeError("Custom model returned no image URL")
            elif response_format == "binary":
                raw = json.dumps(data).encode()
                return raw, "image/png", "custom_model"
            else:
                parts = image_path.split(".")
                value = data
                for part in parts:
                    if isinstance(value, dict):
                        value = value.get(part)
                    elif isinstance(value, list) and part.isdigit():
                        value = value[int(part)]
                    else:
                        value = None
                        break
                if value and isinstance(value, str):
                    import base64
                    if value.startswith("data:"):
                        match = re.match(r"^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$", value, re.I | re.S)
                        if match:
                            ct = match.group(1) or "image/png"
                            return base64.b64decode(match.group(2)), ct, "custom_model"
                    return base64.b64decode(value), "image/png", "custom_model"
                raise RuntimeError("Custom model returned no image data")
        except Exception as exc:
            last_error = exc
            if attempt < retries - 1:
                time.sleep(1)
    raise RuntimeError(f"Custom model generation failed: {last_error}")


def get_visual_metadata(visual_key: str) -> dict[str, Any] | None:
    with db_lock, db() as conn:
        row = conn.execute(
            "select * from image_assets where id=?",
            (visual_key,)
        ).fetchone()
        if not row:
            return None
        payload = decode(row["payload"], {})
        return {
            "visual_key": row["id"],
            "image_status": row["status"] if row["status"] != "ready" else "complete",
            "image_url": row["url"] or None,
            "image_path": row["file_path"] or None,
            "thumbnail_url": payload.get("thumbnail_url"),
            "backend_mode": payload.get("backend_mode", VISUAL_SETTINGS.get("visual_backend_mode", "built_in_backend")),
            "image_provider": row["provider"] or None,
            "image_model": payload.get("image_model", row["provider"] or None),
            "image_prompt": row["prompt"] or None,
            "negative_prompt": payload.get("negative_prompt"),
            "prompt_template_id": payload.get("prompt_template_id"),
            "image_style_preset": payload.get("image_style_preset"),
            "image_visual_key": row["id"],
            "image_last_generated_at": row["updated_at"] if row["status"] == "ready" else None,
            "image_error": row["error"] or None,
            "image_is_user_uploaded": payload.get("image_is_user_uploaded", False),
            "image_is_protected": payload.get("image_is_protected", False),
            "tools_applied": payload.get("tools_applied", []),
        }


def save_visual_metadata(
    visual_key: str,
    entity_type: str,
    prompt: str,
    status: str = "pending",
    provider: str = "",
    width: int = 512,
    height: int = 512,
    entity_data: dict[str, Any] = None,
    style_preset: str = "",
    is_user_uploaded: bool = False,
    is_protected: bool = False,
    negative_prompt: str = "",
    backend_mode: str = "",
) -> dict[str, Any]:
    entity_data = entity_data or {}
    now = now_iso()
    db_status = "generating" if status == "pending" else status
    if db_status == "complete":
        db_status = "ready"
    cache_key_data = {
        "visual_key": visual_key,
        "entity_type": entity_type,
        "prompt": prompt,
        "width": width,
        "height": height,
    }
    cache_key = hashlib.sha256(encode(cache_key_data).encode()).hexdigest()
    extended_payload = {
        **entity_data,
        "image_style_preset": style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET),
        "image_is_user_uploaded": is_user_uploaded,
        "image_is_protected": is_protected,
        "negative_prompt": negative_prompt,
        "backend_mode": backend_mode or VISUAL_SETTINGS.get("visual_backend_mode", "built_in_backend"),
        "image_model": provider,
    }
    with db_lock, db() as conn:
        conn.execute(
            """
            insert into image_assets
            (id, cache_key, kind, status, location, prompt, provider, url, file_path, content_type, error, payload, created_at, updated_at)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(id) do update set
                status=excluded.status,
                prompt=excluded.prompt,
                provider=excluded.provider,
                payload=excluded.payload,
                updated_at=excluded.updated_at
            """,
            (
                visual_key,
                cache_key,
                entity_type,
                db_status,
                entity_data.get("location", entity_data.get("name", "")),
                prompt[:3000],
                provider,
                "",
                "",
                "",
                "",
                encode(extended_payload),
                now,
                now,
            )
        )
    return get_visual_metadata(visual_key)


def _user_api_active() -> bool:
    """Return True when a user-configured external image API is ready to use."""
    return bool(
        VISUAL_SETTINGS.get("user_api_connected")
        and VISUAL_SETTINGS.get("user_api_key")
        and VISUAL_SETTINGS.get("user_api_url")
    )


def _koji_active() -> bool:
    """Return True when Koji is enabled AND its model files are downloaded."""
    if not VISUAL_SETTINGS.get("enable_koji", True):
        return False


def visual_category(entity_type: str) -> str:
    kind = str(entity_type or "").lower()
    if kind in {"npc", "character_selfie", "instavibe_profile_pic"}: return "npc"
    if kind in {"skill", "rune"}: return "skills"
    if kind in {"item_template", "equipment_template", "item_photo"}: return "items"
    return "assets"
    try:
        from .visuals.model_manager import get_model_manager
        return get_model_manager().koji_available()
    except Exception:
        return False


def select_visual_provider(entity_type: str, requested_provider: str = "auto") -> str:
    """
    3-tier routing with manual-only enforcement:
      0. Manual-only types → always return "manual" (file picker only)
      1. explicit request  → honour it directly
      2. custom_model mode → custom_model
      3. auto routing:
           - User API active + entity is in USER_API_AUTO_TYPES → user_api
           - Koji active → koji  (covers ALL entity types incl. NPC/skill/item)
           - Hybrid: User API does backgrounds/social, Koji does everything else
           - Neither → manual (caller should skip generation)
    """
    if entity_type in MANUAL_ONLY_TYPES:
        return "manual"

    if requested_provider and requested_provider != "auto":
        return normalize_provider(requested_provider)

    if VISUAL_SETTINGS.get("visual_backend_mode") == "custom_model" and VISUAL_SETTINGS.get("custom_model_enabled"):
        return "custom_model"

    user_api = _user_api_active()
    koji = _koji_active()

    if VISUAL_SETTINGS.get("hybrid_mode"):
        category = visual_category(entity_type)
        local_allowed = VISUAL_SETTINGS.get("hybrid_koji_categories", {}).get(category, True)
        main_allowed = VISUAL_SETTINGS.get("auto_generate_categories", {}).get(category, True)
        if local_allowed and koji:
            return "koji"
        if main_allowed and user_api and entity_type in USER_API_AUTO_TYPES:
            return "user_api"
        return "manual"

    if user_api and entity_type in USER_API_AUTO_TYPES:
        return "user_api"

    if koji:
        return "koji"

    return "manual"


def queue_visual_job(
    visual_key: str,
    entity_type: str,
    prompt: str,
    provider: str,
    width: int,
    height: int,
    entity_data: dict[str, Any],
    priority: int = 5,
    style_preset: str = "",
) -> bool:
    with visual_job_queue_lock:
        for job in visual_job_queue:
            if job["visual_key"] == visual_key:
                return False
        with visual_jobs_in_flight_lock:
            if visual_key in visual_jobs_in_flight:
                return False
        job = {
            "visual_key": visual_key,
            "entity_type": entity_type,
            "prompt": prompt,
            "provider": provider,
            "width": width,
            "height": height,
            "entity_data": entity_data,
            "priority": priority,
            "style_preset": style_preset,
            "queued_at": time.time(),
        }
        visual_job_queue.append(job)
        visual_job_queue.sort(key=lambda j: j["priority"])
        return True


def process_visual_job(job: dict[str, Any]) -> None:
    visual_key = job["visual_key"]
    with visual_jobs_in_flight_lock:
        if visual_key in visual_jobs_in_flight:
            return
        visual_jobs_in_flight.add(visual_key)
    try:
        update_image_asset_status(visual_key, status="generating", error="")
        from .uie_backend import AssetImagePayload
        provider = job["provider"]
        entity_type = job["entity_type"]
        prompt = job["prompt"]
        negative_prompt = get_negative_prompt(entity_type, provider)

        if provider == "manual":
            # Nothing to do — frontend should show file picker
            update_image_asset_status(visual_key, status="manual", error="")
            return
        elif provider in ("koji", "local", "builtin"):
            _process_builtin_job(job, visual_key, negative_prompt)
        elif provider == "user_api":
            _process_user_api_job(job, visual_key, negative_prompt)
        elif provider == "custom_model":
            _process_custom_model_job(job, visual_key, negative_prompt)
        else:
            _process_external_provider_job(job, visual_key, negative_prompt)
    except Exception as exc:
        error_msg = str(exc)[:800]
        update_image_asset_status(visual_key, status="failed", error=error_msg)
        queue_ws_broadcast({
            "type": "visual_failed",
            "payload": {
                "visual_key": visual_key,
                "entity_type": job["entity_type"],
                "error": error_msg,
            },
            "ts": now_iso(),
        })
    finally:
        with visual_jobs_in_flight_lock:
            visual_jobs_in_flight.discard(visual_key)


def _apply_upscaling(image_bytes: bytes, mode: str) -> bytes:
    from .visuals.upscaler import get_upscaler_for_mode
    import asyncio

    upscaler = get_upscaler_for_mode(mode)
    if upscaler is None:
        return image_bytes

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                result = pool.submit(asyncio.run, upscaler.upscale(image_bytes)).result()
        else:
            result = loop.run_until_complete(upscaler.upscale(image_bytes))
        return result
    except RuntimeError:
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            result = pool.submit(asyncio.run, upscaler.upscale(image_bytes)).result()
        return result


def _generate_derivatives_from_master(
    master_data: bytes,
    entity_type: str,
    visual_key: str,
) -> dict[str, bytes]:
    from PIL import Image as PILImage
    import io

    derivatives: dict[str, bytes] = {}
    master_img = PILImage.open(io.BytesIO(master_data))
    master_w, master_h = master_img.size

    derivative_configs = {
        "npc_portrait": {"size": (384, 384), "crop": "center"},
        "nav_background": {"size": (1024, 576), "crop": "wide"},
        "inventory_image": {"size": (256, 256), "crop": "center"},
        "skill_image": {"size": (256, 256), "crop": "center"},
        "item_image": {"size": (256, 256), "crop": "center"},
        "social_media_image": {"size": (512, 512), "crop": "center"},
        "message_attachment": {"size": (384, 384), "crop": "center"},
        "thumbnail": {"size": (128, 128), "crop": "center"},
    }

    for deriv_name, config in derivative_configs.items():
        target_w, target_h = config["size"]
        crop_mode = config["crop"]

        if crop_mode == "wide":
            aspect = target_w / target_h
            if master_w / master_h > aspect:
                new_w = int(master_h * aspect)
                left = (master_w - new_w) // 2
                box = (left, 0, left + new_w, master_h)
            else:
                new_h = int(master_w / aspect)
                top = (master_h - new_h) // 2
                box = (0, top, master_w, top + new_h)
        else:
            side = min(master_w, master_h)
            left = (master_w - side) // 2
            top = (master_h - side) // 2
            box = (left, top, left + side, top + side)

        cropped = master_img.crop(box)
        resized = cropped.resize((target_w, target_h), PILImage.LANCZOS)

        buf = io.BytesIO()
        resized.save(buf, format="PNG", optimize=False)
        derivatives[deriv_name] = buf.getvalue()

    return derivatives


def _save_derivatives(job: dict[str, Any], visual_key: str, derivatives: dict[str, bytes]) -> None:
    entity_type = job["entity_type"]
    base_folder = GENERATED_ASSET_DIR / "generated" / "derivatives" / visual_key
    base_folder.mkdir(parents=True, exist_ok=True)

    for deriv_name, deriv_data in derivatives.items():
        deriv_path = base_folder / f"{deriv_name}.png"
        deriv_path.write_bytes(deriv_data)

    with db_lock, db() as conn:
        row = conn.execute("select payload from image_assets where id=?", (visual_key,)).fetchone()
        if row:
            existing_payloads = decode(row["payload"], {})
            existing_payloads["derivatives"] = list(derivatives.keys())
            existing_payloads["derivatives_path"] = str(base_folder)
            conn.execute(
                "update image_assets set payload=? where id=?",
                (encode(existing_payloads), visual_key)
            )


def _process_builtin_job(job: dict[str, Any], visual_key: str, negative_prompt: str) -> None:
    from .visuals.model_manager import get_model_manager
    mgr = get_model_manager()
    entity_type = job["entity_type"]
    prompt = job["prompt"]

    enriched_prompt = enrich_prompt_for_model(prompt, "koji", entity_type, job.get("entity_data"))
    adapted_prompt = adapt_prompt_for_provider(enriched_prompt, "koji", entity_type)

    try:
        data, content_type, actual_model = mgr.generate_with_fallback(
            visual_type=entity_type,
            prompt=adapted_prompt,
            width=job["width"],
            height=job["height"],
            negative_prompt=negative_prompt,
        )
    except Exception as exc:
        raise RuntimeError(f"Koji generation failed: {exc}") from exc

    upscaling_mode = VISUAL_SETTINGS.get("upscaling_mode", "off")
    if upscaling_mode != "off":
        try:
            data = _apply_upscaling(data, upscaling_mode)
            actual_model = f"{actual_model}+upscaled"
        except Exception as exc:
            log.warning(f"Upscaling failed, using original image: {exc}")

    _save_generated_image(job, visual_key, data, content_type, actual_model)


def _process_user_api_job(job: dict[str, Any], visual_key: str, negative_prompt: str) -> None:
    """Generate via the user's external image API (backgrounds only path)."""
    from .uie_backend import AssetImagePayload
    entity_type = job["entity_type"]
    prompt = enrich_prompt_for_model(job["prompt"], "user_api", entity_type, job.get("entity_data"))

    # Build a settings dict that generate_image_bytes can consume
    api_settings: dict[str, Any] = {
        "provider": VISUAL_SETTINGS.get("user_api_provider", "openai"),
        "url": VISUAL_SETTINGS.get("user_api_url", ""),
        "key": VISUAL_SETTINGS.get("user_api_key", ""),
        "model": VISUAL_SETTINGS.get("user_api_model", ""),
    }

    payload = AssetImagePayload(
        asset_id=visual_key,
        name=job["entity_data"].get("name", ""),
        location_id=job["entity_data"].get("location", ""),
        kind=entity_type,
        prompt=prompt,
        width=job["width"],
        height=job["height"],
        provider_settings=api_settings,
    )
    data, content_type, provider_used = generate_image_bytes(payload)
    _save_generated_image(job, visual_key, data, content_type, f"user_api:{provider_used}")


def _process_custom_model_job(job: dict[str, Any], visual_key: str, negative_prompt: str) -> None:
    entity_type = job["entity_type"]
    prompt = job["prompt"]
    data, content_type, provider = custom_model_generate(
        prompt=prompt,
        negative_prompt=negative_prompt,
        width=job["width"],
        height=job["height"],
        entity_type=entity_type,
    )
    _save_generated_image(job, visual_key, data, content_type, "custom_model")


def _process_external_provider_job(job: dict[str, Any], visual_key: str, negative_prompt: str) -> None:
    from .uie_backend import AssetImagePayload
    adapted_prompt = adapt_prompt_for_provider(job["prompt"], job["provider"], job["entity_type"])
    payload = AssetImagePayload(
        asset_id=visual_key,
        name=job["entity_data"].get("name", ""),
        location_id=job["entity_data"].get("location", ""),
        kind=job["entity_type"],
        prompt=adapted_prompt,
        width=job["width"],
        height=job["height"],
        provider_settings={"provider": job["provider"]},
    )
    data, content_type, provider = generate_image_bytes(payload)
    _save_generated_image(job, visual_key, data, content_type, provider)


def _save_generated_image(job: dict[str, Any], visual_key: str, data: bytes, content_type: str, provider: str) -> None:
    ext = content_extension(content_type)
    file_path = generate_storage_path(job["entity_type"], visual_key, ext)
    file_path.write_bytes(data)
    url = f"/assets/image/file/{urlparse.quote(visual_key)}"
    thumbnail_url = None
    tools_applied: list[str] = []
    if "+upscaled" in provider:
        tools_applied.append("upscale")
    try:
        from PIL import Image as PILImage
        import io
        img = PILImage.open(io.BytesIO(data))
        thumb_size = (256, 256)
        if job["entity_type"] in ("location_bg", "nav_background"):
            thumb_size = (384, 216)
        img.thumbnail(thumb_size, PILImage.LANCZOS)
        thumb_path = generate_thumbnail_path(job["entity_type"], visual_key, ext)
        thumb_format = "JPEG" if ext in (".jpg", ".jpeg") else "PNG"
        img.save(thumb_path, thumb_format)
        thumbnail_url = f"/assets/image/file/{urlparse.quote(visual_key + '_thumb')}"
        tools_applied.append("thumbnail_create")
        with db_lock, db() as conn:
            row = conn.execute("select payload from image_assets where id=?", (visual_key,)).fetchone()
            if row:
                existing_payloads = decode(row["payload"], {})
                existing_payloads["thumbnail_url"] = thumbnail_url
                existing_payloads["image_model"] = provider
                existing_payloads["tools_applied"] = tools_applied
                conn.execute(
                    "update image_assets set payload=? where id=?",
                    (encode(existing_payloads), visual_key)
                )
    except Exception:
        pass

    if VISUAL_SETTINGS.get("generate_derivatives_from_master", True):
        try:
            derivatives = _generate_derivatives_from_master(data, job["entity_type"], visual_key)
            _save_derivatives(job, visual_key, derivatives)
            tools_applied.append("derivative_create")
        except Exception as exc:
            log.warning(f"Failed to generate derivatives: {exc}")

    with db_lock, db() as conn:
        row = conn.execute("select payload from image_assets where id=?", (visual_key,)).fetchone()
        if row:
            existing_payloads = decode(row["payload"], {})
            existing_payloads["image_model"] = provider
            existing_payloads["tools_applied"] = tools_applied
            if thumbnail_url:
                existing_payloads["thumbnail_url"] = thumbnail_url
            conn.execute(
                "update image_assets set payload=? where id=?",
                (encode(existing_payloads), visual_key)
            )

    update_image_asset_status(
        visual_key,
        status="ready",
        provider=provider,
        url=url,
        file_path=str(file_path),
        content_type=content_type,
        error="",
    )
    queue_ws_broadcast({
        "type": "visual_ready",
        "payload": {
            "visual_key": visual_key,
            "entity_type": job["entity_type"],
            "image_url": url,
            "thumbnail_url": thumbnail_url,
            "image_model": provider,
        },
        "ts": now_iso(),
    })


def visual_job_worker() -> None:
    while True:
        try:
            job = None
            with visual_job_queue_lock:
                if visual_job_queue:
                    with visual_jobs_in_flight_lock:
                        if len(visual_jobs_in_flight) < VISUAL_SETTINGS["max_concurrent_jobs"]:
                            job = visual_job_queue.pop(0)
            if job:
                process_visual_job(job)
            else:
                time.sleep(0.5)
        except Exception as exc:
            print(f"Visual job worker error: {exc}")
            time.sleep(1)


def request_visual_generation(
    entity_type: str,
    entity_id: str,
    entity_data: dict[str, Any] = None,
    provider: str = "auto",
    prompt_override: str = "",
    force: bool = False,
    priority: int = 5,
    style_preset: str = "",
    visual_type: str = "",
) -> dict[str, Any]:
    entity_data = entity_data or {}
    effective_type = visual_type or entity_type
    visual_key = generate_visual_key(effective_type, entity_id, entity_data)
    if not force:
        existing = get_visual_metadata(visual_key)
        if existing and existing["image_status"] == "complete":
            return existing
        if existing and existing.get("image_is_user_uploaded"):
            return existing
        if existing and existing.get("image_is_protected"):
            return existing
    resolved_style = style_preset or VISUAL_SETTINGS.get("default_style_preset", DEFAULT_STYLE_PRESET)
    prompt = prompt_override or build_prompt_from_template(effective_type, entity_data, resolved_style)
    if not prompt:
        prompt = prompt_override or build_visual_prompt(effective_type, entity_data, resolved_style)
    selected_provider = select_visual_provider(effective_type, provider)
    negative_prompt = get_negative_prompt(effective_type, selected_provider)
    enriched_prompt = enrich_prompt_for_model(prompt, selected_provider, effective_type, entity_data)
    adapted_prompt = adapt_prompt_for_provider(enriched_prompt, selected_provider, effective_type)
    entity_config = ENTITY_TYPES.get(effective_type, {"default_size": (512, 512)})
    width, height = entity_config["default_size"]
    backend_mode = VISUAL_SETTINGS.get("visual_backend_mode", "built_in_backend")
    metadata = save_visual_metadata(
        visual_key=visual_key,
        entity_type=effective_type,
        prompt=adapted_prompt,
        status="pending",
        provider=selected_provider,
        width=width,
        height=height,
        entity_data=entity_data,
        style_preset=resolved_style,
        negative_prompt=negative_prompt,
        backend_mode=backend_mode,
    )
    queued = queue_visual_job(
        visual_key=visual_key,
        entity_type=effective_type,
        prompt=adapted_prompt,
        provider=selected_provider,
        width=width,
        height=height,
        entity_data=entity_data,
        priority=priority,
        style_preset=resolved_style,
    )
    if not queued:
        return get_visual_metadata(visual_key) or metadata
    return metadata


def trigger_npc_portrait(npc_id: str, npc_data: dict[str, Any]) -> dict[str, Any] | None:
    if not VISUAL_SETTINGS.get("auto_generate_images") or not VISUAL_SETTINGS.get("generate_npc_portraits_on_creation"):
        return None
    return request_visual_generation("npc", npc_id, npc_data, priority=2)


def trigger_location_background(location_id: str, location_data: dict[str, Any]) -> dict[str, Any] | None:
    if not VISUAL_SETTINGS.get("auto_generate_images") or not VISUAL_SETTINGS.get("generate_location_backgrounds_on_creation"):
        return None
    return request_visual_generation("location_bg", location_id, location_data, priority=1)


def trigger_skill_art(skill_id: str, skill_data: dict[str, Any]) -> dict[str, Any] | None:
    if not VISUAL_SETTINGS.get("auto_generate_images") or not VISUAL_SETTINGS.get("generate_skill_art_on_creation"):
        return None
    return request_visual_generation("skill", skill_id, skill_data, priority=3)


def trigger_item_template_image(template_id: str, template_data: dict[str, Any]) -> dict[str, Any] | None:
    if "item_template" in MANUAL_ONLY_TYPES:
        return None
    if not VISUAL_SETTINGS.get("auto_generate_images") or not VISUAL_SETTINGS.get("generate_item_template_images_on_creation"):
        return None
    return request_visual_generation("item_template", template_id, template_data, priority=5)


def trigger_equipment_template_image(template_id: str, template_data: dict[str, Any]) -> dict[str, Any] | None:
    if "equipment_template" in MANUAL_ONLY_TYPES:
        return None
    if not VISUAL_SETTINGS.get("auto_generate_images") or not VISUAL_SETTINGS.get("generate_equipment_template_images_on_creation"):
        return None
    return request_visual_generation("equipment_template", template_id, template_data, priority=5)


def trigger_quest_visual(quest_id: str, quest_data: dict[str, Any]) -> dict[str, Any] | None:
    if not VISUAL_SETTINGS.get("auto_generate_images") or not VISUAL_SETTINGS.get("generate_quest_visuals_on_creation"):
        return None
    return request_visual_generation("quest", quest_id, quest_data, priority=4)


def trigger_faction_visual(faction_id: str, faction_data: dict[str, Any]) -> dict[str, Any] | None:
    if not VISUAL_SETTINGS.get("auto_generate_images") or not VISUAL_SETTINGS.get("generate_faction_visuals_on_creation"):
        return None
    return request_visual_generation("faction", faction_id, faction_data, priority=6)


def trigger_instavibe_profile_pic(character_id: str, character_data: dict[str, Any]) -> dict[str, Any] | None:
    if not VISUAL_SETTINGS.get("auto_generate_images") or not VISUAL_SETTINGS.get("generate_instavibe_profile_pics"):
        return None
    return request_visual_generation("instavibe_profile_pic", character_id, character_data, priority=4)


def trigger_instavibe_post_image(post_id: str, post_data: dict[str, Any]) -> dict[str, Any] | None:
    if not VISUAL_SETTINGS.get("auto_generate_images") or not VISUAL_SETTINGS.get("generate_instavibe_post_images"):
        return None
    return request_visual_generation("instavibe_post_image", post_id, post_data, priority=2)


def trigger_message_image(message_id: str, attachment_data: dict[str, Any]) -> dict[str, Any] | None:
    if not VISUAL_SETTINGS.get("auto_generate_images") or not VISUAL_SETTINGS.get("generate_message_images"):
        return None
    msg_type = attachment_data.get("group", False)
    entity_type = "group_message_image_attachment" if msg_type else "message_image_attachment"
    return request_visual_generation(entity_type, message_id, attachment_data, priority=1)


def trigger_character_selfie(character_id: str, selfie_data: dict[str, Any]) -> dict[str, Any] | None:
    if not VISUAL_SETTINGS.get("auto_generate_images"):
        return None
    return request_visual_generation("character_selfie", character_id, selfie_data, priority=3)


def start_visual_worker() -> None:
    worker_thread = threading.Thread(target=visual_job_worker, daemon=True)
    worker_thread.start()
    print("[VisualService] Visual generation worker started")
    _ensure_storage_folders()


def _ensure_storage_folders() -> None:
    folders = [
        "generated/npcs",
        "generated/skills",
        "generated/items",
        "generated/equipment",
        "generated/locations",
        "generated/factions",
        "generated/quests",
        "generated/instavibe/profiles",
        "generated/instavibe/posts",
        "generated/instavibe/stories",
        "generated/instavibe/profiles/thumbs",
        "generated/instavibe/posts/thumbs",
        "generated/messages",
        "generated/messages/thumbs",
        "generated/npcs/thumbs",
        "generated/items/thumbs",
        "generated/locations/thumbs",
    ]
    for folder in folders:
        (GENERATED_ASSET_DIR / folder).mkdir(parents=True, exist_ok=True)
