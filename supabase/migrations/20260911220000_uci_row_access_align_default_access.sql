-- Align UCI / tenant-project helpers with default+override project access (20260911190000).
--
-- Root cause: has_uci_row_access / has_tenant_project_access still require can_access_tenant()
-- for all tenant-scoped rows. Users without tenant_memberships (admin-created accounts) can
-- list projects after 20260911210000 but fail opening UCI, scrape jobs, and related data.
--
-- Fix: mirror projects SELECT RLS — has_project_access / has_project_editor_access govern
-- access; can_access_tenant() applies only for demo tenants (demo↔production isolation).

CREATE OR REPLACE FUNCTION public.has_uci_row_access(_user_id UUID, _tenant_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_project_access(_user_id, _project_id)
    AND (
      _tenant_id IS NULL
      OR (
        EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = _project_id
            AND (p.tenant_id IS NULL OR p.tenant_id = _tenant_id)
        )
        AND (
          NOT public.is_demo_tenant(_tenant_id)
          OR public.can_access_tenant(_user_id, _tenant_id)
        )
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.has_uci_row_editor_access(_user_id UUID, _tenant_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_project_editor_access(_user_id, _project_id)
    AND (
      _tenant_id IS NULL
      OR (
        EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = _project_id
            AND (p.tenant_id IS NULL OR p.tenant_id = _tenant_id)
        )
        AND (
          NOT public.is_demo_tenant(_tenant_id)
          OR public.can_access_tenant(_user_id, _tenant_id)
        )
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.has_tenant_project_access(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = _project_id
      AND p.tenant_id IS NOT NULL
      AND public.has_project_access(_user_id, p.id)
      AND (
        NOT public.is_demo_tenant(p.tenant_id)
        OR public.can_access_tenant(_user_id, p.tenant_id)
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.has_tenant_project_editor_access(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = _project_id
      AND p.tenant_id IS NOT NULL
      AND public.has_project_editor_access(_user_id, p.id)
      AND (
        NOT public.is_demo_tenant(p.tenant_id)
        OR public.can_access_tenant(_user_id, p.tenant_id)
      )
  )
$$;

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
      OR NOT public.is_demo_tenant(p.tenant_id)
      OR public.can_access_tenant(_user_id, p.tenant_id)
    )
  ORDER BY p.updated_at DESC;
$$;

COMMENT ON FUNCTION public.has_uci_row_access(UUID, UUID, UUID) IS
  'UCI read gate: has_project_access plus demo-tenant isolation; production tenants do not require tenant_memberships.';

COMMENT ON FUNCTION public.has_uci_row_editor_access(UUID, UUID, UUID) IS
  'UCI write gate: has_project_editor_access plus demo-tenant isolation.';
