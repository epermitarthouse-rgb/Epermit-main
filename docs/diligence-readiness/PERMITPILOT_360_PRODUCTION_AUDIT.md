# PermitPilot 360° Production Audit

**Document date:** 2026-08-27  
**Audit type:** Read-only, evidence-based  
**Authoritative code:** `main` at `331fa80` (`Epermit-main`)  
**Docs branch:** `docs/diligence-readiness` (this worktree)  
**No application, database, deployment, or configuration changes were made during this audit.**

Index: [README.md](./README.md)

---

## Evidence classification

| Label | Meaning |
|-------|---------|
| **Verified** | Source code, git, read-only HTTP, or automated test inventory |
| **Client confirmed** | Stated by project owner in prior diligence |
| **Inferred** | Reasonable deduction, explicitly labeled |
| **Requires manual confirmation** | Cannot close without dashboard / live E2E |

Status labels for features match [PERMITPILOT_FEATURE_CONNECTIVITY_MATRIX.md](./PERMITPILOT_FEATURE_CONNECTIVITY_MATRIX.md).

---

## 1. Architecture map (how components actually connect)

### 1.1 System diagram

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  Browser (Vercel SPA)                                                   │
│  src/ → dist/  —  https://epermit-main-nine.vercel.app                  │
│  • Supabase JS client (hardcoded URL+anon on main)                      │
│  • fetch() → Railway for scrapers, UCI, QuickBooks, filing              │
└───────────────┬───────────────────────────────┬─────────────────────────┘
                │ HTTPS (anon JWT)               │ HTTPS (/api/*)
                ▼                                ▼
┌───────────────────────────┐    ┌────────────────────────────────────────┐
│ Supabase Cloud            │    │ Railway — scraper-service              │
│ ref: eeqxyjrcldivtpikcpvk │◄───│ https://epermit-main-production...     │
│ • Postgres + RLS          │    │ • Playwright scrapers (server.js)      │
│ • Auth                    │    │ • UCI API (/api/uci/*, JWT)            │
│ • Storage (project-docs)  │    │ • QuickBooks (/api/quickbooks/*, JWT)  │
│ • 51 Edge Functions       │    │ • Background: Arlington jobs, UCI jobs │
└───────────────▲───────────┘    └────────────────────────────────────────┘
                │ service role
                │
┌───────────────┴───────────┐
│ Railway — document-       │
│ ingestion-worker          │
│ Polls document_ingestion_ │
│ jobs → extract/chunk/embed│
└───────────────────────────┘
```

### 1.2 Frontend routes (verified `src/App.tsx`)

| Route group | Examples | Backend dependency |
|-------------|----------|-------------------|
| Public marketing | `/`, `/pricing`, `/contact`, `/faq` | Supabase (minimal) |
| Auth | `/auth`, `/invite/:token` | Supabase Auth |
| Core product | `/dashboard`, `/projects`, `/portal-data`, `/comment-review`, `/response-matrix` | Supabase + Edge Functions |
| Scraping | Portal login/scrape via project UI → Railway | Railway `/api/login`, `/api/scrape`, SSE progress |
| AI / compliance | `/designcheck`, `/code-compliance` | Supabase + Railway analyze-drawing |
| Permit filing | `/permit-wizard-filing`, `/permit-wizard-filing/review/:id` | Edge `permitwizard-*` + Railway filing modules |
| Billing | Project detail → Billing tab | Railway `/api/quickbooks/*` |
| Admin | `/admin/*` | Supabase + Edge Functions (admin-gated UI) |
| UCI (boundary) | `/uci/*` (15+ routes) | Railway `/api/uci/*` — **synthetic/mock on main; not client-team ready** |
| Placeholders | `/permit-queue`, `/messages`, `/reference/glossary`, `/baltimore/*` | None or mock-only |
| Demo | `/demo/mcdonalds` | Static/synthetic narrative; limited live CTAs |

**API base resolution:** `src/lib/scraperBaseUrl.ts` — `VITE_API_BASE_URL` if set, else defaults to Railway production URL.

### 1.3 Railway backend surface (verified)

| Mount | File | Auth |
|-------|------|------|
| Scrape orchestration | `server.js` + `register-execution-routes.js` | Session IDs; portal credentials |
| `/api/uci/*` | `app/routes/uci.routes.js` (~139 handlers) | Supabase JWT |
| `/api/quickbooks/*` | `app/routes/quickbooks.routes.js` | Supabase JWT + project editor RPC (main @331fa80) |
| `/api/documents/*` | `app/routes/documents.routes.js` | Mixed |
| `/api/portal-credentials/*` | `app/routes/portal-credentials.routes.js` | JWT |
| Filing (legacy) | Modules in `server.js`; planning stub in `filing.routes.js` | Session/credentials |
| Health | Root `/` returns 200 | **Verified** 2026-08-27 |

**Background workers started with server:** Arlington durable scrape loop, optional UCI durable jobs, UCI Graph inbound poller, UCI lifecycle scheduler (`ARCHITECTURE.md`, `register-execution-routes.js` imports).

### 1.4 Supabase (verified)

| Layer | Detail |
|-------|--------|
| Project ref | `eeqxyjrcldivtpikcpvk` (`supabase/config.toml`) |
| Schema | Migration-only (`supabase/migrations/`) |
| Edge Functions | **51** directories with `index.ts` |
| JWT config | **All 51 functions** have `verify_jwt = false` in `config.toml` — in-function auth varies |
| Storage | `project-documents` bucket (uploads, scraper artifacts) |
| RAG tables | `project_documents`, `project_document_chunks`, `document_ingestion_jobs` (migrations 20260606140000, 20260606160000) |

### 1.5 Frontend ↔ Supabase configuration drift (**Verified**, Medium risk)

On `main`, `src/lib/supabase.ts` **hardcodes** URL and anonymous key literals. Vercel env var **names** exist but may not drive the bundled client. Prepared fix on branch `fix/frontend-supabase-env-config` — **unmerged, not deployed**.

### 1.6 Production reachability (read-only HTTP, 2026-08-27)

| Endpoint | Result |
|----------|--------|
| Railway `/` | HTTP 200 |
| Railway `/api/quickbooks/status` | HTTP 200, `{"connected":true}` (minimal public shape on current deploy) |
| Vercel `/` | HTTP 200 |

**Note:** Root 200 ≠ Playwright health, worker health, or DB latency. No dedicated `/health` route (**Verified** 404 in prior audit).

### 1.7 Out-of-repo dependencies (Requires manual confirmation)

Intuit QuickBooks, Microsoft Graph, Stripe, Resend, OpenAI, Mapbox — credentials in shared vault per client; not verified from repo.

---

## 2. Scraper production readiness inventory

Scrapers discovered from **code**, not assumed lists. Production orchestration lives primarily in `scraper-service/server.js` and `register-execution-routes.js`.

| Jurisdiction / Provider | Code location | Portal type | Tests | Production status |
|-------------------------|---------------|-------------|-------|-------------------|
| **Washington DC** — ProjectDox | `server.js` (generic Avolve), `scrapers/washington/*` (parallel, blocked) | `projectdox` | Limited dedicated tests | **IMPLEMENTED—UAT REQUIRED** — default Avolve path; no DC-specific test suite found |
| **DC DOB / Accela** | `accela-scraper.js` when Citizen Access URL | `accela` | Accela-adjacent in integration | **IMPLEMENTED—UAT REQUIRED** — shares Accela module |
| **Prince George's County (PGC)** | `pgc-eplan-scraper.js`, `scrapers/pgc/*` | `projectdox` / `pgc-eplan` | `pgc-*.test.js` (retry, export, brava) | **IMPLEMENTED—UAT REQUIRED** — requires saved portal credentials on linked project |
| **Montgomery County, MD** | `scrapers/montgomery/*`, `projectdox-scraper.js` | `montgomery-projectdox` | Montgomery in pipeline tests | **IMPLEMENTED—UAT REQUIRED** — SSRS report specs hardcoded |
| **Howard County, MD** | `scrapers/howard/*` | `projectdox` | Howard bootstrap/discovery in code | **IMPLEMENTED—UAT REQUIRED** — Azure B2C login URL handling |
| **Baltimore City, MD** | `accela-scraper.js`, `scrapers/baltimore/*` | `accela` | Baltimore rules in server | **IMPLEMENTED—UAT REQUIRED** — **requires `projectId`** for integrity |
| **Arlington County, VA** | `scrapers/arlington/*`, durable job system (`lib/arlington-*`) | Accela tenant | **11** dedicated test files | **IMPLEMENTED—UAT REQUIRED** — durable worker + plan review downloads; strongest test coverage |
| **Fairfax County, VA** | `scrapers/fairfax/*` → `accela-scraper.js` | `accela` | Fairfax module exists | **IMPLEMENTED—UAT REQUIRED** |
| **Generic Accela** | `accela-scraper.js` | `accela` | Shared | **IMPLEMENTED—UAT REQUIRED** — non-Baltimore may omit projectId |
| **PEPCO** (utility) | `scrapers/pepco/*`, UCI discovery routes | UCI portal | `uci-pepco-dashboard-list.test.js` | **PARTIAL** — live submit gated `UCI_PEPCO_LIVE_SUBMISSION_ENABLED=false` default |
| **Dominion** (utility) | UCI templates only; **no portal scraper** | N/A | Synthetic checklist tests | **MOCK/SYNTHETIC ONLY** — production manifest blocked pending real template |
| **Baltimore UI clone** | `src/pages/baltimore/*` | N/A | None | **UI SHELL** — mock Accela UI, not connected to scraper |

**Parallel refactor status:** `scrapers/README.md` documents Washington/PGC/Montgomery mappers still trapped in `server.js`; `server.js` cannot be safely `require()`'d for delegation.

**Maintenance risk:** Playwright selectors vs portal UI changes; no scheduled regression against live portals in CI.

---

## 3. Document ingestion + RAG audit

### 3.1 Pipeline trace

```text
Portal scrape / manual upload
  → project_documents (Storage + DB row)
  → POST Edge Function ingest-project-document (auth + project access)
  → document_ingestion_jobs (status: pending)
  → document-ingestion-worker (Railway) polls & claims job
  → download from Storage → PDF/DOCX extract → chunk → OpenAI embed
  → project_document_chunks (pgvector HNSW index)
  → generate-grounded-response Edge Function
       → embed query → vector similarity search
       → OpenAI completion with grounded evidence
  → parsed_comments / Response Matrix UI
```

### 3.2 Automatic vs manual gaps

| Step | Automatic | Manual / gap |
|------|-----------|--------------|
| Scraper → Storage | **Yes** for jurisdictions with download pipelines | Arlington oversized downloads may need retry (`ARLINGTON_FORCE_RETRY_*` env) |
| Upload → ingest queue | **Yes** via `ingest-project-document` | User must trigger ingest for uploaded docs |
| OCR for scanned PDFs | **No** | Worker sets `LOW_TEXT_MSG` — OCR not implemented |
| Comment letter intake | **Partial** | `intake-pipeline-agent` from portal PDFs; `parse-manual-comment-letter` for uploads |
| Grounded response | **Yes** when chunks exist | Fails gracefully with `GROUNDED_NO_REVIEW_TEXT_MESSAGE` if no chunks |
| McDonald's demo workflow | **N/A** | `/demo/mcdonalds` uses synthetic narrative; CTAs to `/matrix/ai-workflow` marked **upcoming** — not production RAG path |

### 3.3 McDonald's workflow (executive demo)

**Verified:** `DemoMcDonalds.tsx` — marketing/demo page with `DemoDataBadge`, synthetic stats, guided tour. Live CTAs only to routes in `LIVE_ROUTES` set (`/onboarding/authorization`, `/contact`, `/demos`, `/dashboard`, `/uci`). Portfolio/Conflict Hunter/AI workflow links are **upcoming** (not wired).

**Not a production E2E workflow** — does not exercise scrape → ingest → comment → response → billing.

---

## 4. Feature-to-feature connectivity (lifecycles)

### 4.1 Project lifecycle

| Link | Status | Gap |
|------|--------|-----|
| Create project → save portal URL | **Verified** | — |
| Portal credentials → scrape | **Verified** | PGC/Montgomery require credentials on linked project |
| Scrape → `portal_data` JSONB | **Verified** | Viewer mapping varies by portal subtype |
| Scrape → document upload → ingestion | **Partial** | Not all scrapers enqueue ingestion automatically |
| Project → team invites | **Verified** | RLS + `has_project_access` |
| Project → QuickBooks billing | **Verified** code path | Live invoice **blocked by QB subscription** (see §7) |

### 4.2 Comment → response lifecycle

| Link | Status | Gap |
|------|--------|-----|
| Portal PDF → `intake-pipeline-agent` | **Implemented** | Requires operator trigger / UI action |
| Parser → classifier → enrichment → routing | **Implemented** in Edge chain | Time budgets may leave stages incomplete |
| `parsed_comments` → Response Matrix | **Verified** UI | Approval requires owner/admin |
| Comment → grounded AI response | **Implemented** | Depends on ingestion chunks |
| Response → export package | **Implemented** (`export-response-package`) | UAT required |

### 4.3 Filing lifecycle

| Link | Status | Gap |
|------|--------|-----|
| Pre-flight agents (01–04) | **ENABLED** (`PERMIT_FILING_PREFLIGHT_ENABLED=true`) | Beta labeled |
| Execution (approve → submit) | **ENABLED** in code (`PERMIT_FILING_EXECUTION_ENABLED=true`) | **IMPLEMENTED—UAT REQUIRED** — portal credential dependency |
| Filing → scrape status sync | **Partial** | `permit-status-monitor` Edge Function exists; live loop unverified |
| Montgomery filing modules | **Code exists** (`montgomery/filer.js`, `submit.js`) | Registration still in `server.js` |

### 4.4 Billing lifecycle

| Link | Status | Gap |
|------|--------|-----|
| Project contract → M1/M2/M3 trigger | **Verified** on main | Dry-run **production-verified**; live write **blocked externally** |
| Milestone → QuickBooks draft invoice | **Code complete** | QB subscription inactive |
| QB void → PermitPilot milestone reset | **NOT IMPLEMENTED** | No payment webhook sync |
| UCI costs → QB passthrough | **Code exists** | Live success **not verified** |

### 4.5 Broken / missing links (summary)

1. **Permit Queue** — UI placeholder; no API (`PermitQueuePlaceholder.tsx`)
2. **Operations Board** — mixes real QB/reimbursable data with mock workflow/scope (`operations-demo-data.ts`)
3. **Scrape job → unified ops dashboard** — not connected
4. **Ingestion auto-trigger post-scrape** — inconsistent by jurisdiction
5. **UCI ↔ PermitPilot project** — separate product surface; coordination exists but UCI not client-ready

---

## 5. Admin / access-control model

### 5.1 Platform admin (`user_roles.role = 'admin'`)

**Verified:** `AdminLayout` + `useRequireAdmin` gate `/admin/*` routes.

| Admin route | Function | Data source |
|-------------|----------|-------------|
| `/admin` | Jurisdiction notifications, email branding, activity log, scheduling | Supabase tables |
| `/admin/jurisdictions` | Jurisdiction admin CRUD | Supabase |
| `/admin/feature-flags` | Feature flag toggles | Supabase |
| `/admin/shadow-mode` | Shadow metrics dashboard | Edge Functions |
| `/admin/members` | Platform role management | `user_roles`, profiles RPC |
| `/admin/audit` | Audit log viewer | Supabase |
| `/admin/authorizations` | **Placeholder** | No backend |
| `/admin/uci-action-tracker` | UCI lifecycle tracker UI | Docs + UCI tables |

### 5.2 Project-level access

**Verified:** `has_project_access`, `has_project_admin_access`, `has_project_editor_access` RPCs; team invitations via `send-project-team-invitation`.

### 5.3 Minimum ops dashboard scope (recommended)

Not implemented as a single surface. Minimum viable ops would consolidate:

1. Scrape job status / Arlington durable queue depth
2. Document ingestion job backlog + failures
3. Edge Function error rates (manual today)
4. QuickBooks connection health + last invoice attempt
5. Portal credential expiry / login failures
6. UCI live-flag state (read-only indicator)

Current state: **scattered** across Admin panel (marketing/notifications), Projects UI, Railway logs, Supabase dashboard.

---

## 6. Security / multi-user readiness

| Area | Status | Evidence |
|------|--------|----------|
| Supabase Auth | **Verified** | Email/password; session in browser |
| RLS on projects, documents, chunks | **Verified** | Migrations enable RLS + policies |
| Platform admin roles | **Verified** | `user_roles`, `has_role()` |
| Project team RBAC | **Verified** | owner/admin/editor/viewer |
| Service role usage | **Verified** | Railway + Edge Functions + ingestion worker — not in frontend |
| Portal credentials storage | **Verified** | `portal_credentials` table; encrypted at rest (Supabase) |
| QuickBooks OAuth tokens | **Verified** | DB storage; crypto service on main |
| QB invoice trigger auth | **Verified fixed on main** | `getAuthenticatedUser` + editor access (`quickbooks.routes.js`) — **supersedes** backlog item #1 dated 2026-08-26 |
| QB OAuth CSRF | **Verified fixed on main** | State validation in hardened routes |
| Edge Function JWT | **Requires review** | All `verify_jwt = false` in config.toml |
| UCI cross-tenant | **Verified tests** | CI workflow `uci-security-tests.yml` |
| Webhooks (Stripe) | **Requires manual confirmation** | `stripe-webhook` Edge Function exists |
| Multi-user concurrent scrape | **Partial** | Session-based; Arlington has durable job dedup |

---

## 7. Production operations

| Capability | Status | Evidence |
|------------|--------|----------|
| Scrape scheduling | **MANUAL ONLY** | User-initiated via UI |
| Arlington durable queue | **Verified** | Worker loop + job store + RPC claim |
| Document ingestion queue | **Verified** | Poll-based worker, concurrency env |
| UCI Graph inbound poller | **Verified code** | Background worker; live env **Requires manual confirmation** |
| UCI lifecycle scheduler | **Verified code** | Track B scheduler tests |
| Monitoring / alerting | **NOT IMPLEMENTED** | No Datadog/Sentry in repo; Railway notifications only |
| Backups — Postgres | **Client confirmed** prior diligence: 7 daily physical; PITR off | **Requires manual confirmation** for current state |
| Backups — Storage | **Not in DB backups** | Separate recovery path needed |
| Health checks | **Minimal** | HTTP 200 on `/` only |
| Deployment | Railway auto from `main`; Vercel frontend | Production may lag git tip (prior snapshot `da66200` vs main `331fa80`) |

---

## 8. Testing / quality gates

| Layer | Inventory | Gap |
|-------|-----------|-----|
| Scraper-service | **120** test files; default `npm test` runs Arlington + analyze-drawing subset | Full suite not in default script; no live portal E2E in CI |
| UCI tests | **~80+** `uci-*.test.js` files | Extensive unit/integration; synthetic fixtures |
| Frontend | **~120+** `*.test.ts(x)` | Code analyzer, UCI presentation, permit filing logic |
| CI (GitHub Actions) | **1 workflow:** `uci-security-tests.yml` | No scraper regression CI; no frontend test CI; no deploy gates |
| Edge Functions | Manual deploy | No automated function test pipeline |
| Production E2E | QuickBooks dry-run **Verified** (2026-08-27 doc) | Live portal scrape E2E **not recorded** |

---

## 9. Incomplete / misleading UI (specific)

| Surface | Issue | Evidence |
|---------|-------|----------|
| `/permit-queue` | Explicit placeholder — "not connected" | `PermitQueuePlaceholder.tsx` |
| `/messages` | Placeholder | `MessagesPlaceholder.tsx` |
| `/reference/glossary`, `/reference/utility-coverage` | Placeholders | `GlossaryPlaceholder.tsx`, etc. |
| `/admin/authorizations` | Preview stub | `AdminAuthorizationsPlaceholder.tsx` |
| `/baltimore/*` | Mock Accela UI clone | Comment in `App.tsx` line 263 |
| `/operations` | Mock workflow + scope tabs mixed with real reimbursables | `operations-demo-data.ts`, `DataSourceBadge` |
| `/demo/mcdonalds` | Synthetic stats presented as demo | `DemoDataBadge`; tour CTAs marked upcoming |
| Permit Filing | Beta labels despite execution enabled | `permitFilingWip.ts` |
| UCI dashboard | Rich UI implying production readiness | Synthetic PDFs, dry-run defaults — see UCI boundary |
| ROI / marketing calculators | Historical placeholder copy risk | `memory.md` §9 |

---

## 10. UCI boundary (PermitPilot vs UCI)

UCI is **on main and Railway** but **not client-team ready** for live utility coordination.

| Fact | Classification |
|------|----------------|
| 139 UCI route handlers | **Verified** |
| Synthetic Highland Springs / Dominion checklist | **Verified** |
| PEPCO live submit default off | **Verified** `.env.example` |
| Real client documents pilot | **NOT STARTED** |
| Production env flag values | **Requires manual confirmation** |

PermitPilot core handover should treat UCI as **prototype** unless/until pilot hardening (estimates §B) completes.

---

## 11. Platform items verified from prior diligence

| Item | Status (2026-08-27) |
|------|---------------------|
| QuickBooks on Railway only; no n8n | **Verified** |
| QB dry-run production-verified | **Verified** (`QUICKBOOKS_PRODUCTION_E2E.md`) |
| QB live invoice | **BLOCKED BY CLIENT/PROVIDER** — subscription inactive |
| Replit / Lovable | **No production dependency** |
| Supabase backups 7 daily; PITR off; Storage separate | **Client confirmed** — reconfirm in dashboard |
| Hardcoded Supabase frontend on main | **Verified** — fix branch unmerged |
| Local-only async-v2, Code Mod WIP | **Verified** — not in production |

---

## 12. Related documents

| Document | Purpose |
|----------|---------|
| [PERMITPILOT_FEATURE_CONNECTIVITY_MATRIX.md](./PERMITPILOT_FEATURE_CONNECTIVITY_MATRIX.md) | Feature-level status table |
| [PERMITPILOT_UPCOMING_WORK_AND_ESTIMATE.md](./PERMITPILOT_UPCOMING_WORK_AND_ESTIMATE.md) | Backlog, estimates, sprint options |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Prior architecture snapshot |
| [QUICKBOOKS_PRODUCTION_E2E.md](./QUICKBOOKS_PRODUCTION_E2E.md) | QB E2E status on main |
| [memory.md](../../memory.md) | Scraper engineering handbook |

---

## 13. Audit limitations

- No Supabase dashboard, Railway env export, or Vercel build log access during this pass
- No live portal scrape E2E executed (would require credentials and write risk)
- Production deploy commit may differ from local `main` tip
- Edge Function per-function auth not exhaustively traced (51 functions)
