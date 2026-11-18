-- Montgomery supervised deep run, step 2 (PRODUCTION WRITE, needs approval): queue ONE deep job for ProjectID
-- 200100 (SIGN-1159714) only, at most 5 files and 50 MiB. Start the local worker (step 3) right after this.
-- Rollback: 02-cancel-deep-job.sql.
--   supabase db query --linked -f scripts/permit-repo/montgomery/live-deep/02-request-deep-job.sql
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', '3d2b4632-e3a3-4417-8a84-549cedbb6739', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', '3d2b4632-e3a3-4417-8a84-549cedbb6739', true);
SELECT public.admin_request_permit_deep_sync(
  '93857549-eb37-47cd-ad83-6701f835de66',
  '{"only_portal_record_ids": ["200100"], "max_files": 5, "max_bytes": 52428800}'::jsonb
) AS job_id;
COMMIT;
SELECT id, status, worker_mode, adapter_key, options, created_at FROM public.permit_sync_jobs
WHERE credential_id = '93857549-eb37-47cd-ad83-6701f835de66' ORDER BY created_at DESC LIMIT 1;
