ALTER TABLE public.projects
  ALTER COLUMN is_shadow_mode SET DEFAULT TRUE;

UPDATE public.projects
  SET is_shadow_mode = TRUE
  WHERE is_shadow_mode = FALSE OR is_shadow_mode IS NULL;
