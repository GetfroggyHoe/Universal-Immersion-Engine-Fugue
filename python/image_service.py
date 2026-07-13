"""
image_service.py — Local SDXS ONNX 1-step image generation microservice.

Endpoint : POST /generate_location
Port     : 28094  (separate from the main UIE backend on 28093)

Providers selected automatically:
  • Windows PC with CUDA  → CUDAExecutionProvider
  • Windows PC            → DmlExecutionProvider  (DirectML)
  • Android / Termux      → NNAPIExecutionProvider
  • Fallback              → CPUExecutionProvider
"""

from __future__ import annotations

import io
import json
import os
import platform
import sys
import time
import threading
import uuid
import logging
from pathlib import Path
from typing import Any, Optional

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
HERE = Path(__file__).parent          # vocalist-vn-clean/python/
ROOT = HERE.parent                    # vocalist-vn-clean/
MODELS_DIR = ROOT / "models"
SDXS_DIR   = MODELS_DIR / "sdxs-onnx"
TAESD_DIR  = MODELS_DIR / "taesd-onnx"
OUTPUT_DIR = ROOT / "assets" / "generated" / "locations"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="[SDXS] %(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("sdxs")

# ---------------------------------------------------------------------------
# Execution provider selection
# ---------------------------------------------------------------------------

def _detect_providers() -> list[str]:
    """Return ONNX execution provider list, best-first."""
    available = set(ort.get_available_providers())
    is_android = "ANDROID_DATA" in os.environ or sys.platform.startswith("linux") and Path("/data/data").exists()

    if is_android:
        if "NNAPIExecutionProvider" in available:
            log.info("Provider: NNAPIExecutionProvider (Android)")
            return ["NNAPIExecutionProvider", "CPUExecutionProvider"]
        log.info("Provider: CPUExecutionProvider (Android fallback)")
        return ["CPUExecutionProvider"]

    # Windows / PC
    if "CUDAExecutionProvider" in available:
        log.info("Provider: CUDAExecutionProvider (NVIDIA GPU)")
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    if "DmlExecutionProvider" in available:
        log.info("Provider: DmlExecutionProvider (DirectML / Windows GPU)")
        return ["DmlExecutionProvider", "CPUExecutionProvider"]
    if "ROCMExecutionProvider" in available:
        log.info("Provider: ROCMExecutionProvider (AMD GPU)")
        return ["ROCMExecutionProvider", "CPUExecutionProvider"]

    log.info("Provider: CPUExecutionProvider (no GPU provider found)")
    return ["CPUExecutionProvider"]


PROVIDERS = _detect_providers()

# ---------------------------------------------------------------------------
# ONNX sessions (lazy-loaded, thread-safe)
# ---------------------------------------------------------------------------
_lock = threading.Lock()
_sessions: dict[str, Any] = {}


def _load_session(onnx_path: Path) -> ort.InferenceSession:
    key = str(onnx_path)
    with _lock:
        if key not in _sessions:
            if not onnx_path.exists():
                raise FileNotFoundError(
                    f"Model file not found: {onnx_path}\n"
                    "Run:  python scripts/download_sdxs_models.py"
                )
            opts = ort.SessionOptions()
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            opts.enable_mem_pattern = True
            opts.enable_cpu_mem_arena = True
            log.info(f"Loading ONNX session: {onnx_path.name}")
            _sessions[key] = ort.InferenceSession(str(onnx_path), sess_options=opts, providers=PROVIDERS)
            log.info(f"Loaded: {onnx_path.name}")
        return _sessions[key]


def get_text_encoder() -> ort.InferenceSession:
    return _load_session(SDXS_DIR / "text_encoder" / "model.onnx")


def get_unet() -> ort.InferenceSession:
    return _load_session(SDXS_DIR / "unet" / "model.onnx")


def get_vae_decoder() -> ort.InferenceSession:
    """Use TAESD VAE decoder if available, else fall back to SDXS built-in."""
    taesd_path = TAESD_DIR / "vae_decoder" / "model.onnx"
    sdxs_path  = SDXS_DIR  / "vae_decoder" / "model.onnx"
    path = taesd_path if taesd_path.exists() else sdxs_path
    log.info(f"VAE decoder: {'TAESD (tiny, fast)' if path == taesd_path else 'SDXS built-in'}")
    return _load_session(path)


# ---------------------------------------------------------------------------
# Tokenizer (simple fallback – uses SDXS tokenizer vocab if available)
# ---------------------------------------------------------------------------

_tokenizer = None
_tokenizer_lock = threading.Lock()


def _load_tokenizer():
    global _tokenizer
    with _tokenizer_lock:
        if _tokenizer is not None:
            return _tokenizer
        try:
            from transformers import CLIPTokenizer
            _tokenizer = CLIPTokenizer.from_pretrained(str(SDXS_DIR / "tokenizer"))
            log.info("Tokenizer loaded via transformers")
        except Exception:
            # Lightweight fallback: load vocab.json + merges.txt ourselves
            try:
                import tokenizers
                _tokenizer = tokenizers.Tokenizer.from_file(str(SDXS_DIR / "tokenizer" / "tokenizer.json"))
                log.info("Tokenizer loaded via tokenizers library")
            except Exception:
                _tokenizer = None
                log.warning("No tokenizer library found; will use simple whitespace tokenizer")
        return _tokenizer


def _encode_prompt(prompt: str, max_length: int = 77) -> np.ndarray:
    """
    Encode a text prompt → int32 token ids  [1, 77].
    Falls back to a trivial BOS/PAD/EOS-padded array if no tokenizer.
    """
    tokenizer = _load_tokenizer()

    if tokenizer is None:
        # Minimal: BOS=49406, EOS=49407, PAD=0 — works for basic prompts
        ids = [49406] + [0] * (max_length - 2) + [49407]
        return np.array([ids], dtype=np.int32)

    try:
        # HuggingFace CLIPTokenizer
        enc = tokenizer(
            prompt,
            max_length=max_length,
            padding="max_length",
            truncation=True,
            return_tensors="np",
        )
        return enc["input_ids"].astype(np.int32)
    except AttributeError:
        # tokenizers library path
        enc = tokenizer.encode(prompt)
        ids = enc.ids[:max_length]
        ids = ids + [0] * (max_length - len(ids))
        return np.array([ids], dtype=np.int32)


# ---------------------------------------------------------------------------
# Scheduler helpers (1-step DDIM / consistency)
# ---------------------------------------------------------------------------

def _get_scheduler_config() -> dict:
    cfg_path = SDXS_DIR / "scheduler" / "scheduler_config.json"
    if cfg_path.exists():
        return json.loads(cfg_path.read_text())
    return {"num_train_timesteps": 1000, "beta_start": 0.00085, "beta_end": 0.012}


def _single_step_timestep() -> np.ndarray:
    """Return the single timestep used for 1-step inference (999 for SDXS)."""
    cfg = _get_scheduler_config()
    t = cfg.get("num_train_timesteps", 1000) - 1
    return np.array([t], dtype=np.int64)


# ---------------------------------------------------------------------------
# Core inference
# ---------------------------------------------------------------------------

def _image_dims_for_sdxs() -> tuple[int, int]:
    """SDXS-512 uses 512×512; detect from config if present."""
    cfg_path = SDXS_DIR / "unet" / "config.json"
    if cfg_path.exists():
        cfg = json.loads(cfg_path.read_text())
        h = cfg.get("sample_size", 64)
        return int(h) * 8, int(h) * 8  # latent → pixel
    return 512, 512


def generate_location_image(prompt: str) -> bytes:
    """Run the full SDXS 1-step pipeline and return PNG bytes."""
    t0 = time.perf_counter()

    pixel_h, pixel_w = _image_dims_for_sdxs()
    latent_h, latent_w = pixel_h // 8, pixel_w // 8

    # ---- 1. Encode text ----
    text_encoder = get_text_encoder()
    input_ids = _encode_prompt(prompt)
    te_inputs = {text_encoder.get_inputs()[0].name: input_ids}
    text_embeds = text_encoder.run(None, te_inputs)[0]  # [1, 77, 768]

    # Classifier-free guidance embedding: duplicate (positive + unconditional)
    uncond_ids = _encode_prompt("")
    te_uncond  = text_encoder.run(None, {text_encoder.get_inputs()[0].name: uncond_ids})[0]
    encoder_hidden_states = np.concatenate([te_uncond, text_embeds], axis=0)  # [2, 77, 768]

    # ---- 2. Noise latent (x_T) ----
    latents = np.random.randn(1, 4, latent_h, latent_w).astype(np.float32)

    # ---- 3. Single-step UNet ----
    timestep = _single_step_timestep()
    unet = get_unet()

    unet_input_names = [inp.name for inp in unet.get_inputs()]
    log.debug(f"UNet inputs: {unet_input_names}")

    # Build unet feed dict – handle various SDXS unet signatures
    unet_feed: dict[str, np.ndarray] = {}
    for name in unet_input_names:
        nl = name.lower()
        if "sample" in nl and "encoder" not in nl:
            # Duplicate latents for CFG batch size 2
            unet_feed[name] = np.concatenate([latents, latents], axis=0).astype(np.float32)
        elif "timestep" in nl or nl == "t":
            unet_feed[name] = np.array([timestep[0], timestep[0]], dtype=np.int64)
        elif "encoder" in nl or "hidden" in nl or "context" in nl or "text" in nl:
            unet_feed[name] = encoder_hidden_states.astype(np.float32)
        else:
            # Unknown input – supply zeros matching expected shape
            shape = [d if d > 0 else 1 for d in unet.get_inputs()[unet_input_names.index(name)].shape]
            unet_feed[name] = np.zeros(shape, dtype=np.float32)

    noise_pred = unet.run(None, unet_feed)[0]  # [2, 4, H/8, W/8]

    # ---- 4. Guidance ----
    # guidance_scale=0.0 → just use the conditional half directly (1-step SDXS)
    # With scale=0 the uncond embedding has no effect, so we take the conditional output
    noise_pred_uncond, noise_pred_text = noise_pred[0:1], noise_pred[1:2]
    guided = noise_pred_uncond  # guidance_scale=0.0 → no CFG correction

    # ---- 5. Compute denoised latent (1-step x_0 prediction) ----
    # For 1-step consistency/SDXS: latents = guided output directly
    denoised_latents = guided

    # ---- 6. VAE decode ----
    vae = get_vae_decoder()
    vae_input_name = vae.get_inputs()[0].name
    # TAESD expects [1, 4, H, W]; scale factor 1/0.18215 to map from latent space
    scaled_latents = denoised_latents / 0.18215
    vae_out = vae.run(None, {vae_input_name: scaled_latents.astype(np.float32)})[0]
    # Output shape: [1, 3, H, W], values in [-1, 1]
    image_np = vae_out[0]  # [3, H, W]

    # ---- 7. Post-process → PNG bytes ----
    # Clamp & scale to [0, 255]
    image_np = np.clip((image_np + 1.0) / 2.0, 0.0, 1.0)
    image_np = (image_np * 255).astype(np.uint8)
    image_np = image_np.transpose(1, 2, 0)  # [H, W, 3]

    from PIL import Image
    img = Image.fromarray(image_np, mode="RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False, compress_level=1)

    elapsed = time.perf_counter() - t0
    log.info(f"Generated image in {elapsed:.2f}s  ({pixel_w}×{pixel_h})")

    return buf.getvalue()


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="UIE SDXS Image Service",
    description="1-step ONNX image generation for game backgrounds",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve generated images as static files
app.mount("/gen", StaticFiles(directory=str(OUTPUT_DIR)), name="gen")


class GenerateLocationRequest(BaseModel):
    prompt: str
    location: Optional[str] = None
    biome: Optional[str] = None
    seed: Optional[int] = None


class GenerateLocationResponse(BaseModel):
    ok: bool
    image_path: str = ""
    url: str = ""
    elapsed_ms: int = 0
    error: str = ""


@app.get("/health")
def health():
    models_ready = (
        (SDXS_DIR / "unet" / "model.onnx").exists() and
        (SDXS_DIR / "text_encoder" / "model.onnx").exists()
    )
    taesd_ready = (TAESD_DIR / "vae_decoder" / "model.onnx").exists()
    return {
        "ok": True,
        "models_ready": models_ready,
        "taesd_ready": taesd_ready,
        "providers": PROVIDERS,
        "sdxs_dir": str(SDXS_DIR),
        "taesd_dir": str(TAESD_DIR),
    }


@app.get("/models/status")
def models_status():
    def check(p: Path):
        return {"exists": p.exists(), "path": str(p)}

    return {
        "sdxs": {
            "text_encoder": check(SDXS_DIR / "text_encoder" / "model.onnx"),
            "unet":         check(SDXS_DIR / "unet" / "model.onnx"),
            "vae_decoder":  check(SDXS_DIR / "vae_decoder" / "model.onnx"),
            "vae_encoder":  check(SDXS_DIR / "vae_encoder" / "model.onnx"),
        },
        "taesd": {
            "vae_decoder": check(TAESD_DIR / "vae_decoder" / "model.onnx"),
            "vae_encoder": check(TAESD_DIR / "vae_encoder" / "model.onnx"),
        },
    }


@app.post("/generate_location", response_model=GenerateLocationResponse)
async def generate_location(req: GenerateLocationRequest):
    """
    Generate a background image for a game location in 1 ONNX step.

    Body:
        prompt   – full text prompt describing the location
        location – human-readable name (used for filename)
        biome    – optional biome tag appended to prompt
        seed     – optional RNG seed for reproducibility
    """
    try:
        # Validate models are present
        if not (SDXS_DIR / "unet" / "model.onnx").exists():
            raise HTTPException(
                status_code=503,
                detail=(
                    "SDXS ONNX models not found. "
                    "Run: python scripts/download_sdxs_models.py"
                ),
            )

        # Build a rich prompt
        parts = [req.prompt or ""]
        if req.location and req.location.lower() not in (req.prompt or "").lower():
            parts.insert(0, req.location)
        if req.biome and req.biome.lower() not in " ".join(parts).lower():
            parts.append(req.biome)
        parts.append("high detail, visual novel environment, cinematic lighting")
        full_prompt = ", ".join(p.strip() for p in parts if p.strip())

        # Seed for reproducibility
        if req.seed is not None:
            np.random.seed(req.seed)

        t0 = time.perf_counter()
        png_bytes = generate_location_image(full_prompt)
        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        # Save to disk
        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in (req.location or "location"))
        uid = uuid.uuid4().hex[:8]
        filename = f"{safe_name}_{uid}.png"
        out_path = OUTPUT_DIR / filename
        out_path.write_bytes(png_bytes)

        url = f"/gen/{filename}"
        log.info(f"Saved → {out_path}  ({elapsed_ms}ms)")

        return GenerateLocationResponse(
            ok=True,
            image_path=str(out_path),
            url=url,
            elapsed_ms=elapsed_ms,
        )

    except HTTPException:
        raise
    except Exception as exc:
        log.exception("Generation failed")
        return GenerateLocationResponse(ok=False, error=str(exc))


# ---------------------------------------------------------------------------
# Dev entrypoint
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=28094, log_level="info")
