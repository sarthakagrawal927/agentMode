# coqui does not allow, need to figure out how to deal with this
import io
import modal

app = modal.App("xtts-news")

# ---- Image with all deps ----
xtts_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git")
    .pip_install(
        "TTS==0.22.0",  # Coqui TTS lib (includes XTTS support)
        "soundfile",
        "fastapi[standard]",
        "numpy",
    )
)

with xtts_image.imports():
    from TTS.api import TTS as CoquiTTS
    import soundfile as sf
    import numpy as np
    from fastapi.responses import StreamingResponse


# ---- Model + voice defaults ----
MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"  # XTTS-v2
DEFAULT_SPEAKER = "Ana Florence"  # built-in Coqui speaker
DEFAULT_LANGUAGE = "en"
DEFAULT_SR = 24000  # XTTS-v2 sampling rate


@app.cls(
    image=xtts_image,
    gpu="A10G",  # flip to "L4" if you know you have L4 capacity
    volumes={
        "/root/.local/share/tts": modal.Volume.from_name(
            "xtts-cache", create_if_missing=True
        )
    },
    scaledown_window=300,
    timeout=900,  # enough for long scripts
)
class XTTSSynth:
    # Allow overriding speaker from Modal parameters later if you want
    speaker: str = modal.parameter(default=DEFAULT_SPEAKER)

    @modal.enter()
    def load(self):
        # Load XTTS model on GPU
        self.tts = CoquiTTS(MODEL_NAME, gpu=True)
        self.sample_rate = DEFAULT_SR

    # ---------- Core helper ----------
    def _tts(self, text: str, speaker: str):
        """
        Single-call TTS. Let Coqui handle sentence splitting +
        long-text concatenation internally.
        """
        wav = self.tts.tts(
            text=text,
            speaker=speaker,
            language=DEFAULT_LANGUAGE,
            split_sentences=True,  # library does the splitting + stitching
        )
        wav = np.asarray(wav)
        return wav, self.sample_rate

    # ---------- RPCs ----------

    @modal.method()
    def synthesize(self, text: str) -> bytes:
        """Short text -> WAV bytes."""
        audio, sr = self._tts(text, self.speaker)
        buf = io.BytesIO()
        sf.write(buf, audio, sr, format="WAV")
        return buf.getvalue()

    @modal.method()
    def synthesize_article(self, text: str) -> bytes:
        """
        Long article (~2k words) -> single WAV.
        XTTS handles sentence-level chunking internally.
        """
        audio, sr = self._tts(text, self.speaker)
        buf = io.BytesIO()
        sf.write(buf, audio, sr, format="WAV")
        return buf.getvalue()

    # ---------- HTTP endpoint (for your agent / backend) ----------

    @modal.fastapi_endpoint(docs=True, method="POST")
    def api(self, text: str):
        """
        POST form/json:
        - text: string (required)
        Returns: audio/wav stream
        """
        audio, sr = self._tts(text, self.speaker)
        buf = io.BytesIO()
        sf.write(buf, audio, sr, format="WAV")
        buf.seek(0)
        return StreamingResponse(buf, media_type="audio/wav")


# ---------- Local CLI entrypoint ----------
@app.local_entrypoint()
def main(
    mode: str = "short",  # "short" or "article"
    output_path: str = "xtts_news.wav",
):
    """
    Quick sanity check:
    modal run modal_xtts.py
    modal run modal_xtts.py --mode article
    """
    tts = XTTSSynth()

    if mode == "short":
        text = (
            "In today's top story, researchers announced a major breakthrough "
            "in artificial intelligence model efficiency."
        )
        audio_bytes = tts.synthesize.remote(text)
    else:
        # Replace this with your real article text in production.
        article = (
            "In today's top story, markets around the world reacted to a series "
            "of unexpected policy announcements. "
            "Analysts say the long-term impact will depend on how quickly central "
            "banks adjust to the new information. "
            "Meanwhile, technology companies continued their rapid growth, "
            "driven by advances in artificial intelligence and cloud computing. "
            "Investors remain cautiously optimistic as earnings season continues."
        )
        audio_bytes = tts.synthesize_article.remote(article)

    with open(output_path, "wb") as f:
        f.write(audio_bytes)

    print(f"Saved to {output_path}")
