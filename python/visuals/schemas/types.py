from __future__ import annotations

import enum


class VisualType(str, enum.Enum):
    NPC_PORTRAIT = "npc_portrait"
    CHARACTER_PORTRAIT = "character_portrait"
    NAV_BACKGROUND = "nav_background"
    LOCATION_BG = "location_bg"
    ITEM = "item"
    EQUIPMENT = "equipment"
    WEAPON = "weapon"
    SKILL = "skill"
    SPELL = "spell"
    SOCIAL_MEDIA_POST = "social_media_post"
    MESSAGE_ATTACHMENT = "message_attachment"
    BUILDING = "building"
    CREATURE = "creature"
    VEHICLE = "vehicle"
    FACTION = "faction"
    QUEST = "quest"
    QUEST_VISUAL = "quest_visual"
    INSTAVIBE_PROFILE_PIC = "instavibe_profile_pic"
    INSTAVIBE_POST_IMAGE = "instavibe_post_image"
    INSTAVIBE_STORY_IMAGE = "instavibe_story_image"
    CHARACTER_SELFIE = "character_selfie"
    LOCATION_PHOTO = "location_photo"
    FOOD_PHOTO = "food_photo"
    OUTFIT_PHOTO = "outfit_photo"
    ITEM_PHOTO = "item_photo"
    EVENT_PHOTO = "event_photo"
    SOCIAL_SCENE_IMAGE = "social_scene_image"
    GROUP_MESSAGE_IMAGE = "group_message_image"


class EntityType(str, enum.Enum):
    NPC = "npc"
    SKILL = "skill"
    LOCATION_BG = "location_bg"
    NAV_BACKGROUND = "nav_background"
    FACTION = "faction"
    QUEST = "quest"
    QUEST_VISUAL = "quest_visual"
    ITEM_TEMPLATE = "item_template"
    EQUIPMENT_TEMPLATE = "equipment_template"
    INSTAVIBE_PROFILE_PIC = "instavibe_profile_pic"
    INSTAVIBE_POST_IMAGE = "instavibe_post_image"
    INSTAVIBE_STORY_IMAGE = "instavibe_story_image"
    MESSAGE_IMAGE_ATTACHMENT = "message_image_attachment"
    GROUP_MESSAGE_IMAGE_ATTACHMENT = "group_message_image_attachment"
    CHARACTER_SELFIE = "character_selfie"
    LOCATION_PHOTO = "location_photo"
    FOOD_PHOTO = "food_photo"
    OUTFIT_PHOTO = "outfit_photo"
    ITEM_PHOTO = "item_photo"
    EVENT_PHOTO = "event_photo"
    SOCIAL_SCENE_IMAGE = "social_scene_image"


class JobStatus(str, enum.Enum):
    QUEUED = "queued"
    PREPARING = "preparing"
    GENERATING = "generating"
    INSPECTING = "inspecting"
    PROCESSING = "processing"
    VALIDATING = "validating"
    SAVING = "saving"
    COMPLETE = "complete"
    COMPLETED_WITH_WARNING = "completed_with_warning"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Priority(str, enum.Enum):
    CRITICAL = "critical"
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"
    BACKGROUND = "background"


PRIORITY_VALUES: dict[str, int] = {
    Priority.CRITICAL: 1,
    Priority.HIGH: 2,
    Priority.NORMAL: 3,
    Priority.LOW: 4,
    Priority.BACKGROUND: 5,
}


class BackendMode(str, enum.Enum):
    BUILT_IN_BACKEND = "built_in_backend"
    NVIDIA_NIM = "nvidia_nim"
    CUSTOM_MODEL = "custom_model"
    HYBRID = "hybrid"
    MANUAL = "manual"


class ToolID(str, enum.Enum):
    ANIME_UPSCALE = "anime_upscale"
    SMART_CROP = "smart_crop"
    BACKGROUND_REMOVE = "background_remove"
    COLOR_OPTIMIZE = "color_optimize"
    NAVIGATION_OPTIMIZE = "navigation_optimize"
    SHARPEN = "sharpen"
    COMPRESS = "compress"
    DUPLICATE_CHECK = "duplicate_check"
    FORMAT_CONVERT = "format_convert"
    THUMBNAIL_CREATE = "thumbnail_create"
    ARTIFACT_DETECT = "artifact_detect"


class ImageCategory(str, enum.Enum):
    PORTRAIT = "portrait"
    BACKGROUND = "background"
    ITEM = "item"
    SKILL_ART = "skill_art"
    SOCIAL = "social"
    SCENE = "scene"
    PHOTO = "photo"


PORTRAIT_TYPES: frozenset[str] = frozenset({
    VisualType.NPC_PORTRAIT,
    VisualType.CHARACTER_PORTRAIT,
    VisualType.INSTAVIBE_PROFILE_PIC,
    VisualType.CHARACTER_SELFIE,
})

BACKGROUND_TYPES: frozenset[str] = frozenset({
    VisualType.NAV_BACKGROUND,
    VisualType.LOCATION_BG,
    VisualType.LOCATION_PHOTO,
    VisualType.BUILDING,
})

ITEM_TYPES: frozenset[str] = frozenset({
    VisualType.ITEM,
    VisualType.EQUIPMENT,
    VisualType.WEAPON,
    VisualType.ITEM_PHOTO,
})

SKILL_TYPES: frozenset[str] = frozenset({
    VisualType.SKILL,
    VisualType.SPELL,
})

SOCIAL_TYPES: frozenset[str] = frozenset({
    VisualType.SOCIAL_MEDIA_POST,
    VisualType.INSTAVIBE_POST_IMAGE,
    VisualType.INSTAVIBE_STORY_IMAGE,
    VisualType.OUTFIT_PHOTO,
    VisualType.FOOD_PHOTO,
    VisualType.EVENT_PHOTO,
    VisualType.SOCIAL_SCENE_IMAGE,
})

PHOTO_TYPES: frozenset[str] = frozenset({
    VisualType.MESSAGE_ATTACHMENT,
    VisualType.GROUP_MESSAGE_IMAGE,
    VisualType.CHARACTER_SELFIE,
    VisualType.LOCATION_PHOTO,
    VisualType.FOOD_PHOTO,
    VisualType.OUTFIT_PHOTO,
    VisualType.ITEM_PHOTO,
    VisualType.EVENT_PHOTO,
})


def classify_visual_type(visual_type: str) -> ImageCategory:
    if visual_type in PORTRAIT_TYPES:
        return ImageCategory.PORTRAIT
    if visual_type in BACKGROUND_TYPES:
        return ImageCategory.BACKGROUND
    if visual_type in ITEM_TYPES:
        return ImageCategory.ITEM
    if visual_type in SKILL_TYPES:
        return ImageCategory.SKILL_ART
    if visual_type in SOCIAL_TYPES:
        return ImageCategory.SOCIAL
    if visual_type in PHOTO_TYPES:
        return ImageCategory.PHOTO
    return ImageCategory.SCENE


ENTITY_TYPE_TO_VISUAL_TYPE: dict[str, str] = {
    EntityType.NPC: VisualType.NPC_PORTRAIT,
    EntityType.SKILL: VisualType.SKILL,
    EntityType.LOCATION_BG: VisualType.LOCATION_BG,
    EntityType.NAV_BACKGROUND: VisualType.NAV_BACKGROUND,
    EntityType.FACTION: VisualType.FACTION,
    EntityType.QUEST: VisualType.QUEST,
    EntityType.QUEST_VISUAL: VisualType.QUEST_VISUAL,
    EntityType.ITEM_TEMPLATE: VisualType.ITEM,
    EntityType.EQUIPMENT_TEMPLATE: VisualType.EQUIPMENT,
    EntityType.INSTAVIBE_PROFILE_PIC: VisualType.INSTAVIBE_PROFILE_PIC,
    EntityType.INSTAVIBE_POST_IMAGE: VisualType.INSTAVIBE_POST_IMAGE,
    EntityType.INSTAVIBE_STORY_IMAGE: VisualType.INSTAVIBE_STORY_IMAGE,
    EntityType.MESSAGE_IMAGE_ATTACHMENT: VisualType.MESSAGE_ATTACHMENT,
    EntityType.GROUP_MESSAGE_IMAGE_ATTACHMENT: VisualType.GROUP_MESSAGE_IMAGE,
    EntityType.CHARACTER_SELFIE: VisualType.CHARACTER_SELFIE,
    EntityType.LOCATION_PHOTO: VisualType.LOCATION_PHOTO,
    EntityType.FOOD_PHOTO: VisualType.FOOD_PHOTO,
    EntityType.OUTFIT_PHOTO: VisualType.OUTFIT_PHOTO,
    EntityType.ITEM_PHOTO: VisualType.ITEM_PHOTO,
    EntityType.EVENT_PHOTO: VisualType.EVENT_PHOTO,
    EntityType.SOCIAL_SCENE_IMAGE: VisualType.SOCIAL_SCENE_IMAGE,
}


VISUAL_TYPE_DEFAULT_SIZES: dict[str, tuple[int, int]] = {
    VisualType.NPC_PORTRAIT: (512, 512),
    VisualType.CHARACTER_PORTRAIT: (512, 512),
    VisualType.NAV_BACKGROUND: (1280, 720),
    VisualType.LOCATION_BG: (1280, 720),
    VisualType.ITEM: (512, 512),
    VisualType.EQUIPMENT: (512, 512),
    VisualType.WEAPON: (512, 512),
    VisualType.SKILL: (512, 512),
    VisualType.SPELL: (512, 512),
    VisualType.SOCIAL_MEDIA_POST: (768, 768),
    VisualType.MESSAGE_ATTACHMENT: (512, 512),
    VisualType.BUILDING: (1280, 720),
    VisualType.CREATURE: (512, 512),
    VisualType.VEHICLE: (768, 512),
    VisualType.FACTION: (512, 512),
    VisualType.QUEST: (768, 512),
    VisualType.QUEST_VISUAL: (768, 512),
    VisualType.INSTAVIBE_PROFILE_PIC: (512, 512),
    VisualType.INSTAVIBE_POST_IMAGE: (768, 768),
    VisualType.INSTAVIBE_STORY_IMAGE: (768, 1024),
    VisualType.CHARACTER_SELFIE: (512, 512),
    VisualType.LOCATION_PHOTO: (768, 512),
    VisualType.FOOD_PHOTO: (512, 512),
    VisualType.OUTFIT_PHOTO: (512, 768),
    VisualType.ITEM_PHOTO: (512, 512),
    VisualType.EVENT_PHOTO: (768, 512),
    VisualType.SOCIAL_SCENE_IMAGE: (768, 768),
    VisualType.GROUP_MESSAGE_IMAGE: (512, 512),
}
