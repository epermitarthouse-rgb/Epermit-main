-- Create table for shareable project links
CREATE TABLE public.project_share_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  created_by UUID NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.project_share_links ENABLE ROW LEVEL SECURITY;

-- Users can view share links for their own projects or projects they're team members of
CREATE POLICY "Users can view share links for accessible projects"
ON public.project_share_links
FOR SELECT
USING (public.has_project_access(auth.uid(), project_id));

-- Users with admin access can create share links
CREATE POLICY "Users can create share links for their projects"
ON public.project_share_links
FOR INSERT
WITH CHECK (public.has_project_admin_access(auth.uid(), project_id));

-- Users with admin access can update share links
CREATE POLICY "Users can update share links for their projects"
ON public.project_share_links
FOR UPDATE
USING (public.has_project_admin_access(auth.uid(), project_id));

-- Users with admin access can delete share links
CREATE POLICY "Users can delete share links for their projects"
ON public.project_share_links
FOR DELETE
USING (public.has_project_admin_access(auth.uid(), project_id));

-- Create index for faster token lookups (public access)
CREATE INDEX idx_project_share_links_token ON public.project_share_links(token);
CREATE INDEX idx_project_share_links_project_id ON public.project_share_links(project_id);