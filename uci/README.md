# UCI Documentation Index

**Utility Coordination Intelligence (UCI)** — documentation for the PermitPilot UCI module.

---

## Source-of-Truth Hierarchy

Read documents in this order when making implementation decisions:

| Priority | Document | Role |
|----------|----------|------|
| 1 | **Client specification** — CET-2026-UCI-BACKEND-001 (`uci module backend integration spec.pdf`, external) | Authoritative requirements: lifecycle, agents, schema, APIs, security, phasing |
| 2 | **`UCI_DELIVERY_ROADMAP.md`** | Canonical delivery plan: milestones D1–D12, acceptance criteria, matrices |
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

## Current Project Status Summary

*As of documentation merge — based on codebase audit, not live PEPCO verification.*

### What exists (partial or implemented)

| Area | Status | Evidence |
|------|--------|----------|
| UCI module (parallel track) | **implemented** | `/api/uci` routes, `scraper-service/app/services/uci/`, `/uci` UI |
| Seven core DB tables | **implemented** (schema) | `supabase/migrations/20260509120000_uci_foundation.sql` |
| Manual coordination init | **partial** | User selects providers; not Agent 1 geographic mapping |
| Manual stage transitions + audit | **implemented** | `uci-transitions.service.js`, UI manual update |
| PEPCO read-only portal automation | **partial** | Login, MFA, dashboard discovery, app detail scrape, metadata persistence |
| PEPCO frontend panel | **partial** | `PepcoApplicationDetailsPanel.tsx` renders metadata snapshots |
| API auth + project access | **implemented** | `uci-access.service.js` — JWT + `has_project_access` |
| Portal credential encryption | **implemented** | Sprint 1 Phase 0 (per execution history) |
| Utility provider seed (10 utilities) | **implemented** | Global catalog in migration |

### What does not exist or is stub-only

| Area | Status |
|------|--------|
| Normalized writes to child tables (`coordination_applications`, `coordination_communications`, costs, equipment, milestones) | **missing** |
| UCI agents 1–12 as workers | **missing** (manual init ≠ Agent 1) |
| Portal submission automation | **missing** |
| BGE portal automation | **missing** |
| Tenant propagation + tenant-aware RLS | **missing** (target in D1) |
| Durable UCI jobs | **missing** (in-memory MFA sessions today) |
| Production document storage | **missing** (`debug/pepco-docs` only) |
| Event bus (`uci.*` events) | **missing** |
| Communication classifier (Agent 5) | **missing** |
| Portfolio view, escalate, needs-attention APIs | **missing** |
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
| Services | `scraper-service/app/services/uci/` |
| PEPCO scrapers | `scraper-service/scrapers/pepco/` |
| Frontend | `src/pages/UciDashboard.tsx`, `src/components/uci/`, `src/lib/uciApi.ts` |
| Types | `src/types/uci.ts` |
| Migration | `supabase/migrations/20260509120000_uci_foundation.sql` |

---

## Next Steps for Implementers

1. Read `UCI_DELIVERY_ROADMAP.md` — start with **D1** (Normalized Read-Only Foundation).
2. Check `UCI_COMPLIANCE_CHECKLIST.md` before marking any item complete.
3. Do not treat `uci_execution_sprints_and_phases.md` or `UCI_All_Implementation_Phases.md` as active roadmaps.
