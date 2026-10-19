-- Proposed, not applied. Do not supabase db push this file with the backlog.
-- Project-scoped drawing evidence for hybrid retrieval.
-- Stores text, observations, identifiers, and PDF region coordinates.
-- Does not store raster bytes. Embeddings are optional.
-- Rollback: drop the function, drop the table, then drop document_annotations.review_status.

CREATE TABLE IF NOT EXISTS public.code_analyzer_drawing_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.project_documents(id) ON DELETE CASCADE,
  sheet_id UUID,
  file_name TEXT,
  sheet_number TEXT,
  sheet_title TEXT,
  discipline TEXT,
  revision TEXT,
  content_class TEXT,
  page_number INTEGER NOT NULL DEFAULT 1 CHECK (page_number >= 1),
  chunk_key TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL DEFAULT '',
  chunk_text TEXT NOT NULL CHECK (octet_length(chunk_text) <= 24000),
  source_type TEXT NOT NULL DEFAULT 'drawing',
  extraction_method TEXT NOT NULL DEFAULT 'pdfjs-text-layer',
  observations JSONB NOT NULL DEFAULT '[]'::jsonb,
  identifiers TEXT[] NOT NULL DEFAULT '{}',
  cross_sheet_refs TEXT[] NOT NULL DEFAULT '{}',
  region JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536),
  superseded BOOLEAN NOT NULL DEFAULT false,
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT code_analyzer_drawing_chunks_key UNIQUE (project_id, chunk_key),
  CONSTRAINT code_analyzer_drawing_chunks_observations_array
    CHECK (jsonb_typeof(observations) = 'array'),
  CONSTRAINT code_analyzer_drawing_chunks_sheet_fk
    FOREIGN KEY (sheet_id) REFERENCES public.code_analyzer_sheets(id) ON DELETE CASCADE,
  CONSTRAINT code_analyzer_drawing_chunks_no_raster CHECK (
    (region IS NULL OR (
      jsonb_typeof(region) = 'object'
      AND NOT (region ? 'imageBase64')
      AND NOT (region ? 'image')
    ))
    AND NOT (metadata ? 'imageBase64')
    AND NOT (metadata ? 'image')
    AND octet_length(observations::text) <= 48000
    AND octet_length(metadata::text) <= 48000
    AND octet_length(COALESCE(region::text, '')) <= 8000
    AND position('imagebase64' in lower(observations::text)) = 0
    AND position('imagebase64' in lower(metadata::text)) = 0
    AND position('imagebase64' in lower(COALESCE(region::text, ''))) = 0
  )
);

COMMENT ON TABLE public.code_analyzer_drawing_chunks IS
  'Drawing evidence chunks. Coordinates and text only. No PDF image bytes. Embedding may be null.';

CREATE INDEX IF NOT EXISTS idx_code_analyzer_drawing_chunks_active
  ON public.code_analyzer_drawing_chunks (project_id, document_id, page_number)
  WHERE superseded = false;

CREATE INDEX IF NOT EXISTS idx_code_analyzer_drawing_chunks_sheet_number
  ON public.code_analyzer_drawing_chunks (project_id, sheet_number)
  WHERE superseded = false;

CREATE INDEX IF NOT EXISTS idx_code_analyzer_drawing_chunks_identifiers
  ON public.code_analyzer_drawing_chunks USING gin (identifiers)
  WHERE superseded = false;

CREATE INDEX IF NOT EXISTS idx_code_analyzer_drawing_chunks_refs
  ON public.code_analyzer_drawing_chunks USING gin (cross_sheet_refs)
  WHERE superseded = false;

-- An ANN index can be added after rows exist. Exact identifiers do not need it.
-- CREATE INDEX ... USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50) WHERE embedding IS NOT NULL AND superseded = false;

ALTER TABLE public.code_analyzer_drawing_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view drawing chunks" ON public.code_analyzer_drawing_chunks;
CREATE POLICY "Users can view drawing chunks"
  ON public.code_analyzer_drawing_chunks FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can manage drawing chunks" ON public.code_analyzer_drawing_chunks;
CREATE POLICY "Users can manage drawing chunks"
  ON public.code_analyzer_drawing_chunks FOR ALL
  USING (public.has_project_editor_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_editor_access(auth.uid(), project_id));

DROP TRIGGER IF EXISTS update_code_analyzer_drawing_chunks_updated_at
  ON public.code_analyzer_drawing_chunks;
CREATE TRIGGER update_code_analyzer_drawing_chunks_updated_at
  BEFORE UPDATE ON public.code_analyzer_drawing_chunks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

REVOKE ALL ON public.code_analyzer_drawing_chunks FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.code_analyzer_drawing_chunks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.code_analyzer_drawing_chunks TO service_role;

-- Reject a chunk whose document or sheet belongs to a different project.
-- Security invoker so RLS still hides other tenants from a normal user.
CREATE OR REPLACE FUNCTION public.code_analyzer_drawing_chunks_same_project()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  sheet_project UUID;
  doc_project UUID;
BEGIN
  IF NEW.sheet_id IS NOT NULL THEN
    SELECT project_id INTO sheet_project
    FROM public.code_analyzer_sheets
    WHERE id = NEW.sheet_id;
    IF sheet_project IS NULL OR sheet_project <> NEW.project_id THEN
      RAISE EXCEPTION 'drawing chunk sheet is not in this project';
    END IF;
  END IF;
  IF NEW.document_id IS NOT NULL THEN
    SELECT project_id INTO doc_project
    FROM public.project_documents
    WHERE id = NEW.document_id;
    IF doc_project IS NULL OR doc_project <> NEW.project_id THEN
      RAISE EXCEPTION 'drawing chunk document is not in this project';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS code_analyzer_drawing_chunks_same_project
  ON public.code_analyzer_drawing_chunks;
CREATE TRIGGER code_analyzer_drawing_chunks_same_project
  BEFORE INSERT OR UPDATE ON public.code_analyzer_drawing_chunks
  FOR EACH ROW
  EXECUTE FUNCTION public.code_analyzer_drawing_chunks_same_project();

REVOKE ALL ON FUNCTION public.code_analyzer_drawing_chunks_same_project() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.match_analyzer_drawing_chunks(
  p_project_id UUID,
  p_query_embedding vector(1536) DEFAULT NULL,
  p_identifiers TEXT[] DEFAULT NULL,
  p_discipline TEXT DEFAULT NULL,
  p_match_count INT DEFAULT 8,
  p_revision TEXT DEFAULT NULL,
  p_document_ids UUID[] DEFAULT NULL,
  p_content_class TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  sheet_id UUID,
  file_name TEXT,
  sheet_number TEXT,
  page_number INTEGER,
  chunk_text TEXT,
  region JSONB,
  discipline TEXT,
  revision TEXT,
  content_class TEXT,
  extraction_method TEXT,
  observations JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    IF NOT public.has_project_access(auth.uid(), p_project_id) THEN
      RAISE EXCEPTION 'access denied';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.document_id,
    c.sheet_id,
    c.file_name,
    c.sheet_number,
    c.page_number,
    c.chunk_text,
    c.region,
    c.discipline,
    c.revision,
    c.content_class,
    c.extraction_method,
    c.observations,
    CASE
      WHEN p_query_embedding IS NULL OR c.embedding IS NULL THEN 0::FLOAT
      ELSE (1 - (c.embedding <=> p_query_embedding))::FLOAT
    END AS similarity
  FROM public.code_analyzer_drawing_chunks c
  WHERE c.project_id = p_project_id
    AND c.superseded = false
    AND (p_revision IS NULL OR c.revision = p_revision)
    AND (p_discipline IS NULL OR c.discipline = p_discipline)
    AND (p_content_class IS NULL OR c.content_class = p_content_class)
    AND (p_document_ids IS NULL OR c.document_id = ANY(p_document_ids))
    AND (
      (
        p_identifiers IS NOT NULL
        AND cardinality(p_identifiers) > 0
        AND EXISTS (
          SELECT 1
          FROM unnest(p_identifiers) AS q(ident)
          WHERE upper(COALESCE(c.sheet_number, '')) = upper(ident)
             OR upper(ident) = ANY (SELECT upper(x) FROM unnest(c.identifiers) AS x)
             OR upper(ident) = ANY (SELECT upper(y) FROM unnest(c.cross_sheet_refs) AS y)
        )
      )
      OR (
        p_query_embedding IS NOT NULL
        AND c.embedding IS NOT NULL
        AND (1 - (c.embedding <=> p_query_embedding)) >= 0.25
      )
    )
  ORDER BY
    CASE
      WHEN p_identifiers IS NOT NULL
        AND cardinality(p_identifiers) > 0
        AND EXISTS (
          SELECT 1
          FROM unnest(p_identifiers) AS ranked(ident)
          WHERE upper(COALESCE(c.sheet_number, '')) = upper(ranked.ident)
             OR upper(ranked.ident) = ANY (SELECT upper(x) FROM unnest(c.identifiers) AS x)
             OR upper(ranked.ident) = ANY (SELECT upper(y) FROM unnest(c.cross_sheet_refs) AS y)
        )
      THEN 0
      ELSE 1
    END,
    CASE
      WHEN p_query_embedding IS NULL OR c.embedding IS NULL THEN 1000000::FLOAT
      ELSE (c.embedding <=> p_query_embedding)::FLOAT
    END ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_match_count, 8), 20));
END;
$$;

REVOKE ALL ON FUNCTION public.match_analyzer_drawing_chunks(UUID, vector(1536), TEXT[], TEXT, INT, TEXT, UUID[], TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_analyzer_drawing_chunks(UUID, vector(1536), TEXT[], TEXT, INT, TEXT, UUID[], TEXT)
  TO authenticated, service_role;

ALTER TABLE public.document_annotations
  ADD COLUMN IF NOT EXISTS review_status TEXT;

ALTER TABLE public.document_annotations
  DROP CONSTRAINT IF EXISTS document_annotations_review_status_check;

ALTER TABLE public.document_annotations
  ADD CONSTRAINT document_annotations_review_status_check
  CHECK (review_status IS NULL OR review_status IN ('accept', 'reject', 'correct'));

COMMENT ON COLUMN public.document_annotations.review_status IS
  'Future reviewer disposition. Null until a person accepts, rejects, or corrects a finding. Not written by the analyzer.';
