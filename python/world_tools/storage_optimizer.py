from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any


class StorageOptimizer:

    def __init__(self, base_dir: Path | str) -> None:
        self._base_dir = Path(base_dir)
        self._generated_dir = self._base_dir / "data" / "generated_assets"
        self._temp_dir = self._base_dir / "data" / "tmp"
        self._thumbnail_dir = self._base_dir / "data" / "thumbnails"

    def scan_storage(self) -> dict[str, Any]:
        report: dict[str, Any] = {
            "generated_assets": self._scan_directory(self._generated_dir),
            "temp_files": self._scan_directory(self._temp_dir),
            "thumbnails": self._scan_directory(self._thumbnail_dir),
        }
        total_bytes = sum(section.get("total_bytes", 0) for section in report.values() if isinstance(section, dict))
        report["total_bytes"] = total_bytes
        report["total_mb"] = round(total_bytes / (1024 * 1024), 2)
        return report

    def cleanup_temp_files(self, max_age_hours: int = 24) -> dict[str, Any]:
        if not self._temp_dir.exists():
            return {"removed": 0, "freed_bytes": 0}
        cutoff = time.time() - max_age_hours * 3600
        removed = 0
        freed = 0
        for path in self._temp_dir.iterdir():
            if path.is_file() and path.stat().st_mtime < cutoff:
                size = path.stat().st_size
                try:
                    path.unlink()
                    removed += 1
                    freed += size
                except OSError:
                    pass
        return {"removed": removed, "freed_bytes": freed, "freed_mb": round(freed / (1024 * 1024), 2)}

    def convert_to_webp(self, directory: Path | str | None = None, quality: int = 82) -> dict[str, Any]:
        target_dir = Path(directory) if directory else self._generated_dir
        if not target_dir.exists():
            return {"converted": 0, "saved_bytes": 0}
        try:
            from PIL import Image
        except ImportError:
            return {"converted": 0, "saved_bytes": 0, "error": "Pillow not installed"}
        converted = 0
        saved = 0
        for path in target_dir.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix.lower() not in (".png", ".jpg", ".jpeg"):
                continue
            if path.stem.endswith("_thumb") or path.stem.endswith("_transparent"):
                continue
            try:
                original_size = path.stat().st_size
                with Image.open(path) as img:
                    if img.mode == "RGBA":
                        continue
                    webp_path = path.with_suffix(".webp")
                    img.save(webp_path, "WEBP", quality=quality)
                new_size = webp_path.stat().st_size
                if new_size < original_size:
                    path.unlink()
                    converted += 1
                    saved += original_size - new_size
            except Exception:
                continue
        return {"converted": converted, "saved_bytes": saved, "saved_mb": round(saved / (1024 * 1024), 2)}

    def generate_thumbnails(self, directory: Path | str | None = None, size: tuple[int, int] = (256, 256)) -> dict[str, Any]:
        target_dir = Path(directory) if directory else self._generated_dir
        if not target_dir.exists():
            return {"generated": 0}
        self._thumbnail_dir.mkdir(parents=True, exist_ok=True)
        try:
            from PIL import Image
        except ImportError:
            return {"generated": 0, "error": "Pillow not installed"}
        generated = 0
        for path in target_dir.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
                continue
            thumb_name = f"{path.stem}_thumb.webp"
            thumb_path = self._thumbnail_dir / thumb_name
            if thumb_path.exists():
                continue
            try:
                with Image.open(path) as img:
                    img.thumbnail(size)
                    if img.mode != "RGB":
                        img = img.convert("RGB")
                    img.save(thumb_path, "WEBP", quality=75)
                    generated += 1
            except Exception:
                continue
        return {"generated": generated}

    def find_duplicates(self, directory: Path | str | None = None) -> list[dict[str, Any]]:
        target_dir = Path(directory) if directory else self._generated_dir
        if not target_dir.exists():
            return []
        hashes: dict[str, list[Path]] = {}
        for path in target_dir.rglob("*"):
            if not path.is_file():
                continue
            try:
                file_hash = self._file_hash(path)
                hashes.setdefault(file_hash, []).append(path)
            except OSError:
                continue
        duplicates: list[dict[str, Any]] = []
        for file_hash, paths in hashes.items():
            if len(paths) > 1:
                duplicates.append({
                    "hash": file_hash,
                    "count": len(paths),
                    "files": [str(p) for p in paths],
                    "total_bytes": sum(p.stat().st_size for p in paths),
                    "recoverable_bytes": sum(p.stat().st_size for p in paths[1:]),
                })
        return duplicates

    def remove_duplicates(self, directory: Path | str | None = None) -> dict[str, Any]:
        duplicates = self.find_duplicates(directory)
        removed = 0
        freed = 0
        for dup in duplicates:
            for file_path in dup["files"][1:]:
                try:
                    path = Path(file_path)
                    freed += path.stat().st_size
                    path.unlink()
                    removed += 1
                except OSError:
                    continue
        return {"removed": removed, "freed_bytes": freed, "freed_mb": round(freed / (1024 * 1024), 2)}

    def archive_old_logs(self, log_dir: Path | str | None = None, max_age_days: int = 7) -> dict[str, Any]:
        target = Path(log_dir) if log_dir else self._base_dir / "data" / "logs"
        if not target.exists():
            return {"archived": 0}
        archive_dir = target / "archive"
        archive_dir.mkdir(parents=True, exist_ok=True)
        cutoff = time.time() - max_age_days * 86400
        archived = 0
        for path in target.glob("*.log"):
            if path.is_file() and path.stat().st_mtime < cutoff:
                try:
                    dest = archive_dir / path.name
                    path.rename(dest)
                    archived += 1
                except OSError:
                    continue
        return {"archived": archived}

    def _scan_directory(self, directory: Path) -> dict[str, Any]:
        if not directory.exists():
            return {"exists": False, "total_bytes": 0, "file_count": 0}
        total_bytes = 0
        file_count = 0
        extensions: dict[str, int] = {}
        for path in directory.rglob("*"):
            if path.is_file():
                total_bytes += path.stat().st_size
                file_count += 1
                ext = path.suffix.lower() or "none"
                extensions[ext] = extensions.get(ext, 0) + 1
        return {
            "exists": True,
            "total_bytes": total_bytes,
            "total_mb": round(total_bytes / (1024 * 1024), 2),
            "file_count": file_count,
            "extensions": extensions,
        }

    def _file_hash(self, path: Path) -> str:
        import hashlib
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
        return h.hexdigest()[:16]


_optimizer: StorageOptimizer | None = None


def get_storage_optimizer(base_dir: Path | str | None = None) -> StorageOptimizer:
    global _optimizer
    if _optimizer is None:
        if base_dir is None:
            base_dir = Path(__file__).resolve().parents[2]
        _optimizer = StorageOptimizer(base_dir)
    return _optimizer
