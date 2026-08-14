-- Provider-account harvests are discovered before they are attached to PermitPilot work.
-- This table stores the explicit, human-confirmed external application -> project/record link.

CREATE TABLE IF NOT EXISTS public.uci_portal_harvest_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_slug TEXT NOT NULL,
  external_application_id TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID,
  source_credential_id UUID REFERENCES public.portal_credentials(id) ON DELETE SET NULL,
  portal_status TEXT,
  portal_milestone TEXT,
  external_job_id TEXT,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uci_portal_harvest_items_owner_provider_external_unique
    UNIQUE (owner_user_id, provider_slug, external_application_id)
);

ALTER TABLE public.uci_portal_harvest_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can select their provider harvest inventory"
  ON public.uci_portal_harvest_items FOR SELECT
  USING (owner_user_id = auth.uid());
CREATE POLICY "Users can update their provider harvest inventory"
  ON public.uci_portal_harvest_items FOR UPDATE
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_uci_portal_harvest_items_provider_external
  ON public.uci_portal_harvest_items(provider_slug, external_application_id);

DROP TRIGGER IF EXISTS uci_portal_harvest_items_updated_at
  ON public.uci_portal_harvest_items;
CREATE TRIGGER uci_portal_harvest_items_updated_at
  BEFORE UPDATE ON public.uci_portal_harvest_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.uci_portal_harvest_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_slug TEXT NOT NULL,
  external_application_id TEXT NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  coordination_record_id UUID NOT NULL,
  tenant_id UUID,
  linked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uci_portal_harvest_links_provider_external_unique
    UNIQUE (provider_slug, external_application_id),
  CONSTRAINT uci_portal_harvest_links_project_record_fk
    FOREIGN KEY (project_id, coordination_record_id)
    REFERENCES public.coordination_records(project_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_uci_portal_harvest_links_project
  ON public.uci_portal_harvest_links(project_id);

CREATE INDEX IF NOT EXISTS idx_uci_portal_harvest_links_record
  ON public.uci_portal_harvest_links(coordination_record_id);

ALTER TABLE public.uci_portal_harvest_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select harvest links for accessible projects"
  ON public.uci_portal_harvest_links;
CREATE POLICY "Users can select harvest links for accessible projects"
  ON public.uci_portal_harvest_links
  FOR SELECT
  USING (public.has_uci_row_access(auth.uid(), tenant_id, project_id));

DROP POLICY IF EXISTS "Users can insert harvest links for editable projects"
  ON public.uci_portal_harvest_links;
CREATE POLICY "Users can insert harvest links for editable projects"
  ON public.uci_portal_harvest_links
  FOR INSERT
  WITH CHECK (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id));

DROP POLICY IF EXISTS "Users can update harvest links for editable projects"
  ON public.uci_portal_harvest_links;
CREATE POLICY "Users can update harvest links for editable projects"
  ON public.uci_portal_harvest_links
  FOR UPDATE
  USING (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id))
  WITH CHECK (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id));

DROP TRIGGER IF EXISTS uci_portal_harvest_links_updated_at
  ON public.uci_portal_harvest_links;
CREATE TRIGGER uci_portal_harvest_links_updated_at
  BEFORE UPDATE ON public.uci_portal_harvest_links
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
