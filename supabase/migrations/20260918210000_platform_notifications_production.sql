-- Platform Control Notifications: server-backed preferences, admin subscriber RPCs,
-- delivery metrics, and pg_cron invoke for process-scheduled-notifications.
-- DO NOT apply until pre-flight review in the target environment.

-- ---------------------------------------------------------------------------
-- Server-backed notification preferences
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_deadline_reminders BOOLEAN NOT NULL DEFAULT true,
  email_inspection_reminders BOOLEAN NOT NULL DEFAULT true,
  email_project_updates BOOLEAN NOT NULL DEFAULT true,
  email_jurisdiction_updates BOOLEAN NOT NULL DEFAULT true,
  inapp_notifications BOOLEAN NOT NULL DEFAULT true,
  inapp_jurisdiction_updates BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can view own notification preferences"
ON public.notification_preferences
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can insert own notification preferences"
ON public.notification_preferences
FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can update own notification preferences"
ON public.notification_preferences
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.notification_preferences IS
  'Per-user notification channel preferences. Jurisdiction dispatch reads email_jurisdiction_updates + inapp_jurisdiction_updates (gated by inapp_notifications).';

-- ---------------------------------------------------------------------------
-- Delivery metrics on admin activity log
-- ---------------------------------------------------------------------------
ALTER TABLE public.admin_activity_log
  ADD COLUMN IF NOT EXISTS inapp_sent INTEGER,
  ADD COLUMN IF NOT EXISTS emails_sent_count INTEGER,
  ADD COLUMN IF NOT EXISTS emails_failed_count INTEGER;

COMMENT ON COLUMN public.admin_activity_log.inapp_sent IS
  'In-app jurisdiction notifications inserted for this send.';
COMMENT ON COLUMN public.admin_activity_log.emails_sent_count IS
  'Emails successfully sent for this jurisdiction notification.';
COMMENT ON COLUMN public.admin_activity_log.emails_failed_count IS
  'Emails that failed to send for this jurisdiction notification.';

-- Scheduled notification delivery summary
ALTER TABLE public.scheduled_notifications
  ADD COLUMN IF NOT EXISTS inapp_sent INTEGER,
  ADD COLUMN IF NOT EXISTS emails_sent_count INTEGER,
  ADD COLUMN IF NOT EXISTS emails_failed_count INTEGER,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT;

-- ---------------------------------------------------------------------------
-- Admin subscriber summary (SECURITY DEFINER — bypasses subscription RLS)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_jurisdiction_subscriber_summary()
RETURNS TABLE (
  jurisdiction_id UUID,
  jurisdiction_name TEXT,
  jurisdiction_state TEXT,
  subscriber_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    js.jurisdiction_id,
    js.jurisdiction_name,
    js.jurisdiction_state,
    COUNT(*)::bigint AS subscriber_count
  FROM public.jurisdiction_subscriptions js
  GROUP BY js.jurisdiction_id, js.jurisdiction_name, js.jurisdiction_state
  ORDER BY js.jurisdiction_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_jurisdiction_subscriber_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_jurisdiction_subscriber_summary() TO authenticated;

COMMENT ON FUNCTION public.get_jurisdiction_subscriber_summary() IS
  'Platform admin: aggregated subscriber counts per jurisdiction. Does not expose individual user_ids.';

-- Admin subscriber list for a jurisdiction (for preview / audit — not used by end users)
CREATE OR REPLACE FUNCTION public.get_jurisdiction_subscriber_list(p_jurisdiction_id UUID)
RETURNS TABLE (
  user_id UUID,
  jurisdiction_id UUID,
  jurisdiction_name TEXT,
  jurisdiction_state TEXT,
  subscribed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    js.user_id,
    js.jurisdiction_id,
    js.jurisdiction_name,
    js.jurisdiction_state,
    js.created_at AS subscribed_at
  FROM public.jurisdiction_subscriptions js
  WHERE js.jurisdiction_id = p_jurisdiction_id
  ORDER BY js.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_jurisdiction_subscriber_list(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_jurisdiction_subscriber_list(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- User preference upsert RPC (Settings page)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_notification_preferences(p_prefs JSONB)
RETURNS public.notification_preferences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_row public.notification_preferences;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO public.notification_preferences (
    user_id,
    email_deadline_reminders,
    email_inspection_reminders,
    email_project_updates,
    email_jurisdiction_updates,
    inapp_notifications,
    inapp_jurisdiction_updates,
    updated_at
  ) VALUES (
    v_user_id,
    COALESCE((p_prefs->>'email_deadline_reminders')::boolean, true),
    COALESCE((p_prefs->>'email_inspection_reminders')::boolean, true),
    COALESCE((p_prefs->>'email_project_updates')::boolean, true),
    COALESCE((p_prefs->>'email_jurisdiction_updates')::boolean, true),
    COALESCE((p_prefs->>'inapp_notifications')::boolean, true),
    COALESCE((p_prefs->>'inapp_jurisdiction_updates')::boolean, true),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email_deadline_reminders = COALESCE((p_prefs->>'email_deadline_reminders')::boolean, notification_preferences.email_deadline_reminders),
    email_inspection_reminders = COALESCE((p_prefs->>'email_inspection_reminders')::boolean, notification_preferences.email_inspection_reminders),
    email_project_updates = COALESCE((p_prefs->>'email_project_updates')::boolean, notification_preferences.email_project_updates),
    email_jurisdiction_updates = COALESCE((p_prefs->>'email_jurisdiction_updates')::boolean, notification_preferences.email_jurisdiction_updates),
    inapp_notifications = COALESCE((p_prefs->>'inapp_notifications')::boolean, notification_preferences.inapp_notifications),
    inapp_jurisdiction_updates = COALESCE((p_prefs->>'inapp_jurisdiction_updates')::boolean, notification_preferences.inapp_jurisdiction_updates),
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_notification_preferences(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_notification_preferences(JSONB) TO authenticated;

-- One-click email unsubscribe (from notification footer link)
CREATE OR REPLACE FUNCTION public.unsubscribe_jurisdiction_emails()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO public.notification_preferences (user_id, email_jurisdiction_updates, updated_at)
  VALUES (v_user_id, false, now())
  ON CONFLICT (user_id) DO UPDATE SET
    email_jurisdiction_updates = false,
    updated_at = now();

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.unsubscribe_jurisdiction_emails() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unsubscribe_jurisdiction_emails() TO authenticated;

-- ---------------------------------------------------------------------------
-- Durable cron: invoke process-scheduled-notifications every 5 minutes
-- Requires app.settings.supabase_url + app.settings.service_role_key
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
  supabase_url := nullif(current_setting('app.settings.supabase_url', true), '');
  service_role_key := nullif(current_setting('app.settings.service_role_key', true), '');

  IF supabase_url IS NULL OR service_role_key IS NULL THEN
    RAISE WARNING
      'invoke_process_scheduled_notifications: app.settings.supabase_url / service_role_key not set; skip';
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

DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'process-scheduled-notifications';
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'process-scheduled-notifications',
    '*/5 * * * *',
    $cron$SELECT public.invoke_process_scheduled_notifications()$cron$
  );
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'pg_cron not available; schedule skipped (function still created)';
  WHEN undefined_function THEN
    RAISE NOTICE 'cron.schedule not available; schedule skipped';
END $$;
