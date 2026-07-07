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
| Manual provider init | partial | `initCoordinationForProviders` — not Agent 1 |
| Manual stage transitions + audit | implemented | `uci-transitions.service.js` |
| PEPCO login/MFA/resume | partial | `login-flow.js`, session store, modal UI |
| PEPCO dashboard discovery | partial | metadata `pepco_dashboard_discovery` |
| PEPCO app detail scrape | partial | overview, status, messages, docs → metadata |
| PEPCO UI panel | partial | `PepcoApplicationDetailsPanel.tsx` |
| 10 utility provider seed | implemented | global `utility_providers` |
| Encrypted portal credentials | implemented | Sprint 1 |

### Stub / UI only

| Capability | Status |
|------------|--------|
| Normalized applications section in UI | stub/UI only — empty `coordination_applications` |
| Costs / equipment / milestones / comms cards | stub/UI only — tables unread written |
| Portfolio / action queue / stage summary | missing from UI |

### Missing

| Capability | Status |
|------------|--------|
| All 12 UCI agents as workers | missing |
| BGE automation | missing |
| Portal submission | missing |
| Tenant propagation + tenant RLS | missing |
| Durable `uci_portal_sync` jobs | missing |
| Supabase document storage for UCI | missing |
| Event bus `uci.*` | missing |
| Agent 5 classifier + inbound email | missing |
| Portfolio, escalate, needs-attention APIs | missing |

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
| **Current status** | **partial** — PEPCO metadata sync works; normalization/tenant/jobs missing |

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
| **Objective** | Agents 1–2: auto provider mapping + structured load schedules |
| **Client requirements** | Agent 1 §4.1; Agent 2 §4.2; McDonald's prototype templates |
| **Dependencies** | D1 tenant + provider directory hardening |
| **Current status** | **missing** (manual init only) |

**Database:** Tenant-scoped `utility_providers`; `service_territory`; SLA fields operational.

**Backend:** Provider mapper worker; load profile analyzer; writes `coordination_applications.load_summary`.

**API:** Enhance init or auto-trigger on intake; load profile endpoints.

**Frontend:** Load summary view; missing-data flags; ambiguous provider selection.

**Acceptance:** Auto mapping from address; blocked/ambiguous states; idempotent load analysis; stage 2 transitions logged.

**Exclusions:** Full geocoding vendor choice (VERIFY); non–McDonald's prototypes beyond generic QSR fallback.

---

### D3 — Application Preparation and Review

| Field | Content |
|-------|---------|
| **Objective** | Agent 3 — draft packages; human review mandatory |
| **Client requirements** | Agent 3 §4.3; states `draft` / `reviewed` / `needs_changes` / `submitted` / `failed` |
| **Dependencies** | D2 load_summary |
| **Current status** | **missing** |

**Database:** `coordination_applications` writes; `package_documents`, `agent_draft_metadata`.

**Backend:** Application builder; template registry `uci/application-templates/{providerSlug}/`.

**API:** `POST /coordination/:id/applications`; `POST /applications/:id/review`.

**Frontend:** Draft panel; missing docs; review controls; submit disabled until `reviewed`.

**Acceptance:** PEPCO template first; idempotent draft; no auto-submit.

**Exclusions:** Portal submission (D4).

**State model:** Use client canonical enums only — no `approved_for_submission` required field.

---

### D4 — Submission and Confirmation

| Field | Content |
|-------|---------|
| **Objective** | Agent 4 — human-triggered portal/email submit + confirmation capture |
| **Client requirements** | Agent 4 §4.4; idempotency; stages 4→5 transitions |
| **Dependencies** | D3 reviewed application |
| **Current status** | **missing** |

**Backend:** Submission adapter methods; PEPCO portal path first; email fallback for unsupported utilities.

**API:** `POST /applications/:id/submit`.

**Security:** `submitted_at` check; idempotency key; no duplicate submit.

**Acceptance:** PEPCO confirmation/ticket captured; stages 4 COMPLETED, 5 AWAITING_UTILITY; email path for non-portal utilities.

**Exclusions:** BGE portal submit until adapter exists (BGE not started).

---

### D5 — Communication Intelligence

| Field | Content |
|-------|---------|
| **Objective** | Agent 5 — 11-category classification, threading, attention queue |
| **Client requirements** | Agent 5 §4.5; inbound email §5.3; needs-attention API |
| **Dependencies** | D1 normalized `coordination_communications`; D4+ for meaningful threading |
| **Current status** | **missing** (PEPCO messages in metadata only) |

**Backend:** Inbound webhook `POST /webhooks/uci/email-inbound`; classifier; keyword fallback.

**API:** `GET /communications/needs_attention`; `POST /communications/:id/reclassify`.

**Acceptance:** ≥85% accuracy target on validation set; low confidence → human queue; PEPCO portal messages + email in one model.

**Exclusions:** None of client Agent 5 scope deferred.

---

### D6 — COS and Design Review

| Field | Content |
|-------|---------|
| **Objective** | Agent 6 — parse COS/design docs; discrepancy vs load summary |
| **Client requirements** | Agent 6 §4.6 |
| **Dependencies** | D5 classification trigger; D3 submitted load |
| **Current status** | **missing** |

**Acceptance:** Structured discrepancy report; stage 6 transitions; human attention on material gaps.

---

### D7 — Costs and CIAC

| Field | Content |
|-------|---------|
| **Objective** | Agent 8 — cost tracking + QuickBooks |
| **Client requirements** | Agent 8 §4.8; QB §5.7 |
| **Dependencies** | D1; optionally D6 for estimate from COS |
| **Current status** | **missing** (table stub) |

**Acceptance:** Estimate→actual→variance; QB idempotency; stage 7 lifecycle.

---

### D8 — Equipment and Long-Lead

| Field | Content |
|-------|---------|
| **Objective** | Agent 9 — ETA tracking cron |
| **Client requirements** | Agent 9 §4.9 |
| **Dependencies** | D1 |
| **Current status** | **missing** |

**Acceptance:** Weekly check-in; ETA history; slip alerts >2 weeks.

---

### D9 — Meter Set and Pre-Energization

| Field | Content |
|-------|---------|
| **Objective** | Agent 11 — meter set choreography |
| **Client requirements** | Agent 11 §4.11 |
| **Dependencies** | D5 communications; milestones table |
| **Current status** | **missing** |

**Acceptance:** Scheduled meter set milestone; 48h checklist; failed set escalation.

---

### D10 — Energization and Closeout

| Field | Content |
|-------|---------|
| **Objective** | Agent 12 — closeout package + stage 10 |
| **Client requirements** | Agent 12 §4.12 |
| **Dependencies** | D7–D9 artifacts |
| **Current status** | **missing** |

**Acceptance:** Closeout PDF in project documents; project rollup when all records stage 10.

---

### D11 — Portfolio Intelligence

| Field | Content |
|-------|---------|
| **Objective** | Client Phase 3 — portfolio view, P50/P90, reporting |
| **Client requirements** | §4.13 heuristic; §5.1 portfolio_view; Phase 3 reporting |
| **Dependencies** | Normalized data D1+ |
| **Current status** | **missing** |

**API:** `GET /projects/:projectId/portfolio_view`.

**Acceptance:** Stage counts, risks, predicted dates, cost rollup; quarterly export templates; McDonald's tenant config (client input required).

---

### D12 — Operations and Observability

| Field | Content |
|-------|---------|
| **Objective** | Event bus, structured logs, alerts, runbooks |
| **Client requirements** | §5.2 events; §9 observability/alerting/runbooks |
| **Dependencies** | Incremental from D1 |
| **Current status** | **missing** |

**Acceptance:** All `uci.*` events emitted; P0/P1/P2 alerts; runbooks documented.

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
| `POST /projects/:id/coordination/init` | ✅ | baseline (extra) | JWT + project |
| `GET /providers` | ✅ | baseline (not tenant-scoped) | JWT only |
| `GET /coordination/:id/applications` | ✅ | baseline | JWT + project |
| `POST /coordination/:id/applications` | ❌ | D3 | — |
| `POST /applications/:id/review` | ❌ | D3 | — |
| `POST /applications/:id/submit` | ❌ | D4 | — |
| `GET /coordination/:id/communications` | ❌ | D1 | — |
| `GET /communications/needs_attention` | ❌ | D5 | — |
| `POST /communications/:id/reclassify` | ❌ | D5 | — |
| `POST /coordination/:id/escalate` | ❌ | D12 | — |
| `GET /projects/:id/portfolio_view` | ❌ | D11 | — |
| `GET /tenants/:id/utility_providers` | ❌ | D2 | — |
| PEPCO `.../discovery/pepco/*` | ✅ partial | D1 wrap | JWT + project |
| `POST /coordination/:id/sync` | ❌ | D1 | — |
| `GET /coordination/:id/sync-runs` | ❌ | D1 (extension) | — |
| `POST /webhooks/uci/email-inbound` | ❌ | D5 | — |

---

## 9. Database and Migration Matrix

| Table | Exists | Written by code | Target milestone | tenant_id today |
|-------|--------|-----------------|------------------|-----------------|
| `utility_providers` | ✅ | seed read | D2 tenant scope | ❌ global |
| `coordination_records` | ✅ | init, transitions, metadata | D1 normalize | nullable unused |
| `coordination_stage_transitions` | ✅ | init, manual | D1+ agents | via project |
| `coordination_applications` | ✅ | ❌ none | D2–D4 | via project |
| `coordination_communications` | ✅ | ❌ none | D1, D5 | via project |
| `coordination_costs` | ✅ | ❌ none | D7 | via project |
| `coordination_equipment` | ✅ | ❌ none | D8 | via project |
| `coordination_milestones` | ✅ | ❌ none | D1, D9 | via project |

**D1 migrations (planned):** `tenant_id` on child tables; optional application external ID columns; `needs_human_attention` index; tenant RLS policies.

---

## 10. Agent Implementation Matrix

| Agent | Client pilot phase | Delivery milestone | Status | Notes |
|-------|-------------------|-------------------|--------|-------|
| 1 Provider Mapper | 1 | D2 | missing | Manual init ≠ Agent 1 |
| 2 Load Profile | 1 | D2 | missing | |
| 3 Application Builder | 1 | D3 | missing | |
| 4 Submission | 1 | D4 | missing | PEPCO read-only ≠ submit |
| 5 Communication Parser | 2 | D5 | missing | |
| 6 COS Analyst | 2 | D6 | missing | |
| 7 Easement/ROW | 4 | deferred | deferred | |
| 8 CIAC/Cost | 1 | D7 | missing | |
| 9 Equipment | 1 | D8 | missing | |
| 10 Inspection Release | 4 | deferred | deferred | |
| 11 Meter Set | 1 | D9 | missing | |
| 12 Energization/Closeout | 1 | D10 | missing | |

---

## 11. Test Program

| Layer | Requirement | Current |
|-------|-------------|---------|
| Unit | Per agent + sync services | PEPCO parsing/session tests only |
| Integration | Critical paths §16 | ❌ |
| Security | Cross-tenant CI blocking | ❌ |
| Portal mock | Per priority utility | ❌ (PEPCO list parse only) |
| Classifier | ≥85% validation | ❌ |
| Live smoke | PEPCO read-only | **unclear** — needs manual verification |

**D1 minimum:** sync idempotency, tenant isolation, PEPCO regression, document storage auth.

---

## 12. Security Gates

| Gate | Required before | Status |
|------|-----------------|--------|
| Credential encryption | any portal automation | ✅ |
| JWT + project access on all routes | any UCI API | ✅ |
| Tenant propagation + RLS tests | pilot multi-tenant demo | ❌ |
| No secrets in logs | every release | partial |
| Submission idempotency | D4 production | ❌ |
| Cross-tenant CI failure blocks deploy | D1 complete | ❌ |

---

## 13. Deployment Gates

| Gate | Milestone |
|------|-----------|
| D1 complete | PEPCO read-only pilot on normalized data + storage |
| D3 complete | Internal application draft demo |
| D4 complete | Controlled PEPCO submit in staging |
| D5–D6 complete | Communication + COS pilot |
| D7–D10 complete | Full lifecycle pilot per client Phase 1 agents |
| D11 complete | McDonald's portfolio reporting |
| D12 complete | Production operations readiness |

---

## 14. Definition of Done (Full UCI)

Per client spec and §18 of merged plan — module complete only when:

- Utility providers identified automatically (Agent 1)
- Load schedules structured and reviewable (Agent 2)
- Applications prepared from templates (Agent 3)
- Human review mandatory before submission
- Submission captures confirmation/ticket (Agent 4)
- Communications classified and threaded (Agent 5)
- COS/design analyzed (Agent 6)
- Costs/CIAC tracked with QB (Agent 8)
- Equipment ETAs monitored (Agent 9)
- Meter set coordinated (Agent 11)
- Energization/closeout documented (Agent 12)
- Lifecycle stages update with audit history
- **Tenant isolation proven** (not complete today)
- **Portal jobs durable** (not complete today)
- **Documents stored securely** (not complete today)
- Portfolio reporting available
- All required agents tested; runbooks exist

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

1. D1A — Adapters + normalized application/communication/milestone writes
2. D1B — Production document storage
3. D1C — Lifecycle mapping (proposal + audit; flag-gated auto-apply)
4. D1D — Durable sync job interfaces + `UCI_DURABLE_JOBS_ENABLED`

### Next

5. D2 → D3 → D4 (core submission path)
6. **Parallel per client Phase 1 calendar:** D7, D8, D9, D10 may start after D1 without waiting for D5
7. D5 → D6 (client Phase 2)
8. D11 → D12

---

*Merged from `UCI_All_Implementation_Phases.md`, `uci_execution_sprints_and_phases.md`, gap analysis, and CET-2026-UCI-BACKEND-001.*
