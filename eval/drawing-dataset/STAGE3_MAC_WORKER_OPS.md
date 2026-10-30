# Stage 3 Mac OCR worker — pilot operating procedure

Temporary Apple Vision OCR worker for Supabase Code Analyzer Stage 3. The Mac is a pilot OCR box only. Supabase remains the primary analyzer; GPT-4o still receives the original PDF. Packs are supplementary evidence with `independentlyVerified: false`.

## Run-scoped activation (required)

Stage 3 is **off** for every run unless that run opts in. Global `ANALYZER_STAGE3_VISUAL_EVIDENCE=true` does **not** enable unrelated jobs.

Opt in one run (preserves existing `analysis_scope` fields):

```sql
update public.supabase_analyzer_runs
set analysis_scope = coalesce(analysis_scope, '{}'::jsonb)
  || jsonb_build_object('stage3VisualEvidence', true),
    updated_at = now()
where id = '<run-uuid>';
```

Clear opt-in:

```sql
update public.supabase_analyzer_runs
set analysis_scope = coalesce(analysis_scope, '{}'::jsonb) - 'stage3VisualEvidence',
    updated_at = now()
where id = '<run-uuid>';
```

**Emergency kill-switch** (all runs, including opted-in):

```bash
supabase secrets set ANALYZER_STAGE3_VISUAL_EVIDENCE=false --project-ref <ref>
```

Unset the kill-switch (does not enable any run by itself):

```bash
supabase secrets unset ANALYZER_STAGE3_VISUAL_EVIDENCE --project-ref <ref>
```

## Start / stop the Mac worker

From the repo root (`Epermit-main`):

```bash
# Enqueue the fixed pilot sheets (A-3.06, A-6.00, optional FP200)
node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs enqueue

# Process one pending job (uses SHA+method+version cache when present)
node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs once

# Process up to N jobs
node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs loop --max 10

# Force fresh Vision OCR (bypass local OCR cache)
node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs once --fresh-ocr

# Queue / cache status
node eval/drawing-dataset/cli/stage3-mac-ocr-worker.mjs status
```

Stop: interrupt `loop` with Ctrl-C. There is no daemon; jobs remain in the local queue under gitignored `eval/drawing-dataset/out/.../stage3-mac-worker/`.

## Pending jobs, interruption, cache

| Topic | Behavior |
| --- | --- |
| Pending jobs | Local JSON queue under `stage3-mac-worker/`. `status` lists pending/completed/failed. |
| After interruption | Re-run `once` / `loop`. Completed packs stay on disk; unfinished jobs stay pending. |
| Cache reuse | Packs keyed by `contentSha256` + `macos-vision` + `phase3.stage3-visual-evidence.v1`. Same drawing bytes reuse the pack. |
| Drawing revision | New PDF bytes → new SHA → cache miss → re-OCR. Upload uses Edge SHA check against the Storage drawing. |
| Upload to Supabase | `upload-packs --project <uuid> --run <uuid>` via Edge + `STAGE3_WORKER_UPLOAD_TOKEN` (never service role on the Mac). Paths are `{project}/{run}/{sheetJobId}/{sha}.macos-vision.{version}.json`. |

## Secrets

| Secret | Where | Notes |
| --- | --- | --- |
| `STAGE3_WORKER_UPLOAD_TOKEN` | Supabase Edge secrets + local gitignored `.stage3_worker_upload_token` | Dedicated upload token ≠ service role. Rotate by setting a new Edge secret and updating the local file. |
| `ANALYZER_STAGE3_VISUAL_EVIDENCE` | Edge secrets | Kill-switch only when `false`. Unset/absent = run-scoped mode. |
| `SUPABASE_ANON_KEY` / URL | Local env for Edge calls | Mac must not hold the service role for Stage 3 upload. |

## Evidence retention

- Bucket: private `supabase-analyzer-stage3-evidence` (JSON, 256 KiB, no public policies).
- Retention: keep packs for the life of the pilot run; delete by Storage prefix `{projectId}/{runId}/` when a pilot run is retired.
- Do not commit packs, OCR extracts, crops, drawings, or tokens to Git (`eval/drawing-dataset/out/` is gitignored).

## Monitoring and Mac offline

- Worker availability: `status` CLI + presence of recent pack files; Edge health `GET /functions/v1/supabase-analyzer-stage3-evidence/health` (`workerTokenConfigured`, `acceptsServiceRoleUpload: false`).
- Mac offline / missing pack: processor **fail-opens** — baseline PDF→GPT continues; audit shows `stage3_visual_evidence_status=missing` (or disabled when not opted in). Analysis is never blocked waiting for OCR.
- Stale / SHA mismatch / malformed packs: rejected or ignored; baseline continues.

## Controlled pilot checklist

1. Confirm kill-switch unset (or not `false`).
2. Create the target analyzer run (or reuse sheet jobs).
3. Opt in **that run only** via SQL above.
4. Run Mac worker → upload packs for the run’s sheet job IDs.
5. Process the run; confirm audit `stage3_visual_evidence_enabled=true` and `status=recovered` only on that run.
6. Clear run opt-in (and/or set kill-switch) after the pilot window.
