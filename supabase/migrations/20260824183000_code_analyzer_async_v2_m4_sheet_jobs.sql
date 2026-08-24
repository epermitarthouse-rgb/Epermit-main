-- Code Analyzer Async V2 — Milestone 4: async sheet analysis jobs + run hardening.

ALTER TABLE public.code_analyzer_runs
  DROP CONSTRAINT IF EXISTS code_analyzer_runs_status_check;

ALTER TABLE public.code_analyzer_runs
  ADD CONSTRAINT code_analyzer_runs_status_check
  CHECK (status IN (
    'queued', 'running', 'partial', 'current', 'stale',
    'superseded', 'failed', 'cancelled'
  ));

CREATE TABLE IF NOT EXISTS public.code_analyzer_sheet_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES public.code_analyzer_runs(id) ON DELETE CASCADE,
  sheet_id UUID NOT NULL REFERENCES public.code_analyzer_sheets(id) ON DELETE CASCADE,
  analysis_mode TEXT NOT NULL DEFAULT 'ibc',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  priority SMALLINT NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  last_error TEXT,
  error_code TEXT,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT code_analyzer_sheet_jobs_attempts_check
    CHECK (attempt_count >= 0 AND max_attempts >= 1 AND attempt_count <= max_attempts + 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_code_analyzer_sheet_jobs_one_active
  ON public.code_analyzer_sheet_jobs (run_id, sheet_id, analysis_mode)
  WHERE status IN ('queued', 'processing') AND cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_code_analyzer_sheet_jobs_claim
  ON public.code_analyzer_sheet_jobs (status, available_at, priority, created_at)
  WHERE status = 'queued' AND cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_code_analyzer_sheet_jobs_run
  ON public.code_analyzer_sheet_jobs (run_id, status);

ALTER TABLE public.code_analyzer_sheet_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view sheet jobs" ON public.code_analyzer_sheet_jobs;
CREATE POLICY "Users can view sheet jobs"
  ON public.code_analyzer_sheet_jobs FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP TRIGGER IF EXISTS update_code_analyzer_sheet_jobs_updated_at
  ON public.code_analyzer_sheet_jobs;
CREATE TRIGGER update_code_analyzer_sheet_jobs_updated_at
  BEFORE UPDATE ON public.code_analyzer_sheet_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- One current run per project + analysis_type (DB enforced)
DROP INDEX IF EXISTS idx_code_analyzer_runs_one_current;
CREATE UNIQUE INDEX IF NOT EXISTS idx_code_analyzer_runs_one_current
  ON public.code_analyzer_runs (project_id, analysis_type)
  WHERE status = 'current';

-- Create run + enqueue sheet jobs atomically
CREATE OR REPLACE FUNCTION public.create_code_analyzer_run_async_v2(
  p_project_id UUID,
  p_user_id UUID,
  p_analysis_type TEXT,
  p_jurisdiction TEXT,
  p_project_type TEXT,
  p_code_year TEXT,
  p_analysis_mode TEXT,
  p_source_fingerprint TEXT,
  p_sheet_ids UUID[],
  p_analysis_modes TEXT[] DEFAULT ARRAY['ibc']::TEXT[],
  p_form_document_id UUID DEFAULT NULL,
  p_analysis_instructions TEXT DEFAULT NULL,
  p_index_completeness JSONB DEFAULT NULL
)
RETURNS TABLE (run public.code_analyzer_runs, jobs_created INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.code_analyzer_runs;
  v_sheet_id UUID;
  v_mode TEXT;
  v_count INTEGER := 0;
BEGIN
  IF NOT public.has_project_editor_access(p_user_id, p_project_id) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  -- Supersede open runs for this analysis type
  UPDATE public.code_analyzer_runs
  SET status = 'superseded', updated_at = now()
  WHERE project_id = p_project_id
    AND analysis_type = COALESCE(p_analysis_type, 'standard_compliance')
    AND status IN ('current', 'stale', 'running', 'queued', 'partial', 'failed');

  INSERT INTO public.code_analyzer_runs (
    project_id, user_id, status, jurisdiction, project_type, code_year,
    analysis_mode, analysis_type, source_fingerprint, form_document_id,
    analysis_instructions, index_completeness
  ) VALUES (
    p_project_id, p_user_id, 'queued', p_jurisdiction, p_project_type, p_code_year,
    p_analysis_mode, COALESCE(p_analysis_type, 'standard_compliance'), p_source_fingerprint,
    p_form_document_id, NULLIF(trim(p_analysis_instructions), ''), p_index_completeness
  )
  RETURNING * INTO v_run;

  FOREACH v_sheet_id IN ARRAY COALESCE(p_sheet_ids, ARRAY[]::UUID[])
  LOOP
    FOREACH v_mode IN ARRAY COALESCE(p_analysis_modes, ARRAY['ibc']::TEXT[])
    LOOP
      INSERT INTO public.code_analyzer_sheet_jobs (
        project_id, run_id, sheet_id, analysis_mode, status
      ) VALUES (
        p_project_id, v_run.id, v_sheet_id, v_mode, 'queued'
      )
      ON CONFLICT DO NOTHING;
      v_count := v_count + 1;
    END LOOP;
  END LOOP;

  UPDATE public.code_analyzer_runs
  SET status = 'running', updated_at = now()
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  run := v_run;
  jobs_created := v_count;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_code_analyzer_run_async_v2(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID[], TEXT[], UUID, TEXT, JSONB
) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_code_analyzer_sheet_job(
  p_worker_id TEXT,
  p_lease_ttl_seconds INTEGER DEFAULT 180
)
RETURNS public.code_analyzer_sheet_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.code_analyzer_sheet_jobs;
  v_run public.code_analyzer_runs;
  v_ttl INTEGER;
BEGIN
  v_ttl := GREATEST(30, COALESCE(p_lease_ttl_seconds, 180));

  SELECT j.*
  INTO v_job
  FROM public.code_analyzer_sheet_jobs j
  INNER JOIN public.code_analyzer_runs r ON r.id = j.run_id
  WHERE j.status = 'queued'
    AND j.cancelled_at IS NULL
    AND j.attempt_count < j.max_attempts
    AND j.available_at <= now()
    AND r.status NOT IN ('cancelled', 'superseded')
    AND (j.lease_expires_at IS NULL OR j.lease_expires_at < now())
  ORDER BY j.priority DESC, j.available_at ASC, j.created_at ASC
  LIMIT 1
  FOR UPDATE OF j SKIP LOCKED;

  IF NOT FOUND THEN
    SELECT j.*
    INTO v_job
    FROM public.code_analyzer_sheet_jobs j
    WHERE j.status = 'processing'
      AND j.cancelled_at IS NULL
      AND j.lease_expires_at IS NOT NULL
      AND j.lease_expires_at < now()
    ORDER BY j.lease_expires_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
  END IF;

  SELECT * INTO v_run FROM public.code_analyzer_runs WHERE id = v_job.run_id;
  IF v_run.status = 'cancelled' THEN
    UPDATE public.code_analyzer_sheet_jobs
    SET status = 'cancelled', cancelled_at = now(), lease_owner = NULL, lease_expires_at = NULL
    WHERE id = v_job.id;
    RETURN NULL;
  END IF;

  UPDATE public.code_analyzer_sheet_jobs
  SET
    status = 'processing',
    lease_owner = p_worker_id,
    lease_expires_at = now() + make_interval(secs => v_ttl),
    last_heartbeat_at = now(),
    started_at = COALESCE(started_at, now()),
    attempt_count = attempt_count + 1,
    updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_code_analyzer_sheet_job(TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_code_analyzer_sheet_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_status TEXT,
  p_last_error TEXT DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_available_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.code_analyzer_sheet_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.code_analyzer_sheet_jobs;
  v_run_id UUID;
  v_pending INTEGER;
  v_failed INTEGER;
BEGIN
  IF p_status NOT IN ('queued', 'processing', 'completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  SELECT * INTO v_job
  FROM public.code_analyzer_sheet_jobs
  WHERE id = p_job_id AND lease_owner = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_job.status IN ('completed', 'cancelled') AND p_status IN ('queued', 'processing') THEN
    RAISE EXCEPTION 'cannot re-open terminal job';
  END IF;

  UPDATE public.code_analyzer_sheet_jobs
  SET
    status = p_status,
    last_error = p_last_error,
    error_code = p_error_code,
    available_at = COALESCE(p_available_at, available_at),
    completed_at = CASE WHEN p_status IN ('completed', 'failed', 'cancelled') THEN now() ELSE completed_at END,
    lease_owner = CASE WHEN p_status = 'processing' THEN lease_owner ELSE NULL END,
    lease_expires_at = CASE WHEN p_status = 'processing' THEN lease_expires_at ELSE NULL END,
    updated_at = now()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  v_run_id := v_job.run_id;

  SELECT COUNT(*) INTO v_pending
  FROM public.code_analyzer_sheet_jobs
  WHERE run_id = v_run_id AND status IN ('queued', 'processing');

  SELECT COUNT(*) INTO v_failed
  FROM public.code_analyzer_sheet_jobs
  WHERE run_id = v_run_id AND status = 'failed';

  IF v_pending = 0 THEN
    UPDATE public.code_analyzer_runs
    SET
      status = CASE WHEN v_failed > 0 THEN 'partial' ELSE 'current' END,
      completed_at = now(),
      updated_at = now()
    WHERE id = v_run_id AND status NOT IN ('cancelled', 'superseded');
  END IF;

  RETURN v_job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_code_analyzer_sheet_job(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_code_analyzer_run_v2(
  p_run_id UUID,
  p_user_id UUID
)
RETURNS public.code_analyzer_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.code_analyzer_runs;
BEGIN
  SELECT * INTO v_run FROM public.code_analyzer_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'run not found';
  END IF;

  IF NOT public.has_project_editor_access(p_user_id, v_run.project_id) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  UPDATE public.code_analyzer_runs
  SET status = 'cancelled', updated_at = now(), completed_at = now()
  WHERE id = p_run_id
  RETURNING * INTO v_run;

  UPDATE public.code_analyzer_sheet_jobs
  SET
    status = 'cancelled',
    cancelled_at = now(),
    lease_owner = NULL,
    lease_expires_at = NULL,
    updated_at = now()
  WHERE run_id = p_run_id AND status IN ('queued', 'processing');

  RETURN v_run;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_code_analyzer_run_v2(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.retry_failed_sheet_jobs_v2(
  p_run_id UUID,
  p_user_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.code_analyzer_runs;
  v_count INTEGER;
BEGIN
  SELECT * INTO v_run FROM public.code_analyzer_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'run not found';
  END IF;

  IF NOT public.has_project_editor_access(p_user_id, v_run.project_id) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  UPDATE public.code_analyzer_sheet_jobs
  SET
    status = 'queued',
    attempt_count = 0,
    last_error = NULL,
    error_code = NULL,
    available_at = now(),
    cancelled_at = NULL,
    completed_at = NULL,
    lease_owner = NULL,
    lease_expires_at = NULL,
    updated_at = now()
  WHERE run_id = p_run_id AND status = 'failed';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    UPDATE public.code_analyzer_runs
    SET status = 'running', completed_at = NULL, updated_at = now()
    WHERE id = p_run_id AND status IN ('partial', 'failed', 'current');
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.retry_failed_sheet_jobs_v2(UUID, UUID) TO authenticated;
