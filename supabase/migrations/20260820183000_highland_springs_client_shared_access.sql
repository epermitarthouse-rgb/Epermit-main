-- Shared workspace access for Highland Springs UAT client login.
-- Login email: admin@dmtechsservice.com (referenced as admin@dmtech in UAT docs).
-- Access model: project_team_members + tenant membership — no per-user UCI duplication.

INSERT INTO public.project_team_members (project_id, user_id, role, added_by)
SELECT
  p.id,
  client_user.id,
  'editor'::public.team_role,
  p.user_id
FROM public.projects p
JOIN auth.users client_user
  ON lower(client_user.email) = lower('admin@dmtechsservice.com')
WHERE p.id = '62f83b5b-9d22-4ebc-8282-6fc41e3033c0'::uuid
ON CONFLICT (project_id, user_id) DO NOTHING;
