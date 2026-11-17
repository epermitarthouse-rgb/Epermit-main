-- Permit → Response Matrix pipeline and project linking (D-110..D-116).
--
-- 1. parsed_comments carries the portal identity of comments that came from a linked permit, plus
--    soft-removal / pending-change markers so the parser never deletes or overwrites human work.
-- 2. The response-approval trigger lets service-role pipeline updates through on approved rows when they
--    leave the response untouched (service calls have no auth.uid()). User behaviour is unchanged.
-- 3. Project editors can link permits they can read (link_project_permits); a link still grants nothing.
-- 4. project_comment_pipeline_state + claim/finish functions: a project needs processing when the content
--    fingerprint of its linked permits' comments differs from the last completed one. Independent of
--    projects.portal_data_hash, so re-scrapes that change nothing do not re-run agents.
--
-- Additive and idempotent. Rollback: scripts/permit-repo/rollback-20261117100000_permit_pipeline_linking.sql

-- ---------------------------------------------------------------------------
-- 1. parsed_comments portal identity
-- ---------------------------------------------------------------------------

ALTER TABLE public.parsed_comments
  ADD COLUMN IF NOT EXISTS portal_permit_id UUID REFERENCES public.permits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portal_comment_key TEXT,
  ADD COLUMN IF NOT EXISTS portal_content_hash TEXT,
  ADD COLUMN IF NOT EXISTS portal_status_raw TEXT,
  ADD COLUMN IF NOT EXISTS portal_last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_removed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_latest_text TEXT,
  ADD COLUMN IF NOT EXISTS portal_changed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_parsed_comments_portal_identity
  ON public.parsed_comments (project_id, portal_permit_id, portal_comment_key)
  WHERE portal_permit_id IS NOT NULL AND portal_comment_key IS NOT NULL AND ingest_source <> 'raw_ref_staging';

COMMENT ON COLUMN public.parsed_comments.portal_removed_at IS
  'Set when the comment is no longer on the portal. The row (and any response) is kept.';
COMMENT ON COLUMN public.parsed_comments.portal_latest_text IS
  'Newer portal text for a comment that already has a response; original_text is left as reviewed.';

-- ---------------------------------------------------------------------------
-- 2. Response approval trigger: service-role updates that leave the response untouched pass
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_parsed_comment_response_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Server-side pipeline writes (no auth.uid()) to other columns of an approved row: nothing to enforce.
  IF TG_OP = 'UPDATE'
    AND auth.uid() IS NULL
    AND NEW.response_status IS NOT DISTINCT FROM OLD.response_status
    AND NEW.response_text IS NOT DISTINCT FROM OLD.response_text
    AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at
    AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by THEN
    RETURN NEW;
  END IF;

  IF NEW.response_status = 'Approved' THEN
    IF NEW.response_text IS NULL OR btrim(NEW.response_text) = '' THEN
      RAISE EXCEPTION 'Cannot approve an empty response';
    END IF;
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Authentication required to approve a response';
    END IF;
    IF NOT public.has_project_admin_access(auth.uid(), NEW.project_id) THEN
      RAISE EXCEPTION 'Insufficient permission to approve a response';
    END IF;
    IF TG_OP = 'INSERT'
      OR NEW.response_status IS DISTINCT FROM OLD.response_status
      OR NEW.approved_at IS NULL
      OR NEW.approved_by IS NULL THEN
      NEW.approved_at := now();
      NEW.approved_by := auth.uid();
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.response_status = 'Approved'
    AND NEW.response_status IS DISTINCT FROM 'Approved' THEN
    NEW.approved_at := NULL;
    NEW.approved_by := NULL;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.response_text IS DISTINCT FROM OLD.response_text THEN
    IF OLD.response_status = 'Approved' THEN
      NEW.response_status := COALESCE(NULLIF(NEW.response_status, 'Approved'), 'Draft');
      NEW.approved_at := NULL;
      NEW.approved_by := NULL;
    END IF;
    IF auth.uid() IS NOT NULL THEN
      NEW.last_edited_at := now();
      NEW.last_edited_by := auth.uid();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Pipeline state
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.project_comment_pipeline_state (
  project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'due'
    CHECK (status IN ('due', 'running', 'completed', 'failed', 'blocked')),
  requested_fingerprint TEXT,
  completed_fingerprint TEXT,
  pipeline_run_id UUID REFERENCES public.project_pipeline_runs(id) ON DELETE SET NULL,
  force_requested BOOLEAN NOT NULL DEFAULT false,
  attempts INTEGER NOT NULL DEFAULT 0,
  continuations INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  last_requested_at TIMESTAMPTZ,
  last_requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_comment_pipeline_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Readable comment pipeline state" ON public.project_comment_pipeline_state;
CREATE POLICY "Readable comment pipeline state" ON public.project_comment_pipeline_state
FOR SELECT TO authenticated USING (public.has_project_access(auth.uid(), project_id));

REVOKE ALL ON public.project_comment_pipeline_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.project_comment_pipeline_state TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Fingerprint: comment content of the linked permits the project owner can read
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._project_permit_comment_fingerprint(p_project_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_permits UUID[];
BEGIN
  SELECT user_id INTO v_owner FROM public.projects WHERE id = p_project_id;
  IF v_owner IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(pp.permit_id ORDER BY pp.permit_id) INTO v_permits
  FROM public.project_permits pp
  WHERE pp.project_id = p_project_id
    AND public.user_can_read_permit(v_owner, pp.permit_id);
  IF v_permits IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN md5(
    array_to_string(v_permits, ',') || '|' ||
    coalesce((
      SELECT string_agg(
        c.permit_id::text || ':' || c.portal_comment_key || ':' ||
          md5(concat_ws(E'\x1f', c.body, c.status, c.cycle::text, c.comment_type, c.department, c.file_name, c.ref_number::text)),
        ',' ORDER BY c.permit_id, c.portal_comment_key)
      FROM public.permit_review_comments c
      WHERE c.permit_id = ANY (v_permits) AND c.removed_at IS NULL
    ), '')
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Claim / finish (service role; called by the permit-comment-pipeline edge function)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.permit_pipeline_claim(
  p_worker TEXT,
  p_limit INTEGER DEFAULT 3,
  p_lease_seconds INTEGER DEFAULT 300,
  p_project_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  project_id UUID,
  owner_user_id UUID,
  fingerprint TEXT,
  pipeline_run_id UUID,
  force_requested BOOLEAN,
  attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r RECORD;
  v_fp TEXT;
  v_state public.project_comment_pipeline_state;
  v_claimed INTEGER := 0;
BEGIN
  IF p_worker IS NULL OR btrim(p_worker) = '' THEN
    RAISE EXCEPTION 'worker id required' USING ERRCODE = '22023';
  END IF;
  FOR r IN
    SELECT DISTINCT pp.project_id AS pid, p.user_id AS owner, s.next_attempt_at
    FROM public.project_permits pp
    JOIN public.projects p ON p.id = pp.project_id
    LEFT JOIN public.project_comment_pipeline_state s ON s.project_id = pp.project_id
    WHERE (p_project_ids IS NULL OR pp.project_id = ANY (p_project_ids))
      AND p.user_id IS NOT NULL
    ORDER BY s.next_attempt_at NULLS FIRST, pp.project_id
  LOOP
    EXIT WHEN v_claimed >= greatest(coalesce(p_limit, 3), 1);
    v_fp := public._project_permit_comment_fingerprint(r.pid);
    CONTINUE WHEN v_fp IS NULL;

    INSERT INTO public.project_comment_pipeline_state AS s (project_id)
    VALUES (r.pid)
    ON CONFLICT ON CONSTRAINT project_comment_pipeline_state_pkey DO NOTHING;
    SELECT * INTO v_state FROM public.project_comment_pipeline_state s
    WHERE s.project_id = r.pid FOR UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;

    CONTINUE WHEN v_state.completed_fingerprint IS NOT DISTINCT FROM v_fp AND NOT v_state.force_requested;
    CONTINUE WHEN v_state.lease_expires_at IS NOT NULL AND v_state.lease_expires_at > now();

    IF v_state.requested_fingerprint IS DISTINCT FROM v_fp THEN
      -- New content: earlier failures and the earlier run no longer apply.
      v_state.attempts := 0;
      v_state.continuations := 0;
      v_state.pipeline_run_id := NULL;
      v_state.next_attempt_at := now();
      IF v_state.status = 'blocked' THEN
        v_state.status := 'due';
      END IF;
    END IF;
    CONTINUE WHEN v_state.status = 'blocked';
    CONTINUE WHEN v_state.next_attempt_at > now();

    UPDATE public.project_comment_pipeline_state s SET
      status = 'running',
      requested_fingerprint = v_fp,
      pipeline_run_id = v_state.pipeline_run_id,
      attempts = v_state.attempts + 1,
      continuations = v_state.continuations,
      next_attempt_at = v_state.next_attempt_at,
      lease_owner = p_worker,
      lease_expires_at = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 300), 30)),
      last_started_at = now(),
      updated_at = now()
    WHERE s.project_id = r.pid;

    project_id := r.pid;
    owner_user_id := r.owner;
    fingerprint := v_fp;
    pipeline_run_id := v_state.pipeline_run_id;
    force_requested := v_state.force_requested;
    attempts := v_state.attempts + 1;
    v_claimed := v_claimed + 1;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- p_outcome: 'completed' | 'released' (time budget used, more work; resumes at once) | 'failed' (backs off).
CREATE OR REPLACE FUNCTION public.permit_pipeline_finish(
  p_project_id UUID,
  p_worker TEXT,
  p_fingerprint TEXT,
  p_outcome TEXT,
  p_pipeline_run_id UUID DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state public.project_comment_pipeline_state;
  v_status TEXT;
BEGIN
  IF p_outcome NOT IN ('completed', 'released', 'failed') THEN
    RAISE EXCEPTION 'invalid outcome' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_state FROM public.project_comment_pipeline_state
  WHERE project_id = p_project_id FOR UPDATE;
  IF NOT FOUND OR v_state.lease_owner IS DISTINCT FROM p_worker THEN
    RETURN 'lease_lost';
  END IF;

  IF p_outcome = 'completed' THEN
    UPDATE public.project_comment_pipeline_state SET
      status = 'completed',
      completed_fingerprint = p_fingerprint,
      pipeline_run_id = coalesce(p_pipeline_run_id, pipeline_run_id),
      -- A request made while this run was in flight still gets its own run.
      force_requested = (last_requested_at IS NOT NULL AND last_started_at IS NOT NULL AND last_requested_at > last_started_at),
      attempts = 0,
      continuations = 0,
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error = NULL,
      last_completed_at = now(),
      updated_at = now()
    WHERE project_id = p_project_id;
    RETURN 'completed';
  END IF;

  IF p_outcome = 'released' AND v_state.continuations < 30 THEN
    UPDATE public.project_comment_pipeline_state SET
      status = 'due',
      pipeline_run_id = coalesce(p_pipeline_run_id, pipeline_run_id),
      attempts = greatest(attempts - 1, 0),
      continuations = continuations + 1,
      next_attempt_at = now(),
      lease_owner = NULL,
      lease_expires_at = NULL,
      updated_at = now()
    WHERE project_id = p_project_id;
    RETURN 'due';
  END IF;

  v_status := CASE WHEN v_state.attempts >= 5 THEN 'blocked' ELSE 'failed' END;
  UPDATE public.project_comment_pipeline_state SET
    status = v_status,
    pipeline_run_id = coalesce(p_pipeline_run_id, pipeline_run_id),
    next_attempt_at = now() + least(interval '5 minutes' * power(4, greatest(v_state.attempts - 1, 0)), interval '6 hours'),
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error = left(coalesce(p_error, CASE WHEN p_outcome = 'released' THEN 'did not finish' ELSE 'failed' END), 500),
    updated_at = now()
  WHERE project_id = p_project_id;
  RETURN v_status;
END;
$$;

-- pg_cron target (same Vault secrets as invoke_permit_sync_alert_notifier). Not scheduled here.
CREATE OR REPLACE FUNCTION public.invoke_permit_comment_pipeline()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  SELECT nullif(decrypted_secret, '') INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_project_url' LIMIT 1;
  SELECT nullif(decrypted_secret, '') INTO v_key FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'permit comment pipeline skipped: required Vault secrets are absent';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/permit-comment-pipeline',
    body := jsonb_build_object('action', 'sweep', 'source', 'pg_cron'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. User actions
-- ---------------------------------------------------------------------------

-- Editors link permits they can read to a project (project creation, Portal Harvest, Response Matrix).
CREATE OR REPLACE FUNCTION public.link_project_permits(p_project_id UUID, p_permit_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_permit UUID;
  v_added INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.is_platform_admin(v_uid) OR public.has_project_editor_access(v_uid, p_project_id)) THEN
    RAISE EXCEPTION 'not allowed to change this project' USING ERRCODE = '42501';
  END IF;
  IF p_permit_ids IS NULL OR cardinality(p_permit_ids) = 0 OR cardinality(p_permit_ids) > 50 THEN
    RAISE EXCEPTION 'choose between 1 and 50 permits' USING ERRCODE = '22023';
  END IF;
  FOREACH v_permit IN ARRAY p_permit_ids LOOP
    IF NOT public.user_can_read_permit(v_uid, v_permit) THEN
      RAISE EXCEPTION 'permit not available to this account' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  FOREACH v_permit IN ARRAY (SELECT array_agg(DISTINCT x) FROM unnest(p_permit_ids) x) LOOP
    INSERT INTO public.project_permits (project_id, permit_id, linked_by)
    VALUES (p_project_id, v_permit, v_uid)
    ON CONFLICT (project_id, permit_id) DO NOTHING;
    IF FOUND THEN
      v_added := v_added + 1;
      PERFORM public._permit_audit('permit.link_project', 'permit', v_permit::text, NULL,
        jsonb_build_object('project_id', p_project_id, 'via', 'link_project_permits'));
    END IF;
  END LOOP;
  RETURN v_added;
END;
$$;

-- Unlinking stops new comments from flowing in; comments already in the Response Matrix stay.
CREATE OR REPLACE FUNCTION public.unlink_project_permit(p_project_id UUID, p_permit_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_platform_admin(v_uid) OR public.has_project_editor_access(v_uid, p_project_id)) THEN
    RAISE EXCEPTION 'not allowed to change this project' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.project_permits WHERE project_id = p_project_id AND permit_id = p_permit_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM public._permit_audit('permit.unlink_project', 'permit', p_permit_id::text,
    jsonb_build_object('project_id', p_project_id, 'via', 'unlink_project_permit'), NULL);
  RETURN true;
END;
$$;

-- "Process comments now" / "Try again": forces the next sweep to run this project even if up to date.
CREATE OR REPLACE FUNCTION public.request_project_comment_processing(p_project_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_platform_admin(v_uid) OR public.has_project_editor_access(v_uid, p_project_id)) THEN
    RAISE EXCEPTION 'not allowed to change this project' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.project_permits WHERE project_id = p_project_id) THEN
    RAISE EXCEPTION 'project has no linked permit' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.project_comment_pipeline_state AS s (project_id, force_requested, last_requested_at, last_requested_by)
  VALUES (p_project_id, true, now(), v_uid)
  ON CONFLICT ON CONSTRAINT project_comment_pipeline_state_pkey DO UPDATE SET
    force_requested = true,
    pipeline_run_id = NULL,
    status = CASE WHEN s.status = 'running' AND s.lease_expires_at > now() THEN s.status ELSE 'due' END,
    attempts = 0,
    continuations = 0,
    next_attempt_at = now(),
    last_requested_at = now(),
    last_requested_by = v_uid,
    updated_at = now();
  PERFORM public._permit_audit('permit.request_comment_processing', 'project', p_project_id::text, NULL, NULL);
  RETURN 'due';
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Read model for Permit Queue, project and Response Matrix views
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public._project_permit_comment_fingerprint(uuid)',
    'public.permit_pipeline_claim(text, integer, integer, uuid[])',
    'public.permit_pipeline_finish(uuid, text, text, text, uuid, text)',
    'public.invoke_permit_comment_pipeline()',
    'public.link_project_permits(uuid, uuid[])',
    'public.unlink_project_permit(uuid, uuid)',
    'public.request_project_comment_processing(uuid)',
    'public.get_comment_pipeline_overview(uuid[], uuid[])'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public._project_permit_comment_fingerprint(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.permit_pipeline_claim(text, integer, integer, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.permit_pipeline_finish(uuid, text, text, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.invoke_permit_comment_pipeline() TO service_role;
GRANT EXECUTE ON FUNCTION public.link_project_permits(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unlink_project_permit(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_project_comment_processing(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_comment_pipeline_overview(uuid[], uuid[]) TO authenticated, service_role;
