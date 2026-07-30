-- Shared scrape cancellation: add in-flight `cancelling` status and guard
-- publish_scrape_event so cancelled/cancelling jobs cannot be revived to running/completed.

ALTER TABLE public.scrape_jobs
  DROP CONSTRAINT IF EXISTS scrape_jobs_status_check;

ALTER TABLE public.scrape_jobs
  ADD CONSTRAINT scrape_jobs_status_check CHECK (
    status IN (
      'queued',
      'running',
      'resuming',
      'rate_limited',
      'partial',
      'waiting_user',
      'cancelling',
      'completed',
      'completed_with_warnings',
      'partial_external_blocker',
      'failed',
      'failed_unrecoverable',
      'cancelled'
    )
  );

CREATE OR REPLACE FUNCTION public.publish_scrape_event(
  p_job_id UUID,
  p_project_id UUID,
  p_event_type TEXT,
  p_stage TEXT,
  p_status TEXT,
  p_user_message TEXT,
  p_technical_message TEXT DEFAULT NULL,
  p_progress_current INTEGER DEFAULT NULL,
  p_progress_total INTEGER DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_is_heartbeat BOOLEAN DEFAULT FALSE
)
RETURNS public.scrape_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq BIGINT;
  v_now TIMESTAMPTZ := now();
  v_row public.scrape_events;
  v_job_status TEXT;
  v_completed_at TIMESTAMPTZ;
  v_event_type TEXT := COALESCE(NULLIF(trim(p_event_type), ''), 'progress');
BEGIN
  SELECT sj.status, sj.completed_at
  INTO v_job_status, v_completed_at
  FROM public.scrape_jobs sj
  WHERE sj.id = p_job_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'scrape job % not found', p_job_id;
  END IF;

  -- After terminal cancel, suppress further progress (allow only scrape_cancelled).
  IF (
    v_job_status = 'cancelled'
    OR v_completed_at IS NOT NULL
  )
    AND v_event_type IS DISTINCT FROM 'scrape_cancelled'
  THEN
    RETURN NULL;
  END IF;

  -- During cancelling, only cancel-related / heartbeat-safe events may patch the job.
  IF v_job_status = 'cancelling'
    AND v_event_type NOT IN ('scrape_cancelled', 'scrape_cancelling', 'heartbeat')
    AND COALESCE(p_status, '') NOT IN ('cancelling', 'cancelled')
  THEN
    RETURN NULL;
  END IF;

  v_seq := public.allocate_scrape_event_sequence(p_job_id);

  INSERT INTO public.scrape_events (
    job_id,
    project_id,
    sequence,
    event_type,
    stage,
    status,
    user_message,
    technical_message,
    progress_current,
    progress_total,
    metadata
  )
  VALUES (
    p_job_id,
    p_project_id,
    v_seq,
    v_event_type,
    p_stage,
    p_status,
    COALESCE(NULLIF(trim(p_user_message), ''), 'Working…'),
    p_technical_message,
    p_progress_current,
    p_progress_total,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO v_row;

  IF p_is_heartbeat THEN
    UPDATE public.scrape_jobs
    SET last_heartbeat_at = v_now
    WHERE id = p_job_id
      AND status IS DISTINCT FROM 'cancelled'
      AND completed_at IS NULL;
  ELSE
    UPDATE public.scrape_jobs
    SET
      last_heartbeat_at = v_now,
      last_activity_at = v_now,
      current_stage = COALESCE(p_stage, current_stage),
      current_user_message = COALESCE(NULLIF(trim(p_user_message), ''), current_user_message),
      progress_current = COALESCE(p_progress_current, progress_current),
      progress_total = COALESCE(p_progress_total, progress_total),
      status = CASE
        WHEN status IN ('cancelled', 'cancelling')
          AND COALESCE(p_status, status) NOT IN ('cancelled', 'cancelling')
          THEN status
        ELSE COALESCE(p_status, status)
      END
    WHERE id = p_job_id
      AND status IS DISTINCT FROM 'cancelled'
      AND completed_at IS NULL;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_scrape_event(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, JSONB, BOOLEAN
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.publish_scrape_event(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, JSONB, BOOLEAN
) TO service_role;
