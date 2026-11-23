-- Turns the Montgomery County MD schedule off (the same as switching it off in Management Admin -> Permit Sync
-- -> Scheduling, which is the preferred way) through the audited RPC, acting as a named platform admin. Leaves
-- DC, the enqueue cron, the monitor and the alert notifier alone. Fill in v_admin_email. Safe to run repeatedly.
-- Does not cancel a job already queued or running; cancel it from Permit Queue or Management Admin.

BEGIN;

DO $$
DECLARE
  v_admin_email CONSTANT TEXT := '<platform-admin-email>';
  v_admin UUID;
  v_source UUID;
BEGIN
  SELECT u.id INTO v_admin FROM auth.users u WHERE lower(u.email) = lower(v_admin_email);
  IF v_admin IS NULL OR NOT public.is_platform_admin(v_admin) THEN
    RAISE EXCEPTION 'set v_admin_email to an existing platform admin';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  FOR v_source IN SELECT credential_id FROM public.permit_sync_sources WHERE adapter_key = 'montgomery-projectdox' AND automation_enabled LOOP
    PERFORM public.admin_set_permit_sync_schedule(v_source, false);
  END LOOP;
END $$;

COMMIT;

SELECT left(credential_id::text, 8) AS source, status, automation_enabled, schedule_enabled_at FROM public.permit_sync_sources
WHERE adapter_key = 'montgomery-projectdox';
