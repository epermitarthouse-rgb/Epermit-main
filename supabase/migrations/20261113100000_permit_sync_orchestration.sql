-- Permit sync orchestration (D-093 .. D-100): one request path for every refresh, deep jobs by default,
-- coalescing, the same-login claim lock, graceful release, per-permit progress, worker heartbeats,
-- schedule settings and the runtime monitor.
--
-- Additive and re-runnable. Nothing here enqueues a job, schedules cron or changes a source's settings:
-- requests come only from the RPCs below, and the enqueue / monitor cron jobs are created by the separate
-- scripts in scripts/permit-repo/scheduling/ after approval. admin_request_permit_deep_sync (the controlled
-- live-test RPC with exact options) is not changed.
-- Depends on 20261111100100_permit_sync_queue.sql, 20261111120000_permit_deep_capture.sql and
-- 20261112100000_permit_capture_retry.sql.

-- ---------------------------------------------------------------------------
-- 1. Columns, indexes, tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.permit_sync_jobs ADD COLUMN IF NOT EXISTS phase TEXT;
ALTER TABLE public.permit_sync_jobs ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.permit_sync_jobs ADD COLUMN IF NOT EXISTS release_count INTEGER NOT NULL DEFAULT 0;
-- Jobs created by the request path can absorb later requests. Jobs with exact options (the controlled
-- live-test RPC admin_request_permit_deep_sync, and jobs from before this migration) are never widened.
ALTER TABLE public.permit_sync_jobs ADD COLUMN IF NOT EXISTS coalescible BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'permit_sync_jobs_phase_check') THEN
    ALTER TABLE public.permit_sync_jobs ADD CONSTRAINT permit_sync_jobs_phase_check
      CHECK (phase IS NULL OR phase IN ('queued', 'authenticating', 'discovering', 'processing', 'finishing', 'released'));
  END IF;
END;
$$;

ALTER TABLE public.permit_sync_sources ADD COLUMN IF NOT EXISTS schedule_enabled_at TIMESTAMPTZ;
ALTER TABLE public.permit_sync_sources ADD COLUMN IF NOT EXISTS last_scheduled_at TIMESTAMPTZ;
ALTER TABLE public.permit_sync_sources ADD COLUMN IF NOT EXISTS last_schedule_result TEXT;

-- One job in flight per source (running / retry_wait / waiting_user) and at most one queued follow-up
-- behind it (D-094). Replaces uq_permit_sync_jobs_one_active, which allowed one non-terminal job in total.
CREATE UNIQUE INDEX IF NOT EXISTS uq_permit_sync_jobs_one_inflight
  ON public.permit_sync_jobs (credential_id)
  WHERE status IN ('running', 'retry_wait', 'waiting_user');
CREATE UNIQUE INDEX IF NOT EXISTS uq_permit_sync_jobs_one_queued
  ON public.permit_sync_jobs (credential_id)
  WHERE status = 'queued';
DROP INDEX IF EXISTS public.uq_permit_sync_jobs_one_active;

-- Per-permit progress of a job (D-096). Rows are written by the request RPCs (queued) and by the worker
-- through report_permit_sync_progress; job status changes settle the rows that are still open.
CREATE TABLE IF NOT EXISTS public.permit_sync_job_permits (
  job_id UUID NOT NULL REFERENCES public.permit_sync_jobs(id) ON DELETE CASCADE,
  portal_record_id TEXT NOT NULL,
  permit_id UUID REFERENCES public.permits(id) ON DELETE CASCADE,
  phase TEXT NOT NULL DEFAULT 'queued' CHECK (phase IN (
    'queued', 'authenticating', 'reading_info', 'capturing_reviews', 'downloading_files', 'exporting_reports',
    'retrying', 'completed', 'completed_with_warnings', 'failed', 'cancelled', 'skipped')),
  files_total INTEGER,
  files_captured INTEGER,
  files_pending INTEGER,
  files_failed INTEGER,
  reports_total INTEGER,
  reports_captured INTEGER,
  reports_failed INTEGER,
  error_code TEXT,
  message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, portal_record_id)
);
CREATE INDEX IF NOT EXISTS idx_permit_sync_job_permits_permit ON public.permit_sync_job_permits (permit_id, updated_at DESC);

-- Worker processes report liveness here (D-097); the monitor reads it, the worker never depends on it.
CREATE TABLE IF NOT EXISTS public.permit_sync_workers (
  worker_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('json', 'deep')),
  status TEXT NOT NULL CHECK (status IN ('starting', 'idle', 'busy', 'stopping', 'stopped')),
  current_job_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_permit_sync_workers_seen ON public.permit_sync_workers (mode, last_seen_at DESC);

-- Runtime alerts (D-099). One open row per alert_key; repeated detections bump occurrences.
CREATE TABLE IF NOT EXISTS public.permit_sync_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  credential_id UUID,
  job_id UUID,
  permit_id UUID,
  title TEXT NOT NULL,
  detail TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurrences INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  notified_at TIMESTAMPTZ,
  notify_count INTEGER NOT NULL DEFAULT 0,
  resolution_notified_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_permit_sync_alerts_open ON public.permit_sync_alerts (alert_key) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_permit_sync_alerts_recent ON public.permit_sync_alerts (last_seen_at DESC);

ALTER TABLE public.permit_sync_job_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_sync_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_sync_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins read permit sync job permits" ON public.permit_sync_job_permits;
CREATE POLICY "Platform admins read permit sync job permits" ON public.permit_sync_job_permits
FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
DROP POLICY IF EXISTS "Platform admins read permit sync workers" ON public.permit_sync_workers;
CREATE POLICY "Platform admins read permit sync workers" ON public.permit_sync_workers
FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
DROP POLICY IF EXISTS "Platform admins read permit sync alerts" ON public.permit_sync_alerts;
CREATE POLICY "Platform admins read permit sync alerts" ON public.permit_sync_alerts
FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));

REVOKE ALL ON public.permit_sync_job_permits, public.permit_sync_workers, public.permit_sync_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.permit_sync_job_permits, public.permit_sync_workers, public.permit_sync_alerts TO authenticated;
GRANT ALL ON public.permit_sync_job_permits, public.permit_sync_workers, public.permit_sync_alerts TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Helpers: scope, settings, schedule
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._permit_sync_terminal_phase(p_phase TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS
$$ SELECT p_phase IN ('completed', 'completed_with_warnings', 'failed', 'cancelled', 'skipped') $$;

-- NULL = every permit of the source. A union beyond the 50-id option limit widens to every permit.
CREATE OR REPLACE FUNCTION public._permit_sync_merge_scope(p_a TEXT[], p_b TEXT[])
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_a IS NULL OR p_b IS NULL THEN NULL
    WHEN (SELECT count(DISTINCT x) FROM unnest(p_a || p_b) x) > 50 THEN NULL
    ELSE (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(p_a || p_b) x)
  END
$$;

CREATE OR REPLACE FUNCTION public._permit_sync_job_scope(p_options JSONB)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN jsonb_typeof(p_options -> 'only_portal_record_ids') = 'array'
    THEN ARRAY(SELECT jsonb_array_elements_text(p_options -> 'only_portal_record_ids')) END
$$;

CREATE OR REPLACE FUNCTION public._permit_sync_with_scope(p_options JSONB, p_scope TEXT[])
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (coalesce(p_options, '{}'::jsonb) - 'only_portal_record_ids')
    || CASE WHEN p_scope IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('only_portal_record_ids', to_jsonb(p_scope)) END
$$;

-- Validates the orchestration keys of permit_sync_sources.settings:
--   worker_mode   'deep' (default) | 'json'
--   max_attempts  1..10 (deep default 5, json 3)
--   deep_defaults { max_files, max_bytes, max_file_bytes } applied to every request for the source
--   schedule      { frequency: daily|weekdays|weekly, time: 'HH:MM', timezone: IANA name, weekday: 0..6 (weekly) }
CREATE OR REPLACE FUNCTION public._permit_sync_validate_settings(p_settings JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_schedule JSONB := p_settings -> 'schedule';
  v_tz TEXT;
BEGIN
  IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'settings must be an object' USING ERRCODE = '22023';
  END IF;
  IF p_settings ? 'worker_mode' AND (p_settings ->> 'worker_mode') NOT IN ('deep', 'json') THEN
    RAISE EXCEPTION 'worker_mode must be deep or json' USING ERRCODE = '22023';
  END IF;
  IF p_settings ? 'max_attempts' AND (jsonb_typeof(p_settings -> 'max_attempts') <> 'number'
       OR (p_settings ->> 'max_attempts')::numeric NOT BETWEEN 1 AND 10
       OR (p_settings ->> 'max_attempts')::numeric <> trunc((p_settings ->> 'max_attempts')::numeric)) THEN
    RAISE EXCEPTION 'max_attempts must be an integer from 1 to 10' USING ERRCODE = '22023';
  END IF;
  IF p_settings ? 'deep_defaults' THEN
    IF jsonb_typeof(p_settings -> 'deep_defaults') <> 'object' OR (p_settings -> 'deep_defaults') ? 'only_portal_record_ids' THEN
      RAISE EXCEPTION 'deep_defaults takes max_files, max_bytes and max_file_bytes only' USING ERRCODE = '22023';
    END IF;
    PERFORM public._permit_sync_validate_options(p_settings -> 'deep_defaults');
  END IF;
  IF v_schedule IS NOT NULL AND jsonb_typeof(v_schedule) <> 'null' THEN
    IF jsonb_typeof(v_schedule) <> 'object'
       OR coalesce(v_schedule ->> 'frequency', '') NOT IN ('daily', 'weekdays', 'weekly')
       OR coalesce(v_schedule ->> 'time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'schedule needs frequency daily|weekdays|weekly and time HH:MM' USING ERRCODE = '22023';
    END IF;
    IF v_schedule ->> 'frequency' = 'weekly' AND coalesce(v_schedule ->> 'weekday', '') !~ '^[0-6]$' THEN
      RAISE EXCEPTION 'a weekly schedule needs weekday 0 (Sunday) to 6' USING ERRCODE = '22023';
    END IF;
    v_tz := v_schedule ->> 'timezone';
    IF v_tz IS NULL OR length(v_tz) = 0 THEN
      RAISE EXCEPTION 'schedule timezone is required (for example America/New_York)' USING ERRCODE = '22023';
    END IF;
    BEGIN
      PERFORM now() AT TIME ZONE v_tz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'unknown schedule timezone %', v_tz USING ERRCODE = '22023';
    END;
  END IF;
  RETURN p_settings;
END;
$$;

-- The scheduled instant on a local calendar day, or NULL when the schedule does not run that day.
CREATE OR REPLACE FUNCTION public._permit_sync_slot(p_schedule JSONB, p_day DATE)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_dow INTEGER := extract(dow FROM p_day)::int;
BEGIN
  IF p_schedule IS NULL OR jsonb_typeof(p_schedule) <> 'object' THEN
    RETURN NULL;
  END IF;
  IF p_schedule ->> 'frequency' = 'weekdays' AND v_dow IN (0, 6) THEN
    RETURN NULL;
  END IF;
  IF p_schedule ->> 'frequency' = 'weekly' AND v_dow <> (p_schedule ->> 'weekday')::int THEN
    RETURN NULL;
  END IF;
  RETURN (p_day + (p_schedule ->> 'time')::time) AT TIME ZONE (p_schedule ->> 'timezone');
END;
$$;

-- Latest scheduled instant at or before p_now that has not been enqueued yet and came after the schedule
-- was enabled (turning a schedule on never starts a run for a time that has already passed).
CREATE OR REPLACE FUNCTION public._permit_sync_due_slot(p_schedule JSONB, p_last TIMESTAMPTZ, p_enabled_at TIMESTAMPTZ, p_now TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_today DATE;
  v_slot TIMESTAMPTZ;
  i INTEGER;
BEGIN
  IF p_schedule IS NULL OR jsonb_typeof(p_schedule) <> 'object' THEN
    RETURN NULL;
  END IF;
  v_today := (p_now AT TIME ZONE (p_schedule ->> 'timezone'))::date;
  FOR i IN 0..7 LOOP
    v_slot := public._permit_sync_slot(p_schedule, v_today - i);
    IF v_slot IS NOT NULL AND v_slot <= p_now THEN
      IF v_slot > coalesce(p_last, '-infinity'::timestamptz) AND v_slot > coalesce(p_enabled_at, 'infinity'::timestamptz) THEN
        RETURN v_slot;
      END IF;
      RETURN NULL;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._permit_sync_next_slot(p_schedule JSONB, p_after TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_today DATE;
  v_slot TIMESTAMPTZ;
  i INTEGER;
BEGIN
  IF p_schedule IS NULL OR jsonb_typeof(p_schedule) <> 'object' THEN
    RETURN NULL;
  END IF;
  v_today := (p_after AT TIME ZONE (p_schedule ->> 'timezone'))::date;
  FOR i IN 0..8 LOOP
    v_slot := public._permit_sync_slot(p_schedule, v_today + i);
    IF v_slot IS NOT NULL AND v_slot > p_after THEN
      RETURN v_slot;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- Queued progress rows for the permits a request covers (p_ids NULL = every permit the source sees).
CREATE OR REPLACE FUNCTION public._permit_sync_seed_progress(p_job_id UUID, p_credential_id UUID, p_adapter_key TEXT, p_ids TEXT[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.permit_sync_job_permits AS r (job_id, portal_record_id, permit_id, phase)
  SELECT p_job_id, p.portal_record_id, p.id, 'queued'
  FROM public.permits p
  JOIN public.permit_source_links l ON l.permit_id = p.id AND l.credential_id = p_credential_id
  WHERE p.adapter_key = p_adapter_key
    AND p.removed_from_portal_at IS NULL
    AND (p_ids IS NULL OR p.portal_record_id = ANY (p_ids))
  ON CONFLICT (job_id, portal_record_id) DO UPDATE
    SET phase = 'queued', error_code = NULL, message = NULL, finished_at = NULL, updated_at = now()
    WHERE public._permit_sync_terminal_phase(r.phase);
$$;

-- ---------------------------------------------------------------------------
-- 3. One request path (D-093, D-094)
-- ---------------------------------------------------------------------------

-- Every refresh goes through here: user refresh (all permits or some), Sync now, the schedule and retry.
-- Result: created | merged (into the queued job, or the retry_wait job, which is pulled forward unless the
-- portal rate-limited it) | already_covered (the running job will still process every requested permit)
-- | queued_follow_up (one job queued behind the running one) | skipped_busy (scheduled while in flight).
CREATE OR REPLACE FUNCTION public._permit_sync_request(p_credential_id UUID, p_ids TEXT[], p_trigger TEXT, p_requested_by UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.permit_sync_sources%ROWTYPE;
  v_job public.permit_sync_jobs%ROWTYPE;
  v_mode TEXT;
  v_defaults JSONB;
  v_max INTEGER;
  v_ids TEXT[];
  v_scope TEXT[];
  v_done JSONB;
  v_pending BOOLEAN;
  v_result TEXT := 'created';
  v_id UUID;
BEGIN
  IF p_trigger NOT IN ('manual', 'scheduled') THEN
    RAISE EXCEPTION 'unknown trigger %', p_trigger USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_source FROM public.permit_sync_sources WHERE credential_id = p_credential_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no permit sync source for credential' USING ERRCODE = 'P0002';
  END IF;
  IF v_source.status IN ('needs_encryption', 'auth_failed', 'paused', 'waiting_user') THEN
    RAISE EXCEPTION 'source status % does not allow runs', v_source.status USING ERRCODE = '22023';
  END IF;
  IF p_trigger = 'scheduled' AND NOT v_source.automation_enabled THEN
    RAISE EXCEPTION 'automation is disabled for this source' USING ERRCODE = '22023';
  END IF;
  IF p_ids IS NOT NULL AND cardinality(p_ids) = 0 THEN
    RAISE EXCEPTION 'no permits requested' USING ERRCODE = '22023';
  END IF;

  v_mode := coalesce(v_source.settings ->> 'worker_mode', 'deep');
  v_defaults := coalesce(v_source.settings -> 'deep_defaults', '{}'::jsonb) - 'only_portal_record_ids';
  v_max := coalesce((v_source.settings ->> 'max_attempts')::int, CASE WHEN v_mode = 'deep' THEN 5 ELSE 3 END);
  v_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(p_ids) x);
  IF v_ids IS NOT NULL THEN
    PERFORM public._permit_sync_validate_options(jsonb_build_object('only_portal_record_ids', to_jsonb(v_ids)));
  END IF;

  -- 1. A queued job has not been claimed: widen it.
  SELECT * INTO v_job FROM public.permit_sync_jobs WHERE credential_id = p_credential_id AND status = 'queued' FOR UPDATE;
  IF FOUND AND NOT v_job.coalescible THEN
    IF p_trigger = 'scheduled' THEN
      RETURN jsonb_build_object('job_id', v_job.id, 'result', 'skipped_busy', 'status', 'queued');
    END IF;
    RAISE EXCEPTION 'a controlled job with exact options is queued for this source; let it run or cancel it first' USING ERRCODE = '55000';
  END IF;
  IF FOUND THEN
    v_scope := public._permit_sync_merge_scope(public._permit_sync_job_scope(v_job.options), v_ids);
    UPDATE public.permit_sync_jobs
    SET options = public._permit_sync_with_scope(options, v_scope),
        worker_mode = v_mode,
        trigger = CASE WHEN p_trigger = 'manual' THEN 'manual' ELSE trigger END,
        requested_by = coalesce(requested_by, p_requested_by),
        max_attempts = GREATEST(max_attempts, v_max),
        next_attempt_at = LEAST(next_attempt_at, now()),
        updated_at = now()
    WHERE id = v_job.id;
    INSERT INTO public.permit_sync_events (job_id, level, code, message, data)
    VALUES (v_job.id, 'info', 'coalesced', p_trigger, jsonb_build_object('into', 'queued', 'requested', to_jsonb(v_ids), 'scope', to_jsonb(v_scope)));
    PERFORM public._permit_sync_seed_progress(v_job.id, p_credential_id, v_source.adapter_key, v_ids);
    RETURN jsonb_build_object('job_id', v_job.id, 'result', 'merged', 'status', 'queued');
  END IF;

  SELECT * INTO v_job FROM public.permit_sync_jobs
  WHERE credential_id = p_credential_id AND status IN ('running', 'retry_wait', 'waiting_user') FOR UPDATE;
  IF FOUND THEN
    IF p_trigger = 'scheduled' THEN
      RETURN jsonb_build_object('job_id', v_job.id, 'result', 'skipped_busy', 'status', v_job.status);
    END IF;
    IF v_job.status = 'waiting_user' THEN
      RAISE EXCEPTION 'the source is waiting for the user (MFA or CAPTCHA); resume it first' USING ERRCODE = '55000';
    END IF;

    -- 2. A job in back-off is not running: widen it, reprocess what was asked for, and pull it forward.
    IF v_job.status = 'retry_wait' AND v_job.worker_mode = v_mode AND v_job.coalescible THEN
      v_scope := public._permit_sync_merge_scope(public._permit_sync_job_scope(v_job.options), v_ids);
      v_done := CASE WHEN v_ids IS NULL THEN '[]'::jsonb ELSE coalesce((
        SELECT jsonb_agg(d) FROM jsonb_array_elements(coalesce(v_job.checkpoint -> 'done', '[]'::jsonb)) d
        WHERE NOT ((d #>> '{}') = ANY (v_ids))), '[]'::jsonb) END;
      UPDATE public.permit_sync_jobs
      SET options = public._permit_sync_with_scope(options, v_scope),
          checkpoint = jsonb_set(checkpoint, '{done}', v_done),
          trigger = 'manual',
          max_attempts = GREATEST(max_attempts, v_max),
          next_attempt_at = CASE WHEN error_code = 'rate_limited' THEN next_attempt_at ELSE LEAST(next_attempt_at, now()) END,
          updated_at = now()
      WHERE id = v_job.id;
      INSERT INTO public.permit_sync_events (job_id, level, code, message, data)
      VALUES (v_job.id, 'info', 'coalesced', p_trigger, jsonb_build_object('into', 'retry_wait', 'requested', to_jsonb(v_ids), 'scope', to_jsonb(v_scope)));
      PERFORM public._permit_sync_seed_progress(v_job.id, p_credential_id, v_source.adapter_key, v_ids);
      RETURN jsonb_build_object('job_id', v_job.id, 'result', 'merged', 'status', 'retry_wait');
    END IF;

    -- 3. The running job will still reach every requested permit: nothing to add.
    v_pending := CASE WHEN v_ids IS NULL
      THEN jsonb_array_length(coalesce(v_job.checkpoint -> 'done', '[]'::jsonb)) = 0
      ELSE NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(v_job.checkpoint -> 'done', '[]'::jsonb)) d WHERE d = ANY (v_ids))
    END;
    IF v_job.status = 'running' AND v_job.worker_mode = v_mode AND v_job.coalescible AND v_pending
       AND (public._permit_sync_job_scope(v_job.options) IS NULL OR (v_ids IS NOT NULL AND v_ids <@ public._permit_sync_job_scope(v_job.options))) THEN
      RETURN jsonb_build_object('job_id', v_job.id, 'result', 'already_covered', 'status', 'running');
    END IF;
    v_result := 'queued_follow_up';
  END IF;

  -- 4. New job (alone, or the single follow-up behind the job in flight).
  INSERT INTO public.permit_sync_jobs (credential_id, adapter_key, trigger, requested_by, worker_mode, options, max_attempts, phase, coalescible)
  VALUES (p_credential_id, v_source.adapter_key, p_trigger, p_requested_by, v_mode,
          public._permit_sync_validate_options(public._permit_sync_with_scope(v_defaults, v_ids)), v_max, 'queued', true)
  RETURNING id INTO v_id;
  INSERT INTO public.permit_sync_events (job_id, level, code, message, data)
  VALUES (v_id, 'info', 'enqueued', p_trigger, jsonb_build_object('worker_mode', v_mode, 'requested', to_jsonb(v_ids), 'behind', CASE WHEN v_result = 'queued_follow_up' THEN v_job.id END));
  PERFORM public._permit_sync_seed_progress(v_id, p_credential_id, v_source.adapter_key, v_ids);
  RETURN jsonb_build_object('job_id', v_id, 'result', v_result, 'status', 'queued');
END;
$$;

-- Legacy entry point (admin_request_permit_sync / the schedule): now the same request path, every permit.
CREATE OR REPLACE FUNCTION public._permit_sync_enqueue(p_credential_id UUID, p_trigger TEXT, p_requested_by UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (public._permit_sync_request(p_credential_id, NULL, p_trigger, p_requested_by) ->> 'job_id')::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public._permit_sync_can_manage(p_user_id UUID, p_credential_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id IS NOT NULL AND (public.is_platform_admin(p_user_id) OR public.credential_has_grant(p_user_id, p_credential_id, 'manage'))
$$;

-- Refresh every permit of a source (p_permit_ids NULL) or the listed ones. Platform admins and users with a
-- 'manage' grant on the source credential.
CREATE OR REPLACE FUNCTION public.request_permit_sync_refresh(p_credential_id UUID, p_permit_ids UUID[] DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_adapter TEXT;
  v_ids TEXT[];
  v_out JSONB;
BEGIN
  IF NOT public._permit_sync_can_manage(v_uid, p_credential_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT adapter_key INTO v_adapter FROM public.permit_sync_sources WHERE credential_id = p_credential_id;
  IF v_adapter IS NULL THEN
    RAISE EXCEPTION 'no permit sync source for credential' USING ERRCODE = 'P0002';
  END IF;
  IF p_permit_ids IS NOT NULL THEN
    IF cardinality(p_permit_ids) NOT BETWEEN 1 AND 50 THEN
      RAISE EXCEPTION 'request 1 to 50 permits, or every permit' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(DISTINCT p.portal_record_id) INTO v_ids
    FROM public.permits p
    JOIN public.permit_source_links l ON l.permit_id = p.id AND l.credential_id = p_credential_id
    WHERE p.id = ANY (p_permit_ids) AND p.adapter_key = v_adapter;
    IF coalesce(cardinality(v_ids), 0) <> (SELECT count(DISTINCT x) FROM unnest(p_permit_ids) x) THEN
      RAISE EXCEPTION 'a requested permit is not seen by this source' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_out := public._permit_sync_request(p_credential_id, v_ids, 'manual', v_uid);
  PERFORM public._permit_audit('permit_sync.refresh_request', 'permit_sync_job', v_out ->> 'job_id', NULL,
    jsonb_build_object('credential_id', p_credential_id, 'permits', CASE WHEN v_ids IS NULL THEN 'all' ELSE to_jsonb(v_ids)::text END, 'result', v_out ->> 'result'));
  RETURN v_out || jsonb_build_object('credential_id', p_credential_id);
END;
$$;

-- Refresh one permit through the source that sees it and that the caller may manage.
CREATE OR REPLACE FUNCTION public.request_permit_refresh(p_permit_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cred UUID;
  v_blocked TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT l.credential_id INTO v_cred
  FROM public.permit_source_links l
  JOIN public.permit_sync_sources s ON s.credential_id = l.credential_id
  WHERE l.permit_id = p_permit_id
    AND s.status NOT IN ('needs_encryption', 'auth_failed', 'paused', 'waiting_user')
    AND public._permit_sync_can_manage(v_uid, l.credential_id)
  ORDER BY s.automation_enabled DESC, s.last_login_ok_at DESC NULLS LAST, l.last_seen_at DESC
  LIMIT 1;
  IF v_cred IS NULL THEN
    SELECT s.status INTO v_blocked
    FROM public.permit_source_links l JOIN public.permit_sync_sources s ON s.credential_id = l.credential_id
    WHERE l.permit_id = p_permit_id AND public._permit_sync_can_manage(v_uid, l.credential_id)
    LIMIT 1;
    IF v_blocked IS NOT NULL THEN
      RAISE EXCEPTION 'source status % does not allow runs', v_blocked USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN public.request_permit_sync_refresh(v_cred, ARRAY[p_permit_id]);
END;
$$;

-- Cancels a job. Platform admins and 'manage' grantees. A running worker sees its lease gone at the next
-- heartbeat and stops; files and reports already recorded are kept.
CREATE OR REPLACE FUNCTION public.cancel_permit_sync_job(p_job_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cred UUID;
BEGIN
  SELECT credential_id INTO v_cred FROM public.permit_sync_jobs WHERE id = p_job_id;
  IF v_cred IS NULL OR NOT public._permit_sync_can_manage(auth.uid(), v_cred) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.permit_sync_jobs
  SET status = 'cancelled', cancelled_by = auth.uid(), completed_at = now(),
      lease_worker_id = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_job_id AND status IN ('queued', 'running', 'retry_wait', 'waiting_user');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active job not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.permit_sync_events (job_id, level, code, message) VALUES (p_job_id, 'warn', 'cancelled', 'user');
  PERFORM public._permit_audit('permit_sync.cancel', 'permit_sync_job', p_job_id::text, NULL, NULL);
END;
$$;

-- Re-requests a finished job's permits (failed, cancelled or with warnings) through the request path.
CREATE OR REPLACE FUNCTION public.admin_retry_permit_sync_job(p_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.permit_sync_jobs%ROWTYPE;
  v_out JSONB;
BEGIN
  PERFORM public._admin_require_platform_admin();
  SELECT * INTO v_job FROM public.permit_sync_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.status NOT IN ('failed', 'failed_unrecoverable', 'cancelled', 'completed_with_warnings') THEN
    RAISE EXCEPTION 'only failed, cancelled or partial jobs can be retried' USING ERRCODE = '22023';
  END IF;
  v_out := public._permit_sync_request(v_job.credential_id, public._permit_sync_job_scope(v_job.options), 'manual', auth.uid());
  PERFORM public._permit_audit('permit_sync.retry', 'permit_sync_job', v_out ->> 'job_id', NULL,
    jsonb_build_object('retry_of', p_job_id, 'result', v_out ->> 'result'));
  RETURN v_out || jsonb_build_object('retry_of', p_job_id);
END;
$$;

-- Schedule, limits and enablement for a source. Settings keys not passed (NULL) are kept. Enabling goes
-- through admin_set_permit_sync_source (encryption and one-login checks). Nothing runs until the enqueue
-- cron job exists (scripts/permit-repo/scheduling/, approval A-4), and never for a time already passed.
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
  v_settings JSONB;
BEGIN
  PERFORM public._admin_require_platform_admin();
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
  WHERE credential_id = p_credential_id;
  PERFORM public._permit_audit('permit_sync_source.schedule', 'portal_credential', p_credential_id::text,
    jsonb_build_object('automation_enabled', v_source.automation_enabled, 'schedule', v_source.settings -> 'schedule'),
    jsonb_build_object('automation_enabled', p_enabled, 'schedule', v_settings -> 'schedule', 'deep_defaults', v_settings -> 'deep_defaults', 'max_attempts', v_settings -> 'max_attempts'));
  RETURN jsonb_build_object('automation_enabled', p_enabled,
    'next_run_at', CASE WHEN p_enabled THEN public._permit_sync_next_slot(v_settings -> 'schedule', now()) END);
END;
$$;

-- Called by the enqueue cron job (not created here). Each due source gets one request; the slot is
-- recorded whatever the result, so a busy source is not re-requested every tick.
CREATE OR REPLACE FUNCTION public.enqueue_permit_sync_runs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src RECORD;
  v_slot TIMESTAMPTZ;
  v_out JSONB;
  v_n INTEGER := 0;
BEGIN
  FOR v_src IN
    SELECT s.credential_id, s.settings, s.last_scheduled_at, s.schedule_enabled_at
    FROM public.permit_sync_sources s
    WHERE s.automation_enabled AND s.status = 'active'
    FOR UPDATE SKIP LOCKED
  LOOP
    v_slot := public._permit_sync_due_slot(v_src.settings -> 'schedule', v_src.last_scheduled_at, v_src.schedule_enabled_at, now());
    CONTINUE WHEN v_slot IS NULL;
    v_out := public._permit_sync_request(v_src.credential_id, NULL, 'scheduled', NULL);
    UPDATE public.permit_sync_sources
    SET last_scheduled_at = v_slot, last_schedule_result = v_out ->> 'result', updated_at = now()
    WHERE credential_id = v_src.credential_id;
    IF v_out ->> 'result' IN ('created', 'merged') THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Claim with the same-login lock; release without spending an attempt
-- ---------------------------------------------------------------------------

-- As 20261111120000, plus (D-095): claims are serialized; a job is not claimed while another job for the
-- same portal login (same jurisdiction and username, any source) holds a live lease; a queued follow-up
-- waits for its source's job in flight.
CREATE OR REPLACE FUNCTION public._permit_sync_claim(p_worker_id TEXT, p_lease_ttl_seconds INTEGER, p_worker_mode TEXT)
RETURNS public.permit_sync_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.permit_sync_jobs;
  v_ttl INTEGER := GREATEST(60, COALESCE(p_lease_ttl_seconds, 300));
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'worker_id required' USING ERRCODE = '22023';
  END IF;
  IF p_worker_mode IS NULL OR p_worker_mode NOT IN ('json', 'deep') THEN
    RAISE EXCEPTION 'unknown worker mode' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('permit_sync_claim'));

  UPDATE public.permit_sync_jobs j
  SET status = 'failed', error_code = 'lease_expired', completed_at = now(),
      last_error = coalesce(j.last_error, 'worker lease expired after final attempt'),
      lease_worker_id = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE j.status = 'running' AND j.lease_expires_at < now() AND j.attempt_count >= j.max_attempts
    AND j.worker_mode = p_worker_mode;

  SELECT j.* INTO v_job
  FROM public.permit_sync_jobs j
  JOIN public.permit_sync_sources s ON s.credential_id = j.credential_id
  JOIN public.portal_credentials c ON c.id = j.credential_id
  WHERE j.worker_mode = p_worker_mode
    AND (
      (j.status IN ('queued', 'retry_wait') AND j.next_attempt_at <= now())
      OR (j.status = 'running' AND j.lease_expires_at < now())
    )
    AND s.status NOT IN ('needs_encryption', 'auth_failed', 'paused', 'waiting_user')
    AND (j.trigger = 'manual' OR s.automation_enabled)
    AND NOT EXISTS (
      SELECT 1 FROM public.permit_sync_jobs k
      JOIN public.portal_credentials kc ON kc.id = k.credential_id
      WHERE k.id <> j.id AND k.status = 'running' AND k.lease_expires_at >= now()
        AND lower(kc.jurisdiction) = lower(c.jurisdiction)
        AND lower(trim(kc.portal_username)) = lower(trim(c.portal_username))
    )
    AND NOT (j.status = 'queued' AND EXISTS (
      SELECT 1 FROM public.permit_sync_jobs k
      WHERE k.credential_id = j.credential_id AND k.id <> j.id AND k.status IN ('running', 'retry_wait', 'waiting_user')
    ))
  ORDER BY (j.trigger = 'manual') DESC, j.next_attempt_at, j.created_at
  LIMIT 1
  FOR UPDATE OF j SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.permit_sync_jobs
  SET status = 'running',
      attempt_count = attempt_count + 1,
      lease_worker_id = p_worker_id,
      lease_expires_at = now() + make_interval(secs => v_ttl),
      lease_heartbeat_at = now(),
      started_at = coalesce(started_at, now()),
      phase = 'authenticating',
      updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  INSERT INTO public.permit_sync_events (job_id, level, code, message, data)
  VALUES (v_job.id, 'info', 'claimed', p_worker_id, jsonb_build_object('attempt', v_job.attempt_count, 'worker_mode', p_worker_mode));
  RETURN v_job;
END;
$$;

-- Graceful stop (worker shutdown or a deferral such as a manual scrape on the same login): the job goes
-- back to retry_wait with its checkpoint, the attempt is given back, and it is claimable after the delay.
CREATE OR REPLACE FUNCTION public.release_permit_sync_job(
  p_job_id UUID, p_worker_id TEXT, p_reason TEXT, p_checkpoint JSONB DEFAULT NULL, p_retry_after_seconds INTEGER DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.permit_sync_jobs;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('worker_shutdown', 'deferred_manual_scrape', 'deferred_login_busy') THEN
    RAISE EXCEPTION 'unknown release reason' USING ERRCODE = '22023';
  END IF;
  UPDATE public.permit_sync_jobs
  SET status = 'retry_wait',
      attempt_count = GREATEST(attempt_count - 1, 0),
      release_count = release_count + 1,
      next_attempt_at = now() + make_interval(secs => GREATEST(0, LEAST(COALESCE(p_retry_after_seconds, 30), 3600))),
      checkpoint = COALESCE(p_checkpoint, checkpoint),
      error_code = p_reason,
      phase = 'released',
      completed_at = NULL,
      lease_worker_id = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_job_id AND lease_worker_id = p_worker_id AND status = 'running'
  RETURNING * INTO v_job;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.permit_sync_events (job_id, level, code, message, data)
  VALUES (p_job_id, 'warn', 'released', p_reason, jsonb_build_object('release_count', v_job.release_count, 'next_attempt_at', v_job.next_attempt_at));
  RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Progress (D-096)
-- ---------------------------------------------------------------------------

-- Holder-checked. p_report: { phase?, current_portal_record_id?, permits?: [{ portal_record_id, phase, files_total,
-- files_captured, files_pending, files_failed, reports_total, reports_captured, reports_failed, error_code, message }] }.
-- Counts left out keep their stored value. Returns false when the caller no longer holds the lease.
CREATE OR REPLACE FUNCTION public.report_permit_sync_progress(p_job_id UUID, p_worker_id TEXT, p_report JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.permit_sync_jobs;
  v_row JSONB;
  v_id TEXT;
  v_phase TEXT;
  v_int CONSTANT TEXT[] := ARRAY['files_total', 'files_captured', 'files_pending', 'files_failed', 'reports_total', 'reports_captured', 'reports_failed'];
  k TEXT;
BEGIN
  SELECT * INTO v_job FROM public.permit_sync_jobs WHERE id = p_job_id AND lease_worker_id = p_worker_id AND status = 'running';
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  IF p_report IS NULL OR jsonb_typeof(p_report) <> 'object' THEN
    RAISE EXCEPTION 'report must be an object' USING ERRCODE = '22023';
  END IF;
  IF p_report ? 'phase' OR p_report ? 'current_portal_record_id' THEN
    UPDATE public.permit_sync_jobs
    SET phase = coalesce(p_report ->> 'phase', phase),
        progress = jsonb_set(progress, '{current_portal_record_id}', coalesce(p_report -> 'current_portal_record_id', progress -> 'current_portal_record_id', 'null'::jsonb)),
        updated_at = now()
    WHERE id = p_job_id;
  END IF;
  IF jsonb_typeof(p_report -> 'permits') = 'array' THEN
    IF jsonb_array_length(p_report -> 'permits') > 200 THEN
      RAISE EXCEPTION 'at most 200 permits per report' USING ERRCODE = '22023';
    END IF;
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_report -> 'permits') LOOP
      v_id := v_row ->> 'portal_record_id';
      v_phase := v_row ->> 'phase';
      IF v_id IS NULL OR v_id !~ '^[0-9A-Za-z_-]{1,64}$' THEN
        RAISE EXCEPTION 'invalid portal_record_id' USING ERRCODE = '22023';
      END IF;
      FOREACH k IN ARRAY v_int LOOP
        IF v_row ? k AND jsonb_typeof(v_row -> k) <> 'null' AND (jsonb_typeof(v_row -> k) <> 'number' OR (v_row ->> k)::numeric < 0) THEN
          RAISE EXCEPTION '% must be a non-negative number', k USING ERRCODE = '22023';
        END IF;
      END LOOP;
      INSERT INTO public.permit_sync_job_permits AS r (
        job_id, portal_record_id, permit_id, phase, files_total, files_captured, files_pending, files_failed,
        reports_total, reports_captured, reports_failed, error_code, message, started_at, finished_at)
      VALUES (
        p_job_id, v_id,
        (SELECT p.id FROM public.permits p WHERE p.adapter_key = v_job.adapter_key AND p.portal_record_id = v_id),
        coalesce(v_phase, 'queued'),
        (v_row ->> 'files_total')::int, (v_row ->> 'files_captured')::int, (v_row ->> 'files_pending')::int, (v_row ->> 'files_failed')::int,
        (v_row ->> 'reports_total')::int, (v_row ->> 'reports_captured')::int, (v_row ->> 'reports_failed')::int,
        left(v_row ->> 'error_code', 64), left(v_row ->> 'message', 300),
        CASE WHEN coalesce(v_phase, 'queued') <> 'queued' THEN now() END,
        CASE WHEN public._permit_sync_terminal_phase(v_phase) THEN now() END)
      ON CONFLICT (job_id, portal_record_id) DO UPDATE SET
        permit_id = coalesce(r.permit_id, EXCLUDED.permit_id),
        phase = coalesce(v_phase, r.phase),
        files_total = coalesce(EXCLUDED.files_total, r.files_total),
        files_captured = coalesce(EXCLUDED.files_captured, r.files_captured),
        files_pending = coalesce(EXCLUDED.files_pending, r.files_pending),
        files_failed = coalesce(EXCLUDED.files_failed, r.files_failed),
        reports_total = coalesce(EXCLUDED.reports_total, r.reports_total),
        reports_captured = coalesce(EXCLUDED.reports_captured, r.reports_captured),
        reports_failed = coalesce(EXCLUDED.reports_failed, r.reports_failed),
        error_code = CASE WHEN v_row ? 'error_code' THEN EXCLUDED.error_code ELSE r.error_code END,
        message = CASE WHEN v_row ? 'message' THEN EXCLUDED.message ELSE r.message END,
        started_at = coalesce(r.started_at, EXCLUDED.started_at),
        finished_at = CASE WHEN public._permit_sync_terminal_phase(coalesce(v_phase, r.phase)) THEN coalesce(EXCLUDED.finished_at, r.finished_at, now()) ELSE NULL END,
        updated_at = now();
    END LOOP;
  END IF;
  RETURN TRUE;
END;
$$;

-- Job status changes settle progress rows that are still open: retry_wait -> retrying, claimed again ->
-- queued, cancelled -> cancelled, failed -> failed, finished -> skipped (requested but not processed).
CREATE OR REPLACE FUNCTION public._permit_sync_job_status_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  UPDATE public.permit_sync_job_permits r
  SET phase = CASE NEW.status
        WHEN 'retry_wait' THEN 'retrying'
        WHEN 'running' THEN 'queued'
        WHEN 'cancelled' THEN 'cancelled'
        WHEN 'failed' THEN 'failed'
        WHEN 'failed_unrecoverable' THEN 'failed'
        WHEN 'waiting_user' THEN 'retrying'
        ELSE 'skipped' END,
      error_code = CASE WHEN NEW.status IN ('failed', 'failed_unrecoverable', 'retry_wait', 'waiting_user') THEN coalesce(NEW.error_code, r.error_code) ELSE r.error_code END,
      finished_at = CASE WHEN NEW.status IN ('cancelled', 'failed', 'failed_unrecoverable', 'completed', 'completed_with_warnings') THEN now() ELSE NULL END,
      updated_at = now()
  WHERE r.job_id = NEW.id
    AND NOT public._permit_sync_terminal_phase(r.phase)
    AND (NEW.status <> 'running' OR r.phase = 'retrying');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS permit_sync_jobs_status_progress ON public.permit_sync_jobs;
CREATE TRIGGER permit_sync_jobs_status_progress
AFTER UPDATE OF status ON public.permit_sync_jobs
FOR EACH ROW EXECUTE FUNCTION public._permit_sync_job_status_progress();

-- Latest progress per permit for the Permit Queue (only permits the caller can read). The open row of a
-- job in flight wins over a queued follow-up, which wins over the latest finished row.
CREATE OR REPLACE FUNCTION public.get_permit_sync_progress(p_permit_ids UUID[])
RETURNS TABLE (
  permit_id UUID, job_id UUID, job_status TEXT, job_trigger TEXT, phase TEXT,
  files_total INTEGER, files_captured INTEGER, files_pending INTEGER, files_failed INTEGER,
  reports_total INTEGER, reports_captured INTEGER, reports_failed INTEGER,
  error_code TEXT, message TEXT, started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ, last_success_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_permit_ids IS NULL OR cardinality(p_permit_ids) > 500 THEN
    RAISE EXCEPTION 'pass 1 to 500 permit ids' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH ids AS (
    SELECT DISTINCT x AS id FROM unnest(p_permit_ids) x WHERE public.can_read_permit(x)
  ), ranked AS (
    SELECT r.*, j.status AS j_status, j.trigger AS j_trigger, j.next_attempt_at AS j_next,
      row_number() OVER (PARTITION BY r.permit_id ORDER BY
        CASE WHEN r.phase IN ('authenticating', 'reading_info', 'capturing_reviews', 'downloading_files', 'exporting_reports', 'retrying') THEN 0
             WHEN r.phase = 'queued' THEN 1 ELSE 2 END,
        r.updated_at DESC) AS rn
    FROM public.permit_sync_job_permits r
    JOIN public.permit_sync_jobs j ON j.id = r.job_id
    WHERE r.permit_id IN (SELECT id FROM ids)
  ), success AS (
    SELECT r.permit_id, max(r.finished_at) AS at
    FROM public.permit_sync_job_permits r
    WHERE r.permit_id IN (SELECT id FROM ids) AND r.phase IN ('completed', 'completed_with_warnings')
    GROUP BY r.permit_id
  )
  SELECT i.id, k.job_id, k.j_status, k.j_trigger, k.phase,
    k.files_total, k.files_captured, k.files_pending, k.files_failed,
    k.reports_total, k.reports_captured, k.reports_failed,
    k.error_code, k.message, k.started_at, k.finished_at, k.updated_at,
    CASE WHEN k.j_status IN ('queued', 'retry_wait') THEN k.j_next END,
    GREATEST(s.at, ds.completed_at)
  FROM ids i
  LEFT JOIN ranked k ON k.permit_id = i.id AND k.rn = 1
  LEFT JOIN success s ON s.permit_id = i.id
  LEFT JOIN public.permit_deep_state ds ON ds.permit_id = i.id;
END;
$$;

CREATE OR REPLACE FUNCTION public._permit_sync_job_summary(p_job public.permit_sync_jobs)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN CASE WHEN p_job.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', p_job.id, 'status', p_job.status, 'phase', p_job.phase, 'trigger', p_job.trigger,
    'attempt_count', p_job.attempt_count, 'max_attempts', p_job.max_attempts,
    'created_at', p_job.created_at, 'started_at', p_job.started_at, 'completed_at', p_job.completed_at,
    'next_attempt_at', p_job.next_attempt_at, 'error_code', p_job.error_code,
    'scope', CASE WHEN public._permit_sync_job_scope(p_job.options) IS NULL THEN 'all' ELSE 'permits' END,
    'current_portal_record_id', p_job.progress -> 'current_portal_record_id',
    'current_permit_number', (SELECT p.permit_number FROM public.permits p
                              WHERE p.adapter_key = p_job.adapter_key AND p.portal_record_id = p_job.progress ->> 'current_portal_record_id'),
    'permits_total', (SELECT count(*) FROM public.permit_sync_job_permits r WHERE r.job_id = p_job.id),
    'permits_done', (SELECT count(*) FROM public.permit_sync_job_permits r WHERE r.job_id = p_job.id AND r.phase IN ('completed', 'completed_with_warnings')),
    'permits_with_warnings', (SELECT count(*) FROM public.permit_sync_job_permits r WHERE r.job_id = p_job.id AND r.phase = 'completed_with_warnings'),
    'permits_failed', (SELECT count(*) FROM public.permit_sync_job_permits r WHERE r.job_id = p_job.id AND r.phase IN ('failed', 'cancelled', 'skipped')),
    'files_captured', (SELECT coalesce(sum(r.files_captured), 0) FROM public.permit_sync_job_permits r WHERE r.job_id = p_job.id),
    'files_total', (SELECT coalesce(sum(r.files_total), 0) FROM public.permit_sync_job_permits r WHERE r.job_id = p_job.id),
    'reports_captured', (SELECT coalesce(sum(r.reports_captured), 0) FROM public.permit_sync_job_permits r WHERE r.job_id = p_job.id),
    'reports_total', (SELECT coalesce(sum(r.reports_total), 0) FROM public.permit_sync_job_permits r WHERE r.job_id = p_job.id)
  ) END;
END;
$$;

-- Sources the caller can see (platform admin, or a 'use' grant) with counts, schedule and the job in
-- flight / queued / last finished. No usernames or credential secrets.
CREATE OR REPLACE FUNCTION public.get_permit_sync_overview()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'credential_id', s.credential_id,
      'adapter_key', s.adapter_key,
      'jurisdiction', c.jurisdiction,
      'status', s.status,
      'automation_enabled', s.automation_enabled,
      'can_refresh', public._permit_sync_can_manage(v_uid, s.credential_id),
      'permit_count', (SELECT count(*) FROM public.permit_source_links l JOIN public.permits p ON p.id = l.permit_id
                       WHERE l.credential_id = s.credential_id AND p.removed_from_portal_at IS NULL),
      'schedule', s.settings -> 'schedule',
      'next_run_at', CASE WHEN s.automation_enabled AND s.status = 'active'
                       THEN public._permit_sync_next_slot(s.settings -> 'schedule', GREATEST(now(), coalesce(s.last_scheduled_at, now()))) END,
      'last_scheduled_at', s.last_scheduled_at,
      'last_success_at', (SELECT max(j.completed_at) FROM public.permit_sync_jobs j
                          WHERE j.credential_id = s.credential_id AND j.status IN ('completed', 'completed_with_warnings')),
      'active_job', (SELECT public._permit_sync_job_summary(j) FROM public.permit_sync_jobs j
                     WHERE j.credential_id = s.credential_id AND j.status IN ('running', 'retry_wait', 'waiting_user') LIMIT 1),
      'queued_job', (SELECT public._permit_sync_job_summary(j) FROM public.permit_sync_jobs j
                     WHERE j.credential_id = s.credential_id AND j.status = 'queued' LIMIT 1),
      'last_job', (SELECT public._permit_sync_job_summary(j) FROM public.permit_sync_jobs j
                   WHERE j.credential_id = s.credential_id AND j.completed_at IS NOT NULL
                     AND j.status IN ('completed', 'completed_with_warnings', 'failed', 'failed_unrecoverable', 'cancelled')
                   ORDER BY j.completed_at DESC LIMIT 1)
    ) ORDER BY c.jurisdiction, s.created_at)
    FROM public.permit_sync_sources s
    JOIN public.portal_credentials c ON c.id = s.credential_id
    WHERE public.is_platform_admin(v_uid) OR public.credential_has_grant(v_uid, s.credential_id, 'use')
  ), '[]'::jsonb);
END;
$$;

-- One job with its per-permit rows (batch progress). Platform admins and 'use' grantees of the source.
CREATE OR REPLACE FUNCTION public.get_permit_sync_job_progress(p_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_job public.permit_sync_jobs;
BEGIN
  SELECT * INTO v_job FROM public.permit_sync_jobs WHERE id = p_job_id;
  IF v_uid IS NULL OR v_job.id IS NULL
     OR NOT (public.is_platform_admin(v_uid) OR public.credential_has_grant(v_uid, v_job.credential_id, 'use')) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN public._permit_sync_job_summary(v_job) || jsonb_build_object('permits', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'portal_record_id', r.portal_record_id, 'permit_id', r.permit_id, 'permit_number', p.permit_number,
      'phase', r.phase, 'files_total', r.files_total, 'files_captured', r.files_captured, 'files_pending', r.files_pending,
      'files_failed', r.files_failed, 'reports_total', r.reports_total, 'reports_captured', r.reports_captured,
      'reports_failed', r.reports_failed, 'error_code', r.error_code, 'message', r.message,
      'started_at', r.started_at, 'finished_at', r.finished_at, 'updated_at', r.updated_at
    ) ORDER BY r.started_at NULLS LAST, p.permit_number)
    FROM public.permit_sync_job_permits r LEFT JOIN public.permits p ON p.id = r.permit_id
    WHERE r.job_id = p_job_id
  ), '[]'::jsonb));
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Worker heartbeat (D-097)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.permit_sync_worker_heartbeat(p_worker_id TEXT, p_mode TEXT, p_status TEXT, p_job_id UUID DEFAULT NULL, p_details JSONB DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_worker_id IS NULL OR length(p_worker_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'worker_id required' USING ERRCODE = '22023';
  END IF;
  IF p_details IS NOT NULL AND length(p_details::text) > 4000 THEN
    RAISE EXCEPTION 'details too large' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.permit_sync_workers AS w (worker_id, mode, status, current_job_id, details, started_at, last_seen_at)
  VALUES (p_worker_id, p_mode, p_status, p_job_id, coalesce(p_details, '{}'::jsonb), now(), now())
  ON CONFLICT (worker_id) DO UPDATE SET
    mode = EXCLUDED.mode, status = EXCLUDED.status, current_job_id = EXCLUDED.current_job_id,
    details = EXCLUDED.details, last_seen_at = now();
  -- Rows of processes gone for a week are not useful to anyone.
  DELETE FROM public.permit_sync_workers WHERE last_seen_at < now() - interval '7 days';
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Runtime monitor (D-099). Runs in the database on its own cron job, so a dead worker cannot silence it.
-- Alert text carries codes, counts, the jurisdiction and permit numbers only: no usernames, portal text,
-- URLs, comments or file names.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.permit_sync_monitor()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_keys TEXT[] := ARRAY[]::text[];
  v_raised INTEGER := 0;
  v_resolved INTEGER := 0;
  v_a RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('permit_sync_monitor'));
  FOR v_a IN
    WITH jobs AS (
      SELECT j.*, c.jurisdiction FROM public.permit_sync_jobs j JOIN public.portal_credentials c ON c.id = j.credential_id
    ), live_workers AS (
      SELECT count(*) AS n FROM public.permit_sync_workers w
      WHERE w.mode = 'deep' AND w.status <> 'stopped' AND w.last_seen_at > v_now - interval '5 minutes'
    ), finished AS (
      SELECT j.*, row_number() OVER (PARTITION BY j.credential_id ORDER BY j.completed_at DESC) AS rn
      FROM jobs j WHERE j.completed_at IS NOT NULL AND j.status IN ('completed', 'completed_with_warnings', 'failed', 'failed_unrecoverable')
    ), full_runs AS (
      SELECT j.*, row_number() OVER (PARTITION BY j.credential_id ORDER BY j.completed_at DESC) AS rn
      FROM jobs j WHERE j.status IN ('completed', 'completed_with_warnings') AND public._permit_sync_job_scope(j.options) IS NULL
        AND (j.metrics ->> 'discovered') IS NOT NULL
    ), recent_permit_rows AS (
      SELECT x.permit_id, x.phase, row_number() OVER (PARTITION BY x.permit_id ORDER BY x.finished_at DESC) AS rn
      FROM public.permit_sync_job_permits x
      WHERE x.permit_id IS NOT NULL AND x.finished_at > v_now - interval '7 days' AND x.phase IN ('completed', 'completed_with_warnings', 'failed')
    )
    -- worker offline: deep work is due (or a schedule is on) and no deep worker reported in 5 minutes
    SELECT 'worker_offline:deep' AS key, 'worker_offline' AS category, 'critical' AS severity, NULL::uuid AS credential_id, NULL::uuid AS job_id, NULL::uuid AS permit_id,
           'No deep permit-sync worker is reporting' AS title,
           'No deep worker heartbeat in the last 5 minutes while deep work is due or a schedule is enabled.' AS detail, '{}'::jsonb AS data
    WHERE (SELECT n FROM live_workers) = 0
      AND (EXISTS (SELECT 1 FROM jobs j WHERE j.worker_mode = 'deep' AND j.status IN ('queued', 'retry_wait') AND j.next_attempt_at < v_now - interval '5 minutes')
           OR EXISTS (SELECT 1 FROM public.permit_sync_sources s WHERE s.automation_enabled AND s.status = 'active'))
    UNION ALL
    -- stuck job: running with an expired lease, or no heartbeat for 15 minutes
    SELECT 'job_stuck:' || j.id, 'job_stuck', 'critical', j.credential_id, j.id, NULL,
           'Permit sync job is not making progress',
           format('Job %s (%s) is running but its lease %s.', left(j.id::text, 8), j.jurisdiction,
                  CASE WHEN j.lease_expires_at < v_now THEN 'expired at ' || to_char(j.lease_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
                       ELSE 'has not been renewed for 15 minutes' END), jsonb_build_object('phase', j.phase)
    FROM jobs j
    WHERE j.status = 'running' AND (j.lease_expires_at < v_now - interval '2 minutes' OR j.lease_heartbeat_at < v_now - interval '15 minutes')
    UNION ALL
    -- queued but never claimed (while not legitimately waiting behind a running job on the same login)
    SELECT 'queued_unclaimed:' || j.id, 'queued_unclaimed', 'warning', j.credential_id, j.id, NULL,
           'Permit sync job queued but not claimed',
           format('Job %s (%s, %s) has been due since %s UTC and no worker has claimed it.', left(j.id::text, 8), j.jurisdiction, j.trigger,
                  to_char(j.next_attempt_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')), '{}'::jsonb
    FROM jobs j
    JOIN public.permit_sync_sources s ON s.credential_id = j.credential_id
    WHERE j.status IN ('queued', 'retry_wait') AND j.next_attempt_at < v_now - interval '15 minutes'
      AND s.status NOT IN ('needs_encryption', 'auth_failed', 'paused', 'waiting_user')
      AND NOT EXISTS (SELECT 1 FROM public.permit_sync_jobs k WHERE k.credential_id = j.credential_id AND k.id <> j.id AND k.status = 'running')
    UNION ALL
    -- login failures and sources waiting for the user
    SELECT 'login_failure:' || s.credential_id, 'login_failure', CASE WHEN s.status = 'auth_failed' THEN 'critical' ELSE 'warning' END, s.credential_id, NULL, NULL,
           CASE WHEN s.status = 'waiting_user' THEN 'Portal login needs the user (MFA or CAPTCHA)' ELSE 'Portal login is failing' END,
           format('%s source: status %s, %s consecutive login failure(s).', c.jurisdiction, s.status, s.consecutive_auth_failures), '{}'::jsonb
    FROM public.permit_sync_sources s JOIN public.portal_credentials c ON c.id = s.credential_id
    WHERE s.status IN ('auth_failed', 'waiting_user') OR s.consecutive_auth_failures >= 1
    UNION ALL
    -- portal layout / API change, or a guard refusal, in the last 24 hours
    SELECT DISTINCT ON (j.credential_id, cat) cat || ':' || j.credential_id, cat, 'critical', j.credential_id, j.id, NULL,
           CASE cat WHEN 'portal_changed' THEN 'Portal response not recognised' ELSE 'Read-only guard refused a request' END,
           format('%s: job %s ended with %s.', j.jurisdiction, left(j.id::text, 8), j.error_code), '{}'::jsonb
    FROM (SELECT j.*, CASE j.error_code WHEN 'portal_changed' THEN 'portal_changed' ELSE 'guard_violation' END AS cat FROM jobs j
          WHERE j.completed_at > v_now - interval '24 hours' AND j.error_code IN ('portal_changed', 'safety_violation')) j
    UNION ALL
    SELECT 'guard_denied:' || j.credential_id, 'guard_violation', 'warning', j.credential_id, max(j.id::text)::uuid, NULL,
           'Read-only guard refused report requests',
           format('%s: %s guard refusal(s) in the last 24 hours; the run continued without them.', min(j.jurisdiction), count(*)), '{}'::jsonb
    FROM public.permit_sync_events e JOIN jobs j ON j.id = e.job_id
    WHERE e.code = 'guard_denied' AND e.created_at > v_now - interval '24 hours'
    GROUP BY j.credential_id
    UNION ALL
    -- retries exhausted (other terminal failures than login, portal change and guard)
    SELECT 'retry_exhausted:' || j.id, 'retry_exhausted', 'critical', j.credential_id, j.id, NULL,
           'Permit sync job failed after its retries',
           format('%s: job %s ended %s (%s) after %s attempt(s).', j.jurisdiction, left(j.id::text, 8), j.status, coalesce(j.error_code, 'error'), j.attempt_count), '{}'::jsonb
    FROM jobs j
    WHERE j.completed_at > v_now - interval '24 hours' AND j.status IN ('failed', 'failed_unrecoverable')
      AND coalesce(j.error_code, '') NOT IN ('portal_changed', 'safety_violation', 'auth_failed')
    UNION ALL
    -- excessive failures in the latest finished run of a source
    SELECT 'excessive_failures:' || f.credential_id, 'excessive_failures', 'warning', f.credential_id, f.id, NULL,
           'Many permits, files or reports failed in the last run',
           format('%s: job %s: %s permit(s), %s file(s), %s report(s) failed.', f.jurisdiction, left(f.id::text, 8),
                  coalesce(f.metrics ->> 'permits_failed', '0'), coalesce(f.metrics -> 'deep' ->> 'files_failed', '0'), coalesce(f.metrics -> 'deep' ->> 'reports_failed', '0')), '{}'::jsonb
    FROM finished f
    WHERE f.rn = 1 AND f.completed_at > v_now - interval '48 hours'
      AND (coalesce((f.metrics ->> 'permits_failed')::int, 0) >= 3
           OR coalesce((f.metrics -> 'deep' ->> 'files_failed')::int, 0) >= 10
           OR coalesce((f.metrics -> 'deep' ->> 'reports_failed')::int, 0) >= 5)
    UNION ALL
    -- persistent partial capture: a permit's last three finished rows (7 days) all partial or failed
    SELECT 'persistent_partial:' || x.permit_id, 'persistent_partial', 'warning', NULL, NULL, x.permit_id,
           'Permit keeps finishing with outstanding items',
           format('Permit %s: the last 3 refreshes ended with outstanding files or reports.', coalesce(p.permit_number, p.portal_record_id)), '{}'::jsonb
    FROM (SELECT permit_id FROM recent_permit_rows WHERE rn <= 3 GROUP BY permit_id
          HAVING count(*) = 3 AND bool_and(phase <> 'completed')) x
    JOIN public.permits p ON p.id = x.permit_id
    UNION ALL
    -- no successful refresh in 36 hours for a scheduled source
    SELECT 'no_recent_success:' || s.credential_id, 'no_recent_success', 'warning', s.credential_id, NULL, NULL,
           'No successful refresh recently',
           format('%s: no completed run since %s.', c.jurisdiction,
                  coalesce(to_char((SELECT max(j.completed_at) FROM public.permit_sync_jobs j WHERE j.credential_id = s.credential_id
                                    AND j.status IN ('completed', 'completed_with_warnings')) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', 'the schedule was enabled')), '{}'::jsonb
    FROM public.permit_sync_sources s JOIN public.portal_credentials c ON c.id = s.credential_id
    WHERE s.automation_enabled AND s.schedule_enabled_at < v_now - interval '36 hours'
      AND NOT EXISTS (SELECT 1 FROM public.permit_sync_jobs j WHERE j.credential_id = s.credential_id
                      AND j.status IN ('completed', 'completed_with_warnings') AND j.completed_at > v_now - interval '36 hours')
    UNION ALL
    -- discovery count dropped between the last two all-permit runs
    SELECT 'discovery_drop:' || a.credential_id, 'discovery_drop', 'warning', a.credential_id, a.id, NULL,
           'Fewer permits discovered than in the previous run',
           format('%s: %s permit(s) discovered, %s in the previous full run.', a.jurisdiction, a.metrics ->> 'discovered', b.metrics ->> 'discovered'), '{}'::jsonb
    FROM full_runs a JOIN full_runs b ON b.credential_id = a.credential_id AND b.rn = 2
    WHERE a.rn = 1 AND (a.metrics ->> 'discovered')::int < (b.metrics ->> 'discovered')::int
      AND ((b.metrics ->> 'discovered')::int - (a.metrics ->> 'discovered')::int >= 3
           OR (a.metrics ->> 'discovered')::int < 0.9 * (b.metrics ->> 'discovered')::int)
    UNION ALL
    -- schedule due for over an hour but not enqueued (the enqueue cron job is missing or failing)
    SELECT 'schedule_missed:' || s.credential_id, 'schedule_missed', 'warning', s.credential_id, NULL, NULL,
           'Scheduled refresh was not enqueued',
           format('%s: the run scheduled for %s UTC was not enqueued.', c.jurisdiction,
                  to_char(public._permit_sync_due_slot(s.settings -> 'schedule', s.last_scheduled_at, s.schedule_enabled_at, v_now) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')), '{}'::jsonb
    FROM public.permit_sync_sources s JOIN public.portal_credentials c ON c.id = s.credential_id
    WHERE s.automation_enabled AND s.status = 'active'
      AND public._permit_sync_due_slot(s.settings -> 'schedule', s.last_scheduled_at, s.schedule_enabled_at, v_now) < v_now - interval '1 hour'
    UNION ALL
    -- missing deep content: a deep run finished without any deep pass, or a permit marked fully captured
    -- still has files or reports open that existed before that refresh
    SELECT 'missing_deep_content:' || f.id, 'missing_deep_content', 'warning', f.credential_id, f.id, NULL,
           'Deep run finished without a deep pass',
           format('%s: job %s processed %s permit(s) but recorded no deep pass.', f.jurisdiction, left(f.id::text, 8), coalesce(f.metrics ->> 'permits_ok', '0')), '{}'::jsonb
    FROM finished f
    WHERE f.rn = 1 AND f.worker_mode = 'deep' AND f.status IN ('completed', 'completed_with_warnings')
      AND coalesce((f.metrics ->> 'permits_ok')::int, 0) > 0
      AND coalesce((f.metrics -> 'deep' ->> 'deep_passes')::int, 0) + coalesce((f.metrics -> 'deep' ->> 'deep_skipped')::int, 0) = 0
    UNION ALL
    SELECT 'missing_deep_content:permit:' || x.permit_id, 'missing_deep_content', 'warning', NULL, x.job_id, x.permit_id,
           'Permit marked complete has open files or reports',
           format('Permit %s: marked complete, but %s file(s) and %s report(s) seen before that refresh are not captured.',
                  coalesce(p.permit_number, p.portal_record_id), x.open_docs, x.open_reports), '{}'::jsonb
    FROM (
      SELECT r.permit_id, r.job_id,
        (SELECT count(*) FROM public.permit_documents d WHERE d.permit_id = r.permit_id AND d.removed_at IS NULL
           AND d.download_permitted IS TRUE AND d.download_status IN ('not_requested', 'pending', 'failed') AND d.created_at < r.started_at) AS open_docs,
        (SELECT count(*) FROM public.permit_reports pr WHERE pr.permit_id = r.permit_id AND pr.removed_at IS NULL
           AND pr.content_status <> 'captured' AND pr.created_at < r.started_at) AS open_reports
      FROM (SELECT DISTINCT ON (x.permit_id) x.* FROM public.permit_sync_job_permits x
            WHERE x.permit_id IS NOT NULL AND x.finished_at IS NOT NULL AND x.phase IN ('completed', 'completed_with_warnings', 'failed')
            ORDER BY x.permit_id, x.finished_at DESC) r
      WHERE r.phase = 'completed'
    ) x JOIN public.permits p ON p.id = x.permit_id
    WHERE x.open_docs + x.open_reports > 0
  LOOP
    v_keys := v_keys || v_a.key;
    INSERT INTO public.permit_sync_alerts AS a (alert_key, category, severity, credential_id, job_id, permit_id, title, detail, data)
    VALUES (v_a.key, v_a.category, v_a.severity, v_a.credential_id, v_a.job_id, v_a.permit_id, v_a.title, v_a.detail, v_a.data)
    ON CONFLICT (alert_key) WHERE resolved_at IS NULL DO UPDATE SET
      severity = EXCLUDED.severity, job_id = coalesce(EXCLUDED.job_id, a.job_id), title = EXCLUDED.title, detail = EXCLUDED.detail,
      data = EXCLUDED.data, occurrences = a.occurrences + 1, last_seen_at = v_now;
    v_raised := v_raised + 1;
  END LOOP;

  UPDATE public.permit_sync_alerts SET resolved_at = v_now
  WHERE resolved_at IS NULL AND NOT (alert_key = ANY (v_keys));
  GET DIAGNOSTICS v_resolved = ROW_COUNT;
  RETURN jsonb_build_object('open', v_raised, 'resolved', v_resolved, 'checked_at', v_now);
END;
$$;

-- The notifier Edge Function marks what it sent: kind 'open' (new or daily reminder) or 'resolved'.
CREATE OR REPLACE FUNCTION public.mark_permit_sync_alerts_notified(p_ids UUID[], p_kind TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  IF p_kind = 'open' THEN
    UPDATE public.permit_sync_alerts SET notified_at = now(), notify_count = notify_count + 1 WHERE id = ANY (p_ids);
  ELSIF p_kind = 'resolved' THEN
    UPDATE public.permit_sync_alerts SET resolution_notified_at = now() WHERE id = ANY (p_ids) AND resolved_at IS NOT NULL;
  ELSE
    RAISE EXCEPTION 'kind must be open or resolved' USING ERRCODE = '22023';
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- pg_cron target for the notifier (same Vault secrets as invoke_supabase_analyzer_processor). Not scheduled here.
CREATE OR REPLACE FUNCTION public.invoke_permit_sync_alert_notifier()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  SELECT nullif(decrypted_secret, '') INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_project_url' LIMIT 1;
  SELECT nullif(decrypted_secret, '') INTO v_key FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'permit sync alert notifier skipped: required Vault secrets are absent';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/permit-sync-alert-notifier',
    body := jsonb_build_object('source', 'pg_cron', 'invoked_at', now()),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key)
  );
END;
$$;

-- Scheduler state for Management Admin: whether the cron jobs exist, without needing cron privileges.
CREATE OR REPLACE FUNCTION public.admin_permit_sync_scheduler_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jobs JSONB := '[]'::jsonb;
BEGIN
  PERFORM public._admin_require_platform_admin();
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT coalesce(jsonb_agg(jsonb_build_object('name', jobname, 'schedule', schedule, 'active', active)), '[]'::jsonb)
               FROM cron.job WHERE jobname IN ('permit-sync-enqueue', 'permit-sync-monitor', 'permit-sync-alert-notifier')$q$ INTO v_jobs;
  END IF;
  RETURN jsonb_build_object(
    'cron_available', to_regclass('cron.job') IS NOT NULL,
    'cron_jobs', v_jobs,
    'workers', coalesce((SELECT jsonb_agg(jsonb_build_object('worker_id', w.worker_id, 'mode', w.mode, 'status', w.status,
                 'current_job_id', w.current_job_id, 'started_at', w.started_at, 'last_seen_at', w.last_seen_at, 'details', w.details)
                 ORDER BY w.last_seen_at DESC) FROM public.permit_sync_workers w WHERE w.last_seen_at > now() - interval '1 day'), '[]'::jsonb),
    'open_alerts', (SELECT count(*) FROM public.permit_sync_alerts WHERE resolved_at IS NULL)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Function privileges
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public._permit_sync_terminal_phase(text)',
    'public._permit_sync_merge_scope(text[], text[])',
    'public._permit_sync_job_scope(jsonb)',
    'public._permit_sync_with_scope(jsonb, text[])',
    'public._permit_sync_validate_settings(jsonb)',
    'public._permit_sync_slot(jsonb, date)',
    'public._permit_sync_due_slot(jsonb, timestamptz, timestamptz, timestamptz)',
    'public._permit_sync_next_slot(jsonb, timestamptz)',
    'public._permit_sync_seed_progress(uuid, uuid, text, text[])',
    'public._permit_sync_request(uuid, text[], text, uuid)',
    'public._permit_sync_enqueue(uuid, text, uuid)',
    'public._permit_sync_can_manage(uuid, uuid)',
    'public._permit_sync_claim(text, integer, text)',
    'public._permit_sync_job_status_progress()',
    'public._permit_sync_job_summary(public.permit_sync_jobs)',
    'public.enqueue_permit_sync_runs()',
    'public.release_permit_sync_job(uuid, text, text, jsonb, integer)',
    'public.report_permit_sync_progress(uuid, text, jsonb)',
    'public.permit_sync_worker_heartbeat(text, text, text, uuid, jsonb)',
    'public.permit_sync_monitor()',
    'public.mark_permit_sync_alerts_notified(uuid[], text)',
    'public.invoke_permit_sync_alert_notifier()',
    'public.request_permit_sync_refresh(uuid, uuid[])',
    'public.request_permit_refresh(uuid)',
    'public.cancel_permit_sync_job(uuid)',
    'public.admin_retry_permit_sync_job(uuid)',
    'public.admin_set_permit_sync_schedule(uuid, boolean, jsonb, jsonb, integer)',
    'public.get_permit_sync_progress(uuid[])',
    'public.get_permit_sync_overview()',
    'public.get_permit_sync_job_progress(uuid)',
    'public.admin_permit_sync_scheduler_status()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_permit_sync_runs() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_permit_sync_job(uuid, text, text, jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_permit_sync_progress(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.permit_sync_worker_heartbeat(text, text, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.permit_sync_monitor() TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_permit_sync_alerts_notified(uuid[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_permit_sync_refresh(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_permit_refresh(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_permit_sync_job(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_retry_permit_sync_job(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_permit_sync_schedule(uuid, boolean, jsonb, jsonb, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_permit_sync_progress(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_permit_sync_overview() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_permit_sync_job_progress(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_permit_sync_scheduler_status() TO authenticated, service_role;
