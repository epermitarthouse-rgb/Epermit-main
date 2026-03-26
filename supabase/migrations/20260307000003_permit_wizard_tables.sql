-- PermitWizard Agentic AI Filing System Tables
-- Supports the 9-agent autonomous permit filing pipeline for DC DOB

-- Main filing record tracking the full pipeline lifecycle
CREATE TABLE IF NOT EXISTS permit_filings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  filing_status TEXT NOT NULL DEFAULT 'preflight'
    CHECK (filing_status IN ('preflight','awaiting_approval','approved','filing','submitted','failed','cancelled')),
  permit_type TEXT,
  permit_subtype TEXT,
  review_track TEXT CHECK (review_track IS NULL OR review_track IN ('walk_through','projectdox')),
  property_address TEXT,
  scope_of_work TEXT,
  construction_value NUMERIC,
  property_type TEXT,
  estimated_fee NUMERIC,
  application_id TEXT,
  confirmation_number TEXT,
  approval_package JSONB,
  approval_decision TEXT CHECK (approval_decision IS NULL OR approval_decision IN ('approved','rejected')),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  approval_notes TEXT,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual agent execution tracking
CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id UUID NOT NULL REFERENCES permit_filings(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL CHECK (agent_name IN (
    'property_intelligence','license_validation','document_preparation',
    'permit_classifier','pre_submission_review','authentication',
    'form_filing','submission_finalization','status_monitor'
  )),
  layer INTEGER NOT NULL CHECK (layer IN (1, 2, 3)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed','escalated','waiting_human')),
  input_data JSONB,
  output_data JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Property intelligence results from Agent 01
CREATE TABLE IF NOT EXISTS property_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id UUID NOT NULL REFERENCES permit_filings(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  zoning_district TEXT,
  overlay_zones TEXT[],
  historic_district BOOLEAN DEFAULT false,
  flood_hazard_zone BOOLEAN DEFAULT false,
  active_permits JSONB,
  stop_work_orders JSONB,
  advisory_flags TEXT[],
  raw_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- License validation results from Agent 02
CREATE TABLE IF NOT EXISTS license_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id UUID NOT NULL REFERENCES permit_filings(id) ON DELETE CASCADE,
  professional_name TEXT NOT NULL,
  license_type TEXT NOT NULL,
  license_number TEXT NOT NULL,
  role_on_project TEXT,
  validation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('active','expired','not_found','pending')),
  expiration_date DATE,
  scope_of_license TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Document package validation from Agent 03
CREATE TABLE IF NOT EXISTS filing_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id UUID NOT NULL REFERENCES permit_filings(id) ON DELETE CASCADE,
  document_name TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN (
    'plan','cost_estimate','contract','eif','checklist','specification','other'
  )),
  file_url TEXT,
  file_size_bytes BIGINT,
  file_format TEXT,
  validation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('valid','invalid','missing','oversized','pending')),
  validation_notes TEXT,
  upload_order INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Screenshot audit trail from Agent 07/08
CREATE TABLE IF NOT EXISTS filing_screenshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id UUID NOT NULL REFERENCES permit_filings(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  step_name TEXT NOT NULL,
  screenshot_url TEXT NOT NULL,
  field_audit JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Professionals associated with a filing
CREATE TABLE IF NOT EXISTS filing_professionals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id UUID NOT NULL REFERENCES permit_filings(id) ON DELETE CASCADE,
  professional_name TEXT NOT NULL,
  license_type TEXT NOT NULL,
  license_number TEXT NOT NULL,
  role_on_project TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_permit_filings_project ON permit_filings(project_id);
CREATE INDEX IF NOT EXISTS idx_permit_filings_user ON permit_filings(user_id);
CREATE INDEX IF NOT EXISTS idx_permit_filings_status ON permit_filings(filing_status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_filing ON agent_runs(filing_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_name);
CREATE INDEX IF NOT EXISTS idx_property_intelligence_filing ON property_intelligence(filing_id);
CREATE INDEX IF NOT EXISTS idx_license_validations_filing ON license_validations(filing_id);
CREATE INDEX IF NOT EXISTS idx_filing_documents_filing ON filing_documents(filing_id);
CREATE INDEX IF NOT EXISTS idx_filing_screenshots_filing ON filing_screenshots(filing_id);

-- RLS Policies
ALTER TABLE permit_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE filing_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE filing_screenshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE filing_professionals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own filings"
  ON permit_filings FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own filings"
  ON permit_filings FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own filings"
  ON permit_filings FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can view agent runs for their filings"
  ON agent_runs FOR SELECT
  USING (filing_id IN (SELECT id FROM permit_filings WHERE user_id = auth.uid()));

CREATE POLICY "Service role can manage agent runs"
  ON agent_runs FOR ALL
  USING (filing_id IN (SELECT id FROM permit_filings WHERE user_id = auth.uid()));

CREATE POLICY "Users can view their property intelligence"
  ON property_intelligence FOR SELECT
  USING (filing_id IN (SELECT id FROM permit_filings WHERE user_id = auth.uid()));

CREATE POLICY "Service role can manage property intelligence"
  ON property_intelligence FOR ALL
  USING (filing_id IN (SELECT id FROM permit_filings WHERE user_id = auth.uid()));

CREATE POLICY "Users can view their license validations"
  ON license_validations FOR SELECT
  USING (filing_id IN (SELECT id FROM permit_filings WHERE user_id = auth.uid()));

CREATE POLICY "Service role can manage license validations"
  ON license_validations FOR ALL
  USING (filing_id IN (SELECT id FROM permit_filings WHERE user_id = auth.uid()));

CREATE POLICY "Users can view their filing documents"
  ON filing_documents FOR SELECT
  USING (filing_id IN (SELECT id FROM permit_filings WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage their filing documents"
  ON filing_documents FOR ALL
  USING (filing_id IN (SELECT id FROM permit_filings WHERE user_id = auth.uid()));

CREATE POLICY "Users can view their filing screenshots"
  ON filing_screenshots FOR SELECT
  USING (filing_id IN (SELECT id FROM permit_filings WHERE user_id = auth.uid()));

CREATE POLICY "Service role can manage filing screenshots"
  ON filing_screenshots FOR ALL
  USING (filing_id IN (SELECT id FROM permit_filings WHERE user_id = auth.uid()));

CREATE POLICY "Users can view their filing professionals"
  ON filing_professionals FOR SELECT
  USING (filing_id IN (SELECT id FROM permit_filings WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage their filing professionals"
  ON filing_professionals FOR ALL
  USING (filing_id IN (SELECT id FROM permit_filings WHERE user_id = auth.uid()));
