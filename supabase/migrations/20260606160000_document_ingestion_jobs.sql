-- Background document ingestion jobs (processed by document-ingestion-worker, not Edge).

CREATE TABLE IF NOT EXISTS public.document_ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_pages INTEGER,
  processed_pages INTEGER NOT NULL DEFAULT 0,
  failed_pages INTEGER NOT NULL DEFAULT 0,
  total_chunks INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT document_ingestion_jobs_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'partial', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_document_ingestion_jobs_status_created
  ON public.document_ingestion_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_document_ingestion_jobs_project_id
  ON public.document_ingestion_jobs(project_id);

CREATE INDEX IF NOT EXISTS idx_document_ingestion_jobs_document_id
  ON public.document_ingestion_jobs(document_id);

CREATE INDEX IF NOT EXISTS idx_document_ingestion_jobs_user_id
  ON public.document_ingestion_jobs(user_id);

ALTER TABLE public.document_ingestion_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view ingestion jobs for accessible projects" ON public.document_ingestion_jobs;
CREATE POLICY "Users can view ingestion jobs for accessible projects"
  ON public.document_ingestion_jobs
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

-- Extend project_documents.ai_ingestion_status values
ALTER TABLE public.project_documents
  DROP CONSTRAINT IF EXISTS project_documents_ai_ingestion_status_check;

ALTER TABLE public.project_documents
  ADD CONSTRAINT project_documents_ai_ingestion_status_check
  CHECK (
    ai_ingestion_status IN (
      'not_started',
      'queued',
      'processing',
      'completed',
      'failed',
      'low_text',
      'unsupported',
      'partial'
    )
  );

CREATE OR REPLACE FUNCTION public.touch_document_ingestion_jobs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_ingestion_jobs_updated_at ON public.document_ingestion_jobs;
CREATE TRIGGER trg_document_ingestion_jobs_updated_at
  BEFORE UPDATE ON public.document_ingestion_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_document_ingestion_jobs_updated_at();
