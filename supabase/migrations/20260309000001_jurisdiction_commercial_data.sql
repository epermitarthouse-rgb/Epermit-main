-- Add commercial permit data and portal URL columns to jurisdictions
ALTER TABLE jurisdictions ADD COLUMN IF NOT EXISTS commercial_permits_2024 INTEGER;
ALTER TABLE jurisdictions ADD COLUMN IF NOT EXISTS total_permits_2024 INTEGER;
ALTER TABLE jurisdictions ADD COLUMN IF NOT EXISTS avg_review_days_actual INTEGER;
ALTER TABLE jurisdictions ADD COLUMN IF NOT EXISTS avg_issuance_days_actual INTEGER;
ALTER TABLE jurisdictions ADD COLUMN IF NOT EXISTS permit_portal_url TEXT;
