-- Create activity type enum
CREATE TYPE public.activity_type AS ENUM (
  'project_created',
  'project_updated',
  'project_status_changed',
  'document_uploaded',
  'document_version_uploaded',
  'document_deleted',
  'team_member_invited',
  'team_member_joined',
  'team_member_removed',
  'team_member_role_changed',
  'inspection_scheduled',
  'inspection_updated',
  'inspection_passed',
  'inspection_failed',
  'inspection_cancelled',
  'punch_item_created',
  'punch_item_updated',
  'punch_item_resolved',
  'punch_item_verified',
  'comment_added'
);

-- Create project activity log table
CREATE TABLE public.project_activity (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  activity_type public.activity_type NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for faster queries
CREATE INDEX idx_project_activity_project_id ON public.project_activity(project_id);
CREATE INDEX idx_project_activity_created_at ON public.project_activity(created_at DESC);

-- Enable RLS
ALTER TABLE public.project_activity ENABLE ROW LEVEL SECURITY;

-- Users can view activity for projects they have access to
CREATE POLICY "Users can view activity for accessible projects"
  ON public.project_activity
  FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

-- Users can create activity entries for accessible projects
CREATE POLICY "Users can create activity for accessible projects"
  ON public.project_activity
  FOR INSERT
  WITH CHECK (auth.uid() = user_id AND has_project_access(auth.uid(), project_id));

-- Enable realtime for activity feed
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_activity;