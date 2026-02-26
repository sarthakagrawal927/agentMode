# AgentData

AI-powered Reddit subreddit research and analysis platform.

## Architecture

| Layer    | Stack                        | Location                  | Deploy                                      |
|----------|------------------------------|---------------------------|----------------------------------------------|
| Frontend | Next.js (App Router)         | `web/`                    | Vercel (auto-deploy on push)                 |
| Backend  | Cloudflare Workers (TypeScript) | `cloudflare/backend/`  | `npx wrangler deploy` from that directory    |
| Database | CockroachDB (PostgreSQL)     | Hosted (Neon/Cockroach)   | Connection string in worker secrets          |
| Auth     | Google Identity Services     | Client-side GSI popup     | OAuth client ID in env vars                  |

### Deprecated

- `backend/` - Original Python/FastAPI backend (was deployed on Render). **No longer in production.** Kept as reference. The Cloudflare Workers backend (`cloudflare/backend/`) is the canonical backend.

## URLs

- **Frontend**: https://agent-mode.vercel.app
- **Backend**: https://agentdata-backend-prod.sarthakagrawal927.workers.dev

## Key Files

- `cloudflare/backend/src/index.ts` - All backend logic (single-file worker)
- `cloudflare/backend/prompts.json` - Curated subreddit list with default prompts
- `cloudflare/backend/wrangler.jsonc` - Worker config and non-secret env vars
- `web/src/app/r/[subreddit]/SubredditClient.tsx` - Main subreddit research UI
- `web/src/app/discover/DiscoverClient.tsx` - Feed/discover page
- `web/src/app/page.tsx` - Homepage with curated subreddit tags
- `web/src/lib/auth.ts` - Google auth helpers
- `web/src/services/api.ts` - API client

## Environment Variables

### Cloudflare Worker (secrets via `wrangler secret put`)
- `DATABASE_URL` - CockroachDB connection string
- `OPENAI_API_KEY` - For AI summary generation
- `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` - Reddit API credentials

### Cloudflare Worker (vars in wrangler.jsonc)
- `ADMIN_EMAIL` / `ADMIN_EMAILS` - Comma-separated admin emails for auth

### Vercel Frontend
- `NEXT_PUBLIC_API_BASE_URL` - Backend URL (`https://agentdata-backend-prod.sarthakagrawal927.workers.dev/api`)
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` - Google OAuth client ID
- `NEXT_PUBLIC_ADMIN_EMAIL` / `NEXT_PUBLIC_ADMIN_EMAILS` - For client-side admin UI gating

## Commands

```bash
# Frontend dev
cd web && pnpm dev

# Backend dev (Cloudflare Worker)
cd cloudflare/backend && npx wrangler dev

# Deploy backend
cd cloudflare/backend && npx wrangler deploy

# Deploy frontend (auto on git push, or manual)
cd web && vercel --prod
```

## Admin Features (requires Google auth)

- Generate AI summaries for subreddits
- Edit per-subreddit prompts
- Add new subreddits to curated list (auto-added on prompt save)
- Remove subreddits from curated list (DELETE endpoint)

## Data Flow

1. Homepage shows curated subreddits from `/api/prompts`
2. Subreddit page fetches Reddit posts via `/api/research/subreddit`
3. Admin triggers AI summary stream via `/api/research/subreddit/summary/stream`
4. Results cached in DB with 24h TTL + daily snapshots for archive
