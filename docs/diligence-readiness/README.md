# Diligence Readiness Package

**Repository:** [epermitarthouse-rgb/Epermit-main](https://github.com/epermitarthouse-rgb/Epermit-main)  
**Branch:** `main` (merged 2026-08-27)  
**Last updated:** 2026-08-27

This folder is the **authoritative diligence handover bundle** for PermitPilot. It supplements — but does not replace — feature-specific docs under `docs/`, `uci/`, and `memory.md`.

---

## Start here

| Audience | Read first |
|----------|------------|
| Investor / acquirer reviewer | [REPOSITORY_AND_ACCOUNT_INVENTORY.md](./REPOSITORY_AND_ACCOUNT_INVENTORY.md) → [IN_FLIGHT_STATUS.md](./IN_FLIGHT_STATUS.md) |
| Incoming engineer | [ARCHITECTURE.md](./ARCHITECTURE.md) → [DEPLOY.md](./DEPLOY.md) → [ENV.md](./ENV.md) |
| Ops / recovery | [RESTORE.md](./RESTORE.md) → [RAILWAY_PRODUCTION_STATUS.md](./RAILWAY_PRODUCTION_STATUS.md) |
| Finance / billing | [QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md](./QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md) |

---

## Core documents (required)

| Document | Purpose |
|----------|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System components and interactions |
| [DEPLOY.md](./DEPLOY.md) | Deploy, verify, rollback (non-destructive) |
| [RESTORE.md](./RESTORE.md) | Recovery procedures and verified gaps |
| [ENV.md](./ENV.md) | Complete environment variable inventory |

---

## 360° production audit (2026-08-27)

| Document | Purpose |
|----------|---------|
| [PERMITPILOT_360_PRODUCTION_AUDIT.md](./PERMITPILOT_360_PRODUCTION_AUDIT.md) | Full production audit — architecture through testing |
| [PERMITPILOT_FEATURE_CONNECTIVITY_MATRIX.md](./PERMITPILOT_FEATURE_CONNECTIVITY_MATRIX.md) | Feature status matrix with evidence |
| [PERMITPILOT_UPCOMING_WORK_AND_ESTIMATE.md](./PERMITPILOT_UPCOMING_WORK_AND_ESTIMATE.md) | P0–P3 backlog, estimates, sprint options |

---

## Supporting audits

| Document | Purpose |
|----------|---------|
| [REPOSITORY_AND_ACCOUNT_INVENTORY.md](./REPOSITORY_AND_ACCOUNT_INVENTORY.md) | Git, branches, account ownership |
| [IN_FLIGHT_STATUS.md](./IN_FLIGHT_STATUS.md) | Active work and risk summary |
| [RAILWAY_PRODUCTION_STATUS.md](./RAILWAY_PRODUCTION_STATUS.md) | Production deploy snapshot |
| [QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md](./QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md) | QuickBooks implementation |
| [TECHNICAL_EFFORT_ESTIMATES.md](./TECHNICAL_EFFORT_ESTIMATES.md) | Scoped hour estimates |
| [DOCUMENTATION_CLEANUP_AUDIT.md](./DOCUMENTATION_CLEANUP_AUDIT.md) | Doc overlap and cleanup plan |
| [REPLIT_RETIREMENT_AUDIT.md](./REPLIT_RETIREMENT_AUDIT.md) | Replit branch retirement |
| [LOVABLE_RETIREMENT_AUDIT.md](./LOVABLE_RETIREMENT_AUDIT.md) | Lovable reference retirement |
| [REPOSITORY_DOCUMENTATION_STRUCTURE.md](./REPOSITORY_DOCUMENTATION_STRUCTURE.md) | Recommended doc layout |
| [TECHNICAL_REMEDIATION_BACKLOG.md](./TECHNICAL_REMEDIATION_BACKLOG.md) | Known issues not fixed here |

---

## Client attachment package

All client-facing diligence documents live in this folder (`docs/diligence-readiness/`). To produce a ZIP for investor/acquirer review, copy the 15 documents listed under **Core documents**, **360° production audit**, and **Supporting audits** above (exclude this README, cleanup audits, and archives).

---

## Evidence classification

Throughout this package:

- **Verified** — from source code, git, or read-only platform metadata
- **Client confirmed** — stated by project owner (e.g., account ownership, shared vault)
- **Inferred** — reasonable deduction, labeled as such
- **Requires manual confirmation** — cannot close without dashboard/access

---

## Related repository docs (not superseded)

| Path | Role |
|------|------|
| [README.md](../../README.md) | Local development entry |
| [memory.md](../../memory.md) | Scraper engineering handbook |
| [docs/uci-action-items-status.md](../uci-action-items-status.md) | UCI lifecycle tracker |

Duplicate attachment-package and internal email drafts removed 2026-08-27 — see [DOCUMENTATION_CLEANUP_AUDIT.md](./DOCUMENTATION_CLEANUP_AUDIT.md).
