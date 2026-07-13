#!/usr/bin/env python3
"""
Process raw layer images into transparent, anchored 1024x1024 PNG files.

This script removes backgrounds with rembg, trims to the alpha bounds, scales the
cutout into a fixed canvas, and places a chosen source anchor on a chosen canvas
anchor. That anchor step is the important part for asymmetric assets: a long
ponytail can make the alpha bounding box wider on one side, but the scalp can
still stay aligned to the master head coordinate.

Install:
    pip install rembg Pillow onnxruntime

Basic usage:
    python scripts/process_layer_assets.py raw_images processed_layers --recursive

Use an anchor config for layer-specific anchors:
    python scripts/process_layer_assets.py raw_images processed_layers ^
        --recursive --anchor-config assets/layer-anchor-config.example.json

Default anchoring:
    source_anchor.x = image-center
    source_anchor.y = content-bottom
    canvas_anchor.x = safe-center
    canvas_anchor.y = safe-bottom

For a hair layer, override the source/canvas anchor to the scalp coordinate
instead of the bottom of the cutout. See assets/layer-anchor-config.example.json.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover - handled at runtime with a clearer error.
    Image = None
    ImageOps = None

try:
    from rembg import new_session, remove
except ImportError:  # pragma: no cover - handled at runtime with a clearer error.
    new_session = None
    remove = None


SUPPORTED_EXTENSIONS = {
    ".bmp",
    ".jpeg",
    ".jpg",
    ".png",
    ".tif",
    ".tiff",
    ".webp",
}

DEFAULT_CONFIG: dict[str, Any] = {
    "defaults": {
        "source_anchor": {"x": "image-center", "y": "content-bottom"},
        "canvas_anchor": {"x": "safe-center", "y": "safe-bottom"},
        "scale": 1.0,
    },
    "groups": [],
    "files": {},
}


@dataclass(frozen=True)
class ProcessResult:
    source: str
    output: str
    size: int
    alpha_bbox: tuple[int, int, int, int]
    source_anchor: tuple[float, float]
    canvas_anchor: tuple[float, float]
    anchor_in_crop: tuple[float, float]
    scale: float
    paste_box: tuple[int, int, int, int]
    layer_config: dict[str, Any]


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_config(path: Path | None) -> dict[str, Any]:
    config = DEFAULT_CONFIG
    if path is not None:
        with path.open("r", encoding="utf-8") as handle:
            loaded = json.load(handle)
        config = deep_merge(config, loaded)
    return config


def apply_cli_anchor_overrides(config: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    overrides: dict[str, Any] = {}
    if args.source_anchor_x is not None or args.source_anchor_y is not None:
        overrides["source_anchor"] = {}
        if args.source_anchor_x is not None:
            overrides["source_anchor"]["x"] = args.source_anchor_x
        if args.source_anchor_y is not None:
            overrides["source_anchor"]["y"] = args.source_anchor_y
    if args.canvas_anchor_x is not None or args.canvas_anchor_y is not None:
        overrides["canvas_anchor"] = {}
        if args.canvas_anchor_x is not None:
            overrides["canvas_anchor"]["x"] = args.canvas_anchor_x
        if args.canvas_anchor_y is not None:
            overrides["canvas_anchor"]["y"] = args.canvas_anchor_y
    if args.scale != 1.0:
        overrides["scale"] = args.scale

    if not overrides:
        return config

    updated = dict(config)
    updated["defaults"] = deep_merge(config.get("defaults", {}), overrides)
    return updated


def layer_config_for(path: Path, input_dir: Path, config: dict[str, Any]) -> dict[str, Any]:
    relative = path.relative_to(input_dir).as_posix()
    relative_lower = relative.lower()
    name_lower = path.name.lower()
    stem_lower = path.stem.lower()

    layer_config = dict(config.get("defaults", {}))

    for group in config.get("groups", []):
        if not isinstance(group, dict):
            continue

        matches = False
        contains = group.get("match") or group.get("contains")
        glob_pattern = group.get("glob")

        if isinstance(contains, str) and contains.lower() in relative_lower:
            matches = True
        if isinstance(glob_pattern, str) and fnmatch.fnmatch(relative_lower, glob_pattern.lower()):
            matches = True

        if matches:
            layer_config = deep_merge(layer_config, {k: v for k, v in group.items() if k not in {"match", "contains", "glob"}})

    files = config.get("files", {})
    if isinstance(files, dict):
        for key in (relative, path.name, path.stem, relative_lower, name_lower, stem_lower):
            override = files.get(key)
            if isinstance(override, dict):
                layer_config = deep_merge(layer_config, override)

    return layer_config


def parse_number_or_percent(value: str) -> float | None:
    text = value.strip()
    if text.endswith("%"):
        return float(text[:-1]) / 100.0
    try:
        return float(text)
    except ValueError:
        return None


def resolve_axis(
    spec: Any,
    length: int,
    content_min: int,
    content_max: int,
    safe_min: int,
    safe_max: int,
) -> float:
    if isinstance(spec, (int, float)):
        value = float(spec)
        return value * length if 0.0 <= value <= 1.0 else value

    if not isinstance(spec, str):
        raise ValueError(f"Anchor axis must be a number or string, got {spec!r}")

    text = spec.strip().lower()
    parsed = parse_number_or_percent(text)
    if parsed is not None:
        return parsed * length if 0.0 <= parsed <= 1.0 else parsed

    aliases = {
        "center": "image-center",
        "middle": "image-center",
        "left": "image-left",
        "right": "image-right",
        "top": "image-top",
        "bottom": "image-bottom",
    }
    text = aliases.get(text, text)

    if "-" not in text:
        raise ValueError(f"Unknown anchor axis value: {spec!r}")

    basis, edge = text.split("-", 1)
    if basis in {"image", "canvas"}:
        min_value, max_value = 0.0, float(length)
    elif basis == "content":
        min_value, max_value = float(content_min), float(content_max)
    elif basis == "safe":
        min_value, max_value = float(safe_min), float(safe_max)
    else:
        raise ValueError(f"Unknown anchor basis {basis!r} in {spec!r}")

    if edge in {"left", "top"}:
        return min_value
    if edge in {"center", "middle"}:
        return (min_value + max_value) / 2.0
    if edge in {"right", "bottom"}:
        return max_value

    raise ValueError(f"Unknown anchor edge {edge!r} in {spec!r}")


def resolve_anchor(
    anchor_spec: dict[str, Any],
    width: int,
    height: int,
    bbox: tuple[int, int, int, int],
    padding: int,
) -> tuple[float, float]:
    left, top, right, bottom = bbox
    safe_min = padding
    safe_x_max = width - padding
    safe_y_max = height - padding
    x = resolve_axis(anchor_spec.get("x", "image-center"), width, left, right, safe_min, safe_x_max)
    y = resolve_axis(anchor_spec.get("y", "image-center"), height, top, bottom, safe_min, safe_y_max)
    return x, y


def alpha_bbox(image: Image.Image, threshold: int) -> tuple[int, int, int, int] | None:
    alpha = image.getchannel("A")
    if threshold > 0:
        alpha = alpha.point(lambda pixel: 0 if pixel < threshold else 255)
    return alpha.getbbox()


def clean_alpha(image: Image.Image, threshold: int) -> Image.Image:
    if threshold <= 0:
        return image
    cleaned = image.copy()
    alpha = cleaned.getchannel("A").point(lambda pixel: 0 if pixel < threshold else pixel)
    cleaned.putalpha(alpha)
    return cleaned


def constrained_scale(
    crop_width: int,
    crop_height: int,
    anchor_in_crop: tuple[float, float],
    target_anchor: tuple[float, float],
    size: int,
    padding: int,
) -> float:
    anchor_x, anchor_y = anchor_in_crop
    target_x, target_y = target_anchor
    min_x = float(padding)
    min_y = float(padding)
    max_x = float(size - padding)
    max_y = float(size - padding)

    limits: list[float] = []

    if anchor_x > 0:
        limits.append((target_x - min_x) / anchor_x)
    if crop_width - anchor_x > 0:
        limits.append((max_x - target_x) / (crop_width - anchor_x))
    if anchor_y > 0:
        limits.append((target_y - min_y) / anchor_y)
    if crop_height - anchor_y > 0:
        limits.append((max_y - target_y) / (crop_height - anchor_y))

    positive_limits = [limit for limit in limits if math.isfinite(limit) and limit > 0]
    if positive_limits:
        return min(positive_limits)

    return min((size - 2 * padding) / crop_width, (size - 2 * padding) / crop_height)


def resample_filter() -> int:
    if Image is None:
        raise RuntimeError("Pillow is not installed. Install it with: pip install Pillow")
    return Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS


def alpha_composite_clipped(canvas: Image.Image, layer: Image.Image, dest: tuple[int, int]) -> None:
    dest_x, dest_y = dest
    source_left = max(0, -dest_x)
    source_top = max(0, -dest_y)
    source_right = min(layer.width, canvas.width - dest_x)
    source_bottom = min(layer.height, canvas.height - dest_y)

    if source_right <= source_left or source_bottom <= source_top:
        return

    clipped = layer.crop((source_left, source_top, source_right, source_bottom))
    canvas.alpha_composite(clipped, dest=(dest_x + source_left, dest_y + source_top))


def remove_background(image: Image.Image, session: Any, use_rembg: bool) -> Image.Image:
    image = image.convert("RGBA")
    if not use_rembg:
        return image
    if remove is None:
        raise RuntimeError(
            "rembg is not installed. Install it with: pip install rembg Pillow onnxruntime"
        )
    result = remove(image, session=session)
    return result.convert("RGBA")


def process_one(
    source_path: Path,
    output_path: Path,
    input_dir: Path,
    size: int,
    padding: int,
    threshold: int,
    config: dict[str, Any],
    session: Any,
    use_rembg: bool,
) -> ProcessResult | None:
    with Image.open(source_path) as raw:
        original = ImageOps.exif_transpose(raw).convert("RGBA")

    cutout = clean_alpha(remove_background(original, session, use_rembg), threshold)
    bbox = alpha_bbox(cutout, threshold)
    if bbox is None:
        return None

    layer_config = layer_config_for(source_path, input_dir, config)
    source_anchor_spec = layer_config.get("source_anchor", {})
    canvas_anchor_spec = layer_config.get("canvas_anchor", {})
    scale_multiplier = float(layer_config.get("scale", 1.0))

    source_anchor = resolve_anchor(
        source_anchor_spec,
        original.width,
        original.height,
        bbox,
        padding,
    )
    canvas_anchor = resolve_anchor(
        canvas_anchor_spec,
        size,
        size,
        (padding, padding, size - padding, size - padding),
        padding,
    )

    left, top, right, bottom = bbox
    crop = cutout.crop(bbox)
    crop_width, crop_height = crop.size
    anchor_in_crop = (source_anchor[0] - left, source_anchor[1] - top)

    scale = constrained_scale(crop_width, crop_height, anchor_in_crop, canvas_anchor, size, padding)
    scale = max(0.001, scale * scale_multiplier)
    output_width = max(1, round(crop_width * scale))
    output_height = max(1, round(crop_height * scale))
    resized = crop.resize((output_width, output_height), resample_filter())

    paste_x = round(canvas_anchor[0] - anchor_in_crop[0] * scale)
    paste_y = round(canvas_anchor[1] - anchor_in_crop[1] * scale)
    paste_box = (paste_x, paste_y, paste_x + output_width, paste_y + output_height)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    alpha_composite_clipped(canvas, resized, (paste_x, paste_y))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, "PNG", optimize=True)

    return ProcessResult(
        source=source_path.relative_to(input_dir).as_posix(),
        output=output_path.as_posix(),
        size=size,
        alpha_bbox=bbox,
        source_anchor=source_anchor,
        canvas_anchor=canvas_anchor,
        anchor_in_crop=anchor_in_crop,
        scale=scale,
        paste_box=paste_box,
        layer_config=layer_config,
    )


def path_is_inside(path: Path, maybe_parent: Path) -> bool:
    try:
        path.resolve().relative_to(maybe_parent.resolve())
        return True
    except ValueError:
        return False


def iter_images(input_dir: Path, output_dir: Path, recursive: bool) -> list[Path]:
    pattern = "**/*" if recursive else "*"
    images: list[Path] = []
    for path in sorted(input_dir.glob(pattern)):
        if not path.is_file():
            continue
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        if path_is_inside(path, output_dir):
            continue
        images.append(path)
    return images


def build_output_path(source_path: Path, input_dir: Path, output_dir: Path, recursive: bool) -> Path:
    if recursive:
        relative = source_path.relative_to(input_dir)
    else:
        relative = Path(source_path.name)
    return (output_dir / relative).with_suffix(".png")


def write_manifest(output_dir: Path, results: list[ProcessResult]) -> Path:
    manifest_path = output_dir / "asset_manifest.json"
    canvas_size = results[0].size if results else 1024
    payload = {
        "canvas_size": canvas_size,
        "assets": [
            {
                "source": result.source,
                "output": result.output,
                "size": result.size,
                "alpha_bbox": result.alpha_bbox,
                "source_anchor": result.source_anchor,
                "canvas_anchor": result.canvas_anchor,
                "anchor_in_crop": result.anchor_in_crop,
                "scale": result.scale,
                "paste_box": result.paste_box,
                "layer_config": result.layer_config,
            }
            for result in results
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    with manifest_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
    return manifest_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Remove backgrounds and export anchored transparent PNG layer assets."
    )
    parser.add_argument("input_dir", type=Path, help="Folder containing raw source images.")
    parser.add_argument("output_dir", type=Path, help="Folder for processed PNG layers.")
    parser.add_argument("--recursive", action="store_true", help="Process images in nested folders.")
    parser.add_argument("--size", type=int, default=1024, help="Output canvas size in pixels. Default: 1024.")
    parser.add_argument("--padding", type=int, default=24, help="Safe padding inside the output canvas. Default: 24.")
    parser.add_argument("--alpha-threshold", type=int, default=8, help="Alpha cutoff for trimming. Default: 8.")
    parser.add_argument("--model", default="u2net", help="rembg model name. Default: u2net.")
    parser.add_argument("--anchor-config", type=Path, help="Optional JSON file with default, group, and file anchors.")
    parser.add_argument("--source-anchor-x", help="Override default source anchor x, for example image-center or 50%%.")
    parser.add_argument("--source-anchor-y", help="Override default source anchor y, for example content-bottom or 92%%.")
    parser.add_argument("--canvas-anchor-x", help="Override default canvas anchor x, for example safe-center or 512.")
    parser.add_argument("--canvas-anchor-y", help="Override default canvas anchor y, for example safe-bottom or 1000.")
    parser.add_argument("--scale", type=float, default=1.0, help="Extra scale multiplier after fit. Default: 1.0.")
    parser.add_argument("--no-rembg", action="store_true", help="Skip rembg and process existing alpha channels.")
    parser.add_argument("--skip-existing", action="store_true", help="Do not overwrite existing output PNGs.")
    parser.add_argument("--quiet", action="store_true", help="Only print errors and final summary.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    input_dir = args.input_dir.resolve()
    output_dir = args.output_dir.resolve()

    if not input_dir.exists() or not input_dir.is_dir():
        parser.error(f"Input folder does not exist: {input_dir}")
    if args.size <= 0:
        parser.error("--size must be greater than zero.")
    if args.padding < 0 or args.padding * 2 >= args.size:
        parser.error("--padding must be non-negative and less than half of --size.")
    if args.alpha_threshold < 0 or args.alpha_threshold > 255:
        parser.error("--alpha-threshold must be between 0 and 255.")
    if args.scale <= 0:
        parser.error("--scale must be greater than zero.")

    config = apply_cli_anchor_overrides(load_config(args.anchor_config), args)
    if Image is None or ImageOps is None:
        raise SystemExit("Pillow is not installed. Install it with: pip install Pillow")

    use_rembg = not args.no_rembg
    session = None
    if use_rembg:
        if new_session is None:
            raise SystemExit("rembg is not installed. Install it with: pip install rembg Pillow onnxruntime")
        session = new_session(args.model)

    images = iter_images(input_dir, output_dir, args.recursive)
    if not images:
        print(f"No supported images found in {input_dir}")
        return 0

    results: list[ProcessResult] = []
    skipped = 0
    failed = 0

    for index, source_path in enumerate(images, start=1):
        output_path = build_output_path(source_path, input_dir, output_dir, args.recursive)
        if args.skip_existing and output_path.exists():
            skipped += 1
            if not args.quiet:
                print(f"[{index}/{len(images)}] skip existing {output_path.name}")
            continue

        try:
            result = process_one(
                source_path=source_path,
                output_path=output_path,
                input_dir=input_dir,
                size=args.size,
                padding=args.padding,
                threshold=args.alpha_threshold,
                config=config,
                session=session,
                use_rembg=use_rembg,
            )
        except Exception as exc:  # noqa: BLE001 - batch jobs should continue past bad files.
            failed += 1
            print(f"[error] {source_path}: {exc}", file=sys.stderr)
            continue

        if result is None:
            skipped += 1
            if not args.quiet:
                print(f"[{index}/{len(images)}] empty alpha after cutout: {source_path.name}")
            continue

        results.append(result)
        if not args.quiet:
            print(f"[{index}/{len(images)}] wrote {output_path}")

    manifest_path = write_manifest(output_dir, results)
    print(
        f"Done. Processed {len(results)} image(s), skipped {skipped}, failed {failed}. "
        f"Manifest: {manifest_path}"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
