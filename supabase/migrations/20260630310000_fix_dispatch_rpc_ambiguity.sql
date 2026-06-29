-- Fix ambiguous dispatch_priority references in Arlington dispatch RPCs.

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
    AND sj.jurisdiction ILIKE '%arlington%'
    AND sj.completed_at IS NULL
    AND sj.status NOT IN ('completed', 'completed_with_warnings', 'partial_external_blocker', 'failed', 'failed_unrecoverable', 'cancelled')
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
    UPDATE public.scrape_jobs sj
    SET
      run_intent = 'foreground',
      dispatch_priority = GREATEST(COALESCE(sj.dispatch_priority, 0), v_priority),
      requested_at = now(),
      updated_at = now()
    WHERE sj.id = v_existing.id
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

      UPDATE public.scrape_jobs sj
      SET
        run_intent = 'foreground',
        dispatch_priority = GREATEST(COALESCE(sj.dispatch_priority, 0), v_priority),
        requested_at = now(),
        updated_at = now()
      WHERE sj.id = v_existing.id
      RETURNING * INTO v_existing;

      job := v_existing;
      reused_existing := true;
      RETURN NEXT;
      RETURN;
  END;
END;
$$;
