-- Temporary Supabase Code Analyzer.
-- This schema is intentionally isolated from Code Analyzer V2 tables, findings,
-- workers, RAG stores, verification records, and learning-loop history.

BEGIN;

CREATE TABLE public.supabase_analyzer_runs (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'queued', 'processing', 'completed', 'completed_with_errors', 'cancelled', 'failed')),
  jurisdiction_key TEXT NOT NULL,
  jurisdiction_label TEXT NOT NULL,
  project_type TEXT NOT NULL,
  code_edition TEXT NOT NULL,
  code_context TEXT NOT NULL,
  source_coverage TEXT NOT NULL DEFAULT 'adoption_metadata_only',
  ai_provider TEXT NOT NULL DEFAULT 'openai',
  ai_model TEXT NOT NULL DEFAULT 'gpt-4o',
  total_sheets INTEGER NOT NULL CHECK (total_sheets BETWEEN 1 AND 100),
  uploaded_sheets INTEGER NOT NULL DEFAULT 0,
  queued_sheets INTEGER NOT NULL DEFAULT 0,
  processing_sheets INTEGER NOT NULL DEFAULT 0,
  completed_sheets INTEGER NOT NULL DEFAULT 0,
  failed_sheets INTEGER NOT NULL DEFAULT 0,
  total_input_tokens BIGINT NOT NULL DEFAULT 0,
  total_output_tokens BIGINT NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  budget_limit_usd NUMERIC(12, 2) NOT NULL DEFAULT 20.00
    CHECK (budget_limit_usd BETWEEN 1 AND 100),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_supabase_analyzer_runs_project_created
  ON public.supabase_analyzer_runs (project_id, created_at DESC);
CREATE INDEX idx_supabase_analyzer_runs_active
  ON public.supabase_analyzer_runs (status, created_at)
  WHERE status IN ('uploading', 'queued', 'processing');

CREATE TABLE public.supabase_analyzer_sheet_jobs (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.supabase_analyzer_runs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 100),
  original_file_name TEXT NOT NULL,
  object_path TEXT NOT NULL UNIQUE,
  file_size BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 15728640),
  mime_type TEXT NOT NULL DEFAULT 'application/pdf'
    CHECK (mime_type = 'application/pdf'),
  discipline TEXT,
  detected_sheet_number TEXT,
  detected_sheet_title TEXT,
  status TEXT NOT NULL DEFAULT 'upload_pending'
    CHECK (status IN ('upload_pending', 'queued', 'processing', 'completed', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 5),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  error_code TEXT,
  openai_response_id TEXT,
  openai_request_id TEXT,
  ai_model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  analysis_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, ordinal),
  UNIQUE (run_id, original_file_name, file_size)
);

CREATE INDEX idx_supabase_analyzer_jobs_claim
  ON public.supabase_analyzer_sheet_jobs (status, available_at, created_at)
  WHERE status IN ('queued', 'processing');
CREATE INDEX idx_supabase_analyzer_jobs_run
  ON public.supabase_analyzer_sheet_jobs (run_id, ordinal);

CREATE TABLE public.supabase_analyzer_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.supabase_analyzer_runs(id) ON DELETE CASCADE,
  sheet_job_id UUID NOT NULL REFERENCES public.supabase_analyzer_sheet_jobs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  finding_index INTEGER NOT NULL CHECK (finding_index BETWEEN 0 AND 49),
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'advisory')),
  title TEXT NOT NULL,
  observation TEXT NOT NULL,
  drawing_evidence TEXT NOT NULL,
  drawing_location TEXT,
  suggested_code_reference TEXT,
  recommendation TEXT NOT NULL,
  ai_provider TEXT NOT NULL,
  ai_model TEXT NOT NULL,
  jurisdiction_key TEXT NOT NULL,
  code_edition TEXT NOT NULL,
  provenance_status TEXT NOT NULL DEFAULT 'model_generated',
  verification_status TEXT NOT NULL DEFAULT 'proposed_reference',
  is_published BOOLEAN NOT NULL DEFAULT false,
  raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sheet_job_id, finding_index)
);

CREATE INDEX idx_supabase_analyzer_findings_run
  ON public.supabase_analyzer_findings (run_id, sheet_job_id, finding_index);

CREATE TABLE public.supabase_analyzer_audit_events (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.supabase_analyzer_runs(id) ON DELETE CASCADE,
  sheet_job_id UUID REFERENCES public.supabase_analyzer_sheet_jobs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  actor_id UUID,
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_supabase_analyzer_audit_run
  ON public.supabase_analyzer_audit_events (run_id, created_at);

ALTER TABLE public.supabase_analyzer_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supabase_analyzer_sheet_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supabase_analyzer_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supabase_analyzer_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view Supabase analyzer runs"
  ON public.supabase_analyzer_runs FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can view Supabase analyzer jobs"
  ON public.supabase_analyzer_sheet_jobs FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can view published Supabase analyzer findings"
  ON public.supabase_analyzer_findings FOR SELECT
  USING (
    is_published
    AND public.has_project_access(auth.uid(), project_id)
  );

CREATE POLICY "Project members can view Supabase analyzer audit events"
  ON public.supabase_analyzer_audit_events FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'supabase-analyzer-drawings',
  'supabase-analyzer-drawings',
  false,
  15728640,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

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
  v_input_tokens BIGINT;
  v_output_tokens BIGINT;
  v_cost NUMERIC(12, 6);
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
    count(*) FILTER (WHERE status = 'failed'),
    COALESCE(sum(input_tokens), 0),
    COALESCE(sum(output_tokens), 0),
    COALESCE(sum(estimated_cost_usd), 0)
  INTO
    v_uploaded, v_queued, v_processing, v_completed, v_failed,
    v_input_tokens, v_output_tokens, v_cost
  FROM public.supabase_analyzer_sheet_jobs
  WHERE run_id = p_run_id;

  UPDATE public.supabase_analyzer_runs
  SET
    uploaded_sheets = v_uploaded,
    queued_sheets = v_queued,
    processing_sheets = v_processing,
    completed_sheets = v_completed,
    failed_sheets = v_failed,
    total_input_tokens = v_input_tokens,
    total_output_tokens = v_output_tokens,
    estimated_cost_usd = v_cost,
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

  UPDATE public.supabase_analyzer_runs
  SET status = 'processing', started_at = COALESCE(started_at, now()), updated_at = now()
  WHERE id = v_job.run_id AND status <> 'cancelled';

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_supabase_analyzer_sheet_job(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_supabase_analyzer_sheet_job(TEXT, INTEGER, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_supabase_analyzer_sheet_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_outcome TEXT,
  p_error TEXT DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_retry_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.supabase_analyzer_sheet_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.supabase_analyzer_sheet_jobs;
BEGIN
  IF p_outcome NOT IN ('completed', 'retry', 'failed') THEN
    RAISE EXCEPTION 'invalid outcome';
  END IF;

  SELECT * INTO v_job
  FROM public.supabase_analyzer_sheet_jobs
  WHERE id = p_job_id
    AND status = 'processing'
    AND lease_owner = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF p_outcome = 'completed' THEN
    UPDATE public.supabase_analyzer_findings
    SET is_published = true, updated_at = now()
    WHERE sheet_job_id = v_job.id;

    UPDATE public.supabase_analyzer_sheet_jobs
    SET status = 'completed',
        completed_at = now(),
        lease_owner = NULL,
        lease_expires_at = NULL,
        last_error = NULL,
        error_code = NULL,
        updated_at = now()
    WHERE id = v_job.id
    RETURNING * INTO v_job;
  ELSIF p_outcome = 'retry' AND v_job.attempt_count < v_job.max_attempts THEN
    UPDATE public.supabase_analyzer_findings
    SET is_published = false, updated_at = now()
    WHERE sheet_job_id = v_job.id;

    UPDATE public.supabase_analyzer_sheet_jobs
    SET status = 'queued',
        available_at = COALESCE(p_retry_at, now() + interval '1 minute'),
        lease_owner = NULL,
        lease_expires_at = NULL,
        last_error = left(p_error, 2000),
        error_code = p_error_code,
        updated_at = now()
    WHERE id = v_job.id
    RETURNING * INTO v_job;
  ELSE
    UPDATE public.supabase_analyzer_findings
    SET is_published = false, updated_at = now()
    WHERE sheet_job_id = v_job.id;

    UPDATE public.supabase_analyzer_sheet_jobs
    SET status = 'failed',
        completed_at = now(),
        lease_owner = NULL,
        lease_expires_at = NULL,
        last_error = left(p_error, 2000),
        error_code = p_error_code,
        updated_at = now()
    WHERE id = v_job.id
    RETURNING * INTO v_job;
  END IF;

  PERFORM public.refresh_supabase_analyzer_run(v_job.run_id);
  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_supabase_analyzer_sheet_job(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_supabase_analyzer_sheet_job(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_supabase_analyzer_processor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  supabase_url TEXT;
  service_role_key TEXT;
BEGIN
  SELECT nullif(decrypted_secret, '') INTO supabase_url
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_project_url'
  LIMIT 1;

  SELECT nullif(decrypted_secret, '') INTO service_role_key
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_service_role_key'
  LIMIT 1;

  IF supabase_url IS NULL OR service_role_key IS NULL THEN
    RAISE WARNING 'Supabase analyzer processor skipped: required Vault secrets are absent';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(supabase_url, '/') || '/functions/v1/supabase-analyzer-processor',
    body := jsonb_build_object('source', 'pg_cron', 'invoked_at', now()),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_supabase_analyzer_processor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_supabase_analyzer_processor() TO postgres;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'supabase-code-analyzer-processor';
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'supabase-code-analyzer-processor',
    '* * * * *',
    $cron$SELECT public.invoke_supabase_analyzer_processor()$cron$
  );
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'pg_cron not available; Supabase analyzer schedule skipped';
  WHEN undefined_function THEN
    RAISE NOTICE 'cron.schedule not available; Supabase analyzer schedule skipped';
END $$;

COMMENT ON TABLE public.supabase_analyzer_runs IS
  'Temporary OpenAI/Supabase analyzer runs. Isolated from Code Analyzer V2.';
COMMENT ON TABLE public.supabase_analyzer_findings IS
  'Preliminary model-generated observations. Never V2 verified findings or learning-loop ground truth.';

COMMIT;
