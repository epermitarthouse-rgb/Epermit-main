-- One-permit live test: results after the run (read-only). Permit 06fa082e (BCIV2500152, ProjectID 6364),
-- project ff193644, owner f1f84c83.
--   supabase db query --linked -f scripts/permit-repo/one-permit-live-test/04-inspect.sql
SELECT json_build_object(
  'documents', (SELECT json_object_agg(download_status, n) FROM (
      SELECT download_status, count(*) AS n FROM public.permit_documents
      WHERE permit_id = '06fa082e-b942-4b54-b448-a1527f58df41' GROUP BY download_status) d),
  'stored_files', (SELECT json_agg(json_build_object('file_id', portal_file_id, 'folder', folder_name, 'path', storage_path,
                                                     'bytes', stored_size_bytes, 'sha256', left(sha256, 12), 'run', download_run_id))
                   FROM public.permit_documents
                   WHERE permit_id = '06fa082e-b942-4b54-b448-a1527f58df41' AND download_status IN ('stored', 'failed')),
  'reports', (SELECT json_agg(json_build_object('key', report_key, 'status', content_status, 'error', left(content_error, 160),
                                                'captured_at', content_captured_at) ORDER BY report_key)
              FROM public.permit_reports WHERE permit_id = '06fa082e-b942-4b54-b448-a1527f58df41'),
  'report_versions', (SELECT json_agg(json_build_object('key', report_key, 'version', version, 'pdf', pdf_storage_path,
                                                        'excel', excel_storage_path, 'text_chars', length(text_content),
                                                        'rows', CASE WHEN jsonb_typeof(structured_rows) = 'array' THEN jsonb_array_length(structured_rows) ELSE 0 END) ORDER BY report_key, version)
                      FROM public.permit_report_contents WHERE permit_id = '06fa082e-b942-4b54-b448-a1527f58df41'),
  'review_comments', (SELECT count(*) FROM public.permit_review_comments WHERE permit_id = '06fa082e-b942-4b54-b448-a1527f58df41' AND removed_at IS NULL),
  'deep_state', (SELECT json_build_object('run', run_id, 'completed_at', completed_at) FROM public.permit_deep_state
                 WHERE permit_id = '06fa082e-b942-4b54-b448-a1527f58df41'),
  'project', (SELECT json_build_object('hash', left(portal_data_hash, 16), 'last_checked_at', last_checked_at,
                                       'sync_permit', portal_data #>> '{permitRepositorySync,permit_id}',
                                       'tabs', (SELECT json_agg(k) FROM jsonb_object_keys(coalesce(portal_data -> 'tabs', '{}'::jsonb)) k))
              FROM public.projects WHERE id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd'),
  'projects_total', (SELECT count(*) FROM public.projects),
  'projects_with_permit_number', (SELECT count(*) FROM public.projects WHERE permit_number = 'BCIV2500152'),
  'pipeline_runs', (SELECT json_agg(json_build_object('id', id, 'status', status, 'stage', current_stage, 'hash', left(portal_data_hash, 16),
                                                      'key', left(idempotency_key, 24), 'error', left(error_message, 160),
                                                      'started', started_at, 'completed', completed_at) ORDER BY created_at DESC)
                    FROM public.project_pipeline_runs WHERE project_id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd'),
  'parsed_comments', (SELECT json_object_agg(coalesce(ingest_source, 'null'), n) FROM (
      SELECT ingest_source, count(*) AS n FROM public.parsed_comments
      WHERE project_id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd' GROUP BY ingest_source) p),
  'service_execution_audit', (SELECT json_agg(json_build_object('at', created_at, 'action', action, 'result', result,
                                                                'function', after_json ->> 'function', 'reason', after_json ->> 'reason') ORDER BY created_at)
                              FROM public.platform_audit_events
                              WHERE action LIKE 'pipeline.service_execution%' AND target_id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd'),
  -- Guard refusals: report pre-check denials (guard_denied events: method, host, path) and job-ending violations
  -- (permit_sync_jobs.error_code / last_error; the URL in last_error is already redacted to ids).
  'guard_events', (SELECT json_agg(json_build_object('job', left(e.job_id::text, 8), 'at', e.created_at, 'code', e.code,
                                                     'method', e.data ->> 'method', 'host', e.data ->> 'host', 'path', e.data ->> 'path',
                                                     'rule', e.data ->> 'rule', 'report_key', e.data ->> 'report_key') ORDER BY e.id)
                   FROM public.permit_sync_events e JOIN public.permit_sync_jobs j ON j.id = e.job_id
                   WHERE j.credential_id = 'de8592f9-69fc-4c71-8544-cb22bbbd5813' AND j.worker_mode = 'deep'
                     AND (e.code IN ('guard_denied', 'safety_violation') OR e.code ILIKE '%violation%' OR e.message ILIKE '%refused%'
                          OR e.data ->> 'error_code' = 'safety_violation')),
  'deep_jobs', (SELECT json_agg(json_build_object('job', id, 'status', status, 'error_code', error_code, 'last_error', left(last_error, 300),
                                                  'created_at', created_at, 'completed_at', completed_at,
                                                  'deep', metrics -> 'deep', 'changes', metrics -> 'changes') ORDER BY created_at)
                FROM public.permit_sync_jobs
                WHERE credential_id = 'de8592f9-69fc-4c71-8544-cb22bbbd5813' AND worker_mode = 'deep')
) AS inspect;
