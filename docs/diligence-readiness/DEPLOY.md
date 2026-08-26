# Deployment Guide

**Document date:** 2026-08-26  
**Scope:** Procedures only. **No deployment performed** during this audit.

Legend: **Verified** | **Client confirmed** | **Requires manual confirmation**

Index: [README.md](./README.md)

---

## 1. Prerequisites

### Node.js version (**verified from repository**)

| Source | Requirement |
|--------|-------------|
| `document-ingestion-worker/package.json` `engines` | **`node >= 20`** |
| `scraper-service/Dockerfile` | **Playwright image** `mcr.microsoft.com/playwright:v1.58.2-jammy` (Node 20 base) |
| Root `package.json` | No `engines` field; **`@types/node` ^22.16.5** (dev) |
| Replit-era branch (historical) | nodejs-20 — **not active** |

**Use Node.js 20+** for local dev, worker, and parity with Docker/Railway.

### Tools

Git, npm, Supabase CLI, optional Railway/Vercel CLI.

### Access (**requires manual confirmation** unless noted)

| System | Status |
|--------|--------|
| GitHub `epermitarthouse-rgb/Epermit-main` | **Client confirmed** |
| Railway workspace `PermitPilot` | **Client confirmed** |
| Vercel project | **Client confirmed** private account — dashboard not verified in audit |
| Supabase `eeqxyjrcldivtpikcpvk` | **Verified** ref in repo |
| Shared password vault | **Client confirmed** in use |

---

## 2. Branch strategy

| Branch | Role |
|--------|------|
| `main` | Production line for Railway scraper (**verified** deploy metadata) |
| `docs/diligence-readiness` | Diligence documentation (this package) |
| `fix/frontend-supabase-env-config` | Prepared Supabase env fix — **unmerged** |

### Protected / intentionally excluded

| Item | Policy |
|------|--------|
| `feat/code-analyzer-async-v2` | **Intentionally local-only** — do not push, merge, or deploy |
| Code Modification WIP | **Deliberately uncommitted** — do not commit as part of deploy prep |
| `replit-agent` | Historical — see [REPLIT_RETIREMENT_AUDIT.md](./REPLIT_RETIREMENT_AUDIT.md) |

---

## 3. Frontend (Vercel)

### Configuration (**verified**)

- `vercel.json`: `npm run build`, output `dist/`, SPA rewrite

### Requires manual confirmation

- Production branch (assumed `main` — **not verified**)
- Automated deploy on push (**not verified**)
- Production domain and preview URLs
- Account/team ownership (private account — client confirmed)

### Environment variables

| Variable | Required when |
|----------|---------------|
| `VITE_SUPABASE_URL` | **Required** after Supabase fix merge; currently hardcoded on `main` |
| `VITE_SUPABASE_ANON_KEY` | Same |
| `VITE_API_BASE_URL` | **Required** — must target `https://epermit-main-production.up.railway.app` |

**Before merging Supabase fix:** confirm both Supabase variables exist in Vercel production **and** preview.

---

## 4. Railway (scraper + worker)

### Scraper (**verified**)

- Service: `Epermit-main`
- Root: `/scraper-service`
- Builder: Dockerfile
- URL: `https://epermit-main-production.up.railway.app`

Deploy: typically GitHub push to `main` (**inferred** from Railway metadata — **requires manual confirmation** for hook settings).

### Worker

- Service: `document-ingestion-worker` (**verified** name via Railway CLI)
- Env: see [ENV.md](./ENV.md)

---

## 5. Supabase migrations (safe workflow)

**Do not instruct a cold operator to run unreviewed `supabase db push` against production.**

### Recommended workflow

1. **Inspect status:** `supabase link --project-ref eeqxyjrcldivtpikcpvk` then `supabase migration list` (or dashboard)
2. **Review pending SQL** in `supabase/migrations/` not yet applied
3. **Detect destructive statements** (DROP, TRUNCATE, column drops) — require explicit approval
4. **Dry-run / diff:** use Supabase CLI diff or staging project where available
5. **Backup first** — confirm PITR/backup available ([RESTORE.md](./RESTORE.md) — **requires manual confirmation**)
6. **Apply** to staging first when possible; then production with approval
7. **Verify schema** — spot-check tables, RLS, critical UCI/submission tables

**Production migration lag:** **Requires manual confirmation** — not verified by comparing live DB to repo during this audit.

---

## 6. Edge Functions

Deploy **only** functions whose source or secrets changed:

```bash
supabase functions deploy <function-name>
```

**Verified count:** 51 function directories. Set secrets via `supabase secrets set` — names in [ENV.md](./ENV.md).

---

## 7. Build commands (**verified** `package.json`)

| Component | Command |
|-----------|---------|
| Frontend | `npm ci && npm run build` |
| Frontend lint | `npm run lint` |
| Scraper tests | `cd scraper-service && npm test` |
| Worker | `cd document-ingestion-worker && npm start` |

### PWA / production build status

**Verified 2026-08-26:** `npm run build` **fails** at the service worker step (workbox/terser) after the Vite bundle completes.

Treat as a **failed complete production build** until fixed. **Do not assume** Vercel succeeds independently — **requires manual confirmation** via Vercel build logs.

---

## 8. Post-deployment smoke checks

| Check | Method | Pass criteria |
|-------|--------|---------------|
| Frontend loads | Open production URL | App shell renders |
| Auth | Login/logout | Session established |
| Supabase compatibility | Load projects list | No schema/client errors |
| Backend reachability | `GET /` on Railway URL | HTTP 200 |
| Scraper API | Authenticated UCI or QB status | Expected JSON (not 5xx) |
| Critical Edge Functions | e.g. team invitation, scheduled report dry run | 2xx or expected auth error |
| UCI live flags | Railway env dashboard | Live submission flags **not** enabled unless approved |
| QuickBooks | `/api/quickbooks/status` | JSON response (does not prove invoice success) |

---

## 9. Rollback (non-destructive)

| Layer | Action |
|-------|--------|
| Railway | Redeploy previous successful deployment in dashboard |
| Vercel | Promote prior deployment |
| Supabase schema | Forward-only — restore from backup if needed ([RESTORE.md](./RESTORE.md)) |
| Edge Functions | Redeploy from prior git tag |

---

## 10. Common failures

| Symptom | Likely cause |
|---------|--------------|
| API 404 from frontend | Wrong `VITE_API_BASE_URL` |
| Frontend blank after Supabase fix merge | Missing Vercel env vars |
| `npm run build` fails | PWA/workbox step — see backlog |
| Edge 500 | Missing Supabase secret |

---

## Related

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [ENV.md](./ENV.md)
- [RAILWAY_PRODUCTION_STATUS.md](./RAILWAY_PRODUCTION_STATUS.md)
