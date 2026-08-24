-- Multi-document DC Code Modification Review (additive, backward compatible).
-- project_documents already stores each upload; this links reviews to the full document set.

CREATE TABLE IF NOT EXISTS public.code_modification_review_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES public.code_modification_reviews(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (review_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_code_modification_review_documents_review
  ON public.code_modification_review_documents (review_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_code_modification_review_documents_document
  ON public.code_modification_review_documents (document_id);

ALTER TABLE public.code_modification_review_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view code modification review documents"
  ON public.code_modification_review_documents;
CREATE POLICY "Users can view code modification review documents"
  ON public.code_modification_review_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.code_modification_reviews r
      WHERE r.id = review_id
        AND public.has_project_access(auth.uid(), r.project_id)
    )
  );

DROP POLICY IF EXISTS "Users can insert code modification review documents"
  ON public.code_modification_review_documents;
CREATE POLICY "Users can insert code modification review documents"
  ON public.code_modification_review_documents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.code_modification_reviews r
      WHERE r.id = review_id
        AND public.has_project_access(auth.uid(), r.project_id)
    )
  );

DROP POLICY IF EXISTS "Users can delete code modification review documents"
  ON public.code_modification_review_documents;
CREATE POLICY "Users can delete code modification review documents"
  ON public.code_modification_review_documents FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.code_modification_reviews r
      WHERE r.id = review_id
        AND public.has_project_access(auth.uid(), r.project_id)
    )
  );

-- Backfill legacy single-form reviews.
INSERT INTO public.code_modification_review_documents (review_id, document_id, sort_order)
SELECT id, form_document_id, 0
FROM public.code_modification_reviews
WHERE form_document_id IS NOT NULL
ON CONFLICT (review_id, document_id) DO NOTHING;
