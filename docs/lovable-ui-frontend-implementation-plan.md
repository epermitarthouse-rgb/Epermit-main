# PermitPilot Frontend Implementation Plan — Lovable Visual Alignment

> Date: 2026-07-21  
> Status: **Documentation only** — no application code, branches, commits, pushes, migrations, or deploys.  
> Sources synthesized: `docs/lovable-*`, `docs/current-*`, `docs/ui-replication-constraints.md`, `docs/lovable-vs-current-gap-analysis.md`, `docs/ui-route-component-mapping.json`, `docs/ui-replication-plan.md`.

---

## Ultimate goal

**Lovable is ONLY a visual/UX reference from the client.** Replicate visual design, layouts, navigation structure, sidebar/header, screen hierarchy, page-to-page flow, tabs/drawers/modals/cards/tables/forms/status presentation, responsive behavior, and design tokens/interaction patterns.

**Do NOT copy:** Lovable mock data, fake functionality, backend assumptions, auth model, DB structure, role model, status logic, client-side credential behavior, placeholder APIs, or prototype-only functionality.

**PermitPilot backend and production behavior remain intact:** auth/session, authz/tenant isolation, roles/permissions, project access, schema, APIs, scraper + real progress/terminal/retry, credential secrecy/server-side use, documents/downloads, comments, AI compliance, Permit Wizard, Response Matrix, Portal Harvest, UCI provider/territory/load-profile/approvals/application/submission, admin, audit.

This is a **frontend redesign and flow-alignment** project, not backend replacement or feature-copy.

---

## 1. Implementation principle

| Principle | Rule |
|-----------|------|
| Lovable | Design / UX reference only |
| PermitPilot | Functional source of truth |
| APIs / backend | Stay intact |
| Data | Production data replaces Lovable mocks |
| Actions | Existing production actions replace Lovable placeholders |
| Permissions | Existing PP roles/guards override Lovable `admin/staff/client` + approval model |
| Status values | Current enums authoritative (`scrape_jobs`, UCI stage states, `response_status`, filing statuses, etc.) |
| Adapters | Frontend adapters may reshape payloads for presentation only |
| Backend changes | Out of scope unless a verified integration fix is required to expose an **existing** production feature |
| Missing Lovable UI | **Never** a reason to remove current PermitPilot behavior |

**Adapter stack (mandatory):**

```
Lovable chrome (layout, tokens, ProductPrimitives-style UI)
        ↓
Thin FE adapters / view-models (presentation only)
        ↓
Existing hooks/clients: useAuth, useProjects, SelectedProjectContext,
  ScrapeContext, uciApi, portalCredentialsApi, Edge invokes
        ↓
Unchanged backend contracts
```

Do not ship Lovable `permitpilot/data.ts` mock arrays on production paths. Do not treat Lovable Cloud tables/RPCs as schema truth for this repo.

Product decisions PD-1…PD-14 (auth paths, role labels, marketing shell, LOA, admin members/audit, UCI multi-route IA, DesignCheck matrix, permit queue, messages, timeline/Gantt, nav IA, route renames, Baltimore nav, direct-URL in-scope set) must be locked before Phase 3+ where noted. Defaults from gap analysis / replication plan apply until overridden.

---

## 2. Route-to-design plan

Start from **every active PermitPilot route** (`docs/current-ui-inventory.json`: 41 routed paths + catch-all). Do **not** create new production routes merely because Lovable has them.

**Legend:** Path stays = keep current URL unless optional alias later (PD-12). Risk = visual-migration risk to production behavior.

### 2.1 Public / marketing / token

| Current route | Page | Purpose | Lovable visual ref | Lovable source | Path stays? | Layout / nav | Replace visually | Preserve (logic) | Hooks / APIs / actions | States to keep | Mobile | Risk |
|---------------|------|---------|--------------------|----------------|-------------|--------------|------------------|------------------|------------------------|----------------|--------|------|
| `/` | `LandingPage` → `CommunETLanding` | Brand landing; authed → dashboard | `/` Home (PD-3: public marketing vs shell) | `Home.tsx` | Yes | Keep `MarketingLayout` / `PublicOnlyRoute`; do not put anon in app shell by default | Hero, sections, CTAs | Auth redirect, contact edge if used | `useAuth`, marketing components | Authed redirect; CTA states | Adopt Lovable responsive sections | Med |
| `/auth` | `Auth` | Login + signup | `/login` + `/signup` | `Login.tsx`, `Signup.tsx` | Yes (optional aliases) | Bare auth chrome like Lovable; no PP role-approval gate unless PD-2 | Form chrome, typography | Supabase session, subscription fields | `useAuth.signIn/signUp` | Redirect if session; validation errors | Stack forms for small screens | Med |
| `/demos` | `Demos` | Product demos + lead gate | `/demo/mcdonalds` (partial) | `DemoMcDonalds.tsx` | Yes | Marketing / protected patterns as today | Tour chrome, cards | Lead capture, subscription gate | `useLeadCapture`, `useAuth` | Gate locked vs open | Keep touch-friendly demos | Low |
| `/pricing` | `Pricing` | Stripe tiers | None (PP-only) — restyle with Lovable card/token language | — | Yes | Marketing | Tier cards | `create-checkout` | Edge checkout, `useAuth` | Guest vs authed CTA | Stack cards | Low |
| `/contact` | `Contact` | Contact form | `/contact` | `Contact.tsx` | Yes | Marketing | Form layout | `send-contact-email` | Edge | Success / error | Full-width form | Low |
| `/faq` | `FAQ` | FAQ | None — shared accordion/tokens | — | Yes | Marketing / help | Accordion chrome | Local search | None | Empty search | Accordion | Low |
| `/install` | `Install` | PWA help | None — token restyle | — | Yes | Public unlinked | Instructions | `beforeinstallprompt` | Browser APIs | Unsupported browser | Simple stack | Low |
| `/portal/:token` | `ClientPortal` | Client share view | None (PP-only) — apply tokens/empty states | — | **Must stay** | Token layout (no app sidebar required) | Status presentation | Share-link policies | Supabase token access | Invalid/expired | Compact | High |
| `/embed/:token` | `EmbedWidget` | Embeddable status | None | — | **Must stay** | Minimal embed chrome | Compact widget visuals | Realtime status | Token + realtime | Invalid token | Tiny viewport | Med |
| `/invite/:token` | `InviteAccept` | Accept/decline invite | None | — | **Must stay** | Minimal | Accept UI chrome | Invite RPCs | `useAuth`, accept/decline RPCs | Must sign in; expired | Stack | High |
| `*` | `NotFound` | 404 | `*` (Lovable redirects to dashboard — **do not** copy that for public) | — | Yes | Public | Message chrome | Keep PP 404 (not silent redirect) | — | — | — | Low |

### 2.2 Protected app — core

| Current route | Page | Purpose | Lovable visual ref | Source | Path stays? | Layout / nav | Visual vs preserve | Keep connected | States | Mobile | Risk |
|---------------|------|---------|--------------------|--------|-------------|--------------|--------------------|----------------|--------|--------|------|
| `/dashboard` | `Dashboard` | Hub / onboarding | `/dashboard` | `Dashboard.tsx` | Yes | Shell swap Phase 2; hybrid nav | KPI/card chrome ← Lovable; **replace mock KPIs** with PP widgets | `useAuth`, `useOnboarding`, `useSelectedProject`, `useGettingStarted`, dashboard widgets | Loading skeletons; empty project | Bottom nav Home | Med |
| `/projects` | `Projects` | CRUD / Kanban | `/projects` (+ `/projects/new` for create chrome) | `Projects.tsx`, `ProjectSetupCredentials.tsx` | Yes | Shell | Card/grid layout; **wire `useProjects`** | `useProjects`, `SelectedProjectContext`, `ProjectFormDialog` | Empty list; create/edit | Mobile Projects tab | Med |
| `/analytics` | `Analytics` | Portfolio analytics | `/portfolio/executive` | `PortfolioExecutive.tsx` | Yes | Shell | Executive chrome over real charts | `useAnalytics` → `project_analytics` | Redirect if !user; empty | Charts scroll | Med |
| `/jurisdictions/compare` | `JurisdictionComparison` | Side-by-side | Shared map/intel chrome; `/utility-map` density | — | Yes | Shell | Tool layout | `JurisdictionComparisonTool` | Loading | Stack columns | Med |
| `/jurisdiction-comparison` | same | Legacy alias | — | — | **Keep alias** | Unlinked | Same as compare | Same | Same | Same | Low |
| `/jurisdictions/map` | `JurisdictionMapPage` | Mapbox coverage | `/utility-map`, `/reference/utility-coverage` | `UtilityMap.tsx`, `UtilityCoverage.tsx` | Yes | Shell | Map chrome; **do not fake utility lines** | `get-mapbox-token`, `JurisdictionMap` | Missing token | Full-bleed map | Med |
| `/jurisdictions/:stateCode` | `StateLandingPage` | Per-state | Shared card language | — | Yes | Shell | Cards | `jurisdictions` query | Empty | Cards stack | Low |
| `/permit-intelligence` | `PermitIntelligence` | Shovels search | Shared intel chrome (no Lovable page) | — | Yes | Keep in nav | Search UI restyle | Edge `shovels-api` | Auth redirect | Stack | Med |
| `/code-compliance` | `CodeCompliance` | Drawing analyzer | `/compliance/analyzer` | `ComplianceAnalyzer.tsx` | Yes | Shell | Analyzer chrome | `/api/analyze-drawing`, `AIComplianceAnalyzer`, ErrorBoundary | Analyze error/success | Upload UX | Med |
| `/code-reference` | `CodeReferenceLibrary` | Code library | `/reference` | `ReferenceLibrary.tsx` | Yes | Shell | Library layout | Matrix/static data | Browse | Tabs → accordion | Low |
| `/roi-calculator` | `ROICalculator` | Savings calc | Shared form/chart tokens | — | Yes | Shell | Form restyle | `saved_calculations` | Save success | Stack | Low |
| `/consolidation-calculator` | `ConsolidationCalculator` | Tool compare | Shared tokens | — | Yes | Shell | Form restyle | `saved_calculations` | Save | Stack | Low |
| `/mvp-documentation` | `MVPDocumentation` | Docs + PDF | Shared docs chrome | — | Yes | Unlinked OK | Doc viewer | PDF export | — | Readable | Low |
| `/api-docs` | `APIDocumentation` | API docs | Not Lovable `/admin/endpoints` | — | Yes | Help | Docs browser | Static `apiDocumentationData` | Empty search | Stack | Low |
| `/checklist-history` | `ChecklistHistory` | Saved checklists | `/checklists` | `Checklists.tsx` | Yes (optional `/checklists` alias) | Shell | List chrome | `useSavedChecklists`, Edge report | Empty | List | Low |
| `/settings` | `Settings` | Profile, creds, mailbox | `/settings` | `Settings.tsx` | Yes | Header entry | Page sections chrome | **`PortalCredentialsManager`**, MS mailbox, profile | Validation; credential list without passwords | Stack sections | **High** |
| `/design-system-preview` | `EpermitDesignSystemPreview` | Token showroom | Shared primitives | — | Yes | Help/dev | Align to new tokens | Theme | — | — | Low |

### 2.3 Protected — operational workflows

| Current route | Page | Purpose | Lovable visual ref | Source | Path stays? | Notes | Preserve | Keep connected | States | Mobile | Risk |
|---------------|------|---------|--------------------|--------|-------------|-------|----------|----------------|--------|--------|------|
| `/portal-data` | `PortalDataViewer` | Harvest + view portal data | `/portals/harvest` | `PortalHarvest.tsx` | **Yes** (alias optional) | Lovable layout around **real** scrape | Job statuses, cancel/retry, files | `ScrapeContext`, scrape APIs, `projects.portal_data`, Accela viewers | Empty `portal_data`; queued→terminal | Mobile Harvest tab | **High** |
| `/permit-wizard-filing` | `PermitWizardFiling` | Multi-step filing | `/matrix/guided` | `GuidedFlow.tsx` | **Yes** | Guided chrome only | Preflight/execute machine | `permit-wizard/*`, Edge permitwizard-* | Filing statuses | Mobile Filing tab | **High** |
| `/response-matrix` | `ResponseMatrix` | AI responses + approve | `/matrix/response` | `ResponseMatrix.tsx` | **Yes** | Matrix table chrome | Approval trigger + Edge generate | `response-matrix/*`, Edge | `response_status` values | Horizontal scroll tables | **High** |
| `/comment-review` | `CommentReview` | Plan comments | No Lovable route — restyle with matrix/compliance chrome | — | Yes | **Keep in nav** | Parse agents | comment-review components, Edge | Loading/empty | Stack | High |
| `/classified-comments` | `ClassifiedComments` | Discipline classify | No Lovable route — shared table/badge chrome | — | Yes | **Keep in nav** | Classifier Edge | Edge `discipline-classifier-agent` | Empty | Stack | High |
| `/uci` | `UciDashboard` | UCI lifecycle | `/uci` + stage pages as **tabs/drawers** (PD-6) | `UciDashboard.tsx`, `Uci*.tsx` | **Yes** single route initially | Visual from Lovable; data from `uciApi` | Stage enums, transitions, submit gate | `components/uci/*`, `uciApi.ts` | Access denied; stage blocked; session expired | Drawers → sheets | **High** |

### 2.4 Admin

| Current route | Page | Purpose | Lovable visual ref | Path stays? | Notes | Preserve | Risk |
|---------------|------|---------|--------------------|-------------|-------|----------|------|
| `/admin` | `AdminPanel` | Users, subscribers, drips | `/admin` hub chrome | Yes | Do **not** adopt Lovable members/audit/CRM without BE (PD-5) | AdminPanel features | Med |
| `/admin/jurisdictions` | `JurisdictionAdmin` | CRUD jurisdictions | Shared admin table chrome | Yes | PP-only | `JurisdictionManager` | Med |
| `/admin/feature-flags` | `FeatureFlagsAdmin` | Client flags UI | Shared admin | Yes | localStorage flags — do not fake server flags | `FeatureFlagsPanel` | Med |
| `/admin/shadow-mode` | `ShadowModeDashboard` | Shadow metrics | Shared admin | Yes | PP-only | Shadow + Edge evaluator | Med |

### 2.5 Baltimore mock

| Current route | Page | Lovable ref | Path stays? | Plan | Risk |
|---------------|------|-------------|-------------|------|------|
| `/baltimore`, `/baltimore/permits`, `/baltimore/records`, `/baltimore/records/:recordId` | Baltimore mock Accela | None | Yes | Per PD-13: hide from primary nav; leave routes; restyle lightly with tokens; **not** production portal integration | Med |

**Main question answered:** wrap current PermitPilot functionality in Lovable design — map Lovable pages onto existing PP routes via the tables above. Do **not** invent production-backed routes merely because Lovable has them; unsupported Lovable pages may ship only as labeled placeholders per §3.5 / §12.

---

## 3. Classify ALL Lovable pages by design usage

### 3.1 Full visual reference (14)

Adopt overall page layout/chrome as primary visual target for a production PP surface.

| Lovable route | Source | Wraps PP |
|---------------|--------|----------|
| `/login` | `Login.tsx` | `/auth` |
| `/signup` | `Signup.tsx` | `/auth` |
| `/dashboard` | `Dashboard.tsx` | `/dashboard` |
| `/projects` | `Projects.tsx` | `/projects` |
| `/settings` | `Settings.tsx` | `/settings` |
| `/contact` | `Contact.tsx` | `/contact` |
| `/portals/harvest` | `PortalHarvest.tsx` | `/portal-data` |
| `/matrix/guided` | `GuidedFlow.tsx` | `/permit-wizard-filing` |
| `/matrix/response` | `ResponseMatrix.tsx` | `/response-matrix` |
| `/compliance/analyzer` | `ComplianceAnalyzer.tsx` | `/code-compliance` |
| `/uci` | `UciDashboard.tsx` | `/uci` overview |
| `/portfolio/executive` | `PortfolioExecutive.tsx` | `/analytics` |
| `/checklists` | `Checklists.tsx` | `/checklist-history` |
| `/admin` | `Admin*.tsx` hub | `/admin` overview chrome |

### 3.2 Partial visual reference (17)

Borrow section layouts, density, or stage UIs without owning a new PP route.

| Lovable route | Use on PP |
|---------------|-----------|
| `/` | Marketing landing (PD-3) |
| `/projects/new` | Create-project dialog / wizard chrome; **not** visual credential vault as storage |
| `/documents` | Project documents section / vault layout → `project_documents` |
| `/utility-map` | `/jurisdictions/map` chrome |
| `/reference/utility-coverage` | Map / coverage empty states |
| `/reference` | `/code-reference` |
| `/utility/load-profile` | `/uci` load-profile panels |
| `/utility/provider-map` | `/uci` provider resolution UI |
| `/utility/meter-set` | `/uci` meter-set prepare UI |
| `/uci/submissions` | Submissions drawer/tab on `/uci` |
| `/uci/communications` | Communications UI on `/uci` |
| `/uci/class-of-service` | COS UI on `/uci` |
| `/uci/ciac` | Costs UI on `/uci` |
| `/uci/energization` | Late-stage UI on `/uci` (partial FE) |
| `/uci/application-builder` | Application package UI on `/uci` |
| `/demo/mcdonalds` | `/demos` tour/chrome only |
| `/compliance` | Optional section patterns for AI compliance (PD-7 — no fake 8-agent matrix) |

### 3.3 Shared component reference (shell + primitives)

| Lovable artifact | Source | PP target |
|------------------|--------|-----------|
| `PermitPilotShell` | `components/permitpilot/PermitPilotShell.tsx` | `DashboardLayout` chrome |
| `AppSidebar` / header patterns | Shell | `AppSidebar`, header, `MobileBottomNav` |
| `ProductPrimitives` | `ProductPrimitives.tsx` | New/shared under `components/` (PageHeader, StatCard, MetricCard, Panel, StatusPill, ProgressLine, AlertBanner, ServicePill) |
| `UciLoading` / `UciEmpty` | `UciStates.tsx` | Visual only; loading tied to real fetch |
| `AccessDenied` pattern | `AccessDenied.tsx` | Denied UI restyle; keep PP gates |
| `.pilot-*`, `.signal-grid`, tokens | `index.css` | Align `src/index.css` / Tailwind |
| shadcn `ui/*` restyles | `components/ui/*` | Restyle existing PP shadcn set |

### 3.4 Flow reference only (2 pages + IA patterns)

Page-level flow refs (not full/partial visual wraps of a shipped PP body):

| Lovable route | Flow borrowed | Do not ship as |
|---------------|---------------|----------------|
| `/onboarding/authorization` | LOA step sequence (if PD-4) | Production LOA without schema |
| `/delivery/authorization` | Same LOA component; treat as alias of onboarding | Second production route |

Additional **IA/flow patterns** (not separate inventory pages): UCI multi-route navigation metaphor → tabs/drawers on `/uci` (never unguarded `/dashboard/uci`); Lovable “Delivery” grouping labels → hybrid nav pointing at PP paths; header “New Workflow” CTA placement only — do not ship `AiWorkflow` localStorage as production.

### 3.5 Unsupported Lovable pages — placeholder classification (55)

**55** inventory entries = all Lovable routes **not** in §3.1–3.4 page lists (includes catch-all `*`). These pages lack a current PermitPilot production body. **Do not** auto-treat them all as excluded or prototype-only.

Classify **each** unsupported page as exactly one of:

| Classification | When to use | Nav / discoverability |
|----------------|-------------|------------------------|
| `visible_placeholder` | High-value roadmap item the client expects in primary nav — use sparingly | In hybrid nav, clearly labeled |
| `hidden_feature_flag_placeholder` | Incomplete but promising feature | Behind feature flag; not in default nav |
| `admin_preview_placeholder` | Internal / design review of complex future UX | Admin-gated; labeled Preview |
| `direct_route_placeholder` | Detail/child flow of a future parent; not nav-listed | Direct URL / deep link only |
| `exclude_due_to_confusion_or_duplication` | True duplicate, abandoned prototype that conflicts with live workflows, or UI that would mislead users about scrapers / UCI / auth / billing | No route registration for product; keep PP behavior (e.g. `NotFound`) |

**Placeholder page rules** (apply to every non-`exclude_*` classification above):

1. Preserve the Lovable page design and intended flow (layout, hierarchy, steps, empty/planned structure).
2. Clearly label the feature as **“Coming soon”**, **“Preview”**, or **“Not yet connected”** (choose the label that matches classification: Coming soon for visible roadmap; Preview for admin review; Not yet connected for flag/direct stubs).
3. Disable actions that require backend support.
4. Do **not** simulate successful saves, submissions, approvals, uploads, or processing.
5. Do **not** show mock data as real production data.
6. Do **not** expose credentials or fake account behavior.
7. Document the future backend integration point (table/API/Edge/worker) on the page and in §12 inventory.
8. Define whether the page appears in navigation, behind a feature flag, for admins only, or by direct URL (see classification column above).

**Decision heuristics (grounded in gap analysis / replication plan):**

- Prefer **exclude** for duplicates (`/dashboard/uci`, `/matrix`, `/matrix/unified`), hard-coded α, catch-all→dashboard, localStorage “workflow” boards, fake billing/CRM vs Stripe, Knowledge Graph / Mission Control / Command Center that imply live ops, and inbox UIs that collide with `NotificationBell`.
- Prefer **visible_placeholder** only for a few client-facing nav items (Permit Queue, Glossary).
- Prefer **hidden_feature_flag** for field/SIR/inspections/scheduling/feasibility/timeline and similar roadmap suites.
- Prefer **admin_preview** for Lovable Cloud admin surfaces (authorizations / members / audit) pending PD-5 + BE.
- Prefer **direct_route_placeholder** for child pages of a flagged hub (SIR children, closeout archive/tracker, site feasibility).

#### Counts by classification

| Classification | Count |
|----------------|------:|
| `visible_placeholder` | **2** |
| `hidden_feature_flag_placeholder` | **21** |
| `admin_preview_placeholder` | **3** |
| `direct_route_placeholder` | **7** |
| `exclude_due_to_confusion_or_duplication` | **22** |
| **Total unsupported** | **55** |

#### Summary by classification group

| Classification | Routes |
|----------------|--------|
| `visible_placeholder` | `/permit-queue`, `/reference/glossary` |
| `hidden_feature_flag_placeholder` | `/projects/:id/timeline`, `/projects/:id/gantt`, `/agents`, `/compliance/intelligence`, `/compliance/prescreen`, `/feasibility`, `/critical-path`, `/utility/conflict-hunter`, `/utility/easements`, `/scheduling/long-lead`, `/scheduling/predictive-impact`, `/uci/miss-utility`, `/mobile/survey`, `/mobile/camera`, `/mobile/map`, `/field/studio`, `/sir`, `/inspections/special`, `/inspections/final-co`, `/inspections/release-tracker`, `/closeout` |
| `admin_preview_placeholder` | `/admin/authorizations`, `/admin/members`, `/admin/audit` |
| `direct_route_placeholder` | `/feasibility/site`, `/sir/workspace`, `/sir/annex`, `/sir/executive`, `/sir/sync`, `/closeout/archive`, `/closeout/tracker` |
| `exclude_due_to_confusion_or_duplication` | `*`, `/dashboard/uci`, `/matrix`, `/matrix/unified`, `/projects/alpha`, `/matrix/ai-workflow`, `/mission-control`, `/command-center`, `/operations`, `/messages`, `/architecture`, `/content-studio`, `/raze`, `/uci/knowledge-graph`, `/admin/invoicing`, `/admin/crm`, `/admin/milestone-billing`, `/admin/past-performance`, `/admin/endpoints`, `/closeout/post-mortem`, `/closeout/post-mortem/analytics`, `/closeout/post-mortem/financial` |

Full per-page inventory (nav, audience, missing BE, disabled controls, integration dependency, confusion risk) is in **§12**.

**Coverage check:** 14 full + 17 partial + 2 flow pages + 55 unsupported (reclassified) = **88** Lovable inventory routes. Shared component refs (§3.3) are artifacts, not extra routes.

**Note:** `/onboarding/authorization` and `/delivery/authorization` remain **flow reference** (§3.4), not part of the 55. They still need PD-4 + schema before any non-placeholder production LOA; until then treat per §12 “related deferred surfaces.” `/compliance` DesignCheck matrix remains **partial** (§3.2) gated by PD-7 — not in the 55.

---

## 4. Preserve current route behavior

### 4.1 Paths that must stay (bookmarks, deep links, redirects, integrations)

| Category | Paths | Reason |
|----------|-------|--------|
| Auth | `/auth` | Session entry; marketing CTAs |
| Marketing | `/`, `/demos`, `/pricing`, `/contact`, `/faq`, `/install` | Public SEO / CTAs |
| Token | `/portal/:token`, `/embed/:token`, `/invite/:token` | Email/share/embed; **absent from Lovable** |
| Core app | `/dashboard`, `/projects`, `/settings`, `/analytics` | Bookmarks |
| Jurisdictions | `/jurisdictions/map`, `/jurisdictions/compare`, `/jurisdictions/:stateCode`, legacy `/jurisdiction-comparison` | Deep links + alias |
| Intel / calc | `/permit-intelligence`, `/code-compliance`, `/code-reference`, `/roi-calculator`, `/consolidation-calculator` | Nav + docs |
| Comments | `/comment-review`, `/classified-comments`, `/response-matrix` | Operational |
| Scrape / filing | `/portal-data`, `/permit-wizard-filing` | Mobile nav + scrape |
| UCI | `/uci` | Single production entry |
| Admin | `/admin`, `/admin/jurisdictions`, `/admin/feature-flags`, `/admin/shadow-mode` | Admin bookmarks |
| Docs / preview | `/api-docs`, `/mvp-documentation`, `/design-system-preview` | Help / QA |
| Baltimore | `/baltimore*` | Existing mock routes (nav visibility per PD-13) |
| Catch-all | `*` → `NotFound` | Do not copy Lovable redirect-to-dashboard for unknown public URLs |

### 4.2 Where Lovable differs — preferred strategy

| Difference | Strategy |
|------------|----------|
| `/login`, `/signup` vs `/auth` | Keep `/auth`; optional frontend redirects from Lovable paths (PD-1) |
| `/portals/harvest` vs `/portal-data` | Keep `/portal-data`; optional alias after visual parity (PD-12) |
| `/matrix/guided` vs `/permit-wizard-filing` | Keep current path; optional alias |
| `/matrix/response` vs `/response-matrix` | Keep current path; optional alias |
| `/compliance/analyzer` vs `/code-compliance` | Keep current path; optional alias |
| `/checklists` vs `/checklist-history` | Keep current; optional alias |
| `/portfolio/executive` vs `/analytics` | Keep `/analytics` |
| `/utility-map` vs `/jurisdictions/map` | Keep PP path |
| UCI multi-routes vs `/uci` | Prefer tabs/drawers on `/uci` (PD-6); add nested routes **only** when each is wired to `uciApi` |
| Lovable `/` inside shell for anon | Prefer current public marketing (PD-3) |
| Lovable catch-all → dashboard | Prefer PP `NotFound` |

**Default:** no route restructure unless clear UX benefit and zero functional risk. Prefer aliases/redirects over renames.

---

## 5. Shared design-system migration

Sources: Lovable `docs/lovable-design-system.md` / inventory tokens; current `src/index.css`, `tailwind.config.ts`, `components/ui/*` (already Inter / Cormorant / Inter Tight / JetBrains Mono + cream/obsidian/teal/gold).

Prefer **shared primitives** under `src/components/ui/` + a thin `components/design/` or `components/permitpilot/` ProductPrimitives port — restyle before replace.

| Element | Current | Lovable | Action | Business-logic risk | Shared location |
|---------|---------|---------|--------|---------------------|-----------------|
| Typography scale | Editorial helpers + page H1s | `font-tight` H1, `font-display` metrics, `.pilot-kicker` | Restyle tokens + PageHeader | Low | `Typography.tsx`, ProductPrimitives `PageHeader` |
| Fonts | Inter, Cormorant, Inter Tight, JetBrains | Same stack | Align weights/usage | None | `main.tsx` imports |
| Colors / themes | HSL cream/obsidian/teal/gold | Dark canonical Obsidian; light editorial | Align CSS variables to Lovable tables | Low (theme only) | `index.css`, `tailwind.config.ts` |
| Backgrounds | Surfaces | `.signal-grid`, surface-muted | Add utilities; use sparingly on shell | Low | `index.css` |
| Spacing | Mixed | `px-4 py-5 md:px-6 lg:px-8`, `gap-4/5/6`, `p-5` cards | Standardize page containers | Low | Layout + PageHeader |
| Radius | Existing `--radius` | `0.5rem` scale | Align variables | None | `index.css` |
| Shadows | Mixed | Soft editorial / raised cards | Restyle `.pilot-card-raised` | Low | `index.css` |
| Cards | shadcn Card + custom | `.pilot-card`, Panel | Restyle; use Panel for sections | Low if presentational | `ui/card.tsx` + ProductPrimitives |
| Buttons | shadcn Button | `.pilot-button-primary/ghost` | Map variants; keep disabled/loading behavior | Med if click handlers lost | `ui/button.tsx` |
| Inputs / selects / checkboxes | shadcn + RHF | `.pilot-input` + shadcn | Restyle; keep Form/zod | Med on settings/auth | `ui/input.tsx`, `select`, `checkbox`, `form` |
| Tabs | shadcn Tabs | Same | Restyle active states | Low | `ui/tabs.tsx` |
| Tables | shadcn Table | Admin + native | Restyle; keep sort/filter logic | Med on matrix/admin | `ui/table.tsx` |
| Badges / status | Badge + custom | `StatusPill`, `ServicePill` | Add StatusPill; **map tones from PP status enums** — do not invent statuses | **High** if status strings changed | ProductPrimitives + status mappers |
| Dropdowns / tooltips | shadcn | Same | Restyle | Low | `ui/dropdown-menu`, `tooltip` |
| Dialogs / drawers / sheets | shadcn | Same patterns | Restyle; keep controlled open state from parents | Med | `ui/dialog`, `sheet`, `drawer` |
| Alerts | toast/sonner + banners | `AlertBanner` | Add banner; keep sonner for ops | Low | ProductPrimitives + sonner |
| Empty states | Per-page copy | `UciEmpty`-style | Shared EmptyState; real conditions | Low | `components/design/EmptyState` |
| Skeletons | Dashboard/Projects | `Skeleton` / UciLoading | Visual only; bind to real `isLoading` | Med if fake delay | `ui/skeleton` |
| Breakpoints | Tailwind defaults | Same | Audit mobile nav + tables | Med | Tailwind |
| Sidebar | `AppSidebar` + shadcn sidebar | Lovable groups chrome | Visual shell; **hrefs = PP routes** | **High** if wrong hrefs/gates | `layout/AppSidebar.tsx` |
| Header | Dashboard header + scrape + notifications | Sticky blur header, project picker | Visual; keep scrape indicator, palette, settings, logout | **High** | `DashboardLayout` / header child |
| Page containers | Mixed | Main padding + PageHeader | Standardize | Low | Layout + PageHeader |

---

## 6. Application-shell plan

**Goal:** Lovable shell visuals + PermitPilot functionality.

| Concern | Lovable pattern | PP preserve | Implementation |
|---------|-----------------|-------------|----------------|
| Sidebar groups/items | Command / Onboarding / Delivery / Intelligence / Resources / Admin | Build from **current valid PP routes** (hybrid IA, PD-11) | Rewrite nav arrays in `AppSidebar.tsx` visually; keep PP hrefs |
| Suggested hybrid groups | Lovable labels + PP links | Intake: Filing `/permit-wizard-filing`, UCI `/uci`, Portal Harvest `/portal-data`, Comment Review, Classified Comments, AI Compliance `/code-compliance`; Response: `/response-matrix`; Projects; Intelligence: Shovels + Code Library; Resources: analytics/map/compare/checklists/calcs/demos/pricing; Admin (gated); Help | Primary hrefs = valid PP routes. Add **labeled** `visible_placeholder` nav items only per §3.5/§12 (e.g. Permit Queue “Coming soon”). Do **not** nav-link `exclude_due_to_confusion_or_duplication` pages (Operations, Knowledge Graph, fake Command Center, etc.). |
| Active route | Sidebar `isActive` | Same | Keep router match |
| Collapse | `collapsible="icon"` | Keep | shadcn sidebar |
| Mobile nav | Lovable responsive sidebar/sheet | Keep `MobileBottomNav`: `/`, `/projects`, `/portal-data`, `/permit-wizard-filing`, More | Restyle; same hrefs |
| Header | Sticky, blur, actions | Keep scrape indicator, `NotificationBell`, settings, theme | Port Lovable header structure |
| Breadcrumbs | Lovable breadcrumb text | Optional; don’t break deep links | Presentational |
| Project selector | `ActiveProjectPicker` | **`SelectedProjectContext`** + `?projectId=` / localStorage | Adapter: Lovable picker UI → PP context |
| Tenant/org | `?tenant=` branding only | UCI tenant access via RPC — branding ≠ authz | Optional brand mark only |
| User menu / logout | Avatar menu | `useAuth.signOut` + **clear scrape session** | Must call existing sign-out path |
| Admin links | Role-filtered | `isAdmin` / `useRequireAdmin` / `user_roles` | Keep PP admin gate — not Lovable staff/client |
| Command palette | Search | `CommandPalette.tsx` — fix stale links if touched | Keep ⌘K |
| Notifications | Lovable bell mock | Real `NotificationBell` | Restyle only |
| Route guards | Client UCI/admin | `ProtectedLayoutRoute`, `PublicOnlyRoute`, `useRequireAdmin`, RLS | Never replace with Lovable-only client gates |

**Providers that must remain nested (shell swap):** `AuthProvider`, `SelectedProjectProvider`, `ScrapeProvider`, `SidebarProvider` (see mapping JSON `shell.preserveProviders`).

---

## 7. Page implementation plan

For each group: Lovable ref → preserve → components → adapters → interactions → testing → phase deps. **Do not remove controls** because Lovable mocks omitted them — integrate into the new design.

### 7.1 Public / auth

- **Ref:** Login/Signup, Contact, Home (PD-3), shared marketing tokens  
- **Preserve:** Supabase auth, Stripe pricing, contact Edge, demos lead gate, FAQ, install  
- **Components:** `Auth.tsx`, marketing layouts, `Contact.tsx`, `Pricing.tsx`, `Demos.tsx`  
- **Adapters:** Auth form view-model → `useAuth`  
- **Interactions:** Optional `/login`→`/auth` redirects  
- **Test:** Sign-in/up/out; public-only redirect  
- **Phase:** 1 tokens → 3 pages  

### 7.2 Dashboard

- **Ref:** `/dashboard`  
- **Preserve:** Onboarding, getting-started, real widgets (`AgentWorkflowStatus`, health, deadlines)  
- **Components:** `pages/Dashboard.tsx`, `components/dashboard/*`  
- **Adapters:** KPI view-model from projects/analytics — **no mock KPI arrays**  
- **Phase:** 3  

### 7.3 Projects

- **Ref:** `/projects`, create chrome from `/projects/new`  
- **Preserve:** CRUD/Kanban, team invite, documents section, share  
- **Components:** `Projects.tsx`, `projects/*`, `documents/*`  
- **Adapters:** Project card fields from real `projects` columns (no invented phaseIdx DB columns)  
- **Credentials:** Create flow may **link** to Settings credentials API — never Lovable visual vault as store  
- **Phase:** 3–4  

### 7.4 Analytics / jurisdiction

- **Ref:** Portfolio executive, utility-map chrome  
- **Preserve:** `useAnalytics`, Mapbox token, compare tool, state landings  
- **Components:** `analytics/*`, `jurisdictions/*`  
- **Phase:** 3  

### 7.5 Permit intelligence & code compliance

- **Ref:** Analyzer full; DesignCheck matrix only if PD-7  
- **Preserve:** Shovels Edge, `/api/analyze-drawing`, ErrorBoundary, code library  
- **Components:** `shovels/*`, `compliance/AIComplianceAnalyzer`, `code-reference/*`  
- **Phase:** 4  

### 7.6 Admin

- **Ref:** `/admin` hub chrome only  
- **Preserve:** Users/subscribers/drips, jurisdictions CRUD, feature flags UI, shadow mode  
- **Placeholders:** Lovable `/admin/authorizations|members|audit` as `admin_preview_placeholder` only (Preview; PD-5 + BE) — see §12  
- **Exclude:** Lovable CRM / invoicing / milestone / endpoints / past-performance (`exclude_due_to_confusion_or_duplication`)  
- **Phase:** 3–4  

### 7.7 Settings

- **Ref:** `/settings` layout  
- **Preserve:** Profile, password, **`PortalCredentialsManager`**, Microsoft mailbox, branding  
- **Adapters:** Credential list DTO (no password fields)  
- **Phase:** 4 (**high risk**)  

### 7.8 Portal Harvest / scraping

- **Ref:** `/portals/harvest`  
- **Preserve:** Start/cancel, SSE/poll, durable jobs, Arlington progress, file results, Accela view  
- **Components:** `PortalDataViewer`, `scrape/ScrapeProgressPanel`, portal viewers  
- **Adapters:** Job status → StatusPill tones (enum-preserving)  
- **Phase:** 5  

### 7.9 Documents / comments

- **Ref:** Document vault layout; matrix chrome for comments  
- **Preserve:** Upload/ingestion statuses, comment parse/classify, PP-only comment routes  
- **Components:** `documents/*`, `comment-review/*`, `ClassifiedComments`  
- **Phase:** 4–5  

### 7.10 AI compliance

- Covered in 7.5; keep batch/agent status widgets on dashboard if present  

### 7.11 Response Matrix

- **Ref:** `/matrix/response`  
- **Preserve:** Edge generate-*, approval gate (project admin), export package  
- **Components:** `response-matrix/*`  
- **Phase:** 5  

### 7.12 Permit Wizard

- **Ref:** `/matrix/guided`  
- **Preserve:** Preflight/execute, filing status machine  
- **Components:** `permit-wizard/*`  
- **Phase:** 5  

### 7.13 Baltimore

- **Ref:** none  
- **Preserve:** Mock routes; hide from primary nav (PD-13)  
- **Phase:** 6 consistency (low priority)  

### 7.14 UCI dashboard / workflows

- **Ref:** `/uci` + stage pages as visual panels  
- **Preserve:** `uciApi`, access service, stage transitions, provider/territory/load-profile/application/submission, PEPCO live-submit **env gate**, email fallback  
- **Components:** `pages/UciDashboard.tsx`, `components/uci/*`  
- **Adapters:** Per-stage view-models; replace Lovable static arrays  
- **Never:** Mount unguarded `/dashboard/uci`; enable live submit for UI convenience  
- **Phase:** 5 (logic-first), polish in 6  

### 7.15 Portals / embeds / invitations / client-facing

- **Ref:** Shared tokens / empty / status pills only  
- **Preserve:** Token auth, invite RPCs, embed realtime  
- **Phase:** 3 visual + 7 regression  

---

## 8. Business-logic preservation map

Frontend components/modules that contain or trigger important behavior. **Do not replace with static Lovable.** Prefer restyle-in-place or extract presentational child while keeping hook/API calls.

| File path | Behavior | Hooks / contexts | API calls | State transitions | Why not Lovable static | Migration method |
|-----------|----------|------------------|-----------|-------------------|------------------------|------------------|
| `src/contexts/ScrapeContext.tsx` | Scrape session, progress, cancel, logout clear | Self + layout | `/api/login`, `/api/scrape`, cancel, jobs | queued→terminal scrape statuses | Lovable harvest has no real jobs | Keep; UI subscribes |
| `src/components/scrape/ScrapeProgressPanel.tsx` | Progress UI | ScrapeContext | Poll/SSE consumers | Progress % / stages | Fake progress would lie | Restyle panel |
| `src/pages/PortalDataViewer.tsx` | Harvest + render portal_data | Scrape + SelectedProject | Scrape + project fields | Empty vs populated | Mock harvest | Layout shell around existing body |
| `src/lib/portalCredentialsApi.ts` + `settings/PortalCredentialsManager.tsx` | Credential CRUD secrecy | Auth JWT | `/api/portal-credentials` | List without password | Lovable vault is visual-only | Restyle manager only |
| `src/lib/uciApi.ts` | JWT, refresh-on-401, all UCI calls | Auth | `/api/uci/*` | Stage/state enums | Lovable static UCI | Keep client; adapters map display |
| `src/components/uci/*` (e.g. `UciSetupWorkflow`, `LoadProfileWorkspace`, D13 panels, Pepco lists) | Init, resolve, sync, submit UX | uciApi, project | Coordination APIs | NOT_STARTED→COMPLETED etc. | Static pages | Restyle + wire; incomplete stages stay incomplete |
| `src/pages/UciDashboard.tsx` | UCI composition | Above | Above | Access denied / expired | Static dashboard | Presentational restructure |
| `src/pages/ResponseMatrix.tsx` + `response-matrix/*` | Generate/approve/export | Projects, RQ | Edge generate-*; approval trigger | `response_status` | Mock matrix | Restyle tables/panels |
| `src/pages/CommentReview.tsx` + `comment-review/*` | Upload/parse comments | Projects | Edge parse agents | Comment statuses | No Lovable page | Restyle keep logic |
| `src/pages/ClassifiedComments.tsx` | Discipline classify | Projects | Classifier Edge | Classification states | No Lovable page | Restyle |
| `src/pages/PermitWizardFiling.tsx` + `permit-wizard/*` | Preflight/execute filing | Projects | permitwizard-* + scraper filing | filing_status machine | GuidedFlow mock | Chrome only |
| `src/components/compliance/AIComplianceAnalyzer.tsx` | Drawing analyze | Getting started | `/api/analyze-drawing` | ErrorBoundary outcomes | Prefer current API over Lovable edge | Restyle analyzer |
| `src/components/documents/*` | Upload / ingestion | Projects | ingest Edge + worker | ingestion + ai_ingestion statuses | Mock vault | Adapter + restyle |
| `src/hooks/useAuth.tsx` | Session | Root | Supabase Auth | Signed in/out | Parallel Lovable auth stack forbidden | Keep |
| `src/contexts/SelectedProjectContext.tsx` | Project selection continuity | Most features | Supabase projects | Selected id URL/storage | Hard-coded α project | Keep semantics |
| `src/hooks/useProjects.ts` (or projects hooks) | CRUD | Projects page | Supabase | Project status enum | Mock cards | Keep |
| `src/components/layout/DashboardLayout.tsx` | Providers + scrape chrome | All protected | — | — | Shell swap must retain providers | Swap chrome behind same export |
| `src/components/layout/AppSidebar.tsx` | Nav + admin filter | Auth/admin | Creds query side-effect | — | Blind Lovable nav breaks PP | Hybrid nav |
| `src/components/navigation/CommandPalette.tsx` | ⌘K routes | Router | — | — | Stale Lovable paths | Update hrefs carefully |
| `src/components/auth/*` + route guards | Access control | useAuth, admin | — | Redirects | Lovable client-only gates insufficient | Keep PP guards |
| Admin managers (`admin/*`, drip, shadow) | Admin ops | Admin | Supabase + Edge | — | Lovable admin Cloud APIs | Restyle PP admin |

---

## 9. Frontend adapter plan

Adapters reshape for **presentation only** — no duplicated backend rules, no new status enums, no client-side credential crypto.

| Adapter / view-model (recommended file) | Current API / source | Current shape | Target visual shape | Field / status mapping | Null / incomplete | Loading / error / empty |
|-----------------------------------------|----------------------|---------------|---------------------|------------------------|-------------------|-------------------------|
| `src/adapters/projectCardAdapter.ts` | `useProjects` / `projects` | DB columns + team | Lovable project card | Map real status → StatusPill tone; omit fake phaseIdx/queueHealth unless computed | Hide missing optional fields | Skeleton / empty portfolio |
| `src/adapters/dashboardKpiAdapter.ts` | Dashboard widgets, analytics, projects | Heterogeneous | StatCard / MetricCard | Counts from real queries | Zero vs null | Widget-level loading |
| `src/adapters/scrapeStatusAdapter.ts` | `ScrapeContext` / `scrape_jobs` | Enum statuses | StatusPill + ProgressLine | Exact enum → tone/label; never collapse failed→success | No job → empty harvest CTA | Live progress; error banner |
| `src/adapters/portalDataAdapter.ts` | `projects.portal_data` | Nested portal JSON | Harvest tables/cards | Pass-through display fields | Empty object → empty state | Loading while fetch |
| `src/adapters/credentialListAdapter.ts` | `portalCredentialsApi` | Sanitized rows | Vault list UI | Username/portal meta only; **never password** | Empty list | Error toast; no echo |
| `src/adapters/commentResponseAdapter.ts` | `parsed_comments` | status + response_status | Matrix rows | Keep exact strings for approve API | Unparsed → pending UI | Agent running states |
| `src/adapters/filingStatusAdapter.ts` | `permit_filings` | filing_status | Guided step chrome | preflight→submitted mapping to steps | No filing → start CTA | Failed/cancelled visible |
| `src/adapters/documentIngestionAdapter.ts` | `project_documents` + jobs | ai_ingestion_status + job status | Vault rows | Enum → pill | unsupported/low_text messaging | Processing spinner |
| `src/adapters/uciCoordinationAdapter.ts` | `uciApi` coordination record | stage + current_stage_state | UCI dashboard / stage header | Stages 1–10 labels; state enum tones | Stages 7–10 thin FE → “partial / coming” **without** fake success | Real fetch loading; AccessDenied |
| `src/adapters/uciProviderTerritoryAdapter.ts` | Providers + resolution APIs | Provider lists / resolution | Provider-map / setup panels | Live providers prefer over static `utilityProviders.ts` | Manual path when auto geo blocked | Error + retry |
| `src/adapters/uciLoadProfileAdapter.ts` | Load-profile APIs | Profile payloads | LoadProfileAnalyzer chrome | Field map for charts/tables | Incomplete profile | Empty analyzer |
| `src/adapters/uciApplicationSubmitAdapter.ts` | Application + submit APIs | draft_status + submit result | Builder / submit panels | draft→submitted; live submit gated | Gate off → email fallback copy | Failed submit visible |
| `src/adapters/analyticsPortfolioAdapter.ts` | `project_analytics` | Metrics series | Executive portfolio | Chart series rename only | No data empty | Redirect unauth |
| `src/adapters/jurisdictionMapAdapter.ts` | Mapbox + jurisdictions | Geo/features | Utility-map chrome | Don’t invent utility lines | Missing token error | Map error state |
| `src/adapters/authFormAdapter.ts` | `useAuth` | Session + errors | Login/Signup chrome | Map error messages | — | Validation |
| `src/adapters/adminHubAdapter.ts` | AdminPanel data | Users/subs/drips | Admin hub cards | PP entities only | — | Admin unauthorized |

**Count of proposed adapters:** 16 (above). Additional thin mappers allowed if co-located with feature folders — avoid duplicating rules.

---

## 10. Implementation phases

### Phase 0 — Branch and baseline

- **Work:** Feature branch; freeze mapping JSON tags; lock PD-1…PD-14 written answers; snapshot screenshots of key routes; confirm preserve list.  
- **Routes:** none changed.  
- **Files:** docs / checklist only (this plan + mapping).  
- **Deps:** none.  
- **Acceptance:** Signed PD checklist; inventory freeze.  
- **Regression:** N/A.  
- **Rollback:** Docs only.

### Phase 1 — Design tokens and shared primitives

- **Routes:** Visual-only across app (no route body swaps required).  
- **Files likely:** `src/index.css`, `tailwind.config.ts`, `src/main.tsx` (fonts), new ProductPrimitives / EmptyState / StatusPill, light `ui/*` restyles.  
- **Deps:** Phase 0.  
- **Acceptance:** Light/dark render; no API payload changes; snapshot dashboard, projects, portal-data, uci, settings.  
- **Regression:** Visual smoke.  
- **Rollback:** Revert CSS/token files only.

### Phase 2 — Application shell

- **Routes:** All protected (chrome only).  
- **Files:** `DashboardLayout.tsx`, `AppSidebar.tsx`, `MobileBottomNav.tsx`, header children, `CommandPalette.tsx` (href audit).  
- **Deps:** Phase 1; providers intact.  
- **Acceptance:** All current sidebar destinations reachable; admin gated; project selection persists; scrape indicator + logout clear scrape; mobile bottom nav works.  
- **Regression:** Auth redirect; admin deny; project switch.  
- **Rollback:** Prior layout/sidebar export; page bodies untouched.

### Phase 3 — Low-risk pages

- **Routes:** `/contact`, `/faq`, `/pricing`, `/demos`, `/install`, `/checklists` alias→`/checklist-history`, `/analytics`, `/projects`, `/dashboard`, `/code-reference`, `/roi-calculator`, `/consolidation-calculator`, `/api-docs`, marketing `/` if PD-3, token pages light restyle, `/admin` overview chrome.  
- **Files:** Corresponding `pages/*` + presentational components; adapters for dashboard/projects/analytics.  
- **Deps:** Phase 2.  
- **Acceptance:** Per-page checklist in constraints §4.  
- **Regression:** Auth, project CRUD smoke, Stripe CTA, contact send.  
- **Rollback:** Single page import revert in `App.tsx`.

### Phase 4 — Core project pages

- **Routes:** Documents UX on projects, `/code-compliance`, `/comment-review`, `/classified-comments`, `/settings`, `/permit-intelligence`, jurisdiction pages, admin children.  
- **Files:** `documents/*`, `compliance/*`, comment pages, `Settings.tsx`, `PortalCredentialsManager`, jurisdiction components.  
- **Deps:** Phase 3.  
- **Acceptance:** Ingestion statuses surface; credentials never return password; analyzer ErrorBoundary; comment flows intact.  
- **Regression:** Upload/ingest; credential create/list; Shovels search.  
- **Rollback:** Per-page.

### Phase 5 — Complex production workflows (logic first, visual around it)

- **Routes:** `/portal-data`, `/response-matrix`, `/permit-wizard-filing`, `/uci` (stage panels).  
- **Files:** Portal/scrape/response-matrix/permit-wizard/uci components + adapters (scrape, filing, comments, UCI).  
- **Deps:** Phases 2–4 green.  
- **Acceptance:** Real scrape terminal statuses; Arlington progress; response approve gated; filing machine unchanged; UCI JWT/access/submit gate; no mock rows when empty.  
- **Regression:** Full scrape lifecycle; UCI transition; filing preflight/execute; matrix approve.  
- **Rollback:** FE page revert only — **never** touch scraper-service for UI rollback.

### Phase 6 — Responsive and consistency pass

- **Routes:** All redesigned + Baltimore nav hide; optional aliases (PD-12); nav label polish (PD-11).  
- **Files:** Shell, tables overflow, drawers→sheets, StatusPill consistency.  
- **Deps:** Phase 5.  
- **Acceptance:** Mobile bottom nav + key workflows usable; no dead primary nav links; PP-only features still linked.  
- **Regression:** Mobile scrape/filing/projects; desktop matrix scroll.  
- **Rollback:** Nav array restore.

### Phase 7 — Regression and client review

- **Routes:** Full matrix below.  
- **Files:** Fixes only.  
- **Deps:** Phases 0–6.  
- **Acceptance:** Verification matrix pass; client visual review against Lovable reference; no BE migrations attributed solely to UI.  
- **Regression:** Full §11.  
- **Rollback:** Per boundary (tokens / shell / page); feature flags: prefer dual route registration — do not rely on localStorage `useFeatureFlags` for production cutover.

---

## 11. Testing matrix

| Area | Expected behavior | UI area changing | Risk | Validation method |
|------|-------------------|------------------|------|-------------------|
| Auth session | Sign-in/up/out; protected redirect; public-only `/` | Auth + shell | High | Manual + network; session cookie/JWT |
| Roles / admin | Non-admin blocked from `/admin/*` | Sidebar + AdminLayout | High | Two users |
| Project selection | `?projectId=` / localStorage continuity across harvest/UCI/comments | Header picker + pages | High | Switch project mid-flow |
| Project RLS | User A cannot mutate User B project via UI | Projects | High | Cross-account attempt |
| Scraper lifecycle | Start → progress → terminal; cancel/retry; Arlington durable | `/portal-data`, header scrape | **Critical** | Live job; UI matches API status |
| Downloads / files | File results lifecycle from scrape | Portal viewers | High | Download/view-file |
| Credentials | Create/list; **no password** in DOM/network | Settings | **Critical** | Network tab |
| Documents | Upload → ingestion statuses | Projects docs | High | Worker statuses |
| Comments | Parse/classify; empty/loading | Comment routes | High | Edge invoke + UI |
| AI compliance | Analyze drawing; ErrorBoundary | `/code-compliance` | Med | Upload fixture |
| Response Matrix | Generate; approve blocked without project admin | `/response-matrix` | **Critical** | Role matrix |
| Permit Wizard | Preflight/execute status machine | `/permit-wizard-filing` | **Critical** | Filing fixture |
| Portal Harvest | Empty portal_data ≠ mock rows | `/portal-data` | High | Empty project |
| UCI lifecycle | Init, provider, territory, load profile, application, submit gate | `/uci` | **Critical** | API + UI; env gate off |
| UCI access | Cross-tenant denied | `/uci` | High | Wrong project/tenant |
| Token portal / embed / invite | Valid/invalid/expired | Token routes | High | Token fixtures |
| Mobile / responsive | Bottom nav workflows | Shell + tables | Med | Device or narrow viewport |
| Marketing / Stripe | Checkout still starts | Pricing | Med | Checkout session create |
| Baltimore | Still mock; not treated as live portal | `/baltimore*` | Low | Smoke |

---

## 12. Scope boundaries

### In scope

- Lovable visual design, layouts, shell, nav structure (hybrid), hierarchy, flows presentation, tabs/drawers/modals/cards/tables/forms/status presentation, responsive behavior, tokens, interaction patterns  
- Frontend adapters / view-models  
- Optional route aliases/redirects after parity  
- Restyling all current PP routes (including PP-only)  
- Placeholders for selected future pages **only** as labeled non-operational UI (see below)

### Not in scope

- Copying Lovable mocks, fake success, fake progress, or prototype functionality as production  
- Replacing auth/session, RLS, tenant isolation, role model, schema, scraper workers, credential crypto, Edge contracts, UCI submit gate  
- Reimplementing Playwright in the browser  
- Client-side portal password storage  
- Parallel Supabase Auth stack  
- Shipping unsupported Lovable pages as **operational** product (placeholders per §3.5/§12 are allowed; `exclude_*` pages are not registered)  
- Backend migrations solely “to look like Lovable”  
- Removing PP-only features because Lovable lacks them  

### Placeholder and future pages

#### Rules (mandatory for every non-excluded placeholder)

| Rule | Requirement |
|------|-------------|
| Design | Preserve Lovable page design and intended flow |
| Label | “Coming soon” / “Preview” / “Not yet connected” — never ambiguous live product chrome |
| Actions | Disable controls that need backend support |
| No fake success | Do not simulate successful saves, submissions, approvals, uploads, or processing |
| No fake data | Do not show mock rows/KPIs as real production data |
| No fake auth | Do not expose credentials or fake account/login behavior |
| Integration note | Document future backend integration point (API/table/Edge/worker) |
| Discoverability | Explicitly set nav vs feature flag vs admin-only vs direct URL |

Placeholders are **frontend-only stubs**. Enabling a control requires a verified PP API (or an approved PD + BE program)—never Lovable in-file arrays.

#### Related deferred surfaces (not in the 55; see §3.2 / §3.4)

| Surface | Classification stance | Notes |
|---------|----------------------|-------|
| `/onboarding/authorization`, `/delivery/authorization` | Flow ref; no production LOA until PD-4 + `client_authorizations` | Optional admin-internal labeled Preview only |
| `/compliance` DesignCheck 8-agent matrix | Partial ref; PD-7 | Do not nav-ship fake 8-agent orchestration |

#### Placeholder-page inventory (all 55 unsupported Lovable routes)

| Lovable route | Page name | Proposed PP route | Classification | Nav visibility | Intended user | Missing backend capability | Controls that remain disabled | Future integration dependency | Risk of user confusion |
|---------------|-----------|-------------------|----------------|----------------|---------------|----------------------------|-------------------------------|-------------------------------|------------------------|
| `/permit-queue` | PermitQueue | `/permit-queue` | `visible_placeholder` | Primary nav (Coming soon) | Ops / staff | Aggregate queue over filings + scrape jobs | Open/assign/complete queue actions | Query design over `permit_filings` / `scrape_jobs` (PD-8) | Med — badge counts must not be mocked |
| `/reference/glossary` | Glossary | `/reference/glossary` | `visible_placeholder` | Help / Resources (Coming soon until content) | All authenticated | Authored glossary content (static OK) | Edit/publish if shown | Static content CMS or markdown pack | Low |
| `/projects/:id/timeline` | ProjectTimeline | `/projects/:id/timeline` | `hidden_feature_flag_placeholder` | Flag only (`project_timeline`) | Project members | Timeline / milestone model | Create/edit milestones, drag schedule | Project schedule schema (PD-10) | Med |
| `/projects/:id/gantt` | ProjectGantt | `/projects/:id/gantt` | `hidden_feature_flag_placeholder` | Flag only (`project_gantt`) | Project members | Gantt data model | Edit bars, dependencies, save | Same as timeline (PD-10) | Med |
| `/agents` | AgentCenter | `/agents` | `hidden_feature_flag_placeholder` | Flag only (`agent_center`) | Staff | Unified agent-run orchestration UI | Start/stop/rerun agents | Surface existing Edge agent statuses only when wired | **High** if fake runs shown |
| `/compliance/intelligence` | ComplianceIntelligence | `/compliance/intelligence` | `hidden_feature_flag_placeholder` | Flag only (`compliance_intelligence`) | Staff | Intelligence product beyond analyzer | Run intelligence jobs | PD-7 + agent orchestration | High |
| `/compliance/prescreen` | InternalPrescreen | `/compliance/prescreen` | `hidden_feature_flag_placeholder` | Flag only (`compliance_prescreen`) | Internal staff | Prescreen workflow | Submit/approve prescreen | PD-7 | Med |
| `/feasibility` | Feasibility | `/feasibility` | `hidden_feature_flag_placeholder` | Flag only (`feasibility`) | Staff / client | Feasibility domain APIs | Score/save feasibility | New domain or external GIS | Med |
| `/critical-path` | CriticalPath | `/critical-path` | `hidden_feature_flag_placeholder` | Flag only (`critical_path`) | Ops | Critical-path schedule engine | Recalculate/save path | Schedule model | Med |
| `/utility/conflict-hunter` | CrossUtilityConflictHunter | `/utility/conflict-hunter` | `hidden_feature_flag_placeholder` | Flag only (`utility_conflict_hunter`) | UCI ops | Conflict detection service | Run hunt / resolve conflicts | Utility conflict APIs | Med |
| `/utility/easements` | EasementRowManager | `/utility/easements` | `hidden_feature_flag_placeholder` | Flag only (`utility_easements`) | UCI ops | Easement CRUD | Save/upload easement rows | Easement storage + APIs | Med |
| `/scheduling/long-lead` | LongLeadEquipment | `/scheduling/long-lead` | `hidden_feature_flag_placeholder` | Flag only (`scheduling_long_lead`) | Ops | Equipment lead-time tracking | Commit dates / orders | Equipment APIs (thin today) | Med |
| `/scheduling/predictive-impact` | PredictiveScheduleImpact | `/scheduling/predictive-impact` | `hidden_feature_flag_placeholder` | Flag only (`scheduling_predictive`) | Ops | Predictive schedule model | Run prediction / apply | New analytics service | Med |
| `/uci/miss-utility` | UciMissUtility | `/uci/miss-utility` or panel on `/uci` | `hidden_feature_flag_placeholder` | Flag only (`uci_miss_utility`); optional UCI subnav when flagged | UCI ops | First-class Miss Utility 811 FE/API parity | Ticket create/submit | Confirm `/api/uci` coverage or new 811 integration | Med — must not imply live 811 |
| `/mobile/survey` | MobileSurvey | `/mobile/survey` | `hidden_feature_flag_placeholder` | Flag only (`mobile_field`) | Field staff | Mobile survey capture backend | Submit survey | Field data APIs + PWA | Med |
| `/mobile/camera` | MobileCamera | `/mobile/camera` | `hidden_feature_flag_placeholder` | Flag only (`mobile_field`) | Field staff | Photo capture → storage pipeline | Upload/capture save | Storage + field APIs | Med |
| `/mobile/map` | MobileMap | `/mobile/map` | `hidden_feature_flag_placeholder` | Flag only (`mobile_field`) | Field staff | Field map layers / offline | Pin save / sync | Map + field sync | Med |
| `/field/studio` | FieldStudio | `/field/studio` | `hidden_feature_flag_placeholder` | Flag only (`field_studio`) | Field staff | Field studio product | Publish/sync studio | Field suite BE | Med |
| `/sir` | Sir | `/sir` | `hidden_feature_flag_placeholder` | Flag only (`sir_suite`) | SIR users | SIR domain | Create/submit SIR | New SIR program | Med |
| `/inspections/special` | SpecialInspections | `/inspections/special` | `hidden_feature_flag_placeholder` | Flag only (`inspections`) | Inspectors / ops | Special inspection workflow | Schedule/pass/fail | Inspections APIs | Med |
| `/inspections/final-co` | FinalInspections | `/inspections/final-co` | `hidden_feature_flag_placeholder` | Flag only (`inspections`) | Inspectors / ops | Final CO inspection workflow | Sign-off / CO actions | Inspections APIs | Med |
| `/inspections/release-tracker` | InspectorReleaseTracker | `/inspections/release-tracker` | `hidden_feature_flag_placeholder` | Flag only (`inspections`) | Inspectors / ops | Release tracking | Release / notify | Inspections APIs | Med |
| `/closeout` | Closeout | `/closeout` | `hidden_feature_flag_placeholder` | Flag only (`closeout_suite`) | Ops | Post-permit closeout suite (≠ UCI stage prepare alone) | Complete closeout / archive actions | Distinct closeout product vs UCI stage 10 | **High** if confused with UCI closeout |
| `/admin/authorizations` | AdminAuthorizations | `/admin/authorizations` | `admin_preview_placeholder` | Admin only; Preview | Admin | `client_authorizations` (+ signatures) | Approve/sign/save LOA | PD-4/PD-5 + schema | High if looks live |
| `/admin/members` | AdminMembers | `/admin/members` | `admin_preview_placeholder` | Admin only; Preview | Admin | Lovable approval_status / workspace invites model | Approve/reject members | PD-5; keep PP `user_roles` / project invites until decided | **High** vs PP roles |
| `/admin/audit` | AdminAuditLog | `/admin/audit` | `admin_preview_placeholder` | Admin only; Preview | Admin | `access_audit_log` writers | Export/filter as live audit | PD-5 + audit table | Med |
| `/feasibility/site` | SiteFeasibility | `/feasibility/site` | `direct_route_placeholder` | Direct URL only (from Feasibility hub) | Staff / client | Site-level feasibility APIs | Save site assessment | Child of `feasibility` flag | Low–Med |
| `/sir/workspace` | SirWorkspace | `/sir/workspace` | `direct_route_placeholder` | Direct URL only | SIR users | SIR workspace APIs | Edit/submit workspace | Child of `sir_suite` | Low–Med |
| `/sir/annex` | SirAnnex | `/sir/annex` | `direct_route_placeholder` | Direct URL only | SIR users | SIR annex APIs | Save annex | Child of `sir_suite` | Low–Med |
| `/sir/executive` | SirExecutive | `/sir/executive` | `direct_route_placeholder` | Direct URL only | Exec / SIR | SIR executive rollup | Export/share as live | Child of `sir_suite` | Med |
| `/sir/sync` | SirSync | `/sir/sync` | `direct_route_placeholder` | Direct URL only | SIR users | SIR sync service | Trigger sync | Child of `sir_suite` | Med |
| `/closeout/archive` | CloseoutArchive | `/closeout/archive` | `direct_route_placeholder` | Direct URL only | Ops | Closeout archive store | Restore/delete archive | Child of `closeout_suite` | Med |
| `/closeout/tracker` | CloseoutTracker | `/closeout/tracker` | `direct_route_placeholder` | Direct URL only | Ops | Closeout tracker state | Update tracker steps | Child of `closeout_suite` | Med |
| `*` | Navigate → `/dashboard` | Keep PP `*` → `NotFound` | `exclude_due_to_confusion_or_duplication` | N/A — do not register Lovable behavior | Public / all | — | — | — | **High** — silent redirect hides bad URLs |
| `/dashboard/uci` | UciDashboard (nested) | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Use guarded `/uci` only | **High** — unguarded UCI dup |
| `/matrix` | MasterMatrix | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Use `/permit-wizard-filing` + `/response-matrix` | High — overlaps live matrix |
| `/matrix/unified` | UnifiedMatrix | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Same as `/matrix` | High |
| `/projects/alpha` | ProjectWorkspace | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Real project IDs via `SelectedProjectContext` | **High** — hard-coded slug |
| `/matrix/ai-workflow` | AiWorkflow | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Do not ship localStorage as production workflow | **High** — fake scrape/UCI-like board |
| `/mission-control` | MissionControl | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Prefer `/analytics` + dashboard widgets | High — fake ops portfolio |
| `/command-center` | CommandCenter | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Prefer `/dashboard`; α links broken | **High** |
| `/operations` | OperationsBoard | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Real ops = harvest / filing / UCI | **High** — implies live board |
| `/messages` | Messages | — | `exclude_due_to_confusion_or_duplication` | None | — | Real inbox (PD-9) | — | Keep `NotificationBell`; inbox only after messaging BE | **High** — conflicts with notifications |
| `/architecture` | PlatformArchitecture | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Use `/design-system-preview` / docs | Med — dup help surface |
| `/content-studio` | ContentStudio | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Non-product prototype | Med |
| `/raze` | RazePermit | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Abandoned prototype | Med |
| `/uci/knowledge-graph` | UciKnowledgeGraph | — | `exclude_due_to_confusion_or_duplication` | None | — | Graph DB / ontology | — | Would invent UCI relationships | **High** — misleading UCI model |
| `/admin/invoicing` | AdminInvoicing | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Keep Stripe / QB; no fake invoices | **High** — fake billing |
| `/admin/crm` | AdminCrm | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | No CRM product | High |
| `/admin/milestone-billing` | MilestoneBilling | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Keep Stripe | **High** — fake billing |
| `/admin/past-performance` | AdminPastPerformance | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Prefer real analytics | Med |
| `/admin/endpoints` | AdminEndpoints | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Use `/api-docs` | High — wrong endpoint catalog |
| `/closeout/post-mortem` | PostMortem | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Conflicts with UCI closeout prepare semantics | **High** |
| `/closeout/post-mortem/analytics` | PostMortemAnalytics | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Same | High |
| `/closeout/post-mortem/financial` | PostMortemFinancial | — | `exclude_due_to_confusion_or_duplication` | None | — | — | — | Same + fake financials | **High** |

**Inventory coverage:** 2 visible + 21 flag + 3 admin preview + 7 direct + 22 exclude = **55**.

## 13. Final implementation checklist

- [ ] Redesign **all current PermitPilot routes** listed in §2 (41 paths + NotFound), starting from PP routes not Lovable list  
- [ ] Use Lovable pages only as classified in §3 (full / partial / shared / flow / unsupported placeholders)  
- [ ] For the **55** unsupported Lovable pages (§3.5 / §12): apply the five-way classification; ship placeholders only with Coming soon / Preview / Not yet connected labels; never simulate success, credentials, or mock-as-real data  
- [ ] Do **not** register or nav-link `exclude_due_to_confusion_or_duplication` pages; keep PP `NotFound` for unknown public URLs  
- [ ] Shared tokens + ProductPrimitives **first** (Phase 1)  
- [ ] Shell second (Phase 2) with hybrid nav of **valid PP hrefs** (+ labeled `visible_placeholder` items only)  
- [ ] Low-risk pages before settings/scrape/UCI/filing/matrix  
- [ ] Complex workflows last; logic-first, visual around existing hooks  
- [ ] Protected business-logic files (§8) reviewed before edits; adapters (§9) for shape mismatch  
- [ ] Placeholders never simulate success or credentials  
- [ ] Workflows in §11 pass before merge  
- [ ] Branch + staging verification; dual-register risky routes if needed  
- [ ] Merge criteria for main: verification matrix green; no password leakage; scrape/UCI/filing/matrix/authz intact; client visual acceptance on in-scope surfaces; no unapproved BE migrations  

---

## Appendix A — Counts (for tracking)

| Metric | Count |
|--------|------:|
| Current PP routes in redesign plan | **42** (41 inventory paths + `*`) |
| Lovable full visual references | **14** |
| Lovable partial visual references | **17** |
| Lovable shared component references | **7** artifact groups (§3.3; not route counts) |
| Lovable flow-only page references | **2** (+ IA patterns) |
| Lovable unsupported (reclassified) | **55** |
| → `visible_placeholder` | **2** |
| → `hidden_feature_flag_placeholder` | **21** |
| → `admin_preview_placeholder` | **3** |
| → `direct_route_placeholder` | **7** |
| → `exclude_due_to_confusion_or_duplication` | **22** |
| Frontend adapters proposed | **16** |
| Protected business-logic components/modules | **20** (§8 rows) |
| Implementation phases | **8** (Phase 0–7) |
| Unresolved blockers | **PD-1…PD-14** product decisions (see gap analysis / replication plan); UCI stages 7–10 FE thinness; no server feature-flag for cutover |

## Appendix B — Source index

- `docs/lovable-ui-audit.md`, `lovable-page-architecture.md`, `lovable-component-architecture.md`, `lovable-design-system.md`, `lovable-ui-inventory.json`  
- `docs/current-system-architecture.md`, `current-page-architecture.md`, `current-component-architecture.md`, `current-data-model.md`, `current-workflow-diagrams.md`, `current-ui-inventory.json`  
- `docs/ui-replication-constraints.md`, `lovable-vs-current-gap-analysis.md`, `ui-route-component-mapping.json`, `ui-replication-plan.md`
