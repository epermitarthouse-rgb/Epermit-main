-- Rollback for 05-link-projects.sql (PRODUCTION WRITE, NOT EXECUTED): removes only the four Montgomery links.
-- After this the deep runner writes no portal_data to those projects (permit-level comments keep flowing).
-- portal_data already written by deep passes stays on the projects.
--   supabase db query --linked -f scripts/permit-repo/montgomery/live-deep/05-unlink-projects-rollback.sql
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', '3d2b4632-e3a3-4417-8a84-549cedbb6739', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', '3d2b4632-e3a3-4417-8a84-549cedbb6739', true);
SELECT public.admin_unlink_project_permit(t.project_id, t.permit_id)
FROM (VALUES
  ('9b57cccc-b144-42c4-815d-f7b6b6cbeb0f'::uuid, '24f4c118-f44b-4acb-bc57-4f316ca81bbc'::uuid),
  ('94dc5e40-014c-48f9-a2b9-6170fb2e3ec6'::uuid, '94e583f9-0152-4c19-9f84-dbb6eeb5ac56'::uuid),
  ('6daf6610-6b7a-48cf-865d-7a2574bcacb0'::uuid, '942ba2a3-3a64-407e-ba2c-f8f76fc5f255'::uuid),
  ('c8e29771-0dfa-4991-a116-efe3c72d8279'::uuid, '9afe3e15-20c2-4e7b-b2f9-80ee377f9f7b'::uuid)
) AS t(project_id, permit_id);
COMMIT;
SELECT count(*) AS montgomery_links_left FROM public.project_permits pp JOIN public.permits p ON p.id = pp.permit_id WHERE p.adapter_key = 'montgomery-projectdox';
