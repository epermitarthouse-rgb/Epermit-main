-- Rollback for supabase/migrations/20261113100000_permit_sync_orchestration.sql (production approval required).
-- Restores the schema exactly as 20261112100000_permit_capture_retry.sql left it (verified by
-- scraper-service/tests/permit-repo-chain.test.js). The three replaced functions at the end are verbatim
-- copies from 20261111100100 (_permit_sync_enqueue, enqueue_permit_sync_runs) and 20261111120000
-- (_permit_sync_claim). Run in one transaction:
--   supabase db query --linked -f scripts/permit-repo/rollback-20261113100000_permit_sync_orchestration.sql
--   supabase migration repair --status reverted 20261113100000
-- Refuses while any permit sync job is active. Drops per-permit progress, worker heartbeats, alerts and the
-- schedule bookkeeping columns; jobs, events, permits and captured content are kept. Unschedule the
-- permit-sync cron jobs first if they were created (scripts/permit-repo/scheduling/disable-all.sql).

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.permit_sync_jobs WHERE status IN ('queued', 'running', 'retry_wait', 'waiting_user')) THEN
    RAISE EXCEPTION 'cancel the active permit sync jobs first (admin_cancel_permit_sync_job)';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS permit_sync_jobs_status_progress ON public.permit_sync_jobs;

DROP FUNCTION IF EXISTS public.admin_permit_sync_scheduler_status();
DROP FUNCTION IF EXISTS public.invoke_permit_sync_alert_notifier();
DROP FUNCTION IF EXISTS public.mark_permit_sync_alerts_notified(uuid[], text);
DROP FUNCTION IF EXISTS public.permit_sync_monitor();
DROP FUNCTION IF EXISTS public.permit_sync_worker_heartbeat(text, text, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.get_permit_sync_job_progress(uuid);
DROP FUNCTION IF EXISTS public.get_permit_sync_overview();
DROP FUNCTION IF EXISTS public._permit_sync_job_summary(public.permit_sync_jobs);
DROP FUNCTION IF EXISTS public.get_permit_sync_progress(uuid[]);
DROP FUNCTION IF EXISTS public._permit_sync_job_status_progress();
DROP FUNCTION IF EXISTS public.report_permit_sync_progress(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.release_permit_sync_job(uuid, text, text, jsonb, integer);
DROP FUNCTION IF EXISTS public.admin_set_permit_sync_schedule(uuid, boolean, jsonb, jsonb, integer);
DROP FUNCTION IF EXISTS public.admin_retry_permit_sync_job(uuid);
DROP FUNCTION IF EXISTS public.cancel_permit_sync_job(uuid);
DROP FUNCTION IF EXISTS public.request_permit_refresh(uuid);
DROP FUNCTION IF EXISTS public.request_permit_sync_refresh(uuid, uuid[]);
DROP FUNCTION IF EXISTS public._permit_sync_can_manage(uuid, uuid);
DROP FUNCTION IF EXISTS public._permit_sync_request(uuid, text[], text, uuid);
DROP FUNCTION IF EXISTS public._permit_sync_seed_progress(uuid, uuid, text, text[]);
DROP FUNCTION IF EXISTS public._permit_sync_next_slot(jsonb, timestamptz);
DROP FUNCTION IF EXISTS public._permit_sync_due_slot(jsonb, timestamptz, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public._permit_sync_slot(jsonb, date);
DROP FUNCTION IF EXISTS public._permit_sync_validate_settings(jsonb);
DROP FUNCTION IF EXISTS public._permit_sync_with_scope(jsonb, text[]);
DROP FUNCTION IF EXISTS public._permit_sync_job_scope(jsonb);
DROP FUNCTION IF EXISTS public._permit_sync_merge_scope(text[], text[]);
DROP FUNCTION IF EXISTS public._permit_sync_terminal_phase(text);

DROP TABLE IF EXISTS public.permit_sync_alerts;
DROP TABLE IF EXISTS public.permit_sync_workers;
DROP TABLE IF EXISTS public.permit_sync_job_permits;

CREATE UNIQUE INDEX IF NOT EXISTS uq_permit_sync_jobs_one_active
  ON public.permit_sync_jobs (credential_id)
  WHERE status IN ('queued', 'running', 'retry_wait', 'waiting_user');
DROP INDEX IF EXISTS public.uq_permit_sync_jobs_one_inflight;
DROP INDEX IF EXISTS public.uq_permit_sync_jobs_one_queued;

ALTER TABLE public.permit_sync_sources DROP COLUMN IF EXISTS last_schedule_result;
ALTER TABLE public.permit_sync_sources DROP COLUMN IF EXISTS last_scheduled_at;
ALTER TABLE public.permit_sync_sources DROP COLUMN IF EXISTS schedule_enabled_at;
ALTER TABLE public.permit_sync_jobs DROP CONSTRAINT IF EXISTS permit_sync_jobs_phase_check;
ALTER TABLE public.permit_sync_jobs DROP COLUMN IF EXISTS coalescible;
ALTER TABLE public.permit_sync_jobs DROP COLUMN IF EXISTS release_count;
ALTER TABLE public.permit_sync_jobs DROP COLUMN IF EXISTS progress;
ALTER TABLE public.permit_sync_jobs DROP COLUMN IF EXISTS phase;

CREATE OR REPLACE FUNCTION public._permit_sync_enqueue(p_credential_id UUID, p_trigger TEXT, p_requested_by UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.permit_sync_sources%ROWTYPE;
  v_id UUID;
BEGIN
  SELECT * INTO v_source FROM public.permit_sync_sources WHERE credential_id = p_credential_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no permit sync source for credential' USING ERRCODE = 'P0002';
  END IF;
  IF v_source.status IN ('needs_encryption', 'auth_failed', 'paused', 'waiting_user') THEN
    RAISE EXCEPTION 'source status % does not allow runs', v_source.status USING ERRCODE = '22023';
  END IF;
  IF p_trigger = 'scheduled' AND NOT v_source.automation_enabled THEN
    RAISE EXCEPTION 'automation is disabled for this source' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_id FROM public.permit_sync_jobs
  WHERE credential_id = p_credential_id AND status IN ('queued', 'running', 'retry_wait', 'waiting_user');
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.permit_sync_jobs (credential_id, adapter_key, trigger, requested_by)
  VALUES (p_credential_id, v_source.adapter_key, p_trigger, p_requested_by)
  RETURNING id INTO v_id;
  INSERT INTO public.permit_sync_events (job_id, level, code, message)
  VALUES (v_id, 'info', 'enqueued', p_trigger);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_permit_sync_runs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cred UUID;
  v_n INTEGER := 0;
BEGIN
  FOR v_cred IN
    SELECT s.credential_id FROM public.permit_sync_sources s
    WHERE s.automation_enabled AND s.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM public.permit_sync_jobs j
                      WHERE j.credential_id = s.credential_id
                        AND j.status IN ('queued', 'running', 'retry_wait', 'waiting_user'))
  LOOP
    PERFORM public._permit_sync_enqueue(v_cred, 'scheduled', NULL);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public._permit_sync_claim(p_worker_id TEXT, p_lease_ttl_seconds INTEGER, p_worker_mode TEXT)
RETURNS public.permit_sync_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.permit_sync_jobs;
  v_ttl INTEGER := GREATEST(60, COALESCE(p_lease_ttl_seconds, 300));
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'worker_id required' USING ERRCODE = '22023';
  END IF;
  IF p_worker_mode IS NULL OR p_worker_mode NOT IN ('json', 'deep') THEN
    RAISE EXCEPTION 'unknown worker mode' USING ERRCODE = '22023';
  END IF;

  UPDATE public.permit_sync_jobs j
  SET status = 'failed', error_code = 'lease_expired', completed_at = now(),
      last_error = coalesce(j.last_error, 'worker lease expired after final attempt'),
      lease_worker_id = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE j.status = 'running' AND j.lease_expires_at < now() AND j.attempt_count >= j.max_attempts
    AND j.worker_mode = p_worker_mode;

  SELECT j.* INTO v_job
  FROM public.permit_sync_jobs j
  JOIN public.permit_sync_sources s ON s.credential_id = j.credential_id
  WHERE j.worker_mode = p_worker_mode
    AND (
      (j.status IN ('queued', 'retry_wait') AND j.next_attempt_at <= now())
      OR (j.status = 'running' AND j.lease_expires_at < now())
    )
    AND s.status NOT IN ('needs_encryption', 'auth_failed', 'paused', 'waiting_user')
    AND (j.trigger = 'manual' OR s.automation_enabled)
  ORDER BY (j.trigger = 'manual') DESC, j.next_attempt_at, j.created_at
  LIMIT 1
  FOR UPDATE OF j SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.permit_sync_jobs
  SET status = 'running',
      attempt_count = attempt_count + 1,
      lease_worker_id = p_worker_id,
      lease_expires_at = now() + make_interval(secs => v_ttl),
      lease_heartbeat_at = now(),
      started_at = coalesce(started_at, now()),
      updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  INSERT INTO public.permit_sync_events (job_id, level, code, message, data)
  VALUES (v_job.id, 'info', 'claimed', p_worker_id, jsonb_build_object('attempt', v_job.attempt_count, 'worker_mode', p_worker_mode));
  RETURN v_job;
END;
$$;

COMMIT;
