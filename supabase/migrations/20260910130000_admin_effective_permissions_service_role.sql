-- Allow Railway service-role backend to call admin effective-permissions RPC.
-- Authenticated platform admins retain existing access via _admin_require_platform_admin.

CREATE OR REPLACE FUNCTION public._admin_require_backend_caller()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') = 'service_role' THEN
    RETURN;
  END IF;

  PERFORM public._admin_require_platform_admin();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_effective_permissions(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_require_backend_caller();

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = p_user_id) THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'access_status', (
      SELECT p.access_status FROM public.profiles p WHERE p.user_id = p_user_id
    ),
    'platform_admin', public.has_role(p_user_id, 'admin'::public.app_role),
    'platform_roles', COALESCE(
      (
        SELECT jsonb_agg(ur.role::TEXT ORDER BY ur.role::TEXT)
        FROM public.user_roles ur
        WHERE ur.user_id = p_user_id
      ),
      '[]'::jsonb
    ),
    'feature_permissions', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', ufp.id,
            'project_id', ufp.project_id,
            'feature_key', ufp.feature_key,
            'access_level', ufp.access_level,
            'granted_by', ufp.granted_by,
            'updated_at', ufp.updated_at
          )
          ORDER BY ufp.feature_key, ufp.project_id NULLS FIRST
        )
        FROM public.user_feature_permissions ufp
        WHERE ufp.user_id = p_user_id
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
          ORDER BY s.scope_type, s.scope_ref
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
          ORDER BY g.credential_id
        )
        FROM public.user_portal_credential_grants g
        WHERE g.user_id = p_user_id
      ),
      '[]'::jsonb
    ),
    'access_review', (
      SELECT jsonb_build_object(
        'reviewed_by', r.reviewed_by,
        'reviewed_at', r.reviewed_at
      )
      FROM public.user_access_reviews r
      WHERE r.user_id = p_user_id
    ),
    'projects', COALESCE(
      (
        SELECT jsonb_agg(proj ORDER BY proj ->> 'project_name', proj ->> 'project_id')
        FROM (
          SELECT jsonb_build_object(
            'project_id', pr.id,
            'project_name', pr.name,
            'project_role', 'owner'
          ) AS proj
          FROM public.projects pr
          WHERE pr.user_id = p_user_id
          UNION ALL
          SELECT jsonb_build_object(
            'project_id', ptm.project_id,
            'project_name', pr.name,
            'project_role', ptm.role::TEXT
          ) AS proj
          FROM public.project_team_members ptm
          JOIN public.projects pr ON pr.id = ptm.project_id
          WHERE ptm.user_id = p_user_id
            AND NOT EXISTS (
              SELECT 1
              FROM public.projects owned
              WHERE owned.id = ptm.project_id
                AND owned.user_id = p_user_id
            )
        ) project_rows
      ),
      '[]'::jsonb
    ),
    'risks', CASE
      WHEN public.has_role(p_user_id, 'admin'::public.app_role)
           AND public._platform_admin_count() <= 1 THEN
        jsonb_build_array('sole_platform_admin')
      ELSE '[]'::jsonb
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public._admin_require_backend_caller() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_effective_permissions(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_effective_permissions(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public._admin_require_backend_caller() IS
  'Admin backend gate: service_role (Railway) or authenticated platform admin.';

COMMENT ON FUNCTION public.admin_get_effective_permissions(UUID) IS
  'Admin effective-permissions view for directory detail; callable by platform admin JWT or service_role backend.';
