-- Central permit repository (Phase 1). See docs/permit-repository/MASTER_PLAN.md §4–§5.
-- Additive only: creates new tables, functions, policies and one private bucket.
-- Does NOT alter any existing table, policy or function. Re-runnable.
-- Depends on existing: auth.users, public.portal_credentials, public.projects, public.tenants,
--   public.platform_audit_events, public.is_platform_admin, public.is_user_active,
--   public.credential_has_grant, public.has_tenant_access, public._admin_require_platform_admin.
-- Rollback policy (D-009): disable, never drop collected data. Reversal only via a reviewed forward migration.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.permit_sync_sources (
  credential_id UUID PRIMARY KEY REFERENCES public.portal_credentials(id) ON DELETE CASCADE,
  adapter_key TEXT NOT NULL,
  automation_enabled BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('inactive', 'active', 'paused', 'needs_encryption', 'waiting_user', 'auth_failed')),
  last_login_ok_at TIMESTAMPTZ,
  last_error TEXT,
  consecutive_auth_failures INTEGER NOT NULL DEFAULT 0,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.permits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adapter_key TEXT NOT NULL,
  portal_record_id TEXT NOT NULL,
  jurisdiction TEXT,
  permit_number TEXT,
  permit_number_normalized TEXT,
  title TEXT,
  description TEXT,
  address TEXT,
  status TEXT,
  status_raw TEXT,
  review_type TEXT,
  review_cycle INTEGER,
  job_class TEXT,
  owner_org TEXT,
  contact_org TEXT,
  project_start_date DATE,
  project_end_date DATE,
  total_files INTEGER,
  unresolved_comments INTEGER,
  uncompleted_tasks INTEGER,
  available_sections TEXT[],
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ,
  last_changed_at TIMESTAMPTZ,
  removed_from_portal_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_tsv TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig,
      coalesce(permit_number, '') || ' ' || coalesce(title, '') || ' ' || coalesce(address, '') || ' ' ||
      coalesce(description, '') || ' ' || coalesce(status_raw, ''))
  ) STORED,
  CONSTRAINT permits_portal_identity UNIQUE (adapter_key, portal_record_id)
);

CREATE TABLE IF NOT EXISTS public.permit_source_links (
  permit_id UUID NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,
  credential_id UUID NOT NULL REFERENCES public.portal_credentials(id) ON DELETE CASCADE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_run_id UUID,
  unseen_since TIMESTAMPTZ,
  PRIMARY KEY (permit_id, credential_id)
);

CREATE TABLE IF NOT EXISTS public.permit_section_state (
  permit_id UUID NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('ok', 'partial', 'absent', 'failed', 'suspect_empty')),
  source_kind TEXT CHECK (source_kind IN ('json', 'html', 'report', 'dom')),
  content_hash TEXT,
  item_count INTEGER,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ok_at TIMESTAMPTZ,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (permit_id, section)
);

CREATE TABLE IF NOT EXISTS public.permit_review_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id UUID NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,
  portal_comment_key TEXT NOT NULL,
  ref_number INTEGER,
  workflow_portal_id TEXT,
  department TEXT,
  reviewer_name TEXT,
  reviewer_role TEXT,
  cycle INTEGER,
  status TEXT,
  comment_type TEXT,
  body TEXT,
  file_name TEXT,
  reviewed_at TIMESTAMPTZ,
  response_required BOOLEAN,
  source_kind TEXT CHECK (source_kind IN ('json', 'html', 'report', 'dom')),
  content_hash TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_tsv TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig, coalesce(department, '') || ' ' || coalesce(reviewer_name, '') || ' ' || coalesce(body, ''))
  ) STORED,
  CONSTRAINT permit_review_comments_key UNIQUE (permit_id, portal_comment_key)
);

CREATE TABLE IF NOT EXISTS public.permit_review_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id UUID NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,
  portal_response_key TEXT NOT NULL,
  comment_key TEXT NOT NULL,
  comment_id UUID REFERENCES public.permit_review_comments(id) ON DELETE SET NULL,
  seq INTEGER NOT NULL,
  responder_role TEXT,
  responder_name TEXT,
  responded_at TIMESTAMPTZ,
  body TEXT,
  content_hash TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT permit_review_responses_key UNIQUE (permit_id, portal_response_key)
);

CREATE TABLE IF NOT EXISTS public.permit_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id UUID NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,
  portal_workflow_id TEXT NOT NULL,
  name TEXT,
  subtype TEXT,
  state TEXT,
  current_activity TEXT,
  coordinator_group TEXT,
  version_num INTEGER,
  version_title TEXT,
  integration_mode TEXT,
  started_at TIMESTAMPTZ,
  portal_updated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  content_hash TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT permit_workflows_key UNIQUE (permit_id, portal_workflow_id)
);

CREATE TABLE IF NOT EXISTS public.permit_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id UUID NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,
  portal_task_id TEXT NOT NULL,
  workflow_portal_id TEXT,
  name TEXT,
  group_name TEXT,
  status TEXT,
  accepted BOOLEAN,
  assigned_to_current_account BOOLEAN,
  started_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  content_hash TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT permit_tasks_key UNIQUE (permit_id, portal_task_id)
);

CREATE TABLE IF NOT EXISTS public.permit_document_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id UUID NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,
  portal_folder_id TEXT NOT NULL,
  name TEXT,
  folder_type INTEGER,
  parent_portal_folder_id TEXT,
  files_count INTEGER,
  new_files_count INTEGER,
  files_with_markups_count INTEGER,
  download_permitted BOOLEAN,
  content_hash TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT permit_document_folders_key UNIQUE (permit_id, portal_folder_id)
);

-- portal_file_id is a new id per version in ProjectDox, so it is the row key; version is kept for display.
CREATE TABLE IF NOT EXISTS public.permit_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id UUID NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,
  portal_file_id TEXT NOT NULL,
  version INTEGER,
  portal_folder_id TEXT,
  folder_name TEXT,
  file_name TEXT,
  original_file_name TEXT,
  file_status TEXT,
  file_type_id INTEGER,
  size_bytes BIGINT,
  page_count INTEGER,
  sheet_size TEXT,
  review_cycle INTEGER,
  has_markups BOOLEAN,
  uploaded_by_org TEXT,
  uploaded_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  portal_modified_at TIMESTAMPTZ,
  download_permitted BOOLEAN,
  download_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (download_status IN ('not_permitted', 'not_requested', 'pending', 'stored', 'failed')),
  storage_path TEXT,
  sha256 TEXT,
  downloaded_at TIMESTAMPTZ,
  content_hash TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT permit_documents_key UNIQUE (permit_id, portal_file_id),
  CONSTRAINT permit_documents_file_version UNIQUE (permit_id, portal_file_id, version)
);

CREATE TABLE IF NOT EXISTS public.permit_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id UUID NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,
  report_key TEXT NOT NULL,
  name TEXT,
  category TEXT,
  portal_report_id TEXT,
  content_hash TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT permit_reports_key UNIQUE (permit_id, report_key)
);

-- Append-only evidence. Inserted only when the section payload hash changes.
CREATE TABLE IF NOT EXISTS public.permit_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id UUID NOT NULL REFERENCES public.permits(id) ON DELETE RESTRICT,
  section TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('json', 'html', 'report', 'dom')),
  content_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_bytes INTEGER,
  run_id UUID,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT permit_snapshots_dedup UNIQUE (permit_id, section, content_hash)
);

-- Append-only change history.
CREATE TABLE IF NOT EXISTS public.permit_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id UUID NOT NULL REFERENCES public.permits(id) ON DELETE RESTRICT,
  section TEXT NOT NULL,
  entity_table TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('created', 'updated', 'removed', 'restored')),
  field_changes JSONB,
  run_id UUID,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.permit_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grantee_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  grantee_tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('permit', 'adapter', 'source_credential')),
  permit_id UUID REFERENCES public.permits(id) ON DELETE CASCADE,
  adapter_key TEXT,
  credential_id UUID REFERENCES public.portal_credentials(id) ON DELETE CASCADE,
  note TEXT,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT permit_access_grants_one_grantee CHECK ((grantee_user_id IS NULL) <> (grantee_tenant_id IS NULL)),
  CONSTRAINT permit_access_grants_scope_ref CHECK (
    (scope_type = 'permit' AND permit_id IS NOT NULL AND adapter_key IS NULL AND credential_id IS NULL) OR
    (scope_type = 'adapter' AND adapter_key IS NOT NULL AND permit_id IS NULL AND credential_id IS NULL) OR
    (scope_type = 'source_credential' AND credential_id IS NOT NULL AND permit_id IS NULL AND adapter_key IS NULL)
  )
);

-- Link only. Grants no data access (D-006).
CREATE TABLE IF NOT EXISTS public.project_permits (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  permit_id UUID NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,
  linked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, permit_id)
);

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_permits_permit_number_normalized ON public.permits (permit_number_normalized);
CREATE INDEX IF NOT EXISTS idx_permits_status ON public.permits (adapter_key, status);
CREATE INDEX IF NOT EXISTS idx_permits_search_tsv ON public.permits USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS idx_permit_source_links_credential ON public.permit_source_links (credential_id);
CREATE INDEX IF NOT EXISTS idx_permit_review_comments_permit ON public.permit_review_comments (permit_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_permit_review_comments_search ON public.permit_review_comments USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS idx_permit_review_responses_comment ON public.permit_review_responses (comment_id);
CREATE INDEX IF NOT EXISTS idx_permit_tasks_permit ON public.permit_tasks (permit_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_permit_workflows_permit ON public.permit_workflows (permit_id);
CREATE INDEX IF NOT EXISTS idx_permit_documents_permit_folder ON public.permit_documents (permit_id, portal_folder_id);
CREATE INDEX IF NOT EXISTS idx_permit_documents_storage_path ON public.permit_documents (storage_path) WHERE storage_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_permit_snapshots_permit_section ON public.permit_snapshots (permit_id, section, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_permit_changes_permit_detected ON public.permit_changes (permit_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_permit_access_grants_user ON public.permit_access_grants (grantee_user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_permit_access_grants_tenant ON public.permit_access_grants (grantee_tenant_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_permits_permit ON public.project_permits (permit_id);

-- ---------------------------------------------------------------------------
-- 3. Append-only guard for evidence tables
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._permit_evidence_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('permit_repo.allow_evidence_purge', true) = 'on' THEN
    RETURN COALESCE(OLD, NEW);
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS permit_snapshots_append_only ON public.permit_snapshots;
CREATE TRIGGER permit_snapshots_append_only
BEFORE UPDATE OR DELETE ON public.permit_snapshots
FOR EACH ROW EXECUTE FUNCTION public._permit_evidence_append_only();

DROP TRIGGER IF EXISTS permit_changes_append_only ON public.permit_changes;
CREATE TRIGGER permit_changes_append_only
BEFORE UPDATE OR DELETE ON public.permit_changes
FOR EACH ROW EXECUTE FUNCTION public._permit_evidence_append_only();

-- TRUNCATE skips row triggers, so it needs its own statement-level guard.
DROP TRIGGER IF EXISTS permit_snapshots_no_truncate ON public.permit_snapshots;
CREATE TRIGGER permit_snapshots_no_truncate
BEFORE TRUNCATE ON public.permit_snapshots
FOR EACH STATEMENT EXECUTE FUNCTION public._permit_evidence_append_only();

DROP TRIGGER IF EXISTS permit_changes_no_truncate ON public.permit_changes;
CREATE TRIGGER permit_changes_no_truncate
BEFORE TRUNCATE ON public.permit_changes
FOR EACH STATEMENT EXECUTE FUNCTION public._permit_evidence_append_only();

-- ---------------------------------------------------------------------------
-- 4. Access model
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.user_can_read_permit(p_user_id UUID, p_permit_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_adapter TEXT;
BEGIN
  IF p_user_id IS NULL OR p_permit_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF public.is_platform_admin(p_user_id) THEN
    RETURN TRUE;
  END IF;

  IF NOT public.is_user_active(p_user_id) THEN
    RETURN FALSE;
  END IF;

  SELECT p.adapter_key INTO v_adapter FROM public.permits p WHERE p.id = p_permit_id;
  IF v_adapter IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Provenance: a 'use' grant on a credential that sees this permit.
  IF EXISTS (
    SELECT 1 FROM public.permit_source_links l
    WHERE l.permit_id = p_permit_id
      AND public.credential_has_grant(p_user_id, l.credential_id, 'use')
  ) THEN
    RETURN TRUE;
  END IF;

  -- Explicit, unrevoked grants to the user or to a tenant the user belongs to.
  RETURN EXISTS (
    SELECT 1 FROM public.permit_access_grants g
    WHERE g.revoked_at IS NULL
      AND (g.grantee_user_id = p_user_id
           OR (g.grantee_tenant_id IS NOT NULL AND public.has_tenant_access(p_user_id, g.grantee_tenant_id)))
      AND (
        (g.scope_type = 'permit' AND g.permit_id = p_permit_id)
        OR (g.scope_type = 'adapter' AND g.adapter_key = v_adapter)
        OR (g.scope_type = 'source_credential' AND EXISTS (
              SELECT 1 FROM public.permit_source_links l
              WHERE l.permit_id = p_permit_id AND l.credential_id = g.credential_id))
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_read_permit(p_permit_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_can_read_permit(auth.uid(), p_permit_id);
$$;

-- Storage path convention: <permit_id>/<portal_file_id>/<file name>. Returns NULL for malformed paths.
CREATE OR REPLACE FUNCTION public._permit_storage_permit_id(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_first TEXT := split_part(coalesce(p_name, ''), '/', 1);
BEGIN
  IF v_first ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN v_first::uuid;
  END IF;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Row level security (read-only for authenticated; writes via service-role RPCs)
-- ---------------------------------------------------------------------------

ALTER TABLE public.permit_sync_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_source_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_section_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_review_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_review_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_document_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_permits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins read permit sync sources" ON public.permit_sync_sources;
CREATE POLICY "Platform admins read permit sync sources" ON public.permit_sync_sources
FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Readable permits" ON public.permits;
CREATE POLICY "Readable permits" ON public.permits
FOR SELECT TO authenticated USING (public.can_read_permit(id));

DROP POLICY IF EXISTS "Readable permit source links" ON public.permit_source_links;
CREATE POLICY "Readable permit source links" ON public.permit_source_links
FOR SELECT TO authenticated USING (public.can_read_permit(permit_id));

DROP POLICY IF EXISTS "Readable permit section state" ON public.permit_section_state;
CREATE POLICY "Readable permit section state" ON public.permit_section_state
FOR SELECT TO authenticated USING (public.can_read_permit(permit_id));

DROP POLICY IF EXISTS "Readable permit review comments" ON public.permit_review_comments;
CREATE POLICY "Readable permit review comments" ON public.permit_review_comments
FOR SELECT TO authenticated USING (public.can_read_permit(permit_id));

DROP POLICY IF EXISTS "Readable permit review responses" ON public.permit_review_responses;
CREATE POLICY "Readable permit review responses" ON public.permit_review_responses
FOR SELECT TO authenticated USING (public.can_read_permit(permit_id));

DROP POLICY IF EXISTS "Readable permit workflows" ON public.permit_workflows;
CREATE POLICY "Readable permit workflows" ON public.permit_workflows
FOR SELECT TO authenticated USING (public.can_read_permit(permit_id));

DROP POLICY IF EXISTS "Readable permit tasks" ON public.permit_tasks;
CREATE POLICY "Readable permit tasks" ON public.permit_tasks
FOR SELECT TO authenticated USING (public.can_read_permit(permit_id));

DROP POLICY IF EXISTS "Readable permit document folders" ON public.permit_document_folders;
CREATE POLICY "Readable permit document folders" ON public.permit_document_folders
FOR SELECT TO authenticated USING (public.can_read_permit(permit_id));

DROP POLICY IF EXISTS "Readable permit documents" ON public.permit_documents;
CREATE POLICY "Readable permit documents" ON public.permit_documents
FOR SELECT TO authenticated USING (public.can_read_permit(permit_id));

DROP POLICY IF EXISTS "Readable permit reports" ON public.permit_reports;
CREATE POLICY "Readable permit reports" ON public.permit_reports
FOR SELECT TO authenticated USING (public.can_read_permit(permit_id));

DROP POLICY IF EXISTS "Readable permit snapshots" ON public.permit_snapshots;
CREATE POLICY "Readable permit snapshots" ON public.permit_snapshots
FOR SELECT TO authenticated USING (public.can_read_permit(permit_id));

DROP POLICY IF EXISTS "Readable permit changes" ON public.permit_changes;
CREATE POLICY "Readable permit changes" ON public.permit_changes
FOR SELECT TO authenticated USING (public.can_read_permit(permit_id));

DROP POLICY IF EXISTS "Own or admin permit access grants" ON public.permit_access_grants;
CREATE POLICY "Own or admin permit access grants" ON public.permit_access_grants
FOR SELECT TO authenticated USING (
  public.is_platform_admin(auth.uid()) OR grantee_user_id = auth.uid()
);

DROP POLICY IF EXISTS "Readable project permit links" ON public.project_permits;
CREATE POLICY "Readable project permit links" ON public.project_permits
FOR SELECT TO authenticated USING (public.can_read_permit(permit_id));

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'permit_sync_sources', 'permits', 'permit_source_links', 'permit_section_state',
    'permit_review_comments', 'permit_review_responses', 'permit_workflows', 'permit_tasks',
    'permit_document_folders', 'permit_documents', 'permit_reports', 'permit_snapshots',
    'permit_changes', 'permit_access_grants', 'project_permits'
  ] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
  REVOKE UPDATE, DELETE, TRUNCATE ON public.permit_snapshots, public.permit_changes FROM service_role;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Ingestion internals
-- ---------------------------------------------------------------------------

-- Columns callers may never set through item fields.
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

-- Validates field names against the table and returns them normalised through the column types,
-- so values such as timestamps compare equal regardless of input formatting.
CREATE OR REPLACE FUNCTION public._permit_normalize_fields(p_table TEXT, p_fields JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_cols TEXT[];
  v_key TEXT;
  v_norm JSONB;
  v_out JSONB := '{}'::jsonb;
BEGIN
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT array_agg(a.attname::text) INTO v_cols
  FROM pg_attribute a
  WHERE a.attrelid = ('public.' || p_table)::regclass AND a.attnum > 0 AND NOT a.attisdropped;

  FOR v_key IN SELECT jsonb_object_keys(p_fields) LOOP
    IF NOT (v_key = ANY (v_cols)) OR v_key = ANY (public._permit_protected_columns()) THEN
      RAISE EXCEPTION 'field "%" is not writable on %', v_key, p_table USING ERRCODE = '22023';
    END IF;
  END LOOP;

  EXECUTE format('SELECT to_jsonb(r) FROM jsonb_populate_record(NULL::public.%I, $1) r', p_table)
    INTO v_norm USING p_fields;

  FOR v_key IN SELECT jsonb_object_keys(p_fields) LOOP
    v_out := v_out || jsonb_build_object(v_key, v_norm -> v_key);
  END LOOP;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public._permit_record_change(
  p_permit_id UUID, p_section TEXT, p_table TEXT, p_key TEXT, p_type TEXT, p_fields JSONB, p_run_id UUID, p_now TIMESTAMPTZ
)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO public.permit_changes (permit_id, section, entity_table, entity_key, change_type, field_changes, run_id, detected_at)
  VALUES (p_permit_id, p_section, p_table, p_key, p_type, p_fields, p_run_id, p_now);
$$;

-- Upserts one keyed row. Returns 'inserted' | 'updated' | 'unchanged' | 'restored'.
CREATE OR REPLACE FUNCTION public._permit_upsert_row(
  p_table TEXT, p_key_col TEXT, p_permit_id UUID, p_key TEXT, p_fields JSONB, p_hash TEXT,
  p_section TEXT, p_run_id UUID, p_now TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_norm JSONB := public._permit_normalize_fields(p_table, p_fields);
  v_old JSONB;
  v_new JSONB;
  v_diff JSONB := '{}'::jsonb;
  v_key TEXT;
  v_cols TEXT;
  v_was_removed BOOLEAN;
BEGIN
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.permit_id = $1 AND t.%I = $2', p_table, p_key_col)
    INTO v_old USING p_permit_id, p_key;

  IF v_old IS NULL THEN
    v_new := v_norm || jsonb_build_object(
      'permit_id', p_permit_id, p_key_col, p_key, 'content_hash', p_hash,
      'first_seen_at', p_now, 'last_seen_at', p_now, 'created_at', p_now, 'updated_at', p_now);
    SELECT string_agg(quote_ident(k), ', ') INTO v_cols FROM jsonb_object_keys(v_new) k;
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)',
      p_table, v_cols, v_cols, p_table) USING v_new;
    PERFORM public._permit_record_change(p_permit_id, p_section, p_table, p_key, 'created', NULL, p_run_id, p_now);
    RETURN 'inserted';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_norm) LOOP
    IF (v_old -> v_key) IS DISTINCT FROM (v_norm -> v_key) THEN
      v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('before', v_old -> v_key, 'after', v_norm -> v_key));
    END IF;
  END LOOP;
  v_was_removed := (v_old ->> 'removed_at') IS NOT NULL;

  IF v_diff = '{}'::jsonb THEN
    EXECUTE format('UPDATE public.%I SET last_seen_at = $1, removed_at = NULL%s WHERE permit_id = $2 AND %I = $3',
      p_table, CASE WHEN v_was_removed THEN ', updated_at = $1' ELSE '' END, p_key_col)
      USING p_now, p_permit_id, p_key;
    IF v_was_removed THEN
      PERFORM public._permit_record_change(p_permit_id, p_section, p_table, p_key, 'restored', NULL, p_run_id, p_now);
      RETURN 'restored';
    END IF;
    RETURN 'unchanged';
  END IF;

  v_new := v_norm || jsonb_build_object('content_hash', p_hash, 'last_seen_at', p_now, 'updated_at', p_now, 'removed_at', NULL);
  SELECT string_agg(quote_ident(k), ', ') INTO v_cols FROM jsonb_object_keys(v_new) k;
  EXECUTE format('UPDATE public.%I SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)) WHERE permit_id = $2 AND %I = $3',
    p_table, v_cols, v_cols, p_table, p_key_col) USING v_new, p_permit_id, p_key;
  PERFORM public._permit_record_change(p_permit_id, p_section, p_table, p_key,
    CASE WHEN v_was_removed THEN 'restored' ELSE 'updated' END, v_diff, p_run_id, p_now);
  RETURN 'updated';
END;
$$;

-- Upserts the permit identity row and returns (permit_id, created, changed).
CREATE OR REPLACE FUNCTION public._permit_upsert_permit(
  p_adapter_key TEXT, p_portal_record_id TEXT, p_fields JSONB, p_run_id UUID, p_now TIMESTAMPTZ,
  OUT permit_id UUID, OUT created BOOLEAN, OUT changed BOOLEAN
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_norm JSONB := public._permit_normalize_fields('permits', jsonb_strip_nulls(coalesce(p_fields, '{}'::jsonb)));
  v_old JSONB;
  v_new JSONB;
  v_diff JSONB := '{}'::jsonb;
  v_key TEXT;
  v_cols TEXT;
BEGIN
  IF p_adapter_key IS NULL OR p_adapter_key = '' OR p_portal_record_id IS NULL OR p_portal_record_id = '' THEN
    RAISE EXCEPTION 'adapter_key and portal_record_id are required' USING ERRCODE = '22023';
  END IF;

  SELECT to_jsonb(p) INTO v_old FROM public.permits p
  WHERE p.adapter_key = p_adapter_key AND p.portal_record_id = p_portal_record_id
  FOR UPDATE;

  IF v_old IS NULL THEN
    v_new := v_norm || jsonb_build_object(
      'adapter_key', p_adapter_key, 'portal_record_id', p_portal_record_id,
      'first_seen_at', p_now, 'last_seen_at', p_now, 'last_changed_at', p_now,
      'created_at', p_now, 'updated_at', p_now);
    SELECT string_agg(quote_ident(k), ', ') INTO v_cols FROM jsonb_object_keys(v_new) k;
    EXECUTE format('INSERT INTO public.permits (%s) SELECT %s FROM jsonb_populate_record(NULL::public.permits, $1) RETURNING id',
      v_cols, v_cols) INTO permit_id USING v_new;
    PERFORM public._permit_record_change(permit_id, 'permit', 'permits', p_portal_record_id, 'created', NULL, p_run_id, p_now);
    created := TRUE;
    changed := TRUE;
    RETURN;
  END IF;

  permit_id := (v_old ->> 'id')::uuid;
  created := FALSE;

  FOR v_key IN SELECT jsonb_object_keys(v_norm) LOOP
    IF (v_old -> v_key) IS DISTINCT FROM (v_norm -> v_key) THEN
      v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('before', v_old -> v_key, 'after', v_norm -> v_key));
    END IF;
  END LOOP;

  IF v_diff = '{}'::jsonb THEN
    UPDATE public.permits SET last_seen_at = p_now, removed_from_portal_at = NULL WHERE id = permit_id;
    changed := FALSE;
    RETURN;
  END IF;

  v_new := v_norm || jsonb_build_object('last_seen_at', p_now, 'last_changed_at', p_now, 'updated_at', p_now,
    'removed_from_portal_at', NULL);
  SELECT string_agg(quote_ident(k), ', ') INTO v_cols FROM jsonb_object_keys(v_new) k;
  EXECUTE format('UPDATE public.permits SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.permits, $1)) WHERE id = $2',
    v_cols, v_cols) USING v_new, permit_id;
  PERFORM public._permit_record_change(permit_id, 'permit', 'permits', p_portal_record_id, 'updated', v_diff, p_run_id, p_now);
  changed := TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public._permit_link_source(
  p_permit_id UUID, p_credential_id UUID, p_run_id UUID, p_now TIMESTAMPTZ
)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO public.permit_source_links (permit_id, credential_id, first_seen_at, last_seen_at, last_seen_run_id, unseen_since)
  SELECT p_permit_id, p_credential_id, p_now, p_now, p_run_id, NULL
  WHERE p_credential_id IS NOT NULL
  ON CONFLICT (permit_id, credential_id) DO UPDATE
    SET last_seen_at = EXCLUDED.last_seen_at, last_seen_run_id = EXCLUDED.last_seen_run_id, unseen_since = NULL;
$$;

-- Section → (table, key column) whitelist.
CREATE OR REPLACE FUNCTION public._permit_section_tables(p_section TEXT)
RETURNS TABLE (table_name TEXT, key_col TEXT)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT m.table_name, m.key_col FROM (VALUES
    ('reviews', 'permit_review_comments', 'portal_comment_key'),
    ('reviews', 'permit_review_responses', 'portal_response_key'),
    ('tasks', 'permit_tasks', 'portal_task_id'),
    ('workflows', 'permit_workflows', 'portal_workflow_id'),
    ('files', 'permit_document_folders', 'portal_folder_id'),
    ('files', 'permit_documents', 'portal_file_id'),
    ('reports', 'permit_reports', 'report_key')
  ) AS m(section, table_name, key_col)
  WHERE m.section = p_section;
$$;

CREATE OR REPLACE FUNCTION public._permit_known_sections()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY['status', 'info', 'reviews', 'tasks', 'workflows', 'files', 'reports']::text[];
$$;

-- ---------------------------------------------------------------------------
-- 7. Service-role ingestion RPCs
-- ---------------------------------------------------------------------------

-- Applies one permit's extraction atomically.
-- Section status semantics (D-012):
--   ok       full listing: upsert items and mark unlisted rows removed (unless suspiciously empty)
--   partial  upsert listed items only, never remove
--   absent   section not offered by the portal: keep existing rows untouched
--   failed   extraction failed: keep existing rows untouched
-- An 'ok' section with zero items while active rows exist is downgraded to 'suspect_empty'
-- unless the batch sets confirmed_empty = true (an explicit portal "0 records" signal).
CREATE OR REPLACE FUNCTION public.apply_permit_sync_batch(p_batch JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := coalesce((p_batch ->> 'captured_at')::timestamptz, now());
  v_adapter TEXT := p_batch ->> 'adapter_key';
  v_credential UUID := nullif(p_batch ->> 'credential_id', '')::uuid;
  v_run UUID := nullif(p_batch ->> 'run_id', '')::uuid;
  v_permit JSONB := p_batch -> 'permit';
  v_permit_id UUID;
  v_created BOOLEAN;
  v_changed BOOLEAN;
  v_sections JSONB := coalesce(p_batch -> 'sections', '{}'::jsonb);
  v_section TEXT;
  v_sec JSONB;
  v_status TEXT;
  v_tables JSONB;
  v_tname TEXT;
  v_map RECORD;
  v_items JSONB;
  v_item JSONB;
  v_keys TEXT[];
  v_result TEXT;
  v_total_items INTEGER;
  v_active_rows INTEGER;
  v_count INTEGER;
  v_sec_summary JSONB;
  v_summary JSONB := '{}'::jsonb;
  v_changes_before BIGINT;
  v_changes_after BIGINT;
  v_snap JSONB;
  v_snap_inserted INTEGER := 0;
  v_removed_key TEXT;
BEGIN
  IF v_adapter IS NULL OR v_permit IS NULL THEN
    RAISE EXCEPTION 'batch requires adapter_key and permit' USING ERRCODE = '22023';
  END IF;

  FOR v_section IN SELECT jsonb_object_keys(v_sections) LOOP
    IF NOT (v_section = ANY (public._permit_known_sections())) THEN
      RAISE EXCEPTION 'unknown section "%"', v_section USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT u.permit_id, u.created, u.changed INTO v_permit_id, v_created, v_changed
  FROM public._permit_upsert_permit(v_adapter, v_permit ->> 'portal_record_id', v_permit -> 'fields', v_run, v_now) u;

  SELECT count(*) INTO v_changes_before FROM public.permit_changes WHERE permit_id = v_permit_id;

  PERFORM public._permit_link_source(v_permit_id, v_credential, v_run, v_now);

  FOR v_section IN SELECT jsonb_object_keys(v_sections) LOOP
    v_sec := v_sections -> v_section;
    v_status := coalesce(v_sec ->> 'status', 'failed');
    IF v_status NOT IN ('ok', 'partial', 'absent', 'failed') THEN
      RAISE EXCEPTION 'invalid status "%" for section %', v_status, v_section USING ERRCODE = '22023';
    END IF;
    v_tables := coalesce(v_sec -> 'tables', '{}'::jsonb);
    v_sec_summary := jsonb_build_object('inserted', 0, 'updated', 0, 'unchanged', 0, 'restored', 0, 'removed', 0);

    FOR v_tname IN SELECT jsonb_object_keys(v_tables) LOOP
      IF NOT EXISTS (SELECT 1 FROM public._permit_section_tables(v_section) m WHERE m.table_name = v_tname) THEN
        RAISE EXCEPTION 'table "%" is not part of section %', v_tname, v_section USING ERRCODE = '22023';
      END IF;
    END LOOP;

    IF v_status = 'ok' THEN
      SELECT coalesce(sum(jsonb_array_length(value)), 0) INTO v_total_items FROM jsonb_each(v_tables);
      IF v_total_items = 0 AND NOT coalesce((v_sec ->> 'confirmed_empty')::boolean, false) THEN
        v_active_rows := 0;
        FOR v_map IN SELECT * FROM public._permit_section_tables(v_section) LOOP
          EXECUTE format('SELECT count(*) FROM public.%I WHERE permit_id = $1 AND removed_at IS NULL', v_map.table_name)
            INTO v_count USING v_permit_id;
          v_active_rows := v_active_rows + v_count;
        END LOOP;
        IF v_active_rows > 0 THEN
          v_status := 'suspect_empty';
        END IF;
      END IF;
    END IF;

    IF v_status IN ('ok', 'partial') THEN
      FOR v_map IN SELECT * FROM public._permit_section_tables(v_section) LOOP
        v_items := coalesce(v_tables -> v_map.table_name, '[]'::jsonb);
        v_keys := ARRAY[]::text[];
        FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
          IF coalesce(v_item ->> 'key', '') = '' THEN
            RAISE EXCEPTION 'item without key in %', v_map.table_name USING ERRCODE = '22023';
          END IF;
          IF (v_item ->> 'key') = ANY (v_keys) THEN
            RAISE EXCEPTION 'duplicate key "%" in %', v_item ->> 'key', v_map.table_name USING ERRCODE = '22023';
          END IF;
          v_keys := v_keys || (v_item ->> 'key');
          v_result := public._permit_upsert_row(v_map.table_name, v_map.key_col, v_permit_id, v_item ->> 'key',
            coalesce(v_item -> 'fields', '{}'::jsonb), v_item ->> 'hash', v_section, v_run, v_now);
          v_sec_summary := jsonb_set(v_sec_summary, ARRAY[v_result], to_jsonb((v_sec_summary ->> v_result)::int + 1));
        END LOOP;

        IF v_status = 'ok' THEN
          FOR v_removed_key IN EXECUTE format(
            'UPDATE public.%I SET removed_at = $3, updated_at = $3 WHERE permit_id = $1 AND removed_at IS NULL AND NOT (%I = ANY ($2)) RETURNING %I',
            v_map.table_name, v_map.key_col, v_map.key_col) USING v_permit_id, v_keys, v_now
          LOOP
            PERFORM public._permit_record_change(v_permit_id, v_section, v_map.table_name, v_removed_key, 'removed', NULL, v_run, v_now);
            v_sec_summary := jsonb_set(v_sec_summary, '{removed}', to_jsonb((v_sec_summary ->> 'removed')::int + 1));
          END LOOP;
        END IF;
      END LOOP;
    END IF;

    INSERT INTO public.permit_section_state AS s (
      permit_id, section, status, source_kind, content_hash, item_count, last_attempt_at, last_ok_at, last_error, consecutive_failures)
    VALUES (
      v_permit_id, v_section, v_status, v_sec ->> 'source_kind', v_sec ->> 'hash',
      nullif(v_sec ->> 'item_count', '')::int, v_now,
      CASE WHEN v_status IN ('ok', 'partial', 'absent') THEN v_now END,
      CASE WHEN v_status IN ('failed', 'suspect_empty') THEN coalesce(v_sec ->> 'error', v_status) END,
      CASE WHEN v_status IN ('failed', 'suspect_empty') THEN 1 ELSE 0 END)
    ON CONFLICT (permit_id, section) DO UPDATE SET
      status = EXCLUDED.status,
      source_kind = coalesce(EXCLUDED.source_kind, s.source_kind),
      content_hash = CASE WHEN EXCLUDED.status IN ('ok', 'partial') THEN EXCLUDED.content_hash ELSE s.content_hash END,
      item_count = CASE WHEN EXCLUDED.status IN ('ok', 'partial') THEN EXCLUDED.item_count ELSE s.item_count END,
      last_attempt_at = EXCLUDED.last_attempt_at,
      last_ok_at = coalesce(EXCLUDED.last_ok_at, s.last_ok_at),
      last_error = EXCLUDED.last_error,
      consecutive_failures = CASE WHEN EXCLUDED.status IN ('failed', 'suspect_empty') THEN s.consecutive_failures + 1 ELSE 0 END;

    v_summary := v_summary || jsonb_build_object(v_section, v_sec_summary || jsonb_build_object('status', v_status));
  END LOOP;

  -- Link responses to their comments by key.
  UPDATE public.permit_review_responses r
  SET comment_id = c.id
  FROM public.permit_review_comments c
  WHERE r.permit_id = v_permit_id AND c.permit_id = v_permit_id
    AND c.portal_comment_key = r.comment_key
    AND r.comment_id IS DISTINCT FROM c.id;

  -- Download lifecycle follows the portal permission; metadata is always kept.
  UPDATE public.permit_documents
  SET download_status = 'not_permitted'
  WHERE permit_id = v_permit_id AND download_permitted IS FALSE AND download_status IN ('not_requested', 'pending');
  UPDATE public.permit_documents
  SET download_status = 'not_requested'
  WHERE permit_id = v_permit_id AND download_permitted IS TRUE AND download_status = 'not_permitted';

  FOR v_snap IN SELECT value FROM jsonb_array_elements(coalesce(p_batch -> 'snapshots', '[]'::jsonb)) LOOP
    IF NOT ((v_snap ->> 'section') = ANY (public._permit_known_sections())) THEN
      RAISE EXCEPTION 'unknown snapshot section "%"', v_snap ->> 'section' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.permit_snapshots (permit_id, section, source_kind, content_hash, payload, payload_bytes, run_id, captured_at)
    VALUES (v_permit_id, v_snap ->> 'section', v_snap ->> 'source_kind',
      coalesce(v_snap ->> 'hash', md5((v_snap -> 'payload')::text)),
      v_snap -> 'payload', octet_length((v_snap -> 'payload')::text), v_run, v_now)
    ON CONFLICT (permit_id, section, content_hash) DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_snap_inserted := v_snap_inserted + v_count;
  END LOOP;

  SELECT count(*) INTO v_changes_after FROM public.permit_changes WHERE permit_id = v_permit_id;

  UPDATE public.permits
  SET last_synced_at = v_now,
      last_changed_at = CASE WHEN v_changes_after > v_changes_before THEN v_now ELSE last_changed_at END
  WHERE id = v_permit_id;

  RETURN jsonb_build_object(
    'permit_id', v_permit_id,
    'permit_created', v_created,
    'changes', (v_changes_after - v_changes_before) + CASE WHEN v_changed THEN 1 ELSE 0 END,
    'snapshots_inserted', v_snap_inserted,
    'sections', v_summary
  );
END;
$$;

-- Applies a dashboard discovery listing. Removal marking happens only when the listing is complete
-- and its size equals the portal's reported total (integrity guard for discovery).
CREATE OR REPLACE FUNCTION public.apply_permit_discovery(p_discovery JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := coalesce((p_discovery ->> 'captured_at')::timestamptz, now());
  v_adapter TEXT := p_discovery ->> 'adapter_key';
  v_credential UUID := nullif(p_discovery ->> 'credential_id', '')::uuid;
  v_run UUID := nullif(p_discovery ->> 'run_id', '')::uuid;
  v_records JSONB := coalesce(p_discovery -> 'records', '[]'::jsonb);
  v_expected INTEGER := nullif(p_discovery ->> 'expected_total', '')::int;
  v_complete BOOLEAN;
  v_rec JSONB;
  v_ids UUID[] := ARRAY[]::uuid[];
  v_permit_id UUID;
  v_created BOOLEAN;
  v_changed BOOLEAN;
  v_created_count INTEGER := 0;
  v_changed_count INTEGER := 0;
  v_unseen INTEGER := 0;
  v_removed INTEGER := 0;
BEGIN
  IF v_adapter IS NULL THEN
    RAISE EXCEPTION 'discovery requires adapter_key' USING ERRCODE = '22023';
  END IF;

  FOR v_rec IN SELECT value FROM jsonb_array_elements(v_records) LOOP
    SELECT u.permit_id, u.created, u.changed INTO v_permit_id, v_created, v_changed
    FROM public._permit_upsert_permit(v_adapter, v_rec ->> 'portal_record_id', v_rec -> 'fields', v_run, v_now) u;
    IF v_permit_id = ANY (v_ids) THEN
      RAISE EXCEPTION 'duplicate portal_record_id "%" in discovery', v_rec ->> 'portal_record_id' USING ERRCODE = '22023';
    END IF;
    v_ids := v_ids || v_permit_id;
    PERFORM public._permit_link_source(v_permit_id, v_credential, v_run, v_now);
    IF v_created THEN v_created_count := v_created_count + 1;
    ELSIF v_changed THEN v_changed_count := v_changed_count + 1;
    END IF;
  END LOOP;

  v_complete := coalesce((p_discovery ->> 'complete')::boolean, false)
    AND v_expected IS NOT NULL AND v_expected = cardinality(v_ids);

  IF v_complete AND v_credential IS NOT NULL THEN
    UPDATE public.permit_source_links l
    SET unseen_since = v_now
    WHERE l.credential_id = v_credential AND l.unseen_since IS NULL AND NOT (l.permit_id = ANY (v_ids))
      AND EXISTS (SELECT 1 FROM public.permits p WHERE p.id = l.permit_id AND p.adapter_key = v_adapter);
    GET DIAGNOSTICS v_unseen = ROW_COUNT;

    UPDATE public.permits p
    SET removed_from_portal_at = v_now
    WHERE p.adapter_key = v_adapter AND p.removed_from_portal_at IS NULL
      AND EXISTS (SELECT 1 FROM public.permit_source_links l WHERE l.permit_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.permit_source_links l WHERE l.permit_id = p.id AND l.unseen_since IS NULL);
    GET DIAGNOSTICS v_removed = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'seen', cardinality(v_ids), 'created', v_created_count, 'changed', v_changed_count,
    'complete', v_complete, 'marked_unseen', v_unseen, 'marked_removed', v_removed);
END;
$$;

-- Records a stored document body (Phase 2 downloads). Metadata rows are never created here.
CREATE OR REPLACE FUNCTION public.record_permit_document_download(
  p_document_id UUID, p_status TEXT, p_storage_path TEXT DEFAULT NULL, p_sha256 TEXT DEFAULT NULL
)
RETURNS void
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
  IF p_status NOT IN ('pending', 'stored', 'failed') THEN
    RAISE EXCEPTION 'invalid download status %', p_status USING ERRCODE = '22023';
  END IF;
  IF v_doc.download_permitted IS NOT TRUE THEN
    RAISE EXCEPTION 'download not permitted for this document' USING ERRCODE = '42501';
  END IF;
  IF p_status = 'stored' AND (p_storage_path IS NULL OR public._permit_storage_permit_id(p_storage_path) IS DISTINCT FROM v_doc.permit_id) THEN
    RAISE EXCEPTION 'storage path must start with the permit id' USING ERRCODE = '22023';
  END IF;
  UPDATE public.permit_documents
  SET download_status = p_status,
      storage_path = CASE WHEN p_status = 'stored' THEN p_storage_path ELSE storage_path END,
      sha256 = CASE WHEN p_status = 'stored' THEN p_sha256 ELSE sha256 END,
      downloaded_at = CASE WHEN p_status = 'stored' THEN now() ELSE downloaded_at END,
      updated_at = now()
  WHERE id = p_document_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Management Admin RPCs (audited)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._permit_audit(p_action TEXT, p_target_type TEXT, p_target_id TEXT, p_before JSONB, p_after JSONB)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.platform_audit_events (actor_id, action, target_type, target_id, before_json, after_json, result)
  VALUES (auth.uid(), p_action, p_target_type, p_target_id, p_before, p_after, 'success');
$$;

CREATE OR REPLACE FUNCTION public.admin_grant_permit_access(
  p_scope_type TEXT,
  p_scope_ref TEXT,
  p_grantee_user_id UUID DEFAULT NULL,
  p_grantee_tenant_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  PERFORM public._admin_require_platform_admin();
  INSERT INTO public.permit_access_grants (
    grantee_user_id, grantee_tenant_id, scope_type, permit_id, adapter_key, credential_id, note, granted_by)
  VALUES (
    p_grantee_user_id, p_grantee_tenant_id, p_scope_type,
    CASE WHEN p_scope_type = 'permit' THEN p_scope_ref::uuid END,
    CASE WHEN p_scope_type = 'adapter' THEN p_scope_ref END,
    CASE WHEN p_scope_type = 'source_credential' THEN p_scope_ref::uuid END,
    p_note, auth.uid())
  RETURNING id INTO v_id;
  PERFORM public._permit_audit('permit_access.grant', 'permit_access_grant', v_id::text, NULL,
    jsonb_build_object('scope_type', p_scope_type, 'scope_ref', p_scope_ref,
      'grantee_user_id', p_grantee_user_id, 'grantee_tenant_id', p_grantee_tenant_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_permit_access(p_grant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_require_platform_admin();
  UPDATE public.permit_access_grants SET revoked_at = now(), revoked_by = auth.uid()
  WHERE id = p_grant_id AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active grant not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public._permit_audit('permit_access.revoke', 'permit_access_grant', p_grant_id::text, NULL, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_link_project_permit(p_project_id UUID, p_permit_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_require_platform_admin();
  INSERT INTO public.project_permits (project_id, permit_id, linked_by)
  VALUES (p_project_id, p_permit_id, auth.uid())
  ON CONFLICT (project_id, permit_id) DO NOTHING;
  PERFORM public._permit_audit('permit.link_project', 'permit', p_permit_id::text, NULL,
    jsonb_build_object('project_id', p_project_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_unlink_project_permit(p_project_id UUID, p_permit_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._admin_require_platform_admin();
  DELETE FROM public.project_permits WHERE project_id = p_project_id AND permit_id = p_permit_id;
  PERFORM public._permit_audit('permit.unlink_project', 'permit', p_permit_id::text,
    jsonb_build_object('project_id', p_project_id), NULL);
END;
$$;

-- Mirrors looksLikeEncryptedEnvelope in scraper-service/app/services/portal-credentials/portal-credentials-crypto.js:
-- the stored value is a JSON object {"pc_v":"1","iv":…,"at":…,"ct":…}; anything else is legacy plaintext.
CREATE OR REPLACE FUNCTION public._permit_credential_is_encrypted(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v JSONB;
BEGIN
  IF p_value IS NULL OR left(btrim(p_value), 1) <> '{' THEN
    RETURN FALSE;
  END IF;
  BEGIN
    v := btrim(p_value)::jsonb;
  EXCEPTION WHEN others THEN
    RETURN FALSE;
  END;
  RETURN COALESCE(
    jsonb_typeof(v) = 'object'
    AND jsonb_typeof(v -> 'pc_v') = 'string' AND v ->> 'pc_v' = '1'
    AND jsonb_typeof(v -> 'iv') = 'string' AND jsonb_typeof(v -> 'at') = 'string' AND jsonb_typeof(v -> 'ct') = 'string',
    FALSE);
END;
$$;

-- automation_enabled can only be switched on for credentials whose password is an AES-GCM envelope.
CREATE OR REPLACE FUNCTION public.admin_set_permit_sync_source(
  p_credential_id UUID, p_adapter_key TEXT, p_automation_enabled BOOLEAN DEFAULT false, p_settings JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before JSONB;
  v_encrypted BOOLEAN;
BEGIN
  PERFORM public._admin_require_platform_admin();
  SELECT public._permit_credential_is_encrypted(pc.portal_password) INTO v_encrypted FROM public.portal_credentials pc WHERE pc.id = p_credential_id;
  IF v_encrypted IS NULL THEN
    RAISE EXCEPTION 'credential not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_automation_enabled AND NOT v_encrypted THEN
    RAISE EXCEPTION 'credential must be encrypted before automation is enabled' USING ERRCODE = '22023';
  END IF;
  -- portal_credentials holds one row per permit; several rows can share one portal login.
  -- Only one of them may drive automation, otherwise the same account would hold parallel sessions.
  IF p_automation_enabled AND EXISTS (
    SELECT 1
    FROM public.permit_sync_sources s
    JOIN public.portal_credentials other ON other.id = s.credential_id
    JOIN public.portal_credentials me ON me.id = p_credential_id
    WHERE s.automation_enabled AND s.credential_id <> p_credential_id
      AND lower(other.jurisdiction) = lower(me.jurisdiction)
      AND lower(other.portal_username) = lower(me.portal_username)
  ) THEN
    RAISE EXCEPTION 'another credential for the same portal login already drives automation' USING ERRCODE = '23505';
  END IF;
  SELECT to_jsonb(s) - 'settings' INTO v_before FROM public.permit_sync_sources s WHERE s.credential_id = p_credential_id;
  INSERT INTO public.permit_sync_sources (credential_id, adapter_key, automation_enabled, status, settings)
  VALUES (p_credential_id, p_adapter_key, p_automation_enabled,
    CASE WHEN p_automation_enabled THEN 'active' WHEN v_encrypted THEN 'inactive' ELSE 'needs_encryption' END,
    coalesce(p_settings, '{}'::jsonb))
  ON CONFLICT (credential_id) DO UPDATE SET
    adapter_key = EXCLUDED.adapter_key,
    automation_enabled = EXCLUDED.automation_enabled,
    status = EXCLUDED.status,
    settings = EXCLUDED.settings,
    updated_at = now();
  PERFORM public._permit_audit('permit_sync_source.set', 'portal_credential', p_credential_id::text, v_before,
    jsonb_build_object('adapter_key', p_adapter_key, 'automation_enabled', p_automation_enabled));
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Function privileges
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public._permit_evidence_append_only()',
    'public.user_can_read_permit(uuid, uuid)',
    'public.can_read_permit(uuid)',
    'public._permit_storage_permit_id(text)',
    'public._permit_protected_columns()',
    'public._permit_normalize_fields(text, jsonb)',
    'public._permit_record_change(uuid, text, text, text, text, jsonb, uuid, timestamptz)',
    'public._permit_upsert_row(text, text, uuid, text, jsonb, text, text, uuid, timestamptz)',
    'public._permit_upsert_permit(text, text, jsonb, uuid, timestamptz)',
    'public._permit_link_source(uuid, uuid, uuid, timestamptz)',
    'public._permit_section_tables(text)',
    'public._permit_known_sections()',
    'public.apply_permit_sync_batch(jsonb)',
    'public.apply_permit_discovery(jsonb)',
    'public.record_permit_document_download(uuid, text, text, text)',
    'public._permit_audit(text, text, text, jsonb, jsonb)',
    'public._permit_credential_is_encrypted(text)',
    'public.admin_grant_permit_access(text, text, uuid, uuid, text)',
    'public.admin_revoke_permit_access(uuid)',
    'public.admin_link_project_permit(uuid, uuid)',
    'public.admin_unlink_project_permit(uuid, uuid)',
    'public.admin_set_permit_sync_source(uuid, text, boolean, jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_read_permit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._permit_storage_permit_id(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_read_permit(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_permit_sync_batch(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_permit_discovery(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_permit_document_download(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_grant_permit_access(text, text, uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revoke_permit_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_link_project_permit(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_unlink_project_permit(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_permit_sync_source(uuid, text, boolean, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Private document bucket. Reads gated by permit access; writes service role only.
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('permit-documents', 'permit-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Permit documents readable with permit access" ON storage.objects;
CREATE POLICY "Permit documents readable with permit access" ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'permit-documents'
  AND public.can_read_permit(public._permit_storage_permit_id(name))
  AND EXISTS (
    SELECT 1 FROM public.permit_documents d
    WHERE d.storage_path = storage.objects.name AND d.download_status = 'stored'
  )
);
