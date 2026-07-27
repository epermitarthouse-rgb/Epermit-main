-- Harden project tenant inheritance without weakening tenant-scoped SELECT.
--
-- Intended SELECT contract (same as 20260715140400_row2_tenant_rls_hardening):
--   - tenant_id IS NULL  → legacy owner/team access
--   - tenant_id IS NOT NULL → require can_access_tenant AND has_project_access
-- Do NOT add a bare user_id = auth.uid() bypass for tenant-scoped rows.
--
-- Trigger: validate/inherit tenant on INSERT and on UPDATE of user_id/tenant_id.
-- Function runs as SECURITY DEFINER so membership lookup is not blocked by RLS.
-- EXECUTE is revoked from PUBLIC/anon/authenticated (trigger-only; not an RPC).

DROP POLICY IF EXISTS "Users can view accessible projects" ON public.projects;

CREATE POLICY "Users can view accessible projects"
ON public.projects
FOR SELECT
USING (
  (
    -- Legacy unscoped rows: owner or team member
    tenant_id IS NULL
    AND (user_id = auth.uid() OR public.has_project_access(auth.uid(), id))
  )
  OR (
    -- Tenant-scoped rows: membership required (demo isolation via can_access_tenant)
    tenant_id IS NOT NULL
    AND public.can_access_tenant(auth.uid(), tenant_id)
    AND public.has_project_access(auth.uid(), id)
  )
);

CREATE OR REPLACE FUNCTION public.set_project_tenant_from_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- If tenant is set (client or prior value), owner must belong to that tenant.
  IF NEW.tenant_id IS NOT NULL THEN
    IF NOT public.has_tenant_access(NEW.user_id, NEW.tenant_id) THEN
      RAISE EXCEPTION 'project owner must belong to tenant' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Inherit first non-demo owner membership when tenant_id is omitted/cleared.
  SELECT tm.tenant_id INTO NEW.tenant_id
  FROM public.tenant_memberships tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE tm.user_id = NEW.user_id
    AND tm.role = 'owner'
    AND t.is_demo = false
  ORDER BY tm.created_at ASC
  LIMIT 1;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_set_tenant_from_owner ON public.projects;
CREATE TRIGGER projects_set_tenant_from_owner
BEFORE INSERT OR UPDATE OF user_id, tenant_id ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.set_project_tenant_from_owner();

REVOKE ALL ON FUNCTION public.set_project_tenant_from_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_project_tenant_from_owner() FROM anon;
REVOKE ALL ON FUNCTION public.set_project_tenant_from_owner() FROM authenticated;
-- No GRANT to anon or authenticated — trigger is invoked by the table owner only.

-- INSERT/UPDATE/DELETE ownership policies intentionally unchanged:
--   INSERT WITH CHECK (auth.uid() = user_id)
--   UPDATE/DELETE USING (auth.uid() = user_id)
