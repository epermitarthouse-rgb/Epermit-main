-- Run-scoped staff guidance for Code Analyzer (standard + DC modification reviews).
ALTER TABLE public.code_analyzer_runs
  ADD COLUMN IF NOT EXISTS analysis_instructions TEXT;
