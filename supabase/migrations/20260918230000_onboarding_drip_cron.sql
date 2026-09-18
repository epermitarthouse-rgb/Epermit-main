-- Platform Control Campaigns: pg_cron invoke for process-drip-emails.
-- Fixed onboarding drip sequence — no campaign builder or segmentation.
-- DO NOT apply until pre-flight review in the target environment.

-- ---------------------------------------------------------------------------
-- Durable cron: invoke process-drip-emails every hour
-- Requires app.settings.supabase_url + app.settings.service_role_key
-- (same pattern as process-scheduled-notifications)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_process_drip_emails()
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
      'invoke_process_drip_emails: app.settings.supabase_url / service_role_key not set; skip';
    RETURN;
  END IF;

  PERFORM extensions.http_post(
    url := rtrim(supabase_url, '/') || '/functions/v1/process-drip-emails',
    body := jsonb_build_object('source', 'pg_cron', 'invoked_at', now())::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    )::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_process_drip_emails() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_process_drip_emails() TO postgres;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'process-drip-emails';
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'process-drip-emails',
    '0 * * * *',
    $cron$SELECT public.invoke_process_drip_emails()$cron$
  );
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'pg_cron not available; schedule skipped (function still created)';
  WHEN undefined_function THEN
    RAISE NOTICE 'cron.schedule not available; schedule skipped';
END $$;

COMMENT ON FUNCTION public.invoke_process_drip_emails() IS
  'Invokes process-drip-emails edge function with service-role auth for onboarding drip delivery.';
