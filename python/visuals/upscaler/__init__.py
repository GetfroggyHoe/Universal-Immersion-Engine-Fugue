from .base import ImageUpscaler
from .registry import (
    register_upscaler,
    get_upscaler,
    list_upscalers,
    available_upscaler_keys,
    clear_instances,
)
from .realesrgan_anime import RealESRGANAnimeUpscaler, ONNX_MODEL_PATH, UPSCALER_DIR

register_upscaler("anime", RealESRGANAnimeUpscaler)

UPSCALER_MODES = {
    "off": None,
    "anime": "anime",
}

UPSCALER_LABELS = {
    "off": "Off",
    "anime": "Anime (Recommended)",
}


def get_upscaler_for_mode(mode: str) -> ImageUpscaler | None:
    key = UPSCALER_MODES.get(mode)
    if key is None:
        return None
    return get_upscaler(key)
