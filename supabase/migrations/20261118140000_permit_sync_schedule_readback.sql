-- D-126: admin_set_permit_sync_schedule reports the stored state instead of echoing p_enabled, and refuses
-- (rolls back, no audit row) when the stored source does not match the request: enabled must be stored as
-- automation_enabled = true with status 'active' (the only state enqueue_permit_sync_runs picks up).
-- Same signature, checks and audit rows as 20261113100000; grants are kept by CREATE OR REPLACE.
-- Rollback: scripts/permit-repo/rollback-20261118140000_permit_sync_schedule_readback.sql.

CREATE OR REPLACE FUNCTION public.admin_set_permit_sync_schedule(
  p_credential_id UUID, p_enabled BOOLEAN, p_schedule JSONB DEFAULT NULL, p_deep_defaults JSONB DEFAULT NULL, p_max_attempts INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.permit_sync_sources%ROWTYPE;
  v_after public.permit_sync_sources%ROWTYPE;
  v_settings JSONB;
BEGIN
  PERFORM public._admin_require_platform_admin();
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'p_enabled is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_source FROM public.permit_sync_sources WHERE credential_id = p_credential_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no permit sync source for credential' USING ERRCODE = 'P0002';
  END IF;
  v_settings := v_source.settings
    || CASE WHEN p_schedule IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('schedule', p_schedule) END
    || CASE WHEN p_deep_defaults IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('deep_defaults', p_deep_defaults) END
    || CASE WHEN p_max_attempts IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('max_attempts', p_max_attempts) END;
  PERFORM public._permit_sync_validate_settings(v_settings);
  IF p_enabled AND (v_settings -> 'schedule' IS NULL OR jsonb_typeof(v_settings -> 'schedule') <> 'object') THEN
    RAISE EXCEPTION 'set a schedule before enabling automation' USING ERRCODE = '22023';
  END IF;
  -- Same login as the claim lock (case and surrounding spaces ignored).
  IF p_enabled AND EXISTS (
    SELECT 1 FROM public.permit_sync_sources s
    JOIN public.portal_credentials other ON other.id = s.credential_id
    JOIN public.portal_credentials me ON me.id = p_credential_id
    WHERE s.automation_enabled AND s.credential_id <> p_credential_id
      AND lower(other.jurisdiction) = lower(me.jurisdiction)
      AND lower(trim(other.portal_username)) = lower(trim(me.portal_username))
  ) THEN
    RAISE EXCEPTION 'another credential for the same portal login already drives automation' USING ERRCODE = '23505';
  END IF;
  PERFORM public.admin_set_permit_sync_source(p_credential_id, v_source.adapter_key, p_enabled, v_settings);
  UPDATE public.permit_sync_sources
  SET schedule_enabled_at = CASE WHEN p_enabled AND NOT v_source.automation_enabled THEN now()
                                 WHEN p_enabled THEN coalesce(schedule_enabled_at, now()) ELSE NULL END
  WHERE credential_id = p_credential_id
  RETURNING * INTO v_after;
  IF v_after.automation_enabled IS DISTINCT FROM p_enabled
     OR (p_enabled AND (v_after.status IS DISTINCT FROM 'active' OR v_after.schedule_enabled_at IS NULL)) THEN
    RAISE EXCEPTION 'schedule not saved: requested enabled=%, stored enabled=% status=%', p_enabled::text, v_after.automation_enabled::text, v_after.status
      USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._permit_audit('permit_sync_source.schedule', 'portal_credential', p_credential_id::text,
    jsonb_build_object('automation_enabled', v_source.automation_enabled, 'schedule', v_source.settings -> 'schedule'),
    jsonb_build_object('automation_enabled', v_after.automation_enabled, 'schedule', v_after.settings -> 'schedule', 'deep_defaults', v_after.settings -> 'deep_defaults', 'max_attempts', v_after.settings -> 'max_attempts'));
  RETURN jsonb_build_object(
    'automation_enabled', v_after.automation_enabled,
    'status', v_after.status,
    'schedule', v_after.settings -> 'schedule',
    'schedule_enabled_at', v_after.schedule_enabled_at,
    'next_run_at', CASE WHEN v_after.automation_enabled THEN public._permit_sync_next_slot(v_after.settings -> 'schedule', now()) END);
END;
$$;
