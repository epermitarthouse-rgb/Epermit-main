-- Arlington durable scrape jobs: indexed columns + atomic worker claim RPC.

ALTER TABLE public.scrape_jobs
  DROP CONSTRAINT IF EXISTS scrape_jobs_status_check;

ALTER TABLE public.scrape_jobs
  ADD COLUMN IF NOT EXISTS requested_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS phase TEXT,
  ADD COLUMN IF NOT EXISTS attachments_state TEXT,
  ADD COLUMN IF NOT EXISTS project_info_state TEXT,
  ADD COLUMN IF NOT EXISTS plan_review_state TEXT,
  ADD COLUMN IF NOT EXISTS checkpoint_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_worker_id TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE public.scrape_jobs
  ADD CONSTRAINT scrape_jobs_status_check CHECK (
    status IN (
      'queued',
      'running',
      'resuming',
      'rate_limited',
      'partial',
      'waiting_user',
      'completed',
      'completed_with_warnings',
      'failed',
      'failed_unrecoverable',
      'cancelled'
    )
  );

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_arlington_worker_poll
  ON public.scrape_jobs (next_attempt_at NULLS FIRST, created_at ASC)
  WHERE jurisdiction ILIKE '%arlington%'
    AND completed_at IS NULL
    AND status IN ('queued', 'running', 'resuming', 'rate_limited', 'partial');

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_arlington_lease
  ON public.scrape_jobs (lease_expires_at)
  WHERE lease_worker_id IS NOT NULL;

-- Atomic claim: one eligible Arlington job per worker invocation.
CREATE OR REPLACE FUNCTION public.claim_arlington_scrape_job(
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
  WHERE jurisdiction ILIKE '%arlington%'
    AND completed_at IS NULL
    AND status IN ('queued', 'running', 'resuming', 'rate_limited', 'partial')
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
      WHEN status IN ('queued', 'rate_limited', 'partial') THEN 'running'
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

CREATE OR REPLACE FUNCTION public.heartbeat_arlington_scrape_job_lease(
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
  v_ttl INTEGER;
  v_updated INTEGER;
BEGIN
  v_ttl := GREATEST(30, COALESCE(p_lease_ttl_seconds, 180));
  UPDATE public.scrape_jobs
  SET
    lease_expires_at = now() + make_interval(secs => v_ttl),
    lease_heartbeat_at = now(),
    last_heartbeat_at = now(),
    updated_at = now()
  WHERE id = p_job_id
    AND lease_worker_id = p_worker_id
    AND completed_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_arlington_scrape_job_lease(
  p_job_id UUID,
  p_worker_id TEXT,
  p_next_attempt_at TIMESTAMPTZ DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_phase TEXT DEFAULT NULL,
  p_attachments_state TEXT DEFAULT NULL,
  p_project_info_state TEXT DEFAULT NULL,
  p_plan_review_state TEXT DEFAULT NULL,
  p_checkpoint_version INTEGER DEFAULT NULL,
  p_attempt_count INTEGER DEFAULT NULL,
  p_last_error TEXT DEFAULT NULL,
  p_completed_at TIMESTAMPTZ DEFAULT NULL,
  p_current_stage TEXT DEFAULT NULL,
  p_current_user_message TEXT DEFAULT NULL
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
    attachments_state = COALESCE(p_attachments_state, attachments_state),
    project_info_state = COALESCE(p_project_info_state, project_info_state),
    plan_review_state = COALESCE(p_plan_review_state, plan_review_state),
    checkpoint_version = COALESCE(p_checkpoint_version, checkpoint_version),
    attempt_count = COALESCE(p_attempt_count, attempt_count),
    last_error = p_last_error,
    completed_at = COALESCE(p_completed_at, completed_at),
    current_stage = COALESCE(p_current_stage, current_stage),
    current_user_message = COALESCE(p_current_user_message, current_user_message),
    last_activity_at = now(),
    updated_at = now()
  WHERE id = p_job_id
    AND (lease_worker_id IS NULL OR lease_worker_id = p_worker_id)
  RETURNING * INTO v_job;
  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_arlington_scrape_job(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.heartbeat_arlington_scrape_job_lease(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_arlington_scrape_job_lease(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.claim_arlington_scrape_job(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_arlington_scrape_job_lease(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_arlington_scrape_job_lease(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO service_role;
