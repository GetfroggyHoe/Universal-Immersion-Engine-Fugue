from __future__ import annotations

import hashlib
import io
import logging
import struct
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from PIL import Image, ImageFilter, ImageStat

from ..schemas.types import (
    ImageCategory,
    ToolID,
    classify_visual_type,
    BACKGROUND_TYPES,
    ITEM_TYPES,
    PORTRAIT_TYPES,
    SKILL_TYPES,
)

log = logging.getLogger("visuals.inspector")


@dataclass
class InspectionReport:
    valid: bool = True
    blur_score: float = 0.0
    brightness_score: float = 0.0
    contrast_score: float = 0.0
    saturation_score: float = 0.0
    face_detected: bool = False
    face_count: int = 0
    subject_centered: bool = False
    text_detected: bool = False
    watermark_detected: bool = False
    crop_safe: bool = True
    background_complexity: float = 0.0
    resolution: tuple[int, int] = (0, 0)
    aspect_ratio: float = 0.0
    is_blank: bool = False
    is_corrupt: bool = False
    is_duplicate: bool = False
    duplicate_of: str | None = None
    composition_score: float = 0.0
    recommended_actions: list[str] = field(default_factory=list)
    image_category: str = ""
    perceptual_hash: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "blur_score": self.blur_score,
            "brightness_score": self.brightness_score,
            "contrast_score": self.contrast_score,
            "saturation_score": self.saturation_score,
            "face_detected": self.face_detected,
            "face_count": self.face_count,
            "subject_centered": self.subject_centered,
            "text_detected": self.text_detected,
            "watermark_detected": self.watermark_detected,
            "crop_safe": self.crop_safe,
            "background_complexity": self.background_complexity,
            "resolution": list(self.resolution),
            "aspect_ratio": self.aspect_ratio,
            "is_blank": self.is_blank,
            "is_corrupt": self.is_corrupt,
            "is_duplicate": self.is_duplicate,
            "duplicate_of": self.duplicate_of,
            "composition_score": self.composition_score,
            "recommended_actions": self.recommended_actions,
            "image_category": self.image_category,
            "perceptual_hash": self.perceptual_hash,
        }


class ImageInspector:

    def __init__(self) -> None:
        self._hash_cache: dict[str, str] = {}

    async def inspect(
        self,
        image_bytes: bytes,
        visual_type: str = "",
        target_usage: str = "",
    ) -> InspectionReport:
        report = InspectionReport()

        try:
            img = Image.open(io.BytesIO(image_bytes))
            img.load()
        except Exception as exc:
            log.warning(f"Corrupt image detected: {exc}")
            report.is_corrupt = True
            report.valid = False
            return report

        report.resolution = img.size
        report.aspect_ratio = img.size[0] / max(img.size[1], 1)
        report.image_category = classify_visual_type(visual_type).value if visual_type else ""

        if self._is_blank(img):
            report.is_blank = True
            report.valid = False
            return report

        rgb = img.convert("RGB")
        report.blur_score = self._detect_blur(rgb)
        report.brightness_score = self._measure_brightness(rgb)
        report.contrast_score = self._measure_contrast(rgb)
        report.saturation_score = self._measure_saturation(rgb)
        report.background_complexity = self._measure_background_complexity(rgb)
        report.composition_score = self._score_composition(rgb)
        report.crop_safe = self._check_crop_safety(rgb)
        report.perceptual_hash = self._compute_phash(rgb)

        if visual_type in PORTRAIT_TYPES:
            face_result = self._detect_faces(rgb)
            report.face_detected = face_result["detected"]
            report.face_count = face_result["count"]
            report.subject_centered = face_result["centered"] if face_result["detected"] else self._check_subject_centered(rgb)
        else:
            report.subject_centered = self._check_subject_centered(rgb)

        text_result = self._detect_text_watermark(rgb)
        report.text_detected = text_result["text"]
        report.watermark_detected = text_result["watermark"]

        report.is_duplicate, report.duplicate_of = self._check_duplicate(
            report.perceptual_hash
        )
        if report.is_duplicate:
            report.valid = False

        report.recommended_actions = self._recommend_actions(report, visual_type)

        if report.is_corrupt or report.is_blank:
            report.valid = False
        elif report.blur_score > 0.8 and report.contrast_score < 0.2:
            report.valid = False
        else:
            report.valid = True

        return report

    def _is_blank(self, img: Image.Image, threshold: float = 3.0) -> bool:
        try:
            gray = img.convert("L")
            small = gray.resize((16, 16), Image.LANCZOS)
            arr = np.array(small, dtype=np.float32)
            std_val = float(np.std(arr))

            edges = gray.filter(ImageFilter.FIND_EDGES)
            edge_small = edges.resize((16, 16), Image.LANCZOS)
            edge_arr = np.array(edge_small, dtype=np.float32)
            edge_mean = float(np.mean(edge_arr))

            if std_val < threshold and edge_mean < 5.0:
                return True
            if std_val < 1.0:
                return True
            return False
        except Exception:
            return False

    def _detect_blur(self, img: Image.Image) -> float:
        try:
            gray = img.convert("L")
            small = gray.resize((64, 64), Image.LANCZOS)
            arr = np.array(small, dtype=np.float32)

            laplacian_kernel = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float32)
            h, w = arr.shape
            result = np.zeros_like(arr)
            for y in range(1, h - 1):
                for x in range(1, w - 1):
                    patch = arr[y-1:y+2, x-1:x+2]
                    result[y, x] = np.sum(patch * laplacian_kernel)

            variance = float(np.var(result))
            max_expected = 2000.0
            score = 1.0 - min(variance / max_expected, 1.0)
            return round(score, 4)
        except Exception:
            return 0.5

    def _measure_brightness(self, img: Image.Image) -> float:
        try:
            gray = img.convert("L")
            stat = ImageStat.Stat(gray)
            mean_val = stat.mean[0]
            return round(mean_val / 255.0, 4)
        except Exception:
            return 0.5

    def _measure_contrast(self, img: Image.Image) -> float:
        try:
            gray = img.convert("L")
            stat = ImageStat.Stat(gray)
            std_dev = stat.stddev[0]
            return round(min(std_dev / 128.0, 1.0), 4)
        except Exception:
            return 0.5

    def _measure_saturation(self, img: Image.Image) -> float:
        try:
            hsv = img.convert("HSV")
            arr = np.array(hsv, dtype=np.float32)
            saturation_channel = arr[:, :, 1]
            mean_sat = float(np.mean(saturation_channel))
            return round(mean_sat / 255.0, 4)
        except Exception:
            return 0.5

    def _measure_background_complexity(self, img: Image.Image) -> float:
        try:
            small = img.convert("L").resize((32, 32), Image.LANCZOS)
            arr = np.array(small, dtype=np.float32)

            edges = img.convert("L").resize((32, 32), Image.LANCZOS)
            edges = edges.filter(ImageFilter.FIND_EDGES)
            edge_arr = np.array(edges, dtype=np.float32)
            edge_density = float(np.mean(edge_arr)) / 255.0

            center_h, center_w = 8, 8
            center_region = arr[8:24, 8:24]
            border_region = np.concatenate([
                arr[:8, :], arr[24:, :], arr[8:24, :8], arr[8:24, 24:]
            ])
            center_std = float(np.std(center_region))
            border_std = float(np.std(border_region))

            complexity = edge_density * 0.6 + (border_std / 128.0) * 0.4
            return round(min(complexity, 1.0), 4)
        except Exception:
            return 0.5

    def _score_composition(self, img: Image.Image) -> float:
        try:
            gray = img.convert("L").resize((32, 32), Image.LANCZOS)
            arr = np.array(gray, dtype=np.float32)

            h, w = arr.shape
            cx, cy = w // 2, h // 2

            center_weight = np.zeros_like(arr)
            for y in range(h):
                for x in range(w):
                    dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                    max_dist = (cx ** 2 + cy ** 2) ** 0.5
                    center_weight[y, x] = 1.0 - (dist / max_dist)

            brightness_weighted = arr * center_weight
            center_brightness = float(np.sum(brightness_weighted)) / float(np.sum(center_weight) * 255)

            edges = gray.filter(ImageFilter.FIND_EDGES)
            edge_arr = np.array(edges, dtype=np.float32)
            center_edges = float(np.sum(edge_arr * center_weight)) / float(np.sum(center_weight) * 255)

            score = center_brightness * 0.5 + center_edges * 0.5
            return round(min(max(score, 0.0), 1.0), 4)
        except Exception:
            return 0.5

    def _check_crop_safety(self, img: Image.Image, margin_pct: float = 0.1) -> bool:
        try:
            w, h = img.size
            margin_x = int(w * margin_pct)
            margin_y = int(h * margin_pct)

            gray = img.convert("L").resize((32, 32), Image.LANCZOS)
            arr = np.array(gray, dtype=np.float32)

            scale_x = 32 / w
            scale_y = 32 / h
            mx = max(int(margin_x * scale_x), 1)
            my = max(int(margin_y * scale_y), 1)

            edges = gray.filter(ImageFilter.FIND_EDGES)
            edge_arr = np.array(edges, dtype=np.float32)

            border_mask = np.ones((32, 32), dtype=bool)
            border_mask[my:32-my, mx:32-mx] = False
            border_edge_energy = float(np.mean(edge_arr[border_mask]))
            center_edge_energy = float(np.mean(edge_arr[~border_mask]))

            if border_edge_energy > center_edge_energy * 2.0:
                return False

            return True
        except Exception:
            return True

    def _detect_faces(self, img: Image.Image) -> dict[str, Any]:
        result = {"detected": False, "count": 0, "centered": False}
        try:
            skin_lower = np.array([0, 20, 50], dtype=np.uint8)
            skin_upper = np.array([35, 255, 255], dtype=np.uint8)

            ycrcb = img.convert("YCbCr")
            arr = np.array(ycrcb, dtype=np.uint8)

            skin_mask = np.all(
                (arr >= skin_lower) & (arr <= skin_upper),
                axis=2
            )

            skin_pixels = int(np.sum(skin_mask))
            total_pixels = skin_mask.shape[0] * skin_mask.shape[1]
            skin_ratio = skin_pixels / max(total_pixels, 1)

            if skin_ratio > 0.05:
                result["detected"] = True
                result["count"] = 1 if skin_ratio < 0.4 else 2

                rows = np.any(skin_mask, axis=1)
                cols = np.any(skin_mask, axis=0)
                if np.any(rows) and np.any(cols):
                    rmin, rmax = np.where(rows)[0][[0, -1]]
                    cmin, cmax = np.where(cols)[0][[0, -1]]
                    face_cx = (cmin + cmax) / 2.0
                    face_cy = (rmin + rmax) / 2.0
                    img_cx = skin_mask.shape[1] / 2.0
                    img_cy = skin_mask.shape[0] / 2.0
                    dist = ((face_cx - img_cx) ** 2 + (face_cy - img_cy) ** 2) ** 0.5
                    max_dist = (img_cx ** 2 + img_cy ** 2) ** 0.5
                    result["centered"] = dist / max_dist < 0.4
        except Exception:
            pass
        return result

    def _check_subject_centered(self, img: Image.Image) -> bool:
        try:
            gray = img.convert("L").resize((32, 32), Image.LANCZOS)
            arr = np.array(gray, dtype=np.float32)

            threshold = float(np.mean(arr)) + float(np.std(arr)) * 0.5
            mask = arr > threshold

            rows = np.any(mask, axis=1)
            cols = np.any(mask, axis=0)
            if not np.any(rows) or not np.any(cols):
                return False

            rmin, rmax = np.where(rows)[0][[0, -1]]
            cmin, cmax = np.where(cols)[0][[0, -1]]
            subj_cx = (cmin + cmax) / 2.0
            subj_cy = (rmin + rmax) / 2.0
            img_cx = 16.0
            img_cy = 16.0
            dist = ((subj_cx - img_cx) ** 2 + (subj_cy - img_cy) ** 2) ** 0.5
            return dist < 8.0
        except Exception:
            return True

    def _detect_text_watermark(self, img: Image.Image) -> dict[str, bool]:
        result = {"text": False, "watermark": False}
        try:
            gray = img.convert("L").resize((64, 64), Image.LANCZOS)
            edges = gray.filter(ImageFilter.FIND_EDGES)
            edge_arr = np.array(edges, dtype=np.float32)

            h, w = edge_arr.shape
            bottom_strip = edge_arr[int(h * 0.85):, :]
            right_strip = edge_arr[:, int(w * 0.8):]

            bottom_edge_density = float(np.mean(bottom_strip)) / 255.0
            right_edge_density = float(np.mean(right_strip)) / 255.0

            if bottom_edge_density > 0.15 or right_edge_density > 0.15:
                result["text"] = True

            overall_edge = float(np.mean(edge_arr)) / 255.0
            if overall_edge > 0.0 and bottom_edge_density / max(overall_edge, 0.001) > 3.0:
                result["watermark"] = True

        except Exception:
            pass
        return result

    def _compute_phash(self, img: Image.Image, hash_size: int = 16) -> str:
        try:
            small = img.convert("L").resize((hash_size + 1, hash_size), Image.LANCZOS)
            arr = np.array(small, dtype=np.float32)

            diff = arr[:, 1:] > arr[:, :-1]
            hash_bits = diff.flatten()

            hash_int = 0
            for bit in hash_bits:
                hash_int = (hash_int << 1) | int(bit)

            return format(hash_int, f"0{len(hash_bits)}x")
        except Exception:
            return ""

    def _check_duplicate(self, phash: str) -> tuple[bool, str | None]:
        if not phash:
            return False, None
        for existing_key, existing_hash in self._hash_cache.items():
            if self._hamming_distance(phash, existing_hash) < 10:
                return True, existing_key
        return False, None

    def register_hash(self, visual_key: str, phash: str) -> None:
        if phash:
            self._hash_cache[visual_key] = phash

    def _hamming_distance(self, hash1: str, hash2: str) -> int:
        if len(hash1) != len(hash2):
            return 999
        try:
            val1 = int(hash1, 16)
            val2 = int(hash2, 16)
            xor = val1 ^ val2
            return bin(xor).count("1")
        except (ValueError, TypeError):
            return 999

    def _recommend_actions(self, report: InspectionReport, visual_type: str) -> list[str]:
        actions: list[str] = []

        if report.blur_score > 0.5:
            if visual_type in {"npc_portrait", "character_portrait", "instavibe_profile_pic"}:
                actions.append(ToolID.ANIME_UPSCALE.value)
            elif report.resolution[0] < 768:
                actions.append(ToolID.ANIME_UPSCALE.value)

        if visual_type in PORTRAIT_TYPES and not report.subject_centered:
            actions.append(ToolID.SMART_CROP.value)

        if visual_type in ITEM_TYPES:
            actions.append(ToolID.BACKGROUND_REMOVE.value)
            if not report.subject_centered:
                if ToolID.SMART_CROP.value not in actions:
                    actions.append(ToolID.SMART_CROP.value)

        if report.brightness_score < 0.3 or report.brightness_score > 0.85:
            actions.append(ToolID.COLOR_OPTIMIZE.value)
        elif report.contrast_score < 0.3:
            if ToolID.COLOR_OPTIMIZE.value not in actions:
                actions.append(ToolID.COLOR_OPTIMIZE.value)
        elif report.saturation_score < 0.15 or report.saturation_score > 0.85:
            if ToolID.COLOR_OPTIMIZE.value not in actions:
                actions.append(ToolID.COLOR_OPTIMIZE.value)

        if visual_type in BACKGROUND_TYPES:
            actions.append(ToolID.NAVIGATION_OPTIMIZE.value)

        if report.blur_score > 0.6 and ToolID.SHARPEN.value not in actions:
            if ToolID.ANIME_UPSCALE.value not in actions:
                actions.append(ToolID.SHARPEN.value)

        if report.resolution[0] >= 512:
            actions.append(ToolID.THUMBNAIL_CREATE.value)
            actions.append(ToolID.COMPRESS.value)

        if visual_type in SKILL_TYPES and not report.subject_centered:
            if ToolID.SMART_CROP.value not in actions:
                actions.append(ToolID.SMART_CROP.value)

        return actions


_inspector_instance: ImageInspector | None = None


def get_inspector() -> ImageInspector:
    global _inspector_instance
    if _inspector_instance is None:
        _inspector_instance = ImageInspector()
    return _inspector_instance
