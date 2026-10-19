-- Proposed, not applied.
-- Drawing evidence index for Code Analyzer hybrid retrieval, plus a nullable
-- annotation review_status for a later accept/reject/correct control.
-- Rollback: drop the function and table, then drop document_annotations.review_status.
-- Do not supabase db push this file with the rest of the backlog.

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
  page_number INTEGER NOT NULL DEFAULT 1 CHECK (page_number >= 1),
  content_fingerprint TEXT NOT NULL DEFAULT '',
  chunk_text TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'drawing',
  extraction_method TEXT NOT NULL DEFAULT 'pdfjs-text-layer',
  region JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT code_analyzer_drawing_chunks_unique
    UNIQUE (project_id, document_id, sheet_id, page_number, content_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_code_analyzer_drawing_chunks_project
  ON public.code_analyzer_drawing_chunks (project_id, document_id, page_number);

CREATE INDEX IF NOT EXISTS idx_code_analyzer_drawing_chunks_sheet_number
  ON public.code_analyzer_drawing_chunks (project_id, sheet_number);

-- An ANN index can be added after the table has rows. It is omitted here so an
-- empty table does not fail index build. Exact sheet numbers use the btree above.

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

CREATE OR REPLACE FUNCTION public.match_analyzer_drawing_chunks(
  p_project_id UUID,
  p_query_embedding vector(1536) DEFAULT NULL,
  p_identifiers TEXT[] DEFAULT NULL,
  p_discipline TEXT DEFAULT NULL,
  p_match_count INT DEFAULT 8
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
  extraction_method TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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
    c.extraction_method,
    CASE
      WHEN p_query_embedding IS NULL OR c.embedding IS NULL THEN 0
      ELSE (1 - (c.embedding <=> p_query_embedding))::FLOAT
    END AS similarity
  FROM public.code_analyzer_drawing_chunks c
  WHERE c.project_id = p_project_id
    AND (p_discipline IS NULL OR c.discipline = p_discipline)
    AND (
      (p_identifiers IS NOT NULL AND c.sheet_number = ANY(p_identifiers))
      OR (p_query_embedding IS NOT NULL AND c.embedding IS NOT NULL)
    )
  ORDER BY
    CASE WHEN p_identifiers IS NOT NULL AND c.sheet_number = ANY(p_identifiers) THEN 0 ELSE 1 END,
    c.embedding <=> p_query_embedding NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(p_match_count, 8), 20));
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_analyzer_drawing_chunks(UUID, vector(1536), TEXT[], TEXT, INT)
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
