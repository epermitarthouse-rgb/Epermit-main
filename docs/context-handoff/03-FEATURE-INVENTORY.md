# 03 — Feature inventory

**Extraction date:** 2026-10-19  
**Code:** `main` @ `fc74c35`  
**Rule:** a feature is not IMPLEMENTED only because files exist. Status means “substantial code path is on `main` and is the path the UI calls,” not “proven in production this week.”

Labels on evidence: **VERIFIED**, **HISTORICAL**, **INFERRED**, **UNKNOWN**.

The August 2026 matrix `docs/diligence-readiness/PERMITPILOT_FEATURE_CONNECTIVITY_MATRIX.md` (commit `331fa80`) remains useful for old grades (F-numbers below). Reconcile it with this table before quoting a grade to a client.

## Route map

Guards in `src/App.tsx` / `src/components/auth/`:

- `/` `HomeRoute`: public home, signed-in users go to `/dashboard`.
- Most app routes: `ProtectedLayoutRoute` (session, deactivated profile signed out, forced password change, `ModuleFlagGate`).
- `/admin/*`: `AdminLayout` + `useRequireAdmin` (`admin` or `super_admin`).
- Token routes are not inside the dashboard guard: `/portal/:token`, `/embed/:token`, `/invite/:token`.

Placeholders (page components exist and render a placeholder, not a workflow): `/permit-queue`, `/reference/glossary`, `/reference/utility-coverage`, `/messages`.

`/baltimore`, `/baltimore/permits`, `/baltimore/records`, `/baltimore/records/:recordId` are a UI shell. `App.tsx` comments mark them as mock. Live Baltimore data uses the Accela scraper and `portalView.ts`, not these routes.

## Capability status

| Capability | Status | Evidence | Production proof |
|------------|--------|----------|------------------|
| Auth: signup, login, reset, forced password change | IMPLEMENTED | `useAuth`, `ProtectedLayoutRoute`, `profileSecurity.ts`, `profiles.must_change_password` migration `20260911140000_admin_created_user_password_flags.sql` | **UNKNOWN** live UAT |
| Profiles and roles | IMPLEMENTED | `profiles`, `user_roles`, `has_role`, `super_admin` in `20260911200000_super_admin_hierarchy.sql` | **UNKNOWN** which role rows exist in prod |
| Projects CRUD | IMPLEMENTED | `Projects.tsx`, `useProjects`, `projects` table | **UNKNOWN** |
| Project team invites | IMPLEMENTED | Invitation RPCs in `20260715130000_project_team_invitation_flow.sql`, edge `send-project-team-invitation` | **UNKNOWN** |
| Tenants (demo vs production isolation) | IMPLEMENTED | `20260715140000_row2_tenant_foundation.sql`, `can_access_tenant` | **UNKNOWN** whether every project has `tenant_id` |
| Portal login and scrape: DC, PGC, Montgomery, Howard, Accela (Baltimore, Arlington, Fairfax) | IMPLEMENTED | `memory.md` §4, `accela-scraper.js`, `pgc-eplan-scraper.js`, `scrapers/montgomery`, `scrapers/howard` | **UNKNOWN** — portals break when DOM changes. No 6-jurisdiction UAT log in this extraction |
| Durable Arlington scrape jobs | IMPLEMENTED | `scrape_jobs`, `claim_arlington_scrape_job`, in-process worker | **UNKNOWN** |
| Scrape cancellation | PARTIALLY IMPLEMENTED | July 2026 audit found non-Arlington cancel did not signal in-memory work. Later code: `scrape-job-cancellation.js`, migration `20260730120000_scrape_job_cancelling_status.sql`, tests. **INFERRED** fixed in code; production UAT not rerun | **UNKNOWN** |
| Portal data viewers | IMPLEMENTED | `PortalDataViewer`, `AccelaProjectView`, `BaltimorePortalDataView` via `isBaltimorePortal` | **UNKNOWN** |
| Baltimore `/baltimore/*` clone | PLANNED | Mock shell in `App.tsx` | n/a |
| Comment intake, parse, classify | IMPLEMENTED | Edge `intake-pipeline-agent`, `comment-parser-agent`, `discipline-classifier-agent`; `parsed_comments` | **UNKNOWN** |
| Response matrix and grounded drafts | IMPLEMENTED | `/response-matrix`, `generate-grounded-response`, `useGroundedDraftQueue` | **UNKNOWN** |
| Manual comment letter parse | IMPLEMENTED | `parse-manual-comment-letter` | **UNKNOWN** |
| Document ingestion (RAG chunks) | PARTIALLY IMPLEMENTED | Worker + `document_ingestion_jobs` + pgvector. OCR explicitly not enabled (`LOW_TEXT_MSG` in `document-ingestion-worker/worker.js`). Auto-enqueue after scrape was still an open backlog item (PP-008) and was not found as a scraper auto-enqueue in this pass | Production worker deploy is **2026-08-04** (**VERIFIED** Railway). Whether that build matches later migrations is **UNKNOWN** |
| DesignCheck summary page | IMPLEMENTED | `/designcheck`, `useDesignCheckSummary`, `src/lib/designcheck/` | **UNKNOWN** |
| Code Analyzer async v2 | PARTIALLY IMPLEMENTED | Code and production worker exist. New runs throw unless `VITE_CODE_ANALYZER_ASYNC_V2=true` (`featureFlags.ts`). Vercel flag value was **not** read | Worker deploy message names `fc74c35` (**VERIFIED**). End-to-end pass rate **UNKNOWN** |
| Code modification review | PARTIALLY IMPLEMENTED | `runReviewAsyncV2.ts`, worker `processCodeModJob.js`. Separate branch `wip/code-mod-uat-cleanup` @ `edc20c4` still exists | **UNKNOWN** |
| Code reference library | IMPLEMENTED as a page | `/code-reference` | Depth of content **UNKNOWN** |
| Inspections and punch lists | IMPLEMENTED | `useInspections`, `ProjectInspectionsSection`, `send-inspection-reminders` | Cron for that reminder function was **not** found in migrations (**UNKNOWN** scheduler) |
| Checklists and scheduled reports | IMPLEMENTED | `/checklist-history`, `process-scheduled-checklist-reports`, cron `*/15 * * * *` in `20260805040000_scheduled_reports_cron_and_claim.sql` | Whether cron is installed in hosted Postgres **UNKNOWN** (migration header says do not apply until reviewed) |
| Permit wizard filing | IMPLEMENTED in code | `PermitWizardFiling.tsx`, `permitwizard-preflight`, `permitwizard-execute`, `/api/filing/*` | Live E2E **UNKNOWN**. August audit said schema drift can block preflight |
| Stripe subscriptions | PARTIALLY IMPLEMENTED | `Pricing.tsx` → `create-checkout`, `stripe-webhook`, `check-subscription`. `useAuth` also reads `profiles` subscription columns. Those columns have **no matching CREATE/ALTER in migrations** (`docs/current-data-model.md` §4) | Live billing **UNKNOWN** (diligence: manual confirmation) |
| QuickBooks milestones | PARTIALLY IMPLEMENTED | `BillingInvoicePanel`, `src/lib/quickbooksApi.ts`, scraper routes, `claim_project_milestone_invoice` | OAuth/status seen 2026-08-26 (**HISTORICAL**). Successful live invoice **not verified**. External Intuit subscription was a blocker in the August backlog |
| Jurisdiction compare, map, state pages | IMPLEMENTED | Routes under `/jurisdictions/*`, Mapbox token function, admin CSV RPC `20260918190000_jurisdiction_subscription_integrity_and_csv_rpc.sql` | **UNKNOWN** |
| Jurisdiction notifications and drip | IMPLEMENTED in code | `send-jurisdiction-notification`, `process-scheduled-notifications` cron `*/5`, `process-drip-emails` hourly | Cron install **UNKNOWN** (do-not-apply headers) |
| Admin overview, access users, audit, campaigns | IMPLEMENTED | `src/pages/admin/*`. `/admin/members` and `/admin/authorizations` redirect to `/admin/access/users` | Governance enforcement mode in prod DB **UNKNOWN** |
| Feature flags and module gates | IMPLEMENTED | `feature_flags` migration `20260918200000_feature_flags_platform_control.sql`, `moduleFeatureFlags.ts`, `FeatureFlagsAdmin` (comment: dev-only, not in nav) | Flag rows in prod **UNKNOWN** |
| Shadow mode | IMPLEMENTED | `ShadowModeDashboard`, `shadow-evaluator`, `shadow-metrics`, tables in `20260303000000_shadow_mode_schema.sql` | Usage **UNKNOWN** |
| Operations board | PARTIALLY IMPLEMENTED | `OperationsBoard.tsx` imports both `operations-demo-data` and `operations-real-data`. Feasibility audit: a full Monday-style board needs new tables | By design until schema exists |
| Client portal and embed | IMPLEMENTED | `ClientPortal`, `EmbedWidget`, share links | **UNKNOWN** |
| Onboarding authorization | IMPLEMENTED as a route | `/onboarding/authorization`. `profiles.onboarding_completed` added in `20260919010000_profiles_onboarding_completed.sql` | **UNKNOWN** |
| PWA / offline | PARTIALLY IMPLEMENTED | `vite-plugin-pwa`, install prompt, offline indicator. Diligence flagged build/monitoring gaps | **UNKNOWN** |
| Public marketing site | IMPLEMENTED | `/`, `/pricing`, `/contact`, `/faq`, `/demos`, `/install` | ROI copy may still be placeholder (`memory.md` §9) |
| McDonald’s demo | PARTIALLY IMPLEMENTED | Protected `/demo/mcdonalds`. Narrative/synthetic per matrix F-53 | Not a production project template |
| UCI operator product | PARTIALLY IMPLEMENTED | Large `/uci/*` page set and `/api/uci/*`. Docs: stages 1–6 substantial, 7–10 partial, synthetic data, live submit gated off | **Not client-ready** per 2026-08-27 architecture. Later UCI branches exist and were not fully diffed |
| UCI Track A/B | UNKNOWN vs `main` | Branches `feat/uci-track-ab-backend`, `-frontend`, `-schema` exist locally and on origin. Merge-completeness vs `fc74c35` was **not** fully traced | Do not assume `main` equals those branch tips |
| Messages, permit queue, glossary, utility coverage page | PLANNED | Placeholder components | n/a |
| OCR | PLANNED | Explicit user-facing limitation string in the ingestion worker | n/a |
| Mobile Capacitor app | DEPRECATED as a production path | `capacitor.config.ts` `server.url` is a Lovable host | Do not treat as the Vercel app |

## Module flags

`src/lib/moduleFeatureFlags.ts` maps some paths to flags (design check, code compliance, jurisdictions, permit intelligence, UCI, response matrix, portal harvest, operations, permit filing, demo). If the flag is off, `ModuleFlagGate` sends the user to `/dashboard`.

**UNKNOWN:** the production flag row values. A route can be fully coded and still hidden.

## What “working” meant in recent agent work

Local Cursor transcripts from 2026-10-17 through 2026-10-19 (indexed by first user prompt, not fully replayed) are dominated by Code Analyzer accuracy: page-size classification, evidence required before a pass, forensic review of a McDonald’s New York Ave drawing set, and Railway deploys of `code-analyzer-worker`. That is the active engineering surface. It does not mean other modules regressed, and it does not mean analyzer output is accepted as correct without a fresh run.

## Deprecated or retired surfaces

| Surface | Status | Evidence |
|---------|--------|----------|
| Replit runtime | DEPRECATED | `docs/diligence-readiness/REPLIT_RETIREMENT_AUDIT.md`. Branch `replit-agent` remains in git |
| Lovable as the app generator | DEPRECATED as runtime | `reference/lovable-ui/` is a frozen reference. `LOVABLE_RETIREMENT_AUDIT.md` |
| `PublicOnlyRoute` | ABSENT | Documented in older architecture notes; no symbol in `src/` |
| Generic V1 Code Analyzer browser path | DEPRECATED | `assertNewAnalysisUsesV2()` throws if the flag is off. Comment: “There is no V1 fallback.” |

## Tests that exist (not coverage)

| Area | How to run | Approx. size | CI |
|------|------------|--------------|----|
| Frontend | `npx tsx --test <file>` | About 150 `*.test.ts(x)` files under `src/` | Only `src` invitation-logic test in `.github/workflows/uci-security-tests.yml` |
| Scraper | `cd scraper-service && npm test` | About 135 test files. Default script is an Arlington plus analyze-drawing subset. `npm run test:uci` and `test:uci:security` are separate | `test:uci:security` on PR/push to `main` |
| Code Analyzer worker | `cd code-analyzer-worker && npm test` | 9 files | Not in the workflow file |
| Document ingestion worker | No test script in its `package.json` | — | — |

No root `npm test`. Vitest appears under `reference/lovable-ui/` only, not the production app.
