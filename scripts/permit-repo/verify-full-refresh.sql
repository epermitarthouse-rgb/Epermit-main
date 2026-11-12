-- P3: verify the latest full (all-permit) deep refresh of the DC source from persisted data only (read-only).
--   supabase db query --linked -f scripts/permit-repo/verify-full-refresh.sql
-- Requires migration 20261113100000. Reports counts and codes only: no usernames, portal text or file names.
WITH job AS (
  SELECT j.* FROM public.permit_sync_jobs j
  WHERE j.adapter_key = 'dc-projectdox' AND j.worker_mode = 'deep' AND NOT (coalesce(j.options, '{}'::jsonb) ? 'only_portal_record_ids')
  ORDER BY j.created_at DESC LIMIT 1
), rows AS (
  SELECT r.* FROM public.permit_sync_job_permits r JOIN job ON r.job_id = job.id
), dc AS (
  SELECT p.id FROM public.permits p
  JOIN public.permit_source_links l ON l.permit_id = p.id
  JOIN job ON l.credential_id = job.credential_id
  WHERE p.removed_from_portal_at IS NULL
)
SELECT json_build_object(
  'job', (SELECT json_build_object('id', id, 'trigger', trigger, 'status', status, 'phase', phase, 'error_code', error_code,
            'attempts', attempt_count || '/' || max_attempts, 'releases', release_count, 'created_at', created_at,
            'started_at', started_at, 'completed_at', completed_at,
            'minutes', round(extract(epoch FROM coalesce(completed_at, now()) - started_at) / 60),
            'checkpoint', json_build_object('done', jsonb_array_length(coalesce(checkpoint -> 'done', '[]')),
                                            'failed', jsonb_array_length(coalesce(checkpoint -> 'failed', '[]')),
                                            'discovered', checkpoint -> 'discovered', 'discovery_complete', checkpoint -> 'discovery_complete'),
            'metrics', metrics - 'deep_trace') FROM job),
  'permit_phases', (SELECT json_object_agg(phase, n) FROM (SELECT phase, count(*) n FROM rows GROUP BY phase) x),
  'permits_in_source', (SELECT count(*) FROM dc),
  'permits_without_progress_row', (SELECT count(*) FROM dc WHERE id NOT IN (SELECT permit_id FROM rows WHERE permit_id IS NOT NULL)),
  'permits_deep_pass_this_job', (SELECT count(*) FROM public.permit_deep_state s JOIN job ON s.run_id = job.id),
  'progress_totals', (SELECT json_build_object('files_captured', sum(files_captured), 'files_total', sum(files_total),
            'files_pending', sum(files_pending), 'files_failed', sum(files_failed),
            'reports_captured', sum(reports_captured), 'reports_total', sum(reports_total), 'reports_failed', sum(reports_failed)) FROM rows),
  'documents', (SELECT json_object_agg(download_status, n) FROM (
      SELECT d.download_status, count(*) n FROM public.permit_documents d WHERE d.permit_id IN (SELECT id FROM dc) AND d.removed_at IS NULL GROUP BY 1) x),
  'documents_stored_by_this_job', (SELECT count(*) FROM public.permit_documents d JOIN job ON d.download_run_id = job.id),
  'reports', (SELECT json_object_agg(content_status, n) FROM (
      SELECT r.content_status, count(*) n FROM public.permit_reports r WHERE r.permit_id IN (SELECT id FROM dc) GROUP BY 1) x),
  'failed_permits', (SELECT json_agg(json_build_object('portal_record_id', portal_record_id, 'error_code', error_code)) FROM rows WHERE phase = 'failed'),
  'events', (SELECT json_object_agg(level || ':' || code, n) FROM (
      SELECT e.level, e.code, count(*) n FROM public.permit_sync_events e JOIN job ON e.job_id = job.id GROUP BY 1, 2) x),
  'guard_events', (SELECT count(*) FROM public.permit_sync_events e JOIN job ON e.job_id = job.id WHERE e.code ~ 'guard|violation'),
  'open_alerts', (SELECT json_agg(json_build_object('category', category, 'severity', severity, 'title', title)) FROM public.permit_sync_alerts WHERE resolved_at IS NULL),
  'other_open_jobs', (SELECT json_agg(json_build_object('id', id, 'status', status, 'trigger', trigger))
      FROM public.permit_sync_jobs WHERE status IN ('queued', 'running', 'retry_wait', 'waiting_user') AND id NOT IN (SELECT id FROM job)),
  'workers', (SELECT json_agg(json_build_object('worker', worker_id, 'status', status, 'last_seen_at', last_seen_at, 'scope', details -> 'scope', 'limits', details -> 'limits'))
      FROM public.permit_sync_workers WHERE last_seen_at > now() - interval '1 day'),
  'scheduling', json_build_object(
      'sources_with_schedule_enabled', (SELECT count(*) FROM public.permit_sync_sources WHERE automation_enabled),
      'scheduled_jobs_ever', (SELECT count(*) FROM public.permit_sync_jobs WHERE trigger = 'scheduled')),
  'agents', json_build_object(
      'pipeline_runs_since_job', (SELECT count(*) FROM public.project_pipeline_runs pr, job WHERE pr.created_at >= job.created_at))
) AS verification;
