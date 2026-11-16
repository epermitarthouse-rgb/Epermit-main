# Hosted Qwen2.5-VL-72B OCR benchmark (OpenRouter) — 2026-11-16

## Result

Hosted Qwen2.5-VL-72B reads technical drawing text better than the saved Apple Vision 4x3 baseline on all five drawings: 123 of 232 ground-truth technical rows exact vs 69, and 53 missed vs 117. As benchmarked it did not make fewer value errors: 20 rows with a wrong reading vs 17 for Apple Vision, mostly 1→I and 0→O swaps inside numbers.

**Update (same cached replies, no new API calls; section below).** A box-placement fix and a value-validation pass raise Qwen to **141 exact** technical rows and cut unmarked incorrect rows from **18 to 7**. They don't silently rewrite anything: 1 value was corrected from an overlapping tile's reading, and 8 wrong values are now flagged as uncertain instead of presented as fact. An experimental spatial evidence selector, kept under the same ~3,200-character budget, delivers **132 exact technical rows** to the analyzer. That compares with 95 for the v2 block on the original Qwen output, 116 for v2 on the validated output, and 67 for Apple Vision. Of those 132, 128 were already exact in the OCR and 4 come from resolving tile-seam cut readings. (Corrected 2026-11-17: an earlier version said 141 = 128 + 13. Nine of those 13 "seam" merges were short labels absorbed into longer readings away from any tile edge; a tile-edge geometry guard now rejects them. The equality of 141 OCR-exact rows and 141 block rows was a coincidence. 0.91 = 128/141 is the share of OCR-exact rows the block retains.) Recommendation: **ready for a cross-sheet linking trial on these five drawings, not for production**; see the end of this report.

## Update: OCR reliability and evidence selection (2026-11-16, cached replies only)

No OpenRouter or other paid calls were made: every arm below is rebuilt from the saved 72B replies (`run.py rebuild`, a client that raises on any request). Production Code Analyzer V2, Apple Vision OCR and the Supabase analyzer are unchanged; the scorer is the unchanged `stage3-evidence-eval.v1` and the ground truth is the same 232 technical rows.

### Arms and scoring definitions

| Arm | OCR | Evidence block |
|---|---|---|
| Apple Vision 4x3 | saved recovery | unchanged v2 block |
| Qwen 72B original | index as benchmarked (every tile snapped to ink bands) | unchanged v2 block |
| Qwen 72B + box policy | snap only tiles whose model boxes miss the ink bands | — (isolates the box fix) |
| Qwen 72B + value validation | box policy + `qsa/validate.py` | unchanged v2 block |
| Qwen 72B + improved retrieval | same OCR as value validation | experimental spatial selector, same budget |

A rebuild with the original policy (`check`) reproduces the benchmark exactly: 123 exact, 134 boxes on row.

Row categories for technical ground-truth rows, from the evaluator's row states:

| Category | Definition |
|---|---|
| exact | A correct, unmarked reading exists. Includes the "exact but contradicted" state, which is also counted separately as a risk. |
| incorrect | At least one unmarked wrong reading. |
| uncertain | The correct value appears only as a reading marked uncertain or in conflict, or every wrong reading is marked. **Never counted as exact.** |
| partial, merged, missed | As in the earlier report. |

The earlier "20 wrong" is the evaluator's `wrong` state. Under these definitions it splits into 18 incorrect rows plus 2 rows whose only wrong readings were already marked.

### Fix 1: box placement (the main cause of misplaced boxes, A-1.01 included)

The benchmark snapped every Qwen box onto the nearest printed ink band. That snapping was designed for the 3B model's row-pitch drift. The 72B boxes are already on the ink bands in 89% of tiles (at least 75% of each tile's boxes overlap a band), and on dense rows snapping moved correct boxes onto the neighbouring row. On A-1.01, sheet tags were moved onto bubble numbers about one row pitch (10–12 pt) away. The new `--snap auto` policy only snaps a tile when fewer than 75% of its boxes sit on bands.

- **72B:** exact 123 → 139 and boxes on row 134 → 144. A-1.01 misplaced rows fell from 18 to 11.
- **What remains on A-1.01:** mostly coincidental text matches, not box errors. A bubble `1` or `9 1/2"` is matched to another instance of the same text 200–900 pt away, because the true instance was missed or misread (`q 1/2"`).
- **3B, same 5 S-201 tiles:** unchanged at 10/13 exact and 11/13 boxes on row. Three of its five tiles are still snapped.
- **Trade-off:** six rows that snapping happened to fix are lost. Those are A-3.06 `3'-6"`, A-4.00 `48" MAX.`, S-201 `R= 1.5`, and A-6.00 door numbers `A1`, `3`, `4` and `6A`, which are now merged into conflicting row readings. A-6.00 exact stays at 37 and its uncertain count rises from 7 to 10.

### Fix 2: value validation (`qsa/validate.py`)

For each technical token in a numeric context (sheet reference, dimension, room or door number, number before a unit, list number, seismic coefficient label), I/l/| and O/o/q are checked as look-alikes of 1, 0 and 9. Words such as `IO`, `I-BEAM`, `CLASS I` and `O.C.` are left alone. Each look-alike token is then resolved in this order:

1. If the PDF text layer under the line has the digit form, it is **corrected**.
2. If the text layer has the original form, it is **confirmed**.
3. If an overlapping tile's reading or a model alternative has the digit form, it is **corrected**.
4. Otherwise it is **flagged uncertain** and the text is left as read.

Conflicts that differ only by look-alike glyphs are merged. The original text is kept as `ocrText`, every decision is recorded in `valueChecks`, and boxes, confidence and provenance are untouched.

| Drawing | Corrected (overlap tile) | Conflicts resolved | Lines flagged | Text-layer corrections |
|---|---|---|---|---|
| A-3.06 | 0 | 0 | 6 | 0 |
| A-4.00 | 0 | 0 | 2 | 0 |
| A-1.01 | 1 | 0 | 9 | 0 |
| A-6.00 | 0 | 1 | 2 | 0 |
| S-201 | 2 | 2 | 4 | 0 |

The text layer made no corrections. It covers only 31 of the 232 ground-truth technical rows (S-201: 0 of 34), and none of the look-alike errors fall on those rows.

### OCR before and after, per drawing (technical rows)

| Drawing | Arm | Exact | Incorrect | Uncertain (correct but flagged) | Partial | Missed | Complete ann. | Box on row |
|---|---|---|---|---|---|---|---|---|
| A-3.06 (72) | Apple Vision 4x3 | 33 | 6 | 0 | 3 | 30 | 20/49 | 33/45 |
| | Qwen original | 43 | 2 | 6 (5) | 14 | 7 | 27/49 | 47/54 |
| | + box policy | 44 | 2 | 7 (6) | 12 | 7 | 28/49 | 48/53 |
| | + validation | **44** | **1** | 8 (6) | 12 | 7 | 28/49 | 48/53 |
| A-4.00 (33) | Apple Vision 4x3 | 13 | 0 | 0 | 1 | 19 | 11/30 | 13/21 |
| | Qwen original | 15 | 2 | 0 | 0 | 16 | 15/30 | 15/29 |
| | + box policy | 22 | 1 | 0 | 2 | 8 | 20/30 | 21/29 |
| | + validation | **22** | **1** | 0 | 2 | 8 | 20/30 | 21/29 |
| A-1.01 (33) | Apple Vision 4x3 | 3 | 1 | 0 | 0 | 29 | 2/23 | 3/9 |
| | Qwen original | 8 | 9 | 0 | 1 | 15 | 4/23 | 9/27 |
| | + box policy | 16 | 9 | 0 | 1 | 7 | 9/23 | 15/27 |
| | + validation | **17** | **4** | 4 (0) | 1 | 7 | 9/23 | 16/27 |
| A-6.00 (60) | Apple Vision 4x3 | 8 (+17 merged) | 1 | 0 | 2 | 32 | 5/35 | 15/31 |
| | Qwen original | 37 (3 contradicted) | 2 | 7 (7) | 0 | 14 | 16/35 | 41/53 |
| | + box policy | 37 | 1 | 10 (10) | 1 | 11 | 22/35 | 37/47 |
| | + validation | **37** | **1** | 10 (10) | 1 | 11 | 22/35 | 37/47 |
| S-201 (34) | Apple Vision 4x3 | 12 | 9 | 0 | 6 | 7 | 12/33 | 12/15 |
| | Qwen original | 20 (3 contradicted) | 3 | 6 (5) | 4 | 1 | 24/33 | 22/25 |
| | + box policy | 20 (2) | 3 | 6 (5) | 4 | 1 | 24/33 | 23/26 |
| | + validation | **21 (2)** | **0** | 8 (4) | 4 | 1 | 24/33 | 23/26 |
| **Total (232)** | Apple Vision 4x3 | 69 | 17 | 0 | 12 | 117 | 50/170 | 76/121 |
| | Qwen original | 123 | 18 | 19 | 19 | 53 | 86/170 | 134/188 |
| | + box policy | 139 | 16 | 23 | 20 | 34 | 103/170 | 144/182 |
| | + validation | **141** | **7** | **30** | 20 | 34 | **103/170** | **145/182** |

**Target check.** Incorrect rows fell from 18 to 7 (the evaluator's `wrong` state: 20 → 17, since 10 of the 30 uncertain rows have only marked wrong readings). Exact rows rose from 123 to 141, with no exact rows lost to validation. Of the 11 fewer incorrect rows:
- validation moved 9: 1 corrected to exact and 8 flagged as uncertain;
- the box policy accounts for a net 2. It fixed several rows (A-3.06 `A-3.06`, A-4.00 `12"` and `2" HOLD`, A-1.01 `A-3.02`, and the A-6.00 swap) but introduced others (A-3.06 `T.O. ROOF DECK MEMBRANE`, A-4.00 `1'-0"`, A-1.01 `1`/`11`, A-6.00 `2'-6"`).

Contradicted exact rows fell from 7 to 2.

**Recovered values (examples).**
- `A-30I` → `A-301`, from the overlapping tile's reading. Original kept as `ocrText`.
- `I. WELD TOGETHER…` → `1. WELD…`, from an overlapping tile, with the conflict resolved.
- `DESIGN BASE SHEAR 57 KIPS`: the conflict differed only by look-alike glyphs, so the row is now exact.
- A-6.00 `(NOTE 11)` ↔ `2"JAMB & HEAD` swap, and A-4.00 `12"` (was `MIN.`): fixed by the box policy.

**Flagged, not corrected (counted as uncertain, never exact):**
- `A-3.0I`, `A-4.0I` ×2, `IOIB` and `NEW I HR.` (A-1.01)
- `ELEV. + O'-O"` (A-3.06)
- `I. INTERNATIONAL BUILDING CODE`, `SI 0.43` and `Sdl 0.069` (S-201)

**Interpreted badly by validation.** There were no miscorrections. Three non-numeric lines were flagged as false alarms: two `OOR` cuts of "DOOR" and `MIDNIGHT OIL`. The 4,096-token `IIII` repetition on A-4.00 is now flagged as uncertain, not dropped.

**Remaining unmarked value risks (7 incorrect rows):**
- **A-3.06:** `T.O. ROOF DECK MEMBRANE`, where a seam-recombined note sits on the row.
- **A-4.00:** `1'-0"`, with `MIN.` boxed on its row.
- **A-1.01:**
  - `9` read as a bare `q`;
  - `1` read as `I` and `11` as `II` (standalone `I`/`II` are deliberately not flagged, because they can be letters or roman numerals);
  - `NEW 1 HR. FIRE`, which is flagged but also overlapped by an unmarked `RESISTIVE`.
- **A-6.00:** `2'-6"` read as `2'-0"`. This is a real misread, not a look-alike, and no second source exists for it.

There are also 2 exact-but-contradicted rows on S-201.

Unsupported readings (no ground-truth row, not in the text layer or the Apple Vision 12x9 read) fell from 91 to 74:

| A-3.06 | A-4.00 | A-1.01 | A-6.00 | S-201 |
|---|---|---|---|---|
| 56 | 3 | 11 | 4 | 0 |

Most of them are seal, title-block and scale text.

### Evidence selection: why v2 loses rows on Qwen, and the experimental selector

**Root cause.** The v2 block rebuilds associations from OCR words, which suits Apple Vision. On Qwen lines it spends the budget on:
- tile-seam fragments (`XTERIOR`, `NIVERSAL`, `AL NOTE 6`);
- second copies from overlapping tiles;
- `{full | cut}` pseudo-conflicts;
- detail titles repeated as content.

It then truncates by priority: A-6.00 shows 37 of 508 annotations, with 310 technical annotations omitted.

**Selector** (`qwen-spatial-audit/lib/spatialEvidence.mjs`, experimental, no model calls). Raising the budget was not used. Instead, the selector:
1. drops lines whose text is contained in an overlapping longer line, keeping a `suppressedLines` audit list;
2. shows a "conflict" whose other reading is only a cut piece of it as the full reading, keeping the cut in `cutReadings`;
3. excludes title-block text and detail titles, since detail titles go into the headers;
4. uses Qwen's own annotation groups as units and places each one in its detail, using text-layer detail titles and scales;
5. scores units with the v2 technical classifier (dimensions, values, elevations, references, code citations, requirement words, schedule cells);
6. selects by technical value per character, with at least one unit per detail;
7. renders under detail headers with `?text` for flagged readings, `{A | B}` for real conflicts and `×n` for repeats.

Every unit has an id that resolves, in a sidecar evidence pack, to its lines, page boxes, tiles, `ocrText`, `valueChecks` and region. `retrieveEvidence(pack, query)` returns query-matched units, including omitted ones, together with their nearest technical neighbours in the same detail.

| Drawing | AV 4x3 v2 | Qwen original v2 | Qwen validated v2 | **Qwen validated spatial** |
|---|---|---|---|---|
| A-3.06 | 32 (p 0.30) | 47 (p 0.36) | 49 (p 0.41) | 45 (p 0.38) |
| A-4.00 | 12 (p 0.80) | 10 (p 0.40) | 17 (p 0.57) | **22 (p 0.54)** |
| A-1.01 | 3 (p 0.27) | 5 (p 0.29) | 13 (p 0.84) | 14 (p 0.45) |
| A-6.00 | 15 (p 0.44) | 16 (p 0.50) | 19 (p 0.67) | **35 (p 0.70)** |
| S-201 | 5 (p 0.25) | 17 (p 0.35) | 18 (p 0.39) | 16 (p 0.62) |
| **Exact technical rows in block** | 67 | 95 | 116 | **132** |
| of which already exact in OCR (recall) | 57/69 (0.83) | 89/123 (0.72) | 102/141 (0.72) | **128/141 (0.91)** |
| Recall of all 232 | 0.29 | 0.41 | 0.50 | **0.57** |
| Precision (in-scope readings matching a technical row) | 0.36 | 0.37 | 0.48 | **0.51** |
| Incorrect / uncertain rows in block | 2 / 13 | 8 / 10 | 5 / 8 | 6 / 22 |
| Largest block (characters) | 3,196 | 3,198 | 3,195 | 3,118 |

"p" = precision for that drawing. The 4 rows that are exact in the spatial block but not in the OCR come from seam-cut resolution on A-3.06 (for example `GUARD RAIL SHALL BE…` vs `GUAR`, where every provenance box of the shorter reading touches a tile edge). A shorter reading is only treated as a cut when all its provenance boxes lie within 25 px of a tile edge; door numbers, bubble numbers and schedule cells inside a tile stay separate (`{2 ALUM. | 2}`). They are listed in `eval/compare-arms.openrouter-72b.json` under `spatialExactNotExactInOcr`.

**Limitations (measured):**
- **Per-drawing results vary.** The selector loses to v2 on A-3.06 (46 vs 49; drops `-4x4 WOOD BLOCKING` and bubbles `2` and `A-3.00`) and on S-201 (16 vs 18). On S-201 the wind-loading note block falls outside the budget. On A-1.01 precision falls (0.45 vs 0.84), because plan bubbles and keyed notes outscore v2's sparse selection.
- **The containment rule needed a geometry guard.** Without it, the rule absorbed separate short labels into longer readings, such as door number `2` into `2 ALUM.` or bubble `3` into `A-3.06`. The tile-edge guard (above) now prevents this.
- **Region boxes are approximate.** They are inferred upward from the detail title, with a fallback for notes columns titled at the top.
- **Retrieval is lightly tested.** On 9 queries with 14 expected values, the v2 block, the spatial block and retrieval each contain 9. Together the spatial block and retrieval contain 10. Retrieval recovers `BASIC WIND SPEED … 115 MPH` (omitted from the spatial block) and finds `(NOTE 11)` (missing from v2). The flagged `S1`/`Sd1` and `NEW I HR.` are correctly not counted as exact. Retrieval is not yet a demonstrated gain.

### Readiness for the cross-sheet reasoning phase

**Ready:**
- the box policy and validation, which are deterministic, cost-free and reproduce from cache;
- an evidence pack with source references for each unit (sheet, page box, tiles, original OCR text, value checks, detail and scale);
- uncertainty and conflict markers that the block keeps visible;
- 132 of 232 exact technical rows reaching the analyzer under the same budget, with 6 incorrect rows in the block.

**Not ready:**
- 7 unmarked incorrect OCR rows and 30 uncertain rows that still need a second source;
- sheet-reference look-alikes (`A-3.0I`, `A-4.0I`) that are flagged but not resolved;
- precision of about 0.5;
- region boxes inferred from titles;
- one run of a hosted model, with no variance measured.

GPT-5.6 reasoning and production integration were not started.

## Original benchmark (2026-11-16 run; figures below are as benchmarked, before the update)

## Run

| | |
|---|---|
| Model | `qwen/qwen2.5-vl-72b-instruct` (verified in OpenRouter /models; text+image→text) |
| Provider | Parasail, fp8, pinned with `allow_fallbacks: false` (only provider listed) |
| Price | $0.80 / $1.00 per M input / output tokens (OpenRouter list = billed) |
| Prompt | `qsa.tile-prompt.v1`, the same prompt as the local 3B run; temperature 0; max 4096 output tokens |
| Tiles | 300 DPI, 980 px, 140 px overlap; every non-blank tile of the five sheets + one overview each |
| Concurrency | 8 workers; per-call worst-case reservation against a persistent ledger, cap $3.00 |
| Preflight | S-201 `r01c07`: $0.0031, 1,541 in / 1,870 out tokens, 50 s, scored below; then continued automatically |

### Tiles

| Drawing | Non-blank tiles | Completed | Failed (API) | Skipped (budget) | Extraction failed | Truncated at 4096 |
|---|---|---|---|---|---|---|
| A-3.06 | 112 | 112 | 0 | 0 | 0 | 0 |
| A-4.00 | 116 | 116 | 0 | 0 | 1 (`r01c05`: "IIII…" repetition on a vertical line) | 1 (same tile) |
| A-1.01 | 112 | 112 | 0 | 0 | 0 | 0 |
| A-6.00 | 108 | 108 | 0 | 0 | 0 | 1 (`r06c00`, title block; 58 items kept) |
| S-201 | 111 | 111 | 0 | 0 | 1 (`r03c02`: malformed JSON, 1 item lost) | 0 |
| Overviews | 5 | 5 | 0 | 0 | 0 | 0 |
| **Total** | **564** | **564** | **0** | **0** | **2** | **2** |

### Spend

| | USD |
|---|---|
| Provider-reported key usage after the run | **0.9968** |
| Ledger (max of list price and reported cost per call) | 1.0055 |
| Benchmark cap | 3.00 — remaining **2.00** |
| Key limit | 3.50 — remaining **2.50** (OpenRouter `limit_remaining`) |

Per drawing: A-3.06 $0.176, A-4.00 $0.223, A-1.01 $0.189, A-6.00 $0.212, S-201 $0.206 (mean $0.201, 113 calls). Mean call latency 9.5–19.9 s by drawing (p95 29–56 s); wall time 17.5 min for 563 calls at 8 workers.

**82-drawing estimate** (same tiling, prompt and provider): about 9,300 calls, **≈ $16.5** (range ≈ $14–18 from the per-drawing spread), ≈ 4.8 h at 8 workers. Sheets with denser notes cost more because output tokens dominate (A-4.00 and A-6.00 produced twice the output of A-3.06).

## OCR accuracy (scored with the unchanged `stage3-evidence-eval.v1` scorer)

Ground truth: A-3.06 full sheet; the other four are window-scoped (only rows inside the hand-labelled windows are scored). Apple Vision 4x3 is the saved recovery (not re-run). Qwen scores use row assembly (cells the model grouped on one printed row joined left to right); text is never otherwise changed.

### Technical rows, all OCR lines (OCR quality)

| Drawing | Tech rows | AV 4x3 exact | Qwen-72B exact | AV wrong | Qwen wrong | AV missed | Qwen missed | AV ann. complete | Qwen ann. complete |
|---|---|---|---|---|---|---|---|---|---|
| A-3.06 (full) | 72 | 33 | **43** | 6 | 3 | 30 | **7** | 20/49 | **27/49** |
| A-4.00 | 33 | 13 | **15** | 0 | 2 | 19 | **16** | 11/30 | **15/30** |
| A-1.01 | 33 | 3 | **8** | 1 | 9 | 29 | **15** | 2/23 | **4/23** |
| A-6.00 | 60 | 8 | **37** | 1 | 2 | 32 | **14** | 5/35 | **16/35** |
| S-201 | 34 | 12 | **20** | 9 | 4 | 7 | **1** | 12/33 | **24/33** |
| **Total** | **232** | **69 (30%)** | **123 (53%)** | 17 | 20 | 117 | **53** | 50/170 | **86/170** |

"Wrong" = the row's reading differs from the print and is not marked uncertain. Qwen also flagged 17 rows as cross-tile conflicts with the correct reading among the alternatives (not counted as exact).

### Spatial: technical rows whose text was read, and whose box lands on the printed row

| Drawing | AV text found | AV box on row | Qwen text found | Qwen box on row |
|---|---|---|---|---|
| A-3.06 | 45 | 33 | 54 | 47 |
| A-4.00 | 21 | 13 | 29 | 15 |
| A-1.01 | 9 | 3 | 27 | **9** |
| A-6.00 | 31 | 15 | 53 | 41 |
| S-201 | 15 | 12 | 25 | 22 |
| **Total** | 121 | 76 | **188** | **134** |

On A-1.01 Qwen reads 27 of 33 technical rows somewhere but places only 9 on the right row: the dimension strings (`3'-5 1/2"`, `9 1/2"`, `2'-4"`) are read correctly with boxes off their rows, so they count as missed rows plus unmatched readings.

### What the analyzer receives (unchanged v2 block, ~3,200-character budget)

| | A-3.06 | A-4.00 | A-1.01 | A-6.00 | S-201 | Total |
|---|---|---|---|---|---|---|
| AV 4x3 exact tech rows | 32 | 12 | 3 | 15 | 5 | 67 |
| Qwen-72B exact tech rows | 47 | 10 | 5 | 16 | 17 | 95 |

The v2 block is budget-limited, so the OCR gain shrinks here (A-6.00: 37 exact lines → 16 in the block; A-4.00 drops below Apple Vision). Better OCR alone does not reach the analyzer without a selection change.

### Same five tiles: Qwen-72B vs Qwen-3B CPU vs Apple Vision 4x3 (S-201 `r00c06–r00c09`, `r01c07`)

Only five tiles of 3B output exist (the 3B run was stopped), so this is the only like-for-like three-way comparison.

| | Exact | Wrong | Partial | Missed | Box on row | Time per tile | Cost per tile |
|---|---|---|---|---|---|---|---|
| Apple Vision 4x3 | 5/13 | 1 | 3 | 4 | 5 | (saved) | 0 |
| Qwen-3B CPU (Q4, local) | 10/13 | 1 (+1 also misread) | 0 | 1 | 11 | 168–420 s (mean 286 s) | 0 |
| Qwen-72B (OpenRouter) | 9/13 (+1 conflict-marked) | 1 | 2 | 0 | 9 | 10–50 s | $0.0018 |

On this table-like region the 3B is as accurate as the 72B; 13 rows is too few to separate them. The 3B is impractical on this Mac (≈ 15.7 h for the five-drawing ground-truth scope).

## Errors

**Wrong technical values (Qwen-72B, 20 rows).**
- 1/I and 0/O confusion inside numbers — 9 rows: `I-1/4" PIPE RAILING` for `1-1/4"`, `ELEV. + O'-O"`, `A-3.0I`, `A-4.0I`, `IOIB`, `NEW I HR. FIRE`, `I. INTERNATIONAL BUILDING CODE`, `SI 0.43`, `Sdl 0.069`. Also `q` for `9`.
- Real misread of a value — 1 row: `600S162-43 MIL` read as `OSI62-43 MIL` / `6005102-43` / `5162-45 MILE` in three tiles.
- Box on the wrong row — the remaining rows: correct text attributed to a neighbouring row (A-6.00 `(NOTE 11)` ↔ `2"JAMB & HEAD`; A-4.00 `MIN.` over `12"`; A-1.01 sheet tags `A-4.01` / `A-2.00` over bubble numbers).

**Missed (53 rows).** Mostly short isolated tokens: single digits in bubbles, `V.I.F.`, `(NOTE 5)`, small dimensions (`4"`, `2'-0"`, `40"`, `34"`), and rotated text: 9 of 34 vertical technical rows exact (Apple Vision 8 of 34).

**Hallucinated or unsupported text.** In-scope readings matching no ground-truth row: A-3.06 145, A-1.01 31, A-6.00 29, A-4.00 21, S-201 2. After removing text that also exists in the PDF text layer or the saved Apple Vision 12x9 read, 91 remain. These are mostly real printed text outside the ground-truth rows (seal and title block: `WARREN NAGEY`, `LICENSE NO. ARC40001205`, `PERMIT COMMENTS 10/29/25`; grid letters; misplaced dimensions). Genuine model fabrications:
- A-4.00 `r01c05`: a vertical line read as a 4,096-token run of `I` (the tile produced no text).
- A-3.06: recombined fragments of the guard-rail note at tile seams (`3'-6"MIN HEIGHT T.O. ROOF DECK M`, `HEIGHT FROM DECK MEMBRANE`) next to the correct reading.

Apple Vision 4x3 produces almost no unmatched readings because it reads far less text.

## Coverage and what is not tested

- All non-blank tiles of the five drawings were read; nothing was skipped for budget. Accuracy is measured only on ground-truth rows: the full A-3.06 sheet and the labelled windows of the other four (232 technical rows in total). Text outside the windows is read but unscored.
- The 3B comparison covers 5 tiles of S-201 only.
- Overview (layout) replies were collected but not scored; there is no layout ground truth.
- Cross-sheet linking and GPT-5.6 Luna reasoning were not run (not invoked; no paid OpenAI calls).
- One run, temperature 0; run-to-run variance of the hosted model was not measured.

## Recommendation (after the update)

**Qwen 72B with the box policy and value validation is ahead of Apple Vision 4x3 on every measured axis except unsupported readings.**

| Measure | Qwen 72B (updated) | Apple Vision 4x3 |
|---|---|---|
| Exact technical rows | 141 | 69 |
| Unmarked incorrect rows | 7 | 17 |
| Missed rows | 34 | 117 |
| Complete technical annotations | 103/170 | 50/170 |
| Exact rows reaching the analyzer (spatial selector, same budget) | 132 | 67 |
| Unsupported readings | 74 | 10 |

It is suitable for an experimental cross-sheet linking trial on these five drawings. It is not suitable for production.

Recommended next steps, in order:
1. **Resolve sheet-reference look-alikes against the 82-sheet index** (no cost). For example, `A-3.0I` → `A-3.01` only if that sheet exists. This is also the first cross-sheet linking step.
2. **Move seam-cut resolution into the stage 2 merge**, guarded by box geometry, so the OCR lines and the block agree. Keep separate short labels (door numbers, bubble numbers) apart from the longer readings that contain them.
3. **Selector refinements, measured on the same harness:**
   - give long notes blocks (S-201 wind loading) a per-detail budget share;
   - lower the weight of plan bubbles on A-1.01;
   - add retrieval queries generated from the known-issue list.
4. **Optional, paid: re-read the 37 flagged or incorrect tokens** as higher-DPI crops. That is about 40 crops at roughly $0.002 each, **≈ $0.10**. It needs approval and is not run.
5. **Then stage 3 cross-sheet linking on the evidence pack.** GPT-5.6 Luna reasoning only after API access and cost are confirmed.

### Original recommendation (as benchmarked)

**OCR: better than Apple Vision 4x3 on recall and placement, equivalent-to-worse on value fidelity. Not yet a replacement.**

- Evidence for: +54 exact technical rows (69 → 123 of 232), missed rows 117 → 53, completed technical annotations 50 → 86 of 170, boxes on the printed row 76 → 134, at about $0.20 per drawing and about 3.5 minutes per drawing at 8 workers.
- Evidence against: 20 unmarked wrong values vs 17, most from a systematic 1/I and 0/O confusion that would put wrong numbers in front of a reviewer; one repetition hallucination; weak rotated text; and box drift on plan dimensions (A-1.01).
- Before adoption, two things to measure on these same cached replies at no extra cost: a digit-context check that flags (not silently rewrites) `I`/`O`/`l` inside numeric tokens as uncertain; and cross-checking against the PDF text layer where one exists. After that, re-run the five-drawing score. The v2 evidence selection also limits the gain the analyzer actually sees (95 vs 67 exact rows in the block).

## Reproduce (from `eval/drawing-dataset`)

```bash
python qwen-spatial-audit/openrouter_check.py                      # key limits, model, providers (key never printed)
python qwen-spatial-audit/run.py bench --backend openrouter-72b --sheets S-201.00 --tiles r01c07 --approve-paid --max-usd 3.00 --workers 1
python qwen-spatial-audit/run.py bench --backend openrouter-72b --scope full --approve-paid --max-usd 3.00 --workers 8   # cached tiles are not re-requested
node qwen-spatial-audit/eval-ocr.mjs --backend openrouter-72b --write-blocks
node qwen-spatial-audit/ocr-detail.mjs --backend openrouter-72b
node qwen-spatial-audit/ocr-detail.mjs --backend openrouter-72b --subset --compare local-3b

# Update (cache only; the rebuild client raises on any request)
python qwen-spatial-audit/run.py rebuild --backend openrouter-72b --snap always --variant check          # reproduces the benchmark
python qwen-spatial-audit/run.py rebuild --backend openrouter-72b --snap auto --variant boxes
python qwen-spatial-audit/run.py rebuild --backend openrouter-72b --snap auto --validate --variant validated
python qwen-spatial-audit/run.py rebuild --backend local-3b --sheets S-201.00 --tiles r00c06,r00c07,r00c08,r00c09,r01c07 --snap auto --validate --variant boxes
node qwen-spatial-audit/compare-arms.mjs --write
python -m unittest discover -s qwen-spatial-audit/tests && node --test qwen-spatial-audit/tests/
```

Update artifacts:
- `sheets/<sheet>/stage2/sheet-index.openrouter-72b.{check,boxes,validated}.json`
- `eval/compare-arms.openrouter-72b.json` (all metrics, row lists, transitions, retrieval checks)
- `evidence/<sheet>.spatial.block.txt` and `evidence/<sheet>.spatial.pack.json`
- `blocks/<sheet>.qwen-openrouter-72b-validated.v2.block.txt`

Artifacts: `budget/openrouter-72b.ledger.jsonl` (every call, cost, generation id), `budget/openrouter-72b.progress.json`, `sheets/<sheet>/stage2/raw/openrouter-72b/` (raw replies), `sheets/<sheet>/stage2/sheet-index.openrouter-72b.json`, `eval/ocr-compare.openrouter-72b.json`, `eval/ocr-detail.openrouter-72b*.json`, `blocks/<sheet>.qwen-openrouter-72b.v2.block.txt`.
