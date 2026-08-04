# Lovable UI — isolated development environment

Operational guide for the Lovable visual-alignment frontend project. Does **not** replace `docs/lovable-ui-frontend-implementation-plan.md`.

## Topology

| Layer | Production | Lovable UI isolation |
|-------|------------|----------------------|
| GitHub | `main` | `feat/lovable-ui-replication` |
| Vercel frontend | Production from `main` | Preview from `feat/lovable-ui-replication` |
| Railway backend/scraper | Environment `production` | Environment `development` |

Railway is **CLI-only** for this workflow (do not rely on GitHub auto-deploy for Lovable work).

## Git

- Feature branch: `feat/lovable-ui-replication`
- All Lovable UI commits stay on this branch.
- Do not merge to `main` without explicit approval.

## Vercel

- Linked project (local `.vercel`): `epermit-frontend` (`prj_X8BvtDxQxRTsbmqzzjmGSTv04J7t`)
- Observed production frontend host (from Railway QB redirect vars): `epermit-main-nine.vercel.app`
- Production branch must remain `main`.
- Feature branch gets Preview deployments when the Git integration is enabled.

### Frontend → backend URL variable

Exact frontend env var (from `src/lib/scraperBaseUrl.ts`):

- **`VITE_API_BASE_URL`** — scraper/backend base URL consumed by the Vite app.

Related (not the Railway URL mapping for Preview):

- `VITE_SCRAPER_USE_SAME_ORIGIN` — local parallel-dev same-origin proxy only
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase client

### Required mapping

| Vercel target | Branch | `VITE_API_BASE_URL` |
|---------------|--------|---------------------|
| Production | `main` | Railway production: `https://epermit-main-production.up.railway.app` |
| Preview (branch) | `feat/lovable-ui-replication` | Railway development: `https://epermit-main-development.up.railway.app` |

Configure the Preview value as a **branch-specific** Preview env var for `feat/lovable-ui-replication` only. Do not change Production.

Manual path (when CLI auth is unavailable):

1. Vercel → project `epermit-frontend` → Settings → Environment Variables
2. Edit or add `VITE_API_BASE_URL`
3. Environment: **Preview**
4. Git Branch: **`feat/lovable-ui-replication`**
5. Value: `https://epermit-main-development.up.railway.app`
6. Redeploy the Preview deployment after saving

## Railway

| Item | Value |
|------|-------|
| Workspace / project | PermitPilot |
| Project ID | `41f0067a-ffb7-4b15-99e0-25ed8555438f` |
| Production environment | `production` |
| Development environment | `development` |
| Application service | `Epermit-main` |
| Worker service | `document-ingestion-worker` |
| App root directory | `/scraper-service` |
| Worker root directory | `document-ingestion-worker` |
| Production URL | `https://epermit-main-production.up.railway.app` |
| Development URL | `https://epermit-main-development.up.railway.app` |
| Build | Dockerfile via `scraper-service/railway.toml` (`dockerfile` builder) |

### Safe Railway deploy (development only)

```bash
git branch --show-current   # must be feat/lovable-ui-replication for Lovable work
git status
railway environment list
railway status
railway up --environment development --service Epermit-main -d -y
```

Never use an ambiguous bare `railway up` for this work. Never deploy Lovable work to `--environment production` unless explicitly instructed.

### Diagnostic check

Production root `GET /` returns the scraper HTML shell. Prefer that as a safe reachability check if `/health` is not mounted on `server.js`. After a development deploy is online:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://epermit-main-development.up.railway.app/
```

## Shared database warning

Duplicating `production` → `development` copied service variable **names and values**, including:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

**Development is not an isolated database.** It points at the same Supabase project as production.

Also duplicated (identical at create time): OpenAI, QuickBooks, portal credential encryption, UCI territory storage settings, etc.

Development-only adjustments already made (names only):

- `MS_GRAPH_REDIRECT_URI` → development Railway host callback
- `QB_REDIRECT_URI` → development Railway host callback

`QB_SUCCESS_REDIRECT_URL` / `QB_FAILURE_REDIRECT_URL` still reference the production Vercel host unless changed deliberately.

Rules of engagement:

- Demo accounts only
- No destructive data ops
- No live utility portal submissions without approval

## Preview process

1. Commit on `feat/lovable-ui-replication`
2. `git push -u origin feat/lovable-ui-replication` (or push current feature branch)
3. Confirm Vercel Preview build for the branch
4. Confirm Preview `VITE_API_BASE_URL` → Railway development URL
5. If scraper/backend changed: `railway up --environment development --service Epermit-main -d -y`
6. Smoke-test Preview against development backend

## Production promotion

1. Explicit human approval to merge
2. PR: `feat/lovable-ui-replication` → `main`
3. Merge only after Preview sign-off
4. Vercel Production deploys from `main` (unchanged Production env vars)
5. Railway production deploy only if backend changes were approved — explicit `--environment production --service Epermit-main`
6. Confirm production frontend still uses production Railway URL

## Rollback

- Frontend: revert/redeploy previous Vercel Production deployment from `main`, or revert the merge commit on `main`
- Feature Preview: fix forward on `feat/lovable-ui-replication` or disable the Preview deployment
- Railway development: redeploy prior development deployment or stop experimenting; leave production untouched
- Do not “fix” development variables into production

## Cursor rule

Permanent agent instructions: `.cursor/rules/lovable-ui-development-workflow.mdc`
