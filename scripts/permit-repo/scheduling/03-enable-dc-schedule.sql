-- Enables the nightly DC refresh schedule on source de8592f9 (daily 04:00 America/New_York) through the same
-- audited RPC Management Admin calls (admin_set_permit_sync_schedule), acting as a named platform admin.
-- NOT a migration; run manually only after approval, before 02-enable-sync-cron.sql. Fill in v_admin_email.
-- Enabling also sets the source status to 'active'. Nothing is enqueued: the first slot is the next 04:00
-- after this runs, and only once the permit-sync-enqueue cron is installed.
-- Undo: 98-disable-dc-schedule.sql (or turn the schedule off in Management Admin).

BEGIN;

DO $$
DECLARE
  v_admin_email CONSTANT TEXT := '<platform-admin-email>';
  v_credential CONSTANT UUID := 'de8592f9-69fc-4c71-8544-cb22bbbd5813';
  v_schedule CONSTANT JSONB := '{"frequency":"daily","time":"04:00","timezone":"America/New_York"}';
  v_admin UUID;
  v_out JSONB;
  v_src public.permit_sync_sources%ROWTYPE;
BEGIN
  SELECT u.id INTO v_admin FROM auth.users u WHERE lower(u.email) = lower(v_admin_email);
  IF v_admin IS NULL OR NOT public.is_platform_admin(v_admin) THEN
    RAISE EXCEPTION 'set v_admin_email to an existing platform admin';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  v_out := public.admin_set_permit_sync_schedule(v_credential, true, v_schedule);

  SELECT * INTO v_src FROM public.permit_sync_sources WHERE credential_id = v_credential;
  IF NOT v_src.automation_enabled OR v_src.status <> 'active' OR v_src.schedule_enabled_at IS NULL
     OR v_src.settings -> 'schedule' IS DISTINCT FROM v_schedule
     OR coalesce(v_src.settings ->> 'worker_mode', 'deep') <> 'deep' THEN
    RAISE EXCEPTION 'source state after enabling is not as expected (status %, automation %)', v_src.status, v_src.automation_enabled;
  END IF;
  RAISE NOTICE 'schedule enabled; next run at % UTC', (v_out ->> 'next_run_at');
END $$;

COMMIT;

SELECT credential_id, status, automation_enabled, settings -> 'schedule' AS schedule, schedule_enabled_at,
       public._permit_sync_next_slot(settings -> 'schedule', now()) AS next_run_at
FROM public.permit_sync_sources WHERE credential_id = 'de8592f9-69fc-4c71-8544-cb22bbbd5813';
