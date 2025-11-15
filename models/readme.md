## Notes
Overall good exp but pretty low quality results. But these models can also be run at my m1 pro, some take more time than other.
Most of the code was AI written, but I did get to understand some common pitfalls and how Modal works. You need caching to avoid re-downloading modal, keep min-containers to 0 unless you want to be charged always. Dependencies are mostly straight forward, fastAPI wrapped models are easy to use/deploy. Selecting correct GPU is imp, AI can do that easily.

About models:
- Latte-1 (T2V)
  16 frames at max, so 8fps it gives 2s of mid video. Just a toy model.

- sdxl (T2I)
  decent, can easily swap fine-tuned models. But i don't think its good now, flux eats it.

- parler-tts (TTS)
  decent when you want under 20s audio. Merging chunks is an option but you need to ensure all chunks are coherent. Maybe some temperature related stuff.

- xtts (TTS)
  couldn't run it because on modal because it got stuck in responding the oss limitations.

- sadtalker (lip sync)
  pretty mid, difficult to make it work. since its old


## What I Learned (by AI)

* How to build Modal services with:

  * `modal.App`, `modal.Image.debian_slim`, `apt_install` / `pip_install`
  * `@app.function(..., gpu="L4", min_containers=1)` + `@modal.asgi_app()` for FastAPI
  * Shared HF cache volume at `/root/.cache/huggingface`

* How Modal web endpoints behave:

  * Hard-ish request time cap (~150s)
  * Need `curl -L` to follow Modal’s redirect

* FastAPI / Pydantic details:
  * `from __future__ import annotations` + inner Pydantic models → body treated as query
  * Fix by defining models at module level
  * Designed clean request schemas for TTS / image / video

* HF / diffusers patterns:

  * Some models need extra deps (`sentencepiece`, `beautifulsoup4`, etc.)
  * Some args are architectural (e.g. Latte `video_length=16`) and must be clamped
  * Can swap models behind the same API without changing clients

* TTS:

  * Implemented sentence-based text chunking with `max_chars`
  * Understood tradeoff between long chunks (coherence) and small chunks (safety)

* Video:
  * Internalized `duration = frames / fps` and Latte’s 16-frame limit
  * Compared JSON+base64 frames vs direct `video/mp4` responses
  * Implemented frames → PNG sequence → `ffmpeg` → MP4 flow

