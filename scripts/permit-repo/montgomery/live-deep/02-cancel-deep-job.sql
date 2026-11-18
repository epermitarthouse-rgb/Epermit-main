-- Rollback / abort for step 2 (PRODUCTION WRITE): cancel the active Montgomery job. A running worker stops at its
-- next heartbeat; close Chromium / Ctrl-C for an immediate stop, then run this.
--   supabase db query --linked -f scripts/permit-repo/montgomery/live-deep/02-cancel-deep-job.sql
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', '3d2b4632-e3a3-4417-8a84-549cedbb6739', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', '3d2b4632-e3a3-4417-8a84-549cedbb6739', true);
SELECT public.admin_cancel_permit_sync_job(j.id)
FROM public.permit_sync_jobs j
WHERE j.credential_id = '93857549-eb37-47cd-ad83-6701f835de66' AND j.status IN ('queued', 'running', 'retry_wait', 'waiting_user');
COMMIT;
SELECT id, status, error_code FROM public.permit_sync_jobs
WHERE credential_id = '93857549-eb37-47cd-ad83-6701f835de66' ORDER BY created_at DESC LIMIT 1;
