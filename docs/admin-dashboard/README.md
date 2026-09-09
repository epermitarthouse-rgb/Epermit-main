# PermitPilot Admin Dashboard — Canonical Architecture (Governance Scope)

**Status:** Architecture v2.1 — documentation only (final corrections applied)  
**Scope:** Access, security, and platform governance — **not** operational duplication of the main product  
**Code reference:** `main` · Repository: `epermitarthouse-rgb/Epermit-main`

---

## Purpose

The Admin Dashboard governs **who can access what** across PermitPilot. It does **not** recreate Projects, Scrapers, Filing, Documents, RAG, Billing, UCI, or other operational workflows that belong in the main application.

Operators continue to use existing product surfaces (`/projects`, `/portal-data`, `/settings`, etc.). Admin provides centralized **Users & Access**, **Audit**, and **platform configuration** that is already under `/admin/*`.

---

## Document set

| Document | Contents |
|----------|----------|
| [PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md](./PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md) | Master architecture, boundaries, permission model summary, acceptance criteria |
| [ADMIN_INFORMATION_ARCHITECTURE.md](./ADMIN_INFORMATION_ARCHITECTURE.md) | Navigation (4 areas), page specs, existing screen disposition |
| [ADMIN_ROLE_AND_PERMISSION_MATRIX.md](./ADMIN_ROLE_AND_PERMISSION_MATRIX.md) | Roles, feature keys, precedence rules, effective-permission computation |
| [ADMIN_CONTROL_REGISTRY.md](./ADMIN_CONTROL_REGISTRY.md) | Governance controls only |
| [ADMIN_DATA_AND_API_CONTRACTS.md](./ADMIN_DATA_AND_API_CONTRACTS.md) | Schema reuse, new tables, RPCs, admin API |
| [ADMIN_STATE_MACHINES.md](./ADMIN_STATE_MACHINES.md) | Access grant, credential grant, and audit event lifecycles |
| [ADMIN_MONITORING_AND_ALERTS.md](./ADMIN_MONITORING_AND_ALERTS.md) | Permission-risk and audit alerts (not product ops monitoring) |
| [ADMIN_IMPLEMENTATION_ROADMAP.md](./ADMIN_IMPLEMENTATION_ROADMAP.md) | Focused phased plan and AI-assisted estimates |

---

## Supporting evidence (not the target architecture)

| Document | Role |
|----------|------|
| [ADMIN_DASHBOARD_CURRENT_STATE_AND_PLAN.md](./ADMIN_DASHBOARD_CURRENT_STATE_AND_PLAN.md) | Pre-architecture audit (2026-09-09) |

The prior 18-module operations architecture (commit `817b796`) is **superseded**. v2.1 finalizes credential grant-only model, deactivation, migration compatibility, and evidence-based estimate (429 h).

---

## Implementation gate

Do not implement until this document set is reviewed and approved. Start with [ADMIN_IMPLEMENTATION_ROADMAP.md](./ADMIN_IMPLEMENTATION_ROADMAP.md) Phase 0.
