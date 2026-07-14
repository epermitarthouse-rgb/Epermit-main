-- Row 2: Canonical tenant model (foundation).
-- Staged migration — do not assume production has been backfilled yet.
-- Demo tenant UUID is stable for references in tests and seed data.

CREATE TYPE public.tenant_membership_role AS ENUM ('owner', 'admin', 'member', 'viewer');

CREATE TABLE IF NOT EXISTS public.tenants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' OR slug ~ '^[a-z0-9]{1,2}$')
);

CREATE TABLE IF NOT EXISTS public.tenant_memberships (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role public.tenant_membership_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user_id
  ON public.tenant_memberships (user_id);

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant_id
  ON public.tenant_memberships (tenant_id);

CREATE TRIGGER tenants_updated_at
BEFORE UPDATE ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER tenant_memberships_updated_at
BEFORE UPDATE ON public.tenant_memberships
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;

-- Nullable until backfill completes (stage 2).
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_projects_tenant_id
  ON public.projects (tenant_id)
  WHERE tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Tenant access helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_tenant_access(_user_id UUID, _tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = _tenant_id AND user_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.has_tenant_admin_access(_user_id UUID, _tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = _tenant_id
      AND user_id = _user_id
      AND role IN ('owner', 'admin')
  )
$$;

CREATE OR REPLACE FUNCTION public.is_demo_tenant(_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_demo FROM public.tenants WHERE id = _tenant_id),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.is_user_demo_only(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.user_id = _user_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.user_id = _user_id AND t.is_demo = false
  )
$$;

CREATE OR REPLACE FUNCTION public.can_access_tenant(_user_id UUID, _tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_tenant_access(_user_id, _tenant_id)
    AND (
      public.has_role(_user_id, 'admin'::public.app_role)
      OR (
        public.is_demo_tenant(_tenant_id) = public.is_user_demo_only(_user_id)
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
      AND public.can_access_tenant(_user_id, p.tenant_id)
      AND public.has_project_access(_user_id, p.id)
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
      AND public.can_access_tenant(_user_id, p.tenant_id)
      AND public.has_project_editor_access(_user_id, p.id)
  )
$$;

-- Projects without tenant_id remain accessible via legacy project access during staged rollout.
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
        public.can_access_tenant(_user_id, _tenant_id)
        AND EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = _project_id
            AND (p.tenant_id IS NULL OR p.tenant_id = _tenant_id)
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
        public.can_access_tenant(_user_id, _tenant_id)
        AND EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = _project_id
            AND (p.tenant_id IS NULL OR p.tenant_id = _tenant_id)
        )
      )
    )
$$;

-- ---------------------------------------------------------------------------
-- tenants / tenant_memberships RLS
-- ---------------------------------------------------------------------------

CREATE POLICY "Users can view tenants they belong to"
ON public.tenants
FOR SELECT
USING (public.can_access_tenant(auth.uid(), id));

CREATE POLICY "Tenant admins can update their tenant"
ON public.tenants
FOR UPDATE
USING (public.has_tenant_admin_access(auth.uid(), id));

CREATE POLICY "Users can view memberships for accessible tenants"
ON public.tenant_memberships
FOR SELECT
USING (public.can_access_tenant(auth.uid(), tenant_id));

CREATE POLICY "Tenant admins can manage memberships"
ON public.tenant_memberships
FOR INSERT
WITH CHECK (public.has_tenant_admin_access(auth.uid(), tenant_id));

CREATE POLICY "Tenant admins can update memberships"
ON public.tenant_memberships
FOR UPDATE
USING (public.has_tenant_admin_access(auth.uid(), tenant_id));

CREATE POLICY "Tenant admins can delete memberships"
ON public.tenant_memberships
FOR DELETE
USING (public.has_tenant_admin_access(auth.uid(), tenant_id));

-- Platform admins can read all tenants (support operations).
CREATE POLICY "Platform admins can view all tenants"
ON public.tenants
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Seed dedicated demo tenant (empty until demo users are provisioned).
INSERT INTO public.tenants (id, name, slug, is_demo, is_active)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'PermitPilot Demo',
  'permitpilot-demo',
  true,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  is_demo = true,
  is_active = true,
  updated_at = now();

GRANT EXECUTE ON FUNCTION public.has_tenant_access(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_tenant_admin_access(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_tenant(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_tenant_project_access(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_tenant_project_editor_access(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_uci_row_access(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_uci_row_editor_access(UUID, UUID, UUID) TO authenticated;
