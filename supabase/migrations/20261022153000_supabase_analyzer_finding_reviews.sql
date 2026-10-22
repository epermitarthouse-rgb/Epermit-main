-- Reviewer decisions for Supabase Code Analyzer findings.
-- Stored separately from AI observation, recommendation, severity, and evidence.
-- Acceptance records a person's response. It is not verified code compliance.
-- Does not write Code Analyzer V2 learning-loop tables.
-- Rollback: DROP TABLE public.supabase_analyzer_finding_reviews;

BEGIN;

CREATE TABLE IF NOT EXISTS public.supabase_analyzer_finding_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES public.supabase_analyzer_runs(id) ON DELETE CASCADE,
  sheet_job_id UUID NOT NULL REFERENCES public.supabase_analyzer_sheet_jobs(id) ON DELETE CASCADE,
  finding_id UUID NOT NULL REFERENCES public.supabase_analyzer_findings(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'modified', 'rejected')),
  modified_response TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by UUID NOT NULL,
  CONSTRAINT supabase_analyzer_finding_reviews_run_finding_key UNIQUE (run_id, finding_id),
  CONSTRAINT supabase_analyzer_finding_reviews_response_check CHECK (
    (
      decision = 'modified'
      AND modified_response IS NOT NULL
      AND char_length(btrim(modified_response)) > 0
      AND char_length(modified_response) <= 8000
    )
    OR (
      decision <> 'modified'
      AND modified_response IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_supabase_analyzer_finding_reviews_project
  ON public.supabase_analyzer_finding_reviews (project_id, run_id);

ALTER TABLE public.supabase_analyzer_finding_reviews ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.supabase_analyzer_finding_reviews_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.finding_id IS DISTINCT FROM OLD.finding_id
    OR NEW.run_id IS DISTINCT FROM OLD.run_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.sheet_job_id IS DISTINCT FROM OLD.sheet_job_id
  ) THEN
    RAISE EXCEPTION 'review target cannot change';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    NEW.decided_by := auth.uid();
  END IF;
  IF NEW.decided_by IS NULL THEN
    RAISE EXCEPTION 'decided_by is required';
  END IF;

  IF NEW.decision = 'modified' THEN
    NEW.modified_response := btrim(COALESCE(NEW.modified_response, ''));
    IF NEW.modified_response = '' THEN
      RAISE EXCEPTION 'modified response is required';
    END IF;
    IF char_length(NEW.modified_response) > 8000 THEN
      RAISE EXCEPTION 'modified response is too long';
    END IF;
  ELSE
    NEW.modified_response := NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.supabase_analyzer_findings f
    WHERE f.id = NEW.finding_id
      AND f.run_id = NEW.run_id
      AND f.sheet_job_id = NEW.sheet_job_id
      AND f.project_id = NEW.project_id
      AND f.is_published
  ) THEN
    RAISE EXCEPTION 'review finding was not found on this run';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supabase_analyzer_finding_reviews_guard
  ON public.supabase_analyzer_finding_reviews;
CREATE TRIGGER supabase_analyzer_finding_reviews_guard
  BEFORE INSERT OR UPDATE ON public.supabase_analyzer_finding_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.supabase_analyzer_finding_reviews_guard();

CREATE OR REPLACE FUNCTION public.supabase_analyzer_finding_reviews_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.supabase_analyzer_audit_events (
    run_id,
    sheet_job_id,
    project_id,
    actor_id,
    event_type,
    metadata
  ) VALUES (
    NEW.run_id,
    NEW.sheet_job_id,
    NEW.project_id,
    NEW.decided_by,
    'finding_review_saved',
    jsonb_build_object(
      'finding_id', NEW.finding_id,
      'decision', NEW.decision,
      'has_modified_response', NEW.modified_response IS NOT NULL
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supabase_analyzer_finding_reviews_audit
  ON public.supabase_analyzer_finding_reviews;
CREATE TRIGGER supabase_analyzer_finding_reviews_audit
  AFTER INSERT OR UPDATE ON public.supabase_analyzer_finding_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.supabase_analyzer_finding_reviews_audit();

DROP POLICY IF EXISTS "Project members can view Supabase analyzer finding reviews"
  ON public.supabase_analyzer_finding_reviews;
CREATE POLICY "Project members can view Supabase analyzer finding reviews"
  ON public.supabase_analyzer_finding_reviews FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Project editors can insert Supabase analyzer finding reviews"
  ON public.supabase_analyzer_finding_reviews;
CREATE POLICY "Project editors can insert Supabase analyzer finding reviews"
  ON public.supabase_analyzer_finding_reviews FOR INSERT
  WITH CHECK (
    public.has_project_editor_access(auth.uid(), project_id)
    AND decided_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.supabase_analyzer_findings f
      WHERE f.id = finding_id
        AND f.run_id = run_id
        AND f.sheet_job_id = sheet_job_id
        AND f.project_id = project_id
        AND f.is_published
        AND public.has_project_access(auth.uid(), f.project_id)
    )
  );

DROP POLICY IF EXISTS "Project editors can update Supabase analyzer finding reviews"
  ON public.supabase_analyzer_finding_reviews;
CREATE POLICY "Project editors can update Supabase analyzer finding reviews"
  ON public.supabase_analyzer_finding_reviews FOR UPDATE
  USING (public.has_project_editor_access(auth.uid(), project_id))
  WITH CHECK (
    public.has_project_editor_access(auth.uid(), project_id)
    AND decided_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.supabase_analyzer_findings f
      WHERE f.id = finding_id
        AND f.run_id = run_id
        AND f.sheet_job_id = sheet_job_id
        AND f.project_id = project_id
        AND f.is_published
        AND public.has_project_access(auth.uid(), f.project_id)
    )
  );

REVOKE ALL ON FUNCTION public.supabase_analyzer_finding_reviews_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.supabase_analyzer_finding_reviews_audit() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE public.supabase_analyzer_finding_reviews FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.supabase_analyzer_finding_reviews TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.supabase_analyzer_finding_reviews TO service_role;

COMMENT ON TABLE public.supabase_analyzer_finding_reviews IS
  'Reviewer accept, modify, or reject decisions for Supabase analyzer findings. Does not replace AI finding text and is not a compliance verification or V2 learning record.';

COMMIT;
