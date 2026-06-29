-- Arlington foreground dispatch priority: targeted claiming instead of global FIFO.

ALTER TABLE public.scrape_jobs
  ADD COLUMN IF NOT EXISTS run_intent TEXT NOT NULL DEFAULT 'dormant',
  ADD COLUMN IF NOT EXISTS dispatch_priority INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS explicitly_resumed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_worker_started_at TIMESTAMPTZ;

ALTER TABLE public.scrape_jobs
  DROP CONSTRAINT IF EXISTS scrape_jobs_run_intent_check;

ALTER TABLE public.scrape_jobs
  ADD CONSTRAINT scrape_jobs_run_intent_check CHECK (
    run_intent IN ('foreground', 'recovery', 'retry', 'dormant')
  );

-- Classify existing unfinished Arlington jobs: dormant unless actively leased right now.
UPDATE public.scrape_jobs
SET
  run_intent = 'dormant',
  dispatch_priority = 0
WHERE jurisdiction ILIKE '%arlington%'
  AND completed_at IS NULL
  AND status IN ('queued', 'running', 'resuming', 'rate_limited', 'partial', 'waiting_user');

UPDATE public.scrape_jobs
SET
  run_intent = CASE
    WHEN status = 'rate_limited' THEN 'retry'
    ELSE 'recovery'
  END,
  dispatch_priority = 1,
  requested_at = COALESCE(requested_at, updated_at, created_at)
WHERE jurisdiction ILIKE '%arlington%'
  AND completed_at IS NULL
  AND status IN ('queued', 'running', 'resuming', 'rate_limited', 'partial', 'waiting_user')
  AND lease_worker_id IS NOT NULL
  AND lease_expires_at IS NOT NULL
  AND lease_expires_at > now();

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_arlington_dispatch
  ON public.scrape_jobs (run_intent, dispatch_priority DESC, requested_at DESC NULLS LAST)
  WHERE jurisdiction ILIKE '%arlington%'
    AND completed_at IS NULL
    AND run_intent <> 'dormant';

-- Signal a user-requested job as the next foreground target (durable across restart).
CREATE OR REPLACE FUNCTION public.request_arlington_job_dispatch(p_job_id UUID)
RETURNS TABLE (
  job_id UUID,
  run_intent TEXT,
  dispatch_priority INTEGER,
  queue_position INTEGER,
  currently_running_job_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.scrape_jobs;
  v_priority INTEGER;
  v_running UUID;
  v_queue INTEGER;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'job_id required';
  END IF;

  v_priority := EXTRACT(EPOCH FROM now())::INTEGER;

  UPDATE public.scrape_jobs sj
  SET
    run_intent = 'foreground',
    dispatch_priority = GREATEST(COALESCE(sj.dispatch_priority, 0), v_priority),
    requested_at = now(),
    updated_at = now()
  WHERE sj.id = p_job_id
    AND jurisdiction ILIKE '%arlington%'
    AND completed_at IS NULL
    AND status NOT IN ('completed', 'completed_with_warnings', 'partial_external_blocker', 'failed', 'failed_unrecoverable', 'cancelled')
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Arlington job % not found or not dispatchable', p_job_id;
  END IF;

  SELECT sj.id
  INTO v_running
  FROM public.scrape_jobs sj
  WHERE sj.jurisdiction ILIKE '%arlington%'
    AND sj.completed_at IS NULL
    AND sj.id <> p_job_id
    AND sj.lease_worker_id IS NOT NULL
    AND sj.lease_expires_at IS NOT NULL
    AND sj.lease_expires_at > now()
    AND sj.status IN ('running', 'resuming', 'partial', 'queued', 'rate_limited')
  ORDER BY sj.lease_expires_at DESC
  LIMIT 1;

  SELECT COUNT(*)::INTEGER
  INTO v_queue
  FROM public.scrape_jobs sj
  WHERE sj.jurisdiction ILIKE '%arlington%'
    AND sj.completed_at IS NULL
    AND sj.run_intent = 'foreground'
    AND sj.id <> p_job_id
    AND (
      sj.dispatch_priority > v_job.dispatch_priority
      OR (
        sj.dispatch_priority = v_job.dispatch_priority
        AND sj.requested_at > v_job.requested_at
      )
    );

  IF v_running IS NOT NULL THEN
    v_queue := GREATEST(v_queue, 1);
  ELSE
    v_queue := GREATEST(v_queue, 0);
  END IF;

  job_id := v_job.id;
  run_intent := v_job.run_intent;
  dispatch_priority := v_job.dispatch_priority;
  queue_position := v_queue;
  currently_running_job_id := v_running;
  RETURN NEXT;
END;
$$;

-- Replace enqueue to set foreground intent on create and reuse.
CREATE OR REPLACE FUNCTION public.enqueue_or_get_arlington_scrape_job(
  p_project_id UUID,
  p_user_id UUID,
  p_credential_id UUID,
  p_permit_number TEXT,
  p_normalized_permit_number TEXT,
  p_requested_scope JSONB,
  p_normalized_scope_key TEXT,
  p_scraper_session_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (job public.scrape_jobs, reused_existing BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.scrape_jobs;
  v_inserted public.scrape_jobs;
  v_scope JSONB := COALESCE(p_requested_scope, '{}'::jsonb);
  v_meta JSONB := COALESCE(p_metadata, '{}'::jsonb);
  v_priority INTEGER := EXTRACT(EPOCH FROM now())::INTEGER;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required';
  END IF;
  IF p_normalized_permit_number IS NULL OR length(trim(p_normalized_permit_number)) = 0 THEN
    RAISE EXCEPTION 'normalized_permit_number required';
  END IF;
  IF p_normalized_scope_key IS NULL OR length(trim(p_normalized_scope_key)) = 0 THEN
    RAISE EXCEPTION 'normalized_scope_key required';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.scrape_jobs
  WHERE project_id = p_project_id
    AND jurisdiction ILIKE '%arlington%'
    AND normalized_permit_number = p_normalized_permit_number
    AND normalized_scope_key = p_normalized_scope_key
    AND completed_at IS NULL
    AND status IN ('queued', 'running', 'resuming', 'rate_limited', 'partial', 'waiting_user')
  ORDER BY checkpoint_version DESC NULLS LAST, created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.scrape_jobs
    SET
      run_intent = 'foreground',
      dispatch_priority = GREATEST(COALESCE(dispatch_priority, 0), v_priority),
      requested_at = now(),
      updated_at = now()
    WHERE id = v_existing.id
    RETURNING * INTO v_existing;

    job := v_existing;
    reused_existing := true;
    RETURN NEXT;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.scrape_jobs (
      project_id,
      user_id,
      credential_id,
      scraper_session_id,
      jurisdiction,
      portal_type,
      permit_number,
      normalized_permit_number,
      requested_scope,
      normalized_scope_key,
      status,
      phase,
      attachments_state,
      project_info_state,
      plan_review_state,
      checkpoint_version,
      next_attempt_at,
      attempt_count,
      current_stage,
      current_user_message,
      metadata,
      run_intent,
      dispatch_priority,
      requested_at
    ) VALUES (
      p_project_id,
      p_user_id,
      p_credential_id,
      p_scraper_session_id,
      'Arlington County',
      'accela',
      trim(p_permit_number),
      p_normalized_permit_number,
      v_scope,
      p_normalized_scope_key,
      'queued',
      'record_info',
      'not_started',
      'not_started',
      'not_started',
      0,
      now(),
      0,
      'queued',
      'Arlington scrape queued for durable worker.',
      v_meta,
      'foreground',
      v_priority,
      now()
    )
    RETURNING * INTO v_inserted;

    job := v_inserted;
    reused_existing := false;
    RETURN NEXT;
    RETURN;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT *
      INTO v_existing
      FROM public.scrape_jobs
      WHERE project_id = p_project_id
        AND jurisdiction ILIKE '%arlington%'
        AND normalized_permit_number = p_normalized_permit_number
        AND normalized_scope_key = p_normalized_scope_key
        AND completed_at IS NULL
        AND status IN ('queued', 'running', 'resuming', 'rate_limited', 'partial', 'waiting_user')
      ORDER BY checkpoint_version DESC NULLS LAST, created_at ASC
      LIMIT 1;

      IF NOT FOUND THEN
        RAISE;
      END IF;

      UPDATE public.scrape_jobs
      SET
        run_intent = 'foreground',
        dispatch_priority = GREATEST(COALESCE(dispatch_priority, 0), v_priority),
        requested_at = now(),
        updated_at = now()
      WHERE id = v_existing.id
      RETURNING * INTO v_existing;

      job := v_existing;
      reused_existing := true;
      RETURN NEXT;
      RETURN;
  END;
END;
$$;

-- Priority-aware claim: foreground first, then narrow restart recovery, explicit recovery, due retry.
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
      'duplicate_active_job'
    )
    AND (
      sj.run_intent = 'foreground'
      OR (
        sj.run_intent = 'recovery'
        AND sj.explicitly_resumed_at IS NOT NULL
      )
      OR (
        sj.run_intent = 'retry'
        AND sj.status = 'rate_limited'
        AND (sj.next_attempt_at IS NULL OR sj.next_attempt_at <= now())
      )
      OR (
        sj.run_intent IN ('foreground', 'recovery', 'retry')
        AND sj.status IN ('running', 'resuming')
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
        AND sj.status IN ('running', 'resuming')
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
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.request_arlington_job_dispatch(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_arlington_job_dispatch(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_or_get_arlington_scrape_job(UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_or_get_arlington_scrape_job(UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB) TO service_role;
