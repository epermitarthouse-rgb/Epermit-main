-- Add permit volume tracking fields to jurisdictions table
ALTER TABLE public.jurisdictions
ADD COLUMN IF NOT EXISTS fips_place TEXT,
ADD COLUMN IF NOT EXISTS residential_units_2024 INTEGER,
ADD COLUMN IF NOT EXISTS sf_1unit_units_2024 INTEGER,
ADD COLUMN IF NOT EXISTS duplex_units_2024 INTEGER,
ADD COLUMN IF NOT EXISTS mf_3plus_units_2024 INTEGER,
ADD COLUMN IF NOT EXISTS is_high_volume BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS data_source TEXT;

-- Create index for high-volume jurisdictions
CREATE INDEX IF NOT EXISTS idx_jurisdictions_high_volume ON public.jurisdictions(is_high_volume) WHERE is_high_volume = true;
CREATE INDEX IF NOT EXISTS idx_jurisdictions_residential_units ON public.jurisdictions(residential_units_2024 DESC NULLS LAST);