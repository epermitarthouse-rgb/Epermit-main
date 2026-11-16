# Qwen2.5-VL-72B + GPT-5.6 Luna: end-to-end analyzer evaluation, five drawings

Date: 2026-11-17. Drawings: A-3.06, A-4.00, A-1.01, A-6.00, S-201 (75 New York Ave & 1st St, Washington DC, Permit Rev 5). Code context: 2017 DC Construction Codes (2015 IBC base). Local experiment only: nothing was written to Supabase, no production route or analyzer code was changed, nothing was deployed.

## Summary

**The Qwen-based analyzer found 8 issues across the five drawings (7 valid, 1 preliminary) with no errors and no unsupported claims. The existing analyzer, over 30 runs, published 82 findings: 4 valid, 13 errors and 58 unsupported.** Qwen's OCR reaches the reasoning model with far more correct text, and the cross-sheet resolution removed the "missing reference" false positives. Recall is still incomplete. All Luna arms missed the blank seismic design category, which the baseline caught in 3 of 9 runs. The Qwen arms also missed three issues that Luna found from Apple Vision text. And 3 of the 8 findings appear in only 1 of 3 runs.

**Recommendation: Requires further improvement.** The eight findings below can be shown in a controlled, accompanied client demo as evaluator-checked results. The pipeline is not ready to produce such results unattended, and it is not approved for production.

Spend for this task: **$0.2216** of the $2.00 cap (45 GPT-5.6 Luna calls plus one probe, from a persistent ledger). No new OCR calls: all 564 cached Qwen replies were reused.

## 1. OCR and evidence (Phase 1, no paid calls)

| | Value |
|---|---|
| Exact technical rows in the Qwen OCR (of 232 ground-truth rows) | 141 |
| Unmarked incorrect values | 7, of which 1 is a genuine misread (A-6.00 `2'-6"` read `2'-0"`, rotated) |
| Exact rows delivered to the analyzer by the spatial selector (~3,200 characters) | **132** = 128 already exact in the OCR + 4 tile-seam resolutions (A-3.06) |
| Apple Vision 4x3 v2 block, same budget | 67 |

**Metric reconciliation.** The earlier report said the block delivered 141 rows: 128 plus 13 seam resolutions. Nine of those 13 were invalid merges. Short labels such as door number `2` inside `2 ALUM.`, bubble numbers and schedule cells were absorbed into longer readings, nowhere near a tile edge. A geometry guard now accepts a shorter reading as a cut only when every one of its provenance boxes lies within 25 px of a tile edge. The OCR report is corrected. The 0.91 figure is 128/141, the share of OCR-exact rows that the block keeps.

**The 7 unflagged incorrect values,** inspected on crops:
- Four are hand-lettered bubble numbers on A-1.01, where `1`, `9` and `10` are read as `I`, `q` and `IO`.
- One is a row already flagged elsewhere.
- One is a rotated dimension where only `MIN.` was read (A-4.00).
- One is a rotated two-row note recombined across a seam (A-3.06).

**Sheet and detail references resolved against the 82-sheet index.** The printed readings are unchanged: the OCR line stays flagged and the link records the resolution.
- Look-alike sheet numbers: `A-3.0I` → A-3.01, `A-4.0I` → A-4.01 (twice), `A-I.03` → A-1.03.
- Look-alike bubble numbers, accepted only when the target sheet lists that detail number: `q` → 9 ("MEZZANINE GLAZING @ PIER"), `IO` → 10, `II` → 11, and `I` → 1 four times.
- Totals: 39 references. 21 resolved to a detail (up from 14), 10 to a sheet and 2 to a topic. Six stay unresolved: truncated readings (`A-6.0`, `A-6.`), `UL NO. U305`, `W3`, a detail not found on its target, and the printed `4/A5.0` (verified on the crop; there is no A-5 series sheet).

## 2. Reasoning setup (Phase 2)

- **Model.** `gpt-5.6-luna`, verified before any spend: `GET /v1/models` returned 200, and the docs list $0.20 input / $1.20 output per million tokens, the Responses API and structured outputs. Reasoning effort: medium. Every call attaches the PDF.
- **Prompt and validator.** Production Code Analyzer V2 system prompt, 82-sheet index and `validateAnalyzerFindings`, all imported read-only.
- **Qwen evidence per drawing:**
  - the validated spatial summary block;
  - **question-targeted retrieval** from the full sheet index. Fourteen plan-review questions cover title block and scales, guards, roof, elevations, doors, opening force, fire ratings, accessibility, loads, wind, seismic, materials, codes and cross-references. Each section cites summary units by id and quotes units the summary omitted. This is how `BASIC WIND SPEED … 115 MPH` (omitted on S-201) and `SEISMIC DESIGN CATEGORY` reach the model;
  - cross-sheet pairs with source and target crops and the look-alike resolutions.
- **Output fields.** The model returns finding type, evidence status (confirmed / preliminary / requires professional verification), confidence, source sheets and evidence ids.
- **Budget enforcement.** An append-only ledger (`stage4/ledger.jsonl`) reserves each call's worst case before sending it and settles it at billed usage. The $2.00 cap is checked before every call. A failed call is never retried automatically, and two consecutive failures stop the run.

**Arms, 3 repetitions × 5 drawings each:**

| Arm | Evidence | Purpose |
|---|---|---|
| Baseline (saved) | Existing Supabase Analyzer V2 + Apple Vision 4x3 + GPT-4o, 30 runs | Current analyzer |
| L_av | Apple Vision v2 block + Luna, production prompt | Model effect |
| L_spatial | Qwen spatial evidence + retrieval + cross-sheet + Luna | Qwen pipeline, first version |
| L_spatial2 | L_spatial + title-block and caption readings + a one-line drafting-defect rule | Qwen pipeline, revised |

L_spatial2 was revised **after reading L_spatial's output on these same drawings.** L_spatial dropped the title-block and caption text, so it could not see `SHEET: OF 00` or `3/4"1'-0"`. The revision is generic, but tuning on the evaluation set means L_spatial2's recall is optimistic.

## 3. Findings per drawing (Phase 3)

These are the client view: the claims the Qwen arms raised, each checked against the drawing. All code references were left empty. Code text was not retrieved, so the code basis of every finding is marked for verification.

| Drawing | Finding | Severity | Status | Runs raising it |
|---|---|---|---|---|
| A-3.06 | None. Luna correctly read `3'-6"` minimum guard height and the 21" sphere note. | — | — | — |
| A-4.00 | Signage note 2 requires 60" AFF to the **centerline** of the sign. Detail 4 shows 48" min to the bottom of Braille and 60" max to the top of tactile characters. | Warning | Requires professional verification | L_spatial2 drafted 2/3, published 1 |
| A-1.01 | Title block "MEZZANINE & BASEMENT FLOOR PLAN" vs plan titles "2ND FLOOR ALTERATION FLOOR PLAN" / "BASEMENT ALTERATION FLOOR PLAN". Mezzanine vs story affects code analysis. | Advisory | Confirmed by drawing evidence | 1/3 in each Qwen arm |
| A-1.01 | General note 4 cites ICC/ANSI A117.1-**2003** under a 2015 IBC-based code. | Advisory | Requires professional verification | 1/3 |
| A-6.00 | None. A revision-table placeholder was raised and excluded as low value. | — | — | — |
| S-201 | Note 1: assumed soil bearing capacity 1,500 PSF. Note 8: minimum design soil pressure 2,500 PSF. | Warning | Requires professional verification | 3/3 L_spatial, 3/3 L_spatial2 drafts |
| S-201 | Wall section 2 scale printed `3/4"1'-0"`. | Advisory | Confirmed by drawing evidence | 3/3 L_spatial2 |
| S-201 | Title block sheet count printed `OF 00`. | Advisory | Confirmed by drawing evidence | 3/3 L_spatial2 |
| S-201 | Concrete notes cite ACI 318-**06** while design data cites IBC 2015. | Warning | Requires professional verification | L_spatial2 1/3, withheld by the production validator |
| S-201 | Cold-formed steel special inspection mapped to 1705.3.4. | Advisory | Preliminary concern | 1/3 |

Each finding's internal audit record holds:
- its evidence ids, resolved to page boxes, tiles and an uncertainty flag;
- the run file and response id;
- the production validator's outcome;
- stability across runs;
- the evaluator's note and drawing crops (`inspect/findings/*.png`).

## 4. Comparison with the existing analyzer (Phase 4)

Every published finding of all four arms was classified by hand. Each was read against the PDF text layer, the ground truth or rendered crops; 37 new adjudications were recorded in `fixtures/adjudication.json`. Agreement between arms was not treated as evidence of correctness. Classes: OK = correct; Q = uncertain or low value; U = unsupported (restates a note, generic, or treats a "SEE" pointer as an omission); E = confirmed error; H = harness or index artifact.

| Arm | Runs | Published | OK | Q | U + H | E | Cost | Mean latency |
|---|---|---|---|---|---|---|---|---|
| Baseline GPT-4o (C_v2_4x3) | 30 | 82 | 4 | 5 | 59 | **13** | $0.568 | 11.3 s |
| L_av | 15 | 23 | 11 | 3 | 9 | 0 | $0.065 | 17.2 s |
| L_spatial | 15 | 4 | 4 | 0 | 0 | 0 | $0.071 | 12.3 s |
| L_spatial2 | 15 | 20 | 11 | 9 | 0 | 0 | $0.085 | 17.6 s |

The baseline also has 1 unadjudicated finding, a spelling note.

**Distinct valid issues and which arm published them** (runs with at least one valid finding on that issue / runs):

| Issue | Baseline | L_av | Qwen arms |
|---|---|---|---|
| S-201 soil 1,500 vs 2,500 PSF | 0/9 | drafted 1/3, withheld | **yes**, stable |
| S-201 scale `3/4"1'-0"` | 1/9 | 2/3 | yes (3/3 in L_spatial2) |
| S-201 `OF 00` | 0/9 | 2/3 | yes (3/3 in L_spatial2) |
| S-201 ACI 318-06 | 0/9 | 1/3 | drafted 1/3, withheld |
| **S-201 blank seismic design category and use group** | **3/9** | 0/3 | **missed** |
| A-1.01 mezzanine vs 2nd floor | 0/3 | 1/3 | yes (1/3) |
| A-1.01 A117.1-2003 | 0/3 | 2/3 | yes (1/3) |
| A-1.01 "ADA COMPLAINT HARDWARE" typo | 0/3 | 2/3 | **missed** |
| A-4.00 sign mounting datums conflict | 0/6 | drafted 1/3, withheld | yes (1/3; 2/3 drafted) |
| A-4.00 callout `8/A400` points to detail 8 marked NOT USED | 0/6 | 1/3 | **missed** |
| A-6.00 `4/A5.0` references a sheet that does not exist | 0/9 | 1/3 | **missed** |
| A-6.00 door #11 fire-rated gaskets with no rating column (plausible) | 0/9 | 0/3 | missed |

- **Found by both the baseline and the Qwen arms:** the scale typo.
- **Found only by the Qwen arms:** soil bearing, `OF 00`, mezzanine, A117 edition and sign datums. L_av also found `OF 00`, mezzanine and A117, so these reflect the stronger model and are not unique to Qwen.
- **Missed by the Qwen arms:**
  - the blank seismic design category. The label reached the model, but no Luna run flagged it;
  - `8/A400`. The linker does not parse unhyphenated sheet tags;
  - `4/A5.0`. Unresolved references are not passed to the model;
  - the "COMPLAINT" typo.
- **False positives and unsupported conclusions:**
  - Baseline: 13 errors, including the known traps (opening-force "contradiction", snow load, exterior door) and fabricated quotes, plus 58 unsupported findings.
  - Qwen arms: 0 errors, 0 unsupported, and 9 low-value Q findings (a revision-table placeholder flagged 6 times, flush-valve wording, a blank revision table, the 1705.3.4 query).
  - L_av: 9 unsupported, for example calling the 21" sphere guard rule "permissive" (it is the guard provision for roof equipment).
- **Incorrect values or code references:** none in any Luna arm. Luna left code references empty, as instructed, unless certain. Its two drafted citations (A117.1-2009; "2015 IBC concrete provisions") are kept in the audit record and not shown.
- **Cross-sheet accuracy:** 0 false "missing reference" findings in the Qwen arms, against 4 harness-type and 1 uncertain unresolved-reference findings in the baseline. No arm produced a genuine cross-sheet finding.
- **Traceability:** every Qwen finding cites evidence ids that resolve to page boxes and tiles. The baseline cites free text only.

**Production validator issues found (Analyzer V2, independent of Qwen).** The production validator withheld **5 valid drafts** as `documented_requirement_restatement`: soil ×2, ACI ×1 and sign ×2. Its `keynote_citation_mismatch` rule rewrote the valid sign finding into "Keynote citation needs confirmation", because "Signage Note 2" looks like a keynote citation. The client view uses the model's draft text and records the validator's outcome in the audit record. The validator itself was not changed.

## 5. Cost and time

| | Qwen pipeline (this experiment) | Existing analyzer |
|---|---|---|
| OCR | Qwen 72B hosted: 564 calls, $1.0055, 17.5 min wall time at 8 workers (≈ $0.20 per drawing); cached, not rerun | Apple Vision, local, free |
| Reasoning per drawing call | Luna: $0.0047–0.0074, 8–32 s | GPT-4o: ≈ $0.019, ≈ 11 s |
| Per drawing, one run | ≈ $0.21, dominated by OCR | ≈ $0.02 |
| 82-sheet set | ≈ $16.5 OCR (estimate) + ≈ $0.45 reasoning | ≈ $1.6 |

## 6. Risks

- **Small sample:** five drawings and three repetitions. L_spatial2 was revised on the same drawings.
- **Low stability for some findings:** mezzanine, A117 and the sign conflict each appear in 1 of 3 published runs. A production run would need several repetitions or a consolidation pass.
- **Recall gaps:** the blank seismic design category, unhyphenated sheet tags, and unresolved references that are hidden from the model.
- **Unverified code basis:** adjudication was done by the evaluator, not a licensed professional. Code text was not retrieved, so every code-basis statement needs verification.
- **Production validator interference** (section 4).
- **OCR cost and time:** about ten times the existing analyzer per drawing. The OCR also depends on a hosted model provider (OpenRouter).

## 7. Deliverables and status

**Implemented and locally tested:**
- **Stage 3 linker:** look-alike sheet and bubble resolution (`stage3-link.mjs`).
- **Evidence selector:** question-targeted retrieval and caption units (`lib/spatialEvidence.mjs`).
- **Stage 4 harness:** the `L_spatial` and `L_spatial2` arms and the persistent ledger (`stage4-reason.ts`).
- **Scorer fix:** run-level detection counts were inflated across run directories (`eval-findings.mjs`). Saved baseline results were re-scored, and the previous file is kept as `eval/findings.baseline-gpt4o.before-runidx-fix.json`.
- **Consolidation:** `stage5-consolidate.ts`.
- **Review page:** `review-ui/`.
- **Tests:** 12 Node tests and 16 Python tests pass, and the page type-checks against `tsconfig.app.json`. The browser smoke test (`review-ui/smoke.cjs`) passes 12/12: filters, Accept / Modify / Reject with local persistence, review details, and in-browser PDF and JSON exports carrying the reviewer decisions, with no page errors.

**Not done:**
- **Deployed:** nothing. The page is a local preview on its own port.
- **Production-verified:** nothing.

**Files**, under `out/qwen-spatial-audit/`:
- `e2e/PermitPilot-Qwen-Luna-analysis.pdf`: production branded architect-review PDF, 10 pages;
- `e2e/PermitPilot-Qwen-Luna-analysis.json`: production JSON export;
- `e2e/qwen-analysis.dataset.json`: dataset plus internal audit, cross-sheet pairs and comparison;
- `e2e/comparison.json`;
- `stage4/runs/*.json` and `stage4/ledger.jsonl`;
- `inspect/findings/*.png`.

**Local preview** (from the repo root):

```
npx vite --config eval/drawing-dataset/qwen-spatial-audit/review-ui/vite.config.ts
# http://127.0.0.1:5191/  (toggle "Show review details" for the internal audit view)
```

## 8. Next steps (no further spend proposed)

1. Pass unresolved references (for example `4/A5.0`) to the model as evidence, and parse unhyphenated tags (`8/A400`). Both are deterministic.
2. Add a deterministic check for printed labels with no value, such as `SEISMIC DESIGN CATEGORY` followed by nothing. The model did not report this reliably.
3. Review the two Analyzer V2 validator rules that withheld or rewrote valid findings, as a separate production change with its own approval.
4. Re-measure on drawings not used for tuning before any wider claim.
