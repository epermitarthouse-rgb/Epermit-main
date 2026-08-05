# Audit: Permit Filing pre-flight, list visibility, jurisdictions

Date: 2026-08-04  
Scope: report-only investigation of Permit Filing create/list/pre-flight and jurisdiction sources.

## 1. Pre-flight — intended vs current

### Intended (product / UI contract)

- Layer 1 of the 9-agent pipeline (`PermitWizardFiling.tsx` `LAYER_LABELS` / `AGENT_CONFIG`).
- Agents **01–04** validate readiness before portal submission; agent **05** is the human review gate; Layers 2–3 are execute + monitor.
- Status machine: `preflight` → `awaiting_approval` → (human approve) → `approved` / `filing` → `submitted` (or `failed` / `cancelled`).
- Migrations: `supabase/migrations/20260307000003_permit_wizard_tables.sql`.

### Current implementation

| Step | What happens |
|------|----------------|
| Create | `StartFilingDialog.handleStartPreflight` inserts `permit_filings` with `filing_status: 'preflight'`, optional `filing_professionals` / `filing_documents`, then invokes `permitwizard-preflight`. |
| Orchestrator | `supabase/functions/permitwizard-preflight/index.ts` runs **01** property-intelligence → **02+03** parallel (license + documents) → **04** permit-classifier. |
| Outcome | Builds `approval_package`; sets status to `awaiting_approval` (success), stays `preflight` (partial agent failure), or `failed` (license hard stop). |
| Not in preflight | Agent **05** (UI / `FilingReviewPanel`), **06–08** (`permitwizard-execute` + scraper), **09** status monitor. |
| Invoke errors | Preflight invoke failures are swallowed (`console.warn`); toast still says pipeline started. |

## 2. Why new filings may not appear

### A. Schema missing (primary environment blocker)

- Live Supabase may not have `permit_filings` until Permit Wizard migrations are applied (`20260307000003`, plus `20260307000004`, `20260308000002`).
- FE maps `PGRST205` / schema-cache errors via `src/lib/permitFilingErrors.ts` → “Permit filing storage is not set up…”.
- If create fails on insert, nothing is stored; list also errors with the same helper.

**Migrations required for visibility in that environment.**

### B. List query + UI gates (code)

List query (`PermitWizardFiling.fetchFilings`):

```ts
.from("permit_filings").select("*").eq("user_id", user.id)
// + .eq("project_id", selectedProjectId) when a project is selected
```

UI only renders the filing queue when **`selectedProjectId` is set** and `filings.length > 0`. Empty-state “Get Started” only when `!selectedProjectId && filings.length === 0`. So:

- Filings for another project are hidden by the `project_id` filter.
- With no project selected, even if rows load for the user, the queue UI does not render (gap between empty state and list).

Create-mode sets `selectedProjectId` via `onProjectCreated` **before** the filing insert finishes; `onFilingStarted` then refetches. A stale `selectedProjectId` in `fetchFilings` / race between empty and successful fetches can briefly (or persistently, under race) show an empty queue.

`handleFilingStarted` also reads stale `filings` from closure after `fetchFilings()` — selection of the new id can fail even when refetch succeeded (`fetchFilings` itself usually selects `data[0]`).

### C. RLS (only after tables exist)

- `permit_filings` SELECT/INSERT require `user_id = auth.uid()`. Create sets `user_id: user.id`. Not the usual cause if the same user created the row; org/tenant sharing is not in these policies.

## 3. Jurisdiction sources — Permit Filing vs New Project

| Surface | Source | Shape |
|---------|--------|--------|
| Permit Filing municipality picker | `municipality_configs` (`is_active = true`), else hardcoded 10-muni `FALLBACK_MUNICIPALITIES` in `StartFilingDialog` / `PermitWizardFiling` | Portal filing targets (`municipality_key`, portal_type Accela/Momentum/ASP.NET/EnerGov). Seeded in `20260307000004_multi_municipality_support.sql` (~10 DMV portals). |
| New Project (Projects form) | `jurisdictions` via `JurisdictionLookup` → fee/SLA metadata | Broad research DB (thousands of names/states); free-text name stored on `projects.jurisdiction`. |
| Start Filing “New Project” jurisdiction field | Plain `<Input>` free text — **not** `JurisdictionLookup` | Optional string on `createProject`; separate from filing municipality. |

**Why they differ:** different domains. `municipality_configs` = automation-capable portal endpoints; `jurisdictions` = coverage/fee/SLA catalog. They are not joined in the filing create UI.
