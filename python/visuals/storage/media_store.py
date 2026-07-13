from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image

log = logging.getLogger("visuals.storage")


def _get_generated_asset_dir() -> Path:
    env_dir = os.environ.get("VISUAL_ASSET_DIR", "")
    if env_dir:
        return Path(env_dir)
    root = Path(__file__).resolve().parents[4]
    return root / "data" / "generated_assets"


@dataclass
class MediaRecord:
    media_id: str
    entity_type: str
    entity_id: str
    visual_type: str
    visual_key: str
    status: str = "pending"
    provider: str = ""
    model: str = ""
    prompt: str = ""
    negative_prompt: str = ""
    original_path: str = ""
    master_path: str = ""
    display_path: str = ""
    thumbnail_path: str = ""
    transparent_path: str = ""
    wide_crop_path: str = ""
    inspection_report: dict[str, Any] = field(default_factory=dict)
    tools_applied: list[str] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "media_id": self.media_id,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "visual_type": self.visual_type,
            "visual_key": self.visual_key,
            "status": self.status,
            "provider": self.provider,
            "model": self.model,
            "prompt": self.prompt,
            "negative_prompt": self.negative_prompt,
            "original_path": self.original_path,
            "master_path": self.master_path,
            "display_path": self.display_path,
            "thumbnail_path": self.thumbnail_path,
            "transparent_path": self.transparent_path,
            "wide_crop_path": self.wide_crop_path,
            "inspection_report": self.inspection_report,
            "tools_applied": self.tools_applied,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class MediaStore:

    def __init__(self, base_dir: Path | None = None) -> None:
        self._base_dir = base_dir or _get_generated_asset_dir()
        self._base_dir.mkdir(parents=True, exist_ok=True)
        self._records: dict[str, MediaRecord] = {}

    def generate_media_id(self, visual_key: str) -> str:
        data = f"{visual_key}:{time.time()}"
        return f"media_{hashlib.sha256(data.encode()).hexdigest()[:16]}"

    def get_storage_dir(self, visual_type: str, visual_key: str) -> Path:
        folder_map = {
            "npc_portrait": "npcs",
            "character_portrait": "npcs",
            "nav_background": "locations",
            "location_bg": "locations",
            "item": "items",
            "equipment": "equipment",
            "weapon": "items",
            "skill": "skills",
            "spell": "skills",
            "faction": "factions",
            "quest": "quests",
            "quest_visual": "quests",
            "instavibe_profile_pic": "instavibe/profiles",
            "instavibe_post_image": "instavibe/posts",
            "instavibe_story_image": "instavibe/stories",
            "message_attachment": "messages",
            "group_message_image": "messages",
            "character_selfie": "messages",
            "location_photo": "instavibe/posts",
            "food_photo": "instavibe/posts",
            "outfit_photo": "instavibe/posts",
            "item_photo": "instavibe/posts",
            "event_photo": "instavibe/posts",
            "social_scene_image": "instavibe/posts",
            "social_media_post": "instavibe/posts",
            "building": "locations",
            "creature": "npcs",
            "vehicle": "misc",
        }
        folder = folder_map.get(visual_type, "misc")
        storage_dir = self._base_dir / "generated" / folder / visual_key
        storage_dir.mkdir(parents=True, exist_ok=True)
        return storage_dir

    async def save_original(self, visual_type: str, visual_key: str, image_bytes: bytes) -> str:
        storage_dir = self.get_storage_dir(visual_type, visual_key)
        path = storage_dir / "original.png"
        path.write_bytes(image_bytes)
        return str(path)

    async def save_master(self, visual_type: str, visual_key: str, image_bytes: bytes) -> str:
        storage_dir = self.get_storage_dir(visual_type, visual_key)
        path = storage_dir / "master.webp"
        img = Image.open(io.BytesIO(image_bytes))
        img.save(str(path), format="WEBP", quality=92, method=4)
        return str(path)

    async def save_display(self, visual_type: str, visual_key: str, image_bytes: bytes) -> str:
        storage_dir = self.get_storage_dir(visual_type, visual_key)
        path = storage_dir / "display.webp"
        img = Image.open(io.BytesIO(image_bytes))
        img.save(str(path), format="WEBP", quality=85, method=4)
        return str(path)

    async def save_thumbnail(self, visual_type: str, visual_key: str, image_bytes: bytes) -> str:
        storage_dir = self.get_storage_dir(visual_type, visual_key)
        path = storage_dir / "thumbnail.webp"
        img = Image.open(io.BytesIO(image_bytes))
        img.thumbnail((128, 128), Image.LANCZOS)
        img.save(str(path), format="WEBP", quality=75, method=4)
        return str(path)

    async def save_transparent(self, visual_type: str, visual_key: str, image_bytes: bytes) -> str:
        storage_dir = self.get_storage_dir(visual_type, visual_key)
        path = storage_dir / "transparent.png"
        path.write_bytes(image_bytes)
        return str(path)

    async def save_wide_crop(self, visual_type: str, visual_key: str, image_bytes: bytes) -> str:
        storage_dir = self.get_storage_dir(visual_type, visual_key)
        path = storage_dir / "wide_crop.webp"
        img = Image.open(io.BytesIO(image_bytes))
        img.save(str(path), format="WEBP", quality=85, method=4)
        return str(path)

    async def save_derivatives(
        self,
        master_bytes: bytes,
        visual_type: str,
        visual_key: str,
    ) -> dict[str, str]:
        from PIL import Image as PILImage

        paths: dict[str, str] = {}
        master_img = PILImage.open(io.BytesIO(master_bytes))
        master_w, master_h = master_img.size
        storage_dir = self.get_storage_dir(visual_type, visual_key)

        derivative_configs = {
            "npc_portrait": {"size": (384, 384), "crop": "center"},
            "nav_background": {"size": (1024, 576), "crop": "wide"},
            "inventory_image": {"size": (256, 256), "crop": "center"},
            "skill_image": {"size": (256, 256), "crop": "center"},
            "item_image": {"size": (256, 256), "crop": "center"},
            "social_media_image": {"size": (512, 512), "crop": "center"},
            "message_attachment": {"size": (384, 384), "crop": "center"},
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

            deriv_dir = storage_dir / "derivatives"
            deriv_dir.mkdir(parents=True, exist_ok=True)
            path = deriv_dir / f"{deriv_name}.webp"
            resized.save(str(path), format="WEBP", quality=85, method=4)
            paths[deriv_name] = str(path)

        return paths

    def save_record(self, record: MediaRecord) -> None:
        self._records[record.media_id] = record

    def get_record(self, media_id: str) -> MediaRecord | None:
        return self._records.get(media_id)

    def get_record_by_visual_key(self, visual_key: str) -> MediaRecord | None:
        for record in self._records.values():
            if record.visual_key == visual_key:
                return record
        return None

    def delete_media(self, media_id: str) -> bool:
        record = self._records.pop(media_id, None)
        if record is None:
            return False
        try:
            paths = [
                record.original_path,
                record.master_path,
                record.display_path,
                record.thumbnail_path,
                record.transparent_path,
                record.wide_crop_path,
            ]
            for p in paths:
                if p:
                    path = Path(p)
                    if path.exists():
                        path.unlink()
            storage_dir = self.get_storage_dir(record.visual_type, record.visual_key)
            if storage_dir.exists():
                import shutil
                shutil.rmtree(storage_dir, ignore_errors=True)
        except Exception as exc:
            log.warning(f"Failed to delete media files for {media_id}: {exc}")
        return True

    def path_to_url(self, path: str) -> str:
        try:
            base = str(self._base_dir)
            if path.startswith(base):
                relative = path[len(base):].lstrip("/\\")
                return f"/assets/generated/{relative.replace(os.sep, '/')}"
        except Exception:
            pass
        return path


_media_store: MediaStore | None = None


def get_media_store() -> MediaStore:
    global _media_store
    if _media_store is None:
        _media_store = MediaStore()
    return _media_store
