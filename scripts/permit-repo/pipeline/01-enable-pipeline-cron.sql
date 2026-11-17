-- Linked-permit comment pipeline sweep (D-113). NOT a migration; run manually after approval.
-- Every 5 minutes calls permit-comment-pipeline, which claims at most 2 linked projects whose permit comment
-- content changed since their last completed run and moves them through the existing agents.
-- Requires: migration 20261117100000, the permit-comment-pipeline function deployed, function secret
-- PERMITPILOT_SERVICE_PIPELINE_SECRET set, and Vault secrets supabase_project_url / supabase_service_role_key.
-- Undo: 99-disable-pipeline-cron.sql.

DO $$
BEGIN
  IF to_regprocedure('public.invoke_permit_comment_pipeline()') IS NULL THEN
    RAISE EXCEPTION 'apply migration 20261117100000_permit_pipeline_linking first';
  END IF;
  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'pg_cron is not installed';
  END IF;
END $$;

SELECT cron.schedule('permit-comment-pipeline', '1-59/5 * * * *', $cron$SELECT public.invoke_permit_comment_pipeline()$cron$);

SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'permit-comment-pipeline';
