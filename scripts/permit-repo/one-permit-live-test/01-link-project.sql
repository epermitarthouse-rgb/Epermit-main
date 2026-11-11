-- One-permit live test, step 1 (PRODUCTION WRITE, needs approval): link project ff193644 to permit 06fa082e.
-- admin_link_project_permit only inserts one project_permits row (ON CONFLICT DO NOTHING) and one audit row.
-- It cannot create or change a project. Rollback: 01-unlink-project-rollback.sql.
--   supabase db query --linked -f scripts/permit-repo/one-permit-live-test/01-link-project.sql
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', '3d2b4632-e3a3-4417-8a84-549cedbb6739', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', '3d2b4632-e3a3-4417-8a84-549cedbb6739', true);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd'
                 AND user_id = 'f1f84c83-36f6-4664-b34b-614b2881f09d' AND permit_number = 'BCIV2500152') THEN
    RAISE EXCEPTION 'project ff193644 is not the expected BCIV2500152 project of owner f1f84c83';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.permits WHERE id = '06fa082e-b942-4b54-b448-a1527f58df41'
                 AND portal_record_id = '6364' AND permit_number = 'BCIV2500152') THEN
    RAISE EXCEPTION 'permit 06fa082e is not BCIV2500152 / ProjectID 6364';
  END IF;
END;
$$;
SELECT public.admin_link_project_permit('ff193644-3e94-46d4-a1c0-4755fc65d0dd', '06fa082e-b942-4b54-b448-a1527f58df41');
COMMIT;
SELECT project_id, permit_id, linked_by, created_at FROM public.project_permits
WHERE project_id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd';
