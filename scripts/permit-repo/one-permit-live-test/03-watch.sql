-- One-permit live test: watch the job while the worker runs (read-only). Re-run as often as needed.
--   supabase db query --linked -f scripts/permit-repo/one-permit-live-test/03-watch.sql
WITH j AS (
  SELECT * FROM public.permit_sync_jobs
  WHERE credential_id = 'de8592f9-69fc-4c71-8544-cb22bbbd5813' ORDER BY created_at DESC LIMIT 1
)
SELECT json_build_object(
  'job', (SELECT json_build_object('id', id, 'status', status, 'worker_mode', worker_mode, 'attempt', attempt_count,
                                   'error_code', error_code, 'last_error', last_error, 'lease_worker', lease_worker_id,
                                   'lease_expires_at', lease_expires_at, 'metrics', metrics) FROM j),
  'events', (SELECT json_agg(json_build_object('at', e.created_at, 'level', e.level, 'code', e.code, 'message', left(e.message, 200)) ORDER BY e.id)
             FROM public.permit_sync_events e WHERE e.job_id = (SELECT id FROM j))
) AS watch;
