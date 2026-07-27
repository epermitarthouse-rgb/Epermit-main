-- Fix projects INSERT...RETURNING under tenant-hardened SELECT.
--
-- Breakage (live):
--   20260715140200 stamps tenant_id on INSERT via projects_set_tenant_from_owner.
--   20260715140400 SELECT for tenant-scoped rows required only:
--     can_access_tenant(...) AND has_project_access(...)
--   App create uses insert().select().single() → INSERT ... RETURNING.
--   has_project_access is STABLE and re-queries projects; it often cannot see the
--   row being inserted in the same statement, so RETURNING fails with:
--     42501 new row violates row-level security policy for table "projects"
--
-- Fix:
--   Owner SELECT path uses row attributes (no same-statement projects lookup):
--     user_id = auth.uid()
--     AND (tenant_id IS NULL OR can_access_tenant(auth.uid(), tenant_id))
--   Team / legacy paths keep membership + has_project_access.
--   INSERT/UPDATE/DELETE policies are intentionally unchanged.
--
-- Also harden set_project_tenant_from_owner as SECURITY DEFINER so membership
-- inheritance is not blocked by tenant_memberships RLS (trigger-only; not an RPC).
--
-- This file supersedes the earlier draft of the same migration that kept the
-- broken tenant-scoped SELECT shape from 20260715140400.
-- Safe: no DROP TABLE, no data rewrites, no UCI policy changes.

DROP POLICY IF EXISTS "Users can view accessible projects" ON public.projects;

CREATE POLICY "Users can view accessible projects"
ON public.projects
FOR SELECT
USING (
  -- Owner path: attribute check safe for INSERT ... RETURNING.
  -- Tenant-scoped owners still require membership (demo isolation).
  (
    user_id = auth.uid()
    AND (
      tenant_id IS NULL
      OR public.can_access_tenant(auth.uid(), tenant_id)
    )
  )
  OR (
    -- Legacy unscoped non-owner / team access
    tenant_id IS NULL
    AND public.has_project_access(auth.uid(), id)
  )
  OR (
    -- Tenant-scoped team access
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
