-- Rollback for supabase/migrations/20261117130000_permit_default_access.sql (production approval required).
-- Restores the schema exactly as 20261117120000 left it (verified by scraper-service/tests/permit-repo-chain.test.js):
-- user_can_read_permit from 20261111100000 and get_permit_sync_overview / get_permit_sync_job_progress from
-- 20261113100000, and get_comment_pipeline_overview from 20261117100000 are verbatim copies; the project_permits
-- policy is restored as 20261111100000 defined it. Run in one transaction:
--   supabase db query --linked -f scripts/permit-repo/rollback-20261117130000_permit_default_access.sql
--   supabase migration repair --status reverted 20261117130000
-- Effect: the default access ends. Only platform admins, 'use' credential grants and 'allow' grants read permits
-- again, so users who relied on the default lose the Permit Queue until a grant is added.
-- Deleted: 'deny' (hidden) grant rows. Without the effect column they would read as ordinary grants and give
-- the hidden users access, so they must go first. The hide / unhide history stays in platform_audit_events.
-- Dropped: permit_sync_sources.visible_to_all and the three admin functions. Kept: every other grant row.

BEGIN;

DELETE FROM public.permit_access_grants WHERE effect = 'deny';

-- user_can_read_permit as 20261111100000 defined it.
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

-- Sources the caller can see (platform admin, or a 'use' grant) with counts, schedule and the job in
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
    WHERE public.is_platform_admin(v_uid) OR public.credential_has_grant(v_uid, s.credential_id, 'use')
  ), '[]'::jsonb);
END;
$$;

-- One job with its per-permit rows (batch progress). Platform admins and 'use' grantees of the source.
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
     OR NOT (public.is_platform_admin(v_uid) OR public.credential_has_grant(v_uid, v_job.credential_id, 'use')) THEN
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

-- project_permits policy as 20261111100000 defined it, and get_comment_pipeline_overview verbatim from 20261117100000.
DROP POLICY IF EXISTS "Readable project permit links" ON public.project_permits;
CREATE POLICY "Readable project permit links" ON public.project_permits
FOR SELECT TO authenticated USING (public.can_read_permit(permit_id));

-- One row per (project, permit) link the caller can see. processing_state:
--   processed | waiting | processing | retrying | needs_attention | no_comments
-- last_error is returned to platform admins only.
CREATE OR REPLACE FUNCTION public.get_comment_pipeline_overview(
  p_project_ids UUID[] DEFAULT NULL,
  p_permit_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  project_id UUID,
  project_name TEXT,
  permit_id UUID,
  permit_number TEXT,
  jurisdiction TEXT,
  linked_at TIMESTAMPTZ,
  processing_state TEXT,
  comments_in_matrix INTEGER,
  comments_removed INTEGER,
  comments_changed INTEGER,
  portal_comments INTEGER,
  last_completed_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  can_edit BOOLEAN,
  last_error TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid UUID := auth.uid();
  v_admin BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_project_ids IS NULL AND p_permit_ids IS NULL THEN
    RAISE EXCEPTION 'project or permit ids required' USING ERRCODE = '22023';
  END IF;
  IF coalesce(cardinality(p_project_ids), 0) > 200 OR coalesce(cardinality(p_permit_ids), 0) > 200 THEN
    RAISE EXCEPTION 'at most 200 ids' USING ERRCODE = '22023';
  END IF;
  v_admin := public.is_platform_admin(v_uid);
  RETURN QUERY
  WITH links AS (
    SELECT pp.project_id, pp.permit_id, pp.created_at
    FROM public.project_permits pp
    WHERE (p_project_ids IS NULL OR pp.project_id = ANY (p_project_ids))
      AND (p_permit_ids IS NULL OR pp.permit_id = ANY (p_permit_ids))
      AND public.has_project_access(v_uid, pp.project_id)
      AND public.user_can_read_permit(v_uid, pp.permit_id)
  ),
  fp AS (
    SELECT DISTINCT l.project_id, public._project_permit_comment_fingerprint(l.project_id) AS current_fp
    FROM links l
  )
  SELECT
    l.project_id,
    pr.name::text,
    l.permit_id,
    pm.permit_number,
    pm.jurisdiction,
    l.created_at,
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM public.permit_review_comments c WHERE c.permit_id = l.permit_id AND c.removed_at IS NULL)
        THEN 'no_comments'
      WHEN s.status = 'running' AND s.lease_expires_at > now() THEN 'processing'
      WHEN s.status = 'blocked' THEN 'needs_attention'
      WHEN s.completed_fingerprint IS NOT NULL AND s.completed_fingerprint = f.current_fp AND NOT coalesce(s.force_requested, false)
        THEN 'processed'
      WHEN s.status = 'failed' THEN 'retrying'
      ELSE 'waiting'
    END,
    (SELECT count(*)::int FROM public.parsed_comments pc
      WHERE pc.project_id = l.project_id AND pc.portal_permit_id = l.permit_id
        AND pc.ingest_source IN ('raw_ref', 'fallback_llm') AND pc.portal_removed_at IS NULL),
    (SELECT count(*)::int FROM public.parsed_comments pc
      WHERE pc.project_id = l.project_id AND pc.portal_permit_id = l.permit_id AND pc.portal_removed_at IS NOT NULL),
    (SELECT count(*)::int FROM public.parsed_comments pc
      WHERE pc.project_id = l.project_id AND pc.portal_permit_id = l.permit_id AND pc.portal_latest_text IS NOT NULL),
    (SELECT count(*)::int FROM public.permit_review_comments c WHERE c.permit_id = l.permit_id AND c.removed_at IS NULL),
    s.last_completed_at,
    s.next_attempt_at,
    (v_admin OR public.has_project_editor_access(v_uid, l.project_id)),
    CASE WHEN v_admin THEN s.last_error END
  FROM links l
  JOIN public.projects pr ON pr.id = l.project_id
  JOIN public.permits pm ON pm.id = l.permit_id
  LEFT JOIN fp f ON f.project_id = l.project_id
  LEFT JOIN public.project_comment_pipeline_state s ON s.project_id = l.project_id
  ORDER BY pr.name, pm.permit_number;
END;
$$;

DROP FUNCTION IF EXISTS public._permit_project_link_visible(uuid, uuid);
DROP FUNCTION IF EXISTS public.admin_list_permit_access(uuid);
DROP FUNCTION IF EXISTS public.admin_set_permit_user_hidden(uuid, uuid, boolean, text);
DROP FUNCTION IF EXISTS public.admin_set_permit_source_default(uuid, boolean);
DROP FUNCTION IF EXISTS public._permit_source_readable(uuid, uuid);

ALTER TABLE public.permit_access_grants DROP COLUMN IF EXISTS effect;
ALTER TABLE public.permit_sync_sources DROP COLUMN IF EXISTS visible_to_all;

COMMIT;
