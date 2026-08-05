# Lovable vs Current PermitPilot — Gap Analysis

> Comparison date: 2026-07-21  
> Inputs: `docs/lovable-*`, `docs/current-*`, `docs/ui-replication-constraints.md`  
> Scope: **documentation only** — no application code changes  
> Machine mapping: `docs/ui-route-component-mapping.json`  
> Plan: `docs/ui-replication-plan.md`

---

## 0. Executive summary

| Metric | Count |
|--------|------:|
| Lovable routes mapped (incl. `*` catch-all) | **88** inventory entries (`meta.routesDeclared` claimed 87) |
| Direct-URL / non-sidebar pages reviewed | 55 |
| Exact path+purpose matches | 7 |
| Redesigned matches (existing PP capability, different path/UX) | 23 |
| Lovable mock-tagged routes | 71 |
| Mock-only / out-of-scope-v1 (primary) | 51 |
| Duplicate Lovable pages | 5 |
| Excluded from replication (recommended) | 42 |
| Pages tagged `product_decision_required` | 29 |
| Named product decisions (PD-1…PD-14) | 14 |
| Pages with `backendExtensionRequired` | 10 |
| In-scope v1 routes | 31 |
| Frontend adapter sufficient among in-scope | 31 |

**Do not replicate all ~88 Lovable routes.** Most are prototypes, duplicates, or future concepts with mock data. Prefer adapting Lovable chrome onto PermitPilot’s real hooks/APIs. Machine counts: `docs/ui-route-component-mapping.json` → `meta.summary`.

**Critical structural mismatch:** Lovable UCI/admin/compliance/scraper pages are mostly **static mock**. Current PermitPilot already has production APIs for scrape, UCI, credentials, comments, filing, and documents. Visual migration must **not** replace those clients with Lovable in-file arrays.

---

## 1. Classification legend

Use these exact labels (items may carry more than one; primary listed first in mapping JSON):

| Label | Meaning |
|-------|---------|
| `style_only` | Tokens/chrome/spacing; same page body logic |
| `shared_shell_replacement` | Sidebar/header/layout swap |
| `component_replacement` | Swap presentational widgets; keep data hooks |
| `page_layout_restructure` | Major section/layout change on existing capability |
| `route_alias` | Same page, alternate path |
| `route_restructure` | Path rename or split/merge of routes |
| `frontend_adapter_required` | Thin adapter to existing PP hooks/APIs |
| `existing_backend_can_support` | Current APIs/DB already cover need |
| `backend_extension_required` | New tables/RPCs/Edge/routes genuinely needed |
| `lovable_mock_only` | Lovable static/mock; no production wire in Lovable |
| `duplicate_lovable_page` | Overlaps another Lovable route/component |
| `existing_permitpilot_feature_missing_from_lovable` | PP has it; Lovable does not |
| `product_decision_required` | Intent unclear — decide before coding |
| `exclude_from_replication` | Do not ship as production UI in this migration |

---

## 2. System-level gaps (before pages)

| Area | Lovable | Current PermitPilot | Gap / preserve |
|------|---------|---------------------|----------------|
| Auth routes | `/login`, `/signup` | `/auth` (combined) | `route_restructure` + keep Supabase session; **do not** add parallel auth |
| Roles | `admin` / `staff` / `client` + approval `pending|rejected` | `user_roles`: `admin` / `moderator` / `user`; project team roles; tenants | `product_decision_required` + likely `backend_extension_required` if adopting Lovable model |
| Shell | `PermitPilotShell` + signal-grid | `DashboardLayout` + `AppSidebar` | `shared_shell_replacement` — keep `SelectedProjectProvider`, `ScrapeProvider` |
| Project context | `ActiveProjectProvider` + hard-coded `/projects/alpha` | `SelectedProjectContext` + `?projectId=` / localStorage | Preserve PP semantics |
| Scraper | Mock Portal Harvest | Real `/api/login|scrape|data` + `ScrapeContext` + durable jobs | **Preserve** real progress; adapter only |
| Credentials | Visual vault on `/projects/new` | Encrypted `/api/portal-credentials` in Settings | **Preserve** secrecy; never client-store passwords |
| UCI | 9 static role-gated pages | Single `/uci` + `uciApi.ts` + stages 1–10 APIs (FE thin on 7–10) | Adapter to APIs; `product_decision_required` on route split |
| Comments / AI | Mock Response Matrix / DesignCheck | Edge agents + `parsed_comments` + approval trigger | Preserve BE; restyle FE |
| Documents | Mock Document Vault | Storage + ingestion worker + `project_documents` | Adapter / restyle |
| Marketing | `/` inside shell (anon sees chrome) | Public `MarketingLayout` + `PublicOnlyRoute` | `product_decision_required` on shell for `/` |
| LOA | Connected to Lovable `client_authorizations` | **No** matching table in current data-model audit | `backend_extension_required` or exclude |
| Token portals | Absent | `/portal/:token`, `/embed/:token`, `/invite/:token` | `existing_permitpilot_feature_missing_from_lovable` — **keep** |
| Baltimore mock | Absent | `/baltimore*` mock Accela | Keep or hide; not Lovable-driven |
| Billing | Mock admin CRM/invoicing | Stripe checkout + QB OAuth | Prefer current Stripe; Lovable billing = mock |

---

## 3. Workflow comparison

### 3.1 Auth / authz / tenant isolation

| | Lovable | Current | Classification | Adapter? | BE needed? | Risk |
|---|---------|---------|----------------|----------|------------|------|
| Sign-in/up | Separate pages; blocks rejected members | Combined `/auth`; subscription fields | `route_restructure`, `frontend_adapter_required`, `product_decision_required` | Yes → `useAuth` | Only if adopting approval_status RPCs | **High** if wrong |
| Guards | Client-side UCI + admin | `ProtectedLayoutRoute`, `useRequireAdmin`, RLS + JWT on scraper | Keep current gates; restyle denied UI | Yes | No for parity | High if removed |
| Tenant | `?tenant=mcd` branding | `tenants` / memberships for UCI access | Branding ≠ access; preserve UCI RPC checks | Partial | No for branding | Medium |

**Preserve:** session JWT to scraper, UCI refresh-on-401, `has_project_access*`, admin via `user_roles`, scrape clear on sign-out.

### 3.2 Projects

| | Lovable | Current | Notes |
|---|---------|---------|-------|
| List | Mock card grid `/projects` | Real CRUD/Kanban `useProjects` | Redesign layout; wire mock out |
| New + creds | `/projects/new` visual-only | Dialog + Settings credentials API | **Do not** ship visual vault as real storage |
| Detail | Hard-coded `/projects/alpha` | No fixed slug; selection context | Exclude alpha; use real IDs |
| Timeline/Gantt | Mock parametric routes | No equivalent pages | `product_decision_required` / likely exclude or future |

### 3.3 Scraper / Portal Harvest

| | Lovable | Current |
|---|---------|---------|
| Route | `/portals/harvest` mock | `/portal-data` real |
| Progress | None / fake | SSE + poll + `scrape_jobs` / Arlington worker |
| Approach | `page_layout_restructure` + `frontend_adapter_required` + `existing_backend_can_support` | Preserve `ScrapeContext`, cancel/retry, file lifecycle |

**Risk: High** if Lovable mock replaces job status UI.

### 3.4 Documents / comments

| | Lovable | Current |
|---|---------|---------|
| Documents | `/documents` mock vault | `project_documents` + ingestion | Adapter |
| Comment review | Not a first-class Lovable route | `/comment-review`, `/classified-comments` | PP-only — keep |
| Response | `/matrix/response` mock | `/response-matrix` + Edge + approval trigger | Redesign + adapter |

### 3.5 AI compliance

| | Lovable | Current |
|---|---------|---------|
| DesignCheck matrix | `/compliance` mock 8-agent | No identical matrix; related agents via Edge | `product_decision_required` |
| Analyzer | `/compliance/analyzer` + Lovable edge | `/code-compliance` + `/api/analyze-drawing` | Prefer current API; restyle UI |
| Intelligence / Prescreen | Mock, not in nav | None | Exclude or future |

### 3.6 UCI (provider → territory → load profile → application → submission)

| Lovable page | Current support | Adapter? | BE? |
|--------------|-----------------|----------|-----|
| `/uci` dashboard | `/uci` + coordination APIs | Yes | No for stages 1–6 core |
| `/uci/submissions` | applications + sync APIs | Yes | No |
| `/uci/communications` | communications APIs | Yes | No |
| `/uci/class-of-service` | COS analyst API | Yes | No |
| `/uci/ciac` | costs API; FE thin | Yes | Optional FE only |
| `/uci/energization` | late-stage prepare APIs | Yes | Partial — stage FE incomplete |
| `/uci/miss-utility` | Not clearly first-class in current FE | `product_decision_required` | Maybe |
| `/uci/application-builder` | application package APIs | Yes | No |
| `/uci/knowledge-graph` | Mock | `lovable_mock_only` / decision | Likely exclude |
| `/utility/load-profile` | Load-profile APIs under `/api/uci` | Yes | No |
| `/utility/provider-map` | providers + resolution APIs | Yes | No |
| `/utility/meter-set` | meter-set prepare API | Yes | No (thin) |
| `/dashboard/uci` | Duplicate unguarded | `duplicate_lovable_page` | Exclude |

**Preserve:** stage/state enums, transition APIs, PEPCO live-submit env gate, access service checks. Lovable static arrays must be replaced with `uciApi.ts`.

### 3.7 Admin

| Lovable | Current | Verdict |
|---------|---------|---------|
| `/admin` hub mock | `/admin` users/subscribers/drips | Restyle hub; keep PP admin features |
| Authorizations / Members / Audit | Lovable Cloud tables/RPCs | **Not in current data model** → BE or exclude |
| Invoicing / CRM / Past performance / Milestone / Endpoints | Mock | Exclude or future |
| — | `/admin/jurisdictions`, feature-flags, shadow-mode | PP-only — keep |

### 3.8 Settings

Both have `/settings`. Lovable mostly mock/theme; PP has profile + **real** portal credentials + MS mailbox. Restyle Lovable look; **keep** credential manager behavior.

---

## 4. Page-by-page comparison (sidebar / primary)

For each: **Lovable** → **Current** → data mode → classifications → approach.

### Auth & marketing

| Lovable | Source | Current | Data | Primary classifications | Adapter | BE | Risk | Approach |
|---------|--------|---------|------|-------------------------|---------|----|------|----------|
| `/login` | `Login.tsx` | `/auth` | backend (SB) | `route_restructure`, `frontend_adapter_required`, `product_decision_required` | Y | Only if approval gates | Med | Restyle Auth; optional split routes via alias |
| `/signup` | `Signup.tsx` | `/auth` | backend | same | Y | If pending-approval model | Med | Same |
| `/` | `Home.tsx` | `/` `LandingPage`/`CommunETLanding` | static + contact edge | `page_layout_restructure`, `product_decision_required` | Y contact | No | Med | Decide: Lovable home in shell vs PP public marketing |
| `/contact` | `Contact.tsx` | `/contact` | backend edge | `style_only` / `page_layout_restructure`, `existing_backend_can_support` | Y | No | Low | Restyle; keep `send-contact-email` |

### Command / delivery (in Lovable nav)

| Lovable | Source | Current | Data | Classifications | Adapter | BE | Risk | Approach |
|---------|--------|---------|------|-----------------|---------|----|------|----------|
| `/dashboard` | `Dashboard.tsx` | `/dashboard` | mock | `page_layout_restructure`, `frontend_adapter_required`, `existing_backend_can_support` | Y | No | Med | Replace mock KPIs with PP widgets/onboarding |
| `/projects` | `Projects.tsx` | `/projects` | mock | `page_layout_restructure`, `frontend_adapter_required`, `existing_backend_can_support` | Y | No | Med | Card layout OK; wire `useProjects` |
| `/permit-queue` | `PermitQueue.tsx` | none (portal_data / filings partial) | mock | `lovable_mock_only`, `product_decision_required` | Partial | Maybe aggregate view | Med | Decide: derive from scrape/filings or exclude |
| `/demo/mcdonalds` | `DemoMcDonalds.tsx` | `/demos` | static+tour | `route_restructure`, `component_replacement`, `product_decision_required` | Y | No | Low | Map to Demos / lead-capture; keep PP gating |
| `/onboarding/authorization` | `OnboardingAuthorization.tsx` | **none** | backend (Lovable) | `backend_extension_required`, `product_decision_required` | N | **Yes** (table/storage) | High | Ship only after schema decision |
| `/delivery/authorization` | same component | none | backend | `duplicate_lovable_page`, `route_alias` | — | — | Low | Single LOA route if kept |
| `/operations` | `OperationsBoard.tsx` | none | mock | `lovable_mock_only`, `exclude_from_replication` / decision | N | Yes if real | Low | Exclude v1 |
| `/matrix/guided` | `GuidedFlow.tsx` | `/permit-wizard-filing` | mock | `route_restructure`, `page_layout_restructure`, `frontend_adapter_required`, `existing_backend_can_support` | Y | No | **High** | Visual shell only; keep permitwizard-* |
| `/matrix/response` | `ResponseMatrix.tsx` | `/response-matrix` | mock | `route_alias`/`route_restructure`, `frontend_adapter_required`, `existing_backend_can_support` | Y | No | **High** | Preserve approval trigger + Edge |
| `/portals/harvest` | `PortalHarvest.tsx` | `/portal-data` | mock | `route_restructure`, `frontend_adapter_required`, `existing_backend_can_support` | Y | No | **High** | Must use ScrapeContext + real statuses |

### Intelligence (Lovable nav)

| Lovable | Source | Current | Data | Classifications | Adapter | BE | Risk | Approach |
|---------|--------|---------|------|-----------------|---------|----|------|----------|
| `/compliance` | `Compliance.tsx` | related `/code-compliance` + agents | mock | `page_layout_restructure`, `lovable_mock_only`, `product_decision_required` | Partial | If multi-agent orchestration UI | Med | Decide DesignCheck product scope |
| `/compliance/analyzer` | `ComplianceAnalyzer.tsx` | `/code-compliance` | hybrid | `route_restructure`, `frontend_adapter_required`, `existing_backend_can_support` | Y → analyze-drawing | Prefer current API | Med | Restyle analyzer; drop Lovable-only edge if different |
| `/uci` | `UciDashboard.tsx` | `/uci` | static | `page_layout_restructure`, `frontend_adapter_required`, `existing_backend_can_support` | Y | No | **High** | Replace static with uciApi |
| `/uci/submissions` … `/uci/application-builder` | `Uci*.tsx` | APIs exist; FE mostly single page | static | `route_restructure`, `frontend_adapter_required`, `existing_backend_can_support`, `product_decision_required` | Y | No for most | High | Split routes vs tabs — product call |
| `/uci/knowledge-graph` | `UciKnowledgeGraph.tsx` | none | static | `lovable_mock_only`, `exclude_from_replication` | N | Yes if real | Low | Exclude v1 |
| `/utility-map` | `UtilityMap.tsx` | `/jurisdictions/map` | visual | `page_layout_restructure`, `frontend_adapter_required`, `product_decision_required` | Y Mapbox | No | Med | Don’t fake utility lines over Mapbox truth |
| `/utility/provider-map` | `UtilityProviderMap.tsx` | UCI providers + jurisdictions | static file | `frontend_adapter_required`, `existing_backend_can_support` | Y | No | Med | Prefer live providers API |

### Resources / help (Lovable nav)

| Lovable | Source | Current | Data | Classifications | Adapter | BE | Risk | Approach |
|---------|--------|---------|------|-----------------|---------|----|------|----------|
| `/checklists` | `Checklists.tsx` | `/checklist-history` | mock | `route_restructure`, `frontend_adapter_required`, `existing_backend_can_support` | Y | No | Low | Alias/redirect |
| `/reference` | `ReferenceLibrary.tsx` | `/code-reference`, `/api-docs`, `/mvp-documentation` | static | `product_decision_required`, `page_layout_restructure` | Y | No | Low | Merge into existing doc pages |
| `/reference/utility-coverage` | `UtilityCoverage.tsx` | jurisdictions / territory data | static | `frontend_adapter_required`, `existing_backend_can_support` | Y | No | Med | Prefer territory/jurisdiction sources |
| `/reference/glossary` | `Glossary.tsx` | none / FAQ partial | static | `lovable_mock_only`, `product_decision_required` | N | Content only | Low | Optional static content page |
| `/portfolio/executive` | `PortfolioExecutive.tsx` | `/analytics` | mock | `route_restructure`, `frontend_adapter_required`, `existing_backend_can_support` | Y | No | Med | Charts over `project_analytics` |
| `/messages` | `Messages.tsx` | none (notif partial) | mock | `lovable_mock_only`, `product_decision_required` | N | Yes for real inbox | Med | Exclude v1 unless scoped to notifications |
| `/settings` | `Settings.tsx` | `/settings` | mock vs real | `page_layout_restructure`, `frontend_adapter_required`, `existing_backend_can_support` | Y | No | **High** | Keep PortalCredentialsManager |

---

## 5. Direct-URL pages (~55) — required classification

These are **not** primary sidebar items (auth, nested dup, admin children, and `notInSidebarNav` expansion). Each gets a pageKind: `detail_flow` | `duplicate` | `prototype` | `future` | `production` | `exclude`.

| # | Lovable route | Source | Kind | Current equiv | Data | Verdict |
|---|---------------|--------|------|---------------|------|---------|
| 1 | `/login` | `Login.tsx` | production | `/auth` | backend | Redesign Auth; path decision |
| 2 | `/signup` | `Signup.tsx` | production | `/auth` | backend | Same |
| 3 | `/dashboard/uci` | `UciDashboard.tsx` | duplicate | `/uci` | static | **Exclude** — unguarded dup |
| 4 | `/mission-control` | `MissionControl.tsx` | prototype | none / analytics | mock | Exclude v1 |
| 5 | `/command-center` | `CommandCenter.tsx` | prototype | dashboard/projects | mock | Exclude; broken α links |
| 6 | `/critical-path` | `CriticalPath.tsx` | future | none | mock | Exclude / future |
| 7 | `/feasibility` | `Feasibility.tsx` | future | none | mock | Exclude |
| 8 | `/feasibility/site` | `SiteFeasibility.tsx` | future | none | mock | Exclude |
| 9 | `/projects/new` | `ProjectSetupCredentials.tsx` | detail_flow | Projects dialog + Settings creds | visual | Restyle create flow; **no** visual vault as store |
| 10 | `/projects/alpha` | `ProjectWorkspace.tsx` | prototype | selected project | mock | **Exclude** hard-coded slug |
| 11 | `/projects/:id/timeline` | `ProjectTimeline.tsx` | future | none | mock | Decision / exclude v1 |
| 12 | `/projects/:id/gantt` | `ProjectGantt.tsx` | future | none | mock | Decision / exclude v1 |
| 13 | `/matrix` | `MasterMatrix.tsx` | duplicate | guided / response / filing | mock | Exclude — overlap |
| 14 | `/matrix/unified` | `UnifiedMatrix.tsx` | duplicate | same | mock | Exclude |
| 15 | `/matrix/ai-workflow` | `AiWorkflow.tsx` | prototype | none (localStorage) | client | Decision; not production scrape/UCI |
| 16 | `/compliance/intelligence` | `ComplianceIntelligence.tsx` | prototype | none | mock | Exclude |
| 17 | `/compliance/prescreen` | `InternalPrescreen.tsx` | future | none | mock | Exclude |
| 18 | `/raze` | `RazePermit.tsx` | prototype | none | mock | Exclude |
| 19 | `/documents` | `DocumentVault.tsx` | detail_flow | project documents UI | mock | Redesign + adapter to ingestion |
| 20 | `/agents` | `AgentCenter.tsx` | prototype | Edge agents / AgentWorkflowStatus | mock | Decision; don’t fake agent runs |
| 21 | `/mobile/survey` | `MobileSurvey.tsx` | future | PWA/Capacitor partial | mock | Exclude v1 |
| 22 | `/mobile/camera` | `MobileCamera.tsx` | future | none | mock | Exclude |
| 23 | `/mobile/map` | `MobileMap.tsx` | future | none | mock | Exclude |
| 24 | `/field/studio` | `FieldStudio.tsx` | future | none | mock | Exclude |
| 25 | `/sir` | `Sir.tsx` | future | none | mock | Exclude |
| 26 | `/sir/workspace` | `SirWorkspace.tsx` | future | none | mock | Exclude |
| 27 | `/sir/annex` | `SirAnnex.tsx` | future | none | mock | Exclude |
| 28 | `/sir/executive` | `SirExecutive.tsx` | future | none | mock | Exclude |
| 29 | `/sir/sync` | `SirSync.tsx` | future | none | mock | Exclude |
| 30 | `/inspections/special` | `SpecialInspections.tsx` | future | none | mock | Exclude |
| 31 | `/inspections/final-co` | `FinalInspections.tsx` | future | none | mock | Exclude |
| 32 | `/inspections/release-tracker` | `InspectorReleaseTracker.tsx` | future | none | mock | Exclude |
| 33 | `/closeout` | `Closeout.tsx` | future | UCI closeout prepare API | mock | Decision; maybe UCI stage 10 UI later |
| 34 | `/closeout/archive` | `CloseoutArchive.tsx` | future | none | mock | Exclude |
| 35 | `/closeout/tracker` | `CloseoutTracker.tsx` | future | none | mock | Exclude |
| 36 | `/closeout/post-mortem` | `PostMortem.tsx` | future | none | mock | Exclude |
| 37 | `/closeout/post-mortem/analytics` | `PostMortemAnalytics.tsx` | future | none | mock | Exclude |
| 38 | `/closeout/post-mortem/financial` | `PostMortemFinancial.tsx` | future | none | mock | Exclude |
| 39 | `/architecture` | `PlatformArchitecture.tsx` | exclude | `/design-system-preview` / docs | static | Exclude from product nav |
| 40 | `/content-studio` | `ContentStudio.tsx` | prototype | none | mock | Exclude |
| 41 | `/utility/conflict-hunter` | `CrossUtilityConflictHunter.tsx` | future | none | mock | Exclude |
| 42 | `/utility/easements` | `EasementRowManager.tsx` | future | none | mock | Exclude |
| 43 | `/utility/load-profile` | `LoadProfileAnalyzer.tsx` | detail_flow | UCI load-profile APIs | mock | **In scope** via adapter |
| 44 | `/utility/meter-set` | `MeterSetChoreographer.tsx` | detail_flow | meter-set prepare API | mock | In scope thin FE / decision |
| 45 | `/scheduling/long-lead` | `LongLeadEquipment.tsx` | future | equipment API thin | mock | Decision / exclude v1 |
| 46 | `/scheduling/predictive-impact` | `PredictiveScheduleImpact.tsx` | future | none | mock | Exclude |
| 47 | `/contact` | `Contact.tsx` | production | `/contact` | backend | In scope (also marketing) |
| 48 | `/admin/authorizations` | `AdminAuthorizations.tsx` | production* | none | backend Lovable | BE or exclude |
| 49 | `/admin/members` | `AdminMembers.tsx` | production* | AdminPanel users (different model) | backend Lovable | Product + BE |
| 50 | `/admin/audit` | `AdminAuditLog.tsx` | production* | none | backend Lovable | BE or exclude |
| 51 | `/admin/invoicing` | `AdminInvoicing.tsx` | prototype | Stripe/QB | mock | Exclude; keep Stripe |
| 52 | `/admin/past-performance` | `AdminPastPerformance.tsx` | prototype | none | mock | Exclude |
| 53 | `/admin/crm` | `AdminCrm.tsx` | prototype | none | mock | Exclude |
| 54 | `/admin/milestone-billing` | `MilestoneBilling.tsx` | prototype | none | mock | Exclude |
| 55 | `/admin/endpoints` | `AdminEndpoints.tsx` | prototype | `/api-docs` | mock | Exclude; use api-docs |

\*“production*” = wired in Lovable Cloud only — **not** present in current PermitPilot schema audit.

---

## 6. Exact vs redesigned matches

### Exact path + purpose (7)

`/`, `/dashboard`, `/projects`, `/contact`, `/settings`, `/uci`, `/admin`

### Redesigned matches (23) — existing PP capability under different Lovable path/UX

| Lovable | Current |
|---------|---------|
| `/login`, `/signup` | `/auth` |
| `/portals/harvest` | `/portal-data` |
| `/matrix/guided` | `/permit-wizard-filing` |
| `/matrix/response` | `/response-matrix` |
| `/compliance/analyzer` | `/code-compliance` |
| `/compliance` (partial) | AI agents / compliance components |
| `/checklists` | `/checklist-history` |
| `/portfolio/executive` | `/analytics` |
| `/utility-map` | `/jurisdictions/map` |
| `/utility/provider-map` | UCI providers / jurisdictions |
| `/utility/load-profile` | UCI load-profile |
| `/utility/meter-set` | UCI meter-set prepare |
| `/uci/submissions` | UCI applications |
| `/uci/communications` | UCI communications |
| `/uci/class-of-service` | UCI COS |
| `/uci/ciac` | UCI costs |
| `/uci/application-builder` | UCI application package |
| `/uci/energization` | late UCI stages (partial) |
| `/documents` | project documents |
| `/demo/mcdonalds` | `/demos` |
| `/reference` | code-reference / api-docs |
| `/projects/new` | project create + credentials |

---

## 7. PermitPilot-only features (missing from Lovable)

Classify: `existing_permitpilot_feature_missing_from_lovable` — **must preserve**, not drop during shell swap.

- `/portal/:token`, `/embed/:token`, `/invite/:token`
- `/comment-review`, `/classified-comments`
- `/permit-intelligence` (Shovels)
- `/roi-calculator`, `/consolidation-calculator`
- `/pricing`, `/faq`, `/install`, `/demos` (vs single McD demo)
- `/jurisdictions/compare`, `/jurisdictions/:stateCode`
- `/admin/jurisdictions`, `/admin/feature-flags`, `/admin/shadow-mode`
- `/baltimore*` mock (keep or hide intentionally)
- `/design-system-preview`, `/api-docs`, `/mvp-documentation`
- Real scrape durable workers, portal-credentials crypto, PEPCO submit gate
- Document ingestion worker pipeline

---

## 8. Backend extensions (genuine)

Only these need BE work if product chooses to ship Lovable capability as-is:

1. **LOA** — `client_authorizations` + signature storage (not in current data-model audit)
2. **Member approval** — `approval_status` / approve-reject RPCs / `workspace_invitations` (differs from `project_invitations`)
3. **Access audit log** — `access_audit_log` table + writers
4. **Role model** — staff/client vs admin/moderator/user (if adopted)
5. **Real messaging** — if `/messages` becomes production inbox
6. **Permit queue aggregate** — if not derivable from existing scrape/filing tables
7. **DesignCheck 8-agent orchestration UI** — if more than analyzer + existing Edge agents
8. **Miss Utility / knowledge graph** — if treated as production domains without current FE/API parity

UCI stages 7–10: APIs largely exist → prefer **FE adapters**, not new BE, unless product expands behavior.

---

## 9. Visual & structural differences (cross-cutting)

| Dimension | Lovable | Current |
|-----------|---------|---------|
| Shell | Signal-grid, sticky header, ActiveProjectPicker, New Workflow CTA | DashboardLayout, scrape indicator, command palette |
| Nav IA | 6 groups, heavy UCI split, Delivery/Onboarding | Intake/Response/Projects/Intelligence/Resources/Admin |
| Data density | Editorial cards, KPI strips, mock heat maps | Operational forms, tables, status machines |
| UCI UX | Many routes + UciLoading fake delay | One dashboard + drawers; real loading |
| Auth chrome | Bare login/signup | Marketing-adjacent Auth |
| Tokens | Similar Inter/Cormorant/JetBrains; orange/teal/navy | Closely related cream/obsidian/teal/gold |

Missing Lovable mock fields vs PP (projects): phaseIdx, queueHealth, serviceSummary, hard-coded risk labels — map carefully to real `projects` columns / computed status; do not invent DB columns for cosmetics.

---

## 10. Implementation risk rollup

| Risk | Why | Mitigation |
|------|-----|------------|
| Scraper UI swap | Mock harvest hides real job states | Adapter + keep ScrapeContext; verify SSE/poll |
| UCI static takeover | Loses transitions/submit gate | Wire uciApi; keep env gate |
| Credential vault | Visual-only becomes plaintext FE | Keep portal-credentials API only |
| Auth/role rewrite | Breaks RLS/JWT/admin | Adapter to useAuth; decide roles first |
| LOA without schema | Orphans Lovable Cloud assumptions | Product gate + migration or exclude |
| Scattershot visual edits | Partial inconsistent UX | Phased route flags; shell first |
| Dropping PP-only routes | Lose portals/invites/comments | Explicit preserve list in plan |

---

## 11. Recommended default stance

1. **Shell + design tokens** from Lovable.  
2. **Bodies** stay on PermitPilot hooks/clients.  
3. **Replicate** redesigned matches for scrape, filing, response, compliance analyzer, projects, settings, UCI (adapter).  
4. **Exclude** SIR/mobile/field/closeout-postmortem/CRM/architecture/content-studio/α project/command-center clones.  
5. **Decide before coding:** LOA, approval workflow, UCI multi-route IA, DesignCheck matrix scope, marketing `/` shell, permit-queue, messages.

See `docs/ui-replication-plan.md` for phases and `docs/ui-route-component-mapping.json` for machine-readable rows.
