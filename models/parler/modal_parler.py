import io
import re
import base64

import modal

app = modal.App("parler-tts-news")

# ---- Image with all deps ----
parler_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git")
    .pip_install(
        "soundfile",
        "fastapi[standard]",  # FastAPI + pydantic + Starlette + uvicorn
        "numpy",
        "transformers",  # explicit, even though parler-tts depends on it
        "git+https://github.com/huggingface/parler-tts.git",
    )
)


with parler_image.imports():
    import torch
    import numpy as np  # kept for future if you want concat/gaps
    from parler_tts import ParlerTTSForConditionalGeneration
    from transformers import AutoTokenizer
    import soundfile as sf

# ---- Model + voice defaults ----
MODEL_ID = "parler-tts/parler-tts-mini-v1.1"

NEWS_DESC = (
    "A clear, confident English news presenter with a neutral global accent, "
    "speaking at a slightly fast but very articulate pace in very clear studio-quality audio, "
    "with low emotion and stable prosody."
)

# Globals inside the container
model = None
tokenizer = None
device = None

# ---- FastAPI app ----
# FastAPI app is created inside fastapi_app() to avoid local import issues.


def _ensure_model_loaded():
    """Lazy-load Parler model+tokenizer on first request."""
    global model, tokenizer, device

    if model is not None:
        return model, tokenizer, device

    if torch.cuda.is_available():
        device = "cuda"
    else:
        device = "cpu"

    _model = ParlerTTSForConditionalGeneration.from_pretrained(MODEL_ID).to(device)
    _tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)

    model = _model
    tokenizer = _tokenizer
    return model, tokenizer, device


def _tts(text: str, description: str):
    """Core Parler call: description = how it sounds, text = what to say."""
    model, tokenizer, device = _ensure_model_loaded()

    desc_inputs = tokenizer(description, return_tensors="pt")
    prompt_inputs = tokenizer(text, return_tensors="pt")

    desc_ids = desc_inputs.input_ids.to(device)
    prompt_ids = prompt_inputs.input_ids.to(device)
    desc_mask = desc_inputs.attention_mask.to(device)
    prompt_mask = prompt_inputs.attention_mask.to(device)

    with torch.inference_mode():
        generation = model.generate(
            input_ids=desc_ids,
            attention_mask=desc_mask,
            prompt_input_ids=prompt_ids,
            prompt_attention_mask=prompt_mask,
        )

    audio = generation.cpu().numpy().squeeze()
    return audio, model.config.sampling_rate


def _chunk_text(text: str, max_chars: int = 400):
    """
    Split long text into sentence-based chunks,
    greedily packed to ~max_chars chars per segment.
    """
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    segments = []
    current = ""

    for s in sentences:
        if not s:
            continue

        if len(current) + len(s) + 1 <= max_chars:
            current = (current + " " + s).strip()
        else:
            if current:
                segments.append(current)
            current = s

    if current:
        segments.append(current)

    return segments


def _synthesize_article_bytes(
    text: str,
    description: str,
    max_chars: int = 400,
) -> tuple[int | None, list[bytes]]:
    """
    Long text -> multiple WAVs (one per chunk).
    Returns: (sampling_rate, list[bytes]).
    """
    segments = _chunk_text(text, max_chars=max_chars)

    wav_files: list[bytes] = []
    sr: int | None = None

    for seg in segments:
        if not seg.strip():
            continue

        audio, sr = _tts(seg, description)
        buf = io.BytesIO()
        sf.write(buf, audio, sr, format="WAV")
        wav_files.append(buf.getvalue())

    return sr, wav_files


# ---------- FastAPI endpoints ----------


def health():
    """
    Simple health-check.
    Forces model load on first call so you know GPU + image are good.
    """
    m, t, d = _ensure_model_loaded()
    return {
        "status": "ok",
        "device": d,
        "model_loaded": m is not None and t is not None,
        "model_id": MODEL_ID,
    }


# ---------- Modal ASGI entrypoint ----------
@app.function(
    image=parler_image,
    gpu="L4",
    volumes={
        "/root/.cache/huggingface": modal.Volume.from_name(
            "hf-cache", create_if_missing=True
        )
    },
    scaledown_window=300,
    timeout=300,
)
@modal.asgi_app()
def fastapi_app():
    """
    Expose FastAPI app via Modal.

    Endpoints:
      GET  /health
      POST /tts
    """
    from fastapi import FastAPI
    from pydantic import BaseModel
    from fastapi.responses import JSONResponse

    class TTSRequest(BaseModel):
        text: str
        description: str | None = None
        max_chars: int = 400

    def tts_endpoint(req: TTSRequest):
        """
        Chunk mode only:
        - Accepts long text
        - Splits into chunks
        - Returns base64-encoded WAV chunks
        """
        description = req.description or NEWS_DESC
        sr, wav_files = _synthesize_article_bytes(req.text, description, req.max_chars)

        chunks_b64: list[str] = [
            base64.b64encode(wav).decode("ascii") for wav in wav_files
        ]

        return JSONResponse(
            {
                "sampling_rate": sr,
                "chunks": chunks_b64,
            }
        )

    web_app = FastAPI(title="Parler TTS News", version="1.0.0")
    web_app.add_api_route("/health", health, methods=["GET"])
    web_app.add_api_route("/tts", tts_endpoint, methods=["POST"])
    return web_app
