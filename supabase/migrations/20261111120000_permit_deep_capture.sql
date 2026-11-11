-- Deep capture for the central permit repository (D-056, D-058, D-067).
-- Additive: new columns on permit_documents / permit_reports, an append-only report content table,
-- two service-role RPCs, and a storage read policy for report objects in the private bucket.
-- Nothing existing is dropped. Re-runnable.

-- ---------------------------------------------------------------------------
-- 1. Document capture details
-- ---------------------------------------------------------------------------

ALTER TABLE public.permit_documents ADD COLUMN IF NOT EXISTS stored_size_bytes BIGINT;
ALTER TABLE public.permit_documents ADD COLUMN IF NOT EXISTS stored_content_type TEXT;
ALTER TABLE public.permit_documents ADD COLUMN IF NOT EXISTS download_error TEXT;
ALTER TABLE public.permit_documents ADD COLUMN IF NOT EXISTS download_run_id UUID;

-- ---------------------------------------------------------------------------
-- 2. Report contents (append-only versions) and the latest pointer on permit_reports
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.permit_report_contents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id UUID NOT NULL REFERENCES public.permits(id) ON DELETE RESTRICT,
  report_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  content_sha256 TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ssrs_export' CHECK (source IN ('ssrs_export', 'viewer_text')),
  text_content TEXT,
  structured_rows JSONB,
  pdf_storage_path TEXT,
  pdf_sha256 TEXT,
  pdf_size_bytes BIGINT,
  excel_storage_path TEXT,
  excel_sha256 TEXT,
  excel_size_bytes BIGINT,
  run_id UUID,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT permit_report_contents_version UNIQUE (permit_id, report_key, version),
  CONSTRAINT permit_report_contents_dedup UNIQUE (permit_id, report_key, content_sha256),
  CONSTRAINT permit_report_contents_report FOREIGN KEY (permit_id, report_key)
    REFERENCES public.permit_reports (permit_id, report_key) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_permit_report_contents_permit ON public.permit_report_contents (permit_id, report_key);

ALTER TABLE public.permit_reports ADD COLUMN IF NOT EXISTS content_status TEXT NOT NULL DEFAULT 'not_captured';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'permit_reports_content_status_check') THEN
    ALTER TABLE public.permit_reports ADD CONSTRAINT permit_reports_content_status_check
      CHECK (content_status IN ('not_captured', 'captured', 'failed'));
  END IF;
END;
$$;
ALTER TABLE public.permit_reports ADD COLUMN IF NOT EXISTS latest_content_id UUID REFERENCES public.permit_report_contents(id) ON DELETE SET NULL;
ALTER TABLE public.permit_reports ADD COLUMN IF NOT EXISTS content_captured_at TIMESTAMPTZ;
ALTER TABLE public.permit_reports ADD COLUMN IF NOT EXISTS content_error TEXT;

DROP TRIGGER IF EXISTS permit_report_contents_append_only ON public.permit_report_contents;
CREATE TRIGGER permit_report_contents_append_only
BEFORE UPDATE OR DELETE ON public.permit_report_contents
FOR EACH ROW EXECUTE FUNCTION public._permit_evidence_append_only();

DROP TRIGGER IF EXISTS permit_report_contents_no_truncate ON public.permit_report_contents;
CREATE TRIGGER permit_report_contents_no_truncate
BEFORE TRUNCATE ON public.permit_report_contents
FOR EACH STATEMENT EXECUTE FUNCTION public._permit_evidence_append_only();

ALTER TABLE public.permit_report_contents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Readable with permit access" ON public.permit_report_contents;
CREATE POLICY "Readable with permit access" ON public.permit_report_contents
FOR SELECT TO authenticated USING (public.can_read_permit(permit_id));

REVOKE ALL ON public.permit_report_contents FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.permit_report_contents FROM authenticated;
GRANT SELECT ON public.permit_report_contents TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.permit_report_contents FROM service_role;
GRANT SELECT, INSERT ON public.permit_report_contents TO service_role;

-- The batch apply must never write capture columns (they are set only by the RPCs below).
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

-- ---------------------------------------------------------------------------
-- 3. Service-role RPCs
-- ---------------------------------------------------------------------------

-- Records a captured (or failed) document body. Only for rows the portal marks downloadable (D-056).
CREATE OR REPLACE FUNCTION public.record_permit_document_capture(
  p_document_id UUID, p_status TEXT, p_storage_path TEXT DEFAULT NULL, p_sha256 TEXT DEFAULT NULL,
  p_size_bytes BIGINT DEFAULT NULL, p_content_type TEXT DEFAULT NULL, p_error TEXT DEFAULT NULL,
  p_run_id UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.permit_documents%ROWTYPE;
BEGIN
  SELECT * INTO v_doc FROM public.permit_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_status NOT IN ('stored', 'failed') THEN
    RAISE EXCEPTION 'invalid capture status %', p_status USING ERRCODE = '22023';
  END IF;
  IF v_doc.download_permitted IS NOT TRUE THEN
    RAISE EXCEPTION 'download not permitted for this document' USING ERRCODE = '42501';
  END IF;
  IF p_status = 'stored' THEN
    IF p_storage_path IS NULL OR public._permit_storage_permit_id(p_storage_path) IS DISTINCT FROM v_doc.permit_id THEN
      RAISE EXCEPTION 'storage path must start with the permit id' USING ERRCODE = '22023';
    END IF;
    IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'sha256 required' USING ERRCODE = '22023';
    END IF;
    IF v_doc.download_status = 'stored' AND v_doc.sha256 = p_sha256 AND v_doc.storage_path = p_storage_path THEN
      RETURN 'unchanged';
    END IF;
    UPDATE public.permit_documents
    SET download_status = 'stored', storage_path = p_storage_path, sha256 = p_sha256,
        stored_size_bytes = p_size_bytes, stored_content_type = left(p_content_type, 120),
        download_error = NULL, download_run_id = p_run_id, downloaded_at = now(), updated_at = now()
    WHERE id = p_document_id;
    PERFORM public._permit_record_change(v_doc.permit_id, 'files', 'permit_documents', v_doc.portal_file_id,
      'updated', jsonb_build_object('download_status', jsonb_build_object('before', v_doc.download_status, 'after', 'stored'),
                                    'sha256', jsonb_build_object('before', v_doc.sha256, 'after', p_sha256)),
      p_run_id, now());
    RETURN 'stored';
  END IF;
  -- A failure never clears a stored body.
  IF v_doc.download_status = 'stored' THEN
    RETURN 'kept_stored';
  END IF;
  UPDATE public.permit_documents
  SET download_status = 'failed', download_error = left(p_error, 300), download_run_id = p_run_id, updated_at = now()
  WHERE id = p_document_id;
  RETURN 'failed';
END;
$$;

-- Records one captured report version. A new version is inserted only when the content hash changes.
-- p_content: { sha256, text, structured_rows, pdf_path, pdf_sha256, pdf_size, excel_path, excel_sha256, excel_size, source }
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

-- Records a failed report export. Never clears captured content.
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

REVOKE ALL ON FUNCTION public.record_permit_document_capture(uuid, text, text, text, bigint, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_permit_report_content(uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_permit_report_failure(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_permit_document_capture(uuid, text, text, text, bigint, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_permit_report_content(uuid, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_permit_report_failure(uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Report objects in the private bucket: readable with permit access and a content row at that path.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Permit documents report objects readable with permit access" ON storage.objects;
CREATE POLICY "Permit documents report objects readable with permit access" ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'permit-documents'
  AND public.can_read_permit(public._permit_storage_permit_id(name))
  AND EXISTS (
    SELECT 1 FROM public.permit_report_contents c
    WHERE c.pdf_storage_path = storage.objects.name OR c.excel_storage_path = storage.objects.name
  )
);

-- ---------------------------------------------------------------------------
-- 5. Deep-pass state (D-059): the JSON-pass section hashes the last successful deep pass ran against.
--    Written only after the deep pass for that permit fully succeeded, so a crash mid-pass repeats it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.permit_deep_state (
  permit_id UUID PRIMARY KEY REFERENCES public.permits(id) ON DELETE CASCADE,
  section_hashes JSONB NOT NULL,
  run_id UUID,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.permit_deep_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.permit_deep_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.permit_deep_state TO service_role;

CREATE OR REPLACE FUNCTION public.record_permit_deep_pass(p_permit_id UUID, p_section_hashes JSONB, p_run_id UUID DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.permit_deep_state (permit_id, section_hashes, run_id, completed_at)
  VALUES (p_permit_id, p_section_hashes, p_run_id, now())
  ON CONFLICT (permit_id) DO UPDATE
  SET section_hashes = EXCLUDED.section_hashes, run_id = EXCLUDED.run_id, completed_at = EXCLUDED.completed_at;
$$;

REVOKE ALL ON FUNCTION public.record_permit_deep_pass(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_permit_deep_pass(uuid, jsonb, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Worker mode per job (D-073). A deployed worker built before this migration calls the two-argument
--    claim_permit_sync_job, which from here on returns 'json' jobs only, so it can never claim a deep job.
--    Deep jobs are created only by admin_request_permit_deep_sync and claimed only through
--    claim_permit_sync_job_v2(..., 'deep'). Job options carry the one-permit scope and download caps.
-- ---------------------------------------------------------------------------

ALTER TABLE public.permit_sync_jobs ADD COLUMN IF NOT EXISTS worker_mode TEXT NOT NULL DEFAULT 'json';
ALTER TABLE public.permit_sync_jobs ADD COLUMN IF NOT EXISTS options JSONB NOT NULL DEFAULT '{}'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'permit_sync_jobs_worker_mode_check') THEN
    ALTER TABLE public.permit_sync_jobs ADD CONSTRAINT permit_sync_jobs_worker_mode_check CHECK (worker_mode IN ('json', 'deep'));
  END IF;
END $$;

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

  UPDATE public.permit_sync_jobs j
  SET status = 'failed', error_code = 'lease_expired', completed_at = now(),
      last_error = coalesce(j.last_error, 'worker lease expired after final attempt'),
      lease_worker_id = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE j.status = 'running' AND j.lease_expires_at < now() AND j.attempt_count >= j.max_attempts
    AND j.worker_mode = p_worker_mode;

  SELECT j.* INTO v_job
  FROM public.permit_sync_jobs j
  JOIN public.permit_sync_sources s ON s.credential_id = j.credential_id
  WHERE j.worker_mode = p_worker_mode
    AND (
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
  VALUES (v_job.id, 'info', 'claimed', p_worker_id, jsonb_build_object('attempt', v_job.attempt_count, 'worker_mode', p_worker_mode));
  RETURN v_job;
END;
$$;

-- Same signature the deployed JSON-only worker calls; now restricted to 'json' jobs.
CREATE OR REPLACE FUNCTION public.claim_permit_sync_job(p_worker_id TEXT, p_lease_ttl_seconds INTEGER DEFAULT 300)
RETURNS public.permit_sync_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public._permit_sync_claim(p_worker_id, p_lease_ttl_seconds, 'json');
$$;

CREATE OR REPLACE FUNCTION public.claim_permit_sync_job_v2(p_worker_id TEXT, p_lease_ttl_seconds INTEGER, p_worker_mode TEXT)
RETURNS public.permit_sync_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public._permit_sync_claim(p_worker_id, p_lease_ttl_seconds, p_worker_mode);
$$;

-- Options: only_portal_record_ids (DC ProjectIDs, 1..50 digit strings), max_files (0..1000), max_bytes (0..10 GB).
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

-- Admin only, audited. Refuses while the source has any active job, so a deep request never merges into a JSON job.
CREATE OR REPLACE FUNCTION public.admin_request_permit_deep_sync(p_credential_id UUID, p_options JSONB DEFAULT '{}'::jsonb)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.permit_sync_sources%ROWTYPE;
  v_options JSONB;
  v_id UUID;
BEGIN
  PERFORM public._admin_require_platform_admin();
  v_options := public._permit_sync_validate_options(p_options);
  SELECT * INTO v_source FROM public.permit_sync_sources WHERE credential_id = p_credential_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no permit sync source for credential' USING ERRCODE = 'P0002';
  END IF;
  IF v_source.status IN ('needs_encryption', 'auth_failed', 'paused', 'waiting_user') THEN
    RAISE EXCEPTION 'source status % does not allow runs', v_source.status USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.permit_sync_jobs
             WHERE credential_id = p_credential_id AND status IN ('queued', 'running', 'retry_wait', 'waiting_user')) THEN
    RAISE EXCEPTION 'the source already has an active job' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.permit_sync_jobs (credential_id, adapter_key, trigger, requested_by, worker_mode, options)
  VALUES (p_credential_id, v_source.adapter_key, 'manual', auth.uid(), 'deep', v_options)
  RETURNING id INTO v_id;
  INSERT INTO public.permit_sync_events (job_id, level, code, message, data)
  VALUES (v_id, 'info', 'enqueued', 'manual', jsonb_build_object('worker_mode', 'deep', 'options', v_options));
  PERFORM public._permit_audit('permit_sync.request_deep', 'permit_sync_job', v_id::text, NULL,
    jsonb_build_object('credential_id', p_credential_id, 'options', v_options));
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public._permit_sync_claim(text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._permit_sync_validate_options(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_permit_sync_job(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_permit_sync_job_v2(text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_request_permit_deep_sync(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_permit_sync_job(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_permit_sync_job_v2(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_request_permit_deep_sync(uuid, jsonb) TO authenticated, service_role;
