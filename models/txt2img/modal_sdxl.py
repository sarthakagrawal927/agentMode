from __future__ import annotations

import io
import base64
import modal
from pydantic import BaseModel  # now safe at top level

app = modal.App("sdxl-image-gen")

# ---- Image with all deps ----
sdxl_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git")
    .pip_install(
        "fastapi[standard]",  # FastAPI + pydantic + Starlette + uvicorn
        "diffusers[torch]",  # SDXL pipeline + deps (will pull torch)
        "transformers",
        "accelerate",
        "safetensors",
        "Pillow",
    )
)


class Txt2ImgRequest(BaseModel):
    prompt: str
    negative_prompt: str | None = None
    width: int = 1024
    height: int = 1024
    num_inference_steps: int = 25
    guidance_scale: float = 5.0
    seed: int | None = None


# Heavy / runtime deps
with sdxl_image.imports():
    import torch
    from diffusers import StableDiffusionXLPipeline
    from PIL import Image

# ---- Model defaults ----
MODEL_ID = "stabilityai/stable-diffusion-xl-base-1.0"

# Globals inside the container
pipe = None
device = None


# ---- Core helpers ----
def _ensure_model_loaded():
    """Lazy-load SDXL pipeline on first request."""
    global pipe, device

    if pipe is not None:
        return pipe, device

    device = "cuda" if torch.cuda.is_available() else "cpu"

    _pipe = StableDiffusionXLPipeline.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.float16 if device == "cuda" else torch.float32,
        use_safetensors=True,
    ).to(device)

    # Optional: small memory optimizations
    try:
        _pipe.enable_attention_slicing()
    except Exception:
        pass

    pipe = _pipe
    return pipe, device


def _generate_image(
    prompt: str,
    negative_prompt: str | None,
    width: int,
    height: int,
    num_inference_steps: int,
    guidance_scale: float,
    seed: int | None,
) -> Image.Image:
    """Core SDXL txt2img call."""
    _pipe, dev = _ensure_model_loaded()

    generator = None
    if seed is not None:
        generator = torch.Generator(device=dev).manual_seed(seed)

    result = _pipe(
        prompt=prompt,
        negative_prompt=negative_prompt,
        width=width,
        height=height,
        num_inference_steps=num_inference_steps,
        guidance_scale=guidance_scale,
        generator=generator,
    )
    img: Image.Image = result.images[0]
    return img


def _encode_image_to_base64(img: Image.Image, fmt: str = "PNG") -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("ascii")


# ---------- FastAPI endpoints ----------
def health():
    """
    Simple health-check.
    Forces model load on first call so you know GPU + image are good.
    """
    _pipe, dev = _ensure_model_loaded()
    return {
        "status": "ok",
        "device": dev,
        "model_loaded": _pipe is not None,
        "model_id": MODEL_ID,
    }


# ---------- Modal ASGI entrypoint ----------
@app.function(
    image=sdxl_image,
    gpu="L4",
    volumes={
        "/root/.cache/huggingface": modal.Volume.from_name(
            "hf-cache", create_if_missing=True
        )
    },
    scaledown_window=300,
    timeout=600,
    # If SDXL repo is gated, set a secret with HUGGINGFACE_HUB_TOKEN and uncomment:
    # secrets=[modal.Secret.from_name("huggingface-token")],
)
@modal.asgi_app()
def fastapi_app():
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse

    def txt2img_endpoint(req: Txt2ImgRequest):
        img = _generate_image(
            prompt=req.prompt,
            negative_prompt=req.negative_prompt,
            width=req.width,
            height=req.height,
            num_inference_steps=req.num_inference_steps,
            guidance_scale=req.guidance_scale,
            seed=req.seed,
        )
        img_b64 = _encode_image_to_base64(img, fmt="PNG")

        return JSONResponse(
            {
                "image_base64": img_b64,
                "width": img.width,
                "height": img.height,
            }
        )

    web_app = FastAPI(title="SDXL Image Gen", version="1.0.0")
    web_app.add_api_route("/health", health, methods=["GET"])
    web_app.add_api_route("/txt2img", txt2img_endpoint, methods=["POST"])
    return web_app
