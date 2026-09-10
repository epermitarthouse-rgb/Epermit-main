-- Global (user-level) feature permissions: enforce project_id IS NULL rows and add delete RPC.
-- Schema already allows NULL project_id on user_feature_permissions (UNIQUE user_id, project_id, feature_key).

CREATE OR REPLACE FUNCTION public._active_user_default_feature_access(p_feature_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_feature_key = ANY(
    ARRAY[
      'scraper.run',
      'filing.submit',
      'documents.vault',
      'ingestion.rag',
      'code.analyzer',
      'credentials.self'
    ]
  ) THEN
    RETURN 'write';
  END IF;
  RETURN 'read';
END;
$$;

CREATE OR REPLACE FUNCTION public._global_feature_access_level(
  p_user_id UUID,
  p_feature_key TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_global TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'none';
  END IF;

  IF public.has_role(p_user_id, 'admin'::public.app_role) THEN
    RETURN 'write';
  END IF;

  IF NOT public.is_user_active(p_user_id) THEN
    RETURN 'none';
  END IF;

  SELECT ufp.access_level
  INTO v_global
  FROM public.user_feature_permissions ufp
  WHERE ufp.user_id = p_user_id
    AND ufp.project_id IS NULL
    AND ufp.feature_key = p_feature_key;

  IF v_global IS NOT NULL THEN
    RETURN v_global;
  END IF;

  RETURN public._active_user_default_feature_access(p_feature_key);
END;
$$;

CREATE OR REPLACE FUNCTION public._resolve_feature_access_level(
  p_user_id UUID,
  p_project_id UUID,
  p_feature_key TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_global TEXT;
  v_explicit TEXT;
  v_project_baseline TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'none';
  END IF;

  v_global := public._global_feature_access_level(p_user_id, p_feature_key);
  IF v_global = 'none' THEN
    RETURN 'none';
  END IF;

  IF p_project_id IS NULL THEN
    RETURN v_global;
  END IF;

  IF NOT public.has_project_access(p_user_id, p_project_id) THEN
    RETURN v_global;
  END IF;

  SELECT ufp.access_level
  INTO v_explicit
  FROM public.user_feature_permissions ufp
  WHERE ufp.user_id = p_user_id
    AND ufp.project_id = p_project_id
    AND ufp.feature_key = p_feature_key;

  IF v_explicit IS NOT NULL THEN
    v_project_baseline := v_explicit;
  ELSIF public.has_project_admin_access(p_user_id, p_project_id) THEN
    v_project_baseline := 'write';
  ELSIF public.has_project_editor_access(p_user_id, p_project_id) THEN
    v_project_baseline := public._active_user_default_feature_access(p_feature_key);
  ELSE
    v_project_baseline := 'read';
  END IF;

  RETURN CASE
    WHEN public._feature_level_rank(v_global) <= public._feature_level_rank(v_project_baseline)
      THEN v_global
    ELSE v_project_baseline
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_feature_permission(
  p_user_id UUID,
  p_project_id UUID,
  p_feature_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before JSONB;
BEGIN
  PERFORM public._admin_require_platform_admin();

  SELECT jsonb_build_object(
    'access_level', ufp.access_level,
    'project_id', ufp.project_id,
    'feature_key', ufp.feature_key
  )
  INTO v_before
  FROM public.user_feature_permissions ufp
  WHERE ufp.user_id = p_user_id
    AND ufp.project_id IS NOT DISTINCT FROM p_project_id
    AND ufp.feature_key = p_feature_key;

  DELETE FROM public.user_feature_permissions ufp
  WHERE ufp.user_id = p_user_id
    AND ufp.project_id IS NOT DISTINCT FROM p_project_id
    AND ufp.feature_key = p_feature_key;

  IF v_before IS NOT NULL THEN
    PERFORM public.admin_append_audit_event(
      'feature_permission.changed',
      'user',
      p_user_id::TEXT,
      p_project_id,
      p_feature_key,
      v_before,
      NULL,
      'success',
      NULL,
      auth.uid()
    );
  END IF;

  RETURN jsonb_build_object('deleted', v_before IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_feature_permission(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_feature_permission(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_feature_permission(UUID, UUID, TEXT) TO service_role;
