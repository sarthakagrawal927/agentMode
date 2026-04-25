# Productization Plan: AgentData -> Reddit Monitor SaaS

Created: 2026-04-04

## Current State

AgentData is a single-tenant admin tool. One admin (you) curates ~18 subreddits via `prompts.json`, triggers AI summaries manually, and browses results on `agent-mode.vercel.app`. There are no user accounts, no billing, no notifications, and no way for anyone else to track their own subreddits.

### What exists today

| Capability | Location | Notes |
|---|---|---|
| Reddit post fetching | `cloudflare/backend/src/index.ts` lines 958-1082 (`getTopPostsForSubreddit`) | Fetches top posts + comments with score thresholds. Supports 1d/1week/1month durations. |
| AI summary generation | `index.ts` lines 1084-1149 (`generateSummaryText`) | gpt-4o-mini, structured JSON output with key_trend/notable_discussions/key_action |
| Auto-attach summaries | `index.ts` lines 1151-1292 (`maybeAttachAiSummary`) | Lazy: generates on first page view if missing. No scheduled/background generation. |
| Cache layer | `index.ts` lines 665-697 | Turso `cache_entries` table with 24h TTL |
| Daily snapshots | `index.ts` lines 699-749 | `snapshots` table, one per subreddit/date/period. Saved on cache write. |
| Discover feed | `index.ts` lines 1476-1521 (`handleFeed`) | Aggregates all cached subreddits for a given duration |
| Prompt management | `index.ts` lines 1523-1600 | CRUD for per-subreddit prompts. Admin-gated writes. |
| Auth | `index.ts` lines 607-632 | Google token verification, hardcoded admin emails in `wrangler.jsonc` |
| Frontend homepage | `web/src/app/page.tsx` | Lists curated subreddits from `/api/prompts`. ISR 24h. |
| Subreddit page | `web/src/app/r/[subreddit]/SubredditClient.tsx` | Shows AI summary + top posts. Admin can trigger re-generation, edit prompts. |
| Discover page | `web/src/app/discover/DiscoverClient.tsx` | Feed of all subreddit summaries. |

### DB schema (Turso/libSQL)

```sql
-- index.ts lines 50-72
cache_entries (namespace TEXT, key TEXT, data TEXT, expires_at TEXT) UNIQUE(namespace, key)
prompts (subreddit TEXT UNIQUE, prompt TEXT)
snapshots (subreddit TEXT, snap_date TEXT, period TEXT, data TEXT, created_at TEXT) UNIQUE(subreddit, snap_date, period)
```

---

## Target Product

**SubWatch** (working name) — AI-powered Reddit monitoring. Track subreddits, get digests, spot trends.

### Pricing

| Tier | Price | Subreddits | Features |
|---|---|---|---|
| Free | $0 | 1 | Public SEO page, weekly summary, basic view |
| Pro | $9/mo | Unlimited | Email + Slack digests (daily/weekly), custom prompts, keyword alerts, CSV export, private dashboards |
| Team | $29/mo | Unlimited | Everything in Pro + shared workspace (up to 5 seats), API access, JSON export, priority summary generation |

---

## Architecture Changes Overview

### New tables

```sql
-- Users (Google auth, extended from current admin-only model)
CREATE TABLE users (
  id TEXT PRIMARY KEY,            -- uuid
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  picture TEXT,
  plan TEXT DEFAULT 'free',       -- free | pro | team
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Teams
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT DEFAULT 'member',     -- owner | admin | member
  UNIQUE(team_id, user_id)
);

-- User subreddit tracking (replaces global prompts for multi-tenant)
CREATE TABLE tracked_subreddits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  team_id TEXT REFERENCES teams(id),     -- null = personal
  subreddit TEXT NOT NULL,
  prompt TEXT,                            -- custom prompt, null = default
  is_public BOOLEAN DEFAULT true,        -- public SEO page
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, subreddit)
);

CREATE INDEX idx_tracked_user ON tracked_subreddits(user_id);
CREATE INDEX idx_tracked_subreddit ON tracked_subreddits(subreddit);
CREATE INDEX idx_tracked_public ON tracked_subreddits(is_public, subreddit);

-- Digest preferences
CREATE TABLE digest_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  tracked_subreddit_id TEXT NOT NULL REFERENCES tracked_subreddits(id),
  channel TEXT NOT NULL,                 -- email | slack
  frequency TEXT NOT NULL,               -- daily | weekly
  slack_webhook_url TEXT,                -- for slack channel
  enabled BOOLEAN DEFAULT true,
  last_sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, tracked_subreddit_id, channel)
);

-- Keyword/topic alerts
CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  tracked_subreddit_id TEXT NOT NULL REFERENCES tracked_subreddits(id),
  keywords TEXT NOT NULL,                -- comma-separated keywords
  match_type TEXT DEFAULT 'any',         -- any | all | phrase
  channel TEXT NOT NULL,                 -- email | slack
  enabled BOOLEAN DEFAULT true,
  last_triggered_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_alerts_sub ON alerts(tracked_subreddit_id);

-- Sentiment/topic history (derived from snapshots)
CREATE TABLE trend_data (
  id TEXT PRIMARY KEY,
  subreddit TEXT NOT NULL,
  snap_date TEXT NOT NULL,
  period TEXT NOT NULL,
  sentiment_score REAL,                  -- -1.0 to 1.0
  top_topics TEXT,                       -- JSON array of {topic, count, sentiment}
  post_volume INTEGER,
  avg_score REAL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(subreddit, snap_date, period)
);

CREATE INDEX idx_trend_sub_date ON trend_data(subreddit, snap_date DESC);

-- API keys (Team tier)
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  team_id TEXT REFERENCES teams(id),
  key_hash TEXT UNIQUE NOT NULL,         -- sha256 of the key
  key_prefix TEXT NOT NULL,              -- first 8 chars for display
  name TEXT,
  last_used_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Worker changes (`cloudflare/backend/src/index.ts`)

The current monolithic ~1850-line worker stays as the core but gets extended:

1. **Auth expansion** (lines 607-632): `verifyGoogleToken` currently returns `{email}`. Extend to upsert into `users` table and return `{id, email, plan}`. Add a `requireUser` function (distinct from `requireAdmin`) that allows any authenticated user.

2. **New routes** (after line 1847):
   - `POST /api/tracked-subreddits` — add subreddit to user's tracking list (enforce plan limits)
   - `GET /api/tracked-subreddits` — list user's tracked subreddits
   - `DELETE /api/tracked-subreddits/:id` — remove
   - `PUT /api/tracked-subreddits/:id` — update prompt, public flag
   - `POST /api/digest-preferences` — set digest config
   - `GET /api/digest-preferences` — list user's digest prefs
   - `POST /api/alerts` — create keyword alert
   - `GET /api/alerts` — list alerts
   - `DELETE /api/alerts/:id` — remove alert
   - `GET /api/trends/:subreddit` — historical trend data
   - `GET /api/export/:subreddit` — CSV/JSON export (Pro+)
   - `POST /api/billing/checkout` — Stripe checkout session
   - `POST /api/billing/webhook` — Stripe webhook handler
   - `GET /api/billing/portal` — Stripe customer portal URL
   - `POST /api/teams` — create team (Team tier)
   - `POST /api/teams/:id/invite` — invite member
   - `POST /api/api-keys` — generate API key (Team tier)

3. **Scheduled handler** (new `scheduled` export alongside existing `fetch` export):
   - Cloudflare Workers supports `scheduled` event handler via cron triggers in `wrangler.jsonc`
   - Runs every 6 hours: iterates all `tracked_subreddits`, fetches fresh Reddit data, generates AI summaries, saves snapshots, computes trend data
   - After summary generation: check `digest_preferences` and `alerts`, queue notifications
   - Use Cloudflare Queues (or direct send) for email/Slack delivery

4. **Plan enforcement** middleware: check `users.plan` before allowing actions that exceed free tier limits.

### Frontend changes (`web/`)

1. **New pages**:
   - `web/src/app/dashboard/page.tsx` — logged-in user's tracked subreddits, digest settings, alerts
   - `web/src/app/dashboard/settings/page.tsx` — billing, plan management
   - `web/src/app/dashboard/alerts/page.tsx` — manage keyword alerts
   - `web/src/app/dashboard/team/page.tsx` — team management (Team tier)
   - `web/src/app/pricing/page.tsx` — pricing page with Stripe checkout
   - `web/src/app/s/[subreddit]/page.tsx` — public SEO page (distinct from `/r/[subreddit]`)

2. **Modified pages**:
   - `web/src/app/page.tsx` — add hero section, pricing CTA, social proof. Keep subreddit tags but reframe as "trending communities".
   - `web/src/app/r/[subreddit]/SubredditClient.tsx` — add "Track this subreddit" button for logged-in users. Show digest/alert config inline.
   - `web/src/app/discover/DiscoverClient.tsx` — filter by user's tracked subreddits if logged in.
   - `web/src/app/layout.tsx` — add persistent nav with auth state, dashboard link, plan badge.

3. **New components**:
   - `web/src/components/TrackButton.tsx` — "Track" CTA that opens prompt config
   - `web/src/components/DigestConfig.tsx` — email/Slack frequency picker
   - `web/src/components/AlertConfig.tsx` — keyword alert builder
   - `web/src/components/TrendChart.tsx` — line chart for sentiment/volume over time (use lightweight chart lib, e.g., `recharts` or `@nivo/line`)
   - `web/src/components/PricingCard.tsx` — plan comparison cards
   - `web/src/components/ExportButton.tsx` — CSV/JSON download trigger

4. **Auth upgrade** (`web/src/lib/auth.ts`): Current Google auth stores user in localStorage. Extend to call a new `POST /api/auth/session` endpoint on sign-in that upserts the user and returns plan/team info. Store plan info in auth context.

### Public SEO Pages (`/s/[subreddit]`)

- Server-rendered (no `'use client'`), ISR with 1-hour revalidation
- Query: `SELECT * FROM tracked_subreddits WHERE subreddit = ? AND is_public = true LIMIT 1` + latest snapshot
- Rich meta tags: `<title>r/{subreddit} AI Summary - Weekly Trends & Insights</title>`
- Structured data (JSON-LD) for Google rich results
- Content: AI summary, top discussion titles, trend chart (SVG server-rendered), "Track this subreddit" CTA
- Internal links to other public subreddit pages (cross-linking for SEO)
- Sitemap generation: add `web/src/app/sitemap.ts` that queries all public tracked subreddits

### Notification System

**Email** (Cloudflare Workers + Resend or Mailgun free tier):
- Resend free tier: 3,000 emails/month, 100/day — sufficient for early growth
- Digest email template: HTML with AI summary, top 3 discussions, trend sparkline, CTA to full page
- Alert email: keyword match context, link to post

**Slack** (incoming webhook):
- User provides webhook URL in digest preferences
- Digest message: Block Kit formatted with summary sections
- Alert message: keyword match with post link

### Billing (Stripe)

- Stripe Checkout for subscription creation
- Stripe Customer Portal for plan changes/cancellation
- Webhook handler for `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
- Store `stripe_customer_id` and `stripe_subscription_id` on `users` table
- Enforce plan limits in `requireUser` middleware

### Export

- `GET /api/export/:subreddit?format=csv&from=2026-01-01&to=2026-04-01` (Pro+)
- CSV columns: `date, subreddit, period, key_trend_title, key_trend_desc, notable_count, avg_post_score, sentiment_score`
- JSON: raw snapshot data from `snapshots` table
- Rate limit: 10 exports/hour per user

---

## Weekly Phases

### Week 1: User Accounts + Multi-Subreddit Tracking

**Goal**: Any user can sign in and track subreddits. Free tier enforced.

**Backend** (`cloudflare/backend/src/index.ts`):
- Add `users` and `tracked_subreddits` tables to `DB_SCHEMA_STATEMENTS` (line 50)
- Add `requireUser(request, env)` function after `requireAdmin` (line 632) — verifies Google token, upserts user, returns `{id, email, plan}`
- Add `POST /api/auth/session` — upsert user on sign-in, return user object
- Add CRUD routes for `/api/tracked-subreddits` — enforce 1-subreddit limit for free plan
- Modify `handleResearchSubreddit` (line 1294) — remove `ALLOWED_SUBREDDITS` restriction, allow any valid subreddit name for tracked users
- Keep existing admin routes and `prompts` table as-is for backward compatibility

**Frontend** (`web/`):
- Modify `web/src/lib/auth.ts` — on sign-in, call `POST /api/auth/session`, store user+plan in context
- Add `web/src/app/dashboard/page.tsx` — list tracked subreddits, "add subreddit" form
- Modify `web/src/app/r/[subreddit]/SubredditClient.tsx` — add "Track this subreddit" button (visible when logged in, subreddit not yet tracked)
- Modify `web/src/app/layout.tsx` — add nav bar with auth state, dashboard link
- Add `web/src/components/TrackButton.tsx`

**Config** (`cloudflare/backend/wrangler.jsonc`):
- No changes yet

### Week 2: Scheduled Digest System + Email Notifications

**Goal**: Summaries generated on schedule. Pro users get email digests.

**Backend** (`cloudflare/backend/src/index.ts`):
- Add `digest_preferences` table to `DB_SCHEMA_STATEMENTS`
- Add `scheduled` export to the worker:
  ```
  export default {
    async fetch(request, env) { ... },     // existing
    async scheduled(event, env, ctx) { ... }  // new
  }
  ```
- Scheduled handler logic:
  1. Query all distinct subreddits from `tracked_subreddits`
  2. For each: fetch Reddit data, generate AI summary, save to cache + snapshot
  3. Query `digest_preferences` where `enabled = true` and frequency matches (daily = every run, weekly = Saturday only)
  4. For each matching digest: compile summary, send email via Resend API
  5. Update `last_sent_at`
- Add digest preference CRUD routes
- Add `RESEND_API_KEY` to worker secrets

**Config** (`cloudflare/backend/wrangler.jsonc`):
- Add cron trigger:
  ```json
  "triggers": { "crons": ["0 */6 * * *"] }
  ```

**Frontend** (`web/`):
- Add `web/src/app/dashboard/digests/page.tsx` — configure email frequency per tracked subreddit
- Add `web/src/components/DigestConfig.tsx` — frequency picker (daily/weekly), email toggle

### Week 3: Slack Notifications + Keyword Alerts

**Goal**: Slack webhook integration. Keyword alerts trigger on new posts matching criteria.

**Backend** (`cloudflare/backend/src/index.ts`):
- Add `alerts` table to `DB_SCHEMA_STATEMENTS`
- Extend scheduled handler: after fetching new Reddit data, scan post titles + selftext + top comment bodies against `alerts.keywords` for each tracked subreddit
- Keyword matching logic: split keywords by comma, check if any/all/phrase appears in post content (case-insensitive)
- On match: send alert via configured channel (email or Slack webhook)
- Add Slack webhook sender: `POST` to `slack_webhook_url` with Block Kit payload
- Add alert CRUD routes: `POST/GET/DELETE /api/alerts`
- Add Slack digest sender alongside email sender in digest flow

**Frontend** (`web/`):
- Add `web/src/app/dashboard/alerts/page.tsx` — list/create/delete keyword alerts
- Add `web/src/components/AlertConfig.tsx` — keyword input, match type selector, channel picker
- Modify `web/src/components/DigestConfig.tsx` — add Slack webhook URL field, test button

### Week 4: Public SEO Pages + Sitemap

**Goal**: Every tracked subreddit with `is_public = true` gets a server-rendered indexable page. SEO flywheel begins.

**Frontend** (`web/`):
- Add `web/src/app/s/[subreddit]/page.tsx` — server component, fetches latest snapshot + AI summary
  - Rich `<head>` meta: title, description, og:image (generate via Vercel OG or static)
  - JSON-LD structured data (`Article` or `WebPage` schema)
  - Content sections: AI summary (key_trend, notable_discussions, key_action), top post titles with Reddit links, "Updated daily" badge
  - Footer CTA: "Track r/{subreddit} yourself — get daily digests"
  - Internal links: "Related communities" linking to other public subreddit pages
- Add `web/src/app/sitemap.ts`:
  - Queries backend for all public tracked subreddits
  - Generates `/s/{subreddit}` URLs with weekly changefreq
- Add `web/src/app/robots.ts` — allow `/s/*`, disallow `/dashboard/*`
- Modify `web/src/app/page.tsx` — link curated subreddits to `/s/{subreddit}` instead of `/r/{subreddit}`

**Backend** (`cloudflare/backend/src/index.ts`):
- Add `GET /api/public-subreddits` — returns list of subreddits with `is_public = true` (for sitemap)
- Add `GET /api/public-subreddits/:subreddit` — returns latest summary + snapshot for public page (no auth required, cached aggressively)

### Week 5: Historical Trends + Sentiment

**Goal**: Track topic/sentiment changes over time. Display trend charts on subreddit pages.

**Backend** (`cloudflare/backend/src/index.ts`):
- Add `trend_data` table to `DB_SCHEMA_STATEMENTS`
- Extend scheduled handler: after generating AI summary, also compute trend metrics:
  - Sentiment score: add a second OpenAI call (or extend the summary prompt) to return a -1.0 to 1.0 sentiment score
  - Top topics: extract from notable_discussions titles, count frequency across snapshots
  - Post volume: count of posts fetched
  - Avg score: mean of post scores
- Save to `trend_data` table
- Add `GET /api/trends/:subreddit?from=&to=&period=` — returns trend_data rows for date range
- Backfill script: iterate existing `snapshots` table, extract trend metrics from stored AI summaries

**Frontend** (`web/`):
- Add `web/src/components/TrendChart.tsx` — line chart using a lightweight library (recharts, ~45KB gzipped; or raw SVG for zero-dep)
  - X-axis: dates, Y-axis: sentiment + post volume (dual axis)
  - Tooltip: date, sentiment score, top topics, post count
- Modify `web/src/app/r/[subreddit]/SubredditClient.tsx` — add "Trends" tab showing TrendChart + top topics list
- Modify `web/src/app/s/[subreddit]/page.tsx` — add server-rendered SVG sparkline for sentiment trend (no JS needed for SEO page)

### Week 6: Pricing + Billing (Stripe)

**Goal**: Stripe integration. Users can upgrade to Pro/Team. Plan limits enforced.

**Backend** (`cloudflare/backend/src/index.ts`):
- Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to worker secrets
- Add `POST /api/billing/checkout` — create Stripe Checkout Session with price ID based on selected plan
- Add `POST /api/billing/webhook` — handle Stripe events:
  - `checkout.session.completed` — update `users.plan`, set `stripe_customer_id` and `stripe_subscription_id`
  - `customer.subscription.updated` — handle plan changes
  - `customer.subscription.deleted` — downgrade to free, enforce subreddit limit (keep first tracked, mark rest inactive)
  - `invoice.payment_failed` — flag user, send warning email
- Add `GET /api/billing/portal` — return Stripe Customer Portal URL
- Modify `requireUser` — include plan in return value, add `requirePlan(minPlan)` helper

**Frontend** (`web/`):
- Add `web/src/app/pricing/page.tsx` — three-column pricing grid with feature comparison, Stripe checkout buttons
- Add `web/src/components/PricingCard.tsx`
- Add `web/src/app/dashboard/settings/page.tsx` — current plan display, upgrade/downgrade buttons, Stripe portal link
- Modify plan-gated UI: show upgrade prompts when free users hit limits (e.g., "Add more subreddits — upgrade to Pro")

### Week 7: Export + API Keys + Team Workspace

**Goal**: CSV/JSON export for Pro+. API keys and shared workspace for Team tier.

**Backend** (`cloudflare/backend/src/index.ts`):
- Add `api_keys` and `teams`/`team_members` tables to `DB_SCHEMA_STATEMENTS`
- Add `GET /api/export/:subreddit?format=csv|json&from=&to=` (Pro+):
  - Query `snapshots` table for date range
  - CSV: stream rows as text/csv with Content-Disposition header
  - JSON: return array of snapshot objects
- Add `POST /api/api-keys` (Team):
  - Generate random key, hash with SHA-256, store hash + prefix
  - Return full key once (never stored in plaintext)
- Add API key auth: check `Authorization: Bearer sk-...` against `api_keys.key_hash`
- Add team routes:
  - `POST /api/teams` — create team, set owner
  - `POST /api/teams/:id/invite` — add member by email
  - `GET /api/teams/:id/members` — list members
  - `DELETE /api/teams/:id/members/:userId` — remove member
- Team subreddit sharing: `tracked_subreddits.team_id` — when set, all team members can view/configure

**Frontend** (`web/`):
- Add `web/src/components/ExportButton.tsx` — format picker + date range, triggers download
- Modify `web/src/app/r/[subreddit]/SubredditClient.tsx` — add export button (Pro+)
- Add `web/src/app/dashboard/team/page.tsx` — team management: invite members, list members, manage roles
- Add `web/src/app/dashboard/api-keys/page.tsx` — generate/revoke API keys, usage stats

### Week 8: Polish, Testing, Launch Prep

**Goal**: End-to-end testing, performance optimization, launch.

**Testing**:
- Add Vitest unit tests for worker route handlers (mock Turso client, mock Reddit/OpenAI responses)
- Add Playwright e2e tests: sign in -> track subreddit -> view summary -> configure digest -> export
- Test Stripe webhook handling with Stripe CLI
- Load test scheduled handler with 100+ tracked subreddits

**Performance**:
- Add `Cache-Control` headers to public SEO pages (1 hour)
- Lazy-load TrendChart component on subreddit page
- Code-split dashboard routes
- Add loading skeletons to all data-fetching pages (some already exist: `web/src/app/r/[subreddit]/loading.tsx`)

**Launch**:
- Update `web/src/app/page.tsx` — landing page with value prop, social proof placeholder, pricing CTA
- Add `og:image` generation for subreddit SEO pages
- Configure custom domain (move off `agent-mode.vercel.app`)
- Set up monitoring: Cloudflare Worker analytics + Vercel analytics
- Stripe product/price setup in Stripe dashboard
- Write changelog / launch blog post

---

## Dependencies and Costs

| Service | Tier | Monthly Cost | Purpose |
|---|---|---|---|
| Turso | Free (500 DBs, 9GB) | $0 | Database |
| Cloudflare Workers | Free (100K req/day) | $0 | Backend + scheduled jobs |
| Vercel | Free (100GB bandwidth) | $0 | Frontend hosting |
| OpenAI (gpt-4o-mini) | Pay-as-you-go | ~$5-20 | AI summaries (scales with tracked subreddits) |
| Resend | Free (3K emails/mo) | $0 | Email digests + alerts |
| Stripe | 2.9% + 30c per transaction | ~$0 at low volume | Billing |
| Reddit API | Free (100 QPM) | $0 | Data source |

**Break-even**: ~6 Pro subscribers ($54/mo) covers OpenAI costs at moderate scale (~200 tracked subreddits).

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Reddit API rate limits (100 QPM) | Scheduled handler can't refresh all subreddits | Batch fetches, stagger over 6-hour window, prioritize active users |
| OpenAI cost spike with many users | Margins erode | Cache aggressively (24h), share summaries across users tracking same subreddit, batch similar prompts |
| Cloudflare Worker 30s CPU limit | Scheduled handler times out with many subreddits | Use Cloudflare Queues to fan out work per-subreddit, each runs independently |
| Free tier abuse | Bots create accounts to scrape | Rate limit by IP + account age, require email verification |
| SEO pages thin content | Google penalizes | Ensure each page has 500+ words of unique AI-generated content, refresh weekly |

## Migration Strategy

The existing `prompts` table and admin workflow continue working unchanged. New user-facing features run in parallel. Steps:

1. Deploy schema migrations (additive only, no breaking changes to existing tables)
2. Existing curated subreddits from `prompts.json` become "system" tracked subreddits (public, no owner)
3. Admin endpoints (`requireAdmin`) remain for content moderation
4. Old `/r/[subreddit]` routes redirect to `/s/[subreddit]` for public pages, or remain as authenticated views for tracking users
