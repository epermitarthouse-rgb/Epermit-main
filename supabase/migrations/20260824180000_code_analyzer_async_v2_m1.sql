-- Code Analyzer Async V2 — Milestone 1: durable ingestion jobs + derived assets.
-- Additive only; V1 paths remain unchanged until CODE_ANALYZER_ASYNC_V2 is enabled.

ALTER TABLE public.project_documents
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS analyzer_class TEXT,
  ADD COLUMN IF NOT EXISTS analyzer_class_source TEXT,
  ADD COLUMN IF NOT EXISTS analyzer_class_confidence NUMERIC(4, 3),
  ADD COLUMN IF NOT EXISTS analyzer_processing_status TEXT NOT NULL DEFAULT 'not_started';

ALTER TABLE public.project_documents
  DROP CONSTRAINT IF EXISTS project_documents_analyzer_class_check;

ALTER TABLE public.project_documents
  ADD CONSTRAINT project_documents_analyzer_class_check
  CHECK (
    analyzer_class IS NULL OR analyzer_class IN (
      'drawing_set', 'specification', 'code_modification_form',
      'schedule', 'report', 'supporting', 'mixed', 'unknown'
    )
  );

ALTER TABLE public.project_documents
  DROP CONSTRAINT IF EXISTS project_documents_analyzer_class_source_check;

ALTER TABLE public.project_documents
  ADD CONSTRAINT project_documents_analyzer_class_source_check
  CHECK (
    analyzer_class_source IS NULL OR analyzer_class_source IN (
      'auto', 'user', 'filename', 'sampled_ai'
    )
  );

ALTER TABLE public.project_documents
  DROP CONSTRAINT IF EXISTS project_documents_analyzer_processing_status_check;

ALTER TABLE public.project_documents
  ADD CONSTRAINT project_documents_analyzer_processing_status_check
  CHECK (
    analyzer_processing_status IN (
      'not_started', 'queued', 'processing', 'completed',
      'partial', 'failed', 'cancelled', 'unsupported'
    )
  );

CREATE INDEX IF NOT EXISTS idx_project_documents_content_hash
  ON public.project_documents (project_id, content_hash)
  WHERE content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_documents_analyzer_class
  ON public.project_documents (project_id, analyzer_class);

CREATE TABLE IF NOT EXISTS public.code_analyzer_derived_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL CHECK (page_number >= 1),
  asset_type TEXT NOT NULL CHECK (asset_type IN (
    'raster', 'thumbnail', 'ocr_text', 'title_block_crop'
  )),
  content_hash TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  byte_size INTEGER,
  source_content_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT code_analyzer_derived_assets_unique
    UNIQUE (document_id, page_number, asset_type, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_code_analyzer_derived_assets_project
  ON public.code_analyzer_derived_assets (project_id, document_id);

ALTER TABLE public.code_analyzer_derived_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view derived assets for accessible projects"
  ON public.code_analyzer_derived_assets;
CREATE POLICY "Users can view derived assets for accessible projects"
  ON public.code_analyzer_derived_assets FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can insert derived assets for editable projects"
  ON public.code_analyzer_derived_assets;
CREATE POLICY "Users can insert derived assets for editable projects"
  ON public.code_analyzer_derived_assets FOR INSERT
  WITH CHECK (public.has_project_editor_access(auth.uid(), project_id));

ALTER TABLE public.code_analyzer_sheets
  ADD COLUMN IF NOT EXISTS derived_asset_id UUID
    REFERENCES public.code_analyzer_derived_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_content_hash TEXT;

CREATE TABLE IF NOT EXISTS public.code_analyzer_ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  content_fingerprint TEXT NOT NULL DEFAULT '',
  analyzer_class TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  progress_phase TEXT NOT NULL DEFAULT 'queued',
  progress_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_pages INTEGER,
  processed_pages INTEGER NOT NULL DEFAULT 0,
  failed_pages INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  priority SMALLINT NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  last_error TEXT,
  error_code TEXT,
  worker_version TEXT,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT code_analyzer_ingestion_jobs_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'partial', 'failed', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_code_analyzer_ingestion_one_active
  ON public.code_analyzer_ingestion_jobs (document_id, content_fingerprint)
  WHERE status IN ('pending', 'processing') AND cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_code_analyzer_ingestion_claim
  ON public.code_analyzer_ingestion_jobs (status, available_at, priority, created_at)
  WHERE status = 'pending' AND cancelled_at IS NULL;

ALTER TABLE public.code_analyzer_ingestion_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view code analyzer ingestion jobs"
  ON public.code_analyzer_ingestion_jobs;
CREATE POLICY "Users can view code analyzer ingestion jobs"
  ON public.code_analyzer_ingestion_jobs FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE OR REPLACE FUNCTION public.enqueue_code_analyzer_ingestion_job(
  p_project_id UUID,
  p_document_id UUID,
  p_user_id UUID,
  p_content_fingerprint TEXT,
  p_analyzer_class TEXT DEFAULT NULL
)
RETURNS TABLE (job public.code_analyzer_ingestion_jobs, reused_existing BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_doc public.project_documents;
  v_existing public.code_analyzer_ingestion_jobs;
  v_inserted public.code_analyzer_ingestion_jobs;
BEGIN
  IF NOT public.has_project_editor_access(p_user_id, p_project_id) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  SELECT * INTO v_doc FROM public.project_documents
  WHERE id = p_document_id AND project_id = p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document not found for project'; END IF;

  SELECT * INTO v_existing FROM public.code_analyzer_ingestion_jobs j
  WHERE j.document_id = p_document_id
    AND j.content_fingerprint = COALESCE(NULLIF(trim(p_content_fingerprint), ''), v_doc.content_hash, '')
    AND j.status IN ('pending', 'processing') AND j.cancelled_at IS NULL
  ORDER BY j.created_at DESC LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    job := v_existing; reused_existing := TRUE; RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.code_analyzer_ingestion_jobs (
    project_id, document_id, user_id, content_fingerprint, analyzer_class, status, progress_phase
  ) VALUES (
    p_project_id, p_document_id, p_user_id,
    COALESCE(NULLIF(trim(p_content_fingerprint), ''), COALESCE(v_doc.content_hash, '')),
    p_analyzer_class, 'pending', 'queued'
  ) RETURNING * INTO v_inserted;

  UPDATE public.project_documents
  SET analyzer_processing_status = 'queued', analyzer_class = COALESCE(p_analyzer_class, analyzer_class)
  WHERE id = p_document_id;

  job := v_inserted; reused_existing := FALSE; RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_code_analyzer_ingestion_job(UUID, UUID, UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_code_analyzer_ingestion_job(
  p_worker_id TEXT, p_lease_ttl_seconds INTEGER DEFAULT 180
)
RETURNS public.code_analyzer_ingestion_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_job public.code_analyzer_ingestion_jobs; v_ttl INTEGER;
BEGIN
  v_ttl := GREATEST(30, COALESCE(p_lease_ttl_seconds, 180));
  SELECT j.* INTO v_job FROM public.code_analyzer_ingestion_jobs j
  INNER JOIN public.project_documents d ON d.id = j.document_id
  WHERE j.status = 'pending' AND j.cancelled_at IS NULL
    AND j.attempt_count < j.max_attempts AND j.available_at <= now()
    AND (j.lease_expires_at IS NULL OR j.lease_expires_at < now())
  ORDER BY j.priority DESC, j.available_at ASC, j.created_at ASC
  LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
  IF NOT FOUND THEN
    SELECT j.* INTO v_job FROM public.code_analyzer_ingestion_jobs j
    WHERE j.status = 'processing' AND j.cancelled_at IS NULL
      AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at < now()
    ORDER BY j.lease_expires_at ASC LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;
  UPDATE public.code_analyzer_ingestion_jobs SET
    status = 'processing', lease_owner = p_worker_id,
    lease_expires_at = now() + make_interval(secs => v_ttl),
    last_heartbeat_at = now(), started_at = COALESCE(started_at, now()),
    attempt_count = attempt_count + 1, updated_at = now()
  WHERE id = v_job.id RETURNING * INTO v_job;
  UPDATE public.project_documents SET analyzer_processing_status = 'processing' WHERE id = v_job.document_id;
  RETURN v_job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_code_analyzer_ingestion_job(TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.heartbeat_code_analyzer_ingestion_job(
  p_job_id UUID, p_worker_id TEXT, p_lease_ttl_seconds INTEGER DEFAULT 180
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ttl INTEGER; v_updated INTEGER;
BEGIN
  v_ttl := GREATEST(30, COALESCE(p_lease_ttl_seconds, 180));
  UPDATE public.code_analyzer_ingestion_jobs SET
    lease_expires_at = now() + make_interval(secs => v_ttl), last_heartbeat_at = now(), updated_at = now()
  WHERE id = p_job_id AND lease_owner = p_worker_id AND status = 'processing' AND cancelled_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT; RETURN v_updated > 0;
END; $$;

GRANT EXECUTE ON FUNCTION public.heartbeat_code_analyzer_ingestion_job(UUID, TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.release_code_analyzer_ingestion_job(
  p_job_id UUID, p_worker_id TEXT, p_status TEXT,
  p_progress_phase TEXT DEFAULT NULL, p_total_pages INTEGER DEFAULT NULL,
  p_processed_pages INTEGER DEFAULT NULL, p_failed_pages INTEGER DEFAULT NULL,
  p_last_error TEXT DEFAULT NULL, p_error_code TEXT DEFAULT NULL,
  p_progress_detail JSONB DEFAULT NULL, p_available_at TIMESTAMPTZ DEFAULT NULL
) RETURNS public.code_analyzer_ingestion_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job public.code_analyzer_ingestion_jobs;
BEGIN
  SELECT * INTO v_job FROM public.code_analyzer_ingestion_jobs
  WHERE id = p_job_id AND lease_owner = p_worker_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_job.status IN ('completed', 'cancelled') AND p_status IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'cannot re-open terminal job';
  END IF;
  UPDATE public.code_analyzer_ingestion_jobs SET
    status = p_status, progress_phase = COALESCE(p_progress_phase, progress_phase),
    total_pages = COALESCE(p_total_pages, total_pages),
    processed_pages = COALESCE(p_processed_pages, processed_pages),
    failed_pages = COALESCE(p_failed_pages, failed_pages),
    last_error = p_last_error, error_code = p_error_code,
    progress_detail = COALESCE(p_progress_detail, progress_detail),
    available_at = COALESCE(p_available_at, available_at),
    completed_at = CASE WHEN p_status IN ('completed', 'partial', 'failed', 'cancelled') THEN now() ELSE completed_at END,
    lease_owner = CASE WHEN p_status = 'processing' THEN lease_owner ELSE NULL END,
    lease_expires_at = CASE WHEN p_status = 'processing' THEN lease_expires_at ELSE NULL END,
    updated_at = now()
  WHERE id = p_job_id RETURNING * INTO v_job;
  IF p_status IN ('completed', 'partial', 'failed', 'cancelled') THEN
    UPDATE public.project_documents SET analyzer_processing_status = p_status WHERE id = v_job.document_id;
  END IF;
  RETURN v_job;
END; $$;

GRANT EXECUTE ON FUNCTION public.release_code_analyzer_ingestion_job(
  UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT, JSONB, TIMESTAMPTZ
) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_code_analyzer_ingestion_job(p_job_id UUID, p_user_id UUID)
RETURNS public.code_analyzer_ingestion_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job public.code_analyzer_ingestion_jobs;
BEGIN
  SELECT * INTO v_job FROM public.code_analyzer_ingestion_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'job not found'; END IF;
  IF NOT public.has_project_editor_access(p_user_id, v_job.project_id) THEN RAISE EXCEPTION 'access denied'; END IF;
  IF v_job.status IN ('completed', 'failed', 'cancelled') THEN RETURN v_job; END IF;
  UPDATE public.code_analyzer_ingestion_jobs SET
    status = 'cancelled', progress_phase = 'cancelled', cancelled_at = now(), cancelled_by = p_user_id,
    lease_owner = NULL, lease_expires_at = NULL, completed_at = now(), updated_at = now()
  WHERE id = p_job_id RETURNING * INTO v_job;
  UPDATE public.project_documents SET analyzer_processing_status = 'cancelled' WHERE id = v_job.document_id;
  RETURN v_job;
END; $$;

GRANT EXECUTE ON FUNCTION public.cancel_code_analyzer_ingestion_job(UUID, UUID) TO authenticated;
