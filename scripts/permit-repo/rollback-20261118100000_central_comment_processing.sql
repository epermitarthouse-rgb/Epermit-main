-- Rollback for supabase/migrations/20261118100000_central_comment_processing.sql (production approval required).
-- Restores the schema exactly as 20261117130000_permit_default_access.sql left it (verified by
-- scraper-service/tests/permit-repo-chain.test.js). _project_permit_comment_fingerprint at the end is a verbatim
-- copy from 20261117100000_permit_pipeline_linking.sql. Run in one transaction:
--   supabase db query --linked -f scripts/permit-repo/rollback-20261118100000_central_comment_processing.sql
--   supabase migration repair --status reverted 20261118100000
-- Turn the central sweep off first (unset CENTRAL_PROCESSING_ENABLED on Edge Functions) so nothing writes meanwhile.
-- Kept: parsed_comments rows and every value in them (discipline, code reference, response, assignment, approvals),
-- including values copied from central results. Dropped: central results, per-permit state, the AI budget and
-- cost ledger (export them first if the spend record must be kept), and the provenance / processing-status
-- columns, so field sources fall back to "unknown" (treated as human work, the pre-migration rule).

BEGIN;

DROP FUNCTION IF EXISTS public.admin_retry_permit_comment_processing(uuid);
DROP FUNCTION IF EXISTS public.admin_list_permit_ai_budgets();
DROP FUNCTION IF EXISTS public.admin_get_central_processing_diagnostics(uuid[]);
DROP FUNCTION IF EXISTS public.get_permit_comment_processing(uuid[]);
DROP FUNCTION IF EXISTS public.permit_central_current_insights(uuid[]);
DROP FUNCTION IF EXISTS public.permit_central_backfill_inventory(text, text);
DROP FUNCTION IF EXISTS public.permit_ai_budget_status(text);
DROP FUNCTION IF EXISTS public.permit_ai_budget_settle(uuid, text, integer, integer, numeric, text);
DROP FUNCTION IF EXISTS public.permit_ai_budget_reserve(text, text, uuid, text, integer, numeric, text);
DROP FUNCTION IF EXISTS public._permit_ai_budget_used(text);
DROP FUNCTION IF EXISTS public.permit_central_record(uuid, text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.permit_central_work(uuid, text, text, integer);
DROP FUNCTION IF EXISTS public._permit_central_copy_ready(uuid, text);
DROP FUNCTION IF EXISTS public._permit_central_publish(uuid);
DROP FUNCTION IF EXISTS public.permit_central_finish(uuid, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.permit_central_claim(text, text, integer, integer, uuid[], text);
DROP FUNCTION IF EXISTS public._permit_central_fingerprint(uuid, text);
DROP FUNCTION IF EXISTS public.permit_central_summary(uuid[], text);
DROP FUNCTION IF EXISTS public._permit_central_comment_status(uuid[], text);
DROP FUNCTION IF EXISTS public._permit_central_comments(uuid[]);
DROP FUNCTION IF EXISTS public._permit_comment_input_hash(text, text, text, text);

DROP TRIGGER IF EXISTS trg_parsed_comments_field_source ON public.parsed_comments;
DROP FUNCTION IF EXISTS public._parsed_comment_track_field_source();

ALTER TABLE public.parsed_comments
  DROP COLUMN IF EXISTS central_update_at,
  DROP COLUMN IF EXISTS central_insight_id,
  DROP COLUMN IF EXISTS assigned_to_source,
  DROP COLUMN IF EXISTS response_text_source,
  DROP COLUMN IF EXISTS code_reference_source,
  DROP COLUMN IF EXISTS discipline_source,
  DROP COLUMN IF EXISTS processing_attempts,
  DROP COLUMN IF EXISTS processing_error,
  DROP COLUMN IF EXISTS processing_status;

DROP TABLE IF EXISTS public.permit_ai_cost_ledger;
DROP TABLE IF EXISTS public.permit_ai_budgets;
DROP TABLE IF EXISTS public.permit_comment_processing_state;
DROP TABLE IF EXISTS public.permit_comment_insights;

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

COMMIT;
