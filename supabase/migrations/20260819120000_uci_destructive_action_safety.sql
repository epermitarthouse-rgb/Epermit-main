-- P0 UCI destructive-action safety
-- 1) Soft-archive projects instead of cascade-wiping UCI history
-- 2) Block hard DELETE of projects that have UCI dependents (defense in depth beyond app UI)
-- 3) Remove editor DELETE RLS on append-only / retained lifecycle & communication tables
-- Service role continues to bypass RLS for internal retention/ops jobs.

-- ---------------------------------------------------------------------------
-- Soft archive
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_projects_archived_at
  ON public.projects (archived_at)
  WHERE archived_at IS NOT NULL;

COMMENT ON COLUMN public.projects.archived_at IS
  'When set, project is archived (hidden from active lists). Prefer archive over hard delete when UCI history exists.';

-- ---------------------------------------------------------------------------
-- Prevent cascade wipe via project DELETE when UCI work/history exists
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_destructive_project_delete_with_uci()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- coordination_records is the UCI root; harvest links, applications, communications,
  -- transitions, and submission_* rows cascade from it / project_id. Blocking here
  -- prevents accidental CASCADE wipe of retained utility history.
  IF EXISTS (
    SELECT 1 FROM public.coordination_records WHERE project_id = OLD.id LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'PROJECT_HAS_UCI_DEPENDENCIES: This project has utility coordination or submission history and cannot be permanently deleted. Archive the project instead.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_project_delete_with_uci ON public.projects;
CREATE TRIGGER trg_prevent_project_delete_with_uci
  BEFORE DELETE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_destructive_project_delete_with_uci();

COMMENT ON FUNCTION public.prevent_destructive_project_delete_with_uci() IS
  'P0: blocks projects DELETE when coordination/harvest/submission history would cascade-wipe.';

-- ---------------------------------------------------------------------------
-- Drop unintended authenticated DELETE on append-only / retained UCI tables.
-- No DELETE policy => deny for JWT roles; service_role bypasses RLS.
-- submission_* tables already omit DELETE policies.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'coordination_stage_transitions',
    'coordination_communications',
    'coordination_applications'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'DROP POLICY IF EXISTS "Users can delete %1$s for tenant project editor access" ON public.%1$I',
      t
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS "Users can delete %1$s for editable projects" ON public.%1$I',
      t
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS "Users can delete %1$s for accessible projects" ON public.%1$I',
      t
    );
  END LOOP;
END $$;

COMMENT ON TABLE public.coordination_stage_transitions IS
  'Append-only lifecycle audit. Authenticated clients must not hard-delete rows (P0 RLS hygiene).';

COMMENT ON TABLE public.coordination_communications IS
  'Retained communications / acknowledgments. Authenticated clients must not hard-delete rows (P0 RLS hygiene).';

COMMENT ON TABLE public.coordination_applications IS
  'Package and submission history. Authenticated clients must not hard-delete rows (P0 RLS hygiene); supersede instead.';
