from __future__ import annotations

import json
import os
import shutil
import site
import subprocess
import sys
import sysconfig
from pathlib import Path
from typing import Any


PILLOW_SPEC = "Pillow>=10,<12"
HUGGINGFACE_SPEC = "huggingface-hub>=0.23,<1"

PROBE = """
import json
errors = {}
try:
    from PIL import Image, _imaging
    errors["pillow_version"] = str(getattr(Image, "__version__", "unknown"))
except Exception as exc:
    errors["PIL"] = f"{type(exc).__name__}: {exc}"
try:
    import huggingface_hub
except Exception as exc:
    errors["huggingface_hub"] = f"{type(exc).__name__}: {exc}"
print(json.dumps(errors))
raise SystemExit(1 if ("PIL" in errors or "huggingface_hub" in errors) else 0)
"""


def _run(args: list[str], timeout: int = 1800) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
        check=False,
    )


def _in_venv() -> bool:
    return bool(
        os.environ.get("VIRTUAL_ENV")
        or os.environ.get("CONDA_PREFIX")
        or getattr(sys, "base_prefix", sys.prefix) != sys.prefix
    )


def _probe() -> tuple[bool, dict[str, str], str]:
    result = _run([sys.executable, "-c", PROBE], timeout=180)
    output = str(result.stdout or "").strip()
    details: dict[str, str] = {}
    for line in reversed(output.splitlines()):
        try:
            parsed = json.loads(line)
        except Exception:
            continue
        if isinstance(parsed, dict):
            details = {str(k): str(v) for k, v in parsed.items()}
            break
    ok = result.returncode == 0 and "PIL" not in details and "huggingface_hub" not in details
    return ok, details, output


def _site_dirs() -> list[Path]:
    values: list[str] = []
    try:
        values.extend(site.getsitepackages())
    except Exception:
        pass
    try:
        values.append(site.getusersitepackages())
    except Exception:
        pass
    try:
        paths = sysconfig.get_paths()
        values.extend([paths.get("purelib", ""), paths.get("platlib", "")])
    except Exception:
        pass

    found: list[Path] = []
    for value in values:
        if not value:
            continue
        path = Path(value)
        if path.exists() and path not in found:
            found.append(path)
    return found


def _remove_stale_pillow() -> list[str]:
    removed: list[str] = []
    patterns = (
        "PIL",
        "Pillow-*.dist-info",
        "pillow-*.dist-info",
        "Pillow.libs",
        "pillow.libs",
    )
    for base in _site_dirs():
        for pattern in patterns:
            for item in base.glob(pattern):
                try:
                    if item.is_dir():
                        shutil.rmtree(item)
                    else:
                        item.unlink()
                    removed.append(str(item))
                except Exception:
                    pass
    return removed


def _pip(*args: str, timeout: int = 3600) -> tuple[bool, str]:
    result = _run(
        [sys.executable, "-m", "pip", "--disable-pip-version-check", *args],
        timeout=timeout,
    )
    return result.returncode == 0, str(result.stdout or "").strip()


def ensure_koji_dependencies(auto_repair: bool = True) -> dict[str, Any]:
    ok, details, probe_output = _probe()
    if ok:
        return {"ok": True, "repaired": False, "message": "Koji installer dependencies are ready."}

    if not auto_repair:
        return {
            "ok": False,
            "repaired": False,
            "error": "Koji installer dependencies are missing or broken.",
            "details": details,
            "probe": probe_output,
        }

    if not _in_venv():
        return {
            "ok": False,
            "repaired": False,
            "error": (
                "Koji dependency repair was not run because UIE is not using its virtual "
                "environment. Start UIE through the launcher, then try Install Koji again."
            ),
            "details": details,
        }

    logs: list[str] = []

    if "PIL" in details:
        _, uninstall_log = _pip("uninstall", "-y", "PIL", "Pillow", timeout=900)
        logs.append(uninstall_log)
        removed = _remove_stale_pillow()
        if removed:
            logs.append("Removed stale Pillow paths:\n" + "\n".join(removed))

        install_args = ["install", "--no-cache-dir", "--force-reinstall"]
        if os.name == "nt":
            install_args.append("--only-binary=:all:")
        install_args.append(PILLOW_SPEC)
        pillow_ok, pillow_log = _pip(*install_args, timeout=1800)
        logs.append(pillow_log)
        if not pillow_ok:
            return {
                "ok": False,
                "repaired": False,
                "error": "Pillow could not be repaired inside the UIE virtual environment.",
                "details": details,
                "log": "\n".join(logs)[-12000:],
            }

    if "huggingface_hub" in details:
        hf_ok, hf_log = _pip(
            "install",
            "--upgrade",
            "--no-cache-dir",
            HUGGINGFACE_SPEC,
            timeout=1800,
        )
        logs.append(hf_log)
        if not hf_ok:
            return {
                "ok": False,
                "repaired": False,
                "error": "huggingface-hub could not be installed for the Koji downloader.",
                "details": details,
                "log": "\n".join(logs)[-12000:],
            }

    ok, details, probe_output = _probe()
    if not ok:
        return {
            "ok": False,
            "repaired": False,
            "error": (
                "Koji dependencies were repaired, but validation still failed. "
                "Close UIE completely, restart it, and try again."
            ),
            "details": details,
            "probe": probe_output,
            "log": "\n".join(logs)[-12000:],
        }

    return {
        "ok": True,
        "repaired": True,
        "message": "Koji installer dependencies were repaired and validated.",
        "log": "\n".join(logs)[-12000:],
    }
