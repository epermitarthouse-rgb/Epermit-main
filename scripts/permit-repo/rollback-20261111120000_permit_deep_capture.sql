-- Rollback for supabase/migrations/20261111120000_permit_deep_capture.sql (production approval required).
-- Restores the schema exactly as 20261111100000..20261111100200 left it (verified by
-- scraper-service/tests/permit-repo-chain.test.js). Run in one transaction:
--   supabase db query --linked -f scripts/permit-repo/rollback-20261111120000_permit_deep_capture.sql
--   supabase migration repair --status reverted 20261111120000
-- Refuses while a deep job is active. DROPS captured report versions and deep-pass state; stored objects in
-- the permit-documents bucket are left in place (remove them separately, with approval).

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.permit_sync_jobs
             WHERE worker_mode = 'deep' AND status IN ('queued', 'running', 'retry_wait', 'waiting_user')) THEN
    RAISE EXCEPTION 'cancel the active deep job first (admin_cancel_permit_sync_job)';
  END IF;
END;
$$;

-- 6. worker mode
DROP FUNCTION IF EXISTS public.admin_request_permit_deep_sync(uuid, jsonb);
DROP FUNCTION IF EXISTS public.claim_permit_sync_job_v2(text, integer, text);
DROP FUNCTION IF EXISTS public._permit_sync_validate_options(jsonb);
CREATE OR REPLACE FUNCTION public.claim_permit_sync_job(p_worker_id TEXT, p_lease_ttl_seconds INTEGER DEFAULT 300)
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

  UPDATE public.permit_sync_jobs j
  SET status = 'failed', error_code = 'lease_expired', completed_at = now(),
      last_error = coalesce(j.last_error, 'worker lease expired after final attempt'),
      lease_worker_id = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE j.status = 'running' AND j.lease_expires_at < now() AND j.attempt_count >= j.max_attempts;

  SELECT j.* INTO v_job
  FROM public.permit_sync_jobs j
  JOIN public.permit_sync_sources s ON s.credential_id = j.credential_id
  WHERE (
      (j.status IN ('queued', 'retry_wait') AND j.next_attempt_at <= now())
      OR (j.status = 'running' AND j.lease_expires_at < now())
    )
    AND s.status NOT IN ('needs_encryption', 'auth_failed', 'paused', 'waiting_user')
    AND (j.trigger = 'manual' OR s.automation_enabled)
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
      updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  INSERT INTO public.permit_sync_events (job_id, level, code, message, data)
  VALUES (v_job.id, 'info', 'claimed', p_worker_id, jsonb_build_object('attempt', v_job.attempt_count));
  RETURN v_job;
END;
$$;
DROP FUNCTION IF EXISTS public._permit_sync_claim(text, integer, text);
ALTER TABLE public.permit_sync_jobs DROP CONSTRAINT IF EXISTS permit_sync_jobs_worker_mode_check;
ALTER TABLE public.permit_sync_jobs DROP COLUMN IF EXISTS options;
ALTER TABLE public.permit_sync_jobs DROP COLUMN IF EXISTS worker_mode;

-- 5. deep-pass state
DROP FUNCTION IF EXISTS public.record_permit_deep_pass(uuid, jsonb, uuid);
DROP TABLE IF EXISTS public.permit_deep_state;

-- 4. report object read policy
DROP POLICY IF EXISTS "Permit documents report objects readable with permit access" ON storage.objects;

-- 3. capture RPCs
DROP FUNCTION IF EXISTS public.record_permit_document_capture(uuid, text, text, text, bigint, text, text, uuid);
DROP FUNCTION IF EXISTS public.record_permit_report_content(uuid, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.record_permit_report_failure(uuid, text, text);

-- 2. report contents
ALTER TABLE public.permit_reports DROP COLUMN IF EXISTS latest_content_id;
ALTER TABLE public.permit_reports DROP COLUMN IF EXISTS content_captured_at;
ALTER TABLE public.permit_reports DROP COLUMN IF EXISTS content_error;
ALTER TABLE public.permit_reports DROP CONSTRAINT IF EXISTS permit_reports_content_status_check;
ALTER TABLE public.permit_reports DROP COLUMN IF EXISTS content_status;
DROP TABLE IF EXISTS public.permit_report_contents;
CREATE OR REPLACE FUNCTION public._permit_protected_columns()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'id', 'permit_id', 'content_hash', 'first_seen_at', 'last_seen_at', 'removed_at',
    'created_at', 'updated_at', 'search_tsv', 'comment_id',
    'download_status', 'storage_path', 'sha256', 'downloaded_at',
    'adapter_key', 'portal_record_id', 'removed_from_portal_at', 'last_synced_at', 'last_changed_at'
  ]::text[];
$$;

-- 1. document capture details
ALTER TABLE public.permit_documents DROP COLUMN IF EXISTS download_run_id;
ALTER TABLE public.permit_documents DROP COLUMN IF EXISTS download_error;
ALTER TABLE public.permit_documents DROP COLUMN IF EXISTS stored_content_type;
ALTER TABLE public.permit_documents DROP COLUMN IF EXISTS stored_size_bytes;

COMMIT;
