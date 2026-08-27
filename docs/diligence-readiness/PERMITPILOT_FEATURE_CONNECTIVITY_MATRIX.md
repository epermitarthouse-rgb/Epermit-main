# PermitPilot Feature Connectivity Matrix

**Document date:** 2026-08-27  
**Code reference:** `main` @ `331fa80`  
**Parent audit:** [PERMITPILOT_360_PRODUCTION_AUDIT.md](./PERMITPILOT_360_PRODUCTION_AUDIT.md)

---

## Status legend

| Status | Definition |
|--------|------------|
| **PRODUCTION VERIFIED** | Live E2E or production HTTP/test evidence in this audit or linked docs |
| **IMPLEMENTED—UAT REQUIRED** | Code + tests exist; no production E2E proof in audit window |
| **PARTIAL** | Some paths work; significant gaps |
| **MANUAL ONLY** | Requires human operator; no automation |
| **MOCK/SYNTHETIC ONLY** | Demo/fixture data only |
| **UI SHELL** | Visual only; no backend |
| **DISCONNECTED** | UI exists but not wired to backend |
| **BROKEN** | Known failure in production path |
| **NOT IMPLEMENTED** | Missing code |
| **BLOCKED BY CLIENT/PROVIDER** | External dependency |
| **OUT OF SCOPE** | Explicitly excluded (UCI pilot, etc.) |

---

## Matrix — PermitPilot core

| ID | Capability | Status | Primary routes / entry | Backend / tables | Evidence |
|----|------------|--------|------------------------|------------------|----------|
| F-01 | User auth (signup/login) | **IMPLEMENTED—UAT REQUIRED** | `/auth` | Supabase Auth, `profiles` | `useAuth`, migrations |
| F-02 | Project CRUD | **IMPLEMENTED—UAT REQUIRED** | `/projects` | `projects`, RLS | `Projects.tsx`, hooks |
| F-03 | Project team / invites | **IMPLEMENTED—UAT REQUIRED** | Project detail, `/invite/:token` | `project_team_members`, Edge `send-project-team-invitation` | Team tests, invitation logic tests |
| F-04 | Portal login (Playwright) | **IMPLEMENTED—UAT REQUIRED** | Project → Portal | Railway `POST /api/login` | `memory.md` §6, `server.js` |
| F-05 | Portal scrape — DC ProjectDox | **IMPLEMENTED—UAT REQUIRED** | Portal UI | `server.js` generic Avolve | `memory.md` §4.1 |
| F-06 | Portal scrape — PGC ePlan | **IMPLEMENTED—UAT REQUIRED** | Portal UI | `pgc-eplan-scraper.js` | `pgc-*.test.js`, credential guard |
| F-07 | Portal scrape — Montgomery ProjectDox | **IMPLEMENTED—UAT REQUIRED** | Portal UI | `scrapers/montgomery/*` | `MONTGOMERY_REPORT_SPECS` |
| F-08 | Portal scrape — Howard ProjectDox | **IMPLEMENTED—UAT REQUIRED** | Portal UI | `scrapers/howard/*` | Howard B2C login handling |
| F-09 | Portal scrape — Baltimore Accela | **IMPLEMENTED—UAT REQUIRED** | Portal UI | `accela-scraper.js` | Requires `projectId` |
| F-10 | Portal scrape — Arlington Accela | **IMPLEMENTED—UAT REQUIRED** | Portal UI | `scrapers/arlington/*`, durable jobs | 11 Arlington test files |
| F-11 | Portal scrape — Fairfax Accela | **IMPLEMENTED—UAT REQUIRED** | Portal UI | `scrapers/fairfax/*` | Module wraps Accela |
| F-12 | Portal data viewer | **IMPLEMENTED—UAT REQUIRED** | `/portal-data` | `projects.portal_data` | `PortalDataViewer`, `AccelaProjectView` |
| F-13 | Scrape progress (SSE) | **IMPLEMENTED—UAT REQUIRED** | Scrape UI | `GET /api/progress/:sessionId` | `ScrapeContext` |
| F-14 | Arlington durable scrape jobs | **IMPLEMENTED—UAT REQUIRED** | Background | `arlington_*` tables, worker loop | Orchestration tests |
| F-15 | Portal credentials storage | **IMPLEMENTED—UAT REQUIRED** | Settings / project | `portal_credentials` | `portal-credentials.routes.js` |
| F-16 | Comment PDF intake pipeline | **IMPLEMENTED—UAT REQUIRED** | Project actions | Edge `intake-pipeline-agent` | Multi-stage pipeline code |
| F-17 | Manual comment letter parse | **IMPLEMENTED—UAT REQUIRED** | Comment Review | Edge `parse-manual-comment-letter` | Function exists |
| F-18 | Comment parser agent | **IMPLEMENTED—UAT REQUIRED** | Pipeline stage | Edge `comment-parser-agent` | Deployed function |
| F-19 | Discipline classifier | **IMPLEMENTED—UAT REQUIRED** | Pipeline stage | Edge `discipline-classifier-agent` | Historical debug notes in memory.md |
| F-20 | Context enrichment | **IMPLEMENTED—UAT REQUIRED** | Pipeline stage | Edge `context-reference-engine` | Timeout budgets in intake agent |
| F-21 | Auto-routing | **IMPLEMENTED—UAT REQUIRED** | Pipeline stage | Edge `auto-router-agent` | Pipeline stage |
| F-22 | Parsed comments UI | **IMPLEMENTED—UAT REQUIRED** | `/comment-review`, `/classified-comments` | `parsed_comments` | Pages exist |
| F-23 | Response Matrix | **IMPLEMENTED—UAT REQUIRED** | `/response-matrix` | `parsed_comments` response columns | Approval RBAC |
| F-24 | Grounded AI response (RAG) | **IMPLEMENTED—UAT REQUIRED** | Response Matrix actions | Edge `generate-grounded-response`, chunks | Vector search in migration |
| F-25 | Response package export | **IMPLEMENTED—UAT REQUIRED** | Response Matrix | Edge `export-response-package` | Function exists |
| F-26 | Document upload | **IMPLEMENTED—UAT REQUIRED** | Project documents | Storage `project-documents` | Upload components |
| F-27 | Document ingestion queue | **IMPLEMENTED—UAT REQUIRED** | Upload → ingest action | `document_ingestion_jobs` | Edge `ingest-project-document` |
| F-28 | Ingestion worker (extract/embed) | **IMPLEMENTED—UAT REQUIRED** | Background | Railway `document-ingestion-worker` | `worker.js` poll loop |
| F-29 | OCR for scanned PDFs | **NOT IMPLEMENTED** | — | — | `LOW_TEXT_MSG` in worker |
| F-30 | DesignCheck / drawing analyzer | **IMPLEMENTED—UAT REQUIRED** | `/designcheck` | Edge `analyze-drawing`, Railway service | `analyze-drawing.test.js` |
| F-31 | Code Compliance / Code Mod | **PARTIAL** | `/code-compliance` | Railway `code-modification.service.js` | Local uncommitted WIP on dev machine |
| F-32 | Code Analyzer async v2 | **NOT IMPLEMENTED** (prod) | — | Local branch only | `feat/code-analyzer-async-v2` not on remote |
| F-33 | Permit Wizard Pre-Flight | **IMPLEMENTED—UAT REQUIRED** | `/permit-wizard-filing` | Edge `permitwizard-preflight` | `PERMIT_FILING_PREFLIGHT_ENABLED=true` |
| F-34 | Permit Wizard execution/submit | **IMPLEMENTED—UAT REQUIRED** | Filing review | Edge `permitwizard-execute`, Railway filers | Gated on portal credentials |
| F-35 | Permit filing — Montgomery submit | **IMPLEMENTED—UAT REQUIRED** | Filing flow | `montgomery/submit.js` | Filing modules in server.js |
| F-36 | Permit status monitor | **IMPLEMENTED—UAT REQUIRED** | Background | Edge `permit-status-monitor` | Not production-verified |
| F-37 | QuickBooks OAuth connect | **PRODUCTION VERIFIED** | Billing settings / OAuth | Railway `/api/quickbooks/oauth/*` | Status `connected:true` HTTP 2026-08-27 |
| F-38 | QuickBooks milestone dry-run | **PRODUCTION VERIFIED** | Billing tab | `POST /api/quickbooks/invoice/trigger?dryRun=true` | `QUICKBOOKS_PRODUCTION_E2E.md` |
| F-39 | QuickBooks live invoice create | **BLOCKED BY CLIENT/PROVIDER** | Billing tab | Intuit API | QB subscription inactive |
| F-40 | QuickBooks auth hardening (JWT) | **PRODUCTION VERIFIED** | API | `getAuthenticatedUser` on routes | `quickbooks.routes.js` @331fa80 |
| F-41 | QB payment / void sync | **NOT IMPLEMENTED** | — | — | Documented gap in QB E2E doc |
| F-42 | Operations Board — real reimbursables | **PARTIAL** | `/operations` | `projects`, UCI costs | `operations-real-data.ts` |
| F-43 | Operations Board — workflow/scope | **MOCK/SYNTHETIC ONLY** | `/operations` | `operations-demo-data.ts` | Explicit mock imports |
| F-44 | Permit Queue | **UI SHELL** | `/permit-queue` | None | `PermitQueuePlaceholder.tsx` |
| F-45 | Messages | **UI SHELL** | `/messages` | None | Placeholder |
| F-46 | Admin — notifications/branding | **IMPLEMENTED—UAT REQUIRED** | `/admin` | `jurisdiction_subscriptions`, branding tables | `AdminPanel.tsx` |
| F-47 | Admin — members/roles | **IMPLEMENTED—UAT REQUIRED** | `/admin/members` | `user_roles` | `AdminMembers.tsx` |
| F-48 | Admin — feature flags | **IMPLEMENTED—UAT REQUIRED** | `/admin/feature-flags` | Feature flag tables | Page exists |
| F-49 | Admin — authorizations | **UI SHELL** | `/admin/authorizations` | None | Placeholder |
| F-50 | Client portal (token) | **IMPLEMENTED—UAT REQUIRED** | `/portal/:token` | Edge `customer-portal` | Token route |
| F-51 | Stripe subscriptions | **IMPLEMENTED—UAT REQUIRED** | Pricing/checkout | Edge `create-checkout`, `stripe-webhook` | Functions exist; live **Requires manual confirmation** |
| F-52 | PWA / offline | **PARTIAL** | Install prompt | Service worker | Build passed on fix branch; monitoring only |
| F-53 | McDonald's executive demo | **MOCK/SYNTHETIC ONLY** | `/demo/mcdonalds` | Static narrative | `DemoMcDonalds.tsx`, upcoming CTAs |
| F-54 | Jurisdiction map / intelligence | **IMPLEMENTED—UAT REQUIRED** | `/jurisdictions/*`, `/permit-intelligence` | Mixed Supabase + CSV data | Pages exist |
| F-55 | Analytics dashboard | **IMPLEMENTED—UAT REQUIRED** | `/analytics` | Supabase queries | Page exists |
| F-56 | Checklist reports / email | **IMPLEMENTED—UAT REQUIRED** | `/checklist-history` | Edge report functions | Multiple send-* functions |
| F-57 | Shadow mode / evaluator | **IMPLEMENTED—UAT REQUIRED** | `/admin/shadow-mode` | Edge `shadow-*` | Admin gated |
| F-58 | Baltimore portal UI clone | **UI SHELL** | `/baltimore/*` | None | Mock data comment in App.tsx |
| F-59 | Frontend Supabase env config | **PARTIAL** | All Supabase calls | Hardcoded literals on main | `supabase.ts`; fix branch unmerged |
| F-60 | CI quality gates | **PARTIAL** | GitHub Actions | UCI security workflow only | `.github/workflows/uci-security-tests.yml` |

---

## Matrix — Utility scrapers / UCI (boundary)

| ID | Capability | Status | Evidence |
|----|------------|--------|----------|
| U-01 | UCI coordination lifecycle (stages 1–6) | **IMPLEMENTED—UAT REQUIRED** | Extensive backend + UI; synthetic fixtures |
| U-02 | UCI stages 7–10 | **PARTIAL** | UI panels + tests; live paths gated |
| U-03 | PEPCO dashboard discovery | **IMPLEMENTED—UAT REQUIRED** | `scrapers/pepco/dashboard-discovery.js` |
| U-04 | PEPCO application detail discovery | **IMPLEMENTED—UAT REQUIRED** | `application-detail-discovery.js` |
| U-05 | PEPCO live submission | **MANUAL ONLY** / gated | `UCI_PEPCO_LIVE_SUBMISSION_ENABLED=false` |
| U-06 | Dominion portal adapter | **NOT IMPLEMENTED** | Synthetic checklist only |
| U-07 | Dominion production manifest | **BLOCKED BY CLIENT/PROVIDER** | Manual template required |
| U-08 | Microsoft Graph inbound email | **IMPLEMENTED—UAT REQUIRED** | Poller code; live **Requires manual confirmation** |
| U-09 | UCI QuickBooks passthrough | **IMPLEMENTED—UAT REQUIRED** | `uci-qb-passthrough.service.js`; live not verified |
| U-10 | UCI client-team live readiness | **NOT IMPLEMENTED** | Executive summary: not ready |
| U-11 | UCI cross-tenant security | **PRODUCTION VERIFIED** (test suite) | CI `test:uci:security` |

---

## Connectivity heat map (summary)

| Workstream | Production verified | UAT required | Partial / mock / blocked |
|------------|--------------------:|-------------:|-------------------------:|
| Auth & projects | 0 | 3 | 1 (Supabase config) |
| Portal scrapers | 0 | 11 | 0 |
| Comments & RAG | 0 | 10 | 1 (OCR) |
| Permit filing | 0 | 4 | 0 |
| Billing (QB) | 3 | 0 | 1 blocked live + 1 not impl |
| Admin & ops | 0 | 4 | 3 shells + partial ops board |
| CI / quality | 1 | 0 | 1 |
| UCI (boundary) | 1 | 6 | 4 |

---

## Notes

1. **Conservative grading:** Features are not marked **PRODUCTION VERIFIED** without documented live E2E in this audit window.
2. **QuickBooks backlog superseded:** Items in `TECHNICAL_REMEDIATION_BACKLOG.md` #1–2 (unauthenticated trigger, OAuth CSRF) are **resolved on main @331fa80**; matrix reflects current code.
3. **Code Mod WIP:** Treat as **PARTIAL** until uncommitted local work is merged and deployed.
