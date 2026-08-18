-- Stage 4 P1 — append-only email preparation / confirmation (NO Graph send, NO Stage 5).
-- Status confirmed_for_transmission means human confirmed preview only; sending_enabled stays false.

CREATE TABLE IF NOT EXISTS public.submission_preparations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES public.coordination_applications(id) ON DELETE CASCADE,
  coordination_record_id UUID NOT NULL,
  project_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared', 'confirmed_for_transmission', 'blocked')),
  method TEXT NOT NULL DEFAULT 'email' CHECK (method = 'email'),
  package_snapshot_id TEXT,
  package_snapshot_version TEXT,
  package_snapshot_captured_at TIMESTAMPTZ,
  provider_slug TEXT,
  project_name TEXT,
  sender_mailbox TEXT,
  sender_mailbox_verified BOOLEAN NOT NULL DEFAULT FALSE,
  operator_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  to_recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  cc_recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject TEXT,
  body TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  reviewed_snapshot_bindings JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmation_idempotency_key TEXT,
  confirmed_at TIMESTAMPTZ,
  confirmation_message TEXT,
  sending_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  graph_send_attempted BOOLEAN NOT NULL DEFAULT FALSE,
  external_side_effects JSONB NOT NULL DEFAULT jsonb_build_object(
    'email_sent', false,
    'portal_touched', false,
    'live_submission_attempted', false,
    'lifecycle_advanced', false,
    'graph_called', false,
    'graph_send_mail_called', false
  ),
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT submission_preparations_record_fkey
    FOREIGN KEY (project_id, coordination_record_id)
    REFERENCES public.coordination_records(project_id, id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS submission_preparations_confirm_idempotency_unique
  ON public.submission_preparations (application_id, confirmation_idempotency_key)
  WHERE confirmation_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_submission_preparations_application_id
  ON public.submission_preparations(application_id, prepared_at DESC);

CREATE INDEX IF NOT EXISTS idx_submission_preparations_record_id
  ON public.submission_preparations(coordination_record_id, prepared_at DESC);

ALTER TABLE public.submission_preparations ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER submission_preparations_updated_at
  BEFORE UPDATE ON public.submission_preparations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Users can select submission_preparations for accessible projects"
  ON public.submission_preparations
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert submission_preparations for accessible projects"
  ON public.submission_preparations
  FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update submission_preparations for accessible projects"
  ON public.submission_preparations
  FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- No DELETE policy — append-only audit intent (supersede via new rows / status).
COMMENT ON TABLE public.submission_preparations IS
  'Stage 4 P1 Prepare→Preview→Confirm audit. confirmed_for_transmission ≠ submitted; Graph send never implied.';
