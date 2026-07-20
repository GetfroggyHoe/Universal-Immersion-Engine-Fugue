"""Build the redistributable UIE archive without local/runtime state."""

from __future__ import annotations

import os
import tempfile
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "Universal-Immersion-Engine-Fugue-main-clean.zip"
EXCLUDED_DIRS = {
    ".git", ".venv", "venv", "node_modules", "__pycache__", ".pytest_cache",
    "dogfood-output", "generated_assets", "voice_refs",
}
EXCLUDED_FILES = {
    OUTPUT.name,
    ".koji-install-choice-recorded",
    "data.koji-install-choice-recorded",
    "uie_living_world.sqlite3",
    "uie_living_world.sqlite3-shm",
    "uie_living_world.sqlite3-wal",
    "uie_game_state.json",
    "uie_browser_pages.json",
    "uie_instavibe_feed.json",
    "uie_instavibe_state.json",
    "saved_voices.json",
    "voice_registry.json",
}
EXCLUDED_SUFFIXES = {".pyc", ".pyo", ".log", ".tmp"}


def include(path: Path) -> bool:
    relative = path.relative_to(ROOT)
    if any(part in EXCLUDED_DIRS for part in relative.parts):
        return False
    if path.name in EXCLUDED_FILES or path.suffix.lower() in EXCLUDED_SUFFIXES:
        return False
    return path.is_file()


def main() -> None:
    files = sorted((path for path in ROOT.rglob("*") if include(path)), key=lambda path: path.as_posix().lower())
    handle, temporary_name = tempfile.mkstemp(prefix="uie-clean-", suffix=".zip", dir=ROOT)
    os.close(handle)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            for path in files:
                archive.write(path, path.relative_to(ROOT).as_posix())
        temporary.replace(OUTPUT)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Built {OUTPUT.name}: {len(files)} files, {OUTPUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
