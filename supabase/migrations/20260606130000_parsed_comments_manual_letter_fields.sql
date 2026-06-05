-- Manual comment letter parser: structured fields + ingest_source value.

ALTER TABLE public.parsed_comments
  ADD COLUMN IF NOT EXISTS reviewer_name TEXT,
  ADD COLUMN IF NOT EXISTS comment_number TEXT,
  ADD COLUMN IF NOT EXISTS previous_comment_text TEXT,
  ADD COLUMN IF NOT EXISTS existing_response_text TEXT,
  ADD COLUMN IF NOT EXISTS code_references TEXT,
  ADD COLUMN IF NOT EXISTS confidence REAL;

ALTER TABLE public.parsed_comments
  DROP CONSTRAINT IF EXISTS parsed_comments_ingest_source_check;

ALTER TABLE public.parsed_comments
  ADD CONSTRAINT parsed_comments_ingest_source_check
  CHECK (ingest_source IN ('raw_ref', 'fallback_llm', 'manual_letter'));
