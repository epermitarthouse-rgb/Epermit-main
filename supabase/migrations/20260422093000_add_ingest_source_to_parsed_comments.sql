-- Distinguish deterministic raw REF-row imports from fallback LLM comments.
ALTER TABLE public.parsed_comments
ADD COLUMN IF NOT EXISTS ingest_source TEXT;

UPDATE public.parsed_comments
SET ingest_source = 'fallback_llm'
WHERE ingest_source IS NULL;

ALTER TABLE public.parsed_comments
ALTER COLUMN ingest_source SET DEFAULT 'fallback_llm';

ALTER TABLE public.parsed_comments
ALTER COLUMN ingest_source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'parsed_comments_ingest_source_check'
  ) THEN
    ALTER TABLE public.parsed_comments
    ADD CONSTRAINT parsed_comments_ingest_source_check
    CHECK (ingest_source IN ('raw_ref', 'fallback_llm'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_parsed_comments_project_ingest_source
  ON public.parsed_comments(project_id, ingest_source);
