-- Admin governance v2.1 foundation (schema, RPCs, grant-only credential RLS).
-- Docs: docs/admin-dashboard/ADMIN_DATA_AND_API_CONTRACTS.md (v2.1)
-- Admin auth pattern: 20260806010000_admin_members_directory.sql (has_role admin)

-- ---------------------------------------------------------------------------
-- 1. profiles.access_status
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_access_status_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_access_status_check
  CHECK (access_status IN ('active', 'deactivated'));

CREATE INDEX IF NOT EXISTS idx_profiles_access_status
  ON public.profiles (access_status);

-- ---------------------------------------------------------------------------
-- 2. governance_config (singleton enforce_mode)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.governance_config (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  enforce_mode TEXT NOT NULL DEFAULT 'legacy'
    CHECK (enforce_mode IN ('legacy', 'shadow', 'enforce')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.governance_config (id, enforce_mode)
VALUES (TRUE, 'legacy')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.governance_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can read governance config" ON public.governance_config;
CREATE POLICY "Platform admins can read governance config"
ON public.governance_config
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------------------------------------------------------------------------
-- 3. platform_audit_events
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_audit_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  correlation_id TEXT,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  feature_key TEXT,
  before_json JSONB,
  after_json JSONB,
  result TEXT NOT NULL DEFAULT 'success'
    CHECK (result IN ('success', 'failure')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_events_created_at
  ON public.platform_audit_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_audit_events_actor_id
  ON public.platform_audit_events (actor_id);

CREATE INDEX IF NOT EXISTS idx_platform_audit_events_action
  ON public.platform_audit_events (action);

ALTER TABLE public.platform_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can read audit events" ON public.platform_audit_events;
CREATE POLICY "Platform admins can read audit events"
ON public.platform_audit_events
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Inserts only via SECURITY DEFINER admin_append_audit_event (no INSERT policy).

-- ---------------------------------------------------------------------------
-- 4. user_feature_permissions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_feature_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'none'
    CHECK (access_level IN ('none', 'read', 'write')),
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_user_feature_permissions_user_project
  ON public.user_feature_permissions (user_id, project_id);

DROP TRIGGER IF EXISTS user_feature_permissions_updated_at ON public.user_feature_permissions;
CREATE TRIGGER user_feature_permissions_updated_at
BEFORE UPDATE ON public.user_feature_permissions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.user_feature_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can read feature permissions" ON public.user_feature_permissions;
CREATE POLICY "Platform admins can read feature permissions"
ON public.user_feature_permissions
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Users can read own feature permissions" ON public.user_feature_permissions;
CREATE POLICY "Users can read own feature permissions"
ON public.user_feature_permissions
FOR SELECT
USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 5. user_scraped_data_scope
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_scraped_data_scope (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL
    CHECK (scope_type IN ('project', 'jurisdiction', 'portal_source')),
  scope_ref TEXT NOT NULL,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope_type, scope_ref)
);

CREATE INDEX IF NOT EXISTS idx_user_scraped_data_scope_user_type
  ON public.user_scraped_data_scope (user_id, scope_type);

ALTER TABLE public.user_scraped_data_scope ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can read scraped data scope" ON public.user_scraped_data_scope;
CREATE POLICY "Platform admins can read scraped data scope"
ON public.user_scraped_data_scope
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Users can read own scraped data scope" ON public.user_scraped_data_scope;
CREATE POLICY "Users can read own scraped data scope"
ON public.user_scraped_data_scope
FOR SELECT
USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 6. user_portal_credential_grants
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_portal_credential_grants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id UUID NOT NULL REFERENCES public.portal_credentials(id) ON DELETE CASCADE,
  grant_level TEXT NOT NULL DEFAULT 'none'
    CHECK (grant_level IN ('none', 'use', 'manage')),
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  jurisdiction TEXT,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, credential_id)
);

CREATE INDEX IF NOT EXISTS idx_user_portal_credential_grants_credential_id
  ON public.user_portal_credential_grants (credential_id);

CREATE INDEX IF NOT EXISTS idx_user_portal_credential_grants_user_id
  ON public.user_portal_credential_grants (user_id);

DROP TRIGGER IF EXISTS user_portal_credential_grants_updated_at ON public.user_portal_credential_grants;
CREATE TRIGGER user_portal_credential_grants_updated_at
BEFORE UPDATE ON public.user_portal_credential_grants
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.user_portal_credential_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can read credential grants" ON public.user_portal_credential_grants;
CREATE POLICY "Platform admins can read credential grants"
ON public.user_portal_credential_grants
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Users can read own credential grants" ON public.user_portal_credential_grants;
CREATE POLICY "Users can read own credential grants"
ON public.user_portal_credential_grants
FOR SELECT
USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 7. user_access_reviews
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_access_reviews (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_access_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can read access reviews" ON public.user_access_reviews;
CREATE POLICY "Platform admins can read access reviews"
ON public.user_access_reviews
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------------------------------------------------------------------------
-- 8. Core helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._admin_require_platform_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._platform_admin_count()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.user_roles ur
  WHERE ur.role = 'admin'::public.app_role;
$$;

CREATE OR REPLACE FUNCTION public._governance_enforce_mode()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gc.enforce_mode
  FROM public.governance_config gc
  WHERE gc.id = TRUE;
$$;

CREATE OR REPLACE FUNCTION public.is_user_active(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT p.access_status = 'active'
      FROM public.profiles p
      WHERE p.user_id = p_user_id
    ),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public._feature_level_rank(p_level TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_level
    WHEN 'write' THEN 2
    WHEN 'read' THEN 1
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public._grant_level_rank(p_level TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_level
    WHEN 'manage' THEN 2
    WHEN 'use' THEN 1
    ELSE 0
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
  v_explicit TEXT;
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

  IF NOT public.has_project_access(p_user_id, p_project_id) THEN
    RETURN 'none';
  END IF;

  SELECT ufp.access_level
  INTO v_explicit
  FROM public.user_feature_permissions ufp
  WHERE ufp.user_id = p_user_id
    AND ufp.project_id = p_project_id
    AND ufp.feature_key = p_feature_key;

  IF v_explicit IS NOT NULL THEN
    RETURN v_explicit;
  END IF;

  IF public.has_project_admin_access(p_user_id, p_project_id) THEN
    RETURN 'write';
  END IF;

  IF public.has_project_editor_access(p_user_id, p_project_id) THEN
    RETURN 'write';
  END IF;

  RETURN 'read';
END;
$$;

CREATE OR REPLACE FUNCTION public._user_has_scraped_data_scope(
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
  v_scope_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_scope_count
  FROM public.user_scraped_data_scope s
  WHERE s.user_id = p_user_id;

  IF v_scope_count = 0 THEN
    RETURN TRUE;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_scraped_data_scope s
    WHERE s.user_id = p_user_id
      AND s.scope_type = 'project'
      AND s.scope_ref = p_project_id::TEXT
  ) THEN
    RETURN TRUE;
  END IF;

  IF p_jurisdiction IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.user_scraped_data_scope s
    WHERE s.user_id = p_user_id
      AND s.scope_type = 'jurisdiction'
      AND s.scope_ref = p_jurisdiction
  ) THEN
    RETURN TRUE;
  END IF;

  IF p_portal_source IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.user_scraped_data_scope s
    WHERE s.user_id = p_user_id
      AND s.scope_type = 'portal_source'
      AND s.scope_ref = p_portal_source
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. assert_* enforcement (respect governance_config.enforce_mode)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_feature_access(
  p_user_id UUID,
  p_project_id UUID,
  p_feature_key TEXT,
  p_required_level TEXT DEFAULT 'read'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
  v_actual TEXT;
  v_ok BOOLEAN;
BEGIN
  v_mode := public._governance_enforce_mode();

  IF v_mode = 'legacy' THEN
    RETURN TRUE;
  END IF;

  v_actual := public._resolve_feature_access_level(p_user_id, p_project_id, p_feature_key);
  v_ok := public._feature_level_rank(v_actual) >= public._feature_level_rank(p_required_level);

  IF v_ok THEN
    RETURN TRUE;
  END IF;

  IF v_mode = 'shadow' THEN
    RAISE NOTICE 'assert_feature_access shadow WOULD-BLOCK user=% project=% feature=% required=% actual=%',
      p_user_id, p_project_id, p_feature_key, p_required_level, v_actual;
    RETURN TRUE;
  END IF;

  RAISE EXCEPTION 'Feature access denied'
    USING ERRCODE = '42501',
      DETAIL = format(
        'user=%s project=%s feature=%s required=%s actual=%s',
        p_user_id, p_project_id, p_feature_key, p_required_level, v_actual
      );
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_credential_grant(
  p_user_id UUID,
  p_credential_id UUID,
  p_required_level TEXT DEFAULT 'use'
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

  v_ok := public.credential_has_grant(p_user_id, p_credential_id, p_required_level);

  IF v_ok THEN
    RETURN TRUE;
  END IF;

  IF v_mode = 'shadow' THEN
    RAISE NOTICE 'assert_credential_grant shadow WOULD-BLOCK user=% credential=% required=%',
      p_user_id, p_credential_id, p_required_level;
    RETURN TRUE;
  END IF;

  RAISE EXCEPTION 'Credential grant denied'
    USING ERRCODE = '42501',
      DETAIL = format(
        'user=%s credential=%s required=%s',
        p_user_id, p_credential_id, p_required_level
      );
END;
$$;

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

  IF public.has_role(p_user_id, 'admin'::public.app_role) THEN
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

-- ---------------------------------------------------------------------------
-- 10. admin_append_audit_event
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_append_audit_event(
  p_action TEXT,
  p_target_type TEXT DEFAULT NULL,
  p_target_id TEXT DEFAULT NULL,
  p_project_id UUID DEFAULT NULL,
  p_feature_key TEXT DEFAULT NULL,
  p_before_json JSONB DEFAULT NULL,
  p_after_json JSONB DEFAULT NULL,
  p_result TEXT DEFAULT 'success',
  p_correlation_id TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_event_id UUID;
BEGIN
  v_actor := COALESCE(p_actor_id, auth.uid());

  INSERT INTO public.platform_audit_events (
    correlation_id,
    actor_id,
    action,
    target_type,
    target_id,
    project_id,
    feature_key,
    before_json,
    after_json,
    result
  )
  VALUES (
    p_correlation_id,
    v_actor,
    p_action,
    p_target_type,
    p_target_id,
    p_project_id,
    p_feature_key,
    p_before_json,
    p_after_json,
    COALESCE(p_result, 'success')
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. Admin RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_overview_metrics()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_require_platform_admin();

  RETURN jsonb_build_object(
    'total_users', (SELECT COUNT(*) FROM public.profiles),
    'active_users', (
      SELECT COUNT(*) FROM public.profiles p WHERE p.access_status = 'active'
    ),
    'deactivated_users', (
      SELECT COUNT(*) FROM public.profiles p WHERE p.access_status = 'deactivated'
    ),
    'platform_admins', public._platform_admin_count(),
    'audit_events_24h', (
      SELECT COUNT(*)
      FROM public.platform_audit_events e
      WHERE e.created_at >= now() - INTERVAL '24 hours'
    ),
    'governance_enforce_mode', public._governance_enforce_mode(),
    'pending_invitations_30d', (
      SELECT COUNT(*)
      FROM public.project_invitations pi
      WHERE pi.status = 'pending'
        AND pi.created_at < now() - INTERVAL '30 days'
    )
  );
END;
$$;

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
  PERFORM public._admin_require_platform_admin();

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

CREATE OR REPLACE FUNCTION public.admin_get_effective_permissions(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_require_platform_admin();

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
    '_note', 'Stub effective-permission resolution; full role-default merge may live in application layer.'
  );
END;
$$;

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
  PERFORM public._admin_require_platform_admin();

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
  PERFORM public._admin_require_platform_admin();

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
  PERFORM public._admin_require_platform_admin();

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

  IF p_user_id = auth.uid() AND public._platform_admin_count() <= 1 THEN
    RAISE EXCEPTION 'Cannot deactivate the last platform admin' USING ERRCODE = '42501';
  END IF;

  IF public.has_role(p_user_id, 'admin'::public.app_role)
     AND public._platform_admin_count() <= 1 THEN
    RAISE EXCEPTION 'Cannot deactivate the last platform admin' USING ERRCODE = '42501';
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
    'user.deactivated',
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
    'user.activated',
    'user',
    p_user_id::TEXT,
    NULL,
    NULL,
    v_before,
    jsonb_build_object(
      'access_status', 'active',
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'access_status', 'active'
  );
END;
$$;

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
  PERFORM public._admin_require_platform_admin();

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
-- 12. Backfill credential grants for existing portal_credentials creators
-- ---------------------------------------------------------------------------

INSERT INTO public.user_portal_credential_grants (
  user_id,
  credential_id,
  grant_level,
  project_id,
  jurisdiction,
  granted_by
)
SELECT
  pc.user_id,
  pc.id,
  'manage',
  pc.project_id,
  pc.jurisdiction,
  pc.user_id
FROM public.portal_credentials pc
WHERE NOT EXISTS (
  SELECT 1
  FROM public.user_portal_credential_grants g
  WHERE g.user_id = pc.user_id
    AND g.credential_id = pc.id
);

-- ---------------------------------------------------------------------------
-- 13. portal_credentials RLS — grant-only (not owner)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view own portal credentials" ON public.portal_credentials;
DROP POLICY IF EXISTS "Users can insert own portal credentials" ON public.portal_credentials;
DROP POLICY IF EXISTS "Users can update own portal credentials" ON public.portal_credentials;
DROP POLICY IF EXISTS "Users can delete own portal credentials" ON public.portal_credentials;

CREATE POLICY "Grant holders can view portal credentials"
ON public.portal_credentials
FOR SELECT
USING (public.credential_has_grant(auth.uid(), id, 'use'));

CREATE POLICY "Creators can insert portal credentials"
ON public.portal_credentials
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Grant managers can update portal credentials"
ON public.portal_credentials
FOR UPDATE
USING (public.credential_has_grant(auth.uid(), id, 'manage'))
WITH CHECK (public.credential_has_grant(auth.uid(), id, 'manage'));

CREATE POLICY "Grant managers can delete portal credentials"
ON public.portal_credentials
FOR DELETE
USING (public.credential_has_grant(auth.uid(), id, 'manage'));

-- ---------------------------------------------------------------------------
-- 14. Function grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public._admin_require_platform_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._platform_admin_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._governance_enforce_mode() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._feature_level_rank(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._grant_level_rank(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._resolve_feature_access_level(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._user_has_scraped_data_scope(UUID, UUID, TEXT, TEXT) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.is_user_active(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_user_active(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.credential_has_grant(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credential_has_grant(UUID, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.assert_feature_access(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_feature_access(UUID, UUID, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.assert_credential_grant(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_credential_grant(UUID, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.assert_scraped_data_access(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_scraped_data_access(UUID, UUID, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_append_audit_event(TEXT, TEXT, TEXT, UUID, TEXT, JSONB, JSONB, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_append_audit_event(TEXT, TEXT, TEXT, UUID, TEXT, JSONB, JSONB, TEXT, TEXT, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_overview_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_overview_metrics() TO authenticated;

REVOKE ALL ON FUNCTION public.admin_list_audit_events(INTEGER, TIMESTAMPTZ, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_audit_events(INTEGER, TIMESTAMPTZ, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_get_effective_permissions(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_effective_permissions(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_feature_permission(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_feature_permission(UUID, UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_scraped_data_scope(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_scraped_data_scope(UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_credential_grant(UUID, UUID, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_credential_grant(UUID, UUID, TEXT, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_deactivate_user(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_deactivate_user(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_activate_user(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_activate_user(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_copy_permissions(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_copy_permissions(UUID, UUID) TO authenticated;

COMMENT ON TABLE public.governance_config IS
  'Singleton governance rollout config; enforce_mode legacy|shadow|enforce (default legacy).';

COMMENT ON TABLE public.platform_audit_events IS
  'Platform admin governance audit trail; inserts via admin_append_audit_event only.';

COMMENT ON FUNCTION public.admin_get_effective_permissions(UUID) IS
  'Admin v2.1 stub effective-permissions view; full role-default merge may live in JS.';
