-- Phase 2: DC Construction Code Modification Review.
-- Additive and backward compatible with Phase 1 standard compliance runs.

ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'code_modification_application';

ALTER TABLE public.code_analyzer_runs
  ADD COLUMN IF NOT EXISTS analysis_type TEXT NOT NULL DEFAULT 'standard_compliance';

ALTER TABLE public.code_analyzer_runs
  ADD COLUMN IF NOT EXISTS form_document_id UUID REFERENCES public.project_documents(id) ON DELETE SET NULL;

UPDATE public.code_analyzer_runs
SET analysis_type = 'standard_compliance'
WHERE analysis_type IS NULL OR btrim(analysis_type) = '';

ALTER TABLE public.code_analyzer_runs
  DROP CONSTRAINT IF EXISTS code_analyzer_runs_analysis_type_check;

ALTER TABLE public.code_analyzer_runs
  ADD CONSTRAINT code_analyzer_runs_analysis_type_check
  CHECK (analysis_type IN ('standard_compliance', 'dc_code_modification'));

DROP INDEX IF EXISTS public.idx_code_analyzer_runs_one_current;

CREATE UNIQUE INDEX IF NOT EXISTS idx_code_analyzer_runs_one_current_per_type
  ON public.code_analyzer_runs (project_id, analysis_type)
  WHERE status = 'current';

CREATE INDEX IF NOT EXISTS idx_code_analyzer_runs_analysis_type
  ON public.code_analyzer_runs (project_id, analysis_type, status);

CREATE TABLE IF NOT EXISTS public.code_modification_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL UNIQUE REFERENCES public.code_analyzer_runs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  form_document_id UUID NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  form_fingerprint TEXT NOT NULL DEFAULT '',
  extracted_request JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  overall_status TEXT NOT NULL DEFAULT 'manual_review_required',
  extraction_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT code_modification_reviews_overall_status_check
    CHECK (overall_status IN (
      'evidence_appears_complete',
      'evidence_partially_supported',
      'material_evidence_missing',
      'manual_review_required'
    ))
);

CREATE INDEX IF NOT EXISTS idx_code_modification_reviews_project
  ON public.code_modification_reviews (project_id, created_at DESC);

ALTER TABLE public.code_modification_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view code modification reviews" ON public.code_modification_reviews;
CREATE POLICY "Users can view code modification reviews"
  ON public.code_modification_reviews FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can insert code modification reviews" ON public.code_modification_reviews;
CREATE POLICY "Users can insert code modification reviews"
  ON public.code_modification_reviews FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can update code modification reviews" ON public.code_modification_reviews;
CREATE POLICY "Users can update code modification reviews"
  ON public.code_modification_reviews FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can delete code modification reviews" ON public.code_modification_reviews;
CREATE POLICY "Users can delete code modification reviews"
  ON public.code_modification_reviews FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

DROP TRIGGER IF EXISTS update_code_modification_reviews_updated_at ON public.code_modification_reviews;
CREATE TRIGGER update_code_modification_reviews_updated_at
  BEFORE UPDATE ON public.code_modification_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
