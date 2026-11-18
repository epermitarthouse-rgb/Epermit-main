-- One-time data repair for D-141 (approved 2026-11-18). NOT a migration; run with
--   supabase db query --linked -f scripts/permit-repo/repairs/d141-montgomery-200100-review-comments.sql
-- before the next supervised Montgomery deep run of permit 200100 (SIGN-1159714).
--
-- The Review Comments export (report 133) of permit 9afe3e15-20c2-4e7b-b2f9-80ee377f9f7b was recorded captured
-- with no structured rows: the shared parser stopped scanning at the sheet's count of non-empty rows (6), above the
-- grid header on row 9 (fixed in lib/reviewCommentsExcelStructuredRows.js). Captured reports are never exported
-- again, so this marks that one report failed and retryable; the next deep pass of 200100 exports and parses it
-- again. permit_report_contents is append-only and is not touched: version 1 stays in history. Only this one row.
--
-- Rollback (only while no newer capture exists for this report): re-point it to its newest version
--   UPDATE public.permit_reports r
--   SET content_status = 'captured', content_error = NULL, content_attempts = 0, content_next_attempt_at = NULL,
--       latest_content_id = (SELECT c.id FROM public.permit_report_contents c
--                            WHERE c.permit_id = r.permit_id AND c.report_key = r.report_key
--                            ORDER BY c.version DESC LIMIT 1)
--   WHERE r.permit_id = '9afe3e15-20c2-4e7b-b2f9-80ee377f9f7b' AND r.report_key = '133'
--     AND r.content_error = 'D-141 repair: Review Comments export recorded without parsed rows' AND r.latest_content_id IS NULL;

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH target AS (
    SELECT r.id
    FROM public.permit_reports r
    JOIN public.permits p ON p.id = r.permit_id
    JOIN public.permit_report_contents c ON c.id = r.latest_content_id
    WHERE r.permit_id = '9afe3e15-20c2-4e7b-b2f9-80ee377f9f7b'
      AND p.adapter_key = 'montgomery-projectdox' AND p.portal_record_id = '200100'
      AND r.report_key = '133' AND r.content_status = 'captured' AND r.removed_at IS NULL
      AND c.excel_storage_path IS NOT NULL
      AND (c.structured_rows IS NULL OR jsonb_typeof(c.structured_rows) <> 'array' OR jsonb_array_length(c.structured_rows) = 0)
    FOR UPDATE OF r
  )
  UPDATE public.permit_reports r
  SET content_status = 'failed', latest_content_id = NULL,
      content_error = 'D-141 repair: Review Comments export recorded without parsed rows',
      content_attempts = 0, content_next_attempt_at = NULL
  FROM target WHERE r.id = target.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected 1 report, matched %; nothing changed', v_count;
  END IF;
  RAISE NOTICE 'marked report 133 of 200100 failed and retryable';
END $$;

-- Check (identifiers only).
SELECT report_key, content_status, content_error, content_attempts, latest_content_id IS NULL AS unlinked
FROM public.permit_reports
WHERE permit_id = '9afe3e15-20c2-4e7b-b2f9-80ee377f9f7b' ORDER BY report_key;
