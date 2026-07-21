# Lovable UI — Full Gap Audit & Replication Plan

> **Date:** 2026-07-22  
> **Branch:** `feat/lovable-ui-replication` @ `9ce9436998eaa554ce8ae541e61d1efa2e57181d`  
> **Scope:** Documentation only. **No application code was modified** for this audit.  
> **Allowed artifact:** this file only (`docs/lovable-ui-full-gap-and-replication-plan.md`).

---

## 0. Purpose & method

### Problem statement

PermitPilot adopted Lovable **shell/theme tokens** and **PageHeader / MetricCard / Panel chrome** on many routes, but most **page bodies** still follow legacy PermitPilot composition (Accela tab viewers, Intake Pipeline agent chain, Kanban dialogs, single-route UCI monolith, etc.). The goal is **full UI and flow replication** of Lovable structure with **existing PermitPilot hooks/APIs** reconnected underneath — not “preserve functionality by leaving old page bodies as primary.”

### Sources consulted

| Source | Path |
|--------|------|
| Lovable app (authoritative visual ref) | `reference/lovable-ui/**` |
| Implementation plan | `docs/lovable-ui-frontend-implementation-plan.md` |
| Prior implementation audit (partially stale) | `docs/lovable-ui-implementation-audit.md` |
| Gap / mapping / inventories | `docs/lovable-vs-current-gap-analysis.md`, `docs/ui-route-component-mapping.json`, `docs/lovable-*`, `docs/current-*` |
| Active PP router | `src/App.tsx` |
| Active pages / shell | `src/pages/**`, `src/components/layout/**`, workflow components |

### Method

1. Enumerate every **active** PermitPilot route from `src/App.tsx` + `docs/current-ui-inventory.json`.
2. Map each to Lovable reference file(s) under `reference/lovable-ui/src/…`.
3. Side-by-side read of composition (header, KPIs, grids, tables, tabs, drawers, project context).
4. Grep for residual legacy primaries (`AgentWorkflowStatus` / Intake Pipeline, Accela tab shells, `AdminPageShell` wrapping old admin).
5. Classify each route as **exactly one** label (below).
6. Produce file-by-file replication plan + dependency-ordered sequence.

### Classification labels (exactly one per route)

| Label | Meaning |
|-------|---------|
| `true_match` | Page structure visibly matches Lovable; old body not primary; real PP data/actions wired |
| `shell_only` | Only app chrome/nav/tokens match; page body unchanged vs legacy PP |
| `cosmetic_only` | Tokens / PageHeader / className polish; section hierarchy still legacy |
| `partial_page_replication` | Meaningful Lovable sections present **and** legacy body sections still co-primary or incomplete |
| `old_page_still_primary` | Lovable chrome thin or absent; legacy layout is the main operator surface |
| `not_started` | Placeholder / Coming soon / Preview stub only |
| `intentional_exception` | Keep as-is by product decision (token portals, Baltimore mock, redirects, aliases, 404 policy) |

### Completion gate (every in-scope route)

1. Active route **visibly matches** Lovable page structure.  
2. Old page composition is **no longer primary**.  
3. Real PP data/actions connected (no Lovable mocks).  
4. No working PP option removed.  
5. No Lovable mock/fake actions shipped.  
6. Responsive verified (desktop + mobile).

---

## 1. Executive verdict (honest)

| Metric | Value |
|--------|------:|
| Active PP routes audited (incl. aliases / catch-all) | **50** |
| `true_match` | **0** |
| `partial_page_replication` | **10** |
| `cosmetic_only` | **22** |
| `not_started` | **5** |
| `intentional_exception` | **13** |
| `shell_only` / `old_page_still_primary` (route-level) | **0** *(shell is app-wide partial; several bodies still legacy-dominant inside `partial_*`)* |
| **Overall true replication % (weighted, excl. exceptions)** | **~32%** |
| Strict true-match % | **0%** |
| Prior claim “~95%” | **Overstated** — chrome ≠ structure |
| Prior audit “~18–22%” (`docs/lovable-ui-implementation-audit.md` @ `6fcc5a5`) | **Understates current HEAD** — post-audit commits (`435576b`…`9ce9436`) added real structural work on Dashboard/Projects/Harvest/Matrix/Filing/UCI/Settings/Admin/Contact |

**Bottom line:** Shell IA + tokens + several **header/KPI skins** are real progress. **Zero routes** fully satisfy Lovable composition with PP logic only. Highest-value routes are **`partial_page_replication`**: Lovable top chrome exists, legacy bodies remain co-mounted or structurally divergent.

---

## 2. App shell & navigation (cross-cutting)

### Comparison

| Concern | Lovable | Current PP | Gap |
|---------|---------|------------|-----|
| Shell file | `reference/lovable-ui/src/components/permitpilot/PermitPilotShell.tsx` | `src/components/layout/DashboardLayout.tsx` + `AppSidebar.tsx` | Same shadcn Sidebar pattern; **not** a true shell swap. PP keeps `ScrapeProvider`, command palette, floating help, mobile bottom nav, scrape header indicator |
| Nav data | `reference/lovable-ui/src/components/permitpilot/data.ts` → `navGroups` | `src/components/layout/hybridNav.ts` → `hybridNavGroups` | Group labels aligned (Command / Delivery / Intelligence / …). Item set is **hybrid**: PP hrefs + Coming soon / Preview |
| Project picker | Header `ActiveProjectPicker` in shell | Header picker **and** heavy sidebar permit/credential/scrape controls (`AppSidebar.tsx` ~L561+) | Lovable: lightweight header select. PP: operational scrape/permit controls still **sidebar-primary** |
| Theme / brand | CommunET logo asset + Role labels | “P” glyph + PermitPilot wordmark | Brand chrome incomplete vs Lovable |
| UCI nav | Many UCI stage links in Intelligence | Single `/uci` item | Stage routes not registered |

### Shell classification (app-wide)

**`partial_page_replication`** for shell/IA — hybrid groups exist (`hybridNav.ts` L63+), but scrape/project controls and page title map still PP-shaped; `PermitPilotShell` itself was never adopted.

### Navigation placement plan (existing options)

| Option | Placement recommendation |
|--------|--------------------------|
| Dashboard, Projects | **Primary sidebar** (Command) — already |
| Portal Harvest, Response Matrix, Permit Filing | **Primary sidebar** (Delivery) — already |
| Comment Review, Classified Comments | **Grouped/collapsible** under Delivery → “Comments” (or page tabs on Response Matrix) — keep routes |
| Code Analyzer, Utility Coordination, Permit Intelligence, Jurisdiction Map/Compare, Code Library | **Primary / Intelligence** — keep; DesignCheck `/compliance` = future or tab on Analyzer |
| UCI Submissions / Inbox / COS / CIAC / Energization / Miss Utility / Builder / Load Profile / Provider Map / Meter-Set | **Page tabs or nested sidebar under `/uci`** — do **not** drop PP APIs; add Lovable IA without mock pages |
| Permit Queue, Glossary | **Sidebar placeholders** until backed — already `comingSoon` |
| Admin Authorizations / Members / Audit | **Admin preview** until LOA/members product decision — already placeholders |
| Analytics, ROI, Consolidation, Checklists, Pricing, Docs, FAQ, Contact, Settings | Resources / Help — already |
| Baltimore `*` | **Direct-route-only** (hidden from primary nav) — keep |
| Token portals `/portal|embed|invite/:token` | **Direct-route-only**, no app sidebar required |
| Design system preview | Dev-only Help item — keep |
| Onboarding LOA (`/onboarding/authorization`) | Placeholder or exclude until backend — Lovable-only today |
| Demo McDonalds | Map to `/demos` (PP) — do not ship Lovable mock demo as production |

### Project selector / controls vs Lovable

| Control | Lovable | PP today | Target |
|---------|---------|----------|--------|
| Active project | Header select | Header select + sidebar permit # / credentials / create project | Keep header as **source of truth** (`SelectedProjectContext`); demote sidebar create/permit to project sheet or Settings |
| Scrape start / progress | Not in Lovable shell | `ScrapeContext` + sidebar + `ScrapeProgressPanel` + header indicator | Keep real scrape UX; surface progress in **Portal Harvest** + header indicator; reduce sidebar density |
| New project | Dashboard / Projects CTA | Projects dialog + sidebar create | Match Lovable CTAs; wire `ProjectFormDialog` / credentials via Settings API (never client-side password vault) |

---

## 3. Special deep dives

### 3.1 Dashboard — why Intake Pipeline is still present

**Lovable:** `reference/lovable-ui/src/pages/Dashboard.tsx`  
- Layout shell + Ops / Utility Coordination tabs (`DashboardLayout` + `Outlet`)  
- Overview (`DashboardOverview`): **4 KPI cards** → **Active Projects table** (2fr) + **Intelligence & Alerts** timeline (1fr)  
- Mock `stats` / `portfolio` / `alerts` arrays L6–25  

**Current:** `src/pages/Dashboard.tsx` (598 lines)

| Region | Lines (approx) | What it is |
|--------|----------------|------------|
| Lovable-like header + pills + Ops/UCI tabs | L197–261 | Structural match start |
| KPI grid from `useProjects` | L263–291 | Lovable composition, **different KPI labels** |
| Subscription banners | L293–333 | PP-only (keep) |
| Active Projects table | L335–422 | Lovable composition, PP columns |
| Intelligence panel | L424–473 | Partial: quick links + `DeadlineAlertsWidget`, **not** Lovable alert timeline |
| GettingStartedChecklist | L476 | PP onboarding (keep, demote) |
| **Portal monitor → `AgentWorkflowStatus`** | **L478–481** | **Legacy Intake Pipeline still mounted** |
| ProjectHealth / Inspections / Checklists | L483–488 | Legacy dashboard widgets |
| Saved Calculations | L490–592 | Legacy PP feature |

**Intake Pipeline evidence:** `src/components/dashboard/AgentWorkflowStatus.tsx` L2204–2210 still renders:

```text
EyebrowDark: "Intake pipeline"
SectionTitle: "PermitPilot Intake Pipeline"
```

Invokes `intake-pipeline-agent` (same file ~L535+).

**Why it remains**

1. Pre-Lovable Dashboard was agent-chain / calculator / widget hub; Intake Pipeline was the **hero**.  
2. Commit `435576b` added Lovable KPI + table **above** legacy widgets but **did not remove or relocate** `AgentWorkflowStatus`.  
3. Product instinct was “preserve functionality by keeping the old body visible” — exactly the anti-pattern in the problem statement.  
4. Lovable has **no** Intake Pipeline section; agent-chain belongs as a **Delivery / project-context** surface (Portal Harvest, Comment Review, or a Dashboard drawer), not co-primary body.

**Classification:** `partial_page_replication`  
*(Not `old_page_still_primary` — KPIs + Active Projects are now the visual top. Not `true_match` — Intake Pipeline + widget stack still dominate scroll depth; Intelligence ≠ Lovable.)*

**Exact missing work**

- Relocate `AgentWorkflowStatus` off primary Dashboard composition.  
- Rebuild Intelligence & Alerts from real scrape/deadline/comment signals (adapter), Lovable timeline layout.  
- Align KPI set to Lovable semantics **mapped from PP data** (or document intentional PP KPI set).  
- Demote Saved Calculations / Getting Started / punch-list to secondary tabs or Resources.  
- Optional nested route `/dashboard/uci` → redirect or embed UCI overview (Lovable pattern).

**Files to change:** `src/pages/Dashboard.tsx`, `src/components/dashboard/AgentWorkflowStatus.tsx` (move/consume), `src/adapters/dashboardKpiAdapter.ts`, optionally new `src/components/dashboard/IntelligenceAlerts.tsx`, `src/App.tsx` if nested dashboard routes added.

---

### 3.2 Projects

| | Lovable | PP |
|--|---------|-----|
| File | `reference/lovable-ui/src/pages/Projects.tsx` | `src/pages/Projects.tsx` |
| Composition | PageHeader → 4 MetricCards → AlertBanner → filter chips → **2-col Panel cards** (services, blockers, progress, next action) | Same chrome + metrics (`L250+`) **plus** search, cards/kanban/list toggle, `ProjectFormDialog` / `ProjectDetailDialog` / `DeleteProjectDialog`, Kanban drag |
| Data | Mock `projects` from `permitpilot/data.ts` | `useProjects` + `SelectedProjectContext` |

**Classification:** `partial_page_replication`  
**Old UI still rendered:** Kanban columns + list view + detail dialogs as first-class modes (preserve capability; restyle into Lovable card primary + detail drawer).  
**Missing:** Lovable service pills / blocker chips / queue health / progress fidelity; `/projects/new` credentials chrome → Settings vault, not mock.

**Files:** `src/pages/Projects.tsx`, `src/adapters/projectCardAdapter.ts`, `src/components/projects/*`, optionally route alias for create chrome.

---

### 3.3 Portal Harvest

| | Lovable | PP |
|--|---------|-----|
| Route | `/portals/harvest` | `/portal-data` |
| File | `reference/lovable-ui/src/pages/PortalHarvest.tsx` (157 lines) | `src/pages/PortalDataViewer.tsx` (**5132** lines) |
| Composition | PageHeader → 4 MetricCards → AlertBanner → **queue table (1.2fr) + Recent harvest + Fallback playbook (0.8fr)** | PageHeader + MetricCards (`L3047–3117`) then **Accela/PGC/Fairfax/Baltimore tabbed portal detail** as primary body |

**Classification:** `partial_page_replication`  
**Old UI still primary for operations:** jurisdiction portal tabs (`AccelaProjectView`, `PgcStatusTab`, etc.) remain the interactive core after chrome.  
**Logic to keep:** `useScrape`, `useScrapeFileResults`, Arlington live refresh, portal view resolvers, file open URLs, real Force Sync.  
**Missing:** Lovable **monitoring queue** composition as the default landing; nest Accela detail as drill-in / second pane; Recent harvest feed from scrape job events; Fallback playbook from real auth/degraded states (`scrapeStatusAdapter`).

**Files:** `src/pages/PortalDataViewer.tsx` (split recommended), `src/components/portal/*`, `src/contexts/ScrapeContext.tsx`, `src/components/scrape/ScrapeProgressPanel.tsx`, `src/adapters/scrapeStatusAdapter.ts`, new harvest queue presentational component.

---

### 3.4 Response Matrix

| | Lovable | PP |
|--|---------|-----|
| Route | `/matrix/response` | `/response-matrix` |
| File | `reference/lovable-ui/src/pages/ResponseMatrix.tsx` (170 lines, mock rows) | `src/pages/ResponseMatrix.tsx` (1819 lines) |
| Composition | PageHeader → MetricCards → AlertBanner → clean table + Reconciliation/AI scoring toggle | Same chrome (`L1222–1289`) then **full PP reconciliation** (grounded drafts, approval, export package, plan markup, timers) |

**Classification:** `partial_page_replication`  
**Keep:** all Edge/agent/export/approval logic.  
**Missing:** Lovable table chrome density, scoring view toggle wired to real confidence fields, filter bar parity; reduce visual noise of legacy controls into Lovable action clusters.

**Files:** `src/pages/ResponseMatrix.tsx`, `src/components/response-matrix/*`, `src/adapters/commentResponseAdapter.ts`.

---

### 3.5 Permit Wizard / Guided Flow

| | Lovable | PP |
|--|---------|-----|
| Route | `/matrix/guided` | `/permit-wizard-filing` |
| File | `reference/lovable-ui/src/pages/GuidedFlow.tsx` | `src/pages/PermitWizardFiling.tsx` |
| Composition | Stage sidebar + outstanding tasks + metrics | PageHeader/MetricCards + municipality/filing lists + `FilingReviewPanel` / `StartFilingDialog` / `AgentRunDetail` |

**Classification:** `partial_page_replication`  
**Missing:** Lovable left **workflow stages** rail; map filing_status → stage model via `filingStatusAdapter`; keep real filing APIs.

**Files:** `src/pages/PermitWizardFiling.tsx`, `src/components/permit-wizard/*`, `src/adapters/filingStatusAdapter.ts`.

---

### 3.6 Compliance Analyzer

| | Lovable | PP |
|--|---------|-----|
| Route | `/compliance/analyzer` | `/code-compliance` |
| File | `reference/lovable-ui/src/pages/ComplianceAnalyzer.tsx` (1037 lines, rich mock UI) | `src/pages/CodeCompliance.tsx` (56 lines) wrapping `AIComplianceAnalyzer` |

**Classification:** `partial_page_replication` (thin chrome) bordering `cosmetic_only` for body  
**Keep:** `/api/analyze-drawing`, `AIComplianceAnalyzer`, ErrorBoundary.  
**Missing:** Lovable multi-panel findings layout around **real** analysis results — do not copy Lovable edge mocks.

**Files:** `src/pages/CodeCompliance.tsx`, `src/components/compliance/AIComplianceAnalyzer.tsx`, findings presentational split.

---

### 3.7 UCI

| | Lovable | PP |
|--|---------|-----|
| Routes | `/uci` + stage routes + `/utility/*` hub tiles | **Single** `/uci` → `UciDashboard.tsx` (~4500+ lines of real API wiring) |
| Visual | Hub tiles, quarter filters, mock portfolio metrics (`reference/lovable-ui/src/pages/UciDashboard.tsx`) | PageHeader/MetricCard chrome layered on **monolithic** coordination UI |

**Classification:** `partial_page_replication`  
**Keep:** `uciApi.ts` clients, access gates, stage enums, PEPCO live-submit gates.  
**Missing:** Lovable hub tile IA as navigation to **existing** stage panels (extract from monolith or deep-link sections); do **not** ship Lovable mock hubTiles data; register child routes only when panels are real.

**Files:** `src/pages/UciDashboard.tsx`, `src/components/uci/*` (if present), `src/adapters/uciCoordinationAdapter.ts`, `src/App.tsx`, `src/components/layout/hybridNav.ts`, access config.

---

### 3.8 Settings

| | Lovable | PP |
|--|---------|-----|
| File | `reference/lovable-ui/src/pages/Settings.tsx` | `src/pages/Settings.tsx` |
| Tabs | profile / security / notifications / portals / architect / branding / cleanup | Same tab set (`L379+`) with real managers |

**Classification:** `partial_page_replication`  
Closest to visual parity among complex pages. Gaps: Lovable section/Field chrome density; Portal Credentials manager visual redesign without changing secrecy APIs.

**Files:** `src/pages/Settings.tsx`, `src/components/settings/*`.

---

### 3.9 Admin

| | Lovable | PP |
|--|---------|-----|
| Hub | `AdminConsole.tsx` — KPI row, audit trail, infra, training tracker, links to child admin pages | `AdminPanel.tsx` inside `AdminPageShell` — Lovable title “Workspace Operations” + KPI cards (`L550+`) then **legacy admin tabs** (users/subscribers/drips) |
| Children | Authorizations, Members, Audit, Invoicing, CRM, … (mostly mock) | Real: jurisdictions, feature-flags, shadow-mode; Preview placeholders for authorizations/members/audit |

**Classification:** `/admin` → `partial_page_replication`; preview children → `not_started`; real children → `cosmetic_only`.

**Files:** `src/pages/AdminPanel.tsx`, `src/components/admin/AdminPageShell.tsx`, placeholders under `src/pages/placeholders/`, admin child pages.

---

## 4. Route-by-route audit matrix

Legend columns abbreviated: **Shell** / **Nav** / **Composition** / **Hierarchy** / **Widgets** (cards/tables/tabs/drawers) / **Project ctx** / **Responsive** = match quality vs Lovable (`yes` / `partial` / `no` / `n/a`).

### 4.1 Public / marketing / auth / tokens

#### `/` — Landing
- **Lovable:** `reference/lovable-ui/src/pages/Home.tsx` (inside shell)  
- **PP:** `src/pages/LandingPage.tsx` → CommunET marketing (`PublicOnlyRoute`)  
- **Class:** `cosmetic_only`  
- **Logic keep:** auth redirect, marketing CTAs  
- **Old UI:** full marketing body  
- **Missing:** visual alignment to Lovable Home **without** putting anon users in app shell (PD-3)  
- **Files:** landing/marketing components, `src/App.tsx` (layout choice only)

#### `/auth` (+ `/login`, `/signup` redirects)
- **Lovable:** `Login.tsx`, `Signup.tsx`  
- **PP:** `src/pages/Auth.tsx`; redirects in `App.tsx` L90–91  
- **Class:** `/auth` → `cosmetic_only`; redirects → `intentional_exception`  
- **Logic keep:** Supabase `useAuth`, subscription fields, scraper JWT session  
- **Missing:** Lovable split-form chrome on combined auth  
- **Files:** `src/pages/Auth.tsx`

#### `/demos`, `/pricing`, `/faq`, `/install`
- **Lovable:** partial (`DemoMcDonalds.tsx`) / none  
- **PP:** respective `src/pages/*`  
- **Class:** `cosmetic_only`  
- **Keep:** Stripe checkout, lead capture, FAQ content, PWA install  
- **Files:** matching page files + shared primitives

#### `/contact`
- **Lovable:** `reference/lovable-ui/src/pages/Contact.tsx`  
- **PP:** `src/pages/Contact.tsx` (commit `9ce9436` two-column support layout)  
- **Class:** `partial_page_replication`  
- **Keep:** `send-contact-email` edge  
- **Missing:** final visual parity / form field chrome  
- **Files:** `src/pages/Contact.tsx`, `src/components/home/ContactForm.tsx` if used

#### `/portal/:token`, `/embed/:token`, `/invite/:token`
- **Lovable:** none  
- **Class:** `intentional_exception`  
- **Keep:** token access, realtime, invite RPCs  
- **Work:** optional token restyle only — never remove

#### `*` NotFound
- **Lovable:** redirects to `/dashboard` — **do not copy** for public  
- **Class:** `intentional_exception`  
- **Files:** `src/pages/NotFound.tsx`

---

### 4.2 Core protected

#### `/dashboard` → `src/pages/Dashboard.tsx`
- **Lovable:** `reference/lovable-ui/src/pages/Dashboard.tsx`  
- **Shell/Nav/Composition/Hierarchy/Widgets/Project/Responsive:** partial / partial / partial / partial / partial / partial / partial  
- **Class:** `partial_page_replication`  
- **Logic keep:** `useAuth`, `useProjects`, `useSelectedProject`, `useOnboarding`, `useGettingStarted`, subscription checkout toast, profile fetch  
- **Old UI still rendered:** `AgentWorkflowStatus` (Intake Pipeline), `ProjectHealthCard`, `InspectionsPunchListWidget`, `RecentChecklistsWidget`, Saved Calculations grid, `GettingStartedChecklist`  
- **Missing work:** see §3.1  
- **Files:** listed in §3.1  
- **Adapter:** `dashboardKpiAdapter.ts`  
- **States:** loading skeletons for KPIs/table; empty projects CTA; auth redirect  
- **Acceptance:** no Intake Pipeline as Dashboard section; Lovable 4-KPI + table + alerts timeline; PP data only  
- **Regression:** project select navigation; subscription banner; onboarding wizard still opens

#### `/projects` → `src/pages/Projects.tsx`
- **Lovable:** `reference/lovable-ui/src/pages/Projects.tsx`  
- **Class:** `partial_page_replication`  
- **Logic keep:** CRUD, Kanban status updates, dialogs, `useGettingStarted`  
- **Old UI:** Kanban/list as equal peers to cards  
- **Missing:** card anatomy (blockers/services/progress/next); create flow chrome  
- **Files:** §3.2  
- **Acceptance:** card grid primary matches Lovable; Kanban available without owning first paint  
- **Regression:** create/edit/delete/drag-status; selected project sync

#### `/analytics`
- **Lovable ref:** `PortfolioExecutive.tsx`  
- **PP:** `src/pages/Analytics.tsx`  
- **Class:** `cosmetic_only`  
- **Keep:** `useAnalytics` / project analytics  
- **Missing:** executive report composition  
- **Files:** `src/pages/Analytics.tsx`

#### `/jurisdictions/compare`, `/jurisdiction-comparison`, `/jurisdictions/map`, `/jurisdictions/:stateCode`
- **Lovable refs:** `UtilityMap.tsx`, `UtilityCoverage.tsx`, `UtilityProviderMap.tsx` (partial)  
- **Class:** compare/map/state → `cosmetic_only`; alias → `intentional_exception`  
- **Keep:** Mapbox token, comparison tool, jurisdiction queries  
- **Files:** respective pages + map components

#### `/permit-intelligence`, `/code-reference`, `/roi-calculator`, `/consolidation-calculator`
- **Class:** `cosmetic_only`  
- **Keep:** Shovels edge, code matrix, `saved_calculations`  
- **Files:** matching pages

#### `/code-compliance`
- See §3.6 — **`partial_page_replication`**

#### `/checklist-history`, `/checklists`
- **Lovable:** `Checklists.tsx` @ `/checklists`  
- **Class:** history → `cosmetic_only`; `/checklists` alias → `intentional_exception`  
- **Keep:** `useSavedChecklists`  
- **Files:** `src/pages/ChecklistHistory.tsx`

#### `/settings`
- See §3.8 — **`partial_page_replication`**

#### `/uci`
- See §3.7 — **`partial_page_replication`**

#### `/design-system-preview`
- **Class:** `intentional_exception` (internal)

#### `/mvp-documentation`, `/api-docs`
- **Class:** `cosmetic_only`

---

### 4.3 Operational workflows

#### `/portal-data`
- See §3.3 — **`partial_page_replication`**

#### `/response-matrix`
- See §3.4 — **`partial_page_replication`**

#### `/permit-wizard-filing`
- See §3.5 — **`partial_page_replication`**

#### `/comment-review`, `/classified-comments`
- **Lovable:** no first-class equivalent (PP-only)  
- **Class:** `cosmetic_only`  
- **Keep:** intake-pipeline invoke, parsers, classification  
- **Nav:** group under Delivery  
- **Files:** `CommentReview.tsx`, `ClassifiedComments.tsx`

---

### 4.4 Admin

#### `/admin`
- See §3.9 — **`partial_page_replication`**

#### `/admin/jurisdictions`, `/admin/feature-flags`, `/admin/shadow-mode`
- **Class:** `cosmetic_only`  
- **Keep:** admin APIs / shadow metrics  
- **Files:** respective pages + `AdminPageShell`

#### `/admin/authorizations`, `/admin/members`, `/admin/audit`
- **PP:** placeholders (`AdminPreviewPlaceholders.tsx`)  
- **Lovable:** real mock pages  
- **Class:** `not_started`  
- **Do not** fake LOA/members without backend decision

#### `/permit-queue`, `/reference/glossary`
- **Class:** `not_started` (Coming soon placeholders)

---

### 4.5 Baltimore (PP-only mock Accela)

- **Routes:** `/baltimore`, `/baltimore/permits`, `/baltimore/records`, `/baltimore/records/:recordId`  
- **Class:** `intentional_exception`  
- **Keep:** routes; remain out of primary nav  
- **Optional:** token restyle only

---

## 5. Route-by-route implementation plan (file-by-file)

For each **in-scope** route below: target structure, logic source, adapter, retain/replace/move, mappings, states, acceptance, tests.

### Shared prerequisites (all routes)

| Item | Action |
|------|--------|
| Primitives | Prefer `src/components/design/ProductPrimitives.tsx` (already Lovable-aligned); stop parallel editorial leftovers |
| Adapters | Presentation-only under `src/adapters/*` — expand usage |
| Shell | Evolve `DashboardLayout`/`AppSidebar` toward Lovable density **or** adopt shell module while preserving providers |
| Data rule | Never import `reference/lovable-ui/.../data.ts` mocks into production paths |
| Tests | Prefer existing Vitest/RTL patterns; add route smoke + critical action tests |

---

### A. Dashboard `/dashboard`

| Field | Plan |
|-------|------|
| **Target Lovable structure** | Header + service pills + Ops/UCI tabs; 4 KPIs; Active Projects table; Intelligence & Alerts timeline; **no** Intake Pipeline section |
| **Business logic source** | `useProjects`, `useSelectedProject`, `useAuth` subscription, deadlines hooks inside `DeadlineAlertsWidget`, scrape signals optional |
| **Presentation adapter** | `dashboardKpiAdapter.ts` — map project statuses → KPI + table rows + alert items |
| **Retain** | OnboardingWizard, subscription CTA, auth redirect |
| **Replace** | Intelligence body (build timeline) |
| **Move** | `AgentWorkflowStatus` → Portal Harvest / Comment Review / project drawer |
| **Data mapping** | `Project` → portfolio row (name, jurisdiction, status tone, portal, updated) |
| **Status mapping** | `PROJECT_STATUS_CONFIG` → `StatusPill` tones |
| **States** | auth loading; projects skeleton; empty CTA; subscription warn |
| **Acceptance** | Gate §0; Intake Pipeline not on Dashboard DOM |
| **Regression** | checkout success toast; select project → `/projects`; UCI tab navigates to `/uci` |

### B. Projects `/projects`

| Field | Plan |
|-------|------|
| **Target** | MetricCards + filters + 2-col Panel cards primary |
| **Logic** | `useProjects` CRUD + status |
| **Adapter** | `projectCardAdapter.ts` |
| **Retain** | Dialogs, Kanban (secondary mode), search |
| **Replace** | Card inner layout to Lovable anatomy |
| **States** | loading / empty EmptyState / error toasts |
| **Acceptance** | First paint = Lovable cards; CRUD intact |
| **Regression** | drag Kanban; delete; selected project |

### C. Portal Harvest `/portal-data`

| Field | Plan |
|-------|------|
| **Target** | MetricCards + queue table + recent harvest + fallbacks; detail drill-in |
| **Logic** | `ScrapeContext`, portal_data, live file results, jurisdiction views |
| **Adapter** | `scrapeStatusAdapter.ts` + new harvest queue mapper |
| **Retain** | All Accela/PGC/Fairfax/Baltimore viewers |
| **Replace** | Default landing composition |
| **Move** | Split `PortalDataViewer.tsx` into harvest shell + `PortalDetailTabs` |
| **States** | no project; scraping; empty portal_data; auth/degraded |
| **Acceptance** | Lovable monitoring layout first; Force Sync real |
| **Regression** | Arlington progressive scrape; file open; tab error boundaries |

### D. Response Matrix `/response-matrix`

| Field | Plan |
|-------|------|
| **Target** | MetricCards + clean table + view toggle + action cluster |
| **Logic** | parsed_comments, grounded draft queue, approval, exports |
| **Adapter** | `commentResponseAdapter.ts` |
| **Retain** | All drafting/approval/export/markup |
| **Replace** | Visual hierarchy of toolbar vs Lovable |
| **States** | no project; empty comments; drafting busy; approval blocked |
| **Acceptance** | Lovable structure; zero mock rows |
| **Regression** | auto-draft, export package, status transitions |

### E. Permit Filing `/permit-wizard-filing`

| Field | Plan |
|-------|------|
| **Target** | GuidedFlow stage rail + task queue + metrics |
| **Logic** | filings tables, municipalities, agent runs |
| **Adapter** | `filingStatusAdapter.ts` |
| **Retain** | StartFilingDialog, FilingReviewPanel, AgentRunDetail |
| **Replace** | Page frame to stage+tasks |
| **States** | loading municipalities; empty filings; agent running/failed |
| **Acceptance** | Stage rail visible; start filing works |
| **Regression** | multi-municipality start; review panel |

### F. Compliance `/code-compliance`

| Field | Plan |
|-------|------|
| **Target** | Analyzer multi-pane around real results |
| **Logic** | `AIComplianceAnalyzer` + `/api/analyze-drawing` |
| **Retain** | ErrorBoundary, getting-started mark |
| **Replace** | Outer findings chrome only |
| **States** | idle / analyzing / error / results |
| **Acceptance** | Lovable-like findings UI; live API only |
| **Regression** | upload + analyze success path |

### G. UCI `/uci`

| Field | Plan |
|-------|------|
| **Target** | Hub tiles navigating to real stage sections/routes |
| **Logic** | existing coordination APIs in `UciDashboard` / `uciApi` |
| **Adapter** | `uciCoordinationAdapter.ts` |
| **Retain** | All stage mutations & access checks |
| **Replace** | First paint hub; extract panels |
| **States** | access denied; session expired; empty coordination; blocked |
| **Acceptance** | Hub matches Lovable IA; tiles open real panels |
| **Regression** | provider resolve, load profile, package build, PEPCO gate |

### H. Settings `/settings`

| Field | Plan |
|-------|------|
| **Target** | Lovable tab + Section/Field chrome |
| **Logic** | profiles, password, notifications, PortalCredentialsManager, mailbox, architect, branding, cleanup |
| **Retain** | All managers / secrecy |
| **Replace** | Visual section wrappers |
| **Acceptance** | Tab parity; credentials never plaintext list of secrets |
| **Regression** | save profile; credential CRUD; cleanup confirm |

### I. Admin `/admin`

| Field | Plan |
|-------|------|
| **Target** | AdminConsole hub (KPIs, audit strip, child links) over real counts |
| **Logic** | existing AdminPanel data sources |
| **Retain** | Users/subscribers/drips capabilities (as tabs or child routes) |
| **Replace** | Hub first paint |
| **Acceptance** | Hub looks like Lovable; no fake invoices |
| **Regression:** admin auth gate |

### J. Shell / nav (cross-cutting)

| Field | Plan |
|-------|------|
| **Target** | Lovable sidebar density + header project picker; scrape indicator |
| **Logic** | `SelectedProjectProvider`, `ScrapeProvider`, admin gates |
| **Retain** | Favorites, command palette, mobile nav, scrape panel |
| **Move** | Sidebar scrape/permit block → Harvest / project sheet |
| **Acceptance** | Nav groups match agreed IA; no lost hrefs |
| **Regression** | scrape cancel/minimize; project persistence |

### K. Lower-priority cosmetic routes

For each `cosmetic_only` route: wrap with `PageHeader`/`Panel` if missing; align tables to pilot-card; keep hooks; acceptance = “reads as same design system,” not full Lovable page clone when no reference exists.

---

## 6. Exact implementation sequence (dependency order)

Cursor should execute in this order — **do not skip gates**.

| Step | Work | Why first | Exit gate |
|------|------|-----------|-----------|
| **S0** | Confirm branch `feat/lovable-ui-replication`; freeze PD-1…PD-14 | Safety | Branch verified |
| **S1** | Shell density + project picker ownership + nav grouping (Comments under Delivery; UCI children plan) | All pages inherit | Sidebar matches agreed IA; scrape still works |
| **S2** | Dashboard true composition (relocate Intake Pipeline) | Highest visibility client gap | §3.1 acceptance |
| **S3** | Projects card-primary | Core IA | §5.B |
| **S4** | Portal Harvest shell split + queue landing | Unblocks scrape UX narrative | §5.C |
| **S5** | Response Matrix chrome pass | Delivery trio | §5.D |
| **S6** | Permit Filing GuidedFlow frame | Delivery trio | §5.E |
| **S7** | Settings visual Section pass | Credentials trust | §5.H |
| **S8** | Compliance findings chrome | Intelligence | §5.F |
| **S9** | UCI hub extraction + optional child routes | Largest FE risk | §5.G |
| **S10** | Admin hub | Admin | §5.I |
| **S11** | Analytics → PortfolioExecutive chrome | Resources | cosmetic→partial |
| **S12** | Marketing/auth/contact polish | Public | PD-3 respected |
| **S13** | Comment Review / Classified / jurisdiction tools polish | PP-only | cosmetic complete |
| **S14** | Placeholders decision (Queue, Glossary, Admin previews) | Avoid fake features | `not_started` cleared or explicitly deferred |
| **S15** | Responsive pass + regression matrix (Phase 7 checklist) | Ship quality | Gate §0 all in-scope |
| **S16** | Client visual review vs `reference/lovable-ui` | Sign-off | Human approval before `main` |

**Do not** start S9 (UCI multi-route) before S1–S2.  
**Do not** register Lovable mock-only routes (Mission Control, SIR, Closeout, …) as production without product approval.

---

## 7. Exact files expected to change (implementation phase)

> Listed for planning. **Not modified in this audit.**

### Shell / nav
- `src/components/layout/DashboardLayout.tsx`
- `src/components/layout/AppSidebar.tsx`
- `src/components/layout/hybridNav.ts`
- `src/components/layout/MobileBottomNav.tsx`
- `src/components/layout/EditorialPageHeader.tsx` (deprecate or alias)
- `src/components/navigation/CommandPalette.tsx`
- `src/App.tsx` (nested dashboard / UCI routes only when ready)

### Design system
- `src/components/design/ProductPrimitives.tsx`
- `src/components/design/EmptyState.tsx`
- `src/index.css`, `tailwind.config.ts`

### Adapters
- `src/adapters/dashboardKpiAdapter.ts`
- `src/adapters/projectCardAdapter.ts`
- `src/adapters/scrapeStatusAdapter.ts`
- `src/adapters/commentResponseAdapter.ts`
- `src/adapters/filingStatusAdapter.ts`
- `src/adapters/uciCoordinationAdapter.ts`
- *(new as needed)* harvestQueueAdapter, intelligenceAlertsAdapter, adminHubAdapter

### Pages (primary)
- `src/pages/Dashboard.tsx`
- `src/pages/Projects.tsx`
- `src/pages/PortalDataViewer.tsx` (**split**)
- `src/pages/ResponseMatrix.tsx`
- `src/pages/PermitWizardFiling.tsx`
- `src/pages/CodeCompliance.tsx`
- `src/pages/UciDashboard.tsx` (**extract**)
- `src/pages/Settings.tsx`
- `src/pages/AdminPanel.tsx`
- `src/pages/Analytics.tsx`
- `src/pages/Auth.tsx`, `Contact.tsx`, marketing pages as scheduled

### Components to relocate / restyle
- `src/components/dashboard/AgentWorkflowStatus.tsx` (**move off Dashboard primary**)
- `src/components/dashboard/*` widgets
- `src/components/portal/*`, `src/components/scrape/*`
- `src/components/response-matrix/*`, `src/components/permit-wizard/*`
- `src/components/compliance/AIComplianceAnalyzer.tsx`
- `src/components/settings/*`
- `src/components/admin/AdminPageShell.tsx`
- `src/components/projects/*`

### Reference only (do not copy mocks into `src/` wholesale)
- `reference/lovable-ui/src/pages/*.tsx`
- `reference/lovable-ui/src/components/permitpilot/*`

---

## 8. Estimated remaining effort by route group

| Group | Routes | Est. eng effort | Notes |
|-------|--------|-----------------|-------|
| Shell / nav / project controls | cross-cutting | **3–5 d** | Density + scrape relocation |
| Dashboard | 1 | **2–3 d** | Relocate Intake Pipeline; alerts adapter |
| Projects | 1 | **2–3 d** | Card anatomy + keep Kanban |
| Portal Harvest | 1 | **5–8 d** | Split 5k-LOC viewer; queue landing |
| Response Matrix | 1 | **3–5 d** | Chrome without breaking drafts |
| Permit Filing | 1 | **3–4 d** | GuidedFlow frame |
| Compliance | 1 | **2–3 d** | Findings layout |
| UCI | 1 (+ optional children) | **8–12 d** | Highest risk; extract hub |
| Settings | 1 | **1–2 d** | Mostly visual |
| Admin hub + children | 4–7 | **3–5 d** | Hub real; previews deferred |
| Cosmetic PP-only tools | ~15 | **4–6 d** | System consistency |
| Marketing / auth | ~6 | **2–3 d** | PD-3 |
| Placeholders / exceptions | ~10 | **0–2 d** | Decisions > code |
| Responsive + regression | all | **3–4 d** | Phase 7 |
| **Total (in-scope true replication)** | | **~40–65 eng-days** | Calendar depends on parallelization |

---

## 9. End report

### Overall true replication percentage

**~32% weighted** across 37 scorable active routes (0 `true_match`).  
**Strict structural true-match: 0%.**  
Prior “~95%” claims measured tokens/chrome, not Lovable page composition. The earlier “~18–22%” audit was directionally right for mid-branch state but **understates HEAD** after Dashboard/Projects/Harvest/Matrix structural commits.

### Shell-only routes

None labeled `shell_only` at route level — shell work is **app-wide `partial`**. Routes that only got tokens/PageHeader without body work are classified **`cosmetic_only`** (majority of tool pages).

### Old-page-primary routes

None labeled `old_page_still_primary` after KPI/chrome landings — but **legacy bodies remain co-primary** inside:

- Dashboard (`AgentWorkflowStatus` Intake Pipeline)  
- Portal Harvest (Accela tab viewer)  
- Response Matrix / Filing / UCI monoliths  

Treat these as **highest-risk partials**, not done.

### Routes not started

- `/permit-queue`  
- `/reference/glossary`  
- `/admin/authorizations`  
- `/admin/members`  
- `/admin/audit`  

### Intentional exceptions

- `/login`, `/signup` redirects  
- `/jurisdiction-comparison`, `/checklists` aliases  
- Token portals `/portal|embed|invite/:token`  
- Baltimore suite  
- `/design-system-preview`  
- `*` 404 policy (no silent redirect to dashboard for public)

### Exact root causes

1. **Chrome-first migration** — PageHeader/MetricCard wrapped around unchanged PP bodies.  
2. **Functionality preservation via co-mounting** — Intake Pipeline kept on Dashboard instead of relocated.  
3. **Monolith pages** — `PortalDataViewer` / `UciDashboard` / `ResponseMatrix` too large to restyle in-place without split.  
4. **Lovable mock IA vs PP route reality** — many Lovable routes intentionally excluded; hybrid nav still incomplete for UCI stages.  
5. **Shell not swapped** — `PermitPilotShell` reference unused; scrape/project controls remain sidebar-heavy.  
6. **Stale success metrics** — token parity reported as completion.

### Exact implementation order

See **§6** (S0→S16): Shell → Dashboard → Projects → Harvest → Matrix → Filing → Settings → Compliance → UCI → Admin → Analytics → Marketing → PP-only polish → Placeholders → Regression → Client review.

### Exact files expected to change

See **§7**.

### Estimated remaining effort

See **§8** (~40–65 eng-days for true in-scope replication).

### Confirmation: no application code modified

**Confirmed.** This audit created/updated only:

`docs/lovable-ui-full-gap-and-replication-plan.md`

No files under `src/`, `scraper-service/`, or other application paths were changed for this task.

---

## 10. Appendix — classification rollup table

| Route | Component | Lovable ref | Classification |
|-------|-----------|-------------|----------------|
| `/` | LandingPage | Home.tsx | cosmetic_only |
| `/auth` | Auth | Login/Signup | cosmetic_only |
| `/login` | Navigate | Login.tsx | intentional_exception |
| `/signup` | Navigate | Signup.tsx | intentional_exception |
| `/demos` | Demos | DemoMcDonalds (partial) | cosmetic_only |
| `/pricing` | Pricing | — | cosmetic_only |
| `/contact` | Contact | Contact.tsx | partial_page_replication |
| `/faq` | FAQ | — | cosmetic_only |
| `/install` | Install | — | cosmetic_only |
| `/portal/:token` | ClientPortal | — | intentional_exception |
| `/embed/:token` | EmbedWidget | — | intentional_exception |
| `/invite/:token` | InviteAcceptPage | — | intentional_exception |
| `/dashboard` | Dashboard | Dashboard.tsx | **partial_page_replication** |
| `/projects` | Projects | Projects.tsx | **partial_page_replication** |
| `/analytics` | Analytics | PortfolioExecutive.tsx | cosmetic_only |
| `/jurisdictions/compare` | JurisdictionComparison | UtilityProviderMap (partial) | cosmetic_only |
| `/jurisdiction-comparison` | alias | — | intentional_exception |
| `/jurisdictions/map` | JurisdictionMapPage | UtilityMap.tsx | cosmetic_only |
| `/jurisdictions/:stateCode` | StateLandingPage | — | cosmetic_only |
| `/permit-intelligence` | PermitIntelligence | — | cosmetic_only |
| `/code-compliance` | CodeCompliance | ComplianceAnalyzer.tsx | **partial_page_replication** |
| `/code-reference` | CodeReferenceLibrary | ReferenceLibrary.tsx | cosmetic_only |
| `/roi-calculator` | ROICalculator | — | cosmetic_only |
| `/consolidation-calculator` | ConsolidationCalculator | — | cosmetic_only |
| `/admin` | AdminPanel | AdminConsole.tsx | **partial_page_replication** |
| `/admin/jurisdictions` | JurisdictionAdmin | — | cosmetic_only |
| `/admin/feature-flags` | FeatureFlagsAdmin | — | cosmetic_only |
| `/admin/shadow-mode` | ShadowModeDashboard | — | cosmetic_only |
| `/admin/authorizations` | Placeholder | AdminAuthorizations.tsx | not_started |
| `/admin/members` | Placeholder | AdminMembers.tsx | not_started |
| `/admin/audit` | Placeholder | AdminAuditLog.tsx | not_started |
| `/mvp-documentation` | MVPDocumentation | — | cosmetic_only |
| `/api-docs` | APIDocumentation | AdminEndpoints (not same) | cosmetic_only |
| `/checklist-history` | ChecklistHistory | Checklists.tsx | cosmetic_only |
| `/checklists` | alias | Checklists.tsx | intentional_exception |
| `/permit-queue` | Placeholder | PermitQueue.tsx | not_started |
| `/reference/glossary` | Placeholder | Glossary.tsx | not_started |
| `/settings` | Settings | Settings.tsx | **partial_page_replication** |
| `/uci` | UciDashboard | UciDashboard.tsx + stages | **partial_page_replication** |
| `/design-system-preview` | EpermitDesignSystemPreview | — | intentional_exception |
| `/comment-review` | CommentReview | — (PP-only) | cosmetic_only |
| `/response-matrix` | ResponseMatrix | ResponseMatrix.tsx | **partial_page_replication** |
| `/classified-comments` | ClassifiedComments | — (PP-only) | cosmetic_only |
| `/portal-data` | PortalDataViewer | PortalHarvest.tsx | **partial_page_replication** |
| `/permit-wizard-filing` | PermitWizardFiling | GuidedFlow.tsx | **partial_page_replication** |
| `/baltimore*` | Baltimore* | — | intentional_exception |
| `*` | NotFound | redirect (do not copy) | intentional_exception |

---

*End of audit. Ready for structural replication starting at §6 S1–S2 without modifying application code until implementation is explicitly requested.*
