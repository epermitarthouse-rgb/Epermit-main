-- NB-D1-001: UCI RLS hardening — viewers may SELECT; mutations require editor access.
-- Uses existing has_project_editor_access (owner/admin/editor team roles).
-- No tenant_id changes — organization source does not exist on projects yet.

DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'coordination_records',
    'coordination_stage_transitions',
    'coordination_applications',
    'coordination_communications',
    'coordination_costs',
    'coordination_equipment',
    'coordination_milestones'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables
  LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE NOTICE 'Skipping missing table %', tbl;
      CONTINUE;
    END IF;

    EXECUTE format(
      'DROP POLICY IF EXISTS "Users can insert %1$s for accessible projects" ON public.%1$I',
      tbl
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS "Users can update %1$s for accessible projects" ON public.%1$I',
      tbl
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS "Users can delete %1$s for accessible projects" ON public.%1$I',
      tbl
    );

    EXECUTE format(
      'CREATE POLICY "Users can insert %1$s for editable projects" ON public.%1$I FOR INSERT WITH CHECK (public.has_project_editor_access(auth.uid(), project_id))',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "Users can update %1$s for editable projects" ON public.%1$I FOR UPDATE USING (public.has_project_editor_access(auth.uid(), project_id)) WITH CHECK (public.has_project_editor_access(auth.uid(), project_id))',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "Users can delete %1$s for editable projects" ON public.%1$I FOR DELETE USING (public.has_project_editor_access(auth.uid(), project_id))',
      tbl
    );
  END LOOP;
END $$;

COMMENT ON POLICY "Users can insert coordination_records for editable projects" ON public.coordination_records IS
  'NB-D1-001: UCI mutations require owner/admin/editor — viewers read-only via SELECT policy.';
