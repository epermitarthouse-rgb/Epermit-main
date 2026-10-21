-- Separate Code Analyzer V2 visibility from Code Analyzer, and persist Supabase analyzer mode.
-- Existing runs keep analysis_mode NULL so they are not reinterpreted.
-- module.code_analyzer_v2 defaults ON, matching the current module.code_analyzer default.
-- This migration does not disable either module.

INSERT INTO public.feature_flags (key, enabled, label, description, category)
VALUES (
  'module.code_analyzer_v2',
  true,
  'Code Analyzer V2',
  'Evidence-grounded drawing review at /code-compliance',
  'Modules'
)
ON CONFLICT (key) DO NOTHING;

UPDATE public.feature_flags
SET
  label = 'Code Analyzer',
  description = 'Permit drawing review at /code-analyzer'
WHERE key = 'module.code_analyzer'
  AND description IS DISTINCT FROM 'Permit drawing review at /code-analyzer';

ALTER TABLE public.supabase_analyzer_runs
  ADD COLUMN IF NOT EXISTS analysis_mode text,
  ADD COLUMN IF NOT EXISTS analysis_scope jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'supabase_analyzer_runs_analysis_mode_check'
  ) THEN
    ALTER TABLE public.supabase_analyzer_runs
      ADD CONSTRAINT supabase_analyzer_runs_analysis_mode_check
      CHECK (
        analysis_mode IS NULL
        OR analysis_mode IN ('both', 'ibc_only', 'local_only')
      );
  END IF;
END $$;
