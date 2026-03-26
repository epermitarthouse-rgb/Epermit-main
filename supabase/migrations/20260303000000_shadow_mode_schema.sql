-- Shadow Mode Testing Framework
-- Adds infrastructure for background AI prediction logging, baseline tracking, and audit trail

-- 1. Update existing projects table with shadow mode columns
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS is_shadow_mode BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_classification TEXT NOT NULL DEFAULT 'Confidential';

-- 2. Create shadow_predictions table
CREATE TABLE public.shadow_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  comment_id UUID NOT NULL REFERENCES public.parsed_comments(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  prediction_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0.00 AND confidence_score <= 1.00),
  match_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (match_status IN ('match', 'partial', 'mismatch', 'pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shadow_predictions_project_id ON public.shadow_predictions(project_id);
CREATE INDEX idx_shadow_predictions_comment_id ON public.shadow_predictions(comment_id);
CREATE INDEX idx_shadow_predictions_agent_name ON public.shadow_predictions(agent_name);
CREATE INDEX idx_shadow_predictions_match_status ON public.shadow_predictions(match_status);

-- 3. Create baseline_actions table
CREATE TABLE public.baseline_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  expeditor_id UUID NOT NULL REFERENCES auth.users(id),
  comment_id UUID REFERENCES public.parsed_comments(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  duration_minutes NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_baseline_actions_project_id ON public.baseline_actions(project_id);
CREATE INDEX idx_baseline_actions_expeditor_id ON public.baseline_actions(expeditor_id);
CREATE INDEX idx_baseline_actions_action_type ON public.baseline_actions(action_type);

-- 4. Create audit_trail table
CREATE TABLE public.audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  input_hash TEXT,
  routing_decision TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_trail_project_id ON public.audit_trail(project_id);
CREATE INDEX idx_audit_trail_actor_id ON public.audit_trail(actor_id);
CREATE INDEX idx_audit_trail_action_type ON public.audit_trail(action_type);
CREATE INDEX idx_audit_trail_created_at ON public.audit_trail(created_at DESC);

-- 5. Enable RLS on all new tables
ALTER TABLE public.shadow_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.baseline_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_trail ENABLE ROW LEVEL SECURITY;

-- shadow_predictions: authenticated users can SELECT rows for their own projects
CREATE POLICY "Users can view shadow predictions for own projects"
  ON public.shadow_predictions FOR SELECT
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

-- shadow_predictions: authenticated users can INSERT rows for their own projects
CREATE POLICY "Users can insert shadow predictions for own projects"
  ON public.shadow_predictions FOR INSERT
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

-- baseline_actions: authenticated users can SELECT rows for their own projects
CREATE POLICY "Users can view baseline actions for own projects"
  ON public.baseline_actions FOR SELECT
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

-- baseline_actions: authenticated users can INSERT rows for their own projects
CREATE POLICY "Users can insert baseline actions for own projects"
  ON public.baseline_actions FOR INSERT
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

-- audit_trail: authenticated users can SELECT rows for their own projects
CREATE POLICY "Users can view audit trail for own projects"
  ON public.audit_trail FOR SELECT
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

-- audit_trail: authenticated users can INSERT audit entries for their own projects
CREATE POLICY "Users can insert audit trail for own projects"
  ON public.audit_trail FOR INSERT
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );
