-- One-permit live test, step 0: read-only pre-check. Every row must show ok = true before any write.
--   supabase db query --linked -f scripts/permit-repo/one-permit-live-test/00-precheck.sql
SELECT check_name, ok, detail FROM (
  SELECT 1 AS n, 'deep capture migration recorded' AS check_name,
         EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261111120000') AS ok, NULL::text AS detail
  UNION ALL
  SELECT 2, 'worker_mode column present',
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'permit_sync_jobs' AND column_name = 'worker_mode'), NULL
  UNION ALL
  SELECT 3, 'two-argument claim returns json jobs only',
         EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'claim_permit_sync_job' AND pronamespace = 'public'::regnamespace AND prosrc LIKE '%_permit_sync_claim(p_worker_id, p_lease_ttl_seconds, ''json'')%'), NULL
  UNION ALL
  SELECT 4, 'no active permit sync job',
         NOT EXISTS (SELECT 1 FROM public.permit_sync_jobs WHERE status IN ('queued', 'running', 'retry_wait', 'waiting_user')), NULL
  UNION ALL
  SELECT 5, 'source de8592f9 not automated, runnable',
         EXISTS (SELECT 1 FROM public.permit_sync_sources WHERE credential_id = 'de8592f9-69fc-4c71-8544-cb22bbbd5813' AND automation_enabled = false AND status NOT IN ('needs_encryption', 'auth_failed', 'paused', 'waiting_user')), NULL
  UNION ALL
  SELECT 6, 'no source automated anywhere',
         NOT EXISTS (SELECT 1 FROM public.permit_sync_sources WHERE automation_enabled), NULL
  UNION ALL
  SELECT 7, 'central permit 06fa082e is BCIV2500152 / ProjectID 6364',
         EXISTS (SELECT 1 FROM public.permits WHERE id = '06fa082e-b942-4b54-b448-a1527f58df41' AND portal_record_id = '6364' AND permit_number = 'BCIV2500152'), NULL
  UNION ALL
  SELECT 8, 'project ff193644 owned by f1f84c83, same permit number',
         EXISTS (SELECT 1 FROM public.projects WHERE id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd' AND user_id = 'f1f84c83-36f6-4664-b34b-614b2881f09d' AND permit_number = 'BCIV2500152'), NULL
  UNION ALL
  SELECT 9, 'module.central_permits still OFF', NOT coalesce((SELECT enabled FROM public.feature_flags WHERE key = 'module.central_permits'), false), NULL
  UNION ALL
  SELECT 10, 'cron jobs (expect 3)', (SELECT count(*) FROM cron.job) = 3, (SELECT count(*)::text FROM cron.job)
  UNION ALL
  SELECT 11, 'project_permits rows for ff193644', true,
         (SELECT count(*)::text FROM public.project_permits WHERE project_id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd')
  UNION ALL
  SELECT 12, 'permitted files / reports for 6364', true,
         (SELECT count(*) FILTER (WHERE download_permitted)::text || ' permitted files, ' ||
                 count(*) FILTER (WHERE download_status = 'stored')::text || ' stored' FROM public.permit_documents WHERE permit_id = '06fa082e-b942-4b54-b448-a1527f58df41')
         || ', ' || (SELECT count(*)::text FROM public.permit_reports WHERE permit_id = '06fa082e-b942-4b54-b448-a1527f58df41') || ' reports'
) c ORDER BY n;
