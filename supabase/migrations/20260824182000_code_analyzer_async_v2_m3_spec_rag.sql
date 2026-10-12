-- Code Analyzer Async V2 — Milestone 3: specification sections + scoped RAG chunks.

CREATE TABLE IF NOT EXISTS public.code_analyzer_spec_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  content_fingerprint TEXT NOT NULL DEFAULT '',
  division TEXT,
  section_number TEXT NOT NULL,
  section_title TEXT,
  page_start INTEGER NOT NULL CHECK (page_start >= 1),
  page_end INTEGER NOT NULL CHECK (page_end >= page_start),
  body_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT code_analyzer_spec_sections_unique
    UNIQUE (document_id, content_fingerprint, section_number)
);

CREATE INDEX IF NOT EXISTS idx_code_analyzer_spec_sections_project
  ON public.code_analyzer_spec_sections (project_id, document_id);

CREATE INDEX IF NOT EXISTS idx_code_analyzer_spec_sections_lookup
  ON public.code_analyzer_spec_sections (project_id, section_number);

ALTER TABLE public.code_analyzer_spec_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view spec sections" ON public.code_analyzer_spec_sections;
CREATE POLICY "Users can view spec sections"
  ON public.code_analyzer_spec_sections FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can manage spec sections" ON public.code_analyzer_spec_sections;
CREATE POLICY "Users can manage spec sections"
  ON public.code_analyzer_spec_sections FOR ALL
  USING (public.has_project_editor_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_editor_access(auth.uid(), project_id));

DROP TRIGGER IF EXISTS update_code_analyzer_spec_sections_updated_at
  ON public.code_analyzer_spec_sections;
CREATE TRIGGER update_code_analyzer_spec_sections_updated_at
  BEFORE UPDATE ON public.code_analyzer_spec_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Extend project_document_chunks for analyzer spec metadata
ALTER TABLE public.project_document_chunks
  ADD COLUMN IF NOT EXISTS source_class TEXT,
  ADD COLUMN IF NOT EXISTS content_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS division TEXT,
  ADD COLUMN IF NOT EXISTS section_number TEXT,
  ADD COLUMN IF NOT EXISTS section_title TEXT,
  ADD COLUMN IF NOT EXISTS page_start INTEGER,
  ADD COLUMN IF NOT EXISTS page_end INTEGER,
  ADD COLUMN IF NOT EXISTS spec_section_id UUID
    REFERENCES public.code_analyzer_spec_sections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_document_chunks_spec
  ON public.project_document_chunks (project_id, source_class, document_id)
  WHERE source_class = 'specification';

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_document_chunks_dedupe
  ON public.project_document_chunks (
    project_id, document_id, content_fingerprint, section_number, chunk_index
  )
  WHERE content_fingerprint IS NOT NULL AND section_number IS NOT NULL;

-- Scoped spec chunk retrieval for Code Analyzer
CREATE OR REPLACE FUNCTION public.match_analyzer_spec_chunks(
  p_project_id UUID,
  p_query_embedding vector(1536),
  p_document_ids UUID[] DEFAULT NULL,
  p_match_count INT DEFAULT 8
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  file_name TEXT,
  section_number TEXT,
  section_title TEXT,
  page_start INTEGER,
  page_end INTEGER,
  chunk_text TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_project_access(auth.uid(), p_project_id) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.document_id,
    c.file_name,
    c.section_number,
    c.section_title,
    c.page_start,
    c.page_end,
    c.chunk_text,
    c.metadata,
    (1 - (c.embedding <=> p_query_embedding))::FLOAT AS similarity
  FROM public.project_document_chunks c
  WHERE c.project_id = p_project_id
    AND c.source_class = 'specification'
    AND c.embedding IS NOT NULL
    AND (p_document_ids IS NULL OR c.document_id = ANY(p_document_ids))
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT GREATEST(1, LEAST(p_match_count, 20));
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_analyzer_spec_chunks(UUID, vector(1536), UUID[], INT)
  TO authenticated;
