-- Load Profile document scope: project_documents remain project-wide storage.
-- This join records which documents are linked to a coordination record and
-- whether they are included in that record's analysis. It is not a second
-- documents table.

CREATE TABLE IF NOT EXISTS public.uci_coordination_document_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tenant_id UUID,
  coordination_record_id UUID NOT NULL,
  project_document_id UUID NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  source_utility_type TEXT,
  source_provider_id UUID,
  source_provider_slug TEXT,
  source_provider_name TEXT,
  link_role TEXT NOT NULL DEFAULT 'load_analysis_source',
  relevance TEXT NOT NULL DEFAULT 'same_utility'
    CHECK (relevance IN ('same_utility', 'cross_utility', 'project_level', 'unknown')),
  included_in_analysis BOOLEAN NOT NULL DEFAULT true,
  link_origin TEXT NOT NULL DEFAULT 'manual'
    CHECK (link_origin IN ('automatic', 'manual', 'inbound')),
  linked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlinked_at TIMESTAMPTZ,
  unlinked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  unlink_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uci_coordination_document_links_unique
    UNIQUE (coordination_record_id, project_document_id),
  CONSTRAINT uci_coordination_document_links_project_record_fk
    FOREIGN KEY (project_id, coordination_record_id)
    REFERENCES public.coordination_records(project_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_uci_coord_doc_links_record
  ON public.uci_coordination_document_links(coordination_record_id)
  WHERE unlinked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_uci_coord_doc_links_document
  ON public.uci_coordination_document_links(project_document_id);

CREATE INDEX IF NOT EXISTS idx_uci_coord_doc_links_project
  ON public.uci_coordination_document_links(project_id);

ALTER TABLE public.uci_coordination_document_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select coordination document links"
  ON public.uci_coordination_document_links;
CREATE POLICY "Users can select coordination document links"
  ON public.uci_coordination_document_links
  FOR SELECT
  USING (public.has_uci_row_access(auth.uid(), tenant_id, project_id));

DROP POLICY IF EXISTS "Users can insert coordination document links"
  ON public.uci_coordination_document_links;
CREATE POLICY "Users can insert coordination document links"
  ON public.uci_coordination_document_links
  FOR INSERT
  WITH CHECK (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id));

DROP POLICY IF EXISTS "Users can update coordination document links"
  ON public.uci_coordination_document_links;
CREATE POLICY "Users can update coordination document links"
  ON public.uci_coordination_document_links
  FOR UPDATE
  USING (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id))
  WITH CHECK (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id));

DROP POLICY IF EXISTS "Users can delete coordination document links"
  ON public.uci_coordination_document_links;
CREATE POLICY "Users can delete coordination document links"
  ON public.uci_coordination_document_links
  FOR DELETE
  USING (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id));

DROP TRIGGER IF EXISTS uci_coordination_document_links_updated_at
  ON public.uci_coordination_document_links;
CREATE TRIGGER uci_coordination_document_links_updated_at
  BEFORE UPDATE ON public.uci_coordination_document_links
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
