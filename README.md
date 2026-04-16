# Epermit (PermitPilot / DesignCheck)

Permit intelligence platform: project and jurisdiction tracking, **multi-portal scraping**, portal data viewing, AI-assisted comment workflows, inspections, and related tooling. The web app talks to **Supabase** (database, auth, storage, edge functions). A separate **Node/Express + Playwright** service performs browser automation and writes **`projects.portal_data`** in Postgres.

## Architecture

| Layer | Stack | Location |
|--------|--------|----------|
| Frontend | Vite 5, React 18, TypeScript, Tailwind, shadcn/ui | `src/` |
| Backend | Supabase (Postgres, RLS, Auth, Storage, Edge Functions) | `supabase/` |
| Scraper | Express, Playwright (Chromium) | `scraper-service/` |

- **Dev frontend:** port **5000** (`vite.config.ts`).
- **Dev scraper:** port **3001** (`scraper-service/server.js`, `PORT` env overrides).
- **Proxy:** Vite proxies **`/api`** and **`/view-file`** to `http://127.0.0.1:3001`.

## Repository layout

- `src/` — React app, routes in `App.tsx`, portal viewers under `components/portal/` and `components/baltimore/`.
- `scraper-service/` — `server.js` (HTTP API, session store, orchestration), `accela-scraper.js`, `pgc-eplan-scraper.js`, `montgomery-projectdox-scraper.js`, and related auth/filer modules.
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

**Frontend + scraper together:**

```bash
npm run dev
```

**Individually:**

```bash
npm run dev:frontend   # Vite on :5000
npm run dev:scraper    # Express on :3001; logs also tee to scraper-service/latest-run.log
```

Configure environment:

- **Scraper:** `scraper-service/.env` — at minimum `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (see any `.env.example` in that folder).
- **Frontend:** use project conventions for Supabase (`src/lib/supabase.ts`).

## Scrapers / jurisdictions (summary)

| Area | Portal stack | Notes |
|------|----------------|------|
| **Washington, DC** | Avolve ProjectDox | Default login URL `washington-dc-us.avolvecloud.com` if none provided. |
| **Prince George’s County** | PGC ePlans / Avolve (`pgc-eplan`) | Requires saved portal credentials on linked project; heavy pipeline in `pgc-eplan-scraper.js`. |
| **Montgomery County, MD** | Avolve ProjectDox subtype | `montgomery-projectdox-scraper.js`; SSRS report specs must match live grid labels. |
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
