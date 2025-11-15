## AgentData

A small, two-service project for researching subreddits and aggregating persona-style insights. The new structure separates a FastAPI backend from a Next.js frontend for clean deploys.

### Architecture
- **backend**: FastAPI service exposing `/api` endpoints
- **web**: Next.js 14 app (App Router) consuming the backend

Legacy notes, experiments, and older details have been moved to `oldreadme.md`.

### Prerequisites
- Node.js 20+
- Python 3.11+

### Environment variables
- **Backend** (place in `backend/.env`):
  - `OPENAI_API_KEY`
  - `REDDIT_CLIENT_ID`
  - `REDDIT_CLIENT_SECRET`
- **Frontend** (place in `web/.env`):
  - `NEXT_PUBLIC_API_BASE_URL` (e.g. `http://localhost:8000/api`)

### Local development (uv + Next.js)
```bash
# Backend
cd backend
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
uv sync
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Frontend
cd web
npm install
npm run dev
```

Open the app at http://localhost:3000. The API runs on http://localhost:8000.

Ensure you have `backend/.env` and `web/.env` populated as noted above.

### API
- `GET /` — health check
- `POST /api/research/subreddit` — body: `{ subreddit_name: string, duration?: '1d' | '1week' | '1month', limit?: number }`
- `POST /api/research` — legacy persona aggregator (kept for reference)

### Deploy
- **Backend (Render)**
  - Path: `backend/`
  - Build Command: `curl -LsSf https://astral.sh/uv/install.sh | sh && export PATH=\"$HOME/.local/bin:$PATH\" && uv sync --no-dev`
  - Start Command: `export PATH=\"$HOME/.local/bin:$PATH\" && uv run uvicorn main:app --host 0.0.0.0 --port $PORT`
  - Env Vars: `OPENAI_API_KEY`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`
  - Optional IaC: `backend/render.yaml` is included (monorepo).
- **Frontend (Vercel)**
  - Framework: Next.js 14 (auto-detected)
  - Env Var: `NEXT_PUBLIC_API_BASE_URL` → set to your Render backend public URL (e.g. `https://your-render-service.onrender.com/api`)
  - Build Command: default (`next build`)
  - Output: default (`.next`)

### Notes
- The older notes and examples live in `oldreadme.md` to keep this README focused on the new structure and deploy path.

## To convert sadtalker response to video:

Sample curl:
```bash
 curl -v -X POST \
  -F "face=@/Users/sarthakagrawal/Desktop/agentData/sample.webp;type=image/webp" \
  -F "audio=@/Users/sarthakagrawal/Desktop/agentData/sample_small.mp3;type=audio/mpeg" \
  {{api_link}}/generateVideo \
-H "x-api-key: {{api_key}}" -o response.json
```

## Sadtalker

```bash
cat response.json | jq -r .video_b64 | base64 --decode > final.mp4
open final.mp4
```

## Parler-TTS

```bash
curl -s "$BASE_URL/tts" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "In today\u2019s top story, markets around the world reacted to a series of unexpected policy announcements. Analysts say the long-term impact will depend on how quickly central banks adjust to the new information.",
    "max_chars": 400
  }' > response.json


i=0
jq -r '.chunks[]' response.json | while read -r c; do
  echo "$c" | base64 -d > "chunk_${i}.wav"   # base64 -D on macOS
  i=$((i+1))
done
```

## SDXL
```bash
curl -X POST -s "$BASE_URL/txt2img" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "a natural photo of female news anchor in a modern studio, wearing a suit, behind stand, sitting delivering news, slighltly zoomed in 4k, high detail, no camera",
    "negative_prompt": "blurry, distorted, low quality, text, watermark",
    "width": 1024,
    "height": 1024,
    "num_inference_steps": 40,
    "guidance_scale": 6.0,
    "seed": 42
  }' > response.json


jq -r '.image_base64' response.json | base64 -d > sdxl_news.png
```

## Latte-1 (T2V)
```bash
curl -X POST -s "$BASE_URL/t2v" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "a natural photo of female news anchor in a modern studio, wearing a suit, behind stand, sitting delivering news, slighltly zoomed in 4k, high detail, no camera",
    "negative_prompt": "blurry, distorted, low quality, text, watermark",
    "video_length": 16,
    "height": 512,
    "width": 512,
    "num_inference_steps": 40,
    "guidance_scale": 6.0,
    "seed": 42,
    "fps": 8
  }' > response.json
```

## Other Models
- EchoMimic (talking head)