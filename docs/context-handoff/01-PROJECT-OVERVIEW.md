# 01 — Project overview

**Extraction date:** 2026-10-19  
**Code examined:** `epermitarthouse-rgb/Epermit-main`, branch `main`, commit `fc74c35bd3dd0818790d825cc694b069c7d4eaca` (2026-10-17, “Require evidence on the sheet before a Code Analyzer pass.”). Working tree was clean and matched `origin/main`.  
**Evidence labels:** **VERIFIED** (inspected code, git, or a read-only Railway CLI call in this extraction), **HISTORICAL** (older doc or conversation), **INFERRED**, **UNKNOWN**.

This file is product context. Architecture is in [02-SYSTEM-ARCHITECTURE.md](./02-SYSTEM-ARCHITECTURE.md). Feature status is in [03-FEATURE-INVENTORY.md](./03-FEATURE-INVENTORY.md).

## Identity

| Item | Value | Label |
|------|--------|--------|
| Product family | Epermit, PermitPilot, DesignCheck, and older copy that still says Insight or PermitPulse | **VERIFIED** in `README.md` and `memory.md` |
| Official repository | `https://github.com/epermitarthouse-rgb/Epermit-main` | **VERIFIED** `git remote -v` |
| Official branch for this handoff | `main` | **VERIFIED** |
| Supabase project ref | `eeqxyjrcldivtpikcpvk` | **VERIFIED** `supabase/config.toml` |
| Railway project | PermitPilot, id `41f0067a-ffb7-4b15-99e0-25ed8555438f` | **VERIFIED** `railway status` on 2026-10-19 |
| Excluded repository | `https://github.com/D71404/Epermit` | Not read. Do not merge it into this context. |

The local checkout lives at `Epermit-main/` inside the Cursor workspace `/Users/javerianaveed/epermit`. Sibling folders in that workspace (`Epermit-main-graph-egress-release`, `mcdonals demo package`, loose PDFs, `uci-aspinhill docs`) are **not** the official source tree. Treat them as local artifacts unless a later task explicitly scopes them.

## What it is

**VERIFIED** (`README.md`, `memory.md` §1, `docs/diligence-readiness/ARCHITECTURE.md`):

Epermit is a permit-intelligence web application for architects, contractors, and owners. It tracks projects and jurisdictions, logs into municipal permit portals with a browser, stores the extracted record as JSON, and then supports comment review, AI drafting, inspections, checklists, and billing around that record.

A second product line, Utility Coordination Intelligence (UCI), coordinates utility work (providers, stages, documents, mailbox, invoicing). UCI is implemented as routes and pages, and diligence documents still classify it as a prototype that is not ready for live client submissions. That classification is **HISTORICAL** (2026-08-27) and was not re-proven against a live utility portal in this extraction.

## Why it exists

**INFERRED** from product surface and `docs/strategy/microsoft-permitting-vs-permitpilot-report.md`, not from a single signed product brief:

Municipal permit data is locked inside vendor portals (Accela Citizen Access, Avolve ProjectDox / ePlans). Teams lose time re-keying comments, files, inspections, and status. Epermit’s scraper copies that portal state into Postgres so the rest of the product (viewers, comment AI, filing, inspections, billing) can work from one project record.

DesignCheck / Code Analyzer is a separate job: review uploaded drawings against code and produce findings. It is not a replacement for portal scraping. The 2026-08-05 audit `docs/audits/designcheck-vs-ai-compliance-new-ui-audit.md` says the PermitPilot Code Analyzer remains the functional source and the Lovable DesignCheck screens were mostly visual reference.

## Users

| User | What they do in the product | Evidence |
|------|-----------------------------|----------|
| Architect / designer | Projects, drawing upload, comment letters, response matrix, DesignCheck | Routes in `src/App.tsx` |
| Contractor / permit coordinator | Portal harvest, filing wizard, inspections, checklists | Same |
| Project owner / client | Read-only share link | `/portal/:token` → `ClientPortal` |
| Platform admin | Users, audit, jurisdictions, notifications, feature flags | `/admin/*`, `useRequireAdmin` |
| UCI operator | Utility coordination workspace | `/uci/*` |
| Marketing visitor | Pricing, FAQ, contact, demos | Public routes |

Team members join through hashed invitation tokens (`create_project_team_invitation` / `accept_project_team_invitation` in `supabase/migrations/20260715130000_project_team_invitation_flow.sql`).

## Major workflows

1. **Account and project.** Supabase Auth creates `profiles` via `handle_new_user`. The user creates a `projects` row, optionally invites a team, and stores portal credentials.
2. **Portal harvest.** The browser calls the Railway scraper (`POST /api/login`, `POST /api/scrape`). Playwright signs into the jurisdiction portal and writes `projects.portal_data` (and related scrape job tables). The UI polls session and job progress (`ScrapeContext`).
3. **Comment intelligence.** Report PDFs already sitting in portal data, or uploaded letters, go through Edge Functions (`intake-pipeline-agent`, `comment-parser-agent`, `discipline-classifier-agent`) into `parsed_comments`. Reviewers work in Comment Review, Classified Comments, and Response Matrix. Grounded drafts use `generate-grounded-response` and `project_document_chunks`.
4. **Code Analyzer.** Drawings upload into the analyzer document workflow. New analysis requires the frontend build flag `VITE_CODE_ANALYZER_ASYNC_V2=true` (`src/lib/codeAnalyzer/featureFlags.ts`). There is no V1 fallback. A Railway worker claims ingestion, sheet, and code-modification jobs and calls scraper compliance routes.
5. **Permit filing.** Permit Wizard preflight and execute (`permitwizard-preflight`, `permitwizard-execute`) drive Playwright filing flows on the scraper.
6. **Field work.** Inspections, punch lists, and checklist reports, with email reminders and a 15-minute checklist cron defined in SQL.
7. **Billing.** Stripe subscription checkout is an Edge Function path. QuickBooks milestone invoices are a Railway path (`/api/quickbooks/*`).
8. **UCI.** Operator pages call `/api/uci/*` on the scraper. Live PEPCO submission and live Microsoft Graph sending are env-gated and default off in examples (`ARCHITECTURE.md` §5, **HISTORICAL** on the live flag values).

## Product constraints that must be preserved

These are operating rules, not suggestions.

- **Baltimore Accela scrapes require a Supabase `projectId`.** The server rejects the call otherwise so permit rows are not written to the wrong project (`memory.md` §4.4). **VERIFIED** as documented contract; the guard itself lives in scraper code and was not re-executed.
- **Prince George’s and Montgomery scrapes require saved portal credentials on the linked project.** Error codes: `pgc_saved_portal_credentials_missing`, `montgomery_saved_portal_credentials_missing` (`memory.md` §4.2–4.3).
- **Do not shorten portal wait times** without new evidence that the live portal is faster (`docs/diligence-readiness/IN_FLIGHT_STATUS.md` §3). **HISTORICAL** guidance, still the safe default.
- **Lovable UI is a visual reference.** Do not replace working controls with static mocks. Functional source of truth is this repository’s current behavior (`.cursor/rules/lovable-ui-development-workflow.mdc`).
- **Railway `development` is documented as sharing the production Supabase project.** Use demo accounts. Do not run destructive jobs or live utility submissions from that environment (same rule file). **HISTORICAL** warning; env values were not printed or compared in this extraction.
- **Schema changes go through `supabase/migrations/` only.** Several September 2026 migrations contain “DO NOT apply until reviewed” headers. See [04-DATABASE-AND-SUPABASE.md](./04-DATABASE-AND-SUPABASE.md).
- **Anonymous Supabase key in the browser is expected. Service-role key in the frontend is not.** `ARCHITECTURE.md` states no service-role key was found under `src/`. The URL and anon key are still hardcoded in `src/lib/supabase.ts` (**VERIFIED** file exists; values not copied here).

## Scope boundaries

In scope for a future agent working this repo:

- `src/`, `supabase/`, `scraper-service/`, `code-analyzer-worker/`, `document-ingestion-worker/`, `scripts/`, `uci/` (documentation), `docs/`, `reference/lovable-ui/` (frozen visual reference, not a runtime dependency).

Out of scope unless a human explicitly expands the task:

- The `D71404/Epermit` GitHub repository.
- Replit. Retirement audit says there is no production dependency (`docs/diligence-readiness/REPLIT_RETIREMENT_AUDIT.md`). A local branch `replit-agent` still exists at `d867472`.
- Capacitor `server.url` still points at a Lovable host (`capacitor.config.ts`). Treat mobile packaging as legacy, not the production web path.

## How to read older documents

`docs/diligence-readiness/` is the investor/engineer handover bundle, last updated **2026-08-27** against commit `331fa80`. It is still the best map of accounts, env var **names**, and recovery procedure. It is **not** the current feature-status authority. `main` has since absorbed Code Analyzer async v2, admin governance, platform feature flags, and jurisdiction CSV work. When a diligence sentence conflicts with `main` at `fc74c35`, prefer the code and record the doc as **HISTORICAL**.
