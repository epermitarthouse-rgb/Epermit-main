-- Full-capture live test, step 2 (PRODUCTION WRITE, needs approval): queue ONE deep job for ProjectID 6364 only
-- with real caps: 72 files, 600 MiB per job (the permit totals 517.5 MiB on the portal). The per-file limit
-- comes from the worker env (PERMIT_SYNC_DEEP_MAX_FILE_BYTES, default 200 MiB). If the project-wide storage
-- upload limit is still 50 MB, add "max_file_bytes": 52428800 so the 4 files of 80-82 MB are recorded
-- deferred_oversize instead of failing. Only a worker started with PERMIT_SYNC_MODE=deep can claim it (D-073).
-- Run it again after the first job finishes for the zero-change rerun.
-- Rollback: 02-cancel-deep-job.sql.
--   supabase db query --linked -f scripts/permit-repo/one-permit-live-test/12-request-full-deep-job.sql
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', '3d2b4632-e3a3-4417-8a84-549cedbb6739', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', '3d2b4632-e3a3-4417-8a84-549cedbb6739', true);
SELECT public.admin_request_permit_deep_sync(
  'de8592f9-69fc-4c71-8544-cb22bbbd5813',
  '{"only_portal_record_ids": ["6364"], "max_files": 72, "max_bytes": 629145600}'::jsonb
) AS job_id;
COMMIT;
SELECT id, status, worker_mode, options, created_at FROM public.permit_sync_jobs
WHERE credential_id = 'de8592f9-69fc-4c71-8544-cb22bbbd5813' ORDER BY created_at DESC LIMIT 1;
