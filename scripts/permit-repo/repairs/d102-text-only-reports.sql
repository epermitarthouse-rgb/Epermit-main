-- One-time data repair for D-102. NOT a migration; run manually (SQL editor or `supabase db query --linked -f`)
-- only after approval and after the worker with D-102 (reports need an exported file) is deployed, otherwise
-- the next refresh records the same error text as captured again.
--
-- Before D-102 a Reports-tab entry whose SSRS render failed (error text, no PDF or Excel export) was recorded
-- as a captured version. Captured reports are never retried, so those reports stayed wrong. This marks them
-- failed and retryable; the next deep refresh of the permit fetches them again. permit_report_contents is
-- append-only and is not touched: the text-only versions stay in history.
--
-- Rollback (only while no newer capture exists for these reports): re-point each report to its newest version
--   UPDATE public.permit_reports r
--   SET content_status = 'captured', content_error = NULL, content_attempts = 0, content_next_attempt_at = NULL,
--       latest_content_id = (SELECT c.id FROM public.permit_report_contents c
--                            WHERE c.permit_id = r.permit_id AND c.report_key = r.report_key
--                            ORDER BY c.version DESC LIMIT 1)
--   WHERE r.content_error = 'D-102 repair: report rendered without an exported file' AND r.latest_content_id IS NULL;

-- 1. Preview (identifiers only; no report text).
SELECT p.portal_record_id, r.report_key, r.name, c.version, c.source, length(c.text_content) AS text_chars, c.captured_at
FROM public.permit_reports r
JOIN public.permits p ON p.id = r.permit_id
JOIN public.permit_report_contents c ON c.id = r.latest_content_id
WHERE r.content_status = 'captured' AND r.removed_at IS NULL
  AND c.pdf_storage_path IS NULL AND c.excel_storage_path IS NULL
ORDER BY p.portal_record_id, r.report_key;

-- 2. Repair. Refuses unless exactly the expected number of reports match (8 on 2026-11-17); if the preview
--    shows a different count, review it and change v_expected.
DO $$
DECLARE
  v_expected CONSTANT INTEGER := 8;
  v_count INTEGER;
BEGIN
  WITH target AS (
    SELECT r.id
    FROM public.permit_reports r
    JOIN public.permit_report_contents c ON c.id = r.latest_content_id
    WHERE r.content_status = 'captured' AND r.removed_at IS NULL
      AND c.pdf_storage_path IS NULL AND c.excel_storage_path IS NULL
    FOR UPDATE OF r
  )
  UPDATE public.permit_reports r
  SET content_status = 'failed', latest_content_id = NULL,
      content_error = 'D-102 repair: report rendered without an exported file',
      content_attempts = 0, content_next_attempt_at = NULL
  FROM target WHERE r.id = target.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> v_expected THEN
    RAISE EXCEPTION 'expected % reports, matched %; nothing changed', v_expected, v_count;
  END IF;
  RAISE NOTICE 'marked % reports failed and retryable', v_count;
END $$;

-- 3. Check: no captured report points at a version without an exported file.
SELECT count(*) AS still_text_only
FROM public.permit_reports r
JOIN public.permit_report_contents c ON c.id = r.latest_content_id
WHERE r.content_status = 'captured' AND r.removed_at IS NULL
  AND c.pdf_storage_path IS NULL AND c.excel_storage_path IS NULL;
