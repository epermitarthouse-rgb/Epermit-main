-- Fixed-query access and indexes for UCI cross-project operational snapshots.
-- This read path only exposes persisted PermitPilot data; it performs no portal work.

CREATE OR REPLACE FUNCTION public.list_accessible_uci_projects(_user_id UUID)
RETURNS TABLE (id UUID, name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name
  FROM public.projects p
  WHERE public.has_project_access(_user_id, p.id)
    AND (
      p.tenant_id IS NULL
      OR public.can_access_tenant(_user_id, p.tenant_id)
    )
  ORDER BY p.updated_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_accessible_uci_projects(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_accessible_uci_projects(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.list_accessible_uci_projects(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.list_accessible_uci_projects(UUID) TO service_role;

CREATE INDEX IF NOT EXISTS idx_coordination_records_project_updated
  ON public.coordination_records (project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_coordination_applications_project_updated
  ON public.coordination_applications (project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_coordination_communications_project_message
  ON public.coordination_communications (
    project_id,
    message_timestamp DESC NULLS LAST,
    created_at DESC
  );
