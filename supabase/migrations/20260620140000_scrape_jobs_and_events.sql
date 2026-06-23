-- Durable scraper progress: jobs + ordered event stream (Realtime-enabled).

CREATE TABLE IF NOT EXISTS public.scrape_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  credential_id UUID REFERENCES public.portal_credentials(id) ON DELETE SET NULL,
  scraper_session_id TEXT,
  jurisdiction TEXT NOT NULL,
  portal_type TEXT,
  permit_number TEXT,
  scrape_mode TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  current_stage TEXT,
  current_user_message TEXT,
  progress_current INTEGER,
  progress_total INTEGER,
  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  error_code TEXT,
  error_user_message TEXT,
  cancelled_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scrape_jobs_status_check CHECK (
    status IN (
      'queued',
      'running',
      'waiting_user',
      'completed',
      'completed_with_warnings',
      'failed',
      'cancelled'
    )
  )
);

CREATE TABLE IF NOT EXISTS public.scrape_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.scrape_jobs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  stage TEXT,
  status TEXT,
  user_message TEXT NOT NULL,
  technical_message TEXT,
  progress_current INTEGER,
  progress_total INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scrape_events_job_sequence_unique UNIQUE (job_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_project_created
  ON public.scrape_jobs(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_events_job_sequence
  ON public.scrape_events(job_id, sequence);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_session
  ON public.scrape_jobs(scraper_session_id)
  WHERE scraper_session_id IS NOT NULL;

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.set_scrape_jobs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scrape_jobs_updated_at ON public.scrape_jobs;
CREATE TRIGGER trg_scrape_jobs_updated_at
  BEFORE UPDATE ON public.scrape_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_scrape_jobs_updated_at();

ALTER TABLE public.scrape_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrape_events ENABLE ROW LEVEL SECURITY;

-- Read access for project members (owner or team)
CREATE POLICY "Users can view scrape_jobs for accessible projects"
  ON public.scrape_jobs
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can view scrape_events for accessible projects"
  ON public.scrape_events
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

-- Service role bypasses RLS for writes from scraper-service.

ALTER TABLE public.scrape_jobs REPLICA IDENTITY FULL;
ALTER TABLE public.scrape_events REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'scrape_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scrape_jobs;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'scrape_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scrape_events;
  END IF;
END $$;
