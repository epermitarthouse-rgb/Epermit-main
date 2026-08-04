-- Scheduled checklist reports: atomic claim, delivery-log outcomes, durable pg_cron invoke.
-- DO NOT apply to production until explicit confirmation (see docs/audits/scheduled-reports-workflow-audit.md).

-- ---------------------------------------------------------------------------
-- Claim lease columns (duplicate-send protection across overlapping cron ticks)
-- ---------------------------------------------------------------------------
ALTER TABLE public.scheduled_checklist_reports
  ADD COLUMN IF NOT EXISTS processing_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_claim_token UUID;

CREATE INDEX IF NOT EXISTS idx_scheduled_checklist_reports_due
  ON public.scheduled_checklist_reports (is_active, next_send_at)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- Delivery logs: no_match + is_test (tests excluded from production analytics)
-- ---------------------------------------------------------------------------
ALTER TABLE public.scheduled_report_delivery_logs
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checklist_count INTEGER;

COMMENT ON COLUMN public.scheduled_report_delivery_logs.is_test IS
  'True for Send Test invocations; Preview does not write logs. Filter is_test=false for production analytics.';

COMMENT ON COLUMN public.scheduled_report_delivery_logs.status IS
  'success | partial | failed | no_match';

-- Drop loose check if present; add explicit status check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scheduled_report_delivery_logs_status_check'
  ) THEN
    ALTER TABLE public.scheduled_report_delivery_logs
      ADD CONSTRAINT scheduled_report_delivery_logs_status_check
      CHECK (status IN ('success', 'partial', 'failed', 'no_match'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_delivery_logs_production
  ON public.scheduled_report_delivery_logs (user_id, sent_at DESC)
  WHERE is_test = false;

-- ---------------------------------------------------------------------------
-- Atomic claim of due schedules (FOR UPDATE SKIP LOCKED)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_due_scheduled_checklist_reports(
  p_limit INTEGER DEFAULT 25,
  p_lease_seconds INTEGER DEFAULT 900
)
RETURNS SETOF public.scheduled_checklist_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_ttl INTERVAL;
BEGIN
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
  v_ttl := make_interval(secs => GREATEST(60, COALESCE(p_lease_seconds, 900)));

  RETURN QUERY
  WITH due AS (
    SELECT r.id
    FROM public.scheduled_checklist_reports r
    WHERE r.is_active = true
      AND r.next_send_at IS NOT NULL
      AND r.next_send_at <= now()
      AND (
        r.processing_claimed_at IS NULL
        OR r.processing_claimed_at < now() - v_ttl
      )
    ORDER BY r.next_send_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.scheduled_checklist_reports r
  SET
    processing_claimed_at = now(),
    processing_claim_token = gen_random_uuid()
  FROM due
  WHERE r.id = due.id
  RETURNING r.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_scheduled_checklist_reports(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_due_scheduled_checklist_reports(INTEGER, INTEGER) TO service_role;

COMMENT ON FUNCTION public.claim_due_scheduled_checklist_reports(INTEGER, INTEGER) IS
  'Atomically claims due scheduled_checklist_reports for processing. Expired leases are reclaimable.';

-- ---------------------------------------------------------------------------
-- Durable cron: invoke process-scheduled-checklist-reports every 15 minutes
-- Requires app.settings.supabase_url + app.settings.service_role_key
-- (same pattern as shadow-evaluator trigger). Configure before relying on cron.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_process_scheduled_checklist_reports()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  supabase_url text;
  service_role_key text;
BEGIN
  supabase_url := nullif(current_setting('app.settings.supabase_url', true), '');
  service_role_key := nullif(current_setting('app.settings.service_role_key', true), '');

  IF supabase_url IS NULL OR service_role_key IS NULL THEN
    RAISE WARNING
      'invoke_process_scheduled_checklist_reports: app.settings.supabase_url / service_role_key not set; skip';
    RETURN;
  END IF;

  -- pg_net installed into extensions schema (see prior migrations)
  PERFORM extensions.http_post(
    url := rtrim(supabase_url, '/') || '/functions/v1/process-scheduled-checklist-reports',
    body := jsonb_build_object('source', 'pg_cron', 'invoked_at', now())::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    )::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_process_scheduled_checklist_reports() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_process_scheduled_checklist_reports() TO postgres;

-- Unschedule prior job with same name if re-applied
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'process-scheduled-checklist-reports';
EXCEPTION
  WHEN undefined_table THEN
    NULL; -- cron schema not present in some local envs
  WHEN undefined_function THEN
    NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'process-scheduled-checklist-reports',
    '*/15 * * * *',
    $cron$SELECT public.invoke_process_scheduled_checklist_reports()$cron$
  );
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'pg_cron not available; schedule skipped (function still created)';
  WHEN undefined_function THEN
    RAISE NOTICE 'cron.schedule not available; schedule skipped';
END $$;
