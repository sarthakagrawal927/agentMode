## Deploy to Hetzner with Dokploy

This guide shows how to deploy the monorepo (backend FastAPI and web Next.js) on a single Hetzner VM using Dokploy.

### Prerequisites
- A Hetzner Cloud server (Ubuntu 22.04/24.04, ≥2GB RAM, ≥30GB disk)
- A public DNS domain (e.g., example.com)
- GitHub repository access
- Secrets ready: OPENAI_API_KEY, REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET

### 1) Create the Hetzner VM
1. Provision a server in Hetzner Cloud (Ubuntu 22.04 or 24.04 recommended).
2. Add your SSH key during creation.
3. Optional basic firewall (UFW) on the VM:
   ```bash
   sudo ufw allow OpenSSH
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw allow 3000/tcp   # Dokploy dashboard (can be closed later if using a domain)
   sudo ufw enable
   ```

### 2) Install Dokploy
SSH into the VM as root (or a sudo user) and run:
```bash
curl -sSL https://dokploy.com/install.sh | sh
```
When finished, open `http://<SERVER_IP>:3000` and create the admin account.

Recommended next steps in the Dokploy dashboard:
- Settings → Integrations → Connect GitHub (GitHub App) for repository access and auto-deploys.
- Webserver → Email/ACME if you want custom ACME email for LetsEncrypt.

### 3) DNS: set up subdomains
Create DNS A records pointing to your VM IP:
- `api.example.com` → <SERVER_IP>
- `app.example.com` → <SERVER_IP>

You can use one domain as well, but separate subdomains keep web and API cleanly isolated.

### 4) Create the Backend app (FastAPI)
In Dokploy:
1. Projects → New Project (e.g., AgentData)
2. Inside the project → Create → Application
3. Source: Git Provider → select your repo and branch
4. Build settings (monorepo):
   - Repository path / Subdirectory: `backend`
   - Dockerfile path: `Dockerfile`
   - Context path: `backend`
5. Runtime:
   - Internal port: `8000`
   - Environment variables:
     - `OPENAI_API_KEY` = your key
     - `REDDIT_CLIENT_ID` = your client id
     - `REDDIT_CLIENT_SECRET` = your client secret
   - Volumes (to persist cache between deploys):
     - Add a persistent volume (e.g., `backend-cache`) and mount to `/app/.cache`
6. Domains:
   - Add `api.example.com`
   - Enable HTTPS (LetsEncrypt)
7. Deploy → watch logs until healthy. Healthcheck is `GET /`.

Notes:
- The Dockerfile exposes port 8000; Dokploy will map it via the reverse proxy automatically when a domain is attached.

### 5) Create the Web app (Next.js)
In Dokploy (same project):
1. Create → Application
2. Source: Git Provider → repo + branch
3. Build settings (monorepo):
   - Repository path / Subdirectory: `web`
   - Dockerfile path: `Dockerfile`
   - Context path: `web`
4. Runtime:
   - Internal port: `3000`
   - Environment variables:
     - `NEXT_PUBLIC_API_BASE_URL` = `https://api.example.com/api`
5. Domains:
   - Add `app.example.com`
   - Enable HTTPS
6. Deploy → open `https://app.example.com`

### 6) Verify and harden
- API quick check: `curl -fsSL https://api.example.com/ | jq` should return `{ "status": "API is running" }`.
- App should call the API via `NEXT_PUBLIC_API_BASE_URL` and render subreddit research, etc.
- CORS: The backend currently allows `*`. For production, consider restricting to your web origin(s) in `main.py` if needed.

### 7) CI/CD (optional)
If you connected GitHub, enable auto-deploy on push in the app settings. Dokploy will rebuild and roll out on each commit to the selected branch.

### 8) Troubleshooting
- 502/Bad Gateway: Ensure the app’s internal port matches the one your container serves (8000 for backend, 3000 for web) and that the deploy finished successfully.
- SSL issues: Confirm DNS is propagated and the domain is attached with HTTPS enabled in Dokploy.
- Persistent cache not working: Confirm volume is mounted to `/app/.cache` in the backend app.

That’s it — you should be live on Hetzner with Dokploy powering deployments for both services.


