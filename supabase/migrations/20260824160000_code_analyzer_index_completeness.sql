-- Sheet labels + persisted index completeness prescreen results per run.

ALTER TABLE public.code_analyzer_sheets
  ADD COLUMN IF NOT EXISTS sheet_label TEXT;

ALTER TABLE public.code_analyzer_runs
  ADD COLUMN IF NOT EXISTS index_completeness JSONB;
