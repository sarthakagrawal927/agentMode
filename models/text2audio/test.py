import torch
from parler_tts import ParlerTTSForConditionalGeneration
from transformers import AutoTokenizer
import soundfile as sf

device = "cuda:0" if torch.cuda.is_available() else "cpu"

model_id = "parler-tts/parler-tts-mini-v1"  # or tiny-v1 / multilingual / expresso

model = ParlerTTSForConditionalGeneration.from_pretrained(model_id).to(device)
tokenizer = AutoTokenizer.from_pretrained(model_id)

prompt = """
Hi this is Samantha, I want to say a few nice things for you. You are the most handsome and hardworking man in this world. You are god's favourite child.
"""
description = (
    "A young female speaker with a clear, natural voice, "
    "speaking sensually at a slow pace in very clear audio."
)

# description controls *how* it sounds
desc_ids = tokenizer(description, return_tensors="pt").input_ids.to(device)
# prompt is *what* is said
prompt_ids = tokenizer(prompt, return_tensors="pt").input_ids.to(device)

with torch.inference_mode():
    generation = model.generate(
        input_ids=desc_ids,
        prompt_input_ids=prompt_ids,
    )

audio = generation.cpu().numpy().squeeze()

sf.write("parler_tts_out.wav", audio, model.config.sampling_rate)
print("Saved to parler_tts_out.wav")
