# Diligence Readiness Package

**Repository:** [epermitarthouse-rgb/Epermit-main](https://github.com/epermitarthouse-rgb/Epermit-main)  
**Branch:** `docs/diligence-readiness`  
**Last updated:** 2026-08-27

This folder is the **authoritative diligence handover bundle** for PermitPilot. It supplements — but does not replace — feature-specific docs under `docs/`, `uci/`, and `memory.md`.

---

## Start here

| Audience | Read first |
|----------|------------|
| Investor / acquirer reviewer | [REPOSITORY_AND_ACCOUNT_INVENTORY.md](./REPOSITORY_AND_ACCOUNT_INVENTORY.md) → [IN_FLIGHT_STATUS.md](./IN_FLIGHT_STATUS.md) |
| Incoming engineer | [ARCHITECTURE.md](./ARCHITECTURE.md) → [DEPLOY.md](./DEPLOY.md) → [ENV.md](./ENV.md) |
| Ops / recovery | [RESTORE.md](./RESTORE.md) → [RAILWAY_PRODUCTION_STATUS.md](./RAILWAY_PRODUCTION_STATUS.md) |
| Finance / billing | [QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md](./QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md) → [QUICKBOOKS_PRODUCTION_E2E.md](./QUICKBOOKS_PRODUCTION_E2E.md) |

---

## Core documents (required)

| Document | Purpose |
|----------|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System components and interactions |
| [DEPLOY.md](./DEPLOY.md) | Deploy, verify, rollback (non-destructive) |
| [RESTORE.md](./RESTORE.md) | Recovery procedures and verified gaps |
| [ENV.md](./ENV.md) | Complete environment variable inventory |

---

## Supporting audits

| Document | Purpose |
|----------|---------|
| [REPOSITORY_AND_ACCOUNT_INVENTORY.md](./REPOSITORY_AND_ACCOUNT_INVENTORY.md) | Git, branches, account ownership |
| [IN_FLIGHT_STATUS.md](./IN_FLIGHT_STATUS.md) | Active work and risk summary |
| [RAILWAY_PRODUCTION_STATUS.md](./RAILWAY_PRODUCTION_STATUS.md) | Production deploy snapshot |
| [QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md](./QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md) | QuickBooks implementation and production status |
| [QUICKBOOKS_UAT.md](./QUICKBOOKS_UAT.md) | QuickBooks UAT procedures |
| [QUICKBOOKS_PRODUCTION_E2E.md](./QUICKBOOKS_PRODUCTION_E2E.md) | Production E2E test project, results, continuation |
| [TECHNICAL_EFFORT_ESTIMATES.md](./TECHNICAL_EFFORT_ESTIMATES.md) | Scoped hour estimates |
| [DOCUMENTATION_CLEANUP_AUDIT.md](./DOCUMENTATION_CLEANUP_AUDIT.md) | Doc overlap and cleanup plan |
| [REPLIT_RETIREMENT_AUDIT.md](./REPLIT_RETIREMENT_AUDIT.md) | Replit branch retirement |
| [LOVABLE_RETIREMENT_AUDIT.md](./LOVABLE_RETIREMENT_AUDIT.md) | Lovable reference retirement |
| [REPOSITORY_DOCUMENTATION_STRUCTURE.md](./REPOSITORY_DOCUMENTATION_STRUCTURE.md) | Recommended doc layout |
| [TECHNICAL_REMEDIATION_BACKLOG.md](./TECHNICAL_REMEDIATION_BACKLOG.md) | Known issues not fixed here |

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

**Cleanup of duplicate or legacy docs requires explicit approval** — see [DOCUMENTATION_CLEANUP_AUDIT.md](./DOCUMENTATION_CLEANUP_AUDIT.md).
