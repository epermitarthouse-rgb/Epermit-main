-- Create team role enum
CREATE TYPE public.team_role AS ENUM ('owner', 'admin', 'editor', 'viewer');

-- Create project team members table
CREATE TABLE public.project_team_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role team_role NOT NULL DEFAULT 'viewer',
  added_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, user_id)
);

-- Create project invitations table
CREATE TABLE public.project_invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role team_role NOT NULL DEFAULT 'viewer',
  invited_by UUID NOT NULL,
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  accepted_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(project_id, email, status)
);

-- Enable RLS
ALTER TABLE public.project_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_invitations ENABLE ROW LEVEL SECURITY;

-- Create function to check project access (owner or team member)
CREATE OR REPLACE FUNCTION public.has_project_access(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects 
    WHERE id = _project_id AND user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.project_team_members
    WHERE project_id = _project_id AND user_id = _user_id
  )
$$;

-- Create function to check project admin access (owner or admin role)
CREATE OR REPLACE FUNCTION public.has_project_admin_access(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects 
    WHERE id = _project_id AND user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.project_team_members
    WHERE project_id = _project_id AND user_id = _user_id AND role IN ('owner', 'admin')
  )
$$;

-- RLS policies for project_team_members
CREATE POLICY "Users can view team members for accessible projects"
ON public.project_team_members
FOR SELECT
USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project admins can add team members"
ON public.project_team_members
FOR INSERT
WITH CHECK (has_project_admin_access(auth.uid(), project_id) AND added_by = auth.uid());

CREATE POLICY "Project admins can update team members"
ON public.project_team_members
FOR UPDATE
USING (has_project_admin_access(auth.uid(), project_id));

CREATE POLICY "Project admins can remove team members"
ON public.project_team_members
FOR DELETE
USING (has_project_admin_access(auth.uid(), project_id));

-- RLS policies for project_invitations
CREATE POLICY "Users can view invitations for their projects"
ON public.project_invitations
FOR SELECT
USING (
  has_project_admin_access(auth.uid(), project_id) OR 
  email = (SELECT email FROM auth.users WHERE id = auth.uid())
);

CREATE POLICY "Project admins can create invitations"
ON public.project_invitations
FOR INSERT
WITH CHECK (has_project_admin_access(auth.uid(), project_id) AND invited_by = auth.uid());

CREATE POLICY "Project admins can update invitations"
ON public.project_invitations
FOR UPDATE
USING (has_project_admin_access(auth.uid(), project_id));

CREATE POLICY "Project admins can delete invitations"
ON public.project_invitations
FOR DELETE
USING (has_project_admin_access(auth.uid(), project_id));

-- Update projects RLS to allow team member access
DROP POLICY IF EXISTS "Users can view their own projects" ON public.projects;
CREATE POLICY "Users can view accessible projects"
ON public.projects
FOR SELECT
USING (user_id = auth.uid() OR has_project_access(auth.uid(), id));

-- Update project_documents RLS to allow team member access
DROP POLICY IF EXISTS "Users can view documents for their projects" ON public.project_documents;
CREATE POLICY "Users can view documents for accessible projects"
ON public.project_documents
FOR SELECT
USING (has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can insert documents for their projects" ON public.project_documents;
CREATE POLICY "Users can insert documents for accessible projects"
ON public.project_documents
FOR INSERT
WITH CHECK (
  auth.uid() = user_id AND
  has_project_access(auth.uid(), project_id)
);

DROP POLICY IF EXISTS "Users can update documents for their projects" ON public.project_documents;
CREATE POLICY "Users can update documents for accessible projects"
ON public.project_documents
FOR UPDATE
USING (has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can delete documents for their projects" ON public.project_documents;
CREATE POLICY "Users can delete documents for accessible projects"
ON public.project_documents
FOR DELETE
USING (has_project_access(auth.uid(), project_id));

-- Trigger for updated_at
CREATE TRIGGER update_project_team_members_updated_at
BEFORE UPDATE ON public.project_team_members
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();