-- Phase 3: Response Matrix - add response fields and new status values to parsed_comments
ALTER TABLE public.parsed_comments
  ADD COLUMN IF NOT EXISTS response_text TEXT,
  ADD COLUMN IF NOT EXISTS assigned_to TEXT,
  ADD COLUMN IF NOT EXISTS sheet_reference TEXT;

-- Drop existing status check and re-add with new values
ALTER TABLE public.parsed_comments
  DROP CONSTRAINT IF EXISTS parsed_comments_status_check;

ALTER TABLE public.parsed_comments
  ADD CONSTRAINT parsed_comments_status_check
  CHECK (status IN (
    'Pending Review', 'Pending', 'Approved', 'Rejected',
    'Draft', 'Ready for Review'
  ));
