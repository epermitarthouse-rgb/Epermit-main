-- Rollback for supabase/migrations/20261112100000_permit_capture_retry.sql (production approval required).
-- Restores the schema exactly as 20261111120000_permit_deep_capture.sql left it (verified by
-- scraper-service/tests/permit-repo-chain.test.js). The four replaced functions below are verbatim copies
-- from 20261111120000. Run in one transaction:
--   supabase db query --linked -f scripts/permit-repo/rollback-20261112100000_permit_capture_retry.sql
--   supabase migration repair --status reverted 20261112100000
-- Refuses while a deep job is active. Drops attempt counts and file provenance; documents in
-- deferred_oversize go back to not_requested / not_permitted. Stored objects and stored rows are kept
-- (viewer-path rows stay stored; the v1 RPC never touches a stored row).

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.permit_sync_jobs
             WHERE worker_mode = 'deep' AND status IN ('queued', 'running', 'retry_wait', 'waiting_user')) THEN
    RAISE EXCEPTION 'cancel the active deep job first (admin_cancel_permit_sync_job)';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.record_permit_document_capture_v2(uuid, jsonb);

UPDATE public.permit_documents
SET download_status = CASE WHEN download_permitted IS TRUE THEN 'not_requested' ELSE 'not_permitted' END
WHERE download_status = 'deferred_oversize';

ALTER TABLE public.permit_documents DROP CONSTRAINT IF EXISTS permit_documents_download_status_check;
ALTER TABLE public.permit_documents ADD CONSTRAINT permit_documents_download_status_check
  CHECK (download_status IN ('not_permitted', 'not_requested', 'pending', 'stored', 'failed'));

CREATE OR REPLACE FUNCTION public._permit_protected_columns()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'id', 'permit_id', 'content_hash', 'first_seen_at', 'last_seen_at', 'removed_at',
    'created_at', 'updated_at', 'search_tsv', 'comment_id',
    'download_status', 'storage_path', 'sha256', 'downloaded_at',
    'adapter_key', 'portal_record_id', 'removed_from_portal_at', 'last_synced_at', 'last_changed_at',
    'stored_size_bytes', 'stored_content_type', 'download_error', 'download_run_id',
    'content_status', 'latest_content_id', 'content_captured_at', 'content_error'
  ]::text[];
$$;


CREATE OR REPLACE FUNCTION public.record_permit_report_content(
  p_permit_id UUID, p_report_key TEXT, p_content JSONB, p_run_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.permit_reports%ROWTYPE;
  v_sha TEXT := p_content ->> 'sha256';
  v_existing UUID;
  v_version INTEGER;
  v_id UUID;
  v_path TEXT;
BEGIN
  SELECT * INTO v_report FROM public.permit_reports WHERE permit_id = p_permit_id AND report_key = p_report_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_sha IS NULL OR v_sha !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'content sha256 required' USING ERRCODE = '22023';
  END IF;
  FOREACH v_path IN ARRAY ARRAY[p_content ->> 'pdf_path', p_content ->> 'excel_path'] LOOP
    IF v_path IS NOT NULL AND public._permit_storage_permit_id(v_path) IS DISTINCT FROM p_permit_id THEN
      RAISE EXCEPTION 'storage path must start with the permit id' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT id INTO v_existing FROM public.permit_report_contents
  WHERE permit_id = p_permit_id AND report_key = p_report_key AND content_sha256 = v_sha;
  IF v_existing IS NOT NULL THEN
    UPDATE public.permit_reports SET content_status = 'captured', latest_content_id = v_existing, content_error = NULL
    WHERE id = v_report.id AND (latest_content_id IS DISTINCT FROM v_existing OR content_status <> 'captured');
    RETURN jsonb_build_object('result', 'unchanged', 'content_id', v_existing);
  END IF;

  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.permit_report_contents
  WHERE permit_id = p_permit_id AND report_key = p_report_key;

  INSERT INTO public.permit_report_contents (
    permit_id, report_key, version, content_sha256, source, text_content, structured_rows,
    pdf_storage_path, pdf_sha256, pdf_size_bytes, excel_storage_path, excel_sha256, excel_size_bytes, run_id)
  VALUES (
    p_permit_id, p_report_key, v_version, v_sha, coalesce(p_content ->> 'source', 'ssrs_export'),
    p_content ->> 'text', p_content -> 'structured_rows',
    p_content ->> 'pdf_path', p_content ->> 'pdf_sha256', (p_content ->> 'pdf_size')::bigint,
    p_content ->> 'excel_path', p_content ->> 'excel_sha256', (p_content ->> 'excel_size')::bigint, p_run_id)
  RETURNING id INTO v_id;

  UPDATE public.permit_reports
  SET content_status = 'captured', latest_content_id = v_id, content_captured_at = now(), content_error = NULL
  WHERE id = v_report.id;

  PERFORM public._permit_record_change(p_permit_id, 'reports', 'permit_report_contents', p_report_key,
    CASE WHEN v_version = 1 THEN 'created' ELSE 'updated' END,
    jsonb_build_object('version', jsonb_build_object('before', v_version - 1, 'after', v_version)),
    p_run_id, now());
  RETURN jsonb_build_object('result', 'inserted', 'content_id', v_id, 'version', v_version);
END;
$$;


CREATE OR REPLACE FUNCTION public.record_permit_report_failure(
  p_permit_id UUID, p_report_key TEXT, p_error TEXT
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.permit_reports
  SET content_error = left(p_error, 300),
      content_status = CASE WHEN content_status = 'captured' THEN 'captured' ELSE 'failed' END
  WHERE permit_id = p_permit_id AND report_key = p_report_key;
$$;


CREATE OR REPLACE FUNCTION public._permit_sync_validate_options(p_options JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
  v_ids JSONB;
BEGIN
  IF p_options IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;
  IF jsonb_typeof(p_options) <> 'object' THEN
    RAISE EXCEPTION 'options must be an object' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_options) LOOP
    IF v_key NOT IN ('only_portal_record_ids', 'max_files', 'max_bytes') THEN
      RAISE EXCEPTION 'unknown option %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_ids := p_options -> 'only_portal_record_ids';
  IF v_ids IS NOT NULL AND (
       jsonb_typeof(v_ids) <> 'array' OR jsonb_array_length(v_ids) NOT BETWEEN 1 AND 50
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_ids) e WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^[0-9]{1,12}$')
     ) THEN
    RAISE EXCEPTION 'only_portal_record_ids must be 1 to 50 numeric ProjectID strings' USING ERRCODE = '22023';
  END IF;
  IF p_options ? 'max_files' AND (jsonb_typeof(p_options -> 'max_files') <> 'number' OR (p_options ->> 'max_files')::numeric NOT BETWEEN 0 AND 1000
       OR (p_options ->> 'max_files')::numeric <> trunc((p_options ->> 'max_files')::numeric)) THEN
    RAISE EXCEPTION 'max_files must be an integer from 0 to 1000' USING ERRCODE = '22023';
  END IF;
  IF p_options ? 'max_bytes' AND (jsonb_typeof(p_options -> 'max_bytes') <> 'number' OR (p_options ->> 'max_bytes')::numeric NOT BETWEEN 0 AND 10737418240
       OR (p_options ->> 'max_bytes')::numeric <> trunc((p_options ->> 'max_bytes')::numeric)) THEN
    RAISE EXCEPTION 'max_bytes must be an integer from 0 to 10737418240' USING ERRCODE = '22023';
  END IF;
  RETURN p_options;
END;
$$;


DROP FUNCTION IF EXISTS public._permit_capture_backoff(integer);

ALTER TABLE public.permit_documents DROP CONSTRAINT IF EXISTS permit_documents_capture_access_path_check;
ALTER TABLE public.permit_documents DROP CONSTRAINT IF EXISTS permit_documents_capture_attempts_check;
ALTER TABLE public.permit_documents DROP COLUMN IF EXISTS capture_attempts;
ALTER TABLE public.permit_documents DROP COLUMN IF EXISTS capture_next_attempt_at;
ALTER TABLE public.permit_documents DROP COLUMN IF EXISTS capture_access_path;
ALTER TABLE public.permit_documents DROP COLUMN IF EXISTS capture_source_endpoint;
ALTER TABLE public.permit_documents DROP COLUMN IF EXISTS capture_is_rendition;
ALTER TABLE public.permit_documents DROP COLUMN IF EXISTS size_matches_portal;
ALTER TABLE public.permit_reports DROP COLUMN IF EXISTS content_attempts;
ALTER TABLE public.permit_reports DROP COLUMN IF EXISTS content_next_attempt_at;

REVOKE ALL ON FUNCTION public.record_permit_report_content(uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_permit_report_failure(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._permit_sync_validate_options(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_permit_report_content(uuid, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_permit_report_failure(uuid, text, text) TO service_role;

COMMIT;
