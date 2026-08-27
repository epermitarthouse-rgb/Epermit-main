# Dashboard — New UI Real vs Lovable Audit

**Date:** 2026-08-05  
**Repo:** `epermitarthouse-rgb/Epermit-main`  
**Feat branch:** `feat/lovable-ui-replication` @ `f882f1d`  
**Main:** `main` @ `5199937`  
**Lovable reference:** `reference/lovable-ui` (`src/pages/Dashboard.tsx` → `DashboardLayout` + `DashboardOverview`)  
**Constraints:** Read-only audit. No code changes, push, deploy, merge, or migrations.

**Route under audit:** `/dashboard` → `src/pages/Dashboard.tsx` (feat), wrapped by `DashboardLayout` + `SelectedProjectProvider` + header `ActiveProjectControl`.

**Classification legend**

| Tag | Meaning |
|-----|---------|
| **Live** | Real query/hook → real field → correct scope; UI action works |
| **Partial** | Real wiring with gaps (scope mismatch, weak empty/error, buried UX) |
| **Mock** | Fabricated values presented as product data |
| **Static** | Hardcoded copy/chrome with no data path |
| **Broken** | Intended path fails or dead-ends |
| **Misleading** | Label/visual implies something the data does not support |

**Scope note:** Metrics named Connected / Up to Date / Synced / Awaiting First Harvest / Needs Attention / Active·Queued·Running belong to **Portal Harvest** (`PortalHarvestQueue` + `summarizePortalHarvestMetrics`), **not** the Dashboard page. They are audited here only to confirm absence-on-Dashboard vs presence-elsewhere, so they are not misattributed as Dashboard KPIs.

---

## Evidence sources

| Source | Path / ref |
|--------|------------|
| Feat Dashboard | `src/pages/Dashboard.tsx` |
| Feat widgets | `src/components/dashboard/{DeadlineAlertsWidget,InspectionsPunchListWidget,ProjectHealthCard,RecentChecklistsWidget,AgentWorkflowStatus}.tsx` |
| Feat layout / project select | `src/components/layout/DashboardLayout.tsx`, `ActiveProjectControl.tsx`, `src/contexts/SelectedProjectContext.tsx`, `src/hooks/useResolvedProjectId.ts` |
| Feat KPI adapter (unused) | `src/adapters/dashboardKpiAdapter.ts` |
| Main Dashboard | `git show main:src/pages/Dashboard.tsx` |
| Main widgets | `git show main:src/components/dashboard/*` (Deadline/Inspections/Checklists **byte-identical** to feat; ProjectHealth + AgentWorkflow **changed** on feat) |
| Lovable | `reference/lovable-ui/src/pages/Dashboard.tsx` (`DashboardOverview` mock stats/table/alerts) |
| Portal Harvest metrics (related) | `src/components/portal/PortalHarvestQueue.tsx`, `src/lib/portalHarvestMetrics.ts` |
| Prior hub note | `docs/audits/main-functional-features-and-ui-migration-audit.md` §15 |

---

## 1. New UI dashboard audit — inventory

Route: `/dashboard` · Page: `Dashboard.tsx` · Shell: `DashboardLayout` (sidebar + `ActiveProjectControl`).

| # | UI element | Component | Data source | Calculation | Selected-project aware? | Refresh | Persist | Classification |
|---|------------|-----------|-------------|-------------|-------------------------|---------|---------|----------------|
| 1 | Page header (“PermitPilot Command”, welcome name) | `PageHeader` in `Dashboard.tsx` | `profiles.full_name` via Supabase | First token of `full_name` | No | On user mount (`fetchData`) | Profile in DB | **Live** (display) |
| 2 | Header CTAs: New Project / Portal Harvest / Open Analytics | buttons → `navigate` | n/a | n/a | No | n/a | n/a | **Live** (navigate) |
| 3 | Service pills (Permit / Utility) | `ServicePill` | Static labels | n/a | No | n/a | n/a | **Static** |
| 4 | Company / job title chips | inline | `profiles` | Display | No | Mount | DB | **Live** |
| 5 | Ops / UCI subnav tabs | `NavLink` | Routes `/dashboard`, `/uci` | Active by path | No | n/a | n/a | **Live** (nav); UCI itself is out of this page’s data scope |
| 6 | KPI: Active Projects | inline `kpis` `useMemo` | `useProjects()` → `projects` | `status !== "approved"` | **Portfolio** (all user projects) | Hook reload | Supabase | **Live** / **Misleading** label vs table (see §2) |
| 7 | KPI: In Review / Submitted | same | same | `status ∈ {in_review, submitted}` | Portfolio | Hook | DB | **Live** |
| 8 | KPI: Portal-linked | same | `portal_status` OR `portal_data` | Boolean presence | Portfolio | Hook | DB | **Partial** / **Misleading** (“linked” ≠ synced/healthy) |
| 9 | KPI: Corrections Needed | same | `status === "corrections"` | Count | Portfolio | Hook | DB | **Live** |
| 10 | Subscription banner / plan row | `AlertBanner` / plan strip | `useAuth().subscription` | Tier name + renewal date | No | `checkSubscription` on checkout | Stripe/edge | **Live** (Partial if Stripe sync lag) |
| 11 | Active Projects table (≤8 rows) | table in `Dashboard.tsx` | `useProjects()` | Sort `updated_at` desc, slice 8 | Portfolio list; row click **sets** selected id | Hook | Selection → localStorage + `?projectId=` | **Live** list; click UX **Partial** (goes to `/projects` list, not detail) |
| 12 | Table badge “{n} total” + green pulse | header span | `projects.length` | All projects incl. approved | Portfolio | Hook | — | **Misleading** (pulse implies live health; count ≠ KPI “Active”) |
| 13 | View All → `/projects` | `Link` | n/a | n/a | No | n/a | n/a | **Live** |
| 14 | Intelligence & Alerts shell | section | Mixed | — | — | — | — | Composition **Live** shell |
| 15 | Quick actions links | `Link`s | n/a | Portal Harvest / Response Matrix / UCI / Permit Filing | No | n/a | n/a | **Live** navigate |
| 16 | Deadline Alerts (embedded) | `DeadlineAlertsWidget` | `projects` where `deadline` not null, `status ≠ approved` | Overdue / ≤7d / 8–30d buckets | **Portfolio** | Realtime channel `projects` | DB | **Live** / empty-state **Misleading** |
| 17 | Getting Started checklist | `GettingStartedChecklist` | `useGettingStarted` | localStorage checklist | No | Client | **localStorage only** | **Partial** (local UX, not server) |
| 18 | Onboarding wizard | `OnboardingWizard` | `useOnboarding` | Modal open flag | No | Client | Typically local/profile flag | **Partial** (same as main) |
| 19 | Workflow Tools tabs shell | `Panel` + `Tabs` | n/a | Secondary demotion of PP tools | — | — | — | **Live** chrome |
| 20 | Intake Pipeline tab | `AgentWorkflowStatus` | ScrapeContext + `projects` + `project_pipeline_runs` + edge `intake-pipeline-agent` + scraper `/api/login` `/api/scrape` | Step statuses from scrape job + pipeline stages | **Selected project** (strict submit fields on feat) | Polling + realtime portal hash | Jobs + `projects.portal_data` + pipeline runs | **Live** / **Partial** (needs selected project + credential + scraper) |
| 21 | Project Health tab | `ProjectHealthCard` | `projects` + `parsed_comments` for `projectId` | Health % = non-pending/total comments; deadline age | **Selected** (`selectedProjectId`) | React Query | DB | **Live**; “Run Manual Check” → `/dashboard` **Broken**/noop |
| 22 | Inspections & Punch List | `InspectionsPunchListWidget` | `inspections`, `punch_list_items` (+ join `projects`) | Next 7d / open punch; limit 5 | **Portfolio** (RLS) | Mount only (no realtime) | DB | **Live** / **Partial** (no error UI; not selected-scoped) |
| 23 | Recent Checklists | `RecentChecklistsWidget` | `saved_inspection_checklists` limit 5 | Progress from checked items; stats from **those 5** | Portfolio | Realtime checklists | DB | **Live** / **Misleading** “Total” = last 5 |
| 24 | Saved Calculations | cards in Dashboard | `saved_calculations` | Display `results_data` fields | User-scoped (RLS), not project | Mount `fetchData` | Delete writes Supabase | **Live** |
| 25 | Header Active Project control | `ActiveProjectControl` (layout) | `useProjects` + SelectedProjectContext | Select/create/edit permit/credential | Global selected | Interactive | localStorage + URL | **Live** (not rendered inside page body) |
| 26 | Notification bell | layout (not page) | Notification tables | — | — | — | — | Outside page body; see prior audit §16 |

**Not present on feat Dashboard (Lovable had):** mock KPI Permit-led / Utility-led / Cross-service Blockers; mock portfolio Service / Next Milestone / Assigned columns; mock Intelligence alert timeline with fake priorities/times; “Queue health 94%”; Upload Package / Open Operations Report CTAs; nested `/dashboard/uci` outlet (feat uses top-level `/uci`).

**Not present on feat Dashboard (main had as primary fold):** full-bleed Intake Pipeline hero; always-visible Project Health (when selected); Quick Action cards (Projects / Permit Intelligence / Interactive Demos); Saved Calculations as primary section; welcome avatar + truncated active project id.

**Unused helper:** `buildDashboardKpis` in `dashboardKpiAdapter.ts` is **not imported** by `Dashboard.tsx`. Dashboard KPIs are computed inline.

---

## 2. Verify every dashboard number

### 2.1 Feat Dashboard KPIs (portfolio)

| Metric | Query / field | Formula | Scope | Stale/fail/queue/dup concerns | Label accuracy | Verdict |
|--------|---------------|---------|-------|-------------------------------|----------------|---------|
| Active Projects (KPI) | `useProjects` → `projects.status` | Count where `status !== "approved"` | Portfolio | Includes draft/submitted/in_review/corrections; no scrape-job states | Label OK for “not approved”; conflicts with table title using same words for different set | **Live** / **Misleading** vs table badge |
| In Review / Submitted | `status` | `in_review` OR `submitted` | Portfolio | Does not include draft corrections path | Accurate for enum | **Live** |
| Portal-linked | `portal_status` OR truthy `portal_data` | Presence count | Portfolio | Empty object / failed scrape residue can count; no freshness | Overstates “healthy harvest” | **Partial** / **Misleading** |
| Corrections Needed | `status === "corrections"` | Count | Portfolio | — | Accurate | **Live** |
| Active Projects table badge “N total” | `projects.length` | All statuses | Portfolio | Includes approved | Says “total” under “Active Projects” header; green pulse | **Misleading** |
| Portfolio rows shown | same | Top 8 by `updated_at` | Portfolio sample | Not a count metric | Columns: Project, Jurisdiction, Permit #, Status, Portal, Updated | **Live** |
| Portal column “Synced” | `portal_status` else (`portal_data` ? `"Synced"` : `"—"`) | Fallback string | Row | Any `portal_data` → “Synced” without freshness/job status | Can show Synced when stale/failed/partial | **Misleading** |
| Saved Calculations badge | `calculations.length` | Full fetch count | User | — | Accurate for listed set | **Live** |
| Subscription renews date | `subscription.subscriptionEnd` | `date-fns` format if valid | Account | Loading spinner while checking | Accurate when Stripe sync works | **Live** / Partial on lag |

### 2.2 DeadlineAlertsWidget

| Metric | Source | Formula | Scope | Issues | Verdict |
|--------|--------|---------|-------|--------|---------|
| Overdue / This Week / Upcoming counts | `projects.deadline` | `differenceInDays`; overdue = past & not today; urgent ≤7; upcoming 8–30 | Portfolio non-approved with deadline | Projects **without** deadline invisible; empty → “All caught up!” | **Live** counts; empty **Misleading** |
| Alert badge total | overdue + urgent | Sum | Portfolio | Upcoming (8–30) excluded from header badge | Intentional but easy to miss | **Live** |

### 2.3 InspectionsPunchListWidget

| Metric | Source | Formula | Scope | Issues | Verdict |
|--------|--------|---------|-------|--------|---------|
| Inspections list / upcoming count | `inspections` status ∈ scheduled\|in_progress, `scheduled_date ≤ now+7d`, limit 5 | Overdue = date &lt; now | Portfolio (RLS) | Query errors ignored (silent empty); badge “upcoming” excludes overdue from that badge but overdue shown in list styling | **Partial** |
| Punch open count / critical | `punch_list_items` open\|in_progress, limit 5 | critical/high priority | Portfolio | Order by priority string may not match true severity enum order | **Partial** |

### 2.4 RecentChecklistsWidget

| Metric | Source | Formula | Scope | Issues | Verdict |
|--------|--------|---------|-------|--------|---------|
| Total / Signed / Done / Active | Last **5** checklists only | Filters on that window; Active = in_progress + draft | Not full portfolio | “Total” reads like all-time | **Misleading** |
| Progress % | `checklist_items[].checked` | checked/length | Per row | — | **Live** |

### 2.5 ProjectHealthCard (selected)

| Metric | Source | Formula | Scope | Issues | Verdict |
|--------|--------|---------|-------|--------|---------|
| Health % ring | `parsed_comments` | `(total - pending) / total * 100`; 100% if total=0 | Selected | 0 comments → 100% “healthy” with no work | **Misleading** when empty |
| Total / Pending / Ready / Approved | comment `status` / empty `response_text` | Pending = status pending OR empty response | Selected | Status strings case-normalized; ready/approved exact match | **Live** / Partial taxonomy |
| Last portal check | `projects.last_checked_at` | Hours/days ago | Selected | “Never” when null | **Live** |
| Deadline text / bar | `projects.deadline` | Days until; progress vs arbitrary 30d window | Selected | Bar is cosmetic (30d assumption) | **Partial** |

### 2.6 AgentWorkflowStatus (selected)

| Metric / signal | Source | Formula | Scope | Issues | Verdict |
|-----------------|--------|---------|-------|--------|---------|
| Portal step status | ScrapeContext job + `portal_status` text | Mapped idle/checking/done/failed; queued/running via job | Selected (feat blocks fallback to latest project) | Cancelled → idle; needs scraper up | **Live** / Partial env |
| Parser / classifier / enrichment / router | `intake-pipeline-agent` + `project_pipeline_runs.stages` + comment fields | Stage status + counts | Selected | Enrichment loop continues on feat (improvement vs main) | **Live** |
| Pipeline context permit/jurisdiction | Selected project row | Display | Selected | Empty until loaded | **Live** |

### 2.7 Metrics user asked about that are **not** Dashboard numbers

| Metric | Where it lives | On `/dashboard`? |
|--------|----------------|------------------|
| Connected (projects/portals) | Portal Harvest `MetricCard` / queue | **No** |
| Up to Date / Synced (harvest) | `HarvestQueueStatus` “Synced” + harvest summarizer | **No** (Dashboard portal column may **misuse** “Synced”) |
| Awaiting First Harvest | Portal Harvest filters/status | **No** |
| Needs Attention | Portal Harvest attention breakdown | **No** |
| Active / Queued / Running (jobs) | Scrape jobs + Portal Harvest queue; Intake Pipeline step text | Queued/Running only as pipeline/scrape **status text**, not KPI cards |
| Files / reports harvest counts | Portal Data / harvest evidence | **No** as Dashboard KPIs |
| AI/agent metrics | Intake Pipeline step descriptions (parsed/classified/enriched/routed) | Tabbed secondary only; not top KPIs |
| Permit / filing counts | Not on Dashboard KPIs | Permit Filing is a quick link only |
| Lovable “Queue health 94%” | Lovable mock only | Feat replaced with `{n} total` (real count, still misleading chrome) |

**Double-count / mock-mixed:** Top KPIs are real project status counts only — no mock mixed into totals. Lovable mock numbers (24/14/10/7) are **not** used on feat. `dashboardKpiAdapter` unused — no alternate mock path.

---

## 3. Functional interaction audit

| Interaction | Behavior | Navigate / load / read / write | Verdict |
|-------------|----------|--------------------------------|---------|
| Header Active Project select | `ActiveProjectControl` sets context + URL + localStorage; can edit permit/credential | Read/write projects | **Live** |
| KPI cards | Display only; no click handlers | Read | **Static** interaction (no drill-down) |
| Active Projects row click | `setSelectedProjectId(row.id)` then `navigate("/projects")` | Write selection; navigate to **list** | **Partial** (sets selection but not project detail / health) |
| View All | `/projects` | Navigate | **Live** |
| New Project | `/projects/new` | Navigate | **Live** |
| Portal Harvest header CTA | `/portal-data` | Navigate | **Live** |
| Open Analytics | `/analytics` | Navigate | **Live** (main had no equivalent primary CTA) |
| View Plans / Manage Billing | `/pricing` | Navigate | **Live** |
| Ops / UCI tabs | `/dashboard` / `/uci` | Navigate | **Live** |
| Intelligence quick links | portal-data, response-matrix, uci, permit-wizard-filing | Navigate | **Live** |
| Deadline item / View All | Link → `/projects` (not project-scoped) | Navigate | **Partial** (loses deadline context) |
| Inspections / punch “View all” | `/projects` | Navigate | **Partial** |
| Checklist row | `/checklist-history` | Navigate | **Live** |
| Saved calc delete | Supabase delete | Write | **Live** |
| ROI / Consolidation empty CTAs | Links | Navigate | **Live** |
| Intake: Quick Scrape / modes / Cancel | Scraper + ScrapeContext | Write jobs; realtime | **Live** when credential+scraper; else toast |
| Intake: Enrichment / Auto-Route | Edge function writes comments | Write | **Live** |
| Intake: Comment Review / Response Matrix links | Includes `project_id` when selected | Navigate | **Live** |
| Project Health actions | Response Matrix / Comment Review / “Run Manual Check” | Navigate | Resolve/Upload **Live**; Manual Check → `/dashboard` **Broken** (noop when already there; does not start scrape) |
| Getting Started item routes | Various | Navigate + local complete | **Partial** |
| Onboarding complete | Closes wizard | Client persist | **Partial** |
| Request Demo | Lovable shell only | — | **Missing** on PP Dashboard (exclude or keep shell-only elsewhere) |
| Start / New Workflow | Lovable `AiWorkflow` | — | **Missing** on Dashboard (exclude; not PP dashboard concept) |
| Refresh control (page-level) | None dedicated; widgets self-refresh variously | — | **Partial** (no global refresh) |
| Filters on Dashboard | Only deadline/inspection internal tabs | — | **Live** within widgets; no portfolio filter bar |
| Notifications | Header bell (layout) | Read/mark | Outside page; Partial prefs (prior audit) |

---

## 4. Compare against `main`

| Main surface | Feat status | Notes |
|--------------|-------------|-------|
| Welcome card (avatar, name, job, company, truncated active project id) | **Replaced** | Lovable `PageHeader`; **lost** visible active-project id on page (still in header control) |
| Intake Pipeline as primary hero (`pipeline-canvas` + architecture bg) | **Relocated** into secondary tab “Intake Pipeline” | Capability **preserved**, discoverability **reduced** |
| `ProjectHealthCard` when `selectedProjectId` (always visible) | **Relocated** into “Project Health” tab; empty state if none selected | Still mounted; feat improves Comment Review deep-link (`?project_id=`) |
| Subscription card | **Present** (banner / plan strip) | Function preserved; visual restyle |
| Quick Action: Projects | **Removed** as card | Covered by New Project + table + View All |
| Quick Action: Permit Intelligence (`/permit-intelligence`) | **Missing** from Dashboard | Not replaced; only reachable via nav elsewhere |
| Quick Action: Interactive Demos (`/demos`) | **Missing** from Dashboard | Not replaced |
| DeadlineAlertsWidget | **Present** (inside Intelligence panel) | **Identical** file to main |
| InspectionsPunchListWidget | **Present** (Inspections tab) | **Identical** to main; no longer side-by-side with deadlines on primary fold |
| RecentChecklistsWidget | **Present** (same tab) | **Identical** to main |
| Saved Calculations section | **Present** (tab) | Same queries/delete; demoted |
| OnboardingWizard | **Present** | Same |
| GettingStartedChecklist | **Present** | Same localStorage behavior |
| AgentWorkflowStatus | **Present** (tab) | **Enhanced** on feat: no fallback to latest project for scrape; enrichment continue loop; header Active Project messaging |
| Framer-motion editorial canvas / cream surfaces | **Replaced** | New `pilot-card` / ProductPrimitives shell; widgets still mostly cream/`ink-*-light` internals |
| Backend / Supabase tables for widgets | **Not removed** | No evidence of accidental BE drop for dashboard widgets |
| Status summary KPIs / portfolio table | **New on feat** | Not on main Dashboard |

**Backend removed accidentally?** No. Widget queries and scrape/pipeline paths remain. Feat changes are FE composition + AgentWorkflow/ProjectHealth small behavior fixes.

---

## 5. Compare against Lovable (`reference/lovable-ui`)

### 5.1 Missing vs Lovable (and recommendation)

| Lovable item | On feat? | Recommendation |
|--------------|----------|----------------|
| KPI: Active Projects = mock `24` | Real count instead | **Keep real** |
| KPI: Permit-led Workflows | No | **Coming Soon** or exclude until `service_type`/workflow taxonomy is trusted; do **not** mock |
| KPI: Utility-led Workflows | No | Same |
| KPI: Cross-service Blockers | No | **Coming Soon** / exclude (also placeholder on Response Matrix) |
| Queue health 94% badge | Replaced with `{n} total` + pulse | Do **not** restore mock %; fix badge copy (see §11) |
| Portfolio columns: Service, Next Milestone, Assigned | No (has Permit #, Portal, Updated) | **Implement real** only if fields exist (`service_type`, deadline-as-milestone, assignment); else **Coming Soon** columns — never mock assignees |
| Intelligence alert timeline (High/Med/Low fake items) | Replaced with DeadlineAlertsWidget + quick links | **Keep real deadlines**; optional future alert feed from notifications — **not** Lovable copy |
| Upload Package CTA | No | Map to real documents upload if desired; else exclude |
| Open Operations Report | Open Analytics (real `/analytics`) | **Adapt** — acceptable substitute |
| Nested `/dashboard/uci` outlet | Top-level `/uci` tab | **Preserve** PP routing |
| Request Demo (shell) | Not on page | **Exclude** from Dashboard body |
| New Workflow | Not on Dashboard | **Exclude** |

### 5.2 Extra PP features vs Lovable

| Extra PP feature | Recommendation |
|------------------|----------------|
| Intake Pipeline (scrape + agents) | **Preserve** (already secondary tab) — stronger than Lovable mocks |
| Project Health | **Preserve** |
| Inspections / punch / checklists | **Preserve** |
| Saved calculations | **Preserve** (or move to Analytics later) |
| Subscription / billing strip | **Preserve** |
| Onboarding + Getting Started | **Preserve** |
| Portal Harvest / Response Matrix / Permit Filing quick links | **Preserve** |
| Real status KPIs | **Preserve**; refine labels |
| Permit Intelligence / Demos quick cards (main) | **Adapt**: restore as secondary links if still product surfaces — do not drop silently |

**Rule:** Do not remove stronger real PP to match Lovable mocks.

---

## 6. Real vs mock separation

| Item | Status | Notes |
|------|--------|-------|
| Top KPI numbers | Real | From `useProjects` |
| Lovable mock stats/alerts/portfolio | Not shipped | Good |
| Service pills | Static marketing chrome | OK if not counted as metrics |
| Green pulse on “N total” | Marketing-as-health | **Misleading** |
| Portal column “Synced” | Heuristic, not harvest status enum | **Misleading** |
| “All caught up!” deadlines | Implies healthy when often “no deadlines set” | **Misleading** |
| Health 100% with 0 comments | Empty ≠ healthy | **Misleading** |
| Checklist Total from last 5 | Truncated sample as Total | **Misleading** |
| Getting Started | Local checklist, not live metrics | OK if not mixed into KPIs (it isn’t) |
| Demo / mock inheritance into Dashboard KPIs | None found | Good |
| Coming Soon writes | N/A on Dashboard | Good |
| `DemoDataBadge` on Dashboard | Not used | N/A (no demo blocks on page) |
| Provenance labels on KPIs | Missing (“Portfolio” scope not labeled) | Gap |

---

## 7. Selected-project correctness

| Mechanism | Behavior on Dashboard |
|-----------|----------------------|
| `SelectedProjectContext` | Provider in `DashboardLayout`; key `epermit:selectedProjectId:{userId}`; syncs `?projectId=` |
| `useResolvedProjectId` | **Not used** by `Dashboard.tsx` (used elsewhere); Dashboard reads context directly |
| Header `ActiveProjectControl` | Canonical selector for Intake + Health |
| Portfolio widgets | Deadlines, inspections, checklists, KPIs, table → **ignore** selected project (by design on main too) |
| Selected widgets | `AgentWorkflowStatus`, `ProjectHealthCard` → **require** selected |
| Table row click | Sets selected then leaves for `/projects` | Mixed: updates selection but does not open selected-scoped dashboard tools |
| Switching projects | Intake/Health refetch via `selectedProjectId`; KPIs unchanged (portfolio) | Correct if labeled; confusing if user expects KPIs to filter |
| Feat scrape safety | `resolveQuickScrapeSubmitFields` — **no** fallback to latest project (regression fix vs main) | **Correct** |

**Every metric must state scope (current gaps):** KPIs and table lack “Portfolio” kicker; Intelligence deadlines lack “All projects”; Health/Intake lack “Selected project” eyebrow in tab empty/loaded states (empty Health mentions header; Intake aside does).

---

## 8. Loading / empty / error / permissions

| Surface | Loading | Empty | Error | Permissions / RLS / demo |
|---------|---------|-------|-------|--------------------------|
| Auth gate | Spinner | — | Redirect `/auth` | Session required |
| KPI cards | Skeleton ×4 when `projectsLoading` | Show `0` | No projects error UI | RLS via `useProjects` |
| Portfolio table | Skeletons | Empty CTA New Project | Silent if projects fail | User projects |
| Subscription | Spinner on tier refresh | Unsubscribed banner | — | Account |
| Deadlines | Spinner in card | “All caught up!” | `console.error` only | RLS projects |
| Inspections | Skeleton | Empty card + CTA | Failed query → empty (no toast) | RLS |
| Checklists | Spinner | Empty + CTA | console.error | RLS |
| Calculations | Skeletons | Empty + calculator links | console.error; delete toast | RLS |
| Project Health | Spinner | Tab empty if no selection; `null` if query miss | Weak | Selected project must be owned |
| Intake Pipeline | Step states | Idle without selection | Toasts; chain error text | Scraper + credential; demo accounts on shared Supabase |
| Getting Started | — | Hidden when complete | — | localStorage per user |
| Admin vs user | No admin-only Dashboard blocks | — | — | Same page |
| Tenant | Single-user RLS model | — | — | No multi-tenant switcher on page |

---

## 9. Responsive / visual

| Aspect | Finding | Severity |
|--------|---------|----------|
| Desktop KPI 4-col / xl portfolio 2fr+1fr | Matches Lovable structure | OK |
| Tablet | `md:grid-cols-2` KPIs; table `overflow-x-auto` | OK |
| Mobile | Header actions wrap; table horizontal scroll; Workflow tabs `flex-wrap` | OK / watch tab overflow |
| Dark / light | Page uses `pilot-card` tokens; **widgets still cream/`ink-*-light`**, forced light surfaces in dark mode (inherited from main) | Material clash vs Lovable dark-ready cards |
| Card sizing | Intelligence panel can dwarf short deadline empty state; Intake inside tab is dense | Medium |
| Sticky | No sticky KPI/header inside page | OK |
| Truncation | Project names / checklist labels truncate | OK |
| Charts | Health SVG ring only; no Lovable charts | OK |
| Material Lovable diffs | Missing alert timeline chrome; different CTAs; secondary PP tabs not in Lovable; pulse badge not “Queue health” | Expected; do not fake Queue health |

---

## 10. Required output structure (summary matrices)

### 10.1 Classification rollup

| Area | Live | Partial | Mock | Misleading | Broken | Missing vs main | Missing vs Lovable (intentional) |
|------|------|---------|------|------------|--------|-----------------|----------------------------------|
| Top KPIs | 3–4 | Portal-linked | 0 | Active vs total; Portal-linked | — | n/a (new) | Permit/Utility/Blocker mocks |
| Portfolio table | Yes | Row→list | 0 | Pulse + Synced | — | n/a (new) | Service/Milestone/Assigned |
| Intelligence | Deadlines live | Links only | 0 | All caught up | — | Deadlines relocated | Fake alert feed |
| Intake / Health / Inspections / Checklists / Calcs | Yes | Buried in tabs; some empty/error | 0 | Checklist Total; Health 100% | Health Manual Check noop | Permit Intel + Demos cards | — |
| Onboarding | Partial local | — | — | — | — | Preserved | — |

### 10.2 Must-preserve (do not drop for Lovable parity)

1. `AgentWorkflowStatus` scrape + chained intake (selected-project-safe).  
2. `DeadlineAlertsWidget`, `InspectionsPunchListWidget`, `RecentChecklistsWidget`, `ProjectHealthCard`.  
3. Saved calculations read/delete.  
4. Subscription + onboarding/getting-started.  
5. Real portfolio KPIs (not Lovable mocks).  
6. Header `ActiveProjectControl` + URL/localStorage selection contract.

### 10.3 Must-not-ship as real

1. Lovable Queue health %.  
2. Lovable Permit-led / Utility-led / Cross-service Blocker numbers.  
3. Lovable fake Intelligence alerts / assignees / milestones.  
4. Portal column label “Synced” without harvest freshness.

---

## 11. Recommended fixes by priority

### P0 — Misleading / correctness (ship before calling Dashboard “done”)

1. **Disambiguate Active Projects KPI vs table badge**  
   - KPI: keep non-approved count; label “Active (excl. approved)” or similar.  
   - Badge: “{n} projects” without green pulse, or pulse only when a real live scrape is running.  
2. **Stop labeling arbitrary `portal_data` as “Synced”**  
   - Use `portal_status` raw, or map through `portalHarvestMetrics` / harvest status; else “Has portal data” / “—”.  
3. **Project Health “Run Manual Check”**  
   - Should trigger Intake Quick Scrape or deep-link to Intake tab / portal-data with selected project — **not** `navigate("/dashboard")`.  
4. **Deadline empty copy**  
   - Distinguish “No deadlines set” vs “No overdue/upcoming in window”.

### P1 — Scope clarity & discoverability

5. Add **Portfolio** / **Selected project** kickers on each metric block.  
6. Surface Intake + Health more visibly when a project is selected (badge on Workflow Tools tab, or compact selected strip).  
7. Row click: navigate to a useful selected-scoped destination (e.g. stay on Dashboard Health tab, or `/projects` with selection already set — document UX choice).  
8. Restore **Permit Intelligence** and **Interactive Demos** as secondary links if those routes remain product surfaces.  
9. Inspections widget: surface query errors; optional selected-project filter toggle.

### P2 — Lovable alignment without mocks

10. Optional real columns: `service_type` → Service pill; deadline → Next milestone; omit Assigned until real assignment exists.  
11. Visual pass: restyle cream widgets to `pilot-card` tokens for dark/light parity.  
12. Wire or delete unused `dashboardKpiAdapter` (prefer one KPI builder used by page).  
13. Checklist stats: label “In recent 5” or query full counts.

### P3 — Polish

14. Global refresh control for portfolio queries.  
15. Deadline/inspection links include `projectId` / open project detail.  
16. Coming Soon placeholders for Permit-led / Utility-led / Blockers **only** if product wants Lovable labels — disabled, no numbers.

---

## 12. Exact first implementation task (after approval)

**Task ID:** `DASH-AUDIT-P0-1`  

**Title:** Fix Active Projects scope labeling + portal “Synced” heuristic on feat Dashboard  

**Files:** `src/pages/Dashboard.tsx` (KPI labels, table badge, portal cell mapping); optionally reuse `harvestStatus` helpers from `src/lib/portalHarvestMetrics.ts` for the Portal column only (read-only mapping, no BE changes).  

**Acceptance criteria:**

1. KPI “Active” count and table badge no longer imply the same population without saying so.  
2. Green pulse is not used as fake queue-health.  
3. Portal column never prints “Synced” solely because `portal_data` is non-null.  
4. No Lovable mock numbers introduced.  
5. No migrations; no Railway/Vercel deploy required for this FE-only fix.  
6. Manual smoke: `/dashboard` with 0 projects, with mixed statuses, with `portal_data` but stale `last_checked_at`.

**Follow-on (same PR or immediate next):** `DASH-AUDIT-P0-3` — ProjectHealthCard Manual Check action opens Intake scrape or Portal Harvest for `projectId` instead of navigating to `/dashboard`.

---

## Appendix A — File identity vs main

| File | vs `main` |
|------|-----------|
| `DeadlineAlertsWidget.tsx` | Identical (MD5 match) |
| `InspectionsPunchListWidget.tsx` | Identical |
| `RecentChecklistsWidget.tsx` | Identical |
| `ProjectHealthCard.tsx` | Small: Comment Review label + `?project_id=` deep link |
| `AgentWorkflowStatus.tsx` | Selected-project scrape safety + enrichment continue + toast→status text |
| `Dashboard.tsx` | Full Lovable-structure rewrite + secondary Workflow Tools tabs |

## Appendix B — Trace map (feat)

```
/dashboard
  DashboardLayout
    ActiveProjectControl → SelectedProjectContext (localStorage + ?projectId=)
    Dashboard.tsx
      useAuth / useProjects / useOnboarding / useGettingStarted / useSelectedProject
      supabase: profiles, saved_calculations
      KPI useMemo(projects)
      DeadlineAlertsWidget → supabase projects (+ realtime)
      Tabs:
        AgentWorkflowStatus → ScrapeContext, projects, project_pipeline_runs,
                              portal_credentials, edge intake-pipeline-agent,
                              scraper /api/login /api/scrape
        ProjectHealthCard(selectedProjectId) → projects, parsed_comments
        InspectionsPunchListWidget → inspections, punch_list_items
        RecentChecklistsWidget → saved_inspection_checklists, projects
        Saved Calculations UI → saved_calculations (delete)
```
