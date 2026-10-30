# Finding Consistency & Professional Accuracy — Consolidated Report

**Date:** 2026-10-30  
**Scope:** Eval/local only. No production deploy, migration, commit/push, or paid GPT in this phase.  
**Professionally verified:** false  
**Precision/recall measured:** false

## Status legend

| Label | Meaning |
| --- | --- |
| **Implemented (local)** | Code/fixtures present in the working tree |
| **Locally tested** | Unit tests / CLI dry-run passed |
| **Deployed** | Not done (awaiting approval) |
| **Production-verified** | Not claimed |

---

## 1. Root causes of finding inconsistency

Supported by [`fixtures/finding-consistency-root-cause.v1.json`](./fixtures/finding-consistency-root-cause.v1.json) and frozen three-run fixtures.

1. **GPT-4o emission variance** — Same topics appear, disappear, or change severity across full runs (primary driver).
2. **Evidence availability/association** — CAD-outlined sheets need Stage 1–2/Stage 3 packs for quotable height/hardware; absence claims rise when packs miss.
3. **Validator coverage gaps** — Persist soft-fails only adjust matching drafts; they cannot restore under-emitted Criticals; some baseline patterns miss the intended rule id.
4. **No stable cross-run issue identity** — Heuristic sheet+topic matching only.
5. **Config deltas** — Phase 2B prompts/validators, Stage 1–2 visual flag, Stage 3 Vision packs change behavior between the five runs.

**Do not** interpret fewer findings as higher accuracy.

## 2. Historical issue-matched comparison

| Topic | baseline `649fdaa6` | Phase2B `75a7ad57` | v8 `b982a22c` | Stage1–2 `265d6850` | Stage3 `db6475d4` (2 sheets) |
| --- | --- | --- | --- | --- | --- |
| A-3.06 height | warning | advisory | **critical** | advisory (look-for miss) | advisory **quotes 3'-6"** |
| A-6.00 lock/fire | mixed W/A | **2× critical** | milder / gone | combined advisory | panic/closer quotes; no fire Critical |
| FP200 hydraulics | **critical** density×area | advisory | advisory | advisory | not in run |

Published counts: 252 → 246 → 214 → 188; Stage3 = 6 (not comparable).

## 3. Technical-check framework & local results

**Implemented (local) + locally tested**

- Module: [`src/lib/supabaseAnalyzer/technicalChecks.ts`](../src/lib/supabaseAnalyzer/technicalChecks.ts)
- Fixtures: [`fixtures/technical-checks/`](./fixtures/technical-checks/)
- Tests: 12/12 pass (`technicalChecks.test.ts`)
- CLI: `cli/technical-check-report.mjs`

Pilot dry-run summary (fixtures):

| Outcome | Count |
| --- | --- |
| supported_issue | 3 |
| no_issue_evidenced | 6 |
| unresolved | 0 |
| not_applicable | 7 |

Hard rules enforced in tests: missing evidence → `unresolved`; OCR never sets `independentlyVerified`; absence-vs-quote flags do **not** auto-clear Criticals.

## 4. Repeatability metrics & limitations

**Locally tested** via `cli/consistency-repeatability-report.mjs`:

- Technical-check re-run agreement: **true** (100% on fixed fixtures)
- Phase2B → v8 heuristic topics missing in v8: **21** (emission variance signal)
- Historical token/cost: Stage3 controlled ~$0.029; full runs ~$1.5 — **no new GPT**

Limitations: heuristic topic keys; Stage3 2-sheet only; checks are not professional accuracy.

## 5. Reviewable professional benchmark dataset

**Implemented (local):** [`fixtures/professional-benchmark/v1/`](./fixtures/professional-benchmark/v1/)

- 18 review items (guardrail, doors, hydraulics, C-001–C-004, dates, GFCI, editions, consistency slot)
- Empty missed-issue slots for 6 sheets
- Label map to Phase 2A.6 enums
- CSV worksheet generator: `cli/professional-benchmark-worksheet.mjs`

All items `independentlyVerified: false`.

## 6. Reviewer workflow & labeling

Documented in [`PROFESSIONAL_ACCURACY_METHODOLOGY.md`](./PROFESSIONAL_ACCURACY_METHODOLOGY.md).

- Offline worksheet/JSON (v1)
- Reuse in-app Accept/Modify/Reject for delivery only — gold labels live in the benchmark pack
- No new UI built

## 7. Proposed precision/recall methodology

See methodology doc. Verified metrics only on `contributesToMetrics` reviews; recall only with missed-issue coverage; **no single overall accuracy %** from incomplete labels.

## 8. Minimal production integration (pending approval)

If approved later (smallest path):

1. Optionally attach `runTechnicalChecks` results to `raw_metadata.technical_checks` in the processor **after** `validateAnalyzerFindings` (fail-open; default off / run-scoped).
2. Surface read-only check hints in the existing quality drawer.
3. Do **not** auto-withhold or auto-clear Criticals from OCR alone.
4. Keep Stage 3 run-scoped activation unchanged.

**Not done now** — requires explicit approval (no deploy/commit in this phase per brief).

## 9. Remaining risks

| Blocking | Non-blocking |
| --- | --- |
| None for starting offline professional review | No in-app benchmark UI |
| | Fire-rating look-for still weak without schedule cell OCR |
| | Cross-run issue IDs not in production DB |
| | CA V2 untouched; dual-stack cognitive load |

## 10. GO / NO-GO

| Decision | Verdict |
| --- | --- |
| Start professional review on pack v1 | **GO** |
| Continue iterating technical checks eval-only | **GO** |
| Deploy technical checks into production processor | **NO-GO** until approval + gated rollout plan |
| Claim measured precision/recall | **NO-GO** until authorized reviewer metrics |
| Paid GPT consistency reruns | **NO-GO** unless a ≤$0.10 2-sheet plan is approved |

### Optional paid GPT plan (not executed)

- Purpose: check-vs-model agreement on A-3.06 + A-6.00 only  
- Cap: **$0.10**  
- Stage 3 run-scoped opt-in; kill-switch off after  
- Requires explicit approval before any call
