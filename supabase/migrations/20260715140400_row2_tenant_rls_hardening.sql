-- Row 2 stage 5: Tenant-aware RLS on projects and UCI tables.
-- Combines tenant membership + project access. Legacy rows with NULL tenant_id keep project-only checks.

DO $$
DECLARE
  t TEXT;
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
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS "Users can select %1$s for accessible projects" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Users can insert %1$s for accessible projects" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Users can update %1$s for accessible projects" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Users can delete %1$s for accessible projects" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Users can select %1$s for editable projects" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Users can insert %1$s for editable projects" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Users can update %1$s for editable projects" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Users can delete %1$s for editable projects" ON public.%1$I', t);

    EXECUTE format(
      'CREATE POLICY "Users can select %1$s for tenant project access" ON public.%1$I FOR SELECT USING (public.has_uci_row_access(auth.uid(), tenant_id, project_id))',
      t
    );
    EXECUTE format(
      'CREATE POLICY "Users can insert %1$s for tenant project editor access" ON public.%1$I FOR INSERT WITH CHECK (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id))',
      t
    );
    EXECUTE format(
      'CREATE POLICY "Users can update %1$s for tenant project editor access" ON public.%1$I FOR UPDATE USING (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id)) WITH CHECK (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id))',
      t
    );
    EXECUTE format(
      'CREATE POLICY "Users can delete %1$s for tenant project editor access" ON public.%1$I FOR DELETE USING (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id))',
      t
    );
  END LOOP;
END $$;

-- Projects: require tenant access when tenant_id is set.
DROP POLICY IF EXISTS "Users can view accessible projects" ON public.projects;

CREATE POLICY "Users can view accessible projects"
ON public.projects
FOR SELECT
USING (
  (
    tenant_id IS NULL
    AND (user_id = auth.uid() OR public.has_project_access(auth.uid(), id))
  )
  OR (
    tenant_id IS NOT NULL
    AND public.can_access_tenant(auth.uid(), tenant_id)
    AND public.has_project_access(auth.uid(), id)
  )
);

-- scrape_jobs: UCI portal sync jobs tenant-scoped when tenant_id present.
DO $$
BEGIN
  IF to_regclass('public.scrape_jobs') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users can view scrape jobs for accessible projects" ON public.scrape_jobs;
    DROP POLICY IF EXISTS "Users can insert scrape jobs for accessible projects" ON public.scrape_jobs;
    DROP POLICY IF EXISTS "Users can update scrape jobs for accessible projects" ON public.scrape_jobs;

    CREATE POLICY "Users can view scrape jobs for tenant project access"
    ON public.scrape_jobs
    FOR SELECT
    USING (public.has_uci_row_access(auth.uid(), tenant_id, project_id));

    CREATE POLICY "Users can insert scrape jobs for tenant project editor access"
    ON public.scrape_jobs
    FOR INSERT
    WITH CHECK (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id));

    CREATE POLICY "Users can update scrape jobs for tenant project editor access"
    ON public.scrape_jobs
    FOR UPDATE
    USING (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id))
    WITH CHECK (public.has_uci_row_editor_access(auth.uid(), tenant_id, project_id));
  END IF;
END $$;
