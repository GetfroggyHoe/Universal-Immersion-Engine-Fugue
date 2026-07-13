#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import re
import shutil
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
PROCESSED = ASSETS / "processed"

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
SKIP_DIR_PARTS = {"processed", "_asset_processing_preview"}


@dataclass
class Cutout:
    source: Path
    output: Path
    bbox: tuple[int, int, int, int]
    tags: list[str]
    name: str
    category: str
    width: int
    height: int


def slugify(value: str, fallback: str = "asset") -> str:
    text = value.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or fallback


def tokenize(value: str) -> list[str]:
    text = re.sub(r"[_\-]+", " ", value.lower())
    words = re.findall(r"[a-z0-9]+", text)
    stop = {"chatgpt", "image", "jun", "june", "pm", "am", "png", "jpg", "jpeg", "file"}
    return [w for w in words if w not in stop and not re.fullmatch(r"\d{2,}", w)]


def unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in values:
        value = str(raw or "").strip().lower()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def read_food_names() -> list[str]:
    path = ROOT / "Food_Ingredient list (1).txt"
    if not path.exists():
        return []
    names: list[str] = []
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        item = re.sub(r"^\s*[*\-]\s*", "", line).strip()
        if item:
            names.append(item)
    return names


def read_food_overrides() -> dict[str, dict]:
    path = ASSETS / "Food" / "food-asset-overrides.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(key): value for key, value in data.items() if isinstance(value, dict)}


def bg_candidates(arr: np.ndarray) -> np.ndarray:
    rgb = arr[..., :3].astype(np.int16)
    h, w = rgb.shape[:2]
    strips = [
        rgb[: max(1, h // 40), :, :],
        rgb[h - max(1, h // 40) :, :, :],
        rgb[:, : max(1, w // 40), :],
        rgb[:, w - max(1, w // 40) :, :],
        rgb[:8, :8, :],
        rgb[:8, -8:, :],
        rgb[-8:, :8, :],
        rgb[-8:, -8:, :],
    ]
    samples = np.concatenate([s.reshape(-1, 3) for s in strips], axis=0)
    if len(samples) > 20000:
        samples = samples[:: max(1, len(samples) // 20000)]
    median = np.median(samples, axis=0)
    corners = np.array(
        [
            rgb[0, 0],
            rgb[0, -1],
            rgb[-1, 0],
            rgb[-1, -1],
            median,
        ],
        dtype=np.int16,
    )
    return corners


def foreground_mask(image: Image.Image) -> np.ndarray:
    im = image.convert("RGBA")
    arr = np.asarray(im)
    alpha = arr[..., 3]
    if alpha.min() < 250:
        mask = alpha > 24
    else:
        rgb = arr[..., :3].astype(np.int32)
        candidates = bg_candidates(arr)
        candidates = candidates.astype(np.int32)
        dist = np.min(np.sqrt(np.sum((rgb[:, :, None, :] - candidates[None, None, :, :]) ** 2, axis=3)), axis=2)
        gray = np.mean(rgb, axis=2)
        sat = rgb.max(axis=2) - rgb.min(axis=2)
        bg_brightness = float(np.mean(candidates.mean(axis=1)))
        tolerance = 42 if 28 < bg_brightness < 225 else 30
        mask = dist > tolerance
        if bg_brightness < 35:
            mask |= (gray > 44) & (sat > 8)
        if bg_brightness > 220:
            mask |= (gray < 220) & (sat > 7)

    pil_mask = Image.fromarray((mask.astype(np.uint8) * 255), "L")
    pil_mask = pil_mask.filter(ImageFilter.MedianFilter(3))
    pil_mask = pil_mask.filter(ImageFilter.MaxFilter(3))
    pil_mask = pil_mask.filter(ImageFilter.GaussianBlur(0.6))
    return np.asarray(pil_mask) > 24


def connected_components_exact(mask: np.ndarray, min_area: int, max_components: int = 256) -> list[tuple[int, int, int, int, int]]:
    h, w = mask.shape
    visited = np.zeros(mask.shape, dtype=bool)
    comps: list[tuple[int, int, int, int, int]] = []
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if visited[y0, x0] or not mask[y0, x0]:
            continue
        q: deque[tuple[int, int]] = deque([(int(y0), int(x0))])
        visited[y0, x0] = True
        minx = maxx = int(x0)
        miny = maxy = int(y0)
        area = 0
        while q:
            y, x = q.popleft()
            area += 1
            minx = min(minx, x)
            maxx = max(maxx, x)
            miny = min(miny, y)
            maxy = max(maxy, y)
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not visited[ny, nx]:
                    visited[ny, nx] = True
                    q.append((ny, nx))
        if area >= min_area:
            comps.append((minx, miny, maxx + 1, maxy + 1, area))
            if len(comps) >= max_components:
                break
    comps.sort(key=lambda c: (c[1], c[0]))
    return comps


def connected_components(mask: np.ndarray, min_area: int, max_components: int = 256) -> list[tuple[int, int, int, int, int]]:
    h0, w0 = mask.shape
    factor = 1
    if max(h0, w0) >= 1400:
        factor = 4
    elif max(h0, w0) >= 900:
        factor = 3
    if factor > 1:
        small = Image.fromarray((mask.astype(np.uint8) * 255), "L").resize(
            (max(1, w0 // factor), max(1, h0 // factor)),
            Image.Resampling.NEAREST,
        )
        comps = connected_components(np.asarray(small) > 0, max(8, min_area // (factor * factor)), max_components)
        refined: list[tuple[int, int, int, int, int]] = []
        for x1, y1, x2, y2, _area in comps:
            ox1 = max(0, x1 * factor - factor)
            oy1 = max(0, y1 * factor - factor)
            ox2 = min(w0, x2 * factor + factor)
            oy2 = min(h0, y2 * factor + factor)
            local = mask[oy1:oy2, ox1:ox2]
            exact = connected_components_exact(local, max(8, min_area // 2), max_components=24)
            for lx1, ly1, lx2, ly2, area in exact:
                if area >= min_area:
                    refined.append((ox1 + lx1, oy1 + ly1, ox1 + lx2, oy1 + ly2, area))
        refined.sort(key=lambda c: (c[1], c[0]))
        return refined[:max_components]

    return connected_components_exact(mask, min_area, max_components)


def crop_with_alpha(image: Image.Image, mask: np.ndarray, bbox: tuple[int, int, int, int], pad: int = 6) -> Image.Image:
    im = image.convert("RGBA")
    w, h = im.size
    x1, y1, x2, y2 = bbox
    x1 = max(0, x1 - pad)
    y1 = max(0, y1 - pad)
    x2 = min(w, x2 + pad)
    y2 = min(h, y2 + pad)
    crop = im.crop((x1, y1, x2, y2))
    local = Image.fromarray((mask[y1:y2, x1:x2].astype(np.uint8) * 255), "L")
    local = local.filter(ImageFilter.GaussianBlur(0.6))
    crop.putalpha(local)
    return crop


def trim_alpha(image: Image.Image, pad: int = 2) -> Image.Image:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        return image
    x1, y1, x2, y2 = bbox
    x1 = max(0, x1 - pad)
    y1 = max(0, y1 - pad)
    x2 = min(image.width, x2 + pad)
    y2 = min(image.height, y2 + pad)
    return image.crop((x1, y1, x2, y2))


def dominant_color_tags(image: Image.Image) -> list[str]:
    rgba = np.asarray(image.convert("RGBA").resize((64, 64), Image.Resampling.LANCZOS))
    alpha = rgba[..., 3] > 32
    if not alpha.any():
        return []
    rgb = rgba[..., :3][alpha].astype(np.float32)
    avg = rgb.mean(axis=0)
    r, g, b = avg
    tags: list[str] = []
    if max(avg) - min(avg) < 22:
        if avg.mean() > 210:
            tags.append("white")
        elif avg.mean() < 55:
            tags.append("black")
        else:
            tags.append("gray")
    else:
        if r > 150 and g < 105 and b < 105:
            tags.append("red")
        if r > 150 and g > 105 and b < 90:
            tags.append("orange")
        if r > 160 and g > 145 and b < 120:
            tags.append("yellow")
        if g > 120 and r < 135:
            tags.append("green")
        if b > 130 and r < 135:
            tags.append("blue")
        if r > 120 and b > 120 and g < 115:
            tags.append("purple")
        if r > 95 and g > 55 and b < 55:
            tags.append("brown")
    return tags[:3]


def shape_tags(width: int, height: int) -> list[str]:
    ratio = width / max(1, height)
    tags = ["flat"] if ratio > 1.8 else ["long"] if ratio < 0.55 else ["round"]
    if 0.75 <= ratio <= 1.35:
        tags.append("square")
    if width * height < 9000:
        tags.append("small")
    return tags


def category_from_tokens(tokens: list[str], fallback: str) -> str:
    text = " ".join(tokens)
    if re.search(r"shirt|tee|jacket|coat|hoodie|vest|sweater|top|dress|skirt|pants|jeans|shorts|robe|uniform|clothes|clothing", text):
        return "clothing"
    if re.search(r"bag|purse|satchel|backpack|tote|case|pouch", text):
        return "bag"
    if re.search(r"sword|blade|axe|bow|gun|rifle|pistol|dagger|staff|wand|mace|spear", text):
        return "weapon"
    if re.search(r"ring|necklace|amulet|bracelet|gem|jewel|earring", text):
        return "jewelry"
    if re.search(r"food|meal|drink|meat|pasta|bread|fruit|vegetable|spice|season", text):
        return "food"
    if re.search(r"plate|panel|board|inventory|modal|frame|corner|trim|wood|parchment", text):
        return "inventory-plate"
    return fallback


def tags_for(name: str, category: str, image: Image.Image, extra: list[str] | None = None) -> list[str]:
    tokens = tokenize(name)
    tags = [category, *tokens, *dominant_color_tags(image), *shape_tags(image.width, image.height)]
    if extra:
        tags.extend(extra)
    if category == "food":
        food_words = {"raw", "cooked", "meat", "drink", "fruit", "vegetable", "spice", "seasoning", "ingredient", "meal"}
        tags.extend(w for w in tokens if w in food_words)
    return unique(tags)


def safe_save(image: Image.Image, out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    final = out_path
    counter = 2
    while final.exists():
        final = out_path.with_name(f"{out_path.stem}-{counter}{out_path.suffix}")
        counter += 1
    image.save(final)
    return final


def process_single_asset(path: Path, output_dir: Path, name_hint: str, category: str, extra_tags: list[str]) -> Cutout | None:
    image = Image.open(path).convert("RGBA")
    mask = foreground_mask(image)
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    cut = trim_alpha(crop_with_alpha(image, mask, bbox, pad=8), pad=2)
    name = name_hint.strip() or path.stem
    out = safe_save(cut, output_dir / f"{slugify(name)}.png")
    return Cutout(path, out, bbox, tags_for(name, category, cut, extra_tags), name, category, cut.width, cut.height)


def process_sheet(path: Path, output_dir: Path, category: str, extra_tags: list[str], min_area: int | None = None) -> list[Cutout]:
    image = Image.open(path).convert("RGBA")
    mask = foreground_mask(image)
    w, h = image.size
    threshold = min_area or max(140, int(w * h * 0.00022))
    comps = connected_components(mask, min_area=threshold, max_components=180)
    results: list[Cutout] = []
    base_tokens = tokenize(path.stem)
    base_category = category_from_tokens(base_tokens, category)
    for index, comp in enumerate(comps, start=1):
        x1, y1, x2, y2, area = comp
        if (x2 - x1) < 10 or (y2 - y1) < 10:
            continue
        cut = trim_alpha(crop_with_alpha(image, mask, (x1, y1, x2, y2), pad=6), pad=2)
        if cut.width < 12 or cut.height < 12:
            continue
        name = f"{path.stem} {index:03d}"
        out = safe_save(cut, output_dir / f"{slugify(path.stem)}-{index:03d}.png")
        tags = tags_for(name, base_category, cut, [*extra_tags, *base_tokens])
        results.append(Cutout(path, out, (x1, y1, x2, y2), tags, name, base_category, cut.width, cut.height))
    return results


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def cutout_record(cut: Cutout) -> dict:
    asset_id = slugify(f"{cut.category}-{cut.name}")
    macros = [
        {
            "id": f"{asset_id}-inspect",
            "label": f"Inspect {cut.name}",
            "command": f"Inspect the {cut.name}. Describe its visible qualities, condition, and likely use.",
            "tags": ["inspect", cut.category],
        }
    ]
    if cut.category == "food":
        macros.extend([
            {
                "id": f"{asset_id}-eat",
                "label": f"Eat {cut.name}",
                "command": f"Eat the {cut.name}. Apply hunger/energy recovery if appropriate.",
                "tags": ["use", "eat", "food"],
            },
            {
                "id": f"{asset_id}-prep",
                "label": f"Prep {cut.name}",
                "command": f"Prepare the {cut.name} as a kitchen ingredient. Use its tags to decide chopping, seasoning, cooking, or serving steps.",
                "tags": ["kitchen", "prep", "food"],
            },
        ])
    elif cut.category in {"weapon", "clothing", "jewelry", "bag"}:
        macros.append({
            "id": f"{asset_id}-equip",
            "label": f"Equip {cut.name}",
            "command": f"Equip or wear the {cut.name} if the scene allows it.",
            "tags": ["use", "equip", cut.category],
        })
    else:
        macros.append({
            "id": f"{asset_id}-use",
            "label": f"Use {cut.name}",
            "command": f"Use the {cut.name} in the current scene if it has a practical function.",
            "tags": ["use", cut.category],
        })
    return {
        "id": asset_id,
        "name": cut.name,
        "category": cut.category,
        "source": rel(cut.source),
        "path": rel(cut.output),
        "bbox": list(cut.bbox),
        "size": [cut.width, cut.height],
        "tags": cut.tags,
        "macros": macros,
    }


def write_js_mapping(path: Path, mapping_name: str, mapping: dict[str, str]) -> None:
    lines = [
        "/**",
        " * Generated by scripts/process-inventory-food-assets.py.",
        " * Maps original assets to transparent, tagged processed PNGs.",
        " */",
        f"export const {mapping_name} = {json.dumps(mapping, indent=2)};",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def process_all() -> dict:
    if PROCESSED.exists():
        for child in ("inventory-plates", "items-equipment", "food", "misc"):
            target = PROCESSED / child
            if target.exists() and target.resolve().is_relative_to(PROCESSED.resolve()):
                shutil.rmtree(target)
        manifest = PROCESSED / "asset-tags.json"
        if manifest.exists():
            manifest.unlink()

    food_names = read_food_names()
    food_overrides = read_food_overrides()
    food_name_index = 0

    manifests: dict[str, list[dict]] = {
        "inventoryPlates": [],
        "itemsEquipment": [],
        "food": [],
        "misc": [],
    }
    mappings: dict[str, dict[str, str]] = {
        "food": {},
        "itemsEquipment": {},
        "inventoryPlates": {},
        "misc": {},
    }

    plate_dir = ASSETS / "ui" / "Modal Plates"
    for path in sorted(plate_dir.glob("*")):
        if path.suffix.lower() not in IMAGE_EXTS:
            continue
        cuts = process_sheet(path, PROCESSED / "inventory-plates", "inventory-plate", ["ui", "modal", "plate", "layout"], min_area=500)
        if not cuts:
            cut = process_single_asset(path, PROCESSED / "inventory-plates", path.stem, "inventory-plate", ["ui", "modal", "layout"])
            cuts = [cut] if cut else []
        for cut in cuts:
            manifests["inventoryPlates"].append(cutout_record(cut))
            mappings["inventoryPlates"].setdefault(rel(path), rel(cut.output))

    items_dir = ASSETS / "Items & Equipment"
    for path in sorted(items_dir.glob("*")):
        if path.suffix.lower() not in IMAGE_EXTS:
            continue
        cuts = process_sheet(path, PROCESSED / "items-equipment", "item", ["inventory", "equipment"])
        for index, cut in enumerate(cuts, start=1):
            manifests["itemsEquipment"].append(cutout_record(cut))
            mappings["itemsEquipment"][f"{rel(path)}#{index:03d}"] = rel(cut.output)

    food_dir = ASSETS / "Food"
    for path in sorted(food_dir.rglob("*")):
        if path.suffix.lower() not in IMAGE_EXTS:
            continue
        if any(part in SKIP_DIR_PARTS for part in path.parts):
            continue
        if path.name == "foodTags.js":
            continue
        rel_food_path = path.relative_to(food_dir).as_posix()
        override = food_overrides.get(rel_food_path) or {}
        override_name = str(override.get("name") or "").strip()
        override_tags = override.get("tags") if isinstance(override.get("tags"), list) else []
        name_hint = override_name or path.stem
        stem_tokens = tokenize(path.stem)
        if not override_name and food_name_index < len(food_names) and not stem_tokens:
            name_hint = food_names[food_name_index]
        elif not override_name and re.search(r"^(1000|17|file|screenshot|chatgpt)", path.stem.lower()) and food_name_index < len(food_names):
            name_hint = food_names[food_name_index]
        food_name_index += 1

        folder_tags = tokenize(path.parent.name)
        if path.parent.name.lower().startswith("cooked"):
            folder_tags.append("cooked")
        if "ingredient" in path.parent.name.lower():
            folder_tags.append("ingredient")
        if "drink" in path.parent.name.lower():
            folder_tags.append("drink")
        if "spice" in path.parent.name.lower() or "season" in path.parent.name.lower():
            folder_tags.extend(["spice", "seasoning"])
        if "meal" in path.parent.name.lower():
            folder_tags.append("meal")
        cut = process_single_asset(path, PROCESSED / "food" / path.parent.name, name_hint, "food", folder_tags)
        if cut:
            if override_name:
                cut.name = override_name
            if override_tags:
                cut.tags = unique([str(tag) for tag in override_tags])
            manifests["food"].append(cutout_record(cut))
            mappings["food"][rel_food_path] = rel(cut.output)

    misc_dir = ASSETS / "Misc"
    for path in sorted(misc_dir.rglob("*")):
        if path.suffix.lower() not in IMAGE_EXTS:
            continue
        if any(part in SKIP_DIR_PARTS for part in path.parts):
            continue
        rel_misc_path = path.relative_to(misc_dir).as_posix()
        folder_tags = tokenize(path.parent.name)
        stem_tags = tokenize(path.stem)
        category = "misc"
        tag_blob = " ".join(folder_tags + stem_tags)
        if "key" in tag_blob:
            category = "key"
            folder_tags.extend(["key", "lock", "access"])
        elif "book" in tag_blob or "journal" in tag_blob or "tome" in tag_blob:
            category = "book"
            folder_tags.extend(["book", "reading", "record"])
        elif "letter" in tag_blob or "mail" in tag_blob or "envelope" in tag_blob or "document" in tag_blob:
            category = "letter"
            folder_tags.extend(["letter", "document", "message"])
        else:
            folder_tags.extend(["misc", "quest item", "prop"])
        cut = process_single_asset(path, PROCESSED / "misc" / path.parent.name, path.stem, category, folder_tags)
        if cut:
            name_words = tokenize(path.stem)
            if cut.width < cut.height * 0.62:
                cut.category = "key"
                cut.name = "Ornate Key" if "sprite" in path.stem.lower() else "Utility Key"
                cut.tags = unique(cut.tags + ["misc", "key", "lock", "access", "quest item", "unlock", "metal"])
            elif "sprite" in path.stem.lower():
                cut.category = "book"
                cut.name = "Fantasy Book"
                cut.tags = unique(cut.tags + ["misc", "book", "tome", "journal", "record", "quest item", "reading"])
            elif cut.width > cut.height * 1.12:
                cut.category = "letter"
                cut.name = "Letter Bundle" if any(token in name_words for token in ["bundle", "stack"]) else "Sealed Letter"
                cut.tags = unique(cut.tags + ["misc", "letter", "document", "message", "mail", "quest item", "paper"])
            else:
                cut.category = "misc"
                cut.name = "Quest Item"
                cut.tags = unique(cut.tags + ["misc", "quest item", "prop", "inventory item"])
            manifests["misc"].append(cutout_record(cut))
            mappings["misc"][rel_misc_path] = rel(cut.output)

    manifest_path = PROCESSED / "asset-tags.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifests, indent=2), encoding="utf-8")
    public_manifest_path = ASSETS / "asset-manifest.json"
    try:
        public_manifest = json.loads(public_manifest_path.read_text(encoding="utf-8")) if public_manifest_path.exists() else {}
    except json.JSONDecodeError:
        public_manifest = {}
    if not isinstance(public_manifest, dict):
        public_manifest = {}
    public_manifest.setdefault("sprites", [])
    public_manifest.setdefault("backgrounds", [])
    public_manifest.setdefault("audio", [])
    public_manifest["processedAssets"] = {
        "manifest": rel(manifest_path),
        "inventoryPlates": len(manifests["inventoryPlates"]),
        "itemsEquipment": len(manifests["itemsEquipment"]),
        "food": len(manifests["food"]),
        "misc": len(manifests["misc"]),
    }
    public_manifest["paks"] = {
        "food": "assets/paks/food.apak.json",
        "misc": "assets/paks/misc.apak.json",
    }
    public_manifest_path.write_text(json.dumps(public_manifest, indent=2), encoding="utf-8")
    write_js_mapping(ASSETS / "Food" / "foodTags.js", "FOOD_TAGS", mappings["food"])
    write_js_mapping(ROOT / "foodTags.js", "FOOD_TAGS", mappings["food"])
    write_js_mapping(ASSETS / "Misc" / "miscTags.js", "MISC_TAGS", mappings["misc"])

    return {
        "manifest": rel(manifest_path),
        "inventoryPlates": len(manifests["inventoryPlates"]),
        "itemsEquipment": len(manifests["itemsEquipment"]),
        "food": len(manifests["food"]),
        "misc": len(manifests["misc"]),
    }


if __name__ == "__main__":
    summary = process_all()
    print(json.dumps(summary, indent=2))
