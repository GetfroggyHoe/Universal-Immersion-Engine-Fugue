from __future__ import annotations

import io
import json
import logging
import time
from typing import Any

from .base import ImageProvider, GeneratedImage

log = logging.getLogger("visuals.providers.custom")


class CustomHttpProvider(ImageProvider):

    def __init__(
        self,
        base_url: str = "",
        api_key: str = "",
        model: str = "",
        auth_type: str = "bearer",
        headers: dict[str, str] | None = None,
        request_template: dict[str, Any] | None = None,
        response_mapping: dict[str, str] | None = None,
        timeout: int = 120,
        retry_count: int = 1,
    ) -> None:
        self._base_url = base_url
        self._api_key = api_key
        self._model = model
        self._auth_type = auth_type
        self._headers = headers or {}
        self._request_template = request_template or {}
        self._response_mapping = response_mapping or {}
        self._timeout = timeout
        self._retry_count = retry_count

    @property
    def provider_id(self) -> str:
        return "custom_model"

    @property
    def name(self) -> str:
        return "Custom HTTP Model"

    async def available(self) -> bool:
        return bool(self._base_url)

    async def generate(
        self,
        prompt: str,
        negative_prompt: str | None = None,
        width: int = 512,
        height: int = 512,
        seed: int | None = None,
        options: dict[str, Any] | None = None,
    ) -> GeneratedImage:
        import base64
        import re

        body = self._build_request_body(prompt, negative_prompt, width, height)
        headers = self._build_headers()

        last_error: Exception | None = None
        for attempt in range(max(1, self._retry_count)):
            try:
                import aiohttp
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        self._base_url,
                        json=body,
                        headers=headers,
                        timeout=aiohttp.ClientTimeout(total=self._timeout),
                    ) as resp:
                        data = await resp.json()

                image_bytes, content_type = self._extract_image(data)
                return GeneratedImage(
                    image_bytes=image_bytes,
                    width=width,
                    height=height,
                    format="png",
                    provider=self.provider_id,
                    model=self._model,
                    seed=seed,
                )
            except Exception as exc:
                last_error = exc
                if attempt < self._retry_count - 1:
                    import asyncio
                    await asyncio.sleep(1)

        raise RuntimeError(f"Custom model generation failed: {last_error}")

    def capabilities(self) -> dict[str, Any]:
        return {
            "max_width": 2048,
            "max_height": 2048,
            "supported_formats": ["png", "webp"],
            "supports_negative_prompt": True,
            "supports_seed": True,
            "custom": True,
        }

    async def test_connection(self) -> dict[str, Any]:
        start = time.monotonic()
        try:
            is_available = await self.available()
            latency = (time.monotonic() - start) * 1000
            return {
                "success": is_available,
                "message": "Connected" if is_available else "Base URL not configured",
                "latency_ms": round(latency, 1),
            }
        except Exception as exc:
            latency = (time.monotonic() - start) * 1000
            return {"success": False, "message": str(exc), "latency_ms": round(latency, 1)}

    def _build_request_body(
        self,
        prompt: str,
        negative_prompt: str | None,
        width: int,
        height: int,
    ) -> dict[str, Any]:
        template = self._request_template or {
            "prompt": "{prompt}",
            "negative_prompt": "{negative_prompt}",
            "width": "{width}",
            "height": "{height}",
            "steps": "20",
            "guidance_scale": "7.0",
        }

        body: dict[str, Any] = {}
        for key, val_template in template.items():
            if isinstance(val_template, str):
                rendered = val_template.replace("{prompt}", prompt)
                rendered = rendered.replace("{negative_prompt}", negative_prompt or "")
                rendered = rendered.replace("{width}", str(width))
                rendered = rendered.replace("{height}", str(height))
                try:
                    body[key] = int(rendered)
                except (ValueError, TypeError):
                    try:
                        body[key] = float(rendered)
                    except (ValueError, TypeError):
                        body[key] = rendered
            else:
                body[key] = val_template
        return body

    def _build_headers(self) -> dict[str, str]:
        import base64
        headers: dict[str, str] = {"Content-Type": "application/json"}
        headers.update(self._headers)
        if self._api_key:
            if self._auth_type == "bearer":
                headers["Authorization"] = f"Bearer {self._api_key}"
            elif self._auth_type == "basic":
                encoded = base64.b64encode(f":{self._api_key}".encode()).decode()
                headers["Authorization"] = f"Basic {encoded}"
            elif self._auth_type == "header":
                headers["X-API-Key"] = self._api_key
            else:
                headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def _extract_image(self, data: Any) -> tuple[bytes, str]:
        import base64
        import re

        response_format = self._response_mapping.get("format", "base64")
        image_path = self._response_mapping.get("image_path", "images.0.b64_json")

        if response_format == "base64":
            value = self._extract_path(data, image_path)
            if value and isinstance(value, str):
                if value.startswith("data:"):
                    match = re.match(r"^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$", value, re.I | re.S)
                    if match:
                        ct = match.group(1) or "image/png"
                        return base64.b64decode(match.group(2)), ct
                return base64.b64decode(value), "image/png"
        elif response_format == "url":
            url_path = self._response_mapping.get("url_path", "images.0.url")
            value = self._extract_path(data, url_path)
            if value:
                return self._download_image(str(value))

        raise RuntimeError("Could not extract image from custom model response")

    def _extract_path(self, data: Any, path: str) -> Any:
        parts = path.split(".")
        value: Any = data
        for part in parts:
            if isinstance(value, dict):
                value = value.get(part)
            elif isinstance(value, list) and part.isdigit():
                value = value[int(part)]
            else:
                return None
        return value

    def _download_image(self, url: str) -> tuple[bytes, str]:
        import urllib.request
        req = urllib.request.Request(url, headers={"Accept": "image/*"})
        with urllib.request.urlopen(req, timeout=self._timeout) as resp:
            return resp.read(), resp.headers.get("Content-Type", "image/png")
