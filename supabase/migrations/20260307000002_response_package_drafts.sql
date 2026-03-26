-- T013: Response package drafts and review rounds

CREATE TABLE IF NOT EXISTS response_package_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL DEFAULT 1,
  round_label TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'superseded')),
  template TEXT DEFAULT 'simple' CHECK (template IN ('letter', 'memo', 'simple')),
  municipality_address TEXT,
  custom_notes TEXT,
  exported_pdf_url TEXT,
  comment_snapshot JSONB,
  created_by UUID REFERENCES auth.users(id),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE response_package_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view drafts for own projects"
  ON response_package_drafts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p WHERE p.id = response_package_drafts.project_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert drafts for own projects"
  ON response_package_drafts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p WHERE p.id = response_package_drafts.project_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update drafts for own projects"
  ON response_package_drafts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects p WHERE p.id = response_package_drafts.project_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete drafts for own projects"
  ON response_package_drafts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects p WHERE p.id = response_package_drafts.project_id AND p.user_id = auth.uid()
    )
  );

ALTER TABLE parsed_comments ADD COLUMN IF NOT EXISTS review_round INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS company_branding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logo_url TEXT,
  company_address TEXT,
  company_phone TEXT,
  company_email TEXT,
  company_website TEXT,
  default_signoff TEXT DEFAULT 'Respectfully submitted,',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE company_branding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company branding"
  ON company_branding FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own company branding"
  ON company_branding FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own company branding"
  ON company_branding FOR UPDATE
  USING (auth.uid() = user_id);
