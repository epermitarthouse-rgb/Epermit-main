-- Default + override access model (additive).
-- Explicit rows in override/grant tables represent exceptions only.
-- Active users default to: all projects Write, all standard features Write,
-- all portal credentials Use (platform admin: Manage).

-- ---------------------------------------------------------------------------
-- 1. Project access overrides (exceptions from default Write on all projects)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_project_access_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL CHECK (access_level IN ('none', 'read', 'write')),
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_user_project_access_overrides_user
  ON public.user_project_access_overrides (user_id);

ALTER TABLE public.user_project_access_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins read project access overrides"
  ON public.user_project_access_overrides;
CREATE POLICY "Platform admins read project access overrides"
  ON public.user_project_access_overrides
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Users read own project access overrides"
  ON public.user_project_access_overrides;
CREATE POLICY "Users read own project access overrides"
  ON public.user_project_access_overrides
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON public.user_project_access_overrides TO authenticated;
GRANT ALL ON public.user_project_access_overrides TO service_role;

-- Backfill legacy team restrictions: viewer membership -> read override.
INSERT INTO public.user_project_access_overrides (user_id, project_id, access_level)
SELECT ptm.user_id, ptm.project_id, 'read'::TEXT
FROM public.project_team_members ptm
WHERE ptm.role = 'viewer'::public.team_role
  AND NOT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = ptm.project_id
      AND p.user_id = ptm.user_id
  )
ON CONFLICT (user_id, project_id) DO NOTHING;

-- Backfill explicit none from legacy team removal is not possible; editor/admin rows
-- match default Write and need no override row.

-- ---------------------------------------------------------------------------
-- 2. Credential default grant: active users get Use when no override row exists
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._default_credential_grant_level(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'none';
  END IF;

  IF public.has_role(p_user_id, 'admin'::public.app_role) THEN
    RETURN 'manage';
  END IF;

  IF NOT public.is_user_active(p_user_id) THEN
    RETURN 'none';
  END IF;

  RETURN 'use';
END;
$$;

CREATE OR REPLACE FUNCTION public.credential_has_grant(
  p_user_id UUID,
  p_credential_id UUID,
  p_min_level TEXT DEFAULT 'use'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grant_level TEXT;
  v_required_rank INTEGER;
  v_effective_rank INTEGER;
BEGIN
  IF p_user_id IS NULL OR p_credential_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF public.has_role(p_user_id, 'admin'::public.app_role) THEN
    RETURN TRUE;
  END IF;

  IF NOT public.is_user_active(p_user_id) THEN
    RETURN FALSE;
  END IF;

  v_required_rank := public._grant_level_rank(p_min_level);

  SELECT g.grant_level
  INTO v_grant_level
  FROM public.user_portal_credential_grants g
  WHERE g.user_id = p_user_id
    AND g.credential_id = p_credential_id;

  IF v_grant_level IS NULL THEN
    v_effective_rank := public._grant_level_rank(public._default_credential_grant_level(p_user_id));
    RETURN v_effective_rank >= v_required_rank;
  END IF;

  IF v_grant_level = 'none' THEN
    RETURN FALSE;
  END IF;

  RETURN public._grant_level_rank(v_grant_level) >= v_required_rank;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Project access level helper (governance / admin effective permissions)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._resolve_project_access_level(
  p_user_id UUID,
  p_project_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_override TEXT;
  v_team_role public.team_role;
BEGIN
  IF p_user_id IS NULL OR p_project_id IS NULL THEN
    RETURN 'none';
  END IF;

  IF public.has_role(p_user_id, 'admin'::public.app_role) THEN
    RETURN 'write';
  END IF;

  IF NOT public.is_user_active(p_user_id) THEN
    RETURN 'none';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.user_id = p_user_id
  ) THEN
    RETURN 'owner';
  END IF;

  SELECT o.access_level
  INTO v_override
  FROM public.user_project_access_overrides o
  WHERE o.user_id = p_user_id
    AND o.project_id = p_project_id;

  IF v_override IS NOT NULL THEN
    RETURN v_override;
  END IF;

  SELECT ptm.role
  INTO v_team_role
  FROM public.project_team_members ptm
  WHERE ptm.user_id = p_user_id
    AND ptm.project_id = p_project_id;

  IF v_team_role = 'viewer'::public.team_role THEN
    RETURN 'read';
  END IF;

  IF v_team_role IN ('editor'::public.team_role, 'admin'::public.team_role) THEN
    RETURN 'write';
  END IF;

  RETURN 'write';
END;
$$;

REVOKE ALL ON FUNCTION public._default_credential_grant_level(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._resolve_project_access_level(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._default_credential_grant_level(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._resolve_project_access_level(UUID, UUID) TO authenticated, service_role;
