-- Stage 4 P0 — append-only submission package validation attempts (validation_only).
-- Never stores live submission success; does not advance lifecycle.

CREATE TABLE IF NOT EXISTS public.submission_validation_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES public.coordination_applications(id) ON DELETE CASCADE,
  coordination_record_id UUID NOT NULL,
  project_id UUID NOT NULL,
  attempt_mode TEXT NOT NULL DEFAULT 'validation_only'
    CHECK (attempt_mode = 'validation_only'),
  result TEXT NOT NULL CHECK (result IN ('passed', 'failed', 'blocked')),
  provider_slug TEXT,
  package_snapshot_id TEXT,
  package_snapshot_version TEXT,
  package_snapshot_captured_at TIMESTAMPTZ,
  intended_submission_mode TEXT NOT NULL DEFAULT 'unavailable_not_configured',
  operator_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  external_side_effects JSONB NOT NULL DEFAULT jsonb_build_object(
    'email_sent', false,
    'portal_touched', false,
    'live_submission_attempted', false,
    'lifecycle_advanced', false,
    'graph_called', false
  ),
  validation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  validated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT submission_validation_attempts_record_fkey
    FOREIGN KEY (project_id, coordination_record_id)
    REFERENCES public.coordination_records(project_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_submission_validation_attempts_application_id
  ON public.submission_validation_attempts(application_id, validated_at DESC);

CREATE INDEX IF NOT EXISTS idx_submission_validation_attempts_record_id
  ON public.submission_validation_attempts(coordination_record_id, validated_at DESC);

CREATE INDEX IF NOT EXISTS idx_submission_validation_attempts_project_id
  ON public.submission_validation_attempts(project_id);

ALTER TABLE public.submission_validation_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select submission_validation_attempts for accessible projects"
  ON public.submission_validation_attempts
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert submission_validation_attempts for accessible projects"
  ON public.submission_validation_attempts
  FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- Append-only: no UPDATE/DELETE policies for authenticated clients.
COMMENT ON TABLE public.submission_validation_attempts IS
  'Append-only Stage 4 validation_only audit. Never implies external submission or Stage 5.';
