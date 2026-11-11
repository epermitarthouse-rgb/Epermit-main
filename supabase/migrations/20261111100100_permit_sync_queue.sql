-- Permit sync queue (Phase 2). See docs/permit-repository/MASTER_PLAN.md §3 P2.1 and D-004, D-007.
-- Additive only: new tables and functions; scrape_jobs and the Arlington RPCs are not touched.
-- Lease semantics mirror claim/heartbeat/release_arlington_scrape_job_lease: TTL lease, SKIP LOCKED,
-- holder-checked heartbeat/finish, and cancellation that a worker cannot overwrite.
-- No cron schedule is created here (approval A-4). Depends on 20261111100000_central_permit_repository.sql.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.permit_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id UUID NOT NULL REFERENCES public.permit_sync_sources(credential_id) ON DELETE CASCADE,
  adapter_key TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'running', 'retry_wait', 'waiting_user',
    'completed', 'completed_with_warnings', 'failed', 'failed_unrecoverable', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_worker_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  lease_heartbeat_at TIMESTAMPTZ,
  checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  last_error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one non-terminal job per source credential (one portal session per login, D-007).
CREATE UNIQUE INDEX IF NOT EXISTS uq_permit_sync_jobs_one_active
  ON public.permit_sync_jobs (credential_id)
  WHERE status IN ('queued', 'running', 'retry_wait', 'waiting_user');
CREATE INDEX IF NOT EXISTS idx_permit_sync_jobs_claim
  ON public.permit_sync_jobs (next_attempt_at)
  WHERE status IN ('queued', 'retry_wait', 'running');
CREATE INDEX IF NOT EXISTS idx_permit_sync_jobs_credential ON public.permit_sync_jobs (credential_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.permit_sync_events (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.permit_sync_jobs(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  code TEXT NOT NULL,
  message TEXT,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_permit_sync_events_job ON public.permit_sync_events (job_id, id);

-- Events are append-only (D-020) except when their job is deleted, and a job is deleted only when its
-- source is (deleting the portal credential cascades credential -> source -> jobs -> events; D-039).
-- A row qualifies only inside a foreign-key cascade (pg_trigger_depth() > 1) and only once its parent
-- row is already gone, which a direct DELETE can never satisfy because the FK keeps the parent alive.
CREATE OR REPLACE FUNCTION public._permit_sync_events_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('permit_repo.allow_evidence_purge', true) = 'on' THEN
    RETURN COALESCE(OLD, NEW);
  END IF;
  IF TG_OP = 'DELETE' AND TG_LEVEL = 'ROW' AND pg_trigger_depth() > 1
     AND NOT EXISTS (SELECT 1 FROM public.permit_sync_jobs j WHERE j.id = OLD.job_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'permit_sync_events is append-only' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public._permit_sync_jobs_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('permit_repo.allow_evidence_purge', true) = 'on' THEN
    RETURN COALESCE(OLD, NEW);
  END IF;
  IF TG_OP = 'DELETE' AND TG_LEVEL = 'ROW' AND pg_trigger_depth() > 1
     AND NOT EXISTS (SELECT 1 FROM public.permit_sync_sources s WHERE s.credential_id = OLD.credential_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'permit_sync_jobs rows are deleted only with their source' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS permit_sync_events_append_only ON public.permit_sync_events;
CREATE TRIGGER permit_sync_events_append_only
BEFORE UPDATE OR DELETE ON public.permit_sync_events
FOR EACH ROW EXECUTE FUNCTION public._permit_sync_events_guard();

-- TRUNCATE skips row triggers, so it needs its own statement-level guard.
DROP TRIGGER IF EXISTS permit_sync_events_no_truncate ON public.permit_sync_events;
CREATE TRIGGER permit_sync_events_no_truncate
BEFORE TRUNCATE ON public.permit_sync_events
FOR EACH STATEMENT EXECUTE FUNCTION public._permit_sync_events_guard();

DROP TRIGGER IF EXISTS permit_sync_jobs_delete_guard ON public.permit_sync_jobs;
CREATE TRIGGER permit_sync_jobs_delete_guard
BEFORE DELETE ON public.permit_sync_jobs
FOR EACH ROW EXECUTE FUNCTION public._permit_sync_jobs_delete_guard();

DROP TRIGGER IF EXISTS permit_sync_jobs_no_truncate ON public.permit_sync_jobs;
CREATE TRIGGER permit_sync_jobs_no_truncate
BEFORE TRUNCATE ON public.permit_sync_jobs
FOR EACH STATEMENT EXECUTE FUNCTION public._permit_sync_jobs_delete_guard();

ALTER TABLE public.permit_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_sync_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins read permit sync jobs" ON public.permit_sync_jobs;
CREATE POLICY "Platform admins read permit sync jobs" ON public.permit_sync_jobs
FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Platform admins read permit sync events" ON public.permit_sync_events;
CREATE POLICY "Platform admins read permit sync events" ON public.permit_sync_events
FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));

REVOKE ALL ON public.permit_sync_jobs, public.permit_sync_events FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.permit_sync_jobs, public.permit_sync_events FROM authenticated;
GRANT SELECT ON public.permit_sync_jobs, public.permit_sync_events TO authenticated;
GRANT ALL ON public.permit_sync_jobs, public.permit_sync_events TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.permit_sync_events FROM service_role;
GRANT USAGE, SELECT ON SEQUENCE public.permit_sync_events_id_seq TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Enqueue
-- ---------------------------------------------------------------------------

-- Returns the existing active job for the source if there is one (dedup), else a new job id.
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

-- Called by the (not yet enabled) daily schedule. Skips sources that are not active or already busy.
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

CREATE OR REPLACE FUNCTION public.admin_request_permit_sync(p_credential_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  PERFORM public._admin_require_platform_admin();
  v_id := public._permit_sync_enqueue(p_credential_id, 'manual', auth.uid());
  PERFORM public._permit_audit('permit_sync.request', 'permit_sync_job', v_id::text, NULL,
    jsonb_build_object('credential_id', p_credential_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_permit_sync_job(p_job_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_require_platform_admin();
  UPDATE public.permit_sync_jobs
  SET status = 'cancelled', cancelled_by = auth.uid(), completed_at = now(),
      lease_worker_id = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_job_id AND status IN ('queued', 'running', 'retry_wait', 'waiting_user');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active job not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.permit_sync_events (job_id, level, code, message) VALUES (p_job_id, 'warn', 'cancelled', 'admin');
  PERFORM public._permit_audit('permit_sync.cancel', 'permit_sync_job', p_job_id::text, NULL, NULL);
END;
$$;

-- Resumes a source after MFA, auth failure or pause. Admin only.
CREATE OR REPLACE FUNCTION public.admin_resume_permit_sync_source(p_credential_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before TEXT;
BEGIN
  PERFORM public._admin_require_platform_admin();
  SELECT status INTO v_before FROM public.permit_sync_sources WHERE credential_id = p_credential_id FOR UPDATE;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'no permit sync source for credential' USING ERRCODE = 'P0002';
  END IF;
  IF v_before = 'needs_encryption' THEN
    RAISE EXCEPTION 'credential must be encrypted first' USING ERRCODE = '22023';
  END IF;
  UPDATE public.permit_sync_sources
  SET status = CASE WHEN automation_enabled THEN 'active' ELSE 'inactive' END,
      consecutive_auth_failures = 0, last_error = NULL, updated_at = now()
  WHERE credential_id = p_credential_id;
  UPDATE public.permit_sync_jobs
  SET status = 'cancelled', completed_at = now(), cancelled_by = auth.uid(), updated_at = now()
  WHERE credential_id = p_credential_id AND status = 'waiting_user';
  PERFORM public._permit_audit('permit_sync_source.resume', 'portal_credential', p_credential_id::text,
    jsonb_build_object('status', v_before), NULL);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Worker lease RPCs (service role only)
-- ---------------------------------------------------------------------------

-- Claims the next due job. Expired leases on running jobs are reclaimed (crash recovery) and count as
-- an attempt; a job that has used all attempts is failed instead of reclaimed.
CREATE OR REPLACE FUNCTION public.claim_permit_sync_job(p_worker_id TEXT, p_lease_ttl_seconds INTEGER DEFAULT 300)
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

  UPDATE public.permit_sync_jobs j
  SET status = 'failed', error_code = 'lease_expired', completed_at = now(),
      last_error = coalesce(j.last_error, 'worker lease expired after final attempt'),
      lease_worker_id = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE j.status = 'running' AND j.lease_expires_at < now() AND j.attempt_count >= j.max_attempts;

  SELECT j.* INTO v_job
  FROM public.permit_sync_jobs j
  JOIN public.permit_sync_sources s ON s.credential_id = j.credential_id
  WHERE (
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
  VALUES (v_job.id, 'info', 'claimed', p_worker_id, jsonb_build_object('attempt', v_job.attempt_count));
  RETURN v_job;
END;
$$;

-- Extends the lease and optionally stores a checkpoint. FALSE means the worker lost the job
-- (cancelled, reclaimed or finished) and must stop.
CREATE OR REPLACE FUNCTION public.heartbeat_permit_sync_job(
  p_job_id UUID, p_worker_id TEXT, p_lease_ttl_seconds INTEGER DEFAULT 300, p_checkpoint JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  UPDATE public.permit_sync_jobs
  SET lease_expires_at = now() + make_interval(secs => GREATEST(60, COALESCE(p_lease_ttl_seconds, 300))),
      lease_heartbeat_at = now(),
      checkpoint = COALESCE(p_checkpoint, checkpoint),
      updated_at = now()
  WHERE id = p_job_id AND lease_worker_id = p_worker_id AND status = 'running';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_permit_sync_event(
  p_job_id UUID, p_worker_id TEXT, p_level TEXT, p_code TEXT, p_message TEXT DEFAULT NULL, p_data JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.permit_sync_jobs WHERE id = p_job_id AND lease_worker_id = p_worker_id) THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.permit_sync_events (job_id, level, code, message, data)
  VALUES (p_job_id, p_level, p_code, left(p_message, 2000), p_data);
  RETURN TRUE;
END;
$$;

-- Ends a run. p_outcome: completed | completed_with_warnings | failed | failed_unrecoverable | waiting_user.
-- 'failed' with p_retryable retries with backoff until max_attempts. Auth outcomes update the source:
-- auth_failed twice in a row pauses the source; mfa_required puts it in waiting_user (D-007, MASTER_PLAN §6).
CREATE OR REPLACE FUNCTION public.finish_permit_sync_job(
  p_job_id UUID, p_worker_id TEXT, p_outcome TEXT, p_error_code TEXT DEFAULT NULL, p_last_error TEXT DEFAULT NULL,
  p_metrics JSONB DEFAULT NULL, p_retryable BOOLEAN DEFAULT FALSE, p_retry_after_seconds INTEGER DEFAULT NULL
)
RETURNS public.permit_sync_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.permit_sync_jobs;
  v_status TEXT;
  v_delay INTEGER;
BEGIN
  IF p_outcome NOT IN ('completed', 'completed_with_warnings', 'failed', 'failed_unrecoverable', 'waiting_user') THEN
    RAISE EXCEPTION 'invalid outcome %', p_outcome USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job FROM public.permit_sync_jobs
  WHERE id = p_job_id AND lease_worker_id = p_worker_id AND status = 'running'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_status := p_outcome;
  IF p_outcome = 'failed' AND p_retryable AND v_job.attempt_count < v_job.max_attempts THEN
    v_status := 'retry_wait';
  END IF;
  v_delay := COALESCE(p_retry_after_seconds, (300 * power(2, GREATEST(v_job.attempt_count - 1, 0)))::int);

  UPDATE public.permit_sync_jobs
  SET status = v_status,
      error_code = p_error_code,
      last_error = left(p_last_error, 2000),
      metrics = COALESCE(p_metrics, metrics),
      next_attempt_at = CASE WHEN v_status = 'retry_wait' THEN now() + make_interval(secs => v_delay) ELSE next_attempt_at END,
      completed_at = CASE WHEN v_status IN ('retry_wait', 'waiting_user') THEN NULL ELSE now() END,
      lease_worker_id = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  IF p_error_code = 'auth_failed' THEN
    UPDATE public.permit_sync_sources
    SET consecutive_auth_failures = consecutive_auth_failures + 1,
        status = CASE WHEN consecutive_auth_failures + 1 >= 2 THEN 'auth_failed' ELSE status END,
        last_error = left(p_last_error, 500), updated_at = now()
    WHERE credential_id = v_job.credential_id;
  ELSIF p_outcome = 'waiting_user' THEN
    UPDATE public.permit_sync_sources
    SET status = 'waiting_user', last_error = left(p_last_error, 500), updated_at = now()
    WHERE credential_id = v_job.credential_id;
  ELSIF p_outcome IN ('completed', 'completed_with_warnings') THEN
    UPDATE public.permit_sync_sources
    SET consecutive_auth_failures = 0, last_login_ok_at = now(), last_error = NULL, updated_at = now()
    WHERE credential_id = v_job.credential_id;
  END IF;

  INSERT INTO public.permit_sync_events (job_id, level, code, message, data)
  VALUES (p_job_id, CASE WHEN v_status IN ('completed') THEN 'info' WHEN v_status IN ('completed_with_warnings', 'retry_wait', 'waiting_user') THEN 'warn' ELSE 'error' END,
          'finished', v_status, jsonb_build_object('error_code', p_error_code, 'attempt', v_job.attempt_count));
  RETURN v_job;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Function privileges
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public._permit_sync_enqueue(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._permit_sync_events_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._permit_sync_jobs_delete_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_permit_sync_runs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_request_permit_sync(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_cancel_permit_sync_job(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_resume_permit_sync_source(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_permit_sync_job(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.heartbeat_permit_sync_job(uuid, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_permit_sync_event(uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_permit_sync_job(uuid, text, text, text, text, jsonb, boolean, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_permit_sync_runs() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_request_permit_sync(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_cancel_permit_sync_job(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_resume_permit_sync_source(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_permit_sync_job(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_permit_sync_job(uuid, text, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_permit_sync_event(uuid, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_permit_sync_job(uuid, text, text, text, text, jsonb, boolean, integer) TO service_role;
