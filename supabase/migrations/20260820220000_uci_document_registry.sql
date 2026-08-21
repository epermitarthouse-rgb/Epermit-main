-- UCI Document Registry: coordination-scoped metadata on canonical project_documents rows.
-- project_documents remain the storage source of truth; this table holds classification,
-- provenance, manual overrides, signature state, and computed stage/provider mappings.

CREATE TABLE IF NOT EXISTS public.uci_document_registry_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tenant_id UUID,
  coordination_record_id UUID NOT NULL,
  project_document_id UUID NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  detected_role TEXT,
  role_confidence TEXT NOT NULL DEFAULT 'low'
    CHECK (role_confidence IN ('high', 'medium', 'low')),
  manual_role TEXT,
  effective_role TEXT,
  provenance TEXT NOT NULL DEFAULT 'unknown'
    CHECK (provenance IN (
      'unknown',
      'manual_upload',
      'portal_harvest',
      'email_inbound',
      'uci_generated',
      'loa_signed',
      'stage_upload',
      'load_profile',
      'application_builder',
      'reclassified'
    )),
  signature_status TEXT
    CHECK (signature_status IS NULL OR signature_status IN (
      'unknown', 'unsigned', 'signed', 'signed_manual_verified'
    )),
  signed_project_document_id UUID REFERENCES public.project_documents(id) ON DELETE SET NULL,
  stage_consumers INTEGER[] NOT NULL DEFAULT '{}',
  provider_slot_keys TEXT[] NOT NULL DEFAULT '{}',
  classification_review TEXT NOT NULL DEFAULT 'needs_classification'
    CHECK (classification_review IN (
      'auto_accepted', 'review_recommended', 'needs_classification'
    )),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  classified_at TIMESTAMPTZ,
  role_overridden_at TIMESTAMPTZ,
  role_overridden_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uci_document_registry_entries_unique
    UNIQUE (coordination_record_id, project_document_id),
  CONSTRAINT uci_document_registry_entries_project_record_fk
    FOREIGN KEY (project_id, coordination_record_id)
    REFERENCES public.coordination_records(project_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_uci_doc_registry_coordination
  ON public.uci_document_registry_entries(coordination_record_id);

CREATE INDEX IF NOT EXISTS idx_uci_doc_registry_project_document
  ON public.uci_document_registry_entries(project_document_id);

CREATE INDEX IF NOT EXISTS idx_uci_doc_registry_effective_role
  ON public.uci_document_registry_entries(coordination_record_id, effective_role)
  WHERE effective_role IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_uci_doc_registry_review
  ON public.uci_document_registry_entries(coordination_record_id, classification_review)
  WHERE classification_review != 'auto_accepted';

ALTER TABLE public.uci_document_registry_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select document registry entries"
  ON public.uci_document_registry_entries;
CREATE POLICY "Users can select document registry entries"
  ON public.uci_document_registry_entries
  FOR SELECT
  USING (public.has_uci_row_access(auth.uid(), tenant_id, project_id));

DROP POLICY IF EXISTS "Users can insert document registry entries"
  ON public.uci_document_registry_entries;
CREATE POLICY "Users can insert document registry entries"
  ON public.uci_document_registry_entries
  FOR INSERT
  WITH CHECK (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id));

DROP POLICY IF EXISTS "Users can update document registry entries"
  ON public.uci_document_registry_entries;
CREATE POLICY "Users can update document registry entries"
  ON public.uci_document_registry_entries
  FOR UPDATE
  USING (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id))
  WITH CHECK (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id));

DROP POLICY IF EXISTS "Users can delete document registry entries"
  ON public.uci_document_registry_entries;
CREATE POLICY "Users can delete document registry entries"
  ON public.uci_document_registry_entries
  FOR DELETE
  USING (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id));

DROP TRIGGER IF EXISTS uci_document_registry_entries_updated_at
  ON public.uci_document_registry_entries;
CREATE TRIGGER uci_document_registry_entries_updated_at
  BEFORE UPDATE ON public.uci_document_registry_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
