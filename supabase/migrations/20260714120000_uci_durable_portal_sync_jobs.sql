-- D1D: durable uci_portal_sync jobs on shared scrape_jobs infrastructure.

ALTER TABLE public.scrape_jobs
  ADD COLUMN IF NOT EXISTS job_type TEXT,
  ADD COLUMN IF NOT EXISTS coordination_record_id UUID REFERENCES public.coordination_records(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_uci_coordination_created
  ON public.scrape_jobs (coordination_record_id, created_at DESC)
  WHERE job_type = 'uci_portal_sync';

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_uci_worker_poll
  ON public.scrape_jobs (next_attempt_at NULLS FIRST, created_at ASC)
  WHERE job_type = 'uci_portal_sync'
    AND completed_at IS NULL
    AND status IN ('queued', 'running', 'partial');

CREATE UNIQUE INDEX IF NOT EXISTS idx_scrape_jobs_uci_active_sync
  ON public.scrape_jobs (
    coordination_record_id,
    COALESCE(metadata->>'provider_slug', portal_type, '')
  )
  WHERE job_type = 'uci_portal_sync'
    AND completed_at IS NULL
    AND status NOT IN (
      'completed',
      'completed_with_warnings',
      'failed',
      'failed_unrecoverable',
      'cancelled'
    );

CREATE OR REPLACE FUNCTION public.enqueue_or_get_uci_portal_sync_job(
  p_project_id UUID,
  p_user_id UUID,
  p_coordination_record_id UUID,
  p_provider_slug TEXT,
  p_requested_scope JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (job public.scrape_jobs, reused_existing BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.scrape_jobs;
  v_inserted public.scrape_jobs;
  v_provider TEXT;
BEGIN
  IF p_project_id IS NULL OR p_coordination_record_id IS NULL THEN
    RAISE EXCEPTION 'project_id and coordination_record_id required';
  END IF;

  v_provider := lower(trim(COALESCE(p_provider_slug, '')));

  SELECT *
  INTO v_existing
  FROM public.scrape_jobs sj
  WHERE sj.job_type = 'uci_portal_sync'
    AND sj.coordination_record_id = p_coordination_record_id
    AND COALESCE(sj.metadata->>'provider_slug', sj.portal_type, '') = v_provider
    AND sj.completed_at IS NULL
    AND sj.status NOT IN (
      'completed',
      'completed_with_warnings',
      'failed',
      'failed_unrecoverable',
      'cancelled'
    )
  ORDER BY sj.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    job := v_existing;
    reused_existing := true;
    RETURN NEXT;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.scrape_jobs (
      project_id,
      user_id,
      jurisdiction,
      portal_type,
      scrape_mode,
      job_type,
      coordination_record_id,
      status,
      phase,
      current_stage,
      current_user_message,
      progress_current,
      progress_total,
      requested_scope,
      started_at,
      last_heartbeat_at,
      last_activity_at,
      metadata
    ) VALUES (
      p_project_id,
      p_user_id,
      'UCI',
      NULLIF(v_provider, ''),
      'uci_portal_sync',
      'uci_portal_sync',
      p_coordination_record_id,
      'queued',
      'portal_sync',
      'queued',
      'Portal sync queued',
      0,
      5,
      COALESCE(p_requested_scope, '{}'::jsonb),
      now(),
      now(),
      now(),
      jsonb_build_object(
        'uci', jsonb_build_object(
          'provider_slug', v_provider,
          'job_kind', 'uci_portal_sync'
        ),
        'provider_slug', v_provider
      )
    )
    RETURNING * INTO v_inserted;

    job := v_inserted;
    reused_existing := false;
    RETURN NEXT;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT *
      INTO v_existing
      FROM public.scrape_jobs sj
      WHERE sj.job_type = 'uci_portal_sync'
        AND sj.coordination_record_id = p_coordination_record_id
        AND COALESCE(sj.metadata->>'provider_slug', sj.portal_type, '') = v_provider
        AND sj.completed_at IS NULL
        AND sj.status NOT IN (
          'completed',
          'completed_with_warnings',
          'failed',
          'failed_unrecoverable',
          'cancelled'
        )
      ORDER BY sj.created_at DESC
      LIMIT 1;

      job := v_existing;
      reused_existing := true;
      RETURN NEXT;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_uci_portal_sync_job(
  p_worker_id TEXT,
  p_lease_ttl_seconds INTEGER DEFAULT 180
)
RETURNS public.scrape_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.scrape_jobs;
  v_ttl INTEGER;
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'worker_id required';
  END IF;
  v_ttl := GREATEST(30, COALESCE(p_lease_ttl_seconds, 180));

  SELECT *
  INTO v_job
  FROM public.scrape_jobs
  WHERE job_type = 'uci_portal_sync'
    AND completed_at IS NULL
    AND status IN ('queued', 'running', 'partial')
    AND (next_attempt_at IS NULL OR next_attempt_at <= now())
    AND (lease_expires_at IS NULL OR lease_expires_at < now())
    AND phase IS DISTINCT FROM 'complete'
  ORDER BY next_attempt_at NULLS FIRST, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.scrape_jobs
  SET
    lease_worker_id = p_worker_id,
    lease_expires_at = now() + make_interval(secs => v_ttl),
    lease_heartbeat_at = now(),
    status = CASE
      WHEN status IN ('queued', 'partial') THEN 'running'
      ELSE status
    END,
    last_heartbeat_at = now(),
    last_activity_at = now(),
    updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_uci_portal_sync_job_lease(
  p_job_id UUID,
  p_worker_id TEXT,
  p_lease_ttl_seconds INTEGER DEFAULT 180
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
  v_ttl INTEGER;
BEGIN
  v_ttl := GREATEST(30, COALESCE(p_lease_ttl_seconds, 180));
  UPDATE public.scrape_jobs
  SET
    lease_expires_at = now() + make_interval(secs => v_ttl),
    lease_heartbeat_at = now(),
    last_heartbeat_at = now(),
    last_activity_at = now(),
    updated_at = now()
  WHERE id = p_job_id
    AND job_type = 'uci_portal_sync'
    AND lease_worker_id = p_worker_id
    AND status IS DISTINCT FROM 'cancelled'
    AND completed_at IS NULL
    AND COALESCE(metadata->'uci'->>'terminal_reason', '') IS DISTINCT FROM 'user_cancelled';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_uci_portal_sync_job_lease(
  p_job_id UUID,
  p_worker_id TEXT,
  p_next_attempt_at TIMESTAMPTZ DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_phase TEXT DEFAULT NULL,
  p_attempt_count INTEGER DEFAULT NULL,
  p_last_error TEXT DEFAULT NULL,
  p_completed_at TIMESTAMPTZ DEFAULT NULL,
  p_current_stage TEXT DEFAULT NULL,
  p_current_user_message TEXT DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_error_user_message TEXT DEFAULT NULL
)
RETURNS public.scrape_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.scrape_jobs;
BEGIN
  UPDATE public.scrape_jobs
  SET
    lease_worker_id = NULL,
    lease_expires_at = NULL,
    next_attempt_at = COALESCE(p_next_attempt_at, next_attempt_at),
    status = COALESCE(p_status, status),
    phase = COALESCE(p_phase, phase),
    attempt_count = COALESCE(p_attempt_count, attempt_count),
    last_error = p_last_error,
    completed_at = COALESCE(p_completed_at, completed_at),
    current_stage = COALESCE(p_current_stage, current_stage),
    current_user_message = COALESCE(p_current_user_message, current_user_message),
    error_code = COALESCE(p_error_code, error_code),
    error_user_message = COALESCE(p_error_user_message, error_user_message),
    last_activity_at = now(),
    updated_at = now()
  WHERE id = p_job_id
    AND job_type = 'uci_portal_sync'
    AND status IS DISTINCT FROM 'cancelled'
    AND completed_at IS NULL
    AND COALESCE(metadata->'uci'->>'terminal_reason', '') IS DISTINCT FROM 'user_cancelled'
    AND (lease_worker_id IS NULL OR lease_worker_id = p_worker_id)
  RETURNING * INTO v_job;
  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_uci_portal_sync_job(
  p_job_id UUID,
  p_project_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS public.scrape_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.scrape_jobs;
BEGIN
  UPDATE public.scrape_jobs sj
  SET
    status = 'cancelled',
    cancelled_at = now(),
    completed_at = now(),
    lease_worker_id = NULL,
    lease_expires_at = NULL,
    current_stage = 'cancelled',
    current_user_message = 'Portal sync cancelled',
    metadata = COALESCE(sj.metadata, '{}'::jsonb) || jsonb_build_object(
      'uci',
      COALESCE(sj.metadata->'uci', '{}'::jsonb) || jsonb_build_object(
        'terminal_reason', 'user_cancelled'
      )
    ),
    last_activity_at = now(),
    updated_at = now()
  WHERE sj.id = p_job_id
    AND sj.project_id = p_project_id
    AND sj.job_type = 'uci_portal_sync'
    AND sj.completed_at IS NULL
    AND sj.status IS DISTINCT FROM 'cancelled'
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    SELECT * INTO v_job
    FROM public.scrape_jobs
    WHERE id = p_job_id
      AND project_id = p_project_id
      AND job_type = 'uci_portal_sync';
  END IF;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_or_get_uci_portal_sync_job(UUID, UUID, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_uci_portal_sync_job(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.heartbeat_uci_portal_sync_job_lease(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_uci_portal_sync_job_lease(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_uci_portal_sync_job(UUID, UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.enqueue_or_get_uci_portal_sync_job(UUID, UUID, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_uci_portal_sync_job(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_uci_portal_sync_job_lease(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_uci_portal_sync_job_lease(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_uci_portal_sync_job(UUID, UUID, UUID) TO service_role;
