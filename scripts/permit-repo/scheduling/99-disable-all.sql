-- Remove every permit-sync cron job (enqueue, monitor, notifier). Safe to run repeatedly.
-- Does not touch queued or running jobs; cancel those from Management Admin if needed.

DO $$
DECLARE
  v_name TEXT;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed; nothing to remove';
    RETURN;
  END IF;
  FOR v_name IN SELECT jobname FROM cron.job WHERE jobname IN ('permit-sync-enqueue', 'permit-sync-monitor', 'permit-sync-alert-notifier') LOOP
    PERFORM cron.unschedule(v_name);
    RAISE NOTICE 'unscheduled %', v_name;
  END LOOP;
END $$;
