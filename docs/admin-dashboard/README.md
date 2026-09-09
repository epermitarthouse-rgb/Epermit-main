# PermitPilot Admin and Operations Dashboard — Canonical Architecture

**Status:** Architecture approved for review (documentation only — no implementation yet)  
**Code reference:** `main` (PermitPilot stack verified 2026-09-09)  
**Repository:** `epermitarthouse-rgb/Epermit-main`

---

## Purpose of this folder

This folder contains the **single canonical, production-grade architecture** for the PermitPilot Admin and Operations Dashboard. Implementation must follow these documents exactly. Phased delivery is allowed for safety; phases must not introduce throwaway UI or APIs that diverge from this target.

---

## Document set

| Document | Role |
|----------|------|
| [PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md](./PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md) | Master architecture: purpose, boundaries, decisions, data/API overview, acceptance criteria |
| [ADMIN_INFORMATION_ARCHITECTURE.md](./ADMIN_INFORMATION_ARCHITECTURE.md) | Complete `/admin` navigation, modules A–R, page-level UX specifications |
| [ADMIN_ROLE_AND_PERMISSION_MATRIX.md](./ADMIN_ROLE_AND_PERMISSION_MATRIX.md) | Platform and project roles, permissions matrix, authorization enforcement |
| [ADMIN_CONTROL_REGISTRY.md](./ADMIN_CONTROL_REGISTRY.md) | Every major control: label, role, backend action, audit, risk |
| [ADMIN_DATA_AND_API_CONTRACTS.md](./ADMIN_DATA_AND_API_CONTRACTS.md) | Tables, views, RPCs, Railway admin API contract |
| [ADMIN_STATE_MACHINES.md](./ADMIN_STATE_MACHINES.md) | Canonical operational state models aligned to current DB values |
| [ADMIN_MONITORING_AND_ALERTS.md](./ADMIN_MONITORING_AND_ALERTS.md) | Health, heartbeats, alerts, incident model |
| [ADMIN_IMPLEMENTATION_ROADMAP.md](./ADMIN_IMPLEMENTATION_ROADMAP.md) | Phased build sequence, AI-assisted estimates, dependencies |

---

## Supporting evidence (not the final architecture)

| Document | Role |
|----------|------|
| [ADMIN_DASHBOARD_CURRENT_STATE_AND_PLAN.md](./ADMIN_DASHBOARD_CURRENT_STATE_AND_PLAN.md) | Read-only audit of existing `/admin/*` surfaces, platform verification, and pre-architecture gap analysis (2026-09-09) |

Prior diligence (`docs/diligence-readiness/PERMITPILOT_360_PRODUCTION_AUDIT.md`, `PERMITPILOT_UPCOMING_WORK_AND_ESTIMATE.md`) informs backlog items **PP-005** (unified ops dashboard) and related P0/P1 work.

---

## Canonical production endpoints

| Surface | URL |
|---------|-----|
| Frontend | `https://epermit-main-nine.vercel.app` |
| Railway API | `https://epermit-main-production.up.railway.app` |
| Supabase | `https://eeqxyjrcldivtpikcpvk.supabase.co` (InsightDC) |

---

## Implementation gate

**Do not begin dashboard implementation until this architecture set is reviewed and explicitly approved.**

After approval, start with **Phase 0** in [ADMIN_IMPLEMENTATION_ROADMAP.md](./ADMIN_IMPLEMENTATION_ROADMAP.md) (shared foundations: admin auth middleware, audit model, operational views, dashboard shell).
