# AgentData Web

Next.js 14 frontend for the AgentData subreddit research product.

## Runtime

- Node.js 20+ (Vercel production currently uses Node 22)
- npm

## Environment Variables

Create `web/.env.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api
NEXT_PUBLIC_ADMIN_EMAIL=sarthakagrawal927@gmail.com
NEXT_PUBLIC_ADMIN_EMAILS=sarthakagrawal927@gmail.com
# Optional for Google sign-in
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
```

## Local Development

```bash
cd web
npm install
npm run dev
```

App runs on `http://localhost:3000`.

## Production Build

```bash
cd web
npm run build
npm run start
```

## Deployment

- Canonical frontend host: Vercel
- Project: `agent-mode`
- Current production URL: `https://agent-mode.vercel.app`
- Required production environment variable:
  - `NEXT_PUBLIC_API_BASE_URL=https://agentdata-backend-prod.sarthakagrawal927.workers.dev/api`
