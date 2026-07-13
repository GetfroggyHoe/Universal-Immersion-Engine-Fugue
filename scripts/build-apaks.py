#!/usr/bin/env python3
from __future__ import annotations

import io
import json
import struct
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "assets" / "processed" / "asset-tags.json"
OUT_DIR = ROOT / "assets" / "paks"
PUBLIC_MANIFEST = ROOT / "assets" / "asset-manifest.json"


def pack_record(record: dict, chunks: list[bytes], max_px: int = 256) -> dict:
    src = ROOT / str(record.get("path", "")).replace("/", "\\")
    if not src.exists():
        raise FileNotFoundError(f"Missing image for {record.get('id')}: {record.get('path')}")
    original_len = src.stat().st_size
    with Image.open(src) as im:
        im = im.convert("RGBA")
        im.thumbnail((max_px, max_px), Image.Resampling.BILINEAR)
        buf = io.BytesIO()
        im.save(buf, format="WEBP", quality=82, method=0)
    data = buf.getvalue()
    offset = sum(len(chunk) for chunk in chunks)
    chunks.append(data)
    clean = {key: value for key, value in record.items() if key != "imageData"}
    clean["packed"] = True
    clean["_packed"] = {
        "mime": "image/webp",
        "encoding": "raw",
        "offset": offset,
        "length": len(data),
        "originalLength": original_len,
        "maxPixel": max_px,
    }
    return clean


def write_apak(pack_id: str, name: str, records: list[dict]) -> dict:
    chunks: list[bytes] = []
    assets = [pack_record(record, chunks) for record in records]
    pak_manifest = {
        "id": f"{pack_id}.apak",
        "name": name,
        "kind": "asset-pack",
        "format": "uie-apak-binary-v1",
        "version": 1,
        "generatedFrom": "assets/processed/asset-tags.json",
        "compression": "webp-256",
        "embeddedImages": True,
        "assetCount": len(assets),
        "assets": assets,
    }
    manifest_bytes = json.dumps(pak_manifest, separators=(",", ":")).encode("utf-8")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{pack_id}.apak"
    out.write_bytes(b"UIEAPAK1" + struct.pack("<I", len(manifest_bytes)) + manifest_bytes + b"".join(chunks))
    return {
        "assets": len(assets),
        "sourceBytes": sum(asset["_packed"]["originalLength"] for asset in assets),
        "packedBytes": out.stat().st_size,
    }


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    summary = {
        "food": write_apak("food", "Food Item Pack", manifest.get("food", [])),
        "misc": write_apak("misc", "Misc Item Pack", manifest.get("misc", [])),
    }
    public = json.loads(PUBLIC_MANIFEST.read_text(encoding="utf-8"))
    public["paks"] = {
        "food": "assets/paks/food.apak",
        "misc": "assets/paks/misc.apak",
    }
    PUBLIC_MANIFEST.write_text(json.dumps(public, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
