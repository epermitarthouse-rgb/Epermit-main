# Lovable Retirement Audit

**Audit date:** 2026-08-26  
**Scope:** `reference/lovable-ui/`, `docs/lovable-*.md`, Lovable branches, production UI dependency

---

## Summary

| Question | Verdict |
|----------|---------|
| Runtime dependency on Lovable tree | **None verified** — not imported by Vite/TS build |
| Production UI depends on reference files | **No** — live UI is `src/` |
| Lovable still an active workstream | **No verified evidence** — `feat/lovable-ui-replication` has **0 commits** ahead of `main` |
| UI migration complete | **Partially verified** — replication branch merged/even; gap docs remain historical |

---

## Runtime dependency check

| Check | Result | Evidence |
|-------|--------|----------|
| `reference/lovable-ui` in `package.json` dependencies | **No** | Verified root `package.json` |
| Import from `reference/lovable-ui` in `src/` | **No** | Verified ripgrep — only JSON metadata references |
| Vite/tsconfig path aliases to reference tree | **No** | Verified `vite.config.ts`, `tsconfig.json` |
| Build includes reference tree | **No** | Vite entry is `src/main.tsx` |

### Active code references (metadata only)

| Path | Reference |
|------|-----------|
| `src/data/architectureReplicationMatrix.json` | Points to `reference/lovable-ui/lovable-permitpilot-architecture-matrix.{csv,md}` for matrix provenance |

**Impact if reference tree deleted later:** matrix regeneration script may need path update — **requires manual confirmation** before deletion.

---

## Branch evidence

| Branch | vs `main` | Notes |
|--------|-----------|-------|
| `feat/lovable-ui-replication` | **0 commits ahead of `main`** | **Verified** — migration work merged or branch even with `main` |
| Remote tracking | On `origin` | Safe to treat as historical; not an active divergence |

---

## Exact duplicates (SHA-256 verified)

| File A | File B | Hash match |
|--------|--------|------------|
| `docs/lovable-ui-audit.md` | `reference/lovable-ui/docs/lovable-ui-audit.md` | **Exact duplicate** |
| `docs/lovable-page-architecture.md` | `reference/lovable-ui/docs/lovable-page-architecture.md` | **Exact duplicate** |
| `docs/lovable-design-system.md` | `reference/lovable-ui/docs/lovable-design-system.md` | **Exact duplicate** |
| `docs/lovable-component-architecture.md` | `reference/lovable-ui/docs/lovable-component-architecture.md` | **Exact duplicate** |

**Method:** `shasum -a 256` compared pairwise — not name-only matching.

---

## Near-duplicates / overlapping scope (not byte-identical)

| Cluster | Files | Relationship |
|---------|-------|----------------|
| Gap / replication plans | `docs/lovable-ui-full-gap-and-replication-plan.md`, `docs/lovable-vs-current-gap-analysis.md`, `docs/ui-replication-plan.md`, `docs/lovable-ui-implementation-audit.md` | **Overlapping scope** — different dates/audits; retain until consolidated |
| Reference-only stitch HTML | `reference/lovable-ui/stitch-reference/**` | **Historical design mockups** — not production UI |
| Duplicated docs (above) | `docs/lovable-*` vs `reference/lovable-ui/docs/lovable-*` | **Exact copies** |

---

## Reference tree size

| Metric | Value |
|--------|-------|
| Path | `reference/lovable-ui/` |
| File count | **344** files |
| Disk size | **~30 MB** |

---

## Unimplemented requirements only in Lovable references

**Inferred from gap-analysis docs (not verified as current product commitments):**

- Some admin/financial UI mockups in `stitch-reference/` (QuickBooks admin screens, post-mortem UX)
- Matrix entries may mark features as Lovable-only

**Requires manual confirmation:** client/product owner review of `architectureReplicationMatrix.json` for open gaps.

---

## File disposition (no action taken)

| Path / group | Disposition |
|--------------|-------------|
| `reference/lovable-ui/` (whole tree) | **Retain as historical audit evidence** |
| Exact duplicate `docs/lovable-*.md` (4 files) | **Consolidate after approval** — keep one copy under `docs/architecture/` or `docs/archive/` |
| `docs/lovable-ui-full-gap-*.md`, replication plans | **Retain** until product confirms migration closed |
| `reference/lovable-ui/stitch-reference/**` | **Retain as historical audit evidence** (design-only HTML) |
| `src/data/architectureReplicationMatrix.json` | **Still required** by active metadata / audits |

**Not classified as safe to delete** in this audit without explicit approval and matrix migration plan.

---

## Recommendation

1. Mark Lovable as **reference/archive**, not active platform.
2. Do **not** delete `reference/lovable-ui/` until matrix provenance is relocated.
3. After approval, consolidate exact duplicate markdown (4 pairs) to single location.
4. Optional future: compress stitch HTML into `docs/archive/lovable-design-2026/` summary.

**Final classification:** **Retain as historical audit evidence** (with **consolidate after approval** for exact duplicate markdown)
