-- Require permit_number on portal_credentials (app already validates; this enforces at DB for new/updated rows).
-- Backfill any existing NULL or blank permit_number so we can set NOT NULL.
UPDATE public.portal_credentials
SET permit_number = 'LEGACY'
WHERE permit_number IS NULL OR trim(permit_number) = '';

ALTER TABLE public.portal_credentials
ALTER COLUMN permit_number SET NOT NULL;

-- Disallow empty string going forward
ALTER TABLE public.portal_credentials
ADD CONSTRAINT portal_credentials_permit_number_non_empty
CHECK (trim(permit_number) <> '');
