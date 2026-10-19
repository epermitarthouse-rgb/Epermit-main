# 06 — Historical decisions

**Extraction date:** 2026-10-19  
Each row separates the decision, why it was made, whether it still binds, and the evidence. “Still binds” means a future agent should follow it unless a human revokes it.

## Architecture

| Decision | Why | Still binds? | Evidence |
|----------|-----|--------------|----------|
| Supabase is the app backend. Express is only the scraper and integration API | Avoid a second CRUD server | Yes | `memory.md` §1, `README.md` |
| Schema is migration files only | Prevent ORM and dashboard drift | Yes, with the caveat that some live columns are already outside the files | `memory.md` §2; portal_data gap in [04](./04-DATABASE-AND-SUPABASE.md) |
| Vercel for the SPA, Railway for anything with Playwright or a long poll loop | Browser automation does not fit Vercel functions | Yes | `ARCHITECTURE.md`, Docker file, CLI |
| One Railway service (`Epermit-main`) runs scrapers, UCI HTTP, QuickBooks, Graph, and filing | Those features share Playwright sessions and the service-role client | Yes | `server.js`, route mounts |
| Code Analyzer sheet analysis stays on the scraper; the worker only orchestrates jobs | Reuse compliance code and Playwright-adjacent analysis | Yes | `code-analyzer-worker/lib/processSheetJob.js` calls `/api/analyze-drawing`; root `nixpacks.toml` imports `findingQuality.js` from the scraper tree |
| Document RAG worker is a separate process from the analyzer worker | Different tables (`document_ingestion_jobs` vs `code_analyzer_*`) | Yes | Both packages exist and both production services exist |
| `/__future` routes are a dev refactor mount, not production | Allow a split of `server.js` without deleting it | Yes | `parallel-dev-server.js`, `README.md` |
| Parallel dev ports 5001/3002 are the default `npm run dev` | Isolate a future router without removing classic 5000/3001 | Yes | `package.json` |
| Hardcode Supabase URL and anon key in `src/lib/supabase.ts` | Avoid Vercel build env mismatch | **Still the code on `main`.** A fix branch exists and is the preferred end state, but it is not merged. Do not switch the client to env vars in a drive-by edit | `src/lib/supabase.ts`; branch `fix/frontend-supabase-env-config` @ `2a5bf81`; `memory.md` §9 |
| Lovable and Replit are not runtimes | The product outgrew generated hosts | Yes | Retirement audits. Reference tree remains at `reference/lovable-ui/` |

## Scraper contracts

| Decision | Why | Still binds? | Evidence |
|----------|-----|--------------|----------|
| Detect PGC and Montgomery before generic ProjectDox | Their hosts also look like Avolve | Yes | `memory.md` §4 |
| PGC and Montgomery require saved credentials on the linked project | Prevent scrapes that cannot persist cleanly | Yes | Error codes in `memory.md` |
| Baltimore Accela requires Supabase `projectId` | Permit integrity | Yes | `memory.md` §4.4 |
| Do not delete `page._isBaltimore` branches as dead code | Baltimore UI needed longer waits and a wider link search | Yes until a new audit proves otherwise | `memory.md` §4.4 |
| Do not shorten portal waits without evidence | Verified slow pages | Yes | `IN_FLIGHT_STATUS.md` §3 |
| `portal_data` is an explicit contract, not schemaless UI | Viewers only render known keys | Yes | `memory.md` §5 |
| Hash portal JSON before write | Avoid blind overwrites | Yes | `hashPortalData` described in `memory.md` |
| Runtime downloads, screenshots, and PGC logs are gitignored | They are large and sensitive | Yes | `README.md`, `.gitignore` |
| Arlington reuses the Accela scraper with tenant `ARLINGTONCO` | Avoid a second Accela implementation | Yes. The prompt file is a runbook, not an open ticket | `arlington_accela_implementation_prompts.md` |

## Product splits

| Decision | Why | Still binds? | Evidence |
|----------|-----|--------------|----------|
| DesignCheck is a summary surface. Code Analyzer is the engine | Lovable DesignCheck screens were mostly mock | Yes | `docs/audits/designcheck-vs-ai-compliance-new-ui-audit.md`, `designcheck-separate-feature-plan.md` |
| New analyzer runs are V2 only. No silent V1 fallback | Stop mixed result quality | Yes | `src/lib/codeAnalyzer/featureFlags.ts` |
| A Code Analyzer “pass” requires evidence on the sheet | False passes on non-drawing or weak-evidence sheets | Yes. This is the `fc74c35` commit | Git log |
| Operations board ships mixed live and demo data until new tables exist | A full PM board could not be backed by current schema | Yes | `docs/audits/operations-board-feasibility-audit.md`, `operations-board-future-schema.md` |
| Admin dashboard v2 is governance (users, grants, audit), not an 18-module clone of every operator screen | Scope control | Yes as the target. A large part of the schema and UI is already on `main` | `docs/admin-dashboard/README.md`, migration `20260910120000_admin_governance_foundation.sql` |
| Admin enforcement moves legacy → shadow → enforce | Avoid locking users out on day one | Yes. Current production mode **UNKNOWN** | `docs/admin-dashboard/IMPLEMENTATION.md` |
| UCI is not client-live until a real-document pilot | Synthetic PDFs and dry-run checks passed; live submit did not | Yes until a human says otherwise | `ARCHITECTURE.md` §5, `IN_FLIGHT_STATUS.md` §2, `uci/README.md` |
| UCI planning order is client spec, then `uci/UCI_DELIVERY_ROADMAP.md`, then architecture, then the compliance checklist | Stop prompt-driven planning | Yes | `uci/README.md` |
| Point 7 grounded answers use pgvector in Postgres, parallel to legacy `generate-response` | Citations instead of unconstrained drafts | The pipeline exists. Do not delete `generate-response` until callers are confirmed gone | `point-7-grounded-ai-implementation.md` (**HISTORICAL** spec), function and worker on `main` |

## Hosting and access

| Decision | Why | Still binds? | Evidence |
|----------|-----|--------------|----------|
| GitHub identity for this repo is `epermitarthouse-rgb` only | Personal accounts are not collaborators | Yes | `.cursor/rules/epermitarthouse-github.mdc` |
| Push to `main` is not complete until Railway is considered | Production is CLI-deployed as well as possibly GitHub-connected | Yes, but only when the user asked to push or deploy. Lovable branch is the exception | `deploy-github-railway.mdc` |
| Lovable visual work stays on `feat/lovable-ui-replication` and Railway **development** | Prevent mock UI and prod deploys | Yes for that class of work | `lovable-ui-development-workflow.mdc` |
| QuickBooks OAuth and invoice routes were hardened (backlog items 1–2 closed in the August note) | Public invoice triggers were unsafe | Yes. Re-check auth before widening the status payload | `TECHNICAL_REMEDIATION_BACKLOG.md` |
| Unauthenticated QuickBooks status may return only `{ connected: true/false }` | Reduce reconnaissance while keeping a probe | **INFERRED** still true from a route read in the history pass (`quickbooks.routes.js`). Re-read before changing | History-agent report during this extraction |
| Shared production Supabase for Railway development | No second Supabase project was provisioned | Treat as true until disproven. High blast radius | Lovable rule |

## Decisions that are no longer true

| Old statement | What changed | Evidence |
|---------------|--------------|----------|
| `feat/code-analyzer-async-v2` is local-only and not on the remote (ARCHITECTURE.md §6, 2026-08-27) | The branch is on `origin`. The worker is on `main`. Production Railway service was online 2026-10-19 | `git branch -vv`; `railway status` |
| Code Analyzer async v2 “local branch only, not on remote” in the feature matrix | Same | Matrix is pinned to `331fa80` |
| `docs/admin-dashboard/IMPLEMENTATION.md` describing the governance work as uncommitted on 2026-09-10 | Migrations and `src/pages/admin/*` are on `main` | Git tree at `fc74c35` |
| July 2026 note that feature flags are localStorage only | Server RPC `get_feature_flags` exists | `src/lib/featureFlags.ts`, migration `20260918200000_feature_flags_platform_control.sql` |
| All 51 Edge Functions have `verify_jwt = false` in config | 36 are listed. 15 have no block | `supabase/config.toml` vs function directories |
| Production Railway is at `331fa80` (RAILWAY_PRODUCTION_STATUS.md) | Scraper and analyzer deploys on 2026-10-19 carry the message `fc74c35` | Railway CLI |

## Discarded or parked approaches

- **Replit** as a host. Audit says no production dependency. Branch `replit-agent` @ `d867472` is archival.
- **Replacing PermitPilot components with Lovable mocks** to match screenshots. Repeatedly rejected in audits and in the Lovable cursor rule.
- **Building the full operations board on current tables.** Feasibility audit says it needs new schema. Demo data remains on purpose.
- **A separate Accela scraper for Arlington.** Rejected in favor of tenant branching inside `accela-scraper.js`.
- **Silent fallback from Code Analyzer V2 to the old in-browser analysis.** Explicitly removed.

## Lessons that showed up in code, not just docs

- Portal DOM changes are the normal production incident. Fixes belong in the jurisdiction module, with the existing waits left intact unless a trace shows the wait itself is wrong.
- Analyzer quality incidents in October 2026 were about evidence and page classification (drawing vs non-drawing, page size), not about missing routes. The `fc74c35` commit is the latest of that line.
- Deploying the analyzer worker without the scraper compliance routes, or with `SCRAPER_SERVICE_URL` pointed at the wrong port, produces jobs that claim successfully and then fail HTTP. The worker default port in code does not match the scraper’s default port (see [02](./02-SYSTEM-ARCHITECTURE.md)).
- Two Nixpacks files can deploy two different programs. Read the service root before `railway up`.
