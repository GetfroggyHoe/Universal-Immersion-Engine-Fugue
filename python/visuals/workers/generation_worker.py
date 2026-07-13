from __future__ import annotations

import asyncio
import io
import logging
import platform
import threading
import time
from typing import Any

from PIL import Image

log = logging.getLogger("visuals.workers.generation")


class GenerationWorker:
    _instance: GenerationWorker | None = None

    def __init__(self, max_concurrent: int | None = None) -> None:
        self._pipeline: Any = None
        self._pipeline_lock = threading.RLock()
        self._generation_lock = threading.Lock()
        self._device = self._detect_device()
        self._quality_mode = "balanced"
        self._loaded = False
        self._loading = False
        self._load_error: str | None = None
        self._jobs_processeded = 0
        self._total_generation_time = 0.0
        self._max_concurrent = max_concurrent or self._default_concurrency()
        self._semaphore: asyncio.Semaphore | None = None
        self._cancelled_jobs: set[str] = set()
        self._current_job_id: str | None = None
        self._healthy = True
        self._last_error: str | None = None

    @staticmethod
    def _detect_device() -> str:
        try:
            import torch
        except ImportError:
            return "cpu"
        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    @staticmethod
    def _default_concurrency() -> int:
        is_android = platform.system() == "Linux" and __import__("os").environ.get("ANDROID_ROOT")
        if is_android:
            return 1
        return min(2, __import__("os").cpu_count() or 1)

    @property
    def device(self) -> str:
        return self._device

    @property
    def quality_mode(self) -> str:
        return self._quality_mode

    @quality_mode.setter
    def quality_mode(self, value: str) -> None:
        if value in ("fast", "balanced", "quality"):
            self._quality_mode = value

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    @property
    def is_healthy(self) -> bool:
        return self._healthy

    @property
    def stats(self) -> dict[str, Any]:
        avg = (
            self._total_generation_time / self._jobs_processeded
            if self._jobs_processeded > 0
            else 0.0
        )
        return {
            "device": self._device,
            "quality_mode": self._quality_mode,
            "loaded": self._loaded,
            "loading": self._loading,
            "load_error": self._load_error,
            "jobs_processeded": self._jobs_processeded,
            "avg_generation_time": round(avg, 2),
            "max_concurrent": self._max_concurrent,
            "current_job_id": self._current_job_id,
            "healthy": self._healthy,
            "last_error": self._last_error,
        }

    def load_model(self) -> bool:
        """Load the Koji model into memory."""
        with self._pipeline_lock:
            if self._loaded:
                return True
            if self._loading:
                return False

            self._loading = True
            self._load_error = None

        try:
            from ..download_koji import check_koji_available, KOJI_DIR

            if not check_koji_available():
                self._load_error = f"Koji model not found at {KOJI_DIR}"
                self._loaded = False
                self._loading = False
                self._healthy = False
                return False

            import torch
            from diffusers import StableDiffusionPipeline, AutoencoderKL
            from transformers import CLIPTextModel, CLIPTokenizer

            log.info(f"Loading Koji model from {KOJI_DIR} on device={self._device}")

            dtype = torch.float16 if self._device == "cuda" else torch.float32

            # Load the flat checkpoint format
            checkpoint_path = KOJI_DIR / "koji_v21.safetensors"
            clip_path = KOJI_DIR / "koji_v21_clip_l.safetensors"
            vae_path = KOJI_DIR / "koji_v21_vae.safetensors"

            # Load VAE
            log.info("Loading VAE...")
            vae = AutoencoderKL.from_single_file(str(vae_path), torch_dtype=dtype)

            # Load CLIP text encoder and tokenizer
            log.info("Loading CLIP text encoder...")
            text_encoder = CLIPTextModel.from_single_file(str(clip_path), torch_dtype=dtype)
            
            # For tokenizer, we need to use a pretrained one since it's not in the checkpoint
            # Using runwayml/stable-diffusion-v1-5 tokenizer as it's compatible
            tokenizer = CLIPTokenizer.from_pretrained(
                "runwayml/stable-diffusion-v1-5",
                subfolder="tokenizer",
                torch_dtype=dtype,
            )

            # Load the main pipeline from single file
            log.info("Loading main model checkpoint...")
            pipeline = StableDiffusionPipeline.from_single_file(
                str(checkpoint_path),
                torch_dtype=dtype,
                safety_checker=None,
                requires_safety_checker=False,
            )

            # Replace components with our loaded ones
            pipeline.vae = vae
            pipeline.text_encoder = text_encoder
            pipeline.tokenizer = tokenizer

            pipeline = pipeline.to(self._device)

            if self._device == "cuda":
                try:
                    pipeline.enable_attention_slicing()
                except Exception:
                    pass
                try:
                    pipeline.enable_vae_slicing()
                except Exception:
                    pass

            with self._pipeline_lock:
                self._pipeline = pipeline
                self._loaded = True
                self._loading = False
                self._healthy = True

            log.info("Koji pipeline loaded successfully")
            return True

        except Exception as exc:
            log.error(f"Failed to load Koji pipeline: {exc}")
            with self._pipeline_lock:
                self._load_error = str(exc)
                self._loaded = False
                self._loading = False
                self._healthy = False
                self._last_error = str(exc)
            return False

            self._loading = True
            self._load_error = None

        try:
            from ..download_koji import check_koji_available, KOJI_DIR

            if not check_koji_available():
                self._load_error = f"Koji model not found at {KOJI_DIR}"
                self._loaded = False
                self._loading = False
                self._healthy = False
                return False

            import torch
            from diffusers import DiffusionPipeline

            log.info(f"Loading Koji pipeline from {KOJI_DIR} on device={self._device}")

            dtype = torch.float16 if self._device == "cuda" else torch.float32

            pipeline = DiffusionPipeline.from_pretrained(
                str(KOJI_DIR),
                torch_dtype=dtype,
                safety_checker=None,
                requires_safety_checker=False,
            )
            pipeline = pipeline.to(self._device)

            if self._device == "cuda":
                try:
                    pipeline.enable_attention_slicing()
                except Exception:
                    pass
                try:
                    pipeline.enable_vae_slicing()
                except Exception:
                    pass

            with self._pipeline_lock:
                self._pipeline = pipeline
                self._loaded = True
                self._loading = False
                self._healthy = True

            log.info("Koji pipeline loaded successfully")
            return True

        except Exception as exc:
            log.error(f"Failed to load Koji pipeline: {exc}")
            with self._pipeline_lock:
                self._load_error = str(exc)
                self._loaded = False
                self._loading = False
                self._healthy = False
                self._last_error = str(exc)
            return False

    def unload(self) -> None:
        with self._pipeline_lock:
            self._pipeline = None
            self._loaded = False
            self._loading = False

        try:
            import torch
            import gc
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

        log.info("Koji pipeline unloaded")

    def reload(self) -> bool:
        self.unload()
        return self.load_model()

    def health_check(self) -> dict[str, Any]:
        return {
            "healthy": self._healthy,
            "loaded": self._loaded,
            "device": self._device,
            "load_error": self._load_error,
            "last_error": self._last_error,
        }

    async def generate(
        self,
        job_id: str,
        prompt: str,
        negative_prompt: str = "",
        width: int = 512,
        height: int = 512,
        guidance_scale: float = 7.5,
        num_inference_steps: int = 20,
        seed: int | None = None,
    ) -> tuple[bytes, int, int]:
        if not self._loaded:
            if not self.load_model():
                raise RuntimeError(f"Cannot generate: model not loaded. {self._load_error}")

        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(self._max_concurrent)

        async with self._semaphore:
            if job_id in self._cancelled_jobs:
                self._cancelled_jobs.discard(job_id)
                raise RuntimeError(f"Job {job_id} was cancelled")

            self._current_job_id = job_id

            try:
                result = await asyncio.get_event_loop().run_in_executor(
                    None,
                    self._generate_sync,
                    prompt,
                    negative_prompt,
                    width,
                    height,
                    guidance_scale,
                    num_inference_steps,
                    seed,
                )
                return result
            finally:
                self._current_job_id = None

    def _generate_sync(
        self,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        guidance_scale: float,
        num_inference_steps: int,
        seed: int | None,
    ) -> tuple[bytes, int, int]:
        t0 = time.perf_counter()

        import torch

        with self._pipeline_lock:
            pipeline = self._pipeline

        if pipeline is None:
            raise RuntimeError("Pipeline not available")

        generator = None
        if seed is not None:
            generator = torch.Generator(device=self._device).manual_seed(seed)

        quality_steps = {
            "fast": max(8, num_inference_steps // 2),
            "balanced": num_inference_steps,
            "quality": min(50, num_inference_steps * 2),
        }
        steps = quality_steps.get(self._quality_mode, num_inference_steps)

        with self._generation_lock:
            result = pipeline(
                prompt=prompt,
                negative_prompt=negative_prompt or "low quality, blurry, text, watermark, signature",
                width=width,
                height=height,
                num_inference_steps=steps,
                guidance_scale=guidance_scale,
                generator=generator,
            )
            image = result.images[0]

        buf = io.BytesIO()
        image.save(buf, format="PNG", optimize=False)
        image_bytes = buf.getvalue()

        elapsed = time.perf_counter() - t0
        self._jobs_processeded += 1
        self._total_generation_time += elapsed

        log.info(f"Generated image in {elapsed:.2f}s ({width}x{height}, {steps} steps)")

        return image_bytes, image.size[0], image.size[1]

    def cancel_job(self, job_id: str) -> None:
        self._cancelled_jobs.add(job_id)

    def shutdown(self) -> None:
        self.unload()
        log.info("GenerationWorker shut down")


def get_generation_worker() -> GenerationWorker:
    if GenerationWorker._instance is None:
        GenerationWorker._instance = GenerationWorker()
    return GenerationWorker._instance
