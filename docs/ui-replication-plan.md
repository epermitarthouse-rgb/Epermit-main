# UI Replication Plan — Lovable Visual → PermitPilot Runtime

> Date: 2026-07-21  
> Companion: `docs/lovable-vs-current-gap-analysis.md`, `docs/ui-route-component-mapping.json`  
> Guardrails: `docs/ui-replication-constraints.md`  
> Rule: **documentation / planning only** in this audit phase — no app code, deploys, or schema changes yet.

---

## 0. Principles (non-negotiable)

1. Preserve auth/authz, tenant isolation, and project permissions (RLS + JWT + UCI access service).
2. Preserve scraper job behavior and **real** progress reporting (`ScrapeContext`, SSE/poll, durable jobs, cancel/retry).
3. Preserve document storage, ingestion status machine, and comment/response approval triggers.
4. Preserve credential secrecy (encrypt-at-rest; no password echo; server decrypt only).
5. Preserve AI compliance / comment Edge Function contracts and `/api/analyze-drawing`.
6. Preserve UCI provider, territory, load-profile, application, submission logic and PEPCO live-submit env gate.
7. Prefer **frontend adapters** over backend rewrites.
8. Separate **visual migration** from **business-logic migration**.
9. No scattered partial UI changes across critical workflows without a rollback boundary.
10. Do **not** assume all ~87 Lovable routes ship.

---

## 1. Product decisions (REQUIRED before implementation)

Lock these in writing before Phase 2+. Unclear items stay `product_decision_required`.

| ID | Decision | Options | Default recommendation |
|----|----------|---------|------------------------|
| PD-1 | Auth paths | Keep `/auth` vs aliases `/login`+`/signup` | Keep `/auth`; optional redirects from Lovable paths |
| PD-2 | Role model | Keep `admin/moderator/user` vs adopt `admin/staff/client` + approval | Keep current; map Lovable labels in UI only |
| PD-3 | Marketing `/` | Public MarketingLayout vs Lovable shell for anon | Keep public marketing; don’t put anon in app shell |
| PD-4 | LOA | Build BE (`client_authorizations`) vs exclude | **Exclude v1** unless legal/ops require it |
| PD-5 | Admin members/audit | Port Lovable RPCs/tables vs keep AdminPanel | Keep AdminPanel; defer Lovable members/audit |
| PD-6 | UCI IA | Single `/uci` with tabs/drawers vs Lovable multi-route | Start single page + deep-links; add routes only when wired |
| PD-7 | DesignCheck `/compliance` | Ship mock matrix vs wire multi-agent vs drop | Wire analyzer first; matrix only if product-defined |
| PD-8 | Permit queue | Aggregate from filings/scrape vs exclude | Exclude until query design exists |
| PD-9 | Messages | Real inbox vs notifications vs exclude | Exclude; keep existing notification patterns |
| PD-10 | Timeline/Gantt | Build vs exclude | Exclude v1 |
| PD-11 | Nav IA | Adopt Lovable groups vs hybrid | Hybrid: Lovable chrome + PP critical Intake links |
| PD-12 | Route renames | `/portal-data`→`/portals/harvest` etc. | Prefer **aliases/redirects**; keep old paths working |
| PD-13 | Baltimore mock | Keep in nav vs hide | Hide from primary nav; leave routes |
| PD-14 | In-scope of ~55 direct-URL pages | See gap §5 | Only detail_flows marked in-scope + auth/contact |

**Exit criterion:** Signed checklist of PD-1…PD-14. No Phase 3+ without it.

---

## 2. In-scope vs out-of-scope (v1)

### In scope (visual + adapter)

- Shared shell (sidebar/header/tokens) with PP providers intact
- `/dashboard`, `/projects`, `/settings`, `/contact`, marketing pages (per PD-3)
- Portal Harvest ↔ `/portal-data`
- Permit filing ↔ `/permit-wizard-filing` (Lovable guided chrome)
- Response Matrix ↔ `/response-matrix`
- Code compliance analyzer ↔ `/code-compliance`
- Comment Review / Classified Comments (PP-only — restyle, don’t drop)
- UCI dashboard + selected stage UIs via `uciApi` (not Lovable static)
- Load-profile / provider-map surfaces when wired to UCI APIs
- Documents vault UI → `project_documents` + ingestion
- Checklists, analytics, jurisdiction map (path aliases OK)
- Admin overview + jurisdictions / shadow / flags (PP admin)

### Out of scope (v1) — exclude or freeze

- SIR suite, mobile/*, field/studio, closeout post-mortem suite
- Mission Control, Command Center, Critical Path, Feasibility
- `/projects/alpha`, Master/Unified matrix duplicates, `/dashboard/uci`
- Operations Board, Content Studio, Platform Architecture
- Admin CRM / invoicing / milestone / endpoints / past-performance
- Lovable Knowledge Graph, Conflict Hunter, Easements (unless later roadmap)
- LOA + Lovable members/audit **until** PD-4/PD-5 say otherwise
- AiWorkflow localStorage board as “production workflow”

### Explicitly preserve (even if absent from Lovable)

Token portals, invites, Shovels permit intelligence, ROI/consolidation calculators, pricing/FAQ/install, scrape durability, credential crypto, UCI submit gate.

---

## 3. Adapter strategy

```
Lovable page chrome (layout, tokens, ProductPrimitives)
        ↓
Adapter layer (thin): map props ↔ existing hooks
        ↓
PermitPilot clients: useAuth, useProjects, SelectedProjectContext,
  ScrapeContext, uciApi, portalCredentialsApi, Edge invokes
        ↓
Unchanged backend contracts
```

**Rules**

- New UI must call existing hooks/clients or a thin adapter — no duplicated fetch inside Lovable page copies.
- Status strings that drive BE (UCI stages, scrape statuses, `response_status`) stay exact.
- Do not copy Lovable `permitpilot/data.ts` mock arrays into production paths.
- Do not use Lovable Cloud tables as schema truth for this repo.

---

## 4. Phased plan

### Phase 0 — Decision lock & inventory freeze

**Work:** Confirm PD-1…PD-14; freeze mapping JSON as checklist; tag each route `in_scope_v1 | deferred | excluded`.

**Verify**

- [ ] Mapping JSON reviewed by eng + product
- [ ] Preserve list from constraints acknowledged
- [ ] No BE migrations scheduled under “UI replication” without separate ticket

**Rollback:** N/A (docs only). **Boundary:** docs commit only.

---

### Phase 1 — Design tokens & presentational primitives

**Work:** Align CSS variables / Tailwind aliases / `ProductPrimitives`-equivalents **without** swapping routes. Keep existing page bodies.

**Verify**

- [ ] Light/dark themes render on DashboardLayout
- [ ] No change to API payloads
- [ ] Snapshot key pages: dashboard, projects, portal-data, uci, settings

**Rollback:** Revert token/CSS files only. **Boundary:** style_only.

---

### Phase 2 — Shared shell replacement

**Work:** Replace sidebar/header chrome with Lovable-inspired shell **behind same** `DashboardLayout` export (or feature-flagged parallel layout). Keep nav **hrefs** pointing at current production routes initially (hybrid IA per PD-11).

**Must retain inside shell**

- `SelectedProjectProvider`, `ScrapeProvider`, scrape indicator
- Auth-required / admin filtering
- Command palette (fix stale `/api-documentation` link if touched)
- Sign-out clears scrape session

**Verify**

- [ ] All current sidebar destinations still reachable
- [ ] Admin-only items still gated
- [ ] Project selection persists (`?projectId=` / localStorage)
- [ ] Mobile bottom nav still works

**Rollback:** Swap layout implementation back to previous export. **Boundary:** shell only — page bodies untouched.

---

### Phase 3 — Low-risk page visual replaces (one route at a time)

Order:

1. `/contact`, FAQ/pricing/demos (marketing) — if PD-3 allows
2. `/checklists` alias → checklist-history restyle
3. `/analytics` ← executive portfolio chrome
4. `/projects` list/cards (keep `useProjects` CRUD)
5. `/dashboard` widgets (replace Lovable mock KPIs)

**Per page verify** (from constraints §4)

- [ ] Same path (or documented redirect)
- [ ] Auth gate unchanged
- [ ] Primary API payloads unchanged
- [ ] Loading/error/empty/success reachable
- [ ] Selected project rules unchanged
- [ ] No plaintext credentials in DOM/network

**Rollback:** Revert single page import in `App.tsx`. **Boundary:** one page.

---

### Phase 4 — Medium-risk operational pages

Order (still one-at-a-time; no parallel critical edits):

1. Documents vault → real documents hooks
2. `/code-compliance` visual ← Lovable analyzer chrome + `/api/analyze-drawing`
3. `/comment-review` + `/classified-comments` restyle (PP-only)
4. Settings chrome **keeping** `PortalCredentialsManager` + MS mailbox

**Verify extras**

- [ ] Ingestion job statuses still surface
- [ ] Credential create/list never returns password
- [ ] Analyzer ErrorBoundary still catches failures

**Rollback:** Per-page import revert. **Boundary:** no scraper/UCI yet.

---

### Phase 5 — High-risk: Portal Harvest, Response Matrix, Permit Wizard

**Work:** Apply Lovable layout to:

| Current path | Lovable reference | Adapter target |
|--------------|-------------------|----------------|
| `/portal-data` | `/portals/harvest` | ScrapeContext + scrape APIs |
| `/response-matrix` | `/matrix/response` | Edge generate-* + approval |
| `/permit-wizard-filing` | `/matrix/guided` | permitwizard preflight/execute |

Optional path aliases (PD-12) **after** visual parity proven.

**Verify**

- [ ] Start/cancel scrape; terminal statuses from real job state
- [ ] Arlington durable progress still visible
- [ ] Response approve blocked without project admin (trigger)
- [ ] Filing preflight/execute status machine unchanged
- [ ] No mock rows when `portal_data` empty

**Rollback:** Page-level revert; do **not** touch scraper-service. **Boundary:** FE only.

---

### Phase 6 — UCI visual migration (logic preserved)

**Work:** Restyle `/uci` using Lovable patterns; optionally add nested routes **only** when each is wired to `uciApi` (PD-6).

Suggested wire order:

1. Dashboard overview (portfolio_view / events)
2. Provider resolution + territory (manual path; don’t claim auto D2.2 ready)
3. Load profile (`/utility/load-profile` chrome)
4. Application builder / submissions
5. Communications + COS
6. CIAC / costs, meter-set, closeout prepare (thin FE over existing APIs)

**Never**

- Mount unguarded `/dashboard/uci` duplicate
- Enable `UCI_PEPCO_LIVE_SUBMISSION_ENABLED` for UI convenience
- Replace stage enums or transition payloads

**Verify**

- [ ] JWT + refresh-on-401 still works
- [ ] Access denied for unauthorized project/tenant
- [ ] Stage transitions match API
- [ ] Live submit remains env-gated; email fallback path intact
- [ ] Empty/loading use real fetch states (not fake `UciLoading` delay alone)

**Rollback:** Restore previous `UciDashboard` + components. **Boundary:** FE; no DB migration.

---

### Phase 7 — Nav IA cutover & redirects

**Work:** After Phases 3–6 stable, adopt agreed Lovable nav labels/groups (PD-11) with redirects from any renamed paths. Remove excluded routes from discoverability (leave code or 404 intentionally).

**Verify**

- [ ] No dead primary nav links
- [ ] Old bookmarks redirect
- [ ] PP-only features still linked (comments, intelligence, calculators, admin)

**Rollback:** Restore prior `AppSidebar` nav arrays.

---

### Phase 8 — Deferred product builds (separate programs)

Only after explicit PD + BE tickets:

- LOA + admin authorizations
- Member approval / audit log
- Permit queue aggregate
- DesignCheck multi-agent matrix
- Timeline/Gantt
- Messages inbox
- SIR / field / closeout suites

Each is **not** “UI replication” — treat as new features.

---

## 5. Verification matrix (by concern)

| Concern | How to verify | Phase |
|---------|---------------|-------|
| Auth session | Sign-in/out; protected redirect | 2+ |
| Admin gate | Non-admin blocked from `/admin/*` | 2+ |
| Project RLS | User A cannot mutate user B project via UI | 3+ |
| Scrape progress | Live job → UI status matches API | 5 |
| Credentials | Network tab: no password fields in responses | 4 |
| Comments approval | Non-admin cannot set Approved | 5 |
| UCI access | Cross-tenant denied | 6 |
| Documents | Upload → ingestion statuses | 4 |
| Submit gate | Live PEPCO still blocked when env off | 6 |

---

## 6. Rollback boundaries (summary)

| Boundary | Method |
|----------|--------|
| Tokens | Revert CSS/tailwind |
| Shell | Prior `DashboardLayout` / sidebar export |
| Single page | Prior page component in `App.tsx` |
| Alias routes | Remove redirect entries |
| Backend | **Not part of UI rollback** — never weaken RLS/JWT to “fix” UI |

Feature flags: `useFeatureFlags` is localStorage-only — **do not** rely on it for production cutover without a real flag mechanism. Prefer route-level dual registration during transition.

---

## 7. Anti-patterns (explicit)

- Copying Lovable pages wholesale with mock `data.ts`
- Reimplementing Playwright in the browser
- Client-side portal password storage
- Parallel Supabase Auth stack
- Treating Baltimore mocks as portal integration
- Assuming UCI stages 7–10 FE equals API completeness
- Using stale `src/integrations/supabase/types.ts` as schema truth
- Shipping all ~55 direct-URL pages because they exist in Lovable

---

## 8. Success definition (v1)

- Lovable-inspired shell and key operational pages ship.
- All preserve-list behaviors pass verification matrix.
- ≤ in-scope routes from mapping JSON; excluded routes not in primary nav.
- Zero new BE migrations attributed solely to “looking like Lovable,” except PD-approved programs in Phase 8.
- Rollback possible per page/shell without Railway/DB surgery.

---

## 9. Suggested ownership split

| Stream | Owns |
|--------|------|
| Design | Tokens, shell, page layouts |
| FE platform | Adapters, route aliases, nav |
| Domain FE | Scrape, UCI, comments, filing, credentials |
| BE | Only Phase 8 / PD-approved extensions |
| QA | Verification matrix + regression on scrape/UCI/filing |

---

## 10. Next step after this plan

Implement **Phase 0** (decisions) only — then Phase 1 tokens — then Phase 2 shell. Do not start Phase 5–6 until Phases 2–4 are green on verification checklists.
