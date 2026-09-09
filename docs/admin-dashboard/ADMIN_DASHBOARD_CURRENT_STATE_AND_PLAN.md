# PermitPilot Admin & Operations Dashboard — Current State and Plan

**Audit date:** 2026-09-09  
**Auditor mode:** Read-only (no code, DB, deployment, or platform config changes)  
**Code reference:** `main` @ `8739015` (`Remove duplicate diligence docs and prune merged worktrees.`)  
**Repository:** `epermitarthouse-rgb/Epermit-main`  
**Parent diligence package:** `docs/diligence-readiness/` (Aug 2026)

---

## 1. Executive Summary

PermitPilot already has a **fragmented admin surface** under `/admin/*` (platform role gate via `user_roles.admin`) plus **operator surfaces outside admin** (Dashboard scrape widget, `/operations`, `/portal-data`, `/settings` credentials, project Team tab). There is **no unified Operations Dashboard** that aggregates scrape jobs, ingestion queues, integration health, and cross-project ops in one place — the exact gap called out as **PP-005** in diligence backlog.

**Environment verdict:** All five platforms point at the correct PermitPilot stack. One caution: GitHub CLI active account is `DM1404`, not `epermitarthouse-rgb`; git SSH remote and repo access still work. Supabase CLI is linked to InsightDC (`eeqxyjrcldivtpikcpvk`) but remote migration diff could not be read (account privilege 403). Vercel CLI is not authenticated locally; production URL verified via HTTP.

**Recommendation:** Build a **minimum viable ops dashboard** (Phase A) as admin-gated read-only aggregation over existing tables/APIs before expanding into full operations board schema (Phase B/C).

---

## 2. Phase 1 — Local Repository Verification

| Check | Result |
|-------|--------|
| Workspace pwd | `/Users/javerianaveed/epermit` (parent folder; **not** a git root) |
| Git root | `/Users/javerianaveed/epermit/Epermit-main` |
| Branch | `main` tracking `origin/main` |
| Sync | **0 ahead / 0 behind** `origin/main` (after fetch) |
| Working tree | **Clean** — no uncommitted changes pre-audit |
| Remote | `origin` → `git@github.com:epermitarthouse-rgb/Epermit-main.git` |
| Worktrees | Single worktree at repo root (`8739015 [main]`) |
| `AGENTS.md` | **Not present** in repo |

### Diligence cleanup commits (~8739015 area)

| Commit | Message |
|--------|---------|
| `8739015` | Remove duplicate diligence docs and prune merged worktrees. |
| `b4f90ff` | Document production URL configuration for diligence audit. |
| `739eb5a` | Remove personal developer name from diligence and audit documentation. |
| `858b2fc` | Rename person-named diligence docs and separate internal QA from client package. |

**Confirmed:** Diligence cleanup commits are present at HEAD.

---

## 3. Phase 2 — GitHub Verification

| Check | Result |
|-------|--------|
| `gh auth status` | Multiple accounts logged in |
| **Active account** | `DM1404` (keyring) — **not** the org owner account |
| Inactive accounts | `jiyanaveed`, `daniyalAMBL`, **`epermitarthouse-rgb`** |
| `gh repo view epermitarthouse-rgb/Epermit-main` | **Success** — default branch `main` |
| Remote branches (sample) | `main`, `docs/diligence-readiness`, feature branches listed |
| Git SSH to origin | **Reachable** — `HEAD` = `87390156b0ab6d46b3723a708cbd8b0ee1c708fe` |
| Tokens displayed | **No** (redacted by CLI) |

### Caution — wrong active GitHub CLI account

Git operations use SSH (`epermitarthouse-rgb` remote) and succeed. **`gh` defaults to `DM1404`**, which can cause wrong PR/issue context.

**Safe fix (optional, no repo changes):**

```bash
gh auth switch -u epermitarthouse-rgb
gh auth status   # confirm Active account: epermitarthouse-rgb
```

If SSH push fails in future:

```bash
git remote -v   # expect epermitarthouse-rgb/Epermit-main
ssh -T git@github.com   # confirm GitHub user
```

**Verdict:** Proceed with audit — origin/main reachable, correct repo. Switch `gh` active account for day-to-day GitHub CLI work.

---

## 4. Phase 3 — Supabase Verification

| Check | Result |
|-------|--------|
| CLI auth | Logged in (project list returned) |
| Linked project ref | `eeqxyjrcldivtpikcpvk` |
| Linked project name | **InsightDC** |
| Host | `https://eeqxyjrcldivtpikcpvk.supabase.co` |
| Local migrations | **126** SQL files in `supabase/migrations/` |
| `supabase migration list` | **Failed** — `403` login-role privileges; requires DB password / elevated access |
| `supabase status` (local) | Docker not running — N/A for remote audit |

**No secrets/tokens/keys printed.**

### Migration status note

Remote vs local migration parity **could not be verified read-only** due to CLI 403. Frontend hardcodes the correct ref in `src/lib/supabase.ts` (anon key present in source — known tech debt; fix branch `fix/frontend-supabase-env-config` exists unmerged).

**Verdict:** Correct Supabase project linked. Before dashboard work, an operator with dashboard access should confirm migration apply state in Supabase UI or re-auth CLI with project owner credentials.

---

## 5. Phase 4 — Railway Verification

| Check | Result |
|-------|--------|
| `railway whoami` | `daniyalzahid12@yahoo.com` |
| Workspace | **PermitPilot** |
| Project | **PermitPilot** |
| Project ID | `41f0067a-ffb7-4b15-99e0-25ed8555438f` ✓ |
| Environment | `production` |
| Linked service | `Epermit-main` |

### Services (production)

| Service | Status | URL / region |
|---------|--------|--------------|
| **Epermit-main** | ● Online | `https://epermit-main-production.up.railway.app` (US East) |
| **document-ingestion-worker** | ● Online | Background worker (US West) |

### Latest Epermit-main deployment

| Field | Value |
|-------|-------|
| Deployment ID | `ba2c4a40-f954-4e30-aad1-10cdd107d8a6` |
| Status | **SUCCESS** |
| Deployed | 2026-08-27 |

**HTTP probe:** `GET /` → **200** (reachability only).

**No env values printed.**

**Verdict:** Correct PermitPilot Railway project; both required services online.

---

## 6. Phase 5 — Vercel Verification

| Check | Result |
|-------|--------|
| `vercel whoami` | **Not authenticated** locally |
| `.vercel/project.json` | `projectName`: `epermit-frontend`, `projectId`: `prj_X8BvtDxQxRTsbmqzzjmGSTv04J7t` |
| Production URL (documented + HTTP) | `https://epermit-main-nine.vercel.app` → **200** |
| Production branch | Assumed `main` — **not verified** (CLI unauthed) |
| API base hostname (expected) | `epermit-main-production.up.railway.app` (`VITE_API_BASE_URL`) |
| Supabase ref (identity) | `eeqxyjrcldivtpikcpvk` (hardcoded in `src/lib/supabase.ts` + `.env.example` names) |

### Manual Vercel dashboard steps (if CLI login needed)

1. `vercel login` (browser OAuth).
2. `cd Epermit-main && vercel link` — confirm team/project `epermit-frontend`.
3. Vercel Dashboard → Project → **Settings → Environment Variables** — confirm **names only**: `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (values not recorded here).
4. **Deployments** tab — confirm production deployment tracks `main` and domain `epermit-main-nine.vercel.app`.

**Verdict:** Production frontend URL live; CLI auth gap is local-only.

---

## 7. Phase 6 — Existing Admin & Operations Architecture

### 7.1 Admin route inventory

All routes nested under `AdminLayout` → `useRequireAdmin` unless noted.

| Route | Purpose | Real / Mock | Backend connected | Auth | Usability today | Gap |
|-------|---------|-------------|-------------------|------|-----------------|-----|
| `/admin` | Overview: jurisdiction notifications, email branding, drip campaigns, scheduled sends, activity tab | **Real** | `jurisdiction_subscriptions`, `email_branding_settings`, `admin_activity_log`, Edge `process-scheduled-notifications` | `user_roles.admin` + RLS | **Usable** for comms ops | Not a general ops dashboard; no job queues |
| `/admin/jurisdictions` | Jurisdiction DB, fees, SLAs, contacts | **Real** | `jurisdictions` + related admin tables | Admin + RLS | **Usable** | No linkage to scraper health per jurisdiction |
| `/admin/feature-flags` | Toggle UI features | **Local only** | `localStorage` key `permitpulse_feature_flags` | Admin (UI only) | **Misleading** for ops — not server-enforced | Need server-side flags for dashboard modules |
| `/admin/shadow-mode` | AI pipeline shadow metrics, validation gates, export | **Real** | Shadow tables + Edge `shadow-*` functions | Admin + project context | **Usable** for AI QA | Separate from scrape/ingest ops |
| `/admin/architecture-replication` | Lovable→PP checklist workspace | **Real (internal)** | `architecture_replication_checklist` migration | Admin | **Internal dev tool** | Not client-facing ops |
| `/admin/uci-action-tracker` | 42-row UCI implementation matrix | **Real (internal)** | Static matrix JSON + code reconciliation | Admin | **Internal dev tracker** | Not runtime ops |
| `/admin/authorizations` | LOA / client authorizations | **Preview shell** | None (`AdminAuthorizationsPlaceholder`) | Admin | **Disabled** | PD-4: exclude or build backend |
| `/admin/members` | Platform directory, grant/revoke admin | **Real** | `profiles`, `user_roles`, RPC `admin_list_member_directory` | Admin + RLS | **Usable** (P0 shipped) | No org invite; no credential ACL |
| `/admin/audit` | Admin activity log viewer | **Partial real** | `admin_activity_log` (read-only) | Admin + RLS | **Usable** for notifications + role changes | No `access_audit_log`, invites, or credential events |

### 7.2 Operations surfaces (non-admin routes)

| Route | Purpose | Real / Mock | Backend | Auth | Usability | Gap |
|-------|---------|-------------|---------|------|-----------|-----|
| `/operations` | Operations Board (Monday-style) | **Mixed** | Real: project header, QB/UCI reimbursable summaries via `operations-real-data.ts`. Mock: scope, workflow, line items via `operations-demo-data.ts` | Any signed-in user + project context | **Partially usable** — badges label mock sections | No admin gate; workflow/scope tables missing |
| `/dashboard` → Agent Workflow | Scrape progress, durable job polling | **Real** | `scrape_jobs`, `scrape_events`, SSE `/api/progress`, Railway scraper | Project access | **Usable per project** | Not cross-project; buried in dashboard |
| `/portal-data` | Portal data viewer, job history | **Real** | `projects.portal_data`, `scrape_jobs` | Project access | **Usable** | No admin aggregate view |
| `/permit-queue` | Cross-project filing queue | **UI shell** | None (`PermitQueuePlaceholder`) | Auth | **Placeholder** | PD-8: needs scrape_jobs + permit_filings query |
| `/settings` → Portal Credentials | CRUD portal logins | **Real** | Railway `/api/portal-credentials`, `portal_credentials` RLS (own user) | Auth (self) | **Usable** | Per-user only; admin cannot manage others' creds |
| Projects → Team tab | Project invites, roles | **Real** | `project_team_members`, `project_invitations`, Edge invite | Owner/admin project role | **Usable** | Not centralized in admin |

### 7.3 Auth & RBAC model

| Layer | Mechanism | Evidence |
|-------|-----------|----------|
| Platform admin | `user_roles.role = 'admin'` (`app_role` enum: admin/moderator/user) | `20260112170034_*.sql`, `useRequireAdmin.ts` |
| Admin route guard | `AdminLayout` → `useRequireAdmin` | `src/components/admin/AdminLayout.tsx` |
| Nav visibility | `hybridNav.ts` Admin group `requiresAdmin: true` | Hidden for non-admins |
| Project RBAC | `project_team_members.role`: owner/admin/editor/viewer | `useProjectTeam.ts`, invitation RPCs |
| Tenant foundation | `tenants`, `tenant_memberships` | `20260715140000_row2_tenant_foundation.sql` — **no admin UI** |
| RLS helpers | `has_role`, `has_project_access`, `can_access_tenant` | Migrations + UCI hardening |
| Scrape jobs RLS | SELECT via `has_project_access(project_id)` | `20260620140000_scrape_jobs_and_events.sql` |
| Ingestion jobs RLS | SELECT for accessible projects | `20260606160000_document_ingestion_jobs.sql` |
| Portal credentials RLS | `auth.uid() = user_id` only | Per-user isolation |
| Backend API auth | JWT via `requireAuthenticatedUser` on QB, UCI, portal-credentials routes | `scraper-service/app/routes/*.js` |
| **Backend admin auth** | **No dedicated platform-admin middleware** on scraper routes | Admin FE gate only; service role used server-side |
| Audit | `admin_activity_log` for notifications + platform role changes | `AdminMembers.tsx`, `AdminPanel.tsx` |

### 7.4 User / access management capabilities today

| Capability | Available? | Where |
|------------|------------|-------|
| Grant/revoke platform admin | **Yes** | `/admin/members` |
| List all users + project links | **Yes** (RPC or fallback) | `/admin/members` |
| Invite org/workspace member | **No** | — |
| Invite to project | **Yes** | Project detail → Team |
| Assign project role | **Yes** | Team tab |
| Per-user feature entitlements | **No** | Feature flags = localStorage |
| Admin manage others' portal credentials | **No** | Settings is self-service only |
| Grant scraped-data ACL beyond project membership | **No** | Implicit via `has_project_access` |
| Full access audit export | **No** | Partial `admin_activity_log` only |

### 7.5 Scraper operations (Arlington durable jobs, etc.)

| Component | Status | Location |
|-----------|--------|----------|
| Durable job tables | **Production schema** | `scrape_jobs`, `scrape_events` |
| Arlington durable worker | **Running** in Epermit-main service | `arlington-durable-job.js`, background worker log in `server.js` |
| UCI durable portal sync | **Schema + service** | `20260714120000_uci_durable_portal_sync_jobs.sql`, `uci-portal-sync-job.service.js` |
| Job cancellation | **Implemented** | RPC + `scrape-job-cancellation.js` |
| Realtime subscriptions | **Enabled** | `scrape_jobs` in `supabase_realtime` publication |
| Admin job list API | **Missing** | No `/api/admin/jobs`; FE reads via Supabase per project |
| Cross-project job dashboard | **Missing** | — |

### 7.6 Document ingestion / RAG operations

| Component | Status | Location |
|-----------|--------|----------|
| Job queue table | **Production** | `document_ingestion_jobs` |
| Enqueue trigger | Edge `ingest-project-document` | Manual/automated from upload |
| Worker | **Railway** `document-ingestion-worker` Online | Poll loop in `worker.js` |
| Admin queue view | **Missing** | No `/admin/ingestion` |
| OCR for scans | **Not implemented** | Worker returns `LOW_TEXT_MSG` |
| Auto-enqueue after scrape | **Gap (PP-008)** | Manual ingest today |

### 7.7 Integration status (no secrets)

| Integration | Status surface | Backend check | Notes |
|-------------|----------------|---------------|-------|
| QuickBooks | Project billing panel, Railway `/api/quickbooks/status` | OAuth tokens in DB; JWT auth on routes | Live invoice blocked by Intuit subscription |
| Stripe | Pricing/checkout pages | Edge `create-checkout`, `stripe-webhook` | Not centralized in admin |
| Portal credentials | `/settings` | Railway CRUD, encrypted passwords | Per-user |
| Supabase Auth | `/auth` | Hosted auth | — |
| Resend (email) | Admin notifications | Edge functions | — |
| Microsoft Graph (UCI email) | Env-gated poller | `UCI_GRAPH_INBOUND_POLLER_ENABLED` | Default on in code |
| Shadow AI pipeline | `/admin/shadow-mode` | Edge shadow functions | Admin-only |

### 7.8 System config (flags, shadow mode, UCI gates)

| Config type | Where set | Admin UI? |
|-------------|-----------|-----------|
| Browser feature flags | `localStorage` | `/admin/feature-flags` (non-authoritative) |
| UCI live submission | Railway env `UCI_PEPCO_LIVE_SUBMISSION_ENABLED`, `UCI_EMAIL_LIVE_SUBMISSION_ENABLED` | **No** — ops must use Railway dashboard |
| UCI classifiers | `UCI_LLM_CLASSIFIER_ENABLED`, `UCI_CLAUDE_CLASSIFIER_ENABLED` | **No** |
| UCI document vision/OCR | `UCI_DOCUMENT_VISION_ENABLED`, `UCI_DOCUMENT_OCR_ENABLED` | **No** |
| Arlington durable jobs | Always on in production worker | **No toggle UI** |
| Shadow mode | Admin dashboard + Edge | **Yes** (`/admin/shadow-mode`) |
| Permit filing preflight | `PERMIT_FILING_PREFLIGHT_ENABLED` (Railway) | **No** |

---

## 8. Phase 7 — Minimum Dashboard Modules (Evidence-Based)

Modules derived from **PP-005**, scattered controls audit, and connectivity matrix gaps.

| Module | Rationale (evidence) | Data sources | MVP scope | Depends on |
|--------|---------------------|--------------|-----------|------------|
| **M1 — Platform health strip** | Railway/Supabase status checked manually today | HTTP `/` Railway, Supabase REST head, worker heartbeat via last `document_ingestion_jobs.updated_at` | Green/red badges, last-checked timestamp | None |
| **M2 — Scrape job monitor** | Jobs exist (`scrape_jobs`) but only per-project UI | `scrape_jobs`, `scrape_events`, Realtime | Admin table: last 50 jobs cross-project, filter by status/jurisdiction, link to project | New RPC or service-role Edge with admin check |
| **M3 — Ingestion queue monitor** | Worker online but no queue UI | `document_ingestion_jobs` | Counts by status, oldest queued, failed with error_message | Admin SELECT policy or RPC |
| **M4 — Integration health** | QB status endpoint exists; others scattered | `GET /api/quickbooks/status`, Stripe webhook last event (future), worker ping | QB connected/disconnected, last OAuth refresh age | Backend proxy with admin auth |
| **M5 — Admin activity feed** | Partial audit exists | `admin_activity_log` | Reuse `/admin/audit` widget on dashboard home | Exists |
| **M6 — Members snapshot** | P0 shipped | `admin_list_member_directory` | Count admins, recent signups, link to `/admin/members` | Exists |
| **M7 — Jurisdiction ops shortcut** | Notification ops live on `/admin` | Existing AdminPanel APIs | Embed send-notification + subscriber counts | Exists |
| **M8 — UCI / Arlington ops panel** | Durable jobs critical for pilot | `scrape_jobs` where `jurisdiction` / metadata filters | Running Arlington + UCI sync jobs, cancel action (existing RPC) | Admin auth on cancel |
| **M9 — Config flags read-only** | Env toggles invisible to admins | Railway env **names** list (manual seed) | Display gate states without values | Railway API or static doc sync |
| **M10 — Operations Board honest mode** | Mixed mock misleads (`operations-demo-data.ts`) | N/A for admin dash | Link to `/operations` with banner; or admin toggle to hide mock sections | Product decision |

**Minimum viable set for Phase A:** M1 + M2 + M3 + M4 + M5 (aggregated on new `/admin/operations` or expanded `/admin` Overview tab).

---

## 9. Phase 8 — Security Requirements for Dashboard

| Requirement | Detail |
|-------------|--------|
| **Authentication** | Supabase session required; reuse `AdminLayout` / `useRequireAdmin` |
| **Authorization** | Platform `user_roles.admin` for all dashboard routes; **do not** rely on FE-only — every new API/RPC must call `has_role(uid, 'admin')` |
| **RLS vs service role** | Cross-project job queries need `SECURITY DEFINER` RPCs (pattern: `admin_list_member_directory`) — never expose service role to browser |
| **PII minimization** | Job monitor: show user_id truncated, not emails, unless from `profiles` with admin policy |
| **Credential isolation** | Dashboard must **not** list portal credential passwords or QB tokens; status flags only |
| **Audit trail** | Log admin dashboard actions (cancel job, retry ingest) to `admin_activity_log` or future `access_audit_log` |
| **Rate limiting** | Aggregate queries can be heavy — paginate, index-backed filters, cache health checks 30–60s |
| **CSRF / session** | Railway admin proxy routes must use `requireAuthenticatedUser` + admin role check server-side |
| **Realtime subscriptions** | If using Supabase Realtime for jobs, restrict channel filters to admin-approved RPC materialized views |
| **Separation from project RBAC** | Project admin ≠ platform admin; dashboard is platform-admin only |
| **Edge Function JWT** | Any new Edge functions: avoid global `verify_jwt = false` (PP-004 audit finding) |
| **Env secrecy** | Display env **flag names and boolean state** only — never render secret values in UI |

---

## 10. Phase 9 — Connectivity Matrix (Widget / Action)

| Widget / Action | UI location (proposed) | API / table | Auth path | Status today | Blocker |
|-----------------|------------------------|-------------|-----------|--------------|---------|
| View scrape jobs (project) | Dashboard, Portal Data | Supabase `scrape_jobs` SELECT | `has_project_access` | **Connected** | Per-project only |
| View scrape jobs (all) | *Proposed* `/admin/operations` | New `admin_list_scrape_jobs` RPC | `has_role(admin)` | **Not built** | Needs RPC |
| Cancel scrape job | Agent Workflow, Portal Data | Railway cancel + RPC | Project user + ownership checks | **Connected** | Admin cross-cancel needs spec |
| View ingestion jobs (project) | Project documents hook | `document_ingestion_jobs` | Project RLS | **Connected** | — |
| View ingestion queue (all) | *Proposed* admin | New admin RPC | `has_role(admin)` | **Not built** | Needs RPC |
| Retry failed ingestion | *Proposed* | Worker poll + status reset | Admin RPC | **Not built** | Worker contract |
| QB connection status | Billing panel | `GET /api/quickbooks/status` | JWT user | **Connected** | Not admin-aggregated |
| QB status (platform) | *Proposed* admin | Same endpoint + service metadata | Admin + JWT | **Partial** | Any authenticated user today |
| Send jurisdiction notification | `/admin` | Supabase insert + Edge | Admin RLS | **Connected** | — |
| Grant platform admin | `/admin/members` | `user_roles` INSERT | Admin RLS | **Connected** | — |
| Feature flag toggle | `/admin/feature-flags` | localStorage | Admin UI only | **Disconnected** from server | By design today |
| Shadow metrics | `/admin/shadow-mode` | Shadow tables + Edge | Admin | **Connected** | — |
| Portal credentials list | `/settings` | Railway `/api/portal-credentials` | Self only | **Connected** | No admin view |
| UCI durable sync status | UCI dashboard | `scrape_jobs` + UCI services | UCI access service | **Connected** | Not aggregated |
| Operations reimbursables | `/operations` | `operations-real-data.ts` | Project | **Partial** | — |
| Operations workflow/scope | `/operations` | `operations-demo-data.ts` | N/A | **Mock only** | Schema gap |
| Permit queue | `/permit-queue` | None | — | **Disconnected** | PP-014 |
| Health check Railway | *Proposed* | `GET /` | Public | **Connected** | Shallow |
| Supabase connectivity | *Proposed* | REST ping | Anon | **Connected** | — |

---

## 11. Phase 10 — Phased Implementation Plan (A / B / C)

Estimates are **AI-assisted engineering hours** (build + test + doc), aligned with `PERMITPILOT_UPCOMING_WORK_AND_ESTIMATE.md` confidence bands.

### Phase A — Minimum Ops Dashboard (P0, ~PP-005)

**Goal:** Single admin home for job queues, integration health, and recent errors. Read-only except existing actions (cancel job if already authorized).

| Task | Optimistic (h) | Realistic (h) | Upper (h) |
|------|---------------:|--------------:|----------:|
| A1 — `/admin/operations` route + layout tab | 4 | 6 | 8 |
| A2 — `admin_list_scrape_jobs` RPC + pagination | 8 | 12 | 16 |
| A3 — `admin_list_ingestion_jobs` RPC + status counts | 6 | 10 | 14 |
| A4 — Health strip (Railway, Supabase, worker staleness) | 4 | 8 | 12 |
| A5 — QB integration status card (proxy existing endpoint) | 4 | 6 | 10 |
| A6 — Wire admin activity feed (reuse AdminAudit query) | 2 | 4 | 6 |
| A7 — Tests + RLS negative cases | 6 | 10 | 14 |
| **Phase A total** | **34** | **56** | **80** |

**Exit criteria:** Platform admin opens one page, sees cross-project scrape + ingest queues and integration health without using Railway/Supabase dashboards.

### Phase B — Operational Controls + Honest Operations Board (P1–P2)

| Task | Optimistic (h) | Realistic (h) | Upper (h) |
|------|---------------:|--------------:|----------:|
| B1 — Admin cancel/retry job actions with audit log | 8 | 16 | 24 |
| B2 — Ingestion auto-enqueue after scrape (PP-008) | 8 | 16 | 24 |
| B3 — Permit Queue wired to real jobs (PP-014) | 24 | 40 | 56 |
| B4 — Operations Board de-mock or strict empty states (PP-015) | 16 | 28 | 40 |
| B5 — Server-side feature flags (replace localStorage) | 16 | 24 | 32 |
| B6 — `access_audit_log` migration + Admin Audit expansion | 12 | 20 | 28 |
| **Phase B total** | **84** | **144** | **204** |

### Phase C — Full Operations Platform (P2–P3)

| Task | Optimistic (h) | Realistic (h) | Upper (h) |
|------|---------------:|--------------:|----------:|
| C1 — Reimbursable / scope / workflow schema (`operations-board-future-schema.md`) | 40 | 64 | 96 |
| C2 — Admin authorizations backend or nav removal (PP-018) | 4 | 12 | 24 |
| C3 — Tenant admin console (memberships, credential policy) | 32 | 56 | 80 |
| C4 — Edge Function auth hardening sweep (PP-004) | 24 | 40 | 64 |
| C5 — Staging + restore drill automation (PP-013) | 12 | 20 | 28 |
| C6 — CI: frontend tests + scraper regression on PR | 16 | 24 | 32 |
| **Phase C total** | **128** | **216** | **324** |

### Combined roadmap summary

| Phase | Realistic hours | Calendar @ 20h/wk | Calendar @ 35h/wk |
|-------|----------------:|------------------:|------------------:|
| **A** (MVP dashboard) | 56 | ~3 weeks | ~1.5 weeks |
| **A + B** | 200 | ~10 weeks | ~6 weeks |
| **A + B + C** | 416 | ~21 weeks | ~12 weeks |

---

## 12. References & Prior Art

| Document | Relevance |
|----------|-----------|
| `docs/diligence-readiness/PERMITPILOT_360_PRODUCTION_AUDIT.md` | Production snapshot, PP-005 ops dashboard gap |
| `docs/diligence-readiness/PERMITPILOT_FEATURE_CONNECTIVITY_MATRIX.md` | F-42–F-49 admin/ops status |
| `docs/diligence-readiness/PERMITPILOT_UPCOMING_WORK_AND_ESTIMATE.md` | Hour ranges PP-001–PP-023 |
| `docs/audits/admin-members-access-flow-plan.md` | Access model (partially superseded — Members now live) |
| `docs/audits/operations-board-feasibility-audit.md` | Schema gaps for `/operations` |
| `docs/audits/operations-board-future-schema.md` | Future tables for Phase C |
| `docs/diligence-readiness/DEPLOY.md` | Vercel/Railway/Supabase URL reference |
| `docs/diligence-readiness/RAILWAY_PRODUCTION_STATUS.md` | Railway health context |

### Key source files (implementation trace)

| Area | Path |
|------|------|
| Admin routes | `src/App.tsx` |
| Admin guard | `src/components/admin/AdminLayout.tsx`, `src/hooks/useRequireAdmin.ts` |
| Admin nav | `src/components/layout/hybridNav.ts` |
| Members | `src/pages/AdminMembers.tsx`, `src/hooks/useAdminMembers.ts` |
| Audit | `src/pages/AdminAudit.tsx` |
| Overview ops | `src/pages/AdminPanel.tsx` |
| Operations Board | `src/pages/OperationsBoard.tsx`, `src/lib/operations/*` |
| Scrape jobs | `supabase/migrations/20260620140000_scrape_jobs_and_events.sql`, `src/hooks/useScrapeJob.ts` |
| Ingestion | `document-ingestion-worker/worker.js`, `supabase/migrations/20260606160000_document_ingestion_jobs.sql` |
| Portal credentials | `src/components/settings/PortalCredentialsManager.tsx`, `scraper-service/app/routes/portal-credentials.routes.js` |
| RBAC | `supabase/migrations/20260112170034_*.sql`, `20260806010000_admin_members_directory.sql` |

---

*End of audit document. No code, database, deployment, or platform configuration was modified during this inspection.*
