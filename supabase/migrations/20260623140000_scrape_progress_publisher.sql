-- Atomic scrape event sequence + last_activity_at for shared live-progress publisher.

ALTER TABLE public.scrape_jobs
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.scrape_job_event_counters (
  job_id UUID PRIMARY KEY REFERENCES public.scrape_jobs(id) ON DELETE CASCADE,
  last_sequence BIGINT NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.allocate_scrape_event_sequence(p_job_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  INSERT INTO public.scrape_job_event_counters AS c (job_id, last_sequence)
  VALUES (p_job_id, 1)
  ON CONFLICT (job_id) DO UPDATE
  SET last_sequence = c.last_sequence + 1
  RETURNING last_sequence INTO v_seq;
  RETURN v_seq;
END;
$$;

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
BEGIN
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
    p_event_type,
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
    WHERE id = p_job_id;
  ELSE
    UPDATE public.scrape_jobs
    SET
      last_heartbeat_at = v_now,
      last_activity_at = v_now,
      current_stage = COALESCE(p_stage, current_stage),
      current_user_message = COALESCE(NULLIF(trim(p_user_message), ''), current_user_message),
      progress_current = COALESCE(p_progress_current, progress_current),
      progress_total = COALESCE(p_progress_total, progress_total),
      status = COALESCE(p_status, status)
    WHERE id = p_job_id;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_scrape_event_sequence(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_scrape_event(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, JSONB, BOOLEAN
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.allocate_scrape_event_sequence(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_scrape_event(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, JSONB, BOOLEAN
) TO service_role;
