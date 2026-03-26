-- Guardian Quality Agent: store quality check results per project
CREATE TABLE IF NOT EXISTS public.comment_quality_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  avg_score NUMERIC,
  flagged_count INT NOT NULL DEFAULT 0,
  results JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_comment_quality_checks_project_id
  ON public.comment_quality_checks(project_id);
CREATE INDEX IF NOT EXISTS idx_comment_quality_checks_created_at
  ON public.comment_quality_checks(created_at DESC);

ALTER TABLE public.comment_quality_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own project quality checks"
  ON public.comment_quality_checks FOR SELECT
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert quality checks for own projects"
  ON public.comment_quality_checks FOR INSERT
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );
