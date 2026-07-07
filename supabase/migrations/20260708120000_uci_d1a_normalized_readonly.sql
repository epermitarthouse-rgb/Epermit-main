-- UCI D1A — Normalized read-only foundation columns and indexes.

-- -----------------------------------------------------------------------------
-- coordination_applications
-- -----------------------------------------------------------------------------

ALTER TABLE public.coordination_applications
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS provider_slug TEXT,
  ADD COLUMN IF NOT EXISTS external_application_id TEXT,
  ADD COLUMN IF NOT EXISTS external_job_id TEXT,
  ADD COLUMN IF NOT EXISTS portal_status TEXT,
  ADD COLUMN IF NOT EXISTS portal_milestone TEXT,
  ADD COLUMN IF NOT EXISTS portal_last_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS action_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS record_source TEXT NOT NULL DEFAULT 'portal_sync',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.coordination_applications
  DROP CONSTRAINT IF EXISTS coordination_applications_record_source_check;

ALTER TABLE public.coordination_applications
  ADD CONSTRAINT coordination_applications_record_source_check
  CHECK (record_source IN ('portal_sync', 'agent_draft'));

CREATE UNIQUE INDEX IF NOT EXISTS coordination_applications_portal_upsert_unique
  ON public.coordination_applications (coordination_record_id, provider_slug, external_application_id)
  WHERE external_application_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_applications_tenant_id
  ON public.coordination_applications (tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_applications_provider_slug
  ON public.coordination_applications (provider_slug)
  WHERE provider_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_applications_external_application_id
  ON public.coordination_applications (external_application_id)
  WHERE external_application_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- coordination_communications
-- -----------------------------------------------------------------------------

ALTER TABLE public.coordination_communications
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS provider_slug TEXT,
  ADD COLUMN IF NOT EXISTS external_application_id TEXT,
  ADD COLUMN IF NOT EXISTS external_message_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS sender TEXT,
  ADD COLUMN IF NOT EXISTS recipient TEXT,
  ADD COLUMN IF NOT EXISTS message_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS coordination_communications_idempotency_unique
  ON public.coordination_communications (coordination_record_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_communications_tenant_id
  ON public.coordination_communications (tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_communications_provider_slug
  ON public.coordination_communications (provider_slug)
  WHERE provider_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_communications_external_application_id
  ON public.coordination_communications (external_application_id)
  WHERE external_application_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_communications_message_timestamp
  ON public.coordination_communications (message_timestamp DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_coordination_communications_needs_human_attention
  ON public.coordination_communications (coordination_record_id, needs_human_attention)
  WHERE needs_human_attention = true;

DROP TRIGGER IF EXISTS coordination_communications_updated_at ON public.coordination_communications;
CREATE TRIGGER coordination_communications_updated_at
  BEFORE UPDATE ON public.coordination_communications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- coordination_milestones
-- -----------------------------------------------------------------------------

ALTER TABLE public.coordination_milestones
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS provider_slug TEXT,
  ADD COLUMN IF NOT EXISTS external_application_id TEXT,
  ADD COLUMN IF NOT EXISTS portal_status TEXT,
  ADD COLUMN IF NOT EXISTS portal_milestone TEXT,
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS coordination_milestones_idempotency_unique
  ON public.coordination_milestones (coordination_record_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_milestones_tenant_id
  ON public.coordination_milestones (tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_milestones_provider_slug
  ON public.coordination_milestones (provider_slug)
  WHERE provider_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_milestones_external_application_id
  ON public.coordination_milestones (external_application_id)
  WHERE external_application_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_milestones_occurred_at
  ON public.coordination_milestones (occurred_at DESC NULLS LAST);
