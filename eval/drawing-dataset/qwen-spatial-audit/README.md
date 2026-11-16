# Qwen2.5-VL-72B + GPT-5.6 Luna code-analyzer experiment

Local experiment on five permit drawings. It does not write to Supabase, change Code Analyzer V2, change the Supabase analyzer, or deploy. Stage 4 imports the production prompt, sheet-index merge, and finding validator read-only.

Branch: `experiment/qwen-72b-luna-code-analyzer`. Do not merge it to `main`.

**Recommendation from the completed run: requires further improvement.** The eight client findings can be shown in a demo that someone walks through. The pipeline is not approved to run unattended or in production.

## Architecture

```
PDFs
  │  stage 1 (offline, PyMuPDF): text layer + 300 DPI tiles
  ▼
Qwen2.5-VL-72B OCR (OpenRouter)          raw replies cached under out/.../sheets/*/stage2/raw
  │  validation, tile-seam guard, spatial summary, question retrieval
  ▼
stage 3 linker                           look-alike sheet and bubble numbers, paired crops
  │
  ▼
GPT-5.6 Luna (stage 4)                   production prompt + validator, append-only cost ledger
  │  arms: L_av (Apple Vision text), L_spatial, L_spatial2 (Qwen spatial evidence)
  ▼
stage 5                                  client dataset, branded PDF, JSON
  │
  ▼
review-ui                                local page on port 5191, no production route
```

Comparison baseline: saved Supabase Analyzer V2 runs (Apple Vision 4×3 evidence, GPT-4o). Those runs were not repeated.

Drawings: A-3.06, A-4.00, A-1.01, A-6.00, S-201. Project: 75 New York Ave & 1st St, Washington DC, Permit Rev 5. Code context used in the prompt: 2017 DC Construction Codes (2015 IBC base). Code text was not retrieved, so every code citation in the client view is marked for verification.

## Layout

| Path | What it is |
|---|---|
| `eval/drawing-dataset/qwen-spatial-audit/` | Scripts, tests, fixtures, this guide, the five source PDFs |
| `eval/drawing-dataset/qwen-spatial-audit/drawings/` | The five PDFs that were analyzed, plus `full-set-filenames.txt` (82 names, no other PDF bytes) |
| `eval/drawing-dataset/out/qwen-spatial-audit/` | Cached OCR, evidence, crops, reasoning runs, ledger, reports, client PDF/JSON |
| `eval/drawing-dataset/out/qwen-spatial-audit/REPORT-e2e-qwen-luna.md` | Evaluation report |
| `eval/drawing-dataset/out/qwen-spatial-audit/e2e/` | Client dataset, comparison, PDF, JSON |

## Setup

From the repo root, with dependencies already installed for the app (`npm install`). Python packages used by this experiment are PyMuPDF and NumPy:

```bash
cd eval/drawing-dataset
python3 -m venv .venv
.venv/bin/pip install pymupdf numpy
```

`.venv` is gitignored.

Keys stay outside the repo:

- OCR: `OPENROUTER_API_KEY` in the environment. Stage 2 refuses a paid backend without `--approve-paid` and `--max-usd`.
- Reasoning: `OPENAI_API_KEY` in `code-analyzer-worker/.env`. That file is gitignored and must not be printed or committed. Stage 4 makes no calls unless `--approve --cap=<usd>` is passed.

Drawing directory for a **new** stage 4 run or an `index82` rebuild:

```bash
export QSA_PDF_DIR="/Users/javerianaveed/Desktop/008-0003 New York Ave Wash DC_PERMIT REV5 SET_2026-10-15_Individual"
```

That folder is 82 PDFs, about 200 MB, and is not in git. Stage 4 builds the project sheet index from the PDF filenames in `QSA_PDF_DIR`. Pointing it at `drawings/` (five PDFs) would change the index. The five copies in `drawings/` are enough to re-render those sheets and to open the pages that were attached to the model. The saved stage 3 index and the saved prompts already reflect the 82-sheet set.

## Commands

Run Python and Node eval commands from `eval/drawing-dataset`. Run `tsx` and Vite from the repo root. These commands do not spend money unless the paid flags are added.

```bash
# Offline checks
.venv/bin/python -m unittest discover -s qwen-spatial-audit/tests
node --test qwen-spatial-audit/tests/

# Re-render tiles from the five PDFs (no model calls). Use the full PDF dir if it is available.
.venv/bin/python qwen-spatial-audit/run.py stage1

# OCR is already cached (569 raw replies). Do not re-run stage 2 unless a new paid budget is approved.
# .venv/bin/python qwen-spatial-audit/run.py stage2 --backend openrouter-72b --scope full --approve-paid --max-usd <cap>

node qwen-spatial-audit/stage3-link.mjs --backend openrouter-72b
node qwen-spatial-audit/eval-findings.mjs --runs out/qwen-spatial-audit/stage4/runs --label qwen-luna

# Stage 4 dry plan. Completed run files are skipped, so this does not repeat the 45 calls.
cd ../.. && npx tsx eval/drawing-dataset/qwen-spatial-audit/stage4-reason.ts \
  --arms=L_av,L_spatial,L_spatial2 --backend=openrouter-72b --reps=3

# Rebuild the client dataset, PDF, and JSON from the saved runs (no model calls).
npx tsx eval/drawing-dataset/qwen-spatial-audit/stage5-consolidate.ts

# Local review page. Not a production route.
npx vite --config eval/drawing-dataset/qwen-spatial-audit/review-ui/vite.config.ts
# http://127.0.0.1:5191/   “Show review details” opens the audit view
```

A paid stage 4 call also needs `--approve --cap=<usd>`. The ledger at `out/qwen-spatial-audit/stage4/ledger.jsonl` reserves each call at its worst case before sending it. Failed calls are not retried unless `--retry-failed` is passed. Two consecutive failures stop the run. The cap already includes the $0.2216 spent on this run.

## Completed results

Spend on this run: **$0.2216** of a $2.00 ledger cap (45 Luna calls plus one probe). No new OCR. The reused Qwen OCR was 564 calls, **$1.0055**, about 17.5 minutes.

OCR delivered to the analyzer: **132 / 232** exact technical rows (128 already exact, plus 4 tile-seam resolutions). Apple Vision’s comparable block delivered 67. Seven unflagged incorrect values remain in the OCR; one is a genuine misread (`2'-6"` read as `2'-0"` on A-6.00).

Client findings (evaluator-checked, not a licensed determination):

| Drawing | Findings |
|---|---|
| S-201 | Soil 1,500 vs 2,500 PSF; scale `3/4"1'-0"`; title block `OF 00`; ACI 318-06 vs IBC 2015; cold-formed inspection mapped to 1705.3.4 (preliminary) |
| A-1.01 | Title block “Mezzanine” vs plan “2nd Floor”; general note cites A117.1-2003 |
| A-4.00 | Sign height measured to the centerline in the note and to Braille / tactile characters in the detail |
| A-3.06, A-6.00 | No findings |

Published-finding tally after hand adjudication:

| Arm | Runs | Published | Correct | Uncertain | Unsupported or harness | Errors |
|---|---|---|---|---|---|---|
| Baseline GPT-4o | 30 | 82 | 4 | 5 | 59 | 13 |
| L_av (Luna + Apple Vision) | 15 | 23 | 11 | 3 | 9 | 0 |
| L_spatial | 15 | 4 | 4 | 0 | 0 | 0 |
| L_spatial2 | 15 | 20 | 11 | 9 | 0 | 0 |

L_spatial2 was revised after reading L_spatial’s output on these same drawings, so its recall is optimistic. Agreement between models was not treated as proof.

Missed by the Qwen arms: blank seismic design category on S-201 (the baseline published it in 3 of 9 runs), callout `8/A400` pointing at a detail marked Not Used, printed reference `4/A5.0` to a sheet that does not exist, and the “ADA COMPLAINT” typo. The linker does not parse an unhyphenated sheet tag, and unresolved references are not passed to the model.

The production validator withheld valid drafts (soil, ACI, signage) and rewrote the signage finding. The validator was not changed. The client view uses the model draft and records the validator outcome in the audit record.

## Limitations

- Five drawings, three repetitions. Not a production accuracy claim.
- Some findings appear in only 1 of 3 runs (mezzanine, A117 edition, sign heights).
- Code basis is unverified. Adjudication was not done by a licensed professional.
- OCR is about $0.20 per drawing, on the order of $16.50 for 82 sheets, versus about $0.02 for the current analyzer.
- Hosted OCR depends on OpenRouter. Local Qwen2.5-VL-3B weights used in earlier probes are not in this branch.

## How to resume later

1. Check out `experiment/qwen-72b-luna-code-analyzer`. Do not merge it.
2. Restore keys only in the environment and in `code-analyzer-worker/.env`.
3. Keep `QSA_PDF_DIR` on the full 82-PDF folder before any new stage 4 run or `index82` rebuild.
4. Read `REPORT-e2e-qwen-luna.md` before changing prompts. L_spatial2 was tuned on this set.
5. New paid calls need an explicit cap. The ledger will not forget the $0.2216 already spent.
6. Next code changes that do not need a model call: pass unresolved references such as `4/A5.0` into the prompt, parse unhyphenated tags such as `8/A400`, and flag a printed label with no value. Reviewing the two validator rules is a separate production change and needs its own approval.

## Status of this archive

| | |
|---|---|
| Implemented | Scripts, tests, cached results, client PDF/JSON, local review page |
| Locally tested | 12 Node tests, 16 Python tests, review-ui typecheck, browser smoke 12/12 |
| Deployed | No |
| Production-verified | No |
