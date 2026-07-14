# UCI Documentation Index

**Utility Coordination Intelligence (UCI)** — documentation for the PermitPilot UCI module.

---

## Source-of-Truth Hierarchy

Read documents in this order when making implementation decisions:

| Priority | Document | Role |
|----------|----------|------|
| 1 | **Client specification** — CET-2026-UCI-BACKEND-001 (`uci module backend integration spec.pdf`, external) | Authoritative requirements: lifecycle, agents, schema, APIs, security, phasing |
| 2 | **`UCI_DELIVERY_ROADMAP.md`** | Canonical delivery plan: milestones D1–D13, acceptance criteria, matrices, **§17 non-blocking backlog** |
| 3 | **`UCI_ARCHITECTURE.md`** | Utility-neutral architecture, adapter model, current vs target code paths |
| 4 | **`UCI_COMPLIANCE_CHECKLIST.md`** | Living audit matrix — pre-filled from codebase gap analysis |
| 5 | **`UCI_EXECUTION_HISTORY.md`** | Historical sprint record (Sprints 1–6); superseded for planning |
| 6 | **`prompts/`** (sprint prompt files in `uci/`) | Implementation task tickets, not planning authority |

If a delivery milestone order differs from the client pilot phase order, the **client specification wins**. Differences are documented in the roadmap §4 (Client Pilot Phase Mapping) and §5 (Dependency Map).

---

## Document Map

| File | Purpose | Status |
|------|---------|--------|
| `README.md` | This index | Active |
| `UCI_DELIVERY_ROADMAP.md` | Canonical implementation roadmap | **Active — primary planning doc** |
| `UCI_ARCHITECTURE.md` | Architecture and integration patterns | Active |
| `UCI_COMPLIANCE_CHECKLIST.md` | Spec compliance checklist with current statuses | Active |
| `UCI_EXECUTION_HISTORY.md` | Condensed historical sprint plan | Archive (reference) |
| `UCI_All_Implementation_Phases.md` | Pre-merge phased plan | **Merged — see deprecation notice** |
| `uci_execution_sprints_and_phases.md` | Original sprint execution plan | **Superseded — see deprecation notice** |
| `uci_module_audit_checklist.md` | Original checklist (unfilled) | Superseded by `UCI_COMPLIANCE_CHECKLIST.md` |
| `permitpilot_uci_sprint*.md` | Sprint implementation prompts | Task tickets |

---

## Status Legend

Use these labels in all UCI planning and audit documents:

| Label | Meaning |
|-------|---------|
| **implemented** | Works end-to-end in code; behavior verified |
| **partial** | Some real behavior exists; not complete or not production-ready |
| **stub/UI only** | Schema, route shell, button, or empty UI section without operational writes |
| **missing** | Not implemented |
| **deferred** | Explicitly out of McDonald's pilot scope per client spec (Agents 7, 10; Phase 4–5 items) |

**Do not** mark a requirement complete because a table, type, or button exists. Verify end-to-end behavior.

---

## Non-Blocking Backlog

Partial, incomplete, deferred, and hardening gaps that do **not** block the current milestone are tracked in:

**[`UCI_DELIVERY_ROADMAP.md` §17 — Non-Blocking Incomplete and Deferred Items](./UCI_DELIVERY_ROADMAP.md#17-non-blocking-incomplete-and-deferred-items)**

Review this section **before and after every UCI milestone**. End-of-project gap closure is milestone **D13**.

---

## Current Project Status Summary

*As of documentation merge — based on codebase audit, not live PEPCO verification.*

### What exists (partial or implemented)

| Area | Status | Evidence |
|------|--------|----------|
| UCI module (parallel track) | **implemented** | `/api/uci` routes, `scraper-service/app/services/uci/`, `/uci` UI |
| Seven core DB tables | **implemented** (schema) | `supabase/migrations/20260509120000_uci_foundation.sql` |
| Manual coordination init | **partial** | User selects providers; D2.0 human-assisted setup with mapping metadata |
| Human-assisted provider setup (D2.0) | **implemented** | `uci-provider-setup.service.js`; guided init UI; `metadata.uci_provider_mapping` |
| Load profile foundation (D2.1) | **partial** | `uci-load-profile.service.js`; missing-input inventory; `load_summary` agent_draft; no numeric templates |
| Application preparation (D3) | **partial** | `uci-application-builder.service.js`; PEPCO template; review workflow |
| Submission foundation (D4) | **partial** | `uci-application-submit.service.js`; email_intent; PEPCO portal blocked |
| Communication classifier (D5) | **partial** | `uci-communication-classifier.service.js`; portal-sync keyword classifier; classify UI |
| COS analyst (D6) | **partial** | `uci-cos-analyst.service.js`; discrepancy analysis API |
| Costs foundation (D7) | **partial** | `uci-costs.service.js`; manual cost CRUD; no QuickBooks |
| Equipment foundation (D8) | **partial** | `uci-equipment.service.js`; CRUD + check-in |
| Meter set foundation (D9) | **partial** | `uci-meter-set.service.js`; checklist + milestone |
| Closeout foundation (D10) | **partial** | `uci-closeout.service.js`; checklist metadata |
| Portfolio view API (D11) | **partial** | `uci-portfolio.service.js`; no UI screen |
| Events foundation (D12) | **partial** | `uci-events.service.js`; in-memory ring buffer |
| Manual stage transitions + audit | **implemented** | `uci-transitions.service.js`, UI manual update |
| PEPCO read-only portal automation | **partial** | Login, MFA, dashboard discovery, app detail scrape, metadata + Supabase document storage |
| Normalized writes (D1A) | **partial** | `coordination_applications`, `coordination_communications`, `coordination_milestones` via portal sync |
| PEPCO document storage (D1B) | **implemented** | `uci-document-storage.service.js`; `project-documents` bucket; UCI backend tests |
| Portal lifecycle mapping (D1C) | **implemented** | `uci-lifecycle-mapping.service.js`; proposals in coordination metadata; drawer UI |
| Durable portal sync jobs (D1D) | **implemented** | `uci_portal_sync` on `scrape_jobs`; worker loop; `UCI_DURABLE_JOBS_ENABLED` |
| PEPCO frontend panel | **partial** | `PepcoApplicationDetailsPanel.tsx` renders metadata snapshots |
| API auth + project access | **implemented** | `uci-access.service.js` — JWT + `has_project_access` |
| Portal credential encryption | **implemented** | Sprint 1 Phase 0 (per execution history) |
| Utility provider seed (10 utilities) | **implemented** | Global catalog in migration |

### What does not exist or is stub-only

| Area | Status |
|------|--------|
| Normalized writes to child tables (`coordination_applications`, `coordination_communications`, costs, equipment, milestones) | **partial** | D1A writes apps/comms/milestones |
| UCI agents 1–12 as workers | **partial** | D2.0/D2.1/D3/D4/D5–D10 foundations; D2.2 auto mapping blocked; D4 PEPCO submit blocked |
| Portal submission automation | **partial** | email_intent only; PEPCO portal blocked |
| BGE portal automation | **missing** |
| Tenant propagation + tenant-aware RLS | **missing** (target in D1) |
| Durable UCI jobs | **implemented** (D1D) | `uci_portal_sync` on shared `scrape_jobs`; flag-gated |
| Production document storage | **implemented** (D1B) | Supabase `project-documents`; local dev-only |
| Event bus (`uci.*` events) | **partial** | In-memory ring buffer; D5 classify/reclassify emit |
| Communication classifier (Agent 5) | **partial** | Portal-sync keyword classifier; no inbound email |
| Portfolio view, escalate APIs | **partial** | `portfolio_view` + drawer summary; escalate missing |
| D13 agent workflow UI | **partial** | COS/costs/equipment/meter/closeout/reclassify/sync-runs wired in drawer |
| Cross-tenant UCI security tests | **missing** |

### PEPCO is the first adapter, not the architecture

PEPCO-specific code lives at:

- `scraper-service/scrapers/pepco/`
- `scraper-service/app/services/uci/uci-pepco-*.service.js`
- `src/components/uci/PepcoApplicationDetailsPanel.tsx`

The **target architecture** is utility-neutral shared services plus provider adapters (see `UCI_ARCHITECTURE.md`). PEPCO routes and metadata keys remain for backward compatibility until adapters wrap existing implementations.

---

## Client Specification Reference

- **Document:** Utility Coordination Intelligence (UCI) Module — Integration Specification
- **Reference:** CET-2026-UCI-BACKEND-001
- **Location:** External PDF (`uci module backend integration spec.pdf`)
- **Companion docs cited in spec:** CommunET master platform spec v1.7, McDonald's build timeline CET-2026-MCD-BUILD-001

---

## Related Code Locations

| Layer | Path |
|-------|------|
| API routes | `scraper-service/app/routes/uci.routes.js` |
| Services | `scraper-service/app/services/uci/` (includes `uci-provider-setup.service.js`, `uci-load-profile.service.js`) |
| PEPCO scrapers | `scraper-service/scrapers/pepco/` |
| Frontend | `src/pages/UciDashboard.tsx`, `src/components/uci/`, `src/lib/uciApi.ts` |
| Types | `src/types/uci.ts`, `src/lib/uciLifecycleProposals.ts` |
| Migration | `supabase/migrations/20260509120000_uci_foundation.sql` |

---

## Next Steps for Implementers

1. Read `UCI_DELIVERY_ROADMAP.md` — D1A–D1D, **D2.0**, **D2.1**, **D3** complete (scoped); **D4** partial; **D2.2 blocked**; review **§17 backlog** before starting the next milestone.
2. Next delivery work: **D4 PEPCO submit adapter**, **D5** communications, or parallel **D7–D10** per client Phase 1 calendar.
3. Check `UCI_COMPLIANCE_CHECKLIST.md` before marking any item complete.
4. Do not treat `uci_execution_sprints_and_phases.md` or `UCI_All_Implementation_Phases.md` as active roadmaps.
