-- Add visibility column to inspection_checklist_templates
ALTER TABLE public.inspection_checklist_templates
ADD COLUMN visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'team', 'organization'));

-- Add shared_by column to track who shared the template
ALTER TABLE public.inspection_checklist_templates
ADD COLUMN shared_at timestamp with time zone;

-- Create index for faster queries on visibility
CREATE INDEX idx_checklist_templates_visibility ON public.inspection_checklist_templates(visibility);

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own templates" ON public.inspection_checklist_templates;
DROP POLICY IF EXISTS "Users can insert their own templates" ON public.inspection_checklist_templates;
DROP POLICY IF EXISTS "Users can update their own templates" ON public.inspection_checklist_templates;
DROP POLICY IF EXISTS "Users can delete their own templates" ON public.inspection_checklist_templates;

-- Create new policies that include shared templates

-- Users can view their own templates OR templates shared with team/organization
CREATE POLICY "Users can view own and shared templates"
ON public.inspection_checklist_templates
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid() 
  OR visibility IN ('team', 'organization')
);

-- Users can only insert their own templates
CREATE POLICY "Users can insert their own templates"
ON public.inspection_checklist_templates
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Users can only update their own templates
CREATE POLICY "Users can update their own templates"
ON public.inspection_checklist_templates
FOR UPDATE
TO authenticated
USING (user_id = auth.uid());

-- Users can only delete their own templates
CREATE POLICY "Users can delete their own templates"
ON public.inspection_checklist_templates
FOR DELETE
TO authenticated
USING (user_id = auth.uid());