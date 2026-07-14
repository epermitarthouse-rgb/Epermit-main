# UCI Delivery Roadmap

**Canonical implementation plan for Utility Coordination Intelligence**

| Field | Value |
|-------|-------|
| Client specification | CET-2026-UCI-BACKEND-001 |
| Architecture companion | `UCI_ARCHITECTURE.md` |
| Compliance matrix | `UCI_COMPLIANCE_CHECKLIST.md` |
| Historical sprints | `UCI_EXECUTION_HISTORY.md` |

---

## 1. Source of Truth

1. **Client specification** (CET-2026-UCI-BACKEND-001) — lifecycle, agents, schema, APIs, security, McDonald's pilot phasing.
2. **This document** — delivery milestones D1–D12, dependencies, acceptance criteria.
3. **`UCI_ARCHITECTURE.md`** — adapter model, tenant strategy, storage, jobs.
4. **Codebase** — actual behavior overrides any unchecked documentation claim.

Engineering extensions are labeled explicitly and do not override client requirements.

---

## 2. Current Baseline

### Implemented or working (partial+)

| Capability | Status | Evidence |
|------------|--------|----------|
| `/api/uci` router + auth | implemented | `uci.routes.js`, `uci-access.service.js` |
| Seven UCI tables + project RLS | implemented (schema) | `20260509120000_uci_foundation.sql` |
| Human-assisted provider setup (D2.0) | partial | `uci-provider-setup.service.js`; guided init UI |
| Load profile foundation (D2.1) | partial | `uci-load-profile.service.js`; missing-input inventory; no numeric templates |
| Application preparation (D3) | partial | `uci-application-builder.service.js`; PEPCO template manifest; review workflow |
| Manual provider init | partial | Superseded by D2.0 guided flow; legacy path without `provider_setup` |
| Manual stage transitions + audit | implemented | `uci-transitions.service.js` |
| PEPCO login/MFA/resume | partial | `login-flow.js`, session store, modal UI |
| PEPCO dashboard discovery | partial | metadata `pepco_dashboard_discovery` |
| PEPCO app detail scrape | partial | overview, status, messages, docs → metadata + Supabase storage |
| PEPCO UI panel | partial | `PepcoApplicationDetailsPanel.tsx` |
| Normalized applications/comms/milestones | partial | D1A sync services + `POST .../sync` |
| PEPCO document storage (D1B) | partial+ | Supabase `project-documents`; production hardened |
| 10 utility provider seed | implemented | global `utility_providers` |
| Encrypted portal credentials | implemented | Sprint 1 |

### Stub / UI only

| Capability | Status |
|------------|--------|
| Normalized applications section in UI | partial | Reads `coordination_applications` after sync; D3 ApplicationPrepSection |
| Costs / equipment / milestones / comms cards | partial | Normalized comms/milestones readable; D5 classify UI; D7–D10 APIs without dedicated drawer sections |
| Portfolio / action queue / stage summary | partial | D11 `portfolio_view` API; no portfolio screen in UI |

### Missing or blocked

| Capability | Status |
|------------|--------|
| Full Agent 1 auto territory mapping | **blocked** (D2.2) | No verified `service_territory` / geocoding; ZIP/county/jurisdiction inference prohibited |
| PEPCO portal live submit | **blocked** (D4) | `501 SUBMIT_ADAPTER_NOT_IMPLEMENTED`; dry-run path not yet built |
| BGE automation | missing | Manual/email fallback until adapter exists |
| Tenant propagation + tenant RLS | **implemented** (code + migrations staged) | Row 2: `tenants`, `tenant_memberships`, `projects.tenant_id`, propagation triggers, tenant RLS — **not applied in production** |
| Inbound email webhook | missing | D5 — reuse Commun-ET mailbox; Graph preferred; external access |
| QuickBooks UCI actions | missing | D7 — reuse billing module OAuth; no second integration |
| Escalate API | missing | D12 partial |
| P50/P90 ML prediction | deferred | Client Phase 5 |

---

## 3. Status Legend

| Label | Use when |
|-------|----------|
| **implemented** | End-to-end verified |
| **partial** | Real code path exists; incomplete or not production-ready |
| **stub/UI only** | Schema or UI without operational writes |
| **missing** | Not built |
| **deferred** | Client spec Phase 4–5 / explicit DEFER |

---

## 4. Client Pilot Phase Mapping

The client specification (§7) defines **McDonald's pilot phases 1–3**. Delivery milestones **D1–D12** are dependency-driven engineering phases. Where they differ, both are listed.

### Client Phase 1 (in pilot)

**Client requires:** Agents 1, 2, 3, 4, 8, 9, 11, 12; full schema; basic dashboards; portal automation for 10 priority utilities; email-first fallback for others.

| Client Phase 1 item | Delivery milestone(s) | Order note |
|---------------------|----------------------|------------|
| Schema + RLS | Done (baseline) + **D1** tenant hardening | D1 extends schema |
| Agent 1 Provider Mapper | **D2** | |
| Agent 2 Load Profile | **D2** | |
| Agent 3 Application Builder | **D3** | |
| Agent 4 Submission | **D4** | |
| Agent 8 CIAC/Costs | **D7** | Client Phase 1 includes Agent 8 **before** Agents 5–6 in pilot calendar |
| Agent 9 Equipment | **D8** | Client Phase 1 includes Agent 9 before Agents 5–6 |
| Agent 11 Meter Set | **D9** | |
| Agent 12 Energization/Closeout | **D10** | |
| Portal automation (10 utilities) | **D1** (read-only PEPCO) + **D4** (submit PEPCO first) | PEPCO partial today; BGE not started |
| Basic dashboards | Baseline + **D1** UI + **D11** portfolio | |

**Explicit difference:** Client Phase 1 bundles Agents 8, 9, 11, 12 **before** Agents 5–6. Delivery order places **D5–D6 (communications, COS)** after **D4 (submission)** but **before D7–D10** for dependency reasons on normalized comms — **client pilot calendar should prioritize D7–D10 earlier if McDonald's timeline requires Agent 8–12 before classifier (Agent 5)**. See §5.

### Client Phase 2 (in pilot)

**Client requires:** Agents 5, 6; QuickBooks extension for Agent 8; heuristic P50/P90.

| Client Phase 2 item | Delivery milestone |
|---------------------|-------------------|
| Agent 5 Communication Parser | **D5** |
| Agent 6 COS Analyst | **D6** |
| QuickBooks (Agent 8 extension) | **D7** |
| Heuristic P50/P90 | **D11** |

### Client Phase 3 (in pilot)

**Client requires:** Portfolio dashboards, quarterly reporting, McDonald's tenant configuration.

| Client Phase 3 item | Delivery milestone |
|---------------------|-------------------|
| Portfolio view API | **D11** |
| Quarterly reporting templates | **D11** |
| McDonald's tenant config | **D11** (requires client input) |

### Client deferred (Phase 4–5)

| Item | Delivery milestone |
|------|-------------------|
| Agent 7 Easement & ROW | Deferred §7 |
| Agent 10 Inspection Release | Deferred §7 |
| ML prediction, full knowledge graph | Deferred §7 |

---

## 5. Dependency Map

```text
Baseline (done/partial)
    │
    ▼
D1 Normalized read-only + tenant + storage + durable job foundation
    │
    ├──► D2 Provider mapping + load profiles (Agents 1–2)
    │         │
    │         ▼
    │    D3 Application prep + review (Agent 3)
    │         │
    │         ▼
    │    D4 Submission (Agent 4) ──► PEPCO first; email fallback
    │
    ├──► D5 Communications (Agent 5) ── depends on D1 normalized comms
    │         │
    │         ▼
    │    D6 COS analyst (Agent 6)
    │
    ├──► D7 Costs/CIAC (Agent 8) ── can parallel after D1; client Phase 1 priority
    ├──► D8 Equipment (Agent 9)
    ├──► D9 Meter set (Agent 11)
    └──► D10 Energization/closeout (Agent 12)

D11 Portfolio + P50/P90 ── after normalized data from D1+ 
D12 Operations/events/alerts ── cross-cutting; wire incrementally from D1
```

**Client calendar conflict resolution:** If pilot schedule requires Agent 8–12 before Agent 5, execute **D7–D10 in parallel with D3–D4** after **D1** completes, without waiting for D5–D6. Do not omit Agent 5–6 — schedule per client Phase 2.

---

## 6. Delivery Milestones D1–D12

---

### D1 — Normalized Read-Only Foundation

| Field | Content |
|-------|---------|
| **Objective** | Reusable, tenant-safe, production-ready portal sync framework from existing PEPCO read-only work |
| **Client requirements** | Schema (done); portal read tracking; multi-tenancy foundation (§6); object storage (§5.5); idempotency |
| **Dependencies** | Baseline PEPCO scrapers |
| **Current status** | **partial** — D1A–D1D complete; tenant RLS hardening remains in broader D1 |

#### D1 sub-phase status

| Sub-phase | Status | Evidence |
|-----------|--------|----------|
| **D1A** — Adapters + normalized writes | **implemented** | `uci-portal-sync.service.js`, `pepco.adapter.js`, migration `20260708120000_uci_d1a_normalized_readonly.sql`, routes + tests |
| **D1B** — Production document storage | **implemented** | `uci-document-storage.service.js`; Supabase `project-documents`; production local-disk disabled by default |
| **D1C** — Lifecycle mapping | **implemented** | `uci-lifecycle-mapping.service.js`; PEPCO `mapPortalStatusToLifecycle`; proposals in `metadata.uci_lifecycle_proposals`; auto-apply behind `UCI_AUTO_STAGE_TRANSITIONS` |
| **D1D** — Durable sync jobs | **implemented** | `uci_portal_sync` on `scrape_jobs`; worker loop; `UCI_DURABLE_JOBS_ENABLED`; sync-runs API |

**Database changes:** `tenant_id` backfill on coordination + child tables; indexes; optional `external_*` columns on applications; RLS policy updates (target tenant-aware).

**Backend changes:** `adapters/`, `uci-portal-sync.service.js`, `uci-portal-application-sync.service.js`, `uci-communication-sync.service.js`, `uci-milestone-sync.service.js`, `uci-lifecycle-mapping.service.js`, `uci-document-storage.service.js`; wrap existing PEPCO services.

**Adapter changes:** `pepco.adapter.js`, `generic-readonly.adapter.js`, registry; no physical move of `scrapers/pepco/` yet.

**API changes:** `GET .../communications`, `.../milestones`, `.../documents`, `.../sync-runs`; `POST .../sync`; retain PEPCO routes during transition.

**Frontend changes:** Normalized sections; updated banner; sync status/warnings; keep PEPCO diagnostic panel.

**Security:** Tenant propagation; cross-tenant tests; no path/token leakage.

**Tests:** Sync idempotency; tenant isolation; PEPCO E2E read-only regression.

**Acceptance criteria:**
- PEPCO read-only E2E still works
- Repeated syncs do not duplicate normalized rows
- Documents outside `debug/pepco-docs` in production mode
- `tenant_id` populated from project
- Lifecycle proposals visible + audited (auto-apply behind `UCI_AUTO_STAGE_TRANSITIONS` flag)
- Legacy metadata views remain

**Exclusions:** AI classification; submission; BGE adapter; durable job full cutover (interfaces + flag OK).

**Engineering extensions:** `UCI_AUTO_STAGE_TRANSITIONS`, `UCI_DURABLE_JOBS_ENABLED`, deterministic attention flags without AI.

---

### D2 — Provider Mapping and Load Profiles

| Field | Content |
|-------|---------|
| **Objective** | Agents 1–2: provider confirmation + structured load schedules |
| **Client requirements** | Agent 1 §4.1; Agent 2 §4.2; McDonald's prototype templates |
| **Dependencies** | D1 tenant + provider directory hardening |
| **Current status** | **partial** — D2.0 + D2.1 complete (scoped); D2.2 full Agent 1 auto mapping **blocked** (no territory data/geocoding); D3 foundation complete (scoped) |

#### Jurisdiction and provider model (decision 2026-07-15)

- **Every project** from every supported PermitPilot jurisdiction **can enter UCI**.
- Jurisdiction scrapers supply project context, address, plans, specs, equipment docs, permit docs, contacts, dates — **do not rescrape all jurisdictions for UCI** unless data is missing or stale.
- **Utility coordination is separate** from municipal permit jurisdiction.
- A project may have **multiple utility providers**; each confirmed provider gets **its own `coordination_record`**.
- Provider adapters run **only** for confirmed providers serving the project — **do not assume PEPCO serves every jurisdiction**.

#### D2 sub-phase status

| Sub-phase | Status | Evidence |
|-----------|--------|----------|
| **D2.0** — Human-assisted provider setup | **implemented** | `uci-provider-setup.service.js`; `GET .../provider-setup`; guided init UI; `metadata.uci_provider_mapping`; **current safe fallback** |
| **D2.1** — Load profile foundation (Agent 2) | **implemented** (scoped) | `uci-load-profile.service.js`; `POST .../load-profile/analyze`; `load_summary` on `agent_draft`; no-guess rule; drawer UI |
| **D2.2** — Auto territory mapping (full Agent 1) | **deferred** | **External data:** verified `service_territory` rules + geocoding vendor; **must not** infer providers from ZIP, county, or permit jurisdiction without verified rules |

**Provider workflow rules:**
- Human-assisted confirmation remains the **current safe fallback** (D2.0).
- Full automatic territory mapping stays under **D2.2** only.
- Providers **without portal adapters** continue through manual or email-assisted workflows (D4 `email_intent`).
- PEPCO is the first fully automated provider; other utilities use shared lifecycle until adapters exist.

**Database:** Tenant-scoped `utility_providers`; `service_territory`; SLA fields operational.

**Backend:** D2.1 writes `coordination_applications.load_summary` (`record_source=agent_draft`). D2.2 provider mapper remains future.

**API:** `GET /projects/:id/provider-setup`; `POST .../coordination/init` optional `provider_setup`; `POST /coordination/:id/load-profile/analyze`.

**Frontend:** D2.0 guided provider setup; D2.1 read-only Load Profile drawer with Analyze/Re-analyze.

**No-guess engineering rule (D2.1):** `calculated_values` empty unless explicit user data, verified equipment, or approved in-repo templates. **Square footage alone must not produce** kW, amperage, voltage, phase, meter count, BTU/h, GPM, DFU, or service size. Missing data appears in `missing_inputs` and `needs_verification`. Verified McDonald's/QSR templates remain **external data** (NB-D2-007).

**Acceptance (D2.1 scoped):** Per-utility missing-input inventory; idempotent agent_draft upsert; portal_sync untouched; stage unchanged when inputs missing.

**Acceptance (D2.2 / full Agent 1):** Auto mapping from **verified** territory data only; blocked/ambiguous states; no ZIP/county/jurisdiction guessing.

**Exclusions:** Guessed engineering values; McDonald's templates until verified in repo; LLM document parsing; geocoding without vendor; BGE automation; inferring providers without verified rules.

**Engineering extensions:** `coordination_records.metadata.uci_provider_mapping`; `load_summary` version `d2.1-v1`.

---

### D3 — Application Preparation and Review

| Field | Content |
|-------|---------|
| **Objective** | Agent 3 — draft packages; human review mandatory |
| **Client requirements** | Agent 3 §4.3; states `draft` / `reviewed` / `needs_changes` / `submitted` / `failed` |
| **Dependencies** | D2 load_summary |
| **Current status** | **partial** (scoped) — foundation complete; no filled PEPCO forms |

**Database:** `coordination_applications` writes; `package_documents`, `agent_draft_metadata`.

**Backend:** `uci-application-builder.service.js`; template registry `uci/application-templates/pepco/electric-new-service.json`.

**API:** `POST /coordination/:id/applications`; `POST /applications/:id/review`.

**Frontend:** `ApplicationPrepSection` in coordination drawer; submit disabled until `reviewed`.

**Acceptance (scoped):** PEPCO template manifest first; idempotent `agent_3_application_package:d3-v1` draft; separate row from D2.1 load profile; no auto-submit; human review gates.

**Exclusions:** Portal submission (D4); load calculation worksheet generation; McDonald's templates; LLM document parsing.

**No-guess rule:** `connected_load_data` field marked missing when `calculated_values` empty; square footage does not populate forms.

---

### D4 — Submission and Confirmation

| Field | Content |
|-------|---------|
| **Objective** | Agent 4 — human-triggered portal/email submit + confirmation capture |
| **Client requirements** | Agent 4 §4.4; idempotency; stages 4→5 transitions |
| **Dependencies** | D3 reviewed application |
| **Current status** | **partial** — API + email_intent path; PEPCO portal adapter not implemented |

**PEPCO scope:** PEPCO automation applies **only** to PEPCO coordination records. UCI is available for all jurisdictions; other utilities use `email_intent` until adapters exist.

**Target PEPCO portal behavior (D4 — not yet built):**
- Reuse existing Playwright/session infrastructure (`scrapers/pepco/`, `uci-pepco-session-store.js`)
- **Human review required** before final submission (`draft_status=reviewed` gate — already enforced)
- Support **dry-run** or **stop-before-final-submit** mode for development/staging
- Persist: submitted fields, attachment list, actor, timestamp, confirmation/ticket number, submission evidence
- Enforce idempotency (`submitted_at IS NULL` gate — partial today)
- **Do not submit real applications** during development without safe live access

**Submission complete definition:** Actual submit + attachments + confirmation/ticket + evidence + actor/timestamp. `email_intent` alone is **not** complete. See `UCI_ARCHITECTURE.md` §11.

**Backend:** `uci-application-submit.service.js`; safety gates (`reviewed`, idempotency via `submitted_at`).

**API:** `POST /applications/:id/submit` — JWT + project access.

**Behavior:** Non-PEPCO providers record `email_intent` submission and advance stages 4→5. PEPCO returns `501 SUBMIT_ADAPTER_NOT_IMPLEMENTED`.

**Blockers (unchanged):** Live form mapping + verified test access — **external access** + **live verification**.

**Acceptance (scoped):** Review gate enforced; duplicate submit blocked; stage transitions on email_intent success.

**Exclusions:** Live PEPCO portal form submit (blocked); outbound email delivery (D5/D4 email); BGE adapter.

---

### D5 — Communication Intelligence

| Field | Content |
|-------|---------|
| **Objective** | Agent 5 — 11-category classification, threading, attention queue |
| **Client requirements** | Agent 5 §4.5; inbound email §5.3; needs-attention API |
| **Dependencies** | D1 normalized `coordination_communications` |
| **Current status** | **partial** (scoped) — portal-sync classifier foundation; no inbound email |

**Email workflow direction (decision 2026-07-15):**
- Reuse existing **Commun-ET permitting mailbox** — no alternate provider unless mailbox cannot support workflow
- Prefer **Microsoft Graph** when mailbox is M365 (`microsoft_mailbox_connections`)
- Inbound + outbound; attachment capture; threading preservation
- Match on: provider, utility reference, project address, subject, sender
- Uncertain matches → human review; full audit history on `coordination_communications`
- **External access:** mailbox permissions + inbound webhook security design (NB-D5-001)

**Backend:** `uci-communication-categories.js` (11 client categories); `uci-communication-classifier.service.js` (deterministic keyword classifier, no AI); `emitUciEvent` on classify/reclassify.

**API:** `POST /coordination/:id/communications/classify`; `GET /communications/needs_attention`; `POST /communications/:id/reclassify`.

**Frontend:** Classify button + classification badges in communications drawer (`UciDashboard.tsx`, `uciCommunicationClassifier.ts`).

**Acceptance (scoped):** Portal-synced messages classified idempotently; human reclassify preserved; low-confidence → `needs_human_attention`; skips already human-reclassified rows.

**Exclusions:** Inbound email webhook (`POST /webhooks/uci/email-inbound`); ≥85% validation set; LLM/Claude classifier; email threading across providers.

---

### D6 — COS and Design Review

| Field | Content |
|-------|---------|
| **Objective** | Agent 6 — parse COS/design docs; discrepancy vs load summary |
| **Client requirements** | Agent 6 §4.6 |
| **Dependencies** | D5 classification (COS trigger categories); D2.1 load profile |
| **Current status** | **partial** (scoped) — discrepancy analysis foundation |

**Backend:** `uci-cos-analyst.service.js`; triggers on `class_of_service` / `design_review_response` classifications.

**API:** `POST /coordination/:id/cos/analyze` — JWT + project access; `stage_unchanged: true`.

**Acceptance (scoped):** Structured discrepancy report in `coordination_records.metadata.uci_cos_analysis`; flags missing load profile or COS comms; human attention on material gaps.

**Exclusions:** Document content parsing; auto stage-6 transitions; filled PEPCO COS forms.

---

### D7 — Costs and CIAC

| Field | Content |
|-------|---------|
| **Objective** | Agent 8 — cost tracking + QuickBooks |
| **Client requirements** | Agent 8 §4.8; QB §5.7 |
| **Dependencies** | D1 |
| **Current status** | **partial** (scoped) — manual cost CRUD; QuickBooks UCI bridge not wired |

**QuickBooks direction (decision 2026-07-15):**
- **Reuse** existing billing integration — `scraper-service/app/services/quickbooks/` (OAuth, API, token store, invoice trigger patterns)
- **Do not** build a second QuickBooks integration
- Always persist `coordination_costs` first
- **No automatic** accounting entries
- Explicit reviewed actions: draft vendor bill, draft client invoice, or both
- Store QB IDs, sync status, errors, idempotency references; prevent duplicates

**Backend:** `uci-costs.service.js` — list + upsert `coordination_costs`.

**API:** `GET /coordination/:id/costs`; `POST /coordination/:id/costs`.

**Acceptance (scoped):** Cost rows persisted with `cost_type`; estimate/actual/variance fields supported in schema; no QB sync yet.

**Exclusions:** Automatic QB posting; variance alerts; stage-7 auto-advance until reviewed actions exist.

---

### D8 — Equipment and Long-Lead

| Field | Content |
|-------|---------|
| **Objective** | Agent 9 — ETA tracking cron |
| **Client requirements** | Agent 9 §4.9 |
| **Dependencies** | D1 |
| **Current status** | **partial** (scoped) — CRUD + check-in; no cron |

**Operational baseline (checklist fields):** equipment type, order status, vendor, ETA, latest check-in, delay risk, owner, notes.

**Backend:** `uci-equipment.service.js` — list, create, check-in with ETA history in metadata.

**API:** `GET /coordination/:id/equipment`; `POST /coordination/:id/equipment`; `POST /equipment/:id/check-in`.

**Acceptance (scoped):** Equipment rows with status enum; check-in appends ETA history; slip detection deferred.

**Exclusions:** Weekly cron; >2-week slip alerts; vendor portal integration.

---

### D9 — Meter Set and Pre-Energization

| Field | Content |
|-------|---------|
| **Objective** | Agent 11 — meter set choreography |
| **Client requirements** | Agent 11 §4.11 |
| **Dependencies** | D1 milestones table |
| **Current status** | **partial** (scoped) — checklist + milestone row |

**Operational baseline (checklist fields):** utility approval, inspection release, site readiness, equipment installed, payment complete, meter date, confirmation/reference.

**Backend:** `uci-meter-set.service.js` — 48h checklist in metadata; upserts `meter_set_scheduled` milestone.

**API:** `POST /coordination/:id/meter-set/prepare` — JWT + project access; `stage_unchanged: true`.

**Acceptance (scoped):** Checklist generated; milestone row created; human completion required.

**Exclusions:** Failed-set escalation; auto stage-9 advance; inspection-release integration (Agent 10 deferred).

---

### D10 — Energization and Closeout

| Field | Content |
|-------|---------|
| **Objective** | Agent 12 — closeout package + stage 10 |
| **Client requirements** | Agent 12 §4.12 |
| **Dependencies** | D7–D9 artifacts (optional for foundation) |
| **Current status** | **partial** (scoped) — closeout checklist in metadata |

**Operational baseline (checklist fields):** service energized, final meter confirmed, commissioning complete, costs closed, final documents archived, closeout package generated.

**Coordination complete definition:** Service energized + final meter set + commissioning verified + costs closed + closeout documents archived. Utility approval or application review alone is **not** coordination complete. See `UCI_ARCHITECTURE.md` §11.

**Backend:** `uci-closeout.service.js` — checklist in `metadata.uci_closeout_package`.

**API:** `POST /coordination/:id/closeout/prepare` — JWT + project access; `stage_unchanged: true`.

**Acceptance (scoped):** Closeout checklist generated; readiness flags from costs/equipment/comms counts.

**Exclusions:** Closeout PDF generation; project rollup to stage 10; knowledge graph (client deferred).

---

### D11 — Portfolio Intelligence

| Field | Content |
|-------|---------|
| **Objective** | Client Phase 3 — portfolio view, P50/P90, reporting |
| **Client requirements** | §4.13 heuristic; §5.1 portfolio_view; Phase 3 reporting |
| **Dependencies** | Normalized data D1+ |
| **Current status** | **partial** (scoped) — API rollup; no UI screen |

**Backend:** `uci-portfolio.service.js` — stage summary, attention comms count, per-record risks.

**API:** `GET /projects/:projectId/portfolio_view` — JWT + project access.

**Acceptance (scoped):** Stage counts, needs-attention comm count, coordination record list with stage/state.

**Exclusions:** P50/P90 heuristic dates; quarterly export templates; McDonald's tenant config (client input required); portfolio UI screen.

---

### D12 — Operations and Observability

| Field | Content |
|-------|---------|
| **Objective** | Event bus, structured logs, alerts, runbooks |
| **Client requirements** | §5.2 events; §9 observability/alerting/runbooks |
| **Dependencies** | Incremental from D1 |
| **Current status** | **partial** (scoped) — in-memory event ring buffer |

**Backend:** `uci-events.service.js` — `emitUciEvent`, `listRecentUciEvents` (200-entry ring buffer); wired from D5 classify/reclassify.

**API:** `GET /events/recent` — JWT required.

**Acceptance (scoped):** Recent `uci.*` events queryable; no external bus or alerting.

**Exclusions:** P0/P1/P2 alerts; runbooks; `POST /coordination/:id/escalate`; downstream consumers; full E1–E16 event catalog.

---

### D13 — UCI Hardening and Deferred-Gap Closure

| Field | Content |
|-------|---------|
| **Objective** | Close remaining non-blocking gaps accumulated across D1–D12 without expanding client-deferred major features |
| **Client requirements** | Pilot hardening, audit completeness, operational reliability — not a substitute for Agents 7/10 or Phase 4–5 deferrals |
| **Dependencies** | Feature milestones D1–D12 substantially complete |
| **Current status** | **partial** — Priority 1 frontend workflows wired; integration tests added; §17 backlog partially closed (2026-07-15) |

**Tenant and security (architecture work — no migration in doc pass):**
- Use existing **organization/project/project-team** structure as starting point: `projects` → `project_team_members` → `has_project_access` → UCI child records
- Target: discover tenant/org field in schema; propagate to UCI children; tenant + project access enforcement; demo-account isolation
- Cross-project tests: partial (`uci-d13-routes-integration.test.js`)
- Cross-tenant tests: blocked until real `tenant_id` field operational
- Replace `unconfigured` storage path when ownership data available

**Scope (from backlog):** Partial implementations; deferred hardening; UI gaps; audit gaps; test gaps; documentation drift; provider adapter coverage beyond PEPCO; operational reliability (MFA restart, durable worker browser phases, tenant paths); live verification gates.

**Exclusions:** Agent 7 (Easement/ROW), Agent 10 (Inspection Release), ML energization prediction, full Closeout Knowledge Graph — remain client-deferred unless scope changes.

**Acceptance:** All §17 backlog items either resolved with evidence or explicitly classified with blocker evidence; no silent partial→complete relabeling.

---

## 7. Deferred Agents and Features

| Item | Status | Client ref |
|------|--------|------------|
| Agent 7 — Easement & ROW | deferred | §4.7 Phase 4 |
| Agent 10 — Inspection Release | deferred | §4.10 Phase 4 |
| ML energization prediction | deferred | §4.13 Phase 5 |
| Closeout Knowledge Graph (full) | deferred | §4.14 Phase 5 |
| Cross-Utility Conflict Hunter (full) | deferred | §4.14 |
| Easement Holdout Resolver | deferred | Phase 4–5 |
| BGE automation | not started | Client Phase 1 utility list — future adapter |

**In scope but not yet scheduled:** Basic conflict flagging; basic closeout history index (client §4.14) — assign to D10/D11 when specified.

---

## 8. API Matrix

| Spec / planned endpoint | Implemented | Planned milestone | Auth today |
|-------------------------|-------------|-------------------|------------|
| `GET /projects/:id/coordination` | ✅ | baseline | JWT + project |
| `GET /coordination/:id` | ✅ | baseline | JWT + project |
| `POST /coordination/:id/transition` | ✅ | baseline | JWT + project |
| `POST /projects/:id/coordination/init` | ✅ | D2.0 (optional `provider_setup`) | JWT + project |
| `POST /coordination/:id/load-profile/analyze` | ✅ | D2.1 | JWT + project |
| `GET /projects/:id/provider-setup` | ✅ | D2.0 | JWT + project |
| `GET /providers` | ✅ | baseline (not tenant-scoped) | JWT only |
| `GET /coordination/:id/applications` | ✅ | baseline | JWT + project |
| `POST /coordination/:id/applications` | ✅ | D3 | JWT + project |
| `POST /applications/:id/review` | ✅ | D3 | JWT + project |
| `POST /applications/:id/submit` | ✅ partial | D4 | JWT + project; PEPCO 501 |
| `POST /coordination/:id/lifecycle-proposals/apply` | ✅ | D13 | JWT + project |
| `POST /coordination/:id/lifecycle-proposals/reject` | ✅ | D13 | JWT + project |
| `GET /communications/needs_attention` | ✅ | D5 | JWT + project |
| `POST /communications/:id/reclassify` | ✅ | D5 | JWT + project |
| `POST /coordination/:id/cos/analyze` | ✅ partial | D6 | JWT + project |
| `GET /coordination/:id/costs` | ✅ partial | D7 | JWT + project |
| `POST /coordination/:id/costs` | ✅ partial | D7 | JWT + project |
| `GET /coordination/:id/equipment` | ✅ partial | D8 | JWT + project |
| `POST /coordination/:id/equipment` | ✅ partial | D8 | JWT + project |
| `POST /equipment/:id/check-in` | ✅ partial | D8 | JWT + project |
| `POST /coordination/:id/meter-set/prepare` | ✅ partial | D9 | JWT + project |
| `POST /coordination/:id/closeout/prepare` | ✅ partial | D10 | JWT + project |
| `GET /projects/:id/portfolio_view` | ✅ partial | D11 | JWT + project |
| `GET /events/recent` | ✅ partial | D12 | JWT |
| `GET /coordination/:id/communications` | ✅ | D1A | JWT + project |
| `GET /coordination/:id/milestones` | ✅ | D1A | JWT + project |
| `POST /coordination/:id/sync` | ✅ | D1A | JWT + project |
| `POST /coordination/:id/escalate` | ❌ | D12 | — |
| `GET /tenants/:id/utility_providers` | ❌ | D2 | — |
| PEPCO `.../discovery/pepco/*` | ✅ partial | D1 wrap | JWT + project |
| `GET /coordination/:id/sync-runs` | ✅ | D1D | JWT + project |
| `GET /coordination/:id/sync-runs/:jobId` | ✅ | D1D | JWT + project |
| `POST /coordination/:id/sync-runs/:jobId/cancel` | ✅ | D1D | JWT + project |
| `POST /webhooks/uci/email-inbound` | ❌ | D5 | — |

---

## 9. Database and Migration Matrix

| Table | Exists | Written by code | Target milestone | tenant_id today |
|-------|--------|-----------------|------------------|-----------------|
| `utility_providers` | ✅ | seed read | D2 tenant scope | ❌ global |
| `coordination_records` | ✅ | init, transitions, metadata | D1 normalize | nullable unused |
| `coordination_stage_transitions` | ✅ | init, manual | D1+ agents | via project |
| `coordination_applications` | ✅ | D1A portal_sync | D2–D4 | nullable unused |
| `coordination_communications` | ✅ | D1A portal_sync | D1, D5 | via project |
| `coordination_costs` | ✅ | D7 upsert | D7 | via project |
| `coordination_equipment` | ✅ | D8 create/check-in | D8 | via project |
| `coordination_milestones` | ✅ | D1A portal_sync | D1, D9 | via project |

**D1 migrations applied:** `20260708120000_uci_d1a_normalized_readonly.sql` (portal sync columns/indexes). **Remaining:** tenant RLS hardening; lifecycle mapping columns optional.

---

## 10. Agent Implementation Matrix

| Agent | Client pilot phase | Delivery milestone | Status | Notes |
|-------|-------------------|-------------------|--------|-------|
| 1 Provider Mapper | 1 | D2 | partial | D2.0 human-assisted only; auto mapping missing |
| 2 Load Profile | 1 | D2 | partial | D2.1 foundation; no numeric templates |
| 3 Application Builder | 1 | D3 | partial | D3 foundation; PEPCO template manifest |
| 4 Submission | 1 | D4 | partial | email_intent path; PEPCO portal blocked |
| 5 Communication Parser | 2 | D5 | partial | Portal-sync keyword classifier; no inbound email |
| 6 COS Analyst | 2 | D6 | partial | Discrepancy analysis foundation |
| 7 Easement/ROW | 4 | deferred | deferred | |
| 8 CIAC/Cost | 1 | D7 | partial | Manual cost CRUD; no QuickBooks |
| 9 Equipment | 1 | D8 | partial | CRUD + check-in; no cron |
| 10 Inspection Release | 4 | deferred | deferred | |
| 11 Meter Set | 1 | D9 | partial | Checklist + milestone row |
| 12 Energization/Closeout | 1 | D10 | partial | Closeout checklist metadata |

---

## 11. Test Program

| Layer | Requirement | Current |
|-------|-------------|---------|
| Unit | Per agent + sync services | D1A–D1D + D2.0 + D2.1 + D3 + D4 + D5 + D6–D12 + D13 + NB-D1-001 tests (185 UCI tests) |
| Integration | Critical paths §16 | ⚠️ Partial | `uci-d13-routes-integration.test.js` — project-boundary HTTP tests |
| Security | Cross-tenant CI blocking | ❌ |
| Portal mock | Per priority utility | ❌ (PEPCO list parse only) |
| Classifier | ≥85% validation | ❌ | D5 keyword foundation only |
| Live smoke | PEPCO read-only | **unclear** — needs manual verification |

**D1 minimum:** sync idempotency, tenant isolation, PEPCO regression, document storage auth.

---

## 12. Security Gates

| Gate | Required before | Status |
|------|-----------------|--------|
| Credential encryption | any portal automation | ✅ |
| JWT + project access on all routes | any UCI API | ✅ |
| Editor write gate on UCI mutations | D13 pilot | ⚠️ Partial | RLS + route `write: true` (NB-D1-001) |
| Tenant propagation + cross-tenant RLS tests | pilot multi-tenant demo | ❌ | Cross-project + editor/viewer tests only |
| No secrets in logs | every release | partial |
| Submission idempotency | D4 production | ⚠️ Partial | `submitted_at` gate; PEPCO dry-run not built |

---

## 13. Deployment Gates

| Gate | Milestone |
|------|-----------|
| D1 complete | PEPCO read-only pilot on normalized data + storage |
| D3 complete | Internal application draft demo |
| D4 complete | Controlled PEPCO submit in staging (**dry-run first**) |
| D5–D6 complete | Communication + COS pilot |
| D7–D10 complete | Full lifecycle pilot per client Phase 1 agents |
| D11 complete | McDonald's portfolio reporting |
| D12 complete | Production operations readiness |
| D13 complete | Tenant isolation proven; §17 backlog closed or classified |

### Pilot critical path (McDonald's — existing milestones only)

```text
Project (any supported jurisdiction) + jurisdiction data reuse
  → D2.0 human provider confirmation (one record per provider)
  → D2.1 load profile review (no-guess)
  → D3 application package + human review
  → D4 submission (PEPCO dry-run → live when access verified; others email)
  → D1A portal sync + D5 comms classify
  → D6 COS → D7 costs (+ QB reviewed actions) → D8–D10 operational checklists
  → D11 portfolio summary → D12 events/alerts → D13 tenant hardening
```

**Production-readiness gates (honest):** tenant RLS (D13) + cross-tenant tests + live PEPCO smoke (NB-TEST-001) + inbound email (D5) + submission evidence (D4) + alerts/runbooks (D12) + staging UAT.

---

## 14. Definition of Done (Full UCI)

Per client spec and §18 of merged plan — module complete only when:

- Utility providers identified (Agent 1 — D2.0 human-assisted minimum; D2.2 auto when verified data available)
- Load schedules structured and reviewable (Agent 2) — no guessed numerics
- Applications prepared from templates (Agent 3)
- Human review mandatory before submission
- **Submission complete** per definition: actual submit + attachments + confirmation + evidence + actor/timestamp (Agent 4)
- Communications classified and threaded (Agent 5)
- COS/design analyzed (Agent 6)
- Costs/CIAC tracked with QB reviewed actions (Agent 8) — reuse billing QuickBooks
- Equipment ETAs monitored (Agent 9)
- Meter set coordinated (Agent 11)
- **Coordination complete** per definition: energized + final meter + commissioning + costs closed + closeout archived (Agent 12)
- Lifecycle stages update with audit history
- **Tenant isolation proven** (not complete today — architecture work under D13)
- **Portal jobs durable** (D1D implemented; MFA restart partial)
- **Documents stored securely** (D1B implemented; tenant path pending)
- Portfolio reporting available
- All required agents tested; runbooks exist

**Completion distinctions (audit labels):**

| Label | Meaning |
|-------|---------|
| Foundation implemented | Service/API/schema exists |
| End-to-end workflow | UI + API + persistence wired for pilot path |
| Tested locally | Unit/integration tests pass |
| Live verified | Confirmed against real portal/mailbox/QB |
| Staging-ready | Safe dry-run or controlled environment |
| Production-ready | Tenant isolation, alerts, runbooks, live gates pass |
| Blocked by external dependency | Requires data, access, credentials, or tenancy decision |

---

## 15. Execution History Appendix

See `UCI_EXECUTION_HISTORY.md` for Sprint 1–6 completion vs plan.

**Summary:**

| Sprint | Status |
|--------|--------|
| Sprint 1 | Largely complete |
| Sprint 2 | Mostly complete; route surface partial |
| Sprint 3 | Partial |
| Sprint 4 | PEPCO read-only only; **BGE not started** |
| Sprint 5 | Not started |
| Sprint 6 | Not started |

---

## 16. Recommended Implementation Sequence

### Immediate (D1 sub-phases)

1. ~~D1A — Adapters + normalized application/communication/milestone writes~~ **done**
2. ~~D1B — Production document storage~~ **done**
3. ~~D1C — Lifecycle mapping (proposal + audit; flag-gated auto-apply)~~ **done**
4. ~~D1D — Durable sync job interfaces + `UCI_DURABLE_JOBS_ENABLED`~~ **done**

### Next

5. ~~D2.0 — Human-assisted provider setup~~ **done**
6. ~~D2.1 — Agent 2 load profile foundation (no-guess)~~ **done**
7. D2.2 — Verified territory data + full automatic Agent 1 (**blocked** — no geocoding vendor / territory rules)
8. ~~D3 — Application preparation foundation~~ **done** (scoped)
9. D4 → submission path (**partial** — PEPCO portal submit adapter **blocked**)
10. ~~D5 — Communication intelligence foundation~~ **done** (scoped — portal-sync classifier)
11. ~~D6 — COS analyst foundation~~ **done** (scoped)
12. ~~D7 — Costs foundation~~ **done** (scoped — no QuickBooks)
13. ~~D8 — Equipment foundation~~ **done** (scoped — no cron)
14. ~~D9 — Meter set foundation~~ **done** (scoped)
15. ~~D10 — Closeout foundation~~ **done** (scoped)
16. ~~D11 — Portfolio view API~~ **done** (scoped — no UI)
17. ~~D12 — Events foundation~~ **done** (scoped — in-memory buffer)
18. **D13** — Hardening and deferred-gap closure (§17 backlog) — **partial** (frontend workflows + doc reconciliation 2026-07-15)

### Remaining execution order (updated 2026-07-15)

Priority follows existing milestone numbers — no new phases:

1. ~~**D13 / Row 2** — Tenant and RLS hardening~~ **code complete** — apply migrations `20260715140000`–`20260715140400` in staging/production
2. **D4** — PEPCO submission dry-run + evidence capture (external access + live verification)
3. **D5/D4** — Email foundation via Commun-ET mailbox / Microsoft Graph (external access)
4. **D7** — QuickBooks UCI reviewed actions (implement now — reuse billing module)
5. **D2.1** — Verified load-template ingestion (external data — McDonald's/QSR)
6. **D1D/D13** — Durable PEPCO browser/MFA hardening
7. **D6** — COS document content parsing
8. **D12/D13** — Alerts, runbooks, live verification gates
9. Staging and UAT

---

## 17. Non-Blocking Incomplete and Deferred Items

**Purpose:** Persistent record of gaps that are **partial**, **incomplete**, **deferred**, **hardening**, or **documentation drift** — but **not blocking** the active milestone. Items are **never deleted**; mark **Resolved** with date and evidence when closed.

**Process (every milestone):**
1. **Before:** Read this table; escalate to blocker only if the current milestone cannot ship safely without the item.
2. **After:** Add newly discovered gaps; update status; mark resolved items — do not remove rows.

**Status labels:** `partial` | `incomplete` | `deferred` | `hardening` | `documentation drift` | `blocked`

**Dependency class:** `implement now` | `external data` | `external access` | `architecture work` | `live verification`

**Risk:** `low` | `medium` | `high` (security/tenant/data-loss exposure)

### Active backlog

| ID | Area | Item | Status | Class | Why non-blocking | Target milestone | Risk | Evidence | Added | Resolved |
|----|------|------|--------|-------|------------------|------------------|------|----------|-------|----------|
| NB-D1C-001 | D1C Lifecycle UI | Lifecycle proposal Accept/Reject UI + API | resolved | implement now | Accept/reject with checksum | D13 | low | `uci-lifecycle-proposal-actions.service.js`, `LifecycleProposalActions` | 2026-07-08 | 2026-07-15 |
| NB-D1C-002 | D1C Audit | Proposal-only mode stored in `metadata` not dedicated audit table | partial | implement now | Proposals persisted and readable; system apply writes transition when flag on | D13 | low | `coordination_records.metadata.uci_lifecycle_proposals` | 2026-07-08 | — |
| NB-D1C-003 | D1C Audit | Stale-proposal checksum on manual apply/reject | resolved | implement now | `proposal_checksum` validated on apply/reject | D13 | low | `uci-lifecycle-proposal-actions.service.js` | 2026-07-08 | 2026-07-15 |
| NB-D1C-004 | D1C Mapping | PEPCO lifecycle mapping covers only a limited status set | partial | implement now | Unknown statuses safely return null; core PEPCO statuses mapped | D13 / D6 | medium | `pepco.adapter.js` `mapPortalStatusToLifecycle` | 2026-07-08 | — |
| NB-D1C-005 | D1C Mapping | Stages 8–10 not mapped from portal status | incomplete | implement now | Pre-energization/energization not in read-only pilot path | D9 / D10 | low | `pepco.adapter.js` | 2026-07-08 | — |
| NB-D1D-001 | D1D Worker | Durable worker runs normalized sync only, not full PEPCO browser phases | partial | implement now | `runPortalSync` path works; discovery remains on dedicated routes | D1D / D13 | medium | `uci-durable-worker-executor.js`, `uci-portal-sync.service.js` | 2026-07-14 | — |
| NB-D1D-002 | D1D Frontend | Frontend sync-run polling + sessionStorage recovery | partial | implement now | `SyncRunsPanel`, `useSyncRunPolling`, durable sync job tracking | D13 | low | `UciD13WorkflowPanels.tsx`, `uciApi.ts` | 2026-07-14 | 2026-07-15 |
| NB-D1D-003 | D1D MFA | MFA browser state not fully restart-restorable after worker/process restart | partial | architecture work | In-memory session store with TTL; documented limitation | D13 | medium | `uci-pepco-session-store.js` — no durable MFA store | 2026-07-14 | — |
| NB-D1-001 | D1 Tenant | Tenant isolation — tenants, memberships, propagation, RLS | resolved | architecture work | Row 2 code + staged migrations; production gate requires migration apply + live RLS verification | D13 / Row 2 | high | `20260715140000`–`20260715140400`, `uci-access.service.js`, `uci-cross-tenant-security.test.js` | 2026-07-08 | 2026-07-15 |
| NB-D1B-001 | D1B Storage | Tenant-based storage namespace for new uploads | resolved | architecture work | New paths `uci/{tenantId}/...`; legacy `unconfigured` readable; tenant derived from project | D13 / Row 2 | medium | `uci-document-storage.service.js` | 2026-07-08 | 2026-07-15 |
| NB-D2-001 | D2 Agent 1 | Full auto territory mapping blocked on verified service-territory data | deferred | external data | D2.0 human-confirmed fallback; no ZIP/county/jurisdiction inference | D2.2 | medium | No verified `service_territory` rules; column unused | 2026-07-14 | — |
| NB-D2-002 | D2 Address | Address normalization and geocoding incomplete | incomplete | external data | D2.1 uses structured address inventory only | D2.2 | medium | `uci-provider-setup.service.js`, `uci-load-profile.service.js` | 2026-07-14 | — |
| NB-D2-003 | D2.0 UI | Provider mapping metadata display in UI | resolved | implement now | Table badge + drawer `ProviderMappingBanner` | D13 | low | `UciD13WorkflowPanels.tsx`, records table | 2026-07-14 | 2026-07-15 |
| NB-D2-004 | D2.0 API | Init API still accepts requests without `provider_setup` confirmation | hardening | implement now | Backward compatibility for API clients; UI enforces confirm gate | D13 | low | `POST .../coordination/init` in `uci.routes.js` | 2026-07-14 | — |
| NB-D2-005 | D2.0 Audit | No dedicated provider-mapping audit table (metadata only) | partial | implement now | Mapping stored on records + init transition metadata | D13 | low | `uci-records.service.js`, `coordination_stage_transitions.metadata` | 2026-07-14 | — |
| NB-D2-006 | D2.0 Tests | Provider-setup routes lack HTTP integration tests | partial | implement now | Project-boundary tests in `uci-d13-routes-integration.test.js` | D13 | low | D13 integration suite | 2026-07-14 | 2026-07-15 |
| NB-D2-007 | D2.1 Templates | McDonald's / QSR load template registry missing | incomplete | external data | D2.1 intentionally omits guessed numeric templates | D2.1 | medium | No template files under `uci/` or `scraper-service` | 2026-07-14 | — |
| NB-D2-008 | D2.1 Agent 2 | No numeric engineering values in `calculated_values` (by design) | incomplete | external data | No-guess rule; awaits verified inputs or templates (NB-D2-007) | D2.1 | low | `uci-load-profile.service.js` `calculated_values: {}` | 2026-07-14 | — |
| NB-D2-009 | D2.1 Equipment | Equipment ingestion UI for coordination rows | partial | implement now | Equipment create/check-in UI wired | D13 | low | `CostsEquipmentWorkflowPanel` | 2026-07-14 | 2026-07-15 |
| NB-D2-010 | D2.1 Docs | Document content parsing for load extraction deferred | deferred | external data | D2.1 lists `project_documents` types only; no LLM | D13 | low | `uci-load-profile.service.js` | 2026-07-14 | — |
| NB-D2-011 | D2.1 Lifecycle | Stage 2 not auto-advanced; no load-profile approval workflow | incomplete | implement now | D2.1 read-only analysis; stage unchanged when inputs missing | D13 / D3 | low | No `recordSystemTransition` in load profile service | 2026-07-14 | — |
| NB-D2-012 | D2.1 Tests | Load-profile route lacks HTTP integration tests | partial | implement now | D13 route integration covers auth/project gates | D13 | low | `uci-d13-routes-integration.test.js` | 2026-07-14 | 2026-07-15 |
| NB-D3-001 | D3 Templates | Only PEPCO electric manifest; no gas/water/telecom templates | incomplete | implement now | D3 scoped to PEPCO first; other utilities use manual/email | D13 / adapters | medium | `uci/application-templates/pepco/` only | 2026-07-14 | — |
| NB-D3-002 | D3 Agent 3 | No load calculation worksheet generation | incomplete | external data | Awaits verified numeric templates (NB-D2-007) | D13 | low | `uci-application-builder.service.js` | 2026-07-14 | — |
| NB-D3-003 | D3 Lifecycle | Stage 3 not auto-advanced on package build/review | incomplete | implement now | Intentional; manual transitions remain | D13 | low | `stage_unchanged: true` in builder | 2026-07-14 | — |
| NB-D3-004 | D3 Tests | Application routes lack HTTP integration tests | partial | implement now | Lifecycle/cost routes covered in D13 integration suite | D13 | low | `uci-d13-routes-integration.test.js` | 2026-07-14 | 2026-07-15 |
| NB-D3-005 | D3 UI | Submit enabled when reviewed; PEPCO adapter gap surfaces on submit | partial | external access | PEPCO returns 501; non-PEPCO uses email_intent | D4 | low | `ApplicationPrepSection` | 2026-07-14 | — |
| NB-D4-001 | D4 PEPCO | PEPCO portal submission adapter + dry-run not implemented | blocked | external access | No Playwright form-submit/dry-run path; needs live form mapping | D4 | high | `uci-application-submit.service.js` returns 501 | 2026-07-14 | — |
| NB-D4-002 | D4 Email | Outbound utility email not sent via Commun-ET mailbox | incomplete | external access | email_intent records metadata only; reuse Graph/mailbox | D5 / D4 | medium | No Graph/SMTP send in UCI; `microsoft_mailbox_connections` exists | 2026-07-14 | — |
| NB-D4-003 | D4 Confirm | No utility ticket/confirmation capture for portal submit | incomplete | live verification | Submission-complete definition requires ticket + evidence | D4 | medium | `utility_ticket_number` null on email_intent | 2026-07-14 | — |
| NB-D5-001 | D5 Email | Inbound email webhook not implemented | incomplete | external access | Portal-sync classifier covers first safe version; reuse Commun-ET mailbox | D5 | medium | No `POST /webhooks/uci/email-inbound` route | 2026-07-14 | — |
| NB-D5-002 | D5 Classifier | Keyword classifier only; no ≥85% validation set | incomplete | implement now | Deterministic foundation per audit; AI deferred | D13 | low | `uci-communication-classifier.service.js` | 2026-07-14 | — |
| NB-D5-003 | D5 UI | Human reclassify UI in communications drawer | resolved | implement now | `CommunicationReclassifyRow` per message | D13 | low | `UciD13WorkflowPanels.tsx` | 2026-07-14 | 2026-07-15 |
| NB-D5-004 | D5 Threading | Email + portal threading not unified | incomplete | external access | Portal messages only; awaits inbound email (NB-D5-001) | D5 | low | `coordination_communications` portal_sync source | 2026-07-14 | — |
| NB-D6-001 | D6 Parsing | No COS/design document content parsing | incomplete | implement now | Discrepancy report from metadata + classified comms only today | D6 | medium | `uci-cos-analyst.service.js` | 2026-07-14 | — |
| NB-D6-002 | D6 Lifecycle | Stage 6 not auto-advanced on COS analysis | incomplete | implement now | `stage_unchanged: true` by design | D13 | low | `uci-cos-analyst.service.js` | 2026-07-14 | — |
| NB-D6-003 | D6 UI | COS analysis section in coordination drawer | resolved | implement now | `CosAnalysisPanel` with analyze trigger | D13 | low | `UciD13WorkflowPanels.tsx` | 2026-07-14 | 2026-07-15 |
| NB-D7-001 | D7 QuickBooks | UCI reviewed QB actions not wired (billing module exists) | incomplete | implement now | Reuse `scraper-service/app/services/quickbooks/`; persist costs first | D7 | medium | `uci-costs.service.js` — no UCI→QB bridge; `qb-invoice-trigger.service.js` in billing | 2026-07-14 | — |
| NB-D7-002 | D7 UI | Cost entry UI in coordination drawer | resolved | implement now | `CostsEquipmentWorkflowPanel` cost form | D13 | low | `UciD13WorkflowPanels.tsx` | 2026-07-14 | 2026-07-15 |
| NB-D8-001 | D8 Cron | Weekly equipment ETA check-in cron not scheduled | incomplete | implement now | Manual check-in API exists | D8 | medium | No worker/cron for equipment | 2026-07-14 | — |
| NB-D8-002 | D8 Alerts | >2-week ETA slip alerts not implemented | incomplete | implement now | ETA history in check-in metadata only | D8 | low | `uci-equipment.service.js` | 2026-07-14 | — |
| NB-D8-003 | D8 UI | Equipment create/check-in UI | resolved | implement now | `CostsEquipmentWorkflowPanel` equipment section | D13 | low | `UciD13WorkflowPanels.tsx` | 2026-07-14 | 2026-07-15 |
| NB-D9-001 | D9 Escalation | Failed meter set escalation not implemented | incomplete | implement now | Checklist + milestone foundation only | D9 | low | `uci-meter-set.service.js` | 2026-07-14 | — |
| NB-D9-002 | D9 UI | Meter-set prepare UI | resolved | implement now | `MeterSetCloseoutPanel` meter section | D13 | low | `UciD13WorkflowPanels.tsx` | 2026-07-14 | 2026-07-15 |
| NB-D10-001 | D10 PDF | Closeout PDF not generated in project documents | incomplete | implement now | Checklist metadata only; coordination-complete needs archived docs | D10 | medium | `uci-closeout.service.js` | 2026-07-14 | — |
| NB-D10-002 | D10 Rollup | Project stage-10 rollup when all records coordination-complete | incomplete | implement now | No auto rollup; coordination-complete definition in architecture | D10 | low | `uci-closeout.service.js` | 2026-07-14 | — |
| NB-D10-003 | D10 UI | Closeout prepare UI | resolved | implement now | `MeterSetCloseoutPanel` closeout section | D13 | low | `UciD13WorkflowPanels.tsx` | 2026-07-14 | 2026-07-15 |
| NB-D11-001 | D11 P50/P90 | Heuristic energization dates not computed | incomplete | implement now | Stage summary only | D11 | medium | `uci-portfolio.service.js` | 2026-07-14 | — |
| NB-D11-002 | D11 Reporting | Quarterly export templates not implemented | incomplete | implement now | API rollup only | D11 | low | No export endpoints | 2026-07-14 | — |
| NB-D11-003 | D11 UI | Portfolio view in frontend | partial | implement now | Project-level `PortfolioSummarySection` (not dedicated page) | D11 | low | `UciD13WorkflowPanels.tsx` | 2026-07-14 | 2026-07-15 |
| NB-D11-004 | D11 Tenant | McDonald's tenant config requires client input | deferred | external data | Client Phase 3 explicit input | D11 | — | Roadmap §D11 | 2026-07-14 | — |
| NB-D12-001 | D12 Escalate | `POST /coordination/:id/escalate` not implemented | incomplete | implement now | Events foundation only | D12 | low | No escalate route | 2026-07-14 | — |
| NB-D12-002 | D12 Bus | Event bus — in-memory + metadata mirror | partial | architecture work | `emitUciEvent` mirrors to `metadata.uci_recent_events` when coordination/project in payload | D13 | low | `uci-events.service.js` | 2026-07-08 | 2026-07-15 |
| NB-D12-003 | D12 Alerts | P0/P1/P2 alerts and runbooks not documented | incomplete | live verification | No alerting pipeline | D12 / D13 | medium | Roadmap §D12 | 2026-07-14 | — |
| NB-PROV-001 | Providers | BGE and other non-PEPCO portal adapters not implemented | deferred | external access | PEPCO first; others use manual/email until adapters | Future adapter | low | No BGE under `scrapers/` or `adapters/` | 2026-07-08 | — |
| NB-TEST-001 | Testing | Live PEPCO end-to-end smoke verification not CI-gated | incomplete | live verification | Unit/route tests pass (171 UCI tests); live portal requires credentials | D13 | medium | Manual verification; `uci-pepco-*` tests mock browser | 2026-07-08 | — |
| NB-TEST-002 | Testing | Cross-tenant UCI security tests | resolved | architecture work | Dedicated `uci-cross-tenant-security.test.js` — tenant A/B, demo isolation, route denial, storage namespace | D13 / Row 2 | high | `uci-cross-tenant-security.test.js`, `uci-d13-tenant-rls-hardening.test.js` | 2026-07-08 | 2026-07-15 |
| NB-OPS-001 | D12 Ops | Event bus `uci.*` events — in-memory only, partial catalog | partial | architecture work | `emitUciEvent` on D5 classify/reclassify; no external bus | D13 | low | `uci-events.service.js`, `GET /events/recent` | 2026-07-08 | — |
| NB-TEAM-001 | Team | Invitation acceptance flow missing | resolved | implement now | `/invite/:token`, `accept_project_team_invitation` RPC, `InviteAccept.tsx` | Row 2 | medium | `20260715130000_project_team_invitation_flow.sql`, `InviteAccept.tsx` | 2026-07-15 | 2026-07-15 |
| NB-TEAM-002 | Team | Invite did not send email | resolved | implement now | `send-project-team-invitation` edge function via Resend; truthful partial result when unavailable | Row 2 | low | `supabase/functions/send-project-team-invitation/index.ts` | 2026-07-15 | 2026-07-15 |
| NB-TEAM-003 | Team | No direct add-existing-user path (invite-only for new members) | partial | implement now | Invite+accept creates membership; admins can promote existing members via role dropdown | Row 2 | low | `useProjectTeam.ts` | 2026-07-15 | — |
| NB-TEAM-004 | Team | `inviteMember` duplicate check queried current user not invitee | resolved | implement now | `create_project_team_invitation` RPC checks `auth.users` + `project_team_members` | Row 2 | low | `20260715130000_project_team_invitation_flow.sql` | 2026-07-15 | 2026-07-15 |
| NB-TEAM-005 | Team | FAQ said account settings for team management | resolved | implement now | FAQ + onboarding point to Projects → Team tab | Row 2 | low | `FAQ.tsx`, `FeaturesStep.tsx` | 2026-07-15 | 2026-07-15 |
| NB-TEAM-006 | Team | UCI editor access not explained in team invite UX | resolved | implement now | Editor role description mentions UCI coordination write access | Row 2 | low | `types/team.ts` TEAM_ROLE_DESCRIPTIONS | 2026-07-15 | 2026-07-15 |

### Client-deferred (not D13 unless scope changes)

These remain in §7 **Deferred Agents and Features** — track here for visibility only:

| ID | Area | Item | Status | Why non-blocking | Target | Risk | Evidence | Added | Resolved |
|----|------|------|--------|------------------|--------|------|----------|-------|----------|
| NB-CLIENT-007 | Agent 7 | Easement & ROW coordinator | deferred | Client Phase 4 explicit deferral | Client Phase 4 | — | Roadmap §7 | 2026-07-08 | — |
| NB-CLIENT-010 | Agent 10 | Inspection release coordinator | deferred | Client Phase 4 explicit deferral | Client Phase 4 | — | Roadmap §7 | 2026-07-08 | — |
| NB-CLIENT-ML | Prediction | ML energization prediction | deferred | Client Phase 5 | Client Phase 5 | — | Roadmap §7 | 2026-07-08 | — |

### Resolved backlog (history)

| ID | Area | Item | Resolved | Milestone | Evidence |
|----|------|------|----------|-----------|----------|
| NB-DOC-001 | Docs | README status summary lagged D2.0 / backlog | 2026-07-14 | D2.0 doc pass | `uci/README.md` §Non-Blocking Backlog, §Current Project Status |
| NB-DOC-002 | Docs | Roadmap lagged D5–D12 implementation | 2026-07-14 | D13 doc pass | `UCI_DELIVERY_ROADMAP.md` §6, §8–11, §17 |
| NB-DOC-003 | Docs | Architecture decisions reconciled into existing roadmap (no new plan) | 2026-07-15 | D13 doc pass | `UCI_ARCHITECTURE.md`, `UCI_DELIVERY_ROADMAP.md` §D2/D4/D5/D7/D8–D13, §17 Class column |

**Last backlog review:** 2026-07-15 (NB-TEAM-001–006 project invitation flow). **Open items:** 35 active + 3 client-deferred; NB-TEAM-003 partial (invite-only for new users by design).

---

*Merged from `UCI_All_Implementation_Phases.md`, `uci_execution_sprints_and_phases.md`, gap analysis, and CET-2026-UCI-BACKEND-001.*
