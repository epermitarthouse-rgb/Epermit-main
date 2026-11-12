-- Full-capture live test (D-080..D-087), step 0: read-only pre-check. Rows 1-4 are false before the migration
-- 20261112100000 is applied and true after; every other "ok" row must be true before any write.
--   supabase db query --linked -f scripts/permit-repo/one-permit-live-test/10-precheck-capture-retry.sql
SELECT check_name, ok, detail FROM (
  SELECT 1 AS n, 'capture retry migration recorded' AS check_name,
         EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261112100000') AS ok, NULL::text AS detail
  UNION ALL
  SELECT 2, 'permit_documents capture columns present',
         (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'permit_documents'
            AND column_name IN ('capture_attempts', 'capture_next_attempt_at', 'capture_access_path', 'capture_source_endpoint', 'capture_is_rendition', 'size_matches_portal')) = 6, NULL
  UNION ALL
  SELECT 3, 'record_permit_document_capture_v2 present, service_role only',
         EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'record_permit_document_capture_v2' AND pronamespace = 'public'::regnamespace)
         AND NOT coalesce(has_function_privilege('authenticated', 'public.record_permit_document_capture_v2(uuid, jsonb)', 'EXECUTE'), false), NULL
  UNION ALL
  SELECT 4, 'download_status accepts deferred_oversize',
         EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'permit_documents_download_status_check' AND pg_get_constraintdef(oid) LIKE '%deferred_oversize%'), NULL
  UNION ALL
  SELECT 5, 'deep capture migration 20261111120000 recorded',
         EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261111120000'), NULL
  UNION ALL
  SELECT 6, 'two-argument claim returns json jobs only (old Railway worker cannot take a deep job)',
         EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'claim_permit_sync_job' AND pronamespace = 'public'::regnamespace AND prosrc LIKE '%_permit_sync_claim(p_worker_id, p_lease_ttl_seconds, ''json'')%'), NULL
  UNION ALL
  SELECT 7, 'no active permit sync job',
         NOT EXISTS (SELECT 1 FROM public.permit_sync_jobs WHERE status IN ('queued', 'running', 'retry_wait', 'waiting_user')), NULL
  UNION ALL
  SELECT 8, 'no source automated anywhere', NOT EXISTS (SELECT 1 FROM public.permit_sync_sources WHERE automation_enabled), NULL
  UNION ALL
  SELECT 9, 'module.central_permits still OFF', NOT coalesce((SELECT enabled FROM public.feature_flags WHERE key = 'module.central_permits'), false), NULL
  UNION ALL
  SELECT 10, 'cron jobs (expect 3)', (SELECT count(*) FROM cron.job) = 3, (SELECT count(*)::text FROM cron.job)
  UNION ALL
  SELECT 11, 'project ff193644 linked to permit 06fa082e',
         EXISTS (SELECT 1 FROM public.project_permits WHERE project_id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd' AND permit_id = '06fa082e-b942-4b54-b448-a1527f58df41'), NULL
  UNION ALL
  SELECT 12, 'files for 6364 by status / permitted', true,
         (SELECT string_agg(k || ' ' || n, ', ' ORDER BY k) FROM (
            SELECT download_status || '/' || coalesce(download_permitted::text, 'null') AS k, count(*)::text AS n
            FROM public.permit_documents WHERE permit_id = '06fa082e-b942-4b54-b448-a1527f58df41' AND removed_at IS NULL GROUP BY 1) s)
  UNION ALL
  SELECT 13, 'portal sizes for 6364: total MiB / largest MiB / files over 50 MB', true,
         (SELECT round(sum(size_bytes) / 1048576.0, 1)::text || ' / ' || round(max(size_bytes) / 1048576.0, 1)::text || ' / ' || count(*) FILTER (WHERE size_bytes > 50000000)::text
            FROM public.permit_documents WHERE permit_id = '06fa082e-b942-4b54-b448-a1527f58df41' AND removed_at IS NULL)
  UNION ALL
  -- The project-wide upload limit is not readable here (dashboard: Storage > Settings). A null bucket limit means
  -- the global limit applies; the Supabase default is 50 MB, below the 4 files of 80-82 MB.
  SELECT 14, 'permit-documents bucket: private, file_size_limit (null = global limit)',
         EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'permit-documents' AND public = false),
         (SELECT coalesce(file_size_limit::text, 'null') FROM storage.buckets WHERE id = 'permit-documents')
  UNION ALL
  SELECT 15, 'largest object already in permit-documents (bytes)', true,
         (SELECT coalesce(max((metadata ->> 'size')::bigint), 0)::text FROM storage.objects WHERE bucket_id = 'permit-documents')
  UNION ALL
  SELECT 16, 'reports for 6364 by content status', true,
         (SELECT string_agg(k || ' ' || n, ', ' ORDER BY k) FROM (
            SELECT coalesce(content_status, 'null') AS k, count(*)::text AS n
            FROM public.permit_reports WHERE permit_id = '06fa082e-b942-4b54-b448-a1527f58df41' AND removed_at IS NULL GROUP BY 1) s)
) c ORDER BY n;
