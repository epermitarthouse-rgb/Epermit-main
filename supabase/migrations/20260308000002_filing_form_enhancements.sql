-- Add new columns to permit_filings for comprehensive filing form
ALTER TABLE permit_filings ADD COLUMN IF NOT EXISTS square_footage NUMERIC;
ALTER TABLE permit_filings ADD COLUMN IF NOT EXISTS number_of_stories INTEGER;
ALTER TABLE permit_filings ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE permit_filings ADD COLUMN IF NOT EXISTS owner_phone TEXT;
ALTER TABLE permit_filings ADD COLUMN IF NOT EXISTS owner_email TEXT;

-- Expand filing_documents document_type CHECK constraint to include new types
ALTER TABLE filing_documents DROP CONSTRAINT IF EXISTS filing_documents_document_type_check;
ALTER TABLE filing_documents ADD CONSTRAINT filing_documents_document_type_check
  CHECK (document_type IN (
    'plan',
    'cost_estimate',
    'contract',
    'eif',
    'checklist',
    'specification',
    'approved_documents',
    'menu',
    'plat_survey',
    'geotech_report',
    'letter_of_authorization',
    'other'
  ));
