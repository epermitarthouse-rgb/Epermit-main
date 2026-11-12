-- Permit sync monitor + alert notifier cron (D-099). NOT a migration; run manually after approval.
-- Neither job enqueues sync work: the monitor only reads jobs/workers and writes permit_sync_alerts,
-- the notifier only emails open/resolved alerts. Requires migration 20261113100000 and, for email,
-- the permit-sync-alert-notifier function plus Vault secrets supabase_project_url / supabase_service_role_key.
-- Undo: 99-disable-all.sql.

DO $$
BEGIN
  IF to_regprocedure('public.permit_sync_monitor()') IS NULL OR to_regprocedure('public.invoke_permit_sync_alert_notifier()') IS NULL THEN
    RAISE EXCEPTION 'apply migration 20261113100000_permit_sync_orchestration first';
  END IF;
  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'pg_cron is not installed';
  END IF;
END $$;

SELECT cron.schedule('permit-sync-monitor', '*/5 * * * *', $cron$SELECT public.permit_sync_monitor()$cron$);
SELECT cron.schedule('permit-sync-alert-notifier', '2-59/5 * * * *', $cron$SELECT public.invoke_permit_sync_alert_notifier()$cron$);

SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'permit-sync-%' ORDER BY jobname;
