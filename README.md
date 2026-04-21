# Epermit (PermitPilot / DesignCheck)

Permit intelligence platform: project and jurisdiction tracking, **multi-portal scraping**, portal data viewing, AI-assisted comment workflows, inspections, and related tooling. The web app talks to **Supabase** (database, auth, storage, edge functions). A separate **Node/Express + Playwright** service performs browser automation and writes **`projects.portal_data`** in Postgres.

## Architecture

| Layer | Stack | Location |
|--------|--------|----------|
| Frontend | Vite 5, React 18, TypeScript, Tailwind, shadcn/ui | `src/` |
| Backend | Supabase (Postgres, RLS, Auth, Storage, Edge Functions) | `supabase/` |
| Scraper | Express, Playwright (Chromium) | `scraper-service/` |

- **Default dev stack (parallel):** frontend **5001** (`vite.config.parallel.ts`); scraper **3002** (`scraper-service/parallel-dev-server.js`, `PARALLEL_PORT` overrides). Vite proxies **`/api`** and **`/view-file`** to `http://127.0.0.1:3002`. Playwright and **`/api/*`** execution still live in **`scraper-service/server.js`** (the parallel process mounts the same Express `app` plus `/__future/*`). This is a **dev-stack default only**, not a migration off `server.js`.
- **Classic dev stack (rollback):** frontend **5000** (`vite.config.ts`); scraper **3001** (`node server.js` only, `PORT` overrides). Proxy target **`127.0.0.1:3001`**.

## Repository layout

- `src/` — React app, routes in `App.tsx`, portal viewers under `components/portal/` and `components/baltimore/`.
- `scraper-service/` — `server.js` (HTTP API, session store, orchestration), `accela-scraper.js`, `pgc-eplan-scraper.js`, Montgomery/Howard under `scrapers/montgomery/` and `scrapers/howard/`, and related modules.
- `supabase/migrations/` — schema (source of truth).
- `supabase/functions/` — Deno edge functions (AI, email, Stripe, etc.).
- `public/` — static assets and PWA icons.
- `memory.md` — **Engineering handbook** (scraper behavior, contracts, operations). Read this before changing scrapers.

## Prerequisites

- Node.js 18+ and npm.
- Playwright browsers (scraper will attempt install on failure; see scraper logs).

## Run locally

```bash
npm install
cd scraper-service && npm install && cd ..
```

**Default — parallel dev stack** (frontend :5001 → proxy → backend :3002):

```bash
npm run dev
```

Set **`VITE_API_BASE_URL=http://localhost:5001`** so the app uses the local Vite proxy (recommended). If unset, the frontend may default to the production scraper URL (see `src/contexts/ScrapeContext.tsx`).

**Rollback — classic dev stack** (frontend :5000 → proxy → `server.js` :3001):

```bash
npm run dev:classic
```

Use **`VITE_API_BASE_URL=http://localhost:5000`** with the classic stack.

**Explicit alias** (same as `npm run dev`): `npm run dev:parallel`.

Only the **default npm script** changed: classic behavior is unchanged and available via **`dev:classic`**. No `server.js` removal and no deletion of legacy workflow files.

**Individually:**

```bash
npm run dev:frontend           # Vite on :5000 (classic config)
npm run dev:frontend:parallel # Vite on :5001 (parallel config)
npm run dev:scraper           # server.js on :3001; logs tee to scraper-service/latest-run.log
npm run dev:scraper:parallel  # parallel-dev-server.js on :3002 (same server.js app + /__future)
```

Configure environment:

- **Scraper:** `scraper-service/.env` — at minimum `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (see any `.env.example` in that folder).
- **Frontend:** use project conventions for Supabase (`src/lib/supabase.ts`).

## Scrapers / jurisdictions (summary)

| Area | Portal stack | Notes |
|------|----------------|------|
| **Washington, DC** | Avolve ProjectDox | Default login URL `washington-dc-us.avolvecloud.com` if none provided. |
| **Prince George’s County** | PGC ePlans / Avolve (`pgc-eplan`) | Requires saved portal credentials on linked project; heavy pipeline in `pgc-eplan-scraper.js`. |
| **Montgomery County, MD** | Avolve ProjectDox subtype | `scraper-service/scrapers/montgomery/projectdox-scraper.js`; SSRS report specs must match live grid labels. |
| **Accela (e.g. Baltimore)** | Citizen Access | Baltimore requires **`projectId`** on scrape for DB integrity; extended waits in `accela-scraper.js`. |

Detailed login flows, error codes (`pgc_saved_portal_credentials_missing`, `montgomery_saved_portal_credentials_missing`), and **`portal_data` shape** are documented in **`memory.md`**.

## Runtime artifacts (do not commit)

The scraper writes **local-only** files (gitignored where possible):

- `scraper-service/downloads/` — downloaded files; exposed as **`/view-file`**.
- `scraper-service/debug/` — Accela checkpoint screenshots.
- `scraper-service/pgc-downloads/`, `pgc-reports/`, `pgc-markups/` — PGC/Montgomery caches.
- `scraper-service/pgc-progress-events.jsonl`, `pgc-run-summary.json`, `pgc-debug-detail.log` — PGC progress telemetry.
- `scraper-service/latest-run.log` — dev script output.
- Various `*-failed-*.png` / `debug_dashboard.png` — debugging.

**Do not delete** these blindly while a scrape is running. See `.gitignore` for the canonical list.

## Supabase CLI

Project ref is in `supabase/config.toml`. Link and deploy functions with the [Supabase CLI](https://supabase.com/docs/guides/cli). Example agent deploys and secrets are summarized in **`memory.md`** (Operations).

## License / product naming

Branding may appear as Insight|DesignCheck, PermitPilot, or Epermit in code and config; treat as the same product family unless split intentionally.
