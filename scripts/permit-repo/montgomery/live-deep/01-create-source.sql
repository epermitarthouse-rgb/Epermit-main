-- Montgomery supervised deep run, step 1 (PRODUCTION WRITE, needs approval): register credential 93857549 as a
-- montgomery-projectdox source with automation OFF (status 'inactive': manual jobs only, never scheduled).
-- Audited by admin_set_permit_sync_source. Rollback: none needed; an inactive source runs nothing on its own.
--   supabase db query --linked -f scripts/permit-repo/montgomery/live-deep/01-create-source.sql
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', '3d2b4632-e3a3-4417-8a84-549cedbb6739', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', '3d2b4632-e3a3-4417-8a84-549cedbb6739', true);
SELECT public.admin_set_permit_sync_source('93857549-eb37-47cd-ad83-6701f835de66', 'montgomery-projectdox', false, '{}'::jsonb);
COMMIT;
SELECT credential_id, adapter_key, status, automation_enabled, settings FROM public.permit_sync_sources
WHERE credential_id = '93857549-eb37-47cd-ad83-6701f835de66';
