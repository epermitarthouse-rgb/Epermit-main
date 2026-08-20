# PermitPilot — Current System Architecture

> Audit date: 2026-07-21  
> Source of truth: live codebase inspection (not legacy docs alone)  
> Scope: READ-ONLY architecture documentation for future Lovable UI migration comparison

---

## 1. System overview

PermitPilot (also branded Commun-ET / DesignCheck / Epermit) is a multi-tier permit intelligence platform:

| Tier | Stack | Location | Hosting |
|------|-------|----------|---------|
| Frontend SPA | Vite 5, React 18, TypeScript, Tailwind, shadcn/Radix | `src/` | **Vercel** (`vercel.json` → `dist/`, SPA rewrite) |
| Scraper / UCI API | Node/Express, Playwright Chromium, LibreOffice | `scraper-service/` | **Railway** (`scraper-service/Dockerfile`, `railway.toml`) |
| Data plane | Supabase Postgres + RLS + Auth + Storage + Edge Functions | `supabase/` | Supabase Cloud |
| Document ingestion | Node poll worker (PDF/DOCX → chunks + embeddings) | `document-ingestion-worker/` | Local/optional separate deploy |
| UCI specs | Documentation & PEPCO templates only | `uci/` | N/A (not runtime) |

**Runtime entry points:**

- Frontend: `src/main.tsx` → `src/App.tsx`
- Scraper production: `scraper-service/server.js` → `createSharedHttpApp()` + `registerExecutionRoutes(app)`
- Scraper parallel-dev: `scraper-service/parallel-dev-server.js` (port 3002) mounts same app + `/__future`
- Ingestion: `document-ingestion-worker/worker.js` (spawned via `dev.js`)

**Default local stack** (`package.json` `"dev"`): frontend parallel (:5001) + scraper parallel (:3002) + ingestion worker.

---

## 2. Frontend architecture

### 2.1 Framework & build

- **Bundler:** Vite (`vite.config.ts` classic :5000; `vite.config.parallel.ts` :5001)
- **Router:** `react-router-dom` v6 — all routes declared in `src/App.tsx`
- **UI:** Tailwind 3 + shadcn/ui (`src/components/ui/`), Lucide icons, Framer Motion, Recharts
- **Forms:** react-hook-form + zod (Auth, Settings, ProjectFormDialog); many forms use controlled state
- **Data:** Direct `@supabase/supabase-js` for most reads/writes; React Query used narrowly (Comment Review, Response Matrix, Classified Comments, AgentWorkflowStatus, ProjectHealthCard)
- **PWA:** `vite-plugin-pwa`, `InstallPrompt`, `OfflineIndicator`, Capacitor config present

### 2.2 Providers (outer → inner in `App.tsx`)

`QueryClientProvider` → `ThemeProvider` → `TooltipProvider` → `AuthProvider` → `LeadCaptureProvider` → `BrowserRouter`

Inside `DashboardLayout`: `SelectedProjectProvider` → `ScrapeProvider` → `SidebarProvider`

### 2.3 Route access model

| Class | Mechanism | File |
|-------|-----------|------|
| Public-only | `PublicOnlyRoute` redirects authed users → `/dashboard` | `src/components/auth/PublicOnlyRoute.tsx` |
| Protected | `ProtectedLayoutRoute` requires session; wraps `DashboardLayout` + `<Outlet />` | `src/components/auth/ProtectedRoute.tsx` |
| Admin | Nested under `/admin` → `AdminLayout` + `useRequireAdmin()` | `src/components/admin/AdminLayout.tsx`, `src/hooks/useRequireAdmin.ts` |
| Token public | `/portal/:token`, `/embed/:token`, `/invite/:token` | Respective pages |

Full route → page inventory: see `docs/current-page-architecture.md`.

### 2.4 Navigation & layouts

| Layout | File | Role |
|--------|------|------|
| `DashboardLayout` | `src/components/layout/DashboardLayout.tsx` | Authenticated shell: sidebar, header, scrape indicator, command palette |
| `AppSidebar` | `src/components/layout/AppSidebar.tsx` | Primary nav (role-filtered groups) |
| `MarketingLayout` | `src/components/layout/MarketingLayout.tsx` | Marketing route wrapper |
| `Layout` | `src/components/layout/Layout.tsx` | Legacy public layout (often double-wrapped with MarketingLayout) |
| `AdminLayout` | `src/components/admin/AdminLayout.tsx` | Admin gate + outlet |
| `BaltimoreLayout` | `src/components/baltimore/BaltimoreLayout.tsx` | Mock Accela clone chrome |

**Active route matching:** exact pathname equality in `AppSidebar` (`isActive(href)` → `location.pathname === href`).

### 2.5 Feature modules (frontend)

| Domain | Primary pages / components | API surface |
|--------|---------------------------|-------------|
| Projects | `Projects.tsx`, `components/projects/*` | Supabase `projects`, team RPCs |
| Portal harvest / scrape | `PortalDataViewer.tsx`, `ScrapeContext`, `AgentWorkflowStatus` | `/api/login`, `/api/scrape`, `/api/data/:sessionId`, `scrape_jobs` |
| Comment / response AI | `CommentReview`, `ResponseMatrix`, `ClassifiedComments` | Edge Functions + `parsed_comments` |
| Permit filing wizard | `PermitWizardFiling`, `components/permit-wizard/*` | Edge `permitwizard-*`, scraper `/api/permitwizard/*`, `permit_filings` |
| UCI | `UciDashboard`, `components/uci/*`, `lib/uciApi.ts` | `/api/uci/*` (JWT) |
| Credentials | `PortalCredentialsManager`, Settings | `/api/portal-credentials` (JWT) |
| Admin | Admin pages under `/admin/*` | Supabase admin tables + Edge Functions |
| Baltimore mock | `/baltimore*` | Mock UI only (comment in `App.tsx`) |

### 2.6 State management

| Store | File | Persistence |
|-------|------|-------------|
| Auth + subscription | `src/hooks/useAuth.tsx` | Supabase session; profiles poll 60s |
| Selected project | `src/contexts/SelectedProjectContext.tsx` | localStorage + `?projectId=` |
| Scrape session | `src/contexts/ScrapeContext.tsx` | In-memory + polling scraper |
| Lead capture | `src/contexts/LeadCaptureContext.tsx` | Session/local for demos |
| Feature flags | `src/hooks/useFeatureFlags.ts` | localStorage only (`permitpulse_feature_flags`) |
| Theme | `src/hooks/useTheme.tsx` | localStorage `theme-preference` (default dark) |
| Nav favorites/recent | `src/hooks/useRecentlyUsed.ts` | localStorage |

### 2.7 API clients

| Client | File | Base |
|--------|------|------|
| Supabase | `src/lib/supabase.ts` | `VITE_SUPABASE_URL` + anon key |
| Scraper base URL | `src/lib/scraperBaseUrl.ts` | `VITE_API_BASE_URL` or default Railway URL; same-origin when `VITE_SCRAPER_USE_SAME_ORIGIN=true` |
| UCI | `src/lib/uciApi.ts` | `getScraperBaseUrl()` + Bearer JWT + refresh retry |
| Portal credentials | `src/lib/portalCredentialsApi.ts` | `/api/portal-credentials` |
| Microsoft mailbox | `src/lib/microsoftMailboxApi.ts` | `/api/microsoft/*` |

### 2.8 Styling / tokens

- Tokens: `src/index.css` (HSL CSS variables), `tailwind.config.ts` (cream/obsidian/teal/gold→orange aliases)
- Fonts: Inter, Cormorant Garamond, Inter Tight, JetBrains Mono
- Charts: Recharts via `src/components/ui/chart.tsx`

### 2.9 Role-based rendering

- Admin nav & routes: `user_roles.role = 'admin'` via `useRequireAdmin` (FE-only gate; RLS/Edge re-check)
- Auth-required sidebar groups: `requiresAuth` on nav items when `user` present
- Subscription gating: demos / lead capture via `useAuth` subscription fields + `LeadCaptureProvider`

### 2.10 Duplicate / legacy UI

- `src/pages/Index.tsx` — unrouted; superseded by `LandingPage` → `CommunETLanding`
- Dual marketing layouts (`MarketingLayout` + inner `Layout`) on demos/pricing/contact/faq
- `fairfax/` components exist; only Baltimore mock routes are mounted
- Command palette stale link `/api-documentation` vs route `/api-docs`
- `components/ui/login.tsx` unused by primary `Auth.tsx` flow

---

## 3. Backend architecture

### 3.1 Scraper-service (Express)

**Bootstrap:** `server.js` → `app/http-app.js` (`cors`, JSON 50MB, static, `/view-file`) → `app/register-execution-routes.js` (monolithic orchestration) + modular routers.

**Workers started with server:**

- `startArlingtonDurableWorkerLoop()` — claims Arlington `scrape_jobs` via RPC
- `startUciDurableWorkerLoop()` — claims `job_type=uci_portal_sync` when `UCI_DURABLE_JOBS_ENABLED=true`
- `startUciGraphInboundPoller()` — polls connected Microsoft mailboxes (~45s default; disable with `UCI_GRAPH_INBOUND_POLLER_ENABLED=false`) and runs the existing Graph inbound ingest pipeline

**Auth models:**

| Surface | Auth |
|---------|------|
| Scrape session APIs (`/api/data/:sessionId`, progress SSE) | Session ID only (no JWT) |
| `/api/login` with `credentialId`, `/api/analyze-drawing` | Bearer JWT + ownership checks |
| `/api/portal-credentials`, `/api/uci/*` | Bearer JWT via `uci-access.service.js` (`supabase.auth.getUser` + project/tenant RPCs) |
| QuickBooks / Microsoft OAuth | OAuth state; tokens encrypted in DB |

**Major route groups** (see inventory JSON for full list):

- Health / static / `/view-file`
- Login, scrape, cancel, export, Accela plan-review continue/resume
- Portal credentials CRUD
- Filing (Momentum/Energov/Montgomery) + PermitWizard (DC Accela)
- Documents convert, analyze-drawing
- QuickBooks, Microsoft Graph mailbox
- UCI (`createUciRouter` in `app/routes/uci.routes.js`) — 40+ endpoints
- Parallel-dev planning stubs under `/__future/*`

**Storage:**

- Local `scraper-service/downloads/` served at `/view-file`
- Supabase Storage uploads (`shared/supabase-storage-upload.js`), bucket `project-documents`
- Territory GeoJSON under `scraper-service/data/territory/` (+ optional Storage cache)

### 3.2 Supabase Edge Functions (~51)

Categories (under `supabase/functions/`):

- AI agents (intake, comment parse, discipline, guardian, property, license, etc.)
- Response generation / export packages
- Permit filing (`permitwizard-preflight`, `permitwizard-execute`, `epermit-submit`)
- Billing (Stripe checkout, webhook, customer portal)
- Email / drip / scheduled reports / reminders
- Integrations (Shovels, Mapbox token, TTS, URL validate)
- Shadow mode evaluator/metrics
- Document ingestion enqueue (`ingest-project-document`)

Config: `supabase/config.toml` — many functions set `verify_jwt = false` (public/webhook).

### 3.3 Document ingestion worker

Flow: FE → Edge `ingest-project-document` → insert `document_ingestion_jobs` → worker polls → Storage download → chunk/embed → `project_document_chunks` + update `project_documents.ai_*`.

### 3.4 UCI module

- **Docs only:** repo-root `uci/`
- **Runtime:** `scraper-service/app/services/uci/*` + FE `UciDashboard` / `uciApi.ts`
- Lifecycle stages 1–10 with states `NOT_STARTED | IN_PROGRESS | AWAITING_UTILITY | BLOCKED | ESCALATED | COMPLETED`
- Implementation status by stage: see `docs/current-workflow-diagrams.md` (partial / blocked annotations)

### 3.5 Errors & logging

- Express JSON errors; UCI maps codes via `formatUciUserError` / `UciApiError`
- Scrape progress via SSE + `scrape_events`
- Sonner toasts on frontend

### 3.6 Env / deploy

| Concern | Key vars / files |
|---------|------------------|
| FE | `VITE_SUPABASE_*`, `VITE_API_BASE_URL`, `VITE_SCRAPER_USE_SAME_ORIGIN` |
| Scraper | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required), `PORTAL_CREDENTIALS_ENCRYPTION_KEY`, `OPENAI_API_KEY`, UCI/Arlington worker flags, MS Graph, QB |
| Deploy FE | `vercel.json` |
| Deploy scraper | `scraper-service/railway.toml` + `Dockerfile` |

**Observed URL drift:** `getScraperBaseUrl()` defaults to `https://epermit-production.up.railway.app`; workspace deploy rule references `https://epermit-main-production.up.railway.app` / service `Epermit-main`. Production must set `VITE_API_BASE_URL` explicitly.

---

## 4. AuthN / AuthZ flow

### Account creation & login

1. `Auth.tsx` → `useAuth().signUp` / `signIn` → `supabase.auth.signUp` / `signInWithPassword`
2. Trigger `handle_new_user()` creates `profiles` row
3. Session restored via `getSession()` + `onAuthStateChange` in `AuthProvider` (9s bootstrap timeout)

### Protected FE

- `ProtectedLayoutRoute` blocks unauthenticated access; redirects to `/auth`
- Admin: `useRequireAdmin` queries `user_roles` for `role = 'admin'`

### Token refresh

- Supabase client auto-refresh
- UCI: `getValidUciAccessToken` / `coordinatedRefreshSession` / `uciAuthenticatedFetch` retries on invalid JWT (`src/lib/uciApi.ts`)

### Backend authorization

- UCI/credentials: `requireAuthenticatedUser` + `assertProjectAccess` / `requireTenantProjectAccess` (`uci-access.service.js`)
- RLS helpers: `has_project_access`, `has_project_editor_access`, `has_project_admin_access`, `has_role`, tenant RPCs (`can_access_tenant`, `has_uci_row_*`)
- Credential passwords: encrypted AES-256-GCM when `PORTAL_CREDENTIALS_ENCRYPTION_KEY` set; API returns `password_configured` only (`sanitizeRow`)

### Logout

- `useAuth().signOut` + DashboardLayout clears Accela scrape session via `ScrapeContext`

### FE-only authorization risks

- Admin UI gate is not sufficient alone (must rely on RLS/Edge)
- Session-ID scrape endpoints have no JWT — possession of `sessionId` grants access

---

## 5. Request-flow maps (major workflows)

### A. Portal scrape

```
User (Portal Harvest / AgentWorkflowStatus)
  → POST /api/login (+ optional credentialId + JWT)
  → Playwright session stored in-memory
  → POST /api/scrape
  → optional durable scrape_jobs row + events
  → FE polls GET /api/data/:sessionId (and/or scrapes jobs)
  → writes projects.portal_data / downloads → Storage / scrape_file_results
```

### B. Comment review → response matrix

```
Upload / scrape comments
  → Edge agents (comment-parser, intake-pipeline, discipline-classifier)
  → parsed_comments rows
  → CommentReview / ClassifiedComments / ResponseMatrix UI
  → generate-response / generate-grounded-response
  → response_status approval (trigger enforce_parsed_comment_response_approval)
```

### C. UCI coordination

```
Select project → /uci
  → GET /api/uci/providers, provider-setup/resolution
  → POST coordination/init
  → load-profile analyze / document processing / candidates
  → applications build / review / submit (email fallback; PEPCO portal gated)
  → portal sync → scrape_jobs uci_portal_sync (+ worker if enabled)
```

### D. Document AI ingestion

```
useProjectDocuments → Edge ingest-project-document
  → document_ingestion_jobs
  → document-ingestion-worker
  → project_document_chunks + project_documents.ai_ingestion_status
```

### E. Team invite

```
InviteTeamMemberDialog → SECURITY DEFINER RPCs
  → project_invitations (hashed token)
  → /invite/:token → preview/accept/decline RPCs
  → project_team_members
```

---

## 6. Dependency / coupling analysis

Tight coupling observed:

| Coupling | Evidence |
|----------|----------|
| Hardcoded route paths in nav + command palette | `AppSidebar.tsx`, `CommandPalette.tsx` |
| Scraper default production URL | `scraperBaseUrl.ts` |
| Direct Supabase `.from(...)` in pages | Widespread (Projects, PortalDataViewer, Settings, admin) |
| Global selected project + localStorage | `SelectedProjectContext.tsx` |
| Scrape polling + session IDs in UI | `ScrapeContext.tsx` |
| UCI status/stage string literals | `uci-transitions.service.js`, FE UCI types |
| Portal credential encryption env | scraper crypto modules + Edge `_shared/portalCredentialCrypto.ts` |
| Status label maps in UI | Comment review / scrape stages / UCI stage panels |
| Monolithic scrape registration | `register-execution-routes.js` (~12k lines) |
| Stale generated types | `src/integrations/supabase/types.ts` omits newer tables |

---

## 7. Preserve-critical behavior

Must not lose (with responsible paths):

| Behavior | Code path |
|----------|-----------|
| Auth session restore + bootstrap timeout | `src/hooks/useAuth.tsx` |
| UCI JWT refresh / session-expired UX | `src/lib/uciApi.ts` (`getValidUciAccessToken`, `uciAuthenticatedFetch`, `formatUciUserError`) |
| Project access (owner + team) | RLS `has_project_access*`; UCI `assertProjectAccess` |
| Admin detection | `useRequireAdmin.ts` + `user_roles` + Edge admin checks |
| Selected project continuity | `SelectedProjectContext.tsx` |
| Scrape initiate / cancel / progress | `ScrapeContext`, `/api/login`, `/api/scrape`, session cancel routes |
| Durable scrape jobs + Arlington worker | `scrape_jobs`, `arlington-durable-worker-loop.js` |
| Terminal job statuses + retry | scrape job CHECK constraints + workers |
| Downloaded docs / file results | `scrape_file_results`, `/view-file`, Storage uploads |
| Comment parse + response approval gate | `parsed_comments` + `enforce_parsed_comment_response_approval` |
| Credential secrecy (no FE password echo) | `portal-credentials.routes.js` `sanitizeRow` + crypto |
| Server-side credential decrypt for scrapers | Edge + scraper crypto modules |
| UCI lifecycle transitions | `uci-transitions.service.js`, `/api/uci/coordination/:id/transition` |
| Provider mapping / resolution | UCI provider-resolution APIs + `coordination_records.metadata` |
| Load profile rules (JSONB, candidates) | `uci-load-profile.service.js`, `coordination_applications.load_summary` |
| Application package build/review | `uci-application-builder.service.js` |
| Submission tracking (email fallback; live PEPCO gated) | `uci-application-submit.service.js`, `UCI_PEPCO_LIVE_SUBMISSION_ENABLED` |
| Duplicate scrape file prevention | content-hash logic in scrape file results |
| Tenant isolation RPCs (when migrations applied) | `can_access_tenant`, Row 2 migrations |
| Audit / activity | `project_activity`, `audit_trail`, `admin_activity_log` |
| Document ingestion durable queue | `document_ingestion_jobs` + worker |

---

## 8. Technical risks before UI replacement (observed only)

1. **Session-ID scrape APIs without JWT** — `session-api.routes.js` `/api/data/:sessionId`, progress, cancel; anyone with ID can read/cancel.
2. **Monolithic `register-execution-routes.js`** — scrape/filing orchestration tightly coupled; UI changes that assume thin APIs may break.
3. **Default scraper URL vs Railway service name mismatch** — `src/lib/scraperBaseUrl.ts` vs deploy service `Epermit-main`.
4. **Stale `src/integrations/supabase/types.ts`** — missing UCI, scrape_jobs, portal_credentials, tenants; type-unsafe FE queries.
5. **`profiles.subscription_*` and `projects.portal_data` used in code without matching migrations in repo** — schema drift risk.
6. **UCI PEPCO live submit blocked by env** — `uci-pepco-submission.service.js` / `uci-application-submit.service.js`; email fallback only unless flag set.
7. **UCI durable worker off by default** — requires `UCI_DURABLE_JOBS_ENABLED=true`.
8. **Feature flags are localStorage-only** — `useFeatureFlags.ts`; admin page does not persist server-side flags.
9. **Double marketing layout** — visual/chrome duplication on public marketing routes.
10. **Shadow mode RLS still owner-centric** — not fully team-aware `has_project_access` pattern (from migration audit).

---

## 9. Related documents

- `docs/current-page-architecture.md` — every route/page
- `docs/current-component-architecture.md` — component map
- `docs/current-data-model.md` — tables & relationships
- `docs/current-workflow-diagrams.md` — Mermaid workflows
- `docs/current-ui-inventory.json` — machine-readable inventory
- `docs/ui-replication-constraints.md` — migration constraints

**Lovable comparison docs:** not created — `docs/lovable-*` audit files were missing at audit time.
