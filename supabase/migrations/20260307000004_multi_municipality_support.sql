-- Multi-Municipality Support for Permit Filing System
-- Extends the PermitWizard filing pipeline to support 10 DMV jurisdictions across 4 portal platforms

-- Expand review_track constraint to support multi-municipality tracks
ALTER TABLE permit_filings DROP CONSTRAINT IF EXISTS permit_filings_review_track_check;
ALTER TABLE permit_filings ADD CONSTRAINT permit_filings_review_track_check
  CHECK (review_track IS NULL OR review_track IN (
    'walk_through', 'projectdox',
    'standard', 'expedited',
    'vpc_walkthrough', 'fast_track', 'esolar'
  ));

-- Municipality configuration table
CREATE TABLE IF NOT EXISTS municipality_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_key TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  state TEXT NOT NULL,
  county TEXT,
  portal_type TEXT NOT NULL CHECK (portal_type IN ('accela', 'momentum_liferay', 'aspnet_webforms', 'energov')),
  portal_base_url TEXT NOT NULL,
  login_url TEXT,
  property_data_source TEXT CHECK (property_data_source IS NULL OR property_data_source IN ('dc_scout', 'sdat_md', 'fairfax_gis', 'dpor_va', 'none')),
  license_validation_source TEXT CHECK (license_validation_source IS NULL OR license_validation_source IN ('dlcp_dc', 'dllr_md', 'dpor_va', 'none')),
  permit_types JSONB DEFAULT '[]'::jsonb,
  agent_config JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add municipality and credential_id to permit_filings
ALTER TABLE permit_filings ADD COLUMN IF NOT EXISTS municipality TEXT;
ALTER TABLE permit_filings ADD COLUMN IF NOT EXISTS credential_id UUID REFERENCES portal_credentials(id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_municipality_configs_key ON municipality_configs(municipality_key);
CREATE INDEX IF NOT EXISTS idx_municipality_configs_active ON municipality_configs(is_active);
CREATE INDEX IF NOT EXISTS idx_permit_filings_municipality ON permit_filings(municipality);
CREATE INDEX IF NOT EXISTS idx_permit_filings_credential ON permit_filings(credential_id);

-- RLS
ALTER TABLE municipality_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view municipality configs"
  ON municipality_configs FOR SELECT
  USING (auth.role() = 'authenticated');

-- Seed all 10 municipalities

-- 1. DC Department of Buildings (Accela - PermitWizard with Access DC SSO)
INSERT INTO municipality_configs (municipality_key, display_name, short_name, state, county, portal_type, portal_base_url, login_url, property_data_source, license_validation_source, permit_types, agent_config)
VALUES (
  'dc_dob',
  'DC Department of Buildings',
  'DC DOB',
  'DC',
  NULL,
  'accela',
  'https://permitwizard.dcra.dc.gov',
  'https://login.dc.gov',
  'dc_scout',
  'dlcp_dc',
  '[
    {"code": "CONSTRUCTION", "label": "Construction Permit"},
    {"code": "SUPPLEMENTAL", "label": "Supplemental Permit"},
    {"code": "POSTCARD", "label": "Postcard Permit"},
    {"code": "DEMOLITION", "label": "Demolition Permit"},
    {"code": "EXCAVATION", "label": "Excavation Permit"},
    {"code": "CRANE", "label": "Crane/Derrick Permit"},
    {"code": "SHEETING_SHORING", "label": "Sheeting & Shoring Permit"},
    {"code": "RAZE", "label": "Raze Permit"},
    {"code": "SOLAR", "label": "Solar Permit"}
  ]'::jsonb,
  '{
    "agency_name": "DC Department of Buildings",
    "agency_short": "DC DOB",
    "sso_type": "access_dc",
    "fee_schedule_ref": "DOB Building Permit Fee Schedule",
    "sister_agencies": ["DC Water", "DOEE", "DDOT", "Historic Preservation Office", "Office of Planning", "Fire & EMS"],
    "gpt_prompt_context": "You are a DC Department of Buildings (DOB) permit classification expert. You know DC building codes, zoning regulations, and the DOB fee schedule.",
    "review_tracks": ["walk_through", "projectdox"],
    "property_lookup_url": "https://scout.dcra.dc.gov",
    "license_lookup_url": "https://verify.dcra.dc.gov"
  }'::jsonb
) ON CONFLICT (municipality_key) DO NOTHING;

-- 2. Fairfax County, VA (Accela - standard login)
INSERT INTO municipality_configs (municipality_key, display_name, short_name, state, county, portal_type, portal_base_url, login_url, property_data_source, license_validation_source, permit_types, agent_config)
VALUES (
  'fairfax_county_va',
  'Fairfax County Land Development Services',
  'Fairfax Co.',
  'VA',
  'Fairfax',
  'accela',
  'https://plus.fairfaxcounty.gov/CitizenAccess',
  'https://plus.fairfaxcounty.gov/CitizenAccess/Login.aspx',
  'fairfax_gis',
  'dpor_va',
  '[
    {"code": "BUILDING", "label": "Building Permit"},
    {"code": "ELECTRICAL", "label": "Electrical Permit"},
    {"code": "MECHANICAL", "label": "Mechanical Permit"},
    {"code": "PLUMBING", "label": "Plumbing Permit"},
    {"code": "FIRE", "label": "Fire Prevention Permit"},
    {"code": "DEMOLITION", "label": "Demolition Permit"},
    {"code": "GRADING", "label": "Grading Permit"},
    {"code": "SITE", "label": "Site Plan"}
  ]'::jsonb,
  '{
    "agency_name": "Fairfax County Land Development Services",
    "agency_short": "Fairfax LDS",
    "sso_type": "standard_accela",
    "fee_schedule_ref": "Fairfax County Building Permit Fee Schedule",
    "sister_agencies": ["Fairfax Water", "VDOT", "Health Department", "Fire Marshal", "Zoning"],
    "gpt_prompt_context": "You are a Fairfax County Land Development Services (LDS) permit classification expert. You know Virginia building codes, Fairfax County zoning ordinance, and the LDS fee schedule.",
    "review_tracks": ["standard", "expedited"],
    "license_lookup_url": "https://www.dpor.virginia.gov"
  }'::jsonb
) ON CONFLICT (municipality_key) DO NOTHING;

-- 3. Baltimore City, MD (Accela - standard login)
INSERT INTO municipality_configs (municipality_key, display_name, short_name, state, county, portal_type, portal_base_url, login_url, property_data_source, license_validation_source, permit_types, agent_config)
VALUES (
  'baltimore_city_md',
  'Baltimore City Permits & Code Enforcement',
  'Baltimore City',
  'MD',
  NULL,
  'accela',
  'https://aca-prod.accela.com/BALTIMORE',
  'https://aca-prod.accela.com/BALTIMORE/Login.aspx',
  'sdat_md',
  'dllr_md',
  '[
    {"code": "BUILDING", "label": "Building Permit"},
    {"code": "USE_OCCUPANCY", "label": "Use & Occupancy Permit"},
    {"code": "ELECTRICAL", "label": "Electrical Permit"},
    {"code": "PLUMBING", "label": "Plumbing Permit"},
    {"code": "DEMOLITION", "label": "Demolition Permit"},
    {"code": "FIRE", "label": "Fire Protection Permit"}
  ]'::jsonb,
  '{
    "agency_name": "Baltimore City Department of Housing - Permits & Code Enforcement",
    "agency_short": "Baltimore Permits",
    "sso_type": "standard_accela",
    "fee_schedule_ref": "Baltimore City Building Permit Fee Schedule",
    "sister_agencies": ["DPW", "Fire Department", "Health Department", "CHAP", "Planning"],
    "gpt_prompt_context": "You are a Baltimore City permits and code enforcement expert. You know Maryland building codes, Baltimore City zoning code, and the permit fee schedule.",
    "review_tracks": ["standard"],
    "license_lookup_url": "https://www.dllr.state.md.us"
  }'::jsonb
) ON CONFLICT (municipality_key) DO NOTHING;

-- 4. Howard County, MD (Accela - standard login)
INSERT INTO municipality_configs (municipality_key, display_name, short_name, state, county, portal_type, portal_base_url, login_url, property_data_source, license_validation_source, permit_types, agent_config)
VALUES (
  'howard_county_md',
  'Howard County Dept of Inspections, Licenses & Permits',
  'Howard Co.',
  'MD',
  'Howard',
  'accela',
  'https://dilp.howardcountymd.gov/CitizenAccess',
  'https://dilp.howardcountymd.gov/CitizenAccess/Login.aspx',
  'sdat_md',
  'dllr_md',
  '[
    {"code": "BUILDING", "label": "Building Permit"},
    {"code": "ELECTRICAL", "label": "Electrical Permit"},
    {"code": "MECHANICAL", "label": "Mechanical Permit"},
    {"code": "PLUMBING", "label": "Plumbing Permit"},
    {"code": "GRADING", "label": "Grading Permit"},
    {"code": "DEMOLITION", "label": "Demolition Permit"}
  ]'::jsonb,
  '{
    "agency_name": "Howard County Department of Inspections, Licenses & Permits",
    "agency_short": "Howard DILP",
    "sso_type": "standard_accela",
    "fee_schedule_ref": "Howard County DILP Fee Schedule",
    "sister_agencies": ["DPW", "Fire Marshal", "Health Department", "DPZ"],
    "gpt_prompt_context": "You are a Howard County Department of Inspections, Licenses & Permits (DILP) expert. You know Maryland building codes, Howard County zoning regulations, and the DILP fee schedule.",
    "review_tracks": ["standard"],
    "license_lookup_url": "https://www.dllr.state.md.us"
  }'::jsonb
) ON CONFLICT (municipality_key) DO NOTHING;

-- 5. Arlington County, VA (Accela - standard login)
INSERT INTO municipality_configs (municipality_key, display_name, short_name, state, county, portal_type, portal_base_url, login_url, property_data_source, license_validation_source, permit_types, agent_config)
VALUES (
  'arlington_county_va',
  'Arlington County Inspection Services Division',
  'Arlington Co.',
  'VA',
  'Arlington',
  'accela',
  'https://aca-prod.accela.com/ARLINGTONCO',
  'https://aca-prod.accela.com/ARLINGTONCO/Login.aspx',
  'none',
  'dpor_va',
  '[
    {"code": "BUILDING", "label": "Building Permit"},
    {"code": "ELECTRICAL", "label": "Electrical Permit"},
    {"code": "MECHANICAL", "label": "Mechanical Permit"},
    {"code": "PLUMBING", "label": "Plumbing Permit"},
    {"code": "DEMOLITION", "label": "Demolition Permit"},
    {"code": "FIRE_PROTECTION", "label": "Fire Protection Permit"}
  ]'::jsonb,
  '{
    "agency_name": "Arlington County Inspection Services Division",
    "agency_short": "Arlington ISD",
    "sso_type": "standard_accela",
    "fee_schedule_ref": "Arlington County Permit Fee Schedule",
    "sister_agencies": ["DES", "Fire Marshal", "CPHD", "DPR"],
    "gpt_prompt_context": "You are an Arlington County Inspection Services Division permit expert. You know Virginia building codes, Arlington County zoning ordinance, and the permit fee schedule.",
    "review_tracks": ["standard", "expedited"],
    "license_lookup_url": "https://www.dpor.virginia.gov"
  }'::jsonb
) ON CONFLICT (municipality_key) DO NOTHING;

-- 6. Anne Arundel County, MD (Accela - standard login)
INSERT INTO municipality_configs (municipality_key, display_name, short_name, state, county, portal_type, portal_base_url, login_url, property_data_source, license_validation_source, permit_types, agent_config)
VALUES (
  'anne_arundel_county_md',
  'Anne Arundel County Inspections & Permits',
  'Anne Arundel Co.',
  'MD',
  'Anne Arundel',
  'accela',
  'https://aca-prod.accela.com/aaco',
  'https://aca-prod.accela.com/aaco/Login.aspx',
  'sdat_md',
  'dllr_md',
  '[
    {"code": "BUILDING", "label": "Building Permit"},
    {"code": "ELECTRICAL", "label": "Electrical Permit"},
    {"code": "MECHANICAL", "label": "Mechanical Permit"},
    {"code": "PLUMBING", "label": "Plumbing Permit"},
    {"code": "GRADING", "label": "Grading Permit"},
    {"code": "DEMOLITION", "label": "Demolition Permit"}
  ]'::jsonb,
  '{
    "agency_name": "Anne Arundel County Office of Inspections & Permits",
    "agency_short": "AA Co. I&P",
    "sso_type": "standard_accela",
    "fee_schedule_ref": "Anne Arundel County Permit Fee Schedule",
    "sister_agencies": ["DPW", "Fire Marshal", "Health Department", "OPZ"],
    "gpt_prompt_context": "You are an Anne Arundel County Office of Inspections & Permits expert. You know Maryland building codes, Anne Arundel County zoning code, and the permit fee schedule.",
    "review_tracks": ["standard"],
    "license_lookup_url": "https://www.dllr.state.md.us"
  }'::jsonb
) ON CONFLICT (municipality_key) DO NOTHING;

-- 7. Prince George's County, MD (Liferay/Momentum)
INSERT INTO municipality_configs (municipality_key, display_name, short_name, state, county, portal_type, portal_base_url, login_url, property_data_source, license_validation_source, permit_types, agent_config)
VALUES (
  'pg_county_md',
  'PG County Dept of Permitting, Inspections & Enforcement',
  'PG County',
  'MD',
  'Prince George''s',
  'momentum_liferay',
  'https://momentum.princegeorgescountymd.gov',
  'https://momentum.princegeorgescountymd.gov/login',
  'sdat_md',
  'dllr_md',
  '[
    {"code": "BUILDING", "label": "Building Permit"},
    {"code": "ELECTRICAL", "label": "Electrical Permit"},
    {"code": "MECHANICAL", "label": "Mechanical Permit"},
    {"code": "PLUMBING", "label": "Plumbing Permit"},
    {"code": "USE_OCCUPANCY", "label": "Use & Occupancy Permit"},
    {"code": "DEMOLITION", "label": "Demolition Permit"},
    {"code": "GRADING", "label": "Grading Permit"}
  ]'::jsonb,
  '{
    "agency_name": "Prince George''s County Department of Permitting, Inspections and Enforcement",
    "agency_short": "PG DPIE",
    "sso_type": "liferay_standard",
    "fee_schedule_ref": "PG County DPIE Fee Schedule",
    "sister_agencies": ["WSSC", "SHA", "DPW&T", "Fire/EMS", "Health Department", "M-NCPPC"],
    "gpt_prompt_context": "You are a Prince George''s County DPIE permit classification expert. You know Maryland building codes, PG County zoning ordinance, and the DPIE fee schedule.",
    "review_tracks": ["standard", "vpc_walkthrough"],
    "license_lookup_url": "https://www.dllr.state.md.us"
  }'::jsonb
) ON CONFLICT (municipality_key) DO NOTHING;

-- 8. Montgomery County, MD (ASP.NET WebForms)
INSERT INTO municipality_configs (municipality_key, display_name, short_name, state, county, portal_type, portal_base_url, login_url, property_data_source, license_validation_source, permit_types, agent_config)
VALUES (
  'montgomery_county_md',
  'Montgomery County Dept of Permitting Services',
  'MoCo DPS',
  'MD',
  'Montgomery',
  'aspnet_webforms',
  'https://permittingservices.montgomerycountymd.gov',
  'https://permittingservices.montgomerycountymd.gov/account/Login.aspx',
  'sdat_md',
  'dllr_md',
  '[
    {"code": "BUILDING", "label": "Building Permit"},
    {"code": "ELECTRICAL", "label": "Electrical Permit"},
    {"code": "MECHANICAL", "label": "Mechanical Permit"},
    {"code": "PLUMBING", "label": "Plumbing Permit"},
    {"code": "DEMOLITION", "label": "Demolition Permit"},
    {"code": "SEDIMENT_CONTROL", "label": "Sediment Control Permit"},
    {"code": "RIGHT_OF_WAY", "label": "Right-of-Way Permit"},
    {"code": "SOLAR", "label": "Solar Permit"}
  ]'::jsonb,
  '{
    "agency_name": "Montgomery County Department of Permitting Services",
    "agency_short": "MoCo DPS",
    "sso_type": "aspnet_forms",
    "fee_schedule_ref": "Montgomery County DPS Fee Schedule",
    "sister_agencies": ["WSSC", "SHA", "DOT", "Fire Marshal", "DEP", "M-NCPPC"],
    "gpt_prompt_context": "You are a Montgomery County Department of Permitting Services (DPS) expert. You know Maryland building codes, Montgomery County zoning ordinance, and the DPS fee schedule.",
    "review_tracks": ["standard", "fast_track", "esolar"],
    "login_fields": {
      "email": "ctl00$dpsAOContentSection$txtLoginEmail",
      "password": "ctl00$dpsAOContentSection$txtLoginPassword",
      "submit": "ctl00$dpsAOContentSection$cmdLogin"
    },
    "license_lookup_url": "https://www.dllr.state.md.us"
  }'::jsonb
) ON CONFLICT (municipality_key) DO NOTHING;

-- 9. City of Alexandria, VA (Tyler EnerGov)
INSERT INTO municipality_configs (municipality_key, display_name, short_name, state, county, portal_type, portal_base_url, login_url, property_data_source, license_validation_source, permit_types, agent_config)
VALUES (
  'alexandria_va',
  'City of Alexandria Permit Center',
  'Alexandria',
  'VA',
  NULL,
  'energov',
  'https://apex.alexandriava.gov/EnerGov_Prod/SelfService',
  'https://apex.alexandriava.gov/EnerGov_Prod/SelfService#/login',
  'none',
  'dpor_va',
  '[
    {"code": "BUILDING", "label": "Building Permit"},
    {"code": "ELECTRICAL", "label": "Electrical Permit"},
    {"code": "MECHANICAL", "label": "Mechanical Permit"},
    {"code": "PLUMBING", "label": "Plumbing Permit"},
    {"code": "DEMOLITION", "label": "Demolition Permit"},
    {"code": "FIRE", "label": "Fire Prevention Permit"},
    {"code": "SIGN", "label": "Sign Permit"}
  ]'::jsonb,
  '{
    "agency_name": "City of Alexandria Permit Center",
    "agency_short": "Alexandria PC",
    "sso_type": "energov_standard",
    "fee_schedule_ref": "City of Alexandria Permit Fee Schedule",
    "sister_agencies": ["AlexRenew", "VDOT", "Fire Marshal", "Historic Alexandria", "Planning & Zoning"],
    "gpt_prompt_context": "You are a City of Alexandria Permit Center expert. You know Virginia building codes, Alexandria zoning ordinance, and the city permit fee schedule.",
    "review_tracks": ["standard"],
    "license_lookup_url": "https://www.dpor.virginia.gov"
  }'::jsonb
) ON CONFLICT (municipality_key) DO NOTHING;

-- 10. Loudoun County, VA (Tyler EnerGov / LandMARC)
INSERT INTO municipality_configs (municipality_key, display_name, short_name, state, county, portal_type, portal_base_url, login_url, property_data_source, license_validation_source, permit_types, agent_config)
VALUES (
  'loudoun_county_va',
  'Loudoun County Building & Development',
  'Loudoun Co.',
  'VA',
  'Loudoun',
  'energov',
  'https://www.loudoun.gov/5823/LandMARC-Land-Management-Applications-Re',
  NULL,
  'none',
  'dpor_va',
  '[
    {"code": "BUILDING", "label": "Building Permit"},
    {"code": "ELECTRICAL", "label": "Electrical Permit"},
    {"code": "MECHANICAL", "label": "Mechanical Permit"},
    {"code": "PLUMBING", "label": "Plumbing Permit"},
    {"code": "GRADING", "label": "Grading Permit"},
    {"code": "DEMOLITION", "label": "Demolition Permit"},
    {"code": "SITE_PLAN", "label": "Site Plan"}
  ]'::jsonb,
  '{
    "agency_name": "Loudoun County Department of Building & Development",
    "agency_short": "Loudoun B&D",
    "sso_type": "energov_standard",
    "fee_schedule_ref": "Loudoun County Permit Fee Schedule",
    "sister_agencies": ["Loudoun Water", "VDOT", "Fire Marshal", "Health Department", "Planning & Zoning"],
    "gpt_prompt_context": "You are a Loudoun County Department of Building & Development permit expert. You know Virginia building codes, Loudoun County zoning ordinance, and the permit fee schedule.",
    "review_tracks": ["standard"],
    "license_lookup_url": "https://www.dpor.virginia.gov"
  }'::jsonb
) ON CONFLICT (municipality_key) DO NOTHING;
