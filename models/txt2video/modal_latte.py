from __future__ import annotations

import io
import base64
from pydantic import BaseModel

import modal


app = modal.App("latte-video-gen")

latte_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg")  # 👈 ffmpeg
    .pip_install(
        "fastapi[standard]",
        "diffusers[torch]",
        "transformers",
        "accelerate",
        "safetensors",
        "Pillow",
        "sentencepiece",
        "imageio[ffmpeg]",  # 👈 video writer
        "numpy",
    )
)


class T2VRequest(BaseModel):
    prompt: str
    negative_prompt: str | None = None

    video_length: int = 16
    height: int = 512
    width: int = 512
    num_inference_steps: int = 50
    guidance_scale: float = 7.5
    seed: int | None = None

    fps: int = 8


with latte_image.imports():
    import torch
    from diffusers import LattePipeline
    from PIL import Image
    import imageio.v2 as imageio
    import numpy as np
    import tempfile
    import os


def _frames_to_mp4_bytes(frames: list[Image.Image], fps: int = 8) -> bytes:
    """
    frames: list[PIL.Image.Image]
    returns: raw MP4 bytes
    """
    if not frames:
        raise ValueError("No frames passed to _frames_to_mp4_bytes")

    # 1. Create a temp file with a .mp4 suffix so imageio chooses ffmpeg
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        # 2. Write frames into that file
        with imageio.get_writer(tmp_path, fps=fps) as writer:
            for f in frames:
                arr = np.array(f.convert("RGB"))
                writer.append_data(arr)

        # 3. Read bytes back into memory
        with open(tmp_path, "rb") as f:
            video_bytes = f.read()
    finally:
        # 4. Clean up temp file
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    # Optional debug:
    print("MP4 size:", len(video_bytes), "bytes")
    return video_bytes


MODEL_ID = "maxin-cn/Latte-1"

pipe = None
device = None


def _ensure_model_loaded():
    """Lazy-load Latte pipeline."""
    global pipe, device

    if pipe is not None:
        return pipe, device

    device = "cuda" if torch.cuda.is_available() else "cpu"

    _pipe = LattePipeline.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.float16 if device == "cuda" else torch.float32,
    ).to(device)

    # Optional: memory/perf tweaks
    try:
        _pipe.enable_model_cpu_offload()
    except Exception:
        pass

    pipe = _pipe
    return pipe, device


def _generate_video_frames(
    prompt: str,
    negative_prompt: str | None,
    video_length: int,
    height: int,
    width: int,
    num_inference_steps: int,
    guidance_scale: float,
    seed: int | None,
):
    """Core Latte T2V call -> list[PIL.Image]."""
    _pipe, dev = _ensure_model_loaded()

    generator = None
    if seed is not None:
        generator = torch.Generator(device=dev).manual_seed(seed)

    result = _pipe(
        prompt=prompt,
        negative_prompt=negative_prompt or "",
        num_inference_steps=num_inference_steps,
        guidance_scale=guidance_scale,
        video_length=video_length,
        height=height,
        width=width,
        generator=generator,
        output_type="pil",
    )

    frames = result.frames[0]
    return frames


def _encode_image_to_base64(img: Image.Image, fmt: str = "PNG") -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("ascii")


def health():
    _pipe, dev = _ensure_model_loaded()
    return {
        "status": "ok",
        "device": dev,
        "model_loaded": _pipe is not None,
        "model_id": MODEL_ID,
    }


@app.function(
    image=latte_image,
    gpu="L4",
    volumes={
        "/root/.cache/huggingface": modal.Volume.from_name(
            "hf-cache", create_if_missing=True
        )
    },
    scaledown_window=300,
    timeout=900,
)
@modal.asgi_app()
def fastapi_app():
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse, Response

    def t2v_endpoint(req: T2VRequest):
        frames = _generate_video_frames(
            prompt=req.prompt,
            negative_prompt=req.negative_prompt,
            video_length=req.video_length,
            height=req.height,
            width=req.width,
            num_inference_steps=req.num_inference_steps,
            guidance_scale=req.guidance_scale,
            seed=req.seed,
        )

        frames_b64 = [_encode_image_to_base64(f, fmt="PNG") for f in frames]
        first = frames[0]

        return JSONResponse(
            {
                "fps": req.fps,
                "num_frames": len(frames_b64),
                "width": first.width,
                "height": first.height,
                "frames": frames_b64,
            }
        )

    def t2v_video_endpoint(req: T2VRequest):
        frames = _generate_video_frames(
            prompt=req.prompt,
            negative_prompt=req.negative_prompt,
            video_length=req.video_length,
            height=req.height,
            width=req.width,
            num_inference_steps=req.num_inference_steps,
            guidance_scale=req.guidance_scale,
            seed=req.seed,
        )

        video_bytes = _frames_to_mp4_bytes(frames, fps=req.fps)

        return Response(
            content=video_bytes,
            media_type="video/mp4",
            headers={"Content-Disposition": 'inline; filename="latte.mp4"'},
        )

    web_app = FastAPI(title="Latte T2V", version="1.0.0")
    web_app.add_api_route("/health", health, methods=["GET"])
    web_app.add_api_route("/t2v", t2v_endpoint, methods=["POST"])
    web_app.add_api_route("/t2v_video", t2v_video_endpoint, methods=["POST"])

    return web_app
