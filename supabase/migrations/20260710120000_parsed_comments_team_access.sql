-- Allow project team members to read and edit comment workflow data on shared projects.
-- Viewers: SELECT only via has_project_access.
-- Editors/admins/owners: INSERT/UPDATE/DELETE via has_project_editor_access.
-- Response approval remains gated by has_project_admin_access in enforce_parsed_comment_response_approval().

CREATE OR REPLACE FUNCTION public.has_project_editor_access(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = _project_id AND user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.project_team_members
    WHERE project_id = _project_id
      AND user_id = _user_id
      AND role IN ('owner', 'admin', 'editor')
  )
$$;

DO $$
BEGIN
  IF to_regclass('public.parsed_comments') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users can view parsed_comments for own projects" ON public.parsed_comments;
    DROP POLICY IF EXISTS "Users can insert parsed_comments for own projects" ON public.parsed_comments;
    DROP POLICY IF EXISTS "Users can update parsed_comments for own projects" ON public.parsed_comments;
    DROP POLICY IF EXISTS "Users can delete parsed_comments for own projects" ON public.parsed_comments;

    CREATE POLICY "Users can view parsed_comments for accessible projects"
      ON public.parsed_comments FOR SELECT
      USING (public.has_project_access(auth.uid(), project_id));

    CREATE POLICY "Users can insert parsed_comments for editable projects"
      ON public.parsed_comments FOR INSERT
      WITH CHECK (public.has_project_editor_access(auth.uid(), project_id));

    CREATE POLICY "Users can update parsed_comments for editable projects"
      ON public.parsed_comments FOR UPDATE
      USING (public.has_project_editor_access(auth.uid(), project_id));

    CREATE POLICY "Users can delete parsed_comments for editable projects"
      ON public.parsed_comments FOR DELETE
      USING (public.has_project_editor_access(auth.uid(), project_id));
  END IF;

  IF to_regclass('public.comment_quality_checks') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users can view own project quality checks" ON public.comment_quality_checks;
    DROP POLICY IF EXISTS "Users can insert quality checks for own projects" ON public.comment_quality_checks;

    CREATE POLICY "Users can view quality checks for accessible projects"
      ON public.comment_quality_checks FOR SELECT
      USING (public.has_project_access(auth.uid(), project_id));

    CREATE POLICY "Users can insert quality checks for editable projects"
      ON public.comment_quality_checks FOR INSERT
      WITH CHECK (public.has_project_editor_access(auth.uid(), project_id));
  END IF;

  IF to_regclass('public.response_package_drafts') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users can view drafts for own projects" ON public.response_package_drafts;
    DROP POLICY IF EXISTS "Users can insert drafts for own projects" ON public.response_package_drafts;
    DROP POLICY IF EXISTS "Users can update drafts for own projects" ON public.response_package_drafts;
    DROP POLICY IF EXISTS "Users can delete drafts for own projects" ON public.response_package_drafts;

    CREATE POLICY "Users can view drafts for accessible projects"
      ON public.response_package_drafts FOR SELECT
      USING (public.has_project_access(auth.uid(), project_id));

    CREATE POLICY "Users can insert drafts for editable projects"
      ON public.response_package_drafts FOR INSERT
      WITH CHECK (public.has_project_editor_access(auth.uid(), project_id));

    CREATE POLICY "Users can update drafts for editable projects"
      ON public.response_package_drafts FOR UPDATE
      USING (public.has_project_editor_access(auth.uid(), project_id));

    CREATE POLICY "Users can delete drafts for editable projects"
      ON public.response_package_drafts FOR DELETE
      USING (public.has_project_editor_access(auth.uid(), project_id));
  END IF;

  IF to_regclass('public.plan_markups') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users can view plan markups for accessible projects" ON public.plan_markups;
    DROP POLICY IF EXISTS "Users can insert plan markups for own projects" ON public.plan_markups;
    DROP POLICY IF EXISTS "Users can update plan markups for own projects" ON public.plan_markups;
    DROP POLICY IF EXISTS "Users can delete plan markups for own projects" ON public.plan_markups;

    CREATE POLICY "Users can view plan markups for accessible projects"
      ON public.plan_markups FOR SELECT
      USING (public.has_project_access(auth.uid(), project_id));

    CREATE POLICY "Users can insert plan markups for editable projects"
      ON public.plan_markups FOR INSERT
      WITH CHECK (public.has_project_editor_access(auth.uid(), project_id));

    CREATE POLICY "Users can update plan markups for editable projects"
      ON public.plan_markups FOR UPDATE
      USING (public.has_project_editor_access(auth.uid(), project_id));

    CREATE POLICY "Users can delete plan markups for editable projects"
      ON public.plan_markups FOR DELETE
      USING (public.has_project_editor_access(auth.uid(), project_id));
  END IF;
END $$;

-- Verification: helper + policy definitions (migration runs as superuser; live RLS spot-checks run post-apply).
DO $$
DECLARE
  v_project_id UUID;
  v_owner_id UUID;
  v_team_user_id UUID;
  v_comment_count INT;
BEGIN
  IF to_regprocedure('public.has_project_editor_access(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'has_project_editor_access function missing after migration';
  END IF;

  IF to_regclass('public.parsed_comments') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'parsed_comments'
      AND policyname = 'Users can view parsed_comments for accessible projects'
      AND cmd = 'SELECT'
      AND qual LIKE '%has_project_access%'
  ) THEN
    RAISE EXCEPTION 'parsed_comments SELECT policy must use has_project_access';
  END IF;

  IF to_regclass('public.parsed_comments') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'parsed_comments'
      AND cmd = 'UPDATE'
      AND qual LIKE '%has_project_editor_access%'
  ) THEN
    RAISE EXCEPTION 'parsed_comments UPDATE policy must use has_project_editor_access';
  END IF;

  IF to_regclass('public.parsed_comments') IS NULL THEN
    RAISE NOTICE 'parsed_comments team access migration: parsed_comments table absent';
    RETURN;
  END IF;

  SELECT p.id, p.user_id
  INTO v_project_id, v_owner_id
  FROM public.projects p
  WHERE EXISTS (
    SELECT 1 FROM public.parsed_comments pc WHERE pc.project_id = p.id
  )
  ORDER BY p.created_at DESC
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE NOTICE 'parsed_comments team access migration: no parsed_comments rows yet';
    RETURN;
  END IF;

  SELECT COUNT(*)::INT
  INTO v_comment_count
  FROM public.parsed_comments
  WHERE project_id = v_project_id;

  SELECT ptm.user_id
  INTO v_team_user_id
  FROM public.project_team_members ptm
  WHERE ptm.project_id = v_project_id
    AND ptm.user_id <> v_owner_id
  LIMIT 1;

  IF v_owner_id IS NULL OR NOT public.has_project_access(v_owner_id, v_project_id) THEN
    RAISE EXCEPTION 'Project owner must have has_project_access';
  END IF;

  IF v_team_user_id IS NOT NULL AND NOT public.has_project_access(v_team_user_id, v_project_id) THEN
    RAISE EXCEPTION 'Team member must have has_project_access';
  END IF;

  IF v_team_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.project_team_members
      WHERE project_id = v_project_id AND user_id = v_team_user_id AND role = 'viewer'
    )
    AND public.has_project_editor_access(v_team_user_id, v_project_id) THEN
    RAISE EXCEPTION 'Viewer must not satisfy has_project_editor_access';
  END IF;

  RAISE NOTICE 'parsed_comments team access migration verified: project=%, comments=%, team_user=%',
    v_project_id, v_comment_count, v_team_user_id;
END $$;
