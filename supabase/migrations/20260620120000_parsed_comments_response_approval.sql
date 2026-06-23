-- Response Matrix: per-comment response approval workflow (distinct from comment status).

ALTER TABLE public.parsed_comments
  ADD COLUMN IF NOT EXISTS response_status TEXT,
  ADD COLUMN IF NOT EXISTS ai_generated_response_text TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_edited_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS change_request_note TEXT;

ALTER TABLE public.parsed_comments
  DROP CONSTRAINT IF EXISTS parsed_comments_response_status_check;

ALTER TABLE public.parsed_comments
  ADD CONSTRAINT parsed_comments_response_status_check
  CHECK (
    response_status IS NULL
    OR response_status IN (
      'AI Generated',
      'Draft',
      'Awaiting Approval',
      'Approved',
      'Changes Requested'
    )
  );

CREATE INDEX IF NOT EXISTS idx_parsed_comments_response_status
  ON public.parsed_comments(project_id, response_status);

-- Enforce approval rules server-side (not frontend-only).
CREATE OR REPLACE FUNCTION public.enforce_parsed_comment_response_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.response_status = 'Approved' THEN
    IF NEW.response_text IS NULL OR btrim(NEW.response_text) = '' THEN
      RAISE EXCEPTION 'Cannot approve an empty response';
    END IF;
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Authentication required to approve a response';
    END IF;
    IF NOT public.has_project_admin_access(auth.uid(), NEW.project_id) THEN
      RAISE EXCEPTION 'Insufficient permission to approve a response';
    END IF;
    IF TG_OP = 'INSERT'
      OR NEW.response_status IS DISTINCT FROM OLD.response_status
      OR NEW.approved_at IS NULL
      OR NEW.approved_by IS NULL THEN
      NEW.approved_at := now();
      NEW.approved_by := auth.uid();
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.response_status = 'Approved'
    AND NEW.response_status IS DISTINCT FROM 'Approved' THEN
    NEW.approved_at := NULL;
    NEW.approved_by := NULL;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.response_text IS DISTINCT FROM OLD.response_text THEN
    IF OLD.response_status = 'Approved' THEN
      NEW.response_status := COALESCE(NULLIF(NEW.response_status, 'Approved'), 'Draft');
      NEW.approved_at := NULL;
      NEW.approved_by := NULL;
    END IF;
    IF auth.uid() IS NOT NULL THEN
      NEW.last_edited_at := now();
      NEW.last_edited_by := auth.uid();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_parsed_comments_response_approval ON public.parsed_comments;

CREATE TRIGGER trg_parsed_comments_response_approval
  BEFORE INSERT OR UPDATE ON public.parsed_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_parsed_comment_response_approval();
