"""
Download SDXS ONNX and TAESD ONNX models from Hugging Face Hub.
Run once to populate ./models/sdxs-onnx and ./models/taesd-onnx.
"""
import sys
import os
from pathlib import Path

# Ensure we run relative to the vocalist-vn-clean root
ROOT = Path(__file__).parent.parent
MODELS_DIR = ROOT / "models"

def download_repo(repo_id: str, dest: Path):
    from huggingface_hub import snapshot_download
    dest.mkdir(parents=True, exist_ok=True)
    print(f"[SDXS-Downloader] Downloading {repo_id} -> {dest}")
    local = snapshot_download(
        repo_id=repo_id,
        local_dir=str(dest),
        ignore_patterns=["*.msgpack", "*.bin", "flax_model*", "tf_model*", "*.h5", "rust_model*"],
    )
    print(f"[SDXS-Downloader] Done: {local}")
    return local

if __name__ == "__main__":
    # Download SDXS ONNX pipeline
    download_repo("lemonteaa/sdxs-onnx", MODELS_DIR / "sdxs-onnx")

    # Download TAESD ONNX (julienkay/taesd is the public ONNX-formatted TAESD)
    download_repo("julienkay/taesd", MODELS_DIR / "taesd-onnx")

    print("\n[SDXS-Downloader] All models downloaded successfully.")
    print(f"  SDXS  : {MODELS_DIR / 'sdxs-onnx'}")
    print(f"  TAESD : {MODELS_DIR / 'taesd-onnx'}")
