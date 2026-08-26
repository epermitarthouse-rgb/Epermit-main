# Lovable Retirement Audit

**Audit date:** 2026-08-26  
**Scope:** `reference/lovable-ui/`, `docs/lovable-*.md`, Lovable branches, production UI dependency, Vercel preview configuration

---

## Summary

| Question | Verdict |
|----------|---------|
| Runtime dependency on Lovable tree | **None verified** — not imported by Vite/TS build |
| Production UI depends on reference files | **No** — live UI is `src/` |
| Lovable still an active workstream | **No verified evidence** — `feat/lovable-ui-replication` has **0 commits** ahead of `main` |
| UI migration complete | **Partially verified** — replication branch merged/even; gap docs remain historical |
| Vercel Preview env for Lovable branch | **Client/dashboard confirmed** — branch-specific `VITE_API_BASE_URL` for Preview on `feat/lovable-ui-replication` |

---

## Vercel environment finding (client/dashboard confirmed)

| Variable | Scope | Action in this task |
|----------|-------|---------------------|
| `VITE_API_BASE_URL` | Preview only — branch `feat/lovable-ui-replication` | **Do not delete** |
| Recommendation | — | Remove only after Lovable preview branch is **formally retired** and stakeholders confirm Preview is unused |

Primary `VITE_API_BASE_URL` for All Environments is documented in [ENV.md](./ENV.md) and [DEPLOY.md](./DEPLOY.md).

---

## Runtime dependency check

| Check | Result | Evidence |
|-------|--------|----------|
| `reference/lovable-ui` in `package.json` dependencies | **No** | Verified root `package.json` |
| Import from `reference/lovable-ui` in `src/` | **No** | Verified ripgrep — only JSON metadata references |
| Vite/tsconfig path aliases to reference tree | **No** | Verified `vite.config.ts`, `tsconfig.json` |
| Build includes reference tree | **No** | Vite entry is `src/main.tsx` |

### Active code references (metadata / provenance)

| Path | Reference |
|------|-----------|
| `src/data/architectureReplicationMatrix.json` | `sourceCsv` / `sourceMd` → `reference/lovable-ui/lovable-permitpilot-architecture-matrix.{csv,md}`; `branch`: `feat/lovable-ui-replication`; `generatedAt`: 2026-08-04 |
| `scripts/generate-architecture-replication-data.py` | Reads CSV/MD from `reference/lovable-ui/`; writes `src/data/architectureReplicationMatrix.json` |
| `scripts/generate-lovable-permitpilot-matrix.py` | Regenerates CSV/MD under `reference/lovable-ui/` from Lovable source inputs |

**Impact if reference tree deleted without plan:** matrix regeneration and provenance audit trail break — requires preserved minimum record (below).

---

## Branch evidence

| Branch | vs `main` | Notes |
|--------|-----------|-------|
| `feat/lovable-ui-replication` | **0 commits ahead of `main`** | **Verified** — migration work merged or branch even with `main` |
| Remote tracking | On `origin` | Historical; Vercel Preview env may still reference it |
| Vercel Preview `VITE_API_BASE_URL` | **Client/dashboard confirmed** | Likely obsolete — retain until formal branch retirement |

---

## Exact duplicates (SHA-256 verified)

| File A | File B | SHA-256 |
|--------|--------|---------|
| `docs/lovable-ui-audit.md` | `reference/lovable-ui/docs/lovable-ui-audit.md` | `fefb919b4a3dbfd0306fba66b1fe47b4d5a84be442495192d4a2f6eb750dbfe5` |
| `docs/lovable-page-architecture.md` | `reference/lovable-ui/docs/lovable-page-architecture.md` | `f58c783c64f87095cab9a5f480b514a5e600b893e46f1854bc13fad7988af084` |
| `docs/lovable-design-system.md` | `reference/lovable-ui/docs/lovable-design-system.md` | `adc41e7c80d1aa71f148bd3d529b72cdcd3f34495b112955f3f067f93d24485e` |
| `docs/lovable-component-architecture.md` | `reference/lovable-ui/docs/lovable-component-architecture.md` | `5f8574e9483bcfa54ccf89a2eb2c2919f2688355483bc5a03385fbe1dd64752b` |

**Method:** `shasum -a 256` compared pairwise — not name-only matching.

---

## Near-duplicates / overlapping scope (not byte-identical)

| Cluster | Files | Relationship |
|---------|-------|----------------|
| Gap / replication plans | `docs/lovable-ui-full-gap-and-replication-plan.md`, `docs/lovable-vs-current-gap-analysis.md`, `docs/ui-replication-plan.md`, `docs/lovable-ui-implementation-audit.md` | **Overlapping scope** — different dates/audits; retain until consolidated |
| Reference-only stitch HTML | `reference/lovable-ui/stitch-reference/**` | **Historical design mockups** — not production UI |
| Duplicated docs (above) | `docs/lovable-*` vs `reference/lovable-ui/docs/lovable-*` | **Exact copies** (four pairs) |

---

## Reference tree size

| Metric | Value |
|--------|-------|
| Path | `reference/lovable-ui/` |
| File count | **344** files |
| Disk size | **~30 MB** |

---

## Minimum retention proposal (after approval — no action in this task)

Goal: preserve matrix provenance and audit evidence **without** retaining all 344 files indefinitely.

### Must retain (minimum historical record)

| Asset | Reason |
|-------|--------|
| `reference/lovable-ui/lovable-permitpilot-architecture-matrix.csv` | Source for `architectureReplicationMatrix.json` |
| `reference/lovable-ui/lovable-permitpilot-architecture-matrix.md` | Human-readable matrix source |
| `src/data/architectureReplicationMatrix.json` | Active metadata consumed by audits |
| `scripts/generate-architecture-replication-data.py` | Regeneration/validation path |
| One copy of each **exact duplicate** doc pair (4 files — prefer `docs/` or `docs/archive/lovable/`) | SHA-256 evidence above |
| `LOVABLE_RETIREMENT_AUDIT.md` (this file) + hash table | Retirement decision record |

### Preserve provenance in JSON after cleanup

Embed or sidecar: `generatedAt`, source CSV/MD paths, git commit hash at generation time, and note that full stitch HTML was archived separately.

### Safe to remove after approval (candidate — not executed)

| Group | Approx. count | Condition |
|-------|--------------:|-----------|
| `reference/lovable-ui/stitch-reference/**` | ~250+ HTML mockups | After compressed archive or summary doc approved |
| Duplicate `reference/lovable-ui/docs/lovable-*.md` (4 files) | 4 | After single canonical copy retained |
| Redundant gap-analysis markdown | varies | After product owner signs migration closed |
| Entire `reference/lovable-ui/` remainder | balance | After CSV/MD + JSON provenance relocated to `docs/archive/lovable/` |

### Vercel cleanup (after branch retirement)

1. Retire `feat/lovable-ui-replication` branch (process TBD).
2. Remove Preview-scoped `VITE_API_BASE_URL` override in Vercel.
3. Confirm no Preview deployments depend on Lovable branch.

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
| `reference/lovable-ui/` (whole tree) | **Retain until minimum archive plan approved** |
| Exact duplicate `docs/lovable-*.md` (4 files) | **Consolidate after approval** |
| `docs/lovable-ui-full-gap-*.md`, replication plans | **Retain** until product confirms migration closed |
| `reference/lovable-ui/stitch-reference/**` | **Candidate for compressed archive** — not production UI |
| `src/data/architectureReplicationMatrix.json` | **Still required** |
| Vercel Preview `VITE_API_BASE_URL` | **Retain** — remove only after Lovable preview branch retired |

---

## Recommendation

1. Mark Lovable as **reference/archive**, not active platform.
2. Do **not** delete `reference/lovable-ui/` until minimum retention set is relocated (CSV/MD + JSON provenance).
3. After approval, consolidate exact duplicate markdown (4 pairs) to single location with hash record preserved.
4. Remove Vercel Preview env override **only after** `feat/lovable-ui-replication` is formally retired.

**Final classification:** **Retain minimum provenance set; compress or archive remainder after approval**
