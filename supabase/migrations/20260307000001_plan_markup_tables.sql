-- T001: Plan markup and architect profiles tables

CREATE TABLE IF NOT EXISTS architect_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seal_image_url TEXT,
  signature_image_url TEXT,
  license_number TEXT,
  license_state TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE architect_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own architect profile"
  ON architect_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own architect profile"
  ON architect_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own architect profile"
  ON architect_profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS plan_markups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id UUID,
  comment_id UUID REFERENCES parsed_comments(id) ON DELETE SET NULL,
  page_number INTEGER NOT NULL DEFAULT 1,
  markup_data JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE plan_markups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view plan markups for accessible projects"
  ON plan_markups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p WHERE p.id = plan_markups.project_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert plan markups for own projects"
  ON plan_markups FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p WHERE p.id = plan_markups.project_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update plan markups for own projects"
  ON plan_markups FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects p WHERE p.id = plan_markups.project_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete plan markups for own projects"
  ON plan_markups FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects p WHERE p.id = plan_markups.project_id AND p.user_id = auth.uid()
    )
  );
