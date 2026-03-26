-- Run this in Supabase Dashboard → SQL Editor if inserts fail with "discipline" NOT NULL.
-- Makes parsed_comments.discipline nullable so comment-parser-agent can insert with discipline: null.

ALTER TABLE public.parsed_comments
  ALTER COLUMN discipline DROP NOT NULL;
