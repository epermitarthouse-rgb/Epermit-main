-- Code Analyzer Phase 1: durable analysis runs + sheet/page records.
-- Backward compatible: existing document_annotations without analysis_run_id remain valid (legacy).

CREATE TABLE IF NOT EXISTS public.code_analyzer_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'current', 'stale', 'superseded', 'failed')),
  jurisdiction TEXT,
  project_type TEXT,
  code_year TEXT,
  analysis_mode TEXT,
  source_fingerprint TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_code_analyzer_runs_project_status
  ON public.code_analyzer_runs (project_id, status, created_at DESC);

-- At most one current run per project.
CREATE UNIQUE INDEX IF NOT EXISTS idx_code_analyzer_runs_one_current
  ON public.code_analyzer_runs (project_id)
  WHERE status = 'current';

CREATE TABLE IF NOT EXISTS public.code_analyzer_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_document_id UUID NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  image_document_id UUID REFERENCES public.project_documents(id) ON DELETE SET NULL,
  page_number INTEGER NOT NULL DEFAULT 1 CHECK (page_number >= 1),
  file_name TEXT,
  excluded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT code_analyzer_sheets_source_page_unique
    UNIQUE (source_document_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_code_analyzer_sheets_project
  ON public.code_analyzer_sheets (project_id, excluded);

CREATE INDEX IF NOT EXISTS idx_code_analyzer_sheets_source
  ON public.code_analyzer_sheets (source_document_id);

CREATE INDEX IF NOT EXISTS idx_code_analyzer_sheets_image
  ON public.code_analyzer_sheets (image_document_id);

ALTER TABLE public.document_annotations
  ADD COLUMN IF NOT EXISTS analysis_run_id UUID REFERENCES public.code_analyzer_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_document_annotations_analysis_run
  ON public.document_annotations (analysis_run_id)
  WHERE analysis_run_id IS NOT NULL;

ALTER TABLE public.code_analyzer_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_analyzer_sheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view code analyzer runs" ON public.code_analyzer_runs;
CREATE POLICY "Users can view code analyzer runs"
  ON public.code_analyzer_runs FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can insert code analyzer runs" ON public.code_analyzer_runs;
CREATE POLICY "Users can insert code analyzer runs"
  ON public.code_analyzer_runs FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id) AND auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update code analyzer runs" ON public.code_analyzer_runs;
CREATE POLICY "Users can update code analyzer runs"
  ON public.code_analyzer_runs FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can delete code analyzer runs" ON public.code_analyzer_runs;
CREATE POLICY "Users can delete code analyzer runs"
  ON public.code_analyzer_runs FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can view code analyzer sheets" ON public.code_analyzer_sheets;
CREATE POLICY "Users can view code analyzer sheets"
  ON public.code_analyzer_sheets FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can insert code analyzer sheets" ON public.code_analyzer_sheets;
CREATE POLICY "Users can insert code analyzer sheets"
  ON public.code_analyzer_sheets FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can update code analyzer sheets" ON public.code_analyzer_sheets;
CREATE POLICY "Users can update code analyzer sheets"
  ON public.code_analyzer_sheets FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can delete code analyzer sheets" ON public.code_analyzer_sheets;
CREATE POLICY "Users can delete code analyzer sheets"
  ON public.code_analyzer_sheets FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

DROP TRIGGER IF EXISTS update_code_analyzer_runs_updated_at ON public.code_analyzer_runs;
CREATE TRIGGER update_code_analyzer_runs_updated_at
  BEFORE UPDATE ON public.code_analyzer_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_code_analyzer_sheets_updated_at ON public.code_analyzer_sheets;
CREATE TRIGGER update_code_analyzer_sheets_updated_at
  BEFORE UPDATE ON public.code_analyzer_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
