-- Persist drawing discipline per analyzer sheet (survives refresh / re-analysis).

ALTER TABLE public.code_analyzer_sheets
  ADD COLUMN IF NOT EXISTS discipline TEXT NOT NULL DEFAULT 'general';
