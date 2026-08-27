# Documentation Cleanup Audit

**Audit date:** 2026-08-26 (corrected)  
**No cleanup performed.** Deletion/archival requires explicit approval after retirement audits.

Index: [README.md](./README.md)

---

## 1. Repository instructions

| File | Role |
|------|------|
| `README.md` | Local development entry |
| `memory.md` | Scraper engineering handbook |
| **No `AGENTS.md`** | Not present |

**Diligence handover authority:** `docs/diligence-readiness/` (this package).

---

## 2. Document classification

### Exact duplicates (SHA-256 verified)

| File A | File B |
|--------|--------|
| `docs/lovable-ui-audit.md` | `reference/lovable-ui/docs/lovable-ui-audit.md` |
| `docs/lovable-page-architecture.md` | `reference/lovable-ui/docs/lovable-page-architecture.md` |
| `docs/lovable-design-system.md` | `reference/lovable-ui/docs/lovable-design-system.md` |
| `docs/lovable-component-architecture.md` | `reference/lovable-ui/docs/lovable-component-architecture.md` |

### Near-duplicates / overlapping scope (not byte-identical)

| Cluster | Relationship |
|---------|--------------|
| `docs/lovable-ui-full-gap-and-replication-plan.md`, `docs/lovable-vs-current-gap-analysis.md`, `docs/ui-replication-plan.md` | Overlapping migration planning |
| `docs/current-system-architecture.md` vs `docs/diligence-readiness/ARCHITECTURE.md` | Snapshot (2026-07-21) vs diligence handover |
| `docs/uci-action-items-status.md` vs multiple `uci/*.md` | Same lifecycle, different formats |

### Historical snapshots

| Path | Notes |
|------|-------|
| `reference/lovable-ui/stitch-reference/` | Design HTML mocks |
| `replit-agent` branch | Replit-era tree — see [REPLIT_RETIREMENT_AUDIT.md](./REPLIT_RETIREMENT_AUDIT.md) |

### Active sources of truth

| Topic | Authoritative |
|-------|---------------|
| Diligence / handover | `docs/diligence-readiness/*` |
| UCI lifecycle status | `docs/uci-action-items-status.md` |
| Scraper contracts | `memory.md` |
| Schema | `supabase/migrations/` |
| Local dev | `README.md` |

---

## 3. Protected work (do not conflate with cleanup)

| Item | Status |
|------|--------|
| `feat/code-analyzer-async-v2` | **Intentionally local-only** — not a cleanup candidate |
| Code Modification WIP | **Deliberate uncommitted work** — not a cleanup candidate |

---

## 4. Platform retirement (see dedicated audits)

| Platform | Audit | Verdict |
|----------|-------|---------|
| Replit | [REPLIT_RETIREMENT_AUDIT.md](./REPLIT_RETIREMENT_AUDIT.md) | Archive/tag before deletion |
| Lovable | [LOVABLE_RETIREMENT_AUDIT.md](./LOVABLE_RETIREMENT_AUDIT.md) | Retain as historical evidence; consolidate duplicates after approval |

**No Replit/Lovable archival or deletion in this task.**

---

## 5. Recommended structure (not executed)

See [REPOSITORY_DOCUMENTATION_STRUCTURE.md](./REPOSITORY_DOCUMENTATION_STRUCTURE.md).

---

## 6. Cleanup gate

Cleanup proceeds only after:

1. Documentation corrections merged from `docs/diligence-readiness`
2. Replit and Lovable retirement audits reviewed and approved
3. Explicit deletion/consolidation plan sign-off

---

## 7. This package (13 files)

All under `docs/diligence-readiness/` including new audits, backlog, structure proposal, and corrected core four.
