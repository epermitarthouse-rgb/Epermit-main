# Handoff Notes — read first

Last updated: 2026-11-12 (viewer test rolled back). Read "Viewer retry rollback" first.

## Viewer retry rollback (2026-11-12)
- No worker-entry process was running. Job `3865c23c` cancelled with `02-cancel-deep-job.sql`: status `cancelled`, error still `session_ended`. Active DC jobs 0.
- Restored all 33 `capture_next_attempt_at` values from `exports.local/viewer-retry-reset-20261112T145456Z.json` (guard: permit `06fa082e`, `failed`, `viewer`, attempts 2). All 33 match the saved times. Counts still 9 stored / 27 `not_requested` / 33 `failed` / 3 `not_permitted`.
- Job `3865c23c` had changed no document row. Hash `13ac00b0eef8d096`, pipeline runs 0, parsed_comments 6. No new job, no deploy, no push.

## Viewer retry live check (2026-11-12 14:54–15:01 UTC), NOT VERIFIED
- Pre-check passed after the CLI reconnect: `select 1` ok, project list includes `eeqxyjrcldivtpikcpvk`. Active jobs 0, job `74af8d1d` terminal `completed_with_warnings`, cron 3, automation off, flag OFF, migration history 26. Documents 72 = 9 stored / 27 `not_requested` / 33 `failed` / 3 `not_permitted`. The 33 are `failed` / `viewer` / `download_failed` / attempts 2.
- Saved the 33 `capture_next_attempt_at` values (attempts 2) to git-ignored `exports.local/viewer-retry-reset-20261112T145456Z.json`. Not printed.
- Reset: `capture_next_attempt_at = now()` on those 33 only. Verified 33 changed, attempts still 2, the other 39 rows' fingerprint unchanged (`6330601be77700f23fadbad284778f4b`).
- Job `3865c23c-d5e3-4b3f-a048-404516815250` queued (deep, scope 6364, max_files 1, max_bytes and max_file_bytes 209715200). Still unclaimed 5 s later (0 claim events, 1 active job). Claimed only by the local worker `javerias-MacBook-Pro.local`. First log line `agent_trigger=off`. Login ok, API session ok, blocked 0. Deep pass started 14:59:52 (tabs `files` only, reason `documents_pending`).
- Outcome: worker exit 0, job **`retry_wait` / `session_ended`**, last_error `portal session ended` (the bare session-ended error, no host or path stored). Finished 15:01:03. No `guard_denied`. No document row changed: still 33 failed/viewer/attempts 2/`download_failed`, 9 stored, 27 `not_requested`, 3 `not_permitted`. No file stored, so no signed URL. The deep pass silences scraper console output, and the log has no popup line and no `RetrieveFile` line. The viewer fallback was not shown to run. Whether the portal refuses `RetrieveFile` when `DownloadFile=false` is still unknown.
- Unchanged: project hash `13ac00b0eef8d096`, `last_checked_at` 09:23:32Z, pipeline runs 0, parsed_comments 6, service-execution audit 0, reports 5 captured, 6 report versions, cron 3, flag OFF, automation off. No second run, no code change, no deploy, no push.
- Rolled back: see "Viewer retry rollback". Job `3865c23c` is `cancelled`. The 33 retry times are restored.

## Viewer retry live check (2026-11-12 ~13:32 UTC), STOPPED at pre-check
- Approved scope was: save and reset `capture_next_attempt_at` on the 33 failed view-only rows for BCIV2500152, then one headed deep job, `max_files=1`, agents off. Nothing else.
- `supabase db query --linked` did not run. The CLI stopped at "Initialising login role" with HTTP 403 (`--agent=no` the same). `supabase projects list` returns 2 projects and does not include `eeqxyjrcldivtpikcpvk`. The link file still names that ref. `SUPABASE_DB_PASSWORD` is unset, so there was no direct-connection fallback. No query result, so the 33-row count was not confirmed.
- Not done: no export, no `UPDATE`, no job, no worker, no Chromium, no agent run, no deploy, no push, no cron or `automation_enabled` change, no secret set. Rollback is not needed.
- Next: log the CLI in as an account that can see InsightDC (`eeqxyjrcldivtpikcpvk`), confirm `db query --linked` returns rows, then rerun this same scope. Do not reset retry times until that pre-check can read the 33 rows.

## Deep job stop (2026-11-12, viewer POST drop)
- Why: in deep mode, `viewFile` for a view-only file submits a POST form to `/File/FileViewer?fileID=…` in a popup. The transport guard drops that non-GET (`method_dropped`, `route.abort('blockedbyclient')`). The popup stays on the blocked error page, so it is treated as present and the guarded GET `File/RetrieveFile` fallback never runs. Every view-only Drawings file ends `download_failed`. No deny rule and no method rule was changed. POST to FileViewer stays refused.
- Local headed workers for this run had already exited before the stop: terminals 111707 (pid 99763), 111708 (pid 2571) and 111709 (pid 7731, job `74af8d1d`, outcome `completed_with_warnings`, exit 0 at 10:58:20Z). No SIGINT was sent. `ps` showed those pids gone, no `permit-sync/worker-entry`, and no Playwright Chromium. Unrelated local processes were left running.
- Approved cancel `scripts/permit-repo/one-permit-live-test/02-cancel-deep-job.sql` via `supabase db query --linked -f` did not execute: the CLI stopped at "Initialising login role" with HTTP 403 (this CLI login's project list does not include `eeqxyjrcldivtpikcpvk`). No production write from that attempt.
- SELECT after the attempt (statuses and counts only): job `74af8d1d` is terminal `completed_with_warnings`, `error_code` null. Active jobs (`queued` / `running` / `retry_wait` / `waiting_user`): 0. Documents for the permit: 72 = 9 stored, 27 `not_requested`, 33 `failed`, 3 `not_permitted`. No new document rows.
- Not done: no live portal session, no download, no agent run, no deploy, no push, no cron or `automation_enabled` change, no secret set.
- Local fix (D-089, not live): deep mode closes a viewer popup that is empty, blocked, or has no WebViewer config, then uses the existing GET `File/RetrieveFile` fallback (original, then PDF rendition). POST to FileViewer stays refused. `npm run test:permit-sync` 204/204.

## Supervised live check (not run) — one Drawings view-only file
Ran 2026-11-12 14:54–15:01 UTC and stopped at `session_ended` before any file: see "Viewer retry live check". Needed before this counts as verified. Queue one deep job for ProjectID 6364 with `max_files` 1 (do not reuse `12-request-full-deep-job.sql` as written; that queues 72). The CLI login must be able to run `supabase db query --linked` again (this session got HTTP 403 on login-role). Agents off. Headed. The 33 failed Drawings rows were next eligible about 14:58 UTC on 2026-11-12; before that, `max_files=1` can take a permitted `not_requested` file instead of a view-only retry.

```bash
cd /Users/javerianaveed/epermit/Epermit-main/scraper-service && env -u PERMITPILOT_SERVICE_PIPELINE_SECRET \
  PERMIT_SYNC_WORKER_ENABLED=true PERMIT_SYNC_LIVE_PORTAL_APPROVED=A-3 PERMIT_SYNC_MODE=deep PERMIT_SYNC_WORKER_ONCE=true \
  PERMIT_SYNC_ONLY_PORTAL_RECORD_IDS=6364 PERMIT_SYNC_DEEP_MAX_FILES=1 PERMIT_SYNC_DEEP_MAX_BYTES=209715200 PERMIT_SYNC_DEEP_MAX_FILE_BYTES=209715200 \
  SCRAPER_HEADLESS=false PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright" \
  node -r dotenv/config permit-sync/worker-entry.js
```

Expect the first log line `agent_trigger=off` and one new stored document with `capture_access_path=viewer`. Guard events for the job, if any, are only `method_dropped`. The portal may still refuse RetrieveFile when `DownloadFile=false`; that result is a portal refusal, not a guard change.

## Full-capture live test (2026-11-12 ~08:48–11:00 UTC), PARTIAL PASS — reports complete, files incomplete
- User approval: apply migration `20261112100000`, one full-capture deep job for BCIV2500152 (72 / 600 MiB, no 50 MB `max_file_bytes`), one no-change rerun, agents OFF, headed Chromium. Upload limit raised to 500 MB in the dashboard (not readable via CLI; bucket `file_size_limit` still null). Do not push.
- Pre-flight: CLI owns `eeqxyjrcldivtpikcpvk` (`supabase projects list` + `db query --linked` ok). Migration history 25 (latest `20261111120000`). Active DC jobs 0, cron 3, automation off, `module.central_permits` OFF. Docs baseline: 9 stored / 27 not_requested / 36 not_permitted; 4 report versions; hash `5a283b800b14d9b4`; parsed_comments fingerprint `b4a09c21b8f00732de7ebff89a04aa60`; pipeline runs 0.
- **A-M applied:** `11-apply-capture-retry.sh --i-have-approval` (BEGIN/COMMIT + `migration repair --status applied 20261112100000`). History 25→26. Pre-check rows 1–4 true; RLS intact; claim v1 still JSON-only; `completed_with_warnings` + `deferred_oversize` + capture columns + `record_permit_document_capture_v2` (service_role only) present.
- Attempt 1 job `40f79c6b` (queued 08:49): local worker claimed (`javerias-MacBook-Pro.local`); first line `agent_trigger=off`. Crashed ~12 min in with uncaught Playwright `waitForEvent("page")` TimeoutError after a failed/stale dashboard click (Node 18 unhandled rejection); job left `running`. Cancelled with `02-cancel-deep-job.sql`. **One local fix** `ffec70b`: `lib/await-popup-page.js` drains the page-event promise when the click throws; extraction popup protected from the pre-download sweep; 4/4 unit tests. No second code fix without approval.
- Run 1 job `095d5d6f` (09:08–09:23): `agent_trigger=off`, claimed only by local worker, outcome **`completed_with_warnings`** (`files_failed`, `files_pending`, `files_failed_open`). No `lease_lost`. No mutation / no new `guard_denied` on this job.
  - **Reports (goal met):** all 5 `captured`. Report 4 newly captured (D-081 live). Report 14 v2 with **6 structured rows**. Versions: 12/15/16 v1 unchanged; 14 v1+v2; 4 v1 (text 5811). `reports_captured` 2, `reports_unchanged` 3, `report_objects_removed` 6.
  - **Files (goal NOT met):** still 9 stored (Approved Drawings, prior runs); **33 Drawings `failed`/`viewer`** with `download_failed`, attempts 1, back-off ~1 h; **27 permitted still `not_requested` (never attempted)**; 3 Supporting Documents still `not_permitted`. 0 bytes downloaded this job; 0 `files_via_viewer` stored; old stored rows have null `capture_is_rendition` / `size_matches_portal`.
  - ff193644: hash `5a283b800b14d9b4` → `13ac00b0eef8d096` (report content; 2 `permit_changes` on reports). parsed_comments fingerprint unchanged. Pipeline runs 0. 0 new `project-drawings` objects. Orphans 0. Signed URL GET **200** for report 4 PDF, largest stored file, report 4 XLSX; public URL **400** (private bucket).
- Rerun job `74af8d1d` (10:46–~10:58): `agent_trigger=off`, local claim only, **`completed_with_warnings`** same warnings. 0 content changes, 0 new report versions (still 6), hash unchanged `13ac00b0eef8d096`, 0 portal_data writes, 0 pipeline runs. **33 failed viewer files retried** (attempts 2, next ~14:58 UTC) and failed again with `download_failed`. 27 permitted still never attempted. 0 downloads of the 9 stored files.
- Unchanged: cron 3, flag OFF, automation off, Railway untouched, no secret, no edge/frontend deploy, nothing pushed. Local commits include `ffec70b` + this docs commit on top of `0f8b506`…`8f4f79b`.
- Inspect: `VITE_LOCAL_PERMIT_INSPECTION=read-only npx vite --port 5173 --strictPort`, then `http://localhost:5173/permit-queue/06fa082e-b942-4b54-b448-a1527f58df41` and `http://localhost:5173/portal-data?projectId=ff193644-3e94-46d4-a1c0-4755fc65d0dd`.
- Rollback (migration): `supabase db query --linked -f scripts/permit-repo/rollback-20261112100000_permit_capture_retry.sql && supabase migration repair --status reverted 20261112100000` (refuses while a deep job is active). Abort job: `02-cancel-deep-job.sql`.
- Remaining issues needing approval: (1) viewer-path `download_failed` for all 33 Drawings files; (2) 27 download-permitted files never gated/attempted in either pass; (3) optional click-timeout hardening beyond `ffec70b` if dashboard click hangs. Next approvals: agent edge deploy decision, frontend deploy, `central_permits` flag, worker deep redeploy, cron.

## Deep capture corrections (2026-11-12, local commits only, no push)
- Commits on `feat/central-permit-repository` (after `3193cb4`): `0f8b506` safety (3b/3c), `e5bc0ef` accuracy + migration `20261112100000` (D-080..D-087), `e7c8ee3` Permit Queue UI, `30c1ebd` comment-parser keying (6d), `8f4f79b` docs/live-prep, `ffec70b` popup waitForEvent drain (live crash fix).
- Live verification (above): D-081 report 4 **passed**; report 14 v2 structured rows **passed**; D-082 viewer capture **failed** live (`download_failed`); D-084 originals not exercised (no new stores); D-086 warnings outcome **passed**.
- Storage: user set project upload limit to 500 MB; CLI still cannot read the global limit; bucket limits null.

## One-permit live test: guard-safe fix and rerun (2026-11-11 08:20–08:38 UTC), PASSED with agents off
- User approval: guard-safe report fix plus rerun; agents stay off (no secret, no edge deploy, no Railway change). Every deny pattern unchanged (`/Upload/i` kept; tested).
- Fix (D-079), commit `a6eb159`, plus `cf414d1` (inspect SQL handles non-array `structured_rows`): each report's viewer URL (built from `GetReportList`: ReportID, ReportPath, DataSourceName, params) is checked with the deep-mode guard before it is opened. A denied report is marked `failed` with `guard_denied (rule): GET host/path`, a `guard_denied` event is logged (method, host, path, rule, report_key only) and the job continues. Each report and its version are recorded as soon as its export finishes. Any other guard refusal and every mutation still abort the job (`SafetyViolationError` → `failed_unrecoverable`). `04-inspect.sql` now lists `guard_events` and `deep_jobs` (status, error_code, last_error). Tests: permit-sync 188/188 (Chromium; needs `PLAYWRIGHT_BROWSERS_PATH`, otherwise the 21 DOM tests are cancelled).
- Rerun job `70d2a366` (deep, scope 6364, 3 files / 20 MiB): claimed only by the local worker; worker line `agent_trigger=off`. Outcome `completed`. JSON pass 0 changes. 3 more files stored (817030 1,241,948 / 817031 1,129,895 / 817032 1,195,451 bytes, "Approved Drawings"); 817027–817029 not downloaded again. Reports 12, 14, 15, 16 captured as version 1 with PDF + XLSX (text 379 / 3,912 / 8,808 / 8,796 chars, 0 structured rows). Report 4 `failed`: `guard_denied (deny_pattern): GET session.planreview.dob.dc.gov/WebForms/ReportViewer.aspx`; one `guard_denied` event (job 70d2a366, report_key 4). `permit_deep_state` recorded. ff193644 `portal_data` written once: hash `31dba978358fcc6f` → `5a283b800b14d9b4`, `permitRepositorySync` = 06fa082e, tabs info/files/tasks/status/reports. 7 new `permit_changes` (3 document captures, 4 report contents). Signed URLs 206 for files and report PDF/XLSX; bucket private.
- Idempotency job `d36f9344`: claimed only by the local worker, `agent_trigger=off`, `completed`. 0 content changes, 0 snapshots, 0 report versions (still 4), 0 reports reopened (report 4 not retried; D-074 retries only on input change), 0 `guard_denied` events, hash unchanged `5a283b800b14d9b4`, 0 portal_data writes, 0 pipeline runs. Deviation from "0 downloads": 3 more capped files stored (817033 1,090,174 / 817034 1,689,218 / 817035 1,792,573 bytes) with 3 matching `permit_documents` capture rows. These were still pending because of the 3-file cap (D-074), not re-downloads; 27 permitted files remain pending.
- Totals now: 9 stored files, 27 not requested, 36 not permitted; 6 review comments; 4 report versions; `permit_changes` for the permit 116. parsed_comments for ff193644: same 6 ids, statuses, source and fields as `exports.local/ff193644-parsed-comments-before.json`; newest timestamp 2026-06-30 (the worker has no code path that writes `parsed_comments`). New fingerprint baseline `md5(string_agg(pc::text, ',' ORDER BY id))` = `b4a09c21b8f00732de7ebff89a04aa60`. Pipeline runs 0; service-execution audit rows 0.
- Orphans: after the rerun the whole `permit-documents` bucket had 25 objects, 17 referenced and 8 unreferenced, which were exactly job 7815af2b's report exports (created 07:51:07–07:52:17). Those 8 were deleted (828,451 bytes): `reports/12/002f3ab1….pdf` 178,949; `reports/12/25229c41….xlsx` 6,388; `reports/14/3403d796….pdf` 189,717; `reports/14/124cad42….xlsx` 7,290; `reports/15/1aff7ba6….pdf` 218,033; `reports/15/a38a6084….xlsx` 15,417; `reports/16/8b806982….pdf` 208,502; `reports/16/4c555b9d….xlsx` 10,155. Now 17 objects, all referenced, 0 rows pointing to missing objects.
- Unchanged: cron 3, flag OFF, automation off, 88 projects, Railway untouched (old worker `29f0703c`), no secret, no edge deploy.
- Browser trigger caveat: `AgentWorkflowStatus` starts the agent chain on a Realtime `portal_data_hash` change if someone has ff193644's Dashboard open. Pipeline runs stayed 0, so nobody did.
- Inspect: `VITE_LOCAL_PERMIT_INSPECTION=read-only npx vite --port 5173 --strictPort`, then `http://localhost:5173/permit-queue/06fa082e-b942-4b54-b448-a1527f58df41` and `http://localhost:5173/portal-data?projectId=ff193644-3e94-46d4-a1c0-4755fc65d0dd`; SQL `03-watch.sql`, `04-inspect.sql` (`supabase db query --linked -f …`).
- Rollback: unlink with `01-unlink-project-rollback.sql`; migration with its rollback script plus `supabase migration repair --status reverted 20261111120000`.
- Remaining approvals: agent edge deploy decision (production functions lag `main`, D-077), frontend deploy, `central_permits` flag, worker deep redeploy on Railway, cron.

## One-permit live test: execution attempt 3, agent trigger OFF (2026-11-11 07:44–07:52 UTC), STOPPED at a safety rule
- User decision: scrape now with the agent trigger off; edge deploy later. No secret file, no secret set, no function deployed, no Railway change. Config check (no `--pipeline-secret-file`): startup ok, legacy service_role JWT, `agent_trigger: off`, deep, scope 6364, 3 files / 20 MiB, headed, Chromium resolved. Worker started with `env -u PERMITPILOT_SERVICE_PIPELINE_SECRET`; first line `mode=deep agent_trigger=off scope=6364 max_files=3 max_bytes=20971520`.
- Agent safety with portal_data writes: the 3 triggers on `projects` make no outbound calls, there are no DB webhooks, and the runner skips `pipeline.trigger` when `pipeline` is null. Only remaining path: `AgentWorkflowStatus` (browser) auto-starts the chain on a Realtime `portal_data_hash` change if someone has ff193644's Dashboard open. `project_pipeline_runs` for ff193644: 0 before, 0 after.
- Step 4 done: 1 `project_permits` row (ff193644 ↔ 06fa082e, linked_by 3d2b4632, 07:44:07); 1 link in total; projects 88 (unchanged).
- Step 5 done: job `7815af2b-5658-4cb0-929a-6b43c8bd4996` (deep, options 6364 / 3 / 20971520). 5 s later: queued, attempt 0, no lease, 0 claim events, only active job. Claimed at 07:44:46 by `javerias-MacBook-Pro.local` (the local worker) only.
- Step 6 run 1: login ok, API session ok, JSON pass 28 discovered / 1 ok / 25 out of scope, all 7 sections ok, 22 permit_changes, 1 snapshot. Deep pass started 07:46:52 (reasons linked_project_stale, documents_pending, reports_pending). 3 files stored, then reports 12, 14, 15, 16 exported (PDF + XLSX each) to storage, then report 4 was refused: **GET `session.planreview.dob.dc.gov` `/WebForms/ReportViewer.aspx?ReportID=4…`**, rule `deny_pattern`. Report 4 is "Current Project - All Uploaded Files with Sheet Sizes"; its ReportPath contains "Uploaded", which matches the mutation deny `/Upload/i` (kept in deep mode). Outcome `failed_unrecoverable` / `safety_violation`, 07:52:18. Safety rule, so no fix, no retry and no idempotency rerun (per the approval).
- Written: 3 `permit_documents` stored (817027, 817028, 817029; folder "Approved Drawings"; 2,801,624 + 1,383,644 + 1,272,749 = 5,458,017 bytes; run 7815af2b); 6 `permit_review_comments` (source_kind report, statuses Info Only / Resolved, 0 response_required, no responses captured). Bucket `permit-documents` private (public URL 400); signed URL GET 206 `application/pdf` for all 3.
- NOT written: no `permit_report_contents` versions, all 5 reports still `not_captured` with no error; no `permit_deep_state`; ff193644 `portal_data` NOT written (hash `31dba978358fcc6f` unchanged, no permitRepositorySync); 0 pipeline runs; 0 service-execution audit rows. parsed_comments for ff193644: the same 6 ids and statuses as before.
- Orphans: 8 storage objects under `06fa082e-…/reports/{12,14,15,16}/<sha256>.{pdf,xlsx}` (828,451 bytes) are not referenced by any row, because the abort happened before the report rows were recorded.
- `04-inspect.sql` `guard_events` shows 0: the violation is only in `permit_sync_jobs.last_error`/`error_code`, not as a `permit_sync_events` row (inspect query gap).
- Unchanged: cron 3, no automation, source `inactive` (last updated 03:46), flag OFF, 0 active jobs, Railway untouched.
- Proposed (needs approval; does not widen the guard): in deep report capture, check each report URL against the guard before opening it and mark a denied report `failed` with reason `guard_denied` instead of aborting the job; record each report's content right after its export so a later abort cannot orphan objects; log guard refusals as `permit_sync_events`. Then rerun steps 5–6 and the idempotency check.

## One-permit live test: execution attempt 2 (2026-11-11 ~07:37–07:45 UTC), STOPPED at step 3a
- User decision: skip the Railway scale step; no further Railway changes. Old worker deployment `29f0703c` (1 replica, old JSON-only code) left as is.
- Step 2 DONE and verified. `20261111120000` applied via BEGIN/COMMIT `db query` + `migration repair --status applied 20261111120000` (history 24 → 25). Pre-check rows 1–12 all true. RLS on `permit_report_contents` and `permit_deep_state`; 8 new/changed functions present; storage read policy present; `worker_mode` default `'json'`; flag OFF; cron 3; no source automated. Live `claim_permit_sync_job(text, integer)` is the only overload and its body is `SELECT * FROM public._permit_sync_claim(p_worker_id, p_lease_ttl_seconds, 'json')`; `_permit_sync_claim` filters `WHERE j.worker_mode = p_worker_mode`. Behavioural proof in a DO block that always raises (full rollback): a job from `admin_request_permit_deep_sync` had `worker_mode = deep`, `claim_permit_sync_job('verify-old-json-worker', 60)` returned NULL, `claim_permit_sync_job_v2(…, 'deep')` returned that job; afterwards 8 jobs, 0 deep, 0 active. The old worker's code predates `claim_permit_sync_job_v2`, so it can only call the two-argument claim.
- Step 3a STOPPED (no secret generated, nothing set or deployed). Production sources (downloaded with `--use-api` to `/tmp/fnprod`) each equal an OLDER commit in our history, so there are no production-only edits to revert. But production is behind the base `dd08ed1`, so deploying HEAD would also ship undeployed, non-service-mode changes:
  - `comment-parser-agent`: prod = `051a816` (2026-06-24); undeployed `5199937` (PGC harvest completion, comment-parser Excel validation: PGC/Montgomery export reports need Excel, else `excel_export_missing`). +93/−7.
  - `context-reference-engine`: prod = `f1b4bcc` (2026-03-27 initial import); undeployed `85b3da9`, `7be2588`, `972e312`, `52a9405` (batched multi-round enrichment, max_rounds caps). +223/−72.
  - `intake-pipeline-agent`: prod = `972e312` (2026-08-05 revert); undeployed `52a9405` (batched enrichment loop, targeted-retry stage reset, budget). +258/−35.
  - `auto-router-agent` (prod = `f1b4bcc`) and `discipline-classifier-agent` (prod = `85b3da9`): prod == base; only our service-mode diff. `_shared` Montgomery/PGC files: prod == HEAD.
- Steps 4–6 not run. State: migration applied; no link, no job, no secret.
- Options for the user: (a) approve deploying HEAD including those commits; (b) have us build a deploy that applies only the service-mode diff on top of the production sources (new code, needs tests and approval); (c) run steps 4–6 with the agent trigger off (no secret, no deploy; scrape + capture only), then decide on the edge deploy separately.

## One-permit live test: execution attempt 1 (2026-11-11 07:19–07:23 UTC), STOPPED at step 1
- Step 0 (pre-check) passed: rows 1–3 false, all others true. Baseline: 24 migration rows (latest `20261111100200`, `20261111120000` absent), 88 projects, 28 permits, 0 project_permits, 8 permit_sync_jobs (0 active), cron 3, flag OFF, 36 permitted / 0 stored files and 5 reports for 6364, 0 review comments for 06fa082e, 0 objects in `permit-documents`, ff193644 hash `31dba978358fcc6f`, 6 parsed_comments (all `raw_ref`, classified, code_reference and assigned_to set), 0 pipeline runs, 0 service-execution audit rows. Backups in `exports.local/ff193644-portal-data-before.json` and `exports.local/ff193644-parsed-comments-before.json` (git-ignored).
- Step 1 FAILED. `railway scale --project … us-west2=0` was rejected by the CLI's argument parser (no change). `railway service scale --environment production --service permit-sync-worker us-west2=0` (CLI 5.71.0) returned `{"regions":{"us-west2":null}}`, and Railway then **redeployed** the service (deployment `29f0703c-8449-4f6f-b86e-1acf5ef65bd7`, reason `redeploy`, same image `sha256:2f0dda8f…`, same env, numReplicas 1). Old deployment `1347f14a` is REMOVED; the worker runs 1 instance of the same old JSON-only code, idle (0 active jobs). Net effect equals a restart, but it is an unapproved redeploy and the worker is not at 0.
- Steps 2–6 not run: no migration, no secret, no edge deploy, no link, no job, no live portal run. Production DB unchanged.
- To reach 0 replicas, the user should use the Railway dashboard (service → Settings → Replicas = 0, or remove the region, then Deploy changes) or approve a different command; `us-west2=0` via the CLI does not scale to 0.

## One-permit live test (prepared 2026-11-11; nothing below has been run)
Target: permit `06fa082e-b942-4b54-b448-a1527f58df41` (BCIV2500152, DC ProjectID 6364), credential `de8592f9-69fc-4c71-8544-cb22bbbd5813`, project `ff193644-3e94-46d4-a1c0-4755fc65d0dd`, owner `f1f84c83-36f6-4664-b34b-614b2881f09d`, approving admin `3d2b4632-e3a3-4417-8a84-549cedbb6739`. 36 of 72 files are `download_permitted`; the job is capped at 3 files / 20 MiB. 5 reports. Decisions D-072 to D-075. SQL in `scripts/permit-repo/one-permit-live-test/` (tested on the replayed chain with these ids).

Production steps, in order (each needs approval; run from the repo root, linked to `eeqxyjrcldivtpikcpvk`):
- **P0 — read-only pre-check.** `supabase db query --linked -f scripts/permit-repo/one-permit-live-test/00-precheck.sql`. Before P1 rows 1–3 are false (migration not applied); every other row must be true. Optional backup of the project's current portal_data (local, git-ignored): `mkdir -p exports.local && supabase db query --linked "select portal_data, portal_data_hash from projects where id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd'" > exports.local/ff193644-portal-data-before.json`.
- **P1 — migration `20261111120000_permit_deep_capture.sql`.** Never `supabase db push`.
  ```bash
  { echo 'BEGIN;'; cat supabase/migrations/20261111120000_permit_deep_capture.sql; echo 'COMMIT;'; } > /tmp/20261111120000.tx.sql
  supabase db query --linked -f /tmp/20261111120000.tx.sql
  supabase migration repair --status applied 20261111120000
  supabase db query --linked -f scripts/permit-repo/one-permit-live-test/00-precheck.sql   # rows 1–3 now true
  ```
  Rollback: `supabase db query --linked -f scripts/permit-repo/rollback-20261111120000_permit_deep_capture.sql && supabase migration repair --status reverted 20261111120000` (own BEGIN/COMMIT; refuses while a deep job is active; drops captured report versions and deep state; stored objects stay in the bucket).
- **P2 — old Railway `permit-sync-worker`.** Not required for safety: after P1 its two-argument claim returns JSON jobs only (D-073, proven against a replica of its claim function) and no JSON job will be queued. Optional belt-and-braces: Railway → `permit-sync-worker` → replicas 0. Rollback: replicas 1. Do not run a manual DC scrape during the test (the deployed `Epermit-main` has no D-061 lock yet).
- **P3 — edge secret and deploy.** The secret value is never printed or put on a command line:
  ```bash
  umask 077
  printf 'PERMITPILOT_SERVICE_PIPELINE_SECRET=%s\n' "$(openssl rand -hex 32)" > .permitpilot-pipeline-secret.env.local
  git check-ignore -q .permitpilot-pipeline-secret.env.local && echo ignored        # must print "ignored" (*.local)
  supabase secrets set --env-file .permitpilot-pipeline-secret.env.local --project-ref eeqxyjrcldivtpikcpvk
  supabase functions deploy intake-pipeline-agent comment-parser-agent discipline-classifier-agent context-reference-engine auto-router-agent --project-ref eeqxyjrcldivtpikcpvk
  ```
  Before deploying, optionally compare the live source read-only (`supabase functions download <name> --project-ref eeqxyjrcldivtpikcpvk` into a temp dir and diff with `supabase/functions/<name>`); the deploy ships the local tree (HEAD) of these five functions and `_shared`. Rollback: `supabase secrets unset PERMITPILOT_SERVICE_PIPELINE_SECRET --project-ref eeqxyjrcldivtpikcpvk` (service mode off at once, user calls unaffected) and/or redeploy the previous function versions.
- **P4 — link the project.** `supabase db query --linked -f scripts/permit-repo/one-permit-live-test/01-link-project.sql` (checks ids and permit number first; inserts one `project_permits` row; cannot create a project). Rollback: `01-unlink-project-rollback.sql`.
- **P5 — queue one deep job.** `supabase db query --linked -f scripts/permit-repo/one-permit-live-test/02-request-deep-job.sql` (`only_portal_record_ids ["6364"]`, `max_files 3`, `max_bytes 20971520`). Rollback/abort: `02-cancel-deep-job.sql`.
- **P6 — supervised local run** (below). Rollback: stop the process, run `02-cancel-deep-job.sql`, then `01-unlink-project-rollback.sql`. Written rows are additive and tagged with the job id as run id.

Local headed run (this Mac, user watching; flags only in this shell):
```bash
cd scraper-service
PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright" node ../scripts/permit-repo/check-deep-worker-config.js --pipeline-secret-file ../.permitpilot-pipeline-secret.env.local
set -a; . ../.permitpilot-pipeline-secret.env.local; set +a     # omit for a run with the agent trigger off
PERMIT_SYNC_WORKER_ENABLED=true PERMIT_SYNC_LIVE_PORTAL_APPROVED=A-3 PERMIT_SYNC_MODE=deep PERMIT_SYNC_WORKER_ONCE=true \
PERMIT_SYNC_ONLY_PORTAL_RECORD_IDS=6364 PERMIT_SYNC_DEEP_MAX_FILES=3 PERMIT_SYNC_DEEP_MAX_BYTES=20971520 \
SCRAPER_HEADLESS=false PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright" \
node -r dotenv/config permit-sync/worker-entry.js 2>&1 | tee /tmp/one-permit-live.log
```
From `scraper-service/.env` (names only): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (legacy service_role JWT, D-075), `PORTAL_CREDENTIALS_ENCRYPTION_KEY`. The first log line must read `mode=deep agent_trigger=on scope=6364 max_files=3 max_bytes=20971520`. Watch: `03-watch.sql`. After exit: `04-inspect.sql`.

Expected: 28 discovered, 1 permit processed (27 out of scope), one deep pass on all tabs (the project is linked), at most 3 stored files, report versions or `failed` reports with a reason (D-074), one portal_data write to ff193644, at most one pipeline run with `pipeline.service_execution` audit rows. A second job (P5 + P6 again) must show 0 deep passes, 0 downloads, 0 agent runs, 0 changes, unless capped files are still pending (then only those download).

Where to look: Permit Queue `http://localhost:5173/permit-queue/06fa082e-b942-4b54-b448-a1527f58df41` (Files and Reports open through 300 s signed URLs), Portal Harvest `http://localhost:5173/portal-data?projectId=ff193644-3e94-46d4-a1c0-4755fc65d0dd`, Response Matrix `http://localhost:5173/response-matrix?projectId=ff193644-3e94-46d4-a1c0-4755fc65d0dd`. Start Vite with `VITE_LOCAL_PERMIT_INSPECTION=read-only npx vite --port 5173 --strictPort` and sign in as a platform admin; `04-inspect.sql` covers documents, reports, report versions, review comments, deep state, project hash, pipeline runs, parsed_comments and audit rows.

## Unified DC deep automation (2026-11-11, local only)
- Design: MASTER_PLAN §0, decisions D-055 to D-067. Nothing in this revision is committed, deployed, applied or run against the live portal.
- Phase status: R0–R5 implemented and locally tested; R6 (cron) prepared only. Details per phase in PROGRESS.md "Unified DC deep automation".
- Tests (2026-11-11, local): `cd scraper-service && PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright npm run test:permit-sync` 164/164 (inside the Cursor sandbox Chromium is not found, so DOM/pager tests fail there; run outside it); closure-touching scraper tests (arlington durability/lease/progress, scraper-cancel-boundaries) 39/39; `node --import tsx --test supabase/functions/_shared/serviceExecution.test.ts` 28/28; frontend permit tests 163/163 and `npx tsc --noEmit -p .` clean.
- New code: `scraper-service/permit-sync/deep/{app-loader,policy,repo,runner,pipeline}.js`, `scraper-service/lib/{dc-credential-lock,dc-deep-options}.js`, additive changes in `app/register-execution-routes.js` (dcDeep export, pager, 409 lock, forbidInsert/skipCredentialRepoint, deepOptions, dcReloginDisabled), `permit-sync/core/{safety,worker}.js`, `permit-sync/worker-entry.js`, `adapters/dc-projectdox/{adapter,live-transport}.js`; `supabase/functions/_shared/serviceExecution{,Deno}.ts` + wiring in 5 functions; `src/lib/permitQueue.ts`, `src/components/permits/{PermitQueueDetailView,PermitQueueGate}.tsx` + permit pages/nav/flags; migration `supabase/migrations/20261111120000_permit_deep_capture.sql`.
- Known open items: live deep pass never run (A-L1); SSRS viewer may need a POST postback that deep mode refuses (now non-fatal: reports marked `failed`, D-074); volatile fields no longer change the hash in deep syncs (D-072), so a linked project gets an agent run only when its permit content changed; `project_permits` has 0 rows in production, so no project gets portal_data or agents until an admin links one; 3 stale `running` scrape_jobs rows remain (excluded from the lock by heartbeat age); project 6daf6610 is tagged montgomery-projectdox while using the DC credential (not changed); admin export still reports `content_captured: false`.

### Approvals, in order (none granted; nothing below has been run)
1. **A-W0 — optional: scale the deployed JSON-only `permit-sync-worker` to 0.** Since D-073 it cannot claim a deep job once A-1b is applied. Railway dashboard → service `permit-sync-worker` → replicas 0 (or set `PERMIT_SYNC_WORKER_ENABLED=false`). Rollback: replicas 1.
2. **A-1b — apply migration `20261111120000_permit_deep_capture.sql`** (additive: 4 columns on permit_documents, 4 on permit_reports, tables `permit_report_contents` and `permit_deep_state`, RPCs `record_permit_document_capture`, `record_permit_report_content`, `record_permit_report_failure`, `record_permit_deep_pass`, `_permit_protected_columns` extended, one storage read policy). Never `supabase db push` (D-040). Command: see "One-permit live test", step P1 (`supabase db query --linked -f` on a BEGIN/COMMIT copy, then `supabase migration repair --status applied 20261111120000`). Rollback: `scripts/permit-repo/rollback-20261111120000_permit_deep_capture.sql`, then `supabase migration repair --status reverted 20261111120000`.
3. **A-E — edge functions.** `supabase secrets set PERMITPILOT_SERVICE_PIPELINE_SECRET=<random> --project-ref eeqxyjrcldivtpikcpvk`, then `supabase functions deploy intake-pipeline-agent comment-parser-agent discipline-classifier-agent context-reference-engine auto-router-agent --project-ref eeqxyjrcldivtpikcpvk`. Rollback: `supabase secrets unset PERMITPILOT_SERVICE_PIPELINE_SECRET --project-ref eeqxyjrcldivtpikcpvk` (mode off at once; user calls unaffected) and/or redeploy previous versions. Note: assumes the legacy JWT-style service role key.
4. **A-L1 — supervised local deep job, agent trigger off.** Superseded by "One-permit live test" (scoped, capped, `admin_request_permit_deep_sync`; `admin_request_permit_sync` now queues JSON jobs only). From `scraper-service`, with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PORTAL_CREDENTIALS_ENCRYPTION_KEY from the secret store and `PERMITPILOT_SERVICE_PIPELINE_SECRET` unset: `PERMIT_SYNC_WORKER_ENABLED=true PERMIT_SYNC_LIVE_PORTAL_APPROVED=A-3 PERMIT_SYNC_MODE=deep PERMIT_SYNC_WORKER_ONCE=true node permit-sync/worker-entry.js`, after requesting one job with `admin_request_permit_sync` as in the A-3 runs. Check `permit_sync_jobs.metrics.deep`, `stored` documents only where `download_permitted`, `permit_report_contents`, Reviews counts for BCIV2500152 and B2604437, no guard violations in `permit_sync_events`. Rollback: stop the process; written rows are additive (removable by run_id with approval).
5. **A-K — link one project** (production data write): `admin_link_project_permit(<project_id>, <permit_id>)` as a platform admin, for a project the owner confirms. Rollback: `admin_unlink_project_permit`.
6. **A-L2 — supervised deep run with agents.** Same command as A-L1 with `PERMITPILOT_SERVICE_PIPELINE_SECRET` set. Expect one portal_data write, one pipeline run, one `pipeline.service_execution` audit row for the linked project; then run again and expect 0 deep passes, 0 downloads, 0 agent runs, 0 changes. Rollback: unset the secret; `PERMIT_SYNC_MODE=json`.
7. **A-W — redeploy `permit-sync-worker` in deep mode** with `PERMIT_SYNC_MODE=deep` (and the secret once A-E is done), `PERMIT_SYNC_WORKER_ONCE` unset. Rollback: `PERMIT_SYNC_MODE=json` or replicas 0.
8. **A-F — frontend deploy** (Vercel) of the Permit Queue changes. Safe with the flag OFF (placeholder). Rollback: redeploy previous build.
9. **A-6 — turn on `module.central_permits`.** Rollback: turn it off.
10. **A-4 — daily schedule (Phase 6).** As a platform admin: `SELECT public.admin_set_permit_sync_source('<dc credential id>', 'dc-projectdox', true, <current settings jsonb>);` then `SELECT cron.schedule('permit-sync-enqueue-daily', '0 9 * * *', $$SELECT public.enqueue_permit_sync_runs();$$);` (09:00 UTC ≈ 04:00–05:00 Washington time). Rollback: `SELECT cron.unschedule('permit-sync-enqueue-daily');` and the same RPC with `false`. Pass the existing settings JSON unchanged; the RPC replaces it.
- Acceptance criteria 11 (deployed supervised run) and 12 (daily runs) can only be met after these approvals.

- Production state is unchanged by this revision: 28 permits, job `703659aa…` completed, `permit-sync-worker` deployed idle on Railway with the OLD JSON-only code (pending approval A-W: scale to 0 now, redeploy in deep mode later).

Last updated: 2026-11-11 ~04:45 UTC (admin inspection and export). **A-1 is applied to production and verified (D-041). Run 9 completed. `permit-sync-worker` is online on Railway, headless, and idle (D-051).** No schedule. 27 of 28 permits have all 7 sections ok. The 28 permits can be inspected locally, read-only, with the production flag still OFF (D-052), and an admin can export them (D-053). See "Admin inspection and export".

## Admin inspection and export (2026-11-11 ~04:45 UTC, local only)
- Production config check, read-only: pass on every item. RLS on all 17 permit tables. A platform admin reads all 28 permits and every section row. An active non-admin with no grant reads nothing. anon is refused. The admin RPCs refuse non-admins. Flag OFF. Bucket private. Details in `PROGRESS.md` "Production config check".
- Inspect locally: `VITE_LOCAL_PERMIT_INSPECTION=read-only npx vite --port 5173 --strictPort`, then open http://localhost:5173/auth, sign in with a real platform-admin account, and go to http://localhost:5173/permits. Use port 5173: on this Mac port 5000 (the Vite default in `vite.config.ts`) is taken by AirPlay Receiver. Use `localhost`, not the network address, because the override needs a loopback host. The app reads production through the anon key and RLS. Writes from the permit pages are refused while the override is on.
- `/permits/:id` tabs: Overview (seven-section status table, provenance, linked projects), then one tab per section with its status pill, provenance and data, then History and Sources. Files: metadata only, no links, "binaries were not captured". Reports: list of available portal reports, content not captured (D-054).
- Export: "Export JSON" on the detail header; "Export all DC permits (ZIP)" on the `/permits` header. Admins only. Format and verification in D-053. Re-verify any time with `node --import tsx scripts/permit-repo/verify-export.tsx` (read-only; writes to `exports.local/`, which git ignores).
- Not done: a browser click-through (needs the admin password; not guessed). No deploy, no flag change, no migration, no policy change, no commit.

## A-5 result (2026-11-11 ~04:08 UTC)
- Service `permit-sync-worker` in the PermitPilot production environment. Remote build of `scraper-service/Dockerfile` (Playwright image, Chromium already in the image). Start command `node permit-sync/worker-entry.js`. No local Docker. No commit and no push.
- Env names: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PORTAL_CREDENTIALS_ENCRYPTION_KEY` (already on `Epermit-main` in production and development; copied onto this service), `SCRAPER_HEADLESS=true`, `PERMIT_SYNC_WORKER_ENABLED=true`, `PERMIT_SYNC_LIVE_PORTAL_APPROVED=A-3`. `PERMIT_SYNC_WORKER_ONCE` is not set. No Railway cron schedule.
- The first release started `node server.js`. It was replaced. Deployment `1347f14a-6a53-431f-931b-9312faf0db44` is SUCCESS and the service is online. After that start the log is only "Starting Container": no "worker not started", no portal login, no job claimed. Active jobs 0. Last job `703659aa…` still `completed`.
- Not touched: pg_cron (still 3 jobs), `automation_enabled` (false), `module.central_permits` (off), git. A-4 and A-6 remain unapproved.

## A-3 run 9 result (2026-11-11 03:37:59–03:46:10 UTC)
- Change (D-050): in the read phase, a deny pattern still aborts the request and fails the job, for every method. On the three hosts already open for GET/HEAD, any other method is aborted and not sent, and it is not a `safety_violation`. A non-GET on another DC host still fails the job. Off-host traffic stays dropped with no violation. Login can still POST. No new host. `npm run test:permit-sync` **140/140**.
- One new job, not a retry of `50a121be…`: `admin_request_permit_sync('de8592f9…')` as admin `3d2b4632…`, job `703659aa-42e7-40c8-86b5-d4f2e5754da1`. No other worker was running and no other job was active. `automation_enabled` stayed false. Headed, exit 0, 490 s. Outcome `completed`. `login_ok`, `api_session_ok`. The `/cdn-cgi/rum` POST did not stop the job.
- Dashboard total 28, discovered 28, extracted 28, failed 0. Sections: files, info, reports, tasks and workflows 28 ok. Status and reviews 27 ok and 1 absent, both on `TL2600008`. 27 of 28 permits have all 7 sections ok.
- DB after the run: 28 permits (0 duplicate groups), 28 links, 196 section states, 196 snapshots, 3135 changes, 29 workflows, 14 tasks, 66 folders, 140 reports, 2283 documents. 2 sources, 8 jobs. Cron 3, flag OFF, automation false. A-5, A-4 and A-6 untouched. Log `/tmp/a3-run9.log`.

## A-3 run 8 result (2026-11-11 03:29:13–03:30:33 UTC)
- Change (D-049): the D-048 GET/HEAD rule now also covers exactly `washington-dc-us-projectdoxwebapi.avolvecloud.com`. No other Avolve host. Deny patterns, POST and other writes, downloads, and export still fail the job. Login not changed. `npm run test:permit-sync` **139/139**.
- One new job, not a retry of `64ff4b4d…`: `admin_request_permit_sync('de8592f9…')` as admin `3d2b4632…`, job `50a121be-5dc2-4548-9e86-443f5c3520e9`. No other worker was running and no other job was active. `automation_enabled` stayed false. Headed, exit 0, 80 s. `login_ok`, `api_session_ok`.
- Dashboard total 28, discovered 28, extracted 0, failed 0. No section ran. The `/User/GetSessionTimeout` stop from run 7 did not recur.
- Stop: `failed_unrecoverable` / `safety_violation`, `method: POST session.planreview.dob.dc.gov/cdn-cgi/rum`. That host is already open for GET and HEAD. The request is a POST, which stays refused. No second run and no further guard change.
- DB after the run, same as after run 7 except the new job: 28 permits (0 duplicate groups), 28 links, 7 section states, 7 snapshots, 38 changes, 1 workflow, 1 task, 2 folders, 5 reports, 0 documents. 1 of 28 permits has all 7 sections ok. 2 sources, 7 jobs. Cron 3, flag OFF, automation false. A-5, A-4 and A-6 untouched. Log `/tmp/a3-run8.log`.

## A-3 run 7 result (2026-11-11 03:21:16–03:23:00 UTC)
- Change (D-048): `evaluateRequest` allows GET and HEAD on exactly `planreview.dob.dc.gov` and `session.planreview.dob.dc.gov` when the path is not a named route. Deny patterns still match first and still fail the job. Named routes, the file-body download check, and the three API hosts are unchanged. POST, PUT, PATCH and DELETE stay denied. No host added. Login not changed. `routeReadRequest` enforces this through `checkRequest`. `npm run test:permit-sync` **137/137**.
- One new job, not a retry of `e1132fea…`: `admin_request_permit_sync('de8592f9…')` as admin `3d2b4632…`, job `64ff4b4d-9bb4-44f2-9087-e635a65cd8a8`. No other worker was running and no other job was active. `automation_enabled` stayed false. Headed, exit 0, 103 s. `login_ok`, `api_session_ok`.
- Dashboard total 28, discovered 28, extracted 0, failed 0. No section ran.
- Stop: `failed_unrecoverable` / `safety_violation`, `not_allowlisted: GET washington-dc-us-projectdoxwebapi.avolvecloud.com/User/GetSessionTimeout`. Not a deny pattern and not a 401. That host was left on named routes on purpose. No second run and no further guard change.
- DB after the run, same as after run 6 except the new job: 28 permits (0 duplicate groups), 28 links, 7 section states, 7 snapshots, 38 changes, 1 workflow, 1 task, 2 folders, 5 reports, 0 documents. 1 of 28 permits has all 7 sections ok. 2 sources, 6 jobs. Cron 3, flag OFF, automation false. A-5, A-4 and A-6 untouched. Log `/tmp/a3-run7.log`.

## A-3 run 6 result (2026-11-11 03:10:44–03:12:24 UTC)
- Cause of the run 5 401 (D-047): the manual scrape sends `Sessionid` plus the browser's cookies, `Origin`, `Referer` and `X-Requested-With`; the worker sent only `Sessionid` and `Accept` through `context.request`. `getJson` and `fetchPartial` now use the project page's own `fetch` (`credentials: "include"`, `Sessionid`, `X-Requested-With`). No guard, host or classifier change. `npm run test:permit-sync` **135/135**.
- One headed run of the existing job (attempt 2; no new job, none cancelled; no other worker was running). Exit 0, 99 s. `login_ok`, `api_session_ok`, no 401.
- Dashboard total 28, discovered 28, extracted 1 (`9187`), failed 0, 27 not started. All 7 sections for `9187` ok (status, tasks, workflows, reviews, files, info, reports; 0 absent, partial, failed or suspect-empty).
- Stop reason: `failed_unrecoverable` / `safety_violation`: "portal request refused (not_allowlisted: GET `session.planreview.dob.dc.gov/Project/ProjectStatus?projectID=9187&wflowInstanceID=&timeStamp=*`)". Not a route in `routes.js` and not named in `register-execution-routes.js`, so probably a request from the project page's own script, caught by the read guard. Nothing was changed.
- DB after the run: 28 permits (no duplicate groups; same 28), 28 links, 7 section states, 7 snapshots, 38 changes (+10), 1 workflow, 1 task, 2 folders, 5 reports, 0 documents. 2 sources, 5 jobs. Cron 3, automation false. Production flag not touched. A-5, A-4 and A-6 untouched. Log `/tmp/a3-run6.log`.

## A-3 run 5 result (2026-11-11 03:03:30–03:05:15 UTC)
- Change (D-046): `login()` in `live-transport.js` is a port of `performLogin` (`app/register-execution-routes.js`), not a call to it (not exported, inside the HTTP app module). Same sequence, selectors and waits. Removed: the classify-and-branch loop that aborted on an unknown page, the Avolve-only callback wait, and the login-phase host/method allowlist. Kept: DC deny-pattern tripwire in the login phase, MFA/CAPTCHA/refused-credentials stops, one password entry, the whole read phase. `npm run test:permit-sync` **131/131**.
- One job after a read-only check of zero active DC jobs: `admin_request_permit_sync('de8592f9…')` as admin `3d2b4632…`, job `e1132fea-d57b-41fa-9494-411a6b8b34e4`. `automation_enabled` stayed false. Headed, exit code 0, 102.6 s.
- Login trace (host and path only): `landed` at B2C authorize → `b2c` at `dcra.okta.com/oauth2/default/v1/authorize` → `username` (state `login_form`, so the password field appeared after Next; one Next) → `password` at `planreview.dob.dc.gov/Home/SSOLanding` → `wait` at `planreview.dob.dc.gov/` (authenticated) → `login_ok` → `api_session_ok`. Password submitted once. Blocked navigations 0. No MFA, no CAPTCHA. The Avolve callback was passed inside the browser's own redirect chain, so the 30 s wait was not needed this time.
- Discovery: dashboard "of N" total 28, discovered 28, `discovery_complete` true.
- Then `portal API answered 401`: `failed` / `session_ended`, retryable, so the job is `retry_wait`, attempt 1 of 3 (not terminal). The 401 came on the first per-permit call. By adapter order that is `workflow_instances_list` on the Avolve ProjectDox web API with the `Sessionid` header from `Globals.Session.SessionID`. The job did not record the route, so this is inferred. Likely causes: the session id taken from the popup is not accepted by the API from `context.request`, the id is for a different session, or the API needs another header or cookie. Not investigated: no second run and no further change.
- Extracted: 0 permits with sections, 0 sections, 0 snapshots. `permits_ok` 0, `permits_failed` 0, sections `{}`. No guard violation.
- DB writes (production): 28 `permits`, 28 `permit_source_links`, 28 `permit_changes` (the discovery "created" rows), 1 job, 3 events (`enqueued`, `claimed`, `finished` as `retry_wait`). Totals: 2 sources, 5 jobs, 15 events, 28 permits, 28 links, 28 changes, 0 sections, 0 snapshots. Cron 3, flag OFF, `automation_enabled` false. No credential or other source row touched. Log `/tmp/a3-run5.log`.
- Open job: `e1132fea…` is `retry_wait`. A worker started later would re-claim it after the 300 s back-off and log in again. No worker runs anywhere (A-5 not done). To close it: `admin_cancel_permit_sync_job('e1132fea-d57b-41fa-9494-411a6b8b34e4')` as an admin. Not done here. While it is open, `admin_request_permit_sync` for the same source returns this same job id instead of queuing a new one (one active job per source), so the next supervised run would re-claim this job (attempt 2 of 3) once its back-off ends.
- Rollback if the 28 discovery rows must go: the owner purge under "Supervised run plan". Nothing else changed.

## A-3 run 4 result (2026-11-11 02:51:12–02:51:37 UTC)
- Approved change, no new host: if the login loop is on `avolvecspiam-as-authmiddleware.azurewebsites.net` with path `/Auth2/SsoCallback` and the page has no form fields, wait up to 30 seconds for a redirect. No click and no typing during the wait. A guard block during the wait stops the job and records method and host. Any other unknown page still fails immediately. The two D-044 host rules were not changed. `npm run test:permit-sync` **132/132**.
- One job, after a read-only check of zero active DC jobs: `admin_request_permit_sync('de8592f9…')` as admin `3d2b4632…`, job `1610408d-929f-4139-a219-ab093810a2ef`. `automation_enabled` stayed false.
- Headed worker, exit code 0, job 23.4 s, `failed_unrecoverable` / `portal_changed`. Trace: step 1 `washingtondcb2cprod.b2clogin.com/…/oauth2/v2.0/authorize` (blocked 0) → step 2 `dcra.okta.com/oauth2/default/v1/authorize`, state unknown (blocked 0). No `sso_callback_wait` line. `last_error`: "no password field".
- That error is the existing username-then-password branch: the username field was filled, the password field was not there, submit was clicked once, and after the settle the password field was still absent. The password was not typed. No MFA, CAPTCHA, or blocked host. The callback wait did not run, so there is no redirect host to report.
- Not reached: dashboard, discovery, sections. Metrics: discovered 0, expected_total null, permits_ok 0, sections empty.
- Writes: 1 job, 3 events (`enqueued`, `claimed`, `finished`). Totals: 2 sources, 4 jobs, 12 events. 0 permits, links, sections, snapshots, changes. Cron 3, flag OFF, source `automation_enabled` false. Log `/tmp/a3-run4.log`. No second run.


## A-3 run 3 result (2026-11-11 02:40:24–02:40:56 UTC)
- Approved steps, in order. (1) Source switch (D-044): `admin_set_permit_sync_source('de8592f9-69fc-4c71-8544-cb22bbbd5813', 'dc-projectdox', false, {"account_download": false})` as admin `3d2b4632…`. `credential_id` is the table's primary key, so this registered a second DC source row; `0610eaa5…` is unchanged. Both rows: `automation_enabled=false`, status `inactive`. (2) Login hosts (D-044): `LOGIN_EXTRA_HOSTS` in `core/safety.js`, middleware IdP-like (GET/HEAD/POST), blob GET/HEAD only, exact hostnames. `npm run test:permit-sync` **127/127** (122 + 5). (3) One job: no active DC job beforehand; `admin_request_permit_sync('de8592f9…')` as `3d2b4632…` gave job `1e4b02ec-78d1-458f-8c18-ce27f78d7366`.
- Headed worker, exit code 0, job 28.7 s, `failed_unrecoverable` / `portal_changed`, attempt 1. Trace: step 1 `washingtondcb2cprod.b2clogin.com/…/oauth2/v2.0/authorize` (organisation button clicked) → step 2 `dcra.okta.com/oauth2/default/v1/authorize` (username and password filled, submitted once) → step 3 `avolvecspiam-as-authmiddleware.azurewebsites.net/Auth2/SsoCallback`, state unknown. Blocked navigations: 0 at every step. `last_error`: "unrecognised login page at avolvecspiam-as-authmiddleware.azurewebsites.net/Auth2/SsoCallback (step 3, state unknown, password submitted)".
- No MFA, CAPTCHA or refused-credentials text was classified at Okta or after it, and there was no DC-host guard violation. Source: `consecutive_auth_failures` 0, `last_login_ok_at` null, status `inactive`.
- Not reached: dashboard total, discovery, any section. Metrics: discovered 0, expected_total null, permits_ok 0, sections empty.
- Writes: 1 source row, 1 job, 3 events (`enqueued`, `claimed`, `finished`), plus admin RPC audit rows. Totals: 2 sources, 3 jobs, 9 events. 0 permits, links, sections, snapshots or changes. After the run: `portal_credentials` 16, `projects` 88, cron 3, flag OFF. Log `/tmp/a3-run3.log` (codes only).
- What the log can say: after the Okta password POST the browser was on the middleware's `/Auth2/SsoCallback`. That page has no form fields, so the login loop classifies it as unknown and stops. `login_step` recorded `blocked: 0` at steps 1, 2 and 3. `last_error` has no "blocked during login" clause, and the three events are `enqueued`, `claimed`, `finished` with no refused host or method. So this run did not die on a named allowlist block after the password.
- Stopped here. The user watched Chromium, said the page was blocked after the credentials were entered, and said not to add more guards. No third host, no new deny rule, no new test, and no second worker. Worker and Chromium are not running. The next run is the user's decision.

## A-3 run 2 result (2026-11-11 02:21:38–02:21:51 UTC)
- Pre-check (read-only): source `0610eaa5…` exists, `automation_enabled=false`, status inactive; no active job; flag OFF; cron 3. One job was requested with `admin_request_permit_sync` only (as admin `3d2b4632…`), job `c0a4476e-321f-4ba7-80ac-a3a40ec268d6`.
- Headed run, 11.6 s, `failed_unrecoverable` / `portal_changed`. Trace: one `login_step` (step 1, state unknown, at `chrome-error://chromewebdata`, 2 blocked). `last_error`: "blocked during login: xhr avolvecspiamsa.blob.core.windows.net, document avolvecspiam-as-authmiddleware.azurewebsites.net". The password was not submitted. No DC-host guard violation, MFA or CAPTCHA.
- The user saw a blank error page in run 1, and this matches it: the dashboard's own redirect to the Avolve auth middleware is aborted by the auth policy.
- Writes: 1 job and 3 events (totals: 1 source, 2 jobs, 6 events). 0 permits, links, sections, snapshots or changes. `portal_credentials` 16, `projects` 88, cron 3, flag OFF. Rollback not needed. Log: `/tmp/a3-run2.log`.
- No code change. The fix is a guard-rule change that needs approval. Proposal in D-043: two exact-host auth-phase rules, the blob host GET/HEAD only and the middleware host IdP-like, with no Azure wildcards. Optional zero-risk check first: the user opens `https://planreview.dob.dc.gov/` logged out in their own browser and notes the hosts in the address bar.
- To implement after approval: in `live-transport.js`, add an exact-host set next to `IDP_HOSTS`, used by `evaluateAuthRequest` (and `classifyLoginPage`, so a password form on the middleware counts as `login_form`). Add tests in `tests/permit-sync-live-transport.test.js`: the exact hosts pass, while look-alikes such as `evil.azurewebsites.net` and `avolvecspiamsa.blob.core.windows.net.evil.test` and non-GET to the blob host are refused. Then run `npm run test:permit-sync`, request one job and run once.

## A-3 run 1 result (2026-11-11 02:10:56–02:11:14 UTC)
- Job `2c71f817-45c1-4c90-82c9-1f9d8ce4d30c`, source `0610eaa5…` (`automation_enabled=false`, `account_download=false`), queued by admin `3d2b4632…`. Headed, `PERMIT_SYNC_WORKER_ONCE=true`. Idle pre-check passed first.
- Outcome: `failed_unrecoverable`, `portal_changed`, "unrecognised login page", 16.5 s, attempt 1 of 3. The status is terminal, so the job will not be re-claimed.
- The key opened the envelope; A-2 is not needed. No MFA/CAPTCHA was classified. No guard violation was recorded. Nothing past login ran: dashboard total, discovery and sections were not reached.
- Production writes: `permit_sync_sources` 1, `permit_sync_jobs` 1, `permit_sync_events` 3 (`enqueued`, `claimed`, `finished`), plus the admin RPC audit rows. 0 permits, links, section rows, snapshots or changes. Existing tables, cron (3) and the flag (OFF) are unchanged. Rollback not used (nothing to purge but the source/job, which are harmless and keep the record).
- Console log `/tmp/a3-run.log` (codes only). The old code logged no URL or step, so the page could not be identified. Hypotheses and the fix are in D-042.
- Fix (local only): login errors and a per-step `login_step` console trace now name host+path, step, state, whether the password was submitted, and the auth-phase navigations the policy dropped. 122/122 tests.
- Ask the user what the Chromium window showed just before it closed (host in the address bar, and whether a password had been typed). That may settle D-042 without a second run.

### Second run (needs a new A-3 approval)
Same procedure: setup SQL (only `admin_request_permit_sync`; the source exists), then the same worker command. It verifies: which login page stops the flow (from the `login_step` trace and `last_error`); with a widened allowlist, if approved, the full login → dashboard → "of N records" → discovery → per-section extraction; the completeness checks below. If the trace shows an identity host outside `IDP_HOSTS`, adding exactly that host is a guard-rule change and needs approval before the run.

Earlier, same day: the cascade fix and the rename were done. The first A-1 dry run listed 149 other migrations (D-040). User priority: real, automated, deep DC scraping into the production database with a daily refresh. Synthetic/demo/frontend/Portal Harvest UI work and other jurisdictions are stopped. Phase 4 blocked. No Docker. The local e2e stack in `scripts/local-dc-e2e` is not evidence and stays untouched.

## A-1 attempt (2026-11-11, later session): stopped at the dry run
Done offline:
- Cascade fix (D-039, approved): in `20261111100100_permit_sync_queue.sql`, events can be deleted only by the cascade from deleting their credential or source; jobs only in a cascade after their source is gone. UPDATE and TRUNCATE are blocked; permit evidence is unchanged.
- Rename (D-040, approved): `20261111100000_central_permit_repository.sql`, `20261111100100_permit_sync_queue.sql`, `20261111100200_central_permits_ui.sql`. Test helpers, the chain test and the docs are updated.
- Tests: `npm run test:permit-sync` (Chromium path set, outside the sandbox) 119/119; frontend `centralPermits.test.ts` plus `components/permits/*.test.tsx` 27/27.

Production (read-only):
- The Supabase CLI is now logged into the owning account and linked to `eeqxyjrcldivtpikcpvk`. `supabase db query --linked` works through the Management API with no DB password.
- `supabase db push --dry-run` refused: "Found local migration files to be inserted before the last migration on remote database". It lists 149 migrations (`20260112060817` … `20261031040000`) for `--include-all`. Production history has 21 rows, head `20261106140000`. Spot checks show those 149 migrations are applied but were never recorded (D-040). Nothing was applied. Never use `--include-all`.
- Baseline at 2026-11-11 02:01 UTC: `portal_credentials` 16 rows, `projects` 88. No permit tables, no `permit-documents` bucket, no `module.central_permits` row. The only `permit*` object is the pre-existing `permit_filings`, which our files do not touch. pg_cron 1.6.4, pg_net 0.19.5, pgcrypto and vector are installed. Cron: 3 active jobs (`process-scheduled-notifications`, `process-drip-emails`, `supabase-code-analyzer-processor`).
- Worker `startupCheck` with `PERMIT_SYNC_WORKER_ENABLED=true PERMIT_SYNC_LIVE_PORTAL_APPROVED=A-3` and `scraper-service/.env`: `{ok: true}`, Supabase host `eeqxyjrcldivtpikcpvk`, 32-byte key. `startupCheck` checks env presence only. The decrypt check against `0610eaa5…` runs when a job is claimed, before a browser starts (D-037). It was not run because no RPCs exist yet.

### A-1 apply procedure (needs the user's choice of option, D-040)
Recommended, option (a). Each step needs an approval, and it all goes through the Management API, so no password is needed:
```bash
cd /path/to/Epermit-main   # repo root; linked to eeqxyjrcldivtpikcpvk
for f in 20261111100000_central_permit_repository 20261111100100_permit_sync_queue 20261111100200_central_permits_ui; do
  supabase db query --linked -f supabase/migrations/$f.sql || break
done
supabase migration repair --status applied 20261111100000 20261111100100 20261111100200
supabase migration list --linked | tail -4     # the three versions show in both columns
```
Each file is additive and re-runnable (`IF NOT EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT`), so re-running one after a partial failure is safe. Stop on the first error and report it. Whether `db query -f` wraps a multi-statement file in one transaction is unverified. If it does not, a failure can leave the earlier statements of that file applied, so re-run the same file before moving on.
Verify (read-only, `supabase db query --linked`):
```sql
select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and (relname like 'permit\_%' or relname='project_permits') and relname <> 'permit_filings' order by 1;  -- 17 rows, all true
select proname, proacl from pg_proc where pronamespace='public'::regnamespace
 and proname in ('admin_set_permit_sync_source','admin_request_permit_sync','admin_cancel_permit_sync_job','admin_resume_permit_sync_source','claim_permit_sync_job','apply_permit_sync_batch','search_permits');  -- no anon/PUBLIC EXECUTE
select key, enabled from feature_flags where key='module.central_permits';  -- one row, false
select id, public from storage.buckets where id='permit-documents';         -- public = false
select count(*) from cron.job;                                               -- still 3
select (select count(*) from portal_credentials) pc, (select count(*) from projects) pr;  -- 16, 88 unless the app changed them
```

## A-3 readiness audit (2026-11-11)
Nothing was run live, migrated, deployed, re-encrypted or scheduled. Production was read with GET requests only.

Access used: `scraper-service/.env` service-role key (production `eeqxyjrcldivtpikcpvk`, "InsightDC") over PostgREST; `railway` CLI (project PermitPilot, logged in). Not available: SQL access to production (no DB password locally; the Supabase CLI account lists only two other projects), so `supabase_migrations.schema_migrations` and the `cron` schema could not be read.

Findings:
- DC credentials: 2 rows, same login. `0610eaa5-8584-48c5-b802-668f8506bd74` encrypted envelope, owner `3d2b4632-e3a3-4417-8a84-549cedbb6739` (admin), created 2026-07-10, no project. `de8592f9-69fc-4c71-8544-cb22bbbd5813` plaintext, owner `f1f84c83-36f6-4664-b34b-614b2881f09d` (super_admin), created 2026-02-12, 10 projects, last legacy check 2026-07-27. Table has no `updated_at`. Recommended source: `0610eaa5…` (D-035).
- Migrations: none of the three permit migrations is applied (no permit tables, RPCs or `module.central_permits` row). `20261106140000_admin_analyzer_ai_usage.sql` is applied, so rename before `db push` (D-038).
- pg_cron / pg_net: not readable directly. Indirect: the cron-driven Supabase Analyzer processor exists and its jobs complete (latest 2026-11-05), and pg_cron/pg_net are created by an early migration. Existing cron jobs could not be listed.
- Key: `PORTAL_CREDENTIALS_ENCRYPTION_KEY` is set on Railway `Epermit-main` (production and development) and in `scraper-service/.env`; both are 32 bytes and identical (in-process hash equality; values not printed). Whether this key opens the `0610eaa5…` envelope is unknown without decrypting; the worker checks it before opening a browser (D-037), so the first A-3 step tests it with no portal contact.
- Railway production services: `Epermit-main` (HTTP; latest deploy awaiting approval for 5 days, unrelated), `code-analyzer-worker`, `document-ingestion-worker`. No permit-sync service. No Railway cron schedules.
- Staging: none. Every environment points at production (D-036).
- Defect: deleting the source credential fails after its first job (append-only events, cascade). Must be fixed in the queue migration before A-1 (see "Open questions").
- Login: the live transport ports the legacy `performLogin` selectors (`register-execution-routes.js`); it does not call that file, because the worker must not load the HTTP app (D-025). The legacy login worked without an MFA step until at least 2026-07-27, which suggests no MFA then; not proof for today.

### A-3 supervised session checklist (only after A-1 is applied and verified; user present throughout)
1. Pre-check, no portal contact: run the worker command below with no job queued. It must print no job line and exit 0. That proves the RPCs answer with the service-role key.
2. Setup SQL below (SQL editor, as an admin: `3d2b4632-e3a3-4417-8a84-549cedbb6739` owns `0610eaa5…`). Note the job id it returns. `automation_enabled` stays false.
3. Tell the user the window is starting. Run the worker command below (headed). Chromium opens on this Mac.
4. If the key cannot open the `0610eaa5…` envelope, the job fails as `auth_failed` before any browser opens. Stop there; the fix is A-2 (re-save the password through the app).
5. Watch with the two queries under "Watch". Abort with the cancel RPC, or close Chromium and then cancel. MFA or CAPTCHA puts the job in `waiting_user`; no code is entered.
6. When the worker exits, check "Completeness" and record the outcome, metrics and any refused paths in `PROGRESS.md`. Do not run a second job without a new approval.
7. Nothing else in this session: no cron (A-4), no Railway service (A-5), no flag change (A-6), `automation_enabled` stays false.

### Supervised run plan (needs A-1 first, then A-3)
Setup, in the Supabase SQL editor as the approving admin (writes; part of the A-3 approval):
```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<approving admin user id>', 'role', 'authenticated')::text, true);
select admin_set_permit_sync_source('0610eaa5-8584-48c5-b802-668f8506bd74', 'dc-projectdox', false, '{"account_download": false}'::jsonb);
select admin_request_permit_sync('0610eaa5-8584-48c5-b802-668f8506bd74');
commit;
```
`automation_enabled` stays false, so `enqueue_permit_sync_runs` never picks the source; an admin may still run it manually.

Run, on this Mac, headed Chromium, user watching (flags only in this shell, never in `.env` or Railway):
```bash
cd scraper-service
PERMIT_SYNC_WORKER_ENABLED=true PERMIT_SYNC_LIVE_PORTAL_APPROVED=A-3 PERMIT_SYNC_WORKER_ONCE=true \
SCRAPER_HEADLESS=false PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright" \
node -r dotenv/config permit-sync/worker-entry.js
```
Required from `.env` (names only): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PORTAL_CREDENTIALS_ENCRYPTION_KEY`. Run it once before the setup SQL: with no job queued it must print one idle result and exit (checks the RPCs exist, no portal contact).

Built-in guards: read-only allowlist and deny list on every browser request, every API call and every click; 1.5 s between portal requests; one password submission; no Log Out; no downloads (`acceptDownloads: false`, DC always skipped, `RetrieveFile` needs `allowDownloads`); one active job per source. Stops: any guard violation (`failed_unrecoverable`, refused path recorded), `SessionEnded`/401/403, HTTP 429, refused login, MFA or CAPTCHA (`waiting_user`; the browser closes, no code is entered; the user decides the next step).
Manual abort: `select admin_cancel_permit_sync_job('<job id>')` (same claims preamble); the worker stops at its next heartbeat, after the current permit. Immediate stop: close the Chromium window or press Ctrl-C twice, then cancel the job so it is not reclaimed.
Watch: `select status, error_code, last_error, metrics from permit_sync_jobs order by created_at desc limit 1;` and `select level, code, message, created_at from permit_sync_events where job_id = '<job id>' order by id;`.
Duration: about 10–20 min (login and SSO about 1–2 min, about 10 throttled reads per permit, 28 permits on 2026-11-05).
Writes (production, new tables only): `permit_sync_sources` (1), `permit_sync_jobs` (1), `permit_sync_events`, `permits`, `permit_source_links`, `permit_section_state`, `permit_workflows`, `permit_tasks`, `permit_document_folders`, `permit_documents` (metadata), `permit_review_comments`, `permit_review_responses`, `permit_reports`, `permit_snapshots`, `permit_changes`; plus `platform_audit_events` rows from the admin RPCs. No storage objects. No existing table is changed.
Completeness: `metrics.discovery_complete = true` and `metrics.discovered = metrics.expected_total`; `expected_total` must equal the "of N records" label in the headed dashboard (N may no longer be 28); `select count(*) from permit_source_links where credential_id = '0610eaa5-…'` = N; spot checks for 11854 per the Priority 3 checklist; a second run (separate approval) writes 0 changes.
Rollback (owner only, in one transaction; append-only guard lifted only inside it, D-020):
```sql
begin;
set local permit_repo.allow_evidence_purge = on;
delete from permit_changes   where permit_id in (select id from permits where adapter_key = 'dc-projectdox');
delete from permit_snapshots where permit_id in (select id from permits where adapter_key = 'dc-projectdox');
delete from permits where adapter_key = 'dc-projectdox';
delete from permit_sync_jobs where credential_id = '0610eaa5-8584-48c5-b802-668f8506bd74';
delete from permit_sync_sources where credential_id = '0610eaa5-8584-48c5-b802-668f8506bd74';
commit;
```
Audit rows stay. Schema stays (D-009).

Known unknowns the first run will hit (each fails closed and records the refused request): requests the dashboard or the `Project/Index` page make on their own (for example `AddUpdateEntityMetadata`, keep-alives, CORS preflights), OIDC callback paths other than the three allowed, `Frame.aspx` launchRemote links, whether one SessionID covers every project, whether `context.request` carries the session cookies, MFA, session lifetime. If page-initiated requests stop the run, the decision is whether to block-and-log page-initiated requests while still aborting on adapter-initiated ones; that needs the user's approval because it changes the "any violation aborts" rule.

## Current state
- Branch `feat/central-permit-repository`. Nothing committed. Phase 0 complete (`PHASE0_REPORT.md`). Phase 1 locally tested (`PHASE1_REPORT.md`). Phase 2 locally tested against fixtures (`PHASE2_REPORT.md`); `live-transport.js` is Implemented only and refuses to run without `PERMIT_SYNC_LIVE_PORTAL_APPROVED=A-3`.
- Nothing deployed. The three permit migrations are applied to production `eeqxyjrcldivtpikcpvk` and recorded in its history (2026-11-11, D-041); no other hosted project has them. No credentials rotated. One automated login attempt was made (A-3 run 1, 2026-11-11). It stopped before the dashboard (D-042).
- Local browser test (this machine only, no Docker): `scripts/local-dc-e2e/start-local.sh` brings up Postgres, PostgREST, a loopback auth gateway and Vite at http://127.0.0.1:8090. Data is the redacted DC fixture plus synthetic projects. `module.central_permits` is ON in that local database only. Restart with the same script; `--reset` rebuilds it. Stop with `scripts/local-dc-e2e/stop-local.sh`.
- Unrelated modified files under `eval/drawing-dataset/` belong to the user. Do not touch or commit them.
- Chrome still has ProjectDox tabs from Phase 0; the user's active tab is something else. Do not switch tabs without telling them.

## How to run the tests
`cd scraper-service && PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright" npm run test:permit-sync`, outside the sandbox (119 tests including 21 Chromium DOM tests, ~35 s). `node tests/helpers/replay-migrations.js` replays the full migration chain on PGlite. Set `PERMIT_REPO_MIGRATION` / `PERMIT_QUEUE_MIGRATION=/path/to.sql` to test a modified copy (used for mutation tests).
Baselines before Phase 1: scraper-service `npm test` 158/159 (`analyze-drawing` prompt wording), code-analyzer-worker `npm test` 75/76 ("local permit sample"). Both still the same after Phase 2.

Phase 3 implemented (`PHASE3_REPORT.md`): `/permits`, `/permits/:id`, `/admin/permit-sync` behind `module.central_permits` (seeded OFF). Frontend tests: `node --import tsx --test src/lib/centralPermits.test.ts src/components/permits/PermitRepositoryViews.test.tsx src/lib/featureFlags.test.ts src/lib/moduleFeatureFlags.test.ts` (80 pass). `src/lib/supabaseAnalyzer/stage3EvidenceV2.test.ts` is modified in the tree but not by this work; leave it.

## DC completion milestone (2026-11-06: complete offline)
- Requirements: `DC_DEEP_EXTRACTION_REQUIREMENTS.md` (U-1 to U-5 and U-7 closed with live evidence; U-6 open until A-3).
- Live, supervised, read-only (user's Chrome session, in-page GETs, no portal actions, no export, no login): report viewer opened once for 11854; corrections JSON, report list, task list, raw partials and reports read for 11854 / 28933 / 9187.
- Findings that changed code: Reviews HTML partial is a template shell, so Reviews read `GetProjectCorrectionsByCycleInstance` (D-031); session id is `Globals.Session.SessionID`; task list is `{Tasks[]}`.
- Implemented and locally tested: `normalize.correctionRowsFromJson`, `reportListItems`, task field mapping; `dom-extract.extractReviewCommentsReport`; routes `project_corrections_json` and `report_list` (allowlisted); adapter JSON-primary / report-fallback; fixture transport models the verified contract.
- Tests: `npm run test:permit-sync` 94 pass in the sandbox (DOM file excluded). Chromium DOM tests (21) need `PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright"` outside the sandbox.
- Fixtures added: `corrections-json-11975.json`, `report-list-11854.json`, `active-tasks-9187.json`, `html/11854-review-comments-report.html` (all redacted and scanned).
- Deployed: no. Production-verified: no. Live worker: not run.

## Later session, 2026-11-06 ~02:00
- The DC live-evidence work above (00:33–00:45) was done in a separate session. This session re-verified it offline (tests, PII scan, guard checks, cross-checks against its own 2026-11-05 captures). It did not re-observe the portal: Chrome's window was off-screen.
- Priority 2 done: `PORTAL_HARVEST_VS_REPOSITORY.md` (D-034). Priority 3 done locally: `PRIORITY3_INTEGRATION_REPORT.md` (includes the A-3 checklist and the PWA build root cause).

## R-1 (approved by the user with "approve both"; implemented locally)
- Implemented: admin link/unlink via existing audited RPCs (data layer in `src/lib/centralPermits.ts`); Portal Harvest "Permit record" panel with admin search-and-link; permit Overview "Linked projects" panel with "Open in Portal Harvest".
- Locally tested: `node --import tsx --test` on `centralPermits.test.ts`, `PermitLinkViews.test.tsx`, `PermitRepositoryViews.test.tsx`: 27/27 pass. ESLint clean on touched files. New files typecheck with zero errors (`tsc -p tsconfig.app.json`; remaining errors are pre-existing and in files this work did not change). Production `vite build` to a temp dir passes (after `npm ci`).
- Not verified: live Supabase RLS behaviour for linked projects, the flag ON in a browser, admin click-through. No migration applied, no commit, no deploy, flag OFF in production.
- Not run this round: `npm run test:permit-sync` (no scraper files changed).

## Next action
1. Done 2026-11-11: A-1 applied by route (a) and verified (D-041).
2. Done 2026-11-11: A-3 run 1. It stopped at login (D-042).
3. Done 2026-11-11: A-3 run 2. It stopped at login because two Avolve Azure hosts were blocked (D-043).
3a. Done 2026-11-11: source switched to `de8592f9…` and the two exact hosts added (D-044); A-3 run 3 stopped at the middleware SSO callback.
3b. Done 2026-11-11: 30-second wait on the exact Avolve SSO callback only (D-045). A-3 run 4 stopped earlier, on the Okta page, with "no password field". No retry.
3c. Done 2026-11-11: login replaced by a port of the manual scrape's login (D-046). A-3 run 5 logged in, discovered 28/28, then got a 401 on the first API call. Job `e1132fea…` is open in `retry_wait`.
3e. Done 2026-11-11: API session sent like the manual scrape (D-047). Run 6 got past the 401 and extracted `9187` (7/7 sections), then the guard refused GET `/Project/ProjectStatus?...`; job `e1132fea…` is `failed_unrecoverable`.
3f. Done 2026-11-11: GET and HEAD on the two DC web hosts no longer need a named route (D-048). Run 7 discovered 28/28 and extracted 0, then `not_allowlisted` on GET `/User/GetSessionTimeout` on the API host. Job `64ff4b4d…` is `failed_unrecoverable`.
3g. Done 2026-11-11: the same GET/HEAD rule now covers the one ProjectDox API host (D-049). Run 8 discovered 28/28 and extracted 0, then `safety_violation` on POST `/cdn-cgi/rum` on `session.planreview.dob.dc.gov`. Job `50a121be…` is `failed_unrecoverable`.
3h. Done 2026-11-11: non-GET page noise that is not a deny pattern no longer fails the job (D-050). Run 9 completed: 28 extracted, 0 failed, 27 of 28 with all 7 sections ok. Job `703659aa…` is `completed`.
4. Done 2026-11-11: A-5. `permit-sync-worker` is online, headless, and idle (D-051). No schedule. A-4 and A-6 are still not approved.
3d (old, resolved by D-047). Next: the user decides. The open question is the 401 on `washington-dc-us-projectdox…avolvecloud.com` with the `Sessionid` from `Globals.Session`. The manual scrape reads the same API, so compare how it sends the session (cookies from the popup context, headers). Cancel or keep the `retry_wait` job first.
4a. Done 2026-11-11: read-only production config check, local inspection override, seven-section detail page and admin export (D-052, D-053, D-054). Local only.
5. Next, only with a new approval: A-4 (pg_cron daily enqueue and `automation_enabled`), A-6 (production flag), or a frontend deploy under A-5 so the inspection UI and export reach the hosted app. None is on. R-2 and other UI work stay paused.

Still blocked on A-3 (carried from Phase 2): MFA on a fresh automated login, session lifetime under automation, dashboard XHR paths, OIDC callback paths, `Frame.aspx` launchRemote variant, one SessionID for all projects, Playwright `context.request` carrying the same cookies as the in-page fetch. Time zone and all section parsers are closed (DC milestone). Full list in `PHASE2_REPORT.md` "Gaps".

## How live portal checks work
Use the cursor-computer-use MCP against the user's existing Chrome (app scope, one call at a time, screenshot first to get a coordinate token). Open projects only through the dashboard `launchRemote` link. ReportViewer popups are separate windows and need brief screen-scope control, with the user's approval each time. Never use osascript. Do not log in again.

## Approvals required (not yet granted)
Order (2026-11-11): A-1 → A-3 → A-5 → A-4 → A-6. A-2 is only needed if the A-3 key check fails. No staging exists (D-036).
| ID | Action | Status |
|---|---|---|
| A-1 | Apply the three permit migrations (renamed, cascade fix in) to production | **Done 2026-11-11** by route (a), verified (D-041) |
| A-2 | Key/credential change | Not needed: `0610eaa5…` decrypted at claim time on 2026-11-11 |
| A-3 | First supervised live run: this Mac, production Supabase, headed, one job (credential `de8592f9…` since D-044) | Run 9 (D-050) completed: 28 discovered, 28 extracted, 0 failed. 27 of 28 have all 7 sections ok. Job `703659aa…` is `completed`. A-5, A-4 and A-6 not started |
| A-4 | `cron.schedule` a daily `select enqueue_permit_sync_runs()` and set `automation_enabled = true` on the source | After A-5 |
| A-5 | New Railway service `permit-sync-worker`: same repo and `scraper-service/Dockerfile` as `Epermit-main`, start command `node permit-sync/worker-entry.js`, env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PORTAL_CREDENTIALS_ENCRYPTION_KEY`, `PERMIT_SYNC_WORKER_ENABLED=true`, `PERMIT_SYNC_LIVE_PORTAL_APPROVED=A-3` (headless on Railway) | **Done 2026-11-11** (D-051). Online and idle. No schedule. No commit |
| A-5 (frontend) | Deploy the frontend with the D-052/D-053 pages and export | Not requested. The worker part of A-5 is done |
| A-6 | Turn on `module.central_permits` in production | Last |
| A-7 | Policy decision: DOB notification / ToS review for automated read access | Not requested |

## Open questions and findings
- Fixed 2026-11-11 (D-039): deleting the source credential after a job failed on the append-only events trigger. Now a cascade-only delete is allowed, after the parent row is gone.
- Blocks A-1 (D-040): production's migration history lacks 149 applied migrations, so `db push` cannot be used without `--include-all`, which is forbidden. Out of scope for this work, but worth a separate cleanup with the owner: repair the history after an object-by-object check.
- Ctrl-C does not stop a running job; the worker checks the abort signal only between jobs. Use the admin cancel RPC (stops at the next heartbeat).
- Fixed in Phase 2: the Phase 1 encryption check never matched real envelopes (D-024). Anyone reviewing Phase 1 SQL should use the current file.
- `20260911200000_super_admin_hierarchy.sql` fails on a fresh database when run as one transaction (D-019). Pre-existing; worth fixing separately before relying on `supabase db reset`.
- Two `portal_credentials` rows share the DC login. Only one may drive automation (D-018); the audit recommends `0610eaa5…` (D-035).
- Unverified spec item 6 in `EXTRACTION_SPEC_DC.md` (four ProjectIDs; the adapter reads them from the dashboard). Items 4 and 5 closed 2026-11-06.

## Environment notes
- No local Postgres server (only client tools); Docker daemon not running. SQL tests use PGlite (D-010, D-019).
- Frontend `src/**/*.test.ts` files are `node:test` files: run with `node --import tsx --test <files>`.
