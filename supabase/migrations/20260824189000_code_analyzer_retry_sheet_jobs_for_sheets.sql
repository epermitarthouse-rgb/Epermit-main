-- Retry failed sheet jobs scoped to specific sheets (document-level retry UX).

CREATE OR REPLACE FUNCTION public.retry_failed_sheet_jobs_for_sheets_v2(
  p_run_id UUID,
  p_user_id UUID,
  p_sheet_ids UUID[]
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

  IF p_sheet_ids IS NULL OR array_length(p_sheet_ids, 1) IS NULL THEN
    RETURN 0;
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
  WHERE run_id = p_run_id
    AND status = 'failed'
    AND sheet_id = ANY(p_sheet_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    UPDATE public.code_analyzer_runs
    SET status = 'running', completed_at = NULL, updated_at = now()
    WHERE id = p_run_id AND status IN ('partial', 'failed', 'current', 'running');
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.retry_failed_sheet_jobs_for_sheets_v2(UUID, UUID, UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.retry_failed_ingestion_job_v2(
  p_job_id UUID,
  p_user_id UUID
)
RETURNS public.code_analyzer_ingestion_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.code_analyzer_ingestion_jobs;
BEGIN
  SELECT * INTO v_job FROM public.code_analyzer_ingestion_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ingestion job not found';
  END IF;

  IF NOT public.has_project_editor_access(p_user_id, v_job.project_id) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  IF v_job.status <> 'failed' THEN
    RAISE EXCEPTION 'only failed ingestion jobs can be retried';
  END IF;

  UPDATE public.code_analyzer_ingestion_jobs
  SET
    status = 'pending',
    progress_phase = 'queued',
    attempt_count = 0,
    last_error = NULL,
    error_code = NULL,
    available_at = now(),
    cancelled_at = NULL,
    completed_at = NULL,
    lease_owner = NULL,
    lease_expires_at = NULL,
    updated_at = now()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  UPDATE public.project_documents
  SET analyzer_processing_status = 'queued', updated_at = now()
  WHERE id = v_job.document_id;

  RETURN v_job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.retry_failed_ingestion_job_v2(UUID, UUID) TO authenticated;
