-- UCI Sprint 1 — Phase 1: UCI foundation tables + project-scoped RLS.

-- -----------------------------------------------------------------------------
-- utility_providers (catalog — not project-scoped)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.utility_providers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  utility_type TEXT NOT NULL,
  ownership_type TEXT,
  service_territory JSONB,
  primary_portal_type TEXT,
  portal_url TEXT,
  portal_credentials_ref TEXT,
  primary_contact JSONB,
  sla_acknowledgment_business_days INTEGER NOT NULL DEFAULT 5,
  sla_class_of_service_business_days INTEGER NOT NULL DEFAULT 30,
  sla_ciac_confirmation_business_days INTEGER NOT NULL DEFAULT 14,
  automation_status TEXT NOT NULL DEFAULT 'placeholder',
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.utility_providers ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER utility_providers_updated_at
  BEFORE UPDATE ON public.utility_providers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Authenticated users can read utility providers"
  ON public.utility_providers
  FOR SELECT TO authenticated
  USING (true);

INSERT INTO public.utility_providers (slug, name, utility_type)
VALUES
  ('pepco', 'PEPCO', 'electric'),
  ('bge', 'BGE', 'electric'),
  ('washington-gas', 'Washington Gas', 'gas'),
  ('dominion', 'Dominion Energy', 'electric'),
  ('fpl', 'Florida Power & Light', 'electric'),
  ('con-edison', 'Consolidated Edison', 'electric'),
  ('pseg', 'PSEG', 'electric'),
  ('eversource', 'Eversource Energy', 'electric'),
  ('duke-energy', 'Duke Energy', 'electric'),
  ('georgia-power', 'Georgia Power', 'electric')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  utility_type = EXCLUDED.utility_type,
  updated_at = now();

-- -----------------------------------------------------------------------------
-- coordination_records
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.coordination_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tenant_id UUID,
  utility_provider_id UUID NOT NULL REFERENCES public.utility_providers(id) ON DELETE RESTRICT,
  utility_type TEXT,
  scope_description TEXT NOT NULL DEFAULT '',
  current_stage SMALLINT NOT NULL DEFAULT 1 CHECK (current_stage BETWEEN 1 AND 10),
  current_stage_state TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (
    current_stage_state IN (
      'NOT_STARTED',
      'IN_PROGRESS',
      'AWAITING_UTILITY',
      'BLOCKED',
      'ESCALATED',
      'COMPLETED'
    )
  ),
  utility_account_number TEXT,
  utility_contact_name TEXT,
  utility_contact_email TEXT,
  utility_contact_phone TEXT,
  application_submitted_at TIMESTAMPTZ,
  acknowledgment_received_at TIMESTAMPTZ,
  class_of_service_issued_at TIMESTAMPTZ,
  energization_target_date DATE,
  energization_actual_date DATE,
  predicted_p50_date DATE,
  predicted_p90_date DATE,
  agent_monitored BOOLEAN NOT NULL DEFAULT TRUE,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coordination_records_project_id_id_unique UNIQUE (project_id, id),
  CONSTRAINT coordination_records_project_provider_scope_unique
    UNIQUE (project_id, utility_provider_id, scope_description)
);

CREATE INDEX IF NOT EXISTS idx_coordination_records_project_id
  ON public.coordination_records(project_id);

CREATE INDEX IF NOT EXISTS idx_coordination_records_utility_provider_id
  ON public.coordination_records(utility_provider_id);

ALTER TABLE public.coordination_records ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER coordination_records_updated_at
  BEFORE UPDATE ON public.coordination_records
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Users can select coordination_records for accessible projects"
  ON public.coordination_records
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert coordination_records for accessible projects"
  ON public.coordination_records
  FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update coordination_records for accessible projects"
  ON public.coordination_records
  FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete coordination_records for accessible projects"
  ON public.coordination_records
  FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- -----------------------------------------------------------------------------
-- coordination_stage_transitions
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.coordination_stage_transitions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coordination_record_id UUID NOT NULL,
  project_id UUID NOT NULL,
  from_stage SMALLINT CHECK (from_stage IS NULL OR (from_stage >= 1 AND from_stage <= 10)),
  to_stage SMALLINT NOT NULL CHECK (to_stage BETWEEN 1 AND 10),
  from_state TEXT CHECK (
    from_state IS NULL OR from_state IN (
      'NOT_STARTED',
      'IN_PROGRESS',
      'AWAITING_UTILITY',
      'BLOCKED',
      'ESCALATED',
      'COMPLETED'
    )
  ),
  to_state TEXT NOT NULL CHECK (
    to_state IN (
      'NOT_STARTED',
      'IN_PROGRESS',
      'AWAITING_UTILITY',
      'BLOCKED',
      'ESCALATED',
      'COMPLETED'
    )
  ),
  triggered_by_type TEXT,
  triggered_by_id UUID,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coordination_stage_transitions_record_fkey
    FOREIGN KEY (project_id, coordination_record_id)
    REFERENCES public.coordination_records(project_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coordination_stage_transitions_project_id
  ON public.coordination_stage_transitions(project_id);

CREATE INDEX IF NOT EXISTS idx_coordination_stage_transitions_record_id
  ON public.coordination_stage_transitions(coordination_record_id);

ALTER TABLE public.coordination_stage_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select coordination_stage_transitions for accessible projects"
  ON public.coordination_stage_transitions
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert coordination_stage_transitions for accessible projects"
  ON public.coordination_stage_transitions
  FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update coordination_stage_transitions for accessible projects"
  ON public.coordination_stage_transitions
  FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete coordination_stage_transitions for accessible projects"
  ON public.coordination_stage_transitions
  FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- -----------------------------------------------------------------------------
-- coordination_applications
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.coordination_applications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coordination_record_id UUID NOT NULL,
  project_id UUID NOT NULL,
  application_type TEXT,
  package_documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  load_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  submission_method TEXT,
  utility_ticket_number TEXT,
  submitted_at TIMESTAMPTZ,
  submitted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  draft_status TEXT NOT NULL DEFAULT 'draft' CHECK (
    draft_status IN ('draft', 'reviewed', 'needs_changes', 'submitted', 'failed')
  ),
  agent_draft_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coordination_applications_record_fkey
    FOREIGN KEY (project_id, coordination_record_id)
    REFERENCES public.coordination_records(project_id, id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS coordination_applications_idempotency_key_unique
  ON public.coordination_applications(coordination_record_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_applications_project_id
  ON public.coordination_applications(project_id);

CREATE INDEX IF NOT EXISTS idx_coordination_applications_record_id
  ON public.coordination_applications(coordination_record_id);

ALTER TABLE public.coordination_applications ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER coordination_applications_updated_at
  BEFORE UPDATE ON public.coordination_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Users can select coordination_applications for accessible projects"
  ON public.coordination_applications
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert coordination_applications for accessible projects"
  ON public.coordination_applications
  FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update coordination_applications for accessible projects"
  ON public.coordination_applications
  FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete coordination_applications for accessible projects"
  ON public.coordination_applications
  FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- -----------------------------------------------------------------------------
-- coordination_communications
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.coordination_communications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coordination_record_id UUID NOT NULL,
  project_id UUID NOT NULL,
  direction TEXT,
  channel TEXT,
  classification TEXT,
  classification_confidence NUMERIC,
  raw_subject TEXT,
  raw_body TEXT,
  raw_attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  parsed_summary TEXT,
  parsed_action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  thread_id TEXT,
  needs_human_attention BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  agent_processed_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coordination_communications_record_fkey
    FOREIGN KEY (project_id, coordination_record_id)
    REFERENCES public.coordination_records(project_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coordination_communications_project_id
  ON public.coordination_communications(project_id);

CREATE INDEX IF NOT EXISTS idx_coordination_communications_record_id
  ON public.coordination_communications(coordination_record_id);

CREATE INDEX IF NOT EXISTS idx_coordination_communications_created_at
  ON public.coordination_communications(created_at DESC);

ALTER TABLE public.coordination_communications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select coordination_communications for accessible projects"
  ON public.coordination_communications
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert coordination_communications for accessible projects"
  ON public.coordination_communications
  FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update coordination_communications for accessible projects"
  ON public.coordination_communications
  FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete coordination_communications for accessible projects"
  ON public.coordination_communications
  FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- -----------------------------------------------------------------------------
-- coordination_costs
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.coordination_costs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coordination_record_id UUID NOT NULL,
  project_id UUID NOT NULL,
  cost_type TEXT,
  estimated_amount NUMERIC(15, 2),
  estimated_at TIMESTAMPTZ,
  actual_amount NUMERIC(15, 2),
  actual_received_at TIMESTAMPTZ,
  variance_pct NUMERIC(7, 3),
  invoice_received_doc_ref TEXT,
  paid_at TIMESTAMPTZ,
  payment_method TEXT,
  client_billed_at TIMESTAMPTZ,
  quickbooks_invoice_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coordination_costs_record_fkey
    FOREIGN KEY (project_id, coordination_record_id)
    REFERENCES public.coordination_records(project_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coordination_costs_project_id
  ON public.coordination_costs(project_id);

CREATE INDEX IF NOT EXISTS idx_coordination_costs_record_id
  ON public.coordination_costs(coordination_record_id);

ALTER TABLE public.coordination_costs ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER coordination_costs_updated_at
  BEFORE UPDATE ON public.coordination_costs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Users can select coordination_costs for accessible projects"
  ON public.coordination_costs
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert coordination_costs for accessible projects"
  ON public.coordination_costs
  FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update coordination_costs for accessible projects"
  ON public.coordination_costs
  FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete coordination_costs for accessible projects"
  ON public.coordination_costs
  FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- -----------------------------------------------------------------------------
-- coordination_equipment
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.coordination_equipment (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coordination_record_id UUID NOT NULL,
  project_id UUID NOT NULL,
  equipment_type TEXT,
  equipment_size TEXT,
  initial_eta DATE,
  current_eta DATE,
  eta_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'on_order', 'shipped', 'delivered', 'installed')
  ),
  last_check_in_at TIMESTAMPTZ,
  next_check_in_at TIMESTAMPTZ,
  weeks_of_slip NUMERIC(6, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coordination_equipment_record_fkey
    FOREIGN KEY (project_id, coordination_record_id)
    REFERENCES public.coordination_records(project_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coordination_equipment_project_id
  ON public.coordination_equipment(project_id);

CREATE INDEX IF NOT EXISTS idx_coordination_equipment_record_id
  ON public.coordination_equipment(coordination_record_id);

ALTER TABLE public.coordination_equipment ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER coordination_equipment_updated_at
  BEFORE UPDATE ON public.coordination_equipment
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Users can select coordination_equipment for accessible projects"
  ON public.coordination_equipment
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert coordination_equipment for accessible projects"
  ON public.coordination_equipment
  FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update coordination_equipment for accessible projects"
  ON public.coordination_equipment
  FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete coordination_equipment for accessible projects"
  ON public.coordination_equipment
  FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- -----------------------------------------------------------------------------
-- coordination_milestones
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.coordination_milestones (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coordination_record_id UUID NOT NULL,
  project_id UUID NOT NULL,
  milestone_type TEXT,
  parent_stage SMALLINT CHECK (parent_stage IS NULL OR (parent_stage BETWEEN 1 AND 10)),
  target_date DATE,
  actual_date DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'scheduled', 'completed', 'missed')
  ),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coordination_milestones_record_fkey
    FOREIGN KEY (project_id, coordination_record_id)
    REFERENCES public.coordination_records(project_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coordination_milestones_project_id
  ON public.coordination_milestones(project_id);

CREATE INDEX IF NOT EXISTS idx_coordination_milestones_record_id
  ON public.coordination_milestones(coordination_record_id);

ALTER TABLE public.coordination_milestones ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER coordination_milestones_updated_at
  BEFORE UPDATE ON public.coordination_milestones
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Users can select coordination_milestones for accessible projects"
  ON public.coordination_milestones
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert coordination_milestones for accessible projects"
  ON public.coordination_milestones
  FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update coordination_milestones for accessible projects"
  ON public.coordination_milestones
  FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete coordination_milestones for accessible projects"
  ON public.coordination_milestones
  FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

