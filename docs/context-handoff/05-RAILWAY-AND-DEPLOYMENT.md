# 05 — Railway and deployment

**Extraction date:** 2026-10-19  
**Method:** repo config plus read-only Railway CLI (`railway status`, `railway environment list`, `railway deployment list --limit 1`). No deploy, no env var dump, no restart.

Older narrative: `docs/diligence-readiness/DEPLOY.md`, `RAILWAY_PRODUCTION_STATUS.md`, `ENV.md`, all dated 2026-08-27 and pinned to commit `331fa80`. Use those for procedure checklists. Use this file for what was online on 2026-10-19.

## Verified project

| Field | Value | Label |
|-------|--------|--------|
| Workspace / project name | PermitPilot | **VERIFIED** CLI |
| Project ID | `41f0067a-ffb7-4b15-99e0-25ed8555438f` | **VERIFIED** CLI. Matches the identifier supplied for this extraction. Not stored in git |
| GitHub repo linked on the scraper service | `epermitarthouse-rgb/Epermit-main` | **VERIFIED** CLI |
| Production environment ID | `3138e7b7-9d99-4804-8d25-9dd851d2d333` | **VERIFIED** CLI |
| Development environment ID | `cd024ef1-a6b5-4a7b-a4fb-a1c353d682cf` | **VERIFIED** CLI |
| Region (scraper) | US East | **VERIFIED** CLI |

`railway environment list` printed “updated 6 months ago” on production and “updated 2 months ago” on development. That is environment-object metadata, not the last deploy time. Ignore it when judging release currency.

## Services

### Production (all three online)

| Service | Status on 2026-10-19 | URL | Latest deployment inspected | Created | CLI message |
|---------|----------------------|-----|-----------------------------|---------|-------------|
| `Epermit-main` | Online | `https://epermit-main-production.up.railway.app` | `0145566f-b2ac-4f59-9160-9025f99ea410` SUCCESS | 2026-10-19T10:29:05Z | `fc74c35 evidence-backed analyzer pass` |
| `code-analyzer-worker` | Online | none shown | `d73f9360-7499-450a-9740-3598432f24fa` SUCCESS | 2026-10-19T10:25:50Z | `fc74c35 evidence-backed analyzer pass` |
| `document-ingestion-worker` | Online | none shown | `1e6d210a-74ac-4414-8d15-6e541aeea4f4` SUCCESS | **2026-08-04**T22:34:59Z | no commit message in the limit-1 payload |

Service ID for `Epermit-main` (same service across environments): `dd78d23a-339c-40d4-84ab-9beb570f4315`.

The CLI message names `fc74c35`, which is `main` HEAD. The deployment payload did not include a git SHA field in the keys this extraction printed. Treat “deployed from `fc74c35`” as **VERIFIED** only as the operator message on that deployment, not as a signed commit attestation.

`document-ingestion-worker` production is **about ten weeks behind** the scraper and analyzer deploys. Code on `main` after 2026-08-04 is not necessarily running there. Confirm the service root and start command before assuming `worker.js` on `main` is live.

### Development

| Service | Status on 2026-10-19 | Notes |
|---------|----------------------|--------|
| `Epermit-main` | Online | `https://epermit-main-development.up.railway.app`. Latest SUCCESS deploy **2026-08-21** (`f72638d3-b8ce-4699-bbd1-fdca9c65fd41`). No CLI commit message in the payload |
| `document-ingestion-worker` | **Offline** | No deployment returned for `--environment development` |
| `code-analyzer-worker` | **Not listed** in `railway status --environment development` | No deployment returned |

Development scraper is stale relative to `main`. It is not a safe place to test Code Analyzer V2 unless someone deploys the worker and a current scraper there on purpose.

Cursor rule `.cursor/rules/lovable-ui-development-workflow.mdc` says Railway development shares production Supabase (`SUPABASE_URL` / service role duplicated). **HISTORICAL** warning. Env values were not compared in this extraction. Behave as if it is true until a human shows otherwise: demo data only, no destructive SQL, no live utility submission.

## What each service builds

| Service | Expected build | Config | Start |
|---------|----------------|--------|-------|
| `Epermit-main` | Docker image from `scraper-service/` | `scraper-service/railway.toml` builder `dockerfile`, `Dockerfile` | `node server.js`, port 3001 inside the image (`PORT` overrides) |
| `code-analyzer-worker` | Nixpacks at **repository root** | Root `nixpacks.toml` | `LD_LIBRARY_PATH=/app/native-libs node code-analyzer-worker/worker.js` |
| `document-ingestion-worker` | Not declared by a `railway.toml` in the worker folder | **UNKNOWN** service root in Railway settings. Diligence says the worker directory and `npm start` | `node worker.js` (`document-ingestion-worker/package.json`) |

Do not point the scraper service at the root `nixpacks.toml`. That file skips the frontend build and starts the analyzer worker. Do not point the analyzer service at `scraper-service/Dockerfile`. It would boot Playwright instead of the poll loop.

Root `package.json` `build` is the **Vercel** frontend (`vite build`). It is not the Railway scraper build.

`code-analyzer-worker/nixpacks.toml` is a second, directory-local recipe (`node worker.js` only). The root file exists specifically because sheet processing imports `scraper-service/.../findingQuality.js`. If someone sets the Railway root to `code-analyzer-worker/`, that import breaks unless the Docker/Nixpacks context still contains `scraper-service/`.

## Frontend hosting

`vercel.json`: `npm run build`, output `dist/`, SPA fallback to `index.html`.

Documented production URL: `https://epermit-main-nine.vercel.app` (**HISTORICAL**, diligence). Not re-fetched on 2026-10-19 (**UNKNOWN** whether that deployment is `fc74c35`).

Browser → scraper: `src/lib/scraperBaseUrl.ts` defaults to the production Railway URL. Vercel `VITE_API_BASE_URL` can override it. `VITE_CODE_ANALYZER_ASYNC_V2` must be `true` in the **frontend build** or new analyzer runs throw before creating jobs (`src/lib/codeAnalyzer/featureFlags.ts`). Whether the current Vercel build has that flag was **not** read.

## GitHub automation

`.github/workflows/uci-security-tests.yml` runs on pull requests and pushes to `main`: Node 20, `scraper-service` `npm run test:uci:security`, and one frontend invitation test. It does not build the frontend, run the analyzer worker tests, or deploy.

`.cursor/rules/deploy-github-railway.mdc` says Railway may also auto-deploy from GitHub on `main`, and still tells agents to run `railway up` when the user asks to push. The Lovable rule says the opposite for that feature branch: CLI deploy to **development** only, and do not connect Railway to GitHub for that workflow. See [07-CURSOR-RULES-AND-MEMORIES.md](./07-CURSOR-RULES-AND-MEMORIES.md).

## Deploy rules for agents

Only when a human explicitly asks to deploy.

Production scraper (from repo root, after confirming `railway status` shows project PermitPilot and environment production):

```bash
railway up -d -y -s Epermit-main --environment production
```

The checked-in rule omits `--environment production` and relies on the linked environment. The linked environment on this machine was **production** during the 2026-10-19 `railway status` call. Pass `--environment` anyway so a linked development environment cannot receive a production push by accident.

Analyzer worker, only with explicit approval, from the repo root so the root `nixpacks.toml` applies:

```bash
railway up -d -y -s code-analyzer-worker --environment production
```

Ingestion worker is the stale one. Do not redeploy it as a side effect of an analyzer task.

Lovable UI branch:

```bash
git branch --show-current   # must be feat/lovable-ui-replication
railway up --environment development --service Epermit-main -d -y
```

Never `railway down`. Never change Railway variables unless the task is specifically an env change and the human approved the values. Never print variable values into chat or into this folder.

## Health and rollback

August 2026 check: `GET /` on the production scraper returned 200; `GET /health` returned 404; `GET /api/quickbooks/status` returned 200 (`RAILWAY_PRODUCTION_STATUS.md`). Not repeated on 2026-10-19.

Rollback procedure in `docs/diligence-readiness/DEPLOY.md` is non-destructive (redeploy a previous Railway deployment, revert a Vercel deployment). Read it before rolling back. Do not invent a database down migration as a rollback.

## Local versus deployed

| Behavior | Local `npm run dev` | Production |
|----------|---------------------|------------|
| Frontend | `:5001` | Vercel |
| Scraper | `:3002` including `/__future` | Docker `server.js` only |
| Ingestion worker | Started | Railway, image from 2026-08-04 |
| Analyzer worker | Not started | Railway, deploy message `fc74c35` |
| Supabase | Same cloud project if `.env` points at `eeqxyjrcldivtpikcpvk` | Same project ref |
| Secrets | `scraper-service/.env`, worker `.env`, ignored by git | Railway and Supabase secrets |

`README.md` says Node 18+. Diligence and the Docker/Nixpacks files use Node 20. Use Node 20 for workers and scraper images.

## Account and identity

Git operations for this repo use GitHub user `epermitarthouse-rgb` only (`.cursor/rules/epermitarthouse-github.mdc`). Remote: `git@github.com:epermitarthouse-rgb/Epermit-main.git`. A second remote `gitsafe-backup` (`git://gitsafe:5418/backup.git`) exists on this machine. Do not push there unless a human asks.

There is no checked-in Railway token. CLI auth is local to the developer machine.
