-- Rollback for step 1 (PRODUCTION WRITE): remove the ff193644 -> 06fa082e link. After this the deep runner
-- writes no portal_data to the project and service-mode agent calls for it are refused (project_not_linked).
--   supabase db query --linked -f scripts/permit-repo/one-permit-live-test/01-unlink-project-rollback.sql
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', '3d2b4632-e3a3-4417-8a84-549cedbb6739', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', '3d2b4632-e3a3-4417-8a84-549cedbb6739', true);
SELECT public.admin_unlink_project_permit('ff193644-3e94-46d4-a1c0-4755fc65d0dd', '06fa082e-b942-4b54-b448-a1527f58df41');
COMMIT;
SELECT count(*) AS links_left FROM public.project_permits WHERE project_id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd';
