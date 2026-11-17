-- One-time data repair for D-118/D-119. NOT a migration; run manually (`supabase db query --linked -f`) only
-- after approval and after comment-parser-agent with the D-119 rule is deployed. Clears false "Updated on
-- portal" marks (portal_changed_at, portal_latest_text) that the first repository run set on report-parsed rows:
-- their full_discussion_text is the whole thread (reviewer comment, then each response behind a header line
-- "<Label>: <who> - <date time>"), the repository body is the reviewer comment alone, and the comparison
-- treated the difference as a portal change.
--
-- A mark is cleared only when the COMMENT PART of the stored thread (everything before the first response
-- header line, the same rule as commentPortionOf() in permitRepositoryComments.ts) equals the marked portal
-- comment after the usual normalisation (case, punctuation, spacing, line breaks, e-mail redaction). A real edit
-- (changed, shortened, truncated, appended) leaves a different comment part and keeps its mark. The header
-- is only recognised when the repository holds responses for that comment, as in the parser.
-- Nothing else is written: original_text, status, responses and approvals stay as they are.
-- Each cleared row gets one platform_audit_events row holding the previous values.
--
-- Not needed if the fixed parser runs on the project first ("Process comments now"): that run clears these marks
-- itself. This script is the explicit, audited path.
--
-- Rollback (restores the cleared marks from the audit rows):
--   UPDATE public.parsed_comments pc
--   SET portal_changed_at = (a.before_json->>'portal_changed_at')::timestamptz,
--       portal_latest_text = a.before_json->>'portal_latest_text'
--   FROM public.platform_audit_events a
--   WHERE a.action = 'pipeline.portal_mark_cleared' AND a.after_json->>'repair' = 'D-118'
--     AND a.target_id = pc.id::text AND pc.portal_changed_at IS NULL;

BEGIN;

-- Same comparison as looseText(): e-mail addresses and [email] redactions removed, lower case, letters and
-- digits only. Temporary helpers, dropped at the end of this script.
CREATE OR REPLACE FUNCTION public._d118_loose(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $f$
  SELECT regexp_replace(
           lower(regexp_replace(regexp_replace(coalesce(t, ''), '\[email\]', ' ', 'gi'),
                                '[A-Za-z0-9_.+-]+@[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+', ' ', 'g')),
           '[^a-z0-9]+', '', 'g')
$f$;

-- Everything before the first response header line (RESPONSE_HEADER_LINE in the parser); the whole text when
-- there are no responses to look for.
CREATE OR REPLACE FUNCTION public._d118_comment_part(t TEXT, has_responses BOOLEAN) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN has_responses THEN
    regexp_replace(coalesce(t, ''),
      '(^|\r?\n)[ \t]*[A-Za-z][A-Za-z .''-]{0,40}:[^\r\n]{0,200} - [0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4}[ ,]+[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?[ \t]*([AaPp][Mm])?[ \t]*(\r?\n|$).*$',
      '')
  ELSE coalesce(t, '') END
$f$;

-- The rows judged by the rule, with the facts behind the judgement (no text).
CREATE TEMP TABLE d118_judged ON COMMIT DROP AS
SELECT pc.id, pc.project_id, pc.portal_changed_at, pc.portal_latest_text,
       public._d118_loose(public._d118_comment_part(
         split_part(split_part(pc.original_text, E'full_discussion_text:\n', 2), E'\nstatus:', 1),
         EXISTS (SELECT 1 FROM public.permit_review_responses x
                 WHERE x.permit_id = pc.portal_permit_id AND x.comment_key = pc.portal_comment_key AND x.removed_at IS NULL)
       )) AS stored,
       public._d118_loose(split_part(split_part(pc.portal_latest_text, E'full_discussion_text:\n', 2), E'\nstatus:', 1)) AS latest
FROM public.parsed_comments pc
WHERE pc.portal_changed_at IS NOT NULL;

-- 1. Preview (counts only). Expected on 2026-11-17: marked 5, false_marks 5, real_changes 0, projects 1.
SELECT count(*) AS marked,
       count(*) FILTER (WHERE latest <> '' AND stored = latest) AS false_marks,
       count(*) FILTER (WHERE NOT (latest <> '' AND stored = latest)) AS real_changes,
       count(DISTINCT project_id) AS projects
FROM d118_judged;

-- 2. Repair. Refuses unless exactly the expected number of rows match; review the preview first.
DO $$
DECLARE
  v_expected CONSTANT INTEGER := 5;
  v_count INTEGER;
BEGIN
  CREATE TEMP TABLE d118_target ON COMMIT DROP AS
  SELECT j.id, j.project_id, j.portal_changed_at, j.portal_latest_text
  FROM d118_judged j
  WHERE j.project_id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd'
    AND j.latest <> '' AND j.stored = j.latest;

  SELECT count(*) INTO v_count FROM d118_target;
  IF v_count <> v_expected THEN
    RAISE EXCEPTION 'D-118 repair refused: % rows match, expected %', v_count, v_expected;
  END IF;

  INSERT INTO public.platform_audit_events (action, target_type, target_id, project_id, before_json, after_json, result)
  SELECT 'pipeline.portal_mark_cleared', 'parsed_comment', t.id::text, t.project_id,
         jsonb_build_object('portal_changed_at', t.portal_changed_at, 'portal_latest_text', t.portal_latest_text),
         jsonb_build_object('repair', 'D-118', 'reason', 'report thread compared with comment body; portal comment unchanged'),
         'success'
  FROM d118_target t;

  UPDATE public.parsed_comments pc
  SET portal_changed_at = NULL, portal_latest_text = NULL
  FROM d118_target t
  WHERE pc.id = t.id;

  RAISE NOTICE 'D-118 repair: cleared % rows', v_count;
END $$;

-- 3. After (expected: still_marked 0, audit_rows 5).
SELECT count(*) FILTER (WHERE portal_changed_at IS NOT NULL) AS still_marked, count(*) AS rows_on_project
FROM public.parsed_comments WHERE project_id = 'ff193644-3e94-46d4-a1c0-4755fc65d0dd';
SELECT count(*) AS audit_rows FROM public.platform_audit_events
WHERE action = 'pipeline.portal_mark_cleared' AND after_json->>'repair' = 'D-118';

DROP FUNCTION public._d118_comment_part(TEXT, BOOLEAN);
DROP FUNCTION public._d118_loose(TEXT);

COMMIT;
