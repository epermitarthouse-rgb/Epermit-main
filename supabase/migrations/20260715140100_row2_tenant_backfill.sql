-- Row 2 stage 2: Deterministic tenant backfill from existing project ownership.
-- Assumptions (documented):
--   1. One tenant per distinct projects.user_id when no org link exists.
--   2. Tenant name prefers profiles.company_name, then profiles.full_name, else neutral label.
--   3. Slug derived from name + stable user_id suffix; unrelated owners are never merged.
--   4. Commun-ET / McDonald's are NOT auto-modeled as separate tenants without explicit data.
--   5. Demo tenant (permitpilot-demo) is seeded empty; shadow_mode alone does NOT move projects.
-- Idempotent: safe to re-run after partial application.

CREATE OR REPLACE FUNCTION public._slugify_tenant_label(p_label TEXT, p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_base TEXT;
  v_suffix TEXT;
BEGIN
  v_base := lower(regexp_replace(coalesce(nullif(trim(p_label), ''), 'workspace'), '[^a-z0-9]+', '-', 'g'));
  v_base := trim(both '-' from v_base);
  IF v_base = '' OR length(v_base) < 2 THEN
    v_base := 'workspace';
  END IF;
  v_suffix := left(replace(p_user_id::text, '-', ''), 8);
  RETURN left(v_base, 40) || '-' || v_suffix;
END;
$$;

-- Create one tenant per project owner that does not yet have a tenant membership as owner.
INSERT INTO public.tenants (name, slug, is_demo, is_active)
SELECT DISTINCT ON (p.user_id)
  coalesce(
    nullif(trim(pr.company_name), ''),
    nullif(trim(pr.full_name), ''),
    'Workspace ' || left(p.user_id::text, 8)
  ) AS name,
  public._slugify_tenant_label(
    coalesce(nullif(trim(pr.company_name), ''), nullif(trim(pr.full_name), ''), 'workspace'),
    p.user_id
  ) AS slug,
  false,
  true
FROM public.projects p
LEFT JOIN public.profiles pr ON pr.user_id = p.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.tenant_memberships tm
  WHERE tm.user_id = p.user_id AND tm.role = 'owner'
)
ON CONFLICT (slug) DO NOTHING;

-- Map owners to their tenant via slug convention.
INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
SELECT t.id, p.user_id, 'owner'::public.tenant_membership_role
FROM (
  SELECT DISTINCT user_id FROM public.projects
) p
JOIN public.profiles pr ON pr.user_id = p.user_id
JOIN public.tenants t ON t.slug = public._slugify_tenant_label(
  coalesce(nullif(trim(pr.company_name), ''), nullif(trim(pr.full_name), ''), 'workspace'),
  p.user_id
)
WHERE t.is_demo = false
ON CONFLICT (tenant_id, user_id) DO NOTHING;

-- Attach projects to owner's tenant.
UPDATE public.projects p
SET tenant_id = tm.tenant_id
FROM public.tenant_memberships tm
WHERE p.tenant_id IS NULL
  AND tm.user_id = p.user_id
  AND tm.role = 'owner'
  AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = tm.tenant_id AND t.is_demo = false);

-- Team members: ensure membership on project's tenant.
INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
SELECT DISTINCT p.tenant_id, ptm.user_id, 'member'::public.tenant_membership_role
FROM public.project_team_members ptm
JOIN public.projects p ON p.id = ptm.project_id
WHERE p.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, user_id) DO NOTHING;

-- Propagate tenant_id to coordination_records from projects.
UPDATE public.coordination_records cr
SET tenant_id = p.tenant_id
FROM public.projects p
WHERE cr.project_id = p.id
  AND cr.tenant_id IS DISTINCT FROM p.tenant_id
  AND p.tenant_id IS NOT NULL;

-- Propagate to child tables that already have tenant_id column.
UPDATE public.coordination_applications ca
SET tenant_id = cr.tenant_id
FROM public.coordination_records cr
WHERE ca.coordination_record_id = cr.id
  AND ca.project_id = cr.project_id
  AND cr.tenant_id IS NOT NULL
  AND ca.tenant_id IS DISTINCT FROM cr.tenant_id;

UPDATE public.coordination_communications cc
SET tenant_id = cr.tenant_id
FROM public.coordination_records cr
WHERE cc.coordination_record_id = cr.id
  AND cc.project_id = cr.project_id
  AND cr.tenant_id IS NOT NULL
  AND cc.tenant_id IS DISTINCT FROM cr.tenant_id;

UPDATE public.coordination_milestones cm
SET tenant_id = cr.tenant_id
FROM public.coordination_records cr
WHERE cm.coordination_record_id = cr.id
  AND cm.project_id = cr.project_id
  AND cr.tenant_id IS NOT NULL
  AND cm.tenant_id IS DISTINCT FROM cr.tenant_id;

REVOKE ALL ON FUNCTION public._slugify_tenant_label(TEXT, UUID) FROM PUBLIC;
