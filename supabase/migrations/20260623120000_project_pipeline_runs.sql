-- Durable post-scrape intake pipeline runs (parser → classifier → enrichment → auto-routing).
-- Schema derived from intake-pipeline-agent reads/writes and AgentWorkflowStatus queries.

CREATE TABLE IF NOT EXISTS public.project_pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  portal_data_hash TEXT,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  current_stage TEXT,
  stages JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_pipeline_runs_status_check CHECK (
    status IN (
      'pending',
      'running',
      'completed',
      'completed_with_warnings',
      'failed',
      'cancelled'
    )
  )
);

-- Backfill columns when an older partial definition exists.
ALTER TABLE public.project_pipeline_runs
  ADD COLUMN IF NOT EXISTS portal_data_hash TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS current_stage TEXT,
  ADD COLUMN IF NOT EXISTS stages JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Prevent duplicate runs for the same portal scrape hash per project.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_pipeline_runs_idempotency
  ON public.project_pipeline_runs(project_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_pipeline_runs_project_id
  ON public.project_pipeline_runs(project_id);

CREATE INDEX IF NOT EXISTS idx_project_pipeline_runs_project_started
  ON public.project_pipeline_runs(project_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_pipeline_runs_status
  ON public.project_pipeline_runs(status);

CREATE INDEX IF NOT EXISTS idx_project_pipeline_runs_updated_at
  ON public.project_pipeline_runs(updated_at DESC);

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

DROP POLICY IF EXISTS "Users can manage pipeline runs for accessible projects"
  ON public.project_pipeline_runs;
DROP POLICY IF EXISTS "Users can view pipeline runs for accessible projects"
  ON public.project_pipeline_runs;

CREATE POLICY "Users can view pipeline runs for accessible projects"
  ON public.project_pipeline_runs
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

-- Writes use service role from intake-pipeline-agent (bypasses RLS).
