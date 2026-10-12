-- Code Analyzer worker: service_role access for spec RAG RPC (backend caller).

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
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    IF NOT public.has_project_access(auth.uid(), p_project_id) THEN
      RAISE EXCEPTION 'access denied';
    END IF;
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
  TO service_role;
