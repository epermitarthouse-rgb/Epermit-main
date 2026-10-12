-- Code Analyzer Async V2 — complete DC Code Modification async wiring.

CREATE OR REPLACE FUNCTION public.complete_code_analyzer_code_mod_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_status TEXT,
  p_result JSONB DEFAULT NULL,
  p_last_error TEXT DEFAULT NULL,
  p_available_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.code_analyzer_code_mod_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.code_analyzer_code_mod_jobs;
  v_run_id UUID;
  v_pending INTEGER;
  v_failed INTEGER;
BEGIN
  IF p_status NOT IN ('queued', 'processing', 'completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  SELECT * INTO v_job
  FROM public.code_analyzer_code_mod_jobs
  WHERE id = p_job_id AND lease_owner = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.code_analyzer_code_mod_jobs
  SET
    status = p_status,
    result = COALESCE(p_result, result),
    last_error = p_last_error,
    available_at = COALESCE(p_available_at, available_at),
    completed_at = CASE WHEN p_status IN ('completed', 'failed', 'cancelled') THEN now() ELSE completed_at END,
    lease_owner = CASE WHEN p_status = 'processing' THEN lease_owner ELSE NULL END,
    lease_expires_at = CASE WHEN p_status = 'processing' THEN lease_expires_at ELSE NULL END,
    updated_at = now()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  v_run_id := v_job.run_id;
  IF v_run_id IS NOT NULL AND p_status IN ('completed', 'failed', 'cancelled') THEN
    SELECT COUNT(*) INTO v_pending
    FROM public.code_analyzer_code_mod_jobs
    WHERE run_id = v_run_id AND status IN ('queued', 'processing');

    SELECT COUNT(*) INTO v_failed
    FROM public.code_analyzer_code_mod_jobs
    WHERE run_id = v_run_id AND status = 'failed';

    IF v_pending = 0 THEN
      UPDATE public.code_analyzer_runs
      SET
        status = CASE WHEN v_failed > 0 THEN 'partial' ELSE 'current' END,
        completed_at = now(),
        updated_at = now()
      WHERE id = v_run_id AND status NOT IN ('cancelled', 'superseded');
    END IF;
  END IF;

  RETURN v_job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_code_analyzer_code_mod_job(UUID, TEXT, TEXT, JSONB, TEXT, TIMESTAMPTZ)
  TO service_role;

CREATE OR REPLACE FUNCTION public.create_code_modification_run_async_v2(
  p_project_id UUID,
  p_user_id UUID,
  p_jurisdiction TEXT,
  p_project_type TEXT,
  p_code_year TEXT,
  p_source_fingerprint TEXT,
  p_form_document_ids UUID[],
  p_evidence_sheet_ids UUID[],
  p_excluded_evidence_document_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_analysis_instructions TEXT DEFAULT NULL,
  p_form_fingerprint TEXT DEFAULT NULL
)
RETURNS TABLE (run public.code_analyzer_runs, jobs_created INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.code_analyzer_runs;
  v_primary_form UUID;
  v_count INTEGER := 0;
  v_sheet_id UUID;
BEGIN
  IF NOT public.has_project_editor_access(p_user_id, p_project_id) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  IF p_form_document_ids IS NULL OR array_length(p_form_document_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one form document is required';
  END IF;

  v_primary_form := p_form_document_ids[1];

  UPDATE public.code_analyzer_runs
  SET status = 'superseded', updated_at = now()
  WHERE project_id = p_project_id
    AND analysis_type = 'dc_code_modification'
    AND status IN ('current', 'stale', 'running', 'queued', 'partial', 'failed');

  INSERT INTO public.code_analyzer_runs (
    project_id, user_id, status, jurisdiction, project_type, code_year,
    analysis_mode, analysis_type, source_fingerprint, form_document_id,
    analysis_instructions
  ) VALUES (
    p_project_id, p_user_id, 'running', p_jurisdiction, p_project_type, p_code_year,
    'dc_code_modification', 'dc_code_modification', p_source_fingerprint, v_primary_form,
    NULLIF(trim(p_analysis_instructions), '')
  )
  RETURNING * INTO v_run;

  INSERT INTO public.code_analyzer_code_mod_jobs (
    project_id, run_id, job_type, document_id, status, payload
  ) VALUES (
    p_project_id, v_run.id, 'form_extraction', v_primary_form, 'queued',
    jsonb_build_object(
      'form_document_ids', to_jsonb(p_form_document_ids),
      'form_fingerprint', COALESCE(p_form_fingerprint, ''),
      'excluded_evidence_document_ids', to_jsonb(COALESCE(p_excluded_evidence_document_ids, ARRAY[]::UUID[]))
    )
  );
  v_count := v_count + 1;

  FOREACH v_sheet_id IN ARRAY COALESCE(p_evidence_sheet_ids, ARRAY[]::UUID[])
  LOOP
    INSERT INTO public.code_analyzer_code_mod_jobs (
      project_id, run_id, job_type, sheet_id, status, payload
    ) VALUES (
      p_project_id, v_run.id, 'evidence_sheet', v_sheet_id, 'queued',
      jsonb_build_object('depends_on_form', true)
    );
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.code_analyzer_code_mod_jobs (
    project_id, run_id, job_type, status, payload, available_at
  ) VALUES (
    p_project_id, v_run.id, 'merge_findings', 'queued',
    jsonb_build_object(
      'form_document_ids', to_jsonb(p_form_document_ids),
      'form_fingerprint', COALESCE(p_form_fingerprint, ''),
      'excluded_evidence_document_ids', to_jsonb(COALESCE(p_excluded_evidence_document_ids, ARRAY[]::UUID[]))
    ),
    now() + interval '1 second'
  );
  v_count := v_count + 1;

  run := v_run;
  jobs_created := v_count;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_code_modification_run_async_v2(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID[], UUID[], UUID[], TEXT, TEXT
) TO authenticated;

CREATE OR REPLACE FUNCTION public.retry_failed_code_mod_jobs_v2(
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
  IF NOT FOUND THEN RAISE EXCEPTION 'run not found'; END IF;
  IF NOT public.has_project_editor_access(p_user_id, v_run.project_id) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  UPDATE public.code_analyzer_code_mod_jobs
  SET
    status = 'queued',
    attempt_count = 0,
    last_error = NULL,
    result = NULL,
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
    WHERE id = p_run_id;
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.retry_failed_code_mod_jobs_v2(UUID, UUID) TO authenticated;

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
  IF NOT FOUND THEN RAISE EXCEPTION 'run not found'; END IF;
  IF NOT public.has_project_editor_access(p_user_id, v_run.project_id) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  UPDATE public.code_analyzer_runs
  SET status = 'cancelled', updated_at = now(), completed_at = now()
  WHERE id = p_run_id
  RETURNING * INTO v_run;

  UPDATE public.code_analyzer_sheet_jobs
  SET status = 'cancelled', cancelled_at = now(), lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE run_id = p_run_id AND status IN ('queued', 'processing');

  UPDATE public.code_analyzer_code_mod_jobs
  SET status = 'cancelled', cancelled_at = now(), lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE run_id = p_run_id AND status IN ('queued', 'processing');

  RETURN v_run;
END;
$$;
