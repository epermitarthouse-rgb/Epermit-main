-- Proposed, not applied. New tables only; existing drawing chunks and analysis rows are unchanged.
-- Do not apply while a production analysis is running. Apply after that run finishes and deployment is approved.
-- Rollback: drop code_analyzer_drawing_facts, then drop code_analyzer_sheet_extractions.

CREATE TABLE IF NOT EXISTS public.code_analyzer_sheet_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.project_documents(id) ON DELETE CASCADE,
  sheet_id UUID NOT NULL REFERENCES public.code_analyzer_sheets(id) ON DELETE CASCADE,
  file_name TEXT,
  sheet_number TEXT,
  revision TEXT,
  source_fingerprint TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'extracting', 'partial', 'completed', 'failed')),
  methods TEXT[] NOT NULL DEFAULT '{}',
  coverage JSONB NOT NULL DEFAULT '{}'::jsonb,
  unreadable_regions JSONB NOT NULL DEFAULT '[]'::jsonb,
  limitations TEXT[] NOT NULL DEFAULT '{}',
  element_count INTEGER NOT NULL DEFAULT 0,
  dimension_count INTEGER NOT NULL DEFAULT 0,
  note_count INTEGER NOT NULL DEFAULT 0,
  schedule_count INTEGER NOT NULL DEFAULT 0,
  calculation_count INTEGER NOT NULL DEFAULT 0,
  reference_count INTEGER NOT NULL DEFAULT 0,
  schedule_row_count INTEGER NOT NULL DEFAULT 0,
  relationship_count INTEGER NOT NULL DEFAULT 0,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  retry_limit INTEGER NOT NULL DEFAULT 3 CHECK (retry_limit BETWEEN 0 AND 10),
  retry_status TEXT CHECK (retry_status IS NULL OR retry_status IN ('retryable', 'exhausted', 'not_needed')),
  last_attempt_at TIMESTAMPTZ,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT code_analyzer_sheet_extractions_identity
    UNIQUE (project_id, sheet_id, source_fingerprint, extractor_version)
);

COMMENT ON TABLE public.code_analyzer_sheet_extractions IS
  'Per-sheet structured extraction status. One row per source file revision and extractor version. A later revision supersedes; it does not overwrite the earlier fingerprint.';

CREATE INDEX IF NOT EXISTS idx_code_analyzer_sheet_extractions_active
  ON public.code_analyzer_sheet_extractions (project_id, sheet_id)
  WHERE superseded = false;

CREATE TABLE IF NOT EXISTS public.code_analyzer_drawing_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  extraction_id UUID NOT NULL REFERENCES public.code_analyzer_sheet_extractions(id) ON DELETE CASCADE,
  sheet_id UUID NOT NULL,
  fact_key TEXT NOT NULL,
  parent_fact_key TEXT,
  kind TEXT NOT NULL CHECK (kind IN (
    'element', 'dimension', 'note', 'schedule', 'schedule_row',
    'calculation', 'reference', 'relationship', 'evidence'
  )),
  element_type TEXT,
  tag TEXT,
  text TEXT,
  value_text TEXT,
  value_numeric NUMERIC,
  unit TEXT,
  original_text TEXT,
  binding_status TEXT NOT NULL DEFAULT 'read',
  observation_status TEXT,
  association_status TEXT,
  confidence NUMERIC,
  inferred BOOLEAN NOT NULL DEFAULT false,
  extraction_method TEXT,
  source_fingerprint TEXT NOT NULL,
  page_number INTEGER NOT NULL DEFAULT 1,
  bbox JSONB,
  related_fact_keys TEXT[] NOT NULL DEFAULT '{}',
  related_sheet_refs TEXT[] NOT NULL DEFAULT '{}',
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  superseded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT code_analyzer_drawing_facts_key UNIQUE (extraction_id, fact_key),
  CONSTRAINT code_analyzer_drawing_facts_sheet_fk
    FOREIGN KEY (sheet_id) REFERENCES public.code_analyzer_sheets(id) ON DELETE CASCADE,
  CONSTRAINT code_analyzer_drawing_facts_no_raster CHECK (
    octet_length(COALESCE(text, '')) <= 4000
    AND octet_length(COALESCE(properties::text, '')) <= 24000
    AND octet_length(COALESCE(bbox::text, '')) <= 2000
    AND position('imagebase64' in lower(COALESCE(properties::text, ''))) = 0
  )
);

COMMENT ON TABLE public.code_analyzer_drawing_facts IS
  'Queryable structured drawing facts. Unbound dimensions are not attached to an element. Embeddings stay on drawing chunks.';

CREATE INDEX IF NOT EXISTS idx_code_analyzer_drawing_facts_sheet
  ON public.code_analyzer_drawing_facts (project_id, sheet_id, kind)
  WHERE superseded = false;

CREATE INDEX IF NOT EXISTS idx_code_analyzer_drawing_facts_element
  ON public.code_analyzer_drawing_facts (project_id, element_type, tag)
  WHERE superseded = false;

CREATE INDEX IF NOT EXISTS idx_code_analyzer_drawing_facts_refs
  ON public.code_analyzer_drawing_facts USING gin (related_sheet_refs)
  WHERE superseded = false;

CREATE INDEX IF NOT EXISTS idx_code_analyzer_drawing_facts_parent
  ON public.code_analyzer_drawing_facts (extraction_id, parent_fact_key)
  WHERE parent_fact_key IS NOT NULL;

ALTER TABLE public.code_analyzer_sheet_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_analyzer_drawing_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view sheet extractions" ON public.code_analyzer_sheet_extractions;
CREATE POLICY "Users can view sheet extractions"
  ON public.code_analyzer_sheet_extractions FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can manage sheet extractions" ON public.code_analyzer_sheet_extractions;
CREATE POLICY "Users can manage sheet extractions"
  ON public.code_analyzer_sheet_extractions FOR ALL
  USING (public.has_project_editor_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_editor_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can view drawing facts" ON public.code_analyzer_drawing_facts;
CREATE POLICY "Users can view drawing facts"
  ON public.code_analyzer_drawing_facts FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can manage drawing facts" ON public.code_analyzer_drawing_facts;
CREATE POLICY "Users can manage drawing facts"
  ON public.code_analyzer_drawing_facts FOR ALL
  USING (public.has_project_editor_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_editor_access(auth.uid(), project_id));

DROP TRIGGER IF EXISTS update_code_analyzer_sheet_extractions_updated_at
  ON public.code_analyzer_sheet_extractions;
CREATE TRIGGER update_code_analyzer_sheet_extractions_updated_at
  BEFORE UPDATE ON public.code_analyzer_sheet_extractions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.code_analyzer_sheet_extractions_same_project()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  sheet_project UUID;
  document_project UUID;
BEGIN
  SELECT project_id INTO sheet_project
  FROM public.code_analyzer_sheets
  WHERE id = NEW.sheet_id;
  IF sheet_project IS NULL OR sheet_project <> NEW.project_id THEN
    RAISE EXCEPTION 'sheet extraction sheet is not in this project';
  END IF;

  IF NEW.document_id IS NOT NULL THEN
    SELECT project_id INTO document_project
    FROM public.project_documents
    WHERE id = NEW.document_id;
    IF document_project IS NULL OR document_project <> NEW.project_id THEN
      RAISE EXCEPTION 'sheet extraction document is not in this project';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS code_analyzer_sheet_extractions_same_project
  ON public.code_analyzer_sheet_extractions;
CREATE TRIGGER code_analyzer_sheet_extractions_same_project
  BEFORE INSERT OR UPDATE ON public.code_analyzer_sheet_extractions
  FOR EACH ROW
  EXECUTE FUNCTION public.code_analyzer_sheet_extractions_same_project();

REVOKE ALL ON FUNCTION public.code_analyzer_sheet_extractions_same_project() FROM PUBLIC, anon;

-- Reject cross-tenant or cross-revision fact rows even when written with service_role.
CREATE OR REPLACE FUNCTION public.code_analyzer_drawing_facts_same_project()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  extraction_project UUID;
  extraction_sheet UUID;
BEGIN
  SELECT project_id, sheet_id
    INTO extraction_project, extraction_sheet
  FROM public.code_analyzer_sheet_extractions
  WHERE id = NEW.extraction_id;

  IF extraction_project IS NULL
     OR extraction_project <> NEW.project_id
     OR extraction_sheet <> NEW.sheet_id THEN
    RAISE EXCEPTION 'drawing fact does not match extraction project and sheet';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS code_analyzer_drawing_facts_same_project
  ON public.code_analyzer_drawing_facts;
CREATE TRIGGER code_analyzer_drawing_facts_same_project
  BEFORE INSERT OR UPDATE ON public.code_analyzer_drawing_facts
  FOR EACH ROW
  EXECUTE FUNCTION public.code_analyzer_drawing_facts_same_project();

REVOKE ALL ON FUNCTION public.code_analyzer_drawing_facts_same_project() FROM PUBLIC, anon;

REVOKE ALL ON public.code_analyzer_sheet_extractions FROM PUBLIC, anon;
REVOKE ALL ON public.code_analyzer_drawing_facts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.code_analyzer_sheet_extractions TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.code_analyzer_drawing_facts TO authenticated, service_role;
