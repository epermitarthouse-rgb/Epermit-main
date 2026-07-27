-- Restore projects SELECT owner short-circuit and harden tenant inheritance trigger.
--
-- Regression (20260715140400_row2_tenant_rls_hardening):
--   SELECT required can_access_tenant when tenant_id IS NOT NULL, without
--   user_id = auth.uid() short-circuit. Owners who fail demo/tenant edge checks
--   could not RETURNING/read their own inserts.
--
-- Original contract (20260113051923):
--   USING (user_id = auth.uid() OR has_project_access(auth.uid(), id))
--
-- Also mark set_project_tenant_from_owner as SECURITY DEFINER so membership
-- lookup is not blocked by tenant_memberships RLS during INSERT.

DROP POLICY IF EXISTS "Users can view accessible projects" ON public.projects;

CREATE POLICY "Users can view accessible projects"
ON public.projects
FOR SELECT
USING (
  -- Original owner contract (always readable by creator)
  user_id = auth.uid()
  OR (
    -- Legacy unscoped rows: team access
    tenant_id IS NULL
    AND public.has_project_access(auth.uid(), id)
  )
  OR (
    -- Tenant-scoped rows: membership + project access
    tenant_id IS NOT NULL
    AND public.can_access_tenant(auth.uid(), tenant_id)
    AND public.has_project_access(auth.uid(), id)
  )
);

CREATE OR REPLACE FUNCTION public.set_project_tenant_from_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    IF NOT public.has_tenant_access(NEW.user_id, NEW.tenant_id) THEN
      RAISE EXCEPTION 'project owner must belong to tenant' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

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
BEFORE INSERT ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.set_project_tenant_from_owner();

-- Keep INSERT/UPDATE/DELETE ownership contract unchanged:
--   INSERT WITH CHECK (auth.uid() = user_id)
--   UPDATE/DELETE USING (auth.uid() = user_id)
