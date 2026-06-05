-- Link manually parsed comments to the uploaded comment letter in project_documents.
ALTER TABLE public.parsed_comments
  ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES public.project_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_parsed_comments_source_document_id
  ON public.parsed_comments(source_document_id)
  WHERE source_document_id IS NOT NULL;
