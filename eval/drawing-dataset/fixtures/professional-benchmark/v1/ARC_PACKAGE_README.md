# ARC review package (v1)

Offline package for ARC professional review of the Supabase Code Analyzer benchmark. **No new UI.** Live project findings still use existing Accept / Modify / Reject in PermitPilot.

## Contents

| File | Purpose |
| --- | --- |
| `items.json` | 18 review items with empty reviewer fields |
| `missed-issue-slots.json` | Per-sheet missed-issue lists |
| `review-worksheet.template.csv` | Spreadsheet review form (all 18 items) |
| `ARC_REVIEWER_INSTRUCTIONS.md` | Reviewer-facing instructions |
| `LABEL_MAP.md` | Decision vocabulary map |
| `benchmark-link-map.v1.json` | Stable id ↔ item / run / check links |
| `feedback-ledger.schema.json` | Feedback record schema |
| `feedback-ledger.jsonl` | Append-only feedback ledger (starts empty) |
| `sample-filled-worksheet.csv` | Synthetic example for ops testing |

Handover narrative: `eval/drawing-dataset/ARC_HANDOVER.md`  
Regenerate a ready-to-share bundle: `node eval/drawing-dataset/cli/professional-benchmark-worksheet.mjs` → `eval/drawing-dataset/out/arc-review-package-v1/`

## Operator quick start

```bash
# 1. Generate a fresh worksheet + package bundle for ARC
node eval/drawing-dataset/cli/professional-benchmark-worksheet.mjs

# 2. After ARC fills the CSV:
node eval/drawing-dataset/cli/merge-professional-worksheet.mjs --csv /path/to/filled.csv

# 3. Optional: import live UI Accept/Modify/Reject export
node eval/drawing-dataset/cli/import-supabase-review-export.mjs --export /path/to/export.json

# 4. Record a missed issue
node eval/drawing-dataset/cli/record-missed-issue.mjs \
  --sheet A-3.06 --title "..." --location "..." --identity "..." --role "RA"

# 5. Export completion + improvement candidates
node eval/drawing-dataset/cli/export-finalized-decisions.mjs
```

Use `--finalize` when a batch is complete. Use `--authorize-metrics` only when intentionally promoting records into verified metrics (rare).

## Offline vs production UI reconciliation

1. **Production UI** remains the system of record for live project finding reviews (`supabase_analyzer_finding_reviews`, RLS, audit). Original AI findings stay immutable.
2. **Worksheet** decisions are imported into the append-only eval ledger and optional `items.json` reviewer blocks.
3. **UI exports** map Accept/Modify/Reject → professional classifications and link to `pbItemId` via `benchmark-link-map.v1.json` when possible.
4. Conflicting **finalized** judgments for the same item are reported as disagreements — they do **not** silently replace prior ledger rows.
5. Preliminary feedback stays separate until `--finalize`. Metrics contribution stays false without `--authorize-metrics`.

## Learning loop (controlled)

reviewed evidence → structured ledger → evaluation export → proposed improvement candidates → **approved** regression/test release

No automatic production learning or model fine-tuning.
