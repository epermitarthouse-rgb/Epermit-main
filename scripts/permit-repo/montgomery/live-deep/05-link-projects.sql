-- Montgomery project links (PRODUCTION WRITE, NOT EXECUTED; needs the user's go-ahead AFTER the worker is redeployed
-- with feat/montgomery-portal-data and no deep job is running). Idempotent: admin_link_project_permit inserts one
-- project_permits row (ON CONFLICT DO NOTHING) and one audit row per link; it cannot create or change a project.
--
-- Why not before the redeploy: a worker without the Montgomery portal_data writer throws on a linked Montgomery permit.
--
-- Links ONLY the four validated projects (the user approved 2026-11-19: "keep any project doesnt matter" for the
-- COMBUILD-1154415 duplicate). 9b57cccc was chosen over a8f43e55: both carry the same 41 comments, but 9b57cccc is the
-- newer row (2026-08-06) and its Files tab lists 199 files, the portal's own count for record 195963, where a8f43e55
-- (2026-07-28) lists 174. a8f43e55 and the third COMBUILD-1154415 row 09d7f807 stay unlinked. No other project is linked.
-- The deep pass writes to whichever project rows are linked, with no project id in code, so any other row could be
-- linked later the same way.
--
-- Every pair is checked against the portal discovery record (permits.permit_number + portal_record_id) and the
-- project's own permit_number before anything is written; one mismatch aborts the whole transaction.
--   supabase db query --linked -f scripts/permit-repo/montgomery/live-deep/05-link-projects.sql
-- Rollback: 05-unlink-projects-rollback.sql
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', '3d2b4632-e3a3-4417-8a84-549cedbb6739', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', '3d2b4632-e3a3-4417-8a84-549cedbb6739', true);
DO $$
DECLARE
  v_pair RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM public.permit_sync_jobs WHERE status IN ('queued', 'running', 'retry_wait', 'waiting_user')) THEN
    RAISE EXCEPTION 'a permit sync job is active; link only after it finished and the worker was redeployed';
  END IF;
  FOR v_pair IN
    SELECT * FROM (VALUES
      ('9b57cccc-b144-42c4-815d-f7b6b6cbeb0f'::uuid, '24f4c118-f44b-4acb-bc57-4f316ca81bbc'::uuid, 'COMBUILD-1154415', '195963'),
      ('94dc5e40-014c-48f9-a2b9-6170fb2e3ec6'::uuid, '94e583f9-0152-4c19-9f84-dbb6eeb5ac56'::uuid, 'COMBUILD-1140088', '185325'),
      ('6daf6610-6b7a-48cf-865d-7a2574bcacb0'::uuid, '942ba2a3-3a64-407e-ba2c-f8f76fc5f255'::uuid, 'COMBUILD-1073768', '153292'),
      ('c8e29771-0dfa-4991-a116-efe3c72d8279'::uuid, '9afe3e15-20c2-4e7b-b2f9-80ee377f9f7b'::uuid, 'SIGN-1159714', '200100')
    ) AS t(project_id, permit_id, permit_number, portal_record_id)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_pair.project_id AND permit_number = v_pair.permit_number AND user_id IS NOT NULL) THEN
      RAISE EXCEPTION 'project % is not the expected % project', v_pair.project_id, v_pair.permit_number;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.permits WHERE id = v_pair.permit_id AND adapter_key = 'montgomery-projectdox'
                   AND permit_number = v_pair.permit_number AND portal_record_id = v_pair.portal_record_id) THEN
      RAISE EXCEPTION 'permit % is not % / portal record %', v_pair.permit_id, v_pair.permit_number, v_pair.portal_record_id;
    END IF;
    IF (SELECT count(*) FROM public.projects WHERE id = v_pair.project_id AND portal_data IS NOT NULL) <> 1 THEN
      RAISE EXCEPTION 'project % has no stored portal_data to merge into', v_pair.project_id;
    END IF;
    PERFORM public.admin_link_project_permit(v_pair.project_id, v_pair.permit_id);
  END LOOP;
END;
$$;
COMMIT;
SELECT left(pp.project_id::text, 8) AS project, left(pp.permit_id::text, 8) AS permit, p.permit_number, pp.created_at
FROM public.project_permits pp JOIN public.permits p ON p.id = pp.permit_id
WHERE p.adapter_key = 'montgomery-projectdox' ORDER BY p.permit_number;
