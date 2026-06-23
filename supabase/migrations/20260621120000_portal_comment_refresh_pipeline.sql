-- Portal comment refresh staging + durable post-scrape pipeline runs.

ALTER TABLE public.parsed_comments
  DROP CONSTRAINT IF EXISTS parsed_comments_ingest_source_check;

ALTER TABLE public.parsed_comments
  ADD CONSTRAINT parsed_comments_ingest_source_check
  CHECK (ingest_source IN ('raw_ref', 'raw_ref_staging', 'fallback_llm', 'manual_letter'));

CREATE TABLE IF NOT EXISTS public.project_pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  portal_data_hash TEXT,
  scrape_job_id UUID REFERENCES public.scrape_jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running',
  current_stage TEXT,
  stages JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_pipeline_runs_status_check CHECK (
    status IN ('pending', 'running', 'completed', 'completed_with_warnings', 'failed', 'cancelled')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_pipeline_runs_idempotency
  ON public.project_pipeline_runs(project_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_pipeline_runs_project_started
  ON public.project_pipeline_runs(project_id, started_at DESC);

CREATE OR REPLACE FUNCTION public.set_project_pipeline_runs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_pipeline_runs_updated_at ON public.project_pipeline_runs;
CREATE TRIGGER trg_project_pipeline_runs_updated_at
  BEFORE UPDATE ON public.project_pipeline_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_project_pipeline_runs_updated_at();

ALTER TABLE public.project_pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view pipeline runs for accessible projects"
  ON public.project_pipeline_runs
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can manage pipeline runs for accessible projects"
  ON public.project_pipeline_runs
  FOR ALL
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));
