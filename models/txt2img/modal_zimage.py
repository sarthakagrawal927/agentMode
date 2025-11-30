from __future__ import annotations

import base64
import io

import modal
from pydantic import BaseModel

app = modal.App("z-image-turbo")

# ---- Container image w/ deps ----
z_image_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git")
    .pip_install(
        "fastapi[standard]",  # FastAPI + pydantic + Starlette + uvicorn
        # Need bleeding-edge diffusers for ZImagePipeline (not in latest release)
        "diffusers[torch] @ git+https://github.com/huggingface/diffusers.git",
        "transformers",
        "accelerate",
        "safetensors",
        "Pillow",
    )
)


class TurboRequest(BaseModel):
    prompt: str
    height: int = 1024
    width: int = 1024
    num_inference_steps: int = 9
    guidance_scale: float = 0.0
    seed: int | None = None


with z_image_image.imports():
    import torch
    from diffusers import DiffusionPipeline
    from PIL import Image

# ---- Model defaults ----
MODEL_ID = "Tongyi-MAI/Z-Image-Turbo"

# Globals inside the container
pipe = None
device = None


def _ensure_pipeline_loaded():
    """Lazy-load the Z-Image pipeline so container cold starts stay fast."""
    global pipe, device

    if pipe is not None:
        return pipe, device

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if device == "cuda" else torch.float32

    _pipe = DiffusionPipeline.from_pretrained(
        MODEL_ID,
        torch_dtype=dtype,
        low_cpu_mem_usage=False,
        trust_remote_code=True,  # required: model ships custom pipeline class
    ).to(device)

    pipe = _pipe
    return pipe, device


def _generate_image(
    prompt: str,
    height: int,
    width: int,
    num_inference_steps: int,
    guidance_scale: float,
    seed: int | None,
) -> Image.Image:
    """Core txt2img call against the Tongyi Z-Image Turbo weights."""
    _pipe, dev = _ensure_pipeline_loaded()

    generator = None
    if seed is not None:
        generator = torch.Generator(device=dev).manual_seed(seed)

    result = _pipe(
        prompt=prompt,
        height=height,
        width=width,
        num_inference_steps=num_inference_steps,
        guidance_scale=guidance_scale,
        generator=generator,
    )
    return result.images[0]


def _encode_image_to_base64(img: Image.Image, fmt: str = "PNG") -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("ascii")


def health():
    """
    Simple health-check.
    Forces model load on first call so you know GPU + image are good.
    """
    _pipe, dev = _ensure_pipeline_loaded()
    return {
        "status": "ok",
        "device": dev,
        "model_loaded": _pipe is not None,
        "model_id": MODEL_ID,
    }


@app.function(
    image=z_image_image,
    gpu="L4",
    volumes={
        "/root/.cache/huggingface": modal.Volume.from_name(
            "hf-cache", create_if_missing=True
        )
    },
    scaledown_window=300,
    timeout=600,
    # If the repo is gated, set HUGGINGFACE_HUB_TOKEN as a Modal secret:
    # secrets=[modal.Secret.from_name("huggingface-token")],
)
@modal.asgi_app()
def fastapi_app():
    """
    Serve Z-Image Turbo via FastAPI on Modal.

    Endpoints:
      GET  /health
      POST /txt2img
    """

    from fastapi import FastAPI
    from fastapi.responses import JSONResponse

    def txt2img_endpoint(req: TurboRequest):
        img = _generate_image(
            prompt=req.prompt,
            height=req.height,
            width=req.width,
            num_inference_steps=req.num_inference_steps,
            guidance_scale=req.guidance_scale,
            seed=req.seed,
        )
        img_b64 = _encode_image_to_base64(img)

        return JSONResponse(
            {
                "image_base64": img_b64,
                "width": img.width,
                "height": img.height,
                "seed": req.seed,
            }
        )

    web_app = FastAPI(title="Z-Image Turbo", version="1.0.0")
    web_app.add_api_route("/health", health, methods=["GET"])
    web_app.add_api_route("/txt2img", txt2img_endpoint, methods=["POST"])
    return web_app
