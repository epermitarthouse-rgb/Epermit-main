-- Restore service-role backend access for admin RPCs invoked by Railway (Express service client).
-- Express requirePlatformAdmin still gates HTTP; these RPCs accept service_role OR authenticated platform admin.
-- Fixes regression in 20260911200500 that overwrote 20260910130000 admin_get_effective_permissions.

-- ---------------------------------------------------------------------------
-- admin_get_effective_permissions (regressed by super_admin hierarchy remainder)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_effective_permissions(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public._admin_require_backend_caller();

  SELECT jsonb_build_object(
    'user_id', p_user_id,
    'access_status', COALESCE(p.access_status, 'active'),
    'platform_admin', public.is_platform_admin(p_user_id),
    'platform_roles', COALESCE(
      (
        SELECT jsonb_agg(ur.role ORDER BY ur.role)
        FROM public.user_roles ur
        WHERE ur.user_id = p_user_id
      ),
      '[]'::jsonb
    ),
    'feature_permissions', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', fp.id,
            'project_id', fp.project_id,
            'feature_key', fp.feature_key,
            'access_level', fp.access_level,
            'granted_by', fp.granted_by,
            'updated_at', fp.updated_at
          )
        )
        FROM public.user_feature_permissions fp
        WHERE fp.user_id = p_user_id
      ),
      '[]'::jsonb
    ),
    'scraped_data_scope', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'scope_type', s.scope_type,
            'scope_ref', s.scope_ref,
            'granted_by', s.granted_by,
            'created_at', s.created_at
          )
        )
        FROM public.user_scraped_data_scope s
        WHERE s.user_id = p_user_id
      ),
      '[]'::jsonb
    ),
    'credential_grants', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', g.id,
            'credential_id', g.credential_id,
            'grant_level', g.grant_level,
            'project_id', g.project_id,
            'jurisdiction', g.jurisdiction,
            'granted_by', g.granted_by,
            'updated_at', g.updated_at
          )
        )
        FROM public.user_portal_credential_grants g
        WHERE g.user_id = p_user_id
      ),
      '[]'::jsonb
    ),
    'access_review', (
      SELECT jsonb_build_object('reviewed_by', r.reviewed_by, 'reviewed_at', r.reviewed_at)
      FROM public.user_access_reviews r
      WHERE r.user_id = p_user_id
    ),
    'projects', '[]'::jsonb,
    'risks', CASE
      WHEN public.is_super_admin(p_user_id)
           AND public._super_admin_count() <= 1 THEN
        jsonb_build_array('sole_super_admin')
      WHEN public.has_role(p_user_id, 'admin'::public.app_role)
           AND NOT public.is_super_admin(p_user_id)
           AND public._platform_admin_count() <= 1 THEN
        jsonb_build_array('sole_platform_admin')
      ELSE '[]'::jsonb
    END
  )
  INTO v_result
  FROM public.profiles p
  WHERE p.user_id = p_user_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_list_audit_events
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_audit_events(
  p_limit INTEGER DEFAULT 50,
  p_cursor_created_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL,
  p_action TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
  p_target_type TEXT DEFAULT NULL,
  p_from_date TIMESTAMPTZ DEFAULT NULL,
  p_to_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_rows JSONB;
  v_next_cursor JSONB;
  v_last_created_at TIMESTAMPTZ;
  v_last_id UUID;
BEGIN
  PERFORM public._admin_require_backend_caller();

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);

  SELECT COALESCE(
    jsonb_agg(row_data ORDER BY sort_created_at DESC, sort_id DESC),
    '[]'::jsonb
  )
  INTO v_rows
  FROM (
    SELECT
      e.created_at AS sort_created_at,
      e.id AS sort_id,
      jsonb_build_object(
        'id', e.id,
        'correlation_id', e.correlation_id,
        'actor_id', e.actor_id,
        'action', e.action,
        'target_type', e.target_type,
        'target_id', e.target_id,
        'project_id', e.project_id,
        'feature_key', e.feature_key,
        'before_json', e.before_json,
        'after_json', e.after_json,
        'result', e.result,
        'created_at', e.created_at
      ) AS row_data
    FROM public.platform_audit_events e
    WHERE (p_action IS NULL OR e.action = p_action)
      AND (p_actor_id IS NULL OR e.actor_id = p_actor_id)
      AND (p_target_type IS NULL OR e.target_type = p_target_type)
      AND (p_from_date IS NULL OR e.created_at >= p_from_date)
      AND (p_to_date IS NULL OR e.created_at <= p_to_date)
      AND (
        p_cursor_created_at IS NULL
        OR (e.created_at, e.id) < (p_cursor_created_at, p_cursor_id)
      )
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT v_limit
  ) sub;

  IF jsonb_array_length(v_rows) = v_limit THEN
    v_last_created_at := (v_rows->(v_limit - 1)->>'created_at')::TIMESTAMPTZ;
    v_last_id := (v_rows->(v_limit - 1)->>'id')::UUID;
    v_next_cursor := jsonb_build_object(
      'created_at', v_last_created_at,
      'id', v_last_id
    );
  ELSE
    v_next_cursor := NULL;
  END IF;

  RETURN jsonb_build_object(
    'events', v_rows,
    'next_cursor', v_next_cursor
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_copy_permissions (no Express fallback — must succeed under service_role)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_copy_permissions(
  p_from_user_id UUID,
  p_to_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_feature_count INTEGER := 0;
  v_scope_count INTEGER := 0;
  v_grant_count INTEGER := 0;
BEGIN
  PERFORM public._admin_require_backend_caller();

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
    auth.uid()
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
    auth.uid()
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
    auth.uid()
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
    )
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

CREATE OR REPLACE FUNCTION public.admin_set_feature_permission(
  p_user_id UUID,
  p_project_id UUID,
  p_feature_key TEXT,
  p_access_level TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before JSONB;
  v_after JSONB;
  v_row public.user_feature_permissions%ROWTYPE;
BEGIN
  PERFORM public._admin_require_backend_caller();

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
    auth.uid()
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
    v_after
  );

  RETURN v_after;
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
  PERFORM public._admin_require_backend_caller();

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

-- ---------------------------------------------------------------------------
-- admin_set_scraped_data_scope / admin_set_credential_grant
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_scraped_data_scope(
  p_user_id UUID,
  p_scope_type TEXT,
  p_scope_ref TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before JSONB;
  v_after JSONB;
  v_row public.user_scraped_data_scope%ROWTYPE;
BEGIN
  PERFORM public._admin_require_backend_caller();

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
    auth.uid()
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
    v_after
  );

  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_credential_grant(
  p_user_id UUID,
  p_credential_id UUID,
  p_grant_level TEXT,
  p_project_id UUID DEFAULT NULL,
  p_jurisdiction TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before JSONB;
  v_after JSONB;
  v_row public.user_portal_credential_grants%ROWTYPE;
BEGIN
  PERFORM public._admin_require_backend_caller();

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
    auth.uid()
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
    v_after
  );

  RETURN v_after;
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_activate_user / admin_deactivate_user
-- Hierarchy checks using auth.uid() apply only to direct JWT callers; Express validates for service_role.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_deactivate_user(
  p_user_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before JSONB;
  v_grants_revoked INTEGER;
BEGIN
  PERFORM public._admin_require_backend_caller();

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
      granted_by = auth.uid(),
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
    )
  );

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'access_status', 'deactivated',
    'credential_grants_revoked', v_grants_revoked
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_activate_user(
  p_user_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before JSONB;
BEGIN
  PERFORM public._admin_require_backend_caller();

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
    jsonb_build_object('access_status', 'active', 'reason', p_reason)
  );

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'access_status', 'active'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only on backend-invoked admin RPCs; REVOKE PUBLIC unchanged pattern
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.admin_get_effective_permissions(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_effective_permissions(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_list_audit_events(INTEGER, TIMESTAMPTZ, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_audit_events(INTEGER, TIMESTAMPTZ, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_copy_permissions(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_copy_permissions(UUID, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_set_feature_permission(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_feature_permission(UUID, UUID, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_delete_feature_permission(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_feature_permission(UUID, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_set_scraped_data_scope(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_scraped_data_scope(UUID, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_set_credential_grant(UUID, UUID, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_credential_grant(UUID, UUID, TEXT, UUID, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_get_effective_permissions(UUID) IS
  'Admin effective-permissions view; callable by platform admin JWT or service_role backend (Express verifies admin first).';

COMMENT ON FUNCTION public.admin_list_audit_events(INTEGER, TIMESTAMPTZ, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Paginated audit events; callable by platform admin JWT or service_role backend.';

COMMENT ON FUNCTION public.admin_copy_permissions(UUID, UUID) IS
  'Bulk permission copy; callable by platform admin JWT or service_role backend (no Express fallback).';
