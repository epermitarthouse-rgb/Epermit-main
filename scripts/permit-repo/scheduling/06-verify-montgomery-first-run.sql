-- Read-only check of the first scheduled Montgomery County MD refresh (montgomery-projectdox, daily
-- 06:00 America/New_York = 11:00 UTC in EST, 10:00 UTC in EDT). Run once before enabling (baseline), after the slot
-- plus 5 minutes, while it runs, and once it has finished:
--   supabase db query --linked -f scripts/permit-repo/scheduling/06-verify-montgomery-first-run.sql
-- Counts and states only: no names, usernames, file names or error text. Writes nothing.
-- Production-verified when: last_schedule_result 'created' for the slot; exactly one scheduled deep job for the
-- source that day, claimed after any DC job of the same morning finished (never two running jobs per worker);
-- it ends completed or completed_with_warnings with permits_total 20; failed documents that were due went down
-- (the 9 from 2026-11-18) and none was retried before its capture_next_attempt_at; no schedule_missed,
-- queued_unclaimed or job_stuck alert for it; the DC job of the same day is unaffected; central processing of its
-- permits draws on budget 'montgomery' only.

SELECT jsonb_build_object(
  'now', now(),
  'sources', (SELECT jsonb_agg(jsonb_build_object('source', left(s.credential_id::text, 8), 'automation_enabled', s.automation_enabled,
               'status', s.status, 'visible_to_all', s.visible_to_all, 'schedule', s.settings -> 'schedule',
               'max_attempts', s.settings -> 'max_attempts', 'central_budget_scope', s.settings ->> 'central_budget_scope',
               'schedule_enabled_at', s.schedule_enabled_at, 'last_scheduled_at', s.last_scheduled_at,
               'last_schedule_result', s.last_schedule_result, 'last_login_ok_at', s.last_login_ok_at,
               'credential_encrypted', public._permit_credential_is_encrypted(c.portal_password),
               'next_slot', public._permit_sync_next_slot(s.settings -> 'schedule', now())) ORDER BY s.credential_id)
             FROM public.permit_sync_sources s JOIN public.portal_credentials c ON c.id = s.credential_id
             WHERE s.adapter_key = 'montgomery-projectdox'),
  'scheduled_jobs_today', (SELECT coalesce(jsonb_agg(jsonb_build_object('job', left(j.id::text, 8), 'adapter', j.adapter_key, 'status', j.status,
               'mode', j.worker_mode, 'attempts', j.attempt_count, 'created_at', j.created_at, 'started_at', j.started_at,
               'completed_at', j.completed_at, 'error_code', j.error_code, 'worker', left(j.lease_worker_id, 12),
               'metrics', j.metrics - 'errors') ORDER BY j.created_at), '[]'::jsonb)
             FROM public.permit_sync_jobs j
             WHERE j.trigger = 'scheduled' AND j.created_at >= date_trunc('day', now())),
  'running_now', (SELECT jsonb_agg(jsonb_build_object('job', left(id::text, 8), 'adapter', adapter_key, 'worker', left(lease_worker_id, 12)))
             FROM public.permit_sync_jobs WHERE status = 'running' AND lease_expires_at >= now()),
  'job_permits', (SELECT jsonb_object_agg(phase, n) FROM (
               SELECT jp.phase, count(*) AS n FROM public.permit_sync_job_permits jp JOIN public.permit_sync_jobs j ON j.id = jp.job_id
               WHERE j.adapter_key = 'montgomery-projectdox' AND j.trigger = 'scheduled' AND j.created_at >= date_trunc('day', now())
               GROUP BY jp.phase) x),
  'workers', (SELECT jsonb_agg(jsonb_build_object('mode', mode, 'status', status, 'age_s', extract(epoch FROM now() - last_seen_at)::int,
               'job', left(current_job_id::text, 8), 'version', details ->> 'version', 'scope', details -> 'scope'))
             FROM public.permit_sync_workers WHERE last_seen_at > now() - interval '1 hour'),
  'documents', (SELECT jsonb_object_agg(download_status, n) FROM (
               SELECT d.download_status, count(*) AS n FROM public.permit_documents d JOIN public.permits p ON p.id = d.permit_id
               WHERE p.adapter_key = 'montgomery-projectdox' AND d.removed_at IS NULL GROUP BY 1) x),
  'failed_documents', (SELECT jsonb_build_object(
               'due', count(*) FILTER (WHERE d.capture_attempts < 5 AND (d.capture_next_attempt_at IS NULL OR d.capture_next_attempt_at <= now())),
               'backoff', count(*) FILTER (WHERE d.capture_attempts < 5 AND d.capture_next_attempt_at > now()),
               'exhausted', count(*) FILTER (WHERE d.capture_attempts >= 5))
             FROM public.permit_documents d JOIN public.permits p ON p.id = d.permit_id
             WHERE p.adapter_key = 'montgomery-projectdox' AND d.removed_at IS NULL AND d.download_status = 'failed'),
  'gate_not_stored_with_object', (SELECT count(*) FROM public.permit_documents d JOIN public.permits p ON p.id = d.permit_id
               WHERE p.adapter_key = 'montgomery-projectdox' AND d.download_status <> 'stored' AND d.storage_path IS NOT NULL),
  'reports', (SELECT jsonb_object_agg(content_status, n) FROM (
               SELECT r.content_status, count(*) AS n FROM public.permit_reports r JOIN public.permits p ON p.id = r.permit_id
               WHERE p.adapter_key = 'montgomery-projectdox' AND r.removed_at IS NULL GROUP BY 1) x),
  'central', (SELECT jsonb_object_agg(status, n) FROM (
               SELECT ps.status, count(*) AS n FROM public.permit_comment_processing_state ps JOIN public.permits p ON p.id = ps.permit_id
               WHERE p.adapter_key = 'montgomery-projectdox' GROUP BY 1) x),
  'budget', (SELECT public.permit_ai_budget_status('montgomery')),
  'open_alerts', (SELECT coalesce(jsonb_agg(jsonb_build_object('category', category, 'severity', severity, 'occurrences', occurrences,
               'key', split_part(alert_key, ':', 1))), '[]'::jsonb)
             FROM public.permit_sync_alerts WHERE resolved_at IS NULL)
) AS montgomery_first_run;
