-- DC Code Modification UAT cleanup (test project only)
-- Run in Supabase SQL Editor. Review every SELECT before DELETE.
--
-- Step 0: Confirm project (pick one method)
--
-- A) From project name (e.g. "test 5"):
-- SELECT id, name, created_at FROM projects WHERE name ILIKE '%test 5%' ORDER BY created_at DESC;
--
-- B) From a known UAT filename on this project:
-- SELECT DISTINCT pd.project_id, p.name, count(*) AS doc_count
-- FROM project_documents pd
-- JOIN projects p ON p.id = pd.project_id
-- WHERE pd.file_name ILIKE '%Conflict_Occupant_Load%'
-- GROUP BY pd.project_id, p.name;
--
-- Code Mod UAT project used in prior audit (1513 mock form + Base/Standpipe/Conflict drawings).
-- Replace below if your ?projectId= URL shows a different UUID.

\set project_id '7dec6ace-21d1-4d54-aa88-9e6ccb296e60'

-- Supabase SQL Editor does not support \set — use literal UUID in queries below instead:
-- '7dec6ace-21d1-4d54-aa88-9e6ccb296e60'

-- ---------------------------------------------------------------------------
-- 1) List duplicate permit_drawing roots by normalized filename + size
-- ---------------------------------------------------------------------------
SELECT
  pd.id,
  pd.file_name,
  pd.file_size,
  pd.document_type,
  pd.parent_document_id,
  pd.created_at,
  COUNT(cas.id) AS sheet_count
FROM project_documents pd
LEFT JOIN code_analyzer_sheets cas ON cas.source_document_id = pd.id
WHERE pd.project_id = '7dec6ace-21d1-4d54-aa88-9e6ccb296e60'
  AND pd.document_type = 'permit_drawing'
  AND pd.parent_document_id IS NULL
GROUP BY pd.id
ORDER BY lower(trim(pd.file_name)), pd.file_size, pd.created_at;

-- ---------------------------------------------------------------------------
-- 2) Duplicate conflict PDF candidates
-- ---------------------------------------------------------------------------
SELECT
  pd.id,
  pd.file_name,
  pd.created_at,
  array_agg(cas.id ORDER BY cas.page_number) AS sheet_ids
FROM project_documents pd
JOIN code_analyzer_sheets cas ON cas.source_document_id = pd.id
WHERE pd.project_id = '7dec6ace-21d1-4d54-aa88-9e6ccb296e60'
  AND pd.file_name ILIKE '%Conflict_Occupant_Load%'
GROUP BY pd.id
ORDER BY pd.created_at;

-- ---------------------------------------------------------------------------
-- 3) Redundant roots (keep earliest per filename+size; rn > 1 = delete candidates)
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    pd.id,
    pd.file_name,
    pd.file_size,
    pd.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(pd.file_name)), pd.file_size
      ORDER BY pd.created_at ASC
    ) AS rn
  FROM project_documents pd
  WHERE pd.project_id = '7dec6ace-21d1-4d54-aa88-9e6ccb296e60'
    AND pd.document_type = 'permit_drawing'
    AND pd.parent_document_id IS NULL
)
SELECT id, file_name, file_size, created_at, rn
FROM ranked
WHERE rn > 1
ORDER BY file_name, created_at;

-- ---------------------------------------------------------------------------
-- 4) Safe delete for ONE redundant source (repeat per id from step 3)
--    Replace REDUNDANT_SOURCE_UUID with each rn > 1 id after review.
-- ---------------------------------------------------------------------------
-- BEGIN;
-- DELETE FROM code_analyzer_sheets WHERE source_document_id = 'REDUNDANT_SOURCE_UUID';
-- DELETE FROM project_documents WHERE parent_document_id = 'REDUNDANT_SOURCE_UUID';
-- DELETE FROM project_documents WHERE id = 'REDUNDANT_SOURCE_UUID';
-- COMMIT;

-- ---------------------------------------------------------------------------
-- 5) Orphan page images with no remaining sheet reference
-- ---------------------------------------------------------------------------
SELECT pd.id, pd.file_name, pd.parent_document_id
FROM project_documents pd
WHERE pd.project_id = '7dec6ace-21d1-4d54-aa88-9e6ccb296e60'
  AND pd.parent_document_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM code_analyzer_sheets cas
    WHERE cas.image_document_id = pd.id OR cas.source_document_id = pd.id
  );

-- ---------------------------------------------------------------------------
-- 6) Post-cleanup sanity check (expect 3 drawing roots, 7 sheets for UAT set)
-- ---------------------------------------------------------------------------
SELECT
  count(DISTINCT pd.id) FILTER (WHERE pd.parent_document_id IS NULL) AS drawing_roots,
  count(cas.id) FILTER (WHERE cas.excluded = false) AS included_sheets
FROM project_documents pd
LEFT JOIN code_analyzer_sheets cas ON cas.source_document_id = pd.id
WHERE pd.project_id = '7dec6ace-21d1-4d54-aa88-9e6ccb296e60'
  AND pd.document_type = 'permit_drawing';
