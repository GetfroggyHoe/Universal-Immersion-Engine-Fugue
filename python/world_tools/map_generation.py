"""Bounded map-generation context and provider-neutral text generation helpers."""
from __future__ import annotations

import json
import os
import re
import time
import uuid
from typing import Any
from urllib import request as urlrequest

MAX_CONTEXT_CHARS = 7_200
LIMITS = {
    "recentChat": 2_600, "sourceLocation": 120, "previousLocation": 120,
    "direction": 20, "sourceDescription": 600, "worldDescription": 850,
    "userPrompt": 1_200, "label": 120,
}
ALLOWED_CONTEXT = set(LIMITS) | {"lore"}


def _text(value: Any, limit: int) -> str:
    if not isinstance(value, (str, int, float, bool)):
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()[:limit]


def _key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())[:180]


def compact_map_context(raw: Any) -> tuple[dict[str, Any], dict[str, int]]:
    """Allowlist, deduplicate, and budget client context without invalid JSON slicing."""
    raw = raw if isinstance(raw, dict) else {}
    context = {field: _text(raw.get(field), limit) for field, limit in LIMITS.items()}
    lore: list[str] = []
    seen = {_key(value) for value in context.values() if value}
    for entry in raw.get("lore", []) if isinstance(raw.get("lore"), list) else []:
        clean = _text(entry, 420)
        key = _key(clean)
        if clean and key and key not in seen:
            lore.append(clean)
            seen.add(key)
        if len(lore) == 4:
            break
    context["lore"] = lore
    # Recent spatial events/current location are retained first. Lore is reduced first.
    def size() -> int:
        return len(json.dumps(context, ensure_ascii=False, separators=(",", ":")))
    while size() > MAX_CONTEXT_CHARS and context["lore"]:
        context["lore"].pop()
    while size() > MAX_CONTEXT_CHARS and context["recentChat"]:
        context["recentChat"] = context["recentChat"][len(context["recentChat"]) // 4:]
    while size() > MAX_CONTEXT_CHARS and context["userPrompt"]:
        context["userPrompt"] = context["userPrompt"][:-120]
    context = {key: value for key, value in context.items() if value not in ("", [], None)}
    sizes = {key: len(json.dumps(value, ensure_ascii=False)) for key, value in context.items()}
    sizes["total"] = len(json.dumps(context, ensure_ascii=False, separators=(",", ":")))
    return context, sizes


def diagnostic(event: str, request_id: str, **data: Any) -> None:
    safe = {key: value for key, value in data.items() if key not in {"prompt", "context", "response", "authorization", "api_key"}}
    print("[map-diagnostic]", json.dumps({"event": event, "requestId": request_id, **safe}, ensure_ascii=False))


def build_map_prompt(operation: str, context: dict[str, Any], counts: dict[str, Any] | None = None) -> str:
    common = (
        "Return JSON only. The engine owns coordinates and topology. Do not emit markdown. "
        "Respect current location, travel continuity, environment, and established genre; never default to medieval fantasy. "
    )
    if operation == "location":
        rules = ("Create one immediately reachable location with name, description, type, theme, faction, scope, transitionReason, laws, and reputation. "
                 "scope must be nearby or local; use nearby for an immediate room, door, street feature, or neighbor.")
    elif operation == "scan":
        rules = ("Extract at most 18 concrete physical places from recent chat. "
                 "Schema: {\"places\":[{\"name\":\"\",\"layer\":\"world|region|area|vicinity\",\"type\":\"\",\"description\":\"\",\"connectNear\":\"\"}]}")
    else:
        rules = ("Create a structured map package with worlds, regions, areas, vicinity, nearbyByPlace, and roomsByPlace. "
                 "Only bounded exploration sites receive rooms; nearby locations must be spatially plausible.")
    return f"{common}\n{rules}\nContext JSON:\n{json.dumps(context, ensure_ascii=False, separators=(',', ':'))}\nCounts:\n{json.dumps(counts or {}, separators=(',', ':'))}"


def generate_with_configured_provider(prompt: str, request_id: str, override: dict[str, Any] | None = None) -> tuple[dict[str, Any] | None, str]:
    """Use an OpenAI-compatible endpoint from env or one ephemeral local request."""
    override = override if isinstance(override, dict) else {}
    endpoint = str(override.get("endpoint") or os.environ.get("UIE_TEXT_MODEL_ENDPOINT", "")).strip()
    model = str(override.get("model") or os.environ.get("UIE_TEXT_MODEL", "")).strip()
    api_key = str(override.get("apiKey") or os.environ.get("UIE_TEXT_MODEL_API_KEY", "")).strip()
    endpoint_shape = str(override.get("endpointShape") or "openai_chat").strip().lower()
    try:
        temperature = max(0.0, min(2.0, float(override.get("temperature", 0.7))))
    except (TypeError, ValueError):
        temperature = 0.7
    if not endpoint or not model:
        return None, "no map text model configured"
    if not re.match(r"^https?://", endpoint, re.I):
        return None, "map text model endpoint must use http or https"
    if endpoint_shape == "anthropic_messages":
        payload = {"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": temperature, "max_tokens": 4096}
    elif endpoint_shape == "openai_completions":
        payload = {"model": model, "prompt": prompt, "temperature": temperature, "max_tokens": 4096}
    elif endpoint_shape == "openai_responses":
        payload = {"model": model, "input": prompt, "temperature": temperature, "max_output_tokens": 4096}
    else:
        payload = {"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": temperature, "max_tokens": 4096}
    body = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    if api_key:
        if endpoint_shape == "anthropic_messages":
            headers["x-api-key"] = api_key
            headers["anthropic-version"] = "2023-06-01"
        else:
            headers["Authorization"] = f"Bearer {api_key}"
    started = time.monotonic()
    try:
        with urlrequest.urlopen(urlrequest.Request(endpoint, data=body, headers=headers), timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
        if endpoint_shape == "anthropic_messages":
            content = "\n".join(str(item.get("text", "")) for item in result.get("content", []) if isinstance(item, dict))
        elif endpoint_shape == "openai_completions":
            content = result.get("choices", [{}])[0].get("text", "")
        elif endpoint_shape == "openai_responses":
            content = str(result.get("output_text", ""))
            if not content:
                content = "\n".join(
                    str(part.get("text", ""))
                    for item in result.get("output", []) if isinstance(item, dict)
                    for part in item.get("content", []) if isinstance(part, dict)
                )
        else:
            content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
        parsed = json.loads(str(content).strip().removeprefix("```json").removesuffix("```").strip())
        diagnostic("provider", request_id, provider="configured", model=model, modelMessageCount=1, modelMessageCharacters=len(prompt), elapsedMs=round((time.monotonic()-started)*1000), validation="passed")
        return parsed if isinstance(parsed, dict) else None, ""
    except Exception as exc:  # details stay server-side
        diagnostic("provider", request_id, provider="configured", model=model, elapsedMs=round((time.monotonic()-started)*1000), validation="failed", fallbackReason=type(exc).__name__)
        return None, "provider request failed"


def new_request_id() -> str:
    return uuid.uuid4().hex
