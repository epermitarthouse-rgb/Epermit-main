-- Campaigns + Notifications cron invoke: read Supabase URL and service role key
-- from Vault instead of app.settings (permission denied on hosted Supabase).
-- Cron schedules unchanged. Edge function auth unchanged (Bearer service role).
--
-- Required Vault secrets (create manually before invoke will work):
--   supabase_project_url       — e.g. https://<project-ref>.supabase.co
--   supabase_service_role_key  — service_role JWT from Dashboard → Settings → API

-- ---------------------------------------------------------------------------
-- invoke_process_scheduled_notifications (every 5 min via existing cron job)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_process_scheduled_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  supabase_url text;
  service_role_key text;
BEGIN
  SELECT nullif(decrypted_secret, '')
  INTO supabase_url
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_project_url'
  LIMIT 1;

  SELECT nullif(decrypted_secret, '')
  INTO service_role_key
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_service_role_key'
  LIMIT 1;

  IF supabase_url IS NULL OR service_role_key IS NULL THEN
    RAISE WARNING
      'invoke_process_scheduled_notifications: vault secrets supabase_project_url / supabase_service_role_key not set; skip';
    RETURN;
  END IF;

  PERFORM extensions.http_post(
    url := rtrim(supabase_url, '/') || '/functions/v1/process-scheduled-notifications',
    body := jsonb_build_object('source', 'pg_cron', 'invoked_at', now())::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    )::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_process_scheduled_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_process_scheduled_notifications() TO postgres;

COMMENT ON FUNCTION public.invoke_process_scheduled_notifications() IS
  'Invokes process-scheduled-notifications edge function via pg_net. Reads supabase_project_url and supabase_service_role_key from Vault.';

-- ---------------------------------------------------------------------------
-- invoke_process_drip_emails (hourly via existing cron job)
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
  SELECT nullif(decrypted_secret, '')
  INTO supabase_url
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_project_url'
  LIMIT 1;

  SELECT nullif(decrypted_secret, '')
  INTO service_role_key
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_service_role_key'
  LIMIT 1;

  IF supabase_url IS NULL OR service_role_key IS NULL THEN
    RAISE WARNING
      'invoke_process_drip_emails: vault secrets supabase_project_url / supabase_service_role_key not set; skip';
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

COMMENT ON FUNCTION public.invoke_process_drip_emails() IS
  'Invokes process-drip-emails edge function via pg_net. Reads supabase_project_url and supabase_service_role_key from Vault.';
