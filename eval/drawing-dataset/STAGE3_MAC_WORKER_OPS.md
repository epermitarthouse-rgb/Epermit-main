# Stage 3 Mac OCR worker — operating procedure (pilot + full drawing set)

Apple Vision OCR on a Mac is preprocessing only. Supabase remains the primary analyzer; GPT-4o still receives the original PDF. Packs are supplementary evidence with `independentlyVerified: false`.

**Authoritative sheet count (McDonald’s eval dataset):** 82 PDF drawings (`pages-manifest.json` / `layout-full/coverage.json`). The source tree may list **83 walked filesystem entries** (non-PDF sidecars); do not invent an 83rd sheet.

## Run-scoped activation (required)

Stage 3 is **off** for every run unless that run opts in. Global `ANALYZER_STAGE3_VISUAL_EVIDENCE=true` does **not** enable unrelated jobs.

Opt in one run (preserves existing `analysis_scope` fields):

```sql
update public.supabase_analyzer_runs
set analysis_scope = coalesce(analysis_scope, '{}'::jsonb)
  || jsonb_build_object(
    'stage3VisualEvidence', true,
    'stage3FullCoverageOcr', true,
    'stage3OcrPreprocess', jsonb_build_object(
      'version', 'phase3.stage3-ocr-preprocess.v1',
      'fullCoverage', true,
      'gateMode', 'blocking',
      'requiredSheetCount', 82
    )
  ),
    updated_at = now()
where id = '<run-uuid>';
```

Approve partial OCR (operator decision — GPT may proceed; per-sheet packs still fail-open when missing):

```sql
update public.supabase_analyzer_runs
set analysis_scope = jsonb_set(
      coalesce(analysis_scope, '{}'::jsonb),
      '{stage3OcrPreprocess,gateMode}',
      '"approved_partial"'::jsonb,
      true
    ),
    updated_at = now()
where id = '<run-uuid>';
```

Clear opt-in:

```sql
update public.supabase_analyzer_runs
set analysis_scope = coalesce(analysis_scope, '{}'::jsonb)
  - 'stage3VisualEvidence'
  - 'stage3FullCoverageOcr'
  - 'stage3OcrPreprocess',
    updated_at = now()
where id = '<run-uuid>';
```

**Emergency kill-switch** (all runs):

```bash
supabase secrets set ANALYZER_STAGE3_VISUAL_EVIDENCE=false --project-ref <ref>
```

## Start / stop the Mac worker

From repo root (`Epermit-main`):

```bash
# Pilot sheets only (A-3.06, A-6.00, FP200)
node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs enqueue

# Full drawing set (82 PDFs) + local run state under stage3-mac-worker/runs/
node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs enqueue-full \
  --run <run-uuid> --project <project-uuid>

# Process jobs (controlled concurrency for Mac CPU/RAM)
node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs loop --max 90 --concurrency 2

# Optional: push preprocess summary to Supabase (worker token; no service role on Mac)
node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs loop --max 90 --sync-supabase

# Coverage report (every sheet must have cache/pack outcome)
node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs coverage --run <run-uuid>

# Cancel pending queue; mark run cancelled locally
node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs cancel --run <run-uuid>

# Retry one sheet after fix
node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs retry-sheet --sheet A-3.06-00.pdf --run <run-uuid>

# Operator partial approval (local state + optional --sync-supabase)
node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs approve-partial --run <run-uuid> --sync-supabase
```

Stop: Ctrl-C on `loop`. Jobs remain under gitignored `eval/drawing-dataset/out/.../stage3-mac-worker/`.

## Full-coverage GPT gate (Supabase processor)

When `analysis_scope.stage3FullCoverageOcr=true`, the processor **defers paid GPT** until:

- preprocess summary is **terminal** with no `missingEvidence`, or
- operator sets `gateMode=approved_partial` / `released`, or
- Mac heartbeat is stale → job error `stage3_ocr_mac_offline` (no indefinite wait).

Ordinary runs (no full-coverage flag) remain **fail-open** — missing packs never block baseline PDF→GPT.

## Pending jobs, interruption, cache

| Topic | Behavior |
| --- | --- |
| Queue | Local JSON under `stage3-mac-worker/jobs/{pending,claimed,done,failed}`. |
| Restart | Re-run `loop`; completed cache/packs persist; claimed leases expire → requeue. |
| Cache key | `{sha256}.macos-vision.phase3.stage3-visual-evidence.v1` — survives new sheet-job IDs. |
| Drawing revision | New PDF bytes → new SHA → re-OCR. Edge upload verifies SHA against Storage. |
| Upload | `upload-packs --live --project … --run …` via `STAGE3_WORKER_UPLOAD_TOKEN`. |
| Isolation | Edge validates sheet job ∈ project/run; packs in private bucket prefix `{project}/{run}/{sheetJobId}/`. |

## Secrets

| Secret | Where | Notes |
| --- | --- | --- |
| `STAGE3_WORKER_UPLOAD_TOKEN` | Edge + gitignored local file | ≠ service role. Rotate on Edge + Mac together. |
| `ANALYZER_STAGE3_VISUAL_EVIDENCE` | Edge | Kill-switch when `false`. |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Mac env | Outbound Edge calls only. **No service role on Mac.** |

## Evidence retention

- Bucket: private `supabase-analyzer-stage3-evidence` (JSON, size-capped).
- Delete by prefix `{projectId}/{runId}/` when retiring a run.
- Never commit drawings, OCR, packs, or tokens (`eval/drawing-dataset/out/` is gitignored).

## Monitoring

- Mac: `status`, `coverage`, recent `audit.jsonl`.
- Edge: `GET /functions/v1/supabase-analyzer-stage3-evidence/health`.
- Supabase: `analysis_scope.stage3OcrPreprocess` counts (synced via worker `--sync-supabase`).

## Future managed macOS

When moving off a laptop: apply `PROPOSED_stage3_ocr_jobs.sql` only after approval, point worker at Supabase sheet-job list + `download_drawing` Edge action, keep the same cache key and evidence bucket layout.

## Pre-run sync path (no invented sheet-job IDs)

Sheet-job UUIDs exist only after an analyzer run is created (upload/queue). Do **not** invent IDs or create a paid GPT run merely to warm Storage.

1. Local Apple Vision OCR already complete (`coverage` → **82/82**; cache keyed by SHA + `phase3.stage3-visual-evidence.v1`).
2. In production UI: select the 82-sheet project, enable **Stage 3 full-coverage OCR**, start the run (drawings upload; GPT is **blocked** by the readiness gate).
3. Immediately sync packs to the new run’s sheet jobs (resume-safe; verifies server-side retrieval):

```bash
export SUPABASE_URL=… SUPABASE_ANON_KEY=… STAGE3_WORKER_UPLOAD_TOKEN=…
node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs sync-full-set \
  --project <project-uuid> --run <run-uuid> --live --sync-supabase
```

4. Confirm counts: OCR completed / pack stored / pack retrieved / prompt-ready evidence.
5. When preprocess is terminal with `missingEvidence=0`, the processor releases GPT for that run only.

Association is by `original_file_name` ↔ local relative path. Unmatched/ambiguous sheets abort the sync (no silent skip).

## Controlled checklist before paid full-set GPT

1. Kill-switch unset (not `false`).
2. Target run opted in with `stage3FullCoverageOcr` + blocking gate (UI switch or SQL above).
3. `enqueue-full` + `loop` until `coverage` shows **82/82** recorded with valid pack status (already done locally).
4. After run create: `sync-full-set --live` until Storage verify succeeds for all 82.
5. Confirm preprocess terminal + zero missing evidence (or operator `approved_partial`).
6. Allow the gated run to proceed to GPT once; verify audit `stage3_ocr_gate_blocked=false`.
