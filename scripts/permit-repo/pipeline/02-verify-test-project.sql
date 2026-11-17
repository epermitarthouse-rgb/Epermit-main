-- Read-only. Run before and after the first comment-processing run on the test project
-- (ff193644 linked to permit 06fa082e / BCIV2500152). Needs migration 20261117100000.
-- Expected after the first run: the same 6 parsed_comments ids, each with portal_permit_id and
-- portal_comment_key set, response_text / response_status / approved_* unchanged, no rows removed,
-- and project_comment_pipeline_state.status = 'completed'.

select pc.id,
       pc.ingest_source,
       pc.status,
       pc.response_status,
       (pc.response_text is not null and btrim(pc.response_text) <> '') as has_response,
       pc.approved_at is not null as approved,
       pc.last_edited_by is not null as human_edited,
       pc.portal_permit_id is not null as adopted,
       pc.portal_comment_key is not null as has_key,
       pc.portal_removed_at,
       pc.portal_changed_at,
       md5(coalesce(pc.response_text, '')) as response_md5
from public.parsed_comments pc
where pc.project_id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd'
order by pc.created_at, pc.id;

select status, attempts, continuations, force_requested,
       requested_fingerprint = completed_fingerprint as up_to_date, last_completed_at, next_attempt_at,
       left(coalesce(last_error, ''), 200) as last_error
from public.project_comment_pipeline_state
where project_id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd';

select id, status, current_stage, idempotency_key like 'comments:%' as fingerprint_keyed,
       left(coalesce(error_message, ''), 200) as error_message, created_at, completed_at
from public.project_pipeline_runs
where project_id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd'
order by created_at desc
limit 5;
