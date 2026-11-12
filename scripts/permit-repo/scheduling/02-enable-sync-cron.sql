-- Scheduled permit refreshes (D-097). NOT a migration; run manually only after the first full refresh
-- was started from the Permit Queue and verified, and the source schedule was enabled in Management Admin.
-- The cron tick calls enqueue_permit_sync_runs(), which enqueues at most one job per enabled source per
-- schedule slot, never for a slot before the schedule was enabled, and skips sources with work in flight.
-- Undo: 99-disable-all.sql (or disable the schedule in Management Admin).

DO $$
DECLARE
  v_missing TEXT;
BEGIN
  IF to_regprocedure('public.enqueue_permit_sync_runs()') IS NULL OR to_regprocedure('public._permit_sync_due_slot(jsonb, timestamp with time zone, timestamp with time zone, timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'apply migration 20261113100000_permit_sync_orchestration first';
  END IF;
  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'pg_cron is not installed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.permit_sync_sources WHERE automation_enabled) THEN
    RAISE EXCEPTION 'no source has a schedule enabled; enable one in Management Admin first';
  END IF;
  -- Every scheduled source needs a finished deep refresh of all its permits first.
  SELECT string_agg(s.credential_id::text, ', ') INTO v_missing
  FROM public.permit_sync_sources s
  WHERE s.automation_enabled
    AND NOT EXISTS (
      SELECT 1 FROM public.permit_sync_jobs j
      WHERE j.credential_id = s.credential_id
        AND j.worker_mode = 'deep'
        AND j.status IN ('completed', 'completed_with_warnings')
        AND NOT (coalesce(j.options, '{}'::jsonb) ? 'only_portal_record_ids')
    );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'scheduled source(s) without a finished full deep refresh: %', v_missing;
  END IF;
END $$;

SELECT cron.schedule('permit-sync-enqueue', '*/5 * * * *', $cron$SELECT public.enqueue_permit_sync_runs()$cron$);

SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'permit-sync-%' ORDER BY jobname;
