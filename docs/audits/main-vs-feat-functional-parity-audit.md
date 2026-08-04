# Main vs Feat — Functional Parity Audit (Merge Readiness)

**Date:** 2026-08-05 (revised same day — intentional IA / WIP accepted)  
**Repo:** `/Users/javerianaveed/epermit/Epermit-main`  
**SHAs verified:** `main` @ `df541d0` · `feat/lovable-ui-replication` @ `2aea795` (+ nav/UCI WIP committed 2026-08-05)  
**Scope:** Full product surface relevant to merge readiness (not UCI-only).  
**Method:** Route diff (`src/App.tsx`), sidebar/nav (`AppSidebar` / `hybridNav` / `UciSidebarNav`), page presence + sample API wiring, scraper/worker set comparison, prior audits under `docs/audits/` re-checked against current tips.  
**Constraints:** Read-only. No commit / push / deploy / implementation fixes.

### Product intent clarifications (2026-08-05)

Product owner confirmed the following are **intentional**, not merge defects:

| Item | Decision |
|------|----------|
| **Comment Review** off primary sidebar | Entrance moved into **Response Matrix** (Upload & Parse / Review Parsed CTAs → `/comment-review`) |
| **Permit Filing Start Pre-Flight** | Intentionally Soon/mock/WIP (`PERMIT_FILING_WIP = true`); work remains — **not** a “must match main enabled button” blocker |
| **Classified Comments** | Standalone UI folded toward Response Matrix; redirect OK |
| **Demos** | Feat primary Demo → Lovable McDonald’s + link to interactive `/demos`; acceptable |
| **UCI Soon badges** | Requested chrome; ignore as parity blockers |

### Concurrent nav/UCI WIP (committed with this inventory update)

| File | Status | Impact |
|------|--------|--------|
| `src/components/layout/hybridNav.ts` | Modified | Renames “Code Analyzer”; Admin `defaultOpen: true`; Permit Intelligence reorder |
| `src/lib/uciNavSections.ts` | Modified | Primary-nav subset; demotes hub tiles; `uciSidebarBadgeLabel` always returns `"Soon"` |
| `src/components/layout/UciSidebarNav.tsx` | Modified | Hub child removed; all primary children show **Soon** + Coming Soon tooltip |
| Other UCI chrome (`AppSidebar`, `UciComingSoonPanel`, `UciDashboard`) | Modified | Shell / Coming Soon presentation |

WIP is **nav/chrome only** — does not remove routes or APIs. Per product intent, UCI Soon badges are accepted.

Stale prior audit: `docs/audits/main-functional-features-and-ui-migration-audit.md` cited `5199937` / `7be2588` — findings below supersede that SHA pair for route/nav parity.

---

## 1. Executive verdict

**Merge-ready from a “main functionality copied to feat” functional-parity bar** — with accepted intentional IA / WIP, and normal merge hygiene remaining.

**Why (short):** Every `main` **route** exists on feat; core pages still call real hooks/APIs. Items previously listed as blockers (Comment Review sidebar, Permit Filing preflight enablement, Classified Comments standalone, Demos primary entry) are **accepted product decisions**, not accidental deletions. UCI Soon badges are requested. No remaining *accidental* main-function gap was found in re-check.

**Caveats (not “missing main feature” blockers):**

1. **Permit Filing** remains intentionally WIP — route/UI present; Start Pre-Flight hard-gated; do not treat “enabled like main” as a merge requirement.
2. **Scraper lineage hygiene** — feat tip is not a descendant of latest `main` scraper commits; feat is *ahead* on cancel/PGC retry libs. Merge carefully (three-way); do not drop feat libs.
3. **UCI/nav WIP** committed with architecture inventory update; smoke suite still recommended before merge.
4. **Smoke suite** on Preview + Railway development still recommended before merge.

**If the bar is “did we lose a whole main product area?” → no.**  
**If the bar is “feat is a full functional replacement of main’s shipped features (with agreed IA/WIP)” → yes, merge-ready on that bar.**  
**If the bar is “identical UX including main’s filing preflight enabled + identical sidebar” → no — and that bar is explicitly rejected by product intent.**

---

## 2. Route inventory

| Set | Count / note |
|-----|----------------|
| Shared protected/public routes | 42 (all `main` `path=` values exist on feat) |
| `main`-only routes | **None** |
| Feat-only routes | `/designcheck`, `/operations`, `/onboarding/authorization`, `/uci/application-builder`, `/demo/mcdonalds`, placeholders (`/permit-queue`, `/messages`, `/reference/glossary`, `/reference/utility-coverage`), admin previews (`authorizations`, `members`, `audit`, `architecture-replication`), aliases (`/login`, `/signup`, `/checklists`, …) |

Pages on `main` missing as files on feat: `LandingPage.tsx`, `CommunETLanding.tsx` — replaced by `HomeRoute` + `Home.tsx` (marketing shell change; mailto CTAs preserved on `Home.tsx`).

---

## 3. Tables

### A. Blockers (main function missing or broken relative to main)

| Item | Status |
|------|--------|
| *(none after product-intent reclassification)* | Prior P0s moved to **§3.E Intentional IA / WIP (accepted)** |

Re-check (2026-08-05): no additional accidental missing main route, sidebar-critical live workflow, or hard-broken API surface found that would replace those as blockers. Shared Partial items (Portal Harvest Force Sync UI-only, Mapbox-gated map, historical filing schema/env) exist on **both** lineages and are not feat regressions.

### B. Gaps / degraded (present but not full parity) — non-blocking

| Item | Status | Evidence |
|------|--------|----------|
| **Marketing `/`** | Auth → `/dashboard`; anon → shell + `Home` | Intentional Lovable IA |
| **UCI shell (WIP)** | Expandable children; Soon badges (requested) | Uncommitted `UciSidebarNav` / `uciNavSections` |
| **Baltimore Accela clone** | Routed; **removed from hybridNav** | Degraded discoverability; product-correct (mock) |
| **MVP Documentation** | Routed `/mvp-documentation` (not primary nav on either) | Info only |
| **Portal Harvest Force Sync / Filter** | UI-only / unwired (both) | Prior harvest audits — shared gap |
| **Scrape cancel signal** | Known split (both lineages) | Feat has *more* cancel libs than main — merge hygiene |

### C. Moved but OK

| Main | Feat | Notes |
|------|------|-------|
| Sidebar project + credential bind | `ActiveProjectControl` in `DashboardLayout` header | Same `portal_credentials` + `credential_id` update path |
| AI Compliance label | “Code Compliance Analyzer” / WIP “Code Analyzer” → `/code-compliance` | Same `AIComplianceAnalyzer` / analyze API |
| Compare Jurisdictions | “Provider Compare” → `/jurisdictions/compare` | Same page |
| Code Library | “Reference Library” → `/code-reference` | Same page |
| Settings | Help & Support group | Same tabs: profile, security, notifications, portals, architect, branding, cleanup + Microsoft mailbox |
| Mobile Home `/` | Mobile Home `/dashboard` | Auth-gated; more accurate for logged-in mobile |
| Comment Review primary nav | Response Matrix CTAs → `/comment-review` (+ Command Palette / dashboard widgets) | **Accepted IA** — see §3.E |
| Classified Comments primary nav | Redirect → Response Matrix; classifier on Matrix | **Accepted IA** |
| Demos sidebar `/demos` | Primary Demo → `/demo/mcdonalds` + link to interactive `/demos` | **Accepted IA** |

### D. Intentionally feat WIP (Coming Soon) — does **not** block “main copied”

These are **feat additions** or Lovable silhouette — `main` did not ship them as live product:

| Item | Route | Tag |
|------|-------|-----|
| Permit Queue | `/permit-queue` | Coming Soon placeholder |
| Glossary | `/reference/glossary` | Coming Soon |
| Utility Coverage | `/reference/utility-coverage` | Coming Soon |
| Messages | `/messages` | Coming Soon |
| Admin Authorizations / Members / Audit | `/admin/*` | Preview placeholders |
| Client Authorization (LOA) | `/onboarding/authorization` | Upcoming / no persistence |
| Operations Board (mock sections) | `/operations` | Mixed live + `DemoDataBadge` |
| DesignCheck Coming Soon panels | `/designcheck` | Live summary + CS panels (feat-only page) |
| UCI Lovable modules (Miss Utility, KG, portfolio, etc.) | `/uci?section=` | Coming Soon panels (Soon badges requested) |
| McDonald’s executive demo | `/demo/mcdonalds` | `DemoDataBadge` |
| Architecture Replication checklist | `/admin/architecture-replication` | Internal |

### E. Intentional IA / WIP (accepted) — formerly Blockers / Gaps

| Item | Main | Feat | Why accepted | Evidence |
|------|------|------|--------------|----------|
| **Comment Review discoverability** | Sidebar Intake → `/comment-review` | Not in `hybridNavGroups`; entrance via Response Matrix (“Upload & Parse Comments” / “Review Parsed Comments”), Command Palette, dashboard widgets | Product IA: workflow hub is Matrix | `ResponseMatrix.tsx` (~1367, ~1667+); `CommentWorkflowEntry.tsx` (component exists; Matrix also inlines CTAs) |
| **Permit Filing — Start Pre-Flight** | Enabled when form valid | Hard-disabled via `PERMIT_FILING_WIP = true` | Intentional WIP/Soon; functionality still needs work — **not** a merge parity blocker | `permitFilingWip.ts`; `StartFilingDialog.tsx` |
| **Classified Comments** | Standalone classifier page | Redirect to Response Matrix; classify/draft on Matrix | Intentional consolidation | `ClassifiedComments.tsx` → `Navigate`; Matrix `discipline-classifier-agent` |
| **Interactive Demos** | Sidebar `/demos` | Primary **Demo** → `/demo/mcdonalds` + button/link to interactive `/demos` | Intentional Lovable + existing demos | `hybridNav.ts`; `DemoMcDonalds.tsx` links to `/demos` |

---

## 4. Sidebar-level checklist (every main sidebar item → feat)

| Main sidebar item | Main href | Feat status |
|-------------------|-----------|-------------|
| Home | `/` | **Moved** — auth users land `/dashboard`; anon `Home` in shell |
| Dashboard | `/dashboard` | **OK** — Command group; widgets still mounted |
| Permit Filing | `/permit-wizard-filing` | **OK (WIP accepted)** — route OK; Start Pre-Flight intentionally gated |
| Utility Coordination | `/uci` | **OK / WIP chrome** — expandable; hub + APIs present; Soon badges requested |
| Portal Harvest | `/portal-data` | **OK** — Delivery; real scrape hooks |
| Baltimore Portal | `/baltimore` | **Moved/hidden** — route remains; out of product nav (mock) |
| Comment Review | `/comment-review` | **OK (IA accepted)** — route wired; entrance via Response Matrix / palette / widgets |
| Classified Comments | `/classified-comments` | **OK (IA accepted)** — redirects to Response Matrix |
| AI Compliance | `/code-compliance` | **OK** (label Code Analyzer in WIP) |
| Response Matrix | `/response-matrix` | **OK** — Delivery; Comment Review CTAs |
| Projects | `/projects` | **OK** — detail still mounts team/docs/inspections/billing/chat |
| Permit Intelligence | `/permit-intelligence` | **OK** — Intelligence |
| Code Library | `/code-reference` | **OK** — Reference Library |
| ROI Calculator | `/roi-calculator` | **OK** — Resources |
| Tool Consolidation | `/consolidation-calculator` | **OK** |
| Analytics & Reporting | `/analytics` | **OK** |
| Jurisdiction Map | `/jurisdictions/map` | **OK** |
| Compare Jurisdictions | `/jurisdictions/compare` | **OK** — Provider Compare |
| Checklists | `/checklist-history` | **OK** (+ `/checklists` alias) |
| Demos | `/demos` | **OK (IA accepted)** — primary Demo → McDonald’s; `/demos` still exists + linked |
| Pricing | `/pricing` | **OK** |
| Design preview | `/design-system-preview` | **OK** — Help |
| Documentation | `/api-docs` | **OK** |
| FAQ | `/faq` | **OK** |
| Contact Support | `/contact` | **OK** |
| Admin Overview | `/admin` | **OK** (+ Coming Soon children) |
| Admin Jurisdictions | `/admin/jurisdictions` | **OK** |
| Admin Feature Flags | `/admin/feature-flags` | **OK** (still localStorage flags) |
| Admin Shadow Mode | `/admin/shadow-mode` | **OK** |
| Settings (footer/header) | `/settings` | **OK** — Help group |

---

## 5. Domain spot-checks (wiring)

| Domain | Feat route | Wired? | Notes |
|--------|------------|--------|-------|
| Dashboard | `/dashboard` | Yes | `DeadlineAlertsWidget`, `InspectionsPunchListWidget`, `RecentChecklistsWidget`, `AgentWorkflowStatus`, `ProjectHealthCard` |
| Projects | `/projects` | Yes | `useProjects`; detail: team, documents, inspections, billing, chat |
| Portal Harvest | `/portal-data` | Yes | `useScrape`, project bind; PGC retry libs **feat-only vs main** |
| Response Matrix | `/response-matrix` | Yes | `generate-response`, grounded, classifier, export edges; Comment Review CTAs |
| UCI | `/uci` | Partial | Hub/drawer live; many Lovable sections Coming Soon (accepted) |
| Admin | `/admin/*` | Yes for real 4; stubs for Lovable admin | |
| Settings / Team | `/settings` + project team | Yes | Credentials manager; Microsoft mailbox |
| Jurisdictions / Map | map + compare + state | Yes | Mapbox-gated Partial |
| Analytics | `/analytics` | Yes | `useAnalytics` |
| Document / AI | project docs + `/code-compliance` | Yes | RAG worker Partial |
| DesignCheck | `/designcheck` | Feat-only | Summary hook + CS panels; not a main route |
| Resources | checklists / reference / calc | Yes | Glossary/Coverage CS |
| Operations Board | `/operations` | Feat-only | Mixed mock |
| Permit Filing | `/permit-wizard-filing` | Partial + **WIP accepted** | Schema/env Partial on both historically; preflight gate intentional |
| Credentials | Settings + header control | Yes | Moved from sidebar → `ActiveProjectControl` |
| Comment Review | `/comment-review` | Yes | Not in hybridNav; Matrix / palette / widgets entry — accepted |

### Scraper / worker note (merge hygiene)

- `main` tip commits `5199937`, `a9b8541`, `df541d0` are **not ancestors** of feat tip, but DC `session.planreview` strings and `document-ingestion-worker` / comment-parser Excel show **no missing-file gap** favoring main-only code for those areas.
- Feat **adds** `scrape-job-cancellation.js`, `pgc-retry-artifacts.js`, and related tests that **main lacks**.
- Merging feat → main must **not** blindly drop feat cancel/retry; merging main → feat should be a careful three-way, not a reset.
- This is **merge process risk**, not “feat missing main product function.”

---

## 6. Recommended next steps (revised severity)

1. **P1 — Smoke suite on Preview + Railway development:** Projects → credentials bind → Portal Harvest → Comment Review (via Matrix CTAs) → Matrix export → Dashboard widgets → Settings portals.
2. **P1 — Scraper merge plan:** preserve feat cancel/PGC retry; verify DC/PGC against production harvest suite after merge.
3. **P2 — Permit Filing WIP:** continue product work under `PERMIT_FILING_WIP`; re-enable when ready — **not** a merge gate for main→feat feature copy.
4. **P2 — Non-blockers:** leave Coming Soon placeholders; keep Baltimore unlinked; keep LOA/Operations badges; keep Comment Review out of sidebar per IA.

~~Former P0s (restore Comment Review sidebar; flip `PERMIT_FILING_WIP`)~~ — **withdrawn** per product intent.

---

## 7. Related audits (verified against tips where noted)

| Doc | Use |
|-----|-----|
| `docs/audits/main-functional-features-and-ui-migration-audit.md` | Deep feature classification (stale SHAs; still useful for E2E depth) |
| `docs/audits/uci-main-vs-ui-branch-test-guide.md` | UCI side-by-side test plan @ `df541d0` / `2aea795` |
| Portal harvest / cancel / response-matrix / permit-filing / operations / designcheck audits | Domain Partial/Broken details unchanged in spirit |

---

## Document control

| | |
|--|--|
| Author | Cursor audit subagent (read-only) |
| Output | `docs/audits/main-vs-feat-functional-parity-audit.md` |
| Branches | `main` @ `df541d0` · `feat/lovable-ui-replication` (nav/UCI + inventory @ 2026-08-05) |
| Revision | 2026-08-05 — intentional IA accepted; UCI/nav WIP + architecture inventory updated for merge review |
