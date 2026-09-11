-- Wire has_project_access / has_project_editor_access to the default+override model.
-- Active users default to Write on all projects; explicit user_project_access_overrides
-- rows (none/read/write) are exceptions. RLS and backend requireProjectAccess RPCs
-- must match admin effective-permissions / assembleEffectiveAccessViews.

CREATE OR REPLACE FUNCTION public.has_project_access(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._resolve_project_access_level(_user_id, _project_id)
    IN ('owner', 'read', 'write')
$$;

CREATE OR REPLACE FUNCTION public.has_project_editor_access(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._resolve_project_access_level(_user_id, _project_id)
    IN ('owner', 'write')
$$;

GRANT EXECUTE ON FUNCTION public.has_project_access(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_project_editor_access(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.has_project_access(UUID, UUID) IS
  'Project read access: owner, explicit override (read/write), or default Write for active users; none override denies.';

COMMENT ON FUNCTION public.has_project_editor_access(UUID, UUID) IS
  'Project write access: owner, default Write, or explicit write override; read/none overrides deny writes.';
