-- Create a table for storing completed inspection checklists
CREATE TABLE public.saved_inspection_checklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    inspection_id UUID REFERENCES public.inspections(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    checklist_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    custom_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    inspector_signature TEXT,
    contractor_signature TEXT,
    inspector_signed_at TIMESTAMP WITH TIME ZONE,
    contractor_signed_at TIMESTAMP WITH TIME ZONE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed', 'signed')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.saved_inspection_checklists ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own saved checklists" 
ON public.saved_inspection_checklists 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own saved checklists" 
ON public.saved_inspection_checklists 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own saved checklists" 
ON public.saved_inspection_checklists 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own saved checklists" 
ON public.saved_inspection_checklists 
FOR DELETE 
USING (auth.uid() = user_id);

-- Project team members can view checklists for their projects
CREATE POLICY "Team members can view project checklists"
ON public.saved_inspection_checklists
FOR SELECT
USING (
    project_id IS NOT NULL AND
    public.has_project_access(project_id, auth.uid())
);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_saved_inspection_checklists_updated_at
BEFORE UPDATE ON public.saved_inspection_checklists
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for faster queries
CREATE INDEX idx_saved_inspection_checklists_user_id ON public.saved_inspection_checklists(user_id);
CREATE INDEX idx_saved_inspection_checklists_project_id ON public.saved_inspection_checklists(project_id);
CREATE INDEX idx_saved_inspection_checklists_status ON public.saved_inspection_checklists(status);