-- Capture retry, oversize deferral, viewer-path capture and file provenance (D-080 .. D-086).
-- Additive: new columns on permit_documents / permit_reports, one extra download_status value, one new
-- document capture RPC (v2), and two report RPCs replaced with the same signatures. The deep-capture
-- RPC record_permit_document_capture (v1) is left unchanged for workers built before this migration.
-- Nothing is dropped except the download_status CHECK, which is re-created with one more value. Re-runnable.

-- ---------------------------------------------------------------------------
-- 1. Documents: attempts / next eligible time, provenance, and the deferred_oversize state
-- ---------------------------------------------------------------------------

ALTER TABLE public.permit_documents ADD COLUMN IF NOT EXISTS capture_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.permit_documents ADD COLUMN IF NOT EXISTS capture_next_attempt_at TIMESTAMPTZ;
ALTER TABLE public.permit_documents ADD COLUMN IF NOT EXISTS capture_access_path TEXT;
ALTER TABLE public.permit_documents ADD COLUMN IF NOT EXISTS capture_source_endpoint TEXT;
ALTER TABLE public.permit_documents ADD COLUMN IF NOT EXISTS capture_is_rendition BOOLEAN;
ALTER TABLE public.permit_documents ADD COLUMN IF NOT EXISTS size_matches_portal BOOLEAN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'permit_documents_capture_access_path_check') THEN
    ALTER TABLE public.permit_documents ADD CONSTRAINT permit_documents_capture_access_path_check
      CHECK (capture_access_path IS NULL OR capture_access_path IN ('download', 'viewer'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'permit_documents_capture_attempts_check') THEN
    ALTER TABLE public.permit_documents ADD CONSTRAINT permit_documents_capture_attempts_check
      CHECK (capture_attempts >= 0);
  END IF;
END;
$$;

-- The original inline CHECK is named permit_documents_download_status_check by Postgres.
ALTER TABLE public.permit_documents DROP CONSTRAINT IF EXISTS permit_documents_download_status_check;
ALTER TABLE public.permit_documents ADD CONSTRAINT permit_documents_download_status_check
  CHECK (download_status IN ('not_permitted', 'not_requested', 'pending', 'stored', 'failed', 'deferred_oversize'));

-- ---------------------------------------------------------------------------
-- 2. Reports: attempts / next eligible time
-- ---------------------------------------------------------------------------

ALTER TABLE public.permit_reports ADD COLUMN IF NOT EXISTS content_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.permit_reports ADD COLUMN IF NOT EXISTS content_next_attempt_at TIMESTAMPTZ;

-- The batch apply must never write capture columns (set only by the capture RPCs).
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
    'content_status', 'latest_content_id', 'content_captured_at', 'content_error',
    'capture_attempts', 'capture_next_attempt_at', 'capture_access_path', 'capture_source_endpoint',
    'capture_is_rendition', 'size_matches_portal', 'content_attempts', 'content_next_attempt_at'
  ]::text[];
$$;

-- Bounded back-off after the n-th failed attempt: 1 h, 4 h, 16 h, 64 h, then 7 days.
CREATE OR REPLACE FUNCTION public._permit_capture_backoff(p_attempts INTEGER)
RETURNS INTERVAL
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT least(interval '1 hour' * power(4, greatest(p_attempts, 1) - 1), interval '7 days');
$$;

-- ---------------------------------------------------------------------------
-- 3. Document capture v2 (D-082, D-084)
--    p_capture: { status: stored|failed|deferred_oversize, storage_path, sha256, size_bytes, content_type,
--                 error, run_id, access_path: download|viewer, source_endpoint, is_rendition, size_matches_portal }
--    access_path 'download' needs download_permitted TRUE (the portal's Download flag); 'viewer' is the
--    file viewer's own retrieval and needs only a known flag. download_permitted is never changed here.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_permit_document_capture_v2(p_document_id UUID, p_capture JSONB)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.permit_documents%ROWTYPE;
  v_status TEXT := p_capture ->> 'status';
  v_access TEXT := p_capture ->> 'access_path';
  v_path TEXT := p_capture ->> 'storage_path';
  v_sha TEXT := p_capture ->> 'sha256';
  v_run UUID := nullif(p_capture ->> 'run_id', '')::uuid;
  v_attempts INTEGER;
BEGIN
  IF p_capture IS NULL OR jsonb_typeof(p_capture) <> 'object' THEN
    RAISE EXCEPTION 'capture must be an object' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_doc FROM public.permit_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status IS NULL OR v_status NOT IN ('stored', 'failed', 'deferred_oversize') THEN
    RAISE EXCEPTION 'invalid capture status %', v_status USING ERRCODE = '22023';
  END IF;
  IF v_access IS NULL OR v_access NOT IN ('download', 'viewer') THEN
    RAISE EXCEPTION 'access_path must be download or viewer' USING ERRCODE = '22023';
  END IF;
  IF v_doc.download_permitted IS NULL THEN
    RAISE EXCEPTION 'portal permissions unknown for this document' USING ERRCODE = '42501';
  END IF;
  IF v_access = 'download' AND v_doc.download_permitted IS NOT TRUE THEN
    RAISE EXCEPTION 'download not permitted for this document' USING ERRCODE = '42501';
  END IF;

  IF v_status = 'stored' THEN
    IF v_path IS NULL OR public._permit_storage_permit_id(v_path) IS DISTINCT FROM v_doc.permit_id THEN
      RAISE EXCEPTION 'storage path must start with the permit id' USING ERRCODE = '22023';
    END IF;
    IF v_sha IS NULL OR v_sha !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'sha256 required' USING ERRCODE = '22023';
    END IF;
    IF coalesce((p_capture ->> 'size_bytes')::bigint, 0) <= 0 THEN
      RAISE EXCEPTION 'size_bytes must be positive' USING ERRCODE = '22023';
    END IF;
    IF v_doc.download_status = 'stored' AND v_doc.sha256 = v_sha AND v_doc.storage_path = v_path THEN
      UPDATE public.permit_documents
      SET capture_attempts = 0, capture_next_attempt_at = NULL,
          capture_access_path = v_access, capture_source_endpoint = left(p_capture ->> 'source_endpoint', 60),
          capture_is_rendition = (p_capture ->> 'is_rendition')::boolean,
          size_matches_portal = (p_capture ->> 'size_matches_portal')::boolean
      WHERE id = p_document_id
        AND (capture_attempts <> 0 OR capture_next_attempt_at IS NOT NULL
             OR capture_access_path IS DISTINCT FROM v_access
             OR capture_source_endpoint IS DISTINCT FROM left(p_capture ->> 'source_endpoint', 60)
             OR capture_is_rendition IS DISTINCT FROM (p_capture ->> 'is_rendition')::boolean
             OR size_matches_portal IS DISTINCT FROM (p_capture ->> 'size_matches_portal')::boolean);
      RETURN 'unchanged';
    END IF;
    UPDATE public.permit_documents
    SET download_status = 'stored', storage_path = v_path, sha256 = v_sha,
        stored_size_bytes = (p_capture ->> 'size_bytes')::bigint,
        stored_content_type = left(p_capture ->> 'content_type', 120),
        download_error = NULL, download_run_id = v_run, downloaded_at = now(), updated_at = now(),
        capture_attempts = 0, capture_next_attempt_at = NULL,
        capture_access_path = v_access, capture_source_endpoint = left(p_capture ->> 'source_endpoint', 60),
        capture_is_rendition = (p_capture ->> 'is_rendition')::boolean,
        size_matches_portal = (p_capture ->> 'size_matches_portal')::boolean
    WHERE id = p_document_id;
    PERFORM public._permit_record_change(v_doc.permit_id, 'files', 'permit_documents', v_doc.portal_file_id,
      'updated', jsonb_build_object('download_status', jsonb_build_object('before', v_doc.download_status, 'after', 'stored'),
                                    'sha256', jsonb_build_object('before', v_doc.sha256, 'after', v_sha)),
      v_run, now());
    RETURN 'stored';
  END IF;

  -- A failure or a deferral never clears a stored body.
  IF v_doc.download_status = 'stored' THEN
    RETURN 'kept_stored';
  END IF;

  IF v_status = 'deferred_oversize' THEN
    UPDATE public.permit_documents
    SET download_status = 'deferred_oversize', download_error = left(p_capture ->> 'error', 300),
        download_run_id = v_run, capture_access_path = v_access, capture_next_attempt_at = NULL, updated_at = now()
    WHERE id = p_document_id
      AND (download_status IS DISTINCT FROM 'deferred_oversize' OR download_error IS DISTINCT FROM left(p_capture ->> 'error', 300));
    RETURN 'deferred_oversize';
  END IF;

  v_attempts := v_doc.capture_attempts + 1;
  UPDATE public.permit_documents
  SET download_status = 'failed', download_error = left(p_capture ->> 'error', 300), download_run_id = v_run,
      capture_attempts = v_attempts, capture_next_attempt_at = now() + public._permit_capture_backoff(v_attempts),
      capture_access_path = v_access, capture_source_endpoint = left(p_capture ->> 'source_endpoint', 60),
      updated_at = now()
  WHERE id = p_document_id;
  RETURN 'failed';
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Reports: a capture resets the attempts; a failure counts one and sets the next eligible time.
--    Same signatures as 20261111120000; the content RPC body is unchanged apart from the reset.
-- ---------------------------------------------------------------------------

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
    UPDATE public.permit_reports
    SET content_status = 'captured', latest_content_id = v_existing, content_error = NULL,
        content_attempts = 0, content_next_attempt_at = NULL
    WHERE id = v_report.id
      AND (latest_content_id IS DISTINCT FROM v_existing OR content_status <> 'captured'
           OR content_attempts <> 0 OR content_next_attempt_at IS NOT NULL);
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
  SET content_status = 'captured', latest_content_id = v_id, content_captured_at = now(), content_error = NULL,
      content_attempts = 0, content_next_attempt_at = NULL
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
      content_status = CASE WHEN content_status = 'captured' THEN 'captured' ELSE 'failed' END,
      content_attempts = CASE WHEN content_status = 'captured' THEN content_attempts ELSE content_attempts + 1 END,
      content_next_attempt_at = CASE WHEN content_status = 'captured' THEN content_next_attempt_at
                                     ELSE now() + public._permit_capture_backoff(content_attempts + 1) END
  WHERE permit_id = p_permit_id AND report_key = p_report_key;
$$;

REVOKE ALL ON FUNCTION public._permit_capture_backoff(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_permit_document_capture_v2(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_permit_report_content(uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_permit_report_failure(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._permit_capture_backoff(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_permit_document_capture_v2(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_permit_report_content(uuid, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_permit_report_failure(uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Job option max_file_bytes (per-file limit, 1 MiB .. 5 GiB); may only lower the worker's env limit.
-- ---------------------------------------------------------------------------

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
    IF v_key NOT IN ('only_portal_record_ids', 'max_files', 'max_bytes', 'max_file_bytes') THEN
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
  IF p_options ? 'max_file_bytes' AND (jsonb_typeof(p_options -> 'max_file_bytes') <> 'number' OR (p_options ->> 'max_file_bytes')::numeric NOT BETWEEN 1048576 AND 5368709120
       OR (p_options ->> 'max_file_bytes')::numeric <> trunc((p_options ->> 'max_file_bytes')::numeric)) THEN
    RAISE EXCEPTION 'max_file_bytes must be an integer from 1048576 to 5368709120' USING ERRCODE = '22023';
  END IF;
  RETURN p_options;
END;
$$;

REVOKE ALL ON FUNCTION public._permit_sync_validate_options(jsonb) FROM PUBLIC, anon;
