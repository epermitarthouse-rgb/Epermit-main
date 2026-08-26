# Documentation Cleanup Audit

**Audit date:** 2026-08-26  
**Repository:** `epermitarthouse-rgb/Epermit-main` (local path: `Epermit-main/`)  
**Scope:** Identify duplicate, overlapping, outdated, or contradictory documentation before any merge/archive/delete. **No cleanup performed.**

---

## 1. Repository instructions reviewed

| File | Role |
|------|------|
| `README.md` | Primary developer onboarding: architecture summary, local dev stacks, scraper jurisdictions, Supabase CLI pointer |
| `memory.md` | Engineering handbook: scraper contracts, portal types, runtime artifacts, Edge Function deploy notes |
| **No `AGENTS.md`** | Not present in repository |

**Authoritative for day-to-day engineering:** `README.md` + `memory.md` (complementary: README = run locally; memory = scraper/ops detail).

---

## 2. Existing documentation inventory

### 2.1 Architecture and system design

| Path | Last-known focus | Notes |
|------|------------------|-------|
| `docs/current-system-architecture.md` | 2026-07-21 codebase audit | Broad, verified-from-code architecture; FE/BE/Supabase/UCI/QB |
| `docs/current-page-architecture.md` | Route → page inventory | Frontend routing reference |
| `docs/current-component-architecture.md` | Component inventory | UI structure |
| `docs/current-data-model.md` | Schema summary | Data model overview |
| `docs/current-workflow-diagrams.md` | Workflow diagrams | Includes partial/blocked annotations |
| `docs/data-provenance.md` | Data lineage | Provenance notes |
| `uci/UCI_ARCHITECTURE.md` | UCI module boundaries | UCI-specific; references CET doc ID |
| `uci/UCI_ARCHITECTURE_ADR_HYBRID_FOUNDATION_FIRST.md` | ADR | UCI foundation decisions |
| `reference/lovable-ui/lovable-permitpilot-architecture-matrix.md` | Lovable migration matrix | Reference only, not production runtime |
| `reference/lovable-ui/architecture-inventory.md` | Lovable inventory | Reference only |
| `src/data/architectureReplicationMatrix.json` | Machine-readable matrix | UI replication tracking |

### 2.2 Deployment and environment

| Path | Role |
|------|------|
| `README.md` | Local dev only; no production deploy runbook |
| `vercel.json` | Frontend build/output/SPA rewrite config |
| `scraper-service/railway.toml` | Railway Docker build config |
| `scraper-service/Dockerfile` | Scraper production container |
| `scraper-service/.env.example` | Scraper + QB + UCI + MS Graph env template |
| `document-ingestion-worker/.env.example` | Ingestion worker env template |
| `supabase/config.toml` | Supabase project ref + function JWT settings |
| `memory.md` §8 | Edge Function deploy commands (partial) |
| `docs/lovable-ui-development-environment.md` | Lovable dev environment | Migration-era |
| `docs/audits/scheduled-reports-deploy-checklist.md` | Scheduled reports deploy checklist | Feature-specific |

**Gap:** No single authoritative `DEPLOY.md`, `ENV.md`, or `RESTORE.md` existed before this diligence pass.

### 2.3 Backup / restore / runbook / handover

| Path | Role |
|------|------|
| `memory.md` | Runtime artifacts; no backup/restore procedure |
| `docs/uci-action-items-status.md` § Operations | Mentions DR/retention as **blocked client dependency** |
| `reference/lovable-ui/stitch-reference/.../integrated_handoff_lovable_vercel_supabase.md` | Historical Lovable handoff | Not current production source |
| `reference/lovable-ui/stitch-reference/.../permitpilot_ux_v3_final_handover_summary.md` | UX handoff summary | Design reference |

**Gap:** No verified backup/restore runbook in repository.

### 2.4 PermitPilot / UCI status reports

| Path | Role |
|------|------|
| `docs/uci-action-items-status.md` | **Primary UCI lifecycle tracker** (updated 2026-08-19) |
| `uci/uci_module_audit_checklist.md` | UCI module audit checklist |
| `uci/UCI_DELIVERY_ROADMAP.md` | Delivery roadmap |
| `uci/UCI_COMPLIANCE_CHECKLIST.md` | Compliance checklist |
| `uci/UCI_EXECUTION_HISTORY.md` | Execution history |
| `uci/UCI_All_Implementation_Phases.md` | Phase breakdown |
| `uci/uci_execution_sprints_and_phases.md` | Sprint history |
| `uci/README.md` | UCI folder index |
| `docs/uci-builder-backend-capability-audit.md` | Backend capability audit |
| `docs/uci-navigation-and-workspace-replication-plan.md` | Navigation replication plan |

### 2.5 QuickBooks

| Path | Role |
|------|------|
| `scraper-service/.env.example` | QB OAuth env vars (comments only) |
| `scraper-service/app/routes/quickbooks.routes.js` | Implementation (not documentation) |
| `reference/lovable-ui/stitch-reference/.../admin_quickbooks_client_invoicing/code.html` | Lovable mock UI | Not implementation |
| `docs/current-system-architecture.md` §3 | Brief QB mention in architecture audit |

**Gap:** No end-to-end QuickBooks walkthrough document existed.

### 2.6 Platform configuration files

| Platform | Config location |
|----------|-----------------|
| **Railway** | `scraper-service/railway.toml`, `scraper-service/Dockerfile`; linked service `Epermit-main` + `document-ingestion-worker` |
| **Vercel** | `vercel.json` (repo root) |
| **Supabase** | `supabase/config.toml`, `supabase/migrations/`, `supabase/functions/` |
| **Replit** | **No `.replit`, `replit.nix`, or runtime Replit config found**; local git branch `replit-agent` only |

### 2.7 Lovable UI migration docs (large overlapping set)

| Path | Overlap with |
|------|--------------|
| `docs/lovable-ui-audit.md` | `reference/lovable-ui/docs/lovable-ui-audit.md` (duplicate copy) |
| `docs/lovable-page-architecture.md` | `reference/lovable-ui/docs/lovable-page-architecture.md` |
| `docs/lovable-design-system.md` | `reference/lovable-ui/docs/lovable-design-system.md` |
| `docs/lovable-component-architecture.md` | `reference/lovable-ui/docs/lovable-component-architecture.md` |
| `docs/lovable-ui-full-gap-and-replication-plan.md` | `docs/lovable-vs-current-gap-analysis.md`, `docs/ui-replication-plan.md` |
| `docs/lovable-ui-implementation-audit.md` | `docs/audits/main-functional-features-and-ui-migration-audit.md` |

### 2.8 Feature-specific audits (`docs/audits/`)

25+ audit/plan documents covering scrapers, response matrix, operations board, permit wizard, UCI PEPCO download, scheduled reports, etc. These are **point-in-time audits**, not operational runbooks.

---

## 3. Overlap analysis

### 3.1 Architecture (high overlap)

| Cluster | Files | Overlap |
|---------|-------|---------|
| **PermitPilot system architecture** | `docs/current-system-architecture.md`, `README.md`, `memory.md` | All three describe tiers (Vite/React, Supabase, scraper). README is shortest; memory is scraper-deep; current-system-architecture is the most complete single audit. |
| **UCI architecture** | `uci/UCI_ARCHITECTURE.md`, `docs/current-system-architecture.md` §3.4, `docs/uci-action-items-status.md`, `uci/UCI_ARCHITECTURE_ADR_HYBRID_FOUNDATION_FIRST.md` | UCI_ARCHITECTURE = module design; action-items = status; ADR = decisions; current-system-architecture = snapshot audit. |
| **Frontend architecture** | `docs/current-page-architecture.md`, `docs/current-component-architecture.md`, Lovable docs | Lovable docs describe target/reference UI; current-* describe live app. |

### 3.2 UCI status (moderate overlap)

| Authoritative for lifecycle status | Supporting |
|-----------------------------------|------------|
| `docs/uci-action-items-status.md` | `uci/UCI_DELIVERY_ROADMAP.md`, `uci/UCI_COMPLIANCE_CHECKLIST.md`, `uci/uci_module_audit_checklist.md`, `src/data/uciActionTracker.json` |

The JSON tracker and multiple UCI markdown files restate stage/status information with different formats and update cadences.

### 3.3 Deployment (fragmented)

Deploy knowledge is split across `README.md`, `memory.md`, `vercel.json`, `railway.toml`, feature checklists, and `.env.example` files. No consolidated deploy or env inventory existed.

### 3.4 Lovable reference duplication

`docs/lovable-*.md` and `reference/lovable-ui/docs/lovable-*.md` contain near-identical content (reference tree is a frozen Lovable export).

---

## 4. Authoritative source recommendations

| Topic | Authoritative file | Why |
|-------|-------------------|-----|
| Local development | `README.md` | Official npm scripts and port layout |
| Scraper behavior & contracts | `memory.md` | Maintained engineering handbook |
| Live architecture audit (pre-diligence) | `docs/current-system-architecture.md` | Codebase-verified, dated 2026-07-21 |
| UCI lifecycle status | `docs/uci-action-items-status.md` | Most recently updated (2026-08-19), stage-by-stage |
| UCI module design | `uci/UCI_ARCHITECTURE.md` | Canonical UCI boundaries and adapter model |
| Schema source of truth | `supabase/migrations/` | Not any markdown data model doc |
| **Diligence-ready ops docs (new)** | `docs/diligence-readiness/ARCHITECTURE.md`, `DEPLOY.md`, `RESTORE.md`, `ENV.md` | Created 2026-08-26 for handover; supersede fragmented deploy/restore gaps |

---

## 5. Contradictions and outdated items

| Issue | Evidence | Impact |
|-------|----------|--------|
| Scraper default URL drift | `docs/current-system-architecture.md` notes `getScraperBaseUrl()` dead-host handling; `src/lib/scraperBaseUrl.ts` defaults to `epermit-main-production.up.railway.app` | Stale Vercel `VITE_API_BASE_URL` can break FE→scraper routing |
| Supabase client config | `src/lib/supabase.ts` hardcodes URL/anon key; `.env` also defines `VITE_SUPABASE_*` | Two configuration paths; `.env` may be ignored by FE |
| `docs/current-system-architecture.md` audit date | 2026-07-21 | Missing Code Analyzer async v2, recent UCI migrations, Aug 2026 main commits |
| Lovable docs vs live app | Multiple lovable-* docs describe target UI | Risk of treating design reference as implemented behavior |
| UCI "Complete" vs production deploy | action-items distinguishes code-complete from production-deployed | Readers must not conflate |

---

## 6. Recommended future cleanup (not performed)

| Action | Files | Rationale |
|--------|-------|-----------|
| **Archive** | `reference/lovable-ui/docs/lovable-*.md` duplicates of `docs/lovable-*.md` | Eliminate twin copies; keep `reference/` as read-only export with pointer |
| **Merge** | UCI status: `uciActionTracker.json` → derive from or link to `docs/uci-action-items-status.md` | Single lifecycle source |
| **Update** | `docs/current-system-architecture.md` | Refresh audit date or add pointer to `docs/diligence-readiness/ARCHITECTURE.md` |
| **Archive** | `replit-agent` branch (after review) | Last commit 2026-03-15; no Replit runtime config in repo |
| **Do not delete** | `memory.md`, `README.md`, `docs/uci-action-items-status.md` | Active engineering references |
| **Add pointer** | Root `README.md` → `docs/diligence-readiness/` | Route new operators to diligence bundle |

---

## 7. New diligence deliverables (this pass)

All new files live under `docs/diligence-readiness/` and do not overwrite existing docs:

- `DOCUMENTATION_CLEANUP_AUDIT.md` (this file)
- `REPOSITORY_AND_ACCOUNT_INVENTORY.md`
- `RAILWAY_PRODUCTION_STATUS.md`
- `IN_FLIGHT_STATUS.md`
- `TECHNICAL_EFFORT_ESTIMATES.md`
- `QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md`
- `ARCHITECTURE.md`
- `DEPLOY.md`
- `RESTORE.md`
- `ENV.md`
