-- Code Analyzer Async V2 — Milestone 7: DC Code Modification async jobs.

CREATE TABLE IF NOT EXISTS public.code_analyzer_code_mod_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.code_analyzer_runs(id) ON DELETE CASCADE,
  review_id UUID REFERENCES public.code_modification_reviews(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN (
    'form_extraction', 'evidence_sheet', 'merge_findings'
  )),
  document_id UUID REFERENCES public.project_documents(id) ON DELETE SET NULL,
  sheet_id UUID REFERENCES public.code_analyzer_sheets(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_code_analyzer_code_mod_jobs_one_active
  ON public.code_analyzer_code_mod_jobs (run_id, job_type, COALESCE(sheet_id, document_id, '00000000-0000-0000-0000-000000000000'::UUID))
  WHERE status IN ('queued', 'processing') AND cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_code_analyzer_code_mod_jobs_claim
  ON public.code_analyzer_code_mod_jobs (status, available_at, created_at)
  WHERE status = 'queued' AND cancelled_at IS NULL;

ALTER TABLE public.code_analyzer_code_mod_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view code mod jobs" ON public.code_analyzer_code_mod_jobs;
CREATE POLICY "Users can view code mod jobs"
  ON public.code_analyzer_code_mod_jobs FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE OR REPLACE FUNCTION public.claim_code_analyzer_code_mod_job(
  p_worker_id TEXT,
  p_lease_ttl_seconds INTEGER DEFAULT 180
)
RETURNS public.code_analyzer_code_mod_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.code_analyzer_code_mod_jobs;
  v_ttl INTEGER;
BEGIN
  v_ttl := GREATEST(30, COALESCE(p_lease_ttl_seconds, 180));

  SELECT j.*
  INTO v_job
  FROM public.code_analyzer_code_mod_jobs j
  WHERE j.status = 'queued'
    AND j.cancelled_at IS NULL
    AND j.attempt_count < j.max_attempts
    AND j.available_at <= now()
    AND (j.lease_expires_at IS NULL OR j.lease_expires_at < now())
  ORDER BY j.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.code_analyzer_code_mod_jobs
  SET
    status = 'processing',
    lease_owner = p_worker_id,
    lease_expires_at = now() + make_interval(secs => v_ttl),
    attempt_count = attempt_count + 1,
    updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_code_analyzer_code_mod_job(TEXT, INTEGER) TO service_role;
