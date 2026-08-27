# PermitPilot Architecture

**Document date:** 2026-08-26  
**Branch context:** Describes `main` at `f7b5f02` unless noted  
**Index:** [README.md](./README.md)

Legend: **Verified** | **Client confirmed** | **Inferred** | **Requires manual confirmation**

---

## 1. System overview

PermitPilot is a permit-intelligence web platform: project tracking, multi-portal scraping, AI-assisted comment workflows, permit filing assistance, billing integrations, and a Utility Coordination Intelligence (UCI) prototype.

```text
┌──────────────────┐         ┌─────────────────────┐
│ Vercel (SPA)     │────────►│ Supabase Cloud      │
│ src/ → dist/     │  Auth,  │ Postgres, Auth,     │
└────────┬─────────┘  DB, EF │ Storage, Edge Fn    │
         │                   └──────────▲──────────┘
         │ /api (HTTP)                  │ service role
         ▼                              │
┌──────────────────┐───────────────────┘
│ Railway          │  Playwright scrapers, UCI API,
│ scraper-service  │  QuickBooks, Microsoft Graph
└────────┬─────────┘
         │
┌────────┴─────────┐
│ Railway          │  document_ingestion_worker
│ ingestion worker │  (polls ingestion jobs)
└──────────────────┘
```

| Component | Verified location | Hosting |
|-----------|-------------------|---------|
| Frontend | `src/` | **Client confirmed:** Vercel (private account). **Requires manual confirmation:** project linkage, production branch, domain. |
| Scraper / UCI API | `scraper-service/` | **Verified + client confirmed:** Railway `Epermit-main` |
| Database / Auth / Storage / Edge Functions | `supabase/` | **Verified:** project ref `eeqxyjrcldivtpikcpvk` in `supabase/config.toml` |
| Ingestion worker | `document-ingestion-worker/` | **Verified:** Railway service name `document-ingestion-worker` |

**Replit:** No active platform dependency — see [REPLIT_RETIREMENT_AUDIT.md](./REPLIT_RETIREMENT_AUDIT.md).

---

## 2. Frontend

| Aspect | Detail |
|--------|--------|
| Stack | Vite 5, React 18, TypeScript, Tailwind, shadcn/ui (**verified** `package.json`) |
| Entry | `src/main.tsx` → `src/App.tsx` |
| Router | `react-router-dom` v6 |
| Supabase client | `src/lib/supabase.ts` |

### Supabase configuration (important)

| State | Detail |
|-------|--------|
| **Production (`main`)** | **Verified:** URL and anonymous key are **hardcoded literals** in `src/lib/supabase.ts`. Root `.env` / Vercel values may not match bundled client behavior. This is **configuration drift** — **Medium operational/configuration risk** (not a service-role exposure). |
| **Prepared fix (not live)** | Branch `fix/frontend-supabase-env-config` (`2a5bf81`, **pushed** to `origin`): reads `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (legacy alias `VITE_SUPABASE_PUBLISHABLE_KEY`), fails fast if missing. **Unmerged; not deployed.** |
| **Vercel state** | **Client/dashboard confirmed:** variable **names** present for All Environments (`VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). **Value correctness requires confirmation** before merge. |
| **Security note** | Anonymous key is **browser-public by design**. **Verified:** no `SUPABASE_SERVICE_ROLE_KEY` in frontend `src/`. |

See [ENV.md](./ENV.md) and [TECHNICAL_REMEDIATION_BACKLOG.md](./TECHNICAL_REMEDIATION_BACKLOG.md).

### Major modules

| Module | UI | Backend |
|--------|-----|---------|
| Projects / portal | `Projects.tsx`, `PortalDataViewer` | Supabase + `/api/scrape` |
| Comment AI | Response Matrix, Comment Review | Edge Functions + `parsed_comments` |
| Code Analyzer | `AIComplianceAnalyzer`, `src/lib/codeModification/*` | Scraper + Supabase analyzer tables |
| Permit filing | `components/permit-wizard/*` | Edge `permitwizard-*`, scraper |
| UCI | `UciDashboard`, `components/uci/*` | `/api/uci/*` (JWT) — **139 route handlers verified** in `uci.routes.js` |
| Billing | `BillingInvoicePanel` | `/api/quickbooks/*` |

**Lovable reference tree:** not a runtime dependency — [LOVABLE_RETIREMENT_AUDIT.md](./LOVABLE_RETIREMENT_AUDIT.md).

---

## 3. Railway backend (`scraper-service`)

| Aspect | Detail |
|--------|--------|
| Entry | `server.js` → `app/register-execution-routes.js` |
| Deploy | Docker — `scraper-service/Dockerfile`, `railway.toml` |
| Production URL | **Verified:** `https://epermit-main-production.up.railway.app` |

Background workers (start with server): Arlington scrape jobs, optional UCI durable jobs, UCI Graph inbound poller, UCI lifecycle scheduler.

Auth: JWT for UCI and credentials; scrape sessions use session IDs. QuickBooks routes — see QuickBooks section.

---

## 4. Supabase

### Database

- **Verified:** schema from `supabase/migrations/` only
- Auth + RLS on projects, teams, UCI tables, QuickBooks connections (service-role only)

### Edge Functions

- **Verified inventory:** **51** function directories under `supabase/functions/` (each with `index.ts`, excluding `_shared`)
- `supabase/config.toml` sets `verify_jwt = false` for many functions
- **Requires security review:** whether each function validates callers in code (webhooks, Stripe, agents). Comments in config note ES256 vs platform JWT for some agents — **not verified per-function in this audit**

### Storage

- **Verified in code:** `project-documents` bucket used by uploads and scrapers

---

## 5. UCI prototype

UCI manages utility coordination (stages 1–10), separate from municipal permit filing.

| Category | Status |
|----------|--------|
| **Implemented (code)** | Stages 1–6 substantial backend + UI; partial 7–10 |
| **Synthetic / mock** | Highland Springs synthetic PDFs, Dominion synthetic checklist, dry-run validation — **verified** in code and `docs/uci-action-items-status.md` |
| **Gated (live off by default)** | PEPCO live submit, live Graph email — env flags default **false** in `.env.example` |
| **Production-validated** | **Requires manual confirmation** — not proven by code presence alone |
| **Client-team live use** | **Not ready** — real client documents and hardening not started |

Synthetic pipeline locations: [IN_FLIGHT_STATUS.md](./IN_FLIGHT_STATUS.md).

Authoritative lifecycle tracker: [docs/uci-action-items-status.md](../../uci-action-items-status.md).

---

## 6. AI Code Analyzer & Code Modification

- **Verified on `main`:** drawing upload, Code Mod evidence pipeline, analyzer migrations (202608*)
- **Active local WIP (protected):** Code Modification files deliberately uncommitted on developer machine — includes pipeline-order and final-invariant fixes; **not deployed**
- **`feat/code-analyzer-async-v2`:** **Intentionally local-only** by owner decision (~10 commits). **Not on remote. Not in production. No push/merge requested.**

---

## 7. QuickBooks

| Fact | Classification |
|------|----------------|
| OAuth + invoice code deployed on Railway | **Verified** (code on `main`, production deploy `da66200` era) |
| `/api/quickbooks/status` returned `connected: true`, `environment: production` | **Verified** read-only HTTP (2026-08-26) |
| Successful live production invoice creation | **Not verified** by this audit — status endpoint alone does not prove invoice creation |
| UCI passthrough invoicing code | **Verified** in `uci-qb-passthrough.service.js` — live success **not verified** |

Details: [QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md](./QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md).

---

## 8. External integrations

| Service | Usage | Owner |
|---------|-------|-------|
| Intuit QuickBooks | Milestone + UCI invoicing | **Requires manual confirmation** |
| Microsoft Graph | UCI mailbox | **Requires manual confirmation** |
| Stripe | Subscriptions (Edge Functions) | **Requires manual confirmation** |
| Resend | Email | **Requires manual confirmation** |
| OpenAI | Agents, analyzer, UCI classifier | **Requires manual confirmation** |
| Mapbox | Maps via Edge Function | **Requires manual confirmation** |

**Shared vault:** **Client confirmed** — secrets stored there; per-key reconciliation **requires manual confirmation** ([ENV.md](./ENV.md)).

---

## 9. In-flight / manual gates (summary)

See [IN_FLIGHT_STATUS.md](./IN_FLIGHT_STATUS.md). Key items: UCI live submission gates, Dominion production manifest blocked, QuickBooks API auth gap, Supabase frontend configuration drift on `main` (prepared fix unmerged), PWA build monitoring (not currently reproducible).

---

## 10. Related documents

| Document | Purpose |
|----------|---------|
| [DEPLOY.md](./DEPLOY.md) | Deployment |
| [ENV.md](./ENV.md) | Configuration |
| [RESTORE.md](./RESTORE.md) | Recovery |
| [memory.md](../../../memory.md) | Scraper contracts |
