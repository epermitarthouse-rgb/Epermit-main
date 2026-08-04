# Lovable ↔ PermitPilot Architecture Matrix

> **Read this first.**
>
> - **Lovable is a client-facing visual reference only.** Its 90 routes are a UI prototype: 65 of them are
>   explicitly mock, 5 are placeholders, and only 8 touch a backend. Nothing in Lovable is a specification
>   for how PermitPilot should behave.
> - **PermitPilot is the real implementation.** Where the two disagree about data, routing, permissions or
>   workflow, PermitPilot wins. Several rows below deliberately diverge from Lovable because Lovable's
>   approach is worse (see L007, L090).
> - **This matrix is the source of truth** for what gets built, what gets folded into an existing surface,
>   and what must never be built. It supersedes the in-app architecture inventory page (see L089).
> - **No status change without updating this matrix.** If you implement, defer, re-scope or reject a row,
>   edit `scripts/generate-lovable-permitpilot-matrix.py` and regenerate both files in the same commit as
>   the code change. A row whose status is stale is worse than no row at all.
> - **Branch:** all work described here belongs on `feat/lovable-ui-replication`. Never on `main`.
>
> **Last audited:** 2026-07-25 · **Generated:** 2026-07-24 19:01 UTC

## Provenance

| Item | Value |
|---|---|
| Lovable inventory (input) | `reference/lovable-ui/architecture-inventory.md` (90 rows, columns Area…Notes) |
| Lovable original | `/Users/javerianaveed/epermit/loveable architecture /architecture-inventory.md` |
| PermitPilot routing audited | `src/App.tsx` |
| PermitPilot UCI vocabulary audited | `src/lib/uciNavSections.ts`, `src/components/layout/UciSidebarNav.tsx` |
| PermitPilot backend audited | `supabase/functions/*` (52 functions), `scraper-service/*`, `document-ingestion-worker/*` |
| Full 57-column data | `reference/lovable-ui/lovable-permitpilot-architecture-matrix.csv` |
| Generator | `scripts/generate-lovable-permitpilot-matrix.py` |
| Branch | `feat/lovable-ui-replication` |

### Column contract

The CSV carries all 57 columns. Columns 1–22 are the Lovable inventory columns, copied verbatim and
unmodified. Columns 23–57 are the PermitPilot decision columns added by this matrix.

| Range | Columns |
|---|---|
| 1–22 (Lovable, verbatim) | Area, Parent, Name, Route, Type, Params, Entry Points, Secondary Entries, Auth, Context, Purpose, Functionality, Actions, Tabs, Modals, Data Source, Backend, Status, Visibility, Source File, Route File, Notes |
| 23–57 (PermitPilot decisions) | Matrix Row ID, PP Equivalent Name, PP Route(s) Today, PP Route Exists, PP Source File(s), PP Nav Entry Point, PP Auth / Role Gate, PP Data Source, PP Backend Endpoint / Function, PP Backend Connected, PP Functional Status, Match Status, Match Confidence, UI Parity, Functional Parity, Route Decision, Target PP Route (Decided), Naming Decision (Label To Use), Nav Placement Decision, Deep Link Pattern, Lovable-Only Feature, Fake-Backend Risk, Preserve-PermitPilot-Logic Notes, Do-Not-Replicate Reason, Required Backend Work, Required Frontend Work, Blocking Dependencies, Priority, Risk, Effort, Phase, Acceptance Criteria, Test / Verification Hook, Owner Decision Needed, Audit Notes |

### Column alias map (task brief ↔ this matrix)

The audit brief asked for named PermitPilot columns 23–57. This matrix uses an equivalent decision schema with the same coverage. Use this map when reading either document:

| Brief column intent | Matrix / CSV column(s) |
|---|---|
| PermitPilot Match Status | Match Status (`Missing` ≡ `Missing in PermitPilot`) |
| Matching Feature Name | PP Equivalent Name |
| Current Route / Route Type | PP Route(s) Today; Deep Link Pattern; PP Route Exists |
| Entry / Secondary entry | PP Nav Entry Point; Nav Placement Decision |
| Auth / Role / Context | PP Auth / Role Gate; Blocking Dependencies |
| Purpose / Functionality / Actions / Tabs / Modals | PP Functional Status; Functional Parity; Required Frontend Work; per-row detail blocks |
| UI Status / Backend Status / Data Source | UI Parity; PP Backend Connected; PP Data Source; PP Backend Endpoint / Function |
| Source / Route def / API files | PP Source File(s); PP Backend Endpoint / Function |
| Existing Real Functionality to Preserve | Preserve-PermitPilot-Logic Notes |
| Lovable not in PP / PP not in Lovable | Lovable-Only Feature; PermitPilot-only surfaces section |
| Required UI / Functional work | Required Frontend Work; Required Backend Work |
| Route / Entry / Data decisions | Route Decision; Target PP Route; Nav Placement Decision; Naming Decision |
| Priority / Dependency / Risk | Priority; Blocking Dependencies; Risk; Fake-Backend Risk |
| Implementation unit / status / verification | Phase; Effort; Acceptance Criteria; Test / Verification Hook |
| Final notes | Audit Notes; Owner Decision Needed; Do-Not-Replicate Reason |

## Summary metrics

| Metric | Count |
|---|---:|
| Lovable rows mapped | 90 |
| Total columns per row | 57 |
| PermitPilot-only surfaces (no Lovable equivalent) | 25 |
| Rows with a PermitPilot route or section today | 46 |
| Rows with no PermitPilot surface at all | 44 |
| Rows where PermitPilot's backend is ahead of Lovable's | 8 |
| Rows carrying High fake-backend risk | 41 |
| Rows needing an owner decision | 34 |

### Match status distribution

| Match Status | Count | Meaning |
|---|---|---|
| Exact match | 0 | Reserved for byte-for-byte equivalence. Deliberately zero: nothing in Lovable is an exact match for a real implementation. |
| Strong functional match | 16 | Same surface, same job, PermitPilot already does it (usually for real, where Lovable is mock). |
| Partial match | 14 | PermitPilot covers some of the surface; specific capability gaps are named per row. |
| Same purpose different architecture | 8 | Both solve the same problem via different routing or systems. PermitPilot's shape is kept. |
| UI match only | 3 | The route exists in PermitPilot but renders a labelled placeholder with no backend. |
| Backend match only | 8 | PermitPilot has the real backend and Lovable has only the screen. The inverse of the usual gap. |
| Missing in PermitPilot | 41 | No PermitPilot equivalent. Most of these are explicitly not to be built. |

### Route decisions

| Route Decision | Count |
|---|---:|
| Do not build | 30 |
| Keep PP route | 19 |
| Defer | 19 |
| Fold into existing PP surface | 11 |
| Deep link (query param) | 8 |
| Alias to PP route | 2 |
| Add PP route | 1 |

### Priority, risk and phase

| Priority | Count | Definition |
|---|---:|---|
| P0 | 4 | Foundational. Real PermitPilot data behind it, highest visual payoff, no contract change. |
| P1 | 20 | High value. Real backing data; restyle after the P0 surfaces set the pattern. |
| P2 | 19 | Do after P0/P1, or blocked on a decision rather than on effort. |
| P3 | 47 | Backlog or explicitly out of scope. |

| Risk | Count |
|---|---:|
| Low | 28 |
| Medium | 34 |
| High | 28 |

| Phase | Rows |
|---|---:|
| Out of scope — deferred indefinitely | 23 |
| Backlog — revisit after visual alignment phases complete | 11 |
| Phase 3 — core authenticated surfaces | 10 |
| Phase 4 — delivery and intelligence surfaces | 10 |
| Backlog | 4 |
| Out of scope — coming-soon panel only | 4 |
| Phase 5 — admin and settings surfaces | 4 |
| Phase 1 — foundation / auth surfaces | 3 |
| Phase 2 — public / marketing shell | 3 |
| Phase 6 — structural follow-ups | 3 |
| Phase 7 — documentation and polish | 3 |
| Backlog — after a real /projects/:id detail route exists | 1 |
| Backlog — lowest tier | 1 |
| Backlog — pairs with L027 | 1 |
| Backlog — pairs with L033 | 1 |
| Backlog — requires legal sign-off before scoping | 1 |
| Blocked — placeholder styling only until L019 is approved | 1 |
| Blocked — placeholder styling only until audit writers exist | 1 |
| Blocked — placeholder styling only until the membership model is decided | 1 |
| Out of scope — Stripe is the billing system of record | 1 |
| Out of scope — explicit directive | 1 |
| Phase 0 — this document | 1 |
| Phase 3 — core authenticated surfaces (recommended first row) | 1 |

## All 90 Lovable rows — key decisions

Every Lovable row appears here. The remaining 45 columns for each row are in the CSV.

| ID | Area | Lovable Name | Lovable Route | Lovable Status | PP Equivalent | PP Route Today | Match Status | Route Decision | Target PP Route | Pri | Risk | Eff |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| L001 | Public | Home | `/` | Working | Home (marketing homepage inside app shell) | / | Strong functional match | Keep PP route | / | P1 | Low | S |
| L002 | Public | Login | `/login` | Working | Auth (unified sign-in / sign-up page) | /auth (with /login redirecting to it) | Same purpose different architecture | Alias to PP route | /auth (alias /login already in place) | P1 | Low | S |
| L003 | Public | Sign up | `/signup` | Working | Auth (sign-up view) | /signup → /auth with state.authView = "signup" | Same purpose different architecture | Alias to PP route | /auth (alias /signup already in place) | P1 | Low | S |
| L004 | Public | Contact | `/contact` | Working | Contact | /contact | Strong functional match | Keep PP route | /contact | P1 | Low | S |
| L005 | Command | Dashboard (layout) | `/dashboard` | Mock | Dashboard | /dashboard | Strong functional match | Keep PP route | /dashboard | P0 | Medium | M |
| L006 | Command | Dashboard · Operations | `/dashboard (index)` | Mock | Dashboard (single Operations view) | /dashboard | Partial match | Fold into existing PP surface | /dashboard | P1 | Low | S |
| L007 | Command | Dashboard · UCI | `/dashboard/uci` | Mock | UCI Hub | /uci | Same purpose different architecture | Fold into existing PP surface | /uci | P1 | Low | S |
| L008 | Command | Projects | `/projects` | Mock | Projects | /projects | Strong functional match | Keep PP route | /projects | P0 | Low | M |
| L009 | Command | New Project (Portal Credentials) | `/projects/new` | Placeholder | Portal credential capture (in the filing dialog, not a page) | Modal inside /projects and /permit-wizard-filing | Same purpose different architecture | Fold into existing PP surface | /projects (StartFilingDialog) | P2 | Medium | M |
| L010 | Command | Project Timeline | `/projects/:id/timeline` | Mock | Project deadlines and permit status (partial data only) | /dashboard, /projects (deadline surfaces) | Missing in PermitPilot | Defer | Undecided — would need /projects/:id/timeline | P2 | Medium | L |
| L011 | Command | Project Gantt | `/projects/:id/gantt` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Defer | Undecided | P3 | Medium | L |
| L012 | Command | Project Workspace (Alpha) | `/projects/alpha` | Mock | Project detail (not implemented; list-only today) | /projects (list only) | Missing in PermitPilot | Add PP route | /projects/:id (proposed, not yet built) | P2 | Medium | M |
| L013 | Command | Mission Control | `/mission-control` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | High | XL |
| L014 | Command | Command Center | `/command-center` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | Medium | L |
| L015 | Command | Permit Queue | `/permit-queue` | Mock | Permit Queue (placeholder) | /permit-queue | UI match only | Keep PP route | /permit-queue | P2 | Medium | M |
| L016 | Command | Critical Path | `/critical-path` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | High | XL |
| L017 | Command | Feasibility | `/feasibility` | Mock | Permit Intelligence (adjacent, not equivalent) | /permit-intelligence | Missing in PermitPilot | Defer | — (no route) | P3 | Medium | L |
| L018 | Command | Site Feasibility | `/feasibility/site` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Defer | — (no route) | P3 | Medium | L |
| L019 | Onboarding | Client Authorization (LOA) | `/onboarding/authorization` | Working | Admin authorizations (Preview placeholder only) | /admin/authorizations (placeholder) | Missing in PermitPilot | Defer | Undecided — would need /onboarding/authorization plus a real table | P2 | High | L |
| L020 | Delivery | Client Authorization (LOA) | `/delivery/authorization` | Working | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | Low | S |
| L021 | Delivery | Operations Board | `/operations` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Defer | — (no route) | P3 | High | XL |
| L022 | Delivery | Permit Filing (Guided Flow) | `/matrix/guided` | Mock | Permit Wizard Filing | /permit-wizard-filing | Strong functional match | Keep PP route | /permit-wizard-filing | P1 | High | M |
| L023 | Delivery | Response Matrix | `/matrix/response` | Mock | Response Matrix | /response-matrix | Strong functional match | Keep PP route | /response-matrix | P0 | Low | M |
| L024 | Delivery | Portal Harvest | `/portals/harvest` | Mock | Portal Data Viewer | /portal-data | Strong functional match | Keep PP route | /portal-data | P1 | Medium | M |
| L025 | Delivery | Master Matrix | `/matrix` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | Low | S |
| L026 | Delivery | Unified Matrix | `/matrix/unified` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | High | XL |
| L027 | Delivery | AI Workflow | `/matrix/ai-workflow` | Partial | Agent pipeline (backend only, no workflow UI) | — (no route) | Backend match only | Defer | Undecided — would need an agent run observability page | P2 | Medium | L |
| L028 | Delivery | Raze Permit | `/raze` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | High | XL |
| L029 | Intelligence | DesignCheck (Compliance) | `/compliance` | Mock | Code Compliance | /code-compliance | Partial match | Fold into existing PP surface | /code-compliance | P2 | Low | M |
| L030 | Intelligence | Compliance Intelligence | `/compliance/intelligence` | Mock | Code Compliance findings (unscored) | /code-compliance | Missing in PermitPilot | Defer | — (no route) | P3 | Medium | L |
| L031 | Intelligence | Code Analyzer | `/compliance/analyzer` | Partial | Code Compliance (drawing analyzer) | /code-compliance | Strong functional match | Fold into existing PP surface | /code-compliance | P1 | Medium | M |
| L032 | Intelligence | Internal Prescreen | `/compliance/prescreen` | Mock | Validation agents (backend only) | — (no route) | Backend match only | Defer | Undecided | P2 | Medium | M |
| L033 | Intelligence | Agent Center | `/agents` | Mock | Agent functions (backend only, no registry UI) | — (no route) | Backend match only | Defer | Undecided — pairs with L027 | P2 | Medium | L |
| L034 | Intelligence | Document Vault | `/documents` | Mock | Project documents (contextual, no vault page) | /uci?section=application-builder (Documents drawer tab); /portal-data | Backend match only | Defer | Undecided — a cross-project document view could be added later | P2 | Medium | M |
| L035 | Intelligence | Content Studio | `/content-studio` | Placeholder | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | Medium | L |
| L036 | Intelligence | Platform Architecture | `/architecture` | Working | MVP Documentation + API Documentation | /mvp-documentation; /api-docs | Partial match | Fold into existing PP surface | /mvp-documentation | P3 | Low | S |
| L037 | Utility Coordination | UCI Hub | `/uci` | Mock | UCI Hub (Utility Coordination) | /uci | Strong functional match | Keep PP route | /uci | P0 | Medium | M |
| L038 | Utility Coordination | UCI · Submissions | `/uci/submissions` | Mock | Submissions | /uci?section=submissions&tab=application-prep | Partial match | Deep link (query param) | /uci?section=submissions | P1 | Low | S |
| L039 | Utility Coordination | UCI · Inbox / Communications | `/uci/communications` | Mock | Communications / Inbox | /uci?section=communications&tab=communications | Partial match | Deep link (query param) | /uci?section=communications | P1 | Low | S |
| L040 | Utility Coordination | UCI · Class of Service | `/uci/class-of-service` | Mock | Class of Service | /uci?section=class-of-service&tab=cos | Partial match | Deep link (query param) | /uci?section=class-of-service | P1 | Low | S |
| L041 | Utility Coordination | UCI · CIAC & Refunds | `/uci/ciac` | Mock | CIAC & Refunds | /uci?section=ciac&tab=costs | Partial match | Deep link (query param) | /uci?section=ciac | P2 | Low | S |
| L042 | Utility Coordination | UCI · Energization | `/uci/energization` | Mock | Energization | /uci?section=energization&tab=costs | Partial match | Deep link (query param) | /uci?section=energization | P2 | Low | S |
| L043 | Utility Coordination | UCI · Miss Utility 811 | `/uci/miss-utility` | Mock | Miss Utility | /uci?section=miss-utility | Missing in PermitPilot | Do not build | /uci?section=miss-utility | P3 | High | L |
| L044 | Utility Coordination | UCI · Knowledge Graph | `/uci/knowledge-graph` | Mock | Knowledge Graph | /uci?section=knowledge-graph | Missing in PermitPilot | Do not build | /uci?section=knowledge-graph | P3 | High | XL |
| L045 | Utility Coordination | UCI Application Builder | `/uci/application-builder` | Placeholder | Application Builder | /uci?section=application-builder&tab=application-prep | Strong functional match | Deep link (query param) | /uci?section=application-builder | P1 | Medium | S |
| L046 | Utility Coordination | Jurisdiction Map | `/utility-map` | Mock | Jurisdiction Map | /jurisdictions/map | Strong functional match | Keep PP route | /jurisdictions/map | P1 | Medium | M |
| L047 | Utility Coordination | Provider Compare | `/utility/provider-map` | Partial | Jurisdiction Comparison | /jurisdictions/compare (alias /jurisdiction-comparison) | Partial match | Fold into existing PP surface | /jurisdictions/compare | P2 | Medium | M |
| L048 | Utility Coordination | Cross-Utility Conflict Hunter | `/utility/conflict-hunter` | Mock | Conflict Hunter | /uci?section=conflict-hunter | Missing in PermitPilot | Do not build | /uci?section=conflict-hunter | P3 | High | L |
| L049 | Utility Coordination | Easement / ROW Manager | `/utility/easements` | Mock | Easement / Right of Way | /uci?section=easement | Missing in PermitPilot | Do not build | /uci?section=easement | P3 | High | L |
| L050 | Utility Coordination | Load Profile Analyzer | `/utility/load-profile` | Partial | Load Profile | /uci?section=load-profile&tab=load-profile | Strong functional match | Deep link (query param) | /uci?section=load-profile | P1 | Low | S |
| L051 | Utility Coordination | Meter Set Choreographer | `/utility/meter-set` | Mock | Meter Set | /uci?section=meter-set&tab=costs | Partial match | Deep link (query param) | /uci?section=meter-set | P3 | Medium | M |
| L052 | Utility Coordination | Long-Lead Equipment | `/scheduling/long-lead` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | High | XL |
| L053 | Utility Coordination | Predictive Schedule Impact | `/scheduling/predictive-impact` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | High | XL |
| L054 | Utility Coordination | Inspector Release Tracker | `/inspections/release-tracker` | Mock | Inspection reminders (backend only) | — (no route) | Backend match only | Defer | — (no route) | P3 | Medium | L |
| L055 | Utility Coordination | Special Inspections | `/inspections/special` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | High | XL |
| L056 | Utility Coordination | Final CO Inspections | `/inspections/final-co` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | High | XL |
| L057 | Field | SIR | `/sir` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | High | XL |
| L058 | Field | SIR Workspace | `/sir/workspace` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | High | XL |
| L059 | Field | SIR Annex | `/sir/annex` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | High | XL |
| L060 | Field | SIR Executive | `/sir/executive` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | High | XL |
| L061 | Field | SIR Sync | `/sir/sync` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | High | XL |
| L062 | Field | Field Studio | `/field/studio` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | High | XL |
| L063 | Field | Mobile Survey | `/mobile/survey` | Mock | PWA / Capacitor mobile shell (no field surfaces) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | High | XL |
| L064 | Field | Mobile Camera | `/mobile/camera` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | High | XL |
| L065 | Field | Mobile Map | `/mobile/map` | Mock | Jurisdiction Map (responsive, serves mobile) | /jurisdictions/map | Missing in PermitPilot | Do not build | — (no route) | P3 | Low | S |
| L066 | Closeout | Closeout | `/closeout` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Defer | — (no route) | P3 | Medium | L |
| L067 | Closeout | Closeout Archive | `/closeout/archive` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Defer | — (no route) | P3 | Medium | L |
| L068 | Closeout | Closeout Tracker | `/closeout/tracker` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Defer | — (no route) | P3 | Medium | L |
| L069 | Closeout | Post-Mortem | `/closeout/post-mortem` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Defer | — (no route) | P3 | Medium | L |
| L070 | Closeout | Post-Mortem Analytics | `/closeout/post-mortem/analytics` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Defer | — (no route) | P3 | Medium | L |
| L071 | Closeout | Post-Mortem Financial | `/closeout/post-mortem/financial` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Defer | — (no route) | P3 | Medium | L |
| L072 | Resources | Checklists | `/checklists` | Mock | Checklist History | /checklists (alias /checklist-history) | Strong functional match | Keep PP route | /checklists | P1 | Low | M |
| L073 | Resources | Reference Library | `/reference` | Working | Code Reference Library | /code-reference | Partial match | Fold into existing PP surface | /code-reference | P2 | Low | S |
| L074 | Resources | Utility Coverage | `/reference/utility-coverage` | Working | Utility territory datasets (surfaced via the map) | /jurisdictions/map | Partial match | Fold into existing PP surface | /jurisdictions/map (coverage table as a panel) | P2 | Medium | M |
| L075 | Resources | Glossary | `/reference/glossary` | Working | Glossary (placeholder) | /reference/glossary | Partial match | Keep PP route | /reference/glossary | P3 | Low | S |
| L076 | Resources | Analytics & Reporting | `/portfolio/executive` | Mock | Analytics | /analytics | Strong functional match | Keep PP route | /analytics | P1 | Medium | M |
| L077 | Resources | Messages | `/messages` | Mock | Portal communications + transactional email (no message threads) | /uci?section=communications | Backend match only | Defer | Undecided | P3 | Medium | L |
| L078 | Settings | Settings | `/settings` | Placeholder | Settings | /settings | Strong functional match | Keep PP route | /settings | P1 | Low | M |
| L079 | Administration | Admin Console | `/admin` | Mock | Admin Panel | /admin | Strong functional match | Keep PP route | /admin | P1 | Low | M |
| L080 | Administration | Authorizations | `/admin/authorizations` | Working | Admin · Authorizations (Preview placeholder) | /admin/authorizations | UI match only | Keep PP route | /admin/authorizations | P2 | High | M |
| L081 | Administration | Members | `/admin/members` | Working | Admin · Members (Preview placeholder over real role data) | /admin/members | Backend match only | Keep PP route | /admin/members | P2 | High | M |
| L082 | Administration | Audit Log | `/admin/audit` | Working | Admin · Audit log (Preview placeholder) | /admin/audit | UI match only | Keep PP route | /admin/audit | P2 | High | M |
| L083 | Administration | Invoicing | `/admin/invoicing` | Mock | Stripe billing (different architecture) | Stripe-hosted checkout and customer portal (no in-app invoicing page) | Same purpose different architecture | Do not build | Stripe customer portal | P3 | Medium | M |
| L084 | Administration | Past Performance | `/admin/past-performance` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | High | XL |
| L085 | Administration | CRM | `/admin/crm` | Mock | Lead capture + drip campaigns (not a CRM) | Lead capture modal on marketing pages | Backend match only | Do not build | — (no route) | P3 | High | XL |
| L086 | Administration | Milestone Billing | `/admin/milestone-billing` | Mock | — (no PermitPilot equivalent) | — (none) | Missing in PermitPilot | Do not build | — (no route) | P3 | Medium | L |
| L087 | Administration | Endpoints | `/admin/endpoints` | Placeholder | API Documentation | /api-docs | Partial match | Fold into existing PP surface | /api-docs | P3 | Low | S |
| L088 | Demo | McDonald's Executive Demo | `/demo/mcdonalds` | Working | Demos | /demos | Same purpose different architecture | Fold into existing PP surface | /demos | P2 | Low | S |
| L089 | Internal | Architecture Inventory (this page) | `/architecture-inventory` | Working | This matrix (repo documentation) + /mvp-documentation | reference/lovable-ui/lovable-permitpilot-architecture-matrix.md; /mvp-documentation | Same purpose different architecture | Do not build | — (repo documentation) | P3 | Low | S |
| L090 | Internal | Unmatched → /dashboard | `*` | Working | NotFound (true 404) | * | Same purpose different architecture | Keep PP route | * → NotFound | P1 | Low | S |

## Per-row decisions in detail

Grouped by Lovable area. Each block carries the decision fields that a implementer needs before
touching code; the CSV holds the full 57-column record.

### Public

#### L001 · Home — `/`

- **Lovable:** Marketing / landing · status Working · backend UI only · source `src/pages/Home.tsx`
- **PermitPilot:** Home (marketing homepage inside app shell) · route(s) `/` · exists: Yes · status Working
- **PP files:** src/components/auth/HomeRoute.tsx; src/pages/Home.tsx; src/components/layout/DashboardLayout.tsx
- **PP backend:** None for render; lead capture writes via Supabase · connected: Partial
- **Match:** Strong functional match (confidence High) · UI parity: Partial — both render the homepage inside the authenticated shell; typography, hero and CTA styling differ · functional parity: Strong — same purpose, and PermitPilot adds a signed-in redirect Lovable does not have
- **Route decision:** Keep PP route → `/` · nav: Header Home link + logo click; keep out of the primary sidebar list · deep link: n/a
- **Label to use:** Keep "Home"
- **Fake-backend risk:** None — static marketing copy is legitimately static
- **Preserve:** Preserve HomeRoute's signed-in → /dashboard redirect and the LeadCapture modal wiring. Lovable renders Home unconditionally; do not copy that.
- **Do not replicate:** Do not copy Lovable's fabricated metrics or logos into PermitPilot marketing copy.
- **Backend work:** None.
- **Frontend work:** Align hero, section spacing, card and CTA styling with the Lovable homepage using existing PermitPilot components.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P1 · Low · S · Phase 2 — public / marketing shell
- **Acceptance:** Anonymous visit to / renders the restyled homepage inside DashboardLayout; a signed-in visit still redirects to /dashboard; lead capture modal still fires.
- **Verify with:** Manual smoke of / signed-out and signed-in; npm run build
- **Owner decision needed:** No
- **Audit note:** Confirmed in src/App.tsx line 80 and HomeRoute.tsx.

#### L002 · Login — `/login`

- **Lovable:** Sign in · status Working · backend Fully connected · source `src/pages/Login.tsx`
- **PermitPilot:** Auth (unified sign-in / sign-up page) · route(s) `/auth (with /login redirecting to it)` · exists: Yes · status Working
- **PP files:** src/pages/Auth.tsx; src/App.tsx (redirect at /login)
- **PP backend:** Supabase auth; send-welcome-email · connected: Yes
- **Match:** Same purpose different architecture (confidence High) · UI parity: Partial — Lovable uses a dedicated Login page, PermitPilot uses one Auth page with a view switch · functional parity: Strong — email/password sign-in with rejected/pending handling on both sides
- **Route decision:** Alias to PP route → `/auth (alias /login already in place)` · nav: Not a sidebar entry; reached via redirect and the header sign-in CTA · deep link: /login → /auth (Navigate replace, already implemented)
- **Label to use:** Use "Sign in" for the nav/CTA label; keep the route at /auth
- **Fake-backend risk:** None
- **Preserve:** Preserve the whole Supabase auth path: session handling, rejected-member messaging, invite acceptance and the /signup view state. Never restyle by rebuilding the form.
- **Do not replicate:** Do not split /auth into separate /login and /signup pages just because Lovable does.
- **Backend work:** None.
- **Frontend work:** Apply Lovable card, spacing and input styling to the existing Auth form.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P1 · Low · S · Phase 1 — foundation / auth surfaces
- **Acceptance:** Sign-in, sign-up and rejected-member paths all still work; /login still redirects to /auth; no auth logic changed.
- **Verify with:** Manual sign-in with a demo account on the Vercel Preview build
- **Owner decision needed:** No
- **Audit note:** src/App.tsx lines 81-83. /login is a Navigate redirect, not a page.

#### L003 · Sign up — `/signup`

- **Lovable:** Register / request access · status Working · backend Fully connected · source `src/pages/Signup.tsx`
- **PermitPilot:** Auth (sign-up view) · route(s) `/signup → /auth with state.authView = "signup"` · exists: Yes · status Working
- **PP files:** src/pages/Auth.tsx; src/App.tsx (redirect at /signup)
- **PP backend:** Supabase auth; send-welcome-email · connected: Yes
- **Match:** Same purpose different architecture (confidence High) · UI parity: Partial — same fields, different container (view state vs standalone page) · functional parity: Strong — both create a pending auth user awaiting admin approval
- **Route decision:** Alias to PP route → `/auth (alias /signup already in place)` · nav: Reached from the Auth page toggle only · deep link: /signup → /auth with authView=signup (already implemented)
- **Label to use:** Use "Create account"; keep the route at /auth
- **Fake-backend risk:** None
- **Preserve:** Preserve pending-approval semantics and the state-based view switch; do not introduce a second auth component.
- **Do not replicate:** Do not create a standalone Signup page.
- **Backend work:** None.
- **Frontend work:** Style the sign-up view to match Lovable's registration card.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P1 · Low · S · Phase 1 — foundation / auth surfaces
- **Acceptance:** /signup lands on the Auth page already showing the sign-up view; account creation still produces a pending user.
- **Verify with:** Manual sign-up with a throwaway demo address on Preview
- **Owner decision needed:** No
- **Audit note:** src/App.tsx line 83 passes state={{ authView: "signup" }}.

#### L004 · Contact — `/contact`

- **Lovable:** Inbound contact · status Working · backend Fully connected · source `src/pages/Contact.tsx`
- **PermitPilot:** Contact · route(s) `/contact` · exists: Yes · status Working
- **PP files:** src/pages/Contact.tsx; src/components/layout/MarketingLayout.tsx
- **PP backend:** send-contact-email edge function · connected: Yes
- **Match:** Strong functional match (confidence High) · UI parity: Partial — same form intent; PermitPilot wraps it in MarketingLayout, Lovable in PermitPilotShell · functional parity: Strong — both write a submission row and trigger a notification email
- **Route decision:** Keep PP route → `/contact` · nav: Marketing header/footer, matching the other public pages · deep link: n/a
- **Label to use:** Keep "Contact"
- **Fake-backend risk:** None
- **Preserve:** Preserve the contact_submissions insert and the send-contact-email invocation exactly.
- **Do not replicate:** —
- **Backend work:** None.
- **Frontend work:** Align form field, label and button styling with Lovable's contact card.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P1 · Low · S · Phase 2 — public / marketing shell
- **Acceptance:** Submitting the restyled form still creates a contact_submissions row and sends the notification email.
- **Verify with:** Manual submit on Preview, then verify the row in Supabase
- **Owner decision needed:** No
- **Audit note:** src/App.tsx lines 100-107; supabase/functions/send-contact-email.

### Command

#### L005 · Dashboard (layout) — `/dashboard`

- **Lovable:** Portfolio overview shell · status Mock · backend Mock · source `src/pages/Dashboard.tsx`
- **PermitPilot:** Dashboard · route(s) `/dashboard` · exists: Yes · status Working
- **PP files:** src/pages/Dashboard.tsx; src/components/auth/ProtectedRoute.tsx; src/components/layout/DashboardLayout.tsx
- **PP backend:** Supabase queries; fetch-permit-data; permit-status-monitor · connected: Yes
- **Match:** Strong functional match (confidence High) · UI parity: Partial — Lovable adds a KPI band, alert strip and portfolio table styling PermitPilot does not have · functional parity: Strong, and PermitPilot is ahead: Lovable's dashboard is entirely fabricated demo data
- **Route decision:** Keep PP route → `/dashboard` · nav: First sidebar entry, as today · deep link: n/a — PermitPilot has no /dashboard/* children
- **Label to use:** Keep "Dashboard"
- **Fake-backend risk:** High — the Lovable KPI values are invented; every restyled tile must bind to a real PermitPilot query or be omitted
- **Preserve:** Preserve all existing Supabase queries, the active-project context and ProtectedLayoutRoute gating. Restyle containers only.
- **Do not replicate:** Do not import Lovable's mock dashboard dataset, and do not add nested /dashboard child routes.
- **Backend work:** None. Any tile without a real query must be dropped rather than faked.
- **Frontend work:** Adopt Lovable's KPI card band, alert strip and portfolio table styling on top of the existing data hooks.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P0 · Medium · M · Phase 3 — core authenticated surfaces
- **Acceptance:** /dashboard shows the Lovable-style layout, every number traces to a real query, and no tile renders placeholder values.
- **Verify with:** Manual smoke with a demo account that has projects; npm run build; npx tsc --noEmit
- **Owner decision needed:** No
- **Audit note:** src/App.tsx line 122. PermitPilot has no dashboard tab shell.

#### L006 · Dashboard · Operations — `/dashboard (index)`

- **Lovable:** KPI + portfolio table · status Mock · backend Mock · source `src/pages/Dashboard.tsx (DashboardOverview)`
- **PermitPilot:** Dashboard (single Operations view) · route(s) `/dashboard` · exists: Partial — same page, no index/child split · status Working
- **PP files:** src/pages/Dashboard.tsx
- **PP backend:** Supabase queries · connected: Yes
- **Match:** Partial match (confidence High) · UI parity: Partial — the KPI-plus-portfolio-table content exists, but not as a tab under a layout route · functional parity: Strong on content; PermitPilot renders it directly instead of through an index route
- **Route decision:** Fold into existing PP surface → `/dashboard` · nav: No separate nav entry · deep link: n/a
- **Label to use:** Do not surface "Operations" as a separate label; it is simply the dashboard
- **Fake-backend risk:** High — Lovable explicitly marks this data fabricated
- **Preserve:** Preserve the single-page structure. Introducing a layout route plus index child adds routing surface for no functional gain.
- **Do not replicate:** Do not create a /dashboard index child route or a Dashboard tab bar.
- **Backend work:** None.
- **Frontend work:** Merge the Lovable operations layout into the existing single Dashboard page (same work as L005).
- **Blocked by:** Depends on L005.
- **Priority / risk / effort / phase:** P1 · Low · S · Phase 3 — core authenticated surfaces
- **Acceptance:** Operations content is visible on /dashboard with no tab shell and no new routes added.
- **Verify with:** Route count check: src/App.tsx still declares exactly one /dashboard route
- **Owner decision needed:** No
- **Audit note:** Lovable splits this into a nested index route; PermitPilot deliberately does not.

#### L007 · Dashboard · UCI — `/dashboard/uci`

- **Lovable:** UCI overview inside dashboard · status Mock · backend Mock · source `src/pages/UciDashboard.tsx`
- **PermitPilot:** UCI Hub · route(s) `/uci` · exists: Partial — the surface exists at /uci, not under /dashboard · status Working
- **PP files:** src/pages/UciDashboard.tsx; src/App.tsx lines 166-175
- **PP backend:** scraper-service /api/uci · connected: Yes
- **Match:** Same purpose different architecture (confidence High) · UI parity: Partial — PermitPilot's hub is richer, but it is not embedded as a dashboard tab · functional parity: PermitPilot is ahead — Lovable's UCI tab is static mock content
- **Route decision:** Fold into existing PP surface → `/uci` · nav: Its own expandable sidebar group, not a dashboard tab · deep link: /uci?section=overview
- **Label to use:** Use "Utility Coordination" in the sidebar
- **Fake-backend risk:** Medium — a dashboard-embedded copy would duplicate the hub and drift from it
- **Preserve:** Preserve the single canonical /uci entry point and its ErrorBoundary wrapper.
- **Do not replicate:** Do not create /dashboard/uci. Lovable's own inventory notes that its /dashboard/uci copy bypasses RequireUciAccess — replicating it would reintroduce a role-gate bypass.
- **Backend work:** None.
- **Frontend work:** If a dashboard UCI summary is wanted, add a read-only card on /dashboard that links to /uci rather than a second mount of the hub.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P1 · Low · S · Phase 3 — core authenticated surfaces
- **Acceptance:** UCI remains reachable only at /uci; no /dashboard/uci route exists; any dashboard UCI card is a link, not a second mount.
- **Verify with:** Grep src/App.tsx for "dashboard/uci" — must return no matches
- **Owner decision needed:** No
- **Audit note:** Deliberate divergence: Lovable's alias is a documented security smell.

#### L008 · Projects — `/projects`

- **Lovable:** Project list · status Mock · backend Mock · source `src/pages/Projects.tsx`
- **PermitPilot:** Projects · route(s) `/projects` · exists: Yes · status Working
- **PP files:** src/pages/Projects.tsx
- **PP backend:** Supabase queries; send-project-team-invitation · connected: Yes
- **Match:** Strong functional match (confidence High) · UI parity: Partial — Lovable's project cards and filter chrome are more refined · functional parity: PermitPilot is ahead — Lovable browses mock cards; PermitPilot does real CRUD with RLS
- **Route decision:** Keep PP route → `/projects` · nav: Second sidebar entry, as today · deep link: n/a
- **Label to use:** Keep "Projects"
- **Fake-backend risk:** Medium — do not add card fields that PermitPilot's projects table cannot populate
- **Preserve:** Preserve project CRUD, RLS scoping, team invitations and the active-project selector.
- **Do not replicate:** Do not replace the real project list with Lovable's static cards.
- **Backend work:** None.
- **Frontend work:** Adopt Lovable's card grid, status pills and filter bar on top of the existing project query.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P0 · Low · M · Phase 3 — core authenticated surfaces
- **Acceptance:** Project list, create, invite and select flows all behave as before with the new card styling; every card field maps to a real column.
- **Verify with:** Manual CRUD smoke with a demo account; npx tsc --noEmit
- **Owner decision needed:** No
- **Audit note:** src/App.tsx line 123.

#### L009 · New Project (Portal Credentials) — `/projects/new`

- **Lovable:** Onboard project + portal creds · status Placeholder · backend UI only · source `src/pages/ProjectSetupCredentials.tsx`
- **PermitPilot:** Portal credential capture (in the filing dialog, not a page) · route(s) `Modal inside /projects and /permit-wizard-filing` · exists: Partial — capability exists, no dedicated route · status Working
- **PP files:** src/components/permit-wizard/StartFilingDialog.tsx; scraper-service/app/routes/portal-credentials.routes.js
- **PP backend:** scraper-service portal-credentials routes; check-portal-status · connected: Yes
- **Match:** Same purpose different architecture (confidence High) · UI parity: Partial — Lovable uses a full onboarding page, PermitPilot uses a dialog in the filing flow · functional parity: PermitPilot is ahead — Lovable's page is a UI-only placeholder; PermitPilot stores encrypted credentials and validates them
- **Route decision:** Fold into existing PP surface → `/projects (StartFilingDialog)` · nav: No nav entry; contextual to a project · deep link: n/a
- **Label to use:** Use "Portal credentials" as the dialog title
- **Fake-backend risk:** High — a standalone credential page that does not actually encrypt and validate would be a security-relevant fake
- **Preserve:** Preserve encrypted storage, tenant scoping and credential validation via check-portal-status. Credentials must never be handled by new UI code paths.
- **Do not replicate:** Do not build a /projects/new credential page; Lovable's version stores nothing.
- **Backend work:** None.
- **Frontend work:** Restyle the existing dialog using Lovable's form styling.
- **Blocked by:** Security review required for any change that touches credential input.
- **Priority / risk / effort / phase:** P2 · Medium · M · Phase 5 — admin and settings surfaces
- **Acceptance:** Credential capture still round-trips through the existing encrypted path; no new route and no new credential handling code.
- **Verify with:** node --test scraper-service/tests (portal credential coverage); manual filing dialog smoke
- **Owner decision needed:** No
- **Audit note:** portal_credentials confirmed in supabase/migrations/20260210000000_portal_credentials.sql.

#### L010 · Project Timeline — `/projects/:id/timeline`

- **Lovable:** Milestone timeline · status Mock · backend Mock · source `src/pages/ProjectTimeline.tsx`
- **PermitPilot:** Project deadlines and permit status (partial data only) · route(s) `/dashboard, /projects (deadline surfaces)` · exists: No — no timeline route · status Adjacent data exists, no timeline surface
- **PP files:** src/pages/Dashboard.tsx (deadline widgets)
- **PP backend:** permit-status-monitor; send-deadline-reminders · connected: Partial
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no timeline UI · functional parity: Weak — deadline data exists but there is no milestone schema
- **Route decision:** Defer → `Undecided — would need /projects/:id/timeline` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** Medium — plausible future surface, but building it now would require mock data
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** PermitPilot tracks deadlines and permit status but has no milestone timeline model, so a timeline page would render invented milestones.
- **Backend work:** Define a project milestone schema and derive milestones from real permit and deadline events.
- **Frontend work:** None until a milestone model exists.
- **Blocked by:** Depends on L012 (a real project detail route) and on a milestone data model.
- **Priority / risk / effort / phase:** P2 · Medium · L · Backlog — after a real /projects/:id detail route exists
- **Acceptance:** Not scoped. Requires a milestone schema, an owner and an update to this row first.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — needs a product decision on whether PermitPilot should own this domain
- **Audit note:** Lovable's timeline is mock; PermitPilot's deadline data is real but insufficient to populate it.

#### L011 · Project Gantt — `/projects/:id/gantt`

- **Lovable:** Gantt chart view · status Mock · backend Mock · source `src/pages/ProjectGantt.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Defer → `Undecided` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** Medium — plausible future surface, but building it now would require mock data
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** A Gantt chart needs task dependencies and durations that PermitPilot does not model at all.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** Depends on L010 (milestone model) plus a dependency/duration model.
- **Priority / risk / effort / phase:** P3 · Medium · L · Backlog — lowest tier
- **Acceptance:** No acceptance criteria yet. Promote to a real phase only after a backend design exists and this matrix row is updated.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — needs a product decision on whether PermitPilot should own this domain
- **Audit note:** No PermitPilot scheduling domain exists.

#### L012 · Project Workspace (Alpha) — `/projects/alpha`

- **Lovable:** Single project workspace demo · status Mock · backend Mock · source `src/pages/ProjectWorkspace.tsx`
- **PermitPilot:** Project detail (not implemented; list-only today) · route(s) `/projects (list only)` · exists: No · status List exists, detail route missing
- **PP files:** src/pages/Projects.tsx
- **PP backend:** None · connected: Yes (for the list)
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no detail page · functional parity: Weak — real project rows exist but there is no detail view over them
- **Route decision:** Add PP route → `/projects/:id (proposed, not yet built)` · nav: Reached from the project list, never from the sidebar · deep link: n/a
- **Label to use:** Use "Project workspace" if built
- **Fake-backend risk:** Medium — must be built over the real projects table, not a hard-coded id
- **Preserve:** Any detail route must read the real project by id under RLS.
- **Do not replicate:** PermitPilot has no per-project detail route yet; Lovable's version is hard-coded to a fake 'alpha' project, which must not be copied.
- **Backend work:** None — the projects table already supports a detail read.
- **Frontend work:** Build a real /projects/:id detail page bound to the existing project query, replacing the list-only pattern.
- **Blocked by:** Should follow the Phase 3 Projects restyle so the detail page inherits final styling.
- **Priority / risk / effort / phase:** P2 · Medium · M · Phase 6 — structural follow-ups
- **Acceptance:** /projects/:id loads a real project under RLS; no hard-coded project id exists anywhere in the codebase.
- **Verify with:** Manual navigation from the project list to detail with a demo account
- **Owner decision needed:** No
- **Audit note:** Lovable's own inventory flags the /projects/alpha hard-coding as a structural gap.

#### L013 · Mission Control — `/mission-control`

- **Lovable:** Master ops dashboard · status Mock · backend Mock · source `src/pages/MissionControl.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — this is the single most convincing fake surface in the Lovable app; it would look authoritative while showing nothing real
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build. Directive: 'Do NOT replicate as fake backends: Mission Control page'. The real rollup path is the /dashboard and /uci hubs over live project data.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Also surfaced as UCI section "portfolio" (see L043-style coming-soon handling) with note 'firm-wide quarterly Mission Control is not connected yet'.

#### L014 · Command Center — `/command-center`

- **Lovable:** Executive command dashboard · status Mock · backend Mock · source `src/pages/CommandCenter.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build. Fold any executive framing into /dashboard (L005) instead.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · Medium · L · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Lovable's Command Center exists only to link to /projects/alpha.

#### L015 · Permit Queue — `/permit-queue`

- **Lovable:** Filing queue · status Mock · backend Mock · source `src/pages/PermitQueue.tsx`
- **PermitPilot:** Permit Queue (placeholder) · route(s) `/permit-queue` · exists: Yes — placeholder page · status Placeholder (labelled)
- **PP files:** src/pages/placeholders/PermitQueuePlaceholder.tsx
- **PP backend:** None yet; permit_applications and permit-status-monitor are the eventual source · connected: None
- **Match:** UI match only (confidence High) · UI parity: Weak — PermitPilot renders an honest placeholder, Lovable renders a mock queue · functional parity: None on both sides — Lovable's queue is fabricated
- **Route decision:** Keep PP route → `/permit-queue` · nav: Command group in the sidebar, as today · deep link: n/a
- **Label to use:** Keep "Permit Queue"
- **Fake-backend risk:** High — the obvious temptation is to fill the placeholder with Lovable's mock rows
- **Preserve:** Preserve the placeholder's explicit 'not connected' labelling until a real query exists.
- **Do not replicate:** Do not replicate Lovable's hard-coded sidebar badge of 18; a badge must count real rows or not exist.
- **Backend work:** Build a cross-project filing queue query over permit_applications with real status and owner fields.
- **Frontend work:** Once the query exists, adopt Lovable's queue table styling. Until then, restyle the placeholder only.
- **Blocked by:** Needs an agreed queue definition (which statuses belong in the queue).
- **Priority / risk / effort / phase:** P2 · Medium · M · Phase 6 — structural follow-ups
- **Acceptance:** Either the page shows real permit rows, or it remains an explicitly labelled placeholder. No fabricated badge count.
- **Verify with:** Grep for hard-coded badge counts in the sidebar; manual visit to /permit-queue
- **Owner decision needed:** Yes — queue scope needs a product definition
- **Audit note:** src/App.tsx line 163 uses PermitQueuePlaceholder.

#### L016 · Critical Path — `/critical-path`

- **Lovable:** Critical-path analysis · status Mock · backend Mock · source `src/pages/CriticalPath.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build. Depends on the same scheduling domain as L010/L011, which does not exist.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Lovable page is mock.

#### L017 · Feasibility — `/feasibility`

- **Lovable:** Phase-0 feasibility · status Mock · backend Mock · source `src/pages/Feasibility.tsx`
- **PermitPilot:** Permit Intelligence (adjacent, not equivalent) · route(s) `/permit-intelligence` · exists: No · status Adjacent surface exists
- **PP files:** src/pages/PermitIntelligence.tsx
- **PP backend:** shovels-api; property-intelligence-agent · connected: Yes (for permit intelligence, not feasibility)
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: Weak — real property/permit intelligence exists but no feasibility scoring
- **Route decision:** Defer → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** Medium — plausible future surface, but building it now would require mock data
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Phase-0 feasibility is a genuine product idea but has no PermitPilot data model; PermitPilot's closest real capability is /permit-intelligence.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** Needs a feasibility scoring model and an owner.
- **Priority / risk / effort / phase:** P3 · Medium · L · Backlog — revisit after visual alignment phases complete
- **Acceptance:** No acceptance criteria yet. Promote to a real phase only after a backend design exists and this matrix row is updated.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — needs a product decision on whether PermitPilot should own this domain
- **Audit note:** Consider whether /permit-intelligence already satisfies the client's feasibility intent before building anything new.

#### L018 · Site Feasibility — `/feasibility/site`

- **Lovable:** Site analysis · status Mock · backend Mock · source `src/pages/SiteFeasibility.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Defer → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** Medium — plausible future surface, but building it now would require mock data
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Interactive site scoring requires a scoring model PermitPilot does not have; Lovable's scores are invented.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** Depends on L017.
- **Priority / risk / effort / phase:** P3 · Medium · L · Backlog — revisit after visual alignment phases complete
- **Acceptance:** No acceptance criteria yet. Promote to a real phase only after a backend design exists and this matrix row is updated.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — needs a product decision on whether PermitPilot should own this domain
- **Audit note:** Lovable page is mock.

### Onboarding

#### L019 · Client Authorization (LOA) — `/onboarding/authorization`

- **Lovable:** Sign LOA · status Working · backend Fully connected · source `src/pages/OnboardingAuthorization.tsx`
- **PermitPilot:** Admin authorizations (Preview placeholder only) · route(s) `/admin/authorizations (placeholder)` · exists: No — no client signing route · status Placeholder (labelled Preview only, PD-5)
- **PP files:** src/pages/placeholders/AdminPreviewPlaceholders.tsx
- **PP backend:** None. PermitPilot has document storage and PDF paths but no client_authorizations table. · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no signing UI · functional parity: None — no authorization records
- **Route decision:** Defer → `Undecided — would need /onboarding/authorization plus a real table` · nav: Onboarding group, client role only · deep link: n/a
- **Label to use:** If built, use "Client Authorization (LOA)"
- **Fake-backend risk:** High — a signature UI that does not produce a stored, retrievable legal artifact is the worst possible fake
- **Preserve:** Preserve the existing placeholder's explicit 'Preview only' labelling so no one treats it as live.
- **Do not replicate:** PermitPilot has no client-facing LOA signing route. /admin/authorizations is a Preview placeholder only, so there is no live authorization pipeline to attach a signing page to.
- **Backend work:** client_authorizations table, RLS, signature-to-PDF generation, storage bucket and retention policy.
- **Frontend work:** None until the backend and legal review exist.
- **Blocked by:** Legal review of e-signature handling; a records-retention decision; a client_authorizations schema.
- **Priority / risk / effort / phase:** P2 · High · L · Backlog — requires legal sign-off before scoping
- **Acceptance:** Not scoped. Requires legal approval, a schema and an update to this row.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — legal and product sign-off required for e-signature capture
- **Audit note:** Directive confirmed: admin LOA/members/audit are Preview placeholders in PermitPilot and must not be presented as connected.

### Delivery

#### L020 · Client Authorization (LOA) — `/delivery/authorization`

- **Lovable:** Alias of onboarding LOA · status Working · backend Fully connected · source `src/pages/OnboardingAuthorization.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — duplicate routes over legal artifacts invite divergent behavior
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build. One canonical LOA route only, if and when L019 is approved.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · Low · S · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Lovable notes: 'Duplicate route alias — inconsistency risk.'

#### L021 · Operations Board — `/operations`

- **Lovable:** Monday-style board · status Mock · backend Mock · source `src/pages/OperationsBoard.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Defer → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** Medium — plausible future surface, but building it now would require mock data
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** A Monday-style task board needs a task/group/assignment domain PermitPilot does not have. Reimbursables and scope-pricing tabs imply a financial model that also does not exist.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** Needs a task domain, an assignment model and a pricing model.
- **Priority / risk / effort / phase:** P3 · High · XL · Backlog — revisit after visual alignment phases complete
- **Acceptance:** No acceptance criteria yet. Promote to a real phase only after a backend design exists and this matrix row is updated.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — needs a product decision on whether PermitPilot should own this domain
- **Audit note:** Lovable page is mock across all three tabs.

#### L022 · Permit Filing (Guided Flow) — `/matrix/guided`

- **Lovable:** Guided filing wizard · status Mock · backend Mock · source `src/pages/GuidedFlow.tsx`
- **PermitPilot:** Permit Wizard Filing · route(s) `/permit-wizard-filing` · exists: Yes · status Working
- **PP files:** src/pages/PermitWizardFiling.tsx; src/components/permit-wizard/StartFilingDialog.tsx
- **PP backend:** permitwizard-preflight; permitwizard-execute; epermit-submit; document-preparation-agent · connected: Yes
- **Match:** Strong functional match (confidence High) · UI parity: Partial — Lovable's stepper chrome is cleaner; the underlying steps differ because PermitPilot's are real · functional parity: PermitPilot is far ahead — Lovable steps through a mock packet; PermitPilot runs preflight and executes real portal submissions
- **Route decision:** Keep PP route → `/permit-wizard-filing` · nav: Delivery group in the sidebar · deep link: n/a
- **Label to use:** Use Lovable's "Permit Filing" label in the sidebar, pointing at /permit-wizard-filing
- **Fake-backend risk:** High — this surface performs real submissions; a cosmetic rebuild that bypasses preflight could file incorrectly
- **Preserve:** Preserve the permitwizard-preflight → permitwizard-execute contract, credential handling, document mapping and every confirmation gate. Do not reorder or remove steps.
- **Do not replicate:** Do not replace real steps with Lovable's mock packet steps, and never submit without preflight.
- **Backend work:** None.
- **Frontend work:** Restyle the stepper, step headers and review panel using Lovable's visual language while leaving step logic untouched.
- **Blocked by:** No live utility submissions during testing without explicit approval (shared Supabase on Railway development).
- **Priority / risk / effort / phase:** P1 · High · M · Phase 4 — delivery and intelligence surfaces
- **Acceptance:** Preflight still runs before execute; every existing confirmation gate remains; step order unchanged; no live submission triggered during verification.
- **Verify with:** npx vitest run (permit wizard coverage); dry-run preflight only, no execute
- **Owner decision needed:** Yes — approval required before any live submission test
- **Audit note:** Mapping confirmed: Lovable /matrix/guided ↔ PermitPilot /permit-wizard-filing.

#### L023 · Response Matrix — `/matrix/response`

- **Lovable:** Comment reconciliation · status Mock · backend Mock · source `src/pages/ResponseMatrix.tsx`
- **PermitPilot:** Response Matrix · route(s) `/response-matrix` · exists: Yes · status Working
- **PP files:** src/pages/ResponseMatrix.tsx; src/pages/CommentReview.tsx; src/pages/ClassifiedComments.tsx
- **PP backend:** parse-permit-comments; comment-parser-agent; discipline-classifier-agent; generate-response; generate-grounded-response; export-response-package · connected: Yes
- **Match:** Strong functional match (confidence High) · UI parity: Partial — Lovable's matrix grid, row density and status chips are the target styling · functional parity: PermitPilot is far ahead — Lovable drafts against mock comments; PermitPilot parses real comment letters and generates grounded responses
- **Route decision:** Keep PP route → `/response-matrix` · nav: Delivery group in the sidebar · deep link: n/a
- **Label to use:** Keep "Response Matrix"
- **Fake-backend risk:** Medium — grid columns must map to real parsed_comments fields, not Lovable's invented ones
- **Preserve:** Preserve comment parsing, discipline classification, grounded response generation, citation references and the export package path. Response text generation must keep going through the existing edge functions.
- **Do not replicate:** Do not add matrix columns that parsed_comments cannot populate.
- **Backend work:** None.
- **Frontend work:** Adopt Lovable's matrix table shell, row grouping and status chips over the existing data hooks. This is the recommended first implementation row: highest visual payoff, real backing data, and no route or contract change.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P0 · Low · M · Phase 3 — core authenticated surfaces (recommended first row)
- **Acceptance:** Restyled matrix renders real parsed comments; response generation and export still work; no column shows placeholder data.
- **Verify with:** npx vitest run; manual comment-to-response round trip on a demo project
- **Owner decision needed:** No
- **Audit note:** Recommended starting point per the audit directive. Not implemented in this documentation pass.

#### L024 · Portal Harvest — `/portals/harvest`

- **Lovable:** Portal scraping status · status Mock · backend Mock · source `src/pages/PortalHarvest.tsx`
- **PermitPilot:** Portal Data Viewer · route(s) `/portal-data` · exists: Yes · status Working
- **PP files:** src/pages/PortalDataViewer.tsx; scraper-service/app/routes/*
- **PP backend:** scraper-service HTTP API; check-portal-status; fetch-permit-data; permit-status-monitor · connected: Yes
- **Match:** Strong functional match (confidence High) · UI parity: Partial — Lovable's harvest-run list styling is the target · functional parity: PermitPilot is far ahead — Lovable shows mock harvest runs; PermitPilot shows real scraper results
- **Route decision:** Keep PP route → `/portal-data` · nav: Delivery group in the sidebar · deep link: n/a
- **Label to use:** Use "Portal Harvest" as the nav label if the client expects it, pointing at /portal-data
- **Fake-backend risk:** Medium — run status must reflect real scraper state, never an optimistic mock
- **Preserve:** Preserve the scraper API contract, credential handling and portal status polling. Do not change scraper behavior for styling reasons.
- **Do not replicate:** Do not fabricate harvest-run history.
- **Backend work:** None.
- **Frontend work:** Adopt Lovable's run list, status badge and detail panel styling.
- **Blocked by:** Scraper changes would need a Railway development deploy; styling alone does not.
- **Priority / risk / effort / phase:** P1 · Medium · M · Phase 4 — delivery and intelligence surfaces
- **Acceptance:** Restyled viewer shows real scraper runs and statuses; no scraper contract change; no fabricated runs.
- **Verify with:** node --test scraper-service/tests; manual /portal-data smoke
- **Owner decision needed:** No
- **Audit note:** Mapping confirmed: Lovable /portals/harvest ↔ PermitPilot /portal-data.

#### L025 · Master Matrix — `/matrix`

- **Lovable:** Umbrella matrix · status Mock · backend Mock · source `src/pages/MasterMatrix.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** Medium — an umbrella page invites tiles for surfaces that do not exist
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build. /response-matrix and /permit-wizard-filing are already first-class sidebar entries.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · Low · S · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** PermitPilot deliberately has no /matrix namespace.

#### L026 · Unified Matrix — `/matrix/unified`

- **Lovable:** Unified task matrix · status Mock · backend Mock · source `src/pages/UnifiedMatrix.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build. Blocked on the task domain that L021 also requires.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Lovable page is mock.

#### L027 · AI Workflow — `/matrix/ai-workflow`

- **Lovable:** AI-orchestrated workflow lanes · status Partial · backend UI only · source `src/pages/AiWorkflow.tsx`
- **PermitPilot:** Agent pipeline (backend only, no workflow UI) · route(s) `— (no route)` · exists: No · status Real backend, no UI
- **PP files:** supabase/functions/intake-pipeline-agent; auto-router-agent; permit-classifier-agent; guardian-quality-agent; validate-completeness-agent
- **PP backend:** intake-pipeline-agent; auto-router-agent; permit-classifier-agent; discipline-classifier-agent; guardian-quality-agent; validate-completeness-agent; license-validation-agent · connected: Yes (backend)
- **Match:** Backend match only (confidence High) · UI parity: None — no workflow lane UI · functional parity: Inverted — PermitPilot has the real agents, Lovable has only the UI
- **Route decision:** Defer → `Undecided — would need an agent run observability page` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** If built, prefer "Agent runs" over "AI Workflow"
- **Fake-backend risk:** High — lanes with no run data would be pure decoration
- **Preserve:** Preserve every existing agent edge function and its invocation path.
- **Do not replicate:** Do not replicate Lovable's localStorage persistence. Workflow state must live in Supabase or not exist.
- **Backend work:** An agent_runs table with status, timing and error capture, written by the existing agent functions.
- **Frontend work:** None until run data is persisted.
- **Blocked by:** Needs an agent_runs schema and a decision on retention.
- **Priority / risk / effort / phase:** P2 · Medium · L · Backlog — pairs with L033
- **Acceptance:** Not scoped. Requires an agent_runs schema first.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — needs a product decision on whether PermitPilot should own this domain
- **Audit note:** This row and L033 are the same underlying gap: real agents, no observability surface.

#### L028 · Raze Permit — `/raze`

- **Lovable:** Demolition permit workflow · status Mock · backend Mock · source `src/pages/RazePermit.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build. If demolition permits become a requirement, extend the existing permit application domain rather than adding a separate page.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Lovable page is mock.

### Intelligence

#### L029 · DesignCheck (Compliance) — `/compliance`

- **Lovable:** Compliance overview · status Mock · backend Mock · source `src/pages/Compliance.tsx`
- **PermitPilot:** Code Compliance · route(s) `/code-compliance` · exists: Yes · status Working
- **PP files:** src/pages/CodeCompliance.tsx
- **PP backend:** analyze-drawing; ingest-project-document; context-reference-engine · connected: Yes
- **Match:** Partial match (confidence High) · UI parity: Partial — Lovable splits landing and analyzer into two pages; PermitPilot has one · functional parity: PermitPilot is ahead — Lovable's landing page is mock, PermitPilot's findings are real
- **Route decision:** Fold into existing PP surface → `/code-compliance` · nav: Intelligence group in the sidebar · deep link: n/a
- **Label to use:** Use "DesignCheck" only if the client insists; otherwise keep "Code Compliance"
- **Fake-backend risk:** Medium — an overview band must summarise real findings, not invented counts
- **Preserve:** Preserve the analyze-drawing invocation, findings queries and document ingestion path.
- **Do not replicate:** Do not replicate Lovable's hard-coded sidebar badge of 8, and do not split the page in two just to mirror Lovable's structure.
- **Backend work:** None.
- **Frontend work:** Adopt Lovable's overview band and findings-card styling on the single existing page.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P2 · Low · M · Phase 4 — delivery and intelligence surfaces
- **Acceptance:** One /code-compliance page carries both overview and analyzer content; every count derives from a real query.
- **Verify with:** Manual drawing upload and analysis smoke on a demo project
- **Owner decision needed:** No
- **Audit note:** L029 and L031 both resolve to /code-compliance; PermitPilot deliberately does not split them.

#### L030 · Compliance Intelligence — `/compliance/intelligence`

- **Lovable:** Scoring dashboard · status Mock · backend Mock · source `src/pages/ComplianceIntelligence.tsx`
- **PermitPilot:** Code Compliance findings (unscored) · route(s) `/code-compliance` · exists: No · status Findings exist, no scoring
- **PP files:** src/pages/CodeCompliance.tsx
- **PP backend:** analyze-drawing · connected: Partial
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: Weak — real findings, no score model
- **Route decision:** Defer → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** Medium — plausible future surface, but building it now would require mock data
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** A separate compliance scoring dashboard would need a scoring model; PermitPilot's compliance data is finding-level, not scored.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** Needs an agreed compliance scoring methodology.
- **Priority / risk / effort / phase:** P3 · Medium · L · Backlog — revisit after visual alignment phases complete
- **Acceptance:** No acceptance criteria yet. Promote to a real phase only after a backend design exists and this matrix row is updated.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — needs a product decision on whether PermitPilot should own this domain
- **Audit note:** Lovable page is mock.

#### L031 · Code Analyzer — `/compliance/analyzer`

- **Lovable:** Upload drawings for AI analysis · status Partial · backend Partially connected · source `src/pages/ComplianceAnalyzer.tsx`
- **PermitPilot:** Code Compliance (drawing analyzer) · route(s) `/code-compliance` · exists: Yes · status Working
- **PP files:** src/pages/CodeCompliance.tsx; supabase/functions/analyze-drawing
- **PP backend:** analyze-drawing; ingest-project-document; document-ingestion-worker · connected: Yes
- **Match:** Strong functional match (confidence High) · UI parity: Partial — Lovable's upload panel and results list styling is the target · functional parity: Strong on both sides, and PermitPilot's ingestion path is more complete
- **Route decision:** Fold into existing PP surface → `/code-compliance` · nav: Section of the Code Compliance page; no separate nav entry · deep link: n/a
- **Label to use:** Use "Code Analyzer" as a section heading inside /code-compliance
- **Fake-backend risk:** Low — both sides call a real analysis function
- **Preserve:** Preserve the analyze-drawing contract, upload validation, storage paths and the document ingestion worker handoff.
- **Do not replicate:** Do not persist analyzer presets to localStorage the way Lovable does; PermitPilot settings belong in Supabase.
- **Backend work:** None.
- **Frontend work:** Adopt Lovable's upload dropzone, preset panel and results list styling.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P1 · Medium · M · Phase 4 — delivery and intelligence surfaces
- **Acceptance:** Upload and analysis still complete end to end; results bind to real analysis output; no preset stored outside Supabase.
- **Verify with:** Manual upload and analyze on a demo project; check the analyze-drawing function logs
- **Owner decision needed:** No
- **Audit note:** Directive confirmed: Lovable Code Analyzer ↔ PermitPilot /code-compliance.

#### L032 · Internal Prescreen — `/compliance/prescreen`

- **Lovable:** Staff prescreen · status Mock · backend Mock · source `src/pages/InternalPrescreen.tsx`
- **PermitPilot:** Validation agents (backend only) · route(s) `— (no route)` · exists: No · status Real backend, no review UI
- **PP files:** supabase/functions/validate-completeness-agent; guardian-quality-agent
- **PP backend:** validate-completeness-agent; guardian-quality-agent; license-validation-agent · connected: Yes (backend)
- **Match:** Backend match only (confidence High) · UI parity: None — no prescreen UI · functional parity: Inverted — PermitPilot has real validation, Lovable has only the review screen
- **Route decision:** Defer → `Undecided` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** Medium — a review queue without assignment or state would be decorative
- **Preserve:** Preserve the validation agent invocations already wired into intake.
- **Do not replicate:** PermitPilot has the validation agents but no staff prescreen review queue or reviewer assignment model.
- **Backend work:** A prescreen queue with reviewer assignment and review state.
- **Frontend work:** None until the queue exists.
- **Blocked by:** Needs a staff review workflow definition.
- **Priority / risk / effort / phase:** P2 · Medium · M · Backlog
- **Acceptance:** Not scoped. Requires a review queue schema.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — needs a product decision on whether PermitPilot should own this domain
- **Audit note:** Real validation agents exist; only the human review surface is missing.

#### L033 · Agent Center — `/agents`

- **Lovable:** AI agent registry · status Mock · backend Mock · source `src/pages/AgentCenter.tsx`
- **PermitPilot:** Agent functions (backend only, no registry UI) · route(s) `— (no route)` · exists: No · status Real backend, no UI
- **PP files:** supabase/functions/* (auto-router-agent, comment-parser-agent, permit-classifier-agent, discipline-classifier-agent, intake-pipeline-agent, property-intelligence-agent, guardian-quality-agent, validate-completeness-agent, license-validation-agent, document-preparation-agent)
- **PP backend:** 10+ agent edge functions · connected: Yes (backend)
- **Match:** Backend match only (confidence High) · UI parity: None — no registry UI · functional parity: Inverted — PermitPilot's agents are real; Lovable's registry is a static list
- **Route decision:** Defer → `Undecided — pairs with L027` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — a registry showing 'healthy' without real telemetry would actively mislead
- **Preserve:** Preserve all agent functions and their invocation paths.
- **Do not replicate:** PermitPilot runs 12+ real agent functions but persists no run history, so an agent registry page would list capabilities without status.
- **Backend work:** Shared agent_runs telemetry (status, duration, error) written by every agent function.
- **Frontend work:** None until telemetry exists.
- **Blocked by:** Same agent_runs schema as L027.
- **Priority / risk / effort / phase:** P2 · Medium · L · Backlog — pairs with L027
- **Acceptance:** Not scoped. Requires agent run telemetry.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — needs a product decision on whether PermitPilot should own this domain
- **Audit note:** Strongest example of PermitPilot being ahead of Lovable on the backend and behind on the UI.

#### L034 · Document Vault — `/documents`

- **Lovable:** Document library · status Mock · backend Mock · source `src/pages/DocumentVault.tsx`
- **PermitPilot:** Project documents (contextual, no vault page) · route(s) `/uci?section=application-builder (Documents drawer tab); /portal-data` · exists: Partial — document surfaces exist, no vault route · status Working (contextual)
- **PP files:** src/pages/UciDashboard.tsx (documents tab); document-ingestion-worker/; supabase/functions/ingest-project-document
- **PP backend:** ingest-project-document; document-ingestion-worker; document-preparation-agent · connected: Yes
- **Match:** Backend match only (confidence High) · UI parity: Weak — no cross-project document browser · functional parity: Strong on storage and ingestion; missing only the aggregate view
- **Route decision:** Defer → `Undecided — a cross-project document view could be added later` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** If built, use "Documents"
- **Fake-backend risk:** Low — real documents exist; the risk is only scope creep
- **Preserve:** Preserve ingestion, storage paths, RLS scoping and the document mapping used by permit filing.
- **Do not replicate:** Do not build a vault that bypasses per-project RLS scoping.
- **Backend work:** A cross-project document listing query respecting RLS.
- **Frontend work:** Deferred: a document browser page over that query.
- **Blocked by:** Needs a decision on cross-project document visibility rules.
- **Priority / risk / effort / phase:** P2 · Medium · M · Backlog
- **Acceptance:** Not scoped. Any vault must respect existing RLS scoping.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — cross-project document visibility is a permissions decision
- **Audit note:** Documents are real in PermitPilot; only the aggregate browser is absent.

#### L035 · Content Studio — `/content-studio`

- **Lovable:** Content authoring · status Placeholder · backend UI only · source `src/pages/ContentStudio.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build. Lovable's Content Studio is a UI-only placeholder with local state.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · Medium · L · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Lovable status is Placeholder, backend UI only.

#### L036 · Platform Architecture — `/architecture`

- **Lovable:** Architecture reference · status Working · backend UI only · source `src/pages/PlatformArchitecture.tsx`
- **PermitPilot:** MVP Documentation + API Documentation · route(s) `/mvp-documentation; /api-docs` · exists: Yes · status Working
- **PP files:** src/pages/MVPDocumentation.tsx; src/pages/APIDocumentation.tsx
- **PP backend:** None · connected: None (static by design)
- **Match:** Partial match (confidence Medium) · UI parity: Partial — both are static reference pages with different structure · functional parity: Comparable — both are documentation surfaces, legitimately static
- **Route decision:** Fold into existing PP surface → `/mvp-documentation` · nav: Documentation links only; not a primary sidebar entry · deep link: n/a
- **Label to use:** Keep "MVP Documentation"; do not introduce "Platform Architecture"
- **Fake-backend risk:** None — static documentation is honestly static
- **Preserve:** Preserve the existing documentation content; restyling must not drop sections.
- **Do not replicate:** Do not add a third architecture page. This matrix is the architecture source of truth.
- **Backend work:** None.
- **Frontend work:** Optional low-priority typography and layout alignment.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P3 · Low · S · Phase 7 — documentation and polish
- **Acceptance:** Documentation pages keep all content after restyling; no new architecture page added.
- **Verify with:** Manual visit to /mvp-documentation and /api-docs
- **Owner decision needed:** No
- **Audit note:** Lovable has both /architecture and /architecture-inventory; PermitPilot consolidates into repo docs plus these two pages.

### Utility Coordination

#### L037 · UCI Hub — `/uci`

- **Lovable:** UCI landing · status Mock · backend Mock · source `src/pages/UciDashboard.tsx (via RequireUciAccess)`
- **PermitPilot:** UCI Hub (Utility Coordination) · route(s) `/uci` · exists: Yes · status Working
- **PP files:** src/pages/UciDashboard.tsx; src/lib/uciNavSections.ts; src/components/layout/UciSidebarNav.tsx
- **PP backend:** scraper-service /api/uci; uci-pepco-discovery.service; check-portal-status · connected: Yes
- **Match:** Strong functional match (confidence High) · UI parity: Partial — PermitPilot's hub already exceeds Lovable's; alignment is about chrome, not content · functional parity: PermitPilot is far ahead — Lovable's hub is static mock KPIs
- **Route decision:** Keep PP route → `/uci` · nav: Expandable sidebar group with section children · deep link: /uci?section=overview
- **Label to use:** Use "Utility Coordination" as the group label and "Overview" for this section
- **Fake-backend risk:** Medium — KPI tiles must stay bound to live rollups
- **Preserve:** Preserve the live scraper integration, coordination records, stage rail, attention queue, per-project scoping and the ErrorBoundary wrapper.
- **Do not replicate:** Do not split the hub into Lovable's nine separate /uci/* routes.
- **Backend work:** None.
- **Frontend work:** Align KPI band, stage rail and record table styling with Lovable's UCI hub.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P0 · Medium · M · Phase 3 — core authenticated surfaces
- **Acceptance:** Hub renders live coordination data with the new styling; all existing UCI vitest suites pass; no new /uci/* route added.
- **Verify with:** npx vitest run src/pages/uciDashboard.*.test.ts
- **Owner decision needed:** No
- **Audit note:** src/App.tsx lines 166-175; the expandable nav vocabulary is already in src/lib/uciNavSections.ts.

#### L038 · UCI · Submissions — `/uci/submissions`

- **Lovable:** Submission tracker · status Mock · backend Mock · source `src/pages/UciSubmissions.tsx`
- **PermitPilot:** Submissions · route(s) `/uci?section=submissions&tab=application-prep` · exists: Partial — section of /uci, not a standalone route · status Partial
- **PP files:** src/pages/UciDashboard.tsx; src/lib/uciNavSections.ts; src/components/layout/UciSidebarNav.tsx
- **PP backend:** scraper-service /api/uci; check-portal-status · connected: Partial
- **Match:** Partial match (confidence High) · UI parity: Partial — per-record submission tracking exists; no cross-project submissions table · functional parity: Partial — real per-record submissions, no portfolio-wide view
- **Route decision:** Deep link (query param) → `/uci?section=submissions` · nav: UCI expandable sidebar group; no top-level nav entry · deep link: uciSectionHref("submissions") → tab "application-prep"
- **Label to use:** Use Lovable label "Submissions" in the UCI sidebar
- **Fake-backend risk:** Low — deep link lands on real data
- **Preserve:** Preserve per-record submission and tracking behavior in the Application prep drawer tab.
- **Do not replicate:** Do not create a /uci/submissions route. The directive is explicit: use ?section= instead.
- **Backend work:** A cross-project submissions rollup query, if a portfolio view is later required.
- **Frontend work:** Ensure the sidebar entry deep-links to ?section=submissions and the partial-support banner stays visible.
- **Blocked by:** Requires an open coordination record before the drawer tab can render.
- **Priority / risk / effort / phase:** P1 · Low · S · Phase 3 — core authenticated surfaces
- **Acceptance:** Clicking Submissions lands on the Application prep tab of a real record and the 'cross-project hub not connected' note remains visible.
- **Verify with:** npx vitest run src/pages/uciDashboard.*.test.ts
- **Owner decision needed:** No
- **Audit note:** UCI_NAV_SECTIONS declares support="partial" with target drawer-tab application-prep.

#### L039 · UCI · Inbox / Communications — `/uci/communications`

- **Lovable:** Utility comms inbox · status Mock · backend Mock · source `src/pages/UciCommunications.tsx`
- **PermitPilot:** Communications / Inbox · route(s) `/uci?section=communications&tab=communications` · exists: Partial — section of /uci, not a standalone route · status Partial
- **PP files:** src/pages/UciDashboard.tsx; src/lib/uciNavSections.ts; src/components/layout/UciSidebarNav.tsx
- **PP backend:** scraper-service /api/uci; check-portal-status · connected: Partial
- **Match:** Partial match (confidence High) · UI parity: Partial — per-record portal communications exist; no cross-project inbox · functional parity: Partial — real portal messages per record, no unified inbox
- **Route decision:** Deep link (query param) → `/uci?section=communications` · nav: UCI expandable sidebar group; no top-level nav entry · deep link: uciSectionHref("communications") → tab "communications"
- **Label to use:** Use Lovable label "Communications / Inbox" in the UCI sidebar
- **Fake-backend risk:** Low — deep link lands on real data
- **Preserve:** Preserve per-record portal communications retrieval.
- **Do not replicate:** Do not create /uci/communications, and do not present a cross-project inbox that does not exist.
- **Backend work:** A cross-project message rollup, if an inbox is later required.
- **Frontend work:** Style the communications drawer tab; keep the partial-support banner.
- **Blocked by:** Requires an open coordination record before the drawer tab can render.
- **Priority / risk / effort / phase:** P1 · Low · S · Phase 3 — core authenticated surfaces
- **Acceptance:** Communications deep link opens the real per-record thread with the not-connected note intact.
- **Verify with:** npx vitest run src/pages/uciDashboard.*.test.ts
- **Owner decision needed:** No
- **Audit note:** UCI_NAV_SECTIONS support="partial", target drawer-tab communications.

#### L040 · UCI · Class of Service — `/uci/class-of-service`

- **Lovable:** Class-of-service catalog · status Mock · backend Mock · source `src/pages/UciClassOfService.tsx`
- **PermitPilot:** Class of Service · route(s) `/uci?section=class-of-service&tab=cos` · exists: Partial — section of /uci, not a standalone route · status Partial
- **PP files:** src/pages/UciDashboard.tsx; src/lib/uciNavSections.ts; src/components/layout/UciSidebarNav.tsx
- **PP backend:** scraper-service /api/uci; check-portal-status · connected: Partial
- **Match:** Partial match (confidence High) · UI parity: Partial — per-record COS analysis exists; no predictive portfolio table · functional parity: Partial — real COS per record, no portfolio prediction
- **Route decision:** Deep link (query param) → `/uci?section=class-of-service` · nav: UCI expandable sidebar group; no top-level nav entry · deep link: uciSectionHref("class-of-service") → tab "cos"
- **Label to use:** Use Lovable label "Class of Service" in the UCI sidebar
- **Fake-backend risk:** Low — deep link lands on real data
- **Preserve:** Preserve per-record COS analysis logic.
- **Do not replicate:** Do not create /uci/class-of-service, and do not fabricate a predictive portfolio COS table.
- **Backend work:** A portfolio COS model, only if the client requires prediction.
- **Frontend work:** Style the COS drawer tab; keep the partial-support banner.
- **Blocked by:** Requires an open coordination record before the drawer tab can render.
- **Priority / risk / effort / phase:** P1 · Low · S · Phase 3 — core authenticated surfaces
- **Acceptance:** COS deep link opens the real per-record analysis; no predictive table is shown.
- **Verify with:** npx vitest run src/pages/uciDashboard.*.test.ts
- **Owner decision needed:** No
- **Audit note:** UCI_NAV_SECTIONS support="partial", target drawer-tab cos.

#### L041 · UCI · CIAC & Refunds — `/uci/ciac`

- **Lovable:** CIAC deposits · status Mock · backend Mock · source `src/pages/UciCiac.tsx`
- **PermitPilot:** CIAC & Refunds · route(s) `/uci?section=ciac&tab=costs` · exists: Partial — section of /uci, not a standalone route · status Partial
- **PP files:** src/pages/UciDashboard.tsx; src/lib/uciNavSections.ts; src/components/layout/UciSidebarNav.tsx
- **PP backend:** scraper-service /api/uci; check-portal-status · connected: Partial
- **Match:** Partial match (confidence Medium) · UI parity: Weak — CIAC appears as generic cost rows, not a dedicated refund tracker · functional parity: Partial — CIAC amounts can be recorded; refund windows are not tracked
- **Route decision:** Deep link (query param) → `/uci?section=ciac` · nav: UCI expandable sidebar group; no top-level nav entry · deep link: uciSectionHref("ciac") → tab "costs"
- **Label to use:** Use Lovable label "CIAC & Refunds" in the UCI sidebar
- **Fake-backend risk:** Low — deep link lands on real data
- **Preserve:** Preserve the existing cost-row model that CIAC entries use today.
- **Do not replicate:** Do not create /uci/ciac, and do not show refund-window countdowns that nothing computes.
- **Backend work:** A refund-window model (deposit date, refund deadline, status) before any tracker UI.
- **Frontend work:** Style the Costs drawer tab; keep the 'refund tracker not connected' note.
- **Blocked by:** Requires an open coordination record before the drawer tab can render.
- **Priority / risk / effort / phase:** P2 · Low · S · Phase 4 — delivery and intelligence surfaces
- **Acceptance:** CIAC deep link opens the real Costs tab; no refund-window UI appears without a backing model.
- **Verify with:** npx vitest run src/pages/uciDashboard.*.test.ts
- **Owner decision needed:** Yes — a refund-window model needs a product decision
- **Audit note:** UCI_NAV_SECTIONS note: 'Dedicated refund-window tracker is not connected yet.'

#### L042 · UCI · Energization — `/uci/energization`

- **Lovable:** Energization tracking · status Mock · backend Mock · source `src/pages/UciEnergization.tsx`
- **PermitPilot:** Energization · route(s) `/uci?section=energization&tab=costs` · exists: Partial — section of /uci, not a standalone route · status Partial
- **PP files:** src/pages/UciDashboard.tsx; src/lib/uciNavSections.ts; src/components/layout/UciSidebarNav.tsx
- **PP backend:** scraper-service /api/uci; check-portal-status · connected: Partial
- **Match:** Partial match (confidence Medium) · UI parity: Weak — energization dates exist; no multi-party choreography timeline · functional parity: Partial — real dates and meter-set/closeout data, no orchestration view
- **Route decision:** Deep link (query param) → `/uci?section=energization` · nav: UCI expandable sidebar group; no top-level nav entry · deep link: uciSectionHref("energization") → tab "costs"
- **Label to use:** Use Lovable label "Energization" in the UCI sidebar
- **Fake-backend risk:** Low — deep link lands on real data
- **Preserve:** Preserve energization dates and the meter-set/closeout checklist generation.
- **Do not replicate:** Do not create /uci/energization, and do not render a choreography timeline with invented participants.
- **Backend work:** A multi-party scheduling model, if choreography is required.
- **Frontend work:** Style the Costs drawer tab; keep the partial-support note.
- **Blocked by:** Requires an open coordination record before the drawer tab can render.
- **Priority / risk / effort / phase:** P2 · Low · S · Phase 4 — delivery and intelligence surfaces
- **Acceptance:** Energization deep link opens real dates; no fabricated timeline.
- **Verify with:** npx vitest run src/pages/uciDashboard.*.test.ts
- **Owner decision needed:** No
- **Audit note:** UCI_NAV_SECTIONS note: 'Multi-party choreography timeline is not connected yet.'

#### L043 · UCI · Miss Utility 811 — `/uci/miss-utility`

- **Lovable:** 811 tickets · status Mock · backend Mock · source `src/pages/UciMissUtility.tsx`
- **PermitPilot:** Miss Utility · route(s) `/uci?section=miss-utility` · exists: Partial — section of /uci, not a standalone route · status Coming-soon panel (labelled, no data)
- **PP files:** src/pages/UciDashboard.tsx; src/lib/uciNavSections.ts; src/components/layout/UciSidebarNav.tsx
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — labelled coming-soon panel only · functional parity: None — no 811 ticket domain in PermitPilot
- **Route decision:** Do not build → `/uci?section=miss-utility` · nav: UCI expandable sidebar group; no top-level nav entry · deep link: uciSectionHref("miss-utility")
- **Label to use:** Use Lovable label "Miss Utility" in the UCI sidebar
- **Fake-backend risk:** High — must stay a labelled coming-soon panel, never a mock data table
- **Preserve:** Preserve the coming-soon panel's explicit 'no backend yet' labelling.
- **Do not replicate:** Do not build an 811 ticket table. There is no PermitPilot backend for Miss Utility tickets, and 811 is a regulated notification process — a fake ticket UI could imply a locate request was filed when it was not.
- **Backend work:** An 811 ticket domain plus a real integration with the state notification centre.
- **Frontend work:** None. Keep the coming-soon panel.
- **Blocked by:** No 811 integration; regulatory implications.
- **Priority / risk / effort / phase:** P3 · High · L · Out of scope — coming-soon panel only
- **Acceptance:** ?section=miss-utility continues to render the labelled coming-soon panel and nothing that looks like a real ticket list.
- **Verify with:** Manual visit to /uci?section=miss-utility
- **Owner decision needed:** Yes — regulated process; needs explicit approval
- **Audit note:** UCI_NAV_SECTIONS note: 'No PermitPilot backend for 811 / Miss Utility tickets yet.'

#### L044 · UCI · Knowledge Graph — `/uci/knowledge-graph`

- **Lovable:** Utility knowledge graph · status Mock · backend Mock · source `src/pages/UciKnowledgeGraph.tsx`
- **PermitPilot:** Knowledge Graph · route(s) `/uci?section=knowledge-graph` · exists: Partial — section of /uci, not a standalone route · status Coming-soon panel (labelled, no data)
- **PP files:** src/pages/UciDashboard.tsx; src/lib/uciNavSections.ts; src/components/layout/UciSidebarNav.tsx
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — labelled coming-soon panel only · functional parity: None — no graph/nodes backend
- **Route decision:** Do not build → `/uci?section=knowledge-graph` · nav: UCI expandable sidebar group; no top-level nav entry · deep link: uciSectionHref("knowledge-graph")
- **Label to use:** Use Lovable label "Knowledge Graph" in the UCI sidebar
- **Fake-backend risk:** High — must stay a labelled coming-soon panel, never a mock data table
- **Preserve:** Preserve the coming-soon labelling.
- **Do not replicate:** Do not build a graph explorer. PermitPilot has no graph or node storage; every edge would be invented.
- **Backend work:** A graph schema plus an entity-resolution pipeline.
- **Frontend work:** None.
- **Blocked by:** No graph domain; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — coming-soon panel only
- **Acceptance:** ?section=knowledge-graph stays a labelled coming-soon panel.
- **Verify with:** Manual visit to /uci?section=knowledge-graph
- **Owner decision needed:** Yes
- **Audit note:** UCI_NAV_SECTIONS note: 'No PermitPilot graph/nodes backend yet.'

#### L045 · UCI Application Builder — `/uci/application-builder`

- **Lovable:** Assemble UCI packet · status Placeholder · backend UI only · source `src/pages/UciApplicationBuilder.tsx`
- **PermitPilot:** Application Builder · route(s) `/uci?section=application-builder&tab=application-prep` · exists: Partial — section of /uci, not a standalone route · status Working
- **PP files:** src/pages/UciDashboard.tsx; src/lib/uciNavSections.ts; src/components/layout/UciSidebarNav.tsx
- **PP backend:** scraper-service /api/uci; check-portal-status · connected: Yes
- **Match:** Strong functional match (confidence High) · UI parity: Partial — PermitPilot's Application prep is richer than Lovable's builder · functional parity: PermitPilot is far ahead — Lovable's builder is a UI-only placeholder; PermitPilot builds, maps documents, reviews and submits
- **Route decision:** Deep link (query param) → `/uci?section=application-builder` · nav: UCI expandable sidebar group; no top-level nav entry · deep link: uciSectionHref("application-builder") → tab "application-prep"
- **Label to use:** Use Lovable label "Application Builder" in the UCI sidebar
- **Fake-backend risk:** Low — deep link lands on real data
- **Preserve:** Preserve the build / map documents / review / submit flow and its document mapping logic, which has dedicated vitest coverage.
- **Do not replicate:** Do not create /uci/application-builder, and do not simplify the real four-step flow to match Lovable's placeholder.
- **Backend work:** None.
- **Frontend work:** Style the Application prep drawer tab to match Lovable's builder chrome.
- **Blocked by:** Requires an open coordination record.
- **Priority / risk / effort / phase:** P1 · Medium · S · Phase 3 — core authenticated surfaces
- **Acceptance:** Application prep still builds, maps documents, reviews and submits; document-mapping tests pass.
- **Verify with:** npx vitest run src/pages/uciDashboard.documentMapping.test.ts
- **Owner decision needed:** No
- **Audit note:** UCI_NAV_SECTIONS support="active": 'Real Application prep (build / map docs / review / submit).'

#### L046 · Jurisdiction Map — `/utility-map`

- **Lovable:** Utility map view · status Mock · backend Mock · source `src/pages/UtilityMap.tsx`
- **PermitPilot:** Jurisdiction Map · route(s) `/jurisdictions/map` · exists: Yes · status Working
- **PP files:** src/pages/JurisdictionMapPage.tsx; scraper-service/data/territory/electric-full-v2/*
- **PP backend:** get-mapbox-token; scraper-service territory datasets · connected: Yes
- **Match:** Strong functional match (confidence High) · UI parity: Partial — Lovable's map chrome and legend styling is the target · functional parity: PermitPilot is far ahead — Lovable's map is static; PermitPilot renders real service-territory geometry
- **Route decision:** Keep PP route → `/jurisdictions/map` · nav: Intelligence group in the sidebar; also the target of the UCI Provider Map section · deep link: /uci?section=provider-map navigates here (kind: external)
- **Label to use:** Keep "Jurisdiction Map"
- **Fake-backend risk:** Low — the territory data is real and validated
- **Preserve:** Preserve the Mapbox token flow (get-mapbox-token), territory GeoJSON loading and the footprint validation datasets.
- **Do not replicate:** Do not hard-code a Mapbox token or bundle a reduced territory dataset for styling convenience.
- **Backend work:** None.
- **Frontend work:** Align map container, legend and filter styling with Lovable's map view.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P1 · Medium · M · Phase 4 — delivery and intelligence surfaces
- **Acceptance:** Map renders all territory layers with the new chrome; token retrieval unchanged; UCI provider-map deep link still lands here.
- **Verify with:** node --test scraper-service/tests (territory footprint suites); manual map smoke
- **Owner decision needed:** No
- **Audit note:** uciNavSections provider-map target is { kind: 'external', href: '/jurisdictions/map' } — explicitly 'not a mock provider map'.

#### L047 · Provider Compare — `/utility/provider-map`

- **Lovable:** Provider comparison · status Partial · backend Partially connected · source `src/pages/UtilityProviderMap.tsx`
- **PermitPilot:** Jurisdiction Comparison · route(s) `/jurisdictions/compare (alias /jurisdiction-comparison)` · exists: Yes · status Working
- **PP files:** src/pages/JurisdictionComparison.tsx
- **PP backend:** Supabase jurisdiction tables; scraper-service provider directory · connected: Yes
- **Match:** Partial match (confidence Medium) · UI parity: Partial — Lovable compares utility providers, PermitPilot compares jurisdictions; the comparison-table pattern is shared · functional parity: Partial — PermitPilot's comparison is real but oriented to jurisdictions rather than providers
- **Route decision:** Fold into existing PP surface → `/jurisdictions/compare` · nav: Intelligence group in the sidebar · deep link: /jurisdiction-comparison is an existing alias of the same page
- **Label to use:** Keep "Compare Jurisdictions"; use "Provider Map" only for the UCI section that links to the map
- **Fake-backend risk:** Medium — do not add provider comparison columns the directory cannot fill
- **Preserve:** Preserve the jurisdiction comparison queries and the provider directory metadata.
- **Do not replicate:** Do not build a second provider-comparison page; the UCI Provider Map section already routes to the real map.
- **Backend work:** Provider-level comparison fields, only if the client specifically needs provider-vs-provider comparison.
- **Frontend work:** Adopt Lovable's comparison-table styling on the existing page.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P2 · Medium · M · Phase 4 — delivery and intelligence surfaces
- **Acceptance:** Comparison table restyled with real jurisdiction data; both existing route aliases still resolve.
- **Verify with:** Manual visit to /jurisdictions/compare and /jurisdiction-comparison
- **Owner decision needed:** Yes — confirm whether the client wants jurisdiction or provider comparison
- **Audit note:** src/App.tsx lines 125-126 declare both routes for the same component.

#### L048 · Cross-Utility Conflict Hunter — `/utility/conflict-hunter`

- **Lovable:** Conflict detection · status Mock · backend Mock · source `src/pages/CrossUtilityConflictHunter.tsx`
- **PermitPilot:** Conflict Hunter · route(s) `/uci?section=conflict-hunter` · exists: Partial — section of /uci, not a standalone route · status Coming-soon panel (labelled, no data)
- **PP files:** src/pages/UciDashboard.tsx; src/lib/uciNavSections.ts; src/components/layout/UciSidebarNav.tsx
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — labelled coming-soon panel only · functional parity: None — no conflict-detection service
- **Route decision:** Do not build → `/uci?section=conflict-hunter` · nav: UCI expandable sidebar group; no top-level nav entry · deep link: uciSectionHref("conflict-hunter")
- **Label to use:** Use Lovable label "Conflict Hunter" in the UCI sidebar
- **Fake-backend risk:** High — must stay a labelled coming-soon panel, never a mock data table
- **Preserve:** Preserve the coming-soon labelling.
- **Do not replicate:** Do not build. A conflict detector that reports 'no conflicts' without analysing anything is actively dangerous on a utility coordination platform.
- **Backend work:** A cross-utility conflict detection service with real geometry and schedule inputs.
- **Frontend work:** None.
- **Blocked by:** No conflict-detection service.
- **Priority / risk / effort / phase:** P3 · High · L · Out of scope — coming-soon panel only
- **Acceptance:** ?section=conflict-hunter stays a labelled coming-soon panel.
- **Verify with:** Manual visit to /uci?section=conflict-hunter
- **Owner decision needed:** Yes
- **Audit note:** UCI_NAV_SECTIONS note: 'No conflict-detection service yet.'

#### L049 · Easement / ROW Manager — `/utility/easements`

- **Lovable:** Easement tracking · status Mock · backend Mock · source `src/pages/EasementRowManager.tsx`
- **PermitPilot:** Easement / Right of Way · route(s) `/uci?section=easement` · exists: Partial — section of /uci, not a standalone route · status Coming-soon panel (labelled, no data)
- **PP files:** src/pages/UciDashboard.tsx; src/lib/uciNavSections.ts; src/components/layout/UciSidebarNav.tsx
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — labelled coming-soon panel only · functional parity: None — no easement/ROW domain
- **Route decision:** Do not build → `/uci?section=easement` · nav: UCI expandable sidebar group; no top-level nav entry · deep link: uciSectionHref("easement")
- **Label to use:** Use Lovable label "Easement / Right of Way" in the UCI sidebar
- **Fake-backend risk:** High — must stay a labelled coming-soon panel, never a mock data table
- **Preserve:** Preserve the coming-soon labelling.
- **Do not replicate:** Do not build. Easements are legal instruments; a tracker with no records could imply rights that were never secured.
- **Backend work:** An easement/ROW domain with document linkage.
- **Frontend work:** None.
- **Blocked by:** No easement domain; legal review needed.
- **Priority / risk / effort / phase:** P3 · High · L · Out of scope — coming-soon panel only
- **Acceptance:** ?section=easement stays a labelled coming-soon panel.
- **Verify with:** Manual visit to /uci?section=easement
- **Owner decision needed:** Yes
- **Audit note:** UCI_NAV_SECTIONS note: 'No easement / ROW domain yet.'

#### L050 · Load Profile Analyzer — `/utility/load-profile`

- **Lovable:** Load analysis · status Partial · backend Partially connected · source `src/pages/LoadProfileAnalyzer.tsx`
- **PermitPilot:** Load Profile · route(s) `/uci?section=load-profile&tab=load-profile` · exists: Partial — section of /uci, not a standalone route · status Working
- **PP files:** src/pages/UciDashboard.tsx; src/lib/uciNavSections.ts; src/components/layout/UciSidebarNav.tsx
- **PP backend:** scraper-service /api/uci; check-portal-status · connected: Yes
- **Match:** Strong functional match (confidence High) · UI parity: Partial — PermitPilot's load profile lives in a drawer tab rather than a page · functional parity: Strong on both sides; PermitPilot's version is real and has test coverage
- **Route decision:** Deep link (query param) → `/uci?section=load-profile` · nav: UCI expandable sidebar group; no top-level nav entry · deep link: uciSectionHref("load-profile") → tab "load-profile"
- **Label to use:** Use Lovable label "Load Profile" in the UCI sidebar
- **Fake-backend risk:** Low — deep link lands on real data
- **Preserve:** Preserve load-profile upload, parsing and analysis logic, including its existing vitest coverage.
- **Do not replicate:** Do not create /utility/load-profile as a separate route.
- **Backend work:** None.
- **Frontend work:** Style the Load profile drawer tab to match Lovable's analyzer panel.
- **Blocked by:** Requires an open coordination record before the drawer tab can render.
- **Priority / risk / effort / phase:** P1 · Low · S · Phase 3 — core authenticated surfaces
- **Acceptance:** Load profile upload and analysis still work in the drawer tab; existing tests pass.
- **Verify with:** npx vitest run src/pages/uciDashboard.*.test.ts
- **Owner decision needed:** No
- **Audit note:** UCI_NAV_SECTIONS support="active". Lovable also records vitest coverage on its own version.

#### L051 · Meter Set Choreographer — `/utility/meter-set`

- **Lovable:** Meter set sequencing · status Mock · backend Mock · source `src/pages/MeterSetChoreographer.tsx`
- **PermitPilot:** Meter Set · route(s) `/uci?section=meter-set&tab=costs` · exists: Partial — section of /uci, not a standalone route · status Partial
- **PP files:** src/pages/UciDashboard.tsx; src/lib/uciNavSections.ts; src/components/layout/UciSidebarNav.tsx
- **PP backend:** scraper-service /api/uci; check-portal-status · connected: Partial
- **Match:** Partial match (confidence Medium) · UI parity: Weak — checklist generation exists; no sequencing/scheduling UI · functional parity: Partial — real meter-set and closeout checklist generation, no choreography
- **Route decision:** Deep link (query param) → `/uci?section=meter-set` · nav: UCI expandable sidebar group; no top-level nav entry · deep link: uciSectionHref("meter-set") → tab "costs"
- **Label to use:** Use Lovable label "Meter Set" in the UCI sidebar
- **Fake-backend risk:** Low — deep link lands on real data
- **Preserve:** Preserve meter-set and closeout checklist generation.
- **Do not replicate:** Do not create /utility/meter-set, and do not build a sequencing board over data that does not exist.
- **Backend work:** A scheduling model before any sequencing UI.
- **Frontend work:** Keep the partial-support note; no new UI.
- **Blocked by:** Requires an open coordination record before the drawer tab can render.
- **Priority / risk / effort / phase:** P3 · Medium · M · Backlog
- **Acceptance:** Meter Set deep link opens the real Costs tab with the partial-support note intact.
- **Verify with:** npx vitest run src/pages/uciDashboard.*.test.ts
- **Owner decision needed:** Yes — sequencing scope needs a product decision
- **Audit note:** UCI_NAV_SECTIONS note: 'Richer scheduling UI is not connected yet.'

#### L052 · Long-Lead Equipment — `/scheduling/long-lead`

- **Lovable:** Equipment ETA tracker · status Mock · backend Mock · source `src/pages/LongLeadEquipment.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build. Long-lead equipment tracking needs a procurement domain PermitPilot does not have.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Lovable page is mock.

#### L053 · Predictive Schedule Impact — `/scheduling/predictive-impact`

- **Lovable:** Schedule risk model · status Mock · backend Mock · source `src/pages/PredictiveScheduleImpact.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build. A predictive model with no inputs would output invented risk.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Lovable page is mock.

#### L054 · Inspector Release Tracker — `/inspections/release-tracker`

- **Lovable:** Inspection release status · status Mock · backend Mock · source `src/pages/InspectorReleaseTracker.tsx`
- **PermitPilot:** Inspection reminders (backend only) · route(s) `— (no route)` · exists: No · status Reminders real, no tracker
- **PP files:** supabase/functions/send-inspection-reminders
- **PP backend:** send-inspection-reminders · connected: Yes (reminders only)
- **Match:** Backend match only (confidence High) · UI parity: None — no tracker UI · functional parity: Weak — reminders exist but inspection release is not modelled
- **Route decision:** Defer → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** Medium — plausible future surface, but building it now would require mock data
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** PermitPilot sends real inspection reminders but does not model inspection release state, so a tracker would show status it cannot compute.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** Needs an inspection state model.
- **Priority / risk / effort / phase:** P3 · Medium · L · Backlog — revisit after visual alignment phases complete
- **Acceptance:** No acceptance criteria yet. Promote to a real phase only after a backend design exists and this matrix row is updated.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — needs a product decision on whether PermitPilot should own this domain
- **Audit note:** send-inspection-reminders is real; the tracker surface is not.

#### L055 · Special Inspections — `/inspections/special`

- **Lovable:** Special inspection log · status Mock · backend Mock · source `src/pages/SpecialInspections.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build. Blocked on the same inspection state model as L054.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Lovable page is mock.

#### L056 · Final CO Inspections — `/inspections/final-co`

- **Lovable:** Final CO tracking · status Mock · backend Mock · source `src/pages/FinalInspections.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build. Blocked on the same inspection state model as L054.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Lovable page is mock.

### Field

#### L057 · SIR — `/sir`

- **Lovable:** Site Investigation Report · status Mock · backend Mock · source `src/pages/Sir.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build the SIR landing. Explicitly out of scope. Directive: 'Do NOT replicate as fake backends: ... SIR/Field mobile packs'. PermitPilot has no site-investigation domain, no offline sync and no field evidence storage.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Whole SIR family is mock in Lovable and has no PermitPilot counterpart.

#### L058 · SIR Workspace — `/sir/workspace`

- **Lovable:** Workspace · status Mock · backend Mock · source `src/pages/SirWorkspace.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build the SIR workspace. Explicitly out of scope. Directive: 'Do NOT replicate as fake backends: ... SIR/Field mobile packs'. PermitPilot has no site-investigation domain, no offline sync and no field evidence storage.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Whole SIR family is mock in Lovable and has no PermitPilot counterpart.

#### L059 · SIR Annex — `/sir/annex`

- **Lovable:** Annex sections · status Mock · backend Mock · source `src/pages/SirAnnex.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build the SIR annex. Explicitly out of scope. Directive: 'Do NOT replicate as fake backends: ... SIR/Field mobile packs'. PermitPilot has no site-investigation domain, no offline sync and no field evidence storage.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Whole SIR family is mock in Lovable and has no PermitPilot counterpart.

#### L060 · SIR Executive — `/sir/executive`

- **Lovable:** Executive rollup · status Mock · backend Mock · source `src/pages/SirExecutive.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build the SIR executive rollup. Explicitly out of scope. Directive: 'Do NOT replicate as fake backends: ... SIR/Field mobile packs'. PermitPilot has no site-investigation domain, no offline sync and no field evidence storage.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Whole SIR family is mock in Lovable and has no PermitPilot counterpart.

#### L061 · SIR Sync — `/sir/sync`

- **Lovable:** Sync field evidence · status Mock · backend Mock · source `src/pages/SirSync.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build the SIR sync. Explicitly out of scope. Directive: 'Do NOT replicate as fake backends: ... SIR/Field mobile packs'. PermitPilot has no site-investigation domain, no offline sync and no field evidence storage.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Whole SIR family is mock in Lovable and has no PermitPilot counterpart.

#### L062 · Field Studio — `/field/studio`

- **Lovable:** Field content authoring · status Mock · backend Mock · source `src/pages/FieldStudio.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build. Part of the excluded SIR/Field mobile pack.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Lovable page is mock.

#### L063 · Mobile Survey — `/mobile/survey`

- **Lovable:** Mobile survey entry · status Mock · backend UI only · source `src/pages/MobileSurvey.tsx`
- **PermitPilot:** PWA / Capacitor mobile shell (no field surfaces) · route(s) `— (none)` · exists: No · status Mobile shell real, field surfaces absent
- **PP files:** capacitor.config.ts; src/components/pwa/InstallPrompt.tsx; src/components/pwa/OfflineIndicator.tsx
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build. Part of the excluded field mobile pack; Lovable's version keeps entries in local state only.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** PermitPilot already ships a real mobile shell (Capacitor config, PWA install prompt, offline indicator), so mobile capability is not the gap — the missing part is the field data domain.

#### L064 · Mobile Camera — `/mobile/camera`

- **Lovable:** Photo capture · status Mock · backend UI only · source `src/pages/MobileCamera.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build. Lovable's camera page persists nothing; capturing photos with no storage would silently lose evidence.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** PermitPilot already ships a real mobile shell (Capacitor config, PWA install prompt, offline indicator), so mobile capability is not the gap — the missing part is the field data domain.

#### L065 · Mobile Map — `/mobile/map`

- **Lovable:** Mobile map · status Mock · backend UI only · source `src/pages/MobileMap.tsx`
- **PermitPilot:** Jurisdiction Map (responsive, serves mobile) · route(s) `/jurisdictions/map` · exists: No · status Existing map is responsive
- **PP files:** src/pages/JurisdictionMapPage.tsx
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build a mobile-only map. Make /jurisdictions/map responsive instead (covered by L046).
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · Low · S · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Consolidating on one map avoids two divergent map implementations.

### Closeout

#### L066 · Closeout — `/closeout`

- **Lovable:** Project closeout hub · status Mock · backend Mock · source `src/pages/Closeout.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Defer → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** Medium — plausible future surface, but building it now would require mock data
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** No PermitPilot closeout hub exists. PermitPilot has no closeout domain: no closeout state, no archive model and no post-mortem records. Lovable's entire closeout hierarchy is mock.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** Needs a closeout domain and, for the financial views, a cost model.
- **Priority / risk / effort / phase:** P3 · Medium · L · Backlog — revisit after visual alignment phases complete
- **Acceptance:** No acceptance criteria yet. Promote to a real phase only after a backend design exists and this matrix row is updated.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — needs a product decision on whether PermitPilot should own this domain
- **Audit note:** Lovable's closeout tree aggregates nothing; there is no upstream data to aggregate in PermitPilot either.

#### L067 · Closeout Archive — `/closeout/archive`

- **Lovable:** Archive · status Mock · backend Mock · source `src/pages/CloseoutArchive.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Defer → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** Medium — plausible future surface, but building it now would require mock data
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** No PermitPilot closeout archive exists. PermitPilot has no closeout domain: no closeout state, no archive model and no post-mortem records. Lovable's entire closeout hierarchy is mock.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** Needs a closeout domain and, for the financial views, a cost model.
- **Priority / risk / effort / phase:** P3 · Medium · L · Backlog — revisit after visual alignment phases complete
- **Acceptance:** No acceptance criteria yet. Promote to a real phase only after a backend design exists and this matrix row is updated.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — needs a product decision on whether PermitPilot should own this domain
- **Audit note:** Lovable's closeout tree aggregates nothing; there is no upstream data to aggregate in PermitPilot either.

#### L068 · Closeout Tracker — `/closeout/tracker`

- **Lovable:** Closeout tracker · status Mock · backend Mock · source `src/pages/CloseoutTracker.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Defer → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** Medium — plausible future surface, but building it now would require mock data
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** No PermitPilot closeout tracker exists. PermitPilot has no closeout domain: no closeout state, no archive model and no post-mortem records. Lovable's entire closeout hierarchy is mock.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** Needs a closeout domain and, for the financial views, a cost model.
- **Priority / risk / effort / phase:** P3 · Medium · L · Backlog — revisit after visual alignment phases complete
- **Acceptance:** No acceptance criteria yet. Promote to a real phase only after a backend design exists and this matrix row is updated.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — needs a product decision on whether PermitPilot should own this domain
- **Audit note:** Lovable's closeout tree aggregates nothing; there is no upstream data to aggregate in PermitPilot either.

#### L069 · Post-Mortem — `/closeout/post-mortem`

- **Lovable:** Post-mortem hub · status Mock · backend Mock · source `src/pages/PostMortem.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Defer → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** Medium — plausible future surface, but building it now would require mock data
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** No PermitPilot post-mortem hub exists. PermitPilot has no closeout domain: no closeout state, no archive model and no post-mortem records. Lovable's entire closeout hierarchy is mock.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** Needs a closeout domain and, for the financial views, a cost model.
- **Priority / risk / effort / phase:** P3 · Medium · L · Backlog — revisit after visual alignment phases complete
- **Acceptance:** No acceptance criteria yet. Promote to a real phase only after a backend design exists and this matrix row is updated.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — needs a product decision on whether PermitPilot should own this domain
- **Audit note:** Lovable's closeout tree aggregates nothing; there is no upstream data to aggregate in PermitPilot either.

#### L070 · Post-Mortem Analytics — `/closeout/post-mortem/analytics`

- **Lovable:** Analytics · status Mock · backend Mock · source `src/pages/PostMortemAnalytics.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Defer → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** Medium — plausible future surface, but building it now would require mock data
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** No PermitPilot post-mortem analytics exists. PermitPilot has no closeout domain: no closeout state, no archive model and no post-mortem records. Lovable's entire closeout hierarchy is mock.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** Needs a closeout domain and, for the financial views, a cost model.
- **Priority / risk / effort / phase:** P3 · Medium · L · Backlog — revisit after visual alignment phases complete
- **Acceptance:** No acceptance criteria yet. Promote to a real phase only after a backend design exists and this matrix row is updated.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — needs a product decision on whether PermitPilot should own this domain
- **Audit note:** Lovable's closeout tree aggregates nothing; there is no upstream data to aggregate in PermitPilot either.

#### L071 · Post-Mortem Financial — `/closeout/post-mortem/financial`

- **Lovable:** Financial impact · status Mock · backend Mock · source `src/pages/PostMortemFinancial.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Defer → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** Medium — plausible future surface, but building it now would require mock data
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** No PermitPilot post-mortem financial exists. PermitPilot has no closeout domain: no closeout state, no archive model and no post-mortem records. Lovable's entire closeout hierarchy is mock.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** Needs a closeout domain and, for the financial views, a cost model.
- **Priority / risk / effort / phase:** P3 · Medium · L · Backlog — revisit after visual alignment phases complete
- **Acceptance:** No acceptance criteria yet. Promote to a real phase only after a backend design exists and this matrix row is updated.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — needs a product decision on whether PermitPilot should own this domain
- **Audit note:** Lovable's closeout tree aggregates nothing; there is no upstream data to aggregate in PermitPilot either.

### Resources

#### L072 · Checklists — `/checklists`

- **Lovable:** Checklist history · status Mock · backend Mock · source `src/pages/Checklists.tsx`
- **PermitPilot:** Checklist History · route(s) `/checklists (alias /checklist-history)` · exists: Yes · status Working
- **PP files:** src/pages/ChecklistHistory.tsx
- **PP backend:** send-checklist-report; process-scheduled-checklist-reports; send-checklist-signed-notification; send-test-scheduled-report; retry-failed-report-emails · connected: Yes
- **Match:** Strong functional match (confidence High) · UI parity: Partial — Lovable's list styling is the target · functional parity: PermitPilot is far ahead — Lovable browses mock checklists; PermitPilot has real runs, scheduled report delivery and signature notifications
- **Route decision:** Keep PP route → `/checklists` · nav: Resources group in the sidebar · deep link: /checklist-history is an existing alias of the same page
- **Label to use:** Keep "Checklists"
- **Fake-backend risk:** Low — the underlying data is real
- **Preserve:** Preserve scheduled report processing, email delivery, retry handling and signed-checklist notifications. These run on schedules; do not disturb their triggers.
- **Do not replicate:** Do not fabricate checklist history entries.
- **Backend work:** None.
- **Frontend work:** Adopt Lovable's checklist list and status styling.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P1 · Low · M · Phase 4 — delivery and intelligence surfaces
- **Acceptance:** Checklist list restyled over real runs; both route aliases resolve; scheduled report functions untouched.
- **Verify with:** Manual visit to /checklists and /checklist-history; confirm no changes under supabase/functions
- **Owner decision needed:** No
- **Audit note:** src/App.tsx lines 161-162 map both routes to ChecklistHistory.

#### L073 · Reference Library — `/reference`

- **Lovable:** Reference hub · status Working · backend UI only · source `src/pages/ReferenceLibrary.tsx`
- **PermitPilot:** Code Reference Library · route(s) `/code-reference` · exists: Yes · status Working
- **PP files:** src/pages/CodeReferenceLibrary.tsx
- **PP backend:** context-reference-engine · connected: Partial
- **Match:** Partial match (confidence Medium) · UI parity: Partial — both are reference hubs; PermitPilot's is code-specific, Lovable's is a general doc index · functional parity: PermitPilot is ahead — its reference content feeds grounded response citations
- **Route decision:** Fold into existing PP surface → `/code-reference` · nav: Resources group in the sidebar · deep link: n/a
- **Label to use:** Keep "Code Reference"; do not add a generic "Reference Library" hub
- **Fake-backend risk:** Low
- **Preserve:** Preserve the citation linkage used by generate-grounded-response and context-reference-engine.
- **Do not replicate:** Do not add a parent /reference hub page that only links onward.
- **Backend work:** None.
- **Frontend work:** Adopt Lovable's reference-card and search styling.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P2 · Low · S · Phase 5 — admin and settings surfaces
- **Acceptance:** Code reference browsing and citation links still work with the new styling.
- **Verify with:** Manual visit to /code-reference; verify a grounded response citation resolves
- **Owner decision needed:** No
- **Audit note:** src/App.tsx line 131.

#### L074 · Utility Coverage — `/reference/utility-coverage`

- **Lovable:** Provider coverage matrix · status Working · backend UI only · source `src/pages/UtilityCoverage.tsx`
- **PermitPilot:** Utility territory datasets (surfaced via the map) · route(s) `/jurisdictions/map` · exists: Partial — data exists, no coverage table page · status Data real, no coverage table
- **PP files:** src/pages/JurisdictionMapPage.tsx; scraper-service/data/territory/electric-full-v2/utilities_by_state.json; county_utility.json
- **PP backend:** scraper-service territory datasets · connected: Yes
- **Match:** Partial match (confidence High) · UI parity: Weak — no tabular coverage view · functional parity: PermitPilot is ahead on data; behind on the tabular presentation
- **Route decision:** Fold into existing PP surface → `/jurisdictions/map (coverage table as a panel)` · nav: Panel on the Jurisdiction Map page; no separate route · deep link: n/a
- **Label to use:** Use "Utility Coverage" for the panel heading
- **Fake-backend risk:** Low — coverage claims must come from the reconciliation reports, which exist
- **Preserve:** Preserve the reconciliation and footprint validation datasets as the single source for coverage claims.
- **Do not replicate:** Do not publish coverage claims that the reconciliation reports do not support.
- **Backend work:** None — utilities_by_state.json and county_utility.json already back a coverage table.
- **Frontend work:** Add a coverage table panel to the map page reading the existing datasets.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P2 · Medium · M · Phase 6 — structural follow-ups
- **Acceptance:** Any coverage figure shown traces to a reconciliation report file; no separate /reference/utility-coverage route added.
- **Verify with:** node --test scraper-service/tests (county reconcile suites)
- **Owner decision needed:** No
- **Audit note:** Coverage claims are client-visible; they must stay tied to the validation reports.

#### L075 · Glossary — `/reference/glossary`

- **Lovable:** Terminology · status Working · backend UI only · source `src/pages/Glossary.tsx`
- **PermitPilot:** Glossary (placeholder) · route(s) `/reference/glossary` · exists: Yes — placeholder page · status Placeholder (labelled)
- **PP files:** src/pages/placeholders/GlossaryPlaceholder.tsx
- **PP backend:** None (static content by design once written) · connected: None
- **Match:** Partial match (confidence High) · UI parity: Weak — the route matches but PermitPilot has no terms yet · functional parity: Weak — Lovable has searchable static terms; PermitPilot has a placeholder
- **Route decision:** Keep PP route → `/reference/glossary` · nav: Resources group in the sidebar · deep link: n/a
- **Label to use:** Keep "Glossary"
- **Fake-backend risk:** None — glossary content is legitimately static
- **Preserve:** Preserve the placeholder labelling until real terms are curated.
- **Do not replicate:** Do not copy Lovable's glossary terms verbatim without checking they match PermitPilot's actual vocabulary.
- **Backend work:** None — static content is appropriate here.
- **Frontend work:** Curate PermitPilot permitting and utility-coordination terms, then adopt Lovable's searchable list styling.
- **Blocked by:** Needs someone to write the terms.
- **Priority / risk / effort / phase:** P3 · Low · S · Phase 7 — documentation and polish
- **Acceptance:** Glossary shows real PermitPilot terminology with working search, or stays an explicit placeholder.
- **Verify with:** Manual visit to /reference/glossary
- **Owner decision needed:** No
- **Audit note:** src/App.tsx line 164 uses GlossaryPlaceholder.

#### L076 · Analytics & Reporting — `/portfolio/executive`

- **Lovable:** Executive portfolio KPIs · status Mock · backend Mock · source `src/pages/PortfolioExecutive.tsx`
- **PermitPilot:** Analytics · route(s) `/analytics` · exists: Yes · status Working
- **PP files:** src/pages/Analytics.tsx
- **PP backend:** Supabase aggregate queries; export-weekly-report · connected: Yes
- **Match:** Strong functional match (confidence High) · UI parity: Partial — Lovable's executive KPI and chart styling is the target · functional parity: PermitPilot is far ahead — Lovable's executive KPIs are fabricated
- **Route decision:** Keep PP route → `/analytics` · nav: Resources group in the sidebar · deep link: n/a
- **Label to use:** Use "Analytics & Reporting" as the nav label, pointing at /analytics
- **Fake-backend risk:** High — executive charts are the easiest place to smuggle in invented numbers
- **Preserve:** Preserve every aggregate query and the weekly report export path.
- **Do not replicate:** Do not add a chart without a real query behind it.
- **Backend work:** None.
- **Frontend work:** Adopt Lovable's executive KPI band and chart card styling.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P1 · Medium · M · Phase 4 — delivery and intelligence surfaces
- **Acceptance:** Every restyled chart and KPI traces to a real aggregate query; weekly export still works.
- **Verify with:** Manual visit to /analytics with a demo account that has data; trigger export-weekly-report once
- **Owner decision needed:** No
- **Audit note:** src/App.tsx line 124.

#### L077 · Messages — `/messages`

- **Lovable:** Message threads · status Mock · backend Mock · source `src/pages/Messages.tsx`
- **PermitPilot:** Portal communications + transactional email (no message threads) · route(s) `/uci?section=communications` · exists: No — no message-thread surface · status Portal comms real; no threads
- **PP files:** src/pages/UciDashboard.tsx (communications tab); supabase/functions/send-* (12 email functions)
- **PP backend:** send-project-team-invitation; send-jurisdiction-notification; send-epermit-status-email; process-scheduled-notifications · connected: Partial
- **Match:** Backend match only (confidence High) · UI parity: Weak — no thread list UI · functional parity: Partial — real outbound messaging, no threaded inbox
- **Route decision:** Defer → `Undecided` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — an empty inbox that looks functional would cause users to miss real portal messages
- **Preserve:** Preserve all transactional email functions and per-record portal communications.
- **Do not replicate:** Do not replicate Lovable's hard-coded badge of 4. A message badge must count real unread items or not exist.
- **Backend work:** A message thread domain with participants, read state and notification fan-out.
- **Frontend work:** None until threads exist.
- **Blocked by:** Needs a messaging domain and a notification policy.
- **Priority / risk / effort / phase:** P3 · Medium · L · Backlog
- **Acceptance:** Not scoped. Requires a messaging domain.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — messaging is a significant product decision
- **Audit note:** Lovable's Messages badge of 4 is fabricated.

### Settings

#### L078 · Settings — `/settings`

- **Lovable:** User settings · status Placeholder · backend UI only · source `src/pages/Settings.tsx`
- **PermitPilot:** Settings · route(s) `/settings` · exists: Yes · status Working
- **PP files:** src/pages/Settings.tsx
- **PP backend:** Supabase queries · connected: Yes
- **Match:** Strong functional match (confidence Medium) · UI parity: Partial — Lovable's settings section layout is the target · functional parity: PermitPilot is ahead — Lovable's settings are a client-only placeholder that persists nothing
- **Route decision:** Keep PP route → `/settings` · nav: Sidebar footer plus avatar menu, as today · deep link: n/a
- **Label to use:** Keep "Settings"
- **Fake-backend risk:** Medium — do not add toggles that persist nowhere
- **Preserve:** Preserve preference persistence, theme handling (ThemeProvider) and any notification settings already wired to Supabase.
- **Do not replicate:** Do not add a settings control without a persistence path; Lovable's placeholder pattern must not be copied.
- **Backend work:** None.
- **Frontend work:** Adopt Lovable's settings section and form styling on the existing persisted fields.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P1 · Low · M · Phase 5 — admin and settings surfaces
- **Acceptance:** Every visible setting round-trips to Supabase after restyling; theme switching still works.
- **Verify with:** Manual save-and-reload of each setting on Preview
- **Owner decision needed:** No
- **Audit note:** Settings.tsx contains 16 Supabase references, so preferences genuinely persist.

### Administration

#### L079 · Admin Console — `/admin`

- **Lovable:** Admin hub · status Mock · backend Mock · source `src/pages/AdminConsole.tsx`
- **PermitPilot:** Admin Panel · route(s) `/admin` · exists: Yes · status Working
- **PP files:** src/pages/AdminPanel.tsx; src/components/admin/AdminLayout.tsx
- **PP backend:** Supabase admin queries; shadow-metrics; shadow-evaluator · connected: Yes
- **Match:** Strong functional match (confidence High) · UI parity: Partial — Lovable's admin card grid is the target styling · functional parity: PermitPilot is ahead — it has real jurisdiction admin, feature flags and shadow-mode tooling
- **Route decision:** Keep PP route → `/admin` · nav: Admin area entry; not in the main sidebar for non-admins · deep link: /admin/jurisdictions, /admin/feature-flags, /admin/shadow-mode
- **Label to use:** Keep "Admin"
- **Fake-backend risk:** Medium — the console must not link to admin surfaces that are placeholders without labelling them
- **Preserve:** Preserve AdminLayout gating and all real admin children (jurisdictions, feature flags, shadow mode).
- **Do not replicate:** Do not present placeholder admin children as live (see L080-L082).
- **Backend work:** None.
- **Frontend work:** Adopt Lovable's admin card grid; label placeholder children explicitly.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P1 · Low · M · Phase 5 — admin and settings surfaces
- **Acceptance:** Admin console restyled; real children unchanged; placeholder children visibly marked Preview.
- **Verify with:** Manual admin console smoke with an admin demo account
- **Owner decision needed:** No
- **Audit note:** src/App.tsx lines 134-158. PermitPilot's admin tree differs from Lovable's substantially.

#### L080 · Authorizations — `/admin/authorizations`

- **Lovable:** Review LOA submissions · status Working · backend Fully connected · source `src/pages/AdminAuthorizations.tsx`
- **PermitPilot:** Admin · Authorizations (Preview placeholder) · route(s) `/admin/authorizations` · exists: Yes — placeholder only · status Placeholder (labelled Preview only, PD-5)
- **PP files:** src/pages/placeholders/AdminPreviewPlaceholders.tsx
- **PP backend:** None. There is no client_authorizations table in PermitPilot. · connected: None
- **Match:** UI match only (confidence High) · UI parity: Weak — the route exists but renders a Preview notice, not a review table · functional parity: None — no authorization records exist to review
- **Route decision:** Keep PP route → `/admin/authorizations` · nav: Admin console card, visibly marked Preview · deep link: n/a
- **Label to use:** Keep "Authorizations" with an explicit Preview badge
- **Fake-backend risk:** High — Lovable's version looks fully connected (search, detail dialog, CSV export) over a table PermitPilot does not have
- **Preserve:** Preserve the explicit 'Preview only (PD-5)' integration note. It is the guard against this being mistaken for live.
- **Do not replicate:** Do not implement search, detail dialogs or CSV export here. Directive: admin LOA/members/audit are Preview placeholders in PermitPilot and are NOT fully connected despite Lovable showing them as connected.
- **Backend work:** A client_authorizations table with RLS, plus the L019 signing path, before any review UI.
- **Frontend work:** Styling of the placeholder only. No functional controls.
- **Blocked by:** Depends on L019 (LOA signing) and legal review.
- **Priority / risk / effort / phase:** P2 · High · M · Blocked — placeholder styling only until L019 is approved
- **Acceptance:** Page still renders the Preview notice; no export or detail control exists; the PD-5 note is visible.
- **Verify with:** Manual visit to /admin/authorizations; confirm the Preview note renders
- **Owner decision needed:** Yes — blocked on the same legal decision as L019
- **Audit note:** src/App.tsx line 139 uses AdminAuthorizationsPlaceholder.

#### L081 · Members — `/admin/members`

- **Lovable:** Invite/approve members · status Working · backend Fully connected · source `src/pages/AdminMembers.tsx`
- **PermitPilot:** Admin · Members (Preview placeholder over real role data) · route(s) `/admin/members` · exists: Yes — placeholder only · status Placeholder (labelled Preview only, PD-5)
- **PP files:** src/pages/placeholders/AdminPreviewPlaceholders.tsx (AdminPreviewPlaceholder)
- **PP backend:** send-project-team-invitation (real, used elsewhere); user_roles (real) · connected: None on this page
- **Match:** Backend match only (confidence High) · UI parity: Weak — Lovable has a three-tab invite/approve console; PermitPilot renders a Preview notice · functional parity: Partial — PermitPilot really does have roles and invitations, but not a workspace approval workflow
- **Route decision:** Keep PP route → `/admin/members` · nav: Admin console card, visibly marked Preview · deep link: n/a
- **Label to use:** Keep "Members" with an explicit Preview badge
- **Fake-backend risk:** High — approve/reject buttons that do not write would silently fail to grant or deny access
- **Preserve:** Preserve PermitPilot user_roles and project invites exactly as the placeholder note instructs. Do not migrate to a workspace_invitations model without an explicit decision.
- **Do not replicate:** Do not implement invite, approve or reject actions here. Directive: treat as Preview only, not live workspace approvals.
- **Backend work:** A decision first: keep user_roles + project invites, or adopt a workspace membership model. Then RLS and audit writes.
- **Frontend work:** Styling of the placeholder only. No functional controls.
- **Blocked by:** Needs a membership model decision (user_roles vs workspace_invitations).
- **Priority / risk / effort / phase:** P2 · High · M · Blocked — placeholder styling only until the membership model is decided
- **Acceptance:** Page still renders the Preview notice; no approve/reject/invite control exists; user_roles and project invites unchanged.
- **Verify with:** Manual visit to /admin/members; confirm the Preview note renders
- **Owner decision needed:** Yes — membership model decision required
- **Audit note:** src/App.tsx lines 140-148; the placeholder note explicitly says to keep user_roles and project invites until decided.

#### L082 · Audit Log — `/admin/audit`

- **Lovable:** Access audit · status Working · backend Fully connected · source `src/pages/AdminAuditLog.tsx`
- **PermitPilot:** Admin · Audit log (Preview placeholder) · route(s) `/admin/audit` · exists: Yes — placeholder only · status Placeholder (labelled Preview only, PD-5)
- **PP files:** src/pages/placeholders/AdminPreviewPlaceholders.tsx (AdminPreviewPlaceholder)
- **PP backend:** None · connected: None
- **Match:** UI match only (confidence High) · UI parity: Weak — the route exists but renders a Preview notice, not a log table · functional parity: None — nothing writes audit events yet
- **Route decision:** Keep PP route → `/admin/audit` · nav: Admin console card, visibly marked Preview · deep link: n/a
- **Label to use:** Keep "Audit log" with an explicit Preview badge
- **Fake-backend risk:** High — an empty audit log implies 'no suspicious activity' when the truth is 'nothing is being recorded'
- **Preserve:** Preserve the 'Requires access_audit_log writers before export/filter are live' note.
- **Do not replicate:** Do not implement view, filter or export here. Directive: Preview placeholder, not connected.
- **Backend work:** access_audit_log writers across auth, admin and data-access paths, then a read API with RLS.
- **Frontend work:** Styling of the placeholder only. No functional controls.
- **Blocked by:** Needs audit writers before any read surface.
- **Priority / risk / effort / phase:** P2 · High · M · Blocked — placeholder styling only until audit writers exist
- **Acceptance:** Page still renders the Preview notice; no filter or export control exists.
- **Verify with:** Manual visit to /admin/audit; confirm the Preview note renders
- **Owner decision needed:** Yes — audit scope and retention need a decision
- **Audit note:** src/App.tsx lines 149-157; the placeholder note names the missing writers.

#### L083 · Invoicing — `/admin/invoicing`

- **Lovable:** QuickBooks invoicing · status Mock · backend Mock · source `src/pages/AdminInvoicing.tsx`
- **PermitPilot:** Stripe billing (different architecture) · route(s) `Stripe-hosted checkout and customer portal (no in-app invoicing page)` · exists: No — no invoicing page · status Billing real, via Stripe
- **PP files:** supabase/functions/create-checkout; customer-portal; check-subscription; stripe-webhook
- **PP backend:** create-checkout; customer-portal; check-subscription; stripe-webhook · connected: Yes (Stripe)
- **Match:** Same purpose different architecture (confidence High) · UI parity: None — PermitPilot delegates invoice display to Stripe's customer portal · functional parity: Comparable outcome, different system: real billing exists, just not as an in-app QuickBooks view
- **Route decision:** Do not build → `Stripe customer portal` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** Use "Billing" and link to the Stripe customer portal
- **Fake-backend risk:** High — an in-app invoice list that does not reconcile with Stripe would be a financial-accuracy risk
- **Preserve:** Preserve the Stripe checkout, webhook and customer-portal flows untouched.
- **Do not replicate:** Do not build a QuickBooks invoicing page. Link to the Stripe customer portal instead.
- **Backend work:** None. A QuickBooks integration is not planned.
- **Frontend work:** None beyond a billing link, if one is missing.
- **Blocked by:** None — decision is simply to stay on Stripe.
- **Priority / risk / effort / phase:** P3 · Medium · M · Out of scope — Stripe is the billing system of record
- **Acceptance:** Billing continues to route to Stripe; no in-app invoice table exists.
- **Verify with:** Manual checkout and customer-portal smoke in Stripe test mode
- **Owner decision needed:** Yes — only if the client insists on QuickBooks
- **Audit note:** Four real Stripe functions exist; QuickBooks does not appear anywhere in the codebase.

#### L084 · Past Performance — `/admin/past-performance`

- **Lovable:** Performance history · status Mock · backend Mock · source `src/pages/AdminPastPerformance.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build. Past-performance claims are client-facing and must never be generated from mock data.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** Lovable page is mock.

#### L085 · CRM — `/admin/crm`

- **Lovable:** Client CRM · status Mock · backend Mock · source `src/pages/AdminCrm.tsx`
- **PermitPilot:** Lead capture + drip campaigns (not a CRM) · route(s) `Lead capture modal on marketing pages` · exists: No — no CRM surface · status Lead capture real; no CRM
- **PP files:** src/contexts/LeadCaptureContext.tsx; src/components/lead-capture/LeadCaptureModal.tsx; supabase/functions/admin-drip-campaigns; process-drip-emails
- **PP backend:** admin-drip-campaigns; process-drip-emails · connected: Yes (lead capture and drips)
- **Match:** Backend match only (confidence High) · UI parity: None — no CRM UI · functional parity: Weak — real lead capture and nurture emails, but no accounts, contacts, deals or pipeline
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — a CRM with no pipeline model would become a shadow system of record for client relationships
- **Preserve:** Preserve lead capture and the drip campaign functions.
- **Do not replicate:** Do not build a CRM. Directive is explicit. If CRM is needed, integrate a real CRM rather than simulating one.
- **Backend work:** A full CRM domain, or an integration with an external CRM.
- **Frontend work:** None.
- **Blocked by:** Explicit directive plus the absence of a CRM domain.
- **Priority / risk / effort / phase:** P3 · High · XL · Out of scope — explicit directive
- **Acceptance:** No CRM surface is added.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** Yes — would require a product decision to buy or build
- **Audit note:** Real drip campaign functions exist; they are marketing automation, not a CRM.

#### L086 · Milestone Billing — `/admin/milestone-billing`

- **Lovable:** Billing milestones · status Mock · backend Mock · source `src/pages/MilestoneBilling.tsx`
- **PermitPilot:** — (no PermitPilot equivalent) · route(s) `— (none)` · exists: No · status Not implemented
- **PP files:** — (none)
- **PP backend:** None · connected: None
- **Match:** Missing in PermitPilot (confidence High) · UI parity: None — no PermitPilot surface to compare · functional parity: None — no PermitPilot domain behind it
- **Route decision:** Do not build → `— (no route)` · nav: Omit from PermitPilot navigation · deep link: n/a
- **Label to use:** n/a — label not adopted
- **Fake-backend risk:** High — Lovable page is mock; replicating it would ship a convincing but empty surface
- **Preserve:** No PermitPilot logic exists on this path, so nothing to preserve.
- **Do not replicate:** Do not build. Blocked on the same billing-architecture decision as L083.
- **Backend work:** New domain model, tables, RLS and service layer would be required before any UI work.
- **Frontend work:** None. Do not build the UI ahead of a real backend.
- **Blocked by:** No PermitPilot data model; no confirmed client requirement; no owner.
- **Priority / risk / effort / phase:** P3 · Medium · L · Out of scope — deferred indefinitely
- **Acceptance:** No acceptance criteria: row is explicitly out of scope. This matrix must be updated (with an owner and a backend plan) before any work begins.
- **Verify with:** n/a — nothing to test until scope changes
- **Owner decision needed:** No — the decision is already recorded as do-not-build. Reopening it requires a matrix update naming an owner and a backend plan.
- **Audit note:** See L083: Stripe, not milestone invoicing.

#### L087 · Endpoints — `/admin/endpoints`

- **Lovable:** API endpoints registry · status Placeholder · backend UI only · source `src/pages/AdminEndpoints.tsx`
- **PermitPilot:** API Documentation · route(s) `/api-docs` · exists: Yes · status Working
- **PP files:** src/pages/APIDocumentation.tsx
- **PP backend:** None (documentation) · connected: None (static by design)
- **Match:** Partial match (confidence Medium) · UI parity: Partial — both list endpoints; PermitPilot's version is real documentation, Lovable's is a placeholder registry · functional parity: PermitPilot is ahead — its endpoint list reflects real functions
- **Route decision:** Fold into existing PP surface → `/api-docs` · nav: Documentation links; not an admin card · deep link: n/a
- **Label to use:** Keep "API docs"; do not add an "Endpoints" admin page
- **Fake-backend risk:** Low
- **Preserve:** Preserve the documented endpoint list; keep it accurate against supabase/functions and the scraper API.
- **Do not replicate:** Do not add /admin/endpoints as a second endpoint registry.
- **Backend work:** None.
- **Frontend work:** Optional styling alignment.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P3 · Low · S · Phase 7 — documentation and polish
- **Acceptance:** API docs remain accurate; no duplicate endpoint page added.
- **Verify with:** Manual visit to /api-docs
- **Owner decision needed:** No
- **Audit note:** src/App.tsx line 160.

### Demo

#### L088 · McDonald's Executive Demo — `/demo/mcdonalds`

- **Lovable:** Sales/exec demo · status Working · backend Mock · source `src/pages/DemoMcDonalds.tsx`
- **PermitPilot:** Demos · route(s) `/demos` · exists: Yes · status Working
- **PP files:** src/pages/Demos.tsx; src/components/layout/MarketingLayout.tsx
- **PP backend:** None · connected: None (marketing content)
- **Match:** Same purpose different architecture (confidence Medium) · UI parity: Weak — Lovable has a single client-branded guided tour; PermitPilot has a public demo index · functional parity: Comparable intent (sales demonstration), different structure
- **Route decision:** Fold into existing PP surface → `/demos` · nav: Marketing nav only · deep link: n/a
- **Label to use:** Keep "Demos"
- **Fake-backend risk:** Medium — clearly-labelled demo content is acceptable; unlabelled client-branded data is not
- **Preserve:** Preserve the public marketing demo index and its labelling.
- **Do not replicate:** Do not create a client-branded demo (Lovable uses a real quick-service-restaurant brand) without written approval, and never present demo figures as production data.
- **Backend work:** None.
- **Frontend work:** Optionally adopt Lovable's guided-tour spotlight pattern on /demos, with every screen labelled as a demo.
- **Blocked by:** Brand usage approval for any named-client demo.
- **Priority / risk / effort / phase:** P2 · Low · S · Phase 2 — public / marketing shell
- **Acceptance:** Demo content is visibly labelled as a demo; no unapproved client brand appears.
- **Verify with:** Manual visit to /demos
- **Owner decision needed:** Yes — brand usage approval needed for any named-client demo
- **Audit note:** Lovable's demo is branded and signed-in; PermitPilot's is public and generic.

### Internal

#### L089 · Architecture Inventory (this page) — `/architecture-inventory`

- **Lovable:** Internal architecture reference · status Working · backend UI only · source `src/pages/ArchitectureInventory.tsx`
- **PermitPilot:** This matrix (repo documentation) + /mvp-documentation · route(s) `reference/lovable-ui/lovable-permitpilot-architecture-matrix.md; /mvp-documentation` · exists: Partial — documentation lives in the repo, not as an app route · status Working (this document)
- **PP files:** reference/lovable-ui/lovable-permitpilot-architecture-matrix.md; scripts/generate-lovable-permitpilot-matrix.py
- **PP backend:** None · connected: n/a
- **Match:** Same purpose different architecture (confidence High) · UI parity: None — PermitPilot keeps architecture documentation out of the shipped app · functional parity: Comparable — same inventory purpose, delivered as repo docs plus CSV instead of a page
- **Route decision:** Do not build → `— (repo documentation)` · nav: Not in application navigation · deep link: n/a
- **Label to use:** Refer to it as the "Lovable ↔ PermitPilot architecture matrix"
- **Fake-backend risk:** None
- **Preserve:** Preserve this matrix as the source of truth: no status change without updating it.
- **Do not replicate:** Do not ship an in-app architecture inventory page. Documentation that lives in the app drifts from the code; documentation next to the code does not.
- **Backend work:** None.
- **Frontend work:** None.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P3 · Low · S · Phase 0 — this document
- **Acceptance:** Matrix and CSV exist, cover all 90 Lovable rows, and are regenerated by the script whenever decisions change.
- **Verify with:** python3 scripts/generate-lovable-permitpilot-matrix.py (idempotent regeneration)
- **Owner decision needed:** No
- **Audit note:** This row is self-referential: the Lovable inventory page is replaced by this repo matrix.

#### L090 · Unmatched → /dashboard — `*`

- **Lovable:** 404 fallback · status Working · backend UI only · source `src/App.tsx`
- **PermitPilot:** NotFound (true 404) · route(s) `*` · exists: Yes · status Working
- **PP files:** src/pages/NotFound.tsx; src/App.tsx line 189
- **PP backend:** None · connected: n/a
- **Match:** Same purpose different architecture (confidence High) · UI parity: Weak — Lovable redirects to /dashboard, PermitPilot renders a 404 page · functional parity: PermitPilot is better — it surfaces broken links instead of hiding them
- **Route decision:** Keep PP route → `* → NotFound` · nav: n/a · deep link: n/a
- **Label to use:** Keep "Page not found"
- **Fake-backend risk:** None
- **Preserve:** Preserve the true 404 page.
- **Do not replicate:** Do not adopt Lovable's redirect-to-dashboard fallback. Lovable's own inventory admits it 'masks true 404s', which hides broken links and typo'd routes from both users and monitoring.
- **Backend work:** None.
- **Frontend work:** Optionally restyle the 404 page to match the Lovable visual language.
- **Blocked by:** None.
- **Priority / risk / effort / phase:** P1 · Low · S · Phase 1 — foundation / auth surfaces
- **Acceptance:** An unmatched URL renders the 404 page, not a dashboard redirect.
- **Verify with:** Visit /this-route-does-not-exist and confirm a 404 renders
- **Owner decision needed:** No
- **Audit note:** Deliberate divergence where PermitPilot's behavior is correct and Lovable's is not.

## PermitPilot-only surfaces (no Lovable equivalent)

These are real PermitPilot capabilities that Lovable does not model at all. They are listed because the
main risk in a visual replication project is deleting or bypassing something the reference does not show.
Every row here must survive the replication unchanged in behavior.

| ID | Surface | Route / Location | Status | Backend | Why it has no Lovable row | Decision | Pri | Risk |
|---|---|---|---|---|---|---|---|---|
| PP01 | Auth (unified) | `/auth` | Working | Supabase auth; send-welcome-email | Lovable splits sign-in and sign-up into two pages. PermitPilot's single Auth page with a view switch is the canonical entry. | Preserve as-is. Style only. | P1 | Low |
| PP02 | Pricing | `/pricing` | Working | create-checkout; check-subscription | Lovable has no pricing or self-serve purchase surface at all. | Preserve. Style within the marketing phase. | P2 | Low |
| PP03 | FAQ | `/faq` | Working | None | Public FAQ; no Lovable counterpart. | Preserve. Style within the marketing phase. | P3 | Low |
| PP04 | Install (PWA) | `/install` | Working | Service worker / PWA manifest | PermitPilot ships a real installable PWA plus Capacitor config; Lovable has mobile mock pages instead. | Preserve. Do not replace with Lovable's mock mobile pages. | P2 | Low |
| PP05 | Client Portal (tokenised) | `/portal/:token` | Working | Supabase token validation | Token-scoped external client view. Lovable has no external sharing model. | Preserve exactly. Token scoping is a security boundary — no styling change may widen data exposure. | P1 | High |
| PP06 | Embed Widget | `/embed/:token` | Working | Supabase token validation | Embeddable tokenised widget for client sites. No Lovable equivalent. | Preserve exactly. Same security boundary as PP05. | P1 | High |
| PP07 | Invite Accept | `/invite/:token` | Working | send-project-team-invitation; Supabase invite validation | Real project team invitation acceptance. Lovable's Members console implies invitations but has a different model. | Preserve. Directive: keep PermitPilot invites. Relevant to the L081 membership decision. | P1 | Medium |
| PP08 | Permit Intelligence | `/permit-intelligence` | Working | shovels-api; property-intelligence-agent | Real third-party permit history and property intelligence. Lovable has no equivalent. | Preserve. Style in Phase 4. Consider it the real answer to Lovable's Feasibility pages (L017/L018). | P1 | Medium |
| PP09 | ROI Calculator | `/roi-calculator` | Working | None (client-side model) | Sales calculator with no Lovable counterpart. | Preserve. Style in the marketing phase. | P3 | Low |
| PP10 | Consolidation Calculator | `/consolidation-calculator` | Working | None (client-side model) | Portfolio consolidation modelling; no Lovable counterpart. | Preserve. Style in the marketing phase. | P3 | Low |
| PP11 | State Landing Pages | `/jurisdictions/:stateCode` | Working | Supabase jurisdiction data; territory datasets | Per-state SEO and jurisdiction detail pages. Lovable has no dynamic jurisdiction routing. | Preserve. Do not collapse into the map page. | P2 | Medium |
| PP12 | Comment Review | `/comment-review` | Working | parse-permit-comments; parse-manual-comment-letter; comment-parser-agent | Real comment letter ingestion and review. Lovable's Response Matrix assumes comments already exist. | Preserve. It is the upstream half of L023 and must be styled alongside it. | P0 | Medium |
| PP13 | Classified Comments | `/classified-comments` | Working | discipline-classifier-agent; permit-classifier-agent | Real discipline classification output. No Lovable counterpart. | Preserve. Style alongside L023. | P1 | Medium |
| PP14 | Admin · Jurisdictions | `/admin/jurisdictions` | Working | Supabase jurisdiction tables | Real jurisdiction configuration admin. Lovable's admin tree has nothing comparable. | Preserve. Style in Phase 5. | P1 | Medium |
| PP15 | Admin · Feature Flags | `/admin/feature-flags` | Working | Supabase feature flag tables | Real runtime feature flagging. No Lovable counterpart. | Preserve. Useful for gating any risky Lovable UI behind a flag. | P1 | Medium |
| PP16 | Admin · Shadow Mode | `/admin/shadow-mode` | Working | shadow-evaluator; shadow-metrics; circuit-breaker-check | Real shadow evaluation and circuit-breaker telemetry for the automation pipeline. No Lovable counterpart. | Preserve untouched. This is production safety tooling. | P1 | High |
| PP17 | Design System Preview | `/design-system-preview` | Working | None | Internal token and component preview. No Lovable counterpart. | Preserve and use it as the reference surface for Lovable token alignment before touching product pages. | P0 | Low |
| PP18 | Baltimore Accela portal clone | `/baltimore, /baltimore/permits, /baltimore/records, /baltimore/records/:recordId` | Mock (labelled UI-only clone) | None — deliberately mock | A deliberate UI reference clone of a real jurisdiction portal, used for scraper and portal-parity work. | Preserve as an explicitly labelled mock. Do not restyle into something that looks like live Baltimore data. | P3 | Medium |
| PP19 | Live utility scraper service | `scraper-service HTTP API (/api/uci and others)` | Working | Node scraper service on Railway | The real data engine behind UCI and portal harvest. Lovable has no backend at all. | Preserve. Any scraper change deploys to Railway development only, never production, and never as part of a styling change. | P0 | High |
| PP20 | Utility territory dataset (19 states) | `scraper-service/data/territory/electric-full-v2/*` | Working | Generated and validated datasets | Real service-territory geometry with reconciliation and validation reports. Lovable's coverage matrix is static reference text. | Preserve. All coverage claims must trace to the validation reports. | P1 | Medium |
| PP21 | Document ingestion worker | `document-ingestion-worker/` | Working | Worker + edge function | Real asynchronous document ingestion. Lovable's Document Vault is a mock browser. | Preserve. Any document UI must go through this pipeline. | P1 | Medium |
| PP22 | Grounded response generation | `supabase/functions/generate-grounded-response` | Working | Edge functions with citation grounding | Real citation-grounded response drafting behind L023. Lovable's Response Matrix has no generation backend. | Preserve exactly. Response text must always come from these functions so citations stay verifiable. | P0 | High |
| PP23 | Scheduled reporting and notification layer | `supabase/functions/process-scheduled-*` | Working | Scheduled edge functions | Real recurring delivery of reports and reminders. Lovable has no scheduling layer. | Preserve. Do not touch schedules or triggers during UI work. | P1 | High |
| PP24 | Stripe billing | `Stripe checkout and customer portal` | Working | Stripe + webhook | Real payment processing. Lovable shows a mock QuickBooks invoicing page instead (see L083). | Preserve. Stripe remains the billing system of record. | P1 | High |
| PP25 | Theme system and command palette | `Global` | Working | None | Dark mode plus a keyboard command palette that already deep-links into UCI sections. Lovable has neither. | Preserve. Command palette entries must stay in sync with the route decisions in this matrix. | P1 | Low |

Source files for each: **PP01** `src/pages/Auth.tsx`; **PP02** `src/pages/Pricing.tsx`; **PP03** `src/pages/FAQ.tsx`; **PP04** `src/pages/Install.tsx; src/components/pwa/InstallPrompt.tsx`; **PP05** `src/pages/ClientPortal.tsx`; **PP06** `src/pages/EmbedWidget.tsx`; **PP07** `src/pages/InviteAccept.tsx`; **PP08** `src/pages/PermitIntelligence.tsx`; **PP09** `src/pages/ROICalculator.tsx`; **PP10** `src/pages/ConsolidationCalculator.tsx`; **PP11** `src/pages/StateLandingPage.tsx`; **PP12** `src/pages/CommentReview.tsx`; **PP13** `src/pages/ClassifiedComments.tsx`; **PP14** `src/pages/JurisdictionAdmin.tsx`; **PP15** `src/pages/FeatureFlagsAdmin.tsx`; **PP16** `src/pages/ShadowModeDashboard.tsx`; **PP17** `src/pages/EpermitDesignSystemPreview.tsx`; **PP18** `src/pages/baltimore/*; src/components/portal/AccelaProjectView.tsx`; **PP19** `scraper-service/app/routes/*; scraper-service/app/services/uci/*`; **PP20** `territories_*.geojson; county_utility.json; footprint_validation_report.json`; **PP21** `document-ingestion-worker/*; supabase/functions/ingest-project-document`; **PP22** `generate-grounded-response; context-reference-engine; generate-response; export-response-package`; **PP23** `process-scheduled-checklist-reports; process-scheduled-notifications; send-deadline-reminders; retry-failed-report-emails; export-weekly-report`; **PP24** `create-checkout; customer-portal; check-subscription; stripe-webhook`; **PP25** `src/hooks/useTheme.tsx; src/components/navigation/CommandPalette.tsx`.

## Gap summary

### 1. Where PermitPilot is already ahead

The headline finding of this audit is that the gap runs in both directions, and mostly in PermitPilot's
favour on substance. Lovable has 65 mock pages and 8 backend-connected ones. PermitPilot has 52 Supabase
edge functions, a live scraper service, a document ingestion worker, validated utility territory data for
19 states, Stripe billing and a shadow-evaluation safety layer — none of which appears in Lovable at all.
On 8 rows PermitPilot has the real backend and Lovable has only the screen: L027 (AI Workflow), L032 (Internal Prescreen), L033 (Agent Center), L034 (Document Vault), L054 (Inspector Release Tracker), L077 (Messages), L081 (Members), L085 (CRM).

### 2. Where Lovable is genuinely ahead

Lovable's advantage is visual and organisational, not functional: card and table density, KPI band
styling, status chips, the expandable UCI navigation vocabulary, and consistent page chrome. Those are
exactly the things this replication should take. It is also ahead on a handful of *structural* ideas
worth adopting independently of styling — a real project detail route (L012) and a cross-project filing
queue (L015).

### 3. Fake-backend risk register

41 rows carry High fake-backend risk — the surface would look authoritative while showing
nothing real. These are the rows most likely to cause damage if implemented enthusiastically.

| ID | Surface | Why the risk is High | Decision |
|---|---|---|---|
| L005 | Dashboard (layout) | High — the Lovable KPI values are invented; every restyled tile must bind to a real PermitPilot query or be omitted | Keep PP route |
| L006 | Dashboard · Operations | High — Lovable explicitly marks this data fabricated | Fold into existing PP surface |
| L009 | New Project (Portal Credentials) | High — a standalone credential page that does not actually encrypt and validate would be a security-relevant fake | Fold into existing PP surface |
| L013 | Mission Control | High — this is the single most convincing fake surface in the Lovable app; it would look authoritative while showing nothing real | Do not build |
| L014 | Command Center | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L015 | Permit Queue | High — the obvious temptation is to fill the placeholder with Lovable's mock rows | Keep PP route |
| L016 | Critical Path | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L019 | Client Authorization (LOA) | High — a signature UI that does not produce a stored, retrievable legal artifact is the worst possible fake | Defer |
| L020 | Client Authorization (LOA) | High — duplicate routes over legal artifacts invite divergent behavior | Do not build |
| L022 | Permit Filing (Guided Flow) | High — this surface performs real submissions; a cosmetic rebuild that bypasses preflight could file incorrectly | Keep PP route |
| L026 | Unified Matrix | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L027 | AI Workflow | High — lanes with no run data would be pure decoration | Defer |
| L028 | Raze Permit | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L033 | Agent Center | High — a registry showing 'healthy' without real telemetry would actively mislead | Defer |
| L035 | Content Studio | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L043 | UCI · Miss Utility 811 | High — must stay a labelled coming-soon panel, never a mock data table | Do not build |
| L044 | UCI · Knowledge Graph | High — must stay a labelled coming-soon panel, never a mock data table | Do not build |
| L048 | Cross-Utility Conflict Hunter | High — must stay a labelled coming-soon panel, never a mock data table | Do not build |
| L049 | Easement / ROW Manager | High — must stay a labelled coming-soon panel, never a mock data table | Do not build |
| L052 | Long-Lead Equipment | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L053 | Predictive Schedule Impact | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L055 | Special Inspections | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L056 | Final CO Inspections | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L057 | SIR | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L058 | SIR Workspace | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L059 | SIR Annex | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L060 | SIR Executive | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L061 | SIR Sync | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L062 | Field Studio | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L063 | Mobile Survey | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L064 | Mobile Camera | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L065 | Mobile Map | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L076 | Analytics & Reporting | High — executive charts are the easiest place to smuggle in invented numbers | Keep PP route |
| L077 | Messages | High — an empty inbox that looks functional would cause users to miss real portal messages | Defer |
| L080 | Authorizations | High — Lovable's version looks fully connected (search, detail dialog, CSV export) over a table PermitPilot does not have | Keep PP route |
| L081 | Members | High — approve/reject buttons that do not write would silently fail to grant or deny access | Keep PP route |
| L082 | Audit Log | High — an empty audit log implies 'no suspicious activity' when the truth is 'nothing is being recorded' | Keep PP route |
| L083 | Invoicing | High — an in-app invoice list that does not reconcile with Stripe would be a financial-accuracy risk | Do not build |
| L084 | Past Performance | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |
| L085 | CRM | High — a CRM with no pipeline model would become a shadow system of record for client relationships | Do not build |
| L086 | Milestone Billing | High — Lovable page is mock; replicating it would ship a convincing but empty surface | Do not build |

### 4. Explicitly do-not-build

30 rows must not be built. Three are direct user directives (Mission Control, CRM, the
SIR/Field mobile pack); the rest are duplicates, or domains with no PermitPilot data model.

| ID | Surface | Reason |
|---|---|---|
| L013 | Mission Control | Do not build. Directive: 'Do NOT replicate as fake backends: Mission Control page'. The real rollup path is the /dashboard and /uci hubs over live project data. |
| L014 | Command Center | Do not build. Fold any executive framing into /dashboard (L005) instead. |
| L016 | Critical Path | Do not build. Depends on the same scheduling domain as L010/L011, which does not exist. |
| L020 | Client Authorization (LOA) | Do not build. One canonical LOA route only, if and when L019 is approved. |
| L025 | Master Matrix | Do not build. /response-matrix and /permit-wizard-filing are already first-class sidebar entries. |
| L026 | Unified Matrix | Do not build. Blocked on the task domain that L021 also requires. |
| L028 | Raze Permit | Do not build. If demolition permits become a requirement, extend the existing permit application domain rather than adding a separate page. |
| L035 | Content Studio | Do not build. Lovable's Content Studio is a UI-only placeholder with local state. |
| L043 | UCI · Miss Utility 811 | Do not build an 811 ticket table. There is no PermitPilot backend for Miss Utility tickets, and 811 is a regulated notification process — a fake ticket UI could imply a locate request was filed when it was not. |
| L044 | UCI · Knowledge Graph | Do not build a graph explorer. PermitPilot has no graph or node storage; every edge would be invented. |
| L048 | Cross-Utility Conflict Hunter | Do not build. A conflict detector that reports 'no conflicts' without analysing anything is actively dangerous on a utility coordination platform. |
| L049 | Easement / ROW Manager | Do not build. Easements are legal instruments; a tracker with no records could imply rights that were never secured. |
| L052 | Long-Lead Equipment | Do not build. Long-lead equipment tracking needs a procurement domain PermitPilot does not have. |
| L053 | Predictive Schedule Impact | Do not build. A predictive model with no inputs would output invented risk. |
| L055 | Special Inspections | Do not build. Blocked on the same inspection state model as L054. |
| L056 | Final CO Inspections | Do not build. Blocked on the same inspection state model as L054. |
| L057 | SIR | Do not build the SIR landing. Explicitly out of scope. Directive: 'Do NOT replicate as fake backends: ... SIR/Field mobile packs'. PermitPilot has no site-investigation domain, no offline sync and no field evidence storage. |
| L058 | SIR Workspace | Do not build the SIR workspace. Explicitly out of scope. Directive: 'Do NOT replicate as fake backends: ... SIR/Field mobile packs'. PermitPilot has no site-investigation domain, no offline sync and no field evidence storage. |
| L059 | SIR Annex | Do not build the SIR annex. Explicitly out of scope. Directive: 'Do NOT replicate as fake backends: ... SIR/Field mobile packs'. PermitPilot has no site-investigation domain, no offline sync and no field evidence storage. |
| L060 | SIR Executive | Do not build the SIR executive rollup. Explicitly out of scope. Directive: 'Do NOT replicate as fake backends: ... SIR/Field mobile packs'. PermitPilot has no site-investigation domain, no offline sync and no field evidence storage. |
| L061 | SIR Sync | Do not build the SIR sync. Explicitly out of scope. Directive: 'Do NOT replicate as fake backends: ... SIR/Field mobile packs'. PermitPilot has no site-investigation domain, no offline sync and no field evidence storage. |
| L062 | Field Studio | Do not build. Part of the excluded SIR/Field mobile pack. |
| L063 | Mobile Survey | Do not build. Part of the excluded field mobile pack; Lovable's version keeps entries in local state only. |
| L064 | Mobile Camera | Do not build. Lovable's camera page persists nothing; capturing photos with no storage would silently lose evidence. |
| L065 | Mobile Map | Do not build a mobile-only map. Make /jurisdictions/map responsive instead (covered by L046). |
| L083 | Invoicing | Do not build a QuickBooks invoicing page. Link to the Stripe customer portal instead. |
| L084 | Past Performance | Do not build. Past-performance claims are client-facing and must never be generated from mock data. |
| L085 | CRM | Do not build a CRM. Directive is explicit. If CRM is needed, integrate a real CRM rather than simulating one. |
| L086 | Milestone Billing | Do not build. Blocked on the same billing-architecture decision as L083. |
| L089 | Architecture Inventory (this page) | Do not ship an in-app architecture inventory page. Documentation that lives in the app drifts from the code; documentation next to the code does not. |

### 5. Routing decisions that must not drift

PermitPilot deliberately has fewer routes than Lovable. Three patterns carry that difference:

- **UCI deep links, not routes (8 rows).** Lovable exposes nine `/uci/*` pages. PermitPilot has
  one `/uci` hub with `?section=` deep links defined in `src/lib/uciNavSections.ts`, resolving to hub anchors,
  coordination-drawer tabs, external navigation, or labelled coming-soon panels. Do not add `/uci/*` routes.
- **Folding, not adding (11 rows).** Lovable's landing-page-plus-detail-page pairs collapse into single
  PermitPilot pages (`/code-compliance` absorbs both L029 and L031; `/api-docs` absorbs L087).
- **Two places PermitPilot is deliberately different and better.** L007: no `/dashboard/uci`, because
  Lovable's own inventory admits that copy bypasses its UCI role gate. L090: a true 404 page instead of a
  redirect to `/dashboard`, because Lovable's fallback masks broken links.

### 6. Placeholders that must stay labelled

3 rows are UI-match-only: the PermitPilot route exists but renders an explicitly labelled
placeholder. Lovable shows these as fully connected, which is the trap. The admin trio in particular
(L080 Authorizations, L081 Members, L082 Audit log) appears complete in Lovable — with search, approve
and reject actions, detail dialogs and CSV export — while PermitPilot renders `AdminPreviewPlaceholder`
with a PD-5 note. Implementing those controls without the backing tables would produce buttons that
silently do nothing on access control and audit trails.

| ID | Surface | PP reality | Missing backend |
|---|---|---|---|
| L015 | Permit Queue | Placeholder (labelled) | Build a cross-project filing queue query over permit_applications with real status and owner fields. |
| L080 | Authorizations | Placeholder (labelled Preview only, PD-5) | A client_authorizations table with RLS, plus the L019 signing path, before any review UI. |
| L082 | Audit Log | Placeholder (labelled Preview only, PD-5) | access_audit_log writers across auth, admin and data-access paths, then a read API with RLS. |

### 7. Missing domains, grouped

41 rows have no PermitPilot equivalent. They cluster into a small number of absent domains,
which is more useful than the row count suggests:

- **Scheduling / critical path** (L010, L011, L016, L053): no milestone, duration or dependency model.
- **Task and board management** (L021, L026): no task, group or assignment model.
- **Site investigation and field capture** (L057–L065): no field evidence domain; excluded by directive.
- **Closeout and post-mortem** (L066–L071): no closeout state, archive or retrospective records.
- **Inspections** (L054–L056): reminders exist; inspection release state does not.
- **Legal artifacts** (L019, L020, L049): LOA signing and easements need legal review before any schema.
- **Financial** (L083, L084, L086): PermitPilot bills through Stripe; QuickBooks and milestone billing are not planned.
- **Aggregate dashboards over nothing** (L013, L014, L025, L030): duplicate or unsourced rollups.

### 8. Naming and label decisions

Where the client expects a Lovable label, keep the label and point it at the PermitPilot route. The
mapping is: Permit Filing → `/permit-wizard-filing`, Portal Harvest → `/portal-data`, Response Matrix →
`/response-matrix`, Analytics & Reporting → `/analytics`, Code Analyzer → a section of `/code-compliance`,
Provider Map → `/jurisdictions/map`. Labels PermitPilot should *not* adopt: DesignCheck (prefer Code
Compliance), Platform Architecture and Architecture Inventory (documentation lives in the repo),
AI Workflow (prefer Agent runs, if ever built).

### 9. Decisions needed from the product owner

34 rows cannot be scoped without a human decision. Nothing below should be started until the
decision is recorded in this matrix.

| ID | Surface | Decision needed |
|---|---|---|
| L010 | Project Timeline | Yes — needs a product decision on whether PermitPilot should own this domain |
| L011 | Project Gantt | Yes — needs a product decision on whether PermitPilot should own this domain |
| L015 | Permit Queue | Yes — queue scope needs a product definition |
| L017 | Feasibility | Yes — needs a product decision on whether PermitPilot should own this domain |
| L018 | Site Feasibility | Yes — needs a product decision on whether PermitPilot should own this domain |
| L019 | Client Authorization (LOA) | Yes — legal and product sign-off required for e-signature capture |
| L021 | Operations Board | Yes — needs a product decision on whether PermitPilot should own this domain |
| L022 | Permit Filing (Guided Flow) | Yes — approval required before any live submission test |
| L027 | AI Workflow | Yes — needs a product decision on whether PermitPilot should own this domain |
| L030 | Compliance Intelligence | Yes — needs a product decision on whether PermitPilot should own this domain |
| L032 | Internal Prescreen | Yes — needs a product decision on whether PermitPilot should own this domain |
| L033 | Agent Center | Yes — needs a product decision on whether PermitPilot should own this domain |
| L034 | Document Vault | Yes — cross-project document visibility is a permissions decision |
| L041 | UCI · CIAC & Refunds | Yes — a refund-window model needs a product decision |
| L043 | UCI · Miss Utility 811 | Yes — regulated process; needs explicit approval |
| L044 | UCI · Knowledge Graph | Yes |
| L047 | Provider Compare | Yes — confirm whether the client wants jurisdiction or provider comparison |
| L048 | Cross-Utility Conflict Hunter | Yes |
| L049 | Easement / ROW Manager | Yes |
| L051 | Meter Set Choreographer | Yes — sequencing scope needs a product decision |
| L054 | Inspector Release Tracker | Yes — needs a product decision on whether PermitPilot should own this domain |
| L066 | Closeout | Yes — needs a product decision on whether PermitPilot should own this domain |
| L067 | Closeout Archive | Yes — needs a product decision on whether PermitPilot should own this domain |
| L068 | Closeout Tracker | Yes — needs a product decision on whether PermitPilot should own this domain |
| L069 | Post-Mortem | Yes — needs a product decision on whether PermitPilot should own this domain |
| L070 | Post-Mortem Analytics | Yes — needs a product decision on whether PermitPilot should own this domain |
| L071 | Post-Mortem Financial | Yes — needs a product decision on whether PermitPilot should own this domain |
| L077 | Messages | Yes — messaging is a significant product decision |
| L080 | Authorizations | Yes — blocked on the same legal decision as L019 |
| L081 | Members | Yes — membership model decision required |
| L082 | Audit Log | Yes — audit scope and retention need a decision |
| L083 | Invoicing | Yes — only if the client insists on QuickBooks |
| L085 | CRM | Yes — would require a product decision to buy or build |
| L088 | McDonald's Executive Demo | Yes — brand usage approval needed for any named-client demo |

### 10. Shared-environment constraints

Railway `development` currently shares the production Supabase project, so verification must use demo
accounts only, and no destructive action or live utility submission may run without explicit approval.
This directly constrains L022 (permit filing performs real portal submissions — preflight only during
verification), L024 (scraper runs), and L083/PP24 (Stripe — test mode only).

## Controlled route-by-route execution plan

Sequenced so that each phase de-risks the next. Every phase ends with the same gate, taken from the
workspace phase-completion rule.

### Standing rules for every phase

1. Work only on `feat/lovable-ui-replication`. Never commit this work to `main`, and never merge without explicit human approval.
2. Visual alignment only. No backend, auth, schema, RLS, scraper-behavior or UCI-contract change without explicit approval. No migrations.
3. No mock data on production paths. If a restyled element has no real query behind it, remove the element rather than fake the data.
4. Update this matrix in the same commit as the code change. Regenerate with `python3 scripts/generate-lovable-permitpilot-matrix.py`.
5. Phase gate before moving on: run tests, build and typecheck; smoke-test the affected routes; confirm no control or option was lost versus current PermitPilot behavior; commit; push the feature branch; report the Vercel Preview URL. Deploy Railway `development` only if a backend or scraper change was genuinely required — and never Railway `production`.

### Phase 0 — this document (complete)

Produce the matrix and CSV. No application code touched. Row L089 covers this phase.

### Phase 1 — foundation and auth

Start here because these routes are small, high-traffic, and settle the design tokens every later phase
inherits. Align tokens on `/design-system-preview` (PP17) **first**, so that later restyles are token
changes rather than per-page overrides.

| ID | Surface | Target route | Decision | Effort | Risk |
|---|---|---|---|---|---|
| L002 | Login | /auth (alias /login already in place) | Alias to PP route | S | Low |
| L003 | Sign up | /auth (alias /signup already in place) | Alias to PP route | S | Low |
| L090 | Unmatched → /dashboard | * → NotFound | Keep PP route | S | Low |

Gate: sign-in, sign-up and rejected-member paths all verified on Preview with a demo account; an unmatched
URL still renders a 404 rather than redirecting.

### Phase 2 — public and marketing shell

Lowest-risk product surfaces: no authenticated data, so a styling mistake cannot expose or lose anything.

| ID | Surface | Target route | Decision | Effort | Risk |
|---|---|---|---|---|---|
| L001 | Home | / | Keep PP route | S | Low |
| L004 | Contact | /contact | Keep PP route | S | Low |
| L088 | McDonald's Executive Demo | /demos | Fold into existing PP surface | S | Low |

Gate: contact submission still writes a row and sends its email; demo content stays labelled as demo.

### Phase 3 — core authenticated surfaces (the real payoff)

These are the P0 rows: real PermitPilot data, no contract change, maximum visible improvement.
**Start with L023 (Response Matrix).** It is the recommended first implementation row — it is backed by
real parsed comments and grounded response generation, needs no route change, and its table and status-chip
patterns are reused by almost every later surface. Style `/comment-review` (PP12) and `/classified-comments`
(PP13) alongside it, since they are the upstream half of the same workflow.

| ID | Surface | Target route | Decision | Effort | Risk |
|---|---|---|---|---|---|
| L005 | Dashboard (layout) | /dashboard | Keep PP route | M | Medium |
| L006 | Dashboard · Operations | /dashboard | Fold into existing PP surface | S | Low |
| L007 | Dashboard · UCI | /uci | Fold into existing PP surface | S | Low |
| L008 | Projects | /projects | Keep PP route | M | Low |
| L023 | Response Matrix | /response-matrix | Keep PP route | M | Low |
| L037 | UCI Hub | /uci | Keep PP route | M | Medium |
| L038 | UCI · Submissions | /uci?section=submissions | Deep link (query param) | S | Low |
| L039 | UCI · Inbox / Communications | /uci?section=communications | Deep link (query param) | S | Low |
| L040 | UCI · Class of Service | /uci?section=class-of-service | Deep link (query param) | S | Low |
| L045 | UCI Application Builder | /uci?section=application-builder | Deep link (query param) | S | Medium |
| L050 | Load Profile Analyzer | /uci?section=load-profile | Deep link (query param) | S | Low |

Gate: all UCI vitest suites pass; every KPI and table column traces to a real query; no `/uci/*` or
`/dashboard/*` child route was added.

### Phase 4 — delivery and intelligence

Higher risk, because L022 performs real portal submissions and L024 reflects live scraper state. Do these
only after Phase 3 has settled the component patterns.

| ID | Surface | Target route | Decision | Effort | Risk |
|---|---|---|---|---|---|
| L022 | Permit Filing (Guided Flow) | /permit-wizard-filing | Keep PP route | M | High |
| L024 | Portal Harvest | /portal-data | Keep PP route | M | Medium |
| L029 | DesignCheck (Compliance) | /code-compliance | Fold into existing PP surface | M | Low |
| L031 | Code Analyzer | /code-compliance | Fold into existing PP surface | M | Medium |
| L041 | UCI · CIAC & Refunds | /uci?section=ciac | Deep link (query param) | S | Low |
| L042 | UCI · Energization | /uci?section=energization | Deep link (query param) | S | Low |
| L046 | Jurisdiction Map | /jurisdictions/map | Keep PP route | M | Medium |
| L047 | Provider Compare | /jurisdictions/compare | Fold into existing PP surface | M | Medium |
| L072 | Checklists | /checklists | Keep PP route | M | Low |
| L076 | Analytics & Reporting | /analytics | Keep PP route | M | Medium |

Gate: permit filing preflight still runs before execute and no step was reordered or removed; **no live
utility submission was triggered during verification**; scraper contract unchanged.

### Phase 5 — admin and settings

The trap phase. Lovable shows Authorizations, Members and Audit log as fully connected; PermitPilot's are
Preview placeholders. Style the placeholders, keep the PD-5 notes visible, and add no functional controls.

| ID | Surface | Target route | Decision | Effort | Risk |
|---|---|---|---|---|---|
| L009 | New Project (Portal Credentials) | /projects (StartFilingDialog) | Fold into existing PP surface | M | Medium |
| L073 | Reference Library | /code-reference | Fold into existing PP surface | S | Low |
| L078 | Settings | /settings | Keep PP route | M | Low |
| L079 | Admin Console | /admin | Keep PP route | M | Low |
| L080 | Authorizations | /admin/authorizations | Keep PP route | M | High |
| L081 | Members | /admin/members | Keep PP route | M | High |
| L082 | Audit Log | /admin/audit | Keep PP route | M | High |

Gate: no approve, reject, invite, filter or export control exists on any placeholder admin page; every
setting still round-trips to Supabase; `user_roles` and project invites untouched.

### Phase 6 — structural follow-ups (needs approval)

These add genuine structure rather than styling, so each needs sign-off before it starts.

| ID | Surface | Target route | Decision | Effort | Risk |
|---|---|---|---|---|---|
| L012 | Project Workspace (Alpha) | /projects/:id (proposed, not yet built) | Add PP route | M | Medium |
| L015 | Permit Queue | /permit-queue | Keep PP route | M | Medium |
| L074 | Utility Coverage | /jurisdictions/map (coverage table as a panel) | Fold into existing PP surface | M | Medium |

Gate: each item approved individually; no hard-coded record ids anywhere; coverage claims trace to the
territory validation reports.

### Phase 7 — documentation and polish

| ID | Surface | Target route | Decision | Effort | Risk |
|---|---|---|---|---|---|
| L036 | Platform Architecture | /mvp-documentation | Fold into existing PP surface | S | Low |
| L075 | Glossary | /reference/glossary | Keep PP route | S | Low |
| L087 | Endpoints | /api-docs | Fold into existing PP surface | S | Low |

Gate: no documentation content lost; the glossary either has real terms or stays an explicit placeholder.

### Never / blocked

Rows in the out-of-scope and backlog phases are not scheduled. Building any of them requires a product
owner decision recorded in this matrix first. The strongest prohibitions, restated because they are the
ones most likely to be violated by an enthusiastic implementer:

- **Mission Control (L013)** — do not build. The real rollups are `/dashboard` and `/uci`.
- **CRM (L085)** — do not build. Lead capture and drip campaigns are marketing automation, not a CRM.
- **SIR and Field mobile pack (L057–L065)** — do not build. No field evidence domain exists.
- **Admin Authorizations / Members / Audit log (L080–L082)** — placeholder styling only.
- **UCI coming-soon sections (L043, L044, L048, L049)** — must remain labelled panels, never mock tables.

### First commit, concretely

If you are picking this up cold: align tokens on `/design-system-preview`, then restyle `/response-matrix`
(L023) with no route, query or edge-function change, verify a comment-to-response round trip on a demo
project, update L023's row in the generator script to record what shipped, regenerate this matrix, and
commit both to `feat/lovable-ui-replication`.

