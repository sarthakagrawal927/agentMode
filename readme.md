# AgentData

![AI Generated](https://ai-percentage-pin.vercel.app/api/ai-percentage?value=60)
![AI PRs Welcome](https://ai-percentage-pin.vercel.app/api/ai-prs?welcome=yes)

AgentData is a full-stack subreddit research tool. It collects top Reddit posts, caches/snapshots results, and generates AI summaries with source references.

## What It Does

- Pulls top posts for a subreddit over `1d`, `1week`, or `1month`
- Caches results in Postgres for faster repeat queries
- Stores daily snapshots you can revisit by date
- Streams AI summaries from the backend
- Supports custom subreddit prompts with admin-only updates
- Includes a Discover feed for previously cached summaries

## Architecture

- `cloudflare/backend/`: Cloudflare Workers backend in production
- `backend/`: legacy FastAPI backend (kept for local compatibility/reference)
- `web/`: Next.js 14 UI (App Router)
- `docs/`: deployment and migration notes

## Tech Stack

- Backend (prod): Cloudflare Workers (TypeScript), `pg`, Reddit OAuth API, OpenAI API
- Backend (legacy): FastAPI, asyncpg, asyncpraw
- Frontend: Next.js, React, TypeScript, Tailwind
- Data store: Postgres/CockroachDB (`cache_entries`, `prompts`, `snapshots`)

## Environment Variables

Backend (`backend/.env`):

- `DATABASE_URL` (required)
- `OPENAI_API_KEY` (required for summaries)
- `REDDIT_CLIENT_ID` (required)
- `REDDIT_CLIENT_SECRET` (required)
- `ADMIN_EMAIL` (required for prompt management + summary generation, set to `sarthakagrawal927@gmail.com` for current admin)
- `ADMIN_EMAILS` (optional list, use `sarthakagrawal927@gmail.com` or comma-separated emails)

Frontend (`web/.env.local`):

- `NEXT_PUBLIC_API_BASE_URL` (required, example: `http://localhost:8000/api`)
- `NEXT_PUBLIC_ADMIN_EMAIL` (recommended, set to `sarthakagrawal927@gmail.com` for current admin UX)
- `NEXT_PUBLIC_ADMIN_EMAILS` (optional list, use `sarthakagrawal927@gmail.com` or comma-separated emails)
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (optional, needed for Google sign-in)

## Local Development

### 1) Run backend

```bash
cd backend
cp env.example .env

# install uv if needed
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

uv sync
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 2) Run web app

```bash
cd web
cp env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

## Important API Endpoints

- `GET /` - health message
- `GET /health` - health + DB connectivity
- `POST /api/research/subreddit` - fetch/cached subreddit posts
- `GET /api/research/subreddit/{subreddit}/dates` - list snapshot dates
- `GET /api/research/subreddit/{subreddit}/snapshot/{date}` - fetch snapshot by date
- `GET /api/research/subreddit/feed` - discover feed
- `POST /api/research/subreddit/summary/stream` - stream AI summary (admin auth required)
- `GET /api/prompts` - list prompts
- `GET /api/prompts/{subreddit}` - get prompt for subreddit
- `POST /api/prompts/{subreddit}` - save prompt (admin auth required)

## Deployment

- Frontend is deployed on Vercel (`agent-mode`): `https://agent-mode.vercel.app`
- Backend is deployed on Cloudflare Workers: `https://agentdata-backend-prod.sarthakagrawal927.workers.dev`
- Render backend for this project has been decommissioned
- Cloudflare backend config and deploy package: `cloudflare/backend/`
- Cloudflare migration notes: `docs/cloudflare-migration-plan.md`
- Hetzner + Dokploy walkthrough: `docs/hetzner-dokploy.md`

## Scheduled Warmups

- Daily workflow: `.github/workflows/reddit-warmup-daily.yml`
  - Schedule: `06:15 UTC` daily
  - Warms only `1d` (daily only)
- Weekly workflow: `.github/workflows/reddit-warmup-weekly.yml`
  - Schedule: `06:20 UTC` on Sunday
  - Warms only `1week` (weekly only)
- Both workflows warm only curated technical, entrepreneurial, and Indian-market subreddits.
- Required GitHub repo secret:
  - `AGENTDATA_API_BASE_URL` (example: `https://agentdata-backend-prod.sarthakagrawal927.workers.dev/api`)
- Supports manual runs through `workflow_dispatch` for each workflow.
