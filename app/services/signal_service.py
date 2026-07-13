from __future__ import annotations

from app.models.signals import SceneSignals


def extract_signals(raw: dict) -> SceneSignals:
    known_fields = set(SceneSignals.model_fields.keys())
    known = {k: v for k, v in raw.items() if k in known_fields}
    extra_raw = {k: v for k, v in raw.items() if k not in known_fields}
    known["extra"] = extra_raw
    return SceneSignals(**known)


def merge_signals(base: SceneSignals, overrides: dict) -> SceneSignals:
    data = base.model_dump()
    extra = data.pop("extra", {})
    for k, v in overrides.items():
        if k in SceneSignals.model_fields and k != "extra":
            data[k] = v
        else:
            extra[k] = v
    data["extra"] = extra
    return SceneSignals(**data)
