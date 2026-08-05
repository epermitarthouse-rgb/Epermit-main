-- P0 Admin Members directory: allow platform admins to list profiles and a
-- limited project-membership summary without opening portal_data via RLS.

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.admin_list_member_directory()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(row_data ORDER BY sort_name, user_id)
      FROM (
        SELECT
          p.user_id,
          lower(coalesce(p.full_name, p.company_name, p.user_id::text)) AS sort_name,
          jsonb_build_object(
            'user_id', p.user_id,
            'full_name', p.full_name,
            'company_name', p.company_name,
            'job_title', p.job_title,
            'created_at', p.created_at,
            'platform_roles', COALESCE(
              (
                SELECT jsonb_agg(ur.role::text ORDER BY ur.role::text)
                FROM public.user_roles ur
                WHERE ur.user_id = p.user_id
              ),
              '[]'::jsonb
            ),
            'owned_projects', COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'project_id', pr.id,
                    'project_name', pr.name,
                    'role', 'owner'
                  )
                  ORDER BY pr.name
                )
                FROM public.projects pr
                WHERE pr.user_id = p.user_id
              ),
              '[]'::jsonb
            ),
            'team_memberships', COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'project_id', ptm.project_id,
                    'project_name', pr.name,
                    'role', ptm.role::text
                  )
                  ORDER BY pr.name
                )
                FROM public.project_team_members ptm
                JOIN public.projects pr ON pr.id = ptm.project_id
                WHERE ptm.user_id = p.user_id
              ),
              '[]'::jsonb
            )
          ) AS row_data
        FROM public.profiles p
      ) sub
    ),
    '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_member_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_member_directory() TO authenticated;

COMMENT ON FUNCTION public.admin_list_member_directory() IS
  'P0 Admin Members: platform-admin-only directory of profiles, user_roles, and project membership summaries.';
