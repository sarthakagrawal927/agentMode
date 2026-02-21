# Cloudflare Migration Plan and Status

## Status (2026-02-21)

Production migration is complete.

- Frontend: `https://agent-mode.vercel.app` (Vercel)
- Backend: `https://agentdata-backend-prod.sarthakagrawal927.workers.dev` (Cloudflare Worker)
- Scheduler: GitHub Actions (`reddit-warmup-daily.yml`, `reddit-warmup-weekly.yml`)
- Render backend for this project: decommissioned

## Final Architecture

1. Vercel serves the Next.js frontend.
2. Cloudflare Worker serves all `/api/*` backend routes.
3. Cockroach/Postgres remains the system of record.
4. GitHub Actions runs daily and weekly warmup jobs.

## Operational Runbook

### Deploy backend

```bash
cd cloudflare/backend
npm install
npx wrangler whoami
npx wrangler deploy
```

### Required Worker secrets

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`

### Required Worker vars

- `ADMIN_EMAIL=sarthakagrawal927@gmail.com`
- `ADMIN_EMAILS=sarthakagrawal927@gmail.com`

### Required Vercel env var

- `NEXT_PUBLIC_API_BASE_URL=https://agentdata-backend-prod.sarthakagrawal927.workers.dev/api`

### Required GitHub Actions secret

- `AGENTDATA_API_BASE_URL=https://agentdata-backend-prod.sarthakagrawal927.workers.dev/api`

## Validation Checklist

- `GET /health` returns healthy and DB connected.
- `POST /api/research/subreddit` returns top posts for tracked subreddits.
- Discover feed loads from cached snapshots.
- Daily and weekly warmup workflows succeed.

## Rollback

Rollback is manual: point Vercel + GitHub Actions API base URLs back to a replacement backend if needed.
