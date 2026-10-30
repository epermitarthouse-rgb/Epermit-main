# ARC Professional Review — Handover

**Status:** Evaluation-only learning loop complete. Ready for controlled ARC review.  
**Package root (source of truth):** `eval/drawing-dataset/fixtures/professional-benchmark/v1/`  
**Generated handoff bundle (gitignored, regenerate anytime):** `eval/drawing-dataset/out/arc-review-package-v1/`

```bash
node eval/drawing-dataset/cli/professional-benchmark-worksheet.mjs
```

## Package contents

| File | Purpose |
| --- | --- |
| `ARC_REVIEWER_INSTRUCTIONS.md` | Reviewer-facing instructions (no analyzer internals) |
| `review-worksheet-18-items.csv` / template | All 18 items with Accept/Reject/Modify/Insufficient Evidence |
| `items.json` | Full benchmark item payloads + empty reviewer fields |
| `missed-issue-slots.json` | Dedicated missed-issue entries by sheet |
| `benchmark-link-map.v1.json` | Stable ids ↔ runs / findings / technical checks |
| `feedback-ledger.jsonl` + schema | Append-only evaluation feedback |
| `LABEL_MAP.md` | Decision vocabulary |
| `PROFESSIONAL_ACCURACY_METHODOLOGY.md` | How accuracy will be measured after qualified review |
| `sample-filled-worksheet.csv` | Synthetic example only |

## Simple reviewer instructions

1. Open `ARC_REVIEWER_INSTRUCTIONS.md`.
2. Fill `review-worksheet-18-items.csv` (one row per item).
3. Use **Accept / Reject / Modify / Insufficient Evidence / N/A**.
4. On **Modify**, fill corrected interpretation + severity + justification.
5. Record analyzer **missed** issues in `missed-issue-slots` (or ask ops to run the CLI).
6. Set `needsSecondReview=true` when another discipline should look.
7. Return the filled CSV; do not mark metrics-verified yourself.

## Recommended discipline assignments (18 items)

| Items / sheets | Primary reviewer |
| --- | --- |
| FP200 hydraulic (`pb-v1-001`, `pb-v1-018`) | Fire PE |
| A-3.06 guardrail (`pb-v1-002`, `003`, `016`) | Architect (RA) |
| A-6.00 doors (`pb-v1-004`–`006`, `017`) | Architect; Fire PE for ratings |
| A-1.03 penetration (`pb-v1-007`) | Architect (RA) |
| M-1.4 refrigerant (`pb-v1-008`) | Mechanical PE |
| S-201 / S-204 structural (`pb-v1-009`, `015`) | Structural PE |
| A-1.00 / A-2.01 dates (`pb-v1-010`, `011`) | Architect (RA) |
| E-1.1 / E-1.3 GFCI (`pb-v1-012`, `013`) | Electrical PE |
| FP201 sprinkler (`pb-v1-014`) | Fire PE |

## Production Accept / Modify / Reject (reuse — no duplicate UI)

Editors continue using the existing PermitPilot finding review card on published findings.

- Table: `supabase_analyzer_finding_reviews` (RLS + audit events unchanged)
- Original AI finding rows are **not** overwritten
- Export reviews → import with `import-supabase-review-export.mjs` for benchmark linkage

### Offline worksheet ↔ UI reconciliation

| Source | Ledger `source` | Default status |
| --- | --- | --- |
| Filled CSV | `worksheet` | `preliminary` until `--finalize` |
| UI export | `supabase_ui_export` | `preliminary` until `--finalize` |

- Ledger is **append-only**. Later imports never silently delete earlier reviewer judgments.
- Conflicting **finalized** decisions for the same `pbItemId` surface as disagreements in `export-finalized-decisions.mjs`.
- Metrics / ground-truth promotion requires explicit `--authorize-metrics` (blocked otherwise).
- Unmatched UI reviews stay ledger-only preliminary records (`unmatched` count in import output).

## Recording missed issues & secondary review

```bash
node eval/drawing-dataset/cli/record-missed-issue.mjs \
  --sheet A-3.06 --title "..." --location "..." --identity "arc.ra1" --role "RA"

# Worksheet: needsSecondReview=true + secondReviewDiscipline + secondReviewNotes
```

## Return path & import

1. Reviewer returns filled CSV (or confirms UI decisions on linked project findings).
2. Ops merges: `merge-professional-worksheet.mjs --csv …` (optional `--finalize`).
3. Optional UI: `import-supabase-review-export.mjs --export …`.
4. Ops exports summary: `export-finalized-decisions.mjs`.

## Completion tracking

`export-finalized-decisions.mjs` reports reviewed vs remaining (18), second-review queue, disagreements, recurring false positives / missed issues, and improvement candidates tied to `sourceRecordId`.

## How feedback will be used later

reviewed evidence → ledger → evaluation export → **proposed** improvement candidates → **human-approved** regression/test/prompt changes.

Nothing in this loop automatically changes production prompts, validators, Stage 3 controls, or compliance findings. Precision/recall is **not** reported from synthetic or incomplete labels.

## Confidentiality

Do not send customer drawings, OCR packs, or benchmark materials externally without explicit approval. Generated `out/` bundles stay local/private.
