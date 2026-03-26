-- Portal credentials for jurisdiction portals (DesignCheck Agentic Workflow - Phase 1)
CREATE TABLE public.portal_credentials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  jurisdiction TEXT NOT NULL,
  portal_username TEXT NOT NULL,
  portal_password TEXT NOT NULL,
  permit_number TEXT,
  project_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS: users can only view/edit their own credentials
ALTER TABLE public.portal_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own portal credentials"
ON public.portal_credentials
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own portal credentials"
ON public.portal_credentials
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own portal credentials"
ON public.portal_credentials
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own portal credentials"
ON public.portal_credentials
FOR DELETE
USING (auth.uid() = user_id);

-- Index for listing by user
CREATE INDEX idx_portal_credentials_user_id ON public.portal_credentials(user_id);
