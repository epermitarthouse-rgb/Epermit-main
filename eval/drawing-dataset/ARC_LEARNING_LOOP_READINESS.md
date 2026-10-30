# ARC Professional Review & Learning Loop — Readiness Report

**Date:** 2026-10-30  
**Scope:** Local/eval implementation + existing production review reuse.  
**No commits, pushes, migrations, or deployments in this phase.**

## 1. Audit — existing vs new

| Capability | Status | Notes |
| --- | --- | --- |
| Accept / Modify / Reject on published findings | **Deployed / production-verified** | `reviewDecisions.ts`, UI card, `supabase_analyzer_finding_reviews`, RLS, `finding_review_saved` audit |
| Reviews in PDF / Excel / JSON export | **Deployed** | Findings preserved; reviews stored separately |
| AI findings immutable on Accept | **Production-verified** | Reviews do not UPDATE finding text/severity |
| Professional benchmark v1 (18 items) | **Implemented (local)** | Prior phase |
| `technicalChecks.ts` + consistency CLIs | **Implemented + locally tested** | Prior phase |
| CA V2 learning loop | **Separate product** | Untouched; no bridge |
| ARC worksheet merge / ledger / missed issues / export summary | **Newly implemented (local)** | This phase |
| In-app `insufficient_evidence` button | **Not built** | Worksheet + ledger support; propose later if ARC needs it in UI |
| Auto production learning | **Intentionally absent** | Guardrail |

## 2. ARC workflow (handover)

Package: `eval/drawing-dataset/fixtures/professional-benchmark/v1/`

1. Instructions: `ARC_REVIEWER_INSTRUCTIONS.md` (non-dev language)  
2. Operator guide: `ARC_PACKAGE_README.md`  
3. Worksheet: generate via `professional-benchmark-worksheet.mjs`  
4. Decisions: Accept / Reject / Modify / Insufficient evidence / N/A  
5. Missed issues: `record-missed-issue.mjs` or slots JSON  
6. Completion + second-review + recurring errors: `export-finalized-decisions.mjs`  
7. Optional import of live UI decisions: `import-supabase-review-export.mjs`

**Discipline routing** is documented in reviewer instructions (RA / PE / FP).

## 3. Learning feedback loop (structured, controlled)

Append-only `feedback-ledger.jsonl` records link:

- run / finding / `pbItemId` / technical check id  
- drawing + original AI conclusion  
- ARC decision, correction, evidence, reviewer identity/role/time  
- `preliminary` vs `finalized` / `needs_second_review` / `disputed`  
- analyzer / evidence extraction versions (optional fields)  

**Hard rule:** `independentlyVerified` / `contributesToMetrics` stay false unless `--authorize-metrics`.

Loop: reviewed evidence → ledger → evaluation export → improvement candidates → **approved** regression/test release.  
No automatic prompt/validator changes; no fine-tuning.

## 4. Improvement evaluation

`export-finalized-decisions.mjs` emits:

- completion tracking  
- decision counts  
- disagreements / second-review queue  
- false-positive & missed-issue improvement candidates with traceable `sourceRecordId`  
- explicit `automaticProductionLearning: false`

Precision/recall remain **Not measured** until authorized metrics contribution on a sufficient labeled set.

## 5. Local validation

| Test | Result |
| --- | --- |
| `eval/drawing-dataset/tests/arc-feedback-ledger.test.mjs` | Pass (see CI run in this session) |
| Existing `technicalChecks.test.ts` | Unaffected |
| Sample worksheet parse / decision mapping | Covered |
| Silent metrics promotion blocked | Covered |

## 6. Proposed UI change (not implemented)

If ARC needs parity in the product UI later: add an optional **“Needs more evidence”** action mapped to `insufficient_evidence` **without** replacing Accept/Modify/Reject. Present for approval before coding.

## 7. GO / NO-GO

| Decision | Verdict |
| --- | --- |
| Hand ARC the v1 package + instructions for offline/worksheet review | **GO** |
| Use existing Accept/Modify/Reject on live findings in parallel | **GO** |
| Start controlled learning evaluation from ledger exports | **GO** (eval-only) |
| Deploy new DB migrations / auto-apply reviews to prompts | **NO-GO** |
| Claim verified precision/recall | **NO-GO** until authorized labels |
| Commit/push these files | **Authorized — sync to origin/main** |

### Remaining non-blocking gaps

- No in-app insufficient-evidence button yet  
- Benchmark↔live finding linkage is heuristic when imports lack check ids  
- Drawing PDFs remain outside Git (reviewers use the client set)

See also [`ARC_HANDOVER.md`](./ARC_HANDOVER.md) for reviewer assignment and return-path ops.
