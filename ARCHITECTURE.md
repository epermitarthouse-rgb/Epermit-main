# Epermit (PermitPilot / DesignCheck) — Architecture

**Document version:** 1.0  
**Scope:** Full project architecture including every major and minor detail.

---

## 1. Overview

- **Product name:** Epermit (also referenced as PermitPilot, DesignCheck, Insight|DesignCheck).
- **Purpose:** Permit intelligence platform: jurisdiction lookup, project management, portal scraping (Accela and other portals), compliance checking, inspections, checklists, response packages, and permit filing workflows.
- **Deployment:** Frontend (Vite/React) and Scraper API (Express) run separately; frontend proxies `/api` and `/view-file` to the scraper. Supabase provides auth, Postgres, RLS, storage, and edge functions.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  React 18 + Vite  (port 5000 dev)                                       │  │
│  │  • React Router  • TanStack Query  • Supabase JS (anon)  • PWA          │  │
│  │  • AuthProvider, SelectedProjectProvider, ScrapeProvider, LeadCapture  │  │
│  │  • DashboardLayout → AppSidebar, MobileBottomNav, CommandPalette        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
         │                                    │
         │ /api/*, /view-file/* (proxy)       │ REST + Realtime
         ▼                                    ▼
┌────────────────────────────┐    ┌────────────────────────────────────────────┐
│  Scraper Service (Node)     │    │  Supabase                                  │
│  Express, port 3001        │    │  • Auth (email/password)                   │
│  • Playwright Chromium     │    │  • Postgres (projects, portal_credentials, │
│  • Accela scraper          │    │    profiles, parsed_comments, inspections, │
│  • Baltimore-specific      │    │    etc.)                                   │
│  • Permit Wizard / Filing  │    │  • RLS on all tables                      │
│  • Momentum / Montgomery /  │    │  • Storage (exports, attachments, etc.)   │
│    Energov scrapers        │    │  • Edge Functions (46+)                   │
│  • Hash + portal_data sync │    │  • Realtime (optional)                    │
└────────────────────────────┘    └────────────────────────────────────────────┘
```

---

## 3. Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, TypeScript, Vite 5, react-router-dom 6, TanStack React Query 5 |
| **UI** | Tailwind CSS, Radix UI (accordion, dialog, dropdown, tabs, etc.), Lucide icons, Framer Motion, Recharts, next-themes |
| **Forms & validation** | react-hook-form, @hookform/resolvers, Zod |
| **Backend (scraper)** | Node.js, Express 5, Playwright (Chromium), dotenv, ExcelJS, Supabase JS (service role) |
| **Database & Auth** | Supabase (Postgres, Auth, RLS, Storage, Edge Functions) |
| **PDF / export** | jspdf, jspdf-autotable, pdf-lib, pdfjs-dist |
| **PWA** | vite-plugin-pwa (Workbox), Capacitor (optional) |
| **Maps** | Mapbox GL |
| **Other** | date-fns, sonner (toast), cmdk (command palette), qrcode.react, openai (server-side agents) |

---

## 4. Repository Structure

```
Epermit-main/
├── src/                          # Frontend source
│   ├── main.tsx                  # Entry: HelmetProvider → App
│   ├── App.tsx                   # Providers + React Router routes
│   ├── index.css                 # Global + Tailwind
│   ├── components/               # React components
│   │   ├── ui/                   # shadcn-style primitives (button, card, dialog, etc.)
│   │   ├── layout/               # DashboardLayout, AppSidebar, MarketingLayout, MobileBottomNav
│   │   ├── auth/                 # ProtectedRoute, PublicOnlyRoute, login
│   │   ├── admin/                # AdminLayout, AdminPanel, JurisdictionAdmin, FeatureFlagsAdmin, ShadowModeDashboard
│   │   ├── baltimore/            # Baltimore portal UI: BaltimorePortalDataView, BaltimoreLayout, BaltimoreNav, BaltimoreRecordTabBar, etc.
│   │   ├── portal/               # AccelaProjectView (generic Accela portal_data display)
│   │   ├── compliance/           # AIComplianceAnalyzer
│   │   ├── inspections/          # InspectionCalendar, SignaturePad, ChecklistPhotoUpload, etc.
│   │   ├── dashboard/            # DeadlineAlertsWidget, RecentChecklistsWidget, etc.
│   │   ├── projects/             # ProjectFormDialog, DeleteProjectDialog, KanbanColumn, etc.
│   │   ├── checklists/           # EmailBrandingDialog, ReportDeliveryHistory, etc.
│   │   ├── navigation/           # CommandPalette
│   │   ├── pwa/                  # InstallPrompt, OfflineIndicator
│   │   └── ...
│   ├── contexts/                 # React context providers
│   │   ├── ScrapeContext.tsx     # Scrape overlay, session, progress, cancel
│   │   ├── SelectedProjectContext.tsx  # selectedProjectId, sync with URL & localStorage
│   │   └── LeadCaptureContext.tsx
│   ├── hooks/                    # useAuth, useProjects, useScrape, useProjectPortalData, useInspections, etc.
│   ├── pages/                    # Route-level components (Dashboard, Projects, PortalDataViewer, Baltimore*, etc.)
│   ├── lib/                      # supabase.ts, portalView.ts (isBaltimorePortal), combinedChecklistPDF, etc.
│   └── types/                    # epermit.ts, analytics.ts, team.ts, activity.ts
├── scraper-service/
│   ├── server.js                 # Express app, all /api routes, browser launch
│   ├── accela-scraper.js         # Accela login, record search, extraction (header, details, status, plan review, etc.), Baltimore-specific logic
│   ├── permitwizard-auth.js     # Permit Wizard session (Accela)
│   ├── permitwizard-filer.js     # Permit Wizard file step
│   ├── permitwizard-submit.js    # Permit Wizard submit
│   ├── momentum-auth.js          # Momentum portal auth
│   ├── momentum-filer.js / momentum-submit.js
│   ├── montgomery-auth.js        # Montgomery portal auth
│   ├── montgomery-filer.js / montgomery-submit.js
│   ├── energov-auth.js / energov-filer.js / energov-submit.js
│   ├── .env                      # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, optional Chromium paths
│   ├── debug/                    # Checkpoint screenshots (after_plan_review, etc.)
│   └── downloads/                # Scraper downloads (attachments, etc.)
├── supabase/
│   ├── migrations/               # 55+ SQL migrations (order matters)
│   └── functions/                # 46+ edge functions (comment-parser-agent, analyze-drawing, etc.)
├── public/                       # Static assets, PWA icons, robots.txt
├── .env                          # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_BASE_URL
├── vite.config.ts                # Port 5000, proxy /api and /view-file to 3001, PWA, alias @
├── package.json                  # Scripts: dev (concurrently frontend + scraper), build, dev:frontend, dev:scraper
└── memory.md                     # Project memory (session summaries, no secrets)
```

---

## 5. Frontend (React / Vite)

### 5.1 Entry and Shell

- **main.tsx:** Creates root, wraps in `HelmetProvider`, renders `App`. Logs Supabase URL/key presence (DEV).
- **App.tsx:**  
  - **Providers (outer → inner):** `QueryClientProvider` → `ThemeProvider` → `TooltipProvider` → `AuthProvider` → `LeadCaptureProvider`.  
  - **Global UI:** `Toaster`, `Sonner`, `OfflineIndicator`, `InstallPrompt`, `LeadCaptureModal`.  
  - **Router:** `BrowserRouter` → `Routes`.  
  - **Public routes:** `/` (LandingPage, PublicOnlyRoute), `/auth`, `/demos`, `/pricing`, `/contact`, `/faq`, `/install`, `/portal/:token`, `/embed/:token`.  
  - **Protected routes:** Wrapped in `ProtectedLayoutRoute` (auth required, `DashboardLayout`). Paths: `/dashboard`, `/projects`, `/analytics`, `/jurisdictions/*`, `/permit-intelligence`, `/code-compliance`, `/code-reference`, `/roi-calculator`, `/consolidation-calculator`, `/admin` (nested: index, jurisdictions, feature-flags, shadow-mode), `/mvp-documentation`, `/api-docs`, `/checklist-history`, `/settings`, `/comment-review`, `/response-matrix`, `/classified-comments`, `/portal-data`, `/permit-wizard-filing`, `/baltimore`, `/baltimore/permits`, `/baltimore/records`, `/baltimore/records/:recordId`.  
  - **Catch-all:** `*` → `NotFound`.

### 5.2 Auth and Layout

- **useAuth:** Context: `user`, `session`, `loading`, `subscription`, `signUp`, `signIn`, `signOut`, `checkSubscription`. Uses Supabase Auth; subscription read from `profiles` (subscription_tier, subscription_status, subscription_end).
- **ProtectedRoute / ProtectedLayoutRoute:** If loading → spinner. If !user → `Navigate` to `/auth` with `state.from`. Otherwise render children or `Outlet` inside `DashboardLayout`.
- **DashboardLayout:** Wraps with `SidebarProvider`, `SelectedProjectProvider`, `ScrapeProvider`. Renders `AppSidebar`, main content area with `ActiveProjectBadge`, `ScrapeHeaderIndicator`, `CommandPalette`, `FloatingHelpWidget`, `MobileBottomNav`, `NotificationBell`, `ThemeToggle`. Children rendered inside `DashboardContent`.

### 5.3 Key Contexts

- **SelectedProjectContext:** `selectedProjectId`, `setSelectedProjectId`. Persists per user in localStorage (`epermit:selectedProjectId:${userId}`) and syncs `?projectId=` URL param. Used by header badge and portal-data view.
- **ScrapeContext:** `isScraping`, `scrapeOverlay` (phase, stepText, progress, total, projectNum, completedSteps, currentStepKey), `scrapeMinimized`, `activeSessionId`, `startScrapeSession`, `cancelScrape`, `cleanupScrapeState`, `onScrapeCompleteRef`, `pendingCompletionProjectId`, `lastScrapeOutcome`. Persists active session in localStorage (`scrape_active_session`). Polls `/api/progress/:sessionId`; on complete calls ref and clears overlay.

### 5.4 Portal Data and Baltimore

- **PortalDataViewer (page):** Loads project and credential; fetches `portal_data` from project or from scrape result. Decides view: if Accela + Baltimore credential (`isBaltimorePortal(cred)`) → `BaltimorePortalDataView`, else → `AccelaProjectView`. Passes `portalData`, `projectId`, `permitNumber`, `credentialLoginUrl`. Can trigger scrape (ScrapeContext) and refresh.
- **isBaltimorePortal (lib/portalView.ts):** True when credential `login_url` contains `/BALTIMORE` or jurisdiction is Baltimore with accela.com.
- **BaltimorePortalDataView:** Renders tabs: Record Details, Processing Status, Related Records, Attachments, Inspections, Fees/Payments, Plan Review. Uses `portalData.tabs.info`, `tabs.status`, `tabs.relatedRecords`, `tabs.attachments`, `tabs.inspections`, `tabs.payments`, `tabs.reports`. Plan Review: if `tabs.reports.planReviewSummary?.rawFields` present shows summary key/value list; else shows `reports.pdfs[].comments`; else "No plan review data."
- **AccelaProjectView:** Generic Accela portal_data display (tables, keyValues, screenshots).

### 5.5 Vite Config

- **Server:** host `::`, port 5000, proxy `/api` and `/view-file` to `http://127.0.0.1:3001`.
- **Alias:** `@` → `src`.
- **PWA:** vite-plugin-pwa, registerType autoUpdate, manifest (name, short_name, icons, screenshots), Workbox: NetworkFirst for `/api` and Supabase REST, CacheFirst for fonts and images.
- **Build:** rollupOptions for pdf.worker asset naming; optimizeDeps exclude pdfjs-dist.

---

## 6. Scraper Service (Node / Express)

### 6.1 Server Entry and Browser

- **server.js:** dotenv, Express, cors, express.json(50mb), static for `public` and `/view-file` → downloads. Single browser launch path: `launchChromiumForScraper({ label, route, file })` → `chromium.launch({ headless: true })`. No custom executablePath by default. Startup: run Playwright diagnostic, then `app.listen(PORT)` (default 3001).
- **Hash:** `stableStringify(obj)` (keys sorted recursively) + SHA-256 → `hashPortalData(data)`. Used to skip DB write when `portal_data_hash` equals new hash.

### 6.2 API Routes (Summary)

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/` | Health / info |
| GET | `/api/progress/:sessionId` | Scrape progress (session message, etc.) |
| POST | `/api/login` | Accela login; creates session; returns sessionId |
| POST | `/api/scrape` | Start Accela scrape (permitNumber, supabaseProjectId, userId, etc.); runs scrapeAccelaRecord, syncs portal_data to Supabase |
| POST | `/api/scrape/cancel/:sessionId` | Cancel scrape |
| POST | `/api/logout/:sessionId` | Logout and close browser session |
| GET | `/api/data/:sessionId` | Get session data (e.g. portalData) |
| GET | `/api/export/:sessionId` | Export session to Excel |
| POST | `/api/analyze-drawing` | Analyze drawing (Playwright + upload) |
| POST | `/api/permitwizard/login` | Permit Wizard login |
| GET | `/api/permitwizard/session/:sessionToken` | Get PW session |
| POST | `/api/permitwizard/reauth` | Reauth PW |
| POST | `/api/permitwizard/logout` | PW logout |
| GET | `/api/permitwizard/sessions/count` | Active PW sessions count |
| GET | `/api/permitwizard/wizard-steps` | Wizard steps config |
| POST | `/api/permitwizard/file` | PW file step |
| POST | `/api/permitwizard/submit` | PW submit |
| POST | `/api/filing/login` | Filing login (Montgomery/Energov/Momentum) |
| GET | `/api/filing/session/:token` | Filing session |
| POST | `/api/filing/file` | Filing file step |
| POST | `/api/filing/submit` | Filing submit |
| POST | `/api/filing/logout` | Filing logout |
| POST | `/api/filing/reauth` | Filing reauth |

### 6.3 Accela Scraper (accela-scraper.js)

- **Exports:** `accelaLogin`, `scrapeAccelaRecord`.
- **Flow:** Login (frame detection, credential form, wait for post-login), navigate to record search, open record detail, set `page._recordFrame` for extraction context, then extract in order: record header, record details, processing status, plan review, related records, attachments (with optional download), inspections, payments. Builds `portalData` (portalType, name, projectNum, description, location, dashboardStatus, tabs.info, tabs.status, tabs.reports, tabs.attachments, tabs.inspections, tabs.payments, tabs.relatedRecords). For Baltimore: `page._isBaltimore` set from portalUrl; `schemaVersion: 2`; `tabs.reports.planReviewSummary` from Plan Review summary extractor; hash + force-overwrite for legacy rows.
- **Navigation:** `expandRecordInfoDropdown`, `expandPaymentsDropdown` (with wait for submenu visibility when Baltimore); `clickAccelaNavPanel` uses `findPanelLinkMultiContext` (ctx → main frame → other frames) when Baltimore. Panel load wait + log for Baltimore.
- **Extractors:** `extractRecordHeader`, `extractRecordDetails` (tables + Baltimore div/span .pil-subsection-title/.value), `extractProcessingStatus`, `extractPlanReview` (Baltimore: `extractPlanReviewSummaryBaltimore` only, scoped to Plan Review Status container; non-Baltimore: table-based comments), `extractRelatedRecords`, `extractAttachments`, `extractInspections`, `extractPayments`. Each uses `getExtractionContext(page)` (record frame or page).
- **Persistence:** If Supabase and userId: compute `newHash = hashPortalData(portalData)`; load existing row by supabaseProjectId or (permit_number, user_id); if Baltimore load portal_data too; if legacy Baltimore (no schemaVersion or < 2) force overwrite; else if hash match skip write and only update last_checked_at; else update or insert project with portal_data and portal_data_hash.

### 6.4 Other Scrapers

- **Permit Wizard:** permitwizard-auth (Accela session), permitwizard-filer (file step), permitwizard-submit (submit).
- **Filing (Montgomery, Energov, Momentum):** Separate auth/filer/submit modules per portal; routes under `/api/filing/*`.

---

## 7. Database (Supabase Postgres)

### 7.1 Core Tables

- **auth.users:** Supabase Auth (email/password, etc.).
- **profiles:** user_id (FK auth.users), full_name, company_name, job_title, phone, updated_at; subscription_tier, subscription_status, subscription_end. RLS: own row. Trigger: create profile on user signup.
- **projects:** id, user_id, name, address, city, state, zip_code, jurisdiction, project_type, status, description, estimated_value, square_footage, permit_number, submitted_at, approved_at, deadline, notes, created_at, updated_at; portal_status, last_checked_at; portal_data (JSONB), portal_data_hash; credential_id (FK portal_credentials). RLS: view/create/update/delete own (or accessible via project_team_members). Indexes: user_id, status, created_at.
- **portal_credentials:** id, user_id, jurisdiction, portal_username, portal_password, permit_number, project_address, login_url, project_id (optional). RLS: own rows.
- **project_documents:** project_id, file metadata. RLS: accessible projects.
- **project_team_members:** project_id, user_id, role. RLS: accessible projects. Enables team access to projects/documents.
- **project_invitations:** project_id, email, token, etc.
- **parsed_comments:** project_id, source, comments JSONB, response_matrix, etc. RLS: own projects.
- **inspections:** project_id, type, status, date, etc. RLS: accessible projects.
- **punch_list_items:** project_id, inspection_id, etc.
- **saved_inspection_checklists:** project_id, template_id, data JSONB.
- **inspection_checklist_templates:** name, jurisdiction, config.
- **project_activity:** project_id, type, payload. RLS: accessible projects.
- **shadow_predictions, baseline_actions, audit_trail:** Shadow mode (project_id, predictions/actions/audit). RLS: own projects.
- **jurisdictions:** jurisdiction data.
- **plan_markups, architect_profiles:** Plan markup feature.
- **response_package_drafts, company_branding:** Response package and branding.
- **permit_filings, agent_runs, property_intelligence, license_validations, filing_documents, filing_screenshots, filing_professionals:** Permit Wizard / filing.
- **epermit_submissions:** project_id, status, payload.
- **scheduled_checklist_reports, scheduled_report_delivery_logs, email_branding_settings:** Reports and email.
- **comment_quality_checks, coverage_requests, user_drip_campaigns, jurisdiction_subscriptions, jurisdiction_notifications:** Comments and notifications.
- **admin_activity_log, user_roles:** Admin.
- **municipality_configs:** Multi-municipality.

### 7.2 Migrations (Order)

Migrations run in filename order (timestamped). Key ones: profiles/projects/saved_calculations → project_documents → portal_credentials → projects portal_status/last_checked_at → login_url → portal_data_hash → credential_id → parsed_comments → inspections/shadow/plan_markups/response_package_drafts/permit_wizard/filing tables → indexes, etc.

### 7.3 Edge Functions (Supabase Functions)

46+ functions, e.g.: comment-parser-agent, analyze-drawing, parse-permit-comments, discipline-classifier-agent, permit-classifier-agent, document-preparation-agent, guardian-quality-agent, validate-completeness-agent, license-validation-agent, auto-router-agent, intake-pipeline-agent, shadow-evaluator, permit-status-monitor, check-portal-status, send-checklist-report, process-scheduled-checklist-reports, send-contact-email, stripe-webhook, create-checkout, get-mapbox-token, export-weekly-report, epermit-submit, shovels-api, fetch-permit-data, send-inspection-reminders, send-deadline-reminders, etc. Invoked via Supabase client or HTTP.

---

## 8. Data Flow (Key Flows)

### 8.1 Auth

- User signs in via Auth page → Supabase Auth signIn → session stored; AuthProvider exposes user/session.
- Subscription: AuthProvider checks profiles.subscription_* for current user.

### 8.2 Projects and Portal Data

- Projects list: useProjects (or similar) → Supabase from("projects").select() with RLS.
- Selected project: SelectedProjectContext holds selectedProjectId; persisted to URL and localStorage.
- Portal data: Project row has portal_data (JSONB) and portal_data_hash. Fetched when opening PortalDataViewer; also written by scraper after scrape.

### 8.3 Scrape Flow

- User has portal_credentials (e.g. Baltimore Accela) and a project with permit_number.
- Frontend: POST /api/login with credential and login_url → scraper logs into portal, returns sessionId.
- Frontend: POST /api/scrape with sessionId, permitNumber, supabaseProjectId, userId, etc. ScrapeContext starts overlay, polls /api/progress/:sessionId.
- Scraper: Runs scrapeAccelaRecord (search permit → open record → extract all sections → build portalData). If Supabase: hash portalData; load existing project row; if hash match and not force-overwrite → skip write; else update or insert project (portal_data, portal_data_hash, last_checked_at, portal_status).
- Scraper returns; frontend completes overlay, calls onScrapeCompleteRef (e.g. refetch project); user sees updated portal_data on PortalDataViewer.

### 8.4 Portal View Selection

- PortalDataViewer loads project and credential. If credential is Baltimore Accela (isBaltimorePortal(cred)) → render BaltimorePortalDataView with project’s portal_data; else AccelaProjectView. Baltimore view uses tabs.reports.planReviewSummary when present (summary fields); otherwise reports.pdfs comments.

---

## 9. Configuration and Environment

### 9.1 Frontend (.env)

- **VITE_SUPABASE_URL:** Supabase project URL.
- **VITE_SUPABASE_ANON_KEY:** Supabase anon key (public).
- **VITE_API_BASE_URL:** Scraper base URL (e.g. `http://127.0.0.1:3001` or production host). Used by ScrapeContext and any direct API calls.

### 9.2 Scraper (.env)

- **SUPABASE_URL:** Same Supabase project URL.
- **SUPABASE_SERVICE_ROLE_KEY:** Service role key (bypass RLS for portal_data write).
- **PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH / CHROMIUM_PATH:** Optional; used if set for Chromium binary (e.g. Nix).

### 9.3 Supabase Client (Frontend)

- **lib/supabase.ts:** createClient(SUPABASE_URL, SUPABASE_ANON_KEY). URL/key can be hardcoded or from import.meta.env; same project as above.

---

## 10. PWA and Offline

- **vite-plugin-pwa:** Service worker with Workbox; autoUpdate. Manifest: name, short_name, icons, screenshots, theme_color, scope `/`.
- **Runtime:** InstallPrompt component; OfflineIndicator. Caches: fonts (CacheFirst), /api (NetworkFirst), Supabase REST (NetworkFirst), images (CacheFirst).

---

## 11. Security (Summary)

- **Auth:** Supabase Auth; protected routes require user.
- **RLS:** All application tables use RLS; policies are user-scoped or project-access scoped (via project_team_members).
- **Secrets:** Anon key in frontend; service role only in scraper and edge functions. No secrets in memory.md or ARCHITECTURE.md.
- **API:** Scraper runs server-side; no credential sent to browser except as needed for display (e.g. credential id or masked). Login and scrape use server-side Supabase service role.

---

## 12. Deployment Notes

- **Frontend:** Build with `vite build`; static output; can be served by any static host (e.g. Vercel). Set VITE_API_BASE_URL to production scraper URL.
- **Scraper:** Run `node server.js` (or npm start) on port 3001; ensure Playwright Chromium installed (`npx playwright install chromium`). Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
- **Supabase:** Migrations applied via Supabase CLI or dashboard; edge functions deployed separately. Database and auth and storage in one project.

---

## 13. Document Index (Related Docs)

- **memory.md:** Session memory, no secrets.
- **BALTIMORE_SCRAPER_COMPLETENESS_DIAGNOSIS.md:** Baltimore extraction diagnosis.
- **BALTIMORE_PLAN_REVIEW_DIAGNOSIS.md:** Plan Review extraction/persistence diagnosis.
- **BALTIMORE_COMPREHENSIVE_FIX_IMPLEMENTATION.md:** Baltimore fix implementation summary.
- **BALTIMORE_SCRAPER_FIXES_IMPLEMENTED.md:** Earlier Baltimore scraper fixes.
- **REPO_CLEANUP_AUDIT.md:** Cleanup audit (optional deletions).

This file (ARCHITECTURE.md) is the single place for full system architecture and minor implementation details as of the last update.
