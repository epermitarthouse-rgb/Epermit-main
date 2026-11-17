-- Turns the nightly DC refresh off without touching the monitor or the alert notifier (99-disable-all.sql
-- removes those too). Removes the permit-sync-enqueue cron and disables the de8592f9 schedule through the
-- audited RPC, acting as a named platform admin. Fill in v_admin_email. Safe to run repeatedly.
-- Does not cancel a job already queued or running; cancel it from Permit Queue or Management Admin.

BEGIN;

DO $$
DECLARE
  v_admin_email CONSTANT TEXT := '<platform-admin-email>';
  v_source_id CONSTANT UUID := 'de8592f9-69fc-4c71-8544-cb22bbbd5813';
  v_admin UUID;
BEGIN
  SELECT u.id INTO v_admin FROM auth.users u WHERE lower(u.email) = lower(v_admin_email);
  IF v_admin IS NULL OR NOT public.is_platform_admin(v_admin) THEN
    RAISE EXCEPTION 'set v_admin_email to an existing platform admin';
  END IF;
  IF to_regclass('cron.job') IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'permit-sync-enqueue') THEN
    PERFORM cron.unschedule('permit-sync-enqueue');
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM public.admin_set_permit_sync_schedule(v_source_id, false);
END $$;

COMMIT;

SELECT credential_id, status, automation_enabled, schedule_enabled_at FROM public.permit_sync_sources
WHERE credential_id = 'de8592f9-69fc-4c71-8544-cb22bbbd5813';
