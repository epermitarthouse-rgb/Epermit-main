-- Align projects SELECT RLS with default+override governance (20260911170000 / 20260911190000).
--
-- Root cause: 20260911190000 rewired has_project_access() to default Write for active users,
-- but the projects SELECT policy from 20260727120000 still requires can_access_tenant() for
-- every tenant-scoped row. All production projects carry tenant_id; users without
-- tenant_memberships rows (e.g. admin-created accounts) see zero projects despite
-- has_project_access() returning true.
--
-- Fix: gate visibility on has_project_access(), preserving:
--   1. Owner attribute path for INSERT ... RETURNING (same-statement has_project_access gap).
--   2. Demo-tenant isolation (demo tenants still require membership via can_access_tenant).
--
-- Why relaxing can_access_tenant() for non-demo tenants is safe:
--   - has_project_access() already enforces default Write, explicit none/read/write overrides,
--     platform-admin bypass, owner path, and inactive-user denial.
--   - can_access_tenant() only adds demo↔production isolation (is_demo_tenant parity check).
--   - Production tenant rows are visible when has_project_access() passes; demo rows still
--     require can_access_tenant() so cross-environment leakage cannot occur.
--   - Platform admins bypass demo isolation inside can_access_tenant() via is_platform_admin().
--
-- INSERT/UPDATE/DELETE policies intentionally unchanged (owner-only mutations on projects).

DROP POLICY IF EXISTS "Users can view accessible projects" ON public.projects;

CREATE POLICY "Users can view accessible projects"
ON public.projects
FOR SELECT
USING (
  -- Owner path: attribute check safe for INSERT ... RETURNING.
  (
    user_id = auth.uid()
    AND (
      tenant_id IS NULL
      OR public.can_access_tenant(auth.uid(), tenant_id)
    )
  )
  OR (
    public.has_project_access(auth.uid(), id)
    AND (
      tenant_id IS NULL
      OR NOT public.is_demo_tenant(tenant_id)
      OR public.can_access_tenant(auth.uid(), tenant_id)
    )
  )
);

COMMENT ON POLICY "Users can view accessible projects" ON public.projects IS
  'Default+override model: has_project_access governs visibility; demo tenants still require membership.';
