-- Service-role backend calls have auth.uid() = NULL; pass explicit p_actor_id from Express
-- (JWT platform admin verified by requirePlatformAdmin). Reuses admin_append_audit_event pattern:
-- COALESCE(p_actor_id, auth.uid()).

CREATE OR REPLACE FUNCTION public._admin_resolve_actor(p_actor_id UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(p_actor_id, auth.uid());
$$;

REVOKE ALL ON FUNCTION public._admin_resolve_actor(UUID) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- admin_copy_permissions
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_copy_permissions(UUID, UUID);

CREATE OR REPLACE FUNCTION public.admin_copy_permissions(
  p_from_user_id UUID,
  p_to_user_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_feature_count INTEGER := 0;
  v_scope_count INTEGER := 0;
  v_grant_count INTEGER := 0;
BEGIN
  PERFORM public._admin_require_backend_caller();
  v_actor := public._admin_resolve_actor(p_actor_id);

  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION 'Source and target users must differ' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = p_from_user_id) THEN
    RAISE EXCEPTION 'Source user not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = p_to_user_id) THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.user_feature_permissions WHERE user_id = p_to_user_id;
  DELETE FROM public.user_scraped_data_scope WHERE user_id = p_to_user_id;
  DELETE FROM public.user_portal_credential_grants WHERE user_id = p_to_user_id;

  INSERT INTO public.user_feature_permissions (
    user_id, project_id, feature_key, access_level, granted_by
  )
  SELECT
    p_to_user_id,
    ufp.project_id,
    ufp.feature_key,
    ufp.access_level,
    v_actor
  FROM public.user_feature_permissions ufp
  WHERE ufp.user_id = p_from_user_id;
  GET DIAGNOSTICS v_feature_count = ROW_COUNT;

  INSERT INTO public.user_scraped_data_scope (
    user_id, scope_type, scope_ref, granted_by
  )
  SELECT
    p_to_user_id,
    s.scope_type,
    s.scope_ref,
    v_actor
  FROM public.user_scraped_data_scope s
  WHERE s.user_id = p_from_user_id;
  GET DIAGNOSTICS v_scope_count = ROW_COUNT;

  INSERT INTO public.user_portal_credential_grants (
    user_id, credential_id, grant_level, project_id, jurisdiction, granted_by
  )
  SELECT
    p_to_user_id,
    g.credential_id,
    g.grant_level,
    g.project_id,
    g.jurisdiction,
    v_actor
  FROM public.user_portal_credential_grants g
  WHERE g.user_id = p_from_user_id;
  GET DIAGNOSTICS v_grant_count = ROW_COUNT;

  PERFORM public.admin_append_audit_event(
    'permissions.copied',
    'user',
    p_to_user_id::TEXT,
    NULL,
    NULL,
    jsonb_build_object('from_user_id', p_from_user_id),
    jsonb_build_object(
      'from_user_id', p_from_user_id,
      'to_user_id', p_to_user_id,
      'feature_permissions', v_feature_count,
      'scraped_data_scope', v_scope_count,
      'credential_grants', v_grant_count
    ),
    'success',
    NULL,
    v_actor
  );

  RETURN jsonb_build_object(
    'from_user_id', p_from_user_id,
    'to_user_id', p_to_user_id,
    'feature_permissions', v_feature_count,
    'scraped_data_scope', v_scope_count,
    'credential_grants', v_grant_count
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_set_feature_permission / admin_delete_feature_permission
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_set_feature_permission(UUID, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_set_feature_permission(
  p_user_id UUID,
  p_project_id UUID,
  p_feature_key TEXT,
  p_access_level TEXT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_before JSONB;
  v_after JSONB;
  v_row public.user_feature_permissions%ROWTYPE;
BEGIN
  PERFORM public._admin_require_backend_caller();
  v_actor := public._admin_resolve_actor(p_actor_id);

  IF p_access_level NOT IN ('none', 'read', 'write') THEN
    RAISE EXCEPTION 'Invalid access_level' USING ERRCODE = '22023';
  END IF;

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

  INSERT INTO public.user_feature_permissions (
    user_id,
    project_id,
    feature_key,
    access_level,
    granted_by
  )
  VALUES (
    p_user_id,
    p_project_id,
    p_feature_key,
    p_access_level,
    v_actor
  )
  ON CONFLICT (user_id, project_id, feature_key)
  DO UPDATE SET
    access_level = EXCLUDED.access_level,
    granted_by = EXCLUDED.granted_by,
    updated_at = now()
  RETURNING * INTO v_row;

  v_after := jsonb_build_object(
    'access_level', v_row.access_level,
    'project_id', v_row.project_id,
    'feature_key', v_row.feature_key
  );

  PERFORM public.admin_append_audit_event(
    'feature_permission.changed',
    'user',
    p_user_id::TEXT,
    p_project_id,
    p_feature_key,
    v_before,
    v_after,
    'success',
    NULL,
    v_actor
  );

  RETURN v_after;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_delete_feature_permission(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.admin_delete_feature_permission(
  p_user_id UUID,
  p_project_id UUID,
  p_feature_key TEXT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_before JSONB;
BEGIN
  PERFORM public._admin_require_backend_caller();
  v_actor := public._admin_resolve_actor(p_actor_id);

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
      v_actor
    );
  END IF;

  RETURN jsonb_build_object('deleted', v_before IS NOT NULL);
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_set_scraped_data_scope / admin_set_credential_grant
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_set_scraped_data_scope(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_set_scraped_data_scope(
  p_user_id UUID,
  p_scope_type TEXT,
  p_scope_ref TEXT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_before JSONB;
  v_after JSONB;
  v_row public.user_scraped_data_scope%ROWTYPE;
BEGIN
  PERFORM public._admin_require_backend_caller();
  v_actor := public._admin_resolve_actor(p_actor_id);

  IF p_scope_type NOT IN ('project', 'jurisdiction', 'portal_source') THEN
    RAISE EXCEPTION 'Invalid scope_type' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'scope_type', s.scope_type,
    'scope_ref', s.scope_ref
  )
  INTO v_before
  FROM public.user_scraped_data_scope s
  WHERE s.user_id = p_user_id
    AND s.scope_type = p_scope_type
    AND s.scope_ref = p_scope_ref;

  INSERT INTO public.user_scraped_data_scope (
    user_id,
    scope_type,
    scope_ref,
    granted_by
  )
  VALUES (
    p_user_id,
    p_scope_type,
    p_scope_ref,
    v_actor
  )
  ON CONFLICT (user_id, scope_type, scope_ref)
  DO UPDATE SET
    granted_by = EXCLUDED.granted_by
  RETURNING * INTO v_row;

  v_after := jsonb_build_object(
    'scope_type', v_row.scope_type,
    'scope_ref', v_row.scope_ref
  );

  PERFORM public.admin_append_audit_event(
    'scraped_data_scope.changed',
    'user',
    p_user_id::TEXT,
    NULL,
    NULL,
    v_before,
    v_after,
    'success',
    NULL,
    v_actor
  );

  RETURN v_after;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_set_credential_grant(UUID, UUID, TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.admin_set_credential_grant(
  p_user_id UUID,
  p_credential_id UUID,
  p_grant_level TEXT,
  p_project_id UUID DEFAULT NULL,
  p_jurisdiction TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_before JSONB;
  v_after JSONB;
  v_row public.user_portal_credential_grants%ROWTYPE;
BEGIN
  PERFORM public._admin_require_backend_caller();
  v_actor := public._admin_resolve_actor(p_actor_id);

  IF p_grant_level NOT IN ('none', 'use', 'manage') THEN
    RAISE EXCEPTION 'Invalid grant_level' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.portal_credentials pc WHERE pc.id = p_credential_id
  ) THEN
    RAISE EXCEPTION 'Credential not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_build_object(
    'grant_level', g.grant_level,
    'project_id', g.project_id,
    'jurisdiction', g.jurisdiction
  )
  INTO v_before
  FROM public.user_portal_credential_grants g
  WHERE g.user_id = p_user_id
    AND g.credential_id = p_credential_id;

  INSERT INTO public.user_portal_credential_grants (
    user_id,
    credential_id,
    grant_level,
    project_id,
    jurisdiction,
    granted_by
  )
  VALUES (
    p_user_id,
    p_credential_id,
    p_grant_level,
    p_project_id,
    p_jurisdiction,
    v_actor
  )
  ON CONFLICT (user_id, credential_id)
  DO UPDATE SET
    grant_level = EXCLUDED.grant_level,
    project_id = EXCLUDED.project_id,
    jurisdiction = EXCLUDED.jurisdiction,
    granted_by = EXCLUDED.granted_by,
    updated_at = now()
  RETURNING * INTO v_row;

  v_after := jsonb_build_object(
    'grant_level', v_row.grant_level,
    'credential_id', v_row.credential_id,
    'project_id', v_row.project_id,
    'jurisdiction', v_row.jurisdiction
  );

  PERFORM public.admin_append_audit_event(
    CASE WHEN p_grant_level = 'none' THEN 'credential_grant.revoked' ELSE 'credential_grant.changed' END,
    'user',
    p_user_id::TEXT,
    p_project_id,
    NULL,
    v_before,
    v_after,
    'success',
    NULL,
    v_actor
  );

  RETURN v_after;
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_activate_user / admin_deactivate_user
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_deactivate_user(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.admin_deactivate_user(
  p_user_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_before JSONB;
  v_grants_revoked INTEGER;
BEGIN
  PERFORM public._admin_require_backend_caller();
  v_actor := public._admin_resolve_actor(p_actor_id);

  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    IF p_user_id = auth.uid() THEN
      RAISE EXCEPTION 'Cannot deactivate your own account' USING ERRCODE = '42501';
    END IF;

    IF NOT public.is_super_admin(auth.uid())
       AND (public.has_role(p_user_id, 'admin'::public.app_role)
            OR public.has_role(p_user_id, 'super_admin'::public.app_role)) THEN
      RAISE EXCEPTION 'Platform admin cannot deactivate another admin' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF public.is_super_admin(p_user_id)
     AND public._super_admin_count() <= 1 THEN
    RAISE EXCEPTION 'Cannot deactivate the last super admin' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object('access_status', p.access_status)
  INTO v_before
  FROM public.profiles p
  WHERE p.user_id = p_user_id;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.profiles
  SET access_status = 'deactivated',
      updated_at = now()
  WHERE user_id = p_user_id;

  UPDATE public.user_portal_credential_grants
  SET grant_level = 'none',
      granted_by = v_actor,
      updated_at = now()
  WHERE user_id = p_user_id
    AND grant_level <> 'none';

  GET DIAGNOSTICS v_grants_revoked = ROW_COUNT;

  PERFORM public.admin_append_audit_event(
    'admin.user.deactivated',
    'user',
    p_user_id::TEXT,
    NULL,
    NULL,
    v_before,
    jsonb_build_object(
      'access_status', 'deactivated',
      'credential_grants_revoked', v_grants_revoked,
      'reason', p_reason
    ),
    'success',
    NULL,
    v_actor
  );

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'access_status', 'deactivated',
    'credential_grants_revoked', v_grants_revoked
  );
END;
$$;

DROP FUNCTION IF EXISTS public.admin_activate_user(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.admin_activate_user(
  p_user_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_before JSONB;
BEGIN
  PERFORM public._admin_require_backend_caller();
  v_actor := public._admin_resolve_actor(p_actor_id);

  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    IF NOT public.is_super_admin(auth.uid())
       AND (public.has_role(p_user_id, 'admin'::public.app_role)
            OR public.has_role(p_user_id, 'super_admin'::public.app_role)) THEN
      RAISE EXCEPTION 'Platform admin cannot activate another admin' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT jsonb_build_object('access_status', p.access_status)
  INTO v_before
  FROM public.profiles p
  WHERE p.user_id = p_user_id;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.profiles
  SET access_status = 'active',
      updated_at = now()
  WHERE user_id = p_user_id;

  PERFORM public.admin_append_audit_event(
    'admin.user.reactivated',
    'user',
    p_user_id::TEXT,
    NULL,
    NULL,
    v_before,
    jsonb_build_object('access_status', 'active', 'reason', p_reason),
    'success',
    NULL,
    v_actor
  );

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'access_status', 'active'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants (new signatures)
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.admin_copy_permissions(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_copy_permissions(UUID, UUID, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_set_feature_permission(UUID, UUID, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_feature_permission(UUID, UUID, TEXT, TEXT, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_delete_feature_permission(UUID, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_feature_permission(UUID, UUID, TEXT, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_set_scraped_data_scope(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_scraped_data_scope(UUID, TEXT, TEXT, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_set_credential_grant(UUID, UUID, TEXT, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_credential_grant(UUID, UUID, TEXT, UUID, TEXT, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_deactivate_user(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_deactivate_user(UUID, TEXT, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_activate_user(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_activate_user(UUID, TEXT, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public._admin_resolve_actor(UUID) IS
  'Resolves admin actor for service-role backend RPCs: COALESCE(p_actor_id, auth.uid()).';

COMMENT ON FUNCTION public.admin_copy_permissions(UUID, UUID, UUID) IS
  'Bulk permission copy; p_actor_id from Express JWT admin when called via service_role backend.';
