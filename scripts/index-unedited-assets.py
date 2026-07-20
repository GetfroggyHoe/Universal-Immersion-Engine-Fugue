#!/usr/bin/env python3
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "Unedited assets"
OUTPUT = ROOT / "dogfood-output" / "unedited-asset-index"
TILE = 148
IMAGE_BOX = 116
LABEL_HEIGHT = 28
COLS = 8
ROWS = 8


def source_groups() -> list[tuple[str, list[Path]]]:
    groups: list[tuple[str, list[Path]]] = []
    root_files = sorted(SOURCE.glob("*.png"), key=lambda path: path.name.lower())
    if root_files:
        groups.append(("root", root_files))
    for directory in sorted((path for path in SOURCE.iterdir() if path.is_dir()), key=lambda path: path.name.lower()):
        files = sorted(directory.rglob("*.png"), key=lambda path: path.relative_to(directory).as_posix().lower())
        if files:
            groups.append((directory.name, files))
    return groups


def render_group(name: str, files: list[Path]) -> list[Path]:
    font = ImageFont.load_default()
    page_size = COLS * ROWS
    pages: list[Path] = []
    slug = "".join(char.lower() if char.isalnum() else "-" for char in name).strip("-") or "root"
    for page_index in range(math.ceil(len(files) / page_size)):
        page_files = files[page_index * page_size : (page_index + 1) * page_size]
        sheet = Image.new("RGB", (COLS * TILE, ROWS * TILE), "#20242b")
        draw = ImageDraw.Draw(sheet)
        for index, path in enumerate(page_files):
            col = index % COLS
            row = index // COLS
            x = col * TILE
            y = row * TILE
            draw.rectangle((x + 2, y + 2, x + TILE - 3, y + TILE - 3), fill="#f0f1f3")
            with Image.open(path) as source:
                image = source.convert("RGBA")
                image.thumbnail((IMAGE_BOX, IMAGE_BOX), Image.Resampling.LANCZOS)
            checker = Image.new("RGB", (IMAGE_BOX, IMAGE_BOX), "#d7d9dd")
            check_draw = ImageDraw.Draw(checker)
            for cy in range(0, IMAGE_BOX, 12):
                for cx in range(0, IMAGE_BOX, 12):
                    if (cx // 12 + cy // 12) % 2:
                        check_draw.rectangle((cx, cy, cx + 11, cy + 11), fill="#ffffff")
            px = x + (TILE - IMAGE_BOX) // 2
            py = y + 5
            checker.paste(image, ((IMAGE_BOX - image.width) // 2, (IMAGE_BOX - image.height) // 2), image)
            sheet.paste(checker, (px, py))
            label = path.relative_to(SOURCE).as_posix()
            if len(label) > 24:
                label = "..." + label[-21:]
            draw.text((x + 6, y + TILE - LABEL_HEIGHT + 4), label, fill="#101318", font=font)
        out = OUTPUT / f"{slug}-{page_index + 1:02d}.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(out, optimize=True)
        pages.append(out)
    return pages


def main() -> None:
    generated: list[Path] = []
    for name, files in source_groups():
        generated.extend(render_group(name, files))
    print(f"Generated {len(generated)} contact sheets in {OUTPUT}")


if __name__ == "__main__":
    main()
