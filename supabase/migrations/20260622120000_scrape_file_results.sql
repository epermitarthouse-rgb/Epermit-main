-- Per-file scrape progress (run-scoped). Live UI reads this table; final portal_data.tabs.files
-- is reconciled only after a successful scrape job completes.

CREATE TABLE IF NOT EXISTS public.scrape_file_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scrape_job_id UUID NOT NULL REFERENCES public.scrape_jobs(id) ON DELETE CASCADE,
  jurisdiction TEXT NOT NULL,
  portal_file_id TEXT NOT NULL,
  file_version TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL,
  folder_name TEXT,
  parent_folder TEXT,
  status TEXT NOT NULL,
  storage_path TEXT,
  public_url TEXT,
  source_url TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  progress_current INTEGER,
  progress_total INTEGER,
  failure_code TEXT,
  failure_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  discovered_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scrape_file_results_status_check CHECK (
    status IN (
      'discovered',
      'downloading',
      'uploaded',
      'retrying',
      'failed',
      'skipped'
    )
  ),
  CONSTRAINT scrape_file_results_unique_file UNIQUE (
    project_id,
    scrape_job_id,
    portal_file_id,
    file_version
  )
);

CREATE INDEX IF NOT EXISTS idx_scrape_file_results_job
  ON public.scrape_file_results(scrape_job_id);

CREATE INDEX IF NOT EXISTS idx_scrape_file_results_project
  ON public.scrape_file_results(project_id);

CREATE INDEX IF NOT EXISTS idx_scrape_file_results_status
  ON public.scrape_file_results(status);

CREATE INDEX IF NOT EXISTS idx_scrape_file_results_updated
  ON public.scrape_file_results(updated_at DESC);

CREATE OR REPLACE FUNCTION public.set_scrape_file_results_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scrape_file_results_updated_at ON public.scrape_file_results;
CREATE TRIGGER trg_scrape_file_results_updated_at
  BEFORE UPDATE ON public.scrape_file_results
  FOR EACH ROW
  EXECUTE FUNCTION public.set_scrape_file_results_updated_at();

ALTER TABLE public.scrape_file_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view scrape_file_results for accessible projects"
  ON public.scrape_file_results
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

-- Service role bypasses RLS for scraper-service writes.

ALTER TABLE public.scrape_file_results REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'scrape_file_results'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scrape_file_results;
  END IF;
END $$;
