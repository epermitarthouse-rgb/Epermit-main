-- Code Analyzer Async V2 — Milestone 9: storage cleanup / retention helpers.

CREATE OR REPLACE FUNCTION public.gc_orphan_code_analyzer_derived_assets(
  p_batch_size INTEGER DEFAULT 100
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  WITH orphans AS (
    SELECT a.id
    FROM public.code_analyzer_derived_assets a
    LEFT JOIN public.project_documents d ON d.id = a.document_id
    WHERE d.id IS NULL
    LIMIT GREATEST(1, LEAST(p_batch_size, 500))
  )
  DELETE FROM public.code_analyzer_derived_assets
  WHERE id IN (SELECT id FROM orphans);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gc_orphan_code_analyzer_derived_assets(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_document_analyzer_assets(
  p_document_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  DELETE FROM public.code_analyzer_derived_assets WHERE document_id = p_document_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM public.code_analyzer_spec_sections WHERE document_id = p_document_id;
  DELETE FROM public.project_document_chunks
  WHERE document_id = p_document_id AND source_class = 'specification';

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_document_analyzer_assets(UUID) TO service_role;
