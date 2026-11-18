-- Montgomery supervised deep run, step 4 (READ ONLY): outcome of the latest Montgomery job. Codes, counts and
-- paths only (no portal text).
--   supabase db query --linked -f scripts/permit-repo/montgomery/live-deep/04-inspect.sql
WITH j AS (
  SELECT * FROM public.permit_sync_jobs WHERE credential_id = '93857549-eb37-47cd-ad83-6701f835de66' ORDER BY created_at DESC LIMIT 1
), p AS (
  SELECT id, permit_number, portal_record_id, status_raw FROM public.permits WHERE adapter_key = 'montgomery-projectdox'
)
SELECT json_build_object(
  'job', (SELECT json_build_object('id', id, 'status', status, 'error_code', error_code, 'attempts', attempt_count, 'lease_worker', lease_worker_id,
          'permits_ok', metrics->'permits_ok', 'permits_failed', metrics->'permits_failed', 'sections', metrics->'sections', 'deep', metrics->'deep',
          'deep_warnings', metrics->'deep_warnings') FROM j),
  'permits', (SELECT json_agg(p) FROM p),
  'documents', (SELECT json_agg(json_build_object('file', d.portal_file_id, 'permitted', d.download_permitted, 'status', d.download_status,
          'access', d.capture_access_path, 'endpoint', d.capture_source_endpoint, 'rendition', d.capture_is_rendition, 'size_match', d.size_matches_portal,
          'stored', d.storage_path IS NOT NULL, 'error', left(d.download_error, 120)) ORDER BY d.portal_file_id)
          FROM public.permit_documents d JOIN p ON p.id = d.permit_id WHERE d.download_status <> 'not_requested' OR d.capture_attempts > 0),
  'documents_by_status', (SELECT json_object_agg(s, n) FROM (SELECT d.download_status AS s, count(*) AS n FROM public.permit_documents d JOIN p ON p.id = d.permit_id GROUP BY 1) x),
  'reports', (SELECT json_agg(json_build_object('key', r.report_key, 'name', r.name, 'status', r.content_status, 'error', left(r.content_error, 120),
          'excel', c.excel_storage_path IS NOT NULL, 'pdf', c.pdf_storage_path IS NOT NULL, 'structured_rows', CASE WHEN jsonb_typeof(c.structured_rows) = 'array' THEN jsonb_array_length(c.structured_rows) END)
          ORDER BY r.report_key) FROM public.permit_reports r JOIN p ON p.id = r.permit_id LEFT JOIN public.permit_report_contents c ON c.id = r.latest_content_id),
  'review_comments', (SELECT count(*) FROM public.permit_review_comments rc JOIN p ON p.id = rc.permit_id),
  'guard_events', (SELECT json_agg(json_build_object('level', e.level, 'code', e.code, 'message', left(e.message, 160)) ORDER BY e.created_at)
          FROM public.permit_sync_events e JOIN j ON j.id = e.job_id WHERE e.code IN ('guard_denied', 'safety_violation', 'method_dropped', 'deep_trace', 'reports_unavailable'))
) AS outcome;
