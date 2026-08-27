# UCI Builder — Backend Capability Audit

**Date:** 2026-08-05  
**Repo:** `epermitarthouse-rgb/Epermit-main`  
**Branch:** `feat/lovable-ui-replication`  
**Lovable reference:** `reference/lovable-ui/src/pages/UciApplicationBuilder.tsx`  
**Type:** Audit + scoped implementation plan. Written **before** Phase 2 code.

**Related:** `docs/uci-navigation-and-workspace-replication-plan.md` (hub/drawer IA). This audit covers the **Commercial Service Application / UCI Builder** surface specifically.

**Locks still in force**

| ID | Constraint |
|----|------------|
| Functional-preservation | Lovable = visual/UX reference; PP UCI APIs = functional source of truth |
| No fake success | No mock %, mock submissions, hardcoded generated outputs |
| Security | Federal Tax ID / billing must not be stored insecurely or exposed to client-role users |
| Deploy | No commit/push/deploy unless explicitly requested; Railway `development` only for Lovable backend work |
| Demo accounts | Shared Supabase — no destructive live utility submissions without approval |

---

## 1. Current Lovable feature map

**Route:** `/uci/application-builder`  
**Access (Lovable matrix):** view/manage = `admin`, `staff` only (`reference/lovable-ui/src/config/uciAccess.ts`)  
**Implementation status in Lovable:** **100% mock** — hardcoded project (“Valvoline Leesburg Express”), Pepco utility string, load metrics, pre-completed sections, “Agent QA passed”, and non-functional Save/Submit buttons. No API calls.

### 1.1 Surfaces & steps

| Step | Label | Lovable UI elements | Lovable data source |
|------|-------|---------------------|---------------------|
| 01 | Service requested | Project, Purveyor + service, Voltage/phase, Service size, Service type, Target energization; contact line in header state | Hardcoded `form` state |
| 02 | Load profile | Peak demand, Load factor, Coincident peak, Service entrance, Service class, Standby generator | Hardcoded display cards |
| 03 | Site & access | Parcel ID, Service entrance address, Primary connection point, Crane access, Working clearance, Restricted hours | Empty inputs |
| 04 | Owner & billing | Account-holder name, **Federal Tax ID**, Billing address, Billing email, Authorized signatory, Phone | Empty inputs (sensitive) |
| 05 | Drawings & exhibits | Electrical riser, Site plan, Load letter, Switchgear nameplate, Standby gen one-line + Attach | Static list; Attach no-ops |
| 06 | Review & submit | Pre-flight checklist (4 items), “Agent QA passed”, Submit to Pepco portal | Fake checks + fake QA |

### 1.2 Chrome / actions

- Header: “Commercial Service Application”, Save draft, Submit to Pepco  
- Progress: `completed.size / 6` → % (starts with service+load pre-marked complete)  
- Left nav: 6 section buttons with done/active affordances  
- Footer: Back / Mark complete & continue (local Set only)

### 1.3 Utility categories (Lovable)

Implied **commercial electric / Pepco** only. No multi-utility category picker in the page; dashboard tile says “AI-drafted applications”.

---

## 2. Existing reusable backend / service map

### 2.1 PP routes & UI today (`feat/lovable-ui-replication`)

| Surface | Route / entry | Component | Notes |
|---------|---------------|-----------|-------|
| UCI hub + drawer | `/uci` (+ `?section=` / `?coordination=` / `?tab=`) | `src/pages/UciDashboard.tsx` | Functional source of truth |
| Application Builder nav | `/uci?section=application-builder` → drawer tab `application-prep` | `ApplicationPrepSection` (inline in `UciDashboard.tsx`) | Real build / map docs / review / submit |
| Load Profile | `/uci?section=load-profile` → drawer tab `load-profile` | `LoadProfileWorkspace.tsx` | D2.1 analyze, candidates, verify |
| Provider setup / territory | Hub setup workflow | `UciSetupWorkflow.tsx`, `UciProviderResolutionPanel.tsx` | Provider resolution + init |
| Document vault (project docs) | Via package document candidates + `project_documents` | `uci-package-document-bridge.service.js` | PEPCO portal + uploads |
| Dedicated Lovable-style Builder page | **Missing** | — | Not mounted in `src/App.tsx` |

**Access / audit:** PP does **not** mount Lovable `RequireUciAccess`. UCI APIs enforce JWT + `requireProjectAccess` (`uci-access.service.js`). Role matrix / `access_audit_log` unchanged by this work.

### 2.2 Backend APIs (reuse — do not duplicate)

| Capability | Endpoint / service | Frontend client |
|------------|--------------------|-----------------|
| List coordination for project | `GET /api/uci/projects/:id/coordination` | `listProjectCoordination` |
| Provider resolution / setup | `…/provider-resolution`, `…/provider-setup` | `getProjectProviderResolution`, `getProjectProviderSetup` |
| Coordination detail (apps, milestones, …) | `GET /api/uci/coordination/:id` | `getCoordinationDetail` |
| Load profile analyze | `POST …/load-profile/analyze` (via existing service) | `analyzeCoordinationLoadProfile` |
| Load candidates / verify | load-candidate routes | `extract…`, `resolve…`, `add…ManualVerifiedValue` |
| **Build application package draft** | `POST /api/uci/coordination/:id/applications` → `runApplicationPackageBuild` | `buildCoordinationApplicationPackage` |
| Document candidates | `GET …/application-package/document-candidates` | `listApplicationPackageDocumentCandidates` |
| Confirm / remove doc mapping | `POST /api/uci/applications/:id/package-documents/{confirm,remove}` | confirm/remove helpers |
| Human review | `POST /api/uci/applications/:id/review` | `reviewCoordinationApplication` |
| Submit | `POST /api/uci/applications/:id/submit` → dry-run by default for Pepco | `submitCoordinationApplication` |
| Utility providers directory | `GET /api/uci/providers` | `listUciProviders` |
| Templates (Pepco electric) | `uci/application-templates/pepco/electric-new-service.json` | Loaded server-side only |

### 2.3 Supabase persistence (real)

| Entity | Table / storage | Used by Builder? |
|--------|-----------------|------------------|
| Project | `projects` (name, address, project_type, description, client_name) | Prefill service/site address |
| Coordination | `coordination_records` (+ embedded `utility_providers`) | Provider, utility_type, energization_target_date, contacts |
| Applications / drafts | `coordination_applications` (`agent_draft`, idempotency keys) | Load profile + application package |
| Documents | `project_documents` + Pepco downloaded docs metadata | Exhibit slots |
| Territory / providers | provider resolution metadata + territory services | Prefill purveyor recommendation |
| Federal Tax ID / W-9 | **None** | Must not invent |

### 2.4 Pepco template required package (D3)

From `uci/application-templates/pepco/electric-new-service.json`:

**Documents:** `site_plan`, `single_line_diagram`, `equipment_cut_sheets`, `letter_of_authorization`  

**Fields:** `project_address`, `project_type`, `project_description` (optional), `connected_load_data` (verified load only)

Lovable’s five exhibit labels are **marketing names**, not the Pepco template keys. Implementation must show **real template slots** when a package exists, and keep Lovable labels only as Coming Soon placeholders when no package/template is loaded.

---

## 3. Step-by-step capability classification

Legend: **(1) fully now** · **(2) partially now** · **(3) blocked** · **(4) UI-only / future**

### Step 01 — Service requested

| Element | Class | Backend support | Notes |
|---------|-------|-----------------|-------|
| Project | (1) | `projects` + selected project context | Replace hardcoded name |
| Purveyor + service | (1)/(2) | coordination + `utility_providers` + utility_type | Real when coordination exists; else prompt setup |
| Voltage / phase | (2) | load_summary verified/calculated (`service_voltage`, `voltage`, `phase`) | Show when present; empty otherwise — no fake 480 V |
| Service size / amperage | (2) | `amperage` / `service_amperage` in load summary | Same |
| Service type | (2) | template `application_type` / package metadata | e.g. new_service — not freeform portal enum UI |
| Target energization | (2) | `coordination_records.energization_target_date` | Real date or empty |
| Contact line | (2) | utility_contact_* / project client_name | Prefer coordination contacts; no invented emails |

### Step 02 — Load profile

| Element | Class | Backend support | Notes |
|---------|-------|-----------------|-------|
| Load metrics panel | (2) | D2.1 `load_summary` | Map **real** verified/calculated keys; omit Lovable-only metrics (load factor, coincident peak, GS-T, standby gen) unless present |
| “Pulled from Load Profile Analyzer” | (1) | Link to `/uci?section=load-profile` | Deep-link to existing workspace |
| Run analyze from Builder | (2) | `analyzeCoordinationLoadProfile` | Optional CTA; primary analyze stays in Load Profile tab |

### Step 03 — Site & access

| Element | Class | Backend support | Notes |
|---------|-------|-----------------|-------|
| Service entrance address | (1)/(2) | project.address / package `project_address` | Prefill + show source |
| Parcel ID, connection point, crane, clearance, hours | (3)/(4) | **None** | Visible Coming Soon — no localStorage fake persistence |

### Step 04 — Owner & billing

| Element | Class | Backend support | Notes |
|---------|-------|-----------------|-------|
| Account-holder / billing fields | (3) | No secure UCI billing store | **Coming Soon** — inputs disabled |
| Federal Tax ID | (3) | **Blocked** | Do not collect, persist, or display; hide value fields from client-role surfaces |
| W-9 verification (review step) | (3) | None | Coming Soon |

### Step 05 — Drawings & exhibits

| Element | Class | Backend support | Notes |
|---------|-------|-----------------|-------|
| Required exhibit slots | (1) | Template + `package_documents` | After package build |
| Attach / map document | (1) | document-candidates + confirm mapping | Human confirmation required (existing rule) |
| Lovable-only exhibit names without package | (4) | — | Show Coming Soon list until package built, then switch to real slots |

### Step 06 — Review & submit

| Element | Class | Backend support | Notes |
|---------|-------|-----------------|-------|
| Required fields present | (1) | `missing_fields` / package_status | Real checklist |
| Load profile within tariff bounds | (3)/(4) | No tariff engine | Coming Soon |
| Exhibits sealed by EOR | (3)/(4) | No seal verification | Coming Soon |
| Account-holder vs W-9 | (3) | None | Coming Soon |
| Agent QA passed | (3)/(4) | No agent QA service | Coming Soon — never hardcode “passed” |
| Mark reviewed | (1) | `POST …/review` | Real |
| Submit | (2) | `POST …/submit` | Pepco **validation dry-run by default**; live submit gated — must report honestly |

### Chrome actions

| Action | Class | Notes |
|--------|-------|-------|
| Progress % | (2) | Derive from **real** section readiness — never pre-seed fake completes |
| Save draft | (2) | Map to **rebuild/save application package** when deps met; else disabled + helper |
| Submit header CTA | (2) | Same as review submit; disabled until `draft_status === reviewed` |
| Mark complete & continue | (2) | Only mark complete when section readiness is true; else show why |

---

## 4. Exact blockers

1. **No secure owner/billing / Federal Tax ID persistence** in UCI schema or APIs.  
2. **No site logistics fields** (parcel, crane, clearance, restricted hours) in coordination model.  
3. **No Agent QA / tariff-bounds / EOR seal / W-9 verification services.**  
4. **Lovable exhibit labels ≠ Pepco template keys** — cannot pretend Attach works for marketing names.  
5. **Live Pepco portal submit** disabled unless explicit live-submission flag + approval (demo/shared Supabase risk).  
6. **Multi-purveyor Builder outputs** beyond Pepco electric template are template-gated (`TEMPLATE_NOT_FOUND`).  
7. **Package build requires** prior load-profile draft (`LOAD_PROFILE` dependency) + provider context.  
8. **PP has no Lovable `RequireUciAccess` front-gate** — must not invent a new access-audit path; keep project-access model.

---

## 5. Implementation scope for this pass

### In scope

1. Mount dedicated page **`/uci/application-builder`** preserving Lovable 6-step chrome (all sections visible).  
2. Wire **real** project, coordination/provider, load summary, address, package docs, review, and submit via existing `uciApi` + helpers (`uciApplicationPrep`, `uciLoadProfile`).  
3. Replace hardcoded Valvoline/Pepco/load metrics with live data or honest empty states.  
4. Progress % from real section readiness.  
5. Save draft → `buildCoordinationApplicationPackage` when eligible.  
6. Document mapping using real candidates (no auto-select first candidate).  
7. Submit shows dry-run / human_required / failed honestly — **no fake success**.  
8. Owner & billing + sensitive Tax ID: Coming Soon / disabled; no insecure storage.  
9. Site logistics extras + Agent QA + tariff/EOR/W-9 checks: Coming Soon.  
10. Nav/command palette: Application Builder → `/uci/application-builder`; keep drawer Application prep functional.  
11. Mark `/uci/application-builder` as real/mixed in demo-route provenance (like DesignCheck).  
12. Tests for readiness helpers + route registration; build/typecheck.

### Out of scope

- New Supabase migrations / Tax ID vault  
- Live Pepco submit enablement  
- New agent QA / tariff / seal services  
- Changing UCI access-audit or role tables  
- Replacing or removing `ApplicationPrepSection` in the drawer  
- Unrelated routes / DesignCheck / scraper territory data

---

## 6. Features that remain Coming Soon (this pass)

- Owner & billing persistence (all six Lovable fields)  
- Federal Tax ID capture / display / storage  
- Parcel ID, primary connection point, crane access, working clearance, restricted hours  
- Agent QA automation (“Agent QA passed”)  
- Tariff-bounds validation  
- EOR seal verification  
- W-9 / account-holder verification  
- Live Pepco portal submit (unless env flag + explicit human approval)  
- Cross-utility Builder templates beyond available manifests  
- Fake Lovable exhibit names as attachable slots (until mapped to real template keys via package build)

---

## 7. PP UCI routes inspection summary (feat branch)

| Path | Status |
|------|--------|
| `/uci` | Live hub + coordination drawer |
| `/uci?section=application-builder` | Deep-link → Application prep tab |
| `/uci/application-builder` | **Not registered** before this pass |
| Lovable-only `/uci/*` pages | Reference only; not mounted in PP |

**Decision:** Add dedicated Builder page for Lovable visual parity **without** removing drawer Application prep (functional preservation).

---

## 8. Verification checklist (Phase 2)

- [x] All six Lovable sections visible (`/uci/application-builder`)  
- [x] Real actions use real data and persist via existing APIs (package build/map/review/submit)  
- [x] Blocked actions labeled Coming Soon; only unavailable action disabled  
- [x] Refresh keeps supported saved package/load/coordination data (Supabase drafts)  
- [x] No misleading success / fake % (progress from readiness; dry-run honesty)  
- [x] Federal Tax ID not stored or shown (disabled Coming Soon; no persistence)  
- [x] Builds + relevant tests pass (`tsc`, `vite build`, readiness/route/demo-route tests)  
- [x] No commit/push/deploy unless requested  

**Implemented:** 2026-08-05 on `feat/lovable-ui-replication` (uncommitted until requested).
