-- Point 7: pgvector document chunk storage + AI ingestion status + grounded response fields.

CREATE EXTENSION IF NOT EXISTS vector;

-- Ingestion status on uploaded project documents
ALTER TABLE public.project_documents
  ADD COLUMN IF NOT EXISTS ai_ingestion_status TEXT DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS ai_ingested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_ingestion_error TEXT,
  ADD COLUMN IF NOT EXISTS ai_chunk_count INTEGER;

ALTER TABLE public.project_documents
  DROP CONSTRAINT IF EXISTS project_documents_ai_ingestion_status_check;

ALTER TABLE public.project_documents
  ADD CONSTRAINT project_documents_ai_ingestion_status_check
  CHECK (
    ai_ingestion_status IN (
      'not_started',
      'processing',
      'completed',
      'failed',
      'low_text',
      'unsupported'
    )
  );

-- Searchable document chunks (text-embedding-3-small, 1536 dims)
CREATE TABLE IF NOT EXISTS public.project_document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  file_name TEXT,
  document_type TEXT,
  page_number INTEGER,
  sheet_label TEXT,
  sheet_title TEXT,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  chunk_text TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_document_chunks_project_document
  ON public.project_document_chunks(project_id, document_id);

CREATE INDEX IF NOT EXISTS idx_project_document_chunks_project_page
  ON public.project_document_chunks(project_id, document_id, page_number);

CREATE INDEX IF NOT EXISTS idx_project_document_chunks_user_project
  ON public.project_document_chunks(user_id, project_id);

CREATE INDEX IF NOT EXISTS idx_project_document_chunks_embedding_hnsw
  ON public.project_document_chunks
  USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.project_document_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view chunks for accessible projects" ON public.project_document_chunks;
CREATE POLICY "Users can view chunks for accessible projects"
  ON public.project_document_chunks
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can insert their own chunks" ON public.project_document_chunks;
CREATE POLICY "Users can insert their own chunks"
  ON public.project_document_chunks
  FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can update chunks for accessible projects" ON public.project_document_chunks;
CREATE POLICY "Users can update chunks for accessible projects"
  ON public.project_document_chunks
  FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can delete chunks for accessible projects" ON public.project_document_chunks;
CREATE POLICY "Users can delete chunks for accessible projects"
  ON public.project_document_chunks
  FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- Grounded AI response metadata on parsed comments
ALTER TABLE public.parsed_comments
  ADD COLUMN IF NOT EXISTS grounded_evidence JSONB,
  ADD COLUMN IF NOT EXISTS required_action TEXT,
  ADD COLUMN IF NOT EXISTS missing_info_or_risk TEXT,
  ADD COLUMN IF NOT EXISTS grounded_confidence TEXT,
  ADD COLUMN IF NOT EXISTS grounded_generated_at TIMESTAMPTZ;

-- Vector similarity search scoped to project + authenticated user access
CREATE OR REPLACE FUNCTION public.match_document_chunks(
  p_project_id UUID,
  p_query_embedding vector(1536),
  p_match_count INT DEFAULT 8
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  file_name TEXT,
  document_type TEXT,
  page_number INTEGER,
  sheet_label TEXT,
  sheet_title TEXT,
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
    c.document_type,
    c.page_number,
    c.sheet_label,
    c.sheet_title,
    c.chunk_text,
    c.metadata,
    (1 - (c.embedding <=> p_query_embedding))::FLOAT AS similarity
  FROM public.project_document_chunks c
  WHERE c.project_id = p_project_id
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT GREATEST(1, LEAST(p_match_count, 20));
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_document_chunks(UUID, vector(1536), INT) TO authenticated;
