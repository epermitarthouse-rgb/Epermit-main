-- Rollback for 20261117120000: restores permit_sync_monitor() as defined in 20261113100000 (no comment-pipeline
-- alerts). Open comment_pipeline alerts resolve on the next monitor tick. Then remove the migration record:
--   supabase migration repair --status reverted 20261117120000

CREATE OR REPLACE FUNCTION public.permit_sync_monitor()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_keys TEXT[] := ARRAY[]::text[];
  v_raised INTEGER := 0;
  v_resolved INTEGER := 0;
  v_a RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('permit_sync_monitor'));
  FOR v_a IN
    WITH jobs AS (
      SELECT j.*, c.jurisdiction FROM public.permit_sync_jobs j JOIN public.portal_credentials c ON c.id = j.credential_id
    ), live_workers AS (
      SELECT count(*) AS n FROM public.permit_sync_workers w
      WHERE w.mode = 'deep' AND w.status <> 'stopped' AND w.last_seen_at > v_now - interval '5 minutes'
    ), finished AS (
      SELECT j.*, row_number() OVER (PARTITION BY j.credential_id ORDER BY j.completed_at DESC) AS rn
      FROM jobs j WHERE j.completed_at IS NOT NULL AND j.status IN ('completed', 'completed_with_warnings', 'failed', 'failed_unrecoverable')
    ), full_runs AS (
      SELECT j.*, row_number() OVER (PARTITION BY j.credential_id ORDER BY j.completed_at DESC) AS rn
      FROM jobs j WHERE j.status IN ('completed', 'completed_with_warnings') AND public._permit_sync_job_scope(j.options) IS NULL
        AND (j.metrics ->> 'discovered') IS NOT NULL
    ), recent_permit_rows AS (
      SELECT x.permit_id, x.phase, row_number() OVER (PARTITION BY x.permit_id ORDER BY x.finished_at DESC) AS rn
      FROM public.permit_sync_job_permits x
      WHERE x.permit_id IS NOT NULL AND x.finished_at > v_now - interval '7 days' AND x.phase IN ('completed', 'completed_with_warnings', 'failed')
    )
    -- worker offline: deep work is due (or a schedule is on) and no deep worker reported in 5 minutes
    SELECT 'worker_offline:deep' AS key, 'worker_offline' AS category, 'critical' AS severity, NULL::uuid AS credential_id, NULL::uuid AS job_id, NULL::uuid AS permit_id,
           'No deep permit-sync worker is reporting' AS title,
           'No deep worker heartbeat in the last 5 minutes while deep work is due or a schedule is enabled.' AS detail, '{}'::jsonb AS data
    WHERE (SELECT n FROM live_workers) = 0
      AND (EXISTS (SELECT 1 FROM jobs j WHERE j.worker_mode = 'deep' AND j.status IN ('queued', 'retry_wait') AND j.next_attempt_at < v_now - interval '5 minutes')
           OR EXISTS (SELECT 1 FROM public.permit_sync_sources s WHERE s.automation_enabled AND s.status = 'active'))
    UNION ALL
    -- stuck job: running with an expired lease, or no heartbeat for 15 minutes
    SELECT 'job_stuck:' || j.id, 'job_stuck', 'critical', j.credential_id, j.id, NULL,
           'Permit sync job is not making progress',
           format('Job %s (%s) is running but its lease %s.', left(j.id::text, 8), j.jurisdiction,
                  CASE WHEN j.lease_expires_at < v_now THEN 'expired at ' || to_char(j.lease_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
                       ELSE 'has not been renewed for 15 minutes' END), jsonb_build_object('phase', j.phase)
    FROM jobs j
    WHERE j.status = 'running' AND (j.lease_expires_at < v_now - interval '2 minutes' OR j.lease_heartbeat_at < v_now - interval '15 minutes')
    UNION ALL
    -- queued but never claimed (while not legitimately waiting behind a running job on the same login)
    SELECT 'queued_unclaimed:' || j.id, 'queued_unclaimed', 'warning', j.credential_id, j.id, NULL,
           'Permit sync job queued but not claimed',
           format('Job %s (%s, %s) has been due since %s UTC and no worker has claimed it.', left(j.id::text, 8), j.jurisdiction, j.trigger,
                  to_char(j.next_attempt_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')), '{}'::jsonb
    FROM jobs j
    JOIN public.permit_sync_sources s ON s.credential_id = j.credential_id
    WHERE j.status IN ('queued', 'retry_wait') AND j.next_attempt_at < v_now - interval '15 minutes'
      AND s.status NOT IN ('needs_encryption', 'auth_failed', 'paused', 'waiting_user')
      AND NOT EXISTS (SELECT 1 FROM public.permit_sync_jobs k WHERE k.credential_id = j.credential_id AND k.id <> j.id AND k.status = 'running')
    UNION ALL
    -- login failures and sources waiting for the user
    SELECT 'login_failure:' || s.credential_id, 'login_failure', CASE WHEN s.status = 'auth_failed' THEN 'critical' ELSE 'warning' END, s.credential_id, NULL, NULL,
           CASE WHEN s.status = 'waiting_user' THEN 'Portal login needs the user (MFA or CAPTCHA)' ELSE 'Portal login is failing' END,
           format('%s source: status %s, %s consecutive login failure(s).', c.jurisdiction, s.status, s.consecutive_auth_failures), '{}'::jsonb
    FROM public.permit_sync_sources s JOIN public.portal_credentials c ON c.id = s.credential_id
    WHERE s.status IN ('auth_failed', 'waiting_user') OR s.consecutive_auth_failures >= 1
    UNION ALL
    -- portal layout / API change, or a guard refusal, in the last 24 hours
    SELECT DISTINCT ON (j.credential_id, cat) cat || ':' || j.credential_id, cat, 'critical', j.credential_id, j.id, NULL,
           CASE cat WHEN 'portal_changed' THEN 'Portal response not recognised' ELSE 'Read-only guard refused a request' END,
           format('%s: job %s ended with %s.', j.jurisdiction, left(j.id::text, 8), j.error_code), '{}'::jsonb
    FROM (SELECT j.*, CASE j.error_code WHEN 'portal_changed' THEN 'portal_changed' ELSE 'guard_violation' END AS cat FROM jobs j
          WHERE j.completed_at > v_now - interval '24 hours' AND j.error_code IN ('portal_changed', 'safety_violation')) j
    UNION ALL
    SELECT 'guard_denied:' || j.credential_id, 'guard_violation', 'warning', j.credential_id, max(j.id::text)::uuid, NULL,
           'Read-only guard refused report requests',
           format('%s: %s guard refusal(s) in the last 24 hours; the run continued without them.', min(j.jurisdiction), count(*)), '{}'::jsonb
    FROM public.permit_sync_events e JOIN jobs j ON j.id = e.job_id
    WHERE e.code = 'guard_denied' AND e.created_at > v_now - interval '24 hours'
    GROUP BY j.credential_id
    UNION ALL
    -- retries exhausted (other terminal failures than login, portal change and guard)
    SELECT 'retry_exhausted:' || j.id, 'retry_exhausted', 'critical', j.credential_id, j.id, NULL,
           'Permit sync job failed after its retries',
           format('%s: job %s ended %s (%s) after %s attempt(s).', j.jurisdiction, left(j.id::text, 8), j.status, coalesce(j.error_code, 'error'), j.attempt_count), '{}'::jsonb
    FROM jobs j
    WHERE j.completed_at > v_now - interval '24 hours' AND j.status IN ('failed', 'failed_unrecoverable')
      AND coalesce(j.error_code, '') NOT IN ('portal_changed', 'safety_violation', 'auth_failed')
    UNION ALL
    -- excessive failures in the latest finished run of a source
    SELECT 'excessive_failures:' || f.credential_id, 'excessive_failures', 'warning', f.credential_id, f.id, NULL,
           'Many permits, files or reports failed in the last run',
           format('%s: job %s: %s permit(s), %s file(s), %s report(s) failed.', f.jurisdiction, left(f.id::text, 8),
                  coalesce(f.metrics ->> 'permits_failed', '0'), coalesce(f.metrics -> 'deep' ->> 'files_failed', '0'), coalesce(f.metrics -> 'deep' ->> 'reports_failed', '0')), '{}'::jsonb
    FROM finished f
    WHERE f.rn = 1 AND f.completed_at > v_now - interval '48 hours'
      AND (coalesce((f.metrics ->> 'permits_failed')::int, 0) >= 3
           OR coalesce((f.metrics -> 'deep' ->> 'files_failed')::int, 0) >= 10
           OR coalesce((f.metrics -> 'deep' ->> 'reports_failed')::int, 0) >= 5)
    UNION ALL
    -- persistent partial capture: a permit's last three finished rows (7 days) all partial or failed
    SELECT 'persistent_partial:' || x.permit_id, 'persistent_partial', 'warning', NULL, NULL, x.permit_id,
           'Permit keeps finishing with outstanding items',
           format('Permit %s: the last 3 refreshes ended with outstanding files or reports.', coalesce(p.permit_number, p.portal_record_id)), '{}'::jsonb
    FROM (SELECT permit_id FROM recent_permit_rows WHERE rn <= 3 GROUP BY permit_id
          HAVING count(*) = 3 AND bool_and(phase <> 'completed')) x
    JOIN public.permits p ON p.id = x.permit_id
    UNION ALL
    -- no successful refresh in 36 hours for a scheduled source
    SELECT 'no_recent_success:' || s.credential_id, 'no_recent_success', 'warning', s.credential_id, NULL, NULL,
           'No successful refresh recently',
           format('%s: no completed run since %s.', c.jurisdiction,
                  coalesce(to_char((SELECT max(j.completed_at) FROM public.permit_sync_jobs j WHERE j.credential_id = s.credential_id
                                    AND j.status IN ('completed', 'completed_with_warnings')) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', 'the schedule was enabled')), '{}'::jsonb
    FROM public.permit_sync_sources s JOIN public.portal_credentials c ON c.id = s.credential_id
    WHERE s.automation_enabled AND s.schedule_enabled_at < v_now - interval '36 hours'
      AND NOT EXISTS (SELECT 1 FROM public.permit_sync_jobs j WHERE j.credential_id = s.credential_id
                      AND j.status IN ('completed', 'completed_with_warnings') AND j.completed_at > v_now - interval '36 hours')
    UNION ALL
    -- discovery count dropped between the last two all-permit runs
    SELECT 'discovery_drop:' || a.credential_id, 'discovery_drop', 'warning', a.credential_id, a.id, NULL,
           'Fewer permits discovered than in the previous run',
           format('%s: %s permit(s) discovered, %s in the previous full run.', a.jurisdiction, a.metrics ->> 'discovered', b.metrics ->> 'discovered'), '{}'::jsonb
    FROM full_runs a JOIN full_runs b ON b.credential_id = a.credential_id AND b.rn = 2
    WHERE a.rn = 1 AND (a.metrics ->> 'discovered')::int < (b.metrics ->> 'discovered')::int
      AND ((b.metrics ->> 'discovered')::int - (a.metrics ->> 'discovered')::int >= 3
           OR (a.metrics ->> 'discovered')::int < 0.9 * (b.metrics ->> 'discovered')::int)
    UNION ALL
    -- schedule due for over an hour but not enqueued (the enqueue cron job is missing or failing)
    SELECT 'schedule_missed:' || s.credential_id, 'schedule_missed', 'warning', s.credential_id, NULL, NULL,
           'Scheduled refresh was not enqueued',
           format('%s: the run scheduled for %s UTC was not enqueued.', c.jurisdiction,
                  to_char(public._permit_sync_due_slot(s.settings -> 'schedule', s.last_scheduled_at, s.schedule_enabled_at, v_now) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')), '{}'::jsonb
    FROM public.permit_sync_sources s JOIN public.portal_credentials c ON c.id = s.credential_id
    WHERE s.automation_enabled AND s.status = 'active'
      AND public._permit_sync_due_slot(s.settings -> 'schedule', s.last_scheduled_at, s.schedule_enabled_at, v_now) < v_now - interval '1 hour'
    UNION ALL
    -- missing deep content: a deep run finished without any deep pass, or a permit marked fully captured
    -- still has files or reports open that existed before that refresh
    SELECT 'missing_deep_content:' || f.id, 'missing_deep_content', 'warning', f.credential_id, f.id, NULL,
           'Deep run finished without a deep pass',
           format('%s: job %s processed %s permit(s) but recorded no deep pass.', f.jurisdiction, left(f.id::text, 8), coalesce(f.metrics ->> 'permits_ok', '0')), '{}'::jsonb
    FROM finished f
    WHERE f.rn = 1 AND f.worker_mode = 'deep' AND f.status IN ('completed', 'completed_with_warnings')
      AND coalesce((f.metrics ->> 'permits_ok')::int, 0) > 0
      AND coalesce((f.metrics -> 'deep' ->> 'deep_passes')::int, 0) + coalesce((f.metrics -> 'deep' ->> 'deep_skipped')::int, 0) = 0
    UNION ALL
    SELECT 'missing_deep_content:permit:' || x.permit_id, 'missing_deep_content', 'warning', NULL, x.job_id, x.permit_id,
           'Permit marked complete has open files or reports',
           format('Permit %s: marked complete, but %s file(s) and %s report(s) seen before that refresh are not captured.',
                  coalesce(p.permit_number, p.portal_record_id), x.open_docs, x.open_reports), '{}'::jsonb
    FROM (
      SELECT r.permit_id, r.job_id,
        (SELECT count(*) FROM public.permit_documents d WHERE d.permit_id = r.permit_id AND d.removed_at IS NULL
           AND d.download_permitted IS TRUE AND d.download_status IN ('not_requested', 'pending', 'failed') AND d.created_at < r.started_at) AS open_docs,
        (SELECT count(*) FROM public.permit_reports pr WHERE pr.permit_id = r.permit_id AND pr.removed_at IS NULL
           AND pr.content_status <> 'captured' AND pr.created_at < r.started_at) AS open_reports
      FROM (SELECT DISTINCT ON (x.permit_id) x.* FROM public.permit_sync_job_permits x
            WHERE x.permit_id IS NOT NULL AND x.finished_at IS NOT NULL AND x.phase IN ('completed', 'completed_with_warnings', 'failed')
            ORDER BY x.permit_id, x.finished_at DESC) r
      WHERE r.phase = 'completed'
    ) x JOIN public.permits p ON p.id = x.permit_id
    WHERE x.open_docs + x.open_reports > 0
  LOOP
    v_keys := v_keys || v_a.key;
    INSERT INTO public.permit_sync_alerts AS a (alert_key, category, severity, credential_id, job_id, permit_id, title, detail, data)
    VALUES (v_a.key, v_a.category, v_a.severity, v_a.credential_id, v_a.job_id, v_a.permit_id, v_a.title, v_a.detail, v_a.data)
    ON CONFLICT (alert_key) WHERE resolved_at IS NULL DO UPDATE SET
      severity = EXCLUDED.severity, job_id = coalesce(EXCLUDED.job_id, a.job_id), title = EXCLUDED.title, detail = EXCLUDED.detail,
      data = EXCLUDED.data, occurrences = a.occurrences + 1, last_seen_at = v_now;
    v_raised := v_raised + 1;
  END LOOP;

  UPDATE public.permit_sync_alerts SET resolved_at = v_now
  WHERE resolved_at IS NULL AND NOT (alert_key = ANY (v_keys));
  GET DIAGNOSTICS v_resolved = ROW_COUNT;
  RETURN jsonb_build_object('open', v_raised, 'resolved', v_resolved, 'checked_at', v_now);
END;
$$;

REVOKE ALL ON FUNCTION public.permit_sync_monitor() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.permit_sync_monitor() TO service_role;
