# Resources Section — Lovable vs PermitPilot Audit & Sidebar Plan

**Date:** 2026-08-05  
**Repo:** `/Users/javerianaveed/epermit/Epermit-main`  
**Branches compared:** `main` @ `5199937` · `feat/lovable-ui-replication` @ `a24548e` (working tree)  
**Lovable reference:** `reference/lovable-ui/` (`src/components/permitpilot/data.ts`, pages, `architecture-inventory.md`)  
**Constraints:** Read-only audit. No code changes, implement, deploy, push, merge, or migrations.

---

## Rules applied (from product owner)

1. **Replicate every Lovable Resources entry in the sidebar** — do not hide an item because the backend is incomplete.
2. Incomplete / unsupported surfaces stay visible and are labeled **Mock Data** or **Coming Soon** (never presented as live metrics).
3. **Preserve real PermitPilot** wiring (hooks, APIs, tables, permissions). Lovable is visual/UX reference only.
4. **No mock data inside real metrics** (especially Analytics).
5. **No duplicate routes** for the same capability (alias/redirect OK; two competing product pages not OK).
6. **Architecture Inventory** is **admin/internal**, not a regular operator Resources tool — keep out of the default Resources list or gate under Admin.
7. **Messages** requires an explicit mapping to chat / mailbox / notifications **before** any inbox UI ships.

---

## Evidence sources

| Source | Path / ref |
|--------|------------|
| Lovable Resources nav | `reference/lovable-ui/src/components/permitpilot/data.ts` (Resources group) |
| Lovable inventory | `docs/lovable-ui-inventory.json`, `reference/lovable-ui/architecture-inventory.md` |
| Lovable routes | `reference/lovable-ui/src/App.tsx` |
| Feat hybrid nav | `src/components/layout/hybridNav.ts` → `AppSidebar.tsx` |
| Main nav | `git show main:src/components/layout/AppSidebar.tsx` (`resourcesNavigation`) |
| Feat / main routes | `src/App.tsx` vs `git show main:src/App.tsx` |
| Prior gap docs | `docs/lovable-vs-current-gap-analysis.md`, `docs/lovable-ui-frontend-implementation-plan.md` (PD-9 Messages) |

---

## Classification legend

| Tag | Meaning |
|-----|---------|
| **Real** | UI → API/DB → usable result |
| **Partial** | Real wiring with gaps |
| **Static** | Hand-authored content (codes, glossary terms, coverage directory) — not fabricated KPIs |
| **Mock** | Fabricated product data presented as live |
| **Coming Soon** | Visible placeholder; no fake content as production truth |

---

## A. Per-item deep dive

### 1. Checklists

| Field | Detail |
|-------|--------|
| **Lovable** | Route `/checklists` · page `Checklists.tsx` · primitives `PageHeader` / `MetricCard` / `Panel` · hardcoded `checklistRows` + KPI cards (Total 12 / Draft 3 / …) · Search/Filter buttons non-functional · Export All decorative |
| **Lovable data mode** | **Mock** |
| **PP equivalent** | `ChecklistHistory.tsx` + `useSavedChecklists` → Supabase `saved_inspection_checklists`; PDF export; edge `send-checklist-report`; dashboard `RecentChecklistsWidget` |
| **main route + sidebar** | `/checklist-history` · Resources › Checklists |
| **feat route + sidebar** | `/checklist-history` (+ alias `/checklists`) · Resources › Checklists |
| **Different name?** | Lovable “Checklists” vs PP title often “Checklist History” — **keep sidebar label “Checklists”**, page can keep history semantics |
| **Hidden / direct URL?** | Sidebar on both; feat adds `/checklists` alias |
| **Main backend on new UI?** | **Yes** — same page + hook; shell/nav only |
| **Missing Lovable UI** | Compact mock table chrome, decorative metric strip, service pills |
| **Stronger PP to preserve** | Full CRUD, status batch, PDF, email report, project linkage, realtime widget |

**Recommendation:** **Keep name** “Checklists” · **Move under Resources** (already) · **Implement real** (already wired) · optional Lovable chrome only.

---

### 2. Reference Library

| Field | Detail |
|-------|--------|
| **Lovable** | Route `/reference` · `ReferenceLibrary.tsx` · large static ICC / state / city / utility / internal collections · search + collection browser · Help also links Documentation → same `/reference` (Lovable duplicate) |
| **Lovable data mode** | **Static** (reference catalog; not live CMS) |
| **PP equivalent** | `CodeReferenceLibrary.tsx` @ `/code-reference` — richer static code matrix, comparison, permit fee calculator · also `/api-docs`, `/mvp-documentation` for docs |
| **main route + sidebar** | `/code-reference` · Intelligence › **Code Library** (not under Resources) |
| **feat route + sidebar** | Same: Intelligence › Code Library · **not** in Resources |
| **Different name?** | Yes — Lovable “Reference Library” vs PP “Code Library” |
| **Hidden / direct URL?** | Sidebar (Intelligence); no `/reference` route on main/feat |
| **Main backend on new UI?** | N/A (static FE content); page still real on feat |
| **Missing Lovable UI** | Broader “library hub” framing (utility + internal packs); Help “Documentation” pointing at library |
| **Stronger PP to preserve** | Code comparison matrix, fee calculator, jurisdiction code sections already in PP |

**Recommendation:** **Rename** sidebar to **“Reference Library”** (Lovable label) · **Move under Resources** · keep single route `/code-reference` (optional redirect `/reference` → `/code-reference`) · **Implement real** (existing static PP page — do not replace with Lovable-only catalog) · do **not** also put Documentation under Help to the same path (avoid Lovable duplicate).

---

### 3. Utility Coverage

| Field | Detail |
|-------|--------|
| **Lovable** | `/reference/utility-coverage` · `UtilityCoverage.tsx` · data `src/data/utilityProviders.ts` (+ eastCoastCoverage, excludedCompanies, expandedScope) · search, KPIs, findings, contact rows · sourcing caveat (Orennia / EIA) · labeled internal/confidential |
| **Lovable data mode** | **Static** reference (with in-page caveat); demo-routes treat exact path as non-fabricated reference |
| **PP equivalent (adjacent, not same)** | Jurisdiction Map `/jurisdictions/map` (Mapbox + jurisdictions) · Provider Compare `/jurisdictions/compare` · scraper territory footprints (`scraper-service/data/territory/…`) · UCI provider surfaces — **no** East Coast coverage analysis page |
| **main / feat route + sidebar** | **Missing** — no route, no nav item |
| **Different name?** | N/A (absent). Closest PP names: Jurisdiction Map / Provider Compare (Intelligence) |
| **Hidden / direct URL?** | Absent on PP (404) |
| **Main backend on new UI?** | No page; do not pretend territory GeoJSON is this report |
| **Missing Lovable UI** | Entire coverage analysis report + provider directory UI |
| **Stronger PP to preserve** | Live map/compare/territory pipelines — keep separate; never overlay fake utility lines on Mapbox as “coverage analysis” |

**Recommendation:** **Move under Resources** · **Keep name** “Utility Coverage” · route `/reference/utility-coverage` · ship Lovable static page as **Static / Reference** (caveat banner required) **or** interim **Coming Soon** if content pack not ported yet · later optional **Implement real** against territory/provider APIs without replacing map/compare.

---

### 4. Glossary

| Field | Detail |
|-------|--------|
| **Lovable** | `/reference/glossary` · `Glossary.tsx` · ~30 hand-authored terms in 3 sections · client-side search |
| **Lovable data mode** | **Static** (authored content; inventory marks Working/UI-only) |
| **PP equivalent** | Feat: `GlossaryPlaceholder.tsx` — empty **Coming Soon** (intentionally no fake terms) · main: **no route** |
| **main route + sidebar** | None |
| **feat route + sidebar** | `/reference/glossary` · Help & Support › Glossary (**Coming Soon** badge) — **not** under Resources |
| **Different name?** | Same label; wrong nav group vs Lovable |
| **Hidden / direct URL?** | Feat: sidebar Help + direct URL |
| **Main backend on new UI?** | No backend needed; content not connected |
| **Missing Lovable UI** | Full searchable glossary content |
| **Stronger PP to preserve** | Placeholder honesty (no fake definitions as production) until content pack approved |

**Recommendation:** **Move under Resources** · **Keep name** · **Coming Soon** until content pack (port Lovable static terms is fine as Static once approved) · remove duplicate from Help or leave Help link as alias only (one primary sidebar home).

---

### 5. Analytics & Reporting

| Field | Detail |
|-------|--------|
| **Lovable** | Nav label “Analytics & Reporting” → `/portfolio/executive` · `PortfolioExecutive.tsx` · hardcoded regional KPI series (on-time %, slip days, meter-fail %, cycle weeks) · risk cards · quarter toggles — **mock executive portfolio**, not permit analytics |
| **Lovable data mode** | **Mock** |
| **PP equivalent** | `Analytics.tsx` + `useAnalytics` · summary / trends / costs / rejections / export · auth-gated · workspace project metrics |
| **main / feat route + sidebar** | `/analytics` · Resources › Analytics & Reporting |
| **Different name?** | Same label; **different product** under the label (exec UCI portfolio vs permit analytics) |
| **Hidden / direct URL?** | Sidebar Resources |
| **Main backend on new UI?** | **Yes** — real `useAnalytics` on feat |
| **Missing Lovable UI** | Executive portfolio chrome / regional KPI story |
| **Stronger PP to preserve** | All real charts + CSV export; **never** replace with PortfolioExecutive mock numbers |

**Recommendation:** **Keep name** · **Move under Resources** (already) · **Implement real** at `/analytics` · do **not** add `/portfolio/executive` as a second Analytics · optional future visual chrome only with live data · any exec demo stays under Demo with Mock badge.

---

### 6. Messages — mapping first (required)

Lovable **Messages** is a **mock** shared inbox (`Messages.tsx`, badge `"4"`, AI summary toggle, compose/reply chrome). It is **not** connected to email, chat, or notifications.

| PP surface | Route / home | What it is | Overlap with Lovable Messages? |
|------------|--------------|------------|--------------------------------|
| **Notifications** | Header `NotificationBell` | Real: `jurisdiction_notifications`, inspections, punch alerts | Partial — alerts, not threaded inbox |
| **Project chat** | `ProjectChatSidebar` in project detail | Real: `project_chat_messages` + `mention_notifications` | Partial — project-scoped thread, not global inbox |
| **Microsoft mailbox** | Settings › connector; UCI PEPCO flows | Real mailbox status / test-read / utility email assist | Partial — ops mailbox, not product “Messages” portal |
| **UCI · Inbox** | `/uci?section=` communications | Mixed UCI communications | Adjacent — utility inbox, not Resources Messages |
| **Contact Support** | `/contact` | Support form | Not messaging |

**Product mapping decision (pre-implementation):**

| Option | Meaning | Sidebar treatment |
|--------|---------|-------------------|
| **A. Notifications hub** | Resources › Messages → deep-link / expand NotificationBell destination | Partial real; rename optional “Notifications” |
| **B. Project chat inbox** | Aggregate `project_chat_messages` across projects | Needs list page; preserve chat side panel |
| **C. Mailbox inbox** | Microsoft Graph message list | Needs BE; Settings connector preserved |
| **D. Unified** | Tabs: Notifications · Chat · Mail | Highest scope; still no Lovable mock threads as live |
| **E. Coming Soon** | Visible Resources item; no fake unread badge | **Default until A–D chosen** |

| Field | Detail |
|-------|--------|
| **Lovable** | `/messages` · mock threads · also Help › Support → `/messages` (duplicate) |
| **Lovable data mode** | **Mock** |
| **PP equivalent** | None as a single page — see mapping table |
| **main / feat** | **No `/messages` route** · not in hybrid Resources |
| **Different name?** | — |
| **Hidden / direct URL?** | Absent (demo-routes list `/messages` as fabricated for future demos) |
| **Main backend on new UI?** | N/A |
| **Missing Lovable UI** | Full inbox shell |
| **Stronger PP to preserve** | NotificationBell, ProjectChat, MicrosoftMailboxConnector, UCI mailbox flows — **do not replace with mock inbox** |

**Recommendation:** **Move under Resources** · **Keep name** “Messages” (Lovable parity) · **Coming Soon** until mapping A–D chosen · **no Mock Data** unread badge · **no duplicate** Help › Support → same mock · Contact Support stays `/contact`.

---

### 7. Architecture Inventory (admin / internal — not regular Resources)

Two related Lovable surfaces; do not conflate:

| Surface | Lovable route | Nav | Data | Notes |
|---------|---------------|-----|------|-------|
| **Architecture Inventory** | `/architecture-inventory` (documented; page referenced as `ArchitectureInventory.tsx`) | **Direct URL only** / Internal | Static hand-curated inventory | Matrix L089: **“Do not build”** in-app page — prefer repo docs |
| **Platform Architecture** | `/architecture` · `PlatformArchitecture.tsx` | Direct URL (Home CTA); **not** in Resources sidebar | Static flow diagram | Plan marks exclude / confusion |

| Field | Detail |
|-------|--------|
| **PP equivalent** | Admin **Architecture Replication** `/admin/architecture-replication` · `ArchitectureReplicationChecklist` + workspace (implementation tracker) · repo docs (`architecture-inventory.md`, matrix, `docs/*`) · `/mvp-documentation`, `/design-system-preview` |
| **main** | No architecture-replication admin route in older main snapshot; docs-only |
| **feat** | Admin › Architecture Replication · **not** Resources |
| **Different name?** | Lovable “Architecture Inventory” vs PP “Architecture Replication” |
| **Hidden / direct URL?** | Lovable: direct URL · PP: admin-gated sidebar |
| **Main backend on new UI?** | Admin checklist is FE tracker (overlay/hooks); not operator product data |
| **Missing Lovable UI** | Browseable inventory export page (intentionally deferred by matrix) |
| **Stronger PP to preserve** | Admin replication workspace + repo documentation as source of truth |

**Recommendation:** **Do not** put Architecture Inventory in regular Resources · **Admin / internal only** · **Keep name** “Architecture Replication” (or “Architecture Inventory” as admin subtitle) · route stays `/admin/architecture-replication` · **no** public `/architecture-inventory` product page · Platform Architecture `/architecture` stays **out of Resources** (Coming Soon/internal or docs only if ever linked).

---

## B. Comparison table

| Lovable item | Lovable route | Lovable mode | PP equivalent | main route | feat route | main sidebar | feat sidebar | Name diff? | Hidden? | BE on feat? | Missing Lovable UI | Stronger PP | Recommendation |
|--------------|---------------|--------------|---------------|------------|------------|--------------|--------------|------------|---------|-------------|--------------------|-------------|----------------|
| Checklists | `/checklists` | Mock | ChecklistHistory + `saved_inspection_checklists` | `/checklist-history` | `/checklist-history` + `/checklists` | Resources | Resources | History vs Checklists | No | Yes | Mock chrome | CRUD/PDF/email | **Keep name** · Resources · **Implement real** |
| Reference Library | `/reference` | Static | CodeReferenceLibrary | `/code-reference` | `/code-reference` | Intelligence (Code Library) | Intelligence (Code Library) | Yes | No | Static FE yes | Hub framing | Matrix + fee calc | **Rename** → Reference Library · **Move under Resources** · **Implement real** · alias `/reference` |
| Utility Coverage | `/reference/utility-coverage` | Static (+ caveat) | None (map/compare adjacent) | — | — | — | — | — | Absent | No | Full report | Live map/territory | **Move under Resources** · **Keep name** · **Static** or **Coming Soon** · no fake metrics |
| Glossary | `/reference/glossary` | Static | GlossaryPlaceholder | — | `/reference/glossary` | — | Help (Soon) | Group only | Feat Help | Placeholder | Term content | Honest empty state | **Move under Resources** · **Keep name** · **Coming Soon** → then Static pack |
| Analytics & Reporting | `/portfolio/executive` | Mock | Analytics + `useAnalytics` | `/analytics` | `/analytics` | Resources | Resources | Same label / different product | No | Yes | Exec portfolio chrome | Real charts/export | **Keep name** · Resources · **Implement real** @ `/analytics` · **no** mock portfolio route |
| Messages | `/messages` | Mock | Notif / chat / mailbox (mapped) | — | — | — | — | — | Absent | Partial elsewhere | Inbox shell | Bell, chat, mailbox | **Move under Resources** · **Keep name** · **Coming Soon** until mapping · **no Mock** badge |
| Architecture Inventory | `/architecture-inventory` (+ `/architecture` related) | Static / internal | Admin Architecture Replication + repo docs | — / docs | `/admin/architecture-replication` | — | Admin | Inventory vs Replication | Lovable direct URL; PP admin | Admin tool | In-app inventory browse | Admin tracker + docs | **Admin/internal** · **Keep/rename** under Admin · **not** regular Resources · **Do not** ship public inventory page |

---

## C. Grouped lists

### Already real — keep / restyle only

- Checklists → `/checklist-history` (alias `/checklists`)
- Analytics & Reporting → `/analytics` (real metrics only)
- Reference Library (as Code Library) → `/code-reference` (move + rename in nav)

### Move / rename for Lovable Resources parity

- Code Library → **Reference Library**, Resources group
- Glossary → Resources (from Help)
- Utility Coverage → add Resources item
- Messages → add Resources item (Coming Soon)
- Keep Analytics & Checklists in Resources

### Coming Soon (visible in Resources; no fake live data)

- Glossary (until static pack approved)
- Messages (until chat/mailbox/notifications mapping decided)
- Utility Coverage *(if content not ported in first pass)*

### Static / Reference (allowed with caveat; not “live KPIs”)

- Utility Coverage (Lovable `utilityProviders` pack + EIA caveat) — preferred over Coming Soon once ported
- Glossary content pack (once approved)
- Reference Library remains static code content (PP already)

### Mock Data — do **not** ship as production Resources

- Lovable Checklists mock rows/KPIs (discard; use PP data)
- Lovable PortfolioExecutive KPIs under Analytics label
- Lovable Messages threads + unread badge `"4"`
- Any Architecture / inventory page that fabricates product readiness

### Admin / internal only

- Architecture Inventory / Platform Architecture → **Admin › Architecture Replication** + repo docs  
- Do **not** add to default Resources for regular users

### PP extras currently in feat Resources (not in Lovable Resources)

Keep (valuable PP; not Lovable Resources clones):

- ROI Calculator `/roi-calculator`
- Tool Consolidation `/consolidation-calculator`
- Pricing `/pricing`

Optional later: sub-group “Calculators & pricing” under Resources so Lovable seven stay visually primary.

### Avoid duplicates

| Conflict | Resolution |
|----------|------------|
| `/checklists` vs `/checklist-history` | Single page; alias OK |
| `/reference` vs `/code-reference` | Redirect `/reference` → `/code-reference` |
| Analytics `/analytics` vs `/portfolio/executive` | Only `/analytics` |
| Messages vs Help Support vs Contact | Messages Coming Soon; Contact `/contact`; no second Messages |
| Reference Library vs Help Documentation | Docs stay `/api-docs`; library is Resources |
| Architecture Inventory vs Architecture Replication | One admin surface |
| Utility Coverage vs Jurisdiction Map | Separate items; map stays Intelligence |

---

## D. Exact sidebar + route plan (full Lovable Resources section)

### Target Resources group (feat `hybridNav.ts`)

Order matches Lovable Resources, then PP extras:

| # | Sidebar label | Route | Badge / mode | Notes |
|---|---------------|-------|--------------|-------|
| 1 | Checklists | `/checklist-history` | Real | Alias `/checklists` → same component |
| 2 | Reference Library | `/code-reference` | Real (static content) | Optional redirect `/reference` → `/code-reference`; remove from Intelligence **or** leave Intelligence deep-link only (prefer single sidebar home under Resources) |
| 3 | Utility Coverage | `/reference/utility-coverage` | Static **or** Coming Soon | New page port or placeholder; caveat banner if Static |
| 4 | Glossary | `/reference/glossary` | Coming Soon → Static | Move from Help; one primary nav entry |
| 5 | Analytics & Reporting | `/analytics` | Real | Never PortfolioExecutive mocks |
| 6 | Messages | `/messages` | Coming Soon | Mapping A–D first; no unread mock badge |
| 7 | ROI Calculator | `/roi-calculator` | Real (PP extra) | Keep |
| 8 | Tool Consolidation | `/consolidation-calculator` | Real (PP extra) | Keep |
| 9 | Pricing | `/pricing` | Real (PP extra) | Keep |

**Not in Resources (operator):** Architecture Inventory.

### Admin (internal)

| Sidebar label | Route | Mode |
|---------------|-------|------|
| Architecture Replication | `/admin/architecture-replication` | Admin-only tracker (feat already) |

Optional admin-only alias title “Architecture Inventory” in description only — **no** second route.

### Help & Support adjustments

| Item | Action |
|------|--------|
| Glossary | Remove from Help once under Resources (or leave secondary link to same route — not a second feature) |
| Documentation | Keep `/api-docs` (not `/reference`) |
| Contact Support | Keep `/contact` |
| Do not add Support → `/messages` | Avoid Lovable duplicate |

### Intelligence adjustments

| Item | Action |
|------|--------|
| Code Library | Remove from Intelligence when Resources › Reference Library is canonical (Command Palette: accept both names → `/code-reference`) |
| Jurisdiction Map / Provider Compare | Stay Intelligence (not Utility Coverage substitutes) |

### Route add / keep matrix

| Route | Action |
|-------|--------|
| `/checklist-history` | Keep (canonical) |
| `/checklists` | Keep alias |
| `/code-reference` | Keep; nav rename |
| `/reference` | Add redirect → `/code-reference` |
| `/reference/utility-coverage` | Add (Static page or Coming Soon placeholder) |
| `/reference/glossary` | Keep placeholder; promote content later |
| `/analytics` | Keep |
| `/messages` | Add Coming Soon page (no mock threads) |
| `/portfolio/executive` | **Do not add** as Analytics |
| `/architecture` / `/architecture-inventory` | **Do not add** to Resources; docs + admin replication only |
| `/admin/architecture-replication` | Keep admin |

---

## E. Implementation sequencing (plan only — not executed)

1. **Nav-only parity:** Reorder/rename Resources to rows 1–6; move Reference Library + Glossary; add Utility Coverage + Messages stubs.  
2. **Messages mapping workshop:** Choose A–E; until then Coming Soon only.  
3. **Utility Coverage:** Port Lovable static pack with caveat **or** Coming Soon.  
4. **Glossary:** Approve/port Lovable terms → Static; drop Soon badge.  
5. **Chrome pass:** Restyle Checklists / Analytics / Reference Library to Lovable shell without swapping data.  
6. **Admin:** Keep Architecture Replication; document that Architecture Inventory is repo + admin, not Resources.

---

## F. Verdict summary

| Lovable Resources intent | feat today | Gap |
|--------------------------|------------|-----|
| 6 sidebar items + internal Architecture Inventory | 2 of 6 in Resources (Checklists, Analytics); Glossary under Help Soon; Code Library under Intelligence; Messages & Utility Coverage missing; Architecture under Admin as Replication | Nav parity incomplete; three items need pages/placeholders; Messages blocked on product mapping; Architecture correctly **not** a regular Resource |

**Bottom line:** Wire the Resources sidebar to the Lovable six labels with real PP backends where they exist; label the rest Coming Soon/Static; keep Architecture Inventory admin/internal; decide Messages → notifications/chat/mailbox before any inbox UI.
