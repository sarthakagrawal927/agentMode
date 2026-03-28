# Security Audit - AgentData

Audited: 2026-03-29

## HIGH Severity

- [x] **No rate limiting on any endpoint** — `cloudflare/backend/src/index.ts` (all routes, lines 1735-1785). Public endpoints like `/api/research/subreddit` trigger Reddit + OpenAI API calls with no throttling. Risk: resource exhaustion, runaway API costs, DDoS.
  - Fix: Add in-memory rate limiting. `/api/research/subreddit` at 10 req/min per IP, all others at 30 req/min. Return 429.

- [x] **Subreddit name not validated** — `cloudflare/backend/src/index.ts:162-166`. `normalizeSubredditName()` only strips `r/` prefix, accepts any characters/length. Arbitrary strings flow into Reddit API calls, cache keys, and DB queries.
  - Fix: Validate alphanumeric + underscores only, max 21 chars. Return 400 on invalid.

- [x] **Hardcoded admin email in client bundle** — `web/src/app/r/[subreddit]/SubredditClient.tsx:13`. `FALLBACK_ADMIN_EMAIL = 'sarthakagrawal927@gmail.com'` is shipped in the JS bundle. Leaks admin identity; bypasses env-var config.
  - Fix: Remove hardcoded fallback. Add `/api/admin/check` backend endpoint. Frontend calls API to determine admin status.

## MEDIUM Severity

- [ ] **CORS allows all origins** — `cloudflare/backend/src/index.ts:45`. `Access-Control-Allow-Origin: "*"` allows any website to call the API, including admin-gated endpoints (auth is via Bearer token, not cookies, so risk is limited but still unnecessary).
  - Note: Since auth uses Bearer tokens (not cookies), wildcard CORS doesn't enable CSRF. But restricting origins is defense-in-depth. Low-priority fix.

- [ ] **Error messages may leak internals** — `cloudflare/backend/src/index.ts:1702-1703`. Non-HttpError exceptions return `error.message` directly in the 500 response, which could expose stack traces or internal details.
  - Note: Acceptable for now since Cloudflare Workers sanitize most runtime errors. Monitor.

## LOW Severity

- [x] **Dead code directories** — `backend/`, `models/`, `SadTalker/`, `sampleIO/` are unused. `backend/` is the deprecated Python backend (per CLAUDE.md). Others are unrelated ML experiments. Increases repo size and attack surface.
  - Fix: Delete all four directories.

- [x] **Deprecated backend/.env has credentials** — `backend/.env` contains old PostgreSQL, LinkedIn, Reddit credentials. Not deployed but sitting in working tree (gitignored, not in history).
  - Note: Credentials should be rotated regardless. Deleting `backend/` resolves this.

## Auth Model (OK)

- Backend admin auth via `requireAdmin()` (`index.ts:580-594`): validates Google ID token against `ADMIN_EMAIL`/`ADMIN_EMAILS` env vars. Solid implementation.
- Frontend admin check is UI-only gating (`SubredditClient.tsx:333`). All write operations enforce auth server-side. Acceptable pattern.
- SQL injection: all queries use parameterized `args: [...]`. No risk found.
- Google token verification via `oauth2.googleapis.com/tokeninfo`. Standard approach.

## Secrets in Git History

- `.env` files are properly gitignored (`.gitignore` lines 8-18).
- No `.env` files found in git history (`git log --all --oneline -- '.env'` returns empty).
- Root `.env` exists in working tree (gitignored) with Reddit/OpenAI/Fish Audio keys — **rotate these credentials** as they're on disk.

## Deployment

- Backend: Cloudflare Workers (secrets via `wrangler secret put`). Correct approach.
- Frontend: Vercel auto-deploy on push. `NEXT_PUBLIC_*` vars are public by design.
- No CI/CD secret scanning configured. Recommend adding pre-commit hooks.
