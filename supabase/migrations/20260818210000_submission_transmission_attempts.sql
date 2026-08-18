-- Stage 4 controlled live email transmission attempts (append-oriented).
-- Claim row BEFORE Graph sendMail. Does not imply Stage 5 / submitted_at.

CREATE TABLE IF NOT EXISTS public.submission_transmission_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES public.coordination_applications(id) ON DELETE CASCADE,
  coordination_record_id UUID NOT NULL,
  project_id UUID NOT NULL,
  preparation_id UUID REFERENCES public.submission_preparations(id) ON DELETE SET NULL,
  method TEXT NOT NULL DEFAULT 'email' CHECK (method = 'email'),
  status TEXT NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed', 'sent', 'failed', 'outcome_unknown')),
  idempotency_key TEXT NOT NULL,
  sender_mailbox TEXT,
  to_recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  cc_recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject TEXT,
  body_preview TEXT,
  attachment_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  attachment_count INTEGER NOT NULL DEFAULT 0,
  package_snapshot_id TEXT,
  package_snapshot_version TEXT,
  operator_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  graph_send_attempted BOOLEAN NOT NULL DEFAULT FALSE,
  graph_http_status INTEGER,
  graph_message_id TEXT,
  graph_error TEXT,
  outcome_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_side_effects JSONB NOT NULL DEFAULT jsonb_build_object(
    'email_sent', false,
    'portal_touched', false,
    'live_submission_attempted', true,
    'lifecycle_advanced', false,
    'graph_called', true,
    'graph_send_mail_called', false,
    'stage_5_advanced', false
  ),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT submission_transmission_attempts_record_fkey
    FOREIGN KEY (project_id, coordination_record_id)
    REFERENCES public.coordination_records(project_id, id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS submission_transmission_attempts_idempotency_unique
  ON public.submission_transmission_attempts (application_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_submission_transmission_attempts_application_id
  ON public.submission_transmission_attempts(application_id, claimed_at DESC);

CREATE INDEX IF NOT EXISTS idx_submission_transmission_attempts_preparation_id
  ON public.submission_transmission_attempts(preparation_id, claimed_at DESC);

ALTER TABLE public.submission_transmission_attempts ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER submission_transmission_attempts_updated_at
  BEFORE UPDATE ON public.submission_transmission_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Users can select submission_transmission_attempts for accessible projects"
  ON public.submission_transmission_attempts
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert submission_transmission_attempts for accessible projects"
  ON public.submission_transmission_attempts
  FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update submission_transmission_attempts for accessible projects"
  ON public.submission_transmission_attempts
  FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

COMMENT ON TABLE public.submission_transmission_attempts IS
  'Stage 4 live email transmission audit. Claim before Graph sendMail; sent ≠ Stage 5.';
