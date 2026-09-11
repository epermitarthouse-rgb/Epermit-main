-- Super Admin hierarchy: super_admin > admin (platform admin) > user.
-- Bootstrap: promote daniyalzahid12@yahoo.com to super_admin via auth.users email lookup.
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Extend app_role enum
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'app_role'
      AND e.enumlabel = 'super_admin'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'super_admin';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Platform admin helpers (admin OR super_admin)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
      OR public.has_role(_user_id, 'super_admin'::public.app_role);
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'super_admin'::public.app_role);
$$;

CREATE OR REPLACE FUNCTION public._super_admin_count()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.user_roles ur
  JOIN public.profiles p ON p.user_id = ur.user_id
  WHERE ur.role = 'super_admin'::public.app_role
    AND p.access_status = 'active';
$$;

CREATE OR REPLACE FUNCTION public._admin_require_platform_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._admin_require_super_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Super admin required' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Permission resolvers: super_admin receives same effective access as admin
-- ---------------------------------------------------------------------------

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
BEGIN
  IF p_user_id IS NULL OR p_credential_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF public.is_platform_admin(p_user_id) THEN
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
    RETURN FALSE;
  END IF;

  RETURN public._grant_level_rank(v_grant_level) >= v_required_rank;
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
  v_global_level TEXT;
  v_project_level TEXT;
  v_project_role TEXT;
BEGIN
  IF NOT public.is_user_active(p_user_id) THEN
    RETURN 'none';
  END IF;

  IF public.is_platform_admin(p_user_id) THEN
    RETURN 'write';
  END IF;

  SELECT fp.access_level
  INTO v_global_level
  FROM public.user_feature_permissions fp
  WHERE fp.user_id = p_user_id
    AND fp.project_id IS NULL
    AND fp.feature_key = p_feature_key;

  IF v_global_level = 'none' THEN
    RETURN 'none';
  END IF;

  IF p_project_id IS NULL THEN
    IF v_global_level IN ('read', 'write') THEN
      RETURN v_global_level;
    END IF;
    RETURN 'write';
  END IF;

  IF public._resolve_project_access_level(p_user_id, p_project_id) = 'none' THEN
    RETURN 'none';
  END IF;

  SELECT fp.access_level
  INTO v_project_level
  FROM public.user_feature_permissions fp
  WHERE fp.user_id = p_user_id
    AND fp.project_id = p_project_id
    AND fp.feature_key = p_feature_key;

  IF v_project_level IN ('none', 'read', 'write') THEN
    RETURN v_project_level;
  END IF;

  RETURN COALESCE(v_global_level, 'write');
END;
$$;

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

  IF NOT public.is_user_active(p_user_id) THEN
    RETURN 'none';
  END IF;

  IF public.is_platform_admin(p_user_id) THEN
    RETURN 'write';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.projects pr
    WHERE pr.id = p_project_id AND pr.user_id = p_user_id
  ) THEN
    RETURN 'owner';
  END IF;

  SELECT o.access_level
  INTO v_override
  FROM public.user_project_access_overrides o
  WHERE o.user_id = p_user_id
    AND o.project_id = p_project_id;

  IF v_override IN ('none', 'read', 'write') THEN
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

-- ---------------------------------------------------------------------------
-- 4. user_roles RLS: super admins may manage roles
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles"
ON public.user_roles
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
CREATE POLICY "Admins can insert roles"
ON public.user_roles
FOR INSERT
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;
CREATE POLICY "Admins can delete roles"
ON public.user_roles
FOR DELETE
USING (public.is_platform_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Governance table RLS (super_admin included)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Platform admins can read governance config" ON public.governance_config;
CREATE POLICY "Platform admins can read governance config"
ON public.governance_config
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Platform admins can read audit events" ON public.platform_audit_events;
CREATE POLICY "Platform admins can read audit events"
ON public.platform_audit_events
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Platform admins can read feature permissions" ON public.user_feature_permissions;
CREATE POLICY "Platform admins can read feature permissions"
ON public.user_feature_permissions
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Platform admins can read scraped data scope" ON public.user_scraped_data_scope;
CREATE POLICY "Platform admins can read scraped data scope"
ON public.user_scraped_data_scope
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Platform admins can read credential grants" ON public.user_portal_credential_grants;
CREATE POLICY "Platform admins can read credential grants"
ON public.user_portal_credential_grants
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Platform admins can read access reviews" ON public.user_access_reviews;
CREATE POLICY "Platform admins can read access reviews"
ON public.user_access_reviews
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 6. admin_deactivate_user: hierarchy-aware (backend also enforces)
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
  PERFORM public._admin_require_platform_admin();

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot deactivate your own account' USING ERRCODE = '42501';
  END IF;

  IF public.is_super_admin(p_user_id)
     AND public._super_admin_count() <= 1 THEN
    RAISE EXCEPTION 'Cannot deactivate the last super admin' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_super_admin(auth.uid())
     AND (public.has_role(p_user_id, 'admin'::public.app_role)
          OR public.has_role(p_user_id, 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Platform admin cannot deactivate another admin' USING ERRCODE = '42501';
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
  PERFORM public._admin_require_platform_admin();

  IF NOT public.is_super_admin(auth.uid())
     AND (public.has_role(p_user_id, 'admin'::public.app_role)
          OR public.has_role(p_user_id, 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Platform admin cannot activate another admin' USING ERRCODE = '42501';
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
-- 7. Bootstrap super admin (email lookup only — not used at runtime)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT u.id
  INTO v_user_id
  FROM auth.users u
  WHERE lower(u.email) = lower('daniyalzahid12@yahoo.com')
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_user_id, 'super_admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public._super_admin_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._admin_require_super_admin() FROM PUBLIC;

COMMENT ON FUNCTION public.is_platform_admin(UUID) IS
  'True when user has platform admin (admin) or super_admin role.';

COMMENT ON FUNCTION public.is_super_admin(UUID) IS
  'True when user has super_admin role.';

-- Effective permissions payload: platform_admin includes super_admin
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
  PERFORM public._admin_require_platform_admin();

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
-- 8. RLS + function compatibility: has_role(..., 'admin') -> is_platform_admin()
-- ---------------------------------------------------------------------------

-- user_project_access_overrides (20260911170000)
DROP POLICY IF EXISTS "Platform admins read project access overrides"
  ON public.user_project_access_overrides;
CREATE POLICY "Platform admins read project access overrides"
  ON public.user_project_access_overrides
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- tenants (20260715140000)
DROP POLICY IF EXISTS "Platform admins can view all tenants" ON public.tenants;
CREATE POLICY "Platform admins can view all tenants"
ON public.tenants
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

-- utility_providers global templates (20260715140300)
DROP POLICY IF EXISTS "Platform admins can manage global templates"
  ON public.utility_providers;
CREATE POLICY "Platform admins can manage global templates"
ON public.utility_providers
FOR ALL
TO authenticated
USING (public.is_platform_admin(auth.uid()))
WITH CHECK (public.is_platform_admin(auth.uid()));

-- utility_provider_aliases global (20260716160000)
DROP POLICY IF EXISTS "Platform admins can manage global provider aliases"
  ON public.utility_provider_aliases;
CREATE POLICY "Platform admins can manage global provider aliases"
ON public.utility_provider_aliases
FOR ALL
TO authenticated
USING (public.is_platform_admin(auth.uid()))
WITH CHECK (public.is_platform_admin(auth.uid()));

-- architecture_replication_items / comments (20260725040000)
DROP POLICY IF EXISTS "Platform admins can manage architecture replication items"
  ON public.architecture_replication_items;
CREATE POLICY "Platform admins can manage architecture replication items"
ON public.architecture_replication_items
FOR ALL
TO authenticated
USING (public.is_platform_admin(auth.uid()))
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Platform admins can manage architecture replication comments"
  ON public.architecture_replication_comments;
CREATE POLICY "Platform admins can manage architecture replication comments"
ON public.architecture_replication_comments
FOR ALL
TO authenticated
USING (public.is_platform_admin(auth.uid()))
WITH CHECK (public.is_platform_admin(auth.uid()));

-- jurisdictions inactive read + CRUD (20260113063837)
DROP POLICY IF EXISTS "Anyone can view active jurisdictions" ON public.jurisdictions;
CREATE POLICY "Anyone can view active jurisdictions"
ON public.jurisdictions
FOR SELECT
USING (is_active = true OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can insert jurisdictions" ON public.jurisdictions;
CREATE POLICY "Admins can insert jurisdictions"
ON public.jurisdictions
FOR INSERT
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update jurisdictions" ON public.jurisdictions;
CREATE POLICY "Admins can update jurisdictions"
ON public.jurisdictions
FOR UPDATE
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can delete jurisdictions" ON public.jurisdictions;
CREATE POLICY "Admins can delete jurisdictions"
ON public.jurisdictions
FOR DELETE
USING (public.is_platform_admin(auth.uid()));

-- email_branding_settings (20260112193942)
DROP POLICY IF EXISTS "Admins can view branding settings" ON public.email_branding_settings;
CREATE POLICY "Admins can view branding settings"
ON public.email_branding_settings
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can insert branding settings" ON public.email_branding_settings;
CREATE POLICY "Admins can insert branding settings"
ON public.email_branding_settings
FOR INSERT
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update branding settings" ON public.email_branding_settings;
CREATE POLICY "Admins can update branding settings"
ON public.email_branding_settings
FOR UPDATE
USING (public.is_platform_admin(auth.uid()));

-- scheduled_notifications (20260113041221)
DROP POLICY IF EXISTS "Admins can view scheduled notifications" ON public.scheduled_notifications;
CREATE POLICY "Admins can view scheduled notifications"
ON public.scheduled_notifications
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can insert scheduled notifications" ON public.scheduled_notifications;
CREATE POLICY "Admins can insert scheduled notifications"
ON public.scheduled_notifications
FOR INSERT
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update scheduled notifications" ON public.scheduled_notifications;
CREATE POLICY "Admins can update scheduled notifications"
ON public.scheduled_notifications
FOR UPDATE
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can delete scheduled notifications" ON public.scheduled_notifications;
CREATE POLICY "Admins can delete scheduled notifications"
ON public.scheduled_notifications
FOR DELETE
USING (public.is_platform_admin(auth.uid()));

-- coverage_requests (20260116074932)
DROP POLICY IF EXISTS "Admins can view coverage requests" ON public.coverage_requests;
CREATE POLICY "Admins can view coverage requests"
ON public.coverage_requests
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update coverage requests" ON public.coverage_requests;
CREATE POLICY "Admins can update coverage requests"
ON public.coverage_requests
FOR UPDATE
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can delete coverage requests" ON public.coverage_requests;
CREATE POLICY "Admins can delete coverage requests"
ON public.coverage_requests
FOR DELETE
USING (public.is_platform_admin(auth.uid()));

-- admin_activity_log (20260113040713)
DROP POLICY IF EXISTS "Admins can view activity logs" ON public.admin_activity_log;
CREATE POLICY "Admins can view activity logs"
ON public.admin_activity_log
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can insert activity logs" ON public.admin_activity_log;
CREATE POLICY "Admins can insert activity logs"
ON public.admin_activity_log
FOR INSERT
WITH CHECK (public.is_platform_admin(auth.uid()));

-- jurisdiction_notifications INSERT (20260112170034)
DROP POLICY IF EXISTS "Admins can insert notifications" ON public.jurisdiction_notifications;
CREATE POLICY "Admins can insert notifications"
ON public.jurisdiction_notifications
FOR INSERT
WITH CHECK (public.is_platform_admin(auth.uid()));

-- admin_list_member_directory (20260806010000)
CREATE OR REPLACE FUNCTION public.admin_list_member_directory()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(row_data ORDER BY sort_name, user_id)
      FROM (
        SELECT
          p.user_id,
          lower(coalesce(p.full_name, p.company_name, p.user_id::text)) AS sort_name,
          jsonb_build_object(
            'user_id', p.user_id,
            'full_name', p.full_name,
            'company_name', p.company_name,
            'job_title', p.job_title,
            'created_at', p.created_at,
            'platform_roles', COALESCE(
              (
                SELECT jsonb_agg(ur.role::text ORDER BY ur.role::text)
                FROM public.user_roles ur
                WHERE ur.user_id = p.user_id
              ),
              '[]'::jsonb
            ),
            'owned_projects', COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'project_id', pr.id,
                    'project_name', pr.name,
                    'role', 'owner'
                  )
                  ORDER BY pr.name
                )
                FROM public.projects pr
                WHERE pr.user_id = p.user_id
              ),
              '[]'::jsonb
            ),
            'team_memberships', COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'project_id', ptm.project_id,
                    'project_name', pr.name,
                    'role', ptm.role::text
                  )
                  ORDER BY pr.name
                )
                FROM public.project_team_members ptm
                JOIN public.projects pr ON pr.id = ptm.project_id
                WHERE ptm.user_id = p.user_id
              ),
              '[]'::jsonb
            )
          ) AS row_data
        FROM public.profiles p
      ) sub
    ),
    '[]'::jsonb
  );
END;
$$;

-- can_access_tenant (20260715140000)
CREATE OR REPLACE FUNCTION public.can_access_tenant(_user_id UUID, _tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_tenant_access(_user_id, _tenant_id)
    AND (
      public.is_platform_admin(_user_id)
      OR (
        public.is_demo_tenant(_tenant_id) = public.is_user_demo_only(_user_id)
      )
    )
$$;

-- _default_credential_grant_level (20260911170000)
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

  IF public.is_platform_admin(p_user_id) THEN
    RETURN 'manage';
  END IF;

  IF NOT public.is_user_active(p_user_id) THEN
    RETURN 'none';
  END IF;

  RETURN 'use';
END;
$$;

-- _global_feature_access_level (20260911150000)
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

  IF public.is_platform_admin(p_user_id) THEN
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

-- assert_scraped_data_access (20260910120000)
CREATE OR REPLACE FUNCTION public.assert_scraped_data_access(
  p_user_id UUID,
  p_project_id UUID,
  p_jurisdiction TEXT DEFAULT NULL,
  p_portal_source TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
  v_ok BOOLEAN;
BEGIN
  v_mode := public._governance_enforce_mode();

  IF v_mode = 'legacy' THEN
    RETURN TRUE;
  END IF;

  IF public.is_platform_admin(p_user_id) THEN
    RETURN TRUE;
  END IF;

  IF NOT public.is_user_active(p_user_id) THEN
    v_ok := FALSE;
  ELSIF NOT public.has_project_access(p_user_id, p_project_id) THEN
    v_ok := FALSE;
  ELSIF public._feature_level_rank(
    public._resolve_feature_access_level(p_user_id, p_project_id, 'scraper.results')
  ) < public._feature_level_rank('read') THEN
    v_ok := FALSE;
  ELSE
    v_ok := public._user_has_scraped_data_scope(
      p_user_id, p_project_id, p_jurisdiction, p_portal_source
    );
  END IF;

  IF v_ok THEN
    RETURN TRUE;
  END IF;

  IF v_mode = 'shadow' THEN
    RAISE NOTICE 'assert_scraped_data_access shadow WOULD-BLOCK user=% project=% jurisdiction=% source=%',
      p_user_id, p_project_id, p_jurisdiction, p_portal_source;
    RETURN TRUE;
  END IF;

  RAISE EXCEPTION 'Scraped data access denied'
    USING ERRCODE = '42501',
      DETAIL = format(
        'user=%s project=%s jurisdiction=%s source=%s',
        p_user_id, p_project_id, p_jurisdiction, p_portal_source
      );
END;
$$;
