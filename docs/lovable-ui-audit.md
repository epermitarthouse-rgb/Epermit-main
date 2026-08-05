# Lovable UI Audit — PermitPilot / Commun-ET

_Documentation-only snapshot. No UI, route, styling, data, or logic was modified. Extracted directly from the current Lovable project source._

## 1. Scope & method

- Framework: React 18 + Vite 5 + TypeScript, React Router v6, Tailwind CSS 3, shadcn/ui (Radix), TanStack Query 5, Supabase JS (Lovable Cloud).
- Route definitions: `src/App.tsx` (single `<Routes>` tree wrapped by `PermitPilotShell`).
- Sidebar / top-nav definitions: `src/components/permitpilot/PermitPilotShell.tsx`, `src/components/permitpilot/data.ts`.
- Design tokens: `src/index.css` (semantic HSL variables + component utility classes), `tailwind.config.ts`.
- Shared UI primitives: `src/components/ui/*` (49 shadcn components), `src/components/permitpilot/ProductPrimitives.tsx`, `src/components/permitpilot/UciStates.tsx`, `src/components/AccessDenied.tsx`, `src/components/RequireUciAccess.tsx`, `src/components/CsvExportDialog.tsx`, `src/components/home/ContactForm.tsx`, `src/components/permitpilot/GuidedTour.tsx`.

## 2. Route & page inventory

All routes below sit inside the authenticated `<PermitPilotShell>` outlet unless noted. Catch-all `*` redirects to `/dashboard`. Route guarding is client-side; only `/uci/*` and admin pages check role. See `docs/lovable-ui-inventory.json` for the machine-readable version.

### 2.1 Auth & public shell (no layout)

| Route | Page | Component | Purpose |
| --- | --- | --- | --- |
| `/login` | Sign in | `Login.tsx` | Email/password sign-in; logs `sign_in` / `sign_in_failed`; hard-blocks rejected members and signs them out. |
| `/signup` | Sign up | `Signup.tsx` | Self-serve signup; lands in Pending Approval unless matching invite exists. |

### 2.2 Marketing / landing

| Route | Page | Purpose |
| --- | --- | --- |
| `/` | `Home.tsx` | Marketing home hero + service pillars + contact form (`components/home/ContactForm.tsx`). |
| `/contact` | `Contact.tsx` | Contact / meet-an-expert form. |

### 2.3 Command / mission control

| Route | Page | Notes |
| --- | --- | --- |
| `/dashboard` | `Dashboard.tsx` → `<Outlet/>` with `DashboardOverview` index | KPIs, agents, activity feed, task list. New Workflow dialog entry point. |
| `/dashboard/uci` | `UciDashboard.tsx` (nested) | UCI overview (not role-gated on this path). |
| `/mission-control` | `MissionControl.tsx` | High-level multi-project heat map. |
| `/command-center` | `CommandCenter.tsx` | Multi-client portfolio + phase steppers + active project picker. |
| `/permit-queue` | `PermitQueue.tsx` | Global permit queue with statuses. |
| `/critical-path` | `CriticalPath.tsx` | Critical-path intelligence board. |
| `/portfolio/executive` | `PortfolioExecutive.tsx` | Executive-summary portfolio report. |

### 2.4 Projects

| Route | Page | Notes |
| --- | --- | --- |
| `/projects` | `Projects.tsx` | Portfolio list card grid. |
| `/projects/new` | `ProjectSetupCredentials.tsx` | New project + secure portal credential vault. |
| `/projects/alpha` | `ProjectWorkspace.tsx` | Fixed "Project Alpha" detail workspace (hard-coded slug). |
| `/projects/:id/timeline` | `ProjectTimeline.tsx` | Milestone timeline per project. |
| `/projects/:id/gantt` | `ProjectGantt.tsx` | Gantt chart view. |

### 2.5 Feasibility

| Route | Page |
| --- | --- |
| `/feasibility` | `Feasibility.tsx` |
| `/feasibility/site` | `SiteFeasibility.tsx` |

### 2.6 Matrix / workflow

| Route | Page | Notes |
| --- | --- | --- |
| `/matrix` | `MasterMatrix.tsx` | Master unified task matrix. |
| `/matrix/unified` | `UnifiedMatrix.tsx` | Alternate unified matrix. |
| `/matrix/guided` | `GuidedFlow.tsx` | Guided step-by-step permit filing. |
| `/matrix/ai-workflow` | `AiWorkflow.tsx` | Lane-based Kanban with New Workflow dialog (Zod validation, localStorage persistence). `?new=1` opens dialog. |
| `/matrix/response` | `ResponseMatrix.tsx` | AE response verification & AI scoring. |

### 2.7 Compliance / DesignCheck

| Route | Page | Notes |
| --- | --- | --- |
| `/compliance` | `Compliance.tsx` | 8-agent DesignCheck matrix + comment reconciliation. |
| `/compliance/intelligence` | `ComplianceIntelligence.tsx` | Weighted scoring / jurisdictional pass-gate dashboard. |
| `/compliance/analyzer` | `ComplianceAnalyzer.tsx` | Drawing upload + violation detection; presets with searchable notes dialog (500-char limit, live counter, clear action, inline validation). |
| `/compliance/prescreen` | `InternalPrescreen.tsx` | Internal plan prescreen workspace. |

### 2.8 Portals & permits

| Route | Page |
| --- | --- |
| `/portals/harvest` | `PortalHarvest.tsx` |
| `/raze` | `RazePermit.tsx` |
| `/agents` | `AgentCenter.tsx` |
| `/messages` | `Messages.tsx` |
| `/documents` | `DocumentVault.tsx` |

### 2.9 Utility coordination (non-gated helpers)

| Route | Page |
| --- | --- |
| `/utility-map` | `UtilityMap.tsx` |
| `/utility/conflict-hunter` | `CrossUtilityConflictHunter.tsx` |
| `/utility/easements` | `EasementRowManager.tsx` |
| `/utility/load-profile` | `LoadProfileAnalyzer.tsx` |
| `/utility/provider-map` | `UtilityProviderMap.tsx` |
| `/utility/meter-set` | `MeterSetChoreographer.tsx` |
| `/scheduling/long-lead` | `LongLeadEquipment.tsx` |
| `/scheduling/predictive-impact` | `PredictiveScheduleImpact.tsx` |
| `/inspections/release-tracker` | `InspectorReleaseTracker.tsx` |

### 2.10 UCI (role-gated via `<RequireUciAccess>`)

Access matrix in `src/config/uciAccess.ts` (view/manage per `admin` / `staff` / `client`).

| Route | Page | View roles |
| --- | --- | --- |
| `/uci` | `UciDashboard.tsx` | admin, staff, client |
| `/uci/submissions` | `UciSubmissions.tsx` | admin, staff, client |
| `/uci/communications` | `UciCommunications.tsx` | admin, staff, client |
| `/uci/class-of-service` | `UciClassOfService.tsx` | admin, staff, client |
| `/uci/ciac` | `UciCiac.tsx` | admin, staff, client (manage: admin) |
| `/uci/energization` | `UciEnergization.tsx` | admin, staff, client |
| `/uci/miss-utility` | `UciMissUtility.tsx` | admin, staff |
| `/uci/application-builder` | `UciApplicationBuilder.tsx` | admin, staff |
| `/uci/knowledge-graph` | `UciKnowledgeGraph.tsx` | admin, staff (manage: admin) |

All UCI pages share the search + filter bar pattern and consistent loading/empty states via `UciStates.tsx` (`UciLoading`, `UciEmpty`). Data is static in-file, not fetched.

### 2.11 Field / mobile

| Route | Page |
| --- | --- |
| `/field/studio` | `FieldStudio.tsx` |
| `/mobile/survey` | `MobileSurvey.tsx` |
| `/mobile/camera` | `MobileCamera.tsx` |
| `/mobile/map` | `MobileMap.tsx` |

### 2.12 SIR / inspections

| Route | Page |
| --- | --- |
| `/sir` | `Sir.tsx` |
| `/sir/workspace` | `SirWorkspace.tsx` |
| `/sir/annex` | `SirAnnex.tsx` |
| `/sir/executive` | `SirExecutive.tsx` |
| `/sir/sync` | `SirSync.tsx` |
| `/inspections/special` | `SpecialInspections.tsx` |
| `/inspections/final-co` | `FinalInspections.tsx` |

### 2.13 Closeout

| Route | Page |
| --- | --- |
| `/closeout` | `Closeout.tsx` |
| `/closeout/archive` | `CloseoutArchive.tsx` |
| `/closeout/tracker` | `CloseoutTracker.tsx` |
| `/closeout/post-mortem` | `PostMortem.tsx` |
| `/closeout/post-mortem/analytics` | `PostMortemAnalytics.tsx` |
| `/closeout/post-mortem/financial` | `PostMortemFinancial.tsx` |

### 2.14 Reference & resources

| Route | Page |
| --- | --- |
| `/reference` | `ReferenceLibrary.tsx` |
| `/reference/utility-coverage` | `UtilityCoverage.tsx` (uses `src/data/utilityProviders.ts`) |
| `/reference/glossary` | `Glossary.tsx` |
| `/checklists` | `Checklists.tsx` (exported as `ChecklistHistory`) |

### 2.15 Onboarding / delivery (LOA)

| Route | Page |
| --- | --- |
| `/onboarding/authorization` | `OnboardingAuthorization.tsx` — typed **and** drawn signature (react-signature-canvas), PDF via jsPDF, stores PNG in Cloud storage, writes to `client_authorizations`. Wording covers all employees. Same component mounts at `/delivery/authorization`. |
| `/delivery/authorization` | Alias route → `OnboardingAuthorization.tsx`. |

### 2.16 Admin

| Route | Page | Role gate |
| --- | --- | --- |
| `/admin` | `AdminConsole.tsx` | admin |
| `/admin/authorizations` | `AdminAuthorizations.tsx` | admin — LOA review, searchable table, CSV export, signature preview dialog |
| `/admin/members` | `AdminMembers.tsx` | admin — Members / Invitations / Pending Approvals tabs; expiry picker (7/14/30/90), resend, approve/reject with reason |
| `/admin/audit` | `AdminAuditLog.tsx` | admin — KPIs + event filters + CSV export from `access_audit_log` |
| `/admin/invoicing` | `AdminInvoicing.tsx` | admin |
| `/admin/past-performance` | `AdminPastPerformance.tsx` | admin |
| `/admin/crm` | `AdminCrm.tsx` | admin — Monday-style CRM |
| `/admin/milestone-billing` | `MilestoneBilling.tsx` | admin — 30/30/30/10 |
| `/admin/endpoints` | `AdminEndpoints.tsx` | admin |

### 2.17 Demo & operations

| Route | Page |
| --- | --- |
| `/demo/mcdonalds` | `DemoMcDonalds.tsx` + `GuidedTour.tsx` overlay (9-step spotlight walkthrough). |
| `/operations` | `OperationsBoard.tsx` — Monday.com clone (Reimbursables, Scope & Pricing, PM Workflows). |
| `/architecture` | `PlatformArchitecture.tsx` |
| `/content-studio` | `ContentStudio.tsx` |
| `/settings` | `Settings.tsx` |

### 2.18 UI states observed per page

- **Loading**: only UCI pages use a standardized loader (`UciLoading` with simulated delay). Other pages render static data immediately.
- **Empty**: standardized on UCI (`UciEmpty`); ad-hoc empty text elsewhere.
- **Error**: `AiWorkflow.tsx` shows inline destructive Alert banner + toast on failed workflow creation. `Login.tsx` shows toast on failed sign-in.
- **Access denied**: unified `AccessDenied.tsx` card in `RequireUciAccess`, `AdminAuditLog`, `AdminMembers`, `AdminAuthorizations`.
- **Disabled / validation**: notes editor in `ComplianceAnalyzer` (500-char counter, destructive alert at overflow), New Workflow dialog (Zod schema, per-field errors, live counters), LOA signing (typed name or drawn signature required).
- **Completed**: LOA "Executed authorizations" list; approve/reject optimistic row removal in `AdminMembers`.

### 2.19 Modals & drawers

- Dialogs: New Workflow (`AiWorkflow.tsx`), Preset notes editor (`ComplianceAnalyzer.tsx`), Invite member + Rejection reason (`AdminMembers.tsx`), LOA signature preview (`AdminAuthorizations.tsx`), CSV export (`CsvExportDialog.tsx`).
- Drawer/sheet: mobile sidebar (`ui/sidebar.tsx` uses `Sheet` under the hood).
- Overlays: `GuidedTour` full-screen tour with spotlight cutout.
- Toasts: shadcn Toaster + Sonner mounted globally in `App.tsx`.

### 2.20 Responsive behavior

- Sidebar collapses to icon rail (`Sidebar collapsible="icon"`), hidden on mobile via `Sheet` overlay from `ui/sidebar.tsx`.
- Header: search input hidden below `lg`; New Workflow button hidden below `sm`; Request Demo label hidden below `sm` (icon-only).
- Breadcrumb chevron hidden below `md`.
- Page layouts use `md:` / `lg:` / `xl:` grid breakpoints throughout.
- Dedicated mobile-first pages exist under `/mobile/*` and `/field/studio` (not adaptive versions of desktop pages).

## 3. Page-level detail (representative)

Full per-page records live in `docs/lovable-ui-inventory.json` → `pages[]`. Highlights:

### `/dashboard` (`Dashboard.tsx`)
- Entry: sidebar `Command → Dashboard`, tenant logo, root fallback.
- Primary actions: `New workflow` (header), quick actions bar (`quickActions` in `data.ts`).
- Sections: KPI grid (`kpis`), Agents (`agents`), Activity feed (`activityFeed`), Tasks (`tasks`), nested `<Outlet/>` for `/dashboard/uci`.

### `/command-center` (`CommandCenter.tsx`)
- Portfolio KPIs (Active / On-Track / At-Risk / Critical Path).
- Project card grid with phase stepper (Investigation → Filing → Coordination → Closeout).
- Actions: `Set Active` (writes to `useActiveProject`), `Open` → `/projects/alpha` (all cards point to the same detail slug).

### `/compliance` (`Compliance.tsx`)
- Two-column layout: 8-agent review matrix (from `designAgents`) with `ProgressLine` + `StatusPill`; Comment reconciliation panel.
- Primary action: `Run DesignCheck` (button only, no handler wired).

### `/utility-map` (`UtilityMap.tsx`)
- Left: `signal-grid` map canvas with absolute-positioned utility lines and a conflict marker.
- Right: layer toggles + AI conflict note panel. `Draft approval memo` button (visual only).

### `/matrix/ai-workflow` (`AiWorkflow.tsx`)
- Lane-based board persisted to `localStorage`.
- New Workflow dialog: name (Zod, ≤80), lane select, description (Zod, ≤500), inline errors, destructive alert on failure, toast on success/failure. `?new=1` auto-opens.

### `/onboarding/authorization` (`OnboardingAuthorization.tsx`)
- Full-profile capture, Commun-ET logo header, LOA body incl. "extends to all employees" clause.
- Signature method: typed **or** drawn (react-signature-canvas → PNG).
- Persists to Supabase table `client_authorizations`; PDF export via jsPDF.
- Below the form: executed-authorizations list scoped to signed-in client.

### `/admin/members` (`AdminMembers.tsx`)
- Tabs: Members / Invitations / Pending Approvals (with red dot when queue non-empty).
- KPI cards: Active members, Pending approvals.
- Invite dialog with expiry picker (7/14/30/90 d) → shareable token link.
- Resend rotates token + extends 30 d; Approve calls `approve_member` RPC; Reject calls `reject_member` with reason.

### `/admin/audit` (`AdminAuditLog.tsx`)
- KPIs, event-type filter chips, search box, CSV export.
- Data source: `access_audit_log` (events: `sign_in`, `sign_in_failed`, `sign_out`, `access_denied`).

## 4. Global chrome

- Shell: `PermitPilotShell` with `SidebarProvider`, sticky header (`h-16`), main padding `px-4 py-5 md:px-6 lg:px-8`, `bg-background` + `signal-grid` overlay.
- Sidebar footer: Commun-ET logo tile + workspace card with role badge and progress bar.
- Tenant switcher: `?tenant=mcd` swaps branding to McDonald's (yellow mark, MSA kicker); persisted to `localStorage[commun-et:tenant]`.
- Theme toggle: dark ↔ light via `useTheme`. Dark is canonical (memory rule).
- Header actions: Back, Home, breadcrumb, `ActiveProjectPicker`, search input, New workflow, Request Demo, ThemeToggle, Notifications bell, Avatar (`PP`).

See `docs/lovable-page-architecture.md` and `docs/lovable-component-architecture.md` for structural diagrams, and `docs/lovable-design-system.md` for tokens.

## 5. Totals

- **Routes declared in `App.tsx`**: 87 (including `/login`, `/signup`, `*` catch-all).
- **Page components in `src/pages/`**: 86 files.
- **Distinct route paths mounted inside the shell**: 82.
- **shadcn/ui primitives available**: 49 files in `src/components/ui/`.
- **Feature-level reusable primitives**: 8 (`PageHeader`, `StatCard`, `MetricCard`, `Panel`, `StatusPill`, `ProgressLine`, `ProjectLink`, `ServicePill`, `AlertBanner`) + `UciLoading`, `UciEmpty`, `AccessDenied`, `RequireUciAccess`, `CsvExportDialog`, `GuidedTour`.
- **Pages using purely mock/static in-file data**: ~78 of 86 (everything except `Login`, `Signup`, `AdminAuthorizations`, `AdminMembers`, `AdminAuditLog`, `OnboardingAuthorization`, `Contact`, `Home` contact form).
- **Pages with incomplete/visual-only interactions**: majority (see §6).
- **Pages not connected to the sidebar/header nav** (reachable only by direct URL / redirect): ~55 (only 24 nav items exist across 6 sidebar groups; header adds New workflow, Request Demo, Home, Back; the rest are reachable only via inline links or typed URL).
- **Files inspected**: `src/App.tsx`, `src/index.css`, `tailwind.config.ts`, `src/components/permitpilot/*`, `src/components/ui/` listing, `src/config/uciAccess.ts`, `src/hooks/*`, `src/state/activeProject.tsx`, `src/pages/*` listing, `src/data/utilityProviders.ts`, `package.json`.
- **Files created**: `docs/lovable-ui-audit.md`, `docs/lovable-page-architecture.md`, `docs/lovable-component-architecture.md`, `docs/lovable-design-system.md`, `docs/lovable-ui-inventory.json`.

## 6. Observed inconsistencies & incomplete areas

- **Duplicate LOA route**: `/onboarding/authorization` and `/delivery/authorization` mount the same component — informational label differs only in sidebar group.
- **Duplicate sidebar entries**: `Client Authorization (LOA)` appears in both "Onboarding" and "Delivery" groups; "Messages" appears both in Resources and Help & Support (as "Support"); "Reference Library" appears both in Resources and Help & Support ("Documentation"); "Pricing & Overview" in Help & Support links to `/` (marketing home).
- **Overlapping matrices**: `/matrix`, `/matrix/unified`, `/matrix/guided`, `/matrix/ai-workflow`, `/matrix/response` all present similar task-matrix layouts; only `/matrix/guided` and `/matrix/ai-workflow` are linked from sidebar.
- **Overlapping compliance surfaces**: `/compliance`, `/compliance/intelligence`, `/compliance/analyzer`, `/compliance/prescreen` — only `/compliance` and `/compliance/analyzer` are in nav.
- **Fixed project slug**: `CommandCenter.tsx` links every project card to `/projects/alpha` regardless of `p.id`. `/projects/:id/*` timeline & Gantt exist but no nav wires them.
- **UCI dashboard mounted twice**: `/uci` (guarded) and `/dashboard/uci` (unguarded).
- **Route-only pages** (not in sidebar nav): `MissionControl`, `CommandCenter`, `Feasibility`, `SiteFeasibility`, `CriticalPath`, `AgentCenter`, `Documents`, `ComplianceIntelligence`, `InternalPrescreen`, `RazePermit`, `Mobile*`, `FieldStudio`, `Sir*`, `SpecialInspections`, `FinalInspections`, `Closeout*`, `PostMortem*`, `PlatformArchitecture`, `ContentStudio`, `Settings` (only in Help group), `Admin*` (only Admin console entry in nav, rest reachable from `AdminConsole` links), `PortfolioExecutive`, `UtilityProviderMap`, `CrossUtilityConflictHunter`, `EasementRowManager`, `LoadProfileAnalyzer`, `MeterSetChoreographer`, `LongLeadEquipment`, `PredictiveScheduleImpact`, `InspectorReleaseTracker`, `MilestoneBilling`, `MasterMatrix`, `UnifiedMatrix`, `ResponseMatrix`, `ProjectSetupCredentials`, `ProjectTimeline`, `ProjectGantt`, `ProjectWorkspace`.
- **Placeholder / visual-only actions**: `Run DesignCheck`, `Draft approval memo`, `Share`, `New Project` (in `CommandCenter`), most `StatusPill` transitions, DesignCheck agent progress values, all utility-map layer toggles.
- **Hard-coded values**: KPI numbers, project cards, permit queue rows, message threads, activity feed, agents, `designAgents`, tenant marks — all in `src/components/permitpilot/data.ts`.
- **Mixed button systems**: `.pilot-button-primary` / `.pilot-button-ghost` (index.css utilities) alongside shadcn `Button` variants; also `.btn-primary` / `.btn-ghost-light` / `.btn-outline` layer defined but only used in marketing `Home.tsx`.
- **Duplicate icon libraries**: only Lucide used, but same concept represented by different icons in different groups (e.g., `WalletCards` used for both Operations Board and Pricing).
- **Sidebar footer logo tile** forces `bg-white` regardless of theme (visual seam in dark mode).
- **`?tenant=mcd`**: swaps branding but not palette; several downstream pages still show "PermitPilot" copy.
- **Static UCI content**: every UCI page renders in-file arrays; there is no data fetching or write path even for admin/staff.
- **`/`** appears twice — as the marketing `Home` and as a "Pricing & Overview" nav target inside the authenticated shell.
- **Desktop-only tables**: `AdminMembers`, `AdminAuthorizations`, `AdminAuditLog`, `PermitQueue`, `OperationsBoard` overflow on small viewports (no horizontal-scroll wrappers).
- **Search boxes** in header and UCI pages have no shared component; each page re-implements filter state.
- **`Home.tsx`** is publicly reachable but sits inside the authenticated shell — sidebar/header render for anonymous visitors too.
