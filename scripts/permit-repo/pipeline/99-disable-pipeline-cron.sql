-- Remove the linked-permit comment pipeline sweep. Safe to run repeatedly. Work already in flight finishes
-- or is released; "Process comments now" in the app keeps working while the function is deployed.

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed; nothing to remove';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'permit-comment-pipeline') THEN
    PERFORM cron.unschedule('permit-comment-pipeline');
    RAISE NOTICE 'unscheduled permit-comment-pipeline';
  END IF;
END $$;
