# Operations Board Feasibility Audit

**Date:** 2026-08-04  
**Type:** Plan / report only — no code changes, no migrations, no mock seeding, no Lovable fixture copy.  
**Repo:** `epermitarthouse-rgb/Epermit-main`  
**Lovable reference:** `reference/lovable-ui` (proposed UI only; data is fabricated).

---

## Executive verdict

PermitPilot **cannot** ship a faithful Monday-style Operations Board from existing schema alone. Lovable `/operations` is a **static mock** (hardcoded Langston Blvd + Rockville Pike reimbursables, scope lines, and PM workflow groups). PermitPilot has **no** `/operations` route, **no** reimbursable line-item table, **no** scope/pricing line table, and **no** PM task / critical-path / dependency domain.

What *does* exist is useful for a **partial, honest** board:

| Domain | Closest PP asset | Fit for Lovable tab |
|--------|------------------|---------------------|
| Project shell / selection / RLS | `projects`, `SelectedProjectContext`, `has_project_access`, tenants | High — reuse |
| Aggregate reimbursables / billing | `projects.reimbursement_*`, `contract_value`, QB M1–M3 | Partial — project rollup only, not line items |
| Utility cost lines | `coordination_costs` (+ `uci-costs.service.js`) | Partial — UCI-scoped only |
| Milestone invoices | QB trigger + `BillingInvoicePanel` | Related finance, not Ops Board rows |
| PM workflow / CP | None (UCI milestones / filings / comments are different domains) | **No honest mapping** |

**Architecture recommendation: mixed** — reuse project + tenant + billing aggregates + UCI costs where fields truly match; **do not** fabricate Monday rows from unrelated tables; introduce **new line-item entities only after product approval** for Reimbursables and Scope; defer full PM Workflow until a task domain exists.

---

## 1. Existing route and UI coverage

### 1.1 `/operations` and Operations Board in PermitPilot

| Check | Result | Evidence |
|-------|--------|----------|
| Route `/operations` | **Absent** | `src/App.tsx` has no OperationsBoard import/route; catch-all `*` → `NotFound` |
| Page component | **Absent** | No `src/pages/OperationsBoard.tsx` |
| Sidebar nav item | **Absent** | `src/components/layout/hybridNav.ts` Delivery group = Permit Filing, Response Matrix, Portal Harvest only |
| Page title map | **Absent** | `pageTitles` in `hybridNav.ts` has no `/operations` |
| Prior product stance | Exclude / defer | `docs/lovable-vs-current-gap-analysis.md` (`lovable_mock_only`, exclude v1); `docs/lovable-ui-frontend-implementation-plan.md` (`exclude_due_to_confusion_or_duplication`); matrix L021 defer |

**Equivalents (functional, not visual):**

| Need | Closest PP surface | Why not equivalent |
|------|-------------------|--------------------|
| Reimbursables tracking | Project form billing fields + `BillingInvoicePanel` | Aggregate `$` + QB milestones, not per-fee lines |
| Utility fee lines | UCI costs (`coordination_costs`) | Utility coordination only |
| Scope & pricing | Marketing `/pricing`; project `contract_value` / `service_type` | SaaS pricing page ≠ project scope WBS |
| PM workflow / CP | None; Lovable `/critical-path` also mock | Demo routes list `/critical-path` as fabricated; no PP route |
| “Auto-reconcile with AI” (Lovable CTA → `/matrix/ai-workflow`) | Response Matrix + intake agents | Comment reconciliation ≠ expense/scope reconciliation; `/matrix/ai-workflow` is demo-fabricated in PP |

### 1.2 Shell, active project, permissions, demo handling

| Concern | Existing behavior | Paths |
|---------|-------------------|-------|
| Auth shell | `ProtectedLayoutRoute` → `DashboardLayout` | `src/components/auth/ProtectedRoute.tsx` |
| Hybrid nav | Lovable group labels + PP hrefs | `src/components/layout/hybridNav.ts` |
| Active project | `SelectedProjectContext` — URL `?projectId=`, localStorage `epermit:selectedProjectId:{userId}` | `src/contexts/SelectedProjectContext.tsx` |
| Active project UI | Sidebar/header `ActiveProjectControl` | `src/components/layout/ActiveProjectControl.tsx` |
| Resolve project | `useResolvedProjectId` (URL overrides sidebar) | `src/hooks/useResolvedProjectId.ts` |
| Empty project | Pattern: banner / empty copy (“Select a project…”) on Portal Harvest, Response Matrix, etc. | e.g. `PortalDataViewer.tsx`, `ResponseMatrix.tsx` |
| Permissions | Auth required for Delivery; admin group `requiresAdmin`; project RLS via `has_project_access` | migrations + `useAuth` / admin hooks |
| Demo-route handling | `/operations` is listed as **fabricated prefix** | `src/components/permitpilot/demo-routes.ts` (`FABRICATED_PREFIXES`); provenance in `docs/data-provenance.md` |
| Demo badge | `isDemoRoute` + `DemoDataBadge` | Used for fabricated surfaces; if a **real** board ships, `/operations` must be removed from fabricated list |

### 1.3 Reusable UI building blocks (patterns exist; no Ops Board)

| Capability | Exists in PP? | Examples |
|------------|---------------|----------|
| KPI / Stat cards | Yes | `src/components/design/ProductPrimitives.tsx` (`StatCard`); admin architecture replication; Shadow Mode |
| Tabs | Yes | shadcn `tabs` used widely |
| Filters / search | Yes | Search inputs; `SearchableCombobox`; admin filtered tables |
| Searchable tables | Partial | Native `<table>` + shadcn `Table`; no dedicated Ops DataTable |
| Grouped / collapsible rows | Partial | Comment plan grouping; collapsible UI; not Monday groups |
| Editable statuses | Yes (other domains) | Response Matrix status/approval; UCI stage state — **not** Ops statuses |
| Drawers / modals | Yes | Dialog/Sheet patterns; `BillingInvoicePanel` dialog |
| CSV export | Yes | `AnalyticsExport.tsx`, Shadow Mode, architecture replication `exportRowsToCsv` |
| Audit history UI | Partial | `project_activity` feeds; admin audit placeholders (`/admin/audit` coming soon); shadow `audit_trail` |
| Loading / empty / error | Yes | Standard patterns across Portal / RM / Projects |

**Lovable Ops Board UI behaviors (mock only)** — `reference/lovable-ui/src/pages/OperationsBoard.tsx`:

- Tabs: Reimbursables | Scope & Pricing | PM Workflow  
- KPI row: Reimbursables tracked, Invoiced line items, Scope hours, Critical-path tasks  
- Search (client filter), Filter/Person/Export CSV buttons (**non-functional**), New item (**non-functional**)  
- Grouped reimbursables by project name; workflow groups with expand/collapse + subitems  
- Hardcoded title “RBD-L/C 450011 · NSN 445-4834 Langston Blvd”  
- Optional `?project=` query display only (does not load data)  
- “Auto-reconcile with AI” → `/matrix/ai-workflow` (also mock in Lovable)

---

## 2. Existing backend and schema coverage

**Rule applied:** Do **not** assume Lovable tables should be created. Candidates below are real PP migrations/code only. Lovable has no Ops Board schema in `reference/lovable-ui/supabase/migrations` for reimbursables/scope/tasks (only unrelated access audit etc.).

### 2.1 Candidate inventory

#### A. `projects` (core)

| | |
|--|--|
| **Migration** | `supabase/migrations/20260113050946_a5cc5cac-5d4a-4bcd-a0ad-b1be05aa204a.sql` (+ billing `20260506120000_project_billing_fields.sql`, costs `20260113063025_…`, QB `20260505120000_quickbooks_oauth_foundation.sql`, tenant `20260715140000_row2_tenant_foundation.sql`) |
| **Name** | `public.projects` |
| **Relevant fields** | `id`, `user_id`, `tenant_id?`, `name`, `permit_number`, `status`, `permit_fee`, `expeditor_cost`, `total_cost`, `client_name`, `client_email`, `service_type`, `contract_value`, `reimbursement_amount`, `reimbursement_description`, `m1/m2/m3_triggered*`, `qb_customer_id`, `qb_invoice_id_m1/m2/m3`, address/jurisdiction, etc. |
| **Tenant model** | Owner `user_id` + optional `tenant_id`; team via `project_team_members`; RLS evolved in `20260727120000_projects_rls_restore_owner_select.sql` |
| **Project relationship** | Root entity |
| **Reuse directly for Ops Board?** | **Partial** — header, client, aggregate reimbursement, contract value, QB invoice IDs |
| **Schema gap** | No line items; single reimbursement blob; no per-item invoice/payment/progress |

#### B. Project billing / QuickBooks (aggregate finance)

| | |
|--|--|
| **Migration** | `20260506120000_project_billing_fields.sql`, `20260505120000_quickbooks_oauth_foundation.sql` |
| **Tables** | `projects` columns above; `quickbooks_connections` |
| **BE** | `scraper-service/app/routes/quickbooks.routes.js` (`POST /invoice/trigger`); `qb-invoice-trigger.service.js`; `qb-invoice-payload.js` |
| **FE** | `src/components/projects/BillingInvoicePanel.tsx`; `ProjectFormDialog.tsx`; `useProjects.ts` |
| **Reuse?** | **Yes for rollups / invoice trigger UX**; **No** for reimbursable *rows* |
| **Gap** | Milestone invoices (M1–M3 %) ≠ Monday reimbursable ledger |

#### C. `coordination_costs` (UCI utility costs)

| | |
|--|--|
| **Migration** | `supabase/migrations/20260509120000_uci_foundation.sql` |
| **Fields** | `id`, `coordination_record_id`, `project_id`, `cost_type`, `estimated_amount`, `actual_amount`, `variance_pct`, `invoice_received_doc_ref`, `paid_at`, `payment_method`, `client_billed_at`, `quickbooks_invoice_id`, `notes`, timestamps |
| **Tenant** | Via project / UCI row helpers (`has_project_access` / Row 2 UCI) |
| **Project relationship** | FK to `projects` + composite FK to `coordination_records` |
| **BE** | `scraper-service/app/services/uci/uci-costs.service.js` |
| **Reuse?** | **Partial** — closest real *line* cost model; only for utility coordination |
| **Gap** | Missing Lovable fields: item label separate from cost_type, date logged, permit no., team (IS/GC), invoiced enum, invoice # freeform, payment enum, progress %. Not for building/health/FedEx permit fees |

#### D. `coordination_milestones`

| | |
|--|--|
| **Migration** | same UCI foundation |
| **Fields** | `milestone_type`, `parent_stage`, `target_date`, `actual_date`, `status` (`pending`/`scheduled`/`completed`/`missed`), `notes` |
| **Reuse for PM Workflow?** | **No as Monday CP board** — UCI-stage milestones only; no groups, owners, CP/NCP, subitems, dependencies |
| **Gap** | Entire PM WBS domain |

#### E. `staff_assignments`

| | |
|--|--|
| **Migration** | `20260113063025_0911d8e6-acf0-44fb-b29b-e000919517fd.sql` |
| **Fields** | `project_id`, `user_id`, `assigned_at`, `completed_at`, `hours_worked`, `notes` |
| **Reuse?** | **Weak** — hours aggregate only; no scope line name/price/date needed |
| **Gap** | Not scope & pricing lines; FE usage sparse per `docs/current-data-model.md` |

#### F. Tasks / workflow tasks / critical path

| Candidate | Exists? |
|-----------|---------|
| `project_tasks` / `workflow_tasks` / CP tables | **No** |
| Lovable Critical Path page | Mock only (`reference/lovable-ui/src/pages/CriticalPath.tsx`); PP has no route |
| Proxy: `permit_filings` + `agent_runs` | Filing pipeline status — different product job |
| Proxy: `parsed_comments` + `assigned_to` | Comment response workflow — different job |
| Proxy: `project_pipeline_runs` / `scrape_jobs` | Automation jobs — not PM tasks |

**Verdict:** No reusable PM Workflow entity. Fabricating CP from filings/comments would violate “no fabricated mappings.”

#### G. Comments / attachments / audit

| Table | Migration / notes | Ops Board reuse |
|-------|-------------------|-----------------|
| `parsed_comments` | Response Matrix domain | **No** for Ops tabs; **pattern reuse** for Phase D review-before-apply |
| `project_documents` | `20260113051524_…` | Attachments for future expense receipts — not wired to Ops |
| `project_activity` | `20260113055633_…` — activity_type enum (docs/uploads/team/inspections/comments) | Audit feed pattern; **no** billing/expense activity types today |
| `audit_trail` / `admin_activity_log` | Shadow / admin | Not Ops Board history |
| Lovable `access_audit_log` | `reference/lovable-ui/supabase/migrations/…` only | **Proposed / reference** — not PP Ops |

#### H. Invoices / payments / expenses / pricing scope lines

| Concept | PP reality |
|---------|------------|
| Expense / reimbursable **lines** | **Missing** |
| Invoice header/lines table | **Missing** (QB IDs on project + UCI cost QB id) |
| Payments ledger | **Missing** (`paid_at` on UCI costs only) |
| Permit fee catalog lines | Jurisdiction fee metadata / `projects.permit_fee` scalar — not a ledger |
| Scope & pricing lines | **Missing** |
| Admin Invoicing (Lovable) | Fabricated (`docs/data-provenance.md`); not a PP production route |

#### I. Tenant / org ownership

| Asset | Path | Notes |
|-------|------|-------|
| `tenants`, `tenant_memberships` | `20260715140000_row2_tenant_foundation.sql` | Roles: owner/admin/member/viewer; demo isolation helpers |
| Propagation | `20260715140100_row2_tenant_backfill.sql`, `20260715140200_row2_tenant_propagation.sql` | Staged; nullable `tenant_id` still possible |
| Project team | `project_team_members`, `has_project_access` | Primary access for project-scoped reads |
| Platform admin | `user_roles` | Admin nav / cross-cutting |

Any future Ops tables **must** be `project_id`-scoped with `has_project_access` (and tenant-aware policies if Row 2 is required).

### 2.2 Summary: reuse vs gap

| Lovable concept | Reuse directly? | Gap |
|-----------------|-----------------|-----|
| Reimbursable rows | No | Need line-item entity **or** accept UCI-only + project aggregate |
| Scope & pricing rows | No | Need scope lines (+ hours/price) |
| PM workflow groups/tasks/CP | No | Need task domain |
| KPIs | Partially calculable only after data exists | See §3 |
| Project header | Yes | `projects` |
| CSV / filters / shell | Yes (FE patterns) | Wire to real queries |

---

## 3. Real data availability

### 3.1 Per tab

#### Reimbursables

| Source | What you can show today | Honesty note |
|--------|-------------------------|--------------|
| `projects.reimbursement_amount` / `reimbursement_description` | Single project rollup | Not N line items |
| `projects.permit_fee` / `expeditor_cost` / `total_cost` | Scalars | Not a ledger; often unset |
| QB `qb_invoice_id_m*` + triggered flags | Whether milestone invoices exist | Not per reimbursable row invoice # |
| `coordination_costs` | Utility cost lines with amounts / paid / billed / QB id | Only if UCI records exist; not Monday permit-fee board |
| Lovable Langston/Rockville fixtures | **Do not use** | Fabricated |

**Conclusion:** Tab can be **empty or sparse** for most projects. A full Monday reimbursables table is **not** backed.

#### Scope & Pricing

| Source | Available? |
|--------|------------|
| Scope line items (name, hours, unit price, date needed) | **No table** |
| Client name/email | Yes on `projects` (repeat per row would be denormalized UI only) |
| `contract_value` / `service_type` | Project-level only |
| `staff_assignments.hours_worked` | Hours without scope item semantics |

**Conclusion:** Tab has **no real row data**. Honest empty state only until schema exists.

#### PM Workflow

| Source | Available? |
|--------|------------|
| Grouped CP/NCP tasks, owners, Done/Working/Stuck, subitems, dependsOn | **No** |
| UCI milestones / stages | Real but different product surface (UCI dashboard) |
| Filing / agent / scrape statuses | Real automation — not PM WBS |

**Conclusion:** **Cannot** populate from real data without inventing a task model. Do not map filings→CP.

### 3.2 Per Lovable KPI

| KPI (Lovable) | Calculable from real PP data today? | Honest formula / null |
|---------------|-------------------------------------|------------------------|
| **Reimbursables tracked** (count) | **Only if** you redefine as (a) `1` when `reimbursement_amount > 0`, or (b) `count(coordination_costs)` for active project | **Not** Lovable’s item count. Prefer: show UCI cost count + flag project-level reimbursement separately; else **null / 0 with empty state** |
| **Invoiced line items** | **No** for reimbursable lines. Partial: count of non-null `qb_invoice_id_m*` (0–3) or `coordination_costs` with `quickbooks_invoice_id` / `client_billed_at` | Do not label QB milestones as “invoiced line items” without copy change |
| **Scope hours** | **No** (no scope lines). Weak proxy: `sum(staff_assignments.hours_worked)` — **not** scope hours | Prefer **null** until scope entity exists |
| **Critical-path tasks** | **No** | Prefer **null** / hide KPI until task domain exists |

---

## 4. Architecture decision

### Recommendation: **mixed**

1. **Reuse**  
   - Active project selection, shell, auth, RLS helpers  
   - Project header fields (`name`, `permit_number`, client, contract, reimbursement aggregate)  
   - Optional UCI `coordination_costs` as a **labeled subset** (“Utility costs”) — never as fake full reimbursables  
   - FE primitives: StatCard, tabs, CSV helpers, empty/loading patterns  
   - QB / `BillingInvoicePanel` as linked finance action, not as the board itself  

2. **Extend (after approval — schema required)**  
   - `project_reimbursable_items` (or equivalent) for true reimbursable ledger  
   - `project_scope_lines` for scope & pricing  
   - Optional link columns to QB invoice ids / `project_documents` receipts  

3. **New entities (later phase)**  
   - PM workflow: groups, tasks, CP flag, status, owner, dependencies, subitems — **only if** product decides PermitPilot owns Monday replacement  

4. **Do not**  
   - Copy Lovable fixtures or seed Langston/Rockville  
   - Map `parsed_comments` / scrape jobs → CP tasks  
   - Treat `contract_value` as sum of scope lines without a real table  
   - Ship UI that looks live while badges claim Real data  

### Why mixed (not “reuse only” or “all new”)

- Reuse-only cannot fill Scope or PM tabs honestly.  
- All-new would duplicate project, tenant, QB, and UCI cost concepts.  
- Mixed preserves PP finance/UCI truth and isolates the real schema gaps.

---

## 5. Project selection and tenant isolation

### 5.1 Active project flow (existing)

1. User selects project in shell → `setSelectedProjectId`  
2. Persisted to localStorage + `?projectId=` URL sync  
3. Pages read `useSelectedProject()` / `useResolvedProjectId()`  
4. Queries filter `.eq('id' | 'project_id', selectedId)` under RLS  

**Ops Board should follow the same contract** (not Lovable’s decorative `?project=`).

### 5.2 How `/operations` should load

| State | Behavior |
|-------|----------|
| No auth | Redirect `/auth` via `ProtectedLayoutRoute` |
| Auth, no project | Empty state: “Select a project in the sidebar” (same copy pattern as Portal/RM) — **no demo rows** |
| Auth + project | Load project row; load any real subsets (billing fields, optional `coordination_costs`) |
| Project change | Re-fetch; reset tab local UI state |
| Cross-tenant | Enforced by RLS + `can_access_tenant` / project access — UI must not bypass with service role from client |
| Client / viewer | Read-only if role is viewer (mirror project team roles); mutations later for editor/admin |
| Staff / admin | Platform admin ≠ automatic access to all projects unless existing admin policies allow; prefer project membership |
| Demo tenant | Keep demo isolation; never show prod project finance across demo boundary |

### 5.3 Role / RLS patterns to copy

- `has_project_access(auth.uid(), project_id)` — default for project-scoped tables  
- Tenant helpers from Row 2 foundation when `tenant_id` set  
- Response Matrix approval pattern: elevate mutations (e.g. financial write) to owner/admin  
- QB tokens: **service role only** (`quickbooks_connections`) — never expose tokens to Ops Board FE  

---

## 6. Phased plan

### Phase A — Read-only board (honest)

- Add authenticated `/operations` + Delivery nav item (or admin_preview until data depth exists)  
- Remove from `demo-routes` / provenance **only when** data is real; until then keep Demo badge **or** ship behind feature flag with explicit “partial data” copy  
- KPI row: show only metrics with real definitions; hide or “—” for Scope hours / CP  
- Tabs:  
  - Reimbursables: project reimbursement summary + optional UCI costs table  
  - Scope: empty state explaining no scope lines yet  
  - Workflow: empty state or deep-link to UCI / Permit Filing / Response Matrix as *related* work — **not** fake Monday groups  
- CSV export of whatever real rows are shown  

### Phase B — Controls

- Search/filter on loaded rows  
- Group by project (single active project → group by cost_type / permit_number when present)  
- Column visibility; link out to Billing panel / UCI cost editor  
- Role-aware disable of edit affordances  

### Phase C — Mutations (requires schema for full parity)

- CRUD reimbursable lines (new table)  
- CRUD scope lines (new table)  
- Status edits with `project_activity` (extend activity_type or metadata)  
- Optional QB linkage per line (careful; don’t break M1–M3 trigger invariants)  

### Phase D — AI reconciliation (real use case)

**Not** Lovable’s fake “Auto-reconcile → AiWorkflow.”

| | |
|--|--|
| **Real use case** | Propose reimbursable/scope line drafts from portal fee text, uploaded invoices/receipts (`project_documents`), or UCI cost variance — operator reviews before apply |
| **Inputs** | Active `project_id`; document text/OCR or portal fee snippets; existing `coordination_costs`; current reimbursable/scope rows |
| **Outputs** | Proposed row patches (create/update/link invoice #) — stored as draft proposals, not silent writes |
| **Review-before-apply** | Same UX discipline as Response Matrix: draft → human approve → persist (`response_status` / `approved_at` pattern in `ResponseMatrix.tsx` + DB trigger) |
| **Response Matrix reuse?** | **Pattern reuse only** (approval workflow, agent run status, empty/error). **Do not** overload `parsed_comments` for expenses. Separate proposal table or JSON draft on project. See also `docs/audits/response-matrix-reconciliation-proposal.md` (comment-cycle reconciliation — different domain) |

---

## 7. Output inventory

### 7.1 Existing FE files (relevant)

| Path | Role |
|------|------|
| `src/App.tsx` | Routes — **no** `/operations` |
| `src/components/layout/hybridNav.ts` | Sidebar IA |
| `src/contexts/SelectedProjectContext.tsx` | Active project |
| `src/components/layout/ActiveProjectControl.tsx` | Selector UI |
| `src/hooks/useResolvedProjectId.ts` | URL/sidebar resolve |
| `src/hooks/useProjects.ts` | Project + billing fields |
| `src/types/project.ts` | Billing field types |
| `src/components/projects/ProjectFormDialog.tsx` | Edit reimbursement/contract |
| `src/components/projects/BillingInvoicePanel.tsx` | QB milestone invoices |
| `src/components/design/ProductPrimitives.tsx` | StatCard |
| `src/components/permitpilot/demo-routes.ts` | Fabricated route list includes `/operations` |
| `src/pages/ResponseMatrix.tsx` | Approval / AI draft patterns |
| `src/components/analytics/AnalyticsExport.tsx` | CSV pattern |
| `src/components/uci/*` | UCI surfaces (costs limited FE) |

### 7.2 Existing BE files / routes

| Path | Role |
|------|------|
| `scraper-service/app/routes/quickbooks.routes.js` | OAuth + `POST /invoice/trigger` |
| `scraper-service/app/services/quickbooks/qb-invoice-trigger.service.js` | Milestone invoice + reimbursement amount on trigger |
| `scraper-service/app/services/quickbooks/qb-invoice-payload.js` | QB payload |
| `scraper-service/app/services/uci/uci-costs.service.js` | List/upsert `coordination_costs` |
| Edge agents / RM | Comment AI — not Ops finance |

**Missing:** dedicated `/api/operations/*` or Supabase Ops RPCs.

### 7.3 Existing tables / migrations (Ops-relevant)

| Table | Migration(s) |
|-------|----------------|
| `projects` | `20260113050946_…`, billing/QB/tenant alters |
| `quickbooks_connections` | `20260505120000_…` |
| `coordination_costs` | `20260509120000_…` |
| `coordination_milestones` | same |
| `staff_assignments` | `20260113063025_…` |
| `project_activity` | `20260113055633_…` |
| `project_documents` | `20260113051524_…` |
| `tenants` / `tenant_memberships` | `20260715140000_…` |
| `project_team_members` | `20260113051923_…` |

**Absent:** reimbursable_items, scope_lines, project_tasks, ops_audit.

### 7.4 Reusable functionality

- Auth + DashboardLayout  
- Active project context  
- Project billing field read/write  
- QB dry-run / draft invoice trigger  
- UCI cost CRUD service  
- StatCard, tabs, CSV download helpers  
- Empty/loading/error UX  
- RLS / tenant access helpers  
- RM-style human approval pattern for Phase D  

### 7.5 Missing functionality

- `/operations` page + nav + API contract  
- Reimbursable line ledger  
- Scope & pricing lines  
- PM workflow / CP / dependencies / subitems  
- Editable Ops statuses with audit trail  
- Functional Filter / Person / Export / New item (Lovable stubs)  
- AI expense/scope reconcile agent  

### 7.6 Proposed data mapping (every Ops Board field)

#### Reimbursables row (`Reimbursable` in Lovable)

| Field | PP mapping | Notes |
|-------|------------|-------|
| `item` | `coordination_costs.cost_type` **or** null | Incomplete for permit fees |
| `logged` | `coordination_costs.actual_received_at` / `created_at` **or** null | |
| `project` | `projects.name` | From active project |
| `permitNo` | `projects.permit_number` | Often shared across rows; not per-line |
| `description` | `coordination_costs.notes` / `projects.reimbursement_description` | Weak |
| `amount` | `actual_amount` ?? `estimated_amount` **or** project `reimbursement_amount` | Aggregate vs line |
| `team` | **null** | No IS/GC team field |
| `invoiced` | Derive only if `client_billed_at` / QB id set — else **null** | Do not invent “Paid by GC” |
| `invoice` | `quickbooks_invoice_id` or project `qb_invoice_id_m*` | Different semantics |
| `payment` | Derive from `paid_at` — else **null** | |
| `progress` | **null** | No progress model |

#### Scope line (`ScopeLine`)

| Field | Mapping |
|-------|---------|
| `item` | **null** (no table) |
| `client` | `projects.client_name` (header only) |
| `email` | `projects.client_email` |
| `dateNeeded` | **null** |
| `hours` | **null** (not `staff_assignments` without product rule) |
| `price` | **null** (not `contract_value` split) |

#### Workflow task (`Task` / `Subitem` / `Group`)

| Field | Mapping |
|-------|---------|
| `name`, `cp`, `owner`, `status`, `completion`, `progress`, `subitems`, `dependsOn`, group `accent` | **All null / N/A** — no schema |

#### Header / KPIs

| UI element | Mapping |
|------------|---------|
| Board title | `projects.name` (+ permit #) |
| Reimbursables tracked | See §3.2 — redefine or null |
| Invoiced line items | null or UCI/QB-derived with honest label |
| Scope hours | **null** |
| Critical-path tasks | **null** |

### 7.7 Recommended schema changes (only if product requires Monday parity)

> Not implementing now. Required **only** where gaps are genuine.

1. **`project_reimbursable_items`** — `project_id`, item, description, amount, logged_at, permit_number?, team?, invoiced_status, invoice_ref, payment_status, progress?, document_id?, created_by, timestamps + RLS via `has_project_access`  
2. **`project_scope_lines`** — `project_id`, item, hours, unit_price, date_needed, sort_order + RLS  
3. **(Phase later) `project_workflow_groups` / `project_workflow_tasks`** — CP flag, status, owner, parent_task_id, depends_on, completion_date, progress  

**Do not create** these to “look like Lovable” before product ownership decision (matrix L021 still owner-decision).

**Avoid:** duplicating `coordination_costs` into reimbursables without a clear “utility vs general” product rule (link/FK optional).

### 7.8 Route and API contract (proposed)

**Route**

- `GET` page `/operations` (auth)  
- Query: `?projectId=` consistent with shell (not Lovable `project`)  

**Read API (Phase A) — Supabase client or thin scraper routes**

```
GET project by id (existing)
GET coordination_costs?project_id= (existing UCI service / direct select under RLS)
```

**Future write API (Phase C)**

```
GET/POST/PATCH/DELETE /api/projects/:id/reimbursables
GET/POST/PATCH/DELETE /api/projects/:id/scope-lines
```

**Phase D**

```
POST /api/projects/:id/operations/reconcile/propose  → draft proposals
POST /api/projects/:id/operations/reconcile/apply     → after approval
```

### 7.9 Security / tenant risks

| Risk | Mitigation |
|------|------------|
| Cross-project finance leak | Always filter by active project + RLS |
| Demo ↔ prod crossover | `can_access_tenant` / demo-only helpers |
| Client sees internal margins | Viewer read rules; hide cost tabs from client share links if needed |
| QB token exposure | Keep tokens service-role only |
| Fake “Real” board | Provenance + `demo-routes` discipline |
| Silent AI writes | Review-before-apply; no auto-apply |
| Shared Railway development Supabase | Demo accounts only for testing finance |

### 7.10 Phased checklist

- [ ] Product decision: own Monday domain? (reimbursables / scope / workflow separately)  
- [ ] Phase A: route + nav + active project empty/partial read-only UI  
- [ ] Phase A: provenance / demo badge policy for `/operations`  
- [ ] Phase A: optional UCI costs panel with honest labeling  
- [ ] Phase B: search, filter, CSV on real rows  
- [ ] Phase C: approved migrations for line tables + CRUD + activity  
- [ ] Phase C: status edit permissions  
- [ ] Phase D: propose/apply reconcile agent + RM-like approval  
- [ ] Explicit non-goals until approved: mock fixtures, CP fabrication, Lovable AiWorkflow link  

### 7.11 Exact first implementation task (after approval)

**Task:** Add an authenticated, project-scoped `/operations` **read-only shell** in PermitPilot that:

1. Registers route in `src/App.tsx` under `ProtectedLayoutRoute`  
2. Adds Delivery nav item in `hybridNav.ts` (+ `pageTitles`)  
3. Uses `useSelectedProject` / `useProjects` to show project name/permit/client/contract/`reimbursement_*`  
4. Optionally lists `coordination_costs` for that project labeled **“Utility coordination costs”**  
5. Renders Scope & PM Workflow tabs as **explicit empty states** (no fixtures)  
6. Keeps `/operations` on the fabricated/demo badge list **or** feature-flags the page until reimbursable/scope tables exist  

**Out of scope for that first task:** migrations, mock seeding, editable statuses, AI reconcile, copying `reference/lovable-ui/src/pages/OperationsBoard.tsx` data arrays.

---

## 8. Lovable reference confirmation (proposed only)

| Artifact | Finding |
|----------|---------|
| `reference/lovable-ui/src/pages/OperationsBoard.tsx` | **Confirmed mock** — inline `langston`, `rockville`, `scope`, `workflow` arrays; no Supabase queries |
| `reference/lovable-ui/src/App.tsx` | Route `/operations` → OperationsBoard |
| `reference/lovable-ui/src/components/permitpilot/data.ts` | Nav: Delivery › Operations Board |
| `docs/data-provenance.md` / Lovable inventory | Fabricated |
| `reference/lovable-ui/lovable-permitpilot-architecture-matrix.md` L021 | Defer; needs task + financial model; owner decision |
| Proposed model docs in Lovable | **No Ops Board schema design** found; stitch “critical path” UX HTML is design-only |

Treat all Lovable Ops content as **visual/IA proposal**, not data contract.

---

## 9. Cross-references

- `docs/current-data-model.md` — entity inventory  
- `docs/lovable-vs-current-gap-analysis.md` — exclude v1  
- `docs/lovable-ui-frontend-implementation-plan.md` — exclude due to confusion/duplication  
- `docs/data-provenance.md` — `/operations` fabricated  
- `docs/audits/response-matrix-reconciliation-proposal.md` — approval/reconcile patterns (comments domain)  
- Workspace rule: Lovable = visual reference; preserve PP functional truth; no mock data on production paths  

---

## 10. Final recommendation (one paragraph)

Implement Operations Board only as a **mixed** surface: reuse PermitPilot’s project selection, tenant/RLS, aggregate billing, and optionally UCI `coordination_costs`; leave Scope and PM Workflow empty until dedicated tables exist; never copy Lovable fixtures. After product approval, the **first implementation task** is a read-only `/operations` shell wired to the active project with honest empty/partial data — no migrations and no mock seeding in that step.
