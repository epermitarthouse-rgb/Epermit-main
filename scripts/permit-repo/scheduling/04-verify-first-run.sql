-- Read-only check of the first scheduled DC refresh (de8592f9, daily 04:00 America/New_York = 09:00 UTC in EST).
-- Run after 09:05 UTC on the run day, again while it runs, and once it has finished:
--   supabase db query --linked -f scripts/permit-repo/scheduling/04-verify-first-run.sql
-- Counts and states only: no names, usernames, file names or error text. Writes nothing.
-- Production-verified when: slot = 09:00 UTC with last_schedule_result 'created'; exactly one scheduled deep job
-- for the slot, claimed by the deep worker within minutes; it ends completed or completed_with_warnings with
-- permits_total 28; no schedule_missed alert; enqueue ticks without failures; no second job for the same login
-- ran at the same time; not_permitted documents still have no stored object; report contents only 'captured'
-- with a content row.

SELECT jsonb_build_object(
  'now', now(),
  'source', (SELECT jsonb_build_object('automation_enabled', automation_enabled, 'status', status,
               'schedule_enabled_at', schedule_enabled_at, 'last_scheduled_at', last_scheduled_at,
               'last_schedule_result', last_schedule_result, 'last_login_ok_at', last_login_ok_at,
               'next_slot', public._permit_sync_next_slot(settings -> 'schedule', now()))
             FROM public.permit_sync_sources WHERE credential_id = 'de8592f9-69fc-4c71-8544-cb22bbbd5813'),
  'scheduled_jobs_today', (SELECT coalesce(jsonb_agg(jsonb_build_object('job', left(id::text, 8), 'status', status, 'mode', worker_mode,
               'attempts', attempt_count, 'created_at', created_at, 'started_at', started_at, 'completed_at', completed_at,
               'error_code', error_code, 'metrics', metrics - 'errors') ORDER BY created_at), '[]'::jsonb)
             FROM public.permit_sync_jobs
             WHERE credential_id = 'de8592f9-69fc-4c71-8544-cb22bbbd5813' AND trigger = 'scheduled' AND created_at >= date_trunc('day', now())),
  'job_permits', (SELECT jsonb_object_agg(phase, n) FROM (
               SELECT jp.phase, count(*) AS n FROM public.permit_sync_job_permits jp JOIN public.permit_sync_jobs j ON j.id = jp.job_id
               WHERE j.credential_id = 'de8592f9-69fc-4c71-8544-cb22bbbd5813' AND j.trigger = 'scheduled' AND j.created_at >= date_trunc('day', now())
               GROUP BY jp.phase) x),
  'overlapping_running_jobs', (SELECT count(*) FROM public.permit_sync_jobs WHERE status = 'running' AND lease_expires_at >= now()),
  'workers', (SELECT jsonb_agg(jsonb_build_object('mode', mode, 'status', status, 'age_s', extract(epoch FROM now() - last_seen_at)::int,
               'job', left(current_job_id::text, 8), 'version', details ->> 'version', 'scope', details -> 'scope'))
             FROM public.permit_sync_workers WHERE last_seen_at > now() - interval '1 hour'),
  'enqueue_ticks_since_0855', (SELECT jsonb_build_object('ticks', count(*), 'failed', count(*) FILTER (WHERE d.status <> 'succeeded'))
             FROM cron.job_run_details d JOIN cron.job c ON c.jobid = d.jobid
             WHERE c.jobname = 'permit-sync-enqueue' AND d.start_time >= date_trunc('day', now()) + interval '8 hours 55 minutes'),
  'open_alerts', (SELECT coalesce(jsonb_agg(jsonb_build_object('category', category, 'severity', severity, 'occurrences', occurrences)), '[]'::jsonb)
             FROM public.permit_sync_alerts WHERE resolved_at IS NULL),
  'documents', (SELECT jsonb_object_agg(download_status, n) FROM (
               SELECT d.download_status, count(*) AS n FROM public.permit_documents d
               JOIN public.permit_source_links l ON l.permit_id = d.permit_id AND l.credential_id = 'de8592f9-69fc-4c71-8544-cb22bbbd5813'
               GROUP BY 1) x),
  'gate_not_permitted_with_object', (SELECT count(*) FROM public.permit_documents d
               JOIN public.permit_source_links l ON l.permit_id = d.permit_id AND l.credential_id = 'de8592f9-69fc-4c71-8544-cb22bbbd5813'
               WHERE d.download_status <> 'stored' AND d.storage_path IS NOT NULL),
  'reports', (SELECT jsonb_object_agg(content_status, n) FROM (
               SELECT r.content_status, count(*) AS n FROM public.permit_reports r
               JOIN public.permit_source_links l ON l.permit_id = r.permit_id AND l.credential_id = 'de8592f9-69fc-4c71-8544-cb22bbbd5813'
               WHERE r.removed_at IS NULL GROUP BY 1) x),
  'gate_captured_without_content', (SELECT count(*) FROM public.permit_reports r
               JOIN public.permit_source_links l ON l.permit_id = r.permit_id AND l.credential_id = 'de8592f9-69fc-4c71-8544-cb22bbbd5813'
               WHERE r.content_status = 'captured' AND r.latest_content_id IS NULL)
) AS first_run;
