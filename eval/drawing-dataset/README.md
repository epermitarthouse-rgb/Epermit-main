# Phase 2A drawing evaluation dataset

Offline dataset builder for the Supabase Code Analyzer. It inventories a drawing directory, extracts the PDF text layer, measures unread ink, and links the frozen run `649fdaa6` findings to source files.

It does not call a model, write to Supabase, change stored findings, or modify Code Analyzer V2. That path stays comprehension, drawing index, hybrid retrieval, discipline review, verifier, and report.

## What this run is

The published fixture has 252 findings and 82 sheet-and-title identities (81 distinct sheet numbers). Those identities are not filenames. The source directory is counted by walking it. A difference between 82 identities and the file count is a reconciliation result, not something the builder corrects.

Precision and recall stay **Not measured**. Model findings and external review notes are not verified labels. The four verified regression cases and four provisional review candidates stay in `src/lib/supabaseAnalyzer/qualityBenchmark.ts`.

## Extraction

For every file, the inventory records the relative path, filename, format, byte size, SHA-256, and a terminal status. Zip members are listed and are not unpacked into the drawing set. Duplicate byte hashes and duplicate filenames are both recorded. Nothing is dropped because extraction failed.

For every PDF page:

- Text-layer items keep their strings, fonts, and PDF coordinates. Symbols and units are not rewritten.
- Lines are grouped from those items. Wide horizontal gaps stay separate lines.
- Annotations, date spans, and code-reference spans are copied from the text layer and marked `machine_extracted`.
- The page is rendered at low resolution and split into an 8 by 6 ink grid. Phase 2A.1 records ink without a text-layer item. Phase 2A.2 classifies every cell and does not assume ink is missing text.
- Structured notes, dimensions, schedules, and references are produced with the existing `drawingStructureV2` reader from the text layer only. Its status stays partial for text-layer input. Relationships are not marked verified.
- A CropBox or an indirect page box is reported. Indirect boxes are not treated as compared.

A file is accounted for when it has a terminal status. A page is accounted for when it has a record. Neither means the drawing was fully read. This extractor does not claim complete content capture.

## Phase 2A.2 recovery

The production Supabase analyzer sends each PDF to GPT-4o as `input_file`. It does not feed this dataset to the model. These McDonald's sheets are CAD path drawings: tens of thousands of stroke operators and few live text operators. Title-block strings are in the PDF text layer. Plan lettering is outlined geometry.

Recovery uses the Code Analyzer worker's local macOS Vision OCR on tiled page renders. OCR strings are `visual_interpretation` and are not professionally verified. Vector reconstruction of outlined fonts is not attempted. No new cloud OCR or GPT-4o pass is used.

Every 8×6 cell is classified:

- hypothesized graphic kind from ink and edge density (`empty`, `linework`, `dense_fill`, `mixed_graphics`)
- lettering status from what was actually read (`text_layer`, `ocr_recovered`, `none_read`, …)
- remaining unread only when the cell is mixed graphics, OCR ran, and no lettering was read

`S-204.00.pdf` keeps two published titles. `S-300.00.pdf` stays unmatched. OCR sheet tokens on `S-300.00` are reported and do not reassign the file.

```bash
node eval/drawing-dataset/cli/recover-context.mjs \
  --source "/absolute/path/to/drawing-directory" \
  --out eval/drawing-dataset/out/mcd-649fdaa6
```

OCR needs macOS Vision and is cached under `out/recovery/<sha256>.json`. `--force` re-runs recovery. Precision and recall stay **Not measured**.

## Phase 2A.2 hybrid extraction pilot

Isolated comparison of **Docling + PyMuPDF + targeted OCR** on eight representative sheets. It does not rewrite the 2A.1 extracts, the 252 findings, or the Supabase analyzer.

```bash
node eval/drawing-dataset/cli/hybrid-pilot.mjs \
  --source "/absolute/path/to/drawing-directory" \
  --out eval/drawing-dataset/out/mcd-649fdaa6
```

Python tools live in `eval/drawing-dataset/.venv` (gitignored). Create it with Python 3.12 and `eval/drawing-dataset/python/requirements.txt`. Outputs go to `out/mcd-649fdaa6/hybrid-pilot/` and stay gitignored. `--docling off` skips Docling. `--force` re-runs cached PyMuPDF/OCR.

The eight pilot filenames are fixed in `lib/hybridSelect.mjs`. `S-204.00.pdf`, `S-300.00.pdf`, and `Archive.zip` remain separately accounted. OCR is limited to mixed-graphics cells; linework and dense fill are not treated as missing text.

## Phase 2A.3 layout reconstruction pilot

Isolated five-sheet layout reconstruction using **PyMuPDF + reused Vision OCR + OpenCV + Shapely**. PaddleOCR PP-StructureV3 and Microsoft Table Transformer are deferred unless later evidence needs them.

```bash
node eval/drawing-dataset/cli/layout-pilot.mjs \
  --source "/absolute/path/to/drawing-directory" \
  --out eval/drawing-dataset/out/mcd-649fdaa6
```

Sheets: `A-1.00-00.pdf`, `FP200 .pdf`, `M-3.0.pdf`, `E-2.1-00.pdf`, `S-204.00.pdf`. Outputs go to `out/.../layout-pilot/` (gitignored). Region overlays are PNGs under `layout-pilot/overlays/`. Relationships are candidates only; proximity alone is not treated as proof.

## Phase 2A.4 full layout reconstruction

Expands the proven OpenCV band layout + reused Vision OCR association to **all 82 PDFs**. No new extraction frameworks. Outputs stay under `out/.../layout-full/` (gitignored). Resumable via per-page caches; `--force` rebuilds.

```bash
node eval/drawing-dataset/cli/layout-full.mjs \
  --source "/absolute/path/to/drawing-directory" \
  --out eval/drawing-dataset/out/mcd-649fdaa6
```

Writes page JSON, overlays, `coverage.json`, `failures.json`, `unresolved-layout.jsonl`, discipline `validation-samples.json`, and `semantic-prep.json` (paraphrase candidates for Phase 2A.5 — **not** counted as grounding). `S-204.00` dual titles and unmatched `S-300.00` stay explicit. Precision and recall remain **Not measured**.

## Phase 2A.5 semantic evidence grounding

Retrieves evidence candidates for all 252 findings from layout associations/OCR using lexical overlap, numeric facts, location keywords, technical terms and explicit relationships. Automated statuses: `supported`, `contradicted_candidate`, `insufficient_evidence`, `unresolved`. These are **not** professional verification. Precision, recall and false-negative rates stay **Not measured**.

```bash
node eval/drawing-dataset/cli/semantic-ground.mjs \
  --out eval/drawing-dataset/out/mcd-649fdaa6
```

Outputs go to `out/.../semantic-ground/` (gitignored). Critical findings are prioritized in `critical-priority.md` and `independent-review-pack.json`. `missedIssueSlots` stays empty until a human reviewer adds confirmed missed issues. Automated match label is `evidence_retrieved` (not verified grounding).

## Phase 2A.6 benchmark adjudication

Structured human adjudication with separate dimensions: **evidence grounding**, **technical correctness**, and **finding validity**. Stable `benchmarkId` UUIDs use wording + source-file hashes. Outcomes: confirmed_valid, false_positive, needs_more_evidence, not_applicable, deferred. Precision/recall stay **Not measured** until authorized verified reviews exist.

```bash
node eval/drawing-dataset/cli/adjudicate-init.mjs \
  --source "/absolute/path/to/drawing-directory" \
  --out eval/drawing-dataset/out/mcd-649fdaa6 \
  --crop-limit 12

node eval/drawing-dataset/cli/adjudicate-apply.mjs \
  --out eval/drawing-dataset/out/mcd-649fdaa6 \
  --decision /path/to/decision.json

node eval/drawing-dataset/cli/adjudicate-missed.mjs \
  --out eval/drawing-dataset/out/mcd-649fdaa6 \
  --issue /path/to/missed-issue.json
```

Queue order: Critical → contradicted_candidate → insufficient_evidence → unresolved → evidence_retrieved → remainder. C-002 is annotated so reviewers judge evidence presence separately from hydraulic correctness. No AI Accept/Modify/Reject path writes professional verification.

## Phase 2A.7 Critical finding validation pilot

Provisional validation of **C-001..C-004** through the adjudication workflow. Separates evidence grounding, technical correctness and finding validity. Does **not** set professionally verified metrics.

```bash
node eval/drawing-dataset/cli/critical-pilot.mjs \
  --source "/absolute/path/to/drawing-directory" \
  --out eval/drawing-dataset/out/mcd-649fdaa6
```

Outputs: `adjudication/critical-pilot/` (assessments, usability gaps, expanded crops). Precision/recall stay **Not measured**.

## Phase 2B targeted accuracy improvements

Persist-time guards in `supabase/functions/_shared/analyzerFindingQuality.ts` and prompt rules in `analyzerReviewScope.ts` address recurring Critical false-positive patterns (hydraulic density×area vs FLOW DEMAND, unread cross-sheet details, absence claims contradicted by cited evidence, keynote mismatches). Frozen drafts: `eval/drawing-dataset/fixtures/phase2b-critical-regression.json`. Historical stored findings are not rewritten. Precision/recall stay **Not measured**.

## Phase 3A cross-sheet evidence retrieval

Optional processor path (default **off**): `ANALYZER_CROSS_SHEET_RETRIEVAL=true` (preferred Edge secret; legacy `SUPABASE_ANALYZER_CROSS_SHEET_RETRIEVAL` also accepted). Detects explicit SEE SHEET/DETAIL references, downloads up to three resolved same-run PDFs, extracts bounded text-layer excerpts via Deno `unpdf`, and appends provenance-tagged snippets to the GPT user prompt. Failures fail open to the baseline current-PDF + sheet-index path. Independent of `ANALYZER_VISUAL_EVIDENCE`. Does not import the McDonald's eval dataset or change Code Analyzer V2. Plan artifact (gitignored): `out/mcd-649fdaa6/phase3a/technical-plan.md`.

Optional Stage 1–2 sheet-local visual evidence (default **off**): `ANALYZER_VISUAL_EVIDENCE=true` (preferred; Edge rejects `SUPABASE_`-prefixed secret names). Injects bounded text-layer topic packs and quote-before-absence look-fors. Failures fail open. Independent of cross-sheet retrieval.

Sheet matching uses the normalized filename, then a unique trailing `-0` / `-00` suffix, then a single title-block token only when the filename is not itself a sheet id. A title-block token does not override a filename. `S-204.00` can carry two published titles on one file. `S-300.00` stays unmatched when the fixture has no identity for it, even if the text layer names another sheet. Zip members are listed and not unpacked. AppleDouble `._` sidecars are classified separately from drawings.

## Repeat a project

From `Epermit-main`:

```bash
node eval/drawing-dataset/cli/build-dataset.mjs \
  --source "/absolute/path/to/drawing-directory" \
  --out eval/drawing-dataset/out/mcd-649fdaa6
```

Optional flags: `--findings`, `--benchmark`, `--force`.

The output directory is gitignored. It contains client sheet text. Do not commit it or copy raw drawings into the repository.

A second run reuses `out/files/<sha256>.json` when the extractor version and file hash match. `--force` extracts again. The findings fixture is read only; the build checks that its bytes do not change.

Exit 0 means every walked file and every opened PDF page has a record. It does not mean content is complete. Read `coverage-report.md`, `acceptance.json`, and `unresolved-regions.jsonl`.

```bash
node --test eval/drawing-dataset/tests/*.test.mjs
```

Tests cover skipped unexpected files, duplicate names, duplicate bytes, multi-page PDFs, corrupt PDFs, empty extraction failure, unread ink, missing pages, and unchanged finding wording.

## Phase 3 Stage 3 — Mac Vision OCR (pilot)

Optional Apple Vision packs for A-3.06 / A-6.00 (and similar targeted sheets). Activation is **run-scoped** via `analysis_scope.stage3VisualEvidence` on `supabase_analyzer_runs`; `ANALYZER_STAGE3_VISUAL_EVIDENCE=false` is the emergency kill-switch. Operating procedure: [`STAGE3_MAC_WORKER_OPS.md`](./STAGE3_MAC_WORKER_OPS.md). Outputs stay under gitignored `out/.../stage3-mac-worker/`.

## Finding consistency & professional accuracy (eval)

Deterministic technical checks (A-3.06 / A-6.00 / FP200) live in `src/lib/supabaseAnalyzer/technicalChecks.ts` with fixtures under `fixtures/technical-checks/`. They run **alongside** GPT discovery; missing evidence is `unresolved`, never an auto-violation. OCR quotes never certify compliance.

```bash
node --experimental-strip-types eval/drawing-dataset/cli/technical-check-report.mjs
node --experimental-strip-types eval/drawing-dataset/cli/consistency-repeatability-report.mjs
node eval/drawing-dataset/cli/professional-benchmark-worksheet.mjs
```

Root-cause fixture: [`fixtures/finding-consistency-root-cause.v1.json`](./fixtures/finding-consistency-root-cause.v1.json). Review pack: [`fixtures/professional-benchmark/v1/`](./fixtures/professional-benchmark/v1/). Methodology: [`PROFESSIONAL_ACCURACY_METHODOLOGY.md`](./PROFESSIONAL_ACCURACY_METHODOLOGY.md). Consolidated report: [`FINDING_CONSISTENCY_AND_ACCURACY_REPORT.md`](./FINDING_CONSISTENCY_AND_ACCURACY_REPORT.md). Precision/recall stay **Not measured** until qualified review authorizes metrics.

### ARC professional review & learning loop (eval)

ARC reviewers use [`fixtures/professional-benchmark/v1/ARC_REVIEWER_INSTRUCTIONS.md`](./fixtures/professional-benchmark/v1/ARC_REVIEWER_INSTRUCTIONS.md). Operators follow [`ARC_PACKAGE_README.md`](./fixtures/professional-benchmark/v1/ARC_PACKAGE_README.md). Live project findings still use existing Accept / Modify / Reject (no UI redesign). Structured feedback lands in `feedback-ledger.jsonl` and never auto-changes production prompts.

```bash
node eval/drawing-dataset/cli/professional-benchmark-worksheet.mjs
node eval/drawing-dataset/cli/merge-professional-worksheet.mjs --csv /path/to/filled.csv
node eval/drawing-dataset/cli/record-missed-issue.mjs --sheet A-3.06 --title "..." --location "..." --identity "..." --role "RA"
node eval/drawing-dataset/cli/export-finalized-decisions.mjs
```

Handover: [`ARC_HANDOVER.md`](./ARC_HANDOVER.md). Readiness: [`ARC_LEARNING_LOOP_READINESS.md`](./ARC_LEARNING_LOOP_READINESS.md).

## Outputs

| File | Role |
| --- | --- |
| `inventory.json` | Every source file, hash, size, status |
| `files/<sha256>.json` | Page text, coordinates, structured context |
| `pages-manifest.json` | Per-page counts without sheet sentences |
| `unresolved-regions.jsonl` | Cells that remain unread after classification |
| `classified-cells.jsonl` | Every 8×6 cell: graphic kind, lettering status, zone |
| `ocr-lines.jsonl` | OCR lines with coordinates (`visual_interpretation`) |
| `recovery/<sha256>.json` | Per-file OCR words, operator counts, tiles |
| `recovery-validation.json` | Filename/OCR sample checks and S-204 / S-300 notes |
| `finding-map.json` | Original finding wording plus source linkage |
| `regression-cases.json` | Existing verified and provisional cases |
| `independent-review.json` | Empty list for confirmed missed issues |
| `reconciliation.json` | File-to-sheet match results |
| `zip-members.json` | Archive member names, sizes, and AppleDouble classification |
| `acceptance.json` | Accountability and content-completeness gates |
| `coverage-report.md` | Human-readable gaps |
| `hybrid-pilot/comparison.md` | Eight-sheet Docling/PyMuPDF/OCR comparison |
| `hybrid-pilot/finding-grounding.json` | Pilot grounding; original 252 findings unchanged |
| `hybrid-pilot/pages/<sha256>.json` | Layout-aware page records for the pilot sheets |
| `layout-pilot/comparison.md` | Five-sheet layout/relationship pilot report |
| `layout-pilot/pages/<sha256>.json` | Regions, clusters, associations, candidate relationships |
| `layout-pilot/overlays/<sha256>.png` | Visual overlay of detected regions |
| `layout-full/comparison.md` | 82-sheet layout coverage and reconciliation report |
| `layout-full/pages/<sha256>.json` | Full-set region/association/relationship records |
| `layout-full/overlays/<sha256>.png` | Visual overlay per drawing |
| `layout-full/coverage.json` | Measurable coverage and discipline breakdown |
| `layout-full/semantic-prep.json` | Phase 2A.5 paraphrase candidates (not grounding) |
| `layout-full/unresolved-layout.jsonl` | Failures, weak regions, unassigned text |
| `semantic-ground/comparison.md` | Retrieval coverage vs verified-accuracy disclaimer |
| `semantic-ground/finding-evidence.json` | Per-finding candidates, coordinates, automated assessment |
| `semantic-ground/independent-review-pack.json` | Reviewer queue + empty missed-issue slots |
| `semantic-ground/critical-priority.md` | All Critical findings first |
| `semantic-ground/unresolved.jsonl` | Insufficient / unresolved cases |
| `adjudication/queue.json` | Prioritized review queue |
| `adjudication/cases.json` | Full adjudication records + empty reviews |
| `adjudication/crops/` | Evidence crop PNGs + coordinate manifests |
| `adjudication/independent-sheet-review.json` | FN discovery per sheet |
| `adjudication/audit-log.jsonl` | Decision audit trail |
| `adjudication/metrics.json` | Verified vs pending; precision/recall gates |
| `adjudication/critical-pilot/` | C-001..C-004 provisional assessments + usability gaps |

To add a missed issue after a person checks the drawings, use `adjudicate-missed.mjs` or append to the independent sheet review pack. Leave recall as Not measured until that list is a real authorized review, not a model guess.
