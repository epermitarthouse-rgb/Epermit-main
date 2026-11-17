-- D-120: every active user can read the permits of sources marked "visible to all users by default"; an admin can
-- hide a source from a specific user. Uses the existing grant model (permit_access_grants) instead of a parallel
-- table: a grant row gets an effect ('allow' as before, or 'deny' = hidden), and permit_sync_sources gets the
-- per-source default switch. Read access never implies refresh: refresh still needs a platform admin or a
-- 'manage' credential grant (_permit_sync_can_manage is unchanged).
--
-- Read rule (user_can_read_permit): platform admin -> yes; inactive user -> no; an unrevoked 'deny' grant that
-- covers the permit (user, or a tenant the user belongs to) -> no; a linked source with visible_to_all -> yes;
-- then the unchanged paths (a 'use' credential grant on a linked source, unrevoked 'allow' grants).
-- Hidden wins over every other path except platform admin. Storage objects, child tables, project links, the
-- project linking RPCs and the comment pipeline all call this function, so they follow without changes.
--
-- Also replaces get_permit_sync_overview / get_permit_sync_job_progress (bodies as 20261113100000, with the
-- 'use'-grant source check swapped for _permit_source_readable) so the Permit Queue shows the source's sync
-- state to the same people who can read its permits. visible_to_all is switched on for existing
-- dc-projectdox sources once, when the column is added. Re-runnable (the backfill does not run twice).
-- Rollback: scripts/permit-repo/rollback-20261117130000_permit_default_access.sql.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'permit_sync_sources' AND column_name = 'visible_to_all'
  ) THEN
    ALTER TABLE public.permit_sync_sources ADD COLUMN visible_to_all BOOLEAN NOT NULL DEFAULT false;
    UPDATE public.permit_sync_sources SET visible_to_all = true WHERE adapter_key = 'dc-projectdox';
  END IF;
END;
$$;

ALTER TABLE public.permit_access_grants
  ADD COLUMN IF NOT EXISTS effect TEXT NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow', 'deny'));

-- ---------------------------------------------------------------------------
-- 2. Read rule
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.user_can_read_permit(p_user_id UUID, p_permit_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_adapter TEXT;
BEGIN
  IF p_user_id IS NULL OR p_permit_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF public.is_platform_admin(p_user_id) THEN
    RETURN TRUE;
  END IF;

  IF NOT public.is_user_active(p_user_id) THEN
    RETURN FALSE;
  END IF;

  SELECT p.adapter_key INTO v_adapter FROM public.permits p WHERE p.id = p_permit_id;
  IF v_adapter IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Hidden by an admin: wins over the default and over every grant.
  IF EXISTS (
    SELECT 1 FROM public.permit_access_grants g
    WHERE g.revoked_at IS NULL
      AND g.effect = 'deny'
      AND (g.grantee_user_id = p_user_id
           OR (g.grantee_tenant_id IS NOT NULL AND public.has_tenant_access(p_user_id, g.grantee_tenant_id)))
      AND (
        (g.scope_type = 'permit' AND g.permit_id = p_permit_id)
        OR (g.scope_type = 'adapter' AND g.adapter_key = v_adapter)
        OR (g.scope_type = 'source_credential' AND EXISTS (
              SELECT 1 FROM public.permit_source_links l
              WHERE l.permit_id = p_permit_id AND l.credential_id = g.credential_id))
      )
  ) THEN
    RETURN FALSE;
  END IF;

  -- Default: every active user reads the permits of a source marked visible to all.
  IF EXISTS (
    SELECT 1 FROM public.permit_source_links l
    JOIN public.permit_sync_sources s ON s.credential_id = l.credential_id
    WHERE l.permit_id = p_permit_id AND s.visible_to_all
  ) THEN
    RETURN TRUE;
  END IF;

  -- Provenance: a 'use' grant on a credential that sees this permit.
  IF EXISTS (
    SELECT 1 FROM public.permit_source_links l
    WHERE l.permit_id = p_permit_id
      AND public.credential_has_grant(p_user_id, l.credential_id, 'use')
  ) THEN
    RETURN TRUE;
  END IF;

  -- Explicit, unrevoked grants to the user or to a tenant the user belongs to.
  RETURN EXISTS (
    SELECT 1 FROM public.permit_access_grants g
    WHERE g.revoked_at IS NULL
      AND g.effect = 'allow'
      AND (g.grantee_user_id = p_user_id
           OR (g.grantee_tenant_id IS NOT NULL AND public.has_tenant_access(p_user_id, g.grantee_tenant_id)))
      AND (
        (g.scope_type = 'permit' AND g.permit_id = p_permit_id)
        OR (g.scope_type = 'adapter' AND g.adapter_key = v_adapter)
        OR (g.scope_type = 'source_credential' AND EXISTS (
              SELECT 1 FROM public.permit_source_links l
              WHERE l.permit_id = p_permit_id AND l.credential_id = g.credential_id))
      )
  );
END;
$$;

-- Source-level read rule for the sync overview and job progress: same order as user_can_read_permit.
CREATE OR REPLACE FUNCTION public._permit_source_readable(p_user_id UUID, p_credential_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_adapter TEXT;
  v_visible BOOLEAN;
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
  SELECT s.adapter_key, s.visible_to_all INTO v_adapter, v_visible
  FROM public.permit_sync_sources s WHERE s.credential_id = p_credential_id;
  IF EXISTS (
    SELECT 1 FROM public.permit_access_grants g
    WHERE g.revoked_at IS NULL
      AND g.effect = 'deny'
      AND (g.grantee_user_id = p_user_id
           OR (g.grantee_tenant_id IS NOT NULL AND public.has_tenant_access(p_user_id, g.grantee_tenant_id)))
      AND ((g.scope_type = 'source_credential' AND g.credential_id = p_credential_id)
           OR (g.scope_type = 'adapter' AND g.adapter_key = v_adapter))
  ) THEN
    RETURN FALSE;
  END IF;
  RETURN coalesce(v_visible, false) OR public.credential_has_grant(p_user_id, p_credential_id, 'use');
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Permit Queue read model: sources and job progress follow the same rule
-- ---------------------------------------------------------------------------

-- Sources the caller can read (platform admin, visible to all, or a 'use' grant; not hidden) with counts, schedule and the job in
-- flight / queued / last finished. No usernames or credential secrets.
CREATE OR REPLACE FUNCTION public.get_permit_sync_overview()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'credential_id', s.credential_id,
      'adapter_key', s.adapter_key,
      'jurisdiction', c.jurisdiction,
      'status', s.status,
      'automation_enabled', s.automation_enabled,
      'can_refresh', public._permit_sync_can_manage(v_uid, s.credential_id),
      'permit_count', (SELECT count(*) FROM public.permit_source_links l JOIN public.permits p ON p.id = l.permit_id
                       WHERE l.credential_id = s.credential_id AND p.removed_from_portal_at IS NULL),
      'schedule', s.settings -> 'schedule',
      'next_run_at', CASE WHEN s.automation_enabled AND s.status = 'active'
                       THEN public._permit_sync_next_slot(s.settings -> 'schedule', GREATEST(now(), coalesce(s.last_scheduled_at, now()))) END,
      'last_scheduled_at', s.last_scheduled_at,
      'last_success_at', (SELECT max(j.completed_at) FROM public.permit_sync_jobs j
                          WHERE j.credential_id = s.credential_id AND j.status IN ('completed', 'completed_with_warnings')),
      'active_job', (SELECT public._permit_sync_job_summary(j) FROM public.permit_sync_jobs j
                     WHERE j.credential_id = s.credential_id AND j.status IN ('running', 'retry_wait', 'waiting_user') LIMIT 1),
      'queued_job', (SELECT public._permit_sync_job_summary(j) FROM public.permit_sync_jobs j
                     WHERE j.credential_id = s.credential_id AND j.status = 'queued' LIMIT 1),
      'last_job', (SELECT public._permit_sync_job_summary(j) FROM public.permit_sync_jobs j
                   WHERE j.credential_id = s.credential_id AND j.completed_at IS NOT NULL
                     AND j.status IN ('completed', 'completed_with_warnings', 'failed', 'failed_unrecoverable', 'cancelled')
                   ORDER BY j.completed_at DESC LIMIT 1)
    ) ORDER BY c.jurisdiction, s.created_at)
    FROM public.permit_sync_sources s
    JOIN public.portal_credentials c ON c.id = s.credential_id
    WHERE public._permit_source_readable(v_uid, s.credential_id)
  ), '[]'::jsonb);
END;
$$;

-- One job with its per-permit rows (batch progress). Anyone who can read the source (_permit_source_readable).
CREATE OR REPLACE FUNCTION public.get_permit_sync_job_progress(p_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_job public.permit_sync_jobs;
BEGIN
  SELECT * INTO v_job FROM public.permit_sync_jobs WHERE id = p_job_id;
  IF v_uid IS NULL OR v_job.id IS NULL
     OR NOT public._permit_source_readable(v_uid, v_job.credential_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN public._permit_sync_job_summary(v_job) || jsonb_build_object('permits', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'portal_record_id', r.portal_record_id, 'permit_id', r.permit_id, 'permit_number', p.permit_number,
      'phase', r.phase, 'files_total', r.files_total, 'files_captured', r.files_captured, 'files_pending', r.files_pending,
      'files_failed', r.files_failed, 'reports_total', r.reports_total, 'reports_captured', r.reports_captured,
      'reports_failed', r.reports_failed, 'error_code', r.error_code, 'message', r.message,
      'started_at', r.started_at, 'finished_at', r.finished_at, 'updated_at', r.updated_at
    ) ORDER BY r.started_at NULLS LAST, p.permit_number)
    FROM public.permit_sync_job_permits r LEFT JOIN public.permits p ON p.id = r.permit_id
    WHERE r.job_id = p_job_id
  ), '[]'::jsonb));
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Management Admin RPCs (audited)
-- ---------------------------------------------------------------------------

-- Per-source "visible to all users by default" switch.
CREATE OR REPLACE FUNCTION public.admin_set_permit_source_default(p_credential_id UUID, p_visible BOOLEAN)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before BOOLEAN;
BEGIN
  PERFORM public._admin_require_platform_admin();
  IF p_visible IS NULL THEN
    RAISE EXCEPTION 'visible flag required' USING ERRCODE = '22023';
  END IF;
  SELECT s.visible_to_all INTO v_before FROM public.permit_sync_sources s WHERE s.credential_id = p_credential_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_before IS DISTINCT FROM p_visible THEN
    UPDATE public.permit_sync_sources SET visible_to_all = p_visible, updated_at = now() WHERE credential_id = p_credential_id;
    PERFORM public._permit_audit('permit_source.default_visibility', 'portal_credential', p_credential_id::text,
      jsonb_build_object('visible_to_all', v_before), jsonb_build_object('visible_to_all', p_visible));
  END IF;
END;
$$;

-- Hide a source from one user, or show it again. Hiding adds a 'deny' grant row (kept after unhiding, with
-- revoked_at set, as history). Returns whether anything changed. Platform admins cannot be hidden.
CREATE OR REPLACE FUNCTION public.admin_set_permit_user_hidden(
  p_user_id UUID,
  p_credential_id UUID,
  p_hidden BOOLEAN,
  p_note TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_changed BOOLEAN := false;
BEGIN
  PERFORM public._admin_require_platform_admin();
  IF p_hidden IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'user and hidden flag required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.permit_sync_sources s WHERE s.credential_id = p_credential_id) THEN
    RAISE EXCEPTION 'source not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = p_user_id) THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('permit_hide:' || p_user_id::text || ':' || p_credential_id::text));

  IF p_hidden THEN
    IF public.is_platform_admin(p_user_id) THEN
      RAISE EXCEPTION 'platform admins always see permits' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.permit_access_grants g
      WHERE g.revoked_at IS NULL AND g.effect = 'deny' AND g.grantee_user_id = p_user_id
        AND g.scope_type = 'source_credential' AND g.credential_id = p_credential_id
    ) THEN
      INSERT INTO public.permit_access_grants (grantee_user_id, scope_type, credential_id, effect, note, granted_by)
      VALUES (p_user_id, 'source_credential', p_credential_id, 'deny', p_note, auth.uid())
      RETURNING id INTO v_id;
      v_changed := true;
      PERFORM public._permit_audit('permit_access.hide', 'portal_credential', p_credential_id::text, NULL,
        jsonb_build_object('user_id', p_user_id, 'grant_id', v_id));
    END IF;
  ELSE
    UPDATE public.permit_access_grants g SET revoked_at = now(), revoked_by = auth.uid()
    WHERE g.revoked_at IS NULL AND g.effect = 'deny' AND g.grantee_user_id = p_user_id
      AND g.scope_type = 'source_credential' AND g.credential_id = p_credential_id;
    IF FOUND THEN
      v_changed := true;
      PERFORM public._permit_audit('permit_access.unhide', 'portal_credential', p_credential_id::text,
        jsonb_build_object('user_id', p_user_id), NULL);
    END IF;
  END IF;
  RETURN v_changed;
END;
$$;

-- Users with their access state for one source. No e-mail addresses: name and company only.
-- state: admin (always), hidden, inactive (suspended account), default (source visible to all), grant
-- (a 'use' credential grant), none.
CREATE OR REPLACE FUNCTION public.admin_list_permit_access(p_credential_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visible BOOLEAN;
BEGIN
  PERFORM public._admin_require_platform_admin();
  SELECT s.visible_to_all INTO v_visible FROM public.permit_sync_sources s WHERE s.credential_id = p_credential_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', x.user_id, 'full_name', x.full_name, 'company_name', x.company_name,
      'access_status', x.access_status, 'hidden', x.hidden, 'hidden_at', x.hidden_at,
      'can_read', x.state IN ('admin', 'default', 'grant'), 'state', x.state
    ) ORDER BY lower(coalesce(x.full_name, x.company_name, x.user_id::text)), x.user_id)
    FROM (
      SELECT p.user_id, p.full_name, p.company_name, p.access_status, d.hidden_at, d.hidden_at IS NOT NULL AS hidden,
        CASE
          WHEN public.is_platform_admin(p.user_id) THEN 'admin'
          WHEN d.hidden_at IS NOT NULL THEN 'hidden'
          WHEN p.access_status <> 'active' THEN 'inactive'
          WHEN v_visible THEN 'default'
          WHEN public.credential_has_grant(p.user_id, p_credential_id, 'use') THEN 'grant'
          ELSE 'none'
        END AS state
      FROM public.profiles p
      LEFT JOIN LATERAL (
        SELECT max(g.created_at) AS hidden_at FROM public.permit_access_grants g
        WHERE g.revoked_at IS NULL AND g.effect = 'deny' AND g.grantee_user_id = p.user_id
          AND g.scope_type = 'source_credential' AND g.credential_id = p_credential_id
        HAVING count(*) > 0
      ) d ON true
    ) x
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Function privileges
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public._permit_source_readable(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_permit_source_default(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_permit_user_hidden(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_list_permit_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_permit_source_default(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_permit_user_hidden(uuid, uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_permit_access(uuid) TO authenticated, service_role;
