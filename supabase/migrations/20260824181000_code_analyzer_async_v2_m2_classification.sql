-- Code Analyzer Async V2 — Milestone 2: classification + document routing.

CREATE TABLE IF NOT EXISTS public.code_analyzer_document_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  page_start INTEGER NOT NULL CHECK (page_start >= 1),
  page_end INTEGER NOT NULL CHECK (page_end >= page_start),
  analyzer_class TEXT NOT NULL CHECK (analyzer_class IN (
    'drawing_set', 'specification', 'code_modification_form',
    'schedule', 'report', 'supporting', 'mixed', 'unknown'
  )),
  class_source TEXT NOT NULL DEFAULT 'auto' CHECK (class_source IN ('auto', 'user', 'filename', 'sampled_ai')),
  confidence NUMERIC(4, 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT code_analyzer_document_segments_unique
    UNIQUE (document_id, page_start, page_end)
);

CREATE INDEX IF NOT EXISTS idx_code_analyzer_document_segments_doc
  ON public.code_analyzer_document_segments (document_id, page_start);

ALTER TABLE public.code_analyzer_document_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view document segments" ON public.code_analyzer_document_segments;
CREATE POLICY "Users can view document segments"
  ON public.code_analyzer_document_segments FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can manage document segments" ON public.code_analyzer_document_segments;
CREATE POLICY "Users can manage document segments"
  ON public.code_analyzer_document_segments FOR ALL
  USING (public.has_project_editor_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_editor_access(auth.uid(), project_id));

DROP TRIGGER IF EXISTS update_code_analyzer_document_segments_updated_at
  ON public.code_analyzer_document_segments;
CREATE TRIGGER update_code_analyzer_document_segments_updated_at
  BEFORE UPDATE ON public.code_analyzer_document_segments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- User override for analyzer class (always wins over auto classification)
CREATE OR REPLACE FUNCTION public.set_document_analyzer_class(
  p_document_id UUID,
  p_project_id UUID,
  p_user_id UUID,
  p_analyzer_class TEXT,
  p_segments JSONB DEFAULT NULL
)
RETURNS public.project_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.project_documents;
  v_seg JSONB;
BEGIN
  IF NOT public.has_project_editor_access(p_user_id, p_project_id) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  SELECT * INTO v_doc
  FROM public.project_documents
  WHERE id = p_document_id AND project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'document not found';
  END IF;

  UPDATE public.project_documents
  SET
    analyzer_class = p_analyzer_class,
    analyzer_class_source = 'user',
    analyzer_class_confidence = 1.0,
    updated_at = now()
  WHERE id = p_document_id
  RETURNING * INTO v_doc;

  IF p_segments IS NOT NULL THEN
    DELETE FROM public.code_analyzer_document_segments WHERE document_id = p_document_id;
    FOR v_seg IN SELECT * FROM jsonb_array_elements(p_segments)
    LOOP
      INSERT INTO public.code_analyzer_document_segments (
        project_id, document_id, page_start, page_end, analyzer_class, class_source, confidence
      ) VALUES (
        p_project_id,
        p_document_id,
        (v_seg->>'page_start')::INTEGER,
        (v_seg->>'page_end')::INTEGER,
        v_seg->>'analyzer_class',
        'user',
        1.0
      );
    END LOOP;
  END IF;

  RETURN v_doc;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_document_analyzer_class(UUID, UUID, UUID, TEXT, JSONB)
  TO authenticated;
