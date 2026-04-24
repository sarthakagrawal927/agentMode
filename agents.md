# agents.md — agentMode

## Purpose
Reddit research tool that pulls top posts, stores daily snapshots, and streams AI summaries with source references.

## Stack
- Framework: Next.js 16 (App Router) — `web/`; Cloudflare Worker (TypeScript) — `cloudflare/backend/`
- Language: TypeScript (frontend + CF worker); Python (legacy FastAPI — decommissioned)
- Styling: Tailwind CSS v4 + shadcn/ui
- DB: Turso (libSQL) via CF Worker
- Auth: Google Identity Services (client-side GSI popup); admin gating by email
- Testing: Playwright (`web/tests/`)
- Deploy: Vercel (frontend) + Cloudflare Workers (backend)
- Package manager: pnpm (web), npm (cloudflare/backend)

## Repo structure
```
web/                        # Next.js frontend
  src/app/                  # App Router pages
  src/services/api.ts       # API client
  src/lib/auth.ts           # Google auth helpers
cloudflare/backend/         # Production backend (single-file CF Worker)
  src/index.ts              # All backend logic
  prompts.json              # Curated subreddit list with default prompts
  wrangler.jsonc            # Worker config + cron triggers
backend/                    # Legacy FastAPI (decommissioned — local reference only)
models/                     # Modal.ai experiments
plans/                      # Planning docs
docs/                       # Migration plans
```

No root package.json — `web/` and `cloudflare/backend/` are entirely separate packages.

## Key commands
```bash
# Frontend dev
cd web && pnpm dev

# CF Worker dev
cd cloudflare/backend && npx wrangler dev

# Deploy backend
cd cloudflare/backend && npx wrangler deploy

# Deploy frontend (auto on git push)
cd web && vercel --prod

# Legacy Python (not used in prod)
cd backend && uv run uvicorn main:app --reload
```

## Architecture notes
- **Production backend is the CF Worker only.** FastAPI backend in `backend/` is fully decommissioned from production.
- **Cron**: CF Worker fires every 6 hours (`0 */6 * * *`). GitHub Actions trigger daily (06:15 UTC) and weekly (Sunday 06:20 UTC) to warm curated subreddits.
- **In-memory cache**: 24h TTL per subreddit; daily snapshots stored for archive/replay.
- **`prompts.json`**: curated subreddit list with default AI prompts — the primary config for what gets tracked.
- **Admin gating**: AI summary generation and prompt editing gated by `ADMIN_EMAIL`/`ADMIN_EMAILS` env vars.
- **AI**: OpenAI API for streaming summaries.
- **Secrets via wrangler**: `TURSO_URL`, `TURSO_AUTH_TOKEN`, `OPENAI_API_KEY`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`.
- Live: frontend at `https://agent-mode.vercel.app`, backend at `https://agentdata-backend-prod.sarthakagrawal927.workers.dev`.

## Active context
