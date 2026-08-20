-- Stage 6 — Class of Service / Design Review
-- Durable utility-issued COS/design records, COS SLA columns, evidence provenance.

ALTER TABLE public.coordination_records
  ADD COLUMN IF NOT EXISTS cos_sla_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cos_sla_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cos_sla_stopped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cos_sla_escalated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_coordination_records_cos_sla_due
  ON public.coordination_records (cos_sla_due_at)
  WHERE cos_sla_due_at IS NOT NULL AND cos_sla_stopped_at IS NULL;

CREATE TABLE IF NOT EXISTS public.coordination_cos_design_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coordination_record_id UUID NOT NULL,
  project_id UUID NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  superseded_by UUID,
  evidence_status TEXT NOT NULL DEFAULT 'UTILITY_ISSUED'
    CHECK (evidence_status IN ('ADVISORY', 'UTILITY_ISSUED', 'DISCREPANCY')),
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN (
      'pending',
      'ready_for_approval',
      'needs_attention',
      'revision_required',
      'approved',
      'rejected',
      'superseded'
    )),
  source_communication_id UUID,
  document_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_text_excerpt TEXT,
  parse_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  extracted_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  baseline_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  discrepancy_report JSONB NOT NULL DEFAULT '{}'::jsonb,
  comparison_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  utility_evidence_issued_at TIMESTAMPTZ,
  needs_human_attention BOOLEAN NOT NULL DEFAULT TRUE,
  attention_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approval_notes TEXT,
  accepted_deviations JSONB NOT NULL DEFAULT '[]'::jsonb,
  revision_request JSONB,
  rejected_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  agent_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coordination_cos_design_records_record_fkey
    FOREIGN KEY (project_id, coordination_record_id)
    REFERENCES public.coordination_records(project_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cos_design_records_coordination
  ON public.coordination_cos_design_records (coordination_record_id, is_current);

CREATE INDEX IF NOT EXISTS idx_cos_design_records_project
  ON public.coordination_cos_design_records (project_id);

CREATE INDEX IF NOT EXISTS idx_cos_design_records_attention
  ON public.coordination_cos_design_records (project_id, needs_human_attention)
  WHERE needs_human_attention = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cos_design_records_one_current
  ON public.coordination_cos_design_records (coordination_record_id)
  WHERE is_current = TRUE;

DROP TRIGGER IF EXISTS coordination_cos_design_records_updated_at
  ON public.coordination_cos_design_records;
CREATE TRIGGER coordination_cos_design_records_updated_at
  BEFORE UPDATE ON public.coordination_cos_design_records
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.coordination_cos_design_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select cos design records for accessible projects"
  ON public.coordination_cos_design_records
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert cos design records for accessible projects"
  ON public.coordination_cos_design_records
  FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update cos design records for accessible projects"
  ON public.coordination_cos_design_records
  FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete cos design records for accessible projects"
  ON public.coordination_cos_design_records
  FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- Optional evidence link on costs created from COS CIAC implications
ALTER TABLE public.coordination_costs
  ADD COLUMN IF NOT EXISTS cos_design_record_id UUID
    REFERENCES public.coordination_cos_design_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS coordination_costs_idempotency_key_unique
  ON public.coordination_costs (coordination_record_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
