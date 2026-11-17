-- One-time data repair for D-118. NOT a migration; run manually (`supabase db query --linked -f`) only after
-- approval. Clears false "Updated on portal" marks (portal_changed_at, portal_latest_text) that the first
-- repository run set on report-parsed rows: their full_discussion_text is the whole thread (reviewer comment
-- followed by the responses), the repository body is the reviewer comment alone, and the comparison treated
-- the difference as a portal change. Only rows whose stored thread STARTS WITH the marked portal comment are
-- touched (the portal text is unchanged); a real change does not satisfy that and keeps its mark.
-- Nothing else is written: original_text, status, responses and approvals stay as they are.
-- Each cleared row gets one platform_audit_events row holding the previous values.
--
-- Not needed if the parser with the D-118 fix runs on the project first: that run clears these marks itself.
--
-- Rollback (restores the cleared marks from the audit rows):
--   UPDATE public.parsed_comments pc
--   SET portal_changed_at = (a.before_json->>'portal_changed_at')::timestamptz,
--       portal_latest_text = a.before_json->>'portal_latest_text'
--   FROM public.platform_audit_events a
--   WHERE a.action = 'pipeline.portal_mark_cleared' AND a.after_json->>'repair' = 'D-118'
--     AND a.target_id = pc.id::text AND pc.portal_changed_at IS NULL;

BEGIN;

-- Same comparison as looseText() in permitRepositoryComments.ts: e-mail addresses and [email] redactions
-- removed, lower case, letters and digits only. Temporary helper, dropped at the end of this script.
CREATE OR REPLACE FUNCTION public._d118_loose(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $f$
  SELECT regexp_replace(
           lower(regexp_replace(regexp_replace(coalesce(t, ''), '\[email\]', ' ', 'gi'),
                                '[A-Za-z0-9_.+-]+@[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+', ' ', 'g')),
           '[^a-z0-9]+', '', 'g')
$f$;

-- 1. Preview (counts and lengths only; no comment text). Expected on 2026-11-17: marked 5, false_marks 5.
WITH r AS (
  SELECT pc.id,
         pc.project_id,
         public._d118_loose(split_part(split_part(pc.original_text, E'full_discussion_text:\n', 2), E'\nstatus:', 1)) AS stored,
         public._d118_loose(split_part(split_part(pc.portal_latest_text, E'full_discussion_text:\n', 2), E'\nstatus:', 1)) AS latest
  FROM public.parsed_comments pc
  WHERE pc.portal_changed_at IS NOT NULL
)
SELECT count(*) AS marked,
       count(*) FILTER (WHERE latest <> '' AND left(stored, length(latest)) = latest) AS false_marks,
       count(DISTINCT project_id) AS projects
FROM r;

-- 2. Repair. Refuses unless exactly the expected number of rows match; review the preview first.
DO $$
DECLARE
  v_expected CONSTANT INTEGER := 5;
  v_count INTEGER;
BEGIN
  CREATE TEMP TABLE d118_target ON COMMIT DROP AS
  SELECT pc.id, pc.project_id, pc.portal_changed_at, pc.portal_latest_text
  FROM public.parsed_comments pc
  WHERE pc.portal_changed_at IS NOT NULL
    AND pc.project_id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd'
    AND pc.portal_permit_id = '06fa082e-b942-4b54-b448-a1527f58df41'
    AND (
      WITH n AS (
        SELECT public._d118_loose(split_part(split_part(pc.original_text, E'full_discussion_text:\n', 2), E'\nstatus:', 1)) AS stored,
               public._d118_loose(split_part(split_part(pc.portal_latest_text, E'full_discussion_text:\n', 2), E'\nstatus:', 1)) AS latest
      )
      SELECT latest <> '' AND left(stored, length(latest)) = latest FROM n
    )
  FOR UPDATE OF pc;

  SELECT count(*) INTO v_count FROM d118_target;
  IF v_count <> v_expected THEN
    RAISE EXCEPTION 'D-118 repair refused: % rows match, expected %', v_count, v_expected;
  END IF;

  INSERT INTO public.platform_audit_events (action, target_type, target_id, project_id, before_json, after_json, result)
  SELECT 'pipeline.portal_mark_cleared', 'parsed_comment', t.id::text, t.project_id,
         jsonb_build_object('portal_changed_at', t.portal_changed_at, 'portal_latest_text', t.portal_latest_text),
         jsonb_build_object('repair', 'D-118', 'reason', 'report thread compared with comment body; portal text unchanged'),
         'success'
  FROM d118_target t;

  UPDATE public.parsed_comments pc
  SET portal_changed_at = NULL, portal_latest_text = NULL
  FROM d118_target t
  WHERE pc.id = t.id;

  RAISE NOTICE 'D-118 repair: cleared % rows', v_count;
END $$;

-- 3. After (expected: marked 0 on the project, audit rows 5).
SELECT count(*) FILTER (WHERE portal_changed_at IS NOT NULL) AS still_marked, count(*) AS rows_on_project
FROM public.parsed_comments WHERE project_id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd';
SELECT count(*) AS audit_rows FROM public.platform_audit_events
WHERE action = 'pipeline.portal_mark_cleared' AND after_json->>'repair' = 'D-118';

DROP FUNCTION public._d118_loose(TEXT);

COMMIT;
