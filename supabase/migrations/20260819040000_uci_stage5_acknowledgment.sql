-- Stage 5 — Acknowledgment SLA fields, unmatched inbound queue, match/review indexes

ALTER TABLE public.coordination_records
  ADD COLUMN IF NOT EXISTS ack_sla_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ack_sla_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ack_sla_stopped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ack_sla_escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS utility_project_manager TEXT,
  ADD COLUMN IF NOT EXISTS next_required_action TEXT;

CREATE INDEX IF NOT EXISTS idx_coordination_records_ack_sla_due
  ON public.coordination_records (ack_sla_due_at)
  WHERE ack_sla_due_at IS NOT NULL AND ack_sla_stopped_at IS NULL;

-- Unmatched inbound messages (Graph/email) before coordination match
CREATE TABLE IF NOT EXISTS public.uci_unmatched_inbound_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID,
  tenant_id UUID,
  provider_slug TEXT,
  mailbox_user_id UUID,
  external_message_id TEXT,
  internet_message_id TEXT,
  conversation_id TEXT,
  idempotency_key TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound',
  channel TEXT NOT NULL DEFAULT 'email',
  sender TEXT,
  recipient TEXT,
  raw_subject TEXT,
  raw_body TEXT,
  raw_attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  message_timestamp TIMESTAMPTZ,
  match_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('unmatched', 'matched', 'rejected', 'irrelevant')),
  match_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  matched_coordination_record_id UUID,
  matched_communication_id UUID,
  needs_human_attention BOOLEAN NOT NULL DEFAULT TRUE,
  agent_processed_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uci_unmatched_inbound_idempotency_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_uci_unmatched_inbound_status
  ON public.uci_unmatched_inbound_messages (match_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_uci_unmatched_inbound_project
  ON public.uci_unmatched_inbound_messages (project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_uci_unmatched_inbound_conversation
  ON public.uci_unmatched_inbound_messages (conversation_id)
  WHERE conversation_id IS NOT NULL;

DROP TRIGGER IF EXISTS uci_unmatched_inbound_updated_at ON public.uci_unmatched_inbound_messages;
CREATE TRIGGER uci_unmatched_inbound_updated_at
  BEFORE UPDATE ON public.uci_unmatched_inbound_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.uci_unmatched_inbound_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select unmatched inbound for accessible projects"
  ON public.uci_unmatched_inbound_messages
  FOR SELECT
  USING (
    project_id IS NULL
    OR public.has_project_access(auth.uid(), project_id)
  );

CREATE POLICY "Users can insert unmatched inbound for accessible projects"
  ON public.uci_unmatched_inbound_messages
  FOR INSERT
  WITH CHECK (
    project_id IS NULL
    OR public.has_project_access(auth.uid(), project_id)
  );

CREATE POLICY "Users can update unmatched inbound for accessible projects"
  ON public.uci_unmatched_inbound_messages
  FOR UPDATE
  USING (
    project_id IS NULL
    OR public.has_project_access(auth.uid(), project_id)
  )
  WITH CHECK (
    project_id IS NULL
    OR public.has_project_access(auth.uid(), project_id)
  );

-- Communication match / review helpers on existing rows (metadata-driven; indexes for common lookups)
CREATE INDEX IF NOT EXISTS idx_coordination_communications_thread_id
  ON public.coordination_communications (thread_id)
  WHERE thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_communications_external_message_id
  ON public.coordination_communications (external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_communications_classification
  ON public.coordination_communications (classification)
  WHERE classification IS NOT NULL;
