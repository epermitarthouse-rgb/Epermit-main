-- Durable Arlington scrape cancellation (user-initiated, idempotent).

CREATE OR REPLACE FUNCTION public.cancel_arlington_scrape_job(
  p_job_id UUID,
  p_project_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  job_id UUID,
  status TEXT,
  already_terminal BOOLEAN,
  cancellation_reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.scrape_jobs;
  v_meta JSONB;
  v_arlington JSONB;
  v_terminal BOOLEAN;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'job_id required';
  END IF;
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required';
  END IF;

  SELECT *
  INTO v_job
  FROM public.scrape_jobs sj
  WHERE sj.id = p_job_id
    AND sj.project_id = p_project_id
    AND sj.jurisdiction ILIKE '%arlington%'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Arlington scrape job % not found for project %', p_job_id, p_project_id;
  END IF;

  IF p_user_id IS NOT NULL AND v_job.user_id IS NOT NULL AND v_job.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Arlington scrape job % does not belong to user', p_job_id;
  END IF;

  v_meta := COALESCE(v_job.metadata, '{}'::jsonb);
  v_arlington := COALESCE(v_meta->'arlington', '{}'::jsonb);

  IF v_job.status = 'cancelled'
    OR COALESCE(v_arlington->>'terminalReason', '') = 'user_cancelled' THEN
    job_id := v_job.id;
    status := 'cancelled';
    already_terminal := false;
    cancellation_reason := COALESCE(v_job.cancellation_reason, 'user_cancelled');
    RETURN NEXT;
    RETURN;
  END IF;

  v_terminal := v_job.completed_at IS NOT NULL
    OR v_job.status IN (
      'completed',
      'completed_with_warnings',
      'partial_external_blocker',
      'failed',
      'failed_unrecoverable'
    );

  IF v_terminal THEN
    job_id := v_job.id;
    status := v_job.status;
    already_terminal := true;
    cancellation_reason := v_job.cancellation_reason;
    RETURN NEXT;
    RETURN;
  END IF;

  v_arlington := v_arlington || jsonb_build_object(
    'terminalReason', 'user_cancelled',
    'cancelledAt', to_jsonb(now()),
    'cancelledBy', COALESCE(p_user_id::text, v_job.user_id::text, 'unknown')
  );
  v_meta := v_meta || jsonb_build_object('arlington', v_arlington);

  UPDATE public.scrape_jobs sj
  SET
    status = 'cancelled',
    completed_at = now(),
    cancelled_at = now(),
    cancellation_reason = 'user_cancelled',
    run_intent = 'dormant',
    dispatch_priority = 0,
    next_attempt_at = NULL,
    lease_worker_id = NULL,
    lease_expires_at = NULL,
    lease_heartbeat_at = NULL,
    current_stage = 'cancelled',
    current_user_message = 'Arlington scrape cancelled by user.',
    metadata = v_meta,
    last_activity_at = now(),
    updated_at = now()
  WHERE sj.id = p_job_id
  RETURNING * INTO v_job;

  job_id := v_job.id;
  status := v_job.status;
  already_terminal := false;
  cancellation_reason := v_job.cancellation_reason;
  RETURN NEXT;
END;
$$;

-- Prevent worker lease release from overwriting user cancellation.
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
    AND status IS DISTINCT FROM 'cancelled'
    AND completed_at IS NULL
    AND COALESCE(metadata->'arlington'->>'terminalReason', '') IS DISTINCT FROM 'user_cancelled'
    AND (lease_worker_id IS NULL OR lease_worker_id = p_worker_id)
  RETURNING * INTO v_job;
  RETURN v_job;
END;
$$;

-- Heartbeat must not revive cancelled jobs.
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
  v_updated INTEGER;
  v_ttl INTEGER;
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
    AND status IS DISTINCT FROM 'cancelled'
    AND completed_at IS NULL
    AND COALESCE(metadata->'arlington'->>'terminalReason', '') IS DISTINCT FROM 'user_cancelled';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_arlington_scrape_job(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_arlington_scrape_job(UUID, UUID, UUID) TO service_role;

-- Exclude user-cancelled jobs from worker claims.
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
  v_recovery_window INTERVAL := interval '30 minutes';
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'worker_id required';
  END IF;
  v_ttl := GREATEST(30, COALESCE(p_lease_ttl_seconds, 180));

  SELECT *
  INTO v_job
  FROM public.scrape_jobs sj
  WHERE sj.jurisdiction ILIKE '%arlington%'
    AND sj.completed_at IS NULL
    AND sj.status IS DISTINCT FROM 'cancelled'
    AND sj.run_intent <> 'dormant'
    AND sj.status IN ('queued', 'running', 'resuming', 'rate_limited', 'partial')
    AND sj.status NOT IN (
      'completed',
      'completed_with_warnings',
      'partial_external_blocker',
      'failed',
      'failed_unrecoverable',
      'cancelled'
    )
    AND (sj.next_attempt_at IS NULL OR sj.next_attempt_at <= now() OR sj.run_intent <> 'retry')
    AND (sj.lease_expires_at IS NULL OR sj.lease_expires_at < now())
    AND (sj.phase IS NULL OR sj.phase IS DISTINCT FROM 'complete')
    AND COALESCE(sj.metadata->'arlington'->>'terminalReason', '') NOT IN (
      'plan_review_metadata_only',
      'no_progress_guard',
      'duplicate_active_job',
      'user_cancelled'
    )
    AND (
      sj.run_intent = 'foreground'
      OR (
        sj.run_intent = 'recovery'
        AND sj.explicitly_resumed_at IS NOT NULL
      )
      OR (
        sj.run_intent = 'retry'
        AND sj.status IN ('rate_limited', 'partial')
        AND (sj.next_attempt_at IS NULL OR sj.next_attempt_at <= now())
      )
      OR (
        sj.run_intent IN ('foreground', 'recovery', 'retry')
        AND sj.status IN ('running', 'resuming', 'partial')
        AND GREATEST(
          COALESCE(sj.last_worker_started_at, 'epoch'::timestamptz),
          COALESCE(sj.lease_heartbeat_at, 'epoch'::timestamptz),
          COALESCE(sj.last_heartbeat_at, 'epoch'::timestamptz)
        ) > now() - v_recovery_window
      )
    )
  ORDER BY
    CASE
      WHEN sj.run_intent = 'foreground' THEN 0
      WHEN sj.run_intent = 'recovery' AND sj.explicitly_resumed_at IS NOT NULL THEN 1
      WHEN sj.run_intent IN ('foreground', 'recovery', 'retry')
        AND sj.status IN ('running', 'resuming', 'partial')
        AND GREATEST(
          COALESCE(sj.last_worker_started_at, 'epoch'::timestamptz),
          COALESCE(sj.lease_heartbeat_at, 'epoch'::timestamptz),
          COALESCE(sj.last_heartbeat_at, 'epoch'::timestamptz)
        ) > now() - v_recovery_window THEN 2
      WHEN sj.run_intent = 'retry' THEN 3
      ELSE 99
    END,
    sj.dispatch_priority DESC,
    sj.requested_at DESC NULLS LAST,
    sj.created_at ASC
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
    last_worker_started_at = now(),
    status = CASE
      WHEN status IN ('queued', 'rate_limited', 'partial') THEN 'running'
      ELSE status
    END,
    last_heartbeat_at = now(),
    last_activity_at = now(),
    updated_at = now()
  WHERE id = v_job.id
    AND status IS DISTINCT FROM 'cancelled'
    AND completed_at IS NULL
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_arlington_scrape_job(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_arlington_scrape_job(TEXT, INTEGER) TO service_role;
