ALTER TABLE projects ADD COLUMN IF NOT EXISTS credential_id UUID REFERENCES portal_credentials(id) ON DELETE SET NULL;
