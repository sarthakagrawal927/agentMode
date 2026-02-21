# Cloudflare Backend Deploy (Workers Runtime)

This package deploys the AgentData backend directly as a Cloudflare Worker (no Containers).

## Files

- `wrangler.jsonc`: Worker config
- `src/index.ts`: API implementation
- `prompts.json`: curated subreddit prompt defaults

## Required Secrets

Set these in Cloudflare Worker secrets:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`

Admin identity is set in `wrangler.jsonc` via:

- `ADMIN_EMAIL`
- `ADMIN_EMAILS`

## Commands

```bash
cd cloudflare/backend
npm install
wrangler whoami
wrangler secret put DATABASE_URL
wrangler secret put OPENAI_API_KEY
wrangler secret put REDDIT_CLIENT_ID
wrangler secret put REDDIT_CLIENT_SECRET
wrangler deploy
```
