-- Rollback for supabase/migrations/20261117100000_permit_pipeline_linking.sql (production approval required).
-- Restores the schema exactly as 20261113100000_permit_sync_orchestration.sql left it (verified by
-- scraper-service/tests/permit-repo-chain.test.js). The approval trigger function at the end is a verbatim
-- copy from 20260620120000_parsed_comments_response_approval.sql. Run in one transaction:
--   supabase db query --linked -f scripts/permit-repo/rollback-20261117100000_permit_pipeline_linking.sql
--   supabase migration repair --status reverted 20261117100000
-- Unschedule the permit-comment-pipeline cron job first if it was created
-- (scripts/permit-repo/pipeline/99-disable-pipeline-cron.sql).
-- Kept: project_permits links (including ones users created), parsed_comments rows (including rows the
-- pipeline added) and their responses. Dropped: portal identity / removed / changed markers on
-- parsed_comments and the pipeline state table, so comments marked "no longer on the portal" show as
-- ordinary rows again.

BEGIN;

DROP FUNCTION IF EXISTS public.get_comment_pipeline_overview(uuid[], uuid[]);
DROP FUNCTION IF EXISTS public.request_project_comment_processing(uuid);
DROP FUNCTION IF EXISTS public.unlink_project_permit(uuid, uuid);
DROP FUNCTION IF EXISTS public.link_project_permits(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.invoke_permit_comment_pipeline();
DROP FUNCTION IF EXISTS public.permit_pipeline_finish(uuid, text, text, text, uuid, text);
DROP FUNCTION IF EXISTS public.permit_pipeline_claim(text, integer, integer, uuid[]);
DROP FUNCTION IF EXISTS public._project_permit_comment_fingerprint(uuid);

DROP TABLE IF EXISTS public.project_comment_pipeline_state;

DROP INDEX IF EXISTS public.idx_parsed_comments_portal_identity;
ALTER TABLE public.parsed_comments
  DROP COLUMN IF EXISTS portal_changed_at,
  DROP COLUMN IF EXISTS portal_latest_text,
  DROP COLUMN IF EXISTS portal_removed_at,
  DROP COLUMN IF EXISTS portal_last_seen_at,
  DROP COLUMN IF EXISTS portal_status_raw,
  DROP COLUMN IF EXISTS portal_content_hash,
  DROP COLUMN IF EXISTS portal_comment_key,
  DROP COLUMN IF EXISTS portal_permit_id;

CREATE OR REPLACE FUNCTION public.enforce_parsed_comment_response_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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

COMMIT;
