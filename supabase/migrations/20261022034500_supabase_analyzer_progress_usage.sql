-- Keep progress counters current at claim time and preserve cumulative API usage
-- across retries. This remains isolated from Code Analyzer V2.

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_supabase_analyzer_run(p_run_id UUID)
RETURNS public.supabase_analyzer_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.supabase_analyzer_runs;
  v_uploaded INTEGER;
  v_queued INTEGER;
  v_processing INTEGER;
  v_completed INTEGER;
  v_failed INTEGER;
BEGIN
  SELECT * INTO v_run
  FROM public.supabase_analyzer_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    count(*) FILTER (WHERE status <> 'upload_pending'),
    count(*) FILTER (WHERE status = 'queued'),
    count(*) FILTER (WHERE status = 'processing'),
    count(*) FILTER (WHERE status = 'completed'),
    count(*) FILTER (WHERE status = 'failed')
  INTO v_uploaded, v_queued, v_processing, v_completed, v_failed
  FROM public.supabase_analyzer_sheet_jobs
  WHERE run_id = p_run_id;

  UPDATE public.supabase_analyzer_runs
  SET
    uploaded_sheets = v_uploaded,
    queued_sheets = v_queued,
    processing_sheets = v_processing,
    completed_sheets = v_completed,
    failed_sheets = v_failed,
    status = CASE
      WHEN status = 'cancelled' THEN 'cancelled'
      WHEN v_completed + v_failed = total_sheets AND v_failed = 0 THEN 'completed'
      WHEN v_completed + v_failed = total_sheets THEN 'completed_with_errors'
      WHEN v_processing > 0 THEN 'processing'
      WHEN v_queued > 0 THEN 'queued'
      ELSE 'uploading'
    END,
    started_at = CASE
      WHEN v_processing + v_completed + v_failed > 0 THEN COALESCE(started_at, now())
      ELSE started_at
    END,
    completed_at = CASE
      WHEN v_completed + v_failed = total_sheets THEN COALESCE(completed_at, now())
      ELSE NULL
    END,
    updated_at = now()
  WHERE id = p_run_id
  RETURNING * INTO v_run;

  RETURN v_run;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_supabase_analyzer_run(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_supabase_analyzer_run(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_supabase_analyzer_sheet_job(
  p_worker_id TEXT,
  p_lease_ttl_seconds INTEGER DEFAULT 180,
  p_global_concurrency INTEGER DEFAULT 3
)
RETURNS public.supabase_analyzer_sheet_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.supabase_analyzer_sheet_jobs;
  v_active INTEGER;
  v_ttl INTEGER := GREATEST(60, LEAST(COALESCE(p_lease_ttl_seconds, 180), 300));
  v_max_active INTEGER := GREATEST(1, LEAST(COALESCE(p_global_concurrency, 3), 5));
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('supabase-analyzer-global-claim'));

  SELECT count(*) INTO v_active
  FROM public.supabase_analyzer_sheet_jobs
  WHERE status = 'processing'
    AND lease_expires_at > now();

  IF v_active >= v_max_active THEN
    RETURN NULL;
  END IF;

  SELECT j.* INTO v_job
  FROM public.supabase_analyzer_sheet_jobs j
  JOIN public.supabase_analyzer_runs r ON r.id = j.run_id
  WHERE (
      (j.status = 'queued' AND j.available_at <= now())
      OR (j.status = 'processing' AND j.lease_expires_at < now())
    )
    AND j.attempt_count < j.max_attempts
    AND r.status IN ('queued', 'processing')
    AND r.cancelled_at IS NULL
    AND r.estimated_cost_usd < r.budget_limit_usd
  ORDER BY j.available_at, j.created_at
  LIMIT 1
  FOR UPDATE OF j SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.supabase_analyzer_sheet_jobs
  SET
    status = 'processing',
    attempt_count = attempt_count + 1,
    lease_owner = p_worker_id,
    lease_expires_at = now() + make_interval(secs => v_ttl),
    started_at = COALESCE(started_at, now()),
    last_error = NULL,
    error_code = NULL,
    updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  PERFORM public.refresh_supabase_analyzer_run(v_job.run_id);
  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_supabase_analyzer_sheet_job(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_supabase_analyzer_sheet_job(TEXT, INTEGER, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.record_supabase_analyzer_usage(
  p_run_id UUID,
  p_input_tokens INTEGER,
  p_output_tokens INTEGER,
  p_estimated_cost_usd NUMERIC
)
RETURNS public.supabase_analyzer_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.supabase_analyzer_runs;
BEGIN
  UPDATE public.supabase_analyzer_runs
  SET
    total_input_tokens = total_input_tokens + GREATEST(COALESCE(p_input_tokens, 0), 0),
    total_output_tokens = total_output_tokens + GREATEST(COALESCE(p_output_tokens, 0), 0),
    estimated_cost_usd = estimated_cost_usd + GREATEST(COALESCE(p_estimated_cost_usd, 0), 0),
    updated_at = now()
  WHERE id = p_run_id
  RETURNING * INTO v_run;
  RETURN v_run;
END;
$$;

REVOKE ALL ON FUNCTION public.record_supabase_analyzer_usage(UUID, INTEGER, INTEGER, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_supabase_analyzer_usage(UUID, INTEGER, INTEGER, NUMERIC) TO service_role;

COMMIT;
