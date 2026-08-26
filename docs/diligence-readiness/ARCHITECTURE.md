# PermitPilot Architecture

**Document date:** 2026-08-26  
**Repository:** `epermitarthouse-rgb/Epermit-main`  
**Audience:** Developer with no prior codebase access  
**Related:** `README.md`, `memory.md`, `docs/current-system-architecture.md` (2026-07-21 audit), `docs/uci-action-items-status.md`

---

## 1. System overview

PermitPilot (also branded Epermit, DesignCheck, Commun-ET) is a permit intelligence platform for architects, contractors, and owners. It combines:

- A **React SPA** for projects, portal data, AI comment workflows, permit filing, inspections, billing, and UCI
- **Supabase** for Postgres, Auth, RLS, Storage, and Deno Edge Functions
- A **Node/Express scraper service** on Railway for Playwright portal automation, UCI API, QuickBooks, and Microsoft Graph
- An optional **document ingestion worker** on Railway for PDF/DOCX chunking and embeddings

```text
┌─────────────────┐     HTTPS      ┌──────────────────┐
│  Vercel (SPA)   │ ──────────────►│ Supabase Cloud   │
│  src/ → dist/   │   Auth, DB,    │ Postgres + Auth  │
└────────┬────────┘   Storage, EF  │ + Edge Functions │
         │                          └────────▲─────────┘
         │ /api proxy or direct              │
         ▼                                   │ service role
┌─────────────────┐                          │
│ Railway         │ ─────────────────────────┘
│ scraper-service │   Playwright, UCI, QB, Graph
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Railway         │  Polls document_ingestion_jobs
│ ingestion worker│
└─────────────────┘
```

**Supabase project ref:** `eeqxyjrcldivtpikcpvk` (`supabase/config.toml`)

**Production scraper URL:** `https://epermit-main-production.up.railway.app`

---

## 2. Frontend architecture

| Aspect | Detail |
|--------|--------|
| Stack | Vite 5, React 18, TypeScript, Tailwind, shadcn/ui |
| Entry | `src/main.tsx` → `src/App.tsx` |
| Router | react-router-dom v6; routes in `App.tsx` |
| Auth | Supabase Auth; `AuthProvider`, `ProtectedRoute`, `AdminLayout` |
| Data | Direct Supabase client (`src/lib/supabase.ts`); React Query in select features |
| Scraper API | `getScraperBaseUrl()` in `src/lib/scraperBaseUrl.ts` |
| PWA | vite-plugin-pwa |

**Note:** `src/lib/supabase.ts` hardcodes Supabase URL and anon key for deployment stability. Root `.env` `VITE_SUPABASE_*` may not be used by the bundled client.

### Major frontend modules

| Module | Pages / components | Backend |
|--------|-------------------|---------|
| Projects | `Projects.tsx`, `components/projects/*` | Supabase `projects` |
| Portal harvest | `PortalDataViewer`, `ScrapeContext` | `/api/login`, `/api/scrape`, SSE progress |
| Comment AI | Comment Review, Response Matrix | Edge Functions + `parsed_comments` |
| Permit filing | `PermitWizardFiling`, permit-wizard components | Edge `permitwizard-*`, scraper routes |
| Code Analyzer | `AIComplianceAnalyzer`, codeModification libs | `/api/analyze-drawing`, Supabase analyzer tables |
| UCI | `UciDashboard`, `components/uci/*`, `uciApi.ts` | `/api/uci/*` (JWT) |
| Billing | `BillingInvoicePanel` | `/api/quickbooks/*` |
| Admin | `/admin/*` | Supabase admin tables + Edge Functions |
| Baltimore mock | `/baltimore*` | Mock UI only |

---

## 3. Railway backend (scraper-service)

| Aspect | Detail |
|--------|--------|
| Entry | `scraper-service/server.js` |
| HTTP app | `app/http-app.js` + `app/register-execution-routes.js` |
| Deploy | Docker via `scraper-service/Dockerfile`, `railway.toml` |
| Port | `process.env.PORT` (Railway-assigned) |

### Background workers (start with server)

- Arlington durable scrape worker (`scrape_jobs`)
- UCI durable portal sync worker (when `UCI_DURABLE_JOBS_ENABLED=true`)
- UCI Graph inbound poller (~45s interval, default on)
- UCI lifecycle scheduler (catch-up, QB retry, equipment check-in hour)

### Auth models

| Surface | Auth |
|---------|------|
| Scrape session APIs | Session ID |
| Portal credentials, UCI, analyze-drawing | Bearer JWT + project access |
| QuickBooks OAuth | OAuth redirects; tokens in DB |
| QuickBooks invoice trigger | **No JWT in router** (security gap) |

### Major route groups

- Scrape: login, scrape, progress SSE, export, `/view-file`
- Filing: PermitWizard, Momentum/Energov/Montgomery helpers
- `/api/quickbooks/*`, `/api/microsoft/*`
- `/api/uci/*` (40+ endpoints, `uci.routes.js`)
- `/api/analyze-drawing`, document convert

Local runtime artifacts: `scraper-service/downloads/`, `pgc-*`, debug PNGs — see `memory.md` §7.

---

## 4. Supabase

### Database

- Schema: **migration-only** `supabase/migrations/`
- Auth: `auth.users` + `public.profiles`
- Roles: `user_roles`, `has_role()`, `has_project_access()`
- Core: `projects` (includes `portal_data` JSONB), `portal_credentials`, `parsed_comments`, `scrape_jobs`
- UCI: `coordination_*`, `utility_providers`, submission/validation/transmission tables
- QuickBooks: `quickbooks_connections` (service-role only)
- Code Analyzer: runs, sheets, modification review tables (202608 migrations)

### Storage

- Primary bucket: `project-documents` (uploads from UI and scrapers)
- UCI territory datasets may use dedicated bucket when `UCI_TERRITORY_STORAGE_ENABLED`

### Edge Functions (~40+ in `supabase/functions/`)

Categories: AI agents, response generation, permit filing, Stripe billing, email/drip/reports, Mapbox/Shovels/TTS, document ingestion enqueue.

Many functions have `verify_jwt = false` in `config.toml` — intentional for webhooks/public endpoints; review before exposure.

---

## 5. PermitPilot modules (non-UCI)

| Module | Description |
|--------|-------------|
| Multi-portal scraping | DC ProjectDox, PGC ePlans, Montgomery/Howard ProjectDox, Accela (Baltimore) |
| Portal data viewer | Renders `projects.portal_data` by portal type |
| Comment intake | Edge agents parse/classify permit review comments |
| Response matrix | AI-assisted response drafting |
| Permit Wizard / Pre-Flight | DC Accela filing assistance via Edge + scraper |
| Inspections / checklists | Project checklists, scheduled email reports |
| Subscriptions | Stripe checkout + webhook Edge Functions |
| Operations board | Cross-project ops view (partial real data) |

Portal detection and scraper contracts: **`memory.md`**.

---

## 6. UCI prototype and data flow

UCI manages **utility coordination** lifecycles (stages 1–10), separate from municipal permitting.

```text
Project + project_documents (from jurisdiction scrapers)
        │
        ▼
Provider confirmation (Stage 1) → coordination_record per utility
        │
        ├── Document processing / load profile (Stage 2)
        ├── Application package builder (Stage 3)
        ├── Submission / validation / transmission (Stage 4)
        ├── Communications / ack SLA (Stage 5)
        ├── COS / design review (Stage 6)
        ├── CIAC / costs + QB passthrough (Stage 7)
        ├── Equipment (Stage 8), Meter-set (9), Closeout (10)
        └── Portal harvest + Graph inbound for evidence
```

**Runtime code:** `scraper-service/app/services/uci/*`, `src/components/uci/*`  
**Docs/specs:** `uci/`, `docs/uci-action-items-status.md`

**Synthetic vs production:** Explicit flags (`checklist_mode=synthetic_test`, env gates for live email/PEPCO submit). See `IN_FLIGHT_STATUS.md`.

---

## 7. AI Code Analyzer

| Layer | Location |
|-------|----------|
| Frontend | `src/components/compliance/AIComplianceAnalyzer.tsx`, `src/lib/codeModification/*`, `src/lib/codeAnalyzer/*` |
| Backend | `scraper-service/app/services/compliance/code-modification.service.js`, `/api/analyze-drawing` |
| Edge | `supabase/functions/analyze-drawing/index.ts` |
| DB | Migrations `20260821120000_*` through `20260824160000_*` |

Supports drawing upload, sheet discipline, index prescreen, DC Code Modification evidence pipeline, and review persistence.

**In-flight:** Local branch `feat/code-analyzer-async-v2` (not on remote); uncommitted Code Mod changes on `main`.

---

## 8. Permit filing and Pre-Flight

- UI: permit wizard under `src/components/permit-wizard/`
- Edge: `permitwizard-preflight`, `permitwizard-execute`
- Scraper: Accela automation in `accela-scraper.js`
- Requires portal credentials (encrypted with `PORTAL_CREDENTIALS_ENCRYPTION_KEY`)
- Baltimore Accela requires `projectId` on scrape for DB integrity (`memory.md`)

Status: Implemented for supported jurisdictions; live success depends on portal credentials and portal UI stability.

---

## 9. QuickBooks implementation

- OAuth: `/api/quickbooks/oauth/*`
- Milestone invoices: manual trigger from `BillingInvoicePanel` (M1 40%, M2 40%, M3 20%)
- UCI passthrough: automatic on utility cost `paid_at`
- Production: connected (`environment: production`) as of 2026-08-26 audit
- Details: `QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md`

---

## 10. External integrations

| Service | Usage |
|---------|-------|
| Intuit QuickBooks | Milestone + UCI invoicing |
| Microsoft Graph | UCI mailbox read/send (delegated OAuth) |
| Stripe | Subscriptions |
| Resend | Transactional / report email |
| OpenAI | Agents, analyzer, UCI classifier |
| Anthropic | Optional UCI classifier |
| Mapbox | Maps via Edge token function |
| Shovels | Property/permit data API |
| ElevenLabs | TTS demo |
| Playwright | All portal automation |

---

## 11. Authentication and authorization

| Layer | Mechanism |
|-------|-----------|
| End users | Supabase Auth (email/password, etc.) |
| RLS | Project owner + team membership RPCs |
| Admin | `user_roles.role = 'admin'` (FE gate; RLS/Edge must align) |
| Scraper JWT routes | `supabase.auth.getUser(token)` + project RPCs |
| Service role | Scraper + workers + Edge Functions (bypass RLS) |

---

## 12. Environment boundaries

| Environment | Frontend | Scraper | Supabase |
|-------------|----------|---------|----------|
| Local dev | `:5001` parallel or `:5000` classic | `:3002` or `:3001` | Cloud project (shared) or local if configured |
| Production | Vercel | Railway `Epermit-main` | Cloud `eeqxyjrcldivtpikcpvk` |

**Critical:** Production frontend must set `VITE_API_BASE_URL` to the live Railway host. Default in code is `epermit-main-production.up.railway.app`.

---

## 13. Manual gates, prototypes, incomplete areas

| Area | State |
|------|-------|
| UCI live PEPCO submit | Env gate off by default |
| UCI live email | Env gate + allowlists |
| Dominion production package | Blocked — synthetic test only |
| QuickBooks invoice API auth | Missing JWT gate |
| Lovable UI replication | Parallel branch; not production default |
| Baltimore / Fairfax mocks | Partial mock routes |
| Feature flags | localStorage only |
| n8n | Not used |

For UCI stage-by-stage status, use **`docs/uci-action-items-status.md`**.

---

## 14. Document map

| Need | Read |
|------|------|
| Deploy | `DEPLOY.md` |
| Environment variables | `ENV.md` |
| Backup/restore | `RESTORE.md` |
| Scraper detail | `memory.md` |
| UCI status | `docs/uci-action-items-status.md` |
