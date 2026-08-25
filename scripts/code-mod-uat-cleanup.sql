-- DC Code Modification UAT cleanup (test project only)
-- Replace :project_id with the UAT project UUID before running.
-- Run SELECT steps first; review rows; then DELETE in a transaction.

-- 1) List duplicate permit_drawing roots by normalized filename + size
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
WHERE pd.project_id = :project_id
  AND pd.document_type = 'permit_drawing'
  AND pd.parent_document_id IS NULL
GROUP BY pd.id
ORDER BY lower(trim(pd.file_name)), pd.file_size, pd.created_at;

-- 2) Duplicate conflict PDF candidates (adjust filename ILIKE as needed)
SELECT
  pd.id,
  pd.file_name,
  pd.created_at,
  array_agg(cas.id ORDER BY cas.page_number) AS sheet_ids
FROM project_documents pd
JOIN code_analyzer_sheets cas ON cas.source_document_id = pd.id
WHERE pd.project_id = :project_id
  AND pd.file_name ILIKE '%Conflict_Occupant_Load%'
GROUP BY pd.id
ORDER BY pd.created_at;

-- 3) Keep earliest root per filename+size; mark later roots as redundant
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
  WHERE pd.project_id = :project_id
    AND pd.document_type = 'permit_drawing'
    AND pd.parent_document_id IS NULL
)
SELECT id, file_name, file_size, created_at
FROM ranked
WHERE rn > 1
ORDER BY file_name, created_at;

-- 4) Safe delete order for ONE redundant source (repeat per duplicate id after review):
-- BEGIN;
-- DELETE FROM code_analyzer_sheets WHERE source_document_id = :redundant_source_id;
-- DELETE FROM project_documents WHERE parent_document_id = :redundant_source_id;
-- DELETE FROM project_documents WHERE id = :redundant_source_id;
-- COMMIT;

-- 5) Orphan page images with no remaining sheet reference
SELECT pd.id, pd.file_name, pd.parent_document_id
FROM project_documents pd
WHERE pd.project_id = :project_id
  AND pd.parent_document_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM code_analyzer_sheets cas
    WHERE cas.image_document_id = pd.id OR cas.source_document_id = pd.id
  );
