# Operations Board — Future Schema Notes

**Date:** 2026-08-04  
**Status:** Documentation only — **no migrations** in this implementation.  
**Related:** `docs/audits/operations-board-feasibility-audit.md`

This note inventories what the current `/operations` page uses, what remains mock-only, and what new entities would be required for full Monday-style parity. Do not create these tables until product ownership is approved.

---

## Classification of data sources (current ship)

| Area | Classification | Source |
|------|----------------|--------|
| Project header (name, permit #, address, jurisdiction, client, service, contract, reimbursement) | Live / Partial | `projects` |
| Permit fee / expeditor / total cost scalars | Partial | `projects` |
| QB M1–M3 trigger flags + invoice IDs | Partial | `projects` billing columns |
| Utility Coordination Costs | Partial | `coordination_costs` (UCI only) |
| Full reimbursable line ledger (team, progress, Paid by GC, per-fee invoices) | Mock | Lovable fixtures (`operations-demo-data`) |
| Scope & pricing line table | Mock | Lovable fixtures |
| Project-level client/service/contract on Scope tab | Partial | `projects` |
| PM Workflow groups / tasks / subitems / dependencies | Mock | Lovable fixtures |
| Filter / Person / New item / Auto-reconcile with AI | Upcoming | UI only |

---

## Existing / reused (no new entities)

| Asset | Role on Ops Board |
|-------|-------------------|
| `projects` | Header + aggregate finance |
| `coordination_costs` | Labeled **Utility Coordination Costs** only |
| `quickbooks_connections` / QB trigger services | Backend-only tokens; FE shows invoice IDs already on project |
| `has_project_access` / project team / tenant helpers | RLS / access |
| `SelectedProjectContext` + `?projectId=` | Active project contract |
| FE primitives (tabs, badges, CSV download, empty/loading) | Presentation |

---

## Mock-only (fixture modules; no persistence)

| Concept | Module |
|---------|--------|
| Langston / Rockville reimbursable rows | `src/lib/operations/operations-demo-data.ts` |
| Scope lines (hours / unit pricing) | same |
| Workflow groups, tasks, subitems, dependsOn | same |

Rules: never inherit selected real project identity; never write to Supabase/QB/UCI; never include in real KPI totals or real CSV.

---

## Future entities (proposed — not created)

### 1. `project_reimbursable_items`

General permit reimbursable ledger (not UCI-only).

Suggested columns:

- `id`, `project_id`, `tenant_id?`
- `item`, `description`, `amount`
- `logged_at`, `permit_number?`
- `team?` (e.g. IS/GC), `invoiced_status`, `invoice_ref`, `payment_status`
- `progress?`, `document_id?` → `project_documents`
- `created_by`, `created_at`, `updated_at`

RLS: `has_project_access(auth.uid(), project_id)` (+ tenant-aware policies if Row 2 required).

Optional: FK/link to `coordination_costs.id` when a utility fee is also tracked as a reimbursable.

### 2. `project_scope_lines`

- `id`, `project_id`
- `item`, `hours`, `unit_price`, `date_needed`
- `sort_order`, timestamps

RLS: project-scoped. Do **not** auto-derive `contract_value` as sum without an explicit product rule.

### 3. `project_workflow_groups` / `project_workflow_tasks`

PM / critical-path domain:

- Groups: `name`, `accent`, `sort_order`, `project_id`
- Tasks: `group_id`, `name`, `cp_flag`, `owner`, `status`, `completion_date`, `progress`
- Subitems: `task_id`, `name`, `approved_status`, `completion_date`
- Dependencies: `depends_on_task_id` / `depends_on_subitem_id`

**Do not** fabricate these from `permit_filings`, `parsed_comments`, scrape jobs, agent runs, or UCI milestones.

### 4. Invoice / payment linkage

- Prefer linking reimbursable/scope lines to QB invoice IDs carefully (preserve M1–M3 trigger invariants)
- Optional payment ledger distinct from UCI `paid_at`

### 5. Audit history

- Extend `project_activity` activity types **or** dedicated ops audit table for create/update/status of reimbursable/scope/workflow rows

### 6. AI reconciliation proposal storage

- Draft proposal table (or JSON draft on project) for expense/scope suggestions
- Review-before-apply pattern (Response Matrix style) — **not** wiring Auto-reconcile to `/matrix/ai-workflow`

---

## Distinctions checklist

| Category | Items |
|----------|-------|
| **Existing / reused** | `projects`, `coordination_costs`, QB project columns, RLS helpers, shell/project selection |
| **Mock-only today** | Reimbursable Monday rows, scope line table, PM workflow board |
| **Upcoming controls** | Filter, Person, New item, Auto-reconcile with AI |
| **Future (needs migrations + product approval)** | `project_reimbursable_items`, `project_scope_lines`, workflow groups/tasks/subitems/deps, richer invoice/payment link, ops audit, AI proposal storage |

---

## Explicit non-goals until approved

- No migrations in the current feature branch work
- No seed DB fixtures for Langston/Rockville
- No new backend API entities required for the mixed FE board
- No mapping filings/comments → CP tasks
