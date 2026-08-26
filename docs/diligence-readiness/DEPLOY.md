# Deployment Guide

**Document date:** 2026-08-26  
**Repository:** `epermitarthouse-rgb/Epermit-main`  
**Warning:** This documents procedures only. **No deployment was performed during diligence.**

---

## 1. Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ | Frontend, scraper, worker |
| npm | bundled | Package management |
| Git | any | Clone and branch |
| Supabase CLI | latest | Migrations, Edge Functions |
| Railway CLI | optional | Deploy status, logs |
| Vercel CLI | optional | Frontend deploy |
| Docker | optional | Local scraper parity |

Access required:

- GitHub org `epermitarthouse-rgb` (write for deploy triggers)
- Railway workspace `PermitPilot`
- Vercel project linked to repo root
- Supabase project `eeqxyjrcldivtpikcpvk`
- Shared password vault (env values — see `ENV.md`)

---

## 2. Repository and branch strategy

| Branch | Role |
|--------|------|
| `main` | **Production** — Railway auto-deploy from `scraper-service/`; Vercel production |
| `feat/*` | Feature branches; merge via PR |
| `fix/*` | Bugfix branches |

**Production Railway deploy (verified 2026-08-26):** commit on `main`, root directory `/scraper-service`, Docker builder.

**Local-only branches (not on org remote as of audit):**

- `feat/code-analyzer-async-v2` (~10 commits)
- `replit-agent` (legacy)

Push feature branches to `origin` before relying on them for deploy.

---

## 3. Frontend deployment (Vercel)

### Configuration

- File: `vercel.json` (repo root)
- Build: `npm run build`
- Output: `dist/`
- SPA rewrite: all routes → `index.html`

### Automated (typical)

1. Push to `main` (or configured production branch)
2. Vercel builds and publishes `dist/`

### Manual

```bash
cd /path/to/Epermit-main
npm ci
npm run build
vercel deploy --prod
```

(Vercel CLI requires authenticated session — was **not verified** on audit machine.)

### Required environment variables (Vercel dashboard)

| Variable | Required |
|----------|----------|
| `VITE_API_BASE_URL` | **Yes** — must be `https://epermit-main-production.up.railway.app` (no trailing slash) |
| `VITE_SUPABASE_URL` | Optional if using hardcoded client in `src/lib/supabase.ts` |
| `VITE_SUPABASE_ANON_KEY` | Optional (same caveat) |

**Do not set** dead host `epermit-production.up.railway.app` (missing `-main`).

---

## 4. Railway backend deployment (scraper)

### Configuration

- `scraper-service/railway.toml` — Docker builder
- `scraper-service/Dockerfile`
- Service name: `Epermit-main`
- Public URL: `https://epermit-main-production.up.railway.app`

### Automated

- GitHub integration: push to `main` triggers deploy of `/scraper-service`
- CLI deploy also possible (`railway up` from linked directory)

### Manual (emergency)

```bash
cd scraper-service
railway link   # if not linked
railway up
```

### Required environment variables (Railway dashboard)

Minimum:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

See `ENV.md` for full list. Feature-specific: `OPENAI_API_KEY`, `QB_*`, `MS_GRAPH_*`, UCI flags, `PORTAL_CREDENTIALS_ENCRYPTION_KEY`.

Playwright browsers: included in Docker image build.

---

## 5. Document ingestion worker (Railway)

Separate Railway service: `document-ingestion-worker`

- Deploy from `document-ingestion-worker/` (verify root directory in Railway dashboard)
- Requires: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`
- Polls `document_ingestion_jobs` table

---

## 6. Supabase migrations and Edge Functions

### Link project

```bash
supabase link --project-ref eeqxyjrcldivtpikcpvk
```

### Apply migrations

```bash
supabase db push
```

Or apply via Supabase Dashboard SQL migration runner. **Verify production lag** — action-items notes pending UCI submission migrations.

### Deploy Edge Functions (examples)

```bash
supabase functions deploy intake-pipeline-agent
supabase functions deploy permitwizard-preflight
supabase functions deploy permitwizard-execute
supabase functions deploy process-scheduled-checklist-reports
```

Deploy all changed functions after migration updates.

### Edge secrets

```bash
supabase secrets set OPENAI_API_KEY=... SUPABASE_SERVICE_ROLE_KEY=... 
```

Also set: `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `PORTAL_CREDENTIALS_ENCRYPTION_KEY`, etc. (see `ENV.md`)

---

## 7. Environment configuration

- **Never commit** `.env`, `scraper-service/.env`, or worker `.env`
- Templates: `scraper-service/.env.example`, `document-ingestion-worker/.env.example`
- Production values: shared password vault (category per `ENV.md`)
- Local dev: copy examples, set `VITE_API_BASE_URL=http://localhost:5001` for parallel stack

Full inventory: **`ENV.md`**

---

## 8. Build and test commands

### Frontend

```bash
npm ci
npm run build          # production build
npm run lint           # ESLint
npm run theme:check    # theme regression script
```

**Audit note:** `npm run build` completed Vite bundle but **failed on PWA service worker generation** (workbox/terser) in local audit environment. Investigate before relying on local build as CI gate.

### Scraper

```bash
cd scraper-service && npm ci
npm test               # Node test runner (see package.json for file list)
node server.js         # local :3001
```

### Local full stack

```bash
npm run dev            # parallel: FE :5001, scraper :3002, ingestion worker
npm run dev:classic    # FE :5000, scraper :3001
```

---

## 9. Health verification

| Check | Command / URL | Expected |
|-------|---------------|----------|
| Scraper root | `curl -s -o /dev/null -w '%{http_code}' https://epermit-main-production.up.railway.app/` | 200 |
| QB status | `GET /api/quickbooks/status` | JSON `connected` field |
| Frontend | Open Vercel production URL | App loads, login works |
| Supabase | Dashboard → project healthy | Active |
| Edge function | Invoke smoke test (e.g. `validate-url`) | 200 |

Railway service status: `railway status` → **Online**

No `/health` route exists (returns 404).

---

## 10. Rollback procedure

### Railway (scraper)

1. Railway Dashboard → `Epermit-main` → Deployments
2. Select last known good deployment → **Redeploy**

Or CLI:

```bash
railway redeploy
# or deploy specific commit via GitHub revert + push
```

### Vercel (frontend)

1. Vercel Dashboard → Deployments → previous production deployment → **Promote to Production**

Or git revert on `main` and push.

### Supabase

- **Schema:** Restore from backup (see `RESTORE.md`) — forward migration rollback is not automated
- **Edge Functions:** Redeploy prior function bundle from git tag/commit

### Database data rollback

Not automated. Use Supabase PITR or backup restore only with explicit approval.

---

## 11. Common deployment failures

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Frontend API 404 / "Cannot GET /api/..." | Wrong `VITE_API_BASE_URL` | Set to `epermit-main-production.up.railway.app` |
| Scraper 503 on QB/OAuth | Missing `QB_*` or encryption key | Vault → Railway vars |
| Playwright fails on Railway | Missing system deps | Use Dockerfile deploy, not raw nixpacks |
| UCI routes 401 | Expired JWT or RLS | Re-login; check project access |
| Edge function 500 | Missing secret | `supabase secrets list` |
| Migration drift | Local migrations not pushed to prod | `supabase db push` with review |
| PWA build failure | workbox/terser on local build | See §8; may not block Vercel if env differs |

---

## 12. Automated vs manual steps

| Step | Automated | Manual |
|------|-----------|--------|
| Frontend build on git push | Vercel (if connected) | First-time Vercel project setup |
| Scraper Docker deploy on `main` push | Railway GitHub hook | Initial Railway service + env vars |
| Supabase migrations | **Manual** (`db push` or dashboard) | Always review SQL before prod |
| Edge Function deploy | **Manual** CLI | Per function |
| Edge secrets | **Manual** | Vault → `supabase secrets set` |
| Env vars (Railway/Vercel) | **Manual** | Vault copy |
| Ingestion worker deploy | Railway (if configured) | Verify separate service root |
| OAuth redirect URI updates | **Manual** | Intuit/Azure consoles when URL changes |
| Production smoke test | **Manual** | Checklist §9 |

---

## 13. Related documents

- Architecture: `ARCHITECTURE.md`
- Environment variables: `ENV.md`
- Restore: `RESTORE.md`
- Railway status snapshot: `RAILWAY_PRODUCTION_STATUS.md`
